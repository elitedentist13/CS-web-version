-- =============================================================================
-- Clinic Solution → Banana consultation notes → treatments
-- MULTI-BRANCH SAFE
-- =============================================================================
-- Full workflow: CS_NOTES_SUPABASE_IMPORT.md
--
-- Per branch:
--   1) export-cs-notes.ps1 -Branch PL
--   2) prepare-cs-staging-csv.py --source "..._notes.csv" --branch PL --clinic-tag PL
--   3) §0–1 once; §2 set batch_id; import staging CSV
--   4) §3 match → §4 preview → §5 insert → §6 report
--   5) Unmatched: resolve-unmatched-notes.py + supabase_cs_notes_resolve_insert.sql
--
-- Match order (active batch_id only):
--   A) hkid_norm + clinic_tag
--   B) hkid_norm unique (blank clinic / scope off)
--   C) patient_no = chart_no + clinic_tag
--   C2) patient_no = <clinic_tag> || chart_no + clinic_tag   (e.g. TKO003826)
--   D) patient_no stripped + clinic_tag
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_hkid(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(coalesce(raw, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION public.normalize_patient_no(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN coalesce(trim(raw), '') = '' THEN ''
    WHEN ltrim(trim(raw), '0') = '' THEN '0'
    ELSE ltrim(trim(raw), '0')
  END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_clinic_tag(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(coalesce(trim(raw), ''), '[^A-Za-z0-9_-]', '', 'g'));
$$;

-- Session params for the active import batch
CREATE TABLE IF NOT EXISTS public.cs_import_params (
  id                     int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  batch_id               text,
  require_clinic_scope   boolean NOT NULL DEFAULT true,
  updated_at             timestamptz DEFAULT now()
);

INSERT INTO public.cs_import_params (id, batch_id, require_clinic_scope)
VALUES (1, NULL, true)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1) Staging table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cs_notes_staging (
  import_key           text PRIMARY KEY,
  batch_id             text,
  branch_code          text,
  banana_clinic_tag    text,
  hkid_raw             text,
  hkid_norm            text,
  chart_no             text,
  chart_no_stripped    text,
  name_en              text,
  name_other           text,
  dob                  text,
  sex                  text,
  visit_date           text,
  visit_at             text,
  clinic_code          text,
  doctor_code          text,
  record_type          text,
  notes                text,
  matched_patient_id   uuid,
  match_method         text,
  import_status        text DEFAULT 'pending',
  import_error         text,
  imported_at          timestamptz
);

-- Upgrade older staging tables (safe to re-run)
ALTER TABLE public.cs_notes_staging ADD COLUMN IF NOT EXISTS batch_id text;
ALTER TABLE public.cs_notes_staging ADD COLUMN IF NOT EXISTS branch_code text;
ALTER TABLE public.cs_notes_staging ADD COLUMN IF NOT EXISTS banana_clinic_tag text;

CREATE INDEX IF NOT EXISTS cs_notes_staging_hkid_norm_idx
  ON public.cs_notes_staging (hkid_norm);
CREATE INDEX IF NOT EXISTS cs_notes_staging_chart_no_idx
  ON public.cs_notes_staging (chart_no);
CREATE INDEX IF NOT EXISTS cs_notes_staging_status_idx
  ON public.cs_notes_staging (import_status);
CREATE INDEX IF NOT EXISTS cs_notes_staging_batch_idx
  ON public.cs_notes_staging (batch_id);
CREATE INDEX IF NOT EXISTS cs_notes_staging_branch_idx
  ON public.cs_notes_staging (branch_code);
CREATE INDEX IF NOT EXISTS cs_notes_staging_clinic_tag_idx
  ON public.cs_notes_staging (banana_clinic_tag);

COMMENT ON TABLE public.cs_notes_staging IS
  'Multi-branch CS notes staging. Filter work by batch_id; match patients with clinic_tag scope.';

-- ---------------------------------------------------------------------------
-- 2) Set active batch + optional cleanup of THAT batch only
-- ---------------------------------------------------------------------------
-- >>> EDIT batch_id to the value printed by prepare-cs-staging-csv.py <<<
UPDATE public.cs_import_params
SET batch_id = 'REPLACE_WITH_BATCH_ID',   -- e.g. TKO_20260804_050112
    require_clinic_scope = true,            -- keep true for multi-branch safety
    updated_at = now()
WHERE id = 1;

-- Optional: remove only this batch before re-importing the same CSV
-- DELETE FROM public.cs_notes_staging s
-- USING public.cs_import_params p
-- WHERE p.id = 1 AND s.batch_id = p.batch_id;

-- Do NOT TRUNCATE the whole table if other branches' staging history must remain.
-- TRUNCATE public.cs_notes_staging;  -- full wipe (all branches)

-- After setting batch_id: Table Editor → Import CSV into cs_notes_staging
-- (header row on; leave matched_* / import_* empty)

-- ---------------------------------------------------------------------------
-- 3) Match staging rows → patients.id  (active batch only)
-- ---------------------------------------------------------------------------
UPDATE public.cs_notes_staging s
SET matched_patient_id = NULL,
    match_method = NULL,
    import_status = 'pending',
    import_error = NULL
FROM public.cs_import_params p
WHERE p.id = 1
  AND s.batch_id = p.batch_id
  AND coalesce(s.import_status, 'pending') IN ('pending', 'unmatched', 'matched');

-- 3A) HKID + clinic_tag (preferred, multi-branch safe)
WITH hkid_clinic_hits AS (
  SELECT
    s.import_key,
    pt.id AS patient_id,
    count(*) OVER (PARTITION BY s.import_key) AS hit_count
  FROM public.cs_notes_staging s
  JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
  JOIN public.patients pt
    ON public.normalize_hkid(pt.hkid) = s.hkid_norm
   AND coalesce(s.hkid_norm, '') <> ''
   AND public.normalize_clinic_tag(pt.clinic_tag)
       = public.normalize_clinic_tag(s.banana_clinic_tag)
   AND coalesce(public.normalize_clinic_tag(s.banana_clinic_tag), '') <> ''
  WHERE coalesce(s.import_status, 'pending') = 'pending'
)
UPDATE public.cs_notes_staging s
SET matched_patient_id = h.patient_id,
    match_method = 'hkid_norm+clinic_tag',
    import_status = 'matched'
