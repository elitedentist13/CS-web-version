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

var BUILD = '20261028dash';
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
    var rwUses = (src.match(/REWARDS\.[a-zA-Z]+/g) || []).filter(function (u, i, a) { return a.indexOf(u) === i; });
    pass('reward module is used only for the refer-a-friend points branch and the shared manual link', rwUses.length > 0 && rwUses.every(function (u) {
        return ['REWARDS.referralAvailability', 'REWARDS.referralCredit', 'REWARDS.referralReverse', 'REWARDS.clinicCtx',
            'REWARDS.loyaltyGuideLinkHtml'].indexOf(u) >= 0;
    }), rwUses.join(','));
    pass('set zero card reuses the reward admin gate and reset dialog', /rw\.openAdminRewardAuthGate\(\{/.test(src) &&
        /rw\.openResetZeroFlow\(configClinics\(\), \{/.test(src) && /var rw = \(typeof REWARDS !== 'undefined' && REWARDS\) \? REWARDS : null;/.test(src));
    pass('coupon sheet header has the 📖 manual link next to Wallet QR',
        /esc\(ct\('coupons\.wqr\.btn', 'Wallet QR'\)\) \+ '<\/button>' : ''\) \+\s+\(\(typeof REWARDS !== 'undefined' && REWARDS && typeof REWARDS\.loyaltyGuideLinkHtml === 'function'\)\s+\? REWARDS\.loyaltyGuideLinkHtml\('coupons'\) : ''\) \+ '<\/div>'/.test(src));
    pass('coupon config title has the 📖 manual link (only when the reward module is loaded)',
        /REWARDS\.loyaltyGuideLinkHtml\('coupons'\) : ''/.test(src) && /'<h2 class="dc-title">'[^\n]*\+ guide \+ '<\/div>'/.test(src));

    console.log('=== 3a wallet tab in the ledger panel ===');
    var wl = C.walletLedgerRows([
        { id: 'a', status: 'unused', expires_on: '2027-03-01', issued_at: '2026-01-01T00:00:00Z' },
        { id: 'b', status: 'unused', expires_on: '2026-11-01', issued_at: '2026-02-01T00:00:00Z' },
        { id: 'c', status: 'unused', expires_on: '2026-05-01', issued_at: '2026-03-01T00:00:00Z' },
        { id: 'd', status: 'used', redeemed_at: '2026-09-01T03:00:00Z', issued_at: '2026-04-01T00:00:00Z' },
        { id: 'e', status: 'void', issued_at: '2026-06-01T00:00:00Z' }
    ], '2026-10-28');
    pass('wallet tab: live coupons soonest expiry first', wl.live.map(function (c) { return c.id; }).join(',') === 'b,a');
    pass('wallet tab: history newest first with used / cancelled / expired', wl.history.map(function (h) { return h.coupon.id + ':' + h.state; }).join(',') ===
        'd:used,e:void,c:expired', JSON.stringify(wl.history.map(function (h) { return [h.coupon.id, h.state, h.at]; })));
    var wlSrc = src.slice(src.indexOf('function renderWalletPane'), src.indexOf('function loadWallet('));
    pass('wallet tab: Wallet / Gift / Transfer like the Choose sheet, but no Use / Apply (not tied to a bill)',
        /function renderWalletPane\(el, patientId, opts\)/.test(src) && /\['wallet', ct\('coupons\.tab\.wallet', 'Wallet'\)/.test(wlSrc) &&
        /\['gift', ct\('coupons\.tab\.gift'/.test(wlSrc) && /\['transfer', ct\('coupons\.tab\.transfer'/.test(wlSrc) &&
        !/dcApply|dcClear|applyToBill|clearBillCoupon|(^|[^.\w])bill\.[a-z_]/.test(wlSrc));
    pass('wallet tab gift / transfer use the same login check, wallet write and coupon log as the sheet',
        /promptGrantor\(overlayHost, ct\('coupons\.auth\.giftTitle'/.test(wlSrc) && /grantToWallet\(patientId, kind, amt, patientNo, grantor\)/.test(wlSrc) &&
        /promptGrantor\(overlayHost, ct\('coupons\.auth\.xferTitle'/.test(wlSrc) && /transferSelected\(chosen, to, patientNo, user\)/.test(wlSrc) &&
        /String\(to\.id\) === String\(patientId\)/.test(wlSrc));
    var movable = C.walletTransferable([
        { id: 'a', status: 'unused', campaign_key: 'cash', expires_on: '2027-01-01' },
        { id: 'b', status: 'unused', campaign_key: 'referral', expires_on: '2027-01-01' },
        { id: 'c', status: 'unused', campaign_key: 'new_chart' },
        { id: 'd', status: 'unused', campaign_key: 'cash', expires_on: '2026-01-01' },
        { id: 'e', status: 'used', campaign_key: 'cash' }
    ], '2026-10-28');
    pass('wallet tab transfer list: live coupons only, new-chart and referral stay', movable.map(function (c) { return c.id; }).join(',') === 'a');
    pass('login prompt can sit over the reward panel and closes on Escape without closing the panel',
        /host\.querySelector\('\.dc-sheet'\) \|\| \(host\.nodeType === 1 && host\.id !== 'dcSheetHost' \? host : null\)/.test(src) &&
        /if \(ev\.key !== 'Escape'\) return;\s+ev\.preventDefault\(\);\s+ev\.stopPropagation\(\);\s+finish\(null\);/.test(src));
    pass('wallet tab checks the clinic is in the coupon scheme', /function walletAvailable\(clinicCode\)[\s\S]{0,200}clinicJoined\(code\)/.test(src));

    console.log('=== 3a2 patient dashboard coupon wallet card ===');
    var pvSrc = read('app-patient-views.js');
    var idxDash = read('index.html');
    var i18nSrc = read('app-i18n-extra.js');
    pass('dashboard has a coupon wallet card next to the reward points card (hidden until the clinic check)',
        /id="patDashRewardsCard"[\s\S]{0,900}id="patDashCouponsCard" class="pat-dash-coupons-card" hidden data-no-click-guard="1"[\s\S]{0,80}data-act="coupon-phone"/.test(pvSrc));
    pass('dashboard coupon card shows only when the clinic is in the coupon scheme, with the live count',
        /function patDashRefreshCoupons\(patientId\)[\s\S]{0,900}COUPONS\.walletAvailable\(\)[\s\S]{0,200}card\.hidden = !ok;[\s\S]{0,200}COUPONS\.walletLiveCount\(pid\)/.test(pvSrc) &&
        /patDashRefreshRewards\(pid\);\s+patDashRefreshCoupons\(pid\);/.test(pvSrc));
    pass('dashboard coupon card opens the phone wallet QR', /act === 'coupon-phone'[\s\S]{0,300}COUPONS\.openWalletPhone\(cpid\)/.test(pvSrc));
    pass('openWalletPhone uses the coupon QR set-up over the whole page',
        /function openWalletPhone\(patientId\)[\s\S]{0,400}host\.id = 'dcPhoneHost';[\s\S]{0,120}openPhoneQr\(host, patientId, couponQrConfig\(\)\)/.test(src) &&
        /openWalletPhone: openWalletPhone/.test(src) && /walletLiveCount: walletLiveCount/.test(src));
    pass('dashboard coupon card CSS: hidden really hides it', /\.pat-dash-coupons-card\[hidden\] \{ display: none; \}/.test(read('style.css')));
    pass('dashboard coupon card i18n in 3 languages', ['couponsLabel', 'couponsTitle', 'couponsHint', 'couponsCount'].every(function (k) {
        return new RegExp("'patient\\.view\\." + k + "': \\{ en: '[^']+', 'zh-CN': '[^']+', 'zh-Hant': '[^']+' \\}").test(i18nSrc);
    }) && /'patient\.view\.couponsCount': \{ en: '\{n\} live'/.test(i18nSrc));
    pass('index.html loads the new patient views build', /app-patient-views\.js\?v=20261028dash/.test(idxDash));

    console.log('=== 3b set zero ===');
    var zSql = read('discount_coupon_zero.sql');
    pass('zero SQL: batch + per-coupon safety log tables', /create table if not exists public\.discount_coupon_zero_batches/.test(zSql) &&
        /create table if not exists public\.discount_coupon_zero_rows/.test(zSql) && /note_before/.test(zSql));
    pass('zero SQL: voids only unused, unexpired coupons, scoped by clinic and issue cutoff',
        /status = 'unused'/.test(zSql) && /c\.expires_on >= v_today/.test(zSql) && /p_issued_before/.test(zSql) && /clinic_code/.test(zSql) && /status = 'void'/.test(zSql));
    pass('zero SQL: step back restores only coupons still voided by that batch',
        /create or replace function public\.dc_revert_zero_batch/.test(zSql) && /status = 'unused'/.test(zSql) && /reverted_at/.test(zSql));
    pass('zero SQL: granted to the app and reloads the API', /grant execute on function public\.dc_zero_coupons/.test(zSql) &&
        /grant execute on function public\.dc_revert_zero_batch/.test(zSql) && /notify pgrst, 'reload schema'/.test(zSql));
    var zp = C.normalizeZeroPolicy(null);
    pass('zero policy defaults to manual, 12 months', zp.zero_policy === 'manual' && zp.lifespan_months === 12 && zp.last_year_end_zero_year === null);
    pass('zero policy rejects odd values', C.normalizeZeroPolicy({ zero_policy: 'weekly', lifespan_months: 5 }).zero_policy === 'manual' &&
        C.normalizeZeroPolicy({ zero_policy: 'lifespan', lifespan_months: 5 }).lifespan_months === 12 &&
        C.normalizeZeroPolicy({ zero_policy: 'LIFESPAN', lifespan_months: 24 }).lifespan_months === 24);
    pass('zero option change: only a different option (or months for life span) counts', !C.zeroPolicyChanged(null, 'manual', 6) &&
        C.zeroPolicyChanged(null, 'year_end', 12) && C.zeroPolicyChanged({ zero_policy: 'lifespan', lifespan_months: 12 }, 'lifespan', 6) &&
        !C.zeroPolicyChanged({ zero_policy: 'lifespan', lifespan_months: 6 }, 'lifespan', 6) &&
        !C.zeroPolicyChanged({ zero_policy: 'year_end', lifespan_months: 12 }, 'year_end', 24));
    pass('zero policy Save goes through the admin SMS + Authenticator gate', /if \(!zeroPolicyChanged\(zeroPolicy\(\), policy, months\)\) return;[\s\S]{0,400}rw\.openAdminRewardAuthGate\(\{[\s\S]{0,300}onSuccess: function \(\) \{\s+saveZeroPolicy\(policy, months\)/.test(src));
    pass('HK year start is 31 Dec 16:00 UTC', C.hkYearStartIso(2027) === '2026-12-31T16:00:00.000Z');
    pass('manual policy schedules nothing', C.scheduledZeroJob({ zero_policy: 'manual' }, new Date('2027-01-02T00:00:00Z')) === null);
    var yj = C.scheduledZeroJob({ zero_policy: 'year_end', last_year_end_zero_year: 2026 }, new Date('2027-01-01T00:30:00+08:00'));
    pass('year-end runs once in the new HK year, clearing coupons issued before 1 Jan', yj && yj.source === 'year_end' &&
        yj.issuedBefore === '2026-12-31T16:00:00.000Z' && yj.mark.last_year_end_zero_year === 2027, JSON.stringify(yj));
    pass('year-end does not run twice in a year', C.scheduledZeroJob({ zero_policy: 'year_end', last_year_end_zero_year: 2027 }, new Date('2027-06-01T00:00:00Z')) === null &&
        C.scheduledZeroJob({ zero_policy: 'year_end', last_year_end_zero_year: 2026 }, new Date('2026-12-31T15:59:00Z')) === null);
    var lj = C.scheduledZeroJob({ zero_policy: 'lifespan', lifespan_months: 6 }, new Date('2027-08-15T04:00:00Z'));
    pass('life span clears coupons older than N months', lj && lj.source === 'lifespan' && lj.issuedBefore === '2027-02-15T04:00:00.000Z', JSON.stringify(lj));
    pass('life span runs at most once a day', C.scheduledZeroJob({ zero_policy: 'lifespan', lifespan_months: 6, last_lifespan_run_at: '2027-08-15T00:00:00Z' },
        new Date('2027-08-15T04:00:00Z')) === null);
    async function zeroCtx(role, rpcData) {
        var calls = { rpc: [], insert: [] };
        var q = function (table) {
            var o = {
                select: function () { return o; }, eq: function () { return o; }, is: function () { return o; },
                order: function () { return o; }, limit: function () { return o; },
                insert: function (rows) { calls.insert.push({ table: table, rows: rows }); return Promise.resolve({ data: rows, error: null }); },
                then: function (res) { return Promise.resolve({ data: [], error: null }).then(res); }
            };
            return o;
        };
        var zc = { console: console, currentRole: role, currentName: 'Tester', SB: {
            from: q,
            rpc: function (fn, args) { calls.rpc.push({ fn: fn, args: args }); return Promise.resolve(typeof rpcData === 'function' ? rpcData(fn) : { data: rpcData, error: null }); }
        } };
        vm.createContext(zc);
        vm.runInContext(src, zc, { filename: 'app-coupons.js' });
        return { C: zc.COUPONS, calls: calls };
    }
    var zs = await zeroCtx('staff', { ok: true, coupons: 3 });
    var zsr = await zs.C.zeroCoupons({ all: true });
    pass('manual set zero is admin only', zsr.ok === false && zs.calls.rpc.length === 0);
    var za = await zeroCtx('admin', { ok: true, batch_id: 'b-1', coupons: 4, value_cleared: 350 });
    var zneed = await za.C.zeroCoupons({ all: false, clinicCodes: [] });
    pass('set zero needs All or a clinic', zneed.ok === false && za.calls.rpc.length === 0);
    var zar = await za.C.zeroCoupons({ all: false, clinicCodes: ['kt', ' pl '] });
    var zarg = za.calls.rpc[0] && za.calls.rpc[0].args;
    pass('set zero calls dc_zero_coupons with upper-case clinic codes', za.calls.rpc[0].fn === 'dc_zero_coupons' && zarg.p_all === false &&
        zarg.p_clinic_codes.join(',') === 'KT,PL' && zarg.p_source === 'manual' && zarg.p_created_by === 'Tester', JSON.stringify(zarg));
    pass('set zero result carries batch and counts', zar.ok && zar.batch_id === 'b-1' && zar.coupons === 4 && zar.value_cleared === 350);
    var zlog = za.calls.insert.filter(function (x) { return x.table === 'audit_trail'; });
    pass('set zero writes a CANCEL row to the coupon log', zlog.length === 1 && zlog[0].rows[0].operation === 'CANCEL' &&
        /SET ZERO \(manual\) KT, PL: 4 coupon/.test(zlog[0].rows[0].detail || zlog[0].rows[0].details || JSON.stringify(zlog[0].rows[0])), JSON.stringify(zlog));
    var zm = await zeroCtx('admin', function () { return { data: null, error: { message: 'Could not find the function public.dc_zero_coupons in the schema cache' } }; });
    var zmr = await zm.C.zeroCoupons({ all: true });
    pass('missing SQL tells the user to run discount_coupon_zero.sql', zmr.ok === false && /discount_coupon_zero\.sql/.test(zmr.error), zmr.error);
    var zb = await zeroCtx('admin', { ok: true, batch_id: 'b-1', coupons: 4 });
    var zbr = await zb.C.revertLastZero();
    pass('step back calls dc_revert_zero_batch and logs RESTORE', zbr.ok && zbr.coupons === 4 && zb.calls.rpc[0].fn === 'dc_revert_zero_batch' &&
        zb.calls.insert.some(function (x) { return x.table === 'audit_trail' && x.rows[0].operation === 'RESTORE'; }));
    pass('set zero card sits before Referrals and is wired after the config', /html \+= zeroCardHtml\(\);\s+html \+= '<div class="dc-card" id="dcRefCard">/.test(src) &&
        /wireConfig\(pane\);\s+wireZeroCard\(pane\);/.test(src));
    pass('config loads the zero policy and runs a due auto clear', /loadZeroPolicy\(\)\]\)\.then/.test(src) && /maybeRunScheduledZero\(\)\.then/.test(src));

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

    console.log('=== 8b refer a friend ===');
    var refCamp = Object.assign({}, camp('referral'), { enabled: true, minFirstSpend: 300 });
    var oldP = { id: 'old', patient_no: '000123', chinese_name: '陳大文', full_name: 'CHAN TAI MAN', phone_number: '9123 4567', hkid: 'A123456(7)', created_at: '2024-01-01T00:00:00Z' };
    var newP = { id: 'new', patient_no: '000456', chinese_name: '李小明', full_name: 'LEE SIU MING', phone_number: '98765432', hkid: 'B7654321', created_at: '2026-10-27T02:00:00Z' };
    pass('referral default: HK$100, 180 days, min first visit HK$300', camp('referral').face === 100 && camp('referral').expiryDays === 180 &&
        camp('referral').minFirstSpend === 300);
    pass('same person: same HKID with different punctuation', C.samePerson(oldP, { id: 'x', hkid: 'a1234567' }));
    pass('same person: shared phone (+852 and spaces ignored)', C.samePerson(oldP, { id: 'x', mobile_phone: '+852 91234567' }));
    pass('different people are not the same person', !C.samePerson(oldP, newP));
    pass('earlier chart: same HKID, older', C.isEarlierChart(newP, { id: 'n0', hkid: 'B7654321', created_at: '2020-01-01' }));
    pass('earlier chart: same phone + same name, no date (imported)', C.isEarlierChart(newP, { id: 'n0', phone_number: '9876 5432', full_name: 'lee  siu ming' }));
    pass('not an earlier chart: same phone, different name (family)', !C.isEarlierChart(newP, { id: 'n0', phone_number: '98765432', full_name: 'LEE TAI MAN' }));
    pass('mask name: 陳大文 → 陳**, CHAN TAI MAN → CHAN **', C.maskName(oldP) === '陳**' && C.maskName({ full_name: 'CHAN TAI MAN' }) === 'CHAN **');
    var rp = function (extra) {
        return C.planReferral(Object.assign({ friend: newP, referrer: oldP, campaign: refCamp, clinicCode: 'KT' }, extra || {}));
    };
    pass('referral plan: valid pair is pending', rp().status === 'pending');
    pass('referral plan: no referrer → skip', rp({ referrer: null }).reason === 'no_referrer');
    pass('referral plan: already recorded → skip', rp({ existing: { id: 'r' } }).reason === 'already');
    pass('referral plan: campaign off → skip', rp({ campaign: Object.assign({}, refCamp, { enabled: false }) }).reason === 'campaign_off');
    pass('referral plan: clinic off → skip', rp({ clinicCode: 'CWB' }).reason === 'clinic');
    pass('referral plan: self referral → blocked', rp({ referrer: Object.assign({}, newP) }).status === 'blocked' && rp({ referrer: Object.assign({}, newP) }).reason === 'same_person');
    pass('referral plan: household phone → blocked', rp({ referrer: Object.assign({}, oldP, { phone_number: '98765432' }) }).reason === 'same_person');
    pass('referral plan: referrer newer than friend → blocked', rp({ referrer: Object.assign({}, oldP, { created_at: '2026-10-28T00:00:00Z' }) }).reason === 'referrer_newer');
    pass('referral plan: friend had an earlier chart → blocked', rp({ lookalikes: [{ id: 'n0', hkid: 'B7654321', created_at: '2019-01-01' }] }).reason === 'not_new');
    var nowMs = new Date('2026-11-10T00:00:00Z').getTime();
    pass('referral plan: edit within 30 days ok', rp({ source: 'edit', now: nowMs }).status === 'pending');
    pass('referral plan: edit after 30 days → skip', rp({ source: 'edit', now: new Date('2026-12-30T00:00:00Z').getTime() }).reason === 'edit_window');
    pass('referral plan: edit on an imported chart (no date) → skip', rp({ source: 'edit', friend: Object.assign({}, newP, { created_at: null }) }).reason === 'edit_window');
    var ri = function (extra) {
        return C.planReferralIssue(Object.assign({ record: { status: 'pending' }, campaign: refCamp, clinicCode: 'KT', cashPaid: 500, referrerWallet: [] }, extra || {}));
    };
    pass('referral issue: paid HK$500 ≥ HK$300 → issue', ri().ok);
    pass('referral issue: exactly the minimum → issue', ri({ cashPaid: 300 }).ok);
    pass('referral issue: HK$299.99 → wait (below_min)', ri({ cashPaid: 299.99 }).reason === 'below_min');
    pass('referral issue: blank minimum → any amount', C.planReferralIssue({ record: { status: 'pending' }, campaign: Object.assign({}, refCamp, { minFirstSpend: 0 }), clinicCode: 'KT', cashPaid: 1 }).ok);
    pass('referral issue: not pending → no', ri({ record: { status: 'issued' } }).reason === 'not_pending');
    var heldFive = [1, 2, 3, 4, 5].map(function (i) { return { campaign_key: 'referral', status: 'unused', code: 'R' + i }; });
    pass('referral issue: referrer already holds 5 → wait', ri({ referrerWallet: heldFive }).reason === 'already_holding');
    pass('referral issue: clinic off at payment → wait', ri({ clinicCode: 'CWB' }).reason === 'clinic');
    pass('reopen: issued record whose coupon was cancelled', C.referralsToReopen([
        { id: 'a', status: 'issued', coupon_id: 'c1' }, { id: 'b', status: 'issued', coupon_id: 'c2' }, { id: 'c', status: 'issuing' }
    ], ['c1']).join(',') === 'a,c');
    var prevOk = C.referralPreviewText({ status: 'pending' }, oldP, refCamp);
    pass('preview names the referrer, value, and the min first visit', prevOk.indexOf('#000123 陳大文') === 0 && prevOk.indexOf('HK$100') > 0 && prevOk.indexOf('HK$300') > 0, prevOk);
    var prevNo = C.referralPreviewText({ status: 'blocked', reason: 'same_person' }, oldP, refCamp);
    pass('preview explains a blocked referral', /no referral reward: Referrer looks like the same person/.test(prevNo), prevNo);
    var thanksSms = C.smsIssued({ code: 'DC-R1', campaign_key: 'referral', discount_mode: 'amount', face_value: 100, clinic_code: 'KT' }, [], { today: '2026-10-28', clinic: 'KT', thanks: '李**' });
    pass('referral SMS thanks the referrer with the masked friend name',
        thanksSms.split('\n')[1] === '變動/Change: +1 介紹新客 Refer a friend HK$100.00 (發出/Issued) — 多謝介紹 李** / thanks for referring 李**', thanksSms.split('\n')[1]);

    function memSB(db) {
        var log = [];
        function parseOr(s) {
            var out = [];
            var re = /([a-z_]+)\.(eq|ilike)\.("([^"]*)"|[^,]*)/g;
            var m;
            while ((m = re.exec(s))) out.push({ k: m[1], op: m[2], v: m[4] != null ? m[4] : m[3] });
            return out;
        }
        function hit(r, c) {
            var val = r[c.k] == null ? '' : String(r[c.k]);
            if (c.op === 'eq') return val === String(c.v);
            return val.toLowerCase().indexOf(String(c.v).replace(/%/g, '').toLowerCase()) >= 0;
        }
        return {
            log: log,
            rpc: function (fn, args) {
                log.push({ t: 'rpc', fn: fn, args: args });
                return Promise.resolve(db.__rpc ? db.__rpc(fn, args) : { data: null, error: { message: 'no rpc' } });
            },
            from: function (table) {
                db[table] = db[table] || [];
                var conds = [];
                var op = 'select';
                var body = null;
                var lim = 0;
                var single = false;
                var q = {
                    select: function () { return q; },
                    order: function () { return q; },
                    eq: function (k, v) { conds.push(function (r) { return String(r[k]) === String(v); }); return q; },
                    neq: function (k, v) { conds.push(function (r) { return String(r[k]) !== String(v); }); return q; },
                    in: function (k, vs) { conds.push(function (r) { return vs.map(String).indexOf(String(r[k])) >= 0; }); return q; },
                    or: function (s) { var cs = parseOr(s); conds.push(function (r) { return cs.some(function (c) { return hit(r, c); }); }); return q; },
                    ilike: function () { return q; },
                    limit: function (n) { lim = n; return q; },
                    maybeSingle: function () { single = true; return q; },
                    single: function () { single = true; return q; },
                    insert: function (rows) { op = 'insert'; body = rows; return q; },
                    update: function (u) { op = 'update'; body = u; return q; },
                    then: function (ok, bad) {
                        var res;
                        if (op === 'insert') {
                            var err = null;
                            var added = [];
                            body.forEach(function (row) {
                                if (table === 'discount_coupon_referrals' && db[table].some(function (x) {
                                    return String(x.referred_patient_id) === String(row.referred_patient_id);
                                })) { err = { message: 'duplicate key value violates unique constraint' }; return; }
                                var r = Object.assign({ id: table + '-' + (db[table].length + 1), created_at: new Date().toISOString() }, row);
                                db[table].push(r);
                                added.push(r);
                            });
                            log.push({ t: table, op: 'insert', rows: added });
                            res = { data: err ? null : added.map(function (r) { return Object.assign({}, r); }), error: err };
                        } else {
                            var rows = db[table].filter(function (r) { return conds.every(function (c) { return c(r); }); });
                            if (op === 'update') {
                                rows.forEach(function (r) { Object.assign(r, body); });
                                log.push({ t: table, op: 'update', u: body, n: rows.length });
                            }
                            if (lim) rows = rows.slice(0, lim);
                            rows = rows.map(function (r) { return Object.assign({}, r); });
                            res = { data: single ? (rows[0] || null) : rows, error: null };
                        }
                        return Promise.resolve(res).then(ok, bad);
                    }
                };
                return q;
            }
        };
    }
    var refDb = {
        patients: [oldP, newP, { id: 'other', patient_no: '000789', full_name: 'WONG', phone_number: '90000000', created_at: '2025-01-01T00:00:00Z' }],
        discount_coupons: [],
        discount_coupon_referrals: [],
        program_settings: [{ setting_key: 'discount_coupon_scheme', setting_value: JSON.stringify({
            clinics: { KT: { joined: true } },
            campaigns: [{ key: 'referral', enabled: true, minFirstSpend: 300 }, { key: 'new_chart', enabled: true }]
        }) }]
    };
    var refSb = memSB(refDb);
    var refSms = [];
    var refCtx = {
        console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, SB: refSb,
        currentClinicCodeForTagging: function () { return 'KT'; },
        AIHELPER: { sendTwilioOutreach: function (o) { refSms.push(o); return Promise.resolve({ ok: true }); } }
    };
    refCtx.window = refCtx;
    vm.createContext(refCtx);
    vm.runInContext(src, refCtx, { filename: 'app-coupons.js' });
    var RC = refCtx.COUPONS;
    var settle = function () { return new Promise(function (r) { setTimeout(r, 30); }); };
    await RC.onPatientCreated({ id: 'new', patient_no: '000456' }, '000123', 'old');
    await settle();
    var recs = refDb.discount_coupon_referrals;
    pass('flow: registering with a referrer records one pending referral', recs.length === 1 && recs[0].status === 'pending' &&
        recs[0].referrer_patient_id === 'old' && recs[0].referred_no === '000456' && recs[0].referrer_no === '000123', JSON.stringify(recs));
    pass('flow: new patient gets the welcome coupon, referrer gets nothing yet',
        refDb.discount_coupons.filter(function (c) { return c.patient_id === 'new' && c.campaign_key === 'new_chart'; }).length === 1 &&
        refDb.discount_coupons.filter(function (c) { return c.patient_id === 'old'; }).length === 0);
    await RC.onReferrerEdited('new', '000789', 'other');
    pass('flow: a second referrer for the same patient is ignored', recs.length === 1 && recs[0].referrer_patient_id === 'old');
    var low = await RC.referralOnBillPaid({ patientId: 'new', billId: 'bill-A', cashPaid: 200, clinicCode: 'KT' });
    pass('flow: first paid visit below HK$300 waits', low.ok === false && low.reason === 'below_min' && recs[0].status === 'pending' &&
        refDb.discount_coupons.filter(function (c) { return c.patient_id === 'old'; }).length === 0, JSON.stringify(low));
    var paid = await RC.referralOnBillPaid({ patientId: 'new', billId: 'bill-B', cashPaid: 680, clinicCode: 'KT' });
    await settle();
    var refCoupon = refDb.discount_coupons.filter(function (c) { return c.patient_id === 'old' && c.campaign_key === 'referral'; });
    pass('flow: paid HK$680 issues HK$100 referral coupon into the referrer wallet', paid.ok && refCoupon.length === 1 &&
        Number(refCoupon[0].face_value) === 100 && refCoupon[0].origin_bill_id === 'bill-B' && refCoupon[0].note === 'Referral: #000456', JSON.stringify(refCoupon));
    pass('flow: referral record is issued with the coupon id', recs[0].status === 'issued' && recs[0].coupon_id === refCoupon[0].id &&
        recs[0].trigger_bill_id === 'bill-B');
    var smsToRef = refSms.filter(function (s) { return s.to === '9123 4567'; });
    pass('flow: referrer gets the SMS with the masked friend name', smsToRef.length === 1 &&
        smsToRef[0].body.indexOf('多謝介紹 李** / thanks for referring 李**') > 0 && smsToRef[0].body.indexOf('總結餘/All-clinic total: 1張') > 0,
        smsToRef[0] && smsToRef[0].body.split('\n').slice(1, 4).join(' | '));
    var again = await RC.referralOnBillPaid({ patientId: 'new', billId: 'bill-C', cashPaid: 900, clinicCode: 'KT' });
    pass('flow: a later paid visit does not issue a second coupon', again.skipped === true &&
        refDb.discount_coupons.filter(function (c) { return c.patient_id === 'old'; }).length === 1);
    var voidRes = await RC.onBillVoided({ id: 'bill-B', patient_id: 'new' });
    await settle();
    pass('flow: voiding the friend’s paid bill cancels the unused referral coupon', voidRes.ok && refCoupon[0].id &&
        refDb.discount_coupons.filter(function (c) { return c.id === refCoupon[0].id; })[0].status === 'void');
    pass('flow: and the referral goes back to pending', recs[0].status === 'pending' && !recs[0].coupon_id && recs[0].reason === 'bill_voided', JSON.stringify(recs[0]));
    var repay = await RC.referralOnBillPaid({ patientId: 'new', billId: 'bill-D', cashPaid: 450, clinicCode: 'KT' });
    pass('flow: the next qualifying paid visit issues it again', repay.ok && recs[0].status === 'issued' &&
        refDb.discount_coupons.filter(function (c) { return c.patient_id === 'old' && c.status === 'unused' && c.campaign_key === 'referral'; }).length === 1);
    await RC.onPatientDeleted('new');
    pass('flow: deleting the friend’s chart voids the record and its unused coupon', recs[0].status === 'void' &&
        refDb.discount_coupons.filter(function (c) { return c.patient_id === 'old' && c.status === 'unused' && c.campaign_key === 'referral'; }).length === 0);
    refDb.patients.push({ id: 'kid', patient_no: '000999', full_name: 'CHAN SIU MING', phone_number: '91234567', created_at: '2026-10-28T01:00:00Z' });
    await RC.onPatientCreated({ id: 'kid', patient_no: '000999' }, '000123', null);
    var kidRec = recs.filter(function (r) { return r.referred_patient_id === 'kid'; })[0];
    pass('flow: typed chart no. resolves; same household phone is recorded as blocked', kidRec && kidRec.status === 'blocked' && kidRec.reason === 'same_person', JSON.stringify(kidRec));
    var kidPaid = await RC.referralOnBillPaid({ patientId: 'kid', billId: 'bill-K', cashPaid: 5000, clinicCode: 'KT' });
    pass('flow: a blocked referral never issues', kidPaid.skipped === true);
    var patSrc = read('app-patient.js');
    pass('patient form passes the picked referrer id and reward kind on register',
        /COUPONS\.onPatientCreated\(row, payload\.referred_by, extra\.referrer_id, extra\.referral_kind\)/.test(patSrc));
    pass('edit patient records a newly added referrer with its reward kind',
        /COUPONS\.onReferrerEdited\(savedId, extraEdit\.referred_by, extraEdit\.referrer_id, extraEdit\.referral_kind\)/.test(patSrc));
    pass('patient form reads only an enabled reward-kind radio', /refKind_/.test(patSrc) && /:checked:not\(:disabled\)/.test(patSrc));
    pass('both patient forms have the reward-kind choice', (html.match(/class="dc-ref-kind"/g) || []).length === 2);
    pass('deleting a chart ends its referrals', /COUPONS\.onPatientDeleted\(deletedId\)/.test(patSrc));
    pass('bill fully paid checks the pending referral', /function onBillFullyPaid[\s\S]{0,1600}referralOnBillPaid\(\{/.test(src));
    pass('both patient forms use the referrer picker', /id="referredBy" data-ref-picker/.test(html) && /id="edit_referredBy" data-ref-picker/.test(html) &&
        /id="referredById" class="dc-ref-id"/.test(html) && /id="edit_referredById" class="dc-ref-id"/.test(html));
    var refSql = read('discount_coupon_referrals.sql');
    pass('referral SQL: one record per new patient, no self referral', /unique \(referred_patient_id\)/.test(refSql) &&
        /referred_patient_id <> referrer_patient_id/.test(refSql));
    pass('referral SQL: reward kind is coupon or points, with points + ledger columns', /reward_kind in \('coupon', ?'points'\)/.test(refSql) &&
        /add column if not exists points/.test(refSql) && /add column if not exists ledger_id/.test(refSql));

    console.log('=== 8c refer a friend: reward points branch ===');
    var cOk = C.referralCouponGate({ campaign: refCamp, clinicCode: 'KT' });
    var cOff = C.referralCouponGate({ campaign: refCamp, clinicCode: 'CWB' });
    pass('coupon branch gate: on at KT, clinic-off at CWB, campaign-off when disabled', cOk.ok && cOff.reason === 'clinic' &&
        C.referralCouponGate({ campaign: Object.assign({}, refCamp, { enabled: false }), clinicCode: 'KT' }).reason === 'campaign_off',
        JSON.stringify([cOk, cOff]));
    var bothOn = C.referralOptions({ ok: true }, { ok: true });
    var ptsOnly = C.referralOptions({ ok: false, reason: 'clinic' }, { ok: true });
    var neither = C.referralOptions({ ok: false, reason: 'clinic' }, { ok: false, reason: 'points_clinic' });
    pass('options: two branches, the off one carries its reason', bothOn.length === 2 && bothOn.every(function (o) { return o.ok && !o.reason; }) &&
        ptsOnly[0].ok === false && ptsOnly[0].reason === 'clinic' && neither[1].reason === 'points_clinic');
    pass('pick kind: keeps the requested branch when on', C.pickReferralKind('points', bothOn) === 'points' && C.pickReferralKind('coupon', bothOn) === 'coupon');
    pass('pick kind: falls back to the branch that is on', C.pickReferralKind('coupon', ptsOnly) === 'points' && C.pickReferralKind(undefined, ptsOnly) === 'points');
    pass('pick kind: neither scheme → no referral', C.pickReferralKind('points', neither) === '');
    var kh = C.referralKindsHtml('refKind_referredBy', ptsOnly, 'points', refCamp, { points: 100 });
    pass('kind radios: the off branch is greyed out and disabled with its reason',
        /class="dc-ref-k is-off" data-kind="coupon"[^>]*title="[^"]+"><input type="radio" name="refKind_referredBy" value="coupon" disabled>/.test(kh) &&
        /data-kind="points"><input type="radio" name="refKind_referredBy" value="points" checked>/.test(kh) && kh.indexOf('+100') > 0, kh);
    var khNone = C.referralKindsHtml('refKind_referredBy', neither, '', refCamp, { points: 100 });
    pass('kind radios: neither scheme → both disabled + explanation', (khNone.match(/ disabled>/g) || []).length === 2 &&
        khNone.indexOf('dc-ref-k-none') > 0, khNone);
    var khLock = C.referralKindsHtml('refKind_edit_referredBy', bothOn, 'coupon', refCamp, { points: 100 }, 'coupon');
    pass('kind radios: an already recorded referral locks its branch', /value="points" disabled>/.test(khLock) && /value="coupon" checked>/.test(khLock));
    var pGate = { ok: true, reason: '' };
    var rpp = function (extra) {
        return C.planReferral(Object.assign({ friend: newP, referrer: oldP, campaign: refCamp, clinicCode: 'KT', kind: 'points', pointsGate: pGate }, extra || {}));
    };
    pass('points plan: valid pair is pending with kind points', rpp().status === 'pending' && rpp().kind === 'points');
    pass('points plan: works where the coupon campaign is off', rpp({ campaign: Object.assign({}, refCamp, { enabled: false }), clinicCode: 'CWB' }).status === 'pending');
    pass('points plan: points switched off → skip', rpp({ pointsGate: { ok: false, reason: 'points_off' } }).reason === 'points_off');
    pass('points plan: clinic not in points scheme → skip', rpp({ pointsGate: { ok: false, reason: 'points_clinic' } }).reason === 'points_clinic');
    pass('points plan: same guards as coupons (same person, earlier chart, edit window)',
        rpp({ referrer: Object.assign({}, newP) }).reason === 'same_person' &&
        rpp({ lookalikes: [{ id: 'n0', hkid: 'B7654321', created_at: '2019-01-01' }] }).reason === 'not_new' &&
        rpp({ source: 'edit', now: new Date('2026-12-30T00:00:00Z').getTime() }).reason === 'edit_window');
    var rip = function (extra) {
        return C.planReferralIssue(Object.assign({ record: { status: 'pending', reward_kind: 'points' }, campaign: refCamp, clinicCode: 'KT', cashPaid: 500,
            pointsGate: pGate, pointsConfig: { enabled: true, points: 100, minFirstSpend: 400 } }, extra || {}));
    };
    pass('points issue: HK$500 ≥ points minimum HK$400 → 100 points', rip().ok && rip().points === 100, JSON.stringify(rip()));
    pass('points issue: uses the points minimum, not the coupon one', rip({ cashPaid: 350 }).reason === 'below_min');
    pass('points issue: ignores the coupon wallet limit', rip({ referrerWallet: heldFive }).ok);
    pass('points issue: clinic left the points scheme → wait', rip({ pointsGate: { ok: false, reason: 'points_clinic' } }).reason === 'points_clinic');
    pass('reopen: issued points records are reversed, not reopened', C.referralsToReopen([
        { id: 'p1', status: 'issued', reward_kind: 'points', points: 100 }, { id: 'p2', status: 'issuing', reward_kind: 'points' }
    ], []).join(',') === 'p2');
    pass('reverse list: only issued points records with points', C.referralPointsToReverse([
        { id: 'a', reward_kind: 'points', status: 'issued', points: 100 }, { id: 'b', reward_kind: 'points', status: 'pending', points: 100 },
        { id: 'c', reward_kind: 'coupon', status: 'issued' }, { id: 'd', reward_kind: 'points', status: 'issued', points: 0 }
    ]).map(function (r) { return r.id; }).join(',') === 'a');
    pass('referrer thanks text is masked', C.referralThanks(newP) === '多謝介紹 李** / thanks for referring 李**' &&
        C.referralThanks({}, '000456') === '介紹 #000456 / referral #000456');
    var prevPts = C.referralPreviewText({ status: 'pending', kind: 'points' }, oldP, refCamp, { points: 100, minFirstSpend: 400 });
    pass('preview for points names the points and the points minimum', prevPts.indexOf('100') > 0 && prevPts.indexOf('HK$400') > 0 &&
        prevPts.indexOf('HK$100') < 0, prevPts);
    pass('referral reasons for points read as plain text', !/^coupons\./.test(C.referralReason('points_clinic')) &&
        !/^coupons\./.test(C.referralReason('points_spent')) && !/^coupons\./.test(C.referralReason('no_scheme')));

    var ptDb = {
        patients: [oldP, { id: 'pf', patient_no: '000555', chinese_name: '張美玲', full_name: 'CHEUNG MEI LING', phone_number: '97770000', hkid: 'C1112223',
            created_at: '2026-10-28T01:00:00Z' }],
        discount_coupons: [],
        discount_coupon_referrals: [],
        reward_program: [{ id: 1, sms_notify_enabled: true }],
        reward_program_clinics: [{ clinic_id: null, clinic_code: 'KT', enabled: true, join_gain: true, join_redeem: true }],
        reward_program_doctors: [],
        reward_accounts: [{ id: 'acc-old', patient_id: 'old', balance: 50 }],
        reward_sms_log: [],
        program_settings: [
            { setting_key: 'discount_coupon_scheme', setting_value: JSON.stringify({
                clinics: { KT: { joined: true } }, campaigns: [{ key: 'referral', enabled: true, minFirstSpend: 300 }, { key: 'new_chart', enabled: false }]
            }) },
            { setting_key: 'reward_referral', setting_value: JSON.stringify({ enabled: true, points: 100, minFirstSpend: 300 }) }
        ]
    };
    var ledgerN = 0;
    ptDb.__rpc = function (fn, args) {
        if (fn !== 'reward_adjust') return { data: null, error: { message: 'unexpected rpc ' + fn } };
        if (!args.p_note) return { data: { ok: false, error: 'note required' }, error: null };
        var acc = ptDb.reward_accounts.filter(function (a) { return a.patient_id === args.p_patient_id; })[0];
        if (!acc) { acc = { id: 'acc-' + args.p_patient_id, patient_id: args.p_patient_id, balance: 0 }; ptDb.reward_accounts.push(acc); }
        var next = Math.round((acc.balance + args.p_points_delta) * 100) / 100;
        if (next < 0) return { data: { ok: false, error: 'balance would be negative' }, error: null };
        acc.balance = next;
        return { data: { ok: true, kind: 'adjust', patient_id: acc.patient_id, points: args.p_points_delta, balance: next, ledger_id: 'L' + (++ledgerN) }, error: null };
    };
    var ptSb = memSB(ptDb);
    var ptSms = [];
    var nullDoc = {
        addEventListener: function () {}, getElementById: function () { return null; }, querySelector: function () { return null; },
        querySelectorAll: function () { return []; }, dispatchEvent: function () {}, createElement: function () { return { style: {}, setAttribute: function () {}, appendChild: function () {} }; }
    };
    var ptCtx = {
        console: console, setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
        SB: ptSb, document: nullDoc, CustomEvent: function () {},
        currentClinicCodeForTagging: function () { return 'KT'; },
        AIHELPER: { sendTwilioOutreach: function (o) { ptSms.push(o); return Promise.resolve({ ok: true }); } }
    };
    ptCtx.window = ptCtx;
    vm.createContext(ptCtx);
    vm.runInContext(read('app-rewards.js') + '\n;this.REWARDS = REWARDS;', ptCtx, { filename: 'app-rewards.js' });
    vm.runInContext(src, ptCtx, { filename: 'app-coupons.js' });
    var PC = ptCtx.COUPONS;
    var PRW = ptCtx.REWARDS;
    pass('rewards: referral config defaults (off, 100 points, HK$300)', JSON.stringify(PRW.normalizeReferralConfig(null)) ===
        JSON.stringify({ enabled: false, points: 100, minFirstSpend: 300 }) && PRW.normalizeReferralConfig({ enabled: true, points: '80', minFirstSpend: '' }).points === 80);
    pass('rewards: points gate — off, clinic not joined, on', PRW.referralPointsGate({ enabled: false, points: 100 }, true).reason === 'points_off' &&
        PRW.referralPointsGate({ enabled: true, points: 0 }, true).reason === 'points_off' &&
        PRW.referralPointsGate({ enabled: true, points: 100 }, false).reason === 'points_clinic' &&
        PRW.referralPointsGate({ enabled: true, points: 100 }, true).ok === true);
    pass('rewards: ledger kind label 介紹新客/Refer a friend', PRW.kindLabelBilingual('referral') === '介紹新客/Refer a friend', PRW.kindLabelBilingual('referral'));
    var brKT = await PC.referralBranches('KT');
    var brCWB = await PC.referralBranches('CWB');
    pass('branches at KT: coupon and points both on', brKT.options.every(function (o) { return o.ok; }) && brKT.pointsCfg && brKT.pointsCfg.points === 100,
        JSON.stringify(brKT.options));
    pass('branches at CWB: both greyed out (not in either scheme)', brCWB.options.every(function (o) { return !o.ok; }) &&
        brCWB.options[0].reason === 'clinic' && brCWB.options[1].reason === 'points_clinic', JSON.stringify(brCWB.options));
    var ptFriend = { id: 'pf', patient_no: '000555' };
    await PC.onPatientCreated(ptFriend, '000123', 'old', 'points');
    var pRecs = ptDb.discount_coupon_referrals;
    pass('points flow: register with points records a pending points referral', pRecs.length === 1 && pRecs[0].reward_kind === 'points' &&
        pRecs[0].status === 'pending', JSON.stringify(pRecs));
    var pLow = await PC.referralOnBillPaid({ patientId: 'pf', billId: 'bill-P0', cashPaid: 299, clinicCode: 'KT' });
    pass('points flow: HK$299 below the points minimum waits', pLow.reason === 'below_min' && pRecs[0].status === 'pending' &&
        ptDb.reward_accounts[0].balance === 50, JSON.stringify(pLow));
    var pPaid = await PC.referralOnBillPaid({ patientId: 'pf', billId: 'bill-P1', cashPaid: 680, clinicCode: 'KT' });
    var credit = ptSb.log.filter(function (l) { return l.t === 'rpc'; });
    pass('points flow: paid HK$680 credits +100 via reward_adjust with a note', pPaid.ok && pPaid.kind === 'points' && credit.length === 1 &&
        credit[0].args.p_patient_id === 'old' && credit[0].args.p_points_delta === 100 && credit[0].args.p_note === 'Referral: #000555' &&
        ptDb.reward_accounts[0].balance === 150, JSON.stringify(pPaid));
    pass('points flow: record issued with points + ledger id, no coupon issued', pRecs[0].status === 'issued' && pRecs[0].points === 100 &&
        pRecs[0].ledger_id === 'L1' && pRecs[0].trigger_bill_id === 'bill-P1' && ptDb.discount_coupons.length === 0, JSON.stringify(pRecs[0]));
    var ptSmsRef = ptSms.filter(function (s) { return s.to === '9123 4567'; });
    var ptLines = ptSmsRef[0] ? ptSmsRef[0].body.split('\n') : [];
    pass('points flow: referrer gets the reward points SMS', ptSmsRef.length === 1 &&
        ptLines[0] === '[Joyful Smile Dental Clinic 樂意牙科中心] 積分更新 / Reward points update' &&
        ptLines[1] === '變動/Change: +100.00 (介紹新客/Refer a friend)' &&
        ptLines[2] === '結餘/Balance (KT): 150.00' && ptLines[3] === '總結餘/All-clinic total: 150.00' &&
        ptLines.indexOf('參考/Ref: 多謝介紹 張** / thanks for referring 張**') > 0, ptLines.join(' | '));
    pass('points flow: a second paid visit does not credit again', (await PC.referralOnBillPaid({ patientId: 'pf', billId: 'bill-P2', cashPaid: 900, clinicCode: 'KT' })).skipped === true &&
        ptSb.log.filter(function (l) { return l.t === 'rpc'; }).length === 1);
    await PC.onBillVoided({ id: 'bill-P1', patient_id: 'pf' });
    await settle();
    var rev = ptSb.log.filter(function (l) { return l.t === 'rpc'; })[1];
    pass('points flow: voiding the friend’s bill takes the 100 points back', rev && rev.args.p_points_delta === -100 && /bill voided/.test(rev.args.p_note) &&
        ptDb.reward_accounts[0].balance === 50, JSON.stringify(rev && rev.args));
    pass('points flow: and the referral goes back to pending', pRecs[0].status === 'pending' && !pRecs[0].ledger_id && pRecs[0].reason === 'bill_voided',
        JSON.stringify(pRecs[0]));
    await PC.referralOnBillPaid({ patientId: 'pf', billId: 'bill-P3', cashPaid: 400, clinicCode: 'KT' });
    pass('points flow: next qualifying visit credits again', pRecs[0].status === 'issued' && ptDb.reward_accounts[0].balance === 150);
    ptDb.reward_accounts[0].balance = 30;
    await PC.onBillVoided({ id: 'bill-P3', patient_id: 'pf' });
    await settle();
    pass('points flow: points already spent are not forced negative', ptDb.reward_accounts[0].balance === 30 && pRecs[0].status === 'issued' &&
        pRecs[0].reason === 'points_spent', JSON.stringify(pRecs[0]));
    ptDb.reward_accounts[0].balance = 200;
    await PC.onPatientDeleted('pf');
    await settle();
    pass('points flow: deleting the friend’s chart takes the points back and voids the record', ptDb.reward_accounts[0].balance === 100 &&
        pRecs[0].status === 'void', JSON.stringify(pRecs[0]) + ' bal=' + ptDb.reward_accounts[0].balance);
    ptDb.patients.push({ id: 'pg', patient_no: '000556', full_name: 'HO KA YAN', phone_number: '96660000', created_at: '2026-10-28T02:00:00Z' });
    ptCtx.currentClinicCodeForTagging = function () { return 'CWB'; };
    await PC.onPatientCreated({ id: 'pg', patient_no: '000556' }, '000123', 'old', 'points');
    pass('points flow: at a clinic in neither scheme, no referral is recorded', pRecs.filter(function (r) { return r.referred_patient_id === 'pg'; }).length === 0);

    console.log('=== 9 SMS ===');
    var issuedSms = C.smsIssued({ nameZh: '滿額回贈', mode: 'amount', face: 100, expires_on: '2027-01-01' });
    pass('issue SMS uses the clinic heading', issuedSms.indexOf('樂意牙科中心') >= 0 && issuedSms.indexOf('滿額回贈') >= 0);
    var exp = C.smsExpiring({ status: 'unused', nameZh: '介紹新客', expires_on: '2026-11-02' }, '2026-10-26');
    pass('expiry SMS is 7 days before', exp.indexOf('7日內到期') >= 0 && exp.indexOf('2026-11-02') >= 0);
    var smsWallet = [
        { code: 'DC-A1', campaign_key: 'cash', discount_mode: 'amount', face_value: 100, status: 'unused', expires_on: '2026-12-01', clinic_code: 'KT' },
        { code: 'DC-A2', campaign_key: 'free_scaling', discount_mode: 'free_line', face_value: 0, status: 'unused', expires_on: '2026-11-20', clinic_code: 'PL' },
        { code: 'DC-A3', campaign_key: 'ortho', discount_mode: 'percent', percent: 10, max_discount: 3000, status: 'unused', expires_on: '2027-01-01', clinic_code: 'kt' },
        { code: 'DC-OLD', campaign_key: 'cash', discount_mode: 'amount', face_value: 50, status: 'used', expires_on: '2026-12-01' },
        { code: 'DC-GONE', campaign_key: 'cash', discount_mode: 'amount', face_value: 70, status: 'unused', expires_on: '2026-10-01' }
    ];
    var full = C.smsIssued({ code: 'DC-A1', campaign_key: 'cash', discount_mode: 'amount', face_value: 100, expires_on: '2026-12-01' },
        smsWallet, { today: '2026-10-27', clinic: 'KT' });
    var fullLines = full.split('\n');
    var rwCtx = {
        console: console, setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, SB: null,
        esc: function (s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    };
    rwCtx.window = rwCtx;
    rwCtx.document = { addEventListener: function () {}, getElementById: function () { return null; }, querySelectorAll: function () { return []; } };
    vm.createContext(rwCtx);
    vm.runInContext(read('app-rewards.js') + '\n;this.REWARDS = REWARDS;', rwCtx, { filename: 'app-rewards.js' });
    var RW = rwCtx.REWARDS;
    var rewardSms = RW.buildSmsBody({}, { points: 12, balance: 132, total: 250, kind: 'earn', clinic: 'KT', ref: 'Bill 1A2B3C4D', year: '2026' });
    var rewardLines = rewardSms.split('\n');
    pass('reward SMS shows this chart and the all-clinic total', rewardLines[2] === '結餘/Balance (KT): 132.00' &&
        rewardLines[3] === '總結餘/All-clinic total: 250.00', rewardSms);
    pass('reward SMS ends with the year-end note', rewardLines.length === 7 &&
        rewardLines[6].indexOf('備註/Note: 所有積分將於今年2026年12月31日 23:59到期，請好好善用；歡迎邀請親友使用。') === 0 &&
        rewardLines[6].indexOf('All reward points expire on 31 Dec 2026 23:59 this year') >= 0, rewardLines[6]);
    var oldStored = '[Joyful Smile Dental Clinic 樂意牙科中心] 積分更新 / Reward points update\n變動/Change: {CHANGE} ({KIND})\n結餘/Balance: {BALANCE}\n診所/Clinic: {CLINIC}\n參考/Ref: {REF}';
    pass('reward SMS upgrades an older saved template', RW.buildSmsBody({ sms_template_en: oldStored }, { points: 1, balance: 5, total: 9, kind: 'earn', clinic: 'PL' })
        .indexOf('總結餘/All-clinic total: 9.00') >= 0);
    var lgRows = [
        { created_at: '2026-10-27T06:32:00Z', kind: 'adjust', points: 100, balance_after: 284.5, clinic_code: 'KT', note: 'Referral: #000555' },
        { created_at: '2026-10-21T03:05:00Z', kind: 'earn', points: 68, balance_after: 184.5, clinic_code: 'KT', bill_id: 'a70b025a-1111', _doctor_name: 'Dr Ng' },
        { created_at: '2026-10-21T03:05:00Z', kind: 'redeem', points: -50, balance_after: 116.5, clinic_code: 'KT', bill_id: 'a70b025a-1111' },
        { created_at: '2026-09-30T02:12:00Z', kind: 'adjust', points: -10, balance_after: 166.5, clinic_code: 'PL', note: 'Goodwill fix' }
    ];
    pass('ledger: referral credits show as Refer a friend, other adjusts stay adjust', RW.ledgerDisplayKind(lgRows[0]) === 'referral' &&
        RW.ledgerDisplayKind(lgRows[3]) === 'adjust' && RW.ledgerDisplayKind({ kind: 'adjust', note: 'Referral reversed (bill voided): #1' }) === 'referral');
    pass('ledger filters: earned 1, used 1, adjust & void 2 (incl. referral)', RW.ledgerFilterRows(lgRows, 'earn').length === 1 &&
        RW.ledgerFilterRows(lgRows, 'redeem').length === 1 && RW.ledgerFilterRows(lgRows, 'other').length === 2 &&
        RW.ledgerFilterRows(lgRows, 'all').length === 4 && RW.ledgerFilterRows(lgRows, 'xfer').length === 0);
    var lgSum = RW.ledgerSummary(lgRows);
    pass('ledger summary: points in / out / count / last', lgSum.gained === 168 && lgSum.spent === -60 && lgSum.count === 4 &&
        lgSum.last === '2026-10-27T06:32:00Z', JSON.stringify(lgSum));
    var lgHtml = RW.renderLedgerRows(lgRows);
    pass('ledger rows: a divider per month, pills and badges', (lgHtml.match(/class="rw-lg-month"/g) || []).length === 2 &&
        /rw-lg-pts is-pos">\+100\.00/.test(lgHtml) && /rw-lg-pts is-neg">-50\.00/.test(lgHtml) &&
        /rw-kind rw-kind--referral/.test(lgHtml) && /class="rw-lg-note">/.test(lgHtml) === false && /Bill A70B025A/.test(lgHtml));
    pass('ledger rows: empty and every row spans 6 columns', /colspan="6"/.test(RW.renderLedgerRows([])) && !/colspan="7"/.test(lgHtml));
    var lgChips = RW.renderLedgerFilters(lgRows, 'redeem');
    pass('ledger chips: active one marked, empty type disabled', /class="rw-lg-chip is-active" data-rw-filter="redeem"/.test(lgChips) &&
        /data-rw-filter="xfer"[^>]* disabled>/.test(lgChips) && !/data-rw-filter="all"[^>]* disabled>/.test(lgChips), lgChips);
    pass('ledger modal has summary, filter chips and the styled table', /id="rwLedgerSummary"/.test(html) && /id="rwLedgerFilters"/.test(html) &&
        /<table class="rw-lg">/.test(html) && /class="rw-hero"/.test(html) && /id="rwLedgerBody"/.test(html));
    var rwBal = RW.smsBalances([{ patient_id: 'a', balance: 40 }, { patient_id: 'b', balance: 60.5 }], 'b', 0);
    pass('reward SMS balances: this chart and the person total', rwBal.balance === 60.5 && rwBal.total === 100.5, JSON.stringify(rwBal));
    pass('reward SMS reads fresh chart balances at send time', /listPersonAccountsFresh\(info\.patientId\)/.test(read('app-rewards.js')));
    var shape = function (s) {
        return s.split('\n').filter(function (l) { return /^(\[|變動\/Change|結餘\/Balance|總結餘\/All-clinic total|診所\/Clinic|參考\/Ref|備註\/Note)/.test(l); })
            .map(function (l) { return l.replace(/^\[[^\]]+\].*$/, 'HEAD').replace(/\s*\(.*$/, '').replace(/:.*$/, ''); }).join('|');
    };
    pass('coupon SMS follows the reward points layout', shape(full) === shape(rewardSms) &&
        fullLines[0] === '[Joyful Smile Dental Clinic 樂意牙科中心] 優惠券更新 / Discount coupon update', shape(full) + ' vs ' + shape(rewardSms));
    pass('coupon SMS change line names the new coupon', fullLines[1] === '變動/Change: +1 現金券 Cash coupon HK$100.00 (發出/Issued)', fullLines[1]);
    pass('coupon SMS balance: this clinic, then all clinics', fullLines[2] === '結餘/Balance (KT): 2張 / 2 coupons' &&
        fullLines[3] === '總結餘/All-clinic total: 3張 / 3 coupons', fullLines.slice(2, 4).join(' | '));
    pass('coupon SMS lists every usable coupon, soonest expiry first',
        fullLines[4] === '可用優惠券/Available coupons:' &&
        fullLines[5] === '1. 免費洗牙 Free scaling 免費/Free (DC-A2)' &&
        fullLines[6] === '2. 現金券 Cash coupon HK$100.00 (DC-A1)' &&
        fullLines[7] === '3. 矯齒優惠 Orthodontic discount 10% (最多/up to HK$3000.00) (DC-A3)' &&
        full.indexOf('DC-OLD') < 0 && full.indexOf('DC-GONE') < 0, fullLines.slice(4, 8).join(' | '));
    pass('coupon SMS clinic and ref lines', fullLines[8] === '診所/Clinic: KT' && fullLines[9] === '參考/Ref: DC-A1');
    pass('coupon SMS ends with the year-end note', fullLines.length === 11 &&
        fullLines[10].indexOf('備註/Note: 所有優惠券將於今年2026年12月31日 23:59到期，請好好善用；歡迎邀請親友使用。') === 0 &&
        fullLines[10].indexOf('All discount coupons expire on 31 Dec 2026 23:59 this year') >= 0 &&
        /invite others/.test(fullLines[10]), fullLines[10]);
    var lone = C.smsIssued({ code: 'DC-N1', campaign_key: 'referral', discount_mode: 'amount', face_value: 100, clinic_code: 'KT' }, [], { today: '2026-10-27', clinic: 'KT' });
    pass('coupon SMS adds the new coupon when the wallet has not caught up', /結餘\/Balance \(KT\): 1張 \/ 1 coupon\n總結餘\/All-clinic total: 1張 \/ 1 coupon\n/.test(lone) &&
        lone.indexOf('1. 介紹新客 Refer a friend HK$100.00 (DC-N1)') >= 0, lone);
    var bigWallet = [];
    for (var bw = 0; bw < 13; bw++) bigWallet.push({ code: 'B' + bw, campaign_key: 'cash', discount_mode: 'amount', face_value: 10, status: 'unused', expires_on: '2027-01-01' });
    var bigSms = C.smsIssued({ code: 'B0', campaign_key: 'cash', discount_mode: 'amount', face_value: 10 }, bigWallet, { today: '2026-10-27' });
    pass('coupon SMS keeps a long list short', bigSms.indexOf('10. ') >= 0 && bigSms.indexOf('11. ') < 0 && bigSms.indexOf('…另有3張 / and 3 more') >= 0);
    var remind = C.smsExpiring({ code: 'DC-A2', campaign_key: 'free_scaling', discount_mode: 'free_line', status: 'unused', expires_on: '2026-10-30' },
        '2026-10-27', smsWallet, { clinic: 'KT' });
    pass('expiry SMS uses the same layout and lists the wallet', shape(remind) === shape(rewardSms) &&
        remind.indexOf('變動/Change: 免費洗牙 Free scaling 免費/Free 3日內到期 (2026-10-30) / expires in 3 days') >= 0 &&
        remind.indexOf('(DC-A1)') >= 0 && remind.indexOf('備註/Note:') >= 0, remind);
    pass('coupon SMS reads the wallet at send time', /sendCouponSms\(row\.patient_id, function \(wallet\)/.test(src) &&
        /typeof body === 'function' \? loadWallet\(patientId\)/.test(src));
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
    var stackVoid = C.planBillVoid({ id: 'bill-2', coupon_id: 'k1' }, [
        { id: 'k1', status: 'used', bill_id: 'bill-2', code: 'K1' },
        { id: 'k2', status: 'used', bill_id: 'bill-2', code: 'K2' },
        { id: 'k3', status: 'used', bill_id: 'bill-2', code: 'K3' },
        { id: 'e1', status: 'used', bill_id: 'bill-7', origin_bill_id: 'bill-2', code: 'E1' },
        { id: 'e2', status: 'void', origin_bill_id: 'bill-2', code: 'E2' }
    ]);
    pass('void gives back every stacked coupon on the bill', stackVoid.restore.join(',') === 'k1,k2,k3', JSON.stringify(stackVoid));
    pass('void flags an earned coupon that was already used elsewhere', stackVoid.stuck.join(',') === 'E1' && stackVoid.cancel.length === 0);
    var payBorn = [
        { id: 'p1', status: 'unused', origin_bill_id: 'bill-3', code: 'P1' },
        { id: 'p2', status: 'used', bill_id: 'bill-8', origin_bill_id: 'bill-3', code: 'P2' },
        { id: 'p3', status: 'used', bill_id: 'bill-3', code: 'P3' }
    ];
    var payVoid = C.planPaymentVoid({ id: 'bill-3' }, payBorn, 200);
    pass('payment void takes back the spend coupon once the bill is not fully paid',
        payVoid.cancel.join(',') === 'p1' && payVoid.stuck.join(',') === 'P2', JSON.stringify(payVoid));
    pass('payment void keeps coupons used on the bill (it can be paid again)', payVoid.cancel.indexOf('p3') < 0);
    var payStill = C.planPaymentVoid({ id: 'bill-3' }, payBorn, 0);
    pass('payment void changes nothing while the bill is still fully paid', payStill.cancel.length === 0 && payStill.stuck.length === 0);
    var pvWrites = [];
    var pvCtx = { console: console, setTimeout: setTimeout };
    pvCtx.SB = {
        from: function (table) {
            var f = {};
            var upd = null;
            var q = {
                select: function () { return q; },
                eq: function (k, v) { f[k] = v; return q; },
                update: function (u) { upd = u; return q; },
                insert: function (rows) { pvWrites.push({ t: table, insert: rows }); return Promise.resolve({ data: [], error: null }); },
                then: function (ok, bad) {
                    var out;
                    if (upd) { pvWrites.push({ t: table, update: upd, f: JSON.parse(JSON.stringify(f)) }); out = { data: [], error: null }; }
                    else {
                        out = { data: payBorn.filter(function (r) {
                            return Object.keys(f).every(function (k) { return String(r[k]) === String(f[k]); });
                        }), error: null };
                    }
                    return Promise.resolve(out).then(ok, bad);
                }
            };
            return q;
        }
    };
    pvCtx.window = pvCtx;
    vm.createContext(pvCtx);
    vm.runInContext(src, pvCtx, { filename: 'app-coupons.js' });
    var pvRes = await pvCtx.COUPONS.onPaymentVoided({ billId: 'bill-3', balanceAfter: 350 });
    var pvVoided = pvWrites.filter(function (w) { return w.t === 'discount_coupons' && w.update && w.update.status === 'void'; });
    var pvLogs = pvWrites.filter(function (w) { return w.insert && w.t !== 'discount_coupons'; });
    pass('payment void cancels only the unused earned coupon in the database', pvRes.ok && pvVoided.length === 1 &&
        pvVoided[0].f.id === 'p1' && pvVoided[0].f.status === 'unused', JSON.stringify(pvWrites.map(function (w) { return w.t + ':' + (w.update ? 'upd' : 'ins'); })));
    pass('payment void writes the coupon log', pvLogs.length === 2 && pvLogs.every(function (w) { return w.insert[0].operation === 'CANCEL'; }));
    var pvSkip = await pvCtx.COUPONS.onPaymentVoided({ billId: 'bill-3', balanceAfter: 0 });
    pass('payment void on a still-paid bill does nothing', pvSkip.ok && pvSkip.skipped === true);
    var apptSrc0 = read('app-appt.js');
    pass('payment void is wired after the new balance is saved',
        /function voidPaymentRecord[\s\S]{0,4000}COUPONS\.onPaymentVoided\(\{ billId: p\.bill_id, balanceAfter: newBalance \}\)/.test(apptSrc0));
    pass('deleting an unpaid bill gives its coupons back first',
        /function deleteUnpaidBillForPendingList[\s\S]{0,1200}COUPONS\.onBillVoided\([\s\S]{0,300}couponP\.then\(function \(\) \{ return SB\.from\('bills'\)\.delete\(\)/.test(apptSrc0));
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
    var kA = { id: 'ca', campaign_key: 'cash', scope: 'bill', mode: 'amount', face: 100, status: 'unused', patient_id: 'p', expires_on: '2027-01-01' };
    var kB = { id: 'cb', campaign_key: 'cash', scope: 'bill', mode: 'amount', face: 50, status: 'unused', patient_id: 'p', expires_on: '2026-12-01' };
    var kC = { id: 'cc', campaign_key: 'cash', scope: 'bill', mode: 'amount', face: 200, status: 'unused', patient_id: 'p', expires_on: '2026-11-15' };
    var kS = { id: 'cs', campaign_key: 'spend_1', scope: 'bill', mode: 'amount', face: 100, status: 'unused', patient_id: 'p', expires_on: '2026-11-01' };
    function cashOpts(rules, eligible) {
        return { lines: comboLines, catalog: catalog, eligibleCents: eligible == null ? 8560 : eligible, patientId: 'p', billId: 'bx',
            cashRules: Object.assign({ maxPercent: 0, maxAmount: 0 }, rules) };
    }
    var stack3 = C.combineCoupons(Object.assign({ coupons: [kA, kB, kC] }, cashOpts({ maxCount: 3 })));
    pass('cash coupons stack on one bill', stack3.rows.length === 3 && stack3.save === 350, JSON.stringify({ n: stack3.rows.length, s: stack3.save }));
    var stack2 = C.combineCoupons(Object.assign({ coupons: [kA, kB, kC] }, cashOpts({ maxCount: 2 })));
    pass('cash coupons stop at the per-bill number', stack2.rows.length === 2 && stack2.skipped.some(function (s) {
        return s.coupon.id === 'cc' && s.reason === 'cash_count';
    }));
    var capAmt = C.combineCoupons(Object.assign({ coupons: [kA, kB] }, cashOpts({ maxCount: 3, maxAmount: 120 })));
    pass('max cash off per bill as HK$', capAmt.save === 120 && capAmt.capHit && capAmt.lost === 30, JSON.stringify({ s: capAmt.save, lost: capAmt.lost }));
    var capPct = C.combineCoupons(Object.assign({ coupons: [kC] }, cashOpts({ maxCount: 3, maxPercent: 10 }, 1000)));
    pass('max cash off per bill as % of the bill', capPct.save === 100 && capPct.capCents === 10000 && capPct.lost === 100,
        JSON.stringify({ s: capPct.save, cap: capPct.capCents }));
    var capFull = C.combineCoupons(Object.assign({ coupons: [kA, kB] }, cashOpts({ maxCount: 3, maxAmount: 100 })));
    pass('a cash coupon past the limit is not used', capFull.rows.length === 1 && capFull.skipped.some(function (s) {
        return s.coupon.id === 'cb' && s.reason === 'cash_cap';
    }));
    var spendFirst = C.combineCoupons(Object.assign({ coupons: [kS, kA] }, cashOpts({ maxCount: 3 })));
    var cashFirst = C.combineCoupons(Object.assign({ coupons: [kA, kS, kB] }, cashOpts({ maxCount: 3 })));
    pass('spend coupons do not stack with cash', spendFirst.rows.length === 1 && spendFirst.rows[0].coupon.id === 'cs' &&
        cashFirst.rows.length === 2 && cashFirst.rows.every(function (r) { return r.coupon.campaign_key === 'cash'; }));
    var covered = C.combineCoupons(Object.assign({ coupons: [kA, kB, kC] }, cashOpts({ maxCount: 3 }, 120)));
    pass('no extra cash coupon once the bill is covered', covered.save === 120 && covered.rows.length === 2 &&
        covered.skipped.some(function (s) { return s.coupon.id === 'cc' && s.reason === 'covered'; }), JSON.stringify(covered.skipped));
    var withTreat = C.combineCoupons(Object.assign({ coupons: [cScale, kA, kB] }, cashOpts({ maxCount: 3 })));
    pass('treatment coupon plus stacked cash', withTreat.rows.length === 3 && withTreat.save === 710, String(withTreat.save));
    var bestCash = C.bestCombination([kS, kA, kB, kC], cashOpts({ maxCount: 3 }));
    pass('best combination stacks cash when it saves more', bestCash.save === 350 && bestCash.cashCount === 3, JSON.stringify({ s: bestCash.save }));
    var bestNoWaste = C.bestCombination([kA, kB, kC], cashOpts({ maxCount: 3 }, 150));
    pass('best cash stack wastes the least', bestNoWaste.save === 150 && bestNoWaste.lost === 0 &&
        bestNoWaste.rows.map(function (r) { return r.coupon.id; }).sort().join(',') === 'ca,cb',
        JSON.stringify(bestNoWaste.rows.map(function (r) { return r.coupon.id; })));
    var bestOne = C.bestCombination([kA, kB, kC], cashOpts({ maxCount: 1 }));
    pass('per-bill number 1 means one cash coupon', bestOne.cashCount === 1 && bestOne.save === 200);
    var nr = C.normalizeCashRules({ maxCount: 50, maxPercent: 140, maxAmount: -5 });
    pass('cash rules are kept in range', nr.maxCount === 10 && nr.maxPercent === 100 && nr.maxAmount === 0 &&
        C.normalizeCashRules({ maxCount: 0 }).maxCount === 0 && C.normalizeCashRules({ maxCount: -4 }).maxCount === 0 &&
        C.normalizeCashRules({ maxPercent: 0 }).maxPercent === 0 && C.normalizeCashRules({ maxPercent: 0 }).maxAmount === 3000);
    var dflt = C.normalizeCashRules({});
    pass('cash rules default to any number, 50% of the bill up to HK$3,000',
        dflt.maxCount === 0 && dflt.maxPercent === 50 && dflt.maxAmount === 3000, JSON.stringify(dflt));
    var legacy = C.normalizeCashRules({ maxCount: 2, limitMode: 'percent', limitValue: 30 });
    pass('older single-limit cash rules are read', legacy.maxPercent === 30 && legacy.maxAmount === 0, JSON.stringify(legacy));
    pass('cash cap is 50% of a small bill', C.cashCapCents(4000, {}) === 200000);
    pass('cash cap stops at HK$3,000 on a big bill', C.cashCapCents(10000, {}) === 300000 && C.cashCapCents(6000, {}) === 300000);
    pass('cash cap with only one limit set', C.cashCapCents(10000, { maxAmount: 0 }) === 500000 && C.cashCapCents(10000, { maxPercent: 0 }) === 300000);
    var many = [];
    for (var mi = 0; mi < 14; mi++) {
        many.push({ id: 'm' + mi, campaign_key: 'cash', scope: 'bill', mode: 'amount', face: 100, status: 'unused', patient_id: 'p', expires_on: '2027-01-' + String(10 + mi) });
    }
    var manyAll = C.combineCoupons(Object.assign({ coupons: many }, cashOpts({ maxCount: 0 })));
    pass('any number of cash coupons can stack', manyAll.cashCount === 14 && manyAll.save === 1400, JSON.stringify({ n: manyAll.cashCount, s: manyAll.save }));
    var halfOpts = { lines: comboLines, catalog: catalog, eligibleCents: 1000, patientId: 'p', billId: 'bx', cashRules: {} };
    var half = C.combineCoupons(Object.assign({ coupons: [kC, kC, kC].map(function (k, i) { return Object.assign({}, k, { id: 'h' + i }); }) }, halfOpts));
    pass('default limit stops cash at 50% of the whole bill', half.save === 500 && half.capHit && half.capCents === 50000 && half.lost === 100,
        JSON.stringify({ s: half.save, cap: half.capCents, lost: half.lost }));
    var halfBest = C.bestCombination(many, halfOpts);
    pass('best pick at the 50% limit uses just enough coupons', halfBest.save === 500 && halfBest.cashCount === 5 && halfBest.lost === 0 &&
        halfBest.rows.map(function (r) { return r.coupon.id; }).join(',') === 'm0,m1,m2,m3,m4',
        JSON.stringify(halfBest.rows.map(function (r) { return r.coupon.id; })));
    var mixed = [];
    for (var xi = 0; xi < 40; xi++) {
        mixed.push({ id: 'x' + xi, campaign_key: 'cash', scope: 'bill', mode: 'amount', face: 10 + xi * 7, status: 'unused', patient_id: 'p', expires_on: '2027-02-01' });
    }
    var t0 = Date.now();
    var mixedBest = C.bestCombination(mixed, Object.assign({}, halfOpts, { eligibleCents: 100000 }));
    var tookMs = Date.now() - t0;
    pass('big bill: cash stops at HK$3,000 and the pick stays quick', tookMs < 3000 && mixedBest.save === 3000 && mixedBest.capCents === 300000,
        JSON.stringify({ ms: tookMs, s: mixedBest.save, lost: mixedBest.lost, n: mixedBest.cashCount }));
    var t2 = Date.now();
    var mixedAll = C.bestCombination(mixed, Object.assign({}, halfOpts, { eligibleCents: 100000, cashRules: { maxPercent: 0, maxAmount: 0 } }));
    var tookAllMs = Date.now() - t2;
    pass('with both limits blank a big wallet is used in full', tookAllMs < 3000 && mixedAll.save === 5860 && mixedAll.cashCount === 40,
        JSON.stringify({ ms: tookAllMs, s: mixedAll.save }));
    var t1 = Date.now();
    var mixedCap = C.bestCombination(mixed, Object.assign({}, halfOpts, { eligibleCents: 2000 }));
    var tookCapMs = Date.now() - t1;
    pass('big wallet at the 50% limit fills the limit quickly', tookCapMs < 3000 && mixedCap.save === 1000 && mixedCap.lost < 300,
        JSON.stringify({ ms: tookCapMs, s: mixedCap.save, lost: mixedCap.lost, n: mixedCap.cashCount }));
    pass('no limit when blank', C.cashCapCents(1000, { maxPercent: 0, maxAmount: 0 }) === Infinity &&
        C.cashCapCents(1000, { maxPercent: 15, maxAmount: 0 }) === 15000);
    pass('bill label counts stacked cash', C.couponLabelFor([{ coupon: kA }, { coupon: kB }, { coupon: cScale }]).indexOf('×2') > 0);
    C.mergeSaved({ cashRules: { maxCount: 2, maxPercent: 20, maxAmount: 800 } });
    var snapRules = C.snapshot().cashRules;
    pass('cash rules are saved with the scheme', snapRules.maxCount === 2 && snapRules.maxPercent === 20 && snapRules.maxAmount === 800);
    C.mergeSaved(null);
    pass('cash rules start at any number, 50% up to HK$3,000',
        C.cashRules().maxCount === 0 && C.cashRules().maxPercent === 50 && C.cashRules().maxAmount === 3000);
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

    console.log('=== 13 phone wallet (QR, browse only) ===');
    pass('node --check wallet.js', child_process.spawnSync(process.execPath, ['--check', path.join(root, 'wallet.js')]).status === 0);
    var wCtx = { console: console, navigator: { language: 'en-GB' }, localStorage: null };
    wCtx.window = wCtx;
    vm.createContext(wCtx);
    vm.runInContext(read('wallet.js'), wCtx, { filename: 'wallet.js' });
    var W = wCtx.CSWallet;
    var tok = '0123456789abcdef0123456789abcdef';
    pass('wallet reads the token from the link', W.tokenFrom({ search: '?t=' + tok, hash: '' }) === tok &&
        W.tokenFrom({ search: '?t=abc', hash: '' }) === '' && W.tokenFrom({ search: '', hash: '#t=' + tok.toUpperCase() }) === tok);
    pass('wallet language follows the link, then the phone', W.pickLang({ search: '?g=zh-CN' }) === 'zh-CN' && W.pickLang({ search: '' }) === 'en');
    var wData = {
        ok: true, name: 'C.T.M.', today: '2026-10-27',
        campaigns: [{ key: 'spend_4', trigger: 'target_spend', target: 2000, face: 150, name: 'Custom spend 1' }],
        coupons: [
            { code: 'DC-A1', campaign_key: 'cash', discount_mode: 'amount', face_value: 100, status: 'unused', expires_on: '2026-11-02' },
            { code: 'DC-A2', campaign_key: 'spend_4', discount_mode: 'amount', face_value: 150, status: 'unused', expires_on: '2027-03-01' },
            { code: 'DC-A3', campaign_key: 'free_scaling', discount_mode: 'free_line', face_value: 0, status: 'unused', expires_on: '2027-01-01', item_names: ['SCALING & POLISHING'] },
            { code: 'DC-A4', campaign_key: 'ortho', discount_mode: 'percent', percent: 10, max_discount: 3000, status: 'unused', expires_on: '2027-01-01' },
            { code: 'DC-OLD', campaign_key: 'cash', discount_mode: 'amount', face_value: 50, status: 'used', redeemed_at: '2026-09-01T03:00:00Z', redeemed_amount: 50 },
            { code: 'DC-EXP', campaign_key: 'cash', discount_mode: 'amount', face_value: 80, status: 'unused', expires_on: '2026-10-01' },
            { code: '<img src=x onerror=alert(1)>', campaign_key: '<b>x</b>', discount_mode: 'amount', face_value: 1, status: 'unused', expires_on: '2027-01-01' }
        ]
    };
    var wSplit = W.split(wData);
    pass('wallet splits ready and past coupons', wSplit.live.length === 5 && wSplit.past.length === 2 && wSplit.live[0].code === 'DC-A1',
        JSON.stringify({ live: wSplit.live.length, past: wSplit.past.length }));
    var wHtml = W.renderHtml(wData, 'en', false);
    pass('wallet shows ready coupons with value, codes and expiry', wHtml.indexOf('DC-A1') >= 0 && wHtml.indexOf('HK$251') >= 0 &&
        wHtml.indexOf('6 days left') >= 0 && wHtml.indexOf('FREE') >= 0 && wHtml.indexOf('up to HK$3,000') >= 0);
    pass('wallet names a custom spend coupon from the scheme', wHtml.indexOf('Spend $2000 get $150') >= 0);
    pass('wallet hides used / expired until asked', wHtml.indexOf('DC-OLD') < 0 && wHtml.indexOf('wlPastToggle') >= 0);
    var wPast = W.renderHtml(wData, 'zh-Hant', true);
    pass('wallet history shows used and expired', wPast.indexOf('DC-OLD') >= 0 && wPast.indexOf('已使用') >= 0 && wPast.indexOf('已過期') >= 0 &&
        wPast.indexOf('已節省 HK$50') >= 0);
    pass('wallet escapes text from the database', wHtml.indexOf('<img src=x') < 0 && wHtml.indexOf('<b>x</b>') < 0);
    pass('wallet is browse only (no use / add / remove controls)', !/<input|<form|<select|data-act=/.test(wHtml + wPast) &&
        (wPast.match(/<button/g) || []).length === 1);
    pass('wallet explains a bad or expired link', W.renderHtml({ ok: false, reason: 'bad_link' }, 'en').indexOf('not valid') >= 0 &&
        W.renderHtml({ ok: false, reason: 'expired' }, 'zh-CN').indexOf('已过期') >= 0 &&
        W.renderHtml({ ok: false, reason: 'offline' }, 'en').indexOf('connection') >= 0);
    pass('wallet with no coupons says so', W.renderHtml({ ok: true, today: '2026-10-27', coupons: [] }, 'en').indexOf('no coupons ready') >= 0);
    pass('wallet shows the SMS year-end reminder (31 Dec 23:59) in the chosen language',
        wHtml.indexOf('<div class="wl-remind" role="note"><p>⏰ All discount coupons expire on 31 Dec 2026 23:59 this year. Please make good use of them, and you are welcome to invite others to use them.</p>') > 0 &&
        wPast.indexOf('所有優惠券將於今年2026年12月31日 23:59到期，請好好善用；歡迎邀請親友使用。') > 0 &&
        W.renderHtml(wData, 'zh-CN', false).indexOf('所有优惠券将于今年2026年12月31日 23:59到期，请好好善用；欢迎邀请亲友使用。') > 0 &&
        W.renderHtml({ ok: true, today: '2026-10-27', coupons: [] }, 'en').indexOf('wl-remind') < 0, wHtml.slice(0, 0));
    pass('wallet shows the HK$3,000 per-bill limit in the chosen language',
        wHtml.indexOf('<p>💳 Maximum usage per bill is HK$3,000, unless otherwise specified.</p></div>') > 0 &&
        wPast.indexOf('<p>💳 每張賬單最高使用額為 HK$3,000，另有註明除外。</p>') > 0 &&
        W.renderHtml(wData, 'zh-CN', false).indexOf('<p>💳 每张账单最高使用额为 HK$3,000，另有注明除外。</p>') > 0);
    pass('wallet page address follows the phone-scan public address',
        C.walletPageBase({ href: 'http://127.0.0.1:8080/index.html?x=1' }, 'https://clinic.example.com/app/scan.html') === 'https://clinic.example.com/app/wallet.html' &&
        C.walletPageBase({ href: 'https://cs.example.com/app/index.html#p' }, '') === 'https://cs.example.com/app/wallet.html');
    pass('wallet QR link carries only the token', C.walletUrl(tok, 'https://a.example/wallet.html') === 'https://a.example/wallet.html?t=' + tok);
    pass('local addresses are flagged for the QR', C.isLocalAddress('http://127.0.0.1:8080/wallet.html') && !C.isLocalAddress('https://a.example/wallet.html'));
    var wSql = read('discount_coupon_wallet.sql');
    pass('wallet SQL: token table closed to the app key', /enable row level security/.test(wSql) &&
        /revoke all on public\.discount_coupon_wallet_links from anon, authenticated/.test(wSql) && !/create policy/i.test(wSql));
    pass('wallet SQL: random token from gen_random_uuid (no pgcrypto / schema path), both functions security definer',
        /replace\(gen_random_uuid\(\)::text, '-', ''\)/.test(wSql) && !/gen_random_bytes/.test(wSql) &&
        (wSql.match(/security definer/g) || []).length === 2 && /\^\[0-9a-f\]\{32\}\$/.test(wSql));
    pass('wallet SQL: tells the API to reload so the functions are found at once', /notify pgrst, 'reload schema'/.test(wSql));
    var wle1 = C.walletLinkError({ message: 'Could not find the function public.dc_wallet_link(p_by, p_patient_id, p_reset) in the schema cache' });
    var wle2 = C.walletLinkError({ message: 'function gen_random_bytes(integer) does not exist' });
    var wle3 = C.walletLinkError({ message: 'invalid input syntax for type uuid: "p"' });
    pass('wallet QR: only a missing dc_wallet_link reads as "not set up"', wle1.reason === 'no_sql' && wle2.reason === 'db' && wle3.reason === 'db');
    pass('wallet QR: other database errors keep their message', wle2.detail === 'function gen_random_bytes(integer) does not exist' && /uuid/.test(wle3.detail));
    var slip = C.walletSlipHtml('data:image/png;base64,AAAA', { who: '陳** · KT' });
    pass('wallet QR slip: QR image, masked name, clinic heading, do-not-share note', slip.indexOf('<img src="data:image/png;base64,AAAA"') > 0 &&
        slip.indexOf('陳** · KT') > 0 && slip.indexOf('Joyful Smile Dental Clinic 樂意牙科中心') > 0 && /do not share/.test(slip));
    pass('wallet QR slip escapes text', C.walletSlipHtml('x"><script>', { who: '<b>x</b>' }).indexOf('<script>') < 0 &&
        C.walletSlipHtml('', { who: '<b>x</b>' }).indexOf('<b>x</b>') < 0);
    pass('wallet QR draws through the Tools QR generator', /QRTOOL\.draw\(codeEl, url/.test(src));
    var waText = C.walletWhatsAppText('https://a.example/wallet.html?t=' + tok);
    pass('wallet WhatsApp message: clinic heading, bilingual line, the link, do-not-share', waText.split('\n')[0] === '[Joyful Smile Dental Clinic 樂意牙科中心]' &&
        waText.indexOf('查看你的優惠券') > 0 && waText.indexOf('see your coupons') > 0 &&
        waText.indexOf('https://a.example/wallet.html?t=' + tok) > 0 && /Please do not share this link\.$/.test(waText), waText);
    var waNamed = C.walletWhatsAppText('https://a.example/w', { chinese_name: '陳大文', full_name: 'Chan Tai Man' }).split('\n');
    var waEnOnly = C.walletWhatsAppText('https://a.example/w', { full_name: 'Mary Lee' }).split('\n');
    pass('wallet WhatsApp greets by name (Chinese in the Chinese line, English in the English line)',
        waNamed[1].indexOf('陳大文 你好！') === 0 && waNamed[2].indexOf('Hi Chan Tai Man! ') === 0 &&
        waEnOnly[1].indexOf('Mary Lee 你好！') === 0 && waEnOnly[2].indexOf('Hi Mary Lee! ') === 0 &&
        waText.split('\n')[1].indexOf('你好！') === 0 && waText.split('\n')[2].indexOf('Hi! ') === 0, waNamed.slice(1, 3).join(' | '));
    pass('wallet WhatsApp sends to the phone field via the shared WhatsApp opener', /var phone = waPhone\(\);/.test(src) &&
        /openWhatsAppPrefill\(phone, cfg\.waText\(url, patient\)\)/.test(src) && /waText: walletWhatsAppText/.test(src) && src.indexOf('id="dcWqrPhone"') > 0 &&
        /phone_number,mobile_phone/.test(src) && src.indexOf('QRTOOL.openWith') < 0);
    var toolsSrc = read('app-tools.js');
    pass('Tools QR generator offers draw() and openWith() to other modules', /return \{ open: open, draw: draw, openWith: openWith \}/.test(toolsSrc) &&
        /function draw\(container, text, opts\)/.test(toolsSrc));
    pass('wallet SQL: view returns no ids, bills or phones', (function () {
        var view = wSql.slice(wSql.indexOf('function public.dc_wallet_view'));
        var built = view.slice(view.indexOf("jsonb_agg(jsonb_build_object("), view.indexOf('into v_coupons'));
        return built.indexOf("'id'") < 0 && built.indexOf('bill_id') < 0 && built.indexOf('patient_id') < 0 && view.indexOf('phone') < 0;
    })());
    pass('wallet SQL: void and transferred coupons are hidden', /status not in \('void', 'transferred'\)/.test(wSql));
    pass('wallet SQL: new QR revokes the old link', /p_reset[\s\S]{0,200}set revoked_at = now\(\)/.test(wSql));
    var wPage = read('wallet.html');
    pass('wallet.html loads wallet.js, no referrer, not indexed', wPage.indexOf('wallet.js?v=') >= 0 &&
        wPage.indexOf('no-referrer') >= 0 && wPage.indexOf('noindex') >= 0 && !/<form|<input/.test(wPage));
    pass('sheet has a Wallet QR button', src.indexOf('id="dcWalletQrBtn"') >= 0 && src.indexOf("var fn = rpc || 'dc_wallet_link';") >= 0 &&
        src.indexOf('SB.rpc(fn, { p_patient_id: patientId') >= 0 && /openPhoneQr\(host && host\.querySelector\('\.dc-sheet'\), patientId, couponQrConfig\(\)\)/.test(src));

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
    sms: (function (s) {
      return s.indexOf('樂意牙科中心] 優惠券更新 / Discount coupon update') >= 0 && s.indexOf('結餘/Balance (KT): 1張') >= 0 &&
        s.indexOf('總結餘/All-clinic total: 1張') >= 0 &&
        s.indexOf('可用優惠券/Available coupons:') >= 0 && s.indexOf('備註/Note: 所有優惠券將於今年') >= 0;
    })(COUPONS.smsIssued({ code: 'DC-LIVE', campaign_key: 'cash', discount_mode: 'amount', face_value: 100, expires_on: '2027-01-01', clinic_code: 'KT' }, [], { clinic: 'KT' })),
    rwSms: (function (s) {
      return s.indexOf('結餘/Balance (KT): 5.00') >= 0 && s.indexOf('總結餘/All-clinic total: 8.00') >= 0 && s.indexOf('備註/Note: 所有積分將於今年') >= 0;
    })(REWARDS.buildSmsBody({}, { points: 1, balance: 5, total: 8, kind: 'earn', clinic: 'KT' }))
  };
})()`, false, 10000);
        pass('CDP 16 coupon rows, KT on, PL off', live && live.n === 16 && live.kt === true && live.pl === false, JSON.stringify(live));
        pass('CDP scaling coupon ignores the implant line', live && live.save === 560 && String(live.line).indexOf('SCALING') >= 0);
        pass('CDP typed text is not a match', live && live.typed === false);
        pass('CDP SMS heading', live && live.sms === true);
        pass('CDP reward SMS balance lines and note', live && live.rwSms === true);

        var refLive = await cdp.js(`(async () => {
  var input = document.getElementById('referredBy');
  var edit = document.getElementById('edit_referredBy');
  if (!input || !edit) return { ok: false, reason: 'no inputs' };
  await COUPONS.pickReferrer(input, { id: '00000000-0000-0000-0000-000000000000', patient_no: 'SMOKE01', chinese_name: '測試', created_at: '2020-01-01T00:00:00Z' });
  var root = input.closest('.dc-ref-fg');
  var out = {
    picker: input.hasAttribute('data-ref-picker') && edit.hasAttribute('data-ref-picker'),
    value: input.value,
    hiddenId: document.getElementById('referredById').value,
    preview: root.querySelector('.dc-ref-preview').textContent
  };
  await COUPONS.paintReferralKinds(input);
  var radios = Array.prototype.slice.call(root.querySelectorAll('.dc-ref-kind input[type="radio"]'));
  out.kinds = radios.map(function (r) {
    return { kind: r.value, disabled: r.disabled, checked: r.checked, off: r.closest('.dc-ref-k').classList.contains('is-off') };
  });
  out.kindsConsistent = radios.every(function (r) { return r.disabled === r.closest('.dc-ref-k').classList.contains('is-off'); });
  var fake = document.createElement('div');
  fake.innerHTML = COUPONS.referralKindsHtml('refKind_smoke', COUPONS.referralOptions({ ok: false, reason: 'clinic' }, { ok: true }), 'points', null, { points: 100 });
  fake.className = 'dc-ref-kind';
  document.body.appendChild(fake);
  var offLabel = fake.querySelector('.dc-ref-k.is-off');
  out.offGrey = !!offLabel && getComputedStyle(offLabel).cursor === 'not-allowed' && offLabel.querySelector('input').disabled;
  fake.remove();
  if (window.REWARDS && REWARDS.renderConfigPane) {
    var rwPane = document.createElement('div');
    REWARDS.renderConfigPane(rwPane);
    var rwDeadline = Date.now() + 25000;
    while (Date.now() < rwDeadline && !rwPane.querySelector('#rwCfgReferral')) await new Promise(function (r) { setTimeout(r, 250); });
    var rwCard = rwPane.querySelector('#rwCfgReferral');
    var rwAdmin = String(typeof currentRole !== 'undefined' ? currentRole : '').toLowerCase() === 'admin';
    out.rwRefCard = !!rwCard && (rwAdmin ? !!rwCard.querySelector('#rwCfgRefPoints') && !!rwCard.querySelector('#rwCfgRefMin') : !rwCard.querySelector('input'));
    out.rwPaneText = (rwAdmin ? 'admin: ' : 'read-only: ') + (rwCard ? rwCard.textContent : rwPane.textContent).replace(/\s+/g, ' ').slice(0, 200);
  }
  var rwStyle = document.getElementById('rwStyles');
  out.ledgerUi = !!document.getElementById('rwLedgerSummary') && !!document.getElementById('rwLedgerFilters') &&
    !!rwStyle && rwStyle.textContent.indexOf('.rw-lg-pts') >= 0 && rwStyle.textContent.indexOf('.rw-lg-month') >= 0;
  COUPONS.resetReferrerPicker('referredBy');
  out.cleared = document.getElementById('referredById').value === '' && root.querySelector('.dc-ref-preview').textContent === '';
  input.value = '';
  var pane = document.getElementById('cfgPane-coupons');
  if (pane) {
    COUPONS.renderConfigPane(pane);
    var deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      var b = pane.querySelector('#dcRefBody');
      if (b && b.textContent.trim()) break;
      await new Promise(function (r) { setTimeout(r, 200); });
    }
    out.minField = !!pane.querySelector('.dc-num[data-key="referral"][data-prop="minFirstSpend"]');
    out.refCard = !!pane.querySelector('#dcRefCard');
    out.refBody = (pane.querySelector('#dcRefBody') || {}).textContent || '';
  }
  return out;
})()`, true, 20000);
        pass('CDP referrer picker fills chart no. and id', refLive && refLive.picker && refLive.value === 'SMOKE01' &&
            refLive.hiddenId === '00000000-0000-0000-0000-000000000000', JSON.stringify(refLive));
        pass('CDP referrer preview shows the referrer and the outcome', refLive && /#SMOKE01 測試 — /.test(refLive.preview), refLive && refLive.preview);
        pass('CDP referrer picker resets', refLive && refLive.cleared === true);
        pass('CDP reward kind radios render (coupon + points), off = disabled', refLive && refLive.kinds && refLive.kinds.length === 2 &&
            refLive.kinds[0].kind === 'coupon' && refLive.kinds[1].kind === 'points' && refLive.kindsConsistent, refLive && JSON.stringify(refLive.kinds));
        pass('CDP greyed-out branch is not clickable', refLive && refLive.offGrey === true);
        pass('CDP reward ledger panel has the summary, chips and new styles', refLive && refLive.ledgerUi === true);
        pass('CDP Reward Points config has the refer-a-friend card', refLive && refLive.rwRefCard === true, refLive && refLive.rwPaneText);
        pass('CDP Config has the min first-visit field and the Referrals card', refLive && refLive.minField && refLive.refCard &&
            refLive.refBody.length > 0, refLive && refLive.refBody.slice(0, 120));

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
    cashRules: !!pane.querySelector('#dcCashRules select[data-cash-prop="maxCount"] option[value="0"]') &&
      !!pane.querySelector('#dcCashRules input[data-cash-prop="maxPercent"]') &&
      !!pane.querySelector('#dcCashRules input[data-cash-prop="maxAmount"]'),
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
        pass('live cash-per-bill settings with % and HK$ limits', !!(paint && paint.cashRules));
        pass('live rules note in config', !!(paint && paint.rules));
        var zLive = await cdp.js(`(async () => {
  var pane = document.getElementById('cfgPane-coupons');
  if (!pane) return { ok: false, reason: 'no pane' };
  var hadRole = typeof currentRole !== 'undefined';
  var oldRole = hadRole ? currentRole : undefined;
  function paintAs(role) {
    try { currentRole = role; } catch (e) { window.currentRole = role; }
    COUPONS.renderConfigPane(pane);
  }
  async function waitFor(sel) {
    var d = Date.now() + 15000;
    while (Date.now() < d && !pane.querySelector(sel)) await new Promise(function (r) { setTimeout(r, 200); });
    return pane.querySelector(sel);
  }
  var out = {};
  paintAs('staff');
  var ro = await waitFor('#dcZeroCard');
  out.readOnly = !!ro && !ro.querySelector('input,button') && /Only Admin/.test(ro.textContent);
  paintAs('admin');
  var card = await waitFor('#dcZeroPolicySave');
  card = pane.querySelector('#dcZeroCard');
  var md = Date.now() + 15000;
  while (Date.now() < md && card && !(pane.querySelector('#dcZeroLastMeta') || {}).textContent) await new Promise(function (r) { setTimeout(r, 200); });
  var order = Array.prototype.map.call(pane.querySelectorAll('.dc-card'), function (c) { return c.id; }).filter(Boolean);
  out.order = order;
  out.radios = card ? Array.prototype.map.call(card.querySelectorAll('input[name="dcZeroPolicy"]'), function (r) { return r.value + (r.checked ? '*' : ''); }) : [];
  out.months = card ? card.querySelectorAll('.dc-life-btn').length : 0;
  out.lifeHidden = card ? card.querySelector('#dcLifespanWrap').hidden : null;
  out.saveOffAtStart = !!(card && card.querySelector('#dcZeroPolicySave').disabled);
  out.authNote = ((card && card.querySelector('#dcZeroPolicyNote')) || {}).textContent || '';
  var life = card && card.querySelector('input[value="lifespan"]');
  if (life) { life.checked = true; life.dispatchEvent(new Event('change')); }
  out.saveOnAfterChange = !!(card && !card.querySelector('#dcZeroPolicySave').disabled);
  var man = card && card.querySelector('input[value="manual"]');
  if (man) { man.checked = true; man.dispatchEvent(new Event('change')); }
  out.saveOffWhenBack = !!(card && card.querySelector('#dcZeroPolicySave').disabled);
  if (life) { life.checked = true; life.dispatchEvent(new Event('change')); }
  out.lifeShown = card ? card.querySelector('#dcLifespanWrap').hidden === false : false;
  var b6 = card && card.querySelector('.dc-life-btn[data-months="6"]');
  if (b6) b6.click();
  out.activeMonths = card ? (card.querySelector('.dc-life-btn.is-active') || {}).getAttribute('data-months') : null;
  out.reset = !!(card && card.querySelector('#dcZeroReset'));
  out.step = !!(card && card.querySelector('#dcZeroStepBack'));
  out.meta = ((pane.querySelector('#dcZeroLastMeta') || {}).textContent || '');
  var danger = card ? getComputedStyle(card) : null;
  out.red = !!danger && danger.backgroundColor === 'rgb(255, 247, 247)';
  if (hadRole) { try { currentRole = oldRole; } catch (e) {} }
  COUPONS.renderConfigPane(pane);
  return out;
})()`, true, 60000);
        pass('CDP set zero card is read-only for non-admin', zLive && zLive.readOnly === true, JSON.stringify(zLive));
        pass('CDP set zero card sits before Referrals', zLive && zLive.order && zLive.order.indexOf('dcZeroCard') >= 0 &&
            zLive.order.indexOf('dcZeroCard') + 1 === zLive.order.indexOf('dcRefCard'), zLive && JSON.stringify(zLive.order));
        pass('CDP set zero card: three policies, manual default, 8 month buttons', zLive && zLive.radios.join(',') === 'manual*,year_end,lifespan' &&
            zLive.months === 8 && zLive.lifeHidden === true, zLive && JSON.stringify(zLive.radios));
        pass('CDP set zero card: life span shows months and picks one', zLive && zLive.lifeShown && zLive.activeMonths === '6');
        pass('CDP set zero Save is off until an option changes, and says SMS + Authenticator are needed', zLive && zLive.saveOffAtStart &&
            zLive.saveOnAfterChange && zLive.saveOffWhenBack && /SMS/.test(zLive.authNote) && /Authenticator/.test(zLive.authNote), zLive && zLive.authNote);
        pass('CDP set zero card: RESET ZERO, Step back, red danger styling', zLive && zLive.reset && zLive.step && zLive.red);
        pass('CDP set zero card: safety log line filled (last batch, none yet, or run-the-SQL hint)', zLive && zLive.meta.length > 0, zLive && zLive.meta);
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
  card('w1').click();
  r.none = picked();
  r.applyOff = !!(apply && apply.disabled);
  card('w1').click();
  r.applyOn = !!(apply && !apply.disabled);
  r.preview = (document.getElementById('dcPreview') || {}).textContent || '';
  var host = document.getElementById('dcSheetHost');
  if (host) { host.innerHTML = ''; host.setAttribute('hidden', ''); }
  return r;
})()`, false, 10000);
        pass('CDP picker starts on both cash coupons + scaling', pick && pick.start === 'w1,w2,w3' && pick.bestOnW1, JSON.stringify(pick));
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
        var wqr = await cdp.js(`(async function () {
  var bill = { id: 'bill-wqr', patient_id: 'p', clinic_tag: 'KT', subtotal: 560, discount: 0, items: '[]' };
  COUPONS._paintSheet(bill, [], 'KT', {});
  var host = document.getElementById('dcSheetHost');
  var out = {};
  var btn = document.getElementById('dcWalletQrBtn');
  out.btn = !!btn;
  var guide = host.querySelector('.dc-wsum-row .loyalty-guide-btn');
  if (guide) {
    guide.addEventListener('click', function (e) { e.preventDefault(); }, { once: true });
    guide.click();
    var gl = typeof getAppLang === 'function' ? getAppLang() : 'en';
    out.guide = { shown: guide.offsetParent !== null, text: guide.textContent, href: guide.getAttribute('href'), target: guide.target,
      lang: ['zh-Hant', 'zh-CN'].indexOf(gl) >= 0 ? gl : 'en' };
  }
  function wait(test, ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function tick() { if (test() || Date.now() - t0 > ms) resolve(test()); else setTimeout(tick, 100); })();
    });
  }
  btn.click();
  out.overlay = !!host.querySelector('.dc-wqr #dcWqrCode');
  await wait(function () { var e = document.getElementById('dcWqrErr'); return e && !e.hidden; }, 8000);
  var err = document.getElementById('dcWqrErr');
  out.realErr = err && !err.hidden ? err.textContent : '';
  host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  out.escClosesQrOnly = !host.querySelector('.dc-wqr') && !host.hasAttribute('hidden');
  var realRpc = SB.rpc;
  var calls = [];
  SB.rpc = function (name, args) {
    calls.push({ name: name, reset: args && args.p_reset });
    return Promise.resolve({ data: { ok: true, token: args && args.p_reset ? 'ffffffffffffffffffffffffffffffff' : '0123456789abcdef0123456789abcdef' }, error: null });
  };
  var realConfirm = window.confirm;
  var asked = [];
  window.confirm = function (m) { asked.push(m); return true; };
  var realFrom = SB.from;
  SB.from = function (table) {
    if (table !== 'patients') return realFrom.apply(SB, arguments);
    return { select: function (cols) {
      if (String(cols).indexOf('mobile_phone') < 0) return realFrom.call(SB, table).select(cols);
      var row = { patient_no: 'T001', chinese_name: '陳大文', full_name: 'Chan Tai Man', phone_number: '', mobile_phone: '9123 4567' };
      return { eq: function () { return { maybeSingle: function () { return Promise.resolve({ data: row, error: null }); } }; } };
    } };
  };
  var realWa = window.openWhatsAppPrefill;
  var sent = [];
  window.openWhatsAppPrefill = function (p, m) { sent.push({ phone: p, msg: m }); return true; };
  try {
    document.getElementById('dcWalletQrBtn').click();
    await wait(function () { return !!host.querySelector('#dcWqrCode img, #dcWqrCode canvas') || /could not be drawn/.test((host.querySelector('#dcWqrCode') || {}).textContent || ''); }, 10000);
    out.link = document.getElementById('dcWqrLink').value;
    out.qr = !!host.querySelector('#dcWqrCode img, #dcWqrCode canvas');
    out.qrUrl = host.querySelector('#dcWqrCode').getAttribute('data-url');
    document.getElementById('dcWqrReset').click();
    await wait(function () { return /ffff/.test(document.getElementById('dcWqrLink').value); }, 5000);
    out.resetLink = document.getElementById('dcWqrLink').value;
    out.calls = calls;
    out.localWarn = !document.getElementById('dcWqrLocal').hidden;
    await wait(function () { return !document.getElementById('dcWqrPng').disabled; }, 8000);
    var qc = host.querySelector('#dcWqrCode canvas');
    out.viaTool = !!qc && qc.getAttribute('role') === 'img' && qc.width === 220;
    await wait(function () { return !document.getElementById('dcWqrWa').disabled; }, 5000);
    out.toolsReady = ['dcWqrCopy', 'dcWqrPng', 'dcWqrPrint', 'dcWqrWa'].every(function (id) { return !document.getElementById(id).disabled; });
    out.noToolBtn = !document.getElementById('dcWqrTool');
    var waBtn = document.getElementById('dcWqrWa');
    var waCss = getComputedStyle(waBtn);
    out.waGreen = waCss.backgroundColor === 'rgb(37, 211, 102)' && waCss.color === 'rgb(255, 255, 255)' && /WhatsApp/.test(waBtn.textContent);
    out.waTitle = waBtn.title;
    var phoneIn = document.getElementById('dcWqrPhone');
    out.phoneField = phoneIn.value;
    waBtn.click();
    out.waSent = sent.length === 1 ? sent[0] : null;
    out.waAskedLocal = asked.some(function (m) { return /only works on this computer/.test(m); });
    phoneIn.value = '';
    phoneIn.dispatchEvent(new Event('input', { bubbles: true }));
    out.waOffNoPhone = waBtn.disabled && /type one in/.test(waBtn.title);
    phoneIn.value = '+852 6234 5678';
    phoneIn.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(function (r) { setTimeout(r, 750); });
    waBtn.click();
    out.waTyped = sent.length === 2 ? sent[1].phone : JSON.stringify(sent);
    var copied = [];
    var realClip = navigator.clipboard;
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: function (v) { copied.push(v); return Promise.resolve(); } } });
      var linkIn = document.getElementById('dcWqrLink');
      linkIn.click();
      await wait(function () { return !document.getElementById('dcWqrCopied').hidden; }, 3000);
      out.clickCopy = copied.length === 1 && copied[0] === linkIn.value && !document.getElementById('dcWqrCopied').hidden &&
        linkIn.classList.contains('is-copied') && /Copied/.test(document.getElementById('dcWqrCopy').textContent);
      linkIn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await wait(function () { return copied.length === 2; }, 2000);
      out.keyCopy = copied.length === 2;
      out.copyCursor = getComputedStyle(linkIn).cursor === 'copy';
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: realClip });
    }
    var direct = await QRTOOL.draw(null, 'https://example.com/wallet.html?t=0123', { size: 160, label: 'TEST' });
    out.direct = !!(direct && direct.ok && direct.canvas && direct.canvas.width === 160 && String(direct.dataUrl).indexOf('data:image/png') === 0);
  } finally {
    SB.rpc = realRpc;
    SB.from = realFrom;
    window.confirm = realConfirm;
    window.openWhatsAppPrefill = realWa;
  }
  host.innerHTML = ''; host.setAttribute('hidden', '');
  return out;
})()`, true, 30000);
        pass('CDP sheet shows the Wallet QR button', !!(wqr && wqr.btn && wqr.overlay), JSON.stringify(wqr));
        pass('CDP coupon sheet has 📖 How to use -> coupon part of the manual in the dashboard language (new tab)',
            !!(wqr && wqr.guide && wqr.guide.shown && /^📖/.test(wqr.guide.text) && wqr.guide.target === '_blank' &&
                wqr.guide.href === 'docs/loyalty-manual.html?v=20261028d#start-coupons-' + wqr.guide.lang), JSON.stringify(wqr && wqr.guide));
        pass('CDP Wallet QR explains when the link cannot be made', !!(wqr && /discount_coupon_wallet\.sql|Could not make/.test(wqr.realErr)), wqr && wqr.realErr);
        pass('CDP Esc closes the QR and keeps the sheet', !!(wqr && wqr.escClosesQrOnly));
        pass('CDP Wallet QR draws the wallet link', !!(wqr && wqr.qr && /\/wallet\.html\?t=0123456789abcdef0123456789abcdef$/.test(wqr.link) && wqr.qrUrl === wqr.link),
            wqr && wqr.link);
        pass('CDP New QR code asks for a fresh token', !!(wqr && /t=f{32}$/.test(wqr.resetLink) && wqr.calls.length === 2 &&
            wqr.calls[0].reset === false && wqr.calls[1].reset === true && wqr.calls[0].name === 'dc_wallet_link'));
        pass('CDP local address warning shows on 127.0.0.1', !!(wqr && wqr.localWarn));
        pass('CDP wallet QR is drawn by the Tools QR generator', !!(wqr && wqr.viaTool));
        pass('CDP Copy / Download / Print / WhatsApp turn on once drawn', !!(wqr && wqr.toolsReady && wqr.noToolBtn));
        pass('CDP WhatsApp button is green and names the chart phone', !!(wqr && wqr.waGreen && /9123 4567/.test(wqr.waTitle)), wqr && wqr.waTitle);
        pass('CDP WhatsApp opens with the patient phone and the wallet link in the message', !!(wqr && wqr.waSent && wqr.waSent.phone === '9123 4567' &&
            wqr.waSent.msg.indexOf(wqr.resetLink) > 0 && /^\[Joyful Smile Dental Clinic/.test(wqr.waSent.msg) &&
            wqr.waSent.msg.indexOf('陳大文 你好！') > 0 && wqr.waSent.msg.indexOf('Hi Chan Tai Man!') > 0), wqr && JSON.stringify(wqr.waSent));
        pass('CDP WhatsApp warns before sending a local-only link', !!(wqr && wqr.waAskedLocal));
        pass('CDP WhatsApp phone field is filled from the chart phone', !!(wqr && wqr.phoneField === '9123 4567'), wqr && wqr.phoneField);
        pass('CDP WhatsApp turns off when the phone field is empty', !!(wqr && wqr.waOffNoPhone));
        pass('CDP WhatsApp sends to the phone typed in the field', !!(wqr && wqr.waTyped === '+852 6234 5678'), wqr && wqr.waTyped);
        pass('CDP QRTOOL.draw works on its own (size, label, PNG data)', !!(wqr && wqr.direct));
        pass('CDP clicking the wallet link copies it and shows Copied', !!(wqr && wqr.clickCopy));
        pass('CDP Enter on the wallet link also copies; copy cursor shown', !!(wqr && wqr.keyCopy && wqr.copyCursor));
        pass('CDP a real database error shows its message', !!(wqr && /Database says: /.test(wqr.realErr)), wqr && wqr.realErr);
        var wpage = await cdp.js(`(async function () {
  var f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-2000px;top:0;width:390px;height:800px';
  f.src = 'wallet.html?t=00000000000000000000000000000000&g=en';
  document.body.appendChild(f);
  var t0 = Date.now();
  while (Date.now() - t0 < 12000) {
    await new Promise(function (r) { setTimeout(r, 200); });
    var d = f.contentDocument;
    var m = d && d.getElementById('wlMain');
    if (m && !m.querySelector('.wl-loading')) break;
  }
  var doc = f.contentDocument;
  var out = {
    title: doc.getElementById('wlTitle').textContent,
    text: doc.getElementById('wlMain').textContent,
    error: !!doc.querySelector('.wl-error'),
    controls: doc.querySelectorAll('input, select, form, textarea').length
  };
  f.remove();
  return out;
})()`, true, 20000);
        pass('CDP wallet.html opens and refuses an unknown link', !!(wpage && wpage.title === 'My coupons' && wpage.error && wpage.controls === 0),
            JSON.stringify(wpage));
        var dash = await cdp.js(`(async function () {
  function wait(test, ms) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function tick() { if (test() || Date.now() - t0 > ms) resolve(test()); else setTimeout(tick, 100); })();
    });
  }
  var pid = '00000000-0000-0000-0000-00000000da5h';
  var out = {};
  var host = document.createElement('div');
  host.id = 'dcDashTestHost';
  document.body.appendChild(host);
  var realAvail = COUPONS.walletAvailable, realRpc = SB.rpc, realFrom = SB.from;
  var joined = true;
  COUPONS.walletAvailable = function () { return Promise.resolve(joined); };
  var today = new Date(Date.now() + 864e5 * 60).toISOString().slice(0, 10);
  var wallet = [
    { id: 'w1', status: 'unused', campaign_key: 'cash', face_value: 100, patient_id: pid, expires_on: today },
    { id: 'w2', status: 'unused', campaign_key: 'free_scaling', face_value: 0, patient_id: pid, expires_on: today },
    { id: 'w3', status: 'used', campaign_key: 'cash', face_value: 50, patient_id: pid }
  ];
  var rpcCalls = [];
  SB.rpc = function (name, args) { rpcCalls.push(name); return Promise.resolve({ data: { ok: true, token: '0123456789abcdef0123456789abcdef' }, error: null }); };
  SB.from = function (table) {
    if (table === 'discount_coupons') return { select: function () { return { eq: function () { return Promise.resolve({ data: wallet, error: null }); } }; } };
    if (table === 'patients') return { select: function () { return { eq: function () { return { maybeSingle: function () {
      return Promise.resolve({ data: { patient_no: 'T001', chinese_name: '陳大文', full_name: 'Chan Tai Man', mobile_phone: '9123 4567' }, error: null }); } }; } }; } };
    return realFrom.apply(SB, arguments);
  };
  try {
    patViewRenderDashboard(host, { patient: { id: pid, full_name: 'Dash Test' }, appts: [], notes: [], bills: [], photos: [], docs: [], rx: [], xrays: [], charts: [] });
    var card = host.querySelector('#patDashCouponsCard');
    out.card = !!card;
    out.hiddenAtFirst = !!card && card.hidden;
    out.nextToPoints = !!card && card.previousElementSibling && card.previousElementSibling.id === 'patDashRewardsCard';
    patDashRefreshCoupons(pid);
    await wait(function () { return !card.hidden && /2/.test(document.getElementById('patDashCouponsAmt').textContent); }, 5000);
    out.shown = !card.hidden && card.offsetParent !== null;
    out.amt = document.getElementById('patDashCouponsAmt').textContent;
    out.label = card.querySelector('.pat-dash-coupons-label').textContent;
    card.click();
    await wait(function () { return /wallet\\.html\\?t=0123/.test((document.getElementById('dcWqrLink') || {}).value || ''); }, 8000);
    var qr = document.querySelector('#dcPhoneHost .dc-wqr');
    out.qr = !!qr;
    out.qrPos = qr ? getComputedStyle(qr).position : '';
    out.qrW = qr ? Math.round(qr.getBoundingClientRect().width) + '/' + document.documentElement.clientWidth : '';
    out.qrFixed = !!qr && out.qrPos === 'fixed' && qr.getBoundingClientRect().width >= document.documentElement.clientWidth - 2;
    out.link = (document.getElementById('dcWqrLink') || {}).value || '';
    out.rpc = rpcCalls.join(',');
    out.title = qr ? qr.querySelector('#dcWqrTitle').textContent : '';
    if (qr) qr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    out.closedOnEsc = !document.querySelector('#dcPhoneHost .dc-wqr');
    joined = false;
    patViewRenderDashboard(host, { patient: { id: pid, full_name: 'Dash Test' }, appts: [], notes: [], bills: [], photos: [], docs: [], rx: [], xrays: [], charts: [] });
    patDashRefreshCoupons(pid);
    await new Promise(function (r) { setTimeout(r, 400); });
    out.offHidden = host.querySelector('#patDashCouponsCard').hidden && host.querySelector('#patDashCouponsCard').offsetParent === null;
  } finally {
    COUPONS.walletAvailable = realAvail; SB.rpc = realRpc; SB.from = realFrom;
    var q = document.querySelector('#dcPhoneHost .dc-wqr'); if (q && q.__dcCancel) q.__dcCancel();
    host.remove();
  }
  return out;
})()`, true, 30000);
        pass('CDP patient dashboard: coupon wallet card sits next to the points card, hidden until checked',
            !!(dash && dash.card && dash.hiddenAtFirst && dash.nextToPoints), JSON.stringify(dash));
        pass('CDP patient dashboard: clinic in the scheme -> card shows the live coupon count (2 live, used one not counted)',
            !!(dash && dash.shown && /^2\b/.test(dash.amt) && /🎟️/.test(dash.label)), dash && (dash.amt + ' | ' + dash.label));
        pass('CDP patient dashboard: card opens the phone wallet QR over the page with the wallet.html link',
            !!(dash && dash.qr && dash.qrFixed && /\/wallet\.html\?t=0123456789abcdef0123456789abcdef$/.test(dash.link) && dash.rpc === 'dc_wallet_link'),
            dash && JSON.stringify({ link: dash.link, rpc: dash.rpc, fixed: dash.qrFixed, pos: dash.qrPos, w: dash.qrW }));
        pass('CDP patient dashboard: Escape closes the wallet QR', !!(dash && dash.closedOnEsc));
        pass('CDP patient dashboard: clinic not in the scheme -> no coupon card', !!(dash && dash.offHidden));
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
        pass('CDP tapping a stacked cash coupon takes only that one off', pick && pick.afterW2 === 'w1,w3' && pick.bestStays);
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
