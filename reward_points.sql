-- Banana Clinic Manager — Reward Points (cash-dollar style)
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- Rules (app-enforced + RPC):
--   * Default earn rate 10% of eligible (income) payment amount.
--   * Points earned on a payment are available from the NEXT payment only.
--   * Redeemed points reduce bill balance but MUST NOT count as income.
--   * Po Lam (clinic_code PL) joins by default; other clinics opt-in.
--   * Admin-only: change rate / clinic join. All users: view ledger/log.

-- ════════════════════════════════════════════════════════════
-- SETTINGS (single-row program)
-- ════════════════════════════════════════════════════════════
create table if not exists public.reward_program (
    id                      smallint primary key default 1 check (id = 1),
    earn_rate_percent       numeric(8, 4) not null default 10
                            check (earn_rate_percent >= 0 and earn_rate_percent <= 100),
    sms_notify_enabled      boolean not null default true,
    sms_template_en         text,
    sms_template_zh_hant    text,
    sms_template_zh_cn      text,
    updated_at              timestamptz not null default now(),
    updated_by              text
);

insert into public.reward_program (id, earn_rate_percent, sms_notify_enabled)
values (1, 10, true)
on conflict (id) do nothing;

-- Bilingual ZH-Hant + EN (same body in all columns)
update public.reward_program
set sms_template_en =
        '[Joyful Smile Dental Clinic] 積分更新 / Reward points update
變動/Change: {CHANGE} ({KIND})
結餘/Balance: {BALANCE}
診所/Clinic: {CLINIC}
參考/Ref: {REF}',
    sms_template_zh_hant =
        '[Joyful Smile Dental Clinic] 積分更新 / Reward points update
變動/Change: {CHANGE} ({KIND})
結餘/Balance: {BALANCE}
診所/Clinic: {CLINIC}
參考/Ref: {REF}',
    sms_template_zh_cn =
        '[Joyful Smile Dental Clinic] 積分更新 / Reward points update
變動/Change: {CHANGE} ({KIND})
結餘/Balance: {BALANCE}
診所/Clinic: {CLINIC}
參考/Ref: {REF}',
    updated_at = now()
where id = 1;

-- ════════════════════════════════════════════════════════════
-- PER-CLINIC JOIN (default: PL on, others off)
-- ════════════════════════════════════════════════════════════
create table if not exists public.reward_program_clinics (
    id              uuid primary key default gen_random_uuid(),
    clinic_id       uuid not null references public.clinics (id) on delete cascade,
    clinic_code     text not null default '',
    enabled         boolean not null default false,
    updated_at      timestamptz not null default now(),
    updated_by      text,
    constraint reward_program_clinics_clinic_uidx unique (clinic_id)
);

create index if not exists reward_program_clinics_code_idx
    on public.reward_program_clinics (clinic_code);

insert into public.reward_program_clinics (clinic_id, clinic_code, enabled)
select c.id,
       coalesce(nullif(trim(c.clinic_code), ''), ''),
       (upper(trim(coalesce(c.clinic_code, ''))) = 'PL')
from public.clinics c
on conflict (clinic_id) do nothing;

-- ════════════════════════════════════════════════════════════
-- PATIENT ACCOUNT (cached balance)
-- ════════════════════════════════════════════════════════════
create table if not exists public.reward_accounts (
    id                      uuid primary key default gen_random_uuid(),
    patient_id              uuid not null references public.patients (id) on delete cascade,
    patient_no              text,
    patient_name            text,
    clinic_id               uuid references public.clinics (id) on delete set null,
    clinic_code             text,
    started_at              timestamptz,
    balance                 numeric(12, 2) not null default 0,
    lifetime_earned         numeric(12, 2) not null default 0,
    lifetime_redeemed       numeric(12, 2) not null default 0,
    lifetime_transferred_in numeric(12, 2) not null default 0,
    lifetime_transferred_out numeric(12, 2) not null default 0,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    constraint reward_accounts_patient_uidx unique (patient_id)
);

create index if not exists reward_accounts_clinic_idx
    on public.reward_accounts (clinic_code);

