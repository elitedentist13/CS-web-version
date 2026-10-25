/**
 * Dr Parco Poon / Dr Poon Pak Hong — one report alias, both names on the
 * reward-points participation list.
 * Smoke (source) + unit (vm) + HTML spot + API (read-only) + CDP Runtime.evaluate.
 * Run: node scripts/parco-poon-alias-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261025parcoBoth1';
var PAGE_PORT = 8826;
var CDP_PORT = 9426;
var CHROME = process.env.CHROME_PATH ||
    (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-doctor-aliases.js'))) root = process.cwd();

var SPELLINGS = [
    'DR. POON PAK HONG',
    'Dr Poon Pak Hong',
    'POON PAK HONG',
    '潘柏匡牙科醫生',
    '潘柏匡',
    'DR.PARCO POON',
    'DR PARCO POON',
    'DR. POON',
    'DR.POON',
    'Parco Poon'
];

var fails = [];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —  ' + detail : ''));
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
        headers: {
            apikey: key,
            Authorization: 'Bearer ' + key,
            Accept: 'application/json'
        }
    }).then(function (r) {
        return r.text().then(function (t) {
            var json = null;
            try { json = JSON.parse(t); } catch (e) {}
            return { status: r.status, json: json, raw: t.slice(0, 240) };
        });
    });
}

function loadAliases() {
    var ctx = { window: {}, module: { exports: {} }, console: console };
    vm.createContext(ctx);
    vm.runInContext(read('app-doctor-aliases.js'), ctx);
    return ctx.DoctorAliases || ctx.module.exports;
}

function startStaticServer(port) {
    var types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml'
    };
    var server = http.createServer(function (req, res) {
        var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        var file = path.normalize(path.join(root, urlPath));
        if (file.indexOf(root) !== 0) { res.writeHead(403); res.end('no'); return; }
        fs.readFile(file, function (err, buf) {
            if (err) { res.writeHead(404); res.end('missing'); return; }
            res.writeHead(200, {
                'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
                'Cache-Control': 'no-store'
            });
            res.end(buf);
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
        timeout: timeoutMs || 45000
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

(async function main() {
    var aliasSrc = read('app-doctor-aliases.js');
    var rewardsSrc = read('app-rewards.js');
    var html = read('index.html');
    var appJs = read('app.js');

    console.log('=== smoke: source ===');
    pass('index BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    pass('app-rewards.js cache-buster', html.indexOf('app-rewards.js?v=' + BUILD) >= 0);
    SPELLINGS.forEach(function (s) {
        pass('alias lists ' + s, aliasSrc.indexOf(s) >= 0);
    });
    pass('parco-poon group kept', /key:\s*'parco-poon'/.test(aliasSrc));
    pass('participation list adds Dr Parco Poon',
        rewardsSrc.indexOf("docRowHtml('parco-poon', 'Dr Parco Poon'") >= 0);
    pass('legacy Pak Hong key still counts as joined',
        rewardsSrc.indexOf('PARCO_POON_LEGACY_KEYS') >= 0 &&
        rewardsSrc.indexOf("'name:poon pak hong'") >= 0);
    pass('twin Join checkboxes stay in sync',
        rewardsSrc.indexOf('function syncSameDoctorJoin') >= 0);
    pass('one switch writes gain and redeem together',
        /join_gain: joined,\s*join_redeem: joined/.test(rewardsSrc));
    pass('joined scope enables both gain and redeem',
        rewardsSrc.indexOf('var redeem = gain;') >= 0 &&
        rewardsSrc.indexOf('function scopeJoined') >= 0);
    pass('list labels Gain and Redeem',
        rewardsSrc.indexOf("tr('rewards.cfg.joinGain'") >= 0 &&
        rewardsSrc.indexOf("tr('rewards.cfg.joinRedeem'") >= 0);
    pass('node --check aliases', child_process.spawnSync(process.execPath, ['--check', path.join(root, 'app-doctor-aliases.js')]).status === 0);
    pass('node --check rewards', child_process.spawnSync(process.execPath, ['--check', path.join(root, 'app-rewards.js')]).status === 0);

    console.log('\n=== unit: alias ===');
    var A = loadAliases();
    SPELLINGS.forEach(function (s) {
        var p = A.resolveFromTexts([s]);
        pass(s + ' → parco-poon', !!(p && p.key === 'parco-poon' && p.label === 'Dr Parco Poon'),
            p && (p.key + ' / ' + p.label));
    });
    var row = A.resolveFromDoctor({
        english_name: 'DR. POON PAK HONG',
        chinese_name: '潘柏匡牙科醫生',
        doctor_code: 'DR. POON PAK HONG'
    });
    pass('doctor row resolves to parco-poon', !!(row && row.key === 'parco-poon' && row.label === 'Dr Parco Poon'));
    var ng = A.resolveFromTexts(['Dr Ng Pui Ching']);
    pass('Ng Pui Ching unchanged', !!(ng && ng.key === 'ng-pui-ching'), ng && ng.key);
    var bill = A.resolveFromBill({
        doctor_name: '潘柏匡牙科醫生',
        doctor_tag: 'DR. POON PAK HONG',
        doctor_id: '6a6d369d-7f4c-400b-9889-593008bdedf6'
    }, []);
    pass('bill 潘柏匡 groups as Dr Parco Poon', !!(bill && bill.key === 'parco-poon'), bill && bill.label);

    console.log('\n=== HTML spot ===');
    var server = null;
    try {
        server = await startStaticServer(PAGE_PORT);
        var idx = await httpGetText(PAGE_PORT, '/index.html');
        var al = await httpGetText(PAGE_PORT, '/app-doctor-aliases.js?v=' + BUILD);
        var rw = await httpGetText(PAGE_PORT, '/app-rewards.js?v=' + BUILD);
        pass('index.html 200', idx.status === 200, 'status ' + idx.status);
        pass('served BUILD', idx.body.indexOf("var BUILD = '" + BUILD + "'") >= 0);
        pass('served aliases include 潘柏匡', al.status === 200 && al.body.indexOf('潘柏匡牙科醫生') >= 0,
            'status ' + al.status);
        pass('served rewards add Dr Parco Poon',
            rw.status === 200 && rw.body.indexOf("docRowHtml('parco-poon', 'Dr Parco Poon'") >= 0,
            'status ' + rw.status);
    } catch (e) {
        pass('HTML spot', false, e && e.message);
    }

    console.log('\n=== API (read-only) ===');
    try {
        var sb = readSbConfig(appJs);
        var docs = await restGet(sb.url, sb.key, 'doctors',
            'select=id,doctor_code,english_name,chinese_name,clinic_id,is_active&or=(english_name.ilike.*poon*,doctor_code.ilike.*poon*,chinese_name.ilike.*%E6%BD%98%E6%9F%8F%E5%8C%A1*)&order=doctor_code.asc');
        pass('doctors REST ok', docs.status === 200 && Array.isArray(docs.json), 'HTTP ' + docs.status);
        var rows = Array.isArray(docs.json) ? docs.json : [];
        var pak = rows.filter(function (d) {
            return /POON PAK HONG|潘柏匡/i.test((d.english_name || '') + ' ' + (d.doctor_code || '') + ' ' + (d.chinese_name || ''));
        });
        pass('one clinical Pak Hong row', pak.length === 1, 'n=' + pak.length + (pak[0] ? ' ' + pak[0].doctor_code : ''));
        if (pak[0]) {
            var resolved = A.resolveFromDoctor(pak[0]);
            pass('live Pak Hong row aliases to Dr Parco Poon',
                !!(resolved && resolved.key === 'parco-poon'), resolved && resolved.label);
        }
        var joins = await restGet(sb.url, sb.key, 'reward_program_doctors',
            'select=clinic_code,doctor_key,doctor_label,join_gain,join_redeem&or=(doctor_label.ilike.*poon*,doctor_label.ilike.*%E6%BD%98%E6%9F%8F%E5%8C%A1*,doctor_key.ilike.*poon*)&limit=50');
        pass('reward_program_doctors readable', joins.status === 200 && Array.isArray(joins.json),
            'HTTP ' + joins.status + ' n=' + (Array.isArray(joins.json) ? joins.json.length : 0));
    } catch (e) {
        pass('API probe', false, e && e.message);
    }

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    var proc = null;
    try {
        if (!server) throw new Error('static server not up');
        if (!fs.existsSync(CHROME)) throw new Error('no chrome ' + CHROME);
        var profile = path.join(os.tmpdir(), 'cs-parco-poon-cdp');
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e0) {}
        fs.mkdirSync(profile, { recursive: true });
        proc = child_process.spawn(CHROME, [
            '--remote-debugging-port=' + CDP_PORT,
            '--user-data-dir=' + profile,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-sync',
            '--disable-popup-blocking',
            '--window-size=1280,900',
            'http://127.0.0.1:' + PAGE_PORT + '/index.html?_lr=parcoPoon1'
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
        await waitJs(cdp, "typeof DoctorAliases !== 'undefined' && typeof DoctorAliases.resolveFromTexts === 'function'", 30000);
        pass('live DoctorAliases loaded', true);
        await waitJs(cdp, "typeof REWARDS !== 'undefined' && typeof REWARDS.renderConfigPane === 'function'", 30000);
        pass('live REWARDS.renderConfigPane', true);
        await waitJs(cdp, "Array.isArray(APP_DOCTORS) && APP_DOCTORS.some(function (d) { return /POON PAK HONG/i.test(String(d.english_name || '') + String(d.doctor_code || '')); })", 30000);
        pass('live APP_DOCTORS includes Pak Hong', true);

        var liveAlias = await cdp.js(`(function () {
  var names = ${JSON.stringify(SPELLINGS)};
  return names.map(function (s) {
    var p = DoctorAliases.resolveFromTexts([s]);
    return { s: s, key: p && p.key, label: p && p.label };
  });
})()`, false, 10000);
        var bad = (liveAlias || []).filter(function (x) {
            return !x || x.key !== 'parco-poon' || x.label !== 'Dr Parco Poon';
        });
        pass('CDP Runtime.evaluate all spellings → Dr Parco Poon', bad.length === 0,
            bad.map(function (x) { return x.s + '=' + x.key; }).join(' | ') || (liveAlias || []).length + ' ok');

        var paint = await cdp.js(`(async () => {
  var pane = document.getElementById('cfgPane-rewards');
  if (!pane) return { ok: false, reason: 'no pane' };
  REWARDS.renderConfigPane(pane);
  var deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    var html = pane.innerHTML || '';
    if (html.indexOf('rw-doc-row') >= 0 && html.indexOf('Loading') < 0) break;
    await new Promise(function (r) { setTimeout(r, 250); });
  }
  var panel = null;
  document.querySelectorAll('.rw-clinic-panel').forEach(function (p) {
    if ((p.getAttribute('data-clinic-code') || '') === 'PL') panel = p;
  });
  if (!panel) return { ok: false, reason: 'no PL panel', len: (pane.innerHTML || '').length };
  var rows = [];
  panel.querySelectorAll('.rw-doc-row').forEach(function (r) {
    var cb = r.querySelector('.rw-doc-join');
    var toggle = r.querySelector('.rw-doc-toggle');
    rows.push({
      key: r.getAttribute('data-doctor-key'),
      label: r.getAttribute('data-doctor-label'),
      checked: !!(cb && cb.checked),
      text: toggle ? String(toggle.textContent || '').replace(/\\s+/g, ' ').trim() : ''
    });
  });
  return { ok: true, rows: rows };
})()`, true, 25000);

        var rows = (paint && paint.rows) || [];
        var parcoRows = rows.filter(function (r) { return r.key === 'parco-poon'; });
        pass('live PL list has two parco-poon rows', parcoRows.length === 2,
            parcoRows.map(function (r) { return r.label; }).join(' | ') || (paint && paint.reason) || 'none');
        pass('live list still shows Pak Hong',
            parcoRows.some(function (r) { return /PAK HONG/i.test(r.label || ''); }),
            parcoRows.map(function (r) { return r.label; }).join(' | '));
        pass('live list shows Dr Parco Poon',
            parcoRows.some(function (r) { return r.label === 'Dr Parco Poon'; }));
        pass('live Poon rows are joined for gain and redeem',
            parcoRows.length === 2 && parcoRows.every(function (r) { return r.checked; }),
            parcoRows.map(function (r) { return r.label + (r.checked ? ' on' : ' off'); }).join(' | '));
        pass('live switch is labeled gain and redeem',
            parcoRows.every(function (r) {
                return /Gain|赚取|賺取/.test(r.text || '') && /Redeem|兑换|兌換/.test(r.text || '');
            }),
            parcoRows.map(function (r) { return r.text; }).join(' | '));
        try { ws.close(); } catch (e1) {}
    } catch (e) {
        pass('CDP live page', false, e && e.message);
    } finally {
        if (proc) { try { proc.kill(); } catch (e2) {} }
        if (server) { try { server.close(); } catch (e3) {} }
    }

    console.log('\n=== result ===');
    if (fails.length) {
        console.log('FAILED ' + fails.length);
        fails.forEach(function (f) { console.log(' - ' + f); });
        process.exit(1);
    }
    console.log('SMOKE + UNIT + HTML + API + CDP + LIVE PAGE ALL PASS');
    process.exit(0);
})().catch(function (err) {
    console.error('ERROR', err && err.stack ? err.stack : err);
    process.exit(1);
});
