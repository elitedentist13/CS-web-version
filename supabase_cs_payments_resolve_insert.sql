-- =============================================================================
-- Resolve-insert for unmatched CS payments (multi-branch)
-- =============================================================================
-- Prep:
--   python resolve-unmatched-payments.py --branch CWB --batch-id CWB_PAY_...
--   → CS_<BRANCH>_PaymentHistory_resolve_staging_for_supabase.csv
--   → prints BATCH_ID = <BRANCH>_PAY_RESOLVE_...
--
-- Steps:
--   0) columns
--   1) clear prior resolve batches for THIS branch only (edit LIKE)
--   2) set cs_import_params.batch_id
--   3) import resolve staging CSV
--   4–8) apply / insert / report (uses active batch_id)
-- Guide: CS_PAYMENTS_SUPABASE_IMPORT.md
-- =============================================================================

-- 0) Columns for pre-resolved patient
ALTER TABLE public.cs_payments_staging
  ADD COLUMN IF NOT EXISTS resolved_patient_id uuid;
ALTER TABLE public.cs_payments_staging
  ADD COLUMN IF NOT EXISTS resolve_method text;

-- 1) Clear prior resolve attempts for this branch only (EDIT branch prefix)
-- DELETE FROM public.cs_payments_staging
-- WHERE batch_id LIKE 'CWB_PAY_RESOLVE_%';

-- 2) Set active batch (EDIT — paste BATCH_ID from resolve-unmatched-payments.py)
UPDATE public.cs_import_params
SET batch_id = 'OKT_PAY_RESOLVE2_20260806_182110',
    require_clinic_scope = true,
    updated_at = now()
WHERE id = 1;

-- 3) Table Editor → import CS_<BRANCH>_PaymentHistory_resolve_staging_for_supabase.csv
--    Map resolved_patient_id + resolve_method if prompted.

-- 4) Apply pre-resolved matches (active batch)
UPDATE public.cs_payments_staging s
SET matched_patient_id = s.resolved_patient_id,
    matched_patient_no = pt.patient_no,
    match_method = coalesce(nullif(s.resolve_method, ''), 'pre_resolved'),
    import_status = 'matched',
    import_error = NULL
FROM public.patients pt
JOIN public.cs_import_params p ON p.id = 1
WHERE s.batch_id = p.batch_id
  AND s.resolved_patient_id IS NOT NULL
  AND pt.id = s.resolved_patient_id;

-- 5) Mark rows still without patient
UPDATE public.cs_payments_staging s
SET import_status = 'unmatched',
    import_error = coalesce(nullif(s.resolve_method, ''), 'no_patient_match')
FROM public.cs_import_params p
WHERE p.id = 1
  AND s.batch_id = p.batch_id
  AND coalesce(s.import_status, 'pending') = 'pending'
  AND s.resolved_patient_id IS NULL;

