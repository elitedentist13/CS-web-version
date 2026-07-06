-- Walk-in phone from the appointment modal (New patient tab).
-- Run once in Supabase SQL editor.

alter table public.appointments
    add column if not exists walk_in_phone text;

comment on column public.appointments.walk_in_phone is
    'Phone entered for a walk-in booking before a patient record exists. Prefills New Patient registration.';