-- ════════════════════════════════════════════════════════════
-- LEDGER (source of truth + summary log)
-- ════════════════════════════════════════════════════════════
create table if not exists public.reward_ledger (
    id                      uuid primary key default gen_random_uuid(),
    account_id              uuid not null references public.reward_accounts (id) on delete cascade,
    patient_id              uuid not null references public.patients (id) on delete cascade,
    kind                    text not null
                            check (kind in (
                                'earn', 'redeem',
                                'transfer_out', 'transfer_in',
                                'adjust',
                                'void_earn', 'void_redeem'
                            )),
    points                  numeric(12, 2) not null,
    balance_after           numeric(12, 2) not null,
    earn_rate_percent       numeric(8, 4),
    eligible_amount         numeric(12, 2),
    bill_id                 uuid,
    bill_payment_id         uuid,
    transfer_id             uuid,
    counterparty_patient_id uuid references public.patients (id) on delete set null,
    clinic_id               uuid references public.clinics (id) on delete set null,
    clinic_code             text,
    note                    text,
    created_by              text,
    created_at              timestamptz not null default now(),
    reverses_ledger_id      uuid references public.reward_ledger (id) on delete set null
);

create index if not exists reward_ledger_patient_created_idx
    on public.reward_ledger (patient_id, created_at desc);

create index if not exists reward_ledger_kind_created_idx
    on public.reward_ledger (kind, created_at desc);

create index if not exists reward_ledger_bill_idx
    on public.reward_ledger (bill_id)
    where bill_id is not null;

create index if not exists reward_ledger_payment_idx
    on public.reward_ledger (bill_payment_id)
    where bill_payment_id is not null;

create index if not exists reward_ledger_transfer_idx
    on public.reward_ledger (transfer_id)
    where transfer_id is not null;

create unique index if not exists reward_ledger_earn_payment_uidx
    on public.reward_ledger (bill_payment_id)
    where kind = 'earn' and bill_payment_id is not null;

create unique index if not exists reward_ledger_redeem_payment_uidx
    on public.reward_ledger (bill_payment_id)
    where kind = 'redeem' and bill_payment_id is not null;

-- ════════════════════════════════════════════════════════════
-- SMS SEND LOG (best-effort notify)
-- ════════════════════════════════════════════════════════════
create table if not exists public.reward_sms_log (
    id              uuid primary key default gen_random_uuid(),
    ledger_id       uuid references public.reward_ledger (id) on delete set null,
    patient_id      uuid references public.patients (id) on delete set null,
    to_phone        text,
    body            text,
    status          text not null default 'pending'
                    check (status in ('pending', 'sent', 'failed', 'skipped_no_phone', 'skipped_disabled')),
    error           text,
    twilio_sid      text,
    created_at      timestamptz not null default now()
);

create index if not exists reward_sms_log_patient_idx
    on public.reward_sms_log (patient_id, created_at desc);

-- ════════════════════════════════════════════════════════════
-- RLS (anon client, same pattern as patient_recalls)
-- ════════════════════════════════════════════════════════════
alter table public.reward_program enable row level security;
alter table public.reward_program_clinics enable row level security;
alter table public.reward_accounts enable row level security;
alter table public.reward_ledger enable row level security;
alter table public.reward_sms_log enable row level security;

do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'reward_program'
          and policyname = 'reward_program_anon_all'
    ) then
        create policy reward_program_anon_all
            on public.reward_program for all using (true) with check (true);
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'reward_program_clinics'
          and policyname = 'reward_program_clinics_anon_all'
    ) then
        create policy reward_program_clinics_anon_all
            on public.reward_program_clinics for all using (true) with check (true);
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'reward_accounts'
          and policyname = 'reward_accounts_anon_all'
    ) then
        create policy reward_accounts_anon_all
            on public.reward_accounts for all using (true) with check (true);
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'reward_ledger'
          and policyname = 'reward_ledger_anon_all'
    ) then
        create policy reward_ledger_anon_all
            on public.reward_ledger for all using (true) with check (true);
    end if;

    if not exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'reward_sms_log'
          and policyname = 'reward_sms_log_anon_all'
    ) then
        create policy reward_sms_log_anon_all
            on public.reward_sms_log for all using (true) with check (true);
    end if;
end $$;

-- ════════════════════════════════════════════════════════════
-- HELPERS + RPCs
-- ════════════════════════════════════════════════════════════
create or replace function public.reward_round2(n numeric)
returns numeric
language sql
immutable
as $$
    select round(coalesce(n, 0)::numeric, 2);
