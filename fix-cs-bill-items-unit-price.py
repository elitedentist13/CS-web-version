"""
Repair CS-imported bill line items in Supabase.

Modes:
  csv        — rebuild from CS *_items.csv (most accurate; used for PL)
  reconcile  — fix stored items when their sum is below bill.total (all branches)

Usage:
  python fix-cs-bill-items-unit-price.py --branch PL --items CS_PL_..._items.csv --apply
  python fix-cs-bill-items-unit-price.py --all-branches --mode reconcile --apply
  python fix-cs-bill-items-unit-price.py --branch KT --mode reconcile --apply
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from cs_bill_item_unit_price import (
    cs_slave_row_to_bill_item,
    items_sum,
    reconcile_items_to_bill_total,
)

DEFAULT_URL = "https://kprihawipljrltfzpfjd.supabase.co"
DEFAULT_ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)

ALL_BRANCHES = ("KT", "OKT", "PY", "MCP", "MK", "CWB", "TKO", "PL")


def normalize_branch(raw: str) -> str:
    return re.sub(r"[^A-Z0-9_-]", "", (raw or "").strip().upper())


def parse_items(raw) -> list:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    return []


def load_fixed_items_by_txn(items_path: Path, active_only: bool) -> dict[str, list]:
    by_txn: dict[str, list] = defaultdict(list)
    with items_path.open("r", encoding="utf-8-sig", newline="", errors="replace") as fh:
        for row in csv.DictReader(fh):
            cancel = str(row.get("CancelStatus") or row.get("cancel_status") or "0").strip()
            if active_only and cancel not in ("0", ""):
                continue
            txn = (row.get("TxnCode") or row.get("txn_code") or "").strip()
            if not txn:
                continue
            it = cs_slave_row_to_bill_item(row)
            if it:
                by_txn[txn].append(it)
    return dict(by_txn)


def supabase_request(method: str, url: str, key: str, path: str, body: dict | None = None) -> object:
    data = None
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
        headers["Prefer"] = "return=representation"
    req = urllib.request.Request(f"{url.rstrip('/')}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Supabase {method} {path} failed ({e.code}): {err}") from e


def fetch_cs_bills(url: str, key: str, branch: str | None = None) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    page = 500
    notes_filter = f"like.CS_TXN:{branch}:*" if branch else "like.CS_TXN:*"
    while True:
        q = urllib.parse.urlencode(
            {
                "select": "id,bill_date,total,notes,items,patient_no,patient_name,clinic_tag",
                "notes": notes_filter,
                "order": "bill_date.desc",
                "limit": str(page),
                "offset": str(offset),
            }
        )
        batch = supabase_request("GET", url, key, f"/rest/v1/bills?{q}")
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page:
            break
        offset += page
    return rows


def fetch_legacy_cs_bills(url: str, key: str) -> list[dict]:
    """CS_TXN:<digits> without branch prefix (legacy import marker)."""
    rows: list[dict] = []
    offset = 0
    page = 500
    while True:
        q = urllib.parse.urlencode(
            {
                "select": "id,bill_date,total,notes,items,patient_no,patient_name,clinic_tag",
                "notes": "like.CS_TXN:*",
                "order": "bill_date.desc",
                "limit": str(page),
                "offset": str(offset),
            }
        )
        batch = supabase_request("GET", url, key, f"/rest/v1/bills?{q}")
        if not batch:
            break
        for bill in batch:
            notes = bill.get("notes") or ""
            if re.search(r"CS_TXN:[A-Z0-9_]+:\d+", notes):
                continue
            if re.search(r"CS_TXN:\d", notes):
                rows.append(bill)
        if len(batch) < page:
            break
        offset += page
    return rows


def extract_txn(notes: str, branch: str) -> str | None:
    m = re.search(rf"CS_TXN:{re.escape(branch)}:(\d+)", notes or "")
    if m:
        return m.group(1)
    m = re.search(r"CS_TXN:(\d+)", notes or "")
    return m.group(1) if m else None


def extract_branch_from_bill(bill: dict) -> str:
    notes = bill.get("notes") or ""
    m = re.search(r"CS_TXN:([A-Z0-9_]+):", notes)
    if m:
        return m.group(1)
    pno = (bill.get("patient_no") or "").strip().upper()
    m = re.match(r"^([A-Z]{2,4})\d", pno)
    if m:
        return m.group(1)
    return (bill.get("clinic_tag") or "?").strip().upper() or "?"


def collect_csv_fixes(bills: list[dict], branch: str, by_txn: dict[str, list]) -> list[dict]:
    to_fix: list[dict] = []
    for bill in bills:
        txn = extract_txn(bill.get("notes") or "", branch)
        if not txn or txn not in by_txn:
            continue
        stored = parse_items(bill.get("items"))
        fixed = by_txn[txn]
        if json.dumps(stored, sort_keys=True) != json.dumps(fixed, sort_keys=True):
            to_fix.append(
                {
                    "id": bill["id"],
                    "branch": branch,
                    "txn": txn,
                    "patient_no": bill.get("patient_no") or "",
                    "name_en": bill.get("patient_name") or "",
                    "bill_date": bill.get("bill_date"),
                    "items": fixed,
                }
            )
    return to_fix


def collect_reconcile_fixes(bills: list[dict], branch_label: str) -> list[dict]:
    to_fix: list[dict] = []
    for bill in bills:
        stored = parse_items(bill.get("items"))
        if not stored:
            continue
        if stored and (stored[0].get("desc") or "") == "CS imported bill":
            continue
        total = float(bill.get("total") or 0)
        fixed = reconcile_items_to_bill_total(stored, total)
        if fixed and json.dumps(stored, sort_keys=True) != json.dumps(fixed, sort_keys=True):
            to_fix.append(
                {
                    "id": bill["id"],
                    "branch": branch_label,
                    "txn": extract_txn(bill.get("notes") or "", branch_label) or "",
                    "patient_no": bill.get("patient_no") or "",
                    "name_en": bill.get("patient_name") or "",
                    "bill_date": bill.get("bill_date"),
                    "items": fixed,
                    "old_sum": items_sum(stored),
                    "new_sum": items_sum(fixed),
                    "total": total,
                }
            )
    return to_fix


def apply_fixes(to_fix: list[dict], url: str, key: str) -> None:
    ok = 0
    for row in to_fix:
        q = urllib.parse.urlencode({"id": f"eq.{row['id']}"})
        supabase_request("PATCH", url, key, f"/rest/v1/bills?{q}", {"items": row["items"]})
        ok += 1
        if ok % 200 == 0 or ok == len(to_fix):
            print(f"  patched {ok}/{len(to_fix)}...")
    print(f"\nPatched {ok} bill(s).")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", help="Single branch e.g. KT, PL")
    ap.add_argument("--all-branches", action="store_true", help="All CS clinics + legacy markers")
    ap.add_argument("--mode", choices=("csv", "reconcile"), default="reconcile")
    ap.add_argument("--items", help="CS *_items.csv (required for --mode csv)")
    ap.add_argument("--dry-run", action="store_true", default=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--active-only", action="store_true", default=True)
    args = ap.parse_args()

    if not args.all_branches and not args.branch:
        raise SystemExit("Specify --branch <CODE> or --all-branches")
    if args.mode == "csv" and not args.items:
        raise SystemExit("--mode csv requires --items")

    url = os.environ.get("SUPABASE_URL", DEFAULT_URL)
    key = os.environ.get("SUPABASE_ANON_KEY", DEFAULT_ANON)
    mode_label = "APPLY" if args.apply else "DRY-RUN"

    if args.all_branches:
        branches = list(ALL_BRANCHES)
        include_legacy = True
    else:
        branches = [normalize_branch(args.branch)]
        include_legacy = False

    all_to_fix: list[dict] = []
    stats: dict[str, int] = {}

    if args.mode == "csv":
        branch = branches[0]
        items_path = Path(args.items)
        if not items_path.exists():
            raise SystemExit(f"Items CSV not found: {items_path}")
        by_txn = load_fixed_items_by_txn(items_path, args.active_only)
        bills = fetch_cs_bills(url, key, branch)
        fixes = collect_csv_fixes(bills, branch, by_txn)
        all_to_fix.extend(fixes)
        stats[branch] = len(fixes)
    else:
        seen_ids: set[str] = set()
        for branch in branches:
            bills = fetch_cs_bills(url, key, branch)
            fixes = collect_reconcile_fixes(bills, branch)
            for f in fixes:
                if f["id"] not in seen_ids:
                    seen_ids.add(f["id"])
                    all_to_fix.append(f)
            stats[branch] = len(fixes)
            print(f"  {branch}: {len(fixes)} bill(s) to fix (scanned {len(bills)})")

        if include_legacy:
            legacy_bills = fetch_legacy_cs_bills(url, key)
            fixes = collect_reconcile_fixes(legacy_bills, "LEGACY")
            n = 0
            for f in fixes:
                if f["id"] not in seen_ids:
                    seen_ids.add(f["id"])
                    all_to_fix.append(f)
                    n += 1
            stats["LEGACY"] = n
            print(f"  LEGACY: {n} bill(s) to fix (scanned {len(legacy_bills)})")

    print(f"\n=== {mode_label} reconcile/csv — {len(all_to_fix)} bill(s) total ===")
    for br, n in sorted(stats.items()):
        if n:
            print(f"  {br}: {n}")
    print()
    for row in all_to_fix[:40]:
        extra = ""
        if "old_sum" in row:
            extra = f"  items ${row['old_sum']:.2f}→${row['new_sum']:.2f} (total ${row['total']:.2f})"
        print(
            f"  {row.get('branch','?'):6} {row['patient_no']}  {row['name_en'][:28]:28}  "
            f"{row.get('txn','')}  {row.get('bill_date','')}{extra}"
        )
    if len(all_to_fix) > 40:
        print(f"  ... and {len(all_to_fix) - 40} more")

    if not args.apply:
        print("\nRe-run with --apply to PATCH Supabase bills.items")
        return

    apply_fixes(all_to_fix, url, key)


if __name__ == "__main__":
    main()
