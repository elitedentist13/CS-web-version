-- Doctor roster for online booking — run once in Supabase SQL editor (after online_booking.sql).
-- Pattern mode: weekly on-duty days + optional per-day alternate (A/B) weeks.
-- Manual mode: tick exact dates per month.

-- ── Profile: one row per clinic + doctor ────────────────────────
create table if not exists public.online_booking_roster_profile (
    id uuid primary key default gen_random_uuid(),
    clinic_tag text not null,
    doctor_code text not null,
    mode text not null default 'pattern' check (mode in ('pattern', 'manual')),
    anchor_date date default current_date,
    session_am_start time default '10:00',
    session_am_end time default '13:00',
    session_pm_start time default '14:30',
    session_pm_end time default '19:30',
    session_pm_end_weekend time default '18:30',
    session_night_start time default '21:00',
    session_night_end time default '23:30',
    slot_interval int default 30,
    updated_at timestamptz default now(),
    unique (clinic_tag, doctor_code)
);

comment on table public.online_booking_roster_profile is 'Online booking roster mode per clinic+doctor';
comment on column public.online_booking_roster_profile.mode is 'pattern = weekly/alternate grid; manual = per-date ticks';
comment on column public.online_booking_roster_profile.anchor_date is 'Monday-containing week that starts Week A (for alternate weekdays)';

alter table public.online_booking_roster_profile
    add column if not exists session_am_start time default '10:00',
    add column if not exists session_am_end time default '13:00',
    add column if not exists session_pm_start time default '14:30',
    add column if not exists session_pm_end time default '19:30',
    add column if not exists session_pm_end_weekend time default '18:30',
    add column if not exists session_night_start time default '21:00',
    add column if not exists session_night_end time default '23:30',
    add column if not exists slot_interval int default 30;

-- ── Pattern: Mon–Sun on-duty + optional alternate per day ───────
create table if not exists public.online_booking_roster_pattern (
    id uuid primary key default gen_random_uuid(),
    clinic_tag text not null,
    doctor_code text not null,
    day_of_week int not null check (day_of_week between 0 and 6),
    on_duty boolean not null default false,
    alternate boolean not null default false,
    session_am boolean not null default true,
    session_pm boolean not null default true,
    session_night boolean not null default false,
    unique (clinic_tag, doctor_code, day_of_week)
);

comment on column public.online_booking_roster_pattern.day_of_week is '0=Sun … 6=Sat (same as PostgreSQL EXTRACT(DOW))';

-- ── Manual: exact duty dates ────────────────────────────────────
create table if not exists public.online_booking_roster_dates (
    id uuid primary key default gen_random_uuid(),
    clinic_tag text not null,
    doctor_code text not null,
    duty_date date not null,
    enabled boolean not null default true,
    session_am boolean not null default true,
    session_pm boolean not null default true,
    session_night boolean not null default false,
    unique (clinic_tag, doctor_code, duty_date)
);

-- Migration for databases created before session columns existed
alter table public.online_booking_roster_pattern
    add column if not exists session_am boolean not null default true,
    add column if not exists session_pm boolean not null default true,
    add column if not exists session_night boolean not null default false;

alter table public.online_booking_roster_dates
    add column if not exists session_am boolean not null default true,
    add column if not exists session_pm boolean not null default true,
    add column if not exists session_night boolean not null default false;

create index if not exists idx_ob_roster_dates_lookup
    on public.online_booking_roster_dates (clinic_tag, doctor_code, duty_date);

-- ── Red public holidays (HK general holidays; add future years as needed) ─
create table if not exists public.online_booking_public_holidays (
    holiday_date date primary key,
    name text,
    enabled boolean not null default true
);

comment on table public.online_booking_public_holidays is 'HK red public holidays — PM session ends 18:30 on these dates and weekends';

insert into public.online_booking_public_holidays (holiday_date, name) values
    ('2026-01-01', 'New Year''s Day'),
    ('2026-02-17', 'Lunar New Year''s Day'),
    ('2026-02-18', 'Second day of Lunar New Year'),
    ('2026-02-19', 'Third day of Lunar New Year'),
    ('2026-04-03', 'Good Friday'),
    ('2026-04-04', 'Day following Good Friday'),
    ('2026-04-06', 'Day following Ching Ming Festival'),
    ('2026-04-07', 'Day following Easter Monday'),
    ('2026-05-01', 'Labour Day'),
    ('2026-05-25', 'Day following Birthday of the Buddha'),
    ('2026-06-19', 'Tuen Ng Festival'),
    ('2026-07-01', 'HKSAR Establishment Day'),
    ('2026-09-26', 'Day following Mid-Autumn Festival'),
    ('2026-10-01', 'National Day'),
    ('2026-10-19', 'Day following Chung Yeung Festival'),
    ('2026-12-25', 'Christmas Day'),
    ('2026-12-26', 'First weekday after Christmas Day')
