-- Optional: persist CS X-ray Assist runs (gracefully skipped if table missing)
create table if not exists public.xray_ai_runs (
    id uuid primary key default gen_random_uuid(),
    xray_id uuid references public.xrays(id) on delete cascade,
    patient_id uuid references public.patients(id) on delete set null,
    findings jsonb not null default '[]'::jsonb,
    model_version text,
    source text,
    created_by text,
    created_at timestamptz not null default now()
);

create index if not exists xray_ai_runs_xray_id_idx on public.xray_ai_runs(xray_id);
create index if not exists xray_ai_runs_patient_id_idx on public.xray_ai_runs(patient_id);

alter table public.xray_ai_runs enable row level security;
