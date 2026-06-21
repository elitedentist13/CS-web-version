// ════════════════════════════════════════════════════════════════
// GUARD — ensure Supabase SDK loaded
// ════════════════════════════════════════════════════════════════
if (typeof supabase === 'undefined') {
    if (typeof readStoredAppLang === 'function' && typeof i18nNormalizeLang === 'function') {
        appUiLang = i18nNormalizeLang(readStoredAppLang() || 'en');
    }
    var _sdkT = (typeof t === 'function') ? t : function(k) { return k; };
    document.body.innerHTML =
        '<div style="padding:60px;text-align:center;font-family:sans-serif;">' +
        '<h2 style="color:#dc3545;">' + _sdkT('guard.sdkTitle') + '</h2>' +
        '<p style="color:#666;">' + _sdkT('guard.sdkHint') + '</p>' +
        '<button onclick="location.reload()" ' +
        'style="padding:10px 24px;background:#0084ff;color:white;' +
        'border:none;border-radius:6px;cursor:pointer;font-size:15px;">' +
        _sdkT('guard.sdkRefresh') + '</button></div>';
    throw new Error('Supabase SDK missing');
}

// ════════════════════════════════════════════════════════════════
// CONFIG
// ════════════════════════════════════════════════════════════════
var SB = supabase.createClient(
    'https://kprihawipljrltfzpfjd.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
    'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi' +
    'cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0.' +
    'fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4'
);

