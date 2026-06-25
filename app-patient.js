// ════════════════════════════════════════════════════════════════
// PATIENT STATE
// ════════════════════════════════════════════════════════════════
var selPatientId  = null;
var editPatientId = null;
/** Snapshot of patients.clinic_tag when edit modal opened (for refilling dropdown after clinics load). */
var editPatientLoadedClinicTag = '';
var selPatientClinicTag = null;
/** Last fetched patient list (for i18n re-render). */
var patientListCache = [];
var PATIENT_DIR_PAGE_SIZE = 100;
var PATIENT_DIR_PAGE_SIZE_OPTIONS = [50, 100, 200];
var patientDirPageIndex = 0;
var patientDirTotalCount = 0;
var patientDirFetchToken = 0;
var patientDirSearchTimer = null;
/** Patient row shown in treatment-history modal (language refresh). */
var _patientDetailsPatient = null;

function patTr(key) {
    return typeof t === 'function' ? t(key) : key;
}

function patTrRepl(key, pairs) {
    var s = patTr(key);
    if (!pairs) return s;
    for (var k in pairs) {
        if (Object.prototype.hasOwnProperty.call(pairs, k)) {
            s = s.split('{' + k + '}').join(String(pairs[k]));
        }
    }
    return s;
}

function readBananaIndexField(selectId) {
    var sel = g(selectId);
    if (!sel || !sel.value) return null;
    var n = parseInt(sel.value, 10);
    return (n >= 1 && n <= 10) ? n : null;
}

function readBananaNotesField(inputId) {
    var el = g(inputId);
    if (!el) return null;
    var txt = String(el.value || '').trim();
    return txt ? txt : null;
}

/** Patient id for quick banana edit from directory list. */
var patientDirBananaEditId = null;

function patientDirBananaIndexValue(p) {
    if (!p || p.banana_index == null || p.banana_index === '') return null;
    var n = parseInt(p.banana_index, 10);
    return (n >= 1 && n <= 10) ? n : null;
}

function patientDirBananaNotesText(p) {
    if (!p) return '';
    return String(p.banana_notes || '').trim();
}

function patientDirBananaCellHtml(p) {
    var idx = patientDirBananaIndexValue(p);
    if (idx == null) {
        return '<span class="patient-dir-banana-empty">-</span>';
    }
    if (patientDirBananaNotesText(p)) {
        return '<button type="button" class="patient-dir-banana-link" data-id="' +
            esc(p.id) + '" title="' + esc(patTr('patient.dirBanana.linkTitle')) + '">' +
            idx + '</button>';
    }
    return esc(String(idx));
}

function openPatientDirBananaPanel(patientId) {
    var p = (patientListCache || []).find(function(x) {
        return String(x.id) === String(patientId);
    });
    if (!p) return;
    patientDirBananaEditId = p.id;
    var idxVal = patientDirBananaIndexValue(p);
    sv('patientDir_banana_index', idxVal != null ? String(idxVal) : '');
    sv('patientDir_banana_notes', patientDirBananaNotesText(p));
    var meta = g('patientBananaMeta');
    if (meta) {
        var bits = [];
        if (p.patient_no) bits.push('# ' + p.patient_no);
        var nameLine = typeof patientDetailsNameLine === 'function'
            ? patientDetailsNameLine(p)
            : (String(p.full_name || '').trim() || '—');
        bits.push(nameLine);
        meta.textContent = bits.join(' · ');
    }
    openModal('patientBananaModal');
}

function savePatientDirBananaPanel() {
    if (!patientDirBananaEditId) return;
    var idx = readBananaIndexField('patientDir_banana_index');
    var notes = readBananaNotesField('patientDir_banana_notes');
    var payload = {
        banana_index: idx,
        banana_notes: idx != null ? notes : null
    };
    var savedId = patientDirBananaEditId;
    function doneSave() {
        closeModal('patientBananaModal');
        patientDirBananaEditId = null;
        (patientListCache || []).forEach(function(row) {
            if (String(row.id) === String(savedId)) {
                row.banana_index = payload.banana_index;
                row.banana_notes = payload.banana_notes;
            }
        });
        renderPatients(patientListCache);
        var savedP = (patientListCache || []).find(function (row) {
            return String(row.id) === String(savedId);
        });
        if (typeof patientViewOnActiveChange === 'function') patientViewOnActiveChange(savedP);
        alert(patTr('patient.dirBanana.saved'));
    }
    function doUpdate(pl, retried) {
        SB.from('patients').update(pl).eq('id', savedId)
        .then(function(r) {
            if (!r.error) { doneSave(); return; }
            var msg = String(r.error.message || '').toLowerCase();
            if (!retried && msg.indexOf('banana_notes') >= 0) {
                var pl2 = Object.assign({}, pl);
                delete pl2.banana_notes;
                doUpdate(pl2, true);
                return;
            }
            alert(trRepl('appt.msg.error', { MSG: r.error.message }));
        });
    }
    doUpdate(payload, false);
}

function toggleAddBananaInfoZone() {
    var chk = g('banana_info_enabled');
    var body = g('addBananaInfoBody');
    var idx = g('banana_index');
    var nts = g('banana_notes');
    var on = !!(chk && chk.checked);
    if (body) body.classList.toggle('is-disabled', !on);
    if (idx) idx.disabled = !on;
    if (nts) nts.disabled = !on;
    if (!on) {
        if (idx) idx.value = '';
        if (nts) nts.value = '';
    }
}

function toggleEditBananaInfoZone(forceDisabled) {
    var chk = g('edit_banana_info_enabled');
    var body = g('editAddBananaInfoBody');
    var idx = g('edit_banana_index');
    var nts = g('edit_banana_notes');
    var on = !!(chk && chk.checked);
    var disabled = !!forceDisabled || !on;
    if (body) body.classList.toggle('is-disabled', disabled);
    if (chk) chk.disabled = !!forceDisabled;
    if (idx) idx.disabled = disabled;
    if (nts) nts.disabled = disabled;
    if (!on) {
        if (idx) idx.value = '';
        if (nts) nts.value = '';
    }
}

function refreshPatientSexSelects() {
    ['sex', 'edit_sex'].forEach(function(id) {
        var sel = g(id);
        if (!sel || !sel.options.length) return;
        var cur = sel.value;
        if (sel.options[0]) sel.options[0].textContent = patTr('patient.form.select');
        var mOpt = sel.querySelector('option[value="M"]');
        var fOpt = sel.querySelector('option[value="F"]');
        if (mOpt) mOpt.textContent = patTr('patient.form.sexMale');
        if (fOpt) fOpt.textContent = patTr('patient.form.sexFemale');
        sel.value = cur;
    });
}

/** HK district codes for residential_district (labels reuse ai.district.* i18n). */
var PATIENT_RES_DISTRICT_CODES = [
    'central_western', 'wanchai', 'eastern', 'southern',
    'yautsimmong', 'shamshuipo', 'klncity', 'wongtaisin', 'kwuntong',
    'tuenmun', 'yuenlong', 'tsuenwan', 'kwaising', 'north', 'tupo',
    'shatin', 'saikung', 'islands'
];

var PATIENT_RES_DISTRICT_LABEL_KEYS = {
    central_western: 'ai.district.centralWestern',
    wanchai: 'ai.district.wanchai',
    eastern: 'ai.district.eastern',
    southern: 'ai.district.southern',
    yautsimmong: 'ai.district.yauTsimMong',
    shamshuipo: 'ai.district.shamShuiPo',
    klncity: 'ai.district.kowloonCity',
    wongtaisin: 'ai.district.wongTaiSin',
    kwuntong: 'ai.district.kwunTong',
    tuenmun: 'ai.district.tuenMun',
    yuenlong: 'ai.district.yuenLong',
    tsuenwan: 'ai.district.tsuenWan',
    kwaising: 'ai.district.kwaiTsing',
    north: 'ai.district.northNt',
    tupo: 'ai.district.taiPo',
    shatin: 'ai.district.shaTin',
    saikung: 'ai.district.saiKung',
    islands: 'ai.district.islands'
};

