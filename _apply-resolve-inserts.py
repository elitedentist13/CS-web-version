"""Apply resolve staging CSVs from resolve_report.json into Banana via anon REST."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

# Reuse helpers from the export/resolve driver
import importlib.util

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "export_resolve", ROOT / "_export-and-resolve-unmatched.py"
)
mod = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(mod)


def main() -> None:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Downloads" / "CS_resolve_20260811"
    skip_pay = set()
    for a in sys.argv[2:]:
        if a.startswith("--skip-pay="):
            skip_pay.update(x.strip() for x in a.split("=", 1)[1].split(",") if x.strip())
    report_path = out_dir / "resolve_report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    print("OUT_DIR", out_dir)

    # Existing pending KT resolve
    pending = mod.get_all("cs_payments_staging?import_status=eq.pending&select=batch_id")
    pending_batches = sorted({r.get("batch_id") for r in pending if r.get("batch_id") and "RESOLVE" in r.get("batch_id", "").upper()})
    for pb in pending_batches:
        if pb in skip_pay:
            print("SKIP pending", pb)
            continue
        print("\n==== PENDING RESOLVE", pb, "====")
        mod.apply_existing_pending_resolve(pb)

    for item in report.get("payment_resolve_batches") or []:
        batch_id = item["batch_id"]
        if batch_id in skip_pay:
            print("SKIP pay batch", batch_id)
            continue
        staging = Path(item["staging"])
        if not staging.exists():
            print("MISSING", staging)
            continue
        # skip empty staging
        rows = mod.load_csv_rows(staging)
        if not rows:
            print("SKIP empty", batch_id)
            continue
        # If staging already fully terminal in DB, skip re-upload
        existing = mod.get_all(
            f"cs_payments_staging?batch_id=eq.{batch_id}&select=import_status"
        )
        if existing:
            st = Counter(r.get("import_status") for r in existing)
            if st.get("matched", 0) == 0 and st.get("pending", 0) == 0 and (
                st.get("inserted", 0) + st.get("skipped_dup", 0) >= len(rows) * 0.9
            ):
                print("SKIP already applied", batch_id, dict(st))
                continue
            if st.get("matched", 0) > 0 and st.get("pending", 0) == 0:
                print("\n==== PAY INSERT (resume matched)", batch_id, dict(st), "====")
                mod.set_batch_param(batch_id)
                mod.insert_matched_payments(batch_id)
                continue
        print("\n==== PAY INSERT", batch_id, "rows=", len(rows), "====")
        mod.set_batch_param(batch_id)
        mod.upload_payment_resolve(batch_id, staging)
        mod.apply_payment_resolve_matches(batch_id)
        mod.insert_matched_payments(batch_id)

    for item in report.get("notes_resolve_batches") or []:
        batch_id = item["batch_id"]
        staging = Path(item["staging"])
        if not staging.exists():
            print("MISSING", staging)
            continue
        rows = mod.load_csv_rows(staging)
        if not rows:
            print("SKIP empty notes", batch_id)
            continue
        print("\n==== NOTES UPLOAD", batch_id, "rows=", len(rows), "====")
        try:
            mod.set_batch_param(batch_id)
        except Exception as e:
            print("WARN set batch", e)
        mod.upload_notes_resolve(batch_id, staging)
        mod.apply_notes_resolve_and_insert(batch_id)

    print("\nDONE apply inserts")


if __name__ == "__main__":
    main()
