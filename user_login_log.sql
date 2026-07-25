-- User login session log (Configuration → Users → Login history).
-- Run once in Supabase SQL Editor.

create table if not exists public.user_login_log (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    display_name text,
    role text,
    is_admin boolean not null default false,
    clinic_id uuid references public.clinics (id) on delete set null,
    clinic_code text,
    clinic_name text,
    doctor_id uuid,
    doctor_name text,
    login_at timestamptz not null default now(),
    logout_at timestamptz,
    duration_seconds integer,
    logout_reason text,
    user_agent text,
    login_method text,
    session_active boolean not null default true,
    created_at timestamptz not null default now()
);

create index if not exists user_login_log_login_at_idx
    on public.user_login_log (login_at desc);

create index if not exists user_login_log_user_id_idx
    on public.user_login_log (user_id, login_at desc);

create index if not exists user_login_log_clinic_id_idx
    on public.user_login_log (clinic_id, login_at desc);

alter table public.user_login_log enable row level security;

drop policy if exists user_login_log_read on public.user_login_log;
drop policy if exists user_login_log_write on public.user_login_log;

create policy user_login_log_read
    on public.user_login_log for select using (true);

create policy user_login_log_write
    on public.user_login_log for all using (true) with check (true);

-- If the table already exists from an earlier deploy, add login_method:
alter table public.user_login_log
    add column if not exists login_method text;