$$;

create or replace function public.reward_clinic_enabled(p_clinic_id uuid, p_clinic_code text)
returns boolean
language plpgsql
stable
as $$
declare
    v_enabled boolean;
    v_code text := upper(trim(coalesce(p_clinic_code, '')));
begin
    if p_clinic_id is not null then
        select enabled into v_enabled
        from public.reward_program_clinics
        where clinic_id = p_clinic_id
        limit 1;
        if found then
            return coalesce(v_enabled, false);
        end if;
    end if;

    if v_code <> '' then
        select enabled into v_enabled
        from public.reward_program_clinics
        where upper(trim(clinic_code)) = v_code
        limit 1;
        if found then
            return coalesce(v_enabled, false);
        end if;
    end if;

    -- Fallback seed rule if row missing: PL on, else off
    return (v_code = 'PL');
end;
$$;

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

    if not public.reward_clinic_enabled(p_clinic_id, v_code) then
        return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'clinic_disabled', 'points', 0);
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
        'ledger_id', v_ledger.id,
        'kind', 'earn',
        'patient_id', p_patient_id
    );
end;
$$;

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
    v_points numeric(12, 2);
    v_new_bal numeric(12, 2);
    v_ledger public.reward_ledger;
    v_code text := trim(coalesce(p_clinic_code, ''));
begin
    v_points := public.reward_round2(p_points);
    if v_points <= 0 then
        return jsonb_build_object('ok', false, 'error', 'points must be > 0');
    end if;

    if not public.reward_clinic_enabled(p_clinic_id, v_code) then
        return jsonb_build_object('ok', false, 'error', 'clinic not in reward scheme');
    end if;

    if p_bill_payment_id is not null then
        if exists (
            select 1 from public.reward_ledger
            where bill_payment_id = p_bill_payment_id and kind = 'redeem'
        ) then
            return jsonb_build_object('ok', false, 'error', 'already redeemed for this payment');
        end if;
    end if;

    v_acc := public.reward_ensure_account(p_patient_id);
    if v_acc.balance + 0.005 < v_points then
        return jsonb_build_object('ok', false, 'error', 'insufficient reward balance',
            'balance', v_acc.balance);
    end if;

    v_new_bal := public.reward_round2(v_acc.balance - v_points);

    update public.reward_accounts
    set balance = v_new_bal,
        lifetime_redeemed = public.reward_round2(lifetime_redeemed + v_points),
        updated_at = now()
    where id = v_acc.id
    returning * into v_acc;

    insert into public.reward_ledger (
        account_id, patient_id, kind, points, balance_after,
        bill_id, bill_payment_id, clinic_id, clinic_code,
        note, created_by
    ) values (
        v_acc.id, p_patient_id, 'redeem', -v_points, v_new_bal,
        p_bill_id, p_bill_payment_id, p_clinic_id, v_code,
        p_note, p_created_by
    )
    returning * into v_ledger;

    return jsonb_build_object(
        'ok', true,
        'points', -v_points,
        'balance', v_new_bal,
        'ledger_id', v_ledger.id,
        'kind', 'redeem',
        'patient_id', p_patient_id
    );
end;
$$;

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
    v_to public.reward_accounts;
    v_points numeric(12, 2);
    v_from_bal numeric(12, 2);
    v_to_bal numeric(12, 2);
    v_xfer_id uuid := gen_random_uuid();
    v_out public.reward_ledger;
    v_in public.reward_ledger;
    v_code text := trim(coalesce(p_clinic_code, ''));
