-- Loyalty jobs in the database (Hong Kong time), so they run even when no desk is open:
--   • Set zero for discount coupons and reward points: year end (1 Jan 00:05) and life span (daily),
--     following each scheme's Set zero option. The "done" mark is taken first, so desks skip it.
--   • Daily SMS at 10:00: coupon expiry reminders (1 month / 7 days before), coupon year-end reminders and
--     reward points year-end reminders (30 Nov – 30 Dec), sent through the twilio-whatsapp Edge function.
--     The same claims as the desk are used, so a patient is never texted twice.
--   • Every 5 minutes: read the Twilio replies; failed sends give their claim back for the next run.
-- Desks stay as the backup: when this job is on they wait until 11:00 and send only what the database did not.
--
-- Run once in the Supabase SQL editor after loyalty_security.sql. Safe to re-run.
-- Needs the pg_cron and pg_net extensions (Database → Extensions in Supabase; this file tries to turn them on).
-- The SMS sender login: loyalty_job_config.sms_user_id (blank = first active admin login).

do $$
begin
    begin
        create extension if not exists pg_net with schema extensions;
    exception when others then
        raise notice 'pg_net not available: %', sqlerrm;
    end;
    begin
        create extension if not exists pg_cron;
    exception when others then
        raise notice 'pg_cron not available: %', sqlerrm;
    end;
end $$;

-- ── settings and run log ───────────────────────────────────────────────────────
create table if not exists public.loyalty_job_config (
    id            smallint primary key default 1 check (id = 1),
    zero_on       boolean not null default true,
    sms_on        boolean not null default true,
    sms_user_id   text,
    functions_url text,
    anon_key      text,
    updated_at    timestamptz not null default now()
);

insert into public.loyalty_job_config (id, functions_url, anon_key)
values (1, 'https://kprihawipljrltfzpfjd.supabase.co/functions/v1/twilio-whatsapp', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0.fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4')
on conflict (id) do nothing;

create table if not exists public.loyalty_job_runs (
    id          bigserial primary key,
    job         text not null,
    run_on      date not null,
    started_at  timestamptz not null default now(),
    finished_at timestamptz,
    result      jsonb,
    unique (job, run_on)
);

create table if not exists public.loyalty_sms_outbox (
    id          bigserial primary key,
    created_at  timestamptz not null default now(),
    kind        text not null,
    patient_id  uuid,
    to_phone    text,
    body        text,
    coupon_id   uuid,
    claim_col   text,
    claim_ids   bigint[],
    request_id  bigint,
    status      text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'no_phone')),
    error       text,
    done_at     timestamptz
);
create index if not exists loyalty_sms_outbox_queued_idx on public.loyalty_sms_outbox (status) where status = 'queued';

alter table public.loyalty_job_config enable row level security;
alter table public.loyalty_job_runs enable row level security;
alter table public.loyalty_sms_outbox enable row level security;
do $$
begin
    if not exists (select 1 from pg_policies where tablename = 'loyalty_job_config' and policyname = 'loyalty_job_config_read') then
        create policy loyalty_job_config_read on public.loyalty_job_config for select using (true);
    end if;
    if not exists (select 1 from pg_policies where tablename = 'loyalty_job_runs' and policyname = 'loyalty_job_runs_read') then
        create policy loyalty_job_runs_read on public.loyalty_job_runs for select using (true);
    end if;
    if not exists (select 1 from pg_policies where tablename = 'loyalty_sms_outbox' and policyname = 'loyalty_sms_outbox_read') then
        create policy loyalty_sms_outbox_read on public.loyalty_sms_outbox for select using (true);
    end if;
end $$;
revoke all on public.loyalty_job_config, public.loyalty_job_runs, public.loyalty_sms_outbox from anon, authenticated;
grant select (id, zero_on, sms_on, sms_user_id, updated_at) on public.loyalty_job_config to anon, authenticated;
grant select on public.loyalty_job_runs to anon, authenticated;
grant select (id, created_at, kind, patient_id, coupon_id, status, error, done_at) on public.loyalty_sms_outbox to anon, authenticated;

