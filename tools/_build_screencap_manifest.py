"""Build a JSON manifest of population-B patients to process via the NNT
screen-capture pipeline (see _batch_screencap_nnt.ps1 + _upload_screencaps.py).

Looks each chart up in Supabase (same contract as _import_cs_opg.py),
skips charts with no matching Banana patient, and skips patients that
already have a screencap import (so this is safe to re-run/extend).

Usage:
    python _build_screencap_manifest.py --limit 25 --out _screencap_manifest.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _import_cs_opg as core  # noqa: E402

CHART_LIST_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_opg_population_B.txt")
UPLOADED_BY_TAG = "CS import script (NNT screencap)"


def find_patient_full(chart_no: str):
    digits = re.sub(r"\D", "", chart_no).zfill(6)
    q = (
        "/rest/v1/patients?select=id,patient_no,full_name,chinese_name,dob,sex"
        f"&or=(patient_no.eq.{digits},patient_no.eq.PY{digits})"
    )
    rows = core.sb_get(q)
    return rows[0] if rows else None


def already_imported(patient_id: str) -> bool:
    tag = urllib.parse.quote(UPLOADED_BY_TAG)
    rows = core.sb_get(
        f"/rest/v1/xrays?patient_id=eq.{patient_id}&uploaded_by=eq.{tag}&select=id&limit=1"
    )
    return bool(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--skip", type=int, default=0, help="skip the first N charts (for paging through the list)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "_screencap_manifest.json"))
    args = ap.parse_args()

    with open(CHART_LIST_FILE, "r", encoding="utf-8") as f:
        all_charts = [line.strip() for line in f if line.strip()]

    charts = all_charts[args.skip:]
    manifest = []
    checked = 0
    for chart_no in charts:
        if len(manifest) >= args.limit:
            break
        checked += 1
        patient = find_patient_full(chart_no)
        if not patient:
            print(f"skip {chart_no}: no Supabase patient")
            continue
        if already_imported(patient["id"]):
            print(f"skip {chart_no}: already has a screencap import")
            continue
        manifest.append({
            "chart_no": chart_no,
            "patient_id": patient["id"],
            "patient_no": patient["patient_no"],
            "patient_name": patient.get("full_name") or "",
            "chinese_name": patient.get("chinese_name") or "",
            "dob": patient.get("dob") or "",
            "sex": patient.get("sex") or "",
        })
        print(f"queued {chart_no}: {patient.get('full_name')}")

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"\nWrote {len(manifest)} entries (checked {checked} charts) -> {args.out}")


if __name__ == "__main__":
    main()
