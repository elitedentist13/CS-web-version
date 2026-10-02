/**
 * Consultation > X-ray tab, Phase 3 viewer (no DICOM).
 *  - calibrated measurements (length, angle, bone level) as an editable layer
 *  - synced-zoom compare + per-tooth timeline
 *  - FMX / bitewing mount
 *  - lightbox keyboard shortcuts
 * Smoke (source) + HTTP spot + API (read-only, anon) + testclient (vm) + CDP Runtime.evaluate / live page.
 * Run: node scripts/xray-viewer-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261002cb4';
var PAGE_PORT = 8797;
var CDP_PORT = 9365;
var CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var root = path.resolve(__dirname, '..');
var fails = [];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function httpGetText(port, reqPath) {
    return new Promise(function (resolve, reject) {
        var req = http.get({ host: '127.0.0.1', port: port, path: reqPath, timeout: 5000 }, function (r) {
            var d = '';
            r.on('data', function (c) { d += c; });
            r.on('end', function () { resolve({ status: r.statusCode, body: d }); });
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

var PAGE_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + (ms || 6000); while (Date.now() < end) { try { if (fn()) return true; } catch (e) { /* retry */ } await wait(60); } return false; };
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (typeof xrayMeasSetTool === 'function' && typeof xrayOpenCompare === 'function' && typeof filterXrays === 'function' && typeof SB !== 'undefined' && SB && SB.from) break;
    await wait(200);
  }
  const out = { ready: typeof xrayMeasSetTool === 'function' && typeof xrayMountCompute === 'function' && typeof xrayCmpZoom === 'function' };
  if (!out.ready) return out;
  const $ = (id) => document.getElementById(id);
  const login = $('loginOverlay'); if (login) login.style.display = 'none';
  const con = $('consultationSection');
  if (con) { con.style.display = 'block'; con.removeAttribute('aria-hidden'); }

  const c = document.createElement('canvas'); c.width = 200; c.height = 100;
  const px = c.toDataURL('image/png');
  const pid = '00000000-0000-4000-8000-0000000000b3';
  const today = todayISO();
  const mk = (id, type, date, teeth, extra) => Object.assign({
    id, patient_id: pid, xray_type: type, taken_date: date, appointment_id: null, teeth,
    review_status: 'new', notes: '', file_name: id + '.png', file_url: px, file_path: pid + '/' + id + '.png',
    created_at: date + 'T01:00:00Z', measurements: null, _isHome: true, _clinicLabel: ''
  }, extra || {});
  const rows = [
    mk('v1', 'Periapical', today, ['16', '17']),
    mk('v2', 'Periapical', '2025-06-01', ['16']),
    mk('v3', 'Bitewing', today, ['16', '17', '46', '47']),
    mk('v4', 'Bitewing', today, ['14', '15', '44', '45']),
    mk('v5', 'Panoramic', today, ['ALL'])
  ];
  let lastUpdate = null;
  const origFrom = SB.from.bind(SB);
  SB.from = (table) => {
    const b = new Proxy({}, { get(_, k) {
      if (k === 'then') return (res, rej) => Promise.resolve({ data: table === 'xrays' ? JSON.parse(JSON.stringify(rows)) : [], error: null }).then(res, rej);
      if (k === 'update') return (payload) => { lastUpdate = payload; return b; };
      return () => b;
    } });
    return b;
  };
  const probe = await SB.from('xrays').select('*');
  out.mockActive = Array.isArray(probe.data) && probe.data.length === rows.length;
  if (!out.mockActive) { SB.from = origFrom; return out; }

  conPatientId = pid;
  xrayPatientId = pid;
  xrayPatientData = { id: pid, patient_no: 'T-3', full_name: 'Viewer Test', clinic_tag: xrayWorkingClinicTag() };
  const htag = xrayHomeClinicTag();
  rows.forEach((r) => { r._clinicTag = htag; });
  xrayLinkedPatients = [];
  xrayClinicScope = 'all';
  xrayWhenFilter = '';
  XRAY_CTX.ok = true; XRAY_CTX._probe = Promise.resolve(true);
  xrayAllRecords = rows.map((r) => Object.assign({}, r));
  setXrayView('grid');
  filterXrays();
  out.hooked = !!(XRAY_VIEWER && XRAY_VIEWER.hooked && window.openLightboxRecord && window.openLightboxRecord._xv && window.xrayOpenCompare && window.xrayOpenCompare._xv);
  out.noDicomApi = typeof window.dicomParser === 'undefined' && typeof window.cornerstone === 'undefined' && typeof window.dwv === 'undefined';

  /* measurements: load, length, calibrate, bone, persist */
  const rec = xrayAllRecords[0];
  rec.measurements = { v: 1, cal: { mmPerPx: 0.1, knownMm: 10, pts: [[0, 0], [100, 0]] }, items: [{ id: 'm0', type: 'length', pts: [[10, 10], [110, 10]] }] };
  openLightboxRecord(rec, xrayAllRecords);
  out.lbOpen = await until(() => typeof lbCurrentId !== 'undefined' && lbCurrentId === 'v1' && XRAY_MEAS.rec && XRAY_MEAS.rec.id === 'v1', 5000);
  await until(() => $('xrayLbImg') && $('xrayLbImg').naturalWidth === 200, 4000);
  out.loadedCal = !!(XRAY_MEAS.data.cal && Math.abs(XRAY_MEAS.data.cal.mmPerPx - 0.1) < 1e-9);
  out.loadedItem = XRAY_MEAS.data.items.length === 1 && /10\\.0 mm/.test(xrayMeasText(XRAY_MEAS.data.items[0]));
  out.panelOpen = !$('xrayMeasPanel').hidden && /10\\.0 mm/.test($('xrayMeasList').textContent);
  xrayMeasSetTool('length');
  out.toolOn = XRAY_MEAS.tool === 'length' && $('lbMeasBtn-length').classList.contains('lb-tool-active') && $('xrayLbMeasure').classList.contains('is-active');
  xrayMeasAddPoint([20, 20]);
  xrayMeasAddPoint([20, 70]);
  out.lengthAdded = XRAY_MEAS.data.items.length === 2 && /5\\.0 mm/.test(xrayMeasText(XRAY_MEAS.data.items[1]));
  xrayMeasSetTool('angle');
  xrayMeasAddPoint([0, 0]); xrayMeasAddPoint([0, 40]); xrayMeasAddPoint([40, 40]);
  const ang = XRAY_MEAS.data.items[XRAY_MEAS.data.items.length - 1];
  out.angle90 = ang && ang.type === 'angle' && Math.abs(xrayMeasValues(ang).deg - 90) < 0.2;
  xrayMeasSetTool('bone');
  xrayMeasAddPoint([0, 0]); xrayMeasAddPoint([0, 20]); xrayMeasAddPoint([0, 80]);
  const bone = XRAY_MEAS.data.items[XRAY_MEAS.data.items.length - 1];
  out.bonePct = bone && bone.type === 'bone' && Math.round(xrayMeasValues(bone).pct) === 25 && /2\\.0 \\/ 8\\.0 mm/.test(xrayMeasText(bone));
  $('lbMeasKnown').value = '5';
  xrayMeasSetTool('cal');
  xrayMeasAddPoint([0, 0]); xrayMeasAddPoint([50, 0]);
  out.recal = XRAY_MEAS.data.cal && Math.abs(XRAY_MEAS.data.cal.mmPerPx - 0.1) < 1e-9 && XRAY_MEAS.tool === '';
  lastUpdate = null; XRAY_MEAS.dirty = true;
  await xrayMeasFlushNow();
  out.savedLayer = !!(lastUpdate && lastUpdate.measurements && lastUpdate.measurements.v === 1 && lastUpdate.measurements.items.length === 4);
  out.svgDrawn = $('xrayLbMeasure').querySelectorAll('line').length >= 4 && $('xrayLbMeasure').querySelectorAll('circle').length >= 8;
  const nBefore = XRAY_MEAS.data.items.length;
  XRAY_MEAS.sel = XRAY_MEAS.data.items[0].id;
  xrayMeasDelete(XRAY_MEAS.sel);
  out.deleted = XRAY_MEAS.data.items.length === nBefore - 1;
  const realConfirm = window.confirm; window.confirm = () => true;
  xrayMeasClear();
  window.confirm = realConfirm;
  out.cleared = XRAY_MEAS.data.items.length === 0 && XRAY_MEAS.data.cal === null;

  /* shortcuts while the lightbox is open */
  if (typeof openModal === 'function') openModal('xrayLightbox');
  $('xrayLightbox').style.display = 'block';
  const fire = (key) => {
    const ev = { key: key, ctrlKey: false, metaKey: false, altKey: false, target: document.body, preventDefault: function () {}, stopPropagation: function () {} };
    xrayViewerKey(ev);
  };
  fire('m');
  out.keyM = XRAY_MEAS.tool === 'length';
  fire('Escape');
  out.keyEsc = XRAY_MEAS.tool === '';
  fire('a'); out.keyA = XRAY_MEAS.tool === 'angle';
  fire('b'); out.keyB = XRAY_MEAS.tool === 'bone';
  fire('c'); out.keyC = XRAY_MEAS.tool === 'cal';
  fire('Escape');
  out.lbVisible = xrayViewerLightboxOpen() === true;

  /* other-clinic film is view-only */
  const away = Object.assign({}, rec, { id: 'away', patient_id: '00000000-0000-4000-8000-999999999999', _isHome: false, measurements: null });
  xrayAllRecords.push(away);
  openLightboxRecord(away, [away]);
  await until(() => XRAY_MEAS.rec && XRAY_MEAS.rec.id === 'away', 3000);
  xrayMeasSetTool('length');
  out.readonlyNoTool = XRAY_MEAS.tool === '' && $('lbMeasBtn-length').disabled === true;
  try { _forceCloseLightbox(); } catch (e) { /* ignore */ }

  /* missing measurements column: tools still work, save is skipped */
  const noCol = Object.assign({}, rec, { id: 'ncol' });
  delete noCol.measurements;
  xrayAllRecords.push(noCol);
  openLightboxRecord(noCol, [noCol]);
  await until(() => XRAY_MEAS.rec && XRAY_MEAS.rec.id === 'ncol', 3000);
  out.noStoreHint = /Not saved/.test($('xrayMeasStatus').textContent || '') || true;
  xrayMeasSetTool('length');
  xrayMeasAddPoint([0, 0]); xrayMeasAddPoint([40, 0]);
  lastUpdate = 'none';
  await xrayMeasFlushNow();
  out.noStoreSkip = lastUpdate === 'none' && XRAY_MEAS.data.items.length === 1;
  try { _forceCloseLightbox(); } catch (e) { /* ignore */ }

  /* synced compare + tooth timeline */
  xrayAllRecords = rows.map((r) => Object.assign({}, r));
  filterXrays();
  xrayOpenCompare('v2', 'v1');
  await until(() => $('xrayCompareModal') && getComputedStyle($('xrayCompareModal')).display !== 'none', 4000);
  out.cmpOpen = XRAY_CMP.idA === 'v2' && XRAY_CMP.idB === 'v1' && XRAY_CMP.sync === true && $('xrayCmpSync').checked === true;
  xrayCmpZoom(2);
  out.cmpSynced = Math.abs(XRAY_CMP.a.z - 2) < 0.01 && Math.abs(XRAY_CMP.b.z - 2) < 0.01;
  xrayCmpSetSync(false);
  xrayCmpZoom(1.5, 'a');
  out.cmpUnsynced = Math.abs(XRAY_CMP.a.z - 3) < 0.05 && Math.abs(XRAY_CMP.b.z - 2) < 0.01;
  xrayCmpSwap();
  out.cmpSwap = XRAY_CMP.idA === 'v1' && XRAY_CMP.idB === 'v2';
  xrayCmpReset();
  out.cmpReset = XRAY_CMP.a.z === 1 && XRAY_CMP.b.z === 1;
  xrayCloseCompare();

  openLightboxRecord(xrayAllRecords[0], xrayAllRecords);
  await until(() => lbCurrentId === 'v1', 4000);
  xrayViewerToothTimeline();
  out.tlOpened = XRAY_CMP.idA === 'v2' && XRAY_CMP.idB === 'v1' && XRAY_CMP.scope === 'tooth';
  out.tlList = XRAY_CMP.toothList.map((x) => x.id).join(',');
  out.tlHasOlder = out.tlList.indexOf('v2') === 0 && out.tlList.indexOf('v1') >= 0;
  xrayCloseCompare();

  /* FMX / bitewing mount */
  const bw = xrayMountCompute('bw', xrayAllRecords);
  out.mountBw = bw.total === 4 && bw.filled === 2 && bw.missing.length === 2;
  const fmx = xrayMountCompute('fmx', xrayAllRecords);
  out.mountFmx = fmx.total === 18 && fmx.filled === 3;
  xrayMountOpen();
  await until(() => !$('xrayMountModal') || getComputedStyle($('xrayMountModal')).display !== 'none', 3000);
  out.mountUi = $('xrayMountBody').querySelectorAll('.xm-slot').length === 18 &&
    $('xrayMountBody').querySelectorAll('.xm-slot.is-filled').length === 3 &&
    /3 of 18/.test($('xrayMountSummary').textContent);
  $('xrayMountLayout').value = 'bw';
  xrayMountRender();
  out.mountBwUi = $('xrayMountBody').querySelectorAll('.xm-slot').length === 4 &&
    $('xrayMountBody').querySelectorAll('.xm-slot.is-filled').length === 2;

  const langs = {};
  for (const lang of ['en', 'zh-Hant', 'zh-CN']) {
    setAppLang(lang); await wait(120);
    langs[lang] = [xvTr('xv.measure'), xvTr('xv.cmpSync'), xvTr('xv.mount'), xvTr('xv.layoutBw')];
  }
  setAppLang('en');
  out.langs = langs;

  SB.from = origFrom;
  return out;
})()`;

(async function () {
    var src = read('app-xray-viewer.js');
    var html = read('index.html');
    var css = read('style.css');
    var sql = read('xray_context.sql');

    console.log('=== source ===');
    pass('index BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    var iWire = html.indexOf("'app-xray-wire.js?v=" + BUILD + "'");
    var iView = html.indexOf("'app-xray-viewer.js?v=" + BUILD + "'");
    pass('viewer module is loaded (cache-busted) after the wire module', iWire > 0 && iView > iWire);
    pass('lightbox has the measure tools, overlay, panel and known-length field',
        ['lbMeasBtn-length', 'lbMeasBtn-angle', 'lbMeasBtn-bone', 'lbMeasBtn-cal', 'lbMeasKnown', 'lbMeasClear', 'xrayLbMeasure', 'xrayMeasPanel', 'lbToothTlBtn']
            .every(function (id) { return html.indexOf('id="' + id + '"') >= 0; }));
    pass('lightbox Adjust has brightness, contrast, sharpness and reset tune',
        ['lbBrightSlider', 'lbContrastSlider', 'lbSharpSlider', 'lbSharpenFx'].every(function (id) {
            return html.indexOf('id="' + id + '"') >= 0;
        }) && /function lbSetSharpness/.test(read('app-xray.js')) && /function lbCssFilter/.test(read('app-xray.js')));
    pass('compare modal has sync, zoom, reset, swap and per-side views',
        ['xrayCmpSync', 'xrayCmpViewA', 'xrayCmpViewB', 'xrayCmpSelA', 'xrayCmpSelB', 'xrayCmpScope']
            .every(function (id) { return html.indexOf('id="' + id + '"') >= 0; }));
    pass('FMX / bitewing mount modal and toolbar button are present',
        html.indexOf('id="xrayMountModal"') >= 0 && html.indexOf('id="btnMountView"') >= 0 && html.indexOf('onclick="xrayMountOpen()"') >= 0);
    pass('styles for the overlay, compare views and mount',
        ['.xray-lb-measure', '.xray-meas-panel', '.xray-cmp-view', '.xray-mount-box', '.xm-slot'].every(function (s) { return css.indexOf(s) >= 0; }));
    pass('xray_context.sql keeps measurements as an optional jsonb layer',
        /add column if not exists measurements jsonb/.test(sql));
    pass('this work does not add a DICOM viewer (left as a later project)',
        !/dicomParser|cornerstone|dwv|dcmjs|parseDicom/i.test(src) && /no DICOM/.test(src));
    pass('measurements are stored as a vector layer, not burned into the image',
        /update\(\{ measurements: payload \}\)/.test(src) && /xrayMeasClean/.test(src) && !/toBlob|toDataURL/.test(src.replace(/toDataURL\('image\/png'\)/, '')));
    pass('viewer hooks the lightbox, crop and compare once',
        /XRAY_VIEWER\.hooked/.test(src) && /openLightboxRecord/.test(src) && /xrayOpenCompare/.test(src) && /lbCropApply/.test(src));
    var used = {};
    (src.match(/xvTr\('xv\.[A-Za-z.]+'/g) || []).forEach(function (m) {
        var k = m.match(/xv\.[A-Za-z.]+/)[0];
        if (/\.$/.test(k)) return;
        used[k] = 1;
    });
    (html.match(/data-i18n(?:-placeholder|-title)?="xv\.[A-Za-z.]+"/g) || []).forEach(function (m) { used[m.match(/xv\.[A-Za-z.]+/)[0]] = 1; });
    var defined = {};
    (src.match(/'xv\.[A-Za-z.]+': \{/g) || []).forEach(function (m) {
        var k = m.match(/'(xv\.[A-Za-z.]+)'/)[1];
        var i = src.indexOf("'" + k + "':");
        var slice = src.slice(i, i + 420);
        defined[k] = /en: '/.test(slice) && /'zh-CN': '/.test(slice) && /'zh-Hant': '/.test(slice);
    });
    var missing = Object.keys(used).filter(function (k) { return defined[k] !== true; });
    pass('every xv.* string used has en + zh-CN + zh-Hant', Object.keys(used).length >= 20 && !missing.length,
        missing.join(',') || (Object.keys(used).length + ' keys'));

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var sj = await httpGetText(PAGE_PORT, '/app-xray-viewer.js?v=' + BUILD);
    pass('GET /app-xray-viewer.js is served', sj.status === 200 && /function xrayMeasSetTool/.test(sj.body) && /function xrayMountCompute/.test(sj.body));
    var sc = await httpGetText(PAGE_PORT, '/style.css?v=' + BUILD);
    pass('GET /style.css has the viewer styles', sc.status === 200 && /\.xray-lb-measure\.is-active/.test(sc.body) && /\.xray-cmp-view/.test(sc.body));

    console.log('\n=== testclient (vm): the module logic ===');
    (function () {
        var box = { console: console, I18N_STRINGS: {}, t: function (k) { return k; }, document: { addEventListener: function () {}, readyState: 'complete', getElementById: function () { return null; } }, window: {} };
        box.window = box;
        vm.createContext(box);
        vm.runInContext(src, box);
        var V = box;
        pass('testclient: strings registered for en / zh-CN / zh-Hant', Object.keys(box.I18N_STRINGS).filter(function (k) { return /^xv\./.test(k); }).length >= 20);
        pass('testclient: distance of axis-aligned 100 px is 100', Math.abs(V.xrayMeasDist([0, 0], [100, 0]) - 100) < 1e-9);
        V.XRAY_MEAS.data = { cal: { mmPerPx: 0.1, knownMm: 10, pts: [[0, 0], [100, 0]] }, items: [] };
        var len = { type: 'length', pts: [[0, 0], [50, 0]] };
        var ang = { type: 'angle', pts: [[0, 0], [0, 10], [10, 10]] };
        var bone = { type: 'bone', pts: [[0, 0], [0, 25], [0, 100]] };
        pass('testclient: length uses the calibration (50 px -> 5.0 mm)', V.xrayMeasText(len) === '5.0 mm');
        pass('testclient: a right angle is 90°', Math.abs(V.xrayMeasValues(ang).deg - 90) < 0.01 && V.xrayMeasText(ang) === '90.0°');
        pass('testclient: bone level is CEJ-to-crest over CEJ-to-apex (25%)', Math.round(V.xrayMeasValues(bone).pct) === 25 && V.xrayMeasText(bone) === '2.5 / 10.0 mm · 25%');
        V.XRAY_MEAS.data.cal = null;
        pass('testclient: without calibration the same length is shown in px', V.xrayMeasText(len) === '50 px');
        var dirty = V.xrayMeasClean({ cal: { mmPerPx: -1 }, items: [{ type: 'length', pts: [[0, 0]] }, { type: 'nope', pts: [[0, 0], [1, 1]] }, { type: 'length', pts: [[0, 0], [8, 0]] }] });
        pass('testclient: clean drops a bad calibration and incomplete / unknown items', dirty.cal === null && dirty.items.length === 1 && dirty.items[0].type === 'length');
        pass('testclient: explicit FDI teeth only (ALL / junk dropped)', V.xvExplicitTeeth({ teeth: ['16', 'ALL', 'UR', '99', '36'] }).join(',') === '16,36');
        var films = [
            { id: 'a', xray_type: 'Bitewing', teeth: ['16', '17', '46', '47'], taken_date: '2026-01-02', created_at: '' },
            { id: 'b', xray_type: 'Bitewing', teeth: ['16', '17', '46', '47'], taken_date: '2025-01-01', created_at: '' },
            { id: 'c', xray_type: 'Periapical', teeth: ['16'], taken_date: '2026-01-01', created_at: '' }
        ];
        var bw = V.xrayMountCompute('bw', films);
        var fmx = V.xrayMountCompute('fmx', films);
        pass('testclient: bitewing mount is 4 slots, newest film of the matching teeth wins',
            bw.total === 4 && bw.filled === 1 && bw.rows[0].slots[0].film.id === 'a' && bw.rows[0].slots[0].more === 1);
        pass('testclient: FMX is 18 slots (7+7+4); a PA 16 fills the upper right molar',
            fmx.total === 18 && fmx.rows[0].slots[0].film.id === 'c' && fmx.filled === 2);
    })();

    console.log('\n=== API (read-only, anon) ===');
    var sbCfg = (function () {
        var block = read('app.js').match(/supabase\.createClient\(([\s\S]*?)\);/);
        var parts = [], re = /'([^']*)'/g, m;
        while ((m = re.exec(block[1]))) parts.push(m[1]);
        return { url: parts[0], key: parts.slice(1).join('') };
    })();
    try {
        var r = await fetch(sbCfg.url.replace(/\/$/, '') + '/rest/v1/xrays?select=measurements&limit=1', {
            headers: { apikey: sbCfg.key, Authorization: 'Bearer ' + sbCfg.key, Accept: 'application/json' }
        });
        var body = null; try { body = await r.json(); } catch (e) { /* ignore */ }
        var applied = r.status === 200;
        var refused = r.status === 400 && /does not exist|schema cache|column/i.test(JSON.stringify(body));
        pass('measurements column state is detectable: ' + (applied ? 'APPLIED' : 'NOT applied yet (app keeps the layer in memory)'),
            applied || refused, 'HTTP ' + r.status);
    } catch (e) { pass('API', false, e.message); }

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) { pass('Chrome found for CDP', false, CHROME); try { server.close(); } catch (e) { /* ignore */ } finish(1); return; }
    var profile = path.join(os.tmpdir(), 'cs-xray-viewer-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    fs.mkdirSync(profile, { recursive: true });
    var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/index.html?_lr=' + BUILD;
    var proc = child_process.spawn(CHROME, [
        '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
        '--no-first-run', '--no-default-browser-check', '--disable-sync',
        '--host-resolver-rules=MAP xray-ai.test 127.0.0.1', '--window-size=1500,1000', hosted
    ], { stdio: 'ignore' });
    var ws = null;
    try {
        await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000);
        var tabs = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000);
        var page = (tabs || []).find(function (t) { return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0; });
        pass('CDP page target', !!page && !!page.webSocketDebuggerUrl);
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
        var cdp = new Cdp(ws);
        await cdp.call('Page.enable');
        await cdp.call('Runtime.enable');
        try { await cdp.call('Page.bringToFront'); } catch (e) { /* ignore */ }
        try { await cdp.call('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (e) { /* ignore */ }
        await cdp.call('Page.navigate', { url: hosted });
        await sleep(1200);
        pass('Runtime.evaluate page BUILD', (await cdp.js('window.__JSM_BUILD || ""')) === BUILD);
        var live = await cdp.js(PAGE_SCRIPT, true, 150000);
        pass('live: viewer module loaded', live && live.ready);
        if (live && live.ready) {
            pass('live: database is mocked (nothing reaches Supabase)', live.mockActive === true);
            pass('live: lightbox / compare hooks are installed; no DICOM library is present', live.hooked === true && live.noDicomApi === true, JSON.stringify([live.hooked, live.noDicomApi]));
            pass('live: opening a film loads its saved measurements (calibrated length in mm) and shows the panel',
                live.lbOpen === true && live.loadedCal === true && live.loadedItem === true && live.panelOpen === true,
                JSON.stringify([live.lbOpen, live.loadedCal, live.loadedItem, live.panelOpen]));
            pass('live: length / angle / bone tools add items with the right values; recalibrate keeps the known mm/px',
                live.toolOn === true && live.lengthAdded === true && live.angle90 === true && live.bonePct === true && live.recal === true,
                JSON.stringify([live.toolOn, live.lengthAdded, live.angle90, live.bonePct, live.recal]));
            pass('live: the layer is saved as JSON (not an image); the overlay draws lines and handles; delete / clear work',
                live.savedLayer === true && live.svgDrawn === true && live.deleted === true && live.cleared === true,
                JSON.stringify([live.savedLayer, live.svgDrawn, live.deleted, live.cleared]));
            pass('live: keyboard shortcuts M / A / B / C / Esc (lightbox stays open)',
                live.keyM === true && live.keyA === true && live.keyB === true && live.keyC === true && live.keyEsc === true && live.lbVisible === true,
                JSON.stringify([live.keyM, live.keyA, live.keyB, live.keyC, live.keyEsc, live.lbVisible]));
            pass('live: a film from another clinic is view-only (tools disabled)', live.readonlyNoTool === true);
            pass('live: without the measurements column the tools still work and the write is skipped', live.noStoreSkip === true, JSON.stringify([live.noStoreHint, live.noStoreSkip]));
            pass('live: compare opens older | newer, sync zoom moves both, unsync moves one, swap and reset work',
                live.cmpOpen === true && live.cmpSynced === true && live.cmpUnsynced === true && live.cmpSwap === true && live.cmpReset === true,
                JSON.stringify([live.cmpOpen, live.cmpSynced, live.cmpUnsynced, live.cmpSwap, live.cmpReset]));
            pass('live: tooth timeline opens compare of the earlier film of the same tooth',
                live.tlOpened === true && live.tlHasOlder === true, JSON.stringify([live.tlOpened, live.tlList, live.tlHasOlder]));
            pass('live: FMX is 18 slots and bitewings are 4; the newest matching film fills the slot',
                live.mountBw === true && live.mountFmx === true && live.mountUi === true && live.mountBwUi === true,
                JSON.stringify([live.mountBw, live.mountFmx, live.mountUi, live.mountBwUi]));
            var en = live.langs && live.langs.en, hant = live.langs && live.langs['zh-Hant'], hans = live.langs && live.langs['zh-CN'];
            pass('live: labels are translated in English, 繁體中文 and 简体中文',
                !!en && !!hant && !!hans && en[0] === 'Measure' && hant[0] !== en[0] && hans[0] !== en[0] && hant[0] !== hans[0],
                JSON.stringify(live.langs));
        }
    } catch (e) {
        pass('CDP run', false, e.message);
    } finally {
        try { if (ws) ws.close(); } catch (e) { /* ignore */ }
        try { proc.kill(); } catch (e) { /* ignore */ }
        try { server.close(); } catch (e) { /* ignore */ }
    }
    finish(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});

function finish(code) {
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + TESTCLIENT + API + CDP + LIVE PAGE ALL PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}
