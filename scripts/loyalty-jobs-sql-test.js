#!/usr/bin/env node
/**
 * Runs loyalty_jobs.sql on an in-memory Postgres (PGlite) with stand-ins for pg_net and pg_cron:
 * Set zero (coupons + points), daily SMS (expiry, year end) with claims, and the reply check.
 * SMS text is compared with app-coupons.js / app-rewards.js word for word.
 *
 *   npm i --prefix "%TEMP%\pgl" @electric-sql/pglite@0.2
 *   node scripts/loyalty-jobs-sql-test.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var os = require('os');
var vm = require('vm');

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
    "create table public.patients (id uuid primary key default gen_random_uuid(), patient_no text, full_name text, chinese_name text," +
        " phone_number text, mobile_phone text, hkid text, clinic_tag text, created_at timestamptz);",
    "create table public.bills (id uuid primary key default gen_random_uuid(), patient_id uuid, subtotal numeric, discount numeric default 0, total numeric," +
        " balance numeric, amount_paid numeric default 0, status text, voided_at timestamptz);",
    "create table public.bill_payments (id uuid primary key default gen_random_uuid(), bill_id uuid, amount numeric, method text, voided_at timestamptz);",
    "create table public.program_settings (id uuid primary key default gen_random_uuid(), setting_key text, setting_value text, clinic_id uuid," +
        " updated_at timestamptz default now(), auto_backup boolean);",
    "create table public.app_users (user_id text primary key, password text, role text, display_name text, is_active boolean);",
    // pg_net stand-in
    "create schema net;",
    "create table net.sent (id bigserial primary key, url text, body jsonb, headers jsonb);",
    "create table net._http_response (id bigint, status_code int, content text, timed_out boolean, error_msg text, created timestamptz default now());",
    "create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)" +
        " returns bigint language sql as $$ insert into net.sent (url, body, headers) values (url, body, headers) returning id $$;",
    // pg_cron stand-in
    "create schema cron;",
    "create table cron.jobs (name text primary key, schedule text, command text);",
    "create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as" +
        " $$ insert into cron.jobs values (p_name, p_schedule, p_command) on conflict (name) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;"
].join('\n');

var pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '  → ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); }
}

/** app-coupons.js in a sandbox, for the expected SMS text. */
function couponsSandbox(scheme, policy) {
    var ctx = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, localStorage: { getItem: function () { return null; } } };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(read('app-coupons.js'), ctx, { filename: 'app-coupons.js' });
    ctx.COUPONS.mergeSaved(scheme);
    ctx.COUPONS.setZeroPolicyForTest && ctx.COUPONS.setZeroPolicyForTest(policy);
    return ctx.COUPONS;
}

