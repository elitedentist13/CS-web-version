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
/** Index of the expanded (editable) drug card; others render as one-line summaries. */
var rxActiveLineIdx = -1;
/** True once the user changes the open draft; cleared on open / save / cancel. */
var rxDraftDirty   = false;
var rxSaveInFlight = false;
/** Active druglist rows, fetched once and reused by every drug picker. */
var rxDrugCatalog  = null;
var rxDrugCatalogPromise = null;
/** { pid, text } — allergy text of the consultation patient, for Rx checks. */
var rxPatientAllergy = null;
/** Set to true after an insert fails because rx_group_id / drug_id are not in the DB yet. */
var rxHistoryLinkColsMissing = false;
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
var conPtlSearchTerm = '';
var conPatientTimelineEvents = [];
var conPatientTimelineHadErrors = false;
var conPtlRefreshTimer = null;
var conFormsEditingDocId = null;
var conFormsToolbarReady = false;
var _conFormsDirty = false;   // true when Forms editor has unsaved content
var CON_NOTE_TEMPLATES_KEY = 'con_note_templates_v1';
var CON_NOTE_TEMPLATES_TABLE = 'con_note_templates';
var conNoteTemplatesCache = [];
var conNoteTemplatesLoaded = false;
var conNoteTemplatesRemoteWarned = false;

/** Supabase table for saved multi-drug lists (per doctor). See rx_saved_combo_lists.sql */
var RX_COMBO_LISTS_TABLE = 'rx_saved_combo_lists';
/** Legacy / offline localStorage base key. */
var RX_COMBO_LISTS_KEY_BASE = 'rx_saved_combo_lists_v1';
/** @deprecated Prefer RX_COMBO_LISTS_KEY_BASE — kept for migration. */
var RX_COMBO_LISTS_KEY = RX_COMBO_LISTS_KEY_BASE;

var rxComboListsCache = [];
var rxComboListsCacheDoctorKey = '';
var rxComboListsRemoteWarned = false;
var rxComboListsMigrating = false;
var rxComboListsLoading = false;

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

function conPatientAlertText(p) {
    p = p || {};
    var txt = '';
    if (typeof buildPatientAlertDisplayText === 'function') {
        txt = String(buildPatientAlertDisplayText(p) || '').trim();
    }
    if (!txt) txt = String(p.medical_alerts || '').trim();
    return txt;
}

function setConBannerAlert(elId, p) {
    var el = g(elId);
    if (!el) return;
    var txt = conPatientAlertText(p);
    el.textContent = txt || conTr('con.banner.none');
    el.style.color = txt ? 'var(--danger)' : '#999';
}

function refreshConPatientAlertBanners(p) {
    p = p || conPatientData || conMedPatientData || conDenPatientData;
    setConBannerAlert('conBannerAlert', p);
    setConBannerAlert('conMedBannerAlert', p);
    setConBannerAlert('conDenBannerAlert', p);
}

function refreshConPatientBannerI18n(p) {
    if (!p) return;

    if (g('conBannerToday') && typeof fmtNowDateTimeHK === 'function') {
        g('conBannerToday').textContent = fmtNowDateTimeHK();
    }
    if (g('conBannerDob')) {
        g('conBannerDob').textContent = p.dob ? formatDobAge(p.dob) : '-';
    }
    setConBannerAlert('conBannerAlert', p);

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
    setConBannerAlert('conMedBannerAlert', p);

    if (g('conDenBannerDob')) {
        g('conDenBannerDob').textContent = p.dob ? formatDobAge(p.dob) : '-';
    }
    setConBannerAlert('conDenBannerAlert', p);

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

/** Dr-side entry point — opens the standalone Appointment Reminder modal (app-patient-recall.js). */
function conBannerOpenReminder() {
    if (!conPatientId) return;
    if (typeof PATIENT_RECALL === 'undefined' || typeof PATIENT_RECALL.open !== 'function') return;
    var p = conPatientData || {};
    var clinicTag = (typeof currentClinicCodeForTagging === 'function' ? currentClinicCodeForTagging() : '') ||
        p.clinic_tag || '';
    PATIENT_RECALL.open({
        patientId: conPatientId,
        patientNo: p.patient_no || '',
        patientName: p.full_name || '',
        chineseName: p.chinese_name || '',
        source: 'consultation',
        clinicTag: clinicTag,
        doctorId: conActiveDoctorId || '',
        doctorCode: conActiveDoctorTag || ''
    });
}

function conBannerWhatsAppMessage(p) {
    p = p || {};
    var name = String(p.chinese_name || p.full_name || conTr('appt.today.thisPatient')).trim();
    var rawTpl = typeof conTr === 'function'
        ? conTr('whatsapp.msg.consultationHello')
        : (typeof tr === 'function' ? tr('whatsapp.msg.consultationHello') : '');
    var clinic = (typeof clinicNameForOutboundMessage === 'function')
        ? clinicNameForOutboundMessage({ body: rawTpl })
        : ((typeof currentClinicLabel !== 'undefined' && currentClinicLabel)
            ? currentClinicLabel
            : 'Joyful Smile');
    return conTrRepl('whatsapp.msg.consultationHello', {
        NAME: name,
        CLINIC: clinic
    });
}

function conBannerOpenWhatsApp() {
    if (!conPatientData) return;
    var phone = String(conPatientData.mobile_phone || conPatientData.phone_number || '').trim();
    if (phone || !conPatientId) {
        if (typeof openWhatsAppPrefill === 'function') {
            openWhatsAppPrefill(phone, conBannerWhatsAppMessage(conPatientData), { source: 'consultation' });
        }
        return;
    }
    SB.from('patients')
        .select('phone_number,mobile_phone,full_name,chinese_name')
        .eq('id', conPatientId)
        .single()
    .then(function(r) {
        if (!r.error && r.data) {
            conPatientData.phone_number = r.data.phone_number || conPatientData.phone_number || '';
            conPatientData.mobile_phone = r.data.mobile_phone || conPatientData.mobile_phone || '';
            conPatientData.full_name = conPatientData.full_name || r.data.full_name || '';
            conPatientData.chinese_name = conPatientData.chinese_name || r.data.chinese_name || '';
        }
        if (typeof openWhatsAppPrefill === 'function') {
            openWhatsAppPrefill(
                String(conPatientData.mobile_phone || conPatientData.phone_number || '').trim(),
                conBannerWhatsAppMessage(conPatientData),
                { source: 'consultation' }
            );
        }
    });
}

/** Print label field — EN/ZH keys share same text in every UI locale. */
function conLblPrint(isZh, slug) {
    return conTr('con.rx.printLbl.' + slug + (isZh ? '.zh' : '.en'));
}

/** Dropdown value for a line restored from saved history/list but not yet tied to catalogue id */
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
    resetConNotesForPatientSwitch();
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

    // Saved Rx combo lists are per-doctor — drop stale cache on doctor change
    rxComboListsCache = [];
    rxComboListsCacheDoctorKey = '';
    if (typeof g === 'function') {
        var rxModalOpen = g('rxDrugListsModal');
        if (rxModalOpen && rxModalOpen.style.display === 'block' &&
            typeof rxOpenDrugListsPicker === 'function') {
            rxEnsureComboListsLoaded(function () {
                if (typeof rxRenderSavedDrugListsModal === 'function') {
                    rxRenderSavedDrugListsModal();
                }
            });
        }
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

    rxRefreshDoctorChip();
}

// ════════════════════════════════════════════════════════════════
// OPEN FOR SPECIFIC PATIENT (from queue)
// ════════════════════════════════════════════════════════════════
function clearConNotesDom(mode) {
    var loading = mode !== 'empty';
    var html = loading
        ? ('<p style="color:#aaa;margin:0;padding:16px;">' +
            esc(typeof conTr === 'function' ? conTr('common.loadingEllipsis') : 'Loading…') +
            '</p>')
        : ('<p style="color:#aaa;margin:0;padding:16px;">' +
            esc(typeof conTr === 'function' ? conTr('con.noTreatmentNotes') : 'No notes') +
            '</p>');
    ['conTimeline', 'xrayConTimeline'].forEach(function (hostId) {
        var tl = g(hostId);
        if (tl) tl.innerHTML = html;
    });
}

function resetConNotesForPatientSwitch() {
    conNotesLoadGen++;
    conTreatmentNotesCache = [];
    if (typeof conPtlRefreshTimer !== 'undefined' && conPtlRefreshTimer) {
        clearTimeout(conPtlRefreshTimer);
        conPtlRefreshTimer = null;
    }
    conPatientTimelineEvents = [];
    clearConNotesDom('loading');
    var noteInp = g('conNoteInput');
    if (noteInp) noteInp.value = '';
    var xrayNoteInp = g('xrayConNoteInput');
    if (xrayNoteInp) xrayNoteInp.value = '';
    var bananaWrap = g('conBannerBananaNotesWrap');
    var bananaEl = g('conBannerBananaNotes');
    if (bananaWrap) bananaWrap.style.display = 'none';
    if (bananaEl) bananaEl.textContent = '—';
    var ptl = g('conPatientTimeline');
    if (ptl) {
        ptl.innerHTML = '<p class="con-ptl-placeholder">' +
            esc(typeof conTr === 'function' ? conTr('con.ptl.loading') : 'Loading…') +
            '</p>';
    }
}

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
    resetConNotesForPatientSwitch();

    refreshConPatientOutstandingBalance();

    function fetchPatient(selCols, retried) {
        SB.from('patients').select(selCols).eq('id', patientId).single()
        .then(function(r) {
            if (r.error || !r.data) {
                var m = String((r && r.error && r.error.message) || '').toLowerCase();
                if (!retried && m.indexOf('banana_notes') >= 0) {
                    fetchPatient(
                        'id,patient_no,full_name,chinese_name,sex,dob,' +
                        'phone_number,mobile_phone,email,hkid,address,medical_alerts,banana_index,' + PATIENT_CLINIC_TAG_FIELD,
                        true
                    );
                    return;
                }
                alert(conTr('con.alert.loadPatientFail'));
                return;
            }
            var inp = g('conPsInput');
            if (inp) {
                inp.value = (typeof patientSearchInputDisplayValue === 'function')
                    ? patientSearchInputDisplayValue(r.data)
                    : (r.data.full_name + ' (#' + (r.data.patient_no || '') + ')');
                inp.dataset.psLockedPatientId = String(r.data.id || '');
            }
            selectConPatient(r.data);
            if (typeof opts.onReady === 'function') {
                try { opts.onReady(r.data); } catch (e) { /* ignore */ }
            }
        });
    }
    fetchPatient(
        'id,patient_no,full_name,chinese_name,sex,dob,' +
        'phone_number,mobile_phone,email,hkid,address,medical_alerts,banana_index,banana_notes,' + PATIENT_CLINIC_TAG_FIELD,
        false
    );
}

// ════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ════════════════════════════════════════════════════════════════
function _conFormsCheckUnsavedThen(proceed) {
    if (!_conFormsDirty) { proceed(); return; }
    var tFn = (typeof conTr === 'function') ? conTr : (typeof t === 'function' ? t : function(k){ return k; });
    if (typeof showMediaUnsavedOverlay === 'function') {
        showMediaUnsavedOverlay(
            'consultationSection',
            function() {                        // Save
                saveConFormsDoc(false);
                // saveConFormsDoc clears _conFormsDirty on success; proceed after brief tick
                setTimeout(proceed, 300);
            },
            function() {                        // Discard
                _conFormsDirty = false;
                proceed();
            },
            {
                messageKey: 'con.forms.unsaved.message',
                saveKey:    'con.forms.unsaved.save',
                discardKey: 'con.forms.unsaved.discard',
                cancelKey:  'con.forms.unsaved.cancel'
            }
        );
    } else {
        // Fallback if helper not loaded yet
        if (confirm(tFn('con.forms.unsaved.message'))) {
            saveConFormsDoc(false);
            setTimeout(proceed, 300);
        } else {
            _conFormsDirty = false;
            proceed();
        }
    }
}

function switchConTab(tab) {
    // Guard: if currently on forms tab with unsaved content, prompt before leaving
    var currentFormsActive = document.querySelector('.con-tab[data-tab="forms"].active');
    if (currentFormsActive && tab !== 'forms' && _conFormsDirty) {
        _conFormsCheckUnsavedThen(function() { switchConTab(tab); });
        return;
    }

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
        var xrayNow = (conPatientData && conPatientData.id) ? conPatientData : null;
        if (!xrayNow && typeof activePatientSlots !== 'undefined' &&
            activePatientSlots[0] && activePatientSlots[0].id) {
            xrayNow = activePatientSlots[0];
        }
        var xrayMismatch = xrayNow && (
            typeof xrayPatientId === 'undefined' ||
            String(xrayPatientId || '') !== String(xrayNow.id)
        );
        if (xrayMismatch && typeof syncXrayPatient === 'function') {
            syncXrayPatient(xrayNow.id, xrayNow);
        } else if (typeof loadXrayRecords === 'function') {
            loadXrayRecords();
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
        autoSelectSingle: false,
        activeSource: 'consultation-treatment-search',
        onSelect: selectConPatient
    });
}

// ── Charting tab: same search as treatment, ties into selectConPatient ──
function doConPatientSearchChart() {
    runPatientSearchDropdown({
        inputId: 'conPsInputChart',
        dropId: 'conPsDropChart',
        clinicFilterId: 'conPsClinicFilterChart',
        autoSelectSingle: false,
        activeSource: 'consultation-chart-search',
        onSelect: selectConPatient
    });
}

