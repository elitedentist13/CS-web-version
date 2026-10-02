/**
 * Perio charting header PD-depth filter (=4mm, >=4mm, =5mm, >=5mm).
 * Smoke (source) + unit (vm) + CDP Runtime.evaluate on the live page.
 * Run: node scripts/perio-pd-filter-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261003cbe';
var PAGE_PORT = 8796;
var CDP_PORT = 9358;
var CHROME = process.env.CHROME_PATH ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var root = path.resolve(__dirname, '..');
var fails = [];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

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

function readSbConfig(appJs) {
    var block = appJs.match(/supabase\.createClient\(([\s\S]*?)\);/);
    if (!block) throw new Error('supabase.createClient not found');
    var parts = [];
    var re = /'([^']*)'/g, m;
    while ((m = re.exec(block[1]))) parts.push(m[1]);
    return { url: parts[0], key: parts.slice(1).join('') };
}

function extractFn(src, name) {
    var start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('missing ' + name);
    var depth = 0;
    for (var j = src.indexOf('{', start); j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
    }
    throw new Error('unclosed ' + name);
}

function i18nHasAll(src, key) {
    var i = src.indexOf("'" + key + "':");
    if (i < 0) return false;
    var end = src.indexOf("\n        '", i + 5);
    var block = src.slice(i, end < 0 ? i + 600 : end);
    return block.indexOf('en:') >= 0 && block.indexOf("'zh-CN':") >= 0 && block.indexOf("'zh-Hant':") >= 0;
}

/* Shared fixture: tooth -> expectations.
 * 16: bd=4 ; 46: bm=4, lm=5 ; 26: lme=5 ; 11: bm=6 ; 31: bd=3 (never) ; 36: bd=4 but MISSING tooth. */
var FIXTURE = {
    '16_pd_b_d': 4, '16_pd_b_m': 3,
    '46_pd_b_m': 4, '46_pd_l_m': 5,
    '26_pd_l_me': 5,
    '11_pd_b_m': 6,
    '31_pd_b_d': 3,
    '36_pd_b_d': 4
};
var EXPECT = {
    eq4: { teeth: [16, 46], sites: 2 },
    ge4: { teeth: [11, 16, 26, 46], sites: 5 },
    eq5: { teeth: [26, 46], sites: 2 },
    ge5: { teeth: [11, 26, 46], sites: 3 }
};

