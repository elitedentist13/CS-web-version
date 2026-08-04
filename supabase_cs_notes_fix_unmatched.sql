-- =============================================================================
-- Inspect / rematch unmatched CS notes (active batch)
-- MULTI-BRANCH — uses cs_import_params.batch_id
-- =============================================================================

-- 1) Counts for active batch
SELECT import_status, match_method, import_error, count(*) AS n
FROM public.cs_notes_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
GROUP BY 1, 2, 3
ORDER BY n DESC;

-- 2) Show unmatched rows (active batch)
SELECT
  s.import_key,
  s.batch_id,
  s.branch_code,
  s.banana_clinic_tag,
  s.chart_no,
  s.hkid_raw,
  s.hkid_norm,
  s.name_en,
  s.name_other,
  s.dob,
  s.doctor_code,
  s.visit_at,
  s.import_error,
  left(s.notes, 120) AS notes_preview
FROM public.cs_notes_staging s
JOIN public.cs_import_params p ON p.id = 1 AND s.batch_id = p.batch_id
WHERE s.import_status = 'unmatched'
ORDER BY s.chart_no;

-- 3) Banana patient by normalized HKID (any clinic — diagnose tag mismatch)
SELECT
  s.chart_no,
  s.hkid_norm,
  s.banana_clinic_tag AS staging_clinic,
  p.id AS patient_id,
  p.patient_no,
  p.clinic_tag AS banana_clinic,
  p.full_name,
  p.hkid
FROM public.cs_notes_staging s
JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
LEFT JOIN public.patients p
  ON public.normalize_hkid(p.hkid) = s.hkid_norm
 AND coalesce(s.hkid_norm, '') <> ''
WHERE s.import_status = 'unmatched';

-- 4) Banana patient by chart / prefixed chart + clinic
SELECT
  s.chart_no,
  s.chart_no_stripped,
  s.banana_clinic_tag AS staging_clinic,
  p.id AS patient_id,
  p.patient_no,
  p.clinic_tag AS banana_clinic,
  p.full_name
FROM public.cs_notes_staging s
JOIN public.cs_import_params prm ON prm.id = 1 AND s.batch_id = prm.batch_id
LEFT JOIN public.patients p
  ON public.normalize_clinic_tag(p.clinic_tag)
     = public.normalize_clinic_tag(s.banana_clinic_tag)
 AND (
      trim(p.patient_no) = trim(s.chart_no)
      OR trim(p.patient_no)
         = public.normalize_clinic_tag(s.banana_clinic_tag) || trim(s.chart_no)
      OR public.normalize_patient_no(p.patient_no) = s.chart_no_stripped
     )
WHERE s.import_status = 'unmatched';

-- =============================================================================
-- Repair options
-- =============================================================================
-- A) Fix patients.clinic_tag / hkid / patient_no in Banana, then:
--    reset unmatched → pending and re-run supabase_cs_notes_import.sql §3 + §5
--
-- B) Automated resolve package:
--    python resolve-unmatched-notes.py --branch PL --batch-id <ACTIVE_BATCH>
--    → supabase_cs_notes_resolve_insert.sql
--
-- C) Manual link one row (replace PATIENT_UUID and import_key):
-- UPDATE public.cs_notes_staging
-- SET matched_patient_id = 'PATIENT_UUID'::uuid,
--     match_method = 'manual',
--     import_status = 'matched',
--     import_error = NULL
-- WHERE import_key = 'IMPORT_KEY';
-- Then re-run insert §5 of supabase_cs_notes_import.sql for the active batch.

-- Reset unmatched → pending (active batch only) before rematch:
-- UPDATE public.cs_notes_staging s
-- SET matched_patient_id = NULL,
--     match_method = NULL,
--     import_status = 'pending',
--     import_error = NULL
-- FROM public.cs_import_params p
-- WHERE p.id = 1 AND s.batch_id = p.batch_id
--   AND s.import_status = 'unmatched';
