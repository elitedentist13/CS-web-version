#!/usr/bin/env node
/**
 * Runs loyalty_security.sql on an in-memory Postgres (PGlite) with stub patients / bills / payments tables
 * and checks every coupon write function against the scheme rules.
 *
 *   npm i --prefix "%TEMP%\pgl" @electric-sql/pglite@0.2
 *   node scripts/loyalty-security-sql-test.js            (looks for PGlite in %TEMP%\pgl or node_modules)
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');

var ROOT = path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

function loadPglite() {
    var tries = [path.join(os.tmpdir(), 'pgl', 'node_modules', '@electric-sql', 'pglite'), '@electric-sql/pglite'];
    for (var i = 0; i < tries.length; i++) {
        try { return require(tries[i]); } catch (e) { /* next */ }
    }
    return null;
}

var STUBS = [
    "create role anon nologin; create role authenticated nologin;",
    "create table public.clinics (id uuid primary key default gen_random_uuid(), clinic_code text);",
    "create table public.patients (id uuid primary key default gen_random_uuid(), patient_no text, full_name text, created_at timestamptz);",
    "create table public.bills (id uuid primary key default gen_random_uuid(), patient_id uuid, subtotal numeric, discount numeric default 0, total numeric," +
        " balance numeric, amount_paid numeric default 0, status text, voided_at timestamptz);",
    "create table public.bill_payments (id uuid primary key default gen_random_uuid(), bill_id uuid, amount numeric, method text, voided_at timestamptz);",
    "create table public.program_settings (id uuid primary key default gen_random_uuid(), setting_key text, setting_value text, clinic_id uuid," +
        " updated_at timestamptz default now(), auto_backup boolean);",
    "create table public.app_users (user_id text primary key, password text, role text, display_name text, is_active boolean);",
    "create table public.reward_ledger (id uuid primary key default gen_random_uuid(), patient_id uuid);"
].join('\n');

var pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); }
}

