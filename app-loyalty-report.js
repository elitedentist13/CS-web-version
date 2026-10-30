/**
 * Loyalty reports (Reports → Loyalty): unused coupon value and unspent points per clinic,
 * issued vs used per coupon, referral return, and coupon / points value per bill.
 * Pure builders take plain rows so they can be tested without the database.
 */
var LOYALTY_REPORT = (function () {
    'use strict';

    var REDEEM_KINDS = ['redeem', 'void_redeem'];
    var WAITING = { pending: 1, issuing: 1, blocked: 1, skip: 1 };

    function num(v) { var x = parseFloat(v); return isFinite(x) ? x : 0; }
    function r2(v) { return Math.round(num(v) * 100) / 100; }
    function code(v) { return String(v || '').trim().toUpperCase(); }
    function money(v) { return 'HK$' + r2(v).toFixed(2); }
    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function tt(key, fallback) {
        try {
            if (typeof t === 'function') {
                var s = t(key);
                if (s && s !== key) return s;
            }
        } catch (e) {}
        return fallback;
    }
    /** HK calendar day of a timestamp (dates pass through). */
    function hkDay(ts) {
        if (!ts) return '';
        var s = String(ts);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        var ms = Date.parse(s);
        if (isNaN(ms)) return s.slice(0, 10);
        return new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
    }
    function inRange(day, from, to) {
        return !!day && (!from || day >= from) && (!to || day <= to);
    }
    function clinicOk(c, clinic) { return !clinic || code(c) === code(clinic); }
    function cashValue(c) { return c && c.discount_mode === 'percent' ? 0 : num(c && c.face_value); }
    function pct(a, b) { return b > 0 ? Math.round(a * 1000 / b) / 10 : 0; }

    function coupons() { return typeof COUPONS !== 'undefined' ? COUPONS : null; }
    function liveRows(rows, today, policy) {
        var C = coupons();
        var list = C && C.applyZeroExpiry ? C.applyZeroExpiry((rows || []).map(function (r) {
            var o = {};
            for (var k in r) o[k] = r[k];
            return o;
        }), policy) : (rows || []);
        return list.filter(function (c) {
            if (c.status !== 'unused') return false;
            return !c.expires_on || String(c.expires_on).slice(0, 10) >= today;
        });
    }

    /** Unused coupon value and unspent points per clinic, as of `today`. */
    function outstanding(couponRows, accounts, opts) {
        opts = opts || {};
        var today = opts.today || hkDay(new Date().toISOString());
        var map = {};
        function row(k) {
            if (!map[k]) map[k] = { clinic: k, coupons: 0, coupon_value: 0, percent_coupons: 0, points_people: 0, points: 0, total: 0 };
            return map[k];
        }
        liveRows(couponRows, today, opts.policy).forEach(function (c) {
            if (!clinicOk(c.clinic_code, opts.clinic)) return;
            var r = row(code(c.clinic_code) || '—');
            r.coupons++;
            if (c.discount_mode === 'percent') r.percent_coupons++;
            else r.coupon_value += num(c.face_value);
        });
        (accounts || []).forEach(function (a) {
            var bal = num(a.balance);
            if (bal <= 0.005 || !clinicOk(a.clinic_code, opts.clinic)) return;
            var r = row(code(a.clinic_code) || '—');
            r.points_people++;
            r.points += bal;
        });
        var rows = Object.keys(map).sort().map(function (k) {
            var r = map[k];
            r.coupon_value = r2(r.coupon_value);
            r.points = r2(r.points);
            r.total = r2(r.coupon_value + r.points);
            return r;
        });
        var total = rows.reduce(function (s, r) {
            s.coupons += r.coupons; s.coupon_value += r.coupon_value; s.percent_coupons += r.percent_coupons;
            s.points_people += r.points_people; s.points += r.points;
            return s;
        }, { clinic: 'total', coupons: 0, coupon_value: 0, percent_coupons: 0, points_people: 0, points: 0, total: 0 });
        total.coupon_value = r2(total.coupon_value);
        total.points = r2(total.points);
        total.total = r2(total.coupon_value + total.points);
        return { rows: rows, total: total };
    }

    /** Coupons issued in the period, by coupon type: how many were used, for how much, and what is left. */
    function campaigns(couponRows, opts) {
        opts = opts || {};
        var today = opts.today || hkDay(new Date().toISOString());
        var label = opts.label || function (k) { return k; };
        var live = {};
        liveRows(couponRows, today, opts.policy).forEach(function (c) { live[c.id] = true; });
        var map = {};
        (couponRows || []).forEach(function (c) {
            if (!inRange(hkDay(c.issued_at), opts.from, opts.to) || !clinicOk(c.clinic_code, opts.clinic)) return;
            var k = c.campaign_key || '—';
            var r = map[k] || (map[k] = { key: k, name: label(k), issued: 0, issued_value: 0, used: 0, used_value: 0, live: 0, expired: 0, voided: 0, use_rate: 0 });
            r.issued++;
            r.issued_value += cashValue(c);
            if (c.status === 'used') { r.used++; r.used_value += num(c.redeemed_amount); }
            else if (c.status === 'void') r.voided++;
            else if (live[c.id]) r.live++;
            else r.expired++;
        });
        var rows = Object.keys(map).map(function (k) {
            var r = map[k];
            r.issued_value = r2(r.issued_value);
            r.used_value = r2(r.used_value);
            r.use_rate = pct(r.used, r.issued);
            return r;
        }).sort(function (a, b) { return b.issued - a.issued || String(a.name).localeCompare(String(b.name)); });
        return rows;
    }

    /** Referrals made in the period: friends' spend so far against the bonus given, per clinic. */
    function referrals(refRows, friendBills, couponRows, opts) {
        opts = opts || {};
        var spend = {};
        (friendBills || []).forEach(function (b) {
            if (!b || b.voided_at) return;
            var k = String(b.patient_id || '');
            spend[k] = (spend[k] || 0) + num(b.amount_paid);
        });
        var byId = {};
        (couponRows || []).forEach(function (c) { byId[c.id] = c; });
        var map = {};
        (refRows || []).forEach(function (f) {
            if (!inRange(hkDay(f.created_at), opts.from, opts.to) || !clinicOk(f.clinic_code, opts.clinic)) return;
            var k = code(f.clinic_code) || '—';
            var r = map[k] || (map[k] = { clinic: k, referred: 0, rewarded: 0, waiting: 0, voided: 0, friend_spend: 0, bonus_coupons: 0, bonus_points: 0, bonus_total: 0, return_x: 0 });
            r.referred++;
            if (f.status === 'void') { r.voided++; return; }
            r.friend_spend += spend[String(f.referred_patient_id || '')] || 0;
            if (f.status === 'issued') {
                r.rewarded++;
                if (f.reward_kind === 'points') r.bonus_points += num(f.points);
                else if (f.coupon_id && byId[f.coupon_id] && byId[f.coupon_id].status !== 'void') r.bonus_coupons += cashValue(byId[f.coupon_id]);
            } else if (WAITING[f.status]) r.waiting++;
        });
        var rows = Object.keys(map).sort().map(function (k) {
            var r = map[k];
            r.friend_spend = r2(r.friend_spend);
            r.bonus_coupons = r2(r.bonus_coupons);
            r.bonus_points = r2(r.bonus_points);
            r.bonus_total = r2(r.bonus_coupons + r.bonus_points);
            r.return_x = r.bonus_total > 0 ? Math.round(r.friend_spend * 10 / r.bonus_total) / 10 : 0;
            return r;
        });
        return rows;
    }

    /**
     * Per bill: coupon and points value used on it in the period, beside the money paid.
     * Before coupons = bill total + coupons; it splits into coupons + points + other payments + balance.
     */
    function perBill(couponRows, ledgerRows, bills, opts) {
        opts = opts || {};
        var use = {};
        var days = {};
        function slot(id) { return use[id] || (use[id] = { coupon: 0, points: 0 }); }
        function day(d) { return days[d] || (days[d] = { coupon: 0, points: 0 }); }
        var billMap = {};
        (bills || []).forEach(function (b) { if (b && b.id && !b.voided_at) billMap[b.id] = b; });
        (couponRows || []).forEach(function (c) {
            if (c.status !== 'used' || !c.bill_id || !billMap[c.bill_id]) return;
            var d = hkDay(c.redeemed_at);
            if (!inRange(d, opts.from, opts.to)) return;
            slot(c.bill_id).coupon += num(c.redeemed_amount);
            day(d).coupon += num(c.redeemed_amount);
        });
        (ledgerRows || []).forEach(function (l) {
            if (REDEEM_KINDS.indexOf(l.kind) < 0 || !l.bill_id || !billMap[l.bill_id]) return;
            var d = hkDay(l.created_at);
            if (!inRange(d, opts.from, opts.to)) return;
            slot(l.bill_id).points -= num(l.points);
            day(d).points -= num(l.points);
        });
        var rows = Object.keys(use).map(function (id) {
            var b = billMap[id];
            var u = use[id];
            var coupon = r2(u.coupon);
            var points = r2(u.points);
            var total = r2(b.total);
            var paid = r2(b.amount_paid);
            return {
                bill_id: id,
                date: hkDay(b.bill_date || b.created_at),
                patient: [b.patient_no, b.patient_name].filter(Boolean).join(' '),
                before: r2(total + coupon),
                coupon: coupon,
                points: points,
                paid: r2(Math.max(0, paid - points)),
                balance: r2(b.balance)
            };
        }).filter(function (r) { return r.coupon > 0.005 || Math.abs(r.points) > 0.005; })
            .sort(function (a, b) { return String(a.date).localeCompare(String(b.date)) || String(a.patient).localeCompare(String(b.patient)); });
        Object.keys(days).forEach(function (d) { days[d].coupon = r2(days[d].coupon); days[d].points = r2(days[d].points); });
        return { rows: rows, byDay: days };
    }

    function pageAll(build) {
        var out = [];
        var size = 1000;
        function step(from) {
            return Promise.resolve(build().range(from, from + size - 1)).then(function (r) {
                if (r && r.error) throw r.error;
                var data = (r && r.data) || [];
                out = out.concat(data);
                return data.length === size ? step(from + size) : out;
            });
        }
        return step(0);
    }
    function missingTable(e) {
        var s = String((e && (e.code || '')) + ' ' + (e && e.message || ''));
        return /PGRST205|42P01|Could not find the table|does not exist/i.test(s);
    }
    function soft(p) {
        return p.catch(function (e) { if (missingTable(e)) return []; throw e; });
    }
    function hkStartUtc(day) { return new Date(Date.parse(day + 'T00:00:00+08:00')).toISOString(); }
    function nextDay(day) { return new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10); }

    var COUPON_COLS = 'id,code,campaign_key,patient_id,face_value,discount_mode,status,expires_on,issued_at,clinic_code,bill_id,origin_bill_id,redeemed_amount,redeemed_at';

    function loadCoupons() {
        return soft(pageAll(function () { return SB.from('discount_coupons').select(COUPON_COLS).order('issued_at', { ascending: true }); }));
    }
    function loadCouponAudit(from, to) {
        var table = (typeof AUDIT_TRAIL_TABLE !== 'undefined' && AUDIT_TRAIL_TABLE) ? AUDIT_TRAIL_TABLE : 'audit_trail';
        var q = Promise.resolve(SB.from(table)
            .select('created_at,operation,user_name,user_id,clinic_tag,patient_no,changes_detail,record_id')
            .eq('table_name', 'discount_coupons')
            .gte('created_at', hkStartUtc(from)).lt('created_at', hkStartUtc(nextDay(to)))
            .order('created_at', { ascending: false })
            .limit(80)).then(function (r) {
            if (r && r.error) return [];
            return (r && r.data) || [];
        }, function () { return []; });
        return Promise.race([
            q,
            new Promise(function (resolve) { setTimeout(function () { resolve([]); }, 8000); })
        ]);
    }

    /** Coupon log rows for the report (use / pay / void and other tracking). */
    function trackingLog(audits, opts) {
        opts = opts || {};
        function opName(op) {
            var key = ({
                USE: 'coupons.log.use', PAY: 'coupons.log.pay', VOID_PAY: 'coupons.log.voidPay',
                ISSUE: 'coupons.log.issue', GIFT: 'coupons.log.gift', TRANSFER: 'coupons.log.transfer',
                RESTORE: 'coupons.log.restore', CANCEL: 'coupons.log.cancel'
            })[op];
            return key ? tt(key, op) : op;
        }
        return (audits || []).filter(function (a) {
            return inRange(hkDay(a.created_at), opts.from, opts.to) &&
                clinicOk(a.clinic_tag, opts.clinic);
        }).map(function (a) {
            var op = String(a.operation || '').toUpperCase();
            return {
                at: String(a.created_at || '').replace('T', ' ').slice(0, 19),
                op: op,
                action: opName(op),
                who: a.user_name || a.user_id || '',
                clinic: a.clinic_tag || '',
                chart: a.patient_no || '',
                note: a.changes_detail || ''
            };
        }).slice(0, 80);
    }

    function loadRedeemLedger(from, to) {
        return soft(pageAll(function () {
            return SB.from('reward_ledger').select('id,kind,points,bill_id,created_at,clinic_code')
                .in('kind', REDEEM_KINDS).gte('created_at', hkStartUtc(from)).lt('created_at', hkStartUtc(nextDay(to)))
                .order('created_at', { ascending: true });
        }));
    }
    function loadBillsByPatients(ids) {
        ids = ids.filter(Boolean);
        var chunks = [];
        for (var i = 0; i < ids.length; i += 80) chunks.push(ids.slice(i, i + 80));
        return Promise.all(chunks.map(function (chunk) {
            return Promise.resolve(SB.from('bills').select('id,patient_id,amount_paid,voided_at').in('patient_id', chunk)).then(function (r) {
                if (r && r.error) throw r.error;
                return (r && r.data) || [];
            });
        })).then(function (parts) { return [].concat.apply([], parts); });
    }

    /** Coupon / points value used per day (HK date of use) on bills that pass `filterBills`. */
    function usedByDay(from, to, deps) {
        deps = deps || {};
        return Promise.all([loadCoupons(), loadRedeemLedger(from, to)]).then(function (res) {
            var cps = res[0].filter(function (c) { return c.status === 'used' && c.bill_id && inRange(hkDay(c.redeemed_at), from, to); });
            var ids = {};
            cps.forEach(function (c) { ids[c.bill_id] = 1; });
            res[1].forEach(function (l) { if (l.bill_id) ids[l.bill_id] = 1; });
            var list = Object.keys(ids);
            if (!list.length) return { rows: [], byDay: {} };
            return Promise.resolve(deps.fetchBills ? deps.fetchBills(list) : []).then(function (bills) {
                return Promise.resolve(deps.filterBills ? deps.filterBills(bills || [], from, to) : bills);
            }).then(function (bills) {
                return perBill(cps, res[1], bills, { from: from, to: to });
            });
        });
    }

    function load(opts) {
        var from = opts.from;
        var to = opts.to;
        var C = coupons();
        var policyP = C && C.freshZeroPolicy ? C.freshZeroPolicy().catch(function () { return null; }) : Promise.resolve(null);
        var schemeP = C && C.loadState ? Promise.resolve(C.loadState()).catch(function () { return null; }) : Promise.resolve(null);
        return Promise.all([
            loadCoupons(),
            soft(pageAll(function () { return SB.from('reward_accounts').select('id,patient_id,clinic_code,balance').gt('balance', 0).order('id'); })),
            soft(pageAll(function () { return SB.from('discount_coupon_referrals').select('id,referred_patient_id,referrer_patient_id,reward_kind,points,status,coupon_id,clinic_code,created_at').order('created_at'); })),
            loadRedeemLedger(from, to),
            policyP,
            schemeP,
            loadCouponAudit(from, to)
        ]).then(function (res) {
            var refs = res[2];
            var friends = {};
            refs.forEach(function (f) { if (inRange(hkDay(f.created_at), from, to)) friends[f.referred_patient_id] = 1; });
            var used = res[0].filter(function (c) { return c.status === 'used' && c.bill_id && inRange(hkDay(c.redeemed_at), from, to); });
            var billIds = {};
            used.forEach(function (c) { billIds[c.bill_id] = 1; });
            res[3].forEach(function (l) { if (l.bill_id) billIds[l.bill_id] = 1; });
            var ids = Object.keys(billIds);
            return Promise.all([
                loadBillsByPatients(Object.keys(friends)),
                ids.length && opts.fetchBills ? opts.fetchBills(ids) : []
            ]).then(function (more) {
                return Promise.resolve(opts.filterBills ? opts.filterBills(more[1] || [], from, to) : more[1]).then(function (bills) {
                    return { coupons: res[0], accounts: res[1], referrals: refs, ledger: res[3], policy: res[4], friendBills: more[0], bills: bills || [], audits: res[6] || [] };
                });
            });
        });
    }

    function build(data, opts) {
        var C = coupons();
        var label = function (k) { return C && C.campLabel ? (C.campLabel({ campaign_key: k }) || k) : k; };
        var base = { from: opts.from, to: opts.to, today: opts.today, clinic: opts.clinic, policy: data.policy };
        return {
            outstanding: outstanding(data.coupons, data.accounts, base),
            campaigns: campaigns(data.coupons, Object.assign({ label: label }, base)),
            referrals: referrals(data.referrals, data.friendBills, data.coupons, base),
            bills: perBill(data.coupons, data.ledger, data.bills, base),
            log: trackingLog(data.audits, base)
        };
    }

    function table(cols, rows, foot) {
        if (!rows.length) return '<div class="lyr-empty">' + esc(tt('loyaltyReport.none', 'Nothing in this period')) + '</div>';
        function cell(c, r) {
            var v = r[c.key];
            if (c.money) v = money(v);
            else if (c.pct) v = v + '%';
            else if (c.x) v = v ? v + '×' : '—';
            return '<td' + (c.num ? ' class="lyr-num"' : '') + '>' + esc(v) + '</td>';
        }
        return '<div class="lyr-table-wrap"><table class="lyr-table"><thead><tr>' +
            cols.map(function (c) { return '<th' + (c.num ? ' class="lyr-num"' : '') + '>' + esc(c.label) + '</th>'; }).join('') +
            '</tr></thead><tbody>' +
            rows.map(function (r) { return '<tr>' + cols.map(function (c) { return cell(c, r); }).join('') + '</tr>'; }).join('') +
            '</tbody>' + (foot ? '<tfoot><tr>' + cols.map(function (c) { return cell(c, foot); }).join('') + '</tr></tfoot>' : '') +
            '</table></div>';
    }

    var COLS = {
        outstanding: function () {
            return [
                { key: 'clinic', label: tt('loyaltyReport.col.clinic', 'Clinic') },
                { key: 'coupons', label: tt('loyaltyReport.col.liveCoupons', 'Unused coupons'), num: true },
                { key: 'coupon_value', label: tt('loyaltyReport.col.couponValue', 'Coupon cash value'), num: true, money: true },
                { key: 'percent_coupons', label: tt('loyaltyReport.col.percentCoupons', 'of which % coupons'), num: true },
                { key: 'points_people', label: tt('loyaltyReport.col.pointsCharts', 'Charts with points'), num: true },
                { key: 'points', label: tt('loyaltyReport.col.points', 'Unspent points (HK$)'), num: true, money: true },
                { key: 'total', label: tt('loyaltyReport.col.owed', 'Owed if all used'), num: true, money: true }
            ];
        },
        campaigns: function () {
            return [
                { key: 'name', label: tt('loyaltyReport.col.coupon', 'Coupon') },
                { key: 'issued', label: tt('loyaltyReport.col.issued', 'Issued'), num: true },
                { key: 'issued_value', label: tt('loyaltyReport.col.issuedValue', 'Cash value issued'), num: true, money: true },
                { key: 'used', label: tt('loyaltyReport.col.used', 'Used'), num: true },
                { key: 'used_value', label: tt('loyaltyReport.col.usedValue', 'Value used'), num: true, money: true },
                { key: 'use_rate', label: tt('loyaltyReport.col.useRate', 'Use rate'), num: true, pct: true },
                { key: 'live', label: tt('loyaltyReport.col.stillLive', 'Still unused'), num: true },
                { key: 'expired', label: tt('loyaltyReport.col.expired', 'Expired'), num: true },
                { key: 'voided', label: tt('loyaltyReport.col.voided', 'Cancelled'), num: true }
            ];
        },
        referrals: function () {
            return [
                { key: 'clinic', label: tt('loyaltyReport.col.clinic', 'Clinic') },
                { key: 'referred', label: tt('loyaltyReport.col.referred', 'Friends referred'), num: true },
                { key: 'rewarded', label: tt('loyaltyReport.col.rewarded', 'Rewarded'), num: true },
                { key: 'waiting', label: tt('loyaltyReport.col.waiting', 'Waiting'), num: true },
                { key: 'voided', label: tt('loyaltyReport.col.voided', 'Cancelled'), num: true },
                { key: 'friend_spend', label: tt('loyaltyReport.col.friendSpend', 'Friends\u2019 spend so far'), num: true, money: true },
                { key: 'bonus_coupons', label: tt('loyaltyReport.col.bonusCoupons', 'Bonus coupons'), num: true, money: true },
                { key: 'bonus_points', label: tt('loyaltyReport.col.bonusPoints', 'Bonus points (HK$)'), num: true, money: true },
                { key: 'return_x', label: tt('loyaltyReport.col.return', 'Spend per HK$1 bonus'), num: true, x: true }
            ];
        },
        bills: function () {
            return [
                { key: 'date', label: tt('loyaltyReport.col.date', 'Bill date') },
                { key: 'patient', label: tt('loyaltyReport.col.patient', 'Patient') },
                { key: 'before', label: tt('loyaltyReport.col.before', 'Before coupons'), num: true, money: true },
                { key: 'coupon', label: tt('loyaltyReport.col.couponUsed', 'Coupons'), num: true, money: true },
                { key: 'points', label: tt('loyaltyReport.col.pointsUsed', 'Points'), num: true, money: true },
                { key: 'paid', label: tt('loyaltyReport.col.paidIncome', 'Paid (income)'), num: true, money: true },
                { key: 'balance', label: tt('loyaltyReport.col.balance', 'Balance'), num: true, money: true }
            ];
        },
        log: function () {
            return [
                { key: 'at', label: tt('loyaltyReport.col.when', 'When') },
                { key: 'action', label: tt('loyaltyReport.col.action', 'Action') },
                { key: 'who', label: tt('loyaltyReport.col.who', 'By') },
                { key: 'clinic', label: tt('loyaltyReport.col.clinic', 'Clinic') },
                { key: 'chart', label: tt('loyaltyReport.col.chart', 'Chart no.') },
                { key: 'note', label: tt('loyaltyReport.col.detail', 'Detail') }
            ];
        }
    };

    function sumRows(rows, keys, first) {
        var o = {};
        o[first.key] = first.label;
        keys.forEach(function (k) { o[k] = r2(rows.reduce(function (s, r) { return s + num(r[k]); }, 0)); });
        return o;
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function ymOf(day) { return String(day || '').slice(0, 7); }
    function addMonthsYm(ym, n) {
        var s = String(ym || '');
        var y = parseInt(s.slice(0, 4), 10);
        var m = parseInt(s.slice(5, 7), 10) - 1;
        if (!isFinite(y) || !isFinite(m)) {
            var t = new Date();
            y = t.getFullYear();
            m = t.getMonth();
        }
        var d = new Date(y, m + n, 1);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
    }
    function addDaysIso(day, n) {
        var s = String(day || '').slice(0, 10);
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        var d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
        d.setDate(d.getDate() + n);
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }
    function calState(opts) {
        opts = opts || {};
        var today = opts.today || hkDay(new Date().toISOString());
        var from = String(opts.from || '').slice(0, 10);
        var to = String(opts.to || '').slice(0, 10);
        if (from && to && from > to) { var sw = from; from = to; to = sw; }
        return {
            from: from,
            to: to,
            pick: String(opts.pick || '').slice(0, 10),
            viewMonth: String(opts.viewMonth || ymOf(to || today) || ymOf(today)).slice(0, 7),
            today: today
        };
    }
    /** First tap = that day; second tap = the other end. Tables follow at once. */
    function calClickDay(state, day) {
        var s = calState(state);
        day = String(day || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return s;
        if (s.pick && s.pick !== day) {
            return { from: s.pick < day ? s.pick : day, to: s.pick < day ? day : s.pick, pick: '', viewMonth: ymOf(day), today: s.today };
        }
        return { from: day, to: day, pick: day, viewMonth: ymOf(day), today: s.today };
    }
    function calPreset(name, today) {
        today = String(today || hkDay(new Date().toISOString())).slice(0, 10);
        if (name === 'today') return { from: today, to: today, pick: '', viewMonth: ymOf(today), today: today };
        if (name === 'month') return { from: today.slice(0, 7) + '-01', to: today, pick: '', viewMonth: ymOf(today), today: today };
        if (name === 'ytd') return { from: today.slice(0, 4) + '-01-01', to: today, pick: '', viewMonth: ymOf(today), today: today };
        if (name === '30') return { from: addDaysIso(today, -30), to: today, pick: '', viewMonth: ymOf(today), today: today };
        return { from: today, to: today, pick: '', viewMonth: ymOf(today), today: today };
    }
    function calMonthTitle(ym) {
        var y = parseInt(String(ym || '').slice(0, 4), 10);
        var m = parseInt(String(ym || '').slice(5, 7), 10) - 1;
        if (!isFinite(y) || !isFinite(m)) return String(ym || '');
        var loc = 'en-HK';
        try {
            if (typeof appUiLocale === 'function') loc = appUiLocale() || loc;
        } catch (e) {}
        return new Date(y, m, 1).toLocaleDateString(loc, { month: 'long', year: 'numeric' });
    }
    function calWeekdays() {
        var raw = tt('loyaltyReport.cal.wd', 'S,M,T,W,T,F,S');
        var parts = String(raw).split(',');
        if (parts.length !== 7) parts = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
        return parts;
    }
    function calInner(opts) {
        var s = calState(opts);
        var y = parseInt(s.viewMonth.slice(0, 4), 10);
        var mo = parseInt(s.viewMonth.slice(5, 7), 10) - 1;
        if (!isFinite(y) || !isFinite(mo)) {
            var now = new Date();
            y = now.getFullYear();
            mo = now.getMonth();
            s.viewMonth = y + '-' + pad2(mo + 1);
        }
        var first = new Date(y, mo, 1);
        var daysIn = new Date(y, mo + 1, 0).getDate();
        var startPad = first.getDay();
        var wd = calWeekdays();
        var html = '<div class="lyr-cal-mini">' +
            '<div class="lyr-cal-head">' +
            '<button type="button" class="lyr-cal-nav" data-lyr-nav="prev" aria-label="Previous month">‹</button>' +
            '<span class="lyr-cal-title">' + esc(calMonthTitle(s.viewMonth)) + '</span>' +
            '<button type="button" class="lyr-cal-nav" data-lyr-nav="next" aria-label="Next month">›</button>' +
            '</div><div class="lyr-cal-wd">';
        wd.forEach(function (d) { html += '<span>' + esc(d) + '</span>'; });
        html += '</div><div class="lyr-cal-grid">';
        var i;
        for (i = 0; i < startPad; i++) html += '<span class="lyr-cal-pad"></span>';
        for (var day = 1; day <= daysIn; day++) {
            var iso = y + '-' + pad2(mo + 1) + '-' + pad2(day);
            var cls = 'lyr-cal-day';
            if (s.from && s.to && iso >= s.from && iso <= s.to) cls += ' is-in';
            if (iso === s.from) cls += ' is-from';
            if (iso === s.to) cls += ' is-to';
            if (iso === s.today) cls += ' is-today';
            if (s.pick && iso === s.pick) cls += ' is-pick';
            html += '<button type="button" class="' + cls + '" data-lyr-day="' + iso + '">' + day + '</button>';
        }
        html += '</div></div>';
        function presetBtn(key, label) {
            var p = calPreset(key, s.today);
            var on = s.from === p.from && s.to === p.to;
            return '<button type="button" class="lyr-cal-preset' + (on ? ' is-on' : '') + '" data-lyr-preset="' + key + '">' + esc(label) + '</button>';
        }
        var rangeTxt = (s.from && s.to)
            ? (s.from === s.to ? s.from : s.from + ' – ' + s.to)
            : '—';
        html += '<div class="lyr-cal-side">' +
            '<div class="lyr-cal-range-lbl">' + esc(tt('loyaltyReport.cal.range', 'Dates')) + '</div>' +
            '<div class="lyr-cal-range" data-lyr-range>' + esc(rangeTxt) + '</div>' +
            '<div class="lyr-cal-presets">' +
            presetBtn('today', tt('loyaltyReport.cal.today', 'Today')) +
            presetBtn('month', tt('loyaltyReport.cal.month', 'This month')) +
            presetBtn('ytd', tt('loyaltyReport.cal.ytd', 'Year to date')) +
            presetBtn('30', tt('loyaltyReport.cal.days30', 'Last 30 days')) +
            '</div>' +
            '<p class="lyr-cal-hint">' + esc(s.pick
                ? tt('loyaltyReport.cal.hintEnd', 'Tap the end date.')
                : tt('loyaltyReport.cal.hint', 'Tap a date, then another, to filter.')) + '</p>' +
            '</div>';
        return html;
    }
    function calHtml(opts) {
        return '<div class="lyr-cal">' + calInner(opts) + '</div>';
    }
    function bindCal(host, opts) {
        if (!host) return;
        opts = opts || {};
        function current() {
            return calState(opts);
        }
        function apply(next, refresh) {
            opts.from = next.from;
            opts.to = next.to;
            opts.pick = next.pick;
            opts.viewMonth = next.viewMonth;
            opts.today = next.today || opts.today;
            if (refresh) {
                if (typeof opts.onChange === 'function') opts.onChange(next);
                return;
            }
            if (typeof opts.onView === 'function') opts.onView(next.viewMonth);
            host.innerHTML = calInner(opts);
            bindCal(host, opts);
        }
        host.onclick = function (e) {
            var t = e.target;
            if (!t || !t.closest) return;
            var dayBtn = t.closest('[data-lyr-day]');
            if (dayBtn) {
                apply(calClickDay(current(), dayBtn.getAttribute('data-lyr-day')), true);
                return;
            }
            var preBtn = t.closest('[data-lyr-preset]');
            if (preBtn) {
                apply(calPreset(preBtn.getAttribute('data-lyr-preset'), opts.today || current().today), true);
                return;
            }
            var navBtn = t.closest('[data-lyr-nav]');
            if (navBtn) {
                var dir = navBtn.getAttribute('data-lyr-nav');
                if (dir !== 'prev' && dir !== 'next') return;
                var next = current();
                next.viewMonth = addMonthsYm(next.viewMonth, dir === 'prev' ? -1 : 1);
                apply(next, false);
            }
        };
    }

    function html(model, opts) {
        opts = opts || {};
        var totalLabel = tt('loyaltyReport.total', 'Total');
        var out = model.outstanding;
        var outFoot = out.rows.length > 1 ? Object.assign({}, out.total, { clinic: totalLabel }) : null;
        var bills = model.bills.rows;
        var billFoot = bills.length > 1 ? sumRows(bills, ['before', 'coupon', 'points', 'paid', 'balance'], { key: 'date', label: totalLabel }) : null;
        function section(id, title, hint, body) {
            return '<section class="lyr-sec" data-lyr="' + id + '"><h3>' + esc(title) + '</h3>' +
                (hint ? '<p class="lyr-hint">' + esc(hint) + '</p>' : '') + body + '</section>';
        }
        return '<div class="lyr-report">' +
            calHtml(opts) +
            section('outstanding', tt('loyaltyReport.outstanding', 'Unused coupons and unspent points (today)'),
                tt('loyaltyReport.outstandingHint', 'What the clinic would give away if every live coupon and point were used. % coupons have no fixed value and are counted only.'),
                table(COLS.outstanding(), out.rows, outFoot)) +
            section('campaigns', tt('loyaltyReport.campaigns', 'Coupons issued in this period: used or not'),
                tt('loyaltyReport.campaignsHint', 'Counts coupons issued between the dates and what has happened to them since.'),
                table(COLS.campaigns(), model.campaigns)) +
            section('referrals', tt('loyaltyReport.referrals', 'Refer a friend: return'),
                tt('loyaltyReport.referralsHint', 'Friends referred between the dates, what they have paid so far, and the bonus given to the referrers.'),
                table(COLS.referrals(), model.referrals)) +
            section('bills', tt('loyaltyReport.bills', 'Coupons and points used on bills'),
                tt('loyaltyReport.billsHint', 'Before coupons = coupons + points + paid (income) + balance. Coupons and points are not income.'),
                table(COLS.bills(), bills, billFoot)) +
            section('log', tt('loyaltyReport.log', 'Coupon tracking log'),
                tt('loyaltyReport.logHint', 'Use, payment and void lines for tracking. These are not income. The full list is also on Configuration → Coupon log.'),
                table(COLS.log(), model.log || [])) +
            '</div>';
    }

    /** Flat rows for CSV export: one line per table row, with its section name. */
    function csvRows(model) {
        var rows = [];
        function add(sec, list, cols) {
            list.forEach(function (r) {
                var o = { section: sec };
                cols.forEach(function (c) { o[c.key] = r[c.key]; });
                rows.push(o);
            });
        }
        add('outstanding', model.outstanding.rows, COLS.outstanding());
        add('campaigns', model.campaigns, COLS.campaigns());
        add('referrals', model.referrals, COLS.referrals());
        add('bills', model.bills.rows, COLS.bills());
        add('log', model.log || [], COLS.log());
        var keys = {};
        rows.forEach(function (r) { Object.keys(r).forEach(function (k) { keys[k] = 1; }); });
        return rows.map(function (r) {
            var o = {};
            Object.keys(keys).forEach(function (k) { o[k] = r[k] === undefined ? '' : r[k]; });
            return o;
        });
    }

    function render(wrap, opts) {
        return load(opts).then(function (data) {
            var model = build(data, opts);
            if (wrap) wrap.innerHTML = html(model, opts);
            return { model: model, rows: csvRows(model) };
        });
    }

    return {
        hkDay: hkDay,
        outstanding: outstanding,
        campaigns: campaigns,
        referrals: referrals,
        perBill: perBill,
        trackingLog: trackingLog,
        build: build,
        html: html,
        csvRows: csvRows,
        load: load,
        render: render,
        usedByDay: usedByDay,
        calClickDay: calClickDay,
        calPreset: calPreset,
        calHtml: calHtml,
        bindCal: bindCal
    };
})();
