-- Discount coupons. Independent of reward points.
-- Default: KT clinic joined. Every other clinic is off. Every campaign is off
-- until an admin turns it on in Configuration → Discount Coupons.
-- Run once in the Supabase SQL editor.

create table if not exists public.discount_coupon_clinics (
    clinic_id    uuid primary key,
    clinic_code  text not null,
    joined       boolean not null default false,
    updated_at   timestamptz not null default now()
);

create table if not exists public.discount_coupon_doctors (
    id           uuid primary key default gen_random_uuid(),
    clinic_id    uuid not null,
    clinic_code  text not null,
    doctor_key   text not null,
    doctor_id    uuid,
    doctor_label text,
    joined       boolean not null default false,
    updated_at   timestamptz not null default now(),
    unique (clinic_id, doctor_key)
);

create table if not exists public.discount_coupon_campaigns (
    type_key       text primary key,
    enabled        boolean not null default false,
    face_value     numeric(12, 2) not null default 0,
    discount_mode  text not null default 'amount',
    percent        numeric(8, 2) not null default 0,
    min_spend      numeric(12, 2) not null default 0,
    target_amount  numeric(12, 2) not null default 0,
    expiry_days    integer not null default 90,
    max_discount   numeric(12, 2) not null default 0,
    issue_cap      integer not null default 0,
    budget_hkd     numeric(12, 2) not null default 0,
    issued_count   integer not null default 0,
    budget_used    numeric(12, 2) not null default 0,
    item_names     jsonb,
    updated_at     timestamptz not null default now()
);

create table if not exists public.discount_coupons (
    id               uuid primary key default gen_random_uuid(),
    code             text not null unique,
    campaign_key     text not null,
    patient_id       uuid not null,
    face_value       numeric(12, 2) not null default 0,
    discount_mode    text not null default 'amount',
    percent          numeric(8, 2) not null default 0,
    min_spend        numeric(12, 2) not null default 0,
    max_discount     numeric(12, 2) not null default 0,
    status           text not null default 'unused',
    expires_on       date,
    issued_at        timestamptz not null default now(),
    issued_by        text,
    clinic_code      text,
    origin_bill_id   uuid,
    bill_id          uuid,
    redeemed_amount  numeric(12, 2),
    redeemed_at      timestamptz,
    item_names       jsonb,
    line_name        text,
    note             text
);

create index if not exists discount_coupons_patient_idx
    on public.discount_coupons (patient_id, status);

alter table public.bills
    add column if not exists coupon_id uuid,
    add column if not exists coupon_amount numeric(12, 2) not null default 0;

-- KT joined. Other clinics stay off until an admin ticks them.
insert into public.discount_coupon_clinics (clinic_id, clinic_code, joined)
select c.id, c.clinic_code, (upper(c.clinic_code) = 'KT')
from public.clinics c
on conflict (clinic_id) do nothing;
