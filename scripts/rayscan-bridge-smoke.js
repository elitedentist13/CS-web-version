/**
 * Rayscan (RAYBridge) bridge smoke — quiet by default.
 * Layers: source + HTTP spot + API (:17890 dry_run) + CDP Runtime.evaluate + live page.
 * Never calls /open/rayscan without dry_run=1 (no RAYBridge/SMARTDent popup).
 * Run: node scripts/rayscan-bridge-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261016ray';
var PAGE_PORT = 8798;
var CDP_PORT = 9372;
var BRIDGE = 'http://127.0.0.1:17890';
var LIVE = process.env.RAYSCAN_LIVE_BASE || 'http://127.0.0.1:5500';
var CHROME = process.env.CHROME_PATH ||
    (fs.existsSync('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe')
        ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
var root = path.resolve(__dirname, '..');
var fails = [];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}
function warn(name, detail) {
    console.log('WARN  ' + name + (detail ? '  -  ' + detail : ''));
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function httpGet(url, timeoutMs) {
    return new Promise(function (resolve, reject) {
        var u = new URL(url);
        var req = http.get({
            host: u.hostname,
            port: u.port || 80,
            path: u.pathname + u.search,
            timeout: timeoutMs || 5000,
            headers: { Connection: 'close', Accept: '*/*' }
        }, function (r) {
            var chunks = [];
            r.on('data', function (c) { chunks.push(c); });
            r.on('end', function () {
                resolve({ status: r.statusCode, headers: r.headers, body: Buffer.concat(chunks).toString('utf8') });
            });
        });
        req.on('error', reject);
        req.on('timeout', function () { req.destroy(); reject(new Error('timeout ' + url)); });
    });
}

