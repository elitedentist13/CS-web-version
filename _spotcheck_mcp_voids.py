"""Spot-check 5 MCP CS-dup void cases: CS voided, Banana kept."""
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
COMBINED = Path(r"C:\Users\joyfu\Downloads\CS_MCP_ALL_dup_void_staging_for_supabase.csv")
REVIEW_X = Path(r"C:\Users\joyfu\Downloads\CS_MCP_bill_duplicate_conflicts.csv")
REVIEW_T = Path(r"C:\Users\joyfu\Downloads\CS_MCP_transfer_balance_conflicts.csv")


def get_one(path: str) -> dict | None:
    req = urllib.request.Request(
        BASE + "/" + path,
        headers={"apikey": ANON, "Authorization": f"Bearer {ANON}"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        rows = json.loads(resp.read().decode() or "[]")
    return rows[0] if rows else None


def get_all(path: str) -> list:
    req = urllib.request.Request(
        BASE + "/" + path,
        headers={"apikey": ANON, "Authorization": f"Bearer {ANON}"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode() or "[]")


def money(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def main() -> None:
    void_rows = list(csv.DictReader(COMBINED.open(encoding="utf-8-sig")))
    # Enrich from review CSVs if present
    extra: dict[str, dict] = {}
    for p in (REVIEW_X, REVIEW_T):
        if not p.exists():
            continue
        for r in csv.DictReader(p.open(encoding="utf-8-sig")):
            cid = r.get("cs_bill_id") or r.get("cs_id")
            if cid:
                extra[cid] = r

    # Prefer variety: 2 identical + 2 transfer_equal + 1 transfer_then_cs_installment
    by_reason: dict[str, list] = {}
    for r in void_rows:
        by_reason.setdefault(r.get("reason") or "?", []).append(r)

    picks: list[dict] = []
    for reason, n in (
        ("identical_duplicate", 2),
        ("transfer_equal_balance", 2),
        ("transfer_then_cs_installment", 1),
    ):
        for r in by_reason.get(reason, [])[:n]:
            picks.append(r)
    # fill to 5
    for r in void_rows:
        if r not in picks:
            picks.append(r)
        if len(picks) >= 5:
            break

    print(f"VOID_STAGING_TOTAL {len(void_rows)}")
    print(f"SPOTCHECKING {len(picks)} cases\n")

    # Also check staging table in supabase if populated
    staged = get_all("cs_bill_dup_void?select=cs_bill_id,nat_bill_id,reason,patient_no,voided_at")
    print(f"cs_bill_dup_void rows in Supabase: {len(staged)}\n")

    ok = 0
    for i, r in enumerate(picks, 1):
        cs_id = r["cs_bill_id"]
        nat_id = r["nat_bill_id"]
        reason = r.get("reason")
        pno = r.get("patient_no")
        ex = extra.get(cs_id, {})

        cs = get_one(
            f"bills?id=eq.{cs_id}&select=id,patient_no,patient_name,bill_date,total,"
            "amount_paid,balance,status,notes,voided_at"
        )
        nat = get_one(
            f"bills?id=eq.{nat_id}&select=id,patient_no,patient_name,bill_date,total,"
            "amount_paid,balance,status,notes,voided_at"
        )

        cs_voided = bool(cs and cs.get("voided_at"))
        cs_is_cs = "CS_TXN:" in ((cs or {}).get("notes") or "")
        nat_kept = bool(nat and not nat.get("voided_at"))
        nat_not_cs = "CS_TXN:" not in ((nat or {}).get("notes") or "")
        has_void_mark = "CS_DUP_VOID:" in ((cs or {}).get("notes") or "")

        verdict = (
            "PASS"
            if cs
            and nat
            and cs_voided
            and cs_is_cs
            and nat_kept
            and nat_not_cs
            else "FAIL"
        )
        if verdict == "PASS":
            ok += 1

        print(f"--- CASE {i} [{verdict}] reason={reason} patient={pno} ---")
        if not cs:
            print("  CS bill NOT FOUND")
        else:
            print(
                f"  CS  date={cs.get('bill_date')} total={cs.get('total')} "
                f"paid={cs.get('amount_paid')} bal={cs.get('balance')} "
                f"status={cs.get('status')} voided_at={cs.get('voided_at')}"
            )
            print(f"  CS  notes={(cs.get('notes') or '')[:120]}")
            print(f"  CS  void_mark={has_void_mark}")
        if not nat:
            print("  Banana bill NOT FOUND")
        else:
            print(
                f"  BAN date={nat.get('bill_date')} total={nat.get('total')} "
                f"paid={nat.get('amount_paid')} bal={nat.get('balance')} "
                f"status={nat.get('status')} voided_at={nat.get('voided_at')}"
            )
            print(f"  BAN notes={(nat.get('notes') or '')[:120]}")
            print(f"  BAN name={nat.get('patient_name')} patient_no={nat.get('patient_no')}")

        # gap context from review if available
        if ex:
            gap = ex.get("gap_nat_total_minus_cs_bal") or ex.get("gap")
            cs_bal = ex.get("cs_bal")
            nat_tot = ex.get("nat_total")
            if gap or cs_bal or nat_tot:
                print(
                    f"  CTX cs_bal={cs_bal} nat_total={nat_tot} gap={gap} "
                    f"first_banana_pay={ex.get('first_banana_pay')} "
                    f"after_cs_pays={ex.get('cs_pays_on_or_after_transfer')}"
                )
        print()

    print(f"SPOTCHECK_SUMMARY {ok}/{len(picks)} PASS")
    if ok < len(picks):
        print(
            "If FAIL with voided_at=null: void SQL §2 not run yet, "
            "or wrong staging imported."
        )


if __name__ == "__main__":
    main()
