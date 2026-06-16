// ════════════════════════════════════════════════════════════════
// APP-CONSULTATION.JS
// Tables: druglist, drughistory, treatments, patients
// ════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
var conPatientId   = null;
var conPatientData = null;
var conPsTimer     = null;
var drugEditId     = null;
var drugEditRow    = null;
var rxLines        = [];
/** Confirmed drug lines (Add to list) shown in the prescription list zone. */
var rxStagedLines  = [];
var rxComboSearchTimer = null;
/** When set, Save Prescription replaces these drughistory rows instead of appending. */
var rxEditingHistoryGroup = null;

// Medical / Dental tab state
var conMedPatientId   = null;
var conMedPatientData = null;
var conDenPatientId   = null;
var conDenPatientData = null;

// Active doctor selection (applies to notes, drugs, forms/letters)
var conActiveDoctorId = null;
var conActiveDoctorName = null;
var conActiveDoctorTag = null;
var conDoctorsById = {};
var conPendingDoctorContext = null;

// Forms / Letters state
var conFormsPatientId = null;
var conFormsPatientData = null;
var conFormsTemplates = [];
var conFormsSelectedTemplate = null;
var conFormsDoctorData = null;
var conFormsSavedRange = null;
var conFormsSelectedDocIds = [];
var conFormsDocsCache = {};
var conFormsShellHeaderTpl = '';
var conFormsShellFooterTpl = '';
var conFormsShellLoaded = false;
var conFormsShellLoading = false;
var conFormsShellPreviewOn = false;
var conFormsShellWaiters = [];
/** Sick leave template: inclusive date range (YYYY-MM-DD); diagnosis typed at {diagnosis} in body. */
var conFormsSickLeaveFrom = '';
var conFormsSickLeaveTo = '';
var conFormsSickLeaveDxInner = '';
var conFormsSickLeaveRenderTimer = null;
/** Treatment pane subtab: notes | timeline */
var conTnActiveSubtab = 'notes';
var conPtlFilterKey = 'all';
var conPatientTimelineEvents = [];
var conPatientTimelineHadErrors = false;
var conPtlRefreshTimer = null;
var conFormsEditingDocId = null;
var conFormsToolbarReady = false;
var CON_NOTE_TEMPLATES_KEY = 'con_note_templates_v1';
var CON_NOTE_TEMPLATES_TABLE = 'con_note_templates';
var conNoteTemplatesCache = [];
var conNoteTemplatesLoaded = false;
var conNoteTemplatesRemoteWarned = false;

var RX_COMBO_LISTS_KEY = 'rx_saved_combo_lists_v1';

function conUiLocale() {
    if (typeof appUiLocale === 'function') return appUiLocale();
    return (typeof APP_LOCALE !== 'undefined' && APP_LOCALE) ? APP_LOCALE : 'en-HK';
}

function conTr(key) {
    return (typeof t === 'function') ? t(key) : key;
}
function conTrRepl(key, pairs) {
    var s = conTr(key);
    if (pairs) {
        for (var p in pairs) {
            if (Object.prototype.hasOwnProperty.call(pairs, p)) {
                s = s.replace(new RegExp('\\{' + p + '\\}', 'g'), pairs[p]);
            }
        }
    }
    return s;
}

function conDrugCatLabel(cat) {
    if (typeof drugCategoryLabel === 'function') return drugCategoryLabel(cat);
    var s = String(cat || '').trim();
    return s || conTr('con.rx.categoryOther');
}

function updateConBannerBananaIndex(p) {
    var wrap = g('conBannerBananaWrap');
    var el = g('conBannerBananas');
    if (!wrap || !el) return;
    var n = parseInt(p && p.banana_index, 10);
    if (!n || n < 1 || n > 10) {
        wrap.style.display = 'none';
        el.textContent = '';
        return;
    }
    wrap.style.display = 'flex';
    el.textContent = '\uD83C\uDF4C'.repeat(n);
}

function updateConBannerBananaNotes(p) {
    var wrap = g('conBannerBananaNotesWrap');
    var el = g('conBannerBananaNotes');
    if (!wrap || !el) return;
    var txt = String((p && p.banana_notes) || '').trim();
    if (!txt) {
        wrap.style.display = 'none';
        el.textContent = '—';
        return;
    }
    wrap.style.display = 'flex';
    el.textContent = txt;
}

function refreshConPatientBannerI18n(p) {
    if (!p) return;

    if (g('conBannerToday') && typeof fmtNowDateTimeHK === 'function') {
        g('conBannerToday').textContent = fmtNowDateTimeHK();
    }
    if (g('conBannerDob')) {
        g('conBannerDob').textContent = p.dob ? formatDobAge(p.dob) : '-';
    }
    if (g('conBannerAlert')) {
        g('conBannerAlert').textContent = p.medical_alerts || conTr('con.banner.none');
        g('conBannerAlert').style.color = p.medical_alerts ? 'var(--danger)' : '#999';
    }

    var sexWrap = g('conBannerSexWrap');
    if (sexWrap && typeof patientSexSymbolHtml === 'function') {
        var sexHtml = patientSexSymbolHtml(p.sex, { banner: true });
        var kind = typeof patientSexKind === 'function'
            ? patientSexKind(p.sex)
            : 'unknown';
        if (kind === 'unknown') {
            sexWrap.style.display = 'none';
            sexWrap.innerHTML = esc(conTr('con.banner.sexLabel')) + '&nbsp;';
        } else {
            sexWrap.style.display = '';
            sexWrap.innerHTML = esc(conTr('con.banner.sexLabel')) + '&nbsp;' + sexHtml;
        }
    }

    if (g('conMedBannerDob')) {
        g('conMedBannerDob').textContent = p.dob ? formatDobAge(p.dob) : '-';
    }
    if (g('conMedBannerAlert')) {
        g('conMedBannerAlert').textContent = p.medical_alerts || conTr('con.banner.none');
        g('conMedBannerAlert').style.color = p.medical_alerts ? 'var(--danger)' : '#999';
    }

    if (g('conDenBannerDob')) {
        g('conDenBannerDob').textContent = p.dob ? formatDobAge(p.dob) : '-';
    }
    if (g('conDenBannerAlert')) {
        g('conDenBannerAlert').textContent = p.medical_alerts || conTr('con.banner.none');
        g('conDenBannerAlert').style.color = p.medical_alerts ? 'var(--danger)' : '#999';
    }

    updateConBannerBananaIndex(p);
    updateConBannerBananaNotes(p);
}

/** Total positive balances across all bills for the consultation patient (“AR due”). */
function refreshConPatientOutstandingBalance() {
    var balEl = g('conBannerBalance');
    var btn   = g('conBannerBalanceBtn');
    if (!balEl) return;
    function showBtn(owing) {
        if (!btn) return;
        btn.style.display = '';
        btn.classList.toggle('con-banner-paid', !owing);
    }
    function hideBtn() {
        if (!btn) return;
        btn.style.display = 'none';
        btn.classList.remove('con-banner-paid');
    }
    function clearBalanceDisplay() {
        balEl.textContent = '—';
        hideBtn();
    }
    if (!SB || typeof SB.from !== 'function') { clearBalanceDisplay(); return; }
    if (!conPatientId) { clearBalanceDisplay(); return; }

    function applyTotals(rows) {
        var t = 0;
        (rows || []).forEach(function(b) {
            if (b && b.voided_at) return;
            var x = parseFloat(b.balance);
            if (isFinite(x) && x > 0.005) t += x;
        });
        balEl.textContent = typeof fmtHK === 'function' ? fmtHK(t) : ('$' + t.toFixed(2));
        showBtn(t > 0.005);
    }

    var pno = (conPatientData && conPatientData.patient_no)
        ? String(conPatientData.patient_no).trim() : '';

    function fetchByPatientNo() {
        if (!pno) { applyTotals([]); return; }
        SB.from('bills').select('balance, voided_at').eq('patient_no', pno)
            .then(function(r2) { applyTotals(!r2.error && r2.data ? r2.data : []); })
            .catch(function() { applyTotals([]); });
    }

    SB.from('bills').select('balance, voided_at').eq('patient_id', conPatientId)
        .then(function(r) {
            if (r.error) {
                if (String(r.error.message || '').toLowerCase().indexOf('patient_id') >= 0 && pno)
                    fetchByPatientNo();
                else applyTotals([]);
                return;
            }
            applyTotals(r.data || []);
        })
        .catch(function() { fetchByPatientNo(); });
}

/** Opens the bill panel for the current consultation patient — called from the AR banner button. */
function conBannerOpenBill() {
    if (!conPatientId || !conPatientData) return;
    if (typeof openBillPanel !== 'function') return;
    openBillPanel({
        id:           null,
        patient_id:   conPatientId,
        patient_name: conPatientData.full_name  || '',
        patient_no:   conPatientData.patient_no || ''
    });
}

/** Print label field — EN/ZH keys share same text in every UI locale. */
function conLblPrint(isZh, slug) {
    return conTr('con.rx.printLbl.' + slug + (isZh ? '.zh' : '.en'));
}

/** Dropdown value for a line restored from saved history/list but not yet tied to catalogue id */
var RX_SNAPSHOT_SELECT = '__RX_SNAPSHOT__';
// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
function initConsultation() {
    showOnly('consultationSection');
    switchConTab('treatment');
    sv('conPsInput', '');

    var dd = g('conPsDrop');
    if (dd) dd.style.display = 'none';

    sv('conPsInputChart', '');
    var ddc = g('conPsDropChart');
    if (ddc) ddc.style.display = 'none';

    var banner = g('conPatientBanner');
    if (banner) banner.style.display = 'none';

    var emWr = g('conBannerEmailWrap');
    var hkWr = g('conBannerHkidWrap');
    if (emWr) emWr.style.display = 'none';
    if (hkWr) hkWr.style.display = 'none';
    updateConBannerBananaIndex(null);

    var layout = g('conMainLayout');
    if (layout) layout.style.display = 'none';

    conPatientId   = null;
    conPatientData = null;
    rxLines        = [];

    refreshConPatientOutstandingBalance();

    setConBillBtn(false);
    if (typeof refreshConsultationClinicFilterSelects === 'function') {
        refreshConsultationClinicFilterSelects();
    } else if (typeof refreshAllClinicTagFilterSelects === 'function') {
        refreshAllClinicTagFilterSelects();
    }
    loadConsultationDoctors();
    initMedAlertDisplayPrefs();
    refreshConFormsFontSizeSelect();
    refreshConFormsToolbarI18n();
    conTreatmentNotesCache = [];
    updateConTnPrintBtnState();

    var activeP = (typeof _patientDetailsPatient !== 'undefined' && _patientDetailsPatient && _patientDetailsPatient.id)
        ? _patientDetailsPatient
        : null;
    if (!activeP && typeof conPatientData !== 'undefined' && conPatientData && conPatientData.id) {
        activeP = conPatientData;
    }
    if (activeP) {
        setTimeout(function() {
            selectConPatient(activeP);
        }, 0);
    }
    if (typeof applyAddMedicalTermProgramUi === 'function') applyAddMedicalTermProgramUi();
    if (typeof applyMedicalNotesProgramLocks === 'function') applyMedicalNotesProgramLocks();
}

function setConBillBtn(enabled) {
    var btn = g('conBillBtn');
    if (!btn) return;
    btn.disabled = !enabled;
    if (enabled) {
        btn.style.background  = 'var(--primary)';
        btn.style.color       = '#fff';
        btn.style.cursor      = 'pointer';
    } else {
        btn.style.background  = '#d1d5db';
        btn.style.color       = '#9ca3af';
        btn.style.cursor      = 'not-allowed';
    }
}

function openBillFromConsultation() {
    if (!conPatientId || !conPatientData) return;
    if (typeof openBillPanel !== 'function') return;
    openBillPanel({
        id          : null,
        patient_id  : conPatientId,
        patient_name: conPatientData.full_name  || '',
        patient_no  : conPatientData.patient_no || ''
    });
}

function loadConsultationDoctors() {
    var sel = g('conDoctorSelect');
    var preserveId = sel && sel.value ? sel.value : '';
    if (sel) {
        sel.innerHTML = '<option value="">' + esc(conTr('common.loadingDoctors')) + '</option>';
    }

    // Prefer globally loaded doctor list from login if present
    var globalDocs = (typeof APP_DOCTORS !== 'undefined' && Array.isArray(APP_DOCTORS)) ? APP_DOCTORS : null;
    var useDocs = function (docs) {
        docs = (docs || []).filter(function (d) { return d.is_active !== false; });
        if (typeof currentClinicId !== 'undefined' && currentClinicId) {
            if (typeof doctorsForClinic === 'function') {
                docs = doctorsForClinic(currentClinicId);
            } else {
                docs = docs.filter(function (d) { return d.clinic_id === currentClinicId; });
            }
        }
        conDoctorsById = {};
        docs.forEach(function (d) { conDoctorsById[d.id] = d; });
        if (!sel) return;
        if (!docs.length) {
            sel.innerHTML = '<option value="">' + esc(conTr('con.noDoctors')) + '</option>';
            return;
        }
        sel.innerHTML =
            '<option value="">' + esc(conTr('con.selectDoctor')) + '</option>' +
            docs.map(function (d) {
                var label = (typeof doctorDisplayName === 'function')
                    ? doctorDisplayName(d)
                    : (d.display_name || d.english_name || d.chinese_name || conTr('cfg.label.doctorFallback'));
                return '<option value="' + esc(d.id) + '">' + esc(label) + '</option>';
            }).join('');

        var pendingId = conResolveDoctorIdFromContext(conPendingDoctorContext, docs);

        // default selection: queued appointment doctor, currentDoctorId, else match currentName
        var defaultId = (typeof currentDoctorId !== 'undefined' && currentDoctorId) ? currentDoctorId : '';
        if (!defaultId && typeof currentName !== 'undefined' && currentName) {
            var m = docs.find(function (d) { return d.english_name === currentName; });
            defaultId = m ? m.id : '';
        }
        var pick = pendingId ||
            (preserveId && docs.some(function (d) { return String(d.id) === String(preserveId); })
                ? preserveId
                : defaultId);
        if (pick) {
            sel.value = pick;
            conSetActiveDoctor(pick);
            if (pendingId && String(pick) === String(pendingId)) conPendingDoctorContext = null;
        } else {
            conSetActiveDoctor('');
        }
    };

    if (globalDocs && globalDocs.length) {
        useDocs(globalDocs);
        return;
    }

    SB.from('doctors').select(
        'id,doctor_code,english_name,chinese_name,display_name,is_active,clinic_id,qualification,qualification_chinese'
    ).order('doctor_code')
    .then(function (r) {
        useDocs(r.data || []);
    });
}

function conNormalizeDoctorContext(ctx) {
    ctx = ctx || {};
    var out = {
        doctor_id: ctx.doctor_id || ctx.doctorId || null,
        doctor_code: String(ctx.doctor_code || ctx.doctorCode || '').trim(),
        doctor_name: String(ctx.doctor_name || ctx.doctorName || '').trim()
    };
    return (out.doctor_id || out.doctor_code || out.doctor_name) ? out : null;
}

function conResolveDoctorIdFromContext(ctx, docs) {
    ctx = conNormalizeDoctorContext(ctx);
    if (!ctx) return '';
    docs = docs || Object.keys(conDoctorsById || {}).map(function (id) { return conDoctorsById[id]; });
    if (ctx.doctor_id) {
        var byId = docs.find(function (d) { return d && String(d.id) === String(ctx.doctor_id); });
        if (byId) return byId.id;
    }
    var code = String(ctx.doctor_code || '').trim().toLowerCase();
    if (code) {
        var byCode = docs.find(function (d) {
            return d && String(d.doctor_code || '').trim().toLowerCase() === code;
        });
        if (byCode) return byCode.id;
    }
    var name = String(ctx.doctor_name || '').trim().toLowerCase();
    if (name) {
        var byName = docs.find(function (d) {
            if (!d) return false;
            var labels = [
                d.english_name,
                d.display_name,
                d.chinese_name,
                (typeof doctorDisplayName === 'function' ? doctorDisplayName(d) : '')
            ].map(function (v) { return String(v || '').trim().toLowerCase(); });
            return labels.indexOf(name) >= 0;
        });
        if (byName) return byName.id;
    }
    return '';
}

function conSetActiveDoctor(doctorId) {
    conActiveDoctorId = doctorId || null;
    conActiveDoctorName = null;
    conActiveDoctorTag = null;

    var picked = conActiveDoctorId ? (conDoctorsById[conActiveDoctorId] || null) : null;
    if (picked) {
        conActiveDoctorName = (typeof doctorDisplayName === 'function')
            ? (doctorDisplayName(picked) || null)
            : (picked.display_name || picked.english_name || picked.chinese_name || null);
        conActiveDoctorTag = String(picked.doctor_code || '').trim() || null;
    }

    var sel = g('conDoctorSelect');
    if (sel && doctorId && !conActiveDoctorName) {
        var fallbackDoc = conDoctorsById[doctorId];
        if (fallbackDoc) {
            conActiveDoctorName = (typeof doctorDisplayName === 'function')
                ? (doctorDisplayName(fallbackDoc) || null)
                : (fallbackDoc.english_name || fallbackDoc.chinese_name || null);
            conActiveDoctorTag = String(fallbackDoc.doctor_code || '').trim() || null;
        } else {
            var opt = sel.options[sel.selectedIndex];
            conActiveDoctorName = opt ? String(opt.textContent || '').trim() : null;
        }
    }

    // Also update globally-used "currentName" so existing modules pick it up
    currentDoctorId = conActiveDoctorId;
    if (conActiveDoctorName) {
        currentDoctorName = conActiveDoctorName;
    }
    if (conActiveDoctorName) {
        currentName = conActiveDoctorName;
    }

    conFormsDoctorData = null;
    updateConsultationDoctorUI();

    var formsTabActive = document.querySelector('.con-tab.active');
    if (formsTabActive && formsTabActive.dataset.tab === 'forms' &&
        typeof loadConFormsDoctor === 'function') {
        loadConFormsDoctor(function () {
            if (typeof conFormsRefreshPlaceholdersInEditor === 'function') {
                conFormsRefreshPlaceholdersInEditor();
            }
        }, true);
    }
}

function updateConsultationDoctorUI() {
    var shown = conActiveDoctorName || currentName || '—';
    if (g('conBannerDoctor')) g('conBannerDoctor').textContent = shown;
    if (g('drugActiveDoctorLabel')) g('drugActiveDoctorLabel').textContent = shown;
    if (g('conFormsDoctorLabel')) g('conFormsDoctorLabel').textContent = shown;

    // prescription dentist field (if visible)
    if (g('rxDentistName')) {
        g('rxDentistName').value = shown === '—' ? '' : shown;
    }
}

// ════════════════════════════════════════════════════════════════
// OPEN FOR SPECIFIC PATIENT (from queue)
// ════════════════════════════════════════════════════════════════
function openConForPatient(patientId, opts) {
    opts = opts || {};
    var doctorCtx = conNormalizeDoctorContext(opts.doctorContext || opts);
    if (doctorCtx) {
        conPendingDoctorContext = doctorCtx;
    }
    showOnly('consultationSection');
    switchConTab('treatment');
    if (typeof refreshConsultationClinicFilterSelects === 'function') {
        refreshConsultationClinicFilterSelects();
    }
    if (doctorCtx) {
        loadConsultationDoctors();
    }

    sv('conPsInput', '');

    var dd = g('conPsDrop');
    if (dd) dd.style.display = 'none';

    sv('conPsInputChart', '');
    if (g('conPsDropChart')) g('conPsDropChart').style.display = 'none';

    var banner = g('conPatientBanner');
    if (banner) banner.style.display = 'none';

    var emWr2 = g('conBannerEmailWrap');
    var hkWr2 = g('conBannerHkidWrap');
    if (emWr2) emWr2.style.display = 'none';
    if (hkWr2) hkWr2.style.display = 'none';
    updateConBannerBananaIndex(null);

    var layout = g('conMainLayout');
    if (layout) layout.style.display = 'none';

    conPatientId   = null;
    conPatientData = null;
    rxLines        = [];

    refreshConPatientOutstandingBalance();

    function fetchPatient(selCols, retried) {
        SB.from('patients').select(selCols).eq('id', patientId).single()
        .then(function(r) {
            if (r.error || !r.data) {
                var m = String((r && r.error && r.error.message) || '').toLowerCase();
                if (!retried && m.indexOf('banana_notes') >= 0) {
                    fetchPatient(
                        'id,patient_no,full_name,chinese_name,sex,dob,' +
                        'phone_number,email,hkid,address,medical_alerts,banana_index,' + PATIENT_CLINIC_TAG_FIELD,
                        true
                    );
                    return;
                }
                alert(conTr('con.alert.loadPatientFail'));
                return;
            }
            var inp = g('conPsInput');
            if (inp) {
                inp.value =
                    r.data.full_name +
                    ' (#' + (r.data.patient_no || '') + ')';
            }
            selectConPatient(r.data);
        });
    }
    fetchPatient(
        'id,patient_no,full_name,chinese_name,sex,dob,' +
        'phone_number,email,hkid,address,medical_alerts,banana_index,banana_notes,' + PATIENT_CLINIC_TAG_FIELD,
        false
    );
}

// ════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ════════════════════════════════════════════════════════════════
function switchConTab(tab) {
    document.querySelectorAll('.con-tab').forEach(function(b) {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.con-pane').forEach(function(p) {
        p.classList.toggle('active', p.id === 'con-' + tab);
    });

    if (tab === 'charting') {
        if (conPatientId && conPatientData) {
            initChart(conPatientId, conPatientData.full_name);
        }
    }

    if (tab === 'photos') {
        var photosPane = g('photoMainContent');
        if (photosPane && conPatientId) {
            photosPane.style.display = 'block';
        }
        if (typeof openPhotosSection === 'function') {
            openPhotosSection();
        }
    }

    if (tab === 'xrays') {
        if (typeof xrayPatientId !== 'undefined' && xrayPatientId) {
            if (typeof loadXrayRecords === 'function') {
                loadXrayRecords();
            }
        } else if (conPatientId && conPatientData) {
            // Patient selected in treatment notes but x-ray module not yet synced
            if (typeof syncXrayPatient === 'function') {
                syncXrayPatient(conPatientId, conPatientData);
            }
        }
    }

    if (tab === 'forms') {
        initConForms();
    }
}

// ════════════════════════════════════════════════════════════════
// PATIENT SEARCH — Treatment tab
// ════════════════════════════════════════════════════════════════
function doConPatientSearch() {
    runPatientSearchDropdown({
        inputId: 'conPsInput',
        dropId: 'conPsDrop',
        clinicFilterId: 'conPsClinicFilter',
        onSelect: selectConPatient
    });
}

// ── Charting tab: same search as treatment, ties into selectConPatient ──
function doConPatientSearchChart() {
    runPatientSearchDropdown({
        inputId: 'conPsInputChart',
        dropId: 'conPsDropChart',
        clinicFilterId: 'conPsClinicFilterChart',
        onSelect: selectConPatient
    });
}

// ════════════════════════════════════════════════════════════════
// SELECT PATIENT — populate ALL tabs
// ════════════════════════════════════════════════════════════════
function selectConPatient(p) {
    if (typeof setDirectoryActivePatient === 'function') {
        setDirectoryActivePatient(p, 'consultation-select');
    }
    conPatientId      = p.id;
    conPatientData    = p;
    conMedPatientId   = p.id;
    conMedPatientData = p;
    conDenPatientId   = p.id;
    conDenPatientData = p;
    conFormsPatientId = p.id;
    conFormsPatientData = p;

    var todayStr = typeof fmtNowDateTimeHK === 'function'
        ? fmtNowDateTimeHK()
        : nowLocal().toLocaleDateString(APP_LOCALE || 'en-HK', {
            weekday: 'short', day: 'numeric',
            month: 'short', year: 'numeric'
        });

    var banner = g('conPatientBanner');
    if (banner) banner.style.display = 'flex';

    var nameEl = g('conBannerName');
    if (nameEl) nameEl.textContent = p.full_name || '—';

    var cnEl = g('conBannerChinese');
    var cn   = String(p.chinese_name || '').trim();
    if (cnEl) {
        cnEl.textContent   = cn;
        cnEl.style.display = cn ? 'block' : 'none';
        cnEl.className     = 'con-banner-chinese';
    }
    if (banner) {
        banner.classList.toggle('has-chinese-name', !!cn);
    }

    var noEl = g('conBannerNo');
    if (noEl) noEl.textContent = p.patient_no || '-';

    var sexWrap = g('conBannerSexWrap');
    if (sexWrap) {
        var sexHtml = typeof patientSexSymbolHtml === 'function'
            ? patientSexSymbolHtml(p.sex, { banner: true })
            : '';
        var kind = typeof patientSexKind === 'function' ? patientSexKind(p.sex) : 'unknown';
        if (kind === 'unknown') {
            sexWrap.style.display = 'none';
            sexWrap.innerHTML = esc(conTr('con.banner.sexLabel')) + '&nbsp;';
        } else {
            sexWrap.style.display = '';
            sexWrap.innerHTML = esc(conTr('con.banner.sexLabel')) + '&nbsp;' + sexHtml;
        }
    }

    var dobEl = g('conBannerDob');
    if (dobEl) dobEl.textContent = p.dob ? formatDobAge(p.dob) : '-';

    var phoneEl = g('conBannerPhone');
    if (phoneEl) phoneEl.textContent = p.phone_number || '-';

    var emailStr = String(p.email || '').trim();
    var emWrap = g('conBannerEmailWrap');
    var emEl = g('conBannerEmail');
    if (emWrap && emEl) {
        if (emailStr) {
            emWrap.style.display = '';
            emEl.textContent = emailStr;
        } else {
            emWrap.style.display = 'none';
            emEl.textContent = '—';
        }
    }
    var hkStr = String(p.hkid || '').trim();
    var hkWrap = g('conBannerHkidWrap');
    var hkEl = g('conBannerHkid');
    if (hkWrap && hkEl) {
        if (hkStr) {
            hkWrap.style.display = '';
            hkEl.textContent = hkStr;
        } else {
            hkWrap.style.display = 'none';
            hkEl.textContent = '—';
        }
    }

    var todayEl = g('conBannerToday');
    if (todayEl) todayEl.textContent = todayStr;

    // active doctor display on banner
    if (g('conBannerDoctor')) {
        g('conBannerDoctor').textContent = conActiveDoctorName || currentName || '—';
    }

    var alertEl = g('conBannerAlert');
    if (alertEl) {
        alertEl.textContent = p.medical_alerts || conTr('con.banner.none');
        alertEl.style.color = p.medical_alerts
            ? 'var(--danger)' : '#999';
    }

    updateConBannerBananaIndex(p);
    updateConBannerBananaNotes(p);
    // Some callers pass compact patient rows from search; hydrate banana_notes if missing.
    if (p && p.id && typeof p.banana_notes === 'undefined') {
        SB.from('patients').select('banana_notes').eq('id', p.id).single()
        .then(function(r) {
            if (r.error || !r.data) return;
            conPatientData = conPatientData || {};
            conPatientData.banana_notes = r.data.banana_notes || null;
            updateConBannerBananaNotes(conPatientData);
        });
    }

    var layout = g('conMainLayout');
    if (layout) layout.style.display = 'grid';

    var medInput = g('conPsInputMed');
    if (medInput) {
        medInput.value =
            p.full_name + ' (#' + (p.patient_no || '') + ')';
    }
    var medDrop = g('conPsDropMed');
    if (medDrop) medDrop.style.display = 'none';

    var medBanner = g('conMedBanner');
    if (medBanner) medBanner.style.display = 'flex';

    if (g('conMedBannerName'))
        g('conMedBannerName').textContent = p.full_name;
    if (g('conMedBannerNo'))
        g('conMedBannerNo').textContent = p.patient_no || '-';
    if (g('conMedBannerDob'))
        g('conMedBannerDob').textContent =
            p.dob ? formatDobAge(p.dob) : '-';
    if (g('conMedBannerAlert')) {
        g('conMedBannerAlert').textContent = p.medical_alerts || conTr('con.banner.none');
        g('conMedBannerAlert').style.color = p.medical_alerts
            ? 'var(--danger)' : '#999';
    }
    if (g('conMedFormPatientName')) {
        g('conMedFormPatientName').textContent =
            p.full_name + '  (#' + (p.patient_no || '-') + ')';
    }

    var denInput = g('conPsInputDen');
    if (denInput) {
        denInput.value =
            p.full_name + ' (#' + (p.patient_no || '') + ')';
    }
    var denDrop = g('conPsDropDen');
    if (denDrop) denDrop.style.display = 'none';

    var chartInput = g('conPsInputChart');
    if (chartInput) {
        chartInput.value =
            p.full_name + ' (#' + (p.patient_no || '') + ')';
    }
    var chartDrop = g('conPsDropChart');
    if (chartDrop) chartDrop.style.display = 'none';

    var denBanner = g('conDenBanner');
    if (denBanner) denBanner.style.display = 'flex';

    if (g('conDenBannerName'))
        g('conDenBannerName').textContent = p.full_name;
    if (g('conDenBannerNo'))
        g('conDenBannerNo').textContent = p.patient_no || '-';
    if (g('conDenBannerDob'))
        g('conDenBannerDob').textContent =
            p.dob ? formatDobAge(p.dob) : '-';
    if (g('conDenBannerAlert')) {
        g('conDenBannerAlert').textContent = p.medical_alerts || conTr('con.banner.none');
        g('conDenBannerAlert').style.color = p.medical_alerts
            ? 'var(--danger)' : '#999';
    }
    if (g('conDenFormPatientName')) {
        g('conDenFormPatientName').textContent =
            p.full_name + '  (#' + (p.patient_no || '-') + ')';
    }

    toggleDrugAddPanel(false);
    rxLines = [];

    setConBillBtn(true);
    updateConTnPrintBtnState();

    if (typeof syncPhotoPatient === 'function') {
        syncPhotoPatient(p.id, p);
    }
    if (typeof syncXrayPatient === 'function') {
        syncXrayPatient(p.id, p);
    }

    setTimeout(function() {
        loadConNotes(p.id);
        loadDrugHistory(p.id);
        loadMedicalHistory();
        loadDentalHistory();
        refreshConPatientOutstandingBalance();
        // forms tab reacts to selected patient too
        updateConFormsPatientLabel();

        var activeTab = document.querySelector('.con-tab.active');
        if (activeTab && activeTab.dataset.tab === 'charting') {
            initChart(p.id, p.full_name);
        }
    }, 0);
}

// ════════════════════════════════════════════════════════════════
// FORMS / LETTERS TAB
// Uses tables: doc_templates, patients, doctors, (expected) patient_documents
// ════════════════════════════════════════════════════════════════

function initConForms() {
    var card = g('conFormsTplCard');
    if (card) card.style.display = conFormsPatientId ? 'block' : 'none';
    conFormsShowHistCard(!!conFormsPatientId);

    var docSel = g('conDoctorSelect');
    if (docSel && docSel.value && typeof conSetActiveDoctor === 'function') {
        conSetActiveDoctor(docSel.value);
    }

    updateConFormsPatientLabel();
    conFormsEnsureRichEditor();

    loadConFormsTemplates();
    loadConFormsDoctor(null, true);
    loadConFormsShellSettings();
    if (typeof conFormsSyncReferralHintPanel === 'function') conFormsSyncReferralHintPanel();

    if (conFormsPatientId) {
        searchConFormsDocs();
        if (conFormsSelectedTemplate) {
            var editorWrap = g('conFormsEditorWrap');
            if (editorWrap) editorWrap.style.display = 'block';
            conFormsWhenReadyForPlaceholders(function () {
                conFormsRenderDocumentInEditor(conFormsSelectedTemplate.content || '');
            });
        }
    }
}

function conFormsShowHistCard(show) {
    var c = g('conFormsHistCard');
    if (c) c.style.display = show ? 'block' : 'none';
}

function conFormsEnsureRichEditor() {
    if (conFormsToolbarReady || typeof DocEditor === 'undefined') return;
    var mount = g('conFormsToolbarMount');
    if (!mount) return;
    mount.innerHTML = DocEditor.toolbarHtml('conForms', {});
    DocEditor.init('conFormsDocEditor', {
        toolbarPrefix: 'conForms',
        placeholderText: conTr('con.forms.selectTemplatePh')
    });
    DocEditor.refreshFontSizeLabels('conForms', function (k) { return conTr(k); });
    conFormsToolbarReady = true;
}

function conFormsUpdateEditingBadge() {
    var badge = g('conFormsEditingBadge');
    if (!badge) return;
    if (conFormsEditingDocId) badge.classList.add('is-on');
    else badge.classList.remove('is-on');
}

function conFormsStartNewDoc() {
    conFormsEditingDocId = null;
    conFormsUpdateEditingBadge();
    if (g('conFormsDocName')) g('conFormsDocName').value = '';
    if (g('conFormsTemplateSel')) g('conFormsTemplateSel').value = '';
    conFormsSelectedTemplate = null;
    conFormsSickLeaveFrom = '';
    conFormsSickLeaveTo = '';
    conFormsSickLeaveDxInner = '';
    clearTimeout(conFormsSickLeaveRenderTimer);
    conFormsSickLeaveRenderTimer = null;
    if (typeof conFormsSyncSickLeaveDatePanel === 'function') conFormsSyncSickLeaveDatePanel();
    var wrap = g('conFormsEditorWrap');
    if (wrap) wrap.style.display = 'none';
    if (typeof DocEditor !== 'undefined') {
        DocEditor.setPlaceholder('conFormsDocEditor', conTr('con.forms.selectTemplatePh'));
    } else if (g('conFormsDocEditor')) {
        g('conFormsDocEditor').dataset.placeholderMode = '1';
        refreshConFormsEditorPlaceholder();
    }
}

