-- Refer a friend: one record per referred (new) patient.
-- The referrer is rewarded as soon as the friend's cash paid on one bill (full or part payments)
-- reaches the branch's "Min first-visit payment HK$ (full or part payment)": a discount coupon, or reward points (settings key reward_referral).
-- Voiding that bill, or voiding payments until it drops below the minimum, puts the record back to pending.
-- Run once in the Supabase SQL editor after discount_coupons.sql. Safe to re-run.

create table if not exists public.discount_coupon_referrals (
    id                   uuid primary key default gen_random_uuid(),
    referred_patient_id  uuid not null,
    referrer_patient_id  uuid not null,
    referred_no          text,
    referrer_no          text,
    reward_kind          text not null default 'coupon',
    points               numeric(12, 2),
    ledger_id            uuid,
    status               text not null default 'pending',
    reason               text,
    coupon_id            uuid,
    trigger_bill_id      uuid,
    clinic_code          text,
    created_by           text,
    created_at           timestamptz not null default now(),
    issued_at            timestamptz,
    updated_at           timestamptz not null default now(),
    constraint discount_coupon_referrals_one_per_friend unique (referred_patient_id),
    constraint discount_coupon_referrals_not_self check (referred_patient_id <> referrer_patient_id),
    constraint discount_coupon_referrals_status check (status in ('pending', 'issuing', 'issued', 'blocked', 'void'))
);

-- Reward branch: 'coupon' (discount coupon into the wallet) or 'points' (reward points via reward_adjust).
alter table public.discount_coupon_referrals add column if not exists reward_kind text not null default 'coupon';
alter table public.discount_coupon_referrals add column if not exists points numeric(12, 2);
alter table public.discount_coupon_referrals add column if not exists ledger_id uuid;
alter table public.discount_coupon_referrals drop constraint if exists discount_coupon_referrals_kind;
alter table public.discount_coupon_referrals
    add constraint discount_coupon_referrals_kind check (reward_kind in ('coupon', 'points'));

create index if not exists discount_coupon_referrals_referrer_idx
    on public.discount_coupon_referrals (referrer_patient_id, status);
create index if not exists discount_coupon_referrals_bill_idx
    on public.discount_coupon_referrals (trigger_bill_id);
create index if not exists discount_coupons_origin_bill_idx
    on public.discount_coupons (origin_bill_id);
