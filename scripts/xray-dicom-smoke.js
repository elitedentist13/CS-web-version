/**
 * Consultation > X-ray tab, in-house DICOM viewer (OHIF as checklist only).
 *  - parse uncompressed Explicit LE + honest transfer-syntax refusal
 *  - WW / WL render into the existing lightbox <img>
 *  - pixel-spacing auto-calibration for measurements
 *  - thumbs / compare / upload prefill stay on Banana wiring
 * Smoke (source) + HTTP spot + API (read-only, anon) + testclient (vm) + CDP Runtime.evaluate / live page.
 * Run: node scripts/xray-dicom-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261002cbb';
var PAGE_PORT = 8796;
var CDP_PORT = 9366;
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
    if (typeof xrayDicomParse === 'function' && typeof openLightboxRecord === 'function' && typeof SB !== 'undefined' && SB && SB.from) break;
    await wait(200);
  }
  const out = { ready: typeof xrayDicomParse === 'function' && typeof xrayDicomOpen === 'function' && typeof xrayDicomBuildUncompressed === 'function' };
  if (!out.ready) return out;
  const $ = (id) => document.getElementById(id);
  const login = $('loginOverlay'); if (login) login.style.display = 'none';
  const con = $('consultationSection');
  if (con) { con.style.display = 'block'; con.removeAttribute('aria-hidden'); }

  const bytes = xrayDicomBuildUncompressed({ rows: 16, cols: 32, spacing: 0.2, wc: 128, ww: 256 });
  const parsed = xrayDicomParse(bytes);
  out.parsedOk = !!(parsed && parsed.ok && parsed.decode && parsed.kind === 'raw');
  out.size = parsed.cols + 'x' + parsed.rows;
  out.spacing = parsed.mmPerPx;
  out.wl = [parsed.wc, parsed.ww];
  out.modality = parsed.modality || '';
  const bad = xrayDicomParse(new Uint8Array(200));
  out.rejectsJunk = !!(bad && bad.ok === false);
  const jp2 = xrayDicomParse(xrayDicomBuildUncompressed({ transferSyntax: '1.2.840.10008.1.2.4.90' }));
  out.refusesJpeg2000 = !!(jp2 && jp2.ok && jp2.decode === false && jp2.reason === 'syntax');

  const origFrom = SB.from.bind(SB);
  SB.from = (table) => {
    const b = new Proxy({}, { get(_, k) {
      if (k === 'then') return (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej);
      if (k === 'update') return () => b;
      return () => b;
    } });
    return b;
  };
  out.mockActive = true;

  const pid = '00000000-0000-4000-8000-0000000000d1';
  const rec = {
    id: 'dcm1', patient_id: pid, xray_type: 'Periapical', taken_date: '2026-10-02',
    appointment_id: null, teeth: ['16'], review_status: 'new', notes: '',
    file_name: 'sample.dcm', file_url: 'https://example.test/sample.dcm', file_path: pid + '/sample.dcm',
    created_at: '2026-10-02T01:00:00Z', measurements: null, _isHome: true, _clinicLabel: ''
  };
  XRAY_DICOM.cache[rec.id] = parsed;
  conPatientId = pid;
  xrayPatientId = pid;
  xrayPatientData = { id: pid, patient_no: 'T-D', full_name: 'Dicom Test', clinic_tag: (typeof xrayWorkingClinicTag === 'function' ? xrayWorkingClinicTag() : '') };
  xrayLinkedPatients = [];
  xrayClinicScope = 'all';
  xrayWhenFilter = '';
  if (typeof XRAY_CTX !== 'undefined') { XRAY_CTX.ok = true; XRAY_CTX._probe = Promise.resolve(true); }
  xrayAllRecords = [rec];
  xrayFiltered = [rec];
  if (typeof setXrayView === 'function') setXrayView('grid');
  if (typeof filterXrays === 'function') filterXrays();

  out.hooked = !!(XRAY_DICOM && XRAY_DICOM.hooked && window.openLightboxRecord && window.openLightboxRecord._xd && window.lbNeedsImagePersist && window.lbNeedsImagePersist._xd);
  out.noOhif = typeof window.OHIF === 'undefined' && typeof window.cornerstone === 'undefined' && typeof window.dicomParser === 'undefined';

  openLightboxRecord(rec, [rec]);
  out.lbOpen = await until(() => XRAY_DICOM.openId === 'dcm1' && $('lbDicomGroup') && $('lbDicomGroup').style.display !== 'none', 6000);
  await until(() => $('xrayLbImg') && $('xrayLbImg').naturalWidth === 32 && $('xrayLbImg').naturalHeight === 16, 6000);
  const img = $('xrayLbImg');
  out.painted = !!(img && img.naturalWidth === 32 && img.naturalHeight === 16 && /^blob:/.test(img.src || ''));
  out.cropOff = await until(() => $('lbTBtn-crop') && $('lbTBtn-crop').disabled === true, 4000);
  out.persistOff = typeof lbNeedsImagePersist === 'function' && lbNeedsImagePersist() === false;
  out.metaShown = await until(() => {
    const box = $('xrayDicomMeta');
    return !!(box && !box.hidden && /32/.test(box.textContent || '') && /IO/.test(box.textContent || ''));
  }, 4000);
  out.statusCal = /0\\.2000/.test(($('xrayDicomStatus').textContent || '') + ($('xrayMeasStatus').textContent || ''));
  out.autoCal = !!(XRAY_MEAS && XRAY_MEAS.data && XRAY_MEAS.data.cal && XRAY_MEAS.data.cal.source === 'dicom' && Math.abs(XRAY_MEAS.data.cal.mmPerPx - 0.2) < 1e-9);

  const src0 = img.src;
  xrayDicomOnWw(40);
  await until(() => $('xrayLbImg').src && $('xrayLbImg').src !== src0, 4000);
  out.wwChanged = $('xrayLbImg').src !== src0 && Math.round(XRAY_DICOM.view.dcm1.ww) === 40;
  xrayDicomResetWl();
  out.resetWl = Math.round(XRAY_DICOM.view.dcm1.ww) === 256 && Math.round(XRAY_DICOM.view.dcm1.wc) === 128;

  if (typeof xrayMeasSetTool === 'function') {
    xrayMeasSetTool('length');
    xrayMeasAddPoint([0, 0]);
    xrayMeasAddPoint([10, 0]);
    out.lengthMm = xrayMeasText(XRAY_MEAS.data.items[XRAY_MEAS.data.items.length - 1]);
  }

  const rec2 = Object.assign({}, rec, { id: 'dcm2', file_name: 'bad.dcm' });
  XRAY_DICOM.cache.dcm2 = jp2;
  xrayAllRecords = [rec, rec2];
  openLightboxRecord(rec2, [rec2]);
  out.unsupportedUi = await until(() => {
    const n = $('xrayDicomStatus');
    const m = $('xrayDicomMeta');
    return !!(n && /dedicated viewer|专用查看器|專用檢視器/i.test(n.textContent || '')) || !!(m && /dedicated viewer|专用查看器|專用檢視器/i.test(m.textContent || ''));
  }, 4000);

  try { _forceCloseLightbox(); } catch (e) { /* ignore */ }
  out.closed = XRAY_DICOM.openId === '' && $('lbDicomGroup').style.display === 'none';

  const file = {
    name: 'upload.dcm', type: 'application/dicom', xhDate: '', xhTypeGuess: '',
    arrayBuffer: () => Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  };
  if ($('uploadDate')) $('uploadDate').value = '';
  if ($('uploadType')) $('uploadType').value = 'Periapical';
  const pre = await xrayDicomPrefillUpload(file);
  out.prefillDate = $('uploadDate') && $('uploadDate').value === '2026-10-02';
  out.prefillType = $('uploadType') && $('uploadType').value === 'Periapical';
  out.prefillOk = !!(pre && pre.ok);

  out.langs = {
    en: (I18N_STRINGS['xd.unsupported'] || {}).en || '',
    'zh-CN': (I18N_STRINGS['xd.unsupported'] || {})['zh-CN'] || '',
    'zh-Hant': (I18N_STRINGS['xd.unsupported'] || {})['zh-Hant'] || ''
  };

  SB.from = origFrom;
  return out;
})()`;

(async function () {
    var src = read('app-xray-dicom.js');
    var viewer = read('app-xray-viewer.js');
    var xray = read('app-xray.js');
    var html = read('index.html');
    var css = read('style.css');

    console.log('=== source ===');
    pass('index BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    var iView = html.indexOf("'app-xray-viewer.js?v=" + BUILD + "'");
    var iDicom = html.indexOf("'app-xray-dicom.js?v=" + BUILD + "'");
    pass('DICOM module is loaded (cache-busted) after the viewer module', iView > 0 && iDicom > iView);
    pass('lightbox has WW / WL sliders, frame control, meta and status',
        ['lbDicomGroup', 'lbDicomWc', 'lbDicomWw', 'lbDicomWcVal', 'lbDicomWwVal', 'lbDicomFrame', 'lbDicomFrameWrap', 'xrayDicomMeta', 'xrayDicomStatus']
            .every(function (id) { return html.indexOf('id="' + id + '"') >= 0; }));
    pass('upload and local-folder accept .dcm and .dicom',
        html.indexOf('accept="image/*,.dcm,.dicom') >= 0 && /accept="image\/\*,\.dcm,\.dicom/.test(html));
    pass('styles for the DICOM toolbar and tag panel',
        ['.xd-meta', '.xd-status', '.xd-warn', '#lbDicomGroup'].every(function (s) { return css.indexOf(s) >= 0; }));
    pass('OHIF / cornerstone / dwv are not imported; this is the in-house decoder',
        !/cornerstone|dicomParser|dcmjs|\bdwv\b/i.test(src) &&
        !/ohif\.org|@ohif\//i.test(src) &&
        /OHIF\/Viewers is the clinical checklist only/.test(src));
    pass('viewer.js stays the measurement layer (no DICOM library)',
        /no DICOM/.test(viewer) && !/dicomParser|cornerstone|dwv|dcmjs/i.test(viewer));
    pass('grid / strips / filmstrip mark thumbs with data-xray-id',
        /data-xray-id/.test(xray) && /data-xray-id/.test(read('app-xray-link.js')));
    pass('DICOM is not re-uploaded as a JPEG when the lightbox is dirty',
        /xrayDicomIsOpen\(\)/.test(src) && /lbNeedsImagePersist/.test(src) &&
        /if \(xrayDicomIsOpen\(\)\) return false/.test(src));
    pass('hooks wrap lightbox, grid, compare, crop-persist and upload prefill',
        /XRAY_DICOM\.hooked/.test(src) && /openLightboxRecord/.test(src) && /xrayOpenCompare/.test(src) && /showUploadModal/.test(src));
    var used = {};
    (src.match(/xdTr\('xd\.[A-Za-z.]+'/g) || []).forEach(function (m) {
        var k = m.match(/xd\.[A-Za-z.]+/)[0];
        if (/\.$/.test(k)) return;
        used[k] = 1;
    });
    (html.match(/data-i18n(?:-placeholder|-title)?="xd\.[A-Za-z.]+"/g) || []).forEach(function (m) { used[m.match(/xd\.[A-Za-z.]+/)[0]] = 1; });
    var defined = {};
    (src.match(/'xd\.[A-Za-z.]+': \{/g) || []).forEach(function (m) {
        var k = m.match(/'(xd\.[A-Za-z.]+)'/)[1];
        var i = src.indexOf("'" + k + "':");
        var slice = src.slice(i, i + 520);
        defined[k] = /en: '/.test(slice) && /'zh-CN': '/.test(slice) && /'zh-Hant': '/.test(slice);
    });
    var missing = Object.keys(used).filter(function (k) { return defined[k] !== true; });
    pass('every xd.* string used has en + zh-CN + zh-Hant', Object.keys(used).length >= 12 && !missing.length,
        missing.join(',') || (Object.keys(used).length + ' keys'));

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var sj = await httpGetText(PAGE_PORT, '/app-xray-dicom.js?v=' + BUILD);
    pass('GET /app-xray-dicom.js is served', sj.status === 200 && /function xrayDicomParse/.test(sj.body) && /function xrayDicomOpen/.test(sj.body));
    var sc = await httpGetText(PAGE_PORT, '/style.css?v=' + BUILD);
    pass('GET /style.css has the DICOM styles', sc.status === 200 && /\.xd-meta/.test(sc.body) && /#lbDicomGroup/.test(sc.body));
    var idx = await httpGetText(PAGE_PORT, '/index.html?_lr=' + BUILD);
    pass('GET /index.html serves BUILD ' + BUILD, idx.status === 200 && idx.body.indexOf("BUILD = '" + BUILD + "'") >= 0);

    console.log('\n=== testclient (vm): parse / window / honesty ===');
    (function () {
        var box = {
            console: console,
            I18N_STRINGS: {},
            t: function (k) { return (box.I18N_STRINGS[k] && box.I18N_STRINGS[k].en) || k; },
            document: {
                addEventListener: function () {},
                readyState: 'complete',
                getElementById: function () { return null; },
                createElement: function () { return null; },
                querySelector: function () { return null; }
            },
            window: {},
            Uint8Array: Uint8Array,
            Float32Array: Float32Array,
            Blob: function () {},
            URL: { createObjectURL: function () { return 'blob:x'; }, revokeObjectURL: function () {} },
            Promise: Promise,
            fetch: function () { return Promise.reject(new Error('no')); }
        };
        box.window = box;
        vm.createContext(box);
        vm.runInContext(src, box);
        var V = box;
        pass('testclient: xd.* strings registered', Object.keys(box.I18N_STRINGS).filter(function (k) { return /^xd\./.test(k); }).length >= 12);
        var bytes = V.xrayDicomBuildUncompressed({ rows: 16, cols: 32, spacing: 0.2, wc: 128, ww: 256 });
        pass('testclient: builder writes DICM magic at 128', bytes[128] === 68 && bytes[129] === 73 && bytes[130] === 67 && bytes[131] === 77);
        var p = V.xrayDicomParse(bytes);
        pass('testclient: parse is ok, 32x16, Explicit LE',
            p.ok === true && p.decode === true && p.cols === 32 && p.rows === 16 && p.transferSyntax === V.XRAY_DICOM_TS.ELE,
            JSON.stringify([p.ok, p.reason, p.cols, p.rows, p.transferSyntax]));
        pass('testclient: pixel spacing is 0.2 mm and WW/WL come from the file',
            Math.abs(p.mmPerPx - 0.2) < 1e-9 && p.wc === 128 && p.ww === 256 && p.modality === 'IO',
            JSON.stringify([p.mmPerPx, p.wc, p.ww, p.modality]));
        pass('testclient: left pixel is dark and right pixel is bright after rescale',
            p.values[0] === 0 && p.values[31] === 255, JSON.stringify([p.values[0], p.values[31]]));
        pass('testclient: default window maps 0 / 128 / 255 to 0 / 128 / 255',
            V.xrayDicomWindowByte(0, 128, 256) === 0 && V.xrayDicomWindowByte(128, 128, 256) === 128 && V.xrayDicomWindowByte(255, 128, 256) === 255);
        var junk = V.xrayDicomParse(new Uint8Array(180));
        pass('testclient: a non-DICOM buffer is rejected', junk.ok === false && junk.reason === 'magic');
        var jp2 = V.xrayDicomParse(V.xrayDicomBuildUncompressed({ transferSyntax: '1.2.840.10008.1.2.4.90' }));
        pass('testclient: JPEG 2000 is reported, not silently decoded',
            jp2.ok === true && jp2.decode === false && jp2.reason === 'syntax' && jp2.supported === false);
        pass('testclient: modality IO prefills as Periapical; StudyDate becomes ISO',
            V.xdGuessType('IO') === 'Periapical' && V.xdGuessType('PX') === 'Panoramic' && V.xdDateIso('20261002') === '2026-10-02');
        pass('testclient: a JPEG-looking name is not treated as DICOM',
            V.xdLooksLikeName('film.jpg') === false && V.xdLooksLikeName('film.dcm') === true && V.xdLooksLikeRecord({ file_name: 'a.dcm' }) === true);
    })();

    console.log('\n=== API (read-only, anon) ===');
    var sbCfg = (function () {
        var block = read('app.js').match(/supabase\.createClient\(([\s\S]*?)\);/);
        var parts = [], re = /'([^']*)'/g, m;
        while ((m = re.exec(block[1]))) parts.push(m[1]);
        return { url: parts[0], key: parts.slice(1).join('') };
    })();
    try {
        var r = await fetch(sbCfg.url.replace(/\/$/, '') + '/rest/v1/xrays?select=id,file_name,file_path&limit=5', {
            headers: { apikey: sbCfg.key, Authorization: 'Bearer ' + sbCfg.key, Accept: 'application/json' }
        });
        var body = null; try { body = await r.json(); } catch (e) { /* ignore */ }
        var rows = Array.isArray(body) ? body : [];
        var dcmN = rows.filter(function (x) { return /\.(dcm|dicom)$/i.test(String((x && (x.file_name || x.file_path)) || '')); }).length;
        pass('xrays table is readable; DICOM files are optional rows (found ' + dcmN + ' in sample)',
            r.status === 200, 'HTTP ' + r.status + ' n=' + rows.length);
    } catch (e) { pass('API', false, e.message); }

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) { pass('Chrome found for CDP', false, CHROME); try { server.close(); } catch (e) { /* ignore */ } finish(1); return; }
    var profile = path.join(os.tmpdir(), 'cs-xray-dicom-cdp');
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
        pass('live: DICOM module loaded', live && live.ready);
        if (live && live.ready) {
            pass('live: database is mocked (nothing reaches Supabase)', live.mockActive === true);
            pass('live: in-house hooks are installed; OHIF / cornerstone are not present',
                live.hooked === true && live.noOhif === true, JSON.stringify([live.hooked, live.noOhif]));
            pass('live: synthetic Explicit LE file parses as 32x16 with 0.2 mm spacing',
                live.parsedOk === true && live.size === '32x16' && Math.abs(live.spacing - 0.2) < 1e-9 && live.modality === 'IO',
                JSON.stringify([live.parsedOk, live.size, live.spacing, live.modality, live.wl]));
            pass('live: junk bytes are rejected; JPEG 2000 is refused honestly',
                live.rejectsJunk === true && live.refusesJpeg2000 === true);
            pass('live: lightbox paints a blob image, shows tags, disables crop, and does not persist a JPEG',
                live.lbOpen === true && live.painted === true && live.metaShown === true && live.cropOff === true && live.persistOff === true,
                JSON.stringify([live.lbOpen, live.painted, live.metaShown, live.cropOff, live.persistOff]));
            pass('live: pixel spacing auto-calibrates measurements (10 px = 2.0 mm)',
                live.autoCal === true && live.statusCal === true && live.lengthMm === '2.0 mm',
                JSON.stringify([live.autoCal, live.statusCal, live.lengthMm]));
            pass('live: WW slider re-renders; File default restores the tag values',
                live.wwChanged === true && live.resetWl === true, JSON.stringify([live.wwChanged, live.resetWl]));
            pass('live: unsupported syntax tells the user to download / use a dedicated viewer',
                live.unsupportedUi === true);
            pass('live: closing the lightbox hides the DICOM chrome', live.closed === true);
            pass('live: upload prefill reads StudyDate and IO -> Periapical',
                live.prefillOk === true && live.prefillDate === true && live.prefillType === true,
                JSON.stringify([live.prefillOk, live.prefillDate, live.prefillType]));
            var en = live.langs && live.langs.en, hant = live.langs && live.langs['zh-Hant'], hans = live.langs && live.langs['zh-CN'];
            pass('live: unsupported-syntax copy exists in English, 繁體中文 and 简体中文',
                !!en && !!hant && !!hans && en !== hant && hans !== hant && /dedicated viewer/i.test(en),
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
