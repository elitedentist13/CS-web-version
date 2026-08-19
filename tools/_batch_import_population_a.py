"""Batch-upload population A: CS charts that already have a plain
top-level real-panoramic JPEG under \\RECEPTION\IMAGE\SCAN\{chart}\ (no
proprietary decode needed -- see _census-opg-population.py bucket A).

Reuses the exact same extraction + Supabase upload contract validated on
WONG SHUM YING (_import_cs_opg.py): same bucket, same table, same field
names as app-xray.js's uploadSingleXrayFile.

Safe to re-run: skips any chart whose Supabase patient already has an
xrays row uploaded by this script (matched via uploaded_by field).

Usage:
    python _batch_import_population_a.py --dry-run     # plan only
    python _batch_import_population_a.py --commit       # actually upload
"""
from __future__ import annotations

import argparse
import os
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _import_cs_opg as core  # noqa: E402

CHART_LIST_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_opg_population_A.txt")
UPLOADED_BY_TAG = "CS import script"


def already_imported(patient_id: str) -> bool:
    tag = urllib.parse.quote(UPLOADED_BY_TAG)
    rows = core.sb_get(
        f"/rest/v1/xrays?patient_id=eq.{patient_id}&uploaded_by=eq.{tag}&select=id&limit=1"
    )
    return bool(rows)


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true")
    g.add_argument("--commit", action="store_true")
    ap.add_argument("--limit", type=int, default=None, help="only process the first N charts (testing)")
    ap.add_argument("--sleep", type=float, default=0.3, help="seconds to sleep between charts")
    args = ap.parse_args()

    with open(CHART_LIST_FILE, "r", encoding="utf-8") as f:
        charts = [line.strip() for line in f if line.strip()]
    if args.limit:
        charts = charts[: args.limit]

    print(f"charts to process: {len(charts)}  mode={'DRY RUN' if args.dry_run else 'COMMIT'}")

    counts = {"uploaded": 0, "already_imported": 0, "no_patient": 0, "error": 0}
    errors = []

    for i, chart_no in enumerate(charts, 1):
        try:
            patient = core.find_patient(chart_no)
            if not patient:
                counts["no_patient"] += 1
                continue

            if already_imported(patient["id"]):
                counts["already_imported"] += 1
                continue

            jpeg_bytes, source, taken_date = core.extract_opg(chart_no)

            if args.dry_run:
                print(f"[{i}/{len(charts)}] {chart_no} -> would upload {len(jpeg_bytes)} bytes ({source})")
                counts["uploaded"] += 1
                continue

            core.upload_opg(
                patient,
                jpeg_bytes,
                taken_date,
                notes=f"Imported from CS ({source})",
                dry_run=False,
            )
            print(f"[{i}/{len(charts)}] {chart_no} -> uploaded ({len(jpeg_bytes)} bytes)")
            counts["uploaded"] += 1
        except Exception as e:  # noqa: BLE001
            counts["error"] += 1
            errors.append((chart_no, str(e)))
            print(f"[{i}/{len(charts)}] {chart_no} -> ERROR: {e}")

        time.sleep(args.sleep)

    print("\n=== SUMMARY ===")
    for k, v in counts.items():
        print(f"{k}: {v}")
    if errors:
        print("\nerrors:")
        for chart_no, msg in errors:
            print(f"  {chart_no}: {msg}")


if __name__ == "__main__":
    main()
