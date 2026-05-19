// ════════════════════════════════════════════════════════════════
// APPOINTMENT MODULE
// ════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
var apptEditId   = null;
var psTimer      = null;
var calDate      = new Date();
var calView      = 'weekly';
var billApptId   = null;
var billPatId    = null;
var billPatName  = null;
var billPatNo    = null;
var billItems    = [];
var billDoctorList = [];
var treatmentItemsCache = [];

var todayAppts   = [];   // last-fetched list for the Today tab (used by print)
/** Today's walk-in appointment id awaiting patient registration before check-in. */
var todayApptPendingPatientRegId = null;

/** Appointment id whose remarks are open in `queueRemarksModal`. */
var queueRemarksEditApptId = null;
var queueRemarksModalBound = false;

/** When true, appointment date must be today or later (records tab: new visit from a past row). */
var arBookingMinDateToday = false;

// ── Pending bill item lists (Step 1 / Step 2) ─────────
var pendingLists = [];   // array fetched from pending_bill_items table
var pendingIdx   = -1;   // which list is open in Step 1
var payItems     = [];   // items from the list selected in Step 2
var payPendingId = null; // DB id of the list selected for payment

// ════════════════════════════════════════════════════════════════
// CLINIC SCOPE (all appointment subtabs share one clinic)
// ════════════════════════════════════════════════════════════════
function applyApptModuleClinicQuery(builder) {
    if (!builder) return builder;
    var tag = typeof currentClinicCodeForTagging === 'function'
        ? currentClinicCodeForTagging()
        : '';
    if (!tag) return builder;
    var field = typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined'
        ? APPOINTMENT_CLINIC_TAG_FIELD
        : 'clinic_tag';
    return builder.eq(field, tag);
}

function populateApptClinicSelect() {
    var sel = g('apptClinicSelect');
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '';
    if (!APP_CLINICS || !APP_CLINICS.length) {
        sel.innerHTML = '<option value="">(No clinics)</option>';
        return;
    }
    APP_CLINICS.forEach(function(c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = (c.clinic_code ? ('[' + c.clinic_code + '] ') : '') +
            (c.english_name || c.chinese_name || 'Clinic');
        sel.appendChild(o);
    });
    var def = typeof defaultWorkingClinicId === 'function'
        ? defaultWorkingClinicId()
        : (APP_CLINICS[0] ? APP_CLINICS[0].id : '');
    var has = false;
    for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === prev) { has = true; break; }
    }
    sel.value = has ? prev : def;
}

function reloadApptModuleData() {
    if (!apptSectionIsActive()) return;
    var tab = apptActiveTabKey();
    if (tab === 'queue') loadQueue();
    else if (tab === 'today') loadToday();
    else if (tab === 'calendar') renderCal();
    else if (tab === 'records') loadApptRecords();
    else if (tab === 'recall') {
        if (typeof rcDate !== 'undefined' && rcDate) loadRecallPatients(rcDate);
        else initRecallTab();
    }
}

function onApptClinicChange() {
    var sel = g('apptClinicSelect');
    if (!sel || !sel.value) return;
    if (typeof setWorkingClinic === 'function') {
        setWorkingClinic(sel.value, { syncFilters: true, reloadAppt: false });
    }
    reloadApptModuleData();
}

function bindApptClinicSelectOnce() {
    var sel = g('apptClinicSelect');
    if (!sel || sel.dataset.bound) return;
    sel.dataset.bound = '1';
    sel.addEventListener('change', onApptClinicChange);
}

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
function initAppt() {
    var un = g('apptUserName');
    var ur = g('apptUserRole');
    var ud = g('apptTodayDate');
    if (un) un.textContent = currentName || '-';
    if (ur) ur.textContent = currentRole || '-';
    syncApptTodayDateLabels();
    populateApptClinicSelect();
    bindApptClinicSelectOnce();
    var apSel = g('apptClinicSelect');
    if (apSel && apSel.value && typeof setWorkingClinic === 'function') {
        setWorkingClinic(apSel.value, { syncFilters: true, reloadAppt: false });
    }
    var qb = g('queueBody');
    if (qb) bindQueueReorderHandlers(qb);
    bindQueueRemarksModalOnce();
    switchApptTab('queue');
    restartApptAutoRefresh();
}

// ════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ════════════════════════════════════════════════════════════════
function switchApptTab(tab) {
    document.querySelectorAll('.appt-tab').forEach(function(b) {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-pane').forEach(function(p) {
        p.classList.toggle('active', p.id === 'tab-' + tab);
    });
    if (tab === 'queue')    loadQueue();
    if (tab === 'today')    loadToday();
    if (tab === 'calendar') { calDate = new Date(); renderCal(); }
    if (tab === 'records')  loadApptRecords();
    if (tab === 'recall')   initRecallTab();
}

// ════════════════════════════════════════════════════════════════
// AUTO REFRESH — reception + surgery on same data (no manual refresh)
// Interval from Configuration → Program Settings → "Queue Refresh (sec)".
// ════════════════════════════════════════════════════════════════
var apptAutoRefreshTimer = null;
var DEFAULT_QUEUE_REFRESH_MS = 30000;

function apptSectionIsActive() {
    var sec = g('appointmentSection');
    if (!sec) return false;
    var d = sec.style.display;
    return d !== 'none' && d !== '';
}

function apptActiveTabKey() {
    var t = document.querySelector('#appointmentSection .appt-tab.active');
    return t && t.dataset ? t.dataset.tab : null;
}

function apptAutoRefreshTick() {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!apptSectionIsActive()) return;
    var tab = apptActiveTabKey();
    if (tab === 'queue') loadQueue();
    else if (tab === 'today') loadToday();
}

function stopApptAutoRefresh() {
    if (apptAutoRefreshTimer) {
        clearInterval(apptAutoRefreshTimer);
        apptAutoRefreshTimer = null;
    }
}

function fetchQueueRefreshIntervalMs(done) {
    var fallback = DEFAULT_QUEUE_REFRESH_MS;
    if (!SB || typeof SB.from !== 'function') {
        if (done) done(fallback);
        return;
    }
    SB.from('program_settings')
        .select('setting_value')
        .eq('setting_key', 'queue_refresh_interval')
        .limit(1)
        .then(function(r) {
            var ms = fallback;
            if (!r.error && r.data && r.data.length) {
                var n = parseInt(r.data[0].setting_value, 10);
                if (!isNaN(n) && n >= 10) ms = n * 1000;
            }
            if (done) done(ms);
        })
        .catch(function() {
            if (done) done(fallback);
        });
}

/** Call from initAppt and after saving Program Settings (Configuration). */
function restartApptAutoRefresh() {
    stopApptAutoRefresh();
    fetchQueueRefreshIntervalMs(function(ms) {
        apptAutoRefreshTimer = setInterval(apptAutoRefreshTick, ms);
    });
}

// ════════════════════════════════════════════════════════════════
// APPOINTMENT RECORDS TAB
// ════════════════════════════════════════════════════════════════
var arFilter      = 'all';   // 'all' | 'upcoming' | 'past' | 'noshow'
var arSearchTerm  = '';
var arAllData     = [];      // cached from last fetch
var arSearchTimer = null;

function setArFilter(f) {
    arFilter = f;
    document.querySelectorAll('.ar-filter-btn').forEach(function(b) {
        var active = b.dataset.filter === f;
        b.style.background    = active ? '#0084ff' : '#fff';
        b.style.color         = active ? '#fff'    : '#374151';
        b.style.borderColor   = active ? '#0084ff' : '#e5e7eb';
    });
    arRender();
}

function arSearchDebounce() {
    clearTimeout(arSearchTimer);
    arSearchTimer = setTimeout(function() {
        arSearchTerm = (g('arSearchInput').value || '').trim().toLowerCase();
        arRender();
    }, 220);
}

function loadApptRecords() {
    var tbody = g('arBody');
    if (!tbody) return;
    tbody.innerHTML =
        '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:30px;">' +
        'Loading…</td></tr>';

    var aq = SB.from('appointments')
        .select('*')
        .order('date', { ascending: false })
        .order('start_time', { ascending: false })
        .limit(500);
    aq = applyApptModuleClinicQuery(aq);
    aq
    .then(function(r) {
        if (r.error) {
            tbody.innerHTML =
                '<tr><td colspan="9" style="color:red;padding:20px;">' +
                esc(r.error.message) + '</td></tr>';
            return;
        }
        arAllData = r.data || [];
        arRender();
    });
}

function arRender() {
    var today = todayISO();
    var term  = arSearchTerm;

    var rows = arAllData.filter(function(a) {
        // Status filter
        var isPast     = a.date < today;
        var isFuture   = a.date >= today;
        var isNoshow   = /no.?show|failed|cancel/i.test(a.bill_status || '');
        var isDone     = /done|queue|arrived/i.test(a.bill_status || '') || isPast;

        if (arFilter === 'upcoming' && !(isFuture && !isNoshow)) return false;
        if (arFilter === 'past'     && !(isPast  && !isNoshow))   return false;
        if (arFilter === 'noshow'   && !isNoshow)                 return false;

        // Search filter
        if (term) {
            var haystack = [
                a.patient_name         || '',
                a.patient_chinese_name || '',
                a.patient_no           || '',
                a.treatment_items      || '',
                a.doctor_code          || '',
                a.remarks              || ''
            ].join(' ').toLowerCase();
            if (haystack.indexOf(term) < 0) return false;
        }
        return true;
    });

    var tbody    = g('arBody');
    var emptyMsg = g('arEmptyMsg');
    var countEl  = g('arCount');
    if (!tbody) return;

    if (countEl) countEl.textContent = rows.length + ' record' + (rows.length !== 1 ? 's' : '');

    if (!rows.length) {
        tbody.innerHTML = '';
        if (emptyMsg) emptyMsg.style.display = 'block';
        return;
    }
    if (emptyMsg) emptyMsg.style.display = 'none';

    // Group: upcoming first (asc), then past (already desc from server)
    var future = rows.filter(function(a) { return a.date >= today; })
                     .sort(function(x, y) {
                         return (x.date + x.start_time).localeCompare(y.date + y.start_time);
                     });
    var older  = rows.filter(function(a) { return a.date < today; });
    var sorted = future.concat(older);

    var html = '';

    // Section headers only in "All" view
    if (arFilter === 'all' && future.length && older.length) {
        html += arSectionHeader('🗓 Upcoming (' + future.length + ')', '#e8f4ff', '#0084ff');
        future.forEach(function(a) { html += arRow(a, today); });
        html += arSectionHeader('📋 Past Records (' + older.length + ')', '#f8fafc', '#64748b');
        older.forEach(function(a) { html += arRow(a, today); });
    } else {
        sorted.forEach(function(a) { html += arRow(a, today); });
    }

    tbody.innerHTML = html;
}

function arSectionHeader(label, bg, color) {
    return '<tr><td colspan="9" style="background:' + bg + ';color:' + color + ';' +
           'font-weight:700;font-size:11px;padding:6px 10px;letter-spacing:.5px;">' +
           label + '</td></tr>';
}

function arRow(a, today) {
    var isNoshow  = /no.?show|failed|cancel/i.test(a.bill_status || '');
    var isUpcoming = a.date >= today;
    var isDone    = /done/i.test(a.bill_status || '');

    var rowStyle = '';
    if (isNoshow)   rowStyle = 'background:#fff5f5;';
    else if (isUpcoming && a.date === today) rowStyle = 'background:#fffbeb;';
    else if (isUpcoming) rowStyle = 'background:#f0fdf4;';

    var statusBadge = arStatusBadge(a.bill_status, isUpcoming, a.date, today);

    var chinesePart = a.patient_chinese_name
        ? '<span style="font-family:\'PingFang HK\',\'Microsoft JhengHei\',sans-serif;' +
          'font-size:13px;font-weight:800;display:block;line-height:1.2;">' +
          esc(a.patient_chinese_name) + '</span>'
        : '';

    var walkInBadge = !a.patient_id
        ? '<span style="background:#fef3c7;color:#92400e;font-size:9px;font-weight:800;' +
          'padding:1px 4px;border-radius:3px;margin-left:3px;vertical-align:middle;">NEW</span>'
        : '';

    return '<tr style="' + rowStyle + 'cursor:pointer;" ' +
           'ondblclick="arOpenEdit(\'' + a.id + '\')">' +
           '<td style="white-space:nowrap;font-weight:600;">' + esc(a.date || '') + '</td>' +
           '<td style="white-space:nowrap;">' + fmt12(a.start_time) + '</td>' +
           '<td style="color:#64748b;">' + esc(a.patient_no || '—') + '</td>' +
           '<td>' + chinesePart +
               '<span style="font-size:12px;">' + esc(a.patient_name || '—') + walkInBadge + '</span>' +
           '</td>' +
           '<td style="font-size:12px;">' + esc(a.treatment_items || '—') + '</td>' +
           '<td style="font-size:12px;font-weight:700;color:#0084ff;">' +
               esc(a.doctor_code || a.doctor_name || '—') + '</td>' +
           '<td>' + statusBadge + '</td>' +
           '<td style="font-size:11px;color:#64748b;max-width:160px;' +
               'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
               esc(a.remarks || '') + '</td>' +
           '<td style="text-align:center;">' +
               '<button onclick="event.stopPropagation(); arOpenEdit(\'' + a.id + '\')" ' +
               'style="padding:3px 8px;font-size:11px;border:1px solid #cbd5e1;' +
               'border-radius:5px;background:#fff;cursor:pointer;color:#374151;" ' +
               'title="Book a new visit / edit upcoming">✏️</button>' +
           '</td>' +
           '</tr>';
}

function arStatusBadge(status, isUpcoming, date, today) {
    var s   = (status || 'Scheduled').trim();
    var low = s.toLowerCase();
    var bg, color;
    if (/no.?show|failed/i.test(s))      { bg = '#fee2e2'; color = '#b91c1c'; }
    else if (/cancel/i.test(s))           { bg = '#f1f5f9'; color = '#64748b'; }
    else if (/done/i.test(s))             { bg = '#dcfce7'; color = '#166534'; }
    else if (/queue|arrived/i.test(s))    { bg = '#fef3c7'; color = '#92400e'; }
    else if (isUpcoming && date === today){ bg = '#fef3c7'; color = '#92400e'; }
    else if (isUpcoming)                  { bg = '#dbeafe'; color = '#1d4ed8'; }
    else                                  { bg = '#f1f5f9'; color = '#475569'; }
    return '<span style="background:' + bg + ';color:' + color + ';font-size:11px;' +
           'font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;">' +
           esc(s) + '</span>';
}

var arOpenEditTimer = null;
function arOpenEdit(id) {
    var appt = arAllData.find(function(a) { return String(a.id) === String(id); });
    if (!appt) return;
    var today = todayISO();
    var rowDate = String(appt.date || '').trim();
    if (rowDate && rowDate < today) {
        openNewApptSamePatientFromRecord(appt);
    } else {
        openApptEditModal(appt);
    }
}

function openNewApptSamePatientFromRecord(appt) {
    apptEditId = null;
    resetApptBookingGuards();
    arBookingMinDateToday = true;

    var db = g('deleteApptBtn');
    if (db) db.style.display = 'none';

    g('apptModalTitle').textContent = '📅 New appointment (same patient)';

    sv('hPid',      appt.patient_id           || '');
    sv('hPno',      appt.patient_no           || '');
    sv('hPname',    appt.patient_name         || '');
    sv('hPchinese', appt.patient_chinese_name || '');

    g('psInput').value =
        (appt.patient_chinese_name ? appt.patient_chinese_name + ' ' : '') +
        (appt.patient_name || '') +
        (appt.patient_no ? ' (#' + appt.patient_no + ')' : '');
    g('psSelName').textContent    = appt.patient_name || '-';
    g('psSelNo').textContent      = appt.patient_no   || '-';
    g('psSelected').style.display = 'block';

    var tday = todayISO();
    sv('fDate', tday);
    var fd = g('fDate');
    if (fd) fd.setAttribute('min', tday);

    sv('fTreatment', '');
    sv('fRemarks',   '');
    sv('npName',   '');
    sv('npPhone',  '');

    if (!appt.patient_id) {
        sv('npName', appt.patient_name || '');
        var ph = '';
        if (appt.remarks) {
            var m2 = appt.remarks.match(/Ph:\s*([^\|]+)/);
            if (m2) ph = m2[1].trim();
        }
        sv('npPhone', ph);
        switchApptPatientMode('new');
    } else {
        switchApptPatientMode('exist');
    }

    buildTimeSlots();
    loadApptDoctors(appt.doctor_code || appt.doctor_name || '');
    sv('fStart', '09:00');
    sv('fDur',   '30');
    calcEnd();
    openModal('apptModal');
}

// ════════════════════════════════════════════════════════════════
// RECALL PATIENT TAB
// ════════════════════════════════════════════════════════════════
var rcDate      = '';          // YYYY-MM-DD currently selected
var rcMonthD    = new Date();  // month shown in recall mini-calendar
var rcPatients  = [];          // enriched appointment rows for selected date
var rcSelIds    = {};          // { apptId: true }
var rcContact   = 'whatsapp';  // 'whatsapp' | 'sms'
var rcTemplates = [];          // saved templates (localStorage)
var rcSendQueue = [];          // patients to step through when sending
var rcSendIdx   = 0;
var RC_TMPL_KEY = 'recall_templates_v1';

function initRecallTab() {
    rcDate   = todayISO();
    rcMonthD = new Date();
    loadRcTemplates();
    renderRcal();
    loadRecallPatients(rcDate);
}

// ── Mini Calendar ────────────────────────────────────────────────
function renderRcal() {
    var wrap = g('rcalContainer');
    if (!wrap) return;
    var y     = rcMonthD.getFullYear();
    var m     = rcMonthD.getMonth();          // 0-based
    var today = todayISO();
    var dow0  = new Date(y, m, 1).getDay();  // weekday of 1st
    var daysM = new Date(y, m + 1, 0).getDate();
    var mLbl  = new Date(y, m, 1).toLocaleDateString('en-HK', { month: 'long', year: 'numeric' });

    var html =
        '<div class="rcal-header">' +
            '<button class="rcal-nav" onclick="rcalPrev()">&#8249;</button>' +
            '<span class="rcal-title">' + mLbl + '</span>' +
            '<button class="rcal-nav" onclick="rcalNext()">&#8250;</button>' +
        '</div>' +
        '<table class="rcal-table"><thead><tr>';
    ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(function(d) {
        html += '<th>' + d + '</th>';
    });
    html += '</tr></thead><tbody><tr>';

    for (var b = 0; b < dow0; b++) html += '<td></td>';

    var dow = dow0;
    for (var d = 1; d <= daysM; d++) {
        var iso = y + '-' + pad(m + 1) + '-' + pad(d);
        var cls = 'rcal-day';
        if (iso === rcDate) cls += ' rcal-sel';
        else if (iso === today) cls += ' rcal-today';
        else if (iso > today)   cls += ' rcal-future';

        html += '<td class="' + cls + '" onclick="rcSelectDate(\'' + iso + '\')">' + d + '</td>';
        dow++;
        if (dow % 7 === 0 && d < daysM) html += '</tr><tr>';
    }
    while (dow % 7 !== 0) { html += '<td></td>'; dow++; }
    html += '</tr></tbody></table>';

    wrap.innerHTML = html;
}

function rcalPrev() {
    rcMonthD = new Date(rcMonthD.getFullYear(), rcMonthD.getMonth() - 1, 1);
    renderRcal();
}
function rcalNext() {
    rcMonthD = new Date(rcMonthD.getFullYear(), rcMonthD.getMonth() + 1, 1);
    renderRcal();
}
function rcSelectDate(iso) {
    rcDate = iso;
    renderRcal();
    loadRecallPatients(iso);
}

// ── Patient Loader ───────────────────────────────────────────────
function loadRecallPatients(date) {
    rcSelIds = {};
    rcPatients = [];
    var tbody  = g('recallBody');
    var hdr    = g('recallDateHdr');
    var cntEl  = g('recallPtCount');
    if (!tbody) return;

    if (hdr) {
        hdr.textContent = date
            ? (typeof fmtDateLong === 'function'
                ? fmtDateLong(date, { long: true })
                : date)
            : '— select a date —';
    }
    if (cntEl) cntEl.textContent = '';
    tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:24px;">Loading…</td></tr>';

    if (!date) {
        tbody.innerHTML =
            '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:24px;">Please select a date.</td></tr>';
        return;
    }

    var rq = SB.from('appointments')
        .select('*')
        .eq('date', date)
        .order('start_time');
    rq = applyApptModuleClinicQuery(rq);
    rq.then(function(r) {
        if (r.error) {
            tbody.innerHTML =
                '<tr><td colspan="5" style="color:red;padding:20px;">' +
                esc(r.error.message) + '</td></tr>';
            return;
        }
        var appts  = r.data || [];
        var patIds = appts.map(function(a) { return a.patient_id; }).filter(Boolean);

        if (!patIds.length) {
            // Walk-ins or appointments without linked patients
            rcPatients = appts.map(function(a) { return Object.assign({}, a, { phone: '' }); });
            renderRecallTable();
            return;
        }

        SB.from('patients')
            .select('id,phone_number')
            .in('id', patIds)
        .then(function(pr) {
            var phoneMap = {};
            if (pr.data) pr.data.forEach(function(p) { phoneMap[p.id] = p.phone_number || ''; });
            rcPatients = appts.map(function(a) {
                return Object.assign({}, a, {
                    phone: a.patient_id ? (phoneMap[a.patient_id] || '') : ''
                });
            });
            renderRecallTable();
        });
    });
}

function renderRecallTable() {
    var tbody = g('recallBody');
    var cntEl = g('recallPtCount');
    if (!tbody) return;

    if (cntEl) cntEl.textContent = rcPatients.length
        ? rcPatients.length + ' patient' + (rcPatients.length !== 1 ? 's' : '')
        : '';

    if (!rcPatients.length) {
        tbody.innerHTML =
            '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:30px;">' +
            'No appointments on this date.</td></tr>';
        return;
    }

    var html = '';
    rcPatients.forEach(function(a) {
        var chk     = rcSelIds[a.id] ? 'checked' : '';
        var chinese = a.patient_chinese_name
            ? '<span class="rcal-chinese">' + esc(a.patient_chinese_name) + '</span>'
            : '';
        var phoneTd = a.phone
            ? esc(a.phone)
            : '<span style="color:#f87171;font-size:11px;">No phone</span>';
        html +=
            '<tr data-rid="' + a.id + '">' +
            '<td style="text-align:center;">' +
                '<input type="checkbox" class="rc-chk" ' + chk +
                ' onchange="rcToggleChk(this,\'' + a.id + '\')">' +
            '</td>' +
            '<td style="color:#64748b;">' + esc(a.patient_no || '—') + '</td>' +
            '<td>' + chinese +
                '<span style="font-size:12px;">' + esc(a.patient_name || '—') + '</span>' +
            '</td>' +
            '<td style="font-size:12px;">' + phoneTd + '</td>' +
            '<td style="font-size:11px;color:#64748b;">' + esc(a.treatment_items || '—') + '</td>' +
            '</tr>';
    });
    tbody.innerHTML = html;
}