/** Parse doctors.qualification / qualification_chinese (plain text, newlines, or JSON array). */
function parseDoctorQualList(raw) {
    var s = String(raw || '').trim();
    if (!s) return [];
    if (s.charAt(0) === '[') {
        try {
            var parsed = JSON.parse(s);
            if (Array.isArray(parsed)) {
                return parsed.map(function (x) { return String(x || '').trim(); }).filter(Boolean);
            }
        } catch (e) { /* legacy */ }
    }
    if (s.indexOf('\n') >= 0) {
        return s.split(/\r?\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    return [s];
}

/** Store qualification list: one line = plain string; multiple = JSON array. */
function serializeDoctorQualList(list) {
    var out = (list || []).map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    if (!out.length) return '';
    if (out.length === 1) return out[0];
    return JSON.stringify(out);
}

function doctorQualEnglishList(d) {
    return parseDoctorQualList(d && d.qualification);
}

function doctorQualChineseList(d) {
    return parseDoctorQualList(d && (d.qualification_chinese || d.qualification_chi));
}

function doctorQualEnglishDisplay(d) {
    return doctorQualEnglishList(d).join('\n');
}

function doctorQualChineseDisplay(d) {
    var norm = (typeof conFormsNormalizeQualificationChi === 'function')
        ? conFormsNormalizeQualificationChi
        : function (x) {
            return String(x || '').trim().replace(/學學士/g, '學士').replace(/醫學學士/g, '醫學士');
        };
    return doctorQualChineseList(d).map(norm).filter(Boolean).join('\n');
}

/** HTML for document templates (one line per qualification). */
function doctorQualEnglishHtml(d) {
    return doctorQualEnglishList(d).map(function (line) {
        var t = String(line || '').trim().toUpperCase();
        return (typeof esc === 'function') ? esc(t) : t;
    }).join('<br>');
}

function doctorQualChineseHtml(d) {
    var norm = (typeof conFormsNormalizeQualificationChi === 'function')
        ? conFormsNormalizeQualificationChi
        : function (x) { return String(x || '').trim(); };
    return doctorQualChineseList(d).map(function (line) {
        var t = norm(line);
        return (typeof esc === 'function') ? esc(t) : t;
    }).join('<br>');
}

/** Placeholders whose values are pre-built HTML (must not be double-escaped). */
var DOC_RAW_HTML_PLACEHOLDERS = {
    doctor_qualification: true,
    doctor_qualification_chi: true
};

/** Unwrap rich-editor markup inside {placeholder} tokens so replacement still works. */
function normalizeTplPlaceholderMarkup(html) {
    var s = String(html || '');
    s = s.replace(/&#123;/gi, '{').replace(/&#125;/gi, '}');
    s = s.replace(/\{([^}]*)\}/g, function (m, inner) {
        var plain = String(inner || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
        if (!plain) return m;
        return '{' + plain + '}';
    });
    return s;
}

function replaceDocumentPlaceholders(html, map) {
    var out = normalizeTplPlaceholderMarkup(html);
    var data = map || {};
    var keys = Object.keys(data).sort(function (a, b) { return b.length - a.length; });
    keys.forEach(function (k) {
        var re = new RegExp('\\{' + k.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\}', 'gi');
        var val = data[k] == null ? '' : data[k];
        if (!DOC_RAW_HTML_PLACEHOLDERS[k] && typeof esc === 'function') val = esc(val);
        out = out.replace(re, function () { return String(val); });
    });
    return out;
}

/** Update program_settings by key; insert if missing (avoids upsert/onConflict DB mismatches). */
function persistProgramSettingRow(row) {
    if (!SB || typeof SB.from !== 'function') {
        return Promise.resolve({ error: { message: 'Database client is not available.' } });
    }
    return SB.from('program_settings')
        .update({ setting_value: row.setting_value })
        .eq('setting_key', row.setting_key)
        .select('setting_key')
        .then(function (up) {
            if (up.error) return up;
            if (up.data && up.data.length) return up;
            return SB.from('program_settings').insert([row]);
        });
}

// ════════════════════════════════════════════════════════════════
// GLOBAL STATE
// ════════════════════════════════════════════════════════════════
var currentRole = null;
var currentName = null;
var currentUserId = null;
var currentClinicId = null;
var currentClinicLabel = null;
var currentDoctorId = null;
var currentDoctorName = null;

var APP_CLINICS = [];
var APP_DOCTORS = [];
/** Doctor profile ids with an active doctor/dentist login in Configuration → Users. */
var APP_DOCTOR_LOGIN_IDS = {};
/** Login mode for doctor dropdown: default | staff | doctor */
var loginDoctorSelectMode = 'default';
var loginDoctorAllowedIds = null;

var PATIENT_CLINIC_TAG_FIELD = 'clinic_tag';
var APPOINTMENT_CLINIC_TAG_FIELD = 'clinic_tag';
var TREATMENT_CLINIC_TAG_FIELD = 'clinic_tag';

/** Populated after DOM exists; refreshed when clinics load. */
var CLINIC_TAG_FILTER_SELECT_IDS = [
    'patientDirClinicFilter',
    'recallClinicFilter',
    'conPsClinicFilter',
    'conPsClinicFilterMed',
    'conPsClinicFilterDen',
    'conPsClinicFilterXray',
    'conPsClinicFilterPhoto',
    'conPsClinicFilterChart',
    'conFormsPsClinicFilter',
    'aiBirthClinicFilter',
    'aiRecallClinicFilter',
    'reportPatientDirClinicFilter'
];

/** Consultation module patient-search clinic filters (all subtabs). */
var CONSULTATION_CLINIC_FILTER_SELECT_IDS = [
    'conPsClinicFilter',
    'conPsClinicFilterMed',
    'conPsClinicFilterDen',
    'conPsClinicFilterXray',
    'conPsClinicFilterPhoto',
    'conPsClinicFilterChart',
    'conFormsPsClinicFilter'
];

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════
function g(id) { return document.getElementById(id); }

function appTr(key) {
    return (typeof t === 'function') ? t(key) : key;
}

function appTrRepl(key, pairs) {
    var s = appTr(key);
    if (pairs) {
        Object.keys(pairs).forEach(function(k) {
            s = s.split('{' + k + '}').join(String(pairs[k]));
        });
    }
    return s;
}
var uiClickGuardBound = false;
var UI_CLICK_GUARD_MS = 650;

/**
 * Prevent accidental double-clicks from triggering duplicate render/data actions.
 * Opt out per element with data-no-click-guard="1".
 */
function bindUiClickGuardOnce() {
    if (uiClickGuardBound) return;
    uiClickGuardBound = true;

    function targetBtn(ev) {
        var t = ev && ev.target;
        if (!t || !t.closest) return null;
        return t.closest('button,[data-click-guard="1"]');
    }

    document.addEventListener('click', function(ev) {
        var btn = targetBtn(ev);
        if (!btn) return;
        if (btn.getAttribute('data-no-click-guard') === '1') return;
        if (btn.disabled) return;
        var now = Date.now();
        var prev = parseInt(btn.getAttribute('data-last-click-ms') || '0', 10) || 0;
        if (now - prev < UI_CLICK_GUARD_MS) {
            ev.preventDefault();
            ev.stopPropagation();
            return;
        }
        btn.setAttribute('data-last-click-ms', String(now));
    }, true);

    document.addEventListener('dblclick', function(ev) {
        var btn = targetBtn(ev);
        if (!btn) return;
        if (btn.getAttribute('data-no-click-guard') === '1') return;
        ev.preventDefault();
        ev.stopPropagation();
    }, true);
}
function pad(n) { return String(n).padStart(2, '0'); }

function serializePatientDragPayload(p) {
    if (!p || !p.id) return '';
    return JSON.stringify({
        id: p.id,
        patient_no: p.patient_no || '',
        full_name: p.full_name || '',
        chinese_name: p.chinese_name || '',
        phone_number: (typeof activePatientPhoneFromRecord === 'function')
            ? activePatientPhoneFromRecord(p)
            : (p.phone_number || p.mobile_phone || ''),
        hkid: p.hkid || '',
        sex: p.sex || '',
        dob: p.dob || ''
    });
}

function parsePatientDragPayload(raw) {
    if (!raw) return null;
    try {
        var p = JSON.parse(String(raw));
        if (!p || !p.id) return null;
        return p;
    } catch (e) {
        return null;
    }
}

function setPatientDragPayloadSession(p) {
    try {
        window.__JOYFUL_PATIENT_DRAG_PAYLOAD = serializePatientDragPayload(p);
    } catch (_) {}
}

function clearPatientDragPayloadSession() {
    try {
        window.__JOYFUL_PATIENT_DRAG_PAYLOAD = '';
        window.__JOYFUL_APPT_DRAG_APPT_ID = '';
        window.__JOYFUL_PATIENT_DRAG_SOURCE = '';
    } catch (_) {}
}

function markScheduleApptPatientDrag(ev) {
    try {
        window.__JOYFUL_PATIENT_DRAG_SOURCE = 'schedule-appt';
    } catch (_) {}
    if (!ev || !ev.dataTransfer) return;
    try {
        ev.dataTransfer.setData('text/x-joyful-drag-source', 'schedule-appt');
    } catch (_) {}
}

function isScheduleApptPatientDragActive() {
    try {
        return window.__JOYFUL_PATIENT_DRAG_SOURCE === 'schedule-appt';
    } catch (_) {
        return false;
    }
}

function isActivePatientCardDragActive() {
    try {
        return window.__JOYFUL_PATIENT_DRAG_SOURCE === 'active-card';
    } catch (_) {
        return false;
    }
}

function markActivePatientCardDrag(ev) {
    try {
        window.__JOYFUL_PATIENT_DRAG_SOURCE = 'active-card';
    } catch (_) {}
    if (!ev || !ev.dataTransfer) return;
    try {
        ev.dataTransfer.setData('text/x-joyful-drag-source', 'active-card');
    } catch (_) {}
}

function readPatientDragPayloadSession() {
    try {
        return parsePatientDragPayload(window.__JOYFUL_PATIENT_DRAG_PAYLOAD || '');
    } catch (_) {
        return null;
    }
}

function hasPatientDragPayload(ev) {
    if (readPatientDragPayloadSession()) return true;
    try {
        if (window.__JOYFUL_APPT_DRAG_APPT_ID) return true;
    } catch (_) {}
    if (isScheduleApptPatientDragActive()) return true;
    if (!ev || !ev.dataTransfer || !ev.dataTransfer.types) return false;
    var types = ev.dataTransfer.types;
    for (var i = 0; i < types.length; i++) {
        if (types[i] === 'application/x-joyful-patient' ||
            types[i] === 'text/x-joyful-appt-id' ||
            types[i] === 'text/x-joyful-drag-source' ||
            types[i] === 'text/plain') {
            return true;
        }
    }
    return false;
}

/** Resolve patient payload when dropping onto active patient cards (directory, +Appt, calendar). */
function resolvePatientPayloadForDrop(ev) {
    var p = readPatientDragPayloadFromEvent(ev);
    if (p && p.id) return p;
    p = readPatientDragPayloadSession();
    if (p && p.id) return p;
    var apptId = '';
    try {
        apptId = window.__JOYFUL_APPT_DRAG_APPT_ID || '';
    } catch (_) {}
    if (!apptId && ev && ev.dataTransfer) {
        try {
            apptId = ev.dataTransfer.getData('text/x-joyful-appt-id') || '';
        } catch (_) {}
        if (!apptId) {
            var plain = '';
            try { plain = ev.dataTransfer.getData('text/plain') || ''; } catch (_) {}
            if (plain && plain.indexOf('{') !== 0) apptId = plain;
        }
    }
    if (apptId && typeof window.resolvePatientDragPayloadFromPlain === 'function') {
        p = window.resolvePatientDragPayloadFromPlain(apptId);
        if (p && p.id) return p;
    }
    return null;
}

function readPatientDragPayloadFromEvent(ev) {
    if (!ev || !ev.dataTransfer) return null;
    var dt = ev.dataTransfer;
    var p = parsePatientDragPayload(dt.getData('application/x-joyful-patient'));
    if (!p) {
        p = parsePatientDragPayload(dt.getData('text/plain'));
    }
    if (!p) {
        p = readPatientDragPayloadSession();
    }
    if (!p) {
        var apptKey = '';
        try {
            apptKey = dt.getData('text/x-joyful-appt-id') || window.__JOYFUL_APPT_DRAG_APPT_ID || '';
        } catch (_) {
            apptKey = window.__JOYFUL_APPT_DRAG_APPT_ID || '';
        }
        if (!apptKey) {
            var plain = '';
            try { plain = dt.getData('text/plain') || ''; } catch (_) {}
            if (plain && plain.indexOf('{') !== 0) apptKey = plain;
        }
        if (apptKey && typeof window.resolvePatientDragPayloadFromPlain === 'function') {
            p = window.resolvePatientDragPayloadFromPlain(apptKey);
        }
    }
    return p || null;
}

/** Build active-patient payload from an appointment row/card (calendar, + Appointment). */
function patientDragPayloadFromAppt(a) {
    if (!a || !a.patient_id) return null;
    return normalizeActivePatientPayload({
        id: a.patient_id,
        patient_no: a.patient_no || '',
        full_name: a.patient_name || '',
        chinese_name: a.patient_chinese_name || a._merged_chinese_name || '',
        phone_number: a.patient_phone || a._merged_phone || a.phone_number || '',
        mobile_phone: a.patient_mobile || a.mobile_phone || '',
        hkid: a.patient_hkid || a.hkid || '',
        sex: a.patient_sex || a.sex || '',
        dob: a.patient_dob || a.dob || ''
    });
}

/** Start an HTML5 drag that can drop onto active patient cards (and other patient targets). */
function beginPatientDragTransfer(ev, p) {
    if (!ev || !ev.dataTransfer || !p || !p.id) return false;
    var payload = serializePatientDragPayload(p);
    if (!payload) return false;
    setPatientDragPayloadSession(p);
    ev.dataTransfer.effectAllowed = 'copyMove';
    try {
        ev.dataTransfer.setData('application/x-joyful-patient', payload);
        ev.dataTransfer.setData('text/plain', payload);
    } catch (_) {}
    return true;
}

/** Attach patient payload alongside appointment-id drags (schedule rows, calendar pills). */
function beginApptPatientDragTransfer(ev, a) {
    if (!ev || !ev.dataTransfer || !a) return false;
    markScheduleApptPatientDrag(ev);
    var ok = false;
    var p = patientDragPayloadFromAppt(a);
    if (p) ok = beginPatientDragTransfer(ev, p) || ok;
    if (a.id) {
        try {
            window.__JOYFUL_APPT_DRAG_APPT_ID = String(a.id);
            ev.dataTransfer.setData('text/x-joyful-appt-id', String(a.id));
            ok = true;
        } catch (_) {}
    }
    return ok;
}

function activePatientDropLabel(p) {
    if (!p) return '';
    var zh = String(p.chinese_name || '').trim();
    var en = String(p.full_name || '').trim();
    return zh && en ? (zh + ' ' + en) : (zh || en || String(p.patient_no || ''));
}

/**
 * Calendar dates use the PC's local timezone (set Windows to Hong Kong for HK clinic).
 * APP_LOCALE follows display language (en-HK / zh-HK / zh-CN). Do not redefine todayISO elsewhere.
 */
var APP_LOCALE = 'en-HK';

/** Local clinic image store on this PC (x-ray / photo archive). */
var CLINIC_IMAGE_ROOT = 'C:\\Image';
var APP_WORKING_DATE_LS_KEY = 'joyful_working_date_override_v1';
var appWorkingDateOverride = '';

/** Per-filter follow policy for header working-clinic changes. */
var CLINIC_FILTER_FOLLOW_HEADER = {
    patientDirClinicFilter: false,
    recallClinicFilter: true,
    conPsClinicFilter: false,
    conPsClinicFilterMed: false,
    conPsClinicFilterDen: false,
    conPsClinicFilterXray: false,
    conPsClinicFilterPhoto: false,
    conPsClinicFilterChart: false,
    conFormsPsClinicFilter: false,
    aiBirthClinicFilter: false,
    aiRecallClinicFilter: false,
    reportPatientDirClinicFilter: false
};
var WORKING_CLINIC_FOLLOW_LS_KEY = 'joyful_working_clinic_follow_v1';
var WORKING_CLINIC_FOLLOW_DEFAULTS = {
    patientDirClinicFilter: true,
    recallClinicFilter: true,
    reportPatientDirClinicFilter: true
};

function clinicImagePatientDir(patientNo, kind) {
    var root = CLINIC_IMAGE_ROOT.replace(/[\\/]+$/, '');
    var no = String(patientNo || '').trim() || 'unknown';
    if (kind === 'xray' || kind === 'xrays') {
        return root + '\\Xrays\\' + no;
    }
    if (kind === 'photo' || kind === 'photos') {
        return root + '\\Photos\\' + no;
    }
    return root + '\\' + no;
}

function readWorkingDateOverrideFromStore() {
    try {
        var raw = String(localStorage.getItem(APP_WORKING_DATE_LS_KEY) || '').trim();
        if (!raw) return '';
        var d = parseISODateOnly(raw);
        return (d && !isNaN(d.getTime())) ? raw : '';
    } catch (e) {
        return '';
    }
}

function writeWorkingDateOverrideToStore(v) {
    try {
        if (!v) localStorage.removeItem(APP_WORKING_DATE_LS_KEY);
        else localStorage.setItem(APP_WORKING_DATE_LS_KEY, String(v));
    } catch (e) {}
}

function realNowLocal() {
    return new Date();
}

function realTodayISO() {
    return d2iso(realNowLocal());
}

function currentWorkingDateOverride() {
    return String(appWorkingDateOverride || '').trim();
}

function hasEffectiveWorkingDateOverride() {
    var ov = currentWorkingDateOverride();
    return !!(ov && ov !== realTodayISO());
}

function setWorkingDateOverride(isoDate) {
    var iso = String(isoDate || '').trim();
    if (!iso || iso === realTodayISO()) {
        appWorkingDateOverride = '';
        writeWorkingDateOverrideToStore('');
    } else {
        var d = parseISODateOnly(iso);
        if (!d || isNaN(d.getTime())) return;
        appWorkingDateOverride = iso;
        writeWorkingDateOverrideToStore(iso);
    }
    refreshAppSessionStripContents();
    refreshAppSectionsForWorkingDate();
    document.dispatchEvent(new CustomEvent('app-working-date-change', {
        detail: { date: appWorkingDateOverride || '' }
    }));
}

/**
 * After header working-date change: reload panels that key off todayISO() / nowLocal().
 */
function refreshAppSectionsForWorkingDate() {
    var workIso = todayISO();

    if (typeof syncApptPlannerDate === 'function') {
        syncApptPlannerDate(workIso, { syncCal: true });
    }
    if (typeof refreshApptPlannerData === 'function') {
        refreshApptPlannerData({ force: true, forcePlusAppt: true });
    }
    if (typeof loadToday === 'function') loadToday();
    if (typeof loadQueue === 'function') loadQueue();

    if (typeof rcDate !== 'undefined' && typeof loadRecallPatients === 'function') {
        var recallPane = g('tab-recall');
        if (recallPane && recallPane.classList.contains('active')) {
            rcDate = workIso;
            var rd = parseISODateOnly(workIso);
            if (rd && !isNaN(rd.getTime())) {
                rcMonthD = new Date(rd.getFullYear(), rd.getMonth(), 1);
            }
            if (typeof renderRcal === 'function') renderRcal();
            loadRecallPatients(rcDate);
        }
    }

    var todayLbl = g('conBannerToday');
    if (todayLbl && typeof fmtNowDateTimeHK === 'function') {
        todayLbl.textContent = fmtNowDateTimeHK();
    }
    if (typeof conPatientId !== 'undefined' && conPatientId) {
        if (typeof loadConNotes === 'function') loadConNotes(conPatientId);
        if (typeof loadConPatientTimeline === 'function') loadConPatientTimeline(conPatientId);
        if (typeof loadDrugHistory === 'function') loadDrugHistory(conPatientId);
    }
    if (typeof conFormsApplyWorkingDateToSickLeave === 'function') {
        conFormsApplyWorkingDateToSickLeave();
    } else if (typeof conFormsInitSickLeaveDefaults === 'function') {
        conFormsInitSickLeaveDefaults();
    }
    if (typeof conFormsSyncSickLeaveDatePanel === 'function') conFormsSyncSickLeaveDatePanel();
    if (typeof conFormsScheduleSickLeaveRender === 'function') conFormsScheduleSickLeaveRender();
    if (typeof conFormsRefreshPlaceholdersInEditor === 'function') {
        conFormsRefreshPlaceholdersInEditor();
    }
    if (g('rxDate')) sv('rxDate', workIso);

    if (typeof refreshBillPanelForWorkingDate === 'function') {
        refreshBillPanelForWorkingDate();
    }

    if (typeof selPatientId !== 'undefined' && selPatientId &&
        typeof loadTreatments === 'function') {
        var detModal = g('patientDetailsModal');
        if (detModal && detModal.style.display === 'block') {
            loadTreatments(selPatientId);
        }
    }

    if (typeof REPORT !== 'undefined' && REPORT && typeof REPORT.refreshForWorkingDate === 'function') {
        REPORT.refreshForWorkingDate();
    }
}

function clearWorkingDateOverride() {
    setWorkingDateOverride('');
}

function appUiLocale() {
    if (typeof appUiLang === 'string' && appUiLang.indexOf('Hant') >= 0) return 'zh-HK';
    if (typeof appUiLang === 'string' && appUiLang.indexOf('CN') >= 0) return 'zh-CN';
    return 'en-HK';
}

function syncAppLocaleFromUiLang() {
    APP_LOCALE = appUiLocale();
}

function clinicDisplayFallback() {
    return appTr('common.clinic');
}

/** UI label: English or Chinese clinic name per selected app language (no [clinic_code] prefix). */
function clinicDisplayName(c) {
    if (!c) return clinicDisplayFallback();
    var chi = String(c.chinese_name || '').trim();
    var eng = String(c.english_name || '').trim();
    if (printUiLangIsChinese()) {
        return chi || eng || String(c.clinic_code || '').trim() || clinicDisplayFallback();
    }
    return eng || chi || String(c.clinic_code || '').trim() || clinicDisplayFallback();
}

function nowLocal() {
    var real = realNowLocal();
    var override = hasEffectiveWorkingDateOverride() ? currentWorkingDateOverride() : '';
    if (!override) return real;
    var d = parseISODateOnly(override);
    if (!d || isNaN(d.getTime())) return real;
    d.setHours(
        real.getHours(),
        real.getMinutes(),
        real.getSeconds(),
        real.getMilliseconds()
    );
    return d;
}

function d2iso(d) {
    return d.getFullYear() + '-' +
           pad(d.getMonth() + 1) + '-' +
           pad(d.getDate());
}

/** Today's calendar date on this PC (YYYY-MM-DD, local — not UTC). */
function todayISO() {
    return d2iso(nowLocal());
}

/** Download CSV as UTF-8 with BOM so Excel displays CJK text correctly. */
function downloadCsvUtf8(filename, csv) {
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/** Timestamp for DB inserts — working calendar date + current local clock time. */
function workingTimestampISO() {
    return nowLocal().toISOString();
}

/** Attach working-date-aware created_at for treatment note rows. */
function withWorkingCreatedAt(row) {
    var out = Object.assign({}, row || {});
    out.created_at = workingTimestampISO();
    return out;
}

/** Calendar date from YYYY-MM-DD (local midnight — matches DB date columns). */
function parseISODateOnly(iso) {
    if (!iso) return null;
    var p = String(iso).trim().split('-');
    if (p.length < 3) return null;
    var y = parseInt(p[0], 10);
    var m = parseInt(p[1], 10) - 1;
    var day = parseInt(p[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(day)) return null;
    return new Date(y, m, day);
}

/** Whole years since date of birth (local calendar, birthday-aware). */
function patientAgeYears(dob) {
    var d = parseISODateOnly(dob);
    if (!d || isNaN(d.getTime())) return null;
    var today = nowLocal();
    var age = today.getFullYear() - d.getFullYear();
    var m = today.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
    return age >= 0 ? age : null;
}

/** DD/MM/YYYY from YYYY-MM-DD (or passthrough). */
function formatDobDisplay(dob) {
    if (!dob) return '—';
    var pts = String(dob).trim().split('-');
    if (pts.length === 3 && pts[0].length === 4) {
        return pts[2] + '/' + pts[1] + '/' + pts[0];
    }
    return String(dob);
}

/** DOB with calculated age for patient info banners and lists. */
function formatDobAge(dob) {
    if (!dob) return '—';
    var dateStr = formatDobDisplay(dob);
    var age = patientAgeYears(dob);
    if (age == null) return dateStr;
    return appTrRepl('con.dob.ageFmt', { DATE: dateStr, AGE: String(age) });
}

function fmt12(t) {
    if (!t) return '-';
    var p = String(t).split(':');
    var h = parseInt(p[0], 10);
    var m = parseInt(p[1] || '0', 10);
    if (isNaN(h) || isNaN(m)) return '-';
    var d = new Date(2000, 0, 1, h, m, 0);
    return d.toLocaleTimeString(appUiLocale(), {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

/** Localized date + time for timestamps (created_at, etc.). */
function fmtDateTime(iso) {
    if (!iso) return '—';
    try {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '—';
        return d.toLocaleString(appUiLocale(), {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch (e) {
        return '—';
    }
}

function addMins(t, mins) {
    var p     = String(t).split(':');
    var total = parseInt(p[0], 10) * 60 +
                parseInt(p[1], 10) +
                parseInt(mins,  10);
    return pad(Math.floor(total / 60) % 24) + ':' + pad(total % 60);
}

function fmtDateLong(iso, opt) {
    opt = opt || {};
    var d = iso ? parseISODateOnly(iso) : nowLocal();
    if (!d || isNaN(d.getTime())) return '-';
    return d.toLocaleDateString(APP_LOCALE, {
        weekday: opt.long ? 'long'  : 'short',
        day:     'numeric',
        month:   opt.long ? 'long'  : 'short',
        year:    'numeric'
    });
}

/** Long heading for “today” (appointment module header, etc.). */
function fmtTodayLong() {
    return nowLocal().toLocaleDateString(APP_LOCALE, {
        weekday: 'long',
        day:     'numeric',
        month:   'long',
        year:    'numeric'
    });
}

/** Session strip: local calendar date + time (Hong Kong format). */
function fmtNowDateTimeHK() {
    var d = nowLocal();
    return d.toLocaleDateString(APP_LOCALE, {
        weekday: 'short',
        day:     'numeric',
        month:   'short',
        year:    'numeric'
    }) + ' ' + d.toLocaleTimeString(APP_LOCALE, {
        hour:   '2-digit',
        minute: '2-digit',
        hour12: true
    });
}

function esc(s) {
    return String(s || '')
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;');
}

/** Bundled CJK font CSS for popup/iframe print HTML. */
function appCjkFontLinkHtml() {
    var bust = (typeof window.__JSM_WITH_BUST === 'function')
        ? window.__JSM_WITH_BUST('fonts/cjk-fonts.css')
        : 'fonts/cjk-fonts.css';
    return '<link rel="stylesheet" href="' + bust + '">';
}

/** M / F / unknown from patients.sex */
function patientSexKind(sex) {
    var s = String(sex || '').trim().toUpperCase();
    if (s === 'M' || s === 'MALE') return 'male';
    if (s === 'F' || s === 'FEMALE') return 'female';
    return 'unknown';
}

/** Classic ♀ / ♂ symbol (HTML). opt.banner = on blue consultation banner */
function patientSexSymbolHtml(sex, opt) {
    opt = opt || {};
    var kind = patientSexKind(sex);
    if (kind === 'unknown' && opt.hideUnknown) return '';
    var sym = kind === 'male' ? '\u2642' : kind === 'female' ? '\u2640' : '\u2014';
    var title = kind === 'male'
        ? appTr('patient.form.sexMale')
        : kind === 'female'
            ? appTr('patient.form.sexFemale')
            : appTr('patient.form.sexNotSet');
    var cls = 'patient-sex-icon patient-sex-icon--' + kind;
    if (opt.banner) cls += ' patient-sex-icon--banner';
    if (opt.size === 'lg') cls += ' patient-sex-icon--lg';
    return '<span class="' + cls + '" title="' + esc(title) + '" aria-label="' +
        esc(title) + '">' + sym + '</span>';
}

function sv(id, val) {
    var e = g(id);
    if (e) e.value = (val === null || val === undefined) ? '' : String(val);
}

function fmt2(n) {
    return parseFloat(n || 0).toFixed(2);
}

/** UI label: English or Chinese name per selected app language (no [doctor_code] prefix). */
function doctorDisplayName(doc) {
    if (!doc) return '';
    var chi = String(doc.chinese_name || '').trim();
    var eng = String(doc.english_name || doc.display_name || '').trim();
    if (printUiLangIsChinese()) {
        return chi || eng || String(doc.doctor_code || '').trim();
    }
    return eng || chi || String(doc.doctor_code || '').trim();
}

/** Internal doctor code for storage/filtering — not shown in UI. */
function doctorTagFromDoc(doc) {
    if (!doc) return '';
    return String(doc.doctor_code || '').trim();
}

/** True when UI/print locale should prefer Chinese doctor names on documents. */
function printUiLangIsChinese() {
    return typeof appUiLang === 'string' && appUiLang.indexOf('zh') >= 0;
}

/**
 * Confirm before any print: remind user about zoom scale and hidden print dialogs.
 * @returns {boolean} true when user chose to continue
 */
function confirmPrintReminder() {
    var msg =
        '列印前請留意：\n\n' +
        '1) 請記得調整縮放比例，以免字體太細。\n\n' +
        '2) 未回應的列印視窗可能會躲在後方，令介面不能按鍵。\n\n' +
        '是否繼續列印？';
    if (typeof tr === 'function') {
        msg = tr('common.printReminderMsg');
    } else if (typeof conTr === 'function') {
        msg = conTr('common.printReminderMsg');
    }
    return window.confirm(msg);
}

/** Inline script for print popup documents — close window after print dialog finishes. */
function printPopupAutoCloseInlineScript() {
    return 'var __ppDone=false;' +
        'function __ppClose(){if(__ppDone)return;__ppDone=true;' +
        'setTimeout(function(){try{window.close();}catch(e){}},300);}' +
        'window.addEventListener("afterprint",__ppClose);' +
        'try{var __ppMq=window.matchMedia&&window.matchMedia("print");' +
        'if(__ppMq){var __ppCh=function(e){if(!e.matches)__ppClose();};' +
        '__ppMq.addEventListener?__ppMq.addEventListener("change",__ppCh):' +
        '__ppMq.addListener&&__ppMq.addListener(__ppCh);}}catch(e1){}';
}

/** Wire an opened print popup (parent context) to auto-close after printing. */
function wirePrintPopupAutoClose(win) {
    if (!win) return;
    var done = false;
    function closeAfterPrint() {
        if (done) return;
        done = true;
        setTimeout(function () {
            try { win.close(); } catch (e) {}
        }, 300);
    }
    try { win.addEventListener('afterprint', closeAfterPrint); } catch (e0) {}
    try {
        var mq = win.matchMedia && win.matchMedia('print');
        if (mq) {
            var onChange = function (ev) {
                if (!ev.matches) closeAfterPrint();
            };
            if (mq.addEventListener) mq.addEventListener('change', onChange);
            else if (mq.addListener) mq.addListener(onChange);
        }
    } catch (e1) {}
}

function stripDoctorTagPrefix(text) {
    return String(text || '').trim().replace(/^\[[^\]]+\]\s*/, '');
}

/**
 * Resolve doctor profile for printing from bill/appointment row or doctors table row.
 * Never returns bracketed [doctor_code] tags — names only.
 */
function resolveDoctorForPrint(source, profileOverride) {
    source = source || {};
    var hit = profileOverride || null;
    var docs = (typeof APP_DOCTORS !== 'undefined' && Array.isArray(APP_DOCTORS))
        ? APP_DOCTORS
        : [];

    if (!hit && source.doctor_id) {
        hit = getDoctorById(source.doctor_id);
    }
    if (!hit) {
        var names = [
            stripDoctorTagPrefix(source.doctor_name),
            stripDoctorTagPrefix(source.doctor_tag),
            stripDoctorTagPrefix(source.dentist_name)
        ].filter(Boolean);
        var dn = names[0] || '';
        if (dn) {
            var key = dn.toLowerCase();
            hit = docs.find(function(d) {
                if (!d) return false;
                var d1 = String(d.display_name || '').trim().toLowerCase();
                var d2 = String(d.english_name || '').trim().toLowerCase();
                var d3 = String(d.chinese_name || '').trim().toLowerCase();
                return key === d1 || key === d2 || key === d3;
            }) || null;
        }
    }

    var eng = '';
    var chi = '';
    if (hit) {
        eng = String(hit.english_name || hit.display_name || '').trim();
        chi = String(hit.chinese_name || '').trim();
    }
    if (!eng) {
        eng = stripDoctorTagPrefix(source.doctor_name || source.dentist_name || source.doctor_tag || '');
    }
    return {
        doc: hit,
        english_name: eng,
        chinese_name: chi,
        display_name: hit ? String(hit.display_name || '').trim() : ''
    };
}

/** Single doctor name line for printed documents (no [code] prefix). */
function printDoctorDisplayName(source, lang, profileOverride) {
    var rec = resolveDoctorForPrint(source, profileOverride);
    var useZh = lang === 'zh' || (lang !== 'en' && printUiLangIsChinese());
    if (useZh) {
        var chi = String(rec.chinese_name || '').trim();
        if (chi) {
            if (chi.indexOf('牙科醫生') < 0 && chi.indexOf('牙醫') < 0) {
                chi += ' 牙科醫生';
            }
            return chi;
        }
    }
    var eng = String(rec.english_name || rec.display_name || '').trim();
    if (!eng) eng = stripDoctorTagPrefix(source.doctor_name || source.dentist_name || source.doctor_tag || '');
    if (!eng) eng = '—';
    if (eng !== '—' && !/^dr\b\.?/i.test(eng)) eng = 'Dr ' + eng;
    return eng;
}

function getDoctorById(id) {
    if (!id || !Array.isArray(APP_DOCTORS)) return null;
    return APP_DOCTORS.find(function(d) { return d.id === id; }) || null;
}

/** Staff login identity codes (ALL, ALL_TKO, …) — not real doctors for scheduling. */
function isLoginPlaceholderDoctorCode(code) {
    var c = String(code || '').trim().toLowerCase();
    if (!c) return false;
    if (c === 'all') return true;
    if (/^all[_-]/.test(c)) return true;
    return false;
}

/** True when a doctor row is a real clinician (active, has code, not a login placeholder). */
function isClinicalDoctorRecord(d) {
    if (!d || d.is_active === false) return false;
    if (!String(d.doctor_code || '').trim()) return false;
    return !isLoginPlaceholderDoctorCode(d.doctor_code);
}

/** Normalize doctor name for duplicate checks. */
function normalizeDoctorNameKey(v) {
    return String(v || '').trim().toLowerCase()
        .replace(/^dr\.?\s+/i, '')
        .replace(/\s+/g, ' ');
}

/** Plain admin label "NG Pui Ching" (no Dr prefix) — not the clinical boss identity. */
function isAdminNgPuiChingLabel(v) {
    var s = String(v || '').trim().replace(/\s+/g, ' ');
    if (!s) return false;
    if (/^dr\.?\s+/i.test(s)) return false;
    return /^ng\s+pui\s+ching$/i.test(s);
}

/** Clinical label "Dr NG PUI CHING" — keep on bill doctor picker. */
function isClinicalNgPuiChingLabel(v) {
    var s = String(v || '').trim().replace(/\s+/g, ' ');
    return /^dr\.?\s+ng\s+pui\s+ching$/i.test(s);
}

/** Normalized names hidden from bill payment doctor picker (UI only; DB unchanged). */
var BILL_DROPDOWN_EXCLUDED_NAME_KEYS = {
    'tam jee yan jamilla': true,
    'wong ming': true
};

function isBillDropdownExcludedNameKey(key) {
    return !!(key && BILL_DROPDOWN_EXCLUDED_NAME_KEYS[key]);
}

function billDoctorRecordNameKeys(d) {
    var seen = {};
    [d && d.display_name, d && d.english_name, d && d.chinese_name].forEach(function (v) {
        var k = normalizeDoctorNameKey(v);
        if (k) seen[k] = true;
    });
    if (typeof billDoctorDropdownLabel === 'function') {
        var shown = normalizeDoctorNameKey(billDoctorDropdownLabel(d));
        if (shown) seen[shown] = true;
    } else if (typeof doctorDisplayName === 'function') {
        var fallback = normalizeDoctorNameKey(doctorDisplayName(d));
        if (fallback) seen[fallback] = true;
    }
    return Object.keys(seen);
}

/** Non-clinical identities hidden from bill payment doctor picker (UI only). */
function isBillDropdownExcludedDoctor(d) {
    if (!d) return true;
    if (!isClinicalDoctorRecord(d)) return true;
    var fields = [d.display_name, d.english_name, d.chinese_name];
    for (var i = 0; i < fields.length; i++) {
        if (isClinicalNgPuiChingLabel(fields[i])) return false;
    }
    for (var j = 0; j < fields.length; j++) {
        if (isAdminNgPuiChingLabel(fields[j])) return true;
    }
    var nameKeys = billDoctorRecordNameKeys(d);
    for (var k = 0; k < nameKeys.length; k++) {
        if (isBillDropdownExcludedNameKey(nameKeys[k])) return true;
    }
    var shown = typeof doctorDisplayName === 'function' ? doctorDisplayName(d) : '';
    if (isClinicalNgPuiChingLabel(shown)) return false;
    if (isAdminNgPuiChingLabel(shown)) return true;
    return false;
}

/** Label shown in bill payment doctor dropdown. */
function billDoctorDropdownLabel(d) {
    if (!d) return '';
    var disp = String(d.display_name || '').trim();
    if (disp && /^dr\.?\s+/i.test(disp)) return disp;
    if (typeof doctorDisplayName === 'function') {
        var shown = doctorDisplayName(d);
        if (shown) return shown;
    }
    return d.english_name || d.chinese_name || disp || String(d.doctor_code || '').trim();
}

/** Stable dedupe key — normalized picker label first (collapses casing / duplicate rows). */
function billDoctorDropdownDedupeKey(d) {
    if (!d) return '';
    var labelKey = normalizeDoctorNameKey(billDoctorDropdownLabel(d));
    if (labelKey) return 'name:' + labelKey;
    var code = String(d.doctor_code || '').trim().toLowerCase();
    if (code && !isLoginPlaceholderDoctorCode(code)) return 'code:' + code;
    return 'id:' + String(d.id != null ? d.id : '');
}

function billDoctorDropdownPickBest(candidates) {
    return (candidates || []).slice().sort(function (a, b) {
        var aDisp = String(a.display_name || '').trim();
        var bDisp = String(b.display_name || '').trim();
        var aDr = /^dr\.?\s+/i.test(aDisp) ? 0 : 1;
        var bDr = /^dr\.?\s+/i.test(bDisp) ? 0 : 1;
        if (aDr !== bDr) return aDr - bDr;
        if (aDisp.length !== bDisp.length) return bDisp.length - aDisp.length;
        var ac = String(a.doctor_code || '').trim();
        var bc = String(b.doctor_code || '').trim();
        if (ac !== bc) return ac < bc ? -1 : 1;
        return String(a.id || '').localeCompare(String(b.id || ''));
    })[0] || null;
}

/** Active clinical doctors for bill payment dropdown — deduped by code or normalized label. */
function doctorsForBillDoctorDropdown(sourceList) {
    var list = (sourceList || []).filter(function (d) {
        return d && d.is_active !== false && !isBillDropdownExcludedDoctor(d);
    });
    var groups = {};
    list.forEach(function (d) {
        var key = billDoctorDropdownDedupeKey(d);
        if (!groups[key]) groups[key] = [];
        groups[key].push(d);
    });
    var out = Object.keys(groups).map(function (key) {
        return billDoctorDropdownPickBest(groups[key]);
    }).filter(Boolean);
    out.sort(function (a, b) {
        var al = String(billDoctorDropdownLabel(a) || '').toLowerCase();
        var bl = String(billDoctorDropdownLabel(b) || '').toLowerCase();
        if (al < bl) return -1;
        if (al > bl) return 1;
        return 0;
    });
    return out;
}

/** Active doctors for one clinic (by doctors.clinic_id). */
function doctorsForClinic(clinicId) {
    if (!clinicId) return (APP_DOCTORS || []).slice();
    return (APP_DOCTORS || []).filter(function (d) {
        return d.clinic_id === clinicId;
    });
}

function selectedLoginClinicId() {
    var sel = g('loginClinic');
    return sel ? String(sel.value || '').trim() : '';
}

function userLoginDoctorIds(u) {
    var out = [];
    function add(id) {
        id = String(id || '').trim();
        if (id && out.indexOf(id) < 0) out.push(id);
    }
    if (!u) return out;
    add(u.doctor_id);
    var perms = u.permissions || {};
    if (typeof perms === 'string') {
        try { perms = JSON.parse(perms); } catch (_) { perms = {}; }
    }
    var extra = perms.login_doctor_ids || perms.doctor_ids || [];
    if (typeof extra === 'string') {
        extra = extra.split(',');
    }
    if (Array.isArray(extra)) {
        extra.forEach(add);
    }
    return out;
}

function rebuildDoctorLoginIdsFromUsers(users) {
    APP_DOCTOR_LOGIN_IDS = {};
    (users || []).forEach(function (u) {
        if (u.is_active === false) return;
        var role = String(u.role || '').toLowerCase();
        if (role === 'doctor' || role === 'dentist') {
            userLoginDoctorIds(u).forEach(function (id) {
                APP_DOCTOR_LOGIN_IDS[String(id)] = true;
            });
        }
    });
}

function isNonDoctorAppRole(role) {
    role = String(role || '').toLowerCase();
    return role !== 'doctor' && role !== 'dentist';
}

function doctorsForLoginDropdown(mode, clinicId) {
    var list = doctorsForClinic(clinicId);
    if (mode === 'staff') return list;
    list = list.filter(function (d) {
        return !!APP_DOCTOR_LOGIN_IDS[String(d.id)];
    });
    if (Array.isArray(loginDoctorAllowedIds) && loginDoctorAllowedIds.length) {
        list = list.filter(function (d) {
            return loginDoctorAllowedIds.indexOf(String(d.id)) >= 0;
        });
    }
    return list;
}

function loginDoctorOptionLabel(d) {
    if (!d) return 'Doctor';
    var code = String(d.doctor_code || '').trim();
    var name = doctorDisplayName(d) || 'Doctor';
    return code ? (name + ' [' + code + ']') : name;
}

function populateLoginClinicSelect(preselectClinicId) {
    var sel = g('loginClinic');
    if (!sel) return;
    var prev = (preselectClinicId !== undefined && preselectClinicId !== null)
        ? String(preselectClinicId || '')
        : String(sel.value || '');
    sel.innerHTML = '';

    var allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = appTr('common.all');
    sel.appendChild(allOpt);

    var clinics = clinicsForWorkingSession();
    if (!clinics.length) {
        allOpt.textContent = appTr('common.noClinics');
        return;
    }

    clinics.forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = clinicDisplayName(c);
        sel.appendChild(o);
    });

    var hasPrev = false;
    for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === prev) {
            hasPrev = true;
            break;
        }
    }
    sel.value = hasPrev ? prev : '';
}

function bindLoginClinicSelectOnce() {
    var sel = g('loginClinic');
    if (!sel || sel.dataset.bound) return;
    sel.dataset.bound = '1';
    sel.addEventListener('change', function () {
        var drSel = g('loginDoctor');
        refreshLoginDoctorSelect(drSel && drSel.value ? drSel.value : '', loginDoctorSelectMode);
    });
}

/**
 * Login doctor list:
 * - default / doctor: only doctors with a login in Configuration (Users → doctor link)
 * - staff: all active doctors + ALL (non-doctor users)
 */
function refreshLoginDoctorSelect(preselectDoctorId, mode) {
    var sel = g('loginDoctor');
    if (!sel) return;
    if (mode) loginDoctorSelectMode = mode;
    var useMode = loginDoctorSelectMode || 'default';
    var list = doctorsForLoginDropdown(useMode, selectedLoginClinicId());
    var hint = g('loginDoctorHint');
    var label = g('loginDoctorLabel');

    if (label) {
        label.textContent = useMode === 'staff'
            ? appTr('login.doctorOptional')
            : appTr('login.doctorRequired');
    }
    if (hint) {
        hint.textContent = useMode === 'staff'
            ? appTr('login.hintStaff')
            : appTr('login.hintDoctor');
    }

    if (!list.length && useMode !== 'staff') {
        sel.innerHTML = '<option value="">' + esc(appTr('login.noDoctorLogins')) + '</option>';
        return;
    }

    var html = '';
    if (useMode === 'staff') {
        html += '<option value="">' + esc(appTr('login.selectAllOpt')) + '</option>';
    } else {
        html += '<option value="">' + esc(appTr('login.selectDoctorOpt')) + '</option>';
    }
    html += list.map(function (d) {
        return '<option value="' + esc(d.id) + '">' + esc(loginDoctorOptionLabel(d)) + '</option>';
    }).join('');
    sel.innerHTML = html;

    if (preselectDoctorId) {
        sel.value = preselectDoctorId;
        if (sel.value !== preselectDoctorId && useMode === 'staff') {
            sel.value = '';
        }
    }
}

function setLoginDoctorSelectModeForUser(u) {
    if (!u) {
        loginDoctorSelectMode = 'default';
        loginDoctorAllowedIds = null;
        refreshLoginDoctorSelect();
        return;
    }
    var role = String(u.role || '').toLowerCase();
    var ids = userLoginDoctorIds(u);
    var preselect = ids.length ? ids[0] : '';
    if (role === 'admin' || isNonDoctorAppRole(role)) {
        loginDoctorAllowedIds = null;
        refreshLoginDoctorSelect(preselect, 'staff');
    } else {
        loginDoctorAllowedIds = ids;
        refreshLoginDoctorSelect(preselect, 'doctor');
    }
}

function applyIdentityFromDoctor(doctorId) {
    var doc = getDoctorById(doctorId);
    currentDoctorId = doctorId || null;
    currentDoctorName = doc ? (doctorDisplayName(doc) || null) : null;
    if (currentDoctorName) currentName = currentDoctorName;
}

function populateReportClinicSelect() {
    var sel = g('reportClinicSelect');
    if (!sel) return;
    var prev = sel.value || currentClinicId || '';
    sel.innerHTML = '';
    if (!APP_CLINICS || !APP_CLINICS.length) {
        sel.innerHTML = '<option value="">' + esc(appTr('common.noClinics')) + '</option>';
        return;
    }
    var allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = appTr('common.all');
    sel.appendChild(allOpt);
    clinicsForWorkingSession().forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = clinicDisplayName(c);
        sel.appendChild(o);
    });
    var def = typeof defaultWorkingClinicId === 'function'
        ? defaultWorkingClinicId()
        : '';
    var has = false;
    for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === prev) { has = true; break; }
    }
    sel.value = has ? prev : def;
}

function onReportClinicChange() {
    var sel = g('reportClinicSelect');
    if (!sel) return;
    if (sel.value && typeof setWorkingClinic === 'function') {
        setWorkingClinic(sel.value, { syncFilters: true, reloadAppt: false, refreshVisible: true });
        showClinicRefreshToast(sel.value, false);
    } else if (typeof REPORT !== 'undefined' && typeof REPORT.refresh === 'function') {
        REPORT.refresh();
        if (typeof triggerGlobalRefresh === 'function') {
            triggerGlobalRefresh({ skipReport: true });
        }
        showClinicRefreshToast('', true);
    }
}

function bindReportClinicSelectOnce() {
    var sel = g('reportClinicSelect');
    if (!sel || sel.dataset.bound) return;
    sel.dataset.bound = '1';
    sel.addEventListener('change', onReportClinicChange);
}

function initReportModuleClinic() {
    populateReportClinicSelect();
    bindReportClinicSelectOnce();
    var sel = g('reportClinicSelect');
    if (sel && sel.value && typeof setWorkingClinic === 'function') {
        setWorkingClinic(sel.value, { syncFilters: true, reloadAppt: false });
    }
}

function populateWorkingClinicSelect() {
    var sel = g('appWorkingClinicSelect');
    if (!sel) return;
    var prev = sel.value || currentClinicId || '';
    sel.innerHTML = '';
    if (!APP_CLINICS || !APP_CLINICS.length) {
        sel.innerHTML = '<option value="">' + esc(appTr('common.noClinics')) + '</option>';
        return;
    }
    clinicsForWorkingSession().forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = clinicDisplayName(c);
        sel.appendChild(o);
    });
    var def = typeof defaultWorkingClinicId === 'function'
        ? defaultWorkingClinicId()
        : '';
    var has = false;
    for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === prev) { has = true; break; }
    }
    sel.value = has ? prev : def;
}

