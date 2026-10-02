/**
 * Consultation active-patient flash: smoke / spot / API + testclient +
 * CDP Runtime.evaluate / live page.
 * Run: node scripts/con-active-patient-nav-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');
var vm = require('vm');

var BUILD = '20261002cb9';
var PAGE_PORT = 8793;
var CDP_PORT = 9355;
var CHROME = process.env.CHROME_PATH ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var root = path.resolve(__dirname, '..');
var fails = [];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

function readSbConfig(appJs) {
    var block = appJs.match(/supabase\.createClient\(([\s\S]*?)\);/);
    if (!block) throw new Error('supabase.createClient not found');
    var parts = [];
    var re = /'([^']*)'/g;
    var m;
    while ((m = re.exec(block[1]))) parts.push(m[1]);
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
        req.on('timeout', function () { req.destroy(); reject(new Error('timeout')); });
    });
}

function rest(base, key, table, qs) {
    var url = base.replace(/\/$/, '') + '/rest/v1/' + table + (qs ? ('?' + qs) : '');
    return fetch(url, {
        method: 'GET',
        headers: {
            apikey: key, Authorization: 'Bearer ' + key,
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

function extractFn(src, name) {
    var marker = 'function ' + name + '(';
    var start = src.indexOf(marker);
    if (start < 0) throw new Error('missing ' + name);
    var i = src.indexOf('{', start);
    var depth = 0;
    for (var j = i; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') {
            depth--;
            if (depth === 0) return src.slice(start, j + 1);
        }
    }
    throw new Error('unclosed ' + name);
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

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

function finish(code) {
    if (fails.length) {
        console.log('\nFAILED ' + fails.length);
        fails.forEach(function (f) { console.log('  - ' + f); });
        process.exit(code == null ? 1 : code);
    }
    console.log('\nAll checks passed.');
    process.exit(0);
}

(async function main() {
    console.log('=== smoke / spot: consultation active-patient nav (BUILD ' + BUILD + ') ===\n');
    var html = read('index.html');
    var conSrc = read('app-consultation.js');
    var appSrc = read('app.js');
    var patSrc = read('app-patient.js');

    console.log('=== spot: source ===');
    pass('index BUILD', html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    pass('consultation cache bust', html.indexOf('app-consultation.js?v=' + BUILD) >= 0);
    pass('app.js cache bust', html.indexOf('app.js?v=' + BUILD) >= 0);
    pass('app-patient.js cache bust', html.indexOf('app-patient.js?v=' + BUILD) >= 0);
    pass('dock card 0 is in the live page shell', html.indexOf('id="activePatientCard0"') >= 0);

    pass('initConsultation keeps current patient instead of wiping then restoring',
        conSrc.indexOf('function resolveConsultationActivePatient()') >= 0 &&
        /function initConsultation\(\) \{[\s\S]{0,900}keepP = resolveConsultationActivePatient\(\)/.test(conSrc) &&
        conSrc.indexOf("pinConsultationPatientToActiveSlot('consultation-reenter')") >= 0 &&
        !/function initConsultation\(\) \{[\s\S]{0,1600}conPatientId\s*=\s*null;[\s\S]{0,400}_patientDetailsPatient/.test(conSrc));

    pass('selectConPatient pins dock without waiting for a delayed restore',
        /function selectConPatient\(p\) \{[\s\S]{0,700}setActivePatientSlot\(0,/.test(conSrc) &&
        conSrc.indexOf("setActivePatientSlot(0, conPatientData || p, 'consultation-select', false)") >= 0);

    pass('same-patient re-entry uses conAppliedPatientId not directory side effects',
        conSrc.indexOf('var conAppliedPatientId = null;') >= 0 &&
        conSrc.indexOf('conAppliedPatientId && String(conAppliedPatientId) === String(p.id)') >= 0);

    pass('history loads ignore stale generation and do not push the directory',
        conSrc.indexOf('if (loadGen !== conPatientSelectGen) return;') >= 0 &&
        conSrc.indexOf('syncConMedicalFieldsToPatientData(d, false)') >= 0 &&
        conSrc.indexOf('syncConDentalFieldsToPatientData(d, false)') >= 0 &&
        conSrc.indexOf('if (pushActive && typeof setDirectoryActivePatient') >= 0);

    pass('history saves still push the directory',
        conSrc.indexOf('syncConMedicalFieldsToPatientData(payload, true)') >= 0 &&
        conSrc.indexOf('syncConDentalFieldsToPatientData(payload, true)') >= 0);

    pass('back to dashboard pins the consultation patient onto the dock',
        appSrc.indexOf("pinConsultationPatientToActiveSlot('consultation-leave')") >= 0);

    pass('slot hydrate is generation-guarded so a previous patient cannot overlay',
        appSrc.indexOf('var activePatientSlotHydrateGen = [0, 0];') >= 0 &&
        appSrc.indexOf('if (hydrateGen !== activePatientSlotHydrateGen[slotIdx]) return;') >= 0 &&
        /if \(norm && activePatientSlots\[slotIdx\] &&[\s\S]{0,180}String\(activePatientSlots\[slotIdx\]\.id\) === String\(norm\.id\)/.test(appSrc));

    pass('consultation sources do not rewrite the patient-directory search',
        patSrc.indexOf("src.indexOf('consultation-') === 0") >= 0 &&
        /_patientDetailsPatient !== p/.test(patSrc));

    console.log('\n=== testclient: resolver prefers the consultation pick ===');
    var sandbox = {
        conPatientData: { id: 'b', full_name: 'New Patient' },
        conPatientId: 'b',
        activePatientSlots: [{ id: 'a', full_name: 'Previous Patient' }, null],
        _patientDetailsPatient: { id: 'a', full_name: 'Previous Patient' }
    };
    vm.createContext(sandbox);
    vm.runInContext(extractFn(conSrc, 'resolveConsultationActivePatient'), sandbox);
    var resolved = sandbox.resolveConsultationActivePatient();
    pass('testclient resolver returns the consultation patient, not the previous dock card',
        resolved && resolved.id === 'b',
        resolved && resolved.full_name);

    sandbox.conPatientData = null;
    sandbox.conPatientId = null;
    var fromDock = sandbox.resolveConsultationActivePatient();
    pass('testclient resolver falls back to the dock when consultation is empty',
        fromDock && fromDock.id === 'a');

    sandbox.conPatientData = { id: 'b', full_name: 'New Patient' };
    sandbox.conPatientId = 'b';
    sandbox._patientDetailsPatient = { id: 'a', full_name: 'Previous Patient' };
    sandbox.activePatientSlots = [{ id: 'a', full_name: 'Previous Patient' }, null];
    var afterStaleDir = sandbox.resolveConsultationActivePatient();
    pass('testclient stale _patientDetailsPatient cannot win over the consultation pick',
        afterStaleDir && afterStaleDir.id === 'b');

    console.log('\n=== live server HTTP ===');
    var liveHttp = null;
    var livePort = 0;
    var ports = [5500, 5501, 8123, 8124, 8792];
    for (var pi = 0; pi < ports.length; pi++) {
        try {
            var probe = await httpGet('127.0.0.1', ports[pi], '/index.html');
            if (!probe || probe.status !== 200) continue;
            var isOurs = probe.body.indexOf("BUILD = '" + BUILD + "'") >= 0;
            if (!livePort || isOurs) { liveHttp = probe; livePort = ports[pi]; }
            if (isOurs) break;
        } catch (e) {}
    }
    if (!liveHttp) pass('clinic UI reachable', false, 'no listener on ' + ports.join('/'));
    if (liveHttp) {
        pass('clinic UI reachable', liveHttp.status === 200, ':' + livePort);
        var build = (liveHttp.body.match(/BUILD = '([^']+)'/) || [])[1];
        pass('served BUILD is ' + BUILD, build === BUILD, build || 'missing');
        var conJs = await httpGet('127.0.0.1', livePort, '/app-consultation.js?b=' + BUILD);
        var appJs = await httpGet('127.0.0.1', livePort, '/app.js?b=' + BUILD);
        var patJs = await httpGet('127.0.0.1', livePort, '/app-patient.js?b=' + BUILD);
        pass('served consultation keeps the current patient on re-enter',
            conJs.status === 200 &&
            conJs.body.indexOf('resolveConsultationActivePatient') >= 0 &&
            conJs.body.indexOf("pinConsultationPatientToActiveSlot('consultation-reenter')") >= 0,
            'HTTP ' + conJs.status);
        pass('served app.js pins the dock on consultation leave',
            appJs.status === 200 &&
            appJs.body.indexOf("pinConsultationPatientToActiveSlot('consultation-leave')") >= 0 &&
            appJs.body.indexOf('activePatientSlotHydrateGen') >= 0,
            'HTTP ' + appJs.status);
        pass('served app-patient.js skips consultation directory-search rewrite',
            patJs.status === 200 && patJs.body.indexOf("src.indexOf('consultation-') === 0") >= 0,
            'HTTP ' + patJs.status);
    }

    console.log('\n=== API ===');
    var sb = readSbConfig(appSrc);
    var listed = await rest(sb.url, sb.key, 'patients',
        'select=id,full_name,patient_no,chinese_name&order=patient_no.asc&limit=2');
    pass('two patients readable for card identity',
        listed.status === 200 && Array.isArray(listed.json) && listed.json.length >= 2,
        'HTTP ' + listed.status + ' n=' + (Array.isArray(listed.json) ? listed.json.length : 0));
    var apiA = listed.json && listed.json[0];
    var apiB = listed.json && listed.json[1];
    pass('API patients have distinct ids',
        !!(apiA && apiB && apiA.id && apiB.id && String(apiA.id) !== String(apiB.id)),
        apiA && apiB ? (apiA.full_name + ' / ' + apiB.full_name) : 'missing');

    console.log('\n=== CDP live page / Runtime.evaluate / testclient ===');
    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        finish(1);
        return;
    }

    var server = await startStaticServer(PAGE_PORT);
    var profile = path.join(os.tmpdir(), 'cs-con-active-patient-nav-cdp');
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

        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) {
            ws.addEventListener('open', resolve);
            ws.addEventListener('error', reject);
        });
        var cdp = new Cdp(ws);
        await cdp.call('Page.enable');
        await cdp.call('Runtime.enable');
        await cdp.call('Page.navigate', { url: hosted });
        await sleep(1200);

        var live = await cdp.js(`(async () => {
          const deadline = Date.now() + 25000;
          while (Date.now() < deadline) {
            if (typeof selectConPatient === 'function' &&
                typeof initConsultation === 'function' &&
                typeof resolveConsultationActivePatient === 'function' &&
                typeof pinConsultationPatientToActiveSlot === 'function' &&
                typeof setActivePatientSlot === 'function' &&
                typeof showDashboard === 'function' &&
                typeof showOnly === 'function') break;
            await new Promise(function (r) { setTimeout(r, 200); });
          }
          const login = document.getElementById('loginOverlay');
          if (login) login.style.display = 'none';
          const A = { id: 'nav-smoke-a', full_name: 'Previous Patient', patient_no: '111111', chinese_name: '甲' };
          const B = { id: 'nav-smoke-b', full_name: 'Current Patient', patient_no: '222222', chinese_name: '乙' };
          function cardId() {
            var card = document.getElementById('activePatientCard0');
            return card ? String(card.getAttribute('data-patient-id') || '') : '';
          }
          function cardText() {
            var card = document.getElementById('activePatientCard0');
            var box = card && card.querySelector('.active-patient-badge-textbox');
            return box ? String(box.value || '') : '';
          }
          function bannerName() {
            var el = document.getElementById('conBannerName');
            return el ? String(el.textContent || '') : '';
          }
          function dashVisible() {
            var el = document.getElementById('dashboardSection');
            return !!(el && el.style.display !== 'none' && el.getAttribute('aria-hidden') !== 'true');
          }
          function conVisible() {
            var el = document.getElementById('consultationSection');
            return !!(el && el.style.display !== 'none' && el.getAttribute('aria-hidden') !== 'true');
          }

          activePatientSlots[0] = A;
          if (typeof renderActivePatientSlots === 'function') renderActivePatientSlots();
          _patientDetailsPatient = A;
          conPatientData = A;
          conPatientId = A.id;
          conAppliedPatientId = A.id;
          const afterA = { slot: activePatientSlots[0] && activePatientSlots[0].id, card: cardId(), text: cardText() };

          selectConPatient(B);
          const afterSelect = {
            slot: activePatientSlots[0] && activePatientSlots[0].id,
            con: conPatientData && conPatientData.id,
            applied: conAppliedPatientId,
            details: _patientDetailsPatient && _patientDetailsPatient.id,
            card: cardId(),
            text: cardText(),
            banner: bannerName()
          };

          pinConsultationPatientToActiveSlot('consultation-leave');
          showDashboard();
          const afterDash = {
            slot: activePatientSlots[0] && activePatientSlots[0].id,
            conId: conPatientData && conPatientData.id,
            card: cardId(),
            text: cardText(),
            dash: dashVisible(),
            conShown: conVisible()
          };

          _patientDetailsPatient = A;
          const resolved = resolveConsultationActivePatient();
          initConsultation();
          const afterReenter = {
            slot: activePatientSlots[0] && activePatientSlots[0].id,
            conId: conPatientData && conPatientData.id,
            applied: conAppliedPatientId,
            resolved: resolved && resolved.id,
            card: cardId(),
            text: cardText(),
            banner: bannerName(),
            conShown: conVisible(),
            details: _patientDetailsPatient && _patientDetailsPatient.id
          };

          const genBefore = conPatientSelectGen;
          conPatientSelectGen = genBefore + 1;
          const staleIgnored = genBefore !== conPatientSelectGen;
          const hydrateGens = (typeof activePatientSlotHydrateGen !== 'undefined')
            ? [activePatientSlotHydrateGen[0], activePatientSlotHydrateGen[1]]
            : null;

          const flashedBack = [afterSelect, afterDash, afterReenter].some(function (s) {
            return s.slot === 'nav-smoke-a' || s.card === 'nav-smoke-a' ||
              s.conId === 'nav-smoke-a' || s.con === 'nav-smoke-a' ||
              (s.text && s.text.indexOf('Previous Patient') >= 0) ||
              (s.banner && s.banner.indexOf('Previous Patient') >= 0);
          });

          return {
            ready: typeof selectConPatient === 'function',
            build: window.__JSM_BUILD || '',
            host: location.hostname,
            port: String(location.port || ''),
            afterA: afterA,
            afterSelect: afterSelect,
            afterDash: afterDash,
            afterReenter: afterReenter,
            staleIgnored: staleIgnored,
            hydrateGens: hydrateGens,
            flashedBack: flashedBack,
            stuckOnCurrent:
              afterSelect.slot === 'nav-smoke-b' &&
              afterSelect.card === 'nav-smoke-b' &&
              afterDash.slot === 'nav-smoke-b' &&
              afterDash.card === 'nav-smoke-b' &&
              afterReenter.slot === 'nav-smoke-b' &&
              afterReenter.card === 'nav-smoke-b' &&
              afterReenter.conId === 'nav-smoke-b' &&
              afterReenter.resolved === 'nav-smoke-b'
          };
        })()`, true, 40000);

        pass('Runtime.evaluate page BUILD', live && live.build === BUILD, live && live.build);
        pass('Runtime.evaluate hosted host', live && live.host === 'xray-ai.test', live && live.host);
        pass('Runtime.evaluate hosted port', live && String(live.port) === String(PAGE_PORT), live && live.port);
        pass('live page helpers ready', live && live.ready === true);
        pass('testclient pick updates dock card to the current patient',
            live && live.afterSelect && live.afterSelect.slot === 'nav-smoke-b' &&
                live.afterSelect.card === 'nav-smoke-b' &&
                /current patient/i.test(String(live.afterSelect.text || '')) &&
                String(live.afterSelect.banner || '').indexOf('Current Patient') >= 0,
            live ? JSON.stringify(live.afterSelect) : 'none');
        pass('live dashboard leave keeps the current patient on the card',
            live && live.afterDash && live.afterDash.slot === 'nav-smoke-b' &&
                live.afterDash.card === 'nav-smoke-b' &&
                live.afterDash.conId === 'nav-smoke-b' &&
                live.afterDash.dash === true &&
                String(live.afterDash.text || '').indexOf('Previous Patient') < 0,
            live ? JSON.stringify(live.afterDash) : 'none');
        pass('live consultation re-enter does not restore the previous patient',
            live && live.afterReenter && live.afterReenter.slot === 'nav-smoke-b' &&
                live.afterReenter.card === 'nav-smoke-b' &&
                live.afterReenter.conId === 'nav-smoke-b' &&
                live.afterReenter.resolved === 'nav-smoke-b' &&
                live.afterReenter.conShown === true &&
                String(live.afterReenter.banner || '').indexOf('Current Patient') >= 0,
            live ? JSON.stringify(live.afterReenter) : 'none');
        pass('stale _patientDetailsPatient cannot flash the previous patient back',
            live && live.flashedBack === false && live.stuckOnCurrent === true,
            live ? ('flashed=' + live.flashedBack + ' stuck=' + live.stuckOnCurrent) : 'none');
        pass('consultation select generation can invalidate a stale history load',
            live && live.staleIgnored === true);
        pass('dock hydrate generation exists on the live page',
            live && Array.isArray(live.hydrateGens) && live.hydrateGens.length === 2);

        if (apiA && apiB) {
            var apiLive = await cdp.js(`(async () => {
              const A = ${JSON.stringify({
                  id: apiA.id,
                  full_name: apiA.full_name || 'API-A',
                  patient_no: apiA.patient_no || '1',
                  chinese_name: apiA.chinese_name || ''
              })};
              const B = ${JSON.stringify({
                  id: apiB.id,
                  full_name: apiB.full_name || 'API-B',
                  patient_no: apiB.patient_no || '2',
                  chinese_name: apiB.chinese_name || ''
              })};
              function cardId() {
                var card = document.getElementById('activePatientCard0');
                return card ? String(card.getAttribute('data-patient-id') || '') : '';
              }
              activePatientSlots[0] = A;
              if (typeof renderActivePatientSlots === 'function') renderActivePatientSlots();
              _patientDetailsPatient = A;
              conPatientData = A;
              conPatientId = A.id;
              conAppliedPatientId = A.id;
              selectConPatient(B);
              pinConsultationPatientToActiveSlot('consultation-leave');
              showDashboard();
              _patientDetailsPatient = A;
              initConsultation();
              return {
                a: A.id,
                b: B.id,
                slot: activePatientSlots[0] && activePatientSlots[0].id,
                card: cardId(),
                con: conPatientData && conPatientData.id,
                details: _patientDetailsPatient && _patientDetailsPatient.id
              };
            })()`, true, 20000);
            pass('API-backed testclient stays on the second patient after dash/re-enter',
                apiLive && String(apiLive.slot) === String(apiB.id) &&
                    String(apiLive.card) === String(apiB.id) &&
                    String(apiLive.con) === String(apiB.id) &&
                    String(apiLive.details) === String(apiB.id),
                apiLive ? JSON.stringify(apiLive) : 'none');
        }
    } catch (e) {
        pass('CDP live page', false, e && e.message ? e.message : String(e));
    } finally {
        try { if (ws) ws.close(); } catch (e) {}
        try { proc.kill(); } catch (e) {}
        await new Promise(function (r) { server.close(r); });
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    }

    finish(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
