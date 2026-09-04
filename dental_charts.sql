-- Charting → Dental/Perio chart snapshots (one row per patient + chart_date).
-- Apply in Supabase SQL Editor. Safe to re-run (uses IF NOT EXISTS throughout),
-- including on an already-existing dental_charts table — it will just add the
-- new doctor_id / doctor_name columns used by the Chart History panel.

create table if not exists public.dental_charts (
    id uuid primary key default gen_random_uuid(),
    patient_id uuid not null references public.patients (id) on delete cascade,
    chart_date date not null default current_date,
    dental_data jsonb,
    perio_data jsonb,
    dental_notes text,
    perio_notes text,
    doctor_id uuid,
    doctor_name text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Additive columns for installations where dental_charts already existed
-- before doctor tracking / Chart History was introduced.
alter table public.dental_charts add column if not exists doctor_id uuid;
alter table public.dental_charts add column if not exists doctor_name text;
alter table public.dental_charts add column if not exists updated_at timestamptz not null default now();

create index if not exists dental_charts_patient_date_idx
    on public.dental_charts (patient_id, chart_date desc, created_at desc);

comment on column public.dental_charts.dental_data is
    'JSON snapshot of the odontogram state (per-tooth conditions), keyed by FDI tooth number';
comment on column public.dental_charts.perio_data is
    'JSON snapshot of all periodontal measurements (PD/GM/CAL/bone-level/BOP/plaque/mobility/implant/furcation/missing-reason)';
comment on column public.dental_charts.doctor_id is
    'Doctor active in Consultation at the time this chart snapshot was saved (currentDoctorId)';
comment on column public.dental_charts.doctor_name is
    'Denormalized doctor display name at save time, for the Chart History list (avoids an extra join)';

alter table public.dental_charts enable row level security;

drop policy if exists dental_charts_anon_all on public.dental_charts;
create policy dental_charts_anon_all
    on public.dental_charts for all using (true) with check (true);
