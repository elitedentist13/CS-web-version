"""
Find CS open-balance bills that were carried into Banana as a transfer bill
(JSM_PENDING / native bill).

Match modes (CS plan date and Banana transfer date usually DIFFER):

  A) transfer_equal_balance
     Banana.total ≈ CS.balance  (exact carry-over; no later CS pay required)
     Prefer JSM_PENDING / transfer-labelled Banana bills.

  B) transfer_then_cs_installment
     Banana.total ≈ CS.balance + sum(CS payments with paid_date >= Banana.bill_date)
     (transfer opened before final CS installment(s) — e.g. +$1000)

These are NOT caught by find-cs-bill-duplicates.py (different date/total).

Writes:
  CS_<BRANCH>_transfer_balance_conflicts.csv   (review)
  CS_<BRANCH>_transfer_balance_void_staging_for_supabase.csv  (auto void CS)

Import void staging into cs_bill_dup_void, then run
supabase_cs_payments_void_duplicates.sql §1–2 (Banana wins).

Docs / reuse:
  CS_TRANSFER_BALANCE_VOID.md       — multi-branch checklist
  CS_TRANSFER_BALANCE_VOID_LOG.md   — master clinic run log
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"
OUT_DIR = Path(os.path.expanduser("~")) / "Downloads"
REPO_DIR = Path(__file__).resolve().parent
MASTER_LOG = REPO_DIR / "CS_TRANSFER_BALANCE_VOID_LOG.md"


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


def money(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def txn_of(notes: str) -> str:
    m = re.search(r"CS_TXN:(?:[A-Z0-9_-]+:)?([0-9A-Za-z]+)", notes or "")
    return m.group(1) if m else ""


def ymd(d) -> str:
    return str(d or "")[:10]


def write_run_log(
    path: Path,
    *,
    branch: str,
    clinic: str,
    stamp: str,
    n_patients: int,
    n_cs_open: int,
    n_banana: int,
    review_rows: list[dict],
    void_rows: list[dict],
    review_path: Path,
    void_path: Path,
    check_patient: str,
) -> None:
    reasons = Counter(r["reason"] for r in review_rows)
    lines = [
        f"CS transfer-balance void finder — run log",
        f"stamp={stamp}",
        f"branch={branch}",
        f"clinic_tag={clinic}",
        f"patients_scoped={n_patients}",
        f"open_cs_bills_bal_gt_0={n_cs_open}",
        f"active_banana_bills={n_banana}",
        f"void_rows={len(void_rows)}",
        f"reasons={dict(reasons)}",
        f"review_csv={review_path}",
        f"void_staging_csv={void_path}",
        f"guide=CS_TRANSFER_BALANCE_VOID.md",
        f"master_log=CS_TRANSFER_BALANCE_VOID_LOG.md",
        "",
        "patients:",
    ]
    for r in sorted(review_rows, key=lambda x: x.get("patient_no") or ""):
        lines.append(
            f"  {r.get('patient_no')} | CS {r.get('cs_bill_date')} bal={r.get('cs_bal')} "
            f"| Banana {r.get('nat_bill_date')} tot={r.get('nat_total')} "
            f"| after_cs_pays={r.get('cs_pays_on_or_after_transfer')} "
            f"| recon={r.get('reconstructed_bal_at_transfer')} "
            f"| jsm={r.get('is_jsm')} | {r.get('reason')}"
        )
    if check_patient:
        hits = [
            r
            for r in review_rows
            if check_patient.upper() in (r.get("patient_no") or "").upper()
        ]
        lines.append("")
        lines.append(f"check_patient={check_patient} hits={len(hits)}")
    lines.append("")
    lines.append(
        "Next: TRUNCATE cs_bill_dup_void; import void staging; "
        "supabase_cs_payments_void_duplicates.sql §1–2; "
        "append CS_TRANSFER_BALANCE_VOID_LOG.md"
    )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def append_master_log(
    *,
    branch: str,
    clinic: str,
    stamp: str,
    n_cs_open: int,
    n_banana: int,
    review_rows: list[dict],
    void_rows: list[dict],
    review_path: Path,
    void_path: Path,
    log_path: Path,
) -> None:
    reasons = Counter(r["reason"] for r in review_rows)
    patients = ", ".join(
        sorted({r.get("patient_no") or "" for r in review_rows if r.get("patient_no")})
    )
    day = datetime.now().strftime("%Y-%m-%d")
    block = f"""
### {day} — {branch} (clinic_tag={clinic})