on conflict (holiday_date) do nothing;

grant select on public.online_booking_public_holidays to anon, authenticated, service_role;
grant insert, update, delete on public.online_booking_public_holidays to authenticated, service_role;

-- ── Helper: Monday on or before a date ──────────────────────────
create or replace function public.ob_roster_monday(p_date date)
returns date
language sql
immutable
as $$
    select (p_date - ((extract(dow from p_date)::int + 6) % 7))::date;
$$;

-- ── Core: is doctor on duty? (legacy rules fallback if no profile) ─
create or replace function public.ob_is_on_duty(
    p_clinic_tag text,
    p_doctor_code text,
    p_date date
)
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
    v_clinic text := nullif(trim(p_clinic_tag), '');
    v_doctor text := nullif(trim(p_doctor_code), '');
    v_dow int;
    v_prof record;
    v_pat record;
    v_weeks int;
    v_legacy boolean := false;
begin
    if v_doctor is null or p_date is null then
        return false;
    end if;

    select * into v_prof
      from public.online_booking_roster_profile rp
     where rp.doctor_code = v_doctor
       and (v_clinic is null or rp.clinic_tag = v_clinic)
     order by case when rp.clinic_tag = v_clinic then 0 else 1 end
     limit 1;

    if not found then
        -- Legacy: online_booking_rules day_of_week
        v_dow := extract(dow from p_date)::int;
        select exists (
            select 1 from public.online_booking_rules r
             where r.enabled is distinct from false
               and (r.day_of_week is null or r.day_of_week = v_dow)
               and (r.clinic_tag is null or v_clinic is null or r.clinic_tag = v_clinic)
               and (r.doctor_code is null or r.doctor_code = v_doctor)
        ) into v_legacy;
        return coalesce(v_legacy, false);
    end if;

    if v_prof.mode = 'manual' then
        return exists (
            select 1 from public.online_booking_roster_dates d
             where d.clinic_tag = v_prof.clinic_tag
               and d.doctor_code = v_prof.doctor_code
               and d.duty_date = p_date
               and d.enabled is distinct from false
        );
    end if;

    v_dow := extract(dow from p_date)::int;
    select * into v_pat
      from public.online_booking_roster_pattern p
     where p.clinic_tag = v_prof.clinic_tag
       and p.doctor_code = v_prof.doctor_code
       and p.day_of_week = v_dow;

    if not found or v_pat.on_duty is distinct from true then
        return false;
    end if;

    if v_pat.alternate is distinct from true then
        return true;
    end if;

    v_weeks := (public.ob_roster_monday(p_date) - public.ob_roster_monday(coalesce(v_prof.anchor_date, current_date))) / 7;
    return (v_weeks % 2) = 0;
end;
$$;

-- ── Sessions for a duty date (defaults: AM 10:00–13:00, PM 14:30–19:30 / 18:30 weekend & PH, Night 21:00–23:30) ─

create or replace function public.ob_is_weekend_or_red_holiday(p_date date)
returns boolean
language sql
stable
set search_path = public
as $$
    select p_date is not null and (
        extract(dow from p_date)::int in (0, 6)
        or exists (
            select 1 from public.online_booking_public_holidays h
             where h.holiday_date = p_date
               and h.enabled is distinct from false
        )
    );
$$;

create or replace function public.ob_pm_session_end(p_date date)
returns time
language sql
stable
set search_path = public
as $$
    select case
        when public.ob_is_weekend_or_red_holiday(p_date) then time '18:30'
        else time '19:30'
    end;
$$;

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
    v_am_start time := time '10:00';
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
        time '10:00'
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

grant execute on function public.ob_is_weekend_or_red_holiday(date) to anon, authenticated, service_role;
grant execute on function public.ob_pm_session_end(date) to anon, authenticated, service_role;
grant execute on function public.ob_roster_session_times(text, text, date) to anon, authenticated, service_role;

grant execute on function public.ob_get_roster_sessions(text, text, date) to anon, authenticated, service_role;
grant execute on function public.ob_time_allowed_in_sessions(time, int, jsonb, date) to anon, authenticated, service_role;

