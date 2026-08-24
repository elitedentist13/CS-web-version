"""
Find CS-imported bill lines where unit price was wrongly derived from NetHkd/qty.

Usage:
  python find-cs-bill-item-unit-price-bugs.py --branch PL --items CS_PL_..._items.csv
  python find-cs-bill-item-unit-price-bugs.py --branch PL --items ... --supabase
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from cs_bill_item_unit_price import (
    cs_slave_row_to_bill_item,
    cs_slave_row_to_bill_item_legacy,
    item_line_total,
)

DEFAULT_URL = "https://kprihawipljrltfzpfjd.supabase.co"
DEFAULT_ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)


def normalize_branch(raw: str) -> str:
    return re.sub(r"[^A-Z0-9_-]", "", (raw or "").strip().upper())


def scan_items_csv(items_path: Path, branch: str, active_only: bool) -> list[dict]:
    hits: list[dict] = []
    with items_path.open("r", encoding="utf-8-sig", newline="", errors="replace") as fh:
        for row in csv.DictReader(fh):
            cancel = str(row.get("CancelStatus") or row.get("cancel_status") or "0").strip()
            if active_only and cancel not in ("0", ""):
                continue
            old = cs_slave_row_to_bill_item_legacy(row)
            new = cs_slave_row_to_bill_item(row)
            if not old or not new:
                continue
            if abs(old["price"] - new["price"]) < 0.01:
                continue
            txn = (row.get("TxnCode") or row.get("txn_code") or "").strip()
            hits.append(
                {
                    "branch": branch,
                    "txn_code": txn,
                    "cs_txn": f"{branch}:{txn}",
                    "bill_date": (row.get("BillDate") or "").strip(),
                    "chart_no": (row.get("ChartNo") or "").strip(),
                    "patient_no": f"{branch}{(row.get('ChartNo') or '').strip()}",
                    "name_en": (row.get("NameEn") or "").strip(),
                    "item": (row.get("Item") or "").strip(),
                    "qty": new["qty"],
                    "unit_amt_hkd": row.get("UnitAmountHkd") or "",
                    "net_hkd": row.get("NetHkd") or "",
                    "old_unit_price": old["price"],
                    "new_unit_price": new["price"],
                    "old_line_total": item_line_total(old),
                    "new_line_total": item_line_total(new),
                }
            )
    return hits


def supabase_get(url: str, key: str, path: str) -> list:
    req = urllib.request.Request(
        f"{url.rstrip('/')}{path}",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def scan_supabase_bills(branch: str, url: str, key: str) -> list[dict]:
    """Match live bills whose stored items still have the old wrong unit price."""
    prefix = f"CS_TXN:{branch}:"
    hits: list[dict] = []
    offset = 0
    page = 500
    while True:
        q = urllib.parse.urlencode(
            {
                "select": "id,bill_date,total,notes,items,patient_id,patients(patient_no,name_en)",
                "notes": f"like.{prefix}*",
                "order": "bill_date.desc",
                "limit": str(page),
                "offset": str(offset),
            }
        )
        rows = supabase_get(url, key, f"/rest/v1/bills?{q}")
        if not rows:
            break
        for bill in rows:
            notes = bill.get("notes") or ""
            m = re.search(rf"CS_TXN:{re.escape(branch)}:(\d+)", notes)
            if not m:
                continue
            txn = m.group(1)
            items = bill.get("items")
            if isinstance(items, str):
                try:
                    items = json.loads(items)
                except json.JSONDecodeError:
                    continue
            if not isinstance(items, list):
                continue
            for it in items:
                qty = float(it.get("qty") or 1)
                price = float(it.get("price") or 0)
                if qty <= 1 or price <= 0:
                    continue
                # Wrong pattern: line total = net (unit level), not price*qty
                # Detect if price * qty is much larger than displayed line (price looks like net/qty)
                line = item_line_total(it)
                if qty > 1 and line > 0 and abs(price * qty - line) < 0.02 and price < line / qty * 0.99:
                    # price*qty ≈ line means no bug; skip
                    continue
                # Heuristic: if doubling unit price makes line ~ qty times larger and item name common
                desc = (it.get("desc") or "").upper()
                if qty > 1 and price > 0:
                    doubled_line = item_line_total({**it, "price": price * qty})
                    # Bug case: current line = price*qty (small), should be price*qty*qty? No...
                    # Bug: price = net/qty, line = net. Correct unit = price * qty when net was unit net.
                    candidate_unit = round(price * qty, 2)
                    fixed = {**it, "price": candidate_unit}
                    fixed_line = item_line_total(fixed)
                    if fixed_line > line * 1.5 and abs(fixed_line - candidate_unit * qty) < 1.0:
                        pat = bill.get("patients") or {}
                        hits.append(
                            {
                                "branch": branch,
                                "bill_id": bill.get("id"),
                                "txn_code": txn,
                                "cs_txn": f"{branch}:{txn}",
                                "bill_date": bill.get("bill_date"),
                                "patient_no": pat.get("patient_no") or "",
                                "name_en": pat.get("name_en") or "",
                                "item": it.get("desc") or "",
                                "qty": qty,
                                "stored_unit_price": price,
                                "likely_correct_unit": candidate_unit,
                                "stored_line_total": line,
                                "likely_line_total": fixed_line,
                                "bill_total": bill.get("total"),
                            }
                        )
        if len(rows) < page:
            break
        offset += page
    return hits


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", required=True)
    ap.add_argument("--items", help="CS *_items.csv")
    ap.add_argument("--supabase", action="store_true", help="Also scan live bills table")
    ap.add_argument("--active-only", action="store_true", default=True)
    ap.add_argument("--out-csv", default="")
    args = ap.parse_args()

    branch = normalize_branch(args.branch)
    all_hits: list[dict] = []

    if args.items:
        items_path = Path(args.items)
        if not items_path.exists():
            raise SystemExit(f"Items CSV not found: {items_path}")
        csv_hits = scan_items_csv(items_path, branch, args.active_only)
        all_hits.extend(csv_hits)
        print(f"=== CS items CSV ({branch}) — unit-price bugs: {len(csv_hits)} lines ===\n")
        by_patient: dict[str, list] = defaultdict(list)
        for h in csv_hits:
            by_patient[h["patient_no"]].append(h)
        for pno in sorted(by_patient.keys()):
            rows = by_patient[pno]
            name = rows[0]["name_en"]
            print(f"  {pno}  {name}  ({len(rows)} line(s))")
            for h in rows:
                print(
                    f"    {h['bill_date']}  {h['cs_txn']}  {h['item']}  "
                    f"qty={h['qty']}  ${h['old_unit_price']:.2f}→${h['new_unit_price']:.2f}  "
                    f"line ${h['old_line_total']:.2f}→${h['new_line_total']:.2f}"
                )
        print()

    if args.supabase:
        url = os.environ.get("SUPABASE_URL", DEFAULT_URL)
        key = os.environ.get("SUPABASE_ANON_KEY", DEFAULT_ANON)
        try:
            sb_hits = scan_supabase_bills(branch, url, key)
        except Exception as e:
            print(f"Supabase scan failed: {e}")
            sb_hits = []
        print(f"=== Live Supabase bills ({branch}) — likely wrong items: {len(sb_hits)} ===\n")
        for h in sb_hits:
            print(
                f"  {h.get('patient_no')}  {h.get('name_en')}  {h['cs_txn']}  "
                f"{h['item']} qty={h['qty']}  ${h['stored_unit_price']}→${h['likely_correct_unit']}"
            )

    if args.out_csv and all_hits:
        out = Path(args.out_csv)
        fields = list(all_hits[0].keys())
        with out.open("w", encoding="utf-8-sig", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=fields)
            w.writeheader()
            w.writerows(all_hits)
        print(f"Wrote {out}")


if __name__ == "__main__":
    main()
