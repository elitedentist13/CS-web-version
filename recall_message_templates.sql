-- Clinic-wide Recall Patient message templates (shared across all staff PCs)
-- Apply in Supabase SQL Editor. Safe to re-run.
-- Replaces per-browser localStorage key recall_templates_v1.

create table if not exists public.recall_message_templates (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    content text not null,
    is_active boolean not null default true,
    sort_order integer not null default 0,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists recall_message_templates_active_sort_idx
    on public.recall_message_templates (is_active, sort_order, name);

comment on table public.recall_message_templates is
    'Clinic-wide Recall Patient free-text message templates (WhatsApp / SMS / etc.)';

alter table public.recall_message_templates enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'recall_message_templates'
          and policyname = 'recall_message_templates_anon_all'
    ) then
        create policy recall_message_templates_anon_all
            on public.recall_message_templates
            for all using (true) with check (true);
    end if;
end $$;
