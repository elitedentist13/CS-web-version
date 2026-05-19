// ════════════════════════════════════════════════════════════════
// APP-CONSULTATION.JS
// Tables: druglist, drughistory, treatments, patients
// ════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
var conPatientId   = null;
var conPatientData = null;
var conPsTimer     = null;
var drugEditId     = null;
var rxLines        = [];
var rxComboSearchTimer = null;

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

// Forms / Letters state
var conFormsPatientId = null;
var conFormsPatientData = null;
var conFormsTemplates = [];
var conFormsSelectedTemplate = null;
var conFormsDoctorData = null;
var conFormsSavedRange = null;
var conFormsSelectedDocIds = [];
var conFormsDocsCache = {};

var RX_COMBO_LISTS_KEY = 'rx_saved_combo_lists_v1';

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

    var layout = g('conMainLayout');
    if (layout) layout.style.display = 'none';

    conPatientId   = null;
    conPatientData = null;
    rxLines        = [];

    setConBillBtn(false);
    loadConsultationDoctors();
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
    if (sel) sel.innerHTML = '<option value="">Loading doctors...</option>';

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
            sel.innerHTML = '<option value="">(No doctors)</option>';
            return;
        }
        sel.innerHTML =
            '<option value="">-- Select Doctor --</option>' +
            docs.map(function (d) {
                var shown = d.display_name || d.english_name || d.chinese_name || 'Doctor';
                var label = (d.doctor_code ? ('[' + d.doctor_code + '] ') : '') + shown;
                return '<option value="' + esc(d.id) + '">' + esc(label) + '</option>';
            }).join('');

        // default selection: currentDoctorId if set, else match currentName
        var defaultId = (typeof currentDoctorId !== 'undefined' && currentDoctorId) ? currentDoctorId : '';
        if (!defaultId && typeof currentName !== 'undefined' && currentName) {
            var m = docs.find(function (d) { return d.english_name === currentName; });
            defaultId = m ? m.id : '';
        }
        if (defaultId) {
            sel.value = defaultId;
            conSetActiveDoctor(defaultId);
        } else {
            conSetActiveDoctor('');
        }
    };

    if (globalDocs && globalDocs.length) {
        useDocs(globalDocs);
        return;
    }

    SB.from('doctors').select('id,doctor_code,english_name,chinese_name,display_name,is_active,clinic_id').order('doctor_code')
    .then(function (r) {
        useDocs(r.data || []);
    });
}

function conSetActiveDoctor(doctorId) {
    conActiveDoctorId = doctorId || null;
    conActiveDoctorName = null;
    conActiveDoctorTag = null;

    var picked = conActiveDoctorId ? (conDoctorsById[conActiveDoctorId] || null) : null;
    if (picked) {
        var shown = picked.display_name || picked.english_name || picked.chinese_name || '';
        conActiveDoctorName = shown || null;
        conActiveDoctorTag = picked.doctor_code
            ? ('[' + picked.doctor_code + '] ' + shown)
            : shown;
    }

    var sel = g('conDoctorSelect');
    if (sel && doctorId && !conActiveDoctorName) {
        var opt = sel.options[sel.selectedIndex];
        conActiveDoctorName = opt ? opt.textContent.replace(/^\[[^\]]+\]\s*/, '') : null;
        conActiveDoctorTag = opt ? opt.textContent : null;
    }

    // Also update globally-used "currentName" so existing modules pick it up
    currentDoctorId = conActiveDoctorId;
    if (conActiveDoctorName) {
        currentDoctorName = conActiveDoctorName;
    }
    if (conActiveDoctorName) {
        currentName = conActiveDoctorName;
    }

    updateConsultationDoctorUI();
}

function updateConsultationDoctorUI() {
    var shown = conActiveDoctorTag || conActiveDoctorName || currentName || '—';
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
function openConForPatient(patientId) {
    showOnly('consultationSection');
    switchConTab('treatment');

    sv('conPsInput', '');

    var dd = g('conPsDrop');
    if (dd) dd.style.display = 'none';

    sv('conPsInputChart', '');
    if (g('conPsDropChart')) g('conPsDropChart').style.display = 'none';

    var banner = g('conPatientBanner');
    if (banner) banner.style.display = 'none';

    var layout = g('conMainLayout');
    if (layout) layout.style.display = 'none';

    conPatientId   = null;
    conPatientData = null;
    rxLines        = [];

    SB.from('patients')
        .select(
            'id,patient_no,full_name,chinese_name,sex,dob,' +
            'phone_number,medical_alerts,' + PATIENT_CLINIC_TAG_FIELD
        )
        .eq('id', patientId)
        .single()
    .then(function(r) {
        if (r.error || !r.data) {
            alert('Could not load patient data.');
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
    var q  = (g('conPsInput').value || '').trim();
    var dd = g('conPsDrop');
    if (!q) { dd.style.display = 'none'; return; }

    var pq = SB.from('patients')
        .select(
            'id,patient_no,full_name,chinese_name,sex,dob,' +
            'phone_number,medical_alerts,' + PATIENT_CLINIC_TAG_FIELD
        )
        .or(
            'full_name.ilike.%'    + q + '%,' +
            'patient_no.ilike.%'   + q + '%,' +
            'phone_number.ilike.%' + q + '%'
        )
        .limit(8);
    pq = typeof applyPatientQueryClinicTag === 'function'
        ? applyPatientQueryClinicTag(pq, 'conPsClinicFilter')
        : pq;
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
                '<strong>' + esc(p.full_name) + '</strong>' +
                '<br><small style="color:#aaa;">' +
                '#' + esc(p.patient_no || '-') +
                ' &nbsp;|&nbsp; ' +
                esc(p.phone_number || 'No phone') +
                '</small>';
            item.addEventListener('click', function() {
                dd.style.display = 'none';
                g('conPsInput').value =
                    p.full_name +
                    ' (#' + (p.patient_no || '') + ')';
                selectConPatient(p);
            });
            dd.appendChild(item);
        });
        dd.style.display = 'block';
    });
}

// ── Charting tab: same search as treatment, ties into selectConPatient ──
function doConPatientSearchChart() {
    var q  = (g('conPsInputChart') && g('conPsInputChart').value || '').trim();
    var dd = g('conPsDropChart');
    if (!dd) return;
    if (!q) {
        dd.style.display = 'none';
        return;
    }

    var pq = SB.from('patients')
        .select(
            'id,patient_no,full_name,chinese_name,sex,dob,' +
            'phone_number,medical_alerts,' + PATIENT_CLINIC_TAG_FIELD
        )
        .or(
            'full_name.ilike.%'    + q + '%,' +
            'patient_no.ilike.%'   + q + '%,' +
            'phone_number.ilike.%' + q + '%'
        )
        .limit(8);
    pq = typeof applyPatientQueryClinicTag === 'function'
        ? applyPatientQueryClinicTag(pq, 'conPsClinicFilterChart')
        : pq;
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
                '<strong>' + esc(p.full_name) + '</strong>' +
                '<br><small style="color:#aaa;">' +
                '#' + esc(p.patient_no || '-') +
                ' &nbsp;|&nbsp; ' +
                esc(p.phone_number || 'No phone') +
                '</small>';
            item.addEventListener('click', function() {
                dd.style.display = 'none';
                if (g('conPsInputChart')) {
                    g('conPsInputChart').value =
                        p.full_name +
                        ' (#' + (p.patient_no || '') + ')';
                }
                selectConPatient(p);
            });
            dd.appendChild(item);
        });
        dd.style.display = 'block';
    });
}

// ════════════════════════════════════════════════════════════════
// SELECT PATIENT — populate ALL tabs
// ════════════════════════════════════════════════════════════════
function selectConPatient(p) {
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
            sexWrap.innerHTML = 'Sex:&nbsp;';
        } else {
            sexWrap.style.display = '';
            sexWrap.innerHTML = 'Sex:&nbsp;' + sexHtml;
        }
    }

    var dobEl = g('conBannerDob');
    if (dobEl) dobEl.textContent = p.dob ? formatDobAge(p.dob) : '-';

    var phoneEl = g('conBannerPhone');
    if (phoneEl) phoneEl.textContent = p.phone_number || '-';

    var todayEl = g('conBannerToday');
    if (todayEl) todayEl.textContent = todayStr;

    // active doctor display on banner
    if (g('conBannerDoctor')) {
        g('conBannerDoctor').textContent = conActiveDoctorName || currentName || '—';
    }

    var alertEl = g('conBannerAlert');
    if (alertEl) {
        alertEl.textContent = p.medical_alerts || 'None';
        alertEl.style.color = p.medical_alerts
            ? 'var(--danger)' : '#999';
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
        g('conMedBannerAlert').textContent = p.medical_alerts || 'None';
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
        g('conDenBannerAlert').textContent = p.medical_alerts || 'None';
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
    // show card only if patient selected
    var card = g('conFormsTplCard');
    if (card) card.style.display = conFormsPatientId ? 'block' : 'none';

    updateConFormsPatientLabel();

    // load templates once per session
    if (!conFormsTemplates || !conFormsTemplates.length) {
        loadConFormsTemplates();
    }

    // try load doctor data (best-effort)
    loadConFormsDoctor();

    // preserve selection for toolbar interactions (once)
    var editor = g('conFormsDocEditor');
    if (editor && !editor.dataset.selWired) {
        editor.dataset.selWired = '1';
        ['mouseup', 'keyup', 'touchend'].forEach(function (ev) {
            editor.addEventListener(ev, conFormsSaveSelection);
        });
        editor.addEventListener('focus', conFormsSaveSelection);
    }
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
    lbl.textContent =
        (conFormsPatientData.full_name || '-') +
        '  (#' + (conFormsPatientData.patient_no || '-') + ')';
}