function dashboardDoctorsForClinic(clinicId) {
    var list = (typeof APP_DOCTORS !== 'undefined' && APP_DOCTORS) ? APP_DOCTORS : [];
    if (clinicId) {
        if (typeof doctorsForClinic === 'function') {
            list = doctorsForClinic(clinicId);
        } else {
            list = list.filter(function (d) { return d && d.clinic_id === clinicId; });
        }
    }
    return (list || []).filter(function (d) {
        return typeof isClinicalDoctorRecord === 'function'
            ? isClinicalDoctorRecord(d)
            : (d && d.is_active !== false && String(d.doctor_code || '').trim());
    });
}

function dashboardDoctorOptionLabel(d) {
    if (!d) return '';
    var code = String(d.doctor_code || '').trim();
    var name = (typeof doctorDisplayName === 'function')
        ? doctorDisplayName(d)
        : (d.display_name || d.english_name || d.chinese_name || code);
    return code ? (name + ' [' + code + ']') : name;
}

function populateDashboardClinicSelect() {
    var sel = g('dashClinicSelect');
    if (!sel) return;
    var prev = sel.value || currentClinicId || '';
    sel.innerHTML = '';
    if (!APP_CLINICS || !APP_CLINICS.length) {
        sel.innerHTML = '<option value="">' + esc(appTr('common.noClinics')) + '</option>';
        return;
    }
    clinicsForWorkingSession().forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = clinicDisplayName(c);
        sel.appendChild(o);
    });
    var def = typeof defaultWorkingClinicId === 'function' ? defaultWorkingClinicId() : '';
    var has = Array.prototype.some.call(sel.options || [], function (o) {
        return o.value === prev;
    });
    sel.value = has ? prev : def;
}

function populateDashboardDoctorSelect(preselectId) {
    var sel = g('dashDoctorSelect');
    if (!sel) return;
    var clinicSel = g('dashClinicSelect');
    var clinicId = clinicSel ? clinicSel.value : currentClinicId;
    var prev = preselectId != null ? preselectId : (sel.value || currentDoctorId || '');
    var docs = dashboardDoctorsForClinic(clinicId);
    sel.innerHTML = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = appTr('common.all');
    sel.appendChild(all);
    docs.forEach(function (d) {
        var o = document.createElement('option');
        o.value = d.id;
        o.textContent = dashboardDoctorOptionLabel(d);
        sel.appendChild(o);
    });
    var has = Array.prototype.some.call(sel.options || [], function (o) {
        return o.value === prev;
    });
    sel.value = has ? prev : '';
}

function applyDashboardDoctorSelection(doctorId) {
    if (doctorId) {
        applyIdentityFromDoctor(doctorId);
    } else {
        currentDoctorId = null;
        currentDoctorName = null;
        currentName = currentUserId || currentName;
    }
    persistSession();
    refreshDashboardUserBadge();
    refreshAppSessionStripContents();
    if (typeof updateConsultationDoctorUI === 'function') updateConsultationDoctorUI();
    if (typeof refreshApptHeaderI18n === 'function') refreshApptHeaderI18n();
}

function onDashboardClinicChange() {
    var sel = g('dashClinicSelect');
    if (!sel) return;
    if (sel.value && typeof setWorkingClinic === 'function') {
        setWorkingClinic(sel.value, { syncFilters: true, reloadAppt: true, refreshVisible: true });
        showClinicRefreshToast(sel.value, false);
    }
    populateDashboardDoctorSelect('');
    applyDashboardDoctorSelection('');
}

function onDashboardDoctorChange() {
    var sel = g('dashDoctorSelect');
    if (!sel) return;
    applyDashboardDoctorSelection(sel.value || '');
}

function bindDashboardContextControlsOnce() {
    var csel = g('dashClinicSelect');
    if (csel && csel.dataset.bound !== '1') {
        csel.dataset.bound = '1';
        csel.addEventListener('change', onDashboardClinicChange);
    }
    var dsel = g('dashDoctorSelect');
    if (dsel && dsel.dataset.bound !== '1') {
        dsel.dataset.bound = '1';
        dsel.addEventListener('change', onDashboardDoctorChange);
    }
}

function refreshDashboardContextControls() {
    populateDashboardClinicSelect();
    populateDashboardDoctorSelect(currentDoctorId || '');
    bindDashboardContextControlsOnce();
}

function shouldClinicFilterFollowHeader(filterId) {
    if (!Object.prototype.hasOwnProperty.call(CLINIC_FILTER_FOLLOW_HEADER, filterId)) {
        return false;
    }
    return !!CLINIC_FILTER_FOLLOW_HEADER[filterId];
}

function syncClinicTagFiltersFromWorkingClinic(tag) {
    CLINIC_TAG_FILTER_SELECT_IDS.forEach(function (fid) {
        if (!shouldClinicFilterFollowHeader(fid)) return;
        var fs = g(fid);
        if (!fs) return;
        var matched = false;
        for (var j = 0; j < fs.options.length; j++) {
            if (fs.options[j].value === tag) {
                fs.value = tag;
                matched = true;
                break;
            }
        }
        if (!matched && tag) fs.value = tag;
    });
}

function isWorkingClinicAllValue(v) {
    return String(v || '').trim() === '__all__';
}

/** Clinic still in operation (Configuration → Clinic Profile Active). Multiple may be on. */
function isClinicOperational(c) {
    return !!(c && c.is_active !== false);
}

/** Clinics offered in login / header working-clinic pickers. */
function clinicsForWorkingSession(list) {
    return (list || APP_CLINICS || []).filter(isClinicOperational);
}

/** Working clinic for appointments/print — not tied to login. */
function setWorkingClinic(clinicId, options) {
    options = options || {};
    if (!clinicId) return;
    currentClinicId = clinicId;
    var rec = clinicRecordFromId(clinicId);
    currentClinicLabel = rec
        ? (clinicDisplayName(rec) || null)
        : null;
    var wsel = g('appWorkingClinicSelect');
    if (wsel && wsel.value !== clinicId) wsel.value = clinicId;
    var dashClinicSel = g('dashClinicSelect');
    if (dashClinicSel && dashClinicSel.value !== clinicId) dashClinicSel.value = clinicId;
    var apSel = g('apptClinicSelect');
    if (apSel && apSel.value !== clinicId) apSel.value = clinicId;
    var rptSel = g('reportClinicSelect');
    if (rptSel && rptSel.value !== '' && rptSel.value !== clinicId) rptSel.value = clinicId;

    if (options.syncFilters !== false && typeof currentClinicCodeForTagging === 'function') {
        var tag = currentClinicCodeForTagging();
        syncClinicTagFiltersFromWorkingClinic(tag);
    }

    persistSession();
    refreshAppSessionStripContents();
    populateDashboardDoctorSelect(currentDoctorId || '');
    if (typeof restartRealtimeSync === 'function') restartRealtimeSync();

    if (options.reloadAppt) {
        var apptSec = g('appointmentSection');
        if (apptSec && apptSec.style.display !== 'none') {
            if (typeof reloadApptModuleData === 'function') reloadApptModuleData();
            else {
                if (typeof loadToday === 'function') loadToday();
                if (typeof loadQueue === 'function') loadQueue();
                if (typeof loadApptRecords === 'function') loadApptRecords();
            }
        }
    }

    var rptSec = g('reportSection');
    if (rptSec && rptSec.style.display !== 'none' &&
        typeof REPORT !== 'undefined' && typeof REPORT.refresh === 'function') {
        REPORT.refresh();
    }

    if (options.refreshVisible && typeof triggerGlobalRefresh === 'function') {
        triggerGlobalRefresh({ skipAppt: true, skipReport: true });
    }

    if (typeof CFG !== 'undefined' && typeof CFG.prefetchPrintSettings === 'function') {
        CFG.prefetchPrintSettings(clinicId);
    }
}

function defaultWorkingClinicId() {
    var cur = currentClinicId ? clinicRecordFromId(currentClinicId) : null;
    if (cur && isClinicOperational(cur)) return currentClinicId;
    var ops = clinicsForWorkingSession();
    if (ops.length) return ops[0].id;
    return APP_CLINICS.length ? APP_CLINICS[0].id : null;
}

function prefetchLoginDoctorForUserId(uid) {
    uid = String(uid || '').trim();
    if (!uid) {
        loginDoctorSelectMode = 'default';
        loginDoctorAllowedIds = null;
        refreshLoginDoctorSelect();
        return;
    }
    if (uid.toLowerCase() === 'nurse') {
        loginDoctorAllowedIds = null;
        refreshLoginDoctorSelect('', 'staff');
        return;
    }
    SB.from('app_users')
        .select('doctor_id,role,display_name,is_active,permissions')
        .eq('user_id', uid)
        .eq('is_active', true)
        .limit(1)
    .then(function (r) {
        if (!r.data || !r.data.length) {
            loginDoctorSelectMode = 'default';
            loginDoctorAllowedIds = null;
            refreshLoginDoctorSelect();
            return;
        }
        setLoginDoctorSelectModeForUser(r.data[0]);
    });
}

function getActiveDoctorContext() {
    var role = String(currentRole || '').toLowerCase();
    var doc = getDoctorById(currentDoctorId);
    var name = currentDoctorName || doctorDisplayName(doc) || currentName || null;
    var tag = doctorTagFromDoc(doc) || name || null;
    return {
        id: currentDoctorId || (doc ? doc.id : null) || null,
        name: name,
        tag: tag,
        shouldTag: role === 'doctor' || role === 'dentist'
    };
}

function clinicRecordFromId(clinicId) {
    if (!clinicId || !APP_CLINICS || !APP_CLINICS.length) return null;
    return APP_CLINICS.find(function(c) {
        return String(c.id) === String(clinicId);
    }) || null;
}

/**
 * Map patients.clinic_tag (clinic_code or id string) back to clinics.id for dropdowns.
 */
function clinicIdFromStoredPatientTag(stored) {
    if (!stored || !APP_CLINICS || !APP_CLINICS.length) return '';
    var t = String(stored).trim();
    for (var i = 0; i < APP_CLINICS.length; i++) {
        var c = APP_CLINICS[i];
        if (String(c.id) === t) return String(c.id);
        var code = String(c.clinic_code || '').trim();
        if (code && code === t) return String(c.id);
    }
    return '';
}

/** Value stored on new rows; prefers clinics.clinic_code, else clinic UUID string. */
function currentClinicCodeForTagging() {
    var rec = clinicRecordFromId(currentClinicId);
    if (rec) {
        var code = String(rec.clinic_code || '').trim();
        if (code) return code;
    }
    return currentClinicId ? String(currentClinicId) : '';
}

/** Empty string means ALL (no filter). */
function readClinicTagFilter(selectId) {
    var sel = selectId ? g(selectId) : null;
    if (!sel) return '';
    return String(sel.value || '').trim();
}

function fillClinicTagFilterSelect(selectId, preserveSelection) {
    var sel = selectId ? g(selectId) : null;
    if (!sel) return;
    var prev = preserveSelection !== false ? sel.value : '';
    sel.innerHTML =
        '<option value="" selected>' + esc(appTr('common.all')) + '</option>';
    if (!APP_CLINICS || !APP_CLINICS.length) {
        sel.value = '';
        return;
    }
    APP_CLINICS.forEach(function(c) {
        var code = String(c.clinic_code || '').trim();
        var val = code || String(c.id);
        var label = clinicDisplayName(c);
        var o = document.createElement('option');
        o.value = val;
        o.textContent = label;
        sel.appendChild(o);
    });
    var hasPrev = false;
    if (prev) {
        for (var i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === prev) {
                hasPrev = true;
                break;
            }
        }
    }
    sel.value = hasPrev ? prev : '';
    if (!sel.value && sel.options.length) sel.selectedIndex = 0;
}

function refreshAllClinicTagFilterSelects() {
    CLINIC_TAG_FILTER_SELECT_IDS.forEach(function(id) {
        fillClinicTagFilterSelect(id, true);
    });
}

/** Rebuild consultation subtab clinic dropdowns (locale-aware labels). */
function refreshConsultationClinicFilterSelects() {
    CONSULTATION_CLINIC_FILTER_SELECT_IDS.forEach(function(id) {
        fillClinicTagFilterSelect(id, true);
    });
}

/** Update clinic option labels in-place (keeps selection). */
function refreshClinicSelectLabels(selectId, opts) {
    opts = opts || {};
    var sel = selectId ? g(selectId) : null;
    if (!sel) return;
    var list = opts.clinics || APP_CLINICS;
    if (!list || !list.length) return;
    var prev = sel.value;
    var byId = {};
    var byTag = {};
    list.forEach(function(c) {
        if (!c) return;
        if (c.id != null) byId[String(c.id)] = c;
        var code = String(c.clinic_code || '').trim();
        byTag[code || String(c.id)] = c;
    });
    var matchBy = opts.matchBy || 'id';
    for (var i = 0; i < sel.options.length; i++) {
        var opt = sel.options[i];
        if (!opt.value) {
            if (opts.allOptionKey && typeof appTr === 'function') {
                opt.textContent = appTr(opts.allOptionKey);
            }
            continue;
        }
        var rec = matchBy === 'tag' ? byTag[opt.value] : byId[opt.value];
        if (rec) opt.textContent = clinicDisplayName(rec);
    }
    var hasPrev = false;
    for (var j = 0; j < sel.options.length; j++) {
        if (sel.options[j].value === prev) {
            hasPrev = true;
            break;
        }
    }
    if (hasPrev) sel.value = prev;
}

/** Rebuild or relabel every clinic dropdown when UI language changes. */
function refreshAllClinicDropdowns() {
    if (!APP_CLINICS || !APP_CLINICS.length) return;

    function relabelOrPopulate(selectId, populateFn, relabelOpts) {
        var sel = g(selectId);
        if (!sel) return;
        if (sel.options.length > 0) {
            refreshClinicSelectLabels(selectId, relabelOpts || { matchBy: 'id' });
        } else if (typeof populateFn === 'function') {
            populateFn();
        }
    }

    relabelOrPopulate('appWorkingClinicSelect', populateWorkingClinicSelect);
    relabelOrPopulate('loginClinic', populateLoginClinicSelect,
        { matchBy: 'id', allOptionKey: 'common.all' });
    relabelOrPopulate('reportClinicSelect', populateReportClinicSelect,
        { matchBy: 'id', allOptionKey: 'common.all' });
    relabelOrPopulate('apptClinicSelect', populateApptClinicSelect);
    relabelOrPopulate('plusApptClinicSelect', populatePlusApptClinicSelect);
    relabelOrPopulate('addPatientClinicSelect', fillAddPatientClinicSelect);
    relabelOrPopulate('editPatientClinicSelect', null);
    relabelOrPopulate('docClinicSelect', null);
    relabelOrPopulate('cfgPrintClinicSelect', null);

    if (typeof refreshAllClinicTagFilterSelects === 'function') {
        refreshAllClinicTagFilterSelects();
    }
    if (typeof refreshConsultationClinicFilterSelects === 'function') {
        refreshConsultationClinicFilterSelects();
    }
    if (typeof refreshEditPatientClinicIfModalOpen === 'function') {
        refreshEditPatientClinicIfModalOpen();
    }
    if (typeof plusApptApplyClinicTheme === 'function') {
        plusApptApplyClinicTheme();
    }
    if (currentUserId && typeof refreshAppSessionStripContents === 'function') {
        refreshAppSessionStripContents();
    }
}