-- ── RPC: duty dates in range (for patient calendar) ─────────────
create or replace function public.ob_get_duty_dates(
    p_clinic_tag text,
    p_doctor_code text,
    p_from_date date default current_date,
    p_to_date date default (current_date + 60)
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_dates date[] := '{}';
    v_d date;
    v_mode text := 'legacy';
    v_prof record;
    v_sessions jsonb := '{}'::jsonb;
    v_sess jsonb;
begin
    if nullif(trim(p_doctor_code), '') is null then
        return jsonb_build_object('dates', '[]'::jsonb, 'mode', 'none');
    end if;

    select * into v_prof
      from public.online_booking_roster_profile rp
     where rp.doctor_code = trim(p_doctor_code)
       and (nullif(trim(p_clinic_tag), '') is null or rp.clinic_tag = trim(p_clinic_tag))
     order by case when rp.clinic_tag = trim(p_clinic_tag) then 0 else 1 end
     limit 1;

    if found then
        v_mode := v_prof.mode;
    end if;

    v_d := coalesce(p_from_date, current_date);
    while v_d <= coalesce(p_to_date, v_d + 60) loop
        if public.ob_is_on_duty(p_clinic_tag, p_doctor_code, v_d) then
            v_dates := array_append(v_dates, v_d);
            v_sess := public.ob_get_roster_sessions(p_clinic_tag, p_doctor_code, v_d);
            v_sessions := v_sessions || jsonb_build_object(to_char(v_d, 'YYYY-MM-DD'), v_sess);
        end if;
        v_d := v_d + 1;
    end loop;

    return jsonb_build_object(
        'dates', (select coalesce(jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d), '[]'::jsonb) from unnest(v_dates) d),
        'mode', v_mode,
        'sessions', v_sessions
    );
end;
$$;

revoke all on function public.ob_get_duty_dates(text, text, date, date) from public;
grant execute on function public.ob_get_duty_dates(text, text, date, date) to anon, authenticated, service_role;

grant execute on function public.ob_is_on_duty(text, text, date) to anon, authenticated, service_role;

-- ── Patch ob_request_booking: reject off-roster dates ───────────
-- Re-run online_booking_rpc.sql after this, or run the block below.

drop function if exists public.ob_request_booking(
    text, text, text, date, text, int, text, text, text, date, text, text
);

