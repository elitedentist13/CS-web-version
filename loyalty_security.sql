-- Loyalty security: discount coupon writes go through these functions, which check the scheme rules
-- on the server (campaign on/off, clinic, wallet and hold limits, issue cap, budget, the coupon value
-- from the bill's real payments, the giver's own login for gifts and transfers).
-- After the functions are made, the desk can no longer write the coupon tables directly.
-- Also keeps program_settings to one row per setting.
--
-- Run once in the Supabase SQL editor after discount_coupons.sql, discount_coupon_referrals.sql,
-- discount_coupons_expiry_sms.sql and loyalty_yearend_sms.sql. Safe to re-run.
-- Until it runs, the desk keeps writing the tables directly (same results, no server checks).

-- ── program_settings: one row per setting key (and clinic) ─────────────────────
delete from public.program_settings p
 using public.program_settings q
 where p.setting_key = q.setting_key
   and coalesce(p.clinic_id::text, '') = coalesce(q.clinic_id::text, '')
   and p.id <> q.id
   and (coalesce(p.updated_at, 'epoch'::timestamptz) < coalesce(q.updated_at, 'epoch'::timestamptz)
        or (coalesce(p.updated_at, 'epoch'::timestamptz) = coalesce(q.updated_at, 'epoch'::timestamptz) and p.id::text < q.id::text));

create unique index if not exists program_settings_key_clinic_uniq
    on public.program_settings (setting_key, coalesce(clinic_id::text, ''));

-- ── helpers ────────────────────────────────────────────────────────────────────
create or replace function public.dc_hk_today()
returns date language sql stable as $$
    select (now() at time zone 'Asia/Hong_Kong')::date
$$;

create or replace function public.dc_setting_json(p_key text)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
    v text;
begin
    select setting_value into v from public.program_settings
     where setting_key = p_key and clinic_id is null
     order by updated_at desc nulls last limit 1;
    if v is null or btrim(v) = '' then return '{}'::jsonb; end if;
    return v::jsonb;
exception when others then
    return '{}'::jsonb;
end;
$$;

create or replace function public.dc_num(p jsonb, p_key text, p_default numeric default 0)
returns numeric language plpgsql immutable as $$
declare
    v jsonb := p -> p_key;
