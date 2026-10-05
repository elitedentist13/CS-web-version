/**
 * Banana lateral cephalometric sidecar (same wiring as OHIF / CBCT).
 * Smoke + HTTP spot + API + testclient + CDP Runtime.evaluate / live page
 * + real clinic ceph import.
 * Run: node scripts/xray-ceph-smoke.js
 */
var fs = require('fs');
var http = require('http');
var https = require('https');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261005fx5';
var PAGE_PORT = 8803;
var CDP_PORT = 9371;
var CHROME = process.env.CHROME_PATH || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
var root = path.resolve(__dirname, '..');
var fails = [];
var extraFiles = {};

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
                resolve({ status: r.statusCode, body: Buffer.concat(d), type: r.headers['content-type'] || '' });
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

function downloadUrl(url) {
    return new Promise(function (resolve, reject) {
        https.get(url, function (r) {
            if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
                downloadUrl(r.headers.location).then(resolve, reject);
                return;
            }
            var chunks = [];
            r.on('data', function (c) { chunks.push(c); });
            r.on('end', function () {
                resolve({ status: r.statusCode, buf: Buffer.concat(chunks), type: r.headers['content-type'] || 'image/jpeg' });
            });
        }).on('error', reject);
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
    var types = {
        '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
        '.json': 'application/json', '.md': 'text/markdown',
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.bmp': 'image/bmp'
    };
    var server = http.createServer(function (req, res) {
        var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (extraFiles[urlPath]) {
            var ex = extraFiles[urlPath];
            res.writeHead(200, { 'Content-Type': ex.type, 'Content-Length': ex.buf.length });
            res.end(ex.buf);
            return;
        }
        if (urlPath.charAt(urlPath.length - 1) === '/') urlPath += 'index.html';
        if (urlPath === '/') urlPath = '/index.html';
        var file = path.normalize(path.join(root, urlPath));
        if (file.indexOf(root) !== 0) { res.writeHead(403); res.end('no'); return; }
        fs.readFile(file, function (err, buf) {
            if (err) { res.writeHead(404); res.end('missing ' + urlPath); return; }
            res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
            res.end(buf);
        });
    });
    return new Promise(function (resolve, reject) {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', function () { resolve(server); });
    });
}

function sbCfg() {
    var block = read('app.js').match(/supabase\.createClient\(([\s\S]*?)\);/);
    var parts = [], re = /'([^']*)'/g, m;
    while ((m = re.exec(block[1]))) parts.push(m[1]);
    return { url: parts[0], key: parts.slice(1).join('') };
}

