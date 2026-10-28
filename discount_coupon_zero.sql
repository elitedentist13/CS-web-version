-- Discount coupons: SET ZERO (void unused coupons) with a safety log + Step back.
-- Mirrors reward_points_patch_zero_clinics.sql. Safe to re-run.
-- Banana gates manual zero and policy changes with admin SMS + Google Authenticator.
-- The policy itself (manual / year_end / lifespan) is kept in program_settings ('coupon_zero_policy').

create table if not exists public.discount_coupon_zero_batches (
    id              uuid primary key default gen_random_uuid(),
    created_at      timestamptz not null default now(),
    created_by      text,
    source          text not null default 'manual'
                        check (source in ('manual', 'year_end', 'lifespan')),
    scope_all       boolean not null default false,
    clinic_codes    text[] default null,
    issued_before   timestamptz,
    note            text,
    coupons         integer not null default 0,
    value_cleared   numeric(14, 2) not null default 0,
    reverted_at     timestamptz,
    reverted_by     text,
    restored        integer
);

create index if not exists discount_coupon_zero_batches_created_idx
    on public.discount_coupon_zero_batches (created_at desc);

create table if not exists public.discount_coupon_zero_rows (
    id           uuid primary key default gen_random_uuid(),
    batch_id     uuid not null references public.discount_coupon_zero_batches (id) on delete cascade,
    coupon_id    uuid not null,
    note_before  text
);

create index if not exists discount_coupon_zero_rows_batch_idx
    on public.discount_coupon_zero_rows (batch_id);

grant select on public.discount_coupon_zero_batches to anon, authenticated;
grant select on public.discount_coupon_zero_rows to anon, authenticated;

-- Void every live (unused, not expired) coupon in scope. Coupons belong to the clinic that issued them.
-- p_issued_before limits it to older coupons (year-end: issued before 1 Jan; lifespan: older than N months).
create or replace function public.dc_zero_coupons(
    p_all boolean default false,
    p_clinic_codes text[] default null,
    p_created_by text default null,
    p_note text default null,
    p_source text default 'manual',
    p_issued_before timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_note text := trim(coalesce(p_note, ''));
    v_source text := lower(trim(coalesce(p_source, 'manual')));
    v_codes text[];
    v_today date := (now() at time zone 'Asia/Hong_Kong')::date;
    v_batch_id uuid;
    v_count int := 0;
    v_value numeric(14, 2) := 0;
begin
    if length(v_note) < 1 then
        return jsonb_build_object('ok', false, 'error', 'note required');
    end if;
    if v_source not in ('manual', 'year_end', 'lifespan') then
        v_source := 'manual';
    end if;
    if p_clinic_codes is not null then
        select array_agg(distinct upper(trim(c))) into v_codes
          from unnest(p_clinic_codes) as c
         where length(trim(c)) > 0;
    end if;
    if not coalesce(p_all, false) and (v_codes is null or cardinality(v_codes) = 0) then
        return jsonb_build_object('ok', false, 'error', 'no clinics selected');
    end if;

    insert into public.discount_coupon_zero_batches (created_by, source, scope_all, clinic_codes, issued_before, note)
    values (p_created_by, v_source, coalesce(p_all, false),
            case when coalesce(p_all, false) then null else v_codes end, p_issued_before, v_note)
    returning id into v_batch_id;

    with hit as (
        select c.id, c.note, c.face_value, c.discount_mode
          from public.discount_coupons c
         where c.status = 'unused'
           and (c.expires_on is null or c.expires_on >= v_today)
           and (p_issued_before is null or c.issued_at < p_issued_before)
           and (coalesce(p_all, false) or upper(trim(coalesce(c.clinic_code, ''))) = any (v_codes))
         for update
    ), snap as (
        insert into public.discount_coupon_zero_rows (batch_id, coupon_id, note_before)
        select v_batch_id, h.id, h.note from hit h
        returning coupon_id
    ), upd as (
        update public.discount_coupons c
           set status = 'void',
               note = 'SET ZERO [batch ' || v_batch_id::text || ']'
          from hit h
         where c.id = h.id
        returning h.face_value, h.discount_mode
    )
    select count(*), coalesce(sum(case when discount_mode = 'amount' then face_value else 0 end), 0)
      into v_count, v_value
      from upd;

    update public.discount_coupon_zero_batches
       set coupons = v_count, value_cleared = v_value
     where id = v_batch_id;

    return jsonb_build_object('ok', true, 'batch_id', v_batch_id, 'coupons', v_count,
        'value_cleared', v_value, 'all', coalesce(p_all, false), 'source', v_source);
end;
$$;

grant execute on function public.dc_zero_coupons(boolean, text[], text, text, text, timestamptz)
    to anon, authenticated;

-- Step back: give the coupons of the last (or given) SET ZERO back, if still voided by that batch.
create or replace function public.dc_revert_zero_batch(
    p_batch_id uuid default null,
    p_created_by text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_batch public.discount_coupon_zero_batches;
    v_count int := 0;
begin
    if p_batch_id is null then
        select * into v_batch from public.discount_coupon_zero_batches
         where reverted_at is null order by created_at desc limit 1;
    else
        select * into v_batch from public.discount_coupon_zero_batches where id = p_batch_id;
    end if;
    if not found then
        return jsonb_build_object('ok', false, 'error', 'no batch to revert');
    end if;
    if v_batch.reverted_at is not null then
        return jsonb_build_object('ok', false, 'error', 'batch already reverted');
    end if;

    update public.discount_coupons c
       set status = 'unused', note = r.note_before
      from public.discount_coupon_zero_rows r
     where r.batch_id = v_batch.id
       and c.id = r.coupon_id
       and c.status = 'void'
       and c.note = 'SET ZERO [batch ' || v_batch.id::text || ']';
    get diagnostics v_count = row_count;

    update public.discount_coupon_zero_batches
       set reverted_at = now(), reverted_by = p_created_by, restored = v_count
     where id = v_batch.id;

    return jsonb_build_object('ok', true, 'batch_id', v_batch.id, 'coupons', v_count,
        'source', v_batch.source, 'created_at', v_batch.created_at);
end;
$$;

grant execute on function public.dc_revert_zero_batch(uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
