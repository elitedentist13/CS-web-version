/**
 * Consultation > X-ray tab, Phase 1: clinical context on every film.
 *  - xray_context.sql (linked visit, teeth FDI, review status) + safe fallback while it is not applied
 *  - upload modal + lightbox fields, tooth picker, badges (strips / grid / slide), status + tooth filters,
 *    a real "Visit" filter, toasts instead of alert(), audit trail stays automatic
 * Smoke (source) + HTTP spot + API (read-only, anon) + testclient (vm) + CDP Runtime.evaluate / live page.
 * Run: node scripts/xray-ctx-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261002cbc';
var PAGE_PORT = 8799;
var CDP_PORT = 9363;
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

var PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* Runs inside the page. Returns one object with every measurement. */
var PAGE_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + (ms || 6000); while (Date.now() < end) { try { if (fn()) return true; } catch (e) { /* retry */ } await wait(60); } return false; };
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (typeof setAppLang === 'function' && typeof xrayCtxFilter === 'function' && typeof filterXrays === 'function' && typeof SB !== 'undefined' && SB && SB.from) break;
    await wait(200);
  }
  const out = { ready: typeof xrayCtxFilter === 'function' && typeof filterXrays === 'function' };
  if (!out.ready) return out;
  const $ = (id) => document.getElementById(id);
  const login = $('loginOverlay'); if (login) login.style.display = 'none';
  const con = $('consultationSection');
  if (con) { con.style.display = 'block'; con.removeAttribute('aria-hidden'); }

  /* audit trail is automatic for the xrays table (SB.from is hooked) */
  out.auditTracked = typeof AUDIT_TRACK_TABLES !== 'undefined' && AUDIT_TRACK_TABLES.xrays === 1;
  const ab = SB.from('xrays').update({ notes: 'x' }).eq('id', 'audit-probe');
  out.auditHooked = !!(ab && ab._jsmAuditThenWrapped);

  const pid = '00000000-0000-4000-8000-0000000000a1';
  const today = todayISO();
  xrayPatientId = pid;
  xrayPatientData = { id: pid, patient_no: 'T-1', full_name: 'Test Patient', clinic_tag: xrayWorkingClinicTag() };
  const htag = xrayHomeClinicTag();
  xrayLinkedPatients = [];
  xrayClinicScope = 'all';
  xrayWhenFilter = '';
  XRAY_CTX.appts[pid] = { at: Date.now() + 1e9, rows: [
    { id: 'ap-today', date: today, start_time: '10:00:00', dentist_name: 'Dr A', treatment_items: 'Scaling' },
    { id: 'ap-old', date: '2025-01-05', start_time: '09:30:00', dentist_name: 'Dr B', treatment_items: 'Filling 36' }
  ] };
  const mk = (id, type, date, appt, teeth, st, extra) => Object.assign({
    id, patient_id: pid, xray_type: type, taken_date: date, appointment_id: appt, teeth, review_status: st,
    reviewed_by: null, reviewed_at: null, notes: 'note ' + id, file_name: id + '.png', file_url: window.__PX, file_path: pid + '/' + id + '.png',
    created_at: today + 'T01:00:00Z', _isHome: true, _clinicTag: htag, _clinicLabel: ''
  }, extra || {});
  const rows = [
    mk('x1', 'Bitewing', today, 'ap-today', ['16', '17'], 'new'),
    mk('x2', 'Periapical', '2025-01-05', 'ap-old', ['36'], 'reviewed', { reviewed_by: 'Dr A', reviewed_at: '2025-01-06T01:00:00Z' }),
    mk('x3', 'Panoramic', today, null, [], 'new'),
    mk('x4', 'Periapical', '2026-01-01', 'ap-today', ['46'], 'new'),
    mk('x5', 'Bitewing', today, 'ap-old', ['ALL'], 'new')
  ];
  xrayAllRecords = rows;
  XRAY_CTX.ok = null; XRAY_CTX._probe = null; XRAY_CTX.revFilter = ''; XRAY_CTX.toothFilter = [];
  const ids = () => xrayFiltered.map((x) => x.id).join(',');

  /* the records carry the new columns, so the fields switch on by themselves */
  setXrayView('grid');
  filterXrays();
  out.okFromRecords = XRAY_CTX.ok === true;
  out.fieldsShown = Array.from(document.querySelectorAll('.xray-ctx')).every((e) => !e.hidden) && Array.from(document.querySelectorAll('.xray-ctx-off')).every((e) => e.hidden);
  out.filtersShown = !$('xrayCtxFilters').hidden && !!$('xrayFilterTooth') && $('xrayCtxRevChips').querySelectorAll('[data-rev]').length === 3;
  out.allShown = ids() === 'x1,x2,x3,x4,x5';

  /* badges: grid, strips, slide */
  const card = (id) => document.querySelector('#xrayGridView .xray-card[data-id="' + id + '"]');
  out.gridTooth = !!card('x1') && /16, 17/.test(card('x1').textContent) && !!card('x1').querySelector('.xray-ctx-badge--tooth');
  out.gridVisit = !!card('x1').querySelector('.xray-ctx-badge--visit') && card('x1').querySelector('.xray-ctx-badge--visit').textContent.indexOf(today) >= 0;
  out.gridReviewed = !!card('x2').querySelector('.xray-ctx-badge--ok') && !card('x1').querySelector('.xray-ctx-badge--ok');
  out.gridPlain = !card('x3').querySelector('.xray-ctx-badge');
  setXrayView('strips');
  const tile = (id) => document.querySelector('#xrayClinicStrips .xray-strip-tile[data-id="' + id + '"]');
  out.stripsTiles = document.querySelectorAll('#xrayClinicStrips .xray-strip-tile').length;
  out.stripsBadges = !!tile('x1') && !!tile('x1').querySelector('.xray-ctx-badge--tooth') && !!tile('x2') && !!tile('x2').querySelector('.xray-ctx-badge--ok');
  setXrayView('slide');
  xrayCurrentIdx = 0; renderSlideAt(0);
  out.slideBadges = !!$('xraySlideCtx') && !$('xraySlideCtx').hidden && !!$('xraySlideCtx').querySelector('.xray-ctx-badge--tooth');
  renderSlideAt(2);
  out.slideEmptyHidden = $('xraySlideCtx').classList.contains('is-empty');
  setXrayView('grid');

  /* status + tooth filters */
  xrayCtxSetRev('new'); out.revNew = ids();
  xrayCtxSetRev('reviewed'); out.revRev = ids();
  out.revChipActive = $('xrayCtxRevChips').querySelector('[data-rev="reviewed"]').classList.contains('active');
  xrayCtxSetRev('');
  $('xrayFilterTooth').value = '16'; xrayCtxOnToothInput(); out.tooth16 = ids();
  $('xrayFilterTooth').value = '36, 46'; xrayCtxOnToothInput(); out.tooth3646 = ids();
  $('xrayFilterTooth').value = '99'; xrayCtxOnToothInput(); out.toothBad = ids();
  xrayCtxSetRev('new'); $('xrayFilterTooth').value = '46'; xrayCtxOnToothInput(); out.statusAndTooth = ids();
  xrayCtxSetRev(''); $('xrayFilterTooth').value = ''; xrayCtxOnToothInput(); out.cleared = ids();

  /* "Visit" = today's appointment (or, when not linked, taken today) */
  xraySetWhenFilter('visit'); out.visit = ids();
  xraySetWhenFilter(''); out.visitCleared = ids();

  /* lightbox */
  const lbRec = xrayAllRecords.find((x) => x.id === 'x2');
  openLightboxRecord(lbRec, xrayFiltered);
  out.lbOpen = await until(() => lbCurrentId === 'x2');
  out.lbFieldsShown = [$('lbAppt'), $('lbTeeth'), $('lbReviewStatus')].every((e) => !!e && e.offsetParent !== null);
  out.lbFilled = $('lbTeeth').value === '36' && $('lbReviewStatus').value === 'reviewed' && /Dr A/.test($('lbReviewInfo').textContent) && !$('lbReviewInfo').hidden;
  out.lbApptLoaded = await until(() => $('lbAppt').dataset.xcLoaded === '1' && $('lbAppt').value === 'ap-old');
  out.lbApptOptions = Array.from($('lbAppt').options).map((o) => o.value).join(',');
  /* save keeps the existing link while the list is still loading */
  _lbMetaDirty = false;
  $('lbTeeth').value = '36, 37'; $('lbTeeth').dispatchEvent(new Event('input', { bubbles: true }));
  out.lbDirty = _lbMetaDirty === true;
  $('lbReviewStatus').value = 'new'; $('lbAppt').value = 'ap-today';
  const meta = xrayCtxReadLightbox();
  out.lbRead = meta.appointment_id === 'ap-today' && JSON.stringify(meta.teeth) === '["36","37"]' && meta.review_status === 'new' && meta.reviewed_by === null && meta.reviewed_at === null;
  $('lbReviewStatus').value = 'reviewed';
  const lbRec1 = xrayAllRecords.find((x) => x.id === 'x1');
  openLightboxRecord(lbRec1, xrayFiltered);
  await until(() => lbCurrentId === 'x1');
  $('lbReviewStatus').value = 'reviewed';
  const meta2 = xrayCtxReadLightbox();
  out.lbReviewStamp = meta2.review_status === 'reviewed' && !!meta2.reviewed_at && /^\\d{4}-\\d\\d-\\d\\dT/.test(meta2.reviewed_at) && ('reviewed_by' in meta2);
  const b3 = $('lbAppt'); b3.dataset.xcLoaded = '';
  out.lbKeepsLinkWhileLoading = !('appointment_id' in xrayCtxReadLightbox());
  b3.dataset.xcLoaded = '1';

  /* mock the database writes (nothing is sent to Supabase) */
  const origFrom = SB.from.bind(SB);
  const origStorage = SB.storage;
  window.__writes = [];
  window.__missing = false;
  const CTXK = ['appointment_id', 'teeth', 'review_status', 'reviewed_by', 'reviewed_at'];
  const hasCtx = (b) => (Array.isArray(b) ? b : [b]).some((row) => row && CTXK.some((k) => k in row));
  SB.from = (table) => {
    if (table !== 'xrays') return origFrom(table);
    const st = { op: 'select', payload: null, filters: [] };
    const run = () => {
      if (st.op === 'select') return { data: JSON.parse(JSON.stringify(rows)), error: null };
      window.__writes.push({ op: st.op, body: JSON.parse(JSON.stringify(st.payload)), filters: st.filters.slice(), ctxRejected: window.__missing && hasCtx(st.payload) });
      if (window.__missing && hasCtx(st.payload)) return { data: null, error: { code: '42703', message: 'column "teeth" of relation "xrays" does not exist' } };
      return { data: Array.isArray(st.payload) ? st.payload : [st.payload], error: null };
    };
    const b = new Proxy({}, { get(_, k) {
      if (k === 'then') return (res, rej) => Promise.resolve(run()).then(res, rej);
      if (k === 'insert') return (p) => { st.op = 'insert'; st.payload = p; return b; };
      if (k === 'update') return (p) => { st.op = 'update'; st.payload = p; return b; };
      if (k === 'delete') return () => { st.op = 'delete'; return b; };
      if (k === 'eq') return (c, v) => { st.filters.push([c, v]); return b; };
      return () => b;
    } });
    return b;
  };
  window.__mockHits = 0;
  const mockStorage = { from: () => ({
    upload: async () => { window.__mockHits++; return { data: {}, error: null }; },
    getPublicUrl: (p) => ({ data: { publicUrl: 'https://example.invalid/' + p } }),
    remove: async () => ({ data: [], error: null })
  }) };
  try { SB.storage = mockStorage; } catch (e) { /* read-only */ }
  if (SB.storage !== mockStorage) { try { Object.defineProperty(SB, 'storage', { value: mockStorage, configurable: true, writable: true }); } catch (e) { /* ignore */ } }
  await SB.storage.from('xrays').upload('probe', null);
  const probeRows = await SB.from('xrays').select('*');
  out.mockActive = window.__mockHits === 1 && Array.isArray(probeRows.data) && probeRows.data.length === rows.length;
  if (!out.mockActive) { SB.from = origFrom; try { SB.storage = origStorage; } catch (e) { /* ignore */ } return out; }

  /* save from the lightbox: details + the context columns in one update */
  openLightboxRecord(lbRec, xrayFiltered);
  await until(() => lbCurrentId === 'x2' && $('lbAppt').dataset.xcLoaded === '1');
  $('lbTeeth').value = '36, 37'; $('lbReviewStatus').value = 'new'; $('lbAppt').value = 'ap-today';
  window.__writes = [];
  saveLbMeta();
  await until(() => window.__writes.length >= 1);
  const w = window.__writes[0] || {};
  out.saveUpdate = w.op === 'update' && w.filters.length === 1 && w.filters[0][0] === 'id' && w.filters[0][1] === 'x2' &&
    w.body.appointment_id === 'ap-today' && JSON.stringify(w.body.teeth) === '["36","37"]' && w.body.review_status === 'new' &&
    w.body.reviewed_by === null && w.body.reviewed_at === null && w.body.xray_type === 'Periapical';
  await wait(300);

  /* upload modal -> insert */
  const mkFile = () => new File([new Uint8Array([1, 2, 3, 4])], 'new-film.png', { type: 'image/png' });
  xrayUploadQueue = [mkFile()]; xrayUploadQIdx = 0;
  XRAY_CTX.ok = true;
  showUploadModal(xrayUploadQueue[0]);
  out.upOpened = await until(() => $('xrayUploadModal').classList.contains('open') || getComputedStyle($('xrayUploadModal')).display !== 'none');
  out.upFieldsShown = [$('uploadAppt'), $('uploadTeeth')].every((e) => e.offsetParent !== null);
  out.upApptLoaded = await until(() => $('uploadAppt').dataset.xcLoaded === '1' && Array.from($('uploadAppt').options).length === 3);
  out.upTodayPreselected = $('uploadAppt').value === 'ap-today';
  out.upTodayLabel = Array.from($('uploadAppt').options).some((o) => o.value === 'ap-today' && /Today|今天/.test(o.textContent));
  $('uploadDate').value = '2025-01-05'; $('uploadDate').dispatchEvent(new Event('change', { bubbles: true }));
  out.upDateFollows = $('uploadAppt').value === 'ap-old';
  $('uploadAppt').value = 'ap-today'; $('uploadAppt').dispatchEvent(new Event('change', { bubbles: true }));
  $('uploadDate').value = '2025-01-05'; $('uploadDate').dispatchEvent(new Event('change', { bubbles: true }));
  out.upManualKept = $('uploadAppt').value === 'ap-today';
  $('uploadDate').value = today;

  /* tooth picker */
  const pickBtn = document.querySelector('.xray-ctx-pick[data-xc-pick="uploadTeeth"]');
  pickBtn.click();
  const pk = $('xrayTeethPicker');
  out.pickerOpen = !pk.hidden && pk.querySelectorAll('.xtp-tooth').length === 32 && pk.dataset.target === 'uploadTeeth';
  const pr = pk.getBoundingClientRect();
  out.pickerOnScreen = pr.left >= 0 && pr.top >= 0 && pr.right <= innerWidth && pr.bottom <= innerHeight;
  pk.querySelector('[data-t="16"]').click(); pk.querySelector('[data-t="26"]').click(); pk.querySelector('[data-t="31"]').click();
  out.pickerWrites = $('uploadTeeth').value === '16, 26, 31' && pk.querySelector('[data-t="16"]').classList.contains('is-on');
  const unguard = (el) => { el.removeAttribute('data-last-click-ms'); return el; };
  unguard(pk.querySelector('[data-t="26"]')).click();
  out.pickerToggleOff = $('uploadTeeth').value === '16, 31';
  out.pickerOrder = Array.from(pk.querySelectorAll('.xtp-row')).map((r) => Array.from(r.querySelectorAll('.xtp-tooth')).map((b) => b.textContent).join(' ')).join(' | ');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  out.pickerEsc = pk.hidden === true;
  unguard(pickBtn).click(); unguard(pk.querySelector('.xtp-clear')).click(); out.pickerClear = $('uploadTeeth').value === '' && !pk.hidden;
  unguard(pk.querySelector('.xtp-done')).click(); out.pickerDone = pk.hidden === true;
  $('uploadTeeth').value = '16, 26';
  $('uploadType').value = 'Bitewing';
  window.__writes = [];
  confirmUpload();
  await until(() => window.__writes.length >= 1, 8000);
  const wi = window.__writes[0] || {};
  out.insertCtx = wi.op === 'insert' && wi.body[0].appointment_id === 'ap-today' && JSON.stringify(wi.body[0].teeth) === '["16","26"]' && wi.body[0].review_status === 'new' &&
    wi.body[0].patient_id === pid && wi.body[0].xray_type === 'Bitewing' && wi.body[0].file_name === 'new-film.png';
  await wait(1200);

  /* helper uploads (screen capture / scanners) pass no context: they link to the visit on the same date */
  window.__writes = [];
  await new Promise((resolve) => uploadSingleXrayFile(mkFile(), 'Other', today, 'helper', resolve, resolve));
  const wa = window.__writes[0] || {};
  out.autoLink = wa.op === 'insert' && wa.body[0].appointment_id === 'ap-today' && !('teeth' in wa.body[0]);
  window.__writes = [];
  await new Promise((resolve) => uploadSingleXrayFile(mkFile(), 'Other', '2031-02-03', 'helper', resolve, resolve));
  const wb = window.__writes[0] || {};
  out.autoNoVisit = wb.op === 'insert' && !('appointment_id' in wb.body[0]);

  /* columns missing in the database: first try is refused, the app retries without them and switches the fields off */
  window.__missing = true;
  XRAY_CTX.ok = true;
  window.__writes = [];
  const rr = await xrayCtxUpdate('x2', { notes: 'n', teeth: ['11'], review_status: 'reviewed' });
  out.fallbackWrites = window.__writes.length === 2 && window.__writes[0].ctxRejected === true && window.__writes[1].ctxRejected === false && !('teeth' in window.__writes[1].body) && window.__writes[1].body.notes === 'n';
  out.fallbackOk = !rr.error && XRAY_CTX.ok === false;
  out.fallbackHidden = Array.from(document.querySelectorAll('.xray-ctx')).every((e) => e.hidden) && Array.from(document.querySelectorAll('.xray-ctx-off')).every((e) => !e.hidden);
  out.fallbackNoBadge = xrayCtxBadgesHtml(rows[0]) === '' && xrayCtxFilter(rows[0]) === true && xrayCtxReadUpload() === null && Object.keys(xrayCtxReadLightbox()).length === 0;
  window.__writes = [];
  await xrayCtxUpdate('x2', { notes: 'n2', teeth: ['11'] });
  out.fallbackRemembered = window.__writes.length === 1 && !('teeth' in window.__writes[0].body);
  window.__writes = [];
  await xrayCtxInsert({ patient_id: pid, xray_type: 'Other' }, { appointment_id: 'ap-today', teeth: ['11'] }, pid, today);
  out.fallbackInsert = window.__writes.length === 1 && !('appointment_id' in window.__writes[0].body[0]) && window.__writes[0].body[0].xray_type === 'Other';
  $('xrayUploadModal').classList.remove('open');

  /* toasts instead of blocking alert() */
  let alerts = 0; const realAlert = window.alert; window.alert = () => { alerts++; };
  xraySelected.clear();
  exportSelectedXrays();
  const toast = $('appGlobalToast');
  out.toastShown = !!toast && toast.classList.contains('app-global-toast--in') && toast.textContent.length > 3;
  out.toastText = toast ? toast.textContent : '';
  downloadFile('', 'x.jpg');
  out.toastNoUrl = !!toast && toast.textContent.length > 3;
  xrayNotify('Upload failed: network');
  out.toastErr = toast.classList.contains('app-global-toast--err') && toast.textContent === 'Upload failed: network';
  xrayNotify('Saved');
  out.toastInfo = !toast.classList.contains('app-global-toast--err') && toast.textContent === 'Saved';
  out.alertCalls = alerts;
  window.alert = realAlert;

  /* the three languages */
  const lbls = {};
  for (const lang of ['en', 'zh-Hant', 'zh-CN']) {
    setAppLang(lang); await wait(200);
    lbls[lang] = {
      visit: document.querySelector('#xrayUploadModal label[data-i18n="xc.visit"]').textContent,
      teeth: document.querySelector('#xrayUploadModal label[data-i18n="xc.teeth"]').textContent,
      chip: document.querySelector('#xrayCtxRevChips [data-rev="new"]').textContent,
      ph: $('xrayFilterTooth').placeholder,
      opt: $('lbReviewStatus').options[1].textContent
    };
  }
  setAppLang('en');
  out.langs = lbls;

  /* put everything back */
  SB.from = origFrom; SB.storage = origStorage;
  return out;
})()`;

(async function () {
    var ctxSrc = read('app-xray-ctx.js');
    var xraySrc = read('app-xray.js');
    var linkSrc = read('app-xray-link.js');
    var html = read('index.html');
    var css = read('style.css');
    var sql = read('xray_context.sql');

    console.log('=== source ===');
    pass('index BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    var iLink = html.indexOf("'app-xray-link.js?v=");
    var iCtx = html.indexOf("'app-xray-ctx.js?v=");
    pass('x-ray context module is loaded (cache-busted) right after the link module', iLink > 0 && iCtx > iLink && html.indexOf("app-xray-ctx.js?v=" + BUILD) >= 0);
    pass('every changed x-ray script has a fresh cache-buster',
        ['app-xray.js', 'app-xray-capture.js', 'app-xray-link.js', 'app-nnt-scans.js', 'app-xray-ai.js'].every(function (f) {
            return html.indexOf("'" + f + '?v=' + BUILD + "'") >= 0;
        }));
    pass('upload modal, lightbox, filters and slide host have the context fields',
        ['uploadAppt', 'uploadTeeth', 'lbAppt', 'lbTeeth', 'lbReviewStatus', 'lbReviewInfo', 'xrayCtxFilters', 'xrayCtxRevChips', 'xrayFilterTooth', 'xraySlideCtx', 'lbTeethPick']
            .every(function (id) { return html.indexOf('id="' + id + '"') >= 0; }));
    pass('the fields stay hidden until the columns exist (xray-ctx / xray-ctx-off + [hidden] rule)',
        /\.xray-ctx\[hidden\]/.test(css) && (html.match(/class="[^"]*xray-ctx[^"]*"[^>]*hidden/g) || []).length >= 8);
    pass('xray_context.sql is idempotent and adds every column used by the module',
        XRAY_CTX_COLS().every(function (c) { return sql.indexOf(c) >= 0; }) &&
        /add column if not exists/i.test(sql) && /notify pgrst, 'reload schema'/i.test(sql) &&
        /review_status[\s\S]{0,200}'new'/.test(sql) && /check \(review_status in \('new', 'reviewed'\)\)/.test(sql));
    pass('migration does not touch policies, buckets or other tables',
        !/create\s+policy|alter\s+policy|drop\s+policy|storage\.|create\s+bucket|enable row level/i.test(sql) && !/alter table public\.(?!xrays)/i.test(sql));
    function XRAY_CTX_COLS() { return ['appointment_id', 'teeth', 'review_status', 'reviewed_by', 'reviewed_at']; }
    pass('module keys match the SQL columns', /var XRAY_CTX_KEYS = \['appointment_id', 'teeth', 'review_status', 'reviewed_by', 'reviewed_at'\]/.test(ctxSrc));
    pass('upload path: confirmUpload reads the fields, uploadSingleXrayFile inserts through the fallback writer',
        /var ctx\s*=\s*\(typeof xrayCtxReadUpload === 'function'\)/.test(xraySrc) &&
        /function uploadSingleXrayFile\(file, type, date, notes, onDone, onError, ctx\)/.test(xraySrc) &&
        xraySrc.indexOf('xrayCtxInsert(row, ctx, destId, date)') >= 0);
    pass('lightbox path: fields filled on open, merged into both save payloads, written through the fallback writer',
        xraySrc.indexOf('xrayCtxFillLightbox(x)') >= 0 && (xraySrc.match(/xrayCtxMergeMeta\(\{/g) || []).length === 2 &&
        /function xrayUpdateRecord[\s\S]{0,200}xrayCtxUpdate/.test(xraySrc) && xraySrc.indexOf("SB.from('xrays').update(") < xraySrc.indexOf('function xrayUpdateRecord') + 400);
    pass('strips, grid and slide views draw the badges; filterXrays applies the status / tooth filters',
        linkSrc.indexOf('xrayCtxBadgesHtml(x)') >= 0 && xraySrc.indexOf('xrayCtxBadgesHtml(x)') >= 0 && xraySrc.indexOf('xrayCtxPaintSlide(x)') >= 0 &&
        linkSrc.indexOf('xrayCtxFilter(x)') >= 0 && linkSrc.indexOf('xrayCtxSync()') >= 0);
    pass('"Visit" filter uses the linked appointment when there is one', linkSrc.indexOf('xrayCtxMatchesVisit(x, d, today)') >= 0);
    var bare = /(?<![\w.])alert\(/g;
    var left = { 'app-xray.js': xraySrc, 'app-xray-link.js': linkSrc, 'app-xray-ai.js': read('app-xray-ai.js'), 'app-xray-capture.js': read('app-xray-capture.js'), 'app-nnt-scans.js': read('app-nnt-scans.js') };
    var leftN = Object.keys(left).map(function (f) { return f + ':' + (left[f].match(bare) || []).length; });
    pass('no blocking alert() left in the x-ray tab scripts (only window.alert fallback inside the toast helper)',
        Object.keys(left).every(function (f) { return (left[f].match(bare) || []).length === 0; }) && /window\.alert\(text\)/.test(xraySrc) && html.indexOf("alert('MyRay") < 0 && html.indexOf("alert('Digirex") < 0,
        leftN.join(' '));
    var auditSrc = read('app-audit.js');
    pass('audit trail already hooks every xrays insert / update / delete (SB.from wrapper), so the new writes are logged too',
        /xrays: 1/.test(auditSrc) && /wrapAuditBuilder/.test(auditSrc));
    var keysIn = {};
    (ctxSrc.match(/'xc\.[A-Za-z]+'/g) || []).forEach(function (k) { keysIn[k.slice(1, -1)] = 1; });
    var usedKeys = {};
    (html.match(/data-i18n(?:-placeholder|-title)?="xc\.[A-Za-z]+"/g) || []).forEach(function (m) { usedKeys[m.match(/xc\.[A-Za-z]+/)[0]] = 1; });
    (ctxSrc.match(/xrayCtxTr\('xc\.[A-Za-z]+'\)/g) || []).forEach(function (m) { usedKeys[m.match(/xc\.[A-Za-z]+/)[0]] = 1; });
    var defined = {};
    (ctxSrc.match(/'xc\.[A-Za-z]+': \{.*\}/g) || []).forEach(function (m) {
        var k = m.match(/'(xc\.[A-Za-z]+)'/)[1];
        defined[k] = /en: '/.test(m) && /'zh-CN': '/.test(m) && /'zh-Hant': '/.test(m);
    });
    pass('every xc.* string used has en + zh-CN + zh-Hant',
        Object.keys(usedKeys).length >= 15 && Object.keys(usedKeys).every(function (k) { return defined[k] === true; }),
        Object.keys(usedKeys).filter(function (k) { return defined[k] !== true; }).join(',') || (Object.keys(usedKeys).length + ' keys'));

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var sp = await httpGetText(PAGE_PORT, '/app-xray-ctx.js?v=' + BUILD);
    pass('GET /app-xray-ctx.js is served', sp.status === 200 && /function xrayCtxWrite/.test(sp.body));
    var sq = await httpGetText(PAGE_PORT, '/xray_context.sql');
    pass('GET /xray_context.sql is served', sq.status === 200 && /review_status/.test(sq.body));
    var sc = await httpGetText(PAGE_PORT, '/style.css?v=' + BUILD);
    pass('GET /style.css has the badge, picker and filter styles', sc.status === 200 && /\.xray-ctx-badge--tooth/.test(sc.body) && /\.xtp-tooth\.is-on/.test(sc.body) && /\.xray-teeth-picker/.test(sc.body));

    console.log('\n=== testclient (vm): the module logic ===');
    await (function () {
        var calls = [];
        var apptRows = { P1: [{ id: 'A1', date: '2026-10-02' }, { id: 'A0', date: '2026-01-01' }] };
        var box = {
            console: console, Promise: Promise, Date: Date, Object: Object, Array: Array, String: String, JSON: JSON, Math: Math, Event: function () {},
            t: function (k) { return k; }, esc: undefined, todayISO: function () { return '2026-10-02'; },
            I18N_STRINGS: {}, currentName: 'Dr X',
            SB: { from: function (tbl) {
                var b = { select: function () { return b; }, eq: function () { return b; }, order: function () { return b; }, limit: function () { return b; },
                    then: function (res, rej) { return Promise.resolve({ data: apptRows.P1, error: null }).then(res, rej); } };
                return b;
            } }
        };
        vm.createContext(box);
        vm.runInContext(ctxSrc, box);
        var C = box;
        pass('testclient: strings registered for en / zh-CN / zh-Hant', Object.keys(box.I18N_STRINGS).filter(function (k) { return /^xc\./.test(k); }).length >= 15);
        pass('testclient: teeth parse keeps valid FDI / quadrant tokens, drops junk and duplicates',
            JSON.stringify(C.xrayCtxParseTeeth('16, 24; 36 99 ALL ur 16 1 ,')) === '["16","24","36","ALL","UR"]' &&
            C.xrayCtxTeethText(['11', '21']) === '11, 21' && C.xrayCtxTeethText(null) === '');
        var body = C.xrayCtxStrip({ a: 1, teeth: [], appointment_id: 'x', review_status: 'new', reviewed_by: 'u', reviewed_at: 't' });
        pass('testclient: optional columns are stripped, ordinary fields kept', JSON.stringify(body) === '{"a":1}' && C.xrayCtxHasKeys({ teeth: [] }) === true && C.xrayCtxHasKeys({ a: 1 }) === false);
        pass('testclient: missing-column errors are recognised',
            C.xrayCtxIsMissingColErr({ code: '42703' }) && C.xrayCtxIsMissingColErr({ code: 'PGRST204' }) &&
            C.xrayCtxIsMissingColErr({ message: 'Could not find the \'teeth\' column of \'xrays\' in the schema cache' }) && !C.xrayCtxIsMissingColErr({ code: '23505', message: 'duplicate' }) && !C.xrayCtxIsMissingColErr(null));
        return (async function () {
            var sent = [];
            var op = function (b) { sent.push(JSON.parse(JSON.stringify(b))); return Promise.resolve(sent.length === 1 ? { error: { code: '42703', message: 'column does not exist' } } : { error: null }); };
            var r1 = await C.xrayCtxWrite(op, { n: 1, teeth: ['11'] });
            pass('testclient: first write refused for a missing column -> retried without the new fields, state remembered as off',
                sent.length === 2 && sent[0].teeth && !('teeth' in sent[1]) && r1.error === null && C.XRAY_CTX.ok === false);
            sent.length = 0;
            await C.xrayCtxWrite(function (b) { sent.push(b); return Promise.resolve({ error: null }); }, { n: 2, teeth: ['11'] });
            pass('testclient: once off, later writes drop the fields at once (no refused attempt)', sent.length === 1 && !('teeth' in sent[0]));
            C.XRAY_CTX.ok = null; sent.length = 0;
            await C.xrayCtxWrite(function (b) { sent.push(b); return Promise.resolve({ error: null }); }, { n: 3, teeth: ['11'] });
            pass('testclient: a successful write with the fields proves they exist (state on)', C.XRAY_CTX.ok === true && sent[0].teeth);
            C.XRAY_CTX.ok = null;
            await C.xrayCtxWrite(function () { return Promise.resolve({ error: null }); }, { n: 4 });
            pass('testclient: a write without the fields does not change the state', C.XRAY_CTX.ok === null);
            var realErr = await C.xrayCtxWrite(function () { return Promise.resolve({ error: { code: '23505', message: 'dup' } }); }, { n: 5, teeth: ['11'] });
            pass('testclient: other database errors are returned untouched and keep the state', realErr.error.code === '23505' && C.XRAY_CTX.ok === null);

            C.XRAY_CTX.ok = true;
            var auto = await C.xrayCtxResolve(null, 'P1', '2026-10-02');
            var autoNone = await C.xrayCtxResolve(null, 'P1', '2030-01-01');
            var explicit = await C.xrayCtxResolve({ appointment_id: null, teeth: ['16'] }, 'P1', '2026-10-02');
            pass('testclient: films without a pick link to the visit on the same date; none when there is no visit; explicit picks win',
                auto.appointment_id === 'A1' && JSON.stringify(autoNone) === '{}' && explicit.teeth[0] === '16' && explicit.appointment_id === null);
            C.XRAY_CTX.ok = false;
            pass('testclient: with the columns off nothing is added', JSON.stringify(await C.xrayCtxResolve({ teeth: ['11'] }, 'P1', '2026-10-02')) === '{}');

            C.XRAY_CTX.ok = true; C.XRAY_CTX.revFilter = ''; C.XRAY_CTX.toothFilter = [];
            var f = function (x) { return C.xrayCtxFilter(x); };
            C.XRAY_CTX.revFilter = 'new';
            var f1 = f({ review_status: 'new' }) && f({}) && !f({ review_status: 'reviewed' });
            C.XRAY_CTX.revFilter = 'reviewed';
            var f2 = f({ review_status: 'reviewed' }) && !f({ review_status: 'new' });
            C.XRAY_CTX.revFilter = ''; C.XRAY_CTX.toothFilter = ['16', '26'];
            var f3 = f({ teeth: ['26'] }) && f({ teeth: ['ALL'] }) && !f({ teeth: ['11'] }) && !f({ teeth: [] }) && !f({});
            pass('testclient: status filter (a film with no status counts as "to review") and tooth filter (ALL matches every tooth)', f1 && f2 && f3);
            C.XRAY_CTX.toothFilter = [];
            C.XRAY_CTX.appts.P1 = { at: Date.now() + 1e9, rows: apptRows.P1 };
            var today = '2026-10-02';
            pass('testclient: visit filter - linked to today\'s visit counts whatever the film date; linked to an older visit does not even if taken today; unlinked uses the date',
                C.xrayCtxMatchesVisit({ patient_id: 'P1', appointment_id: 'A1' }, '2026-01-01', today) === true &&
                C.xrayCtxMatchesVisit({ patient_id: 'P1', appointment_id: 'A0' }, today, today) === false &&
                C.xrayCtxMatchesVisit({ patient_id: 'P1' }, today, today) === true && C.xrayCtxMatchesVisit({ patient_id: 'P1' }, '2025-05-05', today) === false);
            var hb = C.xrayCtxBadgesHtml({ patient_id: 'P1', teeth: ['11', '12', '13', '14', '15'], appointment_id: 'A1', review_status: 'reviewed' });
            pass('testclient: badges show up to 4 teeth (+N), the visit date and the reviewed mark; nothing for a plain film / while off',
                /11, 12, 13, 14 \+1/.test(hb) && hb.indexOf('2026-10-02') >= 0 && /xray-ctx-badge--ok/.test(hb) &&
                C.xrayCtxBadgesHtml({ patient_id: 'P1' }) === '' && (C.XRAY_CTX.ok = false, C.xrayCtxBadgesHtml({ teeth: ['11'] }) === ''));
            C.XRAY_CTX.ok = true;
        })();
    })().catch(function (e) { pass('testclient', false, e && e.message); });

    console.log('\n=== API (read-only, anon) ===');
    var sbCfg = (function () {
        var block = read('app.js').match(/supabase\.createClient\(([\s\S]*?)\);/);
        var parts = [], re = /'([^']*)'/g, m;
        while ((m = re.exec(block[1]))) parts.push(m[1]);
        return { url: parts[0], key: parts.slice(1).join('') };
    })();
    async function rest(p) {
        var r = await fetch(sbCfg.url.replace(/\/$/, '') + '/rest/v1/' + p, { headers: { apikey: sbCfg.key, Authorization: 'Bearer ' + sbCfg.key, Accept: 'application/json' } });
        var body = null; try { body = await r.json(); } catch (e) { /* ignore */ }
        return { status: r.status, body: body };
    }
    try {
        var xr = await rest('xrays?select=*&limit=3&order=created_at.desc');
        pass('xrays table readable', xr.status === 200 && Array.isArray(xr.body), 'HTTP ' + xr.status + ', ' + (xr.body && xr.body.length) + ' rows');
        var cols = await rest('xrays?select=appointment_id,teeth,review_status,reviewed_by,reviewed_at&limit=1');
        var applied = cols.status === 200;
        var refused = cols.status === 400 && /does not exist|schema cache|column/i.test(JSON.stringify(cols.body));
        pass('xray_context.sql state is detectable: ' + (applied ? 'APPLIED (columns exist)' : 'NOT applied yet (columns refused, app falls back)'), applied || refused, 'HTTP ' + cols.status + ' ' + JSON.stringify(cols.body).slice(0, 120));
        if (applied && xr.body && xr.body.length) {
            pass('applied: existing films default to review_status new and an empty teeth list',
                xr.body.every(function (r) { return r.review_status === 'new' || r.review_status === 'reviewed'; }) && xr.body.every(function (r) { return Array.isArray(r.teeth); }));
        }
        var ap = await rest('appointments?select=id,date,start_time,dentist_name,doctor_code,treatment_items&limit=3&order=date.desc');
        pass('appointments readable with the columns the visit picker selects', ap.status === 200 && Array.isArray(ap.body), 'HTTP ' + ap.status);
    } catch (e) { pass('API', false, e.message); }

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) { pass('Chrome found for CDP', false, CHROME); try { server.close(); } catch (e) { /* ignore */ } finish(1); return; }
    var profile = path.join(os.tmpdir(), 'cs-xray-ctx-cdp');
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
        await cdp.js('window.__PX = ' + JSON.stringify(PX) + ';');
        var live = await cdp.js(PAGE_SCRIPT, true, 150000);

        pass('live: x-ray module + context module loaded', live && live.ready);
        if (live && live.ready) {
            pass('live: audit trail is hooked for the xrays table (inserts / updates / deletes are logged automatically)', live.auditTracked === true && live.auditHooked === true, JSON.stringify([live.auditTracked, live.auditHooked]));
            pass('live: films that carry the new columns switch the fields on by themselves', live.okFromRecords === true && live.fieldsShown === true && live.filtersShown === true && live.allShown === true,
                JSON.stringify([live.okFromRecords, live.fieldsShown, live.filtersShown, live.allShown]));
            pass('live: grid cards show tooth, visit date and reviewed badges (none for a plain film)', live.gridTooth === true && live.gridVisit === true && live.gridReviewed === true && live.gridPlain === true,
                JSON.stringify([live.gridTooth, live.gridVisit, live.gridReviewed, live.gridPlain]));
            pass('live: strips tiles and the slide view show the badges', live.stripsTiles === 5 && live.stripsBadges === true && live.slideBadges === true && live.slideEmptyHidden === true,
                JSON.stringify([live.stripsTiles, live.stripsBadges, live.slideBadges, live.slideEmptyHidden]));
            pass('live: status chips filter (to review / reviewed) and the active chip is marked', live.revNew === 'x1,x3,x4,x5' && live.revRev === 'x2' && live.revChipActive === true, JSON.stringify([live.revNew, live.revRev, live.revChipActive]));
            pass('live: tooth filter matches listed teeth (ALL matches every tooth), unknown tooth shows nothing, combines with status, clears',
                live.tooth16 === 'x1,x5' && live.tooth3646 === 'x2,x4,x5' && live.toothBad === '' && live.statusAndTooth === 'x4,x5' && live.cleared === 'x1,x2,x3,x4,x5',
                JSON.stringify([live.tooth16, live.tooth3646, live.toothBad, live.statusAndTooth, live.cleared]));
            pass('live: "Visit" chip = films of today\'s appointment, or unlinked films taken today (not a film linked to an older visit)', live.visit === 'x1,x3,x4' && live.visitCleared === 'x1,x2,x3,x4,x5', JSON.stringify([live.visit, live.visitCleared]));
            pass('live: lightbox shows visit, teeth and review status (with who / when) for the opened film',
                live.lbOpen === true && live.lbFieldsShown === true && live.lbFilled === true && live.lbApptLoaded === true && live.lbApptOptions === ',ap-today,ap-old',
                JSON.stringify([live.lbOpen, live.lbFieldsShown, live.lbFilled, live.lbApptLoaded, live.lbApptOptions]));
            pass('live: editing a field marks the lightbox as changed; the save payload carries visit, teeth and status; marking reviewed stamps who / when; the link is kept while the visit list loads',
                live.lbDirty === true && live.lbRead === true && live.lbReviewStamp === true && live.lbKeepsLinkWhileLoading === true,
                JSON.stringify([live.lbDirty, live.lbRead, live.lbReviewStamp, live.lbKeepsLinkWhileLoading]));
            pass('live: database + storage are mocked for the write tests (nothing reaches Supabase)', live.mockActive === true);
            pass('live: Save from the lightbox sends ONE update with the film details and the context fields', live.saveUpdate === true);
            pass('live: upload modal shows the visit (today preselected, "Today" label) and teeth fields; the visit follows the date unless picked by hand',
                live.upOpened === true && live.upFieldsShown === true && live.upApptLoaded === true && live.upTodayPreselected === true && live.upTodayLabel === true && live.upDateFollows === true && live.upManualKept === true,
                JSON.stringify([live.upOpened, live.upFieldsShown, live.upApptLoaded, live.upTodayPreselected, live.upTodayLabel, live.upDateFollows, live.upManualKept]));
            pass('live: tooth picker - upper 18-11 | 21-28, lower 48-41 | 31-38; click toggles into the field, stays on screen, Clear / Done / Esc work',
                live.pickerOpen === true && live.pickerOnScreen === true && live.pickerWrites === true && live.pickerToggleOff === true && live.pickerEsc === true && live.pickerClear === true && live.pickerDone === true &&
                live.pickerOrder === '18 17 16 15 14 13 12 11 21 22 23 24 25 26 27 28 | 48 47 46 45 44 43 42 41 31 32 33 34 35 36 37 38',
                JSON.stringify([live.pickerOpen, live.pickerOnScreen, live.pickerWrites, live.pickerToggleOff, live.pickerEsc, live.pickerClear, live.pickerDone, live.pickerOrder]));
            pass('live: confirming the upload inserts the film with the picked visit, teeth and status "new"', live.insertCtx === true);
            pass('live: uploads from the helpers (no pick) link to the visit on the same date, and to nothing when there is none', live.autoLink === true && live.autoNoVisit === true, JSON.stringify([live.autoLink, live.autoNoVisit]));
            pass('live: columns missing in the database -> the write is retried without them (no data lost), the state is remembered, fields hide and the "run xray_context.sql" hint shows',
                live.fallbackWrites === true && live.fallbackOk === true && live.fallbackRemembered === true && live.fallbackInsert === true && live.fallbackHidden === true && live.fallbackNoBadge === true,
                JSON.stringify([live.fallbackWrites, live.fallbackOk, live.fallbackRemembered, live.fallbackInsert, live.fallbackHidden, live.fallbackNoBadge]));
            pass('live: messages are toasts - no blocking alert() is raised (empty export, missing download link); errors get the red toast',
                live.alertCalls === 0 && live.toastShown === true && live.toastNoUrl === true && live.toastErr === true && live.toastInfo === true, JSON.stringify([live.alertCalls, live.toastShown, live.toastText, live.toastNoUrl, live.toastErr, live.toastInfo]));
            var L = live.langs || {};
            pass('live: labels are translated in English, 繁體中文 and 简体中文',
                L.en && L.en.visit === 'Linked visit' && L.en.teeth === 'Teeth (FDI)' && L.en.chip === 'To review' && L.en.opt === 'Reviewed' &&
                L['zh-Hant'] && L['zh-Hant'].visit === '關聯就診' && L['zh-Hant'].chip === '待審閱' && L['zh-Hant'].opt === '已審閱' &&
                L['zh-CN'] && L['zh-CN'].visit === '关联就诊' && L['zh-CN'].chip === '待审阅' && L['zh-CN'].opt === '已审阅' &&
                L.en.ph === 'Tooth e.g. 16' && L['zh-Hant'].ph === '牙位 例如 16', JSON.stringify(L));
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