begin
    if v is null or jsonb_typeof(v) = 'null' then return p_default; end if;
    if jsonb_typeof(v) = 'number' then return (v #>> '{}')::numeric; end if;
    if jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then return btrim(v #>> '{}')::numeric; end if;
    return p_default;
end;
$$;

/** Campaign defaults (same as CAMPAIGN_DEFS in app-coupons.js) merged with the saved Configuration. */
create or replace function public.dc_campaign(p_scheme jsonb, p_key text)
returns jsonb language plpgsql stable as $$
declare
    defs jsonb := '{
      "cash":            {"trigger":"manual","scope":"bill","mode":"amount","face":100,"expiryDays":90,"holdLimit":5},
      "spend_1":         {"trigger":"target_spend","scope":"bill","mode":"amount","face":100,"target":1000,"expiryDays":180,"holdLimit":3},
      "spend_2":         {"trigger":"target_spend","scope":"bill","mode":"amount","face":500,"target":5000,"expiryDays":180,"holdLimit":3},
      "spend_3":         {"trigger":"target_spend","scope":"bill","mode":"amount","face":1000,"target":10000,"expiryDays":180,"holdLimit":3},
      "spend_4":         {"trigger":"target_spend","scope":"bill","mode":"amount","face":0,"target":0,"expiryDays":180,"holdLimit":3},
      "spend_5":         {"trigger":"target_spend","scope":"bill","mode":"amount","face":0,"target":0,"expiryDays":180,"holdLimit":3},
      "new_chart":       {"trigger":"new_chart","scope":"bill","mode":"amount","face":100,"expiryDays":90,"holdLimit":1},
      "referral":        {"trigger":"referral","scope":"bill","mode":"amount","face":100,"expiryDays":180,"holdLimit":5,"minFirstSpend":500,"refPercent":10,"refMax":1000,"refStep":10},
      "free_scaling":    {"trigger":"manual","scope":"items","mode":"free_line","face":0,"expiryDays":180,"holdLimit":2},
      "free_filling":    {"trigger":"manual","scope":"items","mode":"free_line","face":0,"expiryDays":180,"holdLimit":2},
      "free_extraction": {"trigger":"manual","scope":"items","mode":"free_line","face":0,"expiryDays":180,"holdLimit":2},
      "implant":         {"trigger":"manual","scope":"items","mode":"amount","face":1000,"maxDiscount":1000,"expiryDays":180,"holdLimit":2},
      "ortho":           {"trigger":"manual","scope":"items","mode":"percent","face":0,"percent":10,"maxDiscount":3000,"expiryDays":180,"holdLimit":2},
      "crown_bridge":    {"trigger":"manual","scope":"items","mode":"amount","face":500,"maxDiscount":500,"expiryDays":180,"holdLimit":2},
      "root_canal":      {"trigger":"manual","scope":"items","mode":"amount","face":500,"maxDiscount":500,"expiryDays":180,"holdLimit":2},
      "whitening":       {"trigger":"manual","scope":"items","mode":"amount","face":200,"maxDiscount":200,"expiryDays":90,"holdLimit":2}
    }'::jsonb;
    v_def jsonb := defs -> p_key;
    v_saved jsonb;
begin
    if v_def is null then return null; end if;
    select e into v_saved from jsonb_array_elements(coalesce(p_scheme -> 'campaigns', '[]'::jsonb)) e
     where e ->> 'key' = p_key limit 1;
    if v_saved is null and p_key = 'spend_1' then
        select e into v_saved from jsonb_array_elements(coalesce(p_scheme -> 'campaigns', '[]'::jsonb)) e
         where e ->> 'key' = 'target_spend' limit 1;
    end if;
    return jsonb_build_object('key', p_key, 'enabled', false)
        || v_def
        || (jsonb_strip_nulls(coalesce(v_saved, '{}'::jsonb)) - 'key' - 'trigger' - 'scope');
end;
$$;

/** Reward points, balance transfer: not money paid (same as isNonCashMethod in app-coupons.js). */
create or replace function public.dc_is_noncash(p_method text)
returns boolean language sql immutable as $$
    select s like '%balance transfer%' or s in ('余额转移', '餘額轉移')
        or (s like '%reward%' and s like '%point%') or s in ('積分', '积分', '獎勵積分', '奖励积分')
      from (select regexp_replace(lower(btrim(coalesce(p_method, ''))), '[_-]+', ' ', 'g') as s) x
$$;

/** Government / PDCC (same as isLoyaltyExcludedPayMethod in app-rewards.js). */
create or replace function public.dc_is_excluded_method(p_method text)
returns boolean language sql immutable as $$
    select s = 'gov' or s = '政府' or s ~ '(^|[^a-z])gover[nm]*ment' or s ~ '(^|[^a-z])pdcc([^a-z]|$)'
      from (select lower(btrim(coalesce(p_method, ''))) as s) x
$$;

create or replace function public.dc_bill_cash(p_bill_id uuid)
returns numeric language sql stable security definer set search_path = public as $$
    select coalesce(sum(amount), 0)::numeric(14, 2) from public.bill_payments
     where bill_id = p_bill_id and voided_at is null and not public.dc_is_noncash(method)
$$;

create or replace function public.dc_bill_excluded(p_bill_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
    select exists (select 1 from public.bill_payments
                    where bill_id = p_bill_id and voided_at is null and public.dc_is_excluded_method(method))
$$;

/** The date a coupon really ends: with Set zero on year end, no later than 31 Dec of its HK issue year. */
create or replace function public.dc_eff_expiry(p_expires date, p_issued timestamptz, p_policy text)
returns date language sql immutable as $$
    select case when p_policy = 'year_end'
        then least(coalesce(p_expires, make_date(extract(year from (coalesce(p_issued, now()) at time zone 'Asia/Hong_Kong'))::int, 12, 31)),
                   make_date(extract(year from (coalesce(p_issued, now()) at time zone 'Asia/Hong_Kong'))::int, 12, 31))
        else p_expires end
$$;

create or replace function public.dc_live_count(p_patient_id uuid, p_campaign_key text default null)
returns int language sql stable security definer set search_path = public as $$
    select count(*)::int from public.discount_coupons c
     where c.patient_id = p_patient_id and c.status = 'unused'
       and (p_campaign_key is null or c.campaign_key = p_campaign_key)
       and coalesce(public.dc_eff_expiry(c.expires_on, c.issued_at, public.dc_setting_json('coupon_zero_policy') ->> 'zero_policy'),
                    '9999-12-31'::date) >= public.dc_hk_today()
$$;

/** The giver's own login (not the shared Nurse desk login). Returns the app_users row or null. */
create or replace function public.dc_check_staff(p_user text, p_password text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
    v jsonb;
begin
    if coalesce(btrim(p_user), '') = '' or coalesce(p_password, '') = '' or lower(btrim(p_user)) = 'nurse' then
        return null;
    end if;
    select jsonb_build_object('user_id', user_id, 'role', role, 'display_name', display_name) into v
      from public.app_users
     where user_id = btrim(p_user) and password = p_password and is_active = true
     limit 1;
    return v;
end;
$$;

-- ── issue a coupon ─────────────────────────────────────────────────────────────
-- p_kind: 'spend' (bill fully paid by cash, at least the target), 'new_chart' (new chart, once),
-- 'referral' (pending referral claimed on the friend's bill; value from the bill's cash),
-- 'gift' (staff gift: own login + password; cash HK$1–200, other coupons at their set value).
create or replace function public.dc_issue_coupon(
    p_kind text,
    p_patient_id uuid,
    p_campaign_key text,
    p_clinic_code text default null,
    p_bill_id uuid default null,
    p_referral_id uuid default null,
    p_amount numeric default null,
    p_user text default null,
    p_password text default null,
    p_issued_by text default null,
    p_note text default null,
    p_item_names jsonb default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    v_scheme jsonb := public.dc_setting_json('discount_coupon_scheme');
    v_c jsonb := public.dc_campaign(v_scheme, p_campaign_key);
    v_kind text := lower(btrim(coalesce(p_kind, '')));
    v_code_clinic text := upper(btrim(coalesce(p_clinic_code, '')));
    v_trigger text;
    v_face numeric(12, 2);
    v_mode text;
    v_hold int;
    v_cap numeric;
    v_budget numeric;
    v_used numeric;
    v_bill record;
    v_cash numeric;
    v_ref record;
    v_staff jsonb;
    v_pct numeric;
    v_max numeric;
    v_step numeric;
    v_min numeric;
    v_code text;
    v_row public.discount_coupons;
    v_issued_by text := nullif(btrim(coalesce(p_issued_by, '')), '');
    v_try int := 0;
begin
    if v_c is null then return jsonb_build_object('ok', false, 'reason', 'campaign'); end if;
    v_trigger := v_c ->> 'trigger';
    v_mode := coalesce(v_c ->> 'mode', 'amount');
    if (v_kind = 'spend' and v_trigger <> 'target_spend') or (v_kind = 'referral' and v_trigger <> 'referral')
       or (v_kind = 'new_chart' and v_trigger <> 'new_chart') or (v_kind = 'gift' and v_trigger <> 'manual')
       or v_kind not in ('spend', 'referral', 'new_chart', 'gift') then
        return jsonb_build_object('ok', false, 'reason', 'automatic');
    end if;
    if not coalesce((v_c ->> 'enabled')::boolean, false) then
        return jsonb_build_object('ok', false, 'reason', 'campaign_off');
    end if;
    if not exists (select 1 from public.patients where id = p_patient_id) then
        return jsonb_build_object('ok', false, 'reason', 'patient');
    end if;
    -- A clinic not in the saved list follows the default: only KT has joined.
    if v_code_clinic <> '' and not (case when (v_scheme -> 'clinics' -> v_code_clinic) is not null
            then coalesce((v_scheme -> 'clinics' -> v_code_clinic ->> 'joined')::boolean, false)
            else v_code_clinic = 'KT' end) then
        return jsonb_build_object('ok', false, 'reason', 'clinic');
    end if;

    if public.dc_live_count(p_patient_id) >= 20 then
        return jsonb_build_object('ok', false, 'reason', 'wallet_full');
    end if;
    v_hold := least(greatest(coalesce(public.dc_num(v_c, 'holdLimit', 1), 1), 1), 20)::int;
    if public.dc_live_count(p_patient_id, p_campaign_key) >= v_hold then
        return jsonb_build_object('ok', false, 'reason', 'already_holding');
    end if;
    v_cap := public.dc_num(v_c, 'issueCap', 0);
    if v_cap > 0 and (select count(*) from public.discount_coupons where campaign_key = p_campaign_key and status <> 'void') >= v_cap then
        return jsonb_build_object('ok', false, 'reason', 'issue_cap');
    end if;

    v_face := round(public.dc_num(v_c, 'face', 0), 2);

    if v_kind = 'spend' then
        select id, patient_id, balance, voided_at into v_bill from public.bills where id = p_bill_id;
        if not found or v_bill.patient_id is distinct from p_patient_id or v_bill.voided_at is not null then
            return jsonb_build_object('ok', false, 'reason', 'bill');
        end if;
        if public.dc_bill_excluded(p_bill_id) then return jsonb_build_object('ok', false, 'reason', 'excluded_method'); end if;
        if coalesce(v_bill.balance, 0) > 0.005 then return jsonb_build_object('ok', false, 'reason', 'not_paid'); end if;
        v_cash := public.dc_bill_cash(p_bill_id);
        if public.dc_num(v_c, 'target', 0) <= 0 or v_face <= 0 or v_cash + 0.005 < public.dc_num(v_c, 'target', 0) then
            return jsonb_build_object('ok', false, 'reason', 'below_target');
        end if;
        if exists (select 1 from public.discount_coupons where origin_bill_id = p_bill_id and campaign_key = p_campaign_key and status <> 'void') then
            return jsonb_build_object('ok', false, 'reason', 'already');
        end if;
    elsif v_kind = 'new_chart' then
        if exists (select 1 from public.discount_coupons where patient_id = p_patient_id and campaign_key = p_campaign_key and status <> 'void') then
            return jsonb_build_object('ok', false, 'reason', 'already');
        end if;
        if exists (select 1 from public.patients where id = p_patient_id and created_at < now() - interval '7 days') then
            return jsonb_build_object('ok', false, 'reason', 'not_new');
        end if;
    elsif v_kind = 'referral' then
        select * into v_ref from public.discount_coupon_referrals where id = p_referral_id;
        if not found or v_ref.status <> 'issuing' or v_ref.reward_kind <> 'coupon' or v_ref.coupon_id is not null
           or v_ref.referrer_patient_id <> p_patient_id or v_ref.trigger_bill_id is distinct from p_bill_id then
            return jsonb_build_object('ok', false, 'reason', 'not_pending');
        end if;
        select id, patient_id, balance, voided_at into v_bill from public.bills where id = p_bill_id;
        if not found or v_bill.patient_id is distinct from v_ref.referred_patient_id or v_bill.voided_at is not null then
            return jsonb_build_object('ok', false, 'reason', 'bill');
        end if;
        if public.dc_bill_excluded(p_bill_id) then return jsonb_build_object('ok', false, 'reason', 'excluded_method'); end if;
        v_cash := public.dc_bill_cash(p_bill_id);
        v_min := public.dc_num(v_c, 'minFirstSpend', 0);
        if v_min > 0 and v_cash + 0.005 < v_min then return jsonb_build_object('ok', false, 'reason', 'below_min'); end if;
        v_pct := public.dc_num(v_c, 'refPercent', 0);
        if v_pct > 0 then
            if coalesce(v_bill.balance, 0) > 0.005 then return jsonb_build_object('ok', false, 'reason', 'wait_full'); end if;
            v_face := v_cash * v_pct / 100;
            v_max := public.dc_num(v_c, 'refMax', 0);
            if v_max > 0 then v_face := least(v_face, v_max); end if;
            v_step := public.dc_num(v_c, 'refStep', 0);
            v_face := case when v_step > 0 then floor((v_face + 0.000000001) / v_step) * v_step else floor(v_face * 100 + 0.000001) / 100 end;
        end if;
        if v_face <= 0 then return jsonb_build_object('ok', false, 'reason', 'below_min'); end if;
    elsif v_kind = 'gift' then
        v_staff := public.dc_check_staff(p_user, p_password);
        if v_staff is null then return jsonb_build_object('ok', false, 'reason', 'creds'); end if;
        if lower(coalesce(v_staff ->> 'role', '')) not in ('doctor', 'dentist', 'nurse', 'receptionist', 'reception', 'staff', 'admin') then
            return jsonb_build_object('ok', false, 'reason', 'role');
        end if;
        if p_campaign_key = 'cash' then
            v_face := round(coalesce(p_amount, 0), 2);
            if v_face < 1 or v_face > 200 then return jsonb_build_object('ok', false, 'reason', 'amount'); end if;
        end if;
        v_issued_by := coalesce(nullif(v_staff ->> 'display_name', ''), v_staff ->> 'user_id');
    end if;

    v_budget := public.dc_num(v_c, 'budget', 0);
    if v_budget > 0 then
        select coalesce(sum(face_value), 0) into v_used from public.discount_coupons
         where campaign_key = p_campaign_key and status <> 'void' and discount_mode not in ('percent', 'free_line');
        if v_used + (case when v_mode in ('percent', 'free_line') then 0 else v_face end) > v_budget + 0.001 then
            return jsonb_build_object('ok', false, 'reason', 'budget');
        end if;
    end if;

    loop
        v_try := v_try + 1;
        v_code := 'DC-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
        exit when not exists (select 1 from public.discount_coupons where code = v_code) or v_try > 5;
    end loop;

    insert into public.discount_coupons (code, campaign_key, patient_id, face_value, discount_mode, percent, min_spend,
        max_discount, status, expires_on, issued_by, clinic_code, origin_bill_id, item_names, note)
    values (v_code, p_campaign_key, p_patient_id, v_face, v_mode, round(public.dc_num(v_c, 'percent', 0), 2),
        round(public.dc_num(v_c, 'minSpend', 0), 2), round(public.dc_num(v_c, 'maxDiscount', 0), 2), 'unused',
        public.dc_hk_today() + greatest(public.dc_num(v_c, 'expiryDays', 90), 1)::int,
        v_issued_by, nullif(v_code_clinic, ''), case when v_kind in ('spend', 'referral') then p_bill_id end,
        case when v_c ->> 'scope' = 'items' then coalesce(v_c -> 'itemNames', p_item_names) end,
        nullif(btrim(coalesce(p_note, '')), ''))
    returning * into v_row;

    if v_kind = 'referral' then
        update public.discount_coupon_referrals
           set status = 'issued', coupon_id = v_row.id, reason = null, issued_at = now(), updated_at = now()
         where id = p_referral_id;
    end if;

    return jsonb_build_object('ok', true, 'id', v_row.id, 'code', v_row.code, 'row', to_jsonb(v_row));
end;
$$;

-- ── coupons on a bill ──────────────────────────────────────────────────────────
-- Set the coupons used on a bill to exactly p_items ([{id, amount, line_name}]). Coupons no longer on the
-- list go back to the wallet. A fully paid bill cannot change its coupons (void the bill instead).
create or replace function public.dc_bill_set_coupons(p_bill_id uuid, p_items jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    v_bill record;
    v_items jsonb := coalesce(p_items, '[]'::jsonb);
    v_ids uuid[];
    v_it jsonb;
    v_c public.discount_coupons;
    v_amt numeric;
    v_sum numeric := 0;
    v_policy text := public.dc_setting_json('coupon_zero_policy') ->> 'zero_policy';
    v_today date := public.dc_hk_today();
begin
    select * into v_bill from public.bills where id = p_bill_id;
    if not found or v_bill.voided_at is not null then return jsonb_build_object('ok', false, 'reason', 'bill'); end if;
    select coalesce(array_agg((e ->> 'id')::uuid), '{}') into v_ids from jsonb_array_elements(v_items) e;
    if coalesce(v_bill.amount_paid, 0) > 0.005 and coalesce(v_bill.balance, 0) <= 0.005
       and exists (select 1 from public.discount_coupons where bill_id = p_bill_id and status = 'used' and not (id = any (v_ids))) then
        return jsonb_build_object('ok', false, 'reason', 'bill_paid');
    end if;
    if jsonb_array_length(v_items) > 0 and public.dc_bill_excluded(p_bill_id) then
        return jsonb_build_object('ok', false, 'reason', 'excluded_method');
    end if;
    for v_it in select * from jsonb_array_elements(v_items) loop
        select * into v_c from public.discount_coupons where id = (v_it ->> 'id')::uuid for update;
        if not found or v_c.patient_id is distinct from v_bill.patient_id then
            return jsonb_build_object('ok', false, 'reason', 'not_in_wallet', 'id', v_it ->> 'id');
        end if;
        if not ((v_c.status = 'unused' and coalesce(public.dc_eff_expiry(v_c.expires_on, v_c.issued_at, v_policy), '9999-12-31'::date) >= v_today)
                or (v_c.status = 'used' and v_c.bill_id = p_bill_id)) then
            return jsonb_build_object('ok', false, 'reason', case when v_c.status = 'unused' then 'expired' else 'used' end, 'id', v_c.id);
        end if;
        v_amt := round(coalesce(public.dc_num(v_it, 'amount', 0), 0), 2);
        if v_amt < 0 or (v_c.discount_mode = 'amount' and v_amt > v_c.face_value + 0.005)
           or (v_c.discount_mode = 'percent' and v_c.max_discount > 0 and v_amt > v_c.max_discount + 0.005) then
            return jsonb_build_object('ok', false, 'reason', 'amount', 'id', v_c.id);
        end if;
        v_sum := v_sum + v_amt;
    end loop;
    if v_sum > coalesce(v_bill.subtotal, 0) - coalesce(v_bill.discount, 0) + 0.005 then
        return jsonb_build_object('ok', false, 'reason', 'amount');
    end if;

    update public.discount_coupons
       set status = 'unused', bill_id = null, redeemed_amount = null, redeemed_at = null, line_name = null
     where bill_id = p_bill_id and status = 'used' and not (id = any (v_ids));
    for v_it in select * from jsonb_array_elements(v_items) loop
        update public.discount_coupons
           set status = 'used', bill_id = p_bill_id, redeemed_amount = round(public.dc_num(v_it, 'amount', 0), 2),
               redeemed_at = now(), line_name = nullif(v_it ->> 'line_name', '')
         where id = (v_it ->> 'id')::uuid;
    end loop;
    return jsonb_build_object('ok', true, 'count', jsonb_array_length(v_items), 'amount', v_sum);
end;
$$;

-- Give used coupons back to the wallet: only on a voided bill or a bill with nothing paid yet.
create or replace function public.dc_bill_release(p_bill_id uuid, p_coupon_ids uuid[] default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    v_bill record;
    v_n int;
begin
    select * into v_bill from public.bills where id = p_bill_id;
    if not found then return jsonb_build_object('ok', false, 'reason', 'bill'); end if;
    if v_bill.voided_at is null and coalesce(v_bill.amount_paid, 0) > 0.005 then
        return jsonb_build_object('ok', false, 'reason', 'bill_paid');
    end if;
    update public.discount_coupons
       set status = 'unused', bill_id = null, redeemed_amount = null, redeemed_at = null, line_name = null
     where status = 'used'
       and ((bill_id = p_bill_id and (p_coupon_ids is null or id = any (p_coupon_ids)))
            or (bill_id is null and (id = v_bill.coupon_id or id = any (coalesce(p_coupon_ids, '{}')))));
    get diagnostics v_n = row_count;
    return jsonb_build_object('ok', true, 'count', v_n);
end;
$$;

-- Take back unused coupons a bill earned: only when that bill is voided or no longer fully paid.
create or replace function public.dc_void_earned(p_bill_id uuid, p_coupon_ids uuid[] default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    v_bill record;
    v_n int;
begin
    select * into v_bill from public.bills where id = p_bill_id;
    if not found then return jsonb_build_object('ok', false, 'reason', 'bill'); end if;
    if v_bill.voided_at is null and coalesce(v_bill.balance, 0) <= 0.005 then
        return jsonb_build_object('ok', false, 'reason', 'still_paid');
    end if;
    update public.discount_coupons
       set status = 'void', note = coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Voided with bill')
     where origin_bill_id = p_bill_id and status = 'unused'
       and (p_coupon_ids is null or id = any (p_coupon_ids));
    get diagnostics v_n = row_count;
    return jsonb_build_object('ok', true, 'count', v_n);
end;
$$;

-- Move an unused coupon to another chart: the giver's own login + password; new-chart and referral coupons stay.
create or replace function public.dc_transfer_coupon(
    p_coupon_id uuid, p_to_patient_id uuid, p_user text, p_password text, p_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    v_staff jsonb := public.dc_check_staff(p_user, p_password);
    v_c public.discount_coupons;
    v_camp jsonb;
    v_hold int;
    v_policy text := public.dc_setting_json('coupon_zero_policy') ->> 'zero_policy';
begin
    if v_staff is null then return jsonb_build_object('ok', false, 'reason', 'creds'); end if;
    select * into v_c from public.discount_coupons where id = p_coupon_id for update;
    if not found or v_c.status <> 'unused' then return jsonb_build_object('ok', false, 'reason', 'not_unused'); end if;
    if coalesce(public.dc_eff_expiry(v_c.expires_on, v_c.issued_at, v_policy), '9999-12-31'::date) < public.dc_hk_today() then
        return jsonb_build_object('ok', false, 'reason', 'expired');
    end if;
    if v_c.campaign_key in ('new_chart', 'referral') then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
    if p_to_patient_id is null or p_to_patient_id = v_c.patient_id
       or not exists (select 1 from public.patients where id = p_to_patient_id) then
        return jsonb_build_object('ok', false, 'reason', 'same_patient');
    end if;
    if public.dc_live_count(p_to_patient_id) >= 20 then return jsonb_build_object('ok', false, 'reason', 'wallet_full'); end if;
    v_camp := public.dc_campaign(public.dc_setting_json('discount_coupon_scheme'), v_c.campaign_key);
    v_hold := least(greatest(coalesce(public.dc_num(coalesce(v_camp, '{}'::jsonb), 'holdLimit', 1), 1), 1), 20)::int;
    if public.dc_live_count(p_to_patient_id, v_c.campaign_key) >= v_hold then
        return jsonb_build_object('ok', false, 'reason', 'already_holding');
    end if;
    update public.discount_coupons
       set patient_id = p_to_patient_id, note = nullif(btrim(coalesce(p_note, '')), '')
     where id = p_coupon_id;
    return jsonb_build_object('ok', true, 'id', p_coupon_id, 'by', v_staff ->> 'user_id');
end;
$$;

-- Expiry reminder claim: one station texts each coupon once per reminder window.
create or replace function public.dc_expiry_sms_claim(p_coupon_id uuid, p_column text, p_claim boolean default true)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
    v_n int;
begin
    if p_column = 'expiry_sms_at' then
        if p_claim then
            update public.discount_coupons set expiry_sms_at = now() where id = p_coupon_id and expiry_sms_at is null and status = 'unused';
        else
            update public.discount_coupons set expiry_sms_at = null where id = p_coupon_id and expiry_sms_at > now() - interval '1 hour';
        end if;
    elsif p_column = 'expiry_sms_month_at' then
        if p_claim then
            update public.discount_coupons set expiry_sms_month_at = now() where id = p_coupon_id and expiry_sms_month_at is null and status = 'unused';
        else
            update public.discount_coupons set expiry_sms_month_at = null where id = p_coupon_id and expiry_sms_month_at > now() - interval '1 hour';
        end if;
    else
        return false;
    end if;
    get diagnostics v_n = row_count;
    return v_n > 0;
end;
$$;

-- ── referral records ───────────────────────────────────────────────────────────
create or replace function public.dc_referral_register(
    p_referred_id uuid, p_referrer_id uuid, p_referred_no text, p_referrer_no text,
    p_kind text, p_status text, p_reason text default null, p_clinic_code text default null, p_created_by text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    v_id uuid;
begin
    if p_referred_id is null or p_referrer_id is null or p_referred_id = p_referrer_id
       or not exists (select 1 from public.patients where id = p_referred_id)
       or not exists (select 1 from public.patients where id = p_referrer_id) then
        return jsonb_build_object('ok', false, 'reason', 'patient');
    end if;
    if coalesce(p_status, '') not in ('pending', 'blocked') or coalesce(p_kind, '') not in ('coupon', 'points') then
        return jsonb_build_object('ok', false, 'reason', 'status');
    end if;
    insert into public.discount_coupon_referrals (referred_patient_id, referrer_patient_id, referred_no, referrer_no,
        reward_kind, status, reason, clinic_code, created_by)
    values (p_referred_id, p_referrer_id, p_referred_no, p_referrer_no, p_kind, p_status, p_reason, p_clinic_code, p_created_by)
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'already');
end;
$$;

-- p_action: 'note' (reason on a pending record), 'claim' (pending → issuing on the friend's bill),
-- 'retry' (issuing → pending, the reward could not be saved), 'points' (issuing → issued with the points ledger row),
-- 'reopen' (issued / issuing → pending: the bill was voided or is no longer paid, or its coupon was cancelled),
-- 'points_spent' (note only), 'void' (a chart of the pair was deleted).
create or replace function public.dc_referral_set(
    p_id uuid, p_action text, p_bill_id uuid default null, p_reason text default null,
    p_ledger_id uuid default null, p_points numeric default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
    v_r public.discount_coupon_referrals;
    v_bill record;
begin
    select * into v_r from public.discount_coupon_referrals where id = p_id for update;
    if not found then return jsonb_build_object('ok', false, 'reason', 'record'); end if;

    if p_action = 'note' then
        if v_r.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'not_pending'); end if;
        update public.discount_coupon_referrals set reason = left(p_reason, 60), updated_at = now() where id = p_id;
    elsif p_action = 'claim' then
        if v_r.status <> 'pending' then return jsonb_build_object('ok', false, 'reason', 'taken'); end if;
        select id, patient_id, voided_at into v_bill from public.bills where id = p_bill_id;
        if not found or v_bill.patient_id is distinct from v_r.referred_patient_id or v_bill.voided_at is not null then
            return jsonb_build_object('ok', false, 'reason', 'bill');
        end if;
        update public.discount_coupon_referrals set status = 'issuing', trigger_bill_id = p_bill_id, updated_at = now() where id = p_id;
    elsif p_action = 'retry' then
        if v_r.status <> 'issuing' then return jsonb_build_object('ok', false, 'reason', 'not_issuing'); end if;
        update public.discount_coupon_referrals
           set status = 'pending', trigger_bill_id = null, reason = coalesce(nullif(left(p_reason, 60), ''), 'insert_failed'), updated_at = now()
         where id = p_id;
    elsif p_action = 'points' then
        if v_r.status <> 'issuing' or v_r.reward_kind <> 'points' then return jsonb_build_object('ok', false, 'reason', 'not_issuing'); end if;
        if p_ledger_id is not null and not exists (select 1 from public.reward_ledger where id = p_ledger_id and patient_id = v_r.referrer_patient_id) then
            return jsonb_build_object('ok', false, 'reason', 'ledger');
        end if;
        update public.discount_coupon_referrals
           set status = 'issued', ledger_id = p_ledger_id, points = round(coalesce(p_points, 0), 2), reason = null, issued_at = now(), updated_at = now()
         where id = p_id;
    elsif p_action = 'reopen' then
        if v_r.status not in ('issued', 'issuing') then return jsonb_build_object('ok', false, 'reason', 'not_issued'); end if;
        select id, balance, voided_at into v_bill from public.bills where id = v_r.trigger_bill_id;
        if found and v_bill.voided_at is null and coalesce(v_bill.balance, 0) <= 0.005
           and not (v_r.coupon_id is not null and exists (select 1 from public.discount_coupons where id = v_r.coupon_id and status = 'void'))
           and v_r.status = 'issued' then
            return jsonb_build_object('ok', false, 'reason', 'still_paid');
        end if;
        update public.discount_coupon_referrals
           set status = 'pending', coupon_id = null, ledger_id = null, trigger_bill_id = null, issued_at = null,
               reason = coalesce(nullif(left(p_reason, 60), ''), 'bill_voided'), updated_at = now()
         where id = p_id;
    elsif p_action = 'points_spent' then
        update public.discount_coupon_referrals set reason = 'points_spent', updated_at = now() where id = p_id;
    elsif p_action = 'void' then
        if exists (select 1 from public.patients where id = v_r.referred_patient_id)
           and exists (select 1 from public.patients where id = v_r.referrer_patient_id) then
            return jsonb_build_object('ok', false, 'reason', 'charts_exist');
        end if;
        if not exists (select 1 from public.patients where id = v_r.referred_patient_id) and v_r.coupon_id is not null then
            update public.discount_coupons set status = 'void', note = 'Referred chart deleted'
             where id = v_r.coupon_id and status = 'unused';
        end if;
        update public.discount_coupon_referrals set status = 'void', reason = 'chart_deleted', updated_at = now() where id = p_id;
    else
        return jsonb_build_object('ok', false, 'reason', 'action');
    end if;
    return jsonb_build_object('ok', true);
end;
$$;

-- ── year-end reminder claims (coupons and reward points) ───────────────────────
create or replace function public.loyalty_yearend_claim(
    p_scheme text, p_year int, p_stage text, p_person_keys text[], p_patient_id uuid default null
)
returns bigint[]
language plpgsql security definer set search_path = public
as $$
declare
    v_ids bigint[];
begin
    if p_scheme not in ('coupons', 'rewards') or p_stage not in ('month', 'week') or coalesce(cardinality(p_person_keys), 0) = 0 then
        return null;
    end if;
    with ins as (
        insert into public.loyalty_yearend_sms (scheme, year, stage, person_key, patient_id)
        select p_scheme, p_year, p_stage, k, p_patient_id from unnest(p_person_keys) k
        returning id
    ) select array_agg(id) into v_ids from ins;
    return v_ids;
exception when unique_violation then
    return null;
end;
$$;

-- 'sent' / 'no_phone' keep the claim; 'release' gives it back so the next run retries.
create or replace function public.loyalty_yearend_finish(p_ids bigint[], p_status text, p_phone text default null)
returns int
language plpgsql security definer set search_path = public
as $$
declare
    v_n int;
begin
    if p_status in ('sent', 'no_phone') then
        update public.loyalty_yearend_sms set status = p_status, to_phone = p_phone, sent_at = now()
         where id = any (p_ids) and status = 'claimed';
    elsif p_status = 'release' then
        delete from public.loyalty_yearend_sms where id = any (p_ids) and status = 'claimed';
    else
        return 0;
    end if;
    get diagnostics v_n = row_count;
    return v_n;
end;
$$;

-- ── who may call what ──────────────────────────────────────────────────────────
revoke all on function public.dc_setting_json(text) from public;
revoke all on function public.dc_check_staff(text, text) from public, anon, authenticated;

grant execute on function public.dc_issue_coupon(text, uuid, text, text, uuid, uuid, numeric, text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.dc_bill_set_coupons(uuid, jsonb) to anon, authenticated;
grant execute on function public.dc_bill_release(uuid, uuid[]) to anon, authenticated;
grant execute on function public.dc_void_earned(uuid, uuid[], text) to anon, authenticated;
grant execute on function public.dc_transfer_coupon(uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.dc_expiry_sms_claim(uuid, text, boolean) to anon, authenticated;
grant execute on function public.dc_referral_register(uuid, uuid, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.dc_referral_set(uuid, text, uuid, text, uuid, numeric) to anon, authenticated;
grant execute on function public.loyalty_yearend_claim(text, int, text, text[], uuid) to anon, authenticated;
grant execute on function public.loyalty_yearend_finish(bigint[], text, text) to anon, authenticated;

-- The desk reads the tables directly but writes only through the functions above.
revoke insert, update, delete on public.discount_coupons from anon, authenticated;
revoke insert, update, delete on public.discount_coupon_referrals from anon, authenticated;
revoke insert, update, delete on public.loyalty_yearend_sms from anon, authenticated;
grant select on public.discount_coupons, public.discount_coupon_referrals, public.loyalty_yearend_sms to anon, authenticated;

notify pgrst, 'reload schema';
