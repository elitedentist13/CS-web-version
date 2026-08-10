-- =============================================================================
-- Clinic Solution payments §5 — CHUNKED (avoids Supabase SQL Editor timeout)
-- =============================================================================
-- Use when full §5 in supabase_cs_payments_import.sql times out (~15k bills).
--
-- Active batch must already be set, e.g.:
--   UPDATE public.cs_import_params
--   SET batch_id = 'KT_PAY_20260810_030640', require_clinic_scope = true
--   WHERE id = 1;
--
-- Workflow:
--   A) Run "Progress" query
--   B) Run BLOCK A once (or re-run until matched no longer drops via skipped_dup)
--   C) Run BLOCK B repeatedly until matched = 0  (each run inserts ~CHUNK bills)
--   D) Run BLOCK C repeatedly until payments_pending = 0
--   E) Run BLOCK D once (lump-sum fallback)
--   F) Progress / §6 report
--
-- Safe to re-run: skipped_dup / CS_TXN / CS_INCOME notes make steps idempotent.
-- If a chunk still times out, lower CHUNK_BILLS (500 → 250 → 100).
-- =============================================================================

-- Optional: raise per-statement limit for this session (SQL Editor)
SET statement_timeout = '120s';

-- ---------------------------------------------------------------------------
-- Progress (run anytime)
-- ---------------------------------------------------------------------------
SELECT import_status, count(*) AS n
FROM public.cs_payments_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
GROUP BY 1
ORDER BY 1;

SELECT
  count(*) FILTER (WHERE s.import_status = 'matched') AS still_matched,
  count(*) FILTER (WHERE s.import_status = 'inserted') AS inserted,
  count(*) FILTER (WHERE s.import_status = 'skipped_dup') AS skipped_dup,
  count(*) FILTER (
    WHERE s.import_status IN ('inserted', 'skipped_dup')
      AND s.inserted_bill_id IS NOT NULL
      AND coalesce(trim(s.payments_json), '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM public.bill_payments bp
        WHERE bp.bill_id = s.inserted_bill_id
          AND bp.notes LIKE 'CS_INCOME:'
            || public.normalize_clinic_tag(s.banana_clinic_tag)
            || ':' || trim(s.txn_code) || ':%'
      )
  ) AS payments_pending_income,
  count(*) FILTER (
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
          )
      )
  ) AS payments_pending_lump
FROM public.cs_payments_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id;


-- =============================================================================
-- BLOCK A — Mark already-imported CS_TXN bills as skipped_dup (chunk)
-- Re-run until this returns 0 rows updated / still_matched stops falling here.
-- =============================================================================
WITH candidates AS (
  SELECT s.import_key
  FROM public.cs_payments_staging s
  JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
  WHERE s.import_status = 'matched'
    AND s.matched_patient_id IS NOT NULL
    AND coalesce(trim(s.txn_code), '') <> ''
  ORDER BY s.import_key
  LIMIT 800   -- CHUNK_DUP
),
hits AS (
  SELECT DISTINCT ON (s.import_key)
    s.import_key,
    b.id AS bill_id
  FROM candidates c
  JOIN public.cs_payments_staging s ON s.import_key = c.import_key
  JOIN public.bills b
    ON b.patient_id = s.matched_patient_id
   AND (
     b.notes LIKE '%CS_TXN:' || public.normalize_clinic_tag(s.banana_clinic_tag)
                  || ':' || trim(s.txn_code) || '%'
     OR b.notes LIKE '%CS_TXN:' || trim(s.txn_code) || '%'
   )
  ORDER BY s.import_key, b.created_at DESC NULLS LAST
)
UPDATE public.cs_payments_staging s
SET import_status = 'skipped_dup',
    imported_at = now(),
    import_error = 'already_in_bills',
    inserted_bill_id = h.bill_id
FROM hits h
WHERE s.import_key = h.import_key
  AND s.import_status = 'matched';


-- =============================================================================
-- BLOCK B — Insert bills (chunk). RE-RUN until still_matched = 0
-- =============================================================================
WITH candidates AS (
  SELECT s.import_key
  FROM public.cs_payments_staging s
  JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
  WHERE s.import_status = 'matched'
    AND s.matched_patient_id IS NOT NULL
    AND coalesce(trim(s.txn_code), '') <> ''
  ORDER BY s.import_key
  LIMIT 400   -- CHUNK_BILLS  (lower to 200/100 if this still times out)
),
src AS (
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
  JOIN candidates c ON c.import_key = s.import_key
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
JOIN src d
  ON i.notes LIKE '%' || d.txn_marker || '%'
WHERE s.import_key = d.import_key
  AND s.import_status = 'matched';

-- After BLOCK B, re-check Progress. Repeat BLOCK B until still_matched = 0.


-- =============================================================================
-- BLOCK C — Installment / method bill_payments from payments_json (chunk)
-- RE-RUN until payments_pending_income = 0
-- =============================================================================
WITH targets AS (
  SELECT s.import_key
  FROM public.cs_payments_staging s
  JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
  WHERE s.import_status IN ('inserted', 'skipped_dup')
    AND s.inserted_bill_id IS NOT NULL
    AND coalesce(trim(s.payments_json), '') <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.bill_payments bp
      WHERE bp.bill_id = s.inserted_bill_id
        AND bp.notes LIKE 'CS_INCOME:'
          || public.normalize_clinic_tag(s.banana_clinic_tag)
          || ':' || trim(s.txn_code) || ':%'
    )
  ORDER BY s.import_key
  LIMIT 600   -- CHUNK_PAYMENTS
)
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
JOIN targets t ON t.import_key = s.import_key
CROSS JOIN LATERAL (
  SELECT
    ord::int,
    e->>'paid_date' AS paid_date,
    e->>'paid_timestamp' AS paid_timestamp,
    e->>'method' AS method,
    coalesce(nullif(e->>'amount', '')::numeric, 0) AS amount
  FROM jsonb_array_elements(coalesce(nullif(trim(s.payments_json), '')::jsonb, '[]'::jsonb))
    WITH ORDINALITY AS x(e, ord)
) j
WHERE coalesce(j.amount, 0) > 0.005
  AND NOT EXISTS (
    SELECT 1 FROM public.bill_payments bp
    WHERE bp.bill_id = s.inserted_bill_id
      AND bp.notes = 'CS_INCOME:' || public.normalize_clinic_tag(s.banana_clinic_tag)
                  || ':' || trim(s.txn_code) || ':' || coalesce(j.ord::text, '0')
  );


-- =============================================================================
-- BLOCK D — Lump-sum payment when no payments_json (usually small; run once)
-- =============================================================================
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


-- =============================================================================
-- Final report (same as §6)
-- =============================================================================
SELECT import_status, match_method, import_error, count(*) AS n
FROM public.cs_payments_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
GROUP BY 1, 2, 3
ORDER BY n DESC;
