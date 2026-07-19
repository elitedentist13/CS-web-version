-- Mass message broadcast (Appointment → Broadcast tab)
-- Apply in Supabase SQL Editor. Safe to re-run.

-- Optional opt-out flag on patients (SleekFlow-style Subscriber=False)
alter table public.patients
    add column if not exists messaging_opt_out boolean not null default false;

comment on column public.patients.messaging_opt_out is
    'When true, exclude from mass Twilio WhatsApp/SMS broadcasts';

create table if not exists public.message_campaigns (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    channel text not null check (channel in ('whatsapp', 'sms')),
    from_phone text,
    content_sid text,
    body_template text,
    audience_mode text not null default 'selection'
        check (audience_mode in ('selection', 'condition', 'list')),
    audience_snapshot jsonb not null default '{}'::jsonb,
    status text not null default 'draft'
        check (status in ('draft', 'sending', 'completed', 'failed', 'cancelled')),
    totals jsonb not null default '{}'::jsonb,
    clinic_tag text,
    doctor_code text,
    created_by text,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create index if not exists message_campaigns_created_at_idx
    on public.message_campaigns (created_at desc);
create index if not exists message_campaigns_status_idx
    on public.message_campaigns (status);

create table if not exists public.message_send_log (
    id uuid primary key default gen_random_uuid(),
    campaign_id uuid references public.message_campaigns(id) on delete cascade,
    patient_id uuid references public.patients(id) on delete set null,
    patient_no text,
    patient_name text,
    to_phone text,
    channel text not null check (channel in ('whatsapp', 'sms')),
    from_phone text,
    content_sid text,
    body_preview text,
    status text not null default 'queued'
        check (status in ('queued', 'sent', 'failed', 'skipped')),
    twilio_sid text,
    error text,
    clinic_tag text,
    doctor_code text,
    sent_by text,
    created_at timestamptz not null default now()
);

create index if not exists message_send_log_campaign_id_idx
    on public.message_send_log (campaign_id);
create index if not exists message_send_log_created_at_idx
    on public.message_send_log (created_at desc);
create index if not exists message_send_log_patient_id_idx
    on public.message_send_log (patient_id);
create index if not exists message_send_log_status_idx
    on public.message_send_log (status);

-- Speeds Broadcast contact mini-tags (sent within N months)
create index if not exists message_send_log_sent_patient_created_idx
    on public.message_send_log (status, created_at desc, patient_id)
    where status = 'sent';

alter table public.message_campaigns enable row level security;
alter table public.message_send_log enable row level security;

-- Clinic app uses anon key + custom login; allow authenticated-style open access
-- matching other operational tables. Tighten when migrating to Supabase Auth.
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'message_campaigns'
          and policyname = 'message_campaigns_anon_all'
    ) then
        create policy message_campaigns_anon_all on public.message_campaigns
            for all using (true) with check (true);
    end if;
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'message_send_log'
          and policyname = 'message_send_log_anon_all'
    ) then
        create policy message_send_log_anon_all on public.message_send_log
            for all using (true) with check (true);
    end if;
end $$;
