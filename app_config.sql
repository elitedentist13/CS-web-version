-- Generic clinic-wide key/value settings table.
-- Apply in Supabase SQL Editor. Safe to re-run (uses IF NOT EXISTS /
-- ON CONFLICT-safe DO blocks throughout).
--
-- Used by:
--   • Poster Maker  → 'unsplash_api_key', 'pexels_api_key'
--   • Periodontal Charting → Settings panel → 'banana_perio_chart_settings'
--     (tooth-numbering system, probing-sequence preset, GM sign, mirror
--     views) — stored here instead of localStorage so every computer /
--     browser in the clinic shares the same Settings, not just the PC
--     that last clicked Save.

create table if not exists public.app_config (
    key        text primary key,
    value      text,
    updated_at timestamptz default now()
);

alter table public.app_config enable row level security;

-- Anyone (anon + authenticated) can read config — needed so a fresh
-- browser/computer picks up the clinic-wide settings automatically.
do $$ begin
    if not exists (
        select 1 from pg_policies
        where tablename = 'app_config' and policyname = 'app_config_public_read'
    ) then
        create policy "app_config_public_read"
            on public.app_config for select using (true);
    end if;
end $$;

-- Anyone can write — this table only ever holds non-sensitive app
-- preferences (chart display settings, third-party photo API keys), never
-- patient data, so an open write policy is acceptable for a single-clinic
-- deployment.
do $$ begin
    if not exists (
        select 1 from pg_policies
        where tablename = 'app_config' and policyname = 'app_config_public_write'
    ) then
        create policy "app_config_public_write"
            on public.app_config for all using (true) with check (true);
    end if;
end $$;
