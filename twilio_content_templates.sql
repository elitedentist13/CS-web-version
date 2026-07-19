-- Shared Twilio WhatsApp Content Templates (clinic-wide for all staff)
-- Apply in Supabase SQL Editor. Safe to re-run.
-- Content SIDs (HX…) are selected in the app UI; Edge secret TWILIO_WHATSAPP_CONTENT_SID
-- remains a fallback only when a request omits contentSid.

create table if not exists public.twilio_content_templates (
    id uuid primary key default gen_random_uuid(),
    label text not null,
    content_sid text not null,
    vars text not null default '1',
    notes text,
    is_active boolean not null default true,
    sort_order integer not null default 0,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint twilio_content_templates_sid_format
        check (content_sid ~ '^HX[a-zA-Z0-9]{32}$')
);

create unique index if not exists twilio_content_templates_content_sid_uidx
    on public.twilio_content_templates (content_sid);

create index if not exists twilio_content_templates_active_sort_idx
    on public.twilio_content_templates (is_active, sort_order, label);

comment on table public.twilio_content_templates is
    'Clinic-wide Twilio Content Template SIDs for WhatsApp broadcasts / recall / AI Helper';

-- Seed default recall template if table empty
insert into public.twilio_content_templates (label, content_sid, vars, notes, sort_order, created_by)
select
    'Clinic recall (default)',
    'HXf63c7a58271df43f5c63d97c6a514413',
    '1',
    'Approved WhatsApp recall · {{1}} = patient name',
    0,
    'seed'
where not exists (select 1 from public.twilio_content_templates limit 1);

alter table public.twilio_content_templates enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'twilio_content_templates'
          and policyname = 'twilio_content_templates_anon_all'
    ) then
        create policy twilio_content_templates_anon_all
            on public.twilio_content_templates
            for all using (true) with check (true);
    end if;
end $$;