function conFormsShellPlaceholderMap(c, d, opts) {
    opts = opts || {};
    var map = conFormsPlaceholderMap(opts);
    c = c || conFormsActiveClinicProfile();
    if (opts.forPrint && typeof conFormsActiveDoctorProfileForPrint === 'function') {
        d = conFormsActiveDoctorProfileForPrint();
    } else {
        d = d || conFormsActiveDoctorProfile();
    }
    map.clinic_name = c.nameEn;
    map.clinic_name_chi = c.nameChi;
    map.clinic_address = c.address;
    map.clinic_address_chi = c.addressChi;
    map.clinic_tel = c.tel;
    map.clinic_fax = c.fax;
    map.doctor_eng = d.eng;
    map.doctor_chi = d.chi;
    var dRow = conFormsEffectiveDoctorRow();
    if (typeof doctorQualEnglishHtml === 'function') {
        var qEn = doctorQualEnglishHtml(dRow);
        if (qEn) map.doctor_qualification = qEn;
    }
    if (typeof doctorQualChineseHtml === 'function') {
        var qChi = doctorQualChineseHtml(dRow);
        if (qChi) map.doctor_qualification_chi = qChi;
    }
    return map;
}

function conFormsDefaultHeaderTemplate() {
    return '' +
        '<div data-conforms-default-header="1" style="text-align:center;border-bottom:2px solid #dbe4f0;padding:10px 0 12px;margin-bottom:16px;">' +
            '<div style="font-size:24px;font-weight:800;color:#0f172a;line-height:1.2;">{clinic_name}</div>' +
            '<div style="font-size:20px;font-weight:700;color:#0f172a;line-height:1.25;font-family:PMingLiU,MingLiU,serif;">{clinic_name_chi}</div>' +
            '<div style="font-size:14px;color:#334155;margin-top:4px;line-height:1.4;">{clinic_address}</div>' +
            '<div style="font-size:14px;color:#334155;margin-top:2px;line-height:1.4;font-family:PMingLiU,MingLiU,serif;">{clinic_address_chi}</div>' +
            '<div style="font-size:14px;color:#334155;margin-top:2px;line-height:1.4;">Tel: {clinic_tel}</div>' +
            '<div style="font-size:14px;color:#334155;margin-top:2px;line-height:1.4;">Fax: {clinic_fax}</div>' +
        '</div>';
}

/** Older saved footers may lack qualification placeholders — append at runtime. */
function conFormsNormalizeFooterTemplate(tpl) {
    var s = String(tpl || '').trim();
    if (!s || /\{doctor_qualification_chi\}/i.test(s)) return s;
    var addon = '';
    if (!/\{doctor_qualification\}/i.test(s)) {
        addon += '<div style="margin-top:8px;font-size:13px;font-weight:700;letter-spacing:.2px;line-height:1.35;">{doctor_qualification}</div>';
    }
    addon += '<div style="margin-top:4px;font-size:13px;font-family:PMingLiU,MingLiU,serif;line-height:1.35;">{doctor_qualification_chi}</div>';
    return s + addon;
}

function conFormsDefaultFooterTemplate() {
    return '' +
        '<div data-conforms-default-footer="1" style="margin-top:30px;padding-top:8px;">' +
            '<div style="max-width:400px;">' +
                '<div style="border-bottom:1.5px solid #334155;height:22px;"></div>' +
                '<div style="margin-top:8px;font-size:16px;font-weight:700;color:#0f172a;line-height:1.25;">{doctor_eng}</div>' +
                '<div style="margin-top:3px;font-size:16px;font-weight:700;color:#0f172a;line-height:1.25;font-family:PMingLiU,MingLiU,serif;">{doctor_chi}</div>' +
                '<div style="margin-top:8px;font-size:13px;font-weight:700;letter-spacing:.2px;line-height:1.35;">{doctor_qualification}</div>' +
                '<div style="margin-top:4px;font-size:13px;font-family:PMingLiU,MingLiU,serif;line-height:1.35;">{doctor_qualification_chi}</div>' +
            '</div>' +
        '</div>';
}

function conFormsBindShellSettingsUIOnce() {
    var btn = g('conFormsShellSaveBtn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', conFormsSaveShellSettings);
    var rb = g('conFormsShellResetBtn');
    if (rb && rb.dataset.bound !== '1') {
        rb.dataset.bound = '1';
        rb.addEventListener('click', conFormsResetShellSettings);
    }
    var pb = g('conFormsShellPreviewBtn');
    if (pb && pb.dataset.bound !== '1') {
        pb.dataset.bound = '1';
        pb.addEventListener('click', conFormsToggleShellPreview);
    }
    var h = g('conFormsShellHeaderTpl');
    var f = g('conFormsShellFooterTpl');
    if (h && h.dataset.bound !== '1') {
        h.dataset.bound = '1';
        h.addEventListener('input', function() { if (conFormsShellPreviewOn) conFormsRenderShellPreview(); });
    }
    if (f && f.dataset.bound !== '1') {
        f.dataset.bound = '1';
        f.addEventListener('input', function() { if (conFormsShellPreviewOn) conFormsRenderShellPreview(); });
    }
}

function conFormsSyncShellSettingsUI() {
    var h = g('conFormsShellHeaderTpl');
    var f = g('conFormsShellFooterTpl');
    if (h) h.value = conFormsShellHeaderTpl || conFormsDefaultHeaderTemplate();
    if (f) f.value = conFormsShellFooterTpl || conFormsDefaultFooterTemplate();
}

function conFormsFlushShellWaiters() {
    var list = conFormsShellWaiters.slice();
    conFormsShellWaiters = [];
    list.forEach(function (fn) {
        try { if (typeof fn === 'function') fn(); } catch (e) {}
    });
}

function loadConFormsShellSettings(done) {
    if (typeof done === 'function') conFormsShellWaiters.push(done);

    if (conFormsShellLoaded) {
        conFormsSyncShellSettingsUI();
        conFormsFlushShellWaiters();
        return;
    }
    if (conFormsShellLoading || !SB || typeof SB.from !== 'function') {
        if (!SB || typeof SB.from !== 'function') {
            conFormsShellLoaded = true;
            conFormsFlushShellWaiters();
        }
        return;
    }
    conFormsShellLoading = true;
    SB.from('program_settings')
      .select('setting_key,setting_value')
      .in('setting_key', ['con_forms_header_html', 'con_forms_footer_html'])
    .then(function(r) {
        conFormsShellLoading = false;
        if (!r.error && r.data && r.data.length) {
            var map = {};
            (r.data || []).forEach(function(row) { map[row.setting_key] = row.setting_value || ''; });
            conFormsShellHeaderTpl = String(map.con_forms_header_html || '').trim();
            conFormsShellFooterTpl = conFormsNormalizeFooterTemplate(map.con_forms_footer_html || '');
        }
        conFormsShellLoaded = true;
        conFormsSyncShellSettingsUI();
        conFormsFlushShellWaiters();
    })
    .catch(function() {
        conFormsShellLoading = false;
        conFormsShellLoaded = true;
        conFormsSyncShellSettingsUI();
        conFormsFlushShellWaiters();
    });
}

function conFormsSaveShellSettings() {
    var h = g('conFormsShellHeaderTpl');
    var f = g('conFormsShellFooterTpl');
    var headerTpl = String(h ? h.value : '').trim();
    var footerTpl = String(f ? f.value : '').trim();
    if (!headerTpl) headerTpl = conFormsDefaultHeaderTemplate();
    if (!footerTpl) footerTpl = conFormsDefaultFooterTemplate();

    conFormsShellHeaderTpl = headerTpl;
    conFormsShellFooterTpl = footerTpl;
    conFormsSyncShellSettingsUI();

    if (!SB || typeof SB.from !== 'function') {
        alert(conTr('con.forms.shell.savedLocalOnly'));
        return;
    }
    var persist = (typeof persistProgramSettingRow === 'function')
        ? persistProgramSettingRow
        : null;
    if (!persist) {
        alert(conTrRepl('con.forms.shell.saveFailed', { MSG: 'Database client is not available.' }));
        return;
    }
    Promise.all([
        persist({ setting_key: 'con_forms_header_html', setting_value: headerTpl }),
        persist({ setting_key: 'con_forms_footer_html', setting_value: footerTpl })
    ]).then(function (results) {
        var err = '';
        for (var i = 0; i < results.length; i++) {
            if (results[i] && results[i].error) {
                err = results[i].error.message ? String(results[i].error.message) : String(results[i].error);
                break;
            }
        }
        if (err) {
            alert(conTrRepl('con.forms.shell.saveFailed', { MSG: err }));
            return;
        }
        alert(conTr('con.forms.shell.saved'));
        conFormsRefreshEditorShellDefaults();
        if (conFormsShellPreviewOn) conFormsRenderShellPreview();
    });
}

function conFormsRefreshEditorShellDefaults() {
    var editor = g('conFormsDocEditor');
    if (!editor || editor.dataset.placeholderMode === '1') return;
    editor.innerHTML = conFormsEnsureDefaultShell(editor.innerHTML || '', true);
}

function conFormsResetShellSettings() {
    if (!confirm(conTr('con.forms.shell.resetConfirm'))) return;
    conFormsShellHeaderTpl = conFormsDefaultHeaderTemplate();
    conFormsShellFooterTpl = conFormsDefaultFooterTemplate();
    conFormsSyncShellSettingsUI();
    conFormsRefreshEditorShellDefaults();
    if (conFormsShellPreviewOn) conFormsRenderShellPreview();

    if (!SB || typeof SB.from !== 'function') {
        alert(conTr('con.forms.shell.resetDoneLocal'));
        return;
    }
    var persist = (typeof persistProgramSettingRow === 'function')
        ? persistProgramSettingRow
        : null;
    if (!persist) {
        alert(conTrRepl('con.forms.shell.saveFailed', { MSG: 'Database client is not available.' }));
        return;
    }
    Promise.all([
        persist({ setting_key: 'con_forms_header_html', setting_value: conFormsShellHeaderTpl }),
        persist({ setting_key: 'con_forms_footer_html', setting_value: conFormsShellFooterTpl })
    ]).then(function (results) {
        var err = '';
        for (var i = 0; i < results.length; i++) {
            if (results[i] && results[i].error) {
                err = results[i].error.message ? String(results[i].error.message) : String(results[i].error);
                break;
            }
        }
        if (err) {
            alert(conTrRepl('con.forms.shell.saveFailed', { MSG: err }));
            return;
        }
        alert(conTr('con.forms.shell.resetDone'));
        if (conFormsShellPreviewOn) conFormsRenderShellPreview();
    });
}

function conFormsRenderShellPreview() {
    var area = g('conFormsShellPreviewArea');
    if (!area) return;
    var h = g('conFormsShellHeaderTpl');
    var f = g('conFormsShellFooterTpl');
    var headerTpl = String(h ? h.value : '').trim() || conFormsDefaultHeaderTemplate();
    var footerTpl = String(f ? f.value : '').trim() || conFormsDefaultFooterTemplate();
    var shellMap = conFormsShellPlaceholderMap(null, null, {});
    var headerHtml = conFormsRenderShellTemplate(headerTpl, shellMap);
    var footerHtml = conFormsRenderShellTemplate(footerTpl, shellMap);
    area.innerHTML =
        '<div style="font-size:12px;color:#64748b;font-weight:700;margin-bottom:6px;">' + esc(conTr('con.forms.shell.previewHeader')) + '</div>' +
        headerHtml +
        '<div style="height:8px;"></div>' +
        '<div style="font-size:12px;color:#64748b;font-weight:700;margin:2px 0 6px;">' + esc(conTr('con.forms.shell.previewFooter')) + '</div>' +
        footerHtml;
}

function conFormsToggleShellPreview() {
    conFormsShellPreviewOn = !conFormsShellPreviewOn;
    var area = g('conFormsShellPreviewArea');
    var btn = g('conFormsShellPreviewBtn');
    if (!area || !btn) return;
    area.style.display = conFormsShellPreviewOn ? 'block' : 'none';
    btn.textContent = conFormsShellPreviewOn
        ? conTr('con.forms.shell.previewHideBtn')
        : conTr('con.forms.shell.previewBtn');
    if (conFormsShellPreviewOn) conFormsRenderShellPreview();
}

function conFormsSaveSelection() {
    var editor = g('conFormsDocEditor');
    if (!editor) return;
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel || sel.rangeCount === 0) return;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    conFormsSavedRange = range.cloneRange();
}

function conFormsRestoreSelection() {
    var editor = g('conFormsDocEditor');
    if (!editor) return false;
    if (!conFormsSavedRange) return false;
    var sel = window.getSelection ? window.getSelection() : null;
    if (!sel) return false;
    sel.removeAllRanges();
    sel.addRange(conFormsSavedRange);
    return true;
}

function updateConFormsPatientLabel() {
    var lbl = g('conFormsPatientLabel');
    if (!lbl) return;
    if (!conFormsPatientData) {
        lbl.textContent = '—';
        return;
    }
    lbl.textContent = conTrRepl('con.forms.patientLabel', {
        NAME: conFormsPatientData.full_name || '-',
        NO: conFormsPatientData.patient_no || '-'
    });
}

function doConFormsPatientSearch() {
    runPatientSearchDropdown({
        inputId: 'conFormsPsInput',
        dropId: 'conFormsPsDrop',
        clinicFilterId: 'conFormsPsClinicFilter',
        onSelect: function (p) {
            selectConPatient(p);
            initConForms();
        }
    });
}

function conFormsPatientGenderLabel(sex) {
    var kind = typeof patientSexKind === 'function' ? patientSexKind(sex) : '';
    if (kind === 'male') return conTr('patient.form.sexMale');
    if (kind === 'female') return conTr('patient.form.sexFemale');
    return '';
}

function conFormsPatientAgeShort(dob) {
    var age = typeof patientAgeYears === 'function'
        ? patientAgeYears(dob)
        : null;
    return age == null ? '' : String(age) + 'Y';
}

function conFormsReferralLetterTemplateBodyHtml() {
    if (typeof conTr === 'function') {
        var fromI18n = conTr('cfg.tpl.seed.referralLetterHtml');
        if (fromI18n && fromI18n !== 'cfg.tpl.seed.referralLetterHtml') return fromI18n;
    }
    return '<div data-conforms-referral="1" data-conforms-referral-v="2" class="con-referral-letter-doc" ' +
        'style="font-family:Georgia,\'Times New Roman\',Times,serif;color:#1a1a1a;font-size:15px;line-height:1.65;">' +
        '<p style="margin:0 0 24px;text-align:right;">Date: {date_long}</p>' +
        '<p style="margin:0 0 20px;">Dear {referred_to} ,</p>' +
        '<p style="margin:0 0 20px;">Re: {patient_name_upper} ({patient_chinese_name}), {patient_gender} / {patient_age}</p>' +
        '<p style="margin:0 0 20px;">Please kindly see the above named patient who is suffering from {diagnosis} .</p>' +
        '<p style="margin:0 0 28px;">Please kindly give your expert management.</p>' +
        '<p style="margin:0 0 8px;">Remarks:</p>' +
        '<p data-conforms-ref-remarks="1" style="margin:0 0 28px;min-height:72px;white-space:pre-wrap;"><br><br><br>{remarks}</p>' +
        '<p style="margin:0;">Regards,</p>' +
        '</div>';
}

function conFormsReferralTemplateNeedsRenewal(html) {
    var s = String(html || '');
    if (!/data-conforms-referral/i.test(s)) return true;
    if (!/data-conforms-referral-v="2"/i.test(s)) return true;
    if (conFormsReferralTemplateIsLegacyBox(s)) return true;
    return false;
}

function conFormsReferralTemplateIsLegacyBox(html) {
    var s = String(html || '');
    return /background:\s*#fffef0/i.test(s) ||
        /border:\s*1px solid/i.test(s) ||
        /font-family:\s*Arial/i.test(s);
}

/** Remove embedded doctor signature block; letterhead footer supplies {doctor_eng}, etc. */
function conFormsStripReferralInlineSignature(html) {
    var s = String(html || '').replace(/\s*data-conforms-skip-footer="1"/gi, '');
    if (!/\{doctor_eng\}/i.test(s) &&
        s.indexOf('max-width:420px') < 0 &&
        s.indexOf('max-width:400px') < 0) {
        return s;
    }
    var m = s.match(/([\s\S]*<p[^>]*>Regards,<\/p>)/i);
    if (m && /data-conforms-referral/i.test(s)) {
        return m[1] + '</div>';
    }
    return s;
}

function conFormsNormalizeReferralTemplateContent(content) {
    var raw = String(content || '').trim();
    if (!raw) return conFormsReferralLetterTemplateBodyHtml();
    if (!/data-conforms-referral/i.test(raw)) {
        return conFormsReferralLetterTemplateBodyHtml();
    }
    raw = conFormsStripReferralInlineSignature(raw);
    if (conFormsReferralTemplateNeedsRenewal(raw)) {
        return conFormsReferralLetterTemplateBodyHtml();
    }
    return raw;
}

function conFormsIsReferralTemplate(tpl) {
    if (!tpl) return false;
    var code = String(tpl.template_code || '').trim().toUpperCase();
    if (code === 'REFERRAL_LETTER' || code === 'REFERRAL') return true;
    var name = String(tpl.template_name || '').toLowerCase();
    return name.indexOf('referral') >= 0 || name.indexOf('轉介') >= 0 || name.indexOf('转介') >= 0;
}

function conFormsBuiltinTemplateDefs() {
    return [{
        template_code: 'REFERRAL_LETTER',
        template_name: 'Referral Letter',
        template_type: 'report',
        content: conFormsReferralLetterTemplateBodyHtml()
    }];
}

function conFormsEnsureBuiltinTemplates(cb) {
    if (typeof SB === 'undefined' || !SB || !SB.from) {
        if (cb) cb();
        return;
    }
    var defs = conFormsBuiltinTemplateDefs();
    Promise.all([
        SB.from('doc_templates').select('template_code'),
        SB.from('doc_templates').select('id,template_code,content').eq('template_code', 'REFERRAL_LETTER').limit(1)
    ])
        .then(function (all) {
            var r = all[0];
            var refR = all[1];
            if (r.error) {
                if (cb) cb();
                return;
            }
            var have = {};
            (r.data || []).forEach(function (row) {
                have[String(row.template_code || '').trim().toUpperCase()] = true;
            });
            var tasks = [];
            var refRow = (refR.data && refR.data[0]) ? refR.data[0] : null;
            if (refRow && refRow.id) {
                var norm = conFormsNormalizeReferralTemplateContent(refRow.content || '');
                if (norm !== String(refRow.content || '').trim()) {
                    tasks.push(
                        SB.from('doc_templates').update({ content: norm }).eq('id', refRow.id)
                    );
                }
            }
            var missing = defs.filter(function (d) {
                return !have[String(d.template_code || '').toUpperCase()];
            });
            if (missing.length) {
                var rows = missing.map(function (d) {
                    return {
                        template_code: d.template_code,
                        template_name: d.template_name,
                        template_type: d.template_type,
                        content: d.content,
                        is_active: true
                    };
                });
                tasks.push(SB.from('doc_templates').insert(rows));
            }
            if (!tasks.length) {
                if (cb) cb();
                return;
            }
            return Promise.all(tasks).then(function () {
                if (cb) cb();
            });
        })
        .catch(function () {
            if (cb) cb();
        });
}

function loadConFormsTemplates() {
    refreshConFormsFontSizeSelect();
    var sel = g('conFormsTemplateSel');
    if (sel) sel.innerHTML = '<option value="">' + esc(conTr('con.forms.loadingTemplates')) + '</option>';

    conFormsEnsureBuiltinTemplates(function () {
    SB.from('doc_templates')
      .select('id,template_code,template_name,template_type,content,is_active')
      .order('template_code')
    .then(function(r) {
        if (r.error) {
            if (sel) sel.innerHTML = '<option value="">' + esc(conTr('con.forms.errTemplates')) + '</option>';
            return;
        }
        conFormsTemplates = (r.data || []).filter(function (t) { return t.is_active !== false; }).map(function (t) {
            if (conFormsIsSickLeaveTemplate(t)) {
                var copySl = Object.assign({}, t);
                copySl.content = conFormsNormalizeSickLeaveTemplateContent(t.content || '');
                return copySl;
            }
            if (conFormsIsReferralTemplate(t)) {
                var copyRf = Object.assign({}, t);
                copyRf.content = conFormsNormalizeReferralTemplateContent(t.content || '');
                return copyRf;
            }
            return t;
        });
        if (!sel) return;

        if (!conFormsTemplates.length) {
            sel.innerHTML = '<option value="">' + esc(conTr('con.forms.noTemplates')) + '</option>';
            return;
        }
        sel.innerHTML = '<option value="">' + esc(conTr('con.forms.selectTemplateOpt')) + '</option>' +
            conFormsTemplates.map(function(t) {
                var typeLbl = conDispTplType(t.template_type);
                var label = (t.template_name || t.template_code || conTr('con.forms.fieldTemplate')) +
                    (typeLbl ? ' · ' + typeLbl : '');
                return '<option value="' + esc(t.id) + '">' + esc(label) + '</option>';
            }).join('');
    });
    });
}

var CON_FORMS_DOCTOR_SELECT_BASE =
    'id,doctor_code,english_name,chinese_name,display_name,qualification,is_active,clinic_id';
var CON_FORMS_DOCTOR_SELECT_FULL =
    CON_FORMS_DOCTOR_SELECT_BASE + ',qualification_chinese';

/** Fix common typo 醫學學士 → 醫學士 (extra 學 before 士). */
function conFormsNormalizeQualificationChi(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    s = s.replace(/學學士/g, '學士');
    s = s.replace(/醫學學士/g, '醫學士');
    return s;
}

function conFormsDoctorQualChi(d) {
    d = d || {};
    if (typeof doctorQualChineseDisplay === 'function') {
        return doctorQualChineseDisplay(d);
    }
    return conFormsNormalizeQualificationChi(d.qualification_chinese || d.qualification_chi || '');
}

/** True when a doctor row was fetched with qualification_chinese (even if empty). */
function conFormsDoctorRowQualFieldsLoaded(row) {
    if (!row || typeof row !== 'object') return false;
    return Object.prototype.hasOwnProperty.call(row, 'qualification_chinese') ||
        Object.prototype.hasOwnProperty.call(row, 'qualification_chi');
}

/** Fill missing qualification fields from APP_DOCTORS / consultation cache. */
function conFormsEnrichDoctorRowFromAppCaches(row) {
    if (!row || !row.id) return row || null;
    var out = Object.assign({}, row);
    var id = String(row.id);
    var pick = null;
    if (typeof APP_DOCTORS !== 'undefined' && APP_DOCTORS && APP_DOCTORS.length) {
        for (var i = 0; i < APP_DOCTORS.length; i++) {
            if (String(APP_DOCTORS[i].id) === id) {
                pick = APP_DOCTORS[i];
                break;
            }
        }
    }
    if (!pick && conDoctorsById[id]) pick = conDoctorsById[id];
    if (pick) {
        if (!String(out.qualification || '').trim() && pick.qualification) {
            out.qualification = pick.qualification;
        }
        var chi = pick.qualification_chinese || pick.qualification_chi;
        if (!String(out.qualification_chinese || '').trim() && chi) {
            out.qualification_chinese = chi;
        }
    }
    return out;
}

function conFormsDoctorQualEn(d) {
    d = d || {};
    if (typeof doctorQualEnglishHtml === 'function') {
        return doctorQualEnglishHtml(d).replace(/<br\s*\/?>/gi, '\n');
    }
    var lines = (typeof doctorQualEnglishList === 'function')
        ? doctorQualEnglishList(d)
        : [String(d.qualification || '').trim()].filter(Boolean);
    return lines.map(function (l) { return l.toUpperCase(); }).join('\n');
}

function conFormsResolveActiveDoctorId() {
    if (conActiveDoctorId) return conActiveDoctorId;
    if (typeof currentDoctorId !== 'undefined' && currentDoctorId) return currentDoctorId;
    var sel = g('conDoctorSelect');
    if (sel && sel.value) return sel.value;
    return null;
}

/** Best doctor row for placeholders (loaded profile + consultation cache). */
function conFormsEffectiveDoctorRow() {
    var d = conFormsDoctorData ? Object.assign({}, conFormsDoctorData) : null;
    var id = conFormsResolveActiveDoctorId();
    if (id && conDoctorsById[id]) {
        d = Object.assign({}, conDoctorsById[id], d || {});
    }
    if (id && typeof APP_DOCTORS !== 'undefined' && APP_DOCTORS && APP_DOCTORS.length) {
        for (var i = 0; i < APP_DOCTORS.length; i++) {
            if (String(APP_DOCTORS[i].id) === String(id)) {
                d = Object.assign({}, APP_DOCTORS[i], d || {});
                break;
            }
        }
    }
    return conFormsEnrichDoctorRowFromAppCaches(d || {}) || {};
}

function loadConFormsDoctor(done, forceReload) {
    function finish() {
        updateConsultationDoctorUI();
        if (typeof done === 'function') {
            done();
            return;
        }
        if (conFormsIsSickLeaveTemplate(conFormsSelectedTemplate) &&
            conFormsSickLeaveDatesReady()) {
            conFormsRenderDocumentInEditor();
        } else {
            conFormsRefreshPlaceholdersInEditor();
        }
    }

    function applyRow(row) {
        conFormsDoctorData = conFormsEnrichDoctorRowFromAppCaches(row);
        finish();
    }

    function fetchDoctorById(doctorId, useFullSelect) {
        if (!doctorId) {
            applyRow(null);
            return;
        }
        var selCols = useFullSelect ? CON_FORMS_DOCTOR_SELECT_FULL : CON_FORMS_DOCTOR_SELECT_BASE;
        SB.from('doctors').select(selCols).eq('id', doctorId).single()
        .then(function (r) {
            if (r.error && useFullSelect &&
                /qualification_chinese/i.test(String(r.error.message || ''))) {
                fetchDoctorById(doctorId, false);
                return;
            }
            if (!r.error && r.data) {
                applyRow(r.data);
                return;
            }
            applyRow(conDoctorsById[doctorId] || null);
        })
        .catch(function () {
            applyRow(conDoctorsById[doctorId] || null);
        });
    }

    if (!forceReload && conFormsDoctorData && conFormsDoctorData.id) {
        var idMatch = String(conFormsDoctorData.id) === String(conFormsResolveActiveDoctorId() || '');
        if (idMatch && conFormsDoctorRowQualFieldsLoaded(conFormsDoctorData)) {
            conFormsDoctorData = conFormsEnrichDoctorRowFromAppCaches(conFormsDoctorData);
            finish();
            return;
        }
    }

    var doctorId = conFormsResolveActiveDoctorId();
    if (doctorId) {
        fetchDoctorById(doctorId, true);
        return;
    }

    if (!currentName) {
        applyRow(null);
        return;
    }

    SB.from('doctors').select(CON_FORMS_DOCTOR_SELECT_FULL)
      .eq('english_name', currentName)
      .limit(1)
    .then(function (r) {
        if (r.error && /qualification_chinese/i.test(String(r.error.message || ''))) {
            SB.from('doctors').select(CON_FORMS_DOCTOR_SELECT_BASE)
              .eq('english_name', currentName)
              .limit(1)
            .then(function (r2) {
                if (!r2.error && r2.data && r2.data.length) applyRow(r2.data[0]);
                else applyRow(null);
            })
            .catch(function () { applyRow(null); });
            return;
        }
        if (!r.error && r.data && r.data.length) applyRow(r.data[0]);
        else applyRow(null);
    })
    .catch(function () { applyRow(null); });
}

function conFormsWhenReadyForPlaceholders(cb) {
    var n = 0;
    function tick() {
        n++;
        if (n >= 2 && typeof cb === 'function') cb();
    }
    loadConFormsShellSettings(tick);
    loadConFormsDoctor(tick, true);
}

function conFormsSickLeaveDatesReady() {
    conFormsReadSickLeaveFieldsFromUI();
    return !!(conFormsSickLeaveFrom && conFormsSickLeaveTo);
}

/** Default sick-leave from/to to today when opening the template. */
function conFormsInitSickLeaveDefaults() {
    if (!conFormsIsSickLeaveTemplate(conFormsSelectedTemplate)) return;
    var today = typeof todayISO === 'function' ? todayISO() : '';
    if (!today) return;
    if (!conFormsSickLeaveFrom) conFormsSickLeaveFrom = today;
    if (!conFormsSickLeaveTo) conFormsSickLeaveTo = conFormsSickLeaveFrom;
}

/** When header working date changes, align sick-leave pickers to that date. */
function conFormsApplyWorkingDateToSickLeave() {
    if (!conFormsIsSickLeaveTemplate(conFormsSelectedTemplate)) return;
    var today = typeof todayISO === 'function' ? todayISO() : '';
    if (!today) return;
    conFormsSickLeaveFrom = today;
    conFormsSickLeaveTo = today;
    if (typeof conFormsSyncSickLeaveDatePanel === 'function') {
        conFormsSyncSickLeaveDatePanel();
    }
}

/** Append doctor qualification placeholders to older sick-leave signature blocks. */
function conFormsEnsureSickLeaveSignatureQualPlaceholders(raw) {
    var s = String(raw || '').trim();
    if (!s || /\{doctor_qualification_chi\}/i.test(s)) return s;
    var addon = '';
    if (!/\{doctor_qualification\}/i.test(s)) {
        addon += '<div data-conforms-sick-qual-en="1" style="margin-top:8px;font-size:13px;font-weight:700;letter-spacing:.2px;">{doctor_qualification}</div>';
    }
    addon += '<div data-conforms-sick-qual-chi="1" style="margin-top:4px;font-size:13px;font-family:\'PMingLiU\',\'MingLiU\',serif;">{doctor_qualification_chi}</div>';
    if (/\{doctor_chi\}/i.test(s)) {
        return s.replace(/(\{doctor_chi\}[\s\S]*?<\/div>)/i, '$1' + addon);
    }
    return s + addon;
}

/** Normalize sick-leave template body from DB (ensures {diagnosis} + doctor qual placeholders). */
function conFormsNormalizeSickLeaveTemplateContent(content) {
    var raw = String(content || '').trim();
    if (raw) raw = raw.replace(/\{sick_leave_diagnosis\}/gi, '{diagnosis}');
    if (!raw || !/\{diagnosis\}/i.test(raw)) {
        return conFormsSickLeaveTemplateBodyHtml();
    }
    if (!/\{doctor_qualification_chi\}/i.test(raw)) {
        return conFormsEnsureSickLeaveSignatureQualPlaceholders(raw);
    }
    return raw;
}

/** Use canonical sick-leave HTML when DB template is missing placeholders. */
function conFormsResolveSickLeaveTemplateBody() {
    var tpl = conFormsSelectedTemplate;
    if (!conFormsIsSickLeaveTemplate(tpl)) {
        return String(tpl && tpl.content || '').trim();
    }
    return conFormsNormalizeSickLeaveTemplateContent(tpl && tpl.content);
}

/** New sick-leave certs: preview after from/to dates are set. */
function conFormsShouldGateSickLeaveRender() {
    return conFormsIsSickLeaveTemplate(conFormsSelectedTemplate) && !conFormsEditingDocId;
}

function conFormsScheduleSickLeaveRender() {
    clearTimeout(conFormsSickLeaveRenderTimer);
    conFormsSickLeaveRenderTimer = setTimeout(function () {
        conFormsSickLeaveRenderTimer = null;
        if (!conFormsSelectedTemplate) return;
        if (!conFormsShouldGateSickLeaveRender()) {
            conFormsRefreshPlaceholdersInEditor();
            return;
        }
        if (!conFormsSickLeaveDatesReady()) {
            conFormsSickLeaveShowPendingInEditor();
            return;
        }
        function renderSickLeaveDoc() {
            if (!conFormsSelectedTemplate) return;
            var doctorId = conFormsResolveActiveDoctorId();
            if (doctorId && !conFormsDoctorRowQualFieldsLoaded(conFormsEffectiveDoctorRow())) {
                loadConFormsDoctor(renderSickLeaveDoc, true);
                return;
            }
            conFormsRenderDocumentInEditor();
        }
        renderSickLeaveDoc();
    }, 100);
}

function conFormsSickLeaveShowPendingInEditor() {
    conFormsEnsureRichEditor();
    var msg = conTr('con.forms.sickLeavePendingPh');
    if (typeof DocEditor !== 'undefined') {
        DocEditor.setHtml('conFormsDocEditor', '');
        DocEditor.setPlaceholder('conFormsDocEditor', msg);
    } else if (g('conFormsDocEditor')) {
        g('conFormsDocEditor').dataset.placeholderMode = '1';
        g('conFormsDocEditor').innerHTML =
            '<span style="color:#64748b;">' + esc(msg) + '</span>';
    }
}

function conFormsIsoFromDdMm(ddmm) {
    var s = String(ddmm || '').trim();
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return '';
    var pad2 = function (n) {
        n = parseInt(n, 10);
        return (n < 10 ? '0' : '') + n;
    };
    return m[3] + '-' + pad2(m[2]) + '-' + pad2(m[1]);
}

/** When reopening a saved sick-leave document, restore panel fields from rendered HTML. */
function conFormsHydrateSickLeaveFieldsFromHtml(html) {
    if (!html || !conFormsIsSickLeaveTemplate(conFormsSelectedTemplate)) return;
    var fromM = html.match(/from\s*<strong[^>]*>(\d{1,2}\/\d{1,2}\/\d{4})<\/strong>/i);
    var toM = html.match(/to\s*<strong[^>]*>(\d{1,2}\/\d{1,2}\/\d{4})<\/strong>\s*inclusive/i);
    if (fromM) conFormsSickLeaveFrom = conFormsIsoFromDdMm(fromM[1]);
    if (toM) conFormsSickLeaveTo = conFormsIsoFromDdMm(toM[1]);
    if (typeof conFormsSyncSickLeaveDatePanel === 'function') conFormsSyncSickLeaveDatePanel();
}

