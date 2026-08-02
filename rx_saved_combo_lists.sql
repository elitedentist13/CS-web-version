-- Consultation → Medication: saved multi-drug prescription lists, per doctor.
-- Apply in Supabase SQL Editor. Safe to re-run.
-- Replaces browser localStorage keys rx_saved_combo_lists_v1 / rx_saved_combo_lists_v1__*.

create table if not exists public.rx_saved_combo_lists (
    id uuid primary key default gen_random_uuid(),
    doctor_id uuid,
    doctor_key text not null,
    doctor_name text,
    name text not null,
    lines jsonb not null default '[]'::jsonb,
    created_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists rx_saved_combo_lists_doctor_key_updated_idx
    on public.rx_saved_combo_lists (doctor_key, updated_at desc);

create index if not exists rx_saved_combo_lists_doctor_id_updated_idx
    on public.rx_saved_combo_lists (doctor_id, updated_at desc);

create index if not exists rx_saved_combo_lists_doctor_key_name_idx
    on public.rx_saved_combo_lists (doctor_key, lower(name));

comment on table public.rx_saved_combo_lists is
    'Named multi-drug prescription combo lists owned by each doctor (Consultation Medication panel)';

comment on column public.rx_saved_combo_lists.doctor_key is
    'Stable owner key: doctors.id (uuid lowercase) or name:{normalized} / user:{user_id} fallback';

comment on column public.rx_saved_combo_lists.lines is
    'JSON array of drug line objects (drug_id, drug_name, dosage, frequency, duration, route, …)';

alter table public.rx_saved_combo_lists enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'rx_saved_combo_lists'
          and policyname = 'rx_saved_combo_lists_anon_all'
    ) then
        create policy rx_saved_combo_lists_anon_all
            on public.rx_saved_combo_lists
            for all using (true) with check (true);
    end if;
end $$;
