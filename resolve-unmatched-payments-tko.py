"""Build re-import staging CSV for unmatched CS payment rows (TKO)."""
from __future__ import annotations

import csv
import hashlib
import json
import re
import urllib.request
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


def import_key(batch_id: str, txn: str, chart: str) -> str:
    payload = f"{batch_id}|{txn}|{chart}".encode("utf-8", errors="replace")
    return hashlib.sha256(payload).hexdigest()[:40]


def money(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def resolve_row(row: dict, patients_by_hkid_tko: dict, patients_by_pno_tko: dict) -> tuple[str | None, str, str]:
    """Return (patient_id, resolve_method, bucket)."""
    chart = (row.get("chart_no") or "").strip()
    name = (row.get("name_en") or "").strip().upper()
    hkid = norm_hkid(row.get("hkid_norm") or row.get("hkid_raw") or "")
    net = money(row.get("net_hkd"))
    recv = money(row.get("received_hkd"))

    # Zero walk-in stubs — not real identity
    if chart in ("000000", "0") or name == "NEW PATIENT":
        if net <= 0.005 and recv <= 0.005:
            return None, "skip_new_patient_zero", "skip"
        return None, "unresolved_new_patient", "manual"

    # Prefixed chart exact
    pno = f"TKO{chart}"
    if pno in patients_by_pno_tko:
        pid = patients_by_pno_tko[pno]["id"]
        return pid, "patient_no_exact_TKO+chart", "resolvable"

    if hkid and hkid in patients_by_hkid_tko:
        hits = patients_by_hkid_tko[hkid]
        if len(hits) == 1:
            return hits[0]["id"], "hkid_norm+clinic_tag_pre_resolve", "resolvable"
        # Prefer exact TKO+chart when ambiguous
        for h in hits:
            if (h.get("patient_no") or "").strip() == pno:
                return h["id"], "hkid_norm+patient_no_disambiguate", "resolvable"
        return None, "ambiguous_hkid_tko", "manual"

    return None, "no_patient_in_banana_tko", "manual"


def main() -> None:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    batch_id = f"TKO_PAY_RESOLVE_{stamp}"

    unmatched = get_all(
        "cs_payments_staging?import_status=eq.unmatched&select=*&order=txn_code.asc"
    )
    if not unmatched:
        raise SystemExit("No unmatched payment staging rows found.")

    # Load TKO patients (paginated)
    patients = get_all(
        "patients?select=id,patient_no,hkid,full_name,clinic_tag&clinic_tag=eq.TKO&order=patient_no.asc"
    )
    by_hkid: dict[str, list] = {}
    by_pno: dict[str, dict] = {}
    for pt in patients:
        pno = (pt.get("patient_no") or "").strip()
        if pno:
            by_pno[pno] = pt
        h = norm_hkid(pt.get("hkid") or "")
        if h:
            by_hkid.setdefault(h, []).append(pt)

    resolvable: list[dict] = []
    manual: list[dict] = []
    skipped: list[dict] = []

    for row in unmatched:
        pid, method, bucket = resolve_row(row, by_hkid, by_pno)
        out = {k: ("" if row.get(k) is None else str(row.get(k))) for k in STAGING_FIELDS if k not in (
            "import_key", "batch_id", "resolved_patient_id", "resolve_method"
        )}
        # rebuild key fields cleanly
        chart = (row.get("chart_no") or "").strip()
        txn = (row.get("txn_code") or "").strip()
        out.update({
            "import_key": import_key(batch_id, txn, chart),
            "batch_id": batch_id,
            "branch_code": "TKO",
            "banana_clinic_tag": "TKO",
            "txn_code": txn,
            "bill_date": (row.get("bill_date") or "").strip(),
            "bill_timestamp": (row.get("bill_timestamp") or "").strip(),
            "chart_no": chart,
            "chart_no_stripped": (row.get("chart_no_stripped") or "").strip() or (
                chart.lstrip("0") or "0"
            ),
            "hkid_raw": (row.get("hkid_raw") or "").strip(),
            "hkid_norm": norm_hkid(row.get("hkid_norm") or row.get("hkid_raw") or ""),
            "name_en": (row.get("name_en") or "").strip(),
            "name_other": (row.get("name_other") or "").strip(),
            "dob": (row.get("dob") or "").strip(),
            "sex": (row.get("sex") or "").strip(),
            "clinic_code": (row.get("clinic_code") or "TKO").strip() or "TKO",
            "doctor_code": (row.get("doctor_code") or "").strip(),
            "cancel_status": (row.get("cancel_status") or "0").strip() or "0",
            "cancel_label": (row.get("cancel_label") or "Active").strip() or "Active",
            "total_hkd": (row.get("total_hkd") or "0").strip(),
            "discount_hkd": (row.get("discount_hkd") or "0").strip(),
            "net_hkd": (row.get("net_hkd") or "0").strip(),
            "received_hkd": (row.get("received_hkd") or "0").strip(),
            "balance_hkd": (row.get("balance_hkd") or "0").strip(),
            "total_cents": (row.get("total_cents") or "").strip(),
            "received_cents": (row.get("received_cents") or "").strip(),
            "remarks": (row.get("remarks") or "").strip(),
            "diagnosis": (row.get("diagnosis") or "").strip(),
            "items_json": (row.get("items_json") or "").strip(),
            "resolved_patient_id": pid or "",
            "resolve_method": method,
        })
        if bucket == "resolvable":
            resolvable.append(out)
        elif bucket == "skip":
            skipped.append(out)
        else:
            manual.append(out)

    staging_path = OUT_DIR / "CS_TKO_PaymentHistory_resolve_staging_for_supabase.csv"
    # Importable = resolvable + manual (manual has empty resolved_patient_id)
    importable = resolvable + manual
    with staging_path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=STAGING_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in importable:
            w.writerow(r)

    manual_path = OUT_DIR / "CS_TKO_PaymentHistory_still_unmatched_manual.csv"
    with manual_path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=STAGING_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in manual:
            w.writerow(r)

    skip_path = OUT_DIR / "CS_TKO_PaymentHistory_resolve_skipped_new_patient_zero.csv"
    with skip_path.open("w", encoding="utf-8-sig", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=STAGING_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in skipped:
            w.writerow(r)

    sql_path = Path(__file__).with_name("supabase_cs_payments_resolve_insert.sql")
    sql_path.write_text(
        f"""-- Resolve-insert for remaining unmatched TKO CS payments
-- Staging CSV: {staging_path}
-- Batch: {batch_id}
-- Resolvable (pre-linked patient): {len(resolvable)}
-- Still need Banana patient first: {len(manual)} -> {manual_path}
-- Skipped NEW PATIENT $0 stubs: {len(skipped)} -> {skip_path}
-- Idempotent via bills.notes CS_TXN:<txn_code>

-- 0) Columns for pre-resolved patient
ALTER TABLE public.cs_payments_staging
  ADD COLUMN IF NOT EXISTS resolved_patient_id uuid;
ALTER TABLE public.cs_payments_staging
  ADD COLUMN IF NOT EXISTS resolve_method text;

-- 1) Clear prior resolve-batch attempts only
DELETE FROM public.cs_payments_staging
WHERE batch_id LIKE 'TKO_PAY_RESOLVE_%';

-- 2) Set active batch
UPDATE public.cs_import_params
SET batch_id = '{batch_id}',
    require_clinic_scope = true,
    updated_at = now()
WHERE id = 1;

-- 3) Table Editor → Import CSV into cs_payments_staging (header on).
--    Map resolved_patient_id + resolve_method if prompted.

-- 4) Apply pre-resolved matches
UPDATE public.cs_payments_staging s
SET matched_patient_id = s.resolved_patient_id,
    matched_patient_no = pt.patient_no,
    match_method = coalesce(nullif(s.resolve_method, ''), 'pre_resolved'),
    import_status = 'matched',
    import_error = NULL
FROM public.patients pt
WHERE s.batch_id = '{batch_id}'
  AND s.resolved_patient_id IS NOT NULL
  AND pt.id = s.resolved_patient_id;

-- 5) Mark rows still without patient
UPDATE public.cs_payments_staging s
SET import_status = 'unmatched',
    import_error = coalesce(nullif(s.resolve_method, ''), 'no_patient_match')
WHERE s.batch_id = '{batch_id}'
  AND coalesce(s.import_status, 'pending') = 'pending'
  AND s.resolved_patient_id IS NULL;

-- 6) Insert bills (types cast for date/jsonb)
WITH src AS (
  SELECT
    s.*,
    ('CS_TXN:' || trim(s.txn_code)) AS txn_marker,
    CASE
      WHEN length(trim(s.bill_date)) = 8
        THEN (
          substring(trim(s.bill_date),1,4) || '-' ||
          substring(trim(s.bill_date),5,2) || '-' ||
          substring(trim(s.bill_date),7,2)
        )::date
      WHEN coalesce(trim(s.bill_date), '') <> ''
        THEN trim(s.bill_date)::date
      ELSE NULL
    END AS bill_date_iso,
    CASE
      WHEN coalesce(trim(s.bill_timestamp), '') <> ''
        THEN (trim(s.bill_timestamp)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
      ELSE now()
    END AS created_at_ts,
    coalesce(nullif(trim(s.net_hkd), '')::numeric, 0) AS net_n,
    coalesce(nullif(trim(s.discount_hkd), '')::numeric, 0) AS disc_n,
    coalesce(nullif(trim(s.received_hkd), '')::numeric, 0) AS recv_n,
    coalesce(nullif(trim(s.balance_hkd), '')::numeric, 0) AS bal_n
  FROM public.cs_payments_staging s
  WHERE s.batch_id = '{batch_id}'
    AND s.import_status = 'matched'
    AND s.matched_patient_id IS NOT NULL
    AND coalesce(trim(s.txn_code), '') <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.bills b
      WHERE b.notes LIKE '%CS_TXN:' || trim(s.txn_code) || '%'
    )
),
ins AS (
  INSERT INTO public.bills (
    patient_id, patient_no, patient_name, bill_date, bill_type, items,
    subtotal, discount, total, amount_paid, balance, status, notes,
    dentist_name, doctor_name, doctor_tag, created_at
  )
  SELECT
    d.matched_patient_id,
    d.matched_patient_no,
    nullif(trim(d.name_en), ''),
    d.bill_date_iso,
    'CS Import',
    coalesce(
      nullif(trim(d.items_json), '')::jsonb,
      jsonb_build_array(
        jsonb_build_object(
          'desc', coalesce(nullif(trim(d.diagnosis), ''), 'CS imported bill'),
          'qty', 1,
          'price', d.net_n,
          'disc', d.disc_n
        )
      )
    ),
    d.net_n + d.disc_n,
    d.disc_n,
    d.net_n,
    d.recv_n,
    d.bal_n,
    CASE WHEN d.bal_n <= 0.005 THEN 'Paid' ELSE 'Partial' END,
    trim(both ' ' from concat_ws(
      ' | ',
      d.txn_marker,
      nullif(trim(d.remarks), ''),
      nullif(trim(d.diagnosis), ''),
      CASE WHEN coalesce(trim(d.doctor_code), '') <> ''
        THEN 'Doctor: ' || trim(d.doctor_code) ELSE NULL END
    )),
    nullif(trim(d.doctor_code), ''),
    nullif(trim(d.doctor_code), ''),
    nullif(trim(d.doctor_code), ''),
    d.created_at_ts
  FROM src d
  RETURNING id, notes
)
UPDATE public.cs_payments_staging s
SET import_status = 'inserted',
    inserted_bill_id = i.id,
    imported_at = now(),
    import_error = NULL
FROM ins i
WHERE s.batch_id = '{batch_id}'
  AND s.import_status = 'matched'
  AND i.notes LIKE '%CS_TXN:' || trim(s.txn_code) || '%';

UPDATE public.cs_payments_staging s
SET import_status = 'skipped_dup',
    imported_at = now(),
    import_error = 'already_in_bills',
    inserted_bill_id = b.id
FROM public.bills b
WHERE s.batch_id = '{batch_id}'
  AND s.import_status = 'matched'
  AND b.notes LIKE '%CS_TXN:' || trim(s.txn_code) || '%';

-- 7) bill_payments
INSERT INTO public.bill_payments (
  bill_id, paid_date, amount, method, notes, clinic_tag, created_at
)
SELECT
  s.inserted_bill_id,
  CASE
    WHEN length(trim(s.bill_date)) = 8
      THEN (
        substring(trim(s.bill_date),1,4) || '-' ||
        substring(trim(s.bill_date),5,2) || '-' ||
        substring(trim(s.bill_date),7,2)
      )::date
    WHEN coalesce(trim(s.bill_date), '') <> ''
      THEN trim(s.bill_date)::date
    ELSE NULL
  END,
  coalesce(nullif(trim(s.received_hkd), '')::numeric, 0),
  'CS Import',
  'CS_TXN:' || trim(s.txn_code),
  public.normalize_clinic_tag(s.banana_clinic_tag),
  CASE
    WHEN coalesce(trim(s.bill_timestamp), '') <> ''
      THEN (trim(s.bill_timestamp)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
    ELSE now()
  END
FROM public.cs_payments_staging s
WHERE s.batch_id = '{batch_id}'
  AND s.import_status IN ('inserted', 'skipped_dup')
  AND s.inserted_bill_id IS NOT NULL
  AND coalesce(nullif(trim(s.received_hkd), '')::numeric, 0) > 0.005
  AND NOT EXISTS (
    SELECT 1 FROM public.bill_payments bp
    WHERE bp.notes = 'CS_TXN:' || trim(s.txn_code)
  );

-- 8) Report
SELECT import_status, match_method, import_error, count(*) AS n
FROM public.cs_payments_staging
WHERE batch_id = '{batch_id}'
GROUP BY 1, 2, 3
ORDER BY n DESC;
""",
        encoding="utf-8",
    )

    print(f"batch_id={batch_id}")
    print(f"unmatched_source={len(unmatched)}")
    print(f"resolvable={len(resolvable)}")
    print(f"manual={len(manual)}")
    print(f"skipped_new_patient_zero={len(skipped)}")
    print(f"staging={staging_path}")
    print(f"manual_csv={manual_path}")
    print(f"skip_csv={skip_path}")
    print(f"sql={sql_path}")
    for r in resolvable:
        print(f"  OK {r['txn_code']} chart={r['chart_no']} -> {r['resolved_patient_id']} ({r['resolve_method']})")
    for r in manual:
        print(f"  MANUAL {r['txn_code']} chart={r['chart_no']} hkid={r['hkid_norm']} name={r['name_en']} net={r['net_hkd']} ({r['resolve_method']})")
    for r in skipped:
        print(f"  SKIP {r['txn_code']} ({r['resolve_method']})")


if __name__ == "__main__":
    main()
