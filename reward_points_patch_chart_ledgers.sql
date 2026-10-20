-- Patch: chart-scoped multi-clinic reward ledgers
-- Run in Supabase SQL editor after reward_points.sql (+ prior patches).
--
-- Rules:
--   * One reward_accounts row per patient chart (patient_id / patient_no).
--   * New universal chart nos share one balance; legacy clinic-prefixed charts
--     (PL003826, TKO003826, …) each keep their own balance.
--   * Earn credits the bill's chart when the clinic has join_gain.
--   * Redeem / transfer may draw from multiple source charts of the same person;
--     allocation: smallest balance first, then remaining from largest.
--   * Destination transfer credits only the target patient's chart no.
--   * Reception may toggle join_gain / join_redeem per clinic.

-- Allow multiple redeem ledger rows per payment (one per source chart)
drop index if exists public.reward_ledger_redeem_payment_uidx;
create index if not exists reward_ledger_redeem_payment_idx
    on public.reward_ledger (bill_payment_id)
    where kind = 'redeem' and bill_payment_id is not null;

-- Still at most one earn per payment
-- (reward_ledger_earn_payment_uidx unchanged)

-- ════════════════════════════════════════════════════════════
-- CLINIC JOIN: separate gain / redeem flags
-- ════════════════════════════════════════════════════════════
alter table public.reward_program_clinics
    add column if not exists join_gain boolean,
    add column if not exists join_redeem boolean;

update public.reward_program_clinics
set join_gain = coalesce(join_gain, enabled, false),
    join_redeem = coalesce(join_redeem, enabled, false)
where join_gain is null or join_redeem is null;

alter table public.reward_program_clinics
    alter column join_gain set default false,
    alter column join_redeem set default false;

-- Keep `enabled` in sync as (gain OR redeem) for older clients
create or replace function public.reward_program_clinics_sync_enabled()
returns trigger
language plpgsql
as $$
begin
    new.join_gain := coalesce(new.join_gain, false);
    new.join_redeem := coalesce(new.join_redeem, false);
    new.enabled := (new.join_gain or new.join_redeem);
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists reward_program_clinics_sync_enabled_trg
    on public.reward_program_clinics;
create trigger reward_program_clinics_sync_enabled_trg
    before insert or update on public.reward_program_clinics
    for each row execute function public.reward_program_clinics_sync_enabled();

create or replace function public.reward_clinic_gain_enabled(p_clinic_id uuid, p_clinic_code text)
returns boolean
language plpgsql
stable
as $$
declare
    v_on boolean;
    v_code text := upper(trim(coalesce(p_clinic_code, '')));
begin
    if p_clinic_id is not null then
        select coalesce(join_gain, enabled, false) into v_on
        from public.reward_program_clinics
        where clinic_id = p_clinic_id
        limit 1;
        if found then return coalesce(v_on, false); end if;
    end if;
    if v_code <> '' then
        select coalesce(join_gain, enabled, false) into v_on
        from public.reward_program_clinics
        where upper(trim(clinic_code)) = v_code
        limit 1;
        if found then return coalesce(v_on, false); end if;
    end if;
    return (v_code = 'PL');
end;
$$;

create or replace function public.reward_clinic_redeem_enabled(p_clinic_id uuid, p_clinic_code text)
returns boolean
language plpgsql
stable
as $$
declare
    v_on boolean;
    v_code text := upper(trim(coalesce(p_clinic_code, '')));
begin
    if p_clinic_id is not null then
        select coalesce(join_redeem, enabled, false) into v_on
        from public.reward_program_clinics
        where clinic_id = p_clinic_id
        limit 1;
        if found then return coalesce(v_on, false); end if;
    end if;
    if v_code <> '' then
        select coalesce(join_redeem, enabled, false) into v_on
        from public.reward_program_clinics
        where upper(trim(clinic_code)) = v_code
        limit 1;
        if found then return coalesce(v_on, false); end if;
    end if;
    return (v_code = 'PL');
end;
$$;