begin
    if p_from_patient_id is null or p_to_patient_id is null then
        return jsonb_build_object('ok', false, 'error', 'both patients required');
    end if;
    if p_from_patient_id = p_to_patient_id then
        return jsonb_build_object('ok', false, 'error', 'cannot transfer to same patient');
    end if;

    v_points := public.reward_round2(p_points);
    if v_points <= 0 then
        return jsonb_build_object('ok', false, 'error', 'points must be > 0');
    end if;

    v_from := public.reward_ensure_account(p_from_patient_id);
    v_to := public.reward_ensure_account(p_to_patient_id);

    if v_from.balance + 0.005 < v_points then
        return jsonb_build_object('ok', false, 'error', 'insufficient reward balance',
            'balance', v_from.balance);
    end if;

    v_from_bal := public.reward_round2(v_from.balance - v_points);
    v_to_bal := public.reward_round2(v_to.balance + v_points);

    update public.reward_accounts
    set balance = v_from_bal,
        lifetime_transferred_out = public.reward_round2(lifetime_transferred_out + v_points),
        updated_at = now()
    where id = v_from.id;

    update public.reward_accounts
    set balance = v_to_bal,
        lifetime_transferred_in = public.reward_round2(lifetime_transferred_in + v_points),
        started_at = coalesce(started_at, now()),
        updated_at = now()
    where id = v_to.id;

    insert into public.reward_ledger (
        account_id, patient_id, kind, points, balance_after,
        transfer_id, counterparty_patient_id,
        clinic_id, clinic_code, note, created_by
    ) values (
        v_from.id, p_from_patient_id, 'transfer_out', -v_points, v_from_bal,
        v_xfer_id, p_to_patient_id,
        p_clinic_id, v_code, p_note, p_created_by
    )
    returning * into v_out;

    insert into public.reward_ledger (
        account_id, patient_id, kind, points, balance_after,
        transfer_id, counterparty_patient_id,
        clinic_id, clinic_code, note, created_by
    ) values (
        v_to.id, p_to_patient_id, 'transfer_in', v_points, v_to_bal,
        v_xfer_id, p_from_patient_id,
        p_clinic_id, v_code, p_note, p_created_by
    )
    returning * into v_in;

    return jsonb_build_object(
        'ok', true,
        'transfer_id', v_xfer_id,
        'points', v_points,
        'from', jsonb_build_object(
            'patient_id', p_from_patient_id,
            'balance', v_from_bal,
            'ledger_id', v_out.id,
            'kind', 'transfer_out',
            'points', -v_points
        ),
        'to', jsonb_build_object(
            'patient_id', p_to_patient_id,
            'balance', v_to_bal,
            'ledger_id', v_in.id,
            'kind', 'transfer_in',
            'points', v_points
        )
    );
end;
$$;

-- Reverse ALL unreversed earn/redeem rows for a payment (multi-chart redeem
-- writes one redeem ledger row per source chart). Redeem first, then earn.
create or replace function public.reward_void_for_payment(
    p_bill_payment_id uuid,
    p_created_by text default null,
    p_note text default null
)
returns jsonb
language plpgsql
as $$
declare
    v_src public.reward_ledger;
    v_acc public.reward_accounts;
    v_new_bal numeric(12, 2);
    v_ledger public.reward_ledger;
    v_rev_kind text;
    v_delta numeric(12, 2);
    v_count int := 0;
    v_net numeric(12, 2) := 0;
    v_patient uuid := null;
    v_last_bal numeric(12, 2) := null;
    v_last_ledger uuid := null;
    v_last_kind text := null;
begin
    if p_bill_payment_id is null then
        return jsonb_build_object('ok', false, 'error', 'bill_payment_id required');
    end if;

    for v_src in
        select *
        from public.reward_ledger
        where bill_payment_id = p_bill_payment_id
          and kind in ('earn', 'redeem')
          and not exists (
              select 1 from public.reward_ledger r
              where r.reverses_ledger_id = reward_ledger.id
          )
        order by case when kind = 'redeem' then 0 else 1 end,
                 created_at asc
    loop
        select * into v_acc from public.reward_accounts where id = v_src.account_id;
        if not found then
            continue;
        end if;

        v_delta := -v_src.points;
        v_rev_kind := case when v_src.kind = 'earn' then 'void_earn' else 'void_redeem' end;
        v_new_bal := public.reward_round2(v_acc.balance + v_delta);
        if v_new_bal < 0 then v_new_bal := 0; end if;

        update public.reward_accounts
        set balance = v_new_bal,
            lifetime_earned = case
                when v_src.kind = 'earn' then greatest(0, public.reward_round2(lifetime_earned - abs(v_src.points)))
                else lifetime_earned end,
            lifetime_redeemed = case
                when v_src.kind = 'redeem' then greatest(0, public.reward_round2(lifetime_redeemed - abs(v_src.points)))
                else lifetime_redeemed end,
            updated_at = now()
        where id = v_acc.id
        returning * into v_acc;

        insert into public.reward_ledger (
            account_id, patient_id, kind, points, balance_after,
            earn_rate_percent, eligible_amount,
            bill_id, bill_payment_id, clinic_id, clinic_code,
            note, created_by, created_at, reverses_ledger_id
        ) values (
            v_acc.id, v_src.patient_id, v_rev_kind, v_delta, v_new_bal,
            v_src.earn_rate_percent, v_src.eligible_amount,
            v_src.bill_id, p_bill_payment_id, v_src.clinic_id, v_src.clinic_code,
            coalesce(p_note, 'Void payment reverse'), p_created_by,
            clock_timestamp(), v_src.id
        )
        returning * into v_ledger;

        v_count := v_count + 1;
        v_net := public.reward_round2(v_net + v_delta);
        v_patient := coalesce(v_patient, v_src.patient_id);
        v_last_bal := v_new_bal;
        v_last_ledger := v_ledger.id;
        v_last_kind := v_rev_kind;
    end loop;

    if v_count = 0 then
        return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_ledger', 'count', 0);
    end if;

    return jsonb_build_object(
        'ok', true,
        'skipped', false,
        'count', v_count,
        'points', v_net,
        'balance', v_last_bal,
        'ledger_id', v_last_ledger,
        'kind', case when v_count = 1 then v_last_kind else 'net' end,
        'patient_id', v_patient
    );
