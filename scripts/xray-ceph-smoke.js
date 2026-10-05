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

var BUILD = '20261005fx16';
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
  out.snaBand = st.snaBand;
  out.snaNorm = st.snaNorm;
  out.normSet = st.normSet;
  out.calibrated = st.calibrated;
  out.mmPerPx = st.mmPerPx;
  out.extraIds = st.extra ? Object.keys(st.extra).sort().join(',') : '';
  out.witsNote = '';
  try {
    const wits = (window.__cephLast && window.__cephLast.result && window.__cephLast.result.groups || [])
      .find((g) => g.id === 'wits');
    out.witsNote = wits && wits.rows && wits.rows[0] ? String(wits.rows[0].note || '') : '';
    const mc = (window.__cephLast && window.__cephLast.result && window.__cephLast.result.groups || [])
      .find((g) => g.id === 'mcnamara');
    out.nperpNote = mc && mc.rows && mc.rows[0] ? String(mc.rows[0].note || '') : '';
  } catch (e) { out.witsNote = ''; }
  out.groups = st.groups;
  out.summarySkeletal = st.summary && st.summary.skeletal;
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
    CEPH_PAGE.adoptSet(1);
    out.set1 = CEPH_PAGE.state().source;
    CEPH_PAGE.adoptSet(2);
    out.set2 = CEPH_PAGE.state().source;
    const locked = typeof CEPH_PAGE.lockAdopt === 'function' ? CEPH_PAGE.lockAdopt() : null;
    out.adopted = !!(locked && locked.ok);
    out.setBarHidden = !!(CEPH_PAGE.state() && CEPH_PAGE.state().setBarHidden);
  }
  if (window.CEPH_LEARN && window.CEPH_PAGE) {
    CEPH_LEARN.useMemory();
    const added = CEPH_PAGE.includeSelected();
    out.learnOk = !!(added && added.ok && added.films === 1 && added.included && added.included.length === 19);
    out.learnIncluded = added && added.included ? added.included.length : 0;
    out.learnWhole = !!(added && added.trace && added.trace.whole === true &&
        added.trace.p && added.trace.p.filter((x) => x == null).length === 0);
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
  if (window.CEPH_PAGE && typeof CEPH_PAGE.setNormSet === 'function') {
    CEPH_PAGE.setNormSet('caucasian');
    out.caucNorm = CEPH_PAGE.state().snaNorm;
    out.caucSet = CEPH_PAGE.state().normSet;
    CEPH_PAGE.setNormSet('chinese');
    out.cnNorm = CEPH_PAGE.state().snaNorm;
    out.cnSet = CEPH_PAGE.state().normSet;
    out.cnBand = CEPH_PAGE.state().snaBand;
  }
  if (window.CEPH_PAGE && typeof CEPH_PAGE.calibrate === 'function') {
    out.calBefore = CEPH_PAGE.state().calibrated === true;
    const cal = CEPH_PAGE.calibrate({ x: 100, y: 200 }, { x: 200, y: 200 }, 10);
    out.calOk = !!(cal && cal.ok);
    out.calMmPerPx = CEPH_PAGE.state().mmPerPx;
    out.calAfter = CEPH_PAGE.state().calibrated === true;
  }
  if (window.CEPH_PAGE && typeof CEPH_PAGE.highlightMeasure === 'function') {
    const hi = CEPH_PAGE.highlightMeasure('SNA');
    out.hiOk = !!(hi && hi.ok && hi.measure === 'SNA' && hi.planes && hi.planes.length >= 2);
    out.hiMeasure = CEPH_PAGE.state().hiMeasure;
    CEPH_PAGE.setInvert(true);
    out.invert = CEPH_PAGE.state().invert === true;
    CEPH_PAGE.setInvert(false);
  }
  if (window.CEPH_PAGE && typeof CEPH_PAGE.saveTrace === 'function') {
    const saved = CEPH_PAGE.saveTrace();
    out.saveOk = !!(saved && saved.ok && saved.key);
    const loaded = CEPH_PAGE.loadTrace();
    out.loadOk = !!(loaded && loaded.ok && loaded.nPts === 19);
    out.printFn = typeof CEPH_PAGE.printReport === 'function';
  }
  if (window.CEPH_PAGE && typeof CEPH_PAGE.setLabMode === 'function') {
    out.labOff = CEPH_PAGE.state().labOpen === false;
    CEPH_PAGE.setLabMode(true);
    out.labOn = CEPH_PAGE.state().labOpen === true;
    CEPH_PAGE.setLabMode(false);
    out.qa = CEPH_PAGE.state().qa;
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
    pass('sidecar lets staff add an adopted 19-point set to clinic training',
        /btnLearn/.test(read('ceph/index.html')) && /CEPH_LEARN/.test(read('ceph/ceph-learn.js')) &&
        /includeSelected/.test(read('ceph/ceph.js')) && /clinicTrain/.test(read('ceph/ceph-learn.js')) &&
        !/btnLearnTouched/.test(read('ceph/index.html')));
    pass('auto-detect uses the 1502-film mean plus a local edge snap',
        /isbi\+aariz\+pku-/.test(read('ceph/ceph-landmarks.js')) && /refinePts/.test(read('ceph/ceph-landmarks.js')) &&
        /shapes\.json/.test(read('ceph/ceph-landmarks.js')));
    pass('sidecar has Published 1502 vs Published + in-house reference modes',
        /btnRefPub/.test(read('ceph/index.html')) && /btnRefPlus/.test(read('ceph/index.html')) &&
        /setUseTraining/.test(read('ceph/ceph.js')) && /useTraining/.test(read('ceph/ceph-landmarks.js')));
    pass('sidecar shows 3 auto-detect sets and Adopt selection on a compact film bar',
        /setBar/.test(read('ceph/index.html')) && /btnAdoptSet/.test(read('ceph/index.html')) &&
        /lockAdopt/.test(read('ceph/ceph.js')) && /detectSets/.test(read('ceph/ceph-landmarks.js')));
    pass('sidecar has Caucasian vs HK Chinese norms with in/warn/out bands',
        /btnNormCn/.test(read('ceph/index.html')) && /btnNormCauc/.test(read('ceph/index.html')) &&
        /normSet/.test(read('ceph/ceph-analysis.js')) && /band-out/.test(read('ceph/ceph.css')) &&
        /Chan 1972/.test(read('ceph/ceph-analysis.js')));
    pass('sidecar calibrates millimetres from a two-click film ruler',
        /btnCalibrate/.test(read('ceph/index.html')) && /applyRuler/.test(read('ceph/ceph.js')) &&
        /not calibrated/.test(read('ceph/ceph-analysis.js')));
    pass('Wits uses FOP, N-perp uses Frankfort, IMPA uses draggable apices',
        /nPerpMm/.test(read('ceph/ceph-analysis.js')) && /witsMm/.test(read('ceph/ceph-analysis.js')) &&
        /FopA/.test(read('ceph/ceph.js')) && /L1a/.test(read('ceph/ceph.js')));
    pass('clicking a table row highlights that construction; zoom pan invert undo exist',
        /highlightMeasure/.test(read('ceph/ceph.js')) && /btnInvert/.test(read('ceph/index.html')) &&
        /btnUndoPt/.test(read('ceph/index.html')) && /viewZoom/.test(read('ceph/ceph.js')));
    pass('sidecar has a one-page clinical summary and Steiner S-line lips',
        /id="summary"/.test(read('ceph/index.html')) && /summarise/.test(read('ceph/ceph-analysis.js')) &&
        /Ls to Sn/.test(read('ceph/ceph-analysis.js')));
    pass('sidecar saves a patient tracing and can print a report',
        /btnSaveTrace/.test(read('ceph/index.html')) && /btnPrint/.test(read('ceph/index.html')) &&
        /savedTrace/.test(read('ceph/ceph.js')) && /@media print/.test(read('ceph/ceph.css')));
    pass('clinic mode hides training until Advanced; QA flags Go/Po/Or/Ar',
        /btnAdvanced/.test(read('ceph/index.html')) && /labOnly/.test(read('ceph/index.html')) &&
        /qaScan/.test(read('ceph/ceph.js')) && /is-qa/.test(read('ceph/ceph.css')));
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
    pass('five analysis groups plus soft tissue', res.groups.map(function (g) { return g.id; }).join(',') === 'steiner,downs,tweed,wits,mcnamara,soft');
    pass('one-page summary names skeletal class', !!(res.summary && res.summary.skeletal), res.summary && res.summary.skeletal);
    pass('Caucasian SNA norm is 82 ± 2', res.groups[0].rows[0].norm === '82 ± 2' && res.normSet === 'caucasian');
    var cn = box.CEPH_AN.run(pts, 0.1, { normSet: 'chinese' });
    pass('HK Chinese SNA norm is 83.8 ± 3.2', cn.normSet === 'chinese' && /83\.8/.test(cn.groups[0].rows[0].norm) &&
        cn.groups[0].rows[0].norm !== res.groups[0].rows[0].norm, cn.groups[0].rows[0].norm);
    pass('value 90 vs 82±2 is out of range', box.CEPH_AN.score(90, { mean: 82, sd: 2 }).band === 'out');
    pass('value 82 vs 82±2 is in range', box.CEPH_AN.score(82, { mean: 82, sd: 2 }).band === 'in');
    pass('value 85 vs 82±2 is warn (1–2 SD)', box.CEPH_AN.score(85, { mean: 82, sd: 2 }).band === 'warn');
    var witsNote = res.groups[3].rows[0].note || '';
    pass('linear mm rows stay untrusted until the film is calibrated',
        /not calibrated/.test(witsNote) && res.calibrated !== true);
    var calRes = box.CEPH_AN.run(pts, 0.1, { calibrated: true });
    pass('calibrated linear rows drop the not-calibrated stamp',
        calRes.calibrated === true && !/not calibrated/.test(String(calRes.groups[3].rows[0].note || '')));
    var imageX = Math.abs(pts.A.x - pts.N.x) * 0.1;
    var fhNperp = box.CEPH_AN.nPerpMm(pts.A, pts.N, pts.Po, pts.Or, 0.1);
    pass('N-perp is perpendicular to Frankfort, not image-x',
        fhNperp != null && Math.abs(fhNperp - imageX) > 0.05, 'fh=' + fhNperp + ' x=' + imageX);
    var proxyWits = box.CEPH_AN.witsMm(pts.A, pts.B, pts.U1, pts.L1, 0.1);
    var fopWits = box.CEPH_AN.witsMm(pts.A, pts.B, { x: 640, y: 575 }, { x: 560, y: 585 }, 0.1);
    pass('Wits on FOP can differ from the U1–L1 proxy',
        proxyWits != null && fopWits != null && Math.abs(proxyWits - fopWits) > 0.2,
        'proxy=' + proxyWits + ' fop=' + fopWits);
    var withApex = box.CEPH_AN.run(pts, 0.1, {
        extra: { L1a: { x: pts.L1.x - 20, y: pts.L1.y + 40 }, U1a: { x: pts.U1.x - 18, y: pts.U1.y + 38 } }
    });
    pass('IMPA uses the L1 apex handle when provided',
        /L1a/.test(withApex.groups[2].rows[1].note) && withApex.groups[2].rows[1].value != null);
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
        included: ['S'],
        box: { x: 0, y: 0, w: 100, h: 80 }
    });
    pass('stores the whole placed set, not a point-by-point tick list', added && added.ok === true && added.films === 1 &&
        added.included.join(',') === 'S,N,A' && added.trace.whole === true, added && added.included && added.included.join(','));
    var pArr = added.trace.p;
    pass('every placed landmark is stored (no partial ticks)', pArr && pArr[0] != null && pArr[2] != null && pArr[8] != null && pArr[4] == null);
    pass('clinic training store is not the published library', added.trace && added.trace.clinic === true &&
        Learn.CEPH_LEARN.shapes().n === 1 && Learn.CEPH_LEARN.shapes().n !== 1502);
    var pubBefore = JSON.parse(read('ceph/data/shapes.json'));
    var placed = Learn.CEPH_LEARN.placeTraining({ x: 0, y: 0, w: 100, h: 80 });
    var pubAfter = JSON.parse(read('ceph/data/shapes.json'));
    pass('clinic-only placement covers the whole stored set', placed && placed.films === 1 &&
        placed.kind === 'banana.ceph.clinicTrain' && placed.ids.join(',') === 'S,N,A' &&
        placed.pts.S && placed.pts.N && placed.pts.A);
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
        pass('live: 3 auto-detect sets can be viewed then adopted',
            live && live.nSets === 3 && /imgmean\+edge/.test(String(live.set0 || '')) &&
            /boxmean\+edge/.test(String(live.set1 || '')) && live.set0 !== live.set1 &&
            live.adopted === true && live.setBarHidden === true,
            live ? ('ids=' + live.setIds + ' 1=' + live.set0 + ' 2=' + live.set1 + ' hidden=' + live.setBarHidden) : 'none');
        pass('live: Steiner / Downs / Tweed / Wits / McNamara ran',
            live && live.groups && ['steiner', 'downs', 'tweed', 'wits', 'mcnamara'].every(function (id) {
                return live.groups.indexOf(id) >= 0;
            }) && live.sna != null,
            live ? ('SNA=' + live.sna + ' groups=' + (live.groups && live.groups.join(','))) : 'none');
        pass('live: clinical summary is filled',
            live && /Class/.test(String(live.summarySkeletal || '')),
            live ? ('skeletal=' + live.summarySkeletal) : 'none');
        pass('live: Caucasian vs HK Chinese norms colour the SNA row',
            live && live.caucSet === 'caucasian' && /82/.test(String(live.caucNorm || '')) &&
            live.cnSet === 'chinese' && /83\.8/.test(String(live.cnNorm || '')) &&
            live.caucNorm !== live.cnNorm && /^(in|warn|out)$/.test(String(live.cnBand || '')),
            live ? ('cauc=' + live.caucNorm + ' cn=' + live.cnNorm + ' band=' + live.cnBand) : 'none');
        pass('live: two-click ruler calibrates millimetres',
            live && live.calBefore === false && live.calOk === true && live.calAfter === true &&
            live.calMmPerPx === 0.1,
            live ? ('before=' + live.calBefore + ' mm/px=' + live.calMmPerPx) : 'none');
        pass('live: FOP and incisor-apex handles are on the tracing',
            live && live.extraIds === 'FopA,FopP,L1a,U1a' && /FOP/.test(String(live.witsNote || '')) &&
            /FH/.test(String(live.nperpNote || '')),
            live ? ('extra=' + live.extraIds + ' wits=' + live.witsNote) : 'none');
        pass('live: clicking SNA highlights SN and NA on the film',
            live && live.hiOk === true && live.hiMeasure === 'SNA' && live.invert === true,
            live ? ('hi=' + live.hiMeasure + ' invertWas=' + live.invert) : 'none');
        pass('live: tracing saves for this patient and can be restored',
            live && live.saveOk === true && live.loadOk === true && live.printFn === true,
            live ? ('save=' + live.saveOk + ' load=' + live.loadOk) : 'none');
        pass('live: Advanced training stays hidden until toggled',
            live && live.labOff === true && live.labOn === true,
            live ? ('off=' + live.labOff + ' on=' + live.labOn + ' qa=' + (live.qa && live.qa.join(','))) : 'none');
        pass('live: the adopted set is added as a whole 19-point film',
            live && live.learnOk === true && live.learnIncluded === 19 && live.learnWhole === true,
            live ? ('films=' + live.learnClinic + ' n=' + live.learnIncluded + ' src=' + live.learnSource) : 'none');
        pass('live: overlay stays off on published-1502 until Published + in-house is selected',
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
