-- Online booking hours: 10:00–19:00, lunch break 13:00–15:00
-- Run once in Supabase SQL editor if online_booking_rules already exists.

alter table public.online_booking_rules
    add column if not exists lunch_start time default '13:00',
    add column if not exists lunch_end time default '15:00';

update public.online_booking_rules
set
    start_time = '10:00',
    end_time = '19:00',
    lunch_start = coalesce(lunch_start, '13:00'::time),
    lunch_end = coalesce(lunch_end, '15:00'::time);

alter table public.online_booking_rules
    alter column start_time set default '10:00',
    alter column end_time set default '19:00';