function doConFormsPatientSearch() {
    var q  = (g('conFormsPsInput').value || '').trim();
    var dd = g('conFormsPsDrop');
    if (!q) { if (dd) dd.style.display = 'none'; return; }

    var fq = SB.from('patients')
        .select(
            'id,patient_no,full_name,chinese_name,sex,dob,phone_number,' +
            'medical_alerts,hkid,email,address,' + PATIENT_CLINIC_TAG_FIELD
        )
        .or(
            'full_name.ilike.%'    + q + '%,' +
            'patient_no.ilike.%'   + q + '%,' +
            'phone_number.ilike.%' + q + '%'
        )
        .limit(8);
    fq = typeof applyPatientQueryClinicTag === 'function'
        ? applyPatientQueryClinicTag(fq, 'conFormsPsClinicFilter')
        : fq;
    fq.then(function(r) {
        if (!dd) return;
        dd.innerHTML = '';
        if (r.error || !r.data || !r.data.length) {
            dd.innerHTML =
                '<div class="ps-item" style="color:#aaa;">No patients found</div>';
            dd.style.display = 'block';
            return;
        }
        r.data.forEach(function(p) {
            var item = document.createElement('div');
            item.className = 'ps-item';
            item.innerHTML =
                '<strong>' + esc(p.full_name) + '</strong>' +
                '<br><small style="color:#aaa;">' +
                '#' + esc(p.patient_no || '-') +
                ' &nbsp;|&nbsp; ' +
                esc(p.phone_number || 'No phone') +
                '</small>';
            item.addEventListener('click', function() {
                dd.style.display = 'none';
                if (g('conFormsPsInput')) {
                    g('conFormsPsInput').value =
                        p.full_name + ' (#' + (p.patient_no || '') + ')';
                }
                // keep consultation-wide patient selection in sync
                selectConPatient(p);
                initConForms();
            });
            dd.appendChild(item);
        });
        dd.style.display = 'block';
    });
}

function loadConFormsTemplates() {
    var sel = g('conFormsTemplateSel');
    if (sel) sel.innerHTML = '<option value="">Loading templates...</option>';

    SB.from('doc_templates')
      .select('id,template_code,template_name,template_type,content,is_active')
      .order('template_code')
    .then(function(r) {
        if (r.error) {
            if (sel) sel.innerHTML = '<option value="">Error loading templates</option>';
            return;
        }
        conFormsTemplates = (r.data || []).filter(function(t) { return t.is_active !== false; });
        if (!sel) return;

        if (!conFormsTemplates.length) {
            sel.innerHTML = '<option value="">No templates available</option>';
            return;
        }
        sel.innerHTML = '<option value="">-- Select Template --</option>' +
            conFormsTemplates.map(function(t) {
                var label = (t.template_name || t.template_code || 'Template') +
                    (t.template_type ? ' · ' + t.template_type : '');
                return '<option value="' + esc(t.id) + '">' + esc(label) + '</option>';
            }).join('');
    });
}

function loadConFormsDoctor() {
    // best-effort matching active doctor -> doctors row
    conFormsDoctorData = null;
    if (conActiveDoctorId) {
        SB.from('doctors').select('*').eq('id', conActiveDoctorId).single()
        .then(function (r) {
            if (r.error || !r.data) return;
            conFormsDoctorData = r.data;
            updateConsultationDoctorUI();
        });
        return;
    }

    if (!currentName) return;

    SB.from('doctors')
      .select('*')
      .eq('english_name', currentName)
      .limit(1)
    .then(function(r) {
        if (r.error || !r.data || !r.data.length) return;
        conFormsDoctorData = r.data[0];
        updateConsultationDoctorUI();
    });
}

function onConFormsTemplateChange() {
    var sel = g('conFormsTemplateSel');
    var editorWrap = g('conFormsEditorWrap');
    var editor = g('conFormsDocEditor');
    if (!sel || !editorWrap || !editor) return;

    var id = sel.value || '';
    if (!id) {
        editorWrap.style.display = 'none';
        conFormsSelectedTemplate = null;
        return;
    }
    conFormsSelectedTemplate = conFormsTemplates.find(function(t) { return t.id === id; }) || null;
    if (!conFormsSelectedTemplate) {
        editorWrap.style.display = 'none';
        return;
    }

    // default doc name
    if (g('conFormsDocName') && !g('conFormsDocName').value) {
        g('conFormsDocName').value = conFormsSelectedTemplate.template_name || '';
    }

    var seeded = conFormsSelectedTemplate.content || '';
    editor.innerHTML = applyConFormsPlaceholders(seeded) || '';
    editorWrap.style.display = 'block';
    setTimeout(function () { editor.focus(); }, 0);
}

function applyConFormsPlaceholders(html) {
    var p = conFormsPatientData || {};
    var d = conFormsDoctorData || {};
    var now = new Date();
    var map = {
        patient_no: p.patient_no || '',
        patient_name: p.full_name || '',
        patient_chinese_name: p.chinese_name || '',
        patient_phone: p.phone_number || '',
        patient_hkid: p.hkid || '',
        patient_dob: p.dob || '',
        patient_email: p.email || '',
        patient_address: p.address || '',
        doctor_name: conActiveDoctorName || d.english_name || currentName || '',
        doctor_code: d.doctor_code || '',
        clinic_name: (conFormsSelectedTemplate && conFormsSelectedTemplate.clinic_name) || '',
        date: todayISO(),
        time: now.toLocaleTimeString('en-HK', { hour: '2-digit', minute: '2-digit' })
    };

    var out = String(html || '');
    Object.keys(map).forEach(function(k) {
        var re = new RegExp('\\{' + k.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\}', 'g');
        out = out.replace(re, esc(map[k]));
    });
    return out;
}

function conFormsCmd(cmd) {
    var editor = g('conFormsDocEditor');
    if (editor) editor.focus();
    conFormsRestoreSelection();
    try {
        document.execCommand(cmd, false, null);
    } catch (e) {}
    conFormsSaveSelection();
}

function conFormsFontName(name) {
    var editor = g('conFormsDocEditor');
    if (editor) editor.focus();
    conFormsRestoreSelection();
    try { document.execCommand('fontName', false, name); } catch (e) {}
    conFormsSaveSelection();
}

function conFormsFontSize(size) {
    var editor = g('conFormsDocEditor');
    if (editor) editor.focus();
    conFormsRestoreSelection();
    try { document.execCommand('fontSize', false, String(size)); } catch (e) {}
    conFormsSaveSelection();
}

function conFormsForeColor(color) {
    var editor = g('conFormsDocEditor');
    if (!editor) return;
    // Color picker steals focus; restore the selection the user highlighted.
    conFormsRestoreSelection();
    editor.focus();
    try { document.execCommand('foreColor', false, color); } catch (e) {}
    conFormsSaveSelection();
}

function conFormsInsertTag(tag) {
    var editor = g('conFormsDocEditor');
    if (!editor) return;
    editor.focus();
    conFormsRestoreSelection();
    try {
        document.execCommand('insertText', false, tag);
    } catch (e) {
        // fallback
        var sel = window.getSelection ? window.getSelection() : null;
        if (!sel || !sel.rangeCount) return;
        var range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(tag));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }
    conFormsSaveSelection();
}