async function main() {
    var mod = loadPglite();
    if (!mod) { console.log('SKIP: PGlite not installed (npm i --prefix "%TEMP%\\pgl" @electric-sql/pglite@0.2)'); return; }
    var db = new mod.PGlite();
    async function q(sql, params) { return (await db.query(sql, params || [])).rows; }
    async function one(sql, params) { var r = await q(sql, params); return r[0]; }
    async function call(fn, args) {
        var keys = Object.keys(args);
        var sql = 'select public.' + fn + '(' + keys.map(function (k, i) { return k + ' => $' + (i + 1); }).join(', ') + ') as r';
        return (await one(sql, keys.map(function (k) { return args[k]; }))).r;
    }

    await db.exec(STUBS);
    await db.exec(read('discount_coupons.sql'));
    await db.exec(read('discount_coupons_expiry_sms.sql'));
    await db.exec(read('discount_coupon_referrals.sql'));
    await db.exec(read('loyalty_yearend_sms.sql'));

    var scheme = {
        clinics: { KT: { joined: true }, TW: { joined: false } },
        campaigns: [
            { key: 'spend_1', enabled: true, face: 100, target: 1000, expiryDays: 180, holdLimit: 3 },
            { key: 'spend_2', enabled: false },
            { key: 'new_chart', enabled: true, face: 100, expiryDays: 90, holdLimit: 1 },
            { key: 'referral', enabled: true, minFirstSpend: 500, refPercent: 10, refMax: 1000, refStep: 10, expiryDays: 180, holdLimit: 5 },
            { key: 'cash', enabled: true, face: 100, holdLimit: 5, budget: 450 },
            { key: 'whitening', enabled: true, face: 200, maxDiscount: 200, itemNames: ['Whitening'] }
        ]
    };
    await q("insert into program_settings (setting_key, setting_value, updated_at) values ('discount_coupon_scheme', $1, now() - interval '1 day')", ['{"old":1}']);
    await q("insert into program_settings (setting_key, setting_value, updated_at) values ('discount_coupon_scheme', $1, now())", [JSON.stringify(scheme)]);
    await q("insert into program_settings (setting_key, setting_value) values ('coupon_zero_policy', '{\"zero_policy\":\"none\"}')");
    await q("insert into app_users values ('drchan','pw1','doctor','Dr Chan',true), ('nurse','pw2','nurse','Nurse',true)," +
        " ('cleaner','pw3','cleaner','Cleaner',true), ('olddoc','pw4','doctor','Old',false)");

    await db.exec(read('loyalty_security.sql'));

    console.log('Settings');
    var ps = await q("select setting_value from program_settings where setting_key = 'discount_coupon_scheme'");
    ok('duplicate setting row removed, newest kept', ps.length === 1 && /campaigns/.test(ps[0].setting_value), ps.length);
    var dup = null;
    try { await q("insert into program_settings (setting_key, setting_value) values ('discount_coupon_scheme', '{}')"); } catch (e) { dup = e; }
    ok('unique key stops a second row', !!dup);
    await db.exec(read('loyalty_security.sql'));
    ok('SQL is safe to re-run', true);

    console.log('Helpers');
    ok('non-cash: reward points', (await one("select dc_is_noncash('Reward Points') r")).r === true);
    ok('non-cash: balance transfer', (await one("select dc_is_noncash('balance_transfer') r")).r === true);
    ok('cash: Cash / Visa', (await one("select dc_is_noncash('Cash') a, dc_is_noncash('Visa') b")).a === false);
    ok('excluded: Government / PDCC / 政府', (await one("select dc_is_excluded_method('Government Voucher') and dc_is_excluded_method('PDCC') and dc_is_excluded_method('政府') r")).r === true);
    ok('not excluded: EPS', (await one("select dc_is_excluded_method('EPS') r")).r === false);
    var camp = (await one("select dc_campaign(dc_setting_json('discount_coupon_scheme'), 'referral') r")).r;
    ok('campaign = defaults + saved', camp.face === 100 && camp.refPercent === 10 && camp.trigger === 'referral' && camp.enabled === true, camp);
    ok('year-end cap', (await one("select dc_eff_expiry('2027-06-30', '2026-03-01T10:00:00Z', 'year_end')::text r")).r === '2026-12-31');

    var pt = (await one("insert into patients (patient_no, full_name, created_at) values ('001003','NG PUI CHING', now() - interval '2 years') returning id")).id;
    var pt2 = (await one("insert into patients (patient_no, full_name, created_at) values ('900001','NEW FRIEND', now()) returning id")).id;
    var pt3 = (await one("insert into patients (patient_no, full_name, created_at) values ('900002','OTHER', now()) returning id")).id;
    async function bill(pid, total, pays, opts) {
        opts = opts || {};
        var paid = pays.reduce(function (s, p) { return s + p[0]; }, 0);
        var b = (await one('insert into bills (patient_id, subtotal, total, balance, amount_paid, voided_at) values ($1,$2,$2,$3,$4,$5) returning id',
            [pid, total, Math.max(0, total - paid), paid, opts.voided ? new Date().toISOString() : null])).id;
        for (var i = 0; i < pays.length; i++) await q('insert into bill_payments (bill_id, amount, method) values ($1,$2,$3)', [b, pays[i][0], pays[i][1]]);
        return b;
    }
    function issue(args) {
        return call('dc_issue_coupon', Object.assign({ p_clinic_code: 'KT' }, args));
    }

    console.log('Spend coupons');
    var b1 = await bill(pt, 1200, [[700, 'Cash'], [500, 'Visa']]);
    var r = await issue({ p_kind: 'spend', p_patient_id: pt, p_campaign_key: 'spend_1', p_bill_id: b1 });
    ok('fully paid HK$1,200 cash → spend_1 issued', r.ok && Number(r.row.face_value) === 100 && /^DC-[0-9A-F]{6}$/.test(r.code), r);
    ok('expiry set by server (today + 180)', r.ok && (await one("select (expires_on - dc_hk_today()) d from discount_coupons where id = $1", [r.id])).d === 180);
    r = await issue({ p_kind: 'spend', p_patient_id: pt, p_campaign_key: 'spend_1', p_bill_id: b1 });
    ok('same bill twice → already', !r.ok && r.reason === 'already', r);
    r = await issue({ p_kind: 'spend', p_patient_id: pt, p_campaign_key: 'spend_2', p_bill_id: b1 });
    ok('campaign off → campaign_off', !r.ok && r.reason === 'campaign_off', r);
    var b2 = await bill(pt, 1200, [[700, 'Cash']]);
    r = await issue({ p_kind: 'spend', p_patient_id: pt, p_campaign_key: 'spend_1', p_bill_id: b2 });
    ok('part paid → not_paid', !r.ok && r.reason === 'not_paid', r);
    var b3 = await bill(pt, 1200, [[300, 'Cash'], [900, 'Reward Points']]);
    r = await issue({ p_kind: 'spend', p_patient_id: pt, p_campaign_key: 'spend_1', p_bill_id: b3 });
    ok('points not counted as cash → below_target', !r.ok && r.reason === 'below_target', r);
    var b4 = await bill(pt, 1200, [[1200, 'Government Voucher']]);
    r = await issue({ p_kind: 'spend', p_patient_id: pt, p_campaign_key: 'spend_1', p_bill_id: b4 });
    ok('Government bill → excluded_method', !r.ok && r.reason === 'excluded_method', r);
    r = await issue({ p_kind: 'spend', p_patient_id: pt2, p_campaign_key: 'spend_1', p_bill_id: b1 });
    ok('someone else\u2019s bill → bill', !r.ok && r.reason === 'bill', r);
    var b5 = await bill(pt, 1200, [[1200, 'Cash']], { voided: true });
    r = await issue({ p_kind: 'spend', p_patient_id: pt, p_campaign_key: 'spend_1', p_bill_id: b5 });
    ok('voided bill → bill', !r.ok && r.reason === 'bill', r);
    r = await issue({ p_kind: 'spend', p_patient_id: pt, p_campaign_key: 'spend_1', p_bill_id: b1, p_clinic_code: 'TW' });
    ok('clinic not joined → clinic', !r.ok && r.reason === 'clinic', r);
    r = await issue({ p_kind: 'spend', p_patient_id: pt, p_campaign_key: 'spend_1', p_bill_id: b1, p_clinic_code: 'MK' });
    ok('clinic never set up → not joined (only KT by default)', !r.ok && r.reason === 'clinic', r);
    r = await issue({ p_kind: 'gift', p_patient_id: pt, p_campaign_key: 'spend_1', p_user: 'drchan', p_password: 'pw1' });
    ok('spend coupon cannot be gifted → automatic', !r.ok && r.reason === 'automatic', r);
    for (var i = 0; i < 2; i++) {
        var bx = await bill(pt, 1000, [[1000, 'Cash']]);
        await issue({ p_kind: 'spend', p_patient_id: pt, p_campaign_key: 'spend_1', p_bill_id: bx });
    }
    var b6 = await bill(pt, 1000, [[1000, 'Cash']]);
    r = await issue({ p_kind: 'spend', p_patient_id: pt, p_campaign_key: 'spend_1', p_bill_id: b6 });
    ok('hold limit 3 → already_holding', !r.ok && r.reason === 'already_holding', r);

    console.log('New chart');
    r = await issue({ p_kind: 'new_chart', p_patient_id: pt2, p_campaign_key: 'new_chart' });
    ok('new chart → welcome coupon', r.ok, r);
    r = await issue({ p_kind: 'new_chart', p_patient_id: pt2, p_campaign_key: 'new_chart' });
    ok('second welcome → refused', !r.ok, r);
    r = await issue({ p_kind: 'new_chart', p_patient_id: pt, p_campaign_key: 'new_chart' });
    ok('2-year-old chart → not_new', !r.ok && r.reason === 'not_new', r);

    console.log('Gifts');
    r = await issue({ p_kind: 'gift', p_patient_id: pt3, p_campaign_key: 'cash', p_amount: 150, p_user: 'drchan', p_password: 'pw1' });
    ok('own login gift HK$150 → issued by Dr Chan', r.ok && Number(r.row.face_value) === 150 && r.row.issued_by === 'Dr Chan', r);
    r = await issue({ p_kind: 'gift', p_patient_id: pt3, p_campaign_key: 'cash', p_amount: 150, p_user: 'drchan', p_password: 'bad' });
    ok('wrong password → creds', !r.ok && r.reason === 'creds', r);
    r = await issue({ p_kind: 'gift', p_patient_id: pt3, p_campaign_key: 'cash', p_amount: 150, p_user: 'nurse', p_password: 'pw2' });
    ok('shared Nurse login → creds', !r.ok && r.reason === 'creds', r);
    r = await issue({ p_kind: 'gift', p_patient_id: pt3, p_campaign_key: 'cash', p_amount: 150, p_user: 'olddoc', p_password: 'pw4' });
    ok('inactive login → creds', !r.ok && r.reason === 'creds', r);
    r = await issue({ p_kind: 'gift', p_patient_id: pt3, p_campaign_key: 'cash', p_amount: 150, p_user: 'cleaner', p_password: 'pw3' });
    ok('role not allowed → role', !r.ok && r.reason === 'role', r);
    r = await issue({ p_kind: 'gift', p_patient_id: pt3, p_campaign_key: 'cash', p_amount: 5000, p_user: 'drchan', p_password: 'pw1' });
    ok('cash gift over HK$200 → amount', !r.ok && r.reason === 'amount', r);
    r = await issue({ p_kind: 'gift', p_patient_id: pt3, p_campaign_key: 'cash', p_amount: 200, p_user: 'drchan', p_password: 'pw1' });
    ok('HK$200 gift fits budget 450 (150+200)', r.ok, r);
    r = await issue({ p_kind: 'gift', p_patient_id: pt3, p_campaign_key: 'cash', p_amount: 200, p_user: 'drchan', p_password: 'pw1' });
    ok('budget HK$450 reached → budget', !r.ok && r.reason === 'budget', r);
    r = await issue({ p_kind: 'gift', p_patient_id: pt3, p_campaign_key: 'whitening', p_user: 'drchan', p_password: 'pw1' });
    ok('item coupon keeps its treatments', r.ok && JSON.stringify(r.row.item_names) === '["Whitening"]' && Number(r.row.face_value) === 200, r);

    console.log('Referral ladder');
    var ref = (await one("insert into discount_coupon_referrals (referred_patient_id, referrer_patient_id, status, reward_kind) values ($1,$2,'pending','coupon') returning id", [pt2, pt])).id;
    var fb = await bill(pt2, 2345, [[680, 'Cash']]);
    r = await call('dc_referral_set', { p_id: ref, p_action: 'claim', p_bill_id: b1 });
    ok('claim with the referrer\u2019s own bill → bill', !r.ok && r.reason === 'bill', r);
    r = await call('dc_referral_set', { p_id: ref, p_action: 'claim', p_bill_id: fb });
    ok('claim friend\u2019s bill → issuing', r.ok, r);
    r = await call('dc_referral_set', { p_id: ref, p_action: 'claim', p_bill_id: fb });
    ok('second claim → taken', !r.ok && r.reason === 'taken', r);
    await q("update discount_coupons set status = 'void' where patient_id = $1 and campaign_key = 'spend_1'", [pt]);
    r = await issue({ p_kind: 'referral', p_patient_id: pt, p_campaign_key: 'referral', p_bill_id: fb, p_referral_id: ref });
    ok('part paid HK$680 → wait_full', !r.ok && r.reason === 'wait_full', r);
    await q("insert into bill_payments (bill_id, amount, method) values ($1, 1665, 'Cash')", [fb]);
    await q('update bills set balance = 0, amount_paid = 2345 where id = $1', [fb]);
    r = await issue({ p_kind: 'referral', p_patient_id: pt3, p_campaign_key: 'referral', p_bill_id: fb, p_referral_id: ref });
    ok('wrong referrer → not_pending', !r.ok && r.reason === 'not_pending', r);
    r = await issue({ p_kind: 'referral', p_patient_id: pt, p_campaign_key: 'referral', p_bill_id: fb, p_referral_id: ref });
    ok('fully paid HK$2,345 → HK$230 (10%, down to HK$10)', r.ok && Number(r.row.face_value) === 230, r);
    var rec = await one('select status, coupon_id from discount_coupon_referrals where id = $1', [ref]);
    ok('record marked issued with the coupon', rec.status === 'issued' && rec.coupon_id === r.id, rec);
    r = await issue({ p_kind: 'referral', p_patient_id: pt, p_campaign_key: 'referral', p_bill_id: fb, p_referral_id: ref });
    ok('issued twice → not_pending', !r.ok && r.reason === 'not_pending', r);
    r = await call('dc_referral_set', { p_id: ref, p_action: 'reopen', p_reason: 'bill_voided' });
    ok('reopen while the bill is still paid → still_paid', !r.ok && r.reason === 'still_paid', r);
    var pt4 = (await one("insert into patients (patient_no, created_at) values ('900003', now()) returning id")).id;
    var ref2 = (await one("insert into discount_coupon_referrals (referred_patient_id, referrer_patient_id, status, reward_kind) values ($1,$2,'pending','coupon') returning id", [pt4, pt3])).id;
    var big = await bill(pt4, 20000, [[20000, 'Cash']]);
    await call('dc_referral_set', { p_id: ref2, p_action: 'claim', p_bill_id: big });
    r = await issue({ p_kind: 'referral', p_patient_id: pt3, p_campaign_key: 'referral', p_bill_id: big, p_referral_id: ref2 });
    ok('HK$20,000 bill → capped HK$1,000', r.ok && Number(r.row.face_value) === 1000, r);
    r = await call('dc_referral_register', { p_referred_id: pt4, p_referrer_id: pt, p_referred_no: '900003', p_referrer_no: '001003', p_kind: 'coupon', p_status: 'pending' });
    ok('one referral per friend → already', !r.ok && r.reason === 'already', r);
    r = await call('dc_referral_register', { p_referred_id: pt, p_referrer_id: pt, p_referred_no: '', p_referrer_no: '', p_kind: 'coupon', p_status: 'pending' });
    ok('self referral → patient', !r.ok && r.reason === 'patient', r);
    r = await call('dc_referral_register', { p_referred_id: pt3, p_referrer_id: pt, p_referred_no: '900002', p_referrer_no: '001003', p_kind: 'coupon', p_status: 'issued' });
    ok('cannot register as issued → status', !r.ok && r.reason === 'status', r);

    console.log('Coupons on a bill');
    var w = await one("select id, face_value from discount_coupons where patient_id = $1 and campaign_key = 'referral' and status = 'unused'", [pt]);
    var nb = await bill(pt, 500, []);
    r = await call('dc_bill_set_coupons', { p_bill_id: nb, p_items: JSON.stringify([{ id: w.id, amount: 999 }]) });
    ok('redeem more than the coupon → amount', !r.ok && r.reason === 'amount', r);
    r = await call('dc_bill_set_coupons', { p_bill_id: b4, p_items: JSON.stringify([{ id: w.id, amount: 100 }]) });
    ok('Government bill → excluded_method', !r.ok && r.reason === 'excluded_method', r);
    var other = await bill(pt3, 500, []);
    r = await call('dc_bill_set_coupons', { p_bill_id: other, p_items: JSON.stringify([{ id: w.id, amount: 100 }]) });
    ok('another patient\u2019s coupon → not_in_wallet', !r.ok && r.reason === 'not_in_wallet', r);
    r = await call('dc_bill_set_coupons', { p_bill_id: nb, p_items: JSON.stringify([{ id: w.id, amount: 230, line_name: null }]) });
    var used = await one('select status, bill_id, redeemed_amount from discount_coupons where id = $1', [w.id]);
    ok('redeem HK$230 → used on the bill', r.ok && used.status === 'used' && used.bill_id === nb && Number(used.redeemed_amount) === 230, [r, used]);
    r = await call('dc_bill_set_coupons', { p_bill_id: nb, p_items: '[]' });
    ok('remove before payment → back to wallet', r.ok && (await one('select status from discount_coupons where id = $1', [w.id])).status === 'unused', r);
    await call('dc_bill_set_coupons', { p_bill_id: nb, p_items: JSON.stringify([{ id: w.id, amount: 230 }]) });
    await q("insert into bill_payments (bill_id, amount, method) values ($1, 270, 'Cash')", [nb]);
    await q('update bills set amount_paid = 270, balance = 0 where id = $1', [nb]);
    r = await call('dc_bill_set_coupons', { p_bill_id: nb, p_items: '[]' });
    ok('fully paid bill keeps its coupon → bill_paid', !r.ok && r.reason === 'bill_paid', r);
    r = await call('dc_bill_release', { p_bill_id: nb, p_coupon_ids: null });
    ok('release on a paid bill → bill_paid', !r.ok && r.reason === 'bill_paid', r);
    await q('update bills set voided_at = now() where id = $1', [nb]);
    r = await call('dc_bill_release', { p_bill_id: nb, p_coupon_ids: [w.id] });
    ok('bill voided → coupon back to wallet', r.ok && r.count === 1, r);
    var reused = await one("select id from discount_coupons where status = 'used' limit 1");
    ok('nothing left used', !reused);

    console.log('Take back earned coupons');
    var earned = await one("select id from discount_coupons where origin_bill_id = $1 and status = 'unused'", [b1]);
    r = await call('dc_void_earned', { p_bill_id: b1, p_coupon_ids: earned ? [earned.id] : null, p_note: 'x' });
    ok('bill still paid → still_paid (or none left)', !r.ok ? r.reason === 'still_paid' : true, r);
    var b7 = await bill(pt3, 1000, [[1000, 'Cash']]);
    var e7 = await issue({ p_kind: 'spend', p_patient_id: pt3, p_campaign_key: 'spend_1', p_bill_id: b7 });
    r = await call('dc_void_earned', { p_bill_id: b7, p_coupon_ids: [e7.id], p_note: 'Voided with payment' });
    ok('paid bill → still_paid', !r.ok && r.reason === 'still_paid', r);
    await q('update bill_payments set voided_at = now() where bill_id = $1', [b7]);
    await q('update bills set balance = 1000, amount_paid = 0 where id = $1', [b7]);
    r = await call('dc_void_earned', { p_bill_id: b7, p_coupon_ids: [e7.id], p_note: 'Voided with payment' });
    ok('payment voided → coupon void', r.ok && r.count === 1 && (await one('select status from discount_coupons where id = $1', [e7.id])).status === 'void', r);

    console.log('Transfer');
    var gift = await one("select id from discount_coupons where patient_id = $1 and campaign_key = 'cash' and status = 'unused' limit 1", [pt3]);
    r = await call('dc_transfer_coupon', { p_coupon_id: gift.id, p_to_patient_id: pt, p_user: 'drchan', p_password: 'nope' });
    ok('transfer wrong password → creds', !r.ok && r.reason === 'creds', r);
    r = await call('dc_transfer_coupon', { p_coupon_id: gift.id, p_to_patient_id: pt, p_user: 'drchan', p_password: 'pw1', p_note: 'to 001003' });
    ok('transfer own login → moved', r.ok && (await one('select patient_id from discount_coupons where id = $1', [gift.id])).patient_id === pt, r);
    var lockedC = await one("select id from discount_coupons where campaign_key = 'new_chart' limit 1");
    r = await call('dc_transfer_coupon', { p_coupon_id: lockedC.id, p_to_patient_id: pt, p_user: 'drchan', p_password: 'pw1' });
    ok('welcome coupon cannot move → locked', !r.ok && r.reason === 'locked', r);

    console.log('Reminder claims');
    r = await call('dc_expiry_sms_claim', { p_coupon_id: gift.id, p_column: 'expiry_sms_at', p_claim: true });
    var r2 = await call('dc_expiry_sms_claim', { p_coupon_id: gift.id, p_column: 'expiry_sms_at', p_claim: true });
    ok('expiry SMS claimed once', r === true && r2 === false, [r, r2]);
    r = await call('dc_expiry_sms_claim', { p_coupon_id: gift.id, p_column: 'status', p_claim: true });
    ok('other columns refused', r === false);
    var ids = await call('loyalty_yearend_claim', { p_scheme: 'coupons', p_year: 2026, p_stage: 'month', p_person_keys: ['p:a', 'p:b'] });
    var again = await call('loyalty_yearend_claim', { p_scheme: 'coupons', p_year: 2026, p_stage: 'month', p_person_keys: ['p:b'] });
    ok('year-end claim once per person', Array.isArray(ids) && ids.length === 2 && again === null, [ids, again]);
    r = await call('loyalty_yearend_finish', { p_ids: ids, p_status: 'release' });
    ok('failed send gives the claim back', r === 2);

    console.log('Chart deleted');
    await q('delete from patients where id = $1', [pt4]);
    r = await call('dc_referral_set', { p_id: ref2, p_action: 'void' });
    var big1 = await one("select status from discount_coupons where campaign_key = 'referral' and patient_id = $1", [pt3]);
    ok('friend\u2019s chart deleted → record void, unused coupon void', r.ok && big1.status === 'void', [r, big1]);
    r = await call('dc_referral_set', { p_id: ref, p_action: 'void' });
    ok('both charts exist → charts_exist', !r.ok && r.reason === 'charts_exist', r);

    console.log('Lock-down');
    var priv = await q("select privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_name in ('discount_coupons','discount_coupon_referrals','loyalty_yearend_sms') order by 1");
    var kinds = priv.map(function (p) { return p.privilege_type; });
    ok('anon keeps SELECT only on coupon tables', kinds.indexOf('SELECT') >= 0 && kinds.indexOf('INSERT') < 0 && kinds.indexOf('UPDATE') < 0 && kinds.indexOf('DELETE') < 0, kinds);
    var ex = await q("select has_function_privilege('anon', 'public.dc_issue_coupon(text,uuid,text,text,uuid,uuid,numeric,text,text,text,text,jsonb)', 'execute') a," +
        " has_function_privilege('anon', 'public.dc_check_staff(text,text)', 'execute') b");
    ok('anon can call dc_issue_coupon, not dc_check_staff', ex[0].a === true && ex[0].b === false, ex[0]);
    await db.exec('set role anon');
    var denied = null;
    try { await q("update discount_coupons set face_value = 9999"); } catch (e) { denied = e; }
    ok('anon direct UPDATE refused', !!denied && /permission denied/i.test(String(denied.message)));
    var viaFn = await call('dc_expiry_sms_claim', { p_coupon_id: gift.id, p_column: 'expiry_sms_month_at', p_claim: true });
    ok('anon writes through the function', viaFn === true);
    await db.exec('reset role');

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail ? 1 : 0;
}

main().catch(function (e) { console.error(e); process.exitCode = 1; });
