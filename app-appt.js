// ════════════════════════════════════════════════════════════════
// APPOINTMENT MODULE
// ════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
var apptEditId   = null;
/** Appointment row while edit modal is open (for schedule-lock checks). */
var apptEditLockRef = null;
var apptEditScheduleLocked = false;
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
var billPendingRefreshTimer = null;
var billPendingRefreshBusy = false;
var billPendingRefreshState = 'idle';
var billPendingLastRefreshAt = null;
var DEFAULT_BILL_PENDING_REFRESH_MS = 10000;

var todayAppts   = [];   // last-fetched list for the Today tab (used by print)
/** Today's walk-in appointment id awaiting patient registration before check-in. */
var todayApptPendingPatientRegId = null;

// ── + Appointment tab (day planner) ─────────────────────────────
var plusApptDate = '';
var plusApptMiniCalMonth = new Date();
var plusApptDayAppts = [];
var plusApptSelectedSlot = null;
var plusApptSelectedAppt = null;
var plusApptHeaderPatient = null;
var plusApptPatientFilterQ = '';
var plusApptPsTimer = null;
var plusApptTabBound = false;
var plusApptActiveClinicId = '';
var plusApptActiveDoctorCode = '';
var plusApptClinicUiState = {};
var plusApptClinicSyncing = false;
var plusApptAllActiveDoctorCode = '';
var PLUSAPPT_DOCTOR_ALL = '__all__';
var PLUSAPPT_SLOT_MIN = 15;
var PLUSAPPT_CLINIC_THEMES = [
    { bg: '#eff6ff', border: '#3b82f6', sel: '#2563eb', accent: '#1e40af', shadow: 'rgba(37,99,235,0.12)', badge: '#dbeafe' },
    { bg: '#f0fdf4', border: '#22c55e', sel: '#16a34a', accent: '#166534', shadow: 'rgba(34,197,94,0.12)', badge: '#dcfce7' },
    { bg: '#fdf4ff', border: '#a855f7', sel: '#9333ea', accent: '#6b21a8', shadow: 'rgba(168,85,247,0.12)', badge: '#f3e8ff' },
    { bg: '#fff7ed', border: '#f97316', sel: '#ea580c', accent: '#9a3412', shadow: 'rgba(249,115,22,0.12)', badge: '#ffedd5' },
    { bg: '#ecfeff', border: '#06b6d4', sel: '#0891b2', accent: '#155e75', shadow: 'rgba(6,182,212,0.12)', badge: '#cffafe' },
    { bg: '#fef2f2', border: '#ef4444', sel: '#dc2626', accent: '#991b1b', shadow: 'rgba(239,68,68,0.12)', badge: '#fee2e2' },
    { bg: '#f8fafc', border: '#64748b', sel: '#475569', accent: '#334155', shadow: 'rgba(100,116,139,0.12)', badge: '#e2e8f0' },
    { bg: '#fefce8', border: '#eab308', sel: '#ca8a04', accent: '#854d0e', shadow: 'rgba(234,179,8,0.14)', badge: '#fef9c3' }
];

/** Appointment id whose remarks are open in `queueRemarksModal`. */
var queueRemarksEditApptId = null;
/** Full appointment row for queue remarks modal (language refresh). */
var _queueRemarksEditAppt = null;
/** Raw remarks before edit (preserve staff author tag when doctor saves). */
var queueRemarksEditPriorRaw = null;
var queueRemarksModalBound = false;

/** When true, appointment date must be today or later (records tab: new visit from a past row). */
var arBookingMinDateToday = false;

// ── Pending bill item lists (Step 1 / Step 2) ─────────
var pendingLists = [];   // array fetched from pending_bill_items table

function tr(key) {
    return typeof t === 'function' ? t(key) : key;
}

function trRepl(key, pairs) {
    var s = tr(key);
    if (!pairs) return s;
    for (var k in pairs) {
        if (Object.prototype.hasOwnProperty.call(pairs, k)) {
            s = s.split('{' + k + '}').join(String(pairs[k]));
        }
    }
    return s;
}

function refreshApptDurOptions() {
    var sel = g('fDur');
    if (!sel) return;
    for (var i = 0; i < sel.options.length; i++) {
        var v = sel.options[i].value;
        sel.options[i].textContent = trRepl('appt.modal.durMin', { N: v });
    }
}

function refreshApptModalTitle() {
    var titleEl = g('apptModalTitle');
    if (!titleEl) return;
    if (apptEditId) {
        titleEl.textContent = tr('appt.modal.editAppt');
    } else if (arBookingMinDateToday) {
        titleEl.textContent = tr('appt.modal.newApptSame');
    } else {
        titleEl.textContent = tr('appt.modal.newAppt');
    }
}

function refreshApptModalI18n() {
    var modal = g('apptModal');
    if (!modal) return;
    if (typeof applyI18nInRoot === 'function') applyI18nInRoot(modal);
    refreshApptModalTitle();
    if (apptEditScheduleLocked && typeof setApptScheduleLockFormUI === 'function') {
        setApptScheduleLockFormUI(true);
    }
    refreshApptDurOptions();
    var drSel = g('fApptDoctor');
    if (drSel && drSel.options.length) {
        drSel.options[0].textContent = tr('appt.modal.selectDoctor');
        if (drSel.options.length > 1) {
            var lastDr = drSel.options[drSel.options.length - 1];
            if (lastDr && lastDr.disabled && !lastDr.value) {
                lastDr.textContent = tr('appt.modal.noDoctorsForClinic');
            }
        }
    }
    if (typeof renderApptDoctorColorPreview === 'function') renderApptDoctorColorPreview();
}

function apptDateLocale() {
    if (typeof appUiLocale === 'function') return appUiLocale();
    if (typeof appUiLang === 'string' && appUiLang.indexOf('Hant') >= 0) return 'zh-HK';
    if (typeof appUiLang === 'string' && appUiLang.indexOf('CN') >= 0) return 'zh-CN';
    return 'en-HK';
}

function apptCalWeekdayHeaders() {
    var loc = apptDateLocale();
    var out = [];
    var i;
    for (i = 0; i < 7; i++) {
        out.push(new Date(2024, 0, 7 + i).toLocaleDateString(loc, { weekday: 'short' }));
    }
    return out;
}
var pendingIdx   = -1;   // which list is open in Step 1
var payItems     = [];   // items from the list selected in Step 2
var payPendingId = null; // DB id of the list selected for payment
var pendingServerSnapshotById = {};

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
        sel.innerHTML = '<option value="">' + esc(tr('common.noClinics')) + '</option>';
        return;
    }
    APP_CLINICS.forEach(function(c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = (c.clinic_code ? ('[' + c.clinic_code + '] ') : '') +
            (c.english_name || c.chinese_name || clinicDisplayFallback());
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

/** Keep + Appointment day and Calendar view on the same date/clinic data. */
function syncApptPlannerDate(iso, opts) {
    opts = opts || {};
    var isoStr = String(iso || '').trim();
    if (!isoStr) isoStr = todayISO();
    plusApptDate = isoStr;
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    if (cid) {
        var st = plusApptClinicUiState[cid];
        if (st) st.date = isoStr;
    }
    var d = typeof parseISODateOnly === 'function' ? parseISODateOnly(isoStr) : null;
    if (d && !isNaN(d.getTime())) {
        plusApptMiniCalMonth = new Date(d.getFullYear(), d.getMonth(), 1);
        if (opts.syncCal !== false) {
            calDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        }
    }
    if (typeof plusApptSyncDateLabel === 'function') plusApptSyncDateLabel();
    if (typeof plusApptSyncTimelineHead === 'function') plusApptSyncTimelineHead();
}

/** Reload day planner (+ Appointment) and calendar from Supabase (same clinic scope). */
function refreshApptPlannerData() {
    if (!apptSectionIsActive()) return;
    if (!plusApptDate) plusApptDate = todayISO();
    var tab = typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : null;
    if (tab === 'plusappt' && typeof loadPlusApptDay === 'function') {
        loadPlusApptDay();
    }
    if (tab === 'calendar' && typeof renderCal === 'function') {
        if (typeof GCAL !== 'undefined' && GCAL.isInteractionActive && GCAL.isInteractionActive()) {
            return;
        }
        renderCal();
    } else if (!tab && typeof renderCal === 'function') {
        renderCal();
    }
}

function reloadApptModuleData() {
    if (!apptSectionIsActive()) return;
    var tab = apptActiveTabKey();
    if (tab === 'queue') loadQueue();
    else if (tab === 'today') loadToday();
    else if (tab === 'plusappt' || tab === 'calendar') refreshApptPlannerData();
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
    var plusSel = g('plusApptClinicSelect');
    if (plusSel && plusSel.value !== sel.value) {
        plusApptClinicSyncing = true;
        plusSel.value = sel.value;
        plusApptActiveClinicId = sel.value;
        plusApptClinicSyncing = false;
    }
    if (apptActiveTabKey() === 'plusappt' && typeof onPlusApptClinicChange === 'function') {
        onPlusApptClinicChange();
        return;
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
    refreshApptDurOptions();
    refreshApptHeaderI18n();
    populateApptClinicSelect();
    bindApptClinicSelectOnce();
    var apSel = g('apptClinicSelect');
    if (apSel && apSel.value && typeof setWorkingClinic === 'function') {
        setWorkingClinic(apSel.value, { syncFilters: true, reloadAppt: false });
    }
    var qb = g('queueBody');
    if (qb) bindQueueReorderHandlers(qb);
    bindQueueRemarksModalOnce();
    initApptRemarksRichEditors();
    bindPlusApptTabOnce();
    switchApptTab('queue');
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
    if (tab === 'plusappt') showPlusApptTab();
    if (tab === 'calendar') showCalendarTab();
    if (tab === 'records')  loadApptRecords();
    if (tab === 'recall')   initRecallTab();
}

// ════════════════════════════════════════════════════════════════
// + APPOINTMENT TAB — day planner (mini cal + time slots)
// ════════════════════════════════════════════════════════════════
function plusApptClinicThemeIndex(clinicId) {
    if (!clinicId || !APP_CLINICS || !APP_CLINICS.length) return 0;
    var idx = 0;
    for (var i = 0; i < APP_CLINICS.length; i++) {
        if (APP_CLINICS[i].id === clinicId) {
            idx = i;
            break;
        }
    }
    return idx % PLUSAPPT_CLINIC_THEMES.length;
}

function plusApptClinicTheme(clinicId) {
    return PLUSAPPT_CLINIC_THEMES[plusApptClinicThemeIndex(clinicId)];
}

function plusApptClinicLabel(clinicId) {
    if (typeof clinicRecordFromId === 'function') {
        var rec = clinicRecordFromId(clinicId);
        if (rec) {
            return (rec.clinic_code ? ('[' + String(rec.clinic_code).trim() + '] ') : '') +
                (rec.english_name || rec.chinese_name || '');
        }
    }
    return (typeof clinicDisplayFallback === 'function')
        ? clinicDisplayFallback()
        : tr('common.clinic');
}

function plusApptGetClinicState() {
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    if (!cid) return null;
    if (!plusApptClinicUiState[cid]) {
        plusApptClinicUiState[cid] = { doctors: {}, date: '', miniCalMonthMs: 0, activeDoctor: '' };
    }
    return plusApptClinicUiState[cid];
}

function plusApptSaveUiState() {
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    if (!cid) return;
    var st = plusApptGetClinicState();
    st.date = plusApptDate;
    st.miniCalMonthMs = plusApptMiniCalMonth.getTime();
    st.activeDoctor = plusApptActiveDoctorCode;
    var dk = plusApptIsAllDoctorsMode()
        ? (plusApptAllActiveDoctorCode || '_none')
        : (plusApptActiveDoctorCode || '_none');
    if (!st.doctors[dk]) st.doctors[dk] = {};
    st.doctors[dk].slot = plusApptSelectedSlot;
    st.doctors[dk].apptId = plusApptSelectedAppt ? plusApptSelectedAppt.id : null;
}

function plusApptFindApptById(id) {
    if (!id) return null;
    for (var i = 0; i < plusApptDayAppts.length; i++) {
        if (plusApptDayAppts[i].id === id) return plusApptDayAppts[i];
    }
    return null;
}

function plusApptRestoreDoctorSelection() {
    plusApptSelectedSlot = null;
    plusApptSelectedAppt = null;
    var st = plusApptGetClinicState();
    if (!st) {
        plusApptRefreshAddBtn();
        plusApptRefreshShortcuts();
        return;
    }
    if (plusApptIsAllDoctorsMode()) {
        var docs = plusApptDoctorsForActiveClinic();
        var dkAll = plusApptAllActiveDoctorCode || st.activeDoctor;
        if (dkAll === PLUSAPPT_DOCTOR_ALL && docs.length) {
            dkAll = docs[0].doctor_code;
        }
        if (dkAll && dkAll !== PLUSAPPT_DOCTOR_ALL) plusApptAllActiveDoctorCode = dkAll;
    }
    var dk = plusApptIsAllDoctorsMode()
        ? (plusApptAllActiveDoctorCode || '_none')
        : (plusApptActiveDoctorCode || '_none');
    var dr = st.doctors[dk];
    if (!dr) {
        plusApptRefreshAddBtn();
        plusApptRefreshShortcuts();
        return;
    }
    if (dr.apptId) {
        var a = plusApptFindApptById(dr.apptId);
        if (a && plusApptApptMatchesDoctor(a, plusApptActiveDoctorCode)) {
            plusApptSelectApptRow(a, true);
            return;
        }
    }
    if (dr.slot) {
        plusApptSelectEmptySlot(dr.slot, true);
    } else {
        plusApptRefreshAddBtn();
        plusApptRefreshShortcuts();
    }
}

function plusApptRestoreClinicUiState(clinicId) {
    var st = plusApptClinicUiState[clinicId];
    if (!st) {
        plusApptDate = todayISO();
        plusApptMiniCalMonth = new Date();
        plusApptActiveDoctorCode = '';
        return;
    }
    plusApptDate = st.date || todayISO();
    if (st.miniCalMonthMs) {
        plusApptMiniCalMonth = new Date(st.miniCalMonthMs);
    } else {
        var d = typeof parseISODateOnly === 'function' ? parseISODateOnly(plusApptDate) : null;
        plusApptMiniCalMonth = (d && !isNaN(d.getTime()))
            ? new Date(d.getFullYear(), d.getMonth(), 1)
            : new Date();
    }
    plusApptActiveDoctorCode = st.activeDoctor || '';
}

function plusApptApplyClinicTheme() {
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    var theme = plusApptClinicTheme(cid);
    var cal = g('plusApptMiniCal');
    var badge = g('plusApptClinicBadge');
    if (cal) {
        cal.style.setProperty('--plusappt-cal-bg', theme.bg);
        cal.style.setProperty('--plusappt-cal-border', theme.border);
        cal.style.setProperty('--plusappt-cal-sel', theme.sel);
        cal.style.setProperty('--plusappt-cal-accent', theme.accent);
        cal.style.setProperty('--plusappt-cal-shadow', theme.shadow);
        cal.style.setProperty('--plusappt-cal-day-bg', theme.badge);
        cal.style.setProperty('--plusappt-cal-day-hover', theme.bg);
        cal.dataset.clinicTheme = String(plusApptClinicThemeIndex(cid));
    }
    if (badge) {
        badge.textContent = plusApptClinicLabel(cid);
        badge.style.background = theme.badge;
        badge.style.borderColor = theme.border;
        badge.style.color = theme.accent;
    }
}

function plusApptDoctorColor(code) {
    if (!code) return '#94a3b8';
    if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.getColor) {
        return CalDoctorColors.getColor(code);
    }
    return '#0084ff';
}

function plusApptIsAllDoctorsMode() {
    return plusApptActiveDoctorCode === PLUSAPPT_DOCTOR_ALL;
}

function plusApptEffectiveDoctorCode() {
    if (plusApptIsAllDoctorsMode()) return plusApptAllActiveDoctorCode || '';
    return plusApptActiveDoctorCode || '';
}

/** Login identity placeholder (ALL, ALL_TKO, …), not a clinical doctor row. */
function isPlusApptExcludedDoctor(d) {
    if (typeof isClinicalDoctorRecord === 'function') {
        return !isClinicalDoctorRecord(d);
    }
    if (!d) return true;
    var code = String(d.doctor_code || '').trim().toLowerCase();
    return code === 'all' || /^all[_-]/.test(code);
}

function plusApptDoctorsForActiveClinic() {
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    var list = typeof doctorsForClinic === 'function'
        ? doctorsForClinic(cid)
        : (billDoctorList || []).filter(function(d) {
            return !cid || d.clinic_id === cid;
        });
    return (list || []).filter(function(d) {
        return d && d.is_active !== false && String(d.doctor_code || '').trim() &&
            !isPlusApptExcludedDoctor(d);
    });
}

function plusApptToggleScheduleViews() {
    var single = g('plusApptSingleView');
    var allV = g('plusApptAllView');
    var allMode = plusApptIsAllDoctorsMode();
    if (single) {
        single.style.display = allMode ? 'none' : 'block';
        single.setAttribute('aria-hidden', allMode ? 'true' : 'false');
    }
    if (allV) {
        allV.style.display = allMode ? 'block' : 'none';
        allV.setAttribute('aria-hidden', allMode ? 'false' : 'true');
    }
}

function plusApptApptMatchesDoctor(a, code) {
    if (!code) return true;
    if (!a) return false;
    var c = String(code).trim().toLowerCase();
    var dc = String(a.doctor_code || '').trim().toLowerCase();
    if (dc && dc === c) return true;
    var dn = String(a.doctor_name || '').trim().toLowerCase();
    if (dn && dn === c) return true;
    return false;
}

function populatePlusApptClinicSelect() {
    var sel = g('plusApptClinicSelect');
    if (!sel) return;
    var prev = sel.value || plusApptActiveClinicId;
    sel.innerHTML = '';
    if (!APP_CLINICS || !APP_CLINICS.length) {
        sel.innerHTML = '<option value="">' + esc(tr('common.noClinics')) + '</option>';
        return;
    }
    APP_CLINICS.forEach(function(c, i) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = (c.clinic_code ? ('[' + c.clinic_code + '] ') : '') +
            (c.english_name || c.chinese_name || clinicDisplayFallback());
        o.dataset.themeIdx = String(i % PLUSAPPT_CLINIC_THEMES.length);
        sel.appendChild(o);
    });
    var def = typeof defaultWorkingClinicId === 'function'
        ? defaultWorkingClinicId()
        : (APP_CLINICS[0] ? APP_CLINICS[0].id : '');
    var has = false;
    for (var j = 0; j < sel.options.length; j++) {
        if (sel.options[j].value === prev) { has = true; break; }
    }
    sel.value = has ? prev : def;
    plusApptActiveClinicId = sel.value;
}

function populatePlusApptDoctorSelect() {
    var sel = g('plusApptDoctorSelect');
    if (!sel) return;
    var prev = sel.value || plusApptActiveDoctorCode;
    sel.innerHTML = '';
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    var list = plusApptDoctorsForActiveClinic();
    if (!list.length) {
        sel.innerHTML = '<option value="">' + esc(tr('appt.modal.noDoctorsForClinic')) + '</option>';
        plusApptActiveDoctorCode = '';
        plusApptAllActiveDoctorCode = '';
        return;
    }
    var allOpt = document.createElement('option');
    allOpt.value = PLUSAPPT_DOCTOR_ALL;
    allOpt.textContent = tr('common.all');
    sel.appendChild(allOpt);
    list.forEach(function(d) {
        var code = String(d.doctor_code || '').trim();
        var opt = document.createElement('option');
        opt.value = code;
        opt.textContent = (typeof doctorDisplayName === 'function'
            ? doctorDisplayName(d)
            : (d.english_name || d.chinese_name || code)) +
            ' [' + code + ']';
        sel.appendChild(opt);
    });
    if (prev && typeof isLoginPlaceholderDoctorCode === 'function' &&
        isLoginPlaceholderDoctorCode(prev) && prev !== PLUSAPPT_DOCTOR_ALL) {
        prev = PLUSAPPT_DOCTOR_ALL;
    }
    var has = false;
    for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === prev) { has = true; break; }
    }
    if (!has) {
        var st = plusApptGetClinicState();
        prev = (st && st.activeDoctor) ? st.activeDoctor : list[0].doctor_code;
        if (prev && typeof isLoginPlaceholderDoctorCode === 'function' &&
            isLoginPlaceholderDoctorCode(prev) && prev !== PLUSAPPT_DOCTOR_ALL) {
            prev = PLUSAPPT_DOCTOR_ALL;
        }
        has = !!prev;
    }
    sel.value = has ? prev : list[0].doctor_code;
    plusApptActiveDoctorCode = sel.value;
    if (plusApptIsAllDoctorsMode()) {
        plusApptAllActiveDoctorCode = plusApptAllActiveDoctorCode || list[0].doctor_code;
    } else {
        plusApptAllActiveDoctorCode = '';
    }
}

function plusApptSyncTimelineHead() {
    var head = g('plusApptTimelineHead');
    var sel = g('plusApptDoctorSelect');
    if (!head) return;
    if (!sel || !sel.value) {
        head.innerHTML = '<span>' + esc(tr('appt.plusAppt.pickDoctor')) + '</span>';
        return;
    }
    var dateStr = plusApptDate && typeof fmtDateLong === 'function'
        ? fmtDateLong(plusApptDate, { long: true })
        : (plusApptDate || '');
    if (plusApptIsAllDoctorsMode()) {
        var n = plusApptDoctorsForActiveClinic().length;
        head.innerHTML =
            '<span class="plusappt-dr-dot" style="background:linear-gradient(135deg,#3b82f6,#22c55e);"></span>' +
            '<span>' + esc(tr('appt.plusAppt.allTimelines')) + '</span>' +
            '<span class="plusappt-dr-sub">' + esc(dateStr) +
            ' · ' + esc(trRepl('appt.plusAppt.allScrollHint', { N: String(n) })) + '</span>';
        return;
    }
    var code = sel.value;
    var col = plusApptDoctorColor(code);
    var opt = sel.options[sel.selectedIndex];
    var name = opt ? opt.textContent : code;
    head.innerHTML =
        '<span class="plusappt-dr-dot" style="background:' + esc(col) + ';"></span>' +
        '<span>' + esc(tr('appt.plusAppt.timelineFor')) + ' ' + esc(name) + '</span>' +
        '<span class="plusappt-dr-sub">' + esc(dateStr) + '</span>';
}

function onPlusApptClinicChange() {
    if (plusApptClinicSyncing) return;
    var sel = g('plusApptClinicSelect');
    if (!sel || !sel.value) return;
    plusApptSaveUiState();
    plusApptActiveClinicId = sel.value;
    var apptSel = g('apptClinicSelect');
    if (apptSel && apptSel.value !== sel.value) {
        plusApptClinicSyncing = true;
        apptSel.value = sel.value;
        plusApptClinicSyncing = false;
    }
    if (typeof setWorkingClinic === 'function') {
        setWorkingClinic(sel.value, { syncFilters: true, reloadAppt: false });
    }
    plusApptRestoreClinicUiState(sel.value);
    populatePlusApptDoctorSelect();
    var drSel = g('plusApptDoctorSelect');
    if (drSel) plusApptActiveDoctorCode = drSel.value;
    plusApptApplyClinicTheme();
    plusApptSyncDateLabel();
    plusApptToggleScheduleViews();
    plusApptSyncTimelineHead();
    renderPlusApptMiniCal();
    refreshApptPlannerData();
}

function onPlusApptDoctorChange() {
    plusApptSaveUiState();
    var sel = g('plusApptDoctorSelect');
    plusApptActiveDoctorCode = sel ? sel.value : '';
    var st = plusApptGetClinicState();
    if (st) st.activeDoctor = plusApptActiveDoctorCode;
    if (plusApptIsAllDoctorsMode()) {
        var docs = plusApptDoctorsForActiveClinic();
        if (!plusApptAllActiveDoctorCode && docs.length) {
            plusApptAllActiveDoctorCode = docs[0].doctor_code;
        }
    } else {
        plusApptAllActiveDoctorCode = '';
    }
    plusApptClearSelection(true);
    plusApptToggleScheduleViews();
    plusApptSyncTimelineHead();
    renderPlusApptSchedule();
    plusApptRestoreDoctorSelection();
}

function plusApptNormTime(t) {
    var s = String(t || '').trim();
    if (!s) return '';
    var p = s.split(':');
    return pad(+p[0] || 0) + ':' + pad(+p[1] || 0);
}

function plusApptSlotList() {
    var out = [];
    var h;
    var m;
    for (h = 8; h <= 20; h++) {
        for (m = 0; m < 60; m += PLUSAPPT_SLOT_MIN) {
            if (h === 20 && m > 0) break;
            out.push(pad(h) + ':' + pad(m));
        }
    }
    return out;
}

function plusApptTimeCellHtml(slot) {
    var parts = slot.split(':');
    var isHour = parts[1] === '00';
    var cls = isHour ? 'plusappt-time-hour' : 'plusappt-time-interval';
    var disp = typeof fmt12 === 'function' ? fmt12(slot) : slot;
    return '<span class="' + cls + '">' + esc(disp) + '</span>';
}

function plusApptSyncDateLabel() {
    var el = g('plusApptDateLabel');
    if (!el || !plusApptDate) return;
    el.textContent = typeof fmtDateLong === 'function'
        ? fmtDateLong(plusApptDate, { long: true })
        : plusApptDate;
}

function plusApptRefreshAddBtn() {
    var btn = g('plusApptAddBtn');
    if (!btn) return;
    var dr = plusApptEffectiveDoctorCode();
    var on = !!(plusApptDate && plusApptSelectedSlot && !plusApptSelectedAppt && dr);
    btn.disabled = !on;
    btn.classList.toggle('plusappt-add-btn--ready', on);
}

function plusApptRefreshShortcuts() {
    var has = !!plusApptSelectedAppt;
    ['plusApptScEditPatient', 'plusApptScNotes', 'plusApptScDrugs', 'plusApptScBill',
        'plusApptScHistory', 'plusApptScRemarks', 'plusApptScEditAppt'].forEach(function(id) {
        var b = g(id);
        if (b) b.disabled = !has;
    });
}

function plusApptClearRowHighlights(root) {
    var scope = root || document;
    scope.querySelectorAll('.plusappt-slot-row.plusappt-row-selected').forEach(function(r) {
        r.classList.remove('plusappt-row-selected');
    });
}

function plusApptClearSelection(skipSave) {
    plusApptSelectedSlot = null;
    plusApptSelectedAppt = null;
    plusApptRefreshAddBtn();
    plusApptRefreshShortcuts();
    plusApptClearRowHighlights(document);
    if (!skipSave) plusApptSaveUiState();
}

function plusApptHighlightRows(slot, apptId, doctorCode) {
    var root = plusApptIsAllDoctorsMode() ? g('plusApptAllScroll') : g('plusApptSingleView');
    if (!root) return;
    root.querySelectorAll('.plusappt-slot-row').forEach(function(row) {
        var colDr = row.dataset.doctorCode || '';
        if (plusApptIsAllDoctorsMode() && doctorCode && colDr !== doctorCode) {
            row.classList.remove('plusappt-row-selected');
            return;
        }
        var isSel = apptId
            ? row.dataset.apptId === apptId
            : (row.dataset.slotTime === slot && !row.dataset.apptId);
        row.classList.toggle('plusappt-row-selected', isSel);
    });
}

function plusApptSelectEmptySlot(slot, skipSave, doctorCode) {
    if (plusApptIsAllDoctorsMode() && doctorCode) {
        plusApptAllActiveDoctorCode = doctorCode;
    }
    plusApptSelectedSlot = slot;
    plusApptSelectedAppt = null;
    plusApptRefreshAddBtn();
    plusApptRefreshShortcuts();
    plusApptClearRowHighlights(document);
    plusApptHighlightRows(slot, null, doctorCode || plusApptEffectiveDoctorCode());
    if (!skipSave) plusApptSaveUiState();
}

function plusApptSelectApptRow(appt, skipSave) {
    var dr = appt.doctor_code || plusApptEffectiveDoctorCode();
    if (plusApptIsAllDoctorsMode() && dr) plusApptAllActiveDoctorCode = dr;
    plusApptSelectedAppt = appt;
    plusApptSelectedSlot = plusApptNormTime(appt.start_time);
    plusApptRefreshAddBtn();
    plusApptRefreshShortcuts();
    plusApptClearRowHighlights(document);
    plusApptHighlightRows(null, appt.id, dr);
    if (!skipSave) plusApptSaveUiState();
}

function plusApptApptsByStart(appts) {
    var map = {};
    (appts || []).forEach(function(a) {
        var key = plusApptNormTime(a.start_time);
        if (!key) return;
        if (!map[key]) map[key] = [];
        map[key].push(a);
    });
    return map;
}

function plusApptFilterAppts(rows, doctorCode) {
    var list = rows || [];
    var dr = doctorCode != null ? doctorCode : plusApptActiveDoctorCode;
    if (dr && dr !== PLUSAPPT_DOCTOR_ALL) {
        list = list.filter(function(a) {
            return plusApptApptMatchesDoctor(a, dr);
        });
    }
    if (plusApptPatientFilterQ) {
        var q = plusApptPatientFilterQ.toLowerCase();
        list = list.filter(function(a) {
            var nm = (a.patient_name || '') + ' ' + (a.patient_chinese_name || '');
            var no = a.patient_no || '';
            return nm.toLowerCase().indexOf(q) >= 0 || no.toLowerCase().indexOf(q) >= 0;
        });
    }
    return list;
}

