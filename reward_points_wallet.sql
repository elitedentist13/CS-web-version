-- Patient reward points on the phone (browse only).
-- The ledger panel shows a QR code; the phone opens points.html?t=<token> and sees that person's points.
-- Same person = the ledger panel rule: same HKID, else the same last 8 phone digits (all their charts add up).
-- Tokens are 32 hex characters from gen_random_uuid() (built into Postgres 13+, no extension or schema path needed).
-- The table is closed to the app key; only the two functions below touch it.
-- Run in Supabase → SQL Editor (after reward_points.sql). Safe to run again.

create table if not exists public.reward_wallet_links (
    token           text primary key,
    patient_id      uuid not null,
    created_at      timestamptz not null default now(),
    created_by      text,
    expires_at      timestamptz not null default (now() + interval '365 days'),
    revoked_at      timestamptz,
    view_count      integer not null default 0,
    last_viewed_at  timestamptz
);

create index if not exists reward_wallet_links_patient_idx
    on public.reward_wallet_links (patient_id);

alter table public.reward_wallet_links enable row level security;
revoke all on public.reward_wallet_links from anon, authenticated;

-- Staff app: get the patient's live points link, or make a new one (p_reset = true stops the old QR working).
create or replace function public.rw_wallet_link(
    p_patient_id uuid,
    p_by text default null,
    p_reset boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row public.reward_wallet_links;
begin
    if p_patient_id is null or not exists (select 1 from public.patients where id = p_patient_id) then
        return jsonb_build_object('ok', false, 'reason', 'no_patient');
    end if;
    if p_reset then
        update public.reward_wallet_links
           set revoked_at = now()
         where patient_id = p_patient_id and revoked_at is null;
    else
        select * into v_row
          from public.reward_wallet_links
         where patient_id = p_patient_id and revoked_at is null and expires_at > now() + interval '30 days'
         order by created_at desc
         limit 1;
    end if;
    if v_row.token is null then
        insert into public.reward_wallet_links (token, patient_id, created_by)
        values (replace(gen_random_uuid()::text, '-', ''), p_patient_id, left(coalesce(p_by, ''), 80))
        returning * into v_row;
    end if;
    return jsonb_build_object('ok', true, 'token', v_row.token, 'expires_at', v_row.expires_at);
end;
$$;

-- Phone: read-only view of one person's points. Masked name, balance and point movements only —
-- no ids, chart numbers, bills, staff notes or phone numbers.
create or replace function public.rw_wallet_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_link public.reward_wallet_links;
    v_pat record;
    v_name text;
    v_masked text;
    v_hk text;
    v_ph text;
    v_ids uuid[];
    v_balance numeric(12, 2);
    v_started timestamptz;
    v_accounts int;
    v_clinics jsonb;
    v_rows jsonb;
    v_prog jsonb;
    v_cap jsonb;
    v_doctors jsonb := '[]'::jsonb;
begin
    if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
        return jsonb_build_object('ok', false, 'reason', 'bad_link');
    end if;
    select * into v_link from public.reward_wallet_links where token = p_token;
    if v_link.token is null or v_link.revoked_at is not null then
        return jsonb_build_object('ok', false, 'reason', 'bad_link');
    end if;
    if v_link.expires_at <= now() then
        return jsonb_build_object('ok', false, 'reason', 'expired');
    end if;

    update public.reward_wallet_links
       set view_count = view_count + 1, last_viewed_at = now()
     where token = p_token;

    select id, chinese_name, full_name, hkid, phone_number, mobile_phone
      into v_pat
      from public.patients where id = v_link.patient_id;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'bad_link');
    end if;

    v_name := coalesce(nullif(trim(v_pat.chinese_name), ''), nullif(trim(v_pat.full_name), ''), '');
    if v_name ~ '[一-鿿]' then
        v_masked := left(regexp_replace(v_name, '\s+', '', 'g'), 1) ||
            repeat('○', greatest(char_length(regexp_replace(v_name, '\s+', '', 'g')) - 1, 0));
    elsif v_name <> '' then
        select string_agg(upper(left(w, 1)) || '.', ' ') into v_masked
          from regexp_split_to_table(v_name, '\s+') as w where w <> '';
    end if;

    v_hk := upper(regexp_replace(coalesce(v_pat.hkid, ''), '[^A-Za-z0-9]', '', 'g'));
    v_ph := regexp_replace(coalesce(nullif(trim(v_pat.mobile_phone), ''), v_pat.phone_number, ''), '[^0-9]', '', 'g');
    if char_length(v_hk) >= 7 then
        select array_agg(p.id) into v_ids
          from public.patients p
         where upper(regexp_replace(coalesce(p.hkid, ''), '[^A-Za-z0-9]', '', 'g')) = v_hk;
    elsif char_length(v_ph) >= 8 then
        select array_agg(p.id) into v_ids
          from public.patients p
         where right(regexp_replace(coalesce(nullif(trim(p.mobile_phone), ''), p.phone_number, ''), '[^0-9]', '', 'g'), 8) = right(v_ph, 8);
    end if;
    if v_ids is null or not (v_link.patient_id = any (v_ids)) then
        v_ids := array_append(coalesce(v_ids, '{}'::uuid[]), v_link.patient_id);
    end if;

    select coalesce(sum(a.balance), 0), min(a.started_at), count(*)
      into v_balance, v_started, v_accounts
      from public.reward_accounts a
     where a.patient_id = any (v_ids);

    select coalesce(jsonb_agg(jsonb_build_object('clinic', x.clinic, 'balance', x.balance) order by x.balance desc), '[]'::jsonb)
      into v_clinics
      from (select coalesce(nullif(trim(a.clinic_code), ''), '—') as clinic, sum(a.balance) as balance
              from public.reward_accounts a
             where a.patient_id = any (v_ids)
             group by 1
            having sum(a.balance) > 0.005) x;

    select coalesce(jsonb_agg(jsonb_build_object(
               'at', l.created_at,
               'kind', case
                   when l.kind = 'adjust' and coalesce(l.note, '') ~* '^\s*referral' then 'referral'
                   when l.kind = 'adjust' and l.points < 0 and coalesce(l.note, '') like '%[batch %' then 'cleared'
                   else l.kind end,
               'points', l.points,
               'balance_after', case when v_accounts = 1 then l.balance_after end,
               'clinic', nullif(trim(coalesce(l.clinic_code, '')), '')
           ) order by l.created_at desc), '[]'::jsonb)
      into v_rows
      from (select * from public.reward_ledger
             where patient_id = any (v_ids)
               and created_at > now() - interval '365 days'
             order by created_at desc
             limit 80) l;

    begin
        select coalesce((
            select jsonb_agg(x.d order by x.d)
              from (
                  select distinct left(trim(l.doctor_name), 80) as d
                    from public.reward_ledger l
                   where l.patient_id = any (v_ids)
                     and nullif(trim(l.doctor_name), '') is not null
              ) x
        ), '[]'::jsonb) into v_doctors;
    exception when undefined_column then
        v_doctors := '[]'::jsonb;
    end;

    select to_jsonb(p) into v_prog from public.reward_program p where p.id = 1;

    -- Per-bill limit from Configuration → Reward Points (same default as the app when never saved).
    begin
        select s.setting_value::jsonb into v_cap
          from public.program_settings s where s.setting_key = 'reward_redeem_cap';
    exception when others then
        v_cap := null;
    end;

    return jsonb_build_object(
        'ok', true,
        'name', coalesce(v_masked, ''),
        'today', (now() at time zone 'Asia/Hong_Kong')::date,
        'balance', public.reward_round2(v_balance),
        'started_at', v_started,
        'charts', v_accounts,
        'clinics', v_clinics,
        'rows', v_rows,
        'earn_rate', v_prog -> 'earn_rate_percent',
        'zero_policy', v_prog ->> 'zero_policy',
        'lifespan_months', v_prog -> 'lifespan_months',
        'redeem_cap', coalesce(v_cap, '{"maxPercent": 0, "maxAmount": 3000}'::jsonb),
        'doctors', coalesce(v_doctors, '[]'::jsonb)
    );
end;
$$;

revoke all on function public.rw_wallet_link(uuid, text, boolean) from public;
revoke all on function public.rw_wallet_view(text) from public;
grant execute on function public.rw_wallet_link(uuid, text, boolean) to anon, authenticated, service_role;
grant execute on function public.rw_wallet_view(text) to anon, authenticated, service_role;

-- Let the API see the new functions straight away.
notify pgrst, 'reload schema';
