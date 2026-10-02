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

var BUILD = '20261002xc5';
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
    pass('helper script cache bust', idx.indexOf('app-xray-ai.js?v=') >= 0);
    pass('page gate function', aiSrc.indexOf('function xrayAiPageIsLocalServer()') >= 0);
    pass('protocol fetch', aiSrc.indexOf('function xrayAiProtocolFetch(') >= 0);
    pass('job link shape', aiSrc.indexOf("'csxrayai://job?' +") >= 0 && aiSrc.indexOf("'client=' + encodeURIComponent(") >= 0);
    pass('analyze does not fall back to browser heuristic',
        aiSrc.indexOf("xrayAiTr('media.xrayAi.protocolWorking')") >= 0 &&
        aiSrc.indexOf('if (xrayAiUseProtocol()) {') >= 0);
    pass('panoramic toggles caries spots and bone loss',
        aiSrc.indexOf('function xrayAiUpdatePanoToggle()') >= 0 &&
        aiSrc.indexOf("panoOverlay: 'bone'") >= 0 &&
        aiSrc.indexOf('var panoSpot = isCaries && xrayAiState.modality === \'panoramic\'') >= 0);
    pass('caries hints keep tick and cross',
        aiSrc.indexOf("if (!xrayAiIsCaries(f) || xrayAiState.lastSource !== 'api')") >= 0 &&
        aiSrc.indexOf('var trainingReady') < 0);
    pass('training button stays visible',
        aiSrc.indexOf('if (trainBtn) trainBtn.hidden = false;') >= 0 &&
        idx.indexOf('id="xrayAiTrainOpenBtn"') >= 0 &&
        idx.indexOf('id="xrayAiTrainOpenBtn" class="xray-ai-train-open"\n                    onclick="xrayAiOpenTrainingReview()" hidden') < 0);
    pass('every page uses csxrayai:// unless XRAY_AI_DIRECT_API',
        aiSrc.indexOf('directApi: window.XRAY_AI_DIRECT_API === true') >= 0 &&
        aiSrc.indexOf('return !(XRAY_AI_CONFIG.directApi && xrayAiPageIsLocalServer());') >= 0 &&
        aiSrc.indexOf('if (xrayAiUseProtocol() && xrayAiIsLocalApiUrl(url))') >= 0 &&
        aiSrc.indexOf('if (!xrayAiPageIsLocalServer())') < 0);
    pass('protocol is launched from the click and not again while the worker is fresh',
        aiSrc.indexOf('if (!xrayAiWorkerFresh()) xrayAiOpenJobProtocol(jobId);') >= 0 &&
        aiSrc.indexOf('client: xrayAiProtocolClientId()') >= 0 &&
        aiSrc.indexOf('xrayAiProtocolWake();') >= 0);
    pass('handler starts the AI service only when it is down',
        ps1.indexOf('function Start-AiIfDown') >= 0 && ps1.indexOf('if (Test-AiHealth) { return $true }') >= 0);
    pass('handler does not assign the read-only $HOME',
        !/^\s*\$home\s*=/im.test(ps1));
    pass('handler runs one worker per session with atomic claims',
        ps1.indexOf('Local\\CsXrayAiProtocolWorker') >= 0 && ps1.indexOf('status=eq.pending&select=*') >= 0);
    ['launch-xray-ai-protocol.cmd', 'launch-xray-ai-protocol.ps1', 'register-xray-ai-protocol.bat'].forEach(function (name) {
        var deployPath = path.join(root, 'xray-ai-deploy-pack', name);
        pass('deploy pack ' + name + ' matches the root copy',
            fs.existsSync(deployPath) && fs.readFileSync(deployPath, 'utf8') === read(name));
    });
    var xraySrc = read('app-xray.js');
    var nntSrc = read('app-nnt-scans.js');
    pass('xray software opens through csxray://',
        xraySrc.indexOf("csxray://open/") >= 0 &&
        xraySrc.indexOf('if (sys.launcherKey)') >= 0);
    pass('maximized panoramic fits inside the panel',
        xraySrc.indexOf('function lbOpenFilmIsPanoramic()') >= 0 &&
        xraySrc.indexOf('!lbChromeMaximized || lbOpenFilmIsPanoramic()') >= 0 &&
        xraySrc.indexOf("classList.toggle('xray-lb-scroll-host-fit'") >= 0);
    pass('github page does not fetch local film strips',
        nntSrc.indexOf('function clinicPageIsLocalServer()') >= 0 &&
        nntSrc.indexOf('!clinicPageIsLocalServer()') >= 0);
    pass('cmd hands every URL to the handler, quoted',
        cmd.indexOf('launch-xray-ai-protocol.ps1" "%~1"') >= 0 && cmd.indexOf('echo %URL%') < 0);
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
    var ctx = { document: doc, encodeURIComponent: encodeURIComponent, Date: Date };
    vm.createContext(ctx);
    vm.runInContext('var xrayAiWorker = {};\nfunction xrayAiProtocolClientId() { return "smoke-client-0001"; }\n' +
        openFn + '\nxrayAiOpenJobProtocol("11111111-1111-4111-8111-111111111111");', ctx);
    pass('protocol click target',
        hrefBox.href === 'csxrayai://job?id=11111111-1111-4111-8111-111111111111&client=smoke-client-0001',
        hrefBox.href || '(empty)');
    hrefBox.href = '';
    vm.runInContext('xrayAiOpenJobProtocol(null);', ctx);
    pass('wake link carries only the client', hrefBox.href === 'csxrayai://job?client=smoke-client-0001',
        hrefBox.href || '(empty)');

    var parseFn = extractFn(aiSrc, 'xrayAiParseJsonDocument');
    var parseCtx = { JSON: JSON, result: null };
    vm.createContext(parseCtx);
    vm.runInContext(parseFn + '\nresult = xrayAiParseJsonDocument(\'{"findings":[{"type":"caries_enamel"}],"model":"m"} 200\');', parseCtx);
    var parsed = parseCtx.result || {};
    pass('protocol body keeps findings when a status code is stuck on the end',
        parsed && parsed.findings && parsed.findings.length === 1 && parsed.findings[0].type === 'caries_enamel',
        parsed && parsed.findings ? String(parsed.findings.length) : 'none');

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

    for (const dsPath of ['/caries/dataset', '/pabw/dataset']) {
        try {
            var ds = await httpGet('127.0.0.1', 8877, dsPath);
            var dj = {};
            try { dj = JSON.parse(ds.body); } catch (e2) {}
            var recentN = Array.isArray(dj.recent) ? dj.recent.length : -1;
            pass('training history API ' + dsPath, ds.status === 200 && recentN >= 0,
                'HTTP ' + ds.status + ' recent=' + recentN);
        } catch (e) {
            pass('training history API ' + dsPath, false, e.message);
        }
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
          eval('var xrayAiWorker = {};\\nfunction xrayAiProtocolClientId() { return "smoke-client-0002"; }\\n' +
            localFn + '\\n' + openFn + '\\nwindow.__xrayAiSmoke = { local: xrayAiPageIsLocalServer() };\\nxrayAiOpenJobProtocol("22222222-2222-4222-8222-222222222222");');
          document.createElement = orig;
          const xraySrc = await (await fetch('/app-xray.js?b=${BUILD}', { cache: 'no-store' })).text();
          const nntSrc = await (await fetch('/app-nnt-scans.js?b=${BUILD}', { cache: 'no-store' })).text();
          return {
            host: location.hostname,
            port: location.port,
            build: window.__JSM_BUILD || '',
            local: window.__xrayAiSmoke.local,
            href: href,
            scriptHasProtocol: src.indexOf("'csxrayai://job?' +") >= 0,
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
            live && live.href === 'csxrayai://job?id=22222222-2222-4222-8222-222222222222&client=smoke-client-0002',
            live && live.href);

        var train = await cdp.js(`(async () => {
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline) {
            if (typeof xrayAiOnLightboxOpen === 'function' && typeof xrayAiOpenTrainingReview === 'function' && typeof xrayAiCloseTrainingReview === 'function' && typeof xrayAiSwitchTrainTab === 'function') break;
            await new Promise(function (r) { setTimeout(r, 200); });
          }
          const btn = document.getElementById('xrayAiTrainOpenBtn');
          const modal = document.getElementById('xrayAiTrainModal');
          const panel = document.getElementById('xrayAiPanel');
          if (!btn || !modal || !panel) {
            return { ready: false, hasBtn: !!btn, hasModal: !!modal, hasPanel: !!panel };
          }
          const orig = document.createElement.bind(document);
          document.createElement = function (tag) {
            const el = orig(tag);
            if (String(tag).toLowerCase() === 'a') el.click = function () {};
            return el;
          };
          if (typeof openModal === 'function') openModal('xrayLightbox');
          xrayAiOnLightboxOpen('smoke-xray');
          const shown = btn.hidden === false && (btn.textContent || '').indexOf('Training') >= 0;
          const label = (btn.getAttribute('data-i18n') || '') + '|' + (btn.textContent || '').trim();
          btn.click();
          const opened = modal.hidden === false;
          const panoTab = document.getElementById('xrayAiTrainTabPano');
          const pabwTab = document.getElementById('xrayAiTrainTabPabw');
          const panoPane = document.getElementById('xrayAiTrainPanePano');
          const pabwPane = document.getElementById('xrayAiTrainPanePabw');
          const runPano = document.getElementById('xrayAiTrainRunBtn');
          const runPabw = document.getElementById('xrayAiTrainRunBtnPabw');
          xrayAiSwitchTrainTab('pabw');
          const pabwOn = pabwPane && pabwPane.hidden === false && panoPane && panoPane.hidden === true;
          xrayAiSwitchTrainTab('pano');
          const panoOn = panoPane && panoPane.hidden === false && pabwPane && pabwPane.hidden === true;
          xrayAiCloseTrainingReview();
          document.createElement = orig;
          return {
            ready: true,
            shown: shown,
            label: label,
            opened: opened,
            closed: modal.hidden === true,
            tabs: !!(panoTab && pabwTab && runPano && runPabw),
            pabwOn: pabwOn,
            panoOn: panoOn
          };
        })()`, true, 30000);
        pass('live page training button is on the GitHub-style page',
            train && train.ready && train.shown === true, train ? JSON.stringify(train) : 'none');
        pass('live page training panel opens',
            train && train.opened === true && train.tabs === true, train ? ('opened=' + train.opened) : 'none');
        pass('live page training panel switches panoramic and bitewing',
            train && train.pabwOn === true && train.panoOn === true, train ? ('pabw=' + train.pabwOn + ' pano=' + train.panoOn) : 'none');
        pass('live page training panel closes',
            train && train.closed === true, train ? ('closed=' + train.closed) : 'none');

        var fb = await cdp.js(`(() => {
          const section = document.getElementById('consultationSection');
          if (section) section.style.display = 'block';
          const lb = document.getElementById('xrayLightbox');
          const main = document.getElementById('xrayLbMain');
          if (lb) lb.style.display = 'block';
          if (main) main.classList.remove('xray-lb-meta-hidden');
          if (typeof openModal === 'function') openModal('xrayLightbox');
          const list = document.getElementById('xrayAiFindingsList');
          if (!list) return { ready: false };
          list.innerHTML = '<div class="xray-ai-finding-row">' +
            '<button type="button" class="xray-ai-finding-item">enamel caries · 42%</button>' +
            '<span class="xray-ai-fb">' +
            '<button type="button" class="xray-ai-fb-btn xray-ai-fb-yes">\\u2713</button>' +
            '<button type="button" class="xray-ai-fb-btn xray-ai-fb-no">\\u2717</button>' +
            '</span></div>';
          const yes = list.querySelector('.xray-ai-fb-yes');
          const no = list.querySelector('.xray-ai-fb-no');
          const yesR = yes.getBoundingClientRect();
          const noR = no.getBoundingClientRect();
          const listR = list.getBoundingClientRect();
          const box = document.querySelector('#xrayLightbox .xray-lightbox-box');
          return {
            ready: true,
            yesW: Math.round(yesR.width),
            noW: Math.round(noR.width),
            listW: Math.round(listR.width),
            boxW: box ? Math.round(box.getBoundingClientRect().width) : -1,
            innerW: window.innerWidth,
            lb: lb ? getComputedStyle(lb).display : '',
            inside: listR.width > 0 && yesR.width > 0 && yesR.left >= listR.left - 1 && noR.right <= listR.right + 1,
            color: getComputedStyle(yes).color
          };
        })()`, true, 15000);
        pass('tick and cross sit inside the findings list',
            fb && fb.ready && fb.yesW >= 16 && fb.noW >= 16 && fb.inside === true,
            fb ? JSON.stringify(fb) : 'none');

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
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline && typeof xrayAiOnLightboxOpen !== 'function') {
            await new Promise(function (r) { setTimeout(r, 200); });
          }
          const btn = document.getElementById('xrayAiTrainOpenBtn');
          const before = btn ? btn.hidden : null;
          if (typeof openModal === 'function') openModal('xrayLightbox');
          if (typeof xrayAiOnLightboxOpen === 'function') xrayAiOnLightboxOpen('smoke-xray');
          const sample = {
            stats: { confirm: 2, reject: 1, images: 2 },
            preflight: [{ check: 'weights', ok: true, detail: 'ready' }],
            ready_to_train: false,
            training_enabled: true,
            recent: [
              { verdict: 'confirm', ts: '2026-09-30T12:00:00', confidence: 0.42, type: 'caries_enamel', surface: 'mesial' },
              { verdict: 'reject', ts: '2026-09-30T12:05:00', confidence: 0.2, type: 'caries_dentin', surface: 'distal' }
            ]
          };
          // The page must reach the AI helper only through xray_ai_jobs +
          // csxrayai://, even on 127.0.0.1. The mailbox is faked here so no
          // real job row is written and no real handler is launched.
          const origFetch = window.fetch;
          window.__trainHits = [];
          window.__directHits = [];
          window.__launches = [];
          window.fetch = function (url, opts) {
            const u = String(url && url.url ? url.url : url || '');
            if (u.indexOf('127.0.0.1:8877') >= 0) window.__directHits.push(u);
            return origFetch.apply(this, arguments);
          };
          const origCreate = document.createElement.bind(document);
          document.createElement = function (tag) {
            const el = origCreate(tag);
            if (String(tag).toLowerCase() === 'a') {
              el.click = function () {
                if (String(el.href).indexOf('csxrayai:') === 0) window.__launches.push(el.href);
              };
            }
            return el;
          };
          const jobs = {};
          const origFrom = SB.from.bind(SB);
          SB.from = function (table) {
            if (table !== 'xray_ai_jobs') return origFrom(table);
            return {
              insert: function (rows) {
                rows.forEach(function (r) { jobs[r.id] = r; });
                return Promise.resolve({ data: null, error: null });
              },
              select: function () {
                return { eq: function (col, id) { return { maybeSingle: function () {
                  const job = jobs[id];
                  if (!job) return Promise.resolve({ data: null, error: null });
                  const p = (job.payload && job.payload.path) || '';
                  if (p.indexOf('/dataset') >= 0 || p.indexOf('/train/status') >= 0) window.__trainHits.push(p + '|' + (job.payload.client ? 'client' : 'noclient'));
                  const body = p.indexOf('/dataset') >= 0 ? sample : { state: 'idle', message: 'idle' };
                  return Promise.resolve({ data: { status: 'done', result: { http_status: 200, body_json: JSON.stringify(body) }, error: null }, error: null });
                } }; } };
              }
            };
          };
          const typeEl = document.getElementById('lbType');
          if (typeEl) typeEl.value = 'panoramic';
          const modal = document.getElementById('xrayAiTrainModal');
          if (btn) btn.click();
          const verdicts = document.getElementById('xrayAiTrainVerdicts');
          const pabwVerdicts = document.getElementById('xrayAiTrainVerdictsPabw');
          async function waitPane(el) {
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline) {
              const text = el ? (el.textContent || '').trim() : '';
              const n = el ? el.querySelectorAll('.xray-ai-train-verdict').length : 0;
              if (n > 0 || (text && text.indexOf('Loading') < 0)) return text;
              await new Promise(function (r) { setTimeout(r, 200); });
            }
            return el ? (el.textContent || '').trim() : '';
          }
          let history = await waitPane(verdicts);
          if (typeof xrayAiSwitchTrainTab === 'function') xrayAiSwitchTrainTab('pabw');
          let pabwHistory = await waitPane(pabwVerdicts);
          const rows = verdicts ? verdicts.querySelectorAll('.xray-ai-train-verdict').length : 0;
          const pabwRows = pabwVerdicts ? pabwVerdicts.querySelectorAll('.xray-ai-train-verdict').length : 0;
          const empty = (verdicts ? verdicts.querySelectorAll('.xray-ai-train-empty').length : 0) +
            (pabwVerdicts ? pabwVerdicts.querySelectorAll('.xray-ai-train-empty').length : 0);
          return {
            host: location.hostname,
            port: location.port,
            local: xrayAiPageIsLocalServer(),
            trainHidden: btn ? btn.hidden : null,
            trainWasHidden: before,
            clickedOpen: !!(modal && modal.hidden === false),
            history: history.slice(0, 180),
            pabwHistory: pabwHistory.slice(0, 120),
            rows: rows,
            pabwRows: pabwRows,
            empty: empty,
            stats: (document.getElementById('xrayAiTrainStats') || {}).textContent || '',
            hits: window.__trainHits || [],
            directHits: window.__directHits || [],
            launches: window.__launches || [],
            btnW: btn ? Math.round(btn.getBoundingClientRect().width) : 0,
            lbDisplay: (document.getElementById('xrayLightbox') || {}).style ? document.getElementById('xrayLightbox').style.display : ''
          };
        })()`, true, 40000);
        pass('same files on 127.0.0.1 still count as the local page',
            loop && loop.local === true && loop.host === '127.0.0.1' && String(loop.port) !== String(BANANA_LIVE_PORT),
            loop ? (loop.host + ':' + loop.port + ' local=' + loop.local) : 'none');
        pass('5500-style page shows the training button in the lightbox',
            loop && loop.trainHidden === false,
            loop ? ('before=' + loop.trainWasHidden + ' after=' + loop.trainHidden) : 'none');
        pass('clicking Training opens the panel',
            loop && loop.clickedOpen === true, loop ? ('open=' + loop.clickedOpen) : 'none');
        pass('training history is shown',
            loop && loop.rows >= 2 && loop.pabwRows >= 2 &&
                loop.history.indexOf('Loading') < 0 && loop.pabwHistory.indexOf('Loading') < 0,
            loop ? ('pano=' + loop.rows + ' pabw=' + loop.pabwRows + ' hits=' + JSON.stringify(loop.hits) + ' ' + loop.history + ' | ' + loop.pabwHistory) : 'none');
        pass('127.0.0.1 page reaches the helper through csxrayai:// jobs, not the browser',
            loop && loop.hits.length >= 2 && loop.directHits.length === 0 &&
                loop.hits.every(function (h) { return /\|client$/.test(h); }),
            loop ? ('jobs=' + JSON.stringify(loop.hits) + ' direct=' + JSON.stringify(loop.directHits)) : 'none');
        pass('csxrayai:// launched once for several requests',
            loop && loop.launches.length === 1 && /^csxrayai:\/\/job\?(id=[0-9a-f-]{36}&)?client=[A-Za-z0-9-]+$/.test(loop.launches[0]),
            loop ? JSON.stringify(loop.launches) : 'none');
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
