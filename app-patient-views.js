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
    if (typeof formatDobAge === 'function') return formatDobAge(dob);
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
    if (!record) return '';
    // Prefer the pre-computed public_url stored in the DB row
    if (record.public_url) return record.public_url;
    // Delegate to the shared helper when available (adds cache-busting token)
    if (typeof photoDisplayUrl === 'function') return photoDisplayUrl(record);
    // Last resort: derive from storage path
    var path = record.file_path || record.storage_path || '';
    if (!path || !SB) return '';
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
        '<button type="button" class="btn-add pat-view-act" data-act="plusappt" data-id="' + id + '">' +
        esc(patViewTr('appt.plusAppt.addBtn')) + '</button>' +
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

function patViewResolveActivePatient() {
    if (patientViewFullRecord && patientViewFullRecord.id) return patientViewFullRecord;
    if (typeof _patientDetailsPatient !== 'undefined' && _patientDetailsPatient && _patientDetailsPatient.id) {
        return _patientDetailsPatient;
    }
    if (typeof selPatientId !== 'undefined' && selPatientId) {
        return (patientListCache || []).find(function (x) {
            return x && String(x.id) === String(selPatientId);
        }) || null;
    }
    return null;
}

function patViewOpenPlusAppt(patientRecord) {
    if (typeof guardModuleByPermission === 'function' &&
        !guardModuleByPermission('appointment')) return;
    var p = patientRecord || patViewResolveActivePatient();
    if (typeof openPlusApptForPatient === 'function') {
        openPlusApptForPatient(p);
        return;
    }
    if (typeof showOnly === 'function') showOnly('appointmentSection');
    if (typeof initAppt === 'function') initAppt();
    setTimeout(function () {
        if (typeof switchApptTab === 'function') switchApptTab('plusappt');
    }, 60);
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

/**
 * Re-fetch bill balances from Supabase and update the balance card in the
 * patient dashboard without triggering a full dashboard reload.
 * Called when a bill or payment event is detected.
 */
function patDashRefreshBalance() {
    var card = g('patDashBalanceCard');
    var amtEl = g('patDashBalanceAmt');
    if (!card || !amtEl) return;
    var pid = card.dataset.patientId || (selPatientId || '');
    if (!pid) return;

    var pno = (_patientDetailsPatient && _patientDetailsPatient.patient_no)
        ? String(_patientDetailsPatient.patient_no).trim() : '';

    function applyBills(rows) {
        var t = 0;
        (rows || []).forEach(function (b) {
            if (!b || b.voided_at) return;
            var x = parseFloat(b.balance);
            if (isFinite(x) && x > 0.005) t += x;
        });
        if (patientDashData) patientDashData.bills = rows;
        var fmt = (typeof fmtHK === 'function') ? fmtHK(t) : ('$' + t.toFixed(2));
        amtEl.textContent = fmt;
        card.classList.toggle('pat-dash-balance-card--due', t > 0.005);
    }

    SB.from('bills').select('id,total,balance,voided_at,created_at,bill_date')
        .eq('patient_id', pid).order('created_at', { ascending: false }).limit(300)
    .then(function (r) {
        var rows = (!r.error && r.data) ? r.data : [];
        if (!rows.length && pno) {
            return SB.from('bills').select('id,total,balance,voided_at,created_at,bill_date')
                .eq('patient_no', pno).order('created_at', { ascending: false }).limit(300)
            .then(function (r2) { applyBills((!r2.error && r2.data) ? r2.data : []); });
        }
        applyBills(rows);
    })
    .catch(function () {});
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
            .eq('patient_id', pid).order('created_at', { ascending: false }).limit(300)),
        patViewSafeRows(SB.from('photos').select('id,file_path,public_url,category,caption,taken_date,created_at')
            .eq('patient_id', pid).order('taken_date', { ascending: false })
            .order('created_at', { ascending: false }).limit(24)),
        patViewSafeRows(SB.from('patient_documents').select(
            'id,document_name,document_date,template_name,template_type,created_at'
        ).eq('patient_id', pid).order('created_at', { ascending: false }).limit(30)),
        patViewSafeRows(SB.from('drughistory').select('id,drug_name,prescribed_date,doctor_tag')
            .eq('patient_id', pid).order('prescribed_date', { ascending: false }).limit(20)),
        patViewSafeRows(SB.from('xrays').select(
            'id,xray_type,taken_date,notes,file_name,file_url,created_at'
        ).eq('patient_id', pid).order('taken_date', { ascending: false })
            .order('created_at', { ascending: false }).limit(24))
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
                    .eq('patient_no', pno).order('created_at', { ascending: false }).limit(300)
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
            rx: parts[6],
            xrays: parts[7] || []
        };
        patViewRenderDashboard(host, patientDashData);
        patDashLoadTimeline(pid);
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
        '<button type="button" id="patDashBalanceCard" class="pat-dash-balance-card' +
        (balance > 0.005 ? ' pat-dash-balance-card--due' : '') +
        '" data-act="bills" data-id="' + esc(p.id) + '" data-patient-id="' + esc(p.id) + '">' +
        '<span class="pat-dash-balance-label">' + esc(patViewTr('patient.view.balanceDue')) + '</span>' +
        '<span id="patDashBalanceAmt" class="pat-dash-balance-amt">' + esc(balanceHtml) + '</span>' +
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
        patViewDashWidget(patViewTr('patient.view.widget.xrays'),
            patViewXraysGridHtml(data.xrays), 'pat-dash-widget--wide') +
        '</div>' +
        '<section class="pat-dash-widget pat-dash-widget--full">' +
        '<h3 class="pat-dash-widget-title">' + esc(patViewTr('patient.view.widget.timeline')) + '</h3>' +
        '<div id="patDashTimelineHost" class="pat-dash-timeline-host">' +
        '<p class="pat-view-muted">' + esc(patViewTr('patient.view.loading') || 'Loading…') + '</p>' +
        '</div></section>' +
        '</div>';
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
        var dateLbl = patViewFmtDate(ph.taken_date || ph.created_at || '');
        var subLbl = ph.caption || ph.category || '';
        var figcap = dateLbl + (subLbl ? ' · ' + subLbl : '');
        if (url) {
            return '<figure class="pat-dash-photo-thumb">' +
                '<img src="' + esc(url) + '" alt="" loading="lazy">' +
                '<figcaption>' + esc(figcap) + '</figcaption></figure>';
        }
        return '<figure class="pat-dash-photo-thumb pat-dash-photo-thumb--placeholder">' +
            '<span>📷</span><figcaption>' + esc(figcap) + '</figcaption></figure>';
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

