-- Consultation → Treatment Notes: author, edit history, soft delete and addenda.
-- Apply in Supabase SQL Editor. Safe to re-run.
--
-- author_*     : who typed the note (logged-in user). doctor_* stays the responsible doctor.
-- edited_*     : last edit; edit_history keeps every previous version [{at, by, notes}].
-- deleted_*    : soft delete — the row stays for audit and is hidden in the app.
-- parent_id    : an addendum points at the note it amends (past-day notes are not edited).
--
-- The app keeps working without these columns (it strips them, hard-deletes, and saves
-- addenda as standalone notes).

alter table public.treatments add column if not exists author_name  text;
alter table public.treatments add column if not exists author_role  text;
alter table public.treatments add column if not exists author_id    text;
alter table public.treatments add column if not exists edited_at    timestamptz;
alter table public.treatments add column if not exists edited_by    text;
alter table public.treatments add column if not exists edit_history jsonb not null default '[]'::jsonb;
alter table public.treatments add column if not exists deleted_at   timestamptz;
alter table public.treatments add column if not exists deleted_by   text;
alter table public.treatments add column if not exists parent_id    uuid;

create index if not exists treatments_patient_created_idx
    on public.treatments (patient_id, created_at desc);

create index if not exists treatments_parent_id_idx
    on public.treatments (parent_id);

comment on column public.treatments.author_name  is 'Person who typed the note (login display name)';
comment on column public.treatments.author_role  is 'Role of the author at save time (doctor / nurse / admin …)';
comment on column public.treatments.author_id    is 'Login user id of the author';
comment on column public.treatments.edited_at    is 'Time of the latest edit';
comment on column public.treatments.edited_by    is 'Who made the latest edit';
comment on column public.treatments.edit_history is 'Previous versions, oldest first: [{at, by, notes}]';
comment on column public.treatments.deleted_at   is 'Soft delete time; row hidden in the app but kept for audit';
comment on column public.treatments.deleted_by   is 'Who deleted the note';
comment on column public.treatments.parent_id    is 'Note this addendum amends (treatments.id)';