function rcToggleChk(chk, id) {
    if (chk.checked) rcSelIds[id] = true;
    else delete rcSelIds[id];
}
function rcSelectAll() {
    rcPatients.forEach(function(a) { rcSelIds[a.id] = true; });
    document.querySelectorAll('#recallTable .rc-chk').forEach(function(c) { c.checked = true; });
}
function rcDeselectAll() {
    rcSelIds = {};
    document.querySelectorAll('#recallTable .rc-chk').forEach(function(c) { c.checked = false; });
}

// ── Contact method toggle ────────────────────────────────────────
function setRcContact(method) {
    rcContact = method;
    var waBtn  = g('rcContactWA');
    var smsBtn = g('rcContactSMS');
    if (waBtn) {
        waBtn.style.background   = method === 'whatsapp' ? '#25d366' : '#fff';
        waBtn.style.color        = method === 'whatsapp' ? '#fff'    : '#374151';
        waBtn.style.borderColor  = method === 'whatsapp' ? '#25d366' : '#e5e7eb';
    }
    if (smsBtn) {
        smsBtn.style.background  = method === 'sms' ? '#0084ff' : '#fff';
        smsBtn.style.color       = method === 'sms' ? '#fff'    : '#374151';
        smsBtn.style.borderColor = method === 'sms' ? '#0084ff' : '#e5e7eb';
    }
}

// ── Templates (localStorage) ─────────────────────────────────────
function loadRcTemplates() {
    try { rcTemplates = JSON.parse(localStorage.getItem(RC_TMPL_KEY) || '[]'); }
    catch(e) { rcTemplates = []; }
    renderRcTemplates();
}
function saveRcTemplate() {
    var txt = (g('recallMsgBox') && g('recallMsgBox').value || '').trim();
    if (!txt) { alert('Please enter a message before saving as template.'); return; }
    var name = prompt('Template name (e.g. "6-month recall"):');
    if (name === null || !name.trim()) return;
    rcTemplates.push({ id: Date.now(), name: name.trim(), content: txt });
    localStorage.setItem(RC_TMPL_KEY, JSON.stringify(rcTemplates));
    renderRcTemplates();
}
function renderRcTemplates() {
    var panel = g('recallTmplPanel');
    if (!panel) return;
    if (!rcTemplates.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    var html =
        '<div style="font-weight:700;font-size:12px;color:#64748b;margin-bottom:8px;' +
        'letter-spacing:.4px;">📄 SAVED TEMPLATES — click to apply</div>';
    rcTemplates.forEach(function(t) {
        html +=
            '<div class="rc-tmpl-item">' +
            '<span class="rc-tmpl-name" onclick="applyRcTemplate(' + t.id + ')">' +
                esc(t.name) +
            '</span>' +
            '<button class="rc-tmpl-del" title="Delete template" ' +
                'onclick="deleteRcTemplate(' + t.id + ')">✕</button>' +
            '</div>';
    });
    panel.innerHTML = html;
}
function applyRcTemplate(id) {
    var tmpl = rcTemplates.filter(function(t) { return t.id === id; })[0];
    if (tmpl && g('recallMsgBox')) g('recallMsgBox').value = tmpl.content;
}
function deleteRcTemplate(id) {
    if (!confirm('Delete this template?')) return;
    rcTemplates = rcTemplates.filter(function(t) { return t.id !== id; });
    localStorage.setItem(RC_TMPL_KEY, JSON.stringify(rcTemplates));
    renderRcTemplates();
}

// ── Send Queue ───────────────────────────────────────────────────

/** Placeholders for recall message box ({name}, {date}, …). */
function buildRecallPersonalised(a) {
    var msg = (g('recallMsgBox') && g('recallMsgBox').value || '').trim();
    return msg
        .replace(/\{name\}/gi,    a.patient_name         || a.patient_chinese_name || '')
        .replace(/\{chinese\}/gi, a.patient_chinese_name || '')
        .replace(/\{date\}/gi,    rcDate)
        .replace(/\{phone\}/gi,   a.phone                || '')
        .replace(/\{no\}/gi,      a.patient_no           || '');
}

/** WhatsApp prefilled body length guard (GET URL limits). */
function recallTruncateForWaPrefill(text, maxLen) {
    var n = maxLen || 1500;
    if (text.length <= n) return text;
    return text.slice(0, n - 1) + '…';
}

/** Build Send URL — desktop targets WhatsApp Web; mobile uses wa.me (opens app reliably). */
function buildRecallWhatsAppOpenUrl(apptRow, personalised) {
    var digits = formatPhoneForWA(apptRow.phone);
    if (!digits) return '';
    var body = recallTruncateForWaPrefill(personalised, 1500);
    var enc = encodeURIComponent(body);
    var mobile =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent || '');
    if (mobile) {
        return 'https://wa.me/' + digits + '?text=' + enc;
    }
    return (
        'https://web.whatsapp.com/send?phone=' +
        encodeURIComponent(digits) +
        '&text=' +
        enc
    );
}

function startRecallSend() {
    var msg = (g('recallMsgBox') && g('recallMsgBox').value || '').trim();
    if (!msg) { alert('Please enter a recall message.'); return; }

    var selected = rcPatients.filter(function(a) { return rcSelIds[a.id]; });
    if (!selected.length) { alert('Please select at least one patient.'); return; }

    var noPhone = selected.filter(function(a) { return !a.phone; });
    if (noPhone.length) {
        var names = noPhone.map(function(a) {
            return a.patient_chinese_name || a.patient_name || 'Unknown';
        }).join(', ');
        var ok = confirm(
            noPhone.length + ' patient(s) have no phone number and will be skipped:\n' +
            names + '\n\nContinue with the rest?'
        );
        if (!ok) return;
    }

    rcSendQueue = selected.filter(function(a) { return a.phone; });
    if (!rcSendQueue.length) {
        alert('No patients with a valid phone number to contact.');
        return;
    }

    rcSendIdx = 0;
    showRcSendModal();
}

function showRcSendModal() {
    var content = g('rcSendContent');
    if (!content) return;

    if (rcSendIdx >= rcSendQueue.length) {
        closeModal('recallSendModal');
        alert('✅ All ' + rcSendQueue.length + ' patient(s) processed!');
        rcSendQueue = []; rcSendIdx = 0;
        return;
    }

    var a = rcSendQueue[rcSendIdx];

    var personalised = buildRecallPersonalised(a);

    var isWA = rcContact === 'whatsapp';
    var actionLabel = isWA ? '💬 Open WhatsApp Web' : '📱 Open SMS';
    var actionColor = isWA ? '#25d366' : '#0084ff';

    var progress = (rcSendIdx + 1) + ' of ' + rcSendQueue.length;
    var chinesePart = a.patient_chinese_name
        ? '<span style="font-family:\'PingFang HK\',\'Microsoft JhengHei\',sans-serif;' +
          'font-size:18px;font-weight:900;display:block;margin-bottom:3px;' +
          '-webkit-font-smoothing:antialiased;">' + esc(a.patient_chinese_name) + '</span>'
        : '';
    var isLast = rcSendIdx + 1 >= rcSendQueue.length;

    content.innerHTML =
        // Progress bar
        '<div style="display:flex;justify-content:space-between;align-items:center;' +
            'margin-bottom:12px;">' +
            '<span style="font-size:12px;background:#e8f4ff;color:#0084ff;' +
                'padding:3px 10px;border-radius:10px;font-weight:700;">' +
                '👤 ' + progress + '</span>' +
            '<span style="font-size:12px;font-weight:700;color:#64748b;">' +
                (isWA ? '💬 WhatsApp' : '📱 SMS') +
            '</span>' +
        '</div>' +
        (isWA
            ? '<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;' +
                'padding:8px 10px;margin-bottom:10px;font-size:11px;line-height:1.45;color:#065f46;">' +
                '<strong>WhatsApp Web:</strong> Opens a new browser tab with this patient and message filled in. ' +
                'If you only see a QR code, open ' +
                '<a href="https://web.whatsapp.com/" target="_blank" rel="noopener noreferrer" ' +
                'style="color:#047857;text-decoration:underline;">web.whatsapp.com</a> ' +
                'in another tab, scan to log in, then click <strong>Open WhatsApp Web</strong> again.' +
            '</div>'
            : '') +
        // Patient card
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;' +
            'padding:14px;margin-bottom:12px;">' +
            chinesePart +
            '<strong style="font-size:15px;">' + esc(a.patient_name || '—') + '</strong>' +
            (a.patient_no ? '<br><span style="font-size:11px;color:#94a3b8;">#' +
                esc(a.patient_no) + '</span>' : '') +
            '<br><span style="font-size:13px;font-weight:700;color:#0084ff;' +
                'margin-top:6px;display:block;">📞 ' + esc(a.phone) + '</span>' +
        '</div>' +
        // Message preview
        '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;' +
            'padding:10px 12px;margin-bottom:14px;font-size:12px;line-height:1.6;' +
            'white-space:pre-wrap;max-height:110px;overflow-y:auto;color:#1e293b;">' +
            esc(personalised) +
        '</div>' +
        (isWA
            ? '<button type="button" onclick="rcCopyRecallWaLink()" ' +
                'style="width:100%;margin-bottom:8px;font-size:11px;padding:8px 10px;' +
                'background:#fff;border:1px solid #cbd5e1;border-radius:8px;' +
                'cursor:pointer;color:#475569;font-weight:600;">' +
                '📋 Copy WhatsApp Web link</button>'
            : '') +
        // Action + Skip
        '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
            '<button type="button" onclick="rcOpenRecallSend()" ' +
                'style="flex:1;padding:11px 8px;background:' + actionColor + ';color:#fff;' +
                'border:none;border-radius:8px;text-align:center;font-weight:700;' +
                'font-size:13px;cursor:pointer;">' +
                actionLabel + '</button>' +
            '<button onclick="rcSendSkip()" ' +
                'style="padding:11px 14px;background:#f1f5f9;color:#64748b;border:none;' +
                'border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;">Skip</button>' +
        '</div>' +
        // Next / Done
        (isLast
            ? '<button onclick="rcSendDone()" ' +
              'style="width:100%;padding:11px;background:#10b981;color:#fff;border:none;' +
              'border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;">' +
              '✅ Done — All Sent</button>'
            : '<button onclick="rcSendNext()" ' +
              'style="width:100%;padding:11px;background:#475569;color:#fff;border:none;' +
              'border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">' +
              'Next Patient → (' + (rcSendIdx + 2) + ' of ' + rcSendQueue.length + ')</button>'
        );

    openModal('recallSendModal');
}

function rcSendNext() { rcSendIdx++; showRcSendModal(); }
function rcSendSkip() { rcSendIdx++; showRcSendModal(); }
function rcSendDone() {
    closeModal('recallSendModal');
    rcSendQueue = []; rcSendIdx = 0;
}

/** WhatsApp Web / SMS — opened via script so Chrome allows popup from user tap; WA uses web app on desktop. */
function rcOpenRecallSend() {
    if (!rcSendQueue || rcSendIdx >= rcSendQueue.length) return;
    var a = rcSendQueue[rcSendIdx];
    var personalised = buildRecallPersonalised(a);

    if (rcContact === 'sms') {
        var smsRaw = String(a.phone || '').replace(/\s/g, '');
        var smsUrl =
            'sms:' +
            smsRaw.replace(/[^\d+]/g, '') +
            '?body=' +
            encodeURIComponent(recallTruncateForWaPrefill(personalised, 1200));
        window.location.href = smsUrl;
        return;
    }

    var digits = formatPhoneForWA(a.phone);
    if (!digits || digits.length < 8) {
        alert('Cannot open WhatsApp — this patient needs a valid mobile number.');
        return;
    }

    var url = buildRecallWhatsAppOpenUrl(a, personalised);
    if (!url) {
        alert('Cannot build WhatsApp link.');
        return;
    }

    var w = window.open(url, '_blank', 'noopener,noreferrer');
    var blocked = !w || w.closed || typeof w.closed === 'undefined';
    if (!blocked) return;

    function fallbackPrompt(u) {
        if (typeof prompt === 'function') {
            prompt('Pop-up blocked — copy this URL and paste into the address bar:', u);
        } else {
            alert('Pop-up blocked. URL:\n' + u);
        }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
            alert(
                'Your browser blocked the new tab.\n\n' +
                'The WhatsApp link was copied — paste into the address bar (Ctrl+V) ' +
                'or allow pop-ups for this site and click again.'
            );
        }).catch(function() {
            fallbackPrompt(url);
        });
    } else {
        fallbackPrompt(url);
    }
}

/** Always copies desktop WhatsApp Web compose URL (works after login). */
function rcCopyRecallWaLink() {
    if (!rcSendQueue || rcSendIdx >= rcSendQueue.length) return;
    var a = rcSendQueue[rcSendIdx];
    var personalised = buildRecallPersonalised(a);
    var digits = formatPhoneForWA(a.phone);
    if (!digits || digits.length < 8) {
        alert('No valid mobile number for this patient.');
        return;
    }
    var url =
        'https://web.whatsapp.com/send?phone=' +
        encodeURIComponent(digits) +
        '&text=' +
        encodeURIComponent(recallTruncateForWaPrefill(personalised, 1500));

    function fallbackPrompt(u) {
        if (typeof prompt === 'function') prompt('Copy this WhatsApp Web URL:', u);
        else alert(u);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
            alert('WhatsApp Web link copied. Paste into Chrome / Edge address bar.');
        }).catch(function() {
            fallbackPrompt(url);
        });
    } else {
        fallbackPrompt(url);
    }
}

// Format phone for WhatsApp Web `phone=` param (digits only, HK → 852…)
function formatPhoneForWA(phone) {
    if (!phone) return '';
    var digits = phone.replace(/[^\d]/g, '');
    if (!digits.length) return '';
    if (digits.length === 8 && /^[569]/.test(digits)) return '852' + digits;
    if (digits.slice(0, 5) === '00852') return digits.slice(2);
    if (digits.slice(0, 4) === '8520' && digits.length >= 11) return '852' + digits.slice(4);
    return digits;
}

// ════════════════════════════════════════════════════════════════
// TIME SLOT BUILDER  (08:00 – 20:00 in 15-min steps)
// ════════════════════════════════════════════════════════════════
function buildTimeSlots() {
    var sel = g('fStart');
    if (!sel) return;
    sel.innerHTML = '';
    for (var h = 8; h <= 20; h++) {
        [0, 15, 30, 45].forEach(function(m) {
            if (h === 20 && m > 0) return;
            var val  = pad(h) + ':' + pad(m);
            var disp = fmt12(val);
            var o    = document.createElement('option');
            o.value       = val;
            o.textContent = disp;
            sel.appendChild(o);
        });
    }
    sel.value = '09:00';
    calcEnd();
}

function calcEnd() {
    var s = g('fStart');
    var d = g('fDur');
    var e = g('fEnd');
    if (!s || !d || !e) return;
    e.value = fmt12(addMins(s.value, d.value));
}

// ════════════════════════════════════════════════════════════════
// STATUS BADGE CLASS
// ════════════════════════════════════════════════════════════════
function statusClass(s) {
    var map = {
        'Scheduled': 'badge-scheduled',
        'Queue':     'badge-queue',
        'Done':      'badge-done',
        'No Show':   'badge-noshow',
        'Cancelled': 'badge-cancelled',
        'Billed':    'badge-billed',
        'Paid':      'badge-paid'
    };
    return map[s] || 'badge-scheduled';
}

// ════════════════════════════════════════════════════════════════
// PATIENT SEARCH  (appointment modal)
// ════════════════════════════════════════════════════════════════
function doPatientSearch() {
    var q  = (g('psInput').value || '').trim();
    var dd = g('psDrop');
    if (!q) { dd.style.display = 'none'; return; }

    var pq = SB.from('patients')
        .select('id,patient_no,full_name,chinese_name,phone_number')
        .or(
            'full_name.ilike.%' + q + '%,' +
            'patient_no.ilike.%' + q + '%,' +
            'chinese_name.ilike.%' + q + '%'
        )
        .limit(8);
    /* Patients are global; appointment clinic only scopes saved visits. */
    pq.then(function(r) {
        dd.innerHTML = '';
        if (r.error || !r.data || !r.data.length) {
            dd.innerHTML =
                '<div class="ps-item" style="color:#aaa;">' +
                'No patients found</div>';
            dd.style.display = 'block';
            return;
        }
        r.data.forEach(function(p) {
            var item = document.createElement('div');
            item.className = 'ps-item';
            item.innerHTML =
                (p.chinese_name
                    ? '<span style="font-family:\'PingFang HK\',\'Microsoft JhengHei\',sans-serif;' +
                      'font-weight:700;font-size:14px;">' + esc(p.chinese_name) + '</span> '
                    : '') +
                '<strong>' + esc(p.full_name) + '</strong>' +
                '<br><small style="color:#aaa;">' +
                '#' + esc(p.patient_no || '-') +
                ' &nbsp;|&nbsp; ' + esc(p.phone_number || '') +
                '</small>';
            item.addEventListener('click', function() {
                g('hPid').value      = p.id;
                g('hPno').value      = p.patient_no    || '';
                g('hPname').value    = p.full_name;
                var hpc = g('hPchinese');
                if (hpc) hpc.value  = p.chinese_name  || '';
                g('psInput').value   =
                    (p.chinese_name ? p.chinese_name + ' ' : '') +
                    p.full_name + ' (#' + (p.patient_no || '') + ')';
                g('psSelName').textContent = p.full_name;
                g('psSelNo').textContent   = p.patient_no || '-';
                g('psSelected').style.display = 'block';
                dd.style.display = 'none';
            });
            dd.appendChild(item);
        });
        dd.style.display = 'block';
    });
}

// ════════════════════════════════════════════════════════════════
// APPOINTMENT MODAL  — open / save
// ════════════════════════════════════════════════════════════════
// ── Toggle between "Existing Patient" search and "New / Walk-in" mode ──
function switchApptPatientMode(mode) {
    var existSection = g('psSectionExist');
    var newSection   = g('psSectionNew');
    var existBtn     = g('psModeExistBtn');
    var newBtn       = g('psModeNewBtn');
    if (!existSection || !newSection) return;

    if (mode === 'new') {
        existSection.style.display = 'none';
        newSection.style.display   = '';
        existBtn.style.background  = '#fff';
        existBtn.style.color       = '#94a3b8';
        newBtn.style.background    = '#f59e0b';
        newBtn.style.color         = '#fff';
    } else {
        existSection.style.display = '';
        newSection.style.display   = 'none';
        existBtn.style.background  = '#0084ff';
        existBtn.style.color       = '#fff';
        newBtn.style.background    = '#fff';
        newBtn.style.color         = '#94a3b8';
        // Clear new-patient inputs when switching back
        sv('npName',  '');
        sv('npPhone', '');
    }
}

function resetApptBookingGuards() {
    arBookingMinDateToday = false;
    var fd = g('fDate');
    if (fd) fd.removeAttribute('min');
}

function openApptModal(prefillDate) {
    apptEditId = null;
    resetApptBookingGuards();
    g('apptModalTitle').textContent = '📅 New Appointment';

    sv('psInput',  '');
    sv('hPid',     '');
    sv('hPno',     '');
    sv('hPname',   '');
    g('psSelected').style.display = 'none';
    var dd = g('psDrop');
    if (dd) dd.style.display = 'none';
    var db = g('deleteApptBtn');
    if (db) db.style.display = 'none';

    sv('fDate',      prefillDate || todayISO());
    sv('fTreatment', '');
    sv('fRemarks',   '');
    sv('npName',   '');
    sv('npPhone',  '');
    sv('hPchinese', '');

    switchApptPatientMode('exist');   // always start in search mode
    buildTimeSlots();
    loadApptDoctors('');
    openModal('apptModal');
}

function openApptEditModal(appt) {
    resetApptBookingGuards();
    var db = g('deleteApptBtn');
    if (db) db.style.display = 'block';

    apptEditId = appt.id;
    g('apptModalTitle').textContent = '✏️ Edit Appointment';

    sv('hPid',      appt.patient_id           || '');
    sv('hPno',      appt.patient_no           || '');
    sv('hPname',    appt.patient_name         || '');
    sv('hPchinese', appt.patient_chinese_name || '');

    g('psInput').value =
        (appt.patient_chinese_name ? appt.patient_chinese_name + ' ' : '') +
        (appt.patient_name || '') +
        (appt.patient_no ? ' (#' + appt.patient_no + ')' : '');
    g('psSelName').textContent    = appt.patient_name || '-';
    g('psSelNo').textContent      = appt.patient_no   || '-';
    g('psSelected').style.display = 'block';

    sv('fDate',      appt.date             || todayISO());
    sv('fTreatment', appt.treatment_items  || '');
    sv('fRemarks',   appt.remarks          || '');

    // If appointment has no patient_id it was a walk-in booking — restore that mode
    if (!appt.patient_id) {
        sv('npName',  appt.patient_name || '');
        // Pull phone out of remarks if it was stored there
        var ph = '';
        if (appt.remarks) {
            var m2 = appt.remarks.match(/Ph:\s*([^\|]+)/);
            if (m2) ph = m2[1].trim();
        }
        sv('npPhone', ph);
        switchApptPatientMode('new');
    } else {
        switchApptPatientMode('exist');
    }

    buildTimeSlots();
    loadApptDoctors(appt.doctor_code || appt.doctor_name || '');
    sv('fStart', appt.start_time ? appt.start_time.slice(0,5) : '09:00');

    if (appt.start_time && appt.end_time) {
        var sp = appt.start_time.split(':');
        var ep = appt.end_time.split(':');
        var sm = +sp[0]*60 + +sp[1];
        var em = +ep[0]*60 + +ep[1];
        var df = g('fDur');
        if (df) df.value = String(em - sm);
    }
    calcEnd();
    openModal('apptModal');
}