create or replace function public.ob_request_booking(
    p_clinic_tag text default null,
    p_doctor_code text default null,
    p_doctor_name text default null,
    p_date date default null,
    p_start_time text default null,
    p_duration int default 30,
    p_patient_name text default null,
    p_patient_chinese_name text default null,
    p_patient_phone text default null,
    p_patient_dob date default null,
    p_reason_id text default null,
    p_reason_label text default null,
    p_preferred_session text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_doctor_code text;
    v_doctor_name text;
    v_date date;
    v_start_time time;
    v_end_time time;
    v_duration int;
    v_phone text;
    v_ref text;
    v_now timestamptz := now();
    v_remarks text;
    v_booking_type text;
    v_appt_id uuid;
    v_start_raw text;
    v_dob date;
    v_sessions jsonb;
    v_arrange boolean := false;
    v_booking_status text;
    v_bill_status text;
    v_pref_sess text;
begin
    if coalesce(trim(p_patient_name), '') = '' or coalesce(trim(p_patient_phone), '') = '' then
        raise exception 'Name and mobile phone are required';
    end if;

    if p_patient_dob is null then
        raise exception 'Date of birth is required';
    end if;
    v_dob := p_patient_dob;

    v_duration := coalesce(nullif(p_duration, 0), 30);
    v_doctor_code := nullif(trim(p_doctor_code), '');
    v_doctor_name := coalesce(nullif(trim(p_doctor_name), ''), v_doctor_code);

    if v_doctor_code is null then
        select d.doctor_code, coalesce(d.display_name, d.english_name, d.doctor_code)
          into v_doctor_code, v_doctor_name
          from public.doctors d
         where d.is_active is distinct from false
           and d.doctor_code !~* '^all([_-]|$)'
         order by d.doctor_code
         limit 1;
    end if;

    if v_doctor_code is null then
        raise exception 'No doctor available';
    end if;

    v_start_raw := nullif(left(coalesce(p_start_time, ''), 5), '');
    v_pref_sess := nullif(lower(trim(coalesce(p_preferred_session, ''))), '');
    if v_pref_sess is not null and v_pref_sess not in ('am', 'pm', 'night') then
        v_pref_sess := null;
    end if;
    v_arrange := (v_start_raw is null);

    if v_arrange and p_date is null then
        raise exception 'Preferred date is required';
    end if;

    v_date := coalesce(p_date, current_date);

    if not public.ob_is_on_duty(p_clinic_tag, v_doctor_code, v_date) then
        raise exception 'Selected date is not available for this doctor at this clinic';
    end if;

    v_sessions := public.ob_get_roster_sessions(p_clinic_tag, v_doctor_code, v_date);

    if v_arrange then
        v_start_time := time '00:00';
        v_end_time := time '00:00';
        v_booking_status := 'pending_arrange';
        v_bill_status := 'Pending';
    else
        v_start_time := v_start_raw::time;
        v_end_time := v_start_time + make_interval(mins => v_duration);
        v_booking_status := 'pending_staff';
        v_bill_status := 'Scheduled';
        if not public.ob_time_allowed_in_sessions(v_start_time, v_duration, v_sessions, v_date) then
            raise exception 'Selected time is outside available sessions for this date';
        end if;
    end if;

    v_phone := regexp_replace(coalesce(p_patient_phone, ''), '\D', '', 'g');
    if length(v_phone) = 11 and left(v_phone, 3) = '852' then
        v_phone := substring(v_phone from 4);
    elsif length(v_phone) > 11 and left(v_phone, 5) = '00852' then
        v_phone := substring(v_phone from 6);
    end if;

    v_booking_type := case
        when p_reason_id = 'asap' then 'asap'
        when p_reason_id = 'recall' then 'recall'
        else 'new_patient'
    end;

    v_ref := 'WB-' || to_char(v_now at time zone 'Asia/Hong_Kong', 'YYYYMMDD') || '-' ||
             upper(substr(md5(random()::text), 1, 4));

    v_remarks := 'WEB ref: ' || v_ref ||
        case when coalesce(trim(p_reason_label), '') <> '' then ' · Reason: ' || trim(p_reason_label) else '' end;
    if v_arrange then
        v_remarks := v_remarks ||
            case when v_pref_sess is not null
                then ' · Arrange: ' || upper(v_pref_sess) || ' session (time TBC)'
                else ' · Arrange: time TBC by clinic' end;
    end if;

    begin
        insert into public.appointments (
            patient_name, patient_chinese_name, patient_dob, date, start_time, end_time, duration,
            doctor_code, doctor_name, clinic_tag, treatment_items, remarks,
            walk_in_phone, bill_status, booking_source, booking_status, booking_type,
            web_created_at, web_booking_ref, web_preferred_session, in_queue, arrival_time
        ) values (
            trim(p_patient_name), nullif(trim(p_patient_chinese_name), ''), v_dob, v_date,
            v_start_time, v_end_time, v_duration,
            v_doctor_code, coalesce(v_doctor_name, v_doctor_code), nullif(trim(p_clinic_tag), ''),
            nullif(trim(p_reason_label), ''), v_remarks, v_phone, v_bill_status,
            'web', v_booking_status, v_booking_type, v_now, v_ref, v_pref_sess, null, null
        )
        returning id into v_appt_id;
    exception
        when undefined_column then
            insert into public.appointments (
                patient_name, patient_chinese_name, date, start_time, end_time, duration,
                doctor_code, doctor_name, clinic_tag, treatment_items, remarks,
                walk_in_phone, bill_status, in_queue, arrival_time
            ) values (
                trim(p_patient_name), nullif(trim(p_patient_chinese_name), ''), v_date,
                v_start_time, v_end_time, v_duration,
                v_doctor_code, coalesce(v_doctor_name, v_doctor_code), nullif(trim(p_clinic_tag), ''),
                nullif(trim(p_reason_label), ''), '[WEB] ' || v_remarks || ' · DOB: ' || v_dob::text,
                v_phone, 'Scheduled', null, null
            )
            returning id into v_appt_id;
    end;

    return jsonb_build_object(
        'ok', true,
        'appointment_id', v_appt_id,
        'web_booking_ref', v_ref,
        'date', v_date,
        'start_time', case when v_arrange then null else to_char(v_start_time, 'HH24:MI') end,
        'end_time', case when v_arrange then null else to_char(v_end_time, 'HH24:MI') end,
        'doctor_name', coalesce(v_doctor_name, v_doctor_code),
        'patient_name', trim(p_patient_name),
        'booking_status', v_booking_status,
        'arrange_requested', v_arrange,
        'preferred_session', v_pref_sess,
        'pending_staff', not v_arrange,
        'message', case when v_arrange
            then 'Request received. Our team will contact you to arrange a time.'
            else 'Booking placed. Clinic staff will confirm shortly.' end
    );
end;
$$;

revoke all on function public.ob_request_booking(
    text, text, text, date, text, int, text, text, text, date, text, text, text
) from public;

grant execute on function public.ob_request_booking(
    text, text, text, date, text, int, text, text, text, date, text, text, text
) to anon, authenticated, service_role;
