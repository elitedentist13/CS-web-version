// ════════════════════════════════════════════════════════════════
// PATIENT MODULE — Directory | Dashboard views
// ════════════════════════════════════════════════════════════════

var PATIENT_VIEW_MODE_KEY = 'joyful_patient_view_mode_v1';
var patientViewMode = 'directory';
var patientViewFullRecord = null;
var patientDashLoadSeq = 0;
var patientDashData = null;

function patViewTr(key) {
    return (typeof patTr === 'function') ? patTr(key) : key;
}

function patViewTrRepl(key, pairs) {
    var s = patViewTr(key);
    if (!pairs) return s;
    Object.keys(pairs).forEach(function (k) {
        s = s.split('{' + k + '}').join(String(pairs[k]));
    });
    return s;
}

function patViewFmtDob(dob) {
    if (!dob) return '—';
    var pts = String(dob).split('-');
    if (pts.length === 3) return pts[2] + '/' + pts[1] + '/' + pts[0];
    return dob;
}

function patViewFmtDateTime(ts) {
    if (!ts) return '—';
    if (typeof fmtDateTime === 'function') return fmtDateTime(ts);
    var d = new Date(ts);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function patViewFmtDate(iso) {
    if (!iso) return '—';
    if (typeof fmtDateLong === 'function') return fmtDateLong(iso);
    return iso;
}

function patViewSexLabel(sex) {
    if (sex === 'M') return patViewTr('patient.form.sexMale');
    if (sex === 'F') return patViewTr('patient.form.sexFemale');
    return '—';
}

function patViewDistrictLabel(code) {
    if (!code) return '—';
    if (typeof patientResDistrictLabel === 'function') return patientResDistrictLabel(code);
    return code;
}

function patViewTextBlock(val) {
    var s = String(val || '').trim();
    if (!s) return '<span class="pat-view-muted">—</span>';
    return '<div class="pat-view-text-block">' + esc(s) + '</div>';
}

function patViewNameHtml(p) {
    if (!p) return '—';
    var cn = String(p.chinese_name || '').trim();
    var en = String(p.full_name || '').trim();
    var sex = (typeof patientSexSymbolHtml === 'function')
        ? patientSexSymbolHtml(p.sex, { hideUnknown: true }) : '';
    var h = '';
    if (p.patient_no) {
        h += '<span class="pat-view-pno"># ' + esc(p.patient_no) + '</span>';
    }
    if (sex) h += sex;
    if (cn) h += '<div class="pat-view-name-cn">' + esc(cn) + '</div>';
    if (en) h += '<div class="pat-view-name-en">' + esc(en) + '</div>';
    if (!cn && !en) h += '<div class="pat-view-name-en">—</div>';
    return h;
}

function patViewPhotoUrl(record) {
    if (typeof photoDisplayUrl === 'function') return photoDisplayUrl(record);
    if (!record || !SB) return '';
    var path = record.storage_path || record.file_path || '';
    if (!path) return '';
    try {
        var ur = SB.storage.from('photos').getPublicUrl(path);
        return (ur && ur.data && ur.data.publicUrl) ? ur.data.publicUrl : '';
    } catch (e) { return ''; }
}

function patViewLoadMode() {
    try {
        var m = localStorage.getItem(PATIENT_VIEW_MODE_KEY);
        if (m === 'profile') m = 'directory';
        if (m === 'dashboard' || m === 'directory') patientViewMode = m;
    } catch (e) {}
}

function patViewSaveMode() {
    try { localStorage.setItem(PATIENT_VIEW_MODE_KEY, patientViewMode); } catch (e) {}
}

function patViewSetMode(mode, opts) {
    opts = opts || {};
    if (mode === 'profile') mode = 'directory';
    if (mode !== 'directory' && mode !== 'dashboard') mode = 'directory';
    patientViewMode = mode;
    patViewSaveMode();

    var panes = {
        directory: g('patientViewDirectory'),
        dashboard: g('patientViewDashboard')
    };
    Object.keys(panes).forEach(function (k) {
        var el = panes[k];
        if (!el) return;
        var on = k === mode;
        el.classList.toggle('active', on);
        el.hidden = !on;
    });

    document.querySelectorAll('.patient-view-btn').forEach(function (btn) {
        var on = btn.getAttribute('data-pview') === mode;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    if (mode === 'dashboard') patViewLoadDashboard();
    else if (!opts.skipScroll && typeof g === 'function') {
        var sec = g('patientSection');
        if (sec && sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function patViewEmptyHtml(msgKey) {
    return '<div class="pat-view-empty"><div class="pat-view-empty-icon">👤</div>' +
        '<p>' + esc(patViewTr(msgKey)) + '</p>' +
        '<button type="button" class="btn-add pat-view-goto-dir" data-act="goto-dir">' +
        esc(patViewTr('patient.view.gotoDirectory')) + '</button></div>';
}

function patViewActionsHtml(p) {
    var id = p && p.id ? esc(p.id) : '';
    return '<div class="pat-view-actions">' +
        '<button type="button" class="btn-add pat-view-act" data-act="consult" data-id="' + id + '">' +
        esc(patViewTr('patient.view.openConsult')) + '</button>' +
        '<button type="button" class="btn-add pat-view-act" data-act="notes" data-id="' + id + '">' +
        esc(patViewTr('patient.btnNotes')) + '</button>' +
        '<button type="button" class="btn-add pat-view-act pat-view-act--ok" data-act="checkin" data-id="' + id + '">' +
        esc(patViewTr('patient.btnCheckIn')) + '</button>' +
        '<button type="button" class="btn-add pat-view-act" data-act="edit" data-id="' + id + '">' +
        esc(currentRole === 'nurse' ? patViewTr('patient.btnClinicTag') : patViewTr('patient.btnEdit')) +
        '</button></div>';
}

function patViewBananaPanelHtml(p) {
    var idx = (typeof patientDirBananaIndexValue === 'function')
        ? patientDirBananaIndexValue(p) : null;
    var notes = (typeof patientDirBananaNotesText === 'function')
        ? patientDirBananaNotesText(p) : String(p.banana_notes || '').trim();
    if (idx == null && !notes) {
        return '<div class="pat-view-banana pat-view-banana--empty">' +
            '<span class="pat-view-banana-ico">🍌</span>' +
            '<span>' + esc(patViewTr('patient.view.bananaEmpty')) + '</span></div>';
    }
    return '<div class="pat-view-banana">' +
        '<div class="pat-view-banana-head">' +
        '<span class="pat-view-banana-ico">🍌</span>' +
        '<span class="pat-view-banana-idx">' + esc(String(idx != null ? idx : '—')) + '</span>' +
        '<button type="button" class="pat-view-banana-edit" data-act="banana" data-id="' + esc(p.id) + '">' +
        esc(patViewTr('patient.view.editBanana')) + '</button></div>' +
        (notes ? '<div class="pat-view-banana-notes">' + esc(notes) + '</div>' : '') +
        '</div>';
}

function patViewFetchFullPatient(pid, done) {
    if (!pid || !SB) { if (done) done(null); return; }
    SB.from('patients').select('*').eq('id', pid).single()
        .then(function (r) {
            if (r.error || !r.data) {
                if (done) done(null);
                return;
            }
            done(r.data);
        })
        .catch(function () { if (done) done(null); });
}

function patViewDlRow(label, val) {
    var v = String(val || '').trim();
    return '<div class="pat-view-dl-row"><dt>' + esc(label) + '</dt><dd>' +
        (v ? esc(v) : '<span class="pat-view-muted">—</span>') + '</dd></div>';
}

function patViewComputeBalance(bills) {
    var t = 0;
    (bills || []).forEach(function (b) {
        if (!b || b.voided_at) return;
        var x = parseFloat(b.balance);
        if (isFinite(x) && x > 0.005) t += x;
    });
    return t;
}

function patViewSafeRows(promise) {
    return promise.then(function (r) {
        if (r && r.error) return [];
        return (r && r.data) ? r.data : [];
    }).catch(function () { return []; });
}

function patViewLoadDashboard() {
    var host = g('patientDashboardHost');
    if (!host) return;
    if (!selPatientId) {
        host.innerHTML = patViewEmptyHtml('patient.view.selectPatient');
        patViewWireHostActions(host);
        return;
    }
    var loadSeq = ++patientDashLoadSeq;
    host.innerHTML = '<p class="pat-view-loading">' + esc(patViewTr('patient.view.loading')) + '</p>';

    var pid = selPatientId;
    var pno = (_patientDetailsPatient && _patientDetailsPatient.patient_no)
        ? String(_patientDetailsPatient.patient_no).trim() : '';

    Promise.all([
        new Promise(function (res) {
            patViewFetchFullPatient(pid, function (p) { res(p); });
        }),
        patViewSafeRows(SB.from('appointments').select(
            'id,date,start_time,bill_status,treatment_items,remarks,doctor_code,dentist_name'
        ).eq('patient_id', pid).order('date', { ascending: false }).limit(40)),
        patViewSafeRows(SB.from('treatments').select('id,notes,created_at,dentist_name')
            .eq('patient_id', pid).order('created_at', { ascending: false }).limit(25)),
        patViewSafeRows(SB.from('bills').select('id,total,balance,voided_at,created_at,bill_date')
            .eq('patient_id', pid).order('created_at', { ascending: false }).limit(50)),
        patViewSafeRows(SB.from('photos').select('id,file_name,storage_path,taken_date,created_at,notes')
            .eq('patient_id', pid).order('created_at', { ascending: false }).limit(24)),
        patViewSafeRows(SB.from('patient_documents').select(
            'id,document_name,document_date,template_name,template_type,created_at'
        ).eq('patient_id', pid).order('created_at', { ascending: false }).limit(30)),
        patViewSafeRows(SB.from('drughistory').select('id,drug_name,prescribed_date,doctor_tag')
            .eq('patient_id', pid).order('prescribed_date', { ascending: false }).limit(20))
    ]).then(function (parts) {
        if (loadSeq !== patientDashLoadSeq) return;
        var p = parts[0];
        if (!p) {
            host.innerHTML = '<p class="pat-view-empty">' + esc(patViewTr('patient.alertCouldNotLoad')) + '</p>';
            return;
        }
        patientViewFullRecord = p;
        var appts = parts[1];
        var notes = parts[2];
        var bills = parts[3];
        if (!bills.length && pno) {
            return patViewSafeRows(
                SB.from('bills').select('id,total,balance,voided_at,created_at,bill_date')
                    .eq('patient_no', pno).order('created_at', { ascending: false }).limit(50)
            ).then(function (b2) {
                parts[3] = b2;
                return parts;
            });
        }
        return parts;
    }).then(function (parts) {
        if (!parts || loadSeq !== patientDashLoadSeq) return;
        patientDashData = {
            patient: parts[0],
            appts: parts[1],
            notes: parts[2],
            bills: parts[3],
            photos: parts[4],
            docs: parts[5],
            rx: parts[6]
        };
        patViewRenderDashboard(host, patientDashData);
    });
}

function patViewRenderDashboard(host, data) {
    var p = data.patient;
    var today = (typeof todayISO === 'function') ? todayISO() : '';
    var balance = patViewComputeBalance(data.bills);
    var balanceHtml = (typeof fmtHK === 'function') ? fmtHK(balance) : ('$' + balance.toFixed(2));
    var upcoming = (data.appts || []).filter(function (a) {
        return a && a.date && today && String(a.date) >= today;
    }).slice(0, 8);
    var pastAppts = (data.appts || []).filter(function (a) {
        return a && a.date && (!today || String(a.date) < today);
    }).slice(0, 8);

    host.innerHTML =
        '<div class="pat-dash">' +
        '<header class="pat-dash-hero">' +
        '<div class="pat-dash-hero-left">' + patViewNameHtml(p) + '</div>' +
        '<div class="pat-dash-hero-right">' + patViewActionsHtml(p) + '</div>' +
        '</header>' +
        '<div class="pat-dash-top-row">' +
        '<button type="button" class="pat-dash-balance-card' + (balance > 0.005 ? ' pat-dash-balance-card--due' : '') +
        '" data-act="bills" data-id="' + esc(p.id) + '">' +
        '<span class="pat-dash-balance-label">' + esc(patViewTr('patient.view.balanceDue')) + '</span>' +
        '<span class="pat-dash-balance-amt">' + esc(balanceHtml) + '</span>' +
        '<span class="pat-dash-balance-hint">' + esc(patViewTr('patient.view.balanceHint')) + '</span>' +
        '</button>' +
        '<div class="pat-dash-banana-wrap">' + patViewBananaPanelHtml(p) + '</div>' +
        (String(p.medical_alerts || '').trim()
            ? '<div class="pat-dash-alert-card"><span class="pat-dash-alert-label">' +
              esc(patViewTr('patient.th.alerts')) + '</span><p>' + esc(p.medical_alerts) + '</p></div>'
            : '') +
        (String(p.remarks || '').trim()
            ? '<div class="pat-dash-remarks-card"><span class="pat-dash-remarks-label">' +
              esc(patViewTr('patient.view.card.remarks')) + '</span><p>' + esc(p.remarks) + '</p></div>'
            : '') +
        '</div>' +
        '<div class="pat-dash-grid">' +
        patViewDashWidget(patViewTr('patient.view.widget.personal'),
            '<dl class="pat-view-dl pat-view-dl--compact">' +
            patViewDlRow(patViewTr('patient.th.dob'), patViewFmtDob(p.dob)) +
            patViewDlRow(patViewTr('patient.form.sex'), patViewSexLabel(p.sex)) +
            patViewDlRow(patViewTr('patient.th.phone'), p.phone_number) +
            patViewDlRow(patViewTr('patient.form.mobilePhone'), p.mobile_phone) +
            patViewDlRow(patViewTr('patient.form.email'), p.email) +
            patViewDlRow(patViewTr('patient.th.hkid'), p.hkid) +
            patViewDlRow(patViewTr('patient.th.insurance'), p.insurance_no) +
            patViewDlRow(patViewTr('patient.th.clinicTag'), p[PATIENT_CLINIC_TAG_FIELD]) +
            '</dl>') +
        patViewDashWidget(patViewTr('patient.view.widget.upcoming'),
            patViewApptListHtml(upcoming, true)) +
        patViewDashWidget(patViewTr('patient.view.widget.pastAppts'),
            patViewApptListHtml(pastAppts, false)) +
        patViewDashWidget(patViewTr('patient.view.widget.notes'),
            patViewNotesListHtml(data.notes)) +
        patViewDashWidget(patViewTr('patient.view.widget.medical'),
            '<dl class="pat-view-dl pat-view-dl--compact">' +
            patViewDlRow(patViewTr('patient.view.medHistory'), p.medical_history) +
            patViewDlRow(patViewTr('patient.view.medMeds'), p.current_medications) +
            patViewDlRow(patViewTr('patient.view.medAllergy'), p.allergy) +
            '</dl>') +
        patViewDashWidget(patViewTr('patient.view.widget.dental'),
            '<dl class="pat-view-dl pat-view-dl--compact">' +
            patViewDlRow(patViewTr('patient.view.denHistory'), p.dental_history) +
            patViewDlRow(patViewTr('patient.view.denHabits'), p.parafunctional_habits) +
            '</dl>') +
        patViewDashWidget(patViewTr('patient.view.widget.rx'),
            patViewRxListHtml(data.rx)) +
        patViewDashWidget(patViewTr('patient.view.widget.photos'),
            patViewPhotosGridHtml(data.photos), 'pat-dash-widget--wide') +
        patViewDashWidget(patViewTr('patient.view.widget.docs'),
            patViewDocsListHtml(data.docs), 'pat-dash-widget--wide') +
        '</div></div>';
    patViewWireHostActions(host);
}

function patViewDashWidget(title, body, extraCls) {
    return '<section class="pat-dash-widget ' + (extraCls || '') + '">' +
        '<h3 class="pat-dash-widget-title">' + esc(title) + '</h3>' +
        '<div class="pat-dash-widget-body">' + body + '</div></section>';
}

function patViewApptListHtml(rows, isFuture) {
    if (!rows || !rows.length) {
        return '<p class="pat-view-muted">' + esc(patViewTr('patient.view.none')) + '</p>';
    }
    return '<ul class="pat-dash-list">' + rows.map(function (a) {
        var time = a.start_time ? String(a.start_time).slice(0, 5) : '';
        var st = (typeof dispStatusLabel === 'function')
            ? dispStatusLabel(a.bill_status || 'Scheduled')
            : (a.bill_status || '');
        var sub = patViewApptSubline(a, isFuture);
        return '<li class="pat-dash-list-item' + (isFuture ? ' pat-dash-list-item--future' : '') + '">' +
            '<span class="pat-dash-list-date">' + esc(patViewFmtDate(a.date)) +
            (time ? ' · ' + esc(time) : '') + '</span>' +
            '<span class="pat-dash-list-badge">' + esc(st) + '</span>' +
            (sub ? '<span class="pat-dash-list-sub">' + esc(sub) + '</span>' : '') +
            '</li>';
    }).join('') + '</ul>';
}

function patViewNotesListHtml(rows) {
    if (!rows || !rows.length) {
        return '<p class="pat-view-muted">' + esc(patViewTr('patient.history.empty')) + '</p>';
    }
    var items = rows.slice(0, 12).map(function (t) {
        var body = patViewPlainNotes(t.notes);
        if (!body) return '';
        return '<li class="pat-dash-note-item">' +
            '<time>' + esc(patViewFmtDateTime(t.created_at)) + '</time>' +
            '<p>' + esc(patViewTruncate(body, 220)) + '</p></li>';
    }).filter(Boolean);
    if (!items.length) {
        return '<p class="pat-view-muted">' + esc(patViewTr('patient.history.empty')) + '</p>';
    }
    return '<ul class="pat-dash-notes">' + items.join('') + '</ul>';
}

function patViewRxListHtml(rows) {
    if (!rows || !rows.length) {
        return '<p class="pat-view-muted">' + esc(patViewTr('patient.view.none')) + '</p>';
    }
    return '<ul class="pat-dash-list">' + rows.map(function (r) {
        return '<li class="pat-dash-list-item">' +
            '<span class="pat-dash-list-date">' + esc(patViewFmtDate(r.prescribed_date)) + '</span>' +
            '<span class="pat-dash-list-sub">' + esc(r.drug_name || '—') + '</span></li>';
    }).join('') + '</ul>';
}

function patViewPhotosGridHtml(rows) {
    if (!rows || !rows.length) {
        return '<p class="pat-view-muted">' + esc(patViewTr('patient.view.noPhotos')) + '</p>';
    }
    return '<div class="pat-dash-photo-grid">' + rows.map(function (ph) {
        var url = patViewPhotoUrl(ph);
        var lbl = ph.taken_date || ph.file_name || '';
        if (url) {
            return '<figure class="pat-dash-photo-thumb">' +
                '<img src="' + esc(url) + '" alt="" loading="lazy">' +
                '<figcaption>' + esc(patViewFmtDate(lbl)) + '</figcaption></figure>';
        }
        return '<figure class="pat-dash-photo-thumb pat-dash-photo-thumb--placeholder">' +
            '<span>📷</span><figcaption>' + esc(patViewFmtDate(lbl)) + '</figcaption></figure>';
    }).join('') + '</div>';
}

function patViewDocsListHtml(rows) {
    if (!rows || !rows.length) {
        return '<p class="pat-view-muted">' + esc(patViewTr('patient.view.noDocs')) + '</p>';
    }
    return '<ul class="pat-dash-docs">' + rows.map(function (d) {
        return '<li class="pat-dash-doc-item">' +
            '<span class="pat-dash-doc-name">' + esc(d.document_name || d.template_name || '—') + '</span>' +
            '<span class="pat-dash-doc-meta">' + esc(patViewFmtDate(d.document_date || d.created_at)) +
            (d.template_type ? ' · ' + esc(d.template_type) : '') + '</span></li>';
    }).join('') + '</ul>';
}

function patViewTruncate(s, max) {
    s = String(s || '').trim();
    if (!s) return '';
    max = max || 200;
    return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/** Strip HTML, staff/doctor tags, and bracketed codes from note/remarks text for dashboard display. */
function patViewPlainNotes(notes) {
    var s;
    if (typeof conPtlPlainRemarks === 'function') {
        s = conPtlPlainRemarks(notes);
    } else {
        s = String(notes || '').trim();
        if (!s) return '';
        if (typeof stripStaffAuthorFromRemarks === 'function') {
            s = stripStaffAuthorFromRemarks(s);
        }
        if (typeof stripDoctorTagsFromRemarks === 'function') {
            s = stripDoctorTagsFromRemarks(s);
        }
        s = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (typeof stripDoctorTagPrefix === 'function') {
        s = stripDoctorTagPrefix(s);
    } else {
        s = String(s || '').replace(/^\[[^\]]+\]\s*/, '').trim();
    }
    return s;
}

function patViewApptSubline(a, isFuture) {
    a = a || {};
    var remarks = patViewPlainNotes(a.remarks);
    if (remarks) return patViewTruncate(remarks, 80);
    var tx = String(a.treatment_items || '').trim();
    if (!tx) {
        if (isFuture && typeof conPtlResolveApptDoctorLabel === 'function') {
            var drOnly = conPtlResolveApptDoctorLabel(a);
            return drOnly ? patViewTruncate(drOnly, 80) : '';
        }
        return '';
    }
    var drCode = String(a.doctor_code || '').trim();
    if (drCode && tx.toLowerCase() === drCode.toLowerCase()) {
        if (typeof conPtlResolveApptDoctorLabel === 'function') {
            var drLbl = conPtlResolveApptDoctorLabel(a);
            return drLbl ? patViewTruncate(drLbl, 80) : '';
        }
        return '';
    }
    return patViewTruncate(tx, 80);
}

function patViewOpenBills(p) {
    p = p || patientViewFullRecord || _patientDetailsPatient;
    if (!p || typeof openBillPanel !== 'function') return;
    if (typeof showOnly === 'function') showOnly('appointmentSection');
    setTimeout(function () {
        openBillPanel({
            id: null,
            patient_id: p.id,
            patient_name: p.full_name || '',
            patient_chinese_name: p.chinese_name || '',
            patient_no: p.patient_no || ''
        });
        if (typeof switchBillTab === 'function') switchBillTab(2);
    }, 80);
}

function patViewWireHostActions(host) {
    if (!host || host.dataset.patViewWired === '1') return;
    host.dataset.patViewWired = '1';
    host.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
        if (!btn || !host.contains(btn)) return;
        var act = btn.getAttribute('data-act');
        var id = btn.getAttribute('data-id') || selPatientId;
        if (act === 'goto-dir') {
            patViewSetMode('directory');
            return;
        }
        if (act === 'consult' && id && typeof openConForPatient === 'function') {
            openConForPatient(id);
            return;
        }
        if (act === 'notes' && id && typeof viewHistory === 'function') {
            viewHistory(id);
            return;
        }
        if (act === 'checkin' && id) {
            var row = (patientListCache || []).find(function (x) {
                return x && String(x.id) === String(id);
            }) || patientViewFullRecord;
            if (row && typeof checkInPatientFromRecord === 'function') {
                checkInPatientFromRecord(row);
            }
            return;
        }
        if (act === 'edit' && id && typeof openEditPatient === 'function') {
            openEditPatient(id);
            return;
        }
        if (act === 'banana' && id && typeof openPatientDirBananaPanel === 'function') {
            openPatientDirBananaPanel(id);
            return;
        }
        if (act === 'bills') {
            patViewOpenBills(patientViewFullRecord);
        }
    });
}

function patientViewOnActiveChange(p) {
    if (patientViewMode === 'dashboard') patViewLoadDashboard();
}

function initPatientViews() {
    patViewLoadMode();
    document.querySelectorAll('.patient-view-btn').forEach(function (btn) {
        if (btn.dataset.patViewBound === '1') return;
        btn.dataset.patViewBound = '1';
        btn.addEventListener('click', function () {
            patViewSetMode(btn.getAttribute('data-pview') || 'directory');
        });
    });
    var dashHost = g('patientDashboardHost');
    if (dashHost) patViewWireHostActions(dashHost);
    patViewSetMode(patientViewMode, { skipScroll: true });
}

function refreshPatientViewsI18n() {
    if (patientViewMode === 'dashboard' && patientDashData) {
        var host = g('patientDashboardHost');
        if (host) patViewRenderDashboard(host, patientDashData);
    }
}

document.addEventListener('DOMContentLoaded', function () {
    initPatientViews();
});

document.addEventListener('app-lang-change', function () {
    if (typeof refreshPatientViewsI18n === 'function') refreshPatientViewsI18n();
});
