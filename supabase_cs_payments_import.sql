-- =============================================================================
-- Clinic Solution → Banana payment history import (bills + bill_payments)
-- MULTI-BRANCH SAFE — same pattern as consultation notes import
-- =============================================================================
-- Staging CSV: CS_<BRANCH>_PaymentHistory_*_staging_for_supabase.csv
-- Full workflow: CS_PAYMENTS_SUPABASE_IMPORT.md
--
-- After this insert script, every branch should also run:
--   F) items: prefer prepare --items; else supabase_cs_payments_backfill_items.sql
--   G) dups:  find-cs-bill-duplicates.py + supabase_cs_payments_void_duplicates.sql
--
-- Idempotency: bills.notes / bill_payments.notes contain 'CS_TXN:<TxnCode>'
-- Prefer staging items_json filled (jsonb on insert). bill_date cast to date.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Helpers (safe if already created by notes import)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_hkid(raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(coalesce(raw, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.normalize_patient_no(raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN coalesce(trim(raw), '') = '' THEN ''
    WHEN ltrim(trim(raw), '0') = '' THEN '0'
    ELSE ltrim(trim(raw), '0')
  END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_clinic_tag(raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(coalesce(trim(raw), ''), '[^A-Za-z0-9_-]', '', 'g'));
$$;

CREATE TABLE IF NOT EXISTS public.cs_import_params (
  id                   int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  batch_id             text,
  require_clinic_scope boolean NOT NULL DEFAULT true,
  updated_at           timestamptz DEFAULT now()
);
INSERT INTO public.cs_import_params (id, batch_id, require_clinic_scope)
VALUES (1, NULL, true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1) Staging table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_payments_staging (
  import_key           text PRIMARY KEY,
  batch_id             text,
  branch_code          text,
  banana_clinic_tag    text,
  txn_code             text,
  bill_date            text,
  bill_timestamp       text,
  chart_no             text,
  chart_no_stripped    text,
  hkid_raw             text,
  hkid_norm            text,
  name_en              text,
  name_other           text,
  dob                  text,
  sex                  text,
  clinic_code          text,
  doctor_code          text,
  cancel_status        text,
  cancel_label         text,
  total_hkd            text,
  discount_hkd         text,
  net_hkd              text,
  received_hkd         text,
  balance_hkd          text,
  total_cents          text,
  received_cents       text,
  remarks              text,
  diagnosis            text,
  items_json           text,          -- optional enriched line items
  matched_patient_id   uuid,
  matched_patient_no   text,
  match_method         text,
  import_status        text DEFAULT 'pending',
  import_error         text,
  inserted_bill_id     uuid,
  imported_at          timestamptz
);

CREATE INDEX IF NOT EXISTS cs_payments_staging_batch_idx ON public.cs_payments_staging (batch_id);
CREATE INDEX IF NOT EXISTS cs_payments_staging_status_idx ON public.cs_payments_staging (import_status);
CREATE INDEX IF NOT EXISTS cs_payments_staging_hkid_idx ON public.cs_payments_staging (hkid_norm);
CREATE INDEX IF NOT EXISTS cs_payments_staging_txn_idx ON public.cs_payments_staging (txn_code);

-- ---------------------------------------------------------------------------
-- 2) Set active batch (EDIT THIS)
-- ---------------------------------------------------------------------------
UPDATE public.cs_import_params
SET batch_id = 'PASTE_BATCH_ID_FROM_PREPARE_SCRIPT',  -- e.g. from CS_TKO_PaymentHistory_staging_for_supabase_v2.csv
    require_clinic_scope = true,
    updated_at = now()
WHERE id = 1;

-- Optional clear this batch before re-import:
-- DELETE FROM public.cs_payments_staging WHERE batch_id = 'PASTE_BATCH_ID';

-- Then: Table Editor → cs_payments_staging → Import staging CSV

-- ---------------------------------------------------------------------------
-- 3) Match patients (active batch) — clinic-scoped
-- ---------------------------------------------------------------------------

-- Reset matchable rows (does not touch inserted / skipped_dup)
UPDATE public.cs_payments_staging s
SET matched_patient_id = NULL,
    matched_patient_no = NULL,
    match_method = NULL,
    import_status = 'pending',
    import_error = NULL
FROM public.cs_import_params p
WHERE p.id = 1
  AND s.batch_id = p.batch_id
  AND coalesce(s.import_status, 'pending') IN ('pending', 'unmatched', 'matched', 'skipped_placeholder');

-- 3-pre) Skip CS placeholder patients (CHECKING / 對數 / 对数).
-- Temp walk-in names; real patient + payment already exist in Banana → would duplicate.
UPDATE public.cs_payments_staging s
SET import_status = 'skipped_placeholder',
    import_error = 'placeholder_CHECKING_or_對數_already_in_Banana',
    matched_patient_id = NULL,
    matched_patient_no = NULL,
    match_method = NULL
FROM public.cs_import_params p
WHERE p.id = 1
  AND s.batch_id = p.batch_id
  AND coalesce(s.import_status, 'pending') = 'pending'
  AND (
       upper(coalesce(s.name_en, '')) LIKE '%CHECKING%'
    OR upper(coalesce(s.name_en, '')) LIKE '%CHECKIN%'
    OR coalesce(s.name_en, '') LIKE '%對數%'
    OR coalesce(s.name_other, '') LIKE '%對數%'
    OR coalesce(s.name_en, '') LIKE '%对数%'
    OR coalesce(s.name_other, '') LIKE '%对数%'
  );

-- Match order (mirrors notes import; SKW charts often have blank clinic_tag):
--   3A)  hkid_norm + clinic_tag
--   3A2) hkid_norm unique among blank clinic_tag (or scope off)
--   3B)  patient_no = chart_no + clinic_tag
--   3B1) patient_no = <clinic_tag> || chart_no + clinic_tag
--   3B2) patient_no = chart_no among blank clinic_tag (SKW legacy)
--   3C)  patient_no stripped + clinic_tag

