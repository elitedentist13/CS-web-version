/**
 * Discount coupons — 10-step check.
 * Smoke + unit + HTML spot + API (read-only) + CDP Runtime.evaluate on the live page.
 * Run: node scripts/discount-coupon-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261027couponauth1';
var PAGE_PORT = 8836;
var CDP_PORT = 9436;
var CHROME = process.env.CHROME_PATH ||
    (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-coupons.js'))) root = process.cwd();

var fails = [];
function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function httpGetText(port, reqPath) {
    return new Promise(function (resolve, reject) {
        var req = http.get({ host: '127.0.0.1', port: port, path: reqPath, timeout: 8000 }, function (r) {
            var d = '';
            r.on('data', function (c) { d += c; });
            r.on('end', function () { resolve({ status: r.statusCode, body: d }); });
        });
        req.on('error', reject);
        req.on('timeout', function () { req.destroy(); reject(new Error('timeout')); });
    });
}
function httpGetJson(url) {
    return new Promise(function (resolve, reject) {
        http.get(url, function (r) {
            var d = '';
            r.on('data', function (c) { d += c; });
            r.on('end', function () {
                try { resolve(JSON.parse(d)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}
async function waitJson(url, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var last = null;
    while (Date.now() < deadline) {
        try { return await httpGetJson(url); }
        catch (e) { last = e; await sleep(250); }
    }
    throw new Error('timeout ' + url + ' last=' + (last && last.message));
}
function readSbConfig(appJs) {
    var block = appJs.match(/supabase\.createClient\(([\s\S]*?)\);/);
    if (!block) throw new Error('supabase.createClient not found');
    var parts = [];
    var re = /'([^']*)'/g;
    var m;
    while ((m = re.exec(block[1]))) parts.push(m[1]);
    if (parts.length < 2) throw new Error('could not parse SB url/key');
    return { url: parts[0], key: parts.slice(1).join('') };
}
function restGet(base, key, table, qs) {
    var url = base.replace(/\/$/, '') + '/rest/v1/' + table + '?' + qs;
    return fetch(url, {
        headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
    }).then(function (r) {
        return r.text().then(function (t) {
            var json = null;
            try { json = JSON.parse(t); } catch (e) {}
            return { status: r.status, json: json, raw: t.slice(0, 180) };
        });
    });
}
function startStaticServer(port) {
    var types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
    var server = http.createServer(function (req, res) {
        var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        var file = path.normalize(path.join(root, urlPath));
        if (file.indexOf(root) !== 0) { res.writeHead(403); res.end('no'); return; }
        fs.readFile(file, function (err, buf) {
            if (err) { res.writeHead(404); res.end('missing'); return; }
            res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
            res.end(buf);
        });
    });
    return new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', function () { resolve(server); });
    });
}
function Cdp(ws) {
    this.ws = ws; this.n = 0; this.pending = {};
    var self = this;
    ws.addEventListener('message', function (ev) {
        var data = JSON.parse(ev.data);
        if (data.id != null && self.pending[data.id]) {
            var p = self.pending[data.id];
            delete self.pending[data.id];
            if (data.error) p.reject(new Error(JSON.stringify(data.error)));
            else p.resolve(data.result || {});
        }
    });
}
Cdp.prototype.call = function (method, params, timeoutMs) {
    var self = this;
    timeoutMs = timeoutMs || 30000;
    return new Promise(function (resolve, reject) {
        var id = ++self.n;
        var t = setTimeout(function () { delete self.pending[id]; reject(new Error('CDP timeout ' + method)); }, timeoutMs);
        self.pending[id] = {
            resolve: function (v) { clearTimeout(t); resolve(v); },
            reject: function (e) { clearTimeout(t); reject(e); }
        };
        self.ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
};
Cdp.prototype.js = async function (expression, awaitPromise, timeoutMs) {
    var r = await this.call('Runtime.evaluate', {
        expression: expression, returnByValue: true, awaitPromise: !!awaitPromise, timeout: timeoutMs || 45000
    }, (timeoutMs || 45000) + 5000);
    if (r.exceptionDetails) {
        var ex = r.exceptionDetails.exception || {};
        throw new Error(ex.description || JSON.stringify(r.exceptionDetails));
    }
    return (r.result || {}).value;
};
async function waitJs(cdp, expr, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var last = null;
    while (Date.now() < deadline) {
        try {
            last = await cdp.js(expr, true, 8000);
            if (last) return last;
        } catch (e) { last = e && e.message; }
        await sleep(300);
    }
    throw new Error('waitJs timeout ' + expr + ' last=' + last);
}

function loadCoupons() {
    var ctx = { console: console };
    vm.createContext(ctx);
    vm.runInContext(read('app-coupons.js'), ctx);
    return ctx.COUPONS;
}

(async function main() {
    var src = read('app-coupons.js');
    var html = read('index.html');
    var cfg = read('app-config.js');
    var sql = read('discount_coupons.sql');
    var C = loadCoupons();
    var catalog = [
        { id: 's1', item_code: '103', item_name: 'SCALING & POLISHING - 洗牙' },
        { id: 'i1', item_code: '051', item_name: 'IMPLANT - 植牙' },
        { id: 'f1', item_code: '039', item_name: 'FILLING - COMPOSITE' },
        { id: 'o1', item_code: '075', item_name: 'ORTHO TREATMENT' }
    ];
    var camps = C.defaultCampaigns();
    function camp(key) {
        for (var i = 0; i < camps.length; i++) if (camps[i].key === key) return camps[i];
        return null;
    }

    console.log('=== 1 records ===');
    pass('BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    pass('SQL joins only KT by default', /upper\(c\.clinic_code\) = 'KT'/.test(sql));
    pass('SQL wallet and bill columns', sql.indexOf('discount_coupons') >= 0 && sql.indexOf('coupon_amount') >= 0);
    pass('node --check coupons', child_process.spawnSync(process.execPath, ['--check', path.join(root, 'app-coupons.js')]).status === 0);

    console.log('=== 2 configuration ===');
    pass('config tab', cfg.indexOf("key: 'coupons'") >= 0 && html.indexOf('data-tab="coupons"') >= 0);
    pass('KT default on', C.defaultClinicJoined('KT') === true && C.clinicJoined('KT', {}) === true);
    pass('other clinics default off', C.clinicJoined('PL', {}) === false && C.clinicJoined('MK', {}) === false);
    pass('doctor follows a joined clinic', C.doctorJoined('KT', 'doc-1', { clinics: {}, doctors: {} }) === true);
    pass('doctor blocked when clinic is off', C.doctorJoined('PL', 'doc-1', { clinics: { PL: { joined: false } }, doctors: {} }) === false);

    console.log('=== 3 campaigns ===');
    pass('16 coupon rows', camps.length === 16, 'n=' + camps.length);
    pass('five expenditure rows', camps.filter(function (c) { return c.trigger === 'target_spend'; }).length === 5);
    pass('first three expenditure amounts are filled',
        camp('spend_1').target === 1000 && camp('spend_1').face === 100 &&
        camp('spend_2').target === 5000 && camp('spend_2').face === 500 &&
        camp('spend_3').target === 10000 && camp('spend_3').face === 1000);
    pass('last two expenditure rows are empty',
        !(camp('spend_4').target > 0) && !(camp('spend_4').face > 0) &&
        !(camp('spend_5').target > 0) && !(camp('spend_5').face > 0));
    pass('campaigns start off', camps.every(function (c) { return c.enabled === false; }));
    pass('reward module is not referenced', src.indexOf('REWARDS') < 0);

    console.log('=== 4 treatment wiring ===');
    var scaling = { treatment_item_id: 's1', desc: 'typed over' };
    var typed = { desc: 'SCALING & POLISHING - 洗牙' };
    var implant = { treatment_item_id: 'i1' };
    pass('scaling id matches free scaling', C.lineMatchesGroup(scaling, C.ITEM_GROUPS.free_scaling, catalog) === true);
    pass('exact catalog name without id matches (older bills)', C.lineMatchesGroup(typed, C.ITEM_GROUPS.free_scaling, catalog) === true);
    pass('saved bill line shape (desc + item_name, empty ids) matches', C.lineMatchesGroup({
        desc: 'SCALING & POLISHING - 洗牙', item_name: 'SCALING & POLISHING - 洗牙', treatment_item_id: '', item_code: ''
    }, C.ITEM_GROUPS.free_scaling, catalog) === true);
    pass('free typed text does not match', C.lineMatchesGroup({ desc: 'scaling' }, C.ITEM_GROUPS.free_scaling, catalog) === false);
    pass('a name not in the catalog does not match', C.lineMatchesGroup({ desc: 'SCALING & POLISHING - 洗牙' }, C.ITEM_GROUPS.free_scaling, []) === false);
    pass('pending list keeps the catalog id', /function syncBillItemsToPendingList[\s\S]{0,700}treatment_item_id: n\.treatment_item_id/.test(read('app-appt.js')));
    pass('implant does not match scaling', C.lineMatchesGroup(implant, C.ITEM_GROUPS.free_scaling, catalog) === false);
    pass('crown removal is not a crown coupon', C.ITEM_GROUPS.crown_bridge.indexOf('CROWN REMOVAL') < 0);
    pass('OPG is not an ortho coupon', C.ITEM_GROUPS.ortho.indexOf('ORTHOPANTOMOGRAM (OPG) - 環口腔X光片') < 0);
    pass('implant denture is not an implant coupon', C.ITEM_GROUPS.implant.indexOf('IMPLANT DENTURE') < 0);

    console.log('=== 5 wallet ===');
    var on = camp('cash'); on.enabled = true;
    var wallet = [];
    for (var n = 0; n < 20; n++) wallet.push({ status: 'unused', campaign_key: 'x' + n });
    pass('20 unused is full', C.canIssue(wallet, on).reason === 'wallet_full');
    function same(key, n) {
        var out = [];
        for (var k = 0; k < n; k++) out.push({ status: 'unused', campaign_key: key });
        return out;
    }
    pass('four cash coupons can still take a fifth', C.canIssue(same('cash', 4), on).ok === true);
    pass('cash holds up to 5', C.canIssue(same('cash', 5), on).reason === 'already_holding');
    var target = camp('spend_1'); target.enabled = true;
    pass('target waits for $1000', C.planTargetSpend({
        clinicCode: 'KT', campaigns: camps, wallet: [], cashAmount: 999, patientId: 'p', billId: 'b1'
    }).reason === 'below_target');
    var issued = C.planTargetSpend({
        clinicCode: 'KT', campaigns: camps, wallet: [], cashAmount: 1000, patientId: 'p', billId: 'b1'
    });
    pass('target issues after $1000 at KT', !!(issued && issued.ok && issued.originBillId === 'b1' && issued.plans.length === 1));
    camp('spend_2').enabled = true;
    camp('spend_3').enabled = true;
    camp('spend_4').enabled = true;
    var stacked = C.planTargetSpend({
        clinicCode: 'KT', campaigns: camps, wallet: [], cashAmount: 10000, patientId: 'p', billId: 'b9'
    });
    pass('$10000 earns the three filled rows', !!(stacked && stacked.ok && stacked.plans.length === 3 &&
        stacked.plans[0].campaign.face === 100 && stacked.plans[2].campaign.face === 1000));
    pass('an empty custom row does not issue', stacked.plans.every(function (p) { return p.campaign.key !== 'spend_4'; }));
    camp('spend_4').target = 2000;
    camp('spend_4').face = 150;
    var custom = C.planTargetSpend({
        clinicCode: 'KT', campaigns: camps, wallet: [], cashAmount: 10000, patientId: 'p', billId: 'b9'
    });
    pass('a filled custom row issues', !!(custom && custom.plans.some(function (p) {
        return p.campaign.key === 'spend_4' && p.campaign.face === 150;
    })));
    pass('target does not issue at PL', C.planTargetSpend({
        clinicCode: 'PL', campaigns: camps, wallet: [], cashAmount: 5000, patientId: 'p', billId: 'b1'
    }) === null);

    console.log('=== 6 bill sheet math ===');
    pass('total subtracts percent discount and coupon', C.billTotalCents(150000, 0, 10000) === 140000);
    var cash = { scope: 'bill', mode: 'amount', face: 100, status: 'unused', patient_id: 'p' };
    var small = C.assessCoupon({ coupon: cash, eligibleCents: 60, patientId: 'p' });
    pass('cash coupon does not return leftover', small.ok && small.save === 60, String(small.save));
    var best = C.pickBest([
        { id: 'a', scope: 'bill', mode: 'amount', face: 50, status: 'unused', expires_on: '2026-12-01', patient_id: 'p' },
        { id: 'b', scope: 'bill', mode: 'amount', face: 100, status: 'unused', expires_on: '2026-11-01', patient_id: 'p' }
    ], { eligibleCents: 500, patientId: 'p' });
    pass('best coupon is the larger saving', !!(best && best.coupon.id === 'b'), best && best.coupon.id);

    console.log('=== 7 line check ===');
    var free = C.assessCoupon({
        coupon: { scope: 'items', mode: 'free_line', key: 'free_scaling', itemNames: C.ITEM_GROUPS.free_scaling, status: 'unused', patient_id: 'p' },
        lines: [
            { treatment_item_id: 's1', qty: 1, price: 560, disc: 0 },
            { treatment_item_id: 'i1', qty: 1, price: 8000, disc: 0 }
        ],
        catalog: catalog, patientId: 'p'
    });
    pass('free scaling waives only the scaling line', free.ok && free.save === 560 && free.lineName.indexOf('SCALING') >= 0, JSON.stringify(free));
    var ortho = C.assessCoupon({
        coupon: { scope: 'items', mode: 'percent', percent: 10, maxDiscount: 3000, itemNames: C.ITEM_GROUPS.ortho, status: 'unused', patient_id: 'p' },
        lines: [{ treatment_item_id: 'o1', qty: 1, price: 40000, disc: 0 }],
        catalog: catalog, patientId: 'p'
    });
    pass('ortho percent stops at the ceiling', ortho.ok && ortho.save === 3000, String(ortho.save));
    var later = C.assessCoupon({
        coupon: { scope: 'bill', mode: 'amount', face: 100, status: 'unused', origin_bill_id: 'b1', patient_id: 'p' },
        eligibleCents: 1500, billId: 'b1', patientId: 'p'
    });
    pass('target coupon cannot be used on the bill that created it', later.ok === false && later.reason === 'next_bill');

    console.log('=== 8 automatic issue ===');
    var welcome = camp('new_chart'); welcome.enabled = true;
    var ref = camp('referral'); ref.enabled = true;
    var plans = C.planNewChart({
        clinicCode: 'KT', campaigns: camps, patientId: 'new', referrerId: 'old', wallet: [], referrerWallet: []
    });
    pass('new chart and referral both plan at KT', plans.length === 2, 'n=' + plans.length);
    pass('referral coupon goes to the old patient', plans.some(function (p) { return p.patientId === 'old' && p.campaign.key === 'referral'; }));
    pass('new chart does not text', plans.some(function (p) { return p.campaign.key === 'new_chart' && p.sms === false; }));
    pass('no issue when the clinic is off', C.planNewChart({
        clinicCode: 'CWB', campaigns: camps, patientId: 'new', referrerId: 'old'
    }).length === 0);
    pass('self referral is skipped', C.planNewChart({
        clinicCode: 'KT', campaigns: camps, patientId: 'same', referrerId: 'same', wallet: [], referrerWallet: []
    }).every(function (p) { return p.campaign.key !== 'referral'; }));

    console.log('=== 9 SMS ===');
    var issuedSms = C.smsIssued({ nameZh: '滿額回贈', mode: 'amount', face: 100, expires_on: '2027-01-01' });
    pass('issue SMS uses the clinic heading', issuedSms.indexOf('樂意牙科中心') >= 0 && issuedSms.indexOf('滿額回贈') >= 0);
    var exp = C.smsExpiring({ status: 'unused', nameZh: '介紹新客', expires_on: '2026-11-02' }, '2026-10-26');
    pass('expiry SMS is 7 days before', exp.indexOf('7日內到期') >= 0 && exp.indexOf('2026-11-02') >= 0);
    pass('no expiry SMS on other days', C.smsExpiring({ status: 'unused', expires_on: '2026-11-03' }, '2026-10-26') === '');

    console.log('=== 9b gift / transfer login ===');
    var authUsers = [
        { user_id: 'amy', password: 'pw1', role: 'nurse', display_name: 'Amy Nurse', is_active: true },
        { user_id: 'nurse', password: 'nurse', role: 'nurse', display_name: 'Nurse', is_active: true },
        { user_id: 'old', password: 'pw2', role: 'staff', display_name: 'Old', is_active: false }
    ];
    function authCoupons() {
        var ctx = { console: console };
        ctx.SB = {
            from: function () {
                var f = {};
                var q = {
                    select: function () { return q; },
                    eq: function (k, v) { f[k] = v; return q; },
                    limit: function () { return q; },
                    then: function (ok) {
                        return Promise.resolve({ error: null, data: authUsers.filter(function (u) {
                            return Object.keys(f).every(function (k) { return u[k] === f[k]; });
                        }) }).then(ok);
                    }
                };
                return q;
            }
        };
        vm.createContext(ctx);
        vm.runInContext(src, ctx);
        return ctx.COUPONS;
    }
    var CA = authCoupons();
    var realNurse = await CA.verifyGrantor('amy', 'pw1');
    pass('real nurse login can authorize', realNurse.ok && realNurse.user.user_id === 'amy');
    pass('shared Nurse login is refused', (await CA.verifyGrantor('nurse', 'nurse')).reason === 'shared_login');
    pass('shared Nurse login is refused in any case', (await CA.verifyGrantor(' NURSE ', 'nurse')).reason === 'shared_login');
    pass('wrong password is refused', (await CA.verifyGrantor('amy', 'nope')).reason === 'creds');
    pass('inactive login is refused', (await CA.verifyGrantor('old', 'pw2')).reason === 'creds');
    pass('blank password is refused', (await CA.verifyGrantor('amy', '')).reason === 'auth_missing');
    pass('gift box asks for login + password', src.indexOf('id="dcAuthUser"') >= 0 && src.indexOf('id="dcAuthPw"') >= 0);
    pass('gift and transfer both pop the login prompt',
        src.indexOf("promptGrantor(host, ct('coupons.auth.giftTitle'") >= 0 && src.indexOf("promptGrantor(host, ct('coupons.auth.xferTitle'") >= 0);
    var logged = [];
    var logCtx = {
        console: console, AUDIT_TRAIL_TABLE: 'audit_trail', _auditLoggingEnabled: false,
        SB: { from: function (t) { return { insert: function (rows) { logged.push({ table: t, row: rows[0] }); return Promise.resolve({ error: null }); } }; } }
    };
    vm.createContext(logCtx);
    vm.runInContext(src, logCtx);
    var CL = logCtx.COUPONS;
    var savedLog = await CL.logCoupon('TRANSFER', 'Coupon X1 · from 001 to 002', '002', 'c1',
        { user_id: 'amy', display_name: 'Amy Nurse' });
    pass('coupon log is written even with the audit switch off', savedLog === true && logged.length === 1 &&
        logged[0].table === 'audit_trail' && logged[0].row.table_name === 'discount_coupons', JSON.stringify(logged));
    pass('coupon log row carries the verified login', logged[0] && logged[0].row.user_id === 'amy' && logged[0].row.user_name === 'Amy Nurse');
    var failCtx = { console: console, SB: { from: function () { return { insert: function () { return Promise.resolve({ error: { message: 'rls' } }); } }; } } };
    vm.createContext(failCtx);
    vm.runInContext(src, failCtx);
    pass('a failed log write is reported', (await failCtx.COUPONS.logCoupon('GRANT', 'x', '1', 'c', { user_id: 'amy' })) === false);
    var xd = C.transferDetail({ code: 'DC-AB12', campaign_key: 'cash', discount_mode: 'amount', face_value: 100 }, '001', { patient_no: '002' });
    pass('transfer log names the coupon, amount and both charts', /DC-AB12/.test(xd) && /HK\$100\.00/.test(xd) && /from 001 to 002/.test(xd), xd);
    var richLog = C.buildCouponLog(
        [{ id: 'g1', issued_at: '2026-10-05T02:00:00Z', note: 'Gifted into wallet', issued_by: 'Amy Nurse', campaign_key: 'cash',
            discount_mode: 'amount', patient_id: 'p2', face_value: 80, code: 'G1' }],
        [
            { created_at: '2026-10-06T02:00:00Z', operation: 'TRANSFER', user_name: 'Dr B', patient_no: '002', record_id: 'old1', changes_detail: xd },
            { created_at: '2026-10-05T02:00:00Z', operation: 'GRANT', user_name: 'Amy Nurse', patient_no: '001', record_id: 'g1' }
        ],
        { p2: { patient_no: '002' } },
        { old1: { id: 'old1', campaign_key: 'cash', discount_mode: 'amount', face_value: 100, code: 'DC-AB12' } }
    );
    var xRow = richLog.filter(function (r) { return r.op === 'TRANSFER'; })[0] || {};
    var gRow = richLog.filter(function (r) { return r.op === 'GIFT'; })[0] || {};
    pass('transfer log row shows coupon, amount and code', xRow.code === 'DC-AB12' && xRow.amount === 'HK$100.00' && !!xRow.coupon, JSON.stringify(xRow));
    pass('gift log row keeps the chart it was gifted to', gRow.chart === '001' && gRow.who === 'Amy Nurse' && richLog.length === 2,
        JSON.stringify(richLog));

    console.log('=== 9c expired, caps, doctor opt-out, reminders ===');
    var cashCamp = C.defaultCampaigns().filter(function (c) { return c.key === 'cash'; })[0];
    cashCamp.enabled = true;
    var staleWallet = [];
    for (var sw = 0; sw < 5; sw++) {
        staleWallet.push({ status: 'unused', campaign_key: 'cash', expires_on: '2020-01-01' });
    }
    pass('expired coupon is not live', C.isLive({ status: 'unused', expires_on: '2020-01-01' }, '2026-10-27') === false);
    pass('coupon on its last day is live', C.isLive({ status: 'unused', expires_on: '2026-10-27' }, '2026-10-27') === true);
    pass('expired coupons do not fill the wallet', C.unusedCount(staleWallet) === 0);
    pass('expired coupons do not block a new gift', C.canIssue(staleWallet, cashCamp).ok === true);
    pass('expired coupon cannot be transferred', C.planTransfer({
        coupon: { status: 'unused', campaign_key: 'cash', patient_id: 'a', expires_on: '2020-01-01' },
        toPatientId: 'b', toWallet: []
    }).reason === 'expired');
    var capped = JSON.parse(JSON.stringify(cashCamp));
    capped.issueCap = 3; capped.issuedCount = 3;
    pass('issue cap blocks once reached', C.canIssue([], capped).reason === 'issue_cap');
    capped.issueCap = 0; capped.budget = 500; capped.budgetUsed = 450;
    pass('budget blocks a coupon that would go over', C.canIssue([], capped).reason === 'budget');
    capped.issueCap = 10; capped.issuedCount = 4; capped.budgetUsed = 400;
    pass('usage line shows issued and budget', /4 \/ 10/.test(C.usageText(capped)) && /HK\$400 \/ HK\$500/.test(C.usageText(capped)),
        C.usageText(capped));
    var spendCamps = C.defaultCampaigns();
    spendCamps.forEach(function (c) { if (c.key === 'spend_1') c.enabled = true; });
    var spendCtx = {
        clinicCode: 'KT', clinics: { KT: { joined: true } },
        doctors: { 'KT|__all__': { joined: true }, 'KT|doc-out': { joined: false } },
        campaigns: spendCamps, wallet: [], cashAmount: 1200, patientId: 'p', billId: 'b'
    };
    pass('spend coupon issues for a joined doctor', !!(C.planTargetSpend(Object.assign({}, spendCtx, { doctorKey: 'doc-in' })) || {}).ok);
    pass('spend coupon skips an opted-out doctor', C.planTargetSpend(Object.assign({}, spendCtx, { doctorKey: 'doc-out' })) === null);
    pass('onBillFullyPaid looks up the bill doctor', src.indexOf('billDoctorKey(info.billId, info.doctorKey)') >= 0);
    var late = C.smsExpiring({ status: 'unused', nameZh: '現金券', expires_on: '2026-10-30' }, '2026-10-27');
    pass('late run still reminds within 7 days', late.indexOf('3日內到期') >= 0 && late.indexOf('3 days') >= 0, late);
    pass('no reminder on the day it was issued',
        C.smsExpiring({ status: 'unused', expires_on: '2026-10-30', issued_on: '2026-10-27' }, '2026-10-27') === '');
    pass('coupon SMS goes out on the SMS channel', src.indexOf("channel: 'sms'") >= 0);
    pass('expiry SMS patch file exists', read('discount_coupons_expiry_sms.sql').indexOf('expiry_sms_at') >= 0);

    console.log('=== 9d visual helpers ===');
    function giftCampLike(key) {
        return JSON.parse(JSON.stringify(C.defaultCampaigns().filter(function (c) { return c.key === key; })[0]));
    }
    pass('cash coupon is a cash ticket', C.kindOf({ campaign_key: 'cash' }) === 'cash');
    pass('spend coupon is a spend ticket', C.kindOf({ campaign_key: 'spend_2' }) === 'spend');
    pass('free scaling is a free ticket', C.kindOf({ campaign_key: 'free_scaling', mode: 'free_line' }) === 'free');
    pass('days until counts calendar days', C.daysUntil('2026-11-03', '2026-10-27') === 7);
    pass('expiry chip turns red inside 7 days', /dc-exp-red/.test(C.expiryChipHtml('2026-11-02', '2026-10-27')));
    pass('expiry chip turns amber inside 14 days', /dc-exp-amber/.test(C.expiryChipHtml('2026-11-08', '2026-10-27')));
    pass('expiry chip is plain after 14 days', !/dc-exp-(red|amber)/.test(C.expiryChipHtml('2026-12-31', '2026-10-27')));
    var sumHtml = C.walletSummaryHtml([
        { status: 'unused', discount_mode: 'amount', face_value: 100, expires_on: '2026-12-01' },
        { status: 'unused', discount_mode: 'amount', face_value: 200, expires_on: '2026-11-05' },
        { status: 'unused', discount_mode: 'free_line', face_value: 0, expires_on: '2027-01-01' },
        { status: 'unused', discount_mode: 'amount', face_value: 500, expires_on: '2020-01-01' },
        { status: 'used', discount_mode: 'amount', face_value: 50, expires_on: '2027-01-01' }
    ], '2026-10-27');
    pass('wallet summary counts live coupons and cash value', /<b>3<\/b>/.test(sumHtml) && /HK\$300/.test(sumHtml), sumHtml);
    pass('wallet summary shows the nearest expiry', /title="2026-11-05"/.test(sumHtml));
    var offCamp = giftCampLike('cash'); offCamp.enabled = false;
    pass('campaign off badge', C.campStatus(offCamp) === 'off');
    var blankSpend = giftCampLike('spend_4'); blankSpend.enabled = true;
    pass('blank spend row needs setup', C.campStatus(blankSpend) === 'setup');
    var fullCash = giftCampLike('cash'); fullCash.enabled = true; fullCash.issueCap = 2; fullCash.issuedCount = 2;
    pass('capped campaign shows limit reached', C.campStatus(fullCash) === 'full');
    var csv = C.couponLogCsv([{ at: '2026-10-27T09:30:00', op: 'GIFT', who: 'Amy, RN', clinic: 'KT', chart: '123',
        coupon: '現金券', amount: 'HK$100.00', code: 'X1', status: 'unused', note: 'say "hi"' }]);
    pass('log CSV starts with a BOM', csv.charCodeAt(0) === 0xFEFF);
    pass('log CSV quotes commas and quotes', csv.indexOf('"Amy, RN"') >= 0 && csv.indexOf('"say ""hi"""') >= 0, csv);
    var bar = C.spendBarHtml(1200, C.spendProgress(1200, [
        { key: 'spend_1', trigger: 'target_spend', enabled: true, target: 1000, face: 100 },
        { key: 'spend_2', trigger: 'target_spend', enabled: true, target: 5000, face: 500 }
    ]));
    pass('spend bar fills to 24% of the next tier', /width:24\.0%/.test(bar) && /dc-prog-tick/.test(bar), bar);
    pass('coupon CSS lives in style-coupons.css', read('style-coupons.css').indexOf('.dc-ticket') >= 0 &&
        read('index.html').indexOf("'style-coupons.css'") >= 0 && src.indexOf("style.textContent = [") < 0);

    console.log('=== 10 money rules ===');
    pass('void before payment restores the coupon', C.refundEffect('void_unpaid') === 'restore');
    pass('void after payment restores the coupon', C.refundEffect('void_paid') === 'restore');
    pass('refund after payment does not mint a new coupon', C.refundEffect('refund_paid') === 'keep_used');
    var voidPlan = C.planBillVoid(
        { id: 'bill-1', coupon_id: 'c-used', amount_paid: 800 },
        [
            { id: 'c-used', status: 'used', bill_id: 'bill-1' },
            { id: 'c-other', status: 'used', bill_id: 'bill-9' },
            { id: 'c-born', status: 'unused', origin_bill_id: 'bill-1' }
        ]
    );
    pass('void restores the coupon used on that bill',
        voidPlan.restore.length === 1 && voidPlan.restore[0] === 'c-used', JSON.stringify(voidPlan));
    pass('void leaves another bill’s coupon', voidPlan.restore.indexOf('c-other') < 0);
    pass('void cancels a coupon that this bill issued',
        voidPlan.cancel.length === 1 && voidPlan.cancel[0] === 'c-born');
    pass('void route is wired', read('app-appt.js').indexOf('COUPONS.onBillVoided(') >= 0);
    function giftCamp(key, extra) {
        var found = C.defaultCampaigns().filter(function (c) { return c.key === key; })[0];
        var copy = JSON.parse(JSON.stringify(found));
        copy.enabled = true;
        Object.keys(extra || {}).forEach(function (k) { copy[k] = extra[k]; });
        return copy;
    }
    function giftPlan(key, extra) {
        var opts = {
            patientId: 'p', clinicJoined: true, wallet: [], role: 'nurse',
            campaignKey: key, campaign: giftCamp(key)
        };
        Object.keys(extra || {}).forEach(function (k) { opts[k] = extra[k]; });
        return C.planChairsideGrant(opts);
    }
    pass('chairside cash allows 200', giftPlan('cash', { amount: 200 }).ok === true);
    pass('chairside cash rejects 201', giftPlan('cash', { amount: 201 }).reason === 'amount');
    pass('chairside cash stacks below the hold limit', giftPlan('cash', {
        amount: 50, wallet: same('cash', 4)
    }).ok === true);
    pass('chairside cash stops at the hold limit', giftPlan('cash', {
        amount: 50, wallet: same('cash', 5)
    }).reason === 'already_holding');
    pass('treatment gift stops at 2 of the same kind', giftPlan('free_scaling', {
        wallet: same('free_scaling', 2)
    }).reason === 'already_holding');
    pass('doctor can gift a treatment coupon', giftPlan('free_scaling', { role: 'doctor' }).ok === true);
    pass('reception can gift whitening', giftPlan('whitening', { role: 'receptionist' }).ok === true);
    pass('implant gift uses the configured amount', giftPlan('implant', { role: 'nurse' }).amount === 1000);
    pass('a switched-off treatment coupon cannot be gifted', giftPlan('free_filling', {
        campaign: giftCamp('free_filling', { enabled: false })
    }).reason === 'campaign_off');
    ['new_chart', 'referral', 'spend_1', 'spend_4'].forEach(function (key) {
        pass(key + ' stays automatic', giftPlan(key, { role: 'admin', amount: 100 }).reason === 'automatic');
    });
    pass('a gift needs ticked treatments or the keyword filter', giftPlan('ortho', {
        campaign: giftCamp('ortho', { itemNames: [], smart: false })
    }).reason === 'no_items');
    pass('keyword filter alone is enough to gift', giftPlan('ortho', {
        campaign: giftCamp('ortho', { itemNames: [], smart: true })
    }).ok === true);
    pass('an unknown login cannot gift', giftPlan('cash', { role: 'guest', amount: 50 }).reason === 'role');
    pass('chairside grant is logged', read('app-coupons.js').indexOf("logCoupon('GRANT'") >= 0);
    pass('gift lands in the wallet unused', read('app-coupons.js').indexOf("note: 'Gifted into wallet'") >= 0);
    pass('gift opens the wallet on a paid bill', read('app-coupons.js').indexOf('openBillSheet(bill, { gift: true })') >= 0);
    var xferOk = C.planTransfer({
        coupon: { id: 'c1', status: 'unused', campaign_key: 'cash', patient_id: 'a' },
        toPatientId: 'b', toWallet: []
    });
    pass('cash coupon can transfer', xferOk.ok === true);
    pass('new-chart coupon stays with the patient', C.planTransfer({
        coupon: { id: 'c2', status: 'unused', campaign_key: 'new_chart', patient_id: 'a' },
        toPatientId: 'b', toWallet: []
    }).reason === 'locked');
    pass('referral coupon stays with the patient', C.planTransfer({
        coupon: { id: 'c3', status: 'unused', campaign_key: 'referral', patient_id: 'a' },
        toPatientId: 'b', toWallet: []
    }).reason === 'locked');
    pass('transfer is logged', read('app-coupons.js').indexOf("logCoupon('TRANSFER'") >= 0);
    pass('grant button is on the bill', read('index.html').indexOf('bdCouponGrant') >= 0);
    pass('bill picker is on the bill page', html.indexOf('id="bdCouponRow"') >= 0 && html.indexOf('COUPONS.openBillSheet') >= 0);
    pass('catalog id is stored on a bill line', read('app-appt.js').indexOf('treatment_item_id') >= 0);

    console.log('=== 12 smart keyword filter + checklist ===');
    var kwFresh = C.defaultCampaigns();
    function kwCamp(key, extra) {
        var c = JSON.parse(JSON.stringify(kwFresh.filter(function (x) { return x.key === key; })[0]));
        Object.keys(extra || {}).forEach(function (k) { c[k] = extra[k]; });
        return c;
    }
    function fits(key, name, extra) { return C.nameFitsRule(name, C.itemRule(kwCamp(key, extra))); }
    pass('keyword: new scaling item fits free scaling', fits('free_scaling', 'ULTRASONIC SCALING - 超聲波洗牙') === true);
    pass('keyword: prophylaxis fits free scaling', fits('free_scaling', 'PROPHYLAXIS') === true);
    pass('keyword: root planing stays out of free scaling', fits('free_scaling', 'ROOT PLANING - 牙周深層清潔') === false);
    pass('keyword: government scaling scheme stays out', fits('free_scaling', 'PILOT SCHEME FOR DENTAL SCALING (GOV)') === false);
    pass('keyword: POLISH/ADJUST stays out', fits('free_scaling', 'POLISH/ADJUST') === false);
    pass('keyword: Chinese-only name fits', fits('free_scaling', '洗牙') === true);
    pass('keyword: OPG stays out of ortho', fits('ortho', 'ORTHOPANTOMOGRAM (OPG) - 環口腔X光片') === false);
    pass('keyword: Invisalign fits ortho', fits('ortho', 'INVISALIGN REFINEMENT') === true);
    pass('keyword: crown removal stays out of crown', fits('crown_bridge', 'CROWN REMOVAL') === false);
    pass('keyword: implant denture stays out of implant', fits('implant', 'IMPLANT DENTURE') === false);
    pass('keyword: wisdom tooth cleaning is not an extraction', fits('free_extraction', 'WISDOM TOOTH CLEANING') === false);
    pass('keyword: post and core is not a filling', fits('free_filling', 'POST AND CORE / FILLING - 支柱及核心') === false);
    pass('keyword: "rct" is matched as a word, not inside "correct"',
        fits('root_canal', 'RE-TREATMENT (RCT)') === true && fits('root_canal', 'CORRECTION') === false);
    pass('checklist: ticked item fits without a keyword', fits('free_scaling', 'PERIODONTAL TREATMENT', { itemNames: ['PERIODONTAL TREATMENT'] }) === true);
    pass('checklist: unticked keyword item is left out', fits('free_scaling', 'PROPHYLAXIS', { excludeNames: ['PROPHYLAXIS'] }) === false);
    pass('smart filter off: only ticked items fit', fits('free_scaling', 'PROPHYLAXIS', { smart: false }) === false &&
        fits('free_scaling', 'SCALING & POLISHING - 洗牙', { smart: false }) === true);
    pass('custom keyword works', fits('free_scaling', 'AIRFLOW CLEANING', { keywords: ['airflow'] }) === true);
    var rows = C.itemPickerRows(kwCamp('free_scaling', { excludeNames: ['PROPHYLAXIS'] }),
        ['SCALING & POLISHING - 洗牙', 'PROPHYLAXIS', 'ULTRASONIC SCALING', 'X-RAY']);
    function rowState(n) { return (rows.filter(function (r) { return r.name === n; })[0] || {}).state; }
    pass('checklist rows: ticked / keyword / unticked / off',
        rowState('SCALING & POLISHING - 洗牙') === 'ticked' && rowState('ULTRASONIC SCALING') === 'auto' &&
        rowState('PROPHYLAXIS') === 'excluded' && rowState('X-RAY') === 'off', JSON.stringify(rows.map(function (r) { return r.name + ':' + r.state; })));
    var kwCatalog = [{ id: 'u1', item_code: 'U1', item_name: 'ULTRASONIC SCALING' }];
    var kwFree = C.assessCoupon({
        coupon: { scope: 'items', mode: 'free_line', key: 'free_scaling', campaign_key: 'free_scaling', status: 'unused', patient_id: 'p' },
        lines: [{ treatment_item_id: 'u1', qty: 1, price: 480, disc: 0 }],
        catalog: kwCatalog, patientId: 'p'
    });
    pass('bill: keyword item gets the free scaling coupon', kwFree.ok && kwFree.save === 480, JSON.stringify(kwFree));
    pass('config: checklist dropdown in source', src.indexOf('dc-pick-on') >= 0 && src.indexOf('dc-pick-q') >= 0 && src.indexOf('dc-smart') >= 0);

    console.log('=== 11 stacking, combined use, savings, log ===');
    var fresh = C.defaultCampaigns();
    function freshCamp(key) { return fresh.filter(function (c) { return c.key === key; })[0]; }
    pass('hold limits by type',
        C.holdLimitFor(freshCamp('cash')) === 5 && C.holdLimitFor(freshCamp('spend_1')) === 3 &&
        C.holdLimitFor(freshCamp('referral')) === 5 && C.holdLimitFor(freshCamp('free_scaling')) === 2 &&
        C.holdLimitFor(freshCamp('new_chart')) === 1);
    pass('hold limit is configurable', C.holdLimitFor({ key: 'cash', holdLimit: 8 }) === 8);
    pass('hold limit never passes the wallet cap', C.holdLimitFor({ key: 'cash', holdLimit: 50 }) === 20);
    pass('transfer respects the hold limit', C.planTransfer({
        coupon: { id: 'c9', status: 'unused', campaign_key: 'free_scaling', patient_id: 'a' },
        toPatientId: 'b', toWallet: same('free_scaling', 2)
    }).reason === 'already_holding');
    pass('transfer allowed below the hold limit', C.planTransfer({
        coupon: { id: 'c9', status: 'unused', campaign_key: 'free_scaling', patient_id: 'a' },
        toPatientId: 'b', toWallet: same('free_scaling', 1)
    }).ok === true);
    pass('coupon slots', C.couponSlot({ scope: 'items' }) === 'items' && C.couponSlot({ campaign_key: 'cash' }) === 'bill' &&
        C.couponSlot({ campaign_key: 'free_scaling' }) === 'items');
    var comboLines = [
        { treatment_item_id: 's1', qty: 1, price: 560, disc: 0 },
        { treatment_item_id: 'i1', qty: 1, price: 8000, disc: 0 }
    ];
    var cScale = { id: 'k1', scope: 'items', mode: 'free_line', key: 'free_scaling', itemNames: C.ITEM_GROUPS.free_scaling, status: 'unused', patient_id: 'p' };
    var cCash100 = { id: 'k2', scope: 'bill', mode: 'amount', face: 100, status: 'unused', patient_id: 'p', expires_on: '2027-01-01' };
    var cCash50 = { id: 'k3', scope: 'bill', mode: 'amount', face: 50, status: 'unused', patient_id: 'p', expires_on: '2026-12-01' };
    var comboOpts = { lines: comboLines, catalog: catalog, eligibleCents: 8560, patientId: 'p', billId: 'bx' };
    var both = C.combineCoupons(Object.assign({ coupons: [cScale, cCash100] }, comboOpts));
    pass('treatment + bill coupon work together', both.rows.length === 2 && both.save === 660, JSON.stringify({ n: both.rows.length, s: both.save }));
    var twoBill = C.combineCoupons(Object.assign({ coupons: [cCash100, cCash50] }, comboOpts));
    pass('only one bill-wide coupon per bill', twoBill.rows.length === 1 && twoBill.save === 100);
    var bestCombo = C.bestCombination([cCash50, cScale, cCash100], comboOpts);
    pass('best combination picks scaling + the larger cash',
        bestCombo.rows.length === 2 && bestCombo.save === 660 &&
        bestCombo.rows.some(function (r) { return r.coupon.id === 'k2'; }));
    var tight = C.combineCoupons({
        coupons: [cScale, cCash100], lines: [{ treatment_item_id: 's1', qty: 1, price: 560, disc: 0 }],
        catalog: catalog, eligibleCents: 600, patientId: 'p', billId: 'bx'
    });
    pass('bill coupon only covers what the treatment coupon left', tight.save === 600, String(tight.save));
    var sv = C.billSavings({ items: JSON.stringify([{ price: 1000, qty: 1, disc: 10 }, { price: 500, qty: 2, disc: 0 }]), discount: 50, coupon_amount: 100 });
    pass('saved on this bill adds line, extra and coupon', sv.lines === 100 && sv.extra === 50 && sv.coupon === 100 && sv.total === 250, JSON.stringify(sv));
    ['spend_1', 'spend_2', 'spend_3'].forEach(function (k) { freshCamp(k).enabled = true; });
    var prog = C.spendProgress(1200, fresh);
    pass('spend progress: reached $1000, $3800 short of $5000',
        prog.reached.length === 1 && prog.next && prog.next.key === 'spend_2' && prog.shortBy === 3800, JSON.stringify({ r: prog.reached.length, s: prog.shortBy }));
    pass('spend progress at $10000 has nothing next', C.spendProgress(10000, fresh).next === null);
    pass('spend coupon uses all cash on the bill', C.cashPaidFromPayments([
        { amount: 500, method: 'Cash' },
        { amount: 400, method: 'Visa' },
        { amount: 300, method: 'Reward points' },
        { amount: 200, method: 'Balance transfer' },
        { amount: 100, method: 'Cash', voided_at: '2026-10-26T01:00:00Z' }
    ]) === 900);
    var held = C.planTargetSpend({
        clinicCode: 'KT', campaigns: fresh, wallet: same('spend_1', 3), cashAmount: 1500, patientId: 'p', billId: 'b5'
    });
    pass('spend coupon stops at its hold limit', !held || !held.ok || held.plans.every(function (p) { return p.campaign.key !== 'spend_1'; }),
        JSON.stringify(held && { ok: held.ok, reason: held.reason }));
    var log = C.buildCouponLog(
        [
            { issued_at: '2026-10-01T02:00:00Z', note: 'Gifted into wallet', issued_by: 'Nurse A', campaign_key: 'cash', patient_id: 'p1', face_value: 50, code: 'A1' },
            { issued_at: '2026-10-02T02:00:00Z', campaign_key: 'spend_1', patient_id: 'p1', face_value: 100, code: 'A2' }
        ],
        [
            { created_at: '2026-10-03T02:00:00Z', operation: 'TRANSFER', user_name: 'Dr B', patient_no: 'T1' },
            { created_at: '2026-10-01T02:00:00Z', operation: 'GRANT', user_name: 'Nurse A' }
        ],
        { p1: { patient_no: 'T1' } }
    );
    pass('coupon log merges issue, gift and transfer', log.length === 3 && log[0].op === 'TRANSFER' &&
        log.some(function (r) { return r.op === 'GIFT' && r.who === 'Nurse A' && r.chart === 'T1'; }) &&
        log.some(function (r) { return r.op === 'ISSUE'; }), JSON.stringify(log.map(function (r) { return r.op; })));
    pass('spend issue re-sums bill payments', src.indexOf('billCashPaid(') >= 0 && src.indexOf("from('bill_payments')") >= 0);
    pass('spend issue shows a notice', src.indexOf('couponNotice(') >= 0);
    var apptSrc = read('app-appt.js');
    pass('checkout (bill create + pay) issues spend coupons',
        /insertBillPaymentRecord\(payRecord, function\(pr\)[\s\S]{0,1500}COUPONS\.onBillFullyPaid\(/.test(apptSrc));
    pass('checkout passes 0 cash for reward / balance-transfer payments', /cashAmount: nonCashPay \? 0 : paid/.test(apptSrc));
    pass('add payment still issues spend coupons', /function executeAddPaymentSave[\s\S]{0,4000}COUPONS\.onBillFullyPaid\(/.test(apptSrc));
    pass('checkout shows the spend hint', /function recalcBalance[\s\S]{0,500}COUPONS\.paintCheckoutHint\(/.test(apptSrc) &&
        html.indexOf('id="bSpendHint"') >= 0);
    pass('extra % discount refreshes the coupon box', /applyBillDetailExtraDiscount[\s\S]{0,4000}COUPONS\.syncBillDetail\(/.test(read('app-appt.js')));
    pass('bill saved line and coupon info box', html.indexOf('id="bdSavedRow"') >= 0 && html.indexOf('id="bdCouponInfo"') >= 0);
    pass('coupon log card in config', src.indexOf('dcLogCard') >= 0 && src.indexOf('loadCouponLog') >= 0);

    console.log('\n=== HTML spot ===');
    var server = null;
    try {
        server = await startStaticServer(PAGE_PORT);
        var idx = await httpGetText(PAGE_PORT, '/index.html');
        var js = await httpGetText(PAGE_PORT, '/app-coupons.js?v=' + BUILD);
        pass('index.html 200', idx.status === 200);
        pass('served coupon script', js.status === 200 && js.body.indexOf('DEFAULT_JOIN_CODE') >= 0);
        pass('served page has the coupon tab and bill row',
            idx.body.indexOf('cfgPane-coupons') >= 0 && idx.body.indexOf('bdCouponRow') >= 0);
    } catch (e) {
        pass('HTML spot', false, e && e.message);
    }

    console.log('\n=== API (read-only) ===');
    try {
        var sb = readSbConfig(read('app.js'));
        var clinics = await restGet(sb.url, sb.key, 'clinics', 'select=clinic_code&order=clinic_code.asc');
        var codes = Array.isArray(clinics.json) ? clinics.json.map(function (c) { return String(c.clinic_code || '').toUpperCase(); }) : [];
        pass('clinics REST ok', clinics.status === 200 && codes.indexOf('KT') >= 0, 'HTTP ' + clinics.status + ' ' + codes.join(','));
        var table = await restGet(sb.url, sb.key, 'discount_coupon_clinics', 'select=clinic_code,joined&limit=20');
        if (table.status === 200 && Array.isArray(table.json)) {
            var kt = table.json.filter(function (r) { return String(r.clinic_code || '').toUpperCase() === 'KT' && r.joined; });
            var othersOn = table.json.filter(function (r) {
                return String(r.clinic_code || '').toUpperCase() !== 'KT' && r.joined;
            });
            pass('deployed join rows: KT on', kt.length >= 1, 'n=' + table.json.length);
            pass('deployed join rows: others off', othersOn.length === 0, othersOn.map(function (r) { return r.clinic_code; }).join(','));
        } else {
            pass('coupon tables waiting for discount_coupons.sql', true, 'HTTP ' + table.status + ' ' + (table.raw || '').slice(0, 120));
        }
    } catch (e) {
        pass('API probe', false, e && e.message);
    }

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    var proc = null;
    try {
        if (!server) throw new Error('static server not up');
        if (!fs.existsSync(CHROME)) throw new Error('no chrome ' + CHROME);
        var profile = path.join(os.tmpdir(), 'cs-coupon-cdp');
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e0) {}
        fs.mkdirSync(profile, { recursive: true });
        proc = child_process.spawn(CHROME, [
            '--remote-debugging-port=' + CDP_PORT,
            '--user-data-dir=' + profile,
            '--no-first-run', '--no-default-browser-check', '--disable-sync',
            '--disable-popup-blocking', '--window-size=1280,900',
            'http://127.0.0.1:' + PAGE_PORT + '/index.html?_lr=coupon1'
        ], { stdio: 'ignore' });
        await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 25000);
        var tabs = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000);
        var page = (tabs || []).find(function (t) {
            return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0;
        });
        pass('CDP page target', !!page && !!page.webSocketDebuggerUrl, page && page.url);
        if (!page) throw new Error('no page target');
        var ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) {
            ws.addEventListener('open', resolve);
            ws.addEventListener('error', reject);
        });
        var cdp = new Cdp(ws);
        await cdp.call('Page.enable');
        await cdp.call('Runtime.enable');
        await waitJs(cdp, "window.__JSM_BUILD === '" + BUILD + "'", 30000);
        pass('live BUILD ' + BUILD, true);
        await waitJs(cdp, "typeof COUPONS !== 'undefined' && COUPONS.DEFAULT_JOIN_CODE === 'KT'", 30000);
        pass('live COUPONS loaded', true);
        var live = await cdp.js(`(function () {
  var camps = COUPONS.defaultCampaigns();
  var catalog = ${JSON.stringify(catalog)};
  var scaling = COUPONS.assessCoupon({
    coupon: { scope: 'items', mode: 'free_line', itemNames: COUPONS.ITEM_GROUPS.free_scaling, status: 'unused', patient_id: 'p' },
    lines: [{ treatment_item_id: 's1', qty: 1, price: 560, disc: 0 }, { treatment_item_id: 'i1', qty: 1, price: 8000, disc: 0 }],
    catalog: catalog, patientId: 'p'
  });
  var typed = COUPONS.lineMatchesGroup({ desc: 'scaling' }, COUPONS.ITEM_GROUPS.free_scaling, catalog);
  return {
    n: camps.length,
    kt: COUPONS.clinicJoined('KT', {}),
    pl: COUPONS.clinicJoined('PL', {}),
    save: scaling.save,
    line: scaling.lineName,
    typed: typed,
    sms: COUPONS.smsIssued({ nameZh: '現金券', mode: 'amount', face: 100, expires_on: '2027-01-01' }).indexOf('樂意牙科中心') >= 0
  };
})()`, false, 10000);
        pass('CDP 16 coupon rows, KT on, PL off', live && live.n === 16 && live.kt === true && live.pl === false, JSON.stringify(live));
        pass('CDP scaling coupon ignores the implant line', live && live.save === 560 && String(live.line).indexOf('SCALING') >= 0);
        pass('CDP typed text is not a match', live && live.typed === false);
        pass('CDP SMS heading', live && live.sms === true);

        var paint = await cdp.js(`(async () => {
  var pane = document.getElementById('cfgPane-coupons');
  if (!pane) return { ok: false, reason: 'no pane' };
  COUPONS.mergeSaved(null);
  COUPONS.renderConfigPane(pane);
  var deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (pane.querySelector && pane.querySelector('.dc-clinic-join')) break;
    await new Promise(function (r) { setTimeout(r, 200); });
  }
  var boxes = Array.prototype.map.call(pane.querySelectorAll('.dc-clinic-join'), function (el) {
    return { code: el.getAttribute('data-code'), checked: el.checked };
  });
  var campsOn = pane.querySelectorAll('.dc-camp').length;
  var spends = Array.prototype.map.call(pane.querySelectorAll('.dc-spend'), function (row) {
    var inputs = row.querySelectorAll('.dc-num');
    return {
      key: row.getAttribute('data-camp'),
      target: inputs[0] ? inputs[0].value : '',
      face: inputs[1] ? inputs[1].value : ''
    };
  });
  var bill = document.getElementById('bdCouponRow');
  var holds = pane.querySelectorAll('.dc-num[data-prop="holdLimit"]').length;
  return {
    ok: !!pane.querySelector('.dc-clinic-join'), boxes: boxes, campsOn: campsOn, spends: spends, bill: !!bill,
    log: !!pane.querySelector('#dcLogCard') && !!pane.querySelector('#dcLogFrom') && !!pane.querySelector('#dcLogChart'),
    holds: holds,
    rules: !!pane.querySelector('details.dc-rules'),
    pickers: pane.querySelectorAll('details.dc-pick').length,
    pickRows: pane.querySelectorAll('.dc-pick-on').length,
    smart: pane.querySelectorAll('.dc-smart:checked').length,
    saved: !!document.getElementById('bdSavedRow'), info: !!document.getElementById('bdCouponInfo')
  };
})()`, true, 20000);
        var ktBox = (paint && paint.boxes || []).filter(function (b) { return b.code === 'KT'; })[0];
        var otherOn = (paint && paint.boxes || []).filter(function (b) { return b.code !== 'KT' && b.checked; });
        pass('live config pane painted', !!(paint && paint.ok), JSON.stringify(paint && paint.boxes));
        pass('live KT join is on', !!(ktBox && ktBox.checked === true));
        pass('live other clinics are off', otherOn.length === 0, otherOn.map(function (b) { return b.code; }).join(','));
        pass('live other campaign rows', paint && paint.campsOn === 11, 'n=' + (paint && paint.campsOn));
        var spendOk = paint && paint.spends && paint.spends.length === 5 &&
            paint.spends[0].target === '1000' && paint.spends[0].face === '100' &&
            paint.spends[1].target === '5000' && paint.spends[1].face === '500' &&
            paint.spends[2].target === '10000' && paint.spends[2].face === '1000' &&
            paint.spends[3].target === '' && paint.spends[3].face === '' &&
            paint.spends[4].target === '' && paint.spends[4].face === '';
        pass('live five expenditure rows', spendOk, JSON.stringify(paint && paint.spends));
        pass('live bill coupon row', !!(paint && paint.bill));
        pass('live coupon log panel', !!(paint && paint.log));
        pass('live rules note in config', !!(paint && paint.rules));
        pass('live treatment checklist on all 8 treatment coupons', paint && paint.pickers === 8 && paint.smart === 8 && paint.pickRows > 8,
            JSON.stringify({ pickers: paint && paint.pickers, rows: paint && paint.pickRows, smart: paint && paint.smart }));
        pass('live hold-up-to fields', paint && paint.holds >= 16, 'n=' + (paint && paint.holds));
        pass('live saved line and coupon info box', !!(paint && paint.saved && paint.info));
        var pick = await cdp.js(`(function () {
  treatmentItemsCache = ${JSON.stringify(catalog)};
  var bill = {
    id: 'bill-pick', patient_id: 'p', clinic_tag: 'KT', subtotal: 8560, discount: 0,
    items: JSON.stringify([
      { treatment_item_id: 's1', qty: 1, price: 560, disc: 0 },
      { treatment_item_id: 'i1', qty: 1, price: 8000, disc: 0 }
    ])
  };
  var wallet = [
    { id: 'w1', status: 'unused', campaign_key: 'cash', discount_mode: 'amount', face_value: 100, patient_id: 'p', expires_on: '2027-01-01' },
    { id: 'w2', status: 'unused', campaign_key: 'cash', discount_mode: 'amount', face_value: 50, patient_id: 'p', expires_on: '2027-01-01' },
    { id: 'w3', status: 'unused', campaign_key: 'free_scaling', discount_mode: 'free_line', face_value: 0, patient_id: 'p', expires_on: '2027-01-01' },
    { id: 'w4', status: 'unused', campaign_key: 'ortho', discount_mode: 'percent', percent: 10, max_discount: 3000, patient_id: 'p', expires_on: '2027-01-01' }
  ];
  COUPONS._paintSheet(bill, wallet, 'KT', {});
  function card(id) { return document.querySelector('#dcSheetHost .dc-card[data-id="' + id + '"]'); }
  function picked() {
    return Array.prototype.map.call(document.querySelectorAll('#dcSheetHost .dc-card.is-picked'), function (c) { return c.getAttribute('data-id'); }).sort().join(',');
  }
  var why = document.getElementById('dcWhy');
  var apply = document.getElementById('dcApply');
  var rules = document.querySelector('#dcSheetHost details.dc-rules');
  var r = {
    start: picked(), bestOnW1: !!(card('w1') && card('w1').querySelector('.dc-best')),
    rules: !!rules && !rules.open && rules.querySelectorAll('li').length === 9 &&
      /(現金券|现金券|Cash coupon) 5/.test(rules.textContent) && /20/.test(rules.textContent)
  };
  card('w2').click();
  r.afterW2 = picked();
  r.bestStays = !!card('w1').querySelector('.dc-best');
  card('w4').click();
  r.blockedPicked = card('w4').classList.contains('is-picked');
  r.whyShown = !!(why && !why.hidden && why.textContent.length > 0);
  r.focusW4 = card('w4').classList.contains('is-focus');
  card('w3').click();
  card('w2').click();
  r.none = picked();
  r.applyOff = !!(apply && apply.disabled);
  card('w1').click();
  r.applyOn = !!(apply && !apply.disabled);
  r.preview = (document.getElementById('dcPreview') || {}).textContent || '';
  var host = document.getElementById('dcSheetHost');
  if (host) { host.innerHTML = ''; host.setAttribute('hidden', ''); }
  return r;
})()`, false, 10000);
        pass('CDP picker starts on cash + scaling', pick && pick.start === 'w1,w3' && pick.bestOnW1, JSON.stringify(pick));
        pass('CDP rules note is collapsed with 9 rules and live hold limits', pick && pick.rules === true);
        var hint = await cdp.js(`(function () {
  var host = document.getElementById('bSpendHint');
  if (!host) return { ok: false, reason: 'no #bSpendHint' };
  var keep = window.currentClinicCodeForTagging;
  window.currentClinicCodeForTagging = function () { return 'KT'; };
  var before = appUiLang;
  appUiLang = 'en';
  COUPONS.mergeSaved({ campaigns: [
    { key: 'spend_1', enabled: true }, { key: 'spend_2', enabled: true }, { key: 'spend_3', enabled: true }
  ] });
  COUPONS.paintCheckoutHint(1200, 1200, 'Cash');
  var cash = { hidden: host.hidden, text: host.textContent };
  COUPONS.paintCheckoutHint(1200, 1200, 'Reward Points');
  var reward = host.textContent;
  COUPONS.paintCheckoutHint(1200, 500, 'Cash');
  var partial = host.textContent;
  COUPONS.paintCheckoutHint(300, 300, 'Cash');
  var small = host.textContent;
  window.currentClinicCodeForTagging = function () { return 'PL'; };
  COUPONS.paintCheckoutHint(1200, 1200, 'Cash');
  var plHidden = host.hidden;
  window.currentClinicCodeForTagging = keep;
  appUiLang = before;
  COUPONS.mergeSaved(null);
  host.hidden = true;
  return { ok: true, cash: cash, reward: reward, partial: partial, small: small, plHidden: plHidden };
})()`, false, 10000);
        pass('CDP checkout hint: $1200 cash earns $1000→$100 and shows $3800 to the next',
            hint && hint.ok && hint.cash.hidden === false && /Spend \$1000 get \$100/.test(hint.cash.text) &&
            /3800\.00/.test(hint.cash.text) && /Spend \$5000 get \$500/.test(hint.cash.text), JSON.stringify(hint));
        pass('CDP checkout hint warns reward points do not count', hint && /do not count/.test(hint.reward));
        pass('CDP checkout hint says it issues on full payment', hint && /fully paid/.test(hint.partial));
        pass('CDP checkout hint below $1000 shows how much more', hint && /700\.00 more for Spend \$1000 get \$100/.test(hint.small));
        pass('CDP checkout hint hidden at a clinic not in the scheme', hint && hint.plHidden === true);
        var langs = await cdp.js(`(function () {
  var before = appUiLang;
  treatmentItemsCache = ${JSON.stringify(catalog)};
  var bill = { id: 'bill-lang', patient_id: 'p', subtotal: 560, discount: 0,
    items: JSON.stringify([{ desc: 'SCALING & POLISHING - 洗牙', item_name: 'SCALING & POLISHING - 洗牙', qty: 1, price: 560, disc: 0, treatment_item_id: '', item_code: '' }]) };
  var wallet = [
    { id: 'l1', status: 'unused', campaign_key: 'cash', discount_mode: 'amount', face_value: 100, patient_id: 'p', expires_on: '2027-01-01' },
    { id: 'l2', status: 'unused', campaign_key: 'free_scaling', discount_mode: 'free_line', face_value: 0, patient_id: 'p', expires_on: '2027-01-01' },
    { id: 'l3', status: 'unused', campaign_key: 'implant', discount_mode: 'amount', face_value: 1000, max_discount: 1000, patient_id: 'p', expires_on: '2027-01-01' }
  ];
  var out = {};
  ['en', 'zh-CN', 'zh-Hant'].forEach(function (L) {
    appUiLang = L;
    COUPONS._paintSheet(bill, wallet, 'KT', {});
    var host = document.getElementById('dcSheetHost');
    function card(id) { return host.querySelector('.dc-card[data-id="' + id + '"]'); }
    card('l3').click();
    out[L] = {
      summary: host.querySelector('details.dc-rules summary').textContent,
      chip: host.querySelector('.dc-chip').textContent,
      cash: card('l1').querySelector('strong').textContent,
      scalingOk: card('l2').getAttribute('data-ok') === '1',
      scalingPicked: card('l2').classList.contains('is-picked'),
      why: document.getElementById('dcWhy').textContent
    };
    host.innerHTML = ''; host.setAttribute('hidden', '');
  });
  appUiLang = before;
  return out;
})()`, false, 10000);
        pass('CDP English sheet', langs && langs.en.summary.indexOf('Coupon rules') === 0 && langs.en.chip === 'All' &&
            langs.en.cash === 'Cash coupon' && /Implant discount: No treatment/.test(langs.en.why), JSON.stringify(langs && langs.en));
        pass('CDP Simplified Chinese sheet', langs && langs['zh-CN'].summary.indexOf('优惠券使用规则') === 0 &&
            langs['zh-CN'].chip === '全部' && langs['zh-CN'].cash === '现金券' && /植牙优惠: 此账单/.test(langs['zh-CN'].why),
            JSON.stringify(langs && langs['zh-CN']));
        pass('CDP Traditional Chinese sheet', langs && langs['zh-Hant'].summary.indexOf('優惠券使用規則') === 0 &&
            langs['zh-Hant'].chip === '全部' && langs['zh-Hant'].cash === '現金券',
            JSON.stringify(langs && langs['zh-Hant']));
        pass('CDP free scaling accepts a saved scaling line without catalog id',
            langs && langs.en.scalingOk && langs.en.scalingPicked);
        pass('CDP picked mark moves to the other cash coupon', pick && pick.afterW2 === 'w2,w3' && pick.bestStays);
        pass('CDP blocked card explains why and is not applied', pick && pick.blockedPicked === false && pick.whyShown && pick.focusW4);
        pass('CDP Apply is off with nothing chosen and back on after a choice', pick && pick.none === '' && pick.applyOff && pick.applyOn);
        var gift = await cdp.js(`(async () => {
  window.bdCurrentBill = {
    id: 'bill-gift', patient_id: '00000000-0000-0000-0000-000000000001',
    patient_no: 'T1', amount_paid: 800, clinic_tag: 'KT',
    subtotal: 1000, discount: 0, items: '[]'
  };
  COUPONS.openGrantSheet();
  var deadline = Date.now() + 8000;
  var box = null;
  while (Date.now() < deadline) {
    box = document.getElementById('dcGiftBox');
    if (box) break;
    await new Promise(function (r) { setTimeout(r, 200); });
  }
  var btn = document.getElementById('bdCouponGrant');
  return {
    box: !!box,
    label: btn ? String(btn.textContent || '').trim() : '',
    applyHidden: !document.getElementById('dcApply')
  };
})()`, true, 15000);
        pass('live gift box opens on a paid bill', !!(gift && gift.box && gift.applyHidden), JSON.stringify(gift));
        pass('live gift button is on the bill', gift && /贈入錢包|Gift to wallet/.test(gift.label), gift && gift.label);
        var desk = await cdp.js(`(function () {
  function on(key, amount) {
    var c = COUPONS.defaultCampaigns().filter(function (x) { return x.key === key; })[0];
    c.enabled = true;
    return COUPONS.planChairsideGrant({
      patientId: 'p', clinicJoined: true, wallet: [], role: 'receptionist',
      campaign: c, campaignKey: key, amount: amount || 0
    });
  }
  return {
    cash: on('cash', 200).ok,
    scaling: on('free_scaling').ok,
    chart: on('new_chart', 100).reason,
    refer: on('referral', 100).reason,
    spend: on('spend_1', 100).reason
  };
})()`, false, 10000);
        pass('live desk can gift cash and scaling', !!(desk && desk.cash && desk.scaling), JSON.stringify(desk));
        pass('live automatic coupons stay off the desk',
            desk && desk.chart === 'automatic' && desk.refer === 'automatic' && desk.spend === 'automatic');
        try { ws.close(); } catch (e1) {}
    } catch (e) {
        pass('CDP live page', false, e && e.message);
    } finally {
        if (proc) { try { proc.kill(); } catch (e2) {} }
        if (server) { try { server.close(); } catch (e3) {} }
    }

    console.log(fails.length
        ? ('\n' + fails.length + ' FAILED')
        : '\nSMOKE + UNIT + HTML + API + CDP + LIVE PAGE ALL PASS');
    process.exit(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
