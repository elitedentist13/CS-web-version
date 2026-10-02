/**
 * Consultation > X-ray tab, Phase 2: wired to the rest of the app.
 *  - deep link to ONE film (timeline, Documents & Media hub, notes, dental chart), filters cleared when needed
 *  - films per tooth in the dental chart (badge, click through)
 *  - X-rays in the hub counts and the patient timeline (teeth, link)
 *  - "X-rays this visit" bar with suggested bill items (suggestion only, nothing is written to billing)
 * Smoke (source) + HTTP spot + testclient (vm) + CDP Runtime.evaluate / live page (database mocked).
 * Run: node scripts/xray-wire-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261002cb4';
var PAGE_PORT = 8798;
var CDP_PORT = 9364;
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

var PAGE_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => { const end = Date.now() + (ms || 6000); while (Date.now() < end) { try { if (fn()) return true; } catch (e) { /* retry */ } await wait(60); } return false; };
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (typeof xrayWireOpenFilm === 'function' && typeof filterXrays === 'function' && typeof initChart === 'function' && typeof conMediaBuildSummary === 'function' && typeof SB !== 'undefined' && SB && SB.from) break;
    await wait(200);
  }
  const out = { ready: typeof xrayWireOpenFilm === 'function' && typeof initChart === 'function' };
  if (!out.ready) return out;
  const $ = (id) => document.getElementById(id);
  const login = $('loginOverlay'); if (login) login.style.display = 'none';
  const con = $('consultationSection');
  if (con) { con.style.display = 'block'; con.removeAttribute('aria-hidden'); }

  const pid = '00000000-0000-4000-8000-0000000000b2';
  const today = todayISO();
  const mk = (id, type, date, appt, teeth, st) => ({
    id, patient_id: pid, xray_type: type, taken_date: date, appointment_id: appt, teeth, review_status: st,
    reviewed_by: null, reviewed_at: null, notes: 'note ' + id, file_name: id + '.png', file_url: window.__PX, file_path: pid + '/' + id + '.png',
    created_at: today + 'T01:00:00Z', _isHome: true, _clinicLabel: ''
  });
  const rows = [
    mk('x1', 'Bitewing', today, 'ap-today', ['16', '17'], 'new'),
    mk('x2', 'Periapical', '2025-01-05', 'ap-old', ['16'], 'reviewed'),
    mk('x3', 'Panoramic', today, null, [], 'new'),
    mk('x4', 'Periapical', '2026-01-01', 'ap-today', ['46'], 'new'),
    mk('x5', 'Bitewing', today, 'ap-old', ['ALL', 'UR', '99'], 'new')
  ];

  /* nothing reaches Supabase: every table answers from here */
  const origFrom = SB.from.bind(SB);
  SB.from = (table) => {
    const b = new Proxy({}, { get(_, k) {
      if (k === 'then') return (res, rej) => Promise.resolve({ data: table === 'xrays' ? JSON.parse(JSON.stringify(rows)) : [], error: null }).then(res, rej);
      return () => b;
    } });
    return b;
  };
  const probe = await SB.from('xrays').select('*');
  out.mockActive = Array.isArray(probe.data) && probe.data.length === rows.length;
  if (!out.mockActive) { SB.from = origFrom; return out; }

  const realSwitch = window.switchConTab;
  window.__tabs = [];
  window.switchConTab = (tab) => { window.__tabs.push(tab); };
  conPatientId = pid;
  xrayPatientId = pid;
  xrayPatientData = { id: pid, patient_no: 'T-2', full_name: 'Wire Test', clinic_tag: xrayWorkingClinicTag() };
  const htag = xrayHomeClinicTag();
  rows.forEach((r) => { r._clinicTag = htag; });
  xrayLinkedPatients = [];
  xrayClinicScope = 'all';
  xrayWhenFilter = '';
  XRAY_CTX.appts[pid] = { at: Date.now() + 1e9, rows: [
    { id: 'ap-today', date: today, start_time: '10:00:00', dentist_name: 'Dr A', treatment_items: '' },
    { id: 'ap-old', date: '2025-01-05', start_time: '09:30:00', dentist_name: 'Dr B', treatment_items: '' }
  ] };
  XRAY_CTX.ok = null; XRAY_CTX._probe = null;
  xrayAllRecords = rows.map((r) => Object.assign({}, r));
  setXrayView('grid');
  filterXrays();
  const ids = () => xrayFiltered.map((x) => x.id).join(',');
  const lbOpen = (id) => until(() => typeof lbCurrentId !== 'undefined' && lbCurrentId === id, 4000);
  const closeLb = () => { try { _forceCloseLightbox(); } catch (e) { /* ignore */ } lbCurrentId = null; };

  /* the "X-rays this visit" bar */
  const bar = $('xrayVisitBar');
  out.barShown = !!bar && !bar.hidden && /3/.test((bar.querySelector('.xvb-count') || {}).textContent || '');
  out.barTypes = ((bar.querySelector('.xvb-types') || {}).textContent || '');
  out.barItems = Array.from(bar.querySelectorAll('.xvb-item')).map((e) => e.textContent);
  out.barNew = ((bar.querySelector('.xvb-chip--new') || {}).textContent || '');
  let billOpened = 0; const realBill = window.openBillFromConsultation; window.openBillFromConsultation = () => { billOpened++; };
  bar.querySelector('.xvb-bill').click();
  const toast = $('appGlobalToast');
  out.billOpened = billOpened === 1;
  out.billToast = !!toast && toast.classList.contains('app-global-toast--in') && toast.textContent.indexOf('X-RAY') >= 0 && /×2/.test(toast.textContent);
  window.openBillFromConsultation = realBill;
  out.visitFilms = xrayWireVisitFilms().map((x) => x.id).join(',');
  bar.querySelector('.xvb-chip--new').click();
  out.barChipFilters = ids() === 'x1,x3,x4,x5';
  xrayCtxSetRev('');
  xrayAllRecords = [rows[1]].map((r) => Object.assign({}, r)); filterXrays();
  out.barHiddenWhenNone = bar.hidden === true && bar.innerHTML === '';
  xrayAllRecords = rows.map((r) => Object.assign({}, r)); filterXrays();
  out.barBack = bar.hidden === false;

  /* deep link: one film, with a filter that would hide it */
  xrayCtxSetRev('reviewed');
  out.hiddenByFilter = ids() === 'x2';
  xrayWireOpenFilm(pid, 'x1');
  out.dlOpened = await lbOpen('x1');
  out.dlTab = window.__tabs.indexOf('xrays') >= 0;
  out.dlFiltersCleared = XRAY_CTX.revFilter === '' && ids() === 'x1,x2,x3,x4,x5';
  out.dlPendingCleared = XRAY_WIRE.pending === null;
  closeLb();

  /* deep link before the films are loaded: waits for them */
  xrayAllRecords = []; xrayFiltered = []; 
  xrayWireOpenFilm(pid, 'x4');
  out.waits = XRAY_WIRE.pending && XRAY_WIRE.pending.id === 'x4';
  xrayAllRecords = rows.map((r) => Object.assign({}, r));
  filterXrays();
  out.waitOpened = await lbOpen('x4');
  closeLb();

  /* deep link to a tooth: filter prefilled */
  xrayWireOpenFilm(pid, '', '16');
  out.toothFilterSet = $('xrayFilterTooth').value === '16' && ids() === 'x1,x2,x5';
  $('xrayFilterTooth').value = ''; xrayCtxOnToothInput();

  /* deep link to a film that is gone */
  window.__alerts = 0; const realAlert = window.alert; window.alert = () => { window.__alerts++; };
  xrayWireOpenFilm(pid, 'nope');
  await wait(6900);
  out.goneToast = !!toast && /no longer/i.test(toast.textContent) && XRAY_WIRE.pending === null && window.__alerts === 0;
  window.alert = realAlert;

  /* timeline events */
  const ev = conPtlEventsFromXrays([{ id: 'x1', patient_id: pid, xray_type: 'Bitewing', taken_date: today, created_at: today + 'T01:00:00Z', notes: 'caries?', teeth: ['16', '17'], appointment_id: 'ap-today', review_status: 'new' }])[0];
  out.evFields = ev.refId === 'x1' && ev.patientId === pid && JSON.stringify(ev.teeth) === '["16","17"]' && ev.apptId === 'ap-today' && /🦷 16, 17/.test(ev.meta) && /caries/.test(ev.meta);
  const evPlain = conPtlEventsFromXrays([{ id: 'x9', xray_type: 'Other', taken_date: today, created_at: today + 'T01:00:00Z', notes: '' }])[0];
  out.evPlain = evPlain.meta === '' && Array.isArray(evPlain.teeth) && evPlain.teeth.length === 0;
  const realOpen = window.xrayWireOpenFilm; window.__open = null;
  window.xrayWireOpenFilm = (p, i) => { window.__open = [p, i]; };
  conPtlOpenEvent(ev);
  out.evLink = JSON.stringify(window.__open) === JSON.stringify([pid, 'x1']);
  window.__open = null;
  const prevSel = selPatientId; selPatientId = pid;
  patDashPtlOpenEvent(Object.assign({}, ev, { patientId: pid }));
  selPatientId = prevSel;
  out.evLinkDash = JSON.stringify(window.__open) === JSON.stringify([pid, 'x1']);
  window.xrayWireOpenFilm = realOpen;

  /* notes: chip with the teeth + jump chip with the count */
  conPatientTimelineEvents = [Object.assign({}, ev, { ts: Date.now() })];
  const items = cnTodayItems();
  out.noteChip = items.some((it) => it.kind === 'xray' && it.text === 'Bitewing (16, 17)' && it.key === 'xr');
  CON_MEDIA.summary[pid] = conMediaBuildSummary([], [], rows);
  const jump = cnMediaJumpChips();
  out.noteJump = jump.indexOf('data-goto="xrays"') >= 0 && jump.indexOf('(5)') >= 0;
  window.__tabs = [];
  const fakeBox = document.createElement('div'); fakeBox.id = 'conNoteContext'; fakeBox.hidden = true;
  const oldBox = $('conNoteContext');
  if (!oldBox) document.body.appendChild(fakeBox);
  const jumpBtn = document.createElement('button'); jumpBtn.setAttribute('data-goto', 'xrays');
  ($('conNoteContext')).appendChild(jumpBtn);
  cnOnContextClick({ target: jumpBtn });
  out.noteJumpGo = window.__tabs.indexOf('xrays') >= 0;
  jumpBtn.remove(); if (!oldBox) fakeBox.remove();

  /* hub */
  const sum = CON_MEDIA.summary[pid];
  out.hubCounts = sum.xrays === 5 && sum.xraysNew === 4;
  const sumNoCol = conMediaBuildSummary([], [], [{ id: 'a', created_at: '2026-01-01T00:00:00Z' }]);
  out.hubNoCol = sumNoCol.xrays === 1 && sumNoCol.xraysNew === 0;
  const old = conMediaBuildSummary([{ category: 'Intraoral', created_at: '2026-10-01T00:00:00Z' }], []);
  out.hubOldSig = old.xrays === 0 && old.photos === 1;
  const hubHtml = conMediaHubHtml('photos', sum);
  out.hubSeg = hubHtml.indexOf('data-cm-view="xrays"') >= 0 && /con-media-new" title="[^"]*4[^"]*">4</.test(hubHtml);
  window.__tabs = [];
  conMediaSetView('xrays');
  out.hubGo = window.__tabs.length === 1 && window.__tabs[0] === 'xrays';

  /* dental chart: films per tooth */
  window.switchConTab = realSwitch;
  window.__tabs = [];
  window.switchConTab = (tab) => { window.__tabs.push(tab); };
  xrayAllRecords = rows.map((r) => Object.assign({}, r));
  XRAY_WIRE.films = {};
  initChart(pid, 'Wire Test');
  const upBadge = (tn) => document.querySelector('#tooth-cell-' + tn + ' .tooth-xr-badge');
  out.chartPainted = await until(() => !!upBadge('16'), 6000);
  out.badge16 = !!upBadge('16') && upBadge('16').textContent === '🩻2' && /Bitewing/.test(upBadge('16').title) && /Periapical/.test(upBadge('16').title);
  out.badge17 = !!upBadge('17') && upBadge('17').textContent === '🩻';
  out.badgeLower = !!upBadge('46') && upBadge('46').classList.contains('tooth-xr-badge--low') && !upBadge('16').classList.contains('tooth-xr-badge--low');
  out.badgeNone = !upBadge('36') && !upBadge('11') && !upBadge('99') && document.querySelectorAll('.tooth-xr-badge').length === 3;
  out.badgeNoApply = (() => { const before = JSON.stringify(dentalState); upBadge('17').click(); return JSON.stringify(dentalState) === before; })();
  out.badgeClickOne = await lbOpen('x1');
  closeLb();
  window.__tabs = [];
  upBadge('16').click();
  out.badgeClickMany = $('xrayFilterTooth').value === '16' && ids() === 'x1,x2,x5' && window.__tabs.indexOf('xrays') >= 0;
  $('xrayFilterTooth').value = ''; xrayCtxOnToothInput();
  /* painting again keeps one badge per tooth */
  xrayWirePaintChart(); xrayWirePaintChart();
  out.badgeNoDup = document.querySelectorAll('.tooth-xr-badge').length === 3;
  /* columns not applied: no badge and no query loop */
  XRAY_WIRE.films = {}; XRAY_CTX.ok = false;
  xrayWirePaintChart();
  out.badgeOff = document.querySelectorAll('.tooth-xr-badge').length === 0;

  /* three languages */
  XRAY_CTX.ok = true;
  const langs = {};
  for (const lang of ['en', 'zh-Hant', 'zh-CN']) {
    setAppLang(lang); await wait(150);
    langs[lang] = [xrayWireTr('xw.visitBar'), xrayWireTr('xw.openBill'), xrayWireTr('xw.hub'), conMediaTr('cm.hub.xrays')];
  }
  setAppLang('en');
  out.langs = langs;

  window.switchConTab = realSwitch;
  SB.from = origFrom;
  return out;
})()`;

(async function () {
    var wireSrc = read('app-xray-wire.js');
    var html = read('index.html');
    var css = read('style.css');
    var media = read('app-con-media.js');
    var notes = read('app-con-notes.js');
    var cons = read('app-consultation.js');
    var pv = read('app-patient-views.js');

    console.log('=== source ===');
    pass('index BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    var iCharts = html.indexOf("'app-charts.js?v=");
    var iCtx = html.indexOf("'app-xray-ctx.js?v=");
    var iWire = html.indexOf("'app-xray-wire.js?v=" + BUILD + "'");
    pass('wire module is loaded (cache-busted) after the charts and the x-ray context modules', iCharts > 0 && iCtx > 0 && iWire > iCharts && iWire > iCtx);
    pass('visit bar host sits at the top of the x-ray tab', /id="xrayVisitBar"[^>]*hidden/.test(html) && html.indexOf('id="xrayVisitBar"') < html.indexOf('class="xray-filter-bar"'));
    pass('styles for the bar, chart badge and hub badge', ['.xray-visit-bar', '.xvb-bill', '.tooth-xr-badge', '.tooth-xr-badge--low', '.con-media-new'].every(function (s) { return css.indexOf(s) >= 0; }));
    pass('wire module hooks filterXrays / refreshAllTeeth / renderChartShell once', /XRAY_WIRE\.hooked/.test(wireSrc) && /refreshAllTeeth/.test(wireSrc) && /renderChartShell/.test(wireSrc));
    pass('billing is a suggestion only: the module never writes to billing tables', !/from\('(bills|pending_bill_items|bill_items)'\)/.test(wireSrc) && /openBillFromConsultation/.test(wireSrc));
    pass('timeline queries read the optional x-ray columns without failing when they are missing (select *)',
        /from\('xrays'\)\.select\('\*'\)/.test(cons) && /from\('xrays'\)\.select\('\*'\)/.test(pv));
    pass('timeline click goes to the film in both the consultation and the patient dashboard', /xrayWireOpenFilm\(ev\.patientId \|\| conPatientId, ev\.refId\)/.test(cons) && /xrayWireOpenFilm\(pid, ev\.refId\)/.test(pv));
    pass('hub: X-rays segment, summary counts and view switch', /data-cm-view="xrays"/.test(media) && /xraysNew/.test(media) && /v === 'xrays'/.test(media));
    pass('notes: films carry their teeth and a jump chip opens the tab', /ev\.teeth\.join\(', '\)/.test(notes) && /data-goto="xrays"/.test(notes) && /dest === 'xrays'/.test(notes));
    var keysUsed = {};
    (wireSrc.match(/xrayWireTr\('xw\.[A-Za-z]+'/g) || []).forEach(function (m) { keysUsed[m.match(/xw\.[A-Za-z]+/)[0]] = 1; });
    var defined = {};
    (wireSrc.match(/'xw\.[A-Za-z]+': \{.*\}/g) || []).forEach(function (m) {
        defined[m.match(/'(xw\.[A-Za-z]+)'/)[1]] = /en: '/.test(m) && /'zh-CN': '/.test(m) && /'zh-Hant': '/.test(m);
    });
    var missing = Object.keys(keysUsed).filter(function (k) { return defined[k] !== true; });
    pass('every xw.* string used has en + zh-CN + zh-Hant', Object.keys(keysUsed).length >= 8 && !missing.length, missing.join(',') || (Object.keys(keysUsed).length + ' keys'));
    var mediaKeys = ['cm.hub.xrays', 'cm.hub.xraysNew', 'cm.notes.openXrays'];
    pass('hub / notes strings have en + zh-CN + zh-Hant', mediaKeys.every(function (k) {
        var m = media.match(new RegExp("'" + k.replace(/\./g, '\\.') + "': \\{.*\\}"));
        return !!m && /en: '/.test(m[0]) && /'zh-CN': '/.test(m[0]) && /'zh-Hant': '/.test(m[0]);
    }));

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var sp = await httpGetText(PAGE_PORT, '/app-xray-wire.js?v=' + BUILD);
    pass('GET /app-xray-wire.js is served', sp.status === 200 && /function xrayWireOpenFilm/.test(sp.body));
    var sc = await httpGetText(PAGE_PORT, '/style.css');
    pass('GET /style.css has the wiring styles', sc.status === 200 && /\.tooth-xr-badge/.test(sc.body) && /\.xray-visit-bar/.test(sc.body));

    console.log('\n=== testclient (vm): the module logic ===');
    (function () {
        var catalog = [
            { item_name: 'X-RAY - 口內X光片', unit_price: 150 },
            { item_name: 'ORTHOPANTOMOGRAM (OPG) - 環口腔X光片', unit_price: 400 },
            { item_name: 'LATERAL CEPH XRAY', unit_price: 350 }
        ];
        var box = { console: console, TREATMENT_ITEMS_CATALOG: catalog, I18N_STRINGS: {}, t: function (k) { return k; } };
        box.window = box;
        vm.createContext(box);
        vm.runInContext(wireSrc, box);
        var lines = box.xrayWireBillLines([
            { xray_type: 'Periapical' }, { xray_type: 'Bitewing' }, { xray_type: 'Other' }, { xray_type: '' },
            { xray_type: 'Panoramic' }, { xray_type: 'Cephalometric' }, { xray_type: 'CBCT' }
        ]);
        pass('testclient: intraoral films are billed per film, OPG and ceph have their own line, CBCT has none',
            lines.length === 3 && lines[0].name === 'X-RAY - 口內X光片' && lines[0].qty === 4 && lines[0].price === 150 &&
            lines[1].name.indexOf('OPG') > 0 && lines[1].qty === 1 && lines[1].price === 400 && lines[2].name === 'LATERAL CEPH XRAY' && lines[2].price === 350);
        pass('testclient: no films -> no lines; unknown catalog item -> price null', box.xrayWireBillLines([]).length === 0 && box.xrayWireCatalogPrice('nope') === null);
        var map = box.xrayWireToothFilms([
            { id: 'a', teeth: ['16', '17'] }, { id: 'b', teeth: ['16', 'ALL', 'UR', '99', '09'] }, { id: 'c', teeth: [] }
        ]);
        pass('testclient: films are mapped to explicit FDI teeth only (ALL, quadrants and junk are not per-tooth)',
            Object.keys(map).sort().join(',') === '16,17' && map['16'].length === 2 && map['17'].length === 1);
        box.xrayWireStoreFilms('p1', [{ id: 'a', teeth: ['16'], xray_type: 'Bitewing', taken_date: '2026-01-01', file_url: 'big' }, { id: 'b', teeth: [] }, { id: 'c' }]);
        var st = box.XRAY_WIRE.films.p1;
        pass('testclient: only films with teeth are kept, and only the light fields', st.rows.length === 1 && !('file_url' in st.rows[0]) && st.rows[0].id === 'a');
        pass('testclient: translation placeholders are filled', box.xrayWireTr('xw.films', { N: 3 }) === 'xw.films');
    })();

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) { pass('Chrome found for CDP', false, CHROME); try { server.close(); } catch (e) { /* ignore */ } finish(1); return; }
    var profile = path.join(os.tmpdir(), 'cs-xray-wire-cdp');
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

        pass('live: wire module loaded', live && live.ready);
        if (live && live.ready) {
            pass('live: database is mocked (nothing reaches Supabase)', live.mockActive === true);
            pass('live: "X-rays this visit" bar counts today\'s films (linked to today\'s visit, or unlinked and taken today), lists the types and the films still to review',
                live.barShown === true && live.visitFilms === 'x1,x3,x4' && /Bitewing/.test(live.barTypes) && /Panoramic/.test(live.barTypes) && /3/.test(live.barNew),
                JSON.stringify([live.barShown, live.visitFilms, live.barTypes, live.barNew]));
            pass('live: suggested bill items come from the catalog with quantity and price', JSON.stringify(live.barItems) === JSON.stringify(['X-RAY - 口內X光片 ×2 @150', 'ORTHOPANTOMOGRAM (OPG) - 環口腔X光片 ×1 @400']), JSON.stringify(live.barItems));
            pass('live: "Open billing" opens the bill panel and toasts the suggestion (nothing is added to the bill)', live.billOpened === true && live.billToast === true, JSON.stringify([live.billOpened, live.billToast]));
            pass('live: the "to review" chip on the bar applies the status filter; the bar hides when there are no films this visit', live.barChipFilters === true && live.barHiddenWhenNone === true && live.barBack === true,
                JSON.stringify([live.barChipFilters, live.barHiddenWhenNone, live.barBack]));
            pass('live: deep link opens the exact film, clearing the filter that hid it and switching to the X-ray tab',
                live.hiddenByFilter === true && live.dlOpened === true && live.dlTab === true && live.dlFiltersCleared === true && live.dlPendingCleared === true,
                JSON.stringify([live.hiddenByFilter, live.dlOpened, live.dlTab, live.dlFiltersCleared, live.dlPendingCleared]));
            pass('live: a deep link made before the films are loaded waits for them and then opens the film', live.waits === true && live.waitOpened === true, JSON.stringify([live.waits, live.waitOpened]));
            pass('live: a tooth link opens the tab with the tooth filter filled in', live.toothFilterSet === true);
            pass('live: a film that no longer exists gives a toast (no alert) and clears the pending link', live.goneToast === true);
            pass('live: timeline events carry teeth, visit, patient and a film link; plain films stay plain',
                live.evFields === true && live.evPlain === true, JSON.stringify([live.evFields, live.evPlain]));
            pass('live: timeline click opens the film (consultation timeline and patient dashboard)', live.evLink === true && live.evLinkDash === true, JSON.stringify([live.evLink, live.evLinkDash]));
            pass('live: notes show today\'s film with its teeth and a jump chip with the film count that opens the tab',
                live.noteChip === true && live.noteJump === true && live.noteJumpGo === true, JSON.stringify([live.noteChip, live.noteJump, live.noteJumpGo]));
            pass('live: hub counts films and films to review, old callers still work, the segment opens the X-ray tab',
                live.hubCounts === true && live.hubNoCol === true && live.hubOldSig === true && live.hubSeg === true && live.hubGo === true,
                JSON.stringify([live.hubCounts, live.hubNoCol, live.hubOldSig, live.hubSeg, live.hubGo]));
            pass('live: dental chart shows a film badge per tooth (count when several, lower arch placement, nothing for other teeth)',
                live.chartPainted === true && live.badge16 === true && live.badge17 === true && live.badgeLower === true && live.badgeNone === true,
                JSON.stringify([live.chartPainted, live.badge16, live.badge17, live.badgeLower, live.badgeNone]));
            pass('live: clicking a badge does not apply the chart tool; one film opens it, several open the tab filtered by the tooth',
                live.badgeNoApply === true && live.badgeClickOne === true && live.badgeClickMany === true, JSON.stringify([live.badgeNoApply, live.badgeClickOne, live.badgeClickMany]));
            pass('live: repainting never duplicates badges; with the columns off there are none', live.badgeNoDup === true && live.badgeOff === true, JSON.stringify([live.badgeNoDup, live.badgeOff]));
            var en = live.langs && live.langs.en, hant = live.langs && live.langs['zh-Hant'], hans = live.langs && live.langs['zh-CN'];
            pass('live: labels are translated in English, 繁體中文 and 简体中文',
                !!en && !!hant && !!hans && en[0] === 'X-rays this visit' && hant[0] !== en[0] && hans[0] !== en[0] && hant[0] !== hans[0] && hant.every(function (s) { return !/^xw\.|^cm\./.test(s); }) && hans.every(function (s) { return !/^xw\.|^cm\./.test(s); }),
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
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + TESTCLIENT + CDP + LIVE PAGE ALL PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}
