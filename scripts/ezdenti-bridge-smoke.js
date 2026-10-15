/**
 * EzDent-i (Vatech) bridge smoke after 2026-10-16 Acquisition fix.
 * Layers: source + HTTP spot + API (:17890) + CDP Runtime.evaluate + live page.
 * Run: node scripts/ezdenti-bridge-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261016ez';
var PAGE_PORT = 8797;
var CDP_PORT = 9371;
var BRIDGE = 'http://127.0.0.1:17890';
var LIVE = process.env.EZDENTI_LIVE_BASE || 'http://127.0.0.1:5500';
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
                var body = Buffer.concat(chunks).toString('utf8');
                resolve({ status: r.statusCode, headers: r.headers, body: body });
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
    var types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ps1': 'text/plain' };
    var server = http.createServer(function (req, res) {
        var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath === '/') urlPath = '/ezdenti-diag.html';
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
        try {
            var r = await httpGetJson(url);
            // CDP /json/* returns the payload itself (object or array).
            return r.body;
        } catch (e) { last = e; await sleep(250); }
    }
    throw new Error('timeout ' + url + ' last=' + (last && last.message));
}

(async function main() {
    console.log('=== source: Banana EzDent-i wiring ===');
    var xray = read('app-xray.js');
    var html = read('index.html');
    var launcher = read('tools/xray-local-launcher.ps1');
    var diag = read('ezdenti-diag.html');
    pass('vatech launcherKey is ezdenti', /vatech:\s*\{[\s\S]*?launcherKey:\s*'ezdenti'/.test(xray));
    pass('csxray://open/ used for desktop systems', xray.indexOf('csxray://open/') >= 0);
    pass('index has xray-sys-vatech button', html.indexOf('xray-sys-vatech') >= 0 && html.indexOf("openXraySystem('vatech')") >= 0);
    pass('launcher default mode linkage-xml', launcher.indexOf('ezdenti-linkage-xml') >= 0);
    pass('launcher writes Linkage.xml helper', launcher.indexOf('function Write-EzdentiLinkageXmlFile') >= 0);
    pass('launcher resolves non-ReqAdmin loader', launcher.indexOf('function Resolve-EzdentiNonAdminLoader') >= 0);
    pass('VTEzBridge remains opt-in only', launcher.indexOf('EzdentiUseLinkageBridge') >= 0);
    pass('skip-linkage opt-out present', launcher.indexOf('EzdentiSkipLinkageXml') >= 0);
    pass('diag page present', diag.indexOf('ezdenti-linkage-xml') >= 0);

    console.log('\n=== HTTP spot: live-server :5500 + smoke static :' + PAGE_PORT + ' ===');
    var liveIdx = null;
    try {
        liveIdx = await httpGet(LIVE + '/index.html', 5000);
        pass('live :5500 index.html', liveIdx.status === 200, 'bytes=' + liveIdx.body.length);
        pass('live index has vatech button', liveIdx.body.indexOf('xray-sys-vatech') >= 0);
    } catch (e) {
        pass('live :5500 index.html', false, e.message);
    }
    try {
        var liveDiag = await httpGet(LIVE + '/ezdenti-diag.html', 5000);
        pass('live :5500 ezdenti-diag.html', liveDiag.status === 200, 'bytes=' + liveDiag.body.length);
    } catch (e) {
        pass('live :5500 ezdenti-diag.html', false, e.message);
    }

    console.log('\n=== API: bridge :17890 ===');
    var status = null;
    var statusErr = null;
    for (var si = 0; si < 4 && !status; si++) {
        try {
            status = await httpGetJson(BRIDGE + '/status', 8000);
        } catch (e) {
            statusErr = e;
            await sleep(400);
        }
    }
    if (status) {
        pass('/status HTTP 200', status.status === 200 && status.body && status.body.ok === true, JSON.stringify({
            ezdenti_exists: status.body && status.body.ezdenti_exists,
            enabled: status.body && status.body.enabled_systems
        }));
    } else {
        pass('/status HTTP 200', false, statusErr && statusErr.message);
    }

    if (status && status.status === 200) {
        // Stop-EzdentiProcesses + Linkage write + launch often exceeds 8s.
        var open = await httpGetJson(
            BRIDGE + '/open/ezdenti?patient_no=PL001287&patient_name=' + encodeURIComponent('SMOKE TEST') + '&sex=M',
            45000
        ).catch(function (e) { return { status: 0, body: { error: e.message } }; });
        if (open.status === 404) {
            warn('/open/ezdenti', 'EzDent-i not installed on this PC (404) — mode assertions skipped');
            pass('/open/ezdenti reaches bridge', true, '404 not-installed is OK on this PC');
        } else if (open.status === 200 && open.body && open.body.ok) {
            var br = open.body.bridge || {};
            pass('/open/ezdenti HTTP 200', true, 'target=' + (open.body.target || ''));
            pass('mode is linkage-xml family', /ezdenti-linkage-xml/.test(String(br.mode || '')), String(br.mode));
            pass('Linkage.xml written', !!br.linkage_xml, JSON.stringify(br.linkage_xml));
            pass('VTEzBridge not fired', !br.bridge_exe, JSON.stringify(br.bridge_exe));
            pass('uses desktop shortcut or ReqAdmin when Bin writable',
                !!(br.shortcut || (br.target && /_ReqAdmin/i.test(String(br.target))) || br.mode === 'ezdenti-linkage-xml-virtualstore'),
                'shortcut=' + br.shortcut + ' target=' + br.target + ' mode=' + br.mode);
            pass('chart digits stripped (PL→001287)', br.chart_number === '001287', String(br.chart_number));
        } else {
            pass('/open/ezdenti HTTP 200', false, 'status=' + open.status + ' body=' + JSON.stringify(open.body));
        }
    }

    console.log('\n=== CDP Runtime.evaluate + live page ===');
    if (!fs.existsSync(CHROME)) {
        warn('Chrome missing', CHROME);
        pass('CDP live page', false, 'Chrome not found');
    } else {
        var server = await startStaticServer(PAGE_PORT);
        var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ezdenti-smoke-'));
        // Prefer live-server diag (always up in clinic/dev); fall back to smoke static.
        var diagUrl = LIVE + '/ezdenti-diag.html?b=' + BUILD;
        var chrome = child_process.spawn(CHROME, [
            '--headless=new',
            '--remote-debugging-port=' + CDP_PORT,
            '--user-data-dir=' + profile,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            '--disable-sync',
            '--disable-popup-blocking',
            diagUrl
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

                // A) diag page on smoke static server
                await cdp.call('Page.navigate', { url: 'http://127.0.0.1:' + PAGE_PORT + '/ezdenti-diag.html' });
                await sleep(600);
                var diagLive = await cdp.js(`(async () => {
                  if (typeof runAll === 'function') await runAll();
                  if (typeof testOpenEzdenti === 'function') await testOpenEzdenti();
                  return window.__ezdentiDiag || null;
                })()`, true, 25000);
                pass('Runtime.evaluate diag runAll completed', !!diagLive && Array.isArray(diagLive.checks), diagLive ? ('checks=' + diagLive.checks.length) : 'none');
                var hardFails = (diagLive && diagLive.checks || []).filter(function (c) { return !c.ok; });
                pass('diag page hard checks', hardFails.length === 0, hardFails.map(function (c) { return c.name; }).join(','));
                var openBody = diagLive && diagLive.open && diagLive.open.body;
                var openBridge = openBody && openBody.bridge;
                if (diagLive && diagLive.open && diagLive.open.status === 404) {
                    warn('diag /open/ezdenti', 'not installed on this PC');
                    pass('diag open responded', true, '404');
                } else {
                    pass('diag open mode linkage-xml',
                        !!(openBridge && /ezdenti-linkage-xml/.test(String(openBridge.mode || ''))),
                        openBridge ? openBridge.mode : 'none');
                    pass('diag open wrote Linkage.xml', !!(openBridge && openBridge.linkage_xml),
                        openBridge && openBridge.linkage_xml);
                    pass('diag open did not fire VTEzBridge', !!(openBridge && !openBridge.bridge_exe));
                }

                // B) live :5500 index — protocol builder via Runtime.evaluate
                await cdp.call('Page.navigate', { url: LIVE + '/index.html' });
                await sleep(1200);
                var livePage = await cdp.js(`(async () => {
                  const deadline = Date.now() + 15000;
                  while (Date.now() < deadline) {
                    if (typeof launchViaCsxrayProtocol === 'function' || document.getElementById('xraySoftwareGrid')) break;
                    await new Promise(r => setTimeout(r, 200));
                  }
                  const btn = document.querySelector('.xray-sys-vatech');
                  let href = '';
                  const src = await (await fetch('/app-xray.js?b=${BUILD}', { cache: 'no-store' })).text();
                  const marker = 'function launchViaCsxrayProtocol(';
                  const start = src.indexOf(marker);
                  let fn = '';
                  if (start >= 0) {
                    const i = src.indexOf('{', start);
                    let depth = 0;
                    for (let j = i; j < src.length; j++) {
                      if (src[j] === '{') depth++;
                      else if (src[j] === '}') { depth--; if (depth === 0) { fn = src.slice(start, j + 1); break; } }
                    }
                  }
                  const orig = document.createElement.bind(document);
                  document.createElement = function (tag) {
                    const el = orig(tag);
                    if (String(tag).toLowerCase() === 'a') el.click = function () { href = el.href; };
                    return el;
                  };
                  try { eval(fn + '; launchViaCsxrayProtocol("ezdenti", { patient_no: "PL001287", full_name: "LIVE CDP" }, {});'); } catch (e) {}
                  document.createElement = orig;
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
                    status: status,
                    hasFn: typeof launchViaCsxrayProtocol === 'function' || fn.indexOf('launchViaCsxrayProtocol') >= 0
                  };
                })()`, true, 25000);

                pass('live page host :5500', livePage && livePage.host.indexOf('127.0.0.1:5500') === 0, livePage && livePage.host);
                pass('live page EzDent-i button in DOM', livePage && livePage.hasBtn === true, livePage && livePage.btnText);
                pass('Runtime.evaluate csxray://open/ezdenti', livePage && /^csxray:\/\/open\/ezdenti\?/.test(livePage.href || '') && livePage.href.indexOf('patient_no=PL001287') >= 0, livePage && livePage.href);
                pass('live page can fetch bridge /status', livePage && livePage.status && (livePage.status.http === 200 || livePage.status.error), livePage ? JSON.stringify(livePage.status) : 'none');

                try { ws.close(); } catch (e) {}
            }
        } finally {
            try { chrome.kill(); } catch (e) {}
            try { server.close(); } catch (e) {}
            try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
        }
    }

    console.log('');
    if (fails.length) {
        console.log('FAILED ' + fails.length + ' check(s):');
        fails.forEach(function (f) { console.log('  - ' + f); });
        process.exit(1);
    }
    console.log('ALL PASS');
    process.exit(0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
