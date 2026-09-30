/**
 * CDP live-page + client Runtime.evaluate for treatment-stats cheapest-first.
 * Does not log in and does not write. Uses SB read-only from the page if present.
 * Run: node scripts/tx-stats-cheapest-cdp.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20260930txcheap1';
var APP_PORT = 5500;
var CDP_PORT = 9347;
var CHROME = process.env.CHROME_PATH ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var fails = [];

function pass(name, ok, detail) {
    var line = (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —  ' + detail : '');
    console.log(line);
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
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

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
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
    throw new Error('waitJs failed: ' + String(last).slice(0, 200));
}

(async function main() {
    console.log('=== CDP live page / Runtime.evaluate / clienttest ===');
    var idxProbe = await new Promise(function (resolve, reject) {
        http.get({ host: '127.0.0.1', port: APP_PORT, path: '/index.html?_lr=' + BUILD, timeout: 5000 }, function (r) {
            var d = '';
            r.on('data', function (c) { d += c; });
            r.on('end', function () { resolve({ status: r.statusCode, body: d }); });
        }).on('error', reject);
    });
    pass('clinic UI on :' + APP_PORT, idxProbe.status === 200);
    pass('served index BUILD ' + BUILD,
        idxProbe.body.indexOf("BUILD = '" + BUILD + "'") >= 0,
        (idxProbe.body.match(/BUILD = '([^']+)'/) || [])[1]);

    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        console.log('\nFAILED ' + fails.length);
        process.exit(1);
    }

    var profile = path.join(os.tmpdir(), 'cs-tx-stats-cheapest-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    fs.mkdirSync(profile, { recursive: true });
    var appUrl = 'http://127.0.0.1:' + APP_PORT + '/index.html?_lr=' + BUILD;
    var proc = child_process.spawn(CHROME, [
        '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + profile,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-popup-blocking',
        '--window-size=1280,900',
        appUrl
    ], { stdio: 'ignore' });

    try {
        await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000);
        var tabs = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 5000);
        var page = (tabs || []).find(function (t) {
            return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0;
        });
        pass('CDP page target ready', !!page && !!page.webSocketDebuggerUrl,
            page ? page.url : 'none');
        if (!page) throw new Error('no page target');

        var ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) {
            ws.addEventListener('open', resolve);
            ws.addEventListener('error', reject);
        });
        var cdp = new Cdp(ws);
        await cdp.call('Page.enable');
        await cdp.call('Runtime.enable');
        await waitJs(cdp, "!!(window.__JSM_BUILD || document.getElementById('loginUserId'))", 25000);
        await waitJs(cdp, "typeof SB !== 'undefined' && !!SB && typeof SB.from === 'function'", 40000);
        await waitJs(cdp, "typeof REPORT !== 'undefined' && !!REPORT", 20000);

        var live = await cdp.js(`(async () => {
  const build = window.__JSM_BUILD || (typeof BUILD !== 'undefined' ? BUILD : '');
  const src = await (await fetch('/app-report.js?b=' + encodeURIComponent(build), { cache: 'no-store' })).text();
  function extractFn(src, name) {
    const marker = 'function ' + name + '(';
    let start = src.indexOf(marker);
    if (start < 0) throw new Error('missing ' + name);
    if (start >= 6 && src.slice(start - 6, start) === 'async ') start -= 6;
    const i = src.indexOf('{', start);
    let depth = 0;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') {
        depth--;
        if (depth === 0) return src.slice(start, j + 1);
      }
    }
    throw new Error('unclosed ' + name);
  }
  const names = [
    'billItemLineAmount', 'reportBillItemDiscPct', 'reportBillItemNet', 'parseBillItems',
    'txStatsDateArranged', 'allocateTreatmentPaymentCents', 'allocateTreatmentPaymentCheapestFirst',
    'treatmentStatsReceivedFee', 'collectTreatmentItemStatGroupsFromPayments'
  ];
  const tr = (k) => k === 'report.treat.defaultName' ? 'Treatment' : k;
  const code = names.map((n) => extractFn(src, n)).join('\\n') +
    '; return collectTreatmentItemStatGroupsFromPayments;';
  const collect = new Function('tr', code)(tr);
  const bill = {
    id: 'kwok',
    patient_no: 'TKO002615',
    patient_name: 'KWOK YEE KAN',
    bill_date: '2026-09-21',
    items: JSON.stringify([
      { desc: 'X-RAY', qty: 1, price: 150, disc: 0 },
      { desc: 'ROOT CANAL TREATMENT (RCT)', qty: 1, price: 8000, disc: 0 }
    ])
  };
  const groups = collect([{ amount: 5150, paid_date: '2026-09-21', bill: bill }], {}, null, {});
  const nets = {};
  groups.forEach((g) => { nets[g.item] = g.net; });
  const later = collect([{ amount: 3000, paid_date: '2026-10-05', bill: bill }], {}, null, { kwok: 5150 });
  const laterNets = {};
  later.forEach((g) => { laterNets[g.item] = g.net; });
  return {
    build,
    hasCheap: src.indexOf('function allocateTreatmentPaymentCheapestFirst') >= 0,
    usesCheapCall: src.indexOf('allocateTreatmentPaymentCheapestFirst(caps, priorCents, paidCents)') >= 0,
    oldProrataCall: /allocateTreatmentPaymentCents\\(weights, paidCents\\)/.test(src),
    nets,
    laterNets,
    reportReady: typeof REPORT !== 'undefined'
  };
})()`, true, 60000);

        pass('Runtime.evaluate client build is ' + BUILD, live && live.build === BUILD, live && live.build);
        pass('served app-report has cheapest-first allocator', !!(live && live.hasCheap));
        pass('served collect uses cheapest-first call', !!(live && live.usesCheapCall));
        pass('served collect no longer uses pro-rata weights call', !(live && live.oldProrataCall));
        pass('clienttest TKO002615: X-RAY $150 then RCT $5000',
            live && live.nets && live.nets['X-RAY'] === 150 &&
            live.nets['ROOT CANAL TREATMENT (RCT)'] === 5000,
            live ? JSON.stringify(live.nets) : 'no result');
        pass('clienttest later $3000 goes only to RCT',
            live && live.laterNets && !live.laterNets['X-RAY'] &&
            live.laterNets['ROOT CANAL TREATMENT (RCT)'] === 3000,
            live ? JSON.stringify(live.laterNets) : 'no result');
        pass('REPORT global present on live page', !!(live && live.reportReady));

        var apiLive = await cdp.js(`(async () => {
  if (typeof SB === 'undefined' || !SB || !SB.from) return { ok: false, reason: 'no SB' };
  const bills = await SB.from('bills')
    .select('id,patient_no,total,amount_paid,balance,items,voided_at,bill_date')
    .eq('patient_no', 'TKO002615')
    .is('voided_at', null)
    .order('bill_date', { ascending: false });
  if (bills.error) return { ok: false, reason: bills.error.message };
  const row = (bills.data || []).find((b) => {
    let items = b.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
    if (!Array.isArray(items)) return false;
    const d = items.map((it) => String(it.desc || '').toUpperCase()).join('|');
    return d.indexOf('X-RAY') >= 0 && d.indexOf('ROOT CANAL') >= 0;
  });
  if (!row) return { ok: false, reason: 'no rct+xray bill', n: (bills.data || []).length };
  const pays = await SB.from('bill_payments')
    .select('id,amount,paid_date,voided_at')
    .eq('bill_id', row.id)
    .is('voided_at', null);
  if (pays.error) return { ok: false, reason: pays.error.message };
  const paySum = (pays.data || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  return {
    ok: true,
    total: Number(row.total),
    paid: Number(row.amount_paid),
    balance: Number(row.balance),
    paySum,
    payCount: (pays.data || []).length,
    billId: row.id
  };
})()`, true, 60000);

        pass('live page SB read TKO002615 RCT+XRAY bill',
            !!(apiLive && apiLive.ok),
            apiLive ? JSON.stringify(apiLive) : 'no result');
        if (apiLive && apiLive.ok) {
            pass('live SB bill is $8150 / paid $5150 / balance $3000',
                apiLive.total === 8150 && apiLive.paid === 5150 && apiLive.balance === 3000,
                'total=' + apiLive.total + ' paid=' + apiLive.paid + ' bal=' + apiLive.balance);
            pass('live SB payments sum $5150',
                Math.round(apiLive.paySum * 100) === 515000,
                'sum=' + apiLive.paySum);
        }

        try { ws.close(); } catch (e) {}
    } finally {
        try { proc.kill(); } catch (e) {}
    }

    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'CDP + CLIENTTEST + LIVE PAGE ALL PASS'));
    if (fails.length) {
        fails.forEach(function (f) { console.log(' - ' + f); });
        process.exit(1);
    }
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
