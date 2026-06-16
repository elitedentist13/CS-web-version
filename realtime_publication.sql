-- Enable Supabase Realtime for cross-PC clinic sync.
-- Run once in Supabase SQL editor (Dashboard → SQL → New query).
-- Safe to re-run: skips tables already in the publication.

do $$
declare
    tbl text;
begin
    foreach tbl in array array[
        'appointments',
        'appointment_task_states',
        'bills',
        'bill_payments',
        'patients',
        'treatments',
        'drughistory',
        'pending_bill_items',
        'photos',
        'xrays',
        'patient_documents',
        'dental_charts'
    ]
    loop
        if not exists (
            select 1
            from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = tbl
        ) then
            execute format(
                'alter publication supabase_realtime add table public.%I',
                tbl
            );
        end if;
    end loop;
end $$;

-- See realtime_replica_identity.sql — run that next so DELETE events include patient_id.
