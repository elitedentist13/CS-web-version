-- Online booking — per clinic+doctor session time windows & slot interval
-- Run once in Supabase SQL Editor (after online_booking_roster.sql).
-- Stores AM/PM/Night start/end and slot interval (15/30/45/60 min) on roster profile.

alter table public.online_booking_roster_profile
    add column if not exists session_am_start time default '10:30',
    add column if not exists session_am_end time default '13:00',
    add column if not exists session_pm_start time default '14:30',
    add column if not exists session_pm_end time default '19:30',
    add column if not exists session_pm_end_weekend time default '18:30',
    add column if not exists session_night_start time default '21:00',
    add column if not exists session_night_end time default '23:30',
    add column if not exists slot_interval int default 30;

comment on column public.online_booking_roster_profile.session_am_start is 'AM session start (online booking slots)';
comment on column public.online_booking_roster_profile.session_am_end is 'AM session end';
comment on column public.online_booking_roster_profile.session_pm_start is 'PM session start';
comment on column public.online_booking_roster_profile.session_pm_end is 'PM session end on weekdays';
comment on column public.online_booking_roster_profile.session_pm_end_weekend is 'PM session end on Sat/Sun and red public holidays';
comment on column public.online_booking_roster_profile.session_night_start is 'Night session start';
comment on column public.online_booking_roster_profile.session_night_end is 'Night session end';
comment on column public.online_booking_roster_profile.slot_interval is 'Online booking slot step in minutes (15, 30, 45, or 60)';

