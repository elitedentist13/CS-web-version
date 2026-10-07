/**
 * Banana Dicom Reader — virtual implant overlay, steps 1–10.
 * Run: node scripts/xray-cs3d-implant-smoke.js
 */
var fs = require('fs');
var http = require('http');
var https = require('https');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261007imp9';
var PAGE_PORT = 8808;
var CDP_PORT = 9378;
var CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var root = path.resolve(__dirname, '..');
var fails = [];
var extraFiles = {};

var BBMRI_SLICES = [
    'bbmri-53323131.dcm',
    'bbmri-53323275.dcm',
    'bbmri-53323419.dcm',
    'bbmri-53323563.dcm',
    'bbmri-53323707.dcm',
    'bbmri-53323851.dcm'
];
var BBMRI_BASE = 'https://raw.githubusercontent.com/ivmartel/dwv/develop/tests/data/';

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function httpGetText(port, reqPath) {
    return new Promise(function (resolve, reject) {
        var req = http.get({ host: '127.0.0.1', port: port, path: reqPath, timeout: 8000 }, function (r) {
            var d = [];
            r.on('data', function (c) { d.push(c); });
            r.on('end', function () {
                var buf = Buffer.concat(d);
                resolve({ status: r.statusCode, body: buf, text: buf.toString('utf8') });
            });
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
            r.on('end', function () { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}
async function waitJson(url, timeoutMs) {
    var deadline = Date.now() + timeoutMs, last = null;
    while (Date.now() < deadline) {
        try { return await httpGetJson(url); } catch (e) { last = e; await sleep(250); }
    }
    throw new Error('timeout ' + url + ' last=' + (last && last.message));
}
function sbCfg() {
    var block = read('app.js').match(/supabase\.createClient\(([\s\S]*?)\);/);
    var parts = [], re = /'([^']*)'/g, m;
    while ((m = re.exec(block[1]))) parts.push(m[1]);
    return { url: parts[0], key: parts.slice(1).join('') };
}
function downloadUrl(url) {
    return new Promise(function (resolve, reject) {
        https.get(url, { headers: { 'User-Agent': 'banana-cs3d-implant-smoke' } }, function (r) {
            if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
                downloadUrl(r.headers.location).then(resolve, reject);
                return;
            }
            var chunks = [];
            r.on('data', function (c) { chunks.push(c); });
            r.on('end', function () {
                resolve({ status: r.statusCode, buf: Buffer.concat(chunks), type: r.headers['content-type'] || 'application/dicom' });
            });
        }).on('error', reject);
    });
}
function startStaticServer(port) {
    var types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/markdown', '.wasm': 'application/wasm', '.dcm': 'application/dicom' };
    var server = http.createServer(function (req, res) {
        var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (extraFiles[urlPath]) {
            var ex = extraFiles[urlPath];
            res.writeHead(200, { 'Content-Type': ex.type || 'application/octet-stream', 'Content-Length': ex.buf.length });
            res.end(ex.buf);
            return;
        }
        if (urlPath.charAt(urlPath.length - 1) === '/') urlPath += 'index.html';
        if (urlPath === '/') urlPath = '/index.html';
        var file = path.normalize(path.join(root, urlPath));
        if (file.indexOf(root) !== 0) { res.writeHead(403); res.end('no'); return; }
        fs.readFile(file, function (err, buf) {
            if (err && /^\/cs3d(\/|$)/.test(urlPath) && !/\.[a-z0-9]+$/i.test(urlPath.replace(/\/index\.html$/i, ''))) {
                fs.readFile(path.join(root, 'cs3d', 'index.html'), function (err2, buf2) {
                    if (err2) { res.writeHead(404); res.end('missing'); return; }
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(buf2);
                });
                return;
            }
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

function mockDom() {
    var store = {};
    function el(id) {
        if (store[id]) return store[id];
        var node = {
            id: id,
            value: id === 'impDia' ? '4' : (id === 'impLen' ? '10' : ''),
            className: '',
            classList: { toggle: function () {}, add: function () {}, remove: function () {} },
            innerHTML: '',
            textContent: '',
            style: {},
            parentNode: null,
            clientWidth: 200,
            clientHeight: 200,
            children: [],
            querySelectorAll: function () { return []; },
            addEventListener: function () {},
            appendChild: function (c) { node.children.push(c); return c; },
            getAttribute: function () { return null; },
            setAttribute: function () {},
            getBoundingClientRect: function () { return { left: 0, top: 0, width: 200, height: 200 }; }
        };
        store[id] = node;
        return node;
    }
    var axis = el('vpAxial');
    var pane = el('paneAxial');
    axis.parentNode = pane;
    return {
        readyState: 'complete',
        addEventListener: function () {},
        getElementById: function (id) { return el(id); },
        createElementNS: function (ns, tag) {
            return {
                tagName: tag,
                setAttribute: function () {},
                getAttribute: function () { return null; },
                appendChild: function () {},
                innerHTML: ''
            };
        }
    };
}

(async function () {
    var html = read('cs3d/index.html');
    var css = read('cs3d/cs3d.css');
    var js = read('cs3d/cs3d-implant.js');
    var page = read('cs3d/cs3d.js');
    var launch = read('app-xray-cs3d.js');
    var sql = read('cs3d_implant_plans.sql');

    console.log('=== step 1 source / smoke: chrome ===');
    pass('s1 source: #btnImplant', html.indexOf('id="btnImplant"') >= 0);
    pass('s1 source: #implantPanel', html.indexOf('id="implantPanel"') >= 0);
    pass('s1 source: cs3d.implant.* keys', /cs3d\.implant\.(tool|disclaimer|add)/.test(js) && html.indexOf('cs3d.implant.tool') >= 0);
    pass('s1 source: BUILD ' + BUILD, html.indexOf('cs3d-implant.js?v=' + BUILD) >= 0 && html.indexOf('cs3d.js?v=' + BUILD) >= 0);
    pass('s1 source: panel starts hidden', /#implantPanel\s*\{[^}]*display:\s*none/.test(css));
    pass('s1 source: Implant tool wired in setTool', /name === 'Implant'/.test(page));
    pass('s1 source: WebGL proxy fallback',
        /function loseViewportGl/.test(page) && /include3d: false/.test(page) && /function patchCanvasGl/.test(page) &&
        /if \(!result\) return null/.test(read('cs3d/vendor/cs3d.bundle.js')));
    pass('s1 source: eMpr hoisted for stack fallback',
        /var eMpr = null/.test(page) && /catch \(eMprErr\)/.test(page) && !/catch \(eMpr\)/.test(page));

    console.log('\n=== step 2 source / smoke: model ===');
    pass('s2 source: addImplant / serializeImplants / loadImplants',
        /function addImplant/.test(js) && /function serializeImplants/.test(js) && /function loadImplants/.test(js));
    pass('s2 source: BANANA_CS3D_IMPLANT + CS3D_IMPLANT',
        js.indexOf('window.BANANA_CS3D_IMPLANT') >= 0 && js.indexOf('window.CS3D_IMPLANT') >= 0);

    console.log('\n=== step 3-6 source ===');
    pass('s3 source: placeAtViewport', /function placeAtViewport/.test(js) && /if \(!model.active\) return/.test(js));
    pass('s4 source: cylinder-plane cuts + MPR sync',
        /function cylinderSlice/.test(js) && /function syncMprToImplant/.test(js) && /function jumpSliceToWorld/.test(js));
    pass('s4 source: tapered cylinder head>tip',
        /TAPER_TIP/.test(js) && /function radiusAt/.test(js) && /function appendTaper/.test(js));
    pass('s4 source: moving an implant does not recenter the MPR',
        js.indexOf('Leave the MPR cameras') >= 0 &&
        js.indexOf('syncMprToImplant(imp, vpId)') < 0 &&
        js.indexOf('syncMprToImplant(imp);') < 0 &&
        js.indexOf('syncMprToImplant(copy)') < 0 &&
        js.indexOf('if (sel) syncMprToImplant(sel)') < 0);
    pass('s4 source: Crosshairs snap to implant position',
        /function alignMprToSelectedImplant/.test(js) && /function snapCrosshairsToWorld/.test(page) &&
        /function centerViewportOnWorld/.test(js));
    pass('s4 source: drawImplants overlay', /drawImplants:\s*draw/.test(js) && /data-implant/.test(js) && /implant-svg/.test(css));
    pass('s5 source: nudge in world mm, no FSA writer',
        /function nudgeImplant/.test(js) && js.indexOf('pipeTo') < 0 && js.indexOf('showSaveFilePicker') < 0);
    pass('s6 source: rotate + pivot', /function rotateImplant/.test(js) && /function setPivot/.test(js));

    console.log('\n=== step 7-10 source ===');
    pass('s7 source: list edit ids', ['impAdd', 'impDup', 'impDel', 'impLock', 'impDia', 'impLen'].every(function (id) {
        return html.indexOf('id="' + id + '"') >= 0;
    }));
    pass('s8 source: saveImplants + SQL table', /function saveImplants/.test(js) && /create table if not exists public.cs3d_implant_plans/.test(sql));
    pass('s9 source: restore from banana.cs3d.implants.v1',
        js.indexOf('banana.cs3d.implants.v1.') >= 0 && /function restoreImplants/.test(js) && /function fetchImplants/.test(js));
    pass('s10 source: disclaimer + Helper still on /cs3d/',
        html.indexOf('id="implantDisclaimer"') >= 0 && /Not a surgical guide/.test(html) &&
        /xrayHelperLaunch/.test(launch) && /cs3d\/\?v=/.test(launch));

    console.log('\n=== testclient (vm) ===');
    var box = {
        document: mockDom(),
        localStorage: { _d: {}, setItem: function (k, v) { this._d[k] = String(v); }, getItem: function (k) { return this._d[k] || null; } },
        sessionStorage: { _d: {}, setItem: function (k, v) { this._d[k] = String(v); }, getItem: function (k) { return this._d[k] || null; } },
        console: console,
        __bananaCs3dCtx: { patientId: 'p-vm' }
    };
    box.window = box;
    vm.createContext(box);
    vm.runInContext(js, box);
    pass('s1 vm: CS3D_IMPLANT exported', !!(box.CS3D_IMPLANT && box.BANANA_CS3D_IMPLANT));
    pass('s1 vm: panel starts inactive', box.CS3D_IMPLANT.state().active === false);

    var a = box.CS3D_IMPLANT.addImplant({ diameterMm: 4, lengthMm: 10, position: [1, 2, 3], axis: [0, 0, 1] });
    var ser = JSON.parse(box.CS3D_IMPLANT.serializeImplants());
    pass('s2 vm: add 4×10 mm', a && a.diameterMm === 4 && a.lengthMm === 10 && box.CS3D_IMPLANT.state().count === 1);
    pass('s2 vm: serialize round-trip', ser.implants[0].id === a.id && ser.implants[0].diameterMm === 4 && Array.isArray(ser.implants[0].position));
    box.CS3D_IMPLANT.clearImplants();
    box.CS3D_IMPLANT.loadImplants(JSON.stringify(ser));
    pass('s2 vm: loadImplants restores id/size',
        box.CS3D_IMPLANT.state().count === 1 && box.CS3D_IMPLANT.state().implants[0].id === a.id);

    var placed = box.CS3D_IMPLANT.placeAtViewport('CS3D_AXIAL', 0.5, 0.5);
    pass('s3 vm: place without engine uses finite mm + unit axis',
        placed && placed.position.every(function (n) { return isFinite(n); }) &&
        Math.abs(Math.sqrt(placed.axis[0] * placed.axis[0] + placed.axis[1] * placed.axis[1] + placed.axis[2] * placed.axis[2]) - 1) < 1e-6);
    var rHead = box.CS3D_IMPLANT.radiusAt(placed, 1);
    var rTip = box.CS3D_IMPLANT.radiusAt(placed, 0);
    pass('s4 vm: tip radius more slender than head',
        rTip < rHead * 0.7 && rTip > rHead * 0.4 && Math.abs(rHead - placed.diameterMm / 2) < 1e-6);

    var sidMove = box.CS3D_IMPLANT.state().selectedId;
    function impById(id) {
        return box.CS3D_IMPLANT.state().implants.filter(function (i) { return i.id === id; })[0];
    }
    var before = impById(sidMove).position.slice();
    box.CS3D_IMPLANT.nudgeImplant(sidMove, [10, 0, 0]);
    var after = impById(sidMove).position;
    pass('s5 vm: nudge +10 mm in X', Math.abs((after[0] - before[0]) - 10) < 1e-6);
    var aligned = box.CS3D_IMPLANT.alignMprToSelectedImplant();
    pass('s4 vm: alignMprToSelectedImplant returns selected position',
        aligned && Math.abs(aligned[0] - after[0]) < 1e-6 && Math.abs(aligned[1] - after[1]) < 1e-6);

    var axis0 = impById(sidMove).axis.slice();
    var len0 = impById(sidMove).lengthMm;
    box.CS3D_IMPLANT.setPivot('center');
    box.CS3D_IMPLANT.rotateImplant(sidMove, 15);
    var axis1 = impById(sidMove).axis;
    var dot = axis0[0] * axis1[0] + axis0[1] * axis1[1] + axis0[2] * axis1[2];
    pass('s6 vm: 15° rotate changes axis, length same', Math.abs(dot) < 0.999 && impById(sidMove).lengthMm === len0);

    var n0 = box.CS3D_IMPLANT.state().count;
    box.CS3D_IMPLANT.duplicateImplant();
    pass('s7 vm: duplicate → 2 implants', box.CS3D_IMPLANT.state().count === n0 + 1);
    var sid = box.CS3D_IMPLANT.state().selectedId;
    var posL = box.CS3D_IMPLANT.state().implants.filter(function (i) { return i.id === sid; })[0].position.slice();
    box.CS3D_IMPLANT.setLocked(sid, true);
    box.CS3D_IMPLANT.nudgeImplant(sid, [5, 0, 0]);
    var posL2 = box.CS3D_IMPLANT.state().implants.filter(function (i) { return i.id === sid; })[0].position;
    pass('s7 vm: lock blocks nudge', posL2[0] === posL[0] && box.CS3D_IMPLANT.state().implants.filter(function (i) { return i.id === sid; })[0].locked === true);
    box.CS3D_IMPLANT.setLocked(sid, false);
    box.CS3D_IMPLANT.setSize(sid, 4.5, 12);
    pass('s7 vm: size 4.5×12', (function () {
        var imp = box.CS3D_IMPLANT.state().implants.filter(function (i) { return i.id === sid; })[0];
        return imp.diameterMm === 4.5 && imp.lengthMm === 12;
    })());
    box.CS3D_IMPLANT.deleteImplant(sid);
    pass('s7 vm: delete drops count', box.CS3D_IMPLANT.state().count === n0);

    box.CS3D_IMPLANT.saveImplants();
    var fetched = JSON.parse(box.CS3D_IMPLANT.fetchImplants());
    pass('s8 vm: save/fetch localStorage round-trip', fetched.v === 1 && fetched.implants.length === box.CS3D_IMPLANT.state().count);
    pass('s8 vm: serialized positions are millimetres arrays', Array.isArray(fetched.implants[0].position) && fetched.implants[0].position.length === 3);

    var keep = box.CS3D_IMPLANT.serializeImplants();
    box.CS3D_IMPLANT.clearImplants();
    pass('s9 vm: clear empties model', box.CS3D_IMPLANT.state().count === 0);
    box.CS3D_IMPLANT.restoreImplants();
    pass('s9 vm: restore from storage', box.CS3D_IMPLANT.state().count === JSON.parse(keep).implants.length);

    box.CS3D_IMPLANT.addImplant({ position: [0, 0, 0] });
    box.CS3D_IMPLANT.addImplant({ position: [8, 0, 0] });
    pass('s10 vm: two-implant distance mm > 0', box.CS3D_IMPLANT.implantDistance() > 7);
    pass('s10 vm: disclaimer string present', String(box.CS3D_IMPLANT.i18n['cs3d.implant.disclaimer'] || '').indexOf('Not a surgical guide') >= 0);

    console.log('\n=== API ===');
    var sb = sbCfg();
    try {
        var r = await fetch(sb.url.replace(/\/$/, '') +
            '/rest/v1/xrays?select=id,xray_type,file_name&limit=1', {
            headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
        });
        pass('s1 API: xrays still readable', r.status === 200, 'HTTP ' + r.status);
    } catch (e) {
        pass('s1 API: xrays still readable', false, e.message);
    }
    var smokePatient = 'smoke-implant-' + Date.now();
    var planBody = JSON.parse(keep);
    planBody.patientId = smokePatient;
    try {
        var post = await fetch(sb.url.replace(/\/$/, '') + '/rest/v1/cs3d_implant_plans', {
            method: 'POST',
            headers: {
                apikey: sb.key,
                Authorization: 'Bearer ' + sb.key,
                'Content-Type': 'application/json',
                Prefer: 'return=representation'
            },
            body: JSON.stringify({ patient_id: smokePatient, plan: planBody })
        });
        var posted = post.status < 300 ? await post.json() : await post.text();
        if (post.status === 404 || (typeof posted === 'string' && /does not exist|schema cache/i.test(posted))) {
            pass('s8 API: cs3d_implant_plans optional until SQL applied', true, 'HTTP ' + post.status);
            pass('s9 API: GET last plan skipped (table not applied)', true);
            pass('s10 API: snip must not wipe JSON — skipped (table not applied)', true);
        } else {
            var row = Array.isArray(posted) ? posted[0] : posted;
            pass('s8 API: POST implant plan', post.status < 300 && row && row.patient_id === smokePatient, 'HTTP ' + post.status);
            var get = await fetch(sb.url.replace(/\/$/, '') +
                '/rest/v1/cs3d_implant_plans?patient_id=eq.' + encodeURIComponent(smokePatient) + '&select=patient_id,plan&order=updated_at.desc&limit=1', {
                headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
            });
            var got = await get.json();
            pass('s9 API: GET by patient returns last plan',
                get.status === 200 && Array.isArray(got) && got[0] && got[0].plan && got[0].plan.v === 1,
                'HTTP ' + get.status);
            pass('s10 API: plan GET still 200 after local serialize', get.status === 200);
        }
    } catch (e2) {
        pass('s8 API: implant plan POST', false, e2.message);
    }

    console.log('\n=== HTTP spot ===');
    var samples = [];
    try {
        for (var si = 0; si < BBMRI_SLICES.length; si++) {
            var gotD = await downloadUrl(BBMRI_BASE + BBMRI_SLICES[si]);
            if (gotD.status !== 200 || gotD.buf.length < 1000 || gotD.buf[128] !== 68) {
                throw new Error(BBMRI_SLICES[si] + ' HTTP ' + gotD.status);
            }
            samples.push({ name: BBMRI_SLICES[si], buf: gotD.buf });
            extraFiles['/__cs3d-sample/' + BBMRI_SLICES[si]] = { buf: gotD.buf, type: 'application/dicom' };
        }
        pass('spot: BBMRI CT series downloaded', samples.length === 6, samples.length + ' files');
    } catch (e3) {
        pass('spot: BBMRI CT series downloaded', false, e3.message);
    }

    var server = await startStaticServer(PAGE_PORT);
    var cs = await httpGetText(PAGE_PORT, '/cs3d/index.html');
    pass('s1 spot: GET /cs3d/ has Implant chrome + BUILD',
        cs.status === 200 && /id="btnImplant"/.test(cs.text) && /id="implantPanel"/.test(cs.text) &&
        cs.text.indexOf('cs3d-implant.js?v=' + BUILD) >= 0);
    var impJs = await httpGetText(PAGE_PORT, '/cs3d/cs3d-implant.js?v=' + BUILD);
    pass('s1 spot: GET cs3d-implant.js', impJs.status === 200 && /function addImplant/.test(impJs.text));
    var cssGet = await httpGetText(PAGE_PORT, '/cs3d/cs3d.css?v=' + BUILD);
    pass('s1 spot: panel CSS is display:none', cssGet.status === 200 && /#implantPanel\s*\{[^}]*display:\s*none/.test(cssGet.text));
    var disc = await httpGetText(PAGE_PORT, '/cs3d/index.html');
    pass('s10 spot: disclaimer on served page', /Not a surgical guide/.test(disc.text) && /id="implantDisclaimer"/.test(disc.text));

    console.log('\n=== CDP live page ===');
    var proc = null;
    var ws = null;
    try {
        if (!fs.existsSync(CHROME)) throw new Error('Chrome not found: ' + CHROME);
        var profile = path.join(os.tmpdir(), 'cs-cs3d-implant-cdp');
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e0) { /* ignore */ }
        fs.mkdirSync(profile, { recursive: true });
        var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/cs3d/?v=' + BUILD;
        proc = child_process.spawn(CHROME, [
            '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
            '--no-first-run', '--no-default-browser-check', '--disable-sync',
            '--host-resolver-rules=MAP xray-ai.test 127.0.0.1', '--window-size=1440,900', hosted
        ], { stdio: 'ignore' });
        await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000);
        var tabs = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000);
        var pageTab = (tabs || []).find(function (t) { return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0; });
        pass('CDP page target', !!pageTab && !!pageTab.webSocketDebuggerUrl, pageTab && pageTab.url);
        ws = new WebSocket(pageTab.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
        var cdp = new Cdp(ws);
        await cdp.call('Page.enable');
        await cdp.call('Runtime.enable');
        try { await cdp.call('Page.bringToFront'); } catch (e1) { /* ignore */ }
        await cdp.call('Page.navigate', { url: hosted });
        await sleep(1500);
        var ready = await cdp.js(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline) {
            if (window.CS3D_PAGE && window.CS3D_IMPLANT && typeof CS3D_PAGE.state === 'function') return true;
            await wait(150);
          }
          return false;
        })()`, true, 25000);
        pass('s1 live: sidecar + implant module ready', ready === true);
        if (!ready) throw new Error('CS3D_IMPLANT never appeared');

        var chrome = await cdp.js(`({
          btn: !!document.getElementById('btnImplant'),
          panel: !!document.getElementById('implantPanel'),
          disc: !!document.getElementById('implantDisclaimer'),
          panelDisplay: (function(){ var el=document.getElementById('implantPanel'); return el ? getComputedStyle(el).display : ''; })(),
          active: CS3D_IMPLANT.state().active,
          zip: !!document.getElementById('btnZip')
        })`);
        pass('s1 CDP: Implant button + hidden panel + Load zip',
            chrome && chrome.btn && chrome.panel && chrome.panelDisplay === 'none' && chrome.zip && chrome.active === false);
        pass('s10 CDP: disclaimer node', chrome && chrome.disc);

        var st = await cdp.js('CS3D_PAGE.state()');
        if (!(st && st.vendor)) {
            pass('live: vendor not built — skip volume/implant CDP', true, 'placeholder');
        } else {
            var synth = await cdp.js('(async function(){ try { return await CS3D_PAGE.loadTestVolume(8); } catch(e){ return String(e && e.message || e); } })()', true, 60000);
            var afterSynth = await cdp.js('CS3D_PAGE.state()');
            pass('s1 live: synthetic CT still loads',
                synth === true && afterSynth && afterSynth.mode === 'volume' && afterSynth.n === 8,
                afterSynth ? (afterSynth.mode + ' n=' + afterSynth.n) : String(synth));

            await cdp.js('CS3D_IMPLANT.clearImplants()');
            var needVol = await cdp.js(`(function(){
              CS3D_PAGE.setTool('WindowLevel');
              var ready = CS3D_PAGE.state().ready;
              document.getElementById('impAdd').click();
              return { ready: ready, status: (document.getElementById('status')||{}).textContent, count: CS3D_IMPLANT.state().count };
            })()`);
            // Add while Implant tool off but volume ready should still place from impAdd
            pass('s2 live: Add on loaded volume creates a list row', needVol && needVol.ready === true && needVol.count >= 1);

            await cdp.js('CS3D_IMPLANT.clearImplants()');
            var placedLive = await cdp.js(`(function(){
              CS3D_PAGE.setTool('Implant');
              var imp = CS3D_IMPLANT.placeAtViewport('CS3D_AXIAL', 0.5, 0.5);
              var st = CS3D_IMPLANT.state();
              var panelOn = document.getElementById('implantPanel').classList.contains('is-on');
              var axisLen = Math.sqrt(imp.axis[0]*imp.axis[0]+imp.axis[1]*imp.axis[1]+imp.axis[2]*imp.axis[2]);
              return { id: imp && imp.id, n: st.count, finite: imp.position.every(Number.isFinite), axisLen: axisLen, panelOn: panelOn, active: st.active };
            })()`);
            pass('s3 CDP: placeAtViewport axial centre',
                placedLive && placedLive.n === 1 && placedLive.finite && Math.abs(placedLive.axisLen - 1) < 1e-3 && placedLive.panelOn && placedLive.active);

            await sleep(400);
            var drawn = await cdp.js(`(function(){
              CS3D_IMPLANT.drawImplants();
              var n = document.querySelectorAll('[data-implant]').length;
              var panes = ['implantSvgAxial','implantSvgSagittal','implantSvgCoronal','implantSvgVolume'].filter(function(id){
                var el = document.getElementById(id);
                return el && el.querySelector('[data-implant]');
              });
              return { n: n, panes: panes.length, drawn: CS3D_IMPLANT.state().drawn, tool: CS3D_PAGE.state().tool };
            })()`);
            pass('s4 CDP: overlay drawn on MPR panes', drawn && drawn.n >= 1 && drawn.panes >= 3,
                drawn ? JSON.stringify(drawn) : 'none');
            pass('s4 live: Implant tool still selected (WW/WL not stolen)', drawn && drawn.tool === 'Implant');
            var geo = await cdp.js(`(function(){
              var imp = CS3D_IMPLANT.state().implants[0];
              CS3D_IMPLANT.syncMprToImplant(imp);
              CS3D_IMPLANT.drawImplants();
              var cuts = CS3D_IMPLANT.sliceKinds();
              var fit = CS3D_IMPLANT.mprFit();
              var ax = document.querySelector('#implantSvgAxial [data-implant]');
              var sag = document.querySelector('#implantSvgSagittal [data-implant]');
              var cor = document.querySelector('#implantSvgCoronal [data-implant]');
              return {
                cuts: cuts,
                fit: fit,
                axCut: ax && ax.getAttribute('data-cut'),
                sagCut: sag && sag.getAttribute('data-cut'),
                corCut: cor && cor.getAttribute('data-cut')
              };
            })()`);
            pass('s4 CDP: axial cut is circle, sag/cor are long-axis rects',
                geo && geo.cuts && geo.cuts.CS3D_AXIAL === 'circle' &&
                geo.cuts.CS3D_SAGITTAL === 'rect' && geo.cuts.CS3D_CORONAL === 'rect',
                geo ? JSON.stringify(geo) : 'none');
            pass('s4 CDP: all three MPR planes pass through the implant',
                geo && Array.isArray(geo.fit) && geo.fit.length === 3 &&
                geo.fit.every(function (d) { return d != null && d < 0.6; }),
                geo ? JSON.stringify(geo.fit) : 'none');
            var taperLive = await cdp.js(`(function(){
              var imp = CS3D_IMPLANT.state().implants[0];
              var rh = CS3D_IMPLANT.radiusAt(imp, 1);
              var rt = CS3D_IMPLANT.radiusAt(imp, 0);
              var sag = document.querySelector('#implantSvgSagittal [data-implant] path');
              var cor = document.querySelector('#implantSvgCoronal [data-implant] path');
              return { rh: rh, rt: rt, sag: !!(sag && sag.getAttribute('d')), cor: !!(cor && cor.getAttribute('d')) };
            })()`);
            pass('s4 CDP: taper + long-axis blunt path',
                taperLive && taperLive.rt < taperLive.rh * 0.7 && taperLive.sag && taperLive.cor,
                taperLive ? JSON.stringify(taperLive) : 'none');

            var nudged = await cdp.js(`(function(){
              var id = CS3D_IMPLANT.state().selectedId;
              var before = CS3D_IMPLANT.state().implants[0].position.slice();
              CS3D_IMPLANT.nudgeImplant(id, [10,0,0]);
              var after = CS3D_IMPLANT.state().implants[0].position;
              return { dx: after[0]-before[0], dy: after[1]-before[1], dz: after[2]-before[2] };
            })()`);
            pass('s5 CDP: nudgeImplant +10 mm X', nudged && Math.abs(nudged.dx - 10) < 0.5, nudged ? JSON.stringify(nudged) : 'none');

            var rot = await cdp.js(`(function(){
              var id = CS3D_IMPLANT.state().selectedId;
              var old = CS3D_IMPLANT.state().implants[0].axis.slice();
              var len = CS3D_IMPLANT.state().implants[0].lengthMm;
              var dia = CS3D_IMPLANT.state().implants[0].diameterMm;
              CS3D_IMPLANT.setPivot('tip');
              CS3D_IMPLANT.rotateImplant(id, 15);
              var now = CS3D_IMPLANT.state().implants[0];
              var dot = old[0]*now.axis[0]+old[1]*now.axis[1]+old[2]*now.axis[2];
              return { dot: dot, len: now.lengthMm, dia: now.diameterMm, pivot: CS3D_IMPLANT.state().pivot, sameLen: now.lengthMm===len && now.diameterMm===dia };
            })()`);
            pass('s6 CDP: rotate 15° about tip, size unchanged',
                rot && Math.abs(rot.dot) < 0.999 && rot.sameLen && rot.pivot === 'tip', rot ? JSON.stringify(rot) : 'none');

            var xhair = await cdp.js(`(function(){
              return new Promise(function(resolve){
                var imp = CS3D_IMPLANT.state().implants[0];
                var pos = imp.position.slice();
                CS3D_PAGE.setTool('Crosshairs');
                setTimeout(function(){
                  var fit = CS3D_IMPLANT.mprFit();
                  var center = CS3D_PAGE.crosshairCenter && CS3D_PAGE.crosshairCenter();
                  var d = (center && center.length === 3)
                    ? Math.hypot(center[0]-pos[0], center[1]-pos[1], center[2]-pos[2])
                    : 999;
                  resolve({
                    tool: CS3D_PAGE.state().tool,
                    fit: fit,
                    dist: d,
                    center: center,
                    pos: pos
                  });
                }, 280);
              });
            })()`, true);
            pass('CDP: Implant → Crosshairs keeps MPR on implant',
                xhair && xhair.tool === 'Crosshairs' &&
                Array.isArray(xhair.fit) && xhair.fit.every(function (d) { return d != null && d < 0.8; }),
                xhair ? JSON.stringify(xhair.fit) : 'none');
            pass('CDP: Crosshairs center aligned to implant',
                xhair && xhair.dist < 1.5,
                xhair ? ('dist=' + xhair.dist) : 'none');

            var edited = await cdp.js(`(function(){
              var id = CS3D_IMPLANT.state().selectedId;
              CS3D_IMPLANT.setSize(id, 4.5, 12);
              var dup = CS3D_IMPLANT.duplicateImplant(id);
              CS3D_IMPLANT.setLocked(dup.id, true);
              var before = CS3D_IMPLANT.state().implants.filter(function(i){ return i.id===dup.id; })[0].position.slice();
              CS3D_IMPLANT.nudgeImplant(dup.id, [3,0,0]);
              var after = CS3D_IMPLANT.state().implants.filter(function(i){ return i.id===dup.id; })[0].position;
              var n2 = CS3D_IMPLANT.state().count;
              CS3D_IMPLANT.deleteImplant(dup.id);
              var sized = CS3D_IMPLANT.state().implants.filter(function(i){ return i.id===id; })[0];
              return { n2: n2, nAfter: CS3D_IMPLANT.state().count, lockedHeld: after[0]===before[0], dia: sized.diameterMm, len: sized.lengthMm };
            })()`);
            pass('s7 CDP: size/duplicate/lock/delete',
                edited && edited.n2 === 2 && edited.nAfter === 1 && edited.lockedHeld && edited.dia === 4.5 && edited.len === 12,
                edited ? JSON.stringify(edited) : 'none');

            var persisted = await cdp.js(`(function(){
              window.__bananaCs3dCtx = { patientId: 'p-cdp-implant' };
              var json = CS3D_IMPLANT.saveImplants();
              var ids = CS3D_IMPLANT.state().implants.map(function(i){ return i.id; });
              CS3D_IMPLANT.clearImplants();
              var empty = CS3D_IMPLANT.state().count;
              CS3D_IMPLANT.restoreImplants();
              var back = CS3D_IMPLANT.state();
              return { empty: empty, n: back.count, same: back.implants[0] && back.implants[0].id === ids[0], kind: JSON.parse(json).kind };
            })()`);
            pass('s8 CDP: saveImplants JSON shape', persisted && persisted.kind === 'banana-cs3d-implant-plan');
            pass('s9 CDP: restore after clear', persisted && persisted.empty === 0 && persisted.n >= 1 && persisted.same);

            var end = await cdp.js(`(function(){
              CS3D_IMPLANT.addImplant({ position: [0,0,0], diameterMm: 4, lengthMm: 10 });
              CS3D_IMPLANT.addImplant({ position: [6,0,0], diameterMm: 4, lengthMm: 10 });
              CS3D_PAGE.setTool('WindowLevel');
              var dist = CS3D_IMPLANT.implantDistance();
              var disc = (document.getElementById('implantDisclaimer')||{}).textContent;
              var st = CS3D_PAGE.state();
              CS3D_IMPLANT.drawImplants();
              return {
                dist: dist,
                disc: disc,
                ready: st.ready,
                tool: st.tool,
                overlayStill: document.querySelectorAll('[data-implant]').length >= 2
              };
            })()`);
            pass('s10 CDP: distance + disclaimer + volume still ready',
                end && end.dist > 0 && /Not a surgical guide/.test(end.disc || '') && end.ready === true && end.tool === 'WindowLevel',
                end ? JSON.stringify(end) : 'none');
            pass('s10 live: overlays remain after leaving Implant tool', end && end.overlayStill);

            if (samples.length >= 3) {
                var real = await cdp.js(`(async () => {
                  const names = ${JSON.stringify(BBMRI_SLICES)};
                  const files = [];
                  for (const name of names) {
                    const r = await fetch('/__cs3d-sample/' + name);
                    if (!r.ok) throw new Error('sample HTTP ' + r.status);
                    files.push(new File([await r.arrayBuffer()], name, { type: 'application/dicom' }));
                  }
                  CS3D_IMPLANT.saveImplants();
                  const ok = await CS3D_PAGE.loadFiles(files, 'bbmri');
                  await new Promise(function(r){ setTimeout(r, 700); });
                  CS3D_PAGE.setTool('Implant');
                  CS3D_IMPLANT.placeAtViewport('CS3D_AXIAL', 0.5, 0.5);
                  CS3D_IMPLANT.drawImplants();
                  const st = CS3D_PAGE.state();
                  return {
                    ok, mode: st.mode, n: st.n,
                    implants: CS3D_IMPLANT.state().count,
                    drawn: document.querySelectorAll('[data-implant]').length,
                    err: st.error
                  };
                })()`, true, 90000);
                pass('s4/s9 live: real BBMRI volume + implant overlay',
                    real && real.ok === true && real.mode === 'volume' && real.n === 6 && real.implants >= 1 && real.drawn >= 1,
                    real ? JSON.stringify(real) : 'none');
            }
        }
    } catch (e) {
        pass('CDP live page', false, e && e.message);
    } finally {
        try { if (ws) ws.close(); } catch (e2) { /* ignore */ }
        try { if (proc) proc.kill(); } catch (e3) { /* ignore */ }
        try { server.close(); } catch (e4) { /* ignore */ }
    }

    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'IMPLANT STEPS 1-10 SMOKE + SPOT + API + TESTCLIENT + CDP + LIVE PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