function applyPatientQueryClinicTag(builder, filterSelectId) {
    var tag = readClinicTagFilter(filterSelectId);
    if (!tag || !builder) return builder;
    return builder.eq(PATIENT_CLINIC_TAG_FIELD, tag);
}

/** Escape user text for PostgREST ilike patterns inside .or() filters. */
function escapePostgrestIlike(q) {
    return String(q || '').trim()
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
        .replace(/,/g, '');
}

function patientSearchDobFilterParts(q) {
    var parts = [];
    var raw = String(q || '').trim();
    if (!raw) return parts;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        parts.push('dob.eq.' + raw);
        return parts;
    }
    var m = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) {
        var d = ('0' + parseInt(m[1], 10)).slice(-2);
        var mo = ('0' + parseInt(m[2], 10)).slice(-2);
        parts.push('dob.eq.' + m[3] + '-' + mo + '-' + d);
    } else if (/^\d{4}$/.test(raw)) {
        parts.push('dob.gte.' + raw + '-01-01');
        parts.push('dob.lte.' + raw + '-12-31');
    }
    return parts;
}

/** PostgREST .or() filter across common patient directory columns. */
function patientSearchOrFilter(q) {
    var raw = String(q || '').trim();
    if (!raw) return '';
    var safe = escapePostgrestIlike(raw);
    var parts = [
        'full_name.ilike.%' + safe + '%',
        'chinese_name.ilike.%' + safe + '%',
        'patient_no.ilike.%' + safe + '%',
        'phone_number.ilike.%' + safe + '%',
        'mobile_phone.ilike.%' + safe + '%',
        'hkid.ilike.%' + safe + '%',
        'email.ilike.%' + safe + '%',
        'address.ilike.%' + safe + '%',
        'occupation.ilike.%' + safe + '%',
        'remarks.ilike.%' + safe + '%',
        'medical_alerts.ilike.%' + safe + '%',
        'medical_history.ilike.%' + safe + '%',
        'current_medications.ilike.%' + safe + '%',
        'allergy.ilike.%' + safe + '%'
    ];
    var hk = raw.replace(/\s+/g, '').toUpperCase();
    if (hk && hk !== safe.toUpperCase()) {
        parts.push('hkid.ilike.%' + escapePostgrestIlike(hk) + '%');
    }
    var digits = raw.replace(/\D/g, '');
    if (digits.length >= 4 && digits !== raw) {
        parts.push('phone_number.ilike.%' + escapePostgrestIlike(digits) + '%');
        parts.push('mobile_phone.ilike.%' + escapePostgrestIlike(digits) + '%');
        parts.push('patient_no.ilike.%' + escapePostgrestIlike(digits) + '%');
    }
    patientSearchDobFilterParts(raw).forEach(function (p) { parts.push(p); });
    return parts.join(',');
}

/** Narrower .or() when optional patient columns are absent in Supabase. */
function patientSearchOrFilterCore(q) {
    var raw = String(q || '').trim();
    if (!raw) return '';
    var safe = escapePostgrestIlike(raw);
    var parts = [
        'full_name.ilike.%' + safe + '%',
        'chinese_name.ilike.%' + safe + '%',
        'patient_no.ilike.%' + safe + '%',
        'phone_number.ilike.%' + safe + '%',
        'mobile_phone.ilike.%' + safe + '%',
        'hkid.ilike.%' + safe + '%',
        'email.ilike.%' + safe + '%',
        'address.ilike.%' + safe + '%',
        'medical_alerts.ilike.%' + safe + '%'
    ];
    var hk = raw.replace(/\s+/g, '').toUpperCase();
    if (hk && hk !== safe.toUpperCase()) {
        parts.push('hkid.ilike.%' + escapePostgrestIlike(hk) + '%');
    }
    var digits = raw.replace(/\D/g, '');
    if (digits.length >= 4 && digits !== raw) {
        parts.push('phone_number.ilike.%' + escapePostgrestIlike(digits) + '%');
        parts.push('mobile_phone.ilike.%' + escapePostgrestIlike(digits) + '%');
        parts.push('patient_no.ilike.%' + escapePostgrestIlike(digits) + '%');
    }
    patientSearchDobFilterParts(raw).forEach(function (p) { parts.push(p); });
    return parts.join(',');
}

/** Client-side match (appointment records filter, etc.) mirroring patientSearchOrFilter fields. */
function patientSearchLocalMatches(q, texts) {
    var raw = String(q || '').trim();
    if (!raw) return true;
    var list = (texts || []).map(function (t) { return String(t || ''); });
    var hay = list.join(' ').toLowerCase();
    var needle = raw.toLowerCase();
    if (hay.indexOf(needle) >= 0) return true;

    var hk = raw.replace(/\s+/g, '').toUpperCase();
    if (hk.length >= 2) {
        var hkHay = list.map(function (t) {
            return String(t || '').replace(/\s+/g, '').toUpperCase();
        }).join(' ');
        if (hkHay.indexOf(hk) >= 0) return true;
    }

    var digits = raw.replace(/\D/g, '');
    if (digits.length >= 4) {
        var digitHay = list.map(function (t) {
            return String(t || '').replace(/\D/g, '');
        }).join(' ');
        if (digitHay.indexOf(digits) >= 0) return true;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && hay.indexOf(raw) >= 0) return true;
    var m = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) {
        var iso = m[3] + '-' + ('0' + parseInt(m[2], 10)).slice(-2) + '-' +
            ('0' + parseInt(m[1], 10)).slice(-2);
        if (list.some(function (t) { return String(t || '').indexOf(iso) >= 0; })) return true;
    }
    if (/^\d{4}$/.test(raw)) {
        if (list.some(function (t) {
            var s = String(t || '');
            return s.indexOf(raw + '-') === 0 || s.indexOf('-' + raw) >= 0;
        })) return true;
    }
    return false;
}

function patientSearchBlobFromRecord(p) {
    if (!p) return '';
    return [
        p.full_name, p.chinese_name, p.patient_no,
        p.phone_number, p.mobile_phone, p.hkid, p.email,
        p.address, p.occupation, p.remarks, p.dob,
        p.medical_alerts, p.medical_history, p.current_medications, p.allergy
    ].filter(function (v) { return v != null && String(v).trim() !== ''; }).join(' ');
}

// ════════════════════════════════════════════════════════════════
// PATIENT ALERT COLUMN — optional medical history / meds / allergy
// ════════════════════════════════════════════════════════════════
var PATIENT_ALERT_DISPLAY_LS = 'joyful_patient_alert_display_v1';
var patientAlertDisplayPrefs = {
    showHistory: false,
    showMedications: false,
    showAllergies: false
};

function loadPatientAlertDisplayPrefs() {
    try {
        var raw = localStorage.getItem(PATIENT_ALERT_DISPLAY_LS);
        if (!raw) return;
        var o = JSON.parse(raw);
        if (!o || typeof o !== 'object') return;
        if (typeof o.showHistory === 'boolean') patientAlertDisplayPrefs.showHistory = o.showHistory;
        if (typeof o.showMedications === 'boolean') {
            patientAlertDisplayPrefs.showMedications = o.showMedications;
        }
        if (typeof o.showAllergies === 'boolean') patientAlertDisplayPrefs.showAllergies = o.showAllergies;
    } catch (e) {}
}

function savePatientAlertDisplayPrefs() {
    try {
        localStorage.setItem(PATIENT_ALERT_DISPLAY_LS, JSON.stringify(patientAlertDisplayPrefs));
    } catch (e) {}
}

function patientAlertDisplayNeedsExtraFields() {
    return !!(patientAlertDisplayPrefs.showHistory ||
        patientAlertDisplayPrefs.showMedications ||
        patientAlertDisplayPrefs.showAllergies);
}

function patientAlertFieldLabel(key) {
    if (typeof tr !== 'function') return key;
    if (key === 'medical_history') return tr('patient.alertCol.history');
    if (key === 'current_medications') return tr('patient.alertCol.meds');
    if (key === 'allergy') return tr('patient.alertCol.allergy');
    return '';
}

function buildPatientAlertDisplayText(source) {
    source = source || {};
    var parts = [];
    var base = String(source.medical_alerts || source._merged_patient_alerts || '').trim();
    if (base) parts.push(base);

    if (patientAlertDisplayPrefs.showHistory) {
        var hx = String(source.medical_history || source._merged_medical_history || '').trim();
        if (hx) parts.push(patientAlertFieldLabel('medical_history') + ': ' + hx);
    }
    if (patientAlertDisplayPrefs.showMedications) {
        var meds = String(source.current_medications || source._merged_current_medications || '').trim();
        if (meds) parts.push(patientAlertFieldLabel('current_medications') + ': ' + meds);
    }
    if (patientAlertDisplayPrefs.showAllergies) {
        var alg = String(source.allergy || source._merged_allergy || '').trim();
        if (alg) parts.push(patientAlertFieldLabel('allergy') + ': ' + alg);
    }
    return parts.join(' · ');
}

function refreshPatientAlertDisplayViews() {
    if (typeof apptSectionIsActive === 'function' && apptSectionIsActive()) {
        var tab = typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : '';
        if (tab === 'queue' && typeof loadQueue === 'function') loadQueue();
        else if (tab === 'today' && typeof loadToday === 'function') loadToday();
        else if (tab === 'records' && typeof loadApptRecords === 'function') loadApptRecords();
        else if (tab === 'plusappt' && typeof loadPlusApptDay === 'function') {
            loadPlusApptDay({ soft: true });
        } else if (tab === 'calendar' && typeof renderCal === 'function') renderCal();
    }
    var patSec = g('patientSection');
    if (patSec && patSec.style.display !== 'none' && typeof fetchPatients === 'function') {
        fetchPatients();
    }
}

loadPatientAlertDisplayPrefs();

var PATIENT_SEARCH_SELECT =
    'id,patient_no,full_name,chinese_name,sex,dob,phone_number,mobile_phone,hkid,email,address,' +
    'residential_district,family_history,referred_by,' +
    'occupation,remarks,medical_alerts,medical_history,current_medications,allergy,banana_index,banana_notes,' +
    PATIENT_CLINIC_TAG_FIELD;

function patientSearchQueryBuilder(q, extraSelect) {
    var filter = patientSearchOrFilter(q);
    if (!filter) return null;
    var sel = PATIENT_SEARCH_SELECT + (extraSelect ? ',' + extraSelect : '');
    return SB.from('patients').select(sel).or(filter).limit(8);
}

function patientSearchInputDisplayValue(p) {
    if (!p) return '';
    var name = p.full_name || p.chinese_name || appTr('common.patientFallback');
    return name + ' (#' + (p.patient_no || '') + ')';
}

function patientSearchResultHtml(p) {
    var cn = String(p.chinese_name || '').trim();
    var title = cn
        ? esc(p.full_name || cn) + ' <span style="font-weight:600;opacity:.9;">(' +
          esc(cn) + ')</span>'
        : esc(p.full_name || '—');
    var bits = ['#' + esc(p.patient_no || '-')];
    if (p.phone_number) bits.push(esc(p.phone_number));
    if (p.hkid) bits.push(esc(p.hkid));
    if (p.dob) bits.push(esc(formatDobAge(p.dob)));
    if (p.email) bits.push(esc(p.email));
    return title + '<br><small style="color:#aaa;">' +
        bits.join(' &nbsp;|&nbsp; ') + '</small>';
}

function refreshPsDropEmptyOrError(dd) {
    if (!dd || dd.style.display === 'none') return;
    var items = dd.querySelectorAll('.ps-item');
    if (items.length !== 1) return;
    var el = items[0];
    var st = el.getAttribute('style') || '';
    if (st.indexOf('#aaa') >= 0) {
        el.textContent = appTr('common.psNoPatients');
    } else if (st.indexOf('#c00') >= 0) {
        el.textContent = appTr('common.psSearchError');
    }
}

function refreshVisiblePatientSearchDropdowns() {
    var specs = [
        { drop: 'psDrop', input: 'psInput', run: function () {
            if (typeof doPatientSearch === 'function') doPatientSearch();
        }},
        { drop: 'conPsDrop', input: 'conPsInput', run: function () {
            if (typeof doConPatientSearch === 'function') doConPatientSearch();
        }},
        { drop: 'conPsDropMed', input: 'conPsInputMed', run: function () {
            if (typeof doConPatientSearchMed === 'function') doConPatientSearchMed();
        }},
        { drop: 'conPsDropDen', input: 'conPsInputDen', run: function () {
            if (typeof doConPatientSearchDen === 'function') doConPatientSearchDen();
        }},
        { drop: 'conPsDropXray', input: 'conPsInputXray', run: function () {
            if (typeof doConPatientSearchXray === 'function') doConPatientSearchXray();
        }},
        { drop: 'conPsDropPhoto', input: 'conPsInputPhoto', run: function () {
            if (typeof doConPatientSearchPhoto === 'function') doConPatientSearchPhoto();
        }},
        { drop: 'conPsDropChart', input: 'conPsInputChart', run: function () {
            if (typeof doConPatientSearchChart === 'function') doConPatientSearchChart();
        }},
        { drop: 'conFormsPsDrop', input: 'conFormsPsInput', run: function () {
            if (typeof doConFormsPatientSearch === 'function') doConFormsPatientSearch();
        }}
    ];
    specs.forEach(function (s) {
        var dd = g(s.drop);
        if (!dd || dd.style.display === 'none') return;
        var inp = g(s.input);
        if (inp && (inp.value || '').trim()) {
            s.run();
        } else {
            refreshPsDropEmptyOrError(dd);
        }
    });
}

function fillPatientSearchDropdown(dd, rows, onSelect) {
    if (!dd) return;
    dd.innerHTML = '';
    if (!rows || !rows.length) {
        dd.innerHTML =
            '<div class="ps-item" style="color:#aaa;">' +
            esc(appTr('common.psNoPatients')) + '</div>';
        dd.style.display = 'block';
        return;
    }
    rows.forEach(function (p) {
        var item = document.createElement('div');
        item.className = 'ps-item';
        item.innerHTML = patientSearchResultHtml(p);
        item.addEventListener('click', function () {
            if (onSelect) onSelect(p);
        });
        dd.appendChild(item);
    });
    dd.style.display = 'block';
}

/**
 * Shared patient search dropdown (consultation module and related tabs).
 * opts: { inputId, dropId, clinicFilterId?, onSelect(p) }
 */
function runPatientSearchDropdown(opts) {
    opts = opts || {};
    var inputEl = opts.inputId ? g(opts.inputId) : null;
    var dd = opts.dropId ? g(opts.dropId) : null;
    if (!dd) return;
    var q = inputEl ? (inputEl.value || '').trim() : '';
    if (!q) {
        dd.style.display = 'none';
        return;
    }
    var pq = patientSearchQueryBuilder(q);
    if (!pq) {
        dd.style.display = 'none';
        return;
    }
    if (opts.clinicFilterId && typeof applyPatientQueryClinicTag === 'function') {
        pq = applyPatientQueryClinicTag(pq, opts.clinicFilterId);
    }
    function finish(r) {
        if (r.error) {
            dd.innerHTML =
                '<div class="ps-item" style="color:#c00;">' +
                esc(appTr('common.psSearchError')) + '</div>';
            dd.style.display = 'block';
            return;
        }
        fillPatientSearchDropdown(dd, r.data, function (p) {
            dd.style.display = 'none';
            if (inputEl) inputEl.value = patientSearchInputDisplayValue(p);
            if (opts.onSelect) opts.onSelect(p);
        });
    }
    pq.then(function (r) {
        if (r.error && (r.error.message || '').indexOf('column') >= 0) {
            var coreSel =
                'id,patient_no,full_name,chinese_name,sex,dob,phone_number,hkid,email,address,' +
                'medical_alerts,banana_index,' + PATIENT_CLINIC_TAG_FIELD;
            var coreFilter = patientSearchOrFilterCore(q);
            if (!coreFilter) {
                finish(r);
                return;
            }
            var coreQ = SB.from('patients').select(coreSel).or(coreFilter).limit(8);
            if (opts.clinicFilterId && typeof applyPatientQueryClinicTag === 'function') {
                coreQ = applyPatientQueryClinicTag(coreQ, opts.clinicFilterId);
            }
            coreQ.then(finish);
            return;
        }
        finish(r);
    });
}

function applyAppointmentQueryClinicTag(builder, filterSelectId) {
    var tag = readClinicTagFilter(filterSelectId);
    if (!tag || !builder) return builder;
    return builder.eq(APPOINTMENT_CLINIC_TAG_FIELD, tag);
}

// ════════════════════════════════════════════════════════════════
// SCREEN MANAGEMENT
// ════════════════════════════════════════════════════════════════
var SCREENS = [
    'loginOverlay',
    'dashboardSection',
    'patientSection',
    'appointmentSection',
    'consultationSection',
    'drugSection',
    'reportSection',
    'aiHelperSection',
    'memoCardsSection',
    'sectionConfig'           // ← added
];

function showOnly(id, opts) {
    opts = opts || {};
    if (id === 'sectionConfig') {
        var allowCfg = (typeof canAccessConfiguration === 'function')
            ? canAccessConfiguration()
            : (String(currentRole || '').toLowerCase() === 'admin');
        if (!allowCfg) {
            if (typeof permToastDenied === 'function') permToastDenied();
            else alert(appTr('alert.cfgAdminOnly'));
            id = 'dashboardSection';
        }
    }
    SCREENS.forEach(function(s) {
        var el = g(s);
        if (!el) return;
        el.style.display = 'none';
        el.setAttribute('aria-hidden', 'true');
    });
    var target = g(id);
    if (target) {
        target.style.display = (id === 'loginOverlay') ? 'flex' : 'block';
        target.removeAttribute('aria-hidden');
    }
    if (id === 'patientSection' && !opts.skipPatientViewReset && typeof patViewSetMode === 'function') {
        patViewSetMode('directory', { skipScroll: true });
    }
    syncAppSessionChrome();
    if (id !== 'loginOverlay' && currentUserId && typeof persistAppScrollRestoreState === 'function') {
        requestAnimationFrame(function() { persistAppScrollRestoreState(); });
    }
}

function refreshDashboardUserBadge() {
    var bn = g('badgeName');
    var br = g('badgeRole');
    if (bn) bn.textContent = currentName || '-';
    if (br) {
        br.textContent = (typeof dispRole === 'function')
            ? dispRole(currentRole)
            : (currentRole || '-');
    }
    if (currentUserId) refreshDashboardContextControls();
}

function refreshAppSessionStripContents() {
    var dateEl = g('appStripDate');
    var dstr = typeof fmtNowDateTimeHK === 'function'
        ? fmtNowDateTimeHK()
        : (typeof fmtTodayLong === 'function' ? fmtTodayLong() : '');
    var datePrefix = hasEffectiveWorkingDateOverride()
        ? appTr('session.workingDatePrefix')
        : appTr('session.todayPrefix');
    if (dateEl) dateEl.textContent = dstr
        ? (datePrefix + ' ' + dstr)
        : '';
    var workBadge = g('appWorkingDateBadge');
    if (workBadge) workBadge.style.display = hasEffectiveWorkingDateOverride() ? 'inline-flex' : 'none';

    var cline = '';
    var rec =
        currentClinicId && typeof clinicRecordFromId === 'function'
            ? clinicRecordFromId(currentClinicId)
            : null;
    if (rec) {
        cline = clinicDisplayName(rec);
    } else if (currentClinicLabel) {
        cline = currentClinicLabel;
    }
    if (currentUserId) populateWorkingClinicSelect();

    var identity = currentName || currentDoctorName || currentUserId || '';
    var shortTitle = appTr('app.title');
    try {
        document.title =
            (identity ? identity + ' · ' : '') +
            (cline ? cline.replace(/\s+/g, ' ').trim() + ' · ' : '') +
            shortTitle + (dstr ? ' · ' + dstr : '');
    } catch (e) {}
}

function toggleAppDateAdjustPopover(forceOpen) {
    var pop = g('appDateAdjustPopover');
    if (!pop) return;
    var shouldOpen = typeof forceOpen === 'boolean'
        ? forceOpen
        : pop.style.display === 'none' || !pop.style.display;
    if (shouldOpen) {
        var inp = g('appDateAdjustInput');
        if (inp) inp.value = currentWorkingDateOverride() || todayISO();
        pop.style.display = 'block';
        positionAppDateAdjustPopover();
    } else {
        pop.style.display = 'none';
    }
}

function positionAppDateAdjustPopover() {
    var pop = g('appDateAdjustPopover');
    if (!pop || pop.style.display === 'none') return;
    var anchor = g('appStripDate') || g('appSessionStrip');
    if (!anchor) return;
    var ar = anchor.getBoundingClientRect();
    var margin = 8;
    var left = ar.left;
    var top = ar.bottom + margin;
    pop.style.left = Math.max(8, Math.round(left)) + 'px';
    pop.style.top = Math.max(42, Math.round(top)) + 'px';
    pop.style.right = 'auto';
}

function wireAppDateAdjustControls() {
    var strip = g('appSessionStrip');
    var pop = g('appDateAdjustPopover');
    if (!strip || !pop || strip.dataset.dateAdjustWired === '1') return;
    strip.dataset.dateAdjustWired = '1';

    strip.addEventListener('dblclick', function(ev) {
        var t = ev.target;
        if (t && t.closest && t.closest('#appWorkingClinicSelect')) return;
        toggleAppDateAdjustPopover(true);
    });
    window.addEventListener('resize', function() {
        positionAppDateAdjustPopover();
    });

    function applyAppDateFromInput() {
        var inp = g('appDateAdjustInput');
        var iso = inp ? String(inp.value || '').trim() : '';
        if (!iso) return;
        setWorkingDateOverride(iso);
        toggleAppDateAdjustPopover(false);
    }

    var applyBtn = g('appDateAdjustApplyBtn');
    if (applyBtn) {
        applyBtn.addEventListener('click', applyAppDateFromInput);
    }
    var dateInp = g('appDateAdjustInput');
    if (dateInp) {
        dateInp.addEventListener('change', applyAppDateFromInput);
    }
    var todayBtn = g('appDateAdjustTodayBtn');
    if (todayBtn) {
        todayBtn.addEventListener('click', function() {
            var realIso = d2iso(realNowLocal());
            setWorkingDateOverride(realIso);
            toggleAppDateAdjustPopover(false);
        });
    }
    var clearBtn = g('appDateAdjustClearBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', function() {
            clearWorkingDateOverride();
            toggleAppDateAdjustPopover(false);
        });
    }
}