function saveAppt() {
    var date  = (g('fDate').value  || '').trim();
    var start = (g('fStart').value || '').trim();
    var dur   = parseInt(g('fDur').value || '30', 10);
    if (!date)  { alert('Please enter a date.'); return; }
    if (arBookingMinDateToday && date < todayISO()) {
        alert('Past dates cannot be used here. Choose today or a future date for this new booking.');
        return;
    }
    if (!start) { alert('Please select a start time.'); return; }

    // ── Determine patient info based on active mode ──────────────
    var isWalkIn = g('psSectionNew') && g('psSectionNew').style.display !== 'none';
    var pid, pname, pno;

    if (isWalkIn) {
        pname = (g('npName').value  || '').trim();
        if (!pname) { alert('Please enter the patient name.'); g('npName').focus(); return; }
        var phone = (g('npPhone').value || '').trim();
        // Append phone to remarks if provided
        var rem = (g('fRemarks').value || '').trim();
        if (phone) rem = rem ? rem + ' | Ph: ' + phone : 'Ph: ' + phone;
        g('fRemarks').value = rem;
        pid = '';    // no linked patient record
        pno = '';
    } else {
        pid   = (g('hPid').value   || '').trim();
        pname = (g('hPname').value || '').trim();
        pno   = (g('hPno').value   || '').trim();
        if (!pid) { alert('Please select a patient.'); return; }
    }

    var end = addMins(start, dur);

    var drSel  = g('fApptDoctor');
    var drCode = drSel ? (drSel.value || '').trim() : '';
    if (!drCode) {
        alert('Please select a doctor for this appointment.');
        if (drSel) drSel.focus();
        return;
    }
    var drObj  = billDoctorList
        ? billDoctorList.find(function(d) { return (d.doctor_code || d.id) === drCode; })
        : null;
    var drName = drObj ? (drObj.english_name || drObj.chinese_name || drCode) : drCode;

    var chineseName = isWalkIn ? '' : ((g('hPchinese') && g('hPchinese').value) || '');

    var payload = {
        patient_id:            pid   || null,
        patient_no:            pno   || null,
        patient_name:          pname || null,
        patient_chinese_name:  chineseName || null,
        date:                  date,
        start_time:            start,
        end_time:              end,
        duration:              dur,
        treatment_items:       (g('fTreatment').value || '').trim() || null,
        remarks:               (g('fRemarks').value   || '').trim() || null,
        bill_status:           apptEditId ? undefined : 'Scheduled'
    };
    if (drCode) {
        payload.doctor_code = drCode;
        payload.doctor_name = drName;
    }

    var apCt = typeof currentClinicCodeForTagging === 'function'
        ? currentClinicCodeForTagging()
        : '';
    if (apCt) payload[APPOINTMENT_CLINIC_TAG_FIELD] = apCt;

    Object.keys(payload).forEach(function(k) {
        if (payload[k] === undefined) delete payload[k];
    });

    function embedDoctorTagInRemarks(payload, code) {
        if (!code) return;
        var rem = String(payload.remarks || '').trim();
        rem = rem.replace(/\|@dr:[^|]*\|/gi, '').trim();
        payload.remarks = (rem ? rem + ' | ' : '') + '@dr:' + code + ' |';
    }

    var finishSave = function () {
        closeModal('apptModal');
        apptEditId = null;
        loadToday();
        loadQueue();
        loadApptRecords();
        if (typeof renderCal === 'function') {
            var apptSec = g('appointmentSection');
            if (apptSec && apptSec.style.display !== 'none') renderCal();
        }
    };

    var tryPayload = function (p, opts) {
        opts = opts || {};
        var prom = apptEditId
            ? SB.from('appointments').update(p).eq('id', apptEditId)
            : SB.from('appointments').insert([p]);
        prom.then(function (r) {
            if (r.error) {
                var msg = r.error.message || '';
                if (msg.indexOf('patient_chinese_name') >= 0) {
                    var p2 = Object.assign({}, p);
                    delete p2.patient_chinese_name;
                    tryPayload(p2, opts);
                } else if (msg.indexOf('doctor_code') >= 0 || msg.indexOf('doctor_name') >= 0) {
                    if (!opts.doctorRemarksFallback && drCode) {
                        var p2 = Object.assign({}, p);
                        delete p2.doctor_code;
                        delete p2.doctor_name;
                        embedDoctorTagInRemarks(p2, drCode);
                        tryPayload(p2, { doctorRemarksFallback: true });
                        return;
                    }
                    alert(
                        'This database is missing doctor columns on appointments. ' +
                        'Run sql/20260521_appointments_doctor_columns.sql in Supabase, then save again.'
                    );
                } else if (msg.indexOf('clinic_tag') >= 0) {
                    var p3 = Object.assign({}, p);
                    delete p3[APPOINTMENT_CLINIC_TAG_FIELD];
                    tryPayload(p3, opts);
                } else {
                    alert('Error: ' + msg);
                }
                return;
            }
            finishSave();
        });
    };
    tryPayload(payload, {});
}
function deleteAppt() {
    if (!apptEditId) return;
    if (!confirm('Delete this appointment? This cannot be undone.')) return;

    SB.from('appointments')
        .delete()
        .eq('id', apptEditId)
    .then(function(r) {
        if (r.error) { alert('Error: ' + r.error.message); return; }
        closeModal('apptModal');
        apptEditId = null;
        loadToday();
        loadQueue();
        loadApptRecords();
        if (typeof renderCal === 'function') {
            var apptSec = g('appointmentSection');
            if (apptSec && apptSec.style.display !== 'none') renderCal();
        }
    });
}

// ── Load doctor list into appointment doctor dropdown ──────────
function renderApptDoctorColorPreview() {
    var sel = g('fApptDoctor');
    var dot = g('apptDoctorColorDot');
    var lbl = g('apptDoctorColorLabel');
    if (!sel || !dot) return;
    var code = (sel.value || '').trim();
    if (!code) {
        dot.style.background = '#e2e8f0';
        dot.style.borderColor = '#cbd5e1';
        if (lbl) lbl.textContent = 'Select a doctor';
        return;
    }
    var col = '#94a3b8';
    var sty = null;
    if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.getStyleForAppt) {
        sty = CalDoctorColors.getStyleForAppt({ doctor_code: code, doctor_name: '' });
        col = sty.borderColor;
    } else if (typeof CalDoctorColors !== 'undefined') {
        col = CalDoctorColors.getColor(code);
    }
    dot.style.background = col;
    dot.style.borderColor = col;
    var opt = sel.options[sel.selectedIndex];
    var name = opt ? opt.textContent : code;
    if (lbl) lbl.textContent = name + ' · ' + col;
}

function loadApptDoctors(selectVal) {
    var sel = g('fApptDoctor');
    if (!sel) return;
    var populate = function (list) {
        list = list || [];
        if (typeof currentClinicId !== 'undefined' && currentClinicId) {
            if (typeof doctorsForClinic === 'function') {
                list = doctorsForClinic(currentClinicId);
            } else {
                list = list.filter(function (d) { return d.clinic_id === currentClinicId; });
            }
        }
        while (sel.options.length > 1) sel.remove(1);
        if (!list.length) {
            var empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '(No doctors for this clinic)';
            empty.disabled = true;
            sel.appendChild(empty);
        }
        list.forEach(function (d) {
            var code = String(d.doctor_code || '').trim();
            if (!code) return;
            var opt = document.createElement('option');
            opt.value = code;
            var name = typeof doctorDisplayName === 'function'
                ? doctorDisplayName(d)
                : (d.english_name || d.chinese_name || code);
            opt.textContent = name + (d.doctor_code ? (' [' + d.doctor_code + ']') : '');
            sel.appendChild(opt);
        });
        if (selectVal) sel.value = selectVal;
        renderApptDoctorColorPreview();
    };
    if (!sel.dataset.colorPreviewWired) {
        sel.dataset.colorPreviewWired = '1';
        sel.addEventListener('change', renderApptDoctorColorPreview);
    }
    if (billDoctorList && billDoctorList.length) { populate(billDoctorList); return; }
    SB.from('doctors').select('*').order('doctor_code').then(function (r) {
        billDoctorList = r.data || [];
        populate(billDoctorList);
    });
}

// ════════════════════════════════════════════════════════════════
// Patient name — single field: Chinese first, English after (both subtabs + print)
// Chinese: prefer column on appointment, else look up patients.chinese_name
// ════════════════════════════════════════════════════════════════

/**
 * Resolves display Chinese: appointment.patient_chinese_name, else patients.chinese_name
 * (filled by augmentAppointmentsChineseFromPatients).
 */
function getApptDisplayChinese(a) {
    if (!a) return '';
    if (typeof a._merged_chinese_name === 'string') {
        return a._merged_chinese_name;
    }
    return String(a.patient_chinese_name || '').trim();
}

/**
 * Mutates each row: _merged_chinese_name = trimmed(appt field || patient.chinese_name)
 */
function augmentAppointmentsChineseFromPatients(rows, callback) {
    rows = rows || [];
    var pmap = {};
    var seen = {};
    var ids  = [];
    rows.forEach(function(a) {
        if (a.patient_id && !seen[a.patient_id]) {
            seen[a.patient_id] = true;
            ids.push(a.patient_id);
        }
    });

    function finalize() {
        rows.forEach(function(a) {
            var fromAppt =
                String(a.patient_chinese_name || '').trim();
            var fromPat =
                (a.patient_id && pmap[a.patient_id])
                    ? String(pmap[a.patient_id]).trim()
                    : '';
            a._merged_chinese_name = fromAppt || fromPat;
        });
        if (callback) callback(rows);
    }

    if (!ids.length) {
        finalize();
        return;
    }

    SB.from('patients')
        .select('id,chinese_name')
        .in('id', ids)
    .then(function(pr) {
        if (!pr.error && pr.data) {
            pr.data.forEach(function(p) {
                pmap[p.id] = p.chinese_name;
            });
        }
        finalize();
    })
    .catch(function() {
        finalize();
    });
}

/** @returns {string} HTML (already escaped inner text) */
function apptPatientDisplayNameHTML(a, opt) {
    opt = opt || {};
    var cn = getApptDisplayChinese(a);
    var en = (a.patient_name || '').trim();

    var out = '';

    if (opt.walkIn && a && !a.patient_id) {
        out += '<span class="appt-walkin-badge">NEW</span>';
    }

    if (cn) {
        out += '<span class="appt-name-cn">' + esc(cn) + '</span>';
    }
    if (cn && en) {
        out += '<span class="appt-name-sep"> · </span>';
    }
    if (en) {
        out += '<span class="appt-name-en">' + esc(en) + '</span>';
    }
    if (!cn && !en) {
        out += '<span class="appt-name-en appt-name-missing">' +
            esc(opt.emptyLabel !== undefined ? opt.emptyLabel : '-') +
            '</span>';
    }

    return '<div class="appt-patient-name-field">' + out + '</div>';
}

// ════════════════════════════════════════════════════════════════
// TODAY'S APPOINTMENTS
// ════════════════════════════════════════════════════════════════
function syncApptTodayDateLabels() {
    var iso = todayISO();
    var lbl = g('todayLabel');
    var ud  = g('apptTodayDate');
    if (lbl) lbl.textContent = fmtDateLong(iso);
    if (ud) {
        ud.textContent = typeof fmtTodayLong === 'function'
            ? fmtTodayLong()
            : fmtDateLong(iso);
    }
}

function loadToday() {
    var cnt = g('todayCount');
    var tb  = g('todayBody');
    syncApptTodayDateLabels();
    tb.innerHTML =
        '<tr><td colspan="8" style="text-align:center;' +
        'color:#aaa;padding:24px;">Loading…</td></tr>';

    var tq = SB.from('appointments').select('*')
        .eq('date', todayISO())
        .order('start_time', {ascending: true});
    tq = applyApptModuleClinicQuery(tq);
    tq.then(function(r) {
        tb.innerHTML = '';
        var doStrip = function (apptRows) {
            if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.renderDoctorFilterStrip) {
                CalDoctorColors.renderDoctorFilterStrip('todayDoctorFilterBar', apptRows || []);
            }
        };
        if (r.error || !r.data || !r.data.length) {
            todayAppts = [];
            tb.innerHTML =
                '<tr><td colspan="8" style="text-align:center;' +
                'color:#aaa;padding:24px;">No appointments today' +
                '</td></tr>';
            if (cnt) cnt.textContent = '0 appointments';
            doStrip([]);
            return;
        }
        augmentAppointmentsChineseFromPatients(r.data, function(rows) {
            todayAppts = rows;
            var visible = typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts
                ? CalDoctorColors.filterAppts(rows) : rows;
            if (cnt) cnt.textContent = visible.length + ' appointment(s)';
            if (!visible.length) {
                tb.innerHTML =
                    '<tr><td colspan="8" style="text-align:center;' +
                    'color:#aaa;padding:24px;">' +
                    (rows.length
                        ? 'No appointments for the selected doctors'
                        : 'No appointments today') +
                    '</td></tr>';
            } else {
                visible.forEach(function(a) {
                    buildTodayRow(tb, a);
                });
            }
            doStrip(rows);
        });
    });
}

function todayApptNeedsPatientReg(a) {
    if (!a) return false;
    if (a.bill_status === 'Queue' || a.bill_status === 'Done') return false;
    return !a.patient_id;
}

function clearTodayApptPendingPatientReg() {
    todayApptPendingPatientRegId = null;
}

function openNewPatientForTodayAppt(a) {
    if (!a || !a.id) return;
    todayApptPendingPatientRegId = a.id;
    if (typeof openAddPatient !== 'function') {
        alert('Patient registration is not available.');
        return;
    }
    openAddPatient();
    setTimeout(function () {
        var en = String(a.patient_name || '').trim();
        var cn = String(a.patient_chinese_name || '').trim();
        if (en && g('fullName')) g('fullName').value = en;
        if (cn && g('chineseName')) g('chineseName').value = cn;
    }, 0);
}

/** Called from patient registration after saving a new patient (app-patient.js). */
function linkTodayApptAfterPatientRegistration(patient) {
    if (!todayApptPendingPatientRegId || !patient || !patient.id) return false;
    var apptId = todayApptPendingPatientRegId;
    todayApptPendingPatientRegId = null;

    SB.from('appointments')
        .update({
            patient_id:           patient.id,
            patient_no:           patient.patient_no || null,
            patient_name:         patient.full_name || null,
            patient_chinese_name: patient.chinese_name || null
        })
        .eq('id', apptId)
    .then(function (res) {
        if (res.error) {
            alert('Patient saved but could not link to appointment: ' + res.error.message);
            loadToday();
            return;
        }
        loadToday();
        alert(
            'Patient registered (No. ' + (patient.patient_no || '—') + ').\n' +
            'You can now use Check In to add them to the queue.'
        );
    });
    return true;
}

function buildTodayRow(tb, a) {
    var tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    var needsReg = todayApptNeedsPatientReg(a);
    var actionBtn = '';
    if (a.bill_status !== 'Queue' && a.bill_status !== 'Done') {
        if (needsReg) {
            actionBtn =
                '<button type="button" class="btn-today-newpatient btn-sm" ' +
                'style="background:#d97706;">New Patient</button>';
        } else {
            actionBtn =
                '<button type="button" class="btn-today-checkin btn-sm" ' +
                'style="background:var(--success);">Check In</button>';
        }
    }

    tr.innerHTML =
        '<td>' +
            '<strong>' + fmt12(a.start_time) + '</strong>' +
            ' – ' + fmt12(a.end_time) +
        '</td>' +
        '<td style="font-size:12px;color:#888;">' +
            esc(a.patient_no || '-') +
        '</td>' +
        '<td>' + apptPatientDisplayNameHTML(a, { walkIn: true }) + '</td>' +
        '<td>' + esc(a.treatment_items || '-') + '</td>' +
        '<td style="font-size:12px;color:#888;">' +
            esc(a.remarks || '-') +
        '</td>' +
        '<td style="text-align:center;">' +
            esc(a.duration ? a.duration + ' min' : '-') +
        '</td>' +
        '<td>' +
            '<span class="status-badge ' +
                statusClass(a.bill_status) + '">' +
                esc(a.bill_status || 'Scheduled') +
            '</span>' +
        '</td>' +
        '<td>' +
            '<div style="display:flex;gap:5px;flex-wrap:wrap;">' +
                '<button type="button" class="btn-today-edit btn-sm" ' +
                'style="background:var(--primary);">Edit</button>' +
                actionBtn +
            '</div>' +
        '</td>';

    tb.appendChild(tr);

    tr.addEventListener('dblclick', function () {
        if (a.bill_status === 'Queue' || a.bill_status === 'Done') {
            openApptEditModal(a);
            return;
        }
        if (todayApptNeedsPatientReg(a)) {
            openNewPatientForTodayAppt(a);
            return;
        }
        if (!confirm('Check in ' + (a.patient_name || 'this patient') + ' now?')) return;
        checkInFromToday(a.id);
    });

    tr.querySelector('.btn-today-edit')
        .addEventListener('click', function (e) {
            e.stopPropagation();
            openApptEditModal(a);
        });

    var np = tr.querySelector('.btn-today-newpatient');
    if (np) {
        np.addEventListener('click', function (e) {
            e.stopPropagation();
            openNewPatientForTodayAppt(a);
        });
    }

    var ci = tr.querySelector('.btn-today-checkin');
    if (ci) {
        ci.addEventListener('click', function (e) {
            e.stopPropagation();
            checkInPatient(a);
        });
    }
}

// ════════════════════════════════════════════════════════════════
// PRINT TODAY'S APPOINTMENT LIST
// ════════════════════════════════════════════════════════════════
function printTodayList() {
    var clinic  = (typeof currentClinicLabel !== 'undefined' && currentClinicLabel)
                  ? currentClinicLabel : 'Joyful Smile Clinic';
    var dateStr = (typeof fmtDateLong === 'function') ? fmtDateLong(todayISO()) : todayISO();
    var rows    = '';

    var printRows = typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts
        ? CalDoctorColors.filterAppts(todayAppts) : todayAppts;

    if (!printRows.length) {
        rows = '<tr><td colspan="6" style="text-align:center;color:#888;' +
               'padding:20px;">No appointments today</td></tr>';
    } else {
        printRows.forEach(function(a, i) {
            var timeStr = (typeof fmt12 === 'function')
                ? fmt12(a.start_time) + (a.end_time ? ' – ' + fmt12(a.end_time) : '')
                : (a.start_time || '-');
            var status  = a.bill_status || 'Scheduled';
            var cnRaw   = (a.patient_chinese_name || '').trim();
            var enRaw   = (a.patient_name || '').trim();
            var nmPrint = '';
            if (cnRaw && enRaw) {
                nmPrint =
                    '<span style="font-weight:800;font-size:13px;' +
                    'font-family:\'PingFang HK\',\'Microsoft JhengHei\',\'Noto Sans TC\'' +
                    ',sans-serif;">' + esc(cnRaw) + '</span>' +
                    ' <span style="color:#9ca3af;font-weight:bold;">·</span> ' +
                    '<strong style="font-size:13px;color:#334155;">' +
                    esc(enRaw) + '</strong>';
            } else if (cnRaw) {
                nmPrint =
                    '<strong style="font-weight:800;font-size:13px;' +
                    'font-family:\'PingFang HK\',\'Microsoft JhengHei\',\'Noto Sans TC\'' +
                    ',sans-serif;">' + esc(cnRaw) + '</strong>';
            } else {
                nmPrint = '<strong style="font-size:13px;color:#334155;">' +
                    esc(enRaw || '-') + '</strong>';
            }
            rows +=
                '<tr' + (i % 2 === 1 ? ' style="background:#f9fafb;"' : '') + '>' +
                '<td style="white-space:nowrap;">' + esc(timeStr) + '</td>' +
                '<td>' + esc(a.patient_no   || '-') + '</td>' +
                '<td style="vertical-align:middle;line-height:1.4;' +
                '-webkit-font-smoothing:antialiased;">' +
                nmPrint +
                '</td>' +
                '<td>' + esc(a.treatment_items || '-') + '</td>' +
                '<td>' + esc(a.remarks        || '-') + '</td>' +
                '<td style="text-align:center;">' +
                    esc(a.duration ? a.duration + ' min' : '-') + '</td>' +
                '<td>' + esc(status) + '</td>' +
                '</tr>';
        });
    }

    var html =
        '<!DOCTYPE html><html><head>' +
        '<meta charset="UTF-8">' +
        '<title>Appointments – ' + esc(dateStr) + '</title>' +
        '<style>' +
            'body{font-family:Arial,sans-serif;font-size:13px;color:#222;margin:24px;}' +
            'h2{margin:0 0 2px;font-size:18px;}' +
            'p.sub{margin:0 0 14px;color:#555;font-size:12px;}' +
            'table{width:100%;border-collapse:collapse;}' +
            'th{background:#1a73e8;color:#fff;padding:8px 10px;text-align:left;font-size:12px;}' +
            'td{padding:7px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;}' +
            'tfoot td{font-size:11px;color:#888;border-top:2px solid #e5e7eb;padding-top:6px;}' +
            '@media print{body{margin:10px;} button{display:none;}}' +
        '</style>' +
        '</head><body>' +
        '<h2>📋 ' + esc(clinic) + ' – Daily Appointment List</h2>' +
        '<p class="sub">' + esc(dateStr) + ' &nbsp;|&nbsp; ' +
            printRows.length + ' appointment(s)</p>' +
        '<table>' +
        '<thead><tr>' +
            '<th>Time</th><th>Patient No.</th><th>Name</th>' +
            '<th>Treatment</th><th>Remarks</th><th>Duration</th><th>Status</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr><td colspan="7">Printed on ' +
            new Date().toLocaleString('en-HK') + '</td></tr></tfoot>' +
        '</table>' +
        '<script>window.onload=function(){window.print();}<\/script>' +
        '</body></html>';

    var w = window.open('', '_blank', 'width=900,height=650');
    if (!w) { alert('Pop-up blocked – please allow pop-ups for this page.'); return; }
    w.document.write(html);
    w.document.close();
}

function checkInPatient(a) {
    if (todayApptNeedsPatientReg(a)) {
        alert('Please register this walk-in patient first (New Patient).');
        return;
    }
    var now = new Date();
    var arrivalTime = now.toISOString();

    var cq = SB.from('appointments')
        .select('in_queue')
        .eq('date',      todayISO())
        .not('in_queue', 'is', null)
        .order('in_queue', { ascending: false })
        .limit(1);
    cq = applyApptModuleClinicQuery(cq);
    cq.then(function(r) {
        var nextQ = 1;
        if (!r.error && r.data && r.data.length > 0) {
            nextQ = (r.data[0].in_queue || 0) + 1;
        }
        SB.from('appointments')
            .update({
                arrived:      true,
                arrival_time: arrivalTime,
                in_queue:     nextQ,
                bill_status:  'Queue'
            })
            .eq('id', a.id)
        .then(function(res) {
            if (res.error) { alert('Error: ' + res.error.message); return; }
            loadToday();
            loadQueue();
            switchApptTab('queue');
        });
    });
}

