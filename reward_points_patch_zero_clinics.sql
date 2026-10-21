-- Patch: RESET ZERO safety log + revert, and program zero policies.
-- Safe to re-run. Banana UI gates manual zero with SMS/TOTP.

-- ── Program policy columns ────────────────────────────────────
alter table public.reward_program
    add column if not exists zero_policy text not null default 'manual';

alter table public.reward_program
    add column if not exists lifespan_months integer;

alter table public.reward_program
    add column if not exists last_year_end_zero_year integer;

alter table public.reward_program
    add column if not exists last_lifespan_run_at timestamptz;

do $$
begin
    if not exists (
        select 1 from pg_constraint
        where conname = 'reward_program_zero_policy_chk'
    ) then
        alter table public.reward_program
            add constraint reward_program_zero_policy_chk
            check (zero_policy in ('manual', 'year_end', 'lifespan'));
    end if;
    if not exists (
        select 1 from pg_constraint
        where conname = 'reward_program_lifespan_months_chk'
    ) then
        alter table public.reward_program
            add constraint reward_program_lifespan_months_chk
            check (
                lifespan_months is null
                or lifespan_months in (1, 2, 3, 4, 6, 9, 12, 24)
            );
    end if;
end $$;

update public.reward_program
set zero_policy = coalesce(nullif(trim(zero_policy), ''), 'manual')
where id = 1;

-- ── Safety log tables ─────────────────────────────────────────
create table if not exists public.reward_zero_batches (
    id                  uuid primary key default gen_random_uuid(),
    created_at          timestamptz not null default now(),
    created_by          text,
    source              text not null default 'manual'
                        check (source in ('manual', 'year_end', 'lifespan', 'revert')),
    scope_all           boolean not null default false,
    clinic_ids          uuid[] default null,
    clinic_codes        text[] default null,
    note                text,
    accounts            integer not null default 0,
    points_cleared      numeric(14, 2) not null default 0,
    reverted_at         timestamptz,
    reverted_by         text
);

create index if not exists reward_zero_batches_created_idx
    on public.reward_zero_batches (created_at desc);

create table if not exists public.reward_zero_snapshot_rows (
    id                  uuid primary key default gen_random_uuid(),
    batch_id            uuid not null references public.reward_zero_batches (id) on delete cascade,
    patient_id          uuid not null,
    account_id          uuid,
    clinic_id           uuid,
    clinic_code         text,
    balance_before      numeric(12, 2) not null,
    lifetime_earned     numeric(12, 2),
    lifetime_redeemed   numeric(12, 2)
);

create index if not exists reward_zero_snapshot_batch_idx
    on public.reward_zero_snapshot_rows (batch_id);

grant select, insert, update on public.reward_zero_batches to anon, authenticated;
grant select, insert on public.reward_zero_snapshot_rows to anon, authenticated;

-- ── Zero with snapshot ────────────────────────────────────────
create or replace function public.reward_zero_clinics(
    p_all boolean default false,
    p_clinic_ids uuid[] default null,
    p_clinic_codes text[] default null,
    p_created_by text default null,
    p_note text default null,
    p_source text default 'manual'
)
returns jsonb
language plpgsql
as $$
declare
    v_note text := trim(coalesce(p_note, ''));
    v_source text := lower(trim(coalesce(p_source, 'manual')));
    v_acc public.reward_accounts;
    v_ledger public.reward_ledger;
    v_delta numeric(12, 2);
    v_count int := 0;
    v_points numeric(14, 2) := 0;
    v_codes text[];
    v_batch_id uuid;
    r record;
