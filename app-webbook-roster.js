// ════════════════════════════════════════════════════════════════
// app-webbook-roster.js — Doctor roster setup for online booking
// Requires: SB, APP_CLINICS, APP_DOCTORS
// ════════════════════════════════════════════════════════════════

var WEBBOOK_ROSTER = (function () {
    'use strict';

    var _bound = false;
    var _mode = 'pattern';
    var _manualDates = {};
    var _manualSelected = '';
    var _manualYear = 0;
    var _manualMonth = 0;
    var _publicHolidays = {};
    var DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
    var SESSION_KEYS = ['am', 'pm', 'night'];

    var SESSION_TIME_DEFAULTS = {
        am_start: '10:00',
        am_end: '13:00',
        pm_start: '14:30',
        pm_end: '19:30',
        pm_end_weekend: '18:30',
        night_start: '21:00',
        night_end: '23:30',
        slot_interval: 30
    };

    var SESSION_TIME_INPUT_IDS = [
        'wbrAmStart', 'wbrAmEnd', 'wbrPmStart', 'wbrPmEnd', 'wbrPmEndWeekend',
        'wbrNightStart', 'wbrNightEnd'
    ];

    function sliceTime(raw, fallback) {
        if (raw === null || raw === undefined || raw === '') return fallback;
        return String(raw).slice(0, 5);
    }

    function timeInputVal(id, fallback) {
        var el = g(id);
        if (!el || !el.value) return fallback || '';
        return String(el.value).slice(0, 5);
    }

    function timeToMinutes(t) {
        var p = String(t || '').split(':');
        return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
    }

    function setSessionLabel(id, text) {
        var el = g(id);
        if (el) el.textContent = text;
    }

    function updateSessionTimeLabels() {
        var amS = timeInputVal('wbrAmStart', SESSION_TIME_DEFAULTS.am_start);
        var amE = timeInputVal('wbrAmEnd', SESSION_TIME_DEFAULTS.am_end);
        var pmS = timeInputVal('wbrPmStart', SESSION_TIME_DEFAULTS.pm_start);
        var pmE = timeInputVal('wbrPmEnd', SESSION_TIME_DEFAULTS.pm_end);
        var nS = timeInputVal('wbrNightStart', SESSION_TIME_DEFAULTS.night_start);
        var nE = timeInputVal('wbrNightEnd', SESSION_TIME_DEFAULTS.night_end);
        setSessionLabel('wbrLblAm', amS + '–' + amE);
        setSessionLabel('wbrLblPm', pmS + '–' + pmE + '*');
        setSessionLabel('wbrLblNight', nS + '–' + nE);
        setSessionLabel('wbrLblManAm', amS + '–' + amE);
        setSessionLabel('wbrLblManPm', pmS + '–' + pmE + '*');
        setSessionLabel('wbrLblManNight', nS + '–' + nE);
    }

    function applySessionTimeDefaults() {
        var map = {
            wbrAmStart: SESSION_TIME_DEFAULTS.am_start,
            wbrAmEnd: SESSION_TIME_DEFAULTS.am_end,
            wbrPmStart: SESSION_TIME_DEFAULTS.pm_start,
            wbrPmEnd: SESSION_TIME_DEFAULTS.pm_end,
            wbrPmEndWeekend: SESSION_TIME_DEFAULTS.pm_end_weekend,
            wbrNightStart: SESSION_TIME_DEFAULTS.night_start,
            wbrNightEnd: SESSION_TIME_DEFAULTS.night_end
        };
        Object.keys(map).forEach(function (id) {
            var el = g(id);
            if (el) el.value = map[id];
        });
        var interval = g('wbrSlotInterval');
        if (interval) interval.value = String(SESSION_TIME_DEFAULTS.slot_interval);
        updateSessionTimeLabels();
    }

    function applySessionTimesFromProfile(prof) {
        if (!prof) {
            applySessionTimeDefaults();
            return;
        }
        var el;
        el = g('wbrAmStart');
        if (el) el.value = sliceTime(prof.session_am_start, SESSION_TIME_DEFAULTS.am_start);
        el = g('wbrAmEnd');
        if (el) el.value = sliceTime(prof.session_am_end, SESSION_TIME_DEFAULTS.am_end);
        el = g('wbrPmStart');
        if (el) el.value = sliceTime(prof.session_pm_start, SESSION_TIME_DEFAULTS.pm_start);
        el = g('wbrPmEnd');
        if (el) el.value = sliceTime(prof.session_pm_end, SESSION_TIME_DEFAULTS.pm_end);
        el = g('wbrPmEndWeekend');
        if (el) el.value = sliceTime(prof.session_pm_end_weekend, SESSION_TIME_DEFAULTS.pm_end_weekend);
        el = g('wbrNightStart');
        if (el) el.value = sliceTime(prof.session_night_start, SESSION_TIME_DEFAULTS.night_start);
        el = g('wbrNightEnd');
        if (el) el.value = sliceTime(prof.session_night_end, SESSION_TIME_DEFAULTS.night_end);
        el = g('wbrSlotInterval');
        if (el) {
            var iv = parseInt(prof.slot_interval, 10);
            el.value = String([15, 30, 45, 60].indexOf(iv) >= 0 ? iv : SESSION_TIME_DEFAULTS.slot_interval);
        }
        updateSessionTimeLabels();
    }

    function collectSessionSettingsPayload() {
        var iv = parseInt(g('wbrSlotInterval') ? g('wbrSlotInterval').value : '30', 10);
        if ([15, 30, 45, 60].indexOf(iv) < 0) iv = SESSION_TIME_DEFAULTS.slot_interval;
        return {
            session_am_start: timeInputVal('wbrAmStart', SESSION_TIME_DEFAULTS.am_start),
            session_am_end: timeInputVal('wbrAmEnd', SESSION_TIME_DEFAULTS.am_end),
            session_pm_start: timeInputVal('wbrPmStart', SESSION_TIME_DEFAULTS.pm_start),
            session_pm_end: timeInputVal('wbrPmEnd', SESSION_TIME_DEFAULTS.pm_end),
            session_pm_end_weekend: timeInputVal('wbrPmEndWeekend', SESSION_TIME_DEFAULTS.pm_end_weekend),
            session_night_start: timeInputVal('wbrNightStart', SESSION_TIME_DEFAULTS.night_start),
            session_night_end: timeInputVal('wbrNightEnd', SESSION_TIME_DEFAULTS.night_end),
            slot_interval: iv
        };
    }

    function validateSessionSettings() {
        var pairs = [
            { start: timeInputVal('wbrAmStart', SESSION_TIME_DEFAULTS.am_start),
              end: timeInputVal('wbrAmEnd', SESSION_TIME_DEFAULTS.am_end),
              label: tr('webbook.roster.sessAm', 'AM') },
            { start: timeInputVal('wbrPmStart', SESSION_TIME_DEFAULTS.pm_start),
              end: timeInputVal('wbrPmEnd', SESSION_TIME_DEFAULTS.pm_end),
              label: tr('webbook.roster.sessPm', 'PM') + ' (' + tr('webbook.roster.pmEndWeekday', 'weekday') + ')' },
            { start: timeInputVal('wbrPmStart', SESSION_TIME_DEFAULTS.pm_start),
              end: timeInputVal('wbrPmEndWeekend', SESSION_TIME_DEFAULTS.pm_end_weekend),
              label: tr('webbook.roster.sessPm', 'PM') + ' (' + tr('webbook.roster.pmEndWeekend', 'weekend') + ')' },
            { start: timeInputVal('wbrNightStart', SESSION_TIME_DEFAULTS.night_start),
              end: timeInputVal('wbrNightEnd', SESSION_TIME_DEFAULTS.night_end),
              label: tr('webbook.roster.sessNight', 'Night') }
        ];
        for (var i = 0; i < pairs.length; i++) {
            var row = pairs[i];
            if (timeToMinutes(row.start) >= timeToMinutes(row.end)) {
                return trRepl('webbook.roster.sessionTimeInvalid', { PERIOD: row.label },
                    row.label + ': start must be before end.');
            }
        }
        return '';
    }

    function defaultSessions() {
        return { am: true, pm: true, night: false };
    }

    function defaultSessionChecked(sk) {
        return sk === 'night' ? false : true;
    }

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

    function pad(n) { return String(n).padStart(2, '0'); }

    function todayIso() {
        var d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function isLoginPlaceholder(code) {
        var c = String(code || '').trim().toLowerCase();
        return c === 'all' || /^all[_-]/.test(c);
    }

    function escAttr(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function isPublicHoliday(iso) {
        if (typeof APPT_PUBLIC_HOLIDAYS !== 'undefined') return APPT_PUBLIC_HOLIDAYS.isHoliday(iso);
        return Object.prototype.hasOwnProperty.call(_publicHolidays, iso);
    }

    function publicHolidayName(iso) {
        if (typeof APPT_PUBLIC_HOLIDAYS !== 'undefined') return APPT_PUBLIC_HOLIDAYS.name(iso);
        return _publicHolidays[iso] || tr('webbook.roster.publicHoliday', 'Public holiday');
    }

    function loadPublicHolidays() {
        if (typeof APPT_PUBLIC_HOLIDAYS !== 'undefined') return APPT_PUBLIC_HOLIDAYS.load();
        if (typeof SB === 'undefined') return Promise.resolve();
        return SB.from('online_booking_public_holidays')
            .select('holiday_date,name')
            .eq('enabled', true)
            .then(function (res) {
                _publicHolidays = {};
                (res.data || []).forEach(function (h) {
                    if (!h.holiday_date) return;
                    var iso = String(h.holiday_date).slice(0, 10);
                    _publicHolidays[iso] = (h.name && String(h.name).trim())
                        || tr('webbook.roster.publicHoliday', 'Public holiday');
                });
            })
            .catch(function () {
                _publicHolidays = {};
            });
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

    function patternHasContent() {
        return DAY_ORDER.some(function (dow) {
            var onEl = g('wbrOn' + dow);
            return !!(onEl && onEl.checked);
        });
    }

    function manualHasContent() {
        return Object.keys(_manualDates).length > 0;
    }

    function clearManualAll() {
        _manualDates = {};
        _manualSelected = '';
        hideManualSessions();
        renderManualMonth();
    }

    function activeModeLabel() {
        return _mode === 'manual'
            ? tr('webbook.roster.modeManual', 'Manual month')
            : tr('webbook.roster.modePattern', 'Pattern (weekly)');
    }

    function setPatternPaneInteractive(on) {
        DAY_ORDER.forEach(function (dow) {
            var onEl = g('wbrOn' + dow);
            var altEl = g('wbrAlt' + dow);
            if (onEl) onEl.disabled = !on;
            if (!on) {
                if (altEl) altEl.disabled = true;
                SESSION_KEYS.forEach(function (sk) {
                    var cap = sk.charAt(0).toUpperCase() + sk.slice(1);
                    var sessEl = g('wbr' + cap + dow);
                    if (sessEl) sessEl.disabled = true;
                });
            }
        });
        var anchor = g('wbrAnchor');
        if (anchor) anchor.disabled = !on;
        if (on) syncPatternRowState();
    }

    function setManualPaneInteractive(on) {
        ['wbrManualPrev', 'wbrManualNext', 'wbrCopyMonth', 'wbrClearMonth', 'wbrManRemove', 'wbrManAm', 'wbrManPm', 'wbrManNight']
            .forEach(function (id) {
                var el = g(id);
                if (el) el.disabled = !on;
            });
        if (!on) hideManualSessions();
        renderManualMonth();
    }

    function applyModeUi() {
        var pat = g('wbrPatternPane');
        var man = g('wbrManualPane');
        var patActive = _mode === 'pattern';
        var manActive = _mode === 'manual';
        if (pat) pat.classList.toggle('wbr-pane-section--inactive', !patActive);
        if (man) man.classList.toggle('wbr-pane-section--inactive', !manActive);
        setPatternPaneInteractive(patActive);
        setManualPaneInteractive(manActive);
        document.querySelectorAll('.wbr-mode-btn').forEach(function (b) {
            b.classList.toggle('active', b.dataset.mode === _mode);
        });
    }

    function setMode(mode) {
        _mode = mode === 'manual' ? 'manual' : 'pattern';
        applyModeUi();
    }

    function syncPatternRowState() {
        DAY_ORDER.forEach(function (dow) {
            var onEl = g('wbrOn' + dow);
            var on = onEl && onEl.checked;
            var altEl = g('wbrAlt' + dow);
            if (altEl) {
                altEl.disabled = !on;
                if (!on) altEl.checked = false;
            }
            SESSION_KEYS.forEach(function (sk) {
                var cap = sk.charAt(0).toUpperCase() + sk.slice(1);
                var sessEl = g('wbr' + cap + dow);
                if (!sessEl) return;
                sessEl.disabled = !on;
                if (!on) {
                    sessEl.checked = false;
                } else if (!sessEl.dataset.touched) {
                    sessEl.checked = defaultSessionChecked(sk);
                }
            });
        });
    }

    function onPatternDutyChange(dow) {
        var onEl = g('wbrOn' + dow);
        if (onEl && onEl.checked) {
            SESSION_KEYS.forEach(function (sk) {
                var cap = sk.charAt(0).toUpperCase() + sk.slice(1);
                var sessEl = g('wbr' + cap + dow);
                if (sessEl && !sessEl.dataset.touched) sessEl.checked = defaultSessionChecked(sk);
            });
        }
        syncPatternRowState();
    }

    function clearPatternGrid() {
        DAY_ORDER.forEach(function (dow) {
            var onEl = g('wbrOn' + dow);
            var altEl = g('wbrAlt' + dow);
            if (onEl) onEl.checked = false;
            if (altEl) { altEl.checked = false; altEl.disabled = true; }
            SESSION_KEYS.forEach(function (sk) {
                var cap = sk.charAt(0).toUpperCase() + sk.slice(1);
                var sessEl = g('wbr' + cap + dow);
                if (sessEl) {
                    sessEl.checked = false;
                    sessEl.disabled = true;
                    delete sessEl.dataset.touched;
                }
            });
        });
        var anchor = g('wbrAnchor');
        if (anchor) anchor.value = todayIso();
    }

    function loadRoster() {
        var clinic = g('wbrClinic') ? g('wbrClinic').value : '';
        var doctor = g('wbrDoctor') ? g('wbrDoctor').value : '';
        if (!clinic || !doctor || typeof SB === 'undefined') return;

        clearPatternGrid();
        applySessionTimeDefaults();
        _manualDates = {};
        _manualSelected = '';
        hideManualSessions();
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
                .select('duty_date,enabled,session_am,session_pm,session_night')
                .eq('clinic_tag', clinic)
                .eq('doctor_code', doctor),
            loadPublicHolidays()
        ]).then(function (parts) {
            var prof = parts[0].data;
            var patterns = parts[1].data || [];
            var dates = parts[2].data || [];

            _mode = (prof && prof.mode === 'manual') ? 'manual' : 'pattern';
            applySessionTimesFromProfile(prof);

            var anchor = g('wbrAnchor');
            if (anchor && prof && prof.anchor_date) anchor.value = String(prof.anchor_date).slice(0, 10);

            patterns.forEach(function (p) {
                var dow = Number(p.day_of_week);
                var onEl = g('wbrOn' + dow);
                var altEl = g('wbrAlt' + dow);
                if (onEl) onEl.checked = !!p.on_duty;
                if (altEl) {
                    altEl.checked = !!p.alternate;
                    altEl.disabled = !p.on_duty;
                }
                SESSION_KEYS.forEach(function (sk) {
                    var cap = sk.charAt(0).toUpperCase() + sk.slice(1);
                    var sessEl = g('wbr' + cap + dow);
                    if (!sessEl) return;
                    var col = 'session_' + sk;
                    if (sk === 'night') {
                        sessEl.checked = p.on_duty && !!p[col];
                    } else {
                        sessEl.checked = p.on_duty && (p[col] !== false);
                    }
                    sessEl.disabled = !p.on_duty;
                    if (p.on_duty) sessEl.dataset.touched = '1';
                });
            });

            dates.forEach(function (d) {
                if (d.enabled !== false && d.duty_date) {
                    var iso = String(d.duty_date).slice(0, 10);
                    _manualDates[iso] = {
                        am: d.session_am !== false,
                        pm: d.session_pm !== false,
                        night: !!d.session_night
                    };
                }
            });

            var now = new Date();
            _manualYear = now.getFullYear();
            _manualMonth = now.getMonth();
            renderManualMonth();
            applyModeUi();

            if (status) status.textContent = '';
        }).catch(function (e) {
            if (status) status.textContent = (e && e.message) || tr('webbook.roster.loadErr', 'Could not load roster.');
        });
    }

    function saveRoster() {
        var clinic = g('wbrClinic') ? g('wbrClinic').value : '';
        var doctor = g('wbrDoctor') ? g('wbrDoctor').value : '';
        if (!clinic || !doctor || typeof SB === 'undefined') return;

        var timeErr = validateSessionSettings();
        if (timeErr) {
            alert(timeErr);
            return;
        }

        if (patternHasContent() && manualHasContent()) {
            var warn = tr(
                'webbook.roster.saveBothWarn',
                'Both weekly pattern and manual dates are set. Only "{mode}" will be saved — the other will be cleared. Continue?'
            ).replace('{mode}', activeModeLabel());
            if (!window.confirm(warn)) return;
        }

        var anchor = g('wbrAnchor') ? g('wbrAnchor').value : todayIso();
        var status = g('wbrStatus');
        var btn = g('wbrSaveBtn');
        if (btn) btn.disabled = true;
        if (status) status.textContent = tr('webbook.roster.saving', 'Saving…');

        var profPayload = Object.assign({
            clinic_tag: clinic,
            doctor_code: doctor,
            mode: _mode,
            anchor_date: anchor || todayIso(),
            updated_at: new Date().toISOString()
        }, collectSessionSettingsPayload());

        var patternRows = [];
        if (_mode === 'pattern') {
            patternRows = DAY_ORDER.map(function (dow) {
                var onEl = g('wbrOn' + dow);
                var altEl = g('wbrAlt' + dow);
                var onDuty = !!(onEl && onEl.checked);
                var row = {
                    clinic_tag: clinic,
                    doctor_code: doctor,
                    day_of_week: dow,
                    on_duty: onDuty,
                    alternate: !!(altEl && altEl.checked && onDuty)
                };
                SESSION_KEYS.forEach(function (sk) {
                    var cap = sk.charAt(0).toUpperCase() + sk.slice(1);
                    var sessEl = g('wbr' + cap + dow);
                    row['session_' + sk] = onDuty && !!(sessEl && sessEl.checked);
                });
                return row;
            });
        }

        var manualRows = [];
        if (_mode === 'manual') {
            manualRows = Object.keys(_manualDates).map(function (d) {
                var sess = _manualDates[d];
                if (!sess) return null;
                return {
                    clinic_tag: clinic,
                    doctor_code: doctor,
                    duty_date: d,
                    enabled: true,
                    session_am: !!sess.am,
                    session_pm: !!sess.pm,
                    session_night: !!sess.night
                };
            }).filter(Boolean);
        }

        var savedMsg = _mode === 'pattern'
            ? tr('webbook.roster.savedPattern', 'Weekly pattern saved. Manual dates cleared.')
            : tr('webbook.roster.savedManual', 'Manual dates saved. Weekly pattern cleared.');

        SB.from('online_booking_roster_profile').upsert([profPayload], { onConflict: 'clinic_tag,doctor_code' })
            .then(function () {
                return SB.from('online_booking_roster_pattern').delete().eq('clinic_tag', clinic).eq('doctor_code', doctor);
            })
            .then(function () {
                if (_mode === 'pattern' && patternRows.some(function (r) { return r.on_duty; })) {
                    return SB.from('online_booking_roster_pattern').insert(patternRows);
                }
                return { error: null };
            })
            .then(function () {
                return SB.from('online_booking_roster_dates').delete().eq('clinic_tag', clinic).eq('doctor_code', doctor);
            })
            .then(function () {
                if (_mode === 'manual' && manualRows.length) {
                    return SB.from('online_booking_roster_dates').insert(manualRows);
                }
                return { error: null };
            })
            .then(function (r) {
                if (r.error) throw r.error;
                if (status) status.textContent = savedMsg;
                if (btn) btn.disabled = false;
            })
            .catch(function (e) {
                if (status) status.textContent = (e && e.message) || tr('webbook.roster.saveErr', 'Save failed.');
                if (btn) btn.disabled = false;
            });
    }

    function sessionBadges(sess) {
        if (!sess) return '';
        var parts = [];
        if (sess.am) parts.push('A');
        if (sess.pm) parts.push('P');
        if (sess.night) parts.push('N');
        return parts.length ? '<span class="wbr-cal-sess">' + parts.join('') + '</span>' : '';
    }

    function hideManualSessions() {
        var panel = g('wbrManualSessions');
        if (panel) panel.style.display = 'none';
        _manualSelected = '';
    }

    function showManualSessions(iso) {
        var panel = g('wbrManualSessions');
        var lbl = g('wbrManualSelDate');
        var sess = _manualDates[iso];
        if (!panel || !sess) {
            hideManualSessions();
            return;
        }
        _manualSelected = iso;
        if (lbl) lbl.textContent = iso;
        var amEl = g('wbrManAm');
        var pmEl = g('wbrManPm');
        var nightEl = g('wbrManNight');
        if (amEl) amEl.checked = !!sess.am;
        if (pmEl) pmEl.checked = !!sess.pm;
        if (nightEl) nightEl.checked = !!sess.night;
        panel.style.display = '';
    }

    function syncManualSessionInputs() {
        if (!_manualSelected || !_manualDates[_manualSelected]) return;
        var sess = _manualDates[_manualSelected];
        var amEl = g('wbrManAm');
        var pmEl = g('wbrManPm');
        var nightEl = g('wbrManNight');
        sess.am = !!(amEl && amEl.checked);
        sess.pm = !!(pmEl && pmEl.checked);
        sess.night = !!(nightEl && nightEl.checked);
        if (!sess.am && !sess.pm && !sess.night) {
            sess.am = true;
            sess.pm = true;
            sess.night = false;
            if (amEl) amEl.checked = true;
            if (pmEl) pmEl.checked = true;
            if (nightEl) nightEl.checked = false;
        }
        renderManualMonth();
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
            var sess = _manualDates[iso];
            var on = !!sess;
            var past = iso < today;
            var sel = _manualSelected === iso;
            var locked = _mode !== 'manual';
            var isPh = isPublicHoliday(iso);
            var cls = 'wbr-cal-day' + (on ? ' wbr-cal-day--on' : '') + (past ? ' wbr-cal-day--past' : '') +
                (sel ? ' wbr-cal-day--sel' : '') + (isPh ? ' wbr-cal-day--ph' : '');
            var titleAttr = isPh ? ' title="' + escAttr(publicHolidayName(iso)) + '"' : '';
            html += '<button type="button" class="' + cls + '" data-date="' + iso + '"' + titleAttr +
                ((past || locked) ? ' disabled' : '') + '>' + day + sessionBadges(sess) + '</button>';
        }
        html += '</div>';
        grid.innerHTML = html;

        grid.querySelectorAll('.wbr-cal-day:not([disabled])').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (_mode !== 'manual') return;
                var d = btn.getAttribute('data-date');
                if (_manualDates[d]) {
                    showManualSessions(d);
                } else {
                    _manualDates[d] = defaultSessions();
                    showManualSessions(d);
                }
                renderManualMonth();
            });
        });
    }

    function removeManualSelectedDay() {
        if (!_manualSelected) return;
        delete _manualDates[_manualSelected];
        hideManualSessions();
        renderManualMonth();
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
                _manualDates[curIso] = {
                    am: !!_manualDates[prevIso].am,
                    pm: !!_manualDates[prevIso].pm,
                    night: !!_manualDates[prevIso].night
                };
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
        hideManualSessions();
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
                if (sub === 'roster') openRosterPane();
            });
        });

        document.querySelectorAll('.wbr-mode-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                setMode(btn.dataset.mode || 'pattern');
            });
        });

        DAY_ORDER.forEach(function (dow) {
            var onEl = g('wbrOn' + dow);
            if (onEl) onEl.addEventListener('change', function () {
                if (_mode !== 'pattern') return;
                onPatternDutyChange(dow);
            });
            SESSION_KEYS.forEach(function (sk) {
                var cap = sk.charAt(0).toUpperCase() + sk.slice(1);
                var sessEl = g('wbr' + cap + dow);
                if (sessEl) {
                    sessEl.addEventListener('change', function () {
                        if (_mode !== 'pattern') return;
                        sessEl.dataset.touched = '1';
                    });
                }
            });
        });

        ['wbrManAm', 'wbrManPm', 'wbrManNight'].forEach(function (id) {
            var el = g(id);
            if (el) el.addEventListener('change', syncManualSessionInputs);
        });

        var clinic = g('wbrClinic');
        var doctor = g('wbrDoctor');
        if (clinic) clinic.addEventListener('change', function () { fillDoctorSelect(); loadRoster(); });
        if (doctor) doctor.addEventListener('change', loadRoster);

        SESSION_TIME_INPUT_IDS.forEach(function (id) {
            var el = g(id);
            if (el) el.addEventListener('change', updateSessionTimeLabels);
            if (el) el.addEventListener('input', updateSessionTimeLabels);
        });
        var slotIv = g('wbrSlotInterval');
        if (slotIv) slotIv.addEventListener('change', updateSessionTimeLabels);

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

        var removeBtn = g('wbrManRemove');
        if (removeBtn) removeBtn.addEventListener('click', removeManualSelectedDay);
    }

    function openRosterPane() {
        fillClinicSelect();
        fillDoctorSelect();
        loadRoster();
    }

    function initRosterPane() {
        bindOnce();
        openRosterPane();
    }

    return {
        bindOnce: bindOnce,
        initRosterPane: initRosterPane,
        refreshManualMonth: renderManualMonth
    };
})();

function initWebBookRosterBind() {
    if (WEBBOOK_ROSTER && WEBBOOK_ROSTER.bindOnce) WEBBOOK_ROSTER.bindOnce();
}

function initWebBookRosterPane() {
    if (WEBBOOK_ROSTER && WEBBOOK_ROSTER.initRosterPane) WEBBOOK_ROSTER.initRosterPane();
}
