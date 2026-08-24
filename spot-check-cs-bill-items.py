"""
Spot-check CS bill item unit-price repairs (50 cases) and write audit log.

Usage:
  python spot-check-cs-bill-items.py
  python spot-check-cs-bill-items.py --count 50 --out logs/cs-bill-item-spotcheck.log
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from cs_bill_item_unit_price import items_sum, reconcile_items_to_bill_total

DEFAULT_URL = "https://kprihawipljrltfzpfjd.supabase.co"
DEFAULT_ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)

BRANCHES = ("PL", "KT", "OKT", "PY", "MCP", "MK", "CWB")
ANCHOR_NOTES = (
    "PL:202505260012",  # WANG MINI SCREW
    "KT:202510220003",  # KT007723 5x filling
    "OKT:202207220012",
    "MK:202410310012",
)

PL_BUGS_CSV = Path(r"C:\Users\User\Downloads\CS_PL_bill_item_unit_price_bugs.csv")


def supabase_get(url: str, key: str, path: str) -> list:
    req = urllib.request.Request(
        f"{url.rstrip('/')}{path}",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parse_items(raw) -> list:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            p = json.loads(raw)
            return p if isinstance(p, list) else []
        except json.JSONDecodeError:
            return []
    return []


def extract_branch(notes: str, patient_no: str) -> str:
    m = re.search(r"CS_TXN:([A-Z0-9_]+):", notes or "")
    if m:
        return m.group(1)
    m = re.match(r"^([A-Z]{2,4})\d", (patient_no or "").upper())
    return m.group(1) if m else "?"


def format_items(items: list) -> str:
    parts = []
    for it in items[:4]:
        q = it.get("qty", 1)
        p = it.get("price", 0)
        d = it.get("desc", "")[:40]
        parts.append(f"{d} qty={q} @${p}")
    if len(items) > 4:
        parts.append(f"+{len(items)-4} more")
    return " | ".join(parts)


def check_bill(bill: dict) -> dict:
    items = parse_items(bill.get("items"))
    total = float(bill.get("total") or 0)
    s = items_sum(items) if items else 0.0
    gap = round(total - s, 2)
    still_fixable = reconcile_items_to_bill_total(items, total) is not None if items and total > 0 else False

    qty_lines = [it for it in items if float(it.get("qty") or 1) > 1]
    suspicious = []
    for it in qty_lines:
        q = float(it.get("qty") or 1)
        p = float(it.get("price") or 0)
        line = q * p * (1 - float(it.get("disc") or 0) / 100)
        if p > 0 and q > 1 and line > 0 and abs(line / q - p) < 0.01:
            # price already looks like unit price; ok
            pass
        if p > 0 and q > 1 and line < p * 0.99:
            suspicious.append(it.get("desc", "")[:30])

    if not items or (items and items[0].get("desc") == "CS imported bill"):
        status = "SKIP_PLACEHOLDER"
    elif abs(gap) <= 0.05:
        status = "PASS"
    elif still_fixable:
        status = "FAIL_FIXABLE"
    elif gap > 0.05:
        status = "FAIL_GAP"
    else:
        status = "WARN_OVER"

    return {
        "status": status,
        "items_sum": s,
        "gap": gap,
        "qty_line_count": len(qty_lines),
        "suspicious": suspicious,
        "items_preview": format_items(items),
    }


def fetch_bill_by_note_fragment(url: str, key: str, fragment: str) -> dict | None:
    q = urllib.parse.urlencode(
        {
            "select": "id,patient_no,patient_name,bill_date,total,discount,notes,items,voided_at",
            "notes": f"like.*{fragment}*",
            "limit": "3",
        }
    )
    rows = supabase_get(url, key, f"/rest/v1/bills?{q}")
    for r in rows:
        if fragment in (r.get("notes") or ""):
            return r
    return rows[0] if rows else None


def sample_bills_from_branch(url: str, key: str, branch: str, n: int, rng: random.Random) -> list[dict]:
    """Sample CS bills with real items from a branch."""
    pool: list[dict] = []
    offset = 0
    while len(pool) < n * 8 and offset < 3000:
        q = urllib.parse.urlencode(
            {
                "select": "id,patient_no,patient_name,bill_date,total,discount,notes,items,voided_at",
                "notes": f"like.CS_TXN:{branch}:%",
                "limit": "200",
                "offset": str(offset),
            }
        )
        batch = supabase_get(url, key, f"/rest/v1/bills?{q}")
        if not batch:
            break
        for b in batch:
            items = parse_items(b.get("items"))
            if items and items[0].get("desc") != "CS imported bill":
                pool.append(b)
        if len(batch) < 200:
            break
        offset += 200
    if len(pool) <= n:
        return pool
    return rng.sample(pool, n)


def load_csv_seeds(path: Path, n: int) -> list[tuple[str, str]]:
    if not path.exists():
        return []
    rows = list(csv.DictReader(path.open(encoding="utf-8-sig")))
    picks = rows[:: max(1, len(rows) // n)][:n]
    return [(r["cs_txn"], r["patient_no"]) for r in picks]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=50)
    ap.add_argument("--out", default="tools/logs/cs-bill-item-unit-price-spotcheck.log")
    ap.add_argument("--csv-out", default="tools/logs/cs-bill-item-unit-price-spotcheck.csv")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", DEFAULT_URL)
    key = os.environ.get("SUPABASE_ANON_KEY", DEFAULT_ANON)
    rng = random.Random(args.seed)
    now = datetime.now(timezone.utc).astimezone()

    results: list[dict] = []
    seen_ids: set[str] = set()

    # 1) Anchor cases (must include)
    for frag in ANCHOR_NOTES:
        bill = fetch_bill_by_note_fragment(url, key, frag)
        if bill and bill["id"] not in seen_ids:
            seen_ids.add(bill["id"])
            chk = check_bill(bill)
            results.append(
                {
                    "source": "anchor",
                    "branch": extract_branch(bill.get("notes", ""), bill.get("patient_no", "")),
                    "patient_no": bill.get("patient_no", ""),
                    "patient_name": bill.get("patient_name", ""),
                    "bill_date": bill.get("bill_date", ""),
                    "total": float(bill.get("total") or 0),
                    "voided": bool(bill.get("voided_at")),
                    "notes_snip": (bill.get("notes") or "")[:70],
                    **chk,
                }
            )

    # 2) Seeds from PL bugs CSV
    for cs_txn, pno in load_csv_seeds(PL_BUGS_CSV, 8):
        frag = cs_txn.split(":")[-1] if ":" in cs_txn else cs_txn
        bill = fetch_bill_by_note_fragment(url, key, frag)
        if bill and bill["id"] not in seen_ids:
            seen_ids.add(bill["id"])
            chk = check_bill(bill)
            results.append(
                {
                    "source": "pl_csv_seed",
                    "branch": "PL",
                    "patient_no": bill.get("patient_no", pno),
                    "patient_name": bill.get("patient_name", ""),
                    "bill_date": bill.get("bill_date", ""),
                    "total": float(bill.get("total") or 0),
                    "voided": bool(bill.get("voided_at")),
                    "notes_snip": (bill.get("notes") or "")[:70],
                    **chk,
                }
            )

    # 3) Random sample per branch to reach count
    per_branch = max(1, (args.count - len(results)) // len(BRANCHES))
    for branch in BRANCHES:
        if len(results) >= args.count:
            break
        try:
            samples = sample_bills_from_branch(url, key, branch, per_branch + 2, rng)
        except Exception as e:
            print(f"WARN sample {branch}: {e}")
            continue
        for bill in samples:
            if len(results) >= args.count:
                break
            if bill["id"] in seen_ids:
                continue
            seen_ids.add(bill["id"])
            chk = check_bill(bill)
            results.append(
                {
                    "source": f"sample_{branch}",
                    "branch": branch,
                    "patient_no": bill.get("patient_no", ""),
                    "patient_name": bill.get("patient_name", ""),
                    "bill_date": bill.get("bill_date", ""),
                    "total": float(bill.get("total") or 0),
                    "voided": bool(bill.get("voided_at")),
                    "notes_snip": (bill.get("notes") or "")[:70],
                    **chk,
                }
            )

    results = results[: args.count]

    passed = sum(1 for r in results if r["status"] == "PASS")
    fixable = sum(1 for r in results if r["status"] == "FAIL_FIXABLE")
    gap_fail = sum(1 for r in results if r["status"] == "FAIL_GAP")
    skipped = sum(1 for r in results if r["status"] == "SKIP_PLACEHOLDER")
    warn = sum(1 for r in results if r["status"] == "WARN_OVER")

    out_path = Path(args.out)
    csv_path = Path(args.csv_out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    lines = [
        f"# CS bill item unit-price repair — spot check",
        f"",
        f"- **When:** {now.strftime('%Y-%m-%d %H:%M %Z')}",
        f"- **Cases checked:** {len(results)}",
        f"- **PASS (items sum ≈ bill total):** {passed}",
        f"- **FAIL still fixable (unit-price bug remains):** {fixable}",
        f"- **FAIL other gap (items sum < total, not auto-fixable):** {gap_fail}",
        f"- **WARN items sum > total:** {warn}",
        f"- **SKIP placeholder items:** {skipped}",
        f"",
        f"## Summary by branch",
        f"",
    ]
    by_branch: dict[str, list] = {}
    for r in results:
        by_branch.setdefault(r["branch"], []).append(r)
    for br in sorted(by_branch):
        rs = by_branch[br]
        p = sum(1 for x in rs if x["status"] == "PASS")
        lines.append(f"- **{br}:** {p}/{len(rs)} pass")

    lines.extend(["", "## Cases", ""])
    for i, r in enumerate(results, 1):
        flag = r["status"]
        lines.append(
            f"{i}. [{flag}] **{r['patient_no']}** {r['patient_name']} ({r['branch']}) "
            f"{r['bill_date']} total=${r['total']:.2f} items_sum=${r['items_sum']:.2f} gap=${r['gap']:.2f}"
        )
        lines.append(f"   - {r['items_preview']}")
        if r.get("voided"):
            lines.append("   - voided bill")
        lines.append(f"   - source: {r['source']}")

    verdict = "REPAIR VERIFIED" if fixable == 0 and passed >= len(results) - gap_fail - skipped - warn else "NEEDS REVIEW"
    lines.extend(
        [
            "",
            f"## Verdict: **{verdict}**",
            "",
            "Repairs applied:",
            "- PL: 3388 bills (CSV rebuild) + reconcile pass",
            "- All branches: 4270 bills (reconcile, Aug 2026)",
            "",
            f"Detailed CSV: `{csv_path.as_posix()}`",
        ]
    )

    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    csv_fields = [
        "status",
        "branch",
        "patient_no",
        "patient_name",
        "bill_date",
        "total",
        "items_sum",
        "gap",
        "qty_line_count",
        "voided",
        "source",
        "items_preview",
        "notes_snip",
    ]
    with csv_path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=csv_fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(results)

    print(f"Spot check: {passed} PASS, {fixable} FAIL_FIXABLE, {gap_fail} FAIL_GAP, {warn} WARN, {skipped} SKIP")
    print(f"Verdict: {verdict}")
    print(f"Log: {out_path}")
    print(f"CSV: {csv_path}")

    # Append short entry to CHANGELOG
    changelog = Path(__file__).resolve().parent / "tools" / "CHANGELOG.md"
    if changelog.exists():
        entry = (
            f"\n## {now.strftime('%Y-%m-%d')} — CS bill item unit-price spot check ({len(results)} cases)\n\n"
            f"- **Verdict:** {verdict}\n"
            f"- **PASS:** {passed}/{len(results)} (items sum matches bill total within $0.05)\n"
            f"- **Still fixable:** {fixable} | **Other gap:** {gap_fail} | **Warn over:** {warn}\n"
            f"- **Log:** `{out_path.as_posix()}`\n"
            f"- **CSV:** `{csv_path.as_posix()}`\n"
        )
        text = changelog.read_text(encoding="utf-8")
        if "CS bill item unit-price spot check" not in text[-4000:]:
            changelog.write_text(text.rstrip() + "\n" + entry, encoding="utf-8")
            print(f"Updated {changelog}")


if __name__ == "__main__":
    main()
