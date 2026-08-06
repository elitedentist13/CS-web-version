"""Inspect remaining unmatched CWB payment staging rows."""
from __future__ import annotations

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
BATCH = "CWB_PAY_20260806_044357"
OUT = Path(r"C:\Users\joyfu\Downloads\CS_CWB_PaymentHistory_still_unmatched_48.csv")


def get_all(q: str) -> list:
    rows: list = []
    offset = 0
    page = 1000
    while True:
        url = f"{BASE}/{q}&limit={page}&offset={offset}"
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


def norm_hkid(h: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (h or "").upper())


def norm_clinic(c: str) -> str:
    return re.sub(r"[^A-Z0-9_-]", "", (c or "").strip().upper())


def money(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def main() -> None:
    um = get_all(
        "cs_payments_staging?batch_id=eq."
        + BATCH
        + "&import_status=eq.unmatched&select="
        "txn_code,bill_date,chart_no,hkid_raw,hkid_norm,name_en,name_other,"
        "net_hkd,received_hkd,balance_hkd,import_error,doctor_code,items_json"
    )
    print("UNMATCHED", len(um))
    print("ERROR", dict(Counter(r.get("import_error") for r in um)))
    print("blank_hkid", sum(1 for r in um if not (r.get("hkid_norm") or "").strip()))
    print(
        "zero_net",
        sum(1 for r in um if money(r.get("net_hkd")) <= 0.005),
    )
    print(
        "new_patient",
        sum(
            1
            for r in um
            if (r.get("name_en") or "").strip().upper() == "NEW PATIENT"
            or (r.get("chart_no") or "").strip() in ("000000", "0", "SKW000000")
        ),
    )

    pats = get_all("patients?select=id,patient_no,hkid,clinic_tag,full_name")
    by_hk: dict[str, list] = defaultdict(list)
    by_pno: dict[str, list] = defaultdict(list)
    for p in pats:
        hk = norm_hkid(p.get("hkid"))
        if hk:
            by_hk[hk].append(p)
        pno = (p.get("patient_no") or "").strip()
        if pno:
            by_pno[pno].append(p)

    buckets = Counter()
    detail_rows = []
    for r in um:
        hk = r.get("hkid_norm") or ""
        chart = (r.get("chart_no") or "").strip()
        name = (r.get("name_en") or "").strip()
        hits_hk = by_hk.get(hk, []) if hk else []
        hits_chart = by_pno.get(chart, []) if chart else []
        pref = f"CWB{chart}" if chart else ""
        hits_pref = by_pno.get(pref, []) if pref else []

        if chart in ("000000", "0", "SKW000000") or name.upper() == "NEW PATIENT":
            bucket = "placeholder_new_patient"
        elif not hk and not hits_chart and not hits_pref:
            bucket = "no_identity_in_banana"
        elif hits_hk and len({p["id"] for p in hits_hk}) > 1:
            bucket = "ambiguous_hkid_multiple_patients"
        elif hits_hk and not any(norm_clinic(p.get("clinic_tag")) in ("CWB", "") for p in hits_hk):
            bucket = "hkid_only_other_clinic"
        elif not hits_hk and (hits_chart or hits_pref):
            bucket = "chart_exists_but_not_matched"  # unexpected leftover
        elif not hits_hk:
            bucket = "hkid_not_in_banana"
        else:
            bucket = "other"

        buckets[bucket] += 1
        banana_hint = ""
        samples = hits_hk or hits_chart or hits_pref
        if samples:
            banana_hint = " | ".join(
                f"{p.get('patient_no')}/{p.get('clinic_tag') or 'blank'}/{p.get('full_name')}"
                for p in samples[:3]
            )
        detail_rows.append(
            {
                "txn_code": r.get("txn_code"),
                "bill_date": r.get("bill_date"),
                "chart_no": chart,
                "hkid_raw": r.get("hkid_raw"),
                "hkid_norm": hk,
                "name_en": name,
                "net_hkd": r.get("net_hkd"),
                "received_hkd": r.get("received_hkd"),
                "import_error": r.get("import_error"),
                "bucket": bucket,
                "banana_candidates": banana_hint,
                "has_items": "Y" if (r.get("items_json") or "").strip() else "N",
            }
        )

    print("BUCKETS", dict(buckets))
    print("--- samples by bucket ---")
    shown = Counter()
    for row in detail_rows:
        b = row["bucket"]
        if shown[b] >= 5:
            continue
        shown[b] += 1
        print(
            f"[{b}] {row['txn_code']} {row['chart_no']} {row['hkid_norm']} "
            f"{row['name_en'][:30]} net={row['net_hkd']} -> {row['banana_candidates'][:100]}"
        )

    fields = list(detail_rows[0].keys()) if detail_rows else []
    with OUT.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(detail_rows)
    print("OUT", OUT)


if __name__ == "__main__":
    main()
