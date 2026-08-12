"""Spot-check MCP notes insertion into Supabase treatments."""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

ANON = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi"
    "cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0."
    "fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4"
)
BASE = "https://kprihawipljrltfzpfjd.supabase.co/rest/v1"
BATCH = "MCP_20260812_203155"


def api_get(path: str):
    req = urllib.request.Request(
        BASE + "/" + path,
        headers={
            "apikey": ANON,
            "Authorization": f"Bearer {ANON}",
            "Prefer": "count=exact",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode() or "[]")


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
        with urllib.request.urlopen(req, timeout=120) as resp:
            chunk = json.loads(resp.read().decode() or "[]")
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows


def flat(s: str, n: int = 120) -> str:
    return (s or "").replace("\n", " / ")[:n]


def main() -> None:
    rows = get_all(
        f"cs_notes_staging?batch_id=eq.{urllib.parse.quote(BATCH)}"
        "&select=import_status,match_method,matched_patient_id,chart_no,"
        "hkid_norm,name_en,doctor_code,visit_at,notes"
    )
    print("=== BATCH", BATCH, "===")
    print("TOTAL", len(rows))
    print("BY_STATUS", dict(Counter((r.get("import_status") or "?") for r in rows)))
    ins = [r for r in rows if r.get("import_status") == "inserted"]
    print("INSERTED", len(ins))
    print("BY_METHOD", dict(Counter((r.get("match_method") or "-") for r in ins)))

    by_pid: dict[str, list] = defaultdict(list)
    for r in ins:
        pid = r.get("matched_patient_id")
        if pid:
            by_pid[pid].append(r)
    print("DISTINCT_PATIENTS_INSERTED", len(by_pid))

    cands = sorted(by_pid.items(), key=lambda x: -len(x[1]))
    pick: list[str] = []
    for pid, notes in cands:
        if len(notes) >= 2:
            pick.append(pid)
        if len(pick) >= 3:
            break
    for pid, _notes in cands:
        if pid not in pick:
            pick.append(pid)
        if len(pick) >= 5:
            break

    print("\n=== SPOT CHECK 5 PATIENTS ===\n")
    ok_cases = 0
    for i, pid in enumerate(pick, 1):
        staged = by_pid[pid]
        pt = api_get(
            f"patients?id=eq.{pid}&select=id,patient_no,full_name,chinese_name,hkid,clinic_tag"
        )
        p = pt[0] if pt else {}
        txs = get_all(
            f"treatments?patient_id=eq.{pid}"
            "&select=id,notes,dentist_name,clinic_tag,created_at&order=created_at.desc"
        )
        staged_notes = [
            (s.get("notes") or "").replace("[[NL]]", "\n").strip() for s in staged
        ]
        found = 0
        missing = []
        for n in staged_notes:
            if any((t.get("notes") or "") == n for t in txs):
                found += 1
            else:
                missing.append(flat(n, 80))

        verdict = "PASS" if found == len(staged) and found > 0 else "FAIL"
        if verdict == "PASS":
            ok_cases += 1

        print(f"--- CASE {i} [{verdict}] ---")
        print(
            f"patient_no={p.get('patient_no')} name={p.get('full_name')} "
            f"zh={p.get('chinese_name')} clinic={p.get('clinic_tag')} hkid={p.get('hkid')}"
        )
        print(
            f"staged_inserted={len(staged)} treatments_in_db={len(txs)} "
            f"notes_found={found}/{len(staged)}"
        )
        for s in staged[:3]:
            n = flat((s.get("notes") or "").replace("[[NL]]", "\n"), 120)
            print(
                f"  STAGED visit={s.get('visit_at')} dr={s.get('doctor_code')} "
                f"chart={s.get('chart_no')} | {n}"
            )
        shown = 0
        for t in txs:
            if (t.get("notes") or "") in staged_notes:
                tid = str(t.get("id") or "")[:8]
                print(
                    f"  TX {tid}... created={t.get('created_at')} "
                    f"dr={t.get('dentist_name')} clinic={t.get('clinic_tag')} | "
                    f"{flat(t.get('notes') or '', 120)}"
                )
                shown += 1
                if shown >= 3:
                    break
        if missing:
            print(f"  MISSING ({len(missing)}): {missing[:2]}")
        print()

    print(f"SPOTCHECK_SUMMARY {ok_cases}/5 PASS")


if __name__ == "__main__":
    main()
