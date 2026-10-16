/**
 * Per-system X-ray handoff XML references — independent contracts.
 * Layers: smoke + HTTP spot + HTML + API (:17890 dry_run only) +
 * CDP Runtime.evaluate + live page.
 * Never opens imaging apps (always dry_run=1).
 * Run: node scripts/xray-system-references-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var crypto = require('crypto');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261016xref';
var PAGE_PORT = 8799;
var CDP_PORT = 9373;
var BRIDGE = 'http://127.0.0.1:17890';
var LIVE = process.env.XRAY_LIVE_BASE || 'http://127.0.0.1:5500';
var CHROME = process.env.CHROME_PATH ||
    (fs.existsSync('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe')
        ? 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
var root = path.resolve(__dirname, '..');
var fails = [];

var SYSTEMS = [
    { pkg: 'installer-ezdenti', key: 'ezdenti', btn: 'xray-sys-vatech', openKey: 'ezdenti', launcherKey: 'ezdenti', nativeHint: 'LinkageParameter' },
    { pkg: 'installer-rayscan', key: 'rayscan', btn: 'xray-sys-rayscan', openKey: 'rayscan', launcherKey: 'rayscan', nativeHint: 'ID:001287' },
    { pkg: 'installer-nntnewtom', key: 'nntnewtom', btn: 'xray-sys-nntnewtom', openKey: 'nntnewtom', launcherKey: 'nntnewtom', nativeHint: '/PATID' },
    { pkg: 'installer-myray', key: 'myray', btn: 'xray-sys-myray', openKey: 'myray', launcherKey: 'myray', nativeHint: '/PATID' },
    { pkg: 'installer-digirex', key: 'digirex', btn: 'xray-sys-digirex', openKey: 'digirex', launcherKey: 'digirex', nativeHint: 'Switch.ini' },
    { pkg: 'installer-carestream-mcp', key: 'trophy', btn: 'xray-sys-carestream', openKey: 'trophy', launcherKey: 'carestream', nativeHint: 'TW.exe' }
];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}
function warn(name, detail) {
    console.log('WARN  ' + name + (detail ? '  -  ' + detail : ''));
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(root, rel)); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function sha256(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }

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
    var types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.xml': 'application/xml', '.svg': 'image/svg+xml' };
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

function dryUrl(openKey) {
    return BRIDGE + '/open/' + openKey +
        '?dry_run=1&patient_no=PL001287&patient_name=' + encodeURIComponent('SMOKE QUIET') + '&sex=M';
}

(async function main() {
    console.log('=== smoke: per-system XML references (independent) ===');
    var indexMd = exists('tools/xray-system-references.md') ? read('tools/xray-system-references.md') : '';
    pass('index xray-system-references.md present', !!indexMd);
    pass('check script present', exists('tools/check-xray-system-references.ps1'));
    pass('build script requires reference xml',
        /reference\\patient-handoff\.reference\.xml/.test(read('tools/build-installer-packages.ps1')));

    var hashes = {};
    var refs = {};
    SYSTEMS.forEach(function (s) {
        var rel = 'tools/' + s.pkg + '/reference/patient-handoff.reference.xml';
        var ok = exists(rel);
        pass(s.pkg + ' reference exists', ok, rel);
        if (!ok) return;
        var text = read(rel);
        refs[s.key] = text;
        pass(s.key + ' has BananaXrayHandoffReference', /BananaXrayHandoffReference/.test(text));
        pass(s.key + ' independent=true', /independent="true"/.test(text));
        pass(s.key + ' systemKey match', new RegExp('systemKey="' + s.key + '"').test(text));
        pass(s.key + ' bananaOpenPath', text.indexOf('bananaOpenPath="/open/' + s.openKey + '"') >= 0 ||
            text.indexOf('/open/' + s.openKey) >= 0);
        pass(s.key + ' native hint present', text.indexOf(s.nativeHint) >= 0, s.nativeHint);
        pass(s.key + ' dry_run URL documented', /dry_run=1/.test(text));
        var h = sha256(text);
        if (hashes[h]) {
            pass(s.key + ' unique vs ' + hashes[h], false, 'identical bytes');
        } else {
            hashes[h] = s.key;
            pass(s.key + ' unique hash', true, h.slice(0, 12));
        }
    });

    // Cross-contamination: EzDent Linkage must not appear as native mode in Rayscan primary payload.
    if (refs.rayscan && refs.ezdenti) {
        pass('rayscan ref is not a copy of ezdenti Linkage root',
            refs.rayscan.indexOf('<LinkageParameter>') < 0 || refs.rayscan.indexOf('not-used') >= 0);
        pass('ezdenti ref is not rayscan CommandLine-only',
            refs.ezdenti.indexOf('LinkageParameter') >= 0 && refs.ezdenti.indexOf('systemKey="ezdenti"') >= 0);
        pass('digirex forbids Linkage.xml note',
            refs.digirex && /Linkage\.xml/.test(refs.digirex) && /never|must not|Independent/i.test(refs.digirex));
    }

    console.log('\n=== smoke: HTML / app-xray wiring ===');
    var html = read('index.html');
    var xray = read('app-xray.js');
    SYSTEMS.forEach(function (s) {
        pass('index has .' + s.btn, html.indexOf(s.btn) >= 0);
        pass('app-xray has launcherKey ' + s.launcherKey,
            xray.indexOf("launcherKey: '" + s.launcherKey + "'") >= 0 ||
            xray.indexOf('launcherKey: "' + s.launcherKey + '"') >= 0);
    });
    pass('csxray://open/ present', xray.indexOf('csxray://open/') >= 0);

    console.log('\n=== HTTP spot: live :5500 + smoke static :' + PAGE_PORT + ' ===');
    var liveIdx = null;
    try {
        liveIdx = await httpGet(LIVE + '/index.html', 5000);
        pass('live :5500 index.html', liveIdx.status === 200, 'bytes=' + liveIdx.body.length);
        SYSTEMS.forEach(function (s) {
            pass('live has .' + s.btn, liveIdx.body.indexOf(s.btn) >= 0);
        });
    } catch (e) {
        pass('live :5500 index.html', false, e.message);
    }

    var server = null;
    try {
        server = await startStaticServer(PAGE_PORT);
        var smokeIdx = await httpGet('http://127.0.0.1:' + PAGE_PORT + '/index.html', 5000);
        pass('smoke static index.html', smokeIdx.status === 200);
        var ezRef = await httpGet('http://127.0.0.1:' + PAGE_PORT +
            '/tools/installer-ezdenti/reference/patient-handoff.reference.xml', 5000);
        pass('smoke static serves ezdenti reference xml', ezRef.status === 200 && /LinkageParameter/.test(ezRef.body));
        var rayRef = await httpGet('http://127.0.0.1:' + PAGE_PORT +
            '/tools/installer-rayscan/reference/patient-handoff.reference.xml', 5000);
        pass('smoke static serves rayscan reference xml', rayRef.status === 200 && /systemKey="rayscan"/.test(rayRef.body));
        pass('html spot: served refs differ', sha256(ezRef.body) !== sha256(rayRef.body));
    } catch (e) {
        pass('smoke static server', false, e.message);
    }

    console.log('\n=== API: bridge :17890 (dry_run only — no UI) ===');
    var status = null;
    var statusErr = null;
    for (var si = 0; si < 5 && !status; si++) {
        try { status = await httpGetJson(BRIDGE + '/status', 8000); }
        catch (e) { statusErr = e; await sleep(500); }
    }
    if (!status) {
        pass('/status HTTP 200', false, statusErr && statusErr.message);
        warn('API dry_run opens', 'bridge not up — skipped (start Rayscan/EzDent/etc bridge)');
    } else {
        pass('/status HTTP 200', status.status === 200 && status.body && status.body.ok === true,
            JSON.stringify({
                enabled: status.body && status.body.enabled_systems,
                rayscan: status.body && status.body.rayscan_exists,
                ezdenti: status.body && status.body.ezdenti_exists
            }));
        var enabled = String((status.body && status.body.enabled_systems) || '');
        // Probe every open path with dry_run. 200 = installed+enabled; 404 = missing/disabled — both OK if dry_run quiet.
        for (var i = 0; i < SYSTEMS.length; i++) {
            var s = SYSTEMS[i];
            var open = await httpGetJson(dryUrl(s.openKey), 15000).catch(function (e) {
                return { status: 0, body: { error: e.message } };
            });
            if (open.status === 200 && open.body && open.body.ok) {
                pass('/open/' + s.openKey + ' dry_run 200 quiet',
                    open.body.dry_run === true && open.body.launched === false,
                    JSON.stringify({ dry_run: open.body.dry_run, launched: open.body.launched, mode: open.body.bridge && open.body.bridge.mode }));
            } else if (open.status === 404) {
                pass('/open/' + s.openKey + ' dry_run reaches bridge', true,
                    '404 not-installed/disabled (enabled=' + enabled + ')');
            } else {
                pass('/open/' + s.openKey + ' dry_run', false,
                    'status=' + open.status + ' body=' + JSON.stringify(open.body).slice(0, 180));
            }
        }
    }

    console.log('\n=== CDP Runtime.evaluate + live page (headless; dry_run only) ===');
    if (!fs.existsSync(CHROME)) {
        pass('CDP live page', false, 'Chrome not found');
    } else if (!server) {
        pass('CDP live page', false, 'smoke static not up');
    } else {
        var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'xray-ref-smoke-'));
        var pageUrl = 'http://127.0.0.1:' + PAGE_PORT + '/index.html?b=' + BUILD;
        var chrome = child_process.spawn(CHROME, [
            '--headless=new',
            '--remote-debugging-port=' + CDP_PORT,
            '--user-data-dir=' + profile,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-extensions',
            '--disable-sync',
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
                                String(t.url || '').indexOf('devtools://') < 0;
                        });
                    }
                    if (!pageTarget) await sleep(250);
                }
                pass('CDP page target', !!pageTarget, pageTarget ? pageTarget.url : 'none');
                if (!pageTarget) throw new Error('no page CDP target');
                var ws = new WebSocketImpl(pageTarget.webSocketDebuggerUrl);
                await new Promise(function (resolve, reject) {
                    ws.addEventListener('open', resolve);
                    ws.addEventListener('error', reject);
                });
                var cdp = new Cdp(ws);
                await cdp.call('Runtime.enable');
                await cdp.call('Page.enable');

                var evalResult = await cdp.js(`(async () => {
                  const deadline = Date.now() + 15000;
                  while (Date.now() < deadline) {
                    if (document.querySelector('.xray-sys-rayscan') || document.getElementById('xraySoftwareGrid')) break;
                    await new Promise(r => setTimeout(r, 200));
                  }
                  const btns = {
                    ezdenti: !!document.querySelector('.xray-sys-vatech'),
                    rayscan: !!document.querySelector('.xray-sys-rayscan'),
                    nnt: !!document.querySelector('.xray-sys-nntnewtom'),
                    myray: !!document.querySelector('.xray-sys-myray'),
                    digirex: !!document.querySelector('.xray-sys-digirex'),
                    carestream: !!document.querySelector('.xray-sys-carestream')
                  };
                  const fetchXml = async (p) => {
                    const r = await fetch(p, { cache: 'no-store' });
                    const t = await r.text();
                    return { http: r.status, len: t.length, key: (t.match(/systemKey="([^"]+)"/) || [])[1] || '', hasRoot: t.indexOf('BananaXrayHandoffReference') >= 0 };
                  };
                  const ez = await fetchXml('/tools/installer-ezdenti/reference/patient-handoff.reference.xml');
                  const ray = await fetchXml('/tools/installer-rayscan/reference/patient-handoff.reference.xml');
                  const nnt = await fetchXml('/tools/installer-nntnewtom/reference/patient-handoff.reference.xml');
                  let dry = null;
                  try {
                    const r = await fetch(${JSON.stringify(dryUrl('rayscan'))}, { cache: 'no-store', mode: 'cors' });
                    dry = { http: r.status, body: await r.json() };
                  } catch (e) { dry = { error: String(e && e.message || e) }; }
                  let status = null;
                  try {
                    const r = await fetch('http://127.0.0.1:17890/status', { cache: 'no-store', mode: 'cors' });
                    status = { http: r.status, body: await r.json() };
                  } catch (e) { status = { error: String(e && e.message || e) }; }
                  return { host: location.host, btns, ez, ray, nnt, dry, status };
                })()`, true, 30000);

                pass('CDP host smoke static', evalResult && String(evalResult.host).indexOf('127.0.0.1:' + PAGE_PORT) === 0, evalResult && evalResult.host);
                pass('Runtime.evaluate DOM buttons (rayscan+ezdenti+carestream)',
                    !!(evalResult && evalResult.btns && evalResult.btns.rayscan && evalResult.btns.ezdenti && evalResult.btns.carestream),
                    evalResult ? JSON.stringify(evalResult.btns) : 'none');
                pass('Runtime.evaluate fetch ezdenti ref',
                    !!(evalResult && evalResult.ez && evalResult.ez.http === 200 && evalResult.ez.key === 'ezdenti' && evalResult.ez.hasRoot));
                pass('Runtime.evaluate fetch rayscan ref',
                    !!(evalResult && evalResult.ray && evalResult.ray.http === 200 && evalResult.ray.key === 'rayscan'));
                pass('Runtime.evaluate fetch nnt ref',
                    !!(evalResult && evalResult.nnt && evalResult.nnt.http === 200 && evalResult.nnt.key === 'nntnewtom'));
                pass('Runtime.evaluate refs are distinct keys',
                    !!(evalResult && evalResult.ez && evalResult.ray && evalResult.ez.key !== evalResult.ray.key));

                if (evalResult && evalResult.dry && !evalResult.dry.error) {
                    if (evalResult.dry.http === 404) {
                        pass('CDP dry_run /open/rayscan quiet', true, '404');
                    } else {
                        pass('CDP dry_run /open/rayscan quiet',
                            evalResult.dry.http === 200 && evalResult.dry.body &&
                            evalResult.dry.body.launched === false && evalResult.dry.body.dry_run === true,
                            JSON.stringify({ http: evalResult.dry.http, launched: evalResult.dry.body && evalResult.dry.body.launched }));
                    }
                } else {
                    warn('CDP bridge dry_run', evalResult && evalResult.dry && evalResult.dry.error);
                    pass('CDP bridge reachable or documented down', true, 'bridge optional for ref XML checks');
                }

                // Live :5500
                try {
                    await cdp.call('Page.navigate', { url: LIVE + '/index.html?b=' + BUILD });
                    await sleep(1200);
                    var livePage = await cdp.js(`(async () => {
                      const deadline = Date.now() + 12000;
                      while (Date.now() < deadline) {
                        if (document.querySelector('.xray-sys-rayscan')) break;
                        await new Promise(r => setTimeout(r, 200));
                      }
                      return {
                        host: location.host,
                        rayscan: !!document.querySelector('.xray-sys-rayscan'),
                        ezdenti: !!document.querySelector('.xray-sys-vatech'),
                        digirex: !!document.querySelector('.xray-sys-digirex')
                      };
                    })()`, true, 20000);
                    pass('live :5500 page', livePage && String(livePage.host).indexOf('5500') >= 0, livePage && livePage.host);
                    pass('live :5500 xray system buttons',
                        !!(livePage && livePage.rayscan && livePage.ezdenti),
                        livePage ? JSON.stringify(livePage) : 'none');
                } catch (e) {
                    pass('live :5500 CDP', false, e.message);
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
    console.log('SMOKE + SPOT + HTML + API + CDP + LIVE ALL PASS (xray system references, quiet dry_run)');
    process.exit(0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