function conFormsRenderDocumentInEditor(bodyHtml) {
    if (conFormsIsSickLeaveTemplate(conFormsSelectedTemplate)) {
        conFormsRememberSickLeaveDxFromEditor();
        bodyHtml = conFormsResolveSickLeaveTemplateBody();
    } else if (conFormsIsReferralTemplate(conFormsSelectedTemplate)) {
        bodyHtml = conFormsNormalizeReferralTemplateContent(
            bodyHtml || (conFormsSelectedTemplate && conFormsSelectedTemplate.content) || ''
        );
    }
    if (conFormsShouldGateSickLeaveRender() && !conFormsSickLeaveDatesReady()) {
        conFormsSickLeaveShowPendingInEditor();
        return;
    }
    conFormsEnsureRichEditor();
    var body = applyConFormsPlaceholders(bodyHtml || '');
    if (conFormsIsSickLeaveTemplate(conFormsSelectedTemplate)) {
        body = conFormsRestoreSickLeaveDxInHtml(body);
    }
    var html = conFormsEnsureDefaultShell(body, true);
    html = applyConFormsPlaceholders(html);
    if (typeof DocEditor !== 'undefined') {
        DocEditor.setHtml('conFormsDocEditor', html || '');
        if (!html) DocEditor.setPlaceholder('conFormsDocEditor', conTr('con.forms.selectTemplatePh'));
    } else if (g('conFormsDocEditor')) {
        g('conFormsDocEditor').dataset.placeholderMode = html ? '' : '1';
        g('conFormsDocEditor').innerHTML = html || '<span style="color:#aaa;">' + esc(conTr('con.forms.selectTemplatePh')) + '</span>';
    }
}

/** Re-fill header/footer/body placeholders (e.g. after doctor or shell settings load). */
function conFormsRefreshPlaceholdersInEditor() {
    var editorWrap = g('conFormsEditorWrap');
    if (!editorWrap || editorWrap.style.display === 'none') return;

    if (conFormsSelectedTemplate) {
        if (conFormsShouldGateSickLeaveRender() && !conFormsSickLeaveDatesReady()) {
            conFormsSickLeaveShowPendingInEditor();
            return;
        }
        conFormsRenderDocumentInEditor();
        return;
    }

    var editor = g('conFormsDocEditor');
    if (!editor || editor.dataset.placeholderMode === '1') return;
    var raw = (typeof DocEditor !== 'undefined')
        ? DocEditor.getHtml('conFormsDocEditor')
        : editor.innerHTML;
    if (!String(raw || '').trim()) return;

    var root = document.createElement('div');
    root.innerHTML = raw;
    conFormsStripShellBlocks(root);
    var bodyInner = root.innerHTML;
    var html = conFormsEnsureDefaultShell(bodyInner, true);
    html = applyConFormsPlaceholders(html);
    if (typeof DocEditor !== 'undefined') DocEditor.setHtml('conFormsDocEditor', html);
    else editor.innerHTML = html;
}

function conFormsIsSickLeaveTemplate(tpl) {
    if (!tpl) return false;
    var code = String(tpl.template_code || '').trim().toUpperCase();
    if (code === 'SICK_LEAVE' || code === 'SICKLEAVE') return true;
    var name = String(tpl.template_name || '').toLowerCase();
    return name.indexOf('sick leave') >= 0 ||
        name.indexOf('sick-leave') >= 0 ||
        name.indexOf('病假') >= 0;
}

function conFormsDateLongZh(iso) {
    if (!iso || typeof parseISODateOnly !== 'function') return '';
    var d = parseISODateOnly(iso);
    if (!d || isNaN(d.getTime())) return '';
    return d.toLocaleDateString('zh-HK', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function conFormsFormatDateDdMm(iso) {
    if (!iso || typeof parseISODateOnly !== 'function') return '';
    var d = parseISODateOnly(iso);
    if (!d || isNaN(d.getTime())) return '';
    var pad2 = function (n) {
        n = parseInt(n, 10);
        return (n < 10 ? '0' : '') + n;
    };
    return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
}

/** Spaced CJK name: 陳慧儀 → 陳 慧 儀 (reference letter style). */
function conFormsChineseNameSpaced(name) {
    var s = String(name || '').trim();
    if (!s) return '';
    var out = [];
    var i;
    for (i = 0; i < s.length; i++) {
        var ch = s.charAt(i);
        if (ch.trim()) out.push(ch);
    }
    return out.join(' ');
}

function conFormsReadSickLeaveFieldsFromUI() {
    var f = g('conFormsSickLeaveFrom');
    var t = g('conFormsSickLeaveTo');
    conFormsSickLeaveFrom = f ? String(f.value || '').trim() : '';
    conFormsSickLeaveTo = t ? String(t.value || '').trim() : '';
    if (conFormsSickLeaveFrom && conFormsSickLeaveTo && conFormsSickLeaveTo < conFormsSickLeaveFrom) {
        conFormsSickLeaveTo = conFormsSickLeaveFrom;
        if (t) t.value = conFormsSickLeaveTo;
    }
}

/** Preserve centred diagnosis line when sick-leave dates trigger a re-render. */
function conFormsCaptureSickLeaveDxInnerFromEditor() {
    var raw = '';
    if (typeof DocEditor !== 'undefined') {
        raw = DocEditor.getHtml('conFormsDocEditor');
    } else if (g('conFormsDocEditor')) {
        raw = g('conFormsDocEditor').innerHTML;
    }
    if (!String(raw || '').trim()) return '';
    var root = document.createElement('div');
    root.innerHTML = raw;
    var el = root.querySelector('[data-conforms-sick-dx]');
    if (!el) return '';
    var inner = String(el.innerHTML || '').trim();
    var t = String(el.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (!t || t === '<DIAGNOSIS>') return '';
    if (/^\{diagnosis\}$/i.test(t) || /^\{sick_leave_diagnosis\}$/i.test(t)) return '';
    return inner;
}

function conFormsRememberSickLeaveDxFromEditor() {
    var inner = conFormsCaptureSickLeaveDxInnerFromEditor();
    if (inner) conFormsSickLeaveDxInner = inner;
}

function conFormsRestoreSickLeaveDxInHtml(html) {
    if (!conFormsSickLeaveDxInner) return html;
    var root = document.createElement('div');
    root.innerHTML = html;
    var el = root.querySelector('[data-conforms-sick-dx]');
    if (el) el.innerHTML = conFormsSickLeaveDxInner;
    return root.innerHTML;
}

function conFormsSickLeaveTemplateBodyHtml() {
    return '<div data-conforms-sick-leave="1" data-conforms-skip-footer="1" class="con-sick-leave-doc" ' +
        'style="font-family:Georgia,\'Times New Roman\',Times,serif;color:#1a1a1a;font-size:15px;line-height:1.65;">' +
        '<div style="text-align:right;margin:16px 0 20px;">{date_long}</div>' +
        '<p style="margin:0 0 14px;"><em><strong>To Whom It May Concern</strong></em></p>' +
        '<p style="margin:0 0 6px;">This is to certify that <strong>{patient_name_upper}</strong> is suffering from</p>' +
        '<p style="margin:0 0 6px;font-family:\'PMingLiU\',\'MingLiU\',serif;">茲　證　明　{patient_chinese_name_spaced}　因　患　上</p>' +
        '<p data-conforms-sick-dx="1" style="margin:14px 0;text-align:center;font-style:italic;font-size:15px;">{diagnosis}</p>' +
        '<p style="margin:0 0 6px;">is unfit for work and is recommended <strong>{sick_leave_days}</strong> day(s) sick leave</p>' +
        '<p style="margin:0 0 6px;font-family:\'PMingLiU\',\'MingLiU\',serif;">故　不　宜　工　作　及　需　要　病　假　休　息　<strong>{sick_leave_days}</strong>　天</p>' +
        '<p style="margin:0 0 6px;">from <strong>{sick_leave_from_ddmm}</strong> to <strong>{sick_leave_to_ddmm}</strong> inclusive.</p>' +
        '<p style="margin:0 0 20px;font-family:\'PMingLiU\',\'MingLiU\',serif;">由　<strong>{sick_leave_from_ddmm}</strong>　至　<strong>{sick_leave_to_ddmm}</strong>　止。</p>' +
        '<div style="margin-top:72px;max-width:400px;">' +
        '<div style="border-bottom:1.5px solid #334155;height:24px;margin-bottom:10px;"></div>' +
        '<div style="font-size:16px;font-weight:700;line-height:1.3;">{doctor_eng}</div>' +
        '<div style="margin-top:4px;font-size:16px;font-weight:700;line-height:1.3;font-family:\'PMingLiU\',\'MingLiU\',serif;">{doctor_chi}</div>' +
        '<div data-conforms-sick-qual-en="1" style="margin-top:8px;font-size:13px;font-weight:700;letter-spacing:.2px;">{doctor_qualification}</div>' +
        '<div data-conforms-sick-qual-chi="1" style="margin-top:4px;font-size:13px;font-family:\'PMingLiU\',\'MingLiU\',serif;">{doctor_qualification_chi}</div>' +
        '</div></div>';
}

function conFormsSickLeavePlaceholderFields() {
    var from = conFormsSickLeaveFrom;
    var to = conFormsSickLeaveTo || from;
    if (to < from) to = from;
    var dFrom = typeof parseISODateOnly === 'function' ? parseISODateOnly(from) : null;
    var dTo = typeof parseISODateOnly === 'function' ? parseISODateOnly(to) : null;
    var days = 1;
    if (dFrom && dTo) {
        days = Math.round((dTo.getTime() - dFrom.getTime()) / 86400000) + 1;
        if (days < 1) days = 1;
    }
    var fromLong = dFrom ? conFormsDateLongEn(dFrom) : '';
    var toLong = dTo ? conFormsDateLongEn(dTo) : '';
    var fromDdmm = conFormsFormatDateDdMm(from);
    var toDdmm = conFormsFormatDateDdMm(to);
    var periodEn = from === to
        ? 'on ' + fromLong
        : 'from ' + fromLong + ' to ' + toLong + ' (inclusive)';
    var periodChi = from === to
        ? ('於' + conFormsDateLongZh(from))
        : ('由' + conFormsDateLongZh(from) + '至' + conFormsDateLongZh(to) + '（包含首尾兩日）');
    var p = conFormsPatientData || {};
    var chiName = String(p.chinese_name || '').trim() || String(p.full_name || '').trim();
    return {
        sick_leave_from: from,
        sick_leave_to: to,
        sick_leave_from_long: fromLong,
        sick_leave_to_long: toLong,
        sick_leave_from_ddmm: fromDdmm,
        sick_leave_to_ddmm: toDdmm,
        sick_leave_days: String(days),
        sick_leave_period_en: periodEn,
        sick_leave_period_chi: periodChi,
        patient_chinese_name_spaced: conFormsChineseNameSpaced(chiName)
    };
}

function conFormsSyncSickLeaveDatePanel() {
    var panel = g('conFormsSickLeaveDates');
    if (!panel) return;
    var show = conFormsIsSickLeaveTemplate(conFormsSelectedTemplate);
    panel.style.display = show ? 'grid' : 'none';
    panel.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (!show) return;
    conFormsInitSickLeaveDefaults();
    var fromEl = g('conFormsSickLeaveFrom');
    var toEl = g('conFormsSickLeaveTo');
    if (fromEl) fromEl.value = conFormsSickLeaveFrom || '';
    if (toEl) toEl.value = conFormsSickLeaveTo || '';
}

function conFormsSyncReferralHintPanel() {
    var hint = g('conFormsReferralHint');
    if (!hint) return;
    var show = conFormsIsReferralTemplate(conFormsSelectedTemplate);
    hint.style.display = show ? 'block' : 'none';
    hint.setAttribute('aria-hidden', show ? 'false' : 'true');
}

function conFormsOnSickLeaveDateChange() {
    conFormsReadSickLeaveFieldsFromUI();
    conFormsScheduleSickLeaveRender();
}

function onConFormsTemplateChange() {
    var sel = g('conFormsTemplateSel');
    var editorWrap = g('conFormsEditorWrap');
    if (!sel || !editorWrap) return;

    var id = sel.value || '';
    if (!id) {
        editorWrap.style.display = 'none';
        conFormsSelectedTemplate = null;
        if (typeof conFormsSyncSickLeaveDatePanel === 'function') conFormsSyncSickLeaveDatePanel();
        if (typeof conFormsSyncReferralHintPanel === 'function') conFormsSyncReferralHintPanel();
        return;
    }
    conFormsEditingDocId = null;
    conFormsUpdateEditingBadge();

    conFormsSelectedTemplate = conFormsTemplates.find(function(t) { return t.id === id; }) || null;
    if (!conFormsSelectedTemplate) {
        editorWrap.style.display = 'none';
        if (typeof conFormsSyncSickLeaveDatePanel === 'function') conFormsSyncSickLeaveDatePanel();
        if (typeof conFormsSyncReferralHintPanel === 'function') conFormsSyncReferralHintPanel();
        return;
    }

    if (g('conFormsDocName') && !g('conFormsDocName').value) {
        g('conFormsDocName').value = conFormsSelectedTemplate.template_name || '';
    }

    if (conFormsIsSickLeaveTemplate(conFormsSelectedTemplate)) {
        conFormsInitSickLeaveDefaults();
    }

    if (typeof conFormsSyncSickLeaveDatePanel === 'function') conFormsSyncSickLeaveDatePanel();
    if (typeof conFormsSyncReferralHintPanel === 'function') conFormsSyncReferralHintPanel();

    editorWrap.style.display = 'block';
    conFormsWhenReadyForPlaceholders(function () {
        if (!conFormsSelectedTemplate) return;
        if (conFormsIsSickLeaveTemplate(conFormsSelectedTemplate)) {
            conFormsScheduleSickLeaveRender();
        } else {
            conFormsRenderDocumentInEditor(conFormsSelectedTemplate.content || '');
        }
        setTimeout(function () {
            if (typeof DocEditor !== 'undefined') DocEditor.focusEditor('conFormsDocEditor');
            else if (g('conFormsDocEditor')) g('conFormsDocEditor').focus();
        }, 0);
    });
}

var CON_TPL_TYPE_PAIRS = [
    ['receipt', 'cfg.tpl.typeReceipt'],
    ['prescription', 'cfg.tpl.typePrescription'],
    ['consent', 'cfg.tpl.typeConsent'],
    ['report', 'cfg.tpl.typeReport']
];

function conDispTplType(raw) {
    var s = String(raw || '').trim().toLowerCase();
    if (!s) return '';
    var i;
    for (i = 0; i < CON_TPL_TYPE_PAIRS.length; i++) {
        if (CON_TPL_TYPE_PAIRS[i][0] === s) return conTr(CON_TPL_TYPE_PAIRS[i][1]);
    }
    return String(raw || '').trim();
}

function conFormsDateLongEn(d) {
    d = d || (typeof nowLocal === 'function' ? nowLocal() : new Date());
    if (!d || isNaN(d.getTime())) return '';
    var day = d.getDate();
    var mon = d.toLocaleDateString('en-GB', { month: 'long' });
    var yr = d.getFullYear();
    return day + ' ' + mon + ', ' + yr;
}

function conFormsTimeOfDayPair(d) {
    d = d || (typeof nowLocal === 'function' ? nowLocal() : new Date());
    var h = d.getHours();
    if (h < 12) return { en: 'morning', chi: '上午' };
    if (h < 18) return { en: 'afternoon', chi: '下午' };
    return { en: 'evening', chi: '晚上' };
}

function conFormsPlaceholderMap(opts) {
    opts = opts || {};
    var p = conFormsPatientData || {};
    var d = conFormsEffectiveDoctorRow();
    var clinic = conFormsActiveClinicProfile();
    var docProf = (opts.forPrint && typeof conFormsActiveDoctorProfileForPrint === 'function')
        ? conFormsActiveDoctorProfileForPrint()
        : conFormsActiveDoctorProfile();
    var now = typeof nowLocal === 'function' ? nowLocal() : new Date();
    var tod = conFormsTimeOfDayPair(now);
    var qualEnLines = (typeof doctorQualEnglishList === 'function')
        ? doctorQualEnglishList(d)
        : [String(d.qualification || '').trim()].filter(Boolean);
    var qualEnHtml = (typeof doctorQualEnglishHtml === 'function')
        ? doctorQualEnglishHtml(d)
        : qualEnLines.map(function (l) {
            return (typeof esc === 'function' ? esc(l) : l).toUpperCase();
        }).join('<br>');
    var qualChiHtml = (typeof doctorQualChineseHtml === 'function')
        ? doctorQualChineseHtml(d)
        : (function () {
            var t = conFormsDoctorQualChi(d);
            if (!t) return '';
            return (typeof esc === 'function' ? esc(t) : t).replace(/\n/g, '<br>');
        })();
    var qualChi = conFormsDoctorQualChi(d);
    var map = {
        patient_no: p.patient_no || '',
        patient_name: p.full_name || '',
        patient_name_upper: String(p.full_name || '').trim().toUpperCase(),
        patient_chinese_name: p.chinese_name || '',
        patient_phone: p.phone_number || '',
        patient_hkid: p.hkid || '',
        patient_dob: p.dob || '',
        patient_email: p.email || '',
        patient_address: p.address || '',
        patient_gender: conFormsPatientGenderLabel(p.sex),
        patient_age: conFormsPatientAgeShort(p.dob),
        doctor_name: (typeof printDoctorDisplayName === 'function')
            ? printDoctorDisplayName({
                doctor_id: conActiveDoctorId,
                doctor_name: conActiveDoctorName || d.english_name || currentName,
                doctor_tag: conActiveDoctorTag
            }, printUiLangIsChinese() ? 'zh' : 'en', d)
            : (conActiveDoctorName || d.english_name || currentName || ''),
        doctor_code: d.doctor_code || '',
        doctor_eng: docProf.eng,
        doctor_chi: docProf.chi,
        doctor_qualification: qualEnHtml,
        doctor_qualification_chi: qualChiHtml,
        clinic_name: clinic.nameEn,
        clinic_name_chi: clinic.nameChi,
        clinic_address: clinic.address,
        clinic_address_chi: clinic.addressChi,
        clinic_tel: clinic.tel,
        clinic_fax: clinic.fax,
        date: typeof todayISO === 'function' ? todayISO() : '',
        date_long: conFormsDateLongEn(now),
        time: now.toLocaleTimeString(conUiLocale(), { hour: '2-digit', minute: '2-digit' }),
        time_of_day_en: tod.en,
        time_of_day_chi: tod.chi,
        receipt_no: '',
        total_amount: ''
    };
    if (conFormsIsSickLeaveTemplate(conFormsSelectedTemplate)) {
        var sl = conFormsSickLeavePlaceholderFields();
        var sk;
        for (sk in sl) {
            if (Object.prototype.hasOwnProperty.call(sl, sk)) map[sk] = sl[sk];
        }
    }
    return map;
}

function applyConFormsPlaceholders(html, opts) {
    return conFormsRenderShellTemplate(html, conFormsPlaceholderMap(opts));
}

/** Shell + any remaining tags filled for print (header/footer letterhead). */
function conFormsPreparePrintHtml(html, refreshDefaults) {
    html = conFormsEnsureDefaultShell(html || '', !!refreshDefaults, { forPrint: true });
    return applyConFormsPlaceholders(html, { forPrint: true });
}

function conFormsActiveClinicProfile() {
    var rec = null;
    if (typeof clinicRecordFromId === 'function' && currentClinicId) {
        rec = clinicRecordFromId(currentClinicId);
    }
    if (!rec) {
        var sel = g('appWorkingClinicSelect');
        var selVal = sel ? String(sel.value || '').trim() : '';
        if (typeof isWorkingClinicAllValue === 'function' && isWorkingClinicAllValue(selVal)) {
            selVal = '';
        }
        if (selVal && typeof clinicRecordFromId === 'function') {
            rec = clinicRecordFromId(selVal);
        }
    }
    if (!rec &&
        typeof currentClinicCodeForTagging === 'function' &&
        typeof APP_CLINICS !== 'undefined' &&
        APP_CLINICS && APP_CLINICS.length) {
        var code = String(currentClinicCodeForTagging() || '').trim();
        if (code) {
            for (var i = 0; i < APP_CLINICS.length; i++) {
                var c = APP_CLINICS[i];
                if (String(c.id || '') === code || String(c.clinic_code || '') === code) {
                    rec = c;
                    break;
                }
            }
        }
    }
    var nameEn = '';
    var nameChi = '';
    var addr = '';
    var addrChi = '';
    var tel = '';
    var fax = '';
    if (rec) {
        nameEn = String(rec.english_name || '').trim();
        nameChi = String(rec.chinese_name || '').trim();
        if (!nameEn && !nameChi) {
            nameEn = String(rec.clinic_code || '').trim();
        }
        addr = String(rec.address || '').trim();
        addrChi = String(rec.address_chinese || rec.chinese_address || '').trim();
        tel = String(rec.tel || '').trim();
        fax = String(rec.fax || '').trim();
    }
    if (!nameEn && !nameChi && typeof currentClinicLabel === 'string') {
        nameEn = String(currentClinicLabel).trim();
    }
    if (!nameEn && !nameChi) nameEn = 'Clinic';
    return {
        name: nameEn,
        nameEn: nameEn,
        nameChi: nameChi || nameEn,
        address: addr || '—',
        addressChi: addrChi || '—',
        tel: tel || '—',
        fax: fax || '—'
    };
}

function conFormsActiveDoctorProfile() {
    var d = conFormsDoctorData || {};
    var eng = String(d.english_name || d.display_name || conActiveDoctorName || currentName || '').trim();
    var chi = String(d.chinese_name || '').trim();
    if (!eng) eng = 'Doctor';
    if (!/^dr\b\.?/i.test(eng)) eng = 'Dr ' + eng;
    if (!chi) chi = '—';
    if (chi !== '—' && chi.indexOf('牙科醫生') < 0) chi += ' 牙科醫生';
    return { eng: eng, chi: chi };
}

/** Doctor lines for printed forms — one name only; Chinese print uses Chinese name. */
function conFormsActiveDoctorProfileForPrint() {
    var src = {
        doctor_id: conActiveDoctorId,
        doctor_name: conActiveDoctorName,
        doctor_tag: conActiveDoctorTag
    };
    var d = conFormsDoctorData || {};
    if (typeof printDoctorDisplayName === 'function') {
        if (printUiLangIsChinese()) {
            return {
                eng: '',
                chi: printDoctorDisplayName(src, 'zh', d)
            };
        }
        return {
            eng: printDoctorDisplayName(src, 'en', d),
            chi: ''
        };
    }
    var prof = conFormsActiveDoctorProfile();
    if (printUiLangIsChinese()) {
        return { eng: '', chi: prof.chi };
    }
    return { eng: prof.eng, chi: '' };
}

function conFormsDefaultHeaderHtml(opts) {
    opts = opts || {};
    var c = conFormsActiveClinicProfile();
    var d = opts.forPrint ? conFormsActiveDoctorProfileForPrint() : conFormsActiveDoctorProfile();
    return conFormsRenderShellTemplate(
        conFormsShellHeaderTpl || conFormsDefaultHeaderTemplate(),
        conFormsShellPlaceholderMap(c, d, opts)
    );
}

function conFormsDefaultFooterHtml(opts) {
    opts = opts || {};
    var d = opts.forPrint ? conFormsActiveDoctorProfileForPrint() : conFormsActiveDoctorProfile();
    var c = conFormsActiveClinicProfile();
    return conFormsRenderShellTemplate(
        conFormsShellFooterTpl || conFormsDefaultFooterTemplate(),
        conFormsShellPlaceholderMap(c, d, opts)
    );
}

var CON_FORMS_RAW_HTML_PLACEHOLDERS = {
    doctor_qualification: true,
    doctor_qualification_chi: true
};

function conFormsRenderShellTemplate(tpl, map) {
    if (typeof replaceDocumentPlaceholders === 'function') {
        return replaceDocumentPlaceholders(tpl, map);
    }
    var out = String(tpl || '');
    var data = map || {};
    var keys = Object.keys(data).sort(function (a, b) {
        return b.length - a.length;
    });
    keys.forEach(function (k) {
        var re = new RegExp('\\{' + k.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\}', 'gi');
        var val = data[k] == null ? '' : data[k];
        if (!CON_FORMS_RAW_HTML_PLACEHOLDERS[k] && typeof esc === 'function') {
            val = esc(val);
        }
        out = out.replace(re, function () { return String(val); });
    });
    return out;
}

function conFormsWrapShellPart(kind, innerHtml) {
    return '<div data-conforms-shell-' + kind + '="1">' + (innerHtml || '') + '</div>';
}

function conFormsStripShellBlocks(root) {
    if (!root) return;
    ['header', 'footer'].forEach(function (kind) {
        root.querySelectorAll('[data-conforms-shell-' + kind + ']').forEach(function (n) { n.remove(); });
        root.querySelectorAll('[data-conforms-default-' + kind + ']').forEach(function (n) { n.remove(); });
    });
}

function conFormsEnsureDefaultShell(html, refreshDefaults, opts) {
    opts = opts || {};
    var root = document.createElement('div');
    root.innerHTML = String(html || '');
    if (refreshDefaults) {
        conFormsStripShellBlocks(root);
    }
    if (!root.querySelector('[data-conforms-shell-header]') &&
        !root.querySelector('[data-conforms-default-header]')) {
        root.insertAdjacentHTML('afterbegin', conFormsWrapShellPart('header', conFormsDefaultHeaderHtml(opts)));
    }
    if (!root.querySelector('[data-conforms-shell-footer]') &&
        !root.querySelector('[data-conforms-default-footer]') &&
        !root.querySelector('[data-conforms-skip-footer]')) {
        root.insertAdjacentHTML('beforeend', conFormsWrapShellPart('footer', conFormsDefaultFooterHtml(opts)));
    }
    return root.innerHTML;
}

function conFormsCmd(cmd) {
    if (typeof DocEditor !== 'undefined') DocEditor.exec('conFormsDocEditor', cmd);
}

function conFormsFontName(name) {
    if (typeof DocEditor !== 'undefined') DocEditor.exec('conFormsDocEditor', 'fontName', name);
}

function refreshConFormsToolbarI18n() {
    if (typeof DocEditor !== 'undefined') {
        DocEditor.refreshFontSizeLabels('conForms', function (k) { return conTr(k); });
    }
}

function refreshConFormsEditorPlaceholder() {
    var editor = g('conFormsDocEditor');
    if (!editor) return;
    if (editor.dataset.placeholderMode === '1') {
        editor.innerHTML = '<span style="color:#aaa;">' + esc(conTr('con.forms.selectTemplatePh')) + '</span>';
    }
}

function conFormsClearPlaceholderIfNeeded(editor) {
    editor = editor || g('conFormsDocEditor');
    if (!editor || editor.dataset.placeholderMode !== '1') return;
    editor.dataset.placeholderMode = '';
    editor.innerHTML = '';
}

function conFormsInitEditorEvents() {
    var editor = g('conFormsDocEditor');
    if (!editor || editor.dataset.conFormsEvInit === '1') return;
    editor.dataset.conFormsEvInit = '1';
    editor.addEventListener('focus', function () {
        conFormsClearPlaceholderIfNeeded(editor);
    });
    editor.addEventListener('input', function () {
        if (editor.dataset.placeholderMode === '1') {
            conFormsClearPlaceholderIfNeeded(editor);
        }
    });
}

function refreshConFormsFontSizeSelect() {
    var sel = g('conFormsFontSize');
    if (!sel) return;
    var prev = sel.value || '3';
    var sizes = [
        { v: '2', k: 'con.forms.fontSizeSmall' },
        { v: '3', k: 'con.forms.fontSizeNormal' },
        { v: '4', k: 'con.forms.fontSizeLarge' },
        { v: '5', k: 'con.forms.fontSizeXLarge' }
    ];
    sel.innerHTML = sizes.map(function(s) {
        return '<option value="' + s.v + '">' + esc(conTr(s.k)) + '</option>';
    }).join('');
    var has = false;
    for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === prev) { has = true; break; }
    }
    sel.value = has ? prev : '3';
}

function conFormsFontSize(size) {
    if (typeof DocEditor !== 'undefined') DocEditor.exec('conFormsDocEditor', 'fontSize', String(size));
}

function conFormsForeColor(color) {
    if (typeof DocEditor !== 'undefined') DocEditor.exec('conFormsDocEditor', 'foreColor', color);
}

function conFormsInsertTag(tag) {
    if (typeof DocEditor !== 'undefined') DocEditor.insertText('conFormsDocEditor', tag);
}

function saveConFormsDoc(andPrint) {
    if (!conFormsPatientId || !conFormsPatientData) {
        alert(conTr('con.forms.alertSelectPatient'));
        return;
    }
    var sel = g('conFormsTemplateSel');
    if (!sel || !sel.value) {
        alert(conTr('con.forms.alertSelectTemplate'));
        return;
    }

    var docName = (g('conFormsDocName') ? g('conFormsDocName').value : '').trim();
    if (!docName) {
        alert(conTr('con.forms.alertDocName'));
        return;
    }

    if (conFormsIsSickLeaveTemplate(conFormsSelectedTemplate) && !conFormsSickLeaveDatesReady()) {
        alert(conTr('con.forms.alertSickLeaveDates'));
        return;
    }

    var html = (typeof DocEditor !== 'undefined')
        ? DocEditor.getHtml('conFormsDocEditor')
        : (g('conFormsDocEditor') ? g('conFormsDocEditor').innerHTML : '').trim();
    if (!html) {
        alert(conTr('con.forms.alertEmpty'));
        return;
    }
    html = conFormsEnsureDefaultShell(html, true);
    if (typeof DocEditor !== 'undefined') DocEditor.setHtml('conFormsDocEditor', html);
    else if (g('conFormsDocEditor')) g('conFormsDocEditor').innerHTML = html;

    var t = conFormsSelectedTemplate || {};
    var payload = {
        patient_id: conFormsPatientId,
        patient_no: conFormsPatientData.patient_no || null,
        patient_name: conFormsPatientData.full_name || null,
        doctor_name: (conFormsDoctorData && conFormsDoctorData.english_name) || currentName || null,
        template_id: t.id || null,
        template_code: t.template_code || null,
        template_name: t.template_name || null,
        template_type: t.template_type || null,
        document_name: docName,
        document_date: todayISO(),
        content_html: html
    };

    var wasEdit = !!conFormsEditingDocId;
    var op = wasEdit
        ? SB.from('patient_documents').update(payload).eq('id', conFormsEditingDocId)
        : SB.from('patient_documents').insert([payload]).select('id');

    op.then(function(r) {
        if (r.error) {
            alert(conTrRepl('con.forms.alertSaveFailed', { MSG: r.error.message }));
            return;
        }
        alert(conTr(wasEdit ? 'con.forms.updatedOk' : 'con.forms.savedOk'));
        if (!wasEdit && r.data && r.data[0] && r.data[0].id) {
            conFormsEditingDocId = r.data[0].id;
        }
        conFormsUpdateEditingBadge();
        searchConFormsDocs();
        conSchedulePatientTimelineRefresh(conPatientId);
        if (andPrint) {
            printConFormsHtml(conFormsPreparePrintHtml(html, false));
        }
    });
}

function printConFormsHtml(html) {
    if (typeof confirmPrintReminder === 'function' && !confirmPrintReminder()) return;
    var cid = (typeof currentClinicId !== 'undefined' && currentClinicId)
        ? String(currentClinicId) : '';

    var sheetCss =
        '@page{margin:15mm 15mm 15mm 15mm;size:210mm 297mm;}' +
        'html{background:#d4d4d4;}' +
        'body{font-family:"Segoe UI",Arial,sans-serif;margin:0;color:#111;font-size:13px;line-height:1.45;' +
            'background:#d4d4d4;}' +
        '.print-sheet-outer{' +
            'box-sizing:border-box;width:210mm;min-height:297mm;' +
            'padding:15mm;margin:14px auto;background:#fff;' +
            'box-shadow:0 4px 28px rgba(0,0,0,.22);}' +
        '@media print{' +
            'html,body{background:#fff!important;color:#111!important;' +
            'print-color-adjust:economy!important;-webkit-print-color-adjust:economy!important;}' +
            '.print-sheet-outer{' +
                'width:auto!important;min-height:0!important;margin:0!important;' +
                'padding:0!important;box-shadow:none!important;background:#fff!important;' +
                'print-color-adjust:economy!important;-webkit-print-color-adjust:economy!important;}' +
        '}';
    var popW = 900;
    var popH = 760;

    if (typeof CFG !== 'undefined' && CFG) {
        if (typeof CFG.prefetchPrintSettings === 'function') {
            CFG.prefetchPrintSettings(cid);
        }
        if (CFG.getPrintSettingsForDoc && CFG.buildPrintSheetStylesCss && CFG.estimatePrintPopupSizePx) {
            var lettersRow = CFG.getPrintSettingsForDoc('letters', cid);
            sheetCss = CFG.buildPrintSheetStylesCss(lettersRow);
            var wh = CFG.estimatePrintPopupSizePx(lettersRow);
            popW = wh.width;
            popH = wh.height;
        }
    }

    var popup = window.open('', '_blank',
        'width=' + popW + ',height=' + popH + ',scrollbars=1,resizable=1,toolbar=0,menubar=0'
    );
    if (!popup) {
        alert(conTr('con.alert.popupBlocked'));
        return;
    }
    popup.document.write(
        '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<title>' + esc(conTr('con.forms.printDocTitle')) + '</title>' +
        '<style>' + sheetCss +
        'body{font-family:"Segoe UI",Arial,sans-serif;}' +
        '.print-sheet-outer img,.print-sheet-outer table{max-width:100%;}</style>' +
        '</head><body>' +
        '<div class="print-sheet-outer">' +
        (html || '') +
        '</div>' +
        '<script>(function(){' +
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
        (typeof printPopupAutoCloseInlineScript === 'function'
            ? printPopupAutoCloseInlineScript()
            : '') +
        'window.onload=function(){' +
        'try{fitPageRatio();}catch(e0){}' +
        'setTimeout(function(){try{window.print();}catch(e2){if(typeof __ppClose==="function")__ppClose();}},260);' +
        '};' +
        '})();<\/script>' +
        '</body></html>'
    );
    popup.document.close();
    if (typeof wirePrintPopupAutoClose === 'function') wirePrintPopupAutoClose(popup);
}

function searchConFormsDocs() {
    if (!conFormsPatientId) {
        return;
    }
    var list = g('conFormsExistingList');
    conFormsShowHistCard(true);
    if (list) list.innerHTML = '<div style="color:#aaa;padding:10px;">' + esc(conTr('con.forms.loadingDocs')) + '</div>';

    conFormsSelectedDocIds = [];
    conFormsDocsCache = {};
    var selAll = g('conFormsHistSelectAll');
    if (selAll) selAll.checked = false;
    conFormsUpdateHistActions();

    SB.from('patient_documents')
      .select('id,document_name,document_date,template_name,template_type,created_at,content_html')
      .eq('patient_id', conFormsPatientId)
      .order('created_at', { ascending: false })
      .limit(30)
    .then(function(r) {
        if (!list) return;
        if (r.error) {
            list.innerHTML = '<div style="color:#dc3545;padding:10px;">' +
                esc(conTrRepl('con.forms.errLoadDocs', { MSG: r.error.message })) +
                '<br><small>' + esc(conTr('con.forms.errLoadDocsHint')) + '</small></div>';
            return;
        }
        var rows = r.data || [];
        if (!rows.length) {
            list.innerHTML = '<div style="color:#888;padding:10px;">' + esc(conTr('con.forms.noDocs')) + '</div>';
            return;
        }
        rows.forEach(function (d) { conFormsDocsCache[d.id] = d; });

        list.innerHTML = rows.map(function(d) {
            var meta = (d.template_name || '-') + (d.template_type ? ' · ' + conDispTplType(d.template_type) : '');
            var safeId = esc(d.id);
            var editing = conFormsEditingDocId === d.id;
            return '<div style="display:flex;justify-content:space-between;gap:10px;' +
                'padding:10px 12px;border-bottom:1px solid #f0f0f0;align-items:center;' +
                (editing ? 'background:#f0f7ff;' : '') + '" ' +
                'ondblclick="openConFormsDoc(\'' + safeId + '\')">' +
                '<div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;cursor:pointer;" ' +
                'onclick="openConFormsDoc(\'' + safeId + '\')">' +
                  '<input type="checkbox" class="conFormsHistCb" data-id="' + safeId + '" ' +
                         'onchange="event.stopPropagation();conFormsToggleSelect(\'' + safeId + '\', this.checked)" ' +
                         'onclick="event.stopPropagation()">' +
                '<div style="min-width:0;">' +
                  '<div style="font-weight:900;color:#0d6efd;">' + esc(d.document_name || '-') + '</div>' +
                  '<div style="font-size:12px;color:#888;margin-top:2px;">' +
                    esc(d.document_date || '') + ' · ' + esc(meta) +
                  '</div>' +
                '</div>' +
                '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                  '<button type="button" class="btn-add" style="padding:6px 10px;font-size:12px;" ' +
                  'onclick="event.stopPropagation();openConFormsDoc(\'' + safeId + '\')">' + esc(conTr('con.forms.btnOpen')) + '</button>' +
                  '<button type="button" class="btn-add" style="padding:6px 10px;font-size:12px;background:#22c55e;" ' +
                  'onclick="event.stopPropagation();conFormsPrintOneDoc(\'' + safeId + '\')">' + esc(conTr('con.forms.btnPrintOne')) + '</button>' +
                '</div>' +
              '</div>';
        }).join('');
    });
}

function refreshConFormsDocs() {
    if (conPatientId && conPatientData &&
        String(conPatientId) !== String(conFormsPatientId || '')) {
        conFormsPatientId = conPatientId;
        conFormsPatientData = conPatientData;
        updateConFormsPatientLabel();
        conFormsShowHistCard(true);
    }
    if (!conFormsPatientId) {
        if (conPatientId && conPatientData) {
            conFormsPatientId = conPatientId;
            conFormsPatientData = conPatientData;
            updateConFormsPatientLabel();
            conFormsShowHistCard(true);
        } else {
            return;
        }
    }
    searchConFormsDocs();
}

function conFormsToggleSelect(id, checked) {
    var idx = conFormsSelectedDocIds.indexOf(id);
    if (checked && idx === -1) conFormsSelectedDocIds.push(id);
    if (!checked && idx !== -1) conFormsSelectedDocIds.splice(idx, 1);

    var selAll = g('conFormsHistSelectAll');
    if (selAll) {
        var allCbs = document.querySelectorAll('#conFormsExistingList .conFormsHistCb');
        var allChecked = allCbs.length > 0;
        allCbs.forEach(function (cb) { if (!cb.checked) allChecked = false; });
        selAll.checked = allChecked;
    }
    conFormsUpdateHistActions();
}

function conFormsToggleSelectAll(checked) {
    conFormsSelectedDocIds = [];
    document.querySelectorAll('#conFormsExistingList .conFormsHistCb').forEach(function (cb) {
        cb.checked = checked;
        if (checked && cb.dataset.id) conFormsSelectedDocIds.push(cb.dataset.id);
    });
    conFormsUpdateHistActions();
}

function conFormsUpdateHistActions() {
    var n = conFormsSelectedDocIds.length;
    var delBtn = g('conFormsHistDeleteBtn');
    var prtBtn = g('conFormsHistPrintBtn');
    [delBtn, prtBtn].forEach(function (btn) {
        if (!btn) return;
        if (n > 0) {
            btn.disabled = false;
            btn.style.cursor = 'pointer';
        } else {
            btn.disabled = true;
            btn.style.cursor = 'not-allowed';
        }
    });
    if (prtBtn) prtBtn.style.background = n > 0 ? '#22c55e' : '#9ca3af';
    if (delBtn) delBtn.style.background = n > 0 ? '#ef4444' : '#9ca3af';
}

function conFormsDeleteSelectedDocs() {
    if (!conFormsSelectedDocIds.length) return;
    var n = conFormsSelectedDocIds.length;
    if (!confirm(conTrRepl('con.forms.deleteConfirm', { N: String(n) }))) return;

    SB.from('patient_documents')
      .delete()
      .in('id', conFormsSelectedDocIds)
    .then(function (r) {
        if (r.error) { alert(conTrRepl('con.alert.deleteFailed', { MSG: r.error.message })); return; }
        // refresh history list
        searchConFormsDocs();
    });
}

function conFormsPrintSelectedDocs() {
    if (!conFormsSelectedDocIds.length) return;
    var docs = conFormsSelectedDocIds
        .map(function (id) { return conFormsDocsCache[id]; })
        .filter(Boolean);

    // If some weren't cached (unlikely), fetch them.
    if (docs.length !== conFormsSelectedDocIds.length) {
        SB.from('patient_documents')
          .select('id,content_html')
          .in('id', conFormsSelectedDocIds)
        .then(function (r) {
            if (r.error) { alert(conTrRepl('con.alert.printFailed', { MSG: r.error.message })); return; }
            var rows = r.data || [];
            var html = rows.map(function (d) {
                return conFormsPreparePrintHtml(d.content_html || '', true);
            }).join(
                '<div style="page-break-after:always;"></div>'
            );
            printConFormsHtml(html);
        });
        return;
    }

    var htmlJoined = docs
        .map(function (d) { return conFormsPreparePrintHtml(d.content_html || '', true); })
        .join('<div style="page-break-after:always;"></div>');

    printConFormsHtml(htmlJoined);
}

function conFormsPrintOneDoc(id) {
    var d = conFormsDocsCache[id];
    if (d && d.content_html) {
        printConFormsHtml(conFormsPreparePrintHtml(d.content_html, true));
        return;
    }
    SB.from('patient_documents').select('content_html').eq('id', id).single()
    .then(function (r) {
        if (r.error || !r.data) { alert(conTr('con.alert.loadDocFail')); return; }
        printConFormsHtml(conFormsPreparePrintHtml(r.data.content_html || '', true));
    });
}

function openConFormsDoc(id) {
    SB.from('patient_documents')
      .select('*')
      .eq('id', id)
      .single()
    .then(function(r) {
        if (r.error || !r.data) { alert(conTr('con.alert.loadDocFail')); return; }
        var d = r.data;
        conFormsEditingDocId = d.id;
        conFormsUpdateEditingBadge();
        conFormsDocsCache[d.id] = d;

        if (g('conFormsDocName')) g('conFormsDocName').value = d.document_name || '';
        if (d.template_id && g('conFormsTemplateSel')) {
            g('conFormsTemplateSel').value = d.template_id;
            conFormsSelectedTemplate = conFormsTemplates.find(function (t) { return t.id === d.template_id; }) || null;
        }
        if (typeof conFormsSyncSickLeaveDatePanel === 'function') conFormsSyncSickLeaveDatePanel();
        if (typeof conFormsSyncReferralHintPanel === 'function') conFormsSyncReferralHintPanel();
        if (typeof conFormsHydrateSickLeaveFieldsFromHtml === 'function') {
            conFormsHydrateSickLeaveFieldsFromHtml(d.content_html || '');
        }

        conFormsEnsureRichEditor();
        if (g('conFormsEditorWrap')) g('conFormsEditorWrap').style.display = 'block';
        conFormsWhenReadyForPlaceholders(function () {
            var root = document.createElement('div');
            root.innerHTML = d.content_html || '';
            conFormsStripShellBlocks(root);
            var bodyInner = root.innerHTML;
            if (conFormsIsReferralTemplate(conFormsSelectedTemplate)) {
                bodyInner = conFormsNormalizeReferralTemplateContent(bodyInner);
            }
            var html = conFormsEnsureDefaultShell(bodyInner, true);
            html = applyConFormsPlaceholders(html);
            if (typeof DocEditor !== 'undefined') DocEditor.setHtml('conFormsDocEditor', html);
            else if (g('conFormsDocEditor')) {
                g('conFormsDocEditor').dataset.placeholderMode = '';
                g('conFormsDocEditor').innerHTML = html;
            }
        });
        searchConFormsDocs();
        setTimeout(function () {
            if (typeof DocEditor !== 'undefined') DocEditor.focusEditor('conFormsDocEditor');
            else if (g('conFormsDocEditor')) g('conFormsDocEditor').focus();
        }, 0);
    });
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════
function conDateIsoFromTs(ts) {
    var d = new Date(ts);
    if (!d || isNaN(d.getTime())) return '';
    if (typeof d2iso === 'function') return d2iso(d);
    return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
}

function conClinicCodeFromStoredTag(storedTag) {
    var raw = String(storedTag || '').trim();
    if (!raw) return '';
    if (typeof APP_CLINICS !== 'undefined' && APP_CLINICS && APP_CLINICS.length) {
        for (var i = 0; i < APP_CLINICS.length; i++) {
            var c = APP_CLINICS[i];
            if (String(c.id || '') === raw) {
                return String(c.clinic_code || '').trim().toUpperCase() || raw.toUpperCase();
            }
            var code = String(c.clinic_code || '').trim();
            if (code && code === raw) return code.toUpperCase();
        }
    }
    if (raw.length <= 8) return raw.toUpperCase();
    return '';
}

// ════════════════════════════════════════════════════════════════
// TREATMENT NOTES — LEFT PANEL
// ════════════════════════════════════════════════════════════════
var conTreatmentNotesCache = [];
var conTnPrintFromIso = '';
var conTnPrintToIso = '';
var conTnPrintFromCalMonth = new Date();
var conTnPrintToCalMonth = new Date();
var CON_TN_PRINT_DOC = 'treatment_notes';

function conTnPad2(n) {
    n = Number(n);
    if (typeof pad === 'function') return pad(n);
    return (n < 10 ? '0' : '') + n;
}

function updateConTnPrintBtnState() {
    var btn = g('conTnPrintBtn');
    if (!btn) return;
    var ok = !!conPatientId && conTnActiveSubtab === 'notes';
    btn.disabled = !ok;
    btn.style.display = ok || !conPatientId ? '' : 'none';
    btn.style.opacity = ok ? '1' : '0.45';
    btn.style.cursor = ok ? 'pointer' : 'not-allowed';
}

function switchConTnSubtab(sub) {
    conTnActiveSubtab = sub === 'timeline' ? 'timeline' : 'notes';
    document.querySelectorAll('.con-tn-subtab').forEach(function (btn) {
        var on = btn.dataset.subtab === conTnActiveSubtab;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    var notesPane = g('conTnSubpane-notes');
    var tlPane = g('conTnSubpane-timeline');
    if (notesPane) {
        notesPane.classList.toggle('active', conTnActiveSubtab === 'notes');
        notesPane.hidden = conTnActiveSubtab !== 'notes';
    }
    if (tlPane) {
        tlPane.classList.toggle('active', conTnActiveSubtab === 'timeline');
        tlPane.hidden = conTnActiveSubtab !== 'timeline';
    }
    updateConTnPrintBtnState();
    if (conTnActiveSubtab === 'timeline' && conPatientId) {
        if (!conPatientTimelineEvents.length) loadConPatientTimeline(conPatientId);
        else renderConPatientTimeline();
    }
}

function conPtlTruncate(text, maxLen) {
    var s = String(text || '').trim();
    if (!s) return '';
    maxLen = maxLen || 220;
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 1) + '\u2026';
}

function conPtlTsFromIsoDateTime(dateIso, timeStr) {
    if (!dateIso) return 0;
    var t = String(timeStr || '12:00').trim().slice(0, 5);
    if (t.length < 4) t = '12:00';
    var d = new Date(dateIso + 'T' + t + ':00');
    var ms = d.getTime();
    return isNaN(ms) ? 0 : ms;
}

function conPtlTsFromAny(ts, dateFallback) {
    if (ts) {
        var d = new Date(ts);
        if (!isNaN(d.getTime())) return d.getTime();
    }
    if (dateFallback) return conPtlTsFromIsoDateTime(dateFallback, '12:00');
    return 0;
}

function conPtlFormatTime(ms) {
    if (!ms) return '';
    return new Date(ms).toLocaleTimeString(conUiLocale(), { hour: '2-digit', minute: '2-digit' });
}

function conPtlFormatDay(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString(conUiLocale(), {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
    });
}

function conPtlSafeRows(promise) {
    return promise.then(function (r) {
        if (r && r.error) {
            conPatientTimelineHadErrors = true;
            return [];
        }
        return (r && r.data) ? r.data : [];
    }).catch(function () {
        conPatientTimelineHadErrors = true;
        return [];
    });
}

function conPtlBuildFilterBar() {
    var host = g('conPtlFilters');
    if (!host) return;
    var defs = [
        { key: 'all', labelKey: 'con.ptl.filter.all' },
        { key: 'note', labelKey: 'con.ptl.filter.note' },
        { key: 'rx', labelKey: 'con.ptl.filter.rx' },
        { key: 'visit', labelKey: 'con.ptl.filter.visit' },
        { key: 'bill', labelKey: 'con.ptl.filter.bill' },
        { key: 'doc', labelKey: 'con.ptl.filter.doc' },
        { key: 'xray', labelKey: 'con.ptl.filter.xray' }
    ];
    host.innerHTML = defs.map(function (d) {
        var on = conPtlFilterKey === d.key;
        return '<button type="button" class="con-ptl-filter' + (on ? ' active' : '') + '" data-filter="' +
            esc(d.key) + '">' + esc(conTr(d.labelKey)) + '</button>';
    }).join('');
    if (!host.dataset.wired) {
        host.dataset.wired = '1';
        host.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('[data-filter]') : null;
            if (!btn || !host.contains(btn)) return;
            conPtlFilterKey = btn.getAttribute('data-filter') || 'all';
            conPtlBuildFilterBar();
            renderConPatientTimeline();
        });
    }
}

function conPtlEventsFromNotes(rows) {
    return (rows || []).map(function (t) {
        var ms = conPtlTsFromAny(t.created_at, null);
        return {
            kind: 'note',
            ts: ms,
            title: conTr('con.ptl.type.note'),
            body: conPtlTruncate(t.notes, 280),
            meta: [t.dentist_name, conClinicCodeFromStoredTag(t[TREATMENT_CLINIC_TAG_FIELD] || t.clinic_tag)]
                .filter(Boolean).join(' · '),
            action: 'notes',
            refId: t.id
        };
    });
}

function conPtlEventsFromRx(rows) {
    var groups = {};
    var order = [];
    (rows || []).forEach(function (r) {
        var dk = r.prescribed_date || conDateIsoFromTs(r.created_at) || '__unknown__';
        var doc = r.doctor_tag || r.dentist_name || '';
        var key = dk + '||' + doc;
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(r);
    });
    var out = [];
    order.forEach(function (key) {
        var parts = key.split('||');
        var dk = parts[0];
        var doc = parts[1] || '';
        var list = groups[key];
        var ms = conPtlTsFromIsoDateTime(dk === '__unknown__' ? '' : dk, '12:00') ||
            conPtlTsFromAny(list[0] && list[0].created_at, null);
        var names = list.map(function (r) { return r.drug_name; }).filter(Boolean);
        var body = names.slice(0, 6).join(', ');
        if (names.length > 6) body += '…';
        out.push({
            kind: 'rx',
            ts: ms,
            title: conTr('con.ptl.type.rx'),
            body: body || '—',
            meta: (doc ? doc + ' · ' : '') +
                conTrRepl('con.ptl.rxSummary', { N: String(names.length) }),
            action: 'rx',
            refId: dk
        });
    });
    return out;
}

function conPtlIsApptFuture(a) {
    var d = String(a && a.date || '').trim();
    if (!d) return false;
    var today = (typeof todayISO === 'function') ? todayISO() : '';
    return !!today && d >= today;
}

function conPtlResolveApptDoctorLabel(a) {
    a = a || {};
    var code = String(a.doctor_code || '').trim();
    var docs = (typeof APP_DOCTORS !== 'undefined' && Array.isArray(APP_DOCTORS)) ? APP_DOCTORS : [];
    if (code) {
        var hit = docs.find(function (d) {
            return String(d.doctor_code || '').trim().toLowerCase() === code.toLowerCase();
        });
        if (hit && typeof doctorDisplayName === 'function') {
            return doctorDisplayName(hit) || code;
        }
        if (hit) {
            return String(hit.english_name || hit.chinese_name || hit.display_name || code).trim();
        }
    }
    var raw = String(a.dentist_name || a.doctor_name || '').trim();
    if (raw && typeof stripDoctorTagPrefix === 'function') {
        raw = stripDoctorTagPrefix(raw);
    }
    return raw.replace(/^\[[^\]]+\]\s*/, '').trim();
}

