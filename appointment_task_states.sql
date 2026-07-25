-- Persistent Lab / Recall mini capsule state for appointment rows.
-- Run once in Supabase SQL editor.

create table if not exists public.appointment_task_states (
    appointment_id uuid primary key references public.appointments (id) on delete cascade,
    lab_status text not null default 'na'
        check (lab_status in ('na', 'pending', 'back')),
    recall_status text not null default ''
        check (recall_status in ('', 'success', 'cant', 'whatsapp', 'voice', 'cancel')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists appointment_task_states_updated_at_idx
    on public.appointment_task_states (updated_at desc);

create or replace function public.appointment_task_states_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists appointment_task_states_touch_updated_at
    on public.appointment_task_states;

create trigger appointment_task_states_touch_updated_at
before update on public.appointment_task_states
for each row
execute function public.appointment_task_states_touch_updated_at();

grant select, insert, update, delete on public.appointment_task_states to anon, authenticated;

-- If table already exists, run once in SQL editor:
-- alter table public.appointment_task_states
--     drop constraint if exists appointment_task_states_recall_status_check;
-- alter table public.appointment_task_states
--     add constraint appointment_task_states_recall_status_check
--     check (recall_status in ('', 'success', 'cant', 'whatsapp', 'voice', 'cancel'));
