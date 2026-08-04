"""
Prepare Clinic Solution consultation-notes CSV for Supabase staging import.

Multi-branch ready:
  - --branch / --batch-id tag every row
  - --clinic-tag maps to Banana patients.clinic_tag (defaults to branch)
  - import_key includes branch so chart numbers can overlap across clinics

Also:
  - Normalizes HKID (uppercase, strip spaces / brackets / punctuation)
  - Emits snake_case columns compatible with cs_notes_staging
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import re
from datetime import datetime
from pathlib import Path


def normalize_hkid(raw: str) -> str:
    s = (raw or "").strip().upper()
    return re.sub(r"[^A-Z0-9]", "", s)


def normalize_chart_no(raw: str) -> str:
    return (raw or "").strip()


def chart_no_stripped(raw: str) -> str:
    s = normalize_chart_no(raw).lstrip("0")
    return s or "0"


def normalize_branch(raw: str) -> str:
    s = (raw or "").strip().upper()
    s = re.sub(r"[^A-Z0-9_-]", "", s)
    return s


def parse_visit_at(visit_ts: str, visit_date: str) -> str:
    """Return ISO-ish timestamp string for Postgres timestamptz cast."""
    ts = (visit_ts or "").strip()
    if ts:
        return ts.replace("/", "-")
    d = (visit_date or "").strip().replace("/", "-")
    if d:
        return f"{d} 00:00:00"
    return ""


def import_key(branch: str, chart_no: str, visit_at: str, notes: str) -> str:
    payload = f"{branch}|{chart_no}|{visit_at}|{notes}".encode("utf-8", errors="replace")
    return hashlib.sha256(payload).hexdigest()[:40]


def pick_clinic_code(row: dict, override: str, branch: str) -> str:
    if override:
        return override
    from_row = (row.get("ClinicCode") or row.get("clinic_code") or "").strip().upper()
    return from_row or branch


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Normalize CS notes CSV for multi-branch Supabase staging import"
    )
    ap.add_argument(
        "--source",
        required=True,
        help="Raw notes CSV from Clinic Solution export",
    )
    ap.add_argument(
        "--branch",
        required=True,
        help="Branch code, e.g. TKO, PL, QB (stored as branch_code)",
    )
    ap.add_argument(
        "--batch-id",
        default="",
        help="Import batch id (default: BRANCH_YYYYMMDD_HHMMSS)",
    )
    ap.add_argument(
        "--clinic-tag",
        default="",
        help="Banana patients.clinic_tag / treatments.clinic_tag "
        "(default: --branch, or ClinicCode from CSV if present)",
    )
    ap.add_argument(
        "--out",
        default="",
        help="Output staging CSV path",
    )
    args = ap.parse_args()

    branch = normalize_branch(args.branch)
    if not branch:
        raise SystemExit("--branch is required (e.g. TKO, PL, QB)")

    src = Path(args.source)
    if not src.exists():
        raise SystemExit(f"Source not found: {src}")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    batch_id = (args.batch_id or "").strip() or f"{branch}_{stamp}"
    clinic_tag_arg = normalize_branch(args.clinic_tag) if args.clinic_tag else ""

    out = Path(args.out) if args.out else src.with_name(
        f"CS_{branch}_{stamp}_staging_for_supabase.csv"
    )

    fieldnames = [
        "import_key",
        "batch_id",
        "branch_code",
        "banana_clinic_tag",
        "hkid_raw",
        "hkid_norm",
        "chart_no",
        "chart_no_stripped",
        "name_en",
        "name_other",
        "dob",
        "sex",
        "visit_date",
        "visit_at",
        "clinic_code",
        "doctor_code",
        "record_type",
        "notes",
    ]

    stats = {
        "total": 0,
        "with_hkid_norm": 0,
        "blank_hkid": 0,
        "empty_notes": 0,
        "skipped_empty_notes": 0,
        "clinic_codes": {},
    }

    with src.open("r", encoding="utf-8-sig", newline="") as fin, out.open(
        "w", encoding="utf-8-sig", newline=""
    ) as fout:
        reader = csv.DictReader(fin)
        writer = csv.DictWriter(fout, fieldnames=fieldnames, quoting=csv.QUOTE_MINIMAL)
        writer.writeheader()

        for row in reader:
            stats["total"] += 1
            hkid_raw = (row.get("HKID") or row.get("hkid_raw") or "").strip()
            hkid_norm = normalize_hkid(hkid_raw)
            chart_no = normalize_chart_no(row.get("ChartNo") or row.get("chart_no") or "")
            notes = (row.get("ConsultationNote") or row.get("notes") or "").strip()
            visit_at = parse_visit_at(
                row.get("VisitTimestamp") or row.get("visit_at") or "",
                row.get("VisitDate") or row.get("visit_date") or "",
            )
            clinic_code = pick_clinic_code(row, clinic_tag_arg, branch)
            banana_clinic_tag = clinic_tag_arg or clinic_code or branch

            if not notes:
                stats["empty_notes"] += 1
                stats["skipped_empty_notes"] += 1
                continue

            if hkid_norm:
                stats["with_hkid_norm"] += 1
            else:
                stats["blank_hkid"] += 1

            stats["clinic_codes"][banana_clinic_tag] = (
                stats["clinic_codes"].get(banana_clinic_tag, 0) + 1
            )

            writer.writerow(
                {
                    "import_key": import_key(branch, chart_no, visit_at, notes),
                    "batch_id": batch_id,
                    "branch_code": branch,
                    "banana_clinic_tag": banana_clinic_tag,
                    "hkid_raw": hkid_raw,
                    "hkid_norm": hkid_norm,
                    "chart_no": chart_no,
                    "chart_no_stripped": chart_no_stripped(chart_no),
                    "name_en": (row.get("NameEn") or row.get("name_en") or "").strip(),
                    "name_other": (row.get("NameOther") or row.get("name_other") or "").strip(),
                    "dob": (row.get("DOB") or row.get("dob") or "").strip(),
                    "sex": (row.get("Sex") or row.get("sex") or "").strip(),
                    "visit_date": (row.get("VisitDate") or row.get("visit_date") or "").strip(),
                    "visit_at": visit_at,
                    "clinic_code": clinic_code,
                    "doctor_code": (row.get("DoctorCode") or row.get("doctor_code") or "").strip(),
                    "record_type": (row.get("RecordType") or row.get("record_type") or "").strip(),
                    "notes": notes,
                }
            )

    wrote = stats["total"] - stats["skipped_empty_notes"]
    print(f"OUT {out}")
    print(f"BRANCH {branch}")
    print(f"BATCH_ID {batch_id}")
    print(f"CLINIC_TAGS {stats['clinic_codes']}")
    print(f"STATS { {k: v for k, v in stats.items() if k != 'clinic_codes'} }")
    print(f"WROTE {wrote} data rows (+ header)")
    print("")
    print("Next: set batch in Supabase before match/insert:")
    print("  UPDATE public.cs_import_params")
    print(f"  SET batch_id = '{batch_id}', require_clinic_scope = true, updated_at = now()")
    print("  WHERE id = 1;")


if __name__ == "__main__":
    main()
