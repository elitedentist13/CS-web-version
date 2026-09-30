-- Mailbox for the csxrayai:// local protocol.
-- The clinic page (hosted or file://) cannot call http://127.0.0.1:8877.
-- It writes a job here, Windows runs the local AI service, and the page
-- reads the result back from this row.

create table if not exists public.xray_ai_jobs (
    id uuid primary key,
    kind text not null default 'http',
    status text not null default 'pending',
    image_url text,
    payload jsonb,
    result jsonb,
    error text,
    created_at timestamptz not null default now()
);

create index if not exists xray_ai_jobs_created_idx
    on public.xray_ai_jobs (created_at desc);

alter table public.xray_ai_jobs enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public'
          and tablename = 'xray_ai_jobs'
          and policyname = 'xray_ai_jobs_anon_all'
    ) then
        create policy xray_ai_jobs_anon_all
            on public.xray_ai_jobs
            for all
            using (true)
            with check (true);
    end if;
end $$;

grant select, insert, update on public.xray_ai_jobs to anon, authenticated;