function queueDragBlockedTarget(el) {
    return !!(el && el.closest && el.closest(
        'input, button, textarea, select, .action-wrap, .action-drop, label, .queue-remarks-preview-wrap'
    ));
}

/** Targets where double-click should not open the patient editor (narrower than drag block). */
function queuePatientEditDblclickBlocked(el) {
    return !!(el && el.closest && el.closest(
        'button, input, textarea, select, .action-wrap, .action-drop, .queue-remarks-pencil'
    ));
}

/** Refresh appointment lists after patient details change from queue / today. */
function refreshApptListsAfterPatientEdit() {
    if (typeof loadQueue === 'function') loadQueue();
    if (typeof loadToday === 'function') loadToday();
}

function resolveQueueRowPatientId(q, done) {
    if (!q) { if (done) done(null); return; }
    if (q.patient_id) { if (done) done(q.patient_id); return; }
    var no = String(q.patient_no || '').trim();
    if (!no) { if (done) done(null); return; }
    SB.from('patients').select('id').eq('patient_no', no).limit(1)
    .then(function (r) {
        if (r.error || !r.data || !r.data.length) {
            if (done) done(null);
            return;
        }
        var pid = r.data[0].id;
        if (pid && q.id) {
            SB.from('appointments')
                .update({ patient_id: pid })
                .eq('id', q.id)
            .then(function () {
                q.patient_id = pid;
                if (done) done(pid);
            });
            return;
        }
        if (done) done(pid || null);
    });
}

function openEditPatientFromQueueRow(q) {
    if (!q) return;
    document.querySelectorAll('.action-drop.open').forEach(function (d) {
        d.classList.remove('open');
    });
    resolveQueueRowPatientId(q, function (pid) {
        if (pid && typeof openEditPatient === 'function') {
            openEditPatient(pid);
            return;
        }
        if (todayApptNeedsPatientReg(q)) {
            openNewPatientForTodayAppt(q);
            return;
        }
        alert(
            'No patient record is linked to this queue entry.\n' +
            'Register the patient first (Today tab: New Patient), or link a patient on the appointment.'
        );
    });
}

function queueFindRowByApptId(tbody, apptId) {
    if (!tbody || !apptId) return null;
    var rows = tbody.querySelectorAll('tr[data-appt-id]');
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].dataset.apptId === apptId) return rows[i];
    }
    return null;
}

function queueReorderInDom(tbody, draggedId, anchorTr, clientY) {
    var draggedEl = queueFindRowByApptId(tbody, draggedId);
    if (!draggedEl || !anchorTr || draggedEl === anchorTr) return false;
    var rect = anchorTr.getBoundingClientRect();
    var insertBefore = clientY < rect.top + rect.height / 2;
    draggedEl.remove();
    if (insertBefore) {
        tbody.insertBefore(draggedEl, anchorTr);
    } else {
        var nextEl = anchorTr.nextSibling;
        if (nextEl) tbody.insertBefore(draggedEl, nextEl);
        else tbody.appendChild(draggedEl);
    }
    return true;
}

function persistQueueOrder(tbody, done) {
    var ids = [];
    var rows = tbody.querySelectorAll('tr[data-appt-id]');
    for (var i = 0; i < rows.length; i++) ids.push(rows[i].dataset.apptId);
    if (!ids.length) {
        if (done) done(null);
        return;
    }

    Promise.all(ids.map(function(id, idx) {
        return SB.from('appointments').update({ in_queue: idx + 1 }).eq('id', id);
    }))
    .then(function(results) {
        for (var j = 0; j < results.length; j++) {
            if (results[j].error) {
                if (done) done(results[j].error);
                return;
            }
        }
        if (done) done(null);
    })
    .catch(function(e) {
        if (done) done(e);
    });
}

function clearQueueDropTargetClasses(tbody) {
    tbody.querySelectorAll('.queue-row-droptarget').forEach(function(row) {
        row.classList.remove('queue-row-droptarget');
    });
}

function bindQueueReorderHandlers(tbody) {
    if (!tbody || tbody.dataset.queueReorderBound === '1') return;
    tbody.dataset.queueReorderBound = '1';

    var dragEnteredTr = null;
    tbody.addEventListener('dragenter', function(e) {
        var row = e.target && e.target.closest
            ? e.target.closest('tr[data-appt-id]')
            : null;
        if (row !== dragEnteredTr) {
            clearQueueDropTargetClasses(tbody);
            dragEnteredTr = row;
            if (row) row.classList.add('queue-row-droptarget');
        }
    });
    tbody.addEventListener('dragover', function(e) {
        var row = e.target && e.target.closest
            ? e.target.closest('tr[data-appt-id]')
            : null;
        e.preventDefault();
        if (row) e.dataTransfer.dropEffect = 'move';
        else e.dataTransfer.dropEffect = 'none';
    }, false);
    tbody.addEventListener('dragleave', function(e) {
        if (!(e.relatedTarget && tbody.contains(e.relatedTarget))) {
            dragEnteredTr = null;
            clearQueueDropTargetClasses(tbody);
        }
    }, false);
    tbody.addEventListener('drop', function(e) {
        var anchor = e.target && e.target.closest
            ? e.target.closest('tr[data-appt-id]')
            : null;
        dragEnteredTr = null;
        clearQueueDropTargetClasses(tbody);
        if (!anchor) return;
        e.preventDefault();
        var dragId = e.dataTransfer.getData('text/plain');
        if (!dragId || dragId === anchor.dataset.apptId) return;
        if (!queueReorderInDom(tbody, dragId, anchor, e.clientY)) return;
        persistQueueOrder(tbody, function(err) {
            if (err) {
                alert('Could not save queue order: ' + (err.message || String(err)));
            }
            loadQueue();
        });
    }, false);
}

// ── Queue remarks modal (full text edit) ─────────────────────
function bindQueueRemarksModalOnce() {
    if (queueRemarksModalBound) return;
    var m = g('queueRemarksModal');
    if (!m) return;
    queueRemarksModalBound = true;

    m.addEventListener('click', function(e) {
        if (e.target === m) queueRemarksEditApptId = null;
    });

    function closeQm() {
        closeModal('queueRemarksModal');
        queueRemarksEditApptId = null;
    }

    var c1 = g('closeQueueRemarks');
    var c2 = g('cancelQueueRemarks');
    var sv = g('saveQueueRemarks');
    if (c1) c1.addEventListener('click', closeQm);
    if (c2) c2.addEventListener('click', closeQm);
    if (sv) {
        sv.addEventListener('click', function() {
            if (!queueRemarksEditApptId) return;
            var raw = g('queueRemarksText')
                ? (g('queueRemarksText').value || '').trim()
                : '';
            SB.from('appointments')
                .update({ remarks: raw || null })
                .eq('id', queueRemarksEditApptId)
                .then(function(res) {
                    if (res.error) {
                        alert('Error: ' + res.error.message);
                        return;
                    }
                    closeQm();
                    loadQueue();
                });
        });
    }
}

function openQueueRemarksEditor(q) {
    if (!q || !q.id) return;
    bindQueueRemarksModalOnce();

    queueRemarksEditApptId = q.id;
    var ta = g('queueRemarksText');
    var hi = g('queueRemarksApptHint');

    if (ta) ta.value = q.remarks || '';

    if (hi) {
        var cn = typeof getApptDisplayChinese === 'function'
            ? getApptDisplayChinese(q)
            : '';
        var en = (q.patient_name || '').trim();
        var name = [cn, en].filter(Boolean).join(' · ') || '(No name)';
        var bits = [name];
        if (q.start_time) bits.push(fmt12(q.start_time));
        if (q.patient_no) bits.push('#' + String(q.patient_no));
        hi.textContent = bits.join(' · ');
    }

    openModal('queueRemarksModal');
    if (ta) {
        requestAnimationFrame(function() {
            ta.focus();
            var L = ta.value.length;
            try {
                ta.setSelectionRange(L, L);
            } catch (e) {}
        });
    }
}

// ════════════════════════════════════════════════════════════════
// QUEUE
// ════════════════════════════════════════════════════════════════
function loadQueue() {
    var tb = g('queueBody');
    tb.innerHTML =
        '<tr><td colspan="8" style="text-align:center;' +
        'color:#aaa;padding:24px;">Loading…</td></tr>';

    var qq = SB.from('appointments').select('*')
        .eq('date',        todayISO())
        .eq('bill_status', 'Queue')
        .order('in_queue',   {ascending: true})
        .order('start_time', {ascending: true});
    qq = applyApptModuleClinicQuery(qq);
    qq.then(function(r) {
        tb.innerHTML = '';
        var doStrip = function (apptRows) {
            if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.renderDoctorFilterStrip) {
                CalDoctorColors.renderDoctorFilterStrip('queueDoctorFilterBar', apptRows || []);
            }
        };
        if (r.error || !r.data || !r.data.length) {
            tb.innerHTML =
                '<tr><td colspan="8" style="text-align:center;' +
                'color:#aaa;padding:24px;">' +
                'No patients in queue</td></tr>';
            var qc = g('queueCount');
            if (qc) qc.textContent = '0 patients';
            doStrip([]);
            return;
        }
        var qc = g('queueCount');
        augmentAppointmentsChineseFromPatients(r.data, function(rows) {
            var visible = typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts
                ? CalDoctorColors.filterAppts(rows) : rows;
            if (qc) qc.textContent = visible.length + ' patient(s)';
            if (!visible.length) {
                tb.innerHTML =
                    '<tr><td colspan="8" style="text-align:center;' +
                    'color:#aaa;padding:24px;">' +
                    (rows.length
                        ? 'No patients in queue for the selected doctors'
                        : 'No patients in queue') +
                    '</td></tr>';
            } else {
                visible.forEach(function(q, idx) {
                    buildQueueRow(tb, q, idx + 1);
                });
            }
            doStrip(rows);
        });
    });
}

// seqNo: 1-based consultation order (top of list = first to see the doctor).
function buildQueueRow(tb, q, seqNo) {
    var tr  = document.createElement('tr');
    var uid = q.id.replace(/-/g, '').slice(0, 12);

    tr.dataset.apptId = q.id;
    tr.classList.add('queue-row-draggable');
    tr.draggable = true;
    tr.title =
        'Drag this row onto another row (above/below midpoint) ' +
        'to change consultation order.\n\n' +
        'Double-click the row (outside buttons) to edit patient information.';

    tr.innerHTML =
        '<td>' +
            '<span style="background:#e8f4ff;color:var(--primary);' +
            'font-weight:700;font-size:13px;padding:3px 9px;' +
            'border-radius:12px;">' +
                esc(String(seqNo)) +
            '</span>' +
        '</td>' +
        '<td>' +
            apptPatientDisplayNameHTML(q, { walkIn: true }) +
            (q.patient_no
                ? '<div class="appt-name-subno">' +
                  esc(q.patient_no) +
                  '</div>'
                : '') +
        '</td>' +
        '<td style="font-size:13px;">' +
            esc(q.treatment_items || '-') +
        '</td>' +
        '<td>' +
            '<strong>' + fmt12(q.start_time) + '</strong>' +
        '</td>' +
        '<td>' +
            (q.arrival_time
                ? '<span style="color:var(--success);font-weight:600;">' +
                  new Date(q.arrival_time).toLocaleTimeString('en-HK', {
                      hour:   '2-digit',
                      minute: '2-digit'
                  }) + '</span>'
                : '<span style="color:#aaa;">—</span>') +
        '</td>' +
        '<td class="queue-remarks-cell">' +
            '<div class="queue-remarks-preview-wrap">' +
                ((q.remarks || '').trim()
                    ? '<div class="queue-remarks-snippet">' +
                      esc(q.remarks || '') +
                      '</div>'
                    : '<div class="queue-remarks-snippet queue-remarks-empty">' +
                      'No remarks yet' +
                      '</div>') +
                '<button type="button" class="queue-remarks-pencil" ' +
                'id="qrm-pencil-' + uid + '" ' +
                'title="View / edit remarks" aria-label="Edit remarks">' +
                '✎</button>' +
            '</div>' +
        '</td>' +
        '<td>' +
            '<span class="status-badge ' +
                statusClass(q.bill_status) + '">' +
                esc(q.bill_status || '-') +
            '</span>' +
        '</td>' +
        '<td>' +
            '<div class="action-wrap" id="aw-' + uid + '">' +
                '<button class="action-btn" id="ab-' + uid + '">' +
                    'Actions ▾' +
                '</button>' +
                '<div class="action-drop" id="ad-' + uid + '">' +
                    '<div class="action-item" id="act-bill-'   + uid + '">' +
                        '<span class="ai-icon">🧾</span>Open Bill' +
                    '</div>' +
                    '<div class="action-item" id="act-notes-'  + uid + '">' +
                        '<span class="ai-icon">📝</span>Clinical Notes' +
                    '</div>' +
                    '<div class="action-item" id="act-done-'   + uid + '">' +
                        '<span class="ai-icon">✅</span>Mark Done' +
                    '</div>' +
                    '<div class="action-item" id="act-noshow-' + uid + '">' +
                        '<span class="ai-icon">🚫</span>No Show' +
                    '</div>' +
                    '<div class="action-item" id="act-remove-' + uid + '">' +
                        '<span class="ai-icon">🗑</span>Remove' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</td>';

    tb.appendChild(tr);

    tr.addEventListener('dragstart', function(e) {
        if (queueDragBlockedTarget(e.target)) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData('text/plain', q.id);
        e.dataTransfer.effectAllowed = 'move';
        tr.classList.add('queue-row-dragging');
    });
    tr.addEventListener('dragend', function() {
        tr.classList.remove('queue-row-dragging');
    });

    tr.addEventListener('dblclick', function (e) {
        if (queuePatientEditDblclickBlocked(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        openEditPatientFromQueueRow(q);
    });

    var drop = g('ad-' + uid);
    var btn  = g('ab-' + uid);

    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        document.querySelectorAll('.action-drop.open')
            .forEach(function(d) {
                if (d !== drop) d.classList.remove('open');
            });
        if (drop.classList.contains('open')) {
            drop.classList.remove('open');
            return;
        }
        var rect  = btn.getBoundingClientRect();
        var dropH = 240;
        var top   = (rect.bottom + dropH > window.innerHeight)
            ? rect.top - dropH + window.scrollY
            : rect.bottom    + window.scrollY + 4;
        var left  = rect.right - 200;
        drop.style.top  = top  + 'px';
        drop.style.left = left + 'px';
        drop.classList.add('open');
    });

    g('act-bill-' + uid).addEventListener('click', function(e) {
        e.stopPropagation();
        drop.classList.remove('open');
        setTimeout(function() { openBillPanel(q); }, 60);
    });

    g('act-notes-' + uid).addEventListener('click', function(e) {
        e.stopPropagation();
        drop.classList.remove('open');
        var pid = q.patient_id;
        if (!pid) {
            alert('No patient linked to this queue entry.');
            return;
        }
        setTimeout(function() { openConForPatient(pid); }, 80);
    });

    g('act-done-' + uid).addEventListener('click', function(e) {
        e.stopPropagation();
        drop.classList.remove('open');
        setTimeout(function() { updateQueueStatus(q.id, 'Done'); }, 60);
    });

    g('act-noshow-' + uid).addEventListener('click', function(e) {
        e.stopPropagation();
        drop.classList.remove('open');
        setTimeout(function() { updateQueueStatus(q.id, 'No Show'); }, 60);
    });

    g('act-remove-' + uid).addEventListener('click', function(e) {
        e.stopPropagation();
        drop.classList.remove('open');
        setTimeout(function() {
            if (!confirm(
                'Remove ' +
                (q.patient_name || 'this patient') +
                ' from queue?')) return;
            SB.from('appointments')
                .update({
                    bill_status: 'Scheduled',
                    in_queue:    null,
                    arrival_time: null
                })
                .eq('id', q.id)
            .then(function(res) {
                if (res.error) {
                    alert('Error: ' + res.error.message); return;
                }
                loadQueue();
            });
        }, 60);
    });

    var pencil = g('qrm-pencil-' + uid);
    if (pencil) {
        pencil.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            drop.classList.remove('open');
            openQueueRemarksEditor(q);
        });
    }
}

function updateQueueStatus(apptId, status) {
    var update = { bill_status: status };
    if (status === 'Done') {
        update.in_queue = null;
    }
    SB.from('appointments')
        .update(update)
        .eq('id', apptId)
    .then(function(r) {
        if (r.error) { alert('Error: ' + r.error.message); return; }
        loadQueue();
    });
}

// ════════════════════════════════════════════════════════════════
// CALENDAR
// ════════════════════════════════════════════════════════════════
function renderCal() {
    if (calView === 'weekly') renderWeekly();
    else                       renderMonthly();
}

// ── Monthly ───────────────────────────────────────────────────
function renderMonthly() {
    var y  = calDate.getFullYear();
    var m  = calDate.getMonth();
    var ct = g('calTitle');
    var cb = g('calBody');
    if (ct) ct.textContent =
        new Date(y, m, 1).toLocaleDateString('en-HK', {
            month: 'long', year: 'numeric'
        });

    var first = y + '-' + pad(m + 1) + '-01';
    var last  = y + '-' + pad(m + 1) + '-' +
                pad(new Date(y, m + 1, 0).getDate());

    var mq = SB.from('appointments').select('*')
        .gte('date', first)
        .lte('date', last)
        .order('start_time', {ascending: true});
    mq = applyApptModuleClinicQuery(mq);
    mq.then(function(r) {
        var appts = r.data || [];
        var map   = {};
        appts.forEach(function(a) {
            if (!map[a.date]) map[a.date] = [];
            map[a.date].push(a);
        });

        var html = '<div class="cal-grid gcal-month-grid">';
        ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(function(d) {
            html += '<div class="cal-day-hdr">' + d + '</div>';
        });

        var startDow    = new Date(y, m, 1).getDay();
        for (var b = 0; b < startDow; b++) {
            html += '<div class="cal-cell cal-blank"></div>';
        }

        var daysInMonth = new Date(y, m + 1, 0).getDate();
        var todayStr    = todayISO();
        for (var d2 = 1; d2 <= daysInMonth; d2++) {
            var iso  = y + '-' + pad(m + 1) + '-' + pad(d2);
            var isTo = iso === todayStr;
            var list = map[iso] || [];
            if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts) {
                list = CalDoctorColors.filterAppts(list);
            }
            html +=
                '<div class="cal-cell' +
                (isTo ? ' cal-today' : '') +
                '" data-date="' + iso + '">' +
                    '<div class="cal-cell-num">' + d2 + '</div>';
            var monthShow = 4;
            list.slice(0, monthShow).forEach(function(a) {
                html += typeof CalDoctorColors !== 'undefined'
                    ? CalDoctorColors.monthPillHtml(a)
                    : ('<div class="appt-pill" data-id="' + a.id + '">' +
                       fmt12(a.start_time) + ' ' + esc(a.patient_name || '') + '</div>');
            });
            if (list.length > monthShow) {
                html += '<div class="gcal-month-more">+' +
                    (list.length - monthShow) + ' more</div>';
            }
            html += '</div>';
        }
        html += '</div>';
        cb.innerHTML = html;
        if (typeof CalDoctorColors !== 'undefined') {
            CalDoctorColors.renderLegend(appts, typeof currentClinicId !== 'undefined' ? currentClinicId : null);
        }

        cb.querySelectorAll('.cal-cell[data-date]').forEach(function(cell) {
            cell.addEventListener('click', function(e) {
                if (e.target.closest && e.target.closest('.appt-pill, .gcal-month-pill')) return;
                showDayPanel(cell.dataset.date, map);
            });
        });

        cb.querySelectorAll('.appt-pill, .gcal-month-pill').forEach(function(pill) {
            pill.addEventListener('click', function(e) {
                e.stopPropagation();
                var aid = pill.dataset.id;
                var a   = appts.find(function(x) { return x.id === aid; });
                if (a) showApptPopup(a, pill);
            });
        });
    });
}