-- ── text helpers (same wording as app-coupons.js / app-rewards.js) ─────────────
/** JavaScript number text after round2: 1000 → "1000", 12.5 → "12.5". */
create or replace function public.loyalty_js_num(p numeric)
returns text language sql immutable as $$
    select case when round(coalesce(p, 0), 2) = trunc(round(coalesce(p, 0), 2))
        then trunc(round(coalesce(p, 0), 2))::bigint::text
        else rtrim(round(coalesce(p, 0), 2)::text, '0') end
$$;

create or replace function public.dc_clinic_joined(p_scheme jsonb, p_code text)
returns boolean language sql immutable as $$
    select case when (p_scheme -> 'clinics' -> upper(btrim(coalesce(p_code, '')))) is not null
        then coalesce((p_scheme -> 'clinics' -> upper(btrim(coalesce(p_code, ''))) ->> 'joined')::boolean, false)
        else upper(btrim(coalesce(p_code, ''))) = 'KT' end
$$;

/** "現金券 Cash coupon"; spend coupons read "滿$1000送$100 Spend $1000 get $100" (smsCouponName). */
create or replace function public.loyalty_coupon_name(p_scheme jsonb, p_key text)
returns text language plpgsql stable as $$
declare
    names jsonb := '{
      "cash": ["現金券", "Cash coupon"], "spend_1": ["滿$1000送$100", "Spend $1000 get $100"],
      "spend_2": ["滿$5000送$500", "Spend $5000 get $500"], "spend_3": ["滿$10000送$1000", "Spend $10000 get $1000"],
      "spend_4": ["自訂滿額 1", "Custom spend 1"], "spend_5": ["自訂滿額 2", "Custom spend 2"],
      "new_chart": ["新客券", "New chart"], "referral": ["介紹新客", "Refer a friend"],
      "free_scaling": ["免費洗牙", "Free scaling"], "free_filling": ["免費補牙", "Free filling"],
      "free_extraction": ["免費脫牙", "Free extraction"], "implant": ["植牙優惠", "Implant discount"],
      "ortho": ["矯齒優惠", "Orthodontic discount"], "crown_bridge": ["牙套牙橋優惠", "Crown and bridge"],
      "root_canal": ["根管優惠", "Root canal"], "whitening": ["美白優惠", "Whitening"]
    }'::jsonb;
    c jsonb := public.dc_campaign(p_scheme, p_key);
    zh text;
    en text;
begin
    if c is not null and c ->> 'trigger' = 'target_spend' and public.dc_num(c, 'target', 0) > 0 and public.dc_num(c, 'face', 0) > 0 then
        return '滿$' || public.loyalty_js_num(public.dc_num(c, 'target', 0)) || '送$' || public.loyalty_js_num(public.dc_num(c, 'face', 0)) ||
            ' Spend $' || public.loyalty_js_num(public.dc_num(c, 'target', 0)) || ' get $' || public.loyalty_js_num(public.dc_num(c, 'face', 0));
    end if;
    zh := coalesce(nullif(c ->> 'nameZh', ''), names -> p_key ->> 0, '');
    en := coalesce(nullif(c ->> 'name', ''), names -> p_key ->> 1, '');
    if zh <> '' and en <> '' and zh <> en then return zh || ' ' || en; end if;
    return coalesce(nullif(zh, ''), nullif(en, ''), nullif(p_key, ''), '優惠券 Coupon');
end;
$$;

create or replace function public.loyalty_coupon_value(p_mode text, p_face numeric, p_percent numeric, p_max numeric)
returns text language sql immutable as $$
    select case
        when p_mode = 'free_line' then '免費/Free'
        when p_mode = 'percent' then public.loyalty_js_num(p_percent) || '%' ||
            case when coalesce(p_max, 0) > 0 then ' (最多/up to HK$' || round(p_max, 2)::numeric(14, 2)::text || ')' else '' end
        else 'HK$' || round(coalesce(p_face, 0), 2)::numeric(14, 2)::text end
$$;

/** couponSmsBody: heading, change, balance at the clinic, all-clinic total, usable coupons (10), clinic, ref, year-end note. */
create or replace function public.loyalty_coupon_sms(
    p_patient_id uuid, p_change text, p_clinic text, p_ref text, p_today date, p_scheme jsonb, p_policy text
)
returns text language plpgsql stable security definer set search_path = public as $$
declare
    v_lines text[] := array[]::text[];
    v_clinic text := btrim(coalesce(p_clinic, ''));
    v_total int := 0;
    v_here int := 0;
    v_i int := 0;
    v_y text := extract(year from p_today)::text;
    r record;
