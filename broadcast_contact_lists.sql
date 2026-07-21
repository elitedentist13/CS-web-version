-- Clinic-wide Broadcast contact lists (shared across all staff PCs)
-- Apply in Supabase SQL Editor. Safe to re-run.
-- Replaces per-browser localStorage key mb_broadcast_segments_v1.

create table if not exists public.broadcast_contact_lists (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    patient_ids jsonb not null default '[]'::jsonb,
    conditions jsonb,
    is_active boolean not null default true,
    sort_order integer not null default 0,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists broadcast_contact_lists_active_sort_idx
    on public.broadcast_contact_lists (is_active, sort_order, name);

create index if not exists broadcast_contact_lists_name_lower_idx
    on public.broadcast_contact_lists (lower(name));

comment on table public.broadcast_contact_lists is
    'Clinic-wide Broadcast saved contact lists (patient ID membership)';

alter table public.broadcast_contact_lists enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'broadcast_contact_lists'
          and policyname = 'broadcast_contact_lists_anon_all'
    ) then
        create policy broadcast_contact_lists_anon_all
            on public.broadcast_contact_lists
            for all using (true) with check (true);
    end if;
end $$;
