// ════════════════════════════════════════════════════════════════
// app-webbook.js — Online booking management panel (staff)
// Requires: SB, app.js globals, app-appt.js modals
// ════════════════════════════════════════════════════════════════

var WEBBOOK = (function () {

    var _rows = [];
    var _selId = null;
    var _bound = false;
    var _loading = false;
    var _loadSeq = 0;
    var _activeClinicTag = '';

    var TYPE_FILTERS = {
        new_patient: true,
        existing_patient: true,
        recall: true,
        asap: true
    };

    function g(id) { return document.getElementById(id); }

    function tr(key, fallback) {
        if (typeof t === 'function') {
            var v = t(key);
            if (v && v !== key) return v;
        }
        return fallback || key;
    }

    function trRepl(key, vars, fallback) {
        var s = tr(key, fallback);
        if (vars) {
            Object.keys(vars).forEach(function (k) {
                s = s.split('{' + k + '}').join(String(vars[k]));
            });
        }
        return s;
    }

    function esc(s) {
        if (typeof window.esc === 'function') return window.esc(s);
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function todayIso() {
        if (typeof window.todayISO === 'function') return window.todayISO();
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function daysAgoIso(n) {
        var d = new Date();
        d.setDate(d.getDate() - n);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
            String(d.getDate()).padStart(2, '0');
    }

    function fmtDateTime(iso) {
        if (!iso) return '—';
        try {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
            var loc = (typeof apptDateLocale === 'function') ? apptDateLocale() : undefined;
            return d.toLocaleString(loc, {
                year: '2-digit', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (e) {
            return String(iso).slice(0, 16);
        }
    }

    function fmt12(time) {
        if (typeof window.fmt12 === 'function') return window.fmt12(time);
        if (!time) return '—';
        var p = String(time).slice(0, 5).split(':');
        var h = parseInt(p[0], 10);
        var m = p[1] || '00';
        var ap = h >= 12 ? 'PM' : 'AM';
        return (h % 12 || 12) + ':' + m + ' ' + ap;
    }

    function clinicLabel(tag) {
        if (!tag) return '—';
        if (typeof APP_CLINICS !== 'undefined' && APP_CLINICS.length) {
            var c = APP_CLINICS.find(function (x) {
                return String(x.clinic_code || '').trim() === String(tag).trim();
            });
            if (c) return c.english_name || c.clinic_code || tag;
        }
        return tag;
    }

    function statusLabel(st) {
        var map = {
            pending_otp: tr('webbook.status.pendingOtp', 'Awaiting verification'),
            pending_staff: tr('webbook.status.pendingStaff', 'Created from Web'),
            pending_arrange: tr('webbook.status.pendingArrange', 'Arrange by front desk'),
            confirmed: tr('webbook.status.confirmed', 'Confirmed'),
            cancelled: tr('webbook.status.cancelled', 'Cancelled'),
            expired: tr('webbook.status.expired', 'Expired')
        };
        return map[String(st || '').toLowerCase()] || st || '—';
    }

    function statusStyle(st) {
        var s = String(st || '').toLowerCase();
        if (s === 'pending_staff') return 'background:#dbeafe;color:#1d4ed8;';
        if (s === 'pending_arrange') return 'background:#ffedd5;color:#c2410c;';
        if (s === 'pending_otp') return 'background:#fef3c7;color:#92400e;';
        if (s === 'confirmed') return 'background:#dcfce7;color:#166534;';
        if (s === 'cancelled' || s === 'expired') return 'background:#f1f5f9;color:#64748b;';
        return 'background:#e2e8f0;color:#475569;';
    }

    function typeLabel(tp) {
        var map = {
            new_patient: tr('webbook.type.new', 'New patient'),
            existing_patient: tr('webbook.type.existing', 'Existing patient'),
            recall: tr('webbook.type.recall', 'Recall'),
            asap: tr('webbook.type.asap', 'ASAP')
        };
        return map[String(tp || '').toLowerCase()] || tp || '—';
    }

    function isWebBooking(a) {
        if (!a) return false;
        if (String(a.booking_source || '').toLowerCase() === 'web') return true;
        return /\[WEB\]|WEB ref:/i.test(String(a.remarks || ''));
    }

    function effectiveStatus(a) {
        if (a.booking_status) return a.booking_status;
        if (isWebBooking(a)) return 'pending_staff';
        return '';
    }

    function effectiveCreated(a) {
        return a.web_created_at || a.created_at || '';
    }

    function patientDobDisplay(a) {
        if (a.patient_dob) return String(a.patient_dob).slice(0, 10);
        return '—';
    }

    function patientNameDisplay(a) {
        var cn = (a.patient_chinese_name || '').trim();
        var en = (a.patient_name || '').trim();
        if (cn && en) return cn + ' · ' + en;
        return cn || en || '—';
    }

    function phoneForRow(a) {
        return a.walk_in_phone || a._walkin_phone || '';
    }

    function phoneDisplay(a) {
        var ph = String(phoneForRow(a) || '').replace(/\D/g, '');
        if (!ph) return '';
        if (ph.indexOf('852') === 0 && ph.length === 11) {
            return '+852 ' + ph.slice(3, 7) + ' ' + ph.slice(7);
        }
        if (ph.length === 8) return ph.slice(0, 4) + ' ' + ph.slice(4);
        return ph;
    }

    function isArrangeRequest(a) {
        if (!a) return false;
        if (String(a.booking_status || '').toLowerCase() === 'pending_arrange') return true;
        return String(a.start_time || '').slice(0, 5) === '00:00' &&
            String(a.booking_source || '').toLowerCase() === 'web';
    }

    function apptTimeDisplay(a) {
        if (isArrangeRequest(a)) {
            var sess = String(a.web_preferred_session || '').toLowerCase();
            var tbc = tr('webbook.timeTbc', 'Time TBC');
            if (sess === 'am' || sess === 'pm' || sess === 'night') {
                return tbc + ' · ' + tr('webbook.sess.' + sess, sess.toUpperCase());
            }
            return tbc;
        }
        return fmt12(a.start_time);
    }

    function phoneTelHref(a) {
        var ph = String(phoneForRow(a) || '').replace(/\D/g, '');
        if (!ph) return '';
        if (ph.length === 8) return '+852' + ph;
        if (ph.indexOf('852') === 0) return '+' + ph;
        return '+' + ph;
    }

    function filterRows() {
        var fromEl = g('wbFilterFrom');
        var toEl = g('wbFilterTo');
        var statusEl = g('wbFilterStatus');
        var from = fromEl ? fromEl.value : '';
        var to = toEl ? toEl.value : '';
        var status = statusEl ? statusEl.value : 'all';

        return _rows.filter(function (a) {
            var tp = String(a.booking_type || 'new_patient').toLowerCase();
            if (!TYPE_FILTERS[tp] && TYPE_FILTERS.hasOwnProperty(tp)) return false;
            if (tp === 'new_patient' && !a.patient_id && TYPE_FILTERS.new_patient === false) return false;

            if (status !== 'all') {
                if (effectiveStatus(a) !== status) return false;
            }
            var created = effectiveCreated(a);
            if (from && created && created.slice(0, 10) < from) return false;
            if (to && created && created.slice(0, 10) > to) return false;
            return true;
        });
    }

    function activeClinicTag() {
        if (typeof currentClinicCodeForTagging === 'function') {
            return String(currentClinicCodeForTagging() || '').trim();
        }
        return '';
    }

    function clinicScopeLabel() {
        var tag = activeClinicTag();
        if (!tag) return tr('webbook.clinicAll', 'All clinics');
        return clinicLabel(tag);
    }

    function applyClinicScope(builder) {
        if (!builder) return builder;
        var tag = activeClinicTag();
        _activeClinicTag = tag;
        if (!tag) return builder;
        var field = typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined'
            ? APPOINTMENT_CLINIC_TAG_FIELD
            : 'clinic_tag';
        return builder.or(field + '.eq.' + tag + ',' + field + '.is.null');
    }

    function syncTabFiltersForActiveClinic() {
        var from = g('wbFilterFrom');
        var to = g('wbFilterTo');
        var statusEl = g('wbFilterStatus');
        if (from) from.value = daysAgoIso(90);
        if (to) to.value = '';
        if (statusEl) statusEl.value = 'all';
    }

    function updateClinicScopeLbl() {
        var lbl = g('wbClinicScopeLbl');
        if (!lbl) return;
        lbl.textContent = trRepl('webbook.clinicScope', { CLINIC: clinicScopeLabel() },
            'Showing web bookings for: ' + clinicScopeLabel());
    }

    function loadList(opts) {
        opts = opts || {};
        var seq = ++_loadSeq;
        if (!opts.soft) _loading = true;
        var tbody = g('wbTableBody');
        if (tbody && !opts.soft) {
            tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#64748b;">' +
                esc(tr('webbook.loading', 'Loading…')) + '</td></tr>';
        }

        var fromEl = g('wbFilterFrom');
        var toEl = g('wbFilterTo');
        var from = fromEl && fromEl.value ? fromEl.value : daysAgoIso(90);
        var to = toEl && toEl.value ? toEl.value : '';

        var q = SB.from('appointments').select('*');
        q = q.eq('booking_source', 'web');
        if (from) q = q.gte('web_created_at', from + 'T00:00:00');
        if (to) q = q.lte('web_created_at', to + 'T23:59:59');
        q = applyClinicScope(q);
        q = q.order('web_created_at', { ascending: false });

        q.then(function (r) {
            if (seq !== _loadSeq) return;
            _loading = false;
            if (r.error) {
                if ((r.error.message || '').indexOf('booking_source') >= 0) {
                    loadListLegacy(from, to, opts, seq);
                    return;
                }
                if (tbody) {
                    tbody.innerHTML = '<tr><td colspan="8" style="color:#b91c1c;padding:16px;">' +
                        esc(r.error.message) + '</td></tr>';
                }
                return;
            }
            _rows = r.data || [];
            if (_selId && !_rows.some(function (x) { return String(x.id) === String(_selId); })) {
                _selId = null;
            }
            updateClinicScopeLbl();
            renderTable();
            refreshTabBadge();
        }).catch(function () {
            if (seq !== _loadSeq) return;
            _loading = false;
        });
    }

    function loadListLegacy(from, to, opts, seq) {
        var q2 = SB.from('appointments').select('*');
        q2 = q2.or('remarks.ilike.%WEB ref:%,remarks.ilike.%[WEB]%');
        if (from) q2 = q2.gte('date', from);
        if (to) q2 = q2.lte('date', to);
        q2 = applyClinicScope(q2);
        q2 = q2.order('date', { ascending: false });
        q2.then(function (r2) {
            if (seq && seq !== _loadSeq) return;
            _loading = false;
            _rows = (r2.data || []).filter(isWebBooking);
            if (_selId && !_rows.some(function (x) { return String(x.id) === String(_selId); })) {
                _selId = null;
            }
            updateClinicScopeLbl();
            renderTable();
            refreshTabBadge();
        }).catch(function () {
            if (seq && seq !== _loadSeq) return;
            _loading = false;
        });
    }

    function renderTable() {
        var tbody = g('wbTableBody');
        if (!tbody) return;
        var list = filterRows();
        var cnt = g('wbCountLbl');
        if (cnt) {
            cnt.textContent = trRepl('webbook.count', { N: list.length }, list.length + ' booking(s)');
        }

        if (!list.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="wb-empty">' +
                esc(tr('webbook.empty', 'No web bookings in this period.')) + '</td></tr>';
            renderActionBar(null);
            return;
        }

        var html = '';
        list.forEach(function (a) {
            var id = String(a.id);
            var sel = _selId === id;
            var st = effectiveStatus(a);
            var ph = phoneDisplay(a);
            var tel = phoneTelHref(a);
            html += '<tr class="wb-row' + (sel ? ' wb-row--sel' : '') + '" data-id="' + esc(id) + '">' +
                '<td>' + esc(clinicLabel(a.clinic_tag)) + '</td>' +
                '<td style="white-space:nowrap;font-size:12px;">' + esc(fmtDateTime(effectiveCreated(a))) + '</td>' +
                '<td style="white-space:nowrap;font-weight:600;">' + esc(a.date || '') + ' ' + esc(apptTimeDisplay(a)) + '</td>' +
                '<td>' + esc(patientNameDisplay(a)) +
                    (typeof apptWebBadgeHtml === 'function' ? apptWebBadgeHtml(a) : '') + '</td>' +
                '<td style="font-size:12px;white-space:nowrap;">' +
                    (ph && tel
                        ? '<a href="tel:' + esc(tel) + '" class="wb-phone-link" onclick="event.stopPropagation();">' + esc(ph) + '</a>'
                        : '—') + '</td>' +
                '<td style="font-size:12px;">' + esc(patientDobDisplay(a)) + '</td>' +
                '<td><span class="wb-status-pill" style="' + statusStyle(st) + '">' + esc(statusLabel(st)) + '</span></td>' +
                '<td style="font-size:12px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + esc(a.treatment_items || '') + '">' +
                    esc(a.treatment_items || '—') + '</td>' +
                '<td style="font-size:11px;color:#64748b;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' +
                    esc(typeLabel(a.booking_type)) + '</td>' +
                '</tr>';
        });
        tbody.innerHTML = html;

        tbody.querySelectorAll('.wb-row').forEach(function (tr) {
            tr.addEventListener('click', function () {
                _selId = tr.getAttribute('data-id');
                tbody.querySelectorAll('.wb-row').forEach(function (r) {
                    r.classList.toggle('wb-row--sel', r.getAttribute('data-id') === _selId);
                });
                var row = _rows.find(function (x) { return String(x.id) === _selId; });
                renderActionBar(row);
            });
            tr.addEventListener('dblclick', function () {
                _selId = tr.getAttribute('data-id');
                var row = _rows.find(function (x) { return String(x.id) === _selId; });
                if (row && typeof openApptEditModal === 'function') openApptEditModal(row);
            });
        });

        if (_selId) {
            var sel = _rows.find(function (x) { return String(x.id) === _selId; });
            renderActionBar(sel);
        }
    }

    function renderActionBar(row) {
        var bar = g('wbActionBar');
        var lbl = g('wbSelLbl');
        if (!bar) return;
        if (!row) {
            bar.style.display = 'none';
            if (lbl) lbl.textContent = tr('webbook.selectRow', 'Select a booking below');
            return;
        }
        bar.style.display = 'flex';
        if (lbl) {
            var phLbl = phoneDisplay(row);
            lbl.textContent = patientNameDisplay(row) +
                (phLbl ? ' · ' + phLbl : '') +
                ' · ' + (row.date || '') + ' ' + apptTimeDisplay(row);
        }

        var st = effectiveStatus(row);
        var btnConfirm = g('wbBtnConfirm');
        var btnCancel = g('wbBtnCancel');
        var btnReschedule = g('wbBtnReschedule');
        if (btnConfirm) {
            btnConfirm.style.display = (st === 'pending_staff' || st === 'pending_otp') ? '' : 'none';
        }
        if (btnReschedule && st === 'pending_arrange') {
            btnReschedule.classList.add('wb-act--primary');
            btnReschedule.title = tr('webbook.arrangeHint', 'Set a time, then confirm');
        } else if (btnReschedule) {
            btnReschedule.classList.remove('wb-act--primary');
            btnReschedule.title = '';
        }
        if (btnCancel) btnCancel.style.display = (st !== 'cancelled' && st !== 'expired') ? '' : 'none';
    }

    function selectedRow() {
        if (!_selId) return null;
        return _rows.find(function (x) { return String(x.id) === _selId; }) || null;
    }

    function patchRow(id, patch, done) {
        var tryPatch = function (p, legacy) {
            SB.from('appointments').update(p).eq('id', id).select('*')
                .then(function (r) {
                    if (r.error && !legacy && (r.error.message || '').indexOf('booking_status') >= 0) {
                        var p2 = Object.assign({}, p);
                        delete p2.booking_status;
                        delete p2.booking_source;
                        tryPatch(p2, true);
                        return;
                    }
                    if (r.error) {
                        alert(r.error.message);
                        if (done) done(false);
                        return;
                    }
                    var saved = r.data && r.data[0];
                    if (saved) {
                        var idx = _rows.findIndex(function (x) { return String(x.id) === String(id); });
                        if (idx >= 0) _rows[idx] = Object.assign({}, _rows[idx], saved);
                        if (typeof apptMergeSavedRowIntoCaches === 'function') {
                            apptMergeSavedRowIntoCaches(saved);
                        }
                    }
                    renderTable();
                    refreshTabBadge();
                    if (typeof loadToday === 'function') loadToday({ soft: true });
                    if (typeof loadQueue === 'function') loadQueue({ soft: true });
                    if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData({ soft: true });
                    if (done) done(true);
                });
        };
        tryPatch(patch, false);
    }

    function confirmSelected() {
        var row = selectedRow();
        if (!row) return;
        if (isArrangeRequest(row)) {
            alert(tr('webbook.arrangeConfirmBlock', 'Set an appointment time first (Reschedule), then confirm.'));
            if (typeof openApptEditModal === 'function') openApptEditModal(row);
            return;
        }
        if (!confirm(tr('webbook.confirmPrompt', 'Confirm this web booking?'))) return;
        patchRow(row.id, { booking_status: 'confirmed' }, function (ok) {
            if (ok && typeof showClinicRefreshToast === 'function') {
                showClinicRefreshToast(row.clinic_tag, false);
            }
        });
    }

    function cancelSelected() {
        var row = selectedRow();
        if (!row) return;
        if (!confirm(tr('webbook.cancelPrompt', 'Cancel this web booking?'))) return;
        patchRow(row.id, { booking_status: 'cancelled', bill_status: 'Cancelled' });
    }

    function rescheduleSelected() {
        var row = selectedRow();
        if (!row) return;
        if (typeof openApptEditModal === 'function') openApptEditModal(row);
    }

    function whatsappSelected() {
        var row = selectedRow();
        if (!row) return;
        var phone = phoneForRow(row);
        if (!phone && row.patient_id && typeof SB !== 'undefined') {
            SB.from('patients').select('phone_number,mobile_phone').eq('id', row.patient_id).maybeSingle()
                .then(function (r) {
                    if (r.data) {
                        phone = r.data.mobile_phone || r.data.phone_number || '';
                    }
                    sendWa(row, phone);
                });
            return;
        }
        sendWa(row, phone);
    }

    function sendWa(row, phone) {
        if (!phone) {
            alert(tr('webbook.noPhone', 'No phone number on file.'));
            return;
        }
        var msg = isArrangeRequest(row)
            ? trRepl('webbook.waMsgArrange', {
                NAME: row.patient_name || '',
                DATE: row.date || ''
            }, 'Hi ' + (row.patient_name || '') + ', regarding your appointment request on ' + (row.date || '') + '. Our team will contact you to arrange a time.')
            : trRepl('webbook.waMsg', {
                NAME: row.patient_name || '',
                DATE: row.date || '',
                TIME: fmt12(row.start_time)
            }, 'Hi ' + (row.patient_name || '') + ', regarding your appointment on ' + row.date + ' at ' + fmt12(row.start_time) + '.');
        if (typeof openWhatsAppPrefill === 'function') {
            openWhatsAppPrefill(phone, msg, { source: 'webbook' });
        }
    }

    function viewCalendarSelected() {
        var row = selectedRow();
        if (!row || !row.date) return;
        if (typeof switchApptTab === 'function') switchApptTab('calendar');
        if (typeof syncApptPlannerDate === 'function') {
            syncApptPlannerDate(row.date, { syncCal: true });
        } else if (typeof showCalendarTab === 'function') {
            showCalendarTab();
        }
        setTimeout(function () {
            if (typeof renderCal === 'function') renderCal({ force: true });
        }, 400);
    }

    function linkPatientSelected() {
        var row = selectedRow();
        if (!row) return;
        if (typeof openApptEditModal === 'function') {
            openApptEditModal(row);
            setTimeout(function () {
                if (typeof switchApptPatientMode === 'function') switchApptPatientMode('exist');
                var inp = g('psInput');
                if (inp) inp.focus();
            }, 300);
        }
    }

    function setTabBadgeCount(pending) {
        var n = Math.max(0, parseInt(pending, 10) || 0);
        var tab = document.querySelector('.appt-tab[data-tab="webbook"]');
        if (!tab) return;
        var badge = tab.querySelector('.wb-tab-badge');
        if (!n) {
            if (badge) badge.remove();
            return;
        }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'wb-tab-badge';
            badge.setAttribute('aria-label', tr('webbook.badgeAria', 'Pending web bookings'));
            tab.appendChild(badge);
        }
        badge.textContent = n > 99 ? '99+' : String(n);
    }

    function updateTabBadge() {
        setTabBadgeCount(_rows.filter(function (a) {
            var st = effectiveStatus(a);
            return st === 'pending_staff' || st === 'pending_otp' || st === 'pending_arrange';
        }).length);
    }

    function fetchPendingCount(done) {
        if (typeof SB === 'undefined' || !SB || !SB.from) {
            if (done) done(countPending());
            return;
        }
        var q = SB.from('appointments').select('id', { count: 'exact', head: true })
            .eq('booking_source', 'web')
            .in('booking_status', ['pending_staff', 'pending_otp', 'pending_arrange']);
        q = applyClinicScope(q);
        q.then(function (r) {
            if (r.error) {
                if ((r.error.message || '').indexOf('booking_source') >= 0 ||
                    (r.error.message || '').indexOf('booking_status') >= 0) {
                    fetchPendingCountLegacy(done);
                    return;
                }
                if (done) done(countPending());
                return;
            }
            if (done) done(r.count || 0);
        }).catch(function () {
            if (done) done(countPending());
        });
    }

    function fetchPendingCountLegacy(done) {
        var q2 = SB.from('appointments').select('id', { count: 'exact', head: true })
            .or('remarks.ilike.%WEB ref:%,remarks.ilike.%[WEB]%')
            .not('bill_status', 'ilike', '%cancel%');
        q2 = applyClinicScope(q2);
        q2.then(function (r2) {
            if (r2.error) {
                if (done) done(countPending());
                return;
            }
            if (done) done(r2.count || 0);
        }).catch(function () {
            if (done) done(countPending());
        });
    }

    function refreshTabBadge(opts) {
        opts = opts || {};
        if (opts.count != null) {
            setTabBadgeCount(opts.count);
            return;
        }
        fetchPendingCount(function (n) {
            setTabBadgeCount(n);
        });
    }

    function bindOnce() {
        if (_bound) return;
        _bound = true;

        var refreshBtn = g('wbRefreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', function () { loadList(); });

        ['wbFilterFrom', 'wbFilterTo', 'wbFilterStatus'].forEach(function (id) {
            var el = g(id);
            if (el) el.addEventListener('change', function () { loadList({ soft: true }); });
        });

        document.querySelectorAll('.wb-type-chk').forEach(function (chk) {
            chk.addEventListener('change', function () {
                TYPE_FILTERS[chk.dataset.type] = chk.checked;
                renderTable();
            });
        });

        var map = {
            wbBtnConfirm: confirmSelected,
            wbBtnCancel: cancelSelected,
            wbBtnReschedule: rescheduleSelected,
            wbBtnWhatsapp: whatsappSelected,
            wbBtnCalendar: viewCalendarSelected,
            wbBtnLink: linkPatientSelected
        };
        Object.keys(map).forEach(function (id) {
            var el = g(id);
            if (el) el.addEventListener('click', map[id]);
        });
    }

    function activateTab(opts) {
        opts = opts || {};
        bindOnce();
        if (opts.syncFilters !== false) syncTabFiltersForActiveClinic();
        updateClinicScopeLbl();
        refreshTabBadge();
        loadList({ soft: opts.soft !== false });
        if (!opts.keepSelection) {
            var sel = selectedRow();
            if (!sel) renderActionBar(null);
        }
    }

    function init() {
        activateTab({ soft: false, syncFilters: true });
    }

    function refresh(opts) {
        opts = opts || {};
        if (opts.syncFilters) syncTabFiltersForActiveClinic();
        loadList(Object.assign({ soft: true }, opts));
        if (!opts.keepSelection) {
            var sel = selectedRow();
            if (!sel) renderActionBar(null);
        }
    }

    function countPending() {
        return _rows.filter(function (a) {
            var st = effectiveStatus(a);
            return st === 'pending_staff' || st === 'pending_otp' || st === 'pending_arrange';
        }).length;
    }

    return {
        init: init,
        activateTab: activateTab,
        refresh: refresh,
        countPending: countPending,
        isWebBooking: isWebBooking,
        isArrangeRequest: isArrangeRequest,
        refreshTabBadge: refreshTabBadge
    };
})();

function initWebBookTab() {
    if (typeof initWebBookRosterBind === 'function') initWebBookRosterBind();
    if (WEBBOOK && WEBBOOK.activateTab) {
        WEBBOOK.activateTab({ soft: true, syncFilters: true, keepSelection: true });
    } else if (WEBBOOK && WEBBOOK.init) {
        WEBBOOK.init();
    }
}

function webbookRefreshList(opts) {
    if (WEBBOOK && WEBBOOK.refresh) WEBBOOK.refresh(opts);
}

function webbookRefreshTabBadge(opts) {
    if (WEBBOOK && WEBBOOK.refreshTabBadge) WEBBOOK.refreshTabBadge(opts || {});
}

function webbookCountPending() {
    return WEBBOOK && WEBBOOK.countPending ? WEBBOOK.countPending() : 0;
}

function apptIsWebBooking(a) {
    return WEBBOOK && WEBBOOK.isWebBooking ? WEBBOOK.isWebBooking(a) : false;
}

function apptIsArrangeRequest(a) {
    return WEBBOOK && WEBBOOK.isArrangeRequest ? WEBBOOK.isArrangeRequest(a) : false;
}

function apptWebBadgeHtml(a) {
    if (!apptIsWebBooking(a)) return '';
    var st = String((a && a.booking_status) || '').toLowerCase();
    var arrange = st === 'pending_arrange' || apptIsArrangeRequest(a);
    var pending = arrange || st === 'pending_staff' || st === 'pending_otp' || !st;
    var cls = arrange
        ? 'appt-web-badge appt-web-badge--arrange'
        : (pending ? 'appt-web-badge appt-web-badge--pending' : 'appt-web-badge');
    var label;
    if (arrange) {
        label = typeof tr === 'function' ? tr('appt.badge.webArrange') : 'ARRANGE';
    } else if (pending) {
        label = typeof tr === 'function' ? tr('appt.badge.webPending') : 'WEB';
    } else {
        label = typeof tr === 'function' ? tr('appt.badge.web') : 'WEB';
    }
    var escFn = typeof esc === 'function' ? esc : function (s) { return s; };
    return '<span class="' + cls + '">' + escFn(label) + '</span>';
}