function conPtlFormatApptTimeRange(a) {
    a = a || {};
    var st = a.start_time ? String(a.start_time).slice(0, 5) : '';
    var en = a.end_time ? String(a.end_time).slice(0, 5) : '';
    if (st && en && en !== st) return st + ' – ' + en;
    return st;
}

function conPtlPlainRemarks(remarks) {
    var s = String(remarks || '').trim();
    if (!s) return '';
    if (typeof stripStaffAuthorFromRemarks === 'function') {
        s = stripStaffAuthorFromRemarks(s);
    }
    if (typeof stripDoctorTagsFromRemarks === 'function') {
        s = stripDoctorTagsFromRemarks(s);
    }
    return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function conPtlApptStatusLabel(a) {
    var raw = (a && a.bill_status) ? a.bill_status : 'Scheduled';
    if (typeof dispStatusLabel === 'function') return dispStatusLabel(raw);
    if (typeof dispApptStatus === 'function') return dispApptStatus(raw);
    return raw;
}

function conPtlEventsFromVisits(rows) {
    return (rows || []).map(function (a) {
        var ms = conPtlTsFromIsoDateTime(a.date, a.start_time) ||
            conPtlTsFromAny(a.created_at, a.date);
        var statusLabel = conPtlApptStatusLabel(a);
        var statusRaw = String(a.bill_status || 'Scheduled');
        var isFuture = conPtlIsApptFuture(a);
        var isUpcoming = isFuture &&
            (!statusRaw || /^scheduled$/i.test(String(statusRaw).trim()));

        var dr = conPtlResolveApptDoctorLabel(a);
        var timeRange = conPtlFormatApptTimeRange(a);
        var treatment = String(a.treatment_items || '').trim();
        var remarksPlain = conPtlPlainRemarks(a.remarks);

        var headline = '';
        var body = '';
        var metaParts = [];

        if (isUpcoming) {
            if (dr && timeRange) {
                headline = dr + ' · ' + timeRange;
            } else if (dr) {
                headline = dr;
            } else if (timeRange) {
                headline = timeRange;
            } else {
                headline = conTr('con.ptl.visitScheduled');
            }
            if (remarksPlain) body = conPtlTruncate(remarksPlain, 180);
            if (treatment && treatment.toLowerCase() !== String(a.doctor_code || '').trim().toLowerCase()) {
                metaParts.push(conTrRepl('con.ptl.treatmentLine', { ITEMS: treatment }));
            }
        } else {
            if (remarksPlain) {
                headline = conPtlTruncate(remarksPlain, 200);
            } else if (treatment) {
                headline = conPtlTruncate(treatment, 200);
            } else if (dr) {
                headline = dr;
            } else {
                headline = conTr('con.ptl.visitScheduled');
            }
            if (dr && (remarksPlain || treatment)) metaParts.push(dr);
            else if (dr && !remarksPlain && !treatment) metaParts.push(dr);
        }

        return {
            kind: 'visit',
            ts: ms,
            title: conTr('con.ptl.type.visit'),
            headline: headline,
            body: body,
            meta: metaParts.filter(Boolean).join(' · '),
            upcoming: isUpcoming,
            statusLabel: statusLabel,
            action: 'visit',
            refId: a.id,
            payload: {
                id: a.id,
                date: a.date,
                start_time: a.start_time,
                doctor_code: a.doctor_code,
                bill_status: a.bill_status
            }
        };
    });
}

function conPtlEventsFromBills(rows) {
    return (rows || []).map(function (b) {
        var ms = conPtlTsFromAny(b.created_at, null);
        var total = (typeof fmt2 === 'function') ? fmt2(b.total) : String(b.total || '0');
        var bal = (typeof fmt2 === 'function') ? fmt2(b.balance) : String(b.balance || '0');
        var voided = b.voided_at ? (' ' + conTr('con.ptl.billVoided')) : '';
        return {
            kind: 'bill',
            ts: ms,
            title: conTr('con.ptl.type.bill') + voided,
            body: conTrRepl('con.ptl.billSummary', { TOTAL: total, BAL: bal }),
            meta: b.id ? ('#' + String(b.id).slice(0, 8).toUpperCase()) : '',
            action: 'bill',
            refId: b.id,
            payload: b
        };
    });
}

function conPtlEventsFromDocs(rows) {
    return (rows || []).map(function (d) {
        var ms = conPtlTsFromAny(d.created_at, d.document_date);
        return {
            kind: 'doc',
            ts: ms,
            title: conTr('con.ptl.type.doc'),
            body: d.document_name || d.template_name || '—',
            meta: [d.document_date, d.template_name, d.template_type].filter(Boolean).join(' · '),
            action: 'doc',
            refId: d.id
        };
    });
}

function conPtlEventsFromXrays(rows) {
    return (rows || []).map(function (x) {
        var ms = conPtlTsFromAny(x.created_at, x.taken_date) ||
            conPtlTsFromIsoDateTime(x.taken_date, '12:00');
        var typeLbl = x.xray_type || x.file_name || '';
        return {
            kind: 'xray',
            ts: ms,
            title: conTr('con.ptl.type.xray'),
            body: typeLbl || '—',
            meta: conPtlTruncate(x.notes, 120),
            action: 'xray',
            refId: x.id
        };
    });
}

function conPtlMergeEvents(lists) {
    var all = [];
    lists.forEach(function (arr) {
        if (arr && arr.length) all = all.concat(arr);
    });
    all.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return all;
}

function loadConPatientTimeline(patientId) {
    var host = g('conPatientTimeline');
    if (!host) return;
    if (!patientId) {
        conPatientTimelineEvents = [];
        host.innerHTML = '<p class="con-ptl-placeholder">' + esc(conTr('con.ptl.selectPatient')) + '</p>';
        return;
    }
    conPatientTimelineHadErrors = false;
    host.innerHTML = '<p class="con-ptl-placeholder">' + esc(conTr('con.ptl.loading')) + '</p>';
    conPtlBuildFilterBar();

    var pid = patientId;
    var pno = (conPatientData && conPatientData.patient_no)
        ? String(conPatientData.patient_no).trim()
        : '';

    var qNotes = SB.from('treatments').select('*').eq('patient_id', pid)
        .order('created_at', { ascending: false }).limit(200);
    var qRx = SB.from('drughistory').select('*').eq('patient_id', pid)
        .order('prescribed_date', { ascending: false }).limit(300);
    var qAppt = SB.from('appointments').select(
        'id,date,start_time,end_time,bill_status,treatment_items,remarks,' +
        'dentist_name,doctor_name,doctor_code,created_at'
    ).eq('patient_id', pid).order('date', { ascending: false }).limit(150);
    var qDocs = SB.from('patient_documents').select(
        'id,document_name,document_date,template_name,template_type,created_at'
    ).eq('patient_id', pid).order('created_at', { ascending: false }).limit(80);
    var qXray = SB.from('xrays').select('id,xray_type,taken_date,notes,file_name,created_at')
        .eq('patient_id', pid).order('created_at', { ascending: false }).limit(80);

    var qBill = SB.from('bills').select('id,total,balance,voided_at,created_at,appointment_id')
        .eq('patient_id', pid).order('created_at', { ascending: false }).limit(120);

    Promise.all([
        conPtlSafeRows(qNotes),
        conPtlSafeRows(qRx),
        conPtlSafeRows(qAppt),
        conPtlSafeRows(qBill),
        conPtlSafeRows(qDocs),
        conPtlSafeRows(qXray)
    ]).then(function (parts) {
        var bills = parts[3];
        if (!bills.length && pno) {
            return conPtlSafeRows(
                SB.from('bills').select('id,total,balance,voided_at,created_at,appointment_id')
                    .eq('patient_no', pno).order('created_at', { ascending: false }).limit(120)
            ).then(function (b2) {
                parts[3] = b2;
                return parts;
            });
        }
        return parts;
    }).then(function (parts) {
        conPatientTimelineEvents = conPtlMergeEvents([
            conPtlEventsFromNotes(parts[0]),
            conPtlEventsFromRx(parts[1]),
            conPtlEventsFromVisits(parts[2]),
            conPtlEventsFromBills(parts[3]),
            conPtlEventsFromDocs(parts[4]),
            conPtlEventsFromXrays(parts[5])
        ]);
        renderConPatientTimeline();
    });
}

function renderConPatientTimeline() {
    var host = g('conPatientTimeline');
    if (!host) return;
    conPtlBuildFilterBar();
    var list = conPatientTimelineEvents || [];
    if (conPtlFilterKey && conPtlFilterKey !== 'all') {
        list = list.filter(function (ev) { return ev.kind === conPtlFilterKey; });
    }
    if (!list.length) {
        var emptyMsg = conTr('con.ptl.selectPatient');
        if (conPatientId) {
            emptyMsg = (conPatientTimelineEvents.length && conPtlFilterKey !== 'all')
                ? conTr('con.ptl.emptyFilter')
                : conTr('con.ptl.empty');
        }
        host.innerHTML = '<p class="con-ptl-placeholder">' + esc(emptyMsg) + '</p>';
        if (conPatientTimelineHadErrors && conPatientId) {
            host.innerHTML += '<p class="con-ptl-placeholder" style="color:#b45309;">' +
                esc(conTr('con.ptl.errLoad')) + '</p>';
        }
        return;
    }
    var html = '';
    var lastDay = '';
    if (conPatientTimelineHadErrors) {
        html += '<p class="con-ptl-placeholder" style="color:#b45309;margin-bottom:8px;">' +
            esc(conTr('con.ptl.errLoad')) + '</p>';
    }
    list.forEach(function (ev, idx) {
        var day = conPtlFormatDay(ev.ts);
        if (day !== lastDay) {
            if (lastDay) html += '</ul>';
            lastDay = day;
            html += '<div class="con-ptl-day">' + esc(day) + '</div><ul class="con-ptl-list">';
        }
        var evCls = 'con-ptl-event con-ptl-event--' + esc(ev.kind);
        if (ev.upcoming) evCls += ' con-ptl-event--upcoming';
        var badgeHtml = '';
        if (ev.upcoming) {
            badgeHtml = '<span class="con-ptl-badge con-ptl-badge--upcoming">' +
                esc(conTr('con.ptl.upcoming')) + '</span>';
        } else if (ev.statusLabel && ev.kind === 'visit') {
            badgeHtml = '<span class="con-ptl-badge con-ptl-badge--status">' +
                esc(ev.statusLabel) + '</span>';
        }
        var headline = ev.headline || '';
        var detail = ev.body || '';
        html +=
            '<li class="' + evCls + '" data-ptl-idx="' + idx + '">' +
            '<div class="con-ptl-event-head">' +
            '<span class="con-ptl-event-type">' + esc(ev.title || '') + badgeHtml + '</span>' +
            '<span class="con-ptl-event-time">' + esc(conPtlFormatTime(ev.ts)) + '</span>' +
            '</div>' +
            (headline
                ? '<div class="con-ptl-event-title">' + esc(headline) + '</div>'
                : '') +
            (detail
                ? '<div class="con-ptl-event-body">' + esc(detail) + '</div>'
                : '') +
            '<div class="con-ptl-event-meta">' +
            (ev.meta ? '<span class="con-ptl-event-meta-text">' + esc(ev.meta) + '</span>' : '') +
            '<span class="con-ptl-event-jump">' + esc(conTr('con.ptl.jumpHint')) + '</span>' +
            '</div>' +
            '</li>';
    });
    if (lastDay) html += '</ul>';
    host.innerHTML = html;
    host.querySelectorAll('.con-ptl-event').forEach(function (el) {
        el.addEventListener('click', function () {
            var idx = parseInt(el.getAttribute('data-ptl-idx'), 10);
            if (!isNaN(idx) && list[idx]) conPtlOpenEvent(list[idx]);
        });
    });
}

function conPtlOpenEvent(ev) {
    if (!ev) return;
    if (ev.action === 'notes') {
        switchConTnSubtab('notes');
        return;
    }
    if (ev.action === 'rx') {
        switchConTnSubtab('notes');
        var wrap = g('drugHistoryWrap');
        if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    if (ev.action === 'doc') {
        switchConTab('forms');
        if (ev.refId && typeof openConFormsDoc === 'function') {
            setTimeout(function () { openConFormsDoc(ev.refId); }, 120);
        }
        return;
    }
    if (ev.action === 'xray') {
        switchConTab('xrays');
        return;
    }
    if (ev.action === 'bill') {
        if (ev.payload && typeof showBillDetail === 'function') {
            showBillDetail(ev.payload);
            return;
        }
        if (ev.refId) {
            SB.from('bills').select('*').eq('id', ev.refId).single()
            .then(function (r) {
                if (!r.error && r.data && typeof showBillDetail === 'function') {
                    showBillDetail(r.data);
                } else if (typeof openBillFromConsultation === 'function') {
                    openBillFromConsultation();
                }
            });
            return;
        }
        if (typeof openBillFromConsultation === 'function') openBillFromConsultation();
        return;
    }
    if (ev.action === 'visit') {
        if (typeof openApptFromTimelineVisit === 'function') {
            openApptFromTimelineVisit(ev.payload || { id: ev.refId });
        } else if (typeof showOnly === 'function') {
            showOnly('appointmentSection');
            setTimeout(function () {
                if (typeof switchApptTab === 'function') switchApptTab('plusappt');
            }, 40);
        }
        return;
    }
}

function bindConBackQueueBtnOnce() {
    var btn = g('conBackQueueBtn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function() {
        if (typeof showOnly === 'function') showOnly('appointmentSection');
        setTimeout(function() {
            if (typeof switchApptTab === 'function') switchApptTab('queue');
        }, 40);
    });
}

function conTnPrintRangeMode() {
    var picked = document.querySelector('input[name="conTnPrintRange"]:checked');
    return picked ? picked.value : 'today';
}

function syncConTnPrintRangeUi() {
    var wrap = g('conTnPrintDatedWrap');
    var pop = g('conTnPrintPopover');
    var mode = conTnPrintRangeMode();
    if (wrap) wrap.classList.toggle('hidden', mode !== 'dated');
    if (pop) pop.classList.toggle('con-tn-print-popover--dated', mode === 'dated');
    if (mode === 'dated') {
        if (!conTnPrintFromIso && typeof todayISO === 'function') conTnPrintFromIso = todayISO();
        if (!conTnPrintToIso && typeof todayISO === 'function') conTnPrintToIso = todayISO();
        renderConTnMiniCal('conTnPrintFromCal', conTnPrintFromCalMonth, conTnPrintFromIso);
        renderConTnMiniCal('conTnPrintToCal', conTnPrintToCalMonth, conTnPrintToIso);
        updateConTnPrintDateLabels();
    }
    scheduleConTnPrintPopoverPosition();
}

function updateConTnPrintDateLabels() {
    var f = g('conTnPrintFromLbl');
    var t = g('conTnPrintToLbl');
    if (f) f.textContent = conTnPrintFromIso || '—';
    if (t) t.textContent = conTnPrintToIso || '—';
}

var _conTnPrintPositionTimer = null;
function scheduleConTnPrintPopoverPosition() {
    if (_conTnPrintPositionTimer) clearTimeout(_conTnPrintPositionTimer);
    _conTnPrintPositionTimer = setTimeout(function () {
        _conTnPrintPositionTimer = null;
        requestAnimationFrame(function () {
            positionConTnPrintPopover();
            requestAnimationFrame(positionConTnPrintPopover);
        });
    }, 0);
}

function positionConTnPrintPopover() {
    var pop = g('conTnPrintPopover');
    var btn = g('conTnPrintBtn');
    if (!pop || pop.classList.contains('hidden')) return;

    var margin = 12;
    var isDated = conTnPrintRangeMode() === 'dated';
    pop.style.right = 'auto';
    pop.style.bottom = 'auto';
    pop.style.transform = 'none';
    pop.style.maxHeight = Math.max(220, window.innerHeight - margin * 2) + 'px';

    var popW = pop.offsetWidth;
    var popH = pop.offsetHeight;
    var left;
    var top;
    var viewH = window.innerHeight;
    var viewW = window.innerWidth;

    if (btn) {
        var rect = btn.getBoundingClientRect();
        left = rect.left;
        if (left + popW > viewW - margin) left = viewW - popW - margin;
        if (left < margin) left = margin;

        var gap = 8;
        var belowTop = rect.bottom + gap;
        var aboveTop = rect.top - popH - gap;
        var spaceBelow = viewH - margin - belowTop;
        var spaceAbove = rect.top - gap - margin;

        if (isDated || popH > viewH - margin * 2) {
            if (spaceAbove >= spaceBelow && aboveTop >= margin) {
                top = aboveTop;
            } else if (belowTop + popH <= viewH - margin) {
                top = belowTop;
            } else if (aboveTop >= margin) {
                top = aboveTop;
            } else {
                top = Math.max(margin, Math.round((viewH - Math.min(popH, viewH - margin * 2)) / 2));
            }
        } else {
            top = belowTop;
            if (top + popH > viewH - margin) {
                if (aboveTop >= margin) top = aboveTop;
                else top = Math.max(margin, Math.round((viewH - popH) / 2));
            }
        }
        if (top < margin) top = margin;
        if (top + popH > viewH - margin) {
            top = Math.max(margin, viewH - margin - popH);
        }
    } else {
        left = Math.max(margin, Math.round((viewW - popW) / 2));
        top = Math.max(margin, Math.round((viewH - popH) / 2));
    }

    pop.style.left = Math.round(left) + 'px';
    pop.style.top = Math.round(top) + 'px';
}

function conTnPrintClickInsidePopover(e, pop) {
    if (!pop || !e) return false;
    if (pop.contains(e.target)) return true;
    if (typeof e.composedPath === 'function') {
        var path = e.composedPath();
        for (var i = 0; i < path.length; i++) {
            if (path[i] === pop) return true;
        }
    }
    return false;
}

function conTnApplyPrintDatePick(hostId, iso) {
    if (hostId === 'conTnPrintFromCal') {
        conTnPrintFromIso = iso;
        if (conTnPrintToIso && iso > conTnPrintToIso) conTnPrintToIso = iso;
    } else if (hostId === 'conTnPrintToCal') {
        conTnPrintToIso = iso;
        if (conTnPrintFromIso && iso < conTnPrintFromIso) conTnPrintFromIso = iso;
    }
    updateConTnPrintDateLabels();
    setTimeout(function () { syncConTnPrintRangeUi(); }, 0);
}

function renderConTnMiniCal(hostId, monthDate, selectedIso) {
    var host = g(hostId);
    if (!host) return;
    var y = monthDate.getFullYear();
    var mo = monthDate.getMonth();
    var first = new Date(y, mo, 1);
    var startPad = first.getDay();
    var daysIn = new Date(y, mo + 1, 0).getDate();
    var loc = conUiLocale();
    var monthLbl = new Date(y, mo, 1).toLocaleDateString(loc, { month: 'long', year: 'numeric' });
    var wd = (typeof apptCalWeekdayHeaders === 'function')
        ? apptCalWeekdayHeaders()
        : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    var html = '<div class="plusappt-mc-head">' +
        '<button type="button" class="plusappt-mc-nav" data-act="prev">‹</button>' +
        '<span class="plusappt-mc-title">' + esc(monthLbl) + '</span>' +
        '<button type="button" class="plusappt-mc-nav" data-act="next">›</button>' +
        '</div><div class="plusappt-mc-wd">';
    wd.forEach(function (d) { html += '<span>' + esc(d) + '</span>'; });
    html += '</div><div class="plusappt-mc-grid">';
    var i;
    for (i = 0; i < startPad; i++) html += '<span class="plusappt-mc-pad"></span>';
    var today = (typeof todayISO === 'function') ? todayISO() : '';
    for (var day = 1; day <= daysIn; day++) {
        var iso = y + '-' + conTnPad2(mo + 1) + '-' + conTnPad2(day);
        var cs = 'plusappt-mc-day';
        if (iso === selectedIso) cs += ' plusappt-mc-day--sel';
        if (iso === today) cs += ' plusappt-mc-day--today';
        if (conTnPrintFromIso && conTnPrintToIso && iso >= conTnPrintFromIso && iso <= conTnPrintToIso) {
            cs += ' plusappt-mc-day--range';
        }
        if (iso === conTnPrintFromIso || iso === conTnPrintToIso) cs += ' plusappt-mc-day--range-end';
        html += '<button type="button" class="' + cs + '" data-iso="' + iso + '">' + day + '</button>';
    }
    html += '</div>';
    host.innerHTML = html;

    host.querySelectorAll('[data-iso]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            var iso = btn.getAttribute('data-iso');
            conTnApplyPrintDatePick(hostId, iso);
        });
    });
    host.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            if (e && e.stopPropagation) e.stopPropagation();
            var act = btn.getAttribute('data-act');
            if (act === 'prev') {
                if (hostId === 'conTnPrintFromCal') {
                    conTnPrintFromCalMonth = new Date(y, mo - 1, 1);
                } else {
                    conTnPrintToCalMonth = new Date(y, mo - 1, 1);
                }
            } else if (act === 'next') {
                if (hostId === 'conTnPrintFromCal') {
                    conTnPrintFromCalMonth = new Date(y, mo + 1, 1);
                } else {
                    conTnPrintToCalMonth = new Date(y, mo + 1, 1);
                }
            }
            setTimeout(function () { syncConTnPrintRangeUi(); }, 0);
        });
    });
}