FROM hkid_clinic_hits h
WHERE s.import_key = h.import_key
  AND h.hit_count = 1;

-- Ambiguous HKID within same clinic
WITH hkid_clinic_ambig AS (
  SELECT s.import_key
  FROM public.cs_notes_staging s
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
UPDATE public.cs_notes_staging s
SET import_status = 'unmatched',
    import_error = 'ambiguous_hkid_norm+clinic_tag'
FROM hkid_clinic_ambig a
WHERE s.import_key = a.import_key;

-- 3A2) HKID only — allowed when:
--   - require_clinic_scope = false, OR
--   - matching patient has blank clinic_tag (legacy rows)
-- Still requires the HKID to resolve to exactly one patient.
WITH hkid_global_hits AS (
  SELECT
    s.import_key,
    pt.id AS patient_id,
    count(*) OVER (PARTITION BY s.import_key) AS hit_count
  FROM public.cs_notes_staging s
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
UPDATE public.cs_notes_staging s
SET matched_patient_id = h.patient_id,
    match_method = 'hkid_norm',
    import_status = 'matched'
FROM hkid_global_hits h
WHERE s.import_key = h.import_key
  AND h.hit_count = 1;

WITH hkid_global_ambig AS (
  SELECT s.import_key
  FROM public.cs_notes_staging s
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
UPDATE public.cs_notes_staging s
SET import_status = 'unmatched',
    import_error = 'ambiguous_hkid_norm'
FROM hkid_global_ambig a
WHERE s.import_key = a.import_key;

-- 3B) Exact patient_no + clinic_tag (ALWAYS clinic-scoped when tag present)
WITH pno_hits AS (
  SELECT
    s.import_key,
    pt.id AS patient_id,
    count(*) OVER (PARTITION BY s.import_key) AS hit_count
  FROM public.cs_notes_staging s
  JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
  JOIN public.patients pt
    ON trim(pt.patient_no) = trim(s.chart_no)
   AND coalesce(trim(s.chart_no), '') <> ''
   AND public.normalize_clinic_tag(pt.clinic_tag)
       = public.normalize_clinic_tag(s.banana_clinic_tag)
   AND coalesce(public.normalize_clinic_tag(s.banana_clinic_tag), '') <> ''
  WHERE coalesce(s.import_status, 'pending') = 'pending'
)
UPDATE public.cs_notes_staging s
SET matched_patient_id = h.patient_id,
    match_method = 'patient_no_exact+clinic_tag',
    import_status = 'matched'
FROM pno_hits h
WHERE s.import_key = h.import_key
  AND h.hit_count = 1;

-- 3B1) Prefixed chart: patient_no = TKO003826 when CS chart = 003826
WITH pno_pref_hits AS (
  SELECT
    s.import_key,
    pt.id AS patient_id,
    count(*) OVER (PARTITION BY s.import_key) AS hit_count
  FROM public.cs_notes_staging s
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
UPDATE public.cs_notes_staging s
SET matched_patient_id = h.patient_id,
    match_method = 'patient_no_prefixed+clinic_tag',
    import_status = 'matched'
FROM pno_pref_hits h
WHERE s.import_key = h.import_key
  AND h.hit_count = 1;

-- 3B2) Exact patient_no without clinic (only if require_clinic_scope = false)
WITH pno_global AS (
  SELECT
    s.import_key,
    pt.id AS patient_id,
    count(*) OVER (PARTITION BY s.import_key) AS hit_count
  FROM public.cs_notes_staging s
  JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
  JOIN public.patients pt
    ON trim(pt.patient_no) = trim(s.chart_no)
   AND coalesce(trim(s.chart_no), '') <> ''
  WHERE coalesce(s.import_status, 'pending') = 'pending'
    AND prm.require_clinic_scope = false
)
UPDATE public.cs_notes_staging s
SET matched_patient_id = h.patient_id,
    match_method = 'patient_no_exact',
    import_status = 'matched'
