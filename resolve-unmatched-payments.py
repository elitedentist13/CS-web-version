"""
Resolve unmatched CS payment staging rows (multi-branch).

Same strategies as resolve-unmatched-notes.py (HKID+chart, SKW blank clinic, etc.).

Example:
  python resolve-unmatched-payments.py --branch CWB --batch-id CWB_PAY_20260806_044357 --clinic-tag CWB
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
OUT_DIR = Path(r"C:\Users\joyfu\Downloads")

STAGING_FIELDS = [
    "import_key",
    "batch_id",
    "branch_code",
    "banana_clinic_tag",
    "txn_code",
    "bill_date",
    "bill_timestamp",
    "chart_no",
    "chart_no_stripped",
    "hkid_raw",
    "hkid_norm",
    "name_en",
    "name_other",
    "dob",
    "sex",
    "clinic_code",
    "doctor_code",
    "cancel_status",
    "cancel_label",
    "total_hkd",
    "discount_hkd",
    "net_hkd",
    "received_hkd",
    "balance_hkd",
    "total_cents",
    "received_cents",
    "remarks",
    "diagnosis",
    "items_json",
    "payments_json",  # keep INCOMETABLE methods / installments for resolve insert
    "resolved_patient_id",
    "resolve_method",
]


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


def money(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def import_key(batch_id: str, txn: str, chart: str) -> str:
    payload = f"{batch_id}|{txn}|{chart}".encode("utf-8", errors="replace")
    return hashlib.sha256(payload).hexdigest()[:40]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--branch", required=True)
    ap.add_argument("--batch-id", required=True, help="Source unmatched batch_id")
    ap.add_argument("--clinic-tag", default="")
    ap.add_argument("--out-dir", default=str(OUT_DIR))
    args = ap.parse_args()

    branch = norm_clinic(args.branch)
    clinic = norm_clinic(args.clinic_tag) or branch
    src_batch = args.batch_id.strip()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    um = get_all(
        "cs_payments_staging?batch_id=eq."
        + src_batch
        + "&import_status=eq.unmatched&select=*"
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

    by_hk_any: dict[str, list] = defaultdict(list)
    for p in pats:
        if p["_hk"]:
            by_hk_any[p["_hk"]].append(p)

    clinic_ok = {clinic, ""}

    resolvable = []
    still = []
    skipped = []
    strategies: Counter = Counter()

    for r in um:
        hk = r.get("hkid_norm") or ""
        chart = (r.get("chart_no") or "").strip()
        chart_s = r.get("chart_no_stripped") or norm_pno(chart)
        name = (r.get("name_en") or "").strip().upper()
        net = money(r.get("net_hkd"))
        recv = money(r.get("received_hkd"))
        chosen = None
        method = None
        pref = f"{clinic}{chart}" if chart else ""

        if chart in ("000000", "0") or name == "NEW PATIENT":
            if net <= 0.005 and recv <= 0.005:
                skipped.append(r)
                continue
            still.append(r)
            continue

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

        if not chosen and hk:
            uniq = {p["id"]: p for p in by_hk_any.get(hk, [])}
            if len(uniq) == 1:
                chosen, method = list(uniq.values())[0], "hkid_norm_global_unique"

        if chosen:
            resolvable.append((r, chosen, method))
            strategies[method] += 1
        else:
            still.append(r)

    print("RESOLVABLE", len(resolvable), dict(strategies))
    print("STILL", len(still))
    print("SKIPPED_ZERO", len(skipped))

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    batch_id = f"{branch}_PAY_RESOLVE_{stamp}"

    staging_path = out_dir / f"CS_{branch}_PaymentHistory_resolve_staging_for_supabase.csv"
    map_path = out_dir / f"CS_{branch}_PaymentHistory_resolve_patient_map.csv"
    still_path = out_dir / f"CS_{branch}_PaymentHistory_still_unmatched_manual.csv"

    with staging_path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=STAGING_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r, p, m in resolvable:
            chart = (r.get("chart_no") or "").strip()
            txn = (r.get("txn_code") or "").strip()
            row = {k: ("" if r.get(k) is None else str(r.get(k))) for k in STAGING_FIELDS}
            row.update(
                {
                    "import_key": import_key(batch_id, txn, chart),
                    "batch_id": batch_id,
                    "branch_code": branch,
                    "banana_clinic_tag": clinic,
                    "clinic_code": clinic,
                    "resolved_patient_id": p["id"],
                    "resolve_method": m,
                }
            )
            w.writerow(row)

    with map_path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=[
                "txn_code",
                "chart_no",
                "hkid_raw",
                "name_en",
                "net_hkd",
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
                    "txn_code": r.get("txn_code"),
                    "chart_no": r.get("chart_no"),
                    "hkid_raw": r.get("hkid_raw"),
                    "name_en": r.get("name_en"),
                    "net_hkd": r.get("net_hkd"),
                    "resolve_method": m,
                    "resolved_patient_id": p["id"],
                    "banana_patient_no": p.get("patient_no"),
                    "banana_name": p.get("full_name"),
                    "banana_clinic_tag": p.get("clinic_tag"),
                }
            )

    still_cols = [
        "txn_code",
        "chart_no",
        "hkid_raw",
        "hkid_norm",
        "name_en",
        "bill_date",
        "net_hkd",
        "received_hkd",
        "import_error",
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
        "Next: set cs_import_params.batch_id, import STAGING, "
        "run supabase_cs_payments_resolve_insert.sql (edit batch_id)"
    )


if __name__ == "__main__":
    main()