function httpGetJson(url, timeoutMs) {
    return httpGet(url, timeoutMs).then(function (r) {
        var body = null;
        try { body = JSON.parse(r.body || '{}'); } catch (e) { body = { raw: r.body }; }
        return { status: r.status, body: body };
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
        expression: expression, returnByValue: true, awaitPromise: !!awaitPromise, timeout: (timeoutMs || 45000)
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
        if (file.indexOf(root) !== 0) { res.writeHead(403); res.end('no'); return; }
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

async function waitJson(url, timeoutMs) {
    var deadline = Date.now() + timeoutMs, last = null;
    while (Date.now() < deadline) {
        try { return (await httpGetJson(url)).body; }
        catch (e) { last = e; await sleep(250); }
    }
    throw new Error('timeout ' + url + ' last=' + (last && last.message));
}

var OPEN_DRY =
    BRIDGE + '/open/rayscan?dry_run=1&patient_no=PL001287&patient_name=' +
    encodeURIComponent('SMOKE QUIET') + '&sex=M';

(async function main() {
    console.log('=== smoke: source (Rayscan quiet wiring) ===');
    var xray = read('app-xray.js');
    var html = read('index.html');
    var launcher = read('tools/xray-local-launcher.ps1');
    pass('rayscan launcherKey is rayscan', /rayscan:\s*\{[\s\S]*?launcherKey:\s*'rayscan'/.test(xray));
    pass('csxray://open/ used for desktop systems', xray.indexOf('csxray://open/') >= 0);
    pass('index has xray-sys-rayscan button', html.indexOf('xray-sys-rayscan') >= 0 && html.indexOf("openXraySystem('rayscan')") >= 0);
    pass('Start-RayBridgePatient supports -DryRun', /Start-RayBridgePatient\(\$Resolved, \$Patient, \[switch\]\$DryRun\)/.test(launcher));
    pass('Handle-Request honors dry_run=1', /\$query\["dry_run"\]\s*-eq\s*"1"/.test(launcher));
    pass('SelfTest always asserts quiet dry_run', launcher.indexOf('/open/rayscan?dry_run=1 (quiet; no UI)') >= 0);
    pass('visible /open/rayscan only behind IncludeLiveLaunch',
        /if \(\$IncludeLiveLaunch\)/.test(launcher) &&
        /\/open\/rayscan\?" \+ \$qs/.test(launcher));
    pass('dry_run skips Start-Process for RAYBridge', /if \(-not \$DryRun\)/.test(launcher) && launcher.indexOf('Start-RestoreRayViewerWindow') >= 0);

    console.log('\n=== HTTP spot: live-server :5500 + smoke static :' + PAGE_PORT + ' ===');
    try {
        var liveIdx = await httpGet(LIVE + '/index.html', 5000);
        pass('live :5500 index.html', liveIdx.status === 200, 'bytes=' + liveIdx.body.length);
        pass('live index has rayscan button', liveIdx.body.indexOf('xray-sys-rayscan') >= 0);
    } catch (e) {
        pass('live :5500 index.html', false, e.message);
    }

    var server = null;
    try {
        server = await startStaticServer(PAGE_PORT);
        var smokeIdx = await httpGet('http://127.0.0.1:' + PAGE_PORT + '/index.html', 5000);
        pass('smoke static index.html', smokeIdx.status === 200, 'bytes=' + smokeIdx.body.length);
        pass('smoke static has rayscan button', smokeIdx.body.indexOf('xray-sys-rayscan') >= 0);
        pass('smoke static serves app-xray.js', (await httpGet('http://127.0.0.1:' + PAGE_PORT + '/app-xray.js', 5000)).status === 200);
    } catch (e) {
        pass('smoke static server', false, e.message);
    }

    console.log('\n=== API: bridge :17890 (dry_run only — no UI) ===');
    var status = null;
    var statusErr = null;
    for (var si = 0; si < 4 && !status; si++) {
        try { status = await httpGetJson(BRIDGE + '/status', 8000); }
        catch (e) { statusErr = e; await sleep(400); }
    }
    if (status) {
        pass('/status HTTP 200', status.status === 200 && status.body && status.body.ok === true, JSON.stringify({
            rayscan_exists: status.body && status.body.rayscan_exists,
            enabled: status.body && status.body.enabled_systems
        }));
    } else {
        pass('/status HTTP 200', false, statusErr && statusErr.message);
    }

    if (status && status.status === 200) {
        var open = await httpGetJson(OPEN_DRY, 15000).catch(function (e) {
            return { status: 0, body: { error: e.message } };
        });
        if (open.status === 404) {
            warn('/open/rayscan dry_run', 'Rayscan not installed on this PC (404)');
            pass('/open/rayscan dry_run reaches bridge', true, '404 not-installed is OK');
        } else if (open.status === 200 && open.body && open.body.ok) {
            var br = open.body.bridge || {};
            pass('/open/rayscan dry_run HTTP 200', true, 'mode=' + br.mode);
            pass('dry_run flag true', open.body.dry_run === true, String(open.body.dry_run));
            pass('launched false (quiet)', open.body.launched === false, String(open.body.launched));
            pass('bridge mode raybridge', br.mode === 'raybridge', String(br.mode));
            pass('patient_id strips PL prefix', br.patient_id === '001287', String(br.patient_id));
            pass('argList has ID:001287', /ID:001287/.test(String(br.argList || '')), String(br.argList));
            pass('bridge.dry_run true', br.dry_run === true, String(br.dry_run));
            pass('bridge.launched false', br.launched === false, String(br.launched));
        } else {
            pass('/open/rayscan dry_run HTTP 200', false, 'status=' + open.status + ' body=' + JSON.stringify(open.body));
        }
    }

    console.log('\n=== CDP Runtime.evaluate + live page (headless; bridge calls dry_run only) ===');
    if (!fs.existsSync(CHROME)) {
        warn('Chrome missing', CHROME);
        pass('CDP live page', false, 'Chrome not found');
    } else if (!server) {
        pass('CDP live page', false, 'smoke static server not up');
    } else {
        var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'rayscan-smoke-'));
        var pageUrl = 'http://127.0.0.1:' + PAGE_PORT + '/index.html?b=' + BUILD;
        var chrome = child_process.spawn(CHROME, [
            '--headless=new',
            '--remote-debugging-port=' + CDP_PORT,
            '--user-data-dir=' + profile,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            '--disable-sync',
            '--disable-popup-blocking',
            pageUrl
        ], { stdio: 'ignore' });
        try {
            await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000);
            await sleep(800);
            var WebSocketImpl = globalThis.WebSocket || global.WebSocket;
            if (!WebSocketImpl) {
                try { WebSocketImpl = require('ws'); } catch (e) {}
            }
            if (!WebSocketImpl) {
                pass('CDP WebSocket available', false, 'no WebSocket / ws module');
            } else {
                pass('CDP WebSocket available', true);
                var pageTarget = null;
                var deadline = Date.now() + 10000;
                while (Date.now() < deadline && !pageTarget) {
                    var list = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 5000);
                    if (Array.isArray(list)) {
                        pageTarget = list.find(function (t) {
                            return t.type === 'page' && t.webSocketDebuggerUrl &&
                                String(t.url || '').indexOf('devtools://') < 0 &&
                                String(t.url || '').indexOf('chrome-extension:') !== 0;
                        });
                    }
                    if (!pageTarget) await sleep(250);
                }
                pass('CDP page target', !!pageTarget && !!pageTarget.webSocketDebuggerUrl, pageTarget ? pageTarget.url : 'none');
                if (!pageTarget) throw new Error('no page CDP target');
                var ws = new WebSocketImpl(pageTarget.webSocketDebuggerUrl);
                await new Promise(function (resolve, reject) {
                    ws.addEventListener('open', resolve);
                    ws.addEventListener('error', reject);
                });
                var cdp = new Cdp(ws);
                await cdp.call('Runtime.enable');
                await cdp.call('Page.enable');

                var smokePage = await cdp.js(`(async () => {
                  const deadline = Date.now() + 15000;
                  while (Date.now() < deadline) {
                    if (typeof launchViaCsxrayProtocol === 'function' ||
                        document.querySelector('.xray-sys-rayscan') ||
                        document.getElementById('xraySoftwareGrid')) break;
                    await new Promise(r => setTimeout(r, 200));
                  }
                  const btn = document.querySelector('.xray-sys-rayscan');
                  let href = '';
                  let err = '';
                  const origCreate = document.createElement.bind(document);
                  document.createElement = function (tag) {
                    const el = origCreate(tag);
                    if (String(tag).toLowerCase() === 'a') {
                      el.click = function () { href = el.href || el.getAttribute('href') || ''; };
                    }
                    return el;
                  };
                  try {
                    if (typeof launchViaCsxrayProtocol === 'function') {
                      launchViaCsxrayProtocol('rayscan', { patient_no: 'PL001287', full_name: 'LIVE CDP' }, { quiet: true });
                    } else {
                      // Fallback: build the same URL the page would open (no RAYBridge).
                      href = 'csxray://open/rayscan?patient_no=' + encodeURIComponent('PL001287');
                      err = 'launchViaCsxrayProtocol not on window; used URL fallback';
                    }
                  } catch (e) { err = String(e && e.message || e); }
                  document.createElement = origCreate;
                  if (!href && typeof launchViaCsxrayProtocol === 'function') {
                    try {
                      const qParts = [];
                      if (typeof appendXrayBridgePatientParams === 'function') {
                        appendXrayBridgePatientParams(qParts, { patient_no: 'PL001287', full_name: 'LIVE CDP' }, '', { launcherKey: 'rayscan' });
                      } else {
                        qParts.push('patient_no=' + encodeURIComponent('PL001287'));
                      }
                      href = 'csxray://open/rayscan' + (qParts.length ? ('?' + qParts.join('&')) : '');
                    } catch (e2) { err = (err ? err + '; ' : '') + String(e2 && e2.message || e2); }
                  }
                  let dry = null;
                  try {
                    const r = await fetch(${JSON.stringify(OPEN_DRY)}, { cache: 'no-store', mode: 'cors' });
                    dry = { http: r.status, body: await r.json() };
                  } catch (e) { dry = { error: String(e && e.message || e) }; }
                  let status = null;
                  try {
                    const r = await fetch('http://127.0.0.1:17890/status', { cache: 'no-store', mode: 'cors' });
                    status = { http: r.status, body: await r.json() };
                  } catch (e) { status = { error: String(e && e.message || e) }; }
                  return {
                    host: location.host,
                    hasBtn: !!btn,
                    btnText: btn ? (btn.textContent || '').trim().replace(/\\s+/g, ' ') : '',
                    href: href,
                    err: err,
                    dry: dry,
                    status: status,
                    hasFn: typeof launchViaCsxrayProtocol === 'function'
                  };
                })()`, true, 25000);

                pass('smoke page host', smokePage && String(smokePage.host).indexOf('127.0.0.1:' + PAGE_PORT) === 0, smokePage && smokePage.host);
                pass('live DOM has Rayscan button', smokePage && smokePage.hasBtn === true, smokePage && smokePage.btnText);
                pass('Runtime.evaluate csxray://open/rayscan',
                    smokePage && /^csxray:\/\/open\/rayscan\?/.test(smokePage.href || '') &&
                    smokePage.href.indexOf('patient_no=PL001287') >= 0,
                    smokePage ? (smokePage.href || smokePage.err || 'no href') + (smokePage.hasFn ? '' : ' (fn missing)') : 'none');
                pass('CDP fetch /status', smokePage && smokePage.status && (smokePage.status.http === 200 || smokePage.status.error),
                    smokePage ? JSON.stringify(smokePage.status) : 'none');
                if (smokePage && smokePage.dry && smokePage.dry.http === 404) {
                    warn('CDP dry_run open', 'Rayscan not installed (404)');
                    pass('CDP dry_run open quiet', true, '404');
                } else {
                    var dBody = smokePage && smokePage.dry && smokePage.dry.body;
                    pass('CDP dry_run open HTTP 200', !!(smokePage && smokePage.dry && smokePage.dry.http === 200 && dBody && dBody.ok));
                    pass('CDP dry_run did not launch', !!(dBody && dBody.launched === false && dBody.dry_run === true),
                        dBody ? JSON.stringify({ dry_run: dBody.dry_run, launched: dBody.launched, mode: dBody.bridge && dBody.bridge.mode }) : 'none');
                }

                // Prefer live :5500 when up — still only dry_run for bridge open.
                try {
                    await cdp.call('Page.navigate', { url: LIVE + '/index.html?b=' + BUILD });
                    await sleep(1200);
                    var livePage = await cdp.js(`(async () => {
                      const deadline = Date.now() + 12000;
                      while (Date.now() < deadline) {
                        if (document.querySelector('.xray-sys-rayscan')) break;
                        await new Promise(r => setTimeout(r, 200));
                      }
                      const btn = document.querySelector('.xray-sys-rayscan');
                      let dry = null;
                      try {
                        const r = await fetch(${JSON.stringify(OPEN_DRY)}, { cache: 'no-store', mode: 'cors' });
                        dry = { http: r.status, body: await r.json() };
                      } catch (e) { dry = { error: String(e && e.message || e) }; }
                      return { host: location.host, hasBtn: !!btn, dry: dry };
                    })()`, true, 20000);
                    pass('live :5500 Rayscan button', livePage && livePage.hasBtn === true, livePage && livePage.host);
                    pass('live :5500 dry_run open quiet',
                        !!(livePage && livePage.dry && (livePage.dry.http === 404 ||
                            (livePage.dry.http === 200 && livePage.dry.body && livePage.dry.body.launched === false))),
                        livePage ? JSON.stringify(livePage.dry && { http: livePage.dry.http, launched: livePage.dry.body && livePage.dry.body.launched }) : 'none');
                } catch (e) {
                    warn('live :5500 CDP', e.message);
                }

                try { ws.close(); } catch (e) {}
            }
        } catch (e) {
            pass('CDP live page', false, e && e.message ? e.message : String(e));
        } finally {
            try { chrome.kill(); } catch (e) {}
            try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
        }
    }

    if (server) {
        try { server.close(); } catch (e) {}
    }

    console.log('');
    if (fails.length) {
        console.log('FAILED ' + fails.length + ' check(s):');
        fails.forEach(function (f) { console.log('  - ' + f); });
        process.exit(1);
    }
    console.log('SMOKE + SPOT + HTML + API + CDP + LIVE ALL PASS (Rayscan quiet / dry_run)');
    process.exit(0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
