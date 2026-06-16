-- Ensure Realtime DELETE/UPDATE payloads include full row data (e.g. patient_id).
-- Required so cross-PC sync can match x-ray/photo deletes to the open patient.
-- Run once in Supabase SQL editor after realtime_publication.sql.

do $$
declare
    tbl text;
begin
    foreach tbl in array array[
        'xrays',
        'photos',
        'patient_documents',
        'dental_charts',
        'pending_bill_items',
        'treatments',
        'drughistory',
        'appointment_task_states'
    ]
    loop
        execute format('alter table public.%I replica identity full', tbl);
    end loop;
end $$;
