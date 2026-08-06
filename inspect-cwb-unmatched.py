"""Inspect CWB notes staging match results."""
from __future__ import annotations

import json
import re
import urllib.request
from collections import Counter, defaultdict

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"
BATCH = "CWB_20260806_035924"


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


def norm_hkid(h: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (h or "").upper())


def norm_clinic(c: str) -> str:
    return re.sub(r"[^A-Z0-9_-]", "", (c or "").strip().upper())


def main() -> None:
    rows = get_all(
        "cs_notes_staging?batch_id=eq."
        + BATCH
        + "&select=import_status,match_method,import_error,banana_clinic_tag,"
        "hkid_norm,chart_no,name_en"
    )
    print("TOTAL", len(rows))
    print("STATUS", dict(Counter(r.get("import_status") for r in rows)))
    print(
        "MATCH",
        dict(Counter((r.get("import_status"), r.get("match_method")) for r in rows)),
    )
    um = [r for r in rows if r.get("import_status") == "unmatched"]
    print("UNMATCHED", len(um))
    print("ERROR", dict(Counter(r.get("import_error") for r in um)))
    print("blank_hkid", sum(1 for r in um if not (r.get("hkid_norm") or "").strip()))
    print("sample", [(r.get("chart_no"), r.get("hkid_norm"), r.get("name_en")) for r in um[:20]])

    pats = get_all("patients?select=id,patient_no,hkid,clinic_tag,full_name")
    print("ALL_PATIENTS", len(pats))
    print("CLINIC_TAGS", dict(Counter(norm_clinic(p.get("clinic_tag")) for p in pats)))

    cwb = [p for p in pats if norm_clinic(p.get("clinic_tag")) == "CWB"]
    print("CWB_PATIENTS", len(cwb))

    by_hk = defaultdict(list)
    by_pno = defaultdict(list)
    for p in pats:
        hk = norm_hkid(p.get("hkid"))
        if hk:
            by_hk[hk].append(p)
        pno = (p.get("patient_no") or "").strip()
        if pno:
            by_pno[pno].append(p)

    # Why unmatched? HKID exists elsewhere?
    hk_other = 0
    hk_cwb = 0
    hk_none = 0
    chart_cwb = 0
    chart_any = 0
    for r in um:
        hk = r.get("hkid_norm") or ""
        chart = (r.get("chart_no") or "").strip()
        pref = f"CWB{chart}" if chart else ""
        hits = by_hk.get(hk, []) if hk else []
        if not hits:
            hk_none += 1
        elif any(norm_clinic(p.get("clinic_tag")) == "CWB" for p in hits):
            hk_cwb += 1
        else:
            hk_other += 1
        if chart and (
            by_pno.get(chart) or by_pno.get(pref)
        ):
            chart_any += 1
            if any(
                norm_clinic(p.get("clinic_tag")) == "CWB"
                for p in (by_pno.get(chart, []) + by_pno.get(pref, []))
            ):
                chart_cwb += 1

    print("unmatched_hkid_none", hk_none)
    print("unmatched_hkid_in_CWB", hk_cwb)
    print("unmatched_hkid_other_clinic", hk_other)
    print("unmatched_chart_any_patient", chart_any)
    print("unmatched_chart_CWB_patient", chart_cwb)

    # Sample: HKID exists but wrong clinic
    shown = 0
    print("--- sample unmatched with HKID in other clinic ---")
    for r in um:
        hk = r.get("hkid_norm") or ""
        if not hk:
            continue
        hits = by_hk.get(hk, [])
        if hits and not any(norm_clinic(p.get("clinic_tag")) == "CWB" for p in hits):
            print(
                r.get("chart_no"),
                hk,
                r.get("name_en"),
                "->",
                [
                    (p.get("patient_no"), p.get("clinic_tag"), p.get("full_name"))
                    for p in hits[:3]
                ],
            )
            shown += 1
            if shown >= 15:
                break


if __name__ == "__main__":
    main()