function fillPlusApptScheduleTbody(tb, doctorCode) {
    if (!tb) return;
    var slots = plusApptSlotList();
    var byStart = plusApptApptsByStart(plusApptFilterAppts(plusApptDayAppts, doctorCode));
    var selSlot = plusApptSelectedSlot;
    var selId = plusApptSelectedAppt ? plusApptSelectedAppt.id : null;
    var colDr = doctorCode || plusApptEffectiveDoctorCode();
    var highlightDr = plusApptIsAllDoctorsMode() ? colDr : '';
    tb.innerHTML = '';

    slots.forEach(function(slot) {
        var appts = byStart[slot] || [];
        var a = appts.length ? appts[0] : null;
        var row = document.createElement('tr');
        row.className = 'plusappt-slot-row' + (a ? ' plusappt-row-booked' : '');
        row.dataset.slotTime = slot;
        if (colDr) row.dataset.doctorCode = colDr;
        if (a) {
            row.dataset.apptId = a.id;
            var drCol = plusApptDoctorColor(a.doctor_code || colDr);
            row.style.borderLeft = '4px solid ' + drCol;
        } else {
            row.style.borderLeft = '';
        }

        var timeHtml = plusApptTimeCellHtml(slot);
        var nameHtml = '—';
        var remHtml = '—';
        var durHtml = '—';
        if (a) {
            nameHtml = typeof apptPatientDisplayNameHTML === 'function'
                ? apptPatientDisplayNameHTML(a, { walkIn: true })
                : esc(a.patient_name || '—');
            remHtml = typeof formatRemarksForDisplay === 'function'
                ? formatRemarksForDisplay(a.remarks, { empty: '—' })
                : esc(a.remarks || '—');
            durHtml = a.duration
                ? esc(trRepl('appt.modal.durMin', { N: a.duration }))
                : '—';
            if (appts.length > 1) {
                nameHtml += ' <span style="font-size:11px;color:#64748b;">(' +
                    esc(trRepl('appt.plusAppt.moreAtSlot', { N: String(appts.length) })) +
                    ')</span>';
            }
        }

        var timeShow = a
            ? '<strong>' + fmt12(a.start_time) + '</strong> – ' + fmt12(a.end_time)
            : timeHtml;

        row.innerHTML =
            '<td class="plusappt-time-cell">' + timeShow + '</td>' +
            '<td>' + nameHtml + '</td>' +
            '<td style="font-size:12px;color:#64748b;">' + remHtml + '</td>' +
            '<td style="text-align:center;">' + durHtml + '</td>';

        if (plusApptIsAllDoctorsMode()) {
            if (colDr === plusApptAllActiveDoctorCode &&
                ((a && selId === a.id) || (!a && selSlot === slot))) {
                row.classList.add('plusappt-row-selected');
            }
        } else if ((a && selId === a.id) || (!a && selSlot === slot)) {
            row.classList.add('plusappt-row-selected');
        }

        row.addEventListener('click', function() {
            if (a) plusApptSelectApptRow(a);
            else plusApptSelectEmptySlot(slot, false, colDr);
        });
        row.addEventListener('dblclick', function(e) {
            e.preventDefault();
            if (a) openApptEditModal(a);
        });

        tb.appendChild(row);
    });

    if (!slots.length) {
        tb.innerHTML =
            '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:24px;">' +
            esc(tr('appt.plusAppt.noSlots')) + '</td></tr>';
    }
}

function renderPlusApptAllDoctorsBoard() {
    var scroll = g('plusApptAllScroll');
    if (!scroll) return;
    scroll.innerHTML = '';
    var doctors = plusApptDoctorsForActiveClinic();
    if (!doctors.length) {
        scroll.innerHTML =
            '<p style="padding:24px;color:#94a3b8;text-align:center;">' +
            esc(tr('appt.modal.noDoctorsForClinic')) + '</p>';
        return;
    }

    doctors.forEach(function(doc) {
        var code = String(doc.doctor_code || '').trim();
        var col = document.createElement('div');
        col.className = 'plusappt-dr-col';
        col.dataset.doctorCode = code;

        var colHead = document.createElement('div');
        colHead.className = 'plusappt-dr-col-head';
        var drCol = plusApptDoctorColor(code);
        var drName = typeof doctorDisplayName === 'function'
            ? doctorDisplayName(doc)
            : (doc.english_name || doc.chinese_name || code);
        colHead.innerHTML =
            '<span class="plusappt-dr-dot" style="background:' + esc(drCol) + ';"></span>' +
            '<span class="plusappt-dr-col-name">' + esc(drName) + '</span>' +
            '<span class="plusappt-dr-col-code">[' + esc(code) + ']</span>';
        col.appendChild(colHead);

        var wrap = document.createElement('div');
        wrap.className = 'tbl-wrap plusappt-schedule-wrap plusappt-schedule-wrap--col';

        var tbl = document.createElement('table');
        tbl.className = 'appt-tbl plusappt-schedule-tbl';
        tbl.innerHTML =
            '<thead><tr>' +
            '<th class="plusappt-th-time">' + esc(tr('appt.modal.startTime')) + '</th>' +
            '<th>' + esc(tr('appt.plusAppt.th.name')) + '</th>' +
            '<th>' + esc(tr('appt.modal.remarks')) + '</th>' +
            '<th>' + esc(tr('appt.modal.duration')) + '</th>' +
            '</tr></thead>';
        var tbody = document.createElement('tbody');
        tbl.appendChild(tbody);
        wrap.appendChild(tbl);
        col.appendChild(wrap);
        scroll.appendChild(col);

        fillPlusApptScheduleTbody(tbody, code);
    });
}

function renderPlusApptSchedule() {
    plusApptToggleScheduleViews();
    if (plusApptIsAllDoctorsMode()) {
        renderPlusApptAllDoctorsBoard();
        return;
    }
    var tb = g('plusApptScheduleBody');
    if (!tb) return;
    fillPlusApptScheduleTbody(tb, plusApptActiveDoctorCode);
}

function renderPlusApptMiniCal() {
    var host = g('plusApptMiniCal');
    if (!host) return;
    var y = plusApptMiniCalMonth.getFullYear();
    var mo = plusApptMiniCalMonth.getMonth();
    var first = new Date(y, mo, 1);
    var startPad = first.getDay();
    var daysIn = new Date(y, mo + 1, 0).getDate();
    var loc = apptDateLocale();
    var monthLbl = new Date(y, mo, 1).toLocaleDateString(loc, { month: 'long', year: 'numeric' });
    var wd = apptCalWeekdayHeaders();
    var html = '<div class="plusappt-mc-head">' +
        '<button type="button" class="plusappt-mc-nav" data-act="prev">‹</button>' +
        '<span class="plusappt-mc-title">' + esc(monthLbl) + '</span>' +
        '<button type="button" class="plusappt-mc-nav" data-act="next">›</button>' +
        '</div><div class="plusappt-mc-wd">';
    wd.forEach(function(d) {
        html += '<span>' + esc(d) + '</span>';
    });
    html += '</div><div class="plusappt-mc-grid">';
    var i;
    var cell = 0;
    for (i = 0; i < startPad; i++) {
        html += '<span class="plusappt-mc-pad"></span>';
        cell++;
    }
    for (var day = 1; day <= daysIn; day++) {
        var iso = y + '-' + pad(mo + 1) + '-' + pad(day);
        var sel = iso === plusApptDate;
        var today = iso === todayISO();
        var cs = 'plusappt-mc-day';
        if (sel) cs += ' plusappt-mc-day--sel';
        if (today) cs += ' plusappt-mc-day--today';
        html += '<button type="button" class="' + cs + '" data-iso="' + iso + '">' + day + '</button>';
        cell++;
    }
    html += '</div>' +
        '<button type="button" class="plusappt-mc-today" data-act="today">' +
        esc(tr('appt.calToday')) + '</button>';
    host.innerHTML = html;

    host.querySelectorAll('[data-iso]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            plusApptSetDate(btn.getAttribute('data-iso'));
        });
    });
    host.querySelectorAll('[data-act]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var act = btn.getAttribute('data-act');
            if (act === 'prev') {
                plusApptMiniCalMonth = new Date(y, mo - 1, 1);
                renderPlusApptMiniCal();
            } else if (act === 'next') {
                plusApptMiniCalMonth = new Date(y, mo + 1, 1);
                renderPlusApptMiniCal();
            } else if (act === 'today') {
                plusApptSetDate(todayISO());
            }
        });
    });
}

function plusApptSetDate(iso) {
    plusApptSaveUiState();
    syncApptPlannerDate(iso, { syncCal: true });
    plusApptClearSelection(true);
    renderPlusApptMiniCal();
    refreshApptPlannerData();
}

function loadPlusApptDay() {
    if (!plusApptDate) plusApptDate = todayISO();
    plusApptSyncDateLabel();
    var tb = g('plusApptScheduleBody');
    var scroll = g('plusApptAllScroll');
    var allMode = typeof plusApptIsAllDoctorsMode === 'function' && plusApptIsAllDoctorsMode();
    if (!tb && !(allMode && scroll)) return;
    var loadingHtml =
        '<tr><td colspan="4" style="text-align:center;color:#aaa;padding:24px;">' +
        esc(tr('common.loadingEllipsis')) + '</td></tr>';
    if (allMode && scroll) {
        scroll.innerHTML =
            '<p style="text-align:center;color:#aaa;padding:24px;">' +
            esc(tr('common.loadingEllipsis')) + '</p>';
    } else if (tb) {
        tb.innerHTML = loadingHtml;
    }

    var q = SB.from('appointments').select('*')
        .eq('date', plusApptDate)
        .order('start_time', { ascending: true });
    q = applyApptModuleClinicQuery(q);
    q.then(function(r) {
        if (r.error) {
            plusApptDayAppts = [];
            var errHtml =
                '<tr><td colspan="4" style="text-align:center;color:#c00;padding:24px;">' +
                esc(trRepl('appt.msg.error', { MSG: r.error.message })) + '</td></tr>';
            if (allMode && scroll) {
                scroll.innerHTML =
                    '<p style="text-align:center;color:#c00;padding:24px;">' +
                    esc(trRepl('appt.msg.error', { MSG: r.error.message })) + '</p>';
            } else if (tb) {
                tb.innerHTML = errHtml;
            }
            return;
        }
        var finish = function(rows) {
            plusApptDayAppts = rows || [];
            renderPlusApptSchedule();
            plusApptRestoreDoctorSelection();
        };
        if (!r.data || !r.data.length) {
            finish([]);
            return;
        }
        if (typeof augmentAppointmentsChineseFromPatients === 'function') {
            augmentAppointmentsChineseFromPatients(r.data, finish);
        } else {
            finish(r.data);
        }
    });
}

function plusApptPrefillModalPatient() {
    if (!plusApptHeaderPatient) return;
    var p = plusApptHeaderPatient;
    if (g('hPid')) g('hPid').value = p.id || '';
    if (g('hPno')) g('hPno').value = p.patient_no || '';
    if (g('hPname')) g('hPname').value = p.full_name || '';
    var hpc = g('hPchinese');
    if (hpc) hpc.value = p.chinese_name || '';
    if (g('psInput')) {
        g('psInput').value =
            (p.chinese_name ? p.chinese_name + ' ' : '') +
            (p.full_name || '') + ' (#' + (p.patient_no || '') + ')';
    }
    if (g('psSelName')) g('psSelName').textContent = p.full_name || '-';
    if (g('psSelNo')) g('psSelNo').textContent = p.patient_no || '-';
    if (g('psSelected')) g('psSelected').style.display = 'block';
    if (typeof switchApptPatientMode === 'function') switchApptPatientMode('exist');
}

function openPlusApptCreateModal() {
    if (!plusApptDate || !plusApptSelectedSlot || plusApptSelectedAppt) return;
    var drCode = plusApptEffectiveDoctorCode();
    if (!drCode) {
        alert(tr('appt.plusAppt.pickDoctorFirst'));
        return;
    }
    openApptWithDatetime(plusApptDate, plusApptSelectedSlot);
    setTimeout(function() {
        plusApptPrefillModalPatient();
        if (typeof loadApptDoctors === 'function') {
            loadApptDoctors(drCode);
        } else {
            var dr = g('fApptDoctor');
            if (dr) dr.value = drCode;
            if (typeof renderApptDoctorColorPreview === 'function') {
                renderApptDoctorColorPreview();
            }
        }
    }, 80);
}

function doPlusApptPatientSearch() {
    var inp = g('plusApptPsInput');
    var dd = g('plusApptPsDrop');
    if (!inp || !dd) return;
    var q = (inp.value || '').trim();
    plusApptPatientFilterQ = q;
    if (!q) {
        plusApptHeaderPatient = null;
        dd.style.display = 'none';
        renderPlusApptSchedule();
        return;
    }

    var pq = SB.from('patients')
        .select('id,patient_no,full_name,chinese_name,phone_number')
        .or(
            'full_name.ilike.%' + q + '%,' +
            'patient_no.ilike.%' + q + '%,' +
            'chinese_name.ilike.%' + q + '%'
        )
        .limit(8);
    var tag = typeof currentClinicCodeForTagging === 'function'
        ? currentClinicCodeForTagging()
        : '';
    if (tag && typeof PATIENT_CLINIC_TAG_FIELD !== 'undefined') {
        pq = pq.eq(PATIENT_CLINIC_TAG_FIELD, tag);
    }
    pq.then(function(r) {
        dd.innerHTML = '';
        if (r.error || !r.data || !r.data.length) {
            dd.innerHTML =
                '<div class="ps-item" style="color:#aaa;">' +
                esc(tr('common.psNoPatients')) + '</div>';
            dd.style.display = 'block';
            renderPlusApptSchedule();
            return;
        }
        r.data.forEach(function(p) {
            var item = document.createElement('div');
            item.className = 'ps-item';
            item.innerHTML =
                (p.chinese_name
                    ? '<span style="font-family:\'PingFang HK\',\'Microsoft JhengHei\',sans-serif;font-weight:700;">' +
                      esc(p.chinese_name) + '</span> '
                    : '') +
                '<strong>' + esc(p.full_name) + '</strong>' +
                '<br><small style="color:#aaa;">#' + esc(p.patient_no || '-') + '</small>';
            item.addEventListener('click', function() {
                plusApptHeaderPatient = p;
                inp.value =
                    (p.chinese_name ? p.chinese_name + ' ' : '') +
                    p.full_name + ' (#' + (p.patient_no || '') + ')';
                plusApptPatientFilterQ = inp.value.trim();
                dd.style.display = 'none';
                renderPlusApptSchedule();
            });
            dd.appendChild(item);
        });
        dd.style.display = 'block';
        renderPlusApptSchedule();
    });
}

function plusApptOpenHistory() {
    var a = plusApptSelectedAppt;
    if (!a) return;
    var term = (a.patient_no || a.patient_name || '').trim();
    switchApptTab('records');
    setTimeout(function() {
        var inp = g('arSearchInput');
        if (inp) {
            inp.value = term;
            arSearchTerm = term;
            if (typeof loadApptRecords === 'function') loadApptRecords();
        }
    }, 120);
}

function bindPlusApptTabOnce() {
    if (plusApptTabBound) return;
    plusApptTabBound = true;

    var addBtn = g('plusApptAddBtn');
    if (addBtn) {
        addBtn.addEventListener('click', function() {
            openPlusApptCreateModal();
        });
    }

    var psIn = g('plusApptPsInput');
    if (psIn) {
        psIn.addEventListener('input', function() {
            clearTimeout(plusApptPsTimer);
            plusApptPsTimer = setTimeout(doPlusApptPatientSearch, 280);
        });
        psIn.addEventListener('blur', function() {
            setTimeout(function() {
                var dd = g('plusApptPsDrop');
                if (dd) dd.style.display = 'none';
            }, 200);
        });
    }

    var clinicSel = g('plusApptClinicSelect');
    if (clinicSel) {
        clinicSel.addEventListener('change', onPlusApptClinicChange);
    }
    var doctorSel = g('plusApptDoctorSelect');
    if (doctorSel) {
        doctorSel.addEventListener('change', onPlusApptDoctorChange);
    }

    var scMap = {
        plusApptScEditPatient: function() {
            var a = plusApptSelectedAppt;
            if (!a || !a.patient_id) {
                alert(tr('appt.queue.noPatientLinked'));
                return;
            }
            if (typeof openEditPatient === 'function') openEditPatient(a.patient_id);
        },
        plusApptScNotes: function() {
            var a = plusApptSelectedAppt;
            if (!a || !a.patient_id) {
                alert(tr('appt.queue.noPatientLinked'));
                return;
            }
            if (typeof openConForPatient === 'function') openConForPatient(a.patient_id);
        },
        plusApptScDrugs: function() {
            var a = plusApptSelectedAppt;
            if (!a || !a.patient_id) {
                alert(tr('appt.queue.noPatientLinked'));
                return;
            }
            if (typeof openConForPatient === 'function') {
                openConForPatient(a.patient_id);
                setTimeout(function() {
                    if (typeof switchConTab === 'function') switchConTab('treatment');
                }, 200);
            }
        },
        plusApptScBill: function() {
            var a = plusApptSelectedAppt;
            if (!a) return;
            if (typeof openBillPanel === 'function') openBillPanel(a);
        },
        plusApptScHistory: plusApptOpenHistory,
        plusApptScRemarks: function() {
            var a = plusApptSelectedAppt;
            if (!a) return;
            if (typeof openQueueRemarksEditor === 'function') openQueueRemarksEditor(a);
        },
        plusApptScEditAppt: function() {
            var a = plusApptSelectedAppt;
            if (!a) return;
            openApptEditModal(a);
        }
    };
    Object.keys(scMap).forEach(function(id) {
        var btn = g(id);
        if (btn) btn.addEventListener('click', scMap[id]);
    });
}

function showPlusApptTab() {
    bindPlusApptTabOnce();
    populatePlusApptClinicSelect();
    var apptSel = g('apptClinicSelect');
    var plusClinic = g('plusApptClinicSelect');
    if (apptSel && apptSel.value && plusClinic && plusClinic.value !== apptSel.value) {
        plusApptClinicSyncing = true;
        plusClinic.value = apptSel.value;
        plusApptActiveClinicId = apptSel.value;
        plusApptClinicSyncing = false;
        if (typeof setWorkingClinic === 'function') {
            setWorkingClinic(apptSel.value, { syncFilters: true, reloadAppt: false });
        }
    }
    plusApptRestoreClinicUiState(plusApptActiveClinicId);
    if (!plusApptDate && calDate) {
        syncApptPlannerDate(
            calDate.getFullYear() + '-' + pad(calDate.getMonth() + 1) + '-' + pad(calDate.getDate()),
            { syncCal: false }
        );
    } else if (plusApptDate) {
        syncApptPlannerDate(plusApptDate, { syncCal: true });
    }
    populatePlusApptDoctorSelect();
    plusApptApplyClinicTheme();
    plusApptToggleScheduleViews();
    renderPlusApptMiniCal();
    refreshApptPlannerData();
    if (typeof applyI18nInRoot === 'function') {
        var tab = g('tab-plusappt');
        if (tab) applyI18nInRoot(tab);
    }
}

function showCalendarTab() {
    if (plusApptDate) {
        syncApptPlannerDate(plusApptDate, { syncCal: true });
    } else if (calDate) {
        syncApptPlannerDate(
            calDate.getFullYear() + '-' + pad(calDate.getMonth() + 1) + '-' + pad(calDate.getDate()),
            { syncCal: true }
        );
    } else {
        syncApptPlannerDate(todayISO(), { syncCal: true });
    }
    refreshApptPlannerData();
}

function initPlusApptTab() {
    showPlusApptTab();
}

// ════════════════════════════════════════════════════════════════
// AUTO REFRESH — disabled (periodic reload disturbed data entry).
// Manual refresh buttons and tab-switch loads still apply.
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
    else if (tab === 'plusappt' || tab === 'calendar') refreshApptPlannerData();
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