function patViewXraysGridHtml(rows) {
    if (!rows || !rows.length) {
        return '<p class="pat-view-muted">' + esc(patViewTr('patient.view.noXrays')) + '</p>';
    }
    return '<div class="pat-dash-xray-grid">' + rows.map(function (x) {
        var date = x.taken_date ? patViewFmtDate(x.taken_date) : patViewFmtDate(x.created_at);
        var type = String(x.xray_type || '—');
        var notes = x.notes ? patViewTruncate(x.notes, 80) : '';
        var url   = String(x.file_url || '').trim();
        var media = url
            ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' +
              '<img src="' + esc(url) + '" alt="" loading="lazy"></a>'
            : '<span class="pat-dash-xray-icon">🦷</span>';
        return '<figure class="pat-dash-xray-thumb">' + media +
            '<figcaption>' +
            '<strong>' + esc(type) + '</strong>' +
            (date ? '<span>' + esc(date) + '</span>' : '') +
            (notes ? '<em>' + esc(notes) + '</em>' : '') +
            '</figcaption></figure>';
    }).join('') + '</div>';
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
        if (act === 'plusappt') {
            var plusRow = (patientListCache || []).find(function (x) {
                return x && String(x.id) === String(id);
            }) || patientViewFullRecord;
            patViewOpenPlusAppt(plusRow);
            return;
        }
        if (act === 'consult' && id && typeof openConForPatient === 'function') {
            openConForPatient(id);
            return;
        }
        if (act === 'notes' && id) {
            if (typeof openConForPatient === 'function') {
                openConForPatient(id);
            } else if (typeof viewHistory === 'function') {
                viewHistory(id);
            }
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

// ─── Patient Dashboard: Timeline widget ───────────────────────────────────────
function patDashLoadTimeline(pid) {
    var host = g('patDashTimelineHost');
    if (!host || !pid) return;

    function safeRows(q) {
        return q.then(function (r) { return (r && !r.error && r.data) ? r.data : []; })
                .catch(function () { return []; });
    }

    var pno = (_patientDetailsPatient && _patientDetailsPatient.patient_no)
        ? String(_patientDetailsPatient.patient_no).trim() : '';

    Promise.all([
        safeRows(SB.from('treatments').select('*').eq('patient_id', pid)
            .order('created_at', { ascending: false }).limit(200)),
        safeRows(SB.from('drughistory').select('*').eq('patient_id', pid)
            .order('prescribed_date', { ascending: false }).limit(100)),
        safeRows(SB.from('appointments').select(
            'id,date,start_time,end_time,bill_status,treatment_items,remarks,' +
            'dentist_name,doctor_name,doctor_code,created_at'
        ).eq('patient_id', pid).order('date', { ascending: false }).limit(150)),
        safeRows(SB.from('bills').select('id,total,balance,voided_at,created_at,appointment_id')
            .eq('patient_id', pid).order('created_at', { ascending: false }).limit(120)),
        safeRows(SB.from('patient_documents').select(
            'id,document_name,document_date,template_name,template_type,created_at'
        ).eq('patient_id', pid).order('created_at', { ascending: false }).limit(80)),
        safeRows(SB.from('xrays').select('id,xray_type,taken_date,notes,file_name,created_at')
            .eq('patient_id', pid).order('created_at', { ascending: false }).limit(80)),
        safeRows(SB.from('photos').select('id,file_path,public_url,category,caption,taken_date,created_at')
            .eq('patient_id', pid).order('taken_date', { ascending: false })
            .order('created_at', { ascending: false }).limit(80))
    ]).then(function (parts) {
        var bills = parts[3];
        if (!bills.length && pno) {
            return safeRows(SB.from('bills').select('id,total,balance,voided_at,created_at,appointment_id')
                .eq('patient_no', pno).order('created_at', { ascending: false }).limit(120)
            ).then(function (b2) { parts[3] = b2; return parts; });
        }
        return parts;
    }).then(function (parts) {
        var bills2  = parts[3] || [];
        var appts2  = parts[2] || [];
        var billIds = bills2.map(function (b) { return b && b.id; }).filter(Boolean);
        var apptIds = appts2.map(function (a) { return a && a.id; }).filter(Boolean);
        var qPay = billIds.length
            ? safeRows(SB.from('bill_payments').select('*').in('bill_id', billIds)
                .order('paid_date', { ascending: false })
                .order('created_at', { ascending: false }).limit(200))
            : Promise.resolve([]);
        var qTask = apptIds.length
            ? safeRows(SB.from('appointment_task_states')
                .select('appointment_id,lab_status,recall_status,created_at,updated_at')
                .in('appointment_id', apptIds))
            : Promise.resolve([]);
        return Promise.all([Promise.resolve(parts), qPay, qTask]);
    }).then(function (bundle) {
        var parts    = bundle[0];
        var payments = bundle[1] || [];
        var tasks    = bundle[2] || [];
        var billMap  = {};
        (parts[3] || []).forEach(function (b) { if (b && b.id) billMap[String(b.id)] = b; });
        var apptMap  = {};
        (parts[2] || []).forEach(function (a) { if (a && a.id) apptMap[String(a.id)] = a; });

        var events = [];
        if (typeof conPtlMergeEvents === 'function') {
            events = conPtlMergeEvents([
                typeof conPtlEventsFromNotes    === 'function' ? conPtlEventsFromNotes(parts[0])              : [],
                typeof conPtlEventsFromRx       === 'function' ? conPtlEventsFromRx(parts[1])                 : [],
                typeof conPtlEventsFromVisits   === 'function' ? conPtlEventsFromVisits(parts[2])             : [],
                typeof conPtlEventsFromBills    === 'function' ? conPtlEventsFromBills(parts[3])              : [],
                typeof conPtlEventsFromDocs     === 'function' ? conPtlEventsFromDocs(parts[4])               : [],
                typeof conPtlEventsFromXrays    === 'function' ? conPtlEventsFromXrays(parts[5])              : [],
                typeof conPtlEventsFromPhotos   === 'function' ? conPtlEventsFromPhotos(parts[6])             : [],
                typeof conPtlEventsFromPayments === 'function' ? conPtlEventsFromPayments(payments, billMap)  : [],
                typeof conPtlEventsFromTasks    === 'function' ? conPtlEventsFromTasks(tasks, apptMap)        : []
            ]);
        }
        patDashRenderTimeline(host, events);
    }).catch(function () {
        if (host) host.innerHTML =
            '<p class="pat-view-muted">' + esc(patViewTr('patient.view.none')) + '</p>';
    });
}

function patDashRenderTimeline(host, events) {
    if (!host) return;
    if (!events || !events.length) {
        host.innerHTML = '<p class="pat-view-muted">' + esc(patViewTr('patient.view.none')) + '</p>';
        return;
    }

    var fmtDay = typeof conPtlFormatDay  === 'function' ? conPtlFormatDay  : function (ts) {
        return new Date(ts).toLocaleDateString();
    };
    var fmtTime = typeof conPtlFormatTime === 'function' ? conPtlFormatTime : function (ts) {
        return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    function actionLabel(ev) {
        if (typeof conTr !== 'function') return '→';
        if (ev.action === 'visit')  return conTr('con.ptl.actionVisit');
        if (ev.action === 'bill')   return conTr('con.ptl.actionBill');
        if (ev.action === 'rx')     return conTr('con.ptl.actionRx');
        if (ev.action === 'photo')  return conTr('con.ptl.actionPhoto');
        if (ev.action === 'xray')   return conTr('con.ptl.actionXray');
        if (ev.action === 'doc')    return conTr('con.ptl.actionDoc');
        return conTr('con.ptl.actionOpen');
    }

    var html = '<div class="pat-dash-timeline-count">' +
        esc(events.length + ' event' + (events.length !== 1 ? 's' : '')) +
        '</div>';
    var lastDay = '';

    events.forEach(function (ev, idx) {
        var day = fmtDay(ev.ts);
        if (day !== lastDay) {
            if (lastDay) html += '</ul>';
            lastDay = day;
            html += '<div class="con-ptl-day">' + esc(day) + '</div>' +
                    '<ul class="con-ptl-list">';
        }
        var evCls    = 'con-ptl-event con-ptl-event--' + esc(ev.kind || 'visit');
        var headline = String(ev.headline || '').trim();
        var detail   = String(ev.detail || ev.body || '').trim();
        html += '<li class="' + evCls + '" data-ptl-idx="' + idx + '" style="cursor:pointer;">' +
            '<div class="con-ptl-event-head">' +
            '<span class="con-ptl-event-type">' + esc(ev.title || ev.kind || '') + '</span>' +
            '<span class="con-ptl-event-time">' + esc(fmtTime(ev.ts)) + '</span>' +
            '</div>' +
            (headline ? '<div class="con-ptl-event-title">' + esc(headline) + '</div>' : '') +
            (detail   ? '<div class="con-ptl-event-body">'  + esc(detail)   + '</div>' : '') +
            '<div class="con-ptl-event-meta">' +
            '<button type="button" class="con-ptl-event-jump" data-ptl-open="' + idx + '">' +
                esc(actionLabel(ev)) +
            '</button>' +
            '</div>' +
            '</li>';
    });
    if (lastDay) html += '</ul>';

    host.innerHTML = html;

    host.querySelectorAll('.con-ptl-event').forEach(function (el) {
        el.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest('button')) return;
            var idx = parseInt(el.getAttribute('data-ptl-idx'), 10);
            if (!isNaN(idx) && events[idx]) patDashPtlOpenEvent(events[idx]);
        });
    });
    host.querySelectorAll('[data-ptl-open]').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var idx = parseInt(btn.getAttribute('data-ptl-open'), 10);
            if (!isNaN(idx) && events[idx]) patDashPtlOpenEvent(events[idx]);
        });
    });
}

