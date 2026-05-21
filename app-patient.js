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

function refreshPatientDirI18n() {
    if (typeof refreshPatientSexSelects === 'function') refreshPatientSexSelects();
    if (patientListCache.length && typeof renderPatients === 'function') {
        renderPatients(patientListCache);
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
        var prevAddClinic = addPatientSelectedClinicId();
        fillAddPatientClinicSelect();
        if (prevAddClinic) {
            var addSel = g('addPatientClinicSelect');
            if (addSel) addSel.value = prevAddClinic;
        }
        if (typeof updateAddPatientNoAvailabilityUI === 'function') {
            updateAddPatientNoAvailabilityUI();
        }
    }
    var editModal = g('editPatientModal');
    if (editModal && editModal.style.display === 'block') {
        fillEditPatientClinicSelect(editPatientLoadedClinicTag);
        setEditPatientModalForRole();
    }
    if (_patientDetailsPatient && selPatientId) {
        refreshPatientDetailsModalHeader(_patientDetailsPatient);
        refreshPatientDetailsBulkSection();
    }
    var detModal = g('patientDetailsModal');
    if (detModal && detModal.style.display === 'block' && selPatientId) {
        if (typeof loadTreatments === 'function') loadTreatments(selPatientId);
    }
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
        SB.from('patients').select('patient_no').range(from, to).then(function(r) {
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
        });
    }

    page(0);
}