function closeConTnPrintPopover() {
    var pop = g('conTnPrintPopover');
    if (pop) pop.classList.add('hidden');
}

function openConTnPrintPopover() {
    if (!conPatientId) {
        alert(conTr('con.tnPrint.alertNoPatient'));
        return;
    }
    var pop = g('conTnPrintPopover');
    var btn = g('conTnPrintBtn');
    if (!pop) return;
    var today = (typeof todayISO === 'function') ? todayISO() : '';
    conTnPrintFromIso = today;
    conTnPrintToIso = today;
    conTnPrintFromCalMonth = new Date();
    conTnPrintToCalMonth = new Date();
    var todayRadio = document.querySelector('input[name="conTnPrintRange"][value="today"]');
    if (todayRadio) todayRadio.checked = true;
    pop.classList.remove('hidden');
    if (typeof applyI18nInRoot === 'function') applyI18nInRoot(pop);
    syncConTnPrintRangeUi();
}

function conTnFilterNotesForPrint() {
    var mode = conTnPrintRangeMode();
    var list = (conTreatmentNotesCache || []).slice();
    var today = (typeof todayISO === 'function') ? todayISO() : '';
    if (mode === 'all') {
        return list.sort(function (a, b) {
            return new Date(b.created_at) - new Date(a.created_at);
        });
    }
    return list.filter(function (t) {
        var dk = conDateIsoFromTs(t.created_at);
        if (mode === 'today') return dk === today;
        if (mode === 'dated') {
            if (conTnPrintFromIso && dk < conTnPrintFromIso) return false;
            if (conTnPrintToIso && dk > conTnPrintToIso) return false;
            return true;
        }
        return true;
    }).sort(function (a, b) {
        return new Date(b.created_at) - new Date(a.created_at);
    });
}

function conTnPrintRangeLabel() {
    var mode = conTnPrintRangeMode();
    if (mode === 'today') return conTr('con.tnPrint.rangeTodayLbl');
    if (mode === 'all') return conTr('con.tnPrint.rangeAllLbl');
    var fromLbl = conTnPrintFromIso || '—';
    var toLbl = conTnPrintToIso || '—';
    return conTrRepl('con.tnPrint.rangeDatedLbl', { FROM: fromLbl, TO: toLbl });
}

function buildConTnPrintBodyHtml(notes) {
    var p = conPatientData || {};
    var name = p.full_name || '—';
    var cn = String(p.chinese_name || '').trim();
    if (cn) name = cn + (p.full_name ? ' / ' + p.full_name : '');
    var no = p.patient_no || '—';
    var clinicLbl = (typeof currentClinicLabel !== 'undefined' && currentClinicLabel)
        ? currentClinicLabel
        : (typeof currentClinicId !== 'undefined' ? currentClinicId : '—');
    var genAt = (typeof fmtNowDateTimeHK === 'function')
        ? fmtNowDateTimeHK()
        : new Date().toLocaleString(conUiLocale());
    var showHdr = true;
    var cid = (typeof currentClinicId !== 'undefined' && currentClinicId)
        ? String(currentClinicId) : '';
    if (typeof CFG !== 'undefined' && CFG.getPrintSettingsForDoc) {
        var printRowHdr = CFG.getPrintSettingsForDoc(CON_TN_PRINT_DOC, cid);
        if (printRowHdr) showHdr = printRowHdr.show_header !== false;
    }

    var html = '';
    if (showHdr) {
        html +=
            '<div class="tn-print-hdr">' +
              '<h1>' + esc(conTr('con.tnPrint.docTitle')) + '</h1>' +
              '<div class="tn-print-meta">' +
                esc(conTrRepl('con.tnPrint.patientLine', { NAME: name, NO: no })) + '<br>' +
                esc(conTrRepl('con.tnPrint.clinicLine', { CLINIC: clinicLbl })) + '<br>' +
                esc(conTr('con.tnPrint.rangeLegend')) + ': ' + esc(conTnPrintRangeLabel()) + '<br>' +
                esc(conTrRepl('con.tnPrint.generatedLine', { AT: genAt })) +
              '</div>' +
            '</div>';
    }

    var groups = {};
    var order = [];
    notes.forEach(function (t) {
        var dk = conDateIsoFromTs(t.created_at) || '__unknown__';
        if (!groups[dk]) { groups[dk] = []; order.push(dk); }
        groups[dk].push(t);
    });

    order.forEach(function (dk) {
        var dateLabel = dk;
        if (dk !== '__unknown__') {
            var dObj = (typeof parseISODateOnly === 'function')
                ? parseISODateOnly(dk)
                : new Date(dk);
            if (dObj && !isNaN(dObj.getTime())) {
                dateLabel = dObj.toLocaleDateString(conUiLocale(), {
                    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
                });
            }
        }
        html += '<div class="tn-print-date-sep">' + esc(dateLabel) + '</div>';
        groups[dk].forEach(function (t) {
            var timeStr = new Date(t.created_at).toLocaleTimeString(conUiLocale(), {
                hour: '2-digit', minute: '2-digit'
            });
            var meta = timeStr;
            if (t.dentist_name || t.doctor_name) {
                var drLbl = (typeof printDoctorDisplayName === 'function')
                    ? printDoctorDisplayName({
                        doctor_name: t.doctor_name || t.dentist_name,
                        doctor_tag: t.doctor_tag || t.dentist_name
                    }, printUiLangIsChinese() ? 'zh' : 'en')
                    : (t.dentist_name || t.doctor_name || '');
                if (drLbl && drLbl !== '—') meta += ' · ' + drLbl;
            }
            var tag = t[TREATMENT_CLINIC_TAG_FIELD] || t.clinic_tag || '';
            var code = conClinicCodeFromStoredTag(tag);
            if (code) meta += ' · ' + code;
            html +=
                '<div class="tn-print-note">' +
                  '<div class="tn-print-note-meta">' + esc(meta) + '</div>' +
                  esc(t.notes || '') +
                '</div>';
        });
    });
    return html;
}

function openConTnPrintFromPopover() {
    var mode = conTnPrintRangeMode();
    if (mode === 'dated' && conTnPrintFromIso && conTnPrintToIso &&
        conTnPrintFromIso > conTnPrintToIso) {
        alert(conTr('con.tnPrint.alertBadRange'));
        return;
    }
    var notes = conTnFilterNotesForPrint();
    if (!notes.length) {
        alert(conTr('con.tnPrint.alertNoNotes'));
        return;
    }
    closeConTnPrintPopover();
    executeConTnPrint();
}

function executeConTnPrint() {
    var notes = conTnFilterNotesForPrint();
    if (!notes.length) {
        alert(conTr('con.tnPrint.alertNoNotes'));
        return;
    }
    var bodyHtml = buildConTnPrintBodyHtml(notes);
    var cid = (typeof currentClinicId !== 'undefined' && currentClinicId)
        ? String(currentClinicId) : '';
    var printRow = null;
    if (typeof CFG !== 'undefined' && CFG.getPrintSettingsForDoc) {
        printRow = CFG.getPrintSettingsForDoc(CON_TN_PRINT_DOC, cid);
    }
    if (typeof CFG !== 'undefined' && CFG.prefetchPrintSettings) {
        CFG.prefetchPrintSettings(cid);
    }
    if (typeof CFG !== 'undefined' && CFG.openContentPrintPopup) {
        var ok = CFG.openContentPrintPopup({
            title: conTr('con.tnPrint.docTitle'),
            bodyHtml: bodyHtml,
            printRow: printRow,
            docType: CON_TN_PRINT_DOC,
            clinicId: cid
        });
        if (!ok) alert(conTr('con.alert.popupBlocked'));
    } else {
        printConFormsHtml('<div class="tn-print-body">' + bodyHtml + '</div>');
    }
}

function wireConTnPrintUi() {
    var printBtn = g('conTnPrintBtn');
    if (printBtn && !printBtn.dataset.wired) {
        printBtn.dataset.wired = '1';
        printBtn.addEventListener('click', function () {
            if (printBtn.disabled) return;
            openConTnPrintPopover();
        });
    }
    var popClose = g('conTnPrintPopoverClose');
    var popCancel = g('conTnPrintPopoverCancel');
    if (popClose && !popClose.dataset.wired) {
        popClose.dataset.wired = '1';
        popClose.addEventListener('click', closeConTnPrintPopover);
    }
    if (popCancel && !popCancel.dataset.wired) {
        popCancel.dataset.wired = '1';
        popCancel.addEventListener('click', closeConTnPrintPopover);
    }
    document.querySelectorAll('input[name="conTnPrintRange"]').forEach(function (el) {
        if (el.dataset.wired) return;
        el.dataset.wired = '1';
        el.addEventListener('change', function () {
            syncConTnPrintRangeUi();
        });
    });
    var printGo = g('conTnPrintPopoverGo');
    if (printGo && !printGo.dataset.wired) {
        printGo.dataset.wired = '1';
        printGo.addEventListener('click', openConTnPrintFromPopover);
    }
    document.addEventListener('click', function (e) {
        var pop = g('conTnPrintPopover');
        if (!pop || pop.classList.contains('hidden')) return;
        if (conTnPrintClickInsidePopover(e, pop)) return;
        if (printBtn && printBtn.contains(e.target)) return;
        closeConTnPrintPopover();
    });
    updateConTnPrintBtnState();
    if (!window._conTnPrintResizeBound) {
        window._conTnPrintResizeBound = true;
        window.addEventListener('resize', scheduleConTnPrintPopoverPosition);
    }
}

function conSchedulePatientTimelineRefresh(pid) {
    if (!pid || pid !== conPatientId) return;
    clearTimeout(conPtlRefreshTimer);
    conPtlRefreshTimer = setTimeout(function () {
        conPtlRefreshTimer = null;
        loadConPatientTimeline(pid);
    }, 60);
}

function loadConNotes(pid) {
    var tl = g('conTimeline');
    if (!tl) return;

    tl.innerHTML =
        '<p style="color:#aaa;margin:0;padding:16px;">' +
        esc(conTr('common.loadingEllipsis')) +
        '</p>';

    SB.from('treatments').select('*')
        .eq('patient_id', pid)
        .order('created_at', { ascending: false })
    .then(function(r) {
        conTreatmentNotesCache = (r.data && !r.error) ? r.data : [];
        if (r.error || !r.data || !r.data.length) {
            tl.innerHTML =
                '<p style="color:#aaa;margin:0;padding:16px;">' +
                esc(conTr('con.noTreatmentNotes')) +
                '</p>';
            conSchedulePatientTimelineRefresh(pid);
            return;
        }

        tl.innerHTML = '';
        var todayIso = (typeof todayISO === 'function')
            ? todayISO()
            : conDateIsoFromTs((typeof nowLocal === 'function' ? nowLocal() : new Date()));

        var groups = {};
        var order  = [];
        r.data.forEach(function(t) {
            var dk = conDateIsoFromTs(t.created_at);
            if (!dk) dk = '__unknown__';
            if (!groups[dk]) { groups[dk] = []; order.push(dk); }
            groups[dk].push(t);
        });

        order.forEach(function(dk) {
            var sep = document.createElement('div');
            sep.className = 'note-date-sep';
            var dateLabel = '—';
            if (dk !== '__unknown__') {
                var dObj = (typeof parseISODateOnly === 'function')
                    ? parseISODateOnly(dk)
                    : new Date(dk);
                if (dObj && !isNaN(dObj.getTime())) {
                    dateLabel = dObj.toLocaleDateString(conUiLocale(), {
                        weekday: 'short', day: 'numeric',
                        month: 'short',   year: 'numeric'
                    });
                }
            }
            sep.innerHTML =
                '<span class="note-date-label">' +
                    dateLabel +
                '</span>';
            tl.appendChild(sep);

            groups[dk].forEach(function(t) {
                var isToday = dk === todayIso;
                var canEdit = isToday && currentRole !== 'nurse';
                var storedClinicTag = t[TREATMENT_CLINIC_TAG_FIELD] || t.clinic_tag || '';
                var clinicCode = conClinicCodeFromStoredTag(storedClinicTag);
                var clinicMiniTag = clinicCode
                    ? '<small class="con-note-clinic-tag" title="' + esc(conTr('common.clinic')) + '">' +
                      esc(clinicCode) + '</small>'
                    : '';
                var doctorMiniTag = t.dentist_name
                    ? '<small style="color:#888;font-size:11px;">👨‍⚕️ ' + esc(t.dentist_name) + '</small>'
                    : '';

                var div = document.createElement('div');
                div.className = 'note-card';
                div.innerHTML =
                    '<div class="note-card-header">' +
                        '<div style="display:flex;flex-direction:column;gap:2px;">' +
                            '<small class="note-time">' +
                                new Date(t.created_at)
                                    .toLocaleTimeString(conUiLocale(), {
                                        hour: '2-digit', minute: '2-digit'
                                    }) +
                            '</small>' +
                            '<div class="con-note-meta-row">' +
                                doctorMiniTag +
                                clinicMiniTag +
                            '</div>' +
                        '</div>' +
                        (canEdit
                            ? '<button class="btn-edit-note btn-sm" ' +
                              'style="background:var(--primary);">' +
                              esc(conTr('con.note.edit')) + '</button>'
                            : '') +
                    '</div>' +
                    '<div id="cnt-' + t.id + '" class="note-body">' +
                        esc(t.notes) +
                    '</div>';
                tl.appendChild(div);

                if (canEdit) {
                    div.querySelector('.btn-edit-note')
                       .addEventListener('click', function() {
                           editConNote(t.id, t.notes);
                       });
                }
            });
        });
        conSchedulePatientTimelineRefresh(pid);
    });
}

function conGetNoteTemplates() {
    if (conNoteTemplatesLoaded) return conNoteTemplatesCache.slice();
    try {
        var raw = localStorage.getItem(CON_NOTE_TEMPLATES_KEY) || '[]';
        var arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr.filter(function(t) { return t && t.name && t.content; });
    } catch (e) { return []; }
}

function conSetNoteTemplates(arr) {
    try {
        localStorage.setItem(CON_NOTE_TEMPLATES_KEY, JSON.stringify(arr || []));
    } catch (e) {}
    conNoteTemplatesCache = (arr || []).slice();
    conNoteTemplatesLoaded = true;
}

function conFindTemplateById(list, id) {
    list = list || [];
    id = String(id || '');
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id || String(i)) === id) return list[i];
    }
    return null;
}

function conTemplateClinicTag() {
    var tag = '';
    if (typeof currentClinicCodeForTagging === 'function') {
        tag = String(currentClinicCodeForTagging() || '').trim();
    }
    if (!tag && conPatientData && conPatientData[PATIENT_CLINIC_TAG_FIELD]) {
        tag = String(conPatientData[PATIENT_CLINIC_TAG_FIELD] || '').trim();
    }
    return tag;
}

function conNormalizeTemplateRow(r) {
    if (!r) return null;
    var name = String(r.name || r.template_name || '').trim();
    var content = String(r.content || r.template_text || '').trim();
    if (!name || !content) return null;
    return {
        id: r.id || ('tmp_' + Math.random()),
        name: name,
        content: content,
        clinic_tag: String(r.clinic_tag || '').trim(),
        updated_at: r.updated_at || r.created_at || null
    };
}

function conSortTemplates(list) {
    list.sort(function(a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), conUiLocale());
    });
}

function conFetchNoteTemplates(done) {
    if (!SB || typeof SB.from !== 'function') {
        var localOnly = conGetNoteTemplates();
        if (done) done(localOnly, new Error('Supabase not ready'));
        return;
    }
    SB.from(CON_NOTE_TEMPLATES_TABLE).select('*').order('updated_at', { ascending: false })
    .then(function(r) {
        if (r.error) {
            var localFallback = conGetNoteTemplates();
            if (!conNoteTemplatesRemoteWarned) {
                conNoteTemplatesRemoteWarned = true;
                alert('Supabase template table unavailable; using local template cache.');
            }
            if (done) done(localFallback, r.error);
            return;
        }
        var rows = r.data || [];
        var tag = conTemplateClinicTag();
        var list = rows.map(conNormalizeTemplateRow).filter(function(x) { return !!x; });
        if (tag) {
            list = list.filter(function(t) {
                return !t.clinic_tag || t.clinic_tag === tag;
            });
        }
        conSortTemplates(list);
        conSetNoteTemplates(list);
        if (done) done(list, null);
    })
    .catch(function(e) {
        var localFallback = conGetNoteTemplates();
        if (!conNoteTemplatesRemoteWarned) {
            conNoteTemplatesRemoteWarned = true;
            alert('Supabase template table unavailable; using local template cache.');
        }
        if (done) done(localFallback, e);
    });
}

function conSaveTemplateRemote(tpl, done) {
    if (!SB || typeof SB.from !== 'function') {
        if (done) done(new Error('Supabase not ready'), null);
        return;
    }
    var payload = {
        name: String(tpl.name || '').trim(),
        content: String(tpl.content || '').trim()
    };
    var ctag = conTemplateClinicTag();
    if (ctag) payload.clinic_tag = ctag;
    if (!tpl.id && typeof currentUserId !== 'undefined' && currentUserId) {
        payload.created_by = String(currentUserId);
    }

    function doWrite(p, retried) {
        var q = tpl.id
            ? SB.from(CON_NOTE_TEMPLATES_TABLE).update(p).eq('id', tpl.id).select('*').limit(1)
            : SB.from(CON_NOTE_TEMPLATES_TABLE).insert([p]).select('*').limit(1);
        q.then(function(r) {
            if (!r.error) {
                var row = (r.data && r.data[0]) ? r.data[0] : Object.assign({ id: tpl.id }, p);
                if (done) done(null, conNormalizeTemplateRow(row));
                return;
            }
            var msg = String(r.error.message || '').toLowerCase();
            if (!retried && (msg.indexOf('clinic_tag') >= 0 || msg.indexOf('created_by') >= 0)) {
                var p2 = Object.assign({}, p);
                delete p2.clinic_tag;
                delete p2.created_by;
                doWrite(p2, true);
                return;
            }
            if (done) done(r.error, null);
        }).catch(function(e) {
            if (done) done(e, null);
        });
    }
    doWrite(payload, false);
}

function conDeleteTemplateRemote(id, done) {
    if (!SB || typeof SB.from !== 'function') {
        if (done) done(new Error('Supabase not ready'));
        return;
    }
    SB.from(CON_NOTE_TEMPLATES_TABLE).delete().eq('id', id)
    .then(function(r) {
        if (done) done(r.error || null);
    })
    .catch(function(e) {
        if (done) done(e);
    });
}

function conSaveNoteAsTemplate() {
    if (typeof programSettingBool === 'function' && !programSettingBool('add_medical_term', true)) {
        alert(conTr('con.note.addTermDisabled'));
        return;
    }
    var inp = g('conNoteInput');
    if (!inp) return;
    var txt = String(inp.value || '').trim();
    if (!txt) {
        alert(conTr('con.note.alertEnterNote'));
        return;
    }
    var nm = prompt(conTr('con.note.templateNamePrompt'), '');
    if (nm == null) return;
    nm = String(nm || '').trim();
    if (!nm) {
        alert(conTr('con.note.alertTemplateName'));
        return;
    }

    conFetchNoteTemplates(function(list) {
        list = list || [];
        var idx = -1;
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].name || '').toLowerCase() === nm.toLowerCase()) {
                idx = i;
                break;
            }
        }
        var tpl = idx >= 0 ? list[idx] : null;
        if (tpl && !confirm(conTrRepl('con.note.confirmOverwriteTemplate', { NAME: nm }))) return;
        conSaveTemplateRemote({
            id: tpl ? tpl.id : null,
            name: nm,
            content: txt
        }, function(err) {
            if (err) {
                alert(trRepl('appt.msg.error', { MSG: err.message || String(err) }));
                return;
            }
            conFetchNoteTemplates(function() {
                alert(conTrRepl('con.note.templateSaved', { NAME: nm }));
            });
        });
    });
}

function conRenderNoteTemplateSelect(preferId) {
    var sel = g('conNoteTemplateSelect');
    if (!sel) return [];
    var list = conGetNoteTemplates();
    if (!list.length) {
        sel.innerHTML = '<option value="">' + esc(conTr('con.note.noTemplates')) + '</option>';
        sel.disabled = true;
        var delBtn0 = g('conNoteTemplateDeleteBtn');
        var saveBtn0 = g('conNoteTemplateSaveBtn');
        var applyBtn0 = g('conNoteTemplateApplyBtn');
        if (delBtn0) delBtn0.disabled = true;
        if (saveBtn0) saveBtn0.disabled = true;
        if (applyBtn0) applyBtn0.disabled = true;
        return list;
    }
    sel.disabled = false;
    sel.innerHTML = list.map(function(t, i) {
        var when = '';
        if (t.updated_at) {
            var d = new Date(t.updated_at);
            if (!isNaN(d.getTime())) {
                when = ' · ' + d.toLocaleDateString(conUiLocale(), { day: '2-digit', month: 'short' });
            }
        }
        return '<option value="' + esc(t.id || String(i)) + '">' +
            esc(t.name + when) + '</option>';
    }).join('');
    if (preferId) sel.value = String(preferId);
    if (!sel.value && sel.options.length) sel.selectedIndex = 0;
    var delBtn = g('conNoteTemplateDeleteBtn');
    var saveBtn = g('conNoteTemplateSaveBtn');
    var applyBtn = g('conNoteTemplateApplyBtn');
    if (delBtn) delBtn.disabled = false;
    if (saveBtn) saveBtn.disabled = false;
    if (applyBtn) applyBtn.disabled = false;
    return list;
}

function conLoadTemplateEditorFields() {
    var sel = g('conNoteTemplateSelect');
    var nm = g('conNoteTemplateNameInput');
    var ct = g('conNoteTemplateContentInput');
    if (!sel || !nm || !ct) return;
    var list = conGetNoteTemplates();
    var picked = conFindTemplateById(list, sel.value);
    if (!picked) {
        nm.value = '';
        ct.value = '';
        return;
    }
    nm.value = picked.name || '';
    ct.value = picked.content || '';
}

function conOpenTemplatePicker() {
    conFetchNoteTemplates(function(list) {
        conRenderNoteTemplateSelect();
        if (!list || !list.length) {
            alert(conTr('con.note.noTemplates'));
            return;
        }
        openModal('conNoteTemplateModal');
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(g('conNoteTemplateModal'));
        conLoadTemplateEditorFields();
    });
}

function conApplyTemplateToNote() {
    var sel = g('conNoteTemplateSelect');
    var inp = g('conNoteInput');
    var ct = g('conNoteTemplateContentInput');
    if (!sel || !inp || !ct) return;
    var id = String(sel.value || '');
    if (!id) return;
    inp.value = String(ct.value || '').trim();
    inp.focus();
    closeModal('conNoteTemplateModal');
}

function conSaveTemplateEdits() {
    if (typeof programSettingBool === 'function' && !programSettingBool('add_medical_term', true)) {
        alert(conTr('con.note.addTermDisabled'));
        return;
    }
    var sel = g('conNoteTemplateSelect');
    var nm = g('conNoteTemplateNameInput');
    var ct = g('conNoteTemplateContentInput');
    if (!sel || !nm || !ct) return;
    var id = String(sel.value || '');
    if (!id) return;

    var name = String(nm.value || '').trim();
    var content = String(ct.value || '').trim();
    if (!name) {
        alert(conTr('con.note.alertTemplateName'));
        nm.focus();
        return;
    }
    if (!content) {
        alert(conTr('con.note.alertEnterNote'));
        ct.focus();
        return;
    }

    var list = conGetNoteTemplates();
    var current = conFindTemplateById(list, id);
    if (!current) return;

    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id || String(i)) === id) continue;
        if (String(list[i].name || '').toLowerCase() === name.toLowerCase()) {
            alert(conTrRepl('con.note.templateNameExists', { NAME: name }));
            nm.focus();
            return;
        }
    }

    conSaveTemplateRemote({
        id: current.id,
        name: name,
        content: content
    }, function(err, saved) {
        if (err) {
            alert(trRepl('appt.msg.error', { MSG: err.message || String(err) }));
            return;
        }
        conFetchNoteTemplates(function() {
            conRenderNoteTemplateSelect(saved ? saved.id : current.id);
            conLoadTemplateEditorFields();
            alert(conTrRepl('con.note.templateUpdated', { NAME: name }));
        });
    });
}

function conDeleteTemplate() {
    if (typeof programSettingBool === 'function' && !programSettingBool('add_medical_term', true)) {
        alert(conTr('con.note.addTermDisabled'));
        return;
    }
    var sel = g('conNoteTemplateSelect');
    if (!sel) return;
    var id = String(sel.value || '');
    if (!id) return;

    var list = conGetNoteTemplates();
    var current = conFindTemplateById(list, id);
    if (!current) return;

    if (!confirm(conTrRepl('con.note.confirmDeleteTemplate', { NAME: current.name || '' }))) return;

    conDeleteTemplateRemote(id, function(err) {
        if (err) {
            alert(trRepl('appt.msg.error', { MSG: err.message || String(err) }));
            return;
        }
        conFetchNoteTemplates(function(next) {
            next = next || [];
            if (!next.length) {
                closeModal('conNoteTemplateModal');
                alert(conTr('con.note.noTemplates'));
                return;
            }
            conRenderNoteTemplateSelect(next[0].id || '');
            conLoadTemplateEditorFields();
            alert(conTrRepl('con.note.templateDeleted', { NAME: current.name || '' }));
        });
    });
}

function saveConNote() {
    if (!conPatientId) { alert(conTr('con.note.alertSelectPatient')); return; }
    var inp  = g('conNoteInput');
    var note = (inp.value || '').trim();
    if (!note) { alert(conTr('con.note.alertEnterNote')); return; }

    var row = {
        patient_id:   conPatientId,
        dentist_name: conActiveDoctorName || currentName || null,
        doctor_id:    conActiveDoctorId || null,
        doctor_name:  conActiveDoctorName || currentName || null,
        doctor_tag:   conActiveDoctorTag || conActiveDoctorName || currentName || null,
        notes:        note
    };

    var ctNote = (typeof currentClinicCodeForTagging === 'function'
            ? currentClinicCodeForTagging()
            : '') ||
        (conPatientData && conPatientData[PATIENT_CLINIC_TAG_FIELD]
            ? conPatientData[PATIENT_CLINIC_TAG_FIELD]
            : '');
    if (ctNote) row[TREATMENT_CLINIC_TAG_FIELD] = ctNote;

    SB.from('treatments').insert([withWorkingCreatedAt(row)])
    .then(function(r) {
        if (!r.error) {
            inp.value = '';
            loadConNotes(conPatientId);
            conSchedulePatientTimelineRefresh(conPatientId);
            return;
        }
        var msg = String(r.error.message || '').toLowerCase();
        if (msg.indexOf('clinic_tag') >= 0 && row[TREATMENT_CLINIC_TAG_FIELD]) {
            var rowCt = Object.assign({}, row);
            delete rowCt[TREATMENT_CLINIC_TAG_FIELD];
            SB.from('treatments').insert([withWorkingCreatedAt(rowCt)])
            .then(function(rc) {
                if (!rc.error) {
                    inp.value = '';
                    loadConNotes(conPatientId);
                    return;
                }
                var msg2 = String(rc.error.message || '').toLowerCase();
                if (msg2.indexOf('doctor_tag') >= 0 || msg2.indexOf('doctor_id') >= 0 ||
                    msg2.indexOf('doctor_name') >= 0) {
                    var legacyRow = {
                        patient_id: rowCt.patient_id,
                        dentist_name: rowCt.dentist_name,
                        notes: rowCt.notes
                    };
                    SB.from('treatments').insert([withWorkingCreatedAt(legacyRow)])
                    .then(function(r2) {
                        if (r2.error) { alert(trRepl('appt.msg.error', { MSG: r2.error.message })); return; }
                        inp.value = '';
                        loadConNotes(conPatientId);
                    });
                    return;
                }
                alert(trRepl('appt.msg.error', { MSG: rc.error.message }));
            });
            return;
        }
        if (msg.indexOf('doctor_tag') >= 0 || msg.indexOf('doctor_id') >= 0 || msg.indexOf('doctor_name') >= 0) {
            var legacyRow = {
                patient_id: row.patient_id,
                dentist_name: row.dentist_name,
                notes: row.notes
            };
            SB.from('treatments').insert([withWorkingCreatedAt(legacyRow)])
            .then(function(r2) {
                if (r2.error) { alert(trRepl('appt.msg.error', { MSG: r2.error.message })); return; }
                inp.value = '';
                loadConNotes(conPatientId);
            });
            return;
        }
        alert(trRepl('appt.msg.error', { MSG: r.error.message }));
    });
}

