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
-- Idempotency: bills.notes / bill_payments.notes contain
--   'CS_TXN:<clinic_tag>:<TxnCode>'  (preferred; Softlink txn codes are NOT globally unique)
-- Legacy rows may still use 'CS_TXN:<TxnCode>' — treat as same patient only.
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
  payments_json        text,          -- optional INCOMETABLE receipts [{paid_date,amount,method}]
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

-- Upgrade older staging tables created before INCOMETABLE support
ALTER TABLE public.cs_payments_staging
  ADD COLUMN IF NOT EXISTS payments_json text;
ALTER TABLE public.cs_payments_staging
  ADD COLUMN IF NOT EXISTS items_json text;

-- ---------------------------------------------------------------------------
-- 2) Set active batch (EDIT THIS)
-- ---------------------------------------------------------------------------
UPDATE public.cs_import_params
SET batch_id = 'TKO_PAY_20260807_093314',
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
-- If SQL Editor hits "upstream timeout" on large batches (~10k+ bills),
-- do NOT re-run this whole §5. Use chunked inserts instead:
--   supabase_cs_payments_import_chunked.sql
-- (run BLOCK B / BLOCK C repeatedly until Progress shows matched = 0).
-- ---------------------------------------------------------------------------

-- 5a) Already imported earlier → skipped_dup
-- Only treat as dup when the existing CS_TXN bill is on the SAME matched patient
-- (bare CS_TXN:<txn> is not unique across Softlink / other CS sites).
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
  AND coalesce(trim(s.txn_code), '') <> ''
  AND b.patient_id = s.matched_patient_id
  AND (
    b.notes LIKE '%CS_TXN:' || public.normalize_clinic_tag(s.banana_clinic_tag)
                 || ':' || trim(s.txn_code) || '%'
    OR b.notes LIKE '%CS_TXN:' || trim(s.txn_code) || '%'
  );

-- 5b) Insert new bills
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
  AND i.notes LIKE '%CS_TXN:' || public.normalize_clinic_tag(s.banana_clinic_tag)
               || ':' || trim(s.txn_code) || '%';

-- Ensure payments_json column exists on older staging tables
ALTER TABLE public.cs_payments_staging
  ADD COLUMN IF NOT EXISTS payments_json text;

-- 5c) bill_payments from INCOMETABLE installments (payments_json) when present
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

-- 5d) Fallback lump-sum payment when payments_json is empty
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

-- ---------------------------------------------------------------------------
-- 5e) Re-import expand: replace lump CS Import payments with INCOMETABLE rows
--     Run AFTER §5a–5d when most rows are skipped_dup (bills already exist).
--     Safe: only touches bills linked via staging.inserted_bill_id for this batch.
-- ---------------------------------------------------------------------------

-- Preview how many bills still need method/installment expansion
SELECT
  count(*) FILTER (
    WHERE coalesce(trim(s.payments_json), '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.bill_payments bp
        WHERE bp.bill_id = s.inserted_bill_id
          AND bp.notes LIKE 'CS_INCOME:' || public.normalize_clinic_tag(s.banana_clinic_tag)
                        || ':' || trim(s.txn_code) || ':%'
      )
  ) AS bills_needing_income_expand,
  count(*) FILTER (
    WHERE coalesce(trim(s.payments_json), '') <> ''
      AND EXISTS (
        SELECT 1 FROM public.bill_payments bp
        WHERE bp.bill_id = s.inserted_bill_id
          AND bp.notes LIKE 'CS_INCOME:' || public.normalize_clinic_tag(s.banana_clinic_tag)
                        || ':' || trim(s.txn_code) || ':%'
      )
  ) AS bills_already_have_cs_income
FROM public.cs_payments_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
WHERE s.import_status IN ('inserted', 'skipped_dup')
  AND s.inserted_bill_id IS NOT NULL;

-- Delete lump CS_TXN / CS Import payment rows so installments do not double-count
DELETE FROM public.bill_payments bp
USING public.cs_payments_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
WHERE bp.bill_id = s.inserted_bill_id
  AND s.import_status IN ('inserted', 'skipped_dup')
  AND s.inserted_bill_id IS NOT NULL
  AND coalesce(trim(s.payments_json), '') <> ''
  AND (
    bp.notes LIKE 'CS_TXN:%'
    OR coalesce(bp.method, '') = 'CS Import'
  )
  AND coalesce(bp.notes, '') NOT LIKE 'CS_INCOME:%';

-- Insert real method / installment rows (idempotent via CS_INCOME notes)
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

-- Spot-check: multi-installment bills now have real methods
SELECT
  s.txn_code,
  s.chart_no,
  s.matched_patient_no,
  count(bp.*) AS n_payments,
  string_agg(bp.method || '=' || bp.amount::text, ' | ' ORDER BY bp.created_at, bp.amount) AS methods
FROM public.cs_payments_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
JOIN public.bill_payments bp ON bp.bill_id = s.inserted_bill_id
WHERE s.import_status = 'skipped_dup'
  AND bp.notes LIKE 'CS_INCOME:%'
  AND coalesce(trim(s.payments_json), '') <> ''
  AND (s.payments_json::jsonb) <> '[]'::jsonb
  AND jsonb_array_length(s.payments_json::jsonb) >= 2
GROUP BY 1, 2, 3
ORDER BY n_payments DESC
LIMIT 20;

-- ---------------------------------------------------------------------------
-- 6) Final report
-- ---------------------------------------------------------------------------
SELECT import_status, match_method, import_error, count(*) AS n
FROM public.cs_payments_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
GROUP BY 1, 2, 3
ORDER BY n DESC;
