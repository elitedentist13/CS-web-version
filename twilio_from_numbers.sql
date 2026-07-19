-- Shared Twilio sender (From) numbers — clinic-wide for all staff
-- Apply in Supabase SQL Editor. Safe to re-run.
-- Edge secrets TWILIO_WHATSAPP_FROM / TWILIO_SMS_FROM remain the "Default" option.

create table if not exists public.twilio_from_numbers (
    id uuid primary key default gen_random_uuid(),
    label text not null,
    phone text not null,
    whatsapp boolean not null default true,
    sms boolean not null default true,
    is_active boolean not null default true,
    sort_order integer not null default 0,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint twilio_from_numbers_phone_e164
        check (phone ~ '^\+[1-9][0-9]{7,14}$')
);

create unique index if not exists twilio_from_numbers_phone_uidx
    on public.twilio_from_numbers (phone);

create index if not exists twilio_from_numbers_active_sort_idx
    on public.twilio_from_numbers (is_active, sort_order, label);

comment on table public.twilio_from_numbers is
    'Clinic-wide Twilio From numbers for WhatsApp/SMS (Broadcast, Recall, AI Helper)';

alter table public.twilio_from_numbers enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'twilio_from_numbers'
          and policyname = 'twilio_from_numbers_anon_all'
    ) then
        create policy twilio_from_numbers_anon_all
            on public.twilio_from_numbers
            for all using (true) with check (true);
    end if;
end $$;
