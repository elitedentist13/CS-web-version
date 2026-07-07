-- Online booking RPC — run once in Supabase SQL editor (after online_booking.sql).
-- Lets book.html submit bookings via the public anon key without a separate API server.
-- Re-run this file after updates to refresh ob_request_booking.
-- For roster validation, prefer re-running online_booking_roster.sql (includes this RPC).

drop function if exists public.ob_request_booking(
    text, text, text, date, text, int, text, text, text, date, text, text
);
drop function if exists public.ob_request_booking(
    text, text, text, date, text, int, text, text, text, date, text, text, text
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
    end if;

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
                v_phone, v_bill_status, null, null
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
