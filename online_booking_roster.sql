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
    updated_at timestamptz default now(),
    unique (clinic_tag, doctor_code)
);

comment on table public.online_booking_roster_profile is 'Online booking roster mode per clinic+doctor';
comment on column public.online_booking_roster_profile.mode is 'pattern = weekly/alternate grid; manual = per-date ticks';
comment on column public.online_booking_roster_profile.anchor_date is 'Monday-containing week that starts Week A (for alternate weekdays)';

-- ── Pattern: Mon–Sun on-duty + optional alternate per day ───────
create table if not exists public.online_booking_roster_pattern (
    id uuid primary key default gen_random_uuid(),
    clinic_tag text not null,
    doctor_code text not null,
    day_of_week int not null check (day_of_week between 0 and 6),
    on_duty boolean not null default false,
    alternate boolean not null default false,
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
    unique (clinic_tag, doctor_code, duty_date)
);

create index if not exists idx_ob_roster_dates_lookup
    on public.online_booking_roster_dates (clinic_tag, doctor_code, duty_date);

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
        end if;
        v_d := v_d + 1;
    end loop;

    return jsonb_build_object(
        'dates', (select coalesce(jsonb_agg(to_char(d, 'YYYY-MM-DD') order by d), '[]'::jsonb) from unnest(v_dates) d),
        'mode', v_mode
    );
end;
$$;

revoke all on function public.ob_get_duty_dates(text, text, date, date) from public;
grant execute on function public.ob_get_duty_dates(text, text, date, date) to anon, authenticated, service_role;

grant execute on function public.ob_is_on_duty(text, text, date) to anon, authenticated, service_role;

-- ── Patch ob_request_booking: reject off-roster dates ───────────
-- Re-run online_booking_rpc.sql after this, or run the block below.

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
    p_reason_label text default null
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

    v_date := coalesce(p_date, current_date);

    if not public.ob_is_on_duty(p_clinic_tag, v_doctor_code, v_date) then
        raise exception 'Selected date is not available for this doctor at this clinic';
    end if;

    v_start_raw := nullif(left(coalesce(p_start_time, ''), 5), '');
    v_start_time := coalesce(v_start_raw::time, time '10:00');
    v_end_time := v_start_time + make_interval(mins => v_duration);

    v_phone := regexp_replace(coalesce(p_patient_phone, ''), '\D', '', 'g');
    if length(v_phone) = 8 then
        v_phone := '852' || v_phone;
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

    begin
        insert into public.appointments (
            patient_name, patient_chinese_name, patient_dob, date, start_time, end_time, duration,
            doctor_code, doctor_name, clinic_tag, treatment_items, remarks,
            walk_in_phone, bill_status, booking_source, booking_status, booking_type,
            web_created_at, web_booking_ref, in_queue, arrival_time
        ) values (
            trim(p_patient_name), nullif(trim(p_patient_chinese_name), ''), v_dob, v_date,
            v_start_time, v_end_time, v_duration,
            v_doctor_code, coalesce(v_doctor_name, v_doctor_code), nullif(trim(p_clinic_tag), ''),
            nullif(trim(p_reason_label), ''), v_remarks, v_phone, 'Scheduled',
            'web', 'pending_staff', v_booking_type, v_now, v_ref, null, null
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
        'start_time', to_char(v_start_time, 'HH24:MI'),
        'end_time', to_char(v_end_time, 'HH24:MI'),
        'doctor_name', coalesce(v_doctor_name, v_doctor_code),
        'patient_name', trim(p_patient_name),
        'pending_staff', true,
        'message', 'Booking placed. Clinic staff will confirm shortly.'
    );
end;
$$;

revoke all on function public.ob_request_booking(
    text, text, text, date, text, int, text, text, text, date, text, text
) from public;

grant execute on function public.ob_request_booking(
    text, text, text, date, text, int, text, text, text, date, text, text
) to anon, authenticated, service_role;
