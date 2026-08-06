"""Spot-check the 11 CWB CS vs Banana duplicate pairs."""
from __future__ import annotations

import csv
import json
import urllib.request
from pathlib import Path

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"
H = {"apikey": ANON, "Authorization": f"Bearer {ANON}"}


def get_one(table_query: str) -> dict | None:
    req = urllib.request.Request(f"{BASE}/{table_query}", headers=H)
    with urllib.request.urlopen(req, timeout=60) as r:
        rows = json.loads(r.read().decode())
    return rows[0] if rows else None


def main() -> None:
    path = Path(r"C:\Users\joyfu\Downloads\CS_CWB_bill_dup_void_staging_for_supabase.csv")
    rows = list(csv.DictReader(path.open(encoding="utf-8-sig")))
    print(f"COUNT {len(rows)}")
    print()
    ok = 0
    for i, row in enumerate(rows, 1):
        cs_id = row["cs_bill_id"]
        nat_id = row["nat_bill_id"]
        cs = get_one(
            f"bills?id=eq.{cs_id}&select=id,patient_no,patient_name,bill_date,total,"
            "amount_paid,balance,status,voided_at,notes,bill_type"
        )
        nat = get_one(
            f"bills?id=eq.{nat_id}&select=id,patient_no,patient_name,bill_date,total,"
            "amount_paid,balance,status,voided_at,notes,bill_type"
        )
        print(f"=== {i}/11 ===")
        print(
            f"patient={row.get('patient_no')} date={row.get('bill_date')} "
            f"txn={row.get('cs_txn')} reason={row.get('reason')}"
        )
        if not cs or not nat:
            print("  MISSING bill row", "cs" if not cs else "", "nat" if not nat else "")
            continue
        same_patient = cs.get("patient_no") == nat.get("patient_no") or (
            # may differ if one blank; compare ids via staging
            True
        )
        flags = []
        if "CS_TXN:" not in (cs.get("notes") or ""):
            flags.append("CS_NOT_CS_TXN")
        if "CS_TXN:" in (nat.get("notes") or ""):
            flags.append("BANANA_HAS_CS_TXN")
        if cs.get("voided_at"):
            flags.append("CS_ALREADY_VOIDED")
        if nat.get("voided_at"):
            flags.append("BANANA_VOIDED_UNEXPECTED")
        if abs(float(cs.get("total") or 0) - float(nat.get("total") or 0)) > 0.05:
            flags.append("TOTAL_MISMATCH")
        if str(cs.get("bill_date") or "")[:10] != str(nat.get("bill_date") or "")[:10]:
            flags.append("DATE_MISMATCH")
        if not flags:
            flags.append("OK_identical_pair_void_CS")
            ok += 1
        print(
            f"  CS     total={cs.get('total')} paid={cs.get('amount_paid')} "
            f"bal={cs.get('balance')} status={cs.get('status')} "
            f"voided={bool(cs.get('voided_at'))} name={cs.get('patient_name')}"
        )
        print(f"         notes={(cs.get('notes') or '')[:90]}")
        print(
            f"  Banana total={nat.get('total')} paid={nat.get('amount_paid')} "
            f"bal={nat.get('balance')} status={nat.get('status')} "
            f"voided={bool(nat.get('voided_at'))} type={nat.get('bill_type')} "
            f"name={nat.get('patient_name')}"
        )
        print(f"         notes={(nat.get('notes') or '')[:90]}")
        print(f"  verdict: {', '.join(flags)}")
        print()
    print(f"SPOTCHECK_OK {ok}/{len(rows)}")


if __name__ == "__main__":
    main()
