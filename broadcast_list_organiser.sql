-- Broadcast LHS campaign organiser (folders / markers / remarks)
-- Optional. Safe to re-run.
--
-- Clinic-wide remarks/markers for ALL organiser rows (default filters +
-- saved lists) live in broadcast_organiser_meta — see
-- broadcast_organiser_meta.sql (required for global notes sync).
--
-- This script adds first-class columns on broadcast_contact_lists for
-- hierarchy / optional denormalized marker+remark on saved lists only.

alter table public.broadcast_contact_lists
    add column if not exists parent_id uuid references public.broadcast_contact_lists(id) on delete set null;

alter table public.broadcast_contact_lists
    add column if not exists kind text not null default 'list';

alter table public.broadcast_contact_lists
    add column if not exists marker text not null default '';

alter table public.broadcast_contact_lists
    add column if not exists remark text not null default '';

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'broadcast_contact_lists_kind_check'
    ) then
        alter table public.broadcast_contact_lists
            add constraint broadcast_contact_lists_kind_check
            check (kind in ('list', 'folder'));
    end if;
end $$;

create index if not exists broadcast_contact_lists_parent_idx
    on public.broadcast_contact_lists (parent_id)
    where is_active = true;

comment on column public.broadcast_contact_lists.parent_id is
    'Parent folder/list for campaign organiser tree';
comment on column public.broadcast_contact_lists.kind is
    'list = contact membership; folder = organiser container';
comment on column public.broadcast_contact_lists.marker is
    'Gmail-style marker: star|important|done|flag|question|progress|hold';
comment on column public.broadcast_contact_lists.remark is
    'Short staff note shown in organiser remarks column';