grant execute on function public.reward_clinic_gain_enabled(uuid, text) to anon, authenticated;
grant execute on function public.reward_clinic_redeem_enabled(uuid, text) to anon, authenticated;

-- ════════════════════════════════════════════════════════════
-- ENSURE ACCOUNT (still 1 chart = 1 patient row = 1 account)
-- ════════════════════════════════════════════════════════════
create or replace function public.reward_ensure_account(p_patient_id uuid)
returns public.reward_accounts
language plpgsql
as $$
declare
    v_acc public.reward_accounts;
    v_pat record;
begin
    if p_patient_id is null then
        raise exception 'patient_id required';
    end if;

    select * into v_acc
    from public.reward_accounts
    where patient_id = p_patient_id
    limit 1;

    if found then
        -- Refresh chart no / name if blank
        if coalesce(nullif(trim(v_acc.patient_no), ''), '') = '' then
            update public.reward_accounts a
            set patient_no = p.patient_no,
                patient_name = coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.chinese_name), ''), p.patient_no),
                clinic_code = coalesce(nullif(trim(a.clinic_code), ''), nullif(trim(p.clinic_tag), ''), ''),
                updated_at = now()
            from public.patients p
            where a.id = v_acc.id and p.id = p_patient_id
            returning a.* into v_acc;
        end if;
        return v_acc;
    end if;

    select id, patient_no, full_name, chinese_name, clinic_tag
    into v_pat
    from public.patients
    where id = p_patient_id
    limit 1;

    if not found then
        raise exception 'patient not found';
    end if;

    insert into public.reward_accounts (
        patient_id, patient_no, patient_name, clinic_id, clinic_code
    ) values (
        p_patient_id,
        v_pat.patient_no,
        coalesce(nullif(trim(v_pat.full_name), ''), nullif(trim(v_pat.chinese_name), ''), v_pat.patient_no),
        null,
        coalesce(nullif(trim(v_pat.clinic_tag), ''), '')
    )
    on conflict (patient_id) do update
        set updated_at = now()
    returning * into v_acc;

    return v_acc;
end;
$$;

-- Related charts for the same person (HKID, else phone)
create or replace function public.reward_related_patient_ids(p_patient_id uuid)
returns uuid[]
language plpgsql
stable
as $$
declare
    v_hkid text;
    v_phone text;
    v_ids uuid[];
begin
    if p_patient_id is null then
        return array[]::uuid[];
    end if;

    select
        upper(regexp_replace(coalesce(hkid, ''), '[^A-Za-z0-9]', '', 'g')),
        regexp_replace(coalesce(nullif(trim(mobile_phone), ''), nullif(trim(phone_number), ''), ''), '[^0-9]', '', 'g')
    into v_hkid, v_phone
    from public.patients
    where id = p_patient_id
    limit 1;

    if not found then
        return array[p_patient_id];
    end if;

    if v_hkid is not null and length(v_hkid) >= 7 then
        select array_agg(distinct p.id) into v_ids
        from public.patients p
        where upper(regexp_replace(coalesce(p.hkid, ''), '[^A-Za-z0-9]', '', 'g')) = v_hkid;
    elsif v_phone is not null and length(v_phone) >= 8 then
        select array_agg(distinct p.id) into v_ids
        from public.patients p
        where regexp_replace(coalesce(nullif(trim(p.mobile_phone), ''), nullif(trim(p.phone_number), ''), ''), '[^0-9]', '', 'g') = v_phone;
    end if;

    if v_ids is null or array_length(v_ids, 1) is null then
        return array[p_patient_id];
    end if;
    if not (p_patient_id = any (v_ids)) then
        v_ids := array_append(v_ids, p_patient_id);
    end if;
    return v_ids;
end;
$$;

grant execute on function public.reward_related_patient_ids(uuid) to anon, authenticated;

-- Allocate points across accounts: smallest balance first, largest last.
create or replace function public.reward_allocate_across_accounts(
    p_account_ids uuid[],
    p_points numeric
)
returns table (
    account_id uuid,
    patient_id uuid,
    take_points numeric,
    balance_before numeric,
    balance_after numeric,
    patient_no text,
    clinic_code text
)
language plpgsql
stable
as $$
declare
    v_need numeric(12, 2) := public.reward_round2(p_points);
    v_row record;
    v_take numeric(12, 2);
    v_total numeric(12, 2) := 0;
