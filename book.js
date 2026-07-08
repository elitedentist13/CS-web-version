/* book.js — public online booking (soft launch: name + phone only, staff confirms) */
(function () {
  'use strict';

  var CFG = window.ONLINE_BOOKING_CONFIG || {};
  var LANG = 'zh-Hant';
  var clinics = [];
  var doctors = [];
  var visitReasons = [];
  var selectedSlot = '';
  var apiReachable = false;
  var dutyDateMap = {};
  var selectedSession = '';
  var calViewYear = 0;
  var calViewMonth = 0;

  var OB_SESSION_WINDOWS = {
    am: { start: '10:00', end: '13:00', label: 'AM' },
    pm: { start: '14:30', end: '19:30', label: 'PM' },
    night: { start: '21:00', end: '23:30', label: 'Night' }
  };

  var VISIT_REASONS = [
    { id: 'checkup', en: 'Check-up', zh: '覆診檢查' },
    { id: 'cleaning', en: 'Cleaning', zh: '洗牙' },
    { id: 'pain', en: 'Tooth pain', zh: '牙痛' },
    { id: 'cosmetic', en: 'Cosmetic / Whitening', zh: '美白／美學' },
    { id: 'recall', en: 'Recall / Follow-up', zh: '覆診召回' },
    { id: 'asap', en: 'Earliest available', zh: '盡快安排' },
    { id: 'other', en: 'Other', zh: '其他' }
  ];

  var I18N = {
    en: {
      title: 'Book an appointment',
      softHint: 'Name, mobile and date of birth are required. Our team will confirm your booking.',
      name: 'Your name',
      nameZh: 'Name (Chinese)',
      mobile: 'Mobile',
      dob: 'Date of birth',
      clinic: 'Clinic',
      reason: 'Visit reason',
      doctor: 'Doctor',
      date: 'Preferred date',
      time: 'Preferred time',
      pickDate: 'Select a highlighted date to see times (optional)',
      pickSession: 'Session',
      sessAm: 'Morning (10:00–13:00)',
      sessPm: 'Afternoon (14:30–19:30; 18:30 Sat/Sun & public holidays)',
      sessNight: 'Night (21:00–23:30)',
      pickClinicDr: 'Select clinic and doctor first. Highlighted dates are on-duty days.',
      noDutyDates: 'No on-duty dates in this period for this doctor. Please contact the clinic.',
      calLoading: 'Loading doctor schedule…',
      noSlots: 'No times available on this day',
      arrangeHint: 'You can still submit a request — our front desk will contact you to arrange a time.',
      arrangeBanner: 'Request appointment (time to be arranged)',
      errDate: 'Please select a preferred date on the calendar.',
      loading: 'Loading times…',
      bookBtn: 'Submit booking request',
      booked: 'Request Received!',
      confirmNote: 'Your booking request has been placed. Our team will contact you to confirm.',
      confirmNoteArrange: 'Your request has been received. Our front desk will contact you to arrange a time on your chosen day.',
      errNamePhone: 'Please enter your name, mobile and date of birth.',
      errDisabled: 'Online booking is currently unavailable.',
      errGeneric: 'Something went wrong. Please try again.',
      errRpcMissing: 'Run online_booking_roster.sql in Supabase SQL Editor (one-time setup), then refresh this page.',
      errApiDown: 'Booking could not be saved. Run online_booking_rpc.sql in Supabase SQL Editor, then refresh.',
      reasonNone: '— Not specified —',
      timeTbc: 'To be confirmed by clinic',
      clinicNoteTitle: 'Clinic availability note',
      clinicNoteBody: 'Quarry Bay and Po Lam are still awaiting a system update — online booking is not available at these locations yet. Please contact the clinic directly or choose another location.'
    },
    'zh-Hant': {
      title: '網上預約',
      softHint: '只需填寫姓名、手提電話及出生日期。診所同事會為您確認預約。',
      name: '您的姓名',
      nameZh: '中文姓名',
      mobile: '手提電話',
      dob: '出生日期',
      clinic: '診所',
      reason: '就診原因',
      doctor: '醫生',
      date: '希望日期',
      time: '希望時間',
      pickDate: '可選擇高亮日期查看時段',
      pickSession: '時段',
      sessAm: '上午 (10:00–13:00)',
      sessPm: '下午 (14:30–19:30；週末及公眾假期至18:30)',
      sessNight: '晚間 (21:00–23:30)',
      pickClinicDr: '請先選擇診所及醫生。高亮日期為值班日。',
      noDutyDates: '此醫生在本段期間沒有值班日，請聯絡診所。',
      calLoading: '載入醫生排班中…',
      noSlots: '此日暫無可選時段',
      arrangeHint: '您仍可提交申請 — 前台同事會聯絡您安排時間。',
      arrangeBanner: '申請預約（時間待安排）',
      errDate: '請在日曆上選擇希望日期。',
      loading: '載入時段中…',
      bookBtn: '提交預約申請',
      booked: '申請已收到！',
      confirmNote: '您的預約申請已提交。診所將盡快聯絡您確認。',
      confirmNoteArrange: '您的申請已收到。前台同事會聯絡您，於所選日期安排預約時間。',
      errNamePhone: '請填寫姓名、手提電話及出生日期。',
      errDisabled: '網上預約暫停服務。',
      errGeneric: '發生錯誤，請重試。',
      errRpcMissing: '請在 Supabase SQL Editor 執行 online_booking_roster.sql（一次性設定），然後重新整理此頁。',
      errApiDown: '無法儲存預約。請在 Supabase SQL Editor 執行 online_booking_rpc.sql，然後重新整理。',
      reasonNone: '— 未指定 —',
      timeTbc: '待診所確認',
      clinicNoteTitle: '診所預約提示',
      clinicNoteBody: '鰂魚涌及寶琳診所系統更新中，暫未能提供網上預約。請直接聯絡診所，或選擇其他診所。'
    },
    'zh-CN': {
      title: '网上预约',
      softHint: '只需填写姓名、手机及出生日期。诊所同事会为您确认预约。',
      name: '您的姓名',
      nameZh: '中文姓名',
      mobile: '手机',
      dob: '出生日期',
      clinic: '诊所',
      reason: '就诊原因',
      doctor: '医生',
      date: '希望日期',
      time: '希望时间',
      pickDate: '可选择高亮日期查看时段',
      pickSession: '时段',
      sessAm: '上午 (10:00–13:00)',
      sessPm: '下午 (14:30–19:30；周末及公众假期至18:30)',
      sessNight: '晚间 (21:00–23:30)',
      pickClinicDr: '请先选择诊所及医生。高亮日期为值班日。',
      noDutyDates: '此医生在本段期间没有值班日，请联系诊所。',
      calLoading: '加载医生排班中…',
      noSlots: '此日暂无可选时段',
      arrangeHint: '您仍可提交申请 — 前台同事会联系您安排时间。',
      arrangeBanner: '申请预约（时间待安排）',
      errDate: '请在日历上选择希望日期。',
      loading: '加载时段中…',
      bookBtn: '提交预约申请',
      booked: '申请已收到！',
      confirmNote: '您的预约申请已提交。诊所将尽快联系您确认。',
      confirmNoteArrange: '您的申请已收到。前台同事会联系您，于所选日期安排预约时间。',
      errNamePhone: '请填写姓名、手机及出生日期。',
      errDisabled: '网上预约暂停服务。',
      errGeneric: '发生错误，请重试。',
      errRpcMissing: '请在 Supabase SQL Editor 运行 online_booking_roster.sql（一次性设置），然后刷新此页。',
      errApiDown: '无法保存预约。请在 Supabase SQL Editor 运行 online_booking_rpc.sql，然后刷新。',
      reasonNone: '— 未指定 —',
      timeTbc: '待诊所确认',
      clinicNoteTitle: '诊所预约提示',
      clinicNoteBody: '鲗鱼涌及宝琳诊所系统更新中，暂未能提供网上预约。请直接联络诊所，或选择其他诊所。'
    }
  };

  function t(key) {
    var pack = I18N[LANG] || I18N.en;
    return pack[key] || I18N.en[key] || key;
  }

  function $(id) { return document.getElementById(id); }

  function apiUrl() {
    if (CFG.preferLocal && CFG.localUrl) return CFG.localUrl;
    return CFG.edgeUrl || CFG.localUrl;
  }

  function apiCall(body) {
    return fetch(apiUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).catch(function () {
      return Promise.reject(Object.assign(new Error(t('errGeneric')), { network: true }));
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw Object.assign(new Error(data.error || t('errGeneric')), { data: data, status: r.status });
        apiReachable = true;
        return data;
      });
    });
  }

  function bookingAction(body) {
    return apiCall(body).catch(function (err) {
      if (!CFG.supabaseUrl || !CFG.anonKey) throw err;
      if (body.action === 'get-slots') return getSlotsDirect(body);
      if (body.action === 'request-booking') return requestBookingDirect(body);
      throw err;
    });
  }

  var ONLINE_BOOK_DEFAULTS = {
    start_time: '10:00',
    end_time: '19:00',
    lunch_start: '13:00',
    lunch_end: '15:00',
    slot_interval: 30,
    default_duration: 30,
    lead_time_hours: 2
  };

  function timeToMin(t) {
    var p = String(t || '').split(':');
    return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
  }

  function minToTime(m) {
    m = Math.max(0, Math.min(m, 23 * 60 + 59));
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }

  function rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd && bStart < aEnd;
  }

  function pickRules(rows, clinicTag, doctorCode, dayOfWeek) {
    if (!rows || !rows.length) return Object.assign({}, ONLINE_BOOK_DEFAULTS);
    var filtered = rows.filter(function (r) {
      if (r.clinic_tag && clinicTag && r.clinic_tag !== clinicTag) return false;
      if (r.doctor_code && doctorCode && r.doctor_code !== doctorCode) return false;
      if (r.day_of_week != null && Number(r.day_of_week) !== dayOfWeek) return false;
      return r.enabled !== false;
    });
    var pick = filtered[0] || rows[0];
    return {
      start_time: String(pick.start_time || ONLINE_BOOK_DEFAULTS.start_time).slice(0, 5),
      end_time: String(pick.end_time || ONLINE_BOOK_DEFAULTS.end_time).slice(0, 5),
      lunch_start: String(pick.lunch_start || ONLINE_BOOK_DEFAULTS.lunch_start).slice(0, 5),
      lunch_end: String(pick.lunch_end || ONLINE_BOOK_DEFAULTS.lunch_end).slice(0, 5),
      slot_interval: Number(pick.slot_interval) || ONLINE_BOOK_DEFAULTS.slot_interval,
      default_duration: Number(pick.default_duration) || ONLINE_BOOK_DEFAULTS.default_duration,
      lead_time_hours: Number(pick.lead_time_hours) || ONLINE_BOOK_DEFAULTS.lead_time_hours
    };
  }

  function pmEndForDate(date, sessions) {
    if (sessions && sessions.pm_end) return String(sessions.pm_end).slice(0, 5);
    if (sessions && sessions.pm_end_weekday) {
      var d = new Date(date + 'T12:00:00').getDay();
      if (d === 0 || d === 6) {
        return String(sessions.pm_end_weekend || '18:30').slice(0, 5);
      }
      return String(sessions.pm_end_weekday).slice(0, 5);
    }
    var d2 = new Date(date + 'T12:00:00').getDay();
    if (d2 === 0 || d2 === 6) return '18:30';
    return '19:30';
  }

  function sessionWindowStart(sessions, key) {
    var k = key + '_start';
    if (sessions && sessions[k]) return String(sessions[k]).slice(0, 5);
    var win = OB_SESSION_WINDOWS[key];
    return win ? win.start : '00:00';
  }

  function sessionWindowEnd(sessions, key, date) {
    if (key === 'pm') return pmEndForDate(date, sessions);
    var k = key + '_end';
    if (sessions && sessions[k]) return String(sessions[k]).slice(0, 5);
    var win = OB_SESSION_WINDOWS[key];
    return win ? win.end : '23:59';
  }

  function generateSessionSlots(sessions, interval, duration, sessionFilter, date) {
    var slots = [];
    var keys = sessionFilter ? [sessionFilter] : ['am', 'pm', 'night'];
    keys.forEach(function (key) {
      if (!sessions || !sessions[key]) return;
      var startH = timeToMin(sessionWindowStart(sessions, key));
      var endH = timeToMin(sessionWindowEnd(sessions, key, date));
      for (var m = startH; m + duration <= endH; m += interval) {
        slots.push(minToTime(m));
      }
    });
    return slots.sort();
  }

  function getRosterSessionsDirect(clinic, doctor, date) {
    return sbRestRpc('ob_get_roster_sessions', {
      p_clinic_tag: clinic || null,
      p_doctor_code: doctor,
      p_date: date
    }).then(function (s) {
      return {
        am: s.am !== false,
        pm: s.pm !== false,
        night: !!s.night,
        am_start: s.am_start ? String(s.am_start).slice(0, 5) : OB_SESSION_WINDOWS.am.start,
        am_end: s.am_end ? String(s.am_end).slice(0, 5) : OB_SESSION_WINDOWS.am.end,
        pm_start: s.pm_start ? String(s.pm_start).slice(0, 5) : OB_SESSION_WINDOWS.pm.start,
        pm_end: s.pm_end ? String(s.pm_end).slice(0, 5) : pmEndForDate(date, null),
        pm_end_weekday: s.pm_end_weekday ? String(s.pm_end_weekday).slice(0, 5) : '19:30',
        pm_end_weekend: s.pm_end_weekend ? String(s.pm_end_weekend).slice(0, 5) : '18:30',
        night_start: s.night_start ? String(s.night_start).slice(0, 5) : OB_SESSION_WINDOWS.night.start,
        night_end: s.night_end ? String(s.night_end).slice(0, 5) : OB_SESSION_WINDOWS.night.end,
        slot_interval: Number(s.slot_interval) || ONLINE_BOOK_DEFAULTS.slot_interval
      };
    }).catch(function () {
      return {
        am: true, pm: true, night: false,
        am_start: OB_SESSION_WINDOWS.am.start,
        am_end: OB_SESSION_WINDOWS.am.end,
        pm_start: OB_SESSION_WINDOWS.pm.start,
        pm_end: pmEndForDate(date, null),
        pm_end_weekday: '19:30',
        pm_end_weekend: '18:30',
        night_start: OB_SESSION_WINDOWS.night.start,
        night_end: OB_SESSION_WINDOWS.night.end,
        slot_interval: ONLINE_BOOK_DEFAULTS.slot_interval
      };
    });
  }

  function enabledSessionKeys(sessions) {
    return ['am', 'pm', 'night'].filter(function (k) { return sessions && sessions[k]; });
  }

  function renderSessionBar(sessions) {
    var bar = $('obSessionBar');
    if (!bar) return;
    var keys = enabledSessionKeys(sessions);
    if (keys.length < 2) {
      bar.style.display = 'none';
      bar.innerHTML = '';
      var field = $('obSessionField');
      if (field) field.style.display = 'none';
      selectedSession = keys[0] || '';
      return;
    }
    var field = $('obSessionField');
    if (field) field.style.display = '';
    bar.style.display = '';
    bar.innerHTML = '<span class="ob-session-lbl">' + t('pickSession') + '</span>';
    keys.forEach(function (key) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ob-session-btn' + (selectedSession === key || (!selectedSession && keys[0] === key) ? ' selected' : '');
      btn.dataset.session = key;
      btn.textContent = t('sess' + key.charAt(0).toUpperCase() + key.slice(1));
      btn.addEventListener('click', function () {
        selectedSession = key;
        bar.querySelectorAll('.ob-session-btn').forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        loadSlots();
      });
      bar.appendChild(btn);
    });
    if (!selectedSession || keys.indexOf(selectedSession) < 0) selectedSession = keys[0];
  }

  function generateCandidateSlots(rules, duration) {
    var startH = timeToMin(rules.start_time);
    var endH = timeToMin(rules.end_time);
    var interval = Number(rules.slot_interval) || ONLINE_BOOK_DEFAULTS.slot_interval;
    var lunchStart = timeToMin(rules.lunch_start);
    var lunchEnd = timeToMin(rules.lunch_end);
    var slots = [];
    for (var m = startH; m + duration <= endH; m += interval) {
      if (m < lunchEnd && m + duration > lunchStart) continue;
      slots.push(minToTime(m));
    }
    return slots;
  }

  function filterFreeSlots(candidates, occupied, duration) {
    return candidates.filter(function (slot) {
      var s = timeToMin(slot);
      var e = s + duration;
      return !occupied.some(function (a) {
        var as = timeToMin(String(a.start_time || '').slice(0, 5));
        var ae = timeToMin(String(a.end_time || '').slice(0, 5));
        if (ae <= as) {
          var dur = parseInt(String(a.duration || '0'), 10);
          ae = as + (dur > 0 ? dur : 30);
        }
        return rangesOverlap(s, e, as, ae);
      });
    });
  }

  function getOccupiedDirect(date, doctorCode, clinicTag) {
    var q = 'appointments?select=start_time,end_time,duration,bill_status,booking_status' +
      '&date=eq.' + encodeURIComponent(date) +
      '&doctor_code=eq.' + encodeURIComponent(doctorCode);
    if (clinicTag) {
      q += '&or=(clinic_tag.eq.' + encodeURIComponent(clinicTag) + ',clinic_tag.is.null)';
    }
    return sbRestGet(q).then(function (rows) {
        return (rows || []).filter(function (a) {
        var bs = String(a.bill_status || '').toLowerCase();
        var bks = String(a.booking_status || '').toLowerCase();
        if (bs.indexOf('cancel') >= 0 || bks === 'cancelled' || bks === 'expired') return false;
        if (bks === 'pending_arrange') return false;
        return true;
      });
    });
  }

  function getSlotsDirect(body) {
    var date = String(body.date || '');
    var doctorCode = String(body.doctor_code || '');
    var clinicTag = String(body.clinic_tag || '');
    var duration = parseInt(String(body.duration || '30'), 10) || 30;
    var sessionFilter = String(body.session || '') || null;
    if (!date || !doctorCode) {
      return Promise.reject(Object.assign(new Error('date and doctor_code required'), { status: 400 }));
    }
    var day = new Date(date + 'T12:00:00').getDay();
    var sessionsPromise = dutyDateMap[date]
      ? Promise.resolve(dutyDateMap[date])
      : getRosterSessionsDirect(clinicTag, doctorCode, date);
    return sessionsPromise.then(function (sessions) {
      return sbRestGet('online_booking_rules?select=*&enabled=eq.true')
        .catch(function () { return []; })
        .then(function (rulesRows) {
          var rules = pickRules(rulesRows, clinicTag, doctorCode, day);
          var interval = Number(sessions.slot_interval) || Number(rules.slot_interval) || ONLINE_BOOK_DEFAULTS.slot_interval;
          var candidates = generateSessionSlots(sessions, interval, duration, sessionFilter, date);
          if (!candidates.length) {
            candidates = generateCandidateSlots(rules, duration);
          }
          return getOccupiedDirect(date, doctorCode, clinicTag).then(function (occupied) {
            var slots = filterFreeSlots(candidates, occupied, duration);
            if (date === todayIso()) {
              var cutMin = new Date(Date.now() + (Number(rules.lead_time_hours) || 2) * 3600000);
              var cm = cutMin.getHours() * 60 + cutMin.getMinutes();
              slots = slots.filter(function (s) { return timeToMin(s) >= cm; });
            }
            return { slots: slots, duration: duration, rules: rules, sessions: sessions, source: 'direct' };
          });
        });
    });
  }

  function sbRestRpc(fn, args) {
    var url = (CFG.supabaseUrl || '').replace(/\/$/, '') + '/rest/v1/rpc/' + fn;
    return fetch(url, {
      method: 'POST',
      headers: Object.assign({}, sbRestHeaders(), { 'Content-Type': 'application/json' }),
      body: JSON.stringify(args || {})
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) {
          var msg = data.message || data.error || data.hint || r.statusText || t('errGeneric');
          if (r.status === 404) {
            throw Object.assign(new Error(t('errRpcMissing')), { rpcMissing: true, status: 404 });
          }
          throw Object.assign(new Error(msg), { status: r.status });
        }
        return data;
      });
    });
  }

  function requestBookingDirect(body) {
    var payload = {
      p_clinic_tag: body.clinic_tag || null,
      p_doctor_code: body.doctor_code || null,
      p_doctor_name: body.doctor_name || null,
      p_date: body.date || null,
      p_start_time: body.start_time || null,
      p_duration: body.duration || 30,
      p_patient_name: body.patient_name || null,
      p_patient_chinese_name: body.patient_chinese_name || null,
      p_patient_phone: body.patient_phone || null,
      p_patient_dob: body.patient_dob || null,
      p_reason_id: body.reason_id || null,
      p_reason_label: body.reason_label || null,
      p_preferred_session: body.preferred_session || null
    };
    return sbRestRpc('ob_request_booking', payload);
  }

  function maxBookDateIso() {
    var maxD = new Date();
    maxD.setDate(maxD.getDate() + 60);
    return maxD.getFullYear() + '-' + pad(maxD.getMonth() + 1) + '-' + pad(maxD.getDate());
  }

  function getDutyDatesDirect(clinic, doctor) {
    return sbRestRpc('ob_get_duty_dates', {
      p_clinic_tag: clinic || null,
      p_doctor_code: doctor || null,
      p_from_date: todayIso(),
      p_to_date: maxBookDateIso()
    }).then(function (res) {
      dutyDateMap = {};
      var dates = res.dates || [];
      if (typeof dates === 'string') {
        try { dates = JSON.parse(dates); } catch (e) { dates = []; }
      }
      var sessions = res.sessions || {};
      return dates.map(function (d) {
        var iso = String(d).slice(0, 10);
        var s = sessions[iso] || { am: true, pm: true, night: false };
        dutyDateMap[iso] = {
          am: s.am !== false,
          pm: s.pm !== false,
          night: !!s.night,
          pm_end: s.pm_end ? String(s.pm_end).slice(0, 5) : pmEndForDate(iso, null)
        };
        return iso;
      });
    });
  }

  function loadDutyCalendar() {
    var clinic = $('fClinic').value;
    var doctor = $('fDoctor').value;
    var grid = $('obCalGrid');
    $('fDate').value = '';
    selectedSlot = '';
    selectedSession = '';
    renderSessionBar({});
    if ($('slotGrid')) {
      $('slotGrid').innerHTML = '<span class="ob-slots-empty">' + t('pickDate') + '</span>';
    }
    if (!clinic || !doctor) {
      dutyDateMap = {};
      selectedSession = '';
      if (grid) grid.innerHTML = '<span class="ob-slots-empty">' + t('pickClinicDr') + '</span>';
      renderSessionBar({});
      return Promise.resolve();
    }
    if (grid) grid.innerHTML = '<span class="ob-slots-loading">' + t('calLoading') + '</span>';
    return getDutyDatesDirect(clinic, doctor).then(function () {
      var now = new Date();
      calViewYear = now.getFullYear();
      calViewMonth = now.getMonth();
      renderPatientCalendar();
    }).catch(function () {
      dutyDateMap = {};
      if (grid) grid.innerHTML = '<span class="ob-slots-empty">' + t('noDutyDates') + '</span>';
    });
  }

  function renderPatientCalendar() {
    var grid = $('obCalGrid');
    var lbl = $('obCalMonthLbl');
    if (!grid) return;

    var y = calViewYear;
    var m = calViewMonth;
    if (lbl) lbl.textContent = y + '-' + pad(m + 1);

    var first = new Date(y, m, 1);
    var startPad = (first.getDay() + 6) % 7;
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var today = todayIso();
    var maxD = maxBookDateIso();
    var hasDuty = Object.keys(dutyDateMap).length > 0;

    if (!hasDuty) {
      grid.innerHTML = '<span class="ob-slots-empty">' + t('noDutyDates') + '</span>';
      return;
    }

    var html = '<div class="ob-cal-head">';
    ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].forEach(function (d) {
      html += '<span>' + d + '</span>';
    });
    html += '</div><div class="ob-cal-cells">';

    for (var i = 0; i < startPad; i++) {
      html += '<span class="ob-cal-empty"></span>';
    }
    for (var day = 1; day <= daysInMonth; day++) {
      var iso = y + '-' + pad(m + 1) + '-' + pad(day);
      var onDuty = !!dutyDateMap[iso];
      var past = iso < today;
      var tooFar = iso > maxD;
      var sel = $('fDate').value === iso;
      var cls = 'ob-cal-day';
      if (onDuty && !past && !tooFar) cls += ' ob-cal-day--duty';
      if (sel) cls += ' ob-cal-day--sel';
      if (past || tooFar || !onDuty) cls += ' ob-cal-day--off';
      html += '<button type="button" class="' + cls + '" data-date="' + iso + '"' +
        ((past || tooFar || !onDuty) ? ' disabled' : '') + '>' + day + '</button>';
    }
    html += '</div>';
    grid.innerHTML = html;

    grid.querySelectorAll('.ob-cal-day--duty').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var d = btn.getAttribute('data-date');
        $('fDate').value = d;
        selectedSession = '';
        grid.querySelectorAll('.ob-cal-day').forEach(function (b) { b.classList.remove('ob-cal-day--sel'); });
        btn.classList.add('ob-cal-day--sel');
        renderSessionBar(dutyDateMap[d] || {});
        loadSlots();
      });
    });
  }

  function onClinicDoctorChange() {
    loadDutyCalendar();
  }

  function sbRestHeaders() {
    return {
      apikey: CFG.anonKey,
      Authorization: 'Bearer ' + CFG.anonKey
    };
  }

  function sbRestGet(path) {
    var url = (CFG.supabaseUrl || '').replace(/\/$/, '') + '/rest/v1/' + path;
    return fetch(url, { headers: sbRestHeaders() }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw Object.assign(new Error(data.message || r.statusText), { status: r.status });
        return data;
      });
    });
  }

  function loadOptionsDirect() {
    var clinicSelect = 'id,clinic_code,english_name,chinese_name,address,address_chinese,tel,is_active';
    var clinicOrder = 'order=clinic_code.asc';
    return sbRestGet('clinics?select=' + encodeURIComponent(clinicSelect) + '&' + clinicOrder)
      .catch(function () {
        var legacy = 'id,clinic_code,english_name,chinese_name,address,address_chinese,tel';
        return sbRestGet('clinics?select=' + encodeURIComponent(legacy) + '&' + clinicOrder);
      })
      .then(function (clinicRows) {
        return Promise.all([
          Promise.resolve(clinicRows),
          sbRestGet('doctors?select=' + encodeURIComponent('id,doctor_code,english_name,chinese_name,display_name,is_active,clinic_id') + '&order=doctor_code.asc'),
          sbRestGet('program_settings?select=setting_key,setting_value&setting_key=in.(online_booking_enabled,clinic_display_name)')
            .catch(function () { return []; })
        ]);
      })
      .then(function (parts) {
        var settings = {};
        (parts[2] || []).forEach(function (r) {
          if (r && r.setting_key) settings[r.setting_key] = String(r.setting_value != null ? r.setting_value : '');
        });
        return {
          clinics: (parts[0] || []).filter(function (c) { return c.is_active !== false; }),
          doctors: clinicalDoctors(parts[1] || []),
          visitReasons: VISIT_REASONS,
          enabled: settings.online_booking_enabled !== 'false',
          settings: settings,
          source: 'direct'
        };
      });
  }

  function applyOptions(res) {
    if (res.enabled === false) {
      showError('formError', t('errDisabled'));
      $('btnBook').disabled = true;
      return;
    }
    clinics = res.clinics || [];
    doctors = clinicalDoctors(res.doctors || []);
    visitReasons = res.visitReasons || VISIT_REASONS;
    if (!clinics.length) {
      clinics = [{ clinic_code: 'MAIN', english_name: 'Joyful Smile', address: '', tel: '' }];
    }
    if (!doctors.length) {
      showError('formError', t('errDisabled'));
      return;
    }
    fillClinics();
    filterDoctors();
    fillReasons();
    onClinicDoctorChange();
    if (res.source === 'direct' && !apiReachable) {
      showError('formError', '');
    }
  }

  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (k) el.textContent = t(k);
    });
    document.documentElement.lang = LANG === 'zh-Hant' ? 'zh-Hant' : (LANG === 'zh-CN' ? 'zh-CN' : 'en');
  }

  function showError(elId, msg) {
    var el = $(elId);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('show', !!msg);
  }

  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function isLoginPlaceholderDoctorCode(code) {
    var c = String(code || '').trim().toLowerCase();
    if (!c) return false;
    if (c === 'all') return true;
    return /^all[_-]/.test(c);
  }

  function clinicalDoctors(list) {
    return (list || []).filter(function (d) {
      return d && d.is_active !== false && String(d.doctor_code || '').trim() &&
        !isLoginPlaceholderDoctorCode(d.doctor_code);
    });
  }

  function fmt12(time) {
    if (!time) return t('timeTbc');
    var p = String(time).slice(0, 5).split(':');
    var h = parseInt(p[0], 10);
    var m = p[1] || '00';
    var ap = h >= 12 ? 'PM' : 'AM';
    return (h % 12 || 12) + ':' + m + ' ' + ap;
  }

  function parseDob(raw) {
    var s = String(raw || '').trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return m[3] + '-' + pad(parseInt(m[2], 10)) + '-' + pad(parseInt(m[1], 10));
    return null;
  }

  function slotsEmptyHtml() {
    return '<div class="ob-slots-empty-wrap">' +
      '<span class="ob-slots-empty">' + t('noSlots') + '</span>' +
      '<p class="ob-arrange-hint">' + t('arrangeHint') + '</p>' +
      '<div class="ob-arrange-banner">' + t('arrangeBanner') + '</div>' +
      '</div>';
  }

  function fmtDateDisplay(iso) {
    if (!iso) return '—';
    var p = iso.split('-');
    return pad(parseInt(p[2], 10)) + '/' + pad(parseInt(p[1], 10)) + '/' + p[0].slice(2);
  }

  function updateHeader(clinic) {
    if (!clinic) return;
    var name = clinic.english_name || clinic.clinic_code || 'Clinic';
    if (LANG !== 'en' && clinic.chinese_name) name = clinic.chinese_name;
    $('obClinicName').textContent = name;
    var addr = clinic.address || '';
    if (LANG !== 'en' && clinic.address_chinese) addr = clinic.address_chinese;
    var meta = addr;
    if (clinic.tel) meta += (meta ? '\n' : '') + 'Tel: ' + clinic.tel;
    $('obClinicMeta').textContent = meta || name;
  }

  function fillClinics() {
    var sel = $('fClinic');
    sel.innerHTML = '';
    clinics.forEach(function (c, i) {
      var o = document.createElement('option');
      o.value = c.clinic_code || '';
      var label = c.english_name || c.clinic_code;
      if (LANG !== 'en' && c.chinese_name) label = c.chinese_name + ' · ' + (c.english_name || '');
      o.textContent = label;
      sel.appendChild(o);
      if (i === 0) updateHeader(c);
    });
    sel.addEventListener('change', function () {
      var c = clinics.find(function (x) { return x.clinic_code === sel.value; });
      updateHeader(c);
      filterDoctors();
      onClinicDoctorChange();
    });
  }

  function filterDoctors() {
    var clinicCode = $('fClinic').value;
    var clinic = clinics.find(function (c) { return c.clinic_code === clinicCode; });
    var clinicId = clinic ? clinic.id : null;
    var sel = $('fDoctor');
    sel.innerHTML = '';
    var list = doctors.filter(function (d) {
      return !clinicId || !d.clinic_id || d.clinic_id === clinicId;
    });
    if (!list.length) list = doctors;
    list.forEach(function (d) {
      var o = document.createElement('option');
      o.value = d.doctor_code || '';
      var label = d.display_name || d.english_name || d.doctor_code;
      if (LANG !== 'en' && d.chinese_name) label = d.chinese_name + ' · ' + (d.english_name || '');
      o.textContent = label;
      o.dataset.name = d.english_name || d.doctor_code;
      sel.appendChild(o);
    });
  }

  function fillReasons() {
    var sel = $('fReason');
    sel.innerHTML = '';
    var none = document.createElement('option');
    none.value = '';
    none.textContent = t('reasonNone');
    sel.appendChild(none);
    visitReasons.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r.id;
      o.textContent = LANG === 'en' ? r.en : (r.zh || r.en);
      o.dataset.label = r.en;
      sel.appendChild(o);
    });
  }

  function loadSlots() {
    var grid = $('slotGrid');
    var date = $('fDate').value;
    var doctor = $('fDoctor').value;
    var clinic = $('fClinic').value;
    selectedSlot = '';
    if (!date || !doctor) {
      grid.innerHTML = '<span class="ob-slots-empty">' + t('pickDate') + '</span>';
      return;
    }
    if (Object.keys(dutyDateMap).length && !dutyDateMap[date]) {
      grid.innerHTML = slotsEmptyHtml();
      return;
    }
    var sessions = dutyDateMap[date] || {};
    var sessKeys = enabledSessionKeys(sessions);
    if (!sessKeys.length) {
      grid.innerHTML = slotsEmptyHtml();
      return;
    }
    if (sessKeys.length >= 2 && !selectedSession) selectedSession = sessKeys[0];
    grid.innerHTML = '<span class="ob-slots-loading">' + t('loading') + '</span>';
    bookingAction({
      action: 'get-slots',
      date: date,
      doctor_code: doctor,
      clinic_tag: clinic,
      duration: 30,
      session: sessKeys.length >= 2 ? selectedSession : ''
    }).then(function (res) {
      var slots = res.slots || [];
      if (!slots.length) {
        grid.innerHTML = slotsEmptyHtml();
        return;
      }
      grid.innerHTML = '';
      slots.forEach(function (s) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ob-slot';
        btn.textContent = fmt12(s);
        btn.dataset.slot = s;
        btn.addEventListener('click', function () {
          grid.querySelectorAll('.ob-slot').forEach(function (b) { b.classList.remove('selected'); });
          btn.classList.add('selected');
          selectedSlot = s;
        });
        grid.appendChild(btn);
      });
    }).catch(function () {
      grid.innerHTML = slotsEmptyHtml();
    });
  }

  function showConfirm(res) {
    $('stepForm').classList.remove('active');
    $('stepConfirm').classList.add('active');
    $('confirmDate').textContent = res.date ? fmtDateDisplay(res.date) : '—';
    $('confirmTime').textContent = res.start_time ? fmt12(res.start_time) : t('timeTbc');
    $('confirmRef').textContent = res.web_booking_ref || '';
    var noteEl = $('confirmNote');
    if (noteEl) {
      noteEl.textContent = res.arrange_requested ? t('confirmNoteArrange') : t('confirmNote');
    }
    document.title = t('booked');
  }

  function submitBooking() {
    showError('formError', '');
    var name = ($('fName').value || '').trim();
    var phone = ($('fPhone').value || '').replace(/\D/g, '');
    var dob = parseDob($('fDob').value || '');
    if (!name || !phone || !dob) {
      showError('formError', t('errNamePhone'));
      return;
    }

    var date = $('fDate').value || '';
    var doctorSel = $('fDoctor');
    var doctorCode = doctorSel.value || '';
    var doctorName = doctorSel.selectedOptions[0] ? doctorSel.selectedOptions[0].dataset.name : doctorCode;
    var reasonSel = $('fReason');
    var reasonId = reasonSel.value || '';
    var reasonLabel = reasonSel.selectedOptions[0] && reasonSel.value
      ? reasonSel.selectedOptions[0].textContent
      : '';

    if (!date) {
      showError('formError', t('errDate'));
      return;
    }

    var btn = $('btnBook');
    btn.disabled = true;
    btn.innerHTML = '<span class="ob-spinner"></span>';

    bookingAction({
      action: 'request-booking',
      clinic_tag: $('fClinic').value || '',
      doctor_code: doctorCode,
      doctor_name: doctorName,
      date: date,
      start_time: selectedSlot || '',
      preferred_session: (!selectedSlot && selectedSession) ? selectedSession : '',
      duration: 30,
      patient_name: name,
      patient_chinese_name: ($('fNameZh').value || '').trim(),
      patient_phone: phone,
      patient_dob: dob,
      reason_id: reasonId,
      reason_label: reasonLabel
    }).then(function (res) {
      btn.disabled = false;
      btn.textContent = t('bookBtn');
      showConfirm(res);
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = t('bookBtn');
      var msg = e.message || t('errGeneric');
      if (e.rpcMissing || e.status === 404) msg = t('errRpcMissing');
      showError('formError', msg);
    });
  }

  function init() {
    applyI18n();

    document.querySelectorAll('.ob-lang-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        LANG = b.dataset.lang || 'en';
        document.querySelectorAll('.ob-lang-btn').forEach(function (x) {
          x.classList.toggle('active', x.dataset.lang === LANG);
        });
        applyI18n();
        fillReasons();
        var c = clinics.find(function (x) { return x.clinic_code === $('fClinic').value; });
        updateHeader(c);
      });
    });

    $('fDoctor').addEventListener('change', onClinicDoctorChange);
    $('obCalPrev').addEventListener('click', function () {
      calViewMonth--;
      if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
      renderPatientCalendar();
    });
    $('obCalNext').addEventListener('click', function () {
      calViewMonth++;
      if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
      renderPatientCalendar();
    });
    var dobMax = new Date();
    $('fDob').max = dobMax.getFullYear() + '-' + pad(dobMax.getMonth() + 1) + '-' + pad(dobMax.getDate());
    var dobMin = new Date();
    dobMin.setFullYear(dobMin.getFullYear() - 120);
    $('fDob').min = dobMin.getFullYear() + '-' + pad(dobMin.getMonth() + 1) + '-' + pad(dobMin.getDate());

    $('btnBook').addEventListener('click', submitBooking);

    apiCall({ action: 'get-options' }).then(function (res) {
      applyOptions(res);
    }).catch(function () {
      if (CFG.supabaseUrl && CFG.anonKey) {
        return loadOptionsDirect().then(applyOptions);
      }
      showError('formError', t('errGeneric') +
        (CFG.preferLocal ? ' Is the local API running on port 8788?' : ' Try ?local=1 with start-online-booking.bat.'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