/** Returns 6-digit string e.g. 010000 or null if invalid/out of range. */
function normalizePatientNoInput(raw) {
    var s = String(raw || '').trim().replace(/\D/g, '');
    if (!s.length) return null;
    if (s.length > 6) return null;
    var n = parseInt(s, 10);
    if (isNaN(n) || n < MIN_PATIENT_REG_NO || n > MAX_PATIENT_REG_NO) return null;
    return String(n).padStart(6, '0');
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

    APP_CLINICS.forEach(function(c) {
        var label =
            (c.clinic_code ? '[' + c.clinic_code + '] ' : '') +
            (c.english_name || c.chinese_name || (typeof clinicDisplayFallback === 'function'
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
    sel.value = match ? defaultId : String(APP_CLINICS[0].id || '');
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
        var label =
            (c.clinic_code ? '[' + c.clinic_code + '] ' : '') +
            (c.english_name || c.chinese_name || (typeof clinicDisplayFallback === 'function'
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
            if (typeof cb === 'function') cb(null);
            return;
        }
        var nums = list
            .map(function(no) { return parseInt(no, 10); })
            .filter(function(n) { return !isNaN(n); });
        var highs = nums.filter(function(n) { return n >= MIN_PATIENT_REG_NO; });

        var nextNum;
        if (!highs.length) nextNum = MIN_PATIENT_REG_NO;
        else nextNum = Math.max.apply(null, highs) + 1;

        if (nextNum > MAX_PATIENT_REG_NO) {
            if (typeof cb === 'function') cb(null);
            return;
        }

        var out = String(nextNum).padStart(6, '0');
        if (typeof cb === 'function') cb(out);
    });
}

function openAddPatient() {
    g('patientForm').reset();
    sv('preview_patientNo','');
    var st = g('addPatientNoStatus');
    if (st) { st.textContent = ''; st.style.color = '#64748b'; }
    fillAddPatientClinicSelect();
    openModal('addPatientModal');
    var am = g('addPatientModal');
    if (am && typeof applyI18nInRoot === 'function') applyI18nInRoot(am);
    refreshPatientSexSelects();
    genPatientNo(function(no) {
        if (no) {
            sv('preview_patientNo', no);
            updateAddPatientNoAvailabilityUI();
        } else {
            sv('preview_patientNo', '');
            if (st) {
                st.textContent = patTr('patient.noStatusExhausted');
                st.style.color = 'var(--danger)';
            }
        }
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
            remarks:        (g('remarks').value      ||'').trim()||null
        };
        if (ctAdd) payload[PATIENT_CLINIC_TAG_FIELD] = ctAdd;
        SB.from('patients').insert([payload]).select('id,patient_no,full_name,chinese_name')
        .then(function(r) {
            if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
            var row = r.data && r.data[0] ? r.data[0] : null;
            var linkedToday = row &&
                typeof linkTodayApptAfterPatientRegistration === 'function' &&
                linkTodayApptAfterPatientRegistration(row);
            closeModal('addPatientModal');
            g('patientForm').reset();
            fetchPatients();
            if (!linkedToday) {
                alert(patTrRepl('patient.alertRegistered', { NO: no }));
            }
        });
    });
}

// ════════════════════════════════════════════════════════════════
// PATIENT — FETCH + RENDER
// ════════════════════════════════════════════════════════════════
function fetchPatients() {
    var q = SB.from('patients').select('*')
        .order('patient_no',{ascending:true});
    q = typeof applyPatientQueryClinicTag === 'function'
        ? applyPatientQueryClinicTag(q, 'patientDirClinicFilter')
        : q;
    q.then(function(r) {
        if (r.error) { console.error(r.error); return; }
        renderPatients(r.data||[]);
    });
}

function renderPatients(list) {
    patientListCache = list || [];
    var tb = g('patientTableBody');
    if (!list.length) {
        tb.innerHTML =
            '<tr><td colspan="7" style="text-align:center;' +
            'padding:30px;color:#999;">' + esc(patTr('patient.empty')) + '</td></tr>';
        return;
    }
    tb.innerHTML = '';
    list.forEach(function(p) {
        var dob = '--';
        if (p.dob) {
            var pts = p.dob.split('-');
            dob = pts[2]+'/'+pts[1]+'/'+pts[0];
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

        var tr = document.createElement('tr');
        tr.innerHTML =
            '<td class="patient-dir-name-cell">' + nameHtml + '</td>' +
            '<td>'+esc(p.phone_number||'--')+'</td>' +
            '<td style="font-size:12px;color:#64748b;">' +
                esc(p[PATIENT_CLINIC_TAG_FIELD]||'—') +
            '</td>' +
            '<td style="white-space:nowrap;">'+dob+'</td>' +
            '<td>'+esc(p.hkid||'--')+'</td>' +
            '<td><small style="color:'+(p.medical_alerts?'var(--danger)':'#bbb')+';">' +
                esc(p.medical_alerts||patTr('patient.alertsNone'))+'</small></td>' +
            '<td>' +
                '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
                    '<button class="btn-notes" ' +
                    'style="background:#f0f0f0;border:1px solid #ccc;' +
                    'padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;" ' +
                    'data-id="'+p.id+'">' + esc(patTr('patient.btnNotes')) + '</button>' +
                    '<button class="btn-editp" ' +
                    'style="background:var(--primary);color:white;border:none;' +
                    'padding:6px 12px;border-radius:4px;cursor:pointer;font-size:13px;" ' +
                    'data-id="'+p.id+'">' +
                    esc(currentRole === 'nurse' ? patTr('patient.btnClinicTag') : patTr('patient.btnEdit')) +
                    '</button>' +
                '</div>' +
            '</td>';
        tb.appendChild(tr);
    });
    tb.querySelectorAll('.btn-notes').forEach(function(b) {
        b.addEventListener('click', function(){ viewHistory(b.dataset.id); });
    });
    tb.querySelectorAll('.btn-editp').forEach(function(b) {
        b.addEventListener('click', function(){ openEditPatient(b.dataset.id); });
    });
}

function filterTable() {
    var q = (g('searchInput').value||'').toLowerCase();
    document.querySelectorAll('#patientTableBody tr').forEach(function(r) {
        r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
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
        'edit_email',
        'edit_dob',
        'edit_hkid',
        'edit_insuranceNo',
        'edit_occupation',
        'edit_address'
    ].forEach(function(fid) {
        var el = g(fid);
        if (el) el.readOnly = nurse;
    });
    var sex = g('edit_sex');
    if (sex) sex.disabled = nurse;
    ['edit_alerts', 'edit_remarks'].forEach(function(fid) {
        var el = g(fid);
        if (el) el.readOnly = nurse;
    });

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
        sv('edit_email',       p.email          ||'');
        sv('edit_sex',         p.sex            ||'');
        sv('edit_dob',         p.dob            ||'');
        sv('edit_hkid',        p.hkid           ||'');
        sv('edit_insuranceNo', p.insurance_no   ||'');
        sv('edit_occupation',  p.occupation     ||'');
        sv('edit_address',     p.address        ||'');
        sv('edit_alerts',      p.medical_alerts ||'');
        sv('edit_remarks',     p.remarks        ||'');
        editPatientLoadedClinicTag = p[PATIENT_CLINIC_TAG_FIELD] || '';
        fillEditPatientClinicSelect(editPatientLoadedClinicTag);
        setEditPatientModalForRole();
        openModal('editPatientModal');
        var em = g('editPatientModal');
        if (em && typeof applyI18nInRoot === 'function') applyI18nInRoot(em);
        refreshPatientSexSelects();
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
    var nurse = currentRole === 'nurse';
    var payload = nurse
        ? (function() {
              var o = {};
              if (ctEdit) o[PATIENT_CLINIC_TAG_FIELD] = ctEdit;
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
              remarks:        (g('edit_remarks').value     ||'').trim()||null
          };
    if (!nurse && ctEdit) payload[PATIENT_CLINIC_TAG_FIELD] = ctEdit;
    SB.from('patients').update(payload).eq('id',editPatientId)
    .then(function(r) {
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
        closeModal('editPatientModal');
        fetchPatients();
        if (typeof refreshApptListsAfterPatientEdit === 'function') {
            refreshApptListsAfterPatientEdit();
        }
        alert(nurse ? patTr('patient.alertClinicTagSaved') : patTr('patient.alertUpdated'));
    });
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
    selPatientId = pid;
    SB.from('patients').select('*').eq('id',pid).single()
    .then(function(r) {
        if (r.error||!r.data) { alert(patTr('patient.alertCouldNotLoad')); return; }
        var p = r.data;
        _patientDetailsPatient = p;
        selPatientClinicTag = p[PATIENT_CLINIC_TAG_FIELD] ||
            (typeof currentClinicCodeForTagging === 'function'
                ? currentClinicCodeForTagging()
                : '');
        refreshPatientDetailsModalHeader(p);
        refreshPatientDetailsBulkSection();
        loadTreatments(pid);
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
        var todayStr = new Date().toDateString();
        tl.innerHTML = '';
        r.data.forEach(function(t) {
            var isToday = new Date(t.created_at).toDateString()===todayStr;
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
        .insert([ins])
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

document.addEventListener('app-lang-change', function() {
    if (typeof refreshPatientDirI18n === 'function') refreshPatientDirI18n();
});
