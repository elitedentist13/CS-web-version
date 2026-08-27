-- "Any Banana" remote support tool (screen view/control + file sharing
-- between two clinic PCs, paired by a persistent device ID).
-- Run once in Supabase → SQL Editor to enable this feature.
--
-- How the pieces fit together (see tools/banana-remote-agent.ps1 and
-- app-remote.js for the actual client/agent code):
--   1. Each PC that installs the local agent registers a row in
--      remote_devices with a persistent, human-typeable ID.
--   2. A viewer (any browser running Banana, no agent required) creates a
--      row in remote_sessions targeting a host_device_id. The host
--      agent polls for pending sessions and shows a native Allow/Deny
--      prompt -- the ID alone is never enough to get in.
--   3. Once accepted, the host agent uploads JPEG screenshots to the
--      remote-screens bucket (overwritten each frame) and polls
--      remote_input_events for mouse/keyboard commands to inject.
--   4. Either side can drop a file into the remote-files bucket and add a
--      matching remote_files row for the other side to pick up.
--
-- Security note (matches the rest of this app's model -- see
-- message_broadcast.sql): the app uses the anon key + its own custom
-- login, not Supabase Auth, so RLS here is intentionally open (like every
-- other operational table in this schema) and the actual safety gate is
-- the host-side consent prompt, not row-level security. Tighten this if
-- the app ever migrates to real Supabase Auth.

-- ── Devices ──────────────────────────────────────────────────────
create table if not exists public.remote_devices (
    id text primary key,
    device_name text,
    agent_version text,
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

alter table public.remote_devices enable row level security;

drop policy if exists remote_devices_read on public.remote_devices;
drop policy if exists remote_devices_write on public.remote_devices;

create policy remote_devices_read
    on public.remote_devices for select using (true);

create policy remote_devices_write
    on public.remote_devices for all using (true) with check (true);

-- ── Sessions ─────────────────────────────────────────────────────
create table if not exists public.remote_sessions (
    id uuid primary key default gen_random_uuid(),
    host_device_id text not null references public.remote_devices (id) on delete cascade,
    viewer_label text,
    status text not null default 'pending'
        check (status in ('pending', 'accepted', 'denied', 'ended')),
    last_frame_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists remote_sessions_host_status_idx
    on public.remote_sessions (host_device_id, status, created_at desc);

alter table public.remote_sessions enable row level security;

drop policy if exists remote_sessions_read on public.remote_sessions;
drop policy if exists remote_sessions_write on public.remote_sessions;

create policy remote_sessions_read
    on public.remote_sessions for select using (true);

create policy remote_sessions_write
    on public.remote_sessions for all using (true) with check (true);

-- ── Input events (mouse/keyboard commands, viewer -> host) ──────
create table if not exists public.remote_input_events (
    id bigserial primary key,
    session_id uuid not null references public.remote_sessions (id) on delete cascade,
    event_type text not null
        check (event_type in ('mousemove', 'mousedown', 'mouseup', 'wheel', 'keydown', 'keyup')),
    x numeric,
    y numeric,
    button text,
    delta numeric,
    key text,
    ctrl_key boolean not null default false,
    shift_key boolean not null default false,
    alt_key boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists remote_input_events_session_idx
    on public.remote_input_events (session_id, id);

alter table public.remote_input_events enable row level security;

drop policy if exists remote_input_events_read on public.remote_input_events;
drop policy if exists remote_input_events_write on public.remote_input_events;

create policy remote_input_events_read
    on public.remote_input_events for select using (true);

create policy remote_input_events_write
    on public.remote_input_events for all using (true) with check (true);

-- ── File transfers (either direction) ───────────────────────────
create table if not exists public.remote_files (
    id uuid primary key default gen_random_uuid(),
    session_id uuid not null references public.remote_sessions (id) on delete cascade,
    direction text not null check (direction in ('to_host', 'to_viewer')),
    file_name text not null,
    storage_path text not null,
    file_size bigint,
    delivered boolean not null default false,
    created_at timestamptz not null default now()
);

create index if not exists remote_files_session_idx
    on public.remote_files (session_id, direction, delivered);

alter table public.remote_files enable row level security;

drop policy if exists remote_files_read on public.remote_files;
drop policy if exists remote_files_write on public.remote_files;

create policy remote_files_read
    on public.remote_files for select using (true);

create policy remote_files_write
    on public.remote_files for all using (true) with check (true);

-- ── Storage buckets ──────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values
    ('remote-screens', 'remote-screens', true),
    ('remote-files', 'remote-files', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists remote_screens_storage_read on storage.objects;
drop policy if exists remote_screens_storage_write on storage.objects;
drop policy if exists remote_files_storage_read on storage.objects;
drop policy if exists remote_files_storage_write on storage.objects;

create policy remote_screens_storage_read
    on storage.objects for select
    using (bucket_id = 'remote-screens');

create policy remote_screens_storage_write
    on storage.objects for all
    using (bucket_id = 'remote-screens')
    with check (bucket_id = 'remote-screens');

create policy remote_files_storage_read
    on storage.objects for select
    using (bucket_id = 'remote-files');

create policy remote_files_storage_write
    on storage.objects for all
    using (bucket_id = 'remote-files')
    with check (bucket_id = 'remote-files');

-- ── Realtime (so the viewer's browser sees Allow/Deny instantly) ──
-- Safe to re-run: skips tables already in the publication (matches the
-- pattern in realtime_publication.sql).
do $$
declare
    tbl text;
begin
    foreach tbl in array array['remote_sessions', 'remote_files']
    loop
        if not exists (
            select 1
            from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = tbl
        ) then
            execute format(
                'alter publication supabase_realtime add table public.%I',
                tbl
            );
        end if;
    end loop;
end $$;