begin
    select count(*), count(*) filter (where v_clinic <> '' and upper(btrim(coalesce(c.clinic_code, ''))) = upper(v_clinic))
      into v_total, v_here
      from public.discount_coupons c
     where c.patient_id = p_patient_id and c.status = 'unused'
       and coalesce(public.dc_eff_expiry(c.expires_on, c.issued_at, p_policy), '9999-12-31'::date) >= p_today;
    v_lines := v_lines || '[Joyful Smile Dental Clinic 樂意牙科中心] 優惠券更新 / Discount coupon update'::text;
    v_lines := v_lines || ('變動/Change: ' || coalesce(p_change, ''));
    v_lines := v_lines || ('結餘/Balance (' || v_clinic || '): ' || v_here || '張 / ' || v_here || case when v_here = 1 then ' coupon' else ' coupons' end);
    v_lines := v_lines || ('總結餘/All-clinic total: ' || v_total || '張 / ' || v_total || case when v_total = 1 then ' coupon' else ' coupons' end);
    if v_total > 0 then
        v_lines := v_lines || '可用優惠券/Available coupons:'::text;
        for r in
            select c.*
              from public.discount_coupons c
             where c.patient_id = p_patient_id and c.status = 'unused'
               and coalesce(public.dc_eff_expiry(c.expires_on, c.issued_at, p_policy), '9999-12-31'::date) >= p_today
             order by coalesce(public.dc_eff_expiry(c.expires_on, c.issued_at, p_policy), '9999-12-31'::date), c.issued_at, c.code
             limit 10
        loop
            v_i := v_i + 1;
            v_lines := v_lines || (v_i || '. ' || public.loyalty_coupon_name(p_scheme, r.campaign_key) || ' ' ||
                public.loyalty_coupon_value(r.discount_mode, r.face_value, r.percent, r.max_discount) ||
                case when coalesce(r.code, '') <> '' then ' (' || r.code || ')' else '' end);
        end loop;
        if v_total > 10 then
            v_lines := v_lines || ('…另有' || (v_total - 10) || '張 / and ' || (v_total - 10) || ' more');
        end if;
    end if;
    v_lines := v_lines || ('診所/Clinic: ' || v_clinic);
    v_lines := v_lines || ('參考/Ref: ' || coalesce(nullif(p_ref, ''), '—'));
    v_lines := v_lines || ('備註/Note: 所有優惠券將於今年' || v_y || '年12月31日 23:59到期，請好好善用；歡迎邀請親友使用。' ||
        'All discount coupons expire on 31 Dec ' || v_y || ' 23:59 this year. Please make good use of them, and you are welcome to invite others to use them.');
    return array_to_string(v_lines, E'\n');
end;
$$;

/** pointsYearEndSms in app-rewards.js. */
create or replace function public.loyalty_points_yearend_sms(p_today date, p_total numeric, p_clinic text)
returns text language sql immutable as $$
    select '[Joyful Smile Dental Clinic 樂意牙科中心] 積分到期提醒 / Reward points expiry reminder' || E'\n' ||
        '總結餘/All-clinic total: ' || round(coalesce(p_total, 0), 2)::numeric(14, 2)::text || E'\n' ||
        '到期/Expiry: ' || y || '年12月31日 23:59（還有' || d || '日）/ 31 Dec ' || y || ' 23:59 (' || d ||
            case when d = 1 then ' day' else ' days' end || ' left)' || E'\n' ||
        case when coalesce(btrim(p_clinic), '') <> '' then '診所/Clinic: ' || p_clinic || E'\n' else '' end ||
        '備註/Note: 所有積分將於今年' || y || '年12月31日 23:59到期，請好好善用；歡迎邀請親友使用。' ||
        'All reward points expire on 31 Dec ' || y || ' 23:59 this year. Please make good use of them, and you are welcome to invite others to use them.'
      from (select extract(year from p_today)::int::text as y,
                   (make_date(extract(year from p_today)::int, 12, 31) - p_today) as d) x
$$;