var _patientResDistrictInited = false;

function patientResDistrictLabel(code) {
    var key = PATIENT_RES_DISTRICT_LABEL_KEYS[code];
    return key ? patTr(key) : code;
}

function initPatientResidentialDistrictSelectsOnce() {
    if (_patientResDistrictInited) return;
    _patientResDistrictInited = true;
    refreshPatientResidentialDistrictSelects();
}

function refreshPatientResidentialDistrictSelects() {
    ['residentialDistrict', 'edit_residentialDistrict'].forEach(function(id) {
        var sel = g(id);
        if (!sel) return;
        var cur = sel.value;
        sel.innerHTML = '';
        var blank = document.createElement('option');
        blank.value = '';
        blank.textContent = patTr('patient.form.resDistrictSelect');
        sel.appendChild(blank);
        PATIENT_RES_DISTRICT_CODES.forEach(function(code) {
            var o = document.createElement('option');
            o.value = code;
            o.textContent = patientResDistrictLabel(code);
            sel.appendChild(o);
        });
        if (cur) {
            for (var i = 0; i < sel.options.length; i++) {
                if (sel.options[i].value === cur) {
                    sel.value = cur;
                    break;
                }
            }
        }
    });
}

function readPatientExtraFields(isEdit) {
    var mob = g(isEdit ? 'edit_mobilePhone' : 'mobilePhone');
    var dist = g(isEdit ? 'edit_residentialDistrict' : 'residentialDistrict');
    var fam = g(isEdit ? 'edit_familyHistory' : 'familyHistory');
    var ref = g(isEdit ? 'edit_referredBy' : 'referredBy');
    return {
        mobile_phone: mob ? String(mob.value || '').trim() || null : null,
        residential_district: dist ? String(dist.value || '').trim() || null : null,
        family_history: fam ? String(fam.value || '').trim() || null : null,
        referred_by: ref ? String(ref.value || '').trim() || null : null
    };
}

function refreshPatientDirI18n() {
    if (typeof refreshPatientSexSelects === 'function') refreshPatientSexSelects();
    if (typeof refreshPatientResidentialDistrictSelects === 'function') {
        refreshPatientResidentialDistrictSelects();
    }
    if (patientListCache.length && typeof renderPatients === 'function') {
        renderPatients(patientListCache);
    }
    if (typeof refreshPatientDirPaginationUI === 'function') {
        refreshPatientDirPaginationUI(false);
    }
    var sec = g('patientSection');
    if (sec && typeof applyI18nInRoot === 'function') {
        if (patientListCache.length || sec.style.display !== 'none') {
            applyI18nInRoot(sec);
        }
    }
    ['addPatientModal', 'editPatientModal', 'patientDetailsModal'].forEach(function(mid) {
        var mod = g(mid);
        if (!mod) return;
        if (mod.style.display === 'block' && typeof applyI18nInRoot === 'function') {
            applyI18nInRoot(mod);
        }
    });
    refreshPatientSexSelects();
    var addModal = g('addPatientModal');
    if (addModal && addModal.style.display === 'block') {
        if (typeof toggleAddBananaInfoZone === 'function') toggleAddBananaInfoZone();
        if (typeof updateAddPatientNoAvailabilityUI === 'function') {
            updateAddPatientNoAvailabilityUI();
        }
    }
    var editModal = g('editPatientModal');
    if (editModal && editModal.style.display === 'block') {
        fillEditPatientClinicSelect(editPatientLoadedClinicTag);
        if (typeof toggleEditBananaInfoZone === 'function') {
            toggleEditBananaInfoZone(currentRole === 'nurse');
        }
        setEditPatientModalForRole();
    }
    if (_patientDetailsPatient && selPatientId) {
        refreshPatientDetailsModalHeader(_patientDetailsPatient);
        refreshPatientDetailsBulkSection();
    }
    if (typeof refreshPatientViewsI18n === 'function') refreshPatientViewsI18n();
    var detModal = g('patientDetailsModal');
    if (detModal && detModal.style.display === 'block' && selPatientId) {
        if (typeof loadTreatments === 'function') loadTreatments(selPatientId);
    }
}

/** Sources where the user is already browsing the directory — do not overwrite search. */
var PATIENT_DIR_SEARCH_SKIP_SOURCES = {
    'patient-row': true,
    'patient-history': true,
    'patient-directory': true
};

function patientDirSearchTextFromPatient(p) {
    if (!p) return '';
    var no = String(p.patient_no || '').trim();
    if (no) return no;
    var cn = String(p.chinese_name || '').trim();
    if (cn) return cn;
    var en = String(p.full_name || '').trim();
    if (en) return en;
    var ph = String(p.phone_number || p.mobile_phone || '').trim();
    if (ph) return ph;
    return '';
}

var patientDirScrollActivePending = false;

function applyPatientDirSearchQuery(q, patientId) {
    var qEl = g('searchInput');
    if (!qEl || !q) return;
    var cur = String(qEl.value || '').trim();
    var inCache = patientId && (patientListCache || []).some(function (row) {
        return row && String(row.id) === String(patientId);
    });
    if (cur === q && inCache) {
        updatePatientDirActiveRowHighlight();
        scrollPatientDirActiveRowIntoView();
        return;
    }
    qEl.value = q;
    patientDirScrollActivePending = true;
    if (typeof schedulePatientDirSearch === 'function') {
        clearTimeout(patientDirSearchTimer);
        fetchPatients({ resetPage: true });
    } else if (typeof fetchPatients === 'function') {
        fetchPatients({ resetPage: true });
    }
}

function syncPatientDirSearchFromActivePatient(p, source) {
    if (!p || !p.id) return;
    if (source && PATIENT_DIR_SEARCH_SKIP_SOURCES[source]) return;
    var q = patientDirSearchTextFromPatient(p);
    if (q) {
        applyPatientDirSearchQuery(q, p.id);
        return;
    }
    if (typeof SB === 'undefined' || !SB.from) return;
    SB.from('patients')
        .select('id,patient_no,full_name,chinese_name,phone_number,mobile_phone')
        .eq('id', p.id)
        .limit(1)
        .then(function (r) {
            if (!r.data || !r.data[0]) return;
            if (selPatientId && String(selPatientId) !== String(p.id)) return;
            var row = r.data[0];
            var q2 = patientDirSearchTextFromPatient(row);
            if (q2) applyPatientDirSearchQuery(q2, row.id);
        });
}