var PAGE_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (window.CEPH_PAGE && typeof CEPH_LM !== 'undefined' && document.getElementById('view')) break;
    await wait(150);
  }
  const out = { ready: !!(window.CEPH_PAGE && window.CEPH_LM) };
  if (!out.ready) return out;
  const loaded = await CEPH_PAGE.loadUrl('/__ceph-sample.jpg', 'clinic-lateral.jpg');
  await wait(80);
  const st = CEPH_PAGE.state();
  out.loaded = !!(loaded && loaded.ok);
  out.via = loaded && loaded.via;
  out.source = st.source;
  out.imgW = st.imgW;
  out.imgH = st.imgH;
  out.nPts = st.nPts;
  out.sna = st.sna;
  out.groups = st.groups;
  out.inBounds = true;
  Object.keys(st.pts || {}).forEach((k) => {
    const p = st.pts[k];
    if (!p) return;
    if (p.x < -2 || p.y < -2 || p.x > st.imgW + 2 || p.y > st.imgH + 2) out.inBounds = false;
  });
  out.nSets = st.nSets;
  out.setIndex = st.setIndex;
  out.setIds = window.CEPH_PAGE && CEPH_PAGE.sets ? CEPH_PAGE.sets().map((s) => s.id).join(',') : '';
  if (window.CEPH_PAGE && typeof CEPH_PAGE.adoptSet === 'function') {
    CEPH_PAGE.adoptSet(0);
    out.set0 = CEPH_PAGE.state().source;
    CEPH_PAGE.adoptSet(2);
    out.set2 = CEPH_PAGE.state().source;
  }
  if (window.CEPH_LEARN && window.CEPH_PAGE) {
    CEPH_LEARN.useMemory();
    CEPH_PAGE.selectIds(['S', 'N']);
    const added = CEPH_PAGE.includeSelected();
    out.learnOk = !!(added && added.ok && added.films === 1);
    out.learnIncluded = added && added.included ? added.included.join(',') : '';
    out.learnPartial = !!(added && added.trace && added.trace.p && added.trace.p.filter((x) => x == null).length >= 2);
    CEPH_PAGE.setUseTraining(false);
    const afterOff = await CEPH_PAGE.runDetect();
    const stOff = CEPH_PAGE.state();
    out.learnOffVia = afterOff && afterOff.via;
    out.learnOffSource = stOff && stOff.source;
    out.learnOffUse = stOff && stOff.useTraining;
    CEPH_PAGE.setUseTraining(true);
    const after = await CEPH_PAGE.runDetect();
    const st2 = CEPH_PAGE.state();
    out.learnSource = st2 && st2.source;
    out.learnVia = after && after.via;
    out.learnClinic = st2 && st2.clinicFilms;
    out.learnPublished = st2 && st2.publishedFilms;
    out.learnPublishedSource = st2 && st2.publishedSource;
    out.learnTrainingSource = st2 && st2.trainingSource;
    out.learnUse = st2 && st2.useTraining;
  }
  return out;
})()`;

(async function () {
    var html = read('index.html');
    var launch = read('app-xray-ceph.js');
    var cat = JSON.parse(read('ceph/data/isbi2015.json'));
    var shapes = JSON.parse(read('ceph/data/shapes.json'));

    console.log('=== source ===');
    pass('index BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    pass('Ceph button is on the X-ray tab', html.indexOf('id="btnCephViewer"') >= 0 && html.indexOf('onclick="xrayCephViewerOpen()"') >= 0);
    pass('launcher is cache-busted after the CBCT module',
        html.indexOf("'app-xray-ceph.js?v=" + BUILD + "'") > html.indexOf("'app-xray-cbct.js?v=" + BUILD + "'"));
    pass('launcher opens ceph/ and starts Helper',
        /ceph\/\?v=/.test(launch) && /xrayHelperLaunch/.test(launch) && /banana\.ceph\.v1/.test(launch));
    pass('ceph.html forwards to the sidecar folder', /ceph\//.test(read('ceph.html')));
    pass('sidecar has load / auto-detect / export and a live-page hook',
        /btnDetect/.test(read('ceph/index.html')) && /window\.CEPH_PAGE/.test(read('ceph/ceph.js')));
    pass('sidecar lets staff opt in marked landmarks to clinic training',
        /btnLearn/.test(read('ceph/index.html')) && /CEPH_LEARN/.test(read('ceph/ceph-learn.js')) &&
        /includeSelected/.test(read('ceph/ceph.js')) && /clinicTrain/.test(read('ceph/ceph-learn.js')));
    pass('auto-detect uses the 1502-film mean plus a local edge snap',
        /isbi\+aariz\+pku-/.test(read('ceph/ceph-landmarks.js')) && /refinePts/.test(read('ceph/ceph-landmarks.js')) &&
        /shapes\.json/.test(read('ceph/ceph-landmarks.js')));
    pass('sidecar has an option to also take reference from clinic training',
        /btnUseTrain/.test(read('ceph/index.html')) && /setUseTraining/.test(read('ceph/ceph.js')) &&
        /useTraining/.test(read('ceph/ceph-landmarks.js')));
    pass('sidecar shows 5 auto-detect sets on a selection bar',
        /setBar/.test(read('ceph/index.html')) && /detectSets/.test(read('ceph/ceph-landmarks.js')) &&
        /adoptSet/.test(read('ceph/ceph.js')));
    var lmSrc = read('ceph/ceph-landmarks.js');
    pass('published 1502 k-NN stays separate from clinic training overlay',
        /placeTraining/.test(lmSrc) && /training:/.test(lmSrc) &&
        !/mergePublished/.test(lmSrc) && !/publishedPlusClinic/.test(lmSrc) && !/sh && sh\.clinic/.test(lmSrc));
    pass('ISBI 2015 catalog has 19 landmarks', cat.landmarks.length === 19 && cat.landmarks[0].id === 'S' && cat.landmarks[18].id === 'Ar');
    pass('catalog imported 400 ISBI + 1000 Aariz + 102 PKU films', cat.isbiFilms === 400 && cat.aarizFilms === 1000 && cat.pkuFilms === 102 && cat.importedFilms === 1502 && cat.landmarks[0].ix > 0.3 && cat.landmarks[1].ix > 0.6);
    pass('empirical mean SNA is near the Steiner norm', cat.meanSna > 80 && cat.meanSna < 86, String(cat.meanSna));
    pass('shapes.json has 1502 bbox-normalized tracings', shapes.n === 1502 && shapes.ids.length === 19 && shapes.shapes[0].p.length === 38);
    pass('dataset README points at Figshare PKU + GitHub Aariz + MIT analysis apps',
        /13265471/.test(read('ceph/data/README.md')) &&
        /manwaarkhd\/aariz/.test(read('ceph/data/README.md')) &&
        /alexcorvi\/cephalometric/.test(read('ceph/data/README.md')));
    pass('AI service has a /ceph/landmarks hook',
        /ceph\/landmarks/.test(read('xray-ai-service/main.py')));
    pass('AI service stores clinic training (not published 1502) at /ceph/reference',
        /ceph\/reference/.test(read('xray-ai-service/main.py')) &&
        /clinic_reference\.json/.test(read('xray-ai-service/ceph/reference.py')) &&
        /banana\.ceph\.clinicTrain/.test(read('xray-ai-service/ceph/reference.py')));

    console.log('\n=== testclient: analysis ===');
    var box = { window: {}, Math: Math, isFinite: isFinite };
    box.window = box;
    vm.createContext(box);
    vm.runInContext(read('ceph/ceph-analysis.js'), box);
    var pts = {
        S: { x: 400, y: 350 }, N: { x: 620, y: 270 }, A: { x: 640, y: 510 }, B: { x: 610, y: 630 },
        Pog: { x: 608, y: 700 }, Me: { x: 580, y: 740 }, Gn: { x: 600, y: 730 }, Go: { x: 370, y: 670 },
        Or: { x: 570, y: 390 }, Po: { x: 350, y: 400 }, U1: { x: 640, y: 550 }, L1: { x: 630, y: 600 },
        ANS: { x: 650, y: 480 }, PNS: { x: 470, y: 500 }, Ar: { x: 360, y: 470 }
    };
    var res = box.CEPH_AN.run(pts, 0.1);
    pass('Steiner SNA is a finite angle', res.groups[0].rows[0].value > 70 && res.groups[0].rows[0].value < 100, String(res.groups[0].rows[0].value));
    pass('five analysis groups', res.groups.map(function (g) { return g.id; }).join(',') === 'steiner,downs,tweed,wits,mcnamara');
    var meanPts = {};
    cat.landmarks.forEach(function (d) {
        meanPts[d.id] = { x: d.ix * 1935, y: d.iy * 2400 };
    });
    var meanRes = box.CEPH_AN.run(meanPts, 0.1);
    pass('400-film image mean SNA is 80–86°', meanRes.groups[0].rows[0].value >= 80 && meanRes.groups[0].rows[0].value <= 86,
        String(meanRes.groups[0].rows[0].value));

    console.log('\n=== testclient: clinic training (separate from 1502) ===');
    var Learn = { Math: Math, Date: Date, isFinite: isFinite, JSON: JSON };
    Learn.window = Learn;
    vm.createContext(Learn);
    vm.runInContext(read('ceph/ceph-learn.js'), Learn);
    Learn.CEPH_LEARN.useMemory();
    var none = Learn.CEPH_LEARN.includeSelected({ pts: {}, included: ['S'] });
    pass('refuses an empty opt-in', none && none.ok === false);
    var added = Learn.CEPH_LEARN.includeSelected({
        pts: { S: { x: 10, y: 12 }, N: { x: 40, y: 8 }, A: { x: 42, y: 50 } },
        included: ['S', 'N'],
        box: { x: 0, y: 0, w: 100, h: 80 }
    });
    pass('stores only the ticked landmarks', added && added.ok === true && added.films === 1 &&
        added.included.join(',') === 'S,N', added && added.included && added.included.join(','));
    var pArr = added.trace.p;
    pass('unticked landmarks are null in the stored shape', pArr && pArr[0] != null && pArr[2] != null && pArr[4] == null);
    pass('clinic training store is not the published library', added.trace && added.trace.clinic === true &&
        Learn.CEPH_LEARN.shapes().n === 1 && Learn.CEPH_LEARN.shapes().n !== 1502);
    var pubBefore = JSON.parse(read('ceph/data/shapes.json'));
    var placed = Learn.CEPH_LEARN.placeTraining({ x: 0, y: 0, w: 100, h: 80 });
    var pubAfter = JSON.parse(read('ceph/data/shapes.json'));
    pass('clinic-only placement covers ticked landmarks only', placed && placed.films === 1 &&
        placed.kind === 'banana.ceph.clinicTrain' && placed.ids.join(',') === 'S,N' &&
        placed.pts.S && placed.pts.N && !placed.pts.A);
    pass('overlay does not mutate published shapes.json (n stays 1502)',
        pubBefore.n === 1502 && pubAfter.n === 1502 && pubAfter.shapes.length === pubBefore.shapes.length &&
        !Learn.CEPH_LEARN.mergePublished);

    console.log('\n=== testclient: launcher ===');
    var L = {
        I18N_STRINGS: {}, t: function (k) { return k; },
        sessionStorage: { setItem: function (k, v) { L._s = v; }, getItem: function () { return L._s; } },
        localStorage: { setItem: function () {}, getItem: function () { return null; } },
        xrayPatientId: 'p1',
        xrayPatientData: { id: 'p1', patient_no: '88', full_name: 'Ceph Test' },
        xraySelected: { size: 0 },
        xrayHelperLaunch: function () { L._helper = true; },
        console: console
    };
    L.window = L;
    L.open = function (u) { L._url = u; return {}; };
    L.__JSM_BUILD = BUILD;
    vm.createContext(L);
    vm.runInContext(launch, L);
    var warned = false;
    L.xrayPatientId = '';
    L.xrayNotify = function () { warned = true; };
    L.xrayCephViewerOpen();
    pass('refuses to open without a patient', warned && !L._url);
    L.xrayPatientId = 'p1';
    L.xrayCephViewerOpen();
    pass('opens ceph/ and launches Helper', /ceph\/\?/.test(L._url || '') && L._helper === true, L._url);

    console.log('\n=== API (read-only, anon): real ceph films ===');
    var sb = sbCfg();
    var film = null;
    try {
        var r = await fetch(sb.url.replace(/\/$/, '') +
            '/rest/v1/xrays?select=id,xray_type,file_url,file_name&xray_type=eq.Cephalometric&limit=8', {
            headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
        });
        var rows = await r.json();
        pass('xrays table readable for Cephalometric', r.status === 200 && Array.isArray(rows) && rows.length > 0,
            'HTTP ' + r.status + ', n=' + (rows && rows.length));
        film = (rows || []).find(function (x) { return /lateral|DX_Lateral|ceph/i.test(x.file_name || '') && x.file_url; }) ||
            (rows || []).find(function (x) { return x.file_url; });
        pass('a clinic lateral ceph URL is available', !!film, film && film.file_name);
    } catch (e) {
        pass('xrays table readable for Cephalometric', false, e.message);
    }

    var sample = null;
    if (film && film.file_url) {
        try {
            sample = await downloadUrl(film.file_url);
            pass('real ceph JPEG/PNG downloaded', sample.status === 200 && sample.buf.length > 8000,
                'HTTP ' + sample.status + ', ' + sample.buf.length + ' bytes');
        } catch (e) {
            pass('real ceph JPEG/PNG downloaded', false, e.message);
        }
    }

    console.log('\n=== HTTP spot ===');
    if (sample && sample.buf) extraFiles['/__ceph-sample.jpg'] = { buf: sample.buf, type: sample.type || 'image/jpeg' };
    var server = await startStaticServer(PAGE_PORT);
    var idx = await httpGetText(PAGE_PORT, '/index.html');
    pass('GET /index.html has the Ceph button', idx.status === 200 && idx.body.indexOf('btnCephViewer') >= 0);
    var js = await httpGetText(PAGE_PORT, '/app-xray-ceph.js?v=' + BUILD);
    pass('GET /app-xray-ceph.js', js.status === 200 && /function xrayCephViewerOpen/.test(js.body.toString()));
    var page = await httpGetText(PAGE_PORT, '/ceph/');
    pass('GET /ceph/ is the sidecar', page.status === 200 && /btnDetect/.test(page.body.toString()) && /btnLearn/.test(page.body.toString()));
    var learnJs = await httpGetText(PAGE_PORT, '/ceph/ceph-learn.js');
    pass('GET /ceph/ceph-learn.js', learnJs.status === 200 && /includeSelected/.test(learnJs.body.toString()));
    var catGet = await httpGetText(PAGE_PORT, '/ceph/data/isbi2015.json');
    pass('GET /ceph/data/isbi2015.json', catGet.status === 200 && /"S"/.test(catGet.body.toString()) && /importedFilms/.test(catGet.body.toString()));
    var shGet = await httpGetText(PAGE_PORT, '/ceph/data/shapes.json');
    pass('GET /ceph/data/shapes.json', shGet.status === 200 && /"n":1502/.test(shGet.body.toString()));
    if (sample && sample.buf) {
        var samp = await httpGetText(PAGE_PORT, '/__ceph-sample.jpg');
        pass('GET /__ceph-sample.jpg serves the clinic film', samp.status === 200 && samp.body.length > 8000,
            samp.body.length + ' bytes');
    }

    console.log('\n=== CDP live page / Runtime.evaluate / real import ===');
    var proc = null;
    var ws = null;
    try {
        if (!sample || !sample.buf) throw new Error('no clinic ceph image to import');
        if (!fs.existsSync(CHROME)) throw new Error('Chrome not found: ' + CHROME);
        var profile = path.join(os.tmpdir(), 'cs-ceph-cdp');
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        fs.mkdirSync(profile, { recursive: true });
        var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/ceph/?_lr=' + BUILD;
        proc = child_process.spawn(CHROME, [
            '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
            '--no-first-run', '--no-default-browser-check', '--disable-sync',
            '--host-resolver-rules=MAP xray-ai.test 127.0.0.1', '--window-size=1440,900', hosted
        ], { stdio: 'ignore' });
        await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000);
        var tabs = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000);
        var tab = (tabs || []).find(function (t) { return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0; });
        pass('CDP page target', !!tab && !!tab.webSocketDebuggerUrl);
        ws = new WebSocket(tab.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
        var cdp = new Cdp(ws);
        await cdp.call('Page.enable');
        await cdp.call('Runtime.enable');
        try { await cdp.call('Page.bringToFront'); } catch (e) { /* ignore */ }
        await cdp.call('Page.navigate', { url: hosted });
        await sleep(1200);
        var live = await cdp.js(PAGE_SCRIPT, true, 60000);
        pass('live: sidecar ready', live && live.ready === true);
        pass('live: real clinic lateral imported', live && live.loaded === true && live.imgW > 200 && live.imgH > 200,
            live ? (live.imgW + 'x' + live.imgH + ' via=' + live.via) : 'none');
        pass('live: 19 landmarks placed inside the film', live && live.nPts === 19 && live.inBounds === true,
            live ? ('n=' + live.nPts + ' source=' + live.source) : 'none');
        pass('live: 5 auto-detect sets can be adopted from the selection bar',
            live && live.nSets === 5 && /imgmean/.test(String(live.set0 || '')) &&
            /imgmean\+edge/.test(String(live.set2 || '')) && live.set0 !== live.set2,
            live ? ('ids=' + live.setIds + ' 1=' + live.set0 + ' 3=' + live.set2) : 'none');
        pass('live: Steiner / Downs / Tweed / Wits / McNamara ran',
            live && live.groups && live.groups.join(',') === 'steiner,downs,tweed,wits,mcnamara' && live.sna != null,
            live ? ('SNA=' + live.sna) : 'none');
        pass('live: ticked S and N can be added to clinic training',
            live && live.learnOk === true && live.learnIncluded === 'S,N' && live.learnPartial === true,
            live ? ('films=' + live.learnClinic + ' src=' + live.learnSource) : 'none');
        pass('live: overlay stays off until Also use clinic training is turned on',
            live && live.learnOffUse === false && live.learnOffVia !== 'clinic' &&
            !/training:clinic-train-/.test(String(live.learnOffSource || '')),
            live ? ('off via=' + live.learnOffVia + ' src=' + live.learnOffSource) : 'none');
        pass('live: auto-detect overlays clinic training without mixing into 1502',
            live && live.learnUse === true && live.learnVia === 'clinic' && live.learnPublished === 1502 &&
            /isbi\+aariz\+pku-1502/.test(String(live.learnPublishedSource || live.learnSource || '')) &&
            /training:clinic-train-/.test(String(live.learnSource || '')) &&
            !/\+clinic-/.test(String(live.learnPublishedSource || '')),
            live ? ('via=' + live.learnVia + ' pub=' + live.learnPublishedSource + ' train=' + live.learnTrainingSource) : 'none');
    } catch (e) {
        pass('CDP live page', false, e && e.message ? e.message : String(e));
    } finally {
        try { if (ws) ws.close(); } catch (e) { /* ignore */ }
        try { if (proc) proc.kill(); } catch (e) { /* ignore */ }
        try { server.close(); } catch (e) { /* ignore */ }
    }

    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + API + CDP + LIVE PAGE + REAL CEPH IMPORT ALL PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