/** Call after login/logout/navigation; shows fixed strip when a user session exists. */
function syncAppSessionChrome() {
    var strip = g('appSessionStrip');
    var dock = g('activePatientDock');
    if (!strip) return;

    if (!currentUserId) {
        strip.style.display = 'none';
        if (dock) dock.style.display = 'none';
        document.body.classList.remove('app-session-active');
        try {
            document.title = appTr('app.title');
        } catch (e) {}
        return;
    }

    strip.style.display = 'flex';
    if (dock) dock.style.display = '';
    document.body.classList.add('app-session-active');
    if (typeof syncActivePatientDockLayout === 'function') syncActivePatientDockLayout();
    refreshAppSessionStripContents();
}

var appSessionStripTimer = null;
function startAppSessionStripClock() {
    if (appSessionStripTimer) clearInterval(appSessionStripTimer);
    appSessionStripTimer = setInterval(function() {
        if (currentUserId) refreshAppSessionStripContents();
    }, 60000);
}

function openAppHelpPage() {
    var url = 'https://drive.google.com/file/d/1j-7mFvhwD2ZTifGB38ZWJyUiRhNzVkPw/view?usp=sharing';
    window.open(url, '_blank', 'noopener,noreferrer');
}

function showLogin() { showOnly('loginOverlay'); }

function markAppReady() {
    if (document.documentElement.classList.contains('app-ready')) return;
    document.documentElement.classList.add('app-ready');
}

function scheduleMarkAppReady() {
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () {
            requestAnimationFrame(markAppReady);
        });
        return;
    }
    markAppReady();
}

function showDashboard() {
    showOnly('dashboardSection');
    if (typeof stopApptAutoRefresh === 'function') stopApptAutoRefresh();
    if (typeof applyDashboardI18n === 'function') applyDashboardI18n();
    refreshDashboardContextControls();
    refreshDashboardUserBadge();
    if (typeof applyDashboardPermissionGuards === 'function') applyDashboardPermissionGuards();
    var cfgSec = g('sectionConfig');
    if (cfgSec) cfgSec.style.display = 'none';
    if (typeof CFG !== 'undefined' && typeof CFG.prefetchPrintSettings === 'function' && currentClinicId) {
        requestAnimationFrame(function() {
            CFG.prefetchPrintSettings(currentClinicId);
        });
    }
    refreshDashboardUserBadge();
    if (typeof MEMO_AI !== 'undefined' && typeof MEMO_AI.refreshDashboardStickies === 'function') {
        requestAnimationFrame(function() {
            MEMO_AI.refreshDashboardStickies();
        });
    }
}

// ════════════════════════════════════════════════════════════════
// GLOBAL REFRESH HOTKEY (F2)
// ════════════════════════════════════════════════════════════════
function sectionVisible(id) {
    var el = g(id);
    if (!el) return false;
    return el.style.display !== 'none' && el.style.display !== '';
}

function activeConsultationTabKey() {
    var t = document.querySelector('#consultationSection .con-tab.active');
    return t && t.dataset ? t.dataset.tab : '';
}

// ── Scroll + navigation restore (F2 refresh + browser reload) ──
var APP_SCROLL_RESTORE_SS = 'joyful_app_scroll_restore_v1';
var APP_SCROLL_SELECTORS = [
    '.queue-wrap',
    '.today-wrap',
    '#plusApptAllScroll',
    '.plusappt-schedule-wrap',
    '.ar-records-table-wrap',
    '#rptTableWrap',
    '#drugHistoryWrap',
    '#drugListWrap',
    '#gcalScrollBody',
    '#patientViewDashboard',
    '.history-pane-wrap'
];
var _appScrollPersistTimer = null;
var _appScrollRestoreToken = 0;
var _appScrollPersistBound = false;
var _appScrollApplying = false;

function visibleAppScreenId() {
    for (var i = 0; i < SCREENS.length; i++) {
        var sid = SCREENS[i];
        if (sid === 'loginOverlay') continue;
        if (sectionVisible(sid)) return sid;
    }
    return null;
}

function appScrollElementsForSelector(sel) {
    if (sel.charAt(0) === '#') {
        var byId = g(sel.slice(1));
        return byId ? [byId] : [];
    }
    return Array.prototype.slice.call(document.querySelectorAll(sel));
}

function appScrollStateKey(sel, idx, count) {
    return count > 1 ? (sel + ':' + idx) : sel;
}

function captureAppScrollState() {
    var state = { winY: window.scrollY || 0, els: {} };
    APP_SCROLL_SELECTORS.forEach(function(sel) {
        var nodes = appScrollElementsForSelector(sel);
        nodes.forEach(function(el, idx) {
            state.els[appScrollStateKey(sel, idx, nodes.length)] = {
                top: el.scrollTop || 0,
                left: el.scrollLeft || 0
            };
        });
    });
    return state;
}

function applyAppScrollState(state) {
    if (!state) return;
    _appScrollApplying = true;
    try {
        if (state.winY != null) window.scrollTo(0, state.winY);
        if (!state.els) return;
        Object.keys(state.els).forEach(function(key) {
            var pos = state.els[key];
            if (!pos) return;
            var sel = key.indexOf(':') >= 0 ? key.replace(/:\d+$/, '') : key;
            var idx = 0;
            var m = key.match(/:(\d+)$/);
            if (m) idx = parseInt(m[1], 10) || 0;
            var nodes = appScrollElementsForSelector(sel);
            var el = nodes[idx];
            if (!el) return;
            el.scrollTop = pos.top || 0;
            el.scrollLeft = pos.left || 0;
        });
    } finally {
        _appScrollApplying = false;
    }
}

function captureAppNavState() {
    var screen = visibleAppScreenId() || 'dashboardSection';
    var nav = { screen: screen };
    if (screen === 'appointmentSection' && typeof apptActiveTabKey === 'function') {
        nav.apptTab = apptActiveTabKey() || 'queue';
    }
    if (screen === 'consultationSection') {
        nav.conTab = activeConsultationTabKey() || 'treatment';
    }
    if (screen === 'patientSection') {
        if (typeof patientViewMode !== 'undefined') nav.patientView = patientViewMode;
        if (typeof patientDirPageIndex !== 'undefined') nav.patientDirPage = patientDirPageIndex;
    }
    return nav;
}

function readAppScrollRestorePayload() {
    try {
        var raw = sessionStorage.getItem(APP_SCROLL_RESTORE_SS);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

function persistAppScrollRestoreState() {
    if (!currentUserId) return;
    try {
        sessionStorage.setItem(APP_SCROLL_RESTORE_SS, JSON.stringify({
            nav: captureAppNavState(),
            scroll: captureAppScrollState(),
            ts: Date.now()
        }));
    } catch (e) {}
}

function scheduleAppScrollRestore(scrollState, opts) {
    opts = opts || {};
    if (!scrollState) return;
    var token = ++_appScrollRestoreToken;
    var delays = opts.delays || [0, 50, 150, 350, 700, 1200];
    delays.forEach(function(ms) {
        setTimeout(function() {
            if (token !== _appScrollRestoreToken) return;
            applyAppScrollState(scrollState);
        }, ms);
    });
}

function cancelAppScrollRestore() {
    ++_appScrollRestoreToken;
    releaseAppScrollLock(false);
}

var _appScrollLock = null;
var _appScrollLockSeq = 0;

/** Briefly re-apply scroll while list DOM height changes (auto-refresh only). */
function lockAppScroll(state) {
    releaseAppScrollLock(false);
    if (!state) return;
    var token = ++_appScrollLockSeq;
    var maxFrames = 4;
    var frames = 0;
    _appScrollLock = { state: state, token: token, raf: 0 };
    function tick() {
        if (!_appScrollLock || _appScrollLock.token !== token) return;
        applyAppScrollState(state);
        frames++;
        if (frames < maxFrames) {
            _appScrollLock.raf = requestAnimationFrame(tick);
        } else {
            _appScrollLock = null;
        }
    }
    applyAppScrollState(state);
    _appScrollLock.raf = requestAnimationFrame(tick);
}

function releaseAppScrollLock(doFinalRestore) {
    var st = _appScrollLock;
    if (st) st.token = -1;
    _appScrollLock = null;
    if (st && st.raf) cancelAnimationFrame(st.raf);
    if (doFinalRestore && st && st.state) {
        scheduleAppScrollRestore(st.state, { delays: [0, 120, 400] });
    }
}

function screenModulePermKey(screenId) {
    var map = {
        patientSection: 'patient',
        appointmentSection: 'appointment',
        consultationSection: 'consultation',
        drugSection: 'drug_inventory',
        reportSection: 'report'
    };
    return map[screenId] || null;
}

function canRestoreAppScreen(screenId) {
    if (!screenId || screenId === 'loginOverlay') return false;
    if (SCREENS.indexOf(screenId) < 0) return false;
    if (screenId === 'sectionConfig') {
        return (typeof canAccessConfiguration === 'function')
            ? canAccessConfiguration()
            : (String(currentRole || '').toLowerCase() === 'admin');
    }
    var perm = screenModulePermKey(screenId);
    if (perm && typeof hasAppPermission === 'function') return hasAppPermission(perm);
    return true;
}

function openRestoredAppScreen(screen, nav) {
    nav = nav || {};
    switch (screen) {
    case 'dashboardSection':
        showDashboard();
        break;
    case 'patientSection':
        showOnly('patientSection', { skipPatientViewReset: true });
        if (nav.patientView && typeof patViewSetMode === 'function') {
            patViewSetMode(nav.patientView, { skipScroll: true });
        }
        if (typeof patientDirPageIndex !== 'undefined' && nav.patientDirPage != null) {
            patientDirPageIndex = Math.max(0, parseInt(nav.patientDirPage, 10) || 0);
        }
        if (typeof fetchPatients === 'function') fetchPatients();
        break;
    case 'appointmentSection':
        showOnly('appointmentSection');
        if (typeof initAppt === 'function') initAppt({ initialTab: nav.apptTab || 'queue' });
        break;
    case 'consultationSection':
        showOnly('consultationSection');
        if (typeof refreshConsultationClinicFilterSelects === 'function') {
            refreshConsultationClinicFilterSelects();
        } else if (typeof refreshAllClinicTagFilterSelects === 'function') {
            refreshAllClinicTagFilterSelects();
        }
        if (typeof loadConsultationDoctors === 'function') loadConsultationDoctors();
        if (nav.conTab && typeof switchConTab === 'function') switchConTab(nav.conTab);
        break;
    case 'drugSection':
        if (typeof initDrugs === 'function') initDrugs();
        break;
    case 'reportSection':
        showOnly('reportSection');
        if (typeof initReportModuleClinic === 'function') initReportModuleClinic();
        if (typeof REPORT !== 'undefined' && typeof REPORT.init === 'function') REPORT.init();
        break;
    case 'aiHelperSection':
        showOnly('aiHelperSection');
        if (typeof AIHELPER !== 'undefined' && typeof AIHELPER.init === 'function') AIHELPER.init();
        break;
    case 'memoCardsSection':
        showOnly('memoCardsSection');
        if (typeof MEMO_AI !== 'undefined' && typeof MEMO_AI.init === 'function') MEMO_AI.init();
        break;
    case 'sectionConfig':
        if (typeof CFG !== 'undefined' && typeof CFG.init === 'function') {
            showOnly('sectionConfig');
            CFG.init();
        } else {
            showDashboard();
        }
        break;
    default:
        showDashboard();
    }
}

function restoreAppSessionView() {
    var payload = readAppScrollRestorePayload();
    if (!payload || !payload.nav || !payload.nav.screen) return false;
    if (!canRestoreAppScreen(payload.nav.screen)) return false;
    openRestoredAppScreen(payload.nav.screen, payload.nav);
    scheduleAppScrollRestore(payload.scroll, { delays: [0, 100, 300, 600, 1000, 1600] });
    return true;
}

function bindAppScrollPersistOnce() {
    if (_appScrollPersistBound) return;
    _appScrollPersistBound = true;
    window.addEventListener('scroll', function() {
        clearTimeout(_appScrollPersistTimer);
        _appScrollPersistTimer = setTimeout(persistAppScrollRestoreState, 250);
    }, true);
    window.addEventListener('beforeunload', persistAppScrollRestoreState);
    window.addEventListener('wheel', cancelAppScrollRestore, { passive: true, capture: true });
    window.addEventListener('touchmove', cancelAppScrollRestore, { passive: true, capture: true });
    window.addEventListener('keydown', function(e) {
        var k = e.key;
        if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'PageUp' || k === 'PageDown' ||
            k === 'Home' || k === 'End' || k === ' ') {
            cancelAppScrollRestore();
        }
    }, true);
}

var appGlobalToastTimer = null;
function showAppGlobalToast(msg) {
    var text = String(msg || '').trim();
    if (!text) return;
    var box = g('appGlobalToast');
    if (!box) {
        box = document.createElement('div');
        box.id = 'appGlobalToast';
        box.className = 'app-global-toast';
        document.body.appendChild(box);
    }
    box.textContent = text;
    box.classList.add('app-global-toast--in');
    if (appGlobalToastTimer) clearTimeout(appGlobalToastTimer);
    appGlobalToastTimer = setTimeout(function() {
        box.classList.remove('app-global-toast--in');
    }, 1300);
}

function showClinicRefreshToast(clinicId, isAll) {
    var clinicLabel = '';
    if (isAll) {
        clinicLabel = (typeof appTr === 'function') ? appTr('common.all') : 'ALL';
    } else if (clinicId && typeof clinicRecordFromId === 'function') {
        var rec = clinicRecordFromId(clinicId);
        if (rec) {
            clinicLabel = clinicDisplayName(rec);
        }
    }
    if (!clinicLabel) clinicLabel = clinicId || '';
    var clinicWord = (typeof appTr === 'function') ? appTr('session.viewClinic') : 'Clinic';
    var refreshWord = (typeof tr === 'function') ? tr('bill.btnRefresh') : 'Refresh';
    showAppGlobalToast(clinicWord + ': ' + clinicLabel + ' · ' + refreshWord);
}

var activePatientSlots = [null, null];
var activePatientSwapAnimTimer = null;
var ACTIVE_PATIENT_COMPACT_MAX_W = 1320;
var ACTIVE_PATIENT_COLLAPSE_LS = 'active_patient_dock_collapsed_v1';

function isActivePatientDockCollapsed() {
    try {
        return localStorage.getItem(ACTIVE_PATIENT_COLLAPSE_LS) === '1';
    } catch (_) {
        return false;
    }
}

function activePatientDockCollapsedName(p) {
    if (!p) return '—';
    var zh = String(p.chinese_name || '').trim();
    var en = String(p.full_name || '').trim();
    return zh || en || String(p.patient_no || '—');
}

function renderActivePatientCollapsedTab() {
    var tab = g('activePatientCollapsedName');
    if (!tab) return;
    var p = activePatientSlots[0];
    tab.textContent = activePatientDockCollapsedName(p);
    tab.title = activePatientDropLabel(p);
}

function setActivePatientDockCollapsed(collapsed, persist) {
    var dock = g('activePatientDock');
    if (!dock) return;
    dock.classList.toggle('is-collapsed', !!collapsed);
    var btn = g('activePatientDockToggle');
    if (btn) {
        btn.textContent = collapsed ? '»' : '«';
        btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        var titleKey = collapsed ? 'activePatient.expandDock' : 'activePatient.collapseDock';
        var title = typeof appTr === 'function' ? appTr(titleKey) : titleKey;
        btn.title = title;
        btn.setAttribute('aria-label', title);
    }
    renderActivePatientCollapsedTab();
    if (persist !== false) {
        try {
            localStorage.setItem(ACTIVE_PATIENT_COLLAPSE_LS, collapsed ? '1' : '0');
        } catch (_) {}
    }
}

function syncActivePatientDockLayout() {
    var dock = g('activePatientDock');
    if (!dock) return;
    var w = window.innerWidth || 0;
    dock.classList.toggle('active-patient-dock--compact', w > 0 && w <= ACTIVE_PATIENT_COMPACT_MAX_W);
}

function bindActivePatientDockLayoutOnce() {
    if (window.__activePatientDockLayoutBound) return;
    window.__activePatientDockLayoutBound = true;
    setActivePatientDockCollapsed(isActivePatientDockCollapsed(), false);
    syncActivePatientDockLayout();
    var toggle = g('activePatientDockToggle');
    if (toggle) {
        toggle.addEventListener('click', function(ev) {
            ev.stopPropagation();
            setActivePatientDockCollapsed(!isActivePatientDockCollapsed(), true);
        });
    }
    var collapsedTab = g('activePatientCollapsedTab');
    if (collapsedTab) {
        collapsedTab.addEventListener('click', function() {
            setActivePatientDockCollapsed(false, true);
        });
        bindActivePatientCardDropTarget(collapsedTab, 0);
    }
    window.addEventListener('resize', syncActivePatientDockLayout);
}

function activePatientSnapshotFromGlobals() {
    if (typeof conPatientData !== 'undefined' && conPatientData && conPatientData.id) {
        return conPatientData;
    }
    if (typeof _patientDetailsPatient !== 'undefined' && _patientDetailsPatient && _patientDetailsPatient.id) {
        return _patientDetailsPatient;
    }
    return null;
}

function activePatientPhoneFromRecord(p) {
    if (!p) return '';
    return String(p.phone_number || p.mobile_phone || p.phone || '').trim();
}

function normalizeActivePatientPayload(p) {
    if (!p || !p.id) return null;
    return {
        id: p.id,
        patient_no: p.patient_no || '',
        full_name: p.full_name || '',
        chinese_name: p.chinese_name || '',
        phone_number: activePatientPhoneFromRecord(p),
        hkid: p.hkid || '',
        sex: p.sex || '',
        dob: p.dob || ''
    };
}

function activePatientBadgeSexLabel(sex) {
    var kind = patientSexKind(sex);
    if (kind === 'male') return appTr('activePatient.badgeSexMale');
    if (kind === 'female') return appTr('activePatient.badgeSexFemale');
    return '';
}

function activePatientBadgeHkidSexText(p) {
    if (!p) return '—';
    var hk = String(p.hkid || '').trim();
    var sex = activePatientBadgeSexLabel(p.sex);
    if (hk && sex) return hk + ' ' + sex;
    return hk || sex || '—';
}

function activePatientBadgeDobAgeText(dob) {
    if (!dob) return '—';
    var d = parseISODateOnly(dob);
    if (!d || isNaN(d.getTime())) return '—';
    var dateStr = d.toLocaleDateString(appUiLocale(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
    var age = patientAgeYears(dob);
    if (age != null) return dateStr + ', ' + age + 'Y';
    return dateStr;
}

function activePatientBadgePhoneText(p) {
    var ph = activePatientPhoneFromRecord(p);
    if (!ph) return '—';
    return 'M:' + ph.replace(/\s+/g, '');
}

function activePatientBadgeStampDateText() {
    return nowLocal().toLocaleDateString(appUiLocale(), {
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    });
}

function activePatientBadgeMainText(p) {
    if (!p || !p.id) {
        return '—\n—\n—\n—\n—';
    }
    return [
        p.patient_no || '—',
        activePatientBadgeHkidSexText(p),
        activePatientBadgeDobAgeText(p.dob),
        p.chinese_name || '—',
        String(p.full_name || '—').toUpperCase()
    ].join('\n');
}

function activePatientBadgeCopyAllText(p) {
    if (!p || !p.id) return '';
    return [
        p.patient_no || '—',
        activePatientBadgeHkidSexText(p),
        activePatientBadgeDobAgeText(p.dob),
        p.chinese_name || '—',
        String(p.full_name || '—').toUpperCase(),
        activePatientBadgePhoneText(p)
    ].join('\n');
}

function activePatientBadgePhoneCopyRaw(p) {
    if (!p) return '';
    return String(activePatientPhoneFromRecord(p) || '').replace(/\s+/g, '');
}

function activePatientCopyTextToClipboard(text, done) {
    if (!text) {
        if (done) done(false);
        return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            if (done) done(true);
        }).catch(function() {
            if (done) done(false);
        });
        return;
    }
    try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        if (done) done(true);
    } catch (e) {
        if (done) done(false);
    }
}

function whatsappFormatPhone(raw) {
    var digits = String(raw || '').replace(/[^\d]/g, '');
    if (!digits) return '';
    if (digits.length === 8 && /^[569]/.test(digits)) return '852' + digits;
    if (digits.slice(0, 5) === '00852') return digits.slice(2);
    if (digits.slice(0, 4) === '8520' && digits.length >= 11) return '852' + digits.slice(4);
    return digits;
}

function whatsappPrefillUrl(phone, message) {
    var digits = whatsappFormatPhone(phone);
    if (!digits || digits.length < 8) return '';
    var body = String(message || '').trim();
    if (body.length > 1500) body = body.slice(0, 1499) + '...';
    var enc = encodeURIComponent(body);
    var mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i
        .test(navigator.userAgent || '');
    if (mobile) return 'https://wa.me/' + digits + '?text=' + enc;
    return 'https://web.whatsapp.com/send?phone=' + encodeURIComponent(digits) + '&text=' + enc;
}

function openWhatsAppPrefill(phone, message, opts) {
    opts = opts || {};
    var url = whatsappPrefillUrl(phone, message);
    if (!url) {
        alert(appTr('whatsapp.alert.noPhone'));
        return false;
    }
    var w = window.open(url, '_blank', 'noopener,noreferrer');
    var blocked = !w || w.closed || typeof w.closed === 'undefined';
    if (!blocked) return true;
    activePatientCopyTextToClipboard(url, function(ok) {
        if (ok) alert(appTr('whatsapp.alert.linkCopied'));
        else if (typeof prompt === 'function') prompt(appTr('whatsapp.alert.popupBlockedPrompt'), url);
        else alert(url);
    });
    return false;
}

