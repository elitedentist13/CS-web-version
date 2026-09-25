-- Patients → directory quick search: trigram indexes so "contains" (ILIKE '%text%') searches
-- stop scanning every patient row.
-- Apply in Supabase SQL Editor. Safe to re-run.
--
-- The directory search (patientSearchOrFilter in app.js) ORs ILIKE '%q%' across the columns
-- below. Postgres can only use indexes for an OR when EVERY branch is indexed, so all of the
-- searched columns get a gin_trgm_ops index, not just the name/phone ones.
-- Measured before this migration (40k patients): ~0.9–1.3 s per search request.
--
-- Plain CREATE INDEX (not CONCURRENTLY) because the SQL Editor runs the script in a
-- transaction; on ~40k rows each index builds in seconds.

create extension if not exists pg_trgm;

create index if not exists patients_full_name_trgm           on public.patients using gin (full_name gin_trgm_ops);
create index if not exists patients_chinese_name_trgm        on public.patients using gin (chinese_name gin_trgm_ops);
create index if not exists patients_patient_no_trgm          on public.patients using gin (patient_no gin_trgm_ops);
create index if not exists patients_phone_number_trgm        on public.patients using gin (phone_number gin_trgm_ops);
create index if not exists patients_mobile_phone_trgm        on public.patients using gin (mobile_phone gin_trgm_ops);
create index if not exists patients_hkid_trgm                on public.patients using gin (hkid gin_trgm_ops);
create index if not exists patients_email_trgm               on public.patients using gin (email gin_trgm_ops);
create index if not exists patients_address_trgm             on public.patients using gin (address gin_trgm_ops);
create index if not exists patients_occupation_trgm          on public.patients using gin (occupation gin_trgm_ops);
create index if not exists patients_remarks_trgm             on public.patients using gin (remarks gin_trgm_ops);
create index if not exists patients_medical_alerts_trgm      on public.patients using gin (medical_alerts gin_trgm_ops);
create index if not exists patients_medical_history_trgm     on public.patients using gin (medical_history gin_trgm_ops);
create index if not exists patients_current_medications_trgm on public.patients using gin (current_medications gin_trgm_ops);
create index if not exists patients_allergy_trgm             on public.patients using gin (allergy gin_trgm_ops);

-- Directory default order and DOB searches (dob.eq / dob.gte+lte).
create index if not exists patients_patient_no_idx on public.patients (patient_no);
create index if not exists patients_dob_idx        on public.patients (dob);

analyze public.patients;