begin
    if v_need <= 0 or p_account_ids is null or array_length(p_account_ids, 1) is null then
        return;
    end if;

    select coalesce(sum(a.balance), 0) into v_total
    from public.reward_accounts a
    where a.id = any (p_account_ids);

    if public.reward_round2(v_total) + 0.005 < v_need then
        raise exception 'insufficient reward balance across selected charts';
    end if;

    for v_row in
        select a.id, a.patient_id, a.balance, a.patient_no, a.clinic_code
        from public.reward_accounts a
        where a.id = any (p_account_ids)
          and a.balance > 0.005
        order by a.balance asc, coalesce(a.patient_no, '') asc, a.id asc
    loop
        exit when v_need <= 0.005;
        v_take := public.reward_round2(least(v_row.balance, v_need));
        if v_take <= 0 then
            continue;
        end if;
        account_id := v_row.id;
        patient_id := v_row.patient_id;
        take_points := v_take;
        balance_before := v_row.balance;
        balance_after := public.reward_round2(v_row.balance - v_take);
        patient_no := v_row.patient_no;
        clinic_code := v_row.clinic_code;
        return next;
        v_need := public.reward_round2(v_need - v_take);
    end loop;
end;
$$;

grant execute on function public.reward_allocate_across_accounts(uuid[], numeric) to anon, authenticated;

-- Earn: require join_gain (clinic-independent credit onto this chart)
create or replace function public.reward_earn(
    p_patient_id uuid,
    p_eligible_amount numeric,
    p_bill_id uuid default null,
    p_bill_payment_id uuid default null,
    p_clinic_id uuid default null,
    p_clinic_code text default null,
    p_created_by text default null,
    p_note text default null
)
returns jsonb
language plpgsql
as $$
declare
    v_acc public.reward_accounts;
    v_rate numeric(8, 4);
    v_points numeric(12, 2);
    v_eligible numeric(12, 2);
    v_new_bal numeric(12, 2);
    v_ledger public.reward_ledger;
    v_code text := trim(coalesce(p_clinic_code, ''));
begin
    v_eligible := public.reward_round2(p_eligible_amount);
    if v_eligible <= 0 then
        return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'zero_eligible', 'points', 0);
    end if;

    if not public.reward_clinic_gain_enabled(p_clinic_id, v_code) then
        return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'clinic_gain_disabled', 'points', 0);
    end if;

    if p_bill_payment_id is not null then
        if exists (
            select 1 from public.reward_ledger
            where bill_payment_id = p_bill_payment_id and kind = 'earn'
        ) then
            return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'already_earned', 'points', 0);
        end if;
    end if;

    select earn_rate_percent into v_rate from public.reward_program where id = 1;
    v_rate := coalesce(v_rate, 10);
    v_points := public.reward_round2(v_eligible * v_rate / 100.0);
    if v_points <= 0 then
        return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'zero_points', 'points', 0);
    end if;

    v_acc := public.reward_ensure_account(p_patient_id);
    v_new_bal := public.reward_round2(v_acc.balance + v_points);

    update public.reward_accounts
    set balance = v_new_bal,
        lifetime_earned = public.reward_round2(lifetime_earned + v_points),
        started_at = coalesce(started_at, now()),
        clinic_id = coalesce(clinic_id, p_clinic_id),
        clinic_code = case
            when coalesce(nullif(trim(clinic_code), ''), '') = '' then v_code
            else clinic_code end,
        updated_at = now()
    where id = v_acc.id
    returning * into v_acc;

    insert into public.reward_ledger (
        account_id, patient_id, kind, points, balance_after,
        earn_rate_percent, eligible_amount,
        bill_id, bill_payment_id, clinic_id, clinic_code,
        note, created_by
    ) values (
        v_acc.id, p_patient_id, 'earn', v_points, v_new_bal,
        v_rate, v_eligible,
        p_bill_id, p_bill_payment_id, p_clinic_id, v_code,
        p_note, p_created_by
    )
    returning * into v_ledger;

    return jsonb_build_object(
        'ok', true,
        'skipped', false,
        'points', v_points,
        'balance', v_new_bal,
        'total_balance', (
            select public.reward_round2(coalesce(sum(a.balance), 0))
            from public.reward_accounts a
            where a.patient_id = any (public.reward_related_patient_ids(p_patient_id))
        ),
        'ledger_id', v_ledger.id,
        'kind', 'earn',
        'patient_id', p_patient_id,
        'patient_no', v_acc.patient_no
    );
