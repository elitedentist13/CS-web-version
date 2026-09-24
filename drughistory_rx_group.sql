-- Consultation → Medication: link each drughistory row to its prescription and catalog drug.
-- Apply in Supabase SQL Editor. Safe to re-run.
--
-- rx_group_id : one id per saved prescription, so two prescriptions on the same day by the
--               same doctor stay separate in the history panel and Replace/Delete-all only
--               touch that prescription.
-- drug_id     : druglist.id at time of prescribing (text, so it works whatever druglist.id type is).
--
-- The app keeps working without these columns (it falls back to date + doctor grouping).

alter table public.drughistory add column if not exists rx_group_id uuid;
alter table public.drughistory add column if not exists drug_id text;

create index if not exists drughistory_rx_group_id_idx
    on public.drughistory (rx_group_id);

create index if not exists drughistory_patient_date_idx
    on public.drughistory (patient_id, prescribed_date desc);

comment on column public.drughistory.rx_group_id is
    'Prescription id shared by all drug rows saved together (Consultation Medication panel)';

comment on column public.drughistory.drug_id is
    'druglist.id of the prescribed drug (nullable for imported / legacy rows)';
