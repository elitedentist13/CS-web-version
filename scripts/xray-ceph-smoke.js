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

var BUILD = '20261005fx41';
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
  out.profileN = st.profileN;
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
    const stn = (window.__cephLast && window.__cephLast.result && window.__cephLast.result.groups || [])
      .find((g) => g.id === 'steiner');
    const pick = (name) => {
      const r = stn && stn.rows && stn.rows.find((x) => x.name === name);
      return r ? r.value : null;
    };
    out.u1sn = pick('U1–SN');
    out.u1na = pick('U1–NA');
    out.u1naMm = pick('U1–NA mm');
    out.l1nb = pick('L1–NB');
    out.l1nbMm = pick('L1–NB mm');
    const rick = (window.__cephLast && window.__cephLast.result && window.__cephLast.result.groups || [])
      .find((g) => g.id === 'ricketts');
    const pickR = (name) => {
      const r = rick && rick.rows && rick.rows.find((x) => x.name === name);
      return r ? r.value : null;
    };
    out.u1apog = pickR('U1–APog');
    out.l1apogMm = pickR('L1–APog mm');
    const softG = (window.__cephLast && window.__cephLast.result && window.__cephLast.result.groups || [])
      .find((g) => g.id === 'soft');
    const pickS = (name) => {
      const r = softG && softG.rows && softG.rows.find((x) => x.name === name);
      return r ? r.value : null;
    };
    out.lsE = pickS('Ls to E-line');
    out.liE = pickS('Li to E-line');
    const jar = (window.__cephLast && window.__cephLast.result && window.__cephLast.result.groups || [])
      .find((g) => g.id === 'jarabak');
    const pickJ = (name) => {
      const r = jar && jar.rows && jar.rows.find((x) => x.name === name);
      return r ? r.value : null;
    };
    out.pfhAfh = pickJ('PFH/AFH');
    out.jsum = pickJ('Jarabak sum');
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
    out.set2 = '';
    const locked = typeof CEPH_PAGE.lockAdopt === 'function' ? CEPH_PAGE.lockAdopt() : null;
    out.adopted = !!(locked && locked.ok);
    out.setBarHidden = !!(CEPH_PAGE.state() && CEPH_PAGE.state().setBarHidden);
    out.walkAdoptOn = CEPH_PAGE.state().walkOn === true;
    out.walkAdoptId = CEPH_PAGE.state().walkId;
    if (typeof CEPH_PAGE.walkStop === 'function') CEPH_PAGE.walkStop();
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
    out.learnUse = st2 && st2.useTraining;
    if (typeof CEPH_PAGE.adoptSet === 'function') CEPH_PAGE.adoptSet(1);
    const stLib = CEPH_PAGE.state();
    out.learnLibSource = stLib && stLib.source;
    out.learnPublishedSource = stLib && stLib.publishedSource;
    out.learnTrainingSource = stLib && stLib.trainingSource;
  }
  if (window.CEPH_PAGE && typeof CEPH_PAGE.setNormSet === 'function') {
    CEPH_PAGE.setNormSet('caucasian');
    out.caucNorm = CEPH_PAGE.state().snaNorm;
    out.caucSet = CEPH_PAGE.state().normSet;
    CEPH_PAGE.setNormSet('chinese');
    out.cnNorm = CEPH_PAGE.state().snaNorm;
    out.cnSet = CEPH_PAGE.state().normSet;
    out.cnBand = CEPH_PAGE.state().snaBand;
    if (typeof CEPH_PAGE.setAgeBand === 'function') {
      CEPH_PAGE.setNormSet('caucasian');
      CEPH_PAGE.setAgeBand('adult');
      if (typeof CEPH_PAGE.setSexBand === 'function') CEPH_PAGE.setSexBand('');
      out.adultNorm = CEPH_PAGE.state().snaNorm;
      out.adultAge = CEPH_PAGE.state().ageBand;
      CEPH_PAGE.setAgeBand('child');
      out.childNorm = CEPH_PAGE.state().snaNorm;
      out.childAge = CEPH_PAGE.state().ageBand;
      CEPH_PAGE.setSexBand('f');
      out.childFNorm = CEPH_PAGE.state().snaNorm;
      out.childFSex = CEPH_PAGE.state().sexBand;
      CEPH_PAGE.setAgeBand('child');
      if (typeof CEPH_PAGE.setCvm === 'function') CEPH_PAGE.setCvm(3);
      out.cvmStage = CEPH_PAGE.state().cvm;
      out.cvmId = CEPH_PAGE.state().cvmId;
      out.cvmComment = CEPH_PAGE.state().cvmComment;
      out.cvmGroup = !!(CEPH_PAGE.state().groups && CEPH_PAGE.state().groups.indexOf('cvm') >= 0);
      if (typeof CEPH_PAGE.setCvm === 'function') CEPH_PAGE.setCvm(0);
      out.autoCvmBtn = !!document.getElementById('btnAutoCvm');
      out.autoCvmFn = typeof CEPH_PAGE.autoCvm === 'function';
      out.detectCvmApi = !!(window.CEPH_LM && typeof CEPH_LM.detectCvmApi === 'function');
      CEPH_PAGE.setAgeBand('adult');
      CEPH_PAGE.setSexBand('');
      CEPH_PAGE.setNormSet('chinese');
    }
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
    if (typeof CEPH_PAGE.setFilmLook === 'function') {
      const look = CEPH_PAGE.setFilmLook({ bright: 1.25, contrast: 1.15 });
      out.lookBright = look && look.bright;
      out.lookContrast = look && look.contrast;
      const fh = typeof CEPH_PAGE.setFhUp === 'function' ? CEPH_PAGE.setFhUp(true) : null;
      out.fhOn = !!(fh && fh.fhUp);
      out.fhDeg = !!(fh && Math.abs(fh.rotDeg) > 0.15);
      if (typeof CEPH_PAGE.setFhUp === 'function') CEPH_PAGE.setFhUp(false);
      CEPH_PAGE.setFilmLook({ bright: 1, contrast: 1 });
    }
    if (typeof CEPH_PAGE.setOverlay === 'function') {
      const src = JSON.parse(JSON.stringify(CEPH_PAGE.state().pts || {}));
      Object.keys(src).forEach((k) => {
        if (src[k] && typeof src[k].x === 'number') { src[k].x += 14; src[k].y += 9; }
      });
      const ov = CEPH_PAGE.setOverlay({ pts: src });
      out.ovOk = !!(ov && ov.ok && ov.n >= 19);
      const ovFh = typeof CEPH_PAGE.setOverlayMode === 'function' ? CEPH_PAGE.setOverlayMode('fh') : null;
      out.ovFh = !!(ovFh && ovFh.mode === 'fh' && ovFh.n >= 19);
      CEPH_PAGE.setOverlay(null);
      out.ovOff = CEPH_PAGE.state().overlayOn === false;
    }
    if (typeof CEPH_PAGE.startWalk === 'function') {
      const w0 = CEPH_PAGE.startWalk();
      out.walk0 = w0 && w0.id;
      out.walkN = w0 && w0.n;
      out.walkZoom = CEPH_PAGE.state().viewZoom > 1.4;
      const w1 = typeof CEPH_PAGE.walkNext === 'function' ? CEPH_PAGE.walkNext() : null;
      out.walk1 = w1 && w1.id;
      const w2 = typeof CEPH_PAGE.walkSkip === 'function' ? CEPH_PAGE.walkSkip() : null;
      out.walk2 = w2 && w2.id;
      const done = typeof CEPH_PAGE.walkStop === 'function' ? CEPH_PAGE.walkStop() : null;
      out.walkOff = !!(done && done.walkOn === false);
    }
  }
  if (window.CEPH_PAGE) {
    const stEx = CEPH_PAGE.state();
    out.extractScore = stEx.extractScore;
    out.extractBand = stEx.extractBand;
    out.extractLabel = stEx.extractLabel;
    out.extractNote = stEx.extractNote;
    out.extractHint = stEx.extractHint;
  }
  if (window.CEPH_PAGE && typeof CEPH_PAGE.movePoint === 'function') {
    const n0 = CEPH_PAGE.state().pts.N;
    CEPH_PAGE.movePoint('N', n0.x + 40, n0.y);
    const n1 = CEPH_PAGE.state().pts.N;
    const und = CEPH_PAGE.undoMove();
    const n2 = CEPH_PAGE.state().pts.N;
    out.undoMoved = !!(n0 && n1 && Math.abs(n1.x - n0.x) > 20);
    out.undoOk = !!(und && und.ok && n2 && Math.abs(n2.x - n0.x) < 0.51);
    const why0 = CEPH_PAGE.state().extractWhy;
    const e0 = typeof CEPH_PAGE.extra === 'function' ? CEPH_PAGE.extra() : null;
    const l1a = e0 && e0.L1a;
    if (l1a) CEPH_PAGE.movePoint('L1a', l1a.x - 70, l1a.y - 30);
    else {
      const a0 = CEPH_PAGE.state().pts.A;
      CEPH_PAGE.movePoint('A', a0.x - 90, a0.y);
    }
    out.whyAfter = CEPH_PAGE.state().extractWhy;
    CEPH_PAGE.undoMove();
    out.whyBefore = why0;
    out.whyChanged = !!(why0 && out.whyAfter && String(why0) !== String(out.whyAfter));
  }
  if (window.CEPH_PAGE && typeof CEPH_PAGE.csvText === 'function') {
    const csv = CEPH_PAGE.csvText();
    out.csvBom = !!(csv && csv.charCodeAt(0) === 0xFEFF);
    let ascii = true;
    for (let i = 1; csv && i < csv.length; i++) {
      const c = csv.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13) continue;
      if (c < 32 || c > 126) { ascii = false; break; }
    }
    out.csvAscii = !!(csv && ascii);
    out.csvHasSna = /SNA/.test(csv || '');
    out.csvNoDegree = csv.indexOf('\u00B0') < 0 && csv.indexOf('\u00B1') < 0 && csv.indexOf('\u2013') < 0;
    out.csvHasExtract = /Extraction index/.test(csv || '');
    out.csvNoTeeth = !/14,\s*24/.test(csv || '');
  }
  if (window.CEPH_PAGE && typeof CEPH_PAGE.saveTrace === 'function') {
    const nKeep = CEPH_PAGE.state().pts && CEPH_PAGE.state().pts.N;
    const saved = CEPH_PAGE.saveTrace();
    out.saveOk = !!(saved && saved.ok && saved.key);
    out.loadBtn = !!document.getElementById('btnLoadTrace');
    out.loadBtnOn = CEPH_PAGE.state().hasSavedTrace === true;
    const loaded = CEPH_PAGE.loadTrace();
    out.loadOk = !!(loaded && loaded.ok && loaded.nPts === 19);
    await CEPH_PAGE.runDetect();
    await wait(80);
    out.detectShowSets = CEPH_PAGE.state().setBarHidden === false;
    const loaded2 = CEPH_PAGE.loadTrace();
    const n2 = CEPH_PAGE.state().pts && CEPH_PAGE.state().pts.N;
    out.loadAfterDetect = !!(loaded2 && loaded2.ok && loaded2.nPts === 19);
    out.loadRecalled = !!(nKeep && n2 && Math.abs(n2.x - nKeep.x) < 0.51);
    out.saveBarHidden = CEPH_PAGE.state().setBarHidden === true;
    out.printFn = typeof CEPH_PAGE.printReport === 'function';
  }
  if (window.CEPH_PAGE && typeof CEPH_PAGE.setLabMode === 'function') {
    out.labOff = CEPH_PAGE.state().labOpen === false;
    CEPH_PAGE.setLabMode(true);
    out.labOn = CEPH_PAGE.state().labOpen === true;
    CEPH_PAGE.setLabMode(false);
    out.qa = CEPH_PAGE.state().qa;
  }
  if (window.CEPH_I18N && typeof CEPH_I18N.setLang === 'function') {
    const prev = CEPH_I18N.lang();
    const loadBtn = document.getElementById('btnLoad');
    CEPH_I18N.setLang('zh-Hant');
    out.zhLoad = loadBtn ? String(loadBtn.textContent || '') : '';
    out.zhHtmlLang = document.documentElement.getAttribute('lang');
    CEPH_I18N.setLang('zh-CN');
    out.cnLoad = loadBtn ? String(loadBtn.textContent || '') : '';
    CEPH_I18N.setLang(prev || 'en');
    out.enLoad = loadBtn ? String(loadBtn.textContent || '') : '';
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
    pass('sidecar name is prefixed Banana',
        /Banana · Lateral ceph/.test(read('ceph/index.html')) &&
        /香蕉 · 侧位头影/.test(read('ceph/ceph-i18n.js')) &&
        /香蕉 · 側位頭影/.test(read('ceph/ceph-i18n.js')) &&
        /Banana Ceph analysis/.test(launch) && /var title = 'Banana Ceph'/.test(launch));
    pass('sidecar has load / auto-detect / export and a live-page hook',
        /btnDetect/.test(read('ceph/index.html')) && /window\.CEPH_PAGE/.test(read('ceph/ceph.js')));
    pass('sidecar lets staff add an adopted 19-point set to clinic training',
        /btnLearn/.test(read('ceph/index.html')) && /CEPH_LEARN/.test(read('ceph/ceph-learn.js')) &&
        /includeSelected/.test(read('ceph/ceph.js')) && /clinicTrain/.test(read('ceph/ceph-learn.js')) &&
        !/btnLearnTouched/.test(read('ceph/index.html')));
    pass('auto-detect uses the 1502-film mean plus a local edge snap',
        /isbi\+aariz\+pku-/.test(read('ceph/ceph-landmarks.js')) && /refinePts/.test(read('ceph/ceph-landmarks.js')) &&
        /shapes\.json/.test(read('ceph/ceph-landmarks.js')));
    pass('sidecar owns ResNet-50 UNet for Banana development (service only imports it)',
        /class UNetHeatmapModel/.test(read('ceph/unet/model.py')) &&
        /banana_ceph_unet/.test(read('xray-ai-service/ceph/unet.py')) &&
        /ceph\/unet/.test(read('xray-ai-service/ceph/unet.py')) &&
        /dental_001-unet-29/.test(read('ceph/unet/infer.py')) &&
        /def detect_image/.test(read('xray-ai-service/ceph/detect.py')) &&
        /"via": "mean"/.test(read('xray-ai-service/ceph/detect.py')) &&
        /payload\.extra/.test(read('ceph/ceph-landmarks.js')));
    pass('sidecar has Published 1502 vs Published + in-house reference modes',
        /btnRefPub/.test(read('ceph/index.html')) && /btnRefPlus/.test(read('ceph/index.html')) &&
        /setUseTraining/.test(read('ceph/ceph.js')) && /useTraining/.test(read('ceph/ceph-landmarks.js')));
    pass('sidecar shows 2 auto-detect sets (UNet default + 1502 library) and Adopt selection',
        /setBar/.test(read('ceph/index.html')) && /btnAdoptSet/.test(read('ceph/index.html')) &&
        /id: 'unet'/.test(read('ceph/ceph-landmarks.js')) && /id: 'lib1502'/.test(read('ceph/ceph-landmarks.js')) &&
        !/id: 'imgEdge'/.test(read('ceph/ceph-landmarks.js')) &&
        /lockAdopt/.test(read('ceph/ceph.js')));
    pass('sidecar has Caucasian vs HK Chinese norms with in/warn/out bands',
        /btnNormCn/.test(read('ceph/index.html')) && /btnNormCauc/.test(read('ceph/index.html')) &&
        /normSet/.test(read('ceph/ceph-analysis.js')) && /band-out/.test(read('ceph/ceph.css')) &&
        /Chan 1972/.test(read('ceph/ceph-analysis.js')));
    pass('sidecar has Adult/Child and M/F approximate offsets on the published tables',
        /btnAgeAdult/.test(read('ceph/index.html')) && /btnAgeChild/.test(read('ceph/index.html')) &&
        /btnSexM/.test(read('ceph/index.html')) && /btnSexF/.test(read('ceph/index.html')) &&
        /function applyDemo/.test(read('ceph/ceph-analysis.js')) && /setAgeBand/.test(read('ceph/ceph.js')));
    pass('child CVM is staff-staged CS1–CS6 with an interceptive timing comment',
        /id="cvmBar"/.test(read('ceph/index.html')) && /function cvmStage/.test(read('ceph/ceph-analysis.js')) &&
        /Baccetti/.test(read('ceph/ceph-analysis.js')) && /interceptive/.test(read('ceph/ceph-analysis.js')) &&
        /cvm.cs3/.test(read('ceph/ceph-i18n.js')) && /setCvm/.test(read('ceph/ceph.js')));
    pass('Auto CVM forks Dental_001 C2–C4 (YOLO + CORAL), staff can still override',
        /id="btnAutoCvm"/.test(read('ceph/index.html')) && /detectCvmApi/.test(read('ceph/ceph-landmarks.js')) &&
        /CoralEfficientNet/.test(read('xray-ai-service/ceph/cvm.py')) &&
        /dental_001-c2c4/.test(read('xray-ai-service/ceph/cvm.py')) &&
        /ceph\/cvm/.test(read('xray-ai-service/main.py')) &&
        /pullCvmApi/.test(read('ceph/ceph.js')) && /maybeAutoCvm/.test(read('ceph/ceph.js')) &&
        /btn.autoCvm/.test(read('ceph/ceph-i18n.js')));
    pass('sidecar calibrates millimetres from a two-click film ruler',
        /btnCalibrate/.test(read('ceph/index.html')) && /applyRuler/.test(read('ceph/ceph.js')) &&
        /not calibrated/.test(read('ceph/ceph-analysis.js')));
    pass('Wits uses FOP, N-perp uses Frankfort, IMPA uses draggable apices',
        /nPerpMm/.test(read('ceph/ceph-analysis.js')) && /witsMm/.test(read('ceph/ceph-analysis.js')) &&
        /FopA/.test(read('ceph/ceph.js')) && /L1a/.test(read('ceph/ceph.js')));
    pass('Steiner table includes U1-SN, U1-NA and L1-NB (deg and mm)',
        /U1–SN/.test(read('ceph/ceph-analysis.js')) &&         /U1–NA mm/.test(read('ceph/ceph-analysis.js')) &&
        /L1–NB mm/.test(read('ceph/ceph-analysis.js')) && /incisorToPlane/.test(read('ceph/ceph-analysis.js')));
    pass('Ricketts table measures incisors to A-Pog',
        /U1–APog mm/.test(read('ceph/ceph-analysis.js')) && /L1–APog mm/.test(read('ceph/ceph-analysis.js')) &&
        /id: 'ricketts'/.test(read('ceph/ceph-analysis.js')));
    pass('soft tissue has Ricketts E-line using a draggable pronasale',
        /Ls to E-line/.test(read('ceph/ceph-analysis.js')) && /id: 'Pn'/.test(read('ceph/ceph.js')) &&
        /extra\.Pn/.test(read('ceph/ceph-i18n.js')));
    pass('Jarabak PFH/AFH percent and cranial-base angles are tabulated',
        /PFH\/AFH/.test(read('ceph/ceph-analysis.js')) && /Jarabak sum/.test(read('ceph/ceph-analysis.js')) &&
        /id: 'jarabak'/.test(read('ceph/ceph-analysis.js')));
    pass('clicking a table row highlights that construction; zoom pan invert undo exist',
        /highlightMeasure/.test(read('ceph/ceph.js')) && /btnInvert/.test(read('ceph/index.html')) &&
        /btnUndoPt/.test(read('ceph/index.html')) && /viewZoom/.test(read('ceph/ceph.js')));
    pass('film brightness, contrast and Frankfort-horizontal rotate exist',
        /btnFhUp/.test(read('ceph/index.html')) && /setFhUp/.test(read('ceph/ceph.js')) &&
        /setFilmLook/.test(read('ceph/ceph.js')) && /filmBright/.test(read('ceph/index.html')));
    pass('sidecar draws a soft-tissue profile polyline plus SN and mandibular plane',
        /strokePath/.test(read('ceph/ceph.js')) && /Pn.*Sn.*Ls.*Li.*PogS/.test(read('ceph/ceph.js')));
    pass('progress overlay registers a prior tracing on SN, FH or palatal plane',
        /setOverlay/.test(read('ceph/ceph.js')) && /setOverlayMode/.test(read('ceph/ceph.js')) &&
        /btnOverlaySn/.test(read('ceph/index.html')) && /otherTraces/.test(launch));
    pass('sidecar walks through Go/Po/Or/Ar, apices and Pn after Adopt or restore',
        /btnWalk/.test(read('ceph/index.html')) && /WALK_IDS/.test(read('ceph/ceph.js')) &&
        /startWalk/.test(read('ceph/ceph.js')) && /walk\.Go/.test(read('ceph/ceph-i18n.js')));
    pass('Undo point keeps a declared undo stack',
        /var undoStack = \[\]/.test(read('ceph/ceph.js')) && /function undoMove/.test(read('ceph/ceph.js')));
    pass('CSV export sanitises punctuation for Excel',
        /function csvSafe/.test(read('ceph/ceph-analysis.js')) &&
        read('ceph/ceph-analysis.js').indexOf('\\uFEFF') >= 0);
    pass('sidecar has a one-page clinical summary and Steiner S-line lips',
        /id="summary"/.test(read('ceph/index.html')) && /summarise/.test(read('ceph/ceph-analysis.js')) &&
        /Ls to Sn/.test(read('ceph/ceph-analysis.js')));
    pass('sidecar has a ceph-only extraction index (not a treatment plan)',
        /function extractionIndex/.test(read('ceph/ceph-analysis.js')) &&
        /sum.extract/.test(read('ceph/ceph.js')) &&
        /拔牙倾向/.test(read('ceph/ceph-i18n.js')) &&
        /crowding not assessed/.test(read('ceph/ceph-analysis.js')));
    pass('sidecar follows dashboard language (en / zh-CN / zh-Hant)',
        /ceph-i18n.js/.test(read('ceph/index.html')) &&
        /joyful_ui_lang_v1/.test(read('ceph/ceph-i18n.js')) &&
        /載入底片/.test(read('ceph/ceph-i18n.js')) &&
        /载入底片/.test(read('ceph/ceph-i18n.js')) &&
        /data-lang="zh-Hant"/.test(read('ceph/index.html')) &&
        /CEPH_I18N/.test(read('ceph/ceph.js')) &&
        /data-i18n="ex.back"/.test(read('ceph/extraction.html')));
    pass('extraction notes page explains extract vs keep',
        /btnExtractHelp/.test(read('ceph/index.html')) &&
        /Leans extract/.test(read('ceph/extraction.html')) &&
        /Leans keep/.test(read('ceph/extraction.html')) &&
        /Class III/.test(read('ceph/extraction.html')) &&
        /crowding/.test(read('ceph/extraction.html')));
    pass('Back to tracing does not load a fresh empty ceph',
        /history\.back/.test(read('ceph/extraction.html')) &&
        /window\.opener/.test(read('ceph/extraction.html')) &&
        !/href="\.\/\?v=/.test(read('ceph/extraction.html')) &&
        /openExtractNotes/.test(read('ceph/ceph.js')));
    pass('sidecar saves a patient tracing and can print a report',
        /btnSaveTrace/.test(read('ceph/index.html')) && /btnPrint/.test(read('ceph/index.html')) &&
        /savedTrace/.test(read('ceph/ceph.js')) && /@media print/.test(read('ceph/ceph.css')) &&
        /#top #btnSaveTrace/.test(read('ceph/ceph.css')));
    pass('saved tracing copies the film into the xrays bucket, creates a ceph_saves ID, and restores as default landmarks',
        /ceph_saves/.test(read('xray_ceph.sql')) && /ceph_saves/.test(read('xray_context.sql')) &&
        /ceph_tracing/.test(read('xray_ceph.sql')) && /\/ceph\//.test(read('app-xray-ceph.js')) &&
        /xrayCephSaveTracing/.test(launch) && /xrayCephFetchSave/.test(launch) &&
        /pendingTrace/.test(read('ceph/ceph.js')) && /restoreHold/.test(read('ceph/ceph.js')) &&
        /st.savedCloud/.test(read('ceph/ceph-i18n.js')) && /film copy/.test(read('ceph/ceph-i18n.js')) &&
        /描记已存为该病人头影研究/.test(read('ceph/ceph-i18n.js')) &&
        !/noopener/.test(launch) && /xrayCephFetchTracing/.test(launch) &&
        /btnLoadTrace/.test(read('ceph/index.html')) && /pullCloudTrace/.test(read('ceph/ceph.js')) &&
        /filmDataUrl/.test(read('ceph/ceph.js')));
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
        /ceph\/landmarks/.test(read('xray-ai-service/main.py')) &&
        /detect_image/.test(read('xray-ai-service/main.py')) &&
        /class UNetHeatmapModel/.test(read('ceph/unet/model.py')));
    var unetHome = child_process.spawnSync(process.platform === 'win32' ? 'py' : 'python3', [
        '-3', path.join(root, 'ceph', 'unet', 'verify.py')
    ], { cwd: path.join(root, 'ceph', 'unet'), encoding: 'utf8' });
    if (unetHome.error || unetHome.status !== 0) {
        unetHome = child_process.spawnSync('python', [
            path.join(root, 'ceph', 'unet', 'verify.py')
        ], { cwd: path.join(root, 'ceph', 'unet'), encoding: 'utf8' });
    }
    pass('Banana sidecar UNet clone maps Aariz 29 → ISBI 19 (no weights required)',
        unetHome.status === 0 && /ok banana unet clone/.test(String(unetHome.stdout || '')),
        String((unetHome.stdout || '') + (unetHome.stderr || '')).slice(0, 180));
    var unetPy = child_process.spawnSync(process.platform === 'win32' ? 'py' : 'python3', [
        '-3', '-c', 'from ceph.verify_unet import main; main()'
    ], { cwd: path.join(root, 'xray-ai-service'), encoding: 'utf8' });
    if (unetPy.error || unetPy.status !== 0) {
        unetPy = child_process.spawnSync('python', [
            '-c', 'from ceph.verify_unet import main; main()'
        ], { cwd: path.join(root, 'xray-ai-service'), encoding: 'utf8' });
    }
    pass('AI service shim maps Aariz 29 → ISBI 19 from the sidecar UNet',
        unetPy.status === 0 && /ok unet map/.test(String(unetPy.stdout || '')),
        String((unetPy.stdout || '') + (unetPy.stderr || '')).slice(0, 180));
    pass('AI service has a /ceph/cvm hook (Dental_001 C2–C4)',
        /@app.post\("\/ceph\/cvm"\)/.test(read('xray-ai-service/main.py')) &&
        /class CoralEfficientNet/.test(read('xray-ai-service/ceph/cvm.py')) &&
        /best_cvm_v2_768px/.test(read('xray-ai-service/ceph/cvm.py')));
    var cvmPy = child_process.spawnSync(process.platform === 'win32' ? 'py' : 'python3', [
        '-3', '-c', 'from ceph.verify_cvm import main; main()'
    ], { cwd: path.join(root, 'xray-ai-service'), encoding: 'utf8' });
    if (cvmPy.error || cvmPy.status !== 0) {
        cvmPy = child_process.spawnSync('python', [
            '-c', 'from ceph.verify_cvm import main; main()'
        ], { cwd: path.join(root, 'xray-ai-service'), encoding: 'utf8' });
    }
    pass('CVM fork fallback bbox + status (no weights required)',
        cvmPy.status === 0 && /ok fallback/.test(String(cvmPy.stdout || '')),
        String((cvmPy.stdout || '') + (cvmPy.stderr || '')).slice(0, 180));
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
    pass('five analysis groups plus Ricketts, Jarabak, soft tissue and extraction index', res.groups.map(function (g) { return g.id; }).join(',') === 'steiner,downs,tweed,wits,mcnamara,ricketts,jarabak,soft,extract');
    pass('one-page summary names skeletal class', !!(res.summary && res.summary.skeletal), res.summary && res.summary.skeletal);
    pass('Caucasian SNA norm is 82 ± 2', res.groups[0].rows[0].norm === '82 ± 2' && res.normSet === 'caucasian');
    var childRes = box.CEPH_AN.run(pts, 0.1, { age: 'child' });
    var femaleRes = box.CEPH_AN.run(pts, 0.1, { sex: 'f' });
    var childFRes = box.CEPH_AN.run(pts, 0.1, { age: 'child', sex: 'f' });
    pass('child offset lowers Caucasian SNA mean to 81, adult table stays 82',
        childRes.groups[0].rows[0].norm === '81 ± 2' && childRes.age === 'child' &&
        res.groups[0].rows[0].norm === '82 ± 2' &&
        /child \(approx vs adult table\)/.test(String(childRes.normSource || '')));
    pass('female offset lowers Caucasian SNA mean to 81.5 without changing the published table',
        femaleRes.groups[0].rows[0].norm === '81.5 ± 2' && femaleRes.sex === 'f' &&
        /female offset \(approx\)/.test(String(femaleRes.normSource || '')) &&
        box.CEPH_AN.getSet('caucasian').measures.SNA.mean === 82);
    pass('child + female stacks to SNA 80.5',
        childFRes.groups[0].rows[0].norm === '80.5 ± 2' && childFRes.age === 'child' && childFRes.sex === 'f');
    var cvm3 = box.CEPH_AN.cvmStage(3);
    var childCvm = box.CEPH_AN.run(pts, 0.1, { age: 'child', cvm: 3 });
    pass('adult analysis has no CVM group', res.groups.every(function (g) { return g.id !== 'cvm'; }));
    pass('child CS3 CVM comment is the peak interceptive window',
        !!(cvm3 && cvm3.id === 'CS3' && /peak/i.test(cvm3.comment) && /interceptive|functional/i.test(cvm3.comment)) &&
        childCvm.groups.some(function (g) { return g.id === 'cvm'; }) &&
        childCvm.summary && /CS3/.test(String(childCvm.summary.cvm || '')) &&
        /Peak window/.test(String(childCvm.summary.cvmComment || '')));
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
    function anRow(result, gid, name) {
        var g = (result.groups || []).filter(function (x) { return x.id === gid; })[0];
        if (!g) return null;
        return (g.rows || []).filter(function (x) { return x.name === name; })[0] || null;
    }
    var u1sn = anRow(withApex, 'steiner', 'U1–SN');
    var u1na = anRow(withApex, 'steiner', 'U1–NA');
    var u1naMm = anRow(withApex, 'steiner', 'U1–NA mm');
    var l1nb = anRow(withApex, 'steiner', 'L1–NB');
    var l1nbMm = anRow(withApex, 'steiner', 'L1–NB mm');
    pass('Steiner U1-SN is the obtuse supplement, U1-NA / L1-NB stay acute',
        u1sn && u1sn.value > 90 && u1na && u1na.value > 0 && u1na.value < 60 &&
        l1nb && l1nb.value > 0 && l1nb.value < 60 &&
        u1sn.value > u1na.value &&
        u1naMm && u1naMm.unit === 'mm' && l1nbMm && l1nbMm.unit === 'mm',
        'U1SN=' + (u1sn && u1sn.value) + ' U1NA=' + (u1na && u1na.value) + ' L1NB=' + (l1nb && l1nb.value));
    var convRow = cn.groups[1].rows[1];
    pass('Downs convexity is a small signed angle, not angle N-A-Pog',
        convRow && convRow.value != null && convRow.value > -40 && convRow.value < 45,
        String(convRow && convRow.value));
    var iiRow = cn.groups[0].rows[4];
    pass('Interincisal is the dental supplement, not the acute fold',
        iiRow && iiRow.value > 90 && iiRow.value < 180,
        String(iiRow && iiRow.value));
    var fmaV = cn.groups[2].rows[0].value, impaV = cn.groups[2].rows[1].value, fmiaV = cn.groups[2].rows[2].value;
    pass('Tweed FMA + IMPA + FMIA is 180',
        Math.abs(fmaV + impaV + fmiaV - 180) < 0.21,
        String(fmaV) + '+' + impaV + '+' + fmiaV);
    var postA = JSON.parse(JSON.stringify(pts));
    postA.A = { x: 560, y: 510 };
    var postR = box.CEPH_AN.run(postA, 0.1, { normSet: 'chinese' });
    pass('extraction why updates when A-point moves',
        cn.extraction && postR.extraction && cn.extraction.why !== postR.extraction.why &&
        /concave/.test(postR.extraction.why),
        (cn.extraction && cn.extraction.why) + ' -> ' + (postR.extraction && postR.extraction.why));
    var csv = box.CEPH_AN.toCsv(cn);
    pass('CSV starts with a UTF-8 BOM so Excel opens it', csv.charCodeAt(0) === 0xFEFF);
    pass('CSV body is readable ASCII (no degree/en-dash/plus-minus glyphs)',
        !/[^\x09\x0A\x0D\x20-\x7E]/.test(csv.slice(1)) && /deg/.test(csv) && /\+\/-/.test(csv) &&
        csv.indexOf('SN-GoGn') >= 0 && csv.indexOf('\u00B0') < 0);
    pass('CSV includes the extraction index without tooth numbers',
        /Extraction index/.test(csv) && /crowding/.test(csv) && !/14,\s*24/.test(csv));
    var ex = cn.extraction;
    pass('extraction index is a 0-100 band, not a percent chance',
        ex && ex.score >= 0 && ex.score <= 100 && /^(low|borderline|moderate|high)$/.test(ex.band) &&
        /crowding/.test(ex.note) && String(ex.label).indexOf('%') < 0,
        ex && (ex.label + ' ' + ex.score + ' ' + ex.band));
    var class3Pts = JSON.parse(JSON.stringify(pts));
    class3Pts.B = { x: 700, y: 600 };
    class3Pts.Pog = { x: 710, y: 680 };
    var class3 = box.CEPH_AN.run(class3Pts, 0.1, { normSet: 'chinese' });
    pass('Class III is not scored as a 4-premolar extraction pattern',
        class3.extraction && /Class III/.test(class3.extraction.hint) &&
        /not a 4-premolar/.test(class3.extraction.hint),
        class3.extraction && class3.extraction.hint);
    var meanPts = {};
    cat.landmarks.forEach(function (d) {
        meanPts[d.id] = { x: d.ix * 1935, y: d.iy * 2400 };
    });
    var meanRes = box.CEPH_AN.run(meanPts, 0.1);
    pass('400-film image mean SNA is 80–86°', meanRes.groups[0].rows[0].value >= 80 && meanRes.groups[0].rows[0].value <= 86,
        String(meanRes.groups[0].rows[0].value));
    var meanU1sn = anRow(meanRes, 'steiner', 'U1–SN');
    var meanU1na = anRow(meanRes, 'steiner', 'U1–NA');
    var meanSna = anRow(meanRes, 'steiner', 'SNA');
    pass('Steiner identity U1-SN is near SNA + U1-NA on the 1502 mean',
        meanU1sn && meanU1na && meanSna &&
        Math.abs(meanU1sn.value - (meanSna.value + meanU1na.value)) < 4,
        'SNA=' + (meanSna && meanSna.value) + ' U1NA=' + (meanU1na && meanU1na.value) +
        ' U1SN=' + (meanU1sn && meanU1sn.value));
    var meanL1ap = anRow(meanRes, 'ricketts', 'L1–APog mm');
    var meanU1ap = anRow(meanRes, 'ricketts', 'U1–APog');
    pass('Ricketts A-Pog rows exist on the 1502 mean',
        meanU1ap && meanU1ap.value > 0 && meanU1ap.value < 50 &&
        meanL1ap && meanL1ap.unit === 'mm' && meanL1ap.value != null,
        'U1APog=' + (meanU1ap && meanU1ap.value) + ' L1APogmm=' + (meanL1ap && meanL1ap.value));
    var meanLsE = anRow(meanRes, 'soft', 'Ls to E-line');
    var meanLiE = anRow(meanRes, 'soft', 'Li to E-line');
    pass('E-line lip distances exist on the 1502 mean',
        meanLsE && meanLsE.unit === 'mm' && meanLsE.value != null &&
        meanLiE && meanLiE.unit === 'mm' && meanLiE.value != null,
        'LsE=' + (meanLsE && meanLsE.value) + ' LiE=' + (meanLiE && meanLiE.value));
    var meanPfh = anRow(meanRes, 'jarabak', 'PFH/AFH');
    var meanJsum = anRow(meanRes, 'jarabak', 'Jarabak sum');
    var meanNsa = anRow(meanRes, 'jarabak', 'N–S–Ar');
    var meanSar = anRow(meanRes, 'jarabak', 'S–Ar–Go');
    var meanGon = anRow(meanRes, 'jarabak', 'Ar–Go–Me');
    pass('Jarabak sum is N-S-Ar + S-Ar-Go + Ar-Go-Me and PFH/AFH is a percent',
        meanJsum && meanNsa && meanSar && meanGon &&
        Math.abs(meanJsum.value - (meanNsa.value + meanSar.value + meanGon.value)) < 0.21 &&
        meanPfh && meanPfh.unit === '%' && meanPfh.value > 50 && meanPfh.value < 80,
        'sum=' + (meanJsum && meanJsum.value) + ' PFH/AFH=' + (meanPfh && meanPfh.value));

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
    L.xrayAllRecords = [{
        id: 'x1', xray_type: 'Cephalometric', file_url: 'http://example/c.jpg', file_name: 'c.png',
        patient_id: 'p1', file_path: 'p1/old.png',
        ceph_tracing: { v: 1, pts: { S: { x: 11, y: 12 }, N: { x: 21, y: 22 } } }
    }];
    var ctxT = L.xrayCephContext();
    pass('context carries saved tracing from the film',
        !!(ctxT && ctxT.tracing && ctxT.tracing.pts && ctxT.tracing.pts.S && ctxT.tracing.pts.S.x === 11));
    L.XRAY_CEPH.off = null;
    L.XRAY_CEPH.savesOff = null;
    L._row = null;
    L._saveRows = [];
    L.atob = function (s) { return Buffer.from(s, 'base64').toString('binary'); };
    L.Uint8Array = Uint8Array;
    L.Date = Date;
    L.Promise = Promise;
    L.isFinite = isFinite;
    L.Blob = typeof Blob === 'function' ? Blob : function (parts, opt) {
        this.size = (parts && parts[0] && parts[0].length) || 0;
        this.type = (opt && opt.type) || '';
    };
    L.XRAY_BUCKET = 'xrays';
    function thenable(data, error) {
        var r = { data: data, error: error || null };
        r.then = function (ok, fail) { return Promise.resolve({ data: r.data, error: r.error }).then(ok, fail); };
        r.limit = function () { return thenable(data, error); };
        r.select = function () { return thenable(data, error); };
        r.eq = function (col, id) { L._eq = { col: col, id: id }; return thenable(data, error); };
        return r;
    }
    L.SB = {
        storage: {
            from: function (b) {
                L._bucket = b;
                return {
                    upload: function (path, file, opt) {
                        L._up = { path: path, upsert: !!(opt && opt.upsert), type: file && file.type };
                        return Promise.resolve({ error: null });
                    },
                    download: function () { return Promise.resolve({ data: null, error: { message: 'skip' } }); },
                    getPublicUrl: function (p) { return { data: { publicUrl: 'http://example/' + p } }; }
                };
            }
        },
        from: function (table) {
            L._table = table;
            if (table === 'ceph_saves') {
                return {
                    select: function () {
                        return {
                            eq: function (col, id) {
                                L._saveSel = { col: col, id: id };
                                return thenable(L._saveRows || []);
                            }
                        };
                    },
                    insert: function (row) {
                        L._saveInsert = row;
                        L._saveRows = [{
                            id: 'save-1',
                            file_url: row.file_url,
                            file_path: row.file_path,
                            file_name: row.file_name,
                            tracing: row.tracing,
                            source_xray_id: row.source_xray_id
                        }];
                        return thenable(L._saveRows);
                    },
                    update: function (row) {
                        L._saveUpdate = row;
                        return {
                            eq: function (col, id) {
                                L._saveEq = { col: col, id: id };
                                return thenable([{ id: id, file_url: row.file_url, file_path: row.file_path }]);
                            }
                        };
                    }
                };
            }
            return {
                update: function (row) {
                    L._row = row;
                    return { eq: function (col, id) { L._eq = { col: col, id: id }; return { error: null }; } };
                },
                select: function () {
                    return {
                        eq: function (col, id) {
                            L._sel = { col: col, id: id };
                            return thenable([{ ceph_tracing: { v: 1, pts: { S: { x: 11, y: 12 }, N: { x: 21, y: 22 } } } }]);
                        }
                    };
                }
            };
        }
    };
    var savedCloud = await L.xrayCephSaveTracing('x1', { v: 1, pts: { S: { x: 10, y: 10 } } }, {
        filmDataUrl: 'data:image/jpeg;base64,QQ==',
        fileName: 'c.jpg',
        patientId: 'p1'
    });
    pass('saves tracing onto xrays.ceph_tracing',
        !!(savedCloud && savedCloud.ok && savedCloud.cloud && L._row && L._row.ceph_tracing &&
            L._eq && L._eq.id === 'x1'));
    pass('copies the ceph film into the xrays bucket under a save path',
        !!(savedCloud && savedCloud.copied && L._bucket === 'xrays' && L._up &&
            L._up.path === 'p1/ceph/x1.jpg' && L._up.upsert === true));
    pass('creates a ceph_saves ID wired to the tracing',
        !!(savedCloud && savedCloud.cephSaveId === 'save-1' && L._saveInsert &&
            L._saveInsert.source_xray_id === 'x1' && L._saveInsert.tracing &&
            L._saveInsert.tracing.pts.S.x === 10));
    var fetched = await L.xrayCephFetchTracing('x1');
    pass('reads tracing back from the ceph_saves row',
        !!(fetched && fetched.pts && fetched.pts.S && fetched.pts.S.x === 10 && fetched.cephSaveId === 'save-1'));
    L._saveRows = [];
    var fetchedFilm = await L.xrayCephFetchTracing('x1');
    pass('falls back to the patient film row when no save exists',
        !!(fetchedFilm && fetchedFilm.pts && fetchedFilm.pts.S && fetchedFilm.pts.S.x === 11));
    L.XRAY_CEPH.off = null;
    L.XRAY_CEPH.savesOff = null;
    L.SB = {
        from: function () {
            return {
                update: function () {
                    return { eq: function () { return { error: { code: 'PGRST204', message: 'Could not find the ceph_tracing column' } }; } };
                }
            };
        }
    };
    var miss = await L.xrayCephSaveTracing('x1', { pts: { S: { x: 1, y: 1 } } });
    pass('missing ceph_tracing column falls back locally',
        !!(miss && !miss.ok && miss.error === 'col' && L.XRAY_CEPH.off === true));

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
        var rt = await fetch(sb.url.replace(/\/$/, '') +
            '/rest/v1/xrays?select=id,ceph_tracing&xray_type=eq.Cephalometric&limit=1', {
            headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
        });
        var tb = await rt.json();
        var colOk = rt.status === 200;
        var pendingSql = rt.status === 400 && /ceph_tracing/i.test(JSON.stringify(tb));
        pass('xrays.ceph_tracing column readable or SQL still to run',
            colOk || pendingSql,
            colOk ? 'present' : ('HTTP ' + rt.status));
        var rs = await fetch(sb.url.replace(/\/$/, '') +
            '/rest/v1/ceph_saves?select=id&limit=1', {
            headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
        });
        var ts = await rs.json().catch(function () { return {}; });
        var savesOk = rs.status === 200;
        var pendingSaves = rs.status === 404 || (rs.status === 400 && /ceph_saves|schema cache|PGRST205/i.test(JSON.stringify(ts)));
        pass('ceph_saves table readable or SQL still to run',
            savesOk || pendingSaves,
            savesOk ? 'present' : ('HTTP ' + rs.status));
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
    var i18nGet = await httpGetText(PAGE_PORT, '/ceph/ceph-i18n.js');
    pass('GET /ceph/ceph-i18n.js follows dashboard locales',
        i18nGet.status === 200 && /joyful_ui_lang_v1/.test(i18nGet.body.toString()) &&
        /載入底片/.test(i18nGet.body.toString()));
    var helpGet = await httpGetText(PAGE_PORT, '/ceph/extraction.html');
    pass('GET /ceph/extraction.html is the extract-vs-keep reminder',
        helpGet.status === 200 && /Leans extract/.test(helpGet.body.toString()) &&
        /Leans keep/.test(helpGet.body.toString()) && /Class III/.test(helpGet.body.toString()) &&
        /history\.back/.test(helpGet.body.toString()) && !/href="\.\/\?v=/.test(helpGet.body.toString()));
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
        pass('live: a profile polyline is drawn on the film',
            live && live.profileN >= 4,
            live ? ('profileN=' + live.profileN) : 'none');
        pass('live: 2 auto-detect sets — UNet (default) and 1502 library average',
            live && live.nSets === 2 && /unet/.test(String(live.setIds || '')) && /lib1502/.test(String(live.setIds || '')) &&
            (/dental_001-unet/.test(String(live.set0 || '')) || /isbi\+aariz\+pku-/.test(String(live.set0 || ''))) &&
            /boxmean\+edge/.test(String(live.set1 || '')) && live.set0 !== live.set1 &&
            live.adopted === true && live.setBarHidden === true,
            live ? ('ids=' + live.setIds + ' unet=' + live.set0 + ' lib=' + live.set1 + ' hidden=' + live.setBarHidden) : 'none');
        pass('live: Adopt starts a Go/Po/Or/Ar/apex/Pn walk-through',
            live && live.walkAdoptOn === true && live.walkAdoptId === 'Go',
            live ? ('adoptWalk=' + live.walkAdoptId) : 'none');
        pass('live: Steiner / Downs / Tweed / Wits / McNamara ran',
            live && live.groups && ['steiner', 'downs', 'tweed', 'wits', 'mcnamara'].every(function (id) {
                return live.groups.indexOf(id) >= 0;
            }) && live.sna != null,
            live ? ('SNA=' + live.sna + ' groups=' + (live.groups && live.groups.join(','))) : 'none');
        pass('live: Ricketts U1-APog and L1-APog mm are on the table',
            live && live.u1apog > 0 && live.u1apog < 50 && live.l1apogMm != null,
            live ? ('U1APog=' + live.u1apog + ' L1APogmm=' + live.l1apogMm) : 'none');
        pass('live: E-line uses pronasale and reports lip millimetres',
            live && /Pn/.test(String(live.extraIds || '')) && live.lsE != null && live.liE != null,
            live ? ('Pn in ' + live.extraIds + ' LsE=' + live.lsE + ' LiE=' + live.liE) : 'none');
        pass('live: Jarabak PFH/AFH and angle sum are on the table',
            live && live.pfhAfh > 50 && live.pfhAfh < 80 && live.jsum > 370 && live.jsum < 420,
            live ? ('PFH/AFH=' + live.pfhAfh + ' sum=' + live.jsum) : 'none');
        pass('live: Steiner U1-SN / U1-NA / L1-NB are on the table',
            live && live.u1sn > 90 && live.u1sn < 130 && live.u1na > 0 && live.u1na < 50 &&
            live.l1nb > 0 && live.l1nb < 55 && live.u1naMm != null && live.l1nbMm != null,
            live ? ('U1SN=' + live.u1sn + ' U1NA=' + live.u1na + ' L1NB=' + live.l1nb) : 'none');
        pass('live: clinical summary is filled',
            live && /Class/.test(String(live.summarySkeletal || '')),
            live ? ('skeletal=' + live.summarySkeletal) : 'none');
        pass('live: extraction index is a ceph-only tendency band',
            live && live.extractScore >= 0 && live.extractScore <= 100 &&
            /^(low|borderline|moderate|high)$/.test(String(live.extractBand || '')) &&
            /crowding/.test(String(live.extractNote || '')) &&
            !/%/.test(String(live.extractLabel || '')) &&
            live.csvHasExtract === true && live.csvNoTeeth === true,
            live ? (live.extractLabel + ' ' + live.extractScore + ' ' + live.extractBand) : 'none');
        pass('live: Caucasian vs HK Chinese norms colour the SNA row',
            live && live.caucSet === 'caucasian' && /82/.test(String(live.caucNorm || '')) &&
            live.cnSet === 'chinese' && /83\.8/.test(String(live.cnNorm || '')) &&
            live.caucNorm !== live.cnNorm && /^(in|warn|out)$/.test(String(live.cnBand || '')),
            live ? ('cauc=' + live.caucNorm + ' cn=' + live.cnNorm + ' band=' + live.cnBand) : 'none');
        pass('live: Adult vs Child and female offsets change the SNA mean, not the published table',
            live && live.adultAge === 'adult' && /82/.test(String(live.adultNorm || '')) &&
            live.childAge === 'child' && /81/.test(String(live.childNorm || '')) &&
            live.adultNorm !== live.childNorm &&
            live.childFSex === 'f' && /80\.5/.test(String(live.childFNorm || '')),
            live ? ('adult=' + live.adultNorm + ' child=' + live.childNorm + ' childF=' + live.childFNorm) : 'none');
        pass('live: child CVM CS3 shows a peak interceptive comment',
            live && live.cvmStage === 3 && live.cvmId === 'CS3' && live.cvmGroup === true &&
            /peak/i.test(String(live.cvmComment || '')),
            live ? ('cvm=' + live.cvmId + ' ' + live.cvmComment) : 'none');
        pass('live: Auto CVM is wired (C2–C4 API); missing weights stay manual',
            live && live.autoCvmBtn === true && live.autoCvmFn === true && live.detectCvmApi === true,
            live ? ('btn=' + live.autoCvmBtn + ' fn=' + live.autoCvmFn) : 'none');
        pass('live: two-click ruler calibrates millimetres',
            live && live.calBefore === false && live.calOk === true && live.calAfter === true &&
            live.calMmPerPx === 0.1,
            live ? ('before=' + live.calBefore + ' mm/px=' + live.calMmPerPx) : 'none');
        pass('live: FOP and incisor-apex handles are on the tracing',
            live && live.extraIds === 'FopA,FopP,L1a,Pn,U1a' && /FOP/.test(String(live.witsNote || '')) &&
            /FH/.test(String(live.nperpNote || '')),
            live ? ('extra=' + live.extraIds + ' wits=' + live.witsNote) : 'none');
        pass('live: clicking SNA highlights SN and NA on the film',
            live && live.hiOk === true && live.hiMeasure === 'SNA' && live.invert === true,
            live ? ('hi=' + live.hiMeasure + ' invertWas=' + live.invert) : 'none');
        pass('live: brightness/contrast and FH-up rotate the film',
            live && live.lookBright === 1.25 && live.lookContrast === 1.15 &&
            live.fhOn === true && live.fhDeg === true,
            live ? ('b=' + live.lookBright + ' c=' + live.lookContrast + ' fhDeg=' + live.fhDeg) : 'none');
        pass('live: a prior tracing overlays on SN then FH',
            live && live.ovOk === true && live.ovFh === true && live.ovOff === true,
            live ? ('ov=' + live.ovOk + ' fh=' + live.ovFh + ' off=' + live.ovOff) : 'none');
        pass('live: Check points walks Go then Po then Or and zooms in',
            live && live.walk0 === 'Go' && live.walk1 === 'Po' && live.walk2 === 'Or' &&
            live.walkN === 7 && live.walkZoom === true && live.walkOff === true,
            live ? ('0=' + live.walk0 + ' 1=' + live.walk1 + ' 2=' + live.walk2 + ' n=' + live.walkN) : 'none');
        pass('live: Undo point restores the last moved landmark',
            live && live.undoMoved === true && live.undoOk === true);
        pass('live: extraction why updates when the tracing moves',
            live && live.whyChanged === true,
            live ? (String(live.whyBefore) + ' -> ' + String(live.whyAfter)) : 'none');
        pass('live: CSV export is Excel-readable ASCII with a BOM',
            live && live.csvBom === true && live.csvAscii === true && live.csvHasSna === true && live.csvNoDegree === true);
        pass('live: tracing saves for this patient and can be restored',
            live && live.saveOk === true && live.loadOk === true && live.printFn === true &&
            live.saveBarHidden === true && live.loadBtn === true && live.loadBtnOn === true &&
            live.detectShowSets === true && live.loadAfterDetect === true && live.loadRecalled === true,
            live ? ('save=' + live.saveOk + ' load=' + live.loadOk + ' recalled=' + live.loadRecalled) : 'none');
        pass('live: Advanced training stays hidden until toggled',
            live && live.labOff === true && live.labOn === true,
            live ? ('off=' + live.labOff + ' on=' + live.labOn + ' qa=' + (live.qa && live.qa.join(','))) : 'none');
        pass('live: language toggle follows dashboard en / zh-CN / zh-Hant',
            live && live.zhLoad === '載入底片' && live.cnLoad === '载入底片' &&
            live.enLoad === 'Load film' && live.zhHtmlLang === 'zh-Hant',
            live ? ('hant=' + live.zhLoad + ' cn=' + live.cnLoad + ' en=' + live.enLoad) : 'none');
        pass('live: the adopted set is added as a whole 19-point film',
            live && live.learnOk === true && live.learnIncluded === 19 && live.learnWhole === true,
            live ? ('films=' + live.learnClinic + ' n=' + live.learnIncluded + ' src=' + live.learnSource) : 'none');
        pass('live: overlay stays off on published-1502 until Published + in-house is selected',
            live && live.learnOffUse === false && live.learnOffVia !== 'clinic' &&
            !/training:clinic-train-/.test(String(live.learnOffSource || '')),
            live ? ('off via=' + live.learnOffVia + ' src=' + live.learnOffSource) : 'none');
        pass('live: auto-detect overlays clinic training on the 1502 set without mixing into 1502',
            live && live.learnUse === true && live.learnPublished === 1502 &&
            /isbi\+aariz\+pku-1502/.test(String(live.learnPublishedSource || '')) &&
            /training:clinic-train-/.test(String(live.learnLibSource || '')) &&
            !/\+clinic-/.test(String(live.learnPublishedSource || '')),
            live ? ('via=' + live.learnVia + ' lib=' + live.learnLibSource + ' pub=' + live.learnPublishedSource + ' train=' + live.learnTrainingSource) : 'none');
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
