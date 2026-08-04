-- =============================================================================
-- ARCHIVE / TKO one-shot — prefer multi-branch package:
--   resolve-unmatched-notes.py + supabase_cs_notes_resolve_insert.sql
--   Guide: CS_NOTES_SUPABASE_IMPORT.md
-- =============================================================================
-- Re-run unmatched TKO notes (clinic-scoped)
-- Staging CSV:
--   C:\Users\Doctor-1\Downloads\CS_TKO_unmatched_staging_for_supabase.csv
-- =============================================================================
-- IMPORTANT: If CSV import says "duplicate key" / violate unique constraint,
-- those import_key values already exist (usually from a partial previous upload).
-- Run the DELETE below FIRST, then import the CSV.
-- =============================================================================

-- 0) Ensure helpers / staging columns exist (safe if already run)
--     → run §0–1 from supabase_cs_notes_import.sql if needed

-- 1) Clear previous attempt rows that collide on import_key
--    (does NOT delete original successful inserted notes in treatments)
DELETE FROM public.cs_notes_staging
WHERE batch_id LIKE 'TKO_20260805_%';

-- Also clear any prior unmatched rows that share the same note keys
-- if you still get duplicate errors after the DELETE above, run:
-- DELETE FROM public.cs_notes_staging
-- WHERE import_status = 'unmatched';

-- 2) Point params at the new batch
UPDATE public.cs_import_params
SET batch_id = 'TKO_20260805_000530',
    require_clinic_scope = true,
    updated_at = now()
WHERE id = 1;

-- 3) Table Editor → cs_notes_staging → Import CSV
--    File: C:\Users\Doctor-1\Downloads\CS_TKO_unmatched_staging_for_supabase.csv
--    Header row ON
--    Leave matched_patient_id / match_method / import_status / import_error / imported_at empty

-- 4) Run §3 match from supabase_cs_notes_import.sql

-- 5) Preview
SELECT import_status, match_method, import_error, count(*) AS n
FROM public.cs_notes_staging
WHERE batch_id = 'TKO_20260805_000530'
GROUP BY 1, 2, 3
ORDER BY n DESC;

-- 6) Run §5 insert from supabase_cs_notes_import.sql

-- 7) Final report
SELECT import_status, match_method, count(*) AS n
FROM public.cs_notes_staging
WHERE batch_id = 'TKO_20260805_000530'
GROUP BY 1, 2
ORDER BY 1, 2;