/** Same windows as expiryReminderStage / yearEndReminderStage (7 days, 1 calendar month). */
create or replace function public.loyalty_expiry_stage(p_expires date, p_issued_on date, p_today date)
returns text language plpgsql immutable as $$
declare
    v_days int;
    v_month_from date;
begin
    if p_expires is null or p_today is null then return ''; end if;
    v_days := p_expires - p_today;
    if v_days < 1 then return ''; end if;
    if v_days <= 7 then return case when p_issued_on = p_today then '' else 'week' end; end if;
    v_month_from := (p_expires - interval '1 month')::date;
    if p_today < v_month_from then return ''; end if;
    if p_issued_on is not null and p_issued_on >= v_month_from then return ''; end if;
    return 'month';
end;
$$;

create or replace function public.loyalty_yearend_stage(p_today date)
returns text language sql immutable as $$
    select case
        when p_today >= make_date(extract(year from p_today)::int, 12, 31) then ''
        when p_today >= make_date(extract(year from p_today)::int, 12, 31) - 7 then 'week'
        when p_today >= make_date(extract(year from p_today)::int, 11, 30) then 'month'
        else '' end
$$;

-- ── send one SMS through the Edge function (pg_net) ────────────────────────────
create or replace function public.loyalty_sms_queue(
    p_kind text, p_patient_id uuid, p_body text, p_sender text,
    p_coupon_id uuid default null, p_claim_col text default null, p_claim_ids bigint[] default null, p_phone_from uuid[] default null
)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
    v_cfg public.loyalty_job_config;
    v_pat record;
    v_phone text;
    v_req bigint;
begin
    select * into v_cfg from public.loyalty_job_config where id = 1;
    select id, patient_no, full_name, chinese_name, btrim(coalesce(nullif(btrim(phone_number), ''), mobile_phone, '')) as phone
      into v_pat
      from public.patients
     where id = any (coalesce(p_phone_from, array[p_patient_id]))
       and btrim(coalesce(nullif(btrim(phone_number), ''), mobile_phone, '')) <> ''
     order by (id = p_patient_id) desc
     limit 1;
    v_phone := coalesce(v_pat.phone, '');
    if v_phone = '' then
        insert into public.loyalty_sms_outbox (kind, patient_id, body, coupon_id, claim_col, claim_ids, status, done_at)
        values (p_kind, p_patient_id, p_body, p_coupon_id, p_claim_col, p_claim_ids, 'no_phone', now());
        if p_claim_ids is not null then
            update public.loyalty_yearend_sms set status = 'no_phone', sent_at = now() where id = any (p_claim_ids) and status = 'claimed';
        end if;
        return 'no_phone';
    end if;
    v_req := net.http_post(
        url := v_cfg.functions_url,
        body := jsonb_build_object('channel', 'sms', 'to', v_phone,
            'name', coalesce(nullif(v_pat.full_name, ''), nullif(v_pat.chinese_name, ''), v_pat.patient_no, 'Patient'),
            'body', left(p_body, 1500), 'callerUserId', p_sender, 'callerClinicId', ''),
        headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_cfg.anon_key,
            'Authorization', 'Bearer ' || v_cfg.anon_key),
        timeout_milliseconds := 20000
    );
    insert into public.loyalty_sms_outbox (kind, patient_id, to_phone, body, coupon_id, claim_col, claim_ids, request_id)
    values (p_kind, v_pat.id, v_phone, p_body, p_coupon_id, p_claim_col, p_claim_ids, v_req);
    return 'queued';
end;
$$;

-- Read the Edge function replies: sent → keep the claim; failed or no reply after an hour → give it back.
create or replace function public.loyalty_sms_settle()
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
    r record;
    v_ok boolean;
    v_err text;
    v_sent int := 0;
    v_failed int := 0;
