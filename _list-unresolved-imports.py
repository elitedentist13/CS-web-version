"""Read-only: list unresolved CS import staging rows (payments + notes)."""
from __future__ import annotations

import json
import sys
import urllib.request
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"


def get(path: str, offset: int = 0, page: int = 1000):
    url = BASE + "/" + path + ("&" if "?" in path else "?") + f"limit={page}&offset={offset}"
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
        return json.loads(resp.read().decode() or "[]"), resp.headers.get("Content-Range", "")


def count_status(table: str, status: str) -> str:
    _, cr = get(f"{table}?import_status=eq.{status}&select=import_key", 0, 1)
    return cr


def fetch_status(table: str, status: str, select: str) -> list[dict]:
    rows: list[dict] = []
    off = 0
    while True:
        chunk, cr = get(
            f"{table}?import_status=eq.{status}&select={select}&order=batch_id",
            off,
        )
        rows.extend(chunk or [])
        if not chunk or len(chunk) < 1000:
            break
        off += 1000
        if off > 100000:
            break
    return rows


def summarize(label: str, rows: list[dict], branch_keys=("branch_code", "banana_clinic_tag")):
    print(f"\n=== {label}: {len(rows)} rows ===")
    if not rows:
        return
    br = Counter()
    for r in rows:
        b = None
        for k in branch_keys:
            if r.get(k):
                b = r.get(k)
                break
        br[b or "?"] += 1
    err = Counter((r.get("import_error") or "(blank)") for r in rows)
    batch = Counter((r.get("batch_id") or "?") for r in rows)
    print("BY_BRANCH", dict(br.most_common()))
    print("BY_ERROR", dict(err.most_common(25)))
    print("BY_BATCH", dict(batch.most_common(15)))
    print("--- sample (up to 30) ---")
    keys = [
        k
        for k in (
            "branch_code",
            "banana_clinic_tag",
            "chart_no",
            "bill_date",
            "note_date",
            "txn_code",
            "name_en",
            "hkid_norm",
            "net_hkd",
            "import_error",
            "batch_id",
        )
        if k in rows[0]
    ]
    print("\t".join(keys))
    for r in rows[:30]:
        print("\t".join(str(r.get(k) or "") for k in keys))


def main() -> None:
    for table in ("cs_payments_staging", "cs_notes_staging"):
        print(f"\n######## {table} status counts ########")
        for s in (
            "unmatched",
            "pending",
            "error",
            "matched",
            "skipped_placeholder",
            "skipped_dup",
            "inserted",
        ):
            try:
                print(f"  {s}: {count_status(table, s)}")
            except Exception as e:
                print(f"  {s}: ERR {e}")

    pay_sel = (
        "batch_id,branch_code,banana_clinic_tag,txn_code,bill_date,chart_no,"
        "hkid_norm,name_en,net_hkd,received_hkd,import_error"
    )
    note_sel = "batch_id,branch_code,banana_clinic_tag,chart_no,hkid_norm,name_en,import_error"
    # discover note columns
    sample, _ = get("cs_notes_staging?import_status=eq.unmatched&select=*&limit=1")
    if sample:
        note_sel = ",".join(
            k
            for k in sample[0].keys()
            if k
            in {
                "batch_id",
                "branch_code",
                "banana_clinic_tag",
                "chart_no",
                "hkid_norm",
                "name_en",
                "name_other",
                "note_date",
                "visit_date",
                "import_error",
                "txn_code",
            }
        )

    for status in ("unmatched", "pending", "error", "matched"):
        try:
            rows = fetch_status("cs_payments_staging", status, pay_sel)
            if rows or status == "unmatched":
                summarize(f"PAYMENTS {status}", rows)
        except Exception as e:
            print("PAYMENTS", status, "ERR", e)

    for status in ("unmatched", "pending", "error", "matched"):
        try:
            rows = fetch_status("cs_notes_staging", status, note_sel or "batch_id,import_error")
            if rows or status == "unmatched":
                summarize(f"NOTES {status}", rows)
        except Exception as e:
            print("NOTES", status, "ERR", e)


if __name__ == "__main__":
    main()