function activePatientCopyToast(key) {
    if (typeof showAppGlobalToast !== 'function') return;
    var msg = typeof appTr === 'function' ? appTr(key) : key;
    if (msg) showAppGlobalToast(msg);
}

function activePatientBadgePlainText(p) {
    return activePatientBadgeMainText(p);
}

function activePatientBadgeEmptyHtml(card) {
    if (!card) return;
    var box = card.querySelector('.active-patient-badge-textbox');
    if (box) box.value = '—\n—\n—\n—\n—';
    var phone = card.querySelector('[data-field="phoneText"]');
    if (phone) phone.textContent = '—';
    var date = card.querySelector('[data-field="stampDate"]');
    if (date) date.textContent = '';
    card.removeAttribute('data-copy-phone');
    var phoneBtn = card.querySelector('.active-patient-phone-copy-btn');
    if (phoneBtn) phoneBtn.disabled = true;
}

function activePatientBadgeDragBlockedTarget(target) {
    if (!target || !target.closest) return false;
    if (target.closest('.active-patient-clear-btn')) return true;
    if (target.closest('.active-patient-phone-copy-btn')) return true;
    if (target.closest('.active-patient-copy-all-btn')) return true;
    if (target.closest('.active-patient-badge-textbox')) return true;
    return false;
}

function bindActivePatientBadgeCursor(card) {
    if (!card || card.dataset.cursorBound === '1') return;
    card.dataset.cursorBound = '1';
    card.addEventListener('mousemove', function(ev) {
        if (!card.classList.contains('is-filled')) {
            card.style.cursor = '';
            return;
        }
        if (ev.target.closest('.active-patient-clear-btn')) {
            card.style.cursor = 'pointer';
            return;
        }
        if (ev.target.closest('.active-patient-phone-copy-btn') ||
            ev.target.closest('.active-patient-copy-all-btn')) {
            card.style.cursor = 'pointer';
            return;
        }
        if (ev.target.closest('.active-patient-badge-phone-text')) {
            card.style.cursor = 'text';
            return;
        }
        if (ev.target.closest('.active-patient-badge-textbox')) {
            card.style.cursor = 'text';
            return;
        }
        card.style.cursor = 'grab';
    });
    card.addEventListener('mouseleave', function() {
        card.style.cursor = '';
    });
    var box = card.querySelector('.active-patient-badge-textbox');
    if (box) {
        box.addEventListener('mousedown', function(ev) {
            ev.stopPropagation();
        });
        box.addEventListener('dragstart', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
        });
    }
}

function activePatientMetaNoText(v) {
    return appTrRepl('activePatient.metaNo', { NO: v || appTr('activePatient.metaEmpty') });
}

function activePatientMetaPhoneText(v) {
    return appTrRepl('activePatient.metaPhone', { PHONE: v || appTr('activePatient.metaEmpty') });
}

function renderActivePatientSlot(idx, p) {
    var card = g('activePatientCard' + idx);
    if (!card) return;
    if (!p || !p.id) {
        activePatientBadgeEmptyHtml(card);
        card.setAttribute('draggable', 'false');
        card.removeAttribute('data-patient-id');
        card.removeAttribute('data-payload');
        card.classList.remove('is-filled');
        return;
    }
    var box = card.querySelector('.active-patient-badge-textbox');
    if (box) box.value = activePatientBadgeMainText(p);
    var phoneEl = card.querySelector('[data-field="phoneText"]');
    if (phoneEl) phoneEl.textContent = activePatientBadgePhoneText(p);
    var dateEl = card.querySelector('[data-field="stampDate"]');
    if (dateEl) dateEl.textContent = activePatientBadgeStampDateText();
    card.setAttribute('data-copy-phone', activePatientBadgePhoneCopyRaw(p));
    var phoneBtn = card.querySelector('.active-patient-phone-copy-btn');
    if (phoneBtn) phoneBtn.disabled = !activePatientBadgePhoneCopyRaw(p);
    card.setAttribute('draggable', 'true');
    card.setAttribute('data-patient-id', p.id);
    card.setAttribute('data-payload', serializePatientDragPayload(p));
    card.classList.add('is-filled');
}

function renderActivePatientSlots() {
    renderActivePatientSlot(0, activePatientSlots[0]);
    renderActivePatientSlot(1, activePatientSlots[1]);
    hydrateActivePatientDetailsIfNeeded(0);
    hydrateActivePatientDetailsIfNeeded(1);
    var swapBtn = g('activePatientSwapBtn');
    if (swapBtn) swapBtn.disabled = !(activePatientSlots[0] && activePatientSlots[1]);
    renderActivePatientCollapsedTab();
}

function hydrateActivePatientDetailsIfNeeded(slotIdx) {
    var p = activePatientSlots[slotIdx];
    if (!p || !p.id || p.__detailsHydrateDone) return;
    if (p.phone_number && p.hkid && p.sex && p.dob) return;
    if (typeof SB === 'undefined' || !SB.from) return;
    p.__detailsHydrateDone = true;
    SB.from('patients').select('phone_number,mobile_phone,hkid,sex,dob').eq('id', p.id).limit(1)
    .then(function(r) {
        if (!r.data || !r.data[0]) return;
        var row = r.data[0];
        if (!activePatientSlots[slotIdx] ||
            String(activePatientSlots[slotIdx].id) !== String(p.id)) return;
        var cur = activePatientSlots[slotIdx];
        if (!cur.phone_number) cur.phone_number = activePatientPhoneFromRecord(row);
        if (!cur.hkid) cur.hkid = row.hkid || '';
        if (!cur.sex) cur.sex = row.sex || '';
        if (!cur.dob) cur.dob = row.dob || '';
        renderActivePatientSlot(slotIdx, cur);
    })
    .catch(function() {});
}

function syncPrimaryPatientContext(source) {
    var p = activePatientSlots[0];
    if (p && p.id) {
        if (typeof setDirectoryActivePatient === 'function') {
            setDirectoryActivePatient(p, source || 'active-slot-sync');
            return;
        }
        if (typeof selPatientId !== 'undefined') selPatientId = p.id;
        if (typeof _patientDetailsPatient !== 'undefined') _patientDetailsPatient = p;
        if (typeof conPatientId !== 'undefined') conPatientId = p.id;
        if (typeof conPatientData !== 'undefined') conPatientData = p;
        try {
            document.dispatchEvent(new CustomEvent('app-active-patient-change', {
                detail: { patient: p, source: source || 'active-slot-sync' }
            }));
        } catch (_) {}
        return;
    }
    if (typeof selPatientId !== 'undefined') selPatientId = null;
    if (typeof _patientDetailsPatient !== 'undefined') _patientDetailsPatient = null;
    if (typeof selPatientClinicTag !== 'undefined') selPatientClinicTag = null;
    if (typeof conPatientId !== 'undefined') conPatientId = null;
    if (typeof conPatientData !== 'undefined') conPatientData = null;
    if (typeof updatePatientDirActiveRowHighlight === 'function') updatePatientDirActiveRowHighlight();
    try {
        document.dispatchEvent(new CustomEvent('app-active-patient-change', {
            detail: { patient: null, source: source || 'active-slot-sync-clear' }
        }));
    } catch (_) {}
}

function setActivePatientSlot(slotIdx, p, source, syncPrimary) {
    if (slotIdx !== 0 && slotIdx !== 1) return;
    var norm = normalizeActivePatientPayload(p);
    if (norm && slotIdx === 1 && activePatientSlots[0] && String(activePatientSlots[0].id) === String(norm.id)) {
        return;
    }
    if (norm && slotIdx === 0 && activePatientSlots[1] && String(activePatientSlots[1].id) === String(norm.id)) {
        activePatientSlots[1] = null;
    }

    function commit(patient) {
        activePatientSlots[slotIdx] = patient;
        renderActivePatientSlots();
        if (syncPrimary !== false && slotIdx === 0) {
            syncPrimaryPatientContext(source || 'active-slot-set');
        }
    }

    if (!norm) {
        activePatientSlots[slotIdx] = null;
        renderActivePatientSlots();
        if (syncPrimary !== false && slotIdx === 0) {
            syncPrimaryPatientContext(source || 'active-slot-set');
        }
        return;
    }

    if (norm.phone_number && norm.hkid && norm.sex && norm.dob) {
        commit(norm);
        return;
    }

    if (typeof SB === 'undefined' || !SB.from) {
        commit(norm);
        return;
    }

    SB.from('patients').select('phone_number,mobile_phone,hkid,sex,dob').eq('id', norm.id).limit(1)
    .then(function(r) {
        if (r.data && r.data[0]) {
            norm.phone_number = norm.phone_number || activePatientPhoneFromRecord(r.data[0]);
            norm.hkid = norm.hkid || r.data[0].hkid || '';
            norm.sex = norm.sex || r.data[0].sex || '';
            norm.dob = norm.dob || r.data[0].dob || '';
        }
        commit(norm);
    })
    .catch(function() {
        commit(norm);
    });
}

function setActivePatientFromPayload(p, source) {
    setActivePatientSlot(0, p, source || 'active-card-drop', true);
}

function clearActivePatientSlot(slotIdx, source) {
    if (slotIdx !== 0 && slotIdx !== 1) return;
    activePatientSlots[slotIdx] = null;
    renderActivePatientSlots();
    if (slotIdx === 0) syncPrimaryPatientContext(source || 'active-slot-clear');
}

function promoteActivePatientSlot(slotIdx, source) {
    if (slotIdx !== 1 || !activePatientSlots[1]) return;
    var stack = g('activePatientStack');
    if (stack) {
        stack.classList.add('active-patient-stack--swapping');
        if (activePatientSwapAnimTimer) clearTimeout(activePatientSwapAnimTimer);
    }
    var tmp = activePatientSlots[0];
    activePatientSlots[0] = activePatientSlots[1];
    activePatientSlots[1] = tmp;
    var finalizeSwap = function() {
        renderActivePatientSlots();
        syncPrimaryPatientContext(source || 'active-slot-promote');
        if (stack) stack.classList.remove('active-patient-stack--swapping');
    };
    if (stack) {
        activePatientSwapAnimTimer = setTimeout(finalizeSwap, 200);
    } else {
        finalizeSwap();
    }
}

function clearActivePatientContext(source) {
    clearActivePatientSlot(0, source || 'active-card-clear');
}

function bindActivePatientCardDropTarget(el, slotIdx) {
    if (!el) return;
    el.addEventListener('dragover', function(ev) {
        if (!hasPatientDragPayload(ev)) return;
        ev.preventDefault();
        ev.stopPropagation();
        try {
            ev.dataTransfer.dropEffect = isScheduleApptPatientDragActive() ? 'move' : 'copy';
        } catch (_) {}
        el.classList.add('is-drag-over');
    });
    el.addEventListener('dragleave', function(ev) {
        var rect = el.getBoundingClientRect();
        var inside = ev.clientX >= rect.left && ev.clientX <= rect.right &&
            ev.clientY >= rect.top && ev.clientY <= rect.bottom;
        if (!inside) el.classList.remove('is-drag-over');
    });
    el.addEventListener('drop', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        el.classList.remove('is-drag-over');
        if (typeof window.activePatientApplyDropFromEvent === 'function') {
            if (window.activePatientApplyDropFromEvent(ev, slotIdx, 'active-card-drop')) {
                if (typeof isActivePatientDockCollapsed === 'function' && isActivePatientDockCollapsed()) {
                    setActivePatientDockCollapsed(false, true);
                }
                if (slotIdx === 0 && typeof showAppGlobalToast === 'function') {
                    var p0 = activePatientSlots[0];
                    if (p0) {
                        var msg0 = typeof appTrRepl === 'function'
                            ? appTrRepl('activePatient.setToast', { NAME: activePatientDropLabel(p0) })
                            : activePatientDropLabel(p0);
                        if (msg0) showAppGlobalToast(msg0);
                    }
                }
                return;
            }
        }
        var p = resolvePatientPayloadForDrop(ev);
        if (!p || !p.id) return;
        if (typeof isActivePatientDockCollapsed === 'function' && isActivePatientDockCollapsed()) {
            setActivePatientDockCollapsed(false, true);
        }
        setActivePatientSlot(slotIdx, p, 'active-card-drop', slotIdx === 0);
        clearPatientDragPayloadSession();
        if (slotIdx === 0 && typeof showAppGlobalToast === 'function') {
            var msg = typeof appTrRepl === 'function'
                ? appTrRepl('activePatient.setToast', { NAME: activePatientDropLabel(p) })
                : activePatientDropLabel(p);
            if (msg) showAppGlobalToast(msg);
        }
    });
}

function bindActivePatientCardOnce() {
    var stack = g('activePatientStack');
    var dock = g('activePatientDock');
    var swapBtn = g('activePatientSwapBtn');
    if (!stack || stack.dataset.bound) return;
    stack.dataset.bound = '1';
    if (swapBtn) {
        swapBtn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            promoteActivePatientSlot(1, 'active-slot-swap-btn');
        });
    }

    if (dock && !dock.dataset.dropBound) {
        dock.dataset.dropBound = '1';
        dock.addEventListener('dragover', function(ev) {
            if (!hasPatientDragPayload(ev)) return;
            ev.preventDefault();
        });
    }

    if (!stack.dataset.copyBound) {
        stack.dataset.copyBound = '1';
        stack.addEventListener('click', function(ev) {
            var phoneBtn = ev.target.closest('[data-act="copy-phone"]');
            var allBtn = ev.target.closest('[data-act="copy-all"]');
            if (!phoneBtn && !allBtn) return;
            ev.preventDefault();
            ev.stopPropagation();
            var card = ev.target.closest('.active-patient-card');
            if (!card || !card.classList.contains('is-filled')) return;
            var slotIdx = parseInt(card.getAttribute('data-slot') || '0', 10) || 0;
            var p = activePatientSlots[slotIdx];
            if (!p || !p.id) return;
            if (phoneBtn) {
                var raw = card.getAttribute('data-copy-phone') || activePatientBadgePhoneCopyRaw(p);
                if (!raw) return;
                activePatientCopyTextToClipboard(raw, function(ok) {
                    activePatientCopyToast(ok ? 'activePatient.copyPhoneToast' : 'activePatient.copyFailToast');
                });
                return;
            }
            var allText = activePatientBadgeCopyAllText(p);
            if (!allText) return;
            activePatientCopyTextToClipboard(allText, function(ok) {
                activePatientCopyToast(ok ? 'activePatient.copyAllToast' : 'activePatient.copyFailToast');
            });
        });
    }

    stack.querySelectorAll('.active-patient-card').forEach(function(card) {
        var slotIdx = parseInt(card.getAttribute('data-slot') || '0', 10) || 0;
        bindActivePatientCardDropTarget(card, slotIdx);
        bindActivePatientBadgeCursor(card);
        card.addEventListener('dragstart', function(ev) {
            if (activePatientBadgeDragBlockedTarget(ev.target)) {
                ev.preventDefault();
                return;
            }
            var payload = card.getAttribute('data-payload') || '';
            if (!payload) {
                ev.preventDefault();
                return;
            }
            setPatientDragPayloadSession(parsePatientDragPayload(payload));
            markActivePatientCardDrag(ev);
            ev.dataTransfer.effectAllowed = 'copyMove';
            ev.dataTransfer.setData('application/x-joyful-patient', payload);
            ev.dataTransfer.setData('text/plain', payload);
        });
        card.addEventListener('dragend', function() {
            clearPatientDragPayloadSession();
        });
    });

    stack.querySelectorAll('[data-act="clear-slot"]').forEach(function(btn) {
        btn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var slot = parseInt(btn.getAttribute('data-slot') || '0', 10) || 0;
            clearActivePatientSlot(slot, 'active-slot-clear-btn');
        });
    });
    document.addEventListener('app-active-patient-change', function(ev) {
        var detail = ev && ev.detail ? ev.detail : {};
        var src = String(detail.source || '');
        if (src.indexOf('active-slot-') === 0) {
            return;
        }
        if (detail.patient && detail.patient.id) {
            setActivePatientSlot(0, detail.patient, 'active-slot-event', false);
        } else if (!detail.patient) {
            setActivePatientSlot(0, null, 'active-slot-event-clear', false);
        }
    });
    document.addEventListener('app-lang-change', function() {
        renderActivePatientSlots();
    });

    var bootP = activePatientSnapshotFromGlobals();
    if (bootP) activePatientSlots[0] = normalizeActivePatientPayload(bootP);
    renderActivePatientSlots();
    if (activePatientSlots[0]) {
        syncPrimaryPatientContext('active-slot-boot');
    }
    bindActivePatientDockLayoutOnce();
}

function triggerGlobalRefresh(opts) {
    opts = opts || {};
    var savedScroll = captureAppScrollState();
    if (currentUserId && typeof refreshAppSessionStripContents === 'function') {
        refreshAppSessionStripContents();
    }

    if (sectionVisible('dashboardSection')) {
        if (typeof refreshDashboardUserBadge === 'function') refreshDashboardUserBadge();
        if (typeof MEMO_AI !== 'undefined' && typeof MEMO_AI.refreshDashboardStickies === 'function') {
            MEMO_AI.refreshDashboardStickies();
        }
    }

    if (sectionVisible('patientSection')) {
        if (typeof fetchPatients === 'function') fetchPatients();
        if (typeof selPatientId !== 'undefined' && selPatientId && typeof loadTreatments === 'function') {
            loadTreatments(selPatientId);
        }
    }

    if (!opts.skipAppt && sectionVisible('appointmentSection') && typeof reloadApptModuleData === 'function') {
        reloadApptModuleData();
    }
    var billPanel = g('billPanel');
    if (billPanel && billPanel.classList.contains('open') && typeof refreshBillPanelNow === 'function') {
        refreshBillPanelNow();
    }

    if (sectionVisible('consultationSection')) {
        var ctab = activeConsultationTabKey();
        if (typeof conPatientId !== 'undefined' && conPatientId) {
            if (typeof loadConNotes === 'function') loadConNotes(conPatientId);
            if (typeof loadDrugHistory === 'function') loadDrugHistory(conPatientId);
        }
        if (ctab === 'photos' && typeof refreshPhotos === 'function') refreshPhotos();
        if (ctab === 'xrays' && typeof refreshXrays === 'function') refreshXrays();
    }

    if (sectionVisible('drugSection') && typeof initDrugs === 'function') {
        initDrugs();
    }

    if (!opts.skipReport && sectionVisible('reportSection') &&
        typeof REPORT !== 'undefined' && typeof REPORT.refresh === 'function') {
        REPORT.refresh();
    }

    if (sectionVisible('aiHelperSection') &&
        typeof AIHELPER !== 'undefined' && typeof AIHELPER.init === 'function') {
        AIHELPER.init();
    }

    if (sectionVisible('memoCardsSection') &&
        typeof MEMO_AI !== 'undefined' && typeof MEMO_AI.init === 'function') {
        MEMO_AI.init();
    }

    if (sectionVisible('sectionConfig') &&
        typeof CFG !== 'undefined' &&
        typeof CFG.isInitialized === 'function' &&
        CFG.isInitialized() &&
        typeof CFG._reloadActiveTab === 'function') {
        CFG._reloadActiveTab();
    }
    scheduleAppScrollRestore(savedScroll);
    persistAppScrollRestoreState();
}

function onGlobalRefreshHotkey(e) {
    if (!e) return;
    if (e.key !== 'F2' && e.code !== 'F2') return;
    if (e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    triggerGlobalRefresh();
    var refreshWord = (typeof tr === 'function') ? tr('bill.btnRefresh') : 'Refreshed';
    showAppGlobalToast(refreshWord + ' (F2)');
}

// ════════════════════════════════════════════════════════════════
// MODAL HELPERS
// ════════════════════════════════════════════════════════════════
function openModal(id) {
    var m = g(id);
    if (m) m.style.display = 'block';
}

/** Patient add/edit: do not dismiss when clicking the dimmed area outside the form. */
var MODAL_NO_BACKDROP_CLOSE_IDS = {
    addPatientModal: 1,
    editPatientModal: 1,
    apptModal: 1
};

function ensureModalNoBackdropClose(modalId) {
    var m = modalId ? g(modalId) : null;
    if (!m) return;
    m.classList.add('modal-no-backdrop-close');
    m.setAttribute('data-no-backdrop-close', '1');
}

function modalAllowsBackdropClose(modalEl) {
    if (!modalEl) return true;
    if (modalEl.id && MODAL_NO_BACKDROP_CLOSE_IDS[modalEl.id]) return false;
    if (modalEl.getAttribute('data-no-backdrop-close') === '1') return false;
    if (modalEl.classList.contains('modal-no-backdrop-close')) return false;
    return true;
}

function closeModal(id) {
    var m = g(id);
    if (m) m.style.display = 'none';
    // reset module-level state when specific modals close
    if (id === 'patientDetailsModal')  selPatientId  = null;
    if (id === 'editPatientModal')     editPatientId = null;
    if (id === 'patientBananaModal' &&
        typeof patientDirBananaEditId !== 'undefined') {
        patientDirBananaEditId = null;
    }
    if (id === 'apptModal') {
        if (typeof resetApptBookingGuards === 'function') resetApptBookingGuards();
        apptEditId = null;
    }
    if (id === 'addPatientModal' && typeof clearTodayApptPendingPatientReg === 'function') {
        clearTodayApptPendingPatientReg();
    }
}

// ════════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════════
function setLoginError(msg) {
    var err = g('loginError');
    if (!err) return;
    err.textContent = msg || '';
    err.style.display = msg ? 'block' : 'none';
}

var JSM_POST_LOGIN_REFRESH_LS = 'jsm_post_login_refresh_v1';
var JSM_ASSET_CACHE_BUST_LS = 'jsm_asset_cache_bust_v1';

function jsmLocalStoragePreserveKeys() {
    var keys = {
        jsm_session: true,
        joyful_ui_lang_v1: true,
        joyful_working_date_override_v1: true,
        joyful_working_clinic_follow_v1: true,
        cal_doctor_colors_v1: true,
        cal_doctor_visible_v1: true,
        gcal_settings_v2: true
    };
    keys[JSM_POST_LOGIN_REFRESH_LS] = true;
    keys[JSM_ASSET_CACHE_BUST_LS] = true;
    return keys;
}

/** Clear tab-scoped and draft browser storage; keep login session + language/working-date prefs. */
function clearBrowserTempCachesOnLogin(done) {
    try { sessionStorage.clear(); } catch (e) {}

    var preserve = jsmLocalStoragePreserveKeys();
    try {
        var removeKeys = [];
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (k && !preserve[k]) removeKeys.push(k);
        }
        removeKeys.forEach(function (key) {
            try { localStorage.removeItem(key); } catch (e2) {}
        });
    } catch (e3) {}

    var cachePromise = Promise.resolve();
    if (typeof caches !== 'undefined' && caches.keys) {
        cachePromise = caches.keys().then(function (names) {
            return Promise.all(names.map(function (name) { return caches.delete(name); }));
        });
    }
    cachePromise.catch(function () {}).then(function () {
        if (typeof done === 'function') done();
    });
}