(async function () {
    var charts = read('app-charts.js');
    var i18n = read('app-i18n-extra.js');
    var html = read('index.html');

    console.log('=== source ===');
    pass('index BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    pass('app-charts.js cache-buster bumped', html.indexOf('app-charts.js?v=' + BUILD) >= 0);
    pass('app-i18n-extra.js cache-buster bumped', html.indexOf('app-i18n-extra.js?v=' + BUILD) >= 0);
    pass('header toolbar mounts the filter group',
        extractFn(charts, 'buildPerioViewToolbar').indexOf('buildPerioPdFilterGroup()') >= 0);
    pass('updatePerioSummary re-applies the filter (runs on render + every input)',
        extractFn(charts, 'updatePerioSummary').indexOf('perioPdApplyFilter()') >= 0);
    pass('both tooth header builders tag data-tn',
        (charts.match(/th\.setAttribute\('data-tn'/g) || []).length === 2);
    pass('diagram tooth label highlights via perioPdToothMatches',
        extractFn(charts, 'pdMidRowSVG').indexOf('perioPdToothMatches(tn)') >= 0);
    ['pdFilterLabel', 'pdFilterTitle', 'pdFilterCountTitle', 'pdFilterUnit'].forEach(function (k) {
        pass('i18n chart.perio.' + k + ' en / zh-CN / zh-Hant', i18nHasAll(i18n, 'chart.perio.' + k));
    });

    console.log('\n=== unit (vm) ===');
    var ctx = {
        perioState: {}, dentalState: {}, perioPdFilter: '',
        UPPER_RIGHT: [18, 17, 16, 15, 14, 13, 12, 11], UPPER_LEFT: [21, 22, 23, 24, 25, 26, 27, 28],
        LOWER_RIGHT: [48, 47, 46, 45, 44, 43, 42, 41], LOWER_LEFT: [31, 32, 33, 34, 35, 36, 37, 38],
        g: function () { return null; }
    };
    vm.createContext(ctx);
    var filtersDecl = charts.slice(charts.indexOf('var PERIO_PD_FILTERS'), charts.indexOf('// Active tool'));
    vm.runInContext(filtersDecl, ctx);
    ['pdGetSiteVal', 'pdToothIsMissing', 'perioPdSiteMatches', 'perioPdToothMatches'].forEach(function (n) {
        vm.runInContext(extractFn(charts, n), ctx);
    });
    Object.keys(FIXTURE).forEach(function (k) { ctx.perioState[k] = FIXTURE[k]; });
    ctx.dentalState[36] = ['missing'];
    var all = ctx.UPPER_RIGHT.concat(ctx.UPPER_LEFT, ctx.LOWER_RIGHT, ctx.LOWER_LEFT);
    pass('four criteria defined', Object.keys(ctx.PERIO_PD_FILTERS).join() === 'eq4,ge4,eq5,ge5');
    Object.keys(EXPECT).forEach(function (key) {
        ctx.perioPdFilter = key;
        var teeth = all.filter(function (tn) { return ctx.perioPdToothMatches(tn); }).sort(function (a, b) { return a - b; });
        pass('unit ' + key + ' teeth = ' + EXPECT[key].teeth.join('/'),
            teeth.join() === EXPECT[key].teeth.join(), 'got ' + teeth.join('/'));
    });
    ctx.perioPdFilter = '';
    pass('unit filter off matches nothing', all.every(function (tn) { return !ctx.perioPdToothMatches(tn); }));

    console.log('\n=== HTTP spot (served files) ===');
    var server = await startStaticServer(PAGE_PORT);
    var spotIdx = await httpGetText(PAGE_PORT, '/index.html');
    pass('GET /index.html serves BUILD ' + BUILD, spotIdx.status === 200 && spotIdx.body.indexOf(BUILD) >= 0);
    var spotCharts = await httpGetText(PAGE_PORT, '/app-charts.js?v=' + BUILD);
    pass('GET /app-charts.js serves the filter',
        spotCharts.status === 200 && ['perioPdApplyFilter', 'buildPerioPdFilterGroup', 'perio-pd-hl-tooth']
            .every(function (s) { return spotCharts.body.indexOf(s) >= 0; }));
    var spotI18n = await httpGetText(PAGE_PORT, '/app-i18n-extra.js?v=' + BUILD);
    pass('GET /app-i18n-extra.js serves the labels', spotI18n.status === 200 && spotI18n.body.indexOf('chart.perio.pdFilterCountTitle') >= 0);

    console.log('\n=== API (read-only, anon) + testclient on real records ===');
    var sb = readSbConfig(read('app.js'));
    var realRows = [];
    try {
        var apiRes = await fetch(sb.url.replace(/\/$/, '') + '/rest/v1/dental_charts?select=id,patient_id,chart_date,dental_data,perio_data&perio_data=not.is.null&order=chart_date.desc&limit=40',
            { headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' } });
        var apiJson = await apiRes.json();
        pass('dental_charts readable (perio_data column)', apiRes.status === 200 && Array.isArray(apiJson), 'HTTP ' + apiRes.status);
        (apiJson || []).forEach(function (r) {
            try {
                var per = typeof r.perio_data === 'string' ? JSON.parse(r.perio_data) : r.perio_data;
                var den = typeof r.dental_data === 'string' ? JSON.parse(r.dental_data) : (r.dental_data || {});
                var hasPd = Object.keys(per || {}).some(function (k) { return /^\d+_pd_[bl]_(d|m|me)$/.test(k) && Number(per[k]) > 0; });
                if (hasPd) realRows.push({ id: r.id, per: per, den: den || {} });
            } catch (e) { /* skip unparsable */ }
        });
    } catch (e) {
        pass('dental_charts readable (perio_data column)', false, e.message);
    }
    pass('real records with PD values found', realRows.length > 0, realRows.length + ' of up to 40');
    realRows = realRows.slice(0, 6);
    function independentCount(row, key) {
        var f = EXPECT_RULES[key];
        var teeth = {};
        Object.keys(row.per).forEach(function (k) {
            var m = k.match(/^(\d+)_pd_[bl]_(d|m|me)$/);
            if (!m) return;
            var tn = m[1];
            if ((row.den[tn] || []).indexOf('missing') >= 0) return;
            var v = parseFloat(row.per[k]) || 0;
            if (v > 0 && (f.op === 'eq' ? v === f.v : v >= f.v)) teeth[tn] = 1;
        });
        return Object.keys(teeth).length;
    }
    var EXPECT_RULES = { eq4: { op: 'eq', v: 4 }, ge4: { op: 'ge', v: 4 }, eq5: { op: 'eq', v: 5 }, ge5: { op: 'ge', v: 5 } };
    realRows.forEach(function (row) {
        ctx.perioState = row.per; ctx.dentalState = row.den;
        var bad = [];
        Object.keys(EXPECT_RULES).forEach(function (key) {
            ctx.perioPdFilter = key;
            var got = all.filter(function (tn) { return ctx.perioPdToothMatches(tn); }).length;
            if (got !== independentCount(row, key)) bad.push(key + ' ' + got + '!=' + independentCount(row, key));
            row['c_' + key] = got;
        });
        pass('testclient real chart ' + String(row.id).slice(0, 8) + ' counts match independent tally (' +
            ['eq4', 'ge4', 'eq5', 'ge5'].map(function (k) { return row['c_' + k]; }).join('/') + ')', !bad.length, bad.join('; '));
        pass('testclient real chart ' + String(row.id).slice(0, 8) + ' invariants (ge4>=eq4, ge5>=eq5, ge4>=ge5)',
            row.c_ge4 >= row.c_eq4 && row.c_ge5 >= row.c_eq5 && row.c_ge4 >= row.c_ge5);
    });
    ctx.perioPdFilter = '';

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        finish(1);
        return;
    }
    var profile = path.join(os.tmpdir(), 'cs-perio-pd-filter-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    fs.mkdirSync(profile, { recursive: true });
    var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/index.html?_lr=' + BUILD;
    var proc = child_process.spawn(CHROME, [
        '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + profile,
        '--no-first-run', '--no-default-browser-check', '--disable-sync',
        '--host-resolver-rules=MAP xray-ai.test 127.0.0.1',
        '--window-size=1500,1000',
        hosted
    ], { stdio: 'ignore' });

    var ws = null;
    try {
        await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000);
        var tabs = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000);
        var page = (tabs || []).find(function (t) {
            return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0;
        });
        pass('CDP page target', !!page && !!page.webSocketDebuggerUrl);
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
        var cdp = new Cdp(ws);
        await cdp.call('Page.enable');
        await cdp.call('Runtime.enable');
        await cdp.call('Page.navigate', { url: hosted });
        await sleep(1200);

        var live = await cdp.js('(async () => {' +
          'const wait = (ms) => new Promise((r) => setTimeout(r, ms));' +
          'const deadline = Date.now() + 25000;' +
          'while (Date.now() < deadline) { if (typeof renderPerioPane === "function" && typeof perioPdApplyFilter === "function") break; await wait(200); }' +
          'const out = { ready: typeof perioPdApplyFilter === "function" };' +
          'if (!out.ready) return out;' +
          'const login = document.getElementById("loginOverlay"); if (login) login.style.display = "none";' +
          'let pane = document.getElementById("chartPane-perio");' +
          'if (!pane) { pane = document.createElement("div"); pane.id = "chartPane-perio"; document.body.appendChild(pane); }' +
          'injectChartCSS();' +
          'const FIX = ' + JSON.stringify(FIXTURE) + ';' +
          'perioState = {}; Object.keys(FIX).forEach((k) => { perioState[k] = FIX[k]; });' +
          'dentalState = { 36: ["missing"] };' +
          'perioViewMode = "table"; perioCompactMode = false; perioPdFilter = "";' +
          'renderPerioPane();' +
          'const btnIds = ["eq4","ge4","eq5","ge5"];' +
          'const btn = (k) => { const b = document.getElementById("perioPdBtn-" + k); if (b) b.removeAttribute("data-last-click-ms"); return b; };' +
          'const cnt = () => document.getElementById("perioPdCount");' +
          'const snap = () => {' +
          '  const sites = Array.from(pane.querySelectorAll("input.perio-input.perio-pd-hl")).map((e) => e.id);' +
          '  const heads = Array.from(new Set(Array.from(pane.querySelectorAll("th.perio-tooth-cell.perio-pd-hl-tooth")).map((e) => +e.getAttribute("data-tn")))).sort((a,b)=>a-b);' +
          '  const on = btnIds.filter((k) => btn(k).classList.contains("on"));' +
          '  const rects = pane.querySelectorAll("rect.perio-pd-hl-svg").length;' +
          '  return { sites, heads, on, count: cnt().value, rects };' +
          '};' +
          'out.btnLabels = btnIds.map((k) => btn(k) && btn(k).textContent);' +
          'out.initial = snap();' +
          'out.countReadonly = cnt().readOnly;' +
          'out.inToolbar = !!btn("eq4") && btn("eq4").closest("#perioPdFilterGroup") && !!btn("eq4").parentElement.nextElementSibling;' +
          'out.steps = {};' +
          'for (const k of btnIds) { btn(k).click(); out.steps[k] = snap(); }' +
          'btn("ge4").click(); out.afterGe4 = snap();' +
          'btn("eq5").click(); out.afterEq5Switch = snap();' +
          'btn("eq5").click(); out.afterToggleOff = snap();' +
          'btn("ge5").click();' +
          'const inp = document.getElementById("perio_31_pd_b_d");' +
          'inp.value = "5"; inp.dispatchEvent(new Event("input", { bubbles: true }));' +
          'out.afterTypeGe5 = snap();' +
          'inp.value = "2"; inp.dispatchEvent(new Event("input", { bubbles: true }));' +
          'out.afterTypeLow = snap();' +
          'renderPerioPane(); out.afterRerender = snap();' +
          'perioViewMode = "diagram"; renderPerioPane(); out.diagram = snap();' +
          'out.diagramBtnOn = btn("ge5").classList.contains("on");' +
          'perioViewMode = "table"; perioCompactMode = true; renderPerioPane(); out.compactMode = snap();' +
          'perioCompactMode = false; btn("ge5").click(); renderPerioPane(); out.cleared = snap();' +
          'out.noInputHlWhenOff = pane.querySelectorAll(".perio-pd-hl, .perio-pd-hl-tooth").length === 0;' +
          'btn("ge4").click();' +
          'const hl = pane.querySelector("input.perio-input.perio-pd-hl");' +
          'const cs = hl ? getComputedStyle(hl) : null;' +
          'out.pinkBg = cs ? cs.backgroundColor : "";' +
          'const th = pane.querySelector("th.perio-tooth-cell.perio-pd-hl-tooth");' +
          'out.pinkTh = th ? getComputedStyle(th).backgroundColor : "";' +
          'const REAL = ' + JSON.stringify(realRows.map(function (r) { return { id: r.id, per: r.per, den: r.den }; })) + ';' +
          'out.real = [];' +
          'for (const r of REAL) {' +
          '  perioState = r.per; dentalState = r.den; perioViewMode = "table"; perioCompactMode = false; perioPdFilter = "";' +
          '  renderPerioPane();' +
          '  const rec = { id: r.id, counts: {}, siteHl: {}, headHl: {}, singleOn: true };' +
          '  for (const k of btnIds) {' +
          '    btn(k).click(); const s = snap();' +
          '    rec.counts[k] = s.count; rec.siteHl[k] = s.sites.length; rec.headHl[k] = s.heads.length;' +
          '    if (s.on.join() !== k) rec.singleOn = false;' +
          '  }' +
          '  out.real.push(rec);' +
          '}' +
          'return out; })()', true, 60000);

        pass('live: app-charts perio pd filter loaded', live && live.ready);
        if (live && live.ready) {
            pass('live: four buttons labelled =4mm / >=4mm / =5mm / >=5mm',
                live.btnLabels.join('|') === '=4mm|\u22654mm|=5mm|\u22655mm', live.btnLabels.join('|'));
            pass('live: nothing lit and count empty before any choice',
                live.initial.on.length === 0 && live.initial.sites.length === 0 &&
                live.initial.heads.length === 0 && live.initial.count === '');
            pass('live: count box is a read-only text input', live.countReadonly === true);
            Object.keys(EXPECT).forEach(function (k) {
                var s = live.steps[k];
                var e = EXPECT[k];
                pass('live ' + k + ': only this button pressed', s.on.join() === k, s.on.join());
                pass('live ' + k + ': ' + e.sites + ' PD boxes pink', s.sites.length === e.sites, s.sites.join(','));
                pass('live ' + k + ': tooth-number boxes = ' + e.teeth.join('/'), s.heads.join() === e.teeth.join(), s.heads.join('/'));
                pass('live ' + k + ': count = ' + e.teeth.length, s.count === String(e.teeth.length), s.count);
                pass('live ' + k + ': missing tooth 36 never lit',
                    s.heads.indexOf(36) < 0 && s.sites.every(function (id) { return id.indexOf('perio_36_') !== 0; }));
            });
            pass('live: pressing >=4 then =5 deselects >=4 (single choice)',
                live.afterGe4.on.join() === 'ge4' && live.afterEq5Switch.on.join() === 'eq5' &&
                live.afterEq5Switch.count === '2', JSON.stringify([live.afterGe4.on, live.afterEq5Switch.on, live.afterEq5Switch.count]));
            pass('live: pressing the active button again clears everything',
                live.afterToggleOff.on.length === 0 && live.afterToggleOff.sites.length === 0 &&
                live.afterToggleOff.heads.length === 0 && live.afterToggleOff.count === '',
                JSON.stringify(live.afterToggleOff));
            pass('live: typing 5 into a PD box lights it and raises count 3 -> 4',
                live.afterTypeGe5.sites.indexOf('perio_31_pd_b_d') >= 0 && live.afterTypeGe5.heads.indexOf(31) >= 0 &&
                live.afterTypeGe5.count === '4', live.afterTypeGe5.count);
            pass('live: lowering it to 2 un-lights it and count back to 3',
                live.afterTypeLow.sites.indexOf('perio_31_pd_b_d') < 0 && live.afterTypeLow.count === '3');
            pass('live: highlight survives a full re-render',
                live.afterRerender.on.join() === 'ge5' && live.afterRerender.sites.length === 3 &&
                live.afterRerender.count === '3');
            pass('live: chart view (diagram) keeps button + count + lights tooth numbers in the SVG',
                live.diagramBtnOn && live.diagram.count === '3' && live.diagram.rects === 3, 'rects=' + live.diagram.rects);
            pass('live: PD/BOP compact view still highlights',
                live.compactMode.count === '3' && live.compactMode.sites.length === 3);
            pass('live: clearing removes every highlight', live.cleared.count === '' && live.noInputHlWhenOff);
            pass('live: PD box background is translucent pink', /^rgba\(255, 45, 146, 0\.4/.test(live.pinkBg), live.pinkBg);
            pass('live: tooth-number box background is translucent pink', /^rgba\(255, 45, 146, 0\.4/.test(live.pinkTh), live.pinkTh);
            realRows.forEach(function (row, i) {
                var rec = live.real[i];
                var bad = [];
                ['eq4', 'ge4', 'eq5', 'ge5'].forEach(function (k) {
                    var want = row['c_' + k];
                    if (rec.counts[k] !== (want ? String(want) : '0')) bad.push(k + ' box ' + rec.counts[k] + ' != ' + want);
                    if (rec.headHl[k] < want) bad.push(k + ' tooth boxes ' + rec.headHl[k] + ' < ' + want);
                    if (want > 0 && rec.siteHl[k] < want) bad.push(k + ' sites ' + rec.siteHl[k] + ' < teeth ' + want);
                    if (want === 0 && (rec.siteHl[k] !== 0 || rec.headHl[k] !== 0)) bad.push(k + ' lit though count 0');
                });
                pass('live real chart ' + String(row.id).slice(0, 8) + ': count box, pink PD boxes and tooth boxes agree with data',
                    !bad.length && rec.singleOn, bad.join('; '));
            });
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
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + UNIT + CDP + LIVE PAGE ALL PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}