// ════════════════════════════════════════════════════════════════
// GOOGLE CALENDAR WEEKLY TIMELINE — GCAL module
// ════════════════════════════════════════════════════════════════
var GCAL = (function () {

    var DEFAULTS = { interval: 15, startHour: 8, endHour: 20, slotH: 24, doctorColors: {} };
    var PALETTE  = ['#0ea5e9','#10b981','#f59e0b','#ef4444',
                    '#8b5cf6','#ec4899','#14b8a6','#f97316',
                    '#6366f1','#84cc16','#06b6d4','#a855f7'];

    var S          = null;
    var appts      = [];
    var days       = [];
    var dragState  = null;
    var nowTimer   = null;
    var knownKeys  = [];   // unique doctor_code / treatment_items for settings

    // ── Settings ─────────────────────────────────────────────────
    function loadSettings() {
        try {
            var stored = localStorage.getItem('gcal_settings_v2');
            S = stored ? Object.assign({}, DEFAULTS, JSON.parse(stored)) : Object.assign({}, DEFAULTS);
        } catch (e) { S = Object.assign({}, DEFAULTS); }
        if (!S.doctorColors) S.doctorColors = {};
    }
    function saveSettings() {
        try { localStorage.setItem('gcal_settings_v2', JSON.stringify(S)); } catch(e) {}
    }

    // ── Time helpers ─────────────────────────────────────────────
    function timeToMin(t) {
        if (!t) return 0;
        var p = String(t).split(':');
        return parseInt(p[0], 10) * 60 + (parseInt(p[1] || '0', 10));
    }
    function minToTimeStr(m) {
        m = Math.max(0, Math.min(m, 23 * 60 + 59));
        return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
    }
    function topFromTime(t) {
        return Math.max(0, (timeToMin(t) - S.startHour * 60) / S.interval * S.slotH);
    }
    function totalH() {
        return (S.endHour - S.startHour) * 60 / S.interval * S.slotH;
    }

    // ── Colour helpers ───────────────────────────────────────────
    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        return parseInt(hex.slice(0,2),16)+','+parseInt(hex.slice(2,4),16)+','+parseInt(hex.slice(4,6),16);
    }
    function colorHash(str) {
        var h = 0;
        for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
        return PALETTE[h % PALETTE.length];
    }
    function getCardColor(a) {
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.getStyleForAppt) {
            return CalDoctorColors.getStyleForAppt(a).borderColor;
        }
        var key = a.doctor_code || a.doctor_name || 'default';
        return (S.doctorColors && S.doctorColors[key]) || colorHash(key);
    }

    function getCardStyle(a) {
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.getStyleForAppt) {
            return CalDoctorColors.getStyleForAppt(a);
        }
        var color = getCardColor(a);
        var bgRgb = hexToRgb(color);
        return {
            color: color,
            borderColor: color,
            background: 'rgba(' + bgRgb + ',0.24)'
        };
    }

    // ── Safe local-date constructor (avoids UTC midnight = prev-day in UTC- zones)
    function makeLocalDate(y, m, d2) { return new Date(y, m, d2); }
    function parseISO(isoStr) {
        var p = String(isoStr).split('-');
        return makeLocalDate(+p[0], +p[1] - 1, +p[2]);
    }

    // ── Main render ──────────────────────────────────────────────
    function render() {
        loadSettings();
        var ct = g('calTitle');
        var cb = g('calBody');
        if (!cb) return;

        // Always recompute calDate as today when first entering weekly view
        // (prevents stale date if tab was loaded yesterday)
        var localToday = makeLocalDate(
            new Date().getFullYear(), new Date().getMonth(), new Date().getDate()
        );

        // Build week days using purely local date arithmetic
        var dow = calDate.getDay();
        var sunY = calDate.getFullYear(), sunM = calDate.getMonth(),
            sunD = calDate.getDate() - dow;
        days = [];
        for (var i = 0; i < 7; i++) {
            days.push(makeLocalDate(sunY, sunM, sunD + i));
        }
        if (ct) ct.textContent =
            days[0].toLocaleDateString('en-HK', {month:'short',day:'numeric'}) + ' – ' +
            days[6].toLocaleDateString('en-HK', {month:'short',day:'numeric',year:'numeric'});

        var wq = SB.from('appointments').select('*')
            .gte('date', d2iso(days[0])).lte('date', d2iso(days[6]))
            .order('start_time', {ascending: true});
        wq = applyApptModuleClinicQuery(wq);
        wq.then(function (r) {
            appts = r.data || [];
            // collect unique doctor / treatment keys for settings panel
            knownKeys = [];
            var kSet = {};
            appts.forEach(function (a) {
                var k = a.doctor_code || a.doctor_name || a.treatment_items || '';
                if (k && !kSet[k]) { kSet[k] = true; knownKeys.push(k); }
            });
            buildDOM(cb);
            if (typeof CalDoctorColors !== 'undefined') {
                CalDoctorColors.renderLegend(appts, typeof currentClinicId !== 'undefined' ? currentClinicId : null);
            }
        });
    }


    function layoutDayColumns(dayAppts) {
        var evts = dayAppts.map(function (a) {
            return {
                appt: a,
                start: timeToMin(a.start_time),
                end: Math.max(timeToMin(a.end_time), timeToMin(a.start_time) + 15)
            };
        }).sort(function (x, y) { return x.start - y.start || x.end - y.end; });

        var clusters = [];
        var cluster = null;
        evts.forEach(function (e) {
            if (!cluster || e.start >= cluster.endMax) {
                cluster = { events: [], endMax: 0 };
                clusters.push(cluster);
            }
            cluster.events.push(e);
            cluster.endMax = Math.max(cluster.endMax, e.end);
        });

        var out = [];
        clusters.forEach(function (cl) {
            var cols = [];
            cl.events.forEach(function (e) {
                var placed = false;
                for (var ci = 0; ci < cols.length; ci++) {
                    if (cols[ci] <= e.start) {
                        cols[ci] = e.end;
                        e.col = ci;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    e.col = cols.length;
                    cols.push(e.end);
                }
            });
            var nCols = Math.max(1, cols.length);
            cl.events.forEach(function (e) {
                out.push({ appt: e.appt, col: e.col, totalCols: nCols });
            });
        });
        return out;
    }

    // ── Build entire calendar DOM ────────────────────────────────
    function buildDOM(cb) {
        var todayStr = todayISO();
        var th       = totalH();
        var slots    = (S.endHour - S.startHour) * 60 / S.interval;

        var wrap = document.createElement('div');
        wrap.className = 'gcal-wrap';

        // ── Sticky header ─────────────────────────────────────
        var head = document.createElement('div');
        head.className = 'gcal-head';

        var gh = document.createElement('div');
        gh.className = 'gcal-gutter-hdr';
        gh.innerHTML =
            '<div style="display:flex;flex-direction:column;gap:3px;align-items:center;padding:4px;">' +
                '<button class="gcal-settings-btn" title="Calendar settings" onclick="GCAL.toggleSettings()">⚙</button>' +
                '<button class="gcal-settings-btn" title="Mini calendar / jump to date" onclick="GCAL.toggleMiniCal()">📅</button>' +
            '</div>';
        head.appendChild(gh);

        days.forEach(function (d) {
            var iso  = d2iso(d);
            var isTo = iso === todayStr;
            var dh   = document.createElement('div');
            dh.className   = 'gcal-day-hdr' + (isTo ? ' gcal-today' : '');
            dh.dataset.date = iso;
            dh.innerHTML   =
                d.toLocaleDateString('en-HK', {weekday:'short'}) +
                '<span class="gcal-day-num">' + d.getDate() + '</span>';
            head.appendChild(dh);
        });
        wrap.appendChild(head);

        // ── Settings panel + Mini calendar (absolute inside wrap)
        wrap.appendChild(buildSettingsPanel());
        wrap.appendChild(buildMiniCalPanel());

        // ── Scrollable body ───────────────────────────────────
        var body = document.createElement('div');
        body.className = 'gcal-body';
        body.id        = 'gcalScrollBody';

        // Time column
        var tc = document.createElement('div');
        tc.className   = 'gcal-time-col';
        tc.style.height = th + 'px';
        for (var s = 0; s <= slots; s++) {
            var mOff = s * S.interval;
            var hh   = S.startHour + Math.floor(mOff / 60);
            var mm   = mOff % 60;
            var isHr = mm === 0;
            if (isHr || S.interval <= 20) {
                var lbl = document.createElement('div');
                lbl.className    = 'gcal-time-label' + (isHr ? ' hour' : '');
                lbl.style.top    = (s * S.slotH) + 'px';
                lbl.textContent  = isHr ? (pad(hh) + ':00') : (pad(hh) + ':' + pad(mm));
                tc.appendChild(lbl);
            }
        }
        body.appendChild(tc);

        // Day columns
        days.forEach(function (day) {
            var iso  = d2iso(day);
            var isTo = iso === todayStr;
            var col  = document.createElement('div');
            col.className   = 'gcal-day-col' + (isTo ? ' gcal-today-col' : '');
            col.dataset.date = iso;
            col.style.height = th + 'px';

            // Drop ghost
            var ghost = document.createElement('div');
            ghost.className = 'gcal-drop-ghost';
            ghost.id        = 'gcalGhost-' + iso;
            col.appendChild(ghost);

            // Slot grid lines
            for (var s2 = 0; s2 < slots; s2++) {
                var line = document.createElement('div');
                line.className = 'gcal-slot' + ((s2 * S.interval % 60 === 0) ? ' hour-line' : '');
                line.style.top = (s2 * S.slotH) + 'px';
                col.appendChild(line);
            }

            // Appointment cards (side-by-side when overlapping — Google Calendar style)
            var dayAppts = appts.filter(function (a) { return a.date === iso; });
            if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts) {
                dayAppts = CalDoctorColors.filterAppts(dayAppts);
            }
            var laid = layoutDayColumns(dayAppts);
            laid.forEach(function (item) {
                var card = buildCard(item.appt, item.col, item.totalCols);
                if (card) col.appendChild(card);
            });

            // Click on empty slot → open add-appointment
            col.addEventListener('click', function (e) {
                if (e.target !== col && !e.target.classList.contains('gcal-slot')) return;
                var relY      = e.clientY - col.getBoundingClientRect().top;
                var slotIdx   = Math.max(0, Math.round(relY / S.slotH));
                var totalMin  = S.startHour * 60 + slotIdx * S.interval;
                totalMin = Math.min(totalMin, (S.endHour - 1) * 60);
                openApptWithDatetime(iso, minToTimeStr(totalMin));
            });

            body.appendChild(col);
        });

        // Now-line
        renderNowLine(body);
        wrap.appendChild(body);

        cb.innerHTML = '';
        cb.appendChild(wrap);

        // Refresh now-line every minute
        if (nowTimer) clearInterval(nowTimer);
        nowTimer = setInterval(function () { renderNowLine(body); }, 60000);

        // Scroll to 1 hour past startHour
        requestAnimationFrame(function () {
            body.scrollTop = Math.max(0, (1 * 60 / S.interval) * S.slotH - 10);
        });
    }

    // ── Build one appointment card ────────────────────────────────
    function buildCard(a, colIdx, totalCols) {
        colIdx = colIdx || 0;
        totalCols = totalCols || 1;
        var startMin = timeToMin(a.start_time);
        var endMin   = timeToMin(a.end_time);
        var endDay   = S.endHour * 60;
        if (startMin >= endDay) return null;
        endMin = Math.min(endDay, endMin > startMin ? endMin : startMin + 30);

        var top    = topFromTime(a.start_time);
        var dur    = endMin - startMin;
        var height = Math.max(S.slotH, dur / S.interval * S.slotH);

        var sty    = getCardStyle(a);
        var color  = sty.borderColor;

        var card = document.createElement('div');
        card.className         = 'gcal-card';
        card.dataset.id        = a.id;
        card.style.top         = top + 'px';
        card.style.height      = height + 'px';
        card.style.color       = '#1e293b';
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.paintElement) {
            CalDoctorColors.paintElement(card, a);
        } else {
            card.style.borderLeft  = '4px solid ' + sty.borderColor;
            card.style.background  = sty.background;
        }
        var pct = 100 / totalCols;
        card.style.left = 'calc(' + (colIdx * pct) + '% + 2px)';
        card.style.width = 'calc(' + pct + '% - 4px)';
        card.style.right = 'auto';

        var dr           = a.doctor_code || a.doctor_name || '';
        var isWalkIn     = !a.patient_id;
        var chineseName  = a.patient_chinese_name || '';

        var html = '<span class="card-time">' + esc(fmt12(a.start_time)) + ' – ' + esc(fmt12(a.end_time)) + '</span>';
        // Chinese name — most prominent line
        if (chineseName) {
            html += '<span class="card-chinese">' + esc(chineseName) + '</span>';
        }
        // English / full name (with NEW badge for walk-ins)
        html +=
            '<span class="card-name">' +
                (isWalkIn ? '<span style="background:#fef3c7;color:#92400e;font-size:9px;' +
                    'font-weight:800;padding:0 3px;border-radius:3px;margin-right:3px;' +
                    'vertical-align:middle;letter-spacing:.3px;">NEW</span>' : '') +
                esc(a.patient_name || '—') +
            '</span>';
        if (a.treatment_items)
            html += '<span class="card-sub" style="font-weight:600;">' + esc(a.treatment_items) + '</span>';
        if (a.patient_no && height >= S.slotH * 2)
            html += '<span class="card-sub">#' + esc(a.patient_no) + '</span>';
        if (dr && height >= S.slotH * 2)
            html += '<span class="card-dr" style="color:' + color + ';">● ' + esc(dr) + '</span>';
        if (a.remarks && height >= S.slotH * 2)
            html += '<span class="card-sub" style="font-style:italic;opacity:.7;">' + esc(a.remarks) + '</span>';
        card.innerHTML = html;

        card.addEventListener('click', function (e) { e.stopPropagation(); showApptPopup(a, card); });
        attachDrag(card, a);
        return card;
    }

    // ── Drag & Drop (supports cross-day) ────────────────────────
    function attachDrag(card, appt) {
        card.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation();

            var cr = card.getBoundingClientRect();

            // Floating proxy that follows the cursor freely
            var proxy = document.createElement('div');
            proxy.innerHTML = card.innerHTML;
            proxy.style.cssText =
                'position:fixed;z-index:9999;pointer-events:none;margin:0;' +
                'width:' + cr.width + 'px;height:' + cr.height + 'px;' +
                'left:' + cr.left + 'px;top:' + cr.top + 'px;' +
                'opacity:.9;cursor:grabbing;transition:none;' +
                'box-shadow:0 8px 24px rgba(0,0,0,.28);' +
                'border-left:3px solid ' + card.style.borderLeftColor + ';' +
                'background:' + card.style.background + ';' +
                'border-radius:6px;padding:4px 7px;font-size:11px;' +
                'line-height:1.4;overflow:hidden;box-sizing:border-box;color:#1e293b;';
            document.body.appendChild(proxy);

            card.style.opacity = '0.2';

            dragState = {
                appt:       appt,
                card:       card,
                proxy:      proxy,
                startX:     e.clientX,
                startY:     e.clientY,
                origLeft:   cr.left,
                origTop2:   cr.top,
                origTop:    parseInt(card.style.top, 10) || 0,
                origDate:   appt.date,
                origTime:   appt.start_time,
                origEnd:    appt.end_time,
                curDate:    appt.date,
                curTime:    appt.start_time,
                curSlotTop: parseInt(card.style.top, 10) || 0,
                cardH:      cr.height,
                ghostCol:   null
            };

            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup',   onDragEnd);
        });
    }

    function _clearDragGhost(col) {
        if (!col) return;
        col.querySelectorAll('.gcal-drag-ghost').forEach(function (el) { el.remove(); });
    }
    function _showDragGhost(col, top, h) {
        _clearDragGhost(col);
        var gh = document.createElement('div');
        gh.className = 'gcal-drag-ghost';
        gh.style.cssText =
            'position:absolute;left:3px;right:3px;top:' + top + 'px;height:' + h + 'px;' +
            'border-radius:6px;border:2px dashed #0084ff;' +
            'background:rgba(0,132,255,.1);pointer-events:none;z-index:15;box-sizing:border-box;';
        col.appendChild(gh);
    }

    function onDragMove(e) {
        if (!dragState) return;
        var ds = dragState;

        // Move proxy
        ds.proxy.style.left = (ds.origLeft + e.clientX - ds.startX) + 'px';
        ds.proxy.style.top  = (ds.origTop2 + e.clientY - ds.startY) + 'px';

        // Detect which day column cursor is over
        ds.proxy.style.display = 'none';
        var under = document.elementFromPoint(e.clientX, e.clientY);
        ds.proxy.style.display = '';

        var targetCol = under;
        while (targetCol && !targetCol.classList.contains('gcal-day-col')) {
            targetCol = targetCol.parentElement;
        }
        if (!targetCol) { _clearDragGhost(ds.ghostCol); return; }

        // Vertical snap inside target column
        var colRect  = targetCol.getBoundingClientRect();
        var maxSlot  = Math.floor((totalH() - S.slotH) / S.slotH);
        var slotIdx  = Math.max(0, Math.min(Math.round((e.clientY - colRect.top) / S.slotH), maxSlot));
        var ghostTop = slotIdx * S.slotH;

        ds.curDate    = targetCol.dataset.date;
        ds.curTime    = minToTimeStr(S.startHour * 60 + slotIdx * S.interval);
        ds.curSlotTop = ghostTop;

        if (ds.ghostCol && ds.ghostCol !== targetCol) _clearDragGhost(ds.ghostCol);
        _showDragGhost(targetCol, ghostTop, ds.cardH);
        ds.ghostCol = targetCol;
    }

    function onDragEnd() {
        if (!dragState) return;
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup',   onDragEnd);

        var ds = dragState;
        dragState = null;

        _clearDragGhost(ds.ghostCol);
        if (ds.proxy && ds.proxy.parentNode) ds.proxy.parentNode.removeChild(ds.proxy);
        ds.card.style.opacity = '';

        var dateChanged = ds.curDate && ds.curDate !== ds.origDate;
        var timeChanged = ds.curTime !== ds.origTime;
        if (!dateChanged && !timeChanged) return;

        var origS = timeToMin(ds.origTime);
        var origE = timeToMin(ds.origEnd);
        var dur   = origE > origS ? origE - origS : 30;
        var newS  = timeToMin(ds.curTime);
        var newE  = minToTimeStr(newS + dur);
        var update = { start_time: ds.curTime, end_time: newE };
        if (dateChanged) update.date = ds.curDate;

        // Optimistic DOM move
        var targetColEl = document.querySelector('.gcal-day-col[data-date="' + ds.curDate + '"]');
        var origColEl   = document.querySelector('.gcal-day-col[data-date="' + ds.origDate + '"]');
        if (targetColEl) { targetColEl.appendChild(ds.card); ds.card.style.top = ds.curSlotTop + 'px'; }
        var tEl = ds.card.querySelector('.card-time');
        if (tEl) tEl.textContent = fmt12(ds.curTime) + ' – ' + fmt12(newE);

        SB.from('appointments').update(update).eq('id', ds.appt.id)
        .then(function (r) {
            if (r.error) {
                alert('Could not reschedule: ' + r.error.message);
                if (origColEl) { origColEl.appendChild(ds.card); ds.card.style.top = ds.origTop + 'px'; }
                if (tEl) tEl.textContent = fmt12(ds.origTime) + ' – ' + fmt12(ds.origEnd);
            } else {
                ds.appt.date       = ds.curDate;
                ds.appt.start_time = ds.curTime;
                ds.appt.end_time   = newE;
            }
        });
    }

    // ── Current-time indicator ───────────────────────────────────
    function renderNowLine(body) {
        body.querySelectorAll('.gcal-now-line').forEach(function (el) { el.remove(); });
        var now    = new Date();
        var nowMin = now.getHours() * 60 + now.getMinutes();
        if (nowMin < S.startHour * 60 || nowMin > S.endHour * 60) return;
        var col = body.querySelector('.gcal-day-col[data-date="' + todayISO() + '"]');
        if (!col) return;
        var line = document.createElement('div');
        line.className = 'gcal-now-line';
        line.style.top = ((nowMin - S.startHour * 60) / S.interval * S.slotH) + 'px';
        col.appendChild(line);
    }

    // ── Settings panel ────────────────────────────────────────────
    function toggleSettings() {
        var p = document.getElementById('gcalSettingsPanel');
        if (p) p.classList.toggle('open');
        if (p && p.classList.contains('open') &&
            typeof CalDoctorColors !== 'undefined' && CalDoctorColors.wireColorPanel) {
            var box = document.getElementById('gcalDrColorsBox');
            if (box) {
                box._calColorPanelWired = false;
                CalDoctorColors.wireColorPanel(box);
            }
        }
    }

    function buildSettingsPanel() {
        var p = document.createElement('div');
        p.id = 'gcalSettingsPanel';

        var mkOpts = function (arr, cur) {
            return arr.map(function (o) {
                return '<option value="'+o.v+'"'+(cur===o.v?' selected':'')+'>'+o.l+'</option>';
            }).join('');
        };

        var intOpts   = mkOpts([{v:10,l:'10 min'},{v:15,l:'15 min'},{v:20,l:'20 min'},
                                {v:30,l:'30 min'},{v:60,l:'60 min'}], S.interval);
        var startOpts = '';
        var endOpts   = '';
        for (var h = 0; h < 24; h++) {
            var hStr = pad(h)+':00';
            startOpts += '<option value="'+h+'"'+(S.startHour===h?' selected':'')+'>'+hStr+'</option>';
            endOpts   += '<option value="'+h+'"'+(S.endHour===h?' selected':'')+'>'+hStr+'</option>';
        }
        var sHOpts = mkOpts([{v:16,l:'Compact (16 px)'},{v:20,l:'Normal (20 px)'},
                             {v:24,l:'Comfortable (24 px)'},{v:32,l:'Spacious (32 px)'}], S.slotH);

        var drRows = '';
        var colorKeys = typeof CalDoctorColors !== 'undefined'
            ? CalDoctorColors.collectKeys(appts, typeof currentClinicId !== 'undefined' ? currentClinicId : null)
            : knownKeys.map(function (k) { return { key: k, label: k }; });
        colorKeys.forEach(function (item) {
            var k = item.key;
            var col = typeof CalDoctorColors !== 'undefined' ? CalDoctorColors.getColor(k) : getColorForKey(k);
            drRows +=
                '<div class="gcal-dr-row">' +
                '<input type="color" class="gcal-dr-color-inp" data-key="'+encodeURIComponent(k)+'" value="'+col+'" ' +
                'style="width:32px;height:32px;border:2px solid #e2e8f0;border-radius:6px;cursor:pointer;padding:0;flex-shrink:0;">' +
                '<span style="font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;">'+esc(item.label)+'</span>' +
                (typeof CalDoctorColors !== 'undefined' ? CalDoctorColors.presetSwatchesHtml(k, col) : '') +
                '</div>';
        });
        if (!colorKeys.length)
            drRows = '<p style="color:#aaa;font-size:11px;margin:0;">Add doctors in Configuration, or book appointments with a doctor assigned.</p>';

        p.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
                '<strong style="font-size:13px;color:#1e293b;">⚙️ Calendar Settings</strong>' +
                '<button onclick="GCAL.toggleSettings()" style="background:none;border:none;cursor:pointer;font-size:18px;color:#94a3b8;line-height:1;padding:2px 6px;">×</button>' +
            '</div>' +
            '<label>Time Interval</label>' +
            '<select id="gcalInterval" style="margin-bottom:12px;">'+intOpts+'</select>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">' +
                '<div><label>Start Time</label><select id="gcalStart">'+startOpts+'</select></div>' +
                '<div><label>End Time</label><select id="gcalEnd">'+endOpts+'</select></div>' +
            '</div>' +
            '<label>Row Height</label>' +
            '<select id="gcalSlotH" style="margin-bottom:14px;">'+sHOpts+'</select>' +
            '<label style="margin-bottom:8px;">Doctor colours (weekly &amp; monthly views)</label>' +
            '<p style="font-size:11px;color:#64748b;margin:0 0 10px;line-height:1.4;">Pick a colour per doctor so multiple doctors on the same day are easy to spot. Click a preset or use the colour wheel.</p>' +
            '<div id="gcalDrColorsBox">' + drRows + '</div>' +
            '<button onclick="GCAL.applySettings()" ' +
            'style="margin-top:14px;width:100%;padding:10px;background:#0084ff;color:#fff;' +
            'border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">' +
            'Apply &amp; Refresh</button>';
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.wireColorPanel) {
            setTimeout(function () {
                var box = document.getElementById('gcalDrColorsBox');
                if (box) {
                    box._calColorPanelWired = false;
                    CalDoctorColors.wireColorPanel(box);
                }
            }, 0);
        }
        return p;
    }

    function getColorForKey(k) {
        return (S.doctorColors && S.doctorColors[k]) || colorHash(k);
    }

    function applySettings() {
        var iEl = document.getElementById('gcalInterval');
        var sEl = document.getElementById('gcalStart');
        var eEl = document.getElementById('gcalEnd');
        var hEl = document.getElementById('gcalSlotH');
        if (iEl) S.interval  = parseInt(iEl.value, 10);
        if (sEl) S.startHour = parseInt(sEl.value, 10);
        if (eEl) S.endHour   = parseInt(eEl.value, 10);
        if (hEl) S.slotH     = parseInt(hEl.value, 10);
        if (S.endHour <= S.startHour) { alert('End time must be after start time.'); return; }
        document.querySelectorAll('#gcalDrColorsBox .gcal-dr-color-inp').forEach(function (inp) {
            var dk = inp.dataset.key;
            try { dk = decodeURIComponent(dk); } catch (e) {}
            if (typeof CalDoctorColors !== 'undefined') CalDoctorColors.setColor(dk, inp.value);
            else S.doctorColors[dk] = inp.value;
        });
        saveSettings();
        toggleSettings();
        renderWeekly();
    }

    // ── Mini Calendar ─────────────────────────────────────────────
    var miniCalDate = new Date();   // month currently shown in mini cal

    function buildMiniCalPanel() {
        var p = document.createElement('div');
        p.id = 'gcalMiniCal';
        _renderMiniCalContent(p);
        return p;
    }

    function _renderMiniCalContent(p) {
        if (!p) p = document.getElementById('gcalMiniCal');
        if (!p) return;
        var y  = miniCalDate.getFullYear();
        var mo = miniCalDate.getMonth();

        // Recompute today and selected-week dates using local arithmetic
        var nowLocal   = new Date();
        var todayLocal = d2iso(makeLocalDate(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate()));

        // Build selected-week set
        var calY = calDate.getFullYear(), calMo = calDate.getMonth(), calD = calDate.getDate();
        var weekSet = {};
        var calDow  = calDate.getDay();
        for (var wi = 0; wi < 7; wi++) {
            weekSet[d2iso(makeLocalDate(calY, calMo, calD - calDow + wi))] = true;
        }

        var monthLabel  = new Date(y, mo, 1).toLocaleDateString('en-HK', {month:'long', year:'numeric'});
        var firstDow    = new Date(y, mo, 1).getDay();
        var daysInMonth = new Date(y, mo + 1, 0).getDate();

        var btnS = 'background:none;border:none;cursor:pointer;font-size:16px;' +
                   'color:#64748b;width:24px;height:24px;border-radius:4px;line-height:1;padding:0;';

        var html =
            '<div style="display:flex;align-items:center;justify-content:space-between;' +
            'margin-bottom:8px;padding-bottom:7px;border-bottom:1px solid #f1f5f9;">' +
                '<button onclick="GCAL.miniCalPrev()" style="' + btnS + '">‹</button>' +
                '<span style="font-size:12px;font-weight:700;color:#1e293b;">' + monthLabel + '</span>' +
                '<button onclick="GCAL.miniCalNext()" style="' + btnS + '">›</button>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;text-align:center;">';

        ['S','M','T','W','T','F','S'].forEach(function (lbl) {
            html += '<div style="font-size:9px;font-weight:700;color:#94a3b8;padding:2px 0;">' + lbl + '</div>';
        });

        for (var b = 0; b < firstDow; b++) html += '<div></div>';

        for (var day = 1; day <= daysInMonth; day++) {
            var iso     = y + '-' + pad(mo + 1) + '-' + pad(day);
            var isToday = iso === todayLocal;
            var inWeek  = !!weekSet[iso];
            var cs = 'cursor:pointer;padding:3px 1px;font-size:11px;border-radius:4px;';
            if      (isToday) cs += 'background:#0084ff;color:#fff;font-weight:700;';
            else if (inWeek)  cs += 'background:#dbeafe;color:#1d4ed8;font-weight:600;';
            else              cs += 'color:#374151;';
            html += '<div onclick="GCAL.jumpToDate(\'' + iso + '\')" style="' + cs + '">' + day + '</div>';
        }

        html += '</div>' +
            '<button onclick="GCAL.goToday()" ' +
            'style="margin-top:10px;width:100%;padding:5px;background:#f0f7ff;color:#0084ff;' +
            'border:1px solid #bfdbfe;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">' +
            'Jump to Today</button>';

        p.innerHTML = html;
    }

    function toggleMiniCal() {
        var p = document.getElementById('gcalMiniCal');
        if (!p) return;
        // Close settings panel if open
        var sp = document.getElementById('gcalSettingsPanel');
        if (sp) sp.classList.remove('open');
        var opening = !p.classList.contains('open');
        if (opening) {
            // Sync to current calDate's month
            miniCalDate = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
            _renderMiniCalContent(p);
            p.classList.add('open');
        } else {
            p.classList.remove('open');
        }
    }

    function miniCalPrev() {
        miniCalDate = new Date(miniCalDate.getFullYear(), miniCalDate.getMonth() - 1, 1);
        _renderMiniCalContent(null);
    }
    function miniCalNext() {
        miniCalDate = new Date(miniCalDate.getFullYear(), miniCalDate.getMonth() + 1, 1);
        _renderMiniCalContent(null);
    }

    function jumpToDate(isoStr) {
        calDate = parseISO(isoStr);          // local-safe parse
        var p = document.getElementById('gcalMiniCal');
        if (p) p.classList.remove('open');
        renderCal();
    }

    function goToday() {
        var n = new Date();
        calDate = makeLocalDate(n.getFullYear(), n.getMonth(), n.getDate());
        miniCalDate = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
        var p = document.getElementById('gcalMiniCal');
        if (p) p.classList.remove('open');
        renderCal();
    }

    // Public API
    function openDoctorColors(focusKey) {
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.openColorModal) {
            CalDoctorColors.openColorModal(focusKey);
            return;
        }
        var p = document.getElementById('gcalSettingsPanel');
        if (!p) return;
        p.classList.add('open');
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.wireColorPanel) {
            var box = document.getElementById('gcalDrColorsBox');
            if (box) {
                box._calColorPanelWired = false;
                CalDoctorColors.wireColorPanel(box);
            }
        }
        if (focusKey && p) {
            var inps = p.querySelectorAll('.gcal-dr-color-inp');
            for (var i = 0; i < inps.length; i++) {
                if (inps[i].dataset.key === focusKey) {
                    inps[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    break;
                }
            }
        }
    }

    return {
        render:         render,
        toggleSettings: toggleSettings,
        openDoctorColors: openDoctorColors,
        applySettings:  applySettings,
        toggleMiniCal:  toggleMiniCal,
        miniCalPrev:    miniCalPrev,
        miniCalNext:    miniCalNext,
        jumpToDate:     jumpToDate,
        goToday:        goToday
    };
}());

