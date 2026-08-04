"""
Resolve unmatched CS consultation-note staging rows (multi-branch).

Reads unmatched rows for a source batch_id from cs_notes_staging, tries looser
patient matches (prefixed chart TKO003826, HKID+chart, name+DOB, …), then writes:

  CS_<BRANCH>_notes_resolve_staging_for_supabase.csv
  CS_<BRANCH>_notes_resolve_patient_map.csv
  CS_<BRANCH>_notes_still_unmatched_manual.csv

Then import resolve staging and run supabase_cs_notes_resolve_insert.sql.

Example:
  python resolve-unmatched-notes.py --branch PL --batch-id PL_20260805_120000 --clinic-tag PL
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"
OUT_DIR = Path(r"C:\Users\Doctor-1\Downloads")


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


def norm_pno(p: str) -> str:
    s = (p or "").strip()
    if not s:
        return ""
    t = s.lstrip("0")
    return t or "0"


def norm_name(n: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (n or "").upper())


def norm_dob(d: str) -> str:
    return re.sub(r"[^0-9]", "", d or "")


def import_key(batch_id: str, branch: str, chart_no: str, visit_at: str, notes: str) -> str:
    payload = f"{batch_id}|{branch}|{chart_no}|{visit_at}|{notes}".encode(
        "utf-8", errors="replace"
    )
    return hashlib.sha256(payload).hexdigest()[:40]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", required=True, help="Branch code e.g. TKO / PL")
    ap.add_argument(
        "--batch-id",
        required=True,
        help="Source staging batch_id that still has unmatched rows",
    )
    ap.add_argument("--clinic-tag", default="", help="Defaults to branch")
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    args = ap.parse_args()

    branch = norm_clinic(args.branch)
    clinic = norm_clinic(args.clinic_tag) or branch
    src_batch = args.batch_id.strip()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    um = get_all(
        "cs_notes_staging?batch_id=eq."
        + src_batch
        + "&import_status=eq.unmatched"
        + "&select=import_key,batch_id,branch_code,banana_clinic_tag,hkid_raw,hkid_norm,"
        "chart_no,chart_no_stripped,name_en,name_other,dob,sex,visit_date,visit_at,"
        "clinic_code,doctor_code,record_type,notes,import_error"
    )
    print("unmatched", len(um), dict(Counter(r.get("import_error") for r in um)))
    if not um:
        raise SystemExit("No unmatched rows for that batch_id.")

    pats = get_all(
        "patients?select=id,patient_no,hkid,clinic_tag,full_name,chinese_name,dob,sex"
    )
    print("patients", len(pats))

    for p in pats:
        p["_hk"] = norm_hkid(p.get("hkid"))
        p["_cl"] = norm_clinic(p.get("clinic_tag"))
        p["_pno"] = norm_pno(p.get("patient_no"))
        p["_pno_raw"] = (p.get("patient_no") or "").strip()
        p["_name"] = norm_name(p.get("full_name"))
        p["_dob"] = norm_dob(str(p.get("dob") or ""))

    by_hk_any: dict[str, list] = defaultdict(list)
    by_name_dob: dict[tuple, list] = defaultdict(list)
    for p in pats:
        if p["_hk"]:
            by_hk_any[p["_hk"]].append(p)
        if p["_name"] and p["_dob"]:
            by_name_dob[(p["_name"], p["_dob"])].append(p)

    clinic_ok = {clinic, ""}

    resolvable = []
    still = []
    strategies: Counter = Counter()

    for r in um:
        hk = r.get("hkid_norm") or ""
        chart = (r.get("chart_no") or "").strip()
        chart_s = r.get("chart_no_stripped") or norm_pno(chart)
        name = norm_name(r.get("name_en"))
        dob = norm_dob(r.get("dob"))
        chosen = None
        method = None
        pref = f"{clinic}{chart}" if chart else ""

        def pno_matches_chart(p) -> bool:
            raw = p["_pno_raw"]
            if not raw or not chart:
                return False
            if raw == chart or raw == pref:
                return True
            if raw.endswith(chart) or (chart_s and raw.endswith(chart_s)):
                return True
            if p["_pno"] == chart_s:
                return True
            return False

        if not chosen and hk and chart:
            cands = by_hk_any.get(hk, [])
            exact_pref = [
                p for p in cands if p["_pno_raw"] in (chart, pref) and p["_cl"] in clinic_ok
            ]
            uniq = {p["id"]: p for p in exact_pref}
            if len(uniq) == 1:
                chosen, method = list(uniq.values())[0], "hkid+patient_no_prefixed"
            if not chosen:
                suff = [p for p in cands if pno_matches_chart(p) and p["_cl"] in clinic_ok]
                uniq = {p["id"]: p for p in suff}
                if len(uniq) == 1:
                    chosen, method = list(uniq.values())[0], "hkid+patient_no_suffix"

        if not chosen and chart:
            pref_hits = [
                p for p in pats if p["_pno_raw"] in (chart, pref) and p["_cl"] in clinic_ok
            ]
            uniq = {p["id"]: p for p in pref_hits}
            if len(uniq) == 1:
                chosen, method = list(uniq.values())[0], "patient_no_prefixed+clinic"
            if not chosen:
                suff = [p for p in pats if pno_matches_chart(p) and p["_cl"] in clinic_ok]
                uniq = {p["id"]: p for p in suff}
                if len(uniq) == 1:
                    chosen, method = list(uniq.values())[0], "patient_no_suffix+clinic"

        if not chosen and hk:
            strict = [p for p in by_hk_any.get(hk, []) if p["_cl"] == clinic]
            if len(strict) == 1:
                chosen, method = strict[0], "hkid+clinic_tag_strict"
            elif len(strict) > 1 and name:
                nh = [p for p in strict if p["_name"] == name]
                if len(nh) == 1:
                    chosen, method = nh[0], "hkid+clinic+name"
                if not chosen and dob:
                    nd = [p for p in strict if p["_name"] == name and p["_dob"] == dob]
                    if len(nd) == 1:
                        chosen, method = nd[0], "hkid+clinic+name+dob"
                    if not chosen:
                        dd = [p for p in strict if p["_dob"] == dob]
                        if len(dd) == 1:
                            chosen, method = dd[0], "hkid+clinic+dob"

        if not chosen and name and dob:
            hits = [
                p
                for p in by_name_dob.get((name, dob), [])
                if p["_cl"] in clinic_ok
            ]
            uniq = {p["id"]: p for p in hits}
            if len(uniq) == 1:
                chosen, method = list(uniq.values())[0], "name+dob+clinic_loose"

        if not chosen and hk:
            uniq = {p["id"]: p for p in by_hk_any.get(hk, [])}
            if len(uniq) == 1:
                chosen, method = list(uniq.values())[0], "hkid_norm_global_unique"

        if not chart and not hk and not name:
            still.append(r)
            continue

        if chosen:
            resolvable.append((r, chosen, method))
            strategies[method] += 1
        else:
            still.append(r)

    print("RESOLVABLE", len(resolvable), dict(strategies))
    print("STILL", len(still), dict(Counter(r.get("import_error") for r in still)))

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    batch_id = f"{branch}_NOTES_RESOLVE_{stamp}"

    staging_path = out_dir / f"CS_{branch}_notes_resolve_staging_for_supabase.csv"
    map_path = out_dir / f"CS_{branch}_notes_resolve_patient_map.csv"
    still_path = out_dir / f"CS_{branch}_notes_still_unmatched_manual.csv"

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
        "resolved_patient_id",
        "resolve_method",
    ]

    with staging_path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r, p, m in resolvable:
            chart = (r.get("chart_no") or "").strip()
            visit_at = (r.get("visit_at") or "").strip()
            notes = (r.get("notes") or "").strip()
            w.writerow(
                {
                    "import_key": import_key(batch_id, branch, chart, visit_at, notes),
                    "batch_id": batch_id,
                    "branch_code": branch,
                    "banana_clinic_tag": clinic,
                    "hkid_raw": r.get("hkid_raw") or "",
                    "hkid_norm": r.get("hkid_norm") or "",
                    "chart_no": chart,
                    "chart_no_stripped": r.get("chart_no_stripped") or norm_pno(chart),
                    "name_en": r.get("name_en") or "",
                    "name_other": r.get("name_other") or "",
                    "dob": r.get("dob") or "",
                    "sex": r.get("sex") or "",
                    "visit_date": r.get("visit_date") or "",
                    "visit_at": visit_at,
                    "clinic_code": clinic,
                    "doctor_code": r.get("doctor_code") or "",
                    "record_type": r.get("record_type") or "",
                    "notes": notes,
                    "resolved_patient_id": p["id"],
                    "resolve_method": m,
                }
            )

    with map_path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "chart_no",
                "hkid_raw",
                "name_en",
                "visit_at",
                "resolve_method",
                "resolved_patient_id",
                "banana_patient_no",
                "banana_name",
                "banana_clinic_tag",
            ],
        )
        w.writeheader()
        for r, p, m in resolvable:
            w.writerow(
                {
                    "chart_no": r.get("chart_no"),
                    "hkid_raw": r.get("hkid_raw"),
                    "name_en": r.get("name_en"),
                    "visit_at": r.get("visit_at"),
                    "resolve_method": m,
                    "resolved_patient_id": p["id"],
                    "banana_patient_no": p.get("patient_no"),
                    "banana_name": p.get("full_name"),
                    "banana_clinic_tag": p.get("clinic_tag"),
                }
            )

    still_cols = [
        "chart_no",
        "hkid_raw",
        "hkid_norm",
        "name_en",
        "name_other",
        "dob",
        "sex",
        "visit_date",
        "visit_at",
        "doctor_code",
        "import_error",
        "notes",
    ]
    with still_path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=still_cols, extrasaction="ignore")
        w.writeheader()
        for r in still:
            w.writerow({c: r.get(c) or "" for c in still_cols})

    print(f"BATCH_ID {batch_id}")
    print(f"STAGING {staging_path} ({len(resolvable)})")
    print(f"MAP {map_path}")
    print(f"STILL_MANUAL {still_path} ({len(still)})")
    print(
        "Next: set cs_import_params.batch_id to BATCH_ID, import STAGING, "
        "run supabase_cs_notes_resolve_insert.sql"
    )


if __name__ == "__main__":
    main()