/** No-op: auto-refresh disabled. Clears any legacy timer if present. */
function restartApptAutoRefresh() {
    stopApptAutoRefresh();
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
        esc(tr('common.loadingEllipsis')) + '</td></tr>';

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
        mergeScheduleLockedLocal(arAllData);
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

    if (countEl) {
        countEl.textContent = rows.length === 1
            ? tr('appt.ar.recordCountOne')
            : trRepl('appt.ar.recordCountN', { N: String(rows.length) });
    }

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
        html += arSectionHeader(trRepl('appt.ar.sectionUpcoming', { N: String(future.length) }), '#e8f4ff', '#0084ff');
        future.forEach(function(a) { html += arRow(a, today); });
        html += arSectionHeader(trRepl('appt.ar.sectionPast', { N: String(older.length) }), '#f8fafc', '#64748b');
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
          'padding:1px 4px;border-radius:3px;margin-left:3px;vertical-align:middle;">' +
          esc(tr('appt.badge.newWalkin')) + '</span>'
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
               formatRemarksForDisplay(a.remarks) + '</td>' +
           '<td style="text-align:center;">' +
               '<button onclick="event.stopPropagation(); arOpenEdit(\'' + a.id + '\')" ' +
               'style="padding:3px 8px;font-size:11px;border:1px solid #cbd5e1;' +
               'border-radius:5px;background:#fff;cursor:pointer;color:#374151;" ' +
               'title="' + esc(tr('appt.ar.editTitle')) + '">✏️</button>' +
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
    var label = (typeof dispApptStatus === 'function')
        ? dispApptStatus(s)
        : (typeof tr === 'function' ? tr('status.scheduled') : s);
    return '<span style="background:' + bg + ';color:' + color + ';font-size:11px;' +
           'font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;">' +
           esc(label) + '</span>';
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
    apptEditLockRef = null;
    setApptScheduleLockFormUI(false);
    resetApptBookingGuards();
    arBookingMinDateToday = true;

    var db = g('deleteApptBtn');
    if (db) db.style.display = 'none';

    g('apptModalTitle').textContent = tr('appt.modal.newApptSame');

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
    clearApptRemarksEditor('fRemarksEditor');
    sv('npName',   '');
    sv('npPhone',  '');

    if (!appt.patient_id) {
        sv('npName', appt.patient_name || '');
        sv('npPhone', extractPhoneFromRemarks(appt.remarks));
        switchApptPatientMode('new');
    } else {
        switchApptPatientMode('exist');
    }

    buildTimeSlots();
    loadApptDoctors(appt.doctor_code || appt.doctor_name || '');
    sv('fStart', '09:00');
    sv('fDur',   '30');
    calcEnd();
    refreshApptModalI18n();
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
    var loc   = apptDateLocale();
    var mLbl  = new Date(y, m, 1).toLocaleDateString(loc, { month: 'long', year: 'numeric' });
    var dowHdr = apptCalWeekdayHeaders();

    var html =
        '<div class="rcal-header">' +
            '<button class="rcal-nav" onclick="rcalPrev()"' +
            ' aria-label="' + esc(tr('appt.rcal.prevAria')) + '">&#8249;</button>' +
            '<span class="rcal-title">' + mLbl + '</span>' +
            '<button class="rcal-nav" onclick="rcalNext()"' +
            ' aria-label="' + esc(tr('appt.rcal.nextAria')) + '">&#8250;</button>' +
        '</div>' +
        '<table class="rcal-table"><thead><tr>';
    dowHdr.forEach(function(d) {
        html += '<th>' + esc(d) + '</th>';
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
            : tr('appt.recallSelectDate');
    }
    if (cntEl) cntEl.textContent = '';
    tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:24px;">' +
        esc(tr('common.loadingEllipsis')) + '</td></tr>';

    if (!date) {
        var pls = tr('appt.recallPleaseSelectRow');
        tbody.innerHTML =
            '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:24px;">' + esc(pls) + '</td></tr>';
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
        ? (rcPatients.length === 1
            ? tr('appt.recall.patientCountOne')
            : trRepl('appt.recall.patientCountN', { N: rcPatients.length }))
        : '';

    if (!rcPatients.length) {
        tbody.innerHTML =
            '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:30px;">' +
            esc(tr('appt.recall.noApptsOnDate')) + '</td></tr>';
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
            : '<span style="color:#f87171;font-size:11px;">' + esc(tr('appt.recall.noPhone')) + '</span>';
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
    if (!txt) { alert(tr('appt.recall.alertEnterMsg')); return; }
    var name = prompt(tr('appt.recall.promptTmplName'));
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
        'letter-spacing:.4px;">' + esc(tr('appt.recall.tmplSavedHeader')) + '</div>';
    rcTemplates.forEach(function(t) {
        html +=
            '<div class="rc-tmpl-item">' +
            '<span class="rc-tmpl-name" onclick="applyRcTemplate(' + t.id + ')">' +
                esc(t.name) +
            '</span>' +
            '<button class="rc-tmpl-del" title="' + esc(tr('appt.recall.deleteTmplTitle')) + '" ' +
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
    if (!confirm(tr('appt.recall.confirmDeleteTmpl'))) return;
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
    if (!msg) { alert(tr('appt.recall.alertEnterRecallMsg')); return; }

    var selected = rcPatients.filter(function(a) { return rcSelIds[a.id]; });
    if (!selected.length) { alert(tr('appt.recall.alertSelectPatients')); return; }

    var noPhone = selected.filter(function(a) { return !a.phone; });
    if (noPhone.length) {
        var names = noPhone.map(function(a) {
            return a.patient_chinese_name || a.patient_name || tr('appt.recall.unknownPatient');
        }).join(', ');
        var ok = confirm(trRepl('appt.recall.confirmSkipNoPhone', {
            N: noPhone.length,
            NAMES: names
        }));
        if (!ok) return;
    }

    rcSendQueue = selected.filter(function(a) { return a.phone; });
    if (!rcSendQueue.length) {
        alert(tr('appt.recall.alertNoValidPhone'));
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
        alert(trRepl('appt.recall.alertAllProcessed', { N: rcSendQueue.length }));
        rcSendQueue = []; rcSendIdx = 0;
        return;
    }

    var a = rcSendQueue[rcSendIdx];

    var personalised = buildRecallPersonalised(a);

    var isWA = rcContact === 'whatsapp';
    var actionLabel = isWA ? tr('appt.recall.openWaWeb') : tr('appt.recall.openSms');
    var actionColor = isWA ? '#25d366' : '#0084ff';

    var progress = trRepl('appt.recall.sendProgress', {
        CUR: rcSendIdx + 1,
        TOTAL: rcSendQueue.length
    });
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
                esc(progress) + '</span>' +
            '<span style="font-size:12px;font-weight:700;color:#64748b;">' +
                (isWA ? tr('appt.recallWa') : tr('appt.recallSms')) +
            '</span>' +
        '</div>' +
        (isWA
            ? '<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;' +
                'padding:8px 10px;margin-bottom:10px;font-size:11px;line-height:1.45;color:#065f46;">' +
                t('appt.recall.waWebHintHtml') +
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
                esc(tr('appt.recall.copyWaLink')) + '</button>'
            : '') +
        // Action + Skip
        '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
            '<button type="button" onclick="rcOpenRecallSend()" ' +
                'style="flex:1;padding:11px 8px;background:' + actionColor + ';color:#fff;' +
                'border:none;border-radius:8px;text-align:center;font-weight:700;' +
                'font-size:13px;cursor:pointer;">' +
                esc(actionLabel) + '</button>' +
            '<button onclick="rcSendSkip()" ' +
                'style="padding:11px 14px;background:#f1f5f9;color:#64748b;border:none;' +
                'border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;">' +
                esc(tr('appt.recall.skip')) + '</button>' +
        '</div>' +
        // Next / Done
        (isLast
            ? '<button onclick="rcSendDone()" ' +
              'style="width:100%;padding:11px;background:#10b981;color:#fff;border:none;' +
              'border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;">' +
              esc(tr('appt.recall.doneAllSent')) + '</button>'
            : '<button onclick="rcSendNext()" ' +
              'style="width:100%;padding:11px;background:#475569;color:#fff;border:none;' +
              'border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">' +
              esc(trRepl('appt.recall.nextPatient', {
                  CUR: rcSendIdx + 2,
                  TOTAL: rcSendQueue.length
              })) + '</button>'
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
        alert(tr('appt.recall.cannotOpenWa'));
        return;
    }

    var url = buildRecallWhatsAppOpenUrl(a, personalised);
    if (!url) {
        alert(tr('appt.recall.cannotBuildWaLink'));
        return;
    }

    var w = window.open(url, '_blank', 'noopener,noreferrer');
    var blocked = !w || w.closed || typeof w.closed === 'undefined';
    if (!blocked) return;

    function fallbackPrompt(u) {
        if (typeof prompt === 'function') {
            prompt(tr('appt.recall.popupBlockedPrompt'), u);
        } else {
            alert(trRepl('appt.recall.popupBlockedAlert', { URL: u }));
        }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
            alert(tr('appt.recall.popupBlockedCopied'));
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
        alert(tr('appt.recall.noValidMobile'));
        return;
    }
    var url =
        'https://web.whatsapp.com/send?phone=' +
        encodeURIComponent(digits) +
        '&text=' +
        encodeURIComponent(recallTruncateForWaPrefill(personalised, 1500));

    function fallbackPrompt(u) {
        if (typeof prompt === 'function') prompt(tr('appt.recall.copyWaLinkPrompt'), u);
        else alert(u);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
            alert(tr('appt.recall.copyWaLinkOk'));
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
function dispStatusLabel(raw) {
    if (typeof dispApptStatus === 'function') return dispApptStatus(raw);
    return (typeof tr === 'function') ? tr('status.scheduled') : (raw || 'Scheduled');
}

function refreshApptHeaderI18n() {
    var un = g('apptUserName');
    var ur = g('apptUserRole');
    if (un) un.textContent = currentName || '-';
    if (ur) {
        ur.textContent = (typeof dispRole === 'function')
            ? dispRole(currentRole)
            : (currentRole || '-');
    }
    if (typeof syncApptTodayDateLabels === 'function') syncApptTodayDateLabels();
}

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
                esc(tr('common.psNoPatients')) + '</div>';
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
// APPOINTMENT REMARKS — strip internal tags before show/save
// ════════════════════════════════════════════════════════════════
function remarksStringHasHtml(s) {
    return /<[a-z][\s\S]*>/i.test(String(s || ''));
}

function stripDoctorTagsFromRemarks(remarks) {
    var r = String(remarks || '');
    r = r.replace(/\|@dr:[^|]*\|/gi, ' ');
    r = r.replace(/@dr:[^|]+/gi, ' ');
    r = r.replace(/\s*\|\s*/g, ' | ');
    r = r.replace(/^\s*\|\s*|\s*\|\s*$/g, '');
    if (remarksStringHasHtml(r)) return r.trim();
    return r.replace(/\s+/g, ' ').trim();
}

function extractPhoneFromRemarks(remarks) {
    var m = String(remarks || '').match(/(?:^|\|)\s*Ph:\s*([^|]+)/i);
    return m ? m[1].trim() : '';
}

function stripPhoneFromRemarks(remarks) {
    var r = String(remarks || '')
        .replace(/(?:^|\|)\s*Ph:\s*[^|]+/gi, '')
        .replace(/\s*\|\s*\|/g, ' | ')
        .replace(/^\s*\|\s*|\s*\|\s*$/g, '');
    if (remarksStringHasHtml(r)) return r.trim();
    return r.replace(/\s+/g, ' ').trim();
}

function remarksForApptForm(remarks) {
    return stripStaffAuthorFromRemarks(
        stripPhoneFromRemarks(stripDoctorTagsFromRemarks(remarks))
    ).trim();
}

/** Logged-in user is doctor/dentist — no staff author tag on remarks. */
function getNonDoctorRemarksAuthor() {
    if (typeof getActiveDoctorContext === 'function') {
        var ctx = getActiveDoctorContext();
        if (ctx && ctx.shouldTag) return null;
    } else {
        var role = String(typeof currentRole !== 'undefined' ? currentRole : '').toLowerCase();
        if (role === 'doctor' || role === 'dentist') return null;
    }
    var uid = typeof currentUserId !== 'undefined' ? String(currentUserId || '').trim() : '';
    var name = typeof currentName !== 'undefined' ? String(currentName || '').trim() : '';
    if (!uid && !name) return null;
    return {
        uid: uid || name,
        name: name || uid,
        role: typeof currentRole !== 'undefined' ? (currentRole || 'staff') : 'staff'
    };
}

function staffAuthorRemarksHtml(author) {
    if (!author) return '';
    var uid = esc(String(author.uid || '').trim());
    var roleRaw = String(author.role || 'staff').trim().toLowerCase();
    var nameRaw = String(author.name || author.uid || tr('common.staffFallback')).trim();
    nameRaw = stripRolePrefixFromStaffName(nameRaw, roleRaw);
    var name = esc(nameRaw);
    var role = esc(roleRaw);
    var inner = role && role !== name ? role + ' · ' + name : name;
    return '<span class="appt-rm-by" data-uid="' + uid + '" data-role="' + role + '">' + inner + '</span>';
}

function stripRolePrefixFromStaffName(name, role) {
    var n = String(name || '').trim();
    var r = String(role || '').trim().toLowerCase();
    if (!n || !r) return n;
    var escRole = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var rx = new RegExp('^\\s*' + escRole + '\\s*(?:[·\\-:：]\\s*)+', 'i');
    return n.replace(rx, '').trim() || n;
}

function extractStaffAuthorSpan(remarks) {
    var m = String(remarks || '').match(/<span class="appt-rm-by"[^>]*>[\s\S]*?<\/span>/i);
    return m ? m[0] : '';
}

function stripStaffAuthorFromRemarks(remarks) {
    var r = String(remarks || '')
        .replace(/\s*\|\s*<span class="appt-rm-by"[^>]*>[\s\S]*?<\/span>/gi, '')
        .replace(/<span class="appt-rm-by"[^>]*>[\s\S]*?<\/span>/gi, '');
    if (remarksStringHasHtml(r)) return r.trim();
    return r.replace(/\s+/g, ' ').trim();
}

function sanitizeStaffAuthorSpan(html) {
    var s = String(html || '');
    var uidM = s.match(/\bdata-uid="([^"]*)"/i);
    var roleM = s.match(/\bdata-role="([^"]*)"/i);
    var bodyM = s.match(/<span class="appt-rm-by"[^>]*>([\s\S]*?)<\/span>/i);
    if (!bodyM) return '';
    var body = bodyM[1].replace(/<[^>]+>/g, '').trim();
    var role = roleM ? roleM[1] : 'staff';
    var cleanName = stripRolePrefixFromStaffName(body, role);
    return staffAuthorRemarksHtml({
        uid: uidM ? uidM[1] : '',
        role: role,
        name: cleanName || (uidM ? uidM[1] : tr('common.staffFallback'))
    });
}

/** Append or refresh staff author HTML when a non-doctor saves remarks. */
function mergeStaffAuthorOnSave(cleanRemarks, priorRawRemarks) {
    var rem = String(cleanRemarks || '').trim();
    var author = getNonDoctorRemarksAuthor();
    if (author) {
        var tag = staffAuthorRemarksHtml(author);
        return rem ? rem + ' | ' + tag : tag;
    }
    var priorTag = extractStaffAuthorSpan(priorRawRemarks);
    if (priorTag) rem = rem ? rem + ' | ' + sanitizeStaffAuthorSpan(priorTag) : sanitizeStaffAuthorSpan(priorTag);
    return rem || null;
}

function formatRemarksForDisplay(remarks, opts) {
    opts = opts || {};
    if (!remarks || !String(remarks).trim()) return opts.empty != null ? opts.empty : '';
    var tag = extractStaffAuthorSpan(remarks);
    var text = stripStaffAuthorFromRemarks(remarks);
    if (opts.stripDr) text = stripDoctorTagsFromRemarks(text);
    var trimmed = text.trim();
    var out = remarksStringHasHtml(trimmed)
        ? sanitizeRemarksHtml(trimmed)
        : esc(trimmed);
    if (tag) out += (out ? ' ' : '') + sanitizeStaffAuthorSpan(tag);
    return out || (opts.empty != null ? opts.empty : '');
}

// ════════════════════════════════════════════════════════════════
// APPOINTMENT REMARKS — rich editor (size / font / color)
// ════════════════════════════════════════════════════════════════
var APPT_REMARKS_RICH_SIZES = [
    { v: '12px', k: '12' },
    { v: '14px', k: '14' },
    { v: '16px', k: '16' },
    { v: '18px', k: '18' },
    { v: '20px', k: '20' },
    { v: '24px', k: '24' }
];
var APPT_REMARKS_RICH_FONTS = [
    { v: 'Arial, Helvetica, "Microsoft JhengHei", "PingFang TC", sans-serif', k: 'Arial / 正黑' },
    { v: '"Times New Roman", Times, "Songti TC", "SimSun", serif', k: 'Times New Roman' },
    { v: 'Georgia, "Times New Roman", "Songti TC", "SimSun", serif', k: 'Georgia / 宋体' },
    { v: '"Courier New", Consolas, "Microsoft JhengHei", monospace', k: 'Courier' },
    { v: '"Microsoft JhengHei", "PingFang TC", sans-serif', k: '微軟正黑體' },
    { v: 'SimSun, "Songti TC", "PMingLiU", serif', k: '新細明體' },
    { v: 'KaiTi, "STKaiti", "KaiTi SC", serif', k: '楷体' }
];
var APPT_REMARKS_RICH_COLORS = [
    '#334155', '#0f172a', '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#10b981', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#a855f7',
    '#ec4899', '#f43f5e', '#ffffff', '#000000'
];

function remarksRichTr(key) {
    return (typeof tr === 'function') ? tr(key) : key;
}

function sanitizeRemarksHtml(html) {
    var allowed = { span: 1, b: 1, strong: 1, i: 1, em: 1, u: 1, br: 1, font: 1, div: 1, p: 1 };
    var styleOk = {
        'font-size': 1, 'font-family': 1, color: 1,
        'font-weight': 1, 'font-style': 1, 'text-decoration': 1
    };
    var tmp = document.createElement('div');
    tmp.innerHTML = String(html || '');
    remarksRichSanitizeNode(tmp, allowed, styleOk);
    var out = tmp.innerHTML;
    out = out.replace(/<div><br><\/div>/gi, '<br>');
    out = out.replace(/<p><br><\/p>/gi, '<br>');
    return out.trim();
}

function remarksRichSanitizeNode(node, allowed, styleOk) {
    var kids = [];
    for (var i = 0; i < node.childNodes.length; i++) kids.push(node.childNodes[i]);
    kids.forEach(function(ch) {
        if (ch.nodeType === 1) {
            var tag = ch.tagName.toLowerCase();
            if (!allowed[tag]) {
                while (ch.firstChild) node.insertBefore(ch.firstChild, ch);
                node.removeChild(ch);
                return;
            }
            var attrs = [];
            for (var a = 0; a < ch.attributes.length; a++) attrs.push(ch.attributes[a]);
            if (ch.classList) {
                if (ch.classList.contains('ql-size-small')) ch.style.fontSize = '0.75em';
                if (ch.classList.contains('ql-size-large')) ch.style.fontSize = '1.5em';
                if (ch.classList.contains('ql-size-huge')) ch.style.fontSize = '2.5em';
                if (ch.classList.contains('ql-font-serif')) {
                    ch.style.fontFamily = 'Georgia, "Times New Roman", "Songti TC", serif';
                }
                if (ch.classList.contains('ql-font-monospace')) {
                    ch.style.fontFamily = '"Courier New", Consolas, monospace';
                }
            }
            attrs.forEach(function(attr) {
                var n = attr.name.toLowerCase();
                if (n.indexOf('on') === 0 || n === 'class' || n === 'id') {
                    ch.removeAttribute(attr.name);
                }
            });
            if (tag === 'font') {
                var fs = ch.getAttribute('size');
                var fc = ch.getAttribute('color');
                var ff = ch.getAttribute('face');
                var st = [];
                if (fc) st.push('color:' + fc);
                if (ff) st.push('font-family:' + ff);
                if (fs) st.push('font-size:' + fs + 'px');
                if (st.length) ch.setAttribute('style', st.join(';'));
                ch.removeAttribute('size');
                ch.removeAttribute('color');
                ch.removeAttribute('face');
            }
            var styleRaw = ch.getAttribute('style');
            if (styleRaw) {
                var clean = remarksRichCleanStyle(styleRaw, styleOk);
                if (clean) ch.setAttribute('style', clean);
                else ch.removeAttribute('style');
            }
            remarksRichSanitizeNode(ch, allowed, styleOk);
        }
    });
}

function remarksRichCleanStyle(raw, styleOk) {
    var parts = String(raw || '').split(';');
    var out = [];
    parts.forEach(function(p) {
        var kv = p.split(':');
        if (kv.length < 2) return;
        var prop = kv[0].trim().toLowerCase();
        var val = kv.slice(1).join(':').trim();
        if (!styleOk[prop] || !val) return;
        if (/javascript\s*:/i.test(val)) return;
        out.push(prop + ':' + val);
    });
    return out.join(';');
}

function remarksRichGetEditor(wrap) {
    if (!wrap) return null;
    var id = wrap.getAttribute('data-editor-id');
    return id ? g(id) : null;
}

/** Per-editor saved text selection (survives color-picker focus loss). */
var _remarksRichSelByEditor = {};

function remarksRichSaveSelection(editor) {
    if (!editor) return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    try {
        _remarksRichSelByEditor[editor.id] = range.cloneRange();
        _remarksRichSelByEditor[editor.id + '__nc'] = !range.collapsed;
    } catch (e) {}
}

/** Save before toolbar click; keep stored highlight if focus would collapse it. */
function remarksRichSaveSelectionForToolbar(editor) {
    if (!editor) return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    if (range.collapsed && remarksRichHadStoredRangeSelection(editor)) return;
    remarksRichSaveSelection(editor);
}

function remarksRichClearStoredRange(editor) {
    if (!editor) return;
    delete _remarksRichSelByEditor[editor.id + '__nc'];
}

function remarksRichHadStoredRangeSelection(editor) {
    return !!_remarksRichSelByEditor[editor.id + '__nc'];
}

function remarksRichIsMarkerOnlySpan(span) {
    if (!span) return false;
    var t = String(span.textContent || '').replace(/\u200b/g, '');
    return !t.trim();
}

function remarksRichCreateTypingSpan(styleObj) {
    var span = document.createElement('span');
    span.className = 'appt-rm-typing';
    if (styleObj.color) span.style.color = styleObj.color;
    if (styleObj.fontSize) span.style.fontSize = styleObj.fontSize;
    if (styleObj.fontFamily) span.style.fontFamily = styleObj.fontFamily;
    return span;
}

function remarksRichSetCaretInSpan(span) {
    if (!span) return;
    var sel = window.getSelection();
    if (!sel) return;
    var nr = document.createRange();
    nr.setStart(span, 0);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
}

function remarksRichFinalizeTypingSpan(span) {
    if (span && span.classList) span.classList.remove('appt-rm-typing');
}

function remarksRichSpanHasInlineStyle(span) {
    if (!span || span.tagName !== 'SPAN') return false;
    return !!(span.style.color || span.style.fontSize || span.style.fontFamily ||
        remarksRichGetInlineColorFromElement(span));
}

function remarksRichSpanMatchesStyle(span, styleObj) {
    if (!span || !styleObj) return false;
    if (styleObj.color) {
        var spanColor = remarksRichGetInlineColorFromElement(span) || span.style.color;
        if (remarksRichToHexColor(spanColor) !== remarksRichToHexColor(styleObj.color)) {
            return false;
        }
    }
    if (styleObj.fontFamily && span.style.fontFamily !== styleObj.fontFamily) return false;
    if (styleObj.fontSize && span.style.fontSize !== styleObj.fontSize) return false;
    return true;
}

/** Split a styled span at the caret and open a new sibling span (multi-color per line). */
function remarksRichSplitHostSpanAtCaret(editor, hostSpan, styleObj) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!range.collapsed || !editor.contains(range.commonAncestorContainer)) return null;
    if (!hostSpan || !hostSpan.parentNode) return null;

    remarksRichFinalizeTypingSpan(hostSpan);
    var parent = hostSpan.parentNode;
    var newSpan = remarksRichCreateTypingSpan(styleObj);
    var container = range.startContainer;
    var offset = range.startOffset;

    if (container.nodeType === 3 && hostSpan.contains(container)) {
        if (offset === 0) {
            parent.insertBefore(newSpan, hostSpan);
        } else if (offset >= container.length) {
            parent.insertBefore(newSpan, hostSpan.nextSibling);
        } else {
            var tail = container.splitText(offset);
            newSpan.appendChild(tail);
            parent.insertBefore(newSpan, hostSpan.nextSibling);
        }
    } else if (container.nodeType === 1 && hostSpan.contains(container)) {
        parent.insertBefore(newSpan, hostSpan.nextSibling);
    } else {
        parent.insertBefore(newSpan, hostSpan.nextSibling);
    }

    remarksRichSetCaretInSpan(newSpan);
    return newSpan;
}

function remarksRichFindTypingSpanAtCaret(editor) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    var node = sel.anchorNode;
    if (!node || !editor.contains(node)) return null;
    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== editor) {
        if (el.tagName === 'SPAN' && el.classList.contains('appt-rm-typing')) return el;
        el = el.parentElement;
    }
    return null;
}

function remarksRichClearColorsInNode(node) {
    if (!node) return;
    if (node.nodeType === 1) {
        if (node.style && node.style.color) node.style.color = '';
        if (node.tagName === 'FONT') node.removeAttribute('color');
    }
    var ch = node.childNodes;
    for (var i = ch.length - 1; i >= 0; i--) remarksRichClearColorsInNode(ch[i]);
}

function remarksRichApplyInlineToRange(editor, styleObj) {
    if (!editor || !styleObj) return false;
    remarksRichRestoreSelection(editor);
    editor.focus();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer) || range.collapsed) return false;

    var frag = range.extractContents();
    if (styleObj.color) remarksRichClearColorsInNode(frag);
    var span = document.createElement('span');
    if (styleObj.color) span.style.color = styleObj.color;
    if (styleObj.fontSize) span.style.fontSize = styleObj.fontSize;
    if (styleObj.fontFamily) span.style.fontFamily = styleObj.fontFamily;
    span.appendChild(frag);
    range.insertNode(span);

    sel.removeAllRanges();
    var nr = document.createRange();
    nr.selectNodeContents(span);
    nr.collapse(false);
    sel.addRange(nr);

    if (styleObj.color) editor.dataset.rmTypingColor = styleObj.color;
    if (styleObj.fontFamily) editor.dataset.rmTypingFont = styleObj.fontFamily;
    remarksRichClearStoredRange(editor);
    remarksRichSaveSelection(editor);
    return true;
}

function remarksRichApplyColorToRange(editor, hexColor) {
    return remarksRichApplyInlineToRange(editor, { color: hexColor });
}

/** Place typing-style span at caret only — does not change text before the caret. */
function remarksRichPlaceTypingSpanAtCaret(editor, styleObj) {
    styleObj = styleObj || {};
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!range.collapsed || !editor.contains(range.commonAncestorContainer)) return null;

    var marker = remarksRichFindTypingSpanAtCaret(editor);
    if (marker && remarksRichIsMarkerOnlySpan(marker)) {
        if (styleObj.color) marker.style.color = styleObj.color;
        if (styleObj.fontSize) marker.style.fontSize = styleObj.fontSize;
        if (styleObj.fontFamily) marker.style.fontFamily = styleObj.fontFamily;
        remarksRichSetCaretInSpan(marker);
        return marker;
    }

    var hostSpan = remarksRichFindStyleSpanAtCaret(editor);
    if (hostSpan && remarksRichSpanHasInlineStyle(hostSpan) &&
        !remarksRichSpanMatchesStyle(hostSpan, styleObj)) {
        return remarksRichSplitHostSpanAtCaret(editor, hostSpan, styleObj);
    }

    if (hostSpan && remarksRichSpanMatchesStyle(hostSpan, styleObj)) {
        hostSpan.classList.add('appt-rm-typing');
        remarksRichSetCaretInSpan(hostSpan);
        return hostSpan;
    }

    var span = remarksRichCreateTypingSpan(styleObj);
    var container = range.startContainer;
    var offset = range.startOffset;
    var styledWrap = hostSpan && remarksRichSpanHasInlineStyle(hostSpan) ? hostSpan : null;

    if (container.nodeType === 3) {
        var tn = container;
        var parent = tn.parentNode;
        if (styledWrap && styledWrap.contains(tn) && styleObj.color) {
            if (offset >= tn.length) {
                styledWrap.parentNode.insertBefore(span, styledWrap.nextSibling);
            } else if (offset === 0) {
                styledWrap.parentNode.insertBefore(span, styledWrap);
            } else {
                var tail2 = tn.splitText(offset);
                span.appendChild(tail2);
                styledWrap.parentNode.insertBefore(span, styledWrap.nextSibling);
            }
        } else if (offset === 0) {
            parent.insertBefore(span, tn);
        } else if (offset >= tn.length) {
            if (tn.nextSibling) parent.insertBefore(span, tn.nextSibling);
            else parent.appendChild(span);
        } else {
            var tail = tn.splitText(offset);
            span.appendChild(tail);
            parent.insertBefore(span, tail);
        }
    } else if (container.nodeType === 1) {
        if (styledWrap && styleObj.color) {
            styledWrap.parentNode.insertBefore(span, styledWrap.nextSibling);
        } else {
            var ref = container.childNodes[offset] || null;
            container.insertBefore(span, ref);
        }
    }

    remarksRichSetCaretInSpan(span);
    return span;
}

function remarksRichRestoreSelection(editor) {
    if (!editor) return false;
    var range = _remarksRichSelByEditor[editor.id];
    if (!range) return false;
    try {
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
    } catch (e2) {
        return false;
    }
}

var APPT_REMARKS_DEFAULT_COLOR = '#334155';

function remarksRichToHexColor(cssColor) {
    var s = String(cssColor || '').trim();
    if (!s) return APPT_REMARKS_DEFAULT_COLOR;
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) {
        return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    var m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) {
        return '#' + [m[1], m[2], m[3]].map(function(n) {
            return ('0' + parseInt(n, 10).toString(16)).slice(-2);
        }).join('');
    }
    try {
        var probe = document.createElement('span');
        probe.style.color = s;
        document.body.appendChild(probe);
        var resolved = window.getComputedStyle(probe).color;
        document.body.removeChild(probe);
        if (resolved && resolved !== s) return remarksRichToHexColor(resolved);
    } catch (eProbe) {}
    return APPT_REMARKS_DEFAULT_COLOR;
}

function remarksRichGetInlineColorFromElement(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.tagName === 'FONT') {
        var fc = el.getAttribute('color');
        if (fc) return fc;
    }
    if (el.style && el.style.color) return el.style.color;
    var st = el.getAttribute('style') || '';
    var m = st.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    return m ? m[1].trim() : '';
}

/** Color at caret or start of selection (for toolbar picker). */
function remarksRichGetCaretColor(editor) {
    if (!editor) return APPT_REMARKS_DEFAULT_COLOR;
    var sel = window.getSelection();
    var range = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
    if (!range || !editor.contains(range.commonAncestorContainer)) {
        var stored = _remarksRichSelByEditor[editor.id];
        if (stored) {
            try { range = stored.cloneRange(); } catch (eSt) { range = null; }
        }
    }
    if (!range) return APPT_REMARKS_DEFAULT_COLOR;

    var node = range.startContainer;
    if (node.nodeType === 1) {
        var child = node.childNodes[range.startOffset];
        if (!child && range.startOffset > 0) child = node.childNodes[range.startOffset - 1];
        if (child) node = child;
    }
    if (!node) return APPT_REMARKS_DEFAULT_COLOR;

    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== editor) {
        if (el.tagName === 'SPAN' || el.tagName === 'FONT') {
            var inline = remarksRichGetInlineColorFromElement(el);
            if (inline) return remarksRichToHexColor(inline);
        }
        el = el.parentElement;
    }

    el = node.nodeType === 3 ? node.parentElement : node;
    if (el && el !== editor) {
        var comp = window.getComputedStyle(el).color;
        if (comp) return remarksRichToHexColor(comp);
    }
    return APPT_REMARKS_DEFAULT_COLOR;
}

/** Nearest styled span wrapping the caret (for typing color sync). */
function remarksRichFindStyleSpanAtCaret(editor) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    var node = sel.anchorNode;
    if (!node || !editor.contains(node)) return null;
    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== editor) {
        if (el.tagName === 'SPAN' && remarksRichSpanHasInlineStyle(el)) return el;
        el = el.parentElement;
    }
    return null;
}

function remarksRichApplyFormat(editor, styleObj) {
    if (!editor || !styleObj) return;
    remarksRichRestoreSelection(editor);
    editor.focus();
    if (styleObj.color) editor.dataset.rmTypingColor = styleObj.color;
    if (styleObj.fontFamily) editor.dataset.rmTypingFont = styleObj.fontFamily;

    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    if (!range.collapsed) {
        remarksRichApplyInlineToRange(editor, styleObj);
    } else {
        remarksRichPlaceTypingSpanAtCaret(editor, styleObj);
        remarksRichSaveSelection(editor);
    }
    remarksRichSyncColorPickerFromCaret(editor, editor._remarksRichWrap);
}

function remarksRichInsertTypingSpan(editor, styleObj) {
    if (styleObj.color || styleObj.fontFamily || styleObj.fontSize) {
        return remarksRichPlaceTypingSpanAtCaret(editor, styleObj);
    }
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer) || !range.collapsed) return null;

    var span = document.createElement('span');
    span.className = 'appt-rm-typing';
    if (styleObj.fontSize) span.style.fontSize = styleObj.fontSize;
    if (styleObj.fontFamily) span.style.fontFamily = styleObj.fontFamily;

    range.insertNode(span);
    var r = document.createRange();
    r.setStart(span, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return span;
}

function remarksRichApplyColor(editor, hexColor) {
    if (!editor || !hexColor) return;
    editor.dataset.rmTypingColor = hexColor;
    remarksRichApplyFormat(editor, { color: hexColor });
    var wrap = editor._remarksRichWrap;
    if (wrap) {
        remarksRichSetPickerInputValue(wrap, hexColor);
        remarksRichSetColorChip(wrap, hexColor);
        remarksRichMarkSwatchSelection(wrap, hexColor);
    }
}

function remarksRichSetColorChip(wrap, hex) {
    if (!wrap || !hex) return;
    var chip = wrap.querySelector('.appt-remarks-fmt-color-chip');
    if (chip) chip.style.background = hex;
}