-- ── Resolved session windows for a clinic+doctor (defaults when no profile row) ──
create or replace function public.ob_roster_session_times(
    p_clinic_tag text,
    p_doctor_code text,
    p_date date default current_date
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
    v_clinic text := nullif(trim(p_clinic_tag), '');
    v_doctor text := nullif(trim(p_doctor_code), '');
    v_prof record;
    v_am_start time := time '10:30';
    v_am_end time := time '13:00';
    v_pm_start time := time '14:30';
    v_pm_end time := time '19:30';
    v_pm_end_we time := time '18:30';
    v_night_start time := time '21:00';
    v_night_end time := time '23:30';
    v_slot int := 30;
    v_pm_end_today time;
begin
    if v_doctor is not null then
        select * into v_prof
          from public.online_booking_roster_profile rp
         where rp.doctor_code = v_doctor
           and (v_clinic is null or rp.clinic_tag = v_clinic)
         order by case when rp.clinic_tag = v_clinic then 0 else 1 end
         limit 1;

        if found then
            v_am_start := coalesce(v_prof.session_am_start, v_am_start);
            v_am_end := coalesce(v_prof.session_am_end, v_am_end);
            v_pm_start := coalesce(v_prof.session_pm_start, v_pm_start);
            v_pm_end := coalesce(v_prof.session_pm_end, v_pm_end);
            v_pm_end_we := coalesce(v_prof.session_pm_end_weekend, v_pm_end_we);
            v_night_start := coalesce(v_prof.session_night_start, v_night_start);
            v_night_end := coalesce(v_prof.session_night_end, v_night_end);
            v_slot := coalesce(nullif(v_prof.slot_interval, 0), 30);
            if v_slot not in (15, 30, 45, 60) then
                v_slot := 30;
            end if;
        end if;
    end if;

    if p_date is not null and public.ob_is_weekend_or_red_holiday(p_date) then
        v_pm_end_today := v_pm_end_we;
    else
        v_pm_end_today := v_pm_end;
    end if;

    return jsonb_build_object(
        'am_start', to_char(v_am_start, 'HH24:MI'),
        'am_end', to_char(v_am_end, 'HH24:MI'),
        'pm_start', to_char(v_pm_start, 'HH24:MI'),
        'pm_end', to_char(v_pm_end_today, 'HH24:MI'),
        'pm_end_weekday', to_char(v_pm_end, 'HH24:MI'),
        'pm_end_weekend', to_char(v_pm_end_we, 'HH24:MI'),
        'night_start', to_char(v_night_start, 'HH24:MI'),
        'night_end', to_char(v_night_end, 'HH24:MI'),
        'slot_interval', v_slot
    );
end;
$$;

-- ── Sessions for a duty date (enabled flags + time windows) ─────
create or replace function public.ob_get_roster_sessions(
    p_clinic_tag text,
    p_doctor_code text,
    p_date date
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
    v_clinic text := nullif(trim(p_clinic_tag), '');
    v_doctor text := nullif(trim(p_doctor_code), '');
    v_prof record;
    v_pat record;
    v_man record;
    v_dow int;
    v_am boolean;
    v_pm boolean;
    v_night boolean;
    v_times jsonb;
begin
    v_times := public.ob_roster_session_times(p_clinic_tag, p_doctor_code, p_date);

    if v_doctor is null or p_date is null then
        return v_times || jsonb_build_object('am', false, 'pm', false, 'night', false);
    end if;

    if not public.ob_is_on_duty(p_clinic_tag, p_doctor_code, p_date) then
        return v_times || jsonb_build_object('am', false, 'pm', false, 'night', false);
    end if;

    select * into v_prof
      from public.online_booking_roster_profile rp
     where rp.doctor_code = v_doctor
       and (v_clinic is null or rp.clinic_tag = v_clinic)
     order by case when rp.clinic_tag = v_clinic then 0 else 1 end
     limit 1;

    if not found then
        return v_times || jsonb_build_object('am', true, 'pm', true, 'night', false);
    end if;

    if v_prof.mode = 'manual' then
        select * into v_man
          from public.online_booking_roster_dates d
         where d.clinic_tag = v_prof.clinic_tag
           and d.doctor_code = v_prof.doctor_code
           and d.duty_date = p_date
           and d.enabled is distinct from false
         limit 1;
        if not found then
            return v_times || jsonb_build_object('am', true, 'pm', true, 'night', false);
        end if;
        v_am := coalesce(v_man.session_am, true);
        v_pm := coalesce(v_man.session_pm, true);
        v_night := coalesce(v_man.session_night, false);
    else
        v_dow := extract(dow from p_date)::int;
        select * into v_pat
          from public.online_booking_roster_pattern p
         where p.clinic_tag = v_prof.clinic_tag
           and p.doctor_code = v_prof.doctor_code
           and p.day_of_week = v_dow;
        if not found then
            return v_times || jsonb_build_object('am', true, 'pm', true, 'night', false);
        end if;
        v_am := coalesce(v_pat.session_am, true);
        v_pm := coalesce(v_pat.session_pm, true);
        v_night := coalesce(v_pat.session_night, false);
    end if;

    if not coalesce(v_am, false) and not coalesce(v_pm, false) and not coalesce(v_night, false) then
        v_am := true;
        v_pm := true;
        v_night := false;
    end if;

    return v_times || jsonb_build_object('am', v_am, 'pm', v_pm, 'night', v_night);
end;
$$;

drop function if exists public.ob_time_allowed_in_sessions(time, int, jsonb);

create or replace function public.ob_time_allowed_in_sessions(
    p_start_time time,
    p_duration int,
    p_sessions jsonb,
    p_date date default null
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
    v_dur int := coalesce(nullif(p_duration, 0), 30);
    v_am_start time := coalesce(
        nullif(left(coalesce(p_sessions->>'am_start', ''), 5), '')::time,
        time '10:30'
    );
    v_am_end time := coalesce(
        nullif(left(coalesce(p_sessions->>'am_end', ''), 5), '')::time,
        time '13:00'
    );
    v_pm_start time := coalesce(
        nullif(left(coalesce(p_sessions->>'pm_start', ''), 5), '')::time,
        time '14:30'
    );
    v_pm_end time;
    v_night_start time := coalesce(
        nullif(left(coalesce(p_sessions->>'night_start', ''), 5), '')::time,
        time '21:00'
    );
    v_night_end time := coalesce(
        nullif(left(coalesce(p_sessions->>'night_end', ''), 5), '')::time,
        time '23:30'
    );
begin
    v_pm_end := coalesce(
        nullif(left(coalesce(p_sessions->>'pm_end', ''), 5), '')::time,
        public.ob_pm_session_end(p_date)
    );

    return coalesce(
        (coalesce((p_sessions->>'am')::boolean, false)
            and p_start_time >= v_am_start
            and p_start_time + make_interval(mins => v_dur) <= v_am_end)
        or (coalesce((p_sessions->>'pm')::boolean, false)
            and p_start_time >= v_pm_start
            and p_start_time + make_interval(mins => v_dur) <= v_pm_end)
        or (coalesce((p_sessions->>'night')::boolean, false)
            and p_start_time >= v_night_start
            and p_start_time + make_interval(mins => v_dur) <= v_night_end),
        false
    );
end;
$$;

grant execute on function public.ob_roster_session_times(text, text, date) to anon, authenticated, service_role;
grant execute on function public.ob_get_roster_sessions(text, text, date) to anon, authenticated, service_role;
grant execute on function public.ob_time_allowed_in_sessions(time, int, jsonb, date) to anon, authenticated, service_role;

-- ── Generate candidate slot start times from roster session windows ──
create or replace function public.ob_session_slot_times(
    p_sessions jsonb,
    p_interval int,
    p_duration int,
    p_session_filter text default null
)
returns text[]
language plpgsql
stable
set search_path = public
as $$
declare
    keys text[] := array['am', 'pm', 'night'];
    k text;
    v_start time;
    v_end time;
    v_cur time;
    v_dur int := coalesce(nullif(p_duration, 0), 30);
    v_step int := coalesce(nullif(p_interval, 0), 30);
    out text[] := '{}';
    v_enabled boolean;
    v_filter text := nullif(lower(trim(coalesce(p_session_filter, ''))), '');
begin
    if v_step not in (15, 30, 45, 60) then
        v_step := 30;
    end if;
    if v_filter is not null then
        keys := array[v_filter];
    end if;

    foreach k in array keys loop
        v_enabled := coalesce((p_sessions->>k)::boolean, false);
        if not v_enabled then
            continue;
        end if;

        v_start := coalesce(
            nullif(left(coalesce(p_sessions->>(k || '_start'), ''), 5), '')::time,
            case k
                when 'am' then time '10:30'
                when 'pm' then time '14:30'
                else time '21:00'
            end
        );

        if k = 'pm' then
            v_end := coalesce(
                nullif(left(coalesce(p_sessions->>'pm_end', ''), 5), '')::time,
                time '19:30'
            );
        elsif k = 'am' then
            v_end := coalesce(
                nullif(left(coalesce(p_sessions->>'am_end', ''), 5), '')::time,
                time '13:00'
            );
        else
            v_end := coalesce(
                nullif(left(coalesce(p_sessions->>'night_end', ''), 5), '')::time,
                time '23:30'
            );
        end if;

        v_cur := v_start;
        while v_cur + make_interval(mins => v_dur) <= v_end loop
            out := array_append(out, to_char(v_cur, 'HH24:MI'));
            v_cur := v_cur + make_interval(mins => v_step);
        end loop;
    end loop;

    return out;
end;
$$;

-- ── Public booking slots (roster profile interval + session windows; all months) ──
create or replace function public.ob_get_booking_slots(
    p_clinic_tag text default null,
    p_doctor_code text default null,
    p_date date default null,
    p_duration int default 30,
    p_session text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_doctor text := nullif(trim(p_doctor_code), '');
    v_clinic text := nullif(trim(p_clinic_tag), '');
    v_date date := p_date;
    v_dur int := coalesce(nullif(p_duration, 0), 30);
    v_sessions jsonb;
    v_interval int;
    v_candidates text[];
    v_slot text;
    v_start time;
    v_end time;
    v_free text[] := '{}';
    v_lead int := 2;
    v_cutoff time;
begin
    if v_doctor is null or v_date is null then
        return jsonb_build_object('slots', '[]'::jsonb, 'sessions', '{}'::jsonb, 'interval', 30);
    end if;

    if not public.ob_is_on_duty(v_clinic, v_doctor, v_date) then
        return jsonb_build_object('slots', '[]'::jsonb, 'sessions', '{}'::jsonb, 'interval', 30);
    end if;

    v_sessions := public.ob_get_roster_sessions(v_clinic, v_doctor, v_date);
    v_interval := coalesce(nullif((v_sessions->>'slot_interval')::int, 0), 30);
    if v_interval not in (15, 30, 45, 60) then
        v_interval := 30;
    end if;

    v_candidates := public.ob_session_slot_times(v_sessions, v_interval, v_dur, p_session);

    if v_date = current_date then
        v_cutoff := (current_time + make_interval(hours => v_lead))::time;
    end if;

    foreach v_slot in array v_candidates loop
        if v_date = current_date and v_cutoff is not null and v_slot::time < v_cutoff then
            continue;
        end if;

        v_start := v_slot::time;
        v_end := v_start + make_interval(mins => v_dur);

        if exists (
            select 1
              from public.appointments a
             where a.date = v_date
               and a.doctor_code = v_doctor
               and (v_clinic is null or a.clinic_tag is null or a.clinic_tag = v_clinic)
               and coalesce(lower(a.bill_status), '') not like '%cancel%'
               and coalesce(lower(a.booking_status), '') not in ('cancelled', 'expired', 'pending_arrange')
               and a.start_time is not null
               and a.start_time < v_end
               and coalesce(
                   a.end_time,
                   a.start_time + make_interval(mins => coalesce(nullif(a.duration, 0), v_dur))
               ) > v_start
        ) then
            continue;
        end if;

        v_free := array_append(v_free, v_slot);
    end loop;

    return jsonb_build_object(
        'slots', coalesce(to_jsonb(v_free), '[]'::jsonb),
        'sessions', v_sessions,
        'interval', v_interval,
        'duration', v_dur
    );
end;
$$;

revoke all on function public.ob_get_booking_slots(text, text, date, int, text) from public;
grant execute on function public.ob_session_slot_times(jsonb, int, int, text) to anon, authenticated, service_role;
grant execute on function public.ob_get_booking_slots(text, text, date, int, text) to anon, authenticated, service_role;

-- Optional: update column default for new profile rows (does not change existing saved values)
alter table public.online_booking_roster_profile alter column session_am_start set default '10:30';

-- Migrate profiles still on the old system default AM start (10:00 → 10:30)
update public.online_booking_roster_profile
   set session_am_start = time '10:30'
 where session_am_start = time '10:00';