begin
    for r in
        select o.*, h.status_code, h.content, h.timed_out, h.error_msg, (h.id is not null) as answered
          from public.loyalty_sms_outbox o
          left join net._http_response h on h.id = o.request_id
         where o.status = 'queued'
         order by o.id
         limit 500
    loop
        if not r.answered and r.created_at > now() - interval '1 hour' then
            continue;
        end if;
        v_ok := false;
        v_err := null;
        if r.answered then
            begin
                v_ok := r.status_code = 200 and coalesce((r.content::jsonb ->> 'ok')::boolean, false);
                if not v_ok then v_err := coalesce(r.content::jsonb ->> 'error', r.error_msg, 'HTTP ' || r.status_code); end if;
            exception when others then
                v_err := coalesce(r.error_msg, left(r.content, 200), 'bad reply');
            end;
        else
            v_err := 'no reply';
        end if;
        update public.loyalty_sms_outbox set status = case when v_ok then 'sent' else 'failed' end, error = left(v_err, 300), done_at = now()
         where id = r.id;
        if v_ok then
            v_sent := v_sent + 1;
            if r.claim_ids is not null then
                update public.loyalty_yearend_sms set status = 'sent', to_phone = r.to_phone, sent_at = now()
                 where id = any (r.claim_ids) and status = 'claimed';
            end if;
        else
            v_failed := v_failed + 1;
            if r.claim_ids is not null then
                delete from public.loyalty_yearend_sms where id = any (r.claim_ids) and status = 'claimed';
            elsif r.coupon_id is not null and r.claim_col = 'expiry_sms_at' then
                update public.discount_coupons set expiry_sms_at = null where id = r.coupon_id;
            elsif r.coupon_id is not null and r.claim_col = 'expiry_sms_month_at' then
                update public.discount_coupons set expiry_sms_month_at = null where id = r.coupon_id;
            end if;
        end if;
        if r.kind = 'points_yearend' then
            begin
                insert into public.reward_sms_log (patient_id, to_phone, body, status, error)
                values (r.patient_id, r.to_phone, r.body, case when v_ok then 'sent' else 'failed' end, v_err);
            exception when others then null;
            end;
        end if;
    end loop;
    return jsonb_build_object('ok', true, 'sent', v_sent, 'failed', v_failed);
end;
$$;