function remarksRichNormalizeHex(val, fallback) {
    var s = String(val || '').trim().toLowerCase();
    if (!s) return (fallback || APPT_REMARKS_DEFAULT_COLOR);
    if (s[0] !== '#') s = '#' + s;
    if (/^#[0-9a-f]{3}$/i.test(s)) {
        return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    return (fallback || APPT_REMARKS_DEFAULT_COLOR);
}

function remarksRichSetPickerInputValue(wrap, hex) {
    if (!wrap) return;
    var inp = wrap.querySelector('.appt-remarks-fmt-color-hex');
    if (inp) inp.value = hex;
    var nativeInp = wrap.querySelector('.appt-remarks-fmt-color-native');
    if (nativeInp) nativeInp.value = hex;
}

function remarksRichMarkSwatchSelection(wrap, hex) {
    if (!wrap) return;
    var sw = wrap.querySelectorAll('.appt-remarks-fmt-color-swatch');
    for (var i = 0; i < sw.length; i++) {
        var on = (sw[i].getAttribute('data-color') || '').toLowerCase() === String(hex || '').toLowerCase();
        if (on) sw[i].classList.add('is-selected');
        else sw[i].classList.remove('is-selected');
    }
}

/** Picker: apply to selection or set active typing color; optionally close panel. */
function remarksRichApplyPickerColor(editor, wrap, hex, closePicker) {
    if (!editor || !hex) return;
    hex = remarksRichNormalizeHex(hex, APPT_REMARKS_DEFAULT_COLOR);
    editor.dataset.rmTypingColor = hex;
    if (!closePicker) return;

    remarksRichRestoreSelection(editor);
    editor.focus();

    var sel = window.getSelection();
    var range = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
    if (range && !range.collapsed && editor.contains(range.commonAncestorContainer)) {
        remarksRichApplyInlineToRange(editor, { color: hex });
    } else {
        remarksRichPlaceTypingSpanAtCaret(editor, { color: hex });
        remarksRichSaveSelection(editor);
    }

    remarksRichSetPickerInputValue(wrap, hex);
    remarksRichSetColorChip(wrap, hex);
    remarksRichMarkSwatchSelection(wrap, hex);
    if (closePicker) {
        setTimeout(function() {
            editor.focus();
            remarksRichSaveSelection(editor);
            remarksRichSyncColorPickerFromCaret(editor, wrap);
        }, 0);
    }
}

function remarksRichSetPendingColor(editor, wrap, hex) {
    if (!editor) return;
    hex = remarksRichNormalizeHex(hex, APPT_REMARKS_DEFAULT_COLOR);
    editor.dataset.rmPendingColor = hex;
    remarksRichSetPickerInputValue(wrap, hex);
    remarksRichSetColorChip(wrap, hex);
    remarksRichMarkSwatchSelection(wrap, hex);
}

function remarksRichCommitPendingColor(editor, wrap) {
    if (!editor) return;
    var hex = editor.dataset.rmPendingColor || '';
    if (!hex) return;
    remarksRichApplyPickerColor(editor, wrap, hex, true);
    delete editor.dataset.rmPendingColor;
}

function remarksRichSyncColorPickerFromCaret(editor, wrap) {
    if (!editor || !wrap) return;
    var colorInp = wrap.querySelector('.appt-remarks-fmt-color-hex');
    if (colorInp && document.activeElement === colorInp) return;
    var hex = remarksRichGetCaretColor(editor);
    editor.dataset.rmTypingColor = hex;
    remarksRichSetPickerInputValue(wrap, hex);
    remarksRichSetColorChip(wrap, hex);
    remarksRichMarkSwatchSelection(wrap, hex);
}

function remarksRichEnsureTypingColorOnInput(editor) {
    var hex = editor.dataset.rmTypingColor;
    var font = editor.dataset.rmTypingFont;
    if (!hex && !font) return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
    if (!editor.contains(sel.anchorNode)) return;

    var styleObj = {};
    if (hex) styleObj.color = hex;
    if (font) styleObj.fontFamily = font;

    var ty = remarksRichFindTypingSpanAtCaret(editor);
    if (ty) {
        if (remarksRichIsMarkerOnlySpan(ty)) {
            if (hex && remarksRichToHexColor(ty.style.color) !== hex) ty.style.color = hex;
            if (font && ty.style.fontFamily !== font) ty.style.fontFamily = font;
            return;
        }
        if (remarksRichSpanMatchesStyle(ty, styleObj)) return;
        remarksRichSplitHostSpanAtCaret(editor, ty, styleObj);
        return;
    }

    var hostSpan = remarksRichFindStyleSpanAtCaret(editor);
    if (hostSpan && remarksRichSpanHasInlineStyle(hostSpan) &&
        !remarksRichSpanMatchesStyle(hostSpan, styleObj)) {
        remarksRichSplitHostSpanAtCaret(editor, hostSpan, styleObj);
        return;
    }

    remarksRichPlaceTypingSpanAtCaret(editor, styleObj);
}

function remarksRichCleanupEditorHtml(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = String(html || '');
    var typing = tmp.querySelectorAll('span.appt-rm-typing');
    for (var i = 0; i < typing.length; i++) {
        var sp = typing[i];
        var t = String(sp.textContent || '').replace(/\u200b/g, '');
        if (!t.trim()) {
            sp.parentNode.removeChild(sp);
        } else {
            sp.classList.remove('appt-rm-typing');
        }
    }
    return tmp.innerHTML.replace(/\u200b/g, '');
}

function remarksRichBuildToolbar(wrap) {
    var bar = wrap.querySelector('.appt-remarks-rich-toolbar');
    if (!bar || bar.dataset.built === '1') return;
    bar.dataset.built = '1';

    var sizeGrp = document.createElement('div');
    sizeGrp.className = 'appt-remarks-fmt-group';
    sizeGrp.innerHTML =
        '<label><span data-i18n="appt.remarksRich.size"></span> ' +
        '<select class="appt-remarks-fmt-size" title="' + esc(remarksRichTr('appt.remarksRich.size')) + '">' +
        '<option value="">' + esc(remarksRichTr('appt.remarksRich.sizeDefault')) + '</option>' +
        APPT_REMARKS_RICH_SIZES.map(function(s) {
            return '<option value="' + esc(s.v) + '">' + esc(s.k) + '</option>';
        }).join('') +
        '</select></label>';
    bar.appendChild(sizeGrp);

    var famGrp = document.createElement('div');
    famGrp.className = 'appt-remarks-fmt-group';
    famGrp.innerHTML =
        '<label><span data-i18n="appt.remarksRich.style"></span> ' +
        '<select class="appt-remarks-fmt-family" title="' + esc(remarksRichTr('appt.remarksRich.style')) + '">' +
        '<option value="">' + esc(remarksRichTr('appt.remarksRich.styleDefault')) + '</option>' +
        APPT_REMARKS_RICH_FONTS.map(function(f) {
            return '<option value="' + esc(f.v) + '" style="font-family:' + esc(f.v) + '">' +
                esc(f.k) + '</option>';
        }).join('') +
        '</select></label>';
    bar.appendChild(famGrp);

    var colGrp = document.createElement('div');
    colGrp.className = 'appt-remarks-fmt-group appt-remarks-fmt-color-group';
    colGrp.innerHTML =
        '<span data-i18n="appt.remarksRich.color"></span>' +
        '<button type="button" class="appt-remarks-fmt-color-trigger" title="' +
            esc(remarksRichTr('appt.remarksRich.color')) + '">' +
            '<span class="appt-remarks-fmt-color-chip" style="background:' +
                APPT_REMARKS_DEFAULT_COLOR + ';"></span>' +
        '</button>' +
        '<div class="appt-remarks-fmt-color-pop" hidden>' +
            '<div class="appt-remarks-fmt-color-swatches">' +
                APPT_REMARKS_RICH_COLORS.map(function(c) {
                    return '<button type="button" class="appt-remarks-fmt-color-swatch" data-color="' +
                        c + '" style="background:' + c + ';"></button>';
                }).join('') +
            '</div>' +
            '<div class="appt-remarks-fmt-color-row">' +
                '<input type="text" class="appt-remarks-fmt-color-hex" value="' + APPT_REMARKS_DEFAULT_COLOR + '"' +
                    ' maxlength="7" spellcheck="false">' +
            '</div>' +
            '<div class="appt-remarks-fmt-color-row">' +
                '<input type="color" class="appt-remarks-fmt-color-native" value="' + APPT_REMARKS_DEFAULT_COLOR + '">' +
            '</div>' +
            '<div class="appt-remarks-fmt-color-actions">' +
                '<button type="button" class="appt-remarks-fmt-color-ok">OK</button>' +
                '<button type="button" class="appt-remarks-fmt-color-cancel">Cancel</button>' +
            '</div>' +
        '</div>';
    bar.appendChild(colGrp);

    var boldBtn = document.createElement('button');
    boldBtn.type = 'button';
    boldBtn.className = 'appt-remarks-fmt-btn';
    boldBtn.setAttribute('data-fmt', 'bold');
    boldBtn.setAttribute('data-i18n', 'appt.remarksRich.bold');
    boldBtn.textContent = 'B';
    bar.appendChild(boldBtn);

    var italicBtn = document.createElement('button');
    italicBtn.type = 'button';
    italicBtn.className = 'appt-remarks-fmt-btn';
    italicBtn.setAttribute('data-fmt', 'italic');
    italicBtn.setAttribute('data-i18n', 'appt.remarksRich.italic');
    italicBtn.textContent = 'I';
    bar.appendChild(italicBtn);

    if (typeof applyI18nInRoot === 'function') applyI18nInRoot(bar);
}

function remarksRichApplyStyle(editor, styleObj) {
    if (!editor || !styleObj) return;
    if (styleObj.color || styleObj.fontFamily || styleObj.fontSize) {
        remarksRichApplyFormat(editor, styleObj);
        return;
    }
    editor.focus();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    var span = document.createElement('span');
    if (styleObj.fontWeight) span.style.fontWeight = styleObj.fontWeight;
    if (styleObj.fontStyle) span.style.fontStyle = styleObj.fontStyle;

    try {
        range.surroundContents(span);
    } catch (e2) {
        var frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
    }
    sel.removeAllRanges();
    var nr = document.createRange();
    nr.selectNodeContents(span);
    nr.collapse(false);
    sel.addRange(nr);
}

function remarksRichToggleBtn(editor, cmd) {
    if (!editor) return;
    editor.focus();
    try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
    document.execCommand(cmd, false, null);
}

function remarksRichWireWrap(wrap) {
    remarksRichBuildToolbar(wrap);
    var editor = remarksRichGetEditor(wrap);
    if (!editor || wrap.dataset.wired === '1') return;
    wrap.dataset.wired = '1';

    var edPh = editor.getAttribute('data-i18n-placeholder');
    if (edPh && typeof remarksRichTr === 'function') {
        editor.setAttribute('data-placeholder', remarksRichTr(edPh));
    }

    editor._remarksRichWrap = wrap;

    function remarksRichOnCaretMove() {
        remarksRichSaveSelection(editor);
        var selNow = window.getSelection();
        if (selNow && selNow.rangeCount && selNow.isCollapsed) {
            remarksRichClearStoredRange(editor);
        }
        remarksRichSyncColorPickerFromCaret(editor, wrap);
    }

    editor.addEventListener('mouseup', remarksRichOnCaretMove);
    editor.addEventListener('keyup', remarksRichOnCaretMove);
    editor.addEventListener('click', remarksRichOnCaretMove);
    editor.addEventListener('focus', remarksRichOnCaretMove);
    editor.addEventListener('blur', function() {
        remarksRichSaveSelection(editor);
    });

    if (!wrap._remarksSelChangeBound) {
        wrap._remarksSelChangeBound = true;
        document.addEventListener('selectionchange', function() {
            if (!wrap.isConnected || !editor.isConnected) return;
            var ae = document.activeElement;
            if (ae && ae.classList && ae.classList.contains('appt-remarks-fmt-color-hex')) return;
            var sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            if (!editor.contains(sel.anchorNode) && !editor.contains(sel.focusNode)) return;
            remarksRichSyncColorPickerFromCaret(editor, wrap);
        });
    }
    editor.addEventListener('input', function() {
        remarksRichEnsureTypingColorOnInput(editor);
    });
    editor.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        var hex = editor.dataset.rmTypingColor;
        var font = editor.dataset.rmTypingFont;
        var ty = remarksRichFindTypingSpanAtCaret(editor);
        if (ty) remarksRichFinalizeTypingSpan(ty);
        var host = remarksRichFindStyleSpanAtCaret(editor);
        if (host && host !== ty) remarksRichFinalizeTypingSpan(host);
        if (!hex && !font) return;
        setTimeout(function() {
            var styleObj = {};
            if (hex) styleObj.color = hex;
            if (font) styleObj.fontFamily = font;
            remarksRichPlaceTypingSpanAtCaret(editor, styleObj);
            remarksRichSaveSelection(editor);
        }, 0);
    });

    wrap.addEventListener('mousedown', function(e) {
        var t = e.target;
        var bar = t.closest ? t.closest('.appt-remarks-rich-toolbar') : null;
        if (!bar || !wrap.contains(bar)) return;
        remarksRichSaveSelectionForToolbar(editor);
    }, true);

    var colorInp = wrap.querySelector('.appt-remarks-fmt-color-hex');
    var colorNativeInp = wrap.querySelector('.appt-remarks-fmt-color-native');
    var colorPop = wrap.querySelector('.appt-remarks-fmt-color-pop');
    var colorTrig = wrap.querySelector('.appt-remarks-fmt-color-trigger');
    var colorCancelBtn = wrap.querySelector('.appt-remarks-fmt-color-cancel');
    if (colorInp) {
        colorInp.addEventListener('focus', function() {
            remarksRichSaveSelectionForToolbar(editor);
        });
        colorInp.addEventListener('input', function() {
            remarksRichSetPendingColor(editor, wrap, colorInp.value);
        });
        colorInp.addEventListener('blur', function() {
            colorInp.value = remarksRichNormalizeHex(colorInp.value, editor.dataset.rmPendingColor || APPT_REMARKS_DEFAULT_COLOR);
        });
    }
    if (colorNativeInp) {
        colorNativeInp.addEventListener('input', function() {
            remarksRichSetPendingColor(editor, wrap, colorNativeInp.value);
        });
        colorNativeInp.addEventListener('change', function() {
            remarksRichSetPendingColor(editor, wrap, colorNativeInp.value);
        });
    }

    var colorOkBtn = wrap.querySelector('.appt-remarks-fmt-color-ok');
    if (colorOkBtn) {
        colorOkBtn.addEventListener('click', function(e) {
            e.preventDefault();
            remarksRichCommitPendingColor(editor, wrap);
            if (colorPop) colorPop.hidden = true;
        });
    }
    if (colorCancelBtn) {
        colorCancelBtn.addEventListener('click', function(e) {
            e.preventDefault();
            delete editor.dataset.rmPendingColor;
            if (colorPop) colorPop.hidden = true;
            remarksRichSyncColorPickerFromCaret(editor, wrap);
            editor.focus();
        });
    }
    if (colorPop) {
        colorPop.addEventListener('mousedown', function(e) {
            e.stopPropagation();
        });
        colorPop.addEventListener('click', function(e) {
            var sw = e.target && e.target.closest ? e.target.closest('.appt-remarks-fmt-color-swatch') : null;
            if (!sw || !colorPop.contains(sw)) return;
            e.preventDefault();
            var c = sw.getAttribute('data-color') || APPT_REMARKS_DEFAULT_COLOR;
            remarksRichSetPendingColor(editor, wrap, c);
        });
    }
    if (colorTrig && colorPop && colorInp) {
        colorTrig.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            remarksRichSaveSelectionForToolbar(editor);
            var hexNow = remarksRichGetCaretColor(editor);
            remarksRichSetPendingColor(editor, wrap, hexNow);
            colorPop.hidden = !colorPop.hidden;
            if (!colorPop.hidden) colorInp.focus();
        });
        document.addEventListener('mousedown', function(e) {
            if (!colorPop || colorPop.hidden) return;
            if (!wrap.isConnected) return;
            if (wrap.contains(e.target)) return;
            delete editor.dataset.rmPendingColor;
            remarksRichSyncColorPickerFromCaret(editor, wrap);
            colorPop.hidden = true;
        });
    }

    wrap.addEventListener('mousedown', function(e) {
        var t = e.target;
        if (t.classList && (
            t.classList.contains('appt-remarks-fmt-size') ||
            t.classList.contains('appt-remarks-fmt-family')
        )) {
            remarksRichSaveSelectionForToolbar(editor);
        }
    });

    wrap.addEventListener('change', function(e) {
        var t = e.target;
        if (t.classList && t.classList.contains('appt-remarks-fmt-color-hex')) return;
        if (t.classList && t.classList.contains('appt-remarks-fmt-size') && t.value) {
            remarksRichApplyFormat(editor, { fontSize: t.value });
            t.value = '';
            return;
        }
        if (t.classList && t.classList.contains('appt-remarks-fmt-family') && t.value) {
            remarksRichApplyFormat(editor, { fontFamily: t.value });
            t.value = '';
        }
    });

    wrap.addEventListener('click', function(e) {
        var btn = e.target.closest ? e.target.closest('[data-fmt]') : null;
        if (!btn || !wrap.contains(btn)) return;
        e.preventDefault();
        var fmt = btn.getAttribute('data-fmt');
        if (fmt === 'bold') remarksRichToggleBtn(editor, 'bold');
        else if (fmt === 'italic') remarksRichToggleBtn(editor, 'italic');
    });
}

function initApptRemarksRichEditors() {
    var wraps = document.querySelectorAll('.appt-remarks-rich');
    for (var i = 0; i < wraps.length; i++) remarksRichWireWrap(wraps[i]);
}

function refreshApptRemarksEditorPlaceholders() {
    ['queueRemarksEditor', 'fRemarksEditor'].forEach(function(id) {
        var ed = g(id);
        if (!ed) return;
        var k = ed.getAttribute('data-i18n-placeholder');
        if (k) ed.setAttribute('data-placeholder', remarksRichTr(k));
    });
}

function setApptRemarksEditorHtml(editorId, rawRemarks) {
    initApptRemarksRichEditors();
    var ed = g(editorId);
    if (!ed) return;
    var body = remarksForApptForm(rawRemarks);
    delete ed.dataset.rmTypingColor;
    if (remarksStringHasHtml(body)) {
        ed.innerHTML = sanitizeRemarksHtml(body);
    } else {
        ed.textContent = body;
    }
    var wrap = ed._remarksRichWrap;
    if (wrap) remarksRichSyncColorPickerFromCaret(ed, wrap);
}

function clearApptRemarksEditor(editorId) {
    var ed = g(editorId);
    if (!ed) return;
    ed.innerHTML = '';
}

function getApptRemarksEditorValue(editorId) {
    var ed = g(editorId);
    if (!ed) return '';
    var html = ed.innerHTML || '';
    if (!html.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, '').replace(/\u200b/g, '').trim()) {
        return '';
    }
    html = remarksRichCleanupEditorHtml(html);
    return sanitizeRemarksHtml(html);
}

function remarksFromEditor(editorId) {
    return remarksForApptForm(getApptRemarksEditorValue(editorId));
}

function embedDoctorTagInRemarks(payload, code) {
    if (!code) return;
    var staffTag = extractStaffAuthorSpan(payload.remarks || '');
    var rem = stripDoctorTagsFromRemarks(stripStaffAuthorFromRemarks(payload.remarks || ''));
    payload.remarks = (rem ? rem + ' | ' : '') + '|@dr:' + code + '|';
    if (staffTag) payload.remarks += ' | ' + sanitizeStaffAuthorSpan(staffTag);
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
    apptEditLockRef = null;
    setApptScheduleLockFormUI(false);
    resetApptBookingGuards();
    g('apptModalTitle').textContent = tr('appt.modal.newAppt');

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
    clearApptRemarksEditor('fRemarksEditor');
    sv('npName',   '');
    sv('npPhone',  '');
    sv('hPchinese', '');

    switchApptPatientMode('exist');   // always start in search mode
    buildTimeSlots();
    loadApptDoctors('');
    refreshApptModalI18n();
    openModal('apptModal');
}

function openApptEditModal(appt) {
    resetApptBookingGuards();
    apptEditLockRef = appt;
    apptEditId = appt.id;
    setApptScheduleLockFormUI(isApptScheduleLocked(appt));
    g('apptModalTitle').textContent = tr('appt.modal.editAppt');

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
    setApptRemarksEditorHtml('fRemarksEditor', appt.remarks);

    // If appointment has no patient_id it was a walk-in booking — restore that mode
    if (!appt.patient_id) {
        sv('npName',  appt.patient_name || '');
        sv('npPhone', extractPhoneFromRemarks(appt.remarks));
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
    refreshApptModalI18n();
    openModal('apptModal');
}

function saveAppt() {
    var date  = (g('fDate').value  || '').trim();
    var start = (g('fStart').value || '').trim();
    var dur   = parseInt(g('fDur').value || '30', 10);

    if (apptEditId && apptEditLockRef && isApptScheduleLocked(apptEditLockRef)) {
        date = apptEditLockRef.date || date;
        start = (apptEditLockRef.start_time || start).slice(0, 5);
        var lsp = String(apptEditLockRef.start_time || '').split(':');
        var lep = String(apptEditLockRef.end_time || '').split(':');
        var lsm = +lsp[0] * 60 + +(lsp[1] || 0);
        var lem = +lep[0] * 60 + +(lep[1] || 0);
        dur = lem > lsm ? lem - lsm : dur;
    }

    if (!date)  { alert(tr('appt.msg.enterDate')); return; }
    if (arBookingMinDateToday && date < todayISO()) {
        alert(tr('appt.msg.pastDate'));
        return;
    }
    if (!start) { alert(tr('appt.msg.selectStart')); return; }

    // ── Determine patient info based on active mode ──────────────
    var isWalkIn = g('psSectionNew') && g('psSectionNew').style.display !== 'none';
    var pid, pname, pno;

    if (isWalkIn) {
        pname = (g('npName').value  || '').trim();
        if (!pname) { alert(tr('appt.msg.enterPatientName')); g('npName').focus(); return; }
        var phone = (g('npPhone').value || '').trim();
        pid = '';    // no linked patient record
        pno = '';
    } else {
        pid   = (g('hPid').value   || '').trim();
        pname = (g('hPname').value || '').trim();
        pno   = (g('hPno').value   || '').trim();
        if (!pid) { alert(tr('appt.msg.selectPatient')); return; }
    }

    var end = addMins(start, dur);

    var drSel  = g('fApptDoctor');
    var drCode = drSel ? (drSel.value || '').trim() : '';
    if (!drCode) {
        alert(tr('appt.msg.selectDoctor'));
        if (drSel) drSel.focus();
        return;
    }
    var drObj  = billDoctorList
        ? billDoctorList.find(function(d) { return (d.doctor_code || d.id) === drCode; })
        : null;
    var drName = drObj ? (drObj.english_name || drObj.chinese_name || drCode) : drCode;

    var chineseName = isWalkIn ? '' : ((g('hPchinese') && g('hPchinese').value) || '');

    var rem = remarksFromEditor('fRemarksEditor');
    if (isWalkIn) {
        var walkPhone = (g('npPhone').value || '').trim();
        if (walkPhone) {
            rem = rem
                ? rem + trRepl('appt.walkinRemarksAppend', { PHONE: walkPhone })
                : trRepl('appt.walkinRemarksPhone', { PHONE: walkPhone });
        }
    }
    var priorRaw = apptEditLockRef ? apptEditLockRef.remarks : null;
    rem = mergeStaffAuthorOnSave(rem, priorRaw);

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
        remarks:               rem,
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

    var finishSave = function () {
        closeModal('apptModal');
        apptEditId = null;
        apptEditLockRef = null;
        setApptScheduleLockFormUI(false);
        if (typeof syncApptPlannerDate === 'function' && date) {
            syncApptPlannerDate(date, { syncCal: true });
        }
        loadToday();
        loadQueue();
        loadApptRecords();
        if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
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
                    alert(tr('bill.alert.doctorColumns'));
                } else if (msg.indexOf('clinic_tag') >= 0) {
                    var p3 = Object.assign({}, p);
                    delete p3[APPOINTMENT_CLINIC_TAG_FIELD];
                    tryPayload(p3, opts);
                } else {
                    alert(trRepl('appt.msg.error', { MSG: msg }));
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
    if (apptEditLockRef && isApptScheduleLocked(apptEditLockRef)) {
        alert(tr('appt.msg.lockedDelete'));
        return;
    }
    if (!confirm(tr('appt.confirm.deleteAppt'))) return;

    SB.from('appointments')
        .delete()
        .eq('id', apptEditId)
    .then(function(r) {
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
        closeModal('apptModal');
        apptEditId = null;
        apptEditLockRef = null;
        setApptScheduleLockFormUI(false);
        loadToday();
        loadQueue();
        loadApptRecords();
        if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
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
        if (lbl) lbl.textContent = tr('appt.modal.selectDoctorLabel');
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
            empty.textContent = tr('appt.modal.noDoctorsForClinic');
            empty.disabled = true;
            sel.appendChild(empty);
        }
        list = list.filter(function (d) {
            return typeof isClinicalDoctorRecord === 'function'
                ? isClinicalDoctorRecord(d)
                : !isPlusApptExcludedDoctor(d);
        });
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
        out += '<span class="appt-walkin-badge">' + esc(tr('appt.badge.newWalkin')) + '</span>';
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
        'color:#aaa;padding:24px;">' + esc(tr('common.loadingEllipsis')) + '</td></tr>';

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
                'color:#aaa;padding:24px;">' + esc(tr('appt.today.noToday')) +
                '</td></tr>';
            if (cnt) cnt.textContent = trRepl('appt.today.countN', { N: '0' });
            doStrip([]);
            return;
        }
        augmentAppointmentsChineseFromPatients(r.data, function(rows) {
            todayAppts = rows;
            var visible = typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts
                ? CalDoctorColors.filterAppts(rows) : rows;
            if (cnt) {
                cnt.textContent = visible.length === 1
                    ? tr('appt.today.countOne')
                    : trRepl('appt.today.countN', { N: String(visible.length) });
            }
            if (!visible.length) {
                tb.innerHTML =
                    '<tr><td colspan="8" style="text-align:center;' +
                    'color:#aaa;padding:24px;">' +
                    esc(rows.length ? tr('appt.today.noFiltered') : tr('appt.today.noToday')) +
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
        alert(tr('appt.today.regNotAvailable'));
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
            alert(trRepl('appt.today.regLinkFail', { MSG: res.error.message }));
            loadToday();
            return;
        }
        loadToday();
        alert(trRepl('appt.today.regLinkOk', { NO: (patient.patient_no || '—') }));
    });
    return true;
}

function buildTodayRow(tb, a) {
    var row = document.createElement('tr');
    row.style.cursor = 'pointer';
    var needsReg = todayApptNeedsPatientReg(a);
    var actionBtn = '';
    if (a.bill_status !== 'Queue' && a.bill_status !== 'Done') {
        if (needsReg) {
            actionBtn =
                '<button type="button" class="btn-today-newpatient btn-sm" ' +
                'style="background:#d97706;">' + esc(tr('appt.today.btnNewPatient')) + '</button>';
        } else {
            actionBtn =
                '<button type="button" class="btn-today-checkin btn-sm" ' +
                'style="background:var(--success);">' + esc(tr('appt.today.btnCheckIn')) + '</button>';
        }
    }

    row.innerHTML =
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
            formatRemarksForDisplay(a.remarks, { empty: '-' }) +
        '</td>' +
        '<td style="text-align:center;">' +
            esc(a.duration ? trRepl('appt.modal.durMin', { N: a.duration }) : '-') +
        '</td>' +
        '<td>' +
            '<span class="status-badge ' +
                statusClass(a.bill_status) + '">' +
                esc(dispStatusLabel(a.bill_status || 'Scheduled')) +
            '</span>' +
        '</td>' +
        '<td>' +
            '<div style="display:flex;gap:5px;flex-wrap:wrap;">' +
                '<button type="button" class="btn-today-edit btn-sm" ' +
                'style="background:var(--primary);">' + esc(tr('appt.today.btnEdit')) + '</button>' +
                actionBtn +
            '</div>' +
        '</td>';

    tb.appendChild(row);

    row.addEventListener('dblclick', function () {
        if (a.bill_status === 'Queue' || a.bill_status === 'Done') {
            openApptEditModal(a);
            return;
        }
        if (todayApptNeedsPatientReg(a)) {
            openNewPatientForTodayAppt(a);
            return;
        }
        if (!confirm(trRepl('appt.today.confirmCheckIn', {
            NAME: a.patient_name || tr('appt.today.thisPatient')
        }))) return;
        checkInFromToday(a.id);
    });

    row.querySelector('.btn-today-edit')
        .addEventListener('click', function (e) {
            e.stopPropagation();
            openApptEditModal(a);
        });

    var np = row.querySelector('.btn-today-newpatient');
    if (np) {
        np.addEventListener('click', function (e) {
            e.stopPropagation();
            openNewPatientForTodayAppt(a);
        });
    }

    var ci = row.querySelector('.btn-today-checkin');
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
                  ? currentClinicLabel : tr('ai.clinicFallback');
    var dateStr = (typeof fmtDateLong === 'function') ? fmtDateLong(todayISO()) : todayISO();
    var rows    = '';

    var printRows = typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts
        ? CalDoctorColors.filterAppts(todayAppts) : todayAppts;

    if (!printRows.length) {
        rows = '<tr><td colspan="7" style="text-align:center;color:#888;' +
               'padding:20px;">' + esc(tr('appt.today.noToday')) + '</td></tr>';
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
                '<td>' + formatRemarksForDisplay(a.remarks, { empty: '-' }) + '</td>' +
                '<td style="text-align:center;">' +
                    esc(a.duration ? trRepl('appt.modal.durMin', { N: a.duration }) : '-') + '</td>' +
                '<td>' + esc(dispStatusLabel(status)) + '</td>' +
                '</tr>';
        });
    }

    var html =
        '<!DOCTYPE html><html><head>' +
        '<meta charset="UTF-8">' +
        '<title>' + esc(trRepl('appt.today.printDocTitle', { DATE: dateStr })) + '</title>' +
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
        '<h2>' + esc(trRepl('appt.today.printDailyTitle', { CLINIC: clinic })) + '</h2>' +
        '<p class="sub">' + esc(trRepl('appt.today.printSubtitle', {
            DATE: dateStr,
            N: printRows.length
        })) + '</p>' +
        '<table>' +
        '<thead><tr>' +
            '<th>' + esc(tr('appt.todayTh.time')) + '</th>' +
            '<th>' + esc(tr('appt.todayTh.patNo')) + '</th>' +
            '<th>' + esc(tr('appt.todayTh.name')) + '</th>' +
            '<th>' + esc(tr('appt.todayTh.treatment')) + '</th>' +
            '<th>' + esc(tr('appt.todayTh.remarks')) + '</th>' +
            '<th>' + esc(tr('appt.todayTh.duration')) + '</th>' +
            '<th>' + esc(tr('appt.todayTh.status')) + '</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr><td colspan="7">' + esc(trRepl('appt.today.printFooter', {
            WHEN: new Date().toLocaleString(apptDateLocale())
        })) + '</td></tr></tfoot>' +
        '</table>' +
        '<script>window.onload=function(){window.print();}<\/script>' +
        '</body></html>';

    var w = window.open('', '_blank', 'width=900,height=650');
    if (!w) { alert(tr('appt.today.popupBlocked')); return; }
    w.document.write(html);
    w.document.close();
}