function scrollPatientDirActiveRowIntoView() {
    if (!selPatientId) return;
    var tb = g('patientTableBody');
    if (!tb) return;
    var activeId = String(selPatientId);
    var row = null;
    tb.querySelectorAll('tr[data-patient-id]').forEach(function (tr) {
        if (String(tr.getAttribute('data-patient-id') || '') === activeId) row = tr;
    });
    if (row && row.scrollIntoView) {
        row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
}

function setDirectoryActivePatient(p, source) {
    if (!p || !p.id) return;
    selPatientId = p.id;
    _patientDetailsPatient = p;
    selPatientClinicTag = p[PATIENT_CLINIC_TAG_FIELD] ||
        (typeof currentClinicCodeForTagging === 'function'
            ? currentClinicCodeForTagging()
            : '');
    if (typeof conPatientId !== 'undefined') conPatientId = p.id;
    if (typeof conPatientData !== 'undefined') conPatientData = p;
    syncPatientDirSearchFromActivePatient(p, source);
    updatePatientDirActiveRowHighlight();
    try {
        document.dispatchEvent(new CustomEvent('app-active-patient-change', {
            detail: { patient: p, source: source || 'patient-directory' }
        }));
    } catch (_) {}
    if (typeof patientViewOnActiveChange === 'function') {
        patientViewOnActiveChange(p);
    }
}

function updatePatientDirActiveRowHighlight() {
    var tb = g('patientTableBody');
    if (!tb) return;
    var active = selPatientId ? String(selPatientId) : '';
    tb.querySelectorAll('tr[data-patient-id]').forEach(function(row) {
        var rid = String(row.getAttribute('data-patient-id') || '');
        row.classList.toggle('patient-dir-row-active', !!active && rid === active);
    });
}

// ════════════════════════════════════════════════════════════════
// PATIENT NUMBER — one shared sequence (010000+) for all clinics;
// clinic_tag is for search / identification only.
// ════════════════════════════════════════════════════════════════
var MIN_PATIENT_REG_NO       = 10000; // display 010000
var MAX_PATIENT_REG_NO       = 999999;
var addPatientNoCheckTimer = null;
var PATIENT_NO_PAGE_SIZE = 1000;

/**
 * Loads all patient_no values (paginated) to compute the next global registry number.
 * Supabase does not aggregate MAX in client; paging avoids silently using only the first chunk.
 */
function collectAllPatientNumbersThen(cb) {
    var acc = [];

    function page(from) {
        var to = from + PATIENT_NO_PAGE_SIZE - 1;
        SB.from('patients')
            .select('patient_no')
            .order('patient_no', { ascending: true })
            .range(from, to)
            .then(function(r) {
                if (r.error) {
                    if (typeof cb === 'function') cb(null, r.error);
                    return;
                }
                var rows = r.data || [];
                rows.forEach(function(row) {
                    if (row && row.patient_no != null) acc.push(row.patient_no);
                });
                if (rows.length < PATIENT_NO_PAGE_SIZE) {
                    if (typeof cb === 'function') cb(acc, null);
                    return;
                }
                page(to + 1);
            })
            .catch(function(e) {
                if (typeof cb === 'function') cb(null, e || new Error('patient_no fetch failed'));
            });
    }

    page(0);
}

/** Returns normalized numeric core or null if invalid/out of range. */
function normalizePatientNoInput(raw) {
    var digits = (typeof patientNoDigitWidth === 'function') ? patientNoDigitWidth() : 6;
    var minReg = (typeof patientNoMinReg === 'function') ? patientNoMinReg() : MIN_PATIENT_REG_NO;
    var maxReg = (typeof patientNoMaxReg === 'function') ? patientNoMaxReg() : MAX_PATIENT_REG_NO;
    var core = (typeof stripPatientNoPrefix === 'function')
        ? stripPatientNoPrefix(raw)
        : String(raw || '').trim();
    var s = String(core || '').trim().replace(/\D/g, '');
    if (!s.length) return null;
    if (s.length > digits) return null;
    var n = parseInt(s, 10);
    if (isNaN(n) || n < minReg || n > maxReg) return null;
    return (typeof formatPatientNoFromNumber === 'function')
        ? formatPatientNoFromNumber(n)
        : String(n).padStart(digits, '0');
}

/** True if any patient row already uses this patient_no (all clinics). */
function patientNoDupQuery(normalizedSix) {
    return SB.from('patients')
        .select('id')
        .eq('patient_no', normalizedSix)
        .limit(1);
}

/** Selected clinic row id in the add-patient modal (defaults to login clinic when filled). */
function addPatientSelectedClinicId() {
    var sel = g('addPatientClinicSelect');
    if (!sel) return '';
    return String(sel.value || '').trim();
}

/** Tag stored on patients row for the modal’s clinic pick (matches login tagging rules). */
function addPatientClinicTagFromSelect() {
    var id = addPatientSelectedClinicId();
    if (!id) return '';
    var rec =
        typeof clinicRecordFromId === 'function'
            ? clinicRecordFromId(id)
            : null;
    if (rec) {
        var code = String(rec.clinic_code || '').trim();
        if (code) return code;
    }
    return String(id);
}

/** Populate clinic list; defaults selection to global login clinic (`currentClinicId`). */
function fillAddPatientClinicSelect() {
    var sel = g('addPatientClinicSelect');
    if (!sel) return;

    var defaultId =
        typeof currentClinicId !== 'undefined' && currentClinicId
            ? String(currentClinicId)
            : '';

    sel.innerHTML = '';

    if (typeof APP_CLINICS === 'undefined' || !APP_CLINICS.length) {
        sel.innerHTML = '<option value="">' + esc(patTr('patient.select.noClinics')) + '</option>';
        return;
    }

    var clinicOpts = (typeof clinicsForWorkingSession === 'function')
        ? clinicsForWorkingSession()
        : APP_CLINICS;
    clinicOpts.forEach(function(c) {
        var label = (typeof clinicDisplayName === 'function')
            ? clinicDisplayName(c)
            : (c.english_name || c.chinese_name || (typeof clinicDisplayFallback === 'function'
                ? clinicDisplayFallback()
                : patTr('common.clinic')));
        var o = document.createElement('option');
        o.value = String(c.id);
        o.textContent = label;
        sel.appendChild(o);
    });

    var match =
        defaultId &&
        Array.from(sel.options).some(function(opt) {
            return opt.value === defaultId;
        });
    sel.value = match ? defaultId : String((clinicOpts[0] && clinicOpts[0].id) || '');
}

function editPatientSelectedClinicId() {
    var sel = g('editPatientClinicSelect');
    if (!sel) return '';
    return String(sel.value || '').trim();
}

function editPatientClinicTagFromSelect() {
    var id = editPatientSelectedClinicId();
    if (!id) return '';
    var rec =
        typeof clinicRecordFromId === 'function'
            ? clinicRecordFromId(id)
            : null;
    if (rec) {
        var code = String(rec.clinic_code || '').trim();
        if (code) return code;
    }
    return String(id);
}

/** Populate edit modal clinic list; pre-select from existing patients.clinic_tag. */
function fillEditPatientClinicSelect(storedClinicTag) {
    var sel = g('editPatientClinicSelect');
    if (!sel) return;

    sel.innerHTML = '';

    if (typeof APP_CLINICS === 'undefined' || !APP_CLINICS.length) {
        sel.innerHTML = '<option value="">' + esc(patTr('patient.select.noClinics')) + '</option>';
        return;
    }

    APP_CLINICS.forEach(function(c) {
        var label = (typeof clinicDisplayName === 'function')
            ? clinicDisplayName(c)
            : (c.english_name || c.chinese_name || (typeof clinicDisplayFallback === 'function'
                ? clinicDisplayFallback()
                : patTr('common.clinic')));
        var o = document.createElement('option');
        o.value = String(c.id);
        o.textContent = label;
        sel.appendChild(o);
    });

    var preferred =
        typeof clinicIdFromStoredPatientTag === 'function'
            ? clinicIdFromStoredPatientTag(storedClinicTag)
            : '';
    var matchPreferred =
        preferred &&
        Array.from(sel.options).some(function(opt) {
            return opt.value === preferred;
        });
    var defaultId =
        typeof currentClinicId !== 'undefined' && currentClinicId
            ? String(currentClinicId)
            : '';
    var matchLogin =
        defaultId &&
        Array.from(sel.options).some(function(opt) {
            return opt.value === defaultId;
        });

    if (matchPreferred) sel.value = preferred;
    else if (matchLogin) sel.value = defaultId;
    else sel.value = String(APP_CLINICS[0].id || '');
}

/** If clinics arrive after the edit modal opened, repopulate options without losing context. */
function refreshEditPatientClinicIfModalOpen() {
    if (!editPatientId) return;
    var m = g('editPatientModal');
    if (!m || m.style.display !== 'block') return;
    fillEditPatientClinicSelect(editPatientLoadedClinicTag);
}

function scheduleAddPatientNoAvailabilityCheck() {
    clearTimeout(addPatientNoCheckTimer);
    addPatientNoCheckTimer = setTimeout(updateAddPatientNoAvailabilityUI, 320);
}

function updateAddPatientNoAvailabilityUI() {
    var inp  = g('preview_patientNo');
    var stat = g('addPatientNoStatus');
    if (!inp || !stat) return;

    var norm = normalizePatientNoInput(inp.value);
    if (!norm) {
        stat.textContent =
            inp.value.trim() ? patTr('patient.noStatusRange') : '';
        stat.style.color = '#64748b';
        return;
    }

    patientNoDupQuery(norm).then(function(r) {
        if (!stat) return;
        var taken = !r.error && r.data && r.data.length > 0;
        stat.textContent = taken
            ? patTr('patient.noStatusTaken')
            : patTr('patient.noStatusAvailable');
        stat.style.color = taken ? 'var(--danger)' : '#15803d';
    });
}

function genPatientNo(cb) {
    collectAllPatientNumbersThen(function(list, err) {
        if (err) {
            if (typeof cb === 'function') cb(null, err);
            return;
        }
        var minReg = (typeof patientNoMinReg === 'function') ? patientNoMinReg() : MIN_PATIENT_REG_NO;
        var maxReg = (typeof patientNoMaxReg === 'function') ? patientNoMaxReg() : MAX_PATIENT_REG_NO;
        var digits = (typeof patientNoDigitWidth === 'function') ? patientNoDigitWidth() : 6;
        var used = {};
        (list || []).forEach(function(no) {
            var n = (typeof parsePatientNoCore === 'function')
                ? parsePatientNoCore(no)
                : null;
            if (n != null) used[n] = true;
        });

        var nextNum = null;
        var usedNums = Object.keys(used).map(function(k) { return parseInt(k, 10); });
        if (usedNums.length) {
            var candidate = Math.max.apply(null, usedNums) + 1;
            if (candidate <= maxReg && !used[candidate]) nextNum = candidate;
        } else {
            nextNum = minReg;
        }

        if (nextNum == null) {
            for (var n = minReg; n <= maxReg; n++) {
                if (!used[n]) {
                    nextNum = n;
                    break;
                }
            }
        }

        if (nextNum == null) {
            if (typeof cb === 'function') cb(null);
            return;
        }

        var out = (typeof formatPatientNoFromNumber === 'function')
            ? formatPatientNoFromNumber(nextNum)
            : String(nextNum).padStart(digits, '0');
        if (typeof cb === 'function') cb(out);
    });
}

function openAddPatient() {
    g('patientForm').reset();
    sv('preview_patientNo','');
    if (g('banana_info_enabled')) {
        g('banana_info_enabled').checked = false;
        g('banana_info_enabled').onchange = toggleAddBananaInfoZone;
    }
    toggleAddBananaInfoZone();
    var st = g('addPatientNoStatus');
    if (st) { st.textContent = ''; st.style.color = '#64748b'; }
    fillAddPatientClinicSelect();
    ensureModalNoBackdropClose('addPatientModal');
    openModal('addPatientModal');
    var am = g('addPatientModal');
    if (am && typeof applyI18nInRoot === 'function') applyI18nInRoot(am);
    initPatientResidentialDistrictSelectsOnce();
    refreshPatientSexSelects();
    refreshPatientResidentialDistrictSelects();
    if (typeof programSettingBool === 'function' && programSettingBool('default_patient_female', false)) {
        sv('sex', 'F');
    }
    var autoGen = (typeof programSettingBool !== 'function') || programSettingBool('auto_generate_patient_code', true);
    if (!autoGen) return;
    genPatientNo(function(no, err) {
        if (no) {
            sv('preview_patientNo', no);
            updateAddPatientNoAvailabilityUI();
            return;
        }
        sv('preview_patientNo', '');
        if (!st) return;
        if (err) {
            st.textContent = patTrRepl('patient.alertVerifyNoFail', {
                MSG: (err && err.message) ? err.message : String(err)
            });
        } else {
            st.textContent = patTr('patient.noStatusExhausted');
        }
        st.style.color = 'var(--danger)';
    });
}

// ════════════════════════════════════════════════════════════════
// PATIENT — ADD
// ════════════════════════════════════════════════════════════════
function submitAddPatient(e) {
    e.preventDefault();

    var no = normalizePatientNoInput(g('preview_patientNo').value);
    if (!no) {
        alert(patTr('patient.alertInvalidNo'));
        return;
    }

    if (!addPatientSelectedClinicId()) {
        alert(patTr('patient.alertSelectClinic'));
        return;
    }

    var ctAdd = addPatientClinicTagFromSelect();
    if (!ctAdd) {
        alert(patTr('patient.alertSelectClinic'));
        return;
    }

    patientNoDupQuery(no).then(function(dupr) {
        if (dupr.error) {
            alert(patTrRepl('patient.alertVerifyNoFail', { MSG: dupr.error.message }));
            return;
        }
        if (dupr.data && dupr.data.length) {
            alert(patTr('patient.alertNoInUse'));
            updateAddPatientNoAvailabilityUI();
            return;
        }

        var payload = {
            patient_no:     no,
            full_name:      (g('fullName').value     ||'').trim(),
            chinese_name:   (g('chineseName').value  ||'').trim()||null,
            phone_number:   (g('phone').value        ||'').trim()||null,
            email:          (g('email').value        ||'').trim()||null,
            sex:             g('sex').value           ||null,
            dob:             g('dob').value           ||null,
            hkid:           (g('hkid').value         ||'').trim()||null,
            insurance_no:   (g('insuranceNo').value  ||'').trim()||null,
            occupation:     (g('occupation').value   ||'').trim()||null,
            address:        (g('address').value      ||'').trim()||null,
            medical_alerts: (g('alerts').value       ||'').trim()||null,
            remarks:        (g('remarks').value      ||'').trim()||null,
            banana_index:   (g('banana_info_enabled') && g('banana_info_enabled').checked)
                ? readBananaIndexField('banana_index')
                : null,
            banana_notes:   (g('banana_info_enabled') && g('banana_info_enabled').checked)
                ? readBananaNotesField('banana_notes')
                : null
        };
        var extra = readPatientExtraFields(false);
        payload.mobile_phone = extra.mobile_phone;
        payload.residential_district = extra.residential_district;
        payload.family_history = extra.family_history;
        payload.referred_by = extra.referred_by;
        payload[PATIENT_CLINIC_TAG_FIELD] = ctAdd;
        function finishInsert(r) {
            var row = r.data && r.data[0] ? r.data[0] : null;

            function afterSaveUi() {
                closeModal('addPatientModal');
                g('patientForm').reset();
                fetchPatients();
                if (row && row.id && typeof setDirectoryActivePatient === 'function') {
                    setDirectoryActivePatient(row, 'new-patient');
                }
            }

            var linkedToday = row &&
                typeof linkTodayApptAfterPatientRegistration === 'function' &&
                linkTodayApptAfterPatientRegistration(row);
            afterSaveUi();
            if (!linkedToday) {
                alert(patTrRepl('patient.alertRegistered', { NO: no }));
            }
        }
        function doInsert(pl, retried) {
            SB.from('patients').insert([pl]).select('id,patient_no,full_name,chinese_name')
            .then(function(r) {
                if (!r.error) { finishInsert(r); return; }
                var msg = String(r.error.message || '').toLowerCase();
                if (!retried && msg.indexOf('banana_notes') >= 0) {
                    var pl2 = Object.assign({}, pl);
                    delete pl2.banana_notes;
                    doInsert(pl2, true);
                    return;
                }
                alert(trRepl('appt.msg.error', { MSG: r.error.message }));
            });
        }
        doInsert(payload, false);
    });
}

// ════════════════════════════════════════════════════════════════
// PATIENT — FETCH + RENDER
// ════════════════════════════════════════════════════════════════
function fetchPatients() {
    var opts = arguments[0] || {};
    if (opts.resetPage) patientDirPageIndex = 0;
    if (patientDirPageIndex < 0) patientDirPageIndex = 0;

    var qText = '';
    var qEl = g('searchInput');
    if (qEl) qText = String(qEl.value || '').trim();

    var from = patientDirPageIndex * PATIENT_DIR_PAGE_SIZE;
    var to = from + PATIENT_DIR_PAGE_SIZE - 1;
    var token = ++patientDirFetchToken;
    refreshPatientDirPaginationUI(true);

    function applyDirSearchFilter(builder, q, fallbackCore) {
        var filter = '';
        if (fallbackCore && typeof patientSearchOrFilterCore === 'function') {
            filter = patientSearchOrFilterCore(q);
        } else if (typeof patientSearchOrFilter === 'function') {
            filter = patientSearchOrFilter(q);
        }
        if (!filter) return builder;
        return builder.or(filter);
    }

    function runQuery(useCoreFilterFallback) {
        var q = SB.from('patients')
            .select('*', { count: 'exact' })
            .order('patient_no', { ascending: true });
        q = typeof applyPatientQueryClinicTag === 'function'
            ? applyPatientQueryClinicTag(q, 'patientDirClinicFilter')
            : q;
        if (qText) q = applyDirSearchFilter(q, qText, useCoreFilterFallback);
        return q.range(from, to);
    }

    function onDone(r) {
        if (token !== patientDirFetchToken) return;
        if (r.error) {
            console.error(r.error);
            patientListCache = [];
            patientDirTotalCount = 0;
            renderPatients([]);
            refreshPatientDirPaginationUI(false);
            return;
        }
        patientListCache = r.data || [];
        patientDirTotalCount = typeof r.count === 'number'
            ? r.count
            : ((patientDirPageIndex * PATIENT_DIR_PAGE_SIZE) + patientListCache.length);
        if (patientDirPageIndex > 0 && !patientListCache.length && patientDirTotalCount > 0) {
            patientDirPageIndex = Math.max(0, Math.ceil(patientDirTotalCount / PATIENT_DIR_PAGE_SIZE) - 1);
            fetchPatients();
            return;
        }
        renderPatients(patientListCache);
        refreshPatientDirPaginationUI(false);
        if (patientDirScrollActivePending) {
            patientDirScrollActivePending = false;
            updatePatientDirActiveRowHighlight();
            scrollPatientDirActiveRowIntoView();
        }
    }

    runQuery(false).then(function(r) {
        if (
            r.error &&
            qText &&
            typeof patientSearchOrFilterCore === 'function' &&
            String(r.error.message || '').toLowerCase().indexOf('column') >= 0
        ) {
            runQuery(true).then(onDone);
            return;
        }
        onDone(r);
    });
}

function renderPatients(list) {
    patientListCache = list || [];
    var tb = g('patientTableBody');
    if (!list.length) {
        tb.innerHTML =
            '<tr><td colspan="9" style="text-align:center;' +
            'padding:30px;color:#999;">' + esc(patTr('patient.empty')) + '</td></tr>';
        return;
    }
    tb.innerHTML = '';
    list.forEach(function(p) {
        var dob = '--';
        if (p.dob) {
            dob = typeof formatDobAge === 'function'
                ? formatDobAge(p.dob)
                : p.dob;
        }
        var cn = String(p.chinese_name || '').trim();
        var en = String(p.full_name || '').trim();
        var nameHtml = '';
        var sexIcon = typeof patientSexSymbolHtml === 'function'
            ? patientSexSymbolHtml(p.sex, { hideUnknown: true })
            : '';
        if (p.patient_no || sexIcon) {
            nameHtml += '<div class="patient-dir-name-meta">';
            if (p.patient_no) {
                nameHtml += '<span class="pno-badge"># ' + esc(p.patient_no) + '</span>';
            }
            if (sexIcon) nameHtml += sexIcon;
            nameHtml += '</div>';
        }
        if (cn) {
            nameHtml += '<span class="patient-dir-name-cn">' + esc(cn) + '</span>';
        }
        if (en) {
            nameHtml += (cn ? '<br>' : '') +
                '<span class="patient-dir-name-en">' + esc(en) + '</span>';
        }
        if (!cn && !en) {
            nameHtml += '<span class="patient-dir-name-en">—</span>';
        }

        var alertTxt = typeof buildPatientAlertDisplayText === 'function'
            ? buildPatientAlertDisplayText(p)
            : String(p.medical_alerts || '').trim();

        var tr = document.createElement('tr');
        tr.setAttribute('data-patient-id', p.id);
        tr.style.cursor = 'pointer';
        tr.setAttribute('draggable', 'true');
        tr.innerHTML =
            '<td class="patient-dir-name-cell">' + nameHtml + '</td>' +
            '<td>'+esc(p.phone_number||'--')+'</td>' +
            '<td style="font-size:12px;color:#64748b;">' +
                esc(p[PATIENT_CLINIC_TAG_FIELD]||'—') +
            '</td>' +
            '<td style="white-space:nowrap;">'+dob+'</td>' +
            '<td>'+esc(p.hkid||'--')+'</td>' +
            '<td>'+esc(p.insurance_no||'--')+'</td>' +
            '<td><small style="color:' + (alertTxt ? 'var(--danger)' : '#bbb') + ';">' +
                esc(alertTxt || patTr('patient.alertsNone')) +
            '</small></td>' +
            '<td class="patient-dir-banana-cell">' +
                (typeof patientDirBananaCellHtml === 'function' ? patientDirBananaCellHtml(p) : '-') +
            '</td>' +
            '<td>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                    '<button class="btn-notes" ' +
                    'style="background:#f0f0f0;border:1px solid #ccc;' +
                    'padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;" ' +
                    'data-id="'+p.id+'">' + esc(patTr('patient.btnNotes')) + '</button>' +
                    '<button class="btn-checkin-p" ' +
                    'style="background:var(--success);color:white;border:none;' +
                    'padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;" ' +
                    'data-id="'+p.id+'">' + esc(patTr('patient.btnCheckIn')) + '</button>' +
                    '<button class="btn-editp" ' +
                    'style="background:var(--primary);color:white;border:none;' +
                    'padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;" ' +
                    'data-id="'+p.id+'">' +
                    esc(currentRole === 'nurse' ? patTr('patient.btnClinicTag') : patTr('patient.btnEdit')) +
                    '</button>' +
                '</div>' +
            '</td>';
        tr.addEventListener('click', function(e) {
            var tgt = e.target;
            if (tgt && tgt.closest &&
                (tgt.closest('button') || tgt.closest('.patient-dir-banana-link'))) return;
            setDirectoryActivePatient(p, 'patient-row');
        });
        tr.addEventListener('dragstart', function(e) {
            var payload = typeof serializePatientDragPayload === 'function'
                ? serializePatientDragPayload(p)
                : '';
            if (!payload) return;
            if (typeof setPatientDragPayloadSession === 'function') {
                setPatientDragPayloadSession(p);
            }
            e.dataTransfer.effectAllowed = 'copyMove';
            e.dataTransfer.setData('application/x-joyful-patient', payload);
            e.dataTransfer.setData('text/plain', payload);
        });
        tr.addEventListener('dragend', function() {
            if (typeof clearPatientDragPayloadSession === 'function') {
                clearPatientDragPayloadSession();
            }
        });
        tb.appendChild(tr);
    });
    updatePatientDirActiveRowHighlight();
    tb.querySelectorAll('.btn-notes').forEach(function(b) {
        b.addEventListener('click', function(e){
            e.stopPropagation();
            var pid = b.dataset.id;
            if (typeof openConForPatient === 'function') {
                openConForPatient(pid);
            } else {
                viewHistory(pid);
            }
        });
    });
    tb.querySelectorAll('.btn-checkin-p').forEach(function (b) {
        b.addEventListener('click', function (e) {
            e.stopPropagation();
            var pid = b.dataset.id;
            var row = (patientListCache || []).find(function (x) {
                return x && String(x.id) === String(pid);
            });
            if (row && typeof checkInPatientFromRecord === 'function') {
                checkInPatientFromRecord(row);
            }
        });
    });
    tb.querySelectorAll('.btn-editp').forEach(function(b) {
        b.addEventListener('click', function(e){
            e.stopPropagation();
            openEditPatient(b.dataset.id);
        });
    });
    tb.querySelectorAll('.patient-dir-banana-link').forEach(function(b) {
        b.addEventListener('click', function(e) {
            e.stopPropagation();
            if (typeof openPatientDirBananaPanel === 'function') {
                openPatientDirBananaPanel(b.dataset.id);
            }
        });
    });
}

function filterTable() {
    schedulePatientDirSearch();
}

function refreshPatientDirPaginationUI(isLoading) {
    var info = g('patientDirPagerInfo');
    var prev = g('patientDirPrevBtn');
    var next = g('patientDirNextBtn');
    var lbl = g('patientDirPageLabel');
    var pageSizeSel = g('patientDirPageSize');
    var jumpInp = g('patientDirJumpPageInput');
    if (!info || !prev || !next || !lbl) return;

    var total = patientDirTotalCount || 0;
    var pageCount = Math.max(1, Math.ceil(total / PATIENT_DIR_PAGE_SIZE));
    var curPage = pageCount ? Math.min(patientDirPageIndex + 1, pageCount) : 1;
    var from = total ? (patientDirPageIndex * PATIENT_DIR_PAGE_SIZE + 1) : 0;
    var to = total ? (patientDirPageIndex * PATIENT_DIR_PAGE_SIZE + patientListCache.length) : 0;

    if (isLoading) {
        info.textContent = patTr('patient.page.loading');
    } else if (!total) {
        info.textContent = patTr('patient.page.empty');
    } else {
        info.textContent = patTrRepl('patient.page.summary', {
            FROM: from,
            TO: to,
            TOTAL: total
        });
    }

    lbl.textContent = patTrRepl('patient.page.counter', { PAGE: curPage, PAGES: pageCount });
    prev.disabled = !!isLoading || patientDirPageIndex <= 0 || !total;
    next.disabled = !!isLoading || (patientDirPageIndex + 1) >= pageCount || !total;
    if (pageSizeSel) pageSizeSel.value = String(PATIENT_DIR_PAGE_SIZE);
    if (jumpInp) {
        jumpInp.max = String(pageCount || 1);
        jumpInp.placeholder = String(curPage);
    }
}

function setPatientDirJumpHint(msg) {
    var el = g('patientDirJumpHint');
    if (!el) return;
    el.textContent = msg ? String(msg) : '';
}

function schedulePatientDirSearch() {
    clearTimeout(patientDirSearchTimer);
    patientDirSearchTimer = setTimeout(function() {
        fetchPatients({ resetPage: true });
    }, 220);
}

function patientDirChangePage(delta) {
    var step = parseInt(delta, 10) || 0;
    if (!step) return;
    var target = patientDirPageIndex + step;
    if (target < 0) target = 0;
    var max = Math.max(0, Math.ceil((patientDirTotalCount || 0) / PATIENT_DIR_PAGE_SIZE) - 1);
    if (target > max) target = max;
    if (target === patientDirPageIndex) return;
    patientDirPageIndex = target;
    fetchPatients();
}

function patientDirApplyPageSize() {
    var sel = g('patientDirPageSize');
    if (!sel) return;
    var n = parseInt(sel.value, 10);
    if (PATIENT_DIR_PAGE_SIZE_OPTIONS.indexOf(n) < 0) {
        sel.value = String(PATIENT_DIR_PAGE_SIZE);
        return;
    }
    if (n === PATIENT_DIR_PAGE_SIZE) return;
    PATIENT_DIR_PAGE_SIZE = n;
    patientDirPageIndex = 0;
    setPatientDirJumpHint('');
    fetchPatients();
}

function patientDirJumpToPage(rawValue) {
    var jumpInp = g('patientDirJumpPageInput');
    var maxPage = Math.max(1, Math.ceil((patientDirTotalCount || 0) / PATIENT_DIR_PAGE_SIZE));
    var raw = String(rawValue || '').trim();
    if (!raw) {
        setPatientDirJumpHint(patTr('patient.page.jumpNeedNumber'));
        return;
    }
    var n = parseInt(raw, 10);
    if (isNaN(n)) {
        setPatientDirJumpHint(patTr('patient.page.jumpNeedNumber'));
        return;
    }
    if (n < 1 || n > maxPage) {
        setPatientDirJumpHint(patTrRepl('patient.page.jumpRange', { MAX: maxPage }));
        return;
    }
    var target = n - 1;
    setPatientDirJumpHint('');
    if (target === patientDirPageIndex) return;
    patientDirPageIndex = target;
    if (jumpInp) jumpInp.value = '';
    fetchPatients();
}

function onPatientDirClinicFilterChange() {
    fetchPatients({ resetPage: true });
}

// ════════════════════════════════════════════════════════════════
// PATIENT — EDIT
// ════════════════════════════════════════════════════════════════
function setEditPatientModalForRole() {
    var nurse = currentRole === 'nurse';
    var title = g('editPatientModalTitle');
    var hint = g('editPatientNurseHint');
    var saveBtn = g('editPatientSaveBtn');
    var delBtn = g('edit_deleteBtn');
    var form = g('editPatientForm');

    if (title) title.textContent = nurse ? patTr('patient.nurseEditTitle') : patTr('patient.editTitle');
    if (hint) hint.style.display = nurse ? 'block' : 'none';
    if (saveBtn) saveBtn.textContent = nurse ? patTr('patient.nurseSaveBtn') : patTr('patient.editSaveBtn');
    if (delBtn) delBtn.style.display = nurse ? 'none' : '';

    if (form) form.noValidate = nurse;

    [
        'edit_fullName',
        'edit_chineseName',
        'edit_phone',
        'edit_mobilePhone',
        'edit_email',
        'edit_dob',
        'edit_hkid',
        'edit_insuranceNo',
        'edit_occupation',
        'edit_address',
        'edit_referredBy'
    ].forEach(function(fid) {
        var el = g(fid);
        if (el) el.readOnly = nurse;
    });
    var sex = g('edit_sex');
    if (sex) sex.disabled = nurse;
    var resDist = g('edit_residentialDistrict');
    if (resDist) resDist.disabled = nurse;
    ['edit_alerts', 'edit_remarks', 'edit_banana_notes', 'edit_familyHistory'].forEach(function(fid) {
        var el = g(fid);
        if (el) el.readOnly = nurse;
    });
    if (typeof toggleEditBananaInfoZone === 'function') {
        toggleEditBananaInfoZone(nurse);
    }

    var clin = g('editPatientClinicSelect');
    if (clin) {
        clin.removeAttribute('disabled');
    }
}

function openEditPatient(id) {
    editPatientId = id;
    SB.from('patients').select('*').eq('id',id).single()
    .then(function(r) {
        if (r.error||!r.data) { alert(patTr('patient.alertCouldNotLoad')); return; }
        var p = r.data;
        sv('edit_patientNo',   p.patient_no    ||'');
        sv('edit_fullName',    p.full_name      ||'');
        sv('edit_chineseName', p.chinese_name   ||'');
        sv('edit_phone',       p.phone_number   ||'');
        sv('edit_mobilePhone', p.mobile_phone   ||'');
        sv('edit_email',       p.email          ||'');
        sv('edit_sex',         p.sex            ||'');
        sv('edit_dob',         p.dob            ||'');
        sv('edit_hkid',        p.hkid           ||'');
        sv('edit_insuranceNo', p.insurance_no   ||'');
        sv('edit_occupation',  p.occupation     ||'');
        sv('edit_address',     p.address        ||'');
        initPatientResidentialDistrictSelectsOnce();
        var resSel = g('edit_residentialDistrict');
        if (resSel) resSel.value = p.residential_district || '';
        sv('edit_familyHistory', p.family_history || '');
        sv('edit_referredBy',    p.referred_by    || '');
        sv('edit_alerts',      p.medical_alerts ||'');
        sv('edit_remarks',     p.remarks        ||'');
        sv('edit_banana_index', p.banana_index != null ? String(p.banana_index) : '');
        sv('edit_banana_notes', p.banana_notes || '');
        var hasBanana = readBananaIndexField('edit_banana_index') != null ||
            !!readBananaNotesField('edit_banana_notes');
        if (g('edit_banana_info_enabled')) {
            g('edit_banana_info_enabled').checked = hasBanana;
            g('edit_banana_info_enabled').onchange = function() {
                toggleEditBananaInfoZone(currentRole === 'nurse');
            };
        }
        toggleEditBananaInfoZone(currentRole === 'nurse');
        editPatientLoadedClinicTag = p[PATIENT_CLINIC_TAG_FIELD] || '';
        fillEditPatientClinicSelect(editPatientLoadedClinicTag);
        setEditPatientModalForRole();
        ensureModalNoBackdropClose('editPatientModal');
        openModal('editPatientModal');
        var em = g('editPatientModal');
        if (em && typeof applyI18nInRoot === 'function') applyI18nInRoot(em);
        refreshPatientSexSelects();
        refreshPatientResidentialDistrictSelects();
        if (resSel && p.residential_district) resSel.value = p.residential_district;
    });
}

function submitEditPatient(e) {
    e.preventDefault();
    if (!editPatientId) return;
    if (!editPatientSelectedClinicId()) {
        alert(patTr('patient.alertSelectClinic'));
        return;
    }
    var ctEdit = editPatientClinicTagFromSelect();
    if (!ctEdit) {
        alert(patTr('patient.alertSelectClinic'));
        return;
    }
    var nurse = currentRole === 'nurse';
    var payload = nurse
        ? (function() {
              var o = {};
              o[PATIENT_CLINIC_TAG_FIELD] = ctEdit;
              return o;
          })()
        : {
              full_name:      (g('edit_fullName').value    ||'').trim(),
              chinese_name:   (g('edit_chineseName').value ||'').trim()||null,
              phone_number:   (g('edit_phone').value       ||'').trim()||null,
              email:          (g('edit_email').value       ||'').trim()||null,
              sex:             g('edit_sex').value          ||null,
              dob:             g('edit_dob').value          ||null,
              hkid:           (g('edit_hkid').value        ||'').trim()||null,
              insurance_no:   (g('edit_insuranceNo').value ||'').trim()||null,
              occupation:     (g('edit_occupation').value  ||'').trim()||null,
              address:        (g('edit_address').value     ||'').trim()||null,
              medical_alerts: (g('edit_alerts').value      ||'').trim()||null,
              remarks:        (g('edit_remarks').value     ||'').trim()||null,
              banana_index:   (g('edit_banana_info_enabled') && g('edit_banana_info_enabled').checked)
                  ? readBananaIndexField('edit_banana_index')
                  : null,
              banana_notes:   (g('edit_banana_info_enabled') && g('edit_banana_info_enabled').checked)
                  ? readBananaNotesField('edit_banana_notes')
                  : null
          };
    if (!nurse) {
        var extraEdit = readPatientExtraFields(true);
        payload.mobile_phone = extraEdit.mobile_phone;
        payload.residential_district = extraEdit.residential_district;
        payload.family_history = extraEdit.family_history;
        payload.referred_by = extraEdit.referred_by;
    }
    if (!nurse) payload[PATIENT_CLINIC_TAG_FIELD] = ctEdit;
    function doneUpdate(savedPatient) {
        var savedId = (savedPatient && savedPatient.id) || editPatientId;
        closeModal('editPatientModal');
        fetchPatients();
        if (typeof refreshApptListsAfterPatientEdit === 'function') {
            refreshApptListsAfterPatientEdit(savedPatient || Object.assign({ id: savedId }, payload, {
                patient_no: (g('edit_patientNo') && g('edit_patientNo').value) || ''
            }));
        }
        if (savedPatient && typeof activePatientSlots !== 'undefined' &&
            typeof activePatientNormalize === 'function') {
            for (var si = 0; si < activePatientSlots.length; si++) {
                if (activePatientSlots[si] && String(activePatientSlots[si].id) === String(savedPatient.id)) {
                    activePatientSlots[si] = activePatientNormalize(savedPatient);
                }
            }
            if (typeof renderActivePatientDock === 'function') renderActivePatientDock();
        }
        if (typeof patientViewOnActiveChange === 'function') {
            patientViewOnActiveChange(savedPatient);
        }
        alert(nurse ? patTr('patient.alertClinicTagSaved') : patTr('patient.alertUpdated'));
    }
    function doUpdate(pl, retried) {
        SB.from('patients').update(pl).eq('id',editPatientId)
        .then(function(r) {
            if (!r.error) {
                SB.from('patients').select('*').eq('id', editPatientId).single()
                .then(function(sr) {
                    doneUpdate(sr && !sr.error ? sr.data : null);
                })
                .catch(function() {
                    doneUpdate(null);
                });
                return;
            }
            var msg = String(r.error.message || '').toLowerCase();
            if (!retried && msg.indexOf('banana_notes') >= 0) {
                var pl2 = Object.assign({}, pl);
                delete pl2.banana_notes;
                doUpdate(pl2, true);
                return;
            }
            alert(trRepl('appt.msg.error', { MSG: r.error.message }));
        });
    }
    doUpdate(payload, false);
}

function deletePatient() {
    if (currentRole==='nurse') { alert(patTr('patient.alertPermissionDenied')); return; }
    if (!editPatientId) return;
    var name = g('edit_fullName').value  || patTr('patient.thisPatient');
    var no   = g('edit_patientNo').value || '';
    if (!confirm(patTrRepl('patient.confirmDelete', { NO: no, NAME: name }))) return;
    SB.from('treatments').delete().eq('patient_id',editPatientId)
    .then(function() {
        return SB.from('patients').delete().eq('id',editPatientId);
    })
    .then(function(r) {
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
        closeModal('editPatientModal');
        fetchPatients();
        alert(patTr('patient.alertDeleted'));
    });
}

// ════════════════════════════════════════════════════════════════
// TREATMENT HISTORY
// ════════════════════════════════════════════════════════════════
function patientDetailsNameLine(p) {
    if (!p) return '—';
    var en = String(p.full_name || '').trim();
    var cn = String(p.chinese_name || '').trim();
    if (en && cn) return en + '  ' + cn;
    return en || cn || '—';
}

function refreshPatientDetailsModalHeader(p) {
    p = p || _patientDetailsPatient;
    if (!p) return;
    var noEl = g('det_patientNo');
    var nameEl = g('det_patientName');
    var alertsEl = g('det_alerts');
    if (noEl) noEl.textContent = p.patient_no ? '# ' + p.patient_no : '';
    if (nameEl) nameEl.textContent = patientDetailsNameLine(p);
    if (alertsEl) alertsEl.textContent = p.medical_alerts || '';
}

function refreshPatientDetailsBulkSection() {
    var bs = g('bulkSec');
    if (!bs) return;
    if (currentRole !== 'nurse') {
        bs.innerHTML =
            '<h3 style="margin-top:0;font-size:16px;">' +
            esc(patTr('patient.history.addNoteTitle')) + '</h3>' +
            '<textarea id="bulkNoteInput" rows="3" ' +
            'placeholder="' + esc(patTr('patient.history.addNotePh')) + '" ' +
            'style="width:100%;padding:10px;border:1px solid #ddd;' +
            'border-radius:6px;font-size:14px;box-sizing:border-box;' +
            'resize:vertical;"></textarea>' +
            '<button class="btn-add" id="noteSaveBtn" ' +
            'style="margin-top:10px;">' + esc(patTr('patient.history.addBtn')) + '</button>';
        var saveBtn = g('noteSaveBtn');
        if (saveBtn) saveBtn.addEventListener('click', saveNote);
    } else {
        bs.innerHTML =
            '<p style="color:#888;font-style:italic;margin:0;">' +
            esc(patTr('patient.history.viewingMode')) + '</p>';
    }
}

function viewHistory(pid) {
    SB.from('patients').select('*').eq('id',pid).single()
    .then(function(r) {
        if (r.error||!r.data) { alert(patTr('patient.alertCouldNotLoad')); return; }
        var p = r.data;
        setDirectoryActivePatient(p, 'patient-history');
        refreshPatientDetailsModalHeader(p);
        refreshPatientDetailsBulkSection();
        loadTreatments(p.id);
        openModal('patientDetailsModal');
    });
}

function loadTreatments(pid) {
    var tl = g('treatmentTimeline');
    tl.innerHTML = '<p style="color:#999;">' + esc(patTr('patient.history.loading')) + '</p>';
    SB.from('treatments').select('*')
        .eq('patient_id',pid)
        .order('created_at',{ascending:false})
    .then(function(r) {
        if (r.error||!r.data||!r.data.length) {
            tl.innerHTML =
                '<p style="color:#999;margin:0;">' + esc(patTr('patient.history.empty')) + '</p>';
            return;
        }
        var todayIso = typeof todayISO === 'function' ? todayISO() : '';
        tl.innerHTML = '';
        r.data.forEach(function(t) {
            var dk = '';
            if (t.created_at && typeof d2iso === 'function') {
                var nd = new Date(t.created_at);
                if (!isNaN(nd.getTime())) dk = d2iso(nd);
            }
            var isToday = todayIso && dk === todayIso;
            var canEdit = isToday && currentRole!=='nurse';
            var div = document.createElement('div');
            div.className = 'note-card';
            div.innerHTML =
                (canEdit
                    ? '<button data-note="'+t.id+'" ' +
                      'style="position:absolute;right:12px;top:12px;' +
                      'background:var(--primary);color:white;border:none;' +
                      'padding:4px 10px;border-radius:4px;cursor:pointer;' +
                      'font-size:12px;">' + esc(patTr('patient.history.editBtn')) + '</button>'
                    : '') +
                '<small style="color:#aaa;">' +
                    esc(fmtDateTime(t.created_at)) +
                '</small>' +
                '<div id="nt-'+t.id+'" ' +
                'style="white-space:pre-wrap;margin-top:6px;font-size:14px;">' +
                    esc(t.notes) +
                '</div>';
            tl.appendChild(div);
            if (canEdit) {
                div.querySelector('button').addEventListener('click', function(){
                    editNote(t.id);
                });
            }
        });
    });
}

function saveNote() {
    var inp = g('bulkNoteInput');
    if (!inp) return;
    var note = inp.value.trim();
    if (!note) { alert(patTr('patient.alertEnterNote')); return; }
    var ins = { patient_id: selPatientId, notes: note };
    var tagIns = selPatientClinicTag ||
        (typeof currentClinicCodeForTagging === 'function'
            ? currentClinicCodeForTagging()
            : '');
    if (tagIns) ins[TREATMENT_CLINIC_TAG_FIELD] = tagIns;
    SB.from('treatments')
        .insert([typeof withWorkingCreatedAt === 'function' ? withWorkingCreatedAt(ins) : ins])
    .then(function(r) {
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
        inp.value = '';
        loadTreatments(selPatientId);
    });
}

function editNote(nid) {
    var div = g('nt-'+nid);
    if (!div) return;
    var orig = div.innerText.trim();
    div.innerHTML =
        '<textarea id="ei-'+nid+'" ' +
        'style="width:100%;height:80px;padding:8px;border:1px solid #ddd;' +
        'border-radius:6px;font-size:14px;box-sizing:border-box;' +
        'margin-top:8px;resize:vertical;">' + esc(orig) + '</textarea>' +
        '<div style="display:flex;justify-content:space-between;margin-top:8px;">' +
            '<button id="del-'+nid+'" ' +
            'style="background:var(--danger);color:white;border:none;' +
            'padding:6px 14px;border-radius:4px;cursor:pointer;">' +
            esc(patTr('patient.history.deleteBtn')) + '</button>' +
            '<div style="display:flex;gap:8px;">' +
                '<button id="can-'+nid+'" ' +
                'style="background:var(--gray);color:white;border:none;' +
                'padding:6px 14px;border-radius:4px;cursor:pointer;">' +
                esc(patTr('patient.history.cancelBtn')) + '</button>' +
                '<button id="sav-'+nid+'" ' +
                'style="background:var(--success);color:white;border:none;' +
                'padding:6px 14px;border-radius:4px;cursor:pointer;">' +
                esc(patTr('patient.history.saveBtn')) + '</button>' +
            '</div>' +
        '</div>';
    g('del-'+nid).addEventListener('click', function() {
        if (!confirm(patTr('patient.confirmDeleteNote'))) return;
        SB.from('treatments').delete().eq('id',nid)
        .then(function(r) {
            if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
            loadTreatments(selPatientId);
        });
    });
    g('can-'+nid).addEventListener('click', function() {
        loadTreatments(selPatientId);
    });
    g('sav-'+nid).addEventListener('click', function() {
        var v = g('ei-'+nid).value.trim();
        SB.from('treatments').update({notes:v}).eq('id',nid)
        .then(function(r) {
            if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
            loadTreatments(selPatientId);
        });
    });
}

document.addEventListener('DOMContentLoaded', function() {
    initPatientResidentialDistrictSelectsOnce();
});

document.addEventListener('app-lang-change', function() {
    if (typeof refreshPatientDirI18n === 'function') refreshPatientDirI18n();
});

