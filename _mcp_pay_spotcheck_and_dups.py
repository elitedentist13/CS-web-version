"""MCP payments: spot-check inserts + find CS dups for void (Banana wins)."""
from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"
ROOT = Path(__file__).resolve().parent
OUT = Path(r"C:\Users\joyfu\Downloads")
BATCH = "MCP_PAY_20260812_210520"
RESOLVE_BATCH = "MCP_PAY_RESOLVE_20260812_211420"


def get_all(q: str, page: int = 1000) -> list:
    rows: list = []
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
        with urllib.request.urlopen(req, timeout=180) as resp:
            chunk = json.loads(resp.read().decode() or "[]")
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


def spotcheck() -> None:
    print("=== SPOT CHECK MCP PAYMENT INSERTS ===")
    for batch in (BATCH, RESOLVE_BATCH):
        rows = get_all(
            f"cs_payments_staging?batch_id=eq.{urllib.parse.quote(batch)}"
            "&select=import_status,match_method,import_error,txn_code,"
            "chart_no,name_en,net_hkd,received_hkd,matched_patient_id,inserted_bill_id"
        )
        if not rows:
            print(f"BATCH {batch}: (no rows / not imported yet)")
            continue
        print(f"BATCH {batch} TOTAL={len(rows)}")
        print("  BY_STATUS", dict(Counter(r.get("import_status") or "?" for r in rows)))

    inserted = get_all(
        f"cs_payments_staging?batch_id=eq.{urllib.parse.quote(BATCH)}"
        "&import_status=eq.inserted"
        "&select=txn_code,chart_no,name_en,net_hkd,received_hkd,matched_patient_id,"
        "inserted_bill_id,banana_clinic_tag&order=net_hkd.desc"
    )
    # pick 5 varied: high net, mid, with payments
    picks = []
    for r in inserted:
        if r.get("inserted_bill_id") and r not in picks:
            picks.append(r)
        if len(picks) >= 5:
            break
    # also pull a couple by chart from resolve map patterns
    print(f"\nSpot-checking {len(picks)} high-value inserted bills…")
    ok = 0
    for i, s in enumerate(picks, 1):
        pid = s.get("matched_patient_id")
        bid = s.get("inserted_bill_id")
        txn = (s.get("txn_code") or "").strip()
        pt = get_all(
            f"patients?id=eq.{pid}&select=patient_no,full_name,clinic_tag"
        )
        p = pt[0] if pt else {}
        bills = get_all(
            f"bills?id=eq.{bid}&select=id,patient_id,total,amount_paid,balance,"
            "status,notes,bill_date,voided_at,clinic_tag"
        )
        b = bills[0] if bills else {}
        pays = get_all(
            f"bill_payments?bill_id=eq.{bid}&select=id,amount,method,paid_date,notes"
        )
        notes = b.get("notes") or ""
        has_txn = f"CS_TXN:MCP:{txn}" in notes or f"CS_TXN:{txn}" in notes
        tot_ok = abs(money(b.get("total")) - money(s.get("net_hkd"))) <= 0.05
        pid_ok = b.get("patient_id") == pid
        not_void = not b.get("voided_at")
        verdict = "PASS" if (b and has_txn and tot_ok and pid_ok and not_void) else "FAIL"
        if verdict == "PASS":
            ok += 1
        print(f"--- CASE {i} [{verdict}] ---")
        print(
            f"patient={p.get('patient_no')} {p.get('full_name')} "
            f"txn={txn} chart={s.get('chart_no')}"
        )
        print(
            f"staging net={s.get('net_hkd')} recv={s.get('received_hkd')} | "
            f"bill total={b.get('total')} paid={b.get('amount_paid')} "
            f"bal={b.get('balance')} status={b.get('status')} pays={len(pays)}"
        )
        print(f"notes={notes[:100]}")
        print()
    print(f"SPOTCHECK_SUMMARY {ok}/{len(picks)} PASS\n")


def main() -> None:
    spotcheck()

    print("=== EXACT DUPLICATES (same patient+date+total) ===")
    subprocess.check_call(
        [
            sys.executable,
            str(ROOT / "find-cs-bill-duplicates.py"),
            "--branch",
            "MCP",
            "--clinic-tag",
            "MCP",
            "--include-related-review",
            "--out-dir",
            str(OUT),
        ]
    )

    print("\n=== TRANSFER-BALANCE DUPLICATES (gap $1000 / gap=first Banana pay / repeats) ===")
    subprocess.check_call(
        [
            sys.executable,
            str(ROOT / "find-cs-transfer-balance-duplicates.py"),
            "--branch",
            "MCP",
            "--clinic-tag",
            "MCP",
            "--out-dir",
            str(OUT),
            "--append-master-log",
        ]
    )


if __name__ == "__main__":
    main()
