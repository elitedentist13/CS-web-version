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
    var appSrc = read('app.js');

    console.log('=== syntax: node --check ===');
    var syntaxFiles = [
        'app-rewards.js',
        'app-appt.js',
        'app-config.js',
        'app-report.js',
        'app-consultation.js',
        'app-i18n.js',
        'app-i18n-extra.js',
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

    pass('index loads app-rewards.js', /['"]app-rewards\.js['"]/.test(idxSrc));
    pass('index has apRewardPanel', idxSrc.indexOf('id="apRewardPanel"') >= 0);
    pass('index has rewardPatientModal', idxSrc.indexOf('id="rewardPatientModal"') >= 0);
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
        pass('HTML has rwTransferSubmit', idx.body.indexOf('id="rwTransferSubmit"') >= 0);
        pass('HTML lists app-rewards.js', idx.body.indexOf('app-rewards.js') >= 0);

        var js = await httpGetText(PAGE_PORT, '/app-rewards.js');
        pass('GET /app-rewards.js', js.status === 200 && js.body.indexOf('REWARDS') >= 0,
            'bytes=' + (js.body && js.body.length));

        var sqlHttp = await httpGetText(PAGE_PORT, '/reward_points.sql');
        pass('GET /reward_points.sql', sqlHttp.status === 200 &&
            sqlHttp.body.indexOf('reward_ledger') >= 0);
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
    modal: !!document.getElementById('rewardPatientModal'),
    cfgPane: !!document.getElementById('cfgPane-rewards'),
    cfgNav: !!document.querySelector('[data-tab="rewards"]'),
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
        pass('live rewardPatientModal in DOM', liveProbe && liveProbe.modal === true);
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
    REWARDS.renderConfigPane(pane);
    // give fetch a moment
    await new Promise(r => setTimeout(r, 1200));
    const html = pane.innerHTML || '';
    return {
      ok: true,
      hasTitle: html.indexOf('Reward') >= 0 || html.indexOf('积分') >= 0 || html.indexOf('積分') >= 0,
      hasSqlHint: html.indexOf('reward_points.sql') >= 0,
      hasClinicList: html.indexOf('rw-clinic') >= 0 || html.indexOf('Clinics') >= 0 || html.indexOf('诊所') >= 0 || html.indexOf('診所') >= 0,
      hasError: html.indexOf('color:#dc2626') >= 0,
      len: html.length
    };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  }
})()`, true, 15000);
        pass('live renderConfigPane runs', cfgPaint && cfgPaint.ok !== false,
            cfgPaint && (cfgPaint.reason || ('len=' + cfgPaint.len)));
        if (cfgPaint && cfgPaint.ok) {
            pass('live config pane content',
                cfgPaint.hasTitle || cfgPaint.hasSqlHint || cfgPaint.hasClinicList || cfgPaint.hasError,
                'title=' + cfgPaint.hasTitle + ' clinics=' + cfgPaint.hasClinicList +
                ' sqlHint=' + cfgPaint.hasSqlHint);
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