begin
    if v_note is null or length(v_note) < 1 then
        return jsonb_build_object('ok', false, 'error', 'note required');
    end if;

    if v_source not in ('manual', 'year_end', 'lifespan') then
        v_source := 'manual';
    end if;

    if not coalesce(p_all, false)
       and (p_clinic_ids is null or cardinality(p_clinic_ids) = 0)
       and (p_clinic_codes is null or cardinality(p_clinic_codes) = 0) then
        return jsonb_build_object('ok', false, 'error', 'no clinics selected');
    end if;

    if p_clinic_codes is not null then
        select array_agg(distinct upper(trim(c)))
          into v_codes
          from unnest(p_clinic_codes) as c
         where length(trim(c)) > 0;
    end if;

    insert into public.reward_zero_batches (
        created_by, source, scope_all, clinic_ids, clinic_codes, note
    ) values (
        p_created_by, v_source, coalesce(p_all, false),
        case when coalesce(p_all, false) then null else p_clinic_ids end,
        case when coalesce(p_all, false) then null else v_codes end,
        v_note
    )
    returning id into v_batch_id;

    for r in
        select a.*
          from public.reward_accounts a
         where public.reward_round2(a.balance) > 0
           and (
                coalesce(p_all, false)
                or (p_clinic_ids is not null and a.clinic_id = any (p_clinic_ids))
                or (
                    v_codes is not null
                    and upper(trim(coalesce(a.clinic_code, ''))) = any (v_codes)
                )
           )
    loop
        v_acc := r;
        v_delta := public.reward_round2(-v_acc.balance);
        if v_delta = 0 then
            continue;
        end if;

        insert into public.reward_zero_snapshot_rows (
            batch_id, patient_id, account_id, clinic_id, clinic_code,
            balance_before, lifetime_earned, lifetime_redeemed
        ) values (
            v_batch_id, v_acc.patient_id, v_acc.id, v_acc.clinic_id,
            coalesce(v_acc.clinic_code, ''),
            v_acc.balance, v_acc.lifetime_earned, v_acc.lifetime_redeemed
        );

        update public.reward_accounts
           set balance = 0,
               lifetime_redeemed = public.reward_round2(lifetime_redeemed + abs(v_delta)),
               updated_at = now()
         where id = v_acc.id
         returning * into v_acc;

        insert into public.reward_ledger (
            account_id, patient_id, kind, points, balance_after,
            bill_id, bill_payment_id, clinic_id, clinic_code,
            note, created_by, created_at
        ) values (
            v_acc.id, v_acc.patient_id, 'adjust', v_delta, 0,
            null, null, v_acc.clinic_id, coalesce(v_acc.clinic_code, ''),
            v_note || ' [batch ' || v_batch_id::text || ']',
            p_created_by, clock_timestamp()
        )
        returning * into v_ledger;

        v_count := v_count + 1;
        v_points := public.reward_round2(v_points + abs(v_delta));
    end loop;

    update public.reward_zero_batches
       set accounts = v_count,
           points_cleared = v_points
     where id = v_batch_id;

    if v_source = 'year_end' then
        update public.reward_program
           set last_year_end_zero_year = extract(year from (now() at time zone 'Asia/Hong_Kong'))::int,
               updated_at = now(),
               updated_by = p_created_by
         where id = 1;
    elsif v_source = 'lifespan' then
        update public.reward_program
           set last_lifespan_run_at = now(),
               updated_at = now(),
               updated_by = p_created_by
         where id = 1;
    end if;

    return jsonb_build_object(
        'ok', true,
        'batch_id', v_batch_id,
        'accounts', v_count,
        'points_cleared', v_points,
        'all', coalesce(p_all, false),
        'source', v_source
    );
end;
$$;

grant execute on function public.reward_zero_clinics(boolean, uuid[], text[], text, text, text)
    to anon, authenticated;

-- Keep old 5-arg signature callable (defaults source=manual)
create or replace function public.reward_zero_clinics(
    p_all boolean,
    p_clinic_ids uuid[],
    p_clinic_codes text[],
    p_created_by text,
    p_note text
)
returns jsonb
language plpgsql
as $$
begin
    return public.reward_zero_clinics(p_all, p_clinic_ids, p_clinic_codes, p_created_by, p_note, 'manual');
end;
$$;

grant execute on function public.reward_zero_clinics(boolean, uuid[], text[], text, text)
    to anon, authenticated;

-- ── Revert last (or specified) unreverted batch ───────────────
create or replace function public.reward_revert_zero_batch(
    p_batch_id uuid default null,
    p_created_by text default null,
    p_note text default null
)
returns jsonb
language plpgsql
as $$
declare
    v_batch public.reward_zero_batches;
    v_note text := trim(coalesce(p_note, ''));
    v_count int := 0;
    v_points numeric(14, 2) := 0;
    v_acc public.reward_accounts;
    v_delta numeric(12, 2);
    r record;
begin
    if p_batch_id is null then
        select * into v_batch
          from public.reward_zero_batches
         where reverted_at is null
           and source in ('manual', 'year_end', 'lifespan')
         order by created_at desc
         limit 1;
    else
        select * into v_batch
          from public.reward_zero_batches
         where id = p_batch_id;
    end if;

    if v_batch.id is null then
        return jsonb_build_object('ok', false, 'error', 'no batch to revert');
    end if;
    if v_batch.reverted_at is not null then
        return jsonb_build_object('ok', false, 'error', 'batch already reverted');
    end if;

    if v_note is null or length(v_note) < 1 then
        v_note := 'Revert RESET ZERO batch ' || v_batch.id::text;
    end if;

    for r in
        select *
          from public.reward_zero_snapshot_rows
         where batch_id = v_batch.id
    loop
        v_acc := public.reward_ensure_account(r.patient_id);
        v_delta := public.reward_round2(r.balance_before - v_acc.balance);
        if v_delta = 0 then
            continue;
        end if;

        update public.reward_accounts
           set balance = public.reward_round2(v_acc.balance + v_delta),
               lifetime_earned = case
                   when v_delta > 0 then public.reward_round2(lifetime_earned + v_delta)
                   else lifetime_earned end,
               lifetime_redeemed = case
                   when v_delta < 0 then public.reward_round2(lifetime_redeemed + abs(v_delta))
                   else lifetime_redeemed end,
               updated_at = now()
         where id = v_acc.id
         returning * into v_acc;

        insert into public.reward_ledger (
            account_id, patient_id, kind, points, balance_after,
            bill_id, bill_payment_id, clinic_id, clinic_code,
            note, created_by, created_at
        ) values (
            v_acc.id, v_acc.patient_id, 'adjust', v_delta, v_acc.balance,
            null, null, coalesce(r.clinic_id, v_acc.clinic_id),
            coalesce(nullif(r.clinic_code, ''), v_acc.clinic_code, ''),
            v_note, p_created_by, clock_timestamp()
        );

        v_count := v_count + 1;
        v_points := public.reward_round2(v_points + abs(v_delta));
    end loop;

    update public.reward_zero_batches
       set reverted_at = now(),
           reverted_by = p_created_by
     where id = v_batch.id;

    return jsonb_build_object(
        'ok', true,
        'batch_id', v_batch.id,
        'accounts', v_count,
        'points_restored', v_points,
        'source', v_batch.source,
        'created_at', v_batch.created_at
    );
