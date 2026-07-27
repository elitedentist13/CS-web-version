// ════════════════════════════════════════════════════════════════
// app-rsvp-recall.js — Two-way WhatsApp RSVP recall (add-on)
// Does not modify Recall Patient / Broadcast send paths.
// Requires: SB, AIHELPER.sendTwilioOutreach, appointment section helpers.
// Schema: wa_appointment_rsvp.sql
// ════════════════════════════════════════════════════════════════
var RSVP_RECALL = (function () {
    'use strict';

    var CONTENT_SID = 'HX123c5d6b07dff76590124d0c363fdd21';
    var TPL_VARS = '1,2,3,4,5';
    var TPL_VAR_MAP = { '1': 'NAME', '2': 'CLINIC', '3': 'DATE', '4': 'TIME', '5': 'DOCTOR' };
    var TABLE = 'wa_appointment_rsvp';
    var INBOUND_LOG = 'wa_rsvp_inbound_log';
    var WEBHOOK_URL = 'https://kprihawipljrltfzpfjd.supabase.co/functions/v1/twilio-whatsapp-inbound';
    var EXPIRE_HOURS = 72;

    var _ready = false;
    var _date = '';
    var _rows = [];
    var _sel = Object.create(null);
    var _rsvpByAppt = Object.create(null);
    var _sending = false;
    var _schemaMissing = false;
    var _pollTimer = null;
    var _realtimeBound = false;
    var _filter = 'all';
    /** Exclusive view: 'all' | 'only_adult' | 'only_child' | 'only_senior'. Hide toggles apply when mode is 'all'. */
    var _ageOnly = 'all';
    var _ageHideChild = false;
    var _ageHideSenior = false;
    /** Independent sex filter: 'all' | 'male' | 'female' */
    var _sexFilter = 'all';
    /** Stable doctor identity key (id:/code:/name:); empty = all doctors */
    var _doctorKey = '';
    var AGE_CHILD_LT = 12;
    var AGE_SENIOR_GT = 65;

    function g(id) { return document.getElementById(id); }
    function tr(key, fallback) {
        if (typeof t === 'function') {
            var v = t(key);
            if (v && v !== key) return v;
        }
        return fallback || key;
    }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function todayISO() {
        if (typeof window.todayISO === 'function') return window.todayISO();
        var d = new Date();
        var m = d.getMonth() + 1;
        var day = d.getDate();
        return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
    }
    function fmt12(t) {
        if (typeof window.fmt12 === 'function') return window.fmt12(t);
        var s = String(t || '').slice(0, 5);
        var parts = s.split(':');
        var h = parseInt(parts[0], 10);
        if (isNaN(h)) return s;
        var m = parts[1] || '00';
        var ap = h >= 12 ? 'PM' : 'AM';
        h = h % 12;
        if (!h) h = 12;
        return h + ':' + m + ' ' + ap;
    }
    function clinicTag() {
        if (typeof currentClinicCodeForTagging === 'function') {
            return String(currentClinicCodeForTagging() || '').trim();
        }
        return String(typeof currentClinicLabel !== 'undefined' ? currentClinicLabel : '').trim();
    }
    function clinicLabel(bodyHint) {
        if (typeof clinicNameForOutboundMessage === 'function') {
            return clinicNameForOutboundMessage({
                body: bodyHint || '',
                fallback: 'Clinic'
            }) || 'Clinic';
        }
        return String(
            (typeof currentClinicLabel !== 'undefined' && currentClinicLabel) ? currentClinicLabel : ''
        ).trim() || 'Clinic';
    }
    function doctorName(a) {
        if (typeof apptDoctorNameForWhatsApp === 'function') {
            return String(apptDoctorNameForWhatsApp(a) || '').trim();
        }
        return String((a && (a.doctor_name || a.doctor_code)) || '').trim();
    }
    function phoneE164(raw) {
        var s = String(raw || '').trim();
        if (!s) return '';
        if (typeof formatPhoneForWA === 'function') {
            var wa = String(formatPhoneForWA(s) || '').replace(/\D/g, '');
            if (wa) return '+' + wa;
        }
        var d = s.replace(/\D/g, '');
        if (d.length === 8) d = '852' + d;
        if (!d) return '';
        return '+' + d;
    }
    function firstName(full) {
        var s = String(full || '').trim();
        if (!s) return 'Patient';
        return s.split(/\s+/)[0] || s;
    }
    function statusTone(st) {
        if (typeof apptRsvpStatusMeta === 'function') {
            var meta = apptRsvpStatusMeta(st);
            return { bg: '', fg: '', label: meta.label, icon: meta.icon, cls: meta.cls };
        }
        st = String(st || '').toLowerCase();
        if (st === 'confirmed') return { bg: '#dcfce7', fg: '#166534', label: tr('rsvp.status.confirmed', 'Coming'), icon: '✅', cls: 'is-confirmed' };
        if (st === 'declined') return { bg: '#fee2e2', fg: '#991b1b', label: tr('rsvp.status.declined', 'Not coming'), icon: '❌', cls: 'is-declined' };
        if (st === 'pending') return { bg: '#fef9c3', fg: '#854d0e', label: tr('rsvp.status.pending', 'Awaiting reply'), icon: '⏳', cls: 'is-pending' };
        if (st === 'failed') return { bg: '#ffedd5', fg: '#9a3412', label: tr('rsvp.status.failed', 'Send failed'), icon: '⚠️', cls: 'is-failed' };
        if (st === 'expired') return { bg: '#f1f5f9', fg: '#64748b', label: tr('rsvp.status.expired', 'Expired'), icon: '⌛', cls: 'is-expired' };
        return { bg: '#f8fafc', fg: '#64748b', label: tr('rsvp.status.none', 'Not sent'), icon: '—', cls: 'is-none' };
    }

    function rsvpFilterBucket(st) {
        st = String(st || '').toLowerCase();
        if (_filter === 'all') return true;
        if (_filter === 'confirmed') return st === 'confirmed';
        if (_filter === 'declined') return st === 'declined';
        if (_filter === 'pending') return st === 'pending' || st === 'failed' || st === 'expired';
        if (_filter === 'none') return !st;
        return true;
    }

    function rowAgeYears(a) {
        if (a && typeof a._ageYears === 'number' && !isNaN(a._ageYears)) return a._ageYears;
        var dob = a && a.dob;
        if (!dob) return null;
        if (typeof patientAgeYears === 'function') return patientAgeYears(dob);
        return null;
    }

    function ageBand(age) {
        if (age == null || isNaN(age)) return 'unknown';
        if (age < AGE_CHILD_LT) return 'child';
        if (age > AGE_SENIOR_GT) return 'senior';
        return 'adult';
    }

    function ageFilterPass(a) {
        var age = rowAgeYears(a);
        var band = ageBand(age);
        if (_ageOnly === 'only_adult') return band === 'adult';
        if (_ageOnly === 'only_child') return band === 'child';
        if (_ageOnly === 'only_senior') return band === 'senior';
        if (_ageHideChild && band === 'child') return false;
        if (_ageHideSenior && band === 'senior') return false;
        return true;
    }

    function rowSexKind(a) {
        if (a && a._sexKind) return a._sexKind;
        var sex = a && a.sex;
        if (typeof patientSexKind === 'function') return patientSexKind(sex);
        var s = String(sex || '').trim().toUpperCase();
        if (s === 'M' || s === 'MALE' || s === '男') return 'male';
        if (s === 'F' || s === 'FEMALE' || s === '女') return 'female';
        return 'unknown';
    }

    function sexFilterPass(a) {
        if (_sexFilter === 'all') return true;
        var kind = rowSexKind(a);
        if (_sexFilter === 'male') return kind === 'male';
        if (_sexFilter === 'female') return kind === 'female';
        return true;
    }

    function doctorCatalog() {
        return (typeof APP_DOCTORS !== 'undefined' && Array.isArray(APP_DOCTORS))
            ? APP_DOCTORS
            : [];
    }

    /** Normalize name so "DR." / "DR" / Chinese titles collapse to one key. */
    function rsvpNormDoctorName(v) {
        var s = String(v || '').trim();
        if (!s) return '';
        if (typeof stripDoctorTagPrefix === 'function') s = stripDoctorTagPrefix(s);
        if (typeof normalizeDoctorNameKey === 'function') {
            s = normalizeDoctorNameKey(s);
        } else {
            s = s.toLowerCase().replace(/^dr\.?\s+/i, '').replace(/\s+/g, ' ');
        }
        s = String(s || '')
            .toLowerCase()
            .replace(/[.]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/牙科醫生|牙科医生|醫生|醫師|医师|医生/g, '')
            .trim();
        return s;
    }

    function findDoctorRecord(a) {
        a = a || {};
        var id = a.doctor_id || a.doctorId || null;
        if (id) {
            var byId = null;
            if (typeof getDoctorById === 'function') byId = getDoctorById(id);
            if (!byId) {
                var sid = String(id);
                byId = doctorCatalog().find(function (d) {
                    return d && String(d.id) === sid;
                }) || null;
            }
            if (byId) return byId;
        }
        var code = String(a.doctor_code || '').trim().toLowerCase();
        if (code) {
            var byCode = doctorCatalog().find(function (d) {
                return String(d.doctor_code || '').trim().toLowerCase() === code;
            });
            if (byCode) return byCode;
        }
        var rawNames = [
            a.doctor_name,
            a.dentist_name,
            typeof apptDoctorNameForWhatsApp === 'function' ? apptDoctorNameForWhatsApp(a) : ''
        ];
        var docs = doctorCatalog();
        for (var i = 0; i < rawNames.length; i++) {
            var nk = rsvpNormDoctorName(rawNames[i]);
            if (!nk) continue;
            var hit = docs.find(function (d) {
                if (!d) return false;
                var cands = [
                    rsvpNormDoctorName(d.english_name),
                    rsvpNormDoctorName(d.chinese_name),
                    rsvpNormDoctorName(d.display_name)
                ].filter(Boolean);
                return cands.some(function (c) {
                    if (c === nk) return true;
                    // "吳培精牙科醫生" vs catalog "吳培精"
                    if (nk.length >= 2 && (c.indexOf(nk) >= 0 || nk.indexOf(c) >= 0)) return true;
                    return false;
                });
            });
            if (hit) return hit;
        }
        return null;
    }

    function doctorPreferredLabel(rec, fallback) {
        if (rec) {
            if (typeof doctorDisplayName === 'function') {
                var shown = String(doctorDisplayName(rec) || '').trim();
                if (shown) return shown;
            }
            var eng = String(rec.english_name || rec.display_name || '').trim();
            var chi = String(rec.chinese_name || '').trim();
            if (eng) return eng;
            if (chi) return chi;
            var code = String(rec.doctor_code || '').trim();
            if (code) return code;
        }
        return String(fallback || '').trim();
    }

    /** One stable identity per clinician (prefer doctor_id / APP_DOCTORS). */
    function resolveDoctorIdentity(a) {
        var rec = findDoctorRecord(a);
        var fallback = doctorName(a);
        if (rec && rec.id) {
            return {
                key: 'id:' + String(rec.id),
                label: doctorPreferredLabel(rec, fallback),
                id: String(rec.id)
            };
        }
        if (rec && rec.doctor_code) {
            return {
                key: 'code:' + String(rec.doctor_code).trim().toLowerCase(),
                label: doctorPreferredLabel(rec, fallback),
                id: ''
            };
        }
        var nk = rsvpNormDoctorName(fallback);
        if (!nk) return null;
        return { key: 'name:' + nk, label: fallback || nk, id: '' };
    }

    function doctorFilterPass(a) {
        if (!_doctorKey) return true;
        var idn = resolveDoctorIdentity(a);
        return !!(idn && idn.key === _doctorKey);
    }

    function listDayDoctors() {
        var map = Object.create(null);
        (_rows || []).forEach(function (a) {
            var idn = resolveDoctorIdentity(a);
            if (!idn || !idn.key) return;
            if (!map[idn.key]) {
                map[idn.key] = {
                    key: idn.key,
                    label: idn.label,
                    count: 0,
                    id: idn.id || ''
                };
            }
            map[idn.key].count++;
            if (idn.label && !map[idn.key].label) map[idn.key].label = idn.label;
        });
        return Object.keys(map).map(function (k) { return map[k]; })
            .sort(function (a, b) {
                return String(a.label).localeCompare(String(b.label));
            });
    }

    function syncDoctorFilterToDay() {
        var docs = listDayDoctors();
        if (docs.length <= 1) {
            _doctorKey = '';
            return docs;
        }
        if (!_doctorKey) return docs;
        var hit = docs.some(function (d) { return d.key === _doctorKey; });
        if (!hit) _doctorKey = '';
        return docs;
    }

    function doctorFilterActive() {
        return !!_doctorKey;
    }

    function ageFilterActive() {
        return _ageOnly !== 'all' || _ageHideChild || _ageHideSenior;
    }

    function sexFilterActive() {
        return _sexFilter === 'male' || _sexFilter === 'female';
    }

    function statusFilterActive() {
        return _filter !== 'all';
    }

    function smartFilterActive() {
        return ageFilterActive() || sexFilterActive() ||
            doctorFilterActive() || statusFilterActive();
    }

    function renderDoctorFilters() {
        var bar = g('rsvpDoctorFilterBar');
        var el = g('rsvpDoctorFilterBtns');
        if (!bar || !el) return;
        var docs = syncDoctorFilterToDay();
        if (docs.length <= 1) {
            bar.style.display = 'none';
            el.innerHTML = '';
            return;
        }
        bar.style.display = '';
        var allActive = !_doctorKey ? ' is-active' : '';
        var html =
            '<button type="button" class="rsvp-doctor-btn' + allActive + '" data-rsvp-doctor="" ' +
            'aria-pressed="' + (!_doctorKey ? 'true' : 'false') + '">' +
            esc(tr('rsvp.doctor.all', 'All doctors')) +
            ' <span class="rsvp-doctor-n">' + String(_rows.length) + '</span></button>';
        html += docs.map(function (d) {
            var active = (_doctorKey && d.key === _doctorKey) ? ' is-active' : '';
            return (
                '<button type="button" class="rsvp-doctor-btn' + active + '" data-rsvp-doctor="' +
                esc(d.key) + '" title="' + esc(d.label) + '" aria-pressed="' +
                (active ? 'true' : 'false') + '">' +
                esc(d.label) +
                ' <span class="rsvp-doctor-n">' + String(d.count) + '</span></button>'
            );
        }).join('');
        el.innerHTML = html;
    }

    function visibleRows() {
        return _rows.filter(function (a) {
            return rsvpFilterBucket(effectiveStatus(a)) &&
                ageFilterPass(a) &&
                sexFilterPass(a) &&
                doctorFilterPass(a);
        });
    }

    function ageFilterPresets() {
        return [
            { v: 'all', label: tr('rsvp.age.all', 'All ages'), kind: 'exclusive' },
            { v: 'exclude_child', label: tr('rsvp.age.excludeChild', 'Hide under 12'), kind: 'toggle' },
            { v: 'exclude_senior', label: tr('rsvp.age.excludeSenior', 'Hide over 65'), kind: 'toggle' },
            { v: 'only_adult', label: tr('rsvp.age.onlyAdult', 'Ages 12–65 only'), kind: 'exclusive' },
            { v: 'only_child', label: tr('rsvp.age.onlyChild', 'Under 12 only'), kind: 'exclusive' },
            { v: 'only_senior', label: tr('rsvp.age.onlySenior', 'Over 65 only'), kind: 'exclusive' }
        ];
    }

    function sexFilterPresets() {
        return [
            { v: 'all', label: tr('rsvp.sex.all', 'All sexes') },
            { v: 'male', label: tr('rsvp.sex.maleOnly', 'Male only') },
            { v: 'female', label: tr('rsvp.sex.femaleOnly', 'Female only') }
        ];
    }

    function agePresetIsActive(v) {
        if (v === 'all') return !ageFilterActive();
        if (v === 'exclude_child') return _ageOnly === 'all' && _ageHideChild;
        if (v === 'exclude_senior') return _ageOnly === 'all' && _ageHideSenior;
        return _ageOnly === v;
    }

    function renderAgeFilters() {
        var el = g('rsvpAgeFilterBtns');
        if (!el) return;
        var ageHtml = ageFilterPresets().map(function (it) {
            var active = agePresetIsActive(it.v) ? ' is-active' : '';
            return (
                '<button type="button" class="rsvp-age-btn' + active + '" data-rsvp-age="' +
                esc(it.v) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
                esc(it.label) + '</button>'
            );
        }).join('');
        var sexHtml = sexFilterPresets().map(function (it) {
            var active = _sexFilter === it.v ? ' is-active' : '';
            return (
                '<button type="button" class="rsvp-age-btn rsvp-sex-btn' + active + '" data-rsvp-sex="' +
                esc(it.v) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
                esc(it.label) + '</button>'
            );
        }).join('');
        el.innerHTML =
            '<div class="rsvp-filter-row">' + ageHtml + '</div>' +
            '<div class="rsvp-filter-row rsvp-sex-filter-row">' + sexHtml + '</div>';
        renderDoctorFilters();
        renderAgeFilterMeta();
    }

    function renderAgeFilterMeta() {
        var el = g('rsvpAgeFilterMeta');
        if (!el) return;
        var nAll = _rows.length;
        var nVis = visibleRows().length;
        var hidden = Math.max(0, nAll - nVis);
        var childN = 0, seniorN = 0, unkN = 0, maleN = 0, femaleN = 0, sexUnk = 0;
        _rows.forEach(function (a) {
            var b = ageBand(rowAgeYears(a));
            if (b === 'child') childN++;
            else if (b === 'senior') seniorN++;
            else if (b === 'unknown') unkN++;
            var sk = rowSexKind(a);
            if (sk === 'male') maleN++;
            else if (sk === 'female') femaleN++;
            else sexUnk++;
        });
        var msg = tr('rsvp.age.meta',
            'Showing {V} of {T} · under 12: {C} · over 65: {S} · no DOB: {U}')
            .replace('{V}', String(nVis))
            .replace('{T}', String(nAll))
            .replace('{C}', String(childN))
            .replace('{S}', String(seniorN))
            .replace('{U}', String(unkN));
        msg += ' · ' + tr('rsvp.sex.meta', 'M: {M} · F: {F} · sex ?: {X}')
            .replace('{M}', String(maleN))
            .replace('{F}', String(femaleN))
            .replace('{X}', String(sexUnk));
        if (hidden) {
            msg += ' · ' + tr('rsvp.age.hiddenN', 'filtered out: {H}').replace('{H}', String(hidden));
        }
        el.textContent = msg;
    }

    function pruneAgeSelection() {
        var keep = Object.create(null);
        visibleRows().forEach(function (a) {
            if (_sel[a.id]) keep[a.id] = true;
        });
        _sel = keep;
    }

    function applyAgeState(opts) {
        opts = opts || {};
        if (!opts.keepSelection) pruneAgeSelection();
        renderTable();
        updateSelCount();
    }

    function setSexFilter(mode, opts) {
        opts = opts || {};
        mode = String(mode || 'all');
        if (mode !== 'male' && mode !== 'female') mode = 'all';
        _sexFilter = mode;
        applyAgeState(opts);
    }

    function setDoctorFilter(key, opts) {
        opts = opts || {};
        _doctorKey = String(key || '').trim();
        applyAgeState(opts);
    }

    /** Apply exclusive mode or toggle hide-under-12 / hide-over-65 independently. */
    function setAgeFilter(mode, opts) {
        opts = opts || {};
        mode = String(mode || 'all');
        if (mode === 'exclude_child_senior') {
            _ageOnly = 'all';
            _ageHideChild = true;
            _ageHideSenior = true;
        } else if (mode === 'exclude_child') {
            _ageOnly = 'all';
            _ageHideChild = !_ageHideChild;
        } else if (mode === 'exclude_senior') {
            _ageOnly = 'all';
            _ageHideSenior = !_ageHideSenior;
        } else if (mode === 'only_adult' || mode === 'only_child' || mode === 'only_senior') {
            _ageOnly = mode;
            _ageHideChild = false;
            _ageHideSenior = false;
        } else {
            _ageOnly = 'all';
            _ageHideChild = false;
            _ageHideSenior = false;
        }
        applyAgeState(opts);
    }

    function ageLabelHtml(a) {
        var age = rowAgeYears(a);
        var band = ageBand(age);
        var text = age == null ? '—' : String(age);
        var cls = 'rsvp-age-pill';
        if (band === 'child') cls += ' is-child';
        else if (band === 'senior') cls += ' is-senior';
        else if (band === 'unknown') cls += ' is-unknown';
        return '<span class="' + cls + '" title="' +
            esc(a.dob ? String(a.dob) : tr('rsvp.age.noDob', 'No date of birth')) +
            '">' + esc(text) + '</span>';
    }

    function countByStatus() {
        var c = { confirmed: 0, declined: 0, pending: 0, none: 0 };
        _rows.forEach(function (a) {
            var st = effectiveStatus(a);
            if (st === 'confirmed') c.confirmed++;
            else if (st === 'declined') c.declined++;
            else if (st === 'pending' || st === 'failed' || st === 'expired') c.pending++;
            else c.none++;
        });
        return c;
    }

    function renderSummary() {
        var el = g('rsvpSummary');
        if (!el) return;
        var c = countByStatus();
        var chips = [
            { key: 'confirmed', cls: 'is-confirmed', icon: '✅', label: tr('rsvp.summary.coming', 'Coming'), n: c.confirmed },
            { key: 'declined', cls: 'is-declined', icon: '❌', label: tr('rsvp.summary.notComing', 'Not coming'), n: c.declined },
            { key: 'pending', cls: 'is-pending', icon: '⏳', label: tr('rsvp.summary.awaiting', 'Awaiting'), n: c.pending },
            { key: 'none', cls: 'is-none', icon: '—', label: tr('rsvp.summary.notSent', 'Not sent'), n: c.none }
        ];
        el.innerHTML = chips.map(function (ch) {
            return (
                '<button type="button" class="rsvp-summary-chip ' + ch.cls + '" data-rsvp-filter="' +
                esc(ch.key === 'none' ? 'none' : ch.key) + '" title="' +
                esc(ch.label) + '">' +
                '<span>' + ch.icon + '</span>' +
                '<span>' + esc(ch.label) + '</span>' +
                '<span class="rsvp-summary-n">' + String(ch.n) + '</span>' +
                '</button>'
            );
        }).join('');
    }

    function renderFilters() {
        var el = g('rsvpFilters');
        if (!el) return;
        var items = [
            { v: 'all', label: tr('rsvp.filter.all', 'All') },
            { v: 'confirmed', label: '✅ ' + tr('rsvp.filter.coming', 'Coming') },
            { v: 'declined', label: '❌ ' + tr('rsvp.filter.notComing', 'Not coming') },
            { v: 'pending', label: '⏳ ' + tr('rsvp.filter.awaiting', 'Awaiting') },
            { v: 'none', label: tr('rsvp.filter.notSent', 'Not sent') }
        ];
        el.innerHTML = items.map(function (it) {
            var active = _filter === it.v ? ' is-active' : '';
            return (
                '<button type="button" class="rsvp-filter-btn' + active + '" data-rsvp-filter="' +
                esc(it.v) + '">' + esc(it.label) + '</button>'
            );
        }).join('');
        renderAgeFilters();
    }
    function setStatus(msg, isErr) {
        var el = g('rsvpStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = isErr ? '#b91c1c' : '#047857';
    }

    function buildTplStub() {
        return {
            contentSid: CONTENT_SID,
            vars: TPL_VARS,
            varMap: TPL_VAR_MAP
        };
    }

    function resolveTemplate() {
        if (typeof AIHELPER !== 'undefined' && typeof AIHELPER.getTwilioContentTemplate === 'function') {
            var found = AIHELPER.getTwilioContentTemplate(CONTENT_SID);
            if (found && found.contentSid) {
                return {
                    contentSid: found.contentSid,
                    vars: found.vars || TPL_VARS,
                    varMap: found.varMap || found.var_map || TPL_VAR_MAP
                };
            }
        }
        return buildTplStub();
    }

    function contentCtx(a) {
        var name = firstName(a.patient_name || a.patient_chinese_name);
        var full = String(a.patient_name || a.patient_chinese_name || name).trim();
        var dateStr = a.date || _date;
        if (typeof fmtDateLong === 'function') {
            try { dateStr = fmtDateLong(a.date || _date) || dateStr; } catch (e) { /* keep */ }
        }
        var tpl = resolveTemplate();
        var bodyHint = [
            tpl && tpl.notes,
            tpl && tpl.label,
            tpl && tpl.name,
            tpl && tpl.body,
            // HK RSVP templates are typically Chinese; nudge detection when no body text.
            '預約確認 診所 回覆'
        ].filter(Boolean).join('\n');
        return {
            name: name,
            fullName: full,
            clinic: clinicLabel(bodyHint),
            date: dateStr,
            time: fmt12(a.start_time),
            doctor: doctorName(a),
            phone: a.phone || '',
            patientNo: a.patient_no || '',
            body: bodyHint,
            fields: {
                TREATMENT: String(a.treatment_items || '').trim(),
                CHINESE: String(a.patient_chinese_name || '').trim(),
                ENGLISH: String(a.patient_name || '').trim(),
                FIRST: name
            }
        };
    }

    function applyClinicQuery(q) {
        if (typeof applyApptModuleClinicQuery === 'function') {
            return applyApptModuleClinicQuery(q);
        }
        var tag = clinicTag();
        if (tag) q = q.eq('clinic_tag', tag);
        return q;
    }

    function loadRsvpMap(apptIds) {
        _rsvpByAppt = Object.create(null);
        if (!apptIds.length || typeof SB === 'undefined') return Promise.resolve();
        return SB.from(TABLE)
            .select('id,appointment_id,status,outbound_sid,sent_at,replied_at,button_payload,error,to_phone')
            .in('appointment_id', apptIds)
            .order('sent_at', { ascending: false })
            .limit(500)
            .then(function (r) {
                if (r.error) {
                    if (/wa_appointment_rsvp|schema cache|does not exist/i.test(String(r.error.message || ''))) {
                        _schemaMissing = true;
                        setStatus(tr('rsvp.alert.needSql',
                            'Run wa_appointment_rsvp.sql in Supabase SQL Editor once.'), true);
                    }
                    return;
                }
                _schemaMissing = false;
                (r.data || []).forEach(function (row) {
                    var aid = row.appointment_id;
                    if (!aid || _rsvpByAppt[aid]) return;
                    _rsvpByAppt[aid] = row;
                });
            });
    }

    function effectiveStatus(a) {
        var fromAppt = String(a.patient_rsvp_status || '').toLowerCase();
        var log = _rsvpByAppt[a.id];
        if (fromAppt === 'confirmed' || fromAppt === 'declined') return fromAppt;
        if (log && log.replied_at) {
            var ls = String(log.status || '').toLowerCase();
            if (ls === 'confirmed' || ls === 'declined') return ls;
        }
        if (log && log.status) return String(log.status).toLowerCase();
        if (fromAppt) return fromAppt;
        return '';
    }

    function loadWebhookDiagnostic() {
        var el = g('rsvpWebhookDiag');
        if (!el || typeof SB === 'undefined') return Promise.resolve();
        var pInbound = SB.from(INBOUND_LOG)
            .select('received_at,note,decision,from_phone,body')
            .order('received_at', { ascending: false })
            .limit(3);
        var pOk = SB.from(INBOUND_LOG)
            .select('received_at,note,decision')
            .eq('note', 'ok')
            .order('received_at', { ascending: false })
            .limit(1);
        var pPending = SB.from(TABLE)
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending');
        return Promise.all([pInbound, pOk, pPending]).then(function (res) {
            var inbound = res[0];
            var okRow = res[1];
            var pending = res[2];
            var rows = (inbound.data && !inbound.error) ? inbound.data : [];
            var last = rows[0];
            var pendingN = (pending && !pending.error && pending.count != null) ? pending.count : '?';
            var html = '<div style="font-weight:800;color:#334155;margin-bottom:6px;">' +
                esc(tr('rsvp.diag.title', 'Inbound webhook diagnostic')) + '</div>';
            html += '<div><span style="font-weight:700;">' + esc(tr('rsvp.diag.url', 'Twilio POST URL')) +
                ':</span><br><code>' + esc(WEBHOOK_URL) + '</code></div>';
            html += '<div style="margin-top:6px;"><span style="font-weight:700;">' +
                esc(tr('rsvp.diag.pending', 'Pending replies waiting')) + ':</span> ' +
                esc(String(pendingN)) + '</div>';
            if (!last) {
                html += '<div class="rsvp-diag-err" style="margin-top:6px;">' +
                    esc(tr('rsvp.diag.never', 'Never received')) + '</div>';
            } else {
                var when = String(last.received_at || '').replace('T', ' ').slice(0, 19);
                var note = String(last.note || '');
                var cls = note === 'ok' ? 'rsvp-diag-ok' : (note === 'webhook_received' ? 'rsvp-diag-warn' : 'rsvp-diag-warn');
                html += '<div style="margin-top:6px;"><span style="font-weight:700;">' +
                    esc(tr('rsvp.diag.lastHit', 'Last inbound received')) + ':</span> ' +
                    '<span class="' + cls + '">' + esc(when) + ' · ' + esc(note) +
                    (last.decision ? (' · ' + esc(last.decision)) : '') + '</span></div>';
                if (note === 'webhook_received' && rows.length === 1) {
                    html += '<div class="rsvp-diag-warn" style="margin-top:4px;">' +
                        esc('Twilio reached Supabase but RSVP was not matched or parsed — check note in wa_rsvp_inbound_log.') +
                        '</div>';
                }
            }
            if (okRow.data && okRow.data[0]) {
                var okWhen = String(okRow.data[0].received_at || '').replace('T', ' ').slice(0, 19);
                html += '<div style="margin-top:4px;"><span style="font-weight:700;">' +
                    esc(tr('rsvp.diag.lastOk', 'Last successful RSVP update')) + ':</span> ' +
                    '<span class="rsvp-diag-ok">' + esc(okWhen) + '</span></div>';
            }
            html += '<div style="margin-top:6px;color:#64748b;">' +
                esc(tr('rsvp.diag.sendReminder', 'Patient must tap Send')) + '</div>';
            html += '<div style="margin-top:4px;color:#94a3b8;">' +
                esc(tr('rsvp.diag.checkTable', 'Debug table')) + ': wa_rsvp_inbound_log</div>';
            el.innerHTML = html;
        }).catch(function () { /* ignore */ });
    }

    function renderTable() {
        var body = g('rsvpBody');
        var countEl = g('rsvpPtCount');
        var hdr = g('rsvpDateHdr');
        if (hdr) {
            hdr.textContent = _date
                ? tr('rsvp.dateHdr', 'Appointments on') + ' ' + _date
                : tr('rsvp.pickDate', 'Select a date');
        }
        if (countEl) {
            var nVis = visibleRows().length;
            countEl.textContent = _rows.length
                ? tr('rsvp.count', '{N} appointment(s)').replace('{N}', String(nVis)) +
                  (smartFilterActive() && nVis !== _rows.length
                      ? ' · ' + tr('rsvp.age.ofTotal', 'of {T}').replace('{T}', String(_rows.length))
                      : '')
                : tr('rsvp.countZero', 'No appointments');
        }
        renderSummary();
        renderFilters();
        if (!body) return;
        if (!_rows.length) {
            body.innerHTML =
                '<tr><td colspan="9" style="text-align:center;padding:18px;color:#64748b;">' +
                esc(tr('rsvp.empty', 'No appointments for this date / clinic.')) +
                '</td></tr>';
            return;
        }
        var visible = visibleRows();
        if (!visible.length) {
            body.innerHTML =
                '<tr><td colspan="9" style="text-align:center;padding:18px;color:#64748b;">' +
                esc(tr('rsvp.emptyFiltered', 'No appointments match the current status / age filters.')) +
                '</td></tr>';
            return;
        }
        body.innerHTML = visible.map(function (a) {
            var st = effectiveStatus(a);
            var tone = statusTone(st);
            var phone = a.phone || '—';
            var checked = _sel[a.id] ? ' checked' : '';
            var log = _rsvpByAppt[a.id];
            var sentAt = log && log.sent_at
                ? String(log.sent_at).replace('T', ' ').slice(0, 16)
                : '—';
            var replied = log && log.replied_at
                ? String(log.replied_at).replace('T', ' ').slice(0, 16)
                : '—';
            var rowCls = '';
            if (st === 'confirmed') rowCls = ' class="rsvp-row-confirmed"';
            else if (st === 'declined') rowCls = ' class="rsvp-row-declined"';
            else if (st === 'pending') rowCls = ' class="rsvp-row-pending"';
            var badgeHtml;
            if (typeof apptRsvpBadgeBlockHtml === 'function') {
                badgeHtml = apptRsvpBadgeBlockHtml(a, { logStatus: log && log.status });
            } else {
                badgeHtml =
                    '<span class="rsvp-badge ' + tone.cls + '">' +
                    '<span class="rsvp-badge-icon">' + tone.icon + '</span>' +
                    '<span>' + esc(tone.label) + '</span></span>';
            }
            var metaLine =
                '<div style="font-size:10px;color:#94a3b8;margin-top:4px;">' +
                esc(tr('rsvp.sentAt', 'Sent')) + ': ' + esc(sentAt) +
                ' · ' + esc(tr('rsvp.repliedAt', 'Reply')) + ': ' + esc(replied) +
                '</div>';
            return (
                '<tr data-rsvp-id="' + esc(a.id) + '"' + rowCls + '>' +
                '<td style="text-align:center;"><input type="checkbox" class="rsvp-cb" data-id="' +
                esc(a.id) + '"' + checked + '></td>' +
                '<td>' + esc(a.patient_no || '—') + '</td>' +
                '<td><strong>' + esc(a.patient_chinese_name || a.patient_name || '—') + '</strong>' +
                (a.patient_chinese_name && a.patient_name
                    ? '<div style="font-size:11px;color:#64748b;">' + esc(a.patient_name) + '</div>'
                    : '') +
                '</td>' +
                '<td>' + ageLabelHtml(a) + '</td>' +
                '<td>' + esc(phone) + '</td>' +
                '<td>' + esc(fmt12(a.start_time)) + '</td>' +
                '<td>' + esc(doctorName(a)) + '</td>' +
                '<td>' + badgeHtml + metaLine + '</td>' +
                '<td style="white-space:nowrap;">' +
                '<button type="button" class="rsvp-act" data-act="confirm" data-id="' + esc(a.id) + '" ' +
                'style="padding:4px 8px;font-size:11px;margin:0 2px;border-radius:6px;border:1px solid #86efac;background:#f0fdf4;cursor:pointer;">' +
                '✅ ' + esc(tr('rsvp.act.confirm', 'Mark Yes')) + '</button>' +
                '<button type="button" class="rsvp-act" data-act="decline" data-id="' + esc(a.id) + '" ' +
                'style="padding:4px 8px;font-size:11px;margin:0 2px;border-radius:6px;border:1px solid #fca5a5;background:#fef2f2;cursor:pointer;">' +
                '❌ ' + esc(tr('rsvp.act.decline', 'Mark No')) + '</button>' +
                '</td>' +
                '</tr>'
            );
        }).join('');
    }

    function loadPatients(dateIso) {
        _date = dateIso || _date || todayISO();
        var dateInp = g('rsvpDateInput');
        if (dateInp && dateInp.value !== _date) dateInp.value = _date;
        setStatus(tr('rsvp.loading', 'Loading…'), false);
        if (typeof SB === 'undefined') {
            setStatus('Supabase unavailable', true);
            return Promise.resolve();
        }
        var q = SB.from('appointments')
            .select('*')
            .eq('date', _date)
            .order('start_time');
        q = applyClinicQuery(q);
        return q.then(function (r) {
            if (r.error) {
                setStatus(r.error.message || 'Load failed', true);
                _rows = [];
                renderTable();
                return;
            }
            var list = (r.data || []).filter(function (a) {
                var bs = String(a.bill_status || '').toLowerCase();
                return bs.indexOf('cancel') < 0;
            });
            var patIds = [];
            list.forEach(function (a) {
                if (a.patient_id) patIds.push(a.patient_id);
            });
            var uniq = patIds.filter(function (id, i, arr) { return arr.indexOf(id) === i; });
            var phoneMap = Object.create(null);
            var dobMap = Object.create(null);
            var sexMap = Object.create(null);
            var phoneP = uniq.length
                ? SB.from('patients').select('id,phone_number,mobile_phone,dob,sex').in('id', uniq)
                : Promise.resolve({ data: [], error: null });
            return phoneP.then(function (pr) {
                if (pr.error) {
                    console.warn('[RSVP] patient phone/dob/sex load:', pr.error.message);
                    return SB.from('patients').select('id,phone_number,mobile_phone,dob').in('id', uniq)
                        .then(function (pr2) {
                            if (pr2.error) {
                                return SB.from('patients').select('id,phone_number,mobile_phone').in('id', uniq)
                                    .then(function (pr3) { return pr3.error ? { data: [] } : pr3; });
                            }
                            return pr2;
                        });
                }
                return pr;
            }).then(function (pr) {
                (pr.data || []).forEach(function (p) {
                    phoneMap[p.id] = String(p.mobile_phone || p.phone_number || '').trim();
                    if (p.dob) dobMap[p.id] = p.dob;
                    if (p.sex != null) sexMap[p.id] = p.sex;
                });
                list.forEach(function (a) {
                    a.phone = phoneMap[a.patient_id] || a.walk_in_phone || '';
                    a.dob = dobMap[a.patient_id] || a.dob || null;
                    a.sex = sexMap[a.patient_id] != null ? sexMap[a.patient_id] : (a.sex || null);
                    a._ageYears = typeof patientAgeYears === 'function' ? patientAgeYears(a.dob) : null;
                    a._sexKind = rowSexKind(a);
                });
                _rows = list;
                syncDoctorFilterToDay();
                var ids = list.map(function (a) { return a.id; });
                return loadRsvpMap(ids).then(function () {
                    renderTable();
                    setStatus('', false);
                    updateSelCount();
                    loadWebhookDiagnostic();
                });
            });
        });
    }

    function updateSelCount() {
        var n = 0;
        Object.keys(_sel).forEach(function (k) { if (_sel[k]) n++; });
        var el = g('rsvpSelCount');
        if (el) el.textContent = tr('rsvp.selected', '{N} selected').replace('{N}', String(n));
    }

    function selectAll(on) {
        var list = on ? visibleRows() : _rows;
        if (on) {
            list.forEach(function (a) { _sel[a.id] = true; });
        } else {
            _sel = Object.create(null);
        }
        renderTable();
        updateSelCount();
    }

    function writeApptRsvp(appointmentId, status, source) {
        if (typeof SB === 'undefined') return Promise.resolve(false);
        var now = new Date().toISOString();
        return SB.from('appointments')
            .update({
                patient_rsvp_status: status,
                patient_rsvp_at: now,
                patient_rsvp_source: source || 'staff'
            })
            .eq('id', appointmentId)
            .then(function (r) {
                if (r.error && /patient_rsvp_status|schema cache|does not exist/i.test(String(r.error.message || ''))) {
                    _schemaMissing = true;
                    return false;
                }
                return !r.error;
            });
    }

    function insertLog(row) {
        if (typeof SB === 'undefined') return Promise.resolve(null);
        return SB.from(TABLE).insert([row]).select('id').single()
            .then(function (r) {
                if (r.error) {
                    if (/wa_appointment_rsvp|schema cache|does not exist/i.test(String(r.error.message || ''))) {
                        _schemaMissing = true;
                        setStatus(tr('rsvp.alert.needSql',
                            'Run wa_appointment_rsvp.sql in Supabase SQL Editor once.'), true);
                    }
                    console.warn('[RSVP]', r.error.message);
                    return null;
                }
                return r.data && r.data.id;
            });
    }

    function markManual(appointmentId, decision) {
        var a = _rows.find(function (x) { return x.id === appointmentId; });
        if (!a) return;
        var now = new Date().toISOString();
        var log = _rsvpByAppt[appointmentId];
        var pLog = Promise.resolve();
        if (log && log.id && !_schemaMissing) {
            pLog = SB.from(TABLE).update({
                status: decision,
                button_payload: decision === 'confirmed' ? 'CONFIRM' : 'CANCEL',
                replied_at: now,
                updated_at: now
            }).eq('id', log.id);
        } else if (!_schemaMissing) {
            pLog = insertLog({
                appointment_id: appointmentId,
                patient_id: a.patient_id || null,
                to_phone: phoneE164(a.phone) || null,
                content_sid: CONTENT_SID,
                status: decision,
                button_payload: decision === 'confirmed' ? 'CONFIRM' : 'CANCEL',
                sent_at: now,
                replied_at: now,
                sent_by: (typeof currentUserId !== 'undefined' ? currentUserId : null),
                clinic_tag: clinicTag() || null
            });
        }
        pLog.then(function () {
            return writeApptRsvp(appointmentId, decision, 'staff');
        }).then(function () {
            if (typeof apptApplyRsvpRecallOutcome === 'function') {
                return apptApplyRsvpRecallOutcome(appointmentId, decision);
            }
        }).then(function () {
            a.patient_rsvp_status = decision;
            a.patient_rsvp_at = now;
            a.patient_rsvp_source = 'staff';
            if (decision === 'declined') a.bill_status = 'No Show';
            return loadRsvpMap(_rows.map(function (x) { return x.id; }));
        }).then(function () {
            renderTable();
            setStatus(tr('rsvp.marked', 'Updated reply status.'), false);
            if (typeof loadPlusApptDay === 'function') loadPlusApptDay({ soft: true });
            if (typeof loadToday === 'function') loadToday({ soft: true });
        });
    }

    function sendSelected() {
        if (_sending) return;
        if (_schemaMissing) {
            setStatus(tr('rsvp.alert.needSql',
                'Run wa_appointment_rsvp.sql in Supabase SQL Editor once.'), true);
            return;
        }
        if (typeof AIHELPER === 'undefined' || typeof AIHELPER.sendTwilioOutreach !== 'function') {
            setStatus(tr('rsvp.alert.noAi', 'AI Helper / Twilio send is unavailable.'), true);
            return;
        }
        var queue = visibleRows().filter(function (a) { return _sel[a.id]; });
        if (!queue.length) {
            setStatus(tr('rsvp.alert.noneSelected', 'Select at least one appointment.'), true);
            return;
        }
        var skipped = [];
        var ready = [];
        queue.forEach(function (a) {
            var to = phoneE164(a.phone);
            if (!to) skipped.push(a);
            else ready.push({ a: a, to: to });
        });
        if (!ready.length) {
            setStatus(tr('rsvp.alert.noPhone', 'Selected patients have no valid phone.'), true);
            return;
        }
        if (skipped.length && !window.confirm(
            tr('rsvp.confirm.skipNoPhone', '{N} without phone will be skipped. Continue?')
                .replace('{N}', String(skipped.length))
        )) return;

        var tpl = resolveTemplate();
        var fromSel = g('rsvpTwilioFrom');
        var fromVal = fromSel ? String(fromSel.value || '').trim() : '';
        _sending = true;
        setStatus(tr('rsvp.sending', 'Sending RSVP… 0/') + ready.length, false);
        var ok = 0;
        var fail = 0;
        var i = 0;

        function next() {
            if (i >= ready.length) {
                _sending = false;
                setStatus(
                    tr('rsvp.sendDone', 'Done: {OK} sent, {FAIL} failed.')
                        .replace('{OK}', String(ok))
                        .replace('{FAIL}', String(fail)),
                    fail > 0
                );
                loadPatients(_date);
                return;
            }
            var item = ready[i++];
            var a = item.a;
            var ctx = contentCtx(a);
            var vars = AIHELPER.buildTwilioContentVariables(tpl, ctx);
            var opts = {
                channel: 'whatsapp',
                to: item.to,
                name: ctx.name,
                contentSid: tpl.contentSid || CONTENT_SID,
                contentVariables: vars
            };
            if (fromVal) opts.from = fromVal;

            var expires = new Date(Date.now() + EXPIRE_HOURS * 3600 * 1000).toISOString();
            var sentAt = new Date().toISOString();

            AIHELPER.sendTwilioOutreach(opts).then(function (res) {
                if (res && res.ok) {
                    ok++;
                    var sid = res.result && res.result.sid ? String(res.result.sid) : null;
                    return insertLog({
                        appointment_id: a.id,
                        patient_id: a.patient_id || null,
                        to_phone: item.to,
                        content_sid: opts.contentSid,
                        outbound_sid: sid,
                        status: 'pending',
                        sent_at: sentAt,
                        expires_at: expires,
                        sent_by: (typeof currentUserId !== 'undefined' ? currentUserId : null),
                        clinic_tag: clinicTag() || null
                    }).then(function () {
                        return writeApptRsvp(a.id, 'pending', 'whatsapp');
                    });
                }
                fail++;
                return insertLog({
                    appointment_id: a.id,
                    patient_id: a.patient_id || null,
                    to_phone: item.to,
                    content_sid: opts.contentSid,
                    status: 'failed',
                    error: (res && res.error) ? String(res.error).slice(0, 500) : 'send failed',
                    sent_at: sentAt,
                    sent_by: (typeof currentUserId !== 'undefined' ? currentUserId : null),
                    clinic_tag: clinicTag() || null
                });
            }).catch(function (e) {
                fail++;
                console.warn('[RSVP] send', e);
            }).then(function () {
                setStatus(
                    tr('rsvp.sending', 'Sending RSVP… ') + i + '/' + ready.length,
                    false
                );
                setTimeout(next, 450);
            });
        }
        next();
    }

    function fillFromPicker() {
        var sel = g('rsvpTwilioFrom');
        if (!sel || typeof AIHELPER === 'undefined') return;
        var keep = sel.value;
        sel.innerHTML = '';
        var opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = tr('rsvp.fromDefault', 'Default (Edge secret)');
        sel.appendChild(opt0);
        var listP = typeof AIHELPER.ensureTwilioFromNumbers === 'function'
            ? AIHELPER.ensureTwilioFromNumbers(true)
            : Promise.resolve();
        Promise.resolve(listP).then(function () {
            var list = typeof AIHELPER.listTwilioFromNumbers === 'function'
                ? AIHELPER.listTwilioFromNumbers('whatsapp')
                : [];
            (list || []).forEach(function (row) {
                if (row.whatsapp === false || row.is_active === false) return;
                var o = document.createElement('option');
                o.value = row.phone || '';
                o.textContent = (row.label || row.phone || '') + ' · ' + (row.phone || '');
                sel.appendChild(o);
            });
            if (keep) sel.value = keep;
        }).catch(function () { /* ignore */ });
    }

    function bindOnce() {
        if (_ready) return;
        _ready = true;
        var root = g('tab-rsvp');
        if (!root) return;

        root.addEventListener('change', function (ev) {
            var t = ev.target;
            if (t && t.classList && t.classList.contains('rsvp-cb')) {
                var id = t.getAttribute('data-id');
                if (t.checked) _sel[id] = true;
                else delete _sel[id];
                updateSelCount();
            }
            if (t && t.id === 'rsvpDateInput') {
                _date = t.value || todayISO();
                _sel = Object.create(null);
                loadPatients(_date);
            }
        });

        root.addEventListener('click', function (ev) {
            var sexFilt = ev.target && ev.target.closest ? ev.target.closest('[data-rsvp-sex]') : null;
            if (sexFilt) {
                setSexFilter(sexFilt.getAttribute('data-rsvp-sex') || 'all');
                return;
            }
            var docFilt = ev.target && ev.target.closest ? ev.target.closest('[data-rsvp-doctor]') : null;
            if (docFilt) {
                setDoctorFilter(docFilt.getAttribute('data-rsvp-doctor') || '');
                return;
            }
            var ageFilt = ev.target && ev.target.closest ? ev.target.closest('[data-rsvp-age]') : null;
            if (ageFilt) {
                setAgeFilter(ageFilt.getAttribute('data-rsvp-age') || 'all');
                return;
            }
            var filt = ev.target && ev.target.closest ? ev.target.closest('[data-rsvp-filter]') : null;
            if (filt) {
                _filter = filt.getAttribute('data-rsvp-filter') || 'all';
                var keep = Object.create(null);
                visibleRows().forEach(function (a) {
                    if (_sel[a.id]) keep[a.id] = true;
                });
                _sel = keep;
                renderTable();
                updateSelCount();
                return;
            }
            var btn = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
            if (!btn) return;
            var act = btn.getAttribute('data-act');
            var id = btn.getAttribute('data-id');
            if (act === 'confirm' && id) markManual(id, 'confirmed');
            if (act === 'decline' && id) markManual(id, 'declined');
        });

        var sendBtn = g('rsvpSendBtn');
        if (sendBtn) sendBtn.addEventListener('click', sendSelected);
        var selAll = g('rsvpSelectAll');
        if (selAll) selAll.addEventListener('click', function () { selectAll(true); });
        var clearBtn = g('rsvpClearSel');
        if (clearBtn) clearBtn.addEventListener('click', function () { selectAll(false); });
        var refreshBtn = g('rsvpRefreshBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', function () { loadPatients(_date); });
        var openSetup = g('rsvpOpenTwilioSetup');
        if (openSetup) {
            openSetup.addEventListener('click', function () {
                if (typeof openBroadcastTwilioSetup === 'function') openBroadcastTwilioSetup();
                else if (typeof switchApptTab === 'function') switchApptTab('broadcast');
            });
        }
    }

    function startPoll() {
        stopPoll();
        _pollTimer = setInterval(function () {
            var pane = g('tab-rsvp');
            if (!pane || !pane.classList.contains('active')) return;
            if (_sending) return;
            if (!_rows.length) return;
            loadRsvpMap(_rows.map(function (a) { return a.id; })).then(function () {
                var ids = _rows.map(function (a) { return a.id; });
                if (!ids.length || typeof SB === 'undefined') {
                    renderTable();
                    return;
                }
                SB.from('appointments')
                    .select('id,patient_rsvp_status,patient_rsvp_at,patient_rsvp_source,bill_status')
                    .in('id', ids)
                    .then(function (r) {
                        var map = Object.create(null);
                        (r.data || []).forEach(function (row) { map[row.id] = row; });
                        _rows.forEach(function (a) {
                            if (map[a.id]) {
                                var prev = String(a.patient_rsvp_status || '').toLowerCase();
                                a.patient_rsvp_status = map[a.id].patient_rsvp_status;
                                a.patient_rsvp_at = map[a.id].patient_rsvp_at;
                                a.patient_rsvp_source = map[a.id].patient_rsvp_source;
                                if (map[a.id].bill_status) a.bill_status = map[a.id].bill_status;
                                var newSt = String(a.patient_rsvp_status || '').toLowerCase();
                                if ((newSt === 'confirmed' || newSt === 'declined') && prev !== newSt &&
                                    typeof apptApplyRsvpRecallOutcome === 'function') {
                                    apptApplyRsvpRecallOutcome(a.id, newSt);
                                }
                                if (newSt === 'declined') {
                                    a.bill_status = 'No Show';
                                }
                            }
                        });
                        renderTable();
                        loadWebhookDiagnostic();
                        if (typeof loadPlusApptDay === 'function') loadPlusApptDay({ soft: true });
                        if (typeof loadToday === 'function') loadToday({ soft: true });
                    });
            });
        }, 5000);
    }

    function startRealtime() {
        if (typeof SB === 'undefined' || !SB.channel || _realtimeBound) return;
        _realtimeBound = true;
        try {
            SB.channel('rsvp-recall-' + Date.now())
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: TABLE
                }, function () {
                    if (_sending || !_rows.length) return;
                    loadRsvpMap(_rows.map(function (a) { return a.id; })).then(function () {
                        renderTable();
                        loadWebhookDiagnostic();
                        if (typeof loadPlusApptDay === 'function') loadPlusApptDay({ soft: true });
                        if (typeof loadToday === 'function') loadToday({ soft: true });
                    });
                })
                .on('postgres_changes', {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'appointments'
                }, function (payload) {
                    if (_sending || !_rows.length || !payload || !payload.new) return;
                    var nid = payload.new.id;
                    _rows.forEach(function (a) {
                        if (!a || a.id !== nid) return;
                        var prev = String(a.patient_rsvp_status || '').toLowerCase();
                        if (payload.new.patient_rsvp_status != null) {
                            a.patient_rsvp_status = payload.new.patient_rsvp_status;
                        }
                        if (payload.new.patient_rsvp_at != null) a.patient_rsvp_at = payload.new.patient_rsvp_at;
                        if (payload.new.patient_rsvp_source != null) {
                            a.patient_rsvp_source = payload.new.patient_rsvp_source;
                        }
                        if (payload.new.bill_status != null) a.bill_status = payload.new.bill_status;
                        var newSt = String(a.patient_rsvp_status || '').toLowerCase();
                        if ((newSt === 'confirmed' || newSt === 'declined') && prev !== newSt &&
                            typeof apptApplyRsvpRecallOutcome === 'function') {
                            apptApplyRsvpRecallOutcome(a.id, newSt);
                        }
                        if (newSt === 'declined') a.bill_status = 'No Show';
                    });
                    loadRsvpMap(_rows.map(function (a) { return a.id; })).then(function () {
                        renderTable();
                        loadWebhookDiagnostic();
                        if (typeof loadPlusApptDay === 'function') loadPlusApptDay({ soft: true });
                        if (typeof loadToday === 'function') loadToday({ soft: true });
                    });
                })
                .on('postgres_changes', {
                    event: 'INSERT',
                    schema: 'public',
                    table: INBOUND_LOG
                }, function () {
                    loadWebhookDiagnostic();
                })
                .subscribe();
        } catch (e) { /* realtime optional */ }
    }

    function stopPoll() {
        if (_pollTimer) {
            clearInterval(_pollTimer);
            _pollTimer = null;
        }
    }

    function init() {
        bindOnce();
        if (!_date) _date = todayISO();
        var dateInp = g('rsvpDateInput');
        if (dateInp && !dateInp.value) dateInp.value = _date;
        var sidEl = g('rsvpContentSid');
        if (sidEl) sidEl.textContent = CONTENT_SID;
        fillFromPicker();
        if (typeof AIHELPER !== 'undefined' && typeof AIHELPER.ensureTwilioContentTemplates === 'function') {
            AIHELPER.ensureTwilioContentTemplates(true).catch(function () { /* ignore */ });
        }
        loadPatients(_date);
        startPoll();
        startRealtime();
    }

    function refreshFromBar() {
        if (g('tab-rsvp') && g('tab-rsvp').classList.contains('active')) {
            loadPatients(_date || todayISO());
        }
    }

    function applyI18n() {
        if (typeof applyI18nToTree === 'function') {
            var pane = g('tab-rsvp');
            if (pane) applyI18nToTree(pane);
        }
        renderTable();
        updateSelCount();
    }

    return {
        init: init,
        refreshFromBar: refreshFromBar,
        applyI18n: applyI18n,
        CONTENT_SID: CONTENT_SID
    };
})();

window.RSVP_RECALL = RSVP_RECALL;
