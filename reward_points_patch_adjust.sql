-- Patch: Admin manual balance adjust (delta). Safe to re-run.
-- Enforce Admin in the Banana UI (anon key cannot verify role in SQL).

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