function saveConFormsDoc(andPrint) {
    if (!conFormsPatientId || !conFormsPatientData) {
        alert('Select a patient first.');
        return;
    }
    var sel = g('conFormsTemplateSel');
    if (!sel || !sel.value) {
        alert('Please select a template.');
        return;
    }

    var docName = (g('conFormsDocName') ? g('conFormsDocName').value : '').trim();
    if (!docName) {
        alert('Please enter a document name.');
        return;
    }

    var html = (g('conFormsDocEditor') ? g('conFormsDocEditor').innerHTML : '').trim();
    if (!html) {
        alert('Document is empty.');
        return;
    }

    var t = conFormsSelectedTemplate || {};
    var row = {
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

    // NOTE: this table must exist in Supabase:
    // patient_documents(patient_id, template_id, document_name, document_date, content_html, ...)
    SB.from('patient_documents').insert([row])
    .then(function(r) {
        if (r.error) {
            alert('Save failed: ' + r.error.message +
                '\n\nIf this is the first time using Forms/Letters, create the Supabase table "patient_documents".');
            return;
        }
        alert('✅ Document saved.');
        if (andPrint) {
            printConFormsHtml(html);
        }
    });
}

function printConFormsHtml(html) {
    var popup = window.open('', '_blank', 'width=900,height=700,scrollbars=1,resizable=1');
    if (!popup) {
        alert('Please allow popups to print.');
        return;
    }
    popup.document.write(
        '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<title>Print</title>' +
        '<style>body{font-family:Arial,sans-serif;padding:28px;color:#111;}@media print{body{padding:0}}</style>' +
        '</head><body>' +
        html +
        '<script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>' +
        '</body></html>'
    );
    popup.document.close();
}

function searchConFormsDocs() {
    if (!conFormsPatientId) {
        alert('Select a patient first.');
        return;
    }
    var wrap = g('conFormsSearchWrap');
    var list = g('conFormsExistingList');
    if (wrap) wrap.style.display = 'block';
    if (list) list.innerHTML = '<div style="color:#aaa;padding:10px;">Loading…</div>';

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
                'Error: ' + esc(r.error.message) +
                '<br><small>Make sure Supabase table "patient_documents" exists.</small></div>';
            return;
        }
        var rows = r.data || [];
        if (!rows.length) {
            list.innerHTML = '<div style="color:#888;padding:10px;">No documents found.</div>';
            return;
        }
        rows.forEach(function (d) { conFormsDocsCache[d.id] = d; });

        list.innerHTML = rows.map(function(d) {
            var meta = (d.template_name || '-') + (d.template_type ? ' · ' + d.template_type : '');
            var safeId = esc(d.id);
            return '<div style="display:flex;justify-content:space-between;gap:10px;' +
                'padding:10px 12px;border-bottom:1px solid #f0f0f0;align-items:center;">' +
                '<div style="display:flex;align-items:center;gap:10px;min-width:0;">' +
                  '<input type="checkbox" class="conFormsHistCb" data-id="' + safeId + '" ' +
                         'onchange="conFormsToggleSelect(\'' + safeId + '\', this.checked)">' +
                '<div style="min-width:0;">' +
                  '<div style="font-weight:900;color:#0d6efd;">' + esc(d.document_name || '-') + '</div>' +
                  '<div style="font-size:12px;color:#888;margin-top:2px;">' +
                    esc(d.document_date || '') + ' · ' + esc(meta) +
                  '</div>' +
                '</div>' +
                '</div>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                  '<button class="btn-add" style="padding:6px 10px;font-size:12px;" ' +
                  'onclick="openConFormsDoc(\'' + safeId + '\')">Open</button>' +
                '</div>' +
              '</div>';
        }).join('');
    });
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
    if (!confirm('Delete ' + n + ' document(s)? This cannot be undone.')) return;

    SB.from('patient_documents')
      .delete()
      .in('id', conFormsSelectedDocIds)
    .then(function (r) {
        if (r.error) { alert('Delete failed: ' + r.error.message); return; }
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
            if (r.error) { alert('Print failed: ' + r.error.message); return; }
            var rows = r.data || [];
            var html = rows.map(function (d) { return d.content_html || ''; }).join(
                '<div style="page-break-after:always;"></div>'
            );
            printConFormsHtml(html);
        });
        return;
    }

    var htmlJoined = docs
        .map(function (d) { return d.content_html || ''; })
        .join('<div style="page-break-after:always;"></div>');

    printConFormsHtml(htmlJoined);
}

function openConFormsDoc(id) {
    SB.from('patient_documents')
      .select('*')
      .eq('id', id)
      .single()
    .then(function(r) {
        if (r.error || !r.data) { alert('Could not load document.'); return; }
        var d = r.data;
        if (g('conFormsDocName')) g('conFormsDocName').value = d.document_name || '';
        if (g('conFormsDocEditor')) g('conFormsDocEditor').innerHTML = d.content_html || '';
        if (g('conFormsEditorWrap')) g('conFormsEditorWrap').style.display = 'block';
        setTimeout(function () { if (g('conFormsDocEditor')) g('conFormsDocEditor').focus(); }, 0);
    });
}

// ════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════
function formatDobAge(dob) {
    var pts = String(dob || '').split('-');
    var d = typeof parseISODateOnly === 'function'
        ? parseISODateOnly(dob)
        : new Date(+pts[0], +pts[1] - 1, +pts[2]);
    if (!d || isNaN(d.getTime())) return '—';
    var age = Math.floor(
        (nowLocal() - d) / (365.25 * 24 * 3600 * 1000)
    );
    return pts[2] + '/' + pts[1] + '/' + pts[0] +
           ' (' + age + ' yrs)';
}