end;
$$;

-- Multi-chart redeem (smallest → largest)
create or replace function public.reward_redeem_multi(
    p_anchor_patient_id uuid,
    p_points numeric,
    p_source_account_ids uuid[],
    p_bill_id uuid default null,
    p_bill_payment_id uuid default null,
    p_clinic_id uuid default null,
    p_clinic_code text default null,
    p_created_by text default null,
    p_note text default null
)
returns jsonb
language plpgsql
as $$
declare
    v_points numeric(12, 2);
    v_code text := trim(coalesce(p_clinic_code, ''));
    v_alloc record;
    v_new_bal numeric(12, 2);
    v_ledger public.reward_ledger;
    v_parts jsonb := '[]'::jsonb;
    v_batch uuid := gen_random_uuid();
    v_total_after numeric(12, 2);
    v_count int := 0;
begin
    v_points := public.reward_round2(p_points);
    if v_points <= 0 then
        return jsonb_build_object('ok', false, 'error', 'points must be > 0');
    end if;

    if p_anchor_patient_id is null then
        return jsonb_build_object('ok', false, 'error', 'patient required');
    end if;

    if not public.reward_clinic_redeem_enabled(p_clinic_id, v_code) then
        return jsonb_build_object('ok', false, 'error', 'clinic not open for redeem');
    end if;

    if p_source_account_ids is null or array_length(p_source_account_ids, 1) is null then
        return jsonb_build_object('ok', false, 'error', 'select at least one chart source');
    end if;

    if p_bill_payment_id is not null then
        if exists (
            select 1 from public.reward_ledger
            where bill_payment_id = p_bill_payment_id and kind = 'redeem'
        ) then
            return jsonb_build_object('ok', false, 'error', 'already redeemed for this payment');
        end if;
    end if;

    begin
        for v_alloc in
            select * from public.reward_allocate_across_accounts(p_source_account_ids, v_points)
        loop
            v_new_bal := v_alloc.balance_after;

            update public.reward_accounts
            set balance = v_new_bal,
                lifetime_redeemed = public.reward_round2(lifetime_redeemed + v_alloc.take_points),
                updated_at = now()
            where id = v_alloc.account_id;

            insert into public.reward_ledger (
                account_id, patient_id, kind, points, balance_after,
                bill_id, bill_payment_id, clinic_id, clinic_code,
                note, created_by, transfer_id
            ) values (
                v_alloc.account_id, v_alloc.patient_id, 'redeem', -v_alloc.take_points, v_new_bal,
                p_bill_id, p_bill_payment_id, p_clinic_id, v_code,
                trim(both ' · ' from coalesce(p_note, '') || ' · chart ' || coalesce(v_alloc.patient_no, '')),
                p_created_by,
                v_batch
            )
            returning * into v_ledger;

            v_parts := v_parts || jsonb_build_array(jsonb_build_object(
                'account_id', v_alloc.account_id,
                'patient_id', v_alloc.patient_id,
                'patient_no', v_alloc.patient_no,
                'points', -v_alloc.take_points,
                'balance', v_new_bal,
                'ledger_id', v_ledger.id
            ));
            v_count := v_count + 1;
        end loop;
    exception when others then
        return jsonb_build_object('ok', false, 'error', SQLERRM);
    end;

    if v_count = 0 then
        return jsonb_build_object('ok', false, 'error', 'nothing to redeem');
    end if;

    select public.reward_round2(coalesce(sum(a.balance), 0)) into v_total_after
    from public.reward_accounts a
    where a.patient_id = any (public.reward_related_patient_ids(p_anchor_patient_id));

    return jsonb_build_object(
        'ok', true,
        'points', -v_points,
        'balance', v_total_after,
        'total_balance', v_total_after,
        'batch_id', v_batch,
        'parts', v_parts,
        'kind', 'redeem',
        'patient_id', p_anchor_patient_id,
        'ledger_id', v_ledger.id
    );
