"""Investigate remaining MCP unmatched notes and re-export resolve staging CSV."""
from __future__ import annotations

import csv
import json
import subprocess
import sys
import urllib.parse
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
ROOT = Path(__file__).resolve().parent
OUT = Path(r"C:\Users\joyfu\Downloads")
SRC_BATCH = "MCP_20260812_203155"


def get_all(q: str, page: int = 1000) -> list:
    rows: list = []
    offset = 0
    while True:
        sep = "&" if "?" in q else "?"
        url = f"{BASE}/{q}{sep}limit={page}&offset={offset}"
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
            chunk = json.loads(resp.read().decode() or "[]")
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows


def main() -> None:
    req = urllib.request.Request(
        BASE + "/cs_import_params?id=eq.1&select=*",
        headers={"apikey": ANON, "Authorization": f"Bearer {ANON}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        print("PARAMS", resp.read().decode())

    # Original batch status
    src = get_all(
        f"cs_notes_staging?batch_id=eq.{urllib.parse.quote(SRC_BATCH)}"
        "&select=import_status,match_method,import_error,resolved_patient_id,"
        "matched_patient_id,chart_no,hkid_norm,name_en,visit_at,notes,import_key"
    )
    print("SRC_BATCH", SRC_BATCH, "TOTAL", len(src))
    print("SRC_BY_STATUS", dict(Counter(r.get("import_status") or "?" for r in src)))
    um = [r for r in src if (r.get("import_status") or "") == "unmatched"]
    print("SRC_UNMATCHED", len(um))
    print("SRC_UNMATCHED_ERRORS", dict(Counter(r.get("import_error") for r in um)))
    print(
        "SRC_UNMATCHED_with_resolved_id",
        sum(1 for r in um if r.get("resolved_patient_id")),
    )

    # Any resolve batches present?
    resolve_rows = get_all(
        "cs_notes_staging?batch_id=like.MCP_NOTES_RESOLVE*"
        "&select=batch_id,import_status,import_error,resolved_patient_id,"
        "matched_patient_id,chart_no,name_en,resolve_method"
    )
    print("RESOLVE_ROWS_TOTAL", len(resolve_rows))
    by_b = defaultdict(Counter)
    for r in resolve_rows:
        by_b[r.get("batch_id") or "?"][r.get("import_status") or "?"] += 1
    for b, c in sorted(by_b.items()):
        print("RESOLVE_BATCH", b, dict(c))
        with_res = sum(
            1
            for r in resolve_rows
            if r.get("batch_id") == b and r.get("resolved_patient_id")
        )
        print("  with resolved_patient_id", with_res)

    # Why original unmatched remain: resolve CSV creates NEW batch rows;
    # original unmatched stay unmatched until resolve batch is inserted.
    print("\n=== WHY STILL UNMATCHED ===")
    print(
        "Original batch rows stay import_status=unmatched forever;"
        " resolve workflow adds a NEW batch (MCP_NOTES_RESOLVE_*) with"
        " resolved_patient_id, then resolve_insert.sql inserts those."
    )
    if not resolve_rows:
        print(
            "FINDING: No MCP_NOTES_RESOLVE_* rows in cs_notes_staging yet"
            " — resolve CSV was not imported, or import failed / wrong table."
        )
    else:
        pending = [r for r in resolve_rows if r.get("import_status") in ("pending", None, "")]
        unmatched_r = [r for r in resolve_rows if r.get("import_status") == "unmatched"]
        inserted_r = [r for r in resolve_rows if r.get("import_status") == "inserted"]
        print(
            f"FINDING: resolve batch exists; pending={len(pending)}"
            f" unmatched={len(unmatched_r)} inserted={len(inserted_r)}"
        )
        no_res = [r for r in resolve_rows if not r.get("resolved_patient_id")]
        if no_res:
            print(
                f"FINDING: {len(no_res)} resolve rows missing resolved_patient_id"
                " — CSV column likely not mapped on import."
            )
        # SQL file may still point at OKT batch
        sql = (ROOT / "supabase_cs_notes_resolve_insert.sql").read_text(encoding="utf-8")
        if "OKT_NOTES_RESOLVE" in sql:
            print(
                "FINDING: supabase_cs_notes_resolve_insert.sql §2 still has"
                " OKT_NOTES_RESOLVE_... hardcoded — if whole file was run,"
                " active batch_id was set to OKT, not MCP resolve batch."
            )

    print("\n=== UNMATCHED CASE LIST (original batch) ===")
    g = defaultdict(list)
    for r in um:
        g[(r.get("chart_no"), r.get("hkid_norm"), r.get("name_en"), r.get("import_error"))].append(
            r
        )
    for i, (k, rs) in enumerate(sorted(g.items(), key=lambda x: (-len(x[1]), x[0][0] or "")), 1):
        chart, hk, name, err = k
        print(
            f"{i:2}. chart={chart} hkid={hk or '-'} name={name or '-'} "
            f"notes={len(rs)} err={err}"
        )

    # Re-export resolve CSV fresh
    print("\n=== RE-EXPORT RESOLVE CSV ===")
    cmd = [
        sys.executable,
        str(ROOT / "resolve-unmatched-notes.py"),
        "--branch",
        "MCP",
        "--batch-id",
        SRC_BATCH,
        "--clinic-tag",
        "MCP",
        "--out-dir",
        str(OUT),
    ]
    subprocess.check_call(cmd)

    staging = OUT / "CS_MCP_notes_resolve_staging_for_supabase.csv"
    rows = list(csv.DictReader(staging.open(encoding="utf-8-sig")))
    print("EXPORTED", staging, "rows=", len(rows))
    print("BATCH_ID", rows[0].get("batch_id") if rows else None)
    print(
        "ALL_HAVE_resolved_patient_id",
        all((r.get("resolved_patient_id") or "").strip() for r in rows),
    )


if __name__ == "__main__":
    main()
