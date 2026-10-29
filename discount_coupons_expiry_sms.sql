-- Discount coupons: expiry reminder SMS, 1 month and 7 days before expiry.
-- A station claims a coupon by stamping expiry_sms_month_at / expiry_sms_at before it texts, so each
-- coupon is reminded once per window even when several stations are open.
-- Run in the Supabase SQL editor (safe to re-run). Until a column exists, that reminder is not sent.

alter table public.discount_coupons
    add column if not exists expiry_sms_at timestamptz;

alter table public.discount_coupons
    add column if not exists expiry_sms_month_at timestamptz;

create index if not exists discount_coupons_expiry_sms_idx
    on public.discount_coupons (expires_on)
    where status = 'unused' and expiry_sms_at is null;

create index if not exists discount_coupons_expiry_sms_month_idx
    on public.discount_coupons (expires_on)
    where status = 'unused' and expiry_sms_month_at is null;
