-- Patch: staff gift reward points (kind 'gift'). Safe to re-run.
-- Run in Supabase SQL editor after reward_points.sql, reward_points_patch_chart_ledgers.sql
-- and reward_points_patch_ledger_doctor.sql.
--
-- Settings live in program_settings 'reward_gift_config' (Configuration → Reward Points → Gift points).
-- Defaults when never saved: on, 200 points per gift, 1 gift per patient per day, no per-staff daily cap,
-- own login + password required, reason required, every clinic staff role.
--
-- Rules enforced here (not only in the Banana UI):
--   * gift switched on
--   * the giver is an active app_users login with an allowed role; the shared Nurse login can never be the giver
--   * own password checked here when "require login" is on (default)
--   * 1 to max whole points per gift; reason required when that setting is on; treating doctor always required
--   * the clinic must have joined Gain
--   * gifts per patient per Hong Kong day (also across the same person's other charts)
--   * optional most points one staff login can gift per Hong Kong day
-- Every gift is a reward_ledger row (kind 'gift', created_by = giver, actor_user_id = login) plus an audit_trail row.
-- Gifts do not count as activity for the lifespan expiry, so gifted points expire with the rest.
-- Admin reverses a gift with the panel's Admin adjust (−).

-- ── Allow kind 'gift' on the ledger ───────────────────────────
do $$
declare
    v_kinds text[];
    v_list text;
begin
    select array_agg(distinct k order by k) into v_kinds
    from (
        select unnest(array[
            'earn', 'redeem', 'transfer_out', 'transfer_in',
            'adjust', 'void_earn', 'void_redeem', 'gift'
        ]) as k
        union
        select distinct kind from public.reward_ledger where kind is not null
    ) s;

    select string_agg(quote_literal(k), ', ') into v_list from unnest(v_kinds) as k;

    alter table public.reward_ledger drop constraint if exists reward_ledger_kind_check;
    execute 'alter table public.reward_ledger add constraint reward_ledger_kind_check check (kind in (' || v_list || '))';
end $$;

alter table public.reward_ledger
    add column if not exists actor_user_id text;

comment on column public.reward_ledger.actor_user_id is
    'Login (app_users.user_id) that made the change. Set on gifts.';

create index if not exists reward_ledger_gift_patient_idx
    on public.reward_ledger (patient_id, created_at desc)
    where kind = 'gift';

create index if not exists reward_ledger_gift_actor_idx
    on public.reward_ledger (actor_user_id, created_at desc)
    where kind = 'gift';

-- ── Settings (same defaults as the app) ───────────────────────
create or replace function public.reward_gift_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_raw jsonb;
    v_roles jsonb;
    v_max numeric;
    v_daily int;
    v_staff numeric;
begin
    begin
        select s.setting_value::jsonb into v_raw
          from public.program_settings s where s.setting_key = 'reward_gift_config'
         limit 1;
    exception when others then
        v_raw := null;
    end;
    v_raw := coalesce(v_raw, '{}'::jsonb);

    begin v_max := trunc((v_raw->>'maxPoints')::numeric); exception when others then v_max := null; end;
    if v_max is null or v_max < 1 then v_max := 200; end if;
    if v_max > 10000 then v_max := 10000; end if;

    begin v_daily := (v_raw->>'perPatientDaily')::int; exception when others then v_daily := null; end;
    if v_daily is null or v_daily < 0 then v_daily := 1; end if;

    begin v_staff := trunc((v_raw->>'staffDailyMax')::numeric); exception when others then v_staff := null; end;
    if v_staff is null or v_staff < 0 then v_staff := 0; end if;

    v_roles := v_raw->'roles';
    if v_roles is null or jsonb_typeof(v_roles) <> 'array' or jsonb_array_length(v_roles) = 0 then
        v_roles := '["doctor","dentist","nurse","receptionist","reception","staff","admin"]'::jsonb;
    end if;

    return jsonb_build_object(
        'enabled', coalesce((v_raw->>'enabled')::boolean, true),
        'maxPoints', v_max,
        'perPatientDaily', v_daily,
        'staffDailyMax', v_staff,
        'requireLogin', coalesce((v_raw->>'requireLogin')::boolean, true),
        'requireReason', coalesce((v_raw->>'requireReason')::boolean, true),
        'roles', v_roles
    );
exception when others then
    return jsonb_build_object('enabled', true, 'maxPoints', 200, 'perPatientDaily', 1, 'staffDailyMax', 0,
        'requireLogin', true, 'requireReason', true,
        'roles', '["doctor","dentist","nurse","receptionist","reception","staff","admin"]'::jsonb);
end;
$$;

grant execute on function public.reward_gift_settings() to anon, authenticated;

-- ── Gift ──────────────────────────────────────────────────────
create or replace function public.reward_gift(
    p_patient_id uuid,
    p_points numeric,
    p_user_id text,
    p_password text,
    p_note text,
    p_doctor_name text,
    p_clinic_id uuid default null,
    p_clinic_code text default null,
    p_related_patient_ids uuid[] default null,
    p_client_host text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cfg jsonb := public.reward_gift_settings();
    v_max numeric := (v_cfg->>'maxPoints')::numeric;
    v_daily int := (v_cfg->>'perPatientDaily')::int;
    v_staff_max numeric := (v_cfg->>'staffDailyMax')::numeric;
    v_need_login boolean := (v_cfg->>'requireLogin')::boolean;
    v_need_reason boolean := (v_cfg->>'requireReason')::boolean;
    v_uid text := trim(coalesce(p_user_id, ''));
    v_note text := trim(coalesce(p_note, ''));
    v_doctor text := left(trim(coalesce(p_doctor_name, '')), 200);
    v_code text := trim(coalesce(p_clinic_code, ''));
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_points numeric(12, 2);
    v_user record;
    v_giver text;
    v_ids uuid[];
    v_prev record;
    v_count int;
    v_staff_sum numeric;
    v_acc public.reward_accounts;
    v_new_bal numeric(12, 2);
    v_ledger public.reward_ledger;
    v_patient_no text;
    v_detail text;
    v_detail_type text;
    v_logged boolean := false;
begin
    if not coalesce((v_cfg->>'enabled')::boolean, true) then
        return jsonb_build_object('ok', false, 'reason', 'gift_off', 'error', 'gift points is switched off');
    end if;
    if p_patient_id is null then
        return jsonb_build_object('ok', false, 'reason', 'patient', 'error', 'patient_id required');
    end if;

    if v_uid = '' or (v_need_login and coalesce(p_password, '') = '') then
        return jsonb_build_object('ok', false, 'reason', 'auth_missing', 'error', 'login and password required');
    end if;
    if lower(v_uid) = 'nurse' then
        return jsonb_build_object('ok', false, 'reason', 'shared_login', 'error', 'shared login cannot gift');
    end if;

    if v_need_login then
        select user_id, role, display_name into v_user
        from public.app_users
        where user_id = v_uid
          and password = p_password
          and coalesce(is_active, false) = true
        limit 1;
    else
        select user_id, role, display_name into v_user
        from public.app_users
        where user_id = v_uid
          and coalesce(is_active, false) = true
        limit 1;
    end if;
    if not found or lower(trim(coalesce(v_user.user_id, ''))) = 'nurse' then
        return jsonb_build_object('ok', false, 'reason', 'creds', 'error', 'login or password incorrect');
    end if;
    if not exists (
        select 1 from jsonb_array_elements_text(v_cfg->'roles') r
        where lower(trim(r)) = lower(trim(coalesce(v_user.role, '')))
    ) then
        return jsonb_build_object('ok', false, 'reason', 'role', 'error', 'role cannot gift points');
    end if;
    v_giver := coalesce(nullif(trim(v_user.display_name), ''), v_user.user_id);

    v_points := public.reward_round2(p_points);
    if v_points is null or v_points <> trunc(v_points) or v_points < 1 or v_points > v_max then
        return jsonb_build_object('ok', false, 'reason', 'points',
            'error', 'points must be a whole number from 1 to ' || v_max::text, 'max', v_max);
    end if;

    if length(v_note) < 1 then
        if v_need_reason then
            return jsonb_build_object('ok', false, 'reason', 'note', 'error', 'reason required');
        end if;
        v_note := 'Gift';
    end if;
    v_note := left(v_note, 300);

    if v_doctor = '' then
        return jsonb_build_object('ok', false, 'reason', 'doctor', 'error', 'doctor required');
    end if;

    if not public.reward_clinic_gain_enabled(p_clinic_id, v_code) then
        return jsonb_build_object('ok', false, 'reason', 'clinic_gain_disabled', 'error', 'clinic has not joined Gain');
    end if;

    -- Serialise gifts for this chart and this giver so two desks cannot both pass the daily checks.
    perform pg_advisory_xact_lock(hashtext('reward_gift:' || p_patient_id::text));
    perform pg_advisory_xact_lock(hashtext('reward_gift_staff:' || lower(v_user.user_id)));

    select array_agg(distinct x) into v_ids
    from unnest(array[p_patient_id] || coalesce(p_related_patient_ids, array[]::uuid[])) as x
    where x is not null;

    if v_daily > 0 then
        select count(*) into v_count
        from public.reward_ledger l
        where l.kind = 'gift'
          and l.patient_id = any (v_ids)
          and (l.created_at at time zone 'Asia/Hong_Kong')::date = v_today;
        if v_count >= v_daily then
            select l.created_at, l.created_by, l.points into v_prev
            from public.reward_ledger l
            where l.kind = 'gift'
              and l.patient_id = any (v_ids)
              and (l.created_at at time zone 'Asia/Hong_Kong')::date = v_today
            order by l.created_at desc
            limit 1;
            return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'error', 'daily gift limit reached',
                'limit', v_daily, 'count', v_count,
                'last_at', v_prev.created_at, 'last_by', v_prev.created_by, 'last_points', v_prev.points);
        end if;
    end if;

    if v_staff_max > 0 then
        select coalesce(sum(l.points), 0) into v_staff_sum
        from public.reward_ledger l
        where l.kind = 'gift'
          and lower(coalesce(l.actor_user_id, '')) = lower(v_user.user_id)
          and (l.created_at at time zone 'Asia/Hong_Kong')::date = v_today;
        if v_staff_sum + v_points > v_staff_max then
            return jsonb_build_object('ok', false, 'reason', 'staff_daily', 'error', 'staff daily gift limit reached',
                'limit', v_staff_max, 'used', v_staff_sum, 'left', greatest(0, v_staff_max - v_staff_sum));
        end if;
    end if;

    v_acc := public.reward_ensure_account(p_patient_id);
    v_new_bal := public.reward_round2(v_acc.balance + v_points);

    update public.reward_accounts
    set balance = v_new_bal,
        lifetime_earned = public.reward_round2(lifetime_earned + v_points),
        started_at = coalesce(started_at, now()),
        updated_at = now()
    where id = v_acc.id
    returning * into v_acc;

    insert into public.reward_ledger (
        account_id, patient_id, kind, points, balance_after,
        clinic_id, clinic_code, doctor_name,
        note, created_by, actor_user_id, created_at
    ) values (
        v_acc.id, p_patient_id, 'gift', v_points, v_new_bal,
        p_clinic_id, v_code, v_doctor,
        v_note, v_giver, v_user.user_id, clock_timestamp()
    )
    returning * into v_ledger;

    -- Audit trail copy. Best effort: the ledger row above is the gift record.
    begin
        select patient_no into v_patient_no from public.patients where id = p_patient_id;
        v_detail := 'Gift ' || v_points::text || ' points · ' || v_doctor || ' · by ' || v_giver ||
            ' (' || v_user.user_id || ', ' || case when v_need_login then 'password checked' else 'screen login, no password' end ||
            ') · balance ' || v_new_bal::text || ' · ' || v_note;
        select data_type into v_detail_type
        from information_schema.columns
        where table_schema = 'public' and table_name = 'audit_trail' and column_name = 'changes_detail';
        execute format(
            'insert into public.audit_trail (clinic_tag, user_id, user_name, audit_item, table_name, operation, record_id, patient_no, changes_detail, client_host)
             values (%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)',
            nullif(v_code, ''), v_user.user_id, v_giver, 'REWARD GIFT', 'reward_ledger', 'GIFT',
            v_ledger.id::text, v_patient_no,
            case when v_detail_type in ('json', 'jsonb') then to_jsonb(v_detail)::text else v_detail end,
            nullif(trim(coalesce(p_client_host, '')), ''));
        v_logged := true;
    exception when others then
        v_logged := false;
    end;

    return jsonb_build_object(
        'ok', true,
        'skipped', false,
        'kind', 'gift',
        'points', v_points,
        'balance', v_new_bal,
        'ledger_id', v_ledger.id,
        'patient_id', p_patient_id,
        'doctor_name', v_doctor,
        'given_by', v_giver,
        'given_by_id', v_user.user_id,
        'login_checked', v_need_login,
        'audit_logged', v_logged
    );
end;
$$;

revoke all on function public.reward_gift(uuid, numeric, text, text, text, text, uuid, text, uuid[], text) from public;
grant execute on function public.reward_gift(uuid, numeric, text, text, text, text, uuid, text, uuid[], text) to anon, authenticated;

notify pgrst, 'reload schema';