// ── Weekly ────────────────────────────────────────────────────
function renderWeekly() {
    GCAL.render();
}

// ── Open appointment modal pre-filled with date + time ─────────
function openApptWithDatetime(iso, time) {
    openApptModal(iso);
    setTimeout(function () {
        var fStart = g('fStart');
        if (fStart) {
            fStart.value = time;
            if (typeof calcEnd === 'function') calcEnd();
        }
    }, 60);
}

// ── Day panel ─────────────────────────────────────────────────
function showDayPanel(iso, map) {
    var panel = g('dayPanel');
    var title = g('dayPanelTitle');
    var list  = g('dayPanelList');
    if (!panel) return;

    title.textContent = fmtDateLong(iso);
    var items = map[iso] || [];
    if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts) {
        items = CalDoctorColors.filterAppts(items);
    }

    if (!items.length) {
        list.innerHTML =
            '<p style="color:#aaa;font-size:13px;margin:0;">' +
            'No appointments</p>';
    } else {
        list.innerHTML = '';
        items.forEach(function(a) {
            var div = document.createElement('div');
            div.className = 'day-panel-item';
            var dpiSty = typeof CalDoctorColors !== 'undefined' && CalDoctorColors.getStyleForAppt
                ? CalDoctorColors.getStyleForAppt(a)
                : null;
            if (dpiSty) {
                div.style.borderLeft = '4px solid ' + dpiSty.borderColor;
                div.style.background = dpiSty.background;
            }
            var drLbl = a.doctor_code || a.doctor_name || '';
            div.innerHTML =
                '<div class="dpi-time">' +
                    fmt12(a.start_time) + ' – ' + fmt12(a.end_time) +
                '</div>' +
                (drLbl ? '<div class="dpi-dr" style="color:' + (dpiSty ? dpiSty.color : '#64748b') + ';">● ' + esc(drLbl) + '</div>' : '') +
                '<div class="dpi-name">' +
                    esc(a.patient_name || '-') +
                '</div>' +
                '<div class="dpi-treat">' +
                    esc(a.treatment_items || '-') +
                '</div>' +
                '<span class="status-badge ' +
                    statusClass(a.bill_status) + '">' +
                    esc(a.bill_status || 'Scheduled') +
                '</span>';
            div.style.cursor = 'pointer';
            div.addEventListener('click', function() {
                showApptPopup(a, div);
            });
            list.appendChild(div);
        });
    }

    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Appointment popup ─────────────────────────────────────────
function showApptPopup(a, anchor) {
    var pop     = g('apptPopup');
    var content = g('apptPopupContent');
    if (!pop) return;

    var walkInBanner = !a.patient_id
        ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;' +
          'padding:5px 8px;margin-bottom:8px;font-size:11px;color:#92400e;font-weight:600;">' +
          '✨ Walk-in / New Patient — not yet linked to a record</div>'
        : '';

    var chineseRow = a.patient_chinese_name
        ? '<tr><td style="color:#888;padding:3px 8px 3px 0;white-space:nowrap;"></td>' +
          '<td style="font-family:\'PingFang HK\',\'Microsoft JhengHei\',sans-serif;' +
          'font-size:16px;font-weight:900;letter-spacing:0.5px;-webkit-font-smoothing:antialiased;">' +
          esc(a.patient_chinese_name) + '</td></tr>'
        : '';

    content.innerHTML =
        walkInBanner +
        '<table style="font-size:13px;width:100%;' +
        'border-collapse:collapse;">' +
            chineseRow +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;' +
            'white-space:nowrap;">Patient</td>' +
            '<td><strong>' + esc(a.patient_name || '-') +
            '</strong></td></tr>' +
            (!a.patient_id ? '' :
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">No.</td>' +
            '<td>' + esc(a.patient_no || '-') + '</td></tr>') +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">Date</td>' +
            '<td>' + fmtDateLong(a.date) + '</td></tr>' +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">Time</td>' +
            '<td>' + fmt12(a.start_time) +
            ' – ' + fmt12(a.end_time) + '</td></tr>' +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">' +
            'Treatment</td>' +
            '<td>' + esc(a.treatment_items || '-') + '</td></tr>' +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">Status</td>' +
            '<td><span class="status-badge ' +
                statusClass(a.bill_status) + '">' +
                esc(a.bill_status || 'Scheduled') +
            '</span></td></tr>' +
            (a.remarks
                ? '<tr><td style="color:#888;padding:3px 8px 3px 0;">' +
                  'Remarks</td><td>' + esc(a.remarks) +
                  '</td></tr>'
                : '') +
        '</table>' +
        '<div style="display:flex;gap:8px;margin-top:12px;">' +
            '<button id="popEditBtn" ' +
            'style="flex:1;padding:7px;background:var(--primary);' +
            'color:white;border:none;border-radius:5px;' +
            'cursor:pointer;font-weight:600;">Edit</button>' +
            (a.bill_status !== 'Queue' && a.bill_status !== 'Done'
                ? '<button id="popCheckinBtn" ' +
                  'style="flex:1;padding:7px;background:var(--success);' +
                  'color:white;border:none;border-radius:5px;' +
                  'cursor:pointer;font-weight:600;">Check In</button>'
                : '') +
        '</div>';

    var rect    = anchor.getBoundingClientRect();
    var PW      = 310;
    // Prefer right side; fall back to left if not enough room
    var left = rect.right + 8;
    if (left + PW > window.innerWidth - 8) left = rect.left - PW - 8;
    left = Math.max(8, Math.min(left, window.innerWidth - PW - 8));

    // Measure popup to clamp vertically after showing
    pop.style.left    = left + 'px';
    pop.style.top     = '-9999px';
    pop.style.display = 'block';
    var popH = pop.offsetHeight || 360;
    var top  = rect.top;
    if (top + popH > window.innerHeight - 8) top = window.innerHeight - popH - 8;
    top = Math.max(8, top);
    pop.style.top = top + 'px';

    g('popEditBtn').addEventListener('click', function() {
        pop.style.display = 'none';
        openApptEditModal(a);
    });

    var pci = g('popCheckinBtn');
    if (pci) {
        pci.addEventListener('click', function() {
            pop.style.display = 'none';
            checkInPatient(a);
        });
    }
}

// ════════════════════════════════════════════════════════════════
// BILL PANEL
// ════════════════════════════════════════════════════════════════
function openBillPanel(q) {
    billApptId  = q.id;
    billPatId   = q.patient_id;
    billPatName = q.patient_name || '-';
    billPatNo   = q.patient_no   || '-';

    g('billPatientInfo').innerHTML =
        '<strong>' + esc(billPatName) + '</strong>' +
        ' &nbsp;|&nbsp; #' + esc(billPatNo);

    billItems    = [];
    pendingLists = [];
    pendingIdx   = -1;
    payItems     = [];
    payPendingId = null;

    // Start on Step 1; load treatment item dropdown cache then pending lists
    switchBillTab(1);
    loadTreatmentItemsForBilling(function() {
        loadPendingLists();
    });
    loadBillHistory();

    g('billPanel').classList.add('open');
}

function closeBillPanel() {
    g('billPanel').classList.remove('open');
    billApptId   = null;
    billPatId    = null;
    billItems    = [];
    pendingLists = [];
    pendingIdx   = -1;
    payItems     = [];
    payPendingId = null;
}

// ════════════════════════════════════════════════════════════════
// BILL STEP TABS
// ════════════════════════════════════════════════════════════════
function switchBillTab(n) {
    g('billTab1Btn').classList.toggle('active', n === 1);
    g('billTab2Btn').classList.toggle('active', n === 2);
    g('billStep1').style.display = n === 1 ? '' : 'none';
    g('billStep2').style.display = n === 2 ? '' : 'none';
    if (n === 2) renderStep2();
}

// ════════════════════════════════════════════════════════════════
// STEP 1 — PENDING BILL ITEM LISTS
// ════════════════════════════════════════════════════════════════
function loadPendingLists(cb) {
    SB.from('pending_bill_items')
        .select('*')
        .eq('patient_id', billPatId)
        .eq('expires_on',  todayISO())
        .order('created_at', { ascending: true })
    .then(function(r) {
        pendingLists = (!r.error && r.data) ? r.data : [];
        pendingLists.forEach(function(pl) {
            if (typeof pl.items === 'string') {
                try { pl.items = JSON.parse(pl.items); } catch(e) { pl.items = []; }
            }
            pl.items = pl.items || [];
        });
        pendingIdx = pendingLists.length ? 0 : -1;
        renderStep1UI();
        if (cb) cb();
    });
}

function renderStep1UI() {
    var hasLists = pendingLists.length > 0;
    g('pendingEmptyState').style.display  = hasLists ? 'none' : '';
    g('pendingActiveArea').style.display  = hasLists ? ''     : 'none';
    g('removePendingBtn').disabled        = !hasLists;
    g('pendingCounter').textContent       = hasLists
        ? (pendingIdx + 1) + ' / ' + pendingLists.length
        : '—';

    if (!hasLists) { billItems = []; return; }

    if (pendingIdx < 0 || pendingIdx >= pendingLists.length) pendingIdx = 0;
    var pl = pendingLists[pendingIdx];

    g('pendingListLabel').value = pl.label || '';
    billItems = (pl.items || []).map(function(it) {
        return { desc: it.desc || '', qty: it.qty || 1, price: it.price || 0, disc: it.disc || 0 };
    });
    if (!billItems.length) billItems = [{ desc: '', qty: 1, price: 0, disc: 0 }];

    renderBillItems();
    recalcPendingSubtotal();

    var statusEl = g('pendingListStatus');
    if (statusEl) {
        statusEl.textContent = pl.id ? '✅ Saved' : '⚠️ Not saved yet';
        statusEl.style.color = pl.id ? '#16a34a' : '#f59e0b';
    }
}

function recalcPendingSubtotal() {
    var sub = billItems.reduce(function(a, it) { return a + billItemAmt(it); }, 0);
    var el  = g('pendingSubtotal');
    if (el) el.textContent = fmt2(sub);
}

function navPendingList(dir) {
    if (!pendingLists.length) return;
    pendingIdx = (pendingIdx + dir + pendingLists.length) % pendingLists.length;
    renderStep1UI();
}

function addNewPendingList() {
    var label = 'List ' + (pendingLists.length + 1);
    pendingLists.push({ id: null, label: label, items: [], subtotal: 0 });
    pendingIdx = pendingLists.length - 1;
    billItems  = [{ desc: '', qty: 1, price: 0, disc: 0 }];
    renderStep1UI();
    var statusEl = g('pendingListStatus');
    if (statusEl) { statusEl.textContent = '⚠️ Not saved yet'; statusEl.style.color = '#f59e0b'; }
    if (g('pendingListLabel')) g('pendingListLabel').focus();
}

function saveCurrentPendingList() {
    if (!pendingLists.length || pendingIdx < 0) return;
    var pl    = pendingLists[pendingIdx];
    var label = (g('pendingListLabel').value || '').trim() || ('List ' + (pendingIdx + 1));
    var sub   = billItems.reduce(function(a, it) {
        return a + ((parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0));
    }, 0);

    pl.label    = label;
    pl.items    = billItems.map(function(it) {
        return { desc: it.desc, qty: it.qty, price: it.price, disc: it.disc || 0 };
    });
    pl.subtotal = sub;

    var payload = {
        patient_id:   billPatId,
        patient_name: billPatName,
        patient_no:   billPatNo,
        label:        label,
        items:        JSON.stringify(pl.items),
        subtotal:     sub,
        expires_on:   todayISO(),
        created_by:   (typeof currentName !== 'undefined' ? currentName : null)
    };

    var statusEl = g('pendingListStatus');
    if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = '#888'; }

    var query = pl.id
        ? SB.from('pending_bill_items').update(payload).eq('id', pl.id)
        : SB.from('pending_bill_items').insert([payload]).select();

    query.then(function(r) {
        if (r.error) {
            if (statusEl) { statusEl.textContent = '❌ ' + r.error.message; statusEl.style.color = '#dc2626'; }
            return;
        }
        if (!pl.id && r.data && r.data[0]) pl.id = r.data[0].id;
        g('removePendingBtn').disabled = false;
        var t = new Date().toLocaleTimeString('en-HK', { hour: '2-digit', minute: '2-digit' });
        if (statusEl) { statusEl.textContent = '✅ Saved at ' + t; statusEl.style.color = '#16a34a'; }
    });
}

function removeCurrentPendingList() {
    if (!pendingLists.length || pendingIdx < 0) return;
    var pl = pendingLists[pendingIdx];
    if (!confirm('Remove "' + (pl.label || 'this list') + '"? This cannot be undone.')) return;

    function doRemove() {
        pendingLists.splice(pendingIdx, 1);
        pendingIdx = pendingLists.length ? Math.max(0, pendingIdx - 1) : -1;
        billItems  = [];
        renderStep1UI();
    }

    if (pl.id) {
        SB.from('pending_bill_items').delete().eq('id', pl.id)
        .then(function(r) {
            if (r.error) { alert('Error: ' + r.error.message); return; }
            doRemove();
        });
    } else {
        doRemove();
    }
}

// ════════════════════════════════════════════════════════════════
// STEP 2 — PAYMENT (select a pending list, then pay)
// ════════════════════════════════════════════════════════════════
function renderStep2() {
    loadBillTypes();
    loadBillDoctors();
    sv('bDate',     todayISO());
    sv('bDiscount', '0');
    sv('bAmtPaid',  '0');
    sv('bNotes',    '');
    payItems     = [];
    payPendingId = null;
    g('payPreviewWrap').style.display   = 'none';
    g('bSubtotal').textContent = '0.00';
    g('bTotal').textContent    = '0.00';
    g('bBalance').textContent  = 'HK$ 0.00';

    SB.from('pending_bill_items')
        .select('*')
        .eq('patient_id', billPatId)
        .eq('expires_on',  todayISO())
        .order('created_at', { ascending: true })
    .then(function(r) {
        var lists  = (!r.error && r.data) ? r.data : [];
        var cards  = g('step2ListCards');
        var noneEl = g('step2NoneMsg');
        cards.innerHTML = '';

        lists.forEach(function(pl) {
            if (typeof pl.items === 'string') {
                try { pl.items = JSON.parse(pl.items); } catch(e) { pl.items = []; }
            }
            pl.items = pl.items || [];
        });

        if (!lists.length) {
            noneEl.style.display = '';
            return;
        }
        noneEl.style.display = 'none';

        lists.forEach(function(pl) {
            var btn = document.createElement('button');
            btn.className = 'pending-list-card';
            btn.innerHTML =
                '<div style="font-weight:700;font-size:13px;">' + esc(pl.label || 'List') + '</div>' +
                '<div style="font-size:11px;color:#888;margin-top:3px;">' +
                    'HK$&nbsp;' + fmt2(pl.subtotal) +
                    '&nbsp;·&nbsp;' + pl.items.length + ' item(s)' +
                '</div>';
            btn.addEventListener('click', function() {
                document.querySelectorAll('.pending-list-card').forEach(function(b) {
                    b.classList.remove('selected');
                });
                btn.classList.add('selected');
                payItems     = pl.items;
                payPendingId = pl.id;
                renderPayPreview();
                recalcTotals();
            });
            cards.appendChild(btn);
        });

        if (lists.length === 1) cards.firstChild.click();
    });
}

function renderPayPreview() {
    var wrap = g('payPreviewWrap');
    var body = g('payPreviewBody');
    if (!wrap || !body) return;
    body.innerHTML = '';
    payItems.forEach(function(it, i) {
        var tr   = document.createElement('tr');
        var disc = parseFloat(it.disc) || 0;
        var amt  = billItemAmt(it);
        tr.style.background = i % 2 === 0 ? '#fff' : '#f8faff';
        tr.innerHTML =
            '<td style="padding:7px 12px;">' + esc(it.desc || '—') + '</td>' +
            '<td style="padding:7px 12px;text-align:center;">' + (it.qty || 0) + '</td>' +
            '<td style="padding:7px 12px;text-align:right;">' + fmt2(it.price) + '</td>' +
            '<td style="padding:7px 12px;text-align:center;color:' + (disc > 0 ? '#dc2626' : '#aaa') + ';">' +
                (disc > 0 ? disc + '%' : '—') +
            '</td>' +
            '<td style="padding:7px 12px;text-align:right;font-weight:600;">' + fmt2(amt) + '</td>';
        body.appendChild(tr);
    });
    wrap.style.display = payItems.length ? '' : 'none';
}

