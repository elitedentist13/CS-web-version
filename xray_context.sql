-- X-rays context: linked visit, teeth shown (FDI) and review status.
-- Run once in Supabase → SQL Editor. The web app keeps working without it (the new
-- fields are hidden and saves fall back to the old columns); run it to enable them.

alter table public.xrays
    add column if not exists appointment_id uuid references public.appointments (id) on delete set null,
    add column if not exists teeth text[] not null default '{}',
    add column if not exists review_status text not null default 'new',
    add column if not exists reviewed_by text,
    add column if not exists reviewed_at timestamptz;

-- Calibrated measurements drawn in the viewer, kept as an editable layer (points + calibration),
-- not burned into the image. Optional on its own: without it measurements work but are not saved.
alter table public.xrays
    add column if not exists measurements jsonb;

alter table public.xrays
    drop constraint if exists xrays_review_status_chk;
alter table public.xrays
    add constraint xrays_review_status_chk
    check (review_status in ('new', 'reviewed'));

create index if not exists xrays_patient_taken_idx
    on public.xrays (patient_id, taken_date desc);
create index if not exists xrays_appointment_idx
    on public.xrays (appointment_id) where appointment_id is not null;
create index if not exists xrays_teeth_idx
    on public.xrays using gin (teeth);
create index if not exists xrays_review_status_idx
    on public.xrays (patient_id, review_status);

-- Refresh the PostgREST schema cache so the API sees the new columns immediately.
notify pgrst, 'reload schema';
