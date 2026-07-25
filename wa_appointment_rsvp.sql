-- Two-way WhatsApp RSVP recall (Confirm / Cancel buttons)
-- Apply once in Supabase SQL Editor. Safe to re-run.
-- Does NOT change existing booking_status / Recall Patient behaviour.

-- ── Appointment denormalized RSVP fields (fast UI badges) ───────
alter table public.appointments
    add column if not exists patient_rsvp_status text,
    add column if not exists patient_rsvp_at timestamptz,
    add column if not exists patient_rsvp_source text;

comment on column public.appointments.patient_rsvp_status is
    'null | pending | confirmed | declined | expired — patient WhatsApp RSVP (not staff web booking_status)';
comment on column public.appointments.patient_rsvp_at is
    'When patient_rsvp_status last changed';
comment on column public.appointments.patient_rsvp_source is
    'whatsapp | staff | inbound_webhook';

create index if not exists idx_appointments_patient_rsvp_status
    on public.appointments (patient_rsvp_status)
    where patient_rsvp_status is not null;

-- ── Outbound / inbound correlation log ──────────────────────────
create table if not exists public.wa_appointment_rsvp (
    id uuid primary key default gen_random_uuid(),
    appointment_id uuid not null references public.appointments (id) on delete cascade,
    patient_id uuid references public.patients (id) on delete set null,
    to_phone text,
    content_sid text,
    outbound_sid text,
    status text not null default 'pending'
        check (status in ('pending', 'confirmed', 'declined', 'expired', 'failed', 'skipped')),
    inbound_sid text,
    button_payload text,
    sent_at timestamptz,
    replied_at timestamptz,
    expires_at timestamptz,
    sent_by text,
    clinic_tag text,
    error text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists wa_appointment_rsvp_appt_idx
    on public.wa_appointment_rsvp (appointment_id, created_at desc);
create index if not exists wa_appointment_rsvp_outbound_sid_idx
    on public.wa_appointment_rsvp (outbound_sid)
    where outbound_sid is not null;
create index if not exists wa_appointment_rsvp_phone_pending_idx
    on public.wa_appointment_rsvp (to_phone, status, sent_at desc)
    where status = 'pending';
create index if not exists wa_appointment_rsvp_inbound_sid_uidx
    on public.wa_appointment_rsvp (inbound_sid)
    where inbound_sid is not null;

comment on table public.wa_appointment_rsvp is
    'WhatsApp RSVP sends + replies linked to appointments (two-way recall)';

alter table public.wa_appointment_rsvp enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'wa_appointment_rsvp'
          and policyname = 'wa_appointment_rsvp_anon_all'
    ) then
        create policy wa_appointment_rsvp_anon_all
            on public.wa_appointment_rsvp
            for all using (true) with check (true);
    end if;
end $$;

-- Seed RSVP Content Template into clinic list (idempotent by content_sid)
insert into public.twilio_content_templates (
    label, content_sid, vars, var_map, notes, sort_order, created_by, is_active
)
select
    'Appointment RSVP (Yes/No)',
    'HX123c5d6b07dff76590124d0c363fdd21',
    '1,2,3,4,5',
    '{"1":"NAME","2":"CLINIC","3":"DATE","4":"TIME","5":"DOCTOR"}'::jsonb,
    'Two-way recall · quick-reply CONFIRM / CANCEL · {{1}}=NAME {{2}}=CLINIC {{3}}=DATE {{4}}=TIME {{5}}=DOCTOR',
    5,
    'seed_rsvp',
    true
where not exists (
    select 1 from public.twilio_content_templates
    where content_sid = 'HX123c5d6b07dff76590124d0c363fdd21'
);

-- Retire previous draft RSVP template if present
update public.twilio_content_templates
set is_active = false,
    notes = coalesce(notes, '') || ' · superseded by HX123c5d6b07dff76590124d0c363fdd21',
    updated_at = now()
where content_sid = 'HX3e0d0027555e8d6b700381a797f599cc';

-- Optional: include in realtime publication (ignore if publication missing)
do $$
begin
    begin
        alter publication supabase_realtime add table public.wa_appointment_rsvp;
    exception
        when duplicate_object then null;
        when undefined_object then null;
    end;
end $$;

-- ── Debug log: every Twilio inbound POST (check if webhook is wired) ──
create table if not exists public.wa_rsvp_inbound_log (
    id uuid primary key default gen_random_uuid(),
    received_at timestamptz not null default now(),
    from_phone text,
    body text,
    button_payload text,
    original_replied_sid text,
    message_sid text,
    raw_params jsonb,
    matched_rsvp_id uuid references public.wa_appointment_rsvp (id) on delete set null,
    decision text,
    note text
);

create index if not exists wa_rsvp_inbound_log_received_idx
    on public.wa_rsvp_inbound_log (received_at desc);

alter table public.wa_rsvp_inbound_log enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'wa_rsvp_inbound_log'
          and policyname = 'wa_rsvp_inbound_log_anon_all'
    ) then
        create policy wa_rsvp_inbound_log_anon_all
            on public.wa_rsvp_inbound_log
            for all using (true) with check (true);
    end if;
end $$;