// ════════════════════════════════════════════════════════════════
// SELECT PATIENT — populate ALL tabs
// ════════════════════════════════════════════════════════════════
function selectConPatient(p) {
    resetConNotesForPatientSwitch();
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
    if (phoneEl) phoneEl.textContent = p.phone_number || p.mobile_phone || '-';

    var mobWrap = g('conBannerMobileWrap');
    var mobEl   = g('conBannerMobile');
    if (mobWrap && mobEl) {
        var mobStr = String(p.mobile_phone || '').trim();
        var telStr = String(p.phone_number || '').trim();
        if (mobStr && mobStr !== telStr) {
            mobWrap.style.display = '';
            mobEl.textContent = mobStr;
        } else {
            mobWrap.style.display = 'none';
            mobEl.textContent = '—';
        }
    }

    var addrWrap = g('conBannerAddressWrap');
    var addrEl   = g('conBannerAddress');
    if (addrWrap && addrEl) {
        var addrStr = String(p.address || '').trim();
        if (addrStr) {
            addrWrap.style.display = '';
            addrEl.textContent = addrStr;
        } else {
            addrWrap.style.display = 'none';
            addrEl.textContent = '—';
        }
    }

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

    setConBannerAlert('conBannerAlert', p);

    updateConBannerBananaIndex(p);
    updateConBannerBananaNotes(p);
    // Some callers pass compact patient rows from search; hydrate banana_notes if missing.
    if (p && p.id && typeof p.banana_notes === 'undefined') {
        SB.from('patients').select('banana_notes').eq('id', p.id).single()
        .then(function(r) {
            if (r.error || !r.data) return;
            if (!conPatientData || String(conPatientData.id) !== String(p.id)) return;
            conPatientData.banana_notes = r.data.banana_notes || null;
            updateConBannerBananaNotes(conPatientData);
        });
    }

    var layout = g('conMainLayout');
    if (layout) layout.style.display = 'grid';

    var medInput = g('conPsInputMed');
    if (medInput && document.activeElement !== medInput) {
        medInput.value = (typeof patientSearchInputDisplayValue === 'function')
            ? patientSearchInputDisplayValue(p)
            : (p.full_name + ' (#' + (p.patient_no || '') + ')');
        medInput.dataset.psLockedPatientId = String(p.id || '');
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
    setConBannerAlert('conMedBannerAlert', p);
    if (g('conMedFormPatientName')) {
        g('conMedFormPatientName').textContent =
            p.full_name + '  (#' + (p.patient_no || '-') + ')';
    }

    var denInput = g('conPsInputDen');
    if (denInput && document.activeElement !== denInput) {
        denInput.value = (typeof patientSearchInputDisplayValue === 'function')
            ? patientSearchInputDisplayValue(p)
            : (p.full_name + ' (#' + (p.patient_no || '') + ')');
        denInput.dataset.psLockedPatientId = String(p.id || '');
    }
    var denDrop = g('conPsDropDen');
    if (denDrop) denDrop.style.display = 'none';

    var chartInput = g('conPsInputChart');
    if (chartInput && document.activeElement !== chartInput) {
        chartInput.value = (typeof patientSearchInputDisplayValue === 'function')
            ? patientSearchInputDisplayValue(p)
            : (p.full_name + ' (#' + (p.patient_no || '') + ')');
        chartInput.dataset.psLockedPatientId = String(p.id || '');
    }
    var chartDrop = g('conPsDropChart');
    if (chartDrop) chartDrop.style.display = 'none';

    var treatInput = g('conPsInput');
    if (treatInput && document.activeElement !== treatInput) {
        treatInput.value = (typeof patientSearchInputDisplayValue === 'function')
            ? patientSearchInputDisplayValue(p)
            : (p.full_name + ' (#' + (p.patient_no || '') + ')');
        treatInput.dataset.psLockedPatientId = String(p.id || '');
    }
    var treatDrop = g('conPsDrop');
    if (treatDrop) treatDrop.style.display = 'none';

    var formsInput = g('conFormsPsInput');
    if (formsInput && document.activeElement !== formsInput) {
        formsInput.value = (typeof patientSearchInputDisplayValue === 'function')
            ? patientSearchInputDisplayValue(p)
            : (p.full_name + ' (#' + (p.patient_no || '') + ')');
        formsInput.dataset.psLockedPatientId = String(p.id || '');
    }
    var formsDrop = g('conFormsPsDrop');
    if (formsDrop) formsDrop.style.display = 'none';

    var denBanner = g('conDenBanner');
    if (denBanner) denBanner.style.display = 'flex';

    if (g('conDenBannerName'))
        g('conDenBannerName').textContent = p.full_name;
    if (g('conDenBannerNo'))
        g('conDenBannerNo').textContent = p.patient_no || '-';
    if (g('conDenBannerDob'))
        g('conDenBannerDob').textContent =
            p.dob ? formatDobAge(p.dob) : '-';
    setConBannerAlert('conDenBannerAlert', p);
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

    // Mark dirty on any editor or doc-name change
    var editorEl = g('conFormsDocEditor');
    if (editorEl && !editorEl._conFormsDirtyBound) {
        editorEl._conFormsDirtyBound = true;
        editorEl.addEventListener('input', function() { _conFormsDirty = true; });
    }
    var nameEl = g('conFormsDocName');
    if (nameEl && !nameEl._conFormsDirtyBound) {
        nameEl._conFormsDirtyBound = true;
        nameEl.addEventListener('input', function() { _conFormsDirty = true; });
    }
}

function conFormsUpdateEditingBadge() {
    var badge = g('conFormsEditingBadge');
    if (!badge) return;
    if (conFormsEditingDocId) badge.classList.add('is-on');
    else badge.classList.remove('is-on');
}

function conFormsStartNewDoc() {
    _conFormsDirty = false;
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
            '<div style="font-size:20px;font-weight:700;color:#0f172a;line-height:1.25;font-family:\'Joyful CJK Rare Serif\',\'Joyful CJK Serif\',serif;">{clinic_name_chi}</div>' +
            '<div style="font-size:14px;color:#334155;margin-top:4px;line-height:1.4;">{clinic_address}</div>' +
            '<div style="font-size:14px;color:#334155;margin-top:2px;line-height:1.4;font-family:\'Joyful CJK Rare Serif\',\'Joyful CJK Serif\',serif;">{clinic_address_chi}</div>' +
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
    addon += '<div style="margin-top:4px;font-size:13px;font-family:\'Joyful CJK Rare Serif\',\'Joyful CJK Serif\',serif;line-height:1.35;">{doctor_qualification_chi}</div>';
    return s + addon;
}

function conFormsDefaultFooterTemplate() {
    return '' +
        '<div data-conforms-default-footer="1" style="margin-top:30px;padding-top:8px;">' +
            '<div style="max-width:400px;">' +
                '<div style="border-bottom:1.5px solid #334155;height:22px;"></div>' +
                '<div style="margin-top:8px;font-size:16px;font-weight:700;color:#0f172a;line-height:1.25;">{doctor_eng}</div>' +
                '<div style="margin-top:3px;font-size:16px;font-weight:700;color:#0f172a;line-height:1.25;font-family:\'Joyful CJK Rare Serif\',\'Joyful CJK Serif\',serif;">{doctor_chi}</div>' +
                '<div style="margin-top:8px;font-size:13px;font-weight:700;letter-spacing:.2px;line-height:1.35;">{doctor_qualification}</div>' +
                '<div style="margin-top:4px;font-size:13px;font-family:\'Joyful CJK Rare Serif\',\'Joyful CJK Serif\',serif;line-height:1.35;">{doctor_qualification_chi}</div>' +
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
        autoSelectSingle: false,
        activeSource: 'consultation-forms-search',
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
    addon += '<div data-conforms-sick-qual-chi="1" style="margin-top:4px;font-size:13px;font-family:\'Joyful CJK Rare Serif\',\'Joyful CJK Serif\',serif;">{doctor_qualification_chi}</div>';
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
        '<p style="margin:0 0 6px;font-family:\'Joyful CJK Rare Serif\',\'Joyful CJK Serif\',serif;">茲　證　明　{patient_chinese_name_spaced}　因　患　上</p>' +
        '<p data-conforms-sick-dx="1" style="margin:14px 0;text-align:center;font-style:italic;font-size:15px;">{diagnosis}</p>' +
        '<p style="margin:0 0 6px;">is unfit for work and is recommended <strong>{sick_leave_days}</strong> day(s) sick leave</p>' +
        '<p style="margin:0 0 6px;font-family:\'Joyful CJK Rare Serif\',\'Joyful CJK Serif\',serif;">故　不　宜　工　作　及　需　要　病　假　休　息　<strong>{sick_leave_days}</strong>　天</p>' +
        '<p style="margin:0 0 6px;">from <strong>{sick_leave_from_ddmm}</strong> to <strong>{sick_leave_to_ddmm}</strong> inclusive.</p>' +
        '<p style="margin:0 0 20px;font-family:\'Joyful CJK Rare Serif\',\'Joyful CJK Serif\',serif;">由　<strong>{sick_leave_from_ddmm}</strong>　至　<strong>{sick_leave_to_ddmm}</strong>　止。</p>' +
        '<div style="margin-top:72px;max-width:400px;">' +
        '<div style="border-bottom:1.5px solid #334155;height:24px;margin-bottom:10px;"></div>' +
        '<div style="font-size:16px;font-weight:700;line-height:1.3;">{doctor_eng}</div>' +
        '<div style="margin-top:4px;font-size:16px;font-weight:700;line-height:1.3;font-family:\'Joyful CJK Rare Serif\',\'Joyful CJK Serif\',serif;">{doctor_chi}</div>' +
        '<div data-conforms-sick-qual-en="1" style="margin-top:8px;font-size:13px;font-weight:700;letter-spacing:.2px;">{doctor_qualification}</div>' +
        '<div data-conforms-sick-qual-chi="1" style="margin-top:4px;font-size:13px;font-family:\'Joyful CJK Rare Serif\',\'Joyful CJK Serif\',serif;">{doctor_qualification_chi}</div>' +
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
        _conFormsDirty = false;
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

function conFormsDocIsPdfRecord(d) {
    if (!d) return false;
    if (String(d.template_type || '').toLowerCase() === 'pdf') return true;
    return /pde-saved-pdf|data-file-path\s*=/.test(String(d.content_html || ''));
}

function conFormsParsePdfStoragePath(html) {
    var meta = conFormsParsePdfStorageMeta(html);
    return meta ? meta.path : null;
}

function conFormsParsePdfStorageMeta(html) {
    html = String(html || '');
    var pathM = html.match(/data-file-path=["']([^"']+)["']/);
    if (!pathM) return null;
    var bucketM = html.match(/data-file-bucket=["']([^"']+)["']/);
    return {
        path: pathM[1],
        bucket: bucketM ? bucketM[1] : 'patient-documents'
    };
}

function conFormsCollectEditorHtml() {
    var html = '';
    if (typeof DocEditor !== 'undefined' && typeof DocEditor.getHtml === 'function') {
        html = DocEditor.getHtml('conFormsDocEditor') || '';
    } else if (g('conFormsDocEditor')) {
        html = g('conFormsDocEditor').innerHTML || '';
    }
    if (html && typeof conFormsPreparePrintHtml === 'function') {
        html = conFormsPreparePrintHtml(html, false);
    }
    return html;
}

function conFormsGetPrintSheetCss() {
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
    if (typeof CFG !== 'undefined' && CFG) {
        if (typeof CFG.prefetchPrintSettings === 'function') {
            CFG.prefetchPrintSettings(cid);
        }
        if (CFG.getPrintSettingsForDoc && CFG.buildPrintSheetStylesCss) {
            var lettersRow = CFG.getPrintSettingsForDoc('letters', cid);
            sheetCss = CFG.buildPrintSheetStylesCss(lettersRow);
        }
    }
    return sheetCss;
}

function conExportFormsPdf() {
    if (!conFormsPatientId || !conFormsPatientData) {
        alert(conTr('con.forms.alertSelectPatient'));
        return;
    }
    if (typeof PDFEDITOR === 'undefined' || typeof PDFEDITOR.exportFormsHtmlToPatient !== 'function') {
        alert(conTr('con.forms.pdfExportUnavailable'));
        return;
    }
    var html = conFormsCollectEditorHtml();
    if (!html || !String(html).replace(/<[^>]+>/g, '').trim()) {
        alert(conTr('con.forms.alertEmpty'));
        return;
    }
    var docNameEl = g('conFormsDocName');
    var docName = docNameEl ? String(docNameEl.value || '').trim() : '';
    if (!docName) {
        var tpl = conFormsSelectedTemplate;
        docName = (tpl && tpl.template_name) ? tpl.template_name : 'Document';
    }
    var patient = conFormsPatientData;
    var tplMeta = conFormsSelectedTemplate;
    var editingPdfId = null;
    var storagePath = null;
    var storageBucket = null;
    if (conFormsEditingDocId && conFormsDocsCache[conFormsEditingDocId]) {
        var cached = conFormsDocsCache[conFormsEditingDocId];
        if (conFormsDocIsPdfRecord(cached)) {
            editingPdfId = cached.id;
            var pdfMeta = conFormsParsePdfStorageMeta(cached.content_html);
            if (pdfMeta) {
                storagePath = pdfMeta.path;
                storageBucket = pdfMeta.bucket;
            }
        }
    }
    var exportBtn = g('conFormsExportPdfBtn');
    if (exportBtn) {
        exportBtn.disabled = true;
        exportBtn.textContent = conTr('con.forms.exportPdfWorking');
    }
    PDFEDITOR.exportFormsHtmlToPatient({
        html: html,
        sheetCss: conFormsGetPrintSheetCss(),
        patient: patient,
        template: tplMeta,
        documentName: docName,
        editingDocId: editingPdfId,
        storagePath: storagePath,
        storageBucket: storageBucket,
        download: true
    }).then(function (docId) {
        if (docId) conFormsEditingDocId = docId;
        conFormsUpdateEditingBadge();
        alert(conTr('con.forms.exportPdfOk'));
        searchConFormsDocs();
        conSchedulePatientTimelineRefresh(conPatientId);
    }).catch(function (e) {
        alert(conTrRepl('con.forms.exportPdfFailed', { MSG: (e && e.message) || String(e) }));
    }).finally(function () {
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.textContent = conTr('con.forms.btnExportPdf');
        }
    });
}

function conOpenPdfEditorWithRecord(d) {
    if (typeof PDFEDITOR === 'undefined' || typeof PDFEDITOR.open !== 'function') {
        alert(typeof conTr === 'function'
            ? conTr('con.forms.pdfEditorUnavailable')
            : 'PDF Editor is not available.');
        return;
    }
    var path = conFormsParsePdfStoragePath(d.content_html);
    if (!path) {
        alert(typeof conTr === 'function'
            ? conTr('con.forms.pdfOpenMissingPath')
            : 'Could not locate the saved PDF file.');
        return;
    }
    var pdfMeta = conFormsParsePdfStorageMeta(d.content_html);
    var patient = (typeof conFormsPatientData !== 'undefined' && conFormsPatientData)
        ? conFormsPatientData
        : ((typeof conPatientData !== 'undefined' && conPatientData) ? conPatientData : null);
    conFormsEditingDocId = d.id;
    conFormsUpdateEditingBadge();
    PDFEDITOR.open({
        patient: patient,
        patientId: patient ? null : (d.patient_id || conFormsPatientId || conPatientId),
        template: {
            id: d.template_id,
            template_code: d.template_code,
            template_name: d.template_name,
            template_type: d.template_type
        },
        documentName: d.document_name,
        storagePath: path,
        storageBucket: pdfMeta ? pdfMeta.bucket : null,
        editingDocId: d.id,
        fileName: (d.document_name || 'document') + '.pdf',
        returnScreen: 'consultationSection',
        returnConTab: 'forms'
    });
}

function printConFormsHtml(html) {
    if (typeof confirmPrintReminder === 'function' && !confirmPrintReminder()) return;
    var cid = (typeof currentClinicId !== 'undefined' && currentClinicId)
        ? String(currentClinicId) : '';

    var sheetCss = conFormsGetPrintSheetCss();
    var popW = 900;
    var popH = 760;

    if (typeof CFG !== 'undefined' && CFG && CFG.estimatePrintPopupSizePx) {
        var lettersRow = CFG.getPrintSettingsForDoc
            ? CFG.getPrintSettingsForDoc('letters', cid)
            : null;
        if (lettersRow) {
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
        (typeof appCjkFontLinkHtml === 'function' ? appCjkFontLinkHtml() : '') +
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
            var isPdf = conFormsDocIsPdfRecord(d);
            var meta = (d.template_name || '-') + (d.template_type ? ' · ' + conDispTplType(d.template_type) : '');
            if (isPdf) meta += ' · PDF';
            var safeId = esc(d.id);
            var editing = conFormsEditingDocId === d.id;
            var openLabel = isPdf
                ? (typeof conTr === 'function' ? conTr('con.forms.btnOpenPdf') : 'Open PDF')
                : (typeof conTr === 'function' ? conTr('con.forms.btnOpen') : 'Open');
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
                  'onclick="event.stopPropagation();openConFormsDoc(\'' + safeId + '\')">' + esc(openLabel) + '</button>' +
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
        if (conFormsDocIsPdfRecord(d)) {
            conOpenPdfEditorWithRecord(d);
            searchConFormsDocs();
            return;
        }
        if (g('conFormsEditorWrap')) g('conFormsEditorWrap').style.display = 'block';
        _conFormsDirty = false;   // opening a saved doc is not a dirty state
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
/** Bumps on each consultation patient switch so stale note fetches cannot paint. */
var conNotesLoadGen = 0;
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

function conPtlSafeOptionalRows(promise, optionalName) {
    return promise.then(function (r) {
        if (r && r.error) {
            var msg = String(r.error.message || r.error.details || '').toLowerCase();
            if (optionalName && msg.indexOf(String(optionalName).toLowerCase()) >= 0) return [];
            conPatientTimelineHadErrors = true;
            return [];
        }
        return (r && r.data) ? r.data : [];
    }).catch(function (err) {
        var msg = String((err && (err.message || err.details)) || '').toLowerCase();
        if (optionalName && msg.indexOf(String(optionalName).toLowerCase()) >= 0) return [];
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
        { key: 'payment', labelKey: 'con.ptl.filter.payment' },
        { key: 'doc', labelKey: 'con.ptl.filter.doc' },
        { key: 'xray', labelKey: 'con.ptl.filter.xray' },
        { key: 'photo', labelKey: 'con.ptl.filter.photo' },
        { key: 'chart', labelKey: 'con.ptl.filter.chart' },
        { key: 'task', labelKey: 'con.ptl.filter.task' }
    ];
    var filterHtml = defs.map(function (d) {
        var on = conPtlFilterKey === d.key;
        return '<button type="button" class="con-ptl-filter' + (on ? ' active' : '') + '" data-filter="' +
            esc(d.key) + '">' + esc(conTr(d.labelKey)) + '</button>';
    }).join('');
    host.innerHTML =
        '<div class="con-ptl-filter-row">' + filterHtml + '</div>' +
        '<div class="con-ptl-search-row">' +
            '<input id="conPtlSearchInput" class="con-ptl-search" type="search" value="' +
                esc(conPtlSearchTerm) + '" placeholder="' + esc(conTr('con.ptl.searchPh')) + '">' +
            '<button type="button" class="con-ptl-refresh" data-ptl-refresh="1">' +
                esc(conTr('con.ptl.refresh')) + '</button>' +
        '</div>';
    if (!host.dataset.wired) {
        host.dataset.wired = '1';
        host.addEventListener('click', function (e) {
            var refreshBtn = e.target && e.target.closest ? e.target.closest('[data-ptl-refresh]') : null;
            if (refreshBtn && host.contains(refreshBtn)) {
                if (conPatientId) loadConPatientTimeline(conPatientId);
                return;
            }
            var btn = e.target && e.target.closest ? e.target.closest('[data-filter]') : null;
            if (!btn || !host.contains(btn)) return;
            conPtlFilterKey = btn.getAttribute('data-filter') || 'all';
            conPtlBuildFilterBar();
            renderConPatientTimeline();
        });
        host.addEventListener('input', function (e) {
            if (!e.target || e.target.id !== 'conPtlSearchInput') return;
            conPtlSearchTerm = String(e.target.value || '').trim().toLowerCase();
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

function conPtlEventsFromPayments(rows, billMap) {
    billMap = billMap || {};
    return (rows || []).map(function (p) {
        var ms = conPtlTsFromAny(p.created_at, p.paid_date) ||
            conPtlTsFromIsoDateTime(p.paid_date, '12:00');
        var amt = (typeof fmt2 === 'function') ? fmt2(p.amount) : String(p.amount || '0');
        var method = p.method || '';
        var bill = billMap[String(p.bill_id || '')] || null;
        var voided = p.voided_at ? (' ' + conTr('con.ptl.paymentVoided')) : '';
        return {
            kind: 'payment',
            ts: ms,
            title: conTr('con.ptl.type.payment') + voided,
            body: conTrRepl('con.ptl.paymentSummary', { AMT: amt, METHOD: method || '—' }),
            meta: [
                p.paid_date || '',
                bill && bill.id ? ('Bill #' + String(bill.id).slice(0, 8).toUpperCase()) : ''
            ].filter(Boolean).join(' · '),
            action: 'bill',
            refId: p.bill_id,
            payload: bill || { id: p.bill_id }
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

function conPtlEventsFromPhotos(rows) {
    return (rows || []).map(function (p) {
        var ms = conPtlTsFromAny(p.created_at, p.taken_date) ||
            conPtlTsFromIsoDateTime(p.taken_date, '12:00');
        return {
            kind: 'photo',
            ts: ms,
            title: conTr('con.ptl.type.photo'),
            body: p.category || '—',
            meta: [p.taken_date, conPtlTruncate(p.caption, 120)].filter(Boolean).join(' · '),
            action: 'photo',
            refId: p.id
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

/** Lightweight, translation-free summary of a dental_charts row's JSON payload
 *  (used only for timeline event bodies; the full parser lives in app-charts.js). */
function conPtlChartSummary(row) {
    var denCount = 0, maxPd = 0, bopCount = 0;
    try {
        var den = row.dental_data ? JSON.parse(row.dental_data) : {};
        Object.keys(den).forEach(function (k) {
            if (k === '__notes__') return;
            var v = den[k];
            if (Array.isArray(v) && v.length) denCount++;
        });
    } catch (e) {}
    try {
        var per = row.perio_data ? JSON.parse(row.perio_data) : {};
        Object.keys(per).forEach(function (k) {
            if (k.indexOf('_pd_') >= 0) {
                var v = parseFloat(per[k]);
                if (isFinite(v) && v > maxPd) maxPd = v;
            } else if (k.indexOf('_bop_') >= 0 && per[k]) {
                bopCount++;
            }
        });
    } catch (e) {}
    var parts = [];
    if (denCount) parts.push('🦷 ' + denCount);
    if (maxPd)    parts.push('📏 ' + maxPd + 'mm');
    if (bopCount) parts.push('🩸 ' + bopCount);
    return parts.join(' · ');
}

function conPtlEventsFromCharts(rows) {
    return (rows || []).map(function (c) {
        var ms = conPtlTsFromAny(c.created_at, c.chart_date) ||
            conPtlTsFromIsoDateTime(c.chart_date, '12:00');
        return {
            kind: 'chart',
            ts: ms,
            title: conTr('con.ptl.type.chart'),
            body: conPtlChartSummary(c) || conTr('con.ptl.chartNoFindings'),
            meta: c.chart_date || '',
            action: 'chart',
            refId: c.id,
            chartDate: c.chart_date
        };
    });
}

function conPtlTaskLabel(kind, value) {
    if (kind === 'lab') {
        if (value === 'pending') return conTr('con.ptl.taskLabPending');
        if (value === 'back') return conTr('con.ptl.taskLabBack');
        return '';
    }
    if (kind === 'recall') {
        if (value === 'success') return conTr('con.ptl.taskRecallSuccess');
        if (value === 'cant') return conTr('con.ptl.taskRecallCant');
        if (value === 'whatsapp') return conTr('con.ptl.taskRecallWhatsapp');
        if (value === 'voice') return conTr('con.ptl.taskRecallVoice');
        if (value === 'cancel') return conTr('con.ptl.taskRecallCancel');
    }
    return '';
}

function conPtlEventsFromTasks(rows, apptMap) {
    apptMap = apptMap || {};
    var out = [];
    (rows || []).forEach(function (row) {
        if (!row || !row.appointment_id) return;
        var ap = apptMap[String(row.appointment_id)] || {};
        var ts = conPtlTsFromAny(row.updated_at || row.created_at, ap.date) ||
            conPtlTsFromIsoDateTime(ap.date, ap.start_time || '12:00');
        var lab = conPtlTaskLabel('lab', row.lab_status);
        var recall = conPtlTaskLabel('recall', row.recall_status);
        var parts = [lab, recall].filter(Boolean);
        if (!parts.length) return;
        out.push({
            kind: 'task',
            ts: ts,
            title: conTr('con.ptl.type.task'),
            body: parts.join(' · '),
            meta: [ap.date, conPtlFormatApptTimeRange(ap), conPtlResolveApptDoctorLabel(ap)].filter(Boolean).join(' · '),
            action: 'visit',
            refId: row.appointment_id,
            payload: {
                id: row.appointment_id,
                date: ap.date,
                start_time: ap.start_time,
                doctor_code: ap.doctor_code,
                bill_status: ap.bill_status
            }
        });
    });
    return out;
}

function conPtlMergeEvents(lists) {
    var all = [];
    lists.forEach(function (arr) {
        if (arr && arr.length) all = all.concat(arr);
    });
    all.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    return all;
}

function conPtlSearchText(ev) {
    ev = ev || {};
    return [
        ev.title, ev.headline, ev.body, ev.meta, ev.statusLabel, ev.kind
    ].join(' ').toLowerCase();
}

function conPtlFilteredEvents() {
    var list = conPatientTimelineEvents || [];
    if (conPtlFilterKey && conPtlFilterKey !== 'all') {
        list = list.filter(function (ev) { return ev.kind === conPtlFilterKey; });
    }
    if (conPtlSearchTerm) {
        list = list.filter(function (ev) {
            return conPtlSearchText(ev).indexOf(conPtlSearchTerm) >= 0;
        });
    }
    return list;
}

function conPtlSummaryHtml(list) {
    var all = conPatientTimelineEvents || [];
    var counts = {};
    all.forEach(function (ev) { counts[ev.kind] = (counts[ev.kind] || 0) + 1; });
    var unpaid = all.filter(function (ev) {
        return ev.kind === 'bill' && ev.payload && parseFloat(ev.payload.balance) > 0.005 && !ev.payload.voided_at;
    }).length;
    var upcoming = all.filter(function (ev) { return !!ev.upcoming; }).length;
    var pieces = [
        conTrRepl('con.ptl.summaryTotal', { N: String(all.length) }),
        conTrRepl('con.ptl.summaryShown', { N: String((list || []).length) })
    ];
    if (upcoming) pieces.push(conTrRepl('con.ptl.summaryUpcoming', { N: String(upcoming) }));
    if (unpaid) pieces.push(conTrRepl('con.ptl.summaryUnpaid', { N: String(unpaid) }));
    return '<div class="con-ptl-summary">' + pieces.map(function (p) {
        return '<span>' + esc(p) + '</span>';
    }).join('') + '</div>';
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
    var qPhoto = SB.from('photos').select('id,category,caption,taken_date,created_at')
        .eq('patient_id', pid).order('created_at', { ascending: false }).limit(80);

    var qBill = SB.from('bills').select('id,total,balance,voided_at,created_at,appointment_id')
        .eq('patient_id', pid).order('created_at', { ascending: false }).limit(120);
    var qChart = SB.from('dental_charts').select(
        'id,chart_date,dental_data,perio_data,created_at'
    ).eq('patient_id', pid).order('chart_date', { ascending: false }).limit(60);

    Promise.all([
        conPtlSafeRows(qNotes),
        conPtlSafeRows(qRx),
        conPtlSafeRows(qAppt),
        conPtlSafeRows(qBill),
        conPtlSafeRows(qDocs),
        conPtlSafeRows(qXray),
        conPtlSafeRows(qPhoto),
        conPtlSafeRows(qChart)
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
        var bills2 = parts[3] || [];
        var appts2 = parts[2] || [];
        var billIds = bills2.map(function (b) { return b && b.id; }).filter(Boolean);
        var apptIds = appts2.map(function (a) { return a && a.id; }).filter(Boolean);
        var qPayments = billIds.length
            ? conPtlSafeRows(
                SB.from('bill_payments').select('*').in('bill_id', billIds)
                    .order('paid_date', { ascending: false })
                    .order('created_at', { ascending: false }).limit(200)
            )
            : Promise.resolve([]);
        var qTasks = apptIds.length
            ? conPtlSafeOptionalRows(
                SB.from('appointment_task_states')
                    .select('appointment_id,lab_status,recall_status,created_at,updated_at')
                    .in('appointment_id', apptIds),
                'appointment_task_states'
            )
            : Promise.resolve([]);
        return Promise.all([Promise.resolve(parts), qPayments, qTasks]);
    }).then(function (bundle) {
        if (pid !== conPatientId) return;
        var parts = bundle[0];
        var payments = bundle[1] || [];
        var tasks = bundle[2] || [];
        var billMap = {};
        (parts[3] || []).forEach(function (b) { if (b && b.id) billMap[String(b.id)] = b; });
        var apptMap = {};
        (parts[2] || []).forEach(function (a) { if (a && a.id) apptMap[String(a.id)] = a; });
        conPatientTimelineEvents = conPtlMergeEvents([
            conPtlEventsFromNotes(parts[0]),
            conPtlEventsFromRx(parts[1]),
            conPtlEventsFromVisits(parts[2]),
            conPtlEventsFromBills(parts[3]),
            conPtlEventsFromDocs(parts[4]),
            conPtlEventsFromXrays(parts[5]),
            conPtlEventsFromPhotos(parts[6]),
            conPtlEventsFromCharts(parts[7]),
            conPtlEventsFromPayments(payments, billMap),
            conPtlEventsFromTasks(tasks, apptMap)
        ]);
        renderConPatientTimeline();
    });
}

function renderConPatientTimeline() {
    var host = g('conPatientTimeline');
    if (!host) return;
    var list = conPtlFilteredEvents();
    if (!list.length) {
        var emptyMsg = conTr('con.ptl.selectPatient');
        if (conPatientId) {
            emptyMsg = (conPatientTimelineEvents.length && (conPtlFilterKey !== 'all' || conPtlSearchTerm))
                ? conTr('con.ptl.emptyFilter')
                : conTr('con.ptl.empty');
        }
        host.innerHTML = conPatientId ? conPtlSummaryHtml(list) : '';
        host.innerHTML += '<p class="con-ptl-placeholder">' + esc(emptyMsg) + '</p>';
        if (conPatientTimelineHadErrors && conPatientId) {
            host.innerHTML += '<p class="con-ptl-placeholder" style="color:#b45309;">' +
                esc(conTr('con.ptl.errLoad')) + '</p>';
        }
        return;
    }
    var html = conPtlSummaryHtml(list);
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
        var actionLabel = ev.action === 'visit'
            ? conTr('con.ptl.actionVisit')
            : (ev.action === 'bill'
                ? conTr('con.ptl.actionBill')
                : (ev.action === 'rx'
                    ? conTr('con.ptl.actionRx')
                    : (ev.action === 'photo'
                        ? conTr('con.ptl.actionPhoto')
                        : (ev.action === 'xray'
                            ? conTr('con.ptl.actionXray')
                            : (ev.action === 'doc'
                                ? conTr('con.ptl.actionDoc')
                                : (ev.action === 'chart' ? conTr('con.ptl.actionChart') : conTr('con.ptl.actionOpen')))))));
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
            '<button type="button" class="con-ptl-event-jump" data-ptl-open="' + idx + '">' +
                esc(actionLabel) + '</button>' +
            '</div>' +
            '</li>';
    });
    if (lastDay) html += '</ul>';
    host.innerHTML = html;
    host.querySelectorAll('.con-ptl-event').forEach(function (el) {
        el.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest('button')) return;
            var idx = parseInt(el.getAttribute('data-ptl-idx'), 10);
            if (!isNaN(idx) && list[idx]) conPtlOpenEvent(list[idx]);
        });
    });
    host.querySelectorAll('[data-ptl-open]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var idx = parseInt(btn.getAttribute('data-ptl-open'), 10);
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
    if (ev.action === 'photo') {
        switchConTab('photos');
        setTimeout(function () {
            if (typeof refreshPhotos === 'function') refreshPhotos();
        }, 80);
        return;
    }
    if (ev.action === 'chart') {
        switchConTab('charting');
        setTimeout(function () {
            var dateEl = g('chartDateInput');
            if (dateEl && ev.chartDate) dateEl.value = ev.chartDate;
            if (ev.chartDate) {
                if (typeof chartDate !== 'undefined') chartDate = ev.chartDate;
                if (typeof loadChartRecord === 'function') loadChartRecord();
            }
        }, 350);
        return;
    }
    if (ev.action === 'bill') {
        if (ev.payload && ev.payload.items && typeof showBillDetail === 'function') {
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
        var doExit = function() {
            if (typeof showOnly === 'function') showOnly('appointmentSection');
            setTimeout(function() {
                if (typeof switchApptTab === 'function') switchApptTab('queue');
            }, 40);
        };
        if (_conFormsDirty) {
            _conFormsCheckUnsavedThen(doExit);
        } else {
            doExit();
        }
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

function renderConNotesIntoHost(hostId, rows, opts) {
    opts = opts || {};
    var tl = g(hostId);
    if (!tl) return;
    rows = rows || [];
    if (!rows.length) {
        tl.innerHTML =
            '<p style="color:#aaa;margin:0;padding:16px;">' +
            esc(conTr('con.noTreatmentNotes')) +
            '</p>';
        return;
    }

    tl.innerHTML = '';
    var todayIso = (typeof todayISO === 'function')
        ? todayISO()
        : conDateIsoFromTs((typeof nowLocal === 'function' ? nowLocal() : new Date()));
    var idPrefix = opts.idPrefix || 'cnt';
    var allowEdit = opts.allowEdit !== false;

    var groups = {};
    var order  = [];
    rows.forEach(function(t) {
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
            var canEdit = allowEdit && isToday && currentRole !== 'nurse';
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
                '<div id="' + idPrefix + '-' + t.id + '" class="note-body">' +
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
}

function renderConNotesEverywhere(rows) {
    renderConNotesIntoHost('conTimeline', rows, { idPrefix: 'cnt', allowEdit: true });
    renderConNotesIntoHost('xrayConTimeline', rows, { idPrefix: 'xray-cnt', allowEdit: false });
}

function loadConNotes(pid, opts) {
    opts = opts || {};
    var expectedGen = conNotesLoadGen;
    var expectedPid = pid;
    if (!opts.keepPaint) clearConNotesDom('loading');

    SB.from('treatments').select('*')
        .eq('patient_id', pid)
        .order('created_at', { ascending: false })
    .then(function(r) {
        if (expectedGen !== conNotesLoadGen) return;
        if (expectedPid && conPatientId && String(conPatientId) !== String(expectedPid)) {
            var xpid = (typeof xrayPatientId !== 'undefined') ? xrayPatientId : null;
            if (!xpid || String(xpid) !== String(expectedPid)) return;
        }
        conTreatmentNotesCache = (r.data && !r.error) ? r.data : [];
        renderConNotesEverywhere(conTreatmentNotesCache);
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

function saveConNoteFromInput(inputId) {
    if (!conPatientId) { alert(conTr('con.note.alertSelectPatient')); return; }
    var inp  = g(inputId || 'conNoteInput');
    if (!inp) return;
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

function saveConNote() {
    saveConNoteFromInput('conNoteInput');
}

function saveXrayConNote() {
    var xpId = (typeof xrayPatientId !== 'undefined') ? xrayPatientId : null;
    if (xpId && (!conPatientId || String(conPatientId) !== String(xpId))) {
        conPatientId = xpId;
        conPatientData = (typeof xrayPatientData !== 'undefined' && xrayPatientData)
            ? xrayPatientData
            : conPatientData;
    }
    saveConNoteFromInput('xrayConNoteInput');
}

function refreshXrayTreatmentNotes() {
    var pid = (typeof xrayPatientId !== 'undefined' && xrayPatientId) ? xrayPatientId : conPatientId;
    if (pid) loadConNotes(pid);
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

function rxPanelIsOpen() {
    var panel = g('drugAddPanel');
    return !!(panel && panel.style.display && panel.style.display !== 'none');
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
        var wasHidden = !rxPanelIsOpen();

        panel.style.display = 'block';
        btn.style.display   = 'none';

        if (!opts.editingHistory && !opts.keepRxLines) {
            rxClearEditingHistoryGroup();
        }

        if (!opts.keepRxLines) {
            rxLines = [];
            rxActiveLineIdx = -1;
            rxDraftDirty = false;
        }
        if (!rxLines.length) {
            rxLines.push(rxEmptyLine());
            rxActiveLineIdx = 0;
        }

        if (!opts.keepRxLines || wasHidden ||
            !String((g('rxDate') && g('rxDate').value) || '').trim()) {
            sv('rxDate', todayISO());
        }
        updateConsultationDoctorUI();
        rxLoadDrugCatalog(wasHidden);
        if (conPatientId) rxLoadPatientAllergy(conPatientId, { force: wasHidden });

        var paint = function() {
            renderRxLines();
            rxRefreshPanelChrome();
            if (wasHidden && rxActiveLineIdx >= 0 && !opts.editingHistory) {
                rxFocusLine(rxActiveLineIdx);
            }
        };
        if (typeof ensureRxPhrasesLoaded === 'function') {
            ensureRxPhrasesLoaded(paint);
        } else {
            paint();
        }
    } else {
        rxCloseDrugMenus();
        panel.style.display = 'none';
        btn.style.display   = 'inline-block';
        rxLines = [];
        rxActiveLineIdx = -1;
        rxDraftDirty = false;
        rxClearEditingHistoryGroup();
        rxRefreshPanelChrome();
    }
}

/** Cancel button: confirm before throwing away a changed draft. */
function rxCancelDraft() {
    if (rxDraftDirty && rxLines.some(rxLineHasDrug) &&
        !confirm(conTr('con.rx.confirmDiscardDraft'))) {
        return;
    }
    toggleDrugAddPanel(false);
}

function rxMarkDirty() {
    if (!rxPanelIsOpen()) return;
    rxDraftDirty = true;
    rxRefreshPanelChrome();
}

/** Called by app-rx-phrases.js after any field change on line idx. */
function rxOnDraftLineChanged(idx) {
    rxMarkDirty();
    rxRefreshAllBadges();
}

function rxFmtDate(iso) {
    var s = String(iso || '').trim();
    if (!s) return '';
    try {
        var dt = new Date(s);
        if (!isNaN(dt)) {
            return dt.toLocaleDateString(conUiLocale(), {
                day: '2-digit', month: 'short', year: 'numeric'
            });
        }
    } catch (e) {}
    return s;
}

/** Title, unsaved marker, doctor chip and save label — everything outside the drug cards. */
function rxRefreshPanelChrome() {
    var title = g('rxPanelTitle');
    if (title) {
        var ctx = rxEditingHistoryGroup;
        title.textContent = (ctx && (ctx.recordIds.length || ctx.prescribed_date))
            ? conTrRepl('con.rx.editingTitle', { DATE: rxFmtDate(ctx.prescribed_date) || '—' })
            : conTr('con.newRx');
    }
    var state = g('rxDraftState');
    if (state) {
        state.hidden = !(rxDraftDirty && rxPanelIsOpen());
        state.textContent = conTr('con.rx.unsaved');
    }
    rxRefreshDoctorChip();
    rxRefreshSavePrescriptionButtonLabel();
}

function rxRefreshDoctorChip() {
    var chip = g('rxDentistName');
    if (!chip) return;
    var name = conActiveDoctorId ? String(conActiveDoctorName || '').trim() : '';
    chip.value = name;
    chip.placeholder = conTr('con.rx.doctorMissing');
    chip.classList.toggle('rx-doctor-chip--missing', !name);
    chip.title = name ? conTr('con.rx.doctorChipTitle') : conTr('con.rx.needDoctor');
}

function rxFocusDoctorPicker() {
    var sel = g('conDoctorSelect');
    if (!sel) return;
    sel.classList.add('rx-attention');
    try {
        sel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        sel.focus();
    } catch (e) {}
    setTimeout(function() { sel.classList.remove('rx-attention'); }, 2400);
}

// ════════════════════════════════════════════════════════════════
// RX LINES — one card per drug; only the active card is expanded
// ════════════════════════════════════════════════════════════════
function rxLineHasDrug(line) {
    return !!(line && String(line.drug_name || '').trim());
}

function rxDrugKey(line) {
    return String((line && line.drug_name) || '').trim().toLowerCase();
}

function rxCommitActiveLine() {
    if (rxActiveLineIdx >= 0 && rxLines[rxActiveLineIdx]) {
        rxSyncLineFromDom(rxActiveLineIdx);
    }
}

function addDrugLine() {
    rxCommitActiveLine();
    for (var i = 0; i < rxLines.length; i++) {
        if (!rxLineHasDrug(rxLines[i])) {
            rxSetActiveLine(i, { focus: true });
            return;
        }
    }
    rxLines.push(rxEmptyLine());
    var prev = rxActiveLineIdx;
    rxActiveLineIdx = rxLines.length - 1;
    var wrap = g('rxLinesWrap');
    if (wrap && wrap.querySelector('.rx-line-card')) {
        if (prev >= 0 && rxLines[prev]) rxRefreshLineCard(prev);
        var tmp = document.createElement('div');
        tmp.innerHTML = rxLineCardHtml(rxActiveLineIdx);
        wrap.appendChild(tmp.firstElementChild);
    } else {
        renderRxLines();
    }
    rxFocusLine(rxActiveLineIdx);
}

function removeRxLine(idx) {
    if (idx < 0 || idx >= rxLines.length) return;
    rxCommitActiveLine();
    var hadDrug = rxLineHasDrug(rxLines[idx]);
    rxLines.splice(idx, 1);
    if (rxActiveLineIdx === idx) rxActiveLineIdx = -1;
    else if (rxActiveLineIdx > idx) rxActiveLineIdx--;
    if (!rxLines.length) {
        rxLines.push(rxEmptyLine());
        rxActiveLineIdx = 0;
    }
    if (hadDrug) rxMarkDirty();
    renderRxLines();
    if (rxActiveLineIdx >= 0) rxFocusLine(rxActiveLineIdx);
}

/**
 * Expand card idx (−1 collapses all). An abandoned blank card is dropped instead of
 * lingering as an empty summary row.
 */
function rxSetActiveLine(idx, opts) {
    opts = opts || {};
    var prev = rxActiveLineIdx;
    if (prev === idx) {
        if (opts.focus && idx >= 0) rxFocusLine(idx);
        return;
    }
    if (prev >= 0 && rxLines[prev]) rxSyncLineFromDom(prev);

    if (prev >= 0 && rxLines[prev] && !rxLineHasDrug(rxLines[prev]) &&
        rxLines.length > 1 && idx !== prev) {
        rxLines.splice(prev, 1);
        if (idx > prev) idx--;
        rxActiveLineIdx = (idx >= 0 && idx < rxLines.length) ? idx : -1;
        renderRxLines();
        if (opts.focus && rxActiveLineIdx >= 0) rxFocusLine(rxActiveLineIdx);
        return;
    }

    rxActiveLineIdx = (idx >= 0 && idx < rxLines.length) ? idx : -1;
    if (prev >= 0 && rxLines[prev]) rxRefreshLineCard(prev);
    if (rxActiveLineIdx >= 0) rxRefreshLineCard(rxActiveLineIdx);
    if (opts.focus && rxActiveLineIdx >= 0) rxFocusLine(rxActiveLineIdx);
}

function rxFocusLine(idx) {
    var line = rxLines[idx];
    if (!line) return;
    var el = rxLineHasDrug(line) ? g('rx-days-sel-' + idx) : g('rx-drug-input-' + idx);
    if (!el) return;
    try {
        el.focus({ preventScroll: true });
        var card = g('rxline-' + idx);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {}
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

/** Only lines with a drug and days; blank cards are ignored. */
function rxAllDraftLinesForSave() {
    rxCommitActiveLine();
    var out = [];
    for (var i = 0; i < rxLines.length; i++) {
        var l = rxNormalizeLine(rxLines[i]);
        if (!rxLineHasDrug(l) || !rxLineHasDays(l)) continue;
        rxAutoQuantity(l);
        rxSyncLineLegacyFields(l);
        rxLines[i] = l;
        out.push(rxCloneSavedLine(l));
    }
    return out;
}

function rxLineSummaryText(line) {
    var meta = rxLineDisplayMeta(line);
    var parts = [];
    [meta.duration, meta.frequency, meta.dosage].forEach(function(v) {
        if (v && v !== '—') parts.push(v);
    });
    if (meta.quantity && meta.quantity !== '—') {
        parts.push(conTr('con.rx.labelQty') + ' ' + meta.quantity);
    }
    return parts.join(' · ');
}

function rxLineWarnings(idx) {
    var line = rxLines[idx];
    var out = { allergy: '', duplicate: false, needDays: false, offCatalog: false };
    if (!rxLineHasDrug(line)) return out;
    out.allergy = rxAllergyMatch(line.drug_name);
    var key = rxDrugKey(line);
    for (var i = 0; i < rxLines.length; i++) {
        if (i !== idx && rxDrugKey(rxLines[i]) === key) {
            out.duplicate = true;
            break;
        }
    }
    out.needDays = !rxLineHasDays(line);
    out.offCatalog = !!(rxDrugCatalog && rxDrugCatalog.length && !rxCatalogFindForLine(line));
    return out;
}

function rxBadgesHtml(w) {
    var html = '';
    if (w.allergy) {
        html += '<span class="rx-badge rx-badge--danger" title="' +
            esc(conTrRepl('con.rx.allergyBadgeTitle', { TERM: w.allergy })) + '">' +
            esc(conTr('con.rx.allergyBadge')) + '</span>';
    }
    if (w.duplicate) {
        html += '<span class="rx-badge rx-badge--warn">' + esc(conTr('con.rx.dupBadge')) + '</span>';
    }
    if (w.needDays) {
        html += '<span class="rx-badge rx-badge--muted">' + esc(conTr('con.rx.needDaysBadge')) + '</span>';
    }
    if (w.offCatalog) {
        html += '<span class="rx-badge rx-badge--muted" title="' +
            esc(conTr('con.rx.offCatalogTitle')) + '">' + esc(conTr('con.rx.offCatalogBadge')) + '</span>';
    }
    return html;
}

function rxRefreshAllBadges() {
    for (var i = 0; i < rxLines.length; i++) {
        var el = g('rx-badges-' + i);
        if (!el) continue;
        var w = rxLineWarnings(i);
        el.innerHTML = rxBadgesHtml(w);
        var card = g('rxline-' + i);
        if (card) card.classList.toggle('rx-line-card--alert', !!w.allergy);
    }
}

function rxLineCardHtml(idx) {
    var line = rxNormalizeLine(rxLines[idx]);
    rxLines[idx] = line;
    var open = idx === rxActiveLineIdx;
    var hasDrug = rxLineHasDrug(line);
    var w = rxLineWarnings(idx);
    var cls = 'rx-line-card ' + (open ? 'rx-line-card--open' : 'rx-line-card--collapsed') +
        (w.allergy ? ' rx-line-card--alert' : '');
    var num = '<span class="rx-line-num">' + (idx + 1) + '</span>';
    var badges = '<span class="rx-line-badges" id="rx-badges-' + idx + '">' + rxBadgesHtml(w) + '</span>';
    var removeBtn =
        '<button type="button" class="rx-line-remove" onclick="removeRxLine(' + idx + ')" ' +
        'title="' + esc(conTr('con.rx.removeLine')) + '" ' +
        'aria-label="' + esc(conTr('con.rx.removeLine')) + '">×</button>';

    if (!open) {
        return (
            '<div class="' + cls + '" id="rxline-' + idx + '">' +
                '<button type="button" class="rx-line-summary" ' +
                'onclick="rxSetActiveLine(' + idx + ',{focus:true})" ' +
                'title="' + esc(conTr('con.rx.editLineTitle')) + '">' +
                    num +
                    '<span class="rx-line-sum-main">' +
                        '<span class="rx-line-sum-drug">' +
                            esc(hasDrug ? line.drug_name : conTr('con.rx.searchDrugPh')) +
                        '</span>' +
                        '<span class="rx-line-sum-meta">' + esc(hasDrug ? rxLineSummaryText(line) : '') + '</span>' +
                    '</span>' +
                    badges +
                '</button>' +
                removeBtn +
            '</div>'
        );
    }

    var body = hasDrug
        ? ('<div class="rx-fields rx-fields--quick">' +
                rxDaysFieldMarkup(idx, line) +
                rxAutoLoadedSummaryMarkup(idx, line) +
                '<details class="rx-advanced-details">' +
                    '<summary>' + esc(conTr('con.rx.advancedDetails')) + '</summary>' +
                    '<div class="rx-advanced-grid">' +
                        rxPhraseFieldMarkup('dosage', idx, line, esc(conTr('con.rx.labelDosage'))) +
                        rxPhraseFieldMarkup('frequency', idx, line, esc(conTr('con.rx.labelFrequency'))) +
                        rxPhraseFieldMarkup('quantity', idx, line, esc(conTr('con.rx.labelQty'))) +
                    '</div>' +
                    '<div class="rx-phrase-preview"></div>' +
                '</details>' +
                '<div class="rx-caution-notes-wrap">' + rxDrugCautionNotesMarkup(idx, line) + '</div>' +
            '</div>')
        : '<div class="rx-line-hint">' + esc(conTr('con.rx.addDrugHint')) + '</div>';

    return (
        '<div class="' + cls + '" id="rxline-' + idx + '">' +
            '<div class="rx-line-head">' +
                num +
                rxDrugComboMarkup(idx, line) +
                (hasDrug
                    ? '<button type="button" class="rx-line-done" onclick="rxSetActiveLine(-1)" ' +
                      'title="' + esc(conTr('con.rx.lineDoneTitle')) + '" ' +
                      'aria-label="' + esc(conTr('con.rx.lineDoneTitle')) + '">✓</button>'
                    : '') +
                removeBtn +
            '</div>' +
            badges +
            body +
        '</div>'
    );
}

/** Swap one card in place (no full re-render, keeps scroll and other cards' state). */
function rxRefreshLineCard(idx) {
    var old = g('rxline-' + idx);
    if (!old || !old.parentNode) {
        renderRxLines();
        return;
    }
    if (rxComboState.idx === idx) rxCloseDrugMenus();
    var tmp = document.createElement('div');
    tmp.innerHTML = rxLineCardHtml(idx);
    old.parentNode.replaceChild(tmp.firstElementChild, old);
    if (idx === rxActiveLineIdx) rxUpdatePhrasePreview(idx);
}

function renderRxLines() {
    var wrap = g('rxLinesWrap');
    if (!wrap) return;
    rxCloseDrugMenus();
    if (rxActiveLineIdx >= rxLines.length) rxActiveLineIdx = -1;

    if (!rxLines.length) {
        wrap.innerHTML = '<p class="rx-empty-hint">' + esc(conTr('con.rx.noDrugsYet')) + '</p>';
        return;
    }
    wrap.innerHTML = rxLines.map(function(_, idx) { return rxLineCardHtml(idx); }).join('');
    if (rxActiveLineIdx >= 0) rxUpdatePhrasePreview(rxActiveLineIdx);
}

// ════════════════════════════════════════════════════════════════
// DRUG CATALOG (druglist) — fetched once, shared by every picker
// ════════════════════════════════════════════════════════════════
function rxLoadDrugCatalog(force) {
    if (rxDrugCatalog && !force) return Promise.resolve(rxDrugCatalog);
    if (rxDrugCatalogPromise) return rxDrugCatalogPromise;
    if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
        return Promise.resolve(rxDrugCatalog || []);
    }
    var fullCols  = 'id,drug_name,category,dosage,frequency,duration,route,remarks,intake_caution';
    var basicCols = 'id,drug_name,category,dosage,frequency,duration,route,remarks';
    function query(cols, activeOnly) {
        var q = SB.from('druglist').select(cols);
        if (activeOnly) q = q.eq('is_active', true);
        return q.order('category', { ascending: true }).order('drug_name', { ascending: true });
    }
    function rowsOf(r) {
        return (!r.error && r.data && r.data.length) ? r.data : null;
    }
    rxDrugCatalogPromise = Promise.resolve(query(fullCols, true))
        .then(function(r) {
            return rowsOf(r) || Promise.resolve(query(basicCols, true)).then(function(r2) {
                return rowsOf(r2) || Promise.resolve(query(basicCols, false)).then(function(r3) {
                    return rowsOf(r3) || [];
                });
            });
        })
        .then(function(rows) {
            rxDrugCatalog = rows;
            rxDrugCatalogPromise = null;
            rxOnDrugCatalogLoaded();
            return rxDrugCatalog;
        })
        .catch(function() {
            rxDrugCatalogPromise = null;
            return rxDrugCatalog || [];
        });
    return rxDrugCatalogPromise;
}

function rxInvalidateDrugCatalog() {
    rxDrugCatalog = null;
    if (rxPanelIsOpen()) rxLoadDrugCatalog(true);
}

function rxOnDrugCatalogLoaded() {
    rxLines.forEach(function(line) {
        if (!rxLineHasDrug(line) || String(line.drug_id || '').trim()) return;
        var hit = rxCatalogFindForLine(line);
        if (hit) line.drug_id = String(hit.id);
    });
    if (rxComboState.idx >= 0) rxDrugComboRender(rxComboState.idx);
    rxRefreshAllBadges();
}

function rxCatalogFindForLine(line) {
    if (!rxDrugCatalog || !line) return null;
    var id = String(line.drug_id || '').trim();
    var nm = rxDrugKey(line);
    var i;
    if (id) {
        for (i = 0; i < rxDrugCatalog.length; i++) {
            if (String(rxDrugCatalog[i].id) === id) return rxDrugCatalog[i];
        }
    }
    if (nm) {
        for (i = 0; i < rxDrugCatalog.length; i++) {
            if (String(rxDrugCatalog[i].drug_name || '').trim().toLowerCase() === nm) {
                return rxDrugCatalog[i];
            }
        }
    }
    return null;
}

/** New drug picked by the user: catalog defaults replace everything from the previous drug. */
function rxApplyCatalogDrugToLine(idx, d) {
    var line = rxLines[idx];
    if (!line || !d) return;
    var rem = (typeof drugUnpackRemarks === 'function')
        ? drugUnpackRemarks(d)
        : { intakeEn: '', intakeZh: '', generalEn: d.remarks || '', generalZh: '' };
    var intake = typeof drugPackBilingualText === 'function'
        ? drugPackBilingualText(rem.intakeEn, rem.intakeZh)
        : (rem.intakeEn || rem.intakeZh || '');
    var general = typeof drugPackBilingualText === 'function'
        ? drugPackBilingualText(rem.generalEn, rem.generalZh)
        : (rem.generalEn || rem.generalZh || '');
    ['dosage', 'frequency', 'duration', 'quantity'].forEach(function(ft) {
        line[ft] = '';
        line[ft + '_zh'] = '';
        line[ft + '_code'] = '';
        line[ft + '_custom'] = '';
    });
    line.quantity_manual = false;
    line.drug_id = String(d.id);
    line.drug_name = String(d.drug_name || '');
    line.route = String(d.route || '');
    rxApplyCatalogDefaultsToLine(idx, {
        dosage: d.dosage,
        frequency: d.frequency,
        duration: d.duration,
        intake_remarks: intake,
        remarks: general
    });
}

// ════════════════════════════════════════════════════════════════
// DRUG TYPEAHEAD
// ════════════════════════════════════════════════════════════════
var rxComboState = { idx: -1, items: [], hi: -1 };

function rxDrugComboMarkup(idx, line) {
    return (
        '<div class="rx-drug-combo">' +
            '<input type="text" id="rx-drug-input-' + idx + '" class="rx-drug-input" ' +
            'autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" ' +
            'aria-expanded="false" aria-controls="rx-drug-menu-' + idx + '" ' +
            'placeholder="' + esc(conTr('con.rx.searchDrugPh')) + '" ' +
            'value="' + esc((line && line.drug_name) || '') + '" ' +
            'oninput="rxDrugComboRender(' + idx + ')" ' +
            'onfocus="rxDrugComboFocus(' + idx + ')" ' +
            'onclick="rxDrugComboOpen(' + idx + ')" ' +
            'onkeydown="rxDrugComboKey(event,' + idx + ')" ' +
            'onblur="rxDrugComboBlur(' + idx + ')">' +
            '<div class="rx-drug-menu" id="rx-drug-menu-' + idx + '" role="listbox" hidden></div>' +
        '</div>'
    );
}

function rxDrugComboFilter(q) {
    var rows = rxDrugCatalog || [];
    q = String(q || '').trim().toLowerCase();
    if (!q) return rows.slice();
    var compact = q.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
    var starts = [];
    var has = [];
    rows.forEach(function(d) {
        var n = String(d.drug_name || '').toLowerCase();
        if (n.indexOf(q) === 0) {
            starts.push(d);
        } else if (n.indexOf(q) >= 0 ||
            (compact && n.replace(/[^a-z0-9\u4e00-\u9fff]/g, '').indexOf(compact) >= 0) ||
            String(d.category || '').toLowerCase().indexOf(q) === 0) {
            has.push(d);
        }
    });
    return starts.concat(has);
}

function rxDrugOptionMeta(d) {
    var lang = typeof rxUiPhraseLang === 'function' ? rxUiPhraseLang() : 'en';
    var dosePair = typeof drugCatalogFieldPair === 'function'
        ? drugCatalogFieldPair(d, 'dosage')
        : { en: d.dosage || '', zh: '' };
    var dose = typeof drugFormatBilingualDisplay === 'function'
        ? drugFormatBilingualDisplay(dosePair.en, dosePair.zh, lang)
        : (d.dosage || '');
    var days = typeof rxParseDaysFromCatalogText === 'function'
        ? rxParseDaysFromCatalogText(d.duration) : '';
    return [
        dose,
        String(d.frequency || '').trim(),
        days ? conTrRepl('con.rx.daysShort', { N: days }) : ''
    ].filter(Boolean).join(' · ');
}

function rxDrugComboRender(idx) {
    var menu = g('rx-drug-menu-' + idx);
    var inp = g('rx-drug-input-' + idx);
    if (!menu || !inp) return;
    if (rxComboState.idx >= 0 && rxComboState.idx !== idx) rxCloseDrugMenus();

    if (!rxDrugCatalog) {
        rxComboState = { idx: idx, items: [], hi: -1 };
        menu.innerHTML = '<div class="rx-drug-menu-empty">' + esc(conTr('common.loadingEllipsis')) + '</div>';
        menu.hidden = false;
        inp.setAttribute('aria-expanded', 'true');
        rxLoadDrugCatalog();
        return;
    }

    var line = rxLines[idx] || {};
    var typed = String(inp.value || '');
    var showAll = !typed.trim() || typed.trim() === String(line.drug_name || '').trim();
    var items = rxDrugComboFilter(showAll ? '' : typed);
    var hi = items.length ? 0 : -1;
    if (showAll && line.drug_id) {
        for (var k = 0; k < items.length; k++) {
            if (String(items[k].id) === String(line.drug_id)) { hi = k; break; }
        }
    }
    rxComboState = { idx: idx, items: items, hi: hi };

    if (!items.length) {
        menu.innerHTML = '<div class="rx-drug-menu-empty">' + esc(conTr('con.rx.noDrugMatch')) + '</div>';
    } else {
        var html = '';
        var lastCat = null;
        items.forEach(function(d, i) {
            if (showAll) {
                var cat = d.category || '';
                if (cat !== lastCat) {
                    html += '<div class="rx-drug-menu-cat">' + esc(conDrugCatLabel(cat)) + '</div>';
                    lastCat = cat;
                }
            }
            var allergy = rxAllergyMatch(d.drug_name);
            var meta = rxDrugOptionMeta(d);
            html +=
                '<div class="rx-drug-opt' + (i === hi ? ' is-active' : '') +
                (allergy ? ' rx-drug-opt--allergy' : '') + '" role="option" ' +
                'id="rx-drug-opt-' + idx + '-' + i + '" ' +
                'aria-selected="' + (i === hi ? 'true' : 'false') + '" ' +
                'onmousedown="rxDrugComboPick(event,' + idx + ',' + i + ')">' +
                    '<span class="rx-drug-opt-name">' + esc(d.drug_name || '') + '</span>' +
                    (allergy
                        ? '<span class="rx-badge rx-badge--danger">' + esc(conTr('con.rx.allergyBadge')) + '</span>'
                        : '') +
                    (meta ? '<span class="rx-drug-opt-meta">' + esc(meta) + '</span>' : '') +
                '</div>';
        });
        menu.innerHTML = html;
    }
    menu.hidden = false;
    inp.setAttribute('aria-expanded', 'true');
    rxDrugComboHighlight(idx);
}

function rxDrugComboHighlight(idx) {
    var menu = g('rx-drug-menu-' + idx);
    var inp = g('rx-drug-input-' + idx);
    if (!menu) return;
    var hi = rxComboState.hi;
    menu.querySelectorAll('.rx-drug-opt').forEach(function(el, i) {
        var on = i === hi;
        el.classList.toggle('is-active', on);
        el.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) {
            try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
        }
    });
    if (inp) {
        if (hi >= 0) inp.setAttribute('aria-activedescendant', 'rx-drug-opt-' + idx + '-' + hi);
        else inp.removeAttribute('aria-activedescendant');
    }
}

function rxDrugComboFocus(idx) {
    var inp = g('rx-drug-input-' + idx);
    if (inp && inp.value) {
        try { inp.select(); } catch (e) {}
    }
    rxDrugComboOpen(idx);
}

function rxDrugComboOpen(idx) {
    var menu = g('rx-drug-menu-' + idx);
    if (menu && !menu.hidden && rxComboState.idx === idx) return;
    rxDrugComboRender(idx);
}

function rxCloseDrugMenus() {
    document.querySelectorAll('.rx-drug-menu').forEach(function(m) {
        m.hidden = true;
        m.innerHTML = '';
    });
    document.querySelectorAll('.rx-drug-input[aria-expanded="true"]').forEach(function(inp) {
        inp.setAttribute('aria-expanded', 'false');
        inp.removeAttribute('aria-activedescendant');
    });
    rxComboState = { idx: -1, items: [], hi: -1 };
}

function rxDrugComboRevert(idx) {
    var inp = g('rx-drug-input-' + idx);
    if (inp && rxLines[idx]) inp.value = rxLines[idx].drug_name || '';
}

function rxDrugComboKey(ev, idx) {
    var menu = g('rx-drug-menu-' + idx);
    var open = !!(menu && !menu.hidden && rxComboState.idx === idx);
    var st = rxComboState;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!open) { rxDrugComboRender(idx); return; }
        if (!st.items.length) return;
        var step = ev.key === 'ArrowDown' ? 1 : -1;
        st.hi = (st.hi + step + st.items.length) % st.items.length;
        rxDrugComboHighlight(idx);
    } else if (ev.key === 'Enter') {
        if (open && st.hi >= 0 && st.items[st.hi]) {
            ev.preventDefault();
            rxDrugComboChoose(idx, st.items[st.hi]);
        }
    } else if (ev.key === 'Escape') {
        if (open) {
            ev.preventDefault();
            ev.stopPropagation();
            rxDrugComboRevert(idx);
            rxCloseDrugMenus();
        }
    } else if (ev.key === 'Tab') {
        var inp = g('rx-drug-input-' + idx);
        var typed = inp ? String(inp.value || '').trim() : '';
        var current = rxLines[idx] ? String(rxLines[idx].drug_name || '').trim() : '';
        if (open && typed && typed !== current && st.hi >= 0 && st.items[st.hi]) {
            ev.preventDefault();
            rxDrugComboChoose(idx, st.items[st.hi]);
        }
    }
}

function rxDrugComboPick(ev, idx, i) {
    if (ev) ev.preventDefault();
    var d = rxComboState.idx === idx ? rxComboState.items[i] : null;
    if (d) rxDrugComboChoose(idx, d);
}

function rxDrugComboBlur(idx) {
    var inp = g('rx-drug-input-' + idx);
    setTimeout(function() {
        if (!inp || !inp.isConnected || document.activeElement === inp) return;
        if (rxComboState.idx === idx) rxCloseDrugMenus();
        var typed = String(inp.value || '').trim().toLowerCase();
        var line = rxLines[idx];
        if (!line) return;
        if (typed && typed !== rxDrugKey(line) && rxDrugCatalog) {
            var exact = rxDrugCatalog.filter(function(d) {
                return String(d.drug_name || '').trim().toLowerCase() === typed;
            })[0];
            if (exact) {
                rxDrugComboChoose(idx, exact, { noFocus: true });
                return;
            }
        }
        rxDrugComboRevert(idx);
    }, 150);
}

function rxDrugComboChoose(idx, d, opts) {
    opts = opts || {};
    rxCloseDrugMenus();
    var line = rxLines[idx];
    if (!d || !line) return;
    if (rxLineHasDrug(line) && String(line.drug_id || '') === String(d.id)) {
        rxDrugComboRevert(idx);
        if (!opts.noFocus) rxFocusLine(idx);
        return;
    }
    rxApplyCatalogDrugToLine(idx, d);
    rxMarkDirty();
    rxRefreshLineCard(idx);
    rxRefreshAllBadges();
    if (!opts.noFocus) rxFocusLine(idx);
}

// ════════════════════════════════════════════════════════════════
// ALLERGY + DUPLICATE CHECKS
// ════════════════════════════════════════════════════════════════
var RX_ALLERGY_CLASSES = [
    ['penicillin', 'amoxicillin', 'amoxycillin', 'amoxil', 'augmentin', 'ampicillin',
        'cloxacillin', 'flucloxacillin', 'co-amoxiclav', 'piperacillin',
        '青霉素', '青黴素', '盤尼西林', '阿莫西林'],
    ['cephalosporin', 'cefalexin', 'cephalexin', 'cefuroxime', 'cefaclor', 'cefadroxil',
        'ceftriaxone', 'cefixime', '頭孢', '头孢'],
    ['nsaid', 'ibuprofen', 'brufen', 'nurofen', 'mefenamic', 'ponstan', 'diclofenac',
        'voltaren', 'naproxen', 'etoricoxib', 'arcoxia', 'celecoxib', 'celebrex', 'aspirin',
        'ketorolac', 'piroxicam', '布洛芬', '阿士匹靈', '阿司匹林'],
    ['sulfa', 'sulpha', 'sulfonamide', 'sulfamethoxazole', 'septrin', 'bactrim', '磺胺'],
    ['macrolide', 'erythromycin', 'clarithromycin', 'azithromycin', 'klacid', 'zithromax'],
    ['tetracycline', 'doxycycline', 'minocycline'],
    ['metronidazole', 'flagyl', '甲硝唑'],
    ['clindamycin', 'dalacin'],
    ['opioid', 'codeine', 'tramadol', 'morphine', '可待因'],
    ['paracetamol', 'acetaminophen', 'panadol', '撲熱息痛', '扑热息痛', '必理痛'],
    ['chlorhexidine', 'corsodyl', '洗必泰']
];
var RX_ALLERGY_NONE_RE =
    /^(nil|none|no|nkda|nka|nkfa|n\/?a|unknown|nil known|no known|-+|—|無|无|沒有|没有|否)$/i;

function rxAllergyTerms(text) {
    return String(text || '').toLowerCase()
        .split(/[,;\/、，；\n|+&]+|\band\b|\bor\b/)
        .map(function(t) {
            return t
                .replace(/allerg(y|ic|ies)?(\s+to)?|過敏|过敏|\bdrugs?\b|[()\[\]:.'"*]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
        })
        .filter(function(t) {
            if (!t || RX_ALLERGY_NONE_RE.test(t)) return false;
            return t.length >= 3 || /[\u4e00-\u9fff]/.test(t);
        });
}

/** Returns the allergy term that the drug matches (directly or by drug class), else ''. */
function rxAllergyMatch(drugName, allergyText) {
    var text = allergyText !== undefined ? allergyText : rxCurrentAllergyText();
    var dn = String(drugName || '').toLowerCase();
    if (!dn || !String(text || '').trim()) return '';
    var firstWord = dn.split(/[^a-z0-9\u4e00-\u9fff-]+/).filter(Boolean)[0] || '';
    var terms = rxAllergyTerms(text);
    for (var i = 0; i < terms.length; i++) {
        var t = terms[i];
        if (dn.indexOf(t) >= 0) return t;
        if (firstWord.length >= 4 && t.indexOf(firstWord) >= 0) return t;
        for (var c = 0; c < RX_ALLERGY_CLASSES.length; c++) {
            var cls = RX_ALLERGY_CLASSES[c];
            var termInClass = cls.some(function(k) {
                return t.indexOf(k) >= 0 || (t.length >= 4 && k.indexOf(t) >= 0);
            });
            if (!termInClass) continue;
            if (cls.some(function(k) { return dn.indexOf(k) >= 0; })) return t;
        }
    }
    return '';
}

function rxCurrentAllergyText() {
    if (rxPatientAllergy && conPatientId && String(rxPatientAllergy.pid) === String(conPatientId)) {
        return rxPatientAllergy.text;
    }
    return (conPatientData && conPatientData.allergy) ? String(conPatientData.allergy) : '';
}

/** Fresh allergy text for pid (opts.force re-reads the DB). Resolves to the text. */
function rxLoadPatientAllergy(pid, opts) {
    opts = opts || {};
    if (!pid) return Promise.resolve('');
    if (!opts.force && rxPatientAllergy && String(rxPatientAllergy.pid) === String(pid)) {
        return Promise.resolve(rxPatientAllergy.text);
    }
    if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
        return Promise.resolve(rxCurrentAllergyText());
    }
    return Promise.resolve(
        SB.from('patients').select('allergy').eq('id', pid).maybeSingle()
    ).then(function(r) {
        if (r.error || !r.data) return rxCurrentAllergyText();
        var text = String(r.data.allergy || '');
        rxPatientAllergy = { pid: pid, text: text };
        if (conPatientData && String(conPatientId) === String(pid)) conPatientData.allergy = text;
        if (String(conPatientId) === String(pid)) rxRefreshAllBadges();
        return text;
    }).catch(function() {
        return rxCurrentAllergyText();
    });
}

/** Resolves true when the user accepts (or there is nothing to warn about). */
function rxConfirmSafetyChecks(lines) {
    var allergyText = rxCurrentAllergyText();
    var allergyHits = [];
    var dups = [];
    var seen = {};
    lines.forEach(function(l) {
        var hit = rxAllergyMatch(l.drug_name, allergyText);
        if (hit) allergyHits.push({ drug: l.drug_name, term: hit });
        var k = rxDrugKey(l);
        if (seen[k] && dups.indexOf(l.drug_name) < 0) dups.push(l.drug_name);
        seen[k] = true;
    });
    if (!allergyHits.length && !dups.length) return Promise.resolve(true);

    var modal = g('drugAllergyWarnModal');
    var titleEl = g('drugAllergyWarnTitle');
    var bodyEl = g('drugAllergyWarnBody');
    var okBtn = g('drugAllergyWarnProceed');
    var cancelBtn = g('drugAllergyWarnCancel');
    if (!modal || !bodyEl || !okBtn || !cancelBtn) {
        var plain = allergyHits.map(function(h) { return h.drug + ' — ' + h.term; })
            .concat(dups).join('\n');
        return Promise.resolve(confirm(conTr('con.rx.safetyConfirmPlain') + '\n\n' + plain));
    }

    var html = '';
    if (allergyHits.length) {
        html +=
            '<p class="rx-warn-lead">' + esc(conTr('con.rx.allergyWarnLead')) + '</p>' +
            '<p class="rx-warn-allergy">' + esc(allergyText) + '</p>' +
            '<ul class="rx-warn-list">' +
            allergyHits.map(function(h) {
                return '<li><strong>' + esc(h.drug) + '</strong> — ' +
                    esc(conTrRepl('con.rx.allergyWarnMatch', { TERM: h.term })) + '</li>';
            }).join('') +
            '</ul>';
    }
    if (dups.length) {
        html +=
            '<p class="rx-warn-lead">' + esc(conTr('con.rx.dupWarnLead')) + '</p>' +
            '<ul class="rx-warn-list">' +
            dups.map(function(d) { return '<li><strong>' + esc(d) + '</strong></li>'; }).join('') +
            '</ul>';
    }
    bodyEl.innerHTML = html;
    if (titleEl) {
        titleEl.textContent = allergyHits.length
            ? conTr('con.rx.allergyWarnTitle')
            : conTr('con.rx.dupWarnTitle');
    }
    okBtn.textContent = allergyHits.length
        ? conTr('con.rx.allergyWarnProceed')
        : conTr('con.rx.dupWarnProceed');
    cancelBtn.textContent = conTr('common.btnCancel');

    return new Promise(function(resolve) {
        var settled = false;
        function finish(ok) {
            if (settled) return;
            settled = true;
            okBtn.onclick = null;
            cancelBtn.onclick = null;
            closeModal('drugAllergyWarnModal');
            resolve(ok);
        }
        okBtn.onclick = function() { finish(true); };
        cancelBtn.onclick = function() { finish(false); };
        openModal('drugAllergyWarnModal');
        try { cancelBtn.focus(); } catch (e) {}
    });
}

// ════════════════════════════════════════════════════════════════
// SAVED MULTI-DRUG LISTS
// Primary store: Supabase table rx_saved_combo_lists, aligned by doctor.
// localStorage kept only as offline / migration cache (not patient-scoped).
// ════════════════════════════════════════════════════════════════

/**
 * Resolve the doctor that owns saved Rx combo lists (consultation doctor).
 * @returns {{ id: string|null, name: string, key: string }}
 */
function rxResolveComboDoctor() {
    var id = '';
    if (typeof conActiveDoctorId !== 'undefined' && conActiveDoctorId) {
        id = String(conActiveDoctorId).trim();
    } else if (typeof currentDoctorId !== 'undefined' && currentDoctorId) {
        id = String(currentDoctorId).trim();
    } else {
        var sel = g('conDoctorSelect');
        if (sel && sel.value) id = String(sel.value).trim();
    }

    var name = '';
    if (typeof conActiveDoctorName !== 'undefined' && conActiveDoctorName) {
        name = String(conActiveDoctorName).trim();
    } else if (typeof currentDoctorName !== 'undefined' && currentDoctorName) {
        name = String(currentDoctorName).trim();
    } else if (typeof currentName !== 'undefined' && currentName) {
        name = String(currentName).trim();
    }
    if (!name && id && typeof conDoctorsById !== 'undefined' && conDoctorsById[id]) {
        var d = conDoctorsById[id];
        name = (typeof doctorDisplayName === 'function')
            ? String(doctorDisplayName(d) || '').trim()
            : String(d.display_name || d.english_name || d.chinese_name || '').trim();
    }

    var key = '';
    if (typeof conLooksLikeUuid === 'function' && conLooksLikeUuid(id)) {
        key = id.toLowerCase();
    } else if (name) {
        key = 'name:' + name.toLowerCase().replace(/[^a-z0-9_\-@.]+/g, '_');
    } else if (typeof currentUserId !== 'undefined' && currentUserId) {
        key = 'user:' + String(currentUserId).trim().toLowerCase()
            .replace(/[^a-z0-9_\-@.]/g, '_');
    } else {
        key = 'anon';
    }

    return {
        id: (typeof conLooksLikeUuid === 'function' && conLooksLikeUuid(id)) ? id : null,
        name: name,
        key: key
    };
}

function rxComboListsStorageKey() {
    return RX_COMBO_LISTS_KEY_BASE + '__doc__' + rxResolveComboDoctor().key;
}

function rxComboListsTableMissing(err) {
    var msg = String((err && err.message) || err || '');
    return /rx_saved_combo_lists|does not exist|schema cache|Could not find the table/i.test(msg);
}

function rxComboListsCreatedBy() {
    try {
        if (typeof currentUserId !== 'undefined' && currentUserId) {
            return String(currentUserId);
        }
    } catch (e) {}
    return '';
}

function readRxComboListsLocal() {
    try {
        var key = rxComboListsStorageKey();
        var raw = localStorage.getItem(key);
        if (!raw) {
            var legacy = localStorage.getItem(RX_COMBO_LISTS_KEY_BASE);
            if (legacy) raw = legacy;
        }
        if (!raw) return [];
        var a = JSON.parse(raw);
        return Array.isArray(a) ? a : [];
    } catch (e) {
        return [];
    }
}

/** Legacy local lists for the active doctor only (shared key + this doctor's cache). */
function readLegacyRxComboListsForDoctor() {
    var seen = {};
    var out = [];
    function absorb(raw) {
        if (!raw) return;
        try {
            var a = JSON.parse(raw);
            if (!Array.isArray(a)) return;
            a.forEach(function (lst) {
                if (!lst || !lst.name) return;
                var sid = String(lst.id || '') + '|' + String(lst.name || '').toLowerCase();
                if (seen[sid]) return;
                seen[sid] = 1;
                out.push(lst);
            });
        } catch (e) {}
    }
    try {
        absorb(localStorage.getItem(rxComboListsStorageKey()));
        absorb(localStorage.getItem(RX_COMBO_LISTS_KEY_BASE));
        // Previous per-login keys (before doctor-aligned Supabase store)
        if (typeof currentUserId !== 'undefined' && currentUserId) {
            var uid = String(currentUserId).trim().toLowerCase()
                .replace(/[^a-z0-9_\-@.]/g, '_');
            absorb(localStorage.getItem(RX_COMBO_LISTS_KEY_BASE + '__' + uid));
        }
    } catch (e2) {}
    return out;
}

function writeRxComboListsLocal(lists) {
    try {
        localStorage.setItem(rxComboListsStorageKey(), JSON.stringify(lists || []));
    } catch (e) {
        /* offline cache is best-effort */
    }
}

function readRxComboListsStorage() {
    if (rxComboListsCacheDoctorKey === rxResolveComboDoctor().key &&
        Array.isArray(rxComboListsCache)) {
        return rxComboListsCache.slice();
    }
    return readRxComboListsLocal();
}

function writeRxComboListsStorage(lists) {
    rxComboListsCache = (lists || []).slice();
    rxComboListsCacheDoctorKey = rxResolveComboDoctor().key;
    writeRxComboListsLocal(rxComboListsCache);
}

function rxNormalizeComboListRow(row) {
    if (!row) return null;
    var lines = row.lines;
    if (typeof lines === 'string') {
        try { lines = JSON.parse(lines); } catch (e) { lines = []; }
    }
    if (!Array.isArray(lines)) lines = [];
    var name = String(row.name || '').trim();
    if (!name) return null;
    return {
        id: String(row.id || ''),
        name: name,
        lines: lines.map(rxCloneSavedLine),
        doctor_id: row.doctor_id || null,
        doctor_name: String(row.doctor_name || '').trim(),
        updated_at: row.updated_at || row.created_at || null,
        created_at: row.created_at || null,
        created_by: row.created_by ? String(row.created_by).trim() : ''
    };
}

function rxNewComboListId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'lst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
}

function migrateLegacyLocalRxComboListsToDb(doc) {
    if (rxComboListsMigrating || typeof SB === 'undefined' || !SB ||
        typeof SB.from !== 'function') {
        return Promise.resolve(0);
    }
    var legacy = readLegacyRxComboListsForDoctor();
    if (!legacy.length) return Promise.resolve(0);
    rxComboListsMigrating = true;
    var chain = Promise.resolve(0);
    legacy.forEach(function (lst) {
        var name = String((lst && lst.name) || '').trim();
        var lines = (lst && Array.isArray(lst.lines)) ? lst.lines.map(rxCloneSavedLine) : [];
        if (!name || !lines.length) return;
        chain = chain.then(function (n) {
            var payload = {
                doctor_id: doc.id || null,
                doctor_key: doc.key,
                doctor_name: doc.name || null,
                name: name,
                lines: lines,
                created_by: rxComboListsCreatedBy() || 'migrate',
                updated_at: lst.updated_at || new Date().toISOString()
            };
            return SB.from(RX_COMBO_LISTS_TABLE).insert([payload]).then(function (r) {
                if (r.error) return n;
                return n + 1;
            });
        });
    });
    return chain.then(function (n) {
        rxComboListsMigrating = false;
        if (n > 0) {
            try {
                localStorage.removeItem(rxComboListsStorageKey());
                localStorage.removeItem(RX_COMBO_LISTS_KEY_BASE);
                if (typeof currentUserId !== 'undefined' && currentUserId) {
                    var uid = String(currentUserId).trim().toLowerCase()
                        .replace(/[^a-z0-9_\-@.]/g, '_');
                    localStorage.removeItem(RX_COMBO_LISTS_KEY_BASE + '__' + uid);
                }
            } catch (e4) {}
        }
        return n;
    }).catch(function () {
        rxComboListsMigrating = false;
        return 0;
    });
}

/**
 * Load this doctor's combo lists from Supabase (cache + local fallback).
 * @param {function(Array, Error|null)=} done
 * @param {{ force?: boolean }=} opts
 */
function rxEnsureComboListsLoaded(done, opts) {
    opts = opts || {};
    var doc = rxResolveComboDoctor();
    if (!opts.force &&
        rxComboListsCacheDoctorKey === doc.key &&
        Array.isArray(rxComboListsCache) &&
        !rxComboListsLoading) {
        if (done) done(rxComboListsCache.slice(), null);
        return;
    }

    if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
        var localOnly = readRxComboListsLocal();
        writeRxComboListsStorage(localOnly);
        if (done) done(localOnly, new Error('Supabase not ready'));
        return;
    }

    rxComboListsLoading = true;
    var q = SB.from(RX_COMBO_LISTS_TABLE)
        .select('id,doctor_id,doctor_key,doctor_name,name,lines,updated_at,created_at,created_by')
        .eq('doctor_key', doc.key)
        .order('updated_at', { ascending: false });

    q.then(function (r) {
        rxComboListsLoading = false;
        if (r.error) {
            var localFallback = readRxComboListsLocal();
            writeRxComboListsStorage(localFallback);
            if (!rxComboListsRemoteWarned) {
                rxComboListsRemoteWarned = true;
                if (rxComboListsTableMissing(r.error)) {
                    alert(conTr('con.rx.comboTableMissing'));
                } else {
                    alert(conTrRepl('con.rx.storageWriteFail', {
                        MSG: r.error.message || String(r.error)
                    }));
                }
            }
            if (done) done(localFallback, r.error);
            return;
        }
        var list = (r.data || []).map(rxNormalizeComboListRow).filter(function (x) {
            return !!x;
        });
        if (!list.length) {
            return migrateLegacyLocalRxComboListsToDb(doc).then(function (migrated) {
                if (migrated) {
                    rxEnsureComboListsLoaded(done, { force: true });
                    return;
                }
                writeRxComboListsStorage([]);
                if (done) done([], null);
            });
        }
        writeRxComboListsStorage(list);
        if (done) done(list, null);
    }).catch(function (e) {
        rxComboListsLoading = false;
        var localFallback = readRxComboListsLocal();
        writeRxComboListsStorage(localFallback);
        if (done) done(localFallback, e);
    });
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
    out.quantity_manual = (l.quantity_manual === undefined || l.quantity_manual === null)
        ? rxInferQuantityManual(out)
        : !!l.quantity_manual;
    return out;
}

/**
 * Rows saved before quantity_manual existed: treat the stored quantity as user-set when it
 * differs from what auto-calc would give (e.g. 20 saved, 21 computed), so it is never overwritten.
 */
function rxInferQuantityManual(line) {
    var stored = String(line.quantity_custom || line.quantity_code || line.quantity || '').trim();
    if (!stored || stored === '—') return false;
    var computed = typeof rxComputeQuantityFromLine === 'function'
        ? rxComputeQuantityFromLine(line) : '';
    return !computed || String(computed) !== stored;
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

/** Store a cloned line array under a user-named list for the active doctor. */
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

    var doc = rxResolveComboDoctor();
    if (!doc.key || doc.key === 'anon') {
        alert(conTr('con.rx.comboNeedDoctor'));
        return false;
    }

    var promptLine = promptHintCtx
        ? conTrRepl('con.rx.promptNameComboFrom', { CTX: promptHintCtx })
        : conTr('con.rx.promptNameCombo');
    var name = prompt(promptLine, '');
    name = String(name || '').trim();
    if (!name) return false;

    var safeName = String(name).replace(/"/g, "'");
    var payloadLines = snapshot.map(rxCloneSavedLine);

    function finishWrite(lists) {
        lists = lists || [];
        var lowered = name.toLowerCase();
        var dupeIdx = lists.findIndex(function (x) {
            return String(x.name || '').toLowerCase() === lowered;
        });
        if (dupeIdx >= 0 &&
            !confirm(conTrRepl('con.rx.confirmReplaceList', { NAME: safeName }))) {
            return;
        }

        var existingId = dupeIdx >= 0 ? String(lists[dupeIdx].id || '') : '';
        var nowIso = new Date().toISOString();
        var rowPayload = {
            doctor_id: doc.id || null,
            doctor_key: doc.key,
            doctor_name: doc.name || null,
            name: name,
            lines: payloadLines,
            updated_at: nowIso
        };
        var createdBy = rxComboListsCreatedBy();
        if (createdBy && !(existingId && conLooksLikeUuid(existingId))) {
            rowPayload.created_by = createdBy;
        }

        function applyLocal(savedRow) {
            var normalized = rxNormalizeComboListRow(savedRow) || {
                id: existingId || rxNewComboListId(),
                name: name,
                lines: payloadLines,
                doctor_id: doc.id,
                doctor_name: doc.name,
                updated_at: nowIso
            };
            var next = lists.slice();
            if (dupeIdx >= 0) next[dupeIdx] = normalized;
            else next.unshift(normalized);
            writeRxComboListsStorage(next);
            alert(conTrRepl('con.rx.savedListOk', {
                NAME: safeName,
                N: payloadLines.length
            }));
            if (typeof rxRenderSavedDrugListsModal === 'function') {
                var modal = g('rxDrugListsModal');
                if (modal && modal.style.display === 'block') {
                    rxRenderSavedDrugListsModal();
                }
            }
        }

        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            applyLocal({
                id: (existingId && conLooksLikeUuid(existingId))
                    ? existingId
                    : rxNewComboListId(),
                name: name,
                lines: payloadLines,
                doctor_id: doc.id,
                doctor_name: doc.name,
                updated_at: nowIso
            });
            return;
        }

        var req = (existingId && conLooksLikeUuid(existingId))
            ? SB.from(RX_COMBO_LISTS_TABLE).update(rowPayload).eq('id', existingId)
                .select('*').limit(1)
            : SB.from(RX_COMBO_LISTS_TABLE).insert([rowPayload]).select('*').limit(1);

        req.then(function (r) {
            if (r.error) {
                if (rxComboListsTableMissing(r.error)) {
                    alert(conTr('con.rx.comboTableMissing'));
                } else {
                    alert(conTrRepl('con.rx.storageWriteFail', {
                        MSG: r.error.message || String(r.error)
                    }));
                }
                // Still keep a local copy so the clinician is not blocked
                applyLocal({
                    id: existingId || rxNewComboListId(),
                    name: name,
                    lines: payloadLines,
                    doctor_id: doc.id,
                    doctor_name: doc.name,
                    updated_at: nowIso
                });
                return;
            }
            var row = (r.data && r.data[0]) ? r.data[0] : Object.assign({
                id: existingId || rxNewComboListId()
            }, rowPayload);
            applyLocal(row);
        }).catch(function (e) {
            alert(conTrRepl('con.rx.storageWriteFail', { MSG: (e && e.message) || e }));
            applyLocal({
                id: existingId || rxNewComboListId(),
                name: name,
                lines: payloadLines,
                doctor_id: doc.id,
                doctor_name: doc.name,
                updated_at: nowIso
            });
        });
    }

    rxEnsureComboListsLoaded(function (lists) {
        finishWrite(lists || []);
    });
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
    openModal('rxDrugListsModal');
    rxRenderSavedDrugListsModal({ loading: true });
    rxEnsureComboListsLoaded(function () {
        rxRenderSavedDrugListsModal();
    }, { force: true });
}

/** Show prescription draft toolbar without clearing rxLines. */
function rxEnsureRxDraftChromeOnly() {
    var addPanel = g('drugAddPanel');
    var addBtn   = g('btnAddPrescription');
    if (addPanel && addBtn && !rxPanelIsOpen()) {
        addPanel.style.display = 'block';
        addBtn.style.display   = 'none';
        if (!String((g('rxDate') && g('rxDate').value) || '').trim()) {
            sv('rxDate', todayISO());
        }
        rxLoadDrugCatalog();
        if (conPatientId) rxLoadPatientAllergy(conPatientId);
    }
    rxRefreshPanelChrome();
}

/** Drop blank cards before appending lines from a list / history. */
function rxDropBlankLines() {
    rxCommitActiveLine();
    rxLines = rxLines.filter(rxLineHasDrug);
    rxActiveLineIdx = -1;
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
    var activeRxDate = String((g('rxDate') && g('rxDate').value) || '').trim() || todayISO();
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
        var wasOpen = rxPanelIsOpen();
        rxEnsureRxDraftChromeOnly();
        if (wasOpen) rxDropBlankLines();
        else { rxLines = []; rxActiveLineIdx = -1; }
        snap.forEach(function(line) {
            rxLines.push(rxCloneSavedLine(line));
        });
        rxDraftDirty = true;
    } else {
        if (rxPanelIsOpen() && rxDraftDirty && rxLines.some(rxLineHasDrug) &&
            !confirm(conTr('con.rx.confirmDiscardDraft'))) {
            return false;
        }
        toggleDrugAddPanel(true, {
            keepRxLines: false,
            editingHistory: !!opts.editingHistory
        });
        rxLines = snap.map(rxCloneSavedLine);
        rxActiveLineIdx = -1;
        rxDraftDirty = false;
        if (opts.editingHistory) {
            rxSetEditingHistoryGroup(records);
        } else {
            rxClearEditingHistoryGroup();
        }
    }

    var first = records[0];
    if (first && !opts.append) {
        var nextDate = opts.editingHistory
            ? (String(first.prescribed_date || '').trim() || activeRxDate)
            : activeRxDate;
        sv('rxDate', nextDate);
    }

    function done() {
        renderRxLines();
        rxRefreshPanelChrome();
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
        rx_group_id: String(first.rx_group_id || '').trim(),
        prescribed_date: String(first.prescribed_date || '').trim(),
        doctor_tag: String(first.doctor_tag || first.dentist_name || '').trim(),
        dentist_name: String(first.dentist_name || '').trim()
    };
    rxRefreshPanelChrome();
    rxMarkEditingGroupInHistory();
}

function rxClearEditingHistoryGroup() {
    rxEditingHistoryGroup = null;
    rxRefreshPanelChrome();
    rxMarkEditingGroupInHistory();
}

function rxMarkEditingGroupInHistory() {
    var ids = (rxEditingHistoryGroup && rxEditingHistoryGroup.recordIds) || [];
    document.querySelectorAll('#drugHistoryWrap .rx-group-card').forEach(function(card) {
        var rowIds = String(card.getAttribute('data-record-ids') || '').split(',');
        var on = ids.length > 0 && rowIds.some(function(id) { return id && ids.indexOf(id) >= 0; });
        card.classList.toggle('rx-group-card--editing', on);
    });
}

function rxRefreshSavePrescriptionButtonLabel() {
    var btn = g('btnSaveRx');
    if (!btn) return;
    if (rxSaveInFlight) {
        btn.textContent = conTr('con.rx.saving');
        btn.disabled = true;
        return;
    }
    btn.disabled = false;
    var replacing = rxEditingHistoryGroup &&
        (rxEditingHistoryGroup.recordIds.length ||
            rxEditingHistoryGroup.prescribed_date);
    var key = replacing ? 'con.rx.savePrescriptionReplace' : 'con.rx.savePrescription';
    btn.textContent = conTr(key);
}

function rxSetSaving(on) {
    rxSaveInFlight = !!on;
    rxRefreshSavePrescriptionButtonLabel();
}

/** Resolves null on success, else the error. Only deletes the rows that were loaded for editing. */
function rxDeleteDrughistoryForReplace(ctx) {
    if (!ctx || !conPatientId) return Promise.resolve(null);
    var ids = ctx.recordIds || [];
    function errOf(r) { return (r && r.error) ? r.error : null; }
    if (ids.length) {
        return Promise.resolve(
            SB.from('drughistory').delete().in('id', ids).eq('patient_id', conPatientId)
        ).then(errOf, function(e) { return e || new Error('delete failed'); });
    }
    if (!ctx.prescribed_date) return Promise.resolve(null);
    var q = SB.from('drughistory')
        .delete()
        .eq('patient_id', conPatientId)
        .eq('prescribed_date', ctx.prescribed_date);
    if (ctx.doctor_tag) q = q.eq('doctor_tag', ctx.doctor_tag);
    return Promise.resolve(q).then(function(r) {
        if (r.error && ctx.doctor_tag) {
            return Promise.resolve(
                SB.from('drughistory')
                    .delete()
                    .eq('patient_id', conPatientId)
                    .eq('prescribed_date', ctx.prescribed_date)
                    .eq('dentist_name', ctx.doctor_tag)
            ).then(errOf);
        }
        return errOf(r);
    }, function(e) { return e || new Error('delete failed'); });
}

function rxApplySavedDrugList(listId, mode) {
    rxEnsureRxDraftChromeOnly();

    function applyFromLists(lists) {
        var lst = (lists || []).find(function (x) { return String(x.id) === String(listId); });
        if (!lst || !lst.lines || !lst.lines.length) {
            alert(conTr('con.rx.listNoDrugs'));
            return;
        }
        var copies = lst.lines.map(rxCloneSavedLine);
        var label  = String(lst.name || conTr('con.rx.untitled')).replace(/"/g, "'");

        var filled = rxLines.filter(rxLineHasDrug).length;
        if (mode === 'replace' && filled &&
            !confirm(conTrRepl('con.rx.confirmReplaceDraft', { N: filled, NAME: label }))) {
            return;
        }
        rxDropBlankLines();
        if (mode === 'replace') {
            rxLines = [];
            rxClearEditingHistoryGroup();
        }

        copies.forEach(function (line) {
            rxLines.push(line);
        });
        rxMarkDirty();
        renderRxLines();
        closeModal('rxDrugListsModal');
    }

    var cached = readRxComboListsStorage();
    if (cached.length) {
        applyFromLists(cached);
        return;
    }
    rxEnsureComboListsLoaded(function (lists) {
        applyFromLists(lists);
    });
}

function rxDeleteSavedDrugList(listId) {
    var id = String(listId || '');
    if (!id) return;

    function afterLocalRemove() {
        var lists = readRxComboListsStorage().filter(function (x) {
            return String(x.id) !== id;
        });
        writeRxComboListsStorage(lists);
        rxRenderSavedDrugListsModal();
    }

    if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function' ||
        !conLooksLikeUuid(id)) {
        afterLocalRemove();
        return;
    }

    SB.from(RX_COMBO_LISTS_TABLE).delete().eq('id', id)
    .then(function (r) {
        if (r.error && !rxComboListsTableMissing(r.error)) {
            alert(conTrRepl('con.rx.storageWriteFail', {
                MSG: r.error.message || String(r.error)
            }));
            return;
        }
        afterLocalRemove();
    })
    .catch(function (e) {
        alert(conTrRepl('con.rx.storageWriteFail', { MSG: (e && e.message) || e }));
    });
}

function rxRenderSavedDrugListsModal(opts) {
    opts = opts || {};
    var body    = g('rxSavedListsBody');
    var emptyEl = g('rxSavedListsEmpty');
    var q       = '';
    var si      = g('rxSavedListsSearch');
    if (si) q = String(si.value || '').trim().toLowerCase();
    if (!body) return;

    if (opts.loading || rxComboListsLoading) {
        if (emptyEl) emptyEl.style.display = 'none';
        body.innerHTML =
            '<p style="padding:14px;color:#64748b;text-align:center;">' +
            esc(conTr('con.rx.drugListLoading')) + '</p>';
        return;
    }

    var doc = rxResolveComboDoctor();
    var allSrc = readRxComboListsStorage();
    var lists  = allSrc.filter(function (lst) {
        if (!q) return true;
        return String(lst.name || '').toLowerCase().indexOf(q) !== -1;
    });
    lists.sort(function (a, b) {
        return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
    });

    if (!allSrc.length) {
        body.innerHTML = '';
        if (emptyEl) {
            emptyEl.style.display = 'block';
            if (doc.name) {
                emptyEl.setAttribute('data-doctor-hint', doc.name);
            }
        }
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
    if (doc.name) {
        var head = document.createElement('div');
        head.style.cssText =
            'padding:6px 10px 10px;font-size:11px;color:#64748b;';
        head.textContent = conTrRepl('con.rx.comboForDoctor', { NAME: doc.name });
        body.appendChild(head);
    }

    lists.forEach(function (lst) {
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
                '<button type="button" class="rx-slist-detail" ' +
                        'title="' + esc(conTr('con.rx.detailTitle')) + '" ' +
                        'style="padding:5px 10px;font-size:11px;border-radius:5px;' +
                        'border:1px solid #94a3b8;background:#f1f5f9;color:#334155;' +
                        'cursor:pointer;font-weight:600;">' + esc(conTr('con.rx.detail')) + '</button>' +
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

        row.querySelector('.rx-slist-detail').addEventListener('click', function () {
            rxOpenSavedDrugListDetail(lst.id);
        });
        row.querySelector('.rx-slist-append').addEventListener('click', function () {
            rxApplySavedDrugList(lst.id, 'append');
        });
        row.querySelector('.rx-slist-replace').addEventListener('click', function () {
            rxApplySavedDrugList(lst.id, 'replace');
        });
        row.querySelector('.rx-slist-delete').addEventListener('click', function () {
            var nm = String(lst.name || '').replace(/"/g, "'");
            if (!confirm(conTrRepl('con.rx.confirmRemoveList', { NAME: nm }))) return;
            rxDeleteSavedDrugList(lst.id);
        });

        body.appendChild(row);
    });
}

/** Cache of user_id -> display_name, so the detail modal doesn't re-query Supabase every time. */
var rxUserDisplayNameCache = {};

function rxResolveCreatedByName(userId, cb) {
    var uid = String(userId || '').trim();
    if (!uid) { cb(''); return; }
    if (Object.prototype.hasOwnProperty.call(rxUserDisplayNameCache, uid)) {
        cb(rxUserDisplayNameCache[uid]);
        return;
    }
    if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
        cb(uid);
        return;
    }
    SB.from('app_users').select('display_name').eq('user_id', uid).limit(1)
    .then(function (r) {
        var name = '';
        if (!r.error && r.data && r.data[0]) {
            name = String(r.data[0].display_name || '').trim();
        }
        var out = name || uid;
        rxUserDisplayNameCache[uid] = out;
        cb(out);
    })
    .catch(function () { cb(uid); });
}

/** Open the read-only "Detail" popup for one saved drug list. */
function rxOpenSavedDrugListDetail(listId) {
    var lists = readRxComboListsStorage();
    var lst = (lists || []).find(function (x) { return String(x.id) === String(listId); });
    if (!lst) return;
    rxRenderSavedDrugListDetailModal(lst);
    openModal('rxDrugListDetailModal');
}

function rxRenderSavedDrugListDetailModal(lst) {
    var titleEl = g('rxDrugListDetailTitle');
    var metaEl  = g('rxDrugListDetailMeta');
    var bodyEl  = g('rxDrugListDetailBody');
    if (!bodyEl) return;

    if (titleEl) titleEl.textContent = lst.name || conTr('con.rx.untitled');

    var addedOn = '';
    try {
        if (lst.created_at) {
            addedOn = new Date(lst.created_at).toLocaleString(conUiLocale(), {
                day:    '2-digit',
                month:  'short',
                year:   'numeric',
                hour:   '2-digit',
                minute: '2-digit'
            });
        }
    } catch (err) {}

    function renderMeta(addedByName) {
        if (!metaEl) return;
        var parts = [];
        if (addedOn) parts.push(conTrRepl('con.rx.addedOn', { WHEN: addedOn }));
        parts.push(conTrRepl('con.rx.addedBy', {
            NAME: addedByName || conTr('con.rx.unknownUser')
        }));
        metaEl.textContent = parts.join(' · ');
    }

    renderMeta('');
    if (lst.created_by) {
        rxResolveCreatedByName(lst.created_by, renderMeta);
    }

    if (!lst.lines || !lst.lines.length) {
        bodyEl.innerHTML =
            '<p style="padding:14px;color:#64748b;text-align:center;">' +
            esc(conTr('con.rx.historyNoLines')) + '</p>';
        return;
    }

    bodyEl.innerHTML = lst.lines.map(function (line, idx) {
        var meta = rxLineDisplayMeta(line);
        return (
            '<div style="border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;' +
                'margin-bottom:8px;background:#fafafa;">' +
                '<div style="font-weight:700;font-size:13px;color:#111827;margin-bottom:6px;">' +
                    esc(String(idx + 1) + '. ' + (line.drug_name || '—')) +
                '</div>' +
                '<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));' +
                    'gap:4px 14px;font-size:12px;color:#334155;">' +
                    '<div><span style="color:#94a3b8;">' + esc(conTr('con.rx.labelDosage')) +
                        ':</span> ' + esc(meta.dosage || '—') + '</div>' +
                    '<div><span style="color:#94a3b8;">' + esc(conTr('con.rx.labelFrequency')) +
                        ':</span> ' + esc(meta.frequency || '—') + '</div>' +
                    '<div><span style="color:#94a3b8;">' + esc(conTr('con.rx.labelDuration')) +
                        ':</span> ' + esc(meta.duration || '—') + '</div>' +
                    '<div><span style="color:#94a3b8;">' + esc(conTr('con.rx.labelQty')) +
                        ':</span> ' + esc(meta.quantity || '—') + '</div>' +
                '</div>' +
            '</div>'
        );
    }).join('');
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

    if (!document.body.dataset.rxMoreBound) {
        document.body.dataset.rxMoreBound = '1';
        document.addEventListener('click', function(ev) {
            document.querySelectorAll('details.rx-more[open]').forEach(function(d) {
                if (!d.contains(ev.target)) d.removeAttribute('open');
            });
        });
        document.addEventListener('keydown', function(ev) {
            if (ev.key !== 'Escape') return;
            document.querySelectorAll('details.rx-more[open]').forEach(function(d) {
                d.removeAttribute('open');
            });
        });
    }
}

// ════════════════════════════════════════════════════════════════
// SAVE FULL PRESCRIPTION → drughistory table
// ════════════════════════════════════════════════════════════════
function rxNewUuid() {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function rxStripLinkCols(row) {
    var o = Object.assign({}, row);
    delete o.rx_group_id;
    delete o.drug_id;
    return o;
}

/**
 * Insert with graceful fallbacks for older drughistory schemas. Resolves { error }.
 * tried — which fallbacks were already applied (each runs at most once).
 */
function rxInsertDrughistoryRows(payload, tried) {
    tried = tried || {};
    if (rxHistoryLinkColsMissing) payload = payload.map(rxStripLinkCols);
    return Promise.resolve(SB.from('drughistory').insert(payload)).then(function(r) {
        if (!r.error) return { error: null };
        var msg = String(r.error.message || '').toLowerCase();
        if (!tried.link && !rxHistoryLinkColsMissing &&
            (msg.indexOf('rx_group_id') >= 0 || msg.indexOf('drug_id') >= 0)) {
            tried.link = true;
            rxHistoryLinkColsMissing = true;
            return rxInsertDrughistoryRows(payload, tried);
        }
        if (!tried.zh && msg.indexOf('_zh') >= 0) {
            tried.zh = true;
            return rxInsertDrughistoryRows(payload.map(rxStripZhColumns), tried);
        }
        if (!tried.intake && msg.indexOf('intake') >= 0) {
            tried.intake = true;
            return rxInsertDrughistoryRows(payload.map(function(x) {
                var o = Object.assign({}, x);
                if (o.intake_remarks && typeof drugPackRemarksForLegacyColumn === 'function') {
                    o.remarks = drugPackRemarksForLegacyColumn(o.intake_remarks, o.remarks);
                }
                delete o.intake_remarks;
                return o;
            }), tried);
        }
        if (!tried.doctor && (msg.indexOf('doctor_tag') >= 0 || msg.indexOf('doctor_id') >= 0 ||
            msg.indexOf('doctor_name') >= 0)) {
            tried.doctor = true;
            return rxInsertDrughistoryRows(payload.map(function(x) {
                var rem = x.remarks;
                if (x.intake_remarks && typeof drugPackRemarksForLegacyColumn === 'function') {
                    rem = drugPackRemarksForLegacyColumn(x.intake_remarks, rem);
                }
                var o = {
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
                if (x.rx_group_id) o.rx_group_id = x.rx_group_id;
                if (x.drug_id) o.drug_id = x.drug_id;
                return o;
            }), tried);
        }
        return { error: r.error };
    }, function(e) {
        return { error: e || new Error('insert failed') };
    });
}

function saveFullPrescription() {
    if (rxSaveInFlight) return;
    if (!conPatientId || !conPatientData) { alert(conTr('con.forms.alertSelectPatient')); return; }
    if (!conActiveDoctorId) {
        alert(conTr('con.rx.needDoctor'));
        rxFocusDoctorPicker();
        return;
    }

    rxCommitActiveLine();
    var before = rxLines.length;
    rxLines = rxLines.filter(rxLineHasDrug);
    if (rxLines.length !== before) rxActiveLineIdx = -1;
    if (!rxLines.length) {
        rxLines.push(rxEmptyLine());
        rxActiveLineIdx = 0;
        renderRxLines();
        rxFocusLine(0);
        alert(conTr('con.rx.addOneDrugLine'));
        return;
    }
    for (var i = 0; i < rxLines.length; i++) {
        if (!rxLineHasDays(rxLines[i])) {
            rxActiveLineIdx = i;
            renderRxLines();
            rxFocusLine(i);
            alert(conTrRepl('con.rx.rowSelectDaysRx', { N: i + 1 }));
            return;
        }
    }
    if (rxLines.length !== before) renderRxLines();

    var draftLines = rxAllDraftLinesForSave();
    var replaceCtx = rxEditingHistoryGroup;
    var isReplace  = !!(replaceCtx &&
        (replaceCtx.recordIds.length || replaceCtx.prescribed_date));
    var patientId   = conPatientId;
    var patientName = conPatientData.full_name;

    rxSetSaving(true);
    rxLoadPatientAllergy(patientId, { force: true })
        .then(function() {
            rxSetSaving(false);
            return rxConfirmSafetyChecks(draftLines);
        })
        .then(function(ok) {
            if (!ok) return;
            if (String(conPatientId) !== String(patientId)) return;
            if (isReplace && !confirm(conTrRepl('con.rx.confirmReplaceSaved', {
                DATE: rxFmtDate(replaceCtx.prescribed_date) || '—',
                OLD: replaceCtx.recordIds.length || '?',
                NEW: draftLines.length
            }))) {
                return;
            }
            rxSetSaving(true);
            return rxWritePrescription(draftLines, replaceCtx, isReplace, patientId, patientName);
        })
        .catch(function(e) {
            rxSetSaving(false);
            alert(trRepl('appt.msg.error', { MSG: (e && e.message) || e }));
        });
}

/**
 * Replace = insert the new rows first, then delete the old ones, so a failed insert never
 * loses the saved prescription. (Legacy groups without record ids fall back to delete → insert.)
 */
function rxWritePrescription(draftLines, replaceCtx, isReplace, patientId, patientName) {
    var date    = (g('rxDate') && g('rxDate').value) || todayISO();
    var dentist = String(conActiveDoctorName || '').trim();
    var groupId = (isReplace && replaceCtx.rx_group_id) || rxNewUuid();
    var rows = draftLines.map(function(l) {
        return rxDrughistoryRowForSave(l, date, dentist, groupId);
    });
    var legacyReplace = isReplace && !(replaceCtx.recordIds && replaceCtx.recordIds.length);

    function fail(err) {
        rxSetSaving(false);
        alert(trRepl('appt.msg.error', { MSG: (err && err.message) || err }));
    }

    function afterSave(warnMsg) {
        rxSetSaving(false);
        rxDraftDirty = false;
        toggleDrugAddPanel(false);
        loadDrugHistory(patientId);
        if (typeof conSchedulePatientTimelineRefresh === 'function') {
            conSchedulePatientTimelineRefresh(patientId);
        }
        var msg = conTrRepl(isReplace ? 'con.rx.prescriptionReplaced' : 'con.rx.prescriptionSaved', {
            N: rows.length,
            NAME: patientName
        });
        if (warnMsg) {
            alert(msg + '\n\n' + warnMsg);
        } else if (typeof showAppGlobalToast === 'function') {
            showAppGlobalToast(msg);
        } else {
            alert(msg);
        }
    }

    if (legacyReplace) {
        return rxDeleteDrughistoryForReplace(replaceCtx).then(function(delErr) {
            if (delErr) return fail(delErr);
            return rxInsertDrughistoryRows(rows).then(function(res) {
                if (res.error) return fail(res.error);
                afterSave();
            });
        });
    }

    return rxInsertDrughistoryRows(rows).then(function(res) {
        if (res.error) return fail(res.error);
        if (!isReplace) {
            afterSave();
            return;
        }
        return rxDeleteDrughistoryForReplace(replaceCtx).then(function(delErr) {
            afterSave(delErr
                ? conTrRepl('con.rx.replaceOldDeleteFailed', {
                    MSG: (delErr && delErr.message) || delErr
                })
                : '');
        });
    });
}

// ════════════════════════════════════════════════════════════════
// DRUG HISTORY — grouped by date + print buttons
// ════════════════════════════════════════════════════════════════
function refreshDrugPrescriptionPanel() {
    if (!conPatientId) {
        alert(conTr('con.forms.alertSelectPatient'));
        return;
    }
    var btn = g('rxHistoryRefreshBtn');
    if (btn) btn.disabled = true;
    var done = function() {
        if (btn) btn.disabled = false;
    };
    if (typeof loadDrugHistory === 'function') {
        loadDrugHistory(conPatientId).then(done).catch(done);
    } else {
        done();
    }
    if (typeof loadConPatientTimeline === 'function') {
        loadConPatientTimeline(conPatientId);
    }
}

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
    if (patientId && conPatientId && String(conPatientId) !== String(patientId)) return;

    if (error || !data || !data.length) {
        wrap.innerHTML =
            '<p style="color:#aaa;padding:12px;">' +
            esc(conTr('con.rx.noRxHistoryShort')) + '</p>';
        return;
    }

    // Newest first; created_at (when present) orders prescriptions saved on the same day.
    data = data.slice().sort(function(a, b) {
        var d = String(b.prescribed_date || '').localeCompare(String(a.prescribed_date || ''));
        if (d) return d;
        return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

    // One group per saved prescription (rx_group_id); legacy rows group by date + doctor.
    var groups = {};
    var order  = [];
    data.forEach(function(r) {
        var gid = String(r.rx_group_id || '').trim();
        var key = gid
            ? 'g:' + gid
            : 'd:' + (r.prescribed_date || 'unknown') + '||' + (r.doctor_tag || r.dentist_name || '');
        if (!groups[key]) {
            groups[key] = {
                rows: [],
                date: r.prescribed_date || '',
                doctor: String(r.doctor_tag || r.dentist_name || '').trim(),
                doctorLabel: String(r.dentist_name || r.doctor_tag || '').trim()
                    .replace(/^dr\.?\s+/i, ''),
                groupId: gid
            };
            order.push(key);
        }
        groups[key].rows.push(r);
    });
    var perDate = {};
    order.forEach(function(key) {
        var d = groups[key].date;
        perDate[d] = (perDate[d] || 0) + 1;
    });

    wrap.innerHTML = '';

    order.forEach(function(key) {
        var grp        = groups[key];
        var rows       = grp.rows;
        var dateStr    = grp.date;
        var doctorTag  = grp.doctor;
        var displayDate = rxFmtDate(dateStr) || '—';
        var timeLabel = '';
        if (perDate[dateStr] > 1 && rows[0] && rows[0].created_at) {
            try {
                var ct = new Date(rows[0].created_at);
                if (!isNaN(ct)) {
                    timeLabel = ct.toLocaleTimeString(conUiLocale(), { hour: '2-digit', minute: '2-digit' });
                }
            } catch (eT) {}
        }

        var groupDiv = document.createElement('div');
        groupDiv.className = 'rx-group-card';
        groupDiv.setAttribute('data-record-ids', rows.map(function(r) {
            return String(r.id || '');
        }).join(','));

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
            var rowId = String(r.id || '').trim();
            var rowName = String(r.drug_name || '').trim();
            return '<div class="rx-history-row"' +
                ' data-id="'              + esc(rowId) + '"' +
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
                            [
                                String(r.frequency || '').trim(),
                                String(r.duration || '').trim(),
                                qtyDisp ? conTr('con.rx.historyQty') + ' ' + qtyDisp : ''
                            ].filter(Boolean).map(esc).join(' · ') +
                        '</span>' +
                        (r.remarks
                            ? '<span class="rx-row-remarks">' +
                              esc(r.remarks) + '</span>'
                            : '') +
                    '</div>' +
                    '<div class="rx-row-side">' +
                    '<div class="rx-row-print-btns">' +
                        '<button type="button" class="rx-icon-btn" ' +
                        'onclick="printHistoryRowLabel(this,\'en\')" ' +
                        'title="' + esc(conTr('con.rx.printLabelEn')) + '">EN</button>' +
                        '<button type="button" class="rx-icon-btn" ' +
                        'onclick="printHistoryRowLabel(this,\'zh\')" ' +
                        'title="' + esc(conTr('con.rx.printLabelZh')) + '">中</button>' +
                    '</div>' +
                    '<button type="button" class="btn-rx-hist-delete rx-icon-btn rx-icon-btn--danger" ' +
                    'data-rx-hist-id="' + esc(rowId) + '" ' +
                    'title="' + esc(conTr('con.rx.deleteRowTitle')) + '" ' +
                    'aria-label="' + esc(conTrRepl('con.rx.deleteRowAria', {
                        NAME: rowName || '—'
                    })) + '">×</button>' +
                    '</div>' +
                '</div>';
        }).join('');

        var metaLine = [
            grp.doctorLabel ? conTr('con.rx.historyDrPrefix') + grp.doctorLabel : '',
            conTrRepl('con.rx.drugCount', { N: rows.length })
        ].filter(Boolean).join(' · ');

        groupDiv.innerHTML =
            '<div class="rx-group-header">' +
                '<div class="rx-group-meta">' +
                    '<span class="rx-group-date">' + esc(displayDate) +
                        (timeLabel ? '<span class="rx-group-time"> · ' + esc(timeLabel) + '</span>' : '') +
                    '</span>' +
                    '<span class="rx-group-dr">' + esc(metaLine) + '</span>' +
                '</div>' +
                '<div class="rx-group-actions">' +
                    '<button type="button" class="rx-group-edit" data-act="edit" ' +
                    'title="' + esc(conTr('con.rx.editHistClickTitle')) + '">' +
                    esc(conTr('con.rx.edit')) + '</button>' +
                    '<details class="rx-more">' +
                        '<summary class="rx-more-btn" title="' + esc(conTr('con.rx.moreActions')) + '" ' +
                        'aria-label="' + esc(conTr('con.rx.moreActions')) + '">⋯</summary>' +
                        '<div class="rx-more-menu">' +
                            '<button type="button" data-act="print-en">' + esc(conTr('con.rx.printAllEn')) + '</button>' +
                            '<button type="button" data-act="print-zh">' + esc(conTr('con.rx.printAllZh')) + '</button>' +
                            '<button type="button" data-act="reapply" title="' +
                                esc(conTr('con.rx.reApplyTitle')) + '">' + esc(conTr('con.rx.reApply')) + '</button>' +
                            '<button type="button" data-act="save-list" title="' +
                                esc(conTr('con.rx.saveAsListHistTitle')) + '">' +
                                esc(conTr('con.rx.saveAsListBtn')) + '</button>' +
                            '<button type="button" data-act="delete" class="is-danger">' +
                                esc(conTr('con.rx.deleteAll')) + '</button>' +
                        '</div>' +
                    '</details>' +
                '</div>' +
            '</div>' +
            '<div class="rx-group-body">' + rowsHtml + '</div>';

        wrap.appendChild(groupDiv);
        groupDiv.querySelectorAll('.rx-group-actions [data-act]').forEach(function(btn) {
            btn.addEventListener('click', function(ev) {
                ev.stopPropagation();
                var act = btn.getAttribute('data-act');
                var more = btn.closest('details');
                if (more) more.removeAttribute('open');
                if (act === 'edit') rxEditHistoryGroupRecords(rows);
                else if (act === 'print-en') printHistoryGroupLabels(btn, 'en');
                else if (act === 'print-zh') printHistoryGroupLabels(btn, 'zh');
                else if (act === 'reapply') rxReapplyHistoryGroupRecords(rows);
                else if (act === 'save-list') rxSaveComboListFromHistoryRecords(rows);
                else if (act === 'delete') rxDeleteHistoryGroup(rows, dateStr, doctorTag);
            });
        });

        groupDiv.querySelectorAll('.btn-rx-hist-delete').forEach(function(delBtn) {
            delBtn.addEventListener('click', function(ev) {
                ev.preventDefault();
                ev.stopPropagation();
                var id = delBtn.getAttribute('data-rx-hist-id') || '';
                var rec = null;
                for (var i = 0; i < rows.length; i++) {
                    if (String(rows[i].id || '') === String(id)) {
                        rec = rows[i];
                        break;
                    }
                }
                deleteRxHistoryRow(id, rec && rec.drug_name, delBtn);
            });
        });

        groupDiv.querySelectorAll('.rx-history-row').forEach(function(rowEl) {
            rowEl.classList.add('rx-history-row--clickable');
            rowEl.setAttribute('title', conTr('con.rx.editHistClickTitle'));
            rowEl.addEventListener('click', function(ev) {
                if (ev.target.closest('.rx-row-side, .rx-row-print-btns, .btn-rx-hist-delete, button')) return;
                rxEditHistoryGroupRecords(rows);
            });
        });
    });
    rxMarkEditingGroupInHistory();
}

/** Delete-all for one prescription: by record ids when available, else legacy date + doctor. */
function rxDeleteHistoryGroup(rows, dateStr, doctorTag) {
    if (!conPatientId) return;
    var ids = (rows || []).map(function(r) { return String(r.id || '').trim(); }).filter(Boolean);
    if (!ids.length || ids.length !== (rows || []).length) {
        deleteRxGroup(null, dateStr, doctorTag);
        return;
    }
    if (!confirm(conTrRepl('con.rx.confirmDeleteRx', {
        DATE: rxFmtDate(dateStr) || '—',
        N: ids.length
    }))) return;
    SB.from('drughistory').delete().in('id', ids).eq('patient_id', conPatientId)
    .then(function(r) {
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
        var ctx = rxEditingHistoryGroup;
        if (ctx && ctx.recordIds && ctx.recordIds.some(function(id) { return ids.indexOf(id) >= 0; })) {
            rxClearEditingHistoryGroup();
        }
        loadDrugHistory(conPatientId);
        if (typeof conSchedulePatientTimelineRefresh === 'function') {
            conSchedulePatientTimelineRefresh(conPatientId);
        }
    })
    .catch(function(e) {
        alert(trRepl('appt.msg.error', { MSG: (e && e.message) || e }));
    });
}

// ════════════════════════════════════════════════════════════════
// DELETE RX GROUP / SINGLE HISTORY ROW
// ════════════════════════════════════════════════════════════════
function deleteRxHistoryRow(rowId, drugName, btn) {
    rowId = String(rowId || '').trim();
    if (!rowId) {
        alert(conTr('con.rx.deleteRowMissingId'));
        return;
    }
    if (!conPatientId) {
        alert(conTr('con.forms.alertSelectPatient'));
        return;
    }
    var name = String(drugName || '').trim() || '—';
    if (!confirm(conTrRepl('con.rx.confirmDeleteRow', { NAME: name }))) return;
    if (btn) btn.disabled = true;

    SB.from('drughistory')
        .delete()
        .eq('id', rowId)
        .eq('patient_id', conPatientId)
    .then(function(r) {
        if (r.error) {
            if (btn) btn.disabled = false;
            alert(trRepl('appt.msg.error', { MSG: r.error.message }));
            return;
        }
        if (rxEditingHistoryGroup && rxEditingHistoryGroup.recordIds) {
            rxEditingHistoryGroup.recordIds = rxEditingHistoryGroup.recordIds.filter(function(id) {
                return String(id) !== rowId;
            });
            if (!rxEditingHistoryGroup.recordIds.length) {
                rxClearEditingHistoryGroup();
            } else {
                rxRefreshSavePrescriptionButtonLabel();
            }
        }
        loadDrugHistory(conPatientId);
        if (typeof conSchedulePatientTimelineRefresh === 'function') {
            conSchedulePatientTimelineRefresh(conPatientId);
        }
    })
    .catch(function(e) {
        if (btn) btn.disabled = false;
        alert(trRepl('appt.msg.error', { MSG: (e && e.message) || e }));
    });
}

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

/** Resolved from active clinic context for label header; falls back to session label.
 *  Language follows the label print choice (EN/ZH buttons), not the UI locale —
 *  otherwise English labels still show chinese_name when the app is in Chinese. */
function currentActiveClinicLabelForPrinting(isZh) {
    var rec = conResolveActiveClinicRecordForLabels();
    var en = rec ? String(rec.english_name || '').trim() : '';
    var cn = rec ? String(rec.chinese_name || '').trim() : '';

    if (isZh) {
        if (cn) return cn;
        if (en) return en;
    } else {
        if (en) return en;
        if (cn) return cn;
    }

    // Prefer bilingual fields above; session label is UI-locale and only a last resort.
    if (typeof currentClinicLabel === 'string' && currentClinicLabel.trim()) {
        return currentClinicLabel.trim();
    }
    if (rec && typeof clinicDisplayName === 'function') {
        return clinicDisplayName(rec) || '—';
    }
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

/** Self-printing HTML document for a sheet of drug labels (one label per page). */
function rxLabelDocHtml(drugs, lang) {
    var isZh = (lang === 'zh');
    var clinicNameRaw = currentActiveClinicLabelForPrinting(isZh);
    var clinicName =
        typeof esc === 'function' ? esc(clinicNameRaw) : String(clinicNameRaw || '');
    var clinicContactHtml = buildClinicContactHtmlForDrugLabel(isZh);
    var dims = drugLabelPrintDimensions();

    var fontFamily = isZh
        ? "'Joyful CJK Rare','Joyful CJK Sans',sans-serif"
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

    return (
        '<!DOCTYPE html>' +
        '<html lang="' + (isZh ? 'zh-HK' : 'en') + '">' +
        '<head>' +
            '<meta charset="UTF-8">' +
            (typeof appCjkFontLinkHtml === 'function' ? appCjkFontLinkHtml() : '') +
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
}

function printDrugLabel(drugs, lang) {
    drugs = (drugs || []).filter(function(d) { return d && d.drug_name; });
    if (!drugs.length) return;
    if (typeof confirmPrintReminder === 'function' && !confirmPrintReminder()) return;
    var html = rxLabelDocHtml(drugs, lang);

    // Wider popup: Chrome/Edge print UI can show options (LHS) + preview (RHS) when space allows.
    var popup = null;
    try {
        popup = window.open(
            '', '_blank',
            'width=1024,height=760,left=60,top=32,toolbar=0,menubar=0,scrollbars=1,resizable=1'
        );
    } catch (eOpen) {
        popup = null;
    }
    if (popup && popup.document) {
        popup.document.write(html);
        popup.document.close();
        if (typeof wirePrintPopupAutoClose === 'function') wirePrintPopupAutoClose(popup);
        try { popup.focus(); } catch (ePrintFocus) {}
        return;
    }
    if (!rxPrintLabelsInFrame(html)) alert(conTr('con.rx.alertPopupBlocked'));
}

/** Popup blocked: print the same label document from a hidden iframe instead. */
function rxPrintLabelsInFrame(html) {
    var frame = g('rxLabelPrintFrame');
    if (!frame) {
        frame = document.createElement('iframe');
        frame.id = 'rxLabelPrintFrame';
        frame.title = 'Drug label print';
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText =
            'position:fixed;left:-10000px;top:0;width:480px;height:640px;border:0;' +
            'visibility:hidden;pointer-events:none;';
        document.body.appendChild(frame);
    }
    var doc = frame.contentDocument || (frame.contentWindow && frame.contentWindow.document);
    if (!doc) return false;
    doc.open();
    doc.write(html);
    doc.close();
    return true;
}

// ── Print labels for every drug in the open draft (before save) ─
function rxPrintDraftLabels(lang) {
    var more = g('rxDraftMore');
    if (more) more.removeAttribute('open');
    if (!conPatientId || !conPatientData) {
        alert(conTr('con.rx.alertLabelNeedPatient'));
        return;
    }
    var lines = rxAllDraftLinesForSave();
    if (!lines.length) {
        alert(conTr('con.rx.alertLabelNeedDrug'));
        return;
    }
    var meta = {
        dentist_name:    conActiveDoctorName || currentName || '—',
        doctor_tag:      conActiveDoctorTag || conActiveDoctorName || currentName || '',
        prescribed_date: (g('rxDate') && g('rxDate').value) || todayISO(),
        patient_no:      conPatientData.patient_no ? String(conPatientData.patient_no) : '',
        patient_name:    conPatientData.full_name ? String(conPatientData.full_name) : '',
        patient_chinese_name: conPatientData.chinese_name ? String(conPatientData.chinese_name) : ''
    };
    printDrugLabel(lines.map(function(l) {
        return rxLineToPrintDrug(l, lang, meta);
    }), lang);
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
            rxInvalidateDrugCatalog();
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
        rxInvalidateDrugCatalog();
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
        autoSelectSingle: false,
        activeSource: 'consultation-med-search',
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
    setConBannerAlert('conMedBannerAlert', p);
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
        syncConMedicalFieldsToPatientData(d);
        sv('fldMedHistory',  d.medical_history     || '');
        sv('fldMedications', d.current_medications || '');
        sv('fldAllergy',     d.allergy             || '');
        refreshConPatientAlertBanners();
        if (form) form.style.display = 'block';
        if (typeof applyMedicalNotesProgramLocks === 'function') applyMedicalNotesProgramLocks();
    });
}

function syncConMedicalFieldsToPatientData(fields) {
    fields = fields || {};
    [conPatientData, conMedPatientData, conDenPatientData, conFormsPatientData].forEach(function(p) {
        if (!p || !p.id || String(p.id) !== String(conMedPatientId || conPatientId || p.id)) return;
        if (typeof fields.medical_history !== 'undefined') p.medical_history = fields.medical_history || '';
        if (typeof fields.current_medications !== 'undefined') p.current_medications = fields.current_medications || '';
        if (typeof fields.allergy !== 'undefined') p.allergy = fields.allergy || '';
        if (typeof fields.medical_alerts !== 'undefined') p.medical_alerts = fields.medical_alerts || '';
    });
    if (typeof setDirectoryActivePatient === 'function' && conPatientData && conPatientData.id) {
        setDirectoryActivePatient(conPatientData, 'consultation-medical-history-save');
    }
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
        syncConMedicalFieldsToPatientData(payload);
        refreshConPatientAlertBanners(conMedPatientData || conPatientData);
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
    refreshConPatientAlertBanners();
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
        autoSelectSingle: false,
        activeSource: 'consultation-den-search',
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
    setConBannerAlert('conDenBannerAlert', p);
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
    if (typeof rxRefreshPanelChrome === 'function') rxRefreshPanelChrome();
    if (conPatientId && typeof loadDrugHistory === 'function') {
        loadDrugHistory(conPatientId);
    }
    if (conPatientId && typeof loadConNotes === 'function') {
        loadConNotes(conPatientId, { keepPaint: true });
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