end;
$$;

grant execute on function public.reward_revert_zero_batch(uuid, text, text)
    to anon, authenticated;

-- ── Lifespan expiry: zero stale balances older than N months ──
-- Stale = no positive earn/adjust in the last N months, balance > 0.
create or replace function public.reward_expire_lifespan(
    p_months integer,
    p_created_by text default null,
    p_note text default null
)
returns jsonb
language plpgsql
as $$
declare
    v_months int := p_months;
    v_cutoff timestamptz;
    v_note text;
    v_batch_id uuid;
    v_count int := 0;
    v_points numeric(14, 2) := 0;
    v_acc public.reward_accounts;
    v_delta numeric(12, 2);
    r record;
begin
    if v_months is null or v_months not in (1, 2, 3, 4, 6, 9, 12, 24) then
        return jsonb_build_object('ok', false, 'error', 'invalid lifespan months');
    end if;
    v_cutoff := now() - make_interval(months => v_months);
    v_note := coalesce(nullif(trim(p_note), ''),
        'Lifespan expiry ' || v_months::text || ' months');

    insert into public.reward_zero_batches (
        created_by, source, scope_all, note
    ) values (
        p_created_by, 'lifespan', true, v_note
    )
    returning id into v_batch_id;

    for r in
        select a.*
          from public.reward_accounts a
         where public.reward_round2(a.balance) > 0
           and not exists (
                select 1
                  from public.reward_ledger l
                 where l.patient_id = a.patient_id
                   and l.points > 0
                   and l.kind in ('earn', 'adjust', 'transfer_in', 'void_redeem')
                   and l.created_at >= v_cutoff
           )
    loop
        v_acc := r;
        v_delta := public.reward_round2(-v_acc.balance);
        if v_delta = 0 then continue; end if;

        insert into public.reward_zero_snapshot_rows (
            batch_id, patient_id, account_id, clinic_id, clinic_code,
            balance_before, lifetime_earned, lifetime_redeemed
        ) values (
            v_batch_id, v_acc.patient_id, v_acc.id, v_acc.clinic_id,
            coalesce(v_acc.clinic_code, ''),
            v_acc.balance, v_acc.lifetime_earned, v_acc.lifetime_redeemed
        );

        update public.reward_accounts
           set balance = 0,
               lifetime_redeemed = public.reward_round2(lifetime_redeemed + abs(v_delta)),
               updated_at = now()
         where id = v_acc.id
         returning * into v_acc;

        insert into public.reward_ledger (
            account_id, patient_id, kind, points, balance_after,
            bill_id, bill_payment_id, clinic_id, clinic_code,
            note, created_by, created_at
        ) values (
            v_acc.id, v_acc.patient_id, 'adjust', v_delta, 0,
            null, null, v_acc.clinic_id, coalesce(v_acc.clinic_code, ''),
            v_note || ' [batch ' || v_batch_id::text || ']',
            p_created_by, clock_timestamp()
        );

        v_count := v_count + 1;
        v_points := public.reward_round2(v_points + abs(v_delta));
    end loop;

    update public.reward_zero_batches
       set accounts = v_count, points_cleared = v_points
     where id = v_batch_id;

    update public.reward_program
       set last_lifespan_run_at = now(),
           updated_at = now(),
           updated_by = p_created_by
     where id = 1;

    return jsonb_build_object(
        'ok', true,
        'batch_id', v_batch_id,
        'accounts', v_count,
        'points_cleared', v_points,
        'source', 'lifespan',
        'months', v_months
    );
end;
$$;

grant execute on function public.reward_expire_lifespan(integer, text, text)
    to anon, authenticated;
