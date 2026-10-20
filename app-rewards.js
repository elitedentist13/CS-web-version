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
    var _panelPatientId = null;
    var _panelSourceAccounts = []; // chart ledgers for open patient panel
    var _paySourceAccounts = [];   // chart ledgers for add-payment panel

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
    /** Always bilingual (ZH-Hant + EN) — one SMS for every patient. */
    var SMS_FALLBACK_BILINGUAL =
        '[' + SMS_BRAND + '] 積分更新 / Reward points update\n' +
        '變動/Change: {CHANGE} ({KIND})\n' +
        '結餘/Balance: {BALANCE}\n' +
        '診所/Clinic: {CLINIC}\n' +
        '參考/Ref: {REF}';

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

    function isClinicJoined(clinicId, clinicCode) {
        return loadClinicJoinMap(false).then(function (map) {
            return !!lookupClinicFlags(map, clinicId, clinicCode).enabled;
        });
    }

    function isClinicGainJoined(clinicId, clinicCode) {
        return loadClinicJoinMap(false).then(function (map) {
            return !!lookupClinicFlags(map, clinicId, clinicCode).join_gain;
        });
    }

    function isClinicRedeemJoined(clinicId, clinicCode) {
        return loadClinicJoinMap(false).then(function (map) {
            return !!lookupClinicFlags(map, clinicId, clinicCode).join_redeem;
        });
    }

    function currentClinicJoined() {
        var ctx = clinicCtx();
        return isClinicJoined(ctx.clinic_id, ctx.clinic_code);
    }

    function currentClinicRedeemJoined() {
        var ctx = clinicCtx();
        return isClinicRedeemJoined(ctx.clinic_id, ctx.clinic_code);
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

    /** Same person may have multiple charts (universal + clinic-prefixed legacy). */
    function findRelatedPatientIds(patientId) {
        if (!patientId) return Promise.resolve([]);
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
        return findRelatedPatientIds(patientId).then(function (ids) {
            if (!ids.length) return [];
            return SB.from('patients')
                .select('id,patient_no,clinic_tag,full_name,chinese_name')
                .in('id', ids)
                .then(function (pr) {
                    var patients = pr.data || [];
                    return SB.from('reward_accounts').select('*').in('patient_id', ids)
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
        return SB.rpc('reward_earn', {
            p_patient_id: opts.patientId,
            p_eligible_amount: round2(opts.eligibleAmount),
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

    function redeem(opts) {
        opts = opts || {};
        var sourceIds = opts.sourceAccountIds || null;
        if (sourceIds && sourceIds.length) {
            return redeemMulti(opts);
        }
        return SB.rpc('reward_redeem', {
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
        return SB.rpc('reward_redeem_multi', {
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
            return SB.rpc('reward_redeem', {
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
        return SB.rpc('reward_transfer', {
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
        return SB.rpc('reward_transfer_multi', {
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

    function voidForPayment(billPaymentId, note) {
        if (!billPaymentId) return Promise.resolve({ ok: true, skipped: true });
        return SB.rpc('reward_void_for_payment', {
            p_bill_payment_id: billPaymentId,
            p_created_by: actorName(),
            p_note: note || 'Void payment'
        }).then(function (r) {
            if (r.error) return { ok: false, error: r.error.message };
            return rpcResult(r.data);
        });
    }

    /**
     * Reverse ALL reward activity on a voided bill:
     *   - earn  → remove derived points from payments on that bill
     *   - redeem → restore points that were used as discount on that bill
     */
    function voidForBill(billId, note) {
        if (!billId) return Promise.resolve({ ok: true, skipped: true });
        return SB.rpc('reward_void_for_bill', {
            p_bill_id: billId,
            p_created_by: actorName(),
            p_note: note || 'Void bill: reverse earn + redeem'
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

    /** Admin-only balance delta (positive add, negative subtract). Note required. */
    function adjust(opts) {
        opts = opts || {};
        if (!isAdmin()) return Promise.resolve({ ok: false, error: 'admin only' });
        var ctx = clinicCtx();
        return SB.rpc('reward_adjust', {
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
        if (!tpl) tpl = SMS_FALLBACK_BILINGUAL;
        tpl = tpl
            .replace(/\[Banana\]/g, '[' + SMS_BRAND + ']')
            .replace(/【Banana】/g, '[' + SMS_BRAND + ']');
        return tpl
            .replace(/\{CHANGE\}/g, fmtSigned(info.points))
            .replace(/\{BALANCE\}/g, fmtPts(info.balance))
            .replace(/\{KIND\}/g, kindLabelBilingual(info.kind))
            .replace(/\{CLINIC\}/g, info.clinic || '')
            .replace(/\{REF\}/g, info.ref || '—');
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
            return loadPatientLite(info.patientId).then(function (pat) {
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
                    balance: info.balance,
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
                        // Retry without clinic cols if schema older
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
                sourceAccountIds: opts.sourceAccountIds || null,
                doctorName: opts.doctorName || resolveBillDoctorName(
                    (typeof bdCurrentBill !== 'undefined' && bdCurrentBill) ? bdCurrentBill : null
                ) || null
            }).then(function (rr) {
                if (!rr.ok) {
                    // Best-effort: void the reward payment row so bill math stays clean
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
                    redeemResult: rr
                };
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

    function renderPaySourceList(accounts, selectAll) {
        var box = document.getElementById('apRewardSources');
        if (!box) return;
        var withBal = (accounts || []).filter(function (a) {
            return a.account_id && round2(a.balance) > 0.005;
        });
        if (!withBal.length) {
            box.innerHTML = '<div style="font-size:12px;color:#94a3b8;">' +
                esc(tr('rewards.pay.noCharts', 'No chart balances available.')) + '</div>';
            return;
        }
        box.innerHTML = withBal.map(function (a) {
            var label = '#' + (a.patient_no || '—') +
                (a.clinic_code ? ' · ' + a.clinic_code : '') +
                ' — ' + fmtPts(a.balance);
            var checked = selectAll !== false ? ' checked' : '';
            return '<label class="ap-rw-src-row" style="display:flex;gap:8px;align-items:center;font-size:12px;margin:3px 0;cursor:pointer;">' +
                '<input type="checkbox" class="ap-rw-src" data-account-id="' + esc(a.account_id) + '"' + checked + '>' +
                '<span>' + esc(label) + '</span></label>';
        }).join('');
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
                prev.textContent = tr('rewards.pay.allocShort', 'Selected charts do not cover this amount.');
                return;
            }
            prev.textContent = alloc.plan.map(function (s) {
                return '#' + (s.patient_no || '?') + ' −' + fmtPts(s.take);
            }).join(' · ');
        }
        return totalSel;
    }

    function applyEarnForPayment(opts) {
        opts = opts || {};
        var doctorName = opts.doctorName || resolveBillDoctorName(opts.bill || null) ||
            resolveBillDoctorName(
                (typeof bdCurrentBill !== 'undefined' && bdCurrentBill) ? bdCurrentBill : null
            ) || null;
        return earn({
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
        return currentClinicRedeemJoined().then(function (joined) {
            if (!joined) {
                panel.style.display = 'none';
                _paySourceAccounts = [];
                return;
            }
            panel.style.display = '';
            return listPersonAccounts(bill.patient_id).then(function (accs) {
                _paySourceAccounts = accs || [];
                var bal = sumPersonBalance(_paySourceAccounts);
                var balEl = document.getElementById('apRewardBalance');
                if (balEl) {
                    balEl.textContent = fmtPts(bal);
                    balEl.setAttribute('data-balance', String(bal));
                }
                renderPaySourceList(_paySourceAccounts, true);
                var use = document.getElementById('apRewardUse');
                var amtWrap = document.getElementById('apRewardAmountWrap');
                if (use) {
                    use.checked = false;
                    use.disabled = bal <= 0.005;
                }
                if (amtWrap) amtWrap.style.display = 'none';
                var hint = document.getElementById('apRewardHint');
                if (hint) {
                    hint.textContent = bal > 0.005
                        ? tr('rewards.pay.hintUse', 'Optional — points used here are not counted as income.')
                        : tr('rewards.pay.hintEmpty', 'No reward points available yet.');
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
    function kindBadge(kind) {
        var label = kindLabel(kind, resolveSmsLang());
        return '<span class="rw-kind rw-kind--' + esc(kind) + '">' + esc(label) + '</span>';
    }

    function ledgerClinicTag(row) {
        var tag = String((row && (row._clinic_tag || row.clinic_code || row.clinic_tag)) || '').trim();
        return tag || '—';
    }

    function ledgerDoctorName(row) {
        var dr = String((row && (row._doctor_name || row.doctor_name)) || '').trim();
        return dr || '—';
    }

    function renderLedgerRows(rows) {
        if (!rows || !rows.length) {
            return '<tr><td colspan="7" style="padding:16px;color:#94a3b8;text-align:center;">' +
                esc(tr('rewards.ledger.empty', 'No reward transactions yet.')) + '</td></tr>';
        }
        return rows.map(function (row) {
            var dt = fmtLedgerTimeHK(row.created_at);
            var pts = round2(row.points);
            var ptsCls = pts >= 0 ? 'rw-pos' : 'rw-neg';
            var ref = '';
            if (row.bill_id) ref = 'Bill ' + String(row.bill_id).slice(0, 8).toUpperCase();
            if (row.transfer_id) ref = (ref ? ref + ' · ' : '') + 'Xfer ' + String(row.transfer_id).slice(0, 8);
            return '<tr>' +
                '<td style="padding:8px 10px;white-space:nowrap;font-size:12px;color:#64748b;">' + esc(dt) + '</td>' +
                '<td style="padding:8px 10px;font-size:12px;">' + esc(ledgerClinicTag(row)) + '</td>' +
                '<td style="padding:8px 10px;font-size:12px;">' + esc(ledgerDoctorName(row)) + '</td>' +
                '<td style="padding:8px 10px;">' + kindBadge(row.kind) + '</td>' +
                '<td style="padding:8px 10px;text-align:right;font-weight:700;" class="' + ptsCls + '">' +
                esc(fmtSigned(pts)) + '</td>' +
                '<td style="padding:8px 10px;text-align:right;">' + esc(fmtPts(row.balance_after)) + '</td>' +
                '<td style="padding:8px 10px;font-size:12px;color:#64748b;">' +
                esc(ref || row.note || '—') + '</td>' +
                '</tr>';
        }).join('');
    }

    /** Best-effort stamp doctor_name on new ledger row(s) after RPC (column from SQL patch). */
    function stampDoctorOnLedgerResult(res, doctorName) {
        var name = String(doctorName || '').trim();
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
        return SB.from('reward_ledger').update({ doctor_name: name }).in('id', ids)
            .then(function () { return res; })
            .catch(function () { return res; });
    }

    function resolveBillDoctorName(billLike) {
        if (!billLike) return '';
        if (typeof billDisplayDoctorLabel === 'function') {
            try {
                var lab = billDisplayDoctorLabel(billLike);
                if (lab) return String(lab).trim();
            } catch (e) { /* ignore */ }
        }
        return String(billLike.doctor_name || billLike.dentist_name || billLike.doctor_tag ||
            billLike.doctor_code || '').trim();
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
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="padding:16px;text-align:center;color:#94a3b8;">' +
            esc(tr('common.loadingEllipsis', 'Loading…')) + '</td></tr>';
        if (typeof openModal === 'function') openModal('rewardPatientModal');
        else modal.style.display = 'flex';

        var accsPromise = listPersonAccounts(patientId).then(function (accs) {
            _panelSourceAccounts = accs || [];
            var total = sumPersonBalance(_panelSourceAccounts);
            if (balEl) {
                balEl.textContent = fmtPts(total);
                balEl.setAttribute('data-balance', String(total));
            }
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
                if (tbody) tbody.innerHTML = renderLedgerRows(enriched);
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
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="7" style="padding:16px;color:#dc2626;">' +
                    esc((e && e.message) || tr('rewards.err.load', 'Failed to load rewards.')) +
                    '</td></tr>';
            }
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

    function closePatientPanel() {
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
                    dr = resolveBillDoctorName(billMap[row.bill_id]);
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
            : Promise.resolve({ data: [] });

        var billsP = billIds.length
            ? SB.from('bills')
                .select('id,doctor_name,doctor_code,doctor_tag,dentist_name')
                .in('id', billIds)
            : Promise.resolve({ data: [] });

        return Promise.all([patientsP, billsP]).then(function (parts) {
            var map = {};
            ((parts[0] && parts[0].data) || []).forEach(function (p) { map[p.id] = p; });
            var billMap = {};
            ((parts[1] && parts[1].data) || []).forEach(function (b) { billMap[b.id] = b; });
            return attach(map, billMap);
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
        return getBalance(patientId).then(function (bal) {
            paintBannerBalance(patientId, bal);
            return bal;
        }).catch(function () {
            // Still show 0.00 rather than leaving em-dash if fetch fails after account exists elsewhere
            paintBannerBalance(patientId, 0);
            return 0;
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

    function renderConfigPane(pane) {
        if (!pane) return;
        pane.innerHTML = '<p style="color:#888;">' + esc(tr('common.loadingEllipsis', 'Loading…')) + '</p>';
        var admin = isAdmin();

        Promise.all([
            loadProgram(true),
            SB.from('clinics').select('id,clinic_code,english_name,chinese_name').order('clinic_code'),
            loadClinicJoinMap(true),
            loadLedger(null, 80)
        ]).then(function (parts) {
            var program = parts[0];
            var clinics = (parts[1].data || parts[1]) || [];
            if (parts[1].error) clinics = (typeof APP_CLINICS !== 'undefined' ? APP_CLINICS : []) || [];
            var map = parts[2] || {};
            var ledgerRaw = parts[3] || [];
            return enrichLedgerMeta(ledgerRaw, clinics).then(function (ledger) {
                return { program: program, clinics: clinics, map: map, ledger: ledger };
            });
        }).then(function (ctx) {
            var program = ctx.program;
            var clinics = ctx.clinics;
            var map = ctx.map;
            var ledger = ctx.ledger;

            var rate = Number(program.earn_rate_percent);
            if (!isFinite(rate)) rate = 10;

            var html = '';
            html += '<div class="rw-cfg">';
            html += '<h2 style="margin:0 0 8px;font-size:20px;">' + esc(tr('rewards.cfg.title', 'Reward Points')) + '</h2>';
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

            // Clinics — reception may toggle Gain / Redeem join
            html += '<div class="rw-cfg-card">';
            html += '<div class="rw-cfg-card-title">' + esc(tr('rewards.cfg.clinicsTitle', 'Clinics in scheme')) + '</div>';
            html += '<p style="margin:0 0 10px;font-size:12px;color:#64748b;">' +
                esc(tr('rewards.cfg.clinicsHintJoin',
                    'Reception can join Gain and/or Redeem per clinic. Earn credits the patient chart at this clinic; redeem may draw from multiple charts of the same person.')) +
                '</p>';
            html += '<div class="rw-clinic-list">';
            (clinics || []).forEach(function (c) {
                var code = String(c.clinic_code || '').trim();
                var name = c.english_name || c.chinese_name || code;
                var flags = lookupClinicFlags(map, c.id, code);
                html += '<div class="rw-clinic-row" style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:6px 0;border-bottom:1px solid #f1f5f9;">';
                html += '<span style="min-width:140px;"><strong>' + esc(code || '—') + '</strong> · ' + esc(name) + '</span>';
                html += '<label style="display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer;">';
                html += '<input type="checkbox" class="rw-clinic-gain" data-clinic-id="' + esc(c.id) +
                    '" data-clinic-code="' + esc(code) + '"' + (flags.join_gain ? ' checked' : '') + '>';
                html += '<span>' + esc(tr('rewards.cfg.joinGain', 'Join Gain')) + '</span></label>';
                html += '<label style="display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer;">';
                html += '<input type="checkbox" class="rw-clinic-redeem" data-clinic-id="' + esc(c.id) +
                    '" data-clinic-code="' + esc(code) + '"' + (flags.join_redeem ? ' checked' : '') + '>';
                html += '<span>' + esc(tr('rewards.cfg.joinRedeem', 'Join Redeem')) + '</span></label>';
                html += '</div>';
            });
            html += '</div></div>';

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
                        '<td style="padding:7px 10px;">' + kindBadge(row.kind) + '</td>' +
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
                var sms = document.getElementById('rwCfgSms');
                if (sms) {
                    sms.addEventListener('change', function () {
                        saveSmsEnabled(sms.checked).then(function (res) {
                            if (!res.ok) alert(res.error || 'Save failed');
                        });
                    });
                }
            }

            function wireJoinToggle(sel, flagKey) {
                pane.querySelectorAll(sel).forEach(function (cb) {
                    cb.addEventListener('change', function () {
                        var cid = cb.getAttribute('data-clinic-id');
                        var code = cb.getAttribute('data-clinic-code');
                        var gainEl = pane.querySelector('.rw-clinic-gain[data-clinic-id="' + cid + '"]');
                        var redeemEl = pane.querySelector('.rw-clinic-redeem[data-clinic-id="' + cid + '"]');
                        var flags = {
                            join_gain: gainEl ? !!gainEl.checked : false,
                            join_redeem: redeemEl ? !!redeemEl.checked : false
                        };
                        if (flagKey === 'join_gain') flags.join_gain = !!cb.checked;
                        if (flagKey === 'join_redeem') flags.join_redeem = !!cb.checked;
                        setClinicJoinFlags(cid, code, flags).then(function (res) {
                            if (!res.ok) {
                                alert(res.error || 'Save failed');
                                cb.checked = !cb.checked;
                            }
                        });
                    });
                });
            }
            wireJoinToggle('.rw-clinic-gain', 'join_gain');
            wireJoinToggle('.rw-clinic-redeem', 'join_redeem');
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
            '.rw-kind{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:#f1f5f9;color:#334155;}' +
            '.rw-kind--earn,.rw-kind--transfer_in,.rw-kind--void_redeem{background:#dcfce7;color:#166534;}' +
            '.rw-kind--redeem,.rw-kind--transfer_out,.rw-kind--void_earn{background:#fee2e2;color:#991b1b;}' +
            '.rw-kind--adjust{background:#e0e7ff;color:#3730a3;}' +
            '.rw-cfg-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;margin-bottom:14px;}' +
            '.rw-cfg-card-title{font-weight:700;margin-bottom:10px;font-size:14px;}' +
            '.rw-clinic-list{display:flex;flex-direction:column;gap:8px;}' +
            '.rw-clinic-row{display:flex;gap:10px;align-items:center;font-size:13px;cursor:pointer;}' +
            '#apRewardPanel{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px 14px;margin-bottom:14px;}' +
            '#apRewardPanel .rw-row{display:flex;justify-content:space-between;align-items:center;gap:8px;}' +
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
            'margin:0;width:min(640px,92vw);max-width:640px;max-height:92vh;overflow:auto;' +
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
        getAccount: getAccount,
        getBalance: getBalance,
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
        adjust: adjust,
        applyRedeemForBill: applyRedeemForBill,
        applyEarnForPayment: applyEarnForPayment,
        notifyBalanceChange: notifyBalanceChange,
        notifyFromRpcResult: notifyFromRpcResult,
        notifyNetChange: notifyNetChange,
        refreshAddPaymentRewardPanel: refreshAddPaymentRewardPanel,
        readUsePointsFromPanel: readUsePointsFromPanel,
        readRedeemSourceIdsForPayment: readRedeemSourceIdsForPayment,
        applyRedeemAllOnPayment: applyRedeemAllOnPayment,
        openPatientPanel: openPatientPanel,
        closePatientPanel: closePatientPanel,
        openLedgerFinder: openLedgerFinder,
        closeLedgerFinder: closeLedgerFinder,
        refreshBannerBalances: refreshBannerBalances,
        renderConfigPane: renderConfigPane,
        setClinicJoinFlags: setClinicJoinFlags,
        clinicCtx: clinicCtx
    };
})();

window.REWARDS = REWARDS;
window.isRewardPayMethod = function (m) {
    return REWARDS && REWARDS.isRewardPayMethod(m);
};
window.REWARD_POINTS_METHOD = REWARDS.METHOD;