function checkInPatient(a) {
    if (todayApptNeedsPatientReg(a)) {
        alert(tr('appt.today.registerWalkinFirst'));
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
            if (res.error) { alert(trRepl('appt.msg.error', { MSG: res.error.message })); return; }
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
        'button, input, textarea, select, .action-wrap, .action-drop, .queue-remarks-preview-wrap'
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
        alert(tr('appt.queue.noRecordLinked'));
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
                alert(trRepl('appt.queue.orderSaveFail', { MSG: (err.message || String(err)) }));
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
    initApptRemarksRichEditors();

    m.addEventListener('click', function(e) {
        if (e.target === m) {
            queueRemarksEditApptId = null;
            _queueRemarksEditAppt = null;
            queueRemarksEditPriorRaw = null;
        }
    });

    function closeQm() {
        closeModal('queueRemarksModal');
        queueRemarksEditApptId = null;
        _queueRemarksEditAppt = null;
        queueRemarksEditPriorRaw = null;
    }

    var c1 = g('closeQueueRemarks');
    var c2 = g('cancelQueueRemarks');
    var sv = g('saveQueueRemarks');
    if (c1) c1.addEventListener('click', closeQm);
    if (c2) c2.addEventListener('click', closeQm);
    if (sv) {
        sv.addEventListener('click', function() {
            if (!queueRemarksEditApptId) return;
            var clean = remarksFromEditor('queueRemarksEditor');
            var raw = mergeStaffAuthorOnSave(clean, queueRemarksEditPriorRaw);
            SB.from('appointments')
                .update({ remarks: raw })
                .eq('id', queueRemarksEditApptId)
                .then(function(res) {
                    if (res.error) {
                        alert(trRepl('appt.msg.error', { MSG: res.error.message }));
                        return;
                    }
                    closeQm();
                    loadQueue();
                });
        });
    }
}

function setQueueRemarksApptHint(q) {
    var hi = g('queueRemarksApptHint');
    if (!hi || !q) return;
    var cn = typeof getApptDisplayChinese === 'function'
        ? getApptDisplayChinese(q)
        : '';
    var en = (q.patient_name || '').trim();
    var name = [cn, en].filter(Boolean).join(' · ') || tr('appt.queue.noName');
    var bits = [name];
    if (q.start_time) bits.push(fmt12(q.start_time));
    if (q.patient_no) bits.push('#' + String(q.patient_no));
    hi.textContent = bits.join(' · ');
}

function openQueueRemarksEditor(q) {
    if (!q || !q.id) return;
    bindQueueRemarksModalOnce();

    queueRemarksEditApptId = q.id;
    _queueRemarksEditAppt = q;
    queueRemarksEditPriorRaw = q.remarks || null;
    setApptRemarksEditorHtml('queueRemarksEditor', q.remarks);
    setQueueRemarksApptHint(q);

    openModal('queueRemarksModal');
    var qm = g('queueRemarksModal');
    if (qm && typeof applyI18nInRoot === 'function') applyI18nInRoot(qm);
    var ed = g('queueRemarksEditor');
    if (ed) {
        requestAnimationFrame(function() {
            ed.focus();
            try {
                var sel = window.getSelection();
                var range = document.createRange();
                range.selectNodeContents(ed);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
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
        'color:#aaa;padding:24px;">' + esc(tr('appt.queue.loading')) + '</td></tr>';

    var qq = SB.from('appointments').select('*')
        .eq('date', todayISO())
        .not('in_queue', 'is', null)
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
                esc(tr('appt.queue.empty')) + '</td></tr>';
            var qc = g('queueCount');
            if (qc) qc.textContent = trRepl('appt.queue.count', { N: '0' });
            doStrip([]);
            return;
        }
        var qc = g('queueCount');
        augmentAppointmentsChineseFromPatients(r.data, function(rows) {
            var visible = typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts
                ? CalDoctorColors.filterAppts(rows) : rows;
            if (qc) qc.textContent = trRepl('appt.queue.count', { N: String(visible.length) });
            if (!visible.length) {
                tb.innerHTML =
                    '<tr><td colspan="8" style="text-align:center;' +
                    'color:#aaa;padding:24px;">' +
                    esc(rows.length
                        ? tr('appt.queue.emptyFiltered')
                        : tr('appt.queue.empty')) +
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
    var row = document.createElement('tr');
    var uid = q.id.replace(/-/g, '').slice(0, 12);

    row.dataset.apptId = q.id;
    row.classList.add('queue-row-draggable');
    if (q.bill_status === 'Billed') row.classList.add('queue-row-billed');
    else if (q.bill_status === 'Paid') row.classList.add('queue-row-paid');
    row.draggable = true;
    row.title = tr('appt.queue.dragTitle');

    row.innerHTML =
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
                  new Date(q.arrival_time).toLocaleTimeString(apptDateLocale(), {
                      hour:   '2-digit',
                      minute: '2-digit'
                  }) + '</span>'
                : '<span style="color:#aaa;">—</span>') +
        '</td>' +
        '<td class="queue-remarks-cell">' +
            '<div class="queue-remarks-preview-wrap">' +
                ((q.remarks || '').trim()
                    ? '<div class="queue-remarks-snippet">' +
                      formatRemarksForDisplay(q.remarks, { stripDr: true }) +
                      '</div>'
                    : '<div class="queue-remarks-snippet queue-remarks-empty">' +
                      esc(tr('appt.queue.noRemarks')) +
                      '</div>') +
                '<button type="button" class="queue-remarks-pencil" ' +
                'id="qrm-pencil-' + uid + '" ' +
                'title="' + esc(tr('appt.queue.editRemarksTitle')) + '" aria-label="' + esc(tr('appt.queue.editRemarksAria')) + '">' +
                '✎</button>' +
            '</div>' +
        '</td>' +
        '<td>' +
            '<span class="status-badge ' +
                statusClass(q.bill_status) + '">' +
                esc(dispStatusLabel(q.bill_status || 'Queue')) +
            '</span>' +
        '</td>' +
        '<td>' +
            '<div class="action-wrap" id="aw-' + uid + '">' +
                '<button class="action-btn" id="ab-' + uid + '">' +
                    esc(tr('appt.queue.actions')) +
                '</button>' +
                '<div class="action-drop" id="ad-' + uid + '">' +
                    '<div class="action-item" id="act-bill-'   + uid + '">' +
                        '<span class="ai-icon">🧾</span>' + esc(tr('bill.queue.openBill')) +
                    '</div>' +
                    '<div class="action-item" id="act-notes-'  + uid + '">' +
                        '<span class="ai-icon">📝</span>' + esc(tr('appt.queue.clinicalNotes')) +
                    '</div>' +
                    '<div class="action-item" id="act-done-'   + uid + '">' +
                        '<span class="ai-icon">✅</span>' + esc(tr('appt.queue.markDone')) +
                    '</div>' +
                    '<div class="action-item" id="act-noshow-' + uid + '">' +
                        '<span class="ai-icon">🚫</span>' + esc(tr('appt.queue.noShow')) +
                    '</div>' +
                    '<div class="action-item" id="act-remove-' + uid + '">' +
                        '<span class="ai-icon">🗑</span>' + esc(tr('appt.queue.remove')) +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</td>';

    tb.appendChild(row);

    row.addEventListener('dragstart', function(e) {
        if (queueDragBlockedTarget(e.target)) {
            e.preventDefault();
            return;
        }
        e.dataTransfer.setData('text/plain', q.id);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('queue-row-dragging');
    });
    row.addEventListener('dragend', function() {
        row.classList.remove('queue-row-dragging');
    });

    row.addEventListener('dblclick', function (e) {
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
            alert(tr('appt.queue.noPatientLinked'));
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
            if (!confirm(trRepl('appt.queue.confirmRemove', {
                NAME: q.patient_name || tr('appt.today.thisPatient')
            }))) return;
            SB.from('appointments')
                .update({
                    bill_status: 'Scheduled',
                    in_queue:    null,
                    arrival_time: null
                })
                .eq('id', q.id)
            .then(function(res) {
                if (res.error) {
                    alert(trRepl('appt.msg.error', { MSG: res.error.message })); return;
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

    var remarksWrap = row.querySelector('.queue-remarks-preview-wrap');
    if (remarksWrap) {
        remarksWrap.addEventListener('dblclick', function(e) {
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
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
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
        new Date(y, m, 1).toLocaleDateString(apptDateLocale(), {
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
        apptCalWeekdayHeaders().forEach(function(d) {
            html += '<div class="cal-day-hdr">' + esc(d) + '</div>';
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
                    : ('<div class="appt-pill" data-id="' + esc(a.id) + '">' +
                       esc(fmt12(a.start_time)) + ' ' +
                       esc(a.patient_name || tr('appt.cal.cardWalkin')) + '</div>');
            });
            if (list.length > monthShow) {
                html += '<div class="gcal-month-more">' +
                    esc(trRepl('appt.cal.more', { N: list.length - monthShow })) + '</div>';
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
// WEEKLY CALENDAR — schedule lock (pin card; block drag / delete)
// ════════════════════════════════════════════════════════════════
var GCAL_LOCK_LS_KEY = 'gcal_schedule_locked_v1';

function scheduleLockedMap() {
    try {
        var raw = localStorage.getItem(GCAL_LOCK_LS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

function isApptScheduleLocked(appt) {
    if (!appt) return false;
    if (appt.schedule_locked === true || appt.schedule_locked === 1) return true;
    return !!scheduleLockedMap()[String(appt.id)];
}

function mergeScheduleLockedLocal(list) {
    if (!list || !list.length) return;
    var map = scheduleLockedMap();
    list.forEach(function (a) {
        if (a.schedule_locked === true || a.schedule_locked === 1) return;
        if (map[String(a.id)]) a.schedule_locked = true;
    });
}

function setApptScheduleLockFormUI(locked) {
    apptEditScheduleLocked = !!locked;
    var db = g('deleteApptBtn');
    if (db) db.style.display = (apptEditId && !locked) ? 'block' : 'none';
    var note = g('apptScheduleLockNote');
    if (note) note.style.display = locked ? 'block' : 'none';
    ['fDate', 'fStart', 'fDur'].forEach(function (id) {
        var el = g(id);
        if (!el) return;
        el.disabled = locked;
        el.style.opacity = locked ? '0.55' : '';
        el.style.cursor = locked ? 'not-allowed' : '';
    });
}

function findGcalCardEl(apptId) {
    return document.querySelector('.gcal-card[data-id="' + apptId + '"]');
}

function applyGcalCardLockState(card, appt) {
    if (!card || !appt) return;
    var locked = isApptScheduleLocked(appt);
    card.classList.toggle('gcal-card-locked', locked);
    var btn = card.querySelector('.gcal-card-lock');
    if (btn) {
        btn.classList.toggle('locked', locked);
        btn.textContent = locked ? '🔒' : '🔓';
        btn.title = locked
            ? tr('appt.cal.lockUnlockTitle')
            : tr('appt.cal.lockPinTitle');
        btn.setAttribute('aria-label', locked
            ? tr('appt.cal.lockAriaUnlock')
            : tr('appt.cal.lockAriaLock'));
    }
}

function refreshGcalLockButtonsI18n() {
    document.querySelectorAll('.gcal-card-lock').forEach(function (btn) {
        var locked = btn.classList.contains('locked');
        btn.title = locked
            ? tr('appt.cal.lockUnlockTitle')
            : tr('appt.cal.lockPinTitle');
        btn.setAttribute('aria-label', locked
            ? tr('appt.cal.lockAriaUnlock')
            : tr('appt.cal.lockAriaLock'));
    });
}

function persistApptScheduleLock(appt, locked, done) {
    if (!appt || !appt.id) {
        if (done) done(false);
        return;
    }
    var id = String(appt.id);
    var map = scheduleLockedMap();
    appt.schedule_locked = !!locked;
    if (locked) map[id] = true;
    else delete map[id];
    try { localStorage.setItem(GCAL_LOCK_LS_KEY, JSON.stringify(map)); } catch (e) {}

    function finish(ok) {
        var card = findGcalCardEl(appt.id);
        if (card) applyGcalCardLockState(card, appt);
        if (done) done(ok);
    }

    SB.from('appointments').update({ schedule_locked: !!locked }).eq('id', appt.id)
    .then(function (r) {
        if (r.error && (r.error.message || '').indexOf('schedule_locked') >= 0) {
            finish(true);
            return;
        }
        if (r.error) {
            alert(trRepl('appt.cal.lockUpdateFail', { MSG: r.error.message }));
            appt.schedule_locked = !locked;
            if (locked) delete map[id];
            else map[id] = true;
            try { localStorage.setItem(GCAL_LOCK_LS_KEY, JSON.stringify(map)); } catch (e2) {}
            finish(false);
            return;
        }
        finish(true);
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
    var resizeState = null;
    var suppressCardClickUntil = 0;
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
            days[0].toLocaleDateString(apptDateLocale(), {month:'short',day:'numeric'}) + ' – ' +
            days[6].toLocaleDateString(apptDateLocale(), {month:'short',day:'numeric',year:'numeric'});

        var wq = SB.from('appointments').select('*')
            .gte('date', d2iso(days[0])).lte('date', d2iso(days[6]))
            .order('start_time', {ascending: true});
        wq = applyApptModuleClinicQuery(wq);
        wq.then(function (r) {
            appts = r.data || [];
            mergeScheduleLockedLocal(appts);
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
                '<button class="gcal-settings-btn" title="' + esc(tr('appt.cal.settingsBtnTitle')) + '" onclick="GCAL.toggleSettings()">⚙</button>' +
                '<button class="gcal-settings-btn" title="' + esc(tr('appt.cal.miniCalBtnTitle')) + '" onclick="GCAL.toggleMiniCal()">📅</button>' +
            '</div>';
        head.appendChild(gh);

        days.forEach(function (d) {
            var iso  = d2iso(d);
            var isTo = iso === todayStr;
            var dh   = document.createElement('div');
            dh.className   = 'gcal-day-hdr' + (isTo ? ' gcal-today' : '');
            dh.dataset.date = iso;
            dh.innerHTML   =
                d.toLocaleDateString(apptDateLocale(), {weekday:'short'}) +
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
        var locked       = isApptScheduleLocked(a);

        var headName = chineseName || a.patient_name || (isWalkIn ? tr('appt.cal.cardWalkin') : '—');
        var lockTitle = locked ? tr('appt.cal.lockUnlockTitle') : tr('appt.cal.lockPinTitle');
        var lockAria = locked ? tr('appt.cal.lockAriaUnlock') : tr('appt.cal.lockAriaLock');
        var html =
            '<button type="button" class="gcal-card-lock' + (locked ? ' locked' : '') + '" ' +
                'title="' + esc(lockTitle) + '" ' +
                'aria-label="' + esc(lockAria) + '">' +
                (locked ? '🔒' : '🔓') +
            '</button>' +
            '<span class="card-headline">' +
                (isWalkIn ? '<span class="card-new-badge">' + esc(tr('appt.badge.newWalkin')) + '</span>' : '') +
                '<span class="card-chinese">' + esc(headName) + '</span>' +
                (a.patient_no
                    ? '<span class="card-pno">#' + esc(a.patient_no) + '</span>'
                    : '') +
            '</span>' +
            '<span class="card-time">' + esc(fmt12(a.start_time) + ' - ' + fmt12(a.end_time)) + '</span>';
        if (chineseName && a.patient_name) {
            html += '<span class="card-name">' + esc(a.patient_name) + '</span>';
        }
        if (a.treatment_items)
            html += '<span class="card-sub" style="font-weight:600;">' + esc(a.treatment_items) + '</span>';
        if (dr && height >= S.slotH * 2)
            html += '<span class="card-dr" style="color:' + color + ';">● ' + esc(dr) + '</span>';
        if (a.remarks && height >= S.slotH * 2)
            html += '<span class="card-sub" style="font-style:italic;opacity:.7;">' +
                formatRemarksForDisplay(a.remarks, { stripDr: true }) + '</span>';
        card.innerHTML = html;
        if (locked) card.classList.add('gcal-card-locked');

        var lockBtn = card.querySelector('.gcal-card-lock');
        if (lockBtn) {
            lockBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
                var next = !isApptScheduleLocked(a);
                persistApptScheduleLock(a, next);
            });
        }

        card.addEventListener('click', function (e) {
            if (Date.now() < suppressCardClickUntil) return;
            if (e.target.closest && e.target.closest('.gcal-card-lock')) return;
            if (e.target.closest && e.target.closest('.gcal-card-resize-handle')) return;
            e.stopPropagation();
            showApptPopup(a, card);
        });
        attachDrag(card, a);
        attachResize(card, a);
        return card;
    }

    // ── Drag & Drop (supports cross-day) ────────────────────────
    function attachDrag(card, appt) {
        card.addEventListener('mousedown', function (e) {
            if (dragState) return;
            if (typeof window.PointerEvent !== 'undefined') return;
            if (e.button !== 0) return;
            if (e.target.closest && e.target.closest('.gcal-card-lock')) return;
            if (e.target.closest && e.target.closest('.gcal-card-resize-handle')) return;
            if (isApptScheduleLocked(appt)) return;
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
        card.addEventListener('pointerdown', function (e) {
            if (dragState) return;
            if (e.button !== undefined && e.button !== 0) return;
            if (e.target.closest && e.target.closest('.gcal-card-lock')) return;
            if (e.target.closest && e.target.closest('.gcal-card-resize-handle')) return;
            if (isApptScheduleLocked(appt)) return;
            e.preventDefault(); e.stopPropagation();

            var cr = card.getBoundingClientRect();

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

            if (card.setPointerCapture && e.pointerId != null) {
                try { card.setPointerCapture(e.pointerId); } catch (_) {}
            }
            document.addEventListener('pointermove', onDragMove);
            document.addEventListener('pointerup',   onDragEnd);
        });
    }

    function setCardTimeInfo(card, startT, endT) {
        if (!card) return;
        var timeEl = card.querySelector('.card-time');
        var text = fmt12(startT) + ' - ' + fmt12(endT);
        if (timeEl) timeEl.textContent = text;
    }

    function attachResize(card, appt) {
        function ensureHandle(cls, mode) {
            var h = card.querySelector('.' + cls);
            if (!h) {
                h = document.createElement('div');
                h.className = 'gcal-card-resize-handle ' + cls;
                h.title = tr('appt.cal.resizeHint');
                h.setAttribute('aria-label', tr('appt.cal.resizeHint'));
                h.dataset.mode = mode;
                card.appendChild(h);
            }
            return h;
        }
        var bottomHandle = ensureHandle('gcal-card-resize-bottom', 'bottom');
        var topHandle = ensureHandle('gcal-card-resize-top', 'top');

        function onResizeStart(e) {
            if (resizeState) return;
            if (e.type === 'mousedown' && typeof window.PointerEvent !== 'undefined') return;
            if (e.button !== undefined && e.button !== 0) return;
            if (isApptScheduleLocked(appt)) return;
            e.preventDefault();
            e.stopPropagation();
            suppressCardClickUntil = Date.now() + 450;
            var origH = parseInt(card.style.height, 10) || card.getBoundingClientRect().height || S.slotH;
            var origTop = parseInt(card.style.top, 10) || 0;
            resizeState = {
                mode: (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode) || 'bottom',
                appt: appt,
                card: card,
                startY: e.clientY,
                origH: origH,
                origTop: origTop,
                origStart: appt.start_time,
                origEnd: appt.end_time,
                curStart: appt.start_time,
                curEnd: appt.end_time
            };
            card.classList.add('resizing');
            if (e.currentTarget && e.currentTarget.setPointerCapture && e.pointerId != null) {
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
            }
            document.addEventListener('mousemove', onResizeMove);
            document.addEventListener('mouseup', onResizeEnd);
            document.addEventListener('pointermove', onResizeMove);
            document.addEventListener('pointerup', onResizeEnd);
        }
        bottomHandle.addEventListener('mousedown', onResizeStart);
        topHandle.addEventListener('mousedown', onResizeStart);
        bottomHandle.addEventListener('pointerdown', onResizeStart);
        topHandle.addEventListener('pointerdown', onResizeStart);
    }

    function onResizeMove(e) {
        if (!resizeState) return;
        var rs = resizeState;
        var delta = e.clientY - rs.startY;
        var minH = S.slotH;
        if (rs.mode === 'top') {
            var endTopPx = rs.origTop + rs.origH;
            var newTop = rs.origTop + delta;
            var maxTop = endTopPx - minH;
            newTop = Math.max(0, Math.min(maxTop, newTop));
            var slotIdxTop = Math.round(newTop / S.slotH);
            var snappedTop = slotIdxTop * S.slotH;
            if (snappedTop > maxTop) snappedTop = Math.floor(maxTop / S.slotH) * S.slotH;
            snappedTop = Math.max(0, snappedTop);
            var snappedHFromTop = Math.max(minH, endTopPx - snappedTop);
            var startMin = S.startHour * 60 + slotIdxTop * S.interval;
            var endMinFixed = timeToMin(rs.origEnd);
            if (startMin >= endMinFixed) {
                startMin = Math.max(S.startHour * 60, endMinFixed - S.interval);
                snappedTop = Math.max(0, Math.round((startMin - S.startHour * 60) / S.interval) * S.slotH);
                snappedHFromTop = Math.max(minH, endTopPx - snappedTop);
            }
            rs.curStart = minToTimeStr(startMin);
            rs.curEnd = rs.origEnd;
            rs.card.style.top = snappedTop + 'px';
            rs.card.style.height = snappedHFromTop + 'px';
            setCardTimeInfo(rs.card, rs.curStart, rs.curEnd);
            return;
        }

        var newH = rs.origH + delta;
        var minH = S.slotH;
        var maxH = Math.max(minH, totalH() - (parseInt(rs.card.style.top, 10) || 0));
        newH = Math.max(minH, Math.min(maxH, newH));
        var slotCount = Math.max(1, Math.round(newH / S.slotH));
        var snappedH = Math.max(minH, Math.min(maxH, slotCount * S.slotH));

        var startMin = timeToMin(rs.origStart);
        var maxEnd = S.endHour * 60;
        var endMin = Math.min(maxEnd, startMin + slotCount * S.interval);
        if (endMin <= startMin) endMin = Math.min(maxEnd, startMin + S.interval);
        rs.curStart = rs.origStart;
        rs.curEnd = minToTimeStr(endMin);

        rs.card.style.height = snappedH + 'px';
        setCardTimeInfo(rs.card, rs.curStart, rs.curEnd);
    }

    function onResizeEnd(e) {
        if (!resizeState) return;
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', onResizeEnd);
        document.removeEventListener('pointermove', onResizeMove);
        document.removeEventListener('pointerup', onResizeEnd);
        var rs = resizeState;
        resizeState = null;
        rs.card.classList.remove('resizing');

        if (isApptScheduleLocked(rs.appt)) {
            rs.card.style.top = rs.origTop + 'px';
            rs.card.style.height = rs.origH + 'px';
            setCardTimeInfo(rs.card, rs.origStart, rs.origEnd);
            return;
        }
        var startChanged = rs.curStart !== rs.origStart;
        var endChanged = rs.curEnd !== rs.origEnd;
        if (!startChanged && !endChanged) return;

        var prevStart = rs.origStart;
        var prevEnd = rs.origEnd;
        SB.from('appointments')
            .update({ start_time: rs.curStart, end_time: rs.curEnd })
            .eq('id', rs.appt.id)
            .then(function(r) {
                if (r.error) {
                    rs.card.style.top = rs.origTop + 'px';
                    rs.card.style.height = rs.origH + 'px';
                    setCardTimeInfo(rs.card, prevStart, prevEnd);
                    alert(trRepl('appt.cal.couldReschedule', { MSG: r.error.message }));
                    return;
                }
                rs.appt.start_time = rs.curStart;
                rs.appt.end_time = rs.curEnd;
                setCardTimeInfo(rs.card, rs.curStart, rs.curEnd);
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
        document.removeEventListener('pointermove', onDragMove);
        document.removeEventListener('pointerup',   onDragEnd);

        var ds = dragState;
        dragState = null;

        _clearDragGhost(ds.ghostCol);
        if (ds.proxy && ds.proxy.parentNode) ds.proxy.parentNode.removeChild(ds.proxy);
        ds.card.style.opacity = '';

        if (isApptScheduleLocked(ds.appt)) return;

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

        SB.from('appointments').update(update).eq('id', ds.appt.id)
        .then(function (r) {
            if (r.error) {
                alert(trRepl('appt.cal.couldReschedule', { MSG: r.error.message }));
                if (origColEl) { origColEl.appendChild(ds.card); ds.card.style.top = ds.origTop + 'px'; }
            } else {
                ds.appt.date       = ds.curDate;
                ds.appt.start_time = ds.curTime;
                ds.appt.end_time   = newE;
                if (typeof syncApptPlannerDate === 'function') {
                    syncApptPlannerDate(ds.curDate, { syncCal: true });
                }
                if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
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
        line.style.pointerEvents = 'none';
        line.style.zIndex = '1';
        line.setAttribute('aria-hidden', 'true');
        var firstCard = col.querySelector('.gcal-card');
        if (firstCard) col.insertBefore(line, firstCard);
        else col.appendChild(line);
    }

    function isInteractionActive() {
        return !!(dragState || resizeState);
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

    function wireGcalDrColorPanel() {
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.wireColorPanel) {
            setTimeout(function () {
                var box = document.getElementById('gcalDrColorsBox');
                if (box) {
                    box._calColorPanelWired = false;
                    CalDoctorColors.wireColorPanel(box);
                }
            }, 0);
        }
    }

    function fillSettingsPanel(p) {
        if (!p) return;

        var mkOpts = function (arr, cur) {
            return arr.map(function (o) {
                return '<option value="'+o.v+'"'+(cur===o.v?' selected':'')+'>'+esc(o.l)+'</option>';
            }).join('');
        };

        var intOpts = mkOpts([10, 15, 20, 30, 60].map(function (v) {
            return { v: v, l: trRepl('appt.cal.intervalMin', { N: v }) };
        }), S.interval);
        var startOpts = '';
        var endOpts   = '';
        for (var h = 0; h < 24; h++) {
            var hStr = pad(h)+':00';
            startOpts += '<option value="'+h+'"'+(S.startHour===h?' selected':'')+'>'+hStr+'</option>';
            endOpts   += '<option value="'+h+'"'+(S.endHour===h?' selected':'')+'>'+hStr+'</option>';
        }
        var sHOpts = mkOpts([
            {v:16, l: tr('appt.cal.slotCompact')},
            {v:20, l: tr('appt.cal.slotNormal')},
            {v:24, l: tr('appt.cal.slotComfortable')},
            {v:32, l: tr('appt.cal.slotSpacious')}
        ], S.slotH);

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
            drRows = '<p style="color:#aaa;font-size:11px;margin:0;">' + esc(tr('appt.cal.noDoctorsHint')) + '</p>';

        p.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
                '<strong style="font-size:13px;color:#1e293b;">' + esc(tr('appt.cal.settingsTitle')) + '</strong>' +
                '<button onclick="GCAL.toggleSettings()" style="background:none;border:none;cursor:pointer;font-size:18px;color:#94a3b8;line-height:1;padding:2px 6px;">×</button>' +
            '</div>' +
            '<label>' + esc(tr('appt.cal.timeInterval')) + '</label>' +
            '<select id="gcalInterval" style="margin-bottom:12px;">'+intOpts+'</select>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">' +
                '<div><label>' + esc(tr('appt.cal.startTimeLabel')) + '</label><select id="gcalStart">'+startOpts+'</select></div>' +
                '<div><label>' + esc(tr('appt.cal.endTimeLabel')) + '</label><select id="gcalEnd">'+endOpts+'</select></div>' +
            '</div>' +
            '<label>' + esc(tr('appt.cal.rowHeight')) + '</label>' +
            '<select id="gcalSlotH" style="margin-bottom:14px;">'+sHOpts+'</select>' +
            '<label style="margin-bottom:8px;">' + esc(tr('appt.cal.drColoursLabel')) + '</label>' +
            '<p style="font-size:11px;color:#64748b;margin:0 0 10px;line-height:1.4;">' + esc(tr('appt.cal.drColoursHint')) + '</p>' +
            '<div id="gcalDrColorsBox">' + drRows + '</div>' +
            '<button onclick="GCAL.applySettings()" ' +
            'style="margin-top:14px;width:100%;padding:10px;background:#0084ff;color:#fff;' +
            'border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">' +
            esc(tr('appt.cal.applyRefresh')) + '</button>';
        wireGcalDrColorPanel();
    }

    function buildSettingsPanel() {
        var p = document.createElement('div');
        p.id = 'gcalSettingsPanel';
        fillSettingsPanel(p);
        return p;
    }

    function refreshGcalGutterTitles() {
        var btns = document.querySelectorAll('.gcal-gutter-hdr .gcal-settings-btn');
        if (!btns.length) return;
        if (btns[0]) btns[0].title = tr('appt.cal.settingsBtnTitle');
        if (btns[1]) btns[1].title = tr('appt.cal.miniCalBtnTitle');
    }

    function captureGcalPanelState() {
        var sp = document.getElementById('gcalSettingsPanel');
        var mp = document.getElementById('gcalMiniCal');
        var st = {
            settingsOpen: !!(sp && sp.classList.contains('open')),
            miniOpen: !!(mp && mp.classList.contains('open'))
        };
        if (st.settingsOpen) {
            var iEl = document.getElementById('gcalInterval');
            var sEl = document.getElementById('gcalStart');
            var eEl = document.getElementById('gcalEnd');
            var hEl = document.getElementById('gcalSlotH');
            st.interval = iEl ? parseInt(iEl.value, 10) : S.interval;
            st.startHour = sEl ? parseInt(sEl.value, 10) : S.startHour;
            st.endHour = eEl ? parseInt(eEl.value, 10) : S.endHour;
            st.slotH = hEl ? parseInt(hEl.value, 10) : S.slotH;
            st.colors = {};
            document.querySelectorAll('#gcalDrColorsBox .gcal-dr-color-inp').forEach(function (inp) {
                var dk = inp.dataset.key;
                try { dk = decodeURIComponent(dk); } catch (e) {}
                st.colors[dk] = inp.value;
            });
        }
        return st;
    }

    function restoreGcalPanelState(st) {
        if (!st) return;
        var sp = document.getElementById('gcalSettingsPanel');
        var mp = document.getElementById('gcalMiniCal');
        if (st.settingsOpen && sp) {
            fillSettingsPanel(sp);
            var iEl = document.getElementById('gcalInterval');
            var sEl = document.getElementById('gcalStart');
            var eEl = document.getElementById('gcalEnd');
            var hEl = document.getElementById('gcalSlotH');
            if (iEl && st.interval != null) iEl.value = String(st.interval);
            if (sEl && st.startHour != null) sEl.value = String(st.startHour);
            if (eEl && st.endHour != null) eEl.value = String(st.endHour);
            if (hEl && st.slotH != null) hEl.value = String(st.slotH);
            if (st.colors) {
                document.querySelectorAll('#gcalDrColorsBox .gcal-dr-color-inp').forEach(function (inp) {
                    var dk = inp.dataset.key;
                    try { dk = decodeURIComponent(dk); } catch (e) {}
                    if (st.colors[dk]) inp.value = st.colors[dk];
                });
            }
            sp.classList.add('open');
        }
        if (st.miniOpen && mp) {
            _renderMiniCalContent(mp);
            mp.classList.add('open');
        }
        refreshGcalGutterTitles();
    }

    function refreshGcalPanelsI18n() {
        var sp = document.getElementById('gcalSettingsPanel');
        var mp = document.getElementById('gcalMiniCal');
        if (!sp && !mp) return;
        var st = captureGcalPanelState();
        if (st.settingsOpen && sp) {
            fillSettingsPanel(sp);
            restoreGcalPanelState(st);
        } else if (st.miniOpen && mp) {
            _renderMiniCalContent(mp);
            mp.classList.add('open');
            refreshGcalGutterTitles();
        } else {
            refreshGcalGutterTitles();
        }
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
        if (S.endHour <= S.startHour) { alert(tr('appt.cal.endAfterStart')); return; }
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

        var monthLabel  = new Date(y, mo, 1).toLocaleDateString(apptDateLocale(), {month:'long', year:'numeric'});
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

        apptCalWeekdayHeaders().forEach(function (lbl) {
            html += '<div style="font-size:9px;font-weight:700;color:#94a3b8;padding:2px 0;">' + esc(lbl.charAt(0)) + '</div>';
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
            esc(tr('appt.cal.jumpToday')) + '</button>';

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
        if (typeof syncApptPlannerDate === 'function') {
            syncApptPlannerDate(isoStr, { syncCal: false });
        }
        var p = document.getElementById('gcalMiniCal');
        if (p) p.classList.remove('open');
        renderCal();
    }

    function goToday() {
        var n = new Date();
        calDate = makeLocalDate(n.getFullYear(), n.getMonth(), n.getDate());
        miniCalDate = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
        if (typeof syncApptPlannerDate === 'function') {
            syncApptPlannerDate(todayISO(), { syncCal: false });
        }
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
        render:                 render,
        toggleSettings:         toggleSettings,
        openDoctorColors:       openDoctorColors,
        applySettings:          applySettings,
        toggleMiniCal:          toggleMiniCal,
        miniCalPrev:            miniCalPrev,
        miniCalNext:            miniCalNext,
        jumpToDate:             jumpToDate,
        goToday:                goToday,
        isInteractionActive:    isInteractionActive,
        captureGcalPanelState:  captureGcalPanelState,
        restoreGcalPanelState:  restoreGcalPanelState,
        refreshGcalPanelsI18n:  refreshGcalPanelsI18n
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
var _dayPanelCtx = null;

function showDayPanel(iso, map) {
    var panel = g('dayPanel');
    var title = g('dayPanelTitle');
    var list  = g('dayPanelList');
    if (!panel) return;

    if (typeof syncApptPlannerDate === 'function') {
        syncApptPlannerDate(iso, { syncCal: false });
    }

    title.textContent = fmtDateLong(iso);
    var items = map[iso] || [];
    _dayPanelCtx = { iso: iso, items: items.slice() };
    if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts) {
        items = CalDoctorColors.filterAppts(items);
    }

    if (!items.length) {
        list.innerHTML =
            '<p style="color:#aaa;font-size:13px;margin:0;">' +
            esc(tr('appt.cal.noApptsDay')) + '</p>';
    } else {
        list.innerHTML = '';
        items.forEach(function(a) {
            var div = document.createElement('div');
            div.className = 'day-panel-item';
            div.dataset.apptId = a.id;
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
                    esc(dispStatusLabel(a.bill_status || 'Scheduled')) +
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
var _apptPopupCtx = null;

function refreshApptPopupI18n() {
    if (!_apptPopupCtx || !_apptPopupCtx.appt) return;
    var pop = g('apptPopup');
    if (!pop) return;
    if (typeof applyI18nInRoot === 'function') applyI18nInRoot(pop);
    var aid = _apptPopupCtx.appt.id;
    var anchor = document.querySelector('.gcal-card[data-id="' + aid + '"]') ||
        document.querySelector('.day-panel-item[data-appt-id="' + aid + '"]') ||
        document.querySelector('.appt-pill[data-id="' + aid + '"]') ||
        document.querySelector('.gcal-month-pill[data-id="' + aid + '"]');
    if (!anchor) anchor = _apptPopupCtx.anchor;
    if (anchor) showApptPopup(_apptPopupCtx.appt, anchor);
}

function showApptPopup(a, anchor) {
    var pop     = g('apptPopup');
    var content = g('apptPopupContent');
    if (!pop) return;
    _apptPopupCtx = { appt: a, anchor: anchor };

    var locked = isApptScheduleLocked(a);
    var lockBanner = locked
        ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;' +
          'padding:5px 8px;margin-bottom:8px;font-size:11px;color:#92400e;font-weight:600;">' +
          esc(tr('appt.cal.popupLocked')) + '</div>'
        : '';

    var walkInBanner = !a.patient_id
        ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;' +
          'padding:5px 8px;margin-bottom:8px;font-size:11px;color:#92400e;font-weight:600;">' +
          esc(tr('appt.cal.popupWalkin')) + '</div>'
        : '';

    var chineseRow = a.patient_chinese_name
        ? '<tr><td style="color:#888;padding:3px 8px 3px 0;white-space:nowrap;"></td>' +
          '<td style="font-family:\'PingFang HK\',\'Microsoft JhengHei\',sans-serif;' +
          'font-size:16px;font-weight:900;letter-spacing:0.5px;-webkit-font-smoothing:antialiased;">' +
          esc(a.patient_chinese_name) + '</td></tr>'
        : '';

    content.innerHTML =
        lockBanner +
        walkInBanner +
        '<table style="font-size:13px;width:100%;' +
        'border-collapse:collapse;">' +
            chineseRow +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;' +
            'white-space:nowrap;">' + esc(tr('appt.cal.popupPatient')) + '</td>' +
            '<td><strong>' + esc(a.patient_name || '-') +
            '</strong></td></tr>' +
            (!a.patient_id ? '' :
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">' + esc(tr('appt.cal.popupNo')) + '</td>' +
            '<td>' + esc(a.patient_no || '-') + '</td></tr>') +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">' + esc(tr('appt.cal.popupDate')) + '</td>' +
            '<td>' + fmtDateLong(a.date) + '</td></tr>' +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">' + esc(tr('appt.cal.popupTime')) + '</td>' +
            '<td>' + fmt12(a.start_time) +
            ' – ' + fmt12(a.end_time) + '</td></tr>' +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">' +
            esc(tr('appt.cal.popupTreatment')) + '</td>' +
            '<td>' + esc(a.treatment_items || '-') + '</td></tr>' +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">' + esc(tr('appt.cal.popupStatus')) + '</td>' +
            '<td><span class="status-badge ' +
                statusClass(a.bill_status) + '">' +
                esc(dispStatusLabel(a.bill_status || 'Scheduled')) +
            '</span></td></tr>' +
            (a.remarks
                ? '<tr><td style="color:#888;padding:3px 8px 3px 0;">' +
                  esc(tr('appt.cal.popupRemarks')) + '</td><td>' + formatRemarksForDisplay(a.remarks, { stripDr: true }) +
                  '</td></tr>'
                : '') +
        '</table>' +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">' +
            '<button id="popEditBtn" ' +
            'style="flex:1;min-width:72px;padding:7px;background:var(--primary);' +
            'color:white;border:none;border-radius:5px;' +
            'cursor:pointer;font-weight:600;">' + esc(tr('appt.cal.popupEdit')) + '</button>' +
            (calView === 'weekly'
                ? '<button id="popLockBtn" ' +
                  'style="flex:0 0 auto;padding:7px 10px;background:#fff;' +
                  'color:#92400e;border:1px solid #fde68a;border-radius:5px;' +
                  'cursor:pointer;font-weight:600;">' +
                  esc(locked ? tr('appt.cal.popupUnlock') : tr('appt.cal.popupLock')) +
                  '</button>'
                : '') +
            (a.bill_status !== 'Queue' && a.bill_status !== 'Done'
                ? '<button id="popCheckinBtn" ' +
                  'style="flex:1;min-width:72px;padding:7px;background:var(--success);' +
                  'color:white;border:none;border-radius:5px;' +
                  'cursor:pointer;font-weight:600;">' + esc(tr('appt.cal.popupCheckIn')) + '</button>'
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

    var plb = g('popLockBtn');
    if (plb) {
        plb.addEventListener('click', function() {
            var next = !isApptScheduleLocked(a);
            persistApptScheduleLock(a, next, function (ok) {
                if (!ok) return;
                showApptPopup(a, anchor);
            });
        });
    }
}

// ════════════════════════════════════════════════════════════════
// BILL PANEL
// ════════════════════════════════════════════════════════════════
function wireBillPanelControls() {
    function bindClickOnce(id, fn) {
        var el = g(id);
        if (!el || el.dataset.billClickBound === '1' || typeof fn !== 'function') return;
        el.dataset.billClickBound = '1';
        el.addEventListener('click', fn);
    }

    bindClickOnce('billPanelClose', closeBillPanel);
    bindClickOnce('addBillItemBtn', addBillItem);
    bindClickOnce('saveBillBtn', function() { saveBill(false); });
    bindClickOnce('savePrintBillBtn', function() { saveBill(true); });
    bindClickOnce('closeReceiptModal', function() { closeModal('receiptModal'); });
    bindClickOnce('closeReceiptModal2', function() { closeModal('receiptModal'); });
    bindClickOnce('bdAddPaymentBtn', openAddPaymentModal);
    bindClickOnce('billPendingRefreshBtn', refreshBillPanelNow);
    bindClickOnce('billPayAllBtn', billPayAllAmount);

    var discEl = g('bDiscount');
    if (discEl && discEl.dataset.billInputBound !== '1') {
        discEl.dataset.billInputBound = '1';
        discEl.addEventListener('input', recalcTotals);
    }
    var paidEl = g('bAmtPaid');
    if (paidEl && paidEl.dataset.billInputBound !== '1') {
        paidEl.dataset.billInputBound = '1';
        paidEl.addEventListener('input', recalcBalance);
    }
}

function billPanelIsOpen() {
    var panel = g('billPanel');
    return !!(panel && panel.classList.contains('open'));
}

function billStep2IsVisible() {
    var step2 = g('billStep2');
    return !!(step2 && step2.style.display !== 'none');
}

function renderBillPendingRefreshMeta() {
    var meta = g('billPendingRefreshMeta');
    if (!meta) return;
    if (billPendingRefreshState === 'loading') {
        meta.textContent = tr('bill.refresh.loading');
        return;
    }
    if (billPendingLastRefreshAt) {
        var t = billPendingLastRefreshAt.toLocaleTimeString(apptDateLocale(), {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        meta.textContent = trRepl('bill.refresh.updatedAt', { T: t });
        return;
    }
    meta.textContent = tr('bill.refresh.never');
}

function noteBillPendingRefreshed() {
    billPendingRefreshBusy = false;
    billPendingRefreshState = 'updated';
    billPendingLastRefreshAt = new Date();
    renderBillPendingRefreshMeta();
}

function stopBillPendingAutoRefresh() {
    if (billPendingRefreshTimer) {
        clearInterval(billPendingRefreshTimer);
        billPendingRefreshTimer = null;
    }
}

function startBillPendingAutoRefresh() {
    stopBillPendingAutoRefresh();
}

function restartBillPendingAutoRefresh() {
    stopBillPendingAutoRefresh();
}

function fetchBillPendingRefreshIntervalMs(done) {
    var fallback = DEFAULT_BILL_PENDING_REFRESH_MS;
    if (!SB || typeof SB.from !== 'function') {
        if (done) done(fallback);
        return;
    }
    SB.from('program_settings')
        .select('setting_key,setting_value')
        .in('setting_key', ['bill_pending_refresh_interval'])
        .then(function(r) {
            var ms = fallback;
            if (!r.error && r.data && r.data.length) {
                var map = {};
                r.data.forEach(function(row) {
                    map[row.setting_key] = row.setting_value;
                });
                var n = parseInt(map.bill_pending_refresh_interval, 10);
                if (!isNaN(n) && n >= 10) ms = n * 1000;
            }
            if (done) done(ms);
        })
        .catch(function() {
            if (done) done(fallback);
        });
}

function refreshBillPanelLists(opts) {
    opts = opts || {};
    var manual = !!opts.manual;
    if (!billPanelIsOpen()) return;
    if (billPendingRefreshBusy) return;

    billPendingRefreshBusy = true;
    billPendingRefreshState = 'loading';
    renderBillPendingRefreshMeta();

    var done = function(ok) {
        if (ok === false) {
            billPendingRefreshBusy = false;
            billPendingRefreshState = 'idle';
            renderBillPendingRefreshMeta();
            return;
        }
        noteBillPendingRefreshed();
    };

    if (billStep2IsVisible()) {
        if (manual) loadBillHistory();
        renderStep2(done);
    } else {
        // Step 1: refresh saved bill history only — keep item picker / draft list intact
        loadBillHistory(done);
    }
}

function refreshBillPanelNow() {
    refreshBillPanelLists({ manual: true });
}

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
    billPendingRefreshBusy = false;
    billPendingRefreshState = 'idle';
    billPendingLastRefreshAt = null;
    renderBillPendingRefreshMeta();

    // Start on Step 1; load treatment item dropdown cache then pending lists
    switchBillTab(1);
    loadTreatmentItemsForBilling(function() {
        loadPendingLists(function(ok) {
            if (ok !== false) noteBillPendingRefreshed();
        });
    });
    loadBillHistory();

    wireBillPanelControls();
    startBillPendingAutoRefresh();
    g('billPanel').classList.add('open');
}

function closeBillPanel() {
    stopBillPendingAutoRefresh();
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
    if (n === 2) {
        renderStep2(function(ok) {
            if (ok !== false) noteBillPendingRefreshed();
        }, { resetForm: true });
    }
}

// ════════════════════════════════════════════════════════════════
// STEP 1 — PENDING BILL ITEM LISTS
// ════════════════════════════════════════════════════════════════
function loadPendingLists(cb) {
    var prevListId = null;
    var prevLabel = '';
    var prevLocalRef = null;
    syncPendingDraftFromInputs();
    if (pendingIdx >= 0 && pendingIdx < pendingLists.length) {
        prevListId = pendingLists[pendingIdx].id || null;
        prevLabel = pendingLists[pendingIdx].label || '';
        prevLocalRef = pendingLists[pendingIdx];
    }
    var preserveById = {};
    var localUnsaved = [];
    pendingLists.forEach(function(pl) {
        if (!pl) return;
        if (!pl.id) {
            localUnsaved.push(pl);
            return;
        }
        if (isPendingListDirty(pl)) preserveById[pl.id] = pl;
    });
    SB.from('pending_bill_items')
        .select('*')
        .eq('patient_id', billPatId)
        .eq('expires_on',  todayISO())
        .order('created_at', { ascending: true })
    .then(function(r) {
        var fetched = (!r.error && r.data) ? r.data : [];
        fetched.forEach(function(pl) {
            if (typeof pl.items === 'string') {
                try { pl.items = JSON.parse(pl.items); } catch(e) { pl.items = []; }
            }
            pl.items = pl.items || [];
        });
        var merged = fetched.map(function(pl) {
            if (pl.id && preserveById[pl.id]) return preserveById[pl.id];
            return pl;
        });
        Object.keys(preserveById).forEach(function(id) {
            var exists = fetched.some(function(pl) { return pl.id === id; });
            if (!exists) merged.push(preserveById[id]);
        });
        localUnsaved.forEach(function(pl) {
            merged.push(pl);
        });
        pendingLists = merged;
        fetched.forEach(function(pl) {
            if (pl && pl.id) pendingServerSnapshotById[pl.id] = pendingListSignature(pl);
        });
        if (!pendingLists.length) {
            pendingIdx = -1;
        } else if (prevListId) {
            var hitId = pendingLists.findIndex(function(pl) { return pl.id === prevListId; });
            pendingIdx = hitId >= 0 ? hitId : 0;
        } else if (prevLocalRef) {
            var hitRef = pendingLists.findIndex(function(pl) { return pl === prevLocalRef; });
            pendingIdx = hitRef >= 0 ? hitRef : 0;
        } else if (prevLabel) {
            var hitLabel = pendingLists.findIndex(function(pl) { return (pl.label || '') === prevLabel; });
            pendingIdx = hitLabel >= 0 ? hitLabel : 0;
        } else if (pendingIdx < 0 || pendingIdx >= pendingLists.length) {
            pendingIdx = 0;
        }
        renderStep1UI();
        if (cb) cb(!r.error);
    })
    .catch(function() {
        if (cb) cb(false);
    });
}

function renderStep1UI() {
    var hasLists = pendingLists.length > 0;
    g('pendingEmptyState').style.display  = hasLists ? 'none' : '';
    g('pendingActiveArea').style.display  = hasLists ? ''     : 'none';
    g('removePendingBtn').disabled        = !hasLists;
    g('pendingCounter').textContent       = hasLists
        ? trRepl('bill.pending.counterFmt', {
            CUR: String(pendingIdx + 1),
            TOTAL: String(pendingLists.length)
        })
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
        statusEl.textContent = pl.id ? tr('bill.status.saved') : tr('bill.status.notSaved');
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
    var label = trRepl('bill.list.defaultLabel', { N: String(pendingLists.length + 1) });
    pendingLists.push({ id: null, label: label, items: [], subtotal: 0 });
    pendingIdx = pendingLists.length - 1;
    billItems  = [{ desc: '', qty: 1, price: 0, disc: 0 }];
    renderStep1UI();
    var statusEl = g('pendingListStatus');
    if (statusEl) { statusEl.textContent = tr('bill.status.notSaved'); statusEl.style.color = '#f59e0b'; }
    if (g('pendingListLabel')) g('pendingListLabel').focus();
}

function saveCurrentPendingList() {
    if (!pendingLists.length || pendingIdx < 0) return;
    var pl    = pendingLists[pendingIdx];
    var label = (g('pendingListLabel').value || '').trim() || trRepl('bill.list.defaultLabel', { N: String(pendingIdx + 1) });
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
    if (statusEl) { statusEl.textContent = tr('bill.status.saving'); statusEl.style.color = '#888'; }

    var query = pl.id
        ? SB.from('pending_bill_items').update(payload).eq('id', pl.id)
        : SB.from('pending_bill_items').insert([payload]).select();

    query.then(function(r) {
        if (r.error) {
            if (statusEl) {
                statusEl.textContent = trRepl('bill.status.saveFailed', { MSG: r.error.message });
                statusEl.style.color = '#dc2626';
            }
            return;
        }
        if (!pl.id && r.data && r.data[0]) pl.id = r.data[0].id;
        g('removePendingBtn').disabled = false;
        var t = new Date().toLocaleTimeString(apptDateLocale(), { hour: '2-digit', minute: '2-digit' });
        if (statusEl) { statusEl.textContent = trRepl('bill.status.savedAt', { T: t }); statusEl.style.color = '#16a34a'; }
        if (pl.id) pendingServerSnapshotById[pl.id] = pendingListSignature(pl);
        noteBillPendingRefreshed();
    });
}

function removeCurrentPendingList() {
    if (!pendingLists.length || pendingIdx < 0) return;
    var pl = pendingLists[pendingIdx];
    if (!confirm(trRepl('bill.removeListConfirm', { LABEL: (pl.label || tr('bill.list.thisList')) }))) return;

    function doRemove() {
        pendingLists.splice(pendingIdx, 1);
        pendingIdx = pendingLists.length ? Math.max(0, pendingIdx - 1) : -1;
        billItems  = [];
        renderStep1UI();
    }

    if (pl.id) {
        SB.from('pending_bill_items').delete().eq('id', pl.id)
        .then(function(r) {
            if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
            delete pendingServerSnapshotById[pl.id];
            doRemove();
        });
    } else {
        doRemove();
    }
}

// ════════════════════════════════════════════════════════════════
// STEP 2 — PAYMENT (select a pending list, then pay)
// ════════════════════════════════════════════════════════════════
function renderStep2(cb, opts) {
    opts = opts || {};
    var resetForm = opts.resetForm === true;
    var prevType = g('bType') ? g('bType').value : '';
    var prevDoctor = g('bDoctor') ? g('bDoctor').value : '';
    var prevDiscount = g('bDiscount') ? g('bDiscount').value : '';
    var prevPaid = g('bAmtPaid') ? g('bAmtPaid').value : '';
    var prevNotes = g('bNotes') ? g('bNotes').value : '';
    var prevDate = g('bDate') ? g('bDate').value : '';
    var prevPendingId = resetForm ? null : payPendingId;

    loadBillTypes();
    loadBillDoctors();
    if (resetForm) {
        sv('bDate',     todayISO());
        sv('bDiscount', '0');
        sv('bAmtPaid',  '0');
        sv('bNotes',    '');
        payItems     = [];
        payPendingId = null;
    }
    g('payPreviewWrap').style.display   = 'none';
    if (resetForm) {
        g('bSubtotal').textContent = '0.00';
        g('bTotal').textContent    = '0.00';
        g('bBalance').textContent  = fmtHK(0);
    }

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
            if (cb) cb(!r.error);
            return;
        }
        noneEl.style.display = 'none';

        lists.forEach(function(pl) {
            var btn = document.createElement('button');
            btn.className = 'pending-list-card';
            btn.innerHTML =
                '<div style="font-weight:700;font-size:13px;">' + esc(pl.label || tr('bill.step2.cardListFallback')) + '</div>' +
                '<div style="font-size:11px;color:#888;margin-top:3px;">' +
                    fmtHKHtml(pl.subtotal) +
                    '&nbsp;·&nbsp;' + esc(trRepl('bill.step2.cardItems', { N: String(pl.items.length) })) +
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

        if (prevPendingId) {
            var picked = null;
            Array.prototype.forEach.call(cards.children, function(node, idx) {
                if (!picked && lists[idx] && lists[idx].id === prevPendingId) {
                    picked = node;
                }
            });
            if (picked) {
                picked.click();
            } else if (lists.length === 1) {
                cards.firstChild.click();
            } else {
                payItems = [];
                payPendingId = null;
                g('bSubtotal').textContent = '0.00';
                g('bTotal').textContent = '0.00';
                g('bBalance').textContent = fmtHK(0);
            }
        } else if (lists.length === 1) {
            cards.firstChild.click();
        } else if (payItems.length) {
            renderPayPreview();
            recalcTotals();
        } else {
            g('bBalance').textContent = fmtHK(0);
        }

        if (!resetForm) {
            if (prevDate) sv('bDate', prevDate);
            if (prevDiscount) sv('bDiscount', prevDiscount);
            if (prevPaid) sv('bAmtPaid', prevPaid);
            if (prevNotes) sv('bNotes', prevNotes);
            if (prevType && g('bType')) g('bType').value = prevType;
            if (prevDoctor && g('bDoctor')) g('bDoctor').value = prevDoctor;
            recalcTotals();
        }
        if (cb) cb(!r.error);
    })
    .catch(function() {
        if (cb) cb(false);
    });
}

function renderPayPreview() {
    var wrap = g('payPreviewWrap');
    var body = g('payPreviewBody');
    if (!wrap || !body) return;
    body.innerHTML = '';
    payItems.forEach(function(it, i) {
        var row = document.createElement('tr');
        var disc = parseFloat(it.disc) || 0;
        var amt  = billItemAmt(it);
        row.style.background = i % 2 === 0 ? '#fff' : '#f8faff';
        row.innerHTML =
            '<td style="padding:7px 12px;">' + esc(it.desc || '—') + '</td>' +
            '<td style="padding:7px 12px;text-align:center;">' + (it.qty || 0) + '</td>' +
            '<td style="padding:7px 12px;text-align:right;">' + fmt2(it.price) + '</td>' +
            '<td style="padding:7px 12px;text-align:center;color:' + (disc > 0 ? '#dc2626' : '#aaa') + ';">' +
                (disc > 0 ? disc + '%' : '—') +
            '</td>' +
            '<td style="padding:7px 12px;text-align:right;font-weight:600;">' + fmt2(amt) + '</td>';
        body.appendChild(row);
    });
    wrap.style.display = payItems.length ? '' : 'none';
}

function billDoctorLabel(d) {
    return d.doctor_code || d.display_name || d.english_name || d.chinese_name || tr('bill.doctorFallback');
}

function renderBillDoctorOptions(selectedId) {
    var sel = g('bDoctor');
    if (!sel) return;
    var docs = (billDoctorList || []).filter(function(d) { return d && d.is_active !== false; });
    if (!docs.length) {
        sel.innerHTML = '<option value="">' + esc(tr('bill.noDoctorsOption')) + '</option>';
        return;
    }
    var html = '<option value="">' + esc(tr('bill.selectDoctor')) + '</option>' +
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
    sel.innerHTML = '<option value="">' + esc(tr('bill.loadingDoctors')) + '</option>';

    var fromGlobal = (typeof APP_DOCTORS !== 'undefined' && Array.isArray(APP_DOCTORS))
        ? APP_DOCTORS.filter(function(d) { return d.is_active !== false; })
        : [];
    if (fromGlobal.length) {
        billDoctorList = fromGlobal.slice();
        renderBillDoctorOptions(defaultBillDoctorId());
        return;
    }

    if (typeof SB === 'undefined' || !SB || !SB.from) {
        sel.innerHTML = '<option value="">' + esc(tr('bill.supabaseNotReady')) + '</option>';
        return;
    }

    SB.from('doctors')
      .select('id,doctor_code,english_name,chinese_name,display_name,is_active')
      .eq('is_active', true)
      .order('doctor_code', {ascending: true})
    .then(function(r) {
        if (r.error) {
            sel.innerHTML = '<option value="">' + esc(tr('bill.loadDoctorsFailed')) + '</option>';
            return;
        }
        billDoctorList = r.data || [];
        renderBillDoctorOptions(defaultBillDoctorId());
    })
    .catch(function(e) {
        sel.innerHTML = '<option value="">' + esc(tr('bill.loadDoctorsFailed')) + '</option>';
        try { console.error('loadBillDoctors error', e); } catch (_) {}
    });
}

function addBillItem() {
    if (!pendingLists.length) {
        addNewPendingList();
    }
    billItems.push({ desc: '', qty: 1, price: 0, disc: 0 });
    syncBillItemsToPendingList();
    renderBillItems();
    recalcTotals();
}

function syncBillItemsToPendingList() {
    if (!pendingLists.length || pendingIdx < 0 || pendingIdx >= pendingLists.length) return;
    pendingLists[pendingIdx].items = billItems.map(function(it) {
        return { desc: it.desc, qty: it.qty, price: it.price, disc: it.disc || 0 };
    });
}

function pendingListSignature(pl) {
    var list = pl || {};
    var items = Array.isArray(list.items) ? list.items : [];
    var safeItems = items.map(function(it) {
        return {
            desc: it && it.desc ? String(it.desc) : '',
            qty: parseFloat(it && it.qty) || 0,
            price: parseFloat(it && it.price) || 0,
            disc: parseFloat(it && it.disc) || 0
        };
    });
    return JSON.stringify({
        label: list.label || '',
        subtotal: parseFloat(list.subtotal) || 0,
        items: safeItems
    });
}

function isPendingListDirty(pl) {
    if (!pl || !pl.id) return true;
    var snap = pendingServerSnapshotById[pl.id];
    if (!snap) return false;
    return pendingListSignature(pl) !== snap;
}

function syncPendingDraftFromInputs() {
    if (!pendingLists.length || pendingIdx < 0 || pendingIdx >= pendingLists.length) return;
    var pl = pendingLists[pendingIdx];
    if (!pl) return;
    var labelEl = g('pendingListLabel');
    if (labelEl) pl.label = (labelEl.value || '').trim();
    syncBillItemsToPendingList();
    pl.subtotal = billItems.reduce(function(a, it) {
        return a + ((parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0));
    }, 0);
}

function billItemAmt(it) {
    var gross = (parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0);
    var disc  = Math.min(100, Math.max(0, parseFloat(it.disc) || 0));
    return gross * (1 - disc / 100);
}

function renderBillItems() {
    var tb = g('billItemsBody');
    if (!tb) return;
    tb.innerHTML = '';
    billItems.forEach(function(item, i) {
        var row = document.createElement('tr');
        
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
                'placeholder="' + esc(tr('bill.phCustomDesc')) + '" ' +
                'style="width:100%;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:12px;box-sizing:border-box;' +
                'display:' + (item.desc && treatmentItemsCache.findIndex(function(t) { return t.item_name === item.desc; }) === -1 ? 'block' : 'none') + ';">';
        } else {
            // Fallback to simple text input if no items loaded
            descCell +=
                '<input type="text" id="bdesc-' + i + '" ' +
                'value="' + esc(item.desc) + '" ' +
                'placeholder="' + esc(tr('bill.phDescription')) + '" ' +
                'style="width:100%;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:13px;box-sizing:border-box;">';
        }
        descCell += '</div></td>';
        
        var discVal = item.disc !== undefined ? item.disc : 0;
        row.innerHTML = descCell +
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
                fmtHK(billItemAmt(item)) +
            '</td>' +
            '<td>' +
                '<button data-idx="' + i + '" class="bill-del-row" ' +
                'title="' + esc(tr('bill.btnRemoveRowTitle')) + '" ' +
                'aria-label="' + esc(tr('bill.btnRemoveRowTitle')) + '" ' +
                'style="background:none;border:none;color:var(--danger);' +
                'font-size:18px;cursor:pointer;line-height:1;">×</button>' +
            '</td>';
        tb.appendChild(row);

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
                        var amtEl = g('bamt-' + idx);
                        if (amtEl) amtEl.textContent = fmtHK(billItemAmt(billItems[idx]));
                        syncBillItemsToPendingList();
                        recalcTotals();
                    }
                });
            }
            
            // Handle custom input
            if (descCustom) {
                descCustom.addEventListener('input', function() {
                    billItems[idx].desc = this.value;
                    syncBillItemsToPendingList();
                });
            }
            
            // Handle simple input (fallback)
            if (descSimple) {
                descSimple.addEventListener('input', function() {
                    billItems[idx].desc = this.value;
                    syncBillItemsToPendingList();
                });
            }
            
            var qtyEl = g('bqty-' + idx);
            var priceEl = g('bprice-' + idx);
            var discEl = g('bdisc-' + idx);
            if (qtyEl) {
                qtyEl.addEventListener('input', function() {
                    billItems[idx].qty = parseFloat(this.value) || 1;
                    var amtEl = g('bamt-' + idx);
                    if (amtEl) amtEl.textContent = fmtHK(billItemAmt(billItems[idx]));
                    syncBillItemsToPendingList();
                    recalcTotals();
                });
            }
            if (priceEl) {
                priceEl.addEventListener('input', function() {
                    billItems[idx].price = parseFloat(this.value) || 0;
                    var amtEl = g('bamt-' + idx);
                    if (amtEl) amtEl.textContent = fmtHK(billItemAmt(billItems[idx]));
                    syncBillItemsToPendingList();
                    recalcTotals();
                });
            }
            if (discEl) {
                discEl.addEventListener('input', function() {
                    billItems[idx].disc = parseFloat(this.value) || 0;
                    var amtEl = g('bamt-' + idx);
                    if (amtEl) amtEl.textContent = fmtHK(billItemAmt(billItems[idx]));
                    syncBillItemsToPendingList();
                    recalcTotals();
                });
            }
        })(i);

        var delBtn = row.querySelector('.bill-del-row');
        if (delBtn) {
            delBtn.addEventListener('click', function() {
                billItems.splice(parseInt(this.dataset.idx, 10), 1);
                syncBillItemsToPendingList();
                renderBillItems();
                recalcTotals();
            });
        }
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
    g('bBalance').textContent  = fmtHK(balance);
    g('bBalance').style.color  =
        balance > 0 ? 'var(--danger)' : 'var(--success)';
}

function billPayAllAmount() {
    var total = parseFloat(g('bTotal').textContent) || 0;
    sv('bAmtPaid', fmt2(total));
    recalcBalance();
}

function saveBill(doPrint) {
    if (!payItems.length) { alert(tr('bill.alert.selectListFirst')); return; }

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
    var clinicIdForBill = currentClinicId || ((g('apptClinicSelect') && g('apptClinicSelect').value) ? g('apptClinicSelect').value : null);
    var clinicTagForBill = (typeof currentClinicCodeForTagging === 'function')
        ? currentClinicCodeForTagging()
        : '';
    if (!clinicTagForBill && clinicIdForBill && typeof clinicRecordFromId === 'function') {
        var rec = clinicRecordFromId(clinicIdForBill);
        if (rec) {
            clinicTagForBill = String(rec.clinic_code || '').trim() || String(rec.id || '').trim();
        }
    }
    payload.clinic_id = clinicIdForBill || null;
    payload.clinic_tag = clinicTagForBill || null;

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
            try { document.dispatchEvent(new CustomEvent('consultation-ar-refresh')); } catch (_) {}
            if (doPrint)  showReceipt(payload, r.data, null, true);
            if (!doPrint) alert(tr('bill.alert.savedOk'));
        });
    };

    function stripOptionalColsByError(src, errMsg) {
        var out = Object.assign({}, src);
        var msg = String(errMsg || '').toLowerCase();
        var mentionsDoctor = msg.indexOf('doctor_id') >= 0 ||
            msg.indexOf('doctor_name') >= 0 ||
            msg.indexOf('doctor_tag') >= 0;
        var mentionsClinic = msg.indexOf('clinic_id') >= 0 ||
            msg.indexOf('clinic_tag') >= 0;
        var touched = false;

        if (mentionsDoctor) {
            if (Object.prototype.hasOwnProperty.call(out, 'doctor_id')) { delete out.doctor_id; touched = true; }
            if (Object.prototype.hasOwnProperty.call(out, 'doctor_name')) { delete out.doctor_name; touched = true; }
            if (Object.prototype.hasOwnProperty.call(out, 'doctor_tag')) { delete out.doctor_tag; touched = true; }
        }
        if (mentionsClinic) {
            if (Object.prototype.hasOwnProperty.call(out, 'clinic_id')) { delete out.clinic_id; touched = true; }
            if (Object.prototype.hasOwnProperty.call(out, 'clinic_tag')) { delete out.clinic_tag; touched = true; }
        }

        return { payload: out, changed: touched };
    }

    function attemptLegacyInsert(msgFromError, basePayload) {
        var stripped = stripOptionalColsByError(basePayload, msgFromError);
        if (!stripped.changed) {
            alert(trRepl('appt.msg.error', { MSG: msgFromError }));
            return;
        }
        SB.from('bills').insert([stripped.payload])
        .then(function(r2) {
            if (!r2.error) { finishAfterSaved(r2); return; }
            var strippedAgain = stripOptionalColsByError(stripped.payload, r2.error.message);
            if (!strippedAgain.changed) {
                alert(trRepl('appt.msg.error', { MSG: r2.error.message }));
                return;
            }
            SB.from('bills').insert([strippedAgain.payload])
            .then(function(r3) {
                if (r3.error) { alert(trRepl('appt.msg.error', { MSG: r3.error.message })); return; }
                finishAfterSaved(r3);
            });
        });
    }

    SB.from('bills').insert([payload])
    .then(function(r) {
        if (!r.error) { finishAfterSaved(r); return; }
        attemptLegacyInsert(r.error.message, payload);
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
    var html = '<option value="">' + esc(tr('bill.treatSelectCustom')) + '</option>';
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
            o.value = v;
            o.textContent = (typeof dispPayMethod === 'function') ? dispPayMethod(v) : v;
            sel.appendChild(o);
        });
        return;
    }
    var defaultFound = false;
    list.forEach(function(bt) {
        var opt = document.createElement('option');
        opt.value = bt.name || bt.type_code;
        opt.textContent = (typeof dispPayMethod === 'function')
            ? dispPayMethod(opt.value)
            : (bt.name || bt.type_code);
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

function refreshBillPaymentSelectLabels() {
    var bType = g('bType');
    if (bType && bType.options.length) {
        var prevType = bType.value;
        applyBillTypeOptions(bType, false);
        if (prevType) bType.value = prevType;
    }
    var apSel = g('apMethod');
    if (apSel && apSel.options.length) {
        var prevAp = apSel.value;
        applyBillTypeOptions(apSel, false);
        if (prevAp) apSel.value = prevAp;
    }
}

function loadBillTypes() {
    var sel = g('bType');
    if (!sel) return;
    sel.innerHTML = '<option value="">' + esc(tr('bill.loadingTypes')) + '</option>';

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
function loadBillHistory(cb) {
    var wrap  = g('billHistoryList');
    var patId = billPatId;
    var patNo = billPatNo;
    var apptFallback = billApptId;

    var hasPatient = !!patId;
    var hasPatNoFallback = !!(patNo && patNo !== '-');

    if (!hasPatient && !hasPatNoFallback && !apptFallback) {
        wrap.innerHTML = '<p style="color:#aaa;font-size:14px;">' + esc(tr('bill.historyEmpty')) + '</p>';
        if (cb) cb(true);
        return;
    }
    wrap.innerHTML = '<p style="color:#aaa;font-size:13px;">' + esc(tr('bill.historyLoading')) + '</p>';

    function renderHistory(r) {
        if (r.error) {
            wrap.innerHTML =
                '<p style="color:#e11d48;font-size:13px;">⚠️ ' + esc(r.error.message) + '</p>';
            if (cb) cb(false);
            return;
        }
        if (!r.data || !r.data.length) {
            wrap.innerHTML = '<p style="color:#aaa;font-size:14px;">' + esc(tr('bill.historyEmpty')) + '</p>';
            if (cb) cb(true);
            return;
        }
        renderBillHistoryRows(wrap, r.data);
        if (cb) cb(true);
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
                .then(renderHistory)
                .catch(function() {
                    if (cb) cb(false);
                });
                return;
            }
            renderHistory(r);
        })
        .catch(function() {
            if (cb) cb(false);
        });
        return;
    }

    if (hasPatNoFallback) {
        SB.from('bills').select('*')
            .eq('patient_no', patNo)
            .order('created_at', { ascending: false })
        .then(renderHistory)
        .catch(function() {
            if (cb) cb(false);
        });
        return;
    }

    // Rare: queued row missing patient linkage — still show bills for this visit only
    SB.from('bills').select('*')
        .eq('appointment_id', apptFallback)
        .order('created_at', { ascending: false })
    .then(renderHistory)
    .catch(function() {
        if (cb) cb(false);
    });
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
                        fmtHK(b.total) +
                    '</strong>' +
                    '<div style="display:flex;align-items:center;gap:8px;">' +
                        '<span class="status-badge ' +
                            statusClass(b.status) + '">' +
                            esc(dispStatusLabel(b.status)) +
                        '</span>' +
                        '<button class="bd-detail-btn btn-sm" ' +
                        'style="background:var(--primary);color:#fff;' +
                        'border:none;padding:3px 11px;border-radius:5px;' +
                        'font-size:12px;cursor:pointer;">' + esc(tr('bill.history.btnDetail')) + '</button>' +
                        (isPartial
                            ? '<button class="bd-pay-btn btn-sm" ' +
                              'style="background:#16a34a;color:#fff;border:none;' +
                              'padding:3px 11px;border-radius:5px;font-size:12px;' +
                              'cursor:pointer;font-weight:700;">' + esc(tr('bill.history.btnPay')) + '</button>'
                            : '') +
                        '<button class="bd-del-btn btn-sm" ' +
                        (isAdmin
                            ? 'style="background:#dc2626;color:#fff;border:none;' +
                              'padding:3px 11px;border-radius:5px;font-size:12px;cursor:pointer;"'
                            : 'disabled style="background:#fca5a5;color:#fff;border:none;' +
                              'padding:3px 11px;border-radius:5px;font-size:12px;cursor:not-allowed;opacity:.6;"'
                        ) + '>' + esc(tr('bill.history.btnDelete')) + '</button>' +
                    '</div>' +
                '</div>' +
                '<div style="font-size:12px;color:#888;">' +
                    esc(b.bill_date) +
                    ' &nbsp;|&nbsp; ' + esc((typeof dispPayMethod === 'function') ? dispPayMethod(b.bill_type) : b.bill_type) +
                    (drTag ? (' &nbsp;|&nbsp; ' + esc(drTag)) : '') +
                    ' &nbsp;|&nbsp; ' + esc(trRepl('bill.history.paidBalance', {
                        PAID: fmt2(b.amount_paid),
                        BAL: fmt2(b.balance)
                    })) +
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

function refreshBillDeleteModalCopy(b) {
    if (!b) return;
    var ref  = b.id ? b.id.slice(0, 8).toUpperCase() : '?';
    var info = g('bdDeleteInfo');
    if (info) {
        info.textContent =
            trRepl('bill.delete.summary', {
                REF: ref,
                DATE: (b.bill_date || ''),
                TOTAL: fmt2(b.total),
                TYPE: (typeof dispPayMethod === 'function')
                    ? dispPayMethod(b.bill_type)
                    : (b.bill_type || '')
            }) +
            (b.doctor_tag || b.doctor_name
                ? trRepl('bill.delete.summaryDoctor', { DOCTOR: (b.doctor_tag || b.doctor_name) })
                : '');
    }
}

function confirmDeleteBill(b) {
    bdDeleteTarget = b;
    refreshBillDeleteModalCopy(b);
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
        if (err) { err.textContent = tr('bill.delete.typeDeletePrompt'); err.style.display = 'block'; }
        return;
    }
    if (!bdDeleteTarget || !bdDeleteTarget.id) return;

    SB.from('bills').delete().eq('id', bdDeleteTarget.id)
    .then(function(r) {
        if (r.error) {
            var err = g('bdDeleteError');
            if (err) { err.textContent = trRepl('appt.msg.error', { MSG: r.error.message }); err.style.display = 'block'; }
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

function billDetailClinicCode(b) {
    var active = '';
    if (typeof currentClinicCodeForTagging === 'function') {
        active = String(currentClinicCodeForTagging() || '').trim();
    }
    if (!active) {
        var sel = g('appWorkingClinicSelect');
        var cid = sel && sel.value ? String(sel.value).trim() : '';
        if (!cid && typeof currentClinicId !== 'undefined' && currentClinicId) {
            cid = String(currentClinicId).trim();
        }
        if (cid && typeof clinicRecordFromId === 'function') {
            var recActive = clinicRecordFromId(cid);
            if (recActive) active = String(recActive.clinic_code || recActive.id || '').trim();
        }
    }
    if (active) return active;

    if (!b) return '';
    var raw = String((b.clinic_tag || b.clinic_id || '')).trim();
    if (!raw) return '';
    var rec = null;
    if (typeof clinicRecordForReceiptByTagOrId === 'function') {
        rec = clinicRecordForReceiptByTagOrId(raw);
    }
    if (!rec && typeof clinicRecordFromId === 'function') {
        rec = clinicRecordFromId(raw);
    }
    if (rec) {
        return String(rec.clinic_code || rec.id || raw).trim();
    }
    return raw;
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
        createdStr = dt.toLocaleDateString(apptDateLocale(), {
            day: 'numeric', month: 'short', year: 'numeric'
        }) + '  ' + dt.toLocaleTimeString(apptDateLocale(), {
            hour: '2-digit', minute: '2-digit'
        });
    }
    bdSet('bdCreated', createdStr);

    // Status badge
    var badge = g('bdStatusBadge');
    if (badge) {
        badge.textContent = dispStatusLabel(b.status) || '—';
        badge.className   = 'status-badge ' + statusClass(b.status);
    }

    // Info fields
    bdSet('bdPatient',   b.patient_name || '—');
    bdSet('bdPatientNo', b.patient_no   || '—');
    bdSet('bdDate',      b.bill_date    || '—');
    bdSet('bdDoctor',    b.doctor_tag   || b.doctor_name || '—');
    bdSet('bdClinicCode', billDetailClinicCode(b) || '—');
    bdSet('bdType',      (typeof dispPayMethod === 'function') ? dispPayMethod(b.bill_type) : (b.bill_type || '—'));

    var notesEl = g('bdNotes');
    if (notesEl) notesEl.textContent = b.notes || '—';

    // Items table — zebra rows
    var items = [];
    try { items = JSON.parse(b.items || '[]'); } catch(e) {}
    var tbody = g('bdItemsBody');
    tbody.innerHTML = '';
    items.forEach(function(it, i) {
        var row = document.createElement('tr');
        var disc = parseFloat(it.disc) || 0;
        var amt  = billItemAmt(it);
        row.style.background = (i % 2 === 0) ? '#fff' : '#f0f5ff';
        row.innerHTML =
            '<td style="padding:9px 14px;color:#888;width:36px;">' + (i + 1) + '</td>' +
            '<td style="padding:9px 14px;">' + esc(it.desc || '—') + '</td>' +
            '<td style="padding:9px 14px;text-align:center;">' + (it.qty || 0) + '</td>' +
            '<td style="padding:9px 14px;text-align:right;">' + fmt2(it.price) + '</td>' +
            '<td style="padding:9px 14px;text-align:center;color:' + (disc > 0 ? '#dc2626' : '#aaa') + ';">' +
                (disc > 0 ? disc + '%' : '—') +
            '</td>' +
            '<td style="padding:9px 14px;text-align:right;font-weight:600;">' + fmt2(amt) + '</td>';
        tbody.appendChild(row);
    });
    if (!items.length) {
        tbody.innerHTML =
            '<tr><td colspan="6" style="padding:14px;text-align:center;color:#aaa;">' +
            esc(tr('bill.detail.noItems')) + '</td></tr>';
    }

    // Totals
    var disc = parseFloat(b.discount)    || 0;
    var bal  = parseFloat(b.balance)     || 0;
    g('bdSubtotal').textContent = fmtHK(b.subtotal);
    g('bdDiscount').textContent = fmtHKNeg(disc);
    g('bdTotal').textContent    = fmtHK(b.total);
    g('bdPaid').textContent     = fmtHK(b.amount_paid);
    g('bdBalance').textContent  = fmtHK(bal);
    g('bdBalance').style.color  = bal > 0 ? 'var(--danger)' : '#16a34a';

    // Outstanding banner + Add Payment button
    var banner = g('bdOutstandingBanner');
    var addBtn = g('bdAddPaymentBtn');
    if (banner) banner.style.display = bal > 0 ? 'block' : 'none';
    if (g('bdOutstandingAmt')) g('bdOutstandingAmt').textContent = fmtHK(bal);
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
        'color:#aaa;font-size:13px;">' + esc(tr('bill.historyLoading')) + '</td></tr>';

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
                'color:#aaa;font-size:13px;">' + esc(tr('bill.detail.noPayments')) + '</td></tr>';
            return;
        }
        rows.forEach(function(p, i) {
            var row = document.createElement('tr');
            row.style.background = i % 2 === 0 ? '#fff' : '#f8faff';
            row.innerHTML =
                '<td style="padding:8px 12px;">' + esc(p.paid_date || '—') + '</td>' +
                '<td style="padding:8px 12px;text-align:right;font-weight:700;' +
                    'color:#16a34a;">' + fmtHK(p.amount) + '</td>' +
                '<td style="padding:8px 12px;">' + esc((typeof dispPayMethod === 'function')
                    ? dispPayMethod(p.method)
                    : (p.method || '—')) + '</td>' +
                '<td style="padding:8px 12px;color:#888;">' +
                    esc(p.received_by || '—') + '</td>' +
                '<td style="padding:8px 12px;color:#888;font-size:12px;">' +
                    esc(p.notes || '') + '</td>' +
                '<td style="padding:8px 10px;text-align:center;">' +
                    '<button class="bp-del-btn" data-id="' + esc(p.id) + '" ' +
                    'title="' + esc(tr('bill.detail.deletePaymentTitle')) + '" ' +
                    'style="background:none;border:none;color:#dc2626;' +
                    'font-size:16px;cursor:pointer;line-height:1;padding:0;">×</button>' +
                '</td>';
            row.querySelector('.bp-del-btn').addEventListener('click', function() {
                deletePaymentRecord(p);
            });
            tbody.appendChild(row);
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
            trRepl('bill.addPayment.summary', {
                REF: (bdCurrentBill.id || '').slice(0, 8).toUpperCase(),
                DATE: (bdCurrentBill.bill_date || ''),
                TOTAL: fmt2(bdCurrentBill.total)
            });
    }
    var balHint = g('apBalanceHint');
    if (balHint) balHint.textContent = fmtHK(bal);

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

function billPaymentClinicContext() {
    var clinicId = '';
    var clinicCode = '';
    var sel = g('appWorkingClinicSelect');
    if (sel && sel.value) clinicId = String(sel.value).trim();
    if (!clinicId && typeof currentClinicId !== 'undefined' && currentClinicId) {
        clinicId = String(currentClinicId).trim();
    }
    if (typeof currentClinicCodeForTagging === 'function') {
        clinicCode = String(currentClinicCodeForTagging() || '').trim();
    }
    if (!clinicCode && clinicId && typeof clinicRecordFromId === 'function') {
        var rec = clinicRecordFromId(clinicId);
        if (rec) clinicCode = String(rec.clinic_code || rec.id || '').trim();
    }
    return {
        clinic_id: clinicId || null,
        clinic_tag: clinicCode || null,
        clinic_code: clinicCode || null
    };
}

function stripBillPaymentClinicColsByError(src, errMsg) {
    var out = Object.assign({}, src);
    var msg = String(errMsg || '').toLowerCase();
    var touched = false;
    var mentionsTag = msg.indexOf('clinic_tag') >= 0;
    var mentionsCode = msg.indexOf('clinic_code') >= 0;
    var mentionsId = msg.indexOf('clinic_id') >= 0;
    if (mentionsTag && Object.prototype.hasOwnProperty.call(out, 'clinic_tag')) {
        delete out.clinic_tag;
        touched = true;
    }
    if (mentionsCode && Object.prototype.hasOwnProperty.call(out, 'clinic_code')) {
        delete out.clinic_code;
        touched = true;
    }
    if (mentionsId && Object.prototype.hasOwnProperty.call(out, 'clinic_id')) {
        delete out.clinic_id;
        touched = true;
    }
    return { payload: out, changed: touched };
}

// ── Confirm & save a new payment ────────────────────────
function confirmAddPayment() {
    if (!bdCurrentBill) return;
    var amount = parseFloat(g('apAmount').value) || 0;
    var errEl  = g('apError');

    if (amount <= 0) {
        if (errEl) { errEl.textContent = tr('bill.addPayment.errInvalidAmount'); errEl.style.display = ''; }
        return;
    }
    var bal = parseFloat(bdCurrentBill.balance) || 0;
    if (amount > bal + 0.005) {
        if (errEl) {
            errEl.textContent = trRepl('bill.addPayment.errExceedsBalance', { BAL: fmt2(bal) });
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
    var clinicCtx = billPaymentClinicContext();
    payRecord.clinic_id = clinicCtx.clinic_id;
    payRecord.clinic_tag = clinicCtx.clinic_tag;
    payRecord.clinic_code = clinicCtx.clinic_code;

    function insertBillPayment(payload, done) {
        SB.from('bill_payments').insert([payload]).then(function(ir) {
            if (!ir.error) { done(ir); return; }
            var stripped = stripBillPaymentClinicColsByError(payload, ir.error.message || '');
            if (!stripped.changed) { done(ir); return; }
            SB.from('bill_payments').insert([stripped.payload]).then(done);
        });
    }

    insertBillPayment(payRecord, function(r) {
        if (r.error) {
            if (errEl) { errEl.textContent = trRepl('appt.msg.error', { MSG: r.error.message }); errEl.style.display = ''; }
            return;
        }
        // Update the parent bill's totals
        return SB.from('bills').update({
            amount_paid: newPaid,
            balance:     newBalance,
            status:      newStatus
        }).eq('id', bdCurrentBill.id)
        .then(function(u) {
            if (u.error) {
                if (errEl) { errEl.textContent = trRepl('appt.msg.error', { MSG: u.error.message }); errEl.style.display = ''; }
                return;
            }
            // Refresh in-memory bill object
            bdCurrentBill.amount_paid = newPaid;
            bdCurrentBill.balance     = newBalance;
            bdCurrentBill.status      = newStatus;

            closeModal('addPaymentModal');

            // Refresh the detail view live
            g('bdPaid').textContent    = fmtHK(newPaid);
            g('bdBalance').textContent = fmtHK(newBalance);
            g('bdBalance').style.color = newBalance > 0 ? 'var(--danger)' : '#16a34a';

            var badge = g('bdStatusBadge');
            if (badge) { badge.textContent = dispStatusLabel(newStatus); badge.className = 'status-badge ' + statusClass(newStatus); }

            var banner = g('bdOutstandingBanner');
            var addBtn = g('bdAddPaymentBtn');
            if (banner) banner.style.display = newBalance > 0 ? 'block' : 'none';
            if (g('bdOutstandingAmt')) g('bdOutstandingAmt').textContent = fmtHK(newBalance);
            if (addBtn)  addBtn.style.display = newBalance > 0 ? 'inline-block' : 'none';

            loadBillPayments(bdCurrentBill.id);
            loadBillHistory();
            try { document.dispatchEvent(new CustomEvent('consultation-ar-refresh')); } catch (_) {}
        });
    });
}

function deletePaymentRecord(p) {
    if (!confirm(trRepl('bill.deletePaymentConfirm', {
        AMT: fmt2(p.amount),
        DATE: (p.paid_date || '')
    }))) return;

    SB.from('bill_payments').delete().eq('id', p.id)
    .then(function(r) {
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }

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

                g('bdPaid').textContent    = fmtHK(newPaid);
                g('bdBalance').textContent = fmtHK(newBalance);
                g('bdBalance').style.color = newBalance > 0 ? 'var(--danger)' : '#16a34a';

                var badge = g('bdStatusBadge');
                if (badge) { badge.textContent = dispStatusLabel(newStatus); badge.className = 'status-badge ' + statusClass(newStatus); }

                var banner = g('bdOutstandingBanner');
                var addBtn = g('bdAddPaymentBtn');
                if (banner) banner.style.display = newBalance > 0 ? 'block' : 'none';
                if (g('bdOutstandingAmt')) g('bdOutstandingAmt').textContent = fmtHK(newBalance);
                if (addBtn)  addBtn.style.display = newBalance > 0 ? 'inline-block' : 'none';

                loadBillPayments(p.bill_id);
                loadBillHistory();
                try { document.dispatchEvent(new CustomEvent('consultation-ar-refresh')); } catch (_) {}
            }
        });
    });
}

var _receiptPrintInProgress = false;

/**
 * Receipt content-only CSS (no @page / sheet chrome). Sheet from CFG.buildPrintSheetStylesCss().
 * Screen: existing blue accents. @media print: borders + economy color adjustment — tuned for grayscale printers.
 */
function receiptContentPrintStyles() {
    return (
        'body{font-family:"Segoe UI",Tahoma,Geneva,Verdana,sans-serif;font-size:12px;line-height:1.35;color:#222;margin:0;}' +
        '#receiptPrintArea{width:100%;max-width:none;margin:0;padding:0;box-sizing:border-box;display:block;}' +
        '.receipt-header{text-align:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #e5e7eb;}' +
        '.receipt-header h2{margin:0 0 4px;color:#0084ff;font-size:17px;line-height:1.2;font-weight:700;}' +
        '.receipt-clinic-line{margin:1px 0;color:#555;font-size:11px;line-height:1.35;}' +
        '.receipt-doc-title{margin:6px 0 0;color:#666;font-size:11px;font-weight:600;}' +
        '.receipt-meta{display:flex;justify-content:space-between;align-items:flex-start;' +
            'font-size:12px;margin-bottom:8px;line-height:1.4;gap:10px;flex-wrap:wrap;}' +
        '.receipt-meta-col{min-width:0;}' +
        '.receipt-meta-left-stack{flex:1;max-width:72%;text-align:left;padding:6px 8px;' +
            'border-radius:6px;border-left:3px solid #0084ff;background:#fafafa;}' +
        '.receipt-meta-date-only{flex:0 0 auto;text-align:right;align-self:flex-start;padding-top:6px;}' +
        '.receipt-meta-spacer{height:14px;margin:4px 0 8px;}' +
        '.receipt-kv-row{display:flex;justify-content:space-between;align-items:baseline;' +
            'gap:10px;margin-bottom:4px;flex-wrap:wrap;}' +
        '.receipt-kv-row:last-child{margin-bottom:0;}' +
        '.receipt-kv-row.receipt-kv-patient-names .receipt-kv-val{font-weight:700;}' +
        '.receipt-meta-col strong,.receipt-kv-label{font-size:11px;font-weight:600;color:#475569;}' +
        '.receipt-kv-val{font-size:11px;font-weight:600;color:#111827;word-break:break-word;}' +
        '.receipt-meta-left-stack .receipt-kv-row{justify-content:flex-start;}' +
        '.receipt-meta-left-stack .receipt-kv-val{text-align:left;flex:1;}' +
        '.receipt-meta-left-stack .receipt-kv-label{min-width:6.5rem;flex-shrink:0;color:#475569;}' +
        '.receipt-meta-date-only .receipt-kv-row{justify-content:flex-end;}' +
        '.receipt-meta-date-only .receipt-kv-val{text-align:right;flex:0 1 auto;min-width:4rem}' +
        '.receipt-meta-date-only .receipt-kv-label{margin-left:0;color:#475569}' +
        '.receipt-kv-monospace{font-family:Consolas,"Courier New",monospace;letter-spacing:0.02em;}' +
        '.receipt-table{width:100%;border-collapse:collapse;margin:8px 0;font-size:11px;}' +
        '.receipt-table th{background:#f0f7ff;padding:5px 6px;text-align:left;font-size:11px;font-weight:600;color:#0084ff;border-bottom:1px solid #dbeafe;}' +
        '.receipt-table td{padding:4px 6px!important;border-bottom:1px solid #f0f0f0;font-size:11px;vertical-align:top;}' +
        '.receipt-totals{background:#f8faff;border-radius:6px;padding:8px 10px;margin-top:8px;font-size:12px;}' +
        '.r-row{display:flex;justify-content:space-between;padding:3px 0;font-size:12px;}' +
        '.r-grand{border-top:1px solid #0084ff;margin-top:6px;padding-top:8px;font-size:14px;font-weight:700;color:#0084ff;}' +
        '.receipt-footer{text-align:center;margin-top:10px;padding-top:8px;border-top:1px solid #eee;color:#6b7280;font-size:10px;}' +
        '.receipt-signature{position:static;margin:8px auto 4px;max-width:280px;text-align:center;padding-top:12px;background:#fff;}' +
        '.receipt-sign-line{border-bottom:1px solid #374151;height:8px;}' +
        '.receipt-sign-name{margin-top:4px;font-size:11px;font-weight:700;color:#1f2937;line-height:1.25;}' +
        '.receipt-footer p{margin:3px 0;}' +
        '#rInstalmentsSection{font-size:11px;}' +
        '#rInstalmentsSection table{font-size:10px!important;border-collapse:collapse;width:100%;}' +
        '#rInstalmentsSection th,#rInstalmentsSection td{padding:3px 5px!important;}' +
        '#rOutstandingRow{font-size:10px!important;margin-top:6px!important;padding:5px 8px!important;}' +
        '@media print{' +
        'html,body,#receiptPrintArea,.receipt-signature,.receipt-header,.receipt-meta-left-stack,' +
        '.receipt-totals,.receipt-table th,.receipt-table td{' +
        'print-color-adjust:economy!important;-webkit-print-color-adjust:economy!important;}' +
        'body{margin:0;color:#111!important;}' +
        '#receiptPrintArea{padding:0;}' +
        '.receipt-signature{position:static;background:#fff!important;}' +
        '.receipt-header h2{color:#111!important;}' +
        '.receipt-meta-left-stack{background:#fff!important;border-left:3px solid #333!important;' +
            'outline:1px solid #999;outline-offset:-1px;border-radius:2px;}' +
        '.receipt-table th{background:#fff!important;color:#111!important;' +
            'border-top:1px solid #666!important;border-bottom:2px solid #111!important;}' +
        '.receipt-table td{border-bottom:1px solid #ccc!important;}' +
        '.receipt-totals{background:#fff!important;border:1px solid #666!important;border-radius:2px;}' +
        '.r-grand{color:#111!important;border-top:2px solid #111!important;}' +
        'thead{display:table-header-group;}' +
        'tr{page-break-inside:avoid;}' +
        '}'
    );
}

/** Fallback when CFG sheet helpers unavailable — mirrors bill default A4 + 10mm from app-config PRINT_DOC_TYPES. */
function receiptPrintSheetFallbackCss() {
    return (
        '@page{margin:10mm 10mm 10mm 10mm;size:210mm 297mm;}' +
        'html{background:#d4d4d4;}' +
        'body{font-family:"Segoe UI",Arial,sans-serif;margin:0;color:#111;background:#d4d4d4;}' +
        '.print-sheet-outer{' +
            'box-sizing:border-box;width:210mm;min-height:297mm;' +
            'padding:10mm;margin:14px auto;background:#fff;' +
            'box-shadow:0 4px 28px rgba(0,0,0,.22);}' +
        '@media print{' +
            'html,body{background:#fff!important;color:#111!important;' +
            'print-color-adjust:economy!important;-webkit-print-color-adjust:economy!important;}' +
            '.print-sheet-outer{' +
                'width:auto!important;min-height:0!important;margin:0!important;' +
                'padding:0!important;box-shadow:none!important;background:#fff!important;' +
                'print-color-adjust:economy!important;-webkit-print-color-adjust:economy!important;}' +
        '}'
    );
}

function receiptDoctorNames(bill, profileOverride) {
    var eng = '';
    var chi = '';
    var docs = (typeof APP_DOCTORS !== 'undefined' && Array.isArray(APP_DOCTORS)) ? APP_DOCTORS : [];
    var hit = profileOverride || null;
    if (bill && bill.doctor_id) {
        hit = hit || docs.find(function(d) { return d && d.id === bill.doctor_id; }) || null;
    }
    if (!hit && bill && bill.doctor_name) {
        var dn = String(bill.doctor_name).trim().toLowerCase();
        hit = hit || docs.find(function(d) {
            if (!d) return false;
            var d1 = String(d.display_name || '').trim().toLowerCase();
            var d2 = String(d.english_name || '').trim().toLowerCase();
            var d3 = String(d.chinese_name || '').trim().toLowerCase();
            return dn && (dn === d1 || dn === d2 || dn === d3);
        }) || null;
    }
    if (hit) {
        eng = String(hit.english_name || hit.display_name || '').trim();
        chi = String(hit.chinese_name || '').trim();
    }
    if (!eng && !chi && bill) {
        eng = String(bill.doctor_name || bill.doctor_tag || '').trim();
    }
    if (!eng && !chi) {
        var fallback = (typeof currentDoctorName !== 'undefined' && currentDoctorName)
            ? String(currentDoctorName)
            : (currentName || '—');
        eng = fallback;
    }
    if (chi && chi === eng) chi = '';
    var engSign = String(eng || '—').trim();
    if (engSign && engSign !== '—' && !/^dr\b\.?/i.test(engSign)) {
        engSign = 'Dr ' + engSign;
    }
    var chiSign = String(chi || '').trim();
    if (chiSign && chiSign.indexOf('牙科醫生') < 0) {
        chiSign = chiSign + ' 牙科醫生';
    }
    if (!chiSign) chiSign = '—';
    var both = eng + (chi ? (' / ' + chi) : '');
    return {
        header: bill && bill.doctor_tag ? String(bill.doctor_tag) : both,
        signatureEng: engSign || '—',
        signatureChi: chiSign
    };
}

function applyReceiptDoctorSignature(docNames) {
    if (!docNames) return;
    if (g('rDoctor')) g('rDoctor').textContent = docNames.header;
    if (g('rDoctorSignEng')) g('rDoctorSignEng').textContent = docNames.signatureEng;
    if (g('rDoctorSignChi')) g('rDoctorSignChi').textContent = docNames.signatureChi;
}

function hydrateReceiptDoctorProfile(bill) {
    if (!bill || !bill.doctor_id || !SB || typeof SB.from !== 'function') return;
    SB.from('doctors')
        .select('id,display_name,english_name,chinese_name')
        .eq('id', bill.doctor_id)
        .limit(1)
        .then(function(r) {
            if (r.error || !r.data || !r.data.length) return;
            var names = receiptDoctorNames(bill, r.data[0]);
            applyReceiptDoctorSignature(names);
        });
}

/** English + Chinese patient lines for receipt header (Zh row hidden when no Chinese name). */
function receiptPatientEnglishChineseParts(row, billFallbackName) {
    var fb = String(billFallbackName || '').trim();
    var chi = '';
    var eng = '';
    if (row) {
        chi = String(row.chinese_name || row.name_zh || '').trim();
        eng = String(row.english_name || row.name_en || '').trim();
        if (!eng) eng = String(row.full_name || row.display_name || '').trim();
    }
    if (!eng && !chi && fb) {
        eng = fb;
        chi = '';
    } else {
        if (!eng) eng = '';
        if (!chi) chi = '';
    }
    if (chi && eng && chi === eng) chi = '';

    var enDisp = '';
    var zhDisp = '';
    var showZhRow = !!chi;

    if (chi) {
        zhDisp = chi;
        enDisp = eng || '—';
    } else if (eng) {
        zhDisp = '';
        showZhRow = false;
        enDisp = eng;
    } else if (fb) {
        enDisp = fb;
        zhDisp = '';
        showZhRow = false;
    } else {
        enDisp = '—';
        zhDisp = '';
        showZhRow = false;
    }

    return { enDisp: enDisp || '—', zhDisp: zhDisp, showZhRow: showZhRow };
}

function applyReceiptPatientProfile(row, bill) {
    var parts = receiptPatientEnglishChineseParts(row, bill ? bill.patient_name : '');
    var no = '';
    if (row) no = String(row.patient_no || row.patient_code || '').trim();
    if (!no && bill) no = String(bill.patient_no || '').trim();
    var enEl = g('rPatientEn');
    var zhEl = g('rPatientZh');
    var zhRow = g('receiptPatientZhRow');
    if (enEl) enEl.textContent = parts.enDisp;
    if (zhEl) zhEl.textContent = parts.zhDisp;
    if (zhRow) {
        zhRow.style.display = parts.showZhRow ? '' : 'none';
    }
    if (g('rPatientNo')) g('rPatientNo').textContent = no || '—';
}

function hydrateReceiptPatientProfile(bill) {
    if (!bill || !SB || typeof SB.from !== 'function') return;

    function queryByPatientNo() {
        if (!bill.patient_no) return;
        SB.from('patients')
            .select('*')
            .eq('patient_no', bill.patient_no)
            .limit(1)
            .then(function(r2) {
                if (r2.error || !r2.data || !r2.data.length) return;
                applyReceiptPatientProfile(r2.data[0], bill);
            });
    }

    if (bill.patient_id) {
        SB.from('patients')
            .select('*')
            .eq('id', bill.patient_id)
            .limit(1)
            .then(function(r) {
                if (r.error || !r.data || !r.data.length) {
                    queryByPatientNo();
                    return;
                }
                applyReceiptPatientProfile(r.data[0], bill);
            });
        return;
    }
    queryByPatientNo();
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

    var cid = (typeof currentClinicId !== 'undefined' && currentClinicId)
        ? String(currentClinicId) : '';
    var sheetCss = '';
    var popW = 720;
    var popH = 820;
    if (typeof CFG !== 'undefined' && CFG) {
        if (typeof CFG.prefetchPrintSettings === 'function') {
            CFG.prefetchPrintSettings(cid);
        }
        if (CFG.getPrintSettingsForDoc && CFG.buildPrintSheetStylesCss) {
            var billPrintRow = CFG.getPrintSettingsForDoc('bill', cid);
            sheetCss = CFG.buildPrintSheetStylesCss(billPrintRow);
            if (CFG.estimatePrintPopupSizePx) {
                var wh = CFG.estimatePrintPopupSizePx(billPrintRow);
                popW = wh.width;
                popH = wh.height;
            }
        }
    }
    if (!sheetCss) {
        sheetCss = receiptPrintSheetFallbackCss();
    }
    var printStylesAll = sheetCss +
        '.print-sheet-outer img,.print-sheet-outer table{max-width:100%;}' +
        receiptContentPrintStyles();

    var popup = window.open(
        '', '_blank',
        'width=' + popW + ',height=' + popH + ',left=80,top=40,toolbar=0,menubar=0,scrollbars=1,resizable=1'
    );
    if (!popup) {
        _receiptPrintInProgress = false;
        alert(tr('bill.receipt.popupBlocked'));
        return;
    }

    var releaseLock = function () {
        _receiptPrintInProgress = false;
    };

    popup.document.write(
        '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<title>' + esc(tr('bill.receipt.printTitle')) + '</title><style>' + printStylesAll + '</style></head><body>' +
        '<div class="print-sheet-outer"><div id="receiptPrintArea">' +
        area.innerHTML +
        '</div></div>' +
        '<script>(function(){var printed=false,closing=false;' +
        'function notifyOpener(){try{' +
        'var o=window.opener;if(o&&typeof o.closeModal==="function"){o.closeModal("receiptModal");}' +
        '}catch(_){}' +
        '}' +
        'function finalize(){if(closing)return;closing=true;' +
        'notifyOpener();' +
        'function tryClose(){try{if(!window.closed)window.close();}catch(_){}}' +
        'tryClose();setTimeout(tryClose,120);setTimeout(tryClose,450);}' +
        'function fitPageRatio(){' +
        'var de=document.documentElement,bd=document.body;if(!de||!bd)return;' +
        'de.style.zoom="";bd.style.zoom="";' +
        'var vw=Math.max(1,window.innerWidth||de.clientWidth||1);' +
        'var vh=Math.max(1,window.innerHeight||de.clientHeight||1);' +
        'var needW=Math.max(1,de.scrollWidth||bd.scrollWidth||vw);' +
        'var needH=Math.max(1,de.scrollHeight||bd.scrollHeight||vh);' +
        'var sc=Math.min(1,vw/needW,vh/needH);' +
        'if(!(sc>0&&sc<=1))sc=1;' +
        'sc=Math.max(0.42,Math.floor(sc*100)/100);' +
        'if(sc<1){de.style.zoom=String(sc);bd.style.zoom=String(sc);}' +
        '}' +
        'function armCloseHandlers(){' +
        'function afterPrintSlowClose(){if(closing)return;' +
        'setTimeout(function(){finalize();},2500);}' +
        'window.addEventListener("afterprint",afterPrintSlowClose);' +
        'window.onafterprint=afterPrintSlowClose;' +
        '}' +
        'armCloseHandlers();' +
        'function run(){if(printed)return;printed=true;' +
        'try{fitPageRatio();}catch(e0){}' +
        'try{window.focus();window.print();}catch(e){finalize();}' +
        '}' +
        'window.onload=function(){setTimeout(run,220);};' +
        'setTimeout(function(){if(!printed)run();},1200);})();<\/script>' +
        '</body></html>'
    );
    popup.document.close();

    try { popup.focus(); } catch (eFocus) {}

    var pollAttempts = 0;
    var pollMax = Math.ceil(90000 / 400);
    var pollId = setInterval(function() {
        pollAttempts++;
        var dead = false;
        try {
            dead = !popup || popup.closed;
        } catch (_) {
            dead = true;
        }
        if (dead || pollAttempts >= pollMax) {
            clearInterval(pollId);
            releaseLock();
        }
    }, 400);
}

function clinicRecordForReceiptByTagOrId(tagOrId) {
    if (!tagOrId || !APP_CLINICS || !APP_CLINICS.length) return null;
    var t = String(tagOrId).trim();
    for (var i = 0; i < APP_CLINICS.length; i++) {
        var c = APP_CLINICS[i];
        if (String(c.id) === t) return c;
        if (String(c.clinic_code || '').trim() === t) return c;
    }
    return null;
}

function resolveActiveClinicRecordForReceipt() {
    var rec = null;
    if (typeof clinicRecordFromId === 'function' && currentClinicId) {
        rec = clinicRecordFromId(currentClinicId);
    }
    if (!rec) {
        var sel = g('appWorkingClinicSelect');
        var selVal = sel ? String(sel.value || '').trim() : '';
        if (selVal && typeof clinicRecordFromId === 'function') {
            rec = clinicRecordFromId(selVal);
        }
    }
    if (!rec &&
        typeof currentClinicCodeForTagging === 'function' &&
        typeof APP_CLINICS !== 'undefined' &&
        APP_CLINICS && APP_CLINICS.length) {
        var code = String(currentClinicCodeForTagging() || '').trim();
        if (code) rec = clinicRecordForReceiptByTagOrId(code);
    }
    return rec;
}

function applyReceiptClinicHeaderFromRecord(rec) {
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
    if (!name) name = tr('ai.clinicFallback');

    if (nmEl) nmEl.textContent = name;
    if (addrEl) addrEl.textContent = addr || '—';
    if (telEl) telEl.textContent = trRepl('bill.receipt.telPrefix', { TEL: tel || '—' });
    if (footEl) footEl.textContent = trRepl('bill.receipt.thanksVisit', { NAME: name });
}

/** Receipt print header should follow active clinic context first. */
function applyReceiptClinicHeader(bill) {
    var rec = resolveActiveClinicRecordForReceipt();
    if (!rec && bill) rec = clinicRecordForReceiptByTagOrId(bill.clinic_id || bill.clinic_tag);
    applyReceiptClinicHeaderFromRecord(rec);

    if (!rec && bill && bill.appointment_id && SB && typeof SB.from === 'function') {
        SB.from('appointments')
            .select('clinic_tag')
            .eq('id', bill.appointment_id)
            .limit(1)
            .then(function(r) {
                if (r.error || !r.data || !r.data.length) return;
                var hit = clinicRecordForReceiptByTagOrId(r.data[0].clinic_tag || '');
                if (hit) applyReceiptClinicHeaderFromRecord(hit);
            });
    }
}

var _receiptRefreshState = null;

function showReceipt(bill, insertedData, payments, autoPrint) {
    _receiptRefreshState = {
        bill: bill,
        insertedData: insertedData,
        payments: payments
    };
    applyReceiptClinicHeader(bill);

    var rNo = insertedData && insertedData[0]
        ? insertedData[0].id.slice(0, 8).toUpperCase()
        : 'RCP-' + Date.now();

    g('rNo').textContent        = rNo;
    g('rDate').textContent      = bill.bill_date;
    g('rType').textContent      = (typeof dispPayMethod === 'function')
        ? dispPayMethod(bill.bill_type)
        : bill.bill_type;
    if (g('rPatientNo')) g('rPatientNo').textContent =
        (bill && bill.patient_no) ? String(bill.patient_no).trim() : '—';
    var fallbackParts = receiptPatientEnglishChineseParts(null, bill.patient_name);
    if (g('rPatientEn')) g('rPatientEn').textContent = fallbackParts.enDisp;
    if (g('rPatientZh')) g('rPatientZh').textContent = fallbackParts.zhDisp;
    if (g('receiptPatientZhRow')) {
        g('receiptPatientZhRow').style.display = fallbackParts.showZhRow ? '' : 'none';
    }
    var docNames = receiptDoctorNames(bill);
    applyReceiptDoctorSignature(docNames);
    hydrateReceiptDoctorProfile(bill);
    hydrateReceiptPatientProfile(bill);

    // ── Item rows (with disc %) ──────────────────────────
    var items = [];
    try { items = JSON.parse(bill.items || '[]'); } catch(e) {}
    var rb = g('rItemsBody');
    rb.innerHTML = '';
    items.forEach(function(it) {
        var disc = parseFloat(it.disc) || 0;
        var amt  = billItemAmt(it);
        var row = document.createElement('tr');
        row.innerHTML =
            '<td style="padding:4px 6px;">' + esc(it.desc || '-') + '</td>' +
            '<td style="padding:4px 6px;text-align:center;">' + (it.qty || 0) + '</td>' +
            '<td style="padding:4px 6px;text-align:right;">' + fmtHK(it.price) + '</td>' +
            '<td style="padding:4px 6px;text-align:center;color:' +
                (disc > 0 ? '#dc2626' : '#aaa') + ';">' +
                (disc > 0 ? disc + '%' : '—') + '</td>' +
            '<td style="padding:4px 6px;text-align:right;">' + fmtHK(amt) + '</td>';
        rb.appendChild(row);
    });

    g('rSubtotal').textContent = fmt2(bill.subtotal);
    g('rDiscount').textContent = fmt2(bill.discount);
    g('rTotal').textContent    = fmt2(bill.total);
    g('rPaid').textContent     = fmt2(bill.amount_paid);
    g('rBalance').textContent  = fmtHK(bill.balance);

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
            var row = document.createElement('tr');
            row.style.background = i % 2 === 0 ? '#fff' : '#f8faff';
            row.innerHTML =
                '<td style="padding:5px 8px;color:#888;">' + (i + 1) + '</td>' +
                '<td style="padding:5px 8px;">' + esc(p.paid_date || '—') + '</td>' +
                '<td style="padding:5px 8px;text-align:right;font-weight:700;' +
                    'color:#16a34a;">' + fmtHK(p.amount) + '</td>' +
                '<td style="padding:5px 8px;">' + esc((typeof dispPayMethod === 'function')
                    ? dispPayMethod(p.method)
                    : (p.method || '—')) + '</td>' +
                '<td style="padding:5px 8px;color:#888;font-size:11px;">' +
                    esc(p.notes || '') + '</td>';
            bodyEl.appendChild(row);
        });
    }
    if (outRow)  outRow.style.display  = bal > 0 ? 'flex' : 'none';
    if (outAmt)  outAmt.textContent    = fmtHK(bal);

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
        alert(tr('appt.today.registerWalkinFirst'));
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
            if (u.error) { alert(trRepl('appt.msg.error', { MSG: u.error.message })); return; }
            loadToday();
            loadQueue();
            switchApptTab('queue');
        });
    });
}

function refreshRecallContactI18n() {
    if (typeof setRcContact === 'function') setRcContact(rcContact);
}

function refreshRecallPanelI18n() {
    if (!rcDate) return;
    var hdr = g('recallDateHdr');
    if (hdr) {
        hdr.textContent = typeof fmtDateLong === 'function'
            ? fmtDateLong(rcDate, { long: true })
            : rcDate;
    }
    if (typeof renderRcal === 'function') renderRcal();
    if (rcPatients.length && typeof renderRecallTable === 'function') {
        renderRecallTable();
    }
}

function apptTabApplyI18nIfCached(tabId) {
    if (typeof applyI18nInRoot !== 'function') return;
    var tab = g(tabId);
    if (tab) applyI18nInRoot(tab);
}

function refreshApptCachedTabsI18n() {
    if (typeof syncApptTodayDateLabels === 'function') syncApptTodayDateLabels();
    if (arAllData.length && typeof arRender === 'function') {
        arRender();
        apptTabApplyI18nIfCached('tab-records');
    }
    if (todayAppts.length && typeof loadToday === 'function') {
        loadToday();
        apptTabApplyI18nIfCached('tab-today');
    }
    if (typeof plusApptDate !== 'undefined' && plusApptDate &&
        typeof refreshApptPlannerData === 'function') {
        refreshApptPlannerData();
        apptTabApplyI18nIfCached('tab-plusappt');
    }
    var qb = g('queueBody');
    if (qb && qb.querySelector('tr.queue-row-draggable') && typeof loadQueue === 'function') {
        loadQueue();
        apptTabApplyI18nIfCached('tab-queue');
    }
    if (typeof rcDate !== 'undefined' && rcDate) {
        if (typeof refreshRecallPanelI18n === 'function') refreshRecallPanelI18n();
        else apptTabApplyI18nIfCached('tab-recall');
    }
    var cb = g('calBody');
    if (typeof calView !== 'undefined' && calView === 'weekly' &&
        typeof GCAL !== 'undefined' && typeof GCAL.render === 'function') {
        var gcalState = (typeof GCAL.captureGcalPanelState === 'function')
            ? GCAL.captureGcalPanelState() : null;
        GCAL.render();
        if (typeof GCAL.restoreGcalPanelState === 'function') {
            GCAL.restoreGcalPanelState(gcalState);
        }
    } else if (cb && cb.children.length && typeof renderCal === 'function') {
        renderCal();
    } else {
        apptTabApplyI18nIfCached('tab-calendar');
    }
}

document.addEventListener('DOMContentLoaded', function () {
    if (typeof refreshApptDurOptions === 'function') refreshApptDurOptions();
    wireBillPanelControls();
});

function refreshOpenBillPanelForLang() {
    var panel = g('billPanel');
    if (!panel || !panel.classList.contains('open')) return;
    if (typeof applyI18nInRoot === 'function') applyI18nInRoot(panel);
    renderBillPendingRefreshMeta();
    if (typeof applyReceiptClinicHeader === 'function') applyReceiptClinicHeader();
    var step2Visible = g('billStep2') && g('billStep2').style.display !== 'none';
    if (step2Visible) {
        renderStep2();
    } else {
        renderStep1UI();
        renderBillItems();
        recalcPendingSubtotal();
    }
    if (typeof loadBillHistory === 'function') loadBillHistory();
    if (billTypesCache.length && typeof refreshBillPaymentSelectLabels === 'function') {
        refreshBillPaymentSelectLabels();
    } else if (typeof loadBillTypes === 'function') {
        loadBillTypes();
    }
    if (typeof renderBillDoctorOptions === 'function') {
        renderBillDoctorOptions(typeof defaultBillDoctorId === 'function' ? defaultBillDoctorId() : '');
    }
}

document.addEventListener('app-lang-change', function () {
    if (typeof refreshApptDurOptions === 'function') refreshApptDurOptions();
    refreshOpenBillPanelForLang();
    var panel = g('billPanel');
    if (typeof refreshApptCachedTabsI18n === 'function') refreshApptCachedTabsI18n();
    var apptSec = g('appointmentSection');
    var billOpen = panel && panel.classList.contains('open');
    if (apptSec && (apptSectionIsActive() || billOpen)) {
        if (apptSectionIsActive()) {
            var tab = typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : null;
            if (tab === 'records' && !arAllData.length && typeof loadApptRecords === 'function') {
                loadApptRecords();
            } else if (tab === 'calendar' && typeof renderCal === 'function') {
                var gcalState = (typeof GCAL.captureGcalPanelState === 'function')
                    ? GCAL.captureGcalPanelState() : null;
                renderCal();
                if (typeof GCAL.restoreGcalPanelState === 'function') {
                    GCAL.restoreGcalPanelState(gcalState);
                }
            }
        }
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(apptSec);
        if (typeof syncApptTodayDateLabels === 'function') syncApptTodayDateLabels();
    }
    var dayPanel = g('dayPanel');
    if (dayPanel && dayPanel.style.display !== 'none' && _dayPanelCtx) {
        showDayPanel(_dayPanelCtx.iso, { [_dayPanelCtx.iso]: _dayPanelCtx.items });
    }
    if (typeof refreshRecallContactI18n === 'function') refreshRecallContactI18n();
    if (typeof renderRcTemplates === 'function') renderRcTemplates();
    if (_queueRemarksEditAppt && typeof setQueueRemarksApptHint === 'function') {
        setQueueRemarksApptHint(_queueRemarksEditAppt);
    }
    var apptModal = g('apptModal');
    if (apptModal && apptModal.style.display === 'block' &&
        typeof refreshApptModalI18n === 'function') {
        refreshApptModalI18n();
    }
    if (typeof refreshApptPopupI18n === 'function') refreshApptPopupI18n();
    var recallSendModal = g('recallSendModal');
    if (recallSendModal && recallSendModal.style.display === 'block') {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(recallSendModal);
        if (typeof showRcSendModal === 'function' && rcSendQueue && rcSendQueue.length) showRcSendModal();
    }
    var queueRemarksModal = g('queueRemarksModal');
    if (queueRemarksModal && queueRemarksModal.style.display === 'block') {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(queueRemarksModal);
        if (typeof refreshApptRemarksEditorPlaceholders === 'function') {
            refreshApptRemarksEditorPlaceholders();
        }
        if (_queueRemarksEditAppt && typeof setQueueRemarksApptHint === 'function') {
            setQueueRemarksApptHint(_queueRemarksEditAppt);
        }
    }
    if (typeof refreshApptRemarksEditorPlaceholders === 'function') {
        refreshApptRemarksEditorPlaceholders();
    }
    var receiptModal = g('receiptModal');
    if (receiptModal && receiptModal.style.display === 'block') {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(receiptModal);
        if (_receiptRefreshState && typeof showReceipt === 'function') {
            showReceipt(
                _receiptRefreshState.bill,
                _receiptRefreshState.insertedData,
                _receiptRefreshState.payments,
                false
            );
        }
    }
    var billDetailModalEl = g('billDetailModal');
    if (billDetailModalEl && billDetailModalEl.style.display === 'block') {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(billDetailModalEl);
        if (bdCurrentBill && typeof showBillDetail === 'function') {
            showBillDetail(bdCurrentBill);
        }
    }
    var addPayModal = g('addPaymentModal');
    if (addPayModal && addPayModal.style.display === 'block') {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(addPayModal);
        var apSel = g('apMethod');
        if (apSel && typeof applyBillTypeOptions === 'function') {
            var apPrev = apSel.value;
            applyBillTypeOptions(apSel, false);
            if (apPrev) apSel.value = apPrev;
        }
        if (bdCurrentBill) {
            var apBal = parseFloat(bdCurrentBill.balance) || 0;
            var apSummary = g('apBillSummary');
            if (apSummary) {
                apSummary.textContent = trRepl('bill.addPayment.summary', {
                    REF: (bdCurrentBill.id || '').slice(0, 8).toUpperCase(),
                    DATE: (bdCurrentBill.bill_date || ''),
                    TOTAL: fmt2(bdCurrentBill.total)
                });
            }
            var apBalHint = g('apBalanceHint');
            if (apBalHint) apBalHint.textContent = fmtHK(apBal);
        }
    }
    var billDelModal = g('billDeleteModal');
    if (billDelModal && billDelModal.style.display === 'block' && bdDeleteTarget) {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(billDelModal);
        if (typeof refreshBillDeleteModalCopy === 'function') {
            refreshBillDeleteModalCopy(bdDeleteTarget);
        }
    }
    if (typeof refreshGcalLockButtonsI18n === 'function') refreshGcalLockButtonsI18n();
    if (typeof GCAL !== 'undefined' && typeof GCAL.refreshGcalPanelsI18n === 'function') {
        GCAL.refreshGcalPanelsI18n();
    }
    if (typeof refreshApptHeaderI18n === 'function') refreshApptHeaderI18n();
});
