-- Patient documents (Forms/Letters) + PDF export storage.
-- Run once in Supabase → SQL Editor if PDF export fails with
-- "new row violates row-level security policy".

-- ── Table ────────────────────────────────────────────────────────
create table if not exists public.patient_documents (
    id uuid primary key default gen_random_uuid(),
    patient_id uuid not null references public.patients (id) on delete cascade,
    patient_no text,
    patient_name text,
    doctor_name text,
    template_id uuid,
    template_code text,
    template_name text,
    template_type text,
    document_name text,
    document_date date,
    content_html text,
    clinic_id uuid references public.clinics (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists patient_documents_patient_id_idx
    on public.patient_documents (patient_id, created_at desc);

alter table public.patient_documents enable row level security;

drop policy if exists patient_documents_read on public.patient_documents;
drop policy if exists patient_documents_write on public.patient_documents;

create policy patient_documents_read
    on public.patient_documents for select using (true);

create policy patient_documents_write
    on public.patient_documents for all using (true) with check (true);

-- ── Storage bucket for exported PDFs ─────────────────────────────
insert into storage.buckets (id, name, public)
values ('patient-documents', 'patient-documents', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists patient_documents_storage_read on storage.objects;
drop policy if exists patient_documents_storage_write on storage.objects;

create policy patient_documents_storage_read
    on storage.objects for select
    using (bucket_id = 'patient-documents');

create policy patient_documents_storage_write
    on storage.objects for all
    using (bucket_id = 'patient-documents')
    with check (bucket_id = 'patient-documents');