function billDoctorLabel(d) {
    return d.doctor_code || d.display_name || d.english_name || d.chinese_name || 'Doctor';
}

function renderBillDoctorOptions(selectedId) {
    var sel = g('bDoctor');
    if (!sel) return;
    var docs = (billDoctorList || []).filter(function(d) { return d && d.is_active !== false; });
    if (!docs.length) {
        sel.innerHTML = '<option value="">(No doctors)</option>';
        return;
    }
    var html = '<option value="">-- Select Doctor --</option>' +
        docs.map(function(d) {
            var v = d.id || '';
            var s = (selectedId && v === selectedId) ? ' selected' : '';
            return '<option value="' + esc(v) + '"' + s + '>' + esc(billDoctorLabel(d)) + '</option>';
        }).join('');
    sel.innerHTML = html;
}

function defaultBillDoctorId() {
    if (currentDoctorId) return currentDoctorId;
    var role = String(currentRole || '').toLowerCase();
    if ((role === 'doctor' || role === 'dentist') && currentName) {
        var n = String(currentName).trim().toLowerCase();
        var hit = (billDoctorList || []).find(function(d) {
            return String(d.display_name || '').trim().toLowerCase() === n ||
                   String(d.english_name || '').trim().toLowerCase() === n ||
                   String(d.chinese_name || '').trim().toLowerCase() === n;
        });
        return hit ? hit.id : '';
    }
    return '';
}

function loadBillDoctors() {
    var sel = g('bDoctor');
    if (!sel) return;
    sel.innerHTML = '<option value="">Loading doctors...</option>';

    var fromGlobal = (typeof APP_DOCTORS !== 'undefined' && Array.isArray(APP_DOCTORS))
        ? APP_DOCTORS.filter(function(d) { return d.is_active !== false; })
        : [];
    if (fromGlobal.length) {
        billDoctorList = fromGlobal.slice();
        renderBillDoctorOptions(defaultBillDoctorId());
        return;
    }

    if (typeof SB === 'undefined' || !SB || !SB.from) {
        sel.innerHTML = '<option value="">(Supabase not ready)</option>';
        return;
    }

    SB.from('doctors')
      .select('id,doctor_code,english_name,chinese_name,display_name,is_active')
      .eq('is_active', true)
      .order('doctor_code', {ascending: true})
    .then(function(r) {
        if (r.error) {
            sel.innerHTML = '<option value="">(Load doctors failed)</option>';
            return;
        }
        billDoctorList = r.data || [];
        renderBillDoctorOptions(defaultBillDoctorId());
    })
    .catch(function(e) {
        sel.innerHTML = '<option value="">(Load doctors failed)</option>';
        try { console.error('loadBillDoctors error', e); } catch (_) {}
    });
}

function addBillItem() {
    billItems.push({ desc: '', qty: 1, price: 0, disc: 0 });
    renderBillItems();
    recalcTotals();
}

function billItemAmt(it) {
    var gross = (parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0);
    var disc  = Math.min(100, Math.max(0, parseFloat(it.disc) || 0));
    return gross * (1 - disc / 100);
}

function renderBillItems() {
    var tb = g('billItemsBody');
    tb.innerHTML = '';
    billItems.forEach(function(item, i) {
        var tr = document.createElement('tr');
        
        // Build description cell with dropdown + custom input
        var descCell = '<td>' +
            '<div style="display:flex;flex-direction:column;gap:4px;">';
        
        // If we have treatment items cached, show dropdown
        if (treatmentItemsCache.length > 0) {
            descCell +=
                '<select id="bdesc-sel-' + i + '" ' +
                'style="width:100%;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:13px;box-sizing:border-box;">' +
                buildTreatmentItemOptions(item.desc) +
                '</select>' +
                '<input type="text" id="bdesc-custom-' + i + '" ' +
                'value="' + esc(item.desc) + '" ' +
                'placeholder="Or type custom description" ' +
                'style="width:100%;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:12px;box-sizing:border-box;' +
                'display:' + (item.desc && treatmentItemsCache.findIndex(function(t) { return t.item_name === item.desc; }) === -1 ? 'block' : 'none') + ';">';
        } else {
            // Fallback to simple text input if no items loaded
            descCell +=
                '<input type="text" id="bdesc-' + i + '" ' +
                'value="' + esc(item.desc) + '" ' +
                'placeholder="Description" ' +
                'style="width:100%;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:13px;box-sizing:border-box;">';
        }
        descCell += '</div></td>';
        
        var discVal = item.disc !== undefined ? item.disc : 0;
        tr.innerHTML = descCell +
            '<td>' +
                '<input type="number" id="bqty-' + i + '" ' +
                'value="' + item.qty + '" min="1" step="1" ' +
                'style="width:100%;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:13px;box-sizing:border-box;">' +
            '</td>' +
            '<td>' +
                '<input type="number" id="bprice-' + i + '" ' +
                'value="' + item.price + '" min="0" step="0.01" ' +
                'style="width:100%;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:13px;box-sizing:border-box;">' +
            '</td>' +
            '<td>' +
                '<input type="number" id="bdisc-' + i + '" ' +
                'value="' + discVal + '" min="0" max="100" step="0.1" ' +
                'style="width:100%;min-width:52px;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:13px;box-sizing:border-box;text-align:center;">' +
            '</td>' +
            '<td style="text-align:right;font-weight:600;font-size:13px;" ' +
            'id="bamt-' + i + '">' +
                'HK$ ' + fmt2(billItemAmt(item)) +
            '</td>' +
            '<td>' +
                '<button data-idx="' + i + '" class="bill-del-row" ' +
                'style="background:none;border:none;color:var(--danger);' +
                'font-size:18px;cursor:pointer;line-height:1;">×</button>' +
            '</td>';
        tb.appendChild(tr);

        (function(idx) {
            var descSel = g('bdesc-sel-' + idx);
            var descCustom = g('bdesc-custom-' + idx);
            var descSimple = g('bdesc-' + idx);
            
            // Handle dropdown change
            if (descSel) {
                descSel.addEventListener('change', function() {
                    var selectedValue = this.value;
                    if (selectedValue === '') {
                        // Show custom input
                        if (descCustom) {
                            descCustom.style.display = 'block';
                            descCustom.focus();
                        }
                        billItems[idx].desc = '';
                    } else {
                        // Use selected item
                        billItems[idx].desc = selectedValue;
                        if (descCustom) descCustom.style.display = 'none';
                        
                        // Auto-fill price from selected option
                        var selectedOpt = this.options[this.selectedIndex];
                        var price = parseFloat(selectedOpt.getAttribute('data-price')) || 0;
                        billItems[idx].price = price;
                        var priceInput = g('bprice-' + idx);
                        if (priceInput) priceInput.value = price;
                        g('bamt-' + idx).textContent = 'HK$ ' + fmt2(billItemAmt(billItems[idx]));
                        recalcTotals();
                    }
                });
            }
            
            // Handle custom input
            if (descCustom) {
                descCustom.addEventListener('input', function() {
                    billItems[idx].desc = this.value;
                });
            }
            
            // Handle simple input (fallback)
            if (descSimple) {
                descSimple.addEventListener('input', function() {
                    billItems[idx].desc = this.value;
                });
            }
            
            g('bqty-' + idx).addEventListener('input', function() {
                billItems[idx].qty = parseFloat(this.value) || 1;
                g('bamt-' + idx).textContent = 'HK$ ' + fmt2(billItemAmt(billItems[idx]));
                recalcTotals();
            });
            g('bprice-' + idx).addEventListener('input', function() {
                billItems[idx].price = parseFloat(this.value) || 0;
                g('bamt-' + idx).textContent = 'HK$ ' + fmt2(billItemAmt(billItems[idx]));
                recalcTotals();
            });
            g('bdisc-' + idx).addEventListener('input', function() {
                billItems[idx].disc = parseFloat(this.value) || 0;
                g('bamt-' + idx).textContent = 'HK$ ' + fmt2(billItemAmt(billItems[idx]));
                recalcTotals();
            });
        })(i);

        tr.querySelector('.bill-del-row').addEventListener('click', function() {
            billItems.splice(parseInt(this.dataset.idx, 10), 1);
            renderBillItems();
            recalcTotals();
        });
    });
}

function recalcTotals() {
    var step2 = g('billStep2') && g('billStep2').style.display !== 'none';
    if (step2) {
        // Use payItems from the selected pending list
        var sub  = payItems.reduce(function(a, it) { return a + billItemAmt(it); }, 0);
        var disc  = parseFloat(g('bDiscount').value) || 0;
        var total = Math.max(0, sub - disc);
        g('bSubtotal').textContent = fmt2(sub);
        g('bTotal').textContent    = fmt2(total);
        recalcBalance();
    } else {
        // Step 1: update the pending subtotal display only
        recalcPendingSubtotal();
    }
}

function recalcBalance() {
    var total   = parseFloat(g('bTotal').textContent) || 0;
    var paid    = parseFloat(g('bAmtPaid').value)      || 0;
    var balance = total - paid;
    g('bBalance').textContent  = 'HK$ ' + fmt2(balance);
    g('bBalance').style.color  =
        balance > 0 ? 'var(--danger)' : 'var(--success)';
}

function saveBill(doPrint) {
    if (!payItems.length) { alert('Please select a bill item list in Step 2 first.'); return; }

    var sub   = parseFloat(g('bSubtotal').textContent) || 0;
    var disc  = parseFloat(g('bDiscount').value)        || 0;
    var total = parseFloat(g('bTotal').textContent)     || 0;
    var paid  = parseFloat(g('bAmtPaid').value)         || 0;
    var bal   = total - paid;

    var payload = {
        appointment_id: billApptId,
        patient_id:     billPatId,
        patient_name:   billPatName,
        patient_no:     billPatNo,
        bill_date:      g('bDate').value  || todayISO(),
        bill_type:      g('bType').value  || 'Cash',
        items:          JSON.stringify(payItems),
        subtotal:       sub,
        discount:       disc,
        total:          total,
        amount_paid:    paid,
        balance:        bal,
        notes:          g('bNotes').value || null,
        status:         bal <= 0 ? 'Paid' : 'Partial'
    };

    var pickedId = (g('bDoctor') && g('bDoctor').value) ? g('bDoctor').value : '';
    var picked = pickedId
        ? (billDoctorList || []).find(function(d) { return d.id === pickedId; })
        : null;
    if (picked) {
        payload.doctor_id = picked.id || null;
        payload.doctor_name = picked.display_name || picked.english_name || picked.chinese_name || null;
        payload.doctor_tag = billDoctorLabel(picked) || payload.doctor_name || null;
    } else {
        var drCtx = (typeof getActiveDoctorContext === 'function')
            ? getActiveDoctorContext()
            : null;
        if (drCtx && drCtx.shouldTag) {
            payload.doctor_id = drCtx.id || null;
            payload.doctor_name = drCtx.name || null;
            payload.doctor_tag = drCtx.tag || drCtx.name || null;
        }
    }

    var finishAfterSaved = function(r) {
        // Remove the pending list that was just paid
        if (payPendingId) {
            SB.from('pending_bill_items').delete().eq('id', payPendingId).then(function() {
                payItems     = [];
                payPendingId = null;
            });
        }
        // Update appointment status if linked
        var apptChain = billApptId
            ? SB.from('appointments')
                .update({ bill_status: bal <= 0 ? 'Paid' : 'Billed' })
                .eq('id', billApptId)
            : Promise.resolve();
        apptChain.then(function() {
            if (billApptId) loadQueue();
            loadBillHistory();
            if (doPrint)  showReceipt(payload, r.data, null, true);
            if (!doPrint) alert('Bill saved successfully.');
        });
    };

    SB.from('bills').insert([payload])
    .then(function(r) {
        if (!r.error) { finishAfterSaved(r); return; }

        var msg = String(r.error.message || '').toLowerCase();
        var hasDoctorCols = payload.doctor_id || payload.doctor_name || payload.doctor_tag;
        var missingColErr = msg.indexOf('doctor_id') >= 0 ||
                            msg.indexOf('doctor_name') >= 0 ||
                            msg.indexOf('doctor_tag') >= 0 ||
                            msg.indexOf('column') >= 0;
        if (!hasDoctorCols || !missingColErr) {
            alert('Error: ' + r.error.message);
            return;
        }

        // Backward compatibility while DB migration is pending.
        var legacyPayload = Object.assign({}, payload);
        delete legacyPayload.doctor_id;
        delete legacyPayload.doctor_name;
        delete legacyPayload.doctor_tag;
        SB.from('bills').insert([legacyPayload])
        .then(function(r2) {
            if (r2.error) { alert('Error: ' + r2.error.message); return; }
            finishAfterSaved(r2);
        });
    });
}

function loadTreatmentItemsForBilling(callback) {
    SB.from('treatment_items')
        .select('*')
        .eq('is_active', true)
        .order('item_name', {ascending: true})
    .then(function(r) {
        if (r.error) {
            console.error('Error loading treatment items:', r.error);
            treatmentItemsCache = [];
        } else {
            treatmentItemsCache = r.data || [];
        }
        if (callback) callback();
    })
    .catch(function(e) {
        console.error('Error loading treatment items:', e);
        treatmentItemsCache = [];
        if (callback) callback();
    });
}

function buildTreatmentItemOptions(selectedDesc) {
    var html = '<option value="">-- Select or type custom --</option>';
    treatmentItemsCache.forEach(function(item) {
        var selected = selectedDesc === item.item_name ? ' selected' : '';
        var label = item.item_name;
        if (item.category) {
            label += ' (' + item.category + ')';
        }
        html += '<option value="' + esc(item.item_name) + '" ' +
                'data-price="' + (item.unit_price || 0) + '"' + selected + '>' +
                esc(label) +
                '</option>';
    });
    return html;
}

var billTypesCache = [];   // shared across both dropdowns

function applyBillTypeOptions(sel, markDefault) {
    var FALLBACK = ['Cash','Visa','Mastercard','EPS','HKBC','Cheque',
                    'Bank Transfer','Insurance','Waived','Other'];
    sel.innerHTML = '';
    var list = billTypesCache.length ? billTypesCache : null;
    if (!list) {
        FALLBACK.forEach(function(v) {
            var o = document.createElement('option');
            o.value = o.textContent = v;
            sel.appendChild(o);
        });
        return;
    }
    var defaultFound = false;
    list.forEach(function(bt) {
        var opt = document.createElement('option');
        opt.value = bt.name || bt.type_code;
        opt.textContent = bt.name || bt.type_code;
        if (bt.type_name) opt.textContent += ' (' + bt.type_name + ')';
        if (markDefault && bt.is_default && !defaultFound) {
            opt.selected = true;
            defaultFound = true;
        }
        sel.appendChild(opt);
    });
    if (markDefault && !defaultFound && sel.options.length) {
        sel.options[0].selected = true;
    }
}

function loadBillTypes() {
    var sel = g('bType');
    if (!sel) return;
    sel.innerHTML = '<option value="">Loading...</option>';

    if (billTypesCache.length) {
        applyBillTypeOptions(sel, true);
        applyBillTypeOptions(g('apMethod') || { innerHTML: '' }, false);
        return;
    }

    SB.from('bill_types')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', {ascending: true})
    .then(function(r) {
        billTypesCache = (!r.error && r.data && r.data.length) ? r.data : [];
        applyBillTypeOptions(sel, true);
        var apSel = g('apMethod');
        if (apSel) applyBillTypeOptions(apSel, false);
    })
    .catch(function(e) {
        console.error('Error loading bill types:', e);
        applyBillTypeOptions(sel, true);
    });
}

// Loads all bills for the current patient (same query shape as Consultation → Bill).
function loadBillHistory() {
    var wrap  = g('billHistoryList');
    var patId = billPatId;
    var patNo = billPatNo;
    var apptFallback = billApptId;

    var hasPatient = !!patId;
    var hasPatNoFallback = !!(patNo && patNo !== '-');

    if (!hasPatient && !hasPatNoFallback && !apptFallback) {
        wrap.innerHTML = '<p style="color:#aaa;font-size:14px;">No bills yet.</p>';
        return;
    }
    wrap.innerHTML = '<p style="color:#aaa;font-size:13px;">Loading…</p>';

    function renderHistory(r) {
        if (r.error) {
            wrap.innerHTML =
                '<p style="color:#e11d48;font-size:13px;">⚠️ ' + esc(r.error.message) + '</p>';
            return;
        }
        if (!r.data || !r.data.length) {
            wrap.innerHTML = '<p style="color:#aaa;font-size:14px;">No bills yet.</p>';
            return;
        }
        renderBillHistoryRows(wrap, r.data);
    }

    if (hasPatient) {
        SB.from('bills').select('*')
            .eq('patient_id', patId)
            .order('created_at', { ascending: false })
        .then(function(r) {
            if (r.error && hasPatNoFallback &&
                (String(r.error.message || '').toLowerCase().indexOf('patient_id') >= 0)) {
                SB.from('bills').select('*')
                    .eq('patient_no', patNo)
                    .order('created_at', { ascending: false })
                .then(renderHistory);
                return;
            }
            renderHistory(r);
        });
        return;
    }

    if (hasPatNoFallback) {
        SB.from('bills').select('*')
            .eq('patient_no', patNo)
            .order('created_at', { ascending: false })
        .then(renderHistory);
        return;
    }

    // Rare: queued row missing patient linkage — still show bills for this visit only
    SB.from('bills').select('*')
        .eq('appointment_id', apptFallback)
        .order('created_at', { ascending: false })
    .then(renderHistory);
}

function refreshBillHistory() {
    if (!billPatId && (!billPatNo || billPatNo === '-') && !billApptId) return;
    loadBillHistory();
}

function renderBillHistoryRows(wrap, data) {
    wrap.innerHTML = '';
    data.forEach(function(b) {
            var drTag   = b.doctor_tag || b.doctor_name || '';
            var isAdmin = String(typeof currentRole !== 'undefined' ? currentRole : '').toLowerCase() === 'admin';
            var div = document.createElement('div');
            var isPartial = b.status === 'Partial' || (parseFloat(b.balance) > 0);
            div.style.cssText =
                'background:' + (isPartial ? '#fffbeb' : '#f9f9f9') + ';' +
                'border:1px solid ' + (isPartial ? '#fde047' : '#eee') + ';' +
                'border-radius:8px;padding:12px 14px;margin-bottom:10px;';
            div.innerHTML =
                '<div style="display:flex;justify-content:space-between;' +
                'align-items:center;margin-bottom:4px;">' +
                    '<strong style="font-size:14px;">' +
                        'HK$ ' + fmt2(b.total) +
                    '</strong>' +
                    '<div style="display:flex;align-items:center;gap:8px;">' +
                        '<span class="status-badge ' +
                            statusClass(b.status) + '">' +
                            esc(b.status) +
                        '</span>' +
                        '<button class="bd-detail-btn btn-sm" ' +
                        'style="background:var(--primary);color:#fff;' +
                        'border:none;padding:3px 11px;border-radius:5px;' +
                        'font-size:12px;cursor:pointer;">Detail</button>' +
                        (isPartial
                            ? '<button class="bd-pay-btn btn-sm" ' +
                              'style="background:#16a34a;color:#fff;border:none;' +
                              'padding:3px 11px;border-radius:5px;font-size:12px;' +
                              'cursor:pointer;font-weight:700;">💰 Pay</button>'
                            : '') +
                        '<button class="bd-del-btn btn-sm" ' +
                        (isAdmin
                            ? 'style="background:#dc2626;color:#fff;border:none;' +
                              'padding:3px 11px;border-radius:5px;font-size:12px;cursor:pointer;"'
                            : 'disabled style="background:#fca5a5;color:#fff;border:none;' +
                              'padding:3px 11px;border-radius:5px;font-size:12px;cursor:not-allowed;opacity:.6;"'
                        ) + '>🗑 Delete</button>' +
                    '</div>' +
                '</div>' +
                '<div style="font-size:12px;color:#888;">' +
                    esc(b.bill_date) +
                    ' &nbsp;|&nbsp; ' + esc(b.bill_type) +
                    (drTag ? (' &nbsp;|&nbsp; ' + esc(drTag)) : '') +
                    ' &nbsp;|&nbsp; Paid: HK$ ' + fmt2(b.amount_paid) +
                    ' &nbsp;|&nbsp; Balance: HK$ ' + fmt2(b.balance) +
                '</div>';
            div.querySelector('.bd-detail-btn').addEventListener('click', function() {
                showBillDetail(b);
            });
            var payBtn = div.querySelector('.bd-pay-btn');
            if (payBtn) {
                payBtn.addEventListener('click', function() {
                    showBillDetail(b);        // open detail first
                    openAddPaymentModal();    // then immediately open payment form
                });
            }
            if (isAdmin) {
                div.querySelector('.bd-del-btn').addEventListener('click', function() {
                    confirmDeleteBill(b);
                });
            }
            wrap.appendChild(div);
    });
}

// ════════════════════════════════════════════════════════════════
// DELETE BILL
// ════════════════════════════════════════════════════════════════
var bdDeleteTarget = null;

function confirmDeleteBill(b) {
    bdDeleteTarget = b;
    var ref  = b.id ? b.id.slice(0, 8).toUpperCase() : '?';
    var info = g('bdDeleteInfo');
    if (info) {
        info.textContent =
            'Bill Ref: ' + ref +
            '   |   ' + (b.bill_date || '') +
            '   |   HK$ ' + fmt2(b.total) +
            '   |   ' + (b.bill_type || '') +
            (b.doctor_tag || b.doctor_name
                ? '   |   ' + (b.doctor_tag || b.doctor_name)
                : '');
    }
    var inp = g('bdDeleteConfirmInput');
    if (inp) inp.value = '';
    var err = g('bdDeleteError');
    if (err) err.style.display = 'none';
    openModal('billDeleteModal');
}

