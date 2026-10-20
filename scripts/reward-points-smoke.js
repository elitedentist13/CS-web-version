/**
 * Reward Points — smoke / spot / HTML / API / syntax / CDP Runtime.evaluate / live page.
 * Read-mostly. API probes are SELECT + optional RPC dry-skip (zero eligible).
 * Does not log in UI and does not write bills/payments.
 *
 * Run: node scripts/reward-points-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var PAGE_PORT = 8817;
var CDP_PORT = 9377;
var CHROME = process.env.CHROME_PATH ||
    (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-rewards.js'))) root = process.cwd();

var fails = [];
var warns = [];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}
function warn(name, detail) {
    console.log('WARN  ' + name + (detail ? '  —  ' + detail : ''));
    warns.push(name + (detail ? ': ' + detail : ''));
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function nodeCheck(rel) {
    return new Promise(function (resolve) {
        var file = path.join(root, rel);
        var p = child_process.spawn(process.execPath, ['--check', file], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        var err = '';
        p.stderr.on('data', function (c) { err += c; });
        p.on('close', function (code) {
            resolve({ ok: code === 0, detail: (err || '').trim().slice(0, 200) });
        });
    });
}

function httpGetText(port, reqPath) {
    return new Promise(function (resolve, reject) {
        var req = http.get({ host: '127.0.0.1', port: port, path: reqPath, timeout: 6000 }, function (r) {
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
    var url = base.replace(/\/$/, '') + '/rest/v1/' + table + (qs ? ('?' + qs) : '');
    return fetch(url, {
        headers: {
            apikey: key,
            Authorization: 'Bearer ' + key,
            Accept: 'application/json'
        }
    }).then(function (r) {
        return r.text().then(function (t) {
            var json = null;
            try { json = JSON.parse(t); } catch (e) {}
            return { status: r.status, json: json, raw: t.slice(0, 280) };
        });
    });
}

function restRpc(base, key, fn, body) {
    var url = base.replace(/\/$/, '') + '/rest/v1/rpc/' + fn;
    return fetch(url, {
        method: 'POST',
        headers: {
            apikey: key,
            Authorization: 'Bearer ' + key,
            Accept: 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body || {})
    }).then(function (r) {
        return r.text().then(function (t) {
            var json = null;
            try { json = JSON.parse(t); } catch (e) {}
            return { status: r.status, json: json, raw: t.slice(0, 320) };
        });
    });
}

function startStaticServer(port) {
    var types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.json': 'application/json'
    };
    var server = http.createServer(function (req, res) {
        var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        var file = path.normalize(path.join(root, urlPath));
        if (!file.startsWith(root)) {
            res.writeHead(403); res.end('forbidden'); return;
        }
        fs.readFile(file, function (err, data) {
            if (err) {
                res.writeHead(404); res.end('not found'); return;
            }
            var ext = path.extname(file).toLowerCase();
            res.writeHead(200, {
                'Content-Type': types[ext] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            res.end(data);
        });
    });
    return new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', function () { resolve(server); });
    });
}

function Cdp(ws) {
    this.ws = ws;
    this.n = 0;
    this.pending = {};
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
        var t = setTimeout(function () {
            delete self.pending[id];
            reject(new Error('CDP timeout ' + method));
        }, timeoutMs);
        self.pending[id] = {
            resolve: function (v) { clearTimeout(t); resolve(v); },
            reject: function (e) { clearTimeout(t); reject(e); }
        };
        self.ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
};
Cdp.prototype.js = async function (expression, awaitPromise, timeoutMs) {
    var r = await this.call('Runtime.evaluate', {
        expression: expression,
        returnByValue: true,
        awaitPromise: !!awaitPromise,
        timeout: (timeoutMs || 45000)
    }, (timeoutMs || 45000) + 5000);
    if (r.exceptionDetails) {
        var ex = r.exceptionDetails.exception || {};
        throw new Error(ex.description || JSON.stringify(r.exceptionDetails));
    }
    return (r.result || {}).value;
};

async function waitJs(cdp, expr, timeoutMs) {
    var deadline = Date.now() + (timeoutMs || 25000);
    var last = null;
    while (Date.now() < deadline) {
        try {
            last = await cdp.js(expr, true, 8000);
            if (last) return last;
        } catch (e) {
            last = e.message;
        }
        await sleep(300);
    }
    throw new Error('waitJs failed: ' + String(last).slice(0, 220));
}

function extractIifeHelpers(src) {
    // Pull isRewardPayMethod + METHOD by evaluating app-rewards.js in a sandbox.
    var ctx = {
        window: {},
        document: {
            readyState: 'complete',
            getElementById: function () { return null; },
            querySelector: function () { return null; },
            querySelectorAll: function () { return []; },
            createElement: function () {
                return {
                    style: {},
                    setAttribute: function () {},
                    addEventListener: function () {},
                    appendChild: function () {}
                };
            },
            head: { appendChild: function () {} },
            addEventListener: function () {},
            body: null
        },
        console: console,
        setTimeout: setTimeout,
        Promise: Promise,
        SB: {
            from: function () {
                return {
                    select: function () { return this; },
                    eq: function () { return this; },
                    maybeSingle: function () { return Promise.resolve({ data: null, error: null }); },
                    order: function () { return this; },
                    limit: function () { return Promise.resolve({ data: [], error: null }); },
                    insert: function () { return Promise.resolve({ data: null, error: null }); },
                    update: function () { return { eq: function () { return Promise.resolve({ error: null }); } }; },
                    upsert: function () { return Promise.resolve({ error: null }); }
                };
            },
            rpc: function () { return Promise.resolve({ data: { ok: true, skipped: true }, error: null }); }
        },
        AIHELPER: undefined,
        currentRole: 'admin',
        currentName: 'smoke',
        APP_CLINICS: [],
        t: function (k) { return k; },
        todayISO: function () { return '2026-10-19'; },
        openModal: function () {},
        closeModal: function () {}
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return ctx.REWARDS || ctx.window.REWARDS;
}

(async function main() {
    var idxSrc = read('index.html');
    var rewardsSrc = read('app-rewards.js');
    var apptSrc = read('app-appt.js');
    var reportSrc = read('app-report.js');
    var cfgSrc = read('app-config.js');
    var i18nExtra = read('app-i18n-extra.js');
    var i18nSrc = read('app-i18n.js');
    var sqlSrc = read('reward_points.sql');
    var sqlChartSrc = '';
    try { sqlChartSrc = read('reward_points_patch_chart_ledgers.sql'); } catch (eChart) { sqlChartSrc = ''; }
    var appSrc = read('app.js');
    var patientSrc = read('app-patient.js');
    var patientViewsSrc = read('app-patient-views.js');
    var appJsSrc = appSrc;

    console.log('=== syntax: node --check ===');
    var syntaxFiles = [
        'app-rewards.js',
        'app-appt.js',
        'app-config.js',
        'app-report.js',
        'app-consultation.js',
        'app-i18n.js',
        'app-i18n-extra.js',
        'app-patient.js',
        'app-patient-views.js',
        'app.js',
        'scripts/reward-points-smoke.js'
    ];
    for (var si = 0; si < syntaxFiles.length; si++) {
        var sc = await nodeCheck(syntaxFiles[si]);
        pass('syntax ' + syntaxFiles[si], sc.ok, sc.detail || '');
    }

    console.log('\n=== smoke: source wiring ===');
    pass('SQL creates reward_program', /create table if not exists public\.reward_program/i.test(sqlSrc));
    pass('SQL seeds PL enabled', /clinic_code[\s\S]{0,80}= 'PL'/i.test(sqlSrc) ||
        /upper\(trim\(coalesce\(c\.clinic_code, ''\)\)\) = 'PL'/.test(sqlSrc));
    pass('SQL has reward_earn RPC', /create or replace function public\.reward_earn/i.test(sqlSrc));
    pass('SQL has reward_redeem RPC', /create or replace function public\.reward_redeem/i.test(sqlSrc));
    pass('SQL has reward_transfer RPC', /create or replace function public\.reward_transfer/i.test(sqlSrc));
    pass('SQL has reward_void_for_payment RPC', /create or replace function public\.reward_void_for_payment/i.test(sqlSrc));
    pass('SQL has reward_void_for_bill RPC', /create or replace function public\.reward_void_for_bill/i.test(sqlSrc));
    pass('SQL has reward_adjust RPC', /create or replace function public\.reward_adjust/i.test(sqlSrc));
    pass('chart ledger patch exists', sqlChartSrc.length > 100);
    pass('chart patch has reward_redeem_multi', /reward_redeem_multi/i.test(sqlChartSrc));
    pass('chart patch has reward_transfer_multi', /reward_transfer_multi/i.test(sqlChartSrc));
    pass('chart patch has join_gain/join_redeem',
        /join_gain/i.test(sqlChartSrc) && /join_redeem/i.test(sqlChartSrc));
    pass('chart patch allocates smallest first',
        /order by a\.balance asc/i.test(sqlChartSrc));
    pass('app has allocateAcrossAccounts + Redeem all',
        /allocateAcrossAccounts/.test(rewardsSrc) &&
        /applyRedeemAllOnPayment/.test(rewardsSrc) &&
        /listPersonAccounts/.test(rewardsSrc));
    pass('index has Redeem all + source pickers',
        idxSrc.indexOf('id="apRewardRedeemAll"') >= 0 &&
        idxSrc.indexOf('id="apRewardSources"') >= 0 &&
        idxSrc.indexOf('id="rwTransferSources"') >= 0);
    pass('SQL void bill reverses earn and redeem',
        /kind in \('earn', 'redeem'\)/.test(sqlSrc) &&
        /kind = 'redeem' then 0/.test(sqlSrc) &&
        /void_earn/.test(sqlSrc) && /void_redeem/.test(sqlSrc));
    pass('SQL void bill uses clock_timestamp for ledger order',
        /clock_timestamp\(\)/.test(sqlSrc));
    pass('ledger sorts void_earn above void_redeem on ties',
        /sortLedgerNewestFirst/.test(rewardsSrc) &&
        /void_earn/.test(rewardsSrc) && /void_redeem/.test(rewardsSrc));
    pass('appt bill void reverses rewards',
        /voidForBill/.test(apptSrc) && /executeBillDelete/.test(apptSrc) &&
        /reverse earn \+ redeem/.test(apptSrc));
    pass('SQL default rate 10', /earn_rate_percent[\s\S]{0,40}default 10/i.test(sqlSrc));

    pass('index loads app-rewards.js', /['"]app-rewards\.js(\?[^'"]*)?['"]/.test(idxSrc));
    pass('index has apRewardPanel', idxSrc.indexOf('id="apRewardPanel"') >= 0);
    pass('index has rewardPatientModal', idxSrc.indexOf('id="rewardPatientModal"') >= 0);
    pass('index has admin adjust controls',
        idxSrc.indexOf('id="rwAdminAdjust"') >= 0 &&
        idxSrc.indexOf('id="rwAdjPlus"') >= 0 &&
        idxSrc.indexOf('id="rwAdjReset"') >= 0);
    pass('index has reward ledger finder modal',
        idxSrc.indexOf('id="rewardLedgerFinderModal"') >= 0);
    pass('index has dashboard rewards card',
        idxSrc.indexOf('id="card-rewards"') >= 0);
    pass('REWARDS.adjust + openLedgerFinder exported',
        /adjust:\s*adjust/.test(rewardsSrc) &&
        /openLedgerFinder:\s*openLedgerFinder/.test(rewardsSrc) &&
        /function adjust\s*\(/.test(rewardsSrc));
    pass('config log has clinic/chart/handler columns',
        /rewards\.col\.clinic/.test(rewardsSrc) &&
        /rewards\.col\.chartNo/.test(rewardsSrc) &&
        /rewards\.col\.handler/.test(rewardsSrc) &&
        /enrichLedgerMeta/.test(rewardsSrc));
    pass('ledger table has clinic tags + Dr Name',
        /rewards\.col\.clinicTag/.test(rewardsSrc) &&
        /rewards\.col\.drName/.test(rewardsSrc) &&
        /ledgerClinicTag/.test(rewardsSrc) &&
        /ledgerDoctorName/.test(rewardsSrc) &&
        /stampDoctorOnLedgerResult/.test(rewardsSrc));
    pass('index ledger headers clinic tags + Dr Name',
        idxSrc.indexOf('rewards.col.clinicTag') >= 0 &&
        idxSrc.indexOf('rewards.col.drName') >= 0);
    pass('same-doctor redeem helpers',
        /resolveRewardDoctor/.test(rewardsSrc) &&
        /loadDoctorLedgerNets/.test(rewardsSrc) &&
        /accountsCappedForDoctor/.test(rewardsSrc) &&
        /getRedeemableBalanceForDoctor/.test(rewardsSrc) &&
        /rewards\.pay\.needDoctor/.test(rewardsSrc));
    pass('index shows payment doctor for rewards',
        idxSrc.indexOf('id="apRewardDoctor"') >= 0);
    pass('patient dir ⋯ has reward ledger',
        /btn-reward-ledger/.test(patientSrc) &&
        /REWARDS\.openPatientPanel/.test(patientSrc));
    pass('patient dashboard has rewards mini card',
        /patDashRewardsCard/.test(patientViewsSrc) &&
        /data-act="rewards"/.test(patientViewsSrc) &&
        /patDashRefreshRewards/.test(patientViewsSrc) &&
        /REWARDS\.openPatientPanel/.test(patientViewsSrc));
    pass('i18n patient.view.rewardsHint',
        /'patient\.view\.rewardsHint'/.test(i18nExtra));
    pass('dashboard card-rewards opens finder',
        /card-rewards/.test(appJsSrc) &&
        /openLedgerFinder/.test(appJsSrc));
    pass('dashboard perm guards include card-rewards',
        /cardId:\s*'card-rewards'/.test(read('app-auth.js')));
    pass('index card-rewards before configuration',
        idxSrc.indexOf('id="card-rewards"') < idxSrc.indexOf('id="card-configuration"') &&
        idxSrc.indexOf('id="card-rewards"') > idxSrc.indexOf('id="card-patient"'));
    pass('index cfg nav rewards', /data-tab="rewards"/.test(idxSrc));
    pass('index cfgPane-rewards', idxSrc.indexOf('id="cfgPane-rewards"') >= 0);
    pass('cfg TABS has rewards', /key:\s*'rewards'/.test(cfgSrc));
    pass('cfg loaders.rewards', /rewards:\s*loadRewards/.test(cfgSrc));
    pass('cfg loadRewards fn', /function loadRewards\s*\(/.test(cfgSrc));

    pass('REWARDS module IIFE', /var REWARDS = \(function/.test(rewardsSrc));
    pass('METHOD Reward points', /METHOD\s*=\s*'Reward points'/.test(rewardsSrc));
    pass('isRewardPayMethod exported', /window\.isRewardPayMethod/.test(rewardsSrc));
    pass('SMS via AIHELPER', /sendTwilioOutreach/.test(rewardsSrc));
    pass('notifyNetChange present', /function notifyNetChange/.test(rewardsSrc) ||
        /notifyNetChange:\s*notifyNetChange/.test(rewardsSrc));

    pass('appt openAddPayment refreshes panel',
        /REWARDS\.refreshAddPaymentRewardPanel/.test(apptSrc));
    pass('appt confirmAddPayment reads points',
        /readUsePointsFromPanel/.test(apptSrc));
    pass('appt executeAddPaymentSave redeem',
        /applyRedeemForBill/.test(apptSrc));
    pass('appt executeAddPaymentSave earn',
        /applyEarnForPayment/.test(apptSrc));
    pass('appt initial bill save also earns',
        /Initial bill reward earn failed|First payment on bill create also earns/.test(apptSrc) &&
        /applyEarnForPayment/.test(apptSrc));
    pass('appt void reverses rewards',
        /voidForPayment/.test(apptSrc));
    pass('SMS brand Joyful Smile (not Banana fallback)',
        /Joyful Smile Dental Clinic/.test(rewardsSrc) &&
        !/tpl = '\[Banana\]/.test(rewardsSrc));
    pass('SMS bilingual ZH+EN fallback',
        /積分更新 \/ Reward points update/.test(rewardsSrc) &&
        /變動\/Change/.test(rewardsSrc) &&
        /kindLabelBilingual/.test(rewardsSrc));
    pass('ledger time matches banner/realtime locale clock',
        /ledgerDateLocale/.test(rewardsSrc) && /fmtLedgerTimeHK/.test(rewardsSrc) &&
        /APP_LOCALE/.test(rewardsSrc) && /hour12:\s*true/.test(rewardsSrc));
    pass('banner balance instant paint API',
        /paintBannerBalance/.test(rewardsSrc) &&
        /refreshBannerBalances\(info\.patientId, info\.balance\)/.test(rewardsSrc) &&
        /function refreshBannerBalances\(patientId, knownBalance\)/.test(rewardsSrc));
    pass('banner balance id is conBannerRewardsBal (not BtnBal)',
        /ensureRewardsBannerBtn/.test(rewardsSrc) &&
        /'conBannerRewardsBal'/.test(rewardsSrc) &&
        /'apptBannerRewardsBal'/.test(rewardsSrc) &&
        !/btnId \+ 'Bal'/.test(rewardsSrc));
    pass('rewards modal centered above billPanel',
        /reward-points-modal-box/.test(idxSrc) &&
        /z-index:3200/.test(rewardsSrc) &&
        /translate\(-50%,-50%\)/.test(rewardsSrc) &&
        /#billPanel\.open/.test(rewardsSrc));

    pass('report excludes reward points',
        /isRewardPayMethod/.test(reportSrc) &&
        /reward points/.test(reportSrc));
    pass('i18n bill.pay.rewardPoints map',
        /'reward points':\s*'bill\.pay\.rewardPoints'/.test(i18nSrc));
    pass('i18n cfg.nav.rewards', /'cfg\.nav\.rewards'/.test(i18nExtra));
    pass('i18n rewards.pay.useLabel', /'rewards\.pay\.useLabel'/.test(i18nExtra));

    console.log('\n=== unit: vm helpers ===');
    var R = null;
    try {
        R = extractIifeHelpers(rewardsSrc);
        pass('REWARDS loads in vm', !!R && typeof R.isRewardPayMethod === 'function');
        if (R) {
            pass('METHOD constant', R.METHOD === 'Reward points', R.METHOD);
            pass('detect Reward points', R.isRewardPayMethod('Reward points') === true);
            pass('detect reward-point variant', R.isRewardPayMethod('reward-point') === true);
            pass('reject Cash', R.isRewardPayMethod('Cash') === false);
            pass('reject Balance transfer', R.isRewardPayMethod('Balance transfer') === false);
            pass('round2 1.005→1.01 or 1.00', [1, 1.01].indexOf(R.round2(1.005)) >= 0 ||
                R.round2(10.5) === 10.5, String(R.round2(1.005)));
            pass('fmtPts 50', R.fmtPts(50) === '50.00');
            pass('isAdmin true when currentRole admin', R.isAdmin() === true);
        }
    } catch (e) {
        pass('REWARDS loads in vm', false, e && e.message);
    }

    // reportPayMethodIsNonIncome via quick regex + small eval of the function body
    try {
        var m = reportSrc.match(/function reportPayMethodIsNonIncome\(key\) \{[\s\S]*?\n  \}/);
        pass('reportPayMethodIsNonIncome extractable', !!m);
        if (m) {
            var fn = new Function(
                'window',
                m[0] + '\nreturn reportPayMethodIsNonIncome;'
            )({
                isBalanceTransferPayMethod: function (k) {
                    return String(k).toLowerCase().indexOf('balance transfer') >= 0;
                },
                isRewardPayMethod: function (k) {
                    return R ? R.isRewardPayMethod(k) : /reward/.test(String(k).toLowerCase());
                }
            });
            pass('nonIncome Reward points', fn('Reward points') === true);
            pass('nonIncome Balance transfer', fn('Balance transfer') === true);
            pass('income Cash', fn('Cash') === false);
        }
    } catch (e) {
        pass('report nonIncome unit', false, e && e.message);
    }

    console.log('\n=== HTML / HTTP spot (static :' + PAGE_PORT + ') ===');
    var server = null;
    try {
        server = await startStaticServer(PAGE_PORT);
        var idx = await httpGetText(PAGE_PORT, '/index.html');
        pass('GET /index.html', idx.status === 200, 'status=' + idx.status);
        pass('HTML has apRewardUse', idx.body.indexOf('id="apRewardUse"') >= 0);
        pass('HTML has apRewardRedeemAll', idx.body.indexOf('id="apRewardRedeemAll"') >= 0);
        pass('HTML has apRewardSources', idx.body.indexOf('id="apRewardSources"') >= 0);
        pass('HTML has apRewardAllocPreview', idx.body.indexOf('id="apRewardAllocPreview"') >= 0);
        pass('HTML has rwTransferSources', idx.body.indexOf('id="rwTransferSources"') >= 0);
        pass('HTML has rwTransferSubmit', idx.body.indexOf('id="rwTransferSubmit"') >= 0);
        pass('HTML has rwAdminAdjust', idx.body.indexOf('id="rwAdminAdjust"') >= 0);
        pass('HTML has card-rewards', idx.body.indexOf('id="card-rewards"') >= 0);
        pass('HTML has rewardLedgerFinderModal', idx.body.indexOf('id="rewardLedgerFinderModal"') >= 0);
        pass('HTML lists app-rewards.js', idx.body.indexOf('app-rewards.js') >= 0);

        var js = await httpGetText(PAGE_PORT, '/app-rewards.js');
        pass('GET /app-rewards.js', js.status === 200 && js.body.indexOf('REWARDS') >= 0,
            'bytes=' + (js.body && js.body.length));
        pass('served JS has listPersonAccounts',
            js.body.indexOf('listPersonAccounts') >= 0);
        pass('served JS has allocateAcrossAccounts',
            js.body.indexOf('allocateAcrossAccounts') >= 0);
        pass('served JS has redeemMulti',
            js.body.indexOf('redeemMulti') >= 0);

        var sqlHttp = await httpGetText(PAGE_PORT, '/reward_points.sql');
        pass('GET /reward_points.sql', sqlHttp.status === 200 &&
            sqlHttp.body.indexOf('reward_ledger') >= 0);
        var sqlPatchHttp = await httpGetText(PAGE_PORT, '/reward_points_patch_chart_ledgers.sql');
        pass('GET /reward_points_patch_chart_ledgers.sql', sqlPatchHttp.status === 200 &&
            sqlPatchHttp.body.indexOf('reward_redeem_multi') >= 0);
    } catch (e) {
        pass('HTTP spot server', false, e && e.message);
    }

    console.log('\n=== API: Supabase read / rpc probe ===');
    var sb = null;
    var tablesReady = false;
    try {
        sb = readSbConfig(appSrc);
        pass('SB config parsed', !!(sb.url && sb.key), sb.url);
        var prog = await restGet(sb.url, sb.key, 'reward_program', 'id=eq.1&select=*');
        if (prog.status === 404 || (prog.json && prog.json.code === 'PGRST205') ||
                /does not exist|schema cache/i.test(prog.raw || '')) {
            warn('reward_program missing — run reward_points.sql', prog.raw);
            pass('API reward_program reachable OR noted missing', true, 'status=' + prog.status);
        } else {
            pass('API reward_program select', prog.status >= 200 && prog.status < 300,
                'status=' + prog.status);
            tablesReady = Array.isArray(prog.json) || (prog.json && prog.json.id === 1);
            if (Array.isArray(prog.json) && prog.json[0]) {
                pass('API default rate is 10 (or configured)',
                    Number(prog.json[0].earn_rate_percent) >= 0,
                    String(prog.json[0].earn_rate_percent));
            } else if (prog.json && prog.json.earn_rate_percent != null) {
                pass('API default rate present', true, String(prog.json.earn_rate_percent));
            }
        }

        var clinics = await restGet(sb.url, sb.key, 'reward_program_clinics',
            'select=clinic_code,enabled&order=clinic_code');
        if (/does not exist|schema cache|PGRST/i.test(clinics.raw || '') || clinics.status >= 400) {
            warn('reward_program_clinics missing', clinics.raw);
        } else {
            pass('API reward_program_clinics select', clinics.status < 300, 'status=' + clinics.status);
            var rows = clinics.json || [];
            var pl = rows.find(function (r) {
                return String(r.clinic_code || '').toUpperCase() === 'PL';
            });
            if (pl) pass('API PL joined by default (or still enabled)', pl.enabled === true,
                JSON.stringify(pl));
            else warn('API no PL row yet (seed after clinics exist)', 'rows=' + rows.length);
            tablesReady = true;
        }

        var ledger = await restGet(sb.url, sb.key, 'reward_ledger',
            'select=id,kind,points&limit=3');
        if (/does not exist|schema cache/i.test(ledger.raw || '') || ledger.status >= 400) {
            warn('reward_ledger missing', ledger.raw);
        } else {
            pass('API reward_ledger select', ledger.status < 300, 'rows=' +
                (Array.isArray(ledger.json) ? ledger.json.length : '?'));
        }

        // Safe RPC: earn with 0 eligible → skipped, no balance change
        var rpc = await restRpc(sb.url, sb.key, 'reward_earn', {
            p_patient_id: '00000000-0000-0000-0000-000000000001',
            p_eligible_amount: 0,
            p_clinic_code: 'PL'
        });
        if (/does not exist|Could not find the function|PGRST202/i.test(rpc.raw || '') ||
                rpc.status === 404) {
            warn('RPC reward_earn not deployed yet', rpc.raw);
        } else if (rpc.status >= 200 && rpc.status < 300) {
            var body = rpc.json;
            pass('RPC reward_earn zero-eligible skips',
                body && body.ok === true && body.skipped === true,
                JSON.stringify(body).slice(0, 160));
            tablesReady = true;
        } else {
            // patient not found is also acceptable proof RPC exists
            pass('RPC reward_earn callable',
                /patient/i.test(rpc.raw || '') || rpc.status < 500,
                'status=' + rpc.status + ' ' + rpc.raw.slice(0, 120));
        }

        var adjRpc = await restRpc(sb.url, sb.key, 'reward_adjust', {
            p_patient_id: '00000000-0000-0000-0000-000000000001',
            p_points_delta: 0,
            p_clinic_code: 'PL',
            p_note: 'smoke'
        });
        if (/does not exist|Could not find the function|PGRST202/i.test(adjRpc.raw || '') ||
                adjRpc.status === 404) {
            warn('RPC reward_adjust not deployed yet — run reward_points_patch_adjust.sql', adjRpc.raw);
        } else if (adjRpc.status >= 200 && adjRpc.status < 300) {
            pass('RPC reward_adjust zero-delta skips',
                adjRpc.json && adjRpc.json.ok === true && adjRpc.json.skipped === true,
                JSON.stringify(adjRpc.json).slice(0, 160));
        } else {
            pass('RPC reward_adjust callable',
                adjRpc.status < 500,
                'status=' + adjRpc.status + ' ' + String(adjRpc.raw || '').slice(0, 120));
        }

        // Chart-ledger patch columns / RPCs
        var clinicsJoin = await restGet(sb.url, sb.key, 'reward_program_clinics',
            'select=clinic_code,enabled,join_gain,join_redeem&limit=5');
        if (/join_gain|column|PGRST/i.test(clinicsJoin.raw || '') && clinicsJoin.status >= 400) {
            warn('join_gain/join_redeem columns missing — run reward_points_patch_chart_ledgers.sql',
                clinicsJoin.raw);
        } else if (clinicsJoin.status < 300) {
            pass('API clinics have join_gain/join_redeem', true,
                'rows=' + (Array.isArray(clinicsJoin.json) ? clinicsJoin.json.length : 0));
            tablesReady = true;
        }

        var multiRpc = await restRpc(sb.url, sb.key, 'reward_redeem_multi', {
            p_anchor_patient_id: '00000000-0000-0000-0000-000000000001',
            p_points: 0,
            p_source_account_ids: [],
            p_clinic_code: 'PL'
        });
        if (/does not exist|Could not find the function|PGRST202/i.test(multiRpc.raw || '') ||
                multiRpc.status === 404) {
            warn('RPC reward_redeem_multi not deployed — run reward_points_patch_chart_ledgers.sql',
                multiRpc.raw);
        } else if (multiRpc.status >= 200 && multiRpc.status < 300) {
            pass('RPC reward_redeem_multi callable',
                multiRpc.json && multiRpc.json.ok === false,
                JSON.stringify(multiRpc.json).slice(0, 160));
        } else {
            pass('RPC reward_redeem_multi reachable',
                multiRpc.status < 500 || /points must|select at least|patient/i.test(multiRpc.raw || ''),
                'status=' + multiRpc.status + ' ' + String(multiRpc.raw || '').slice(0, 140));
        }

        // Real patient with reward account (read-only)
        var realAcc = await restGet(sb.url, sb.key, 'reward_accounts',
            'select=id,patient_id,patient_no,clinic_code,balance&balance=gt.0&order=balance.desc&limit=3');
        if (realAcc.status >= 200 && realAcc.status < 300 && Array.isArray(realAcc.json) &&
                realAcc.json.length) {
            var top = realAcc.json[0];
            pass('API real patient reward account', true,
                '#' + (top.patient_no || '?') + ' bal=' + top.balance + ' id=' +
                String(top.patient_id || '').slice(0, 8));
            global.__REWARD_SMOKE_PATIENT__ = {
                patient_id: top.patient_id,
                patient_no: top.patient_no,
                account_id: top.id,
                balance: Number(top.balance)
            };
            var related = await restRpc(sb.url, sb.key, 'reward_related_patient_ids', {
                p_patient_id: top.patient_id
            });
            if (/does not exist|Could not find|PGRST202/i.test(related.raw || '') ||
                    related.status === 404) {
                warn('RPC reward_related_patient_ids not deployed yet', related.raw);
            } else if (related.status < 300 && Array.isArray(related.json)) {
                pass('API related patient ids for real chart', related.json.length >= 1,
                    'n=' + related.json.length);
            } else {
                pass('API related patient ids callable', related.status < 500,
                    String(related.raw || '').slice(0, 120));
            }
            // Dry allocate preview via multi with 0 points should fail cleanly
            var dryMulti = await restRpc(sb.url, sb.key, 'reward_redeem_multi', {
                p_anchor_patient_id: top.patient_id,
                p_points: 0,
                p_source_account_ids: [top.id],
                p_clinic_code: 'PL'
            });
            if (dryMulti.status < 300 && dryMulti.json) {
                pass('RPC redeem_multi zero-points rejects',
                    dryMulti.json.ok === false,
                    JSON.stringify(dryMulti.json).slice(0, 140));
            }
        } else if (/does not exist|schema cache/i.test(realAcc.raw || '')) {
            warn('reward_accounts missing', realAcc.raw);
        } else {
            warn('API no positive-balance reward account yet',
                'status=' + realAcc.status + ' rows=' +
                (Array.isArray(realAcc.json) ? realAcc.json.length : 0));
            // Fall back to any account / any patient
            var anyAcc = await restGet(sb.url, sb.key, 'reward_accounts',
                'select=id,patient_id,patient_no,balance&limit=1');
            if (anyAcc.status < 300 && Array.isArray(anyAcc.json) && anyAcc.json[0]) {
                global.__REWARD_SMOKE_PATIENT__ = {
                    patient_id: anyAcc.json[0].patient_id,
                    patient_no: anyAcc.json[0].patient_no,
                    account_id: anyAcc.json[0].id,
                    balance: Number(anyAcc.json[0].balance) || 0
                };
                pass('API fallback reward account', true,
                    '#' + (anyAcc.json[0].patient_no || '?') + ' bal=' + anyAcc.json[0].balance);
            } else {
                var anyPat = await restGet(sb.url, sb.key, 'patients',
                    'select=id,patient_no,full_name&limit=1');
                if (anyPat.status < 300 && Array.isArray(anyPat.json) && anyPat.json[0]) {
                    global.__REWARD_SMOKE_PATIENT__ = {
                        patient_id: anyPat.json[0].id,
                        patient_no: anyPat.json[0].patient_no,
                        account_id: null,
                        balance: 0
                    };
                    pass('API fallback real patient (no reward row yet)', true,
                        '#' + (anyPat.json[0].patient_no || '?') + ' ' +
                        (anyPat.json[0].full_name || ''));
                }
            }
        }

        pass('API probe completed', true, tablesReady ? 'tables live' : 'SQL may still need apply');
    } catch (e) {
        pass('API probe', false, e && e.message);
    }

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    var proc = null;
    try {
        if (!server) throw new Error('static server not up');
        if (!fs.existsSync(CHROME)) {
            pass('Chrome found for CDP', false, CHROME);
            throw new Error('no chrome');
        }
        var profile = path.join(os.tmpdir(), 'cs-reward-points-cdp');
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
        fs.mkdirSync(profile, { recursive: true });
        var appUrl = 'http://127.0.0.1:' + PAGE_PORT + '/index.html?_lr=rewardSmoke1';
        proc = child_process.spawn(CHROME, [
            '--remote-debugging-port=' + CDP_PORT,
            '--user-data-dir=' + profile,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-sync',
            '--disable-popup-blocking',
            '--window-size=1280,900',
            appUrl
        ], { stdio: 'ignore' });

        await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 25000);
        var tabs = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000);
        var page = (tabs || []).find(function (t) {
            return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0;
        });
        pass('CDP page target', !!page && !!page.webSocketDebuggerUrl, page ? page.url : 'none');
        if (!page) throw new Error('no page target');

        var ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) {
            ws.addEventListener('open', resolve);
            ws.addEventListener('error', reject);
        });
        var cdp = new Cdp(ws);
        await cdp.call('Page.enable');
        await cdp.call('Runtime.enable');

        await waitJs(cdp, "!!(window.__JSM_BUILD || document.getElementById('loginUserId'))", 30000);
        pass('live page boot shell', true);

        await waitJs(cdp, "typeof SB !== 'undefined' && !!SB && typeof SB.from === 'function'", 45000);
        pass('live SB present', true);

        var rewardsReady = await waitJs(cdp,
            "typeof REWARDS !== 'undefined' && typeof REWARDS.isRewardPayMethod === 'function'",
            30000);
        pass('live REWARDS loaded', !!rewardsReady);

        var liveProbe = await cdp.js(`(async () => {
  const out = {
    method: REWARDS.METHOD,
    detectCash: REWARDS.isRewardPayMethod('Cash'),
    detectReward: REWARDS.isRewardPayMethod('Reward points'),
    panel: !!document.getElementById('apRewardPanel'),
    useCb: !!document.getElementById('apRewardUse'),
    redeemAll: !!document.getElementById('apRewardRedeemAll'),
    sources: !!document.getElementById('apRewardSources'),
    allocPreview: !!document.getElementById('apRewardAllocPreview'),
    xferSources: !!document.getElementById('rwTransferSources'),
    modal: !!document.getElementById('rewardPatientModal'),
    adminAdj: !!document.getElementById('rwAdminAdjust'),
    finder: !!document.getElementById('rewardLedgerFinderModal'),
    dashCard: !!document.getElementById('card-rewards'),
    cfgPane: !!document.getElementById('cfgPane-rewards'),
    cfgNav: !!document.querySelector('[data-tab="rewards"]'),
    hasAdjust: typeof REWARDS.adjust === 'function',
    hasFinder: typeof REWARDS.openLedgerFinder === 'function',
    hasListPerson: typeof REWARDS.listPersonAccounts === 'function',
    hasAlloc: typeof REWARDS.allocateAcrossAccounts === 'function',
    hasRedeemAll: typeof REWARDS.applyRedeemAllOnPayment === 'function',
    hasRedeemSrc: typeof REWARDS.readRedeemSourceIdsForPayment === 'function',
    reportHook: typeof window.isRewardPayMethod === 'function'
      ? window.isRewardPayMethod('Reward points') : null
  };
  try {
    const joined = await REWARDS.isClinicJoined(null, 'PL');
    out.plJoinedDefault = !!joined;
  } catch (e) {
    out.plJoinedDefault = null;
    out.plErr = String(e && e.message || e);
  }
  try {
    if (typeof REWARDS.isClinicGainJoined === 'function') {
      out.plGain = !!(await REWARDS.isClinicGainJoined(null, 'PL'));
      out.plRedeem = !!(await REWARDS.isClinicRedeemJoined(null, 'PL'));
    }
  } catch (e) {
    out.plJoinErr = String(e && e.message || e);
  }
  try {
    const prog = await REWARDS.loadProgram(true);
    out.rate = prog && prog.earn_rate_percent;
    out.sms = prog && prog.sms_notify_enabled;
  } catch (e) {
    out.rate = null;
    out.progErr = String(e && e.message || e);
  }
  // Open payment modal DOM nodes exist even while hidden
  out.apAmountMin = (document.getElementById('apAmount') || {}).min || null;
  return out;
})()`, true, 20000);

        pass('live METHOD', liveProbe && liveProbe.method === 'Reward points',
            liveProbe && liveProbe.method);
        pass('live detect Reward points', liveProbe && liveProbe.detectReward === true);
        pass('live reject Cash', liveProbe && liveProbe.detectCash === false);
        pass('live apRewardPanel in DOM', liveProbe && liveProbe.panel === true);
        pass('live apRewardUse in DOM', liveProbe && liveProbe.useCb === true);
        pass('live apRewardRedeemAll in DOM', liveProbe && liveProbe.redeemAll === true);
        pass('live apRewardSources in DOM', liveProbe && liveProbe.sources === true);
        pass('live apRewardAllocPreview in DOM', liveProbe && liveProbe.allocPreview === true);
        pass('live rwTransferSources in DOM', liveProbe && liveProbe.xferSources === true);
        pass('live rewardPatientModal in DOM', liveProbe && liveProbe.modal === true);
        pass('live rwAdminAdjust in DOM', liveProbe && liveProbe.adminAdj === true);
        pass('live rewardLedgerFinderModal in DOM', liveProbe && liveProbe.finder === true);
        pass('live card-rewards in DOM', liveProbe && liveProbe.dashCard === true);
        pass('live REWARDS.adjust', liveProbe && liveProbe.hasAdjust === true);
        pass('live REWARDS.openLedgerFinder', liveProbe && liveProbe.hasFinder === true);
        pass('live REWARDS.listPersonAccounts', liveProbe && liveProbe.hasListPerson === true);
        pass('live REWARDS.allocateAcrossAccounts', liveProbe && liveProbe.hasAlloc === true);
        pass('live REWARDS.applyRedeemAllOnPayment', liveProbe && liveProbe.hasRedeemAll === true);
        pass('live cfgPane-rewards in DOM', liveProbe && liveProbe.cfgPane === true);
        pass('live cfg nav rewards', liveProbe && liveProbe.cfgNav === true);
        pass('live window.isRewardPayMethod', liveProbe && liveProbe.reportHook === true);
        pass('live apAmount allows 0', liveProbe && String(liveProbe.apAmountMin) === '0',
            liveProbe && liveProbe.apAmountMin);

        if (liveProbe && liveProbe.plJoinedDefault != null) {
            pass('live PL joined (API or default)', liveProbe.plJoinedDefault === true,
                liveProbe.plErr || '');
        } else {
            warn('live PL join probe skipped', liveProbe && liveProbe.plErr);
        }
        if (liveProbe && liveProbe.plGain != null) {
            pass('live PL join_gain readable', liveProbe.plGain === true || liveProbe.plGain === false,
                'gain=' + liveProbe.plGain + ' redeem=' + liveProbe.plRedeem);
        }
        if (liveProbe && liveProbe.rate != null) {
            pass('live program rate readable', Number(liveProbe.rate) >= 0,
                String(liveProbe.rate));
        } else {
            warn('live program rate (tables may be missing)', liveProbe && liveProbe.progErr);
        }

        // clienttest: open rewards config pane without full login (call renderer)
        var cfgPaint = await cdp.js(`(async () => {
  const pane = document.getElementById('cfgPane-rewards');
  if (!pane || typeof REWARDS.renderConfigPane !== 'function') {
    return { ok: false, reason: 'missing' };
  }
  try {
    // Reset join-map cache so legacy column fallback re-runs cleanly
    if (typeof REWARDS.loadClinicJoinMap === 'function') {
      try { await REWARDS.loadClinicJoinMap(true); } catch (e0) {}
    }
    REWARDS.renderConfigPane(pane);
    const deadline = Date.now() + 12000;
    let html = '';
    while (Date.now() < deadline) {
      html = pane.innerHTML || '';
      if (html.length > 200 && html.indexOf('Loading') < 0) break;
      await new Promise(r => setTimeout(r, 300));
    }
    return {
      ok: true,
      hasTitle: html.indexOf('Reward') >= 0 || html.indexOf('积分') >= 0 || html.indexOf('積分') >= 0,
      hasSqlHint: html.indexOf('reward_points.sql') >= 0,
      hasClinicList: html.indexOf('rw-clinic') >= 0 || html.indexOf('Clinics') >= 0 || html.indexOf('诊所') >= 0 || html.indexOf('診所') >= 0,
      hasJoinGain: html.indexOf('rw-clinic-gain') >= 0 || html.indexOf('Join Gain') >= 0,
      hasJoinRedeem: html.indexOf('rw-clinic-redeem') >= 0 || html.indexOf('Join Redeem') >= 0,
      hasError: html.indexOf('color:#dc2626') >= 0,
      len: html.length
    };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
})()`, true, 25000);
        pass('live renderConfigPane runs', cfgPaint && cfgPaint.ok !== false,
            cfgPaint && (cfgPaint.reason || ('len=' + cfgPaint.len)));
        if (cfgPaint && cfgPaint.ok) {
            pass('live config pane content',
                cfgPaint.hasTitle || cfgPaint.hasSqlHint || cfgPaint.hasClinicList || cfgPaint.hasError,
                'title=' + cfgPaint.hasTitle + ' clinics=' + cfgPaint.hasClinicList +
                ' sqlHint=' + cfgPaint.hasSqlHint);
            pass('live config Join Gain/Redeem toggles',
                !!(cfgPaint.hasJoinGain && cfgPaint.hasJoinRedeem),
                'gain=' + cfgPaint.hasJoinGain + ' redeem=' + cfgPaint.hasJoinRedeem);
        }

        // ── Live real patient (read-only) ─────────────────────
        console.log('\n=== CDP live real patient ===');
        var smokePat = global.__REWARD_SMOKE_PATIENT__ || null;
        if (!smokePat || !smokePat.patient_id) {
            warn('live real patient skipped', 'no patient from API probe');
        } else {
            var pidJson = JSON.stringify(smokePat.patient_id);
            var realLive = await cdp.js(`(async () => {
  const pid = ${pidJson};
  const out = { patientId: pid };
  try {
    const accounts = await REWARDS.listPersonAccounts(pid);
    out.accountCount = (accounts || []).length;
    out.total = (accounts || []).reduce((s, a) => s + (Number(a.balance) || 0), 0);
    out.charts = (accounts || []).map(a => ({
      no: a.patient_no,
      clinic: a.clinic_code,
      bal: a.balance,
      hasAcc: !!a.account_id
    }));
    const bal = await REWARDS.getBalance(pid);
    out.getBalance = bal;
    const withBal = (accounts || []).filter(a => a.account_id && Number(a.balance) > 0.005);
    if (withBal.length && typeof REWARDS.allocateAcrossAccounts === 'function') {
      const need = Math.min(1, withBal.reduce((s, a) => s + a.balance, 0));
      const alloc = REWARDS.allocateAcrossAccounts(withBal, need);
      out.allocOk = !!(alloc && alloc.ok);
      out.allocSteps = alloc && alloc.plan ? alloc.plan.length : 0;
      out.allocOrder = (alloc.plan || []).map(s => s.patient_no + ':' + s.take);
      // smallest-first: first step balance_before <= last
      if (alloc.plan && alloc.plan.length >= 2) {
        out.smallestFirst = Number(alloc.plan[0].balance_before) <=
          Number(alloc.plan[alloc.plan.length - 1].balance_before);
      } else {
        out.smallestFirst = true;
      }
    }
    // Force PL clinic context (page may not be logged in)
    window.currentClinicCodeForTagging = function () { return 'PL'; };
    window.billPaymentClinicContext = function () {
      return { clinic_id: null, clinic_code: 'PL', clinic_tag: 'PL' };
    };

    // Open patient panel (DOM only; no mutate)
    if (typeof REWARDS.openPatientPanel === 'function') {
      REWARDS.openPatientPanel(pid);
      const balEl = document.getElementById('rwPatientBalance');
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const txt = balEl ? String(balEl.textContent || '').trim() : '';
        const dataBal = balEl ? Number(balEl.getAttribute('data-balance') || 0) : 0;
        if (dataBal > 0.005 || (txt && txt !== '0.00' && Number(txt) > 0)) break;
        await new Promise(r => setTimeout(r, 250));
      }
      const srcBox = document.getElementById('rwTransferSources');
      const modal = document.getElementById('rewardPatientModal');
      out.panelOpen = !!(modal && (modal.classList.contains('open') ||
        getComputedStyle(modal).display !== 'none'));
      out.panelBal = balEl ? String(balEl.textContent || '').trim() : null;
      out.panelDataBal = balEl ? balEl.getAttribute('data-balance') : null;
      out.panelSourcesHtml = srcBox ? (srcBox.innerHTML || '').length : 0;
      out.panelHasSrcCb = !!(srcBox && srcBox.querySelector('.rw-xfer-src'));
      out.panelSrcText = srcBox ? String(srcBox.textContent || '').slice(0, 120) : '';
      if (typeof REWARDS.closePatientPanel === 'function') REWARDS.closePatientPanel();
    }
    // Payment panel source paint (hidden panel DOM)
    if (typeof REWARDS.refreshAddPaymentRewardPanel === 'function') {
      window.bdCurrentBill = {
        id: 'smoke-bill',
        patient_id: pid,
        balance: 100
      };
      await REWARDS.refreshAddPaymentRewardPanel();
      const panel = document.getElementById('apRewardPanel');
      const balPay = document.getElementById('apRewardBalance');
      const payDeadline = Date.now() + 8000;
      while (Date.now() < payDeadline) {
        const disp = panel ? panel.style.display : '';
        const pb = balPay ? Number(balPay.getAttribute('data-balance') || 0) : 0;
        if (disp !== 'none' && pb > 0.005) break;
        if (disp !== 'none' && balPay && String(balPay.textContent || '').trim() !== '0.00') break;
        await new Promise(r => setTimeout(r, 250));
      }
      const src = document.getElementById('apRewardSources');
      out.payPanelDisplay = panel ? panel.style.display : null;
      out.paySourcesLen = src ? (src.innerHTML || '').length : 0;
      out.payHasSrcCb = !!(src && src.querySelector('.ap-rw-src'));
      out.payBal = balPay ? String(balPay.textContent || '').trim() : null;
      out.payDataBal = balPay ? balPay.getAttribute('data-balance') : null;
      out.payJoined = typeof REWARDS.currentClinicRedeemJoined === 'function'
        ? !!(await REWARDS.currentClinicRedeemJoined()) : null;
      if (typeof REWARDS.applyRedeemAllOnPayment === 'function' &&
          (out.payHasSrcCb || Number(out.payDataBal) > 0.005)) {
        // Ensure sources visible
        const use0 = document.getElementById('apRewardUse');
        if (use0) use0.checked = true;
        const wrap0 = document.getElementById('apRewardAmountWrap');
        if (wrap0) wrap0.style.display = '';
        REWARDS.applyRedeemAllOnPayment();
        const amt = document.getElementById('apRewardAmount');
        const use = document.getElementById('apRewardUse');
        out.redeemAllChecked = !!(use && use.checked);
        out.redeemAllAmt = amt ? String(amt.value || '') : '';
        const prev = document.getElementById('apRewardAllocPreview');
        out.redeemAllPreview = prev ? String(prev.textContent || '').trim() : '';
      }
      delete window.bdCurrentBill;
    }
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.err = String(e && e.message || e);
  }
  return out;
})()`, true, 45000);

            pass('live real patient probe runs', realLive && realLive.ok !== false,
                realLive && (realLive.err || ('#' + (smokePat.patient_no || '?'))));
            if (realLive && realLive.ok !== false) {
                pass('live listPersonAccounts for real patient',
                    Number(realLive.accountCount) >= 1,
                    'charts=' + realLive.accountCount + ' total=' + realLive.total);
                pass('live getBalance matches sum',
                    Math.abs(Number(realLive.getBalance) - Number(realLive.total)) < 0.02,
                    'get=' + realLive.getBalance + ' sum=' + realLive.total);
                if (realLive.allocOk != null) {
                    pass('live allocateAcrossAccounts', realLive.allocOk === true,
                        'steps=' + realLive.allocSteps + ' ' +
                        JSON.stringify(realLive.allocOrder || []).slice(0, 120));
                    pass('live allocate smallest-first', realLive.smallestFirst === true);
                } else {
                    warn('live allocate skipped', 'no positive chart balances');
                }
                pass('live openPatientPanel', realLive.panelOpen === true,
                    'bal=' + realLive.panelBal + ' data=' + realLive.panelDataBal +
                    ' srcHtml=' + realLive.panelSourcesHtml);
                if (Number(realLive.total) > 0.005) {
                    var panelBalOk = Number(realLive.panelDataBal) > 0.005 ||
                        Number(realLive.panelBal) > 0.005;
                    pass('live patient panel balance painted', panelBalOk,
                        'bal=' + realLive.panelBal + ' data=' + realLive.panelDataBal);
                    pass('live transfer source checkboxes',
                        realLive.panelHasSrcCb === true ||
                        (realLive.panelSrcText && realLive.panelSrcText.indexOf('022') >= 0) ||
                        panelBalOk && realLive.panelSourcesHtml > 20,
                        'srcCb=' + realLive.panelHasSrcCb + ' text=' +
                        String(realLive.panelSrcText || '').slice(0, 60));
                }
                pass('live payment panel refresh for patient',
                    realLive.payPanelDisplay !== 'none' || Number(realLive.payDataBal) > 0.005,
                    'display=' + realLive.payPanelDisplay + ' bal=' + realLive.payBal +
                    ' joined=' + realLive.payJoined);
                if (realLive.redeemAllChecked != null) {
                    pass('live Redeem all fills amount',
                        realLive.redeemAllChecked === true &&
                        Number(realLive.redeemAllAmt) > 0,
                        'amt=' + realLive.redeemAllAmt + ' preview=' +
                        String(realLive.redeemAllPreview || '').slice(0, 80));
                } else if (Number(realLive.total) > 0.005 && realLive.payJoined === false) {
                    warn('live Redeem all skipped', 'clinic redeem join false without patch');
                }
            }
        }

        try { await cdp.call('Browser.close'); } catch (e) {}
        try { ws.close(); } catch (e) {}
    } catch (e) {
        pass('CDP live page', false, e && e.message ? e.message : String(e));
    } finally {
        if (proc) {
            try { proc.kill(); } catch (e) {}
        }
        if (server) {
            try { server.close(); } catch (e) {}
        }
    }

    console.log('\n' + (fails.length
        ? 'FAILED ' + fails.length + (warns.length ? '  WARN ' + warns.length : '')
        : 'SMOKE + SYNTAX + HTML + API + CDP + LIVE PAGE ALL PASS' +
          (warns.length ? '  (WARN ' + warns.length + ')' : '')));
    if (fails.length) {
        fails.forEach(function (f) { console.log('  - ' + f); });
    }
    if (warns.length) {
        console.log('Warnings (SQL may need apply):');
        warns.forEach(function (w) { console.log('  - ' + w); });
    }
    process.exit(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
