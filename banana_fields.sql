-- Patients → Banana Info: banana index (1–10) and free-text banana notes.
-- Apply in Supabase SQL Editor. Safe to re-run (no-op on databases that already have the columns).
--
-- banana_index : 1–10 score; NULL when Banana Info is unticked / not recorded.
-- banana_notes : free text. Kept even when banana_index is NULL (Banana Info unticked), so the
--                text stays hidden/inactive in the app and re-appears when Banana Info is ticked again.
--
-- The app no longer drops banana_notes silently when this column is missing; saves fail with a
-- message pointing here instead.

alter table public.patients add column if not exists banana_index smallint;
alter table public.patients add column if not exists banana_notes text;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'patients_banana_index_range'
          and conrelid = 'public.patients'::regclass
    ) then
        alter table public.patients
            add constraint patients_banana_index_range
            check (banana_index is null or banana_index between 1 and 10) not valid;
    end if;
end $$;

comment on column public.patients.banana_index is
    'Banana Index 1–10 (NULL = Banana Info unticked / not recorded)';

comment on column public.patients.banana_notes is
    'Banana Info free text; kept (hidden) while banana_index is NULL';
