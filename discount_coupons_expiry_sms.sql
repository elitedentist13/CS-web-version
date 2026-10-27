-- Discount coupons: 7-day expiry reminder SMS.
-- A station claims a coupon by stamping expiry_sms_at before it texts, so each
-- coupon is reminded once even when several stations are open.
-- Run once in the Supabase SQL editor. Until it runs, no reminders are sent.

alter table public.discount_coupons
    add column if not exists expiry_sms_at timestamptz;

create index if not exists discount_coupons_expiry_sms_idx
    on public.discount_coupons (expires_on)
    where status = 'unused' and expiry_sms_at is null;