-- 3A) HKID + clinic_tag
WITH hits AS (
  SELECT s.import_key, pt.id AS patient_id, pt.patient_no,
         count(*) OVER (PARTITION BY s.import_key) AS hit_count
  FROM public.cs_payments_staging s
  JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
  JOIN public.patients pt
    ON public.normalize_hkid(pt.hkid) = s.hkid_norm
   AND coalesce(s.hkid_norm, '') <> ''
   AND public.normalize_clinic_tag(pt.clinic_tag)
       = public.normalize_clinic_tag(s.banana_clinic_tag)
   AND coalesce(public.normalize_clinic_tag(s.banana_clinic_tag), '') <> ''
  WHERE coalesce(s.import_status, 'pending') = 'pending'
)
UPDATE public.cs_payments_staging s
SET matched_patient_id = h.patient_id,
    matched_patient_no = h.patient_no,
    match_method = 'hkid_norm+clinic_tag',
    import_status = 'matched'
FROM hits h
WHERE s.import_key = h.import_key AND h.hit_count = 1;

WITH ambig AS (
  SELECT s.import_key
  FROM public.cs_payments_staging s
  JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
  JOIN public.patients pt
    ON public.normalize_hkid(pt.hkid) = s.hkid_norm
   AND coalesce(s.hkid_norm, '') <> ''
   AND public.normalize_clinic_tag(pt.clinic_tag)
       = public.normalize_clinic_tag(s.banana_clinic_tag)
  WHERE coalesce(s.import_status, 'pending') = 'pending'
  GROUP BY s.import_key
  HAVING count(*) > 1
)
UPDATE public.cs_payments_staging s
SET import_status = 'unmatched',
    import_error = 'ambiguous_hkid_norm+clinic_tag'
FROM ambig a
WHERE s.import_key = a.import_key;

-- 3A2) HKID unique among blank-clinic / when scope disabled
WITH hits AS (
  SELECT s.import_key, pt.id AS patient_id, pt.patient_no,
         count(*) OVER (PARTITION BY s.import_key) AS hit_count
  FROM public.cs_payments_staging s
  JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
  JOIN public.patients pt
    ON public.normalize_hkid(pt.hkid) = s.hkid_norm
   AND coalesce(s.hkid_norm, '') <> ''
   AND (
        prm.require_clinic_scope = false
        OR coalesce(public.normalize_clinic_tag(pt.clinic_tag), '') = ''
      )
  WHERE coalesce(s.import_status, 'pending') = 'pending'
)
UPDATE public.cs_payments_staging s
SET matched_patient_id = h.patient_id,
    matched_patient_no = h.patient_no,
    match_method = 'hkid_norm',
    import_status = 'matched'