FROM pno_global h
WHERE s.import_key = h.import_key
  AND h.hit_count = 1;

-- 3C) Stripped patient_no + clinic_tag
WITH pno_strip_hits AS (
  SELECT
    s.import_key,
    pt.id AS patient_id,
    count(*) OVER (PARTITION BY s.import_key) AS hit_count
  FROM public.cs_notes_staging s
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
UPDATE public.cs_notes_staging s
SET matched_patient_id = h.patient_id,
    match_method = 'patient_no_stripped+clinic_tag',
    import_status = 'matched'
FROM pno_strip_hits h
WHERE s.import_key = h.import_key
  AND h.hit_count = 1;

-- Remaining pending in this batch → unmatched
UPDATE public.cs_notes_staging s
SET import_status = 'unmatched',
    import_error = coalesce(s.import_error, 'no_patient_match')
FROM public.cs_import_params p
WHERE p.id = 1
  AND s.batch_id = p.batch_id
  AND coalesce(s.import_status, 'pending') = 'pending';

-- ---------------------------------------------------------------------------
-- 4) Preview (active batch)
-- ---------------------------------------------------------------------------
SELECT s.import_status, s.match_method, s.branch_code, s.banana_clinic_tag, count(*) AS n
FROM public.cs_notes_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2;

-- Unmatched sample
-- SELECT s.chart_no, s.hkid_raw, s.hkid_norm, s.banana_clinic_tag, s.name_en, s.import_error,
--        left(s.notes, 80) AS notes_preview
-- FROM public.cs_notes_staging s
-- JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
-- WHERE s.import_status = 'unmatched'
-- ORDER BY s.chart_no
-- LIMIT 200;

