-- Year-end reminder SMS for discount coupons and reward points (30 Nov and 24 Dec, Hong Kong date).
-- Sent only when that scheme's Set zero option is "year end". One row per scheme / year / stage / person:
-- a station inserts the row before texting, so several open stations never send the same reminder twice.
-- Run once in the Supabase SQL editor (safe to re-run). Until it runs, no year-end reminders are sent.

create table if not exists public.loyalty_yearend_sms (
    id          bigserial primary key,
    scheme      text        not null check (scheme in ('coupons', 'rewards')),
    year        int         not null,
    stage       text        not null check (stage in ('month', 'week')),
    person_key  text        not null,
    patient_id  uuid,
    status      text        not null default 'claimed' check (status in ('claimed', 'sent', 'no_phone')),
    to_phone    text,
    claimed_at  timestamptz not null default now(),
    sent_at     timestamptz,
    unique (scheme, year, stage, person_key)
);

alter table public.loyalty_yearend_sms enable row level security;

do $$
begin
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'loyalty_yearend_sms'
                   and policyname = 'loyalty_yearend_sms_anon_all') then
        create policy loyalty_yearend_sms_anon_all
            on public.loyalty_yearend_sms for all using (true) with check (true);
    end if;
end $$;

grant select, insert, update, delete on public.loyalty_yearend_sms to anon, authenticated;
grant usage, select on sequence public.loyalty_yearend_sms_id_seq to anon, authenticated;
