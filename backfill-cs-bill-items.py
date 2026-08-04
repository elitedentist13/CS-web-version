"""
Build Banana bill line-items backfill from CS PAYMENTSLAVETABLE export (multi-branch).

Reads:  CS_<BRANCH>_PaymentHistory_*_items.csv
Writes: CS_<BRANCH>_bill_items_backfill_for_supabase.csv
Then:   supabase_cs_payments_backfill_items.sql

Banana item shape: [{desc, qty, price, disc, tooth_no}]
  - price = unit HKD
  - disc  = percent (0–100), converted from CS HKD discount

Prefer for NEW imports: prepare-cs-payments-staging-csv.py --items ...
so items_json is present before insert (no backfill needed).
"""
from __future__ import annotations

import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path


def fnum(v, default: float = 0.0) -> float:
    try:
        if v is None or v == "":
            return default
        return float(v)
    except (TypeError, ValueError):
        return default


def line_to_item(row: dict) -> dict | None:
    item = (row.get("Item") or row.get("item") or "").strip()
    sub = (row.get("SubItem") or row.get("sub_item") or "").strip()
    if not item and not sub:
        return None
    desc = item if not sub else (f"{item} - {sub}" if item else sub)

    qty = fnum(row.get("Qty") or row.get("qty"), 0.0)
    if qty <= 0:
        qty = 1.0

    net = fnum(row.get("NetHkd") or row.get("net_hkd"))
    disc_hkd = fnum(row.get("DiscountHkd") or row.get("discount_hkd"))
    unit_amt = fnum(row.get("UnitAmountHkd") or row.get("unit_amount_hkd"))

    gross = net + disc_hkd
    if gross <= 0 and unit_amt > 0:
        gross = unit_amt
        if net <= 0:
            net = unit_amt - disc_hkd
    if gross <= 0 and net > 0:
        gross = net

    unit_price = round(gross / qty, 2) if qty else round(gross, 2)
    disc_pct = round((disc_hkd / gross) * 100.0, 4) if gross > 0 and disc_hkd > 0 else 0.0

    return {
        "desc": desc,
        "qty": qty if qty != int(qty) else int(qty),
        "price": unit_price,
        "disc": disc_pct,
        "tooth_no": "-",
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", required=True, help="Branch code e.g. TKO / PL / KT")
    ap.add_argument("--items", required=True, help="CS *_items.csv from export-cs-payments.ps1")
    ap.add_argument("--out-csv", default="", help="Default: Downloads/CS_<BRANCH>_bill_items_backfill_for_supabase.csv")
    ap.add_argument(
        "--active-only",
        action="store_true",
        default=True,
        help="Skip cancelled slave rows (CancelStatus != 0)",
    )
    args = ap.parse_args()

    branch = re.sub(r"[^A-Z0-9_-]", "", args.branch.strip().upper())
    items_path = Path(args.items)
    if not items_path.exists():
        raise SystemExit(f"Items CSV not found: {items_path}")

    by_txn: dict[str, list] = defaultdict(list)
    skipped_cancel = 0
    skipped_empty = 0
    with items_path.open(encoding="utf-8-sig", newline="", errors="replace") as fh:
        for row in csv.DictReader(fh):
            cancel = str(row.get("CancelStatus") or row.get("cancel_status") or "0").strip()
            if args.active_only and cancel not in ("0", ""):
                skipped_cancel += 1
                continue
            txn = (row.get("TxnCode") or row.get("txn_code") or "").strip()
            if not txn:
                continue
            it = line_to_item(row)
            if not it:
                skipped_empty += 1
                continue
            by_txn[txn].append(it)

    out_csv = Path(args.out_csv) if args.out_csv else Path(
        rf"C:\Users\Doctor-1\Downloads\CS_{branch}_bill_items_backfill_for_supabase.csv"
    )
    fields = ["txn_code", "items_json", "line_count", "branch_code"]
    with out_csv.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for txn in sorted(by_txn.keys()):
            lines = by_txn[txn]
            w.writerow(
                {
                    "txn_code": txn,
                    "items_json": json.dumps(lines, ensure_ascii=False, separators=(",", ":")),
                    "line_count": len(lines),
                    "branch_code": branch,
                }
            )

    sample_txn = next(iter(sorted(by_txn.keys())), "")
    print(f"OUT_CSV {out_csv}")
    print(f"TXNS {len(by_txn)}")
    print(f"SKIP_CANCEL {skipped_cancel} SKIP_EMPTY {skipped_empty}")
    if sample_txn:
        print(f"SAMPLE {sample_txn} -> {json.dumps(by_txn[sample_txn], ensure_ascii=False)}")
    print("Next: TRUNCATE cs_bill_items_backfill → import OUT_CSV → run supabase_cs_payments_backfill_items.sql §1–2")


if __name__ == "__main__":
    main()
