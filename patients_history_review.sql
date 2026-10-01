-- Consultation → Medical / Dental History: last-reviewed stamp.
-- Apply in Supabase SQL Editor. Safe to re-run.
--
-- mh_*  : Medical History last reviewed (including "Reviewed, no change").
-- dh_*  : Dental History last reviewed.
--
-- The app keeps working without these columns (it strips them on save and
-- retries load without them).

alter table public.patients add column if not exists mh_reviewed_at timestamptz;
alter table public.patients add column if not exists mh_reviewed_by text;
alter table public.patients add column if not exists dh_reviewed_at timestamptz;
alter table public.patients add column if not exists dh_reviewed_by text;

create index if not exists patients_mh_reviewed_at_idx
    on public.patients (mh_reviewed_at);

create index if not exists patients_dh_reviewed_at_idx
    on public.patients (dh_reviewed_at);

comment on column public.patients.mh_reviewed_at is 'When Medical History was last reviewed or saved';
comment on column public.patients.mh_reviewed_by is 'Who last reviewed or saved Medical History';
comment on column public.patients.dh_reviewed_at is 'When Dental History was last reviewed or saved';
comment on column public.patients.dh_reviewed_by is 'Who last reviewed or saved Dental History';

alter table public.patients add column if not exists mh_edit_history jsonb not null default '[]'::jsonb;
alter table public.patients add column if not exists dh_edit_history jsonb not null default '[]'::jsonb;

comment on column public.patients.mh_edit_history is 'Medical History save snapshots [{at, by, fields}]';
comment on column public.patients.dh_edit_history is 'Dental History save snapshots [{at, by, fields}]';