FROM hits h
WHERE s.import_key = h.import_key AND h.hit_count = 1;

WITH ambig AS (
  SELECT s.import_key
  FROM public.cs_payments_staging s
  JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
  JOIN public.patients pt
    ON public.normalize_hkid(pt.hkid) = s.hkid_norm
   AND coalesce(s.hkid_norm, '') <> ''
   AND (
        prm.require_clinic_scope = false
        OR coalesce(public.normalize_clinic_tag(pt.clinic_tag), '') = ''
      )
  WHERE coalesce(s.import_status, 'pending') = 'pending'
  GROUP BY s.import_key
  HAVING count(*) > 1
)
UPDATE public.cs_payments_staging s
SET import_status = 'unmatched',
    import_error = 'ambiguous_hkid_norm'
FROM ambig a
WHERE s.import_key = a.import_key;

-- 3B) Exact patient_no + clinic_tag
WITH hits AS (
  SELECT s.import_key, pt.id AS patient_id, pt.patient_no,
         count(*) OVER (PARTITION BY s.import_key) AS hit_count
  FROM public.cs_payments_staging s
  JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
  JOIN public.patients pt
    ON trim(pt.patient_no) = trim(s.chart_no)
   AND coalesce(trim(s.chart_no), '') <> ''
   AND public.normalize_clinic_tag(pt.clinic_tag)
       = public.normalize_clinic_tag(s.banana_clinic_tag)
   AND coalesce(public.normalize_clinic_tag(s.banana_clinic_tag), '') <> ''
  WHERE coalesce(s.import_status, 'pending') = 'pending'
)
UPDATE public.cs_payments_staging s
SET matched_patient_id = h.patient_id,
    matched_patient_no = h.patient_no,
    match_method = 'patient_no_exact+clinic_tag',
    import_status = 'matched'
FROM hits h
WHERE s.import_key = h.import_key AND h.hit_count = 1;

-- 3B1) Prefixed chart: patient_no = CWB||chart (or TKO||chart etc.)
WITH hits AS (
  SELECT s.import_key, pt.id AS patient_id, pt.patient_no,
         count(*) OVER (PARTITION BY s.import_key) AS hit_count
  FROM public.cs_payments_staging s
  JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
  JOIN public.patients pt
    ON trim(pt.patient_no)
       = public.normalize_clinic_tag(s.banana_clinic_tag) || trim(s.chart_no)
   AND coalesce(trim(s.chart_no), '') <> ''
   AND public.normalize_clinic_tag(pt.clinic_tag)
       = public.normalize_clinic_tag(s.banana_clinic_tag)
   AND coalesce(public.normalize_clinic_tag(s.banana_clinic_tag), '') <> ''
  WHERE coalesce(s.import_status, 'pending') = 'pending'
)
UPDATE public.cs_payments_staging s
SET matched_patient_id = h.patient_id,
    matched_patient_no = h.patient_no,
    match_method = 'patient_no_prefixed+clinic_tag',
    import_status = 'matched'
FROM hits h
WHERE s.import_key = h.import_key AND h.hit_count = 1;

-- 3B2) Exact chart among blank clinic_tag (SKW legacy rows)
WITH hits AS (
  SELECT s.import_key, pt.id AS patient_id, pt.patient_no,
         count(*) OVER (PARTITION BY s.import_key) AS hit_count
  FROM public.cs_payments_staging s
  JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
  JOIN public.patients pt
    ON trim(pt.patient_no) = trim(s.chart_no)
   AND coalesce(trim(s.chart_no), '') <> ''
   AND coalesce(public.normalize_clinic_tag(pt.clinic_tag), '') = ''
  WHERE coalesce(s.import_status, 'pending') = 'pending'
)
UPDATE public.cs_payments_staging s
SET matched_patient_id = h.patient_id,
    matched_patient_no = h.patient_no,
    match_method = 'patient_no_exact+blank_clinic',
    import_status = 'matched'
FROM hits h
WHERE s.import_key = h.import_key AND h.hit_count = 1;

