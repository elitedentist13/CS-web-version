-- Resolve-insert for remaining unmatched CS payments (template; TKO example batch below)
-- Full workflow: CS_PAYMENTS_SUPABASE_IMPORT.md (§H)
-- Other branches: rebuild staging with resolved_patient_id, set batch_id, same steps.
--
-- Staging CSV: C:\Users\Doctor-1\Downloads\CS_TKO_PaymentHistory_resolve_staging_for_supabase.csv
-- Batch: TKO_PAY_RESOLVE_20260805_042514
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
SET batch_id = 'TKO_PAY_RESOLVE_20260805_042514',
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
WHERE s.batch_id = 'TKO_PAY_RESOLVE_20260805_042514'
  AND s.resolved_patient_id IS NOT NULL
  AND pt.id = s.resolved_patient_id;

-- 5) Mark rows still without patient
UPDATE public.cs_payments_staging s
SET import_status = 'unmatched',
    import_error = coalesce(nullif(s.resolve_method, ''), 'no_patient_match')
WHERE s.batch_id = 'TKO_PAY_RESOLVE_20260805_042514'
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
  WHERE s.batch_id = 'TKO_PAY_RESOLVE_20260805_042514'
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
WHERE s.batch_id = 'TKO_PAY_RESOLVE_20260805_042514'
  AND s.import_status = 'matched'
  AND i.notes LIKE '%CS_TXN:' || trim(s.txn_code) || '%';

UPDATE public.cs_payments_staging s
SET import_status = 'skipped_dup',
    imported_at = now(),
    import_error = 'already_in_bills',
    inserted_bill_id = b.id
FROM public.bills b
WHERE s.batch_id = 'TKO_PAY_RESOLVE_20260805_042514'
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
WHERE s.batch_id = 'TKO_PAY_RESOLVE_20260805_042514'
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
WHERE batch_id = 'TKO_PAY_RESOLVE_20260805_042514'
GROUP BY 1, 2, 3
ORDER BY n DESC;