function patDashPtlOpenEvent(ev) {
    if (!ev) return;
    var pid = selPatientId || (_patientDetailsPatient && _patientDetailsPatient.id);

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
                    }
                });
            return;
        }
        return;
    }

    if (!pid || typeof openConForPatient !== 'function') return;

    if (ev.action === 'notes') {
        openConForPatient(pid);
        setTimeout(function () {
            if (typeof switchConTnSubtab === 'function') switchConTnSubtab('notes');
        }, 150);
        return;
    }

    if (ev.action === 'rx') {
        openConForPatient(pid);
        setTimeout(function () {
            if (typeof switchConTnSubtab === 'function') switchConTnSubtab('notes');
            setTimeout(function () {
                var wrap = g('drugHistoryWrap');
                if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 250);
        }, 150);
        return;
    }

    if (ev.action === 'doc') {
        openConForPatient(pid);
        setTimeout(function () {
            if (typeof switchConTab === 'function') switchConTab('forms');
            if (ev.refId && typeof openConFormsDoc === 'function') {
                setTimeout(function () { openConFormsDoc(ev.refId); }, 150);
            }
        }, 150);
        return;
    }

    if (ev.action === 'xray') {
        openConForPatient(pid);
        setTimeout(function () {
            if (typeof switchConTab === 'function') switchConTab('xrays');
        }, 150);
        return;
    }

    if (ev.action === 'photo') {
        openConForPatient(pid);
        setTimeout(function () {
            if (typeof switchConTab === 'function') switchConTab('photos');
            setTimeout(function () {
                if (typeof refreshPhotos === 'function') refreshPhotos();
            }, 80);
        }, 150);
        return;
    }

    // Fallback: open consultation treatment tab
    openConForPatient(pid);
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
    var plusApptBtn = g('patientPlusApptBtn');
    if (plusApptBtn && plusApptBtn.dataset.patPlusApptBound !== '1') {
        plusApptBtn.dataset.patPlusApptBound = '1';
        plusApptBtn.addEventListener('click', function () {
            patViewOpenPlusAppt();
        });
    }
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

// Refresh the balance card whenever a bill or payment changes
document.addEventListener('consultation-ar-refresh', function () {
    patDashRefreshBalance();
});
document.addEventListener('pat-dash-balance-refresh', function () {
    patDashRefreshBalance();
});
