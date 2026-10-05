-- Saved lateral-ceph study: a copy of the film in the xrays bucket plus an
-- ID wired to the tracing. Banana patient data (not clinic training).
-- Run once in Supabase → SQL Editor. Until this runs, Save tracing still
-- keeps a copy on this computer and on xrays.ceph_tracing when that column exists.
-- Safe to re-run.

alter table public.xrays
    add column if not exists ceph_tracing jsonb;

create table if not exists public.ceph_saves (
    id uuid primary key default gen_random_uuid(),
    patient_id uuid references public.patients (id) on delete cascade,
    source_xray_id uuid references public.xrays (id) on delete set null,
    file_path text,
    file_url text,
    file_name text,
    tracing jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index if not exists ceph_saves_source_uidx
    on public.ceph_saves (source_xray_id)
    where source_xray_id is not null;

create index if not exists ceph_saves_patient_idx
    on public.ceph_saves (patient_id, updated_at desc);

alter table public.ceph_saves enable row level security;

drop policy if exists ceph_saves_read on public.ceph_saves;
drop policy if exists ceph_saves_write on public.ceph_saves;

create policy ceph_saves_read
    on public.ceph_saves for select using (true);

create policy ceph_saves_write
    on public.ceph_saves for all using (true) with check (true);

notify pgrst, 'reload schema';
