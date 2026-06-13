// ════════════════════════════════════════════════════════════════
// app-program-settings.js — Cached program_settings loader + helpers
// Load after app.js; consumed by patient, appt, billing, consultation, audit.
// ════════════════════════════════════════════════════════════════

var PROGRAM_SETTINGS = {};
var _programSettingsLoadPromise = null;

function getProgramSetting(key, defaultVal) {
    if (!PROGRAM_SETTINGS || typeof PROGRAM_SETTINGS !== 'object') {
        return defaultVal != null ? defaultVal : '';
    }
    var v = PROGRAM_SETTINGS[key];
    if (v === undefined || v === null) return defaultVal != null ? defaultVal : '';
    return v;
}

function programSettingBool(key, defaultVal) {
    var v = getProgramSetting(key, '');
    if (v === '' && defaultVal === false) return false;
    if (v === '' && defaultVal === true) return true;
    if (v === '' && defaultVal !== undefined) return !!defaultVal;
    return String(v).toLowerCase() === 'true';
}

function getProgramSettingInt(key, defaultVal) {
    var n = parseInt(getProgramSetting(key, ''), 10);
    return isNaN(n) ? defaultVal : n;
}

function getCurrencySymbol() {
    var s = String(getProgramSetting('currency_symbol', '') || '').trim();
    if (s) return s;
    return (typeof t === 'function') ? t('common.currencyPrefix') : 'HK$';
}

function patientNoDigitWidth() {
    var n = getProgramSettingInt('patient_no_digits', 6);
    if (n < 4 || n > 10) return 6;
    return n;
}

function patientNoPrefix() {
    return String(getProgramSetting('patient_no_prefix', '') || '').trim();
}

function formatPatientNoFromNumber(num) {
    var digits = patientNoDigitWidth();
    var padded = String(num).padStart(digits, '0');
    var prefix = patientNoPrefix();
    return prefix ? (prefix + padded) : padded;
}

function stripPatientNoPrefix(raw) {
    var s = String(raw || '').trim();
    var prefix = patientNoPrefix();
    if (prefix && s.toUpperCase().indexOf(prefix.toUpperCase()) === 0) {
        s = s.slice(prefix.length);
    }
    return s;
}

/** Lowest numeric core for the configured width (6 digits → 010000 = 10000). */
function patientNoMinReg() {
    var digits = patientNoDigitWidth();
    return Math.pow(10, Math.max(1, digits - 2));
}

/** Highest numeric core (6 digits → 999999). */
function patientNoMaxReg() {
    return Math.pow(10, patientNoDigitWidth()) - 1;
}

/** Parse stored patient_no to numeric core, or null if out of range / invalid. */
function parsePatientNoCore(raw) {
    var core = stripPatientNoPrefix(raw);
    var digits = patientNoDigitWidth();
    var s = String(core || '').trim().replace(/\D/g, '');
    if (!s.length || s.length > digits) return null;
    var n = parseInt(s, 10);
    if (isNaN(n) || n < patientNoMinReg() || n > patientNoMaxReg()) return null;
    return n;
}

function applyProgramSettingsSideEffects() {
    if (typeof setAuditLoggingFromProgramSetting === 'function') {
        setAuditLoggingFromProgramSetting(programSettingBool('audit_trail', true));
    }
    if (typeof restartLoginIdleTimeout === 'function') restartLoginIdleTimeout();
    if (typeof applyMedicalNotesProgramLocks === 'function') applyMedicalNotesProgramLocks();
    if (typeof applyAddMedicalTermProgramUi === 'function') applyAddMedicalTermProgramUi();
    if (typeof restartApptAutoRefresh === 'function') restartApptAutoRefresh();
    if (typeof restartBillPendingAutoRefresh === 'function') restartBillPendingAutoRefresh();
    if (typeof CalDoctorColors !== 'undefined' && typeof CalDoctorColors.hydrateFromServer === 'function') {
        CalDoctorColors.hydrateFromServer({ refresh: true });
    }
    if (typeof CalDoctorColors !== 'undefined' &&
        typeof CalDoctorColors.migrateLocalColorsToServerIfNeeded === 'function') {
        CalDoctorColors.migrateLocalColorsToServerIfNeeded();
    }
}

function loadProgramSettings(force) {
    if (!force && _programSettingsLoadPromise) return _programSettingsLoadPromise;
    if (!SB || typeof SB.from !== 'function') {
        PROGRAM_SETTINGS = {};
        applyProgramSettingsSideEffects();
        return Promise.resolve(PROGRAM_SETTINGS);
    }
    _programSettingsLoadPromise = SB.from('program_settings')
        .select('setting_key,setting_value')
        .then(function (r) {
            if (r.error) throw new Error(r.error.message);
            PROGRAM_SETTINGS = {};
            (r.data || []).forEach(function (row) {
                if (row && row.setting_key) {
                    PROGRAM_SETTINGS[row.setting_key] = row.setting_value;
                }
            });
            applyProgramSettingsSideEffects();
            return PROGRAM_SETTINGS;
        })
        .catch(function () {
            PROGRAM_SETTINGS = PROGRAM_SETTINGS || {};
            applyProgramSettingsSideEffects();
            return PROGRAM_SETTINGS;
        });
    return _programSettingsLoadPromise;
}

