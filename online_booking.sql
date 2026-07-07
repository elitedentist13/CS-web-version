-- Online booking — run once in Supabase SQL editor.
-- Adds web-booking columns to appointments and supporting tables.

-- ── Appointment web-booking columns ─────────────────────────────
alter table public.appointments
    add column if not exists booking_source text default 'staff',
    add column if not exists booking_status text,
    add column if not exists booking_type text,
    add column if not exists web_created_at timestamptz,
    add column if not exists web_booking_ref text,
    add column if not exists patient_dob date,
    add column if not exists verified_at timestamptz;

comment on column public.appointments.booking_source is 'staff | web | phone';
comment on column public.appointments.booking_status is 'pending_otp | pending_staff | pending_arrange | confirmed | cancelled | expired';
comment on column public.appointments.booking_type is 'new_patient | existing_patient | recall | asap';
comment on column public.appointments.web_created_at is 'Timestamp when patient submitted online booking';
comment on column public.appointments.web_booking_ref is 'Public reference code e.g. WB-20260707-A3F2';

alter table public.appointments
    add column if not exists web_preferred_session text;

comment on column public.appointments.web_preferred_session is 'am | pm | night when patient requested arrange on a full duty day';
comment on column public.appointments.patient_dob is 'DOB entered on web form (existing patient match)';

create index if not exists idx_appointments_booking_source
    on public.appointments (booking_source, booking_status, web_created_at desc);

-- ── Pending OTP / hold requests ─────────────────────────────────
create table if not exists public.online_booking_requests (
    id uuid primary key default gen_random_uuid(),
    web_booking_ref text unique,
    clinic_tag text,
    doctor_code text not null,
    doctor_name text,
    appt_date date not null,
    start_time time not null,
    end_time time not null,
    duration int not null default 30,
    patient_name text not null,
    patient_chinese_name text,
    patient_phone text not null,
    patient_dob date,
    patient_id uuid references public.patients (id) on delete set null,
    patient_no text,
    treatment_items text,
    booking_type text default 'new_patient',
    otp_hash text,
    otp_expires_at timestamptz,
    otp_attempts int default 0,
    status text default 'pending_otp',
    appointment_id uuid references public.appointments (id) on delete set null,
    remarks text,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

create index if not exists idx_online_booking_requests_status
    on public.online_booking_requests (status, created_at desc);

create index if not exists idx_online_booking_requests_phone
    on public.online_booking_requests (patient_phone, created_at desc);

-- ── Published schedule rules (staff configures) ─────────────────
create table if not exists public.online_booking_rules (
    id uuid primary key default gen_random_uuid(),
    clinic_tag text,
    doctor_code text,
    day_of_week int,
    start_time time not null default '10:00',
    end_time time not null default '19:00',
    lunch_start time default '13:00',
    lunch_end time default '15:00',
    slot_interval int default 15,
    default_duration int default 30,
    lead_time_hours int default 2,
    max_days_ahead int default 60,
    enabled boolean default true,
    created_at timestamptz default now()
);

comment on column public.online_booking_rules.day_of_week is '0=Sun … 6=Sat; null = all days';
comment on column public.online_booking_rules.lunch_start is 'Lunch break start (excluded from online slots)';
comment on column public.online_booking_rules.lunch_end is 'Lunch break end (excluded from online slots)';

-- Default rules: Mon–Sat 10:00–19:00, lunch 13:00–15:00, 15-min slots
insert into public.online_booking_rules
    (clinic_tag, doctor_code, day_of_week, start_time, end_time, lunch_start, lunch_end, slot_interval, default_duration, enabled)
select null, null, d, '10:00', '19:00', '13:00', '15:00', 15, 30, true
from generate_series(1, 6) as d
where not exists (select 1 from public.online_booking_rules limit 1);

-- If rules already exist from an earlier install, run this once to apply new hours:
-- alter table public.online_booking_rules add column if not exists lunch_start time default '13:00';
-- alter table public.online_booking_rules add column if not exists lunch_end time default '15:00';
-- update public.online_booking_rules set start_time = '10:00', end_time = '19:00', lunch_start = '13:00', lunch_end = '15:00';

-- ── Booking submit RPC (required for book.html without local API) ─
-- Run online_booking_rpc.sql after this file, then online_booking_roster.sql for doctor roster.

-- ── Realtime (optional — enable if using live staff panel refresh) ─
-- alter publication supabase_realtime add table public.online_booking_requests;
