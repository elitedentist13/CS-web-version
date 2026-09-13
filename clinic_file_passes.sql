-- Clinic Fast Pass file transfer (Tools → File Transfer).
-- Run once in Supabase → SQL Editor.

-- ── Table ────────────────────────────────────────────────────────
create table if not exists public.clinic_file_passes (
    id uuid primary key default gen_random_uuid(),
    pass_code text not null unique,
    file_name text not null,
    file_size bigint,
    mime_type text,
    storage_path text not null,
    note text,
    from_clinic_id uuid references public.clinics (id) on delete set null,
    from_clinic_label text,
    to_clinic_id uuid references public.clinics (id) on delete set null,
    to_clinic_label text,
    created_by text,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    download_count integer not null default 0,
    last_downloaded_at timestamptz
);

create index if not exists clinic_file_passes_code_idx
    on public.clinic_file_passes (pass_code);

create index if not exists clinic_file_passes_expires_idx
    on public.clinic_file_passes (expires_at);

alter table public.clinic_file_passes enable row level security;

drop policy if exists clinic_file_passes_read on public.clinic_file_passes;
drop policy if exists clinic_file_passes_write on public.clinic_file_passes;

create policy clinic_file_passes_read
    on public.clinic_file_passes for select using (true);

create policy clinic_file_passes_write
    on public.clinic_file_passes for all using (true) with check (true);

-- ── Private storage bucket (500 MB objects, 3-day app expiry) ───
insert into storage.buckets (id, name, public, file_size_limit)
values ('clinic-pass', 'clinic-pass', false, 524288000)
on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit;

drop policy if exists clinic_pass_storage_read on storage.objects;
drop policy if exists clinic_pass_storage_write on storage.objects;

create policy clinic_pass_storage_read
    on storage.objects for select
    using (bucket_id = 'clinic-pass');

create policy clinic_pass_storage_write
    on storage.objects for all
    using (bucket_id = 'clinic-pass')
    with check (bucket_id = 'clinic-pass');