end;
$$;

grant execute on function public.reward_round2(numeric) to anon, authenticated;
grant execute on function public.reward_clinic_enabled(uuid, text) to anon, authenticated;
grant execute on function public.reward_ensure_account(uuid) to anon, authenticated;
grant execute on function public.reward_earn(uuid, numeric, uuid, uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.reward_redeem(uuid, numeric, uuid, uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.reward_transfer(uuid, uuid, numeric, uuid, text, text, text) to anon, authenticated;
grant execute on function public.reward_void_for_payment(uuid, text, text) to anon, authenticated;

-- Reverse ALL reward activity on a voided bill:
--   * earn  → void_earn  (remove derived points from payments)
--   * redeem → void_redeem (restore points used as discount on this bill)
-- Redeem is reversed first so balance does not go negative mid-loop.
create or replace function public.reward_void_for_bill(
    p_bill_id uuid,
    p_created_by text default null,
    p_note text default null
)
returns jsonb
language plpgsql
as $$
declare
    v_src public.reward_ledger;
    v_acc public.reward_accounts;
    v_new_bal numeric(12, 2);
    v_ledger public.reward_ledger;
    v_rev_kind text;
    v_delta numeric(12, 2);
    v_count int := 0;
    v_net numeric(12, 2) := 0;
    v_patient uuid := null;
    v_last_bal numeric(12, 2) := null;
    v_last_ledger uuid := null;
    v_last_kind text := null;
begin
    if p_bill_id is null then
        return jsonb_build_object('ok', false, 'error', 'bill_id required');
    end if;

    for v_src in
        select *
        from public.reward_ledger
        where bill_id = p_bill_id
          and kind in ('earn', 'redeem')
          and not exists (
              select 1 from public.reward_ledger r
              where r.reverses_ledger_id = reward_ledger.id
          )
        order by case when kind = 'redeem' then 0 else 1 end,
                 created_at asc
    loop
        select * into v_acc from public.reward_accounts where id = v_src.account_id;
        if not found then
            continue;
        end if;

        v_delta := -v_src.points;
        v_rev_kind := case when v_src.kind = 'earn' then 'void_earn' else 'void_redeem' end;
        v_new_bal := public.reward_round2(v_acc.balance + v_delta);
        -- Bill void must always succeed even if points were already spent.
        if v_new_bal < 0 then v_new_bal := 0; end if;

        update public.reward_accounts
        set balance = v_new_bal,
            lifetime_earned = case
                when v_src.kind = 'earn' then greatest(0, public.reward_round2(lifetime_earned - abs(v_src.points)))
                else lifetime_earned end,
            lifetime_redeemed = case
                when v_src.kind = 'redeem' then greatest(0, public.reward_round2(lifetime_redeemed - abs(v_src.points)))
                else lifetime_redeemed end,
            updated_at = now()
        where id = v_acc.id
        returning * into v_acc;

        -- clock_timestamp so void_redeem / void_earn are not tied; ledger lists newest first
        insert into public.reward_ledger (
            account_id, patient_id, kind, points, balance_after,
            earn_rate_percent, eligible_amount,
            bill_id, bill_payment_id, clinic_id, clinic_code,
            note, created_by, created_at, reverses_ledger_id
        ) values (
            v_acc.id, v_src.patient_id, v_rev_kind, v_delta, v_new_bal,
            v_src.earn_rate_percent, v_src.eligible_amount,
            p_bill_id, v_src.bill_payment_id, v_src.clinic_id, v_src.clinic_code,
            coalesce(p_note, 'Void bill: reverse earn + redeem'), p_created_by,
            clock_timestamp(), v_src.id
        )
        returning * into v_ledger;

        v_count := v_count + 1;
        v_net := public.reward_round2(v_net + v_delta);
        v_patient := v_src.patient_id;
        v_last_bal := v_new_bal;
        v_last_ledger := v_ledger.id;
        v_last_kind := v_rev_kind;
    end loop;

    if v_count = 0 then
        return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'no_ledger', 'count', 0);
    end if;

    return jsonb_build_object(
        'ok', true,
        'skipped', false,
        'count', v_count,
        'points', v_net,
        'balance', v_last_bal,
        'ledger_id', v_last_ledger,
        'kind', 'net',
        'patient_id', v_patient
    );
end;
$$;

grant execute on function public.reward_void_for_bill(uuid, text, text) to anon, authenticated;

-- Admin manual balance adjust (delta). UI enforces Admin role.
create or replace function public.reward_adjust(
    p_patient_id uuid,
    p_points_delta numeric,
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
    v_delta numeric(12, 2);
    v_new_bal numeric(12, 2);
    v_ledger public.reward_ledger;
    v_code text := trim(coalesce(p_clinic_code, ''));
begin
    if p_patient_id is null then
        return jsonb_build_object('ok', false, 'error', 'patient_id required');
    end if;

    v_delta := public.reward_round2(p_points_delta);
    if v_delta = 0 then
        return jsonb_build_object('ok', true, 'skipped', true, 'reason', 'zero_delta', 'points', 0);
    end if;

    if p_note is null or length(trim(p_note)) < 1 then
        return jsonb_build_object('ok', false, 'error', 'note required');
    end if;

    v_acc := public.reward_ensure_account(p_patient_id);
    v_new_bal := public.reward_round2(v_acc.balance + v_delta);
    if v_new_bal < 0 then
        return jsonb_build_object('ok', false, 'error', 'balance would be negative',
            'balance', v_acc.balance);
    end if;

    update public.reward_accounts
    set balance = v_new_bal,
        lifetime_earned = case
            when v_delta > 0 then public.reward_round2(lifetime_earned + v_delta)
            else lifetime_earned end,
        lifetime_redeemed = case
            when v_delta < 0 then public.reward_round2(lifetime_redeemed + abs(v_delta))
            else lifetime_redeemed end,
        started_at = coalesce(started_at, now()),
        updated_at = now()
    where id = v_acc.id
    returning * into v_acc;

    insert into public.reward_ledger (
        account_id, patient_id, kind, points, balance_after,
        bill_id, bill_payment_id, clinic_id, clinic_code,
        note, created_by, created_at
    ) values (
        v_acc.id, p_patient_id, 'adjust', v_delta, v_new_bal,
        null, null, p_clinic_id, v_code,
        trim(p_note), p_created_by, clock_timestamp()
    )
    returning * into v_ledger;

    return jsonb_build_object(
        'ok', true,
        'skipped', false,
        'points', v_delta,
        'balance', v_new_bal,
        'ledger_id', v_ledger.id,
        'kind', 'adjust',
        'patient_id', p_patient_id
    );
end;
$$;

grant execute on function public.reward_adjust(uuid, numeric, uuid, text, text, text) to anon, authenticated;

comment on table public.reward_program is
    'Banana reward points program settings (single row). Rate admin-only in UI.';
comment on table public.reward_program_clinics is
    'Which clinics join the reward scheme. Default PL=true.';
comment on table public.reward_accounts is
    'Per-patient reward points balance cache.';
comment on table public.reward_ledger is
    'Immutable reward points ledger / summary log.';
comment on table public.reward_sms_log is
    'Twilio SMS notify log for reward balance changes.';
