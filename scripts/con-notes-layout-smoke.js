/**
 * Consultation > Treatment notes layout:
 *  1. the "治療記錄" heading stays on ONE row even with the medical-record review chip + buttons shown
 *  2. the draft-state mini note ("Unsaved…" / "Draft saved hh:mm") never moves the main text box
 * Smoke (source) + HTTP spot + CDP Runtime.evaluate / live page, width sweeps.
 * Run: node scripts/con-notes-layout-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261002xc5';
var PAGE_PORT = 8798;
var CDP_PORT = 9362;
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

/* Runs inside the page. Returns one object with every measurement. */
var PAGE_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (typeof setAppLang === 'function' && typeof cnSetDraftState === 'function' && document.getElementById('conNoteDraftState')) break;
    await wait(200);
  }
  const out = { ready: typeof cnSetDraftState === 'function' };
  if (!out.ready) return out;
  const $ = (id) => document.getElementById(id);
  const login = $('loginOverlay'); if (login) login.style.display = 'none';
  const con = $('consultationSection');
  if (con) { con.style.display = 'block'; con.removeAttribute('aria-hidden'); }
  const layout = $('conMainLayout');
  layout.style.display = 'grid';
  const tab = $('conTnSubpane-notes'); if (tab) { tab.hidden = false; tab.classList.add('active'); }

  /* worst case for the header: every header control shown */
  const chip = $('conMhReviewChip');
  chip.hidden = false; chip.className = 'con-mh-review-chip is-stale';
  ['conJumpMedHistBtn', 'conBackQueueBtn', 'conTnPrintBtn'].forEach((id) => { const b = $(id); b.hidden = false; b.style.display = ''; });

  /* worst case for the composer toolbar: free-entry mode with every mic control showing */
  if (typeof cnSetMode === 'function') cnSetMode('free', false);
  ['conNoteMicBtn', 'conNoteMicLang', 'conNoteMicFixesBtn'].forEach((id) => { $(id).hidden = false; });
  const chipDoc = $('conNoteDoctorChip'); if (!chipDoc.textContent) chipDoc.textContent = 'Dr. Chan Tai Man';

  const states = [['', 0], ['unsaved', 0], ['saved', Date.now()], ['restored', Date.now()], ['saved', Date.now()], ['', 0]];
  const comp = $('conNoteComposer'), ta = $('conNoteInput'), tb = comp.querySelector('.cn-toolbar');
  const sweep = async (lang) => {
    setAppLang(lang);
    await wait(150);
    const res = { lang, jumpWidths: [], jumpDetail: [], tops: 0, ds: [] };
    const col = comp.closest('.con-note-col');
    for (let w = 340; w <= 980; w += 10) {
      col.style.width = w + 'px'; col.style.boxSizing = 'border-box';
      const seen = new Set();
      const heights = new Set();
      const rowsSeen = new Set();
      for (const st of states) {
        cnSetDraftState(st[0], st[1]);
        seen.add(Math.round(ta.getBoundingClientRect().top * 10) / 10);
        heights.add(Math.round(tb.getBoundingClientRect().height * 10) / 10);
        const tops = new Set(Array.from(tb.children).filter((c) => !c.hidden && c.offsetParent !== null && c.getBoundingClientRect().height > 0).map((c) => Math.round(c.getBoundingClientRect().top)));
        rowsSeen.add(tops.size);
      }
      res.tops++;
      if (seen.size > 1) { res.jumpWidths.push(w); if (res.jumpDetail.length < 3) res.jumpDetail.push([w, Array.from(seen), Array.from(heights)]); }
    }
    col.style.width = '';
    return res;
  };
  out.sweepEn = await sweep('en');
  out.sweepHant = await sweep('zh-Hant');
  out.sweepCn = await sweep('zh-CN');

  /* real note texts from the live database sitting in the box while the draft note flashes */
  out.real = [];
  for (const s of (window.__samples || [])) {
    ta.value = s;
    const a = await sweep('en'), b = await sweep('zh-Hant');
    out.real.push({ len: s.length, enJumps: a.jumpWidths.length, hantJumps: b.jumpWidths.length });
  }
  ta.value = '';

  /* real typing: the page's own input handler + 600 ms draft timer, sampling the box position every 40 ms */
  setAppLang('en'); await wait(100);
  const col2 = comp.closest('.con-note-col');
  out.typing = [];
  for (const w of [520, 640, 760, 900]) {
    col2.style.width = w + 'px'; col2.style.boxSizing = 'border-box';
    CN.draftPid = 'layout-smoke-pid';
    ta.value = ''; cnSetDraftState('', 0);
    const tops = new Set(), labels = new Set(); let typed = '';
    const words = 'Scaling and polishing done. Advised to use interdental brush twice daily and review in two weeks.'.split(' ');
    const t0 = Date.now();
    let wi = 0, next = 0;
    while (Date.now() - t0 < 12000 && !(wi >= 5 && /Draft saved/.test($('conNoteDraftState').textContent))) {
      if (Date.now() >= next && wi < 5) { typed += (typed ? ' ' : '') + words[wi++]; ta.value = typed; ta.dispatchEvent(new Event('input', { bubbles: true })); next = Date.now() + 110; }
      tops.add(Math.round(ta.getBoundingClientRect().top * 10) / 10);
      labels.add($('conNoteDraftState').textContent.replace(/[0-9:]+/g, 'hh:mm'));
      await wait(40);
    }
    tops.add(Math.round(ta.getBoundingClientRect().top * 10) / 10);
    labels.add($('conNoteDraftState').textContent.replace(/[0-9:]+/g, 'hh:mm'));
    out.typing.push({ w, tops: Array.from(tops), labels: Array.from(labels), typedWords: wi });
  }
  col2.style.width = '';
  ta.value = ''; cnFlushDraft(); CN.draftPid = null;
  cnSetDraftState('', 0);

  /* heading: one row for every layout width, in all three languages */
  const h3 = layout.querySelector('.con-col-header > h3');
  const hdr = h3.parentElement;
  const mkReview = () => { $('conMhReviewChipText').textContent = document.documentElement.lang && document.documentElement.lang.indexOf('zh') === 0 ? '上次由 陳大文醫生（牙周科主任） 於 2026-09-01 14:35 覆核' : 'Last reviewed by Dr. Chan Tai Man (Periodontics) on 2026-09-01 14:35'; };
  const head = async (lang) => {
    setAppLang(lang); await wait(150); mkReview();
    const r = { lang, tall: [], rows: new Set(), text: h3.textContent };
    for (let w = 520; w <= 1500; w += 10) {
      layout.style.width = w + 'px';
      const rects = Array.from((() => { const rg = document.createRange(); rg.selectNodeContents(h3); return rg.getClientRects(); })());
      const lineTops = new Set(rects.map((q) => Math.round(q.top)));
      const hh = h3.getBoundingClientRect().height;
      const lh = parseFloat(getComputedStyle(h3).fontSize) * 1.9;
      r.rows.add(lineTops.size);
      if (lineTops.size > 1 || hh > lh) r.tall.push(w);
    }
    layout.style.width = '';
    r.rows = Array.from(r.rows);
    return r;
  };
  out.headHant = await head('zh-Hant');
  out.headCn = await head('zh-CN');
  out.headEn = await head('en');
  out.h3NoWrap = getComputedStyle(h3).whiteSpace;
  return out;
})()`;

(async function () {
    var css = read('style.css');
    var html = read('index.html');

    console.log('=== source ===');
    pass('index BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    var h3Rule = (css.match(/\.con-col-header\s*>\s*h3\s*\{[^}]*\}/) || [''])[0];
    pass('heading rule keeps the title on one row (nowrap, no shrink)',
        /white-space:\s*nowrap/.test(h3Rule) && /flex:\s*0\s+0\s+auto/.test(h3Rule), h3Rule.replace(/\s+/g, ' '));
    var dsRule = (css.match(/\.cn-draft-state\s*\{[^}]*\}/) || [''])[0];
    pass('draft-state note reserves fixed space (grows, never forces a wrap, clips long text)',
        /flex:\s*1\s+1\s+0/.test(dsRule) && /min-width:\s*\d+px/.test(dsRule) && /white-space:\s*nowrap/.test(dsRule) && /overflow:\s*hidden/.test(dsRule),
        dsRule.replace(/\s+/g, ' '));

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var sp = await httpGetText(PAGE_PORT, '/style.css?v=' + BUILD);
    pass('GET /style.css serves both fixes', sp.status === 200 && /\.con-col-header\s*>\s*h3/.test(sp.body) && /\.cn-draft-state[^}]*min-width/.test(sp.body));

    console.log('\n=== testclient (vm): the draft-note function the page really runs ===');
    var notesSrc = read('app-con-notes.js');
    var i18nSrc = read('app-i18n-extra.js');
    function tr(lang, key) {
        var i = i18nSrc.indexOf("'" + key + "':");
        var line = i18nSrc.slice(i, i18nSrc.indexOf('\n', i));
        var m = line.match(new RegExp("(?:'" + lang + "'|\\b" + lang + "):\\s*'((?:[^'\\\\]|\\\\.)*)'"));
        return m ? m[1] : null;
    }
    ['en', 'zh-Hant', 'zh-CN'].forEach(function (lang) {
        var el = { className: '', textContent: '' };
        var ctx2 = {
            g: function () { return el; },
            conTr: function (k) { return tr(lang, k); },
            conTrRepl: function (k, p) { var s = tr(lang, k); Object.keys(p || {}).forEach(function (x) { s = s.split('{' + x + '}').join(p[x]); }); return s; },
            conUiLocale: function () { return 'en-GB'; }
        };
        require('vm').createContext(ctx2);
        var fnSrc = notesSrc.slice(notesSrc.indexOf('function cnSetDraftState'), notesSrc.indexOf('function cnScheduleDraft'));
        require('vm').runInContext(fnSrc, ctx2);
        ctx2.cnSetDraftState('unsaved');
        var a = [el.className, el.textContent];
        ctx2.cnSetDraftState('saved', Date.UTC(2026, 9, 2, 6, 30));
        var b = [el.className, el.textContent];
        ctx2.cnSetDraftState('restored', Date.UTC(2026, 9, 2, 6, 30));
        var c = [el.className, el.textContent];
        ctx2.cnSetDraftState('');
        var d = [el.className, el.textContent];
        pass('testclient ' + lang + ': unsaved / saved / restored / cleared states drive the note',
            a[0] === 'cn-draft-state cn-draft-state--unsaved' && a[1] && b[0] === 'cn-draft-state cn-draft-state--saved' && /\d{1,2}:\d{2}|\d{2}/.test(b[1]) &&
            c[0] === 'cn-draft-state cn-draft-state--restored' && c[1] && d[0] === 'cn-draft-state' && d[1] === '',
            JSON.stringify([a, b, c, d]));
    });

    console.log('\n=== API (read-only, anon): real notes ===');
    var sbCfg = (function () {
        var block = read('app.js').match(/supabase\.createClient\(([\s\S]*?)\);/);
        var parts = [], re = /'([^']*)'/g, m;
        while ((m = re.exec(block[1]))) parts.push(m[1]);
        return { url: parts[0], key: parts.slice(1).join('') };
    })();
    var samples = [];
    try {
        var r = await fetch(sbCfg.url.replace(/\/$/, '') + '/rest/v1/treatments?select=*&order=created_at.desc&limit=25',
            { headers: { apikey: sbCfg.key, Authorization: 'Bearer ' + sbCfg.key, Accept: 'application/json' } });
        var rows = await r.json();
        pass('treatments table readable', r.status === 200 && Array.isArray(rows), 'HTTP ' + r.status + ', ' + (rows && rows.length) + ' rows');
        (rows || []).forEach(function (row) {
            Object.keys(row).forEach(function (k) {
                var v = row[k];
                if (typeof v === 'string' && v.length > 30 && v.length < 1500 && !/^https?:|^[0-9a-f-]{30,}$|^\d{4}-\d\d-\d\dT/.test(v)) samples.push(v);
            });
        });
        samples.sort(function (a, b) { return b.length - a.length; });
        samples = [samples[0], samples[Math.floor(samples.length / 2)], samples[samples.length - 1]].filter(Boolean);
        pass('real note texts collected for the live test', samples.length > 0, samples.map(function (s) { return s.length; }).join(','));
    } catch (e) { pass('treatments table readable', false, e.message); }

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) { pass('Chrome found for CDP', false, CHROME); finish(1); return; }
    var profile = path.join(os.tmpdir(), 'cs-con-notes-layout-cdp');
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
        await cdp.js('window.__samples = ' + JSON.stringify(samples) + ';');
        var live = await cdp.js(PAGE_SCRIPT, true, 240000);

        pass('live: notes composer + draft note present', live && live.ready);
        if (live && live.ready) {
            [['sweepEn', 'English'], ['sweepHant', '繁體中文'], ['sweepCn', '简体中文']].forEach(function (p) {
                var s = live[p[0]];
                pass('live ' + p[1] + ': the main text box never moves while the draft note flashes (' + s.tops + ' widths swept)',
                    s.jumpWidths.length === 0, s.jumpWidths.length ? 'moves at widths ' + s.jumpWidths.join(',') + ' e.g. ' + JSON.stringify(s.jumpDetail[0]) : '');
            });
            pass('live: real database notes in the box - it still never moves while the draft note flashes (EN + 繁體)',
                live.real.length === samples.length && live.real.every(function (x) { return x.enJumps === 0 && x.hantJumps === 0; }), JSON.stringify(live.real));
            pass('live: real typing with the page\'s own 600 ms draft timer - box position constant at 4 widths',
                live.typing.length === 4 && live.typing.every(function (x) { return x.tops.length === 1; }),
                live.typing.map(function (x) { return x.w + ':' + x.tops.join('/'); }).join(' '));
            pass('live: the draft note really cycled (Unsaved… then Draft saved) during that typing',
                live.typing.every(function (x) { return x.typedWords === 5; }) && live.typing.every(function (x) { return x.labels.some(function (l) { return /Unsaved/.test(l); }) && x.labels.some(function (l) { return /Draft saved/.test(l); }); }),
                JSON.stringify(live.typing[0].labels));
            [['headHant', '繁體中文'], ['headCn', '简体中文'], ['headEn', 'English']].forEach(function (p) {
                var h = live[p[0]];
                pass('live ' + p[1] + ': heading "' + h.text.trim() + '" is a single row at every width with the review chip + buttons shown',
                    h.tall.length === 0 && h.rows.join() === '1', h.tall.length ? 'two rows at widths ' + h.tall.join(',') : 'rows=' + h.rows.join());
            });
            pass('live: heading computed white-space is nowrap', live.h3NoWrap === 'nowrap', live.h3NoWrap);
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
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + CDP + LIVE PAGE ALL PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}
