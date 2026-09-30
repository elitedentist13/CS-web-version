/**
 * X-ray AI helper — smoke / spot / API + CDP Runtime.evaluate / clienttest / live page.
 * Proves Analyze does not need the Banana live server on :5500.
 * The live page is http://xray-ai.test:<port> (mapped to this machine), not :5500.
 * Run: node scripts/xray-ai-protocol-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');
var crypto = require('crypto');
var vm = require('vm');

var BUILD = '20260930xraygithub1';
var PAGE_PORT = 8791;
var CDP_PORT = 9353;
var BANANA_LIVE_PORT = 5500;
var CHROME = process.env.CHROME_PATH ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var root = path.resolve(__dirname, '..');
var fails = [];

function pass(name, ok, detail) {
    var line = (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —  ' + detail : '');
    console.log(line);
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

function extractFn(src, name) {
    var marker = 'function ' + name + '(';
    var start = src.indexOf(marker);
    if (start < 0) throw new Error('missing ' + name);
    var i = src.indexOf('{', start);
    var depth = 0;
    for (var j = i; j < src.length; j++) {
        var ch = src.charAt(j);
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return src.slice(start, j + 1);
        }
    }
    throw new Error('unclosed ' + name);
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

function httpGet(host, port, reqPath) {
    return new Promise(function (resolve, reject) {
        var req = http.get({ host: host, port: port, path: reqPath, timeout: 4000 }, function (r) {
            var d = '';
            r.on('data', function (c) { d += c; });
            r.on('end', function () { resolve({ status: r.statusCode, body: d }); });
        });
        req.on('error', reject);
        req.on('timeout', function () {
            req.destroy();
            reject(new Error('timeout ' + host + ':' + port + reqPath));
        });
    });
}

function rest(base, key, method, table, qs, body) {
    var url = base.replace(/\/$/, '') + '/rest/v1/' + table + (qs ? ('?' + qs) : '');
    return fetch(url, {
        method: method,
        headers: {
            apikey: key,
            Authorization: 'Bearer ' + key,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        },
        body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
        return r.text().then(function (t) {
            var json = null;
            try { json = JSON.parse(t); } catch (e) {}
            return { status: r.status, json: json, raw: t.slice(0, 300) };
        });
    });
}

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
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

function startStaticServer(port) {
    var types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    var server = http.createServer(function (req, res) {
        var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/') urlPath = '/index.html';
        var file = path.normalize(path.join(root, urlPath));
        if (file.indexOf(root) !== 0) {
            res.writeHead(403); res.end('no'); return;
        }
        fs.readFile(file, function (err, buf) {
            if (err) { res.writeHead(404); res.end('missing'); return; }
            res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
            res.end(buf);
        });
    });
    return new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', function () { resolve(server); });
    });
}

function classifyHost(src, host) {
    var fn = extractFn(src, 'xrayAiPageIsLocalServer');
    var ctx = { window: { location: { hostname: host } }, result: null };
    vm.createContext(ctx);
    vm.runInContext(fn + '\nresult = xrayAiPageIsLocalServer();', ctx);
    return ctx.result;
}

(async function main() {
    console.log('=== smoke / spot: X-ray AI protocol (BUILD ' + BUILD + ') ===\n');
    var aiSrc = read('app-xray-ai.js');
    var idx = read('index.html');
    var cmd = read('launch-xray-ai-protocol.cmd');
    var ps1 = read('launch-xray-ai-protocol.ps1');
    var sql = read('xray_ai_jobs.sql');
    var appJs = read('app.js');

    console.log('=== spot: source ===');
    pass('index BUILD', idx.indexOf("BUILD = '" + BUILD + "'") >= 0,
        (idx.match(/BUILD = '([^']+)'/) || [])[1]);
    pass('helper script cache bust', idx.indexOf('app-xray-ai.js?v=' + BUILD) >= 0);
    pass('page gate function', aiSrc.indexOf('function xrayAiPageIsLocalServer()') >= 0);
    pass('protocol fetch', aiSrc.indexOf('function xrayAiProtocolFetch(') >= 0);
    pass('job link shape', aiSrc.indexOf("csxrayai://job?id=") >= 0);
    pass('hosted analyze does not fall back to browser heuristic',
        aiSrc.indexOf("xrayAiTr('media.xrayAi.protocolWorking')") >= 0 &&
        aiSrc.indexOf('if (!xrayAiPageIsLocalServer())') >= 0);
    pass('5500 page still uses the direct AI service',
        aiSrc.indexOf("runClient('api_down')") >= 0 &&
        aiSrc.indexOf('xrayAiCheckApiHealth()') >= 0);
    var xraySrc = read('app-xray.js');
    var nntSrc = read('app-nnt-scans.js');
    pass('xray software opens through csxray://',
        xraySrc.indexOf("csxray://open/") >= 0 &&
        xraySrc.indexOf('if (sys.launcherKey)') >= 0);
    pass('github page does not fetch local film strips',
        nntSrc.indexOf('function clinicPageIsLocalServer()') >= 0 &&
        nntSrc.indexOf('!clinicPageIsLocalServer()') >= 0);
    pass('cmd dispatches job URLs', cmd.indexOf('://job') >= 0 && cmd.indexOf('launch-xray-ai-protocol.ps1') >= 0);
    pass('jobs table SQL', sql.indexOf('xray_ai_jobs') >= 0 && sql.indexOf('xray_ai_jobs_anon_all') >= 0);

    console.log('\n=== clienttest: host gate (no browser) ===');
    var cases = [
        ['127.0.0.1', true],
        ['localhost', true],
        ['::1', true],
        ['xray-ai.test', false],
        ['', false],
        ['192.168.1.20', false]
    ];
    cases.forEach(function (row) {
        var got = classifyHost(aiSrc, row[0]);
        var label = row[0] === '' ? '(file host)' : row[0];
        pass('host ' + label + (row[1] ? ' is live-server' : ' uses protocol'), got === row[1], String(got));
    });

    var openFn = extractFn(aiSrc, 'xrayAiOpenJobProtocol');
    var hrefBox = { href: '' };
    var doc = {
        createElement: function () {
            return {
                style: {},
                click: function () { hrefBox.href = this.href; },
                remove: function () {},
                href: ''
            };
        },
        body: { appendChild: function () {}, removeChild: function () {} }
    };
    var ctx = { document: doc, encodeURIComponent: encodeURIComponent };
    vm.createContext(ctx);
    vm.runInContext(openFn + '\nxrayAiOpenJobProtocol("11111111-1111-4111-8111-111111111111");', ctx);
    pass('protocol click target',
        hrefBox.href === 'csxrayai://job?id=11111111-1111-4111-8111-111111111111',
        hrefBox.href || '(empty)');

    var filmFn = extractFn(nntSrc, 'clinicPageIsLocalServer');
    [['127.0.0.1', true], ['localhost', true], ['elitedentist13.github.io', false], ['xray-ai.test', false]].forEach(function (row) {
        var filmCtx = { window: { location: { hostname: row[0] } }, result: null };
        vm.createContext(filmCtx);
        vm.runInContext(filmFn + '\nresult = clinicPageIsLocalServer();', filmCtx);
        pass('film strips ' + row[0] + (row[1] ? ' stay on the live server' : ' stay off the GitHub page'),
            filmCtx.result === row[1], String(filmCtx.result));
    });

    console.log('\n=== protocol parser ===');
    await new Promise(function (resolve) {
        var child = child_process.spawn('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass',
            '-File', path.join(root, 'launch-xray-ai-protocol.ps1'),
            '-SelfTest'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        var out = '';
        child.stdout.on('data', function (c) { out += c; });
        child.stderr.on('data', function (c) { out += c; });
        child.on('close', function (code) {
            pass('powershell job URL self-test', code === 0 && out.indexOf('protocol self-test ok') >= 0,
                out.trim().slice(0, 180));
            resolve();
        });
    });

    console.log('\n=== API ===');
    var sb = readSbConfig(appJs);
    var listed = await rest(sb.url, sb.key, 'GET', 'xray_ai_jobs', 'select=id,status&limit=1');
    pass('xray_ai_jobs readable', listed.status === 200 && Array.isArray(listed.json),
        'HTTP ' + listed.status + ' ' + (listed.raw || '').slice(0, 160));

    if (listed.status === 200) {
        var id = crypto.randomUUID();
        var inserted = await rest(sb.url, sb.key, 'POST', 'xray_ai_jobs', '', [{
            id: id,
            kind: 'http',
            status: 'pending',
            payload: { method: 'GET', path: '/health', smoke: true }
        }]);
        var row = Array.isArray(inserted.json) ? inserted.json[0] : null;
        pass('insert job row', inserted.status >= 200 && inserted.status < 300 && row && row.id === id,
            'HTTP ' + inserted.status);
        var patched = await rest(sb.url, sb.key, 'PATCH', 'xray_ai_jobs', 'id=eq.' + id, {
            status: 'error',
            error: 'smoke-test-not-a-real-analysis'
        });
        var patchedRow = Array.isArray(patched.json) ? patched.json[0] : null;
        pass('patch job so it is not picked up',
            patched.status >= 200 && patched.status < 300 && patchedRow && patchedRow.status === 'error',
            'HTTP ' + patched.status + ' status=' + (patchedRow && patchedRow.status));
    }

    try {
        var health = await httpGet('127.0.0.1', 8877, '/health');
        var hj = {};
        try { hj = JSON.parse(health.body); } catch (e) {}
        pass('local AI /health', health.status === 200 && hj.ok === true,
            'HTTP ' + health.status + (hj.model ? ' model=' + hj.model : ''));
    } catch (e) {
        pass('local AI /health', false, 'not running (' + e.message + ') — wiring tests do not start it');
    }

    try {
        await httpGet('127.0.0.1', BANANA_LIVE_PORT, '/index.html');
        console.log('note  Banana live server :' + BANANA_LIVE_PORT + ' is up; this test does not use it');
    } catch (e) {
        console.log('note  Banana live server :' + BANANA_LIVE_PORT + ' is not required and was not used');
    }

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        finish(1);
        return;
    }

    var server = await startStaticServer(PAGE_PORT);
    var profile = path.join(os.tmpdir(), 'cs-xray-ai-protocol-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    fs.mkdirSync(profile, { recursive: true });
    var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/index.html?_lr=' + BUILD;
    var proc = child_process.spawn(CHROME, [
        '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + profile,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-popup-blocking',
        '--host-resolver-rules=MAP xray-ai.test 127.0.0.1',
        '--window-size=1280,900',
        hosted
    ], { stdio: 'ignore' });

    var ws = null;
    try {
        await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000);
        var tabs = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000);
        var page = (tabs || []).find(function (t) {
            return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0;
        });
        pass('CDP page target', !!page && !!page.webSocketDebuggerUrl, page ? page.url : 'none');
        if (!page) throw new Error('no page target');
        pass('live page is not Banana :' + BANANA_LIVE_PORT,
            String(page.url).indexOf(':' + BANANA_LIVE_PORT) < 0 &&
            String(page.url).indexOf('xray-ai.test:' + PAGE_PORT) >= 0,
            page.url);

        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) {
            ws.addEventListener('open', resolve);
            ws.addEventListener('error', reject);
        });
        var cdp = new Cdp(ws);
        await cdp.call('Page.enable');
        await cdp.call('Runtime.enable');
        await cdp.call('Page.navigate', { url: hosted });
        await sleep(800);

        var live = await cdp.js(`(async () => {
          const res = await fetch('/app-xray-ai.js?b=${BUILD}', { cache: 'no-store' });
          const src = await res.text();
          function extractFn(src, name) {
            const marker = 'function ' + name + '(';
            let start = src.indexOf(marker);
            if (start < 0) throw new Error('missing ' + name);
            const i = src.indexOf('{', start);
            let depth = 0;
            for (let j = i; j < src.length; j++) {
              if (src[j] === '{') depth++;
              else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
            }
            throw new Error('unclosed ' + name);
          }
          const localFn = extractFn(src, 'xrayAiPageIsLocalServer');
          const openFn = extractFn(src, 'xrayAiOpenJobProtocol');
          let href = '';
          const orig = document.createElement.bind(document);
          document.createElement = function (tag) {
            const el = orig(tag);
            if (String(tag).toLowerCase() === 'a') {
              el.click = function () { href = el.href; };
            }
            return el;
          };
          eval(localFn + '\\n' + openFn + '\\nwindow.__xrayAiSmoke = { local: xrayAiPageIsLocalServer() };\\nxrayAiOpenJobProtocol("22222222-2222-4222-8222-222222222222");');
          document.createElement = orig;
          const xraySrc = await (await fetch('/app-xray.js?b=${BUILD}', { cache: 'no-store' })).text();
          const nntSrc = await (await fetch('/app-nnt-scans.js?b=${BUILD}', { cache: 'no-store' })).text();
          return {
            host: location.hostname,
            port: location.port,
            build: window.__JSM_BUILD || '',
            local: window.__xrayAiSmoke.local,
            href: href,
            scriptHasProtocol: src.indexOf('csxrayai://job?id=') >= 0,
            xrayProtocol: xraySrc.indexOf('csxray://open/') >= 0,
            filmsLocalOnly: nntSrc.indexOf('function clinicPageIsLocalServer()') >= 0
          };
        })()`, true, 20000);

        pass('Runtime.evaluate hosted host', live && live.host === 'xray-ai.test', live && live.host);
        pass('Runtime.evaluate not the live-server port', live && String(live.port) === String(PAGE_PORT), live && live.port);
        pass('Runtime.evaluate page BUILD', live && live.build === BUILD, live && live.build);
        pass('Runtime.evaluate uses protocol off the live server', live && live.local === false, String(live && live.local));
        pass('Runtime.evaluate GitHub-style page has csxray and csxrayai',
            live && live.xrayProtocol === true && live.scriptHasProtocol === true && live.filmsLocalOnly === true,
            live ? ('xray=' + live.xrayProtocol + ' ai=' + live.scriptHasProtocol) : 'none');
        pass('Runtime.evaluate job link not navigated',
            live && live.href === 'csxrayai://job?id=22222222-2222-4222-8222-222222222222',
            live && live.href);

        await cdp.call('Page.navigate', { url: 'http://127.0.0.1:' + PAGE_PORT + '/index.html?_lr=' + BUILD });
        await sleep(600);
        var loop = await cdp.js(`(async () => {
          const src = await (await fetch('/app-xray-ai.js?b=${BUILD}', { cache: 'no-store' })).text();
          const marker = 'function xrayAiPageIsLocalServer(';
          const start = src.indexOf(marker);
          const i = src.indexOf('{', start);
          let depth = 0, end = -1;
          for (let j = i; j < src.length; j++) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') { depth--; if (depth === 0) { end = j + 1; break; } }
          }
          eval(src.slice(start, end));
          return { host: location.hostname, port: location.port, local: xrayAiPageIsLocalServer() };
        })()`, true, 20000);
        pass('same files on 127.0.0.1 still count as the local page',
            loop && loop.local === true && loop.host === '127.0.0.1' && String(loop.port) !== String(BANANA_LIVE_PORT),
            loop ? (loop.host + ':' + loop.port + ' local=' + loop.local) : 'none');
    } catch (e) {
        pass('CDP live page', false, e && e.message ? e.message : String(e));
    } finally {
        try { if (ws) ws.close(); } catch (e) {}
        try { proc.kill(); } catch (e) {}
        await new Promise(function (r) { server.close(r); });
    }

    finish(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});

function finish(code) {
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + API + CDP + CLIENTTEST + LIVE PAGE ALL PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}