function stripLoginReloadQueryParam() {
    try {
        var url = new URL(window.location.href);
        if (!url.searchParams.has('_lr')) return;
        url.searchParams.delete('_lr');
        var qs = url.searchParams.toString();
        history.replaceState(null, '', url.pathname + (qs ? ('?' + qs) : '') + (url.hash || ''));
    } catch (e) {}
}

function consumePostLoginHardRefreshFlag() {
    try {
        if (localStorage.getItem(JSM_POST_LOGIN_REFRESH_LS) !== '1') return false;
        localStorage.removeItem(JSM_POST_LOGIN_REFRESH_LS);
        return true;
    } catch (e) {
        return false;
    }
}

/** Persist session, wipe temp caches, then Ctrl+F5-style reload (fresh HTML + JS/CSS). */
function schedulePostLoginHardRefresh() {
    try { persistSession(); } catch (e) {}
    try { localStorage.setItem(JSM_POST_LOGIN_REFRESH_LS, '1'); } catch (e2) {}
    clearBrowserTempCachesOnLogin(function () {
        var ts = String(Date.now());
        try { localStorage.setItem(JSM_ASSET_CACHE_BUST_LS, ts); } catch (e3) {}
        try {
            var url = new URL(window.location.href);
            url.searchParams.set('_lr', ts);
            url.hash = '';
            window.location.replace(url.toString());
        } catch (e4) {
            try { window.location.reload(); } catch (e5) {}
        }
    });
}

function persistSession() {
    try {
        localStorage.setItem('jsm_session', JSON.stringify({
            user_id: currentUserId,
            role: currentRole,
            name: currentName,
            clinic_id: currentClinicId,
            clinic_label: currentClinicLabel,
            doctor_id: currentDoctorId,
            doctor_name: currentDoctorName,
            permissions: currentUserPermissions
        }));
    } catch (e) {}
}

function clearSession() {
    try { localStorage.removeItem('jsm_session'); } catch (e) {}
    try { sessionStorage.removeItem(APP_SCROLL_RESTORE_SS); } catch (e2) {}
    if (typeof plusApptTransferHistoryClear === 'function') plusApptTransferHistoryClear();
}

function restoreSession() {
    try {
        var raw = localStorage.getItem('jsm_session');
        if (!raw) return false;
        var s = JSON.parse(raw);
        if (!s || !s.user_id) return false;
        currentUserId = s.user_id || null;
        currentRole = s.role || null;
        currentName = s.name || null;
        currentClinicId = s.clinic_id || null;
        currentClinicLabel = s.clinic_label || null;
        currentDoctorId = s.doctor_id || null;
        currentDoctorName = s.doctor_name || null;
        if (typeof setCurrentUserPermissions === 'function') {
            setCurrentUserPermissions(s.permissions);
        }
        return true;
    } catch (e) {
        return false;
    }
}

function loadClinicsAndDoctorsForLogin() {
    function finishClinicRows(rows) {
        APP_CLINICS = rows || [];
        refreshAllClinicTagFilterSelects();
        populateLoginClinicSelect();
        populateWorkingClinicSelect();
        refreshDashboardContextControls();
        if (typeof populateApptClinicSelect === 'function') populateApptClinicSelect();
        if (typeof fillAddPatientClinicSelect === 'function') {
            fillAddPatientClinicSelect();
        }
        if (typeof refreshEditPatientClinicIfModalOpen === 'function') {
            refreshEditPatientClinicIfModalOpen();
        }
        if (currentUserId) refreshAppSessionStripContents();
        if (currentClinicId && !isClinicOperational(clinicRecordFromId(currentClinicId))) {
            var nextId = defaultWorkingClinicId();
            if (nextId && typeof setWorkingClinic === 'function') {
                setWorkingClinic(nextId, { syncFilters: true, reloadAppt: false });
            }
        }
    }
    var clinicSelectFull = 'id,clinic_code,english_name,chinese_name,address,address_chinese,tel,fax,is_active';
    var clinicSelectLegacy = 'id,clinic_code,english_name,chinese_name,address,address_chinese,tel,fax';
    SB.from('clinics')
      .select(clinicSelectFull)
      .order('clinic_code')
    .then(function (r) {
        if (r.error && /is_active/i.test(String(r.error.message || ''))) {
            SB.from('clinics')
              .select(clinicSelectLegacy)
              .order('clinic_code')
            .then(function (r2) {
                finishClinicRows(r2.error ? [] : (r2.data || []));
            });
            return;
        }
        finishClinicRows(r.error ? [] : (r.data || []));
    });

    function finishDoctorList(rows) {
        APP_DOCTORS = (rows || []).filter(function (d) { return d.is_active !== false; });
        if (typeof CalDoctorColors !== 'undefined' && typeof CalDoctorColors.onDoctorsLoaded === 'function') {
            CalDoctorColors.onDoctorsLoaded();
        }
        refreshDashboardContextControls();
    }

    Promise.all([
        SB.from('doctors').select(
            'id,doctor_code,english_name,chinese_name,display_name,is_active,clinic_id,qualification,qualification_chinese'
        ).order('doctor_code'),
        SB.from('app_users').select('doctor_id,role,is_active,user_id,permissions')
    ]).then(function (all) {
        var dr = all[0];
        var ur = all[1];
        if (dr.error && /qualification_chinese/i.test(String(dr.error.message || ''))) {
            SB.from('doctors').select(
                'id,doctor_code,english_name,chinese_name,display_name,is_active,clinic_id,qualification'
            ).order('doctor_code')
            .then(function (r2) {
                finishDoctorList(r2.error ? [] : (r2.data || []));
                if (!ur.error) rebuildDoctorLoginIdsFromUsers(ur.data || []);
                refreshLoginDoctorSelect();
            });
            return;
        }
        if (dr.error) {
            APP_DOCTORS = [];
        } else {
            finishDoctorList(dr.data || []);
        }
        if (!ur.error) rebuildDoctorLoginIdsFromUsers(ur.data || []);
        refreshLoginDoctorSelect();
    });
}

function finishLoginSession(u, doctorId) {
    currentUserId = u ? u.user_id : currentUserId;
    currentRole = u ? (u.role || 'staff') : currentRole;
    if (typeof setCurrentUserPermissions === 'function') {
        setCurrentUserPermissions(u ? u.permissions : null);
    }

    if (doctorId) {
        applyIdentityFromDoctor(doctorId);
    } else {
        currentDoctorId = null;
        currentDoctorName = null;
    }
    if (u && u.display_name && (!doctorId || !currentDoctorName)) {
        currentName = u.display_name;
    }
    if (!currentName) currentName = currentUserId;

    var loginClinicId = selectedLoginClinicId();
    var wc = loginClinicId || defaultWorkingClinicId();
    if (wc) setWorkingClinic(wc, { syncFilters: true, reloadAppt: false });
    else persistSession();

    schedulePostLoginHardRefresh();
}

function doLogin() {
    var uid = (g('loginUserId').value || '').trim();
    var pw  = (g('loginPassword').value || '');
    var doctorId = (g('loginDoctor') && g('loginDoctor').value) ? g('loginDoctor').value : '';

    if (!uid || !pw) {
        setLoginError(appTr('login.errMissingCreds'));
        return;
    }
    setLoginError('');

    var btn = g('loginBtn');
    btn.disabled    = true;
    btn.textContent = appTr('login.loggingIn');

    function done(errMsg) {
        btn.disabled = false;
        btn.textContent = appTr('login.loginBtn');
        if (errMsg) setLoginError(errMsg);
    }

    if (uid.toLowerCase() === 'nurse' && pw === 'nurse') {
        currentUserId = 'nurse';
        currentRole = 'nurse';
        applyIdentityFromDoctor(doctorId);
        if (!currentDoctorName) currentName = 'Nurse';
        done();
        finishLoginSession({ user_id: 'nurse', role: 'nurse' }, doctorId);
        return;
    }

    SB.from('app_users')
      .select('*')
      .eq('user_id', uid)
      .eq('password', pw)
      .eq('is_active', true)
      .limit(1)
    .then(function (r) {
        if (r.error || !r.data || !r.data.length) {
            done(appTr('login.errInvalid'));
            return;
        }

        var u = r.data[0];

        if (u.role === 'admin') {
            if (doctorId) applyIdentityFromDoctor(doctorId);
            else {
                currentDoctorId = null;
                currentDoctorName = null;
                currentName = u.display_name || u.user_id;
            }
            done();
            finishLoginSession(u, doctorId || null);
            return;
        }

        var role = String(u.role || '').toLowerCase();
        var needsDoctor = role === 'doctor' || role === 'dentist';

        if (needsDoctor && !doctorId) {
            done(appTr('login.errSelectDoctor'));
            return;
        }

        if (needsDoctor && doctorId && !APP_DOCTOR_LOGIN_IDS[String(doctorId)]) {
            done(appTr('login.errDoctorNotSetup'));
            return;
        }

        var allowedDoctorIds = userLoginDoctorIds(u);
        if (doctorId && allowedDoctorIds.length && allowedDoctorIds.indexOf(String(doctorId)) < 0) {
            done(appTr('login.errDoctorMismatch'));
            return;
        }

        if (needsDoctor && !allowedDoctorIds.length) {
            done(appTr('login.errDoctorUnlinked'));
            return;
        }

        done();
        finishLoginSession(u, doctorId || null);
    })
    .catch(function (e) {
        done(e.message || appTr('login.errGeneric'));
    });
}

// ════════════════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {
    var postLoginRefresh = consumePostLoginHardRefreshFlag();
    if (postLoginRefresh) {
        clearBrowserTempCachesOnLogin();
        stripLoginReloadQueryParam();
    }

    appWorkingDateOverride = readWorkingDateOverrideFromStore();
    syncAppLocaleFromUiLang();
    bindUiClickGuardOnce();

    var hasSession = restoreSession();
    if (hasSession) {
        populateWorkingClinicSelect();
        bindAppScrollPersistOnce();
        if (!restoreAppSessionView()) showDashboard();
        if (typeof loadProgramSettings === 'function') loadProgramSettings(true);
        if (typeof prefetchBillTypes === 'function') prefetchBillTypes();
        if (typeof restartLoginIdleTimeout === 'function') restartLoginIdleTimeout();
        if (typeof startRealtimeSync === 'function') startRealtimeSync();
        try {
            document.dispatchEvent(new CustomEvent('app-session-sync'));
        } catch (eSync) {}
        if (hasEffectiveWorkingDateOverride()) {
            setTimeout(function () {
                refreshAppSectionsForWorkingDate();
            }, 400);
        }
    } else {
        showLogin();
        if (postLoginRefresh) {
            setLoginError(appTr('login.errGeneric'));
        }
    }
    bindActivePatientCardOnce();
    loadClinicsAndDoctorsForLogin();
    refreshAllClinicTagFilterSelects();
    /* rx_phrase_options: loaded on demand when prescription panel opens */

    var workClinicSel = g('appWorkingClinicSelect');
    if (workClinicSel && !workClinicSel.dataset.bound) {
        workClinicSel.dataset.bound = '1';
        workClinicSel.addEventListener('change', function () {
            setWorkingClinic(workClinicSel.value, { syncFilters: true, reloadAppt: true, refreshVisible: true });
            showClinicRefreshToast(workClinicSel.value, false);
        });
    }
    bindLoginClinicSelectOnce();
    wireAppDateAdjustControls();

    var loginUid = g('loginUserId');
    if (loginUid) {
        loginUid.addEventListener('blur', function () {
            prefetchLoginDoctorForUserId((loginUid.value || '').trim());
        });
    }

    // ── Auth buttons ──────────────────────────────────────────
    g('loginBtn').addEventListener('click', doLogin);

    g('loginPassword').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doLogin();
    });
    document.addEventListener('keydown', onGlobalRefreshHotkey);

    g('logoutBtn').addEventListener('click', function() {
        if (typeof stopRealtimeSync === 'function') stopRealtimeSync();
        currentRole = null;
        currentName = null;
        currentUserId = null;
        currentClinicId = null;
        currentClinicLabel = null;
        currentDoctorId = null;
        currentDoctorName = null;
        loginDoctorAllowedIds = null;
        if (typeof setCurrentUserPermissions === 'function') setCurrentUserPermissions(null);
        clearSession();
        showLogin();
        try {
            document.dispatchEvent(new CustomEvent('app-session-sync'));
        } catch (eSync) {}
    });

    var dashboardHelpBtn = g('dashboardHelpBtn');
    if (dashboardHelpBtn) {
        dashboardHelpBtn.addEventListener('click', openAppHelpPage);
    }

    // ── Dashboard cards ───────────────────────────────────────
    g('card-patient').addEventListener('click', function() {
        if (typeof guardModuleByPermission === 'function' &&
            !guardModuleByPermission('patient')) return;
        showOnly('patientSection');
        fetchPatients();
    });

    g('card-appointment').addEventListener('click', function() {
        if (typeof guardModuleByPermission === 'function' &&
            !guardModuleByPermission('appointment')) return;
        showOnly('appointmentSection');
        initAppt();
    });

    g('card-consultation').addEventListener('click', function() {
        if (typeof guardModuleByPermission === 'function' &&
            !guardModuleByPermission('consultation')) return;
        initConsultation();
    });

    var drugBookCard = g('card-drugbook');
    if (drugBookCard) {
        drugBookCard.addEventListener('click', function() {
            if (typeof guardModuleByPermission === 'function' &&
                !guardModuleByPermission('drug_inventory')) return;
            initDrugs();
        });
    }

        // ── Configuration card ────────────────────────────────────
    var cfgCard = g('card-configuration');
    if (cfgCard) {
        cfgCard.addEventListener('click', function() {
            if (typeof canAccessConfiguration === 'function' && !canAccessConfiguration()) {
                if (typeof permToastDenied === 'function') permToastDenied();
                else alert(appTr('alert.cfgAdminOnly'));
                return;
            }
            if (typeof CFG !== 'undefined' && typeof CFG.init === 'function') {
                showOnly('sectionConfig');
                CFG.init();
            } else {
                alert(appTr('alert.cfgLoading'));
            }
        });
    }

    // report card
    var reportCard = g('card-report');
    if (reportCard) {
        reportCard.addEventListener('click', function () {
            if (typeof guardModuleByPermission === 'function' &&
                !guardModuleByPermission('report')) return;
            showOnly('reportSection');
            if (typeof initReportModuleClinic === 'function') initReportModuleClinic();
            if (typeof REPORT !== 'undefined' && typeof REPORT.init === 'function') {
                REPORT.init();
            } else {
                alert(appTr('alert.reportLoading'));
            }
        });
    }

    var aiCard = g('card-ai-helper');
    if (aiCard) {
        aiCard.addEventListener('click', function () {
            showOnly('aiHelperSection');
            if (typeof AIHELPER !== 'undefined' && typeof AIHELPER.init === 'function') {
                AIHELPER.init();
            } else {
                alert(appTr('alert.aiLoading'));
            }
        });
    }

    var memoCard = g('card-memo-ai');
    if (memoCard) {
        memoCard.addEventListener('click', function() {
            showOnly('memoCardsSection');
            if (typeof MEMO_AI !== 'undefined' && typeof MEMO_AI.init === 'function') {
                MEMO_AI.init();
            } else {
                alert(appTr('alert.memoLoading'));
            }
        });
    }

    // placeholder cards (temporarily inactive)
    ['card-expenses', 'card-inventory']
    .forEach(function(id) {
        var c = g(id);
        if (c) {
            c.classList.add('dash-card-inactive');
            c.setAttribute('aria-disabled', 'true');
        }
    });

    var tryAiAssistantBtn = g('tryAiAssistantBtn');
    if (tryAiAssistantBtn) {
        tryAiAssistantBtn.addEventListener('click', function() {
            showOnly('aiHelperSection');
            if (typeof AIHELPER !== 'undefined' && typeof AIHELPER.init === 'function') {
                AIHELPER.init();
            }
        });
    }

    // ════════════════════════════════════════════════════════
    // PATIENT SECTION WIRING
    // ════════════════════════════════════════════════════════
    g('patientBack').addEventListener('click', showDashboard);
    g('mainAddBtn').addEventListener('click',  openAddPatient);
    g('searchInput').addEventListener('input', function() {
        if (typeof schedulePatientDirSearch === 'function') {
            schedulePatientDirSearch();
            return;
        }
        filterTable();
    });

    var patientDirPrevBtn = g('patientDirPrevBtn');
    if (patientDirPrevBtn) {
        patientDirPrevBtn.addEventListener('click', function() {
            if (typeof patientDirChangePage === 'function') patientDirChangePage(-1);
        });
    }
    var patientDirNextBtn = g('patientDirNextBtn');
    if (patientDirNextBtn) {
        patientDirNextBtn.addEventListener('click', function() {
            if (typeof patientDirChangePage === 'function') patientDirChangePage(1);
        });
    }
    var patientDirPageSize = g('patientDirPageSize');
    if (patientDirPageSize) {
        patientDirPageSize.addEventListener('change', function() {
            if (typeof patientDirApplyPageSize === 'function') patientDirApplyPageSize();
        });
    }
    var patientDirJumpBtn = g('patientDirJumpBtn');
    var patientDirJumpInput = g('patientDirJumpPageInput');
    if (patientDirJumpBtn && patientDirJumpInput) {
        patientDirJumpBtn.addEventListener('click', function() {
            if (typeof patientDirJumpToPage === 'function') {
                patientDirJumpToPage(patientDirJumpInput.value);
            }
        });
        patientDirJumpInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && typeof patientDirJumpToPage === 'function') {
                patientDirJumpToPage(patientDirJumpInput.value);
            }
        });
        patientDirJumpInput.addEventListener('input', function() {
            if (typeof setPatientDirJumpHint === 'function') {
                setPatientDirJumpHint('');
            }
        });
    }

    var patientDirCf = g('patientDirClinicFilter');
    if (patientDirCf) {
        patientDirCf.addEventListener('change', function() {
            if (typeof onPatientDirClinicFilterChange === 'function') {
                onPatientDirClinicFilterChange();
                return;
            }
            if (typeof fetchPatients === 'function') fetchPatients();
        });
    }

    var recallCf = g('recallClinicFilter');
    if (recallCf) {
        recallCf.addEventListener('change', function() {
            if (typeof loadRecallPatients === 'function' &&
                typeof rcDate !== 'undefined' && rcDate) {
                loadRecallPatients(rcDate);
            }
        });
    }

    function wireConClinicFilter(selId, inpId, searchFn) {
        var cf = g(selId);
        if (!cf || typeof searchFn !== 'function') return;
        cf.addEventListener('change', function() {
            var inp = g(inpId);
            if (inp && (inp.value || '').trim()) searchFn();
        });
    }

    wireConClinicFilter('conPsClinicFilter', 'conPsInput', doConPatientSearch);
    wireConClinicFilter('conPsClinicFilterMed', 'conPsInputMed', doConPatientSearchMed);
    wireConClinicFilter('conPsClinicFilterDen', 'conPsInputDen', doConPatientSearchDen);
    wireConClinicFilter('conPsClinicFilterXray', 'conPsInputXray', doConPatientSearchXray);
    wireConClinicFilter('conPsClinicFilterPhoto', 'conPsInputPhoto', doConPatientSearchPhoto);
    wireConClinicFilter('conPsClinicFilterChart', 'conPsInputChart', doConPatientSearchChart);
    wireConClinicFilter('conFormsPsClinicFilter', 'conFormsPsInput', doConFormsPatientSearch);


    g('closeAddPatient').addEventListener('click', function() {
        closeModal('addPatientModal');
    });
    g('closePatientDetails').addEventListener('click', function() {
        closeModal('patientDetailsModal');
    });
    g('closeEditPatient').addEventListener('click', function() {
        closeModal('editPatientModal');
    });
    g('cancelEditBtn').addEventListener('click', function() {
        closeModal('editPatientModal');
    });
    var closePatientBananaModal = g('closePatientBananaModal');
    if (closePatientBananaModal) {
        closePatientBananaModal.addEventListener('click', function() {
            closeModal('patientBananaModal');
        });
    }
    var patientBananaCancelBtn = g('patientBananaCancelBtn');
    if (patientBananaCancelBtn) {
        patientBananaCancelBtn.addEventListener('click', function() {
            closeModal('patientBananaModal');
        });
    }
    var patientBananaSaveBtn = g('patientBananaSaveBtn');
    if (patientBananaSaveBtn) {
        patientBananaSaveBtn.addEventListener('click', function() {
            if (typeof savePatientDirBananaPanel === 'function') {
                savePatientDirBananaPanel();
            }
        });
    }
    g('edit_deleteBtn').addEventListener('click', deletePatient);
    g('noteSaveBtn').addEventListener('click',    saveNote);
    g('patientForm').addEventListener('submit',   submitAddPatient);
    var previewNoEl = g('preview_patientNo');
    if (previewNoEl) {
        previewNoEl.addEventListener('input', function() {
            if (typeof scheduleAddPatientNoAvailabilityCheck === 'function') {
                scheduleAddPatientNoAvailabilityCheck();
            }
        });
        previewNoEl.addEventListener('blur', function() {
            if (typeof normalizePatientNoInput === 'function') {
                var norm = normalizePatientNoInput(previewNoEl.value);
                if (norm) sv('preview_patientNo', norm);
            }
            if (typeof updateAddPatientNoAvailabilityUI === 'function') {
                clearTimeout(addPatientNoCheckTimer);
                updateAddPatientNoAvailabilityUI();
            }
        });
    }
    var suggestNoBtn = g('btnSuggestPatientNo');
    if (suggestNoBtn) {
        suggestNoBtn.addEventListener('click', function(ev) {
            ev.preventDefault();
            if (typeof genPatientNo !== 'function') return;
            genPatientNo(function(no, err) {
                if (no) {
                    sv('preview_patientNo', no);
                    if (typeof updateAddPatientNoAvailabilityUI === 'function') {
                        updateAddPatientNoAvailabilityUI();
                    }
                    return;
                }
                if (err) {
                    alert(appTrRepl('patient.alertVerifyNoFail', {
                        MSG: (err && err.message) ? err.message : String(err)
                    }));
                    return;
                }
                alert(appTr('patient.alertNoFreeRange'));
            });
        });
    }
    g('editPatientForm').addEventListener('submit', submitEditPatient);

    // ════════════════════════════════════════════════════════
    // APPOINTMENT SECTION WIRING
    // ════════════════════════════════════════════════════════
    g('apptBack').addEventListener('click', showDashboard);

    g('addApptBtn').addEventListener('click', function() {
        openApptModal();
    });
    g('calAddBtn').addEventListener('click', function() {
        openApptModal();
    });
    g('closeApptModal').addEventListener('click', function() {
        closeModal('apptModal');
    });
    g('btnSaveAppt').addEventListener('click', saveAppt);

    g('apptPopupClose').addEventListener('click', function() {
        g('apptPopup').style.display = 'none';
    });

    // appointment tabs
    document.querySelectorAll('.appt-tab').forEach(function(btn) {
        btn.addEventListener('click', function() {
            switchApptTab(btn.dataset.tab);
        });
    });

    // calendar controls
    g('btnWeek').addEventListener('click', function() {
        calView = 'weekly';
        g('btnWeek').classList.add('active');
        g('btnMonth').classList.remove('active');
        renderCal();
    });
    g('btnMonth').addEventListener('click', function() {
        calView = 'monthly';
        g('btnMonth').classList.add('active');
        g('btnWeek').classList.remove('active');
        renderCal();
    });
    g('calPrev').addEventListener('click', function() {
        if (calView === 'weekly')
            calDate = new Date(calDate.getFullYear(), calDate.getMonth(), calDate.getDate() - 7);
        else
            calDate = new Date(calDate.getFullYear(), calDate.getMonth() - 1, 1);
        renderCal();
        if (typeof apptMemoOnScopeChange === 'function' && typeof apptActiveTabKey === 'function' &&
            apptActiveTabKey() === 'calendar') {
            apptMemoOnScopeChange('calendar');
        }
    });
    g('calNext').addEventListener('click', function() {
        if (calView === 'weekly')
            calDate = new Date(calDate.getFullYear(), calDate.getMonth(), calDate.getDate() + 7);
        else
            calDate = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1);
        renderCal();
        if (typeof apptMemoOnScopeChange === 'function' && typeof apptActiveTabKey === 'function' &&
            apptActiveTabKey() === 'calendar') {
            apptMemoOnScopeChange('calendar');
        }
    });
    g('calTodayBtn').addEventListener('click', function() {
        if (calView === 'weekly') GCAL.goToday();
        else { calDate = new Date(); renderCal(); }
        if (typeof apptMemoOnScopeChange === 'function' && typeof apptActiveTabKey === 'function' &&
            apptActiveTabKey() === 'calendar') {
            apptMemoOnScopeChange('calendar');
        }
    });

    // appointment modal — duration auto-calc
    g('fStart').addEventListener('change', calcEnd);
    g('fDur').addEventListener('change',   calcEnd);

    // patient search in appointment modal
    g('psInput').addEventListener('input', function() {
        clearTimeout(psTimer);
        psTimer = setTimeout(doPatientSearch, 280);
    });

    // bill panel (handlers live in app-appt.js)
    if (typeof wireBillPanelControls === 'function') wireBillPanelControls();

    // ════════════════════════════════════════════════════════
    // CONSULTATION SECTION WIRING
    // ════════════════════════════════════════════════════════
    g('conBack').addEventListener('click', showDashboard);

    var memoBackBtn = g('memoBackBtn');
    if (memoBackBtn) {
        memoBackBtn.addEventListener('click', function() {
            if (currentUserId) showDashboard(); else showLogin();
        });
    }

    // report back
    var reportBack = g('reportBack');
    if (reportBack) reportBack.addEventListener('click', showDashboard);

    var aiHelperBack = g('aiHelperBack');
    if (aiHelperBack) {
        aiHelperBack.addEventListener('click', function() {
            if (currentUserId) showDashboard(); else showLogin();
        });
    }

    // ai pitch collapse
    var aiPitchToggle = g('aiPitchToggle');
    if (aiPitchToggle) {
        aiPitchToggle.addEventListener('click', function() {
            var d = g('aiPitchDetail');
            if (!d) return;
            var open = d.style.display !== 'none';
            d.style.display = open ? 'none' : 'block';
            aiPitchToggle.textContent = open
                ? appTr('ai.pitchToggle')
                : appTr('ai.pitchHide');
        });
    }

    // consultation tabs
    document.querySelectorAll('.con-tab').forEach(function(btn) {
        btn.addEventListener('click', function() {
            switchConTab(btn.dataset.tab);
        });
    });

    // patient search in consultation
    g('conPsInput').addEventListener('input', function() {
        clearTimeout(conPsTimer);
        conPsTimer = setTimeout(doConPatientSearch, 280);
    });

    // treatment note save
    var conNoteInp = g('conNoteInput');
    if (conNoteInp && /^\s*$/.test(conNoteInp.value || '')) conNoteInp.value = '';
    g('conNoteSaveBtn').addEventListener('click', saveConNote);
    if (g('conNoteSaveTplBtn')) g('conNoteSaveTplBtn').addEventListener('click', conSaveNoteAsTemplate);
    if (g('conNoteFromTplBtn')) g('conNoteFromTplBtn').addEventListener('click', conOpenTemplatePicker);
    if (g('conNoteTemplateApplyBtn')) g('conNoteTemplateApplyBtn').addEventListener('click', conApplyTemplateToNote);
    if (g('conNoteTemplateSaveBtn')) g('conNoteTemplateSaveBtn').addEventListener('click', conSaveTemplateEdits);
    if (g('conNoteTemplateDeleteBtn')) g('conNoteTemplateDeleteBtn').addEventListener('click', conDeleteTemplate);
    if (g('conNoteTemplateSelect')) g('conNoteTemplateSelect').addEventListener('change', conLoadTemplateEditorFields);

    // drug prescription panel
    g('btnAddPrescription').addEventListener('click', function() {
        toggleDrugAddPanel(true);
    });
    g('btnCancelRx').addEventListener('click', function() {
        toggleDrugAddPanel(false);
    });
    g('btnAddDrugLine').addEventListener('click', addDrugLine);
    g('btnSaveRx').addEventListener('click',      saveFullPrescription);
    if (g('btnRxSaveAsList')) {
        g('btnRxSaveAsList').addEventListener('click', rxSaveCurrentAsComboList);
    }
    if (g('btnRxOpenDrugLists')) {
        g('btnRxOpenDrugLists').addEventListener('click', rxOpenDrugListsPicker);
    }

    // drug list manager
    g('btnManageDrugList').addEventListener('click', openDrugListManager);
    g('closeDrugListModal').addEventListener('click', function() {
        closeModal('drugListModal');
    });
    g('btnSaveDrugItem').addEventListener('click', saveDrugItem);
    g('dlCancelEdit').addEventListener('click',    resetDrugForm);
    if (typeof initRxSavedComboListsUI === 'function') initRxSavedComboListsUI();

        // Configuration module will init when card is clicked
    
    // ── Configuration back button ─────────────────────────────
    var cfgBackBtn = g('cfgBackBtn');
    if (cfgBackBtn) {
        cfgBackBtn.addEventListener('click', showDashboard);
    }

    // ════════════════════════════════════════════════════════
    // GLOBAL CLICK HANDLERS
    // ════════════════════════════════════════════════════════

    document.addEventListener('click', function(e) {
        var pop = g('appDateAdjustPopover');
        var strip = g('appSessionStrip');
        if (pop && pop.style.display !== 'none') {
            var insidePop = pop.contains(e.target);
            var insideStrip = strip && strip.contains(e.target);
            if (!insidePop && !insideStrip) {
                toggleAppDateAdjustPopover(false);
            }
        }

        // action dropdown close is handled in app-appt.js (bindQueueActionDropGlobalCloseOnce)

        // close appointment patient search dropdown
        var psWrap = document.querySelector('#apptModal .ps-wrap');
        if (psWrap && !psWrap.contains(e.target)) {
            var psDrop = g('psDrop');
            if (psDrop) psDrop.style.display = 'none';
        }

        var plusPsWrap = document.querySelector('.plusappt-ps-wrap');
        if (plusPsWrap && !plusPsWrap.contains(e.target)) {
            var plusDrop = g('plusApptPsDrop');
            if (plusDrop) plusDrop.style.display = 'none';
        }

        // close consultation patient search dropdown
        var conPsWrap = document.querySelector('.con-search-bar .ps-wrap');
        if (conPsWrap && !conPsWrap.contains(e.target)) {
            var conDrop = g('conPsDrop');
            if (conDrop) conDrop.style.display = 'none';
        }
        var conChartWrap = g('conChartPsWrap');
        if (conChartWrap && !conChartWrap.contains(e.target)) {
            var conDropChart = g('conPsDropChart');
            if (conDropChart) conDropChart.style.display = 'none';
        }

        // close appointment popup
        var pop = g('apptPopup');
        if (pop && pop.style.display === 'block') {
            if (!pop.contains(e.target) &&
                !e.target.classList.contains('appt-pill') &&
                !e.target.classList.contains('chip')) {
                pop.style.display = 'none';
            }
        }
    });

    // modal backdrop click to close (skipped for modals with data-no-backdrop-close)
    document.querySelectorAll('.modal').forEach(function(m) {
        m.addEventListener('click', function(e) {
            if (e.target !== m) return;
            if (!modalAllowsBackdropClose(m)) return;
            if (m.id) closeModal(m.id);
            else m.style.display = 'none';
        });
    });

    startAppSessionStripClock();
    syncAppSessionChrome();

    scheduleMarkAppReady();

}); // end DOMContentLoaded

