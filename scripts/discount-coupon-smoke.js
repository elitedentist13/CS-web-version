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

var BUILD = '20261028doc';
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
    (function () {
        var on = { KT: { joined: true }, PL: { joined: true } };
        var liveKt = { 'KT|__all__': { joined: true }, 'KT|d-off': { joined: false }, 'KT|d-on': { joined: true }, 'PL|__all__': { joined: false }, 'PL|p1': { joined: true } };
        var j = function (map, c, d) { return C.doctorJoined(c, d, { clinics: on, doctors: map }); };
        pass('All Doctors ticked = every doctor of that clinic, even one switched off before',
            j(liveKt, 'KT', 'd-off') === true && j(liveKt, 'KT', 'd-on') === true && j(liveKt, 'KT', 'never-set') === true);
        pass('All Doctors is clinic by clinic (PL off: only its ticked doctor)',
            j(liveKt, 'PL', 'p1') === true && j(liveKt, 'PL', 'd-on') === false && j(liveKt, 'PL', 'other') === false && j(liveKt, 'PL', '__all__') === false);
        var keys = ['d1', 'd2', 'd3'];
        var m1 = C.planDoctorToggle({ 'KT|__all__': { joined: false }, 'KT|d1': { joined: false }, 'PL|p1': { joined: true } }, 'KT', '__all__', true, keys);
        pass('tick All Doctors: every KT doctor on, old KT switches cleared, PL untouched',
            keys.every(function (k) { return j(m1, 'KT', k); }) && !m1['KT|d1'] && m1['PL|p1'].joined === true, JSON.stringify(m1));
        var m2 = C.planDoctorToggle(m1, 'KT', 'd2', false, keys);
        pass('untick one doctor: All Doctors goes off, the others stay on',
            j(m2, 'KT', 'd1') && !j(m2, 'KT', 'd2') && j(m2, 'KT', 'd3') && !j(m2, 'KT', '__all__') && !j(m2, 'KT', 'someone-else'), JSON.stringify(m2));
        var m3 = C.planDoctorToggle(m2, 'KT', 'd2', true, keys);
        pass('tick the last one back: All Doctors on again', j(m3, 'KT', '__all__') && m3['KT|__all__'].joined === true && !m3['KT|d1'], JSON.stringify(m3));
        var m4 = C.planDoctorToggle(m3, 'KT', '__all__', false, keys);
        pass('untick All Doctors: every KT doctor off', keys.every(function (k) { return !j(m4, 'KT', k); }) && m4['PL|p1'].joined === true);
        var m5 = C.planDoctorToggle(m4, 'KT', 'd3', true, keys);
        pass('then tick one doctor: only that one is in', j(m5, 'KT', 'd3') && !j(m5, 'KT', 'd1') && !j(m5, 'KT', '__all__'));
        pass('config list repaints every switch of that clinic after a tick',
            /setDoctorJoined\(code, box\.getAttribute\('data-doctor'\), box\.checked, keys\);\s*boxes\.forEach\(function \(b\) \{ b\.checked = doctorJoined\(code, b\.getAttribute\('data-doctor'\)\); \}\)/.test(src));
    })();

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
    pass('reward module is used only for the refer-a-friend points branch, the shared manual link and the checkout points line', rwUses.length > 0 && rwUses.every(function (u) {
        return ['REWARDS.referralAvailability', 'REWARDS.referralCredit', 'REWARDS.referralReverse', 'REWARDS.clinicCtx',
            'REWARDS.loyaltyGuideLinkHtml', 'REWARDS.loadReferralConfig', 'REWARDS.billLoyaltyExcluded',
            'REWARDS.currentClinicJoined', 'REWARDS.earnRatePercent', 'REWARDS.relatedPatientIds'].indexOf(u) >= 0;
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
        { id: 'e', status: 'used', campaign_key: 'cash' },
        { id: 'f', status: 'unused', campaign_key: 'cash', expires_on: '2027-01-01', household_id: 'other' }
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
    var refCamp = Object.assign({}, camp('referral'), { enabled: true });
    var oldP = { id: 'old', patient_no: '000123', chinese_name: '陳大文', full_name: 'CHAN TAI MAN', phone_number: '9123 4567', hkid: 'A123456(7)', created_at: '2024-01-01T00:00:00Z' };
    var newP = { id: 'new', patient_no: '000456', chinese_name: '李小明', full_name: 'LEE SIU MING', phone_number: '98765432', hkid: 'B7654321', created_at: '2026-10-27T02:00:00Z' };
    pass('referral default: ladder 10% of the bill, up to HK$1000, HK$10 steps, min bill HK$500, 180 days', camp('referral').refPercent === 10 &&
        camp('referral').refMax === 1000 && camp('referral').refStep === 10 && camp('referral').minFirstSpend === 500 &&
        camp('referral').expiryDays === 180 && camp('referral').face === 100);
    var rv = function (paid, extra) { return C.referralCouponValue(Object.assign({}, refCamp, extra || {}), paid); };
    pass('referral ladder: HK$500 → 50, 999 → 90, 2,345 → 230, 5,000 → 500, 10,000 → 1000',
        rv(500) === 50 && rv(999) === 90 && rv(2345) === 230 && rv(5000) === 500 && rv(10000) === 1000, [rv(500), rv(999), rv(2345), rv(5000), rv(10000)].join(','));
    pass('referral ladder: capped at HK$1000 above a HK$10,000 bill', rv(10009) === 1000 && rv(25000) === 1000 && C.referralTopSpend(refCamp) === 10000);
    pass('referral ladder: steps follow the setting (HK$50 / exact)', rv(2345, { refStep: 50 }) === 200 && rv(2345, { refStep: 0 }) === 234.5 &&
        rv(1999.99, { refStep: 1 }) === 199);
    pass('referral with % blank keeps the fixed coupon', rv(2345, { refPercent: 0 }) === 100 && rv(2345, { refPercent: 0, face: 80 }) === 80 &&
        !C.referralLadderOn(Object.assign({}, refCamp, { refPercent: 0 })) && C.referralLadderOn(refCamp));
    pass('referral ladder rungs: min, round steps, the bill that reaches the max',
        C.referralLadderPoints(refCamp).join(',') === '500,1000,2000,5000,10000' &&
        C.referralLadderPoints(Object.assign({}, refCamp, { minFirstSpend: 1500 })).join(',') === '1500,2000,5000,10000', C.referralLadderPoints(refCamp).join(','));
    var rl = C.referralLadderHtml(refCamp);
    pass('referral ladder drawn ascending: +HK$50 at HK$500 up to +HK$1000 at HK$10000+', rl.indexOf('dc-ladder') > 0 &&
        rl.indexOf('+HK$50</span><span class="dc-rung-spend">HK$500<') > 0 && rl.indexOf('+HK$1000</span><span class="dc-rung-spend">HK$10000+<') > 0 &&
        C.referralLadderHtml(Object.assign({}, refCamp, { refPercent: 0 })) === '', rl);
    var rh = C.referralCfgHint(refCamp);
    pass('referral config hint spells out the ladder', rh.indexOf('10%') > 0 && rh.indexOf('HK$500') > 0 && rh.indexOf('HK$1000') > 0 &&
        rh.indexOf('HK$10000') > 0 && rh.indexOf('HK$10.') > 0 && /fully paid/.test(rh), rh);
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
        return C.planReferralIssue(Object.assign({ record: { status: 'pending' }, campaign: refCamp, clinicCode: 'KT', cashPaid: 680, fullyPaid: true, referrerWallet: [] }, extra || {}));
    };
    pass('referral issue: HK$680 bill fully paid → HK$60 coupon', ri().ok && ri().face === 60, JSON.stringify(ri()));
    pass('referral issue: exactly the HK$500 minimum → HK$50', ri({ cashPaid: 500 }).ok && ri({ cashPaid: 500 }).face === 50);
    pass('referral issue: HK$499.99 → wait (below_min)', ri({ cashPaid: 499.99 }).reason === 'below_min');
    var partPaid = ri({ cashPaid: 2345, fullyPaid: false });
    pass('referral issue: HK$2,345 paid but the bill is not fully paid → wait, coupon so far HK$230', partPaid.ok === false &&
        partPaid.reason === 'wait_full' && partPaid.face === 230, JSON.stringify(partPaid));
    pass('referral issue: HK$12,000 fully paid → HK$1000 (the max)', ri({ cashPaid: 12000 }).face === 1000);
    pass('referral issue: fixed coupon (% blank) still issues on a part payment', ri({ fullyPaid: false, campaign: Object.assign({}, refCamp, { refPercent: 0 }) }).ok &&
        ri({ fullyPaid: false, campaign: Object.assign({}, refCamp, { refPercent: 0 }) }).face === 100);
    pass('referral issue: blank minimum → any amount that makes a coupon', C.planReferralIssue({ record: { status: 'pending' }, campaign: Object.assign({}, refCamp, { minFirstSpend: 0 }), clinicCode: 'KT', cashPaid: 120, fullyPaid: true }).face === 10 &&
        C.planReferralIssue({ record: { status: 'pending' }, campaign: Object.assign({}, refCamp, { minFirstSpend: 0 }), clinicCode: 'KT', cashPaid: 5, fullyPaid: true }).reason === 'below_min');
    pass('referral issue: budget counts the ladder value', ri({ campaign: Object.assign({}, refCamp, { budget: 1000, budgetUsed: 950 }) }).reason === 'budget' &&
        ri({ cashPaid: 500, campaign: Object.assign({}, refCamp, { budget: 1000, budgetUsed: 950 }) }).ok);
    pass('referral wait note shows the coupon so far', C.referralHeldText({ referrer_no: '000123', referred_no: '000456' }, partPaid, 2345, 500).body.indexOf('coupon so far HK$230') > 0 &&
        /fully paid/.test(C.referralReason('wait_full')));
    pass('payment hook knows when the bill is fully paid', (await C.billFullyPaid('b1', 0)) === true && (await C.billFullyPaid('b1', 120)) === false &&
        (await C.billFullyPaid('b1', '0.00')) === true);
    var apptSrcRef = read('app-appt.js');
    pass('both payment paths pass the balance after the payment', /cashAmount: nonCashPay \? 0 : paid,\s*balanceAfter: bal,/.test(apptSrcRef) &&
        /cashAmount: ctx\.isBalanceTransfer \? 0 : cashAmount,\s*balanceAfter: newBalance,/.test(apptSrcRef) &&
        /fullyPaid: res\[2\]/.test(src) && /billFullyPaid\(info\.billId, info\.balanceAfter\)/.test(src));
    pass('referral issue: not pending → no', ri({ record: { status: 'issued' } }).reason === 'not_pending');
    var heldFive = [1, 2, 3, 4, 5].map(function (i) { return { campaign_key: 'referral', status: 'unused', code: 'R' + i }; });
    pass('referral issue: referrer already holds 5 → wait', ri({ referrerWallet: heldFive }).reason === 'already_holding');
    pass('referral issue: clinic off at payment → wait', ri({ clinicCode: 'CWB' }).reason === 'clinic');
    pass('reopen: issued record whose coupon was cancelled', C.referralsToReopen([
        { id: 'a', status: 'issued', coupon_id: 'c1' }, { id: 'b', status: 'issued', coupon_id: 'c2' }, { id: 'c', status: 'issuing' }
    ], ['c1']).join(',') === 'a,c');
    var prevOk = C.referralPreviewText({ status: 'pending' }, oldP, refCamp);
    pass('preview names the referrer, the ladder, full payment and the min bill', prevOk.indexOf('#000123 陳大文') === 0 &&
        prevOk.indexOf('worth 10% of the bill (HK$50–HK$1000)') > 0 && /fully paid/.test(prevOk) && prevOk.indexOf('HK$500') > 0, prevOk);
    var prevFixed = C.referralPreviewText({ status: 'pending' }, oldP, Object.assign({}, refCamp, { refPercent: 0, minFirstSpend: 300 }));
    pass('preview for a fixed referral coupon keeps HK$100 and part payments', prevFixed.indexOf('HK$100') > 0 && prevFixed.indexOf('HK$300') > 0 &&
        /full or part payment/.test(prevFixed), prevFixed);
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
                if (/^(dc_|loyalty_yearend)/.test(fn) && !(db.__dcRpc && db.__dcRpc[fn])) {
                    return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + fn + ' in the schema cache' } });
                }
                if (db.__dcRpc && db.__dcRpc[fn]) return Promise.resolve(db.__dcRpc[fn](args));
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
    var partFlow = await RC.referralOnBillPaid({ patientId: 'new', billId: 'bill-B', cashPaid: 680, clinicCode: 'KT', fullyPaid: false });
    pass('flow: a part payment over the minimum waits for the full payment', partFlow.ok === false && partFlow.reason === 'wait_full' &&
        recs[0].status === 'pending' && refDb.discount_coupons.filter(function (c) { return c.patient_id === 'old'; }).length === 0, JSON.stringify(partFlow));
    var paid = await RC.referralOnBillPaid({ patientId: 'new', billId: 'bill-B', cashPaid: 2345, clinicCode: 'KT', fullyPaid: true });
    await settle();
    var refCoupon = refDb.discount_coupons.filter(function (c) { return c.patient_id === 'old' && c.campaign_key === 'referral'; });
    pass('flow: bill fully paid at HK$2,345 issues a HK$230 referral coupon (10%) into the referrer wallet', paid.ok && refCoupon.length === 1 &&
        Number(refCoupon[0].face_value) === 230 && refCoupon[0].origin_bill_id === 'bill-B' && refCoupon[0].note === 'Referral: #000456', JSON.stringify(refCoupon));
    pass('flow: referral record is issued with the coupon id', recs[0].status === 'issued' && recs[0].coupon_id === refCoupon[0].id &&
        recs[0].trigger_bill_id === 'bill-B');
    var smsToRef = refSms.filter(function (s) { return s.to === '9123 4567'; });
    pass('flow: referrer gets the SMS with the masked friend name and the HK$230 value', smsToRef.length === 1 &&
        smsToRef[0].body.indexOf('多謝介紹 李** / thanks for referring 李**') > 0 && smsToRef[0].body.indexOf('總結餘/All-clinic total: 1張') > 0 &&
        smsToRef[0].body.indexOf('HK$230.00') > 0,
        smsToRef[0] && smsToRef[0].body.split('\n').slice(1, 4).join(' | '));
    var again = await RC.referralOnBillPaid({ patientId: 'new', billId: 'bill-C', cashPaid: 900, clinicCode: 'KT', fullyPaid: true });
    pass('flow: a later paid visit does not issue a second coupon', again.skipped === true &&
        refDb.discount_coupons.filter(function (c) { return c.patient_id === 'old'; }).length === 1);
    var voidRes = await RC.onBillVoided({ id: 'bill-B', patient_id: 'new' });
    await settle();
    pass('flow: voiding the friend’s paid bill cancels the unused referral coupon', voidRes.ok && refCoupon[0].id &&
        refDb.discount_coupons.filter(function (c) { return c.id === refCoupon[0].id; })[0].status === 'void');
    pass('flow: and the referral goes back to pending', recs[0].status === 'pending' && !recs[0].coupon_id && recs[0].reason === 'bill_voided', JSON.stringify(recs[0]));
    var repay = await RC.referralOnBillPaid({ patientId: 'new', billId: 'bill-D', cashPaid: 450, clinicCode: 'KT', fullyPaid: true });
    pass('flow: the next qualifying paid visit issues it again, worked out on that bill (HK$450 → HK$40)', repay.ok && recs[0].status === 'issued' &&
        refDb.discount_coupons.filter(function (c) { return c.patient_id === 'old' && c.status === 'unused' && c.campaign_key === 'referral' && Number(c.face_value) === 40; }).length === 1);
    await RC.onPatientDeleted('new');
    pass('flow: deleting the friend’s chart voids the record and its unused coupon', recs[0].status === 'void' &&
        refDb.discount_coupons.filter(function (c) { return c.patient_id === 'old' && c.status === 'unused' && c.campaign_key === 'referral'; }).length === 0);
    refDb.patients.push({ id: 'kid', patient_no: '000999', full_name: 'CHAN SIU MING', phone_number: '91234567', created_at: '2026-10-28T01:00:00Z' });
    await RC.onPatientCreated({ id: 'kid', patient_no: '000999' }, '000123', null);
    var kidRec = recs.filter(function (r) { return r.referred_patient_id === 'kid'; })[0];
    pass('flow: typed chart no. resolves; same household phone is recorded as blocked', kidRec && kidRec.status === 'blocked' && kidRec.reason === 'same_person', JSON.stringify(kidRec));
    var kidPaid = await RC.referralOnBillPaid({ patientId: 'kid', billId: 'bill-K', cashPaid: 5000, clinicCode: 'KT' });
    pass('flow: a blocked referral never issues', kidPaid.skipped === true);
    refDb.bills = [];
    refDb.bill_payments = [];
    refDb.patients.push({ id: 'fr2', patient_no: '000555', full_name: 'HO KA YAN', chinese_name: '何家欣', phone_number: '95550000', created_at: '2026-10-28T02:00:00Z' });
    await RC.onPatientCreated({ id: 'fr2', patient_no: '000555' }, '000789', 'other');
    await settle();
    var fr2Rec = recs.filter(function (r) { return r.referred_patient_id === 'fr2'; })[0];
    var fr2Coupons = function () { return refDb.discount_coupons.filter(function (c) { return c.patient_id === 'other' && c.campaign_key === 'referral'; }); };
    refDb.bill_payments.push({ id: 'pp1', bill_id: 'bill-P', amount: 200, method: 'Cash' });
    var part1 = await RC.onBillPayment({ patientId: 'fr2', billId: 'bill-P', cashAmount: 200, balanceAfter: 150, clinicCode: 'KT' });
    pass('flow: a HK$200 part payment waits (below the HK$300 minimum)', fr2Rec && fr2Rec.status === 'pending' &&
        part1.ok === false && part1.reason === 'below_min' && fr2Coupons().length === 0, JSON.stringify(part1));
    refDb.bill_payments.push({ id: 'pp-void', bill_id: 'bill-P', amount: 500, method: 'Cash', voided_at: '2026-10-28T03:00:00Z' },
        { id: 'pp-pts', bill_id: 'bill-P', amount: 400, method: 'Reward points' },
        { id: 'pp2', bill_id: 'bill-P', amount: 150, method: 'Octopus' });
    refDb.bills.push({ id: 'bill-P', balance: 0 });
    var part2 = await RC.onBillPayment({ patientId: 'fr2', billId: 'bill-P', cashAmount: 150, clinicCode: 'KT' });
    await settle();
    pass('flow: the second payment fully pays the bill at HK$350 cash and issues a HK$30 referral coupon (voided / points rows not counted; balance read from the bill)',
        part2.ok && part2.kind === 'coupon' && fr2Rec.status === 'issued' && fr2Rec.trigger_bill_id === 'bill-P' &&
        fr2Coupons().length === 1 && fr2Coupons()[0].origin_bill_id === 'bill-P' && Number(fr2Coupons()[0].face_value) === 30, JSON.stringify(part2));
    refDb.bill_payments.push({ id: 'pp3', bill_id: 'bill-P', amount: 400, method: 'Cash' });
    var part3 = await RC.onBillPayment({ patientId: 'fr2', billId: 'bill-P', cashAmount: 400, balanceAfter: 0, clinicCode: 'KT' });
    pass('flow: more payments on the same bill do not issue it twice', part3.skipped === true && fr2Coupons().length === 1);
    refDb.bill_payments.filter(function (p) { return p.id === 'pp3'; })[0].voided_at = '2026-10-28T04:00:00Z';
    var keepVoid = await RC.onPaymentVoided({ billId: 'bill-P', balanceAfter: 100 });
    await settle();
    pass('flow: voiding a payment keeps the referral while HK$350 cash is still paid', keepVoid.ok &&
        fr2Rec.status === 'issued' && fr2Coupons()[0].status === 'unused' && keepVoid.keptReferrals.indexOf(String(fr2Rec.id)) >= 0,
        JSON.stringify({ rec: fr2Rec.status, c: fr2Coupons()[0].status, k: keepVoid.keptReferrals }));
    refDb.bill_payments.filter(function (p) { return p.id === 'pp2'; })[0].voided_at = '2026-10-28T05:00:00Z';
    var dropVoid = await RC.onPaymentVoided({ billId: 'bill-P', balanceAfter: 250 });
    await settle();
    pass('flow: voiding down to HK$200 takes the referral coupon back and the referral waits again', dropVoid.ok &&
        fr2Coupons()[0].status === 'void' && fr2Rec.status === 'pending' && fr2Rec.reason === 'bill_voided',
        JSON.stringify({ rec: fr2Rec, c: fr2Coupons()[0].status }));
    pass('referral kept after a void only while the cash left meets its minimum',
        RC.referralStillEarned({ status: 'issued' }, 300, { coupon: 300 }) === true &&
        RC.referralStillEarned({ status: 'issued' }, 299.99, { coupon: 300 }) === false &&
        RC.referralStillEarned({ status: 'issued', reward_kind: 'points' }, 250, { coupon: 300, points: 200 }) === true &&
        RC.referralStillEarned({ status: 'issued' }, 0, { coupon: 0 }) === false &&
        RC.referralStillEarned({ status: 'pending' }, 900, { coupon: 300 }) === false);
    pass('referral bonus mini-notification text (coupon + points)', (function () {
        var a = RC.referralBonusText('coupon', { referrer_no: '000789', referred_no: '000555' }, 100, 350);
        var b = RC.referralBonusText('points', { referrer_no: '000789', referred_no: '000555' }, 100, 300);
        return a.title === '🤝 Refer a friend bonus activated' &&
            a.body === 'Referrer #000789 gets a HK$100 coupon · #000555 paid HK$350 on this bill' &&
            b.body === 'Referrer #000789 gets +100 reward points · #000555 paid HK$300 on this bill';
    })());
    pass('referral wording: first-visit minimum counts full or part payments (screens, i18n, manual)', (function () {
        var all = src + read('app-rewards.js') + read('app-i18n-extra.js') + read('docs/loyalty-manual.js');
        var i18n = read('app-i18n-extra.js');
        var label = "{ en: 'Min first-visit payment HK$ (full or part payment)', 'zh-CN': '首次就诊最低付款 HK$（全数或部分付款）', 'zh-Hant': '首次診症最低付款 HK$（全數或部分付款）' }";
        return !/Min first-visit HK\$|Min payment HK\$|first fully paid|first bill is fully paid|首次診症最低 HK|首次就诊最低 HK|首張賬單全數付清|首张账单全数付清/.test(all) &&
            /'coupons\.ref\.bonusTitle': \{ en: 'Refer a friend bonus activated', 'zh-CN': '介绍新客奖赏已启动', 'zh-Hant': '介紹新客獎賞已啟動' \}/.test(i18n) &&
            i18n.indexOf("'coupons.ref.minFirst': " + label) >= 0 && i18n.indexOf("'rewards.cfg.refMin': " + label) >= 0 &&
            /part payment both count/.test(read('docs/loyalty-manual.js'));
    })());
    pass('referral held back: mini-notification says why (doctor off / below the minimum)', (function () {
        var a = RC.referralHeldText({ referrer_no: '001003', referred_no: '022294' }, { ok: false, reason: 'clinic' }, 300, 300);
        var b = RC.referralHeldText({ referrer_no: '001003', referred_no: '022294' }, { ok: false, reason: 'below_min' }, 200, 300);
        return a.title === '🤝 Refer a friend: not given yet' &&
            a.body === 'This clinic or the bill’s doctor is switched off in the coupon scheme (Configuration → Discount Coupons) · #022294 paid HK$300 on this bill · referrer #001003' &&
            b.body.indexOf('Paid so far on the bill is below the minimum · #022294 paid HK$200 on this bill / min HK$300') === 0;
    })(), JSON.stringify(RC.referralHeldText({ referrer_no: '1', referred_no: '2' }, { reason: 'clinic' }, 300, 300)));
    pass('a payment that does not activate the pending referral pops the held notice',
        /if \(!plan\.ok\) \{\s*var held = referralHeldText\(rec, plan, info\.cashPaid,[\s\S]{0,120}couponNotice\(held\.body, held\.title, 'held'\)/.test(src));
    pass('both referral rewards pop the bonus mini-notification', /function rewardReferralCoupon[\s\S]{0,2600}referralBonusText\('coupon'[\s\S]{0,120}couponNotice\(note\.body, note\.title\)/.test(src) &&
        /function rewardReferralPoints[\s\S]{0,2800}referralBonusText\('points'[\s\S]{0,140}couponNotice\(note\.body, note\.title\)/.test(src));
    var patSrc = read('app-patient.js');
    pass('patient form passes the picked referrer id and reward kind on register',
        /COUPONS\.onPatientCreated\(row, payload\.referred_by, extra\.referrer_id, extra\.referral_kind\)/.test(patSrc));
    pass('edit patient records a newly added referrer with its reward kind',
        /COUPONS\.onReferrerEdited\(savedId, extraEdit\.referred_by, extraEdit\.referrer_id, extraEdit\.referral_kind\)/.test(patSrc));
    pass('patient form reads only an enabled reward-kind radio', /refKind_/.test(patSrc) && /:checked:not\(:disabled\)/.test(patSrc));
    pass('both patient forms have the reward-kind choice', (html.match(/class="dc-ref-kind"/g) || []).length === 2);
    pass('deleting a chart ends its referrals', /COUPONS\.onPatientDeleted\(deletedId\)/.test(patSrc));
    pass('every payment (full or part) checks the pending referral', /function onBillPayment[\s\S]{0,900}billCashPaid\(info\.billId, info\.cashAmount\)[\s\S]{0,300}referralOnBillPaid\(\{/.test(src) &&
        src.slice(src.indexOf('function onBillFullyPaid'), src.indexOf('function onBillFullyPaid') + 1700).indexOf('referralOnBillPaid(') < 0);
    var apptRef = read('app-appt.js');
    pass('bill create + pay and add payment both call onBillPayment before the fully-paid check',
        /insertBillPaymentRecord\(payRecord, function\(pr\)[\s\S]{0,1400}COUPONS\.onBillPayment\(\{[\s\S]{0,300}cashAmount: nonCashPay \? 0 : paid[\s\S]{0,500}COUPONS\.onBillFullyPaid\(/.test(apptRef) &&
        /function finishBillUpdate[\s\S]{0,1600}COUPONS\.onBillPayment\(\{[\s\S]{0,200}cashAmount: ctx\.isBalanceTransfer \? 0 : cashAmount[\s\S]{0,400}COUPONS\.onBillFullyPaid\(/.test(apptRef));
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
    var credit = ptSb.log.filter(function (l) { return l.t === 'rpc' && !/^(rw_wallet_link|dc_|loyalty_yearend)/.test(l.fn); });
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
        ptSb.log.filter(function (l) { return l.t === 'rpc' && !/^(rw_wallet_link|dc_|loyalty_yearend)/.test(l.fn); }).length === 1);
    await PC.onBillVoided({ id: 'bill-P1', patient_id: 'pf' });
    await settle();
    var rev = ptSb.log.filter(function (l) { return l.t === 'rpc' && !/^(rw_wallet_link|dc_|loyalty_yearend)/.test(l.fn); })[1];
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
    pass('coupon SMS reads the wallet at send time', /sendCouponSms\(saved\.patient_id, function \(wallet\)/.test(src) &&
        /typeof body === 'function' \? loadWallet\(patientId\)/.test(src));
    pass('SMS phone link line: coupons and points wording, nothing added without a link',
        C.smsWithPhoneLink('A\nB', 'https://a.example/wallet.html?t=x', 'coupons') === 'A\nB\n手機查看優惠券/See your coupons on the phone: https://a.example/wallet.html?t=x' &&
        C.smsWithPhoneLink('A', 'https://a.example/points.html?t=y', 'rewards') === 'A\n手機查看積分/See your points on the phone: https://a.example/points.html?t=y' &&
        C.smsWithPhoneLink('A', 'https://a.example/loyalty.html?c=x&p=y', 'loyalty') === 'A\n手機查看積分及優惠券/See your points and coupons on the phone: https://a.example/loyalty.html?c=x&p=y' &&
        C.smsWithPhoneLink('A', '', 'coupons') === 'A' && C.smsWithPhoneLink('', 'https://a.example/w', 'coupons') === '');
    pass('coupon issue SMS asks for the combined phone link; expiry and year-end reminders do not',
        /sendCouponSms\(saved\.patient_id, function \(wallet\) \{[\s\S]{0,200}\}, \{ phoneLink: true \}\)/.test(src) &&
        /sendCouponSms\(c\.patient_id, body\)/.test(src) && /loyaltyLinkForSms\(patientId\)/.test(src));
    var linkCalls = [];
    var linkMode = 'ok';
    var linkCtx = {
        console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
        localStorage: { getItem: function (k) { return k === 'csPhoneScanBase' ? 'https://clinic.example.com/app/scan.html?x=1' : null; } },
        SB: {
            from: function () {
                var q = { select: function () { return q; }, eq: function () { return q; },
                    maybeSingle: function () { return Promise.resolve({ data: { phone_number: '91234567', full_name: 'CHAN' }, error: null }); } };
                return q;
            },
            rpc: function (fn, args) {
                linkCalls.push({ fn: fn, args: args });
                if (linkMode === 'hang') return new Promise(function () {});
                if (linkMode === 'missing') return Promise.resolve({ data: null, error: { message: 'Could not find the function public.dc_wallet_link' } });
                return Promise.resolve({ data: { ok: true, token: fn === 'rw_wallet_link' ? 'rwtok' : 'dctok' }, error: null });
            }
        }
    };
    var linkSms = [];
    linkCtx.AIHELPER = { sendTwilioOutreach: function (o) { linkSms.push(o); return Promise.resolve({ ok: true }); } };
    linkCtx.window = linkCtx;
    vm.createContext(linkCtx);
    vm.runInContext(src, linkCtx, { filename: 'app-coupons.js' });
    var LC = linkCtx.COUPONS;
    var dcLink = await LC.phoneLinkForSms('p1', 'dc_wallet_link', 'wallet.html');
    var rwLink = await LC.phoneLinkForSms('p1', 'rw_wallet_link', 'points.html');
    pass('SMS phone link: public page address with the patient token, never a new QR',
        dcLink === 'https://clinic.example.com/app/wallet.html?t=dctok' && rwLink === 'https://clinic.example.com/app/points.html?t=rwtok' &&
        linkCalls.length === 2 && linkCalls.every(function (c) { return c.args.p_patient_id === 'p1' && c.args.p_reset === false; }),
        JSON.stringify({ dcLink: dcLink, rwLink: rwLink, calls: linkCalls }));
    await LC.sendCouponSms('p1', 'Body', { phoneLink: true });
    await LC.sendCouponSms('p1', 'Plain');
    var oneLink = await LC.loyaltyLinkForSms('p1');
    pass('SMS combined phone link: one loyalty.html with both tokens, never a new QR',
        oneLink === 'https://clinic.example.com/app/loyalty.html?c=dctok&p=rwtok', oneLink);
    pass('coupon SMS with phoneLink ends with the combined link; without it the text is unchanged',
        linkSms.length === 2 && linkSms[0].body === 'Body\n手機查看積分及優惠券/See your points and coupons on the phone: https://clinic.example.com/app/loyalty.html?c=dctok&p=rwtok' &&
        linkSms[1].body === 'Plain', JSON.stringify(linkSms.map(function (s) { return s.body; })));
    linkMode = 'missing';
    var noSqlLink = await LC.phoneLinkForSms('p1', 'dc_wallet_link', 'wallet.html');
    linkMode = 'hang';
    var t0 = Date.now();
    var slowLink = await LC.phoneLinkForSms('p1', 'dc_wallet_link', 'wallet.html', 60);
    await LC.sendCouponSms('p1', 'Late', { phoneLink: true });
    pass('SMS still goes without a link when the link cannot be made (not set up / too slow)',
        noSqlLink === '' && slowLink === '' && Date.now() - t0 < 6500 && linkSms[2] && linkSms[2].body === 'Late', JSON.stringify(linkSms[2]));
    linkCtx.localStorage = { getItem: function () { return null; } };
    linkMode = 'ok';
    pass('SMS phone link left out when the address only works on this computer',
        (await LC.phoneLinkForSms('p1', 'dc_wallet_link', 'wallet.html')) === '');
    pass('no expiry SMS on other days', C.smsExpiring({ status: 'unused', expires_on: '2026-12-31' }, '2026-10-26') === '' &&
        C.smsExpiring({ status: 'unused', expires_on: '2026-12-31' }, '2026-11-29') === '');
    pass('1 month before 31 Dec is 30 Nov', C.addMonthsIso('2026-12-31', -1) === '2026-11-30' && C.addMonthsIso('2027-03-31', -1) === '2027-02-28' &&
        C.addMonthsIso('2026-01-15', -1) === '2025-12-15');
    var yearEnd = { status: 'unused', expires_on: '2026-12-31', issued_on: '2026-03-01' };
    pass('month reminder starts 30 Nov for a 31 Dec expiry', C.expiryReminderStage(yearEnd, '2026-11-29') === '' &&
        C.expiryReminderStage(yearEnd, '2026-11-30') === 'month' && C.expiryReminderStage(yearEnd, '2026-12-23') === 'month' &&
        C.expiryReminderStage(yearEnd, '2026-12-24') === 'week' && C.expiryReminderStage(yearEnd, '2026-12-31') === '');
    var monthSms = C.smsExpiring(yearEnd, '2026-11-30');
    pass('month reminder text counts the days left', monthSms.indexOf('31日內到期 (2026-12-31)') >= 0 && monthSms.indexOf('expires in 31 days') >= 0, monthSms);
    pass('no month reminder for a coupon issued inside the month window',
        C.expiryReminderStage({ status: 'unused', expires_on: '2026-12-31', issued_on: '2026-12-05' }, '2026-12-10') === '' &&
        C.expiryReminderStage({ status: 'unused', expires_on: '2026-12-31', issued_on: '2026-12-05' }, '2026-12-25') === 'week');
    pass('month reminder claims its own column and skips coupons already week-reminded',
        /sendExpiryStage\('month', 'expiry_sms_month_at', today, before\)/.test(src) && /q\.is\('expiry_sms_at', null\)/.test(src) &&
        read('discount_coupons_expiry_sms.sql').indexOf('expiry_sms_month_at') >= 0);
    pass('year-end reminder: 30 Nov–23 Dec month, 24–30 Dec week, none on 31 Dec or before 30 Nov',
        C.yearEndReminderStage('2026-11-29') === '' && C.yearEndReminderStage('2026-11-30') === 'month' &&
        C.yearEndReminderStage('2026-12-23') === 'month' && C.yearEndReminderStage('2026-12-24') === 'week' &&
        C.yearEndReminderStage('2026-12-30') === 'week' && C.yearEndReminderStage('2026-12-31') === '' &&
        C.yearEndReminderStage('2027-01-05') === '' && C.yearEndReminderStage('') === '');
    var yeSms = C.smsYearEndCoupons('2026-11-30', smsWallet, { clinic: 'KT' });
    pass('year-end coupon SMS: same layout, 31 Dec 23:59, days left, lists the wallet', shape(yeSms) === shape(rewardSms) &&
        yeSms.indexOf('所有優惠券將於2026年12月31日 23:59到期（還有31日）/ All coupons expire on 31 Dec 2026 23:59 (31 days left)') >= 0 &&
        yeSms.indexOf('(DC-A1)') >= 0, yeSms);
    pass('year-end coupon SMS on 24 Dec says 7 days', C.smsYearEndCoupons('2026-12-24', smsWallet, { clinic: 'KT' }).indexOf('(7 days left)') >= 0);
    pass('year-end coupon reminders only with Set zero on year end, one claim per patient',
        /zeroPolicy\(\)\.zero_policy !== 'year_end'\) return Promise\.resolve\(\{ ok: true, skipped: 'policy' \}\)/.test(src) &&
        /claimYearEndSms\('coupons', year, stage, 'p:' \+ pid, pid\)/.test(src) && /\.gte\('expires_on', end\)/.test(src));
    pass('with year end on, per-coupon reminders leave coupons lasting to 31 Dec to the year-end SMS',
        /if \(before\) q = q\.lt\('expires_on', before\)/.test(src) && /before = today\.slice\(0, 4\) \+ '-12-31'/.test(src));
    pass('year-end claim table patch exists with a unique person key',
        /unique \(scheme, year, stage, person_key\)/.test(read('loyalty_yearend_sms.sql')));
    pass('coupon "today" is the Hong Kong date', /function todayIso\(\) \{ return new Date\(Date\.now\(\) \+ 8 \* 3600000\)/.test(src));

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
        doctors: { 'KT|__all__': { joined: false }, 'KT|doc-in': { joined: true }, 'KT|doc-out': { joined: false } },
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
    pass('cash rules default to any number, no % limit, up to HK$3,000',
        dflt.maxCount === 0 && dflt.maxPercent === 0 && dflt.maxAmount === 3000, JSON.stringify(dflt));
    var legacy = C.normalizeCashRules({ maxCount: 2, limitMode: 'percent', limitValue: 30 });
    pass('older single-limit cash rules are read', legacy.maxPercent === 30 && legacy.maxAmount === 0, JSON.stringify(legacy));
    pass('default cash cap is HK$3,000 on any bill (no % of the bill)', C.cashCapCents(4000, {}) === 300000 &&
        C.cashCapCents(1000, {}) === 300000 && C.cashCapCents(10000, {}) === 300000);
    pass('a % set in Configuration still caps a small bill', C.cashCapCents(4000, { maxPercent: 50 }) === 200000 &&
        C.cashCapCents(10000, { maxPercent: 50 }) === 300000 && C.cashCapCents(6000, { maxPercent: 50 }) === 300000);
    pass('cash cap with only one limit set', C.cashCapCents(10000, { maxPercent: 50, maxAmount: 0 }) === 500000 &&
        C.cashCapCents(10000, { maxPercent: 0 }) === 300000 && C.cashCapCents(10000, { maxAmount: 0 }) === Infinity);
    var many = [];
    for (var mi = 0; mi < 14; mi++) {
        many.push({ id: 'm' + mi, campaign_key: 'cash', scope: 'bill', mode: 'amount', face: 100, status: 'unused', patient_id: 'p', expires_on: '2027-01-' + String(10 + mi) });
    }
    var manyAll = C.combineCoupons(Object.assign({ coupons: many }, cashOpts({ maxCount: 0 })));
    pass('any number of cash coupons can stack', manyAll.cashCount === 14 && manyAll.save === 1400, JSON.stringify({ n: manyAll.cashCount, s: manyAll.save }));
    var halfOpts = { lines: comboLines, catalog: catalog, eligibleCents: 1000, patientId: 'p', billId: 'bx', cashRules: { maxPercent: 50, maxAmount: 3000 } };
    var halfCoupons = [kC, kC, kC].map(function (k, i) { return Object.assign({}, k, { id: 'h' + i }); });
    var half = C.combineCoupons(Object.assign({ coupons: halfCoupons }, halfOpts));
    pass('a 50% limit stops cash at half of the whole bill', half.save === 500 && half.capHit && half.capCents === 50000 && half.lost === 100,
        JSON.stringify({ s: half.save, cap: half.capCents, lost: half.lost }));
    var dfltBill = C.combineCoupons(Object.assign({ coupons: halfCoupons }, halfOpts, { cashRules: {} }));
    pass('default limit has no %: the same coupons cover more of a small bill', dfltBill.save > 500 && dfltBill.capCents === 300000 && !dfltBill.capHit,
        JSON.stringify({ s: dfltBill.save, cap: dfltBill.capCents, hit: dfltBill.capHit, lost: dfltBill.lost }));
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
    pass('cash rules start at any number, no %, up to HK$3,000',
        C.cashRules().maxCount === 0 && C.cashRules().maxPercent === 0 && C.cashRules().maxAmount === 3000);
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
        /insertBillPaymentRecord\(payRecord, function\(pr\)[\s\S]{0,2200}COUPONS\.onBillFullyPaid\(/.test(apptSrc));
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
    var YE = { zero_policy: 'year_end' };
    var MAN = { zero_policy: 'manual' };
    var eff = C.effectiveExpiry;
    pass('year-end Set zero: a coupon due next year ends 31 Dec of its issue year',
        eff({ expires_on: '2027-01-25', issued_at: '2026-10-26T02:00:00Z' }, YE) === '2026-12-31');
    pass('year-end Set zero: an earlier own date is kept',
        eff({ expires_on: '2026-11-15', issued_at: '2026-08-15T02:00:00Z' }, YE) === '2026-11-15' &&
        eff({ expires_on: '2027-04-10', issued_at: '2027-01-10T02:00:00Z' }, YE) === '2027-04-10');
    pass('year-end Set zero: issue year is the Hong Kong year (1 Jan 01:00 HK counts as the new year)',
        eff({ expires_on: '2027-03-31', issued_at: '2026-12-31T17:00:00Z' }, YE) === '2027-03-31' &&
        eff({ expires_on: '2027-03-31', issued_at: '2026-12-31T15:00:00Z' }, YE) === '2026-12-31');
    pass('year-end Set zero: a coupon without a date gets 31 Dec', eff({ expires_on: null, issued_at: '2026-05-01T00:00:00Z' }, YE) === '2026-12-31');
    pass('manual / life span Set zero: own date unchanged', eff({ expires_on: '2027-01-25', issued_at: '2026-10-26T02:00:00Z' }, MAN) === '2027-01-25' &&
        eff({ expires_on: '2027-01-25', issued_at: '2026-10-26T02:00:00Z' }, { zero_policy: 'lifespan' }) === '2027-01-25');
    var capRows = C.applyZeroExpiry([{ expires_on: '2027-01-25', issued_at: '2026-10-26T02:00:00Z', status: 'unused' }], YE);
    pass('applyZeroExpiry keeps the own date and can switch back', capRows[0].expires_on === '2026-12-31' && capRows[0].own_expires_on === '2027-01-25' &&
        C.applyZeroExpiry(capRows, MAN)[0].expires_on === '2027-01-25');
    pass('capped coupon is no longer live on 1 Jan', C.isLive(C.applyZeroExpiry([{ expires_on: '2027-01-25', issued_at: '2026-10-26T02:00:00Z', status: 'unused' }], YE)[0], '2027-01-01') === false &&
        C.isLive(C.applyZeroExpiry([{ expires_on: '2027-01-25', issued_at: '2026-10-26T02:00:00Z', status: 'unused' }], YE)[0], '2026-12-31') === true);
    pass('desk wallet, bill info and issue notice use the effective date',
        /function loadWallet\(patientId, opts\)[\s\S]{0,1400}freshZeroPolicy\(\)[\s\S]{0,800}applyZeroExpiry\(rows, both\[1\]\)/.test(src) &&
        /earnedQ = SB\.from\('discount_coupons'\)\.select\('[^']*issued_at[^']*'\)[\s\S]{0,900}applyZeroExpiry\(/.test(src) &&
        /coupons\.info\.expires', 'expires'\) \+ ' ' \+\s*effectiveExpiry\(/.test(src));
    var wCap = W.capYearEnd([{ code: 'A', expires_on: '2027-01-25', issued_at: '2026-10-26T02:00:00Z' }, { code: 'B', expires_on: '2026-11-15', issued_at: '2026-08-15T02:00:00Z' }], 'year_end');
    pass('phone wallet caps at 31 Dec of the issue year, keeps earlier dates',
        wCap[0].expires_on === '2026-12-31' && wCap[0].own_expires_on === '2027-01-25' && wCap[1].expires_on === '2026-11-15');
    pass('phone wallet leaves dates alone when Set zero is not year end',
        W.capYearEnd([{ expires_on: '2027-01-25', issued_at: '2026-10-26T02:00:00Z' }], 'manual')[0].expires_on === '2027-01-25');
    var capHtml = W.renderHtml({ ok: true, today: '2026-10-29', campaigns: [], coupons: wCap.map(function (c) { return Object.assign({ campaign_key: 'cash', discount_mode: 'amount', face_value: 50, status: 'unused' }, c); }) }, 'en', false);
    pass('phone wallet ticket shows 31 Dec 2026, not the own 2027 date', capHtml.indexOf('2026-12-31') >= 0 && capHtml.indexOf('2027-01-25') < 0);
    pass('phone wallet reads the Set zero option with the wallet', /setting_key=eq\.coupon_zero_policy/.test(read('wallet.js')) &&
        /capYearEnd\(res\.coupons, zp\)/.test(read('wallet.js')));
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
    pass('wallet: no per-bill line until the database sends the saved cash rules (no fixed HK$3,000)',
        wHtml.indexOf('💳') < 0 && wHtml.indexOf('unless otherwise specified') < 0);
    var wRules = function (rules, lang, data) { return W.renderHtml(Object.assign({}, data || wData, { cash_rules: rules }), lang || 'en', false); };
    pass('wallet: cash coupon per-bill line follows Configuration (%, HK$, count) in the chosen language',
        wRules({ maxCount: 0, maxPercent: 50, maxAmount: 3000 }).indexOf('<p>💳 Cash coupons per bill: at most 50% of the bill, up to HK$3,000.</p></div>') > 0 &&
        wRules({ maxCount: 2, maxPercent: 0, maxAmount: 800 }).indexOf('<p>💳 Cash coupons per bill: at most HK$800. Up to 2 cash coupons per bill.</p>') > 0 &&
        wRules({ maxCount: 0, maxPercent: 25, maxAmount: 0 }, 'zh-Hant').indexOf('<p>💳 每張賬單現金券最多扣減賬單金額 25%。</p>') > 0 &&
        wRules({ maxCount: 3, maxPercent: 0, maxAmount: 0 }, 'zh-CN').indexOf('<p>💳 每张账单最多使用 3 张现金券。</p>') > 0 &&
        wRules({ maxCount: 0, maxPercent: 0, maxAmount: 0 }).indexOf('💳') < 0 &&
        W.cashRuleLines({ limitMode: 'amount', limitValue: 600 }, 'en').join(' ') === 'Cash coupons per bill: at most HK$600.');
    pass('wallet: cash line only when the patient holds a live cash coupon', wRules({ maxPercent: 50, maxAmount: 3000 }, 'en', {
        ok: true, today: '2026-10-27', coupons: [{ code: 'X', campaign_key: 'spend_1', discount_mode: 'amount', face_value: 100, status: 'unused', expires_on: '2027-01-01' }]
    }).indexOf('💳') < 0);
    pass('wallet SQL sends the saved cash rules to the phone', (function () {
        var s = read('discount_coupon_wallet.sql');
        return /setting_value::jsonb -> 'cashRules' into v_cash/.test(s) &&
            /'cash_rules', coalesce\(nullif\(v_cash, 'null'::jsonb\), '\{"maxCount": 0, "maxPercent": 0, "maxAmount": 3000\}'::jsonb\)/.test(s);
    })());
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
        /phoneEl\.value = String\(p\.phone_number \|\| ''\)\.trim\(\)/.test(src) && src.indexOf('QRTOOL.openWith') < 0);
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
        pass('served page has the mass-broadcast loyalty filter',
            idx.body.indexOf('id="mbFilterLoyalty"') >= 0);
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

    console.log('\n=== Coupon writes through database functions (loyalty_security.sql) ===');
    var secSql = read('loyalty_security.sql');
    ['dc_issue_coupon', 'dc_bill_set_coupons', 'dc_bill_release', 'dc_void_earned', 'dc_transfer_coupon', 'dc_expiry_sms_claim',
        'dc_referral_register', 'dc_referral_set', 'loyalty_yearend_claim', 'loyalty_yearend_finish'].forEach(function (fn) {
        pass('SQL defines ' + fn + ' (security definer, granted to anon)',
            new RegExp('create or replace function public\\.' + fn + '\\(').test(secSql) &&
            new RegExp('grant execute on function public\\.' + fn + '\\([^)]*\\) to anon').test(secSql));
    });
    pass('SQL turns off direct writes to the coupon tables',
        /revoke insert, update, delete on public\.discount_coupons from anon, authenticated/.test(secSql) &&
        /revoke insert, update, delete on public\.discount_coupon_referrals from anon, authenticated/.test(secSql) &&
        /revoke insert, update, delete on public\.loyalty_yearend_sms from anon, authenticated/.test(secSql));
    pass('SQL keeps one settings row per key (dedupe + unique key)',
        /delete from public\.program_settings p/.test(secSql) && /create unique index if not exists program_settings_key_clinic_uniq/.test(secSql));
    pass('SQL staff password check is not callable from the browser',
        /revoke all on function public\.dc_check_staff\(text, text\) from public, anon, authenticated/.test(secSql));
    pass('SQL campaign defaults match CAMPAIGN_DEFS (referral ladder, spend targets, holds)',
        /"referral":\s*\{[^}]*"minFirstSpend":500,"refPercent":10,"refMax":1000,"refStep":10/.test(secSql) &&
        /"spend_1":\s*\{[^}]*"face":100,"target":1000/.test(secSql) && /"spend_3":\s*\{[^}]*"face":1000,"target":10000/.test(secSql) &&
        /key: 'referral'[^}]*minFirst: 500, refPercent: 10, refMax: 1000, refStep: 10/.test(src));

    var pgRun = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'loyalty-security-sql-test.js')], { encoding: 'utf8', timeout: 120000 });
    var pgOut = String(pgRun.stdout || '') + String(pgRun.stderr || '');
    if (/^SKIP/m.test(pgOut)) {
        pass('SQL run on in-memory Postgres (PGlite not installed: skipped)', true);
    } else {
        var pgSum = pgOut.match(/(\d+) passed, (\d+) failed/);
        pass('SQL run on in-memory Postgres: every rule check passes', pgRun.status === 0 && pgSum && pgSum[2] === '0',
            pgSum ? pgSum[0] : pgOut.slice(-400));
    }

    var wr = { rpc: [], from: [], mode: 'missing', reply: null, bills: [], coupons: [] };
    function wrQuery(table) {
        var q = { _t: table, _op: 'select', _body: null, _eq: [] };
        ['select', 'eq', 'is', 'in', 'or', 'order', 'limit', 'lt', 'gt', 'lte', 'gte'].forEach(function (m) {
            q[m] = function (a, b) { if (m === 'eq') q._eq.push([a, b]); return q; };
        });
        q.insert = function (rows) { q._op = 'insert'; q._body = rows; return q; };
        q.update = function (b) { q._op = 'update'; q._body = b; return q; };
        q.delete = function () { q._op = 'delete'; return q; };
        q.maybeSingle = function () { return Promise.resolve({ data: { phone_number: '91234567', full_name: 'NG PUI CHING' }, error: null }); };
        q.then = function (res, rej) {
            wr.from.push({ t: table, op: q._op, body: q._body, eq: q._eq });
            var data = q._op === 'insert' ? (q._body || []).map(function (r, i) { return Object.assign({ id: 'new-' + i }, r); }) : [];
            return Promise.resolve({ data: data, error: null }).then(res, rej);
        };
        return q;
    }
    var wrCtx = {
        console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
        localStorage: { getItem: function () { return null; }, setItem: function () {} },
        SB: {
            from: wrQuery,
            rpc: function (fn, args) {
                wr.rpc.push({ fn: fn, args: args });
                if (/wallet_link$/.test(fn)) return Promise.resolve({ data: null, error: { message: 'Could not find the function public.' + fn } });
                if (wr.mode === 'missing') return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.' + fn + ' in the schema cache' } });
                if (wr.mode === 'error') return Promise.resolve({ data: null, error: { code: '22P02', message: 'invalid input syntax for type uuid' } });
                return Promise.resolve({ data: typeof wr.reply === 'function' ? wr.reply(fn, args) : wr.reply, error: null });
            }
        }
    };
    var wrSms = [];
    wrCtx.AIHELPER = { sendTwilioOutreach: function (o) { wrSms.push(o); return Promise.resolve({ ok: true }); } };
    wrCtx.window = wrCtx;
    wrCtx.document = {
        getElementById: function () { return null; }, querySelector: function () { return null; },
        querySelectorAll: function () { return []; }, createElement: function () { return { style: {}, setAttribute: function () {}, appendChild: function () {} }; },
        head: { appendChild: function () {} }, body: { appendChild: function () {} }
    };
    vm.createContext(wrCtx);
    vm.runInContext(src, wrCtx, { filename: 'app-coupons.js' });
    var WC = wrCtx.COUPONS;
    var wrRow = { code: 'DC-LOCAL', campaign_key: 'spend_1', patient_id: 'pt-001003', face_value: 100, discount_mode: 'amount',
        status: 'unused', expires_on: '2027-04-27', clinic_code: 'KT', origin_bill_id: 'bill-1' };

    var miss = await WC.dcWrite('dc_issue_coupon', { p_kind: 'spend' }, function () { return { ok: true, legacy: 1 }; });
    var miss2 = await WC.dcWrite('dc_issue_coupon', { p_kind: 'spend' }, function () { return { ok: true, legacy: 2 }; });
    pass('before the SQL is run: falls back to the old write, and stops asking after the first miss',
        miss.ok && miss.legacy === 1 && miss2.legacy === 2 && wr.rpc.filter(function (c) { return c.fn === 'dc_issue_coupon'; }).length === 1,
        JSON.stringify(wr.rpc));
    pass('missing-function detection: PGRST202 / schema cache / 42883 only',
        WC.dcFnMissing({ code: 'PGRST202' }, 'x') && WC.dcFnMissing({ message: 'Could not find the function public.dc_bill_release in the schema cache' }, 'dc_bill_release') &&
        WC.dcFnMissing({ code: '42883', message: 'function does not exist' }, 'y') && !WC.dcFnMissing({ code: '22P02', message: 'bad uuid' }, 'dc_bill_release'));

    vm.runInContext(src, wrCtx, { filename: 'app-coupons.js' });
    WC = wrCtx.COUPONS;
    wr.mode = 'error';
    var dbErr = await WC.dcWrite('dc_bill_release', { p_bill_id: 'b' }, function () { throw new Error('fallback must not run'); });
    pass('a real database error is reported, the old write is not tried', !dbErr.ok && dbErr.reason === 'db' && /uuid/.test(dbErr.error), JSON.stringify(dbErr));

    wr.mode = 'ok';
    wr.rpc = []; wr.from = []; wrSms.length = 0;
    wr.reply = function (fn, a) {
        if (fn !== 'dc_issue_coupon') return { ok: true };
        return { ok: true, id: 'srv-1', code: 'DC-SRV001', row: Object.assign({}, wrRow, { id: 'srv-1', code: 'DC-SRV001', face_value: 230, expires_on: '2027-04-27' }) };
    };
    var srvIssue = await WC.insertCoupon(Object.assign({}, wrRow, { campaign_key: 'referral', face_value: 999 }), true, null,
        { kind: 'referral', billId: 'bill-1', referralId: 'ref-1' });
    await new Promise(function (r) { setTimeout(r, 30); });
    var issueCall = wr.rpc.filter(function (c) { return c.fn === 'dc_issue_coupon'; })[0];
    pass('issue goes through dc_issue_coupon with the bill and referral, no direct insert',
        srvIssue.ok && srvIssue.viaDb && issueCall && issueCall.args.p_kind === 'referral' && issueCall.args.p_bill_id === 'bill-1' &&
        issueCall.args.p_referral_id === 'ref-1' && !wr.from.some(function (f) { return f.t === 'discount_coupons' && f.op !== 'select'; }),
        JSON.stringify({ srvIssue: srvIssue, from: wr.from }));
    pass('the server\u2019s value and code are used (not the desk\u2019s)', srvIssue.code === 'DC-SRV001' && srvIssue.row.face_value === 230 &&
        wrSms.length === 1 && wrSms[0].body.indexOf('DC-SRV001') >= 0 && wrSms[0].body.indexOf('230') >= 0,
        JSON.stringify(wrSms.map(function (s) { return s.body; })));

    wr.reply = { ok: false, reason: 'wait_full' };
    var refused = await WC.insertCoupon(Object.assign({}, wrRow), true, null, { kind: 'spend', billId: 'bill-1' });
    pass('server refusal comes back with its reason; nothing written, no SMS', !refused.ok && refused.reason === 'wait_full' && wrSms.length === 1,
        JSON.stringify(refused));

    var grantor = { user_id: 'drchan', role: 'doctor' };
    Object.defineProperty(grantor, '__pw', { value: 'secret', enumerable: false });
    wr.rpc = [];
    wr.reply = { ok: true, id: 'g1', code: 'DC-G1', row: Object.assign({}, wrRow, { campaign_key: 'cash', face_value: 150 }) };
    await WC.insertCoupon(Object.assign({}, wrRow, { campaign_key: 'cash' }), false, null, { kind: 'gift', amount: 150, grantor: grantor });
    var giftArgs = wr.rpc[0] && wr.rpc[0].args;
    pass('gift sends the giver\u2019s own login + password for the server check, password never in JSON',
        giftArgs && giftArgs.p_user === 'drchan' && giftArgs.p_password === 'secret' && giftArgs.p_amount === 150 &&
        JSON.stringify(grantor).indexOf('secret') < 0, JSON.stringify(giftArgs && Object.assign({}, giftArgs, { p_password: '***' })));
    pass('verifyGrantor keeps the password hidden on the login row',
        /Object\.defineProperty\(u, '__pw', \{ value: pw, enumerable: false \}\)/.test(src));

    wr.rpc = []; wr.from = [];
    wr.reply = { ok: false, reason: 'expired' };
    var wrBill = { id: 'bill-9', patient_id: 'pt-001003', subtotal: 500, discount: 0, amount_paid: 0, total: 500, balance: 500, status: 'Pending' };
    var badApply = await WC.applyToBill(wrBill, { rows: [{ coupon: { id: 'c1', campaign_key: 'cash', discount_mode: 'amount', face_value: 100 }, assess: { save: 100 } }] }, 'KT');
    pass('coupon refused by the server: bill total untouched, nothing saved to the bill',
        badApply.ok === false && badApply.reason === 'expired' && wrBill.total === 500 && wrBill.balance === 500 &&
        !wr.from.some(function (f) { return f.t === 'bills'; }), JSON.stringify({ badApply: badApply, from: wr.from }));
    wr.reply = { ok: true, count: 1, amount: 100 };
    wr.from = [];
    var goodApply = await WC.applyToBill(wrBill, { rows: [{ coupon: { id: 'c1', campaign_key: 'cash', discount_mode: 'amount', face_value: 100 }, assess: { save: 100, lineName: null } }] }, 'KT');
    var setCall = wr.rpc.filter(function (c) { return c.fn === 'dc_bill_set_coupons'; }).pop();
    pass('coupon accepted: one dc_bill_set_coupons call, then the bill total HK$400',
        goodApply.ok && setCall && setCall.args.p_items.length === 1 && setCall.args.p_items[0].amount === 100 &&
        wrBill.total === 400 && wrBill.balance === 400 && wr.from.some(function (f) { return f.t === 'bills' && f.op === 'update'; }) &&
        !wr.from.some(function (f) { return f.t === 'discount_coupons' && f.op === 'update'; }), JSON.stringify({ setCall: setCall, from: wr.from }));

    wr.rpc = [];
    wr.reply = { ok: true, count: 2 };
    await WC.releaseBillCoupons('bill-9', ['c1', 'c2']);
    await WC.voidEarnedCoupons('bill-9', ['e1'], 'Voided with payment');
    var vNone = await WC.voidEarnedCoupons('bill-9', [], 'x');
    pass('bill void / payment void go through dc_bill_release and dc_void_earned',
        wr.rpc[0].fn === 'dc_bill_release' && wr.rpc[0].args.p_coupon_ids.join() === 'c1,c2' &&
        wr.rpc[1].fn === 'dc_void_earned' && wr.rpc[1].args.p_note === 'Voided with payment' && vNone.ok && wr.rpc.length === 2,
        JSON.stringify(wr.rpc));

    wr.rpc = [];
    wr.reply = function (fn) { return fn === 'loyalty_yearend_claim' ? [11, 12] : 1; };
    var yIds = await WC.claimYearEndSms('coupons', 2026, 'month', ['p:a', 'p:b'], 'pt');
    await WC.finishYearEndSms(yIds, { ok: false, reason: 'twilio' });
    pass('year-end claim / give back through loyalty_yearend_claim / loyalty_yearend_finish',
        yIds && yIds.join() === '11,12' && wr.rpc[1].fn === 'loyalty_yearend_finish' && wr.rpc[1].args.p_status === 'release', JSON.stringify(wr.rpc));
    wr.reply = function () { return null; };
    pass('year-end claim already taken by another station → null', (await WC.claimYearEndSms('coupons', 2026, 'month', ['p:a'], 'pt')) === null);

    var directWrites = 0;
    var unguarded = [];
    src.replace(/SB\.from\((?:'discount_coupons'|REF_TABLE|YEAR_END_SMS_TABLE)\)\s*\.(?:insert|update|delete)\([^\n]*/g, function (m, idx) {
        directWrites++;
        var before = src.slice(Math.max(0, idx - 1600), idx);
        if (!/dcWrite\(|setReferral\(|function releaseCouponsOnBill|function finishReferral/.test(before)) unguarded.push(m.slice(0, 80));
        return m;
    });
    pass('every coupon / referral / year-end table write is a fallback behind a database function',
        directWrites > 0 && unguarded.length === 0, unguarded.join(' | '));

    console.log('\n=== Loyalty jobs in the database (loyalty_jobs.sql) ===');
    var jobsSql = read('loyalty_jobs.sql');
    pass('jobs SQL: Set zero 00:05 HK (16:05 UTC), SMS 10:00 HK (02:00 UTC), replies every 5 minutes',
        /cron\.schedule\('loyalty-set-zero', '5 16 \* \* \*', 'select public\.loyalty_run_zero\(\)'\)/.test(jobsSql) &&
        /cron\.schedule\('loyalty-daily-sms', '0 2 \* \* \*', 'select public\.loyalty_run_daily_sms\(\)'\)/.test(jobsSql) &&
        /cron\.schedule\('loyalty-sms-settle', '\*\/5 \* \* \* \*', 'select public\.loyalty_sms_settle\(\)'\)/.test(jobsSql));
    pass('jobs SQL: sends through this project\u2019s twilio-whatsapp function',
        jobsSql.indexOf(readSbConfig(read('app.js')).url.replace(/\/$/, '') + '/functions/v1/twilio-whatsapp') >= 0 && jobsSql.indexOf('__SB_') < 0);
    pass('jobs SQL: browser cannot start the jobs or read the anon key / SMS bodies',
        /revoke all on function public\.loyalty_run_daily_sms\(date, boolean\) from public, anon, authenticated/.test(jobsSql) &&
        /revoke all on function public\.loyalty_run_zero\(timestamptz\) from public, anon, authenticated/.test(jobsSql) &&
        /grant select \(id, zero_on, sms_on, sms_user_id, updated_at\) on public\.loyalty_job_config/.test(jobsSql));
    var jobRun = require('child_process').spawnSync(process.execPath, [path.join(__dirname, 'loyalty-jobs-sql-test.js')], { encoding: 'utf8', timeout: 120000 });
    var jobOut = String(jobRun.stdout || '') + String(jobRun.stderr || '');
    if (/^SKIP/m.test(jobOut)) {
        pass('jobs SQL on in-memory Postgres (PGlite not installed: skipped)', true);
    } else {
        var jobSum = jobOut.match(/(\d+) passed, (\d+) failed/);
        pass('jobs SQL on in-memory Postgres: Set zero, SMS text = desk text, claims, replies all pass', jobRun.status === 0 && jobSum && jobSum[2] === '0',
            jobSum ? jobSum[0] : jobOut.slice(-600));
    }
    pass('desk backup plan: not set up → run; database ran → skip; before 11:00 → wait; after → run',
        WC.deskSmsBackupPlan({ on: false }, 9) === 'run' && WC.deskSmsBackupPlan({ on: true, ran: true }, 15) === 'skip' &&
        WC.deskSmsBackupPlan({ on: true, ran: false }, 10) === 'wait' && WC.deskSmsBackupPlan({ on: true, ran: false }, 11) === 'run');
    function jobCtx(cfgRow, runRows) {
        var store = {};
        var ctx = {
            console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
            localStorage: { getItem: function (k) { return store[k] || null; }, setItem: function (k, v) { store[k] = v; } },
            SB: { from: function (t) {
                var q = { select: function () { return q; }, eq: function () { return q; }, limit: function () { return q; },
                    maybeSingle: function () { return Promise.resolve(t === 'loyalty_job_config' ? cfgRow : { data: null, error: null }); },
                    then: function (res, rej) { return Promise.resolve(runRows).then(res, rej); } };
                return q;
            } }
        };
        ctx.window = ctx;
        vm.createContext(ctx);
        vm.runInContext(src, ctx, { filename: 'app-coupons.js' });
        ctx.__store = store;
        return ctx;
    }
    var jNo = jobCtx({ data: null, error: { code: 'PGRST205', message: 'Could not find the table public.loyalty_job_config' } }, { data: null, error: { code: 'PGRST205' } });
    var jNoSent = 0;
    var jNoRes = await jNo.COUPONS.runDeskSmsBackup('k1', function () { jNoSent++; return { ok: true }; });
    pass('desk backup before the jobs SQL: the desk sends as today and marks the day', jNoSent === 1 && jNoRes.ok && jNo.__store.k1 === jNo.COUPONS.todayIso());
    var jRan = jobCtx({ data: { sms_on: true }, error: null }, { data: [{ id: 7 }], error: null });
    var jRanSent = 0;
    var jRanRes = await jRan.COUPONS.runDeskSmsBackup('k2', function () { jRanSent++; return { ok: true }; });
    pass('desk backup after the database ran today: nothing sent, day marked', jRanSent === 0 && jRanRes.skipped === 'db_job_ran' && !!jRan.__store.k2);
    var jOff = jobCtx({ data: { sms_on: false }, error: null }, { data: [], error: null });
    var jOffSent = 0;
    await jOff.COUPONS.runDeskSmsBackup('k3', function () { jOffSent++; return { ok: true }; });
    pass('database SMS switched off: the desk sends', jOffSent === 1);
    pass('coupon and points schedulers both go through the desk backup',
        /runDeskSmsBackup\(EXPIRY_RUN_KEY, function \(\) \{ return sendExpiryReminders\(\); \}\)/.test(src) &&
        /COUPONS\.runDeskSmsBackup\(YEAR_END_RUN_KEY, function \(\) \{ return sendYearEndPointsReminders\(\); \}\)/.test(read('app-rewards.js')));
    pass('wallet order is fixed (issue time, then code) so the SMS list matches the database SMS',
        /var rows = both\[0\]\.slice\(\)\.sort\(function \(a, b\) \{\s*return String\(a\.issued_at \|\| ''\)\.localeCompare/.test(src) &&
        /order by coalesce\(public\.dc_eff_expiry\(c\.expires_on, c\.issued_at, p_policy\), '9999-12-31'::date\), c\.issued_at, c\.code/.test(jobsSql));

    console.log('\n=== Loyalty reports (Reports → Coupons & points) ===');
    var lyrSrc = read('app-loyalty-report.js');
    pass('node --check app-loyalty-report.js', (function () {
        try { child_process.execFileSync(process.execPath, ['--check', path.join(root, 'app-loyalty-report.js')], { stdio: 'pipe' }); return true; } catch (e) { return false; }
    })());
    var lyrCtx = { console: console };
    lyrCtx.window = lyrCtx;
    vm.createContext(lyrCtx);
    vm.runInContext(src + '\n' + lyrSrc + '\nthis.L = LOYALTY_REPORT; this.C = COUPONS;', lyrCtx, { filename: 'loyalty-report' });
    var LR = lyrCtx.L;
    var lyrCoupons = [
        { id: 'a', campaign_key: 'spend_1', clinic_code: 'KT', face_value: 100, status: 'unused', expires_on: '2027-03-01', issued_at: '2026-10-01T02:00:00Z' },
        { id: 'b', campaign_key: 'spend_1', clinic_code: 'KT', face_value: 100, status: 'used', redeemed_amount: 100, redeemed_at: '2026-10-20T17:00:00Z', bill_id: 'B1', issued_at: '2026-10-02T02:00:00Z' },
        { id: 'c', campaign_key: 'pct', clinic_code: 'PL', discount_mode: 'percent', face_value: 0, status: 'unused', expires_on: null, issued_at: '2026-10-03T02:00:00Z' },
        { id: 'd', campaign_key: 'spend_1', clinic_code: 'KT', face_value: 100, status: 'unused', expires_on: '2026-10-01', issued_at: '2026-09-01T02:00:00Z' },
        { id: 'e', campaign_key: 'referral', clinic_code: 'KT', face_value: 230, status: 'unused', expires_on: '2027-01-01', issued_at: '2026-10-05T02:00:00Z' },
        { id: 'f', campaign_key: 'spend_1', clinic_code: 'KT', face_value: 100, status: 'void', issued_at: '2026-10-06T02:00:00Z' }
    ];
    var lyrOut = LR.outstanding(lyrCoupons, [{ clinic_code: 'KT', balance: 50 }, { clinic_code: 'PL', balance: 0 }, { clinic_code: 'kt', balance: 25.5 }], { today: '2026-10-30' });
    pass('unused value: live coupons + unspent points per clinic; expired, used, cancelled and % value left out',
        lyrOut.rows.length === 2 && lyrOut.rows[0].clinic === 'KT' && lyrOut.rows[0].coupons === 2 && lyrOut.rows[0].coupon_value === 330 &&
        lyrOut.rows[0].points_people === 2 && lyrOut.rows[0].points === 75.5 && lyrOut.rows[0].total === 405.5 &&
        lyrOut.rows[1].percent_coupons === 1 && lyrOut.rows[1].coupon_value === 0 && lyrOut.total.total === 405.5, JSON.stringify(lyrOut));
    var lyrYe = LR.outstanding(lyrCoupons, [], { today: '2027-01-02', policy: { zero_policy: 'year_end' } });
    pass('unused value follows Set zero: 31 Dec cap ends 2026 coupons on 1 Jan', lyrYe.rows.filter(function (r) { return r.clinic === 'KT'; }).length === 0, JSON.stringify(lyrYe));
    var lyrOneClinic = LR.outstanding(lyrCoupons, [{ clinic_code: 'KT', balance: 50 }], { today: '2026-10-30', clinic: 'pl' });
    pass('unused value: one clinic picked shows only that clinic', lyrOneClinic.rows.length === 1 && lyrOneClinic.rows[0].clinic === 'PL');
    var lyrCamp = LR.campaigns(lyrCoupons, { from: '2026-10-01', to: '2026-10-31', today: '2026-10-30', label: function (k) { return 'N:' + k; } });
    var lyrS1 = lyrCamp.filter(function (r) { return r.key === 'spend_1'; })[0];
    pass('issued vs used: per coupon, issued in the period, use rate and value used',
        lyrS1 && lyrS1.name === 'N:spend_1' && lyrS1.issued === 3 && lyrS1.used === 1 && lyrS1.used_value === 100 && lyrS1.live === 1 &&
        lyrS1.voided === 1 && lyrS1.expired === 0 && lyrS1.use_rate === 33.3 && lyrS1.issued_value === 300 && lyrCamp[0].key === 'spend_1', JSON.stringify(lyrCamp));
    var lyrRef = LR.referrals([
        { created_at: '2026-10-04T01:00:00Z', clinic_code: 'KT', status: 'issued', reward_kind: 'coupon', coupon_id: 'e', referred_patient_id: 'F' },
        { created_at: '2026-10-04T01:00:00Z', clinic_code: 'KT', status: 'issued', reward_kind: 'points', points: 100, referred_patient_id: 'G' },
        { created_at: '2026-10-04', clinic_code: 'KT', status: 'pending', referred_patient_id: 'H' },
        { created_at: '2026-10-04', clinic_code: 'KT', status: 'void', referred_patient_id: 'I' },
        { created_at: '2026-08-04', clinic_code: 'KT', status: 'issued', reward_kind: 'points', points: 999, referred_patient_id: 'J' }
    ], [{ patient_id: 'F', amount_paid: 2300 }, { patient_id: 'G', amount_paid: 1000 }, { patient_id: 'G', amount_paid: 999, voided_at: 'x' }, { patient_id: 'I', amount_paid: 500 }],
    lyrCoupons, { from: '2026-10-01', to: '2026-10-31' });
    pass('referral return: friends\u2019 paid bills vs coupon + points bonus; cancelled and older referrals left out',
        lyrRef.length === 1 && lyrRef[0].referred === 4 && lyrRef[0].rewarded === 2 && lyrRef[0].waiting === 1 && lyrRef[0].voided === 1 &&
        lyrRef[0].friend_spend === 3300 && lyrRef[0].bonus_coupons === 230 && lyrRef[0].bonus_points === 100 && lyrRef[0].return_x === 10, JSON.stringify(lyrRef));
    var lyrBill = LR.perBill(lyrCoupons, [
        { kind: 'redeem', points: -25, bill_id: 'B1', created_at: '2026-10-21T03:00:00Z' },
        { kind: 'redeem', points: -40, bill_id: 'B2', created_at: '2026-10-21T03:00:00Z' },
        { kind: 'void_redeem', points: 40, bill_id: 'B2', created_at: '2026-10-22T03:00:00Z' },
        { kind: 'earn', points: 90, bill_id: 'B1', created_at: '2026-10-21T03:00:00Z' }
    ], [{ id: 'B1', bill_date: '2026-10-21', total: 875, amount_paid: 800, balance: 75, patient_no: '001003', patient_name: 'NG PUI CHING' },
        { id: 'B2', bill_date: '2026-10-21', total: 100, amount_paid: 100, balance: 0 }], { from: '2026-10-01', to: '2026-10-31' });
    var lb = lyrBill.rows[0];
    pass('per bill: before coupons = coupons + points + paid (income) + balance; HK date of use; voided points netted',
        lyrBill.rows.length === 1 && lb.date === '2026-10-21' && lb.coupon === 100 && lb.points === 25 && lb.paid === 775 && lb.balance === 75 &&
        lb.before === 975 && Math.abs(lb.coupon + lb.points + lb.paid + lb.balance - lb.before) < 0.01 &&
        lyrBill.byDay['2026-10-21'].coupon === 100 && lyrBill.byDay['2026-10-21'].points === 65 && lyrBill.byDay['2026-10-22'].points === -40, JSON.stringify(lyrBill));
    pass('per bill: a voided bill drops out', LR.perBill(lyrCoupons, [], [{ id: 'B1', total: 875, voided_at: '2026-10-22' }], {}).rows.length === 0);
    var lyrModel = { outstanding: lyrOut, campaigns: lyrCamp, referrals: lyrRef, bills: lyrBill };
    var lyrHtml = LR.html(lyrModel, { from: '2026-10-01', to: '2026-10-30', today: '2026-10-30', viewMonth: '2026-10' });
    pass('report page: four sections, totals row, money right-aligned, text escaped',
        (lyrHtml.match(/class="lyr-sec"/g) || []).length === 4 && /<tfoot>/.test(lyrHtml) && /class="lyr-num">HK\$405\.50</.test(lyrHtml) &&
        LR.html({ outstanding: { rows: [], total: {} }, campaigns: [{ name: '<b>x', issued: 1 }], referrals: [], bills: { rows: [] } }).indexOf('&lt;b&gt;x') >= 0);
    var lyrCal = LR.calHtml({ from: '2026-10-01', to: '2026-10-15', today: '2026-10-30', viewMonth: '2026-10' });
    pass('loyalty report mini-calendar sits on the content panel with the selected range marked',
        /class="lyr-cal"/.test(lyrHtml) && /data-lyr-day="2026-10-01"/.test(lyrCal) &&
        /class="[^"]*is-from[^"]*" data-lyr-day="2026-10-01"/.test(lyrCal) &&
        /class="[^"]*is-to[^"]*" data-lyr-day="2026-10-15"/.test(lyrCal) &&
        /class="[^"]*is-in[^"]*" data-lyr-day="2026-10-08"/.test(lyrCal) &&
        /data-lyr-preset="ytd"/.test(lyrCal));
    var lyrTap1 = LR.calClickDay({ from: '2026-01-01', to: '2026-10-30', today: '2026-10-30' }, '2026-10-12');
    var lyrTap2 = LR.calClickDay(lyrTap1, '2026-10-20');
    var lyrYtd = LR.calPreset('ytd', '2026-10-30');
    var lyrMon = LR.calPreset('month', '2026-10-30');
    pass('mini-calendar: first tap is that day, second tap sets the end, presets jump the range',
        lyrTap1.from === '2026-10-12' && lyrTap1.to === '2026-10-12' && lyrTap1.pick === '2026-10-12' &&
        lyrTap2.from === '2026-10-12' && lyrTap2.to === '2026-10-20' && lyrTap2.pick === '' &&
        lyrYtd.from === '2026-01-01' && lyrYtd.to === '2026-10-30' &&
        lyrMon.from === '2026-10-01' && lyrMon.to === '2026-10-30');
    var lyrCsv = LR.csvRows(lyrModel);
    pass('CSV: every line has the same columns, first is the section',
        lyrCsv.length === 2 + lyrCamp.length + 1 + 1 && Object.keys(lyrCsv[0])[0] === 'section' &&
        lyrCsv.every(function (r) { return Object.keys(r).join() === Object.keys(lyrCsv[0]).join(); }));
    var rptSrc = read('app-report.js');
    pass('Reports: Loyalty tab loads the report with the clinic filter and bill lookups',
        /_tab === 'loyalty'[\s\S]{0,900}LOYALTY_REPORT\.render\(null, \{[\s\S]{0,300}fetchBills: loadBillsByIdsRaw,\s*filterBills: filterBillsForReportClinic/.test(rptSrc) &&
        /tabKey === 'loyalty'[\s\S]{0,220}-01-01', tl\)/.test(rptSrc));
    pass('Reports: Loyalty content binds the mini-calendar and a tap refreshes From / To',
        /LOYALTY_REPORT\.bindCal\(/.test(rptSrc) && /_loyaltyCalPick/.test(rptSrc) &&
        /setDateInputs\(r\.from, r\.to\)/.test(rptSrc) && /data-lyr-preset/.test(lyrSrc));
    pass('Daily income: coupons and points used shown beside cash (not income)',
        /LOYALTY_REPORT\.usedByDay\(from, to,[\s\S]{0,1400}report\.col\.couponsNotIncome[\s\S]{0,120}report\.col\.pointsNotIncome/.test(rptSrc));
    var lyrIdx = read('index.html');
    pass('index.html: Loyalty tab button, report script before app-report.js',
        /data-rpt="loyalty" onclick="REPORT\.switchTab\('loyalty'\)" data-i18n="report\.tab\.loyalty"/.test(lyrIdx) &&
        /'app-loyalty-report\.js\?v=[^']+',\s*'app-report\.js\?v=/.test(lyrIdx));
    var i18nSrc = read('app-i18n-extra.js');
    var lyrKeys = (lyrSrc.match(/tt\('loyaltyReport\.[^']+'/g) || []).map(function (s) { return s.slice(4, -1); })
        .concat(['report.tab.loyalty', 'report.tabGroup.loyalty', 'report.title.loyalty', 'report.hint.loyalty', 'report.col.couponsNotIncome', 'report.col.pointsNotIncome']);
    var lyrMissing = lyrKeys.filter(function (k) {
        var re = new RegExp("'" + k.replace(/\./g, '\\.') + "': \\{[\\s\\S]{0,40}en: [\\s\\S]{0,400}'zh-CN': [\\s\\S]{0,200}'zh-Hant': ");
        return !re.test(i18nSrc);
    });
    pass('every report label has English, Simplified and Traditional Chinese', lyrKeys.length > 30 && lyrMissing.length === 0, lyrMissing.join(', '));
    pass('report CSS in style-coupons.css',
        /\.lyr-table \.lyr-num \{/.test(read('style-coupons.css')) &&
        /\.lyr-cal \{/.test(read('style-coupons.css')) &&
        /\.lyr-cal-day\.is-from/.test(read('style-coupons.css')));

    console.log('\n=== One phone page for points + coupons, combined checkout hint ===');
    var LC = lyrCtx.C;
    lyrCtx.isLoyaltyExcludedPayMethod = function (m) { return /^(PDCC|Government|CCF)$/i.test(String(m || '').trim()); };
    var TOK_C = 'c'.repeat(32);
    var TOK_P = 'a'.repeat(32);
    pass('one link: loyalty.html?c=<coupon token>&p=<points token>; either may be missing',
        LC.loyaltyUrl(TOK_C, TOK_P, 'https://x.example/app/loyalty.html') === 'https://x.example/app/loyalty.html?c=' + TOK_C + '&p=' + TOK_P &&
        LC.loyaltyUrl('', TOK_P, 'https://x.example/loyalty.html') === 'https://x.example/loyalty.html?p=' + TOK_P &&
        LC.loyaltyUrl(TOK_C, '', 'https://x.example/loyalty.html') === 'https://x.example/loyalty.html?c=' + TOK_C);
    function lyLinkCtx(replies) {
        var calls = [];
        var ctx = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, location: { href: 'https://x.example/app/index.html' },
            localStorage: { getItem: function () { return null; }, setItem: function () {} },
            SB: { rpc: function (fn, args) { calls.push({ fn: fn, reset: args.p_reset }); return Promise.resolve(replies[fn]); }, from: function () { return {}; } } };
        ctx.window = ctx;
        vm.createContext(ctx);
        vm.runInContext(src, ctx, { filename: 'app-coupons.js' });
        ctx.__calls = calls;
        return ctx;
    }
    var noFn = function (fn) { return { data: null, error: { message: 'Could not find the function public.' + fn + ' in the schema cache' } }; };
    var lkBoth = lyLinkCtx({ dc_wallet_link: { data: { ok: true, token: TOK_C } }, rw_wallet_link: { data: { ok: true, token: TOK_P } } });
    var lkBothRes = await lkBoth.COUPONS.loyaltyLink('p1', false);
    pass('one link asks both schemes for the existing tokens (no reset)', lkBothRes.ok && lkBothRes.url === 'https://x.example/app/loyalty.html?c=' + TOK_C + '&p=' + TOK_P &&
        lkBoth.__calls.length === 2 && lkBoth.__calls.every(function (c) { return c.reset === false; }), JSON.stringify(lkBothRes));
    var lkPts = lyLinkCtx({ dc_wallet_link: noFn('dc_wallet_link'), rw_wallet_link: { data: { ok: true, token: TOK_P } } });
    var lkPtsRes = await lkPts.COUPONS.loyaltyLink('p1', true);
    pass('one link still works when only the points SQL is run; New QR resets both', lkPtsRes.ok && lkPtsRes.points && !lkPtsRes.coupons &&
        /loyalty\.html\?p=a{32}$/.test(lkPtsRes.url) && lkPts.__calls.every(function (c) { return c.reset === true; }));
    var lkNone = lyLinkCtx({ dc_wallet_link: noFn('dc_wallet_link'), rw_wallet_link: noFn('rw_wallet_link') });
    var lkNoneRes = await lkNone.COUPONS.loyaltyLink('p1', false);
    pass('one link with neither SQL run: "not set up"', lkNoneRes.ok === false && lkNoneRes.reason === 'no_sql');
    var lkWa = LC.loyaltyWhatsAppText('https://x/l.html?c=1', { chinese_name: '吳佩貞', full_name: 'NG PUI CHING' });
    pass('one link WhatsApp: names, both words, the link, do-not-share',
        /吳佩貞 你好！.*積分及優惠券/.test(lkWa) && /Hi NG PUI CHING! .*reward points and coupons/.test(lkWa) && /https:\/\/x\/l\.html\?c=1/.test(lkWa) && /Please do not share/.test(lkWa));
    var lqCfg = LC.loyaltyQrConfig();
    pass('one QR box: own slip heading, PNG name, link maker', lqCfg.scheme === 'loyalty' && typeof lqCfg.makeUrl === 'function' &&
        lqCfg.pngName === 'points-and-coupons-qr.png' && /My points & coupons/.test(lqCfg.slip.heading));
    pass('combined checkout hint: cash payment shows points earned at the scheme rate',
        LC.pointsEarnText(1200, 10, 'Cash') === '⭐ Paying HK$1200.00 earns about 120.00 reward points' &&
        LC.pointsEarnText(333.33, 5, '') === '⭐ Paying HK$333.33 earns about 16.67 reward points');
    pass('combined checkout hint: no points line for reward points, balance transfer, Government, PDCC, CCF, or HK$0',
        LC.pointsEarnText(1200, 10, 'Reward Points') === '' && LC.pointsEarnText(1200, 10, 'PDCC') === '' &&
        LC.pointsEarnText(1200, 10, 'Government') === '' && LC.pointsEarnText(1200, 10, 'CCF') === '' &&
        LC.pointsEarnText(0, 10, 'Cash') === '' && LC.pointsEarnText(100, 0, 'Cash') === '');
    pass('checkout hint: coupon part and points part drawn together (points line async, newest wins)',
        /var couponHtml = couponHintHtml\(total, paid, method\);[\s\S]{0,200}checkoutPointsLine\(total, paid, method\)\.then[\s\S]{0,120}seq !== _hintSeq/.test(src) &&
        /REWARDS\.currentClinicJoined\(doctor\), REWARDS\.earnRatePercent\(\)/.test(src));

    var phCtx = { console: console, setTimeout: setTimeout };
    phCtx.window = phCtx;
    vm.createContext(phCtx);
    vm.runInContext(read('wallet.js') + '\n' + read('points.js') + '\n' + read('loyalty.js'), phCtx, { filename: 'phone-pages' });
    var LY = phCtx.CSLoyalty;
    pass('node --check loyalty.js', (function () {
        try { child_process.execFileSync(process.execPath, ['--check', path.join(root, 'loyalty.js')], { stdio: 'pipe' }); return true; } catch (e) { return false; }
    })());
    var lyTk = LY.tokensFrom({ search: '?c=' + TOK_C.toUpperCase() + '&p=' + TOK_P, hash: '' });
    pass('phone page reads both tokens; opens Points first, ?tab=coupons switches; a tab without its token cannot open',
        lyTk.c === TOK_C && lyTk.p === TOK_P && LY.pickTab({ search: '' }, lyTk) === 'points' &&
        LY.pickTab({ search: '', hash: '#tab=coupons' }, lyTk) === 'coupons' &&
        LY.pickTab({ search: '?tab=points' }, { c: TOK_C, p: '' }) === 'coupons');
    var lyState = {
        tokens: lyTk, tab: 'points',
        points: { ok: true, name: 'N***', balance: 1234.5, rows: [{ kind: 'earn', points: 120, at: '2026-10-20T03:00:00Z', balance_after: 1234.5 }] },
        wallet: { ok: true, name: 'N***', today: '2026-10-30', coupons: [
            { code: 'DC-1', campaign_key: 'cash', face_value: 100, status: 'unused', expires_on: '2026-12-31' },
            { code: 'DC-2', campaign_key: 'cash', face_value: 100, status: 'used', redeemed_at: '2026-10-01' }] }
    };
    var lyPtsHtml = LY.renderHtml(lyState, 'en');
    pass('phone page Points tab: tab badges (balance, live coupons) and the points card',
        /class="ly-tab is-on"[^>]*data-tab="points"[^>]*>Points <b class="ly-badge">1,234\.50<\/b>/.test(lyPtsHtml) &&
        /data-tab="coupons"[^>]*>Coupons <b class="ly-badge">1<\/b>/.test(lyPtsHtml) && /wlPtsBalance">1,234\.50</.test(lyPtsHtml) && lyPtsHtml.indexOf('wl-ticket') < 0, lyPtsHtml.slice(0, 600));
    lyState.tab = 'coupons';
    var lyCpHtml = LY.renderHtml(lyState, 'zh-Hant');
    pass('phone page Coupons tab: coupon tickets in Chinese, no points card',
        (lyCpHtml.match(/class="wl-ticket"/g) || []).length === 1 && lyCpHtml.indexOf('wl-pts-card') < 0 && />積分 <b/.test(lyCpHtml) && />優惠券 <b/.test(lyCpHtml));
    var lyOnlyP = LY.renderHtml({ tokens: { c: '', p: TOK_P }, tab: 'coupons', points: lyState.points, wallet: null }, 'en');
    pass('phone page: link without coupons → Coupons tab disabled and explains', /data-tab="coupons"[^>]*disabled/.test(lyOnlyP) && /does not include this part/.test(lyOnlyP));
    pass('phone page: no tokens → asks for a new QR', /wl-error/.test(LY.renderHtml({ tokens: { c: '', p: '' }, tab: 'points' }, 'en')));
    pass('phone page: loading shown until each part arrives', /wl-loading/.test(LY.renderHtml({ tokens: lyTk, tab: 'points', points: null, wallet: null }, 'en')));
    var lyHtmlFile = read('loyalty.html');
    pass('loyalty.html: wallet.js + points.js + loyalty.js, not indexed, no referrer, browse only',
        /<script src="wallet\.js\?v=[^"]+"><\/script>\s*<script src="points\.js\?v=[^"]+"><\/script>\s*<script src="loyalty\.js\?v=[^"]+"><\/script>\s*<script>CSLoyalty\.boot\(\);<\/script>/.test(lyHtmlFile) &&
        /name="robots" content="noindex, nofollow"/.test(lyHtmlFile) && /name="referrer" content="no-referrer"/.test(lyHtmlFile) && !/<input|<form|<select/.test(lyHtmlFile));
    pass('reward panel has the one-QR button beside "Points on the phone"',
        /id="rwPhoneQrBtn"[\s\S]{0,600}id="rwLoyaltyQrBtn"[^>]*>?[\s\S]{0,80}onclick="REWARDS && REWARDS\.openLoyaltyQr\(\)"/.test(read('index.html')) &&
        /function openLoyaltyQr\(patientId\)[\s\S]{0,400}COUPONS\.openLoyaltyQr\(modal, pid\)/.test(read('app-rewards.js')));
    pass('tab CSS in wallet.css', /\.ly-tab\.is-on \{/.test(read('wallet.css')));

    console.log('\n=== Banana: appointments, bill fit, broadcast, household ===');
    pass('node --check appt / mass-broadcast / rewards / i18n',
        child_process.spawnSync(process.execPath, ['--check', path.join(root, 'app-appt.js')]).status === 0 &&
        child_process.spawnSync(process.execPath, ['--check', path.join(root, 'app-mass-broadcast.js')]).status === 0 &&
        child_process.spawnSync(process.execPath, ['--check', path.join(root, 'app-rewards.js')]).status === 0 &&
        child_process.spawnSync(process.execPath, ['--check', path.join(root, 'app-i18n-extra.js')]).status === 0);
    var apptSrc = read('app-appt.js');
    pass('appointment rows mark the patient and paint after the day / today / queue lists',
        /function apptLoyaltyMarkHtml/.test(apptSrc) && /function apptNameLoyaltyLine/.test(apptSrc) &&
        /appt-name-loy-tags/.test(apptSrc) &&
        (apptSrc.match(/paintApptLoyaltySoon\(tb\)/g) || []).length >= 3);
    pass('queue / today: Chinese and English on separate rows; English may wrap 3 lines; chips stay beside',
        /\.appt-name-loy \{/.test(read('style.css')) &&
        /\.appt-name-loy \.appt-patient-name-field \{[\s\S]{0,80}flex-direction: column/.test(read('style.css')) &&
        /\.appt-name-loy \.appt-name-sep \{[\s\S]{0,40}display: none/.test(read('style.css')) &&
        /\.appt-name-loy \.appt-name-cn[\s\S]{0,280}white-space: nowrap/.test(read('style.css')) &&
        /-webkit-line-clamp: 3/.test(read('style.css')) &&
        /\.appt-name-loy-tags \{/.test(read('style.css')) &&
        /apptNameLoyaltyLine\(queueClearModeNameHtml/.test(apptSrc));
    var snapMap = C.loyaltySnapFromRows([
        { patient_id: 'p1', status: 'unused', expires_on: '2026-11-10' },
        { patient_id: 'p1', status: 'unused', expires_on: '2027-01-01' },
        { patient_id: 'p1', status: 'used', expires_on: '2027-01-01' },
        { patient_id: 'p2', status: 'unused', expires_on: '2026-10-01' }
    ], [{ patient_id: 'p1', balance: 255 }, { patient_id: 'p3', balance: 500 }], '2026-10-30');
    pass('loyalty snapshot: live, expiring in 30 days, points; expired unused is not live',
        snapMap.p1.live === 2 && snapMap.p1.expiring === 1 && snapMap.p1.points === 255 &&
        snapMap.p2.live === 0 && snapMap.p3.points === 500 && C.loyaltySnapMatches(snapMap.p1, 'coupon') &&
        C.loyaltySnapMatches(snapMap.p1, 'expiring') && !C.loyaltySnapMatches(snapMap.p1, 'points500') &&
        C.loyaltySnapMatches(snapMap.p3, 'points500') && !C.loyaltySnapMatches({}, 'coupon'), JSON.stringify(snapMap));
    var badge = C.loyaltyBadgeHtml(snapMap.p1);
    pass('appointment badge: coupon count and points, empty when none',
        /loy-appt-c/.test(badge) && />2</.test(badge) && /255pt/.test(badge) &&
        C.loyaltyBadgeHtml({ live: 0, points: 0 }) === '', badge);
    var fitWallet = [
        { id: 's', status: 'unused', campaign_key: 'free_scaling', discount_mode: 'free_line', patient_id: 'p', expires_on: '2027-01-01' },
        { id: 'i', status: 'unused', campaign_key: 'implant', discount_mode: 'amount', face_value: 1000, patient_id: 'p', expires_on: '2027-01-01' },
        { id: 'c', status: 'unused', campaign_key: 'cash', discount_mode: 'amount', face_value: 100, patient_id: 'p', expires_on: '2027-01-01' },
        { id: 'h', status: 'unused', campaign_key: 'free_scaling', discount_mode: 'free_line', patient_id: 'other', household_id: 'other', expires_on: '2027-01-01' }
    ];
    var fit = C.matchingItemCoupons(fitWallet, [{ desc: 'SCALING & POLISHING - 洗牙', item_name: 'SCALING & POLISHING - 洗牙', qty: 1, price: 560 }], '2026-10-30', catalog);
    pass('bill fit: scaling coupon matches the scaling line; implant, cash and household left out',
        fit.length === 1 && fit[0].id === 's', JSON.stringify(fit.map(function (c) { return c.id; })));
    var hh = C.tagHouseholdCoupons([
        { id: 'mine', patient_id: 'p1', status: 'unused' },
        { id: 'cousin', patient_id: 'p2', status: 'unused' }
    ], 'p1', { p1: '001003', p2: '001004' });
    pass('household tag: other chart marked, this chart left alone',
        !hh[0].household_id && hh[1].household_id === 'p2' && hh[1].household_no === '001004');
    pass('wallet pane loads household coupons; transfer skips them; bill uses this chart only',
        /loadWallet\(patientId, \{ household: true \}\)/.test(src) &&
        /!c\.household_id && !LOCKED_TRANSFER_KEYS/.test(src) &&
        /function loadWallet\(patientId, opts\)/.test(src) &&
        /var walletP = bill\.patient_id \? loadWallet\(bill\.patient_id\) :/.test(src));
    var mbSrc = read('app-mass-broadcast.js');
    pass('mass broadcast loyalty filter dropdown and preload',
        /id="mbFilterLoyalty"/.test(html) &&
        /mbFilterLoyalty/.test(mbSrc) &&
        /loyaltyBroadcastIndex/.test(mbSrc) &&
        /patientMatchesLoyalty/.test(mbSrc) &&
        /loyalty: \(pick\('mbFilterLoyalty'\)/.test(mbSrc));
    pass('related charts exported for household coupons',
        /relatedPatientIds: findRelatedPatientIds/.test(read('app-rewards.js')));
    pass('appointment badge CSS in style-coupons.css',
        /\.loy-appt-c \{/.test(read('style-coupons.css')) && /\.loy-appt-p \{/.test(read('style-coupons.css')));

    if (sb) {
        try {
            var jobsProbe = await restGet(sb.url, sb.key, 'loyalty_job_runs', 'select=job,run_on,finished_at,result&order=run_on.desc&limit=3');
            pass('API loyalty_job_runs: ' + (jobsProbe.status === 200 ? 'jobs SQL run, last runs readable' : 'jobs SQL not run yet (desks send as before)'),
                jobsProbe.status === 200 ? Array.isArray(jobsProbe.json) : jobsProbe.status === 404, jobsProbe.status + ' ' + String(jobsProbe.raw || '').slice(0, 160));
        } catch (e) {
            pass('API loyalty_job_runs probe', false, e && e.message);
        }
    }

    if (sb) {
        try {
            var fnProbe = await fetch(sb.url.replace(/\/$/, '') + '/rest/v1/rpc/dc_bill_release', {
                method: 'POST', headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, 'Content-Type': 'application/json' },
                body: JSON.stringify({ p_bill_id: '00000000-0000-0000-0000-000000000000', p_coupon_ids: null })
            });
            var fnBody = await fnProbe.text();
            var installed = fnProbe.status === 200;
            pass('API dc_bill_release: ' + (installed ? 'installed, unknown bill refused' : 'not run yet (desk uses the old writes)'),
                installed ? /"reason"\s*:\s*"bill"/.test(fnBody) : (fnProbe.status === 404 && /PGRST202/.test(fnBody)), fnProbe.status + ' ' + fnBody.slice(0, 160));
            var dupRows = await restGet(sb.url, sb.key, 'program_settings', 'select=id&setting_key=eq.discount_coupon_scheme');
            pass('API coupon settings rows: ' + (installed ? 'one row after the SQL' : 'duplicate removed when the SQL runs'),
                dupRows.status === 200 && Array.isArray(dupRows.json) && (installed ? dupRows.json.length === 1 : dupRows.json.length >= 1),
                'rows=' + (dupRows.json && dupRows.json.length));
        } catch (e) {
            pass('API database function probe', false, e && e.message);
        }
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
  var startPolicy = ((out.radios.filter(function (r) { return r.slice(-1) === '*'; })[0]) || 'manual*').replace('*', '');
  var man = card && card.querySelector('input[value="' + startPolicy + '"]');
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
        pass('CDP set zero card: three policies, saved one checked, 8 month buttons', zLive &&
            zLive.radios.map(function (r) { return r.replace('*', ''); }).join(',') === 'manual,year_end,lifespan' &&
            zLive.radios.filter(function (r) { return /\*$/.test(r); }).length === 1 &&
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
    rules: !!rules && !rules.open && rules.querySelectorAll('li').length === 10 &&
      /(現金券|现金券|Cash coupon) \\d+/.test(rules.textContent) && /20/.test(rules.textContent),
    rulesText: rules ? rules.querySelectorAll('li').length + ' ' + rules.textContent.slice(-300) : ''
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
        pass('CDP rules note is collapsed with 10 rules and live hold limits', pick && pick.rules === true, pick && pick.rulesText);
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
  COUPONS.paintCheckoutHint(1200, 1200, 'Government');
  var gov = { hidden: host.hidden, text: host.textContent, bar: !!host.querySelector('.dc-prog') };
  COUPONS.paintCheckoutHint(1200, 1200, 'PDCC');
  var pdcc = host.textContent;
  window.currentClinicCodeForTagging = function () { return 'PL'; };
  COUPONS.paintCheckoutHint(1200, 1200, 'Cash');
  var plHidden = host.hidden;
  window.currentClinicCodeForTagging = keep;
  appUiLang = before;
  COUPONS.mergeSaved(null);
  host.hidden = true;
  return { ok: true, cash: cash, reward: reward, partial: partial, small: small, plHidden: plHidden, gov: gov, pdcc: pdcc };
})()`, false, 10000);
        pass('CDP checkout hint: Government bill earns no coupons (no spend bar)', hint && hint.gov && hint.gov.hidden === false &&
            /Government \/ PDCC \/ CCF bill/.test(hint.gov.text) && !/earns:/.test(hint.gov.text) && hint.gov.bar === false, hint && JSON.stringify(hint.gov));
        pass('CDP checkout hint: PDCC bill earns no coupons', hint && /Government \/ PDCC \/ CCF bill/.test(hint.pdcc) && !/earns:/.test(hint.pdcc));
        var exIssue = await cdp.js(`(async function () {
  var calls = [];
  var realSB = SB;
  var spy = { from: function (t) { calls.push(t); return realSB.from(t); }, rpc: function (f) { calls.push('rpc:' + f); return Promise.resolve({ data: null, error: null }); } };
  SB = spy;
  try {
    var full = await COUPONS.onBillFullyPaid({ patientId: 'smoke-none', billId: 'smoke-none', cashAmount: 5000, clinicCode: 'KT', method: 'PDCC' });
    var part = await COUPONS.onBillPayment({ patientId: 'smoke-none', billId: 'smoke-none', cashAmount: 5000, clinicCode: 'KT', method: 'Government' });
    return { full: full, part: part, calls: calls };
  } finally { SB = realSB; }
})()`, true, 15000);
        pass('CDP PDCC fully-paid bill issues no spend coupon (no database call)', exIssue && exIssue.full && exIssue.full.reason === 'excluded_method' &&
            exIssue.calls.length === 0, exIssue && JSON.stringify(exIssue));
        pass('CDP Government payment gives no referral credit', exIssue && exIssue.part && exIssue.part.reason === 'excluded_method');
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
      if (String(cols) !== 'patient_no,chinese_name,full_name,phone_number') return realFrom.call(SB, table).select(cols);
      var row = { patient_no: 'T001', chinese_name: '陳大文', full_name: 'Chan Tai Man', phone_number: '9123 4567', mobile_phone: '6000 0000' };
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
                wqr.guide.href === 'docs/loyalty-manual.html?v=20261029refladder#start-coupons-' + wqr.guide.lang), JSON.stringify(wqr && wqr.guide));
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
        var yeLive = await cdp.js(`(async function () {
  var cfg = ${JSON.stringify(typeof sb !== 'undefined' && sb ? { url: sb.url, key: sb.key } : null)};
  var out = { ok: false };
  var realFetch = window.fetch;
  try {
    var pr = await SB.from('patients').select('id').eq('patient_no', '001003').limit(1);
    var pid = pr && pr.data && pr.data[0] && pr.data[0].id;
    if (!pid) return { ok: false, reason: 'no 001003' };
    var pol = await SB.from('program_settings').select('setting_value').eq('setting_key', 'coupon_zero_policy');
    var raw = pol && pol.data && pol.data[0] && pol.data[0].setting_value;
    out.policy = raw ? (JSON.parse(raw).zero_policy || 'manual') : 'manual';
    var desk = await COUPONS.loadWallet(pid);
    var today = COUPONS.todayIso();
    var liveDesk = desk.filter(function (c) { return COUPONS.isLive(c, today); });
    out.desk = liveDesk.map(function (c) { return { own: c.own_expires_on, shown: c.expires_on, issued: String(c.issued_at || '').slice(0, 10) }; });
    var rawRows = (await SB.from('discount_coupons').select('*').eq('patient_id', pid)).data || [];
    if (!window.CSWallet) {
      await new Promise(function (res, rej) { var s = document.createElement('script'); s.src = 'wallet.js?probe=' + Date.now(); s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    }
    window.CS_WALLET_CONFIG = { supabaseUrl: cfg.url, anonKey: cfg.key };
    out.policyCalls = 0;
    window.fetch = function (u, o) {
      if (/rpc\\/dc_wallet_view/.test(String(u))) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, name: 'N.P.C.', today: today, campaigns: [], coupons: rawRows }), { status: 200 }));
      }
      if (/coupon_zero_policy/.test(String(u))) out.policyCalls++;
      return realFetch.apply(this, arguments);
    };
    var phone = await window.CSWallet.fetchWallet('0123456789abcdef0123456789abcdef');
    out.phonePolicy = phone.zero_policy;
    var html = window.CSWallet.renderHtml(phone, 'en', false);
    var parts = window.CSWallet.split(phone);
    out.phone = parts.live.map(function (c) { return { own: c.own_expires_on, shown: c.expires_on, issued: String(c.issued_at || '').slice(0, 10) }; });
    out.htmlHasOwn2027 = parts.live.some(function (c) { return c.own_expires_on && c.own_expires_on !== c.expires_on && html.indexOf(c.own_expires_on) >= 0; });
    out.ok = true;
  } catch (e) { out.err = String(e && e.message || e); }
  finally { window.fetch = realFetch; }
  return out;
})()`, true, 30000);
        var capOk = function (rows) {
            return (rows || []).length > 0 && rows.every(function (r) {
                var y = (r.issued || '2026').slice(0, 4);
                return yeLive.policy !== 'year_end' ? r.shown === r.own : (r.shown <= y + '-12-31' && (r.own <= y + '-12-31' ? r.shown === r.own : r.shown === y + '-12-31'));
            });
        };
        pass('live #001003 desk wallet: Set zero ' + (yeLive && yeLive.policy) + ' -> shown expiry follows the rule', !!(yeLive && yeLive.ok && capOk(yeLive.desk)),
            yeLive && (yeLive.err || JSON.stringify(yeLive.desk)));
        pass('live #001003 phone wallet: same dates as the desk, from the live Set zero option', !!(yeLive && yeLive.ok && yeLive.phonePolicy === yeLive.policy &&
            yeLive.policyCalls === 1 && capOk(yeLive.phone) && yeLive.phone.length === yeLive.desk.length && yeLive.htmlHasOwn2027 === false),
            yeLive && JSON.stringify({ policy: yeLive.phonePolicy, calls: yeLive.policyCalls, phone: yeLive.phone }));
        var secLive = await cdp.js(`(async function () {
  var out = { ok: false };
  try {
    var pr = await SB.from('patients').select('id').eq('patient_no', '001003').limit(1);
    var pid = pr && pr.data && pr.data[0] && pr.data[0].id;
    if (!pid) return { ok: false, reason: 'no 001003' };
    var snap = async function () {
      var r = await SB.from('discount_coupons').select('id,status,bill_id,patient_id,face_value').eq('patient_id', pid);
      return JSON.stringify((r.data || []).sort(function (a, b) { return a.id < b.id ? -1 : 1; }));
    };
    var before = await snap();
    var wallet = await COUPONS.loadWallet(pid);
    var anyCoupon = wallet[0];
    out.walletCount = wallet.length;
    var noBill = '00000000-0000-0000-0000-000000000000';
    var probeFallback = function () { return { ok: false, reason: 'fallback_probe' }; };
    out.issue = await COUPONS.dcWrite('dc_issue_coupon', { p_kind: 'spend', p_patient_id: pid, p_campaign_key: 'spend_1', p_clinic_code: 'KT',
      p_bill_id: noBill, p_referral_id: null, p_amount: null, p_user: null, p_password: null, p_issued_by: null, p_note: null, p_item_names: null }, probeFallback);
    out.gift = await COUPONS.dcWrite('dc_issue_coupon', { p_kind: 'gift', p_patient_id: pid, p_campaign_key: 'cash', p_clinic_code: 'KT',
      p_bill_id: null, p_referral_id: null, p_amount: 100, p_user: 'nurse', p_password: 'x', p_issued_by: null, p_note: null, p_item_names: null }, probeFallback);
    out.redeem = await COUPONS.dcWrite('dc_bill_set_coupons', { p_bill_id: noBill,
      p_items: anyCoupon ? [{ id: anyCoupon.id, amount: 1, line_name: null }] : [] }, probeFallback);
    out.after = (await snap()) === before;
    out.installed = !!(out.issue && out.issue.viaDb);
    out.ok = true;
  } catch (e) { out.err = String(e && e.message || e); }
  return out;
})()`, true, 30000);
        var secOk = secLive && secLive.ok && secLive.after && (secLive.installed
            ? secLive.issue.reason === 'bill' && secLive.gift.reason === 'creds' && secLive.redeem.reason === 'bill'
            : secLive.issue.reason === 'fallback_probe' && secLive.gift.reason === 'fallback_probe' && secLive.redeem.reason === 'fallback_probe');
        pass('live #001003 coupon writes: ' + (secLive && secLive.installed
            ? 'database functions refuse a fake bill and the shared Nurse login'
            : 'database functions not run yet, desk falls back to the old writes') + '; wallet unchanged',
            !!secOk, JSON.stringify(secLive));
        var jobLive = await cdp.js(`(async function () {
  var out = { ok: false };
  var key = 'smoke_db_job_probe';
  try {
    localStorage.removeItem(key);
    var today = COUPONS.todayIso();
    out.state = await COUPONS.dbSmsJobState(today);
    var calls = 0;
    out.first = await COUPONS.runDeskSmsBackup(key, function (d) { calls++; out.day = d; return { ok: true }; });
    out.second = await COUPONS.runDeskSmsBackup(key, function () { calls++; return { ok: true }; });
    out.calls = calls;
    out.today = today;
    var pr = await SB.from('patients').select('id').eq('patient_no', '001003').limit(1);
    var pid = pr && pr.data && pr.data[0] && pr.data[0].id;
    var w = await COUPONS.loadWallet(pid);
    out.ordered = w.every(function (c, i) { return i === 0 || String(w[i - 1].issued_at || '') <= String(c.issued_at || ''); });
    out.n = w.length;
    out.ok = true;
  } catch (e) { out.err = String(e && e.message || e); }
  finally { localStorage.removeItem(key); }
  return out;
})()`, true, 30000);
        var jobOn = jobLive && jobLive.state && jobLive.state.on;
        pass('live #001003 desk SMS backup: ' + (jobOn ? 'database job on (' + (jobLive.state.ran ? 'ran today, desk skips' : 'not yet run') + ')'
            : 'database job not set up, desk sends once a day as before') + '; wallet in issue order',
            !!(jobLive && jobLive.ok && jobLive.ordered && jobLive.n > 0 && (jobOn
                ? (jobLive.state.ran ? jobLive.calls === 0 : true)
                : jobLive.calls === 1 && jobLive.day === jobLive.today && jobLive.second.skipped === 'done')), JSON.stringify(jobLive));
        var lyrLive = await cdp.js(`(async function () {
  var out = { ok: false };
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function until(fn, ms) { var end = Date.now() + ms; while (Date.now() < end) { var v = fn(); if (v) return v; await sleep(250); } return null; }
  try {
    var today = COUPONS.todayIso();
    var from = today.slice(0, 4) + '-01-01';
    var pr = await SB.from('patients').select('id,patient_no').eq('patient_no', '001003').limit(1);
    var pid = pr.data[0].id;
    var all = await SB.from('discount_coupons').select('id,patient_id,status,bill_id,redeemed_amount,redeemed_at,expires_on,issued_at,clinic_code,discount_mode,face_value');
    var policy = await COUPONS.freshZeroPolicy();
    var live = COUPONS.applyZeroExpiry(all.data.map(function (c) { return Object.assign({}, c); }), policy).filter(function (c) { return COUPONS.isLive(c, today); });
    out.expLive = live.length;
    out.expLiveValue = Math.round(live.reduce(function (s, c) { return s + (c.discount_mode === 'percent' ? 0 : Number(c.face_value || 0)); }, 0) * 100) / 100;
    var mine = all.data.filter(function (c) { return c.patient_id === pid && c.status === 'used' && c.bill_id && LOYALTY_REPORT.hkDay(c.redeemed_at) >= from; });
    var billIds = mine.map(function (c) { return c.bill_id; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    var br = billIds.length ? await SB.from('bills').select('id,voided_at,clinic_tag').in('id', billIds) : { data: [] };
    var okBills = {};
    (br.data || []).forEach(function (b) { if (!b.voided_at) okBills[b.id] = b; });
    out.expMineCoupon = Math.round(mine.filter(function (c) { return okBills[c.bill_id]; }).reduce(function (s, c) { return s + Number(c.redeemed_amount || 0); }, 0) * 100) / 100;
    out.mineBillClinic = (br.data || []).map(function (b) { return b.clinic_tag; })[0] || '';

    if (typeof showOnly === 'function') showOnly('reportSection');
    REPORT.init();
    var sel = document.getElementById('reportClinicSelect');
    if (sel) { sel.value = ''; }
    REPORT.switchTab('loyalty');
    var rep = await until(function () { return document.querySelector('#rptTableWrap .lyr-report'); }, 45000);
    if (!rep) { out.err = 'no report: ' + (document.getElementById('rptTableWrap') || {}).textContent; return out; }
    out.today = today;
    out.from = document.getElementById('rptFrom').value;
    out.title = document.getElementById('rptTitle').textContent;
    out.sections = rep.querySelectorAll('.lyr-sec').length;
    out.hasCal = !!rep.querySelector('.lyr-cal');
    out.calDays = rep.querySelectorAll('[data-lyr-day]').length;
    out.ytdOn = !!(rep.querySelector('[data-lyr-preset="ytd"]') && rep.querySelector('[data-lyr-preset="ytd"]').className.indexOf('is-on') >= 0);
    out.chartHidden = document.getElementById('rptChartCol') ? document.getElementById('rptChartCol').style.display === 'none' : true;
    var model = (await LOYALTY_REPORT.render(null, { from: from, to: today, today: today, clinic: '',
      fetchBills: function (ids) { return SB.from('bills').select('id,bill_date,total,amount_paid,balance,patient_id,patient_no,patient_name,voided_at,created_at').in('id', ids).then(function (r) { return r.data || []; }); } })).model;
    out.repLive = model.outstanding.total.coupons;
    out.repLiveValue = model.outstanding.total.coupon_value;
    out.repPoints = model.outstanding.total.points;
    var myRows = model.bills.rows.filter(function (r) { return String(r.patient).indexOf('001003') === 0; });
    out.repMineCoupon = Math.round(myRows.reduce(function (s, r) { return s + r.coupon; }, 0) * 100) / 100;
    out.mineAddsUp = myRows.every(function (r) { return Math.abs(r.coupon + r.points + r.paid + r.balance - r.before) < 0.01; });
    out.pageHasMine = out.repMineCoupon > 0 ? rep.textContent.indexOf('001003') >= 0 : true;
    out.campaigns = model.campaigns.length;
    out.referrals = model.referrals.reduce(function (s, r) { return s + r.referred; }, 0);

    if (sel && out.mineBillClinic) {
      var opt = Array.prototype.slice.call(sel.options).filter(function (o) {
        var rec = typeof clinicRecordFromId === 'function' ? clinicRecordFromId(o.value) : null;
        return o.value && ((rec && String(rec.clinic_code || '').toUpperCase() === String(out.mineBillClinic).toUpperCase()) || o.value === out.mineBillClinic);
      })[0];
      if (opt) {
        sel.value = opt.value;
        REPORT.switchTab('dailyIncome');
        await sleep(300);
        document.getElementById('rptFrom').value = today.slice(0, 7) + '-01';
        document.getElementById('rptTo').value = today;
        document.getElementById('rptFrom').dispatchEvent(new Event('change'));
        var head = await until(function () {
          var th = Array.prototype.map.call(document.querySelectorAll('#rptTableWrap th'), function (x) { return x.textContent; });
          return th.length && document.getElementById('rptTableWrap').textContent.indexOf('…') < 0 ? th : null;
        }, 45000);
        out.dailyHead = head;
        out.dailyClinic = opt.value;
      }
      sel.value = '';
    }
    REPORT.switchTab('loyalty');
    var afterOpen = await until(function () { return document.querySelector('#rptTableWrap .lyr-cal [data-lyr-preset="month"]'); }, 45000);
    if (afterOpen) {
      afterOpen.click();
      var monthFrom = today.slice(0, 7) + '-01';
      var filtered = await until(function () {
        var f = document.getElementById('rptFrom');
        var r = document.querySelector('#rptTableWrap .lyr-cal');
        return f && f.value === monthFrom && r && r.querySelector('[data-lyr-range]') ? r : null;
      }, 45000);
      out.calFrom = document.getElementById('rptFrom').value;
      out.calTo = document.getElementById('rptTo').value;
      out.calRange = filtered && filtered.querySelector('[data-lyr-range]') ? filtered.querySelector('[data-lyr-range]').textContent : '';
      out.monthOn = !!(filtered && filtered.querySelector('[data-lyr-preset="month"]') &&
        filtered.querySelector('[data-lyr-preset="month"]').className.indexOf('is-on') >= 0);
    }
    out.ok = true;
  } catch (e) { out.err = String(e && e.message || e); }
  return out;
})()`, true, 120000);
        pass('live Reports → Coupons & points opens: 4 sections, year-to-date, no chart',
            !!(lyrLive && lyrLive.ok && lyrLive.sections === 4 && lyrLive.chartHidden && /-01-01$/.test(lyrLive.from)), JSON.stringify(lyrLive));
        pass('live loyalty mini-calendar is on the panel and Year to date is selected',
            !!(lyrLive && lyrLive.hasCal && lyrLive.calDays >= 28 && lyrLive.ytdOn),
            lyrLive && (lyrLive.calDays + ' days, ytd=' + lyrLive.ytdOn));
        pass('live loyalty mini-calendar This month filters the tables at once',
            !!(lyrLive && lyrLive.today && lyrLive.calFrom === (lyrLive.today.slice(0, 7) + '-01') && lyrLive.calTo === lyrLive.today && lyrLive.monthOn),
            lyrLive && (lyrLive.calFrom + '–' + lyrLive.calTo + ' ' + lyrLive.calRange));
        pass('live unused coupons = every live coupon in the database (Set zero applied)',
            !!(lyrLive && lyrLive.repLive === lyrLive.expLive && Math.abs(lyrLive.repLiveValue - lyrLive.expLiveValue) < 0.01),
            lyrLive && (lyrLive.repLive + ' / ' + lyrLive.expLive + ', HK$' + lyrLive.repLiveValue + ' / ' + lyrLive.expLiveValue + ', points HK$' + lyrLive.repPoints));
        pass('live #001003 per bill: coupon value used this year matches the coupons, and each bill adds up',
            !!(lyrLive && lyrLive.repMineCoupon === lyrLive.expMineCoupon && lyrLive.mineAddsUp && lyrLive.pageHasMine),
            lyrLive && ('report HK$' + lyrLive.repMineCoupon + ' vs coupons HK$' + lyrLive.expMineCoupon));
        if (lyrLive && lyrLive.dailyHead) {
            pass('live Daily income (' + lyrLive.mineBillClinic + ', this month): coupon and points columns beside cash',
                lyrLive.expMineCoupon > 0 ? lyrLive.dailyHead.some(function (h) { return /Coupons used|已用優惠券|已用优惠券/.test(h); }) : true, JSON.stringify(lyrLive.dailyHead));
        }
        var lyPhone = await cdp.js(`(async function () {
  var out = { ok: false };
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  try {
    var pr = await SB.from('patients').select('id').eq('patient_no', '001003').limit(1);
    var pid = pr.data[0].id;
    var dc = await SB.rpc('dc_wallet_link', { p_patient_id: pid, p_by: null, p_reset: false });
    var rw = await SB.rpc('rw_wallet_link', { p_patient_id: pid, p_by: null, p_reset: false });
    out.dcToken = dc.data && dc.data.token;
    out.rwToken = rw.data && rw.data.token;
    var link = await COUPONS.loyaltyLink(pid, false);
    out.url = link.url;
    var dcView = await SB.rpc('dc_wallet_view', { p_token: out.dcToken });
    var rwView = await SB.rpc('rw_wallet_view', { p_token: out.rwToken });
    out.expBalance = rwView.data && rwView.data.balance;
    var zp = await COUPONS.freshZeroPolicy();
    out.expLive = CSWalletLive(dcView.data, zp.zero_policy);
    function CSWalletLive(d, policy) {
      var today = d.today;
      return (d.coupons || []).filter(function (c) {
        var own = c.expires_on ? String(c.expires_on).slice(0, 10) : null;
        var exp = own;
        if (policy === 'year_end') { var cap = new Date(Date.parse(c.issued_at) + 8 * 3600000).getUTCFullYear() + '-12-31'; exp = !own || own > cap ? cap : own; }
        return c.status === 'unused' && (!exp || exp >= today);
      }).length;
    }
    var f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-2000px;top:0;width:390px;height:800px';
    f.src = 'loyalty.html' + link.url.slice(link.url.indexOf('?')) + '&g=en';
    document.body.appendChild(f);
    var t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      await sleep(250);
      var d0 = f.contentDocument;
      var bs = d0 && d0.querySelectorAll('.ly-badge');
      if (bs && bs.length === 2) break;
    }
    var doc = f.contentDocument;
    out.title = doc.getElementById('wlTitle').textContent;
    out.who = doc.getElementById('wlWho').textContent;
    out.badges = Array.prototype.map.call(doc.querySelectorAll('.ly-badge'), function (b) { return b.textContent; });
    out.first = (doc.querySelector('.ly-tab.is-on') || {}).getAttribute ? doc.querySelector('.ly-tab.is-on').getAttribute('data-tab') : '';
    out.balance = (doc.getElementById('wlPtsBalance') || {}).textContent;
    doc.querySelector('.ly-tab[data-tab="coupons"]').click();
    await sleep(100);
    out.second = doc.querySelector('.ly-tab.is-on').getAttribute('data-tab');
    out.tickets = doc.querySelectorAll('.wl-ticket').length;
    out.hash = f.contentWindow.location.hash;
    out.controls = doc.querySelectorAll('input, select, form, textarea').length;
    f.remove();

    COUPONS.openLoyaltyQr(null, pid);
    var box = null;
    t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      await sleep(200);
      box = document.querySelector('.dc-wqr[data-scheme="loyalty"]');
      if (box && box.querySelector('#dcWqrLink').value) break;
    }
    out.qrLink = box && box.querySelector('#dcWqrLink').value;
    out.qrTitle = box && box.querySelector('#dcWqrTitle').textContent;
    out.qrDrawn = !!(box && box.querySelector('#dcWqrCode').getAttribute('data-url'));
    var close = box && box.querySelector('[data-act="close"]');
    if (close) close.click();
    var dc2 = await SB.rpc('dc_wallet_link', { p_patient_id: pid, p_by: null, p_reset: false });
    var rw2 = await SB.rpc('rw_wallet_link', { p_patient_id: pid, p_by: null, p_reset: false });
    out.sameTokens = dc2.data.token === out.dcToken && rw2.data.token === out.rwToken;

    var host = document.getElementById('bSpendHint');
    var keep = window.currentClinicCodeForTagging;
    var keepCtx = window.billPaymentClinicContext;
    var kt = (typeof APP_CLINICS !== 'undefined' ? APP_CLINICS : []).filter(function (c) { return String(c.clinic_code || '').toUpperCase() === 'KT'; })[0];
    window.currentClinicCodeForTagging = function () { return 'KT'; };
    window.billPaymentClinicContext = function () { return { clinic_id: kt ? kt.id : null, clinic_code: 'KT' }; };
    COUPONS.mergeSaved({ campaigns: [{ key: 'spend_1', enabled: true }, { key: 'spend_2', enabled: true }] });
    var joined = await REWARDS.currentClinicJoined();
    out.ktPoints = joined;
    var rate = await REWARDS.earnRatePercent();
    COUPONS.paintCheckoutHint(1200, 1200, 'Cash');
    await sleep(1500);
    out.hintPts = (host.querySelector('.dc-hint-pts') || {}).textContent || '';
    out.hintCoupon = /Spend \\$1000 get \\$100|滿\\$1000送\\$100|满\\$1000送\\$100/.test(host.textContent);
    out.expPts = joined ? COUPONS.pointsEarnText(1200, rate, 'Cash') : '';
    COUPONS.paintCheckoutHint(1200, 1200, 'PDCC');
    await sleep(1200);
    out.pdccPts = !!host.querySelector('.dc-hint-pts');
    window.currentClinicCodeForTagging = keep;
    if (keepCtx) window.billPaymentClinicContext = keepCtx; else delete window.billPaymentClinicContext;
    COUPONS.mergeSaved(null);
    host.hidden = true;
    out.ok = true;
  } catch (e) { out.err = String(e && e.message || e); }
  return out;
})()`, true, 60000);
        pass('live #001003 one link carries the existing coupon and points tokens',
            !!(lyPhone && lyPhone.ok && lyPhone.url && lyPhone.url.indexOf('loyalty.html?c=' + lyPhone.dcToken + '&p=' + lyPhone.rwToken) > 0), JSON.stringify(lyPhone && { url: lyPhone.url, err: lyPhone.err }));
        pass('live #001003 loyalty.html: Points tab first with the real balance, badges for both',
            !!(lyPhone && lyPhone.first === 'points' && lyPhone.badges.length === 2 && lyPhone.title === 'My points & coupons' &&
                lyPhone.balance === lyPhone.badges[0] && Number(String(lyPhone.balance).replace(/,/g, '')) === Number(lyPhone.expBalance) && !!lyPhone.who),
            lyPhone && JSON.stringify({ badges: lyPhone.badges, balance: lyPhone.balance, exp: lyPhone.expBalance, who: lyPhone.who }));
        pass('live #001003 loyalty.html: Coupons tab shows the live coupons; browse only',
            !!(lyPhone && lyPhone.second === 'coupons' && lyPhone.tickets === lyPhone.expLive && String(lyPhone.expLive) === lyPhone.badges[1] &&
                lyPhone.hash === '#tab=coupons' && lyPhone.controls === 0), lyPhone && (lyPhone.tickets + ' tickets / ' + lyPhone.expLive + ' live'));
        pass('live #001003 desk one-QR box draws the same link and leaves the tokens alone',
            !!(lyPhone && lyPhone.qrLink && lyPhone.qrLink === lyPhone.url && lyPhone.qrDrawn && lyPhone.sameTokens), lyPhone && (lyPhone.qrTitle + ' ' + lyPhone.qrLink));
        pass('live checkout hint at KT: ' + (lyPhone && lyPhone.ktPoints ? 'points line + spend coupon line together' : 'KT not in points scheme, coupon line only') + '; no points line on PDCC',
            !!(lyPhone && lyPhone.hintCoupon && lyPhone.hintPts === lyPhone.expPts && (lyPhone.ktPoints ? /^⭐ Paying HK\$1200\.00 earns about/.test(lyPhone.hintPts) : lyPhone.hintPts === '') &&
                lyPhone.pdccPts === false), lyPhone && JSON.stringify({ kt: lyPhone.ktPoints, pts: lyPhone.hintPts, exp: lyPhone.expPts }));
        var smsLink = await cdp.js(`(async function () {
  var out = { ok: false };
  var BASE_KEY = 'csPhoneScanBase';
  var keepBase = localStorage.getItem(BASE_KEY);
  var keepSend = AIHELPER.sendTwilioOutreach;
  var keepFrom = SB.from;
  var sent = [];
  try {
    var pr = await SB.from('patients').select('id').eq('patient_no', '001003').limit(1);
    var pid = pr && pr.data && pr.data[0] && pr.data[0].id;
    if (!pid) return { ok: false, reason: 'no 001003' };
    localStorage.setItem(BASE_KEY, 'https://elitedentist13.github.io/CS-web-version/scan.html');
    var dc1 = await SB.rpc('dc_wallet_link', { p_patient_id: pid, p_by: null, p_reset: false });
    var rw1 = await SB.rpc('rw_wallet_link', { p_patient_id: pid, p_by: null, p_reset: false });
    out.dcToken = dc1 && dc1.data && dc1.data.token;
    out.rwToken = rw1 && rw1.data && rw1.data.token;
    AIHELPER.sendTwilioOutreach = function (o) { sent.push(o); return Promise.resolve({ ok: true, result: { sid: 'SMOKE' } }); };
    SB.from = function (t) {
      if (t === 'reward_sms_log') return { insert: function () { return Promise.resolve({ data: null, error: null }); } };
      return keepFrom.apply(SB, arguments);
    };
    out.couponRes = await COUPONS.sendCouponSms(pid, function (w) { return 'SMOKE coupon body (' + w.length + ')'; }, { phoneLink: true });
    out.couponBody = sent[0] && sent[0].body;
    var prog = await SB.from('reward_program').select('sms_notify_enabled').eq('id', 1).maybeSingle();
    out.pointsSmsOn = !(prog && prog.data && prog.data.sms_notify_enabled === false);
    out.pointsRes = await REWARDS.notifyBalanceChange({ patientId: pid, points: 0, kind: 'net', clinic: 'SMOKE', ref: 'SMOKE' });
    out.pointsBody = sent[1] && sent[1].body;
    var dc2 = await SB.rpc('dc_wallet_link', { p_patient_id: pid, p_by: null, p_reset: false });
    var rw2 = await SB.rpc('rw_wallet_link', { p_patient_id: pid, p_by: null, p_reset: false });
    out.sameTokens = dc2.data.token === out.dcToken && rw2.data.token === out.rwToken;
    var view = await SB.rpc('rw_wallet_view', { p_token: out.rwToken });
    out.rwViewOk = !!(view && view.data && view.data.ok !== false);
    out.sends = sent.length;
    out.ok = true;
  } catch (e) { out.err = String(e && e.message || e); }
  finally {
    AIHELPER.sendTwilioOutreach = keepSend;
    SB.from = keepFrom;
    if (keepBase == null) localStorage.removeItem(BASE_KEY); else localStorage.setItem(BASE_KEY, keepBase);
  }
  return out;
})()`, true, 30000);
        var lastLine = function (s) { var l = String(s || '').split('\n'); return l[l.length - 1]; };
        var loySms = '手機查看積分及優惠券/See your points and coupons on the phone: https://elitedentist13.github.io/CS-web-version/loyalty.html?c=' +
            (smsLink && smsLink.dcToken) + '&p=' + (smsLink && smsLink.rwToken);
        pass('live #001003 coupon SMS ends with the one points-and-coupons page link (no SMS really sent)', !!(smsLink && smsLink.ok && smsLink.couponRes && smsLink.couponRes.ok &&
            lastLine(smsLink.couponBody) === loySms),
            smsLink && (smsLink.err || smsLink.reason || lastLine(smsLink.couponBody)));
        pass('live #001003 points SMS ends with the same one page link (no SMS really sent)', !!(smsLink && smsLink.ok && (smsLink.pointsSmsOn ?
            lastLine(smsLink.pointsBody) === loySms &&
            smsLink.pointsBody.indexOf('變動/Change') > 0 : smsLink.sends === 1)),
            smsLink && (smsLink.err || (smsLink.pointsSmsOn ? lastLine(smsLink.pointsBody) : 'points SMS switched off')));
        pass('live #001003 SMS links reuse the patient’s current QR (no new code) and open the combined page', !!(smsLink && smsLink.ok && smsLink.sameTokens && smsLink.rwViewOk),
            smsLink && JSON.stringify({ same: smsLink.sameTokens, view: smsLink.rwViewOk }));
        var refLive = await cdp.js(`(async function () {
  var out = { ok: false };
  try {
    var pr = await SB.from('patients').select('id,patient_no,chinese_name,full_name').eq('patient_no', '001003').limit(1);
    var p = pr && pr.data && pr.data[0];
    if (!p) return { ok: false, reason: 'no 001003' };
    var snap = await COUPONS.loadState();
    var camp = (snap.campaigns || []).filter(function (c) { return c.key === 'referral'; })[0];
    out.saved = { enabled: camp.enabled, pct: camp.refPercent, max: camp.refMax, step: camp.refStep, min: camp.minFirstSpend };
    var wallet = await COUPONS.loadWallet(p.id);
    var on = Object.assign({}, camp, { enabled: true });
    var plan = function (paid, full) {
      return COUPONS.planReferralIssue({ record: { status: 'pending' }, campaign: on, clinicCode: 'KT', clinics: { KT: { joined: true } },
        cashPaid: paid, fullyPaid: full, referrerWallet: wallet });
    };
    out.values = [500, 999, 2345, 5000, 10000, 15000].map(function (s) { return COUPONS.referralCouponValue(on, s); });
    out.full = plan(2345, true);
    out.part = plan(2345, false);
    out.preview = COUPONS.referralPreviewText({ status: 'pending' }, p, on);
    out.ladder = COUPONS.referralLadderHtml(on);
    out.ok = true;
  } catch (e) { out.err = String(e && e.message || e); }
  return out;
})()`, true, 30000);
        pass('live config: refer-a-friend coupon follows the ladder (10% up to HK$1000, HK$10 steps)', !!(refLive && refLive.ok &&
            refLive.values.join(',') === '50,90,230,500,1000,1000'), refLive && (refLive.err || JSON.stringify({ saved: refLive.saved, values: refLive.values })));
        pass('live #001003 as referrer: friend’s HK$2,345 bill fully paid → HK$230 coupon, part paid → waits', !!(refLive && refLive.ok &&
            (refLive.full.ok ? refLive.full.face === 230 : refLive.full.reason === 'already_holding' || refLive.full.reason === 'wallet_full') &&
            refLive.part.reason === 'wait_full' && refLive.part.face === 230), refLive && JSON.stringify({ full: refLive.full, part: refLive.part }));
        pass('live #001003 referral preview and config ladder', !!(refLive && refLive.ok && refLive.preview.indexOf('#001003') === 0 &&
            refLive.preview.indexOf('10% of the bill') > 0 && /fully paid/.test(refLive.preview) && refLive.ladder.indexOf('+HK$1000') > 0),
            refLive && refLive.preview);
        var wire = await cdp.js(`(async () => {
  var out = { ok: false };
  try {
    var pr = await SB.from('patients').select('id,patient_no,full_name,chinese_name').eq('patient_no', '001003').limit(1);
    var p = pr.data && pr.data[0];
    if (!p) return { ok: false, reason: 'no 001003' };
    out.name = p.full_name;
    out.no = p.patient_no;
    var snap = await COUPONS.loyaltyDaySnapshots([p.id]);
    var mine = snap[p.id] || {};
    out.live = mine.live;
    out.points = mine.points;
    out.badge = COUPONS.loyaltyBadgeHtml(mine);
    var span = document.createElement('span');
    span.className = 'loy-appt';
    span.setAttribute('data-pid', p.id);
    span.setAttribute('hidden', '');
    document.body.appendChild(span);
    await COUPONS.paintApptLoyalty(document.body);
    out.painted = span.innerHTML;
    out.hidden = span.hasAttribute('hidden');
    span.remove();
    var own = await COUPONS.loadWallet(p.id);
    var house = await COUPONS.loadWallet(p.id, { household: true });
    var related = (REWARDS && typeof REWARDS.relatedPatientIds === 'function')
      ? await REWARDS.relatedPatientIds(p.id) : [p.id];
    out.own = own.length;
    out.house = house.length;
    out.related = related.length;
    out.houseTagged = house.filter(function (c) { return c.household_id; }).length;
    var fit = COUPONS.matchingItemCoupons(own, [
      { desc: 'SCALING & POLISHING - 洗牙', item_name: 'SCALING & POLISHING - 洗牙', qty: 1, price: 560 }
    ], undefined, (typeof treatmentItemsCache !== 'undefined' && treatmentItemsCache) || []);
    out.fit = fit.map(function (c) { return c.campaign_key; });
    out.itemFitWired = /coupons\\.info\\.itemFit/.test(String(COUPONS.refreshBillCouponInfo));
    out.mbFilter = !!document.getElementById('mbFilterLoyalty');
    out.ok = true;
  } catch (e) { out.err = String(e && e.message || e); }
  return out;
})()`, true, 35000);
        pass('live #001003 is NG PUI CHING', !!(wire && wire.ok && /NG PUI CHING/i.test(String(wire.name || '')) && wire.no === '001003'),
            wire && JSON.stringify({ name: wire.name, no: wire.no, err: wire.err }));
        pass('live #001003 appointment badge paints unused coupons and points', !!(wire && wire.ok &&
            typeof wire.live === 'number' && typeof wire.points === 'number' &&
            ((wire.live > 0 || wire.points > 0) ? /loy-appt-badges/.test(wire.painted) && wire.hidden === false : wire.painted === '') &&
            (wire.live > 0 ? String(wire.badge).indexOf(String(wire.live)) >= 0 : true) &&
            (wire.points > 0 ? /pt/.test(wire.badge) : true)),
            wire && JSON.stringify({ live: wire.live, points: wire.points, badge: wire.badge, painted: wire.painted, hidden: wire.hidden }));
        pass('live #001003 household wallet: related charts merged, other-chart coupons tagged, this chart still loads alone',
            !!(wire && wire.ok && wire.related >= 1 && wire.house >= wire.own &&
                (wire.related === 1 ? wire.houseTagged === 0 : wire.house >= wire.own)),
            wire && JSON.stringify({ own: wire.own, house: wire.house, related: wire.related, houseTagged: wire.houseTagged }));
        pass('live #001003 treatment-coupon fit against a scaling line (own wallet only)',
            !!(wire && wire.ok && Array.isArray(wire.fit)), wire && JSON.stringify(wire && wire.fit));
        pass('live page: mass-broadcast loyalty filter is on the contacts pane',
            !!(wire && wire.ok && wire.mbFilter), wire && JSON.stringify(wire));
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
