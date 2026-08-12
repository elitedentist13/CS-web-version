"""
Clinic Solution → Banana treatments (notes) via Supabase anon REST.

Mirrors supabase_cs_notes_import.sql match/insert order, same style as
run-cs-payments-import.py / PL transfer (no SQL Editor required).

Example:
  python run-cs-notes-import.py ^
    --staging "C:\\Users\\joyfu\\Downloads\\CS_MCP_staging_for_supabase.csv" ^
    --batch-id MCP_20260812_203155 --clinic-tag MCP
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"

STAGING_COLS = [
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


def api(method: str, path: str, body=None, prefer: str = "return=minimal"):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {
        "apikey": ANON,
        "Authorization": f"Bearer {ANON}",
        "Prefer": prefer,
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(
        BASE + "/" + path.lstrip("/"), data=data, method=method, headers=headers
    )
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(
            f"{method} {path} → {e.code}: {e.read().decode('utf-8', errors='replace')[:600]}"
        ) from e


def get_all(path_query: str, page: int = 1000) -> list:
    rows: list = []
    offset = 0
    while True:
        sep = "&" if "?" in path_query else "?"
        url = f"{BASE}/{path_query}{sep}limit={page}&offset={offset}"
        req = urllib.request.Request(
            url,
            headers={
                "apikey": ANON,
                "Authorization": f"Bearer {ANON}",
                "Prefer": "count=exact",
                "Range": f"{offset}-{offset + page - 1}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                chunk = json.loads(resp.read().decode("utf-8") or "[]")
        except urllib.error.HTTPError as e:
            if e.code == 416:
                break
            raise
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows


def normalize_hkid(raw: str) -> str:
    import re

    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def normalize_clinic_tag(raw: str) -> str:
    import re

    return re.sub(r"[^A-Z0-9_-]", "", (raw or "").strip().upper())


def normalize_patient_no(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    t = s.lstrip("0")
    return t or "0"


def set_batch_param(batch_id: str) -> None:
    api(
        "PATCH",
        "cs_import_params?id=eq.1",
        body={
            "batch_id": batch_id,
            "require_clinic_scope": True,
            "updated_at": datetime.utcnow().isoformat() + "Z",
        },
    )
    print("cs_import_params.batch_id =", batch_id)


def load_staging_csv(path: Path, batch_id: str) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8-sig", newline="", errors="replace") as fh:
        for r in csv.DictReader(fh):
            item = {k: (r.get(k) or "").strip() for k in STAGING_COLS}
            item["batch_id"] = batch_id or item["batch_id"]
            item["import_status"] = "pending"
            if not item.get("import_key") or not item.get("notes"):
                continue
            rows.append(item)
    return rows


def upload_staging(batch_id: str, rows: list[dict], clear: bool = True) -> int:
    if clear:
        try:
            api(
                "DELETE",
                f"cs_notes_staging?batch_id=eq.{urllib.parse.quote(batch_id, safe='')}",
            )
            print("cleared prior staging rows for", batch_id)
        except RuntimeError as e:
            print("WARN clear batch:", e)
    n = 0
    for i in range(0, len(rows), 80):
        part = []
        for r in rows[i : i + 80]:
            item = dict(r)
            for k in list(item.keys()):
                if item[k] == "":
                    item[k] = None
            part.append(item)
        api("POST", "cs_notes_staging", body=part, prefer="return=minimal")
        n += len(part)
        print(f"  uploaded staging {n}/{len(rows)}")
    return n


def build_patient_indexes(patients: list[dict], clinic_tag: str):
    by_hkid_clinic: dict[str, list] = defaultdict(list)
    by_hkid_blank: dict[str, list] = defaultdict(list)
    by_pno_clinic: dict[str, list] = defaultdict(list)
    by_pno_blank: dict[str, list] = defaultdict(list)
    by_pno_stripped: dict[str, list] = defaultdict(list)
    tag = normalize_clinic_tag(clinic_tag)
    for p in patients:
        pno = (p.get("patient_no") or "").strip()
        hkid = normalize_hkid(p.get("hkid") or "")
        pt_tag = normalize_clinic_tag(p.get("clinic_tag") or "")
        if hkid and pt_tag == tag:
            by_hkid_clinic[hkid].append(p)
        if hkid and not pt_tag:
            by_hkid_blank[hkid].append(p)
        if pno and pt_tag == tag:
            by_pno_clinic[pno.upper()].append(p)
            by_pno_stripped[normalize_patient_no(pno)].append(p)
        if pno and not pt_tag:
            by_pno_blank[pno.upper()].append(p)
    return {
        "hkid_clinic": by_hkid_clinic,
        "hkid_blank": by_hkid_blank,
        "pno_clinic": by_pno_clinic,
        "pno_blank": by_pno_blank,
        "pno_stripped": by_pno_stripped,
        "tag": tag,
    }


def unique_hit(cands: list) -> tuple[dict | None, str | None]:
    if len(cands) == 1:
        return cands[0], None
    if len(cands) > 1:
        return None, "ambiguous"
    return None, None


def match_row(row: dict, idx: dict) -> tuple[str, str | None, str | None]:
    hkid = (row.get("hkid_norm") or "").strip()
    chart = (row.get("chart_no") or "").strip()
    chart_u = chart.upper()
    stripped = (row.get("chart_no_stripped") or "").strip() or normalize_patient_no(chart)
    tag = idx["tag"]
    prefixed = f"{tag}{chart}" if tag and chart else ""

    if hkid:
        hit, amb = unique_hit(idx["hkid_clinic"].get(hkid, []))
        if amb:
            return "unmatched", None, "ambiguous_hkid_norm+clinic_tag"
        if hit:
            return "matched", hit["id"], "hkid_norm+clinic_tag"
        hit, amb = unique_hit(idx["hkid_blank"].get(hkid, []))
        if amb:
            return "unmatched", None, "ambiguous_hkid_norm"
        if hit:
            return "matched", hit["id"], "hkid_norm"

    if chart_u:
        hit, amb = unique_hit(idx["pno_clinic"].get(chart_u, []))
        if amb:
            return "unmatched", None, "ambiguous_patient_no_exact+clinic_tag"
        if hit:
            return "matched", hit["id"], "patient_no_exact+clinic_tag"

    if prefixed:
        hit, amb = unique_hit(idx["pno_clinic"].get(prefixed.upper(), []))
        if amb:
            return "unmatched", None, "ambiguous_patient_no_prefixed+clinic_tag"
        if hit:
            return "matched", hit["id"], "patient_no_prefixed+clinic_tag"

    if chart_u:
        hit, amb = unique_hit(idx["pno_blank"].get(chart_u, []))
        if amb:
            return "unmatched", None, "ambiguous_patient_no_exact+blank_clinic"
        if hit:
            return "matched", hit["id"], "patient_no_exact"

    if stripped:
        hit, amb = unique_hit(idx["pno_stripped"].get(stripped, []))
        if amb:
            return "unmatched", None, "ambiguous_patient_no_stripped+clinic_tag"
        if hit:
            return "matched", hit["id"], "patient_no_stripped+clinic_tag"

    return "unmatched", None, "no_patient_match"


def visit_to_created_at(visit_at: str) -> str | None:
    visit_at = (visit_at or "").strip()
    if not visit_at:
        return None
    created_at = visit_at.replace(" ", "T")
    if len(created_at) >= 19:
        # Softlink timestamps are local HK wall time
        base = created_at[:23] if len(created_at) >= 23 else created_at[:19]
        if "+" not in base and "Z" not in base:
            return base + "+08:00"
        return base
    return created_at + "+08:00"


def treatment_exists(patient_id: str, notes: str, created_at: str | None) -> bool:
    # Probe by patient + created_at window; compare notes in Python (special chars)
    q = f"treatments?patient_id=eq.{patient_id}&select=id,notes,created_at&limit=50"
    if created_at:
        # Exact timestamptz match is fragile; filter day then compare
        day = created_at[:10]
        q = (
            f"treatments?patient_id=eq.{patient_id}"
            f"&created_at=gte.{day}T00:00:00%2B08:00"
            f"&created_at=lte.{day}T23:59:59.999%2B08:00"
            f"&select=id,notes,created_at&limit=100"
        )
    try:
        existing = api("GET", q, prefer="return=representation") or []
    except RuntimeError:
        existing = []
    for x in existing:
        if (x.get("notes") or "") == notes:
            if not created_at:
                return True
            xc = (x.get("created_at") or "")[:19].replace("T", " ")
            vc = created_at[:19].replace("T", " ")
            if xc == vc:
                return True
    return False


def match_and_insert(batch_id: str, clinic_tag: str, dry_run: bool = False) -> Counter:
    stats = Counter()
    print("Loading patients for clinic_tag", clinic_tag, "...")
    tag_q = urllib.parse.quote(clinic_tag, safe="")
    patients_mcp = get_all(
        f"patients?clinic_tag=eq.{tag_q}&select=id,patient_no,hkid,clinic_tag,full_name"
    )
    patients_blank = get_all(
        "patients?clinic_tag=is.null&select=id,patient_no,hkid,clinic_tag,full_name"
    )
    patients_empty = get_all(
        "patients?clinic_tag=eq.&select=id,patient_no,hkid,clinic_tag,full_name"
    )
    by_id = {}
    for p in patients_mcp + patients_blank + patients_empty:
        by_id[p["id"]] = p
    patients = list(by_id.values())
    print(
        f"  patient index size={len(patients)} "
        f"(clinic={len(patients_mcp)} blank={len(patients_blank)+len(patients_empty)})"
    )
    idx = build_patient_indexes(patients, clinic_tag)

    rows = get_all(
        f"cs_notes_staging?batch_id=eq.{urllib.parse.quote(batch_id, safe='')}"
        "&import_status=in.(pending,matched,unmatched)&select=*"
    )
    print(f"  staging rows to process={len(rows)}")

    for i, r in enumerate(rows, 1):
        key = r.get("import_key") or ""
        status, pid, method = match_row(r, idx)
        if status != "matched" or not pid:
            if not dry_run:
                api(
                    "PATCH",
                    f"cs_notes_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
                    body={
                        "import_status": "unmatched",
                        "matched_patient_id": None,
                        "match_method": None,
                        "import_error": method or "no_patient_match",
                    },
                )
            stats["unmatched"] += 1
            stats[f"err:{method}"] += 1
            continue

        if not dry_run:
            api(
                "PATCH",
                f"cs_notes_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
                body={
                    "matched_patient_id": pid,
                    "match_method": method,
                    "import_status": "matched",
                    "import_error": None,
                },
            )
        stats["matched"] += 1
        stats[f"method:{method}"] += 1

        notes = (r.get("notes") or "").replace("[[NL]]", "\n").strip()
        if not notes:
            if not dry_run:
                api(
                    "PATCH",
                    f"cs_notes_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
                    body={"import_status": "unmatched", "import_error": "empty_notes"},
                )
            stats["empty_notes"] += 1
            continue

        created_at = visit_to_created_at(r.get("visit_at") or "")
        tag = normalize_clinic_tag(r.get("banana_clinic_tag") or clinic_tag)

        if treatment_exists(pid, notes, created_at):
            if not dry_run:
                api(
                    "PATCH",
                    f"cs_notes_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
                    body={
                        "import_status": "skipped_dup",
                        "import_error": "already_in_treatments",
                        "imported_at": datetime.utcnow().isoformat() + "Z",
                    },
                )
            stats["skipped_dup"] += 1
            continue

        if dry_run:
            stats["would_insert"] += 1
            continue

        payload = {
            "patient_id": pid,
            "notes": notes,
            "dentist_name": (r.get("doctor_code") or "").strip() or None,
            "clinic_tag": tag or None,
        }
        if created_at:
            payload["created_at"] = created_at
        try:
            api("POST", "treatments", body=payload, prefer="return=minimal")
            api(
                "PATCH",
                f"cs_notes_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
                body={
                    "import_status": "inserted",
                    "import_error": None,
                    "imported_at": datetime.utcnow().isoformat() + "Z",
                },
            )
            stats["inserted"] += 1
        except RuntimeError as e:
            msg = str(e).lower()
            if "duplicate" in msg or "unique" in msg or "409" in msg:
                api(
                    "PATCH",
                    f"cs_notes_staging?import_key=eq.{urllib.parse.quote(key, safe='')}",
                    body={
                        "import_status": "skipped_dup",
                        "import_error": "already_in_treatments",
                    },
                )
                stats["skipped_dup"] += 1
            else:
                print("ERR insert", key[:12], e)
                stats["error"] += 1

        if i % 100 == 0:
            print(f"  progress {i}/{len(rows)}", dict(stats))

    return stats


def report(batch_id: str) -> None:
    rows = get_all(
        f"cs_notes_staging?batch_id=eq.{urllib.parse.quote(batch_id, safe='')}"
        "&select=import_status,match_method"
    )
    c = Counter((r.get("import_status") or "?", r.get("match_method") or "") for r in rows)
    print("\n=== REPORT", batch_id, "===")
    for (status, method), n in sorted(c.items()):
        print(f"  {status:14} {method or '-':40} {n}")
    print("TOTAL", len(rows))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--staging", required=True, help="Prepared staging CSV path")
    ap.add_argument("--batch-id", default="", help="Defaults to batch_id in CSV")
    ap.add_argument("--clinic-tag", required=True)
    ap.add_argument("--dry-run", action="store_true", help="Match only, no writes")
    ap.add_argument("--skip-upload", action="store_true", help="Use rows already in staging")
    ap.add_argument("--no-clear", action="store_true")
    args = ap.parse_args()

    staging = Path(args.staging)
    if not staging.exists():
        raise SystemExit(f"staging not found: {staging}")

    rows = load_staging_csv(staging, args.batch_id)
    if not rows:
        raise SystemExit("no staging rows")
    batch_id = (args.batch_id or rows[0]["batch_id"]).strip()
    clinic_tag = normalize_clinic_tag(args.clinic_tag)
    print(f"BATCH_ID={batch_id} CLINIC={clinic_tag} ROWS={len(rows)}")

    if not args.dry_run:
        set_batch_param(batch_id)
        if not args.skip_upload:
            upload_staging(batch_id, rows, clear=not args.no_clear)

    stats = match_and_insert(batch_id, clinic_tag, dry_run=args.dry_run)
    print("STATS", dict(stats))
    report(batch_id)
    print("DONE")


if __name__ == "__main__":
    main()