-- ---------------------------------------------------------------------------
-- 5) Insert matched rows into treatments (active batch only)
-- ---------------------------------------------------------------------------
WITH to_insert AS (
  SELECT
    s.import_key,
    s.matched_patient_id AS patient_id,
    s.notes,
    nullif(trim(s.doctor_code), '') AS dentist_name,
    nullif(public.normalize_clinic_tag(s.banana_clinic_tag), '') AS clinic_tag,
    CASE
      WHEN coalesce(trim(s.visit_at), '') <> ''
        THEN (trim(s.visit_at)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
      ELSE now()
    END AS created_at
  FROM public.cs_notes_staging s
  JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
  WHERE s.import_status = 'matched'
    AND s.matched_patient_id IS NOT NULL
    AND coalesce(trim(s.notes), '') <> ''
),
dedup AS (
  SELECT t.*
  FROM to_insert t
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.treatments x
    WHERE x.patient_id = t.patient_id
      AND x.notes IS NOT DISTINCT FROM t.notes
      AND x.created_at IS NOT DISTINCT FROM t.created_at
  )
),
ins AS (
  INSERT INTO public.treatments (
    patient_id,
    notes,
    dentist_name,
    created_at
  )
  SELECT
    patient_id,
    notes,
    dentist_name,
    created_at
  FROM dedup
  RETURNING id
)
UPDATE public.cs_notes_staging s
SET import_status = 'inserted',
    imported_at = now(),
    import_error = NULL
FROM dedup d
WHERE s.import_key = d.import_key;

-- Mark duplicates already present
UPDATE public.cs_notes_staging s
SET import_status = 'skipped_dup',
    imported_at = now(),
    import_error = 'already_in_treatments'
FROM public.cs_import_params p
WHERE p.id = 1
  AND s.batch_id = p.batch_id
  AND s.import_status = 'matched'
  AND EXISTS (
    SELECT 1
    FROM public.treatments x
    WHERE x.patient_id = s.matched_patient_id
      AND x.notes IS NOT DISTINCT FROM s.notes
      AND x.created_at IS NOT DISTINCT FROM (
        CASE
          WHEN coalesce(trim(s.visit_at), '') <> ''
            THEN (trim(s.visit_at)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
          ELSE now()
        END
      )
  );

-- Backfill clinic_tag on inserted treatments (skip if column missing → comment out)
UPDATE public.treatments t
SET clinic_tag = public.normalize_clinic_tag(s.banana_clinic_tag)
FROM public.cs_notes_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
WHERE s.import_status = 'inserted'
  AND t.patient_id = s.matched_patient_id
  AND t.notes IS NOT DISTINCT FROM s.notes
  AND t.created_at IS NOT DISTINCT FROM (
        CASE
          WHEN coalesce(trim(s.visit_at), '') <> ''
            THEN (trim(s.visit_at)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
          ELSE t.created_at
        END
      )
  AND coalesce(public.normalize_clinic_tag(s.banana_clinic_tag), '') <> ''
  AND coalesce(t.clinic_tag, '') IS DISTINCT FROM public.normalize_clinic_tag(s.banana_clinic_tag);

-- ---------------------------------------------------------------------------
-- 6) Final report (active batch + all batches overview)
-- ---------------------------------------------------------------------------
SELECT 'active_batch' AS scope, s.import_status, s.match_method, s.branch_code, count(*) AS n
FROM public.cs_notes_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
GROUP BY 1, 2, 3, 4
UNION ALL
SELECT 'all_batches', s.import_status, s.match_method, s.branch_code, count(*)
FROM public.cs_notes_staging s
GROUP BY 1, 2, 3, 4
ORDER BY 1, 4, 2, 3;

-- Batch inventory
-- SELECT batch_id, branch_code, banana_clinic_tag, import_status, count(*)
-- FROM public.cs_notes_staging
-- GROUP BY 1, 2, 3, 4
-- ORDER BY 1, 4;

-- ---------------------------------------------------------------------------
-- 7) Rollback THIS batch only (careful)
-- ---------------------------------------------------------------------------
-- DELETE FROM public.treatments t
-- USING public.cs_notes_staging s
-- JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
-- WHERE s.import_status = 'inserted'
--   AND t.patient_id = s.matched_patient_id
--   AND t.notes IS NOT DISTINCT FROM s.notes
--   AND t.created_at IS NOT DISTINCT FROM (
--         trim(s.visit_at)::timestamp AT TIME ZONE 'Asia/Hong_Kong'
--       );