// ════════════════════════════════════════════════════════════════
// TREATMENT NOTES — LEFT PANEL
// ════════════════════════════════════════════════════════════════
function loadConNotes(pid) {
    var tl = g('conTimeline');
    if (!tl) return;

    tl.innerHTML =
        '<p style="color:#aaa;margin:0;padding:16px;">Loading...</p>';

    SB.from('treatments').select('*')
        .eq('patient_id', pid)
        .order('created_at', { ascending: false })
    .then(function(r) {
        if (r.error || !r.data || !r.data.length) {
            tl.innerHTML =
                '<p style="color:#aaa;margin:0;padding:16px;">' +
                'No treatment notes yet.</p>';
            return;
        }

        tl.innerHTML = '';
        var todayStr = new Date().toDateString();

        var groups = {};
        var order  = [];
        r.data.forEach(function(t) {
            var dk = new Date(t.created_at).toDateString();
            if (!groups[dk]) { groups[dk] = []; order.push(dk); }
            groups[dk].push(t);
        });

        order.forEach(function(dk) {
            var sep = document.createElement('div');
            sep.className = 'note-date-sep';
            sep.innerHTML =
                '<span class="note-date-label">' +
                    new Date(dk).toLocaleDateString('en-HK', {
                        weekday: 'short', day: 'numeric',
                        month: 'short',   year: 'numeric'
                    }) +
                '</span>';
            tl.appendChild(sep);

            groups[dk].forEach(function(t) {
                var isToday = dk === todayStr;
                var canEdit = isToday && currentRole !== 'nurse';

                var div = document.createElement('div');
                div.className = 'note-card';
                div.innerHTML =
                    '<div class="note-card-header">' +
                        '<div style="display:flex;flex-direction:column;gap:2px;">' +
                            '<small class="note-time">' +
                                new Date(t.created_at)
                                    .toLocaleTimeString('en-HK', {
                                        hour: '2-digit', minute: '2-digit'
                                    }) +
                            '</small>' +
                            (t.dentist_name
                                ? '<small style="color:#888;font-size:11px;">' +
                                  '👨‍⚕️ ' + esc(t.dentist_name) + '</small>'
                                : '') +
                        '</div>' +
                        (canEdit
                            ? '<button class="btn-edit-note btn-sm" ' +
                              'style="background:var(--primary);">' +
                              'Edit</button>'
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
    });
}

function saveConNote() {
    if (!conPatientId) { alert('Select a patient first.'); return; }
    var inp  = g('conNoteInput');
    var note = (inp.value || '').trim();
    if (!note) { alert('Please enter a note.'); return; }

    var row = {
        patient_id:   conPatientId,
        dentist_name: conActiveDoctorTag || conActiveDoctorName || currentName || null,
        doctor_id:    conActiveDoctorId || null,
        doctor_name:  conActiveDoctorName || currentName || null,
        doctor_tag:   conActiveDoctorTag || conActiveDoctorName || currentName || null,
        notes:        note
    };

    var ctNote = (conPatientData && conPatientData[PATIENT_CLINIC_TAG_FIELD])
        ? conPatientData[PATIENT_CLINIC_TAG_FIELD]
        : (typeof currentClinicCodeForTagging === 'function'
            ? currentClinicCodeForTagging()
            : '');
    if (ctNote) row[TREATMENT_CLINIC_TAG_FIELD] = ctNote;

    SB.from('treatments').insert([row])
    .then(function(r) {
        if (!r.error) {
            inp.value = '';
            loadConNotes(conPatientId);
            return;
        }
        var msg = String(r.error.message || '').toLowerCase();
        if (msg.indexOf('clinic_tag') >= 0 && row[TREATMENT_CLINIC_TAG_FIELD]) {
            var rowCt = Object.assign({}, row);
            delete rowCt[TREATMENT_CLINIC_TAG_FIELD];
            SB.from('treatments').insert([rowCt])
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
                    SB.from('treatments').insert([legacyRow])
                    .then(function(r2) {
                        if (r2.error) { alert('Error: ' + r2.error.message); return; }
                        inp.value = '';
                        loadConNotes(conPatientId);
                    });
                    return;
                }
                alert('Error: ' + rc.error.message);
            });
            return;
        }
        if (msg.indexOf('doctor_tag') >= 0 || msg.indexOf('doctor_id') >= 0 || msg.indexOf('doctor_name') >= 0) {
            var legacyRow = {
                patient_id: row.patient_id,
                dentist_name: row.dentist_name,
                notes: row.notes
            };
            SB.from('treatments').insert([legacyRow])
            .then(function(r2) {
                if (r2.error) { alert('Error: ' + r2.error.message); return; }
                inp.value = '';
                loadConNotes(conPatientId);
            });
            return;
        }
        alert('Error: ' + r.error.message);
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
            'cursor:pointer;">Delete</button>' +
            '<div style="display:flex;gap:8px;">' +
                '<button id="cnc-' + nid + '" ' +
                'style="background:var(--gray);color:white;' +
                'border:none;padding:5px 12px;border-radius:4px;' +
                'cursor:pointer;">Cancel</button>' +
                '<button id="cns-' + nid + '" ' +
                'style="background:var(--success);color:white;' +
                'border:none;padding:5px 12px;border-radius:4px;' +
                'cursor:pointer;">Save</button>' +
            '</div>' +
        '</div>';

    g('cne-' + nid).value = rawText || '';

    g('cnd-' + nid).addEventListener('click', function() {
        if (!confirm('Delete this note?')) return;
        SB.from('treatments').delete().eq('id', nid)
        .then(function(r) {
            if (r.error) { alert('Error: ' + r.error.message); return; }
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
            if (r.error) { alert('Error: ' + r.error.message); return; }
            loadConNotes(conPatientId);
        });
    });
}

// ════════════════════════════════════════════════════════════════
// DRUG PANEL — TOGGLE
// ════════════════════════════════════════════════════════════════

/** Index of first line missing both drug name and dosage (−1 = all OK). */
function rxFirstInvalidDrugLineIdx() {
    for (var i = 0; i < rxLines.length; i++) {
        var l = rxLines[i];
        var hasName = !!(l.drug_name && String(l.drug_name).trim());
        var hasDos  = !!(l.dosage    && String(l.dosage).trim());
        if (!hasName && !hasDos) return i;
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

        if (!opts.keepRxLines) {
            rxLines = [];
        }

        if (!opts.keepRxLines || wasHidden ||
            !String((g('rxDate') && g('rxDate').value) || '').trim()) {
            sv('rxDate',        todayISO());
            sv('rxDentistName', conActiveDoctorTag || conActiveDoctorName || currentName || '');
        }

        renderRxLines();
    } else {
        panel.style.display = 'none';
        btn.style.display   = 'inline-block';
        rxLines = [];
    }
}

// ════════════════════════════════════════════════════════════════
// RX LINES — RENDER
// ════════════════════════════════════════════════════════════════
function addDrugLine() {
    rxLines.push({
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

function renderRxLines() {
    var wrap = g('rxLinesWrap');
    if (!wrap) return;
    wrap.innerHTML = '';

    if (!rxLines.length) {
        wrap.innerHTML =
            '<p style="color:#aaa;font-size:13px;padding:8px 0;">' +
            'No drugs added yet. Click "+ Add Drug" below.</p>';
        return;
    }

    rxLines.forEach(function(line, idx) {
        var card = document.createElement('div');
        card.className = 'rx-line-card';
        card.id = 'rxline-' + idx;
        card.innerHTML =
            '<div class="rx-line-header">' +
                '<span class="rx-line-num">Rx ' + (idx + 1) + '</span>' +
                '<div class="rx-line-actions">' +
                    '<button class="btn-label-en" ' +
                    'onclick="printRxLineLabelEn(this)" ' +
                    'title="Print English Label">🖨 EN</button>' +
                    '<button class="btn-label-zh" ' +
                    'onclick="printRxLineLabelZh(this)" ' +
                    'title="列印中文標籤">🖨 中文</button>' +
                    '<button class="btn-remove-rx btn-sm" ' +
                    'style="background:var(--danger);" ' +
                    'onclick="removeRxLine(' + idx + ')">✕</button>' +
                '</div>' +
            '</div>' +
            '<div class="rx-fields">' +
                // Row 1: drug select (full width)
                '<div style="grid-column:1/-1;">' +
                    '<label style="font-size:11px;color:#888;' +
                    'display:block;margin-bottom:3px;">Drug</label>' +
                    '<select id="rxSel-' + idx + '" ' +
                    'style="width:100%;padding:6px 8px;' +
                    'border:1px solid #d1d5db;border-radius:5px;' +
                    'font-size:13px;">' +
                    '<option value="">-- Select Drug --</option>' +
                    '</select>' +
                '</div>' +
                // Row 2: dosage + route
                '<div>' +
                    '<label style="font-size:11px;color:#888;' +
                    'display:block;margin-bottom:3px;">Dosage</label>' +
                    '<input class="rx-dosage" placeholder="e.g. 500mg" ' +
                    'value="' + esc(line.dosage || '') + '" ' +
                    'oninput="rxLines[' + idx + '].dosage=this.value" ' +
                    'style="width:100%;padding:6px 8px;' +
                    'border:1px solid #d1d5db;border-radius:5px;' +
                    'font-size:13px;box-sizing:border-box;">' +
                '</div>' +
                '<div>' +
                    '<label style="font-size:11px;color:#888;' +
                    'display:block;margin-bottom:3px;">Route</label>' +
                    '<input class="rx-route" placeholder="e.g. Oral" ' +
                    'value="' + esc(line.route || '') + '" ' +
                    'oninput="rxLines[' + idx + '].route=this.value" ' +
                    'style="width:100%;padding:6px 8px;' +
                    'border:1px solid #d1d5db;border-radius:5px;' +
                    'font-size:13px;box-sizing:border-box;">' +
                '</div>' +
                // Row 3: frequency + duration
                '<div>' +
                    '<label style="font-size:11px;color:#888;' +
                    'display:block;margin-bottom:3px;">Frequency</label>' +
                    '<input class="rx-freq" placeholder="e.g. TDS" ' +
                    'value="' + esc(line.frequency || '') + '" ' +
                    'oninput="rxLines[' + idx + '].frequency=this.value" ' +
                    'style="width:100%;padding:6px 8px;' +
                    'border:1px solid #d1d5db;border-radius:5px;' +
                    'font-size:13px;box-sizing:border-box;">' +
                '</div>' +
                '<div>' +
                    '<label style="font-size:11px;color:#888;' +
                    'display:block;margin-bottom:3px;">Duration</label>' +
                    '<input class="rx-dur" placeholder="e.g. 5 days" ' +
                    'value="' + esc(line.duration || '') + '" ' +
                    'oninput="rxLines[' + idx + '].duration=this.value" ' +
                    'style="width:100%;padding:6px 8px;' +
                    'border:1px solid #d1d5db;border-radius:5px;' +
                    'font-size:13px;box-sizing:border-box;">' +
                '</div>' +
                // Row 4: quantity + remarks
                '<div>' +
                    '<label style="font-size:11px;color:#888;' +
                    'display:block;margin-bottom:3px;">Qty</label>' +
                    '<input class="rx-quantity" placeholder="e.g. 15" ' +
                    'value="' + esc(line.quantity || '') + '" ' +
                    'oninput="rxLines[' + idx + '].quantity=this.value" ' +
                    'style="width:100%;padding:6px 8px;' +
                    'border:1px solid #d1d5db;border-radius:5px;' +
                    'font-size:13px;box-sizing:border-box;">' +
                '</div>' +
                '<div>' +
                    '<label style="font-size:11px;color:#888;' +
                    'display:block;margin-bottom:3px;">Remarks</label>' +
                    '<input class="rx-remarks" placeholder="Optional" ' +
                    'value="' + esc(line.remarks || '') + '" ' +
                    'oninput="rxLines[' + idx + '].remarks=this.value" ' +
                    'style="width:100%;padding:6px 8px;' +
                    'border:1px solid #d1d5db;border-radius:5px;' +
                    'font-size:13px;box-sizing:border-box;">' +
                '</div>' +
            '</div>';

        wrap.appendChild(card);
        populateDrugSelect(idx);
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
            '<option value="">-- Select Drug --</option>';

        var pickedCatalog  = false;
        var matchedByName  = false;

        var cats = {};
        r.data.forEach(function(d) {
            var cat = d.category || 'Other';
            if (!cats[cat]) cats[cat] = [];
            cats[cat].push(d);
        });

        Object.keys(cats).sort().forEach(function(cat) {
            var og = document.createElement('optgroup');
            og.label = cat;
            cats[cat].forEach(function(d) {
                var o = document.createElement('option');
                o.value = d.id;
                o.textContent =
                    d.drug_name +
                    (d.dosage ? ' (' + d.dosage + ')' : '');
                o.dataset.name      = d.drug_name  || '';
                o.dataset.dosage    = d.dosage    || '';
                o.dataset.frequency = d.frequency || '';
                o.dataset.duration  = d.duration  || '';
                o.dataset.route     = d.route     || '';
                o.dataset.remarks   = d.remarks   || '';

                var idHit =
                    !!(wantId && rxLines[idx] && String(d.id) === String(wantId));

                var dn = String(d.drug_name || '').trim().toLowerCase();
                var nameHit =
                    !!(wantNorm && dn === wantNorm);

                if (idHit) {
                    o.selected    = true;
                    pickedCatalog = true;
                } else if (nameHit && !matchedByName &&
                    rxLines[idx] && !pickedCatalog) {
                    o.selected         = true;
                    pickedCatalog      = true;
                    matchedByName      = true;
                    rxLines[idx].drug_id   = String(d.id);
                    rxLines[idx].drug_name =
                        d.drug_name || rxLines[idx].drug_name || '';
                }

                og.appendChild(o);
            });
            sel.appendChild(og);
        });

        if (!pickedCatalog && wantNorm && rxLines[idx] && rxLines[idx].drug_name) {
            var ogImp = document.createElement('optgroup');
            ogImp.label = 'From saved prescription';
            var ox = document.createElement('option');
            ox.value       = RX_SNAPSHOT_SELECT;
            ox.textContent = String(rxLines[idx].drug_name).trim()
                ? (rxLines[idx].drug_name + ' · (pick catalog to link)')
                : '(imported · pick catalog to link)';
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
            rxLines[idx].dosage    = opt.dataset.dosage;
            rxLines[idx].frequency = opt.dataset.frequency;
            rxLines[idx].duration  = opt.dataset.duration;
            rxLines[idx].route     = opt.dataset.route;
            rxLines[idx].remarks   = opt.dataset.remarks;

            var card = g('rxline-' + idx);
            if (card) {
                card.querySelector('.rx-dosage').value = rxLines[idx].dosage;
                card.querySelector('.rx-freq').value =
                    rxLines[idx].frequency;
                card.querySelector('.rx-dur').value   = rxLines[idx].duration;
                card.querySelector('.rx-route').value = rxLines[idx].route;
                card.querySelector('.rx-remarks').value =
                    rxLines[idx].remarks;
            }
        };
    }

    SB.from('druglist')
        .select('id,drug_name,category,dosage,frequency,duration,route,remarks')
        .eq('is_active', true)
        .order('category',      { ascending: true })
        .order('drug_name',       { ascending: true })
    .then(function(r) {
        if (!r.error && r.data && r.data.length) {
            fillFromDrugData(r);
            return;
        }
        SB.from('druglist')
            .select('id,drug_name,category,dosage,frequency,duration,route,remarks')
            .order('category',   { ascending: true })
            .order('drug_name', { ascending: true })
        .then(fillFromDrugData);
    });
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
        alert('Could not write saved lists to storage: ' + (e.message || e));
    }
}

function rxNewComboListId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'lst_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);
}

function rxCloneSavedLine(src) {
    var l = src || {};
    return {
        drug_id:    String(l.drug_id   || ''),
        drug_name:  String(l.drug_name || ''),
        dosage:     String(l.dosage    || ''),
        frequency:  String(l.frequency || ''),
        duration:   String(l.duration  || ''),
        route:      String(l.route     || ''),
        quantity:   String(l.quantity  || ''),
        remarks:    String(l.remarks   || '')
    };
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
        alert('Nothing to save as a drug list.');
        return false;
    }
    var miss = rxFirstMissingDrugNameIdx(snapshot);
    if (miss >= 0) {
        alert('Cannot save this list — row ' + (miss + 1) + ' has no drug name.');
        return false;
    }

    var promptLine = promptHintCtx
        ? ('Name this drug combination (saved from ' + promptHintCtx + '):')
        : 'Name this drug combination (e.g. Post-op bundle):';
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
        !confirm('A list named "' + safeName + '" already exists. Replace it with these drugs?'))
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
    alert('✅ Saved list "' + safeName + '" (' + payloadLines.length + ' drug line(s)).');
    return true;
}

function rxSaveCurrentAsComboList() {
    var panel = g('drugAddPanel');
    if (!panel || panel.style.display === 'none' || !panel.style.display) {
        toggleDrugAddPanel(true, { keepRxLines: true });
    }

    if (!rxLines.length) {
        alert('Add drug lines first, then save them as a named list.');
        return;
    }

    var bad = rxFirstInvalidDrugLineIdx();
    if (bad >= 0) {
        alert('Row ' + (bad + 1) + ': select a drug first (needed before saving this list).');
        return;
    }

    rxPersistNamedComboList(rxLines.map(rxCloneSavedLine));
}

function rxSaveComboListFromHistoryRecords(records) {
    var snap = rxSnapshotFromDrughistoryRecords(records);
    if (!snap.length) {
        alert('This prescription entry has no drug lines.');
        return;
    }
    rxPersistNamedComboList(snap, 'prescription history');
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
            sv('rxDentistName', conActiveDoctorTag || conActiveDoctorName ||
                currentName || '');
        }
    }
}

/** Append all drugs from one saved history group to the current Rx draft (edit & save separately). */
function rxReapplyHistoryGroupRecords(records) {
    if (!conPatientId || !conPatientData) {
        alert('Select a patient first.');
        return;
    }
    var snap = rxSnapshotFromDrughistoryRecords(records);
    if (!snap.length) {
        alert('This history entry has no drug lines.');
        return;
    }
    var miss = rxFirstMissingDrugNameIdx(snap);
    if (miss >= 0) {
        alert('Cannot re-apply — history row ' + (miss + 1) + ' has no drug name.');
        return;
    }

    rxEnsureRxDraftChromeOnly();
    snap.forEach(function(line) {
        rxLines.push(rxCloneSavedLine(line));
    });
    renderRxLines();
}

function rxApplySavedDrugList(listId, mode) {
    rxEnsureRxDraftChromeOnly();

    var lists = readRxComboListsStorage();
    var lst   = lists.find(function(x) { return x.id === listId; });
    if (!lst || !lst.lines || !lst.lines.length) {
        alert('That list has no drugs.');
        return;
    }
    var copies = lst.lines.map(rxCloneSavedLine);
    var label  = String(lst.name || 'this list').replace(/"/g, "'");

    if (mode === 'replace') {
        if (rxLines.length &&
            !confirm('Replace the current prescription draft (' + rxLines.length +
                     ' line(s)) with "' + label + '"?'))
            return;
        rxLines = [];
    }

    copies.forEach(function(line) {
        rxLines.push(line);
    });
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
            'No list names match this filter.</p>';
        return;
    }

    body.innerHTML = '';
    lists.forEach(function(lst) {
        var nLines = lst.lines ? lst.lines.length : 0;
        var um     = '';
        try {
            if (lst.updated_at) {
                um = new Date(lst.updated_at).toLocaleString('en-HK', {
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
                    esc(lst.name || 'Untitled') +
                '</div>' +
                '<div style="font-size:11px;color:#64748b;margin-top:2px;">' +
                    esc(String(nLines) + ' drug line(s)' + (um ? ' · saved ' + um : '')) +
                '</div>' +
            '</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px;">' +
                '<button type="button" class="rx-slist-append" ' +
                        'style="padding:5px 10px;font-size:11px;border-radius:5px;' +
                        'border:1px solid #16a34a;background:#f0fdf4;color:#166534;' +
                        'cursor:pointer;font-weight:600;">Append</button>' +
                '<button type="button" class="rx-slist-replace" ' +
                        'style="padding:5px 10px;font-size:11px;border-radius:5px;' +
                        'border:1px solid #ea580c;background:#fff7ed;color:#9a3412;' +
                        'cursor:pointer;font-weight:600;">Replace</button>' +
                '<button type="button" class="rx-slist-delete" ' +
                        'title="Delete this saved list" ' +
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
            if (!confirm('Remove saved drug list "' + nm + '"?')) return;
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
    if (!conPatientId) { alert('No patient selected.'); return; }
    if (!rxLines.length) {
        alert('Add at least one drug line.'); return;
    }

    var badRx = rxFirstInvalidDrugLineIdx();
    if (badRx >= 0) {
        alert('Row ' + (badRx + 1) + ': select a drug first.');
        return;
    }

    var date    = g('rxDate').value        || todayISO();
    var dentist = g('rxDentistName').value || conActiveDoctorTag || conActiveDoctorName || currentName || '';

    var rows = rxLines.map(function(l) {
        return {
            patient_id:      conPatientId,
            patient_no:      conPatientData.patient_no  || null,
            patient_name:    conPatientData.full_name,
            prescribed_date: date,
            drug_name:       l.drug_name || 'Unknown',
            dosage:          l.dosage    || null,
            frequency:       l.frequency || null,
            duration:        l.duration  || null,
            route:           l.route     || null,
            quantity:        l.quantity  || null,
            remarks:         l.remarks   || null,
            dentist_name:    dentist,
            doctor_id:       conActiveDoctorId || null,
            doctor_name:     conActiveDoctorName || currentName || null,
            doctor_tag:      conActiveDoctorTag || dentist || null
        };
    });

    SB.from('drughistory').insert(rows)
    .then(function(r) {
        if (!r.error) {
            toggleDrugAddPanel(false);
            loadDrugHistory(conPatientId);
            alert('✅ Prescription saved — ' + rows.length +
                  ' drug(s) for ' + conPatientData.full_name);
            return;
        }
        var msg = String(r.error.message || '').toLowerCase();
        if (msg.indexOf('doctor_tag') >= 0 || msg.indexOf('doctor_id') >= 0 || msg.indexOf('doctor_name') >= 0) {
            var legacyRows = rows.map(function (x) {
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
                    remarks: x.remarks,
                    dentist_name: x.dentist_name
                };
            });
            SB.from('drughistory').insert(legacyRows)
            .then(function(r2) {
                if (r2.error) { alert('Error: ' + r2.error.message); return; }
                toggleDrugAddPanel(false);
                loadDrugHistory(conPatientId);
                alert('✅ Prescription saved — ' + rows.length +
                      ' drug(s) for ' + conPatientData.full_name);
            });
            return;
        }
        alert('Error: ' + r.error.message);
    });
}

// ════════════════════════════════════════════════════════════════
// DRUG HISTORY — grouped by date + print buttons
// ════════════════════════════════════════════════════════════════
async function loadDrugHistory(patientId) {
    var wrap = g('drugHistoryWrap');
    if (!wrap) return;
    wrap.innerHTML =
        '<p style="color:#aaa;padding:12px;">Loading...</p>';

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
            'No prescription history.</p>';
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
                displayDate = dt.toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric'
                });
            }
        } catch(e) {}

        var groupDiv = document.createElement('div');
        groupDiv.className = 'rx-group-card';

        var rowsHtml = rows.map(function(r) {
            return '<div class="rx-history-row"' +
                ' data-drug-name="'       + esc(r.drug_name       || '') + '"' +
                ' data-dosage="'          + esc(r.dosage          || '') + '"' +
                ' data-route="'           + esc(r.route           || '') + '"' +
                ' data-frequency="'       + esc(r.frequency       || '') + '"' +
                ' data-duration="'        + esc(r.duration        || '') + '"' +
                ' data-quantity="'        + esc(r.quantity        || '') + '"' +
                ' data-remarks="'         + esc(r.remarks         || '') + '"' +
                ' data-dentist-name="'    + esc(r.dentist_name    || '') + '"' +
                ' data-doctor-tag="'      + esc(r.doctor_tag      || r.dentist_name || '') + '"' +
                ' data-patient-no="'     + esc(r.patient_no      || '') + '"' +
                ' data-patient-name="'    + esc(r.patient_name    || '') + '"' +
                ' data-prescribed-date="' + esc(r.prescribed_date || '') + '">' +
                    '<div class="rx-row-main">' +
                        '<span class="rx-row-drug">' +
                            '<strong>' + esc(r.drug_name || '—') + '</strong> ' +
                            esc(r.dosage || '') + ' ' +
                            esc(r.route  || '') +
                        '</span>' +
                        '<span class="rx-row-info">' +
                            esc(r.frequency || '') + ' &bull; ' +
                            esc(r.duration  || '') + ' &bull; Qty: ' +
                            esc(r.quantity  || '') +
                        '</span>' +
                        (r.remarks
                            ? '<span class="rx-row-remarks">' +
                              esc(r.remarks) + '</span>'
                            : '') +
                    '</div>' +
                    '<div class="rx-row-print-btns">' +
                        '<button class="btn-label-sm-en" ' +
                        'onclick="printHistoryRowLabel(this,\'en\')" ' +
                        'title="Print Label">🖨 EN</button>' +
                        '<button class="btn-label-sm-zh" ' +
                        'onclick="printHistoryRowLabel(this,\'zh\')" ' +
                        'title="列印標籤">🖨 中文</button>' +
                    '</div>' +
                '</div>';
        }).join('');

        groupDiv.innerHTML =
            '<div class="rx-group-header">' +
                '<div class="rx-group-meta">' +
                    '<span class="rx-group-date">📅 ' +
                        displayDate + '</span>' +
                    '<span class="rx-group-dr">Dr. ' +
                        esc(doctorTag) + '</span>' +
                '</div>' +
                '<div class="rx-group-actions">' +
                    '<button class="btn-label-group-en" ' +
                    'onclick="printHistoryGroupLabels(this,\'en\')" ' +
                    'title="Print All Labels">🖨 All EN</button>' +
                    '<button class="btn-label-group-zh" ' +
                    'onclick="printHistoryGroupLabels(this,\'zh\')" ' +
                    'title="列印全部標籤">🖨 All 中文</button>' +
                    '<button type="button" class="btn-reapply-hist-rx" ' +
                    'title="Add this prescription to the Rx draft below (appends)"' +
                    ' style="padding:5px 9px;font-size:11px;border-radius:5px;' +
                    'border:1px solid #0284c7;background:#e0f2fe;color:#0369a1;' +
                    'cursor:pointer;font-weight:600;">↻ Re-apply</button>' +
                    '<button type="button" class="btn-save-hist-as-list" ' +
                    'title="Save this prescription bundle as a named reusable list"' +
                    ' style="padding:5px 9px;font-size:11px;border-radius:5px;' +
                    'border:1px solid #ca8a04;background:#fefce8;color:#854d0e;' +
                    'cursor:pointer;font-weight:600;">💾 Save as list</button>' +
                    '<button class="btn-delete-group" ' +
                    'onclick="deleteRxGroup(this,\'' +
                        esc(dateStr) + '\',\'' +
                        esc(doctorTag) + '\')">' +
                    '🗑 Delete All</button>' +
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
            reApplyBtn.addEventListener('click', function() {
                rxReapplyHistoryGroupRecords(rows);
            });
        }
    });
}