end;
$$;

grant execute on function public.reward_redeem_multi(uuid, numeric, uuid[], uuid, uuid, uuid, text, text, text)
    to anon, authenticated;

-- Single-chart redeem (compat): wraps multi with this patient's account
create or replace function public.reward_redeem(
    p_patient_id uuid,
    p_points numeric,
    p_bill_id uuid default null,
    p_bill_payment_id uuid default null,
    p_clinic_id uuid default null,
    p_clinic_code text default null,
    p_created_by text default null,
    p_note text default null
)
returns jsonb
language plpgsql
as $$
declare
    v_acc public.reward_accounts;
begin
    v_acc := public.reward_ensure_account(p_patient_id);
    return public.reward_redeem_multi(
        p_patient_id,
        p_points,
        array[v_acc.id],
        p_bill_id,
        p_bill_payment_id,
        p_clinic_id,
        p_clinic_code,
        p_created_by,
        p_note
    );
end;
$$;

-- Multi-source transfer → destination chart (target patient_id)
create or replace function public.reward_transfer_multi(
    p_to_patient_id uuid,
    p_points numeric,
    p_source_account_ids uuid[],
    p_clinic_id uuid default null,
    p_clinic_code text default null,
    p_created_by text default null,
    p_note text default null
)
returns jsonb
language plpgsql
as $$
declare
    v_points numeric(12, 2);
    v_code text := trim(coalesce(p_clinic_code, ''));
    v_to public.reward_accounts;
    v_alloc record;
    v_from_bal numeric(12, 2);
    v_to_bal numeric(12, 2);
    v_xfer_id uuid := gen_random_uuid();
    v_out public.reward_ledger;
    v_in public.reward_ledger;
    v_parts jsonb := '[]'::jsonb;
    v_count int := 0;
    v_from_anchor uuid;