function executeBillDelete() {
    var inp = g('bdDeleteConfirmInput');
    if (!inp || inp.value.trim().toUpperCase() !== 'DELETE') {
        var err = g('bdDeleteError');
        if (err) { err.textContent = 'Please type DELETE to confirm.'; err.style.display = 'block'; }
        return;
    }
    if (!bdDeleteTarget || !bdDeleteTarget.id) return;

    SB.from('bills').delete().eq('id', bdDeleteTarget.id)
    .then(function(r) {
        if (r.error) {
            var err = g('bdDeleteError');
            if (err) { err.textContent = 'Error: ' + r.error.message; err.style.display = 'block'; }
            return;
        }
        closeModal('billDeleteModal');
        bdDeleteTarget = null;
        loadBillHistory();
    });
}

// ════════════════════════════════════════════════════════════════
// BILL DETAIL POPUP
// ════════════════════════════════════════════════════════════════
var bdCurrentBill = null;

function bdSet(id, val) {
    var e = g(id);
    if (e) e.textContent = (val === null || val === undefined) ? '—' : String(val);
}

function printBillDetailReceipt() {
    if (!bdCurrentBill) return;
    var bill = bdCurrentBill;
    closeModal('billDetailModal');

    SB.from('bill_payments')
        .select('*')
        .eq('bill_id', bill.id)
        .order('paid_date',   { ascending: true })
        .order('created_at',  { ascending: true })
    .then(function(r) {
        var payments = (!r.error && r.data) ? r.data : [];
        showReceipt(bill, [{ id: bill.id }], payments);
    });
}

function showBillDetail(b) {
    bdCurrentBill = b;
    // Reference number
    var ref = b.id ? b.id.slice(0, 8).toUpperCase() : '—';
    bdSet('bdRef', ref);

    // Created timestamp
    var createdStr = '—';
    if (b.created_at) {
        var dt = new Date(b.created_at);
        createdStr = dt.toLocaleDateString('en-HK', {
            day: 'numeric', month: 'short', year: 'numeric'
        }) + '  ' + dt.toLocaleTimeString('en-HK', {
            hour: '2-digit', minute: '2-digit'
        });
    }
    bdSet('bdCreated', createdStr);

    // Status badge
    var badge = g('bdStatusBadge');
    if (badge) {
        badge.textContent = b.status || '—';
        badge.className   = 'status-badge ' + statusClass(b.status);
    }

    // Info fields
    bdSet('bdPatient',   b.patient_name || '—');
    bdSet('bdPatientNo', b.patient_no   || '—');
    bdSet('bdDate',      b.bill_date    || '—');
    bdSet('bdDoctor',    b.doctor_tag   || b.doctor_name || '—');
    bdSet('bdType',      b.bill_type    || '—');

    var notesEl = g('bdNotes');
    if (notesEl) notesEl.textContent = b.notes || '—';

    // Items table — zebra rows
    var items = [];
    try { items = JSON.parse(b.items || '[]'); } catch(e) {}
    var tbody = g('bdItemsBody');
    tbody.innerHTML = '';
    items.forEach(function(it, i) {
        var tr   = document.createElement('tr');
        var disc = parseFloat(it.disc) || 0;
        var amt  = billItemAmt(it);
        tr.style.background = (i % 2 === 0) ? '#fff' : '#f0f5ff';
        tr.innerHTML =
            '<td style="padding:9px 14px;color:#888;width:36px;">' + (i + 1) + '</td>' +
            '<td style="padding:9px 14px;">' + esc(it.desc || '—') + '</td>' +
            '<td style="padding:9px 14px;text-align:center;">' + (it.qty || 0) + '</td>' +
            '<td style="padding:9px 14px;text-align:right;">' + fmt2(it.price) + '</td>' +
            '<td style="padding:9px 14px;text-align:center;color:' + (disc > 0 ? '#dc2626' : '#aaa') + ';">' +
                (disc > 0 ? disc + '%' : '—') +
            '</td>' +
            '<td style="padding:9px 14px;text-align:right;font-weight:600;">' + fmt2(amt) + '</td>';
        tbody.appendChild(tr);
    });
    if (!items.length) {
        tbody.innerHTML =
            '<tr><td colspan="6" style="padding:14px;text-align:center;color:#aaa;">' +
            'No items recorded.</td></tr>';
    }

    // Totals
    var disc = parseFloat(b.discount)    || 0;
    var bal  = parseFloat(b.balance)     || 0;
    g('bdSubtotal').textContent = 'HK$ ' + fmt2(b.subtotal);
    g('bdDiscount').textContent = '- HK$ ' + fmt2(disc);
    g('bdTotal').textContent    = 'HK$ ' + fmt2(b.total);
    g('bdPaid').textContent     = 'HK$ ' + fmt2(b.amount_paid);
    g('bdBalance').textContent  = 'HK$ ' + fmt2(bal);
    g('bdBalance').style.color  = bal > 0 ? 'var(--danger)' : '#16a34a';

    // Outstanding banner + Add Payment button
    var banner = g('bdOutstandingBanner');
    var addBtn = g('bdAddPaymentBtn');
    if (banner) banner.style.display = bal > 0 ? 'block' : 'none';
    if (g('bdOutstandingAmt')) g('bdOutstandingAmt').textContent = 'HK$ ' + fmt2(bal);
    if (addBtn)  addBtn.style.display = bal > 0 ? 'inline-block' : 'none';

    // Load payment history
    loadBillPayments(b.id);

    openModal('billDetailModal');
}

// ════════════════════════════════════════════════════════════════
// PAYMENT HISTORY
// ════════════════════════════════════════════════════════════════
function loadBillPayments(billId) {
    var tbody = g('bdPaymentHistoryBody');
    if (!tbody) return;
    tbody.innerHTML =
        '<tr><td colspan="5" style="padding:12px;text-align:center;' +
        'color:#aaa;font-size:13px;">Loading…</td></tr>';

    SB.from('bill_payments')
        .select('*')
        .eq('bill_id', billId)
        .order('paid_date', { ascending: true })
        .order('created_at', { ascending: true })
    .then(function(r) {
        tbody.innerHTML = '';
        var rows = (!r.error && r.data) ? r.data : [];
        if (!rows.length) {
            tbody.innerHTML =
                '<tr><td colspan="5" style="padding:12px;text-align:center;' +
                'color:#aaa;font-size:13px;">No payment records yet.</td></tr>';
            return;
        }
        rows.forEach(function(p, i) {
            var tr = document.createElement('tr');
            tr.style.background = i % 2 === 0 ? '#fff' : '#f8faff';
            tr.innerHTML =
                '<td style="padding:8px 12px;">' + esc(p.paid_date || '—') + '</td>' +
                '<td style="padding:8px 12px;text-align:right;font-weight:700;' +
                    'color:#16a34a;">HK$ ' + fmt2(p.amount) + '</td>' +
                '<td style="padding:8px 12px;">' + esc(p.method || '—') + '</td>' +
                '<td style="padding:8px 12px;color:#888;">' +
                    esc(p.received_by || '—') + '</td>' +
                '<td style="padding:8px 12px;color:#888;font-size:12px;">' +
                    esc(p.notes || '') + '</td>' +
                '<td style="padding:8px 10px;text-align:center;">' +
                    '<button class="bp-del-btn" data-id="' + esc(p.id) + '" ' +
                    'title="Delete this payment" ' +
                    'style="background:none;border:none;color:#dc2626;' +
                    'font-size:16px;cursor:pointer;line-height:1;padding:0;">×</button>' +
                '</td>';
            tr.querySelector('.bp-del-btn').addEventListener('click', function() {
                deletePaymentRecord(p);
            });
            tbody.appendChild(tr);
        });
    });
}

// ── Open add-payment modal ──────────────────────────────
function openAddPaymentModal() {
    if (!bdCurrentBill) return;
    var bal = parseFloat(bdCurrentBill.balance) || 0;
    var summary = g('apBillSummary');
    if (summary) {
        summary.textContent =
            'Bill Ref: ' + (bdCurrentBill.id || '').slice(0,8).toUpperCase() +
            '  ·  ' + (bdCurrentBill.bill_date || '') +
            '  ·  Total: HK$ ' + fmt2(bdCurrentBill.total);
    }
    var balHint = g('apBalanceHint');
    if (balHint) balHint.textContent = 'HK$ ' + fmt2(bal);

    sv('apDate',   todayISO());
    sv('apAmount', fmt2(bal));   // default = full remaining balance
    sv('apNotes',  '');
    var methodSel = g('apMethod');
    if (methodSel) {
        applyBillTypeOptions(methodSel, false);
        methodSel.selectedIndex = 0;
    }

    var errEl = g('apError');
    if (errEl) errEl.style.display = 'none';

    openModal('addPaymentModal');
}

// ── Confirm & save a new payment ────────────────────────
function confirmAddPayment() {
    if (!bdCurrentBill) return;
    var amount = parseFloat(g('apAmount').value) || 0;
    var errEl  = g('apError');

    if (amount <= 0) {
        if (errEl) { errEl.textContent = 'Please enter a valid amount.'; errEl.style.display = ''; }
        return;
    }
    var bal = parseFloat(bdCurrentBill.balance) || 0;
    if (amount > bal + 0.005) {
        if (errEl) {
            errEl.textContent = 'Amount exceeds outstanding balance (HK$ ' + fmt2(bal) + ').';
            errEl.style.display = '';
        }
        return;
    }
    if (errEl) errEl.style.display = 'none';

    var newPaid    = (parseFloat(bdCurrentBill.amount_paid) || 0) + amount;
    var newBalance = Math.max(0, (parseFloat(bdCurrentBill.total) || 0) - newPaid);
    var newStatus  = newBalance <= 0.005 ? 'Paid' : 'Partial';

    var payRecord = {
        bill_id:     bdCurrentBill.id,
        paid_date:   g('apDate').value || todayISO(),
        amount:      amount,
        method:      g('apMethod').value || 'Cash',
        notes:       g('apNotes').value  || null,
        received_by: (typeof currentName !== 'undefined' ? currentName : null)
    };

    SB.from('bill_payments').insert([payRecord])
    .then(function(r) {
        if (r.error) {
            if (errEl) { errEl.textContent = 'Error: ' + r.error.message; errEl.style.display = ''; }
            return;
        }
        // Update the parent bill's totals
        return SB.from('bills').update({
            amount_paid: newPaid,
            balance:     newBalance,
            status:      newStatus
        }).eq('id', bdCurrentBill.id);
    })
    .then(function(r) {
        if (!r || r.error) return;
        // Refresh in-memory bill object
        bdCurrentBill.amount_paid = newPaid;
        bdCurrentBill.balance     = newBalance;
        bdCurrentBill.status      = newStatus;

        closeModal('addPaymentModal');

        // Refresh the detail view live
        g('bdPaid').textContent    = 'HK$ ' + fmt2(newPaid);
        g('bdBalance').textContent = 'HK$ ' + fmt2(newBalance);
        g('bdBalance').style.color = newBalance > 0 ? 'var(--danger)' : '#16a34a';

        var badge = g('bdStatusBadge');
        if (badge) { badge.textContent = newStatus; badge.className = 'status-badge ' + statusClass(newStatus); }

        var banner = g('bdOutstandingBanner');
        var addBtn = g('bdAddPaymentBtn');
        if (banner) banner.style.display = newBalance > 0 ? 'block' : 'none';
        if (g('bdOutstandingAmt')) g('bdOutstandingAmt').textContent = 'HK$ ' + fmt2(newBalance);
        if (addBtn)  addBtn.style.display = newBalance > 0 ? 'inline-block' : 'none';

        loadBillPayments(bdCurrentBill.id);
        loadBillHistory();
    });
}

function deletePaymentRecord(p) {
    if (!confirm('Delete this payment of HK$ ' + fmt2(p.amount) +
                 ' (' + (p.paid_date || '') + ')?\nThis cannot be undone.')) return;

    SB.from('bill_payments').delete().eq('id', p.id)
    .then(function(r) {
        if (r.error) { alert('Error: ' + r.error.message); return; }

        // Recalculate bill totals from remaining payments
        return SB.from('bill_payments')
            .select('amount')
            .eq('bill_id', p.bill_id);
    })
    .then(function(r) {
        if (!r || r.error) return;
        var newPaid    = (r.data || []).reduce(function(a, x) {
            return a + (parseFloat(x.amount) || 0);
        }, 0);
        var billTotal  = parseFloat(bdCurrentBill ? bdCurrentBill.total : 0) || 0;
        var newBalance = Math.max(0, billTotal - newPaid);
        var newStatus  = newBalance <= 0.005 ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Unpaid');

        return SB.from('bills').update({
            amount_paid: newPaid,
            balance:     newBalance,
            status:      newStatus
        }).eq('id', p.bill_id)
        .then(function(u) {
            if (u.error) return;
            if (bdCurrentBill && bdCurrentBill.id === p.bill_id) {
                bdCurrentBill.amount_paid = newPaid;
                bdCurrentBill.balance     = newBalance;
                bdCurrentBill.status      = newStatus;

                g('bdPaid').textContent    = 'HK$ ' + fmt2(newPaid);
                g('bdBalance').textContent = 'HK$ ' + fmt2(newBalance);
                g('bdBalance').style.color = newBalance > 0 ? 'var(--danger)' : '#16a34a';

                var badge = g('bdStatusBadge');
                if (badge) { badge.textContent = newStatus; badge.className = 'status-badge ' + statusClass(newStatus); }

                var banner = g('bdOutstandingBanner');
                var addBtn = g('bdAddPaymentBtn');
                if (banner) banner.style.display = newBalance > 0 ? 'block' : 'none';
                if (g('bdOutstandingAmt')) g('bdOutstandingAmt').textContent = 'HK$ ' + fmt2(newBalance);
                if (addBtn)  addBtn.style.display = newBalance > 0 ? 'inline-block' : 'none';

                loadBillPayments(p.bill_id);
                loadBillHistory();
            }
        });
    });
}

var _receiptPrintInProgress = false;

/** CSS embedded in the receipt print popup (one physical page, no fixed positioning). */
function receiptPrintStyles() {
    return (
        'body{font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#222;margin:12px 16px;}' +
        '.receipt-header{text-align:center;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #eee;}' +
        '.receipt-header h2{margin:0 0 6px;color:#0084ff;font-size:22px;}' +
        '.receipt-clinic-line{margin:2px 0;color:#555;font-size:13px;line-height:1.45;}' +
        '.receipt-doc-title{margin:10px 0 0;color:#666;font-size:14px;font-weight:600;}' +
        '.receipt-table{width:100%;border-collapse:collapse;margin:16px 0;}' +
        '.receipt-table th{background:#f0f7ff;padding:9px 12px;text-align:left;font-size:13px;color:#0084ff;}' +
        '.receipt-table td{padding:9px 12px;border-bottom:1px solid #f0f0f0;font-size:14px;}' +
        '.receipt-totals{background:#f8faff;border-radius:8px;padding:14px 16px;margin-top:12px;}' +
        '.r-row{display:flex;justify-content:space-between;padding:5px 0;font-size:14px;}' +
        '.r-grand{border-top:2px solid #0084ff;margin-top:8px;padding-top:10px;font-size:18px;font-weight:700;color:#0084ff;}' +
        '.receipt-footer{text-align:center;margin-top:20px;padding-top:16px;border-top:1px solid #eee;color:#999;font-size:12px;}' +
        '@media print{body{margin:8px;} @page{margin:10mm;}}'
    );
}

/**
 * Print receipt in a dedicated popup so the bill appears once (avoids duplicate pages from
 * position:fixed + visibility print CSS on the main app window).
 */
function printReceiptDocument() {
    var area = g('receiptPrintArea');
    if (!area) return;
    if (_receiptPrintInProgress) return;
    _receiptPrintInProgress = true;

    var popup = window.open(
        '', '_blank',
        'width=720,height=820,left=80,top=40,toolbar=0,menubar=0,scrollbars=1,resizable=1'
    );
    if (!popup) {
        _receiptPrintInProgress = false;
        alert('Please allow pop-ups to print the receipt.');
        return;
    }

    var releaseLock = function () {
        _receiptPrintInProgress = false;
    };

    popup.document.write(
        '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<title>Receipt</title><style>' + receiptPrintStyles() + '</style></head><body>' +
        area.innerHTML +
        '<script>(function(){var printed=false;function run(){if(printed)return;printed=true;' +
        'try{window.focus();window.print();}catch(e){}}' +
        'window.onafterprint=function(){try{window.close();}catch(e2){}};' +
        'window.onload=function(){setTimeout(run,200);};' +
        'setTimeout(function(){if(!printed)run();},1200);})();<\/script>' +
        '</body></html>'
    );
    popup.document.close();

    try { popup.focus(); } catch (eFocus) {}
    setTimeout(releaseLock, 4000);
}

/** Receipt print header: active clinic from login (currentClinicId + clinics row). Order: name, address, phone. */
function applyReceiptClinicHeader() {
    var rec = (typeof clinicRecordFromId === 'function' && currentClinicId)
        ? clinicRecordFromId(currentClinicId)
        : null;
    var nmEl = g('rClinicName');
    var addrEl = g('rClinicAddrLine');
    var telEl = g('rClinicTelLine');
    var footEl = g('rReceiptFooterThanks');

    var name = '';
    var addr = '';
    var tel = '';
    if (rec) {
        name = String(rec.english_name || rec.chinese_name || '').trim();
        addr = String(rec.address || '').trim();
        tel = String(rec.tel || '').trim();
    }
    if (!name && currentClinicLabel) name = String(currentClinicLabel).trim();
    if (!name) name = 'Joyful Smile Dental Clinic';

    if (nmEl) nmEl.textContent = name;
    if (addrEl) addrEl.textContent = addr || '—';
    if (telEl) telEl.textContent = 'Tel: ' + (tel || '—');
    if (footEl) footEl.textContent = 'Thank you for visiting ' + name;
}

function showReceipt(bill, insertedData, payments, autoPrint) {
    applyReceiptClinicHeader();

    var rNo = insertedData && insertedData[0]
        ? insertedData[0].id.slice(0, 8).toUpperCase()
        : 'RCP-' + Date.now();

    g('rNo').textContent        = rNo;
    g('rDate').textContent      = bill.bill_date;
    g('rType').textContent      = bill.bill_type;
    g('rPatient').textContent   = bill.patient_name;
    g('rPatientNo').textContent = bill.patient_no;
    if (g('rDoctor')) {
        g('rDoctor').textContent =
            bill.doctor_tag || bill.doctor_name ||
            ((typeof currentDoctorName !== 'undefined' && currentDoctorName)
                ? currentDoctorName
                : (currentName || '—'));
    }

    // ── Item rows (with disc %) ──────────────────────────
    var items = [];
    try { items = JSON.parse(bill.items || '[]'); } catch(e) {}
    var rb = g('rItemsBody');
    rb.innerHTML = '';
    items.forEach(function(it) {
        var disc = parseFloat(it.disc) || 0;
        var amt  = billItemAmt(it);
        var tr   = document.createElement('tr');
        tr.innerHTML =
            '<td style="padding:6px 8px;">' + esc(it.desc || '-') + '</td>' +
            '<td style="padding:6px 8px;text-align:center;">' + (it.qty || 0) + '</td>' +
            '<td style="padding:6px 8px;text-align:right;">HK$ ' + fmt2(it.price) + '</td>' +
            '<td style="padding:6px 8px;text-align:center;color:' +
                (disc > 0 ? '#dc2626' : '#aaa') + ';">' +
                (disc > 0 ? disc + '%' : '—') + '</td>' +
            '<td style="padding:6px 8px;text-align:right;">HK$ ' + fmt2(amt) + '</td>';
        rb.appendChild(tr);
    });

    g('rSubtotal').textContent = fmt2(bill.subtotal);
    g('rDiscount').textContent = fmt2(bill.discount);
    g('rTotal').textContent    = fmt2(bill.total);
    g('rPaid').textContent     = fmt2(bill.amount_paid);
    g('rBalance').textContent  = 'HK$ ' + fmt2(bill.balance);

    // ── Instalment payments section ──────────────────────
    var pmts      = payments || [];
    var bal       = parseFloat(bill.balance) || 0;
    var showPmts  = pmts.length > 1 || (pmts.length === 1 && bal > 0);
    var secEl     = g('rInstalmentsSection');
    var bodyEl    = g('rInstalmentsBody');
    var outRow    = g('rOutstandingRow');
    var outAmt    = g('rOutstandingAmt');

    if (secEl) secEl.style.display = showPmts ? '' : 'none';
    if (bodyEl) {
        bodyEl.innerHTML = '';
        pmts.forEach(function(p, i) {
            var tr = document.createElement('tr');
            tr.style.background = i % 2 === 0 ? '#fff' : '#f8faff';
            tr.innerHTML =
                '<td style="padding:5px 8px;color:#888;">' + (i + 1) + '</td>' +
                '<td style="padding:5px 8px;">' + esc(p.paid_date || '—') + '</td>' +
                '<td style="padding:5px 8px;text-align:right;font-weight:700;' +
                    'color:#16a34a;">HK$ ' + fmt2(p.amount) + '</td>' +
                '<td style="padding:5px 8px;">' + esc(p.method || '—') + '</td>' +
                '<td style="padding:5px 8px;color:#888;font-size:11px;">' +
                    esc(p.notes || '') + '</td>';
            bodyEl.appendChild(tr);
        });
    }
    if (outRow)  outRow.style.display  = bal > 0 ? 'flex' : 'none';
    if (outAmt)  outAmt.textContent    = 'HK$ ' + fmt2(bal);

    openModal('receiptModal');
    if (autoPrint) {
        setTimeout(function () { printReceiptDocument(); }, 400);
    }
}

function checkInFromToday(apptId) {
    var appt = null;
    for (var i = 0; i < todayAppts.length; i++) {
        if (todayAppts[i].id === apptId) { appt = todayAppts[i]; break; }
    }
    if (appt && todayApptNeedsPatientReg(appt)) {
        alert('Please register this walk-in patient first (New Patient).');
        return;
    }
    var now = new Date();
    var arrivalTime = now.toISOString();

    var cq2 = SB.from('appointments')
        .select('in_queue')
        .eq('date', todayISO())
        .not('in_queue', 'is', null)
        .order('in_queue', { ascending: false })
        .limit(1);
    cq2 = applyApptModuleClinicQuery(cq2);
    cq2.then(function(r) {
        var nextQ = 1;
        if (!r.error && r.data && r.data.length > 0) {
            nextQ = (r.data[0].in_queue || 0) + 1;
        }
        SB.from('appointments')
            .update({
                arrived:      true,
                arrival_time: arrivalTime,
                in_queue:     nextQ,
                bill_status:  'Queue'
            })
            .eq('id', apptId)
        .then(function(u) {
            if (u.error) { alert('Error: ' + u.error.message); return; }
            loadToday();
            loadQueue();
            switchApptTab('queue');
        });
    });
}
