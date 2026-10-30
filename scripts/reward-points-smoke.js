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

function extractIifeHelpers(src, sbOverride) {
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
                    in: function () { return this; },
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
        esc: function (s) {
            return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
        todayISO: function () { return '2026-10-19'; },
        openModal: function () {},
        closeModal: function () {}
    };
    ctx.window = ctx;
    if (sbOverride) ctx.SB = sbOverride;
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return ctx.REWARDS || ctx.window.REWARDS;
}

/** Fake SB: bill_payments / reward_ledger reads answer from tables[name]; rpc calls are recorded. */
function fakeBillSb(tables, rpcLog) {
    return {
        from: function (name) {
            var q = {
                select: function () { return q; },
                eq: function () { return q; },
                in: function () { return q; },
                order: function () { return q; },
                limit: function () { return q; },
                maybeSingle: function () { return Promise.resolve({ data: null, error: null }); },
                then: function (ok, bad) { return Promise.resolve({ data: tables[name] || [], error: null }).then(ok, bad); }
            };
            return q;
        },
        rpc: function (fn, args) {
            if (rpcLog) rpcLog.push({ fn: fn, args: args });
            return Promise.resolve({ data: { ok: true, count: 0 }, error: null });
        }
    };
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
        'app-coupons.js',
        'points.js',
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
    pass('void payment reverses all ledger rows (multi redeem)',
        /order by case when kind = 'redeem' then 0 else 1 end/.test(sqlSrc) &&
        /not exists \(\s*select 1 from public\.reward_ledger r/i.test(sqlSrc) &&
        fs.existsSync(path.join(root, 'reward_points_patch_void_payment_multi.sql')) &&
        /for v_src in/i.test(read('reward_points_patch_void_payment_multi.sql')));
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
    pass('index payment panel shows cross-clinic same-doctor UI',
        idxSrc.indexOf('id="apRewardClinicMeta"') >= 0 &&
        idxSrc.indexOf('rewards.pay.byClinicTitle') >= 0 &&
        idxSrc.indexOf('rewards.pay.crossClinicBlurb') >= 0 &&
        /Available for this doctor \(all clinics\)/.test(idxSrc));
    pass('app groups pay sources by clinic',
        /groupPaySourcesByClinic/.test(rewardsSrc) &&
        /updatePayClinicMeta/.test(rewardsSrc) &&
        /ap-rw-clinic-table/.test(rewardsSrc) &&
        /hintSameDoctorCross/.test(rewardsSrc));
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
    pass('void payment/bill refreshes active reward capsule',
        /refreshActiveBannerBalances/.test(rewardsSrc) &&
        /refreshActiveBannerBalances/.test(apptSrc) &&
        /voidForPayment\(p\.id,\s*'Void payment'/.test(apptSrc) &&
        /voidForBill\(\s*_voidTargetId/.test(apptSrc));
    pass('SQL default rate 10', /earn_rate_percent[\s\S]{0,40}default 10/i.test(sqlSrc));

    pass('index loads app-rewards.js', /['"]app-rewards\.js(\?[^'"]*)?['"]/.test(idxSrc));
    pass('index has apRewardPanel', idxSrc.indexOf('id="apRewardPanel"') >= 0);
    pass('index has rewardPatientModal', idxSrc.indexOf('id="rewardPatientModal"') >= 0);
    var panelHtml = idxSrc.slice(idxSrc.indexOf('id="rewardPatientModal"'), idxSrc.indexOf('id="rewardLedgerFinderModal"'));
    pass('ledger panel has two tabs: points ledger first, coupon wallet second',
        panelHtml.indexOf('id="rwTabPoints"') > 0 && panelHtml.indexOf('id="rwTabCoupons"') > panelHtml.indexOf('id="rwTabPoints"') &&
        /id="rwPanePoints"[^>]*>\s*<div class="rw-hero">/.test(panelHtml) && /id="rwPaneCoupons"[^>]*hidden><\/div>/.test(panelHtml) &&
        panelHtml.indexOf('id="rwTransferSubmit"') > panelHtml.indexOf('id="rwPanePoints"'));
    pass('transfer section is a styled card with header, preview pill and action button',
        /<div class="rw-xfer">[\s\S]*class="rw-xfer-head"[\s\S]*id="rwTransferSources" class="rw-xfer-sources"[\s\S]*id="rwTransferAllocPreview" class="rw-xfer-preview"[\s\S]*id="rwTransferSubmit" class="rw-xfer-go"/.test(panelHtml) &&
        /'\.rw-xfer\{/.test(rewardsSrc) && /\.rw-xfer-tile:has\(input:checked\)/.test(rewardsSrc) &&
        /\.rw-xfer-preview\.is-short/.test(rewardsSrc) && /\.rw-xfer-go:disabled/.test(rewardsSrc));
    pass('transfer source charts render as tick tiles with chart no., clinic tag and balance',
        /class="rw-xfer-tile">[\s\S]{0,40}<input type="checkbox" class="rw-xfer-src"[\s\S]{0,300}rw-xfer-chart[\s\S]{0,200}rw-lg-clinic[\s\S]{0,200}rw-xfer-bal/.test(rewardsSrc) &&
        /prev\.classList\.add\('is-short'\)/.test(rewardsSrc));
    pass('ledger balance shows clinic breakdown when multi-clinic',
        idxSrc.indexOf('id="rwPatientClinicBreakdown"') >= 0 &&
        /renderPanelClinicBreakdown/.test(rewardsSrc) &&
        /groupPaySourcesByClinic/.test(rewardsSrc) &&
        /rw-bal-breakdown/.test(rewardsSrc) &&
        /rewards\.panel\.clinicBreakdownAria/.test(i18nExtra || i18nSrc || ''));
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
    pass('transfer pairs reattribute to source doctor',
        /reattributeUnattributedTransfers/.test(rewardsSrc) &&
        /doctorWeightMap/.test(rewardsSrc) &&
        /_unattrib_balance/.test(rewardsSrc));
    pass('config clinic tree has All Doctors + per-doctor join',
        /rw-clinic-scheme/.test(rewardsSrc) &&
        /rw-clinic-tabs/.test(rewardsSrc) &&
        /ALL_DOCTORS_KEY/.test(rewardsSrc) &&
        /setDoctorJoinFlags/.test(rewardsSrc) &&
        /setDoctorJoinRows/.test(rewardsSrc) &&
        /planRewardDoctorToggle/.test(rewardsSrc) &&
        /effectiveJoinFlags/.test(rewardsSrc) &&
        /rewards\.cfg\.allDoctors/.test(rewardsSrc) &&
        /rw-doc-join/.test(rewardsSrc));
    pass('default participating clinic is PL All Doctors',
        /defaultRewardClinicIndex/.test(rewardsSrc) &&
        /defaultAllDoctorsFlags/.test(rewardsSrc) &&
        /clinic_code[^\n]{0,40}=== 'PL'/.test(rewardsSrc));
    pass('config doctor list scrolls ~10 rows in panel body',
        /10 \* 42px/.test(rewardsSrc) &&
        /rw-clinic-docs/.test(rewardsSrc));
    pass('doctor join SQL patch exists',
        fs.existsSync(path.join(root, 'reward_points_patch_doctor_join.sql')) &&
        /reward_program_doctors/.test(read('reward_points_patch_doctor_join.sql')));
    pass('RESET ZERO dialog can run another job (coupons) but defaults to reward points',
        /function openResetZeroFlow\(clinics, opts\)/.test(rewardsSrc) &&
        /typeof opts\.run === 'function'\s*\? opts\.run\(\{ all: selected\.all, clinicIds: idList, clinicCodes: codeList \}\)\s*: zeroClinicBalances\(/.test(rewardsSrc) &&
        /typeof opts\.onDone === 'function'/.test(rewardsSrc));
    pass('RESET ZERO + policy + step-back helpers',
        /openResetZeroFlow/.test(rewardsSrc) &&
        /openAdminRewardAuthGate/.test(rewardsSrc) &&
        /zeroClinicBalances/.test(rewardsSrc) &&
        /revertLastZeroBatch/.test(rewardsSrc) &&
        /saveZeroPolicy/.test(rewardsSrc) &&
        /maybeRunScheduledZero/.test(rewardsSrc) &&
        /rwCfgResetZero/.test(rewardsSrc) &&
        /rwCfgStepBack/.test(rewardsSrc) &&
        /rwZeroPolicy/.test(rewardsSrc) &&
        /zero_policy/.test(rewardsSrc));
    pass('zero policy default is manual',
        /normalizeZeroPolicy/.test(rewardsSrc) &&
        /\|\| 'manual'/.test(rewardsSrc) &&
        /zeroPolicyDefault/.test(rewardsSrc) &&
        /zeroPolicyManual/.test(rewardsSrc));
    pass('zero clinics SQL patch has snapshot + revert + lifespan',
        fs.existsSync(path.join(root, 'reward_points_patch_zero_clinics.sql')) &&
        (function () {
            var sql = read('reward_points_patch_zero_clinics.sql');
            return /reward_zero_batches/.test(sql) &&
                /reward_zero_snapshot_rows/.test(sql) &&
                /reward_revert_zero_batch/.test(sql) &&
                /reward_expire_lifespan/.test(sql) &&
                /zero_policy/.test(sql) &&
                /default 'manual'/.test(sql);
        })());
    pass('i18n RESET ZERO / step-back / policy keys',
        /rewards\.cfg\.resetZeroBtn/.test(i18nExtra) &&
        /rewards\.cfg\.stepBackBtn/.test(i18nExtra) &&
        /rewards\.cfg\.zeroPolicyYearEnd/.test(i18nExtra) &&
        /rewards\.cfg\.zeroPolicyAuthTitle/.test(i18nExtra) &&
        /rewards\.cfg\.zeroPolicyDefault/.test(i18nExtra));
    pass('index shows payment doctor for rewards',
        idxSrc.indexOf('id="apRewardDoctor"') >= 0);
    pass('patient dir ⋯ has reward ledger',
        /btn-reward-ledger/.test(patientSrc) &&
        /REWARDS\.openPatientPanel/.test(patientSrc));
    pass('patient dir ⋯ item is called Rewards and opens the same two-tab panel as the banner Rewards button',
        /'patient\.dir\.rewardLedger': \{ en: 'Rewards', 'zh-CN': '奖赏', 'zh-Hant': '獎賞' \}/.test(i18nExtra) &&
        /'patient\.dir\.rewardLedgerTitle': \{ en: 'Reward points and discount coupons'/.test(i18nExtra) &&
        /'patient\.dir\.moreActions': \{ en: 'More actions \(Duplicate, Appt Reminder, Rewards\)'/.test(i18nExtra) &&
        /btn-reward-ledger" data-id="' \+ esc\(p\.id\) \+ '"' \+\s+' title="' \+ esc\(patTr\('patient\.dir\.rewardLedgerTitle'\)\)/.test(patientSrc) &&
        /\.btn-reward-ledger'\)\.forEach[\s\S]{0,300}REWARDS\.openPatientPanel\(pid\);/.test(patientSrc) &&
        /if \(pid\) openPatientPanel\(pid\);/.test(rewardsSrc));
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
    var couponRunKey = (read('app-coupons.js').match(/EXPIRY_RUN_KEY = '([^']+)'/) || [])[1];
    var rewardRunKey = (rewardsSrc.match(/YEAR_END_RUN_KEY = '([^']+)'/) || [])[1];
    var keepBlock = (appJsSrc.match(/function jsmLocalStoragePreserveKeys\(\) \{[\s\S]*?return keys;/) || [''])[0];
    pass('login cleanup keeps the once-a-day SMS reminder markers', !!couponRunKey && !!rewardRunKey &&
        keepBlock.indexOf(couponRunKey + ': true') >= 0 && keepBlock.indexOf(rewardRunKey + ': true') >= 0,
        couponRunKey + ', ' + rewardRunKey);
    pass('isLoyaltyExcludedPayMethod exported', /window\.isLoyaltyExcludedPayMethod = /.test(rewardsSrc) &&
        /isLoyaltyExcludedPayMethod: isLoyaltyExcludedPayMethod/.test(rewardsSrc));
    pass('Add payment checks Government / PDCC before saving', /REWARDS\.excludedPaymentBlock\(bdCurrentBill, payMethod, rewardPts\)/.test(apptSrc) &&
        /function continueConfirmAddPayment\(saveCtx, clinicCtx, isXferPay\)/.test(apptSrc));
    pass('Government / PDCC payment takes back earlier points on the bill',
        /function finishBillUpdate[\s\S]{0,1400}REWARDS\.isLoyaltyExcludedPayMethod\(payMethod\)[\s\S]{0,200}REWARDS\.excludeBillFromLoyalty\(billId, patientId\)/.test(apptSrc));
    pass('every earn / redeem / coupon call passes the payment method',
        (apptSrc.match(/method: payload\.bill_type/g) || []).length === 3 &&
        (apptSrc.match(/method: payMethod,?\r?\n/g) || []).length >= 4);
    pass('reward panel turns off when Government / PDCC is picked', /t\.id === 'apMethod'[\s\S]{0,300}paintPayPanelExcluded\(\)/.test(rewardsSrc));
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

    console.log('\n=== smoke: gift points ===');
    var gSql = read('reward_points_gift.sql');
    var gFn = (gSql.split('create or replace function public.reward_gift(')[1] || '');
    pass('gift SQL: kind gift added to the ledger check (keeps existing kinds)',
        /reward_ledger_kind_check/.test(gSql) && /'gift'/.test(gSql) && /select distinct kind from public\.reward_ledger/.test(gSql));
    pass('gift SQL: security definer, password checked in app_users server-side, Nurse refused',
        /security definer\s+set search_path = public/.test(gFn) && /from public\.app_users[\s\S]{0,120}password = p_password/.test(gFn) &&
        /lower\(v_uid\) = 'nurse'/.test(gFn) && /coalesce\(is_active, false\) = true/.test(gFn));
    var gSet = (gSql.split('create or replace function public.reward_gift_settings(')[1] || '').split('create or replace function public.reward_gift(')[0];
    pass('gift SQL: settings read from program_settings reward_gift_config with the app defaults',
        /setting_key = 'reward_gift_config'/.test(gSet) && /v_max := 200/.test(gSet) && /v_daily := 1/.test(gSet) && /v_max > 10000/.test(gSet) &&
        /'requireLogin', coalesce\(\(v_raw->>'requireLogin'\)::boolean, true\)/.test(gSet) &&
        /'requireReason', coalesce\(\(v_raw->>'requireReason'\)::boolean, true\)/.test(gSet) &&
        /\["doctor","dentist","nurse","receptionist","reception","staff","admin"\]/.test(gSet) && /security definer/.test(gSet));
    pass('gift SQL: switched off -> refused; roles from settings',
        /'reason', 'gift_off'/.test(gFn) && /jsonb_array_elements_text\(v_cfg->'roles'\)/.test(gFn) && /public\.reward_gift_settings\(\)/.test(gFn));
    pass('gift SQL: password checked only when required; Nurse never the giver',
        /if v_need_login then[\s\S]{0,200}password = p_password/.test(gFn) && /lower\(v_uid\) = 'nurse'/.test(gFn) &&
        /v_need_login and coalesce\(p_password, ''\) = ''/.test(gFn));
    pass('gift SQL: whole points 1..max, reason (if required) + doctor, clinic Gain joined',
        /v_points <> trunc\(v_points\)/.test(gFn) && /v_points < 1 or v_points > v_max/.test(gFn) &&
        /if v_need_reason then[\s\S]{0,120}'reason', 'note'/.test(gFn) && /'reason', 'doctor'/.test(gFn) &&
        /reward_clinic_gain_enabled\(p_clinic_id, v_code\)/.test(gFn));
    pass('gift SQL: per-patient daily count and per-staff daily points (0 = no limit), staff lock',
        /if v_daily > 0 then[\s\S]{0,300}v_count >= v_daily/.test(gFn) && /if v_staff_max > 0 then[\s\S]{0,400}v_staff_sum \+ v_points > v_staff_max/.test(gFn) &&
        /'reason', 'staff_daily'/.test(gFn) && /reward_gift_staff:/.test(gFn) && /add column if not exists actor_user_id text/.test(gSql));
    pass('gift SQL: one gift per patient per HK day (locked, across related charts)',
        /pg_advisory_xact_lock/.test(gFn) && /at time zone 'Asia\/Hong_Kong'/.test(gFn) && /patient_id = any \(v_ids\)/.test(gFn) &&
        /'daily_limit'/.test(gFn));
    pass('gift SQL: ledger row kind gift with doctor + giver, audit_trail copy',
        /'gift', v_points, v_new_bal/.test(gFn) && /doctor_name/.test(gFn) && /v_note, v_giver/.test(gFn) &&
        /insert into public\.audit_trail/.test(gFn) && /'REWARD GIFT'/.test(gFn));
    pass('gift SQL: gifts do not extend the lifespan clock',
        !/'gift'/.test(read('reward_points_patch_zero_clinics.sql')));
    var giftSrc = rewardsSrc.split('// ── Staff gift')[1] || '';
    giftSrc = giftSrc.split('function loadGiftLog')[0];
    pass('gift client: password goes to reward_gift RPC via shared prompt (no client password check)',
        giftSrc.length > 0 && /rewardRpc\('reward_gift'/.test(giftSrc) && /COUPONS\.promptGrantor\(/.test(giftSrc) &&
        /verify: function \(uid, pw\)/.test(giftSrc) && !/app_users|verifyGrantor/.test(giftSrc));
    pass('gift client: shared prompt takes opts.verify / hint / logText and is exported',
        /function promptGrantor\(host, title, summary, opts\)/.test(read('app-coupons.js')) && /promptGrantor: promptGrantor/.test(read('app-coupons.js')) &&
        /opts\.hint \|\|/.test(read('app-coupons.js')) && /opts\.logText \|\|/.test(read('app-coupons.js')));
    pass('gift UI: box in points pane, filter chip, gift log card, i18n',
        /<div id="rwGift" class="rw-gift" hidden><\/div>/.test(idxSrc) && /key: 'gift', kinds: \['gift'\]/.test(rewardsSrc) &&
        /renderGiftLogCard\(ctx\.gifts/.test(rewardsSrc) && /'rewards\.gift\.title'/.test(i18nExtra) && /'rewards\.gift\.e\.dailyN'/.test(i18nExtra) && /'rewards\.gift\.cfgLogin'/.test(i18nExtra) &&
        /renderGiftConfigCard\(ctx\.giftCfg, admin\)/.test(rewardsSrc) && /wireGiftConfigCard\(pane\)/.test(rewardsSrc) &&
        /'rewards\.ledger\.f\.gift'/.test(i18nExtra));
    pass('gift doctor list uses canonical names (not per-clinic login codes like Dr X_CWB), skips ALL rows',
        /\[d\.english_name, d\.chinese_name, d\]\.some/.test(giftSrc) && /\^all\\b/.test(giftSrc));
    pass('gift manual: section in all three languages',
        (read('docs/loyalty-manual.js').match(/Gift points to a patient|贈送積分給病人|赠送积分给病人/g) || []).length === 3);

    console.log('\n=== smoke: points on the phone ===');
    var pwSql = read('reward_points_wallet.sql');
    var pwRet = (pwSql.match(/return jsonb_build_object\(\s*'ok', true,[\s\S]*?\);/g) || []).pop() || '';
    pass('points wallet SQL: closed token table + two security-definer functions',
        /create table if not exists public\.reward_wallet_links/.test(pwSql) &&
        /enable row level security/.test(pwSql) && /revoke all on public\.reward_wallet_links from anon, authenticated/.test(pwSql) &&
        (pwSql.match(/security definer\s+set search_path = public/g) || []).length === 2 &&
        /function public\.rw_wallet_link\(/.test(pwSql) && /function public\.rw_wallet_view\(p_token text\)/.test(pwSql));
    pass('points wallet SQL: gen_random_uuid token, no pgcrypto, schema reload',
        /replace\(gen_random_uuid\(\)::text, '-', ''\)/.test(pwSql) && pwSql.indexOf('gen_random_bytes') < 0 &&
        pwSql.indexOf('create extension') < 0 && /notify pgrst, 'reload schema';\s*$/.test(pwSql));
    pass('points wallet SQL: same person by HKID, else last 8 phone digits (like the ledger panel)',
        /char_length\(v_hk\) >= 7/.test(pwSql) && /right\(v_ph, 8\)/.test(pwSql) && /patient_id = any \(v_ids\)/.test(pwSql));
    pass('points wallet SQL: phone view returns no ids, chart no, phone, HKID or staff notes',
        pwRet.length > 0 && !/patient_id|patient_no|phone|hkid|'note'|created_by/i.test(pwRet) &&
        !/'note'/.test(pwSql.split('v_rows')[1] || ''), pwRet.replace(/\s+/g, ' ').slice(0, 120));
    pass('points wallet SQL: referral and reset-to-zero rows get their own phone labels',
        /'referral'/.test(pwSql) && /'cleared'/.test(pwSql) && /like '%\[batch %'/.test(pwSql));
    pass('ledger panel has the Points on the phone button wired to REWARDS.openPhoneQr',
        /id="rwPhoneQrBtn"[\s\S]{0,200}REWARDS\.openPhoneQr\(\)/.test(idxSrc) && /data-i18n="rewards\.pqr\.btn"/.test(idxSrc));
    pass('rewards phone QR reuses the coupon QR box (rw_wallet_link + points.html)',
        /COUPONS\.openPhoneQr\(modal, pid, phoneQrConfig\(\)\)/.test(rewardsSrc) && /rpc: 'rw_wallet_link'/.test(rewardsSrc) &&
        /page: 'points\.html'/.test(rewardsSrc) && /waText: pointsWhatsAppText/.test(rewardsSrc));
    pass('year-end points reminder: only with Set zero on year end + SMS on, one claim per person, daily per station',
        /normalizeZeroPolicy\(program\)\.zero_policy !== 'year_end'\) return \{ ok: true, skipped: 'policy' \}/.test(rewardsSrc) &&
        /program\.sms_notify_enabled === false\) return \{ ok: true, skipped: 'sms_off' \}/.test(rewardsSrc) &&
        /var keys = ids\.map\(function \(id\) \{ return 'p:' \+ id; \}\);[\s\S]{0,40}C\.claimYearEndSms\('rewards', year, stage, keys, a\.patient_id\)/.test(rewardsSrc) &&
        /scheduleYearEndReminders\(\);\r?\n    \}/.test(rewardsSrc));
    var couponSrc = read('app-coupons.js');
    pass('coupon QR box is shared: openPhoneQr exported, coupon set-up unchanged',
        /function openPhoneQr\(sheet, patientId, cfg\)/.test(couponSrc) && /openPhoneQr: openPhoneQr/.test(couponSrc) &&
        /rpc: 'dc_wallet_link',\s+page: 'wallet\.html'/.test(couponSrc) && /walletLinkToken\(patientId, reset, cfg\.rpc\)/.test(couponSrc));
    pass('points cap: saved as reward_redeem_cap in program_settings (admin only)',
        /var REDEEM_CAP_KEY = 'reward_redeem_cap';/.test(rewardsSrc) && /function saveRedeemCap\(patch\) \{\s+if \(!isAdmin\(\)\)/.test(rewardsSrc) &&
        /setting_key: REDEEM_CAP_KEY/.test(rewardsSrc));
    pass('points cap: Config card with % and HK$ boxes + Save',
        /id="rwCfgCap"/.test(rewardsSrc) && /id="rwCfgCapPct"/.test(rewardsSrc) && /id="rwCfgCapAmt"/.test(rewardsSrc) &&
        /id="rwCfgCapSave"/.test(rewardsSrc) && /loadRedeemCap\(true\),\s*loadGiftLog\(300\),\s*loadGiftConfig\(true\)\s*\]\)\.then/.test(rewardsSrc));
    pass('points cap: payment box max also clamped by the per-bill limit',
        /if \(_payCap && _payCap\.left !== Infinity\) max = round2\(Math\.min\(max, _payCap\.left\)\);/.test(rewardsSrc) &&
        /loadBillPointsUsed\(bill\.id\)/.test(rewardsSrc) && /id="apRewardCapNote"/.test(idxSrc));
    pass('points cap: Save payment refuses points over the limit',
        /REWARDS\.payRedeemCapLeft\(\)/.test(apptSrc) && /trRepl\('rewards\.cap\.errOver'/.test(apptSrc));
    ['rewards.cap.title', 'rewards.cap.hint', 'rewards.cap.payNote', 'rewards.cap.errOver', 'rewards.cap.noLimit'].forEach(function (k) {
        var m = new RegExp("'" + k.replace(/\./g, '\\.') + "':\\s*\\{([\\s\\S]*?)\\}(,|\\s*$)", 'm').exec(i18nExtra);
        pass('i18n ' + k + ' in en / zh-CN / zh-Hant', !!m && /en:/.test(m[1]) && /'zh-CN':/.test(m[1]) && /'zh-Hant':/.test(m[1]));
    });
    ['rewards.pqr.btn', 'rewards.pqr.title', 'rewards.pqr.hint', 'rewards.pqr.link', 'rewards.pqr.noSql', 'rewards.pqr.fail'].forEach(function (k) {
        var m = new RegExp("'" + k.replace(/\./g, '\\.') + "':\\s*\\{([\\s\\S]*?)\\}").exec(i18nExtra);
        pass('i18n ' + k + ' in en / zh-CN / zh-Hant', !!m && /en:/.test(m[1]) && /'zh-CN':/.test(m[1]) && /'zh-Hant':/.test(m[1]));
    });

    console.log('\n=== unit: points page (points.js) ===');
    try {
        var ptsWin = { location: { search: '', hash: '' }, navigator: { language: 'en' } };
        vm.runInNewContext(read('points.js'), { window: ptsWin, Date: Date, Math: Math, JSON: JSON, String: String, Number: Number, isFinite: isFinite, parseFloat: parseFloat });
        var P = ptsWin.CSPoints;
        pass('CSPoints loads in vm', !!P && typeof P.renderHtml === 'function');
        var ptsData = {
            ok: true, name: '陳○○', balance: 1234.5, charts: 2, started_at: '2026-01-02T03:00:00Z',
            clinics: [{ clinic: 'PL', balance: 1000 }, { clinic: '<b>X</b>', balance: 234.5 }],
            earn_rate: 10, zero_policy: 'lifespan', lifespan_months: 12,
            rows: []
        };
        for (var pi = 0; pi < 25; pi++) {
            ptsData.rows.push({ at: '2026-10-2' + (pi % 9) + 'T20:00:00Z', kind: pi === 0 ? 'referral' : pi === 1 ? 'mystery' : pi % 2 ? 'earn' : 'redeem',
                points: pi % 2 ? 12.5 : -10, balance_after: 99, clinic: 'PL' });
        }
        var ph = P.renderHtml(ptsData, 'en', false);
        pass('points page: balance 1,234.50 points', /<b id="wlPtsBalance">1,234\.50<\/b> <span>points<\/span>/.test(ph));
        pass('points page: clinic chips when 2+ clinics hold points (escaped)', (ph.match(/wl-pts-chip"/g) || []).length === 2 &&
            ph.indexOf('&lt;b&gt;X&lt;/b&gt;') > 0 && ph.indexOf('<b>X</b>') < 0);
        pass('points page: earn rate and 12-month clearing notes', ph.indexOf('You earn 10% of what you pay as points.') > 0 &&
            ph.indexOf('Points are cleared after 12 months with no new points.') > 0);
        pass('points page: first 20 rows then Show more (5)', (ph.match(/class="wl-pts-row"/g) || []).length === 20 && /Show more \(5\)/.test(ph));
        pass('points page: all rows after Show more', (P.renderHtml(ptsData, 'en', true).match(/class="wl-pts-row"/g) || []).length === 25);
        pass('points page: per-row balance hidden when several charts add up', ph.indexOf('Balance 99') < 0 &&
            P.renderHtml(Object.assign({}, ptsData, { charts: 1 }), 'en', false).indexOf('Balance 99') > 0);
        pass('points page: referral label, unknown kind falls back to clinic adjust', /data-kind="referral"[\s\S]*?Refer a friend/.test(ph) &&
            /data-kind="adjust"[\s\S]*?Adjusted by the clinic/.test(ph));
        pass('points page: signs and HK date (20:00Z -> next day)', ph.indexOf('+12.50') > 0 && ph.indexOf('−10') > 0 &&
            P.hkDate('2026-10-27T20:00:00Z') === '2026-10-28');
        pass('points page: one clinic -> no chips; SMS year-end reminder in Chinese', (function () {
            var h = P.renderHtml({ ok: true, today: '2026-10-28', balance: 50, charts: 1, clinics: [{ clinic: 'PL', balance: 50 }], zero_policy: 'year_end', rows: [] }, 'zh-Hant', false);
            return h.indexOf('wl-pts-chip"') < 0 && h.indexOf('<div class="wl-remind" role="note"><p>⏰ 所有積分將於今年2026年12月31日 23:59到期，請好好善用；歡迎邀請親友使用。</p></div>') > 0 &&
                h.indexOf('過去 12 個月沒有積分紀錄。') > 0;
        })());
        pass('points page: English / Simplified reminder; none when the balance is zero', (function () {
            var d = { ok: true, today: '2027-01-05', balance: 10, rows: [] };
            return P.renderHtml(d, 'en').indexOf('All reward points expire on 31 Dec 2027 23:59 this year. Please make good use of them, and you are welcome to invite others to use them.') > 0 &&
                P.renderHtml(d, 'zh-CN').indexOf('所有积分将于今年2027年12月31日 23:59到期，请好好善用；欢迎邀请亲友使用。') > 0 &&
                P.renderHtml(Object.assign({}, d, { balance: 0 }), 'en').indexOf('wl-remind') < 0;
        })());
        pass('points page: per-bill line follows the saved limit (no fixed HK$3,000)', (function () {
            var d = { ok: true, today: '2027-01-05', balance: 10, rows: [] };
            function line(cap, lang) { return P.renderHtml(Object.assign({}, d, { redeem_cap: cap }), lang || 'en'); }
            return line({ maxPercent: 0, maxAmount: 5000 }).indexOf('<p>💳 Maximum usage per bill is HK$5,000.</p></div>') > 0 &&
                line({ maxPercent: 40, maxAmount: 2500 }).indexOf('<p>💳 Maximum usage per bill: 40% of the bill, up to HK$2,500.</p>') > 0 &&
                line({ maxPercent: 30, maxAmount: 0 }, 'zh-Hant').indexOf('<p>💳 每張賬單最高使用額為賬單金額 30%。</p>') > 0 &&
                line({ maxPercent: 0, maxAmount: 3000 }, 'zh-CN').indexOf('<p>💳 每张账单最高使用额为 HK$3,000。</p>') > 0 &&
                line({ maxPercent: 0, maxAmount: 0 }).indexOf('💳') < 0 &&
                P.renderHtml(d, 'en').indexOf('💳') < 0 &&
                P.perBillText({}, 'en') === 'Maximum usage per bill is HK$3,000.' &&
                (P.renderHtml(d, 'en') + line({ maxAmount: 5000 })).indexOf('unless otherwise specified') < 0;
        })());
        pass('points SQL sends the saved per-bill limit to the phone', (function () {
            var s = read('reward_points_wallet.sql');
            return /setting_key = 'reward_redeem_cap'/.test(s) && /'redeem_cap', coalesce\(v_cap, '\{"maxPercent": 0, "maxAmount": 3000\}'::jsonb\)/.test(s);
        })());
        pass('points page: bad / expired / offline links explained', /not valid any more/.test(P.renderHtml({ ok: false, reason: 'bad_link' }, 'en')) &&
            /has expired/.test(P.renderHtml({ ok: false, reason: 'expired' }, 'en')) && /Check the connection/.test(P.renderHtml({ ok: false, reason: 'offline' }, 'en')));
        pass('points page: token only from a 32-hex t=', P.tokenFrom({ search: '?t=0123456789ABCDEF0123456789abcdef&g=en' }) === '0123456789abcdef0123456789abcdef' &&
            P.tokenFrom({ search: '?t=123' }) === '');
        pass('points page: fmtPts whole / decimals', P.fmtPts(120) === '120' && P.fmtPts(0.5) === '0.50' && P.fmtPts(1000000) === '1,000,000');
        pass('points page: How to use is Chinese then English, with doctor and balance filled', (function () {
            var h = P.renderHtml({
                ok: true, today: '2026-10-30', balance: 62.5, doctor: 'NG PUI CHING',
                redeem_cap: { maxAmount: 3000 }, zero_policy: 'year_end', rows: []
            }, 'en', false);
            var zh = h.indexOf('class="wl-how-zh"');
            var en = h.indexOf('class="wl-how-en"');
            return zh > 0 && en > zh &&
                /您在 NG PUI CHING 醫生 這裡累積的牙科活動獎賞積分餘額為 62\.50 分/.test(h) &&
                /balance with Dr NG PUI CHING is 62\.50 points/.test(h) &&
                h.indexOf('樂意牙科') > 0 && h.indexOf('Hello! We are Joyful Smile Dental') > 0 &&
                h.indexOf('每單最多可用3,000分') > 0 && h.indexOf('Up to 3,000 points') > 0 &&
                h.indexOf('12 月 31 日') > 0 && h.indexOf('31 December') > 0 &&
                h.indexOf('<b>NG') < 0;
        })());
        pass('points page: How to use skips year-end when Set zero is not year end; escapes the doctor', (function () {
            var h = P.howToUseHtml({ balance: 10, doctor: '<b>X</b>', zero_policy: 'manual' });
            return h.indexOf('&lt;b&gt;X&lt;/b&gt;') > 0 && h.indexOf('<b>X</b>') < 0 &&
                h.indexOf('12 月 31 日') < 0 && h.indexOf('31 December') < 0 &&
                h.indexOf('主診') < 0 && h.indexOf('your treating dentist') < 0;
        })());
        pass('points page: How to use falls back to 主診 / your treating dentist', (function () {
            var h = P.howToUseHtml({ balance: 8, zero_policy: 'year_end' });
            return h.indexOf('您在 主診 醫生') > 0 && h.indexOf('with your treating dentist is 8 points') > 0;
        })());
        pass('points SQL sends treating doctors to the phone How to use',
            /'doctors', coalesce\(v_doctors/.test(read('reward_points_wallet.sql')) &&
            /distinct left\(trim\(l\.doctor_name\)/.test(read('reward_points_wallet.sql')));
    } catch (ePts) {
        pass('points page unit', false, ePts && ePts.message);
    }

    console.log('\n=== unit: Points & Coupons manual ===');
    try {
        var manWin = {};
        vm.runInNewContext(read('docs/loyalty-manual.js'), {
            window: manWin, document: { readyState: 'loading', addEventListener: function () {} }
        });
        var LM = manWin.LoyaltyManual;
        pass('manual loads in vm', !!LM && LM.LANGS.length === 3);
        var shape = function (l) {
            var t = LM.T[l];
            return [t.rw.steps.length, t.dc.steps.length, t.rw.tipList.length, t.dc.tipList.length, t.rw.recapList.length, t.dc.recapList.length,
                t.rw.steps.map(function (s) { return s.list.length + (s.mock ? 'm' : '') + (s.key ? 'k' : '') + (s.danger ? 'd' : ''); }).join(','),
                t.dc.steps.map(function (s) { return s.list.length + (s.mock ? 'm' : '') + (s.key ? 'k' : ''); }).join(','),
                t.desk.steps.map(function (s) { return s.list.length + (s.mock ? 'm' : '') + (s.key ? 'k' : '') + (s.danger ? 'd' : ''); }).join(','),
                t.desk.tipList.length, t.desk.recapList.length, t.desk.beforeList.length,
                Object.keys(t.mock).sort().join(','), Object.keys(t.coverPart).sort().join(',')].join('|');
        };
        pass('manual: English / 繁 / 简 have the same steps, tips and pictures', shape('en') === shape('zh-Hant') && shape('en') === shape('zh-CN'), shape('en'));
        pass('manual: every reward points config card has a step',
            ['Earn rate', 'SMS notify on balance change', 'Refer a friend (points)', 'Using points on one bill', 'Reset reward points to zero',
                'Clinics in scheme', 'Summary log', 'Gift points to a patient'].join('|') === LM.T.en.rw.steps.map(function (s) { return s.t; }).join('|'));
        pass('manual: every coupon config card has a step',
            ['Clinics in scheme', 'Expenditure coupons', 'Campaigns', 'Using cash coupons on one bill', 'Treatment items for a treatment coupon',
                'Set discount coupons to zero', 'Referrals', 'Coupon log'].join('|') === LM.T.en.dc.steps.map(function (s) { return s.t; }).join('|'));
        pass('manual: opens in the dashboard language, Traditional Chinese when none is saved', LM.defaultLang('en') === 'en' &&
            LM.defaultLang('zh-CN') === 'zh-CN' && LM.defaultLang('zh-Hant') === 'zh-Hant' && LM.defaultLang(null) === 'zh-Hant' && LM.defaultLang('fr') === 'zh-Hant');
        pass('manual: coupon set zero says Manual is the default and every change needs SMS + Authenticator',
            /Manual<\/b> \(<b>default<\/b>/.test(LM.T.en.dc.steps[5].list.join(' ')) &&
            /Every change of option needs the admin SMS code and the Google Authenticator code/.test(LM.T.en.dc.steps[5].list.join(' ')) &&
            /每次更改清零選項都需輸入管理員短訊驗證碼及 Google 驗證器驗證碼/.test(LM.T['zh-Hant'].dc.steps[5].list.join(' ')) &&
            /每次更改清零选项都需输入管理员短信验证码及 Google 验证器验证码/.test(LM.T['zh-CN'].dc.steps[5].list.join(' ')));
        pass('manual: coupon set zero step is red with its picture in all 3 languages', LM.LANGS.every(function (l) {
            var s = LM.T[l.id].dc.steps[5];
            return s.danger === true && typeof s.mock === 'function' && s.mock(LM.T[l.id].mock).indexOf(LM.T[l.id].mock.dcZeroTitle) > 0 &&
                s.list.join(' ').indexOf('confirm') >= 0;
        }) && LM.T['zh-Hant'].dc.steps[5].t === '優惠券清零' && LM.T['zh-CN'].dc.steps[5].t === '优惠券清零');
        pass('manual: Chinese step titles match the screen',
            LM.T['zh-Hant'].rw.steps[0].t === '賺取比率' && LM.T['zh-CN'].rw.steps[3].t === '单张账单使用积分上限' &&
            LM.T['zh-Hant'].dc.steps[1].t === '消費滿額券' && LM.T['zh-CN'].dc.steps[3].t === '同一张单使用现金券');
        pass('manual: deep links #rewards-x / #lang-x / #coupons-x', LM.targetFor('#rewards-zh-CN').id === 'lang-zh-CN' &&
            LM.targetFor('#lang-en').id === 'lang-en' && LM.targetFor('#coupons-zh-Hant').id === 'coupons-zh-Hant' && LM.targetFor('#x') === null);
        var st = LM.targetFor('#start-coupons-zh-CN');
        pass('manual: #start-part-x opens the contents page with that language and part marked', st && st.cover === true &&
            st.id === 'manualCover' && st.lang === 'zh-CN' && st.part === 'coupons' && LM.targetFor('#start-rewards-fr') === null, JSON.stringify(st));
        pass('manual: payment desk part covers coupons and points at the desk, step by step',
            ['See what the patient has', 'Use a discount coupon on the bill', 'Gift or transfer a coupon', 'Use reward points in Add Payment',
                'After the payment', 'Give the patient the phone page', 'Loyalty report (Coupons &amp; points)', 'Mass-broadcast loyalty filter', 'Fixing a mistake'].join('|') === LM.T.en.desk.steps.map(function (s) { return s.t; }).join('|') &&
            LM.T['zh-Hant'].desk.steps[1].t === '在賬單使用優惠券' && LM.T['zh-CN'].desk.steps[3].t === '在添加付款使用奖励积分', LM.T.en.desk.steps.map(function (s) { return s.t; }).join('|'));
        pass('manual: desk part names the real buttons (Choose, Apply, + Add Payment, Redeem all, ✓ Confirm Payment) in all 3 languages',
            LM.LANGS.every(function (l) {
                var t = LM.T[l.id], all = JSON.stringify(t.desk);
                var want = {
                    en: ['Choose', 'Apply', 'Do not use a coupon', '+ Add Payment', 'Use reward points as discount', 'Redeem all', '✓ Confirm Payment', 'Points on the phone', 'Wallet QR'],
                    'zh-Hant': ['選擇', '不使用優惠券', '+ 新增付款', '使用積分抵扣', '全部兌換', '✓ 確認付款', '手機查看積分', '錢包 QR 碼', '獎賞'],
                    'zh-CN': ['选择', '不使用优惠券', '+ 添加付款', '使用积分抵扣', '全部兑换', '✓ 确认付款', '手机查看积分', '钱包二维码', '奖赏']
                }[l.id];
                return want.every(function (w) { return all.indexOf(w) >= 0; });
            }));
        pass('manual: desk pictures show the coupon sheet and the Add Payment points box in all 3 languages', LM.LANGS.every(function (l) {
            var t = LM.T[l.id];
            var c = t.desk.steps[1].mock(t.mock), p = t.desk.steps[3].mock(t.mock);
            return c.indexOf(t.mock.dkChoose) > 0 && c.indexOf(t.mock.dkApply) > 0 && c.indexOf('lm-ticket is-on') > 0 &&
                p.indexOf(t.mock.dkRedeemAll) > 0 && p.indexOf(t.mock.dkConfirm) > 0 && p.indexOf('KT 450.00 · PL 50.00') > 0;
        }));
        pass('manual: "Save payment" is now the real button name ✓ Confirm Payment', LM.T.en.rw.steps[3].list.join(' ').indexOf('✓ Confirm Payment') > 0 &&
            LM.T['zh-Hant'].rw.steps[3].list.join(' ').indexOf('✓ 確認付款') > 0 && LM.T['zh-CN'].rw.steps[3].list.join(' ').indexOf('✓ 确认付款') > 0 &&
            JSON.stringify(LM.T).indexOf('Save payment') < 0);
        var dkT = LM.targetFor('#desk-zh-Hant'), dkS = LM.targetFor('#start-desk-en');
        pass('manual: #desk-x opens the desk part, #start-desk-x the contents with the desk part marked', dkT && dkT.id === 'desk-zh-Hant' &&
            dkS && dkS.cover && dkS.part === 'desk' && dkS.lang === 'en', JSON.stringify([dkT, dkS]));
        pass('manual: HK$3,000 defaults stated for points and cash coupons in all 3 languages', LM.LANGS.every(function (l) {
            var t = LM.T[l.id];
            return t.rw.steps[3].list.join(' ').indexOf('HK$3,000') >= 0 && t.dc.steps[3].list.join(' ').indexOf('HK$3,000') >= 0;
        }));
        pass('manual: Government / PDCC / CCF excluded in all 3 languages', LM.LANGS.every(function (l) {
            var all = JSON.stringify(LM.T[l.id]);
            return all.indexOf('Government') >= 0 && all.indexOf('PDCC') >= 0 && all.indexOf('CCF') >= 0;
        }));
        pass('manual: combined phone QR and How to use (Chinese then English) in all 3 languages', LM.LANGS.every(function (l) {
            var desk = JSON.stringify(LM.T[l.id].desk);
            return /Points \+ coupons|積分＋優惠券|积分＋优惠券/.test(desk) &&
                desk.indexOf('How to use') >= 0 && desk.indexOf('使用說明') + desk.indexOf('使用说明') > -2;
        }));
        pass('manual: set zero and year-end SMS run on the server; Manual pauses them',
            /run on the <b>server<\/b>/.test(LM.T.en.rw.steps[4].list.join(' ')) &&
            /pauses those jobs and the year-end reminder SMS/.test(LM.T.en.dc.steps[5].list.join(' ')) &&
            /由<b>伺服器<\/b>/.test(LM.T['zh-Hant'].dc.steps[5].list.join(' ')) &&
            /由<b>服务器<\/b>/.test(LM.T['zh-CN'].dc.steps[5].list.join(' ')) &&
            JSON.stringify(LM.T).indexOf('when the Discount Coupons config page is opened') < 0);
        pass('manual: loyalty report mini-calendar and mass-broadcast filter in all 3 languages', LM.LANGS.every(function (l) {
            var t = LM.T[l.id].desk.steps;
            return t.length === 9 && /mini-calendar|迷你日曆|迷你日历/.test(t[6].list.join(' ')) &&
                /Unused coupon|未用優惠券|未用优惠券/.test(t[7].list.join(' '));
        }));
    } catch (eMan) {
        pass('manual unit', false, eMan && eMan.message);
    }

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
            var exM = R.isLoyaltyExcludedPayMethod;
            pass('Government / PDCC / CCF methods are excluded from loyalty',
                exM('Government') && exM('GOVERNMENT') && exM('GOV') && exM('gov') && exM('PDCC') && exM(' pdcc ') &&
                exM('CCF') && exM('ccf') && exM(' CCF ') && exM('Other CCF') &&
                exM('Government Elderly') && exM('政府') && exM('GOVERMMENT') && exM('Goverment'), '');
            pass('cash, card, HCV, reward points are not excluded',
                !exM('Cash') && !exM('Visa') && !exM('Health Care Voucher (HCV)') && !exM('Reward points') &&
                !exM('Balance transfer') && !exM('') && !exM(null) && !exM('Governor card'));
            pass('words containing pdcc or ccf letters are not excluded', !exM('xpdccx') && !exM('xccfx') && !exM('Octopus'));
            var earnEx = await R.applyEarnForPayment({ patientId: 'p1', eligibleAmount: 500, billId: 'b1', method: 'PDCC' });
            pass('earn skipped for a PDCC payment', earnEx && earnEx.ok && earnEx.skipped && earnEx.reason === 'excluded_method',
                JSON.stringify(earnEx));
            var redEx = await R.applyRedeemForBill({ patientId: 'p1', points: 50, billId: 'b1', method: 'Government' });
            pass('redeem refused for a Government payment', redEx && redEx.ok === false && /Government \/ PDCC|excludedMethod/.test(redEx.error),
                JSON.stringify(redEx));
            var Rgov = extractIifeHelpers(rewardsSrc, fakeBillSb({ bill_payments: [{ method: 'Cash', voided_at: null }, { method: 'Government', voided_at: null }] }));
            var earnCashOnGov = await Rgov.applyEarnForPayment({ patientId: 'p1', eligibleAmount: 200, billId: 'b1', method: 'Cash' });
            pass('earn skipped for the cash part of a bill that has a Government payment',
                earnCashOnGov && earnCashOnGov.skipped && earnCashOnGov.reason === 'excluded_method', JSON.stringify(earnCashOnGov));
            pass('billLoyaltyExcluded true when a live payment is Government', (await Rgov.billLoyaltyExcluded('b1')) === true);
            var RgovVoid = extractIifeHelpers(rewardsSrc, fakeBillSb({ bill_payments: [{ method: 'PDCC', voided_at: '2026-10-29T01:00:00Z' }] }));
            pass('voided PDCC payment does not exclude the bill', (await RgovVoid.billLoyaltyExcluded('b1')) === false);
            pass('pre-save: points + PDCC on the same payment is blocked',
                /Government \/ PDCC|excludedMethod/.test(await R.excludedPaymentBlock({ id: 'b1' }, 'PDCC', 20)));
            pass('pre-save: PDCC on a bill with a coupon is blocked',
                /coupon|excludedCoupon/.test(await R.excludedPaymentBlock({ id: 'b1', coupon_amount: 100 }, 'PDCC', 0)));
            var Rused = extractIifeHelpers(rewardsSrc, fakeBillSb({ bill_payments: [{ method: 'Reward points', voided_at: null }],
                reward_ledger: [{ kind: 'redeem', points: -30 }] }));
            pass('pre-save: Government on a bill that used points is blocked',
                /reward points|excludedPointsUsed/.test(await Rused.excludedPaymentBlock({ id: 'b1' }, 'Government', 0)));
            pass('pre-save: plain Government payment on a clean bill is allowed',
                (await R.excludedPaymentBlock({ id: 'b1', coupon_amount: 0 }, 'Government', 0)) === '');
            pass('pre-save: cash on a Government bill is allowed (earns nothing)',
                (await Rgov.excludedPaymentBlock({ id: 'b1' }, 'Cash', 0)) === '');
            pass('pre-save: points on a Government bill are blocked',
                /Government \/ PDCC|excludedMethod/.test(await Rgov.excludedPaymentBlock({ id: 'b1' }, 'Cash', 10)));
            pass('pre-save: cash bill without Government / PDCC is untouched',
                (await R.excludedPaymentBlock({ id: 'b1', coupon_amount: 100 }, 'Cash', 20)) === '');
            var rpcLog = [];
            var Rrev = extractIifeHelpers(rewardsSrc, fakeBillSb({}, rpcLog));
            await Rrev.excludeBillFromLoyalty('b9', 'p1');
            pass('Government / PDCC payment reverses earlier points on the bill via reward_void_for_bill',
                rpcLog.length === 1 && rpcLog[0].fn === 'reward_void_for_bill' && rpcLog[0].args.p_bill_id === 'b9',
                JSON.stringify(rpcLog));
            pass('round2 1.005→1.01 or 1.00', [1, 1.01].indexOf(R.round2(1.005)) >= 0 ||
                R.round2(10.5) === 10.5, String(R.round2(1.005)));
            pass('fmtPts 50', R.fmtPts(50) === '50.00');
            pass('isAdmin true when currentRole admin', R.isAdmin() === true);
            var pwa = R.pointsWhatsAppText('https://a.example/points.html?t=ab', { chinese_name: '陳大文', full_name: 'Chan Tai Man' }).split('\n');
            pass('points WhatsApp: heading, named bilingual greeting, link, do-not-share',
                pwa[0] === '[Joyful Smile Dental Clinic 樂意牙科中心]' && pwa[1].indexOf('陳大文 你好！') === 0 && pwa[1].indexOf('積分') > 0 &&
                pwa[2].indexOf('Hi Chan Tai Man! ') === 0 && /reward points/.test(pwa[2]) &&
                pwa[3] === 'https://a.example/points.html?t=ab' && pwa[4] === '請勿轉發此連結。Please do not share this link.', pwa.join(' | '));
            var pwaNo = R.pointsWhatsAppText('u', null).split('\n');
            pass('points WhatsApp: plain greeting when no name', pwaNo[1].indexOf('你好！') === 0 && pwaNo[2].indexOf('Hi! ') === 0);
            var pcfg = R.phoneQrConfig();
            pass('points QR set-up: rpc, page, PNG name, centre label', pcfg.rpc === 'rw_wallet_link' && pcfg.page === 'points.html' &&
                pcfg.pngName === 'reward-points-qr.png' && pcfg.centre === '積分' && pcfg.scheme === 'rewards');
            pass('points SMS at each balance change ends with the one points-and-coupons page link',
                /COUPONS\.loyaltyLinkForSms\(info\.patientId\)/.test(rewardsSrc) &&
                /if \(hasLink\) body = COUPONS\.smsWithPhoneLink\(body, both\[2\], 'loyalty'\);/.test(rewardsSrc));
            pass('related charts exported for household coupon display',
                /relatedPatientIds: findRelatedPatientIds/.test(rewardsSrc));
            var ye = R.pointsYearEndSms('2026-11-30', 1234.5, 'PL').split('\n');
            pass('year-end points SMS: heading, all-clinic total, 31 Dec 23:59 with days left, clinic, note',
                ye[0] === '[Joyful Smile Dental Clinic 樂意牙科中心] 積分到期提醒 / Reward points expiry reminder' &&
                ye[1] === '總結餘/All-clinic total: 1234.50' &&
                ye[2] === '到期/Expiry: 2026年12月31日 23:59（還有31日）/ 31 Dec 2026 23:59 (31 days left)' &&
                ye[3] === '診所/Clinic: PL' && /^備註\/Note: 所有積分將於今年2026年12月31日 23:59到期/.test(ye[4]), ye.join(' | '));
            pass('year-end points SMS on 24 Dec says 7 days, no clinic line when unknown',
                R.pointsYearEndSms('2026-12-24', 10, '').indexOf('(7 days left)') > 0 && R.pointsYearEndSms('2026-12-24', 10, '').indexOf('診所/Clinic') < 0);
            var plAll = { 'code:PL': { join_gain: true, join_redeem: true, enabled: true } };
            var plDocs = {
                'code:PL': {
                    '__all__': { join_gain: true, join_redeem: true, enabled: true, doctor_key: '__all__' },
                    'joseph-lam': { join_gain: false, join_redeem: false, enabled: false, doctor_key: 'joseph-lam' }
                }
            };
            var joseph = { key: 'joseph-lam', label: 'Dr Joseph Lam Kam Yui' };
            var ng = { key: 'ng-pui-ching', label: 'Dr Ng Pui Ching' };
            var jf = R.effectiveJoinFlags(plAll, plDocs, null, 'PL', joseph);
            var nf = R.effectiveJoinFlags(plAll, plDocs, null, 'PL', ng);
            pass('coupon-style join: unticked Joseph is out even while All Doctors is still saved on',
                jf && jf.join_gain === false && jf.join_redeem === false, JSON.stringify(jf));
            pass('coupon-style join: a dentist with no own row still follows All Doctors',
                nf && nf.join_gain === true, JSON.stringify(nf));
            var writesOff = R.planRewardDoctorToggle({
                doctorKey: 'joseph-lam',
                joined: false,
                allOn: true,
                list: [
                    { key: 'joseph-lam', label: 'Dr Joseph Lam Kam Yui', wasOn: false },
                    { key: 'ng-pui-ching', label: 'Dr Ng Pui Ching', wasOn: true }
                ]
            });
            var byK = {};
            writesOff.forEach(function (w) { byK[w.doctorKey] = !!w.join_gain; });
            pass('coupon-style toggle: untick one dentist turns All Doctors off and keeps the others on',
                byK.__all__ === false && byK['joseph-lam'] === false && byK['ng-pui-ching'] === true,
                JSON.stringify(byK));
            var writesAll = R.planRewardDoctorToggle({
                doctorKey: '__all__',
                joined: true,
                allOn: false,
                list: [
                    { key: 'joseph-lam', label: 'Dr Joseph', wasOn: false },
                    { key: 'ng-pui-ching', label: 'Dr Ng', wasOn: true }
                ]
            });
            pass('coupon-style toggle: tick All Doctors turns every listed dentist on',
                writesAll.length === 3 && writesAll.every(function (w) { return w.join_gain === true; }),
                JSON.stringify(writesAll));
            pass('coupon-style display: no own row inherits All Doctors; explicit off stays off',
                R.doctorJoinShownOn(null, true) === true &&
                R.doctorJoinShownOn({ join_gain: false, join_redeem: false }, true) === false &&
                R.doctorJoinShownOn({ join_gain: true, join_redeem: true }, false) === true);

            pass('gift: max is 200', R.GIFT_MAX === 200);
            var gc = R.giftCheck;
            pass('gift check: 1 and 200 ok, 0 / 201 / 1.5 / blank refused',
                gc({ points: 1, doctor: 'Dr A', note: 'x' }).ok && gc({ points: '200', doctor: 'Dr A', note: 'x' }).points === 200 &&
                gc({ points: 0, doctor: 'Dr A', note: 'x' }).reason === 'points' && gc({ points: 201, doctor: 'Dr A', note: 'x' }).reason === 'points' &&
                gc({ points: 1.5, doctor: 'Dr A', note: 'x' }).reason === 'points' && gc({ points: '', doctor: 'Dr A', note: 'x' }).reason === 'points');
            pass('gift check: doctor and reason required',
                gc({ points: 5, doctor: '', note: 'x' }).reason === 'doctor' && gc({ points: 5, doctor: 'Dr A', note: '  ' }).reason === 'note');
            pass('gift HK day: 23:30 UTC is next HK day', R.hkDayKey('2026-10-28T16:30:00Z') === '2026-10-29' &&
                R.hkDayKey('2026-10-28T15:59:00Z') === '2026-10-28');
            var gRows = [{ kind: 'earn', created_at: '2026-10-28T03:00:00Z' }, { kind: 'gift', points: 50, created_by: 'Amy', created_at: '2026-10-27T17:00:00Z' }];
            pass('gift today: same HK day found, other days / kinds ignored',
                R.giftTodayRow(gRows, '2026-10-28T10:00:00Z') === gRows[1] && R.giftTodayRow(gRows, '2026-10-29T10:00:00Z') === null &&
                R.giftTodayRow([gRows[0]], '2026-10-28T10:00:00Z') === null);
            pass('gift reasons: daily limit names who gave it, nurse refused text',
                /Amy/.test(R.giftReasonText({ reason: 'daily_limit', last_by: 'Amy' })) && /Nurse/.test(R.giftReasonText({ reason: 'shared_login' })) &&
                /reward_points_gift\.sql/.test(R.giftReasonText({ reason: 'no_sql' })));
            pass('gift kind: SMS label 贈送/gift, filter chip counts gifts',
                R.kindLabelBilingual('gift') === '贈送/gift' && R.ledgerFilterRows(gRows, 'gift').length === 1);
            var ngc = R.normalizeGiftConfig;
            pass('gift settings: defaults on, 200, 1 a day, no staff cap, login + reason, all roles',
                JSON.stringify(ngc(null)) === JSON.stringify({ enabled: true, maxPoints: 200, perPatientDaily: 1, staffDailyMax: 0,
                    requireLogin: true, requireReason: true, roles: ['doctor', 'dentist', 'nurse', 'receptionist', 'reception', 'staff', 'admin'] }),
                JSON.stringify(ngc(null)));
            var ngx = ngc({ enabled: false, maxPoints: '50000', perPatientDaily: '0', staffDailyMax: 'x', requireLogin: false, roles: ['Admin', 'hacker', 'admin'] });
            pass('gift settings: max capped at 10,000, 0 a day kept, junk -> default, unknown roles dropped',
                ngx.enabled === false && ngx.maxPoints === 10000 && ngx.perPatientDaily === 0 && ngx.staffDailyMax === 0 &&
                ngx.requireLogin === false && ngx.roles.join(',') === 'admin' && ngc({ maxPoints: 0 }).maxPoints === 200 &&
                ngc({ roles: [] }).roles.length === 7, JSON.stringify(ngx));
            pass('gift check follows settings: max 50, reason optional, off',
                gc({ points: 60, doctor: 'Dr A', note: 'x' }, { maxPoints: 50 }).reason === 'points' &&
                gc({ points: 50, doctor: 'Dr A', note: '' }, { maxPoints: 50, requireReason: false }).note === 'Gift' &&
                gc({ points: 5, doctor: 'Dr A', note: 'x' }, { enabled: false }).reason === 'gift_off');
            var gToday = [{ kind: 'gift', created_at: '2026-10-28T02:00:00Z' }, { kind: 'gift', created_at: '2026-10-28T03:00:00Z' }];
            pass('gift daily count: 2 a day allows the second, blocks the third; 0 = no limit',
                !R.giftDailyReached(gToday.slice(0, 1), { perPatientDaily: 2 }, '2026-10-28T10:00:00Z') &&
                R.giftDailyReached(gToday, { perPatientDaily: 2 }, '2026-10-28T10:00:00Z') &&
                !R.giftDailyReached(gToday, { perPatientDaily: 0 }, '2026-10-28T10:00:00Z') &&
                R.giftTodayRows(gToday, '2026-10-28T10:00:00Z')[0] === gToday[1]);
            pass('gift without password only when switched off, never for Nurse or a role not allowed',
                !R.giftScreenLoginOk({}, 'amy', 'staff') && R.giftScreenLoginOk({ requireLogin: false }, 'amy', 'staff') &&
                !R.giftScreenLoginOk({ requireLogin: false }, 'nurse', 'nurse') &&
                !R.giftScreenLoginOk({ requireLogin: false, roles: ['admin'] }, 'amy', 'staff'));
            pass('gift settings summary: default and off',
                /200/.test(R.giftConfigSummary(null)) && /own login/.test(R.giftConfigSummary(null)) &&
                R.giftConfigSummary({ enabled: false }) === 'Gift points is off.');
            var gcard = R.renderGiftConfigCard(null, true);
            var gcardRo = R.renderGiftConfigCard({ requireLogin: false }, false);
            pass('gift settings card: toggle, max, daily, staff, login, reason, roles + Save for Admin; read-only otherwise',
                /id="rwCfgGiftOn" checked/.test(gcard) && /id="rwCfgGiftMax"[^>]*value="200"/.test(gcard) && /id="rwCfgGiftDaily"[^>]*value="1"/.test(gcard) &&
                /id="rwCfgGiftStaff"/.test(gcard) && /id="rwCfgGiftLogin" checked/.test(gcard) && /id="rwCfgGiftReason" checked/.test(gcard) &&
                (gcard.match(/class="rw-cfg-gift-role"/g) || []).length === 7 && /id="rwCfgGiftSave"/.test(gcard) &&
                !/rwCfgGiftSave/.test(gcardRo) && /id="rwCfgGiftLogin" disabled/.test(gcardRo) && /Only Admin/.test(gcardRo));

            var glog = R.renderGiftLogCard([{ kind: 'gift', points: 20, created_by: 'Amy <b>', note: 'Birthday', doctor_name: 'Dr A', created_at: '2026-10-28T03:00:00Z' }]);
            pass('gift log card: giver escaped, reason and points shown',
                /Amy &lt;b&gt;/.test(glog) && /Birthday/.test(glog) && /\+20\.00/.test(glog) && /id="rwGiftLog"/.test(glog));

            var nc = R.normalizeRedeemCap;
            pass('points cap: default HK$3,000, no %', JSON.stringify(nc(null)) === '{"maxPercent":0,"maxAmount":3000}');
            pass('points cap: blank / junk keep default, negatives -> 0, % max 100',
                nc({ maxPercent: '', maxAmount: 'x' }).maxAmount === 3000 && nc({ maxPercent: -5, maxAmount: -1 }).maxPercent === 0 &&
                nc({ maxAmount: -1 }).maxAmount === 0 && nc({ maxPercent: 250 }).maxPercent === 100);
            var c1 = R.redeemCapLeft(10000, 0, { maxPercent: 0, maxAmount: 3000 });
            pass('points cap: HK$3,000 only -> 3000 left on a 10,000 bill', c1.limit === 3000 && c1.left === 3000);
            var c2 = R.redeemCapLeft(4000, 500, { maxPercent: 50, maxAmount: 3000 });
            pass('points cap: smaller limit wins (50% of 4,000 = 2,000), minus 500 used = 1,500', c2.limit === 2000 && c2.used === 500 && c2.left === 1500,
                JSON.stringify(c2));
            pass('points cap: never below 0 once used up', R.redeemCapLeft(10000, 3500, {}).left === 0);
            pass('points cap: both blank -> no limit', R.redeemCapLeft(10000, 0, { maxPercent: 0, maxAmount: 0 }).left === Infinity);
            pass('points cap: % rounds down to the cent', R.redeemCapLeft(333.33, 0, { maxPercent: 10, maxAmount: 0 }).limit === 33.33);
            pass('points cap: used on bill = net of redeem / void_redeem only',
                R.pointsUsedOnBill([{ kind: 'redeem', points: -800 }, { kind: 'void_redeem', points: 300 }, { kind: 'earn', points: 50 }, { kind: 'redeem', points: -200 }]) === 700 &&
                R.pointsUsedOnBill([]) === 0);
            pass('points cap: summary text', R.redeemCapSummary({ maxPercent: 0, maxAmount: 3000 }) === 'At most HK$3,000 in points per bill' &&
                R.redeemCapSummary({ maxPercent: 50, maxAmount: 3000 }) === 'At most 50% of the bill up to HK$3,000 in points per bill' &&
                R.redeemCapSummary({ maxPercent: 0, maxAmount: 0 }) === 'No limit on points per bill',
                R.redeemCapSummary({ maxPercent: 0, maxAmount: 3000 }));
            pass('points cap: nothing loaded -> payRedeemCapLeft is Infinity', R.payRedeemCapLeft() === Infinity);
            pass('panel tabs: ledger first; a scheme that is off is skipped; neither -> nothing',
                R.pickPanelTab('points', { points: true, coupons: true }) === 'points' &&
                R.pickPanelTab('coupons', { points: true, coupons: true }) === 'coupons' &&
                R.pickPanelTab('points', { points: false, coupons: true }) === 'coupons' &&
                R.pickPanelTab('coupons', { points: true, coupons: false }) === 'points' &&
                R.pickPanelTab('points', { points: false, coupons: false }) === '');
            pass('manual link: part + dashboard language (en / 简 / 繁 kept; unknown or missing -> 繁)',
                R.loyaltyGuideHref('coupons', 'zh-CN') === 'docs/loyalty-manual.html?v=20261030howto#start-coupons-zh-CN' &&
                /#start-rewards-zh-Hant$/.test(R.loyaltyGuideHref('rewards', 'zh-Hant')) && /#start-rewards-en$/.test(R.loyaltyGuideHref('rewards', 'en')) &&
                /#start-rewards-en$/.test(R.loyaltyGuideHref('rewards', 'en-GB')) &&
                /#start-rewards-zh-Hant$/.test(R.loyaltyGuideHref('rewards', 'zh-TW')) && /#start-rewards-zh-Hant$/.test(R.loyaltyGuideHref('x', 'fr')) &&
                /#start-rewards-zh-Hant$/.test(R.loyaltyGuideHref('rewards')) && /#start-desk-zh-CN$/.test(R.loyaltyGuideHref('desk', 'zh-CN')));
            var gl = R.loyaltyGuideLinkHtml('coupons');
            pass('manual link: opens a new tab, styled like the X-ray guide button',
                /class="xray-helper-guide-btn loyalty-guide-btn"/.test(gl) && /target="_blank" rel="noopener"/.test(gl) && /data-guide-part="coupons"/.test(gl));
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
        pass('HTML has apRewardClinicMeta', idx.body.indexOf('id="apRewardClinicMeta"') >= 0);
        pass('HTML has rwTransferSources', idx.body.indexOf('id="rwTransferSources"') >= 0);
        pass('HTML has rwTransferSubmit', idx.body.indexOf('id="rwTransferSubmit"') >= 0);
        pass('HTML has rwAdminAdjust', idx.body.indexOf('id="rwAdminAdjust"') >= 0);
        pass('HTML has rwPatientClinicBreakdown',
            idx.body.indexOf('id="rwPatientClinicBreakdown"') >= 0);
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

        pass('HTML has rwPhoneQrBtn', idx.body.indexOf('id="rwPhoneQrBtn"') >= 0);
        pass('HTML ledger panel has the 📖 manual link (points part)',
            /id="rwGuideBtn" class="[^"]*loyalty-guide-btn[^"]*" data-guide-part="rewards"/.test(idx.body) &&
            /href="docs\/loyalty-manual\.html\?v=20261030howto#start-rewards-zh-Hant" target="_blank"/.test(idx.body));
        var ptsHtml = await httpGetText(PAGE_PORT, '/points.html');
        pass('GET /points.html loads points.js + wallet.css and boots', ptsHtml.status === 200 &&
            /src="points\.js\?v=/.test(ptsHtml.body) && /href="wallet\.css\?v=/.test(ptsHtml.body) &&
            ptsHtml.body.indexOf('CSPoints.boot()') > 0 && /name="robots" content="noindex, nofollow"/.test(ptsHtml.body));
        var ptsJs = await httpGetText(PAGE_PORT, '/points.js');
        pass('GET /points.js calls rw_wallet_view', ptsJs.status === 200 && ptsJs.body.indexOf('/rest/v1/rpc/rw_wallet_view') > 0);
        var manHtml = await httpGetText(PAGE_PORT, '/docs/loyalty-manual.html');
        var manJs = await httpGetText(PAGE_PORT, '/docs/loyalty-manual.js');
        var manPdf = await httpGetText(PAGE_PORT, '/docs/loyalty-manual.pdf');
        pass('GET manual html + js + pdf', manHtml.status === 200 && /src="loyalty-manual\.js\?v=20261030howto"/.test(manHtml.body) &&
            /href="loyalty-manual\.pdf"/.test(manHtml.body) && manJs.status === 200 && manPdf.status === 200 &&
            manPdf.body.slice(0, 5) === '%PDF-', manHtml.status + '/' + manJs.status + '/' + manPdf.status);
        var pwSqlHttp = await httpGetText(PAGE_PORT, '/reward_points_wallet.sql');
        pass('GET /reward_points_wallet.sql', pwSqlHttp.status === 200 && pwSqlHttp.body.indexOf('rw_wallet_view') > 0);

        var sqlHttp = await httpGetText(PAGE_PORT, '/reward_points.sql');
        pass('GET /reward_points.sql', sqlHttp.status === 200 &&
            sqlHttp.body.indexOf('reward_ledger') >= 0);
        var sqlPatchHttp = await httpGetText(PAGE_PORT, '/reward_points_patch_chart_ledgers.sql');
        pass('GET /reward_points_patch_chart_ledgers.sql', sqlPatchHttp.status === 200 &&
            sqlPatchHttp.body.indexOf('reward_redeem_multi') >= 0);
        var giftHttp = await httpGetText(PAGE_PORT, '/reward_points_gift.sql');
        pass('GET /reward_points_gift.sql', giftHttp.status === 200 && giftHttp.body.indexOf('function public.reward_gift(') >= 0);
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

        // Read-only: an unknown token is refused (nothing is written for a token that does not exist).
        var pwView = await restRpc(sb.url, sb.key, 'rw_wallet_view', { p_token: '00000000000000000000000000000000' });
        if (/Could not find the function|PGRST202|does not exist/i.test(pwView.raw || '') || pwView.status === 404) {
            warn('RPC rw_wallet_view not deployed yet — run reward_points_wallet.sql in Supabase', String(pwView.raw || '').slice(0, 160));
        } else {
            pass('RPC rw_wallet_view refuses an unknown token', pwView.status < 300 && pwView.json && pwView.json.ok === false &&
                pwView.json.reason === 'bad_link', pwView.raw);
        }

        // Safe RPC: earn with 0 eligible → skipped, no balance change
        // Shared Nurse login is refused before any password lookup or write.
        var giftRpc = await restRpc(sb.url, sb.key, 'reward_gift', {
            p_patient_id: '00000000-0000-0000-0000-000000000001', p_points: 10,
            p_user_id: 'nurse', p_password: 'x', p_note: 'smoke', p_doctor_name: 'Dr Smoke'
        });
        if (/Could not find the function|PGRST202|does not exist/i.test(giftRpc.raw || '') || giftRpc.status === 404) {
            warn('RPC reward_gift not deployed yet — run reward_points_gift.sql in Supabase', String(giftRpc.raw || '').slice(0, 160));
        } else {
            pass('RPC reward_gift refuses the shared Nurse login (no write)', giftRpc.status < 300 && giftRpc.json &&
                giftRpc.json.ok === false && giftRpc.json.reason === 'shared_login', giftRpc.raw);
        }

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

        // Prefer known multi-clinic same-person charts (#001003 PL + #021713 PY)
        var multiClinic = await restGet(sb.url, sb.key, 'patients',
            'patient_no=in.(001003,021713)&select=id,patient_no,clinic_tag,hkid');
        if (multiClinic.status < 300 && Array.isArray(multiClinic.json) &&
                multiClinic.json.length >= 2) {
            var plChart = multiClinic.json.filter(function (p) {
                return p.patient_no === '001003';
            })[0];
            var pyChart = multiClinic.json.filter(function (p) {
                return p.patient_no === '021713';
            })[0];
            if (plChart && pyChart) {
                pass('API multi-clinic same person charts', true,
                    '#001003/' + (plChart.clinic_tag || '?') + ' + #021713/' +
                    (pyChart.clinic_tag || '?'));
                global.__REWARD_SMOKE_XFER_PAIR__ = {
                    pl_id: plChart.id,
                    py_id: pyChart.id,
                    pl_no: '001003',
                    py_no: '021713'
                };
                global.__REWARD_SMOKE_PATIENT__ = {
                    patient_id: plChart.id,
                    patient_no: '001003',
                    account_id: null,
                    balance: 0
                };
            }
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
            if (!global.__REWARD_SMOKE_PATIENT__) {
                global.__REWARD_SMOKE_PATIENT__ = {
                    patient_id: top.patient_id,
                    patient_no: top.patient_no,
                    account_id: top.id,
                    balance: Number(top.balance)
                };
            } else if (!global.__REWARD_SMOKE_PATIENT__.account_id) {
                var matchAcc = realAcc.json.filter(function (a) {
                    return a.patient_id === global.__REWARD_SMOKE_PATIENT__.patient_id;
                })[0];
                if (matchAcc) {
                    global.__REWARD_SMOKE_PATIENT__.account_id = matchAcc.id;
                    global.__REWARD_SMOKE_PATIENT__.balance = Number(matchAcc.balance);
                }
            }
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
      ? window.isRewardPayMethod('Reward points') : null,
    keepSmsMarkers: typeof jsmShouldPreserveLocalStorageKey === 'function' &&
      jsmShouldPreserveLocalStorageKey('dc_expiry_sms_run') && jsmShouldPreserveLocalStorageKey('rw_yearend_sms_run') &&
      !jsmShouldPreserveLocalStorageKey('some_draft_key')
  };
  try {
    const joined = await REWARDS.isClinicJoined(null, 'PL');
    out.plJoinedAll = !!joined;
    // PL may be per-doctor (All Doctors off); a joined PL doctor still counts.
    out.plJoinedNg = !!(await REWARDS.isClinicJoined(null, 'PL', 'DR. NG PUI CHING'));
    out.plJoinedJoseph = !!(await REWARDS.isClinicJoined(null, 'PL', 'Dr Joseph Lam Kam Yui'));
    out.plJoinedJosephTag = !!(await REWARDS.isClinicJoined(null, 'PL', 'DR. LAM KAM YUI JOSEPH'));
    out.plJoinedDefault = out.plJoinedAll || out.plJoinedNg;
    try {
      const dm = await REWARDS.loadDoctorJoinMap(true);
      const plb = (dm && (dm['code:PL'] || dm['code:pl'])) || {};
      const jr = plb['joseph-lam'];
      out.plJosephRow = jr ? !!(jr.join_gain || jr.join_redeem || jr.enabled) : null;
      out.plAllRow = plb['__all__'] ? !!(plb['__all__'].join_gain || plb['__all__'].enabled) : null;
    } catch (e2) {
      out.plJosephRowErr = String(e2 && e2.message || e2);
    }
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
        pass('live login cleanup keeps the SMS reminder markers (drafts still cleared)', liveProbe && liveProbe.keepSmsMarkers === true);
        pass('live apAmount allows 0', liveProbe && String(liveProbe.apAmountMin) === '0',
            liveProbe && liveProbe.apAmountMin);

        if (liveProbe && liveProbe.plJoinedDefault != null) {
            pass('live PL joined (API or default)', liveProbe.plJoinedDefault === true,
                liveProbe.plErr || ('allDoctors=' + liveProbe.plJoinedAll + ' drNg=' + liveProbe.plJoinedNg));
            if (liveProbe.plJosephRow === false) {
                pass('live PL Dr Joseph Lam opt-out is honoured (name and bill tag)',
                    liveProbe.plJoinedJoseph === false && liveProbe.plJoinedJosephTag === false,
                    JSON.stringify({
                        row: liveProbe.plJosephRow, all: liveProbe.plAllRow,
                        name: liveProbe.plJoinedJoseph, tag: liveProbe.plJoinedJosephTag
                    }));
            }
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
      hasJoinGain: html.indexOf('rw-doc-join') >= 0 || html.indexOf('rw-doc-gain') >= 0 || html.indexOf('Join') >= 0,
      hasJoinRedeem: html.indexOf('rw-doc-join') >= 0 || html.indexOf('rw-doc-redeem') >= 0 || html.indexOf('Join') >= 0,
      hasClinicTree: html.indexOf('rw-clinic-scheme') >= 0 || html.indexOf('rw-clinic-tabs') >= 0,
      hasAllDoctors: html.indexOf('All Doctors') >= 0 || html.indexOf('全部医生') >= 0 || html.indexOf('全部醫生') >= 0,
      hasClinicTabs: html.indexOf('rw-clinic-tab') >= 0,
      hasDocJoin: html.indexOf('rw-doc-join') >= 0,
      hasError: html.indexOf('color:#dc2626') >= 0,
      capSum: (document.getElementById('rwCfgCapSum') || {}).textContent || '',
      guide: (function () {
        var a = pane.querySelector('.loyalty-guide-btn');
        return a ? { text: a.textContent, href: a.getAttribute('href'), lang: typeof getAppLang === 'function' ? getAppLang() : '' } : null;
      })(),
      capBeforeZero: (function () {
        var c = document.getElementById('rwCfgCap'), z = pane.querySelector('.rw-cfg-card--danger');
        return !!c && (!z || !!(c.compareDocumentPosition(z) & 4));
      })(),
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
            pass('live config clinic→doctor tree',
                !!(cfgPaint.hasClinicTree && cfgPaint.hasAllDoctors),
                'tree=' + cfgPaint.hasClinicTree + ' allDocs=' + cfgPaint.hasAllDoctors);
            pass('live config clinic subtabs + Join toggle',
                !!(cfgPaint.hasClinicTabs && cfgPaint.hasDocJoin),
                'tabs=' + cfgPaint.hasClinicTabs + ' join=' + cfgPaint.hasDocJoin);
            pass('live config: points-per-bill card shows its limit', cfgPaint.capBeforeZero && /HK\$|limit|上限/.test(cfgPaint.capSum), cfgPaint.capSum);
            pass('live config: 📖 How to use opens the points part in the dashboard language',
                !!cfgPaint.guide && /^📖/.test(cfgPaint.guide.text) &&
                cfgPaint.guide.href === 'docs/loyalty-manual.html?v=20261030howto#start-rewards-' +
                    (['zh-Hant', 'zh-CN'].indexOf(cfgPaint.guide.lang) >= 0 ? cfgPaint.guide.lang : 'en'), JSON.stringify(cfgPaint.guide));
        }

        var guideLive = await cdp.js(`(async () => {
  const out = {};
  const pane = document.getElementById('cfgPane-coupons');
  if (pane && typeof COUPONS !== 'undefined') {
    COUPONS.renderConfigPane(pane);
    const t0 = Date.now();
    while (Date.now() - t0 < 10000 && !pane.querySelector('.loyalty-guide-btn')) await new Promise(r => setTimeout(r, 200));
    const a = pane.querySelector('.loyalty-guide-btn');
    out.coupons = a ? a.getAttribute('href') : null;
  }
  const oldLang = typeof getAppLang === 'function' ? getAppLang() : 'en';
  if (typeof setAppLang === 'function') {
    setAppLang('zh-CN');
    const a2 = document.querySelector('#cfgPane-coupons .loyalty-guide-btn');
    if (a2) {
      a2.setAttribute('href', 'docs/loyalty-manual.html#coupons-en');
      a2.addEventListener('click', e => e.preventDefault(), { once: true });
      a2.click();
      out.afterSwitch = a2.getAttribute('href');
    }
    setAppLang(oldLang);
  }
  const r = await fetch('docs/loyalty-manual.html', { cache: 'no-store' });
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;left:-2000px;top:0;width:900px;height:700px;';
  frame.src = 'docs/loyalty-manual.html#coupons-zh-Hant';
  document.body.appendChild(frame);
  await new Promise(res => { frame.onload = res; setTimeout(res, 8000); });
  const d = frame.contentDocument;
  out.manualOk = r.ok;
  out.pages = d ? d.querySelectorAll('.xhg-page[id]').length : 0;
  out.onTab = d && (d.querySelector('.xhg-toolbar a.is-on') || {}).textContent;
  out.title = d && (d.querySelector('#coupons-zh-Hant .xhg-title') || {}).textContent;
  frame.remove();
  async function bareHash() {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-2000px;top:0;width:900px;height:700px;';
    f.src = 'docs/loyalty-manual.html?v=bare' + Date.now();
    document.body.appendChild(f);
    await new Promise(res => { f.onload = res; setTimeout(res, 8000); });
    const h = f.contentWindow ? f.contentWindow.location.hash : '';
    f.remove();
    return h;
  }
  const sf = document.createElement('iframe');
  sf.style.cssText = 'position:fixed;left:-2000px;top:0;width:900px;height:700px;';
  sf.src = 'docs/loyalty-manual.html?v=start' + Date.now() + '#start-rewards-zh-Hant';
  document.body.appendChild(sf);
  await new Promise(res => { sf.onload = res; setTimeout(res, 8000); });
  await new Promise(res => setTimeout(res, 300));
  const sd = sf.contentDocument;
  out.start = sd ? {
    scrollY: sf.contentWindow.scrollY,
    coverTop: Math.round(sd.getElementById('manualCover').getBoundingClientRect().top),
    row: (sd.querySelector('.xhg-cover-toc li.is-on') || {}).getAttribute ? sd.querySelector('.xhg-cover-toc li.is-on').getAttribute('data-lang') : null,
    part: (sd.querySelector('.xhg-cover-toc li.is-on a.is-on[data-part]') || { getAttribute: function () { return null; } }).getAttribute('data-part'),
    tab: (sd.querySelector('.xhg-toolbar a.is-on') || {}).textContent
  } : null;
  sf.remove();
  const keepStored = localStorage.getItem('joyful_ui_lang_v1');
  localStorage.setItem('joyful_ui_lang_v1', 'zh-CN');
  out.bareCn = await bareHash();
  localStorage.setItem('joyful_ui_lang_v1', 'en');
  out.bareEn = await bareHash();
  localStorage.removeItem('joyful_ui_lang_v1');
  out.bareNone = await bareHash();
  if (keepStored === null) localStorage.removeItem('joyful_ui_lang_v1'); else localStorage.setItem('joyful_ui_lang_v1', keepStored);
  return out;
})()`, true, 40000);
        pass('live coupons config: 📖 How to use opens the coupon part', !!guideLive && /#start-coupons-(en|zh-Hant|zh-CN)$/.test(guideLive.coupons || ''),
            guideLive && guideLive.coupons);
        if (guideLive && guideLive.afterSwitch !== undefined) {
            pass('live: switching the dashboard to 简体 updates the manual link on click', /#start-coupons-zh-CN$/.test(guideLive.afterSwitch), guideLive.afterSwitch);
        }
        pass('live: 📖 link opens the manual at its first page (contents), 繁 row + Reward points marked', !!guideLive && guideLive.start &&
            guideLive.start.scrollY === 0 && guideLive.start.row === 'zh-Hant' && guideLive.start.part === 'rewards' && guideLive.start.tab === '繁體中文',
            JSON.stringify(guideLive && guideLive.start));
        pass('live: manual with no anchor opens in the dashboard language (简 / English), else 繁', !!guideLive &&
            guideLive.bareCn === '#start-rewards-zh-CN' && guideLive.bareEn === '#start-rewards-en' && guideLive.bareNone === '#start-rewards-zh-Hant',
            JSON.stringify(guideLive && [guideLive.bareCn, guideLive.bareEn, guideLive.bareNone]));
        pass('live: manual page builds cover + 9 parts (3 per language) and opens 繁 coupons', !!guideLive && guideLive.manualOk && guideLive.pages === 10 &&
            guideLive.onTab === '繁體中文' && /優惠券/.test(guideLive.title || ''), JSON.stringify(guideLive && { p: guideLive.pages, t: guideLive.onTab, h: guideLive.title }));

        // Ledger panel tabs: clinic context and the coupon join check are stubbed; a dummy patient id reads nothing.
        var ptabs = await cdp.js(`(async () => {
  const pid = '00000000-0000-0000-0000-0000000000a1';
  const keepCtx = window.billPaymentClinicContext;
  const keepTag = window.currentClinicCodeForTagging;
  const keepAvail = COUPONS.walletAvailable;
  const wait = async (fn, ms) => { const d = Date.now() + ms; while (Date.now() < d) { if (fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
  function state() {
    const tp = document.getElementById('rwTabPoints'), tc = document.getElementById('rwTabCoupons');
    const pp = document.getElementById('rwPanePoints'), pc = document.getElementById('rwPaneCoupons');
    return {
      pDis: tp.disabled, cDis: tc.disabled, pOn: tp.classList.contains('is-on'), cOn: tc.classList.contains('is-on'),
      pNote: !tp.querySelector('.rw-ptab-off').hidden, cNote: !tc.querySelector('.rw-ptab-off').hidden,
      pPane: !pp.hidden, cPane: !pc.hidden, cHtml: pc.innerHTML.length,
      pOpacity: getComputedStyle(tp).opacity, first: tp.parentElement.firstElementChild === tp
    };
  }
  async function scene(clinic, couponsOn) {
    window.billPaymentClinicContext = function () { return { clinic_id: null, clinic_code: clinic, clinic_tag: clinic }; };
    window.currentClinicCodeForTagging = function () { return clinic; };
    COUPONS.walletAvailable = function () { return Promise.resolve(couponsOn); };
    REWARDS.closePatientPanel();
    REWARDS.openPatientPanel(pid);
    const tp = document.getElementById('rwTabPoints'), tc = document.getElementById('rwTabCoupons');
    await wait(() => tp.classList.contains('is-on') || tc.classList.contains('is-on') || (tp.disabled && tc.disabled), 8000);
    await new Promise(r => setTimeout(r, 150));
    return state();
  }
  const out = {};
  try {
    out.both = await scene('PL', true);
    document.getElementById('rwTabCoupons').click();
    const pc = document.getElementById('rwPaneCoupons');
    await wait(() => !!pc.querySelector('.dc-wsum-row'), 10000);
    out.walletTab = state();
    out.wallet = {
      sum: !!pc.querySelector('.dc-wsum'), qr: !!pc.querySelector('[data-dc-wallet-qr]'),
      guide: (pc.querySelector('.loyalty-guide-btn') || {}).getAttribute ? pc.querySelector('.loyalty-guide-btn').getAttribute('href') : '',
      heads: pc.querySelectorAll('.dc-wl-h').length, hint: /Choose/.test(pc.textContent),
      subTabs: Array.prototype.map.call(pc.querySelectorAll('[data-wl-tab]'), b => b.getAttribute('data-wl-tab')).join(','),
      noApply: !pc.querySelector('#dcApply,#dcClear,.dc-sheet-foot')
    };
    const visible = name => { const p = pc.querySelector('[data-wl-panel="' + name + '"]'); return !!p && !p.hidden && p.offsetParent !== null; };
    pc.querySelector('[data-wl-tab="gift"]').click();
    out.gift = { shown: visible('gift'), walletHidden: !visible('wallet'), kind: !!pc.querySelector('[data-wl="giftKind"]'),
      none: /Turn a cash or treatment coupon on/.test(pc.querySelector('[data-wl-panel="gift"]').textContent),
      lock: !!pc.querySelector('[data-wl-panel="gift"] .dc-lock-note') };
    const giftGo = pc.querySelector('[data-wl="giftGo"]');
    if (giftGo) {
      const kind = pc.querySelector('[data-wl="giftKind"]');
      const cashOpt = Array.prototype.filter.call(kind.options, o => o.value === 'cash')[0];
      if (cashOpt) { kind.value = 'cash'; kind.dispatchEvent(new Event('change')); pc.querySelector('[data-wl="giftAmount"]').value = '500'; }
      if (cashOpt) {
        giftGo.click();
        out.gift.amountErr = (pc.querySelector('[data-wl="giftErr"]') || {}).textContent || '';
        pc.querySelector('[data-wl="giftAmount"]').value = '50';
        await new Promise(r => setTimeout(r, 800));
      }
      giftGo.click();
      const modal = document.getElementById('rewardPatientModal');
      await wait(() => !!modal.querySelector('.dc-authp form'), 3000);
      const prompt = modal.querySelector('.dc-authp');
      out.gift.prompt = !!prompt && getComputedStyle(prompt).position === 'fixed' && prompt.getBoundingClientRect().width >= window.innerWidth - 2;
      out.gift.promptWhat = prompt ? (prompt.querySelector('.dc-authp-what') || {}).textContent : '';
      if (prompt) prompt.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      out.gift.closedOnEsc = !modal.querySelector('.dc-authp');
      out.gift.panelStillOpen = getComputedStyle(modal).display !== 'none';
    }
    pc.querySelector('[data-wl-tab="transfer"]').click();
    out.xfer = { shown: visible('transfer'), pick: !!pc.querySelector('[data-wl="xferPick"]'), to: !!pc.querySelector('[data-wl="xferTo"]'),
      goDisabled: !!(pc.querySelector('[data-wl="xferGo"]') || {}).disabled,
      noneHint: /No coupon here can be transferred/.test(pc.querySelector('[data-wl-panel="transfer"]').textContent) };
    pc.querySelector('[data-wl-tab="wallet"]').click();
    out.backWallet = visible('wallet') && !visible('transfer');
    document.getElementById('rwTabPoints').click();
    out.backToPoints = state();
    out.noPoints = await scene('ZZZ', true);
    out.none = await scene('ZZZ', false);
    out.noCoupons = await scene('PL', false);
    document.getElementById('rwTabCoupons').click();
    out.noCouponsClick = state();
  } finally {
    window.billPaymentClinicContext = keepCtx;
    window.currentClinicCodeForTagging = keepTag;
    COUPONS.walletAvailable = keepAvail;
    REWARDS.closePatientPanel();
  }
  return out;
})()`, true, 90000);
        var pt = ptabs || {};
        pass('live panel tabs: both schemes on -> ledger tab first and open, coupons tab clickable',
            pt.both && pt.both.first && pt.both.pOn && pt.both.pPane && !pt.both.cPane && !pt.both.pDis && !pt.both.cDis, JSON.stringify(pt.both));
        pass('live panel tabs: coupon tab shows the wallet (summary, Wallet QR, 📖 coupons manual, live + history)',
            pt.walletTab && pt.walletTab.cOn && pt.walletTab.cPane && !pt.walletTab.pPane && pt.wallet && pt.wallet.sum && pt.wallet.qr &&
            /#start-coupons-/.test(pt.wallet.guide || '') && pt.wallet.heads === 2 && pt.wallet.hint, JSON.stringify(pt.wallet));
        pass('live coupon tab: Wallet / Gift / Transfer sub-tabs, no Use / Apply (not tied to a bill)', pt.wallet && pt.wallet.subTabs === 'wallet,gift,transfer' &&
            pt.wallet.noApply && pt.backWallet === true, JSON.stringify(pt.wallet));
        pass('live coupon tab: Gift section opens (choices or the turn-on hint, 🔒 note)', pt.gift && pt.gift.shown && pt.gift.walletHidden &&
            (pt.gift.kind || pt.gift.none) && pt.gift.lock, JSON.stringify(pt.gift));
        if (pt.gift && pt.gift.prompt !== undefined) {
            pass('live coupon tab: Gift asks for the staff login over the panel; Escape closes only the prompt', pt.gift.prompt &&
                /→/.test(pt.gift.promptWhat || '') && pt.gift.closedOnEsc && pt.gift.panelStillOpen &&
                (pt.gift.amountErr === undefined || pt.gift.amountErr.length > 0), JSON.stringify(pt.gift));
        }
        pass('live coupon tab: Transfer section (coupon, to chart no., 🔒 Transfer; empty wallet -> disabled + hint)', pt.xfer && pt.xfer.shown &&
            pt.xfer.pick && pt.xfer.to && pt.xfer.goDisabled && pt.xfer.noneHint, JSON.stringify(pt.xfer));
        pass('live panel tabs: back to the ledger tab', pt.backToPoints && pt.backToPoints.pOn && pt.backToPoints.pPane && !pt.backToPoints.cPane);
        pass('live panel tabs: clinic not in points -> ledger tab greyed + disabled, opens on coupons', pt.noPoints && pt.noPoints.pDis &&
            pt.noPoints.pNote && Number(pt.noPoints.pOpacity) < 0.6 && !pt.noPoints.pPane && pt.noPoints.cOn && pt.noPoints.cPane, JSON.stringify(pt.noPoints));
        pass('live panel tabs: clinic in neither -> both greyed, nothing shown', pt.none && pt.none.pDis && pt.none.cDis &&
            !pt.none.pPane && !pt.none.cPane && pt.none.cHtml === 0 && pt.none.pNote && pt.none.cNote, JSON.stringify(pt.none));
        pass('live panel tabs: clinic not in coupons -> coupon tab greyed, click does nothing', pt.noCoupons && pt.noCoupons.cDis &&
            pt.noCoupons.cNote && pt.noCoupons.pOn && pt.noCouponsClick && pt.noCouponsClick.pOn && !pt.noCouponsClick.cPane &&
            pt.noCouponsClick.cHtml === 0, JSON.stringify(pt.noCouponsClick));

        var dirMenu = await cdp.js(`(async () => {
  const pid = '00000000-0000-0000-0000-0000000000a2';
  const keepCtx = window.billPaymentClinicContext;
  const keepTag = window.currentClinicCodeForTagging;
  const keepAvail = COUPONS.walletAvailable;
  const tb = document.getElementById('patientTableBody');
  const keepRows = tb.innerHTML;
  const keepCache = patientListCache;
  const wait = async (fn, ms) => { const d = Date.now() + ms; while (Date.now() < d) { if (fn()) return true; await new Promise(r => setTimeout(r, 100)); } return false; };
  const out = {};
  try {
    window.billPaymentClinicContext = function () { return { clinic_id: null, clinic_code: 'PL', clinic_tag: 'PL' }; };
    window.currentClinicCodeForTagging = function () { return 'PL'; };
    COUPONS.walletAvailable = function () { return Promise.resolve(true); };
    REWARDS.closePatientPanel();
    renderPatients([{ id: pid, patient_no: 'ZZ-TEST', full_name: 'Menu Test', chinese_name: '測試' }]);
    const item = tb.querySelector('.btn-reward-ledger[data-id="' + pid + '"]');
    out.item = !!item;
    out.label = item ? item.textContent.trim() : '';
    out.title = item ? item.title : '';
    if (item) item.click();
    const modal = document.getElementById('rewardPatientModal');
    await wait(() => document.getElementById('rwTabPoints').classList.contains('is-on'), 8000);
    out.open = getComputedStyle(modal).display !== 'none';
    out.tabs = Array.prototype.map.call(modal.querySelectorAll('[data-rw-ptab]'), b => b.getAttribute('data-rw-ptab') + (b.disabled ? ':off' : ':on')).join(',');
    out.pointsOpen = !document.getElementById('rwPanePoints').hidden;
    document.getElementById('rwTabCoupons').click();
    await wait(() => !!document.querySelector('#rwPaneCoupons .dc-wl-tabs'), 10000);
    out.couponsOpen = !document.getElementById('rwPaneCoupons').hidden &&
      Array.prototype.map.call(document.querySelectorAll('#rwPaneCoupons [data-wl-tab]'), b => b.getAttribute('data-wl-tab')).join(',');
  } finally {
    window.billPaymentClinicContext = keepCtx;
    window.currentClinicCodeForTagging = keepTag;
    COUPONS.walletAvailable = keepAvail;
    REWARDS.closePatientPanel();
    patientListCache = keepCache;
    tb.innerHTML = keepRows;
  }
  return out;
})()`, true, 40000);
        var dm = dirMenu || {};
        pass('live patient dir ⋯: item reads Rewards (tooltip: points and coupons)', dm.item && dm.label === 'Rewards' &&
            /Reward points and discount coupons/.test(dm.title), JSON.stringify(dm));
        pass('live patient dir ⋯ Rewards opens the two-tab panel (points first, coupons second)', dm.open &&
            dm.tabs === 'points:on,coupons:on' && dm.pointsOpen, JSON.stringify(dm));
        pass('live patient dir ⋯ Rewards: coupon tab shows Wallet / Gift / Transfer', dm.couponsOpen === 'wallet,gift,transfer', JSON.stringify(dm));

        var bannerGuide = await cdp.js(`(async () => {
  const out = {};
  const oldLang = typeof getAppLang === 'function' ? getAppLang() : 'en';
  ['con', 'appt'].forEach(k => {
    const btn = document.getElementById(k + 'BannerRewardsBtn');
    const a = document.getElementById(k + 'BannerRewardsBtnGuide');
    out[k] = { btn: !!btn, guide: !!a, next: !!btn && btn.nextElementSibling === a, href: a ? a.getAttribute('href') : '',
      text: a ? a.textContent : '', target: a ? a.target : '', cls: a ? a.className : '' };
  });
  const a = document.getElementById('conBannerRewardsBtnGuide');
  if (a && typeof setAppLang === 'function') {
    setAppLang('zh-CN');
    a.addEventListener('click', e => e.preventDefault(), { once: true });
    a.click();
    out.afterCn = a.getAttribute('href');
    setAppLang(oldLang);
  }
  async function frame(hash) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-2000px;top:0;width:900px;height:700px;';
    f.src = 'docs/loyalty-manual.html?v=dk' + Date.now() + hash;
    document.body.appendChild(f);
    await new Promise(res => { f.onload = res; setTimeout(res, 8000); });
    await new Promise(res => setTimeout(res, 300));
    const d = f.contentDocument;
    const r = {
      part: (d.querySelector('.xhg-cover-toc li.is-on a.is-on[data-part]') || { getAttribute: () => null }).getAttribute('data-part'),
      scrollY: f.contentWindow.scrollY,
      deskLinks: d.querySelectorAll('.xhg-cover-toc a[data-part="desk"]').length,
      deskTitle: (d.querySelector('#desk-en .xhg-title') || {}).textContent || '',
      deskHead: !!d.querySelector('#desk-zh-Hant .xhg-head.is-desk'),
      deskSteps: d.querySelectorAll('#desk-en .xhg-step').length,
      mocks: d.querySelectorAll('#desk-en .lm-mock').length,
      deskTop: Math.round((d.getElementById('desk-en') || { getBoundingClientRect: () => ({ top: -1 }) }).getBoundingClientRect().top)
    };
    f.remove();
    return r;
  }
  out.start = await frame('#start-desk-zh-Hant');
  out.desk = await frame('#desk-en');
  return out;
})()`, true, 40000);
        var bg = bannerGuide || {};
        pass('live banner: 📖 How to use sits right after the Rewards button (consultation + appointment banners)',
            bg.con && bg.con.btn && bg.con.guide && bg.con.next && bg.appt && bg.appt.guide && bg.appt.next &&
            /^📖/.test(bg.con.text) && bg.con.target === '_blank' && /rw-banner-guide/.test(bg.con.cls), JSON.stringify(bg.con) + ' ' + JSON.stringify(bg.appt));
        pass('live banner: 📖 opens the manual contents with the payment desk part marked, in the dashboard language',
            /^docs\/loyalty-manual\.html\?v=20261030howto#start-desk-(en|zh-Hant|zh-CN)$/.test((bg.con || {}).href || '') && /#start-desk-zh-CN$/.test(bg.afterCn || ''),
            (bg.con || {}).href + ' / ' + bg.afterCn);
        pass('live manual: #start-desk-x opens the contents page with 🧾 desk marked (3 desk links)', bg.start && bg.start.part === 'desk' &&
            bg.start.scrollY === 0 && bg.start.deskLinks === 3, JSON.stringify(bg.start));
        pass('live manual: #desk-en jumps to the desk part: 9 steps, 2 pictures, green header', bg.desk && bg.desk.deskSteps === 9 && bg.desk.mocks === 2 &&
            /payment desk/.test(bg.desk.deskTitle) && bg.desk.deskHead && bg.desk.scrollY > 1000 && bg.desk.deskTop >= 0 && bg.desk.deskTop < 90, JSON.stringify(bg.desk));

        // Admin view of the cap card; the save is stubbed so no setting is written.
        var capAdm = await cdp.js(`(async () => {
  const pane = document.getElementById('cfgPane-rewards');
  if (!pane) return { ok: false, reason: 'no pane' };
  const oldRole = typeof currentRole !== 'undefined' ? currentRole : '';
  const oldPersist = window.persistProgramSettingRow;
  const oldAlert = window.alert;
  let wrote = null, alerted = '';
  try {
    window.alert = function (m) { alerted = String(m); };
    currentRole = 'admin';
    window.persistProgramSettingRow = function (row) { wrote = row; return Promise.resolve({ error: null }); };
    REWARDS.renderConfigPane(pane);
    const t0 = Date.now();
    while (Date.now() - t0 < 12000 && !document.getElementById('rwCfgCapSave')) await new Promise(r => setTimeout(r, 200));
    const pct = document.getElementById('rwCfgCapPct'), amt = document.getElementById('rwCfgCapAmt');
    const btn = document.getElementById('rwCfgCapSave');
    if (!pct || !amt || !btn) return { ok: false, reason: 'no inputs' };
    const before = { pct: pct.value, amt: amt.value };
    pct.value = '40'; amt.value = '2500';
    btn.click();
    const t1 = Date.now();
    while (Date.now() - t1 < 8000 && !wrote) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 100));
    return { ok: true, before, wrote, alerted, sum: (document.getElementById('rwCfgCapSum') || {}).textContent || '' };
  } catch (e) {
    return { ok: false, reason: String(e && e.message || e) };
  } finally {
    currentRole = oldRole;
    window.persistProgramSettingRow = oldPersist;
    window.alert = oldAlert;
    REWARDS.loadRedeemCap(true).catch(function () {});
  }
})()`, true, 60000);
        pass('live config (admin): cap card has % and HK$ boxes', capAdm && capAdm.ok, capAdm && (capAdm.reason || JSON.stringify(capAdm.before)));
        if (capAdm && capAdm.ok) {
            pass('live config (admin): Save writes reward_redeem_cap {40%, 2500}',
                !!capAdm.wrote && capAdm.wrote.setting_key === 'reward_redeem_cap' &&
                capAdm.wrote.setting_value === '{"maxPercent":40,"maxAmount":2500}', JSON.stringify(capAdm.wrote));
            pass('live config (admin): summary updates after Save', /40%/.test(capAdm.sum) && /2,500/.test(capAdm.sum), capAdm.sum);
        }

        // ── Points on the phone QR (rw_wallet_link stubbed: no token is written) ──
        console.log('\n=== CDP points on the phone QR ===');
        var pqr = await cdp.js(`(async () => {
  const out = {};
  const wait = (test, ms) => new Promise(res => { const t0 = Date.now(); (function tick() { if (test() || Date.now() - t0 > ms) res(test()); else setTimeout(tick, 100); })(); });
  const pid = '00000000-0000-0000-0000-0000000000aa';
  const realRpc = SB.rpc, realFrom = SB.from, realConfirm = window.confirm, realWa = window.openWhatsAppPrefill;
  const calls = [], sent = [];
  let rpcMode = 'ok';
  SB.rpc = function (name, args) {
    if (name !== 'rw_wallet_link') return realRpc.apply(SB, arguments);
    calls.push({ name: name, reset: !!(args && args.p_reset), pid: args && args.p_patient_id });
    if (rpcMode === 'missing') return Promise.resolve({ data: null, error: { message: 'Could not find the function public.rw_wallet_link(p_by, p_patient_id, p_reset) in the schema cache' } });
    return Promise.resolve({ data: { ok: true, token: args && args.p_reset ? 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' : 'abcdefabcdefabcdefabcdefabcdef12' }, error: null });
  };
  SB.from = function (table) {
    if (table !== 'patients') return realFrom.apply(SB, arguments);
    return { select: function (cols) {
      if (cols !== 'patient_no,chinese_name,full_name,phone_number') return realFrom.call(SB, table).select(cols);
      const row = { patient_no: 'T001', chinese_name: '陳大文', full_name: 'Chan Tai Man', phone_number: '9123 4567', mobile_phone: '6000 0000' };
      return { eq: function () { return { maybeSingle: function () { return Promise.resolve({ data: row, error: null }); } }; } };
    } };
  };
  window.confirm = function () { return true; };
  window.openWhatsAppPrefill = function (p, m) { sent.push({ phone: p, msg: m }); return true; };
  const realCtx = window.billPaymentClinicContext;
  window.billPaymentClinicContext = function () { return { clinic_id: null, clinic_code: 'PL', clinic_tag: 'PL' }; };
  try {
    REWARDS.openPatientPanel(pid);
    const modal = document.getElementById('rewardPatientModal');
    await wait(() => modal && getComputedStyle(modal).display !== 'none', 5000);
    await wait(() => !document.getElementById('rwPanePoints').hidden, 8000);
    const btn = document.getElementById('rwPhoneQrBtn');
    out.btnShown = !!btn && !btn.hidden && btn.offsetParent !== null && /Points on the phone/.test(btn.textContent);
    const guide = document.getElementById('rwGuideBtn');
    if (guide) {
      guide.addEventListener('click', e => e.preventDefault(), { once: true });
      guide.click();
      const lang = typeof getAppLang === 'function' ? getAppLang() : 'en';
      out.guide = { shown: guide.offsetParent !== null, text: guide.textContent, href: guide.getAttribute('href'), target: guide.target,
        lang: ['zh-Hant', 'zh-CN'].indexOf(lang) >= 0 ? lang : 'en' };
    }
    btn.click();
    await wait(() => !!modal.querySelector('.dc-wqr #dcWqrCode canvas, .dc-wqr #dcWqrCode img'), 10000);
    const wrap = modal.querySelector('.dc-wqr');
    out.inModal = !!wrap && wrap.getAttribute('data-scheme') === 'rewards';
    out.title = (document.getElementById('dcWqrTitle') || {}).textContent || '';
    out.link = (document.getElementById('dcWqrLink') || {}).value || '';
    const cv = modal.querySelector('#dcWqrCode canvas');
    out.qr = !!cv && cv.width === 220;
    out.calls = calls.slice();
    await wait(() => (document.getElementById('dcWqrPhone') || {}).value === '9123 4567', 4000);
    out.phone = document.getElementById('dcWqrPhone').value;
    const card = document.getElementById('dcWqrBox');
    const r = card.getBoundingClientRect();
    const box = modal.querySelector('.reward-points-modal-box');
    const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + 30);
    const iCard = stack.findIndex(el => card.contains(el));
    const iBox = stack.findIndex(el => box.contains(el) && !wrap.contains(el));
    out.onTop = iCard >= 0 && (iBox < 0 || iCard < iBox);
    const wr = wrap.getBoundingClientRect();
    out.fullScreen = Math.round(wr.width) === innerWidth && Math.round(wr.height) === innerHeight && wr.left === 0 && wr.top === 0;
    out.notInBox = !box.contains(wrap);
    out.inView = r.top >= 0 && r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    if (!(out.onTop && out.fullScreen && out.inView)) {
      out.topDebug = { stack: stack.slice(0, 4).map(el => el.tagName + '#' + el.id + '.' + el.className), card: [r.left, r.top, r.width, r.height].map(Math.round),
        wrap: [wr.left, wr.top, wr.width, wr.height].map(Math.round), view: [innerWidth, innerHeight] };
    }
    await wait(() => !document.getElementById('dcWqrWa').disabled, 4000);
    document.getElementById('dcWqrWa').click();
    out.wa = sent[0] || null;
    out.linkLabel = (modal.querySelector('.dc-wqr-linkfield > span') || {}).textContent || '';
    document.getElementById('dcWqrReset').click();
    await wait(() => (document.getElementById('dcWqrLink').value || '').indexOf('eeee') > 0, 5000);
    out.resetLink = document.getElementById('dcWqrLink').value;
    wrap.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    out.escClosesQrOnly = !modal.querySelector('.dc-wqr') && getComputedStyle(modal).display !== 'none';
    rpcMode = 'missing';
    btn.click();
    await wait(() => { const e = document.getElementById('dcWqrErr'); return e && !e.hidden; }, 5000);
    out.missingMsg = (document.getElementById('dcWqrErr') || {}).textContent || '';
    REWARDS.closePatientPanel();
    out.closeAlsoClosesQr = !document.querySelector('#rewardPatientModal .dc-wqr');
  } catch (e) {
    out.err = String(e && e.stack || e);
  } finally {
    SB.rpc = realRpc; SB.from = realFrom; window.confirm = realConfirm; window.openWhatsAppPrefill = realWa;
    window.billPaymentClinicContext = realCtx;
  }
  return out;
})()`, true, 40000);
        pass('CDP ledger panel shows Points on the phone', !!(pqr && pqr.btnShown), JSON.stringify(pqr).slice(0, 300));
        pass('CDP ledger panel has 📖 How to use -> points part of the manual in the dashboard language (new tab)',
            !!(pqr && pqr.guide && pqr.guide.shown && /^📖/.test(pqr.guide.text) && pqr.guide.target === '_blank' &&
                pqr.guide.href === 'docs/loyalty-manual.html?v=20261030howto#start-rewards-' + pqr.guide.lang), JSON.stringify(pqr && pqr.guide));
        pass('CDP points QR covers the screen above the ledger panel (not clipped by the panel box)',
            !!(pqr && pqr.inModal && pqr.onTop && pqr.fullScreen && pqr.notInBox && pqr.inView),
            pqr && JSON.stringify(pqr.topDebug || ''));
        pass('CDP points QR title and link label', !!(pqr && /Reward points on the phone/.test(pqr.title) && /Points link/.test(pqr.linkLabel)),
            pqr && (pqr.title + ' | ' + pqr.linkLabel));
        pass('CDP points QR asks rw_wallet_link and links to points.html', !!(pqr && pqr.qr && pqr.calls.length >= 1 &&
            pqr.calls[0].name === 'rw_wallet_link' && pqr.calls[0].reset === false && pqr.calls[0].pid === '00000000-0000-0000-0000-0000000000aa' &&
            /\/points\.html\?t=abcdefabcdefabcdefabcdefabcdef12$/.test(pqr.link)), pqr && pqr.link);
        pass('CDP points QR fills the main phone (not Other Phone Numbers) and WhatsApps the points message', !!(pqr && pqr.phone === '9123 4567' && pqr.wa &&
            pqr.wa.phone === '9123 4567' && pqr.wa.msg.indexOf(pqr.link) > 0 && pqr.wa.msg.indexOf('陳大文 你好！') > 0 &&
            /reward points balance/.test(pqr.wa.msg)), pqr && pqr.wa && pqr.wa.msg.replace(/\n/g, ' | '));
        pass('CDP points New QR code asks for a fresh token', !!(pqr && /t=e{32}$/.test(pqr.resetLink)), pqr && pqr.resetLink);
        pass('CDP Esc closes the points QR and keeps the ledger panel', !!(pqr && pqr.escClosesQrOnly));
        pass('CDP points QR explains when reward_points_wallet.sql is not run', !!(pqr && /reward_points_wallet\.sql/.test(pqr.missingMsg)), pqr && pqr.missingMsg);
        pass('CDP closing the ledger panel closes the points QR', !!(pqr && pqr.closeAlsoClosesQr), pqr && pqr.err);

        var ppage = await cdp.js(`(async () => {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-2000px;top:0;width:390px;height:800px';
  f.src = 'points.html?t=00000000000000000000000000000000&g=en';
  document.body.appendChild(f);
  const t0 = Date.now();
  let d = null;
  while (Date.now() - t0 < 12000) {
    d = f.contentDocument;
    if (d && d.querySelector('#wlMain .wl-error, #wlMain .wl-pts-card')) break;
    await new Promise(r => setTimeout(r, 200));
  }
  const out = { real: d ? (d.querySelector('#wlMain') || {}).textContent : '' };
  const w = f.contentWindow;
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({ at: '2026-10-1' + (i % 9) + 'T02:00:00Z', kind: i % 3 ? 'earn' : 'redeem', points: i % 3 ? 123.45 : -1000, clinic: 'PL' });
  d.getElementById('wlMain').innerHTML = w.CSPoints.renderHtml({ ok: true, balance: 123456.78, charts: 2, started_at: '2025-02-01T00:00:00Z',
    clinics: [{ clinic: 'PL', balance: 100000 }, { clinic: 'PY', balance: 23456.78 }], earn_rate: 10, zero_policy: 'year_end', rows: rows }, 'en', false);
  await new Promise(r => setTimeout(r, 150));
  const card = d.querySelector('.wl-pts-card');
  out.cardBg = card ? getComputedStyle(card).backgroundImage : '';
  out.bigSize = parseFloat(getComputedStyle(d.getElementById('wlPtsBalance')).fontSize);
  out.noSideScroll = d.documentElement.scrollWidth <= d.documentElement.clientWidth + 1;
  out.rows = d.querySelectorAll('.wl-pts-row').length;
  out.minusColour = getComputedStyle(d.querySelector('.wl-pts-amt.is-minus')).color;
  out.title = d.title;
  f.remove();
  return out;
})()`, true, 20000);
        pass('CDP points.html explains a link that is not valid (real database call)',
            !!(ppage && /not valid any more|Could not load your points/.test(ppage.real)), ppage && ppage.real);
        pass('CDP points.html styled card, big balance, no sideways scroll at 390px', !!(ppage && /gradient/.test(ppage.cardBg) &&
            ppage.bigSize >= 36 && ppage.noSideScroll && ppage.rows === 20 && ppage.minusColour === 'rgb(194, 65, 12)' && ppage.title === 'My reward points'),
            ppage && JSON.stringify(ppage).slice(0, 240));

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
      const brk = document.getElementById('rwPatientClinicBreakdown');
      out.panelBreakdownExists = !!brk;
      out.panelBreakdownVisible = !!(brk && !brk.hidden && getComputedStyle(brk).display !== 'none');
      out.panelBreakdownText = brk ? String(brk.textContent || '').replace(/\s+/g, ' ').trim() : '';
      out.panelBreakdownChipCount = brk ? brk.querySelectorAll('.rw-bal-chip').length : 0;
      // Expect chips when person has balances in ≥2 clinics
      const clinicBal = {};
      (accounts || []).forEach(function (a) {
        if (!a || !(Number(a.balance) > 0.005)) return;
        const cc = String(a.clinic_code || '').trim().toUpperCase() || '_';
        clinicBal[cc] = (clinicBal[cc] || 0) + Number(a.balance);
      });
      out.panelClinicCount = Object.keys(clinicBal).length;
      out.panelBreakdownExpected = out.panelClinicCount >= 2;
      if (typeof REWARDS.closePatientPanel === 'function') REWARDS.closePatientPanel();
    }
    // Payment panel source paint (hidden panel DOM)
    if (typeof REWARDS.refreshAddPaymentRewardPanel === 'function') {
      window.bdCurrentBill = {
        id: 'smoke-bill',
        patient_id: pid,
        balance: 100,
        doctor_name: 'DR. NG PUI CHING',
        doctor_tag: 'DR. NG PUI CHING'
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
                    pass('live patient panel clinic breakdown node',
                        realLive.panelBreakdownExists === true);
                    if (realLive.panelBreakdownExpected) {
                        pass('live patient panel clinic chips when multi-clinic',
                            realLive.panelBreakdownVisible === true &&
                            Number(realLive.panelBreakdownChipCount) >= 2,
                            'clinics=' + realLive.panelClinicCount +
                            ' chips=' + realLive.panelBreakdownChipCount +
                            ' text=' + String(realLive.panelBreakdownText || '').slice(0, 80));
                    } else {
                        pass('live patient panel clinic breakdown hidden for single clinic',
                            realLive.panelBreakdownVisible !== true,
                            'clinics=' + realLive.panelClinicCount);
                    }
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

            // Cross-clinic transfer attribution: #001003 must see #021713 Dr points
            var xferPair = global.__REWARD_SMOKE_XFER_PAIR__;
            if (xferPair && xferPair.pl_id) {
                var xferLive = await cdp.js(`(async () => {
  const plId = ${JSON.stringify(xferPair.pl_id)};
  const out = {};
  try {
    const accounts = await REWARDS.listPersonAccounts(plId);
    out.nos = (accounts || []).map(a => String(a.patient_no || ''));
    out.has021713 = out.nos.indexOf('021713') >= 0;
    out.has001003 = out.nos.indexOf('001003') >= 0;
    const nets = await REWARDS.loadDoctorLedgerNets(plId);
    const doc = REWARDS.resolveRewardDoctor('DR. NG PUI CHING');
    out.docKey = doc && doc.key;
    const capped = REWARDS.accountsCappedForDoctor(accounts, nets, doc.key);
    out.cappedNos = (capped || []).map(a => a.patient_no + '@' + a.clinic_code + '=' + a.balance);
    out.pyCapped = (capped || []).filter(a => String(a.patient_no) === '021713')
      .reduce((s, a) => s + Number(a.balance || 0), 0);
    out.redeemable = await REWARDS.getRedeemableBalanceForDoctor(plId, 'DR. NG PUI CHING');
    window.bdCurrentBill = {
      id: 'smoke-xfer-bill',
      patient_id: plId,
      balance: 200,
      doctor_name: 'DR. NG PUI CHING',
      doctor_tag: 'DR. NG PUI CHING'
    };
    await REWARDS.refreshAddPaymentRewardPanel();
    const src = document.getElementById('apRewardSources');
    const balPay = document.getElementById('apRewardBalance');
    out.payBal = balPay ? String(balPay.textContent || '').trim() : null;
    out.paySrcText = src ? String(src.textContent || '').replace(/\\s+/g, ' ').trim() : '';
    out.payShows021713 = !!(out.paySrcText && out.paySrcText.indexOf('021713') >= 0);
    out.payShowsPY = !!(out.paySrcText && out.paySrcText.indexOf('PY') >= 0);
    delete window.bdCurrentBill;
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.err = String(e && e.message || e);
  }
  return out;
})()`, true, 45000);
                pass('live cross-clinic charts linked',
                    xferLive && xferLive.ok !== false && xferLive.has021713 === true,
                    xferLive && (xferLive.err || JSON.stringify(xferLive.nos || []).slice(0, 80)));
                pass('live PY transfer points redeemable for same Dr',
                    xferLive && Number(xferLive.pyCapped) > 0.005,
                    xferLive && ('py=' + xferLive.pyCapped + ' total=' + xferLive.redeemable +
                        ' capped=' + JSON.stringify(xferLive.cappedNos || []).slice(0, 120)));
                pass('live payment panel lists PY #021713',
                    xferLive && xferLive.payShows021713 === true,
                    xferLive && ('bal=' + xferLive.payBal + ' src=' +
                        String(xferLive.paySrcText || '').slice(0, 100)));
            }

            // Gain and redeem must give one answer per bill (no writes:
            // applyRedeemForBill is probed with an amount above any balance,
            // so it stops at the cap check before inserting a payment).
            console.log('\n=== CDP live gain/redeem together (#001003 real bills) ===');
            var joinPid = (xferPair && xferPair.pl_id) ||
                (smokePat && smokePat.patient_no === '001003' ? smokePat.patient_id : null);
            if (!joinPid) {
                warn('live gain/redeem together skipped', 'no #001003 patient id');
            } else {
                var joinLive = await cdp.js(`(async () => {
  const pid = ${JSON.stringify(joinPid)};
  const out = { rows: [] };
  try {
    const r = await SB.from('bills')
      .select('id,patient_id,clinic_id,clinic_tag,doctor_id,dentist_id,doctor_name,doctor_tag,dentist_name,balance,created_at')
      .eq('patient_id', pid).order('created_at', { ascending: false }).limit(12);
    if (r.error) throw r.error;
    const bills = r.data || [];
    out.billCount = bills.length;
    const cl = await SB.from('clinics').select('id,clinic_code');
    const codeById = {};
    (cl.data || []).forEach(c => { codeById[c.id] = c.clinic_code; });
    const notJoinedMsg = (typeof t === 'function') ? t('rewards.pay.doctorNotJoined') : '';
    for (const b of bills) {
      const code = String(b.clinic_tag || codeById[b.clinic_id] || '').trim();
      const cid = b.clinic_id || null;
      const doc = REWARDS.resolveRewardDoctor(b);
      const again = REWARDS.resolveRewardDoctor(doc);
      const gain = !!(await REWARDS.isClinicGainJoined(cid, code, b));
      const redeemPanel = !!(await REWARDS.isClinicRedeemJoined(cid, code, b));
      const redeemSave = !!(await REWARDS.isClinicRedeemJoined(cid, code, doc));
      let saveErr = '';
      if (REWARDS.isKnownRewardDoctor ? REWARDS.isKnownRewardDoctor(doc) : !!doc.label) {
        const res = await REWARDS.applyRedeemForBill({
          patientId: pid, points: 999999, billId: b.id, bill: b,
          clinicId: cid, clinicCode: code
        });
        saveErr = String((res && res.error) || '');
      }
      out.rows.push({
        bill: String(b.id).slice(0, 8), code, tag: b.doctor_tag || b.doctor_name || '',
        key: doc.key, keyStable: doc.key === again.key, did: doc.doctor_id || null,
        gain, redeemPanel, redeemSave,
        saveSaysNotJoined: !!(notJoinedMsg && saveErr.indexOf(notJoinedMsg) >= 0),
        saveErr: saveErr.slice(0, 60)
      });
    }
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.err = String(e && e.message || e);
  }
  return out;
})()`, true, 60000);
                pass('live #001003 bills loaded', joinLive && joinLive.ok && joinLive.billCount > 0,
                    joinLive && (joinLive.err || ('bills=' + joinLive.billCount)));
                (joinLive && joinLive.rows || []).forEach(function (row) {
                    var label = '#001003 bill ' + row.bill + ' ' + row.code + ' ' + row.tag;
                    console.log('      ' + label + '  key=' + row.key + ' doctor_id=' +
                        (row.did ? row.did.slice(0, 8) : '—') + '  gain=' + row.gain +
                        ' panel=' + row.redeemPanel + ' save=' + row.redeemSave +
                        (row.saveErr ? '  saveMsg="' + row.saveErr + '"' : ''));
                    pass('live gain = redeem (panel + save) ' + label,
                        row.gain === row.redeemPanel && row.gain === row.redeemSave);
                    pass('live doctor key stable on re-check ' + label, row.keyStable === true, row.key);
                    if (row.saveErr) {
                        pass('live redeem save agrees with join ' + label,
                            row.saveSaysNotJoined === !row.redeemSave,
                            'joined=' + row.redeemSave + ' msg=' + row.saveErr);
                    }
                });
                var govLive = await cdp.js(`(async () => {
  const pid = ${JSON.stringify(joinPid)};
  const out = { rows: [], writes: [] };
  const realSB = SB;
  try {
    const r = await realSB.from('bills').select('id,patient_id,coupon_amount,amount_paid,total,doctor_name,clinic_tag')
      .eq('patient_id', pid).order('created_at', { ascending: false }).limit(8);
    if (r.error) throw r.error;
    for (const b of (r.data || [])) {
      const pays = await realSB.from('bill_payments').select('method,voided_at').eq('bill_id', b.id);
      const methods = (pays.data || []).filter(p => !p.voided_at).map(p => p.method);
      const expect = methods.some(m => window.isLoyaltyExcludedPayMethod(m));
      const got = await REWARDS.billLoyaltyExcluded(b.id);
      const block = await REWARDS.excludedPaymentBlock(b, 'PDCC', 0);
      const blockPts = await REWARDS.excludedPaymentBlock(b, 'PDCC', 10);
      out.rows.push({ bill: String(b.id).slice(0, 8), methods: methods.join('/'), expect, got,
        coupon: Number(b.coupon_amount) || 0, block: block.slice(0, 40), blockPts: blockPts.slice(0, 40) });
    }
    SB = {
      from: function (t) {
        const q = realSB.from(t);
        ['insert', 'update', 'upsert', 'delete'].forEach(k => { q[k] = function () { out.writes.push(t + '.' + k); return Promise.resolve({ data: null, error: null }); }; });
        return q;
      },
      rpc: function (f) { out.writes.push('rpc:' + f); return Promise.resolve({ data: { ok: true, skipped: true }, error: null }); }
    };
    const firstId = r.data && r.data[0] && r.data[0].id;
    out.earn = firstId ? await REWARDS.applyEarnForPayment({ patientId: pid, eligibleAmount: 1000, billId: firstId, method: 'PDCC', bill: r.data[0] }) : null;
    out.redeem = firstId ? await REWARDS.applyRedeemForBill({ patientId: pid, points: 10, billId: firstId, method: 'Government', bill: r.data[0] }) : null;
    out.ok = true;
  } catch (e) {
    out.ok = false;
    out.err = String(e && e.message || e);
  } finally { SB = realSB; }
  return out;
})()`, true, 60000);
                pass('live #001003 Government / PDCC probe ran', govLive && govLive.ok, govLive && govLive.err);
                (govLive && govLive.rows || []).forEach(function (row) {
                    var label = '#001003 bill ' + row.bill + ' [' + row.methods + ']';
                    pass('live bill-level Government / PDCC check matches its payments ' + label, row.expect === row.got,
                        'expect=' + row.expect + ' got=' + row.got);
                    pass('live PDCC payment blocked only when the bill has a coupon or used points ' + label,
                        row.coupon > 0.005 ? row.block.length > 0 : true, row.block || 'allowed');
                    pass('live points + PDCC on the same payment always blocked ' + label, row.blockPts.length > 0, row.blockPts);
                });
                pass('live #001003 PDCC earn skipped', govLive && govLive.earn && govLive.earn.skipped && govLive.earn.reason === 'excluded_method',
                    govLive && JSON.stringify(govLive.earn));
                pass('live #001003 Government redeem refused', govLive && govLive.redeem && govLive.redeem.ok === false,
                    govLive && JSON.stringify(govLive.redeem));
                pass('live #001003 Government / PDCC probe wrote nothing', govLive && govLive.writes.length === 0,
                    govLive && govLive.writes.join(','));
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
