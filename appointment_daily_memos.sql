-- Clinic + date daily memo for appointment module (queue / today / planner / calendar).
-- Run once in Supabase SQL editor. Without this table, memos fall back to program_settings keys.

create table if not exists public.appointment_daily_memos (
    id uuid primary key default gen_random_uuid(),
    clinic_id uuid not null references public.clinics (id) on delete cascade,
    memo_date date not null,
    memo_text text not null default '',
    updated_at timestamptz not null default now(),
    unique (clinic_id, memo_date)
);

create index if not exists appointment_daily_memos_clinic_date_idx
    on public.appointment_daily_memos (clinic_id, memo_date);

alter table public.appointment_daily_memos enable row level security;

-- Adjust policies to match your project's anon/authenticated access pattern.
create policy "appointment_daily_memos_read"
    on public.appointment_daily_memos for select using (true);

create policy "appointment_daily_memos_write"
    on public.appointment_daily_memos for all using (true) with check (true);
