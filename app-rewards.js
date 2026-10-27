/* ════════════════════════════════════════════════════════════════
 * app-rewards.js — Banana Reward Points (cash-dollar style)
 *
 * Depends: SB, g(), esc(), openModal/closeModal (optional),
 *          AIHELPER.sendTwilioOutreach (SMS), APP_CLINICS, currentRole
 *
 * Public: window.REWARDS
 * ════════════════════════════════════════════════════════════════ */
var REWARDS = (function () {
    'use strict';

    var METHOD = 'Reward points';
    var _programCache = null;
    var _clinicMap = null; // clinic_id|code → { enabled, join_gain, join_redeem }
    var _clinicMapAt = 0;
    var _doctorJoinMap = null; // clinic bucket → { doctor_key → flags }
    var _doctorJoinMapAt = 0;
    var ALL_DOCTORS_KEY = '__all__';
    var _panelPatientId = null;
    var _panelSourceAccounts = []; // chart ledgers for open patient panel
    var _paySourceAccounts = [];   // chart ledgers for add-payment panel (doctor-capped)
    var _payDoctor = null;         // { key, label } for current bill
    var _payDoctorNets = null;     // nets from loadDoctorLedgerNets

    function tr(key, fallback) {
        if (typeof t === 'function') {
            var v = t(key);
            if (v && v !== key) return v;
        }
        return fallback != null ? fallback : key;
    }

    function trRepl(key, pairs, fallback) {
        var s = tr(key, fallback || key);
        if (pairs) {
            Object.keys(pairs).forEach(function (k) {
                s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(pairs[k] == null ? '' : pairs[k]));
            });
        }
        return s;
    }

    function isAdmin() {
        return String(typeof currentRole !== 'undefined' ? currentRole : '').toLowerCase() === 'admin';
    }

    function actorName() {
        return (typeof currentName !== 'undefined' && currentName) ? String(currentName) : null;
    }

    function round2(n) {
        return Math.round((Number(n) || 0) * 100) / 100;
    }

    function fmtPts(n) {
        return round2(n).toFixed(2);
    }

    function fmtSigned(n) {
        var v = round2(n);
        return (v > 0 ? '+' : '') + v.toFixed(2);
    }

    /** Same locale clock as patient banner / Supabase realtime sync (APP_LOCALE). */
    function ledgerDateLocale() {
        if (typeof APP_LOCALE !== 'undefined' && APP_LOCALE) return APP_LOCALE;
        if (typeof appUiLocale === 'function') {
            try { return appUiLocale(); } catch (e) { /* ignore */ }
        }
        if (typeof apptDateLocale === 'function') {
            try { return apptDateLocale(); } catch (e2) { /* ignore */ }
        }
        return 'en-HK';
    }

    /**
     * Format ledger timestamptz like the consultation banner + realtime sync clock:
     * browser-local instant via APP_LOCALE (clinic PCs are HK), AM/PM like fmtNowDateTimeHK.
     */
    function fmtLedgerTimeHK(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        if (isNaN(d.getTime())) {
            return String(iso).replace('T', ' ').slice(0, 19);
        }
        var loc = ledgerDateLocale();
        try {
            var datePart = d.toLocaleDateString(loc, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
            var timePart = d.toLocaleTimeString(loc, {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
            return datePart + ' ' + timePart;
        } catch (e) {
            try {
                return d.toLocaleString(loc);
            } catch (e2) {
                return String(iso).replace('T', ' ').slice(0, 19);
            }
        }
    }

    function fmtLedgerDateHK(iso) {
        if (!iso) return '—';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso).slice(0, 10);
        var loc = ledgerDateLocale();
        try {
            return d.toLocaleDateString(loc, {
                day: 'numeric',
                month: 'short',
                year: 'numeric'
            });
        } catch (e) {
            return String(iso).slice(0, 10);
        }
    }

    var SMS_BRAND = 'Joyful Smile Dental Clinic';
    var SMS_BRAND_ZH = '樂意牙科中心';
    var SMS_HEADING_NAME = SMS_BRAND + ' ' + SMS_BRAND_ZH;
    /** Always bilingual (ZH-Hant + EN) — one SMS for every patient. */
    var SMS_FALLBACK_BILINGUAL =
        '[' + SMS_HEADING_NAME + '] 積分更新 / Reward points update\n' +
        '變動/Change: {CHANGE} ({KIND})\n' +
        '結餘/Balance ({CLINIC}): {BALANCE}\n' +
        '總結餘/All-clinic total: {TOTAL}\n' +
        '診所/Clinic: {CLINIC}\n' +
        '參考/Ref: {REF}\n' +
        '備註/Note: 所有積分將於今年{YEAR}年12月31日 23:59到期，請好好善用；歡迎邀請親友使用。' +
        'All reward points expire on 31 Dec {YEAR} 23:59 this year. Please make good use of them, and you are welcome to invite others to use them.';

    function isRewardPayMethod(method) {
        var s = String(method == null ? '' : method).trim().toLowerCase().replace(/[_-]+/g, ' ');
        if (!s) return false;
        if (s === 'reward points' || s === 'reward point' || s === 'rewards') return true;
        if (s.indexOf('reward') >= 0 && s.indexOf('point') >= 0) return true;
        if (s === '積分' || s === '积分' || s === '獎勵積分' || s === '奖励积分') return true;
        return false;
    }

    function clinicCtx() {
        var clinicId = '';
        var clinicCode = '';
        if (typeof billPaymentClinicContext === 'function') {
            var c = billPaymentClinicContext();
            clinicId = c.clinic_id || '';
            clinicCode = c.clinic_code || c.clinic_tag || '';
        } else {
            if (typeof currentClinicId !== 'undefined' && currentClinicId) clinicId = String(currentClinicId);
            if (typeof currentClinicCodeForTagging === 'function') {
                clinicCode = String(currentClinicCodeForTagging() || '');
            }
        }
        return { clinic_id: clinicId || null, clinic_code: String(clinicCode || '').trim() };
    }

    function rpcResult(data) {
        if (data == null) return { ok: false, error: 'empty rpc' };
        if (typeof data === 'object') return data;
        try { return JSON.parse(data); } catch (e) { return { ok: false, error: String(data) }; }
    }

    // ── Program / clinic join ────────────────────────────────
    function loadProgram(force) {
        if (!force && _programCache) return Promise.resolve(_programCache);
        return SB.from('reward_program').select('*').eq('id', 1).maybeSingle()
            .then(function (r) {
                if (r.error) throw r.error;
                _programCache = r.data || {
                    id: 1,
                    earn_rate_percent: 10,
                    sms_notify_enabled: true
                };
                return _programCache;
            })
            .catch(function () {
                _programCache = {
                    id: 1,
                    earn_rate_percent: 10,
                    sms_notify_enabled: true
                };
                return _programCache;
            });
    }

    function clinicJoinFlags(row) {
        var gain = row.join_gain != null ? !!row.join_gain : !!row.enabled;
        var redeem = row.join_redeem != null ? !!row.join_redeem : !!row.enabled;
        return {
            enabled: !!(row.enabled || gain || redeem),
            join_gain: gain,
            join_redeem: redeem
        };
    }

    function loadClinicJoinMap(force) {
        var now = Date.now();
        if (!force && _clinicMap && (now - _clinicMapAt) < 30000) {
            return Promise.resolve(_clinicMap);
        }
        function mapFromRows(rows) {
            var map = {};
            (rows || []).forEach(function (row) {
                var flags = clinicJoinFlags(row);
                if (row.clinic_id) map['id:' + String(row.clinic_id)] = flags;
                var code = String(row.clinic_code || '').trim().toUpperCase();
                if (code) map['code:' + code] = flags;
            });
            return map;
        }
        function loadLegacyClinicJoin() {
            return SB.from('reward_program_clinics').select('clinic_id,clinic_code,enabled')
                .then(function (r2) {
                    if (r2.error) throw r2.error;
                    _clinicMap = mapFromRows(r2.data);
                    _clinicMapAt = Date.now();
                    return _clinicMap;
                })
                .catch(function () {
                    _clinicMap = {};
                    _clinicMapAt = Date.now();
                    return _clinicMap;
                });
        }
        return SB.from('reward_program_clinics').select('clinic_id,clinic_code,enabled,join_gain,join_redeem')
            .then(function (r) {
                if (r.error) {
                    // Older DB without join_gain/join_redeem columns
                    return loadLegacyClinicJoin();
                }
                _clinicMap = mapFromRows(r.data);
                _clinicMapAt = Date.now();
                return _clinicMap;
            })
            .catch(function () {
                return loadLegacyClinicJoin();
            });
    }

    function lookupClinicFlags(map, clinicId, clinicCode) {
        if (clinicId && Object.prototype.hasOwnProperty.call(map, 'id:' + String(clinicId))) {
            return map['id:' + String(clinicId)];
        }
        var code = String(clinicCode || '').trim().toUpperCase();
        if (code && Object.prototype.hasOwnProperty.call(map, 'code:' + code)) {
            return map['code:' + code];
        }
        if (code === 'PL') {
            return { enabled: true, join_gain: true, join_redeem: true };
        }
        return { enabled: false, join_gain: false, join_redeem: false };
    }

    function loadDoctorJoinMap(force) {
        var now = Date.now();
        if (!force && _doctorJoinMap && (now - _doctorJoinMapAt) < 30000) {
            return Promise.resolve(_doctorJoinMap);
        }
        return SB.from('reward_program_doctors')
            .select('clinic_id,clinic_code,doctor_key,doctor_id,doctor_label,join_gain,join_redeem,enabled')
            .then(function (r) {
                if (r.error) {
                    _doctorJoinMap = {};
                    _doctorJoinMapAt = Date.now();
                    return _doctorJoinMap;
                }
                var map = {};
                (r.data || []).forEach(function (row) {
                    var flags = clinicJoinFlags(row);
                    flags.doctor_id = row.doctor_id || null;
                    flags.doctor_label = row.doctor_label || '';
                    flags.doctor_key = String(row.doctor_key || ALL_DOCTORS_KEY);
                    function put(bucketKey) {
                        if (!bucketKey) return;
                        if (!map[bucketKey]) map[bucketKey] = {};
                        map[bucketKey][flags.doctor_key] = flags;
                    }
                    if (row.clinic_id) put('id:' + String(row.clinic_id));
                    var code = String(row.clinic_code || '').trim().toUpperCase();
                    if (code) put('code:' + code);
                });
                _doctorJoinMap = map;
                _doctorJoinMapAt = Date.now();
                return _doctorJoinMap;
            })
            .catch(function () {
                _doctorJoinMap = {};
                _doctorJoinMapAt = Date.now();
                return _doctorJoinMap;
            });
    }

    function lookupDoctorClinicBucket(docMap, clinicId, clinicCode) {
        docMap = docMap || {};
        if (clinicId && docMap['id:' + String(clinicId)]) {
            return docMap['id:' + String(clinicId)];
        }
        var code = String(clinicCode || '').trim().toUpperCase();
        if (code && docMap['code:' + code]) return docMap['code:' + code];
        return null;
    }

    /** Saved before Pak Hong was folded into the parco-poon alias. */
    var PARCO_POON_LEGACY_KEYS = {
        'name:poon pak hong': true,
        'name:潘柏匡': true,
        'name:潘柏匡牙科醫生': true
    };

    /**
     * Participation row for a doctor key. parco-poon also reads a legacy
     * Pak Hong key (and the reverse) so both list lines share one join.
     */
    function rewardFlagsMatchKey(bucket, doctorKey, doctorId) {
        bucket = bucket || {};
        if (doctorKey && bucket[doctorKey]) return bucket[doctorKey];
        var found = null;
        if (doctorId) {
            Object.keys(bucket).forEach(function (k) {
                if (found) return;
                var row = bucket[k];
                if (row && row.doctor_id && String(row.doctor_id) === String(doctorId)) found = row;
            });
        }
        if (found) return found;
        if (doctorKey === 'parco-poon') {
            Object.keys(PARCO_POON_LEGACY_KEYS).forEach(function (k) {
                if (!found && bucket[k]) found = bucket[k];
            });
        } else if (PARCO_POON_LEGACY_KEYS[doctorKey] && bucket['parco-poon']) {
            found = bucket['parco-poon'];
        }
        return found;
    }

    function doctorJoinKeyFromDoctorRow(d) {
        if (!d) return '';
        if (typeof DoctorAliases !== 'undefined' && DoctorAliases &&
            typeof DoctorAliases.resolveFromDoctor === 'function') {
            try {
                var person = DoctorAliases.resolveFromDoctor(d);
                if (person && person.key && person.key !== '__unknown__') return person.key;
            } catch (e) { /* ignore */ }
        }
        var raw = '';
        if (typeof doctorDisplayName === 'function') {
            try { raw = String(doctorDisplayName(d) || '').trim(); } catch (e2) { raw = ''; }
        }
        if (!raw) {
            raw = String(d.english_name || d.chinese_name || d.doctor_code || d.id || '').trim();
        }
        var doc = resolveRewardDoctor(raw);
        if (isKnownRewardDoctor(doc)) return doc.key;
        if (d.id) return 'id:' + String(d.id);
        return '';
    }

    function doctorJoinLabelFromDoctorRow(d) {
        if (!d) return '';
        if (typeof loginDoctorOptionLabel === 'function') {
            try { return String(loginDoctorOptionLabel(d) || '').trim(); } catch (e) { /* ignore */ }
        }
        if (typeof doctorDisplayName === 'function') {
            try { return String(doctorDisplayName(d) || '').trim(); } catch (e2) { /* ignore */ }
        }
        return String(d.english_name || d.chinese_name || d.doctor_code || '').trim();
    }

    /**
     * Effective gain/redeem for a clinic + optional treating doctor.
     * Prefer doctor rows when present: __all__ covers everyone; else match doctor_key.
     * Fall back to clinic-level flags (PL All Doctors default) when no doctor
     * scope has been configured for this clinic.
     */
    function effectiveJoinFlags(clinicMap, docMap, clinicId, clinicCode, doctorInput) {
        var clinicFlags = lookupClinicFlags(clinicMap || {}, clinicId, clinicCode);
        var bucket = lookupDoctorClinicBucket(docMap, clinicId, clinicCode);
        if (!bucket || !Object.keys(bucket).length) return clinicFlags;

        var all = bucket[ALL_DOCTORS_KEY];
        var hasAnyConfigured = Object.keys(bucket).some(function (k) {
            var row = bucket[k];
            return !!(row && (row.join_gain || row.join_redeem || row.enabled ||
                row.join_gain === false || row.join_redeem === false));
        });
        // Only __all__ / doctor rows that were actually saved should override
        // the legacy clinic default (PL on). Empty/absent scopes keep clinicFlags.
        if (!all && !hasAnyConfigured) return clinicFlags;

        var doc = resolveRewardDoctor(doctorInput);
        var matched = null;
        if (isKnownRewardDoctor(doc) || doc.doctor_id) {
            matched = rewardFlagsMatchKey(
                bucket,
                isKnownRewardDoctor(doc) ? doc.key : '',
                doc.doctor_id
            );
        }

        // Participation is one switch: earning and redeeming turn on together.
        function scopeJoined(row) {
            if (!row) return false;
            return !!(row.join_gain || row.join_redeem || row.enabled);
        }

        // No __all__ row yet → inherit clinic default for the All Doctors scope
        // (keeps PL joined for every doctor until reception narrows participation).
        var allOn = all ? scopeJoined(all) : scopeJoined(clinicFlags);
        var docOn = !!(matched && scopeJoined(matched));
        var gain = allOn || docOn;
        var redeem = gain;
        // Unknown doctor on bill: only All Doctors scope counts
        if (!isKnownRewardDoctor(doc) && !matched) {
            gain = allOn;
            redeem = allOn;
        }
        return {
            enabled: gain || redeem,
            join_gain: gain,
            join_redeem: redeem
        };
    }

    /** Default UI open target: PL clinic (All Doctors), same as historic scheme default. */
    function defaultRewardClinicIndex(clinics) {
        var list = clinics || [];
        var i;
        for (i = 0; i < list.length; i++) {
            if (String(list[i].clinic_code || '').trim().toUpperCase() === 'PL') return i;
        }
        return 0;
    }

    function defaultAllDoctorsFlags(clinicFlags, clinicCode) {
        var flags = clinicFlags || { join_gain: false, join_redeem: false, enabled: false };
        // Hard default matches reward_program_clinics seed: PL All Doctors on.
        if (String(clinicCode || '').trim().toUpperCase() === 'PL' &&
            !flags.join_gain && !flags.join_redeem && !flags.enabled) {
            return { join_gain: true, join_redeem: true, enabled: true };
        }
        return {
            join_gain: !!flags.join_gain,
            join_redeem: !!flags.join_redeem,
            enabled: !!(flags.enabled || flags.join_gain || flags.join_redeem)
        };
    }

    var _joinMapsInflight = null;

    function loadJoinMaps(force) {
        if (!force && _joinMapsInflight) return _joinMapsInflight;
        var p = Promise.all([
            loadClinicJoinMap(force),
            loadDoctorJoinMap(force)
        ]).then(function (parts) {
            return { clinicMap: parts[0] || {}, doctorMap: parts[1] || {} };
        });
        if (!force) {
            _joinMapsInflight = p;
            var clear = function () { if (_joinMapsInflight === p) _joinMapsInflight = null; };
            p.then(clear, clear);
        }
        return p;
    }

    /** One participation switch: gain and redeem must always give the same answer. */
    function isClinicJoined(clinicId, clinicCode, doctorInput) {
        return loadJoinMaps(false).then(function (maps) {
            return !!effectiveJoinFlags(maps.clinicMap, maps.doctorMap, clinicId, clinicCode, doctorInput).enabled;
        });
    }

    function isClinicGainJoined(clinicId, clinicCode, doctorInput) {
        return isClinicJoined(clinicId, clinicCode, doctorInput);
    }

    function isClinicRedeemJoined(clinicId, clinicCode, doctorInput) {
        return isClinicJoined(clinicId, clinicCode, doctorInput);
    }

    /** Treating doctor for a payment: the bill first (keeps doctor_id), then the passed name. */
    function payDoctorFor(opts) {
        opts = opts || {};
        var billLike = opts.bill ||
            ((typeof bdCurrentBill !== 'undefined' && bdCurrentBill) ? bdCurrentBill : null);
        var doc = billLike ? resolveRewardDoctor(billLike) : null;
        if (!isKnownRewardDoctor(doc) && opts.doctorName) {
            var byName = resolveRewardDoctor(opts.doctorName);
            if (isKnownRewardDoctor(byName)) {
                byName.doctor_id = (doc && doc.doctor_id) || null;
                doc = byName;
            }
        }
        return doc || { key: '__unknown__', label: '', doctor_id: null };
    }

    function currentClinicJoined(doctorInput) {
        var ctx = clinicCtx();
        return isClinicJoined(ctx.clinic_id, ctx.clinic_code, doctorInput);
    }

    function currentClinicRedeemJoined(doctorInput) {
        var ctx = clinicCtx();
        var bill = (typeof bdCurrentBill !== 'undefined') ? bdCurrentBill : null;
        return isClinicRedeemJoined(ctx.clinic_id, ctx.clinic_code, doctorInput || bill);
    }

    function earnRatePercent() {
        return loadProgram(false).then(function (p) {
            var n = Number(p.earn_rate_percent);
            return isFinite(n) ? n : 10;
        });
    }

    // ── Account / ledger reads ───────────────────────────────
    function normalizeHkid(raw) {
        return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    function normalizePhone(raw) {
        return String(raw || '').replace(/[^0-9]/g, '');
    }

    // Each Supabase round trip costs ~0.4–0.8 s, so one payment opening the
    // panel, saving, earning and repainting the banner read the same person
    // up to four times. Share in-flight + recent reads per patient; every
    // reward RPC clears the cache so balances after a write are always fresh.
    var PERSON_CACHE_MS = 30000;
    // Linked charts only change when an HKID / phone is edited, never by a reward write.
    var RELATED_CACHE_MS = 10 * 60 * 1000;
    var _personMemo = {};

    function personMemo(kind, patientId, fn, ttlMs) {
        var k = kind + ':' + String(patientId);
        var hit = _personMemo[k];
        if (hit && (Date.now() - hit.at) < (ttlMs || PERSON_CACHE_MS)) return hit.p;
        var p = Promise.resolve().then(fn);
        _personMemo[k] = { at: Date.now(), p: p };
        p.then(null, function () {
            if (_personMemo[k] && _personMemo[k].p === p) delete _personMemo[k];
        });
        return p;
    }

    /** Drop cached balances / ledger nets; keep linked-chart lookups. */
    function invalidatePersonCache() {
        Object.keys(_personMemo).forEach(function (k) {
            if (k.indexOf('related:') !== 0) delete _personMemo[k];
        });
    }

    /** Reward RPCs all write balances or ledger rows; drop cached person reads after each. */
    function rewardRpc(fn, args) {
        return Promise.resolve(SB.rpc(fn, args)).then(function (r) {
            invalidatePersonCache();
            return r;
        }, function (e) {
            invalidatePersonCache();
            throw e;
        });
    }

    /** Same person may have multiple charts (universal + clinic-prefixed legacy). */
    function findRelatedPatientIds(patientId) {
        if (!patientId) return Promise.resolve([]);
        return personMemo('related', patientId, function () {
            return findRelatedPatientIdsFresh(patientId);
        }, RELATED_CACHE_MS);
    }

    function findRelatedPatientIdsFresh(patientId) {
        return SB.from('patients')
            .select('id,hkid,phone_number,mobile_phone,patient_no')
            .eq('id', patientId)
            .maybeSingle()
            .then(function (r) {
                if (r.error || !r.data) return [patientId];
                var hk = normalizeHkid(r.data.hkid);
                var ph = normalizePhone(r.data.mobile_phone || r.data.phone_number);
                var q;
                if (hk && hk.length >= 7) {
                    q = SB.from('patients').select('id,patient_no,clinic_tag,full_name,chinese_name,hkid')
                        .ilike('hkid', '%' + hk.slice(0, 8) + '%')
                        .limit(40);
                } else if (ph && ph.length >= 8) {
                    q = SB.from('patients').select('id,patient_no,clinic_tag,full_name,chinese_name,phone_number,mobile_phone')
                        .or('phone_number.ilike.%' + ph.slice(-8) + '%,mobile_phone.ilike.%' + ph.slice(-8) + '%')
                        .limit(40);
                } else {
                    return [patientId];
                }
                return q.then(function (rr) {
                    var ids = [patientId];
                    (rr.data || []).forEach(function (p) {
                        var match = false;
                        if (hk && hk.length >= 7) {
                            match = normalizeHkid(p.hkid) === hk;
                        } else if (ph && ph.length >= 8) {
                            var pph = normalizePhone(p.mobile_phone || p.phone_number);
                            match = pph === ph || (pph && ph && (pph.slice(-8) === ph.slice(-8)));
                        }
                        if (match && ids.indexOf(p.id) < 0) ids.push(p.id);
                    });
                    return ids;
                }).catch(function () { return [patientId]; });
            })
            .catch(function () { return [patientId]; });
    }

    function getAccount(patientId) {
        if (!patientId) return Promise.resolve(null);
        return SB.from('reward_accounts').select('*').eq('patient_id', patientId).maybeSingle()
            .then(function (r) {
                if (r.error) return null;
                return r.data || null;
            })
            .catch(function () { return null; });
    }

    /** All chart ledgers for this person (creates missing account rows lazily via ensure on earn). */
    function listPersonAccounts(patientId) {
        if (!patientId) return Promise.resolve([]);
        return personMemo('accounts', patientId, function () {
            return listPersonAccountsFresh(patientId);
        });
    }

    function listPersonAccountsFresh(patientId) {
        return findRelatedPatientIds(patientId).then(function (ids) {
            if (!ids.length) return [];
            var accountsQ = Promise.resolve(
                SB.from('reward_accounts').select('*').in('patient_id', ids));
            accountsQ.catch(function () { /* handled by the chain below */ });
            return SB.from('patients')
                .select('id,patient_no,clinic_tag,full_name,chinese_name')
                .in('id', ids)
                .then(function (pr) {
                    var patients = pr.data || [];
                    return accountsQ
                        .then(function (ar) {
                            var byPid = {};
                            (ar.data || []).forEach(function (a) {
                                byPid[a.patient_id] = a;
                            });
                            return patients.map(function (p) {
                                var acc = byPid[p.id];
                                return {
                                    account_id: acc ? acc.id : null,
                                    patient_id: p.id,
                                    patient_no: (acc && acc.patient_no) || p.patient_no || '',
                                    clinic_code: (acc && acc.clinic_code) || p.clinic_tag || '',
                                    patient_name: (acc && acc.patient_name) ||
                                        p.full_name || p.chinese_name || '',
                                    balance: acc ? round2(acc.balance) : 0,
                                    started_at: acc ? acc.started_at : null,
                                    _account: acc || null
                                };
                            }).sort(function (a, b) {
                                if (b.balance !== a.balance) return b.balance - a.balance;
                                return String(a.patient_no).localeCompare(String(b.patient_no));
                            });
                        });
                })
                .catch(function () {
                    return getAccount(patientId).then(function (acc) {
                        if (!acc) {
                            return [{
                                account_id: null,
                                patient_id: patientId,
                                patient_no: '',
                                clinic_code: '',
                                patient_name: '',
                                balance: 0,
                                started_at: null,
                                _account: null
                            }];
                        }
                        return [{
                            account_id: acc.id,
                            patient_id: acc.patient_id,
                            patient_no: acc.patient_no || '',
                            clinic_code: acc.clinic_code || '',
                            patient_name: acc.patient_name || '',
                            balance: round2(acc.balance),
                            started_at: acc.started_at,
                            _account: acc
                        }];
                    });
                });
        });
    }

    function sumPersonBalance(accounts) {
        var t = 0;
        (accounts || []).forEach(function (a) { t += round2(a.balance); });
        return round2(t);
    }

    function getBalance(patientId) {
        return listPersonAccounts(patientId).then(function (accs) {
            return sumPersonBalance(accs);
        });
    }

    /** Drain plan: smallest balance first, remainder from largest (sort asc). */
    function allocateAcrossAccounts(accounts, points) {
        var need = round2(points);
        var withBal = (accounts || []).filter(function (a) {
            return a.account_id && round2(a.balance) > 0.005;
        }).slice().sort(function (a, b) {
            if (a.balance !== b.balance) return a.balance - b.balance;
            return String(a.patient_no || '').localeCompare(String(b.patient_no || ''));
        });
        var plan = [];
        var i;
        for (i = 0; i < withBal.length && need > 0.005; i++) {
            var take = round2(Math.min(withBal[i].balance, need));
            if (take <= 0) continue;
            plan.push({
                account_id: withBal[i].account_id,
                patient_id: withBal[i].patient_id,
                patient_no: withBal[i].patient_no,
                clinic_code: withBal[i].clinic_code,
                take: take,
                balance_before: withBal[i].balance
            });
            need = round2(need - take);
        }
        return { ok: need <= 0.005, remaining: need, plan: plan };
    }

    /**
     * Newest-first ledger order. Same-timestamp void batches insert redeem then earn;
     * show void_earn above void_redeem so the top balance_after matches the header.
     */
    function sortLedgerNewestFirst(rows) {
        function kindTie(k) {
            if (k === 'void_earn') return 0;
            if (k === 'void_redeem') return 1;
            return 2;
        }
        return (rows || []).slice().sort(function (a, b) {
            var ta = a && a.created_at ? Date.parse(a.created_at) : 0;
            var tb = b && b.created_at ? Date.parse(b.created_at) : 0;
            if (tb !== ta) return tb - ta;
            var ka = kindTie(a && a.kind);
            var kb = kindTie(b && b.kind);
            if (ka !== kb) return ka - kb;
            var ia = String((a && a.id) || '');
            var ib = String((b && b.id) || '');
            if (ia === ib) return 0;
            return ia < ib ? 1 : -1;
        });
    }

    function loadLedger(patientId, limit) {
        var lim = limit || 200;
        var q = SB.from('reward_ledger')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(lim);
        if (patientId) q = q.eq('patient_id', patientId);
        return q.then(function (r) {
            if (r.error) throw r.error;
            return sortLedgerNewestFirst(r.data || []);
        });
    }

    // ── Mutations via RPC ────────────────────────────────────
    function earn(opts) {
        opts = opts || {};
        var ctx = clinicCtx();
        var clinicId = opts.clinicId != null ? opts.clinicId : ctx.clinic_id;
        var clinicCode = opts.clinicCode != null ? opts.clinicCode : ctx.clinic_code;
        return isClinicGainJoined(clinicId, clinicCode, opts.doctor || opts.doctorName).then(function (joined) {
            if (!joined) {
                return {
                    ok: true,
                    skipped: true,
                    reason: 'doctor_gain_disabled',
                    points: 0
                };
            }
            return rewardRpc('reward_earn', {
                p_patient_id: opts.patientId,
                p_eligible_amount: round2(opts.eligibleAmount),
                p_bill_id: opts.billId || null,
                p_bill_payment_id: opts.billPaymentId || null,
                p_clinic_id: clinicId || null,
                p_clinic_code: clinicCode || null,
                p_created_by: opts.createdBy || actorName(),
                p_note: opts.note || null
            }).then(function (r) {
                if (r.error) return { ok: false, error: r.error.message };
                return stampDoctorOnLedgerResult(rpcResult(r.data), opts.doctorName);
            });
        });
    }

    function redeem(opts) {
        opts = opts || {};
        var sourceIds = opts.sourceAccountIds || null;
        if (sourceIds && sourceIds.length) {
            return redeemMulti(opts);
        }
        return rewardRpc('reward_redeem', {
            p_patient_id: opts.patientId,
            p_points: round2(opts.points),
            p_bill_id: opts.billId || null,
            p_bill_payment_id: opts.billPaymentId || null,
            p_clinic_id: opts.clinicId || null,
            p_clinic_code: opts.clinicCode || null,
            p_created_by: opts.createdBy || actorName(),
            p_note: opts.note || null
        }).then(function (r) {
            if (r.error) return { ok: false, error: r.error.message };
            return stampDoctorOnLedgerResult(rpcResult(r.data), opts.doctorName);
        });
    }

    function redeemMulti(opts) {
        opts = opts || {};
        var ids = (opts.sourceAccountIds || []).filter(Boolean);
        if (!ids.length) {
            return Promise.resolve({ ok: false, error: 'select at least one chart source' });
        }
        return rewardRpc('reward_redeem_multi', {
            p_anchor_patient_id: opts.patientId,
            p_points: round2(opts.points),
            p_source_account_ids: ids,
            p_bill_id: opts.billId || null,
            p_bill_payment_id: opts.billPaymentId || null,
            p_clinic_id: opts.clinicId || null,
            p_clinic_code: opts.clinicCode || null,
            p_created_by: opts.createdBy || actorName(),
            p_note: opts.note || null
        }).then(function (r) {
            if (r.error) {
                // Fallback: sequential single-chart redeem if multi RPC not deployed yet
                if (/reward_redeem_multi|could not find|404|PGRST/i.test(String(r.error.message || ''))) {
                    return redeemMultiFallback(opts, ids).then(function (res) {
                        return stampDoctorOnLedgerResult(res, opts.doctorName);
                    });
                }
                return { ok: false, error: r.error.message };
            }
            return stampDoctorOnLedgerResult(rpcResult(r.data), opts.doctorName);
        });
    }

    /** When multi RPC missing: single-chart only; multi-chart needs SQL patch applied. */
    function redeemMultiFallback(opts, accountIds) {
        return SB.from('reward_accounts').select('*').in('id', accountIds).then(function (ar) {
            var rows = (ar.data || []).map(function (a) {
                return {
                    account_id: a.id,
                    patient_id: a.patient_id,
                    patient_no: a.patient_no,
                    clinic_code: a.clinic_code,
                    balance: round2(a.balance)
                };
            });
            var alloc = allocateAcrossAccounts(rows, opts.points);
            if (!alloc.ok) {
                return { ok: false, error: 'insufficient reward balance across selected charts' };
            }
            if (alloc.plan.length > 1) {
                return {
                    ok: false,
                    error: tr('rewards.err.needSqlPatch',
                        'Multi-chart redeem needs SQL patch reward_points_patch_chart_ledgers.sql applied in Supabase.')
                };
            }
            var step = alloc.plan[0];
            return rewardRpc('reward_redeem', {
                p_patient_id: step.patient_id,
                p_points: step.take,
                p_bill_id: opts.billId || null,
                p_bill_payment_id: opts.billPaymentId || null,
                p_clinic_id: opts.clinicId || null,
                p_clinic_code: opts.clinicCode || null,
                p_created_by: opts.createdBy || actorName(),
                p_note: opts.note || null
            }).then(function (r) {
                if (r.error) return { ok: false, error: r.error.message };
                return rpcResult(r.data);
            });
        });
    }

    function transfer(opts) {
        opts = opts || {};
        if (opts.sourceAccountIds && opts.sourceAccountIds.length) {
            return transferMulti(opts);
        }
        return rewardRpc('reward_transfer', {
            p_from_patient_id: opts.fromPatientId,
            p_to_patient_id: opts.toPatientId,
            p_points: round2(opts.points),
            p_clinic_id: opts.clinicId || null,
            p_clinic_code: opts.clinicCode || null,
            p_created_by: opts.createdBy || actorName(),
            p_note: opts.note || null
        }).then(function (r) {
            if (r.error) return { ok: false, error: r.error.message };
            return rpcResult(r.data);
        });
    }

    function transferMulti(opts) {
        opts = opts || {};
        var ids = (opts.sourceAccountIds || []).filter(Boolean);
        if (!ids.length) {
            return Promise.resolve({ ok: false, error: 'select at least one source chart' });
        }
        return rewardRpc('reward_transfer_multi', {
            p_to_patient_id: opts.toPatientId,
            p_points: round2(opts.points),
            p_source_account_ids: ids,
            p_clinic_id: opts.clinicId || null,
            p_clinic_code: opts.clinicCode || null,
            p_created_by: opts.createdBy || actorName(),
            p_note: opts.note || null
        }).then(function (r) {
            if (r.error) {
                if (/reward_transfer_multi|could not find|404|PGRST/i.test(String(r.error.message || ''))) {
                    // Fallback: transfer from first source only via legacy RPC
                    return listPersonAccounts(opts.fromPatientId || '').then(function () {
                        var first = ids[0];
                        return SB.from('reward_accounts').select('patient_id').eq('id', first).maybeSingle()
                            .then(function (ar) {
                                var fromId = ar.data && ar.data.patient_id;
                                if (!fromId) return { ok: false, error: r.error.message };
                                return transfer({
                                    fromPatientId: fromId,
                                    toPatientId: opts.toPatientId,
                                    points: opts.points,
                                    clinicId: opts.clinicId,
                                    clinicCode: opts.clinicCode,
                                    note: opts.note
                                });
                            });
                    });
                }
                return { ok: false, error: r.error.message };
            }
            return rpcResult(r.data);
        });
    }

    function voidForPayment(billPaymentId, note, preferredPatientId) {
        if (!billPaymentId) return Promise.resolve({ ok: true, skipped: true });
        return rewardRpc('reward_void_for_payment', {
            p_bill_payment_id: billPaymentId,
            p_created_by: actorName(),
            p_note: note || 'Void payment'
        }).then(function (r) {
            if (r.error) return { ok: false, error: r.error.message };
            return rpcResult(r.data);
        }).then(function (res) {
            // Capsule is keyed to the open chart; RPC may return a related chart id
            // after multi-source redeem — always refresh active banner patient(s).
            var prefer = preferredPatientId || (res && res.patient_id) || null;
            return refreshActiveBannerBalances(prefer).then(function (bal) {
                if (res && bal != null) res.balance = bal;
                return res;
            });
        });
    }

    /**
     * Reverse ALL reward activity on a voided bill:
     *   - earn  → remove derived points from payments on that bill
     *   - redeem → restore points that were used as discount on that bill
     */
    function voidForBill(billId, note, preferredPatientId) {
        if (!billId) return Promise.resolve({ ok: true, skipped: true });
        return rewardRpc('reward_void_for_bill', {
            p_bill_id: billId,
            p_created_by: actorName(),
            p_note: note || 'Void bill: reverse earn + redeem'
        }).then(function (r) {
            if (r.error) return { ok: false, error: r.error.message };
            return rpcResult(r.data);
        }).then(function (res) {
            var prefer = preferredPatientId || (res && res.patient_id) || null;
            return refreshActiveBannerBalances(prefer).then(function (bal) {
                if (res && bal != null) res.balance = bal;
                return res;
            });
        });
    }

    /** Admin-only balance delta (positive add, negative subtract). Note required. */
    function adjust(opts) {
        opts = opts || {};
        if (!isAdmin()) return Promise.resolve({ ok: false, error: 'admin only' });
        var ctx = clinicCtx();
        return rewardRpc('reward_adjust', {
            p_patient_id: opts.patientId,
            p_points_delta: round2(opts.pointsDelta),
            p_clinic_id: opts.clinicId != null ? opts.clinicId : ctx.clinic_id,
            p_clinic_code: opts.clinicCode != null ? opts.clinicCode : ctx.clinic_code,
            p_created_by: opts.createdBy || actorName(),
            p_note: opts.note || null
        }).then(function (r) {
            if (r.error) return { ok: false, error: r.error.message };
            return rpcResult(r.data);
        }).then(function (res) {
            if (res && res.ok && !res.skipped && res.patient_id != null && res.balance != null) {
                refreshBannerBalances(res.patient_id, res.balance);
            }
            return res;
        });
    }

    /** Load current admin row (needs totp_secret for mid-session re-auth). */
    function loadCurrentAdminUser() {
        var uid = typeof currentUserId !== 'undefined' ? currentUserId : null;
        if (!uid || !isAdmin()) {
            return Promise.resolve({ ok: false, error: 'admin only' });
        }
        return SB.from('app_users')
            .select('user_id,role,totp_secret,display_name,is_active')
            .eq('user_id', uid)
            .maybeSingle()
            .then(function (r) {
                if (r.error) return { ok: false, error: r.error.message };
                var u = r.data;
                if (!u || String(u.role || '').toLowerCase() !== 'admin' || u.is_active === false) {
                    return { ok: false, error: 'admin only' };
                }
                return { ok: true, user: u };
            });
    }

    var LIFESPAN_MONTH_OPTIONS = [1, 2, 3, 4, 6, 9, 12, 24];

    function normalizeZeroPolicy(program) {
        var p = String((program && program.zero_policy) || 'manual').toLowerCase();
        if (p !== 'year_end' && p !== 'lifespan') p = 'manual';
        var months = Number(program && program.lifespan_months);
        if (LIFESPAN_MONTH_OPTIONS.indexOf(months) < 0) months = 12;
        return { zero_policy: p, lifespan_months: months };
    }

    function loadLastZeroBatch() {
        return SB.from('reward_zero_batches')
            .select('id,created_at,created_by,source,scope_all,clinic_codes,accounts,points_cleared,reverted_at,note')
            .is('reverted_at', null)
            .in('source', ['manual', 'year_end', 'lifespan'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
            .then(function (r) {
                if (r.error) return { ok: false, error: r.error.message, batch: null };
                return { ok: true, batch: r.data || null };
            })
            .catch(function (e) {
                return { ok: false, error: (e && e.message) || 'load failed', batch: null };
            });
    }

    function revertLastZeroBatch(opts) {
        opts = opts || {};
        if (!isAdmin()) return Promise.resolve({ ok: false, error: 'admin only' });
        return rewardRpc('reward_revert_zero_batch', {
            p_batch_id: opts.batchId || null,
            p_created_by: opts.createdBy || actorName(),
            p_note: opts.note || 'Step back — recover last balance before set zero'
        }).then(function (r) {
            if (r.error) return { ok: false, error: r.error.message };
            return rpcResult(r.data);
        });
    }

    function saveZeroPolicy(policy, lifespanMonths) {
        if (!isAdmin()) return Promise.resolve({ ok: false, error: 'admin only' });
        var p = String(policy || 'manual').toLowerCase();
        if (p !== 'year_end' && p !== 'lifespan') p = 'manual';
        var months = Number(lifespanMonths);
        if (LIFESPAN_MONTH_OPTIONS.indexOf(months) < 0) months = 12;
        var patch = {
            zero_policy: p,
            lifespan_months: p === 'lifespan' ? months : null,
            updated_at: new Date().toISOString(),
            updated_by: actorName()
        };
        // When enabling year-end mid-year, mark current HK year done so first wipe is next Dec 31.
        if (p === 'year_end') {
            try {
                var y = Number(new Intl.DateTimeFormat('en-US', {
                    timeZone: 'Asia/Hong_Kong', year: 'numeric'
                }).format(new Date()));
                if (isFinite(y)) patch.last_year_end_zero_year = y;
            } catch (e1) {
                patch.last_year_end_zero_year = new Date().getFullYear();
            }
        }
        return SB.from('reward_program').update(patch).eq('id', 1).then(function (r) {
            if (r.error) return { ok: false, error: r.error.message };
            _programCache = null;
            return { ok: true, policy: p, lifespan_months: months };
        });
    }

    /**
     * Wipe reward balances for selected clinics (or all). Writes a safety snapshot
     * batch so Step Back can restore. Tries bulk RPC first; client fallback also
     * writes snapshot rows when tables exist.
     */
    function zeroClinicBalances(opts) {
        opts = opts || {};
        if (!isAdmin() && opts.source !== 'year_end' && opts.source !== 'lifespan') {
            return Promise.resolve({ ok: false, error: 'admin only' });
        }
        var all = !!opts.all;
        var clinicIds = (opts.clinicIds || []).filter(Boolean);
        var clinicCodes = (opts.clinicCodes || []).map(function (c) {
            return String(c || '').trim();
        }).filter(Boolean);
        var source = String(opts.source || 'manual').toLowerCase();
        if (source !== 'year_end' && source !== 'lifespan') source = 'manual';
        var note = String(opts.note || 'Admin RESET ZERO').trim();
        if (!note) note = 'Admin RESET ZERO';
        if (!all && !clinicIds.length && !clinicCodes.length) {
            return Promise.resolve({ ok: false, error: 'no clinics selected' });
        }

        function viaRpc() {
            return rewardRpc('reward_zero_clinics', {
                p_all: all,
                p_clinic_ids: all ? null : (clinicIds.length ? clinicIds : null),
                p_clinic_codes: all ? null : (clinicCodes.length ? clinicCodes : null),
                p_created_by: opts.createdBy || actorName(),
                p_note: note,
                p_source: source
            }).then(function (r) {
                if (r.error) return { ok: false, error: r.error.message, fallback: true };
                var data = rpcResult(r.data);
                if (!data || data.ok === false) {
                    return {
                        ok: false,
                        error: (data && data.error) || 'zero failed',
                        fallback: true
                    };
                }
                return {
                    ok: true,
                    batch_id: data.batch_id || null,
                    accounts: Number(data.accounts) || 0,
                    points_cleared: round2(data.points_cleared),
                    via: 'rpc',
                    source: source
                };
            });
        }

        function viaClientLoop() {
            return SB.from('reward_accounts')
                .select('id,patient_id,balance,clinic_id,clinic_code,lifetime_earned,lifetime_redeemed')
                .gt('balance', 0)
                .then(function (r) {
                    if (r.error) return { ok: false, error: r.error.message };
                    var rows = r.data || [];
                    var idSet = {};
                    var codeSet = {};
                    clinicIds.forEach(function (id) { idSet[String(id)] = true; });
                    clinicCodes.forEach(function (c) { codeSet[String(c).toUpperCase()] = true; });
                    var targets = rows.filter(function (row) {
                        if (all) return round2(row.balance) > 0;
                        if (row.clinic_id && idSet[String(row.clinic_id)]) return true;
                        var code = String(row.clinic_code || '').trim().toUpperCase();
                        return !!(code && codeSet[code]);
                    });

                    var batchId = null;
                    return SB.from('reward_zero_batches').insert({
                        created_by: opts.createdBy || actorName(),
                        source: source,
                        scope_all: all,
                        clinic_ids: all ? null : (clinicIds.length ? clinicIds : null),
                        clinic_codes: all ? null : (clinicCodes.length ? clinicCodes : null),
                        note: note,
                        accounts: 0,
                        points_cleared: 0
                    }).select('id').maybeSingle().then(function (br) {
                        if (!br.error && br.data && br.data.id) batchId = br.data.id;
                        var snapRows = targets.map(function (row) {
                            return {
                                batch_id: batchId,
                                patient_id: row.patient_id,
                                account_id: row.id,
                                clinic_id: row.clinic_id,
                                clinic_code: row.clinic_code || '',
                                balance_before: round2(row.balance),
                                lifetime_earned: row.lifetime_earned,
                                lifetime_redeemed: row.lifetime_redeemed
                            };
                        }).filter(function (s) { return !!s.batch_id; });
                        var snapP = snapRows.length
                            ? SB.from('reward_zero_snapshot_rows').insert(snapRows)
                            : Promise.resolve({ error: null });
                        return snapP.then(function () {
                            var chain = Promise.resolve({
                                ok: true, accounts: 0, points_cleared: 0, via: 'client', batch_id: batchId, source: source
                            });
                            targets.forEach(function (row) {
                                chain = chain.then(function (acc) {
                                    if (!acc.ok) return acc;
                                    var bal = round2(row.balance);
                                    if (bal <= 0) return acc;
                                    return adjust({
                                        patientId: row.patient_id,
                                        pointsDelta: -bal,
                                        clinicId: row.clinic_id,
                                        clinicCode: row.clinic_code,
                                        note: note + (batchId ? (' [batch ' + batchId + ']') : '')
                                    }).then(function (res) {
                                        if (!res || !res.ok) {
                                            return {
                                                ok: false,
                                                error: (res && res.error) || 'adjust failed',
                                                accounts: acc.accounts,
                                                points_cleared: acc.points_cleared,
                                                via: 'client',
                                                batch_id: batchId,
                                                source: source
                                            };
                                        }
                                        if (res.skipped) return acc;
                                        return {
                                            ok: true,
                                            accounts: acc.accounts + 1,
                                            points_cleared: round2(acc.points_cleared + bal),
                                            via: 'client',
                                            batch_id: batchId,
                                            source: source
                                        };
                                    });
                                });
                            });
                            return chain.then(function (acc) {
                                if (!batchId || !acc.ok) return acc;
                                return SB.from('reward_zero_batches').update({
                                    accounts: acc.accounts,
                                    points_cleared: acc.points_cleared
                                }).eq('id', batchId).then(function () { return acc; });
                            });
                        });
                    });
                });
        }

        return viaRpc().then(function (res) {
            if (res && res.ok) return res;
            if (res && res.fallback) return viaClientLoop();
            return res || { ok: false, error: 'zero failed' };
        });
    }

    function hkYearNow() {
        try {
            return Number(new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Hong_Kong', year: 'numeric'
            }).format(new Date()));
        } catch (e) {
            return new Date().getFullYear();
        }
    }

    /** Auto year-end / lifespan jobs (idempotent; safe to call on config load). */
    function maybeRunScheduledZero(program) {
        var norm = normalizeZeroPolicy(program || {});
        if (norm.zero_policy === 'year_end') {
            var y = hkYearNow();
            var last = Number(program && program.last_year_end_zero_year);
            // After Jan 1 HK, previous calendar year's Dec 31 23:59 has passed.
            if (!last || last < y) {
                return zeroClinicBalances({
                    all: true,
                    source: 'year_end',
                    note: 'Auto year-end RESET ZERO (31 Dec 23:59 HK) for ' + (y - 1),
                    createdBy: actorName() || 'system'
                }).then(function (res) {
                    _programCache = null;
                    return res;
                });
            }
        }
        if (norm.zero_policy === 'lifespan') {
            var lastRun = program && program.last_lifespan_run_at
                ? new Date(program.last_lifespan_run_at).getTime() : 0;
            var dayMs = 24 * 60 * 60 * 1000;
            if (lastRun && (Date.now() - lastRun) < dayMs) {
                return Promise.resolve({ ok: true, skipped: true, reason: 'ran_today' });
            }
            return rewardRpc('reward_expire_lifespan', {
                p_months: norm.lifespan_months,
                p_created_by: actorName() || 'system',
                p_note: 'Auto lifespan expiry ' + norm.lifespan_months + ' months'
            }).then(function (r) {
                if (r.error) {
                    // Fallback: full zero of stale not available — skip quietly
                    return { ok: false, error: r.error.message, skipped: true };
                }
                _programCache = null;
                return rpcResult(r.data);
            });
        }
        return Promise.resolve({ ok: true, skipped: true, reason: 'manual' });
    }

    function ensureResetZeroModal() {
        var el = document.getElementById('rwResetZeroModal');
        if (el) return el;
        el = document.createElement('div');
        el.id = 'rwResetZeroModal';
        el.className = 'modal modal-no-backdrop-close reward-points-modal';
        el.setAttribute('data-no-backdrop-close', '1');
        el.style.display = 'none';
        el.innerHTML =
            '<div class="modal-box rw-reset-modal-box">' +
            '  <div class="rw-reset-head">' +
            '    <h3 id="rwResetTitle"></h3>' +
            '    <button type="button" class="btn" id="rwResetCloseX" aria-label="Close">×</button>' +
            '  </div>' +
            '  <div id="rwResetBody"></div>' +
            '  <p id="rwResetErr" class="rw-reset-err" style="display:none;"></p>' +
            '</div>';
        document.body.appendChild(el);
        return el;
    }

    function closeResetZeroModal() {
        if (typeof closeModal === 'function') closeModal('rwResetZeroModal');
        var el = document.getElementById('rwResetZeroModal');
        if (el) el.style.display = 'none';
    }

    function setResetZeroError(msg) {
        var err = document.getElementById('rwResetErr');
        if (!err) return;
        err.textContent = msg || '';
        err.style.display = msg ? '' : 'none';
    }

    /**
     * Shared admin SMS + Google Authenticator gate (same pieces as login).
     * opts: { title, onSuccess(adminUser), keepOpen }
     * keepOpen=true leaves the modal open after TOTP so the caller can paint next steps.
     */
    function openAdminRewardAuthGate(opts) {
        opts = opts || {};
        if (!isAdmin()) {
            alert(tr('rewards.cfg.adminOnly', 'Only Admin can change this setting.'));
            return;
        }
        var modal = ensureResetZeroModal();
        var body = document.getElementById('rwResetBody');
        var title = document.getElementById('rwResetTitle');
        var phase = 'loading';
        var adminUser = null;
        var smsMasked = '';
        var gateTitle = opts.title || tr('rewards.cfg.resetZeroTitle', 'Reset reward points to zero');

        function paintAuth(step) {
            phase = step;
            title.textContent = gateTitle;
            var heading = step === 'sms'
                ? tr('login.adminStep.smsTitle', 'SMS verification')
                : tr('login.adminStep.totpTitle', 'Authenticator verification');
            var phoneLabel = smsMasked || (typeof ADMINVERIFY !== 'undefined' ? ADMINVERIFY.phoneMask : '');
            var hint = step === 'sms'
                ? tr('login.adminStep.smsSent', 'A verification code was sent by SMS to {PHONE}.')
                    .replace(/\{PHONE\}/g, phoneLabel)
                : tr('login.adminStep.totpSub', 'Enter the 6-digit code from Google Authenticator.');
            var btnLabel = step === 'sms'
                ? tr('login.adminStep.smsVerifyBtn', 'Verify SMS')
                : tr('login.totpStep.verifyBtn', 'Verify');
            body.innerHTML =
                '<p class="rw-reset-sub">' + esc(heading) + '</p>' +
                '<p class="rw-reset-hint">' + esc(hint) + '</p>' +
                '<input id="rwResetAuthCode" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6" ' +
                'autocomplete="one-time-code" placeholder="000000" class="rw-reset-code">' +
                '<div class="rw-reset-actions">' +
                '<button type="button" class="btn btn--primary" id="rwResetAuthSubmit">' + esc(btnLabel) + '</button>' +
                (step === 'sms'
                    ? '<button type="button" class="btn" id="rwResetAuthResend">' +
                      esc(tr('login.adminStep.resendSms', 'Resend SMS')) + '</button>'
                    : '') +
                '<button type="button" class="btn" id="rwResetAuthCancel">' +
                esc(tr('common.cancel', 'Cancel')) + '</button>' +
                '</div>';
            setResetZeroError('');
            var inp = document.getElementById('rwResetAuthCode');
            if (inp) setTimeout(function () { inp.focus(); }, 30);
            var submit = document.getElementById('rwResetAuthSubmit');
            var cancel = document.getElementById('rwResetAuthCancel');
            var resend = document.getElementById('rwResetAuthResend');
            if (cancel) cancel.onclick = function () { closeResetZeroModal(); };
            if (resend) {
                resend.onclick = function () {
                    if (typeof ADMINVERIFY === 'undefined' || !ADMINVERIFY.resend) return;
                    resend.disabled = true;
                    ADMINVERIFY.resend().then(function (res) {
                        resend.disabled = false;
                        if (res && res.ok) {
                            smsMasked = res.phone_masked || smsMasked;
                            paintAuth('sms');
                        }
                    }).catch(function () { resend.disabled = false; });
                };
            }
            if (submit) submit.onclick = function () { submitAuth(); };
            if (inp) {
                inp.onkeydown = function (ev) {
                    if (ev.key === 'Enter') submitAuth();
                };
            }
        }

        function submitAuth() {
            var inp = document.getElementById('rwResetAuthCode');
            var submit = document.getElementById('rwResetAuthSubmit');
            var token = String(inp && inp.value || '').trim();
            setResetZeroError('');
            if (!/^\d{6}$/.test(token)) {
                setResetZeroError(tr('login.totpStep.errInvalid', 'Invalid code. Try again.'));
                return;
            }
            if (submit) submit.disabled = true;

            function fail() {
                if (submit) submit.disabled = false;
                setResetZeroError(tr('login.totpStep.errInvalid', 'Invalid code. Try again.'));
                if (inp) { inp.value = ''; inp.focus(); }
            }

            if (phase === 'sms') {
                if (typeof ADMINVERIFY === 'undefined' || !ADMINVERIFY.check) { fail(); return; }
                ADMINVERIFY.check(token).then(function (res) {
                    if (!res || !res.ok) { fail(); return; }
                    paintAuth('totp');
                }).catch(fail);
                return;
            }

            var secret = adminUser && String(adminUser.totp_secret || '').trim();
            if (!secret) {
                if (submit) submit.disabled = false;
                setResetZeroError(tr('login.totpStep.errNoSecret', 'Authenticator is not set up for this admin.'));
                return;
            }
            if (typeof _totpVerify !== 'function') {
                if (submit) submit.disabled = false;
                setResetZeroError(tr('rewards.cfg.resetZeroErrVerify', 'Verification unavailable. Reload and try again.'));
                return;
            }
            _totpVerify(secret, token).then(function (ok) {
                if (!ok) { fail(); return; }
                if (!opts.keepOpen) closeResetZeroModal();
                if (typeof opts.onSuccess === 'function') {
                    try { opts.onSuccess(adminUser); } catch (e1) { /* ignore */ }
                }
            }).catch(fail);
        }

        if (typeof openModal === 'function') openModal('rwResetZeroModal');
        modal.style.display = 'flex';
        title.textContent = gateTitle;
        body.innerHTML = '<p class="rw-reset-hint">' + esc(tr('common.loadingEllipsis', 'Loading…')) + '</p>';
        setResetZeroError('');
        var closeX = document.getElementById('rwResetCloseX');
        if (closeX) closeX.onclick = function () { closeResetZeroModal(); };

        loadCurrentAdminUser().then(function (res) {
            if (!res || !res.ok) {
                setResetZeroError((res && res.error) || tr('rewards.cfg.adminOnly', 'Only Admin can change this setting.'));
                return;
            }
            adminUser = res.user;
            var hasTotp = !!(adminUser && String(adminUser.totp_secret || '').trim());

            function startTotpOnly() {
                if (!hasTotp) {
                    setResetZeroError(tr('login.totpStep.errNoSecret', 'Authenticator is not set up for this admin.'));
                    return;
                }
                paintAuth('totp');
            }

            if (typeof ADMINVERIFY === 'undefined' || typeof ADMINVERIFY.send !== 'function') {
                startTotpOnly();
                return;
            }
            ADMINVERIFY.send().then(function (sendRes) {
                if (sendRes && sendRes.ok) {
                    smsMasked = sendRes.phone_masked || smsMasked;
                    paintAuth('sms');
                    return;
                }
                startTotpOnly();
            }).catch(startTotpOnly);
        });
    }

    /**
     * Admin RESET ZERO flow:
     * 1) Twilio SMS + Google Authenticator (same pieces as admin login)
     * 2) Clinic checkboxes (All + each clinic)
     * 3) Type the word "confirm"
     * 4) Wipe balances for selected clinics
     */
    function openResetZeroFlow(clinics) {
        if (!isAdmin()) {
            alert(tr('rewards.cfg.adminOnly', 'Only Admin can change this setting.'));
            return;
        }
        clinics = (clinics || []).slice();
        var body = document.getElementById('rwResetBody');
        var title = document.getElementById('rwResetTitle');
        var selected = { all: false, ids: {}, codes: {} };

        openAdminRewardAuthGate({
            title: tr('rewards.cfg.resetZeroTitle', 'Reset reward points to zero'),
            keepOpen: true,
            onSuccess: function () {
                body = document.getElementById('rwResetBody');
                title = document.getElementById('rwResetTitle');
                paintClinicSelect();
            }
        });

        function paintClinicSelect() {
            body = document.getElementById('rwResetBody');
            title = document.getElementById('rwResetTitle');
            title.textContent = tr('rewards.cfg.resetZeroPickTitle', 'Select clinics to reset');
            var html = '<p class="rw-reset-hint">' +
                esc(tr('rewards.cfg.resetZeroPickHint',
                    'Choose All clinics or individual clinics, then confirm.')) +
                '</p>';
            html += '<div class="rw-reset-clinic-list">';
            html += '<label class="rw-reset-clinic-row rw-reset-clinic-row--all">' +
                '<input type="checkbox" id="rwResetClinicAll">' +
                '<span>' + esc(tr('rewards.cfg.resetZeroAll', 'All clinics')) + '</span></label>';
            clinics.forEach(function (c) {
                var code = String(c.clinic_code || '').trim();
                var name = c.english_name || c.chinese_name || code || String(c.id || '');
                html += '<label class="rw-reset-clinic-row">' +
                    '<input type="checkbox" class="rw-reset-clinic-cb" data-clinic-id="' + esc(c.id) +
                    '" data-clinic-code="' + esc(code) + '">' +
                    '<span><strong>' + esc(code || '—') + '</strong> · ' + esc(name) + '</span></label>';
            });
            html += '</div>';
            html += '<div class="rw-reset-actions">' +
                '<button type="button" class="btn btn--danger" id="rwResetConfirmZero">' +
                esc(tr('rewards.cfg.resetZeroConfirmBtn', 'Confirm set zero')) + '</button>' +
                '<button type="button" class="btn" id="rwResetCancelZero">' +
                esc(tr('common.cancel', 'Cancel')) + '</button></div>';
            body.innerHTML = html;
            setResetZeroError('');

            var allCb = document.getElementById('rwResetClinicAll');
            var cbs = body.querySelectorAll('.rw-reset-clinic-cb');
            function syncFromAll() {
                var on = !!(allCb && allCb.checked);
                selected.all = on;
                cbs.forEach(function (cb) {
                    cb.checked = on;
                    cb.disabled = on;
                });
            }
            function syncFromIndividuals() {
                if (!allCb) return;
                var every = true;
                var any = false;
                cbs.forEach(function (cb) {
                    if (cb.checked) any = true;
                    else every = false;
                });
                if (every && cbs.length) {
                    allCb.checked = true;
                    syncFromAll();
                } else {
                    allCb.checked = false;
                    selected.all = false;
                    cbs.forEach(function (cb) { cb.disabled = false; });
                }
                if (!any && !allCb.checked) selected.all = false;
            }
            if (allCb) allCb.addEventListener('change', syncFromAll);
            cbs.forEach(function (cb) {
                cb.addEventListener('change', syncFromIndividuals);
            });

            document.getElementById('rwResetCancelZero').onclick = function () {
                closeResetZeroModal();
            };
            document.getElementById('rwResetConfirmZero').onclick = function () {
                selected.all = !!(allCb && allCb.checked);
                selected.ids = {};
                selected.codes = {};
                if (!selected.all) {
                    cbs.forEach(function (cb) {
                        if (!cb.checked) return;
                        var id = cb.getAttribute('data-clinic-id');
                        var code = cb.getAttribute('data-clinic-code');
                        if (id) selected.ids[id] = true;
                        if (code) selected.codes[code] = true;
                    });
                }
                var idList = Object.keys(selected.ids);
                var codeList = Object.keys(selected.codes);
                if (!selected.all && !idList.length && !codeList.length) {
                    setResetZeroError(tr('rewards.cfg.resetZeroNeedClinic',
                        'Select All or at least one clinic.'));
                    return;
                }
                paintTypeConfirm();
            };
        }

        function paintTypeConfirm() {
            body = document.getElementById('rwResetBody');
            title = document.getElementById('rwResetTitle');
            title.textContent = tr('rewards.cfg.resetZeroTypeTitle', 'Type confirm to wipe points');
            var scope = selected.all
                ? tr('rewards.cfg.resetZeroAll', 'All clinics')
                : Object.keys(selected.codes).join(', ');
            body.innerHTML =
                '<p class="rw-reset-hint">' +
                esc(tr('rewards.cfg.resetZeroTypeHint',
                    'This permanently sets reward balances to 0 for: {scope}. Type the word confirm below.').replace('{scope}', scope)) +
                '</p>' +
                '<input id="rwResetTypeConfirm" type="text" class="rw-reset-code" autocomplete="off" ' +
                'placeholder="confirm" style="letter-spacing:normal;font-size:16px;text-align:left;">' +
                '<div class="rw-reset-actions">' +
                '<button type="button" class="btn btn--danger" id="rwResetDoWipe">' +
                esc(tr('rewards.cfg.resetZeroWipeBtn', 'Wipe points now')) + '</button>' +
                '<button type="button" class="btn" id="rwResetBackClinics">' +
                esc(tr('common.cancel', 'Cancel')) + '</button></div>';
            setResetZeroError('');
            var inp = document.getElementById('rwResetTypeConfirm');
            if (inp) setTimeout(function () { inp.focus(); }, 30);
            document.getElementById('rwResetBackClinics').onclick = function () {
                closeResetZeroModal();
            };
            document.getElementById('rwResetDoWipe').onclick = function () {
                var typed = String(inp && inp.value || '').trim().toLowerCase();
                if (typed !== 'confirm') {
                    setResetZeroError(tr('rewards.cfg.resetZeroTypeMismatch',
                        'Please type the word confirm exactly.'));
                    return;
                }
                runWipe();
            };
        }

        function runWipe() {
            body = document.getElementById('rwResetBody');
            title = document.getElementById('rwResetTitle');
            body.innerHTML = '<p class="rw-reset-hint">' +
                esc(tr('rewards.cfg.resetZeroRunning', 'Resetting reward points…')) + '</p>';
            setResetZeroError('');
            var idList = Object.keys(selected.ids);
            var codeList = Object.keys(selected.codes);
            zeroClinicBalances({
                all: selected.all,
                clinicIds: idList,
                clinicCodes: codeList,
                source: 'manual',
                note: 'Admin MANUAL RESET ZERO - typed confirm'
            }).then(function (res) {
                body = document.getElementById('rwResetBody');
                title = document.getElementById('rwResetTitle');
                if (!res || !res.ok) {
                    setResetZeroError((res && res.error) || tr('rewards.cfg.resetZeroFailed', 'Reset failed.'));
                    body.innerHTML += '<div class="rw-reset-actions">' +
                        '<button type="button" class="btn" id="rwResetCloseFail">' +
                        esc(tr('common.close', 'Close')) + '</button></div>';
                    var cf = document.getElementById('rwResetCloseFail');
                    if (cf) cf.onclick = function () { closeResetZeroModal(); };
                    return;
                }
                title.textContent = tr('rewards.cfg.resetZeroDoneTitle', 'Reset complete');
                body.innerHTML =
                    '<p class="rw-reset-hint">' +
                    esc(tr('rewards.cfg.resetZeroDone',
                        'Cleared {accounts} account(s), {points} points.').replace('{accounts}', String(res.accounts || 0)).replace('{points}', fmtPts(res.points_cleared || 0))) +
                    (res.batch_id
                        ? ('<br>' + esc(tr('rewards.cfg.resetZeroBatchKept',
                            'Safety log saved. You can Step Back to recover.')))
                        : '') +
                    '</p>' +
                    '<div class="rw-reset-actions">' +
                    '<button type="button" class="btn btn--primary" id="rwResetCloseOk">' +
                    esc(tr('common.close', 'Close')) + '</button></div>';
                document.getElementById('rwResetCloseOk').onclick = function () {
                    closeResetZeroModal();
                    var pane = document.getElementById('cfgPane-rewards');
                    if (pane) renderConfigPane(pane);
                };
            }).catch(function (e) {
                setResetZeroError((e && e.message) || tr('rewards.cfg.resetZeroFailed', 'Reset failed.'));
            });
        }
    }

    // ── SMS ──────────────────────────────────────────────────
    function kindLabel(kind, lang) {
        var map = {
            earn: { en: 'earn', 'zh-Hant': '賺取', 'zh-CN': '赚取' },
            redeem: { en: 'redeem', 'zh-Hant': '使用', 'zh-CN': '使用' },
            transfer_out: { en: 'transfer out', 'zh-Hant': '轉出', 'zh-CN': '转出' },
            transfer_in: { en: 'transfer in', 'zh-Hant': '轉入', 'zh-CN': '转入' },
            void_earn: { en: 'void earn', 'zh-Hant': '撤銷賺取', 'zh-CN': '撤销赚取' },
            void_redeem: { en: 'void redeem', 'zh-Hant': '撤銷使用', 'zh-CN': '撤销使用' },
            adjust: { en: 'adjust', 'zh-Hant': '調整', 'zh-CN': '调整' },
            referral: { en: 'Refer a friend', 'zh-Hant': '介紹新客', 'zh-CN': '介绍新客' },
            net: { en: 'update', 'zh-Hant': '更新', 'zh-CN': '更新' }
        };
        var L = lang || 'en';
        var row = map[kind] || map.net;
        return row[L] || row.en;
    }

    function kindLabelBilingual(kind) {
        return kindLabel(kind, 'zh-Hant') + '/' + kindLabel(kind, 'en');
    }

    function resolveSmsLang() {
        var lang = (typeof appUiLang !== 'undefined' && appUiLang) ? String(appUiLang) :
            (typeof readStoredAppLang === 'function' ? readStoredAppLang() : 'en');
        lang = String(lang || 'en');
        if (lang.indexOf('Hant') >= 0 || lang === 'zh-TW' || lang === 'zh-HK') return 'zh-Hant';
        if (lang.indexOf('CN') >= 0 || lang === 'zh') return 'zh-CN';
        return 'en';
    }

    function looksBilingualTemplate(tpl) {
        var s = String(tpl || '');
        return s.indexOf('變動/Change') >= 0 || s.indexOf('積分更新 / Reward') >= 0 ||
            s.indexOf('结余/Balance') >= 0 || s.indexOf('結餘/Balance') >= 0;
    }

    function buildSmsBody(program, info) {
        // Prefer bilingual templates; fall back to built-in bilingual body.
        var candidates = [
            program && program.sms_template_en,
            program && program.sms_template_zh_hant,
            program && program.sms_template_zh_cn
        ];
        var tpl = '';
        for (var i = 0; i < candidates.length; i++) {
            var c = String(candidates[i] || '').trim();
            if (c && looksBilingualTemplate(c)) { tpl = c; break; }
        }
        if (!tpl || tpl.indexOf('{TOTAL}') < 0) tpl = SMS_FALLBACK_BILINGUAL;
        tpl = tpl
            .replace(/\[Banana\]/g, '[' + SMS_HEADING_NAME + ']')
            .replace(/【Banana】/g, '[' + SMS_HEADING_NAME + ']')
            .replace(/\[Joyful Smile Dental Clinic\]/g, '[' + SMS_HEADING_NAME + ']');
        return tpl
            .replace(/\{CHANGE\}/g, fmtSigned(info.points))
            .replace(/\{BALANCE\}/g, fmtPts(info.balance))
            .replace(/\{KIND\}/g, kindLabelBilingual(info.kind))
            .replace(/\{TOTAL\}/g, fmtPts(info.total != null ? info.total : info.balance))
            .replace(/\{CLINIC\}/g, info.clinic || '')
            .replace(/\{REF\}/g, info.ref || '—')
            .replace(/\{YEAR\}/g, info.year || String(new Date(Date.now() + 8 * 3600000).getUTCFullYear()));
    }

    /** Pure: this chart's balance and the person's all-clinic total from their chart ledgers. */
    function smsBalances(accounts, patientId, fallback) {
        var list = accounts || [];
        var mine = list.filter(function (a) { return String(a.patient_id) === String(patientId); })[0];
        var fb = round2(fallback);
        return {
            balance: mine ? round2(mine.balance) : fb,
            total: list.length ? sumPersonBalance(list) : fb
        };
    }

    function patientPhone(patient) {
        if (!patient) return '';
        return String(patient.phone_number || patient.mobile_phone || '').trim();
    }

    function loadPatientLite(patientId) {
        return SB.from('patients')
            .select('id,patient_no,full_name,chinese_name,phone_number,mobile_phone,clinic_tag')
            .eq('id', patientId)
            .maybeSingle()
            .then(function (r) { return r.data || null; })
            .catch(function () { return null; });
    }

    function logSms(row) {
        return SB.from('reward_sms_log').insert([row]).then(function () {}).catch(function () {});
    }

    function notifyBalanceChange(info) {
        // info: { patientId, points, balance, kind, ledgerId, clinic, ref }
        // Instant banner / panel paint from known balance (do not wait for SMS / re-fetch).
        if (info && info.patientId && info.balance != null && isFinite(Number(info.balance))) {
            refreshBannerBalances(info.patientId, info.balance);
        }
        return loadProgram(false).then(function (program) {
            if (program.sms_notify_enabled === false) {
                return logSms({
                    ledger_id: info.ledgerId || null,
                    patient_id: info.patientId,
                    status: 'skipped_disabled'
                }).then(function () {
                    return { ok: true, skipped: true, reason: 'disabled' };
                });
            }
            return Promise.all([
                loadPatientLite(info.patientId),
                listPersonAccountsFresh(info.patientId).catch(function () { return []; })
            ]).then(function (both) {
                var pat = both[0];
                var bal = smsBalances(both[1], info.patientId, info.balance);
                var phone = patientPhone(pat);
                if (!phone) {
                    return logSms({
                        ledger_id: info.ledgerId || null,
                        patient_id: info.patientId,
                        status: 'skipped_no_phone'
                    }).then(function () {
                        return { ok: true, skipped: true, reason: 'no_phone' };
                    });
                }
                var body = buildSmsBody(program, {
                    points: info.points,
                    balance: bal.balance,
                    total: bal.total,
                    kind: info.kind || 'net',
                    clinic: info.clinic || '',
                    ref: info.ref || ''
                });
                if (typeof AIHELPER === 'undefined' || typeof AIHELPER.sendTwilioOutreach !== 'function') {
                    return logSms({
                        ledger_id: info.ledgerId || null,
                        patient_id: info.patientId,
                        to_phone: phone,
                        body: body,
                        status: 'failed',
                        error: 'AIHELPER unavailable'
                    }).then(function () {
                        return { ok: false, error: 'AIHELPER unavailable' };
                    });
                }
                var name = (pat && (pat.full_name || pat.chinese_name || pat.patient_no)) || 'Patient';
                return AIHELPER.sendTwilioOutreach({
                    channel: 'sms',
                    to: phone,
                    name: name,
                    body: body
                }).then(function (res) {
                    var sid = res && res.result && (res.result.sid || res.result.Sid);
                    return logSms({
                        ledger_id: info.ledgerId || null,
                        patient_id: info.patientId,
                        to_phone: phone,
                        body: body,
                        status: res && res.ok ? 'sent' : 'failed',
                        error: res && !res.ok ? String(res.error || '') : null,
                        twilio_sid: sid || null
                    }).then(function () {
                        return res;
                    });
                });
            });
        }).catch(function (e) {
            return { ok: false, error: (e && e.message) || String(e) };
        });
    }

    function notifyFromRpcResult(res, meta) {
        meta = meta || {};
        if (!res || !res.ok || res.skipped) return Promise.resolve(res);
        var clinic = meta.clinicCode || '';
        if (!clinic && typeof currentClinicCodeForTagging === 'function') {
            clinic = String(currentClinicCodeForTagging() || '');
        }
        return notifyBalanceChange({
            patientId: res.patient_id || meta.patientId,
            points: res.points,
            balance: res.balance,
            kind: res.kind || meta.kind,
            ledgerId: res.ledger_id,
            clinic: clinic,
            ref: meta.ref || ''
        }).then(function () { return res; });
    }

    // ── Refer a friend (points branch; the referral record lives with the coupon module) ──
    var REFERRAL_SETTING_KEY = 'reward_referral';
    var REFERRAL_DEFAULTS = { enabled: false, points: 100, minFirstSpend: 300 };
    var _referralCfg = null;
    var _referralCfgAt = 0;

    /** Pure: saved JSON → { enabled, points, minFirstSpend } (blank / bad values fall back to defaults). */
    function normalizeReferralConfig(raw) {
        var o = raw || {};
        var pts = Number(o.points);
        var min = Number(o.minFirstSpend);
        return {
            enabled: !!o.enabled,
            points: isFinite(pts) && pts >= 0 ? round2(pts) : REFERRAL_DEFAULTS.points,
            minFirstSpend: isFinite(min) && min >= 0 ? round2(min) : REFERRAL_DEFAULTS.minFirstSpend
        };
    }

    function loadReferralConfig(force) {
        if (!force && _referralCfg && (Date.now() - _referralCfgAt) < 30000) return Promise.resolve(_referralCfg);
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            return Promise.resolve(normalizeReferralConfig(REFERRAL_DEFAULTS));
        }
        return Promise.resolve(SB.from('program_settings').select('setting_value').eq('setting_key', REFERRAL_SETTING_KEY))
            .then(function (r) {
                var raw = r && r.data && r.data[0] && r.data[0].setting_value;
                var parsed = REFERRAL_DEFAULTS;
                if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = REFERRAL_DEFAULTS; } }
                _referralCfg = normalizeReferralConfig(parsed);
                _referralCfgAt = Date.now();
                return _referralCfg;
            }, function () { return normalizeReferralConfig(REFERRAL_DEFAULTS); });
    }

    function saveReferralConfig(patch) {
        if (!isAdmin()) return Promise.resolve({ ok: false, error: 'admin only' });
        return loadReferralConfig(true).then(function (cur) {
            var next = normalizeReferralConfig(Object.assign({}, cur, patch || {}));
            var row = { setting_key: REFERRAL_SETTING_KEY, setting_value: JSON.stringify(next) };
            var p = typeof persistProgramSettingRow === 'function'
                ? persistProgramSettingRow(row)
                : SB.from('program_settings').insert([row]);
            return Promise.resolve(p).then(function (r) {
                if (r && r.error) return { ok: false, error: r.error.message };
                _referralCfg = next;
                _referralCfgAt = Date.now();
                return { ok: true, config: next };
            });
        });
    }

    // ── Per-bill ceiling on points used (same idea as the coupon cash limit) ──
    var REDEEM_CAP_KEY = 'reward_redeem_cap';
    var REDEEM_CAP_DEFAULTS = { maxPercent: 0, maxAmount: 3000 };
    var _redeemCap = null;
    var _redeemCapAt = 0;

    /** Pure: 0 / blank = no limit for that box; percent is capped at 100. */
    function normalizeRedeemCap(raw) {
        var o = raw || {};
        function num(v, dflt) {
            var n = parseFloat(v);
            if (v == null || v === '' || !isFinite(n)) return dflt;
            return Math.max(0, n);
        }
        return {
            maxPercent: round2(Math.min(100, num(o.maxPercent, REDEEM_CAP_DEFAULTS.maxPercent))),
            maxAmount: round2(num(o.maxAmount, REDEEM_CAP_DEFAULTS.maxAmount))
        };
    }

    /** Pure: points still usable on a bill worth billTotal after usedOnBill points. Both limits apply; the smaller wins. */
    function redeemCapLeft(billTotal, usedOnBill, cap) {
        cap = normalizeRedeemCap(cap);
        var limit = Infinity;
        if (cap.maxPercent > 0) limit = Math.floor(Math.max(0, Number(billTotal) || 0) * cap.maxPercent) / 100;
        if (cap.maxAmount > 0) limit = Math.min(limit, cap.maxAmount);
        if (limit === Infinity) return { limit: Infinity, used: round2(usedOnBill), left: Infinity };
        limit = round2(limit);
        return { limit: limit, used: round2(usedOnBill), left: round2(Math.max(0, limit - Math.max(0, Number(usedOnBill) || 0))) };
    }

    /** Pure: net points already used on one bill (redeem rows are negative, void_redeem gives them back). */
    function pointsUsedOnBill(rows) {
        var net = 0;
        (rows || []).forEach(function (r) {
            if (r && (r.kind === 'redeem' || r.kind === 'void_redeem')) net += Number(r.points) || 0;
        });
        return round2(Math.max(0, -net));
    }

    function redeemCapText(cap) {
        cap = normalizeRedeemCap(cap);
        var parts = [];
        if (cap.maxPercent > 0) parts.push(cap.maxPercent + '% ' + tr('rewards.cap.ofBill', 'of the bill'));
        if (cap.maxAmount > 0) {
            parts.push((parts.length ? tr('rewards.cap.upTo', 'up to') + ' ' : '') + 'HK$' + Number(cap.maxAmount).toLocaleString('en-US'));
        }
        return parts.join(' ');
    }

    function redeemCapSummary(cap) {
        var t = redeemCapText(cap);
        return t ? tr('rewards.cap.sumMax', 'At most') + ' ' + t + ' ' + tr('rewards.cap.sumPer', 'in points per bill')
            : tr('rewards.cap.noLimit', 'No limit on points per bill');
    }

    function loadRedeemCap(force) {
        if (!force && _redeemCap && (Date.now() - _redeemCapAt) < 30000) return Promise.resolve(_redeemCap);
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve(normalizeRedeemCap(REDEEM_CAP_DEFAULTS));
        return Promise.resolve(SB.from('program_settings').select('setting_value').eq('setting_key', REDEEM_CAP_KEY))
            .then(function (r) {
                var raw = r && r.data && r.data[0] && r.data[0].setting_value;
                var parsed = REDEEM_CAP_DEFAULTS;
                if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = REDEEM_CAP_DEFAULTS; } }
                _redeemCap = normalizeRedeemCap(parsed);
                _redeemCapAt = Date.now();
                return _redeemCap;
            }, function () { return normalizeRedeemCap(REDEEM_CAP_DEFAULTS); });
    }

    function saveRedeemCap(patch) {
        if (!isAdmin()) return Promise.resolve({ ok: false, error: 'admin only' });
        return loadRedeemCap(true).then(function (cur) {
            var next = normalizeRedeemCap(Object.assign({}, cur, patch || {}));
            var row = { setting_key: REDEEM_CAP_KEY, setting_value: JSON.stringify(next) };
            var p = typeof persistProgramSettingRow === 'function'
                ? persistProgramSettingRow(row)
                : SB.from('program_settings').insert([row]);
            return Promise.resolve(p).then(function (r) {
                if (r && r.error) return { ok: false, error: r.error.message };
                _redeemCap = next;
                _redeemCapAt = Date.now();
                return { ok: true, config: next };
            });
        });
    }

    function loadBillPointsUsed(billId) {
        if (!billId || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve(0);
        return Promise.resolve(SB.from('reward_ledger').select('kind,points').eq('bill_id', billId).in('kind', ['redeem', 'void_redeem']))
            .then(function (r) { return r && !r.error ? pointsUsedOnBill(r.data || []) : 0; }, function () { return 0; });
    }

    /** Pure: is the points branch usable here? cfg from loadReferralConfig, joined = clinic + doctor in the points scheme. */
    function referralPointsGate(cfg, joined) {
        if (!cfg || !cfg.enabled || !(Number(cfg.points) > 0)) return { ok: false, reason: 'points_off' };
        if (!joined) return { ok: false, reason: 'points_clinic' };
        return { ok: true, reason: '' };
    }

    function referralAvailability(clinicId, clinicCode, doctorInput) {
        return Promise.all([
            loadReferralConfig(false),
            isClinicJoined(clinicId || null, clinicCode || '', doctorInput).catch(function () { return false; })
        ]).then(function (both) {
            var gate = referralPointsGate(both[0], both[1]);
            gate.config = both[0];
            return gate;
        });
    }

    /** Credit the referrer and text them with the reward points SMS (kind 介紹新客 / Refer a friend). */
    function referralCredit(opts) {
        opts = opts || {};
        if (!opts.patientId || !(Number(opts.points) > 0)) return Promise.resolve({ ok: false, error: 'points required' });
        return rewardRpc('reward_adjust', {
            p_patient_id: opts.patientId,
            p_points_delta: round2(opts.points),
            p_clinic_id: opts.clinicId || null,
            p_clinic_code: opts.clinicCode || null,
            p_created_by: opts.createdBy || actorName() || 'system',
            p_note: opts.note || 'Referral'
        }).then(function (r) {
            if (r.error) return { ok: false, error: r.error.message };
            var res = rpcResult(r.data);
            if (!res || !res.ok || res.skipped) return res || { ok: false, error: 'empty rpc' };
            return notifyBalanceChange({
                patientId: res.patient_id || opts.patientId,
                points: res.points,
                balance: res.balance,
                kind: 'referral',
                ledgerId: res.ledger_id,
                clinic: opts.clinicCode || '',
                ref: opts.ref || ''
            }).then(function (sms) { res.sms = sms; return res; }, function () { return res; });
        });
    }

    /** Take the referral points back (bill voided / chart deleted). Spent points are not forced negative. */
    function referralReverse(opts) {
        opts = opts || {};
        if (!opts.patientId || !(Number(opts.points) > 0)) return Promise.resolve({ ok: false, error: 'points required' });
        return rewardRpc('reward_adjust', {
            p_patient_id: opts.patientId,
            p_points_delta: -round2(opts.points),
            p_clinic_id: opts.clinicId || null,
            p_clinic_code: opts.clinicCode || null,
            p_created_by: opts.createdBy || actorName() || 'system',
            p_note: opts.note || 'Referral reversed'
        }).then(function (r) {
            if (r.error) return { ok: false, error: r.error.message };
            var res = rpcResult(r.data);
            if (res && !res.ok && /negative/i.test(String(res.error || ''))) res.reason = 'spent';
            if (res && res.ok && res.patient_id != null && res.balance != null) refreshBannerBalances(res.patient_id, res.balance);
            return res;
        });
    }

    /** After a payment that may redeem + earn: one SMS with net change. */
    function notifyNetChange(patientId, beforeBal, afterBal, meta) {
        var delta = round2((Number(afterBal) || 0) - (Number(beforeBal) || 0));
        if (Math.abs(delta) < 0.005) return Promise.resolve({ ok: true, skipped: true });
        return notifyBalanceChange({
            patientId: patientId,
            points: delta,
            balance: afterBal,
            kind: 'net',
            ledgerId: meta && meta.ledgerId,
            clinic: (meta && meta.clinicCode) || '',
            ref: (meta && meta.ref) || ''
        });
    }

    // ── Payment save orchestration ───────────────────────────
    /**
     * Insert reward payment row (if any), redeem, then caller inserts cash row.
     * Returns { rewardPaymentId, redeemResult, rewardAmount }
     */
    function applyRedeemForBill(opts) {
        opts = opts || {};
        var pts = round2(opts.points);
        if (pts <= 0) {
            return Promise.resolve({ rewardAmount: 0, rewardPaymentId: null, redeemResult: null });
        }
        var doc = payDoctorFor(opts);
        if (!isKnownRewardDoctor(doc)) {
            return Promise.resolve({
                ok: false,
                error: tr('rewards.pay.needDoctor',
                    'Select the treating doctor on the bill before redeeming reward points.'),
                rewardAmount: 0
            });
        }
        var doctorLabel = doc.label;
        var ctx = clinicCtx();
        var clinicId = opts.clinicId != null ? opts.clinicId : ctx.clinic_id;
        var clinicCode = opts.clinicCode != null ? opts.clinicCode : ctx.clinic_code;

        return Promise.all([
            isClinicRedeemJoined(clinicId, clinicCode, doc),
            listPersonAccounts(opts.patientId),
            loadDoctorLedgerNets(opts.patientId)
        ]).then(function (parts) {
            if (!parts[0]) {
                return {
                    ok: false,
                    error: tr('rewards.pay.doctorNotJoined',
                        'This doctor is not joined for redeem at the current clinic.'),
                    rewardAmount: 0
                };
            }
            parts = parts.slice(1);
            var capped = accountsCappedForDoctor(parts[0], parts[1], doc.key);
            var avail = sumPersonBalance(capped);
            if (pts > avail + 0.005) {
                return {
                    ok: false,
                    error: trRepl('rewards.pay.sameDoctorShort',
                        { DOCTOR: doctorLabel, AVAIL: fmtPts(avail) },
                        'Only ' + fmtPts(avail) + ' pts available for ' + doctorLabel +
                        ' (same doctor only).'),
                    rewardAmount: 0
                };
            }
            var sourceIds = opts.sourceAccountIds || null;
            if (!sourceIds || !sourceIds.length) {
                sourceIds = capped.map(function (a) { return a.account_id; });
            } else {
                var allow = {};
                capped.forEach(function (a) { allow[a.account_id] = true; });
                sourceIds = sourceIds.filter(function (id) { return allow[id]; });
            }
            if (!sourceIds.length) {
                return {
                    ok: false,
                    error: trRepl('rewards.pay.sameDoctorNone',
                        { DOCTOR: doctorLabel },
                        'No reward points for ' + doctorLabel + ' to redeem.'),
                    rewardAmount: 0
                };
            }

            var payRecord = {
                bill_id: opts.billId,
                paid_date: opts.paidDate || (typeof todayISO === 'function' ? todayISO() : null),
                amount: pts,
                method: METHOD,
                notes: opts.note || tr('rewards.pay.redeemNote', 'Reward points discount'),
                received_by: actorName()
            };
            var ctx = clinicCtx();
            payRecord.clinic_id = opts.clinicId || ctx.clinic_id;
            payRecord.clinic_tag = opts.clinicCode || ctx.clinic_code;
            payRecord.clinic_code = opts.clinicCode || ctx.clinic_code;

            function insertPay(rec) {
                return SB.from('bill_payments').insert([rec]).select('id').single()
                    .then(function (ir) {
                        if (ir.error) {
                            var stripped = Object.assign({}, rec);
                            delete stripped.clinic_id;
                            delete stripped.clinic_tag;
                            delete stripped.clinic_code;
                            return SB.from('bill_payments').insert([stripped]).select('id').single();
                        }
                        return ir;
                    });
            }

            return insertPay(payRecord).then(function (ir) {
                if (ir.error) {
                    return { ok: false, error: ir.error.message, rewardAmount: 0 };
                }
                var payId = ir.data && ir.data.id;
                return redeem({
                    patientId: opts.patientId,
                    points: pts,
                    billId: opts.billId,
                    billPaymentId: payId,
                    clinicId: payRecord.clinic_id,
                    clinicCode: payRecord.clinic_code,
                    note: payRecord.notes,
                    sourceAccountIds: sourceIds,
                    doctorName: doctorLabel
                }).then(function (rr) {
                    if (!rr.ok) {
                        if (payId) {
                            SB.from('bill_payments').update({
                                voided_at: new Date().toISOString(),
                                voided_by: actorName()
                            }).eq('id', payId).then(function () {});
                        }
                        return { ok: false, error: rr.error || 'redeem failed', rewardAmount: 0 };
                    }
                    var bal = rr.total_balance != null ? rr.total_balance : rr.balance;
                    if (bal != null) {
                        refreshBannerBalances(opts.patientId, bal);
                    }
                    return {
                        ok: true,
                        rewardAmount: pts,
                        rewardPaymentId: payId,
                        redeemResult: rr,
                        doctorName: doctorLabel
                    };
                });
            });
        });
    }

    function readSelectedPaySourceAccountIds() {
        var box = document.getElementById('apRewardSources');
        if (!box) {
            return (_paySourceAccounts || [])
                .filter(function (a) { return a.account_id && a.balance > 0.005; })
                .map(function (a) { return a.account_id; });
        }
        var ids = [];
        box.querySelectorAll('input.ap-rw-src:checked').forEach(function (cb) {
            var id = cb.getAttribute('data-account-id');
            if (id) ids.push(id);
        });
        return ids;
    }

    function selectedPaySourceRows() {
        var ids = readSelectedPaySourceAccountIds();
        var idSet = {};
        ids.forEach(function (id) { idSet[id] = true; });
        return (_paySourceAccounts || []).filter(function (a) {
            return a.account_id && idSet[a.account_id];
        });
    }

    function groupPaySourcesByClinic(accounts) {
        var groups = {};
        var order = [];
        (accounts || []).forEach(function (a) {
            if (!a || !a.account_id || round2(a.balance) <= 0.005) return;
            var key = String(a.clinic_code || '').trim().toUpperCase() || '_';
            if (!groups[key]) {
                groups[key] = {
                    key: key,
                    clinic_code: String(a.clinic_code || '').trim() || '—',
                    accounts: [],
                    balance: 0
                };
                order.push(key);
            }
            groups[key].accounts.push(a);
            groups[key].balance = round2(groups[key].balance + round2(a.balance));
        });
        order.sort(function (a, b) {
            if (a === '_') return 1;
            if (b === '_') return -1;
            return a.localeCompare(b);
        });
        return order.map(function (k) {
            groups[k].accounts.sort(function (x, y) {
                if (x.balance !== y.balance) return x.balance - y.balance;
                return String(x.patient_no || '').localeCompare(String(y.patient_no || ''));
            });
            return groups[k];
        });
    }

    function updatePayClinicMeta(accounts) {
        var meta = document.getElementById('apRewardClinicMeta');
        if (!meta) return;
        var groups = groupPaySourcesByClinic(accounts || _paySourceAccounts);
        var n = groups.length;
        var total = sumPersonBalance(accounts || _paySourceAccounts);
        if (!isKnownRewardDoctor(_payDoctor) || total <= 0.005 || !n) {
            meta.textContent = '';
            return;
        }
        var codes = groups.map(function (g) { return g.clinic_code; }).filter(Boolean);
        var clinicList = codes.length ? codes.join(', ') : '';
        meta.textContent = trRepl('rewards.pay.clinicMeta', {
            N: String(n),
            CLINICS: clinicList,
            DOCTOR: _payDoctor.label
        }, n === 1
            ? '1 clinic · ' + clinicList + ' · same doctor (' + _payDoctor.label + ')'
            : n + ' clinics · ' + clinicList + ' · same doctor (' + _payDoctor.label + ')');
    }

    function renderPaySourceList(accounts, selectAll) {
        var box = document.getElementById('apRewardSources');
        if (!box) return;
        var withBal = (accounts || []).filter(function (a) {
            return a.account_id && round2(a.balance) > 0.005;
        });
        updatePayClinicMeta(withBal);
        if (!withBal.length) {
            var emptyMsg = (_payDoctor && isKnownRewardDoctor(_payDoctor))
                ? trRepl('rewards.pay.sameDoctorNone', { DOCTOR: _payDoctor.label },
                    'No reward points for ' + _payDoctor.label + ' to redeem.')
                : tr('rewards.pay.noCharts', 'No chart balances available.');
            box.innerHTML = '<div class="ap-rw-empty" style="font-size:12px;color:#94a3b8;">' +
                esc(emptyMsg) + '</div>';
            return;
        }
        var groups = groupPaySourcesByClinic(withBal);
        var flat = [];
        groups.forEach(function (g) {
            g.accounts.forEach(function (a) {
                flat.push({
                    account: a,
                    clinic_code: g.clinic_code,
                    clinic_total: g.balance,
                    clinic_count: g.accounts.length
                });
            });
        });
        var checked = selectAll !== false ? ' checked' : '';
        var head =
            '<div class="ap-rw-clinic-head" aria-hidden="true">' +
            '<span></span>' +
            '<span>' + esc(tr('rewards.pay.colClinic', 'Clinic')) + '</span>' +
            '<span>' + esc(tr('rewards.pay.colChart', 'Chart')) + '</span>' +
            '<span class="ap-rw-num">' + esc(tr('rewards.pay.colPts', 'Points')) + '</span>' +
            '</div>';
        var body = flat.map(function (row, idx) {
            var a = row.account;
            var showClinic = idx === 0 ||
                flat[idx - 1].clinic_code !== row.clinic_code;
            var clinicCell = showClinic
                ? ('<span class="ap-rw-clinic-code">' + esc(row.clinic_code) +
                    (row.clinic_count > 1
                        ? ' <span class="ap-rw-clinic-sub">(' + esc(fmtPts(row.clinic_total)) + ')</span>'
                        : '') +
                    '</span>')
                : '<span class="ap-rw-clinic-code ap-rw-clinic-cont" aria-hidden="true"></span>';
            return '<label class="ap-rw-clinic-row' + (showClinic ? ' ap-rw-clinic-start' : '') + '">' +
                '<input type="checkbox" class="ap-rw-src" data-account-id="' + esc(a.account_id) +
                '" data-clinic="' + esc(row.clinic_code) + '"' + checked + '>' +
                clinicCell +
                '<span class="ap-rw-clinic-charts">#' + esc(a.patient_no || '—') + '</span>' +
                '<span class="ap-rw-num ap-rw-clinic-pts">' + esc(fmtPts(a.balance)) + '</span>' +
                '</label>';
        }).join('');
        box.innerHTML = '<div class="ap-rw-clinic-table">' + head + body + '</div>';
    }

    function updatePayAllocPreview() {
        var prev = document.getElementById('apRewardAllocPreview');
        var amtEl = document.getElementById('apRewardAmount');
        var pts = round2(amtEl ? parseFloat(amtEl.value) : 0);
        var rows = selectedPaySourceRows();
        var totalSel = sumPersonBalance(rows);
        if (prev) {
            if (pts <= 0 || !rows.length) {
                prev.textContent = '';
                return;
            }
            var alloc = allocateAcrossAccounts(rows, pts);
            if (!alloc.ok) {
                prev.textContent = tr('rewards.pay.allocShort', 'Selected clinics do not cover this amount.');
                return;
            }
            prev.textContent = tr('rewards.pay.allocPrefix', 'Will take:') + ' ' +
                alloc.plan.map(function (s) {
                    var clinic = s.clinic_code ? String(s.clinic_code) + ' ' : '';
                    return clinic + '#' + (s.patient_no || '?') + ' −' + fmtPts(s.take);
                }).join(' · ');
        }
        return totalSel;
    }

    function applyEarnForPayment(opts) {
        opts = opts || {};
        var billLike = opts.bill ||
            ((typeof bdCurrentBill !== 'undefined' && bdCurrentBill) ? bdCurrentBill : null);
        var doc = payDoctorFor(opts);
        var doctorName = isKnownRewardDoctor(doc) ? doc.label : (resolveBillDoctorName(billLike) || null);
        return earn({
            doctor: doc,
            patientId: opts.patientId,
            eligibleAmount: opts.eligibleAmount,
            billId: opts.billId,
            billPaymentId: opts.billPaymentId,
            clinicId: opts.clinicId,
            clinicCode: opts.clinicCode,
            note: opts.note || null,
            doctorName: doctorName
        }).then(function (res) {
            if (res && res.ok && !res.skipped && res.balance != null && opts.patientId) {
                refreshBannerBalances(opts.patientId, res.balance);
            }
            return res;
        });
    }

    // ── Add Payment panel UI ─────────────────────────────────
    function readUsePointsFromPanel() {
        var toggle = document.getElementById('apRewardUse');
        if (!toggle || !toggle.checked) return 0;
        var inp = document.getElementById('apRewardAmount');
        return round2(inp ? parseFloat(inp.value) : 0);
    }

    function readRedeemSourceIdsForPayment() {
        return readSelectedPaySourceAccountIds();
    }

    var _payCap = null;

    function paintPayCapNote() {
        var el = document.getElementById('apRewardCapNote');
        if (!el) return;
        if (!_payCap || _payCap.limit === Infinity) { el.hidden = true; el.textContent = ''; return; }
        el.textContent = trRepl('rewards.cap.payNote', {
            LIMIT: fmtPts(_payCap.limit), USED: fmtPts(_payCap.used), LEFT: fmtPts(_payCap.left)
        }, 'Per-bill limit HK$' + fmtPts(_payCap.limit) + ' · already used on this bill ' + fmtPts(_payCap.used) +
            ' · can use now ' + fmtPts(_payCap.left));
        el.hidden = false;
    }

    /** Points still allowed on the open bill by the per-bill limit (Infinity = no limit or not loaded). */
    function payRedeemCapLeft() {
        return _payCap ? _payCap.left : Infinity;
    }

    function syncRewardAmountMax() {
        var amtEl = document.getElementById('apRewardAmount');
        var billBal = 0;
        if (typeof bdCurrentBill !== 'undefined' && bdCurrentBill) {
            billBal = round2(bdCurrentBill.balance);
        }
        var avail = sumPersonBalance(selectedPaySourceRows());
        if (!avail) {
            avail = sumPersonBalance((_paySourceAccounts || []).filter(function (a) {
                return a.account_id && a.balance > 0.005;
            }));
        }
        var max = Math.min(avail, billBal);
        if (_payCap && _payCap.left !== Infinity) max = round2(Math.min(max, _payCap.left));
        paintPayCapNote();
        if (amtEl) {
            amtEl.max = String(max);
            if (!amtEl.value || round2(amtEl.value) > max) amtEl.value = max > 0 ? fmtPts(max) : '';
        }
        updatePayAllocPreview();
        return max;
    }

    function applyRedeemAllOnPayment() {
        var use = document.getElementById('apRewardUse');
        var wrap = document.getElementById('apRewardAmountWrap');
        if (use) {
            use.checked = true;
            use.disabled = false;
        }
        if (wrap) wrap.style.display = '';
        renderPaySourceList(_paySourceAccounts, true);
        var max = syncRewardAmountMax();
        var amtEl = document.getElementById('apRewardAmount');
        if (amtEl) amtEl.value = max > 0 ? fmtPts(max) : '';
        var cash = document.getElementById('apAmount');
        var billBal = (typeof bdCurrentBill !== 'undefined' && bdCurrentBill)
            ? round2(bdCurrentBill.balance) : 0;
        if (cash && billBal > 0) {
            cash.value = fmtPts(Math.max(0, billBal - max));
        }
        updatePayAllocPreview();
    }

    function refreshAddPaymentRewardPanel() {
        var panel = document.getElementById('apRewardPanel');
        if (!panel) return Promise.resolve();
        var bill = (typeof bdCurrentBill !== 'undefined') ? bdCurrentBill : null;
        if (!bill || !bill.patient_id) {
            panel.style.display = 'none';
            _paySourceAccounts = [];
            return Promise.resolve();
        }
        var payDoc = payDoctorFor({ bill: bill });
        _payCap = null;
        var capBillId = bill.id;
        Promise.all([loadRedeemCap(false), loadBillPointsUsed(bill.id)]).then(function (cp) {
            var cur = (typeof bdCurrentBill !== 'undefined') ? bdCurrentBill : null;
            if (!cur || String(cur.id) !== String(capBillId)) return;
            _payCap = redeemCapLeft(parseFloat(cur.total) || 0, cp[1], cp[0]);
            var use = document.getElementById('apRewardUse');
            if (use && use.checked) syncRewardAmountMax();
            else paintPayCapNote();
        });
        var readsP = Promise.all([
            listPersonAccounts(bill.patient_id),
            loadDoctorLedgerNets(bill.patient_id)
        ]);
        readsP.catch(function () { /* handled below */ });
        return currentClinicRedeemJoined(payDoc).then(function (joined) {
            if (!joined) {
                panel.style.display = 'none';
                _paySourceAccounts = [];
                return;
            }
            panel.style.display = '';
            _payDoctor = payDoc;
            return readsP.then(function (parts) {
                _payDoctorNets = parts[1];
                var allAccs = parts[0] || [];
                if (isKnownRewardDoctor(_payDoctor)) {
                    _paySourceAccounts = accountsCappedForDoctor(allAccs, _payDoctorNets, _payDoctor.key);
                } else {
                    _paySourceAccounts = [];
                }
                var bal = sumPersonBalance(_paySourceAccounts);
                var balEl = document.getElementById('apRewardBalance');
                if (balEl) {
                    balEl.textContent = fmtPts(bal);
                    balEl.setAttribute('data-balance', String(bal));
                }
                var drEl = document.getElementById('apRewardDoctor');
                if (drEl) {
                    drEl.textContent = isKnownRewardDoctor(_payDoctor)
                        ? _payDoctor.label
                        : tr('rewards.pay.noDoctor', 'No doctor on bill');
                }
                renderPaySourceList(_paySourceAccounts, true);
                var use = document.getElementById('apRewardUse');
                var amtWrap = document.getElementById('apRewardAmountWrap');
                if (use) {
                    use.checked = false;
                    use.disabled = !isKnownRewardDoctor(_payDoctor) || bal <= 0.005;
                }
                if (amtWrap) amtWrap.style.display = 'none';
                var hint = document.getElementById('apRewardHint');
                if (hint) {
                    if (!isKnownRewardDoctor(_payDoctor)) {
                        hint.textContent = tr('rewards.pay.needDoctor',
                            'Select the treating doctor on the bill before redeeming reward points.');
                    } else if (bal > 0.005) {
                        var nClinics = groupPaySourcesByClinic(_paySourceAccounts).length;
                        hint.textContent = trRepl('rewards.pay.hintSameDoctorCross',
                            { DOCTOR: _payDoctor.label, N: String(nClinics) },
                            'Redeem ' + _payDoctor.label +
                            '\'s points from any of the ' + nClinics +
                            ' clinic(s) below on this bill. Points used here are not counted as income.');
                    } else {
                        hint.textContent = trRepl('rewards.pay.sameDoctorNone',
                            { DOCTOR: _payDoctor.label },
                            'No reward points for ' + _payDoctor.label + ' to redeem.');
                    }
                }
                var prev = document.getElementById('apRewardAllocPreview');
                if (prev) prev.textContent = '';
            });
        }).catch(function () {
            panel.style.display = 'none';
        });
    }

    function wireAddPaymentRewardPanelOnce() {
        if (window.__REWARDS_AP_WIRED__) return;
        window.__REWARDS_AP_WIRED__ = true;
        document.addEventListener('change', function (ev) {
            var t = ev.target;
            if (!t) return;
            if (t.classList && t.classList.contains('ap-rw-src')) {
                syncRewardAmountMax();
                var cash = document.getElementById('apAmount');
                var billBal = (typeof bdCurrentBill !== 'undefined' && bdCurrentBill)
                    ? round2(bdCurrentBill.balance) : 0;
                var pts = readUsePointsFromPanel();
                if (cash && billBal > 0) {
                    cash.value = fmtPts(Math.max(0, billBal - pts));
                }
                return;
            }
            if (t.id !== 'apRewardUse') return;
            var wrap = document.getElementById('apRewardAmountWrap');
            if (wrap) wrap.style.display = t.checked ? '' : 'none';
            if (t.checked) syncRewardAmountMax();
            var cash2 = document.getElementById('apAmount');
            var billBal2 = (typeof bdCurrentBill !== 'undefined' && bdCurrentBill)
                ? round2(bdCurrentBill.balance) : 0;
            var pts2 = t.checked ? readUsePointsFromPanel() : 0;
            if (cash2 && billBal2 > 0) {
                cash2.value = fmtPts(Math.max(0, billBal2 - pts2));
            }
        });
        document.addEventListener('input', function (ev) {
            var t = ev.target;
            if (!t || t.id !== 'apRewardAmount') return;
            syncRewardAmountMax();
            var cash = document.getElementById('apAmount');
            var billBal = (typeof bdCurrentBill !== 'undefined' && bdCurrentBill)
                ? round2(bdCurrentBill.balance) : 0;
            var pts = readUsePointsFromPanel();
            if (cash && billBal > 0) {
                cash.value = fmtPts(Math.max(0, billBal - pts));
            }
        });
        document.addEventListener('click', function (ev) {
            var t = ev.target;
            if (!t || t.id !== 'apRewardRedeemAll') return;
            ev.preventDefault();
            applyRedeemAllOnPayment();
        });
    }

    // ── Patient ledger modal ─────────────────────────────────
    var LEDGER_KIND_ICON = {
        earn: '⭐', redeem: '🎁', transfer_in: '↘', transfer_out: '↗',
        void_earn: '↩', void_redeem: '↩', adjust: '✎', referral: '🤝', net: '•'
    };
    var LEDGER_FILTERS = [
        { key: 'all', kinds: null, i18n: 'rewards.ledger.f.all', label: 'All' },
        { key: 'earn', kinds: ['earn'], i18n: 'rewards.ledger.f.earn', label: 'Earned' },
        { key: 'redeem', kinds: ['redeem'], i18n: 'rewards.ledger.f.redeem', label: 'Used' },
        { key: 'xfer', kinds: ['transfer_in', 'transfer_out'], i18n: 'rewards.ledger.f.xfer', label: 'Transfers' },
        { key: 'other', kinds: ['adjust', 'referral', 'void_earn', 'void_redeem'], i18n: 'rewards.ledger.f.other', label: 'Adjust & void' }
    ];
    var _panelLedgerRows = [];
    var _panelLedgerFilter = 'all';

    /** Pure: referral credits are written as kind 'adjust' with a "Referral…" note; show them as Refer a friend. */
    function ledgerDisplayKind(row) {
        var k = String((row && row.kind) || '').trim() || 'net';
        if (k === 'adjust' && /^referral\b/i.test(String((row && row.note) || '').trim())) return 'referral';
        return k;
    }

    function kindBadge(kind) {
        var label = kindLabel(kind, resolveSmsLang());
        var ico = LEDGER_KIND_ICON[kind] || LEDGER_KIND_ICON.net;
        return '<span class="rw-kind rw-kind--' + esc(kind) + '"><span class="rw-kind-ico" aria-hidden="true">' + ico +
            '</span>' + esc(label) + '</span>';
    }

    /** Pure: rows of one filter chip ('all' = every row). */
    function ledgerFilterRows(rows, key) {
        var f = LEDGER_FILTERS.filter(function (x) { return x.key === key; })[0];
        if (!f || !f.kinds) return (rows || []).slice();
        return (rows || []).filter(function (r) { return f.kinds.indexOf(ledgerDisplayKind(r)) >= 0; });
    }

    /** Pure: totals for the summary strip. */
    function ledgerSummary(rows) {
        var s = { gained: 0, spent: 0, count: 0, last: null };
        (rows || []).forEach(function (r) {
            var p = round2(r && r.points);
            if (p >= 0) s.gained += p; else s.spent += p;
            s.count++;
            if (r && r.created_at && (!s.last || String(r.created_at) > String(s.last))) s.last = r.created_at;
        });
        s.gained = round2(s.gained);
        s.spent = round2(s.spent);
        return s;
    }

    function ledgerMonthKey(iso) {
        var d = new Date(iso);
        if (!iso || isNaN(d.getTime())) return '';
        return d.getFullYear() + '-' + (d.getMonth() + 1);
    }

    function ledgerMonthLabel(iso) {
        var d = new Date(iso);
        try { return d.toLocaleDateString(ledgerDateLocale(), { month: 'long', year: 'numeric' }); } catch (e) { return ledgerMonthKey(iso); }
    }

    function ledgerClock(iso) {
        var d = new Date(iso);
        if (!iso || isNaN(d.getTime())) return '';
        try { return d.toLocaleTimeString(ledgerDateLocale(), { hour: '2-digit', minute: '2-digit', hour12: true }); } catch (e) { return ''; }
    }

    function ledgerClinicTag(row) {
        var tag = String((row && (row._clinic_tag || row.clinic_code || row.clinic_tag)) || '').trim();
        return tag || '—';
    }

    function ledgerDoctorName(row) {
        var dr = String((row && (row._doctor_name || row.doctor_name)) || '').trim();
        return dr || '—';
    }

    var LEDGER_COLS = 6;

    function ledgerMessageRow(text, cls) {
        return '<tr><td colspan="' + LEDGER_COLS + '" class="rw-lg-empty' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</td></tr>';
    }

    /** Ledger rows, newest first, with a divider at each month. */
    function renderLedgerRows(rows) {
        if (!rows || !rows.length) return ledgerMessageRow(tr('rewards.ledger.empty', 'No reward transactions yet.'));
        var lastMonth = '';
        return rows.map(function (row) {
            var html = '';
            var mk = ledgerMonthKey(row.created_at);
            if (mk && mk !== lastMonth) {
                lastMonth = mk;
                html += '<tr class="rw-lg-month"><td colspan="' + LEDGER_COLS + '">' + esc(ledgerMonthLabel(row.created_at)) + '</td></tr>';
            }
            var pts = round2(row.points);
            var kind = ledgerDisplayKind(row);
            var ref = '';
            if (row.bill_id) ref = 'Bill ' + String(row.bill_id).slice(0, 8).toUpperCase();
            if (row.transfer_id) ref = (ref ? ref + ' · ' : '') + 'Xfer ' + String(row.transfer_id).slice(0, 8);
            var note = String(row.note || '').trim();
            var refMain = ref || note || '—';
            var refSub = ref && note ? note : '';
            var dr = ledgerDoctorName(row);
            html += '<tr class="rw-lg-row rw-lg-row--' + esc(kind) + '" title="' + esc(fmtLedgerTimeHK(row.created_at)) + '">' +
                '<td class="rw-lg-when"><div class="rw-lg-date">' + esc(fmtLedgerDateHK(row.created_at)) + '</div>' +
                '<div class="rw-lg-time">' + esc(ledgerClock(row.created_at)) + '</div></td>' +
                '<td class="rw-lg-where"><span class="rw-lg-clinic">' + esc(ledgerClinicTag(row)) + '</span>' +
                (dr !== '—' ? '<div class="rw-lg-dr" title="' + esc(dr) + '">' + esc(dr) + '</div>' : '') + '</td>' +
                '<td>' + kindBadge(kind) + '</td>' +
                '<td class="rw-lg-num"><span class="rw-lg-pts ' + (pts >= 0 ? 'is-pos' : 'is-neg') + '">' + esc(fmtSigned(pts)) + '</span></td>' +
                '<td class="rw-lg-num rw-lg-bal">' + esc(fmtPts(row.balance_after)) + '</td>' +
                '<td class="rw-lg-ref" title="' + esc(refSub ? refMain + ' — ' + refSub : refMain) + '"><div>' + esc(refMain) + '</div>' +
                (refSub ? '<div class="rw-lg-note">' + esc(refSub) + '</div>' : '') + '</td>' +
                '</tr>';
            return html;
        }).join('');
    }

    function renderLedgerSummary(rows) {
        var s = ledgerSummary(rows);
        function tile(cls, key, fb, val) {
            return '<div class="rw-lg-tile' + (cls ? ' ' + cls : '') + '"><span>' + esc(tr(key, fb)) + '</span><b>' + esc(val) + '</b></div>';
        }
        return tile('is-in', 'rewards.ledger.in', 'Points in', fmtSigned(s.gained)) +
            tile('is-out', 'rewards.ledger.out', 'Points out', s.spent ? fmtSigned(s.spent) : fmtPts(0)) +
            tile('', 'rewards.ledger.count', 'Entries', String(s.count)) +
            tile('', 'rewards.ledger.last', 'Last activity', s.last ? fmtLedgerDateHK(s.last) : '—');
    }

    function renderLedgerFilters(rows, active) {
        return LEDGER_FILTERS.map(function (f) {
            var n = ledgerFilterRows(rows, f.key).length;
            var on = f.key === active;
            return '<button type="button" class="rw-lg-chip' + (on ? ' is-active' : '') + '" data-rw-filter="' + f.key + '" role="tab"' +
                ' aria-selected="' + (on ? 'true' : 'false') + '"' + (!n && f.key !== 'all' ? ' disabled' : '') + '>' +
                esc(tr(f.i18n, f.label)) + '<i>' + n + '</i></button>';
        }).join('');
    }

    /** Paint table + summary + chips for the open patient, using the current filter. */
    function paintPanelLedger() {
        var rows = ledgerFilterRows(_panelLedgerRows, _panelLedgerFilter);
        var tbody = document.getElementById('rwLedgerBody');
        if (tbody) {
            tbody.innerHTML = (rows.length || !_panelLedgerRows.length)
                ? renderLedgerRows(rows)
                : ledgerMessageRow(tr('rewards.ledger.noneOfType', 'No entries of this type.'));
        }
        var sum = document.getElementById('rwLedgerSummary');
        if (sum) sum.innerHTML = _panelLedgerRows.length ? renderLedgerSummary(rows) : '';
        var bar = document.getElementById('rwLedgerFilters');
        if (bar) {
            bar.innerHTML = _panelLedgerRows.length ? renderLedgerFilters(_panelLedgerRows, _panelLedgerFilter) : '';
            if (!bar._rwWired) {
                bar._rwWired = true;
                bar.addEventListener('click', function (ev) {
                    var b = ev.target && ev.target.closest ? ev.target.closest('[data-rw-filter]') : null;
                    if (!b || b.disabled) return;
                    _panelLedgerFilter = b.getAttribute('data-rw-filter') || 'all';
                    paintPanelLedger();
                });
            }
        }
    }

    /** Best-effort stamp doctor_name on new ledger row(s) after RPC (column from SQL patch). */
    function stampDoctorOnLedgerResult(res, doctorName) {
        var doc = resolveRewardDoctor(doctorName);
        var name = isKnownRewardDoctor(doc) ? doc.label : String(doctorName || '').trim();
        if (!name || !res || !res.ok) return Promise.resolve(res);
        var ids = [];
        if (res.ledger_id) ids.push(res.ledger_id);
        if (res.parts && res.parts.length) {
            res.parts.forEach(function (p) {
                if (p && p.ledger_id) ids.push(p.ledger_id);
            });
        }
        if (res.from && res.from.ledger_id) ids.push(res.from.ledger_id);
        if (res.to && res.to.ledger_id) ids.push(res.to.ledger_id);
        if (!ids.length) return Promise.resolve(res);
        // Do not hold the payment save on this label write; ledger rows without
        // doctor_name fall back to the bill's doctor until it lands.
        Promise.resolve(SB.from('reward_ledger').update({ doctor_name: name }).in('id', ids))
            .then(invalidatePersonCache, invalidatePersonCache);
        return Promise.resolve(res);
    }

    /**
     * Canonical doctor identity for reward ledger + same-Dr redeem.
     * Prefer DoctorAliases group label (e.g. "Dr Ng Pui Ching").
     */
    function resolveRewardDoctor(input) {
        // Already resolved { key, label } (applyRedeemForBill passes this back
        // into the join check). Do not treat it as a bill: resolveFromBill
        // would return __unknown__ and the fallback would rewrite
        // "ng-pui-ching" into "name:ng pui ching", which misses the joined row.
        if (input && typeof input === 'object' && input.key && input.label &&
            input.key !== '__unknown__' &&
            !input.doctor_name && !input.dentist_name && !input.doctor_tag &&
            !input.doctor_code) {
            return {
                key: String(input.key),
                label: String(input.label).trim(),
                doctor_id: input.doctor_id ? String(input.doctor_id) : null
            };
        }
        var doc = resolveRewardDoctorFromText(input);
        // Bill doctor id lets the join check match the saved doctor row even
        // when the bill's name text resolves to a different key.
        var did = (input && typeof input === 'object')
            ? (input.doctor_id || input.dentist_id || null) : null;
        doc.doctor_id = did ? String(did) : null;
        return doc;
    }

    function resolveRewardDoctorFromText(input) {
        var billLike = null;
        var raw = '';
        if (input && typeof input === 'object') {
            billLike = input;
            raw = String(input.doctor_name || input.dentist_name || input.doctor_tag ||
                input.doctor_code || input.label || '').trim();
        } else {
            raw = String(input || '').trim();
        }
        if (typeof DoctorAliases !== 'undefined' && DoctorAliases) {
            try {
                var docs = (typeof billDoctorList !== 'undefined' && billDoctorList) ? billDoctorList : null;
                var person = null;
                if (billLike && typeof DoctorAliases.resolveFromBill === 'function') {
                    person = DoctorAliases.resolveFromBill(billLike, docs);
                }
                if ((!person || !person.key || person.key === '__unknown__' ||
                        !String(person.label || '').trim() || person.label === '—') &&
                    raw && typeof DoctorAliases.resolveFromTexts === 'function') {
                    person = DoctorAliases.resolveFromTexts([raw]);
                }
                if (person && person.key && person.key !== '__unknown__') {
                    var lab = String(person.label || '').trim();
                    if (lab && lab !== '—') {
                        return { key: person.key, label: lab };
                    }
                }
            } catch (e) { /* ignore */ }
        }
        if (billLike && typeof billDisplayDoctorLabel === 'function') {
            try {
                var bl = String(billDisplayDoctorLabel(billLike) || '').trim();
                if (bl) raw = bl;
            } catch (e2) { /* ignore */ }
        }
        if (!raw) return { key: '__unknown__', label: '' };
        var key = 'name:' + raw.toLowerCase().replace(/^dr\.?\s+/i, '').replace(/\s+/g, ' ').trim();
        return { key: key, label: raw };
    }

    function resolveBillDoctorName(billLike) {
        var d = resolveRewardDoctor(billLike);
        return d.label || '';
    }

    function isKnownRewardDoctor(doc) {
        return !!(doc && doc.key && doc.key !== '__unknown__' && doc.label);
    }

    function applyDoctorNetDelta(byAccount, byDoctor, accountId, doctorKey, label, delta) {
        if (!accountId || !doctorKey || !delta) return;
        if (!byAccount[accountId]) byAccount[accountId] = {};
        if (!byAccount[accountId][doctorKey]) {
            byAccount[accountId][doctorKey] = { bal: 0, label: label || '' };
        }
        byAccount[accountId][doctorKey].bal =
            round2(byAccount[accountId][doctorKey].bal + delta);
        if (label && !byAccount[accountId][doctorKey].label) {
            byAccount[accountId][doctorKey].label = label;
        }
        if (!byDoctor[doctorKey]) byDoctor[doctorKey] = { bal: 0, label: label || '' };
        byDoctor[doctorKey].bal = round2(byDoctor[doctorKey].bal + delta);
        if (label && !byDoctor[doctorKey].label) byDoctor[doctorKey].label = label;
    }

    function doctorWeightMap(byAccount, byDoctor, preferAccountId) {
        var weights = {};
        var total = 0;
        function addFrom(slot) {
            if (!slot) return;
            Object.keys(slot).forEach(function (dk) {
                if (dk === '__unknown__') return;
                var bal = round2(slot[dk].bal);
                if (bal <= 0.005) return;
                if (!weights[dk]) weights[dk] = { bal: 0, label: slot[dk].label || '' };
                weights[dk].bal = round2(weights[dk].bal + bal);
                if (slot[dk].label && !weights[dk].label) weights[dk].label = slot[dk].label;
                total = round2(total + bal);
            });
        }
        if (preferAccountId) addFrom(byAccount[preferAccountId]);
        if (total <= 0.005) {
            weights = {};
            total = 0;
            Object.keys(byAccount || {}).forEach(function (accId) { addFrom(byAccount[accId]); });
        }
        if (total <= 0.005) {
            weights = {};
            total = 0;
            Object.keys(byDoctor || {}).forEach(function (dk) {
                if (dk === '__unknown__') return;
                var bal = round2(byDoctor[dk].bal);
                if (bal <= 0.005) return;
                weights[dk] = { bal: bal, label: byDoctor[dk].label || '' };
                total = round2(total + bal);
            });
        }
        return { weights: weights, total: total };
    }

    /**
     * Chart-to-chart transfers often have null doctor_name. Re-attribute those
     * pairs onto the source chart's doctor mix so same-Dr redeem still sees
     * points that moved to another clinic chart (e.g. PL #001003 → PY #021713).
     */
    function reattributeUnattributedTransfers(byAccount, byDoctor, rows) {
        var outs = [];
        var ins = [];
        (rows || []).forEach(function (row) {
            if (!row || !row.account_id) return;
            if (String(row.doctor_name || '').trim()) return;
            var kind = String(row.kind || '');
            if (kind !== 'transfer_out' && kind !== 'transfer_in') return;
            var pts = round2(row.points);
            if (!pts) return;
            var item = {
                account_id: row.account_id,
                pts: pts,
                transfer_id: String(row.transfer_id || ''),
                created_at: String(row.created_at || '')
            };
            if (kind === 'transfer_out') outs.push(item);
            else ins.push(item);
        });
        var usedIn = {};
        outs.forEach(function (o) {
            var match = null;
            var mi = -1;
            var i;
            for (i = 0; i < ins.length; i++) {
                if (usedIn[i]) continue;
                var cand = ins[i];
                if (o.transfer_id && cand.transfer_id && o.transfer_id === cand.transfer_id) {
                    match = cand;
                    mi = i;
                    break;
                }
                if (o.created_at && cand.created_at === o.created_at &&
                    round2(Math.abs(cand.pts)) === round2(Math.abs(o.pts))) {
                    match = cand;
                    mi = i;
                    break;
                }
            }
            if (!match) return;
            usedIn[mi] = true;
            var P = round2(Math.abs(o.pts));
            if (P <= 0.005) return;
            var wm = doctorWeightMap(byAccount, byDoctor, o.account_id);
            if (wm.total <= 0.005) {
                // Source doctor nets may already be ~0 after redeems; fall back to
                // historical earn volume on the source chart so the transfer still
                // lands under the earning doctor(s).
                var earnW = {};
                var earnT = 0;
                (rows || []).forEach(function (row) {
                    if (!row || row.account_id !== o.account_id) return;
                    var kind = String(row.kind || '');
                    if (kind !== 'earn' && kind !== 'void_earn') return;
                    var raw = String(row.doctor_name || '').trim();
                    if (!raw) return;
                    var doc = resolveRewardDoctor(raw);
                    if (!isKnownRewardDoctor(doc)) return;
                    var pts = Math.abs(round2(row.points));
                    if (pts <= 0.005) return;
                    if (!earnW[doc.key]) earnW[doc.key] = { bal: 0, label: doc.label || '' };
                    earnW[doc.key].bal = round2(earnW[doc.key].bal + pts);
                    if (doc.label && !earnW[doc.key].label) earnW[doc.key].label = doc.label;
                    earnT = round2(earnT + pts);
                });
                wm = { weights: earnW, total: earnT };
            }
            if (wm.total <= 0.005) return;
            var keys = Object.keys(wm.weights);
            var allocated = 0;
            keys.forEach(function (dk, idx) {
                var share = (idx === keys.length - 1)
                    ? round2(P - allocated)
                    : round2(P * (wm.weights[dk].bal / wm.total));
                allocated = round2(allocated + share);
                if (share <= 0) return;
                var lab = wm.weights[dk].label || '';
                // Clear unknown on both sides, put signed transfer onto doctors.
                applyDoctorNetDelta(byAccount, byDoctor, o.account_id, '__unknown__', '', share);
                applyDoctorNetDelta(byAccount, byDoctor, o.account_id, dk, lab, -share);
                applyDoctorNetDelta(byAccount, byDoctor, match.account_id, '__unknown__', '', -share);
                applyDoctorNetDelta(byAccount, byDoctor, match.account_id, dk, lab, share);
            });
        });
    }

    /**
     * Net points per account × doctor from ledger (signed points already).
     * Rows missing doctor_name fall back to linked bill doctor when possible.
     */
    function loadDoctorLedgerNets(patientId) {
        if (!patientId) {
            return Promise.resolve({ byAccount: {}, byDoctor: {}, rows: [] });
        }
        return personMemo('nets', patientId, function () {
            return loadDoctorLedgerNetsFresh(patientId);
        });
    }

    function loadDoctorLedgerNetsFresh(patientId) {
        return findRelatedPatientIds(patientId).then(function (ids) {
            if (!ids.length) ids = [patientId];
            return SB.from('reward_ledger')
                .select('id,account_id,patient_id,kind,points,doctor_name,bill_id,transfer_id,created_at')
                .in('patient_id', ids)
                .limit(5000)
                .then(function (r) {
                    if (r.error) throw r.error;
                    return r.data || [];
                })
                .then(function (rows) {
                    var needBills = [];
                    var seenB = {};
                    rows.forEach(function (row) {
                        if (!String(row.doctor_name || '').trim() && row.bill_id && !seenB[row.bill_id]) {
                            seenB[row.bill_id] = true;
                            needBills.push(row.bill_id);
                        }
                    });
                    var billsP = needBills.length
                        ? loadBillsDoctorFields(needBills)
                        : Promise.resolve({ data: [] });
                    return billsP.then(function (br) {
                        var billMap = {};
                        (br.data || []).forEach(function (b) { billMap[b.id] = b; });
                        var byAccount = {};
                        var byDoctor = {};
                        rows.forEach(function (row) {
                            var pts = round2(row.points);
                            if (!pts) return;
                            var rawName = String(row.doctor_name || '').trim();
                            var doc = rawName
                                ? resolveRewardDoctor(rawName)
                                : (row.bill_id && billMap[row.bill_id]
                                    ? resolveRewardDoctor(billMap[row.bill_id])
                                    : { key: '__unknown__', label: '' });
                            var dk = doc.key || '__unknown__';
                            var accId = row.account_id || '';
                            applyDoctorNetDelta(byAccount, byDoctor, accId, dk, doc.label || '', pts);
                        });
                        reattributeUnattributedTransfers(byAccount, byDoctor, rows);
                        return { byAccount: byAccount, byDoctor: byDoctor, rows: rows };
                    });
                })
                .catch(function () {
                    return { byAccount: {}, byDoctor: {}, rows: [] };
                });
        });
    }

    function doctorBalOnAccount(nets, accountId, doctorKey) {
        if (!nets || !nets.byAccount || !accountId || !doctorKey) return 0;
        var slot = nets.byAccount[accountId] && nets.byAccount[accountId][doctorKey];
        return slot ? round2(Math.max(0, slot.bal)) : 0;
    }

    function doctorTotalBal(nets, doctorKey) {
        if (!nets || !nets.byDoctor || !doctorKey) return 0;
        var slot = nets.byDoctor[doctorKey];
        return slot ? round2(Math.max(0, slot.bal)) : 0;
    }

    /**
     * Cap chart balances to points available for this doctor.
     * Leftover unattributed nets (__unknown__: orphan adjusts / unpaired
     * transfers) are included when this doctor already has attributed points
     * for the person — so cross-clinic chart balances stay usable.
     */
    function accountsCappedForDoctor(accounts, nets, doctorKey) {
        var personDoc = doctorTotalBal(nets, doctorKey);
        return (accounts || []).map(function (a) {
            var docBal = doctorBalOnAccount(nets, a.account_id, doctorKey);
            var unattrib = doctorBalOnAccount(nets, a.account_id, '__unknown__');
            var avail = (personDoc > 0.005 || docBal > 0.005)
                ? round2(docBal + unattrib)
                : docBal;
            var capped = round2(Math.min(round2(a.balance), avail));
            return Object.assign({}, a, {
                balance: capped,
                _doctor_balance: docBal,
                _unattrib_balance: unattrib,
                _full_balance: round2(a.balance)
            });
        }).filter(function (a) {
            return a.account_id && a.balance > 0.005;
        });
    }

    function getRedeemableBalanceForDoctor(patientId, doctorInput) {
        var doc = resolveRewardDoctor(doctorInput);
        if (!isKnownRewardDoctor(doc)) return Promise.resolve(0);
        return Promise.all([
            listPersonAccounts(patientId),
            loadDoctorLedgerNets(patientId)
        ]).then(function (parts) {
            var capped = accountsCappedForDoctor(parts[0], parts[1], doc.key);
            return sumPersonBalance(capped);
        });
    }

    /**
     * Under the ledger Balance total: show clinic chips when ≥2 clinics hold points.
     * Single-clinic / empty → hide (avoid noise). Person-scoped, not doctor-scoped.
     */
    function renderPanelClinicBreakdown(accounts) {
        var el = document.getElementById('rwPatientClinicBreakdown');
        if (!el) return;
        var groups = groupPaySourcesByClinic(accounts || []);
        if (groups.length < 2) {
            el.style.display = 'none';
            el.hidden = true;
            el.innerHTML = '';
            el.removeAttribute('aria-label');
            return;
        }
        var ariaParts = [];
        var html = groups.map(function (g, idx) {
            var pts = fmtPts(g.balance);
            ariaParts.push(g.clinic_code + ' ' + pts);
            var chip = '<span class="rw-bal-chip"><b class="rw-bal-clinic">' + esc(g.clinic_code) +
                '</b> <span class="rw-bal-pts">' + esc(pts) + '</span></span>';
            if (idx > 0) {
                return '<span class="rw-bal-sep" aria-hidden="true">·</span>' + chip;
            }
            return chip;
        }).join('');
        el.innerHTML = html;
        el.setAttribute('aria-label', trRepl('rewards.panel.clinicBreakdownAria', {
            DETAIL: ariaParts.join(', ')
        }, 'Balance by clinic: ' + ariaParts.join(', ')));
        el.hidden = false;
        el.style.display = 'block';
    }

    function openPatientPanel(patientId) {
        if (!patientId) return;
        _panelPatientId = patientId;
        var modal = document.getElementById('rewardPatientModal');
        if (!modal) {
            alert(tr('rewards.err.modalMissing', 'Reward panel not found. Reload the page.'));
            return;
        }
        var meta = document.getElementById('rwPatientMeta');
        var balEl = document.getElementById('rwPatientBalance');
        var tbody = document.getElementById('rwLedgerBody');
        _panelLedgerRows = [];
        _panelLedgerFilter = 'all';
        paintPanelLedger();
        var openQr = modal.querySelector('.dc-wqr');
        if (openQr && openQr.__dcCancel) openQr.__dcCancel();
        syncPhoneQrBtn();
        if (tbody) tbody.innerHTML = ledgerMessageRow(tr('common.loadingEllipsis', 'Loading…'));
        if (typeof openModal === 'function') openModal('rewardPatientModal');
        else modal.style.display = 'flex';

        var accsPromise = listPersonAccounts(patientId).then(function (accs) {
            _panelSourceAccounts = accs || [];
            var total = sumPersonBalance(_panelSourceAccounts);
            if (balEl) {
                balEl.textContent = fmtPts(total);
                balEl.setAttribute('data-balance', String(total));
            }
            renderPanelClinicBreakdown(_panelSourceAccounts);
            renderPanelSourceList(_panelSourceAccounts, true);
            syncAdminAdjustUi(total);
            var started = document.getElementById('rwPatientStarted');
            if (started) {
                var earliest = null;
                (_panelSourceAccounts || []).forEach(function (a) {
                    if (a.started_at && (!earliest || a.started_at < earliest)) earliest = a.started_at;
                });
                started.textContent = earliest ? fmtLedgerDateHK(earliest) : '—';
            }
            return _panelSourceAccounts;
        }).catch(function () {
            _panelSourceAccounts = [];
            if (balEl) {
                balEl.textContent = fmtPts(0);
                balEl.setAttribute('data-balance', '0');
            }
            renderPanelClinicBreakdown([]);
            return [];
        });

        Promise.all([
            loadPatientLite(patientId).catch(function () { return null; }),
            accsPromise,
            findRelatedPatientIds(patientId).then(function (ids) {
                if (!ids.length) return loadLedger(patientId, 250);
                return SB.from('reward_ledger')
                    .select('*')
                    .in('patient_id', ids)
                    .order('created_at', { ascending: false })
                    .limit(250)
                    .then(function (r) {
                        if (r.error) return loadLedger(patientId, 250);
                        return sortLedgerNewestFirst(r.data || []);
                    })
                    .catch(function () { return loadLedger(patientId, 250); });
            }).catch(function () { return loadLedger(patientId, 250); })
        ]).then(function (parts) {
            var pat = parts[0];
            var accs = parts[1] || _panelSourceAccounts || [];
            var rows = parts[2] || [];
            if (meta) {
                var name = pat ? (pat.full_name || pat.chinese_name || '') : '';
                var no = pat ? (pat.patient_no || '') : '';
                var chartN = accs.filter(function (a) { return a.account_id && a.balance > 0.005; }).length;
                meta.textContent = (no ? ('#' + no + '  ') : '') + name +
                    (chartN > 1 ? '  ·  ' + chartN + ' ' + tr('rewards.panel.charts', 'charts') : '');
            }
            return enrichLedgerMeta(rows || [], null).then(function (enriched) {
                if (String(_panelPatientId) !== String(patientId)) return;
                _panelLedgerRows = enriched || [];
                paintPanelLedger();
                var xferErr = document.getElementById('rwTransferError');
                if (xferErr) { xferErr.style.display = 'none'; xferErr.textContent = ''; }
                var xferAmt = document.getElementById('rwTransferAmount');
                if (xferAmt) xferAmt.value = '';
                var xferNote = document.getElementById('rwTransferNote');
                if (xferNote) xferNote.value = '';
                var xferTo = document.getElementById('rwTransferTo');
                if (xferTo) xferTo.value = '';
                var xferToId = document.getElementById('rwTransferToId');
                if (xferToId) xferToId.value = '';
                var xferPrev = document.getElementById('rwTransferAllocPreview');
                if (xferPrev) xferPrev.textContent = '';
            });
        }).catch(function (e) {
            if (tbody) tbody.innerHTML = ledgerMessageRow((e && e.message) || tr('rewards.err.load', 'Failed to load rewards.'), 'is-error');
        });
    }

    function renderPanelSourceList(accounts, selectAll) {
        var box = document.getElementById('rwTransferSources');
        if (!box) return;
        var withBal = (accounts || []).filter(function (a) {
            return a.account_id && round2(a.balance) > 0.005;
        });
        if (!withBal.length) {
            box.innerHTML = '<div style="font-size:12px;color:#94a3b8;">' +
                esc(tr('rewards.xfer.noSources', 'No chart balances to transfer from.')) + '</div>';
            return;
        }
        box.innerHTML = '<div style="font-size:12px;color:#64748b;margin-bottom:4px;">' +
            esc(tr('rewards.xfer.sources', 'Source charts (same person)')) + '</div>' +
            withBal.map(function (a) {
                var label = '#' + (a.patient_no || '—') +
                    (a.clinic_code ? ' · ' + a.clinic_code : '') +
                    ' — ' + fmtPts(a.balance);
                var checked = selectAll !== false ? ' checked' : '';
                return '<label style="display:flex;gap:8px;align-items:center;font-size:12px;margin:3px 0;cursor:pointer;">' +
                    '<input type="checkbox" class="rw-xfer-src" data-account-id="' + esc(a.account_id) + '"' + checked + '>' +
                    '<span>' + esc(label) + '</span></label>';
            }).join('');
    }

    function readSelectedTransferSourceIds() {
        var box = document.getElementById('rwTransferSources');
        var ids = [];
        if (!box) {
            return (_panelSourceAccounts || [])
                .filter(function (a) { return a.account_id && a.balance > 0.005; })
                .map(function (a) { return a.account_id; });
        }
        box.querySelectorAll('input.rw-xfer-src:checked').forEach(function (cb) {
            var id = cb.getAttribute('data-account-id');
            if (id) ids.push(id);
        });
        return ids;
    }

    function updateTransferAllocPreview() {
        var prev = document.getElementById('rwTransferAllocPreview');
        var amtEl = document.getElementById('rwTransferAmount');
        var pts = round2(amtEl ? parseFloat(amtEl.value) : 0);
        var idSet = {};
        readSelectedTransferSourceIds().forEach(function (id) { idSet[id] = true; });
        var rows = (_panelSourceAccounts || []).filter(function (a) {
            return a.account_id && idSet[a.account_id];
        });
        if (!prev) return;
        if (pts <= 0 || !rows.length) {
            prev.textContent = '';
            return;
        }
        var alloc = allocateAcrossAccounts(rows, pts);
        if (!alloc.ok) {
            prev.textContent = tr('rewards.pay.allocShort', 'Selected charts do not cover this amount.');
            return;
        }
        prev.textContent = alloc.plan.map(function (s) {
            return '#' + (s.patient_no || '?') + ' −' + fmtPts(s.take);
        }).join(' · ');
    }

    /** Pure: WhatsApp message to the patient with their points link (staff press Send in WhatsApp). */
    function pointsWhatsAppText(url, p) {
        var zh = String((p && (p.chinese_name || p.full_name)) || '').trim();
        var en = String((p && (p.full_name || p.chinese_name)) || '').trim();
        return '[' + SMS_HEADING_NAME + ']\n' +
            (zh ? zh + ' ' : '') + '你好！按以下連結即可在手機查看你的積分結餘及紀錄：\n' +
            'Hi' + (en ? ' ' + en : '') + '! Tap the link below to see your reward points balance and history on your phone:\n' +
            String(url || '') + '\n' +
            '請勿轉發此連結。Please do not share this link.';
    }

    function phoneQrConfig() {
        return {
            scheme: 'rewards',
            rpc: 'rw_wallet_link',
            page: 'points.html',
            pngName: 'reward-points-qr.png',
            title: tr('rewards.pqr.title', 'Reward points on the phone'),
            hint: tr('rewards.pqr.hint',
                'Ask the patient to scan this with the phone camera. They can see their points balance and history only — points cannot be used or moved from the phone.'),
            linkLabel: tr('rewards.pqr.link', 'Points link'),
            centre: tr('rewards.pqr.centre', '積分'),
            noSql: tr('rewards.pqr.noSql', 'Points on the phone is not set up yet. Run reward_points_wallet.sql in Supabase first.'),
            fail: tr('rewards.pqr.fail', 'Could not make the points link. Try again.'),
            slip: {
                heading: '我的積分 My reward points',
                tip: '用手機相機掃描，即可查看你的積分。 Scan with the phone camera to see your points.'
            },
            waText: pointsWhatsAppText
        };
    }

    /** Phone QR over the ledger panel: the patient scans it to see their own points (browse only). */
    function openPhoneQr(patientId) {
        var pid = patientId || _panelPatientId;
        // The backdrop, not the panel box: the box is transformed and scrolls, which would clip a fixed overlay.
        var modal = document.getElementById('rewardPatientModal');
        if (!pid || !modal || typeof COUPONS === 'undefined' || !COUPONS || typeof COUPONS.openPhoneQr !== 'function') return null;
        return COUPONS.openPhoneQr(modal, pid, phoneQrConfig());
    }

    function syncPhoneQrBtn() {
        var btn = document.getElementById('rwPhoneQrBtn');
        if (!btn) return;
        btn.hidden = typeof COUPONS === 'undefined' || !COUPONS || typeof COUPONS.openPhoneQr !== 'function';
    }

    function closePatientPanel() {
        var qr = document.querySelector('#rewardPatientModal .dc-wqr');
        if (qr && qr.__dcCancel) qr.__dcCancel();
        if (typeof closeModal === 'function') closeModal('rewardPatientModal');
        else {
            var m = document.getElementById('rewardPatientModal');
            if (m) m.style.display = 'none';
        }
    }

    function syncAdminAdjustUi(/* balance */) {
        var wrap = document.getElementById('rwAdminAdjust');
        if (!wrap) return;
        wrap.style.display = isAdmin() ? 'block' : 'none';
        var err = document.getElementById('rwAdjError');
        if (err) { err.style.display = 'none'; err.textContent = ''; }
        var amt = document.getElementById('rwAdjAmount');
        if (amt && !amt.value) amt.value = '';
        var note = document.getElementById('rwAdjNote');
        if (note) note.value = '';
    }

    function runAdminAdjust(mode) {
        var errEl = document.getElementById('rwAdjError');
        function showErr(msg) {
            if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
        }
        if (!isAdmin()) { showErr(tr('rewards.adj.adminOnly', 'Only Admin can adjust balances.')); return; }
        if (!_panelPatientId) return;

        var note = String((document.getElementById('rwAdjNote') || {}).value || '').trim();
        if (!note) { showErr(tr('rewards.adj.needNote', 'Enter a note for this adjustment.')); return; }

        var balEl = document.getElementById('rwPatientBalance');
        var cur = balEl ? round2(parseFloat(balEl.getAttribute('data-balance') || balEl.textContent)) : 0;
        var amtRaw = round2(parseFloat((document.getElementById('rwAdjAmount') || {}).value));
        var delta = 0;

        if (mode === 'reset') {
            if (cur === 0) { showErr(tr('rewards.adj.alreadyZero', 'Balance is already 0.')); return; }
            if (!window.confirm(tr('rewards.adj.resetConfirm', 'Reset this patient\'s reward balance to 0?'))) return;
            delta = round2(-cur);
            if (!/reset/i.test(note)) note = 'Reset to 0 — ' + note;
        } else if (mode === 'plus' || mode === 'minus') {
            if (!(amtRaw > 0)) { showErr(tr('rewards.adj.needAmt', 'Enter an amount greater than 0.')); return; }
            delta = mode === 'plus' ? amtRaw : round2(-amtRaw);
        } else {
            return;
        }

        adjust({
            patientId: _panelPatientId,
            pointsDelta: delta,
            note: note
        }).then(function (res) {
            if (!res || !res.ok) {
                showErr((res && res.error) || tr('rewards.adj.fail', 'Adjust failed.'));
                return;
            }
            if (res.skipped) {
                showErr(tr('rewards.adj.needAmt', 'Enter an amount greater than 0.'));
                return;
            }
            return notifyFromRpcResult(res, {
                patientId: _panelPatientId,
                clinicCode: clinicCtx().clinic_code || '',
                ref: note.slice(0, 40),
                kind: 'adjust'
            }).then(function () {
                openPatientPanel(_panelPatientId);
            });
        }).catch(function (e) {
            showErr((e && e.message) || tr('rewards.adj.fail', 'Adjust failed.'));
        });
    }

    function wireAdminAdjustOnce() {
        if (window.__REWARDS_ADJ_WIRED__) return;
        window.__REWARDS_ADJ_WIRED__ = true;
        document.addEventListener('click', function (ev) {
            var t = ev.target;
            if (!t || !t.id) return;
            if (t.id === 'rwAdjPlus') { ev.preventDefault(); runAdminAdjust('plus'); }
            else if (t.id === 'rwAdjMinus') { ev.preventDefault(); runAdminAdjust('minus'); }
            else if (t.id === 'rwAdjReset') { ev.preventDefault(); runAdminAdjust('reset'); }
        });
    }

    function openLedgerFinder() {
        var modal = document.getElementById('rewardLedgerFinderModal');
        if (!modal) {
            alert(tr('rewards.err.modalMissing', 'Reward panel not found. Reload the page.'));
            return;
        }
        var q = document.getElementById('rwFinderQ');
        var drop = document.getElementById('rwFinderDrop');
        if (q) q.value = '';
        if (drop) { drop.innerHTML = ''; drop.hidden = true; }
        if (typeof openModal === 'function') openModal('rewardLedgerFinderModal');
        else modal.style.display = 'flex';
        setTimeout(function () { if (q) q.focus(); }, 50);
    }

    function closeLedgerFinder() {
        if (typeof closeModal === 'function') closeModal('rewardLedgerFinderModal');
        else {
            var m = document.getElementById('rewardLedgerFinderModal');
            if (m) m.style.display = 'none';
        }
    }

    function wireLedgerFinderOnce() {
        if (window.__REWARDS_FINDER_WIRED__) return;
        window.__REWARDS_FINDER_WIRED__ = true;
        var timer = null;
        document.addEventListener('input', function (ev) {
            var t = ev.target;
            if (!t || t.id !== 'rwFinderQ') return;
            var drop = document.getElementById('rwFinderDrop');
            clearTimeout(timer);
            timer = setTimeout(function () {
                searchTransferPatients(t.value).then(function (rows) {
                    if (!drop) return;
                    if (!rows.length) {
                        drop.innerHTML = '';
                        drop.hidden = true;
                        return;
                    }
                    drop.hidden = false;
                    drop.innerHTML = rows.map(function (p) {
                        var label = (p.patient_no || '') + '  ' + (p.full_name || p.chinese_name || '');
                        return '<button type="button" class="rw-finder-opt" data-id="' + esc(p.id) + '">' +
                            esc(label) + '</button>';
                    }).join('');
                });
            }, 280);
        });
        document.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest && ev.target.closest('.rw-finder-opt');
            if (!btn) return;
            ev.preventDefault();
            var id = btn.getAttribute('data-id');
            closeLedgerFinder();
            if (id) openPatientPanel(id);
        });
    }

    function clinicDisplayName(code, id, clinicList) {
        var list = clinicList || (typeof APP_CLINICS !== 'undefined' ? APP_CLINICS : []) || [];
        var c = null;
        if (id) {
            for (var i = 0; i < list.length; i++) {
                if (String(list[i].id) === String(id)) { c = list[i]; break; }
            }
        }
        if (!c && code) {
            var up = String(code).toUpperCase();
            for (var j = 0; j < list.length; j++) {
                if (String(list[j].clinic_code || '').toUpperCase() === up) { c = list[j]; break; }
            }
        }
        if (c) {
            var nm = c.english_name || c.chinese_name || '';
            var cc = c.clinic_code || code || '';
            return cc ? (cc + (nm ? ' · ' + nm : '')) : (nm || '—');
        }
        return code || '—';
    }

    /** bills.doctor_code does not exist in this schema — never select it. */
    function loadBillsDoctorFields(billIds) {
        if (!billIds || !billIds.length) return Promise.resolve({ data: [] });
        return SB.from('bills')
            .select('id,doctor_name,doctor_tag,dentist_name,doctor_id')
            .in('id', billIds)
            .then(function (r) {
                if (r.error) {
                    return SB.from('bills')
                        .select('id,doctor_name,doctor_id')
                        .in('id', billIds)
                        .then(function (r2) {
                            if (r2.error) return { data: [] };
                            return r2;
                        })
                        .catch(function () { return { data: [] }; });
                }
                return r;
            })
            .catch(function () { return { data: [] }; });
    }

    /**
     * Persist resolved doctor names onto ledger rows (needs doctor_name column).
     * Best-effort; ignores errors if the SQL patch is not applied yet.
     */
    function backfillLedgerDoctorNames(enrichedRows) {
        var updates = [];
        var seen = {};
        (enrichedRows || []).forEach(function (row) {
            if (!row || !row.id) return;
            if (String(row.doctor_name || '').trim()) return;
            var dr = String(row._doctor_name || '').trim();
            if (!dr || dr === '—') return;
            var canon = resolveRewardDoctor(dr);
            var label = canon.label || dr;
            if (!label || seen[row.id]) return;
            seen[row.id] = true;
            updates.push({ id: row.id, doctor_name: label });
        });
        if (!updates.length) return Promise.resolve(enrichedRows);
        // Chunk updates (anon client has no bulk upsert by primary without conflict target freely)
        var chain = Promise.resolve();
        updates.slice(0, 80).forEach(function (u) {
            chain = chain.then(function () {
                return SB.from('reward_ledger')
                    .update({ doctor_name: u.doctor_name })
                    .eq('id', u.id)
                    .then(function () {})
                    .catch(function () {});
            });
        });
        return chain.then(function () { return enrichedRows; });
    }

    function enrichLedgerMeta(rows, clinicList) {
        rows = rows || [];
        if (!rows.length) return Promise.resolve(rows);
        var ids = [];
        var seen = {};
        var billIds = [];
        var billSeen = {};
        rows.forEach(function (r) {
            var id = r && r.patient_id;
            if (id && !seen[id]) { seen[id] = true; ids.push(id); }
            var bid = r && r.bill_id;
            if (bid && !billSeen[bid] && !String(r.doctor_name || '').trim()) {
                billSeen[bid] = true;
                billIds.push(bid);
            }
        });

        function attach(map, billMap) {
            billMap = billMap || {};
            return rows.map(function (row) {
                var p = map[row.patient_id] || null;
                var name = p ? (p.full_name || p.chinese_name || '') : '';
                var clinicTag = String(row.clinic_code || '').trim() ||
                    (p && p.clinic_tag ? String(p.clinic_tag).trim() : '') || '';
                var dr = String(row.doctor_name || '').trim();
                if (!dr && row.bill_id && billMap[row.bill_id]) {
                    var resolved = resolveRewardDoctor(billMap[row.bill_id]);
                    dr = resolved.label || resolveBillDoctorName(billMap[row.bill_id]) || '';
                }
                return Object.assign({}, row, {
                    _patient_no: p ? (p.patient_no || '') : '',
                    _patient_name: name,
                    _clinic_tag: clinicTag,
                    _clinic_label: clinicDisplayName(row.clinic_code, row.clinic_id, clinicList) ||
                        clinicTag || '—',
                    _doctor_name: dr,
                    _handler: row.created_by || '—'
                });
            });
        }

        var patientsP = ids.length
            ? SB.from('patients')
                .select('id,patient_no,full_name,chinese_name,clinic_tag')
                .in('id', ids)
                .then(function (r) {
                    if (r.error) return { data: [] };
                    return r;
                })
                .catch(function () { return { data: [] }; })
            : Promise.resolve({ data: [] });

        var billsP = loadBillsDoctorFields(billIds);

        return Promise.all([patientsP, billsP]).then(function (parts) {
            var map = {};
            ((parts[0] && parts[0].data) || []).forEach(function (p) { map[p.id] = p; });
            var billMap = {};
            ((parts[1] && parts[1].data) || []).forEach(function (b) { billMap[b.id] = b; });
            var enriched = attach(map, billMap);
            // Fire-and-forget persist when column exists
            backfillLedgerDoctorNames(enriched);
            return enriched;
        }).catch(function () {
            return attach({}, {});
        });
    }

    function searchTransferPatients(q) {
        q = String(q || '').trim();
        if (q.length < 1) return Promise.resolve([]);
        if (typeof PATIENT_SEARCH_SELECT === 'string' && typeof SB !== 'undefined') {
            var safe = q.replace(/[%_,]/g, '');
            return SB.from('patients')
                .select('id,patient_no,full_name,chinese_name,phone_number')
                .or('patient_no.ilike.%' + safe + '%,full_name.ilike.%' + safe + '%,chinese_name.ilike.%' + safe + '%')
                .limit(12)
                .then(function (r) { return r.data || []; })
                .catch(function () { return []; });
        }
        return Promise.resolve([]);
    }

    function submitTransfer() {
        var errEl = document.getElementById('rwTransferError');
        function showErr(msg) {
            if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
        }
        if (!_panelPatientId) return;
        var toId = document.getElementById('rwTransferToId');
        toId = toId ? String(toId.value || '').trim() : '';
        var amt = round2(parseFloat((document.getElementById('rwTransferAmount') || {}).value));
        var note = String((document.getElementById('rwTransferNote') || {}).value || '').trim();
        var sourceIds = readSelectedTransferSourceIds();
        if (!toId) { showErr(tr('rewards.xfer.needTo', 'Select a destination patient chart.')); return; }
        if (toId === String(_panelPatientId)) {
            showErr(tr('rewards.xfer.same', 'Cannot transfer to the same patient.'));
            return;
        }
        if (amt <= 0) { showErr(tr('rewards.xfer.needAmt', 'Enter a points amount greater than 0.')); return; }
        if (!sourceIds.length) {
            showErr(tr('rewards.xfer.needSources', 'Select at least one source chart.'));
            return;
        }

        var ctx = clinicCtx();
        transfer({
            fromPatientId: _panelPatientId,
            toPatientId: toId,
            points: amt,
            clinicId: ctx.clinic_id,
            clinicCode: ctx.clinic_code,
            note: note || null,
            sourceAccountIds: sourceIds
        }).then(function (res) {
            if (!res.ok) {
                showErr(res.error || tr('rewards.xfer.fail', 'Transfer failed.'));
                return;
            }
            var clinic = ctx.clinic_code || '';
            var tasks = [];
            if (res.from) {
                tasks.push(notifyBalanceChange({
                    patientId: res.from.patient_id,
                    points: res.from.points,
                    balance: res.from.balance,
                    kind: 'transfer_out',
                    ledgerId: res.from.ledger_id,
                    clinic: clinic,
                    ref: 'Xfer ' + String(res.transfer_id || '').slice(0, 8)
                }));
            }
            if (res.to) {
                tasks.push(notifyBalanceChange({
                    patientId: res.to.patient_id,
                    points: res.to.points,
                    balance: res.to.balance,
                    kind: 'transfer_in',
                    ledgerId: res.to.ledger_id,
                    clinic: clinic,
                    ref: 'Xfer ' + String(res.transfer_id || '').slice(0, 8)
                }));
            }
            return Promise.all(tasks).then(function () {
                openPatientPanel(_panelPatientId);
            });
        });
    }

    function wireTransferSearchOnce() {
        if (window.__REWARDS_XFER_WIRED__) return;
        window.__REWARDS_XFER_WIRED__ = true;
        var timer = null;
        document.addEventListener('input', function (ev) {
            var t = ev.target;
            if (!t || t.id !== 'rwTransferTo') return;
            var drop = document.getElementById('rwTransferDrop');
            clearTimeout(timer);
            timer = setTimeout(function () {
                searchTransferPatients(t.value).then(function (rows) {
                    if (!drop) return;
                    if (!rows.length) {
                        drop.innerHTML = '';
                        drop.hidden = true;
                        return;
                    }
                    drop.hidden = false;
                    drop.innerHTML = rows.map(function (p) {
                        var label = (p.patient_no || '') + '  ' + (p.full_name || p.chinese_name || '');
                        return '<button type="button" class="rw-xfer-opt" data-id="' + esc(p.id) + '" data-label="' +
                            esc(label) + '">' + esc(label) + '</button>';
                    }).join('');
                });
            }, 280);
        });
        document.addEventListener('click', function (ev) {
            var btn = ev.target && ev.target.closest ? ev.target.closest('.rw-xfer-opt') : null;
            if (!btn) return;
            var idEl = document.getElementById('rwTransferToId');
            var toEl = document.getElementById('rwTransferTo');
            var drop = document.getElementById('rwTransferDrop');
            if (idEl) idEl.value = btn.getAttribute('data-id') || '';
            if (toEl) toEl.value = btn.getAttribute('data-label') || '';
            if (drop) { drop.innerHTML = ''; drop.hidden = true; }
        });
        var submitBtn = document.getElementById('rwTransferSubmit');
        if (submitBtn) submitBtn.addEventListener('click', submitTransfer);
        document.addEventListener('change', function (ev) {
            var t = ev.target;
            if (!t || !t.classList || !t.classList.contains('rw-xfer-src')) return;
            updateTransferAllocPreview();
        });
        document.addEventListener('input', function (ev) {
            var t = ev.target;
            if (!t || t.id !== 'rwTransferAmount') return;
            updateTransferAllocPreview();
        });
    }

    // ── Banner / directory info links ────────────────────────
    function ensureRewardsBannerBtn(subSel, btnId, balId, resolvePatientId) {
        var sub = document.querySelector(subSel);
        if (!sub) return null;
        var btn = document.getElementById(btnId);
        if (!btn) {
            btn = document.createElement('button');
            btn.type = 'button';
            btn.id = btnId;
            btn.className = 'con-banner-balance-btn rw-info-link';
            btn.title = tr('rewards.link.title', 'Reward points');
            btn.innerHTML = '<span>' + esc(tr('rewards.link.label', 'Rewards')) +
                '</span>&nbsp;<strong id="' + balId + '">—</strong>';
            btn.addEventListener('click', function () {
                var pid = resolvePatientId();
                if (pid) openPatientPanel(pid);
            });
            sub.appendChild(btn);
        }
        // Repair older builds that used wrong strong id (btnId + "Bal")
        var balEl = document.getElementById(balId);
        if (!balEl && btn) {
            var strong = btn.querySelector('strong');
            if (strong) strong.id = balId;
            else {
                strong = document.createElement('strong');
                strong.id = balId;
                strong.textContent = '—';
                btn.appendChild(document.createTextNode(' '));
                btn.appendChild(strong);
            }
        }
        return btn;
    }

    function resolveConBannerPatientId() {
        if (typeof conPatientId !== 'undefined' && conPatientId) return conPatientId;
        if (typeof conPatientData !== 'undefined' && conPatientData && conPatientData.id) {
            return conPatientData.id;
        }
        return null;
    }

    function resolveApptBannerPatientId() {
        if (typeof apptActivePatientId === 'function') {
            var a = apptActivePatientId();
            if (a) return a;
        }
        if (typeof getActivePatientId === 'function') {
            var gpid = getActivePatientId();
            if (gpid) return gpid;
        }
        if (typeof activePatientSlots !== 'undefined' && activePatientSlots &&
                activePatientSlots[0] && activePatientSlots[0].id) {
            return activePatientSlots[0].id;
        }
        return null;
    }

    function attachInfoLinks() {
        ensureRewardsBannerBtn(
            '#consultationSection .con-banner-sub',
            'conBannerRewardsBtn',
            'conBannerRewardsBal',
            resolveConBannerPatientId
        );
        ensureRewardsBannerBtn(
            '#apptPatientBanner .con-banner-sub',
            'apptBannerRewardsBtn',
            'apptBannerRewardsBal',
            resolveApptBannerPatientId
        );
        // Remove mistaken nested button from older builds (appended inside balance btn)
        var nested = document.querySelector('#conBannerBalanceBtn #conBannerRewardsBtn');
        if (nested && nested.parentNode) nested.parentNode.removeChild(nested);
    }

    function bannerShowsPatient(patientId) {
        var want = String(patientId || '').trim().toLowerCase();
        if (!want) return { con: false, appt: false };
        var conId = String(resolveConBannerPatientId() || '').trim().toLowerCase();
        var apptId = String(resolveApptBannerPatientId() || '').trim().toLowerCase();
        return {
            con: !!(conId && conId === want),
            appt: !!(apptId && apptId === want)
        };
    }

    function setRewardsBalText(el, pts) {
        if (!el) return;
        el.textContent = pts;
    }

    function paintBannerBalance(patientId, bal) {
        attachInfoLinks(); // ensure buttons + correct strong ids exist
        var pts = fmtPts(bal);
        var show = bannerShowsPatient(patientId);
        var conEl = document.getElementById('conBannerRewardsBal');
        var apptEl = document.getElementById('apptBannerRewardsBal');
        var want = String(patientId || '').trim().toLowerCase();
        var activeCon = String(resolveConBannerPatientId() || '').trim().toLowerCase();
        var activeAppt = String(resolveApptBannerPatientId() || '').trim().toLowerCase();

        if (show.con || (want && want === activeCon)) {
            setRewardsBalText(conEl, pts);
            var conBtn = document.getElementById('conBannerRewardsBtn');
            if (conBtn) conBtn.style.display = '';
        }
        if (show.appt || (want && want === activeAppt)) {
            setRewardsBalText(apptEl, pts);
            var apptBtn = document.getElementById('apptBannerRewardsBtn');
            if (apptBtn) apptBtn.style.display = '';
        }

        if (_panelPatientId && String(_panelPatientId) === String(patientId)) {
            var panelBal = document.getElementById('rwPatientBalance');
            if (panelBal) panelBal.textContent = pts;
        }
        try {
            document.dispatchEvent(new CustomEvent('rewards-balance-changed', {
                detail: { patientId: patientId, balance: round2(bal) }
            }));
        } catch (e) { /* ignore */ }
    }

    /**
     * Refresh banner reward balance. Pass knownBalance for instant paint after earn/redeem/transfer.
     */
    function refreshBannerBalances(patientId, knownBalance) {
        if (!patientId) return Promise.resolve(null);
        attachInfoLinks();
        if (knownBalance != null && isFinite(Number(knownBalance))) {
            var instant = round2(knownBalance);
            paintBannerBalance(patientId, instant);
            return Promise.resolve(instant);
        }
        // Warm the same-doctor ledger the Add Payment panel needs next.
        loadDoctorLedgerNets(patientId).catch(function () {});
        return getBalance(patientId).then(function (bal) {
            paintBannerBalance(patientId, bal);
            return bal;
        }).catch(function () {
            // Still show 0.00 rather than leaving em-dash if fetch fails after account exists elsewhere
            paintBannerBalance(patientId, 0);
            return 0;
        });
    }

    /**
     * After void/delete: re-fetch person totals for whoever the Rewards capsule
     * is showing (consultation + appointment banners), plus an optional preferred id.
     * Multi-chart redeem/void often returns a related chart patient_id that would
     * not match the capsule, leaving the UI stale.
     */
    function refreshActiveBannerBalances(preferredPatientId) {
        attachInfoLinks();
        var ids = [];
        function add(id) {
            id = String(id || '').trim();
            if (!id) return;
            if (ids.indexOf(id) < 0) ids.push(id);
        }
        add(preferredPatientId);
        add(resolveConBannerPatientId());
        add(resolveApptBannerPatientId());
        if (!ids.length) return Promise.resolve(null);
        return Promise.all(ids.map(function (id) {
            return refreshBannerBalances(id);
        })).then(function (bals) {
            var prefer = String(preferredPatientId || '').trim();
            if (prefer) {
                for (var i = 0; i < ids.length; i++) {
                    if (ids[i] === prefer) return bals[i];
                }
            }
            return bals[0];
        });
    }

    // ── Config tab ───────────────────────────────────────────
    function saveRate(rate) {
        if (!isAdmin()) return Promise.resolve({ ok: false, error: 'admin only' });
        var n = Number(rate);
        if (!isFinite(n) || n < 0 || n > 100) {
            return Promise.resolve({ ok: false, error: 'invalid rate' });
        }
        return SB.from('reward_program').update({
            earn_rate_percent: n,
            updated_at: new Date().toISOString(),
            updated_by: actorName()
        }).eq('id', 1).then(function (r) {
            if (r.error) return { ok: false, error: r.error.message };
            _programCache = null;
            return { ok: true };
        });
    }

    function saveSmsEnabled(on) {
        if (!isAdmin()) return Promise.resolve({ ok: false, error: 'admin only' });
        return SB.from('reward_program').update({
            sms_notify_enabled: !!on,
            updated_at: new Date().toISOString(),
            updated_by: actorName()
        }).eq('id', 1).then(function (r) {
            if (r.error) return { ok: false, error: r.error.message };
            _programCache = null;
            return { ok: true };
        });
    }

    function setClinicEnabled(clinicId, clinicCode, enabled) {
        return setClinicJoinFlags(clinicId, clinicCode, {
            join_gain: !!enabled,
            join_redeem: !!enabled,
            enabled: !!enabled
        });
    }

    /** Reception may toggle gain / redeem join per clinic. */
    function setClinicJoinFlags(clinicId, clinicCode, flags) {
        flags = flags || {};
        var gain = flags.join_gain != null ? !!flags.join_gain : !!flags.enabled;
        var redeem = flags.join_redeem != null ? !!flags.join_redeem : !!flags.enabled;
        var payload = {
            clinic_id: clinicId,
            clinic_code: clinicCode || '',
            enabled: gain || redeem,
            join_gain: gain,
            join_redeem: redeem,
            updated_at: new Date().toISOString(),
            updated_by: actorName()
        };
        return SB.from('reward_program_clinics').upsert(payload, { onConflict: 'clinic_id' })
            .then(function (r) {
                if (r.error && /join_gain|join_redeem|column/i.test(String(r.error.message || ''))) {
                    return SB.from('reward_program_clinics').upsert({
                        clinic_id: clinicId,
                        clinic_code: clinicCode || '',
                        enabled: gain || redeem,
                        updated_at: payload.updated_at,
                        updated_by: payload.updated_by
                    }, { onConflict: 'clinic_id' });
                }
                return r;
            })
            .then(function (r) {
                if (r.error) return { ok: false, error: r.error.message };
                _clinicMap = null;
                return { ok: true };
            });
    }

    /** Sync clinic-level OR of all doctor scopes so SQL RPCs stay aligned. */
    function syncClinicFlagsFromDoctorBucket(clinicId, clinicCode, bucket) {
        var gain = false;
        var redeem = false;
        Object.keys(bucket || {}).forEach(function (k) {
            var row = bucket[k];
            if (!row) return;
            if (row.join_gain) gain = true;
            if (row.join_redeem) redeem = true;
        });
        var joined = gain || redeem;
        return setClinicJoinFlags(clinicId, clinicCode, {
            join_gain: joined,
            join_redeem: joined
        });
    }

    /**
     * Upsert one doctor scope under a clinic (__all__ or a doctor key).
     * Also refreshes clinic-level join OR-summary for legacy SQL gates.
     */
    function setDoctorJoinFlags(opts) {
        opts = opts || {};
        var clinicId = opts.clinicId;
        var clinicCode = String(opts.clinicCode || '').trim();
        var doctorKey = String(opts.doctorKey || ALL_DOCTORS_KEY).trim() || ALL_DOCTORS_KEY;
        var gain = opts.join_gain != null ? !!opts.join_gain : !!opts.enabled;
        var redeem = opts.join_redeem != null ? !!opts.join_redeem : !!opts.enabled;
        var label = String(opts.doctorLabel || '').trim() ||
            (doctorKey === ALL_DOCTORS_KEY ? 'All Doctors' : doctorKey);
        var payload = {
            clinic_id: clinicId,
            clinic_code: clinicCode,
            doctor_key: doctorKey,
            doctor_id: opts.doctorId || null,
            doctor_label: label,
            join_gain: gain,
            join_redeem: redeem,
            enabled: gain || redeem,
            updated_at: new Date().toISOString(),
            updated_by: actorName()
        };
        return SB.from('reward_program_doctors')
            .upsert(payload, { onConflict: 'clinic_id,doctor_key' })
            .then(function (r) {
                if (r.error) {
                    var msg = String(r.error.message || '');
                    if (/reward_program_doctors|schema cache|does not exist|PGRST/i.test(msg)) {
                        // Table not patched yet — All Doctors falls back to clinic row only.
                        if (doctorKey === ALL_DOCTORS_KEY) {
                            return setClinicJoinFlags(clinicId, clinicCode, {
                                join_gain: gain,
                                join_redeem: redeem
                            }).then(function (res) {
                                if (!res.ok) return res;
                                return { ok: true, clinicOnly: true };
                            });
                        }
                        return {
                            ok: false,
                            error: tr('rewards.err.needDoctorJoinSql',
                                'Run reward_points_patch_doctor_join.sql in Supabase for per-doctor participation.')
                        };
                    }
                    return { ok: false, error: msg };
                }
                _doctorJoinMap = null;
                return loadDoctorJoinMap(true).then(function (docMap) {
                    var bucket = lookupDoctorClinicBucket(docMap, clinicId, clinicCode) || {};
                    bucket[doctorKey] = {
                        join_gain: gain,
                        join_redeem: redeem,
                        enabled: gain || redeem,
                        doctor_key: doctorKey,
                        doctor_id: opts.doctorId || null,
                        doctor_label: label
                    };
                    return syncClinicFlagsFromDoctorBucket(clinicId, clinicCode, bucket)
                        .then(function () { return { ok: true }; });
                });
            });
    }

    function doctorsForRewardClinic(clinicId) {
        var list = [];
        if (typeof doctorsForClinic === 'function') {
            try { list = doctorsForClinic(clinicId) || []; } catch (e) { list = []; }
        } else if (typeof APP_DOCTORS !== 'undefined' && APP_DOCTORS) {
            list = (APP_DOCTORS || []).filter(function (d) {
                return !clinicId || d.clinic_id === clinicId;
            });
        }
        return (list || []).filter(function (d) {
            if (!d || d.is_active === false) return false;
            if (typeof isBillDropdownExcludedDoctor === 'function') {
                try { return !isBillDropdownExcludedDoctor(d); } catch (e2) { return true; }
            }
            return true;
        }).slice().sort(function (a, b) {
            return doctorJoinLabelFromDoctorRow(a).localeCompare(doctorJoinLabelFromDoctorRow(b));
        });
    }

    var LOYALTY_MANUAL = 'docs/loyalty-manual.html?v=20261028a';

    /** Pure: manual link for one part (rewards | coupons) at the dashboard language. */
    function loyaltyGuideHref(part, lang) {
        lang = String(lang || 'en');
        if (lang !== 'zh-Hant' && lang !== 'zh-CN') lang = lang.indexOf('zh') === 0 ? 'zh-Hant' : 'en';
        return LOYALTY_MANUAL + '#' + (part === 'coupons' ? 'coupons' : 'rewards') + '-' + lang;
    }

    function loyaltyGuideLinkHtml(part) {
        var lang = typeof getAppLang === 'function' ? getAppLang() : 'en';
        return '<a class="xray-helper-guide-btn loyalty-guide-btn" data-guide-part="' + esc(part) + '" href="' +
            esc(loyaltyGuideHref(part, lang)) + '" target="_blank" rel="noopener" title="' +
            esc(tr('loyalty.guideTitle', 'Open the Reward Points & Discount Coupons manual (English / 繁體中文 / 简体中文 — printable, PDF download)')) +
            '">' + esc(tr('loyalty.guideBtn', '📖 How to use')) + '</a>';
    }

    // The dashboard language can change after the pane was drawn.
    document.addEventListener('click', function (e) {
        var a = e.target && e.target.closest ? e.target.closest('.loyalty-guide-btn') : null;
        if (!a) return;
        a.href = loyaltyGuideHref(a.getAttribute('data-guide-part'), typeof getAppLang === 'function' ? getAppLang() : 'en');
    }, true);

    function renderConfigPane(pane) {
        if (!pane) return;
        pane.innerHTML = '<p style="color:#888;">' + esc(tr('common.loadingEllipsis', 'Loading…')) + '</p>';
        var admin = isAdmin();

        Promise.all([
            loadProgram(true),
            SB.from('clinics').select('id,clinic_code,english_name,chinese_name').order('clinic_code'),
            loadClinicJoinMap(true),
            loadDoctorJoinMap(true),
            loadLedger(null, 80),
            loadReferralConfig(true),
            loadRedeemCap(true)
        ]).then(function (parts) {
            var program = parts[0];
            var clinics = (parts[1].data || parts[1]) || [];
            if (parts[1].error) clinics = (typeof APP_CLINICS !== 'undefined' ? APP_CLINICS : []) || [];
            var map = parts[2] || {};
            var docMap = parts[3] || {};
            var ledgerRaw = parts[4] || [];
            return enrichLedgerMeta(ledgerRaw, clinics).then(function (ledger) {
                return { program: program, clinics: clinics, map: map, docMap: docMap, ledger: ledger, referral: parts[5], cap: parts[6] };
            });
        }).then(function (ctx) {
            var program = ctx.program;
            var clinics = ctx.clinics;
            var map = ctx.map;
            var docMap = ctx.docMap || {};
            var ledger = ctx.ledger;

            var rate = Number(program.earn_rate_percent);
            if (!isFinite(rate)) rate = 10;

            var html = '';
            html += '<div class="rw-cfg">';
            html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 8px;">' +
                '<h2 style="margin:0;font-size:20px;">' + esc(tr('rewards.cfg.title', 'Reward Points')) + '</h2>' +
                loyaltyGuideLinkHtml('rewards') + '</div>';
            html += '<p style="margin:0 0 18px;color:#64748b;font-size:13px;">' +
                esc(tr('rewards.cfg.blurb', 'Patients earn points from payments (default 10%). Points used as discount are not counted as clinic income.')) +
                '</p>';

            // Rate
            html += '<div class="rw-cfg-card">';
            html += '<div class="rw-cfg-card-title">' + esc(tr('rewards.cfg.rateTitle', 'Earn rate')) + '</div>';
            if (admin) {
                html += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">';
                html += '<input type="number" id="rwCfgRate" min="0" max="100" step="0.01" value="' +
                    esc(String(rate)) + '" style="width:110px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;">';
                html += '<span>%</span>';
                html += '<button type="button" id="rwCfgRateSave" class="btn btn--primary" style="padding:8px 14px;">' +
                    esc(tr('common.save', 'Save')) + '</button>';
                html += '</div>';
            } else {
                html += '<div style="font-size:22px;font-weight:700;">' + esc(fmtPts(rate)) + '%</div>';
                html += '<div style="font-size:12px;color:#94a3b8;margin-top:4px;">' +
                    esc(tr('rewards.cfg.adminOnly', 'Only Admin can change this setting.')) + '</div>';
            }
            html += '</div>';

            // SMS toggle
            html += '<div class="rw-cfg-card">';
            html += '<div class="rw-cfg-card-title">' + esc(tr('rewards.cfg.smsTitle', 'SMS notify on balance change')) + '</div>';
            if (admin) {
                html += '<label style="display:flex;gap:8px;align-items:center;cursor:pointer;">';
                html += '<input type="checkbox" id="rwCfgSms"' + (program.sms_notify_enabled !== false ? ' checked' : '') + '>';
                html += '<span>' + esc(tr('rewards.cfg.smsLabel', 'Send Twilio SMS when points change')) + '</span></label>';
            } else {
                html += '<div>' + (program.sms_notify_enabled !== false
                    ? esc(tr('common.on', 'On'))
                    : esc(tr('common.off', 'Off'))) + '</div>';
            }
            html += '</div>';

            var refCfg = ctx.referral || normalizeReferralConfig(REFERRAL_DEFAULTS);
            html += '<div class="rw-cfg-card" id="rwCfgReferral">';
            html += '<div class="rw-cfg-card-title">' + esc(tr('rewards.cfg.refTitle', 'Refer a friend (points)')) + '</div>';
            html += '<p style="margin:0 0 10px;font-size:12px;color:#64748b;">' + esc(tr('rewards.cfg.refBlurb',
                'The referrer gets these points when the new patient’s first bill is fully paid and the cash paid is at least the minimum. Staff choose points or a discount coupon under “Referred by”; a choice is greyed out where the clinic is not in that scheme.')) + '</p>';
            if (admin) {
                html += '<label style="display:flex;gap:8px;align-items:center;cursor:pointer;margin-bottom:8px;">' +
                    '<input type="checkbox" id="rwCfgRefOn"' + (refCfg.enabled ? ' checked' : '') + '> ' +
                    '<span>' + esc(tr('rewards.cfg.refOn', 'Give reward points for referrals')) + '</span></label>';
                html += '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">' +
                    '<label>' + esc(tr('rewards.cfg.refPoints', 'Points')) + ' <input type="number" id="rwCfgRefPoints" min="0" step="1" value="' +
                    esc(String(refCfg.points)) + '" style="width:100px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;"></label>' +
                    '<label>' + esc(tr('rewards.cfg.refMin', 'Min first-visit HK$')) + ' <input type="number" id="rwCfgRefMin" min="0" step="1" value="' +
                    (refCfg.minFirstSpend > 0 ? esc(String(refCfg.minFirstSpend)) : '') + '" placeholder="—" style="width:100px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;"></label>' +
                    '<button type="button" id="rwCfgRefSave" class="btn btn--primary" style="padding:8px 14px;">' + esc(tr('common.save', 'Save')) + '</button></div>';
            } else {
                html += '<div>' + (refCfg.enabled
                    ? esc(fmtPts(refCfg.points) + ' ' + tr('rewards.cfg.refPoints', 'Points') + ' · ' +
                        tr('rewards.cfg.refMin', 'Min first-visit HK$') + ' ' + (refCfg.minFirstSpend > 0 ? fmtPts(refCfg.minFirstSpend) : '—'))
                    : esc(tr('common.off', 'Off'))) + '</div>';
            }
            html += '</div>';

            var cap = normalizeRedeemCap(ctx.cap);
            var capInput = 'width:90px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;';
            html += '<div class="rw-cfg-card" id="rwCfgCap">';
            html += '<div class="rw-cfg-card-title">' + esc(tr('rewards.cap.title', 'Using points on one bill')) + '</div>';
            if (admin) {
                html += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
                    '<span style="font-size:13px;font-weight:600;">' + esc(tr('rewards.cap.maxOff', 'Max points used per bill')) + '</span>' +
                    '<input type="number" id="rwCfgCapPct" min="0" max="100" step="1" value="' + (cap.maxPercent > 0 ? esc(String(cap.maxPercent)) : '') +
                    '" placeholder="—" aria-label="' + esc(tr('rewards.cap.pctLabel', 'Max % of the bill')) + '" style="' + capInput + '">' +
                    '<span>% ' + esc(tr('rewards.cap.ofBill', 'of the bill')) + '</span>' +
                    '<span>' + esc(tr('rewards.cap.upTo', 'up to')) + ' HK$</span>' +
                    '<input type="number" id="rwCfgCapAmt" min="0" step="100" value="' + (cap.maxAmount > 0 ? esc(String(cap.maxAmount)) : '') +
                    '" placeholder="—" aria-label="' + esc(tr('rewards.cap.amtLabel', 'Max HK$ per bill')) + '" style="' + capInput + '">' +
                    '<button type="button" id="rwCfgCapSave" class="btn btn--primary" style="padding:8px 14px;">' + esc(tr('common.save', 'Save')) + '</button></div>';
            }
            html += '<p id="rwCfgCapSum" style="margin:8px 0 0;font-size:13px;font-weight:700;color:#166534;">' + esc(redeemCapSummary(cap)) + '</p>';
            html += '<p style="margin:6px 0 0;font-size:12px;color:#64748b;">' + esc(tr('rewards.cap.hint',
                'Counts every payment on the same bill. Default: up to HK$3,000 per bill. Both limits apply and the smaller one wins; leave a box blank to drop that limit. The percentage is of the bill total.')) + '</p>';
            if (!admin) {
                html += '<div style="font-size:12px;color:#94a3b8;margin-top:4px;">' +
                    esc(tr('rewards.cfg.adminOnly', 'Only Admin can change this setting.')) + '</div>';
            }
            html += '</div>';

            // Zero policy + manual RESET ZERO + Step Back recover
            var zeroNorm = normalizeZeroPolicy(program);
            html += '<div class="rw-cfg-card rw-cfg-card--danger">';
            html += '<div class="rw-cfg-card-title">' +
                esc(tr('rewards.cfg.resetZeroTitle', 'Reset reward points to zero')) + '</div>';
            html += '<p style="margin:0 0 12px;font-size:12px;color:#7f1d1d;">' +
                esc(tr('rewards.cfg.resetZeroPolicyBlurb',
                    'Choose how balances are cleared. Saving a policy change requires admin SMS + Google Authenticator. Manual RESET ZERO always keeps a safety log so you can Step Back.')) +
                '</p>';
            if (admin) {
                html += '<div class="rw-zero-policy" role="radiogroup" aria-label="Zero policy">';
                function policyOpt(val, label) {
                    return '<label class="rw-zero-policy-opt">' +
                        '<input type="radio" name="rwZeroPolicy" value="' + esc(val) + '"' +
                        (zeroNorm.zero_policy === val ? ' checked' : '') + '>' +
                        '<span>' + esc(label) + '</span></label>';
                }
                html += policyOpt('manual', tr('rewards.cfg.zeroPolicyManual', 'Manual') +
                    ' (' + tr('rewards.cfg.zeroPolicyDefault', 'default') + ')');
                html += policyOpt('year_end', tr('rewards.cfg.zeroPolicyYearEnd',
                    'Auto set zero every year on 31 Dec 23:59 (HK)'));
                html += policyOpt('lifespan', tr('rewards.cfg.zeroPolicyLifespan',
                    'Set each reward points life span of:'));
                html += '</div>';
                html += '<div id="rwLifespanMonthsWrap" class="rw-lifespan-months"' +
                    (zeroNorm.zero_policy === 'lifespan' ? '' : ' hidden') + '>';
                LIFESPAN_MONTH_OPTIONS.forEach(function (m) {
                    html += '<button type="button" class="rw-lifespan-btn' +
                        (zeroNorm.lifespan_months === m ? ' is-active' : '') +
                        '" data-months="' + m + '">' + m +
                        esc(tr('rewards.cfg.monthsShort', ' mo')) + '</button>';
                });
                html += '</div>';
                html += '<div class="rw-reset-actions" style="margin:12px 0;">';
                html += '<button type="button" id="rwCfgZeroPolicySave" class="btn btn--primary" style="padding:8px 14px;">' +
                    esc(tr('common.save', 'Save')) + '</button>';
                html += '</div>';
                html += '<div style="border-top:1px solid #fecaca;margin:12px 0;padding-top:12px;">';
                html += '<div style="font-weight:700;margin-bottom:8px;font-size:13px;">' +
                    esc(tr('rewards.cfg.resetZeroManualTitle', 'Manual RESET ZERO')) + '</div>';
                html += '<p style="margin:0 0 10px;font-size:12px;color:#7f1d1d;">' +
                    esc(tr('rewards.cfg.resetZeroBlurb',
                        'Requires admin SMS + Google Authenticator. Then pick clinics and type confirm to wipe balances.')) +
                    '</p>';
                html += '<div class="rw-reset-actions">';
                html += '<button type="button" id="rwCfgResetZero" class="btn btn--danger" style="padding:8px 14px;">' +
                    esc(tr('rewards.cfg.resetZeroBtn', 'RESET ZERO')) + '</button>';
                html += '<button type="button" id="rwCfgStepBack" class="btn" style="padding:8px 14px;">' +
                    esc(tr('rewards.cfg.stepBackBtn', 'Step back and recover last balance before set zero')) +
                    '</button>';
                html += '</div>';
                html += '<p id="rwCfgLastBatchMeta" style="margin:10px 0 0;font-size:12px;color:#64748b;"></p>';
                html += '</div>';
            } else {
                html += '<div style="font-size:13px;color:#7f1d1d;">' +
                    esc(tr('rewards.cfg.adminOnly', 'Only Admin can change this setting.')) +
                    ' · ' + esc(zeroNorm.zero_policy === 'year_end'
                        ? tr('rewards.cfg.zeroPolicyYearEnd', 'Auto set zero every year on 31 Dec 23:59 (HK)')
                        : (zeroNorm.zero_policy === 'lifespan'
                            ? (tr('rewards.cfg.zeroPolicyLifespan', 'Set each reward points life span of:') +
                                ' ' + zeroNorm.lifespan_months + tr('rewards.cfg.monthsShort', ' mo'))
                            : tr('rewards.cfg.zeroPolicyManual', 'Manual'))) +
                    '</div>';
            }
            html += '</div>';

            // Clinics → subtabs; body lists All Doctors + doctors (Join toggle)
            html += '<div class="rw-cfg-card">';
            html += '<div class="rw-cfg-card-title">' + esc(tr('rewards.cfg.clinicsTitle', 'Clinics in scheme')) + '</div>';
            html += '<p style="margin:0 0 10px;font-size:12px;color:#64748b;">' +
                esc(tr('rewards.cfg.clinicsHintDoctors',
                    'Default: PL · All Doctors joined. Pick a clinic tab, then Join / leave for All Doctors or an individual doctor.')) +
                '</p>';
            html += '<div class="rw-clinic-scheme">';
            html += '<div class="rw-clinic-tabs" role="tablist">';
            var openClinicIdx = defaultRewardClinicIndex(clinics);
            (clinics || []).forEach(function (c, clinicIdx) {
                var code = String(c.clinic_code || '').trim();
                var name = c.english_name || c.chinese_name || code;
                var bucket = lookupDoctorClinicBucket(docMap, c.id, code) || {};
                var clinicFlags = lookupClinicFlags(map, c.id, code);
                var allFlags = bucket[ALL_DOCTORS_KEY] || defaultAllDoctorsFlags(clinicFlags, code);
                var joined = !!(allFlags.join_gain || allFlags.join_redeem || allFlags.enabled);
                var isActive = clinicIdx === openClinicIdx;
                html += '<button type="button" class="rw-clinic-tab' + (isActive ? ' is-active' : '') +
                    '" role="tab" aria-selected="' + (isActive ? 'true' : 'false') +
                    '" data-clinic-id="' + esc(c.id) +
                    '" data-clinic-code="' + esc(code) +
                    '" title="' + esc(name) + '">' +
                    '<span class="rw-clinic-tab-code">' + esc(code || '—') + '</span>' +
                    (joined ? '<span class="rw-clinic-tab-dot" title="' +
                        esc(tr('rewards.cfg.joined', 'joined')) + '"></span>' : '') +
                    '</button>';
            });
            html += '</div>';
            html += '<div class="rw-clinic-panels">';
            (clinics || []).forEach(function (c, clinicIdx) {
                var code = String(c.clinic_code || '').trim();
                var name = c.english_name || c.chinese_name || code;
                var bucket = lookupDoctorClinicBucket(docMap, c.id, code) || {};
                var clinicFlags = lookupClinicFlags(map, c.id, code);
                var allFlags = bucket[ALL_DOCTORS_KEY] || defaultAllDoctorsFlags(clinicFlags, code);
                var docs = doctorsForRewardClinic(c.id);
                var isActive = clinicIdx === openClinicIdx;
                html += '<div class="rw-clinic-panel' + (isActive ? ' is-active' : '') +
                    '" role="tabpanel" data-clinic-id="' + esc(c.id) +
                    '" data-clinic-code="' + esc(code) +
                    '"' + (isActive ? '' : ' hidden') + '>';
                html += '<div class="rw-clinic-panel-head">' +
                    '<strong>' + esc(code || '—') + '</strong> · ' + esc(name) +
                    '</div>';
                html += '<div class="rw-clinic-docs">';
                function docRowHtml(doctorKey, doctorLabel, doctorId, flags, selected) {
                    var joinedOn = !!(flags && (flags.join_gain || flags.join_redeem || flags.enabled));
                    return '<div class="rw-doc-row' + (selected ? ' is-selected' : '') +
                        '" data-clinic-id="' + esc(c.id) +
                        '" data-clinic-code="' + esc(code) +
                        '" data-doctor-key="' + esc(doctorKey) +
                        '" data-doctor-id="' + esc(doctorId || '') +
                        '" data-doctor-label="' + esc(doctorLabel) +
                        '" tabindex="0" role="button">' +
                        '<span class="rw-doc-label">' + esc(doctorLabel) + '</span>' +
                        '<label class="rw-doc-toggle">' +
                        '<input type="checkbox" class="rw-doc-join"' + (joinedOn ? ' checked' : '') + '>' +
                        '<span>' + esc(tr('rewards.cfg.joinGain', 'Gain')) + '</span>' +
                        '<span class="rw-doc-join-amp">&amp;</span>' +
                        '<span>' + esc(tr('rewards.cfg.joinRedeem', 'Redeem')) + '</span></label>' +
                        '</div>';
                }
                html += docRowHtml(ALL_DOCTORS_KEY,
                    tr('rewards.cfg.allDoctors', 'All Doctors'), '', allFlags, true);
                var parcoLineAdded = false;
                docs.forEach(function (d) {
                    var dKey = doctorJoinKeyFromDoctorRow(d);
                    if (!dKey) return;
                    var dLab = doctorJoinLabelFromDoctorRow(d) || dKey;
                    var dFlags = rewardFlagsMatchKey(bucket, dKey, d.id) ||
                        { join_gain: false, join_redeem: false };
                    html += docRowHtml(dKey, dLab, d.id, dFlags, false);
                    if (dKey === 'parco-poon' && !parcoLineAdded) {
                        parcoLineAdded = true;
                        html += docRowHtml('parco-poon', 'Dr Parco Poon', d.id, dFlags, false);
                    }
                });
                html += '</div></div>';
            });
            html += '</div></div></div>';

            // Summary log
            html += '<div class="rw-cfg-card">';
            html += '<div class="rw-cfg-card-title">' + esc(tr('rewards.cfg.logTitle', 'Summary log')) + '</div>';
            html += '<div style="overflow:auto;max-height:420px;border:1px solid #e2e8f0;border-radius:8px;">';
            html += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
            html += '<thead><tr style="background:#f8fafc;text-align:left;">' +
                '<th style="padding:8px 10px;">' + esc(tr('rewards.col.when', 'When')) + '</th>' +
                '<th style="padding:8px 10px;">' + esc(tr('rewards.col.clinicTag', 'Clinic tags')) + '</th>' +
                '<th style="padding:8px 10px;">' + esc(tr('rewards.col.drName', 'Dr Name')) + '</th>' +
                '<th style="padding:8px 10px;">' + esc(tr('rewards.col.chartNo', 'Chart no.')) + '</th>' +
                '<th style="padding:8px 10px;">' + esc(tr('rewards.col.patient', 'Patient')) + '</th>' +
                '<th style="padding:8px 10px;">' + esc(tr('rewards.col.kind', 'Type')) + '</th>' +
                '<th style="padding:8px 10px;text-align:right;">' + esc(tr('rewards.col.points', 'Points')) + '</th>' +
                '<th style="padding:8px 10px;text-align:right;">' + esc(tr('rewards.col.balance', 'Balance')) + '</th>' +
                '<th style="padding:8px 10px;">' + esc(tr('rewards.col.handler', 'Handled by')) + '</th>' +
                '</tr></thead><tbody>';
            if (!ledger.length) {
                html += '<tr><td colspan="9" style="padding:14px;color:#94a3b8;text-align:center;">' +
                    esc(tr('rewards.ledger.empty', 'No reward transactions yet.')) + '</td></tr>';
            } else {
                ledger.forEach(function (row) {
                    var dt = fmtLedgerTimeHK(row.created_at);
                    html += '<tr style="border-top:1px solid #f1f5f9;">' +
                        '<td style="padding:7px 10px;color:#64748b;white-space:nowrap;">' + esc(dt) + '</td>' +
                        '<td style="padding:7px 10px;font-size:12px;">' +
                        esc(row._clinic_tag || row.clinic_code || row._clinic_label || '—') + '</td>' +
                        '<td style="padding:7px 10px;font-size:12px;">' +
                        esc(row._doctor_name || row.doctor_name || '—') + '</td>' +
                        '<td style="padding:7px 10px;font-size:12px;">' + esc(row._patient_no || '—') + '</td>' +
                        '<td style="padding:7px 10px;font-size:12px;">' + esc(row._patient_name || '—') + '</td>' +
                        '<td style="padding:7px 10px;">' + kindBadge(ledgerDisplayKind(row)) + '</td>' +
                        '<td style="padding:7px 10px;text-align:right;font-weight:700;" class="' +
                        (round2(row.points) >= 0 ? 'rw-pos' : 'rw-neg') + '">' + esc(fmtSigned(row.points)) + '</td>' +
                        '<td style="padding:7px 10px;text-align:right;">' + esc(fmtPts(row.balance_after)) + '</td>' +
                        '<td style="padding:7px 10px;font-size:12px;color:#64748b;">' + esc(row._handler || '—') + '</td>' +
                        '</tr>';
                });
            }
            html += '</tbody></table></div></div>';
            html += '</div>';

            pane.innerHTML = html;

            if (admin) {
                var saveBtn = document.getElementById('rwCfgRateSave');
                if (saveBtn) {
                    saveBtn.addEventListener('click', function () {
                        var inp = document.getElementById('rwCfgRate');
                        saveRate(inp && inp.value).then(function (res) {
                            if (!res.ok) alert(res.error || 'Save failed');
                            else if (typeof toast === 'function') toast(tr('rewards.cfg.saved', 'Saved'));
                            else alert(tr('rewards.cfg.saved', 'Saved'));
                        });
                    });
                }
                var refSave = document.getElementById('rwCfgRefSave');
                if (refSave) {
                    refSave.addEventListener('click', function () {
                        var on = document.getElementById('rwCfgRefOn');
                        var pts = document.getElementById('rwCfgRefPoints');
                        var min = document.getElementById('rwCfgRefMin');
                        saveReferralConfig({
                            enabled: !!(on && on.checked),
                            points: Number(pts && pts.value) || 0,
                            minFirstSpend: Number(min && min.value) || 0
                        }).then(function (res) {
                            if (!res.ok) alert(res.error || 'Save failed');
                            else if (typeof toast === 'function') toast(tr('rewards.cfg.saved', 'Saved'));
                            else alert(tr('rewards.cfg.saved', 'Saved'));
                        });
                    });
                }
                var capSave = document.getElementById('rwCfgCapSave');
                if (capSave) {
                    capSave.addEventListener('click', function () {
                        var pctEl = document.getElementById('rwCfgCapPct');
                        var amtEl = document.getElementById('rwCfgCapAmt');
                        saveRedeemCap({
                            maxPercent: parseFloat(pctEl && pctEl.value) || 0,
                            maxAmount: parseFloat(amtEl && amtEl.value) || 0
                        }).then(function (res) {
                            if (!res.ok) { alert(res.error || 'Save failed'); return; }
                            var c = res.config;
                            if (pctEl) pctEl.value = c.maxPercent > 0 ? String(c.maxPercent) : '';
                            if (amtEl) amtEl.value = c.maxAmount > 0 ? String(c.maxAmount) : '';
                            var sumEl = document.getElementById('rwCfgCapSum');
                            if (sumEl) sumEl.textContent = redeemCapSummary(c);
                            if (typeof toast === 'function') toast(tr('rewards.cfg.saved', 'Saved'));
                            else alert(tr('rewards.cfg.saved', 'Saved'));
                        });
                    });
                }
                var sms = document.getElementById('rwCfgSms');
                if (sms) {
                    sms.addEventListener('change', function () {
                        saveSmsEnabled(sms.checked).then(function (res) {
                            if (!res.ok) alert(res.error || 'Save failed');
                        });
                    });
                }
                var resetZeroBtn = document.getElementById('rwCfgResetZero');
                if (resetZeroBtn) {
                    resetZeroBtn.addEventListener('click', function () {
                        openResetZeroFlow(clinics);
                    });
                }

                function selectedZeroPolicy() {
                    var checked = pane.querySelector('input[name="rwZeroPolicy"]:checked');
                    return checked ? checked.value : 'manual';
                }
                function selectedLifespanMonths() {
                    var active = pane.querySelector('.rw-lifespan-btn.is-active');
                    var m = active ? Number(active.getAttribute('data-months')) : 12;
                    return LIFESPAN_MONTH_OPTIONS.indexOf(m) >= 0 ? m : 12;
                }
                function syncLifespanVisibility() {
                    var wrap = document.getElementById('rwLifespanMonthsWrap');
                    if (!wrap) return;
                    if (selectedZeroPolicy() === 'lifespan') wrap.removeAttribute('hidden');
                    else wrap.setAttribute('hidden', '');
                }
                pane.querySelectorAll('input[name="rwZeroPolicy"]').forEach(function (r) {
                    r.addEventListener('change', syncLifespanVisibility);
                });
                pane.querySelectorAll('.rw-lifespan-btn').forEach(function (btn) {
                    btn.addEventListener('click', function () {
                        pane.querySelectorAll('.rw-lifespan-btn').forEach(function (b) {
                            b.classList.toggle('is-active', b === btn);
                        });
                    });
                });
                var policySave = document.getElementById('rwCfgZeroPolicySave');
                if (policySave) {
                    policySave.addEventListener('click', function () {
                        var policy = selectedZeroPolicy();
                        var months = selectedLifespanMonths();
                        openAdminRewardAuthGate({
                            title: tr('rewards.cfg.zeroPolicyAuthTitle',
                                'Verify to change zero policy'),
                            keepOpen: false,
                            onSuccess: function () {
                                saveZeroPolicy(policy, months).then(function (res) {
                                    if (!res.ok) {
                                        alert(res.error || 'Save failed');
                                        return;
                                    }
                                    if (typeof toast === 'function') toast(tr('rewards.cfg.saved', 'Saved'));
                                    else alert(tr('rewards.cfg.saved', 'Saved'));
                                    renderConfigPane(pane);
                                });
                            }
                        });
                    });
                }

                function refreshLastBatchMeta() {
                    var meta = document.getElementById('rwCfgLastBatchMeta');
                    var stepBtn = document.getElementById('rwCfgStepBack');
                    if (!meta) return;
                    loadLastZeroBatch().then(function (res) {
                        var batch = res && res.batch;
                        if (!batch) {
                            meta.textContent = tr('rewards.cfg.stepBackNone',
                                'No unreverted RESET ZERO safety log yet.');
                            if (stepBtn) stepBtn.disabled = true;
                            return;
                        }
                        var when = fmtLedgerTimeHK(batch.created_at);
                        meta.textContent = tr('rewards.cfg.stepBackMeta',
                            'Last safety log: {when} · {source} · {accounts} accounts · {points} pts')
                            .replace('{when}', when)
                            .replace('{source}', String(batch.source || 'manual'))
                            .replace('{accounts}', String(batch.accounts || 0))
                            .replace('{points}', fmtPts(batch.points_cleared || 0));
                        if (stepBtn) stepBtn.disabled = false;
                    });
                }
                refreshLastBatchMeta();

                var stepBackBtn = document.getElementById('rwCfgStepBack');
                if (stepBackBtn) {
                    stepBackBtn.addEventListener('click', function () {
                        if (!window.confirm(tr('rewards.cfg.stepBackConfirm',
                            'Recover balances from the last RESET ZERO safety log?'))) return;
                        stepBackBtn.disabled = true;
                        revertLastZeroBatch({}).then(function (res) {
                            if (!res || !res.ok) {
                                alert((res && res.error) || tr('rewards.cfg.stepBackFailed', 'Recover failed.'));
                                stepBackBtn.disabled = false;
                                refreshLastBatchMeta();
                                return;
                            }
                            if (typeof toast === 'function') {
                                toast(tr('rewards.cfg.stepBackDone',
                                    'Restored {accounts} account(s), {points} points.')
                                    .replace('{accounts}', String(res.accounts || 0))
                                    .replace('{points}', fmtPts(res.points_restored || 0)));
                            }
                            renderConfigPane(pane);
                        }).catch(function (e) {
                            alert((e && e.message) || tr('rewards.cfg.stepBackFailed', 'Recover failed.'));
                            stepBackBtn.disabled = false;
                        });
                    });
                }
            }

            // Fire scheduled year-end / lifespan jobs after paint (non-blocking)
            maybeRunScheduledZero(program).then(function (autoRes) {
                if (autoRes && autoRes.ok && !autoRes.skipped && Number(autoRes.accounts) > 0) {
                    if (typeof toast === 'function') {
                        toast(tr('rewards.cfg.autoZeroRan',
                            'Auto reset cleared {accounts} account(s).')
                            .replace('{accounts}', String(autoRes.accounts || 0)));
                    }
                }
            }).catch(function () { /* ignore */ });

            function activateClinicTab(clinicId) {
                var id = String(clinicId || '');
                pane.querySelectorAll('.rw-clinic-tab').forEach(function (tab) {
                    var on = String(tab.getAttribute('data-clinic-id') || '') === id;
                    tab.classList.toggle('is-active', on);
                    tab.setAttribute('aria-selected', on ? 'true' : 'false');
                });
                pane.querySelectorAll('.rw-clinic-panel').forEach(function (panel) {
                    var on = String(panel.getAttribute('data-clinic-id') || '') === id;
                    panel.classList.toggle('is-active', on);
                    if (on) panel.removeAttribute('hidden');
                    else panel.setAttribute('hidden', '');
                    if (on) {
                        panel.querySelectorAll('.rw-doc-row').forEach(function (r) {
                            r.classList.toggle('is-selected',
                                r.getAttribute('data-doctor-key') === ALL_DOCTORS_KEY);
                        });
                    }
                });
            }

            function selectDocRow(row) {
                if (!row) return;
                var panel = row.closest('.rw-clinic-panel');
                if (!panel) return;
                panel.querySelectorAll('.rw-doc-row').forEach(function (r) {
                    r.classList.toggle('is-selected', r === row);
                });
            }

            function syncTabDot(clinicId, joined) {
                var tab = pane.querySelector('.rw-clinic-tab[data-clinic-id="' + clinicId + '"]');
                if (!tab) return;
                var dot = tab.querySelector('.rw-clinic-tab-dot');
                if (joined && !dot) {
                    var span = document.createElement('span');
                    span.className = 'rw-clinic-tab-dot';
                    span.title = tr('rewards.cfg.joined', 'joined');
                    tab.appendChild(span);
                } else if (!joined && dot) {
                    dot.parentNode.removeChild(dot);
                }
            }

            pane.querySelectorAll('.rw-clinic-tab').forEach(function (tab) {
                tab.addEventListener('click', function () {
                    activateClinicTab(tab.getAttribute('data-clinic-id'));
                });
            });

            pane.querySelectorAll('.rw-doc-row').forEach(function (row) {
                row.addEventListener('click', function (ev) {
                    if (ev.target && ev.target.closest && ev.target.closest('.rw-doc-toggle')) return;
                    selectDocRow(row);
                });
                row.addEventListener('keydown', function (ev) {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        selectDocRow(row);
                    }
                });
            });

            pane.querySelectorAll('.rw-doc-join').forEach(function (cb) {
                cb.addEventListener('change', function () {
                    var row = cb.closest('.rw-doc-row');
                    if (!row) return;
                    selectDocRow(row);
                    var joined = !!cb.checked;
                    var flags = {
                        clinicId: row.getAttribute('data-clinic-id'),
                        clinicCode: row.getAttribute('data-clinic-code'),
                        doctorKey: row.getAttribute('data-doctor-key') || ALL_DOCTORS_KEY,
                        doctorId: row.getAttribute('data-doctor-id') || null,
                        doctorLabel: row.getAttribute('data-doctor-label') || '',
                        join_gain: joined,
                        join_redeem: joined
                    };
                    function syncSameDoctorJoin(on) {
                        pane.querySelectorAll('.rw-doc-row').forEach(function (other) {
                            if (other.getAttribute('data-clinic-id') !== flags.clinicId) return;
                            if (other.getAttribute('data-doctor-key') !== flags.doctorKey) return;
                            var otherCb = other.querySelector('.rw-doc-join');
                            if (otherCb) otherCb.checked = on;
                        });
                    }
                    syncSameDoctorJoin(joined);
                    setDoctorJoinFlags(flags).then(function (res) {
                        if (!res.ok) {
                            alert(res.error || 'Save failed');
                            if (!res.clinicOnly) syncSameDoctorJoin(!joined);
                            return;
                        }
                        if (typeof toast === 'function') toast(tr('rewards.cfg.saved', 'Saved'));
                        if (flags.doctorKey === ALL_DOCTORS_KEY) {
                            syncTabDot(flags.clinicId, joined);
                        }
                    });
                });
            });
        }).catch(function (e) {
            pane.innerHTML = '<p style="color:#dc2626;">' +
                esc((e && e.message) || tr('rewards.err.load', 'Failed to load rewards.')) +
                '<br><span style="color:#64748b;font-size:12px;">' +
                esc(tr('rewards.err.needSql', 'If tables are missing, run reward_points.sql in Supabase.')) +
                '</span></p>';
        });
    }

    function injectStylesOnce() {
        var s = document.getElementById('rwStyles');
        if (!s) {
            s = document.createElement('style');
            s.id = 'rwStyles';
            document.head.appendChild(s);
        }
        s.textContent =
            '.rw-info-link{margin-left:6px;}' +
            '.rw-pos{color:#16a34a;}.rw-neg{color:#dc2626;}' +
            '.rw-kind{display:inline-flex;align-items:center;gap:4px;padding:2px 9px 2px 7px;border-radius:999px;font-size:11px;font-weight:700;background:#f1f5f9;color:#334155;white-space:nowrap;}' +
            '.rw-kind-ico{font-size:11px;line-height:1;}' +
            '.rw-kind--earn,.rw-kind--transfer_in,.rw-kind--void_redeem{background:#dcfce7;color:#166534;}' +
            '.rw-kind--redeem,.rw-kind--transfer_out,.rw-kind--void_earn{background:#fee2e2;color:#991b1b;}' +
            '.rw-kind--transfer_in,.rw-kind--transfer_out{background:#e0f2fe;color:#075985;}' +
            '.rw-kind--adjust{background:#e0e7ff;color:#3730a3;}' +
            '.rw-kind--referral{background:#fef3c7;color:#92400e;}' +
            '#rewardPatientModal .rw-hero{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;align-items:stretch;}' +
            '.rw-hero-bal{min-width:190px;padding:12px 16px;border-radius:14px;background:linear-gradient(135deg,#ecfdf5 0%,#d1fae5 100%);border:1px solid #a7f3d0;box-shadow:inset 0 1px 0 rgba(255,255,255,.7);}' +
            '.rw-hero-started{padding:12px 16px;border-radius:14px;background:#f8fafc;border:1px solid #e2e8f0;display:flex;flex-direction:column;justify-content:center;}' +
            '.rw-hero-label{font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em;}' +
            '.rw-hero-bal .rw-hero-label{color:#047857;}' +
            '#rwPatientBalance{font-size:30px;font-weight:800;color:#065f46;line-height:1.15;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}' +
            '#rwPatientStarted{font-size:16px;font-weight:700;color:#334155;margin-top:2px;}' +
            '#rewardPatientModal .rw-pqr-btn{margin-top:8px;align-self:flex-start;white-space:nowrap;}' +
            '#rewardPatientModal .rw-pqr-btn[hidden]{display:none;}' +
            '#rwAdminAdjust{padding:10px 12px;border-radius:14px;border:1px dashed #cbd5e1;background:#fff;}' +
            '.rw-lg-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px;}' +
            '.rw-lg-summary:empty,.rw-lg-filters:empty{display:none;}' +
            '.rw-lg-tile{border:1px solid #e2e8f0;border-radius:10px;padding:7px 10px;background:#fff;min-width:0;}' +
            '.rw-lg-tile span{display:block;font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.rw-lg-tile b{display:block;font-size:15px;color:#0f172a;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
            '.rw-lg-tile.is-in{border-color:#bbf7d0;background:#f7fef9;}.rw-lg-tile.is-in b{color:#15803d;}' +
            '.rw-lg-tile.is-out{border-color:#fecaca;background:#fffafa;}.rw-lg-tile.is-out b{color:#b91c1c;}' +
            '.rw-lg-filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;}' +
            '.rw-lg-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #e2e8f0;background:#fff;border-radius:999px;padding:4px 11px;font-size:12px;font-weight:600;color:#475569;cursor:pointer;transition:background .12s,border-color .12s;}' +
            '.rw-lg-chip:hover:not(:disabled){border-color:#86efac;background:#f0fdf4;}' +
            '.rw-lg-chip.is-active{background:#166534;border-color:#166534;color:#fff;}' +
            '.rw-lg-chip i{font-style:normal;font-size:11px;font-variant-numeric:tabular-nums;padding:0 6px;border-radius:999px;background:#f1f5f9;color:#64748b;}' +
            '.rw-lg-chip.is-active i{background:rgba(255,255,255,.22);color:#fff;}' +
            '.rw-lg-chip:disabled{opacity:.45;cursor:default;}' +
            '.rw-lg-wrap{overflow:auto;max-height:320px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:16px;background:#fff;}' +
            '.rw-lg{width:100%;border-collapse:separate;border-spacing:0;font-size:13px;}' +
            '.rw-lg thead th{position:sticky;top:0;z-index:1;background:#f8fafc;padding:8px 10px;text-align:left;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid #e2e8f0;vertical-align:bottom;}' +
            '.rw-lg th.rw-lg-num,.rw-lg td.rw-lg-num{text-align:right;}' +
            '.rw-lg td{padding:7px 10px;border-bottom:1px solid #f1f5f9;vertical-align:middle;}' +
            '.rw-lg-row:hover td{background:#f8fafc;}' +
            '.rw-lg-month td{padding:9px 10px 4px;font-size:11px;font-weight:800;color:#0f766e;text-transform:uppercase;letter-spacing:.05em;background:#fbfefd;border-bottom:1px solid #e2e8f0;}' +
            '.rw-lg-date{font-size:12px;font-weight:600;color:#334155;white-space:nowrap;}' +
            '.rw-lg-time{font-size:11px;color:#94a3b8;white-space:nowrap;}' +
            '.rw-lg-clinic{display:inline-block;padding:1px 7px;border-radius:6px;font-size:11px;font-weight:700;color:#0f766e;background:#f0fdfa;border:1px solid #ccfbf1;}' +
            '.rw-lg-dr{font-size:11px;color:#64748b;margin-top:2px;max-width:118px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.rw-lg-pts{display:inline-block;min-width:62px;padding:2px 8px;border-radius:8px;font-weight:800;font-variant-numeric:tabular-nums;text-align:right;}' +
            '.rw-lg-pts.is-pos{background:#f0fdf4;color:#15803d;}.rw-lg-pts.is-neg{background:#fef2f2;color:#b91c1c;}' +
            '.rw-lg-bal{font-weight:600;color:#334155;font-variant-numeric:tabular-nums;white-space:nowrap;}' +
            '.rw-lg-ref{font-size:12px;color:#475569;max-width:132px;}' +
            '.rw-lg-ref div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.rw-lg-ref .rw-lg-note{font-size:11px;color:#94a3b8;}' +
            '.rw-lg-row--void_earn td,.rw-lg-row--void_redeem td{background:#fcfcfd;}' +
            '.rw-lg-row--void_earn .rw-lg-date,.rw-lg-row--void_redeem .rw-lg-date{color:#94a3b8;}' +
            '.rw-lg-empty{padding:22px 16px;text-align:center;color:#94a3b8;}' +
            '.rw-lg-empty.is-error{color:#dc2626;}' +
            '@media (max-width:560px){.rw-lg-summary{grid-template-columns:repeat(2,minmax(0,1fr));}.rw-lg-dr,.rw-lg-ref{max-width:110px;}}' +
            '.rw-cfg-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:14px;}' +
            '.rw-cfg-card--danger{border-color:#fecaca;background:#fff7f7;}' +
            '.rw-cfg-card-title{font-weight:700;margin-bottom:10px;font-size:14px;}' +
            '.btn--danger{background:#dc2626;color:#fff;border:1px solid #b91c1c;border-radius:8px;cursor:pointer;}' +
            '.btn--danger:hover{background:#b91c1c;}' +
            '#rwResetZeroModal.reward-points-modal{z-index:3300;background:rgba(15,23,42,.4);display:none;align-items:center;justify-content:center;}' +
            '#rwResetZeroModal .rw-reset-modal-box{width:min(440px,92vw);max-height:90vh;overflow:auto;padding:18px 20px;}' +
            '.rw-reset-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px;}' +
            '.rw-reset-head h3{margin:0;font-size:17px;}' +
            '.rw-reset-sub{margin:0 0 6px;font-weight:700;font-size:14px;}' +
            '.rw-reset-hint{margin:0 0 12px;font-size:13px;color:#64748b;line-height:1.4;}' +
            '.rw-reset-code{display:block;width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;letter-spacing:.25em;font-size:22px;text-align:center;margin-bottom:12px;}' +
            '.rw-reset-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;}' +
            '.rw-reset-err{margin:10px 0 0;color:#dc2626;font-size:13px;}' +
            '.rw-reset-clinic-list{display:flex;flex-direction:column;gap:6px;max-height:280px;overflow:auto;margin:0 0 14px;padding:8px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;}' +
            '.rw-reset-clinic-row{display:flex;gap:10px;align-items:flex-start;font-size:13px;cursor:pointer;padding:6px 4px;}' +
            '.rw-reset-clinic-row--all{font-weight:700;border-bottom:1px solid #f1f5f9;padding-bottom:10px;margin-bottom:2px;}' +
            '.rw-reset-clinic-row input{margin-top:2px;}' +
            '.rw-zero-policy{display:flex;flex-direction:column;gap:8px;margin-bottom:10px;}' +
            '.rw-zero-policy-opt{display:flex;gap:10px;align-items:flex-start;font-size:13px;cursor:pointer;color:#7f1d1d;}' +
            '.rw-zero-policy-opt input{margin-top:2px;}' +
            '.rw-lifespan-months{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px 26px;}' +
            '.rw-lifespan-btn{padding:6px 10px;border:1px solid #fca5a5;border-radius:8px;background:#fff;color:#991b1b;cursor:pointer;font-size:12px;font-weight:700;}' +
            '.rw-lifespan-btn:hover{background:#fef2f2;}' +
            '.rw-lifespan-btn.is-active{background:#dc2626;border-color:#b91c1c;color:#fff;}' +
            '#rwLifespanMonthsWrap[hidden]{display:none!important;}' +
            '.rw-clinic-list{display:flex;flex-direction:column;gap:8px;}' +
            '.rw-clinic-row{display:flex;gap:10px;align-items:center;font-size:13px;cursor:pointer;}' +
            '.rw-clinic-scheme{border:1px solid #e2e8f0;border-radius:10px;background:#fff;overflow:hidden;}' +
            '.rw-clinic-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:8px;background:#f8fafc;border-bottom:1px solid #e2e8f0;}' +
            '.rw-clinic-tab{position:relative;display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;cursor:pointer;font-size:13px;font-weight:700;color:#334155;}' +
            '.rw-clinic-tab:hover{border-color:#86efac;background:#f0fdf4;}' +
            '.rw-clinic-tab.is-active{border-color:#16a34a;background:#dcfce7;color:#14532d;}' +
            '.rw-clinic-tab-code{letter-spacing:.02em;}' +
            '.rw-clinic-tab-dot{width:8px;height:8px;border-radius:50%;background:#16a34a;flex:0 0 auto;}' +
            '.rw-clinic-panels{background:#fff;}' +
            '.rw-clinic-panel{display:none;}' +
            '.rw-clinic-panel.is-active{display:block;}' +
            '.rw-clinic-panel-head{padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #f1f5f9;background:#ecfdf5;}' +
            /* ~10 doctor rows visible, then scroll inside the panel body only */
            '.rw-clinic-docs{display:flex;flex-direction:column;gap:2px;padding:8px;height:calc(10 * 42px);max-height:calc(10 * 42px);overflow-y:auto;overflow-x:hidden;box-sizing:border-box;}' +
            '.rw-doc-row{display:flex;flex-wrap:nowrap;gap:12px;align-items:center;min-height:40px;padding:6px 10px;border-radius:8px;cursor:pointer;border:1px solid transparent;box-sizing:border-box;}' +
            '.rw-doc-row:hover{background:#f0fdf4;}' +
            '.rw-doc-row.is-selected{background:#dcfce7;border-color:#86efac;}' +
            '.rw-doc-label{flex:1;min-width:0;font-size:13px;font-weight:600;color:#14532d;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
            '.rw-doc-row[data-doctor-key="__all__"] .rw-doc-label{color:#0f766e;}' +
            '.rw-doc-toggle{display:flex;gap:6px;align-items:center;font-size:12px;color:#334155;cursor:pointer;flex:0 0 auto;}' +
            '.rw-doc-join-amp{color:#94a3b8;}' +
            '.rw-doc-toggle input{accent-color:#166534;}' +
            '#apRewardPanel{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;margin-bottom:14px;}' +
            '#apRewardPanel .rw-row{display:flex;justify-content:space-between;align-items:center;gap:8px;}' +
            '#apRewardClinicMeta{line-height:1.35;}' +
            '.ap-rw-clinic-table{border:1px solid #bbf7d0;border-radius:8px;background:#fff;overflow:hidden;}' +
            '.ap-rw-clinic-head,.ap-rw-clinic-row{display:grid;grid-template-columns:28px minmax(52px,1fr) minmax(72px,1.4fr) minmax(56px,0.8fr);gap:6px;align-items:center;padding:7px 10px;font-size:12px;}' +
            '.ap-rw-clinic-head{background:#ecfdf5;color:#64748b;font-weight:700;border-bottom:1px solid #bbf7d0;}' +
            '.ap-rw-clinic-row{margin:0;cursor:pointer;border-bottom:1px solid #f0fdf4;}' +
            '.ap-rw-clinic-row:last-child{border-bottom:0;}' +
            '.ap-rw-clinic-row:hover{background:#f0fdf4;}' +
            '.ap-rw-clinic-start{border-top:1px solid #dcfce7;}' +
            '.ap-rw-clinic-table .ap-rw-clinic-row:first-of-type,.ap-rw-clinic-table .ap-rw-clinic-start:first-of-type{border-top:0;}' +
            '.ap-rw-clinic-code{font-weight:700;color:#0f766e;}' +
            '.ap-rw-clinic-sub{font-weight:600;color:#94a3b8;font-size:11px;}' +
            '.ap-rw-clinic-cont:before{content:"";}' +
            '.ap-rw-clinic-charts{color:#475569;}' +
            '.ap-rw-num{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;color:#166534;}' +
            '.ap-rw-clinic-head .ap-rw-num{color:#64748b;font-weight:700;}' +
            '.rw-bal-breakdown{margin-top:4px;font-size:12px;color:#64748b;line-height:1.35;font-variant-numeric:tabular-nums;}' +
            '.rw-bal-chip{white-space:nowrap;}' +
            '.rw-bal-clinic{font-weight:700;color:#0f766e;}' +
            '.rw-bal-pts{font-weight:600;color:#475569;}' +
            '.rw-bal-sep{margin:0 6px;color:#cbd5e1;font-weight:600;}' +
            '#rwTransferDrop,#rwFinderDrop{position:absolute;left:0;right:0;top:100%;z-index:5;background:#fff;border:1px solid #e2e8f0;border-radius:8px;max-height:180px;overflow:auto;box-shadow:0 8px 24px rgba(0,0,0,.08);}' +
            '.rw-xfer-opt,.rw-finder-opt{display:block;width:100%;text-align:left;padding:8px 10px;border:0;background:transparent;cursor:pointer;font-size:13px;}' +
            '.rw-xfer-opt:hover,.rw-finder-opt:hover{background:#f8fafc;}' +
            '#rwAdminAdjust .btn{background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;cursor:pointer;}' +
            '#rewardLedgerFinderModal.reward-points-modal{z-index:3200;background:rgba(15,23,42,.28);}' +
            /* Above #billPanel (z-index 2000). Centered in the middle display; */
            /* when the payment panel is open, center in the free area so they do not overlap. */
            '#rewardPatientModal.reward-points-modal{z-index:3200;background:rgba(15,23,42,.28);}' +
            '#rewardPatientModal .reward-points-modal-box{' +
            'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);' +
            'margin:0;width:min(700px,94vw);max-width:700px;max-height:92vh;overflow:auto;' +
            'box-shadow:0 18px 50px rgba(15,23,42,.22);}' +
            'body:has(#billPanel.open) #rewardPatientModal .reward-points-modal-box{' +
            'left:calc((100vw - min(680px,100vw)) / 2);' +
            'width:min(640px,calc(100vw - min(680px,100vw) - 32px));}' +
            '@media (max-width:900px){' +
            'body:has(#billPanel.open) #rewardPatientModal .reward-points-modal-box{' +
            'left:50%;width:min(560px,92vw);}}';
    }

    function boot() {
        injectStylesOnce();
        wireAddPaymentRewardPanelOnce();
        wireTransferSearchOnce();
        wireAdminAdjustOnce();
        wireLedgerFinderOnce();
        attachInfoLinks();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        setTimeout(boot, 0);
    }

    return {
        METHOD: METHOD,
        isRewardPayMethod: isRewardPayMethod,
        isAdmin: isAdmin,
        round2: round2,
        fmtPts: fmtPts,
        loadProgram: loadProgram,
        earnRatePercent: earnRatePercent,
        isClinicJoined: isClinicJoined,
        isClinicGainJoined: isClinicGainJoined,
        isClinicRedeemJoined: isClinicRedeemJoined,
        currentClinicJoined: currentClinicJoined,
        currentClinicRedeemJoined: currentClinicRedeemJoined,
        loadDoctorJoinMap: loadDoctorJoinMap,
        setDoctorJoinFlags: setDoctorJoinFlags,
        effectiveJoinFlags: effectiveJoinFlags,
        getAccount: getAccount,
        getBalance: getBalance,
        getRedeemableBalanceForDoctor: getRedeemableBalanceForDoctor,
        resolveRewardDoctor: resolveRewardDoctor,
        loadDoctorLedgerNets: loadDoctorLedgerNets,
        accountsCappedForDoctor: accountsCappedForDoctor,
        listPersonAccounts: listPersonAccounts,
        allocateAcrossAccounts: allocateAcrossAccounts,
        loadLedger: loadLedger,
        earn: earn,
        redeem: redeem,
        redeemMulti: redeemMulti,
        transfer: transfer,
        transferMulti: transferMulti,
        voidForPayment: voidForPayment,
        voidForBill: voidForBill,
        refreshActiveBannerBalances: refreshActiveBannerBalances,
        adjust: adjust,
        applyRedeemForBill: applyRedeemForBill,
        applyEarnForPayment: applyEarnForPayment,
        notifyBalanceChange: notifyBalanceChange,
        normalizeReferralConfig: normalizeReferralConfig,
        loadReferralConfig: loadReferralConfig,
        saveReferralConfig: saveReferralConfig,
        referralPointsGate: referralPointsGate,
        referralAvailability: referralAvailability,
        referralCredit: referralCredit,
        referralReverse: referralReverse,
        kindLabelBilingual: kindLabelBilingual,
        ledgerDisplayKind: ledgerDisplayKind,
        ledgerFilterRows: ledgerFilterRows,
        ledgerSummary: ledgerSummary,
        renderLedgerRows: renderLedgerRows,
        renderLedgerFilters: renderLedgerFilters,
        buildSmsBody: buildSmsBody,
        smsBalances: smsBalances,
        notifyFromRpcResult: notifyFromRpcResult,
        notifyNetChange: notifyNetChange,
        refreshAddPaymentRewardPanel: refreshAddPaymentRewardPanel,
        readUsePointsFromPanel: readUsePointsFromPanel,
        readRedeemSourceIdsForPayment: readRedeemSourceIdsForPayment,
        applyRedeemAllOnPayment: applyRedeemAllOnPayment,
        openPatientPanel: openPatientPanel,
        closePatientPanel: closePatientPanel,
        openPhoneQr: openPhoneQr,
        loyaltyGuideHref: loyaltyGuideHref,
        loyaltyGuideLinkHtml: loyaltyGuideLinkHtml,
        normalizeRedeemCap: normalizeRedeemCap,
        redeemCapLeft: redeemCapLeft,
        pointsUsedOnBill: pointsUsedOnBill,
        redeemCapSummary: redeemCapSummary,
        loadRedeemCap: loadRedeemCap,
        saveRedeemCap: saveRedeemCap,
        payRedeemCapLeft: payRedeemCapLeft,
        phoneQrConfig: phoneQrConfig,
        pointsWhatsAppText: pointsWhatsAppText,
        openLedgerFinder: openLedgerFinder,
        closeLedgerFinder: closeLedgerFinder,
        refreshBannerBalances: refreshBannerBalances,
        renderConfigPane: renderConfigPane,
        setClinicJoinFlags: setClinicJoinFlags,
        clinicCtx: clinicCtx,
        openResetZeroFlow: openResetZeroFlow,
        openAdminRewardAuthGate: openAdminRewardAuthGate,
        zeroClinicBalances: zeroClinicBalances,
        revertLastZeroBatch: revertLastZeroBatch,
        loadLastZeroBatch: loadLastZeroBatch,
        saveZeroPolicy: saveZeroPolicy,
        maybeRunScheduledZero: maybeRunScheduledZero
    };
})();

window.REWARDS = REWARDS;
window.isRewardPayMethod = function (m) {
    return REWARDS && REWARDS.isRewardPayMethod(m);
};
window.REWARD_POINTS_METHOD = REWARDS.METHOD;