begin
    v_points := public.reward_round2(p_points);
    if v_points <= 0 then
        return jsonb_build_object('ok', false, 'error', 'points must be > 0');
    end if;
    if p_to_patient_id is null then
        return jsonb_build_object('ok', false, 'error', 'destination patient required');
    end if;
    if p_source_account_ids is null or array_length(p_source_account_ids, 1) is null then
        return jsonb_build_object('ok', false, 'error', 'select at least one source chart');
    end if;

    -- Destination determined by target chart no (patient row)
    v_to := public.reward_ensure_account(p_to_patient_id);

    if exists (
        select 1 from public.reward_accounts a
        where a.id = any (p_source_account_ids)
          and a.patient_id = p_to_patient_id
    ) then
        return jsonb_build_object('ok', false, 'error', 'cannot transfer onto a source chart');
    end if;

    begin
        for v_alloc in
            select * from public.reward_allocate_across_accounts(p_source_account_ids, v_points)
        loop
            v_from_bal := v_alloc.balance_after;
            v_from_anchor := coalesce(v_from_anchor, v_alloc.patient_id);

            update public.reward_accounts
            set balance = v_from_bal,
                lifetime_transferred_out = public.reward_round2(lifetime_transferred_out + v_alloc.take_points),
                updated_at = now()
            where id = v_alloc.account_id;

            insert into public.reward_ledger (
                account_id, patient_id, kind, points, balance_after,
                transfer_id, counterparty_patient_id,
                clinic_id, clinic_code, note, created_by
            ) values (
                v_alloc.account_id, v_alloc.patient_id, 'transfer_out', -v_alloc.take_points, v_from_bal,
                v_xfer_id, p_to_patient_id,
                p_clinic_id, v_code,
                coalesce(p_note, '') ||
                    case when coalesce(p_note, '') = '' then '' else ' · ' end ||
                    'from ' || coalesce(v_alloc.patient_no, ''),
                p_created_by
            )
            returning * into v_out;

            v_parts := v_parts || jsonb_build_array(jsonb_build_object(
                'account_id', v_alloc.account_id,
                'patient_id', v_alloc.patient_id,
                'patient_no', v_alloc.patient_no,
                'points', -v_alloc.take_points,
                'balance', v_from_bal,
                'ledger_id', v_out.id
            ));
            v_count := v_count + 1;
        end loop;
    exception when others then
        return jsonb_build_object('ok', false, 'error', SQLERRM);
    end;

    if v_count = 0 then
        return jsonb_build_object('ok', false, 'error', 'nothing to transfer');
    end if;

    v_to_bal := public.reward_round2(v_to.balance + v_points);
    update public.reward_accounts
    set balance = v_to_bal,
        lifetime_transferred_in = public.reward_round2(lifetime_transferred_in + v_points),
        started_at = coalesce(started_at, now()),
        updated_at = now()
    where id = v_to.id
    returning * into v_to;

    insert into public.reward_ledger (
        account_id, patient_id, kind, points, balance_after,
        transfer_id, counterparty_patient_id,
        clinic_id, clinic_code, note, created_by
    ) values (
        v_to.id, p_to_patient_id, 'transfer_in', v_points, v_to_bal,
        v_xfer_id, v_from_anchor,
        p_clinic_id, v_code,
        coalesce(p_note, '') ||
            case when coalesce(p_note, '') = '' then '' else ' · ' end ||
            'to ' || coalesce(v_to.patient_no, ''),
        p_created_by
    )
    returning * into v_in;

    return jsonb_build_object(
        'ok', true,
        'transfer_id', v_xfer_id,
        'points', v_points,
        'parts', v_parts,
        'from', jsonb_build_object(
            'patient_id', v_from_anchor,
            'points', -v_points,
            'balance', (
                select public.reward_round2(coalesce(sum(a.balance), 0))
                from public.reward_accounts a
                where a.patient_id = any (public.reward_related_patient_ids(v_from_anchor))
            ),
            'ledger_id', v_out.id
        ),
        'to', jsonb_build_object(
            'patient_id', p_to_patient_id,
            'patient_no', v_to.patient_no,
            'points', v_points,
            'balance', v_to_bal,
            'ledger_id', v_in.id
        )
    );
end;
$$;

grant execute on function public.reward_transfer_multi(uuid, numeric, uuid[], uuid, text, text, text)
    to anon, authenticated;

-- Compat wrapper: single-source transfer
create or replace function public.reward_transfer(
    p_from_patient_id uuid,
    p_to_patient_id uuid,
    p_points numeric,
    p_clinic_id uuid default null,
    p_clinic_code text default null,
    p_created_by text default null,
    p_note text default null
)
returns jsonb
language plpgsql
as $$
declare
    v_from public.reward_accounts;
begin
    if p_from_patient_id is null or p_to_patient_id is null then
        return jsonb_build_object('ok', false, 'error', 'both patients required');
    end if;
    if p_from_patient_id = p_to_patient_id then
        return jsonb_build_object('ok', false, 'error', 'cannot transfer to same patient');
    end if;
    v_from := public.reward_ensure_account(p_from_patient_id);
    return public.reward_transfer_multi(
        p_to_patient_id,
        p_points,
        array[v_from.id],
        p_clinic_id,
        p_clinic_code,
        p_created_by,
        p_note
    );
end;
$$;

comment on function public.reward_redeem_multi is
    'Redeem across selected chart accounts; drain smallest balances first.';
comment on function public.reward_transfer_multi is
    'Transfer from multiple source charts onto the destination patient chart no.';
comment on column public.reward_program_clinics.join_gain is
    'Clinic participates in earning (reception may toggle).';
comment on column public.reward_program_clinics.join_redeem is
    'Clinic participates in redeeming (reception may toggle).';
