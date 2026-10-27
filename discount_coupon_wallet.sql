-- Patient coupon wallet on the phone (browse only).
-- The clinic shows a QR code; the phone opens wallet.html?t=<token> and sees that patient's coupons.
-- Tokens are 32 hex characters from gen_random_uuid() (built into Postgres 13+, no extension or schema path needed).
-- The table is closed to the app key; only the two functions below touch it.
-- Run in Supabase → SQL Editor (after discount_coupons.sql). Safe to run again.

create table if not exists public.discount_coupon_wallet_links (
    token           text primary key,
    patient_id      uuid not null,
    created_at      timestamptz not null default now(),
    created_by      text,
    expires_at      timestamptz not null default (now() + interval '365 days'),
    revoked_at      timestamptz,
    view_count      integer not null default 0,
    last_viewed_at  timestamptz
);

create index if not exists discount_coupon_wallet_links_patient_idx
    on public.discount_coupon_wallet_links (patient_id);

alter table public.discount_coupon_wallet_links enable row level security;
revoke all on public.discount_coupon_wallet_links from anon, authenticated;

-- Staff app: get the patient's live wallet link, or make a new one (p_reset = true stops the old QR working).
create or replace function public.dc_wallet_link(
    p_patient_id uuid,
    p_by text default null,
    p_reset boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row public.discount_coupon_wallet_links;
begin
    if p_patient_id is null or not exists (select 1 from public.patients where id = p_patient_id) then
        return jsonb_build_object('ok', false, 'reason', 'no_patient');
    end if;
    if p_reset then
        update public.discount_coupon_wallet_links
           set revoked_at = now()
         where patient_id = p_patient_id and revoked_at is null;
    else
        select * into v_row
          from public.discount_coupon_wallet_links
         where patient_id = p_patient_id and revoked_at is null and expires_at > now() + interval '30 days'
         order by created_at desc
         limit 1;
    end if;
    if v_row.token is null then
        insert into public.discount_coupon_wallet_links (token, patient_id, created_by)
        values (replace(gen_random_uuid()::text, '-', ''), p_patient_id, left(coalesce(p_by, ''), 80))
        returning * into v_row;
    end if;
    return jsonb_build_object('ok', true, 'token', v_row.token, 'expires_at', v_row.expires_at);
end;
$$;

-- Phone: read-only view of one wallet. Returns a masked name and coupon facts only — no ids, bills or phone numbers.
create or replace function public.dc_wallet_view(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_link public.discount_coupon_wallet_links;
    v_name text;
    v_masked text;
    v_coupons jsonb;
    v_names jsonb;
begin
    if p_token is null or p_token !~ '^[0-9a-f]{32}$' then
        return jsonb_build_object('ok', false, 'reason', 'bad_link');
    end if;
    select * into v_link from public.discount_coupon_wallet_links where token = p_token;
    if v_link.token is null or v_link.revoked_at is not null then
        return jsonb_build_object('ok', false, 'reason', 'bad_link');
    end if;
    if v_link.expires_at <= now() then
        return jsonb_build_object('ok', false, 'reason', 'expired');
    end if;

    update public.discount_coupon_wallet_links
       set view_count = view_count + 1, last_viewed_at = now()
     where token = p_token;

    select coalesce(nullif(trim(p.chinese_name), ''), nullif(trim(p.full_name), ''), '')
      into v_name
      from public.patients p where p.id = v_link.patient_id;
    if v_name ~ '[一-鿿]' then
        v_masked := left(regexp_replace(v_name, '\s+', '', 'g'), 1) ||
            repeat('○', greatest(char_length(regexp_replace(v_name, '\s+', '', 'g')) - 1, 0));
    elsif v_name <> '' then
        select string_agg(upper(left(w, 1)) || '.', ' ') into v_masked
          from regexp_split_to_table(v_name, '\s+') as w where w <> '';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
               'code', c.code,
               'campaign_key', c.campaign_key,
               'discount_mode', c.discount_mode,
               'face_value', c.face_value,
               'percent', c.percent,
               'min_spend', c.min_spend,
               'max_discount', c.max_discount,
               'status', c.status,
               'expires_on', c.expires_on,
               'issued_at', c.issued_at,
               'redeemed_at', c.redeemed_at,
               'redeemed_amount', c.redeemed_amount,
               'item_names', c.item_names
           ) order by (c.status = 'unused') desc, c.expires_on nulls last, c.issued_at desc), '[]'::jsonb)
      into v_coupons
      from public.discount_coupons c
     where c.patient_id = v_link.patient_id
       and c.status not in ('void', 'transferred')
       and (c.status = 'unused' or coalesce(c.redeemed_at, c.issued_at) > now() - interval '365 days');

    begin
        select coalesce(jsonb_agg(jsonb_build_object(
                   'key', e->>'key', 'name', e->>'name', 'nameZh', e->>'nameZh',
                   'trigger', e->>'trigger', 'target', e->'target', 'face', e->'face')), '[]'::jsonb)
          into v_names
          from public.program_settings s,
               jsonb_array_elements(coalesce(s.setting_value::jsonb -> 'campaigns', '[]'::jsonb)) e
         where s.setting_key = 'discount_coupon_scheme';
    exception when others then
        v_names := '[]'::jsonb;
    end;

    return jsonb_build_object(
        'ok', true,
        'name', coalesce(v_masked, ''),
        'today', (now() at time zone 'Asia/Hong_Kong')::date,
        'coupons', v_coupons,
        'campaigns', coalesce(v_names, '[]'::jsonb)
    );
end;
$$;

revoke all on function public.dc_wallet_link(uuid, text, boolean) from public;
revoke all on function public.dc_wallet_view(text) from public;
grant execute on function public.dc_wallet_link(uuid, text, boolean) to anon, authenticated, service_role;
grant execute on function public.dc_wallet_view(text) to anon, authenticated, service_role;

-- Let the API see the new functions straight away.
notify pgrst, 'reload schema';
