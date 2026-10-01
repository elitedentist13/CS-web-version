-- Photos / Documents context: visit link, tooth, tags, edit lineage, document status.
-- Run once in Supabase → SQL Editor. The web app keeps working without it (the new
-- fields are hidden and saves fall back to the old columns); run it to enable them.

-- ── photos ───────────────────────────────────────────────────────
alter table public.photos
    add column if not exists appointment_id uuid references public.appointments (id) on delete set null,
    add column if not exists tooth_no text,
    add column if not exists tags text[] not null default '{}',
    add column if not exists parent_photo_id uuid references public.photos (id) on delete set null;

create index if not exists photos_patient_taken_idx
    on public.photos (patient_id, taken_date desc);
create index if not exists photos_appointment_idx
    on public.photos (appointment_id) where appointment_id is not null;
create index if not exists photos_parent_idx
    on public.photos (parent_photo_id) where parent_photo_id is not null;

-- ── patient_documents ────────────────────────────────────────────
alter table public.patient_documents
    add column if not exists appointment_id uuid references public.appointments (id) on delete set null,
    add column if not exists bill_id uuid references public.bills (id) on delete set null,
    add column if not exists status text not null default 'issued',
    add column if not exists category text,
    add column if not exists valid_until date;

alter table public.patient_documents
    drop constraint if exists patient_documents_status_chk;
alter table public.patient_documents
    add constraint patient_documents_status_chk
    check (status in ('draft', 'issued', 'signed'));

create index if not exists patient_documents_status_idx
    on public.patient_documents (patient_id, status, created_at desc);
create index if not exists patient_documents_appointment_idx
    on public.patient_documents (appointment_id) where appointment_id is not null;

-- Refresh the PostgREST schema cache so the API sees the new columns immediately.
notify pgrst, 'reload schema';
