-- Patch: store doctor name on reward ledger rows (for ledger table "Dr Name" column).
-- Clinic tag/code is already on reward_ledger.clinic_code.
-- App rule: earn/redeem stamps the active bill doctor (e.g. "Dr Ng Pui Ching");
-- redeemable balance is same-doctor only (client enforces via ledger nets).
-- Run in Supabase SQL editor. Safe to re-run.

alter table public.reward_ledger
    add column if not exists doctor_name text;

comment on column public.reward_ledger.doctor_name is
    'Treating doctor at earn/redeem (canonical label, e.g. Dr Ng Pui Ching). Same-Dr redeem.';

create index if not exists reward_ledger_doctor_name_idx
    on public.reward_ledger (doctor_name)
    where doctor_name is not null and doctor_name <> '';
