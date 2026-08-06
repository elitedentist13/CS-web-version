"""
Find CS-imported bills that duplicate existing Banana bills (multi-branch).

Use AFTER payment import for a branch. Typical case:
  - Balance was already entered in Banana (often notes contain JSM_PENDING:…)
  - Newer payments were taken in Banana
  - CS import inserted a second bill with an older paid/balance snapshot

Writes a review CSV + a void-staging CSV for supabase_cs_payments_void_duplicates.sql.

Match rule (auto):
  same patient_id + bill_date + total (active / non-void bills)
  CS side = notes contain CS_TXN:
  Banana side = notes do NOT contain CS_TXN:

Reasons:
  banana_ahead          — Banana paid more / lower balance / Paid vs CS Partial
  identical_duplicate   — same paid & balance (still void CS to stop double-count)
  review_cs_more_paid   — CS shows more paid than Banana (manual review; NOT in void CSV)

Optional related splits (different totals same day) are NOT auto-voided — review CSV only
when --include-related-review is set.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"
OUT_DIR = Path(r"C:\Users\joyfu\Downloads")


def get_all(table_and_query: str) -> list:
    rows: list = []
    offset = 0
    page = 1000
    while True:
        url = f"{BASE}/{table_and_query}&limit={page}&offset={offset}"
        req = urllib.request.Request(
            url,
            headers={
                "apikey": ANON,
                "Authorization": f"Bearer {ANON}",
                "Prefer": "count=exact",
                "Range": f"{offset}-{offset + page - 1}",
            },
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            chunk = json.loads(resp.read().decode("utf-8"))
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows


def txn_of(notes: str) -> str:
    m = re.search(r"CS_TXN:([0-9A-Za-z]+)", notes or "")
    return m.group(1) if m else ""


def money(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", required=True, help="Branch code e.g. TKO / PL / KT")
    ap.add_argument(
        "--clinic-tag",
        default="",
        help="Filter CS bills by patients.clinic_tag (default = branch)",
    )
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    ap.add_argument(
        "--include-related-review",
        action="store_true",
        help="Also list same-day same-patient different-total pairs for manual review",
    )
    args = ap.parse_args()

    branch = re.sub(r"[^A-Z0-9_-]", "", args.branch.strip().upper())
    clinic = re.sub(r"[^A-Z0-9_-]", "", (args.clinic_tag or branch).strip().upper())
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading bills for clinic_tag={clinic} …")
    # Pull CS import bills (global), then filter by patient clinic via join-ish second query
    cs = get_all(
        "bills?select=id,patient_id,patient_no,patient_name,bill_date,total,"
        "amount_paid,balance,status,notes,voided_at,bill_type"
        "&notes=like.*CS_TXN:*&order=bill_date.asc"
    )
    native = get_all(
        "bills?select=id,patient_id,patient_no,patient_name,bill_date,total,"
        "amount_paid,balance,status,notes,voided_at,bill_type"
        "&notes=not.like.*CS_TXN:*&order=bill_date.asc"
    )

    # clinic filter via patients.clinic_tag
    patients = get_all(
        f"patients?select=id,patient_no,clinic_tag&clinic_tag=eq.{clinic}&order=patient_no.asc"
    )
    clinic_pids = {p["id"] for p in patients if p.get("id")}

    # Also include patients linked by THIS branch's CS payment staging
    # (CWB/SKW often have blank clinic_tag but banana_clinic_tag = CWB on staging).
    staging = get_all(
        "cs_payments_staging?select=matched_patient_id,banana_clinic_tag,branch_code,import_status"
        f"&or=(banana_clinic_tag.eq.{clinic},branch_code.eq.{branch})"
        "&matched_patient_id=not.is.null"
    )
    staging_pids = {
        r["matched_patient_id"]
        for r in staging
        if r.get("matched_patient_id")
        and (r.get("import_status") or "")
        in ("inserted", "skipped_dup", "matched", "pending", "unmatched")
    }
    clinic_pids |= staging_pids
    print(
        f"patients in {clinic}: {len(patients)} tagged"
        f" + {len(staging_pids)} from staging → {len(clinic_pids)} total"
    )

    cs_a = [
        b
        for b in cs
        if not b.get("voided_at")
        and b.get("patient_id") in clinic_pids
    ]
    nat_a = [
        b
        for b in native
        if not b.get("voided_at")
        and b.get("patient_id") in clinic_pids
    ]
    print(f"active CS bills: {len(cs_a)} | active Banana bills: {len(nat_a)}")

    nat_exact: dict[tuple, list] = defaultdict(list)
    nat_by_pid: dict[str, list] = defaultdict(list)
    for b in nat_a:
        pid = b.get("patient_id")
        if not pid:
            continue
        d = str(b.get("bill_date") or "")[:10]
        tot = round(money(b.get("total")), 2)
        nat_exact[(pid, d, tot)].append(b)
        nat_by_pid[pid].append(b)

    review_rows: list[dict] = []
    void_rows: list[dict] = []

    for b in cs_a:
        pid = b.get("patient_id")
        if not pid:
            continue
        d = str(b.get("bill_date") or "")[:10]
        tot = round(money(b.get("total")), 2)
        matches = nat_exact.get((pid, d, tot)) or []
        if not matches:
            continue
        matches = sorted(
            matches,
            key=lambda n: (
                0 if "JSM_PENDING" in (n.get("notes") or "") else 1,
                -money(n.get("amount_paid")),
            ),
        )
        n = matches[0]
        cs_paid, nat_paid = money(b.get("amount_paid")), money(n.get("amount_paid"))
        cs_bal, nat_bal = money(b.get("balance")), money(n.get("balance"))
        if (
            nat_paid > cs_paid + 0.05
            or nat_bal + 0.05 < cs_bal
            or (n.get("status") == "Paid" and b.get("status") != "Paid")
        ):
            reason = "banana_ahead"
        elif abs(cs_paid - nat_paid) <= 0.05 and abs(cs_bal - nat_bal) <= 0.05:
            reason = "identical_duplicate"
        else:
            reason = "review_cs_more_paid"

        row = {
            "branch_code": branch,
            "banana_clinic_tag": clinic,
            "action": "void_CS_keep_Banana" if reason != "review_cs_more_paid" else "manual_review",
            "reason": reason,
            "cs_bill_id": b["id"],
            "nat_bill_id": n["id"],
            "patient_no": b.get("patient_no") or "",
            "patient_name": b.get("patient_name") or n.get("patient_name") or "",
            "bill_date": d,
            "total": tot,
            "cs_paid": cs_paid,
            "nat_paid": nat_paid,
            "cs_bal": cs_bal,
            "nat_bal": nat_bal,
            "cs_status": b.get("status") or "",
            "nat_status": n.get("status") or "",
            "nat_bill_type": n.get("bill_type") or "",
            "cs_txn": txn_of(b.get("notes") or ""),
            "nat_notes": (n.get("notes") or "")[:140],
            "is_jsm": "Y" if "JSM_PENDING" in (n.get("notes") or "") else "N",
            "review_note": "",
        }
        review_rows.append(row)
        if reason in ("banana_ahead", "identical_duplicate"):
            void_rows.append(
                {
                    "cs_bill_id": row["cs_bill_id"],
                    "nat_bill_id": row["nat_bill_id"],
                    "reason": row["reason"],
                    "patient_no": row["patient_no"],
                    "bill_date": row["bill_date"],
                    "cs_txn": row["cs_txn"],
                    "branch_code": branch,
                    "banana_clinic_tag": clinic,
                }
            )

    if args.include_related_review:
        exact_cs_ids = {r["cs_bill_id"] for r in review_rows}
        for b in cs_a:
            if b["id"] in exact_cs_ids:
                continue
            pid = b.get("patient_id")
            if not pid:
                continue
            d = str(b.get("bill_date") or "")[:10]
            tot = round(money(b.get("total")), 2)
            for n in nat_by_pid.get(pid, []):
                if str(n.get("bill_date") or "")[:10] != d:
                    continue
                nt = round(money(n.get("total")), 2)
                if abs(nt - tot) <= 0.05:
                    continue
                review_rows.append(
                    {
                        "branch_code": branch,
                        "banana_clinic_tag": clinic,
                        "action": "manual_review",
                        "reason": "same_day_different_total",
                        "cs_bill_id": b["id"],
                        "nat_bill_id": n["id"],
                        "patient_no": b.get("patient_no") or "",
                        "patient_name": b.get("patient_name") or "",
                        "bill_date": d,
                        "total": tot,
                        "cs_paid": money(b.get("amount_paid")),
                        "nat_paid": money(n.get("amount_paid")),
                        "cs_bal": money(b.get("balance")),
                        "nat_bal": money(n.get("balance")),
                        "cs_status": b.get("status") or "",
                        "nat_status": n.get("status") or "",
                        "nat_bill_type": n.get("bill_type") or "",
                        "cs_txn": txn_of(b.get("notes") or ""),
                        "nat_notes": (n.get("notes") or "")[:140],
                        "is_jsm": "Y" if "JSM_PENDING" in (n.get("notes") or "") else "N",
                        "review_note": f"CS total {tot} vs Banana total {nt} — review before void",
                    }
                )

    review_path = out_dir / f"CS_{branch}_bill_duplicate_conflicts.csv"
    void_path = out_dir / f"CS_{branch}_bill_dup_void_staging_for_supabase.csv"

    review_fields = [
        "branch_code",
        "banana_clinic_tag",
        "action",
        "reason",
        "cs_bill_id",
        "nat_bill_id",
        "patient_no",
        "patient_name",
        "bill_date",
        "total",
        "cs_paid",
        "nat_paid",
        "cs_bal",
        "nat_bal",
        "cs_status",
        "nat_status",
        "nat_bill_type",
        "cs_txn",
        "nat_notes",
        "is_jsm",
        "review_note",
    ]
    with review_path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=review_fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(
            sorted(
                review_rows,
                key=lambda r: (0 if "ahead" in r["reason"] else 1, r["bill_date"], r["patient_no"]),
            )
        )

    void_fields = [
        "cs_bill_id",
        "nat_bill_id",
        "reason",
        "patient_no",
        "bill_date",
        "cs_txn",
        "branch_code",
        "banana_clinic_tag",
    ]
    with void_path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=void_fields)
        w.writeheader()
        w.writerows(void_rows)

    c = Counter(r["reason"] for r in review_rows)
    print(f"REVIEW_CSV {review_path} ({len(review_rows)})")
    print(f"VOID_STAGING_CSV {void_path} ({len(void_rows)})")
    print(f"REASONS {dict(c)}")
    print(
        "Next: import VOID_STAGING_CSV into cs_bill_dup_void, "
        "then run supabase_cs_payments_void_duplicates.sql §1–2"
    )


if __name__ == "__main__":
    main()
