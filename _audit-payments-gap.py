"""
Spot-check why CS→Banana payments look incomplete.

1) Original unmatched batches still marked unmatched (not cleared after resolve)
2) Resolve staging: how many got into Banana (skipped_dup/inserted) vs still manual
3) Sample: CS_TXN bills missing bill_payments / missing CS_INCOME installments
"""
from __future__ import annotations

import csv
import json
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"
RESOLVE_DIR = Path.home() / "Downloads" / "CS_resolve_20260811"


def get_all(q: str, page: int = 1000) -> list:
    rows = []
    offset = 0
    while True:
        sep = "&" if "?" in q else "?"
        url = f"{BASE}/{q}{sep}limit={page}&offset={offset}"
        req = urllib.request.Request(
            url,
            headers={
                "apikey": ANON,
                "Authorization": f"Bearer {ANON}",
                "Prefer": "count=exact",
                "Range": f"{offset}-{offset + page - 1}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                chunk = json.loads(resp.read().decode() or "[]")
        except Exception as e:
            if "416" in str(e):
                break
            raise
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows


def count_status(table: str, status: str) -> str:
    url = f"{BASE}/{table}?import_status=eq.{status}&select=import_key&limit=1"
    req = urllib.request.Request(
        url,
        headers={
            "apikey": ANON,
            "Authorization": f"Bearer {ANON}",
            "Prefer": "count=exact",
            "Range": "0-0",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.headers.get("Content-Range", "")


def main() -> None:
    print("=== PAYMENTS STAGING TOTALS ===")
    for s in ("unmatched", "pending", "matched", "inserted", "skipped_dup"):
        print(f"  {s}: {count_status('cs_payments_staging', s)}")

    # Original unmatched (source batches, not *_RESOLVE_*)
    um = get_all(
        "cs_payments_staging?import_status=eq.unmatched&select=batch_id,branch_code,"
        "txn_code,chart_no,hkid_norm,name_en,net_hkd,received_hkd,import_error,"
        "payments_json,items_json"
    )
    src_um = [r for r in um if "RESOLVE" not in (r.get("batch_id") or "").upper()]
    res_um = [r for r in um if "RESOLVE" in (r.get("batch_id") or "").upper()]
    print(f"\nunmatched total={len(um)} source_batches={len(src_um)} resolve_batches={len(res_um)}")
    print("BY_BRANCH source", dict(Counter(r.get("branch_code") for r in src_um)))
    print("BY_ERROR source", dict(Counter(r.get("import_error") or "" for r in src_um).most_common()))

    # Resolve batches from report (avoid PostgREST like.* which can 500)
    report_path = RESOLVE_DIR / "resolve_report.json"
    resolve_batches = []
    if report_path.exists():
        report = json.loads(report_path.read_text(encoding="utf-8"))
        resolve_batches = [x["batch_id"] for x in report.get("payment_resolve_batches") or []]
    # also include known pending resolve
    resolve_batches += ["KT_PAY_RESOLVE_20260810_034913", "PL_PAY_RESOLVE_20260811_143842"]
    resolve_batches = sorted(set(resolve_batches))

    resolve_rows = []
    for bid in resolve_batches:
        chunk = get_all(
            f"cs_payments_staging?batch_id=eq.{urllib.parse.quote(bid, safe='')}"
            "&select=batch_id,import_status,txn_code,branch_code,inserted_bill_id,matched_patient_id"
        )
        print(f"  resolve batch {bid}: {len(chunk)}")
        resolve_rows.extend(chunk)
    print(f"\nPAY_RESOLVE staging rows={len(resolve_rows)}")
    print("BY_STATUS", dict(Counter(r.get("import_status") for r in resolve_rows)))
    by_batch = defaultdict(Counter)
    for r in resolve_rows:
        by_batch[r.get("batch_id") or "?"][r.get("import_status") or "?"] += 1
    print("BY_BATCH status:")
    for b, c in sorted(by_batch.items()):
        print(f"  {b}: {dict(c)}")

    # Overlap: source unmatched txn that also appear in resolve inserted/skipped_dup
    resolve_ok_txn = {
        ((r.get("branch_code") or "").upper(), (r.get("txn_code") or "").strip())
        for r in resolve_rows
        if r.get("import_status") in ("inserted", "skipped_dup") and r.get("txn_code")
    }
    covered = 0
    not_covered = []
    for r in src_um:
        key = ((r.get("branch_code") or "").upper(), (r.get("txn_code") or "").strip())
        if key in resolve_ok_txn:
            covered += 1
        else:
            not_covered.append(r)
    print(f"\nSOURCE unmatched covered by resolve insert/skip_dup: {covered}/{len(src_um)}")
    print(f"SOURCE unmatched NOT covered (true gap): {len(not_covered)}")
    print("NOT_COVERED BY_BRANCH", dict(Counter(r.get("branch_code") for r in not_covered)))
    print("NOT_COVERED BY_ERROR", dict(Counter(r.get("import_error") or "" for r in not_covered).most_common()))

    # Manual still files
    print("\n=== LOCAL still_unmatched_manual (latest per branch) ===")
    still_total = 0
    for br in ("TKO", "OKT", "PL", "KT", "CWB", "MK"):
        paths = sorted(RESOLVE_DIR.glob(f"CS_{br}_PaymentHistory_*still_unmatched_manual.csv"))
        # prefer stamped resolve file over generic
        stamped = [p for p in paths if "RESOLVE" in p.name]
        path = stamped[-1] if stamped else (paths[-1] if paths else None)
        if not path:
            continue
        with path.open(encoding="utf-8-sig", newline="") as f:
            n = sum(1 for _ in csv.DictReader(f))
        still_total += n
        print(f"  {br}: {n} → {path.name}")
    print("manual_still_total", still_total)

    # Write true gap CSV
    out = RESOLVE_DIR / "AUDIT_payments_true_gap.csv"
    if not_covered:
        keys = [
            "branch_code",
            "batch_id",
            "txn_code",
            "chart_no",
            "hkid_norm",
            "name_en",
            "net_hkd",
            "received_hkd",
            "import_error",
        ]
        with out.open("w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
            w.writeheader()
            for r in not_covered:
                w.writerow({k: r.get(k) or "" for k in keys})
        print("WROTE", out)

    # Spot-check: among skipped_dup resolve rows, how many bills lack any bill_payments?
    skip_dups = [r for r in resolve_rows if r.get("import_status") == "skipped_dup" and r.get("inserted_bill_id")]
    sample = skip_dups[:80]
    no_pay = 0
    no_income = 0
    for r in sample:
        bid = r["inserted_bill_id"]
        pays = get_all(f"bill_payments?bill_id=eq.{bid}&select=id,method,notes,amount&limit=50")
        if not pays:
            no_pay += 1
        elif not any((p.get("notes") or "").startswith("CS_INCOME:") for p in pays):
            # has payments but no installment expand
            if any((p.get("method") or "") == "CS Import" for p in pays):
                no_income += 1
    print(f"\nSPOT skipped_dup sample n={len(sample)}: bills_with_zero_payments={no_pay}, lump_CS_Import_no_CS_INCOME={no_income}")

    # Why spot-check looks incomplete — root causes
    print("\n=== ROOT CAUSES (likely) ===")
    print("1) Source unmatched rows were NEVER flipped after resolve — UI/SQL still shows 620 unmatched.")
    print("2) True gap not covered by resolve:", len(not_covered), "(manual / no patient).")
    print("3) Many resolve hits are skipped_dup (bill exists) — installment/method expand may be incomplete.")
    print("4) Blank-batch notes (2390) unrelated to payments but often confuse spot-checks.")


if __name__ == "__main__":
    main()
