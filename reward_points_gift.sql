-- Patch: staff gift reward points (kind 'gift'). Safe to re-run.
-- Run in Supabase SQL editor after reward_points.sql, reward_points_patch_chart_ledgers.sql
-- and reward_points_patch_ledger_doctor.sql.
--
-- Rules enforced here (not only in the Banana UI):
--   * the giver types their own login + password; checked against app_users here
--   * the shared Nurse login cannot gift; role must be a clinic staff role
--   * 1 to 200 whole points per gift
--   * a reason is required
--   * a treating doctor is required (points are redeemable at that doctor only)
--   * the clinic must have joined Gain
--   * one gift per patient per Hong Kong day (also across the same person's other charts)
-- Every gift is a reward_ledger row (kind 'gift', created_by = giver) plus an audit_trail row.
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

create index if not exists reward_ledger_gift_patient_idx
    on public.reward_ledger (patient_id, created_at desc)
    where kind = 'gift';

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
    c_max constant numeric := 200;
    v_uid text := trim(coalesce(p_user_id, ''));
    v_note text := trim(coalesce(p_note, ''));
    v_doctor text := left(trim(coalesce(p_doctor_name, '')), 200);
    v_code text := trim(coalesce(p_clinic_code, ''));
    v_points numeric(12, 2);
    v_user record;
    v_giver text;
    v_ids uuid[];
    v_prev record;
    v_acc public.reward_accounts;
    v_new_bal numeric(12, 2);
    v_ledger public.reward_ledger;
    v_patient_no text;
    v_detail text;
    v_detail_type text;
    v_logged boolean := false;
begin
    if p_patient_id is null then
        return jsonb_build_object('ok', false, 'reason', 'patient', 'error', 'patient_id required');
    end if;

    if v_uid = '' or coalesce(p_password, '') = '' then
        return jsonb_build_object('ok', false, 'reason', 'auth_missing', 'error', 'login and password required');
    end if;
    if lower(v_uid) = 'nurse' then
        return jsonb_build_object('ok', false, 'reason', 'shared_login', 'error', 'shared login cannot gift');
    end if;

    select user_id, role, display_name into v_user
    from public.app_users
    where user_id = v_uid
      and password = p_password
      and coalesce(is_active, false) = true
    limit 1;
    if not found or lower(trim(coalesce(v_user.user_id, ''))) = 'nurse' then
        return jsonb_build_object('ok', false, 'reason', 'creds', 'error', 'login or password incorrect');
    end if;
    if lower(trim(coalesce(v_user.role, ''))) not in
        ('doctor', 'dentist', 'nurse', 'receptionist', 'reception', 'staff', 'admin') then
        return jsonb_build_object('ok', false, 'reason', 'role', 'error', 'role cannot gift points');
    end if;
    v_giver := coalesce(nullif(trim(v_user.display_name), ''), v_user.user_id);

    v_points := public.reward_round2(p_points);
    if v_points is null or v_points <> trunc(v_points) or v_points < 1 or v_points > c_max then
        return jsonb_build_object('ok', false, 'reason', 'points', 'error', 'points must be a whole number from 1 to 200',
            'max', c_max);
    end if;

    if length(v_note) < 1 then
        return jsonb_build_object('ok', false, 'reason', 'note', 'error', 'reason required');
    end if;
    v_note := left(v_note, 300);

    if v_doctor = '' then
        return jsonb_build_object('ok', false, 'reason', 'doctor', 'error', 'doctor required');
    end if;

    if not public.reward_clinic_gain_enabled(p_clinic_id, v_code) then
        return jsonb_build_object('ok', false, 'reason', 'clinic_gain_disabled', 'error', 'clinic has not joined Gain');
    end if;

    -- Serialise gifts for this chart so two desks cannot both pass the daily check.
    perform pg_advisory_xact_lock(hashtext('reward_gift:' || p_patient_id::text));

    select array_agg(distinct x) into v_ids
    from unnest(array[p_patient_id] || coalesce(p_related_patient_ids, array[]::uuid[])) as x
    where x is not null;

    select l.created_at, l.created_by, l.points into v_prev
    from public.reward_ledger l
    where l.kind = 'gift'
      and l.patient_id = any (v_ids)
      and (l.created_at at time zone 'Asia/Hong_Kong')::date = (now() at time zone 'Asia/Hong_Kong')::date
    order by l.created_at desc
    limit 1;
    if found then
        return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'error', 'already gifted today',
            'last_at', v_prev.created_at, 'last_by', v_prev.created_by, 'last_points', v_prev.points);
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
        note, created_by, created_at
    ) values (
        v_acc.id, p_patient_id, 'gift', v_points, v_new_bal,
        p_clinic_id, v_code, v_doctor,
        v_note, v_giver, clock_timestamp()
    )
    returning * into v_ledger;

    -- Audit trail copy. Best effort: the ledger row above is the gift record.
    begin
        select patient_no into v_patient_no from public.patients where id = p_patient_id;
        v_detail := 'Gift ' || v_points::text || ' points · ' || v_doctor || ' · by ' || v_giver ||
            ' (' || v_user.user_id || ') · balance ' || v_new_bal::text || ' · ' || v_note;
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
        'audit_logged', v_logged
    );
end;
$$;

revoke all on function public.reward_gift(uuid, numeric, text, text, text, text, uuid, text, uuid[], text) from public;
grant execute on function public.reward_gift(uuid, numeric, text, text, text, text, uuid, text, uuid[], text) to anon, authenticated;
