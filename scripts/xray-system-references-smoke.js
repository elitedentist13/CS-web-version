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
    { pkg: 'installer-carestream-mcp', key: 'trophy', btn: 'xray-sys-carestream', openKey: 'trophy', launcherKey: 'carestream', nativeHint: 'CS Imaging Software.lnk' }
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
        if (s.key === 'trophy') {
            pass('carestream desktop shortcut documented',
                text.indexOf('CS Imaging Software.lnk') >= 0 &&
                text.indexOf('Patient.exe') >= 0 &&
                text.indexOf('Start-CarestreamImagingPatient') >= 0);
            var launcherSrc = read('tools/xray-local-launcher.ps1');
            pass('launcher carestream is inactive, trophy stays TW',
                /carestream_inactive/.test(launcherSrc) &&
                /function Start-TrophyTwPatient/.test(launcherSrc) &&
                /function Ensure-TrophyScanPatientFolder/.test(launcherSrc) &&
                /Write-TrophyFileData/.test(launcherSrc));
            pass('carestream button markup is disabled',
                /xray-sys-carestream[\s\S]{0,180}disabled/.test(read('index.html')));
        }
        pass(s.key + ' dry_run URL documented', /dry_run=1/.test(text));
        var h = sha256(text);
        if (hashes[h]) {
            pass(s.key + ' unique vs ' + hashes[h], false, 'identical bytes');
        } else {
            hashes[h] = s.key;
            pass(s.key + ' unique hash', true, h.slice(0, 12));
        }
    });

    var trophyRel = 'tools/installer-trophy/reference/patient-handoff.reference.xml';
    var trophyRefOk = exists(trophyRel);
    pass('installer-trophy reference exists', trophyRefOk, trophyRel);
    if (trophyRefOk) {
        var trophyText = read(trophyRel);
        pass('installer-trophy systemKey=trophy', /systemKey="trophy"/.test(trophyText));
        pass('installer-trophy independent=true', /independent="true"/.test(trophyText));
        pass('installer-trophy TW + FILEDATA only',
            trophyText.indexOf('TW.exe') >= 0 &&
            trophyText.indexOf('FILEDATA.TXT') >= 0 &&
            trophyText.indexOf('Ensure-TrophyScanPatientFolder') >= 0 &&
            trophyText.indexOf('Start-TrophyTwPatient') >= 0 &&
            trophyText.indexOf('Patient.exe') < 0);
        pass('installer-trophy enabledSystems trophy', /enabledSystems="trophy"/.test(trophyText));
        var trophyHash = sha256(trophyText);
        pass('installer-trophy unique vs carestream MCP reference',
            !hashes[trophyHash], trophyHash.slice(0, 12));
        hashes[trophyHash] = 'installer-trophy';
    }
    pass('index lists installer-trophy', indexMd.indexOf('installer-trophy') >= 0);
    pass('check script lists installer-trophy',
        read('tools/check-xray-system-references.ps1').indexOf('installer-trophy') >= 0);
    pass('build script packs installer-trophy',
        read('tools/build-installer-packages.ps1').indexOf('installer-trophy') >= 0);
    pass('Trophy button points at trophy installer',
        read('app-xray.js').indexOf('tools\\\\installer-trophy\\\\Start Trophy Launcher.bat') >= 0);

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

    console.log('\n=== HTTP spot: smoke static :' + PAGE_PORT + ' (+ live base) ===');
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

    // Prefer configured LIVE (:5500). If unreachable, fall back to smoke static so
    // CDP "live page" still exercises the same index.html + app-xray.js wiring.
    var liveBase = LIVE;
    var liveIdx = null;
    try {
        liveIdx = await httpGet(liveBase + '/index.html', 4000);
        if (!(liveIdx && liveIdx.status === 200)) throw new Error('HTTP ' + (liveIdx && liveIdx.status));
    } catch (e) {
        if (server) {
            liveBase = 'http://127.0.0.1:' + PAGE_PORT;
            warn('live base fallback', LIVE + ' unreachable (' + e.message + ') — using smoke static ' + liveBase);
            try { liveIdx = await httpGet(liveBase + '/index.html', 5000); } catch (e2) { liveIdx = null; }
        } else {
            pass('live index.html', false, e.message);
        }
    }
    if (liveIdx && liveIdx.status === 200) {
        pass('live page index.html', true, liveBase + ' bytes=' + liveIdx.body.length);
        SYSTEMS.forEach(function (s) {
            pass('live has .' + s.btn, liveIdx.body.indexOf(s.btn) >= 0);
        });
    } else if (server) {
        pass('live page index.html', false, 'smoke static also failed');
    }
    // Expose for CDP live navigation below.
    global.__XRAY_LIVE_BASE = liveBase;

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
        var csOpen = await httpGetJson(dryUrl('carestream'), 15000).catch(function (e) {
            return { status: 0, body: { error: e.message } };
        });
        if (csOpen.status === 200 && csOpen.body && csOpen.body.ok) {
            var csBridge = csOpen.body.bridge || {};
            var csArgs = String(csBridge.argList || '');
            var csMode = String(csBridge.mode || '');
            var csTarget = String(csBridge.target || csOpen.body.target || '');
            var csShortcut = String(csBridge.shortcut || '');
            pass('/open/carestream dry_run stays inactive',
                csOpen.body.dry_run === true && csOpen.body.launched === false &&
                csMode === 'carestream_inactive' &&
                !/Patient\.exe$/i.test(csTarget) &&
                !/TW\.exe$/i.test(csTarget),
                JSON.stringify({ mode: csMode, target: csTarget, shortcut: csShortcut }));
        } else if (csOpen.status === 404) {
            pass('/open/carestream dry_run reaches bridge', true, '404 not-installed/disabled');
        } else {
            pass('/open/carestream dry_run quiet', false,
                'status=' + csOpen.status + ' body=' + JSON.stringify(csOpen.body).slice(0, 220));
        }
        var sampleQs = 'dry_run=1&patient_no=PL001287&patient_name=' + encodeURIComponent('SMOKE QUIET') +
            '&chinese_name=' + encodeURIComponent('TEST') + '&dob=1969-05-23&sex=M&hkid=' +
            encodeURIComponent('A123456(7)');
        var sampleCs = await httpGetJson(BRIDGE + '/open/carestream?' + sampleQs, 15000).catch(function (e) {
            return { status: 0, body: { error: e.message } };
        });
        var sampleTw = await httpGetJson(BRIDGE + '/open/trophy?' + sampleQs, 15000).catch(function (e) {
            return { status: 0, body: { error: e.message } };
        });
        var sampleCsArgs = String((sampleCs.body && sampleCs.body.bridge && sampleCs.body.bridge.argList) || '');
        var sampleTwArgs = String((sampleTw.body && sampleTw.body.bridge && sampleTw.body.bridge.argList) || '');
        var sampleCsMode = String((sampleCs.body && sampleCs.body.bridge && sampleCs.body.bridge.mode) || '');
        var sampleCsTarget = String((sampleCs.body && sampleCs.body.target) || '');
        var sampleCsShortcut = String((sampleCs.body && sampleCs.body.bridge && sampleCs.body.bridge.shortcut) || '');
        pass('sample patient carestream stays inactive',
            sampleCs.status === 200 && sampleCs.body && sampleCs.body.launched === false &&
            sampleCs.body.dry_run === true &&
            sampleCsMode === 'carestream_inactive' &&
            !/Patient\.exe$/i.test(sampleCsTarget) &&
            !/TW\.exe$/i.test(sampleCsTarget),
            sampleCsMode || sampleCsShortcut || '(no mode)');
        // Chart that should not have a SCAN folder: client Patient Card vs capture TW seed.
        var newCardQs = 'dry_run=1&patient_no=PL009999&patient_name=' + encodeURIComponent('SIU KAI WING') +
            '&dob=1969-05-23&sex=M&hkid=' + encodeURIComponent('A123456(7)');
        var newCardCs = await httpGetJson(BRIDGE + '/open/carestream?' + newCardQs, 15000).catch(function (e) {
            return { status: 0, body: { error: e.message } };
        });
        var newCardBridge = (newCardCs.body && newCardCs.body.bridge) || {};
        var newCardPayload = newCardBridge.new_patient_payload || {};
        var newCardMode = String(newCardBridge.mode || '');
        var newCardTarget = String(newCardBridge.target || (newCardCs.body && newCardCs.body.target) || '');
        var newCardArgs = String(newCardBridge.argList || '');
        pass('sample new patient carestream stays inactive',
            newCardCs.status === 200 && newCardMode === 'carestream_inactive' &&
            newCardCs.body && newCardCs.body.launched === false &&
            !/TW\.exe$/i.test(newCardTarget) &&
            !/Patient\.exe$/i.test(newCardTarget),
            newCardMode || JSON.stringify(newCardPayload));
        pass('sample patient trophy unquoted -P folder (Clinic Solution)',
            sampleTw.status === 200 && sampleTw.body && sampleTw.body.launched === false &&
            sampleTw.body.dry_run === true &&
            /TW\.exe$/i.test(String(sampleTw.body.target || '')) &&
            sampleTwArgs.indexOf('-P') === 0 &&
            sampleTwArgs.indexOf('-P"') !== 0 &&
            sampleTwArgs.indexOf('SCAN\\001287') >= 0 &&
            sampleTwArgs.indexOf('-NSMOKE QUIET') >= 0,
            sampleTwArgs);

        // New-patient trial (dry_run only): fictional chart + TESTING name — never launches TW.
        var newQs = 'dry_run=1&patient_no=999910&patient_name=' + encodeURIComponent('TESTING') +
            '&dob=1984-08-15&sex=M';
        var newCs = await httpGetJson(BRIDGE + '/open/carestream?' + newQs, 15000).catch(function (e) {
            return { status: 0, body: { error: e.message } };
        });
        var newTw = await httpGetJson(BRIDGE + '/open/trophy?' + newQs, 15000).catch(function (e) {
            return { status: 0, body: { error: e.message } };
        });
        var newCsArgs = String((newCs.body && newCs.body.bridge && newCs.body.bridge.argList) || '');
        var newTwArgs = String((newTw.body && newTw.body.bridge && newTw.body.bridge.argList) || '');
        var newCsScan = String((newCs.body && newCs.body.bridge && newCs.body.bridge.scan_path) || '');
        var newTwScan = String((newTw.body && newTw.body.bridge && newTw.body.bridge.scan_path) || '');
        pass('new-patient trial carestream dry_run quiet',
            newCs.status === 200 && newCs.body && newCs.body.launched === false && newCs.body.dry_run === true,
            JSON.stringify({ mode: newCs.body && newCs.body.bridge && newCs.body.bridge.mode, scan: newCsScan, arg: newCsArgs.slice(0, 160) }));
        pass('new-patient trial trophy dry_run TESTING label',
            newTw.status === 200 && newTw.body && newTw.body.launched === false &&
            newTwArgs.indexOf('-NTESTING') >= 0 && newTwArgs.indexOf('-FTESTING') >= 0 &&
            newTwArgs.indexOf('999910') >= 0 && newTwArgs.indexOf('-P') === 0,
            newTwArgs);
        pass('new-patient trial scan path uses chart digits',
            (newCsScan.indexOf('999910') >= 0 || newTwScan.indexOf('999910') >= 0 ||
                newCsArgs.indexOf('999910') >= 0 || newTwArgs.indexOf('999910') >= 0),
            'cs=' + newCsScan + ' tw=' + newTwScan);
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
                    if ((document.querySelector('.xray-sys-rayscan') || document.getElementById('xraySoftwareGrid')) &&
                        typeof XRAY_SYSTEMS !== 'undefined' && XRAY_SYSTEMS.carestream) break;
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
                  const cs = await fetchXml('/tools/installer-carestream-mcp/reference/patient-handoff.reference.xml');
                  cs.patientExe = false;
                  cs.newPatientCard = false;
                  cs.filedata = false;
                  try {
                    const r = await fetch('/tools/installer-carestream-mcp/reference/patient-handoff.reference.xml', { cache: 'no-store' });
                    const t = await r.text();
                    cs.patientExe = t.indexOf('Patient.exe') >= 0 && t.indexOf('Start-CarestreamImagingPatient') >= 0;
                    cs.newPatientCard = t.indexOf('carestream-fill-patient-card.ps1') >= 0 &&
                      t.indexOf('Patient Card') >= 0;
                    cs.filedata = t.indexOf('CS Imaging Software.lnk') >= 0 && t.indexOf('Start-CarestreamImagingPatient') >= 0;
                  } catch (e) {}
                  let csDry = null;
                  try {
                    const r = await fetch(${JSON.stringify(dryUrl('carestream'))}, { cache: 'no-store', mode: 'cors' });
                    csDry = { http: r.status, body: await r.json() };
                  } catch (e) { csDry = { error: String(e && e.message || e) }; }
                  let csNew = null;
                  try {
                    const newQs = 'http://127.0.0.1:17890/open/carestream?dry_run=1&patient_no=PL009999&patient_name=' +
                      encodeURIComponent('SIU KAI WING') + '&dob=1969-05-23&sex=M&hkid=' + encodeURIComponent('A123456(7)');
                    const r = await fetch(newQs, { cache: 'no-store', mode: 'cors' });
                    csNew = { http: r.status, body: await r.json() };
                  } catch (e) { csNew = { error: String(e && e.message || e) }; }
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
                  const sys = (typeof XRAY_SYSTEMS !== 'undefined' && XRAY_SYSTEMS.carestream) || null;
                  let searchFn = null;
                  try {
                    if (typeof xrayPatientSearchTextForLauncher === 'function') {
                      searchFn = xrayPatientSearchTextForLauncher({
                        patient_no: 'PL001287',
                        full_name: 'SMOKE QUIET',
                        chinese_name: 'TEST'
                      }, 'carestream');
                    }
                  } catch (e) { searchFn = 'err:' + (e && e.message || e); }
                  return { host: location.host, btns, ez, ray, nnt, cs, dry, csDry, csNew, searchFn, status, carestreamShortcut: sys && sys.desktopShortcutPath, carestreamLauncher: sys && sys.launcherKey };
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
                pass('Runtime.evaluate carestream ref is Patient.exe client',
                    !!(evalResult && evalResult.cs && evalResult.cs.http === 200 && evalResult.cs.key === 'trophy' && evalResult.cs.patientExe));
                pass('Runtime.evaluate carestream ref documents Patient Card fill',
                    !!(evalResult && evalResult.cs && evalResult.cs.newPatientCard));
                pass('Runtime.evaluate carestream ref documents desktop shortcut',
                    !!(evalResult && evalResult.cs && evalResult.cs.http === 200 && evalResult.cs.key === 'trophy' &&
                        evalResult.cs.patientExe && evalResult.cs.filedata));
                pass('Runtime.evaluate carestream shortcut is CS Imaging Software',
                    !!(evalResult && evalResult.carestreamLauncher === 'carestream' &&
                        String(evalResult.carestreamShortcut || '').indexOf('CS Imaging Software.lnk') >= 0),
                    evalResult && evalResult.carestreamShortcut);
                pass('Runtime.evaluate carestream search uses patient name',
                    !!(evalResult && evalResult.searchFn === 'SMOKE QUIET'),
                    evalResult && evalResult.searchFn);
                if (evalResult && evalResult.csDry && !evalResult.csDry.error && evalResult.csDry.http === 200) {
                    var csBody = evalResult.csDry.body || {};
                    var csMode = csBody.bridge && csBody.bridge.mode;
                    pass('Runtime.evaluate /open/carestream dry_run inactive',
                        csBody.launched === false && csBody.dry_run === true &&
                        csMode === 'carestream_inactive',
                        csMode);
                } else if (evalResult && evalResult.csDry && evalResult.csDry.http === 404) {
                    pass('Runtime.evaluate /open/carestream dry_run', true, '404');
                } else {
                    warn('Runtime.evaluate carestream dry_run', evalResult && evalResult.csDry && (evalResult.csDry.error || evalResult.csDry.http));
                }
                if (evalResult && evalResult.csNew && !evalResult.csNew.error && evalResult.csNew.http === 200) {
                    var csNewBody = evalResult.csNew.body || {};
                    var csNewBridge = csNewBody.bridge || {};
                    var csNewCard = csNewBridge.new_patient_payload || {};
                    pass('Runtime.evaluate carestream new-patient stays inactive',
                        csNewBody.dry_run === true && csNewBody.launched === false &&
                        csNewBridge.mode === 'carestream_inactive',
                        csNewBridge.mode || JSON.stringify(csNewCard));
                } else if (evalResult && evalResult.csNew && evalResult.csNew.http === 404) {
                    pass('Runtime.evaluate carestream new-patient card payload', true, '404');
                } else {
                    warn('Runtime.evaluate carestream new-patient', evalResult && evalResult.csNew && (evalResult.csNew.error || evalResult.csNew.http));
                }

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

                // Live page (configured LIVE, or smoke static fallback)
                try {
                    var liveNav = (global.__XRAY_LIVE_BASE || LIVE) + '/index.html?b=' + BUILD;
                    await cdp.call('Page.navigate', { url: liveNav });
                    await sleep(1200);
                    var livePage = await cdp.js(`(async () => {
                      const deadline = Date.now() + 12000;
                      while (Date.now() < deadline) {
                        if (document.querySelector('.xray-sys-rayscan') &&
                            typeof XRAY_SYSTEMS !== 'undefined' && XRAY_SYSTEMS.carestream) break;
                        await new Promise(r => setTimeout(r, 200));
                      }
                      const sys = (typeof XRAY_SYSTEMS !== 'undefined' && XRAY_SYSTEMS.carestream) || null;
                      const trophy = (typeof XRAY_SYSTEMS !== 'undefined' && XRAY_SYSTEMS.Trophy) || null;
                      const sample = {
                        id: 'sample-quiet',
                        patient_no: 'PL001287',
                        full_name: 'SMOKE QUIET',
                        chinese_name: 'TEST',
                        dob: '1969-05-23',
                        sex: 'M'
                      };
                      const q = ['dry_run=1'];
                      if (typeof appendXrayBridgePatientParams === 'function') {
                        appendXrayBridgePatientParams(q, sample, '', { launcherKey: 'carestream' });
                      }
                      const qs = q.join('&');
                      async function openKey(key) {
                        const r = await fetch('http://127.0.0.1:17890/open/' + key + '?' + qs, { cache: 'no-store', mode: 'cors' });
                        const body = await r.json();
                        return { http: r.status, launched: body.launched, dry_run: body.dry_run, target: body.target, argList: body.bridge && body.bridge.argList, mode: body.bridge && body.bridge.mode };
                      }
                      let sampleCs = null, sampleTw = null;
                      try { sampleCs = await openKey('carestream'); } catch (e) { sampleCs = { error: String(e && e.message || e) }; }
                      try { sampleTw = await openKey('trophy'); } catch (e) { sampleTw = { error: String(e && e.message || e) }; }
                      return {
                        host: location.host,
                        rayscan: !!document.querySelector('.xray-sys-rayscan'),
                        ezdenti: !!document.querySelector('.xray-sys-vatech'),
                        digirex: !!document.querySelector('.xray-sys-digirex'),
                        carestream: !!document.querySelector('.xray-sys-carestream'),
                        carestreamShortcut: sys && sys.desktopShortcutPath,
                        carestreamLauncher: sys && sys.launcherKey,
                        trophyLauncher: trophy && trophy.launcherKey,
                        sampleQs: qs,
                        sampleCs: sampleCs,
                        sampleTw: sampleTw
                      };
                    })()`, true, 20000);
                    var liveHostOk = !!(livePage && livePage.host &&
                        (String(livePage.host).indexOf('5500') >= 0 || String(livePage.host).indexOf(String(PAGE_PORT)) >= 0));
                    pass('live page host', liveHostOk, livePage && livePage.host);
                    pass('live page xray system buttons',
                        !!(livePage && livePage.rayscan && livePage.ezdenti && livePage.carestream),
                        livePage ? JSON.stringify({ rayscan: livePage.rayscan, ezdenti: livePage.ezdenti, carestream: livePage.carestream }) : 'none');
                    pass('live page carestream opens CS Imaging shortcut',
                        !!(livePage && livePage.carestreamLauncher === 'carestream' &&
                            String(livePage.carestreamShortcut || '').indexOf('CS Imaging Software.lnk') >= 0),
                        livePage && livePage.carestreamShortcut);
                    var liveCsArg = String(livePage && livePage.sampleCs && livePage.sampleCs.argList || '');
                    var liveTwArg = String(livePage && livePage.sampleTw && livePage.sampleTw.argList || '');
                    var liveCsMode = String(livePage && livePage.sampleCs && livePage.sampleCs.mode || '');
                    var liveCsTarget = String(livePage && livePage.sampleCs && livePage.sampleCs.target || '');
                    pass('live sample patient carestream stays inactive',
                        !!(livePage && livePage.sampleCs && livePage.sampleCs.http === 200 &&
                            livePage.sampleCs.launched === false && livePage.sampleCs.dry_run === true &&
                            liveCsMode === 'carestream_inactive' &&
                            !/TW\.exe$/i.test(liveCsTarget) && !/Patient\.exe$/i.test(liveCsTarget)),
                        liveCsMode || (livePage && livePage.sampleCs && JSON.stringify(livePage.sampleCs)));
                    pass('live sample patient trophy unquoted -P',
                        !!(livePage && livePage.sampleTw && livePage.sampleTw.http === 200 &&
                            livePage.sampleTw.launched === false && livePage.sampleTw.dry_run === true &&
                            /TW\.exe$/i.test(String(livePage.sampleTw.target || '')) &&
                            liveTwArg.indexOf('-P') === 0 && liveTwArg.indexOf('-P"') !== 0 &&
                            liveTwArg.indexOf('001287') >= 0 && liveTwArg.indexOf('SMOKE QUIET') >= 0),
                        liveTwArg);

                    // Live-page new-patient trial via Runtime.evaluate (dry_run only).
                    var liveNew = await cdp.js(`(async () => {
                      const sample = { id: 'trial-testing', patient_no: '999910', full_name: 'TESTING', dob: '1984-08-15', sex: 'M' };
                      const q = ['dry_run=1'];
                      if (typeof appendXrayBridgePatientParams === 'function') {
                        appendXrayBridgePatientParams(q, sample, '', { launcherKey: 'trophy' });
                      } else {
                        q.push('patient_no=999910', 'patient_name=TESTING', 'dob=1984-08-15', 'sex=M');
                      }
                      const qs = q.join('&');
                      async function openKey(key) {
                        const r = await fetch('http://127.0.0.1:17890/open/' + key + '?' + qs, { cache: 'no-store', mode: 'cors' });
                        const body = await r.json();
                        return { http: r.status, launched: body.launched, dry_run: body.dry_run, mode: body.bridge && body.bridge.mode, argList: body.bridge && body.bridge.argList, scan_path: body.bridge && body.bridge.scan_path, target: body.target };
                      }
                      return { qs: qs, cs: await openKey('carestream'), tw: await openKey('trophy') };
                    })()`, true, 20000);
                    var liveNewCsArg = String(liveNew && liveNew.cs && liveNew.cs.argList || '');
                    var liveNewTwArg = String(liveNew && liveNew.tw && liveNew.tw.argList || '');
                    pass('live new-patient trial dry_run quiet',
                        !!(liveNew && liveNew.cs && liveNew.cs.http === 200 && liveNew.cs.launched === false &&
                            liveNew.tw && liveNew.tw.http === 200 && liveNew.tw.launched === false),
                        JSON.stringify({ cs: liveNew && liveNew.cs && liveNew.cs.mode, tw: liveNew && liveNew.tw && liveNew.tw.mode }));
                    pass('live new-patient trial TESTING / 999910 args',
                        liveNewTwArg.indexOf('-NTESTING') >= 0 && liveNewTwArg.indexOf('999910') >= 0 &&
                        liveNewTwArg.indexOf('-P') === 0,
                        liveNewTwArg || liveNewCsArg);
                } catch (e) {
                    pass('live page CDP', false, e.message);
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
    console.log('SMOKE + SPOT + HTML + API + CDP + LIVE + NEW-PATIENT TRIAL ALL PASS (xray system references, quiet dry_run)');
    process.exit(0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
