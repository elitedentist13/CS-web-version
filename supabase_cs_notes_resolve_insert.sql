-- =============================================================================
-- Resolve-insert for unmatched CS consultation notes (multi-branch)
-- =============================================================================
-- Prep:
--   python resolve-unmatched-notes.py --branch PL --batch-id PL_YYYYMMDD_HHMMSS
--   → CS_PL_notes_resolve_staging_for_supabase.csv
--   → prints BATCH_ID = PL_NOTES_RESOLVE_...
--
-- Steps:
--   0) columns
--   1) clear prior resolve batches for THIS branch only (edit LIKE pattern)
--   2) set cs_import_params.batch_id to the new resolve BATCH_ID
--   3) import resolve staging CSV into cs_notes_staging
--   4–6) apply / insert / report (uses active batch_id)
--
-- Dedup: will not re-insert treatments with same patient_id+notes+created_at.
-- Guide: CS_NOTES_SUPABASE_IMPORT.md
-- =============================================================================

-- 0) Columns for pre-resolved patient
ALTER TABLE public.cs_notes_staging
  ADD COLUMN IF NOT EXISTS resolved_patient_id uuid;
ALTER TABLE public.cs_notes_staging
  ADD COLUMN IF NOT EXISTS resolve_method text;

-- 1) Clear prior resolve attempts for this branch only (EDIT branch prefix)
-- DELETE FROM public.cs_notes_staging
-- WHERE batch_id LIKE 'PL_NOTES_RESOLVE_%';

-- 2) Set active batch (EDIT — paste BATCH_ID from resolve-unmatched-notes.py)
UPDATE public.cs_import_params
SET batch_id = 'PASTE_NOTES_RESOLVE_BATCH_ID',
    require_clinic_scope = true,
    updated_at = now()
WHERE id = 1;

-- 3) Table Editor → import CS_<BRANCH>_notes_resolve_staging_for_supabase.csv
--    Map resolved_patient_id + resolve_method if prompted.
--    Leave matched_* / import_status empty.

-- 4) Apply pre-resolved matches (active batch)
UPDATE public.cs_notes_staging s
SET matched_patient_id = s.resolved_patient_id,
    match_method = coalesce(nullif(s.resolve_method, ''), 'pre_resolved'),
    import_status = 'matched',
    import_error = NULL
FROM public.cs_import_params p
WHERE p.id = 1
  AND s.batch_id = p.batch_id
  AND s.resolved_patient_id IS NOT NULL
  AND coalesce(trim(s.notes), '') <> '';

-- Mark rows still without resolved patient
UPDATE public.cs_notes_staging s
SET import_status = 'unmatched',
    import_error = coalesce(nullif(s.resolve_method, ''), 'no_resolved_patient')
FROM public.cs_import_params p
WHERE p.id = 1
  AND s.batch_id = p.batch_id
  AND coalesce(s.import_status, 'pending') = 'pending'
  AND s.resolved_patient_id IS NULL;

-- 5) Insert into treatments (dedup)
WITH to_insert AS (
  SELECT
    s.import_key,
    s.matched_patient_id AS patient_id,
    replace(s.notes, '[[NL]]', E'\n') AS notes,
    nullif(trim(s.doctor_code), '') AS dentist_name,
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
    SELECT 1 FROM public.treatments x
    WHERE x.patient_id = t.patient_id
      AND x.notes IS NOT DISTINCT FROM t.notes
      AND x.created_at IS NOT DISTINCT FROM t.created_at
  )
),
ins AS (
  INSERT INTO public.treatments (patient_id, notes, dentist_name, created_at)
  SELECT patient_id, notes, dentist_name, created_at
  FROM dedup
  RETURNING id
)
UPDATE public.cs_notes_staging s
SET import_status = 'inserted',
    imported_at = now(),
    import_error = NULL
FROM dedup d
WHERE s.import_key = d.import_key;

UPDATE public.cs_notes_staging s
SET import_status = 'skipped_dup',
    imported_at = now(),
    import_error = 'already_in_treatments'
FROM public.cs_import_params p
WHERE p.id = 1
  AND s.batch_id = p.batch_id
  AND s.import_status = 'matched'
  AND EXISTS (
    SELECT 1 FROM public.treatments x
    WHERE x.patient_id = s.matched_patient_id
      AND x.notes IS NOT DISTINCT FROM replace(s.notes, '[[NL]]', E'\n')
      AND x.created_at IS NOT DISTINCT FROM (
        CASE
          WHEN coalesce(trim(s.visit_at), '') <> ''
            THEN (trim(s.visit_at)::timestamp AT TIME ZONE 'Asia/Hong_Kong')
          ELSE now()
        END
      )
  );

-- Optional clinic_tag backfill on just-inserted rows
UPDATE public.treatments t
SET clinic_tag = public.normalize_clinic_tag(s.banana_clinic_tag)
FROM public.cs_notes_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
WHERE s.import_status = 'inserted'
  AND t.patient_id = s.matched_patient_id
  AND t.notes IS NOT DISTINCT FROM replace(s.notes, '[[NL]]', E'\n')
  AND coalesce(t.clinic_tag, '') IS DISTINCT FROM public.normalize_clinic_tag(s.banana_clinic_tag);

-- 6) Report
SELECT import_status, match_method, import_error, count(*) AS n
FROM public.cs_notes_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
GROUP BY 1, 2, 3
ORDER BY n DESC;
