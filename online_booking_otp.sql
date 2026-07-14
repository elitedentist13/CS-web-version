-- Online booking OTP hold helpers — run in Supabase SQL Editor after online_booking.sql.
-- Twilio Verify stores/checks the code; this table holds the booking draft until verified.

alter table public.online_booking_requests
    add column if not exists preferred_session text,
    add column if not exists reason_id text,
    add column if not exists reason_label text,
    add column if not exists twilio_sid text,
    add column if not exists phone_e164 text;

comment on column public.online_booking_requests.preferred_session is 'am | pm | night when arrange-mode';
comment on column public.online_booking_requests.twilio_sid is 'Last Twilio Verify Verification SID';
comment on column public.online_booking_requests.phone_e164 is 'E.164 phone used for Twilio Verify e.g. +85291234567';

-- Allow arrange-mode holds (time TBC) with 00:00 placeholders
alter table public.online_booking_requests
    alter column start_time set default '00:00',
    alter column end_time set default '00:00';

-- ── Create / refresh a pending OTP request ──────────────────────
create or replace function public.ob_create_otp_request(
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
    p_preferred_session text default null,
    p_phone_e164 text default null
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
    v_id uuid;
    v_arrange boolean := false;
    v_pref_sess text;
    v_booking_type text;
begin
    if coalesce(trim(p_patient_name), '') = '' or coalesce(trim(p_patient_phone), '') = '' then
        raise exception 'Name and mobile phone are required';
    end if;
    if p_patient_dob is null then
        raise exception 'Date of birth is required';
    end if;
    if p_date is null then
        raise exception 'Preferred date is required';
    end if;

    v_duration := coalesce(nullif(p_duration, 0), 30);
    v_doctor_code := nullif(trim(p_doctor_code), '');
    v_doctor_name := coalesce(nullif(trim(p_doctor_name), ''), v_doctor_code);
    v_date := p_date;
    v_pref_sess := nullif(lower(trim(coalesce(p_preferred_session, ''))), '');
    if v_pref_sess is not null and v_pref_sess not in ('am', 'pm', 'night') then
        v_pref_sess := null;
    end if;

    v_phone := regexp_replace(coalesce(p_patient_phone, ''), '\D', '', 'g');
    if length(v_phone) = 11 and left(v_phone, 3) = '852' then
        v_phone := substring(v_phone from 4);
    elsif length(v_phone) > 11 and left(v_phone, 5) = '00852' then
        v_phone := substring(v_phone from 6);
    end if;

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

    v_arrange := (nullif(left(coalesce(p_start_time, ''), 5), '') is null);
    if v_arrange then
        v_start_time := time '00:00';
        v_end_time := time '00:00';
    else
        v_start_time := left(p_start_time, 5)::time;
        v_end_time := v_start_time + make_interval(mins => v_duration);
    end if;

    v_booking_type := case
        when p_reason_id = 'asap' then 'asap'
        when p_reason_id = 'recall' then 'recall'
        else 'new_patient'
    end;

    v_ref := 'WB-' || to_char(v_now at time zone 'Asia/Hong_Kong', 'YYYYMMDD') || '-' ||
             upper(substr(md5(random()::text), 1, 4));

    -- Expire older unfinished OTP requests for the same phone (last 24h)
    update public.online_booking_requests
       set status = 'expired', updated_at = v_now
     where patient_phone = v_phone
       and status = 'pending_otp'
       and created_at > v_now - interval '24 hours';

    insert into public.online_booking_requests (
        web_booking_ref, clinic_tag, doctor_code, doctor_name,
        appt_date, start_time, end_time, duration,
        patient_name, patient_chinese_name, patient_phone, patient_dob,
        treatment_items, booking_type, preferred_session, reason_id, reason_label,
        phone_e164, status, otp_expires_at, otp_attempts, remarks
    ) values (
        v_ref, nullif(trim(p_clinic_tag), ''), v_doctor_code, coalesce(v_doctor_name, v_doctor_code),
        v_date, v_start_time, v_end_time, v_duration,
        trim(p_patient_name), nullif(trim(p_patient_chinese_name), ''), v_phone, p_patient_dob,
        nullif(trim(p_reason_label), ''), v_booking_type, v_pref_sess,
        nullif(trim(p_reason_id), ''), nullif(trim(p_reason_label), ''),
        nullif(trim(p_phone_e164), ''), 'pending_otp', v_now + interval '10 minutes', 0,
        'OTP pending · ' || v_ref
    )
    returning id into v_id;

    return jsonb_build_object(
        'ok', true,
        'request_id', v_id,
        'web_booking_ref', v_ref,
        'patient_phone', v_phone,
        'phone_e164', nullif(trim(p_phone_e164), ''),
        'date', v_date,
        'start_time', case when v_arrange then null else to_char(v_start_time, 'HH24:MI') end,
        'arrange_requested', v_arrange,
        'otp_expires_at', (v_now + interval '10 minutes')
    );
end;
$$;

revoke all on function public.ob_create_otp_request(
    text, text, text, date, text, int, text, text, text, date, text, text, text, text
) from public;
grant execute on function public.ob_create_otp_request(
    text, text, text, date, text, int, text, text, text, date, text, text, text, text
) to service_role;

-- Mark Twilio send metadata on the request
create or replace function public.ob_mark_otp_sent(
    p_request_id uuid,
    p_twilio_sid text default null,
    p_phone_e164 text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_now timestamptz := now();
begin
    update public.online_booking_requests
       set twilio_sid = coalesce(nullif(trim(p_twilio_sid), ''), twilio_sid),
           phone_e164 = coalesce(nullif(trim(p_phone_e164), ''), phone_e164),
           otp_expires_at = v_now + interval '10 minutes',
           updated_at = v_now
     where id = p_request_id
       and status = 'pending_otp';

    if not found then
        raise exception 'OTP request not found or not pending';
    end if;

    return jsonb_build_object('ok', true, 'request_id', p_request_id);
end;
$$;

revoke all on function public.ob_mark_otp_sent(uuid, text, text) from public;
grant execute on function public.ob_mark_otp_sent(uuid, text, text) to service_role;

-- After Twilio Verify succeeds: create appointment via existing RPC and close the hold
create or replace function public.ob_complete_otp_request(
    p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    r public.online_booking_requests%rowtype;
    v_result jsonb;
    v_start text;
    v_arrange boolean;
begin
    select * into r
      from public.online_booking_requests
     where id = p_request_id
     for update;

    if not found then
        raise exception 'OTP request not found';
    end if;

    if r.status = 'verified' and r.appointment_id is not null then
        return jsonb_build_object(
            'ok', true,
            'already_verified', true,
            'appointment_id', r.appointment_id,
            'web_booking_ref', r.web_booking_ref,
            'date', r.appt_date,
            'start_time', case when r.start_time = time '00:00' and r.end_time = time '00:00'
                then null else to_char(r.start_time, 'HH24:MI') end,
            'arrange_requested', (r.start_time = time '00:00' and r.end_time = time '00:00'),
            'booking_status', case when r.start_time = time '00:00' and r.end_time = time '00:00'
                then 'pending_arrange' else 'pending_staff' end
        );
    end if;

    if r.status <> 'pending_otp' then
        raise exception 'OTP request is not pending (status=%)', r.status;
    end if;

    if r.otp_expires_at is not null and r.otp_expires_at < now() then
        update public.online_booking_requests
           set status = 'expired', updated_at = now()
         where id = p_request_id;
        raise exception 'OTP expired. Please request a new code.';
    end if;

    v_arrange := (r.start_time = time '00:00' and r.end_time = time '00:00');
    v_start := case when v_arrange then null else to_char(r.start_time, 'HH24:MI') end;

    v_result := public.ob_request_booking(
        r.clinic_tag,
        r.doctor_code,
        r.doctor_name,
        r.appt_date,
        v_start,
        r.duration,
        r.patient_name,
        r.patient_chinese_name,
        r.patient_phone,
        r.patient_dob,
        r.reason_id,
        coalesce(r.reason_label, r.treatment_items),
        r.preferred_session
    );

    -- Prefer the OTP hold's ref on the appointment when possible
    begin
        update public.appointments
           set web_booking_ref = coalesce(r.web_booking_ref, web_booking_ref),
               verified_at = now()
         where id = (v_result->>'appointment_id')::uuid;
    exception
        when undefined_column then
            null;
    end;

    update public.online_booking_requests
       set status = 'verified',
           appointment_id = (v_result->>'appointment_id')::uuid,
           updated_at = now(),
           remarks = coalesce(remarks, '') || ' · verified'
     where id = p_request_id;

    return v_result || jsonb_build_object(
        'request_id', p_request_id,
        'web_booking_ref', coalesce(r.web_booking_ref, v_result->>'web_booking_ref'),
        'verified', true
    );
end;
$$;

revoke all on function public.ob_complete_otp_request(uuid) from public;
grant execute on function public.ob_complete_otp_request(uuid) to service_role;

-- Bump failed attempt counter (Twilio owns the real check)
create or replace function public.ob_bump_otp_attempt(
    p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_attempts int;
begin
    update public.online_booking_requests
       set otp_attempts = coalesce(otp_attempts, 0) + 1,
           updated_at = now()
     where id = p_request_id
       and status = 'pending_otp'
    returning otp_attempts into v_attempts;

    if not found then
        raise exception 'OTP request not found or not pending';
    end if;

    if v_attempts >= 5 then
        update public.online_booking_requests
           set status = 'expired', updated_at = now()
         where id = p_request_id;
        raise exception 'Too many incorrect codes. Please start again.';
    end if;

    return jsonb_build_object('ok', true, 'otp_attempts', v_attempts);
end;
$$;

revoke all on function public.ob_bump_otp_attempt(uuid) from public;
grant execute on function public.ob_bump_otp_attempt(uuid) to service_role;
