-- Patch: void payment must reverse ALL ledger rows for that payment
-- (multi-chart redeem creates one redeem row per source chart).
-- Previously reward_void_for_payment only reversed the newest row (LIMIT 1),
-- so deleting a Reward points payment in history left other charts unrestored.
-- Bill void already loops every row — this aligns payment void with that behavior.
-- Run in Supabase SQL editor. Safe to re-run.

alter table public.reward_ledger
    add column if not exists doctor_name text;

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
    v_parts jsonb := '[]'::jsonb;
begin
    if p_bill_payment_id is null then
        return jsonb_build_object('ok', false, 'error', 'bill_payment_id required');
    end if;

    -- Reverse every unreversed earn/redeem on this payment.
    -- Redeem first (restore points), then earn (remove points), matching bill void.
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
        -- Payment void should restore points even if later spent elsewhere.
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
            doctor_name, note, created_by, created_at, reverses_ledger_id
        ) values (
            v_acc.id, v_src.patient_id, v_rev_kind, v_delta, v_new_bal,
            v_src.earn_rate_percent, v_src.eligible_amount,
            v_src.bill_id, p_bill_payment_id, v_src.clinic_id, v_src.clinic_code,
            v_src.doctor_name,
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
        v_parts := v_parts || jsonb_build_array(jsonb_build_object(
            'ledger_id', v_ledger.id,
            'account_id', v_acc.id,
            'patient_id', v_src.patient_id,
            'kind', v_rev_kind,
            'points', v_delta,
            'balance', v_new_bal
        ));
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
        'patient_id', v_patient,
        'parts', v_parts
    );
end;
$$;

grant execute on function public.reward_void_for_payment(uuid, text, text) to anon, authenticated;

comment on function public.reward_void_for_payment(uuid, text, text) is
    'Reverse all unreversed earn/redeem ledger rows for a bill payment (supports multi-chart redeem).';