-- 6) Insert bills (types cast for date/jsonb)
-- Idempotency: CS_TXN:<clinic_tag>:<txn> (preferred). Legacy CS_TXN:<txn> only
-- counts as dup when on the SAME matched patient (txn codes collide across sites).
WITH src AS (
  SELECT
    s.*,
    ('CS_TXN:' || public.normalize_clinic_tag(s.banana_clinic_tag)
      || ':' || trim(s.txn_code)) AS txn_marker,
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
  JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
  WHERE s.import_status = 'matched'
    AND s.matched_patient_id IS NOT NULL
    AND coalesce(trim(s.txn_code), '') <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.bills b
      WHERE b.patient_id = s.matched_patient_id
        AND (
          b.notes LIKE '%CS_TXN:' || public.normalize_clinic_tag(s.banana_clinic_tag)
                       || ':' || trim(s.txn_code) || '%'
          OR b.notes LIKE '%CS_TXN:' || trim(s.txn_code) || '%'
        )
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
JOIN public.cs_import_params p ON p.id = 1
WHERE s.batch_id = p.batch_id
  AND s.import_status = 'matched'
  AND i.notes LIKE '%CS_TXN:' || public.normalize_clinic_tag(s.banana_clinic_tag)
               || ':' || trim(s.txn_code) || '%';

UPDATE public.cs_payments_staging s
SET import_status = 'skipped_dup',
    imported_at = now(),
    import_error = 'already_in_bills',
    inserted_bill_id = b.id
FROM public.bills b
JOIN public.cs_import_params p ON p.id = 1
WHERE s.batch_id = p.batch_id
  AND s.import_status = 'matched'
  AND s.matched_patient_id IS NOT NULL
  AND b.patient_id = s.matched_patient_id
  AND (
    b.notes LIKE '%CS_TXN:' || public.normalize_clinic_tag(s.banana_clinic_tag)
                 || ':' || trim(s.txn_code) || '%'
    OR b.notes LIKE '%CS_TXN:' || trim(s.txn_code) || '%'
  );

-- Ensure payments_json column exists on older staging tables
ALTER TABLE public.cs_payments_staging
  ADD COLUMN IF NOT EXISTS payments_json text;

-- 7a) Installment bill_payments from payments_json (INCOMETABLE)
INSERT INTO public.bill_payments (
  bill_id, paid_date, amount, method, notes, clinic_tag, created_at
)
SELECT
  s.inserted_bill_id,
  CASE
    WHEN coalesce(nullif(trim(j.paid_date), ''), '') ~ '^\d{8}$'
      THEN (
        substring(trim(j.paid_date),1,4) || '-' ||
        substring(trim(j.paid_date),5,2) || '-' ||
        substring(trim(j.paid_date),7,2)
      )::date
    WHEN coalesce(trim(j.paid_date), '') <> ''
      THEN trim(j.paid_date)::date
    WHEN length(trim(s.bill_date)) = 8
      THEN (
        substring(trim(s.bill_date),1,4) || '-' ||
        substring(trim(s.bill_date),5,2) || '-' ||
        substring(trim(s.bill_date),7,2)
      )::date
    ELSE NULL
  END,
  coalesce(j.amount, 0),
  coalesce(nullif(trim(j.method), ''), 'CS Import'),
  'CS_INCOME:' || public.normalize_clinic_tag(s.banana_clinic_tag)
    || ':' || trim(s.txn_code) || ':' || coalesce(j.ord::text, '0'),
  public.normalize_clinic_tag(s.banana_clinic_tag),
  CASE
    WHEN coalesce(trim(j.paid_timestamp), '') <> ''
      THEN (trim(j.paid_timestamp)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
    WHEN coalesce(trim(s.bill_timestamp), '') <> ''
      THEN (trim(s.bill_timestamp)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
    ELSE now()
  END
FROM public.cs_payments_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
CROSS JOIN LATERAL (
  SELECT
    ord::int,
    e->>'paid_date' AS paid_date,
    e->>'paid_timestamp' AS paid_timestamp,
    e->>'method' AS method,
    coalesce(nullif(e->>'amount', '')::numeric, 0) AS amount
  FROM jsonb_array_elements(coalesce(nullif(trim(s.payments_json), '')::jsonb, '[]'::jsonb))
    WITH ORDINALITY AS t(e, ord)
) j
WHERE s.import_status IN ('inserted', 'skipped_dup')
  AND s.inserted_bill_id IS NOT NULL
  AND coalesce(trim(s.payments_json), '') <> ''
  AND coalesce(j.amount, 0) > 0.005
  AND NOT EXISTS (
    SELECT 1 FROM public.bill_payments bp
    WHERE bp.bill_id = s.inserted_bill_id
      AND bp.notes LIKE 'CS_INCOME:' || public.normalize_clinic_tag(s.banana_clinic_tag)
                    || ':' || trim(s.txn_code) || ':%'
  );

-- 7b) Fallback lump-sum when no payments_json
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
  'CS_TXN:' || public.normalize_clinic_tag(s.banana_clinic_tag) || ':' || trim(s.txn_code),
  public.normalize_clinic_tag(s.banana_clinic_tag),
  CASE
    WHEN coalesce(trim(s.bill_timestamp), '') <> ''
      THEN (trim(s.bill_timestamp)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
    ELSE now()
  END
FROM public.cs_payments_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
WHERE s.import_status IN ('inserted', 'skipped_dup')
  AND s.inserted_bill_id IS NOT NULL
  AND coalesce(trim(s.payments_json), '') = ''
  AND coalesce(nullif(trim(s.received_hkd), '')::numeric, 0) > 0.005
  AND NOT EXISTS (
    SELECT 1 FROM public.bill_payments bp
    WHERE bp.bill_id = s.inserted_bill_id
      AND (
        bp.notes LIKE 'CS_INCOME:%'
        OR bp.notes = 'CS_TXN:' || public.normalize_clinic_tag(s.banana_clinic_tag)
                    || ':' || trim(s.txn_code)
        OR bp.notes = 'CS_TXN:' || trim(s.txn_code)
      )
  );

-- 8) Report
SELECT import_status, match_method, import_error, count(*) AS n
FROM public.cs_payments_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
GROUP BY 1, 2, 3
ORDER BY n DESC;