-- ── daily SMS run ──────────────────────────────────────────────────────────────
create or replace function public.loyalty_run_daily_sms(p_today date default null, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare
    v_today date := coalesce(p_today, public.dc_hk_today());
    v_cfg public.loyalty_job_config;
    v_sender text;
    v_scheme jsonb := public.dc_setting_json('discount_coupon_scheme');
    v_policy text := coalesce(public.dc_setting_json('coupon_zero_policy') ->> 'zero_policy', 'manual');
    v_end date := make_date(extract(year from v_today)::int, 12, 31);
    v_stage text := public.loyalty_yearend_stage(v_today);
    v_stage_from date;
    v_run_id bigint;
    v_week int := 0;
    v_month int := 0;
    v_ye int := 0;
    v_pts int := 0;
    v_ids bigint[];
    v_res text;
    v_prog record;
    r record;
begin
    select * into v_cfg from public.loyalty_job_config where id = 1;
    if not found or not v_cfg.sms_on then return jsonb_build_object('ok', true, 'skipped', 'off'); end if;
    v_sender := nullif(btrim(coalesce(v_cfg.sms_user_id, '')), '');
    if v_sender is null then
        select user_id into v_sender from public.app_users
         where coalesce(is_active, false) and lower(coalesce(role, '')) = 'admin' and lower(user_id) <> 'nurse'
         order by user_id limit 1;
    end if;
    if v_sender is null or coalesce(v_cfg.functions_url, '') = '' then
        return jsonb_build_object('ok', false, 'reason', 'no_sender');
    end if;
    insert into public.loyalty_job_runs (job, run_on) values ('sms', v_today)
    on conflict (job, run_on) do nothing returning id into v_run_id;
    if v_run_id is null then
        if not p_force then return jsonb_build_object('ok', true, 'skipped', 'ran_today'); end if;
        select id into v_run_id from public.loyalty_job_runs where job = 'sms' and run_on = v_today;
    end if;

    -- Coupon expiry reminders, one per coupon per window. With year end, coupons lasting to 31 Dec get the year-end SMS instead.
    for r in
        select c.*, (c.issued_at at time zone 'Asia/Hong_Kong')::date as issued_on,
               public.loyalty_expiry_stage(c.expires_on, (c.issued_at at time zone 'Asia/Hong_Kong')::date, v_today) as stage
          from public.discount_coupons c
         where c.status = 'unused' and c.expires_on > v_today and c.expires_on <= v_today + 31
           and (v_policy <> 'year_end' or c.expires_on < v_end)
           and (c.clinic_code is null or public.dc_clinic_joined(v_scheme, c.clinic_code))
         order by c.expires_on
         limit 600
    loop
        if r.stage = 'week' and r.expiry_sms_at is null then
            update public.discount_coupons set expiry_sms_at = now() where id = r.id and expiry_sms_at is null;
            if found then
                v_res := public.loyalty_sms_queue('coupon_week', r.patient_id,
                    public.loyalty_coupon_sms(r.patient_id,
                        public.loyalty_coupon_name(v_scheme, r.campaign_key) || ' ' ||
                        public.loyalty_coupon_value(r.discount_mode, r.face_value, r.percent, r.max_discount) || ' ' ||
                        (r.expires_on - v_today) || '日內到期 (' || r.expires_on || ') / expires in ' || (r.expires_on - v_today) ||
                        case when r.expires_on - v_today = 1 then ' day' else ' days' end,
                        coalesce(r.clinic_code, ''), r.code, v_today, v_scheme, v_policy),
                    v_sender, r.id, 'expiry_sms_at');
                v_week := v_week + 1;
            end if;
        elsif r.stage = 'month' and r.expiry_sms_at is null and r.expiry_sms_month_at is null then
            update public.discount_coupons set expiry_sms_month_at = now() where id = r.id and expiry_sms_month_at is null;
            if found then
                v_res := public.loyalty_sms_queue('coupon_month', r.patient_id,
                    public.loyalty_coupon_sms(r.patient_id,
                        public.loyalty_coupon_name(v_scheme, r.campaign_key) || ' ' ||
                        public.loyalty_coupon_value(r.discount_mode, r.face_value, r.percent, r.max_discount) || ' ' ||
                        (r.expires_on - v_today) || '日內到期 (' || r.expires_on || ') / expires in ' || (r.expires_on - v_today) ||
                        case when r.expires_on - v_today = 1 then ' day' else ' days' end,
                        coalesce(r.clinic_code, ''), r.code, v_today, v_scheme, v_policy),
                    v_sender, r.id, 'expiry_sms_month_at');
                v_month := v_month + 1;
            end if;
        end if;
    end loop;

    -- Year-end reminders (30 Nov – 30 Dec), only when that scheme's Set zero is on year end.
    if v_stage <> '' then
        v_stage_from := case when v_stage = 'week' then v_end - 7 else make_date(extract(year from v_today)::int, 11, 30) end;
        if v_policy = 'year_end' then
            for r in
                select distinct on (c.patient_id) c.patient_id, coalesce(c.clinic_code, '') as clinic_code
                  from public.discount_coupons c
                 where c.status = 'unused' and c.expires_on >= v_end
                   and (c.clinic_code is null or public.dc_clinic_joined(v_scheme, c.clinic_code))
                   and case when v_stage = 'month'
                        then (c.issued_at at time zone 'Asia/Hong_Kong')::date < v_stage_from
                        else (c.issued_at at time zone 'Asia/Hong_Kong')::date <> v_today end
                 order by c.patient_id, c.issued_at
                 limit 2000
            loop
                v_ids := public.loyalty_yearend_claim('coupons', extract(year from v_today)::int, v_stage, array['p:' || r.patient_id], r.patient_id);
                if v_ids is not null then
                    v_res := public.loyalty_sms_queue('coupon_yearend', r.patient_id,
                        public.loyalty_coupon_sms(r.patient_id,
                            '所有優惠券將於' || extract(year from v_today)::int || '年12月31日 23:59到期（還有' || (v_end - v_today) ||
                            '日）/ All coupons expire on 31 Dec ' || extract(year from v_today)::int || ' 23:59 (' || (v_end - v_today) ||
                            case when v_end - v_today = 1 then ' day' else ' days' end || ' left)',
                            r.clinic_code, '', v_today, v_scheme, v_policy),
                        v_sender, null, null, v_ids);
                    v_ye := v_ye + 1;
                end if;
            end loop;
        end if;

        begin
            select zero_policy, sms_notify_enabled into v_prog from public.reward_program where id = 1;
            if found and v_prog.zero_policy = 'year_end' and coalesce(v_prog.sms_notify_enabled, true) then
                for r in
                    with acc as (
                        select a.patient_id, a.clinic_code, a.balance,
                               upper(regexp_replace(coalesce(p.hkid, ''), '[^A-Za-z0-9]', '', 'g')) as hk,
                               right(regexp_replace(coalesce(nullif(p.mobile_phone, ''), p.phone_number, ''), '[^0-9]', '', 'g'), 8) as ph
                          from public.reward_accounts a
                          join public.patients p on p.id = a.patient_id
                    ), keyed as (
                        select acc.*, case when length(hk) >= 7 then 'h:' || hk when length(ph) >= 8 then 't:' || ph
                                           else 'i:' || patient_id::text end as person
                          from acc
                    ), people as (
                        select person, array_agg(patient_id order by patient_id::text) as ids, sum(round(balance, 2)) as total,
                               (array_agg(patient_id order by patient_id::text) filter (where balance > 0))[1] as lead_id,
                               (array_agg(coalesce(clinic_code, '') order by patient_id::text) filter (where balance > 0))[1] as clinic
                          from keyed group by person
                    )
                    select * from people where total > 0 order by person limit 2000
                loop
                    v_ids := public.loyalty_yearend_claim('rewards', extract(year from v_today)::int, v_stage,
                        (select array_agg('p:' || x::text order by x::text) from unnest(r.ids) x), r.lead_id);
                    if v_ids is not null then
                        v_res := public.loyalty_sms_queue('points_yearend', r.lead_id,
                            public.loyalty_points_yearend_sms(v_today, r.total, r.clinic), v_sender, null, null, v_ids, r.ids);
                        v_pts := v_pts + 1;
                    end if;
                end loop;
            end if;
        exception when undefined_table or undefined_column then
            null;
        end;
    end if;

    update public.loyalty_job_runs
       set finished_at = now(),
           result = jsonb_build_object('week', v_week, 'month', v_month, 'coupon_yearend', v_ye, 'points_yearend', v_pts, 'sender', v_sender)
     where id = v_run_id;
    return jsonb_build_object('ok', true, 'week', v_week, 'month', v_month, 'coupon_yearend', v_ye, 'points_yearend', v_pts);
end;
$$;

-- ── Set zero (coupons + points) ────────────────────────────────────────────────
create or replace function public.loyalty_run_zero(p_now timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    v_now timestamptz := coalesce(p_now, now());
    v_y int := extract(year from (v_now at time zone 'Asia/Hong_Kong'))::int;
    v_cfg public.loyalty_job_config;
    v_pol jsonb := public.dc_setting_json('coupon_zero_policy');
    v_kind text := coalesce(v_pol ->> 'zero_policy', 'manual');
    v_months int;
    v_last_run timestamptz;
    v_coupons jsonb := jsonb_build_object('skipped', 'manual');
    v_points jsonb := jsonb_build_object('skipped', 'manual');
    v_prog record;
    v_n int;
begin
    select * into v_cfg from public.loyalty_job_config where id = 1;
    if found and not v_cfg.zero_on then return jsonb_build_object('ok', true, 'skipped', 'off'); end if;

    begin
        if v_kind = 'year_end' and coalesce((v_pol ->> 'last_year_end_zero_year')::int, 0) < v_y then
            update public.program_settings
               set setting_value = (v_pol || jsonb_build_object('last_year_end_zero_year', v_y))::text, updated_at = v_now
             where setting_key = 'coupon_zero_policy' and clinic_id is null
               and coalesce((setting_value::jsonb ->> 'last_year_end_zero_year')::int, 0) < v_y;
            get diagnostics v_n = row_count;
            v_coupons := case when v_n > 0
                then public.dc_zero_coupons(true, null, 'system (database job)',
                    'Auto year-end SET ZERO (31 Dec 23:59 HK) for ' || (v_y - 1), 'year_end',
                    (make_date(v_y, 1, 1)::timestamp at time zone 'Asia/Hong_Kong'))
                else jsonb_build_object('skipped', 'taken') end;
        elsif v_kind = 'lifespan' then
            v_months := coalesce((v_pol ->> 'lifespan_months')::int, 12);
            if v_months not in (1, 2, 3, 4, 6, 9, 12, 24) then v_months := 12; end if;
            v_last_run := (v_pol ->> 'last_lifespan_run_at')::timestamptz;
            if v_last_run is null or v_now - v_last_run >= interval '1 day' then
                update public.program_settings
                   set setting_value = (v_pol || jsonb_build_object('last_lifespan_run_at', v_now))::text, updated_at = v_now
                 where setting_key = 'coupon_zero_policy' and clinic_id is null
                   and setting_value::jsonb ->> 'last_lifespan_run_at' is not distinct from v_pol ->> 'last_lifespan_run_at';
                get diagnostics v_n = row_count;
                v_coupons := case when v_n > 0
                    then public.dc_zero_coupons(true, null, 'system (database job)',
                        'Auto lifespan SET ZERO: coupons older than ' || v_months || ' months', 'lifespan', v_now - make_interval(months => v_months))
                    else jsonb_build_object('skipped', 'taken') end;
            else
                v_coupons := jsonb_build_object('skipped', 'ran_today');
            end if;
        elsif v_kind = 'year_end' then
            v_coupons := jsonb_build_object('skipped', 'done_this_year');
        end if;
    exception when others then
        v_coupons := jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

    begin
        select zero_policy, lifespan_months, last_year_end_zero_year, last_lifespan_run_at into v_prog from public.reward_program where id = 1;
        if found and v_prog.zero_policy = 'year_end' then
            update public.reward_program set last_year_end_zero_year = v_y, updated_at = v_now, updated_by = 'system (database job)'
             where id = 1 and coalesce(last_year_end_zero_year, 0) < v_y;
            get diagnostics v_n = row_count;
            if v_n > 0 then
                v_points := public.reward_zero_clinics(true, null::uuid[], null::text[], 'system (database job)',
                    'Auto year-end RESET ZERO (31 Dec 23:59 HK) for ' || (v_y - 1), 'year_end');
                update public.reward_program set last_year_end_zero_year = greatest(coalesce(last_year_end_zero_year, 0), v_y) where id = 1;
            else
                v_points := jsonb_build_object('skipped', 'done_this_year');
            end if;
        elsif found and v_prog.zero_policy = 'lifespan' then
            if v_prog.last_lifespan_run_at is null or v_now - v_prog.last_lifespan_run_at >= interval '1 day' then
                v_points := public.reward_expire_lifespan(coalesce(v_prog.lifespan_months, 12), 'system (database job)',
                    'Auto lifespan expiry ' || coalesce(v_prog.lifespan_months, 12) || ' months');
            else
                v_points := jsonb_build_object('skipped', 'ran_today');
            end if;
        end if;
    exception when others then
        v_points := jsonb_build_object('ok', false, 'error', sqlerrm);
    end;

    insert into public.loyalty_job_runs (job, run_on, finished_at, result)
    values ('zero', (v_now at time zone 'Asia/Hong_Kong')::date, now(), jsonb_build_object('coupons', v_coupons, 'points', v_points))
    on conflict (job, run_on) do update set finished_at = excluded.finished_at, result = excluded.result;
    return jsonb_build_object('ok', true, 'coupons', v_coupons, 'points', v_points);
end;
$$;

revoke all on function public.loyalty_sms_queue(text, uuid, text, text, uuid, text, bigint[], uuid[]) from public, anon, authenticated;
revoke all on function public.loyalty_sms_settle() from public, anon, authenticated;
revoke all on function public.loyalty_run_daily_sms(date, boolean) from public, anon, authenticated;
revoke all on function public.loyalty_run_zero(timestamptz) from public, anon, authenticated;

-- ── schedule (pg_cron runs in UTC: HK = UTC+8) ─────────────────────────────────
do $$
begin
    if to_regprocedure('cron.schedule(text,text,text)') is not null then
        perform cron.schedule('loyalty-set-zero', '5 16 * * *', 'select public.loyalty_run_zero()');
        perform cron.schedule('loyalty-daily-sms', '0 2 * * *', 'select public.loyalty_run_daily_sms()');
        perform cron.schedule('loyalty-sms-settle', '*/5 * * * *', 'select public.loyalty_sms_settle()');
    else
        raise notice 'pg_cron is not on: turn it on in Database → Extensions, then run this file again.';
    end if;
end $$;

notify pgrst, 'reload schema';