// ════════════════════════════════════════════════════════════════
// DELETE RX GROUP
// ════════════════════════════════════════════════════════════════
function deleteRxGroup(btn, dateStr, doctorTag) {
    if (!confirm('Delete all prescriptions for this date?')) return;
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
                if (r2.error) { alert('Error: ' + r2.error.message); return; }
                loadDrugHistory(conPatientId);
            });
            return;
        }
        if (r.error) { alert('Error: ' + r.error.message); return; }
        loadDrugHistory(conPatientId);
    });
}

// ════════════════════════════════════════════════════════════════
// ██████████████████████████████████████████████████████████████
// DRUG LABEL PRINT SYSTEM
// ██████████████████████████████████████████████████████████████
// ════════════════════════════════════════════════════════════════

// ── Core print engine ────────────────────────────────────────
/** Resolved from login clinic (APP_CLINICS) for label header; falls back to session label. */
function currentActiveClinicLabelForPrinting(isZh) {
    var rec =
        typeof currentClinicId !== 'undefined' &&
        currentClinicId &&
        typeof clinicRecordFromId === 'function'
            ? clinicRecordFromId(currentClinicId)
            : null;

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
 * Address + phone under clinic name on labels (login clinic). Always three lines: addr, then Tel/電話.
 */
function buildClinicContactHtmlForDrugLabel(isZh) {
    var rec =
        typeof currentClinicId !== 'undefined' &&
        currentClinicId &&
        typeof clinicRecordFromId === 'function'
            ? clinicRecordFromId(currentClinicId)
            : null;
    var addr = rec ? String(rec.address || '').trim() : '';
    var tel = rec ? String(rec.tel || '').trim() : '';
    var e = typeof esc === 'function' ? esc : function(s) { return String(s || ''); };
    var addrShown = addr ? e(addr) : '—';
    var telBody = tel ? e(tel) : '—';
    var telLine = (isZh ? '電話：' : 'Tel: ') + telBody;
    return (
        '<div class="clinic-addr">' + addrShown + '</div>' +
        '<div class="clinic-tel">' + telLine + '</div>'
    );
}

function printDrugLabel(drugs, lang) {
    var isZh = (lang === 'zh');
    var clinicNameRaw = currentActiveClinicLabelForPrinting(isZh);
    var clinicName =
        typeof esc === 'function' ? esc(clinicNameRaw) : String(clinicNameRaw || '');
    var clinicContactHtml = buildClinicContactHtmlForDrugLabel(isZh);

    var fontFamily = isZh
        ? "'Microsoft JhengHei','PingFang TC','Noto Sans TC',Arial,sans-serif"
        : "Arial,'Helvetica Neue',sans-serif";

    var labelCSS =
        '* { margin:0; padding:0; box-sizing:border-box; }' +
        '@page { size:50mm 60mm; margin:1mm; }' +
        'html,body {' +
            'font-family:' + fontFamily + ';' +
            'width:48mm;' +
            'margin:0 auto;' +
            'background:#fff;' +
            'color:#000;' +
        '}' +
        /* Base scales with JS so dense labels shrink, light layouts stay large */
        '.label {' +
            'width:100%;' +
            'height:58mm;' +
            'max-height:58mm;' +
            'padding:1mm 1.1mm 1.1mm 1.1mm;' +
            'page-break-after:always;' +
            'display:flex;' +
            'flex-direction:column;' +
            'justify-content:flex-start;' +
            'align-items:stretch;' +
            'gap:0.45mm;' +
            'overflow:hidden;' +
            'font-size:7.25pt;' +
            'line-height:1.2;' +
        '}' +
        '.label:last-child { page-break-after:avoid; }' +
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
        '}' +
        '.clinic-name {' +
            'font-size:0.88em;' +
            'font-weight:bold;' +
            'text-align:center;' +
            'line-height:1.12;' +
            'word-break:break-word;' +
            'display:-webkit-box;' +
            '-webkit-box-orient:vertical;' +
            '-webkit-line-clamp:2;' +
            'overflow:hidden;' +
        '}' +
        '.clinic-addr,.clinic-tel {' +
            'font-size:0.78em;' +
            'font-weight:normal;' +
            'text-align:center;' +
            'line-height:1.1;' +
            'word-break:break-word;' +
            'display:-webkit-box;' +
            '-webkit-box-orient:vertical;' +
            'overflow:hidden;' +
        '}' +
        '.clinic-addr { margin-top:0.12em; -webkit-line-clamp:2; }' +
        '.clinic-tel { margin-top:0.06em; -webkit-line-clamp:1; }' +
        '.clinic-header-rule {' +
            'border:none;' +
            'border-top:0.35pt solid #000;' +
            'margin:0.15em 0 0 0;' +
            'flex-shrink:0;' +
        '}' +
        '.label-patient {' +
            'flex:0 0 auto;' +
            'min-height:0;' +
            'overflow:hidden;' +
            'padding:0.15em 0 0 0;' +
        '}' +
        '.patient-row {' +
            'font-size:0.76em;' +
            'line-height:1.1;' +
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
        '.patient-drug-rule {' +
            'border:none;' +
            'border-top:0.35pt solid #000;' +
            'margin:0.15em 0 0 0;' +
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
        '.divider {' +
            'border:none;' +
            'border-top:0.35pt dashed #000;' +
            'margin:0.12em 0;' +
        '}' +
        '.drug-name {' +
            'font-size:1.06em;' +
            'font-weight:bold;' +
            'line-height:1.12;' +
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
            'font-size:0.9em;' +
            'line-height:1.18;' +
            'word-break:break-word;' +
            'flex-shrink:0;' +
            'width:100%;' +
            'text-align:left;' +
        '}' +
        '.lk { font-weight:bold; }' +
        '.remarks-block {' +
            'font-size:0.82em;' +
            'line-height:1.12;' +
            'word-break:break-word;' +
            'font-style:italic;' +
            'display:-webkit-box;' +
            '-webkit-box-orient:vertical;' +
            '-webkit-line-clamp:2;' +
            'overflow:hidden;' +
            'flex-shrink:0;' +
            'width:100%;' +
            'text-align:left;' +
        '}' +
        '.footer-row {' +
            'font-size:0.88em;' +
            'line-height:1.15;' +
            'word-break:break-word;' +
            'width:100%;' +
            'text-align:left;' +
        '}';

    // ── Build each label ──────────────────────────────────────
    var labelsHtml = drugs.map(function(d) {
        var eFn = typeof esc === 'function' ? esc : function(s) { return String(s || ''); };
        var drugName = d.drug_name       || '—';
        var dosage   = d.dosage          || '—';
        var route    = d.route           || '—';
        var freq     = d.frequency       || '—';
        var duration = d.duration        || '—';
        var qty      = d.quantity        || '—';
        var remarks  = d.remarks         || '';
        var doctor   = d.doctor_tag      || d.dentist_name || conActiveDoctorTag || conActiveDoctorName || currentName || '—';
        var dateStr  = '—';

        var patNoRaw   = String(d.patient_no || '').trim();
        var patNameRaw = String(d.patient_name || '').trim();
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
            '<div class="patient-row"><span class="lk">病人編號：</span>' + patNoDisp + '</div>' +
            '<div class="patient-row patient-name-wrap"><span class="lk">姓名：</span>' +
                '<span class="patient-val">' + patNameDisp + '</span></div>' +
            '<div class="patient-row"><span class="lk">日期：</span>' + dateStr + '</div>' +
            '<hr class="patient-drug-rule">' +
            '</div>';

        var patientBlockEn =
            '<div class="label-patient">' +
            '<div class="patient-row"><span class="lk">No. </span>' + patNoDisp + '</div>' +
            '<div class="patient-row patient-name-wrap"><span class="lk">Name: </span>' +
                '<span class="patient-val">' + patNameDisp + '</span></div>' +
            '<div class="patient-row"><span class="lk">Date: </span>' + dateStr + '</div>' +
            '<hr class="patient-drug-rule">' +
            '</div>';

        var remarksHtml = remarks
            ? '<hr class="divider">' +
              '<div class="remarks-block">' +
                  '<span class="lk">' +
                      (isZh ? '備註：' : 'Remarks: ') +
                  '</span>' + remarks +
              '</div>'
            : '';

        if (isZh) {
            return '<div class="label">' +
                '<div class="label-top">' +
                '<div class="label-header">' +
                '<div class="clinic-name">' + clinicName + '</div>' +
                clinicContactHtml +
                '<hr class="clinic-header-rule">' +
                '</div>' +
                patientBlockZh +
                '</div>' +
                '<div class="label-mid">' +
                '<div class="label-mid-inner">' +
                '<div class="drug-name">' + drugName + '</div>' +
                '<div class="info-row">' + dosage + ' &nbsp;|&nbsp; ' + route + '</div>' +
                '<div class="info-row"><span class="lk">服用頻率：</span>' + freq + '</div>' +
                '<div class="info-row"><span class="lk">療程：</span>' + duration + '</div>' +
                '<div class="info-row"><span class="lk">數量：</span>' + qty + '</div>' +
                remarksHtml +
                '</div>' +
                '</div>' +
                '<div class="label-footer">' +
                '<hr class="divider">' +
                '<div class="footer-row"><span class="lk">醫生：</span>' + doctor + '</div>' +
                '</div>' +
                '</div>';
        } else {
            return '<div class="label">' +
                '<div class="label-top">' +
                '<div class="label-header">' +
                '<div class="clinic-name">' + clinicName + '</div>' +
                clinicContactHtml +
                '<hr class="clinic-header-rule">' +
                '</div>' +
                patientBlockEn +
                '</div>' +
                '<div class="label-mid">' +
                '<div class="label-mid-inner">' +
                '<div class="drug-name">' + drugName + '</div>' +
                '<div class="info-row">' + dosage + ' &nbsp;|&nbsp; ' + route + '</div>' +
                '<div class="info-row"><span class="lk">Freq: </span>' + freq + '</div>' +
                '<div class="info-row"><span class="lk">Duration: </span>' + duration + '</div>' +
                '<div class="info-row"><span class="lk">Qty: </span>' + qty + '</div>' +
                remarksHtml +
                '</div>' +
                '</div>' +
                '<div class="label-footer">' +
                '<hr class="divider">' +
                '<div class="footer-row"><span class="lk">Dr. </span>' + doctor + '</div>' +
                '</div>' +
                '</div>';
        }
    }).join('');

    // ── Wider popup: Chrome/Edge print UI can show options (LHS) + preview (RHS) when space allows.
    var popup = window.open(
        '', '_blank',
        'width=1024,height=760,left=60,top=32,toolbar=0,menubar=0,scrollbars=1,resizable=1'
    );

    if (!popup) {
        alert('⚠️ Please allow popups for this site to print labels.\n' +
              'Look for the blocked popup icon in your browser address bar.');
        return;
    }

    popup.document.write(
        '<!DOCTYPE html>' +
        '<html lang="' + (isZh ? 'zh-HK' : 'en') + '">' +
        '<head>' +
            '<meta charset="UTF-8">' +
            '<title>' + (isZh ? '藥物標籤' : 'Drug Label') + '</title>' +
            '<style>' + labelCSS + '</style>' +
        '</head>' +
        '<body>' +
            labelsHtml +
            '<script>' +
            '(function(){' +
            'function fitAllDrugLabels(){' +
            'var labels=[].slice.call(document.querySelectorAll(".label"));' +
            'if(!labels.length)return;' +
            'var lo=5.15,hi=8.2,step=0.12,tol=1.5;' +
            'function apply(sz){labels.forEach(function(l){l.style.fontSize=sz+"pt";});}' +
            'function allFit(sz){apply(sz);void document.body.offsetHeight;' +
            'return labels.every(function(l){return l.scrollHeight<=l.clientHeight+tol;});}' +
            'var fs=hi;' +
            'while(fs>lo&&!allFit(fs))fs-=step;' +
            'if(!allFit(fs))apply(lo);' +
            '}' +
            'window.onload=function(){' +
            'try{fitAllDrugLabels();}catch(e){}' +
            'try{window.focus();}catch(e2){}' +
            'setTimeout(function(){window.print();},480);' +
            '};' +
            '})();' +
            '<\/script>' +
        '</body>' +
        '</html>'
    );
    popup.document.close();
    try {
        popup.focus();
    } catch (ePrintFocus) {}
}

// ── Get drug data from a live rx-line-card (before save) ─────
function getDrugFromRxLine(lineEl) {
    var today = todayISO();
    var dosageEl   = lineEl.querySelector('.rx-dosage');
    var routeEl    = lineEl.querySelector('.rx-route');
    var freqEl     = lineEl.querySelector('.rx-freq');
    var durEl      = lineEl.querySelector('.rx-dur');
    var qtyEl      = lineEl.querySelector('.rx-quantity');
    var remarksEl  = lineEl.querySelector('.rx-remarks');

    // Get drug name from the rxLines array via card id
    var cardId  = lineEl.id; // e.g. "rxline-2"
    var idx     = cardId ? parseInt(cardId.replace('rxline-', ''), 10) : -1;
    var drugName = (idx >= 0 && rxLines[idx])
        ? (rxLines[idx].drug_name || '')
        : '';

    return {
        drug_name:       drugName,
        dosage:          dosageEl   ? (dosageEl.value   || '') : '',
        route:           routeEl    ? (routeEl.value    || '') : '',
        frequency:       freqEl     ? (freqEl.value     || '') : '',
        duration:        durEl      ? (durEl.value      || '') : '',
        quantity:        qtyEl      ? (qtyEl.value      || '') : '',
        remarks:         remarksEl  ? (remarksEl.value  || '') : '',
        dentist_name:    conActiveDoctorName || currentName || '—',
        doctor_tag:      conActiveDoctorTag || conActiveDoctorName || currentName || '',
        prescribed_date: today,
        patient_no:      (conPatientData && conPatientData.patient_no) ? String(conPatientData.patient_no) : '',
        patient_name:    (conPatientData && conPatientData.full_name) ? String(conPatientData.full_name) : ''
    };
}

// ── Print single label from rx line (EN) ─────────────────────
function printRxLineLabelEn(btn) {
    var lineEl = btn.closest('.rx-line-card');
    if (!lineEl) return;
    if (!conPatientId || !conPatientData) {
        alert('Please select a patient first (patient no. and name appear on the label).');
        return;
    }
    var drug = getDrugFromRxLine(lineEl);
    if (!drug.drug_name) {
        alert('Please select a drug first.');
        return;
    }
    printDrugLabel([drug], 'en');
}

// ── Print single label from rx line (中文) ───────────────────
function printRxLineLabelZh(btn) {
    var lineEl = btn.closest('.rx-line-card');
    if (!lineEl) return;
    if (!conPatientId || !conPatientData) {
        alert('請先選擇病人（標籤須顯示病人編號及姓名）。');
        return;
    }
    var drug = getDrugFromRxLine(lineEl);
    if (!drug.drug_name) {
        alert('請先選擇藥物。');
        return;
    }
    printDrugLabel([drug], 'zh');
}

// ── Print single label from saved history row ─────────────────
function printHistoryRowLabel(btn, lang) {
    var row = btn.closest('.rx-history-row');
    if (!row) return;
    var drug = {
        drug_name:       row.dataset.drugName       || '',
        dosage:          row.dataset.dosage         || '',
        route:           row.dataset.route          || '',
        frequency:       row.dataset.frequency      || '',
        duration:        row.dataset.duration       || '',
        quantity:        row.dataset.quantity       || '',
        remarks:         row.dataset.remarks        || '',
        dentist_name:    row.dataset.dentistName    || '',
        doctor_tag:      row.dataset.doctorTag      || row.dataset.dentistName || '',
        prescribed_date: row.dataset.prescribedDate || '',
        patient_no:      row.dataset.patientNo ||
            (conPatientData && conPatientData.patient_no ? String(conPatientData.patient_no) : ''),
        patient_name:    row.dataset.patientName ||
            (conPatientData && conPatientData.full_name ? String(conPatientData.full_name) : '')
    };
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
    if (!defName && conPatientData && conPatientData.full_name) {
        defName = String(conPatientData.full_name);
    }
    rows.forEach(function(row) {
        var dn = row.dataset.drugName || '';
        if (!dn) return;
        drugs.push({
            drug_name:       dn,
            dosage:          row.dataset.dosage         || '',
            route:           row.dataset.route          || '',
            frequency:       row.dataset.frequency      || '',
            duration:        row.dataset.duration       || '',
            quantity:        row.dataset.quantity       || '',
            remarks:         row.dataset.remarks        || '',
            dentist_name:    row.dataset.dentistName    || '',
            doctor_tag:      row.dataset.doctorTag      || row.dataset.dentistName || '',
            prescribed_date: row.dataset.prescribedDate || '',
            patient_no:      row.dataset.patientNo || defNo,
            patient_name:    row.dataset.patientName || defName
        });
    });
    if (!drugs.length) return;
    printDrugLabel(drugs, lang);
}

// ════════════════════════════════════════════════════════════════
// DRUG LIST MANAGER MODAL
// ════════════════════════════════════════════════════════════════
function openDrugListManager() {
    drugEditId = null;
    loadDrugListTable();
    resetDrugForm();
    openModal('drugListModal');
}

function loadDrugListTable() {
    var tb = g('drugListBody');
    if (!tb) return;

    tb.innerHTML =
        '<tr><td colspan="7" style="text-align:center;' +
        'color:#aaa;padding:16px;">Loading...</td></tr>';

    SB.from('druglist')
        .select('*')
        .order('category',  { ascending: true })
        .order('drug_name', { ascending: true })
    .then(function(r) {
        if (r.error || !r.data || !r.data.length) {
            tb.innerHTML =
                '<tr><td colspan="7" style="text-align:center;' +
                'color:#aaa;padding:16px;">No drugs in list.' +
                '</td></tr>';
            return;
        }
        tb.innerHTML = '';
        r.data.forEach(function(d) {
            var tr = document.createElement('tr');
            if (!d.is_active) tr.style.opacity = '0.5';
            tr.innerHTML =
                '<td><span class="cat-badge">' +
                    esc(d.category || 'Other') +
                '</span></td>' +
                '<td><strong>' + esc(d.drug_name) + '</strong>' +
                    (!d.is_active
                        ? ' <span style="font-size:10px;' +
                          'color:var(--danger);">[Inactive]</span>'
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
                        'Edit</button>' +
                        '<button class="btn-dl-del btn-sm" ' +
                        'style="background:var(--danger);">' +
                        'Del</button>' +
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

function resetDrugForm() {
    drugEditId = null;
    var title  = g('dlFormTitle');
    if (title) title.textContent = '➕ Add New Drug';
    var cancel = g('dlCancelEdit');
    if (cancel) cancel.style.display = 'none';
    sv('dlName',      '');
    sv('dlCategory',  '');
    sv('dlDosage',    '');
    sv('dlFrequency', '');
    sv('dlDuration',  '');
    sv('dlRoute',     '');
    sv('dlRemarks',   '');
}

function editDrugItem(d) {
    drugEditId = d.id;
    var title  = g('dlFormTitle');
    if (title) title.textContent = '✏️ Edit Drug';
    var cancel = g('dlCancelEdit');
    if (cancel) cancel.style.display = 'inline-block';
    sv('dlName',      d.drug_name  || '');
    sv('dlCategory',  d.category   || '');
    sv('dlDosage',    d.dosage     || '');
    sv('dlFrequency', d.frequency  || '');
    sv('dlDuration',  d.duration   || '');
    sv('dlRoute',     d.route      || '');
    sv('dlRemarks',   d.remarks    || '');
    var nameEl = g('dlName');
    if (nameEl) nameEl.focus();
}

function saveDrugItem() {
    var name = (g('dlName').value || '').trim();
    if (!name) { alert('Drug name is required.'); return; }

    var payload = {
        drug_name:  name,
        category:  (g('dlCategory').value  || '').trim() || null,
        dosage:    (g('dlDosage').value    || '').trim() || null,
        frequency: (g('dlFrequency').value || '').trim() || null,
        duration:  (g('dlDuration').value  || '').trim() || null,
        route:     (g('dlRoute').value     || '').trim() || null,
        remarks:   (g('dlRemarks').value   || '').trim() || null
    };

    var promise = drugEditId
        ? SB.from('druglist').update(payload).eq('id', drugEditId)
        : SB.from('druglist').insert([payload]);

    promise.then(function(r) {
        if (r.error) { alert('Error: ' + r.error.message); return; }
        resetDrugForm();
        loadDrugListTable();
    });
}

function deleteDrugItem(id) {
    if (!confirm('Delete this drug from the master list?')) return;
    SB.from('druglist').delete().eq('id', id)
    .then(function(r) {
        if (r.error) { alert('Error: ' + r.error.message); return; }
        loadDrugListTable();
    });
}

// ════════════════════════════════════════════════════════════════
// MEDICAL HISTORY TAB
// ════════════════════════════════════════════════════════════════
function doConPatientSearchMed() {
    var q  = (g('conPsInputMed').value || '').trim();
    var dd = g('conPsDropMed');
    if (!q) { dd.style.display = 'none'; return; }

    var mq = SB.from('patients')
        .select(
            'id,patient_no,full_name,dob,' +
            'phone_number,medical_alerts,' + PATIENT_CLINIC_TAG_FIELD
        )
        .or(
            'full_name.ilike.%'    + q + '%,' +
            'patient_no.ilike.%'   + q + '%,' +
            'phone_number.ilike.%' + q + '%'
        )
        .limit(8);
    mq = typeof applyPatientQueryClinicTag === 'function'
        ? applyPatientQueryClinicTag(mq, 'conPsClinicFilterMed')
        : mq;
    mq.then(function(r) {
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
                '<strong>' + esc(p.full_name) + '</strong>' +
                '<br><small style="color:#aaa;">' +
                '#' + esc(p.patient_no || '-') +
                ' &nbsp;|&nbsp; ' +
                esc(p.phone_number || 'No phone') +
                '</small>';
            item.addEventListener('click', function() {
                dd.style.display = 'none';
                g('conPsInputMed').value =
                    p.full_name +
                    ' (#' + (p.patient_no || '') + ')';
                selectMedPatient(p);
            });
            dd.appendChild(item);
        });
        dd.style.display = 'block';
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
        g('conMedBannerAlert').textContent = p.medical_alerts || 'None';
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
            alert('Error loading medical history: ' + r.error.message);
            return;
        }
        var d = r.data || {};
        sv('fldMedHistory',  d.medical_history     || '');
        sv('fldMedications', d.current_medications || '');
        sv('fldAllergy',     d.allergy             || '');
        if (form) form.style.display = 'block';
    });
}

function saveMedicalHistory() {
    if (!conMedPatientId) { alert('No patient selected.'); return; }
    var payload = {
        medical_history:     (g('fldMedHistory').value  || '').trim(),
        current_medications: (g('fldMedications').value || '').trim(),
        allergy:             (g('fldAllergy').value     || '').trim()
    };
    SB.from('patients').update(payload).eq('id', conMedPatientId)
    .then(function(r) {
        if (r.error) { alert('Error saving: ' + r.error.message); return; }
        alert('✅ Medical history saved for ' +
              conMedPatientData.full_name);
    });
}

// ════════════════════════════════════════════════════════════════
// DENTAL HISTORY TAB
// ════════════════════════════════════════════════════════════════
function doConPatientSearchDen() {
    var q  = (g('conPsInputDen').value || '').trim();
    var dd = g('conPsDropDen');
    if (!q) { dd.style.display = 'none'; return; }

    var dq = SB.from('patients')
        .select(
            'id,patient_no,full_name,dob,' +
            'phone_number,medical_alerts,' + PATIENT_CLINIC_TAG_FIELD
        )
        .or(
            'full_name.ilike.%'    + q + '%,' +
            'patient_no.ilike.%'   + q + '%,' +
            'phone_number.ilike.%' + q + '%'
        )
        .limit(8);
    dq = typeof applyPatientQueryClinicTag === 'function'
        ? applyPatientQueryClinicTag(dq, 'conPsClinicFilterDen')
        : dq;
    dq.then(function(r) {
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
                '<strong>' + esc(p.full_name) + '</strong>' +
                '<br><small style="color:#aaa;">' +
                '#' + esc(p.patient_no || '-') +
                ' &nbsp;|&nbsp; ' +
                esc(p.phone_number || 'No phone') +
                '</small>';
            item.addEventListener('click', function() {
                dd.style.display = 'none';
                g('conPsInputDen').value =
                    p.full_name +
                    ' (#' + (p.patient_no || '') + ')';
                selectDenPatient(p);
            });
            dd.appendChild(item);
        });
        dd.style.display = 'block';
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
        g('conDenBannerAlert').textContent = p.medical_alerts || 'None';
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
            alert('Error loading dental history: ' + r.error.message);
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
    if (!conDenPatientId) { alert('No patient selected.'); return; }
    var payload = {
        dental_history:        (g('fldDentalHistory').value  || '').trim(),
        parafunctional_habits: (g('fldParafunctional').value || '').trim(),
        oral_hygiene_notes:    (g('fldOralHygiene').value    || '').trim()
    };
    SB.from('patients').update(payload).eq('id', conDenPatientId)
    .then(function(r) {
        if (r.error) { alert('Error saving: ' + r.error.message); return; }
        alert('✅ Dental history saved for ' +
              conDenPatientData.full_name);
    });
}
