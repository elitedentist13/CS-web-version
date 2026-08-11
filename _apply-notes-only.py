"""Resume notes resolve apply/insert from resolve_report.json (payments already done)."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "export_resolve", ROOT / "_export-and-resolve-unmatched.py"
)
mod = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(mod)


def main() -> None:
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Downloads" / "CS_resolve_20260811"
    report = json.loads((out_dir / "resolve_report.json").read_text(encoding="utf-8"))
    start_from = sys.argv[2] if len(sys.argv) > 2 else ""

    started = not start_from
    for item in report.get("notes_resolve_batches") or []:
        batch_id = item["batch_id"]
        staging = Path(item["staging"])
        if start_from and not started:
            if batch_id == start_from:
                started = True
            else:
                print("SKIP until", start_from, ":", batch_id)
                continue
        rows = mod.load_csv_rows(staging) if staging.exists() else []
        if not rows:
            print("SKIP empty", batch_id)
            continue
        # Ensure uploaded
        existing = mod.get_all(
            f"cs_notes_staging?batch_id=eq.{batch_id}&select=import_key,import_status"
        )
        print(f"\n==== NOTES {batch_id} csv={len(rows)} staging_db={len(existing)} ====")
        if len(existing) < len(rows) * 0.5:
            try:
                mod.set_batch_param(batch_id)
            except Exception as e:
                print("WARN", e)
            mod.upload_notes_resolve(batch_id, staging)
        try:
            mod.set_batch_param(batch_id)
        except Exception:
            pass
        mod.apply_notes_resolve_and_insert(batch_id)
    print("DONE notes")


if __name__ == "__main__":
    main()