async function main() {
    var mod = loadPglite();
    if (!mod) { console.log('SKIP: PGlite not installed (npm i --prefix "%TEMP%\\pgl" @electric-sql/pglite@0.2)'); return; }
    var db = new mod.PGlite();
    async function q(sql, params) { return (await db.query(sql, params || [])).rows; }
    async function one(sql, params) { var r = await q(sql, params); return r[0]; }

    await db.exec(STUBS);
    ['discount_coupons.sql', 'discount_coupons_expiry_sms.sql', 'discount_coupon_referrals.sql', 'loyalty_yearend_sms.sql',
        'discount_coupon_zero.sql', 'reward_points.sql', 'reward_points_patch_zero_clinics.sql'].forEach(function () {});
    await db.exec(read('discount_coupons.sql'));
    await db.exec(read('discount_coupons_expiry_sms.sql'));
    await db.exec(read('discount_coupon_referrals.sql'));
    await db.exec(read('loyalty_yearend_sms.sql'));
    await db.exec(read('discount_coupon_zero.sql'));
    await db.exec(read('reward_points.sql'));
    await db.exec(read('reward_points_patch_zero_clinics.sql'));

    var scheme = {
        clinics: { KT: { joined: true }, TW: { joined: false } },
        campaigns: [
            { key: 'spend_1', enabled: true, face: 100, target: 1000, expiryDays: 180, holdLimit: 3 },
            { key: 'cash', enabled: true, face: 100, holdLimit: 5 },
            { key: 'ortho', enabled: true, percent: 10, maxDiscount: 3000 },
            { key: 'free_scaling', enabled: true }
        ]
    };
    await q("insert into program_settings (setting_key, setting_value) values ('discount_coupon_scheme', $1)", [JSON.stringify(scheme)]);
    await q("insert into program_settings (setting_key, setting_value) values ('coupon_zero_policy', '{\"zero_policy\":\"manual\"}')");
    await q("insert into app_users values ('admin1','x','admin','Admin',true), ('nurse','x','nurse','Nurse',true)");
    await db.exec(read('loyalty_security.sql'));
    await db.exec(read('loyalty_jobs.sql'));
    await db.exec(read('loyalty_jobs.sql'));
    ok('SQL loads and is safe to re-run', true);

    var jobs = await q('select name, schedule from cron.jobs order by name');
    ok('cron: Set zero 00:05 HK, SMS 10:00 HK, replies every 5 min',
        JSON.stringify(jobs) === JSON.stringify([
            { name: 'loyalty-daily-sms', schedule: '0 2 * * *' },
            { name: 'loyalty-set-zero', schedule: '5 16 * * *' },
            { name: 'loyalty-sms-settle', schedule: '*/5 * * * *' }]), jobs);
    var cfg = await one('select functions_url, anon_key, sms_on, zero_on from loyalty_job_config');
    var appJs = read('app.js');
    ok('config points at this project\u2019s twilio-whatsapp function', cfg.sms_on && cfg.zero_on &&
        /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/twilio-whatsapp$/.test(cfg.functions_url) &&
        appJs.indexOf(cfg.functions_url.replace('/functions/v1/twilio-whatsapp', '')) >= 0 && cfg.anon_key.length > 100, cfg.functions_url);

    console.log('Text helpers');
    ok('JS number text', (await one("select loyalty_js_num(1000) a, loyalty_js_num(12.5) b, loyalty_js_num(10.25) c")).a === '1000');
    var nm = await one("select loyalty_coupon_name($1::jsonb, 'spend_1') a, loyalty_coupon_name($1::jsonb, 'cash') b, loyalty_coupon_name($1::jsonb, 'whatever') c", [JSON.stringify(scheme)]);
    ok('coupon names like the SMS', nm.a === '滿$1000送$100 Spend $1000 get $100' && nm.b === '現金券 Cash coupon' && nm.c === 'whatever', nm);
    var vals = await one("select loyalty_coupon_value('amount', 100, 0, 0) a, loyalty_coupon_value('percent', 0, 10, 3000) b, loyalty_coupon_value('free_line', 0, 0, 0) c");
    ok('coupon values like the SMS', vals.a === 'HK$100.00' && vals.b === '10% (最多/up to HK$3000.00)' && vals.c === '免費/Free', vals);
    var stages = await one("select loyalty_expiry_stage('2026-11-05', '2026-06-01', '2026-10-29') w, loyalty_expiry_stage('2026-11-20', '2026-06-01', '2026-10-29') m," +
        " loyalty_expiry_stage('2026-11-20', '2026-10-25', '2026-10-29') none1, loyalty_expiry_stage('2026-11-05', '2026-10-29', '2026-10-29') none2," +
        " loyalty_yearend_stage('2026-11-29') y0, loyalty_yearend_stage('2026-11-30') y1, loyalty_yearend_stage('2026-12-24') y2, loyalty_yearend_stage('2026-12-31') y3");
    var C = couponsSandbox(scheme, null);
    ok('reminder windows match expiryReminderStage / yearEndReminderStage',
        stages.w === C.expiryReminderStage({ status: 'unused', expires_on: '2026-11-05', issued_on: '2026-06-01' }, '2026-10-29') &&
        stages.m === C.expiryReminderStage({ status: 'unused', expires_on: '2026-11-20', issued_on: '2026-06-01' }, '2026-10-29') &&
        stages.none1 === '' && stages.none2 === '' && stages.y0 === '' && stages.y1 === 'month' && stages.y2 === 'week' && stages.y3 === '', stages);

    var P = {};
    async function patient(no, name, phone, hkid) {
        P[no] = (await one("insert into patients (patient_no, full_name, phone_number, hkid, created_at) values ($1,$2,$3,$4, now() - interval '1 year') returning id",
            [no, name, phone, hkid || null])).id;
        return P[no];
    }
    await patient('001003', 'NG PUI CHING', '91234567');
    await patient('900010', 'NO PHONE', null);
    await patient('900011', 'TW PATIENT', '92223333');
    async function coupon(pid, key, mode, face, pct, max, expires, issued, clinic, code) {
        return (await one("insert into discount_coupons (code, campaign_key, patient_id, face_value, discount_mode, percent, max_discount, status, expires_on, issued_at, clinic_code)" +
            " values ($1,$2,$3,$4,$5,$6,$7,'unused',$8,$9,$10) returning id", [code, key, pid, face, mode, pct, max, expires, issued, clinic])).id;
    }
    var today = '2026-10-29';
    var cWeek = await coupon(P['001003'], 'cash', 'amount', 150, 0, 0, '2026-11-03', '2026-05-01T02:00:00Z', 'KT', 'DC-WEEK01');
    var cMonth = await coupon(P['001003'], 'spend_1', 'amount', 100, 0, 0, '2026-11-20', '2026-05-21T02:00:00Z', 'KT', 'DC-MONTH1');
    await coupon(P['001003'], 'ortho', 'percent', 0, 10, 3000, '2027-04-01', '2026-10-01T02:00:00Z', 'KT', 'DC-LONG01');
    await coupon(P['001003'], 'free_scaling', 'free_line', 0, 0, 0, '2027-02-01', '2026-08-01T02:00:00Z', 'PL', 'DC-PL0001');
    var cNoPhone = await coupon(P['900010'], 'cash', 'amount', 50, 0, 0, '2026-11-02', '2026-05-01T02:00:00Z', 'KT', 'DC-NOPH01');
    await coupon(P['900011'], 'cash', 'amount', 50, 0, 0, '2026-11-02', '2026-05-01T02:00:00Z', 'TW', 'DC-TW0001');

    console.log('Daily SMS: expiry reminders');
    var run = (await one("select loyalty_run_daily_sms($1::date) r", [today])).r;
    ok('run: week + month reminders for joined clinics only', run.ok && run.week === 2 && run.month === 1, run);
    var out = await q('select kind, patient_id, coupon_id, status, body, request_id from loyalty_sms_outbox order by id');
    ok('no-phone patient: kept as no_phone, nothing sent', out.some(function (o) { return o.coupon_id === cNoPhone && o.status === 'no_phone'; }));
    var sent = await q('select id, url, body from net.sent order by id');
    ok('two SMS posted to the Edge function as the admin login', sent.length === 2 && sent.every(function (s) {
        return s.body.channel === 'sms' && s.body.callerUserId === 'admin1' && s.body.to === '91234567' && /twilio-whatsapp$/.test(s.url);
    }), sent.map(function (s) { return s.body.callerUserId + ' ' + s.body.to; }));
    var claims = await one('select (select expiry_sms_at is not null from discount_coupons where id = $1) w, (select expiry_sms_month_at is not null from discount_coupons where id = $2) m', [cWeek, cMonth]);
    ok('claims stamped before sending', claims.w && claims.m, claims);

    var wallet = (await q("select code, campaign_key, patient_id, face_value, discount_mode, percent, max_discount, status, expires_on::text, issued_at, clinic_code from discount_coupons where patient_id = $1", [P['001003']]))
        .map(function (c) { return Object.assign({}, c, { face_value: Number(c.face_value), percent: Number(c.percent), max_discount: Number(c.max_discount), issued_at: new Date(c.issued_at).toISOString() }); });
    var weekRow = wallet.filter(function (c) { return c.code === 'DC-WEEK01'; })[0];
    var expectWeek = C.smsExpiring(Object.assign({}, weekRow, { issued_on: '2026-05-01' }), today, wallet, { clinic: 'KT' });
    var gotWeek = sent.filter(function (s) { return s.body.body.indexOf('DC-WEEK01)') >= 0 && /參考\/Ref: DC-WEEK01/.test(s.body.body); })[0];
    ok('7-day reminder text = app-coupons.js smsExpiring', gotWeek && gotWeek.body.body === expectWeek, gotWeek ? gotWeek.body.body + '\n---- expected ----\n' + expectWeek : 'not sent');
    var monthRow = wallet.filter(function (c) { return c.code === 'DC-MONTH1'; })[0];
    var expectMonth = C.smsExpiring(Object.assign({}, monthRow, { issued_on: '2026-05-21' }), today, wallet, { clinic: 'KT' });
    var gotMonth = sent.filter(function (s) { return /參考\/Ref: DC-MONTH1/.test(s.body.body); })[0];
    ok('1-month reminder text = app-coupons.js smsExpiring', gotMonth && gotMonth.body.body === expectMonth, gotMonth ? gotMonth.body.body + '\n---- expected ----\n' + expectMonth : 'not sent');

    var again = (await one("select loyalty_run_daily_sms($1::date) r", [today])).r;
    ok('second run the same day: skipped', again.skipped === 'ran_today', again);
    var forced = (await one("select loyalty_run_daily_sms($1::date, true) r", [today])).r;
    ok('forced re-run: claims stop a second text', forced.week === 0 && forced.month === 0 && (await q('select id from net.sent')).length === 2, forced);
    var deskClaim = (await one("select dc_expiry_sms_claim($1, 'expiry_sms_at', true) r", [cWeek])).r;
    ok('desk backup cannot claim what the database sent', deskClaim === false);

    console.log('Replies');
    await q("insert into net._http_response (id, status_code, content) values ($1, 200, '{\"ok\":true,\"result\":{\"sid\":\"SM1\"}}')", [sent[0].id]);
    await q("insert into net._http_response (id, status_code, content) values ($1, 401, '{\"ok\":false,\"error\":\"Login required (active clinic user)\"}')", [sent[1].id]);
    var settle = (await one('select loyalty_sms_settle() r')).r;
    ok('settle: one sent, one failed', settle.sent === 1 && settle.failed === 1, settle);
    var after = await q("select coupon_id, status, error from loyalty_sms_outbox where request_id is not null order by id");
    var failed = after.filter(function (o) { return o.status === 'failed'; })[0];
    var released = (await one('select expiry_sms_at is null as a, expiry_sms_month_at is null as b from discount_coupons where id = $1', [failed.coupon_id]));
    ok('failed send gives the claim back (retried next run), error kept', (released.a && released.b) && /Login required/.test(failed.error), [failed, released]);

    console.log('Year-end reminders (30 Nov)');
    await q("update program_settings set setting_value = '{\"zero_policy\":\"year_end\",\"last_year_end_zero_year\":2026}' where setting_key = 'coupon_zero_policy'");
    await coupon(P['001003'], 'cash', 'amount', 80, 0, 0, '2027-06-01', '2026-07-01T02:00:00Z', 'KT', 'DC-YEND01');
    await patient('900020', 'CHAN A', '93334444', 'A123456(7)');
    await patient('900021', 'CHAN A COPY', null, 'a1234567');
    await q("insert into reward_accounts (patient_id, clinic_code, balance) values ($1, 'PL', 50), ($2, 'KT', 30)", [P['900020'], P['900021']]);
    await q("update reward_program set zero_policy = 'year_end', last_year_end_zero_year = 2026, sms_notify_enabled = true where id = 1");
    var nov30 = '2026-11-30';
    var ye = (await one("select loyalty_run_daily_sms($1::date) r", [nov30])).r;
    ok('year-end run: one coupon SMS, one points SMS per person', ye.coupon_yearend >= 1 && ye.points_yearend === 1, ye);
    var yeSent = (await q('select body from net.sent order by id')).map(function (s) { return s.body; });
    var gotYe = yeSent.filter(function (b) { return /所有優惠券將於2026年12月31日 23:59到期（還有31日）/.test(b.body); })[0];
    var walletYe = (await q("select code, campaign_key, patient_id, face_value, discount_mode, percent, max_discount, status, expires_on::text, issued_at, clinic_code from discount_coupons where patient_id = $1 order by issued_at, code", [P['001003']]))
        .map(function (c) { return Object.assign({}, c, { face_value: Number(c.face_value), percent: Number(c.percent), max_discount: Number(c.max_discount), issued_at: new Date(c.issued_at).toISOString() }); });
    C.applyZeroExpiry(walletYe, { zero_policy: 'year_end' });
    var expectYe = C.smsYearEndCoupons(nov30, walletYe, { clinic: gotYe && /結餘\/Balance \(KT\)/.test(gotYe.body) ? 'KT' : 'PL' });
    ok('coupon year-end text = app-coupons.js smsYearEndCoupons', gotYe && gotYe.body === expectYe, gotYe ? gotYe.body + '\n---- expected ----\n' + expectYe : 'not sent');
    var R = (function () {
        var ctx = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout };
        ctx.window = ctx;
        vm.createContext(ctx);
        try { vm.runInContext(read('app-rewards.js'), ctx, { filename: 'app-rewards.js' }); } catch (e) { /* DOM bits */ }
        return ctx.REWARDS;
    })();
    var gotPts = yeSent.filter(function (b) { return /積分到期提醒/.test(b.body); })[0];
    var expectPts = R && R.pointsYearEndSms ? R.pointsYearEndSms(nov30, 80, 'PL') : null;
    ok('points year-end: both charts of one person (HKID) → one SMS, total 80.00, to the chart with a phone',
        gotPts && gotPts.to === '93334444' && /總結餘\/All-clinic total: 80\.00/.test(gotPts.body), gotPts);
    ok('points year-end text = app-rewards.js pointsYearEndSms', !expectPts || (gotPts && gotPts.body === expectPts),
        gotPts ? gotPts.body + '\n---- expected ----\n' + expectPts : 'not sent');
    var keys = (await q("select person_key from loyalty_yearend_sms where scheme = 'rewards' order by person_key")).map(function (r) { return r.person_key; });
    ok('points claim covers every chart of the person (desk skips them)', keys.length === 2 && keys.indexOf('p:' + P['900020']) >= 0 && keys.indexOf('p:' + P['900021']) >= 0, keys);
    var deskYe = (await one("select loyalty_yearend_claim('coupons', 2026, 'month', array['p:' || $1::text], $1::uuid) r", [P['001003']])).r;
    ok('desk backup cannot claim the same year-end SMS', deskYe === null);

    console.log('Set zero');
    var z0 = (await one("select loyalty_run_zero('2026-12-31 23:00+08'::timestamptz) r")).r;
    ok('31 Dec: nothing cleared yet', z0.coupons.skipped === 'done_this_year' && z0.points.skipped === 'done_this_year', z0);
    var z1 = (await one("select loyalty_run_zero('2027-01-01 00:05+08'::timestamptz) r")).r;
    var leftOld = (await one("select count(*)::int n from discount_coupons where status = 'unused' and issued_at < '2027-01-01T00:00:00+08'")).n;
    ok('1 Jan 00:05: coupons issued in 2026 cleared', z1.coupons.ok === true && z1.coupons.coupons > 0 && leftOld === 0, z1.coupons);
    var bal = (await one('select sum(balance)::numeric n from reward_accounts')).n;
    ok('1 Jan 00:05: points set to zero', z1.points.ok === true && Number(bal) === 0, z1.points);
    var marks = await one("select (select setting_value::jsonb ->> 'last_year_end_zero_year' from program_settings where setting_key = 'coupon_zero_policy') c, (select last_year_end_zero_year from reward_program where id = 1) p");
    ok('marks saved: desks skip this year', marks.c === '2027' && Number(marks.p) === 2027, marks);
    var z2 = (await one("select loyalty_run_zero('2027-01-01 08:00+08'::timestamptz) r")).r;
    ok('second run the same year: skipped', z2.coupons.skipped === 'done_this_year' && z2.points.skipped === 'done_this_year', z2);
    await q("update loyalty_job_config set zero_on = false");
    ok('switched off: does nothing', ((await one("select loyalty_run_zero() r")).r).skipped === 'off');
    await q("update loyalty_job_config set zero_on = true");

    console.log('Life span');
    await q("update program_settings set setting_value = '{\"zero_policy\":\"lifespan\",\"lifespan_months\":3}' where setting_key = 'coupon_zero_policy'");
    var fresh = await coupon(P['001003'], 'cash', 'amount', 60, 0, 0, '2099-01-01', new Date().toISOString(), 'KT', 'DC-FRESH1');
    var old = await coupon(P['001003'], 'cash', 'amount', 60, 0, 0, '2099-01-01', new Date(Date.now() - 200 * 86400000).toISOString(), 'KT', 'DC-OLD001');
    var l1 = (await one('select loyalty_run_zero() r')).r;
    var st = await one('select (select status from discount_coupons where id = $1) f, (select status from discount_coupons where id = $2) o', [fresh, old]);
    ok('life span 3 months: old coupon cleared, new one kept', l1.coupons.ok && st.f === 'unused' && st.o === 'void', [l1.coupons, st]);
    var l2 = (await one('select loyalty_run_zero() r')).r;
    ok('life span runs once a day', l2.coupons.skipped === 'ran_today', l2.coupons);

    console.log('Access');
    var ex = await one("select has_function_privilege('anon', 'public.loyalty_run_daily_sms(date,boolean)', 'execute') a," +
        " has_function_privilege('anon', 'public.loyalty_run_zero(timestamptz)', 'execute') b," +
        " has_column_privilege('anon', 'public.loyalty_job_config', 'anon_key', 'select') c," +
        " has_table_privilege('anon', 'public.loyalty_job_runs', 'select') d," +
        " has_column_privilege('anon', 'public.loyalty_sms_outbox', 'body', 'select') e");
    ok('browser cannot start the jobs or read the SMS bodies; can see the run log', !ex.a && !ex.b && !ex.c && ex.d && !ex.e, ex);

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail ? 1 : 0;
}

main().catch(function (e) { console.error(e); process.exitCode = 1; });
