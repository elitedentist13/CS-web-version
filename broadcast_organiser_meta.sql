-- REQUIRED for clinic-wide Broadcast campaign-organiser remarks / markers
-- Apply in Supabase SQL Editor. Safe to re-run.
--
-- Stores Gmail-style markers + notes for:
--   - default filter keys (all, scope, hasphone, birthday, sent, unsent)
--   - saved list / folder UUIDs from broadcast_contact_lists
-- Shared across all staff PCs (not localStorage-only).

create table if not exists public.broadcast_organiser_meta (
    list_key text primary key,
    marker text not null default '',
    remark text not null default '',
    updated_at timestamptz not null default now(),
    updated_by text
);

create index if not exists broadcast_organiser_meta_updated_idx
    on public.broadcast_organiser_meta (updated_at desc);

comment on table public.broadcast_organiser_meta is
    'Clinic-wide Broadcast LHS organiser markers and remark notes';
comment on column public.broadcast_organiser_meta.list_key is
    'Builtin key (all/scope/…) or broadcast_contact_lists.id UUID';
comment on column public.broadcast_organiser_meta.marker is
    'star|important|done|flag|question|progress|hold or empty';
comment on column public.broadcast_organiser_meta.remark is
    'Short staff note shown in organiser remarks column';

alter table public.broadcast_organiser_meta enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'broadcast_organiser_meta'
          and policyname = 'broadcast_organiser_meta_anon_all'
    ) then
        create policy broadcast_organiser_meta_anon_all
            on public.broadcast_organiser_meta
            for all using (true) with check (true);
    end if;
end $$;