-- 3C) Stripped patient_no + clinic_tag
WITH hits AS (
  SELECT s.import_key, pt.id AS patient_id, pt.patient_no,
         count(*) OVER (PARTITION BY s.import_key) AS hit_count
  FROM public.cs_payments_staging s
  JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
  JOIN public.patients pt
    ON public.normalize_patient_no(pt.patient_no)
       = coalesce(nullif(s.chart_no_stripped, ''), public.normalize_patient_no(s.chart_no))
   AND coalesce(s.chart_no_stripped, '') <> ''
   AND public.normalize_clinic_tag(pt.clinic_tag)
       = public.normalize_clinic_tag(s.banana_clinic_tag)
   AND coalesce(public.normalize_clinic_tag(s.banana_clinic_tag), '') <> ''
  WHERE coalesce(s.import_status, 'pending') = 'pending'
)
UPDATE public.cs_payments_staging s
SET matched_patient_id = h.patient_id,
    matched_patient_no = h.patient_no,
    match_method = 'patient_no_stripped+clinic_tag',
    import_status = 'matched'
FROM hits h
WHERE s.import_key = h.import_key AND h.hit_count = 1;

UPDATE public.cs_payments_staging s
SET import_status = 'unmatched',
    import_error = coalesce(s.import_error, 'no_patient_match')
FROM public.cs_import_params p
WHERE p.id = 1
  AND s.batch_id = p.batch_id
  AND coalesce(s.import_status, 'pending') = 'pending';

-- ---------------------------------------------------------------------------
-- 4) Preview
-- ---------------------------------------------------------------------------
SELECT import_status, match_method, import_error, count(*) AS n
FROM public.cs_payments_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
GROUP BY 1, 2, 3
ORDER BY n DESC;

-- ---------------------------------------------------------------------------
-- 5) Insert bills (+ bill_payments when received > 0)
-- ---------------------------------------------------------------------------

-- 5a) Already imported earlier → skipped_dup
UPDATE public.cs_payments_staging s
SET import_status = 'skipped_dup',
    imported_at = now(),
    import_error = 'already_in_bills',
    inserted_bill_id = b.id
FROM public.bills b
JOIN public.cs_import_params p ON p.id = 1
WHERE s.batch_id = p.batch_id
  AND s.import_status = 'matched'
  AND b.notes LIKE '%CS_TXN:' || trim(s.txn_code) || '%';

-- 5b) Insert new bills
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
  JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
  WHERE s.import_status = 'matched'
    AND s.matched_patient_id IS NOT NULL
    AND coalesce(trim(s.txn_code), '') <> ''
),
ins AS (
  INSERT INTO public.bills (
    patient_id,
    patient_no,
    patient_name,
    bill_date,
    bill_type,
    items,
    subtotal,
    discount,
    total,
    amount_paid,
    balance,
    status,
    notes,
    dentist_name,
    doctor_name,
    doctor_tag,
    created_at
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
    trim(
      both ' '
      from concat_ws(
        ' | ',
        d.txn_marker,
        nullif(trim(d.remarks), ''),
        nullif(trim(d.diagnosis), ''),
        CASE WHEN coalesce(trim(d.doctor_code), '') <> ''
          THEN 'Doctor: ' || trim(d.doctor_code) ELSE NULL END
      )
    ),
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
WHERE s.import_status = 'matched'
  AND i.notes LIKE '%CS_TXN:' || trim(s.txn_code) || '%';

-- 5c) bill_payments for received > 0 (idempotent on CS_TXN note)
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
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
WHERE s.import_status IN ('inserted', 'skipped_dup')
  AND s.inserted_bill_id IS NOT NULL
  AND coalesce(nullif(trim(s.received_hkd), '')::numeric, 0) > 0.005
  AND NOT EXISTS (
    SELECT 1 FROM public.bill_payments bp
    WHERE bp.notes = 'CS_TXN:' || trim(s.txn_code)
  );

-- ---------------------------------------------------------------------------
-- 6) Final report
-- ---------------------------------------------------------------------------
SELECT import_status, match_method, import_error, count(*) AS n
FROM public.cs_payments_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
GROUP BY 1, 2, 3
ORDER BY n DESC;