function refreshProgramSettingsCache() {
    _programSettingsLoadPromise = null;
    return loadProgramSettings(true);
}

// ── Login idle timeout ────────────────────────────────────────
var _loginIdleTimer = null;

function performProgramIdleLogout() {
    if (!currentUserId) return;
    currentRole = null;
    currentName = null;
    currentUserId = null;
    currentClinicId = null;
    currentClinicLabel = null;
    currentDoctorId = null;
    currentDoctorName = null;
    if (typeof setCurrentUserPermissions === 'function') setCurrentUserPermissions(null);
    if (typeof clearSession === 'function') clearSession();
    if (typeof showLogin === 'function') showLogin();
}

function restartLoginIdleTimeout() {
    if (_loginIdleTimer) {
        clearTimeout(_loginIdleTimer);
        _loginIdleTimer = null;
    }
    if (!currentUserId) return;
    var mins = getProgramSettingInt('login_timeout_minutes', 0);
    if (mins <= 0) return;
    _loginIdleTimer = setTimeout(performProgramIdleLogout, mins * 60000);
}

function bindLoginIdleTimeoutOnce() {
    if (document.body && document.body.dataset.progIdleBound) return;
    if (document.body) document.body.dataset.progIdleBound = '1';
    ['click', 'keydown', 'mousemove', 'touchstart'].forEach(function (ev) {
        document.addEventListener(ev, restartLoginIdleTimeout, { passive: true, capture: true });
    });
}

// ── Consultation: medical notes locks ─────────────────────────
function medicalNotesEditingAllowed() {
    if (programSettingBool('lock_medical_notes', false)) return false;
    if (!programSettingBool('modify_medical_notes', true)) {
        if (typeof hasAppPermission === 'function' &&
            hasAppPermission('consult_modify_medical_notes')) {
            return true;
        }
        return false;
    }
    return true;
}

function applyMedicalNotesProgramLocks() {
    var allowed = medicalNotesEditingAllowed();
    ['fldMedHistory', 'fldMedications', 'fldAllergy'].forEach(function (id) {
        var el = g(id);
        if (!el) return;
        el.readOnly = !allowed;
        el.style.background = allowed ? '' : '#f8fafc';
    });
    var saveBtn = document.querySelector('#conMedForm .history-save-btn');
    if (saveBtn) saveBtn.style.display = allowed ? '' : 'none';
    var hint = document.querySelector('#conMedForm .history-save-hint');
    if (hint) hint.style.display = allowed ? '' : 'none';
}

function applyAddMedicalTermProgramUi() {
    var allowed = programSettingBool('add_medical_term', true);
    var saveTpl = g('conNoteSaveTplBtn');
    if (saveTpl) saveTpl.style.display = allowed ? '' : 'none';
    var tplSave = g('conNoteTemplateSaveBtn');
    var tplDel = g('conNoteTemplateDeleteBtn');
    if (tplSave) tplSave.style.display = allowed ? '' : 'none';
    if (tplDel) tplDel.style.display = allowed ? '' : 'none';
}

function applyProgramReceiptHeaderFooter() {
    var hdr = String(getProgramSetting('receipt_header', '') || '').trim();
    var ftr = String(getProgramSetting('receipt_footer', '') || '').trim();
    var area = g('receiptPrintArea');
    if (!area) return;

    var hdrEl = g('rProgramReceiptHeader');
    if (hdr) {
        if (!hdrEl) {
            hdrEl = document.createElement('div');
            hdrEl.id = 'rProgramReceiptHeader';
            hdrEl.className = 'receipt-program-header';
            hdrEl.style.cssText = 'text-align:center;margin-bottom:8px;font-size:12px;line-height:1.4;white-space:pre-wrap;';
            var clinicHdr = area.querySelector('.receipt-header');
            if (clinicHdr) area.insertBefore(hdrEl, clinicHdr);
            else area.insertBefore(hdrEl, area.firstChild);
        }
        hdrEl.textContent = hdr;
        hdrEl.style.display = '';
    } else if (hdrEl) {
        hdrEl.style.display = 'none';
    }

    var ftrEl = g('rProgramReceiptFooter');
    var thanksEl = g('rReceiptFooterThanks');
    if (ftr) {
        if (!ftrEl) {
            ftrEl = document.createElement('div');
            ftrEl.id = 'rProgramReceiptFooter';
            ftrEl.className = 'receipt-program-footer';
            ftrEl.style.cssText = 'text-align:center;margin-top:10px;font-size:12px;line-height:1.4;white-space:pre-wrap;';
            if (thanksEl && thanksEl.parentNode) {
                thanksEl.parentNode.insertBefore(ftrEl, thanksEl);
            } else {
                area.appendChild(ftrEl);
            }
        }
        ftrEl.textContent = ftr;
        ftrEl.style.display = '';
    } else if (ftrEl) {
        ftrEl.style.display = 'none';
    }
}

document.addEventListener('DOMContentLoaded', function () {
    bindLoginIdleTimeoutOnce();
    loadProgramSettings();
});
