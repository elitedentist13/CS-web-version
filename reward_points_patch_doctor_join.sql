-- Patch: doctor-scoped clinic participation for reward points
-- Run in Supabase SQL editor after reward_points.sql.
-- Safe to run even if reward_points_patch_chart_ledgers.sql is not applied yet
-- (adds join_gain / join_redeem on reward_program_clinics if missing).
--
-- Clinics stay the hierarchy; under each clinic reception picks:
--   * All Doctors (default when selecting the clinic heading), or
--   * individual associated doctors
-- Join Gain / Join Redeem are stored per (clinic, doctor_key).
-- doctor_key = '__all__' means every doctor at that clinic.

-- ════════════════════════════════════════════════════════════
-- Ensure clinic join_gain / join_redeem exist (legacy DBs)
-- ════════════════════════════════════════════════════════════
alter table public.reward_program_clinics
    add column if not exists join_gain boolean,
    add column if not exists join_redeem boolean;

update public.reward_program_clinics
set join_gain = coalesce(join_gain, enabled, false),
    join_redeem = coalesce(join_redeem, enabled, false)
where join_gain is null or join_redeem is null;

-- Historic default: PL joined
update public.reward_program_clinics
set join_gain = true,
    join_redeem = true,
    enabled = true
where upper(trim(coalesce(clinic_code, ''))) = 'PL'
  and coalesce(join_gain, false) = false
  and coalesce(join_redeem, false) = false
  and coalesce(enabled, false) = false;

alter table public.reward_program_clinics
    alter column join_gain set default false,
    alter column join_redeem set default false;

-- ════════════════════════════════════════════════════════════
-- Per-clinic doctor participation
-- ════════════════════════════════════════════════════════════
create table if not exists public.reward_program_doctors (
    id              uuid primary key default gen_random_uuid(),
    clinic_id       uuid not null references public.clinics (id) on delete cascade,
    clinic_code     text not null default '',
    doctor_key      text not null,
    doctor_id       uuid,
    doctor_label    text not null default '',
    join_gain       boolean not null default false,
    join_redeem     boolean not null default false,
    enabled         boolean not null default false,
    updated_at      timestamptz not null default now(),
    updated_by      text,
    constraint reward_program_doctors_clinic_doc_uidx unique (clinic_id, doctor_key)
);

create index if not exists reward_program_doctors_clinic_idx
    on public.reward_program_doctors (clinic_id);
create index if not exists reward_program_doctors_code_idx
    on public.reward_program_doctors (clinic_code);
create index if not exists reward_program_doctors_key_idx
    on public.reward_program_doctors (doctor_key);

comment on table public.reward_program_doctors is
    'Per-clinic doctor participation in reward gain/redeem. doctor_key=__all__ = all doctors at clinic.';

-- Keep enabled = gain OR redeem
create or replace function public.reward_program_doctors_sync_enabled()
returns trigger
language plpgsql
as $$
begin
    new.join_gain := coalesce(new.join_gain, false);
    new.join_redeem := coalesce(new.join_redeem, false);
    new.enabled := (new.join_gain or new.join_redeem);
    new.doctor_key := coalesce(nullif(trim(new.doctor_key), ''), '__all__');
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists reward_program_doctors_sync_enabled_trg
    on public.reward_program_doctors;
create trigger reward_program_doctors_sync_enabled_trg
    before insert or update on public.reward_program_doctors
    for each row execute function public.reward_program_doctors_sync_enabled();

alter table public.reward_program_doctors enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'reward_program_doctors'
          and policyname = 'reward_program_doctors_anon_all'
    ) then
        create policy reward_program_doctors_anon_all
            on public.reward_program_doctors for all using (true) with check (true);
    end if;
end $$;

-- Seed All Doctors rows from clinic flags (idempotent).
-- Historic default: PL All Doctors joined; other clinics follow clinic flags.
insert into public.reward_program_doctors (
    clinic_id, clinic_code, doctor_key, doctor_label, join_gain, join_redeem, enabled
)
select
    c.clinic_id,
    coalesce(c.clinic_code, ''),
    '__all__',
    'All Doctors',
    coalesce(c.join_gain, c.enabled, false),
    coalesce(c.join_redeem, c.enabled, false),
    coalesce(c.enabled, false)
        or coalesce(c.join_gain, false)
        or coalesce(c.join_redeem, false)
from public.reward_program_clinics c
on conflict (clinic_id, doctor_key) do nothing;

-- Ensure PL All Doctors exists even if reward_program_clinics row is missing
insert into public.reward_program_doctors (
    clinic_id, clinic_code, doctor_key, doctor_label, join_gain, join_redeem, enabled
)
select
    cl.id,
    coalesce(cl.clinic_code, 'PL'),
    '__all__',
    'All Doctors',
    true,
    true,
    true
from public.clinics cl
where upper(trim(coalesce(cl.clinic_code, ''))) = 'PL'
on conflict (clinic_id, doctor_key) do nothing;

grant select, insert, update, delete on public.reward_program_doctors to anon, authenticated;