// ════════════════════════════════════════════════════════════════
// UI LANGUAGE — refresh dynamic labels after display language changes
// ════════════════════════════════════════════════════════════════
function refreshAiPitchToggleI18n() {
    var pitchBtn = g('aiPitchToggle');
    var pitchDet = g('aiPitchDetail');
    if (!pitchBtn || !pitchDet) return;
    pitchBtn.textContent = pitchDet.style.display !== 'none'
        ? appTr('ai.pitchHide')
        : appTr('ai.pitchToggle');
}

function moduleSectionNeedsI18n(sid, el) {
    if (!el) return false;
    if (el.style.display !== 'none') return true;
    if (sid === 'patientSection') {
        if (typeof patientListCache !== 'undefined' && patientListCache.length > 0) {
            return true;
        }
        if (typeof _patientDetailsPatient !== 'undefined' && _patientDetailsPatient &&
            typeof selPatientId !== 'undefined' && selPatientId) {
            return true;
        }
    }
    if (sid === 'drugSection') {
        if (typeof drugMasterList !== 'undefined' && drugMasterList.length) return true;
        if (typeof drugSelectedId !== 'undefined' && drugSelectedId) return true;
    }
    if (sid === 'consultationSection') {
        if (typeof conPatientData !== 'undefined' && conPatientData) return true;
        if (typeof chartPatientId !== 'undefined' && chartPatientId) return true;
        if (typeof photoPatientId !== 'undefined' && photoPatientId) return true;
        if (typeof xrayPatientId !== 'undefined' && xrayPatientId) return true;
        return (typeof conPatientId !== 'undefined' && conPatientId) ||
            (typeof conFormsPatientId !== 'undefined' && conFormsPatientId);
    }
    if (sid === 'appointmentSection') {
        var panel = g('billPanel');
        if (panel && panel.classList.contains('open')) return true;
        var apptModal = g('apptModal');
        if (apptModal && apptModal.style.display === 'block') return true;
        var apptPop = g('apptPopup');
        if (apptPop && apptPop.style.display !== 'none' &&
            typeof _apptPopupCtx !== 'undefined' && _apptPopupCtx) {
            return true;
        }
        var dayPanel = g('dayPanel');
        if (dayPanel && dayPanel.style.display !== 'none' &&
            typeof _dayPanelCtx !== 'undefined' && _dayPanelCtx) {
            return true;
        }
        if (typeof todayAppts !== 'undefined' && todayAppts.length) return true;
        if (typeof plusApptDayAppts !== 'undefined' && plusApptDayAppts.length) return true;
        var plusTb = g('plusApptScheduleBody');
        if (plusTb && plusTb.querySelector('.plusappt-slot-row')) return true;
        if (typeof arAllData !== 'undefined' && arAllData.length) return true;
        if (typeof rcDate !== 'undefined' && rcDate) return true;
        if (typeof rcSendQueue !== 'undefined' && rcSendQueue.length) return true;
        var qb = g('queueBody');
        if (qb && qb.querySelector('tr.queue-row-draggable')) return true;
        var cb = g('calBody');
        if (cb && cb.children.length) return true;
        if (typeof calView !== 'undefined' && calView === 'weekly') return true;
    }
    if (sid === 'reportSection' && typeof REPORT !== 'undefined' &&
        typeof REPORT.isInitialized === 'function') {
        return REPORT.isInitialized();
    }
    if (sid === 'memoCardsSection') {
        var memoList = g('memoCardList');
        if (memoList && memoList.children.length) return true;
    }
    if (sid === 'aiHelperSection') {
        var birthList = g('aiBirthPatientList');
        var recallList = g('aiRecallPatientList');
        if (birthList && birthList.children.length) return true;
        if (recallList && recallList.children.length) return true;
    }
    if (sid === 'dashboardSection') {
        var dock = g('memoStickyDock');
        if (dock && dock.children.length) return true;
    }
    if (sid === 'sectionConfig') {
        if (typeof CFG !== 'undefined' && typeof CFG.isInitialized === 'function' && CFG.isInitialized()) {
            return true;
        }
        return !!document.querySelector('.cfg-sidebar .cfg-nav-item.active');
    }
    return false;
}

function applyVisibleModuleSectionI18n() {
    if (typeof applyI18nInRoot !== 'function') return;
    var ids = [
        'dashboardSection',
        'patientSection', 'reportSection', 'drugSection', 'memoCardsSection',
        'consultationSection', 'sectionConfig', 'appointmentSection', 'aiHelperSection'
    ];
    ids.forEach(function(sid) {
        var el = g(sid);
        if (moduleSectionNeedsI18n(sid, el)) applyI18nInRoot(el);
    });
    var billPanel = g('billPanel');
    if (billPanel && billPanel.classList.contains('open')) {
        applyI18nInRoot(billPanel);
    }
    var calLegend = g('calDoctorLegend');
    if (calLegend && calLegend.children.length &&
        typeof CalDoctorColors !== 'undefined' &&
        typeof CalDoctorColors.renderLegend === 'function') {
        CalDoctorColors.renderLegend();
    }
    if (typeof chartPatientId !== 'undefined' && chartPatientId) {
        var chartPane = g('con-charting');
        var chartTab = g('chartingTabContent');
        if (chartPane) applyI18nInRoot(chartPane);
        if (chartTab) applyI18nInRoot(chartTab);
    }
    if (typeof photoPatientId !== 'undefined' && photoPatientId) {
        var photoPane = g('con-photos');
        if (photoPane) applyI18nInRoot(photoPane);
    }
    if (typeof xrayPatientId !== 'undefined' && xrayPatientId) {
        var xrayPane = g('con-xrays');
        if (xrayPane) applyI18nInRoot(xrayPane);
    }
}

function applyOpenGlobalModalsI18n() {
    if (typeof applyI18nInRoot !== 'function') return;
    if (typeof CFG !== 'undefined' && typeof CFG.refreshOpenModalsI18n === 'function') {
        CFG.refreshOpenModalsI18n();
    }
    var ids = [
        'apptModal', 'apptPopup', 'queueRemarksModal', 'recallSendModal',
        'billDetailModal', 'receiptModal', 'receiptPrintOptionsModal', 'billHistoryPrintModal', 'addPaymentModal', 'billDeleteModal',
        'patientDetailsModal', 'addPatientModal', 'editPatientModal', 'patientBananaModal',
        'photoUploadModal', 'photoLightbox',
        'xrayUploadModal', 'xrayLightbox', 'diySystemModal',
        'conNoteTemplateModal',
        'rxDrugListsModal', 'drugListModal'
    ];
    ids.forEach(function(mid) {
        var mod = g(mid);
        if (mod && mod.style.display === 'block') applyI18nInRoot(mod);
    });
    var calColors = g('calDoctorColorsModal');
    if (calColors && calColors.classList.contains('open')) {
        applyI18nInRoot(calColors);
    }
    var apptPop = g('apptPopup');
    if (apptPop && apptPop.style.display !== 'none' &&
        typeof _apptPopupCtx !== 'undefined' && _apptPopupCtx) {
        applyI18nInRoot(apptPop);
        if (typeof refreshApptPopupI18n === 'function') refreshApptPopupI18n();
    }
    var cfgPrint = g('cfgPrintModal');
    if (cfgPrint && !cfgPrint.classList.contains('hidden')) {
        applyI18nInRoot(cfgPrint);
    }
    var cfgConfirm = g('cfgConfirmOverlay');
    if (cfgConfirm && !cfgConfirm.classList.contains('hidden')) {
        applyI18nInRoot(cfgConfirm);
    }
    var cfgUser = g('cfgUserPanel');
    if (cfgUser && cfgUser.style.display !== 'none') {
        applyI18nInRoot(cfgUser);
    }
    ['clinicPanel', 'docPanel', 'pmPanel', 'txPanel'].forEach(function(pid) {
        var p = g(pid);
        if (p && p.style.display !== 'none') applyI18nInRoot(p);
    });
    var cfgDynOv = document.getElementById('cfgConfirmOv');
    if (cfgDynOv && typeof applyI18nInRoot === 'function') applyI18nInRoot(cfgDynOv);
    if (typeof refreshConOpenModalsI18n === 'function') refreshConOpenModalsI18n();
    if (typeof CFG !== 'undefined' && typeof CFG.refreshOpenModalsI18n === 'function') {
        CFG.refreshOpenModalsI18n();
    }
    var dayPanel = g('dayPanel');
    if (dayPanel && dayPanel.style.display !== 'none' &&
        typeof _dayPanelCtx !== 'undefined' && _dayPanelCtx &&
        typeof showDayPanel === 'function') {
        var dayMap = {};
        dayMap[_dayPanelCtx.iso] = _dayPanelCtx.items;
        showDayPanel(_dayPanelCtx.iso, dayMap);
    }
    if (typeof CalDoctorColors !== 'undefined' &&
        typeof CalDoctorColors.refreshI18n === 'function') {
        var calColors = g('calDoctorColorsModal');
        if (calColors && calColors.classList.contains('open')) CalDoctorColors.refreshI18n();
    }
}

document.addEventListener('app-lang-change', function() {
    syncAppLocaleFromUiLang();
    if (typeof applyVisibleModuleSectionI18n === 'function') {
        applyVisibleModuleSectionI18n();
    }
    if (typeof applyOpenGlobalModalsI18n === 'function') {
        applyOpenGlobalModalsI18n();
    }
    if (typeof refreshVisiblePatientSearchDropdowns === 'function') {
        refreshVisiblePatientSearchDropdowns();
    }
    var loginOv = g('loginOverlay');
    if (loginOv && loginOv.style.display === 'flex' && typeof applyI18nInRoot === 'function') {
        applyI18nInRoot(loginOv);
    }
    if (typeof refreshLoginDoctorSelect === 'function') {
        var ls = g('loginDoctor');
        refreshLoginDoctorSelect(ls && ls.value ? ls.value : '', loginDoctorSelectMode);
    }
    if (typeof refreshAllClinicDropdowns === 'function') {
        refreshAllClinicDropdowns();
    }
    if (typeof setEditPatientModalForRole === 'function') {
        var editPatModal = g('editPatientModal');
        if (editPatModal && editPatModal.style.display === 'block') setEditPatientModalForRole();
    }
    if (typeof updateAddPatientNoAvailabilityUI === 'function') {
        var addPatModal2 = g('addPatientModal');
        if (addPatModal2 && addPatModal2.style.display === 'block') {
            updateAddPatientNoAvailabilityUI();
        }
    }
    if (currentUserId && typeof refreshAppSessionStripContents === 'function') {
        refreshAppSessionStripContents();
    }
    if (typeof refreshApptCachedTabsI18n === 'function') refreshApptCachedTabsI18n();
    if (typeof syncApptTodayDateLabels === 'function') syncApptTodayDateLabels();
    if (typeof refreshDashboardUserBadge === 'function') refreshDashboardUserBadge();
    if (typeof refreshApptHeaderI18n === 'function') refreshApptHeaderI18n();
    if (typeof refreshAiPitchToggleI18n === 'function') refreshAiPitchToggleI18n();
    if (typeof MEMO_AI !== 'undefined' && typeof MEMO_AI.refreshDashboardStickies === 'function') {
        MEMO_AI.refreshDashboardStickies();
    }
    var dashSec = g('dashboardSection');
    if (dashSec && dashSec.style.display !== 'none' && typeof applyDashboardI18n === 'function') {
        applyDashboardI18n();
    }
    if (dashSec && dashSec.style.display !== 'none' &&
        typeof refreshDashboardContextControls === 'function') {
        refreshDashboardContextControls();
    }
});
