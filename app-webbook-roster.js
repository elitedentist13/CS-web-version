// ════════════════════════════════════════════════════════════════
// app-webbook-roster.js — Doctor roster setup for online booking
// Requires: SB, APP_CLINICS, APP_DOCTORS
// ════════════════════════════════════════════════════════════════

var WEBBOOK_ROSTER = (function () {
    'use strict';

    var _bound = false;
    var _mode = 'pattern';
    var _manualDates = {};
    var _manualYear = 0;
    var _manualMonth = 0;
    var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

    function g(id) { return document.getElementById(id); }

    function tr(key, fallback) {
        if (typeof t === 'function') {
            var v = t(key);
            if (v && v !== key) return v;
        }
        return fallback || key;
    }

    function pad(n) { return String(n).padStart(2, '0'); }

    function todayIso() {
        var d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function isLoginPlaceholder(code) {
        var c = String(code || '').trim().toLowerCase();
        return c === 'all' || /^all[_-]/.test(c);
    }

    function fillClinicSelect() {
        var sel = g('wbrClinic');
        if (!sel) return;
        sel.innerHTML = '';
        var list = (typeof APP_CLINICS !== 'undefined' && APP_CLINICS.length) ? APP_CLINICS : [];
        list.forEach(function (c) {
            if (c.is_active === false) return;
            var o = document.createElement('option');
            o.value = c.clinic_code || '';
            o.textContent = c.english_name || c.clinic_code || '';
            sel.appendChild(o);
        });
    }

    function fillDoctorSelect() {
        var sel = g('wbrDoctor');
        var clinicSel = g('wbrClinic');
        if (!sel) return;
        sel.innerHTML = '';
        var clinicCode = clinicSel ? clinicSel.value : '';
        var clinic = (APP_CLINICS || []).find(function (c) { return c.clinic_code === clinicCode; });
        var clinicId = clinic ? clinic.id : null;
        var docs = (APP_DOCTORS || []).filter(function (d) {
            if (d.is_active === false || isLoginPlaceholder(d.doctor_code)) return false;
            return !clinicId || !d.clinic_id || d.clinic_id === clinicId;
        });
        if (!docs.length) {
            docs = (APP_DOCTORS || []).filter(function (d) {
                return d.is_active !== false && !isLoginPlaceholder(d.doctor_code);
            });
        }
        docs.forEach(function (d) {
            var o = document.createElement('option');
            o.value = d.doctor_code || '';
            o.textContent = d.display_name || d.english_name || d.doctor_code;
            sel.appendChild(o);
        });
    }

    function setMode(mode) {
        _mode = mode === 'manual' ? 'manual' : 'pattern';
        document.querySelectorAll('.wbr-mode-btn').forEach(function (b) {
            b.classList.toggle('active', b.dataset.mode === _mode);
        });
        var pat = g('wbrPatternPane');
        var man = g('wbrManualPane');
        if (pat) pat.style.display = _mode === 'pattern' ? '' : 'none';
        if (man) man.style.display = _mode === 'manual' ? '' : 'none';
    }

    function syncAltDisabled() {
        DAY_ORDER.forEach(function (dow) {
            var onEl = g('wbrOn' + dow);
            var altEl = g('wbrAlt' + dow);
            if (!altEl) return;
            var on = onEl && onEl.checked;
            altEl.disabled = !on;
            if (!on) altEl.checked = false;
        });
    }

    function clearPatternGrid() {
        DAY_ORDER.forEach(function (dow) {
            var onEl = g('wbrOn' + dow);
            var altEl = g('wbrAlt' + dow);
            if (onEl) onEl.checked = false;
            if (altEl) { altEl.checked = false; altEl.disabled = true; }
        });
        var anchor = g('wbrAnchor');
        if (anchor) anchor.value = todayIso();
    }

    function loadRoster() {
        var clinic = g('wbrClinic') ? g('wbrClinic').value : '';
        var doctor = g('wbrDoctor') ? g('wbrDoctor').value : '';
        if (!clinic || !doctor || typeof SB === 'undefined') return;

        clearPatternGrid();
        _manualDates = {};
        var status = g('wbrStatus');
        if (status) status.textContent = tr('webbook.roster.loading', 'Loading…');

        Promise.all([
            SB.from('online_booking_roster_profile')
                .select('*')
                .eq('clinic_tag', clinic)
                .eq('doctor_code', doctor)
                .maybeSingle(),
            SB.from('online_booking_roster_pattern')
                .select('*')
                .eq('clinic_tag', clinic)
                .eq('doctor_code', doctor),
            SB.from('online_booking_roster_dates')
                .select('duty_date,enabled')
                .eq('clinic_tag', clinic)
                .eq('doctor_code', doctor)
        ]).then(function (parts) {
            var prof = parts[0].data;
            var patterns = parts[1].data || [];
            var dates = parts[2].data || [];

            if (prof) {
                setMode(prof.mode || 'pattern');
                var anchor = g('wbrAnchor');
                if (anchor && prof.anchor_date) anchor.value = String(prof.anchor_date).slice(0, 10);
            } else {
                setMode('pattern');
            }

            patterns.forEach(function (p) {
                var dow = Number(p.day_of_week);
                var onEl = g('wbrOn' + dow);
                var altEl = g('wbrAlt' + dow);
                if (onEl) onEl.checked = !!p.on_duty;
                if (altEl) {
                    altEl.checked = !!p.alternate;
                    altEl.disabled = !p.on_duty;
                }
            });

            dates.forEach(function (d) {
                if (d.enabled !== false && d.duty_date) {
                    _manualDates[String(d.duty_date).slice(0, 10)] = true;
                }
            });

            var now = new Date();
            _manualYear = now.getFullYear();
            _manualMonth = now.getMonth();
            renderManualMonth();
            if (status) status.textContent = '';
        }).catch(function (e) {
            if (status) status.textContent = (e && e.message) || tr('webbook.roster.loadErr', 'Could not load roster.');
        });
    }

    function saveRoster() {
        var clinic = g('wbrClinic') ? g('wbrClinic').value : '';
        var doctor = g('wbrDoctor') ? g('wbrDoctor').value : '';
        if (!clinic || !doctor || typeof SB === 'undefined') return;

        var anchor = g('wbrAnchor') ? g('wbrAnchor').value : todayIso();
        var status = g('wbrStatus');
        var btn = g('wbrSaveBtn');
        if (btn) btn.disabled = true;
        if (status) status.textContent = tr('webbook.roster.saving', 'Saving…');

        var profPayload = {
            clinic_tag: clinic,
            doctor_code: doctor,
            mode: _mode,
            anchor_date: anchor || todayIso(),
            updated_at: new Date().toISOString()
        };

        var patternRows = DAY_ORDER.map(function (dow) {
            var onEl = g('wbrOn' + dow);
            var altEl = g('wbrAlt' + dow);
            return {
                clinic_tag: clinic,
                doctor_code: doctor,
                day_of_week: dow,
                on_duty: !!(onEl && onEl.checked),
                alternate: !!(altEl && altEl.checked && onEl && onEl.checked)
            };
        });

        var manualRows = Object.keys(_manualDates).filter(function (k) { return _manualDates[k]; })
            .map(function (d) {
                return {
                    clinic_tag: clinic,
                    doctor_code: doctor,
                    duty_date: d,
                    enabled: true
                };
            });

        SB.from('online_booking_roster_profile').upsert([profPayload], { onConflict: 'clinic_tag,doctor_code' })
            .then(function () {
                return SB.from('online_booking_roster_pattern').delete().eq('clinic_tag', clinic).eq('doctor_code', doctor);
            })
            .then(function () {
                if (patternRows.some(function (r) { return r.on_duty; })) {
                    return SB.from('online_booking_roster_pattern').insert(patternRows);
                }
                return { error: null };
            })
            .then(function () {
                return SB.from('online_booking_roster_dates').delete().eq('clinic_tag', clinic).eq('doctor_code', doctor);
            })
            .then(function () {
                if (manualRows.length) {
                    return SB.from('online_booking_roster_dates').insert(manualRows);
                }
                return { error: null };
            })
            .then(function (r) {
                if (r.error) throw r.error;
                if (status) status.textContent = tr('webbook.roster.saved', 'Roster saved.');
                if (btn) btn.disabled = false;
            })
            .catch(function (e) {
                if (status) status.textContent = (e && e.message) || tr('webbook.roster.saveErr', 'Save failed.');
                if (btn) btn.disabled = false;
            });
    }

    function renderManualMonth() {
        var grid = g('wbrManualGrid');
        var lbl = g('wbrManualMonthLbl');
        if (!grid) return;

        var y = _manualYear;
        var m = _manualMonth;
        if (lbl) lbl.textContent = y + '-' + pad(m + 1);

        var first = new Date(y, m, 1);
        var startPad = (first.getDay() + 6) % 7;
        var daysInMonth = new Date(y, m + 1, 0).getDate();
        var today = todayIso();

        var html = '<div class="wbr-cal-head">';
        ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].forEach(function (d) {
            html += '<span>' + d + '</span>';
        });
        html += '</div><div class="wbr-cal-cells">';

        for (var i = 0; i < startPad; i++) {
            html += '<span class="wbr-cal-empty"></span>';
        }
        for (var day = 1; day <= daysInMonth; day++) {
            var iso = y + '-' + pad(m + 1) + '-' + pad(day);
            var on = !!_manualDates[iso];
            var past = iso < today;
            var cls = 'wbr-cal-day' + (on ? ' wbr-cal-day--on' : '') + (past ? ' wbr-cal-day--past' : '');
            html += '<button type="button" class="' + cls + '" data-date="' + iso + '"' +
                (past ? ' disabled' : '') + '>' + day + '</button>';
        }
        html += '</div>';
        grid.innerHTML = html;

        grid.querySelectorAll('.wbr-cal-day:not([disabled])').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var d = btn.getAttribute('data-date');
                _manualDates[d] = !_manualDates[d];
                renderManualMonth();
            });
        });
    }

    function shiftManualMonth(delta) {
        _manualMonth += delta;
        if (_manualMonth > 11) { _manualMonth = 0; _manualYear++; }
        if (_manualMonth < 0) { _manualMonth = 11; _manualYear--; }
        renderManualMonth();
    }

    function copyPrevMonth() {
        var y = _manualYear;
        var m = _manualMonth;
        var prev = new Date(y, m - 1, 1);
        var py = prev.getFullYear();
        var pm = prev.getMonth();
        var daysInPrev = new Date(py, pm + 1, 0).getDate();
        var today = todayIso();
        var daysInCur = new Date(y, m + 1, 0).getDate();
        for (var day = 1; day <= daysInPrev && day <= daysInCur; day++) {
            var prevIso = py + '-' + pad(pm + 1) + '-' + pad(day);
            var curIso = y + '-' + pad(m + 1) + '-' + pad(day);
            if (_manualDates[prevIso] && curIso >= today) {
                _manualDates[curIso] = true;
            }
        }
        renderManualMonth();
    }

    function clearManualMonth() {
        var y = _manualYear;
        var m = _manualMonth;
        var daysInMonth = new Date(y, m + 1, 0).getDate();
        for (var day = 1; day <= daysInMonth; day++) {
            delete _manualDates[y + '-' + pad(m + 1) + '-' + pad(day)];
        }
        renderManualMonth();
    }

    function bindOnce() {
        if (_bound) return;
        _bound = true;

        document.querySelectorAll('.wb-subtab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var sub = btn.dataset.wbSub || 'bookings';
                document.querySelectorAll('.wb-subtab').forEach(function (b) {
                    b.classList.toggle('active', b === btn);
                });
                var bookings = g('wbPaneBookings');
                var roster = g('wbPaneRoster');
                if (bookings) bookings.style.display = sub === 'bookings' ? '' : 'none';
                if (roster) roster.style.display = sub === 'roster' ? '' : 'none';
                if (sub === 'roster') initRosterPane();
            });
        });

        document.querySelectorAll('.wbr-mode-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                setMode(btn.dataset.mode || 'pattern');
            });
        });

        DAY_ORDER.forEach(function (dow) {
            var onEl = g('wbrOn' + dow);
            if (onEl) onEl.addEventListener('change', syncAltDisabled);
        });

        var clinic = g('wbrClinic');
        var doctor = g('wbrDoctor');
        if (clinic) clinic.addEventListener('change', function () { fillDoctorSelect(); loadRoster(); });
        if (doctor) doctor.addEventListener('change', loadRoster);

        var save = g('wbrSaveBtn');
        if (save) save.addEventListener('click', saveRoster);

        var prev = g('wbrManualPrev');
        var next = g('wbrManualNext');
        if (prev) prev.addEventListener('click', function () { shiftManualMonth(-1); });
        if (next) next.addEventListener('click', function () { shiftManualMonth(1); });

        var copyBtn = g('wbrCopyMonth');
        var clearBtn = g('wbrClearMonth');
        if (copyBtn) copyBtn.addEventListener('click', copyPrevMonth);
        if (clearBtn) clearBtn.addEventListener('click', clearManualMonth);
    }

    function initRosterPane() {
        bindOnce();
        fillClinicSelect();
        fillDoctorSelect();
        loadRoster();
    }

    return {
        initRosterPane: initRosterPane
    };
})();

function initWebBookRosterPane() {
    if (WEBBOOK_ROSTER && WEBBOOK_ROSTER.initRosterPane) WEBBOOK_ROSTER.initRosterPane();
}