function editConNote(nid, rawText) {
    var div = g('cnt-' + nid);
    if (!div) return;

    div.innerHTML =
        '<textarea id="cne-' + nid + '" ' +
        'style="width:100%;height:80px;padding:8px;' +
        'border:1px solid #ddd;border-radius:6px;' +
        'font-size:14px;box-sizing:border-box;' +
        'resize:vertical;"></textarea>' +
        '<div style="display:flex;justify-content:space-between;' +
        'margin-top:8px;">' +
            '<button id="cnd-' + nid + '" ' +
            'style="background:var(--danger);color:white;' +
            'border:none;padding:5px 12px;border-radius:4px;' +
            'cursor:pointer;">' + esc(conTr('common.btnDelete')) + '</button>' +
            '<div style="display:flex;gap:8px;">' +
                '<button id="cnc-' + nid + '" ' +
                'style="background:var(--gray);color:white;' +
                'border:none;padding:5px 12px;border-radius:4px;' +
                'cursor:pointer;">' + esc(conTr('common.btnCancel')) + '</button>' +
                '<button id="cns-' + nid + '" ' +
                'style="background:var(--success);color:white;' +
                'border:none;padding:5px 12px;border-radius:4px;' +
                'cursor:pointer;">' + esc(conTr('common.btnSave')) + '</button>' +
            '</div>' +
        '</div>';

    g('cne-' + nid).value = rawText || '';

    g('cnd-' + nid).addEventListener('click', function() {
        if (!confirm(conTr('con.note.deleteConfirm'))) return;
        SB.from('treatments').delete().eq('id', nid)
        .then(function(r) {
            if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
            loadConNotes(conPatientId);
        });
    });
    g('cnc-' + nid).addEventListener('click', function() {
        loadConNotes(conPatientId);
    });
    g('cns-' + nid).addEventListener('click', function() {
        var v = (g('cne-' + nid).value || '').trim();
        SB.from('treatments').update({ notes: v }).eq('id', nid)
        .then(function(r) {
            if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
            loadConNotes(conPatientId);
        });
    });
}

// ════════════════════════════════════════════════════════════════
// DRUG PANEL — TOGGLE
// ════════════════════════════════════════════════════════════════

/** Index of first line missing drug name or days (−1 = all OK). */
function rxFirstInvalidDrugLineIdx() {
    for (var i = 0; i < rxLines.length; i++) {
        var l = rxLines[i];
        if (typeof rxNormalizeLine === 'function') l = rxNormalizeLine(l);
        var hasName = !!(l.drug_name && String(l.drug_name).trim());
        if (!hasName) return i;
        var hasDays = !!(
            String(l.duration_code || '').trim() ||
            String(l.duration_custom || '').trim() ||
            String(l.duration || '').trim()
        );
        if (!hasDays) return i;
    }
    return -1;
}

/**
 * opts.keepRxLines — do not wipe rxLines or re-render empty (opening modal / continuing draft).
 */
function toggleDrugAddPanel(show, opts) {
    opts = opts || {};
    var panel = g('drugAddPanel');
    var btn   = g('btnAddPrescription');
    if (!panel || !btn) return;

    if (show) {
        var wasHidden = panel.style.display === 'none' || !panel.style.display;

        panel.style.display = 'block';
        btn.style.display   = 'none';

        if (!opts.editingHistory && !opts.keepRxLines) {
            rxClearEditingHistoryGroup();
        }

        if (!opts.keepRxLines) {
            rxLines = [];
            rxStagedLines = [];
        }
        if (!rxLines.length) {
            rxLines.push(typeof rxEmptyLine === 'function' ? rxEmptyLine() : {
                drug_id: '', drug_name: '', dosage: '',
                frequency: '', duration: '', route: '',
                quantity: '', remarks: ''
            });
        }

        if (!opts.keepRxLines || wasHidden ||
            !String((g('rxDate') && g('rxDate').value) || '').trim()) {
            sv('rxDate',        todayISO());
            sv('rxDentistName', conActiveDoctorName || currentName || '');
        }

        if (typeof ensureRxPhrasesLoaded === 'function') {
            ensureRxPhrasesLoaded(function() {
                renderRxLines();
                renderRxStagedList();
            });
        } else {
            renderRxLines();
            renderRxStagedList();
        }
    } else {
        panel.style.display = 'none';
        btn.style.display   = 'inline-block';
        rxLines = [];
        rxStagedLines = [];
        rxClearEditingHistoryGroup();
    }
}

// ════════════════════════════════════════════════════════════════
// RX LINES — RENDER
// ════════════════════════════════════════════════════════════════
function addDrugLine() {
    rxLines.push(typeof rxEmptyLine === 'function' ? rxEmptyLine() : {
        drug_id: '', drug_name: '', dosage: '',
        frequency: '', duration: '', route: '',
        quantity: '', remarks: ''
    });
    renderRxLines();
}

function removeRxLine(idx) {
    rxLines.splice(idx, 1);
    renderRxLines();
}

function rxRemoveStagedLine(idx) {
    if (idx < 0 || idx >= rxStagedLines.length) return;
    rxStagedLines.splice(idx, 1);
    renderRxStagedList();
}

function rxLineDisplayMeta(line) {
    line = line || {};
    if (typeof rxNormalizeLine === 'function') line = rxNormalizeLine(line);
    if (typeof rxSyncLineLegacyFields === 'function') rxSyncLineLegacyFields(line);
    var lang = typeof rxUiPhraseLang === 'function' ? rxUiPhraseLang() : 'en';
    var dosage = typeof rxPhraseDisplay === 'function'
        ? rxPhraseDisplay(line, 'dosage', 'en') : (line.dosage || '');
    var dosageZh = typeof rxPhraseDisplay === 'function'
        ? rxPhraseDisplay(line, 'dosage', 'zh') : '';
    var freq = typeof rxPhraseDisplay === 'function'
        ? rxPhraseDisplay(line, 'frequency', 'en') : (line.frequency || '');
    var freqZh = typeof rxPhraseDisplay === 'function'
        ? rxPhraseDisplay(line, 'frequency', 'zh') : '';
    var days = typeof rxPhraseDisplay === 'function'
        ? rxPhraseDisplay(line, 'duration', 'en') : (line.duration || '');
    var daysZh = typeof rxPhraseDisplay === 'function'
        ? rxPhraseDisplay(line, 'duration', 'zh') : '';
    var qty = typeof rxLineQuantityText === 'function'
        ? rxLineQuantityText(line) : (line.quantity || '');
    return {
        dosage: typeof drugFormatBilingualDisplay === 'function'
            ? drugFormatBilingualDisplay(dosage, dosageZh, lang) : dosage,
        frequency: typeof drugFormatBilingualDisplay === 'function'
            ? drugFormatBilingualDisplay(freq, freqZh, lang) : freq,
        duration: typeof drugFormatBilingualDisplay === 'function'
            ? drugFormatBilingualDisplay(days, daysZh, lang) : days,
        quantity: qty
    };
}

function renderRxStagedList() {
    var wrap = g('rxStagedWrap');
    var list = g('rxStagedList');
    if (!wrap || !list) return;

    if (!rxStagedLines.length) {
        wrap.style.display = 'none';
        list.innerHTML = '';
        return;
    }

    wrap.style.display = 'block';
    list.innerHTML = rxStagedLines.map(function(line, idx) {
        var meta = rxLineDisplayMeta(line);
        return (
            '<div class="rx-staged-row">' +
            '<div class="rx-staged-main">' +
            '<strong class="rx-staged-drug">' + esc(line.drug_name || '—') + '</strong>' +
            '<span class="rx-staged-meta">' +
            esc(meta.dosage) +
            (meta.frequency ? ' · ' + esc(meta.frequency) : '') +
            (meta.duration ? ' · ' + esc(meta.duration) : '') +
            '</span>' +
            '</div>' +
            '<div class="rx-staged-qty">' +
            '<span class="rx-staged-qty-label">' + esc(conTr('con.rx.labelQty')) + '</span> ' +
            '<strong>' + esc(meta.quantity || '—') + '</strong>' +
            '</div>' +
            '<button type="button" class="rx-staged-remove" ' +
            'onclick="rxRemoveStagedLine(' + idx + ')" title="' +
            esc(conTr('common.btnDelete')) + '">✕</button>' +
            '</div>'
        );
    }).join('');
}

function rxAllDraftLinesForSave() {
    var out = [];
    var i;
    for (i = 0; i < rxStagedLines.length; i++) {
        out.push(rxCloneSavedLine(rxStagedLines[i]));
    }
    for (i = 0; i < rxLines.length; i++) {
        if (typeof rxSyncLineFromDom === 'function') rxSyncLineFromDom(i);
        var l = rxLines[i];
        if (typeof rxNormalizeLine === 'function') l = rxNormalizeLine(l);
        var hasName = !!(l.drug_name && String(l.drug_name).trim());
        var hasDays = !!(
            String(l.duration_code || '').trim() ||
            String(l.duration_custom || l.duration || '').trim()
        );
        if (!hasName || !hasDays) continue;
        var qty = typeof rxComputeQuantityFromLine === 'function'
            ? rxComputeQuantityFromLine(l) : '';
        if (qty) rxApplyComboTextToLine(l, 'quantity', qty);
        if (typeof rxSyncLineLegacyFields === 'function') rxSyncLineLegacyFields(l);
        rxLines[i] = l;
        out.push(rxCloneSavedLine(l));
    }
    return out;
}

function renderRxLines() {
    var wrap = g('rxLinesWrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    if (!rxLines.length) {
        wrap.innerHTML =
            '<p style="color:#aaa;font-size:13px;padding:8px 0;">' +
            esc(conTr('con.rx.noDrugsYet')) + '</p>';
        return;
    }

    rxLines.forEach(function(line, idx) {
        if (typeof rxNormalizeLine === 'function') {
            line = rxNormalizeLine(line);
            rxLines[idx] = line;
        }
        var card = document.createElement('div');
        card.className = 'rx-line-card';
        card.id = 'rxline-' + idx;
        card.innerHTML =
            '<div class="rx-line-header">' +
                '<span class="rx-line-num">' + esc(conTrRepl('con.rx.lineNumFmt', { N: String(idx + 1) })) + '</span>' +
                '<div class="rx-line-actions">' +
                    (typeof rxAddToListBtnMarkup === 'function'
                        ? rxAddToListBtnMarkup(idx, line)
                        : '') +
                    '<button class="btn-label-en" ' +
                    'onclick="printRxLineLabelEn(this)" ' +
                    'title="' + esc(conTr('con.rx.printLabelEn')) + '">' + esc(conTr('con.rx.btnPrintEn')) + '</button>' +
                    '<button class="btn-label-zh" ' +
                    'onclick="printRxLineLabelZh(this)" ' +
                    'title="' + esc(conTr('con.rx.printLabelZh')) + '">' + esc(conTr('con.rx.btnPrintZh')) + '</button>' +
                    '<button class="btn-remove-rx btn-sm" ' +
                    'style="background:var(--danger);" ' +
                    'onclick="removeRxLine(' + idx + ')">✕</button>' +
                '</div>' +
            '</div>' +
            '<div class="rx-fields rx-fields--quick">' +
                '<div class="rx-field-drug">' +
                    '<label class="rx-phrase-label">' + esc(conTr('con.rx.labelDrug')) + '</label>' +
                    '<select id="rxSel-' + idx + '" class="rx-drug-sel">' +
                    '<option value="">' + esc(conTr('con.rx.selectDrug')) + '</option>' +
                    '</select>' +
                '</div>' +
                (typeof rxDaysFieldMarkup === 'function'
                    ? rxDaysFieldMarkup(idx, line)
                    : '') +
                (typeof rxAutoLoadedSummaryMarkup === 'function'
                    ? rxAutoLoadedSummaryMarkup(idx, line)
                    : '') +
                '<details class="rx-advanced-details">' +
                    '<summary>' + esc(conTr('con.rx.advancedDetails')) + '</summary>' +
                    '<div class="rx-advanced-grid">' +
                        (typeof rxPhraseFieldMarkup === 'function'
                            ? rxPhraseFieldMarkup('dosage', idx, line, conTr('con.rx.labelDosage'))
                            : '') +
                        (typeof rxPhraseFieldMarkup === 'function'
                            ? rxPhraseFieldMarkup('frequency', idx, line, conTr('con.rx.labelFrequency'))
                            : '') +
                        (typeof rxPhraseFieldMarkup === 'function'
                            ? rxPhraseFieldMarkup('quantity', idx, line, conTr('con.rx.labelQty'))
                            : '') +
                    '</div>' +
                '</details>' +
                '<div class="rx-caution-notes-wrap">' +
                    (typeof rxDrugCautionNotesMarkup === 'function'
                        ? rxDrugCautionNotesMarkup(idx, line)
                        : '') +
                '</div>' +
                '<div class="rx-phrase-preview"></div>' +
            '</div>';

        wrap.appendChild(card);
        populateDrugSelect(idx);
        if (typeof rxUpdatePhrasePreview === 'function') rxUpdatePhrasePreview(idx);
    });
}

// ════════════════════════════════════════════════════════════════
// POPULATE DRUG SELECT FROM druglist TABLE
// ════════════════════════════════════════════════════════════════
function populateDrugSelect(idx) {
    var sel = g('rxSel-' + idx);
    if (!sel) return;

    var line     = rxLines[idx] || {};
    var wantId   = line.drug_id ? String(line.drug_id) : '';
    var wantNorm = line.drug_name ? String(line.drug_name).trim().toLowerCase() : '';

    function fillFromDrugData(r) {
        if (r.error || !r.data) return;

        sel.innerHTML =
            '<option value="">' + esc(conTr('con.rx.selectDrug')) + '</option>';

        var pickedCatalog  = false;
        var matchedByName  = false;

        var cats = {};
        r.data.forEach(function(d) {
            var catKey = d.category || '';
            if (!cats[catKey]) {
                cats[catKey] = { label: conDrugCatLabel(catKey), items: [] };
            }
            cats[catKey].items.push(d);
        });

        Object.keys(cats).sort().forEach(function(catKey) {
            var og = document.createElement('optgroup');
            og.label = cats[catKey].label;
            cats[catKey].items.forEach(function(d) {
                var o = document.createElement('option');
                o.value = d.id;
                o.dataset.name      = d.drug_name  || '';
                o.dataset.dosage    = d.dosage    || '';
                o.dataset.frequency = d.frequency || '';
                o.dataset.duration  = d.duration  || '';
                o.dataset.route     = d.route     || '';
                var dRem = (typeof drugUnpackRemarks === 'function')
                    ? drugUnpackRemarks(d)
                    : { intakeEn: '', intakeZh: '', generalEn: d.remarks || '', generalZh: '' };
                o.dataset.intakeRemarks = typeof drugPackBilingualText === 'function'
                    ? drugPackBilingualText(dRem.intakeEn, dRem.intakeZh)
                    : (dRem.intakeEn || dRem.intakeZh || '');
                o.dataset.remarks = typeof drugPackBilingualText === 'function'
                    ? drugPackBilingualText(dRem.generalEn, dRem.generalZh)
                    : (dRem.generalEn || dRem.generalZh || '');
                var dosePair = typeof drugCatalogFieldPair === 'function'
                    ? drugCatalogFieldPair(d, 'dosage')
                    : { en: d.dosage || '', zh: '' };
                var doseLbl = typeof drugFormatBilingualDisplay === 'function'
                    ? drugFormatBilingualDisplay(dosePair.en, dosePair.zh,
                        typeof rxUiPhraseLang === 'function' ? rxUiPhraseLang() : 'en')
                    : (d.dosage || '');
                o.textContent =
                    d.drug_name +
                    (doseLbl ? ' (' + doseLbl + ')' : '');

                var idHit =
                    !!(wantId && rxLines[idx] && String(d.id) === String(wantId));

                var dn = String(d.drug_name || '').trim().toLowerCase();
                var nameHit =
                    !!(wantNorm && dn === wantNorm);

                if (idHit) {
                    o.selected    = true;
                    pickedCatalog = true;
                    rxLines[idx].intake_remarks = o.dataset.intakeRemarks || '';
                    rxLines[idx].remarks   = o.dataset.remarks || '';
                    if (typeof rxApplyCatalogDefaultsToLine === 'function') {
                        rxApplyCatalogDefaultsToLine(idx, {
                            dosage:    o.dataset.dosage,
                            frequency: o.dataset.frequency,
                            duration:  o.dataset.duration,
                            intake_remarks: o.dataset.intakeRemarks || '',
                            remarks: o.dataset.remarks || ''
                        });
                    }
                } else if (nameHit && !matchedByName &&
                    rxLines[idx] && !pickedCatalog) {
                    o.selected         = true;
                    pickedCatalog      = true;
                    matchedByName      = true;
                    rxLines[idx].drug_id   = String(d.id);
                    rxLines[idx].drug_name =
                        d.drug_name || rxLines[idx].drug_name || '';
                    rxLines[idx].intake_remarks = o.dataset.intakeRemarks || '';
                    rxLines[idx].remarks   = o.dataset.remarks || '';
                    if (typeof rxApplyCatalogDefaultsToLine === 'function') {
                        rxApplyCatalogDefaultsToLine(idx, {
                            dosage:    o.dataset.dosage,
                            frequency: o.dataset.frequency,
                            duration:  o.dataset.duration,
                            intake_remarks: o.dataset.intakeRemarks || '',
                            remarks: o.dataset.remarks || ''
                        });
                    }
                }

                og.appendChild(o);
            });
            sel.appendChild(og);
        });

        if (!pickedCatalog && wantNorm && rxLines[idx] && rxLines[idx].drug_name) {
            var ogImp = document.createElement('optgroup');
            ogImp.label = conTr('con.rx.fromSavedRx');
            var ox = document.createElement('option');
            ox.value       = RX_SNAPSHOT_SELECT;
            ox.textContent = String(rxLines[idx].drug_name).trim()
                ? (rxLines[idx].drug_name + conTr('con.rx.pickCatalogLink'))
                : conTr('con.rx.importedPickCatalog');
            ox.selected = true;
            ogImp.appendChild(ox);
            sel.appendChild(ogImp);
        }

        sel.onchange = function() {
            var opt = sel.options[sel.selectedIndex];
            if (!opt || !opt.value) return;
            if (opt.value === RX_SNAPSHOT_SELECT) return;

            rxLines[idx].drug_id   = opt.value;
            rxLines[idx].drug_name = opt.dataset.name;
            rxLines[idx].intake_remarks = opt.dataset.intakeRemarks || '';
            rxLines[idx].remarks   = opt.dataset.remarks || '';

            if (typeof rxApplyCatalogDefaultsToLine === 'function') {
                rxApplyCatalogDefaultsToLine(idx, {
                    dosage:    opt.dataset.dosage,
                    frequency: opt.dataset.frequency,
                    duration:  opt.dataset.duration,
                    intake_remarks: opt.dataset.intakeRemarks || '',
                    remarks: opt.dataset.remarks || ''
                });
            } else if (typeof rxApplyCatalogTextToLine === 'function') {
                rxApplyCatalogTextToLine(idx, {
                    dosage:    opt.dataset.dosage,
                    frequency: opt.dataset.frequency,
                    duration:  opt.dataset.duration,
                    quantity:  opt.dataset.quantity || ''
                });
            } else {
                rxLines[idx].dosage    = opt.dataset.dosage;
                rxLines[idx].frequency = opt.dataset.frequency;
                rxLines[idx].duration  = opt.dataset.duration;
            }
            rxLines[idx].route = opt.dataset.route || '';

            renderRxLines();
            var daysSel = g('rx-days-sel-' + idx);
            if (daysSel) {
                try { daysSel.focus(); } catch (_) {}
            }
        };
    }

    function loadDrugRows(selectCols, onDone) {
        SB.from('druglist')
            .select(selectCols)
            .eq('is_active', true)
            .order('category', { ascending: true })
            .order('drug_name', { ascending: true })
        .then(function(r) {
            if (!r.error && r.data && r.data.length) {
                onDone(r);
                return;
            }
            if (selectCols.indexOf('intake_caution') >= 0) {
                loadDrugRows(
                    'id,drug_name,category,dosage,frequency,duration,route,remarks',
                    onDone
                );
                return;
            }
            onDone(r);
        });
    }

    loadDrugRows(
        'id,drug_name,category,dosage,frequency,duration,route,remarks,intake_caution',
        function(r) {
            if (!r.error && r.data && r.data.length) {
                fillFromDrugData(r);
                return;
            }
            SB.from('druglist')
                .select('id,drug_name,category,dosage,frequency,duration,route,remarks')
                .order('category', { ascending: true })
                .order('drug_name', { ascending: true })
            .then(fillFromDrugData);
        }
    );
}

// ════════════════════════════════════════════════════════════════
// SAVED MULTI-DRUG LISTS (combinations stored in browser)
// ════════════════════════════════════════════════════════════════

function readRxComboListsStorage() {
    try {
        var raw = localStorage.getItem(RX_COMBO_LISTS_KEY);
        if (!raw) return [];
        var a = JSON.parse(raw);
        return Array.isArray(a) ? a : [];
    } catch (e) {
        return [];
    }
}

function writeRxComboListsStorage(lists) {
    try {
        localStorage.setItem(RX_COMBO_LISTS_KEY, JSON.stringify(lists || []));
    } catch (e) {
        alert(conTrRepl('con.rx.storageWriteFail', { MSG: (e.message || e) }));
    }
}

function rxNewComboListId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'lst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
}

function rxCloneSavedLine(src) {
    var l = src || {};
    var out = {
        drug_id:    String(l.drug_id   || ''),
        drug_name:  String(l.drug_name || ''),
        dosage:     String(l.dosage    || ''),
        frequency:  String(l.frequency || ''),
        duration:   String(l.duration  || ''),
        route:      String(l.route     || ''),
        quantity:   String(l.quantity  || ''),
        intake_remarks: String(l.intake_remarks || ''),
        remarks:    String(l.remarks   || ''),
        dosage_code: String(l.dosage_code || ''),
        dosage_custom: String(l.dosage_custom || ''),
        frequency_code: String(l.frequency_code || ''),
        frequency_custom: String(l.frequency_custom || ''),
        duration_code: String(l.duration_code || ''),
        duration_custom: String(l.duration_custom || ''),
        route_code: String(l.route_code || ''),
        route_custom: String(l.route_custom || ''),
        quantity_code: String(l.quantity_code || ''),
        quantity_custom: String(l.quantity_custom || '')
    };
    if (typeof rxNormalizeLine === 'function') rxNormalizeLine(out);
    return out;
}

function rxSnapshotFromDrughistoryRecords(records) {
    return (records || []).map(function(r) {
        return rxCloneSavedLine({
            drug_id:   r.drug_id   !== undefined ? r.drug_id : '',
            drug_name: r.drug_name !== undefined ? r.drug_name : '',
            dosage:    r.dosage,
            frequency: r.frequency,
            duration:  r.duration,
            route:     r.route,
            quantity:  r.quantity,
            intake_remarks: r.intake_remarks,
            remarks:   r.remarks
        });
    });
}

/** Every line must identify a drug by name (master list rows may omit drug_id, e.g. from history). */
function rxFirstMissingDrugNameIdx(lines) {
    for (var i = 0; i < lines.length; i++) {
        var dn = lines[i].drug_name && String(lines[i].drug_name).trim();
        if (!dn) return i;
    }
    return -1;
}