| Field | Value |
|-------|-------|
| Finder command | `python find-cs-transfer-balance-duplicates.py --branch {branch} --clinic-tag {clinic}` |
| Open CS bills (bal>0) scanned | {n_cs_open} |
| Active Banana bills in scope | {n_banana} |
| Void rows | **{len(void_rows)}** |
| Reasons | `{dict(reasons)}` |
| Void staging CSV | `{void_path.name}` |
| Review CSV | `{review_path.name}` |
| Run log | `{log_path.name}` |
| Patients | {patients or '(none)'} |
| Supabase void | import → `supabase_cs_payments_void_duplicates.sql` §1–3 |
| Notes | Auto-appended by finder (`--append-master-log`). See `CS_TRANSFER_BALANCE_VOID.md`. |

"""
    if MASTER_LOG.exists():
        text = MASTER_LOG.read_text(encoding="utf-8")
    else:
        text = "# Transfer-balance void — clinic run log\n\n## Runs\n"
    if f"## Runs" not in text:
        text = text.rstrip() + "\n\n## Runs\n"
    # Insert after "## Runs" heading
    marker = "## Runs"
    idx = text.find(marker)
    if idx >= 0:
        insert_at = idx + len(marker)
        text = text[:insert_at] + "\n" + block + text[insert_at:]
    else:
        text = text.rstrip() + "\n\n## Runs\n" + block
    MASTER_LOG.write_text(text, encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser(
        description=(
            "Find CS open-balance bills superseded by Banana transfer bills "
            "(multi-branch). See CS_TRANSFER_BALANCE_VOID.md"
        )
    )
    ap.add_argument("--branch", required=True, help="Branch code e.g. KT / TKO / PL")
    ap.add_argument("--clinic-tag", default="", help="Banana clinic_tag (default=branch)")
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    ap.add_argument(
        "--tol",
        type=float,
        default=0.05,
        help="Money tolerance (HKD) for banana.total vs reconstructed CS bal",
    )
    ap.add_argument(
        "--check-patient",
        default="",
        help="Optional patient_no fragment to highlight in log (e.g. 007657)",
    )
    ap.add_argument(
        "--append-master-log",
        action="store_true",
        help=f"Append a summary block to {MASTER_LOG.name} in the repo",
    )
    args = ap.parse_args()

    branch = re.sub(r"[^A-Z0-9_-]", "", args.branch.strip().upper())
    clinic = re.sub(r"[^A-Z0-9_-]", "", (args.clinic_tag or branch).strip().upper())
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    tol = float(args.tol)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    check_patient = (args.check_patient or "").strip()

    print(f"Loading patients / bills for clinic_tag={clinic} …")
    print(f"Guide: CS_TRANSFER_BALANCE_VOID.md | Log: CS_TRANSFER_BALANCE_VOID_LOG.md")
    patients = get_all(
        f"patients?select=id,patient_no,clinic_tag,full_name&clinic_tag=eq.{clinic}"
    )
    clinic_pids = {p["id"] for p in patients if p.get("id")}
    staging = get_all(
        "cs_payments_staging?select=matched_patient_id,banana_clinic_tag,branch_code"
        f"&or=(banana_clinic_tag.eq.{clinic},branch_code.eq.{branch})"
        "&matched_patient_id=not.is.null"
    )
    clinic_pids |= {
        r["matched_patient_id"] for r in staging if r.get("matched_patient_id")
    }
    print(f"patients scoped: {len(clinic_pids)}")

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

    cs_open = [
        b
        for b in cs
        if not b.get("voided_at")
        and b.get("patient_id") in clinic_pids
        and money(b.get("balance")) > tol
    ]
    nat_a = [
        b
        for b in native
        if not b.get("voided_at") and b.get("patient_id") in clinic_pids
    ]
    print(f"open CS bills (bal>0): {len(cs_open)} | active Banana bills: {len(nat_a)}")

    nat_by_pid: dict[str, list] = defaultdict(list)
    for b in nat_a:
        nat_by_pid[b["patient_id"]].append(b)

    # Payments for open CS bills (chunked IN filter)
    pays_by_bill: dict[str, list] = defaultdict(list)
    ids = [b["id"] for b in cs_open]
    chunk = 80
    for i in range(0, len(ids), chunk):
        part = ids[i : i + chunk]
        # PostgREST: id=in.(uuid,uuid)
        in_list = ",".join(part)
        rows = get_all(
            "bill_payments?select=bill_id,paid_date,amount,method,notes"
            f"&bill_id=in.({in_list})&order=paid_date.asc"
        )
        for r in rows:
            pays_by_bill[r["bill_id"]].append(r)
        print(f"  payments fetched … {min(i + chunk, len(ids))}/{len(ids)}")

    review_rows: list[dict] = []
    void_rows: list[dict] = []
    seen_cs: set[str] = set()

    for b in cs_open:
        pid = b["patient_id"]
        bananas = nat_by_pid.get(pid) or []
        if not bananas:
            continue
        cs_bal = money(b.get("balance"))
        cs_date = ymd(b.get("bill_date"))
        pays = pays_by_bill.get(b["id"]) or []

        # Prefer JSM_PENDING transfer bills; also consider other native bills
        candidates = sorted(
            bananas,
            key=lambda n: (
                0 if "JSM_PENDING" in (n.get("notes") or "") else 1,
                0 if "transfer" in (n.get("bill_type") or "").lower() else 1,
                0 if "transfer" in (n.get("notes") or "").lower() else 1,
                ymd(n.get("bill_date")),
            ),
        )

        best = None
        for n in candidates:
            nd = ymd(n.get("bill_date"))
            if not nd:
                continue
            # Transfer should be on/after the CS plan start
            if nd < cs_date:
                continue
            nat_tot = round(money(n.get("total")), 2)
            if nat_tot <= tol:
                continue

            notes_n = n.get("notes") or ""
            btype_n = (n.get("bill_type") or "").lower()
            is_jsm = "JSM_PENDING" in notes_n
            looks_transfer = (
                is_jsm
                or "transfer" in btype_n
                or "transfer" in notes_n.lower()
            )

            same_day_pays = [
                p
                for p in pays
                if ymd(p.get("paid_date")) == nd and money(p.get("amount")) > tol
            ]
            same_day_sum = round(sum(money(p.get("amount")) for p in same_day_pays), 2)

            # CS payments on/after Banana transfer date (reconstruction window)
            after = [
                p
                for p in pays
                if ymd(p.get("paid_date")) and ymd(p.get("paid_date")) >= nd
            ]
            after_sum = round(sum(money(p.get("amount")) for p in after), 2)
            # Outstanding Banana should have carried (= current CS bal + later CS pays)
            bal_at_transfer = round(cs_bal + after_sum, 2)

            reason = None
            score = 99

            # A) Exact amount transfer: Banana total == current CS open balance
            #    (no later CS installment required; dates may differ)
            if looks_transfer and abs(nat_tot - cs_bal) <= tol:
                reason = "transfer_equal_balance"
                after = []
                after_sum = 0.0
                bal_at_transfer = round(cs_bal, 2)
                score = 0 if is_jsm else 1

            # B) Transfer then further CS installments (banana = bal + later pays)
            elif abs(nat_tot - bal_at_transfer) <= tol and after_sum > tol:
                reason = "transfer_then_cs_installment"
                score = 2 if is_jsm else 3

            # C) Common +$1000 final CS installment after transfer
            elif abs(nat_tot - (cs_bal + 1000.0)) <= tol and any(
                abs(money(p.get("amount")) - 1000.0) <= tol for p in after
            ):
                reason = "transfer_plus_1000_final_cs"
                after = [
                    p for p in after if abs(money(p.get("amount")) - 1000.0) <= tol
                ]
                after_sum = round(sum(money(p.get("amount")) for p in after), 2)
                same_day_sum = round(
                    sum(
                        money(p.get("amount"))
                        for p in after
                        if ymd(p.get("paid_date")) == nd
                    ),
                    2,
                )
                bal_at_transfer = round(cs_bal + after_sum, 2)
                score = 4 if is_jsm else 5

            else:
                continue

            cand = {
                "n": n,
                "reason": reason,
                "after": after,
                "after_sum": after_sum,
                "same_day_sum": same_day_sum,
                "bal_at_transfer": bal_at_transfer,
                "score": (
                    score,
                    0 if is_jsm else 1,
                    abs(nat_tot - bal_at_transfer),
                    -len(after),
                ),
            }
            if best is None or cand["score"] < best["score"]:
                best = cand

        if not best:
            continue
        if b["id"] in seen_cs:
            continue
        seen_cs.add(b["id"])

        n = best["n"]
        after = best["after"]
        after_sum = best["after_sum"]
        row = {
            "branch_code": branch,
            "banana_clinic_tag": clinic,
            "action": "void_CS_keep_Banana",
            "reason": best["reason"],
            "cs_bill_id": b["id"],
            "nat_bill_id": n["id"],
            "patient_no": b.get("patient_no") or n.get("patient_no") or "",
            "patient_name": b.get("patient_name") or n.get("patient_name") or "",
            "cs_bill_date": cs_date,
            "nat_bill_date": ymd(n.get("bill_date")),
            "cs_total": round(money(b.get("total")), 2),
            "cs_paid": round(money(b.get("amount_paid")), 2),
            "cs_bal": round(cs_bal, 2),
            "nat_total": round(money(n.get("total")), 2),
            "nat_paid": round(money(n.get("amount_paid")), 2),
            "nat_bal": round(money(n.get("balance")), 2),
            "cs_pays_on_or_after_transfer": after_sum,
            "cs_pays_on_transfer_date": best.get("same_day_sum", 0),
            "reconstructed_bal_at_transfer": best["bal_at_transfer"],
            "n_cs_pays_after": len(after),
            "after_pay_detail": " | ".join(
                f"{ymd(p.get('paid_date'))} {p.get('method') or ''} {money(p.get('amount')):g}"
                for p in after[:8]
            )
            + (" …" if len(after) > 8 else ""),
            "cs_txn": txn_of(b.get("notes") or ""),
            "nat_notes": (n.get("notes") or "")[:140],
            "is_jsm": "Y" if "JSM_PENDING" in (n.get("notes") or "") else "N",
            "review_note": (
                "Requires CS installment on Banana bill_date. "
                "Banana total = CS open bal + CS pays on/after that date; "
                "void CS (Banana wins)."
            ),
        }
        review_rows.append(row)
        void_rows.append(
            {
                "cs_bill_id": row["cs_bill_id"],
                "nat_bill_id": row["nat_bill_id"],
                "reason": row["reason"],
                "patient_no": row["patient_no"],
                "bill_date": row["nat_bill_date"],
                "cs_txn": row["cs_txn"],
                "branch_code": branch,
                "banana_clinic_tag": clinic,
            }
        )

    review_path = out_dir / f"CS_{branch}_transfer_balance_conflicts.csv"
    void_path = out_dir / f"CS_{branch}_transfer_balance_void_staging_for_supabase.csv"
    log_path = out_dir / f"CS_{branch}_transfer_balance_void_{stamp}.log"

    review_fields = [
        "branch_code",
        "banana_clinic_tag",
        "action",
        "reason",
        "cs_bill_id",
        "nat_bill_id",
        "patient_no",
        "patient_name",
        "cs_bill_date",
        "nat_bill_date",
        "cs_total",
        "cs_paid",
        "cs_bal",
        "nat_total",
        "nat_paid",
        "nat_bal",
        "cs_pays_on_or_after_transfer",
        "cs_pays_on_transfer_date",
        "reconstructed_bal_at_transfer",
        "n_cs_pays_after",
        "after_pay_detail",
        "cs_txn",
        "nat_notes",
        "is_jsm",
        "review_note",
    ]
    with review_path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=review_fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(
            sorted(review_rows, key=lambda r: (r["nat_bill_date"], r["patient_no"]))
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

    write_run_log(
        log_path,
        branch=branch,
        clinic=clinic,
        stamp=stamp,
        n_patients=len(clinic_pids),
        n_cs_open=len(cs_open),
        n_banana=len(nat_a),
        review_rows=review_rows,
        void_rows=void_rows,
        review_path=review_path,
        void_path=void_path,
        check_patient=check_patient,
    )
    if args.append_master_log:
        append_master_log(
            branch=branch,
            clinic=clinic,
            stamp=stamp,
            n_cs_open=len(cs_open),
            n_banana=len(nat_a),
            review_rows=review_rows,
            void_rows=void_rows,
            review_path=review_path,
            void_path=void_path,
            log_path=log_path,
        )

    print(f"REVIEW_CSV {review_path} ({len(review_rows)})")
    print(f"VOID_STAGING_CSV {void_path} ({len(void_rows)})")
    print(f"LOG {log_path}")
    if args.append_master_log:
        print(f"MASTER_LOG {MASTER_LOG}")
    print(f"REASONS {dict(Counter(r['reason'] for r in review_rows))}")
    if check_patient:
        hit = [
            r
            for r in review_rows
            if check_patient.upper() in (r.get("patient_no") or "").upper()
        ]
        print(f"CHECK_PATIENT {check_patient} hits={len(hit)}")
        for r in hit:
            print(
                {
                    "patient": r["patient_no"],
                    "cs_bal": r["cs_bal"],
                    "nat_total": r["nat_total"],
                    "after": r["cs_pays_on_or_after_transfer"],
                    "recon": r["reconstructed_bal_at_transfer"],
                    "reason": r["reason"],
                }
            )
    print(
        "Next: TRUNCATE cs_bill_dup_void; import VOID_STAGING_CSV; "
        "run supabase_cs_payments_void_duplicates.sql §1–2; "
        "append CS_TRANSFER_BALANCE_VOID_LOG.md (or re-run with --append-master-log)"
    )
    print("Docs: CS_TRANSFER_BALANCE_VOID.md")


if __name__ == "__main__":
    main()
