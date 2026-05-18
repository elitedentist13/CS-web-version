// ════════════════════════════════════════════════════════════════
// GUARD — ensure Supabase SDK loaded
// ════════════════════════════════════════════════════════════════
if (typeof supabase === 'undefined') {
    document.body.innerHTML =
        '<div style="padding:60px;text-align:center;font-family:sans-serif;">' +
        '<h2 style="color:#dc3545;">Cannot load Supabase SDK</h2>' +
        '<p style="color:#666;">Check your internet connection and refresh.</p>' +
        '<button onclick="location.reload()" ' +
        'style="padding:10px 24px;background:#0084ff;color:white;' +
        'border:none;border-radius:6px;cursor:pointer;font-size:15px;">' +
        'Refresh</button></div>';
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

var PATIENT_CLINIC_TAG_FIELD = 'clinic_tag';
var APPOINTMENT_CLINIC_TAG_FIELD = 'clinic_tag';
var TREATMENT_CLINIC_TAG_FIELD = 'clinic_tag';

/** Populated after DOM exists; refreshed when clinics load. */
var CLINIC_TAG_FILTER_SELECT_IDS = [
    'patientDirClinicFilter',
    'arRecordsClinicFilter',
    'recallClinicFilter',
    'apptPsClinicFilter',
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

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════
function g(id) { return document.getElementById(id); }
function pad(n) { return String(n).padStart(2, '0'); }

function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' +
           pad(d.getMonth() + 1) + '-' +
           pad(d.getDate());
}

function d2iso(d) {
    return d.getFullYear() + '-' +
           pad(d.getMonth() + 1) + '-' +
           pad(d.getDate());
}

function fmt12(t) {
    if (!t) return '-';
    var p = String(t).split(':');
    var h = parseInt(p[0], 10);
    var m = parseInt(p[1] || '0', 10);
    return (h % 12 || 12) + ':' + pad(m) + (h >= 12 ? ' PM' : ' AM');
}

function addMins(t, mins) {
    var p     = String(t).split(':');
    var total = parseInt(p[0], 10) * 60 +
                parseInt(p[1], 10) +
                parseInt(mins,  10);
    return pad(Math.floor(total / 60) % 24) + ':' + pad(total % 60);
}

function fmtDateLong(iso) {
    if (!iso) return '-';
    var p = iso.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return d.toLocaleDateString('en-HK', {
        weekday: 'short',
        day:     'numeric',
        month:   'short',
        year:    'numeric',
        timeZone: 'UTC'
    });
}

function esc(s) {
    return String(s || '')
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;');
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
    var title = kind === 'male' ? 'Male' : kind === 'female' ? 'Female' : 'Sex not set';
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

function doctorDisplayName(doc) {
    if (!doc) return '';
    return doc.display_name || doc.english_name || doc.chinese_name || doc.doctor_code || '';
}

function doctorTagFromDoc(doc) {
    if (!doc) return '';
    var shown = doctorDisplayName(doc);
    if (!shown) return '';
    return doc.doctor_code ? ('[' + doc.doctor_code + '] ' + shown) : shown;
}

function getDoctorById(id) {
    if (!id || !Array.isArray(APP_DOCTORS)) return null;
    return APP_DOCTORS.find(function(d) { return d.id === id; }) || null;
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
    sel.innerHTML = '<option value="">ALL</option>';
    if (!APP_CLINICS || !APP_CLINICS.length) return;
    APP_CLINICS.forEach(function(c) {
        var code = String(c.clinic_code || '').trim();
        var val = code || String(c.id);
        var label = (code ? '[' + code + '] ' : '') +
            (c.english_name || c.chinese_name || 'Clinic');
        var o = document.createElement('option');
        o.value = val;
        o.textContent = label;
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

function refreshAllClinicTagFilterSelects() {
    CLINIC_TAG_FILTER_SELECT_IDS.forEach(function(id) {
        fillClinicTagFilterSelect(id, true);
    });
}

function applyPatientQueryClinicTag(builder, filterSelectId) {
    var tag = readClinicTagFilter(filterSelectId);
    if (!tag || !builder) return builder;
    return builder.eq(PATIENT_CLINIC_TAG_FIELD, tag);
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

function showOnly(id) {
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
    syncAppSessionChrome();
}

function refreshAppSessionStripContents() {
    var dateEl = g('appStripDate');
    var clinEl = g('appStripClinic');
    var iso = typeof todayISO === 'function' ? todayISO() : '';
    var dstr = iso && typeof fmtDateLong === 'function' ? fmtDateLong(iso) : iso;
    if (dateEl) dateEl.textContent = dstr ? 'Today: ' + dstr : '';

    var cline = '';
    var rec =
        currentClinicId && typeof clinicRecordFromId === 'function'
            ? clinicRecordFromId(currentClinicId)
            : null;
    if (rec) {
        cline =
            (rec.clinic_code ? '[' + String(rec.clinic_code).trim() + '] ' : '') +
            (rec.english_name || rec.chinese_name || '');
    } else if (currentClinicLabel) {
        cline = currentClinicLabel;
    }
    if (clinEl) clinEl.textContent = cline ? 'Clinic: ' + cline : '';

    var shortTitle = 'Joyful Smile Clinic Manager';
    try {
        document.title =
            cline
                ? 'JSM · ' + cline.replace(/\s+/g, ' ').trim() + (dstr ? ' · ' + dstr : '')
                : shortTitle + (dstr ? ' · ' + dstr : '');
    } catch (e) {}
}

/** Call after login/logout/navigation; shows fixed strip when a user session exists. */
function syncAppSessionChrome() {
    var strip = g('appSessionStrip');
    if (!strip) return;

    if (!currentUserId) {
        strip.style.display = 'none';
        document.body.classList.remove('app-session-active');
        try {
            document.title = 'Joyful Smile Clinic Manager';
        } catch (e) {}
        return;
    }

    strip.style.display = 'flex';
    document.body.classList.add('app-session-active');
    refreshAppSessionStripContents();
}

var appSessionStripTimer = null;
function startAppSessionStripClock() {
    if (appSessionStripTimer) clearInterval(appSessionStripTimer);
    appSessionStripTimer = setInterval(function() {
        if (currentUserId) refreshAppSessionStripContents();
    }, 60000);
}

function showLogin() { showOnly('loginOverlay'); }

function showDashboard() {
    showOnly('dashboardSection');
    var cfgSec = g('sectionConfig');
    if (cfgSec) cfgSec.style.display = 'none';
    if (typeof CFG !== 'undefined' && typeof CFG.prefetchPrintSettings === 'function' && currentClinicId) {
        requestAnimationFrame(function() {
            CFG.prefetchPrintSettings(currentClinicId);
        });
    }
    var bn = g('badgeName');
    var br = g('badgeRole');
    if (bn) bn.textContent = currentName || '-';
    if (br) br.textContent = currentRole || '-';
    if (typeof MEMO_AI !== 'undefined' && typeof MEMO_AI.refreshDashboardStickies === 'function') {
        requestAnimationFrame(function() {
            MEMO_AI.refreshDashboardStickies();
        });
    }
}

// ════════════════════════════════════════════════════════════════
// MODAL HELPERS
// ════════════════════════════════════════════════════════════════
function openModal(id) {
    var m = g(id);
    if (m) m.style.display = 'block';
}

function closeModal(id) {
    var m = g(id);
    if (m) m.style.display = 'none';
    // reset module-level state when specific modals close
    if (id === 'patientDetailsModal')  selPatientId  = null;
    if (id === 'editPatientModal')     editPatientId = null;
    if (id === 'apptModal') {
        if (typeof resetApptBookingGuards === 'function') resetApptBookingGuards();
        apptEditId = null;
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

function persistSession() {
    try {
        localStorage.setItem('jsm_session', JSON.stringify({
            user_id: currentUserId,
            role: currentRole,
            name: currentName,
            clinic_id: currentClinicId,
            clinic_label: currentClinicLabel,
            doctor_id: currentDoctorId,
            doctor_name: currentDoctorName
        }));
    } catch (e) {}
}

function clearSession() {
    try { localStorage.removeItem('jsm_session'); } catch (e) {}
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
        return true;
    } catch (e) {
        return false;
    }
}

function loadClinicsAndDoctorsForLogin() {
    // clinics
    SB.from('clinics')
      .select('id,clinic_code,english_name,chinese_name,address,tel')
      .order('clinic_code')
    .then(function (r) {
        APP_CLINICS = r.data || [];
        var sel = g('loginClinic');
        if (!sel) return;
        if (!APP_CLINICS.length) {
            sel.innerHTML = '<option value="">(No clinics)</option>';
            return;
        }
        sel.innerHTML = '<option value="">-- Select Clinic --</option>' +
            APP_CLINICS.map(function (c) {
                var label = (c.clinic_code ? ('[' + c.clinic_code + '] ') : '') +
                    (c.english_name || c.chinese_name || 'Clinic');
                return '<option value="' + esc(c.id) + '">' + esc(label) + '</option>';
            }).join('');
        refreshAllClinicTagFilterSelects();
        if (typeof fillAddPatientClinicSelect === 'function') {
            fillAddPatientClinicSelect();
        }
        if (typeof refreshEditPatientClinicIfModalOpen === 'function') {
            refreshEditPatientClinicIfModalOpen();
        }
        refreshAppSessionStripContents();
    });

    // doctors
    SB.from('doctors').select('id,doctor_code,english_name,chinese_name,display_name,is_active')
      .order('doctor_code')
    .then(function (r) {
        APP_DOCTORS = (r.data || []).filter(function (d) { return d.is_active !== false; });
        var sel = g('loginDoctor');
        if (!sel) return;
        if (!APP_DOCTORS.length) {
            sel.innerHTML = '<option value="">(No doctors)</option>';
            return;
        }
        sel.innerHTML = '<option value="">-- Select Doctor --</option>' +
            APP_DOCTORS.map(function (d) {
                var shown = d.display_name || d.english_name || d.chinese_name || 'Doctor';
                var label = (d.doctor_code ? ('[' + d.doctor_code + '] ') : '') + shown;
                return '<option value="' + esc(d.id) + '">' + esc(label) + '</option>';
            }).join('');
    });
}

function doLogin() {
    var uid = (g('loginUserId').value || '').trim();
    var pw  = (g('loginPassword').value || '');
    var clinicId = (g('loginClinic') && g('loginClinic').value) ? g('loginClinic').value : '';
    var doctorId = (g('loginDoctor') && g('loginDoctor').value) ? g('loginDoctor').value : '';

    if (!uid || !pw) {
        setLoginError('Please enter User ID and Password.');
        return;
    }
    if (!clinicId) {
        setLoginError('Please select a clinic.');
        return;
    }

    setLoginError('');

    var btn = g('loginBtn');
    btn.disabled    = true;
    btn.textContent = 'Logging in…';

    // Special nurse login
    if (uid.toLowerCase() === 'nurse' && pw === 'nurse') {
        btn.disabled    = false;
        btn.textContent = 'Log In';

        currentUserId = 'nurse';
        currentRole = 'nurse';
        currentName = 'Nurse';
        currentClinicId = clinicId;
        currentClinicLabel = (APP_CLINICS.find(function (c) { return c.id === clinicId; }) || {}).english_name || null;
        currentDoctorId = doctorId || null;
        var nd = (APP_DOCTORS.find(function (d) { return d.id === doctorId; }) || {});
        currentDoctorName = (nd.display_name || nd.english_name) || null;
        persistSession();
        showDashboard();
        return;
    }

    SB.from('app_users')
      .select('*')
      .eq('user_id', uid)
      .eq('password', pw)
      .eq('is_active', true)
      .limit(1)
    .then(function (r) {
        btn.disabled = false;
        btn.textContent = 'Log In';

        if (r.error || !r.data || !r.data.length) {
            setLoginError('Invalid login. Please check User ID / Password.');
            return;
        }

        var u = r.data[0];
        if (u.clinic_id && u.clinic_id !== clinicId) {
            setLoginError('This user is not assigned to the selected clinic.');
            return;
        }

        // For dentist accounts, doctor selection must match
        if ((u.role === 'doctor' || u.role === 'dentist') && u.doctor_id) {
            if (!doctorId || u.doctor_id !== doctorId) {
                setLoginError('Please select the correct doctor for this login.');
                return;
            }
        }

        currentUserId = u.user_id;
        currentRole = u.role || 'staff';
        currentClinicId = clinicId;
        currentClinicLabel = (APP_CLINICS.find(function (c) { return c.id === clinicId; }) || {}).english_name || null;

        // Name resolution
        if (u.doctor_id) {
            var doc = APP_DOCTORS.find(function (d) { return d.id === u.doctor_id; });
            currentDoctorId = u.doctor_id;
            currentDoctorName = doc ? (doc.display_name || doc.english_name) : null;
            currentName = currentDoctorName || u.display_name || u.user_id;
        } else {
            currentDoctorId = doctorId || null;
            var d2 = (APP_DOCTORS.find(function (d) { return d.id === doctorId; }) || {});
            currentDoctorName = (d2.display_name || d2.english_name) || null;
            currentName = u.display_name || u.user_id;
        }

        persistSession();
        showDashboard();
    })
    .catch(function (e) {
        btn.disabled = false;
        btn.textContent = 'Log In';
        setLoginError(e.message || 'Login error.');
    });
}

// ════════════════════════════════════════════════════════════════
// BOOT
// ════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function() {

    showLogin();
    loadClinicsAndDoctorsForLogin();
    refreshAllClinicTagFilterSelects();

    // restore local session
    if (restoreSession()) {
        showDashboard();
    }

    // ── Auth buttons ──────────────────────────────────────────
    g('loginBtn').addEventListener('click', doLogin);

    g('loginPassword').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doLogin();
    });

    g('logoutBtn').addEventListener('click', function() {
        currentRole = null;
        currentName = null;
        currentUserId = null;
        currentClinicId = null;
        currentClinicLabel = null;
        currentDoctorId = null;
        currentDoctorName = null;
        clearSession();
        showLogin();
    });

    // ── Dashboard cards ───────────────────────────────────────
    g('card-patient').addEventListener('click', function() {
        showOnly('patientSection');
        fetchPatients();
    });

    g('card-appointment').addEventListener('click', function() {
        showOnly('appointmentSection');
        initAppt();
    });

    g('card-consultation').addEventListener('click', function() {
        initConsultation();
    });

    var drugBookCard = g('card-drugbook');
    if (drugBookCard) {
        drugBookCard.addEventListener('click', function() {
            initDrugs();
        });
    }

        // ── Configuration card ────────────────────────────────────
    var cfgCard = g('card-configuration');
    if (cfgCard) {
        cfgCard.addEventListener('click', function() {
            if (currentRole !== 'admin') {
                alert('Configuration is admin-only.');
                return;
            }
            if (typeof CFG !== 'undefined' && typeof CFG.init === 'function') {
                showOnly('sectionConfig');
                CFG.init();
            } else {
                alert('Configuration module is loading...');
            }
        });
    }

    // report card
    var reportCard = g('card-report');
    if (reportCard) {
        reportCard.addEventListener('click', function () {
            showOnly('reportSection');
            if (typeof REPORT !== 'undefined' && typeof REPORT.init === 'function') {
                REPORT.init();
            } else {
                alert('Report module is loading...');
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
                alert('AI Patient Assistant module is loading...');
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
                alert('Memo module is loading...');
            }
        });
    }

    // placeholder cards
    ['card-expenses', 'card-inventory']
    .forEach(function(id) {
        var c = g(id);
        if (c) {
            c.addEventListener('click', function() {
                var label = id.replace('card-', '');
                label = label.charAt(0).toUpperCase() + label.slice(1);
                alert(label + ' — coming soon!');
            });
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
    g('searchInput').addEventListener('input', filterTable);

    var patientDirCf = g('patientDirClinicFilter');
    if (patientDirCf) {
        patientDirCf.addEventListener('change', function() {
            if (typeof fetchPatients === 'function') fetchPatients();
        });
    }

    var arCf = g('arRecordsClinicFilter');
    if (arCf) {
        arCf.addEventListener('change', function() {
            if (typeof loadApptRecords === 'function') loadApptRecords();
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

    var apptPsCf = g('apptPsClinicFilter');
    if (apptPsCf) {
        apptPsCf.addEventListener('change', function() {
            var inp = g('psInput');
            if (inp && (inp.value || '').trim() && typeof doPatientSearch === 'function') {
                doPatientSearch();
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

    var rptCf = g('reportPatientDirClinicFilter');
    if (rptCf && typeof REPORT !== 'undefined' && typeof REPORT.refresh === 'function') {
        rptCf.addEventListener('change', function() {
            REPORT.refresh();
        });
    }

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
            genPatientNo(function(no) {
                if (no) {
                    sv('preview_patientNo', no);
                    if (typeof updateAddPatientNoAvailabilityUI === 'function') {
                        updateAddPatientNoAvailabilityUI();
                    }
                } else {
                    alert(
                        'No free patient numbers in range 010000–999999 (shared across all clinics).'
                    );
                }
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
    });
    g('calNext').addEventListener('click', function() {
        if (calView === 'weekly')
            calDate = new Date(calDate.getFullYear(), calDate.getMonth(), calDate.getDate() + 7);
        else
            calDate = new Date(calDate.getFullYear(), calDate.getMonth() + 1, 1);
        renderCal();
    });
    g('calTodayBtn').addEventListener('click', function() {
        if (calView === 'weekly') GCAL.goToday();
        else { calDate = new Date(); renderCal(); }
    });

    // appointment modal — duration auto-calc
    g('fStart').addEventListener('change', calcEnd);
    g('fDur').addEventListener('change',   calcEnd);

    // patient search in appointment modal
    g('psInput').addEventListener('input', function() {
        clearTimeout(psTimer);
        psTimer = setTimeout(doPatientSearch, 280);
    });

    // bill panel
    g('billPanelClose').addEventListener('click',  closeBillPanel);
    g('addBillItemBtn').addEventListener('click',  addBillItem);
    g('bDiscount').addEventListener('input',       recalcTotals);
    g('bAmtPaid').addEventListener('input',        recalcBalance);
    g('saveBillBtn').addEventListener('click', function() {
        saveBill(false);
    });
    g('savePrintBillBtn').addEventListener('click', function() {
        saveBill(true);
    });
    g('closeReceiptModal').addEventListener('click', function() {
        closeModal('receiptModal');
    });
    g('closeReceiptModal2').addEventListener('click', function() {
        closeModal('receiptModal');
    });

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
            aiPitchToggle.textContent = open ? 'Why clinics buy this ↓' : 'Hide ↑';
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
    g('conNoteSaveBtn').addEventListener('click', saveConNote);

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

        // close action dropdowns (queue table)
        document.querySelectorAll('.action-drop.open').forEach(function(dd) {
            var wrap = dd.closest('.action-wrap');
            if (wrap && !wrap.contains(e.target)) {
                dd.classList.remove('open');
            }
        });

        // close appointment patient search dropdown
        var psWrap = document.querySelector('#apptModal .ps-wrap');
        if (psWrap && !psWrap.contains(e.target)) {
            var psDrop = g('psDrop');
            if (psDrop) psDrop.style.display = 'none';
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

    // modal backdrop click to close
    document.querySelectorAll('.modal').forEach(function(m) {
        m.addEventListener('click', function(e) {
            if (e.target === m) m.style.display = 'none';
        });
    });

    startAppSessionStripClock();
    syncAppSessionChrome();

}); // end DOMContentLoaded
