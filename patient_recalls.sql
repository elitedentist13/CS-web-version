-- Per-patient recall plan (ClinicSolution-style).
-- Not an appointment. Used by the standalone Appt Reminder plugin
-- (app-patient-recall.js). Does not replace Recall Patient / RSVP / Broadcast.
-- Run once in the Supabase SQL editor.

create table if not exists public.patient_recalls (
    id              uuid primary key default gen_random_uuid(),
    patient_id      uuid not null references public.patients (id) on delete cascade,
    patient_no      text,
    recall_date     date not null,
    clinic_tag      text not null default '',
    clinic_id       uuid references public.clinics (id) on delete set null,
    doctor_id       uuid references public.doctors (id) on delete set null,
    doctor_code     text,
    doctor_name     text,
    remarks         text not null default '',
    interval_code   text not null default 'custom',
    status          text not null default 'planned',
    source          text not null default 'directory',
    source_appt_id  uuid references public.appointments (id) on delete set null,
    created_by      text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    contacted_at    timestamptz,
    contacted_via   text
);

create index if not exists patient_recalls_patient_date_idx
    on public.patient_recalls (patient_id, recall_date desc);

create index if not exists patient_recalls_panel_idx
    on public.patient_recalls (recall_date, clinic_tag, status);

create index if not exists patient_recalls_doctor_date_idx
    on public.patient_recalls (doctor_id, recall_date)
    where status = 'planned';

alter table public.patient_recalls enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'patient_recalls'
          and policyname = 'patient_recalls_anon_all'
    ) then
        create policy patient_recalls_anon_all
            on public.patient_recalls for all
            using (true) with check (true);
    end if;
end $$;

comment on table public.patient_recalls is
    'Per-patient recall plan for Appt Reminder. Not an appointment. Management panel lists planned/reminded rows by date.';
