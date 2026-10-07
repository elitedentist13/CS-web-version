-- Optional sidecar for Banana Dicom Reader virtual implant plans.
-- Visual planning only — not a surgical guide. The reader keeps working with
-- localStorage even if this table is not applied.

create table if not exists public.cs3d_implant_plans (
    id uuid primary key default gen_random_uuid(),
    patient_id text not null,
    plan jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists cs3d_implant_plans_patient_idx
    on public.cs3d_implant_plans (patient_id, updated_at desc);

alter table public.cs3d_implant_plans enable row level security;
drop policy if exists cs3d_implant_plans_read on public.cs3d_implant_plans;
drop policy if exists cs3d_implant_plans_write on public.cs3d_implant_plans;
create policy cs3d_implant_plans_read on public.cs3d_implant_plans for select using (true);
create policy cs3d_implant_plans_write on public.cs3d_implant_plans for all using (true) with check (true);

notify pgrst, 'reload schema';