/** Store a cloned line array under a user-named list (draft or history snapshot). Returns true if saved. */
function rxPersistNamedComboList(snapshot, promptHintCtx) {
    if (!snapshot || !snapshot.length) {
        alert(conTr('con.rx.nothingToSaveList'));
        return false;
    }
    var miss = rxFirstMissingDrugNameIdx(snapshot);
    if (miss >= 0) {
        alert(conTrRepl('con.rx.rowNoDrugName', { N: miss + 1 }));
        return false;
    }

    var promptLine = promptHintCtx
        ? conTrRepl('con.rx.promptNameComboFrom', { CTX: promptHintCtx })
        : conTr('con.rx.promptNameCombo');
    var name = prompt(promptLine, '');
    name = String(name || '').trim();
    if (!name) return false;

    var lists    = readRxComboListsStorage();
    var lowered  = name.toLowerCase();
    var dupeIdx  = lists.findIndex(function(x) {
        return String(x.name || '').toLowerCase() === lowered;
    });
    var safeName = String(name).replace(/"/g, "'");
    if (dupeIdx >= 0 &&
        !confirm(conTrRepl('con.rx.confirmReplaceList', { NAME: safeName })))
        return false;

    var payloadLines = snapshot.map(rxCloneSavedLine);
    var id           = rxNewComboListId();
    if (dupeIdx >= 0) id = lists[dupeIdx].id;

    var payload = {
        id:         id,
        name:       name,
        lines:      payloadLines,
        updated_at: new Date().toISOString()
    };
    if (dupeIdx >= 0) lists[dupeIdx] = payload;
    else lists.unshift(payload);

    writeRxComboListsStorage(lists);
    alert(conTrRepl('con.rx.savedListOk', { NAME: safeName, N: payloadLines.length }));
    return true;
}

function rxSaveCurrentAsComboList() {
    var panel = g('drugAddPanel');
    if (!panel || panel.style.display === 'none' || !panel.style.display) {
        toggleDrugAddPanel(true, { keepRxLines: true });
    }

    if (!rxLines.length) {
        alert(conTr('con.rx.addLinesFirst'));
        return;
    }

    var draft = rxAllDraftLinesForSave();
    if (!draft.length) {
        alert(conTr('con.rx.addLinesFirst'));
        return;
    }

    rxPersistNamedComboList(draft);
}

function rxSaveComboListFromHistoryRecords(records) {
    var snap = rxSnapshotFromDrughistoryRecords(records);
    if (!snap.length) {
        alert(conTr('con.rx.entryNoLines'));
        return;
    }
    rxPersistNamedComboList(snap, conTr('con.rx.historyFrom'));
}

function rxOpenDrugListsPicker() {
    var panel = g('drugAddPanel');
    if (!panel || panel.style.display === 'none' || !panel.style.display) {
        toggleDrugAddPanel(true, { keepRxLines: true });
    }
    rxRenderSavedDrugListsModal();
    openModal('rxDrugListsModal');
}

/** Show prescription draft toolbar without clearing rxLines. */
function rxEnsureRxDraftChromeOnly() {
    var addPanel = g('drugAddPanel');
    var addBtn   = g('btnAddPrescription');
    if (addPanel && addBtn &&
        (addPanel.style.display === 'none' || !addPanel.style.display)) {
        addPanel.style.display = 'block';
        addBtn.style.display   = 'none';
        if (!String((g('rxDate') && g('rxDate').value) || '').trim()) {
            sv('rxDate',        todayISO());
            sv('rxDentistName', conActiveDoctorName || currentName || '');
        }
    }
}

/**
 * Load a saved history group into the Rx draft editor.
 * opts.append — add lines to current draft; otherwise replace draft.
 * opts.scrollToPanel — scroll the add-prescription panel into view.
 */
function rxLoadHistoryGroupIntoDraft(records, opts) {
    opts = opts || {};
    if (!conPatientId || !conPatientData) {
        alert(conTr('con.forms.alertSelectPatient'));
        return false;
    }
    var snap = rxSnapshotFromDrughistoryRecords(records);
    if (!snap.length) {
        alert(conTr('con.rx.historyNoLines'));
        return false;
    }
    var miss = rxFirstMissingDrugNameIdx(snap);
    if (miss >= 0) {
        alert(conTrRepl('con.rx.cannotReapplyRow', { N: miss + 1 }));
        return false;
    }

    if (opts.append) {
        rxClearEditingHistoryGroup();
        rxEnsureRxDraftChromeOnly();
        snap.forEach(function(line) {
            rxLines.push(rxCloneSavedLine(line));
        });
    } else {
        toggleDrugAddPanel(true, {
            keepRxLines: false,
            editingHistory: !!opts.editingHistory
        });
        rxLines = snap.map(rxCloneSavedLine);
        if (opts.editingHistory) {
            rxSetEditingHistoryGroup(records);
        } else {
            rxClearEditingHistoryGroup();
        }
    }

    var first = records[0];
    if (first) {
        sv('rxDate', String(first.prescribed_date || '').trim() || todayISO());
        var histDr = String(first.dentist_name || first.doctor_name || first.doctor_tag || '').trim();
        if (typeof stripDoctorTagPrefix === 'function') histDr = stripDoctorTagPrefix(histDr);
        sv('rxDentistName', histDr || conActiveDoctorName || currentName || '');
    }

    function done() {
        renderRxLines();
        renderRxStagedList();
        if (opts.scrollToPanel) {
            var panel = g('drugAddPanel');
            if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }
    if (typeof ensureRxPhrasesLoaded === 'function') {
        ensureRxPhrasesLoaded(done);
    } else {
        done();
    }
    return true;
}

/** Append all drugs from one saved history group to the current Rx draft (edit & save separately). */
function rxReapplyHistoryGroupRecords(records) {
    rxLoadHistoryGroupIntoDraft(records, { append: true });
}

/** Open Rx editor with all drugs from a saved history group (replace current draft). */
function rxEditHistoryGroupRecords(records) {
    rxLoadHistoryGroupIntoDraft(records, {
        append: false,
        scrollToPanel: true,
        editingHistory: true
    });
}

function rxSetEditingHistoryGroup(records) {
    if (!records || !records.length) {
        rxEditingHistoryGroup = null;
        rxRefreshSavePrescriptionButtonLabel();
        return;
    }
    var first = records[0];
    var ids = [];
    records.forEach(function(r) {
        if (r && r.id) ids.push(String(r.id));
    });
    rxEditingHistoryGroup = {
        recordIds: ids,
        prescribed_date: String(first.prescribed_date || '').trim(),
        doctor_tag: String(first.doctor_tag || first.dentist_name || '').trim(),
        dentist_name: String(first.dentist_name || '').trim()
    };
    rxRefreshSavePrescriptionButtonLabel();
}

function rxClearEditingHistoryGroup() {
    rxEditingHistoryGroup = null;
    rxRefreshSavePrescriptionButtonLabel();
}

function rxRefreshSavePrescriptionButtonLabel() {
    var btn = g('btnSaveRx');
    if (!btn) return;
    var replacing = rxEditingHistoryGroup &&
        (rxEditingHistoryGroup.recordIds.length ||
            rxEditingHistoryGroup.prescribed_date);
    var key = replacing ? 'con.rx.savePrescriptionReplace' : 'con.rx.savePrescription';
    btn.textContent = conTr(key);
}

function rxDeleteDrughistoryForReplace(ctx, onDone) {
    if (!ctx || !conPatientId) {
        onDone();
        return;
    }
    var ids = ctx.recordIds || [];
    if (ids.length) {
        SB.from('drughistory').delete().in('id', ids).then(function(r) {
            if (r.error) {
                alert(trRepl('appt.msg.error', { MSG: r.error.message }));
                return;
            }
            onDone();
        });
        return;
    }
    if (!ctx.prescribed_date) {
        onDone();
        return;
    }
    var q = SB.from('drughistory')
        .delete()
        .eq('patient_id', conPatientId)
        .eq('prescribed_date', ctx.prescribed_date);
    if (ctx.doctor_tag) q = q.eq('doctor_tag', ctx.doctor_tag);
    q.then(function(r) {
        if (r.error && ctx.doctor_tag) {
            SB.from('drughistory')
                .delete()
                .eq('patient_id', conPatientId)
                .eq('prescribed_date', ctx.prescribed_date)
                .eq('dentist_name', ctx.doctor_tag)
            .then(function(r2) {
                if (r2.error) {
                    alert(trRepl('appt.msg.error', { MSG: r2.error.message }));
                    return;
                }
                onDone();
            });
            return;
        }
        if (r.error) {
            alert(trRepl('appt.msg.error', { MSG: r.error.message }));
            return;
        }
        onDone();
    });
}

function rxApplySavedDrugList(listId, mode) {
    rxEnsureRxDraftChromeOnly();

    var lists = readRxComboListsStorage();
    var lst   = lists.find(function(x) { return x.id === listId; });
    if (!lst || !lst.lines || !lst.lines.length) {
        alert(conTr('con.rx.listNoDrugs'));
        return;
    }
    var copies = lst.lines.map(rxCloneSavedLine);
    var label  = String(lst.name || conTr('con.rx.untitled')).replace(/"/g, "'");

    if (mode === 'replace') {
        if ((rxLines.length || rxStagedLines.length) &&
            !confirm(conTrRepl('con.rx.confirmReplaceDraft', {
                N: rxStagedLines.length + rxLines.length, NAME: label
            })))
            return;
        rxLines = [];
        rxStagedLines = [];
        rxClearEditingHistoryGroup();
    }

    copies.forEach(function(line) {
        rxStagedLines.push(line);
    });
    renderRxStagedList();
    renderRxLines();
    closeModal('rxDrugListsModal');
}

function rxDeleteSavedDrugList(listId) {
    var lists = readRxComboListsStorage().filter(function(x) {
        return x.id !== listId;
    });
    writeRxComboListsStorage(lists);
    rxRenderSavedDrugListsModal();
}

function rxRenderSavedDrugListsModal() {
    var body    = g('rxSavedListsBody');
    var emptyEl = g('rxSavedListsEmpty');
    var q       = '';
    var si      = g('rxSavedListsSearch');
    if (si) q = String(si.value || '').trim().toLowerCase();
    if (!body) return;

    var allSrc = readRxComboListsStorage();
    var lists  = allSrc.filter(function(lst) {
        if (!q) return true;
        return String(lst.name || '').toLowerCase().indexOf(q) !== -1;
    });
    lists.sort(function(a, b) {
        return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });

    if (!allSrc.length) {
        body.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'block';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    if (!lists.length) {
        body.innerHTML =
            '<p style="padding:14px;color:#64748b;text-align:center;">' +
            esc(conTr('con.rx.noListMatch')) + '</p>';
        return;
    }

    body.innerHTML = '';
    lists.forEach(function(lst) {
        var nLines = lst.lines ? lst.lines.length : 0;
        var um     = '';
        try {
            if (lst.updated_at) {
                um = new Date(lst.updated_at).toLocaleString(conUiLocale(), {
                    day:    '2-digit',
                    month:  'short',
                    year:   'numeric',
                    hour:   '2-digit',
                    minute: '2-digit'
                });
            }
        } catch (err) {}

        var row = document.createElement('div');
        row.style.cssText =
            'background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;' +
            'margin-bottom:8px;display:flex;flex-wrap:wrap;gap:8px;' +
            'align-items:center;justify-content:space-between;';

        row.innerHTML =
            '<div style="flex:1;min-width:176px;">' +
                '<div style="font-weight:700;font-size:14px;color:#111827;">' +
                    esc(lst.name || conTr('con.rx.untitled')) +
                '</div>' +
                '<div style="font-size:11px;color:#64748b;margin-top:2px;">' +
                    esc(conTrRepl('con.rx.drugLinesMeta', { N: nLines }) +
                        (um ? conTrRepl('con.rx.savedAt', { WHEN: um }) : '')) +
                '</div>' +
            '</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
                '<button type="button" class="rx-slist-append" ' +
                        'style="padding:5px 10px;font-size:11px;border-radius:5px;' +
                        'border:1px solid #16a34a;background:#f0fdf4;color:#166534;' +
                        'cursor:pointer;font-weight:600;">' + esc(conTr('con.rx.append')) + '</button>' +
                '<button type="button" class="rx-slist-replace" ' +
                        'style="padding:5px 10px;font-size:11px;border-radius:5px;' +
                        'border:1px solid #ea580c;background:#fff7ed;color:#9a3412;' +
                        'cursor:pointer;font-weight:600;">' + esc(conTr('con.rx.replace')) + '</button>' +
                '<button type="button" class="rx-slist-delete" ' +
                        'title="' + esc(conTr('con.rx.deleteListTitle')) + '" ' +
                        'style="padding:5px 9px;font-size:11px;border-radius:5px;' +
                        'border:1px solid #fca5a5;background:#fef2f2;color:#b91c1c;' +
                        'cursor:pointer;">🗑</button>' +
            '</div>';

        row.querySelector('.rx-slist-append').addEventListener('click', function() {
            rxApplySavedDrugList(lst.id, 'append');
        });
        row.querySelector('.rx-slist-replace').addEventListener('click', function() {
            rxApplySavedDrugList(lst.id, 'replace');
        });
        row.querySelector('.rx-slist-delete').addEventListener('click', function() {
            var nm = String(lst.name || '').replace(/"/g, "'");
            if (!confirm(conTrRepl('con.rx.confirmRemoveList', { NAME: nm }))) return;
            rxDeleteSavedDrugList(lst.id);
        });

        body.appendChild(row);
    });
}

function initRxSavedComboListsUI() {
    var si = g('rxSavedListsSearch');
    if (si && !si.dataset.rxComboBound) {
        si.dataset.rxComboBound = '1';
        si.addEventListener('input', function() {
            clearTimeout(rxComboSearchTimer);
            rxComboSearchTimer = setTimeout(rxRenderSavedDrugListsModal, 170);
        });
    }

    var c = g('rxDrugListsModalClose');
    if (c && !c.dataset.rxComboBound) {
        c.dataset.rxComboBound = '1';
        c.addEventListener('click', function() {
            closeModal('rxDrugListsModal');
        });
    }
}

// ════════════════════════════════════════════════════════════════
// SAVE FULL PRESCRIPTION → drughistory table
// ════════════════════════════════════════════════════════════════
function saveFullPrescription() {
    if (!conPatientId) { alert(conTr('con.forms.alertSelectPatient')); return; }

    var draftLines = rxAllDraftLinesForSave();
    if (!draftLines.length) {
        alert(conTr('con.rx.addOneDrugLine')); return;
    }

    var badRx = -1;
    for (var bi = 0; bi < draftLines.length; bi++) {
        var bl = draftLines[bi];
        if (!(bl.drug_name && String(bl.drug_name).trim())) { badRx = bi; break; }
        var hasDays = !!(
            String(bl.duration_code || '').trim() ||
            String(bl.duration_custom || bl.duration || '').trim()
        );
        if (!hasDays) { badRx = bi; break; }
    }
    if (badRx >= 0) {
        var badLine = draftLines[badRx] || {};
        if (!(badLine.drug_name && String(badLine.drug_name).trim())) {
            alert(conTrRepl('con.rx.rowSelectDrugRx', { N: badRx + 1 }));
        } else {
            alert(conTrRepl('con.rx.rowSelectDaysRx', { N: badRx + 1 }));
        }
        return;
    }

    var date    = g('rxDate').value        || todayISO();
    var dentist = g('rxDentistName').value || conActiveDoctorName || currentName || '';

    var rows = draftLines.map(function(l) {
        if (typeof rxDrughistoryRowForSave === 'function') {
            return rxDrughistoryRowForSave(l, date, dentist);
        }
        return {
            patient_id:      conPatientId,
            patient_no:      conPatientData.patient_no  || null,
            patient_name:    conPatientData.full_name,
            prescribed_date: date,
            drug_name:       l.drug_name || conTr('report.unknown'),
            dosage:          l.dosage    || null,
            frequency:       l.frequency || null,
            duration:        l.duration  || null,
            route:           l.route     || null,
            quantity:        l.quantity  || null,
            intake_remarks:  l.intake_remarks || null,
            remarks:         l.remarks   || null,
            dentist_name:    dentist,
            doctor_id:       conActiveDoctorId || null,
            doctor_name:     conActiveDoctorName || currentName || null,
            doctor_tag:      conActiveDoctorTag || dentist || null
        };
    });

    function insertRxRows(payload, onDone) {
        SB.from('drughistory').insert(payload).then(function(r) {
            if (!r.error) {
                onDone();
                return;
            }
            var msg = String(r.error.message || '').toLowerCase();
            if (msg.indexOf('_zh') >= 0 && typeof rxStripZhColumns === 'function') {
                var stripped = payload.map(rxStripZhColumns);
                SB.from('drughistory').insert(stripped).then(function(r2) {
                    if (r2.error) { alert(trRepl('appt.msg.error', { MSG: r2.error.message })); return; }
                    onDone();
                });
                return;
            }
            if (msg.indexOf('intake_remarks') >= 0 || msg.indexOf('intake') >= 0) {
                var noIntake = payload.map(function(x) {
                    var o = Object.assign({}, x);
                    if (o.intake_remarks && typeof drugPackRemarksForLegacyColumn === 'function') {
                        o.remarks = drugPackRemarksForLegacyColumn(o.intake_remarks, o.remarks);
                    }
                    delete o.intake_remarks;
                    return o;
                });
                insertRxRows(noIntake, onDone);
                return;
            }
            if (msg.indexOf('doctor_tag') >= 0 || msg.indexOf('doctor_id') >= 0 ||
                msg.indexOf('doctor_name') >= 0) {
                var legacyRows = payload.map(function(x) {
                    var rem = x.remarks;
                    if (x.intake_remarks && typeof drugPackRemarksForLegacyColumn === 'function') {
                        rem = drugPackRemarksForLegacyColumn(x.intake_remarks, rem);
                    }
                    return {
                        patient_id: x.patient_id,
                        patient_no: x.patient_no,
                        patient_name: x.patient_name,
                        prescribed_date: x.prescribed_date,
                        drug_name: x.drug_name,
                        dosage: x.dosage,
                        frequency: x.frequency,
                        duration: x.duration,
                        route: x.route,
                        quantity: x.quantity,
                        remarks: rem,
                        dentist_name: x.dentist_name
                    };
                });
                SB.from('drughistory').insert(legacyRows).then(function(r2) {
                    if (r2.error) { alert(trRepl('appt.msg.error', { MSG: r2.error.message })); return; }
                    onDone();
                });
                return;
            }
            alert(trRepl('appt.msg.error', { MSG: r.error.message }));
        });
    }

    var replaceCtx = rxEditingHistoryGroup;
    var isReplace  = !!(replaceCtx &&
        (replaceCtx.recordIds.length || replaceCtx.prescribed_date));

    function afterSave() {
        rxClearEditingHistoryGroup();
        rxStagedLines = [];
        rxLines = [];
        renderRxStagedList();
        toggleDrugAddPanel(false);
        loadDrugHistory(conPatientId);
        conSchedulePatientTimelineRefresh(conPatientId);
        alert(conTrRepl(isReplace ? 'con.rx.prescriptionReplaced' : 'con.rx.prescriptionSaved', {
            N: rows.length,
            NAME: conPatientData.full_name
        }));
    }

    function insertThenFinish() {
        insertRxRows(rows, afterSave);
    }

    if (isReplace) {
        rxDeleteDrughistoryForReplace(replaceCtx, insertThenFinish);
    } else {
        insertThenFinish();
    }
}

// ════════════════════════════════════════════════════════════════
// DRUG HISTORY — grouped by date + print buttons
// ════════════════════════════════════════════════════════════════
async function loadDrugHistory(patientId) {
    var wrap = g('drugHistoryWrap');
    if (!wrap) return;
    wrap.innerHTML =
        '<p style="color:#aaa;padding:12px;">' + esc(conTr('con.rx.loadingHistory')) + '</p>';

    var result = await SB
        .from('drughistory')
        .select('*')
        .eq('patient_id', patientId)
        .order('prescribed_date', { ascending: false });

    var data  = result.data;
    var error = result.error;

    if (error || !data || !data.length) {
        wrap.innerHTML =
            '<p style="color:#aaa;padding:12px;">' +
            esc(conTr('con.rx.noRxHistoryShort')) + '</p>';
        return;
    }

    // Group by prescribed_date + doctor tag/name
    var groups = {};
    var order  = [];
    data.forEach(function(r) {
        var key = (r.prescribed_date || 'unknown') +
                  '||' + (r.doctor_tag || r.dentist_name || '');
        if (!groups[key]) { groups[key] = []; order.push(key); }
        groups[key].push(r);
    });

    wrap.innerHTML = '';

    order.forEach(function(key) {
        var rows       = groups[key];
        var parts      = key.split('||');
        var dateStr    = parts[0];
        var doctorTag = parts[1] || '';

        var displayDate = dateStr;
        try {
            var dt = new Date(dateStr);
            if (!isNaN(dt)) {
                displayDate = dt.toLocaleDateString(conUiLocale(), {
                    day: '2-digit', month: 'short', year: 'numeric'
                });
            }
        } catch(e) {}

        var groupDiv = document.createElement('div');
        groupDiv.className = 'rx-group-card';

        var rowsHtml = rows.map(function(r) {
            var histLine = typeof rxNormalizeLine === 'function'
                ? rxNormalizeLine({
                    drug_name: r.drug_name,
                    dosage: r.dosage,
                    frequency: r.frequency,
                    duration: r.duration,
                    quantity: r.quantity,
                    dosage_code: '', frequency_code: '', duration_code: '', quantity_code: '',
                    dosage_custom: r.dosage || '', frequency_custom: r.frequency || '',
                    duration_custom: r.duration || '', quantity_custom: r.quantity || ''
                })
                : null;
            var qtyDisp = String(r.quantity || '').trim();
            if (!qtyDisp && histLine && typeof rxLineQuantityText === 'function') {
                qtyDisp = rxLineQuantityText(histLine);
            }
            return '<div class="rx-history-row"' +
                ' data-drug-name="'       + esc(r.drug_name       || '') + '"' +
                ' data-dosage="'          + esc(r.dosage          || '') + '"' +
                ' data-dosage-zh="'       + esc(r.dosage_zh       || r.dosage || '') + '"' +
                ' data-frequency="'       + esc(r.frequency       || '') + '"' +
                ' data-frequency-zh="'    + esc(r.frequency_zh    || r.frequency || '') + '"' +
                ' data-duration="'        + esc(r.duration        || '') + '"' +
                ' data-duration-zh="'     + esc(r.duration_zh     || r.duration || '') + '"' +
                ' data-quantity="'        + esc(r.quantity        || '') + '"' +
                ' data-quantity-zh="'     + esc(r.quantity_zh     || r.quantity || '') + '"' +
                ' data-intake-remarks="'  + esc(r.intake_remarks  || '') + '"' +
                ' data-remarks="'         + esc(r.remarks         || '') + '"' +
                ' data-dentist-name="'    + esc(r.dentist_name    || '') + '"' +
                ' data-doctor-tag="'      + esc(r.doctor_tag      || r.dentist_name || '') + '"' +
                ' data-patient-no="'     + esc(r.patient_no      || '') + '"' +
                ' data-patient-name="'    + esc(r.patient_name    || '') + '"' +
                ' data-prescribed-date="' + esc(r.prescribed_date || '') + '">' +
                    '<div class="rx-row-main">' +
                        '<span class="rx-row-drug">' +
                            '<strong>' + esc(r.drug_name || '—') + '</strong> ' +
                            esc(r.dosage || '') +
                        '</span>' +
                        '<span class="rx-row-info">' +
                            esc(r.frequency || '') + ' &bull; ' +
                            esc(r.duration  || '') + ' &bull; ' +
                            esc(conTr('con.rx.historyQty')) + ' ' +
                            esc(qtyDisp || r.quantity || '') +
                        '</span>' +
                        (r.remarks
                            ? '<span class="rx-row-remarks">' +
                              esc(r.remarks) + '</span>'
                            : '') +
                    '</div>' +
                    '<div class="rx-row-print-btns">' +
                        '<button class="btn-label-sm-en" ' +
                        'onclick="printHistoryRowLabel(this,\'en\')" ' +
                        'title="' + esc(conTr('con.rx.printLabelEn')) + '">' +
                        esc(conTr('con.rx.btnPrintEn')) + '</button>' +
                        '<button class="btn-label-sm-zh" ' +
                        'onclick="printHistoryRowLabel(this,\'zh\')" ' +
                        'title="' + esc(conTr('con.rx.printLabelZh')) + '">' +
                        esc(conTr('con.rx.btnPrintZh')) + '</button>' +
                    '</div>' +
                '</div>';
        }).join('');

        groupDiv.innerHTML =
            '<div class="rx-group-header">' +
                '<div class="rx-group-meta">' +
                    '<span class="rx-group-date">📅 ' +
                        displayDate + '</span>' +
                    '<span class="rx-group-dr">' + esc(conTr('con.rx.historyDrPrefix')) +
                        esc(doctorTag) + '</span>' +
                '</div>' +
                '<div class="rx-group-actions">' +
                    '<button class="btn-label-group-en" ' +
                    'onclick="printHistoryGroupLabels(this,\'en\')" ' +
                    'title="' + esc(conTr('con.rx.printLabelEn')) + '">' +
                    esc(conTr('con.rx.printAllEn')) + '</button>' +
                    '<button class="btn-label-group-zh" ' +
                    'onclick="printHistoryGroupLabels(this,\'zh\')" ' +
                    'title="' + esc(conTr('con.rx.printLabelZh')) + '">' +
                    esc(conTr('con.rx.printAllZh')) + '</button>' +
                    '<button type="button" class="btn-reapply-hist-rx" ' +
                    'title="' + esc(conTr('con.rx.reApplyTitle')) + '"' +
                    ' style="padding:5px 9px;font-size:11px;border-radius:5px;' +
                    'border:1px solid #0284c7;background:#e0f2fe;color:#0369a1;' +
                    'cursor:pointer;font-weight:600;">' + esc(conTr('con.rx.reApply')) + '</button>' +
                    '<button type="button" class="btn-save-hist-as-list" ' +
                    'title="' + esc(conTr('con.rx.saveAsListHistTitle')) + '"' +
                    ' style="padding:5px 9px;font-size:11px;border-radius:5px;' +
                    'border:1px solid #ca8a04;background:#fefce8;color:#854d0e;' +
                    'cursor:pointer;font-weight:600;">' + esc(conTr('con.rx.saveAsListBtn')) + '</button>' +
                    '<button class="btn-delete-group" ' +
                    'onclick="deleteRxGroup(this,\'' +
                        esc(dateStr) + '\',\'' +
                        esc(doctorTag) + '\')">' +
                    esc(conTr('con.rx.deleteAll')) + '</button>' +
                '</div>' +
            '</div>' +
            '<div class="rx-group-body">' + rowsHtml + '</div>';

        wrap.appendChild(groupDiv);
        var saveHistBtn = groupDiv.querySelector('.btn-save-hist-as-list');
        if (saveHistBtn) {
            saveHistBtn.addEventListener('click', function() {
                rxSaveComboListFromHistoryRecords(rows);
            });
        }
        var reApplyBtn = groupDiv.querySelector('.btn-reapply-hist-rx');
        if (reApplyBtn) {
            reApplyBtn.addEventListener('click', function(ev) {
                ev.stopPropagation();
                rxReapplyHistoryGroupRecords(rows);
            });
        }

        groupDiv.querySelectorAll('.rx-history-row').forEach(function(rowEl) {
            rowEl.classList.add('rx-history-row--clickable');
            rowEl.setAttribute('title', conTr('con.rx.editHistClickTitle'));
            rowEl.addEventListener('click', function(ev) {
                if (ev.target.closest('.rx-row-print-btns, button')) return;
                rxEditHistoryGroupRecords(rows);
            });
        });
    });
}

// ════════════════════════════════════════════════════════════════
// DELETE RX GROUP
// ════════════════════════════════════════════════════════════════
function deleteRxGroup(btn, dateStr, doctorTag) {
    if (!confirm(conTr('con.rx.confirmDeleteGroup'))) return;
    var q = SB.from('drughistory')
        .delete()
        .eq('patient_id',      conPatientId)
        .eq('prescribed_date', dateStr);
    if (doctorTag) q = q.eq('doctor_tag', doctorTag);

    q.then(function(r) {
        if (r.error && doctorTag) {
            // Backward compatibility for databases that do not yet have doctor_tag.
            SB.from('drughistory')
                .delete()
                .eq('patient_id',      conPatientId)
                .eq('prescribed_date', dateStr)
                .eq('dentist_name',    doctorTag)
            .then(function(r2) {
                if (r2.error) { alert(trRepl('appt.msg.error', { MSG: r2.error.message })); return; }
                loadDrugHistory(conPatientId);
            });
            return;
        }
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
        loadDrugHistory(conPatientId);
    });
}

// ════════════════════════════════════════════════════════════════
// ██████████████████████████████████████████████████████████████
// DRUG LABEL PRINT SYSTEM
// ██████████████████████████████████████████████████████████████
// ════════════════════════════════════════════════════════════════

// ── Core print engine ────────────────────────────────────────
function conResolveActiveClinicRecordForLabels() {
    var rec = null;
    if (typeof currentClinicId !== 'undefined' &&
        currentClinicId &&
        typeof clinicRecordFromId === 'function') {
        rec = clinicRecordFromId(currentClinicId);
    }
    if (!rec) {
        var sel = g('appWorkingClinicSelect');
        var selVal = sel ? String(sel.value || '').trim() : '';
        if (typeof isWorkingClinicAllValue === 'function' && isWorkingClinicAllValue(selVal)) {
            selVal = '';
        }
        if (selVal && typeof clinicRecordFromId === 'function') {
            rec = clinicRecordFromId(selVal);
        }
    }
    if (!rec &&
        typeof currentClinicCodeForTagging === 'function' &&
        typeof APP_CLINICS !== 'undefined' &&
        APP_CLINICS && APP_CLINICS.length) {
        var code = String(currentClinicCodeForTagging() || '').trim();
        if (code) {
            for (var i = 0; i < APP_CLINICS.length; i++) {
                var c = APP_CLINICS[i];
                if (String(c.id || '') === code || String(c.clinic_code || '') === code) {
                    rec = c;
                    break;
                }
            }
        }
    }
    return rec;
}

/** Resolved from active clinic context for label header; falls back to session label. */
function currentActiveClinicLabelForPrinting(isZh) {
    var rec = conResolveActiveClinicRecordForLabels();
    if (rec && typeof clinicDisplayName === 'function') {
        var useZh = !!isZh || (typeof printUiLangIsChinese === 'function' && printUiLangIsChinese());
        if (useZh) {
            var cn = String(rec.chinese_name || '').trim();
            if (cn) return cn;
        }
        var en = String(rec.english_name || '').trim();
        if (en) return en;
        return clinicDisplayName(rec) || '—';
    }

    var en = rec ? String(rec.english_name || '').trim() : '';
    var cn = rec ? String(rec.chinese_name || '').trim() : '';

    if (!en && typeof currentClinicLabel === 'string') {
        en = currentClinicLabel.trim();
    }

    if (isZh) {
        if (cn) return cn;
        if (en) return en;
    } else {
        if (en) return en;
        if (cn) return cn;
    }

    if (en) return en;
    if (cn) return cn;
    return '—';
}

/**
 * Address + phone under clinic name on labels (active clinic context).
 */
function buildClinicContactHtmlForDrugLabel(isZh) {
    var rec = conResolveActiveClinicRecordForLabels();
    var addrEn = rec ? String(rec.address || '').trim() : '';
    var addrZh = rec ? String(rec.address_chinese || rec.chinese_address || '').trim() : '';
    var addr = isZh ? (addrZh || addrEn) : (addrEn || addrZh);
    var tel = rec ? String(rec.tel || '').trim() : '';
    var e = typeof esc === 'function' ? esc : function(s) { return String(s || ''); };
    var addrShown = addr ? e(addr) : '—';
    var telBody = tel ? e(tel) : '—';
    var telLine = conLblPrint(isZh, 'tel') + telBody;
    return (
        '<div class="clinic-addr">' + addrShown + '</div>' +
        '<div class="clinic-tel">' + telLine + '</div>'
    );
}

/** Patient name on drug label: Chinese labels use chinese_name when available. */
function drugLabelPatientDisplayName(d, isZh) {
    d = d || {};
    var cn = String(d.patient_chinese_name || '').trim();
    var en = String(d.patient_name || '').trim();
    if (isZh && conPatientData) {
        var dNo = String(d.patient_no || '').trim();
        var cNo = String(conPatientData.patient_no || '').trim();
        if ((!dNo || dNo === cNo) && !cn) {
            cn = String(conPatientData.chinese_name || '').trim();
        }
        if (!en) en = String(conPatientData.full_name || '').trim();
    }
    if (isZh) return cn || en || '';
    return en || cn || '';
}

/** Printable area for drug labels (default 50×60 mm; Config → Print → Drug Label). */
function drugLabelPrintDimensions() {
    var w = 50;
    var h = 60;
    var ml = 2;
    var mr = 2;
    var mt = 2;
    var mb = 2;
    var row = null;
    if (typeof CFG !== 'undefined' && CFG &&
        typeof CFG.getPrintSettingsForDoc === 'function') {
        row = CFG.getPrintSettingsForDoc('drug_label');
    }
    if (row) {
        if (row.paper_size === 'Custom' && row.paper_width_mm && row.paper_height_mm) {
            w = Math.max(20, Number(row.paper_width_mm) || w);
            h = Math.max(20, Number(row.paper_height_mm) || h);
        }
        ml = Number(row.margin_left);
        if (isNaN(ml)) ml = 2;
        mr = Number(row.margin_right);
        if (isNaN(mr)) mr = 2;
        mt = Number(row.margin_top);
        if (isNaN(mt)) mt = 2;
        mb = Number(row.margin_bottom);
        if (isNaN(mb)) mb = 2;
    }
    return {
        w: w,
        h: h,
        ml: ml,
        mr: mr,
        mt: mt,
        mb: mb,
        innerW: Math.max(10, w - ml - mr),
        innerH: Math.max(10, h - mt - mb)
    };
}

function printDrugLabel(drugs, lang) {
    if (typeof confirmPrintReminder === 'function' && !confirmPrintReminder()) return;
    var isZh = (lang === 'zh');
    var clinicNameRaw = currentActiveClinicLabelForPrinting(isZh);
    var clinicName =
        typeof esc === 'function' ? esc(clinicNameRaw) : String(clinicNameRaw || '');
    var clinicContactHtml = buildClinicContactHtmlForDrugLabel(isZh);
    var dims = drugLabelPrintDimensions();

    var fontFamily = isZh
        ? "'Noto Sans TC','Microsoft JhengHei UI','Microsoft JhengHei','PingFang TC','Source Han Sans TC',sans-serif"
        : "'Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif";

    var labelCSS =
        '* { margin:0; padding:0; box-sizing:border-box; }' +
        '@page { size:' + dims.w + 'mm ' + dims.h + 'mm; margin:' +
            dims.mt + 'mm ' + dims.mr + 'mm ' + dims.mb + 'mm ' + dims.ml + 'mm; }' +
        '@media print { html,body { margin:0; } }' +
        'html,body {' +
            'font-family:' + fontFamily + ';' +
            'width:' + dims.innerW + 'mm;' +
            'margin:0 auto;' +
            'background:#fff;' +
            'color:#000;' +
            '-webkit-font-smoothing:antialiased;' +
            '-moz-osx-font-smoothing:grayscale;' +
            'text-rendering:optimizeLegibility;' +
        '}' +
        '.label {' +
            'width:' + dims.innerW + 'mm;' +
            'height:' + dims.innerH + 'mm;' +
            'max-height:' + dims.innerH + 'mm;' +
            'padding:0.8mm 1mm;' +
            'page-break-after:always;' +
            'overflow:hidden;' +
            'position:relative;' +
        '}' +
        '.label:last-child { page-break-after:avoid; }' +
        '.label-inner {' +
            'width:100%;' +
            'min-height:0;' +
            'display:flex;' +
            'flex-direction:column;' +
            'justify-content:flex-start;' +
            'align-items:stretch;' +
            'gap:0.4mm;' +
            'font-size:10pt;' +
            'line-height:1.22;' +
            'letter-spacing:0.01em;' +
            'transform-origin:top center;' +
        '}' +
        '.label-top {' +
            'flex:0 0 auto;' +
            'max-height:42%;' +
            'min-height:0;' +
            'overflow:hidden;' +
            'display:flex;' +
            'flex-direction:column;' +
            'gap:0.2mm;' +
        '}' +
        '.label-header {' +
            'flex:0 1 auto;' +
            'min-height:0;' +
            'overflow:hidden;' +
            'display:flex;' +
            'flex-direction:column;' +
            'justify-content:flex-start;' +
            'padding-bottom:0.35mm;' +
            'margin-bottom:0.3mm;' +
            'border-bottom:0.15mm solid #000;' +
        '}' +
        '.clinic-name {' +
            'font-size:0.9em;' +
            'font-weight:400;' +
            'text-align:center;' +
            'line-height:1.14;' +
            'word-break:break-word;' +
            'display:-webkit-box;' +
            '-webkit-box-orient:vertical;' +
            '-webkit-line-clamp:2;' +
            'overflow:hidden;' +
        '}' +
        '.clinic-addr,.clinic-tel {' +
            'font-size:0.8em;' +
            'font-weight:400;' +
            'text-align:center;' +
            'line-height:1.14;' +
            'word-break:break-word;' +
            'display:-webkit-box;' +
            '-webkit-box-orient:vertical;' +
            'overflow:hidden;' +
        '}' +
        '.clinic-addr { margin-top:0.12em; -webkit-line-clamp:2; }' +
        '.clinic-tel { margin-top:0.06em; -webkit-line-clamp:1; }' +
        '.label-patient {' +
            'flex:0 0 auto;' +
            'min-height:0;' +
            'overflow:hidden;' +
            'padding:0.2em 0 0 0;' +
        '}' +
        '.patient-row {' +
            'font-size:0.84em;' +
            'line-height:1.14;' +
            'word-break:break-word;' +
            'width:100%;' +
        '}' +
        '.patient-name-wrap {' +
            'display:flex;' +
            'gap:0.3em;' +
            'align-items:flex-start;' +
            'line-height:1.1;' +
            'width:100%;' +
        '}' +
        '.patient-name-wrap .lk { flex-shrink:0; }' +
        '.patient-name-wrap .patient-val {' +
            'flex:1;' +
            'min-width:0;' +
            'display:-webkit-box;' +
            '-webkit-box-orient:vertical;' +
            '-webkit-line-clamp:2;' +
            'overflow:hidden;' +
            'font-size:1em;' +
        '}' +
        '.label-mid {' +
            'flex:1 1 auto;' +
            'min-height:0;' +
            'display:flex;' +
            'flex-direction:column;' +
            'justify-content:center;' +
            'align-items:stretch;' +
            'overflow:hidden;' +
            'padding:0.35mm 0;' +
        '}' +
        '.label-mid-inner {' +
            'flex:0 1 auto;' +
            'max-height:100%;' +
            'width:100%;' +
            'min-height:0;' +
            'overflow:hidden;' +
            'display:flex;' +
            'flex-direction:column;' +
            'justify-content:center;' +
            'gap:0.28em;' +
        '}' +
        '.label-footer {' +
            'flex:0 0 auto;' +
            'margin-top:auto;' +
            'padding-top:0.35em;' +
            'width:100%;' +
        '}' +
        '.drug-name {' +
            'font-size:1.15em;' +
            'font-weight:400;' +
            'line-height:1.16;' +
            'word-break:break-word;' +
            'display:-webkit-box;' +
            '-webkit-box-orient:vertical;' +
            '-webkit-line-clamp:3;' +
            'overflow:hidden;' +
            'flex-shrink:0;' +
            'width:100%;' +
            'text-align:left;' +
        '}' +
        '.info-row {' +
            'font-size:0.96em;' +
            'line-height:1.2;' +
            'word-break:break-word;' +
            'flex-shrink:0;' +
            'width:100%;' +
            'text-align:left;' +
        '}' +
        '.lk { font-weight:400; }' +
        '.remarks-block {' +
            'font-size:0.86em;' +
            'line-height:1.16;' +
            'word-break:break-word;' +
            'font-style:normal;' +
            'display:-webkit-box;' +
            '-webkit-box-orient:vertical;' +
            '-webkit-line-clamp:2;' +
            'overflow:hidden;' +
            'flex-shrink:0;' +
            'width:100%;' +
            'text-align:left;' +
        '}' +
        '.footer-row {' +
            'font-size:0.9em;' +
            'line-height:1.18;' +
            'word-break:break-word;' +
            'width:100%;' +
            'text-align:left;' +
        '}';

    // ── Build each label ──────────────────────────────────────
    var labelsHtml = drugs.map(function(d) {
        var eFn = typeof esc === 'function' ? esc : function(s) { return String(s || ''); };
        var drugName = d.drug_name       || '—';
        var dosage   = d.dosage          || '—';
        var freq     = d.frequency       || '—';
        var duration = d.duration        || '—';
        var qty      = d.quantity        || '—';
        var intakeRm = typeof drugTextForLang === 'function'
            ? drugTextForLang(d.intake_remarks || '', isZh ? 'zh' : 'en')
            : (d.intake_remarks || '');
        var remarks  = typeof drugTextForLang === 'function'
            ? drugTextForLang(d.remarks || '', isZh ? 'zh' : 'en')
            : (d.remarks || '');
        var doctor = (typeof printDoctorDisplayName === 'function')
            ? printDoctorDisplayName({
                doctor_id: d.doctor_id,
                doctor_name: d.dentist_name || d.doctor_name,
                doctor_tag: d.doctor_tag,
                dentist_name: d.dentist_name
            }, isZh ? 'zh' : 'en')
            : (d.dentist_name || d.doctor_name || conActiveDoctorName || currentName || '—');
        var dateStr  = '—';

        var patNoRaw   = String(d.patient_no || '').trim();
        var patNameRaw = drugLabelPatientDisplayName(d, isZh);
        var patNoDisp   = patNoRaw ? eFn(patNoRaw) : '—';
        var patNameDisp = patNameRaw ? eFn(patNameRaw) : '—';

        if (d.prescribed_date) {
            var dt = new Date(d.prescribed_date);
            if (!isNaN(dt)) {
                dateStr = isZh
                    ? dt.toLocaleDateString('zh-HK', {
                        year:'numeric', month:'2-digit', day:'2-digit'
                      })
                    : dt.toLocaleDateString('en-GB', {
                        day:'2-digit', month:'short', year:'numeric'
                      });
            }
        }

        var patientBlockZh =
            '<div class="label-patient">' +
            '<div class="patient-row"><span class="lk">' + conLblPrint(true, 'patNo') + '</span>' + patNoDisp + '</div>' +
            '<div class="patient-row patient-name-wrap"><span class="lk">' + conLblPrint(true, 'name') + '</span>' +
                '<span class="patient-val">' + patNameDisp + '</span></div>' +
            '<div class="patient-row"><span class="lk">' + conLblPrint(true, 'date') + '</span>' + dateStr + '</div>' +
            '</div>';

        var patientBlockEn =
            '<div class="label-patient">' +
            '<div class="patient-row"><span class="lk">' + conLblPrint(false, 'patNo') + '</span>' + patNoDisp + '</div>' +
            '<div class="patient-row patient-name-wrap"><span class="lk">' + conLblPrint(false, 'name') + '</span>' +
                '<span class="patient-val">' + patNameDisp + '</span></div>' +
            '<div class="patient-row"><span class="lk">' + conLblPrint(false, 'date') + '</span>' + dateStr + '</div>' +
            '</div>';

        var intakeHtml = intakeRm
            ? '<div class="remarks-block">' +
                  '<span class="lk">' +
                      conLblPrint(isZh, 'intake') +
                  '</span>' + eFn(intakeRm) +
              '</div>'
            : '';
        var remarksHtml = remarks
            ? '<div class="remarks-block">' +
                  '<span class="lk">' +
                      conLblPrint(isZh, 'remarks') +
                  '</span>' + eFn(remarks) +
              '</div>'
            : '';

        if (isZh) {
            return '<div class="label"><div class="label-inner">' +
                '<div class="label-top">' +
                '<div class="label-header">' +
                '<div class="clinic-name">' + clinicName + '</div>' +
                clinicContactHtml +
                '</div>' +
                patientBlockZh +
                '</div>' +
                '<div class="label-mid">' +
                '<div class="label-mid-inner">' +
                '<div class="drug-name">' + drugName + '</div>' +
                '<div class="info-row">' + dosage + '</div>' +
                '<div class="info-row"><span class="lk">' + conLblPrint(true, 'freq') + '</span>' + freq + '</div>' +
                '<div class="info-row"><span class="lk">' + conLblPrint(true, 'duration') + '</span>' + duration + '</div>' +
                '<div class="info-row"><span class="lk">' + conLblPrint(true, 'qty') + '</span>' + qty + '</div>' +
                intakeHtml + remarksHtml +
                '</div>' +
                '</div>' +
                '<div class="label-footer">' +
                '<div class="footer-row"><span class="lk">' + conLblPrint(true, 'doctor') + '</span>' + doctor + '</div>' +
                '</div>' +
                '</div></div>';
        } else {
            return '<div class="label"><div class="label-inner">' +
                '<div class="label-top">' +
                '<div class="label-header">' +
                '<div class="clinic-name">' + clinicName + '</div>' +
                clinicContactHtml +
                '</div>' +
                patientBlockEn +
                '</div>' +
                '<div class="label-mid">' +
                '<div class="label-mid-inner">' +
                '<div class="drug-name">' + drugName + '</div>' +
                '<div class="info-row">' + dosage + '</div>' +
                '<div class="info-row"><span class="lk">' + conLblPrint(false, 'freq') + '</span>' + freq + '</div>' +
                '<div class="info-row"><span class="lk">' + conLblPrint(false, 'duration') + '</span>' + duration + '</div>' +
                '<div class="info-row"><span class="lk">' + conLblPrint(false, 'qty') + '</span>' + qty + '</div>' +
                intakeHtml + remarksHtml +
                '</div>' +
                '</div>' +
                '<div class="label-footer">' +
                '<div class="footer-row"><span class="lk">' + conLblPrint(false, 'doctor') + '</span>' + doctor + '</div>' +
                '</div>' +
                '</div></div>';
        }
    }).join('');

    // ── Wider popup: Chrome/Edge print UI can show options (LHS) + preview (RHS) when space allows.
    var popup = window.open(
        '', '_blank',
        'width=1024,height=760,left=60,top=32,toolbar=0,menubar=0,scrollbars=1,resizable=1'
    );

    if (!popup) {
        alert(conTr('con.rx.alertPopupBlocked'));
        return;
    }

    popup.document.write(
        '<!DOCTYPE html>' +
        '<html lang="' + (isZh ? 'zh-HK' : 'en') + '">' +
        '<head>' +
            '<meta charset="UTF-8">' +
            '<title>' + conLblPrint(isZh, 'title') + '</title>' +
            '<style>' + labelCSS + '</style>' +
        '</head>' +
        '<body>' +
            labelsHtml +
            '<script>' +
            '(function(){' +
            'function fitAllDrugLabels(){' +
            'var labels=[].slice.call(document.querySelectorAll(".label"));' +
            'var minSc=0.3;' +
            'labels.forEach(function(label){' +
            'var inner=label.querySelector(".label-inner");' +
            'if(!inner)return;' +
            'inner.style.transform="none";' +
            'void label.offsetHeight;' +
            'var pad=2;' +
            'var maxH=Math.max(1,label.clientHeight-pad);' +
            'var maxW=Math.max(1,label.clientWidth-pad);' +
            'var needH=Math.max(1,inner.scrollHeight);' +
            'var needW=Math.max(1,inner.scrollWidth);' +
            'var sc=Math.min(1,maxH/needH,maxW/needW);' +
            'if(sc<minSc)sc=minSc;' +
            'sc=Math.floor(sc*100)/100;' +
            'inner.style.transform="scale("+sc+")";' +
            'inner.style.transformOrigin="top center";' +
            '});' +
            '}' +
            (typeof printPopupAutoCloseInlineScript === 'function'
                ? printPopupAutoCloseInlineScript()
                : '') +
            'window.onload=function(){' +
            'try{fitAllDrugLabels();}catch(e){}' +
            'try{window.focus();}catch(e2){}' +
            'setTimeout(function(){try{window.print();}catch(e3){if(typeof __ppClose==="function")__ppClose();}},480);' +
            '};' +
            '})();' +
            '<\/script>' +
        '</body>' +
        '</html>'
    );
    popup.document.close();
    if (typeof wirePrintPopupAutoClose === 'function') wirePrintPopupAutoClose(popup);
    try {
        popup.focus();
    } catch (ePrintFocus) {}
}

// ── Get drug data from a live rx-line-card (before save) ─────
function getDrugFromRxLine(lineEl, lang) {
    var today = todayISO();
    var cardId  = lineEl.id;
    var idx     = cardId ? parseInt(cardId.replace('rxline-', ''), 10) : -1;
    if (idx >= 0 && typeof rxSyncLineFromDom === 'function') rxSyncLineFromDom(idx);
    var line = (idx >= 0 && rxLines[idx]) ? rxLines[idx] : {};
    var meta = {
        dentist_name:    conActiveDoctorName || currentName || '—',
        doctor_tag:      conActiveDoctorTag || conActiveDoctorName || currentName || '',
        prescribed_date: (g('rxDate') && g('rxDate').value) || today,
        patient_no:      (conPatientData && conPatientData.patient_no)
            ? String(conPatientData.patient_no) : '',
        patient_name:    (conPatientData && conPatientData.full_name)
            ? String(conPatientData.full_name) : '',
        patient_chinese_name: (conPatientData && conPatientData.chinese_name)
            ? String(conPatientData.chinese_name) : ''
    };
    if (typeof rxLineToPrintDrug === 'function') {
        return rxLineToPrintDrug(line, lang || 'en', meta);
    }
    return {
        drug_name:       line.drug_name || '',
        dosage:          line.dosage || '',
        route:           '',
        frequency:       line.frequency || '',
        duration:        line.duration || '',
        quantity:        line.quantity || '',
        intake_remarks:  line.intake_remarks || '',
        remarks:         line.remarks || '',
        dentist_name:    meta.dentist_name,
        doctor_tag:      meta.doctor_tag,
        prescribed_date: meta.prescribed_date,
        patient_no:      meta.patient_no,
        patient_name:    meta.patient_name,
        patient_chinese_name: meta.patient_chinese_name
    };
}

// ── Print single label from rx line (EN) ─────────────────────
function printRxLineLabelEn(btn) {
    var lineEl = btn.closest('.rx-line-card');
    if (!lineEl) return;
    if (!conPatientId || !conPatientData) {
        alert(conTr('con.rx.alertLabelNeedPatient'));
        return;
    }
    var drug = getDrugFromRxLine(lineEl, 'en');
    if (!drug.drug_name) {
        alert(conTr('con.rx.alertLabelNeedDrug'));
        return;
    }
    printDrugLabel([drug], 'en');
}

// ── Print single label from rx line (中文) ───────────────────
function printRxLineLabelZh(btn) {
    var lineEl = btn.closest('.rx-line-card');
    if (!lineEl) return;
    if (!conPatientId || !conPatientData) {
        alert(conTr('con.rx.alertLabelNeedPatient'));
        return;
    }
    var drug = getDrugFromRxLine(lineEl, 'zh');
    if (!drug.drug_name) {
        alert(conTr('con.rx.alertLabelNeedDrug'));
        return;
    }
    printDrugLabel([drug], 'zh');
}

// ── Print single label from saved history row ─────────────────
function printHistoryRowLabel(btn, lang) {
    var row = btn.closest('.rx-history-row');
    if (!row) return;
    var drug = typeof rxHistoryRowToDrug === 'function'
        ? rxHistoryRowToDrug(row, lang)
        : null;
    if (!drug) return;
    if (!drug.drug_name) return;
    printDrugLabel([drug], lang);
}

// ── Print all labels in a saved group ────────────────────────
function printHistoryGroupLabels(btn, lang) {
    var group = btn.closest('.rx-group-card');
    if (!group) return;
    var rows  = group.querySelectorAll('.rx-history-row');
    var drugs = [];
    var defNo = '';
    var defName = '';
    if (rows.length && rows[0].dataset) {
        defNo = rows[0].dataset.patientNo || '';
        defName = rows[0].dataset.patientName || '';
    }
    if (!defNo && conPatientData && conPatientData.patient_no) {
        defNo = String(conPatientData.patient_no);
    }
    if (!defName && conPatientData) {
        if (lang === 'zh' && conPatientData.chinese_name) {
            defName = String(conPatientData.chinese_name);
        } else if (conPatientData.full_name) {
            defName = String(conPatientData.full_name);
        }
    }
    rows.forEach(function(row) {
        var drug = typeof rxHistoryRowToDrug === 'function'
            ? rxHistoryRowToDrug(row, lang)
            : null;
        if (drug && drug.drug_name) {
            if (!drug.patient_no) drug.patient_no = defNo;
            if (!drug.patient_name) drug.patient_name = defName;
            drugs.push(drug);
        }
    });
    if (!drugs.length) return;
    printDrugLabel(drugs, lang);
}

// ════════════════════════════════════════════════════════════════
// DRUG LIST MANAGER MODAL
// ════════════════════════════════════════════════════════════════
function openDrugListManager() {
    drugEditId = null;
    if (typeof refreshDrugCategorySelect === 'function') refreshDrugCategorySelect();
    if (typeof drugRefreshRemarkPresetDatalists === 'function') drugRefreshRemarkPresetDatalists();
    if (typeof drugBindRemarkPresetControls === 'function') drugBindRemarkPresetControls();
    loadDrugListTable();
    resetDrugForm();
    openModal('drugListModal');
    var mod = g('drugListModal');
    if (mod && typeof applyI18nInRoot === 'function') applyI18nInRoot(mod);
}

function loadDrugListTable() {
    var tb = g('drugListBody');
    if (!tb) return;

    tb.innerHTML =
        '<tr><td colspan="7" style="text-align:center;' +
        'color:#aaa;padding:16px;">' + esc(conTr('con.rx.drugListLoading')) + '</td></tr>';

    SB.from('druglist')
        .select('*')
        .order('category',  { ascending: true })
        .order('drug_name', { ascending: true })
    .then(function(r) {
        if (r.error || !r.data || !r.data.length) {
            tb.innerHTML =
                '<tr><td colspan="7" style="text-align:center;' +
                'color:#aaa;padding:16px;">' + esc(conTr('con.rx.drugListEmpty')) +
                '</td></tr>';
            return;
        }
        tb.innerHTML = '';
        r.data.forEach(function(d) {
            var tr = document.createElement('tr');
            if (!d.is_active) tr.style.opacity = '0.5';
            tr.innerHTML =
                '<td><span class="cat-badge">' +
                    esc(conDrugCatLabel(d.category)) +
                '</span></td>' +
                '<td><strong>' + esc(d.drug_name) + '</strong>' +
                    (!d.is_active
                        ? ' <span style="font-size:10px;' +
                          'color:var(--danger);">[' + esc(conTr('drug.inactive')) + ']</span>'
                        : '') +
                '</td>' +
                '<td>' + esc(d.dosage    || '-') + '</td>' +
                '<td>' + esc(d.frequency || '-') + '</td>' +
                '<td>' + esc(d.duration  || '-') + '</td>' +
                '<td>' + esc(d.route     || '-') + '</td>' +
                '<td>' +
                    '<div style="display:flex;gap:5px;">' +
                        '<button class="btn-dl-edit btn-sm" ' +
                        'style="background:var(--primary);">' +
                        esc(conTr('con.rx.drugListEdit')) + '</button>' +
                        '<button class="btn-dl-del btn-sm" ' +
                        'style="background:var(--danger);">' +
                        esc(conTr('con.rx.drugListDel')) + '</button>' +
                    '</div>' +
                '</td>';
            tb.appendChild(tr);

            tr.querySelector('.btn-dl-edit')
              .addEventListener('click', function() {
                  editDrugItem(d);
              });
            tr.querySelector('.btn-dl-del')
              .addEventListener('click', function() {
                  deleteDrugItem(d.id);
              });
        });
    });
}

function conLooksLikeUuid(v) {
    var s = String(v || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function conResolveDrugDentistId(seedName, row) {
    if (typeof conActiveDoctorId !== 'undefined' && conActiveDoctorId && conLooksLikeUuid(conActiveDoctorId)) {
        return String(conActiveDoctorId).trim();
    }
    if (typeof currentDoctorId !== 'undefined' && currentDoctorId && conLooksLikeUuid(currentDoctorId)) {
        return String(currentDoctorId).trim();
    }
    if (row && row.dentist_id && conLooksLikeUuid(row.dentist_id)) {
        return String(row.dentist_id).trim();
    }
    var docs = (typeof APP_DOCTORS !== 'undefined' && Array.isArray(APP_DOCTORS)) ? APP_DOCTORS : [];
    var want = String(seedName || '').trim().toLowerCase();
    var i;
    for (i = 0; i < docs.length; i++) {
        var d = docs[i] || {};
        var id = String(d.id || '').trim();
        if (!conLooksLikeUuid(id)) continue;
        var a = String(d.display_name || '').trim().toLowerCase();
        var b = String(d.english_name || '').trim().toLowerCase();
        var c = String(d.chinese_name || '').trim().toLowerCase();
        if (want && (want === a || want === b || want === c)) return id;
    }
    for (i = 0; i < docs.length; i++) {
        var anyId = String((docs[i] || {}).id || '').trim();
        if (conLooksLikeUuid(anyId)) return anyId;
    }
    return '';
}

function conIsUuidSyntaxError(msg) {
    var m = String(msg || '').toLowerCase();
    return m.indexOf('invalid input syntax for type uuid') >= 0;
}

function resetDrugForm() {
    drugEditId = null;
    drugEditRow = null;
    var title  = g('dlFormTitle');
    if (title) {
        title.setAttribute('data-i18n', 'con.rx.dlFormAddTitle');
        title.textContent = conTr('con.rx.dlFormAddTitle');
    }
    var cancel = g('dlCancelEdit');
    if (cancel) cancel.style.display = 'none';
    sv('dlName',      '');
    sv('dlCategory',  '');
    sv('dlDosage',    '');
    sv('dlFrequency', '');
    sv('dlDuration',  '');
    sv('dlRoute',     '');
    sv('dlIntakeCaution', '');
    sv('dlIntakeCautionZh', '');
    sv('dlGeneralRemarks', '');
    sv('dlGeneralRemarksZh', '');
    var dlISel = g('dlIntakeCautionSel');
    var dlGSel = g('dlGeneralRemarksSel');
    var dlIZhSel = g('dlIntakeCautionZhSel');
    var dlGZhSel = g('dlGeneralRemarksZhSel');
    if (dlISel) dlISel.value = '';
    if (dlGSel) dlGSel.value = '';
    if (dlIZhSel) dlIZhSel.value = '';
    if (dlGZhSel) dlGZhSel.value = '';
}

function editDrugItem(d) {
    drugEditId = d.id;
    drugEditRow = d || null;
    var title  = g('dlFormTitle');
    if (title) {
        title.removeAttribute('data-i18n');
        title.textContent = conTr('con.rx.dlFormEditTitle');
    }
    var cancel = g('dlCancelEdit');
    if (cancel) cancel.style.display = 'inline-block';
    sv('dlName',      d.drug_name  || '');
    sv('dlCategory',  d.category   || '');
    sv('dlDosage',    d.dosage     || '');
    sv('dlFrequency', d.frequency  || '');
    sv('dlDuration',  d.duration   || '');
    sv('dlRoute',     d.route      || '');
    var packed = (typeof drugUnpackRemarks === 'function')
        ? drugUnpackRemarks(d)
        : {
            intakeEn: '', intakeZh: '',
            generalEn: String(d.remarks || '').trim(), generalZh: ''
        };
    sv('dlIntakeCaution', packed.intakeEn);
    sv('dlIntakeCautionZh', packed.intakeZh);
    sv('dlGeneralRemarks', packed.generalEn);
    sv('dlGeneralRemarksZh', packed.generalZh);
    var nameEl = g('dlName');
    if (nameEl) nameEl.focus();
}

function saveDrugItem() {
    var name = (g('dlName').value || '').trim();
    if (!name) { alert(conTr('drug.alertNameRequired')); return; }

    var intakeEn = (g('dlIntakeCaution') ? g('dlIntakeCaution').value : '').trim();
    var intakeZh = (g('dlIntakeCautionZh') ? g('dlIntakeCautionZh').value : '').trim();
    var generalEn = (g('dlGeneralRemarks') ? g('dlGeneralRemarks').value : '').trim();
    var generalZh = (g('dlGeneralRemarksZh') ? g('dlGeneralRemarksZh').value : '').trim();
    var intakeV = typeof drugPackBilingualText === 'function'
        ? drugPackBilingualText(intakeEn, intakeZh)
        : (intakeEn || intakeZh);
    var generalV = typeof drugPackBilingualText === 'function'
        ? drugPackBilingualText(generalEn, generalZh)
        : (generalEn || generalZh);
    var payload = {
        drug_name:  name,
        category:  (g('dlCategory').value  || '').trim() || null,
        dosage:    (g('dlDosage').value    || '').trim() || null,
        frequency: (g('dlFrequency').value || '').trim() || null,
        duration:  (g('dlDuration').value  || '').trim() || null,
        route:     (g('dlRoute').value     || '').trim() || null,
        intake_caution: intakeV || null,
        remarks:   generalV || null
    };

    var dentistName = '';
    if (typeof conActiveDoctorName === 'string' && conActiveDoctorName.trim()) {
        dentistName = conActiveDoctorName.trim();
    } else if (typeof currentName === 'string' && currentName.trim()) {
        dentistName = currentName.trim();
    } else if (drugEditRow && drugEditRow.dentist_name) {
        dentistName = String(drugEditRow.dentist_name).trim();
    }
    if (dentistName) payload.dentist_name = dentistName;
    var dentistId = conResolveDrugDentistId(dentistName, drugEditRow);
    if (dentistId) payload.dentist_id = dentistId;

    function runSave(sendPayload, allowUuidRetry, allowColumnFallback) {
        var p = drugEditId
            ? SB.from('druglist').update(sendPayload).eq('id', drugEditId)
            : SB.from('druglist').insert([sendPayload]);
        p.then(function(r) {
            if (r.error) {
                if (allowUuidRetry && conIsUuidSyntaxError(r.error.message)) {
                    var retryPayload = {};
                    var k;
                    for (k in sendPayload) {
                        if (!Object.prototype.hasOwnProperty.call(sendPayload, k)) continue;
                        if (k === 'dentist_id' || k === 'dentist_name') continue;
                        retryPayload[k] = sendPayload[k];
                    }
                    runSave(retryPayload, false, allowColumnFallback);
                    return;
                }
                if (allowColumnFallback && typeof drugColumnMissing === 'function' &&
                    typeof drugPackRemarksForLegacyColumn === 'function') {
                    var fb = Object.assign({}, sendPayload);
                    var merged = false;
                    if (fb.intake_caution !== undefined &&
                        drugColumnMissing(r.error.message, 'intake_caution')) {
                        fb.remarks = drugPackRemarksForLegacyColumn(
                            fb.intake_caution, fb.remarks
                        );
                        delete fb.intake_caution;
                        merged = true;
                    }
                    if (merged) {
                        runSave(fb, allowUuidRetry, false);
                        return;
                    }
                }
                alert(trRepl('appt.msg.error', { MSG: r.error.message }));
                return;
            }
            resetDrugForm();
            loadDrugListTable();
        });
    }

    runSave(payload, true, true);
}

function deleteDrugItem(id) {
    if (!confirm(conTr('con.rx.confirmDeleteMaster'))) return;
    SB.from('druglist').delete().eq('id', id)
    .then(function(r) {
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
        loadDrugListTable();
    });
}

// ════════════════════════════════════════════════════════════════
// MEDICAL HISTORY TAB
// ════════════════════════════════════════════════════════════════
function doConPatientSearchMed() {
    runPatientSearchDropdown({
        inputId: 'conPsInputMed',
        dropId: 'conPsDropMed',
        clinicFilterId: 'conPsClinicFilterMed',
        onSelect: selectMedPatient
    });
}

function selectMedPatient(p) {
    conMedPatientId   = p.id;
    conMedPatientData = p;

    var medBanner = g('conMedBanner');
    if (medBanner) medBanner.style.display = 'flex';
    if (g('conMedBannerName'))
        g('conMedBannerName').textContent = p.full_name;
    if (g('conMedBannerNo'))
        g('conMedBannerNo').textContent = p.patient_no || '-';
    if (g('conMedBannerDob'))
        g('conMedBannerDob').textContent =
            p.dob ? formatDobAge(p.dob) : '-';
    if (g('conMedBannerAlert')) {
        g('conMedBannerAlert').textContent = p.medical_alerts || conTr('con.banner.none');
        g('conMedBannerAlert').style.color = p.medical_alerts
            ? 'var(--danger)' : '#999';
    }
    if (g('conMedFormPatientName')) {
        g('conMedFormPatientName').textContent =
            p.full_name + '  (#' + (p.patient_no || '-') + ')';
    }
    loadMedicalHistory();
}

function loadMedicalHistory() {
    if (!conMedPatientId) return;
    var form = g('conMedForm');

    SB.from('patients')
        .select('medical_history,current_medications,allergy')
        .eq('id', conMedPatientId)
        .single()
    .then(function(r) {
        if (r.error) {
            alert(conTrRepl('con.alert.medLoadFail', { MSG: r.error.message }));
            return;
        }
        var d = r.data || {};
        sv('fldMedHistory',  d.medical_history     || '');
        sv('fldMedications', d.current_medications || '');
        sv('fldAllergy',     d.allergy             || '');
        if (form) form.style.display = 'block';
        if (typeof applyMedicalNotesProgramLocks === 'function') applyMedicalNotesProgramLocks();
    });
}

function saveMedicalHistory() {
    if (!conMedPatientId) { alert(conTr('con.alert.noPatientSelected')); return; }
    if (typeof medicalNotesEditingAllowed === 'function' && !medicalNotesEditingAllowed()) {
        alert(conTr('con.alert.medReadOnly'));
        return;
    }
    var payload = {
        medical_history:     (g('fldMedHistory').value  || '').trim(),
        current_medications: (g('fldMedications').value || '').trim(),
        allergy:             (g('fldAllergy').value     || '').trim()
    };
    SB.from('patients').update(payload).eq('id', conMedPatientId)
    .then(function(r) {
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
        alert(conTrRepl('con.alert.medSaved', { NAME: conMedPatientData.full_name }));
        if (typeof refreshPatientAlertDisplayViews === 'function') {
            refreshPatientAlertDisplayViews();
        }
    });
}

var conMedAlertDisplayBound = false;

function syncMedAlertDisplayCheckboxes() {
    if (typeof loadPatientAlertDisplayPrefs === 'function') loadPatientAlertDisplayPrefs();
    var prefs = typeof patientAlertDisplayPrefs !== 'undefined' ? patientAlertDisplayPrefs : {};
    var h = g('conMedAlertShowHistory');
    var m = g('conMedAlertShowMeds');
    var a = g('conMedAlertShowAllergy');
    if (h) h.checked = !!prefs.showHistory;
    if (m) m.checked = !!prefs.showMedications;
    if (a) a.checked = !!prefs.showAllergies;
}

function onMedAlertDisplayPrefChange() {
    if (typeof patientAlertDisplayPrefs === 'undefined') return;
    var h = g('conMedAlertShowHistory');
    var m = g('conMedAlertShowMeds');
    var a = g('conMedAlertShowAllergy');
    patientAlertDisplayPrefs.showHistory = !!(h && h.checked);
    patientAlertDisplayPrefs.showMedications = !!(m && m.checked);
    patientAlertDisplayPrefs.showAllergies = !!(a && a.checked);
    if (typeof savePatientAlertDisplayPrefs === 'function') savePatientAlertDisplayPrefs();
    if (typeof refreshPatientAlertDisplayViews === 'function') refreshPatientAlertDisplayViews();
}

function initMedAlertDisplayPrefs() {
    syncMedAlertDisplayCheckboxes();
    if (conMedAlertDisplayBound) return;
    conMedAlertDisplayBound = true;
    ['conMedAlertShowHistory', 'conMedAlertShowMeds', 'conMedAlertShowAllergy'].forEach(function(id) {
        var el = g(id);
        if (el) el.addEventListener('change', onMedAlertDisplayPrefChange);
    });
}

// ════════════════════════════════════════════════════════════════
// DENTAL HISTORY TAB
// ════════════════════════════════════════════════════════════════
function doConPatientSearchDen() {
    runPatientSearchDropdown({
        inputId: 'conPsInputDen',
        dropId: 'conPsDropDen',
        clinicFilterId: 'conPsClinicFilterDen',
        onSelect: selectDenPatient
    });
}

function selectDenPatient(p) {
    conDenPatientId   = p.id;
    conDenPatientData = p;

    var denBanner = g('conDenBanner');
    if (denBanner) denBanner.style.display = 'flex';
    if (g('conDenBannerName'))
        g('conDenBannerName').textContent = p.full_name;
    if (g('conDenBannerNo'))
        g('conDenBannerNo').textContent = p.patient_no || '-';
    if (g('conDenBannerDob'))
        g('conDenBannerDob').textContent =
            p.dob ? formatDobAge(p.dob) : '-';
    if (g('conDenBannerAlert')) {
        g('conDenBannerAlert').textContent = p.medical_alerts || conTr('con.banner.none');
        g('conDenBannerAlert').style.color = p.medical_alerts
            ? 'var(--danger)' : '#999';
    }
    if (g('conDenFormPatientName')) {
        g('conDenFormPatientName').textContent =
            p.full_name + '  (#' + (p.patient_no || '-') + ')';
    }
    loadDentalHistory();
}

function loadDentalHistory() {
    if (!conDenPatientId) return;
    var form = g('conDenForm');

    SB.from('patients')
        .select('dental_history,parafunctional_habits,oral_hygiene_notes')
        .eq('id', conDenPatientId)
        .single()
    .then(function(r) {
        if (r.error) {
            alert(conTrRepl('con.alert.denLoadFail', { MSG: r.error.message }));
            return;
        }
        var d = r.data || {};
        sv('fldDentalHistory',  d.dental_history        || '');
        sv('fldParafunctional', d.parafunctional_habits || '');
        sv('fldOralHygiene',    d.oral_hygiene_notes    || '');
        if (form) form.style.display = 'block';
    });
}

function saveDentalHistory() {
    if (!conDenPatientId) { alert(conTr('con.alert.noPatientSelected')); return; }
    var payload = {
        dental_history:        (g('fldDentalHistory').value  || '').trim(),
        parafunctional_habits: (g('fldParafunctional').value || '').trim(),
        oral_hygiene_notes:    (g('fldOralHygiene').value    || '').trim()
    };
    SB.from('patients').update(payload).eq('id', conDenPatientId)
    .then(function(r) {
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
        alert(conTrRepl('con.alert.denSaved', { NAME: conDenPatientData.full_name }));
    });
}

// ════════════════════════════════════════════════════════════════
// UI LANGUAGE — consultation doctor dropdown when display language changes
// ════════════════════════════════════════════════════════════════
function refreshConOpenModalsI18n() {
    var tplModal = g('conNoteTemplateModal');
    if (tplModal && tplModal.style.display === 'block') {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(tplModal);
        conRenderNoteTemplateSelect();
        conLoadTemplateEditorFields();
    }
    var rxModal = g('rxDrugListsModal');
    if (rxModal && rxModal.style.display === 'block') {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(rxModal);
        if (typeof rxRenderSavedDrugListsModal === 'function') {
            rxRenderSavedDrugListsModal();
        }
    }
    var dlModal = g('drugListModal');
    if (dlModal && dlModal.style.display === 'block') {
        if (typeof refreshDrugCategorySelect === 'function') refreshDrugCategorySelect();
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(dlModal);
        if (typeof loadDrugListTable === 'function') loadDrugListTable();
        if (drugEditId) {
            var titleEl = g('dlFormTitle');
            if (titleEl) titleEl.textContent = conTr('con.rx.dlFormEditTitle');
        } else if (typeof resetDrugForm === 'function') {
            resetDrugForm();
        }
    }
    var tnPop = g('conTnPrintPopover');
    if (tnPop && !tnPop.classList.contains('hidden') && typeof applyI18nInRoot === 'function') {
        applyI18nInRoot(tnPop);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    wireConTnPrintUi();
    bindConBackQueueBtnOnce();
    conPtlBuildFilterBar();
    updateConTnPrintBtnState();
});

document.addEventListener('app-lang-change', function() {
    if (typeof refreshConsultationClinicFilterSelects === 'function') {
        refreshConsultationClinicFilterSelects();
    } else if (typeof refreshAllClinicDropdowns === 'function') {
        refreshAllClinicDropdowns();
    }
    if (g('conDoctorSelect') && typeof loadConsultationDoctors === 'function') {
        loadConsultationDoctors();
    } else if (typeof updateConsultationDoctorUI === 'function') {
        updateConsultationDoctorUI();
    }
    refreshConOpenModalsI18n();
    if (conPatientData) {
        if (typeof refreshPhotoBannerI18n === 'function') refreshPhotoBannerI18n();
        if (typeof refreshXrayBannerI18n === 'function') refreshXrayBannerI18n();
    }
    if (conFormsPatientData && typeof updateConFormsPatientLabel === 'function') {
        updateConFormsPatientLabel();
    }
    if (conFormsPatientId) {
        if (typeof refreshConFormsToolbarI18n === 'function') refreshConFormsToolbarI18n();
        if (typeof refreshConFormsFontSizeSelect === 'function') refreshConFormsFontSizeSelect();
        var previewBtn = g('conFormsShellPreviewBtn');
        if (previewBtn) {
            previewBtn.textContent = conFormsShellPreviewOn
                ? conTr('con.forms.shell.previewHideBtn')
                : conTr('con.forms.shell.previewBtn');
        }
        if (conFormsShellPreviewOn && typeof conFormsRenderShellPreview === 'function') {
            conFormsRenderShellPreview();
        }
        var formsEditor = g('conFormsDocEditor');
        if (formsEditor && formsEditor.dataset.placeholderMode === '1' &&
            typeof refreshConFormsEditorPlaceholder === 'function') {
            refreshConFormsEditorPlaceholder();
        }
    }
    if (conPatientId && typeof renderRxLines === 'function' && rxLines && rxLines.length) {
        renderRxLines();
    }
    if (typeof renderRxStagedList === 'function') {
        renderRxStagedList();
    }
    if (conPatientId && typeof loadDrugHistory === 'function') {
        loadDrugHistory(conPatientId);
    }
    if (conPatientId && typeof loadConNotes === 'function') {
        loadConNotes(conPatientId);
    }
    if (conPatientId && conPatientTimelineEvents.length && typeof renderConPatientTimeline === 'function') {
        renderConPatientTimeline();
    }
    if (conPatientData && typeof refreshConPatientBannerI18n === 'function') {
        refreshConPatientBannerI18n(conPatientData);
        if (typeof applyI18nInRoot === 'function') {
            var gb = g('conPatientBanner');
            if (gb) applyI18nInRoot(gb);
            ['conMedBanner', 'conDenBanner', 'conPhotoBanner', 'conXrayBanner'].forEach(function(bid) {
                var banner = g(bid);
                if (banner) applyI18nInRoot(banner);
            });
        }
        if (typeof refreshConPatientOutstandingBalance === 'function') {
            refreshConPatientOutstandingBalance();
        }
    }
    if (conFormsPatientId && typeof loadConFormsTemplates === 'function') {
        loadConFormsTemplates();
    }
    var formsListEarly = g('conFormsExistingList');
    if (conFormsPatientId && formsListEarly && formsListEarly.children.length &&
        typeof searchConFormsDocs === 'function') {
        searchConFormsDocs();
    }
    if (conPatientId || conFormsPatientId) {
        if (typeof loadConsultationDoctors === 'function') loadConsultationDoctors();
    }

    if (typeof applyI18nInRoot === 'function' &&
        (conPatientId || conFormsPatientId || conPatientData)) {
        ['con-treatment', 'con-medhistory', 'con-denhistory', 'con-xrays',
            'con-charting', 'con-photos', 'con-forms'].forEach(function(pid) {
            var pane = g(pid);
            if (pane) applyI18nInRoot(pane);
        });
    }
    var sec = g('consultationSection');
    if (sec && (conPatientId || conFormsPatientId) && typeof applyI18nInRoot === 'function') {
        applyI18nInRoot(sec);
    }
    if (!sec || sec.style.display === 'none') return;
});

document.addEventListener('consultation-ar-refresh', function() {
    if (typeof refreshConPatientOutstandingBalance === 'function') {
        refreshConPatientOutstandingBalance();
    }
});

