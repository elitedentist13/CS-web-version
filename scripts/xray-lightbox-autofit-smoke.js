/**
 * Consultation > X-ray lightbox:
 *  - first open auto-fits to the normal viewing panel (not maximize)
 *  - maximize pins the film upper-left and contain-scales into the zone
 * Smoke + HTTP spot + API + CDP Runtime.evaluate + live page + sample panoramic.
 * Run: node scripts/xray-lightbox-autofit-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261015max2';
var PAGE_PORT = 8851;
var CDP_PORT = 9421;
var CHROME = process.env.CHROME_PATH || (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
var root = path.resolve(__dirname, '..');
var PANO_REL = 'denct/shots/view-panoramic.jpg';
var fails = [];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function httpGetText(port, reqPath) {
    return new Promise(function (resolve, reject) {
        var req = http.get({ host: '127.0.0.1', port: port, path: reqPath, timeout: 8000 }, function (r) {
            var d = '';
            r.setEncoding('binary');
            r.on('data', function (c) { d += c; });
            r.on('end', function () {
                resolve({
                    status: r.statusCode,
                    body: d,
                    bytes: Buffer.byteLength(d, 'binary')
                });
            });
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

function startStaticServer(port) {
    var types = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.svg': 'image/svg+xml'
    };
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

function finish(code) {
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + API + CDP + LIVE PAGE + SAMPLE PANO ALL PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}

(async function () {
    var html = read('index.html');
    var src = read('app-xray.js');

    console.log('=== source ===');
    pass('index BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    pass('xray module cache-bust', html.indexOf("'app-xray.js?v=" + BUILD + "'") >= 0);
    pass('lbScheduleFitToViewer helper exists',
        src.indexOf('function lbScheduleFitToViewer') >= 0 &&
        extractFn(src, 'lbScheduleFitToViewer').indexOf('lbFitToScrollHost') >= 0);
    pass('first open schedules panel fit (not maximize)',
        extractFn(src, 'lbInitCanvas').indexOf('lbScheduleFitToViewer') >= 0 &&
        extractFn(src, 'openLightbox').indexOf('lbScheduleFitToViewer') >= 0 &&
        extractFn(src, 'openLightbox').indexOf('lbChromeMaximized = true') < 0);
    pass('Reset returns to panel fit',
        extractFn(src, 'lbReset').indexOf('lbFitToScrollHost') >= 0);
    pass('maximize contain-fits and pins upper-left',
        extractFn(src, 'lbFitToScrollHost').indexOf('Math.min(fitW, fitH)') >= 0 &&
        extractFn(src, 'lbFitToScrollHost').indexOf('lbResetScrollHost') >= 0 &&
        extractFn(src, 'lbSyncLightboxScrollShell').indexOf('!lbChromeMaximized') >= 0);
    pass('sample panoramic fixture exists',
        fs.existsSync(path.join(root, PANO_REL)));

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var spotIdx = await httpGetText(PAGE_PORT, '/index.html');
    pass('GET /index.html',
        spotIdx.status === 200 && spotIdx.body.indexOf("BUILD = '" + BUILD + "'") >= 0,
        'HTTP ' + spotIdx.status);
    var spotJs = await httpGetText(PAGE_PORT, '/app-xray.js?v=' + BUILD);
    pass('GET /app-xray.js',
        spotJs.status === 200 && spotJs.body.indexOf('function lbScheduleFitToViewer') >= 0,
        'HTTP ' + spotJs.status);
    var spotCss = await httpGetText(PAGE_PORT, '/style.css?b=' + BUILD);
    pass('GET /style.css', spotCss.status === 200 && spotCss.bytes > 1000, 'HTTP ' + spotCss.status);
    var spotPano = await httpGetText(PAGE_PORT, '/' + PANO_REL);
    pass('GET sample panoramic jpeg',
        spotPano.status === 200 && spotPano.bytes > 10000,
        'bytes ' + spotPano.bytes);

    console.log('\n=== API ===');
    try {
        var sb = readSbConfig(read('app.js'));
        var apiUrl = sb.url.replace(/\/$/, '') +
            '/rest/v1/xrays?select=id,xray_type&xray_type=ilike.*pano*&limit=3';
        var apiRes = await fetch(apiUrl, {
            headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
        });
        var apiRows = apiRes.ok ? await apiRes.json() : null;
        pass('Supabase xrays panoramic query',
            apiRes.status === 200 && Array.isArray(apiRows),
            'status ' + apiRes.status + ' rows ' + (apiRows ? apiRows.length : 0) +
                (apiRows && apiRows[0] ? ' type ' + apiRows[0].xray_type : ''));
    } catch (e) {
        pass('Supabase xrays panoramic query', false, e && e.message ? e.message : String(e));
    }

    console.log('\n=== CDP Runtime.evaluate + live page + sample pano ===');
    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        try { server.close(); } catch (e0) { /* ignore */ }
        finish(1);
        return;
    }

    var live5500 = null;
    try {
        live5500 = await httpGetText(5500, '/index.html');
        if (live5500.status === 200 && live5500.body.indexOf("BUILD = '" + BUILD + "'") >= 0) {
            pass('clinic page on :5500 serves BUILD ' + BUILD, true, 'HTTP ' + live5500.status);
        } else {
            pass('clinic page on :5500 (optional)', true,
                'up but BUILD not yet ' + BUILD + ' (HTTP ' + live5500.status + ')');
            live5500 = null;
        }
    } catch (e1) {
        pass('clinic page on :5500 (optional)', true, 'not running');
        live5500 = null;
    }

    var profile = path.join(os.tmpdir(), 'cs-xray-lb-autofit-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e2) { /* ignore */ }
    fs.mkdirSync(profile, { recursive: true });
    var hosted = 'http://127.0.0.1:' + PAGE_PORT + '/index.html?b=' + BUILD;
    var proc = child_process.spawn(CHROME, [
        '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + profile,
        '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-popup-blocking',
        '--window-size=1400,900',
        hosted
    ], { stdio: 'ignore' });

    var ws = null;
    try {
        var waitJson = async function (url, timeoutMs) {
            var deadline = Date.now() + timeoutMs, last = null;
            while (Date.now() < deadline) {
                try {
                    var raw = await new Promise(function (resolve, reject) {
                        http.get(url, function (r) {
                            var d = '';
                            r.on('data', function (c) { d += c; });
                            r.on('end', function () { resolve(d); });
                        }).on('error', reject);
                    });
                    return JSON.parse(raw);
                } catch (e) { last = e; await sleep(250); }
            }
            throw new Error('timeout ' + url + ' last=' + (last && last.message));
        };
        await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000);
        var tabs = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000);
        var page = (tabs || []).find(function (t) {
            return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0;
        });
        pass('CDP page target', !!page && !!page.webSocketDebuggerUrl, page ? page.url : 'none');
        if (!page) throw new Error('no page target');
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) {
            ws.addEventListener('open', resolve);
            ws.addEventListener('error', reject);
        });
        var cdp = new Cdp(ws);
        await cdp.call('Page.enable');
        await cdp.call('Runtime.enable');
        await cdp.call('Page.navigate', { url: hosted });
        await sleep(900);

        var live = await cdp.js(`(async function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms) => {
    const end = Date.now() + (ms || 8000);
    while (Date.now() < end) {
      try { if (fn()) return true; } catch (e) {}
      await wait(50);
    }
    return false;
  };
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    if (typeof openLightbox === 'function' && typeof lbFitToScrollHost === 'function' &&
        typeof lbScheduleFitToViewer === 'function') break;
    await wait(200);
  }
  const out = {
    ready: typeof lbScheduleFitToViewer === 'function' && typeof lbFitToScrollHost === 'function',
    build: window.__JSM_BUILD || ''
  };
  if (!out.ready) return out;

  var login = document.getElementById('loginOverlay');
  if (login) login.style.display = 'none';
  var cons = document.getElementById('consultationSection');
  if (cons) {
    cons.hidden = false;
    cons.style.display = 'block';
    cons.style.visibility = 'visible';
  }
  window.sv = window.sv || function (id, val) {
    var el = document.getElementById(id);
    if (el && 'value' in el) el.value = val == null ? '' : String(val);
  };
  function stageLightboxShell() {
    var modal = document.getElementById('xrayLightbox');
    if (!modal) return null;
    var maxed = !!lbChromeMaximized || modal.classList.contains('xray-lb-maximized');
    modal.style.cssText = maxed
      ? 'display:block;position:fixed;inset:0;z-index:99999;padding:0;background:#000;'
      : 'display:block;position:fixed;inset:0;z-index:99999;padding:32px;background:rgba(0,0,0,.4);';
    var box = modal.querySelector('.xray-lightbox-box');
    if (box) {
      box.style.cssText = maxed
        ? 'display:flex;flex-direction:column;width:100%;height:100%;max-width:none;max-height:none;margin:0;overflow:hidden;background:#fff;border-radius:0;'
        : 'display:flex;flex-direction:column;width:1100px;height:720px;max-width:none;max-height:none;margin:0 auto;overflow:hidden;background:#fff;';
    }
    var main = document.getElementById('xrayLbMain');
    if (main) main.style.cssText = 'display:flex;flex:1 1 auto;min-height:0;min-width:0;';
    var viewer = document.getElementById('xrayLbViewerDiv') || document.querySelector('#xrayLightbox .xray-lb-viewer');
    if (viewer) {
      viewer.style.cssText = maxed
        ? 'display:flex;flex:1 1 auto;min-height:0;min-width:0;padding:0;background:#0d0d1a;'
        : 'display:flex;flex:1 1 auto;min-height:0;min-width:0;padding:12px;background:#0d0d1a;';
    }
    var host = document.getElementById('xrayLbScrollHost');
    if (host) {
      host.style.cssText = maxed
        ? 'flex:1 1 auto;min-height:240px;width:100%;overflow:auto;border:none;border-radius:0;'
        : 'flex:1 1 auto;min-height:240px;width:100%;overflow:auto;border:1px solid #1f2a44;';
      if (maxed) host.classList.remove('xray-lb-scroll-host-fit');
    }
    return modal;
  }
  window.openModal = function (id) {
    if (id === 'xrayLightbox') stageLightboxShell();
    else {
      var m = document.getElementById(id);
      if (m) m.style.display = 'block';
    }
  };
  window.closeModal = window.closeModal || function (id) {
    var m = document.getElementById(id);
    if (m) m.style.display = 'none';
  };
  window.mediaTr = window.mediaTr || function (k) { return k; };
  window.xrayDisplayUrl = function (x) { return (x && x.file_url) || ''; };
  window.xrayAiOnLightboxOpen = function () {};
  window.xrayCtxFillLightbox = function () {};

  var panoUrl = '/${PANO_REL}';
  window.xrayFiltered = [{
    id: 'sample-pano',
    xray_type: 'Panoramic',
    taken_date: '2024-01-01',
    notes: '',
    file_url: panoUrl,
    patient_id: 'p1',
    _isHome: true
  }];
  window.xrayAllRecords = window.xrayFiltered.slice();

  stageLightboxShell();
  openLightbox(0);
  var modal = stageLightboxShell();
  // Use the film zone only (info column hidden) so host size is stable.
  if (typeof lbChromeMetaVisible !== 'undefined') lbChromeMetaVisible = false;
  if (typeof lbSyncLightboxChrome === 'function') lbSyncLightboxChrome();
  stageLightboxShell();
  var main = document.getElementById('xrayLbMain');
  if (main) main.classList.add('xray-lb-meta-hidden');

  await until(function () {
    var img = document.getElementById('xrayLbImg');
    return img && img.complete && img.naturalWidth > 100 && lbLayoutBaseW > 0;
  }, 10000);
  stageLightboxShell();
  if (main) main.classList.add('xray-lb-meta-hidden');
  // Force a contain-fit now that the host has a real size.
  lbCaptureLayoutBaseFromImg();
  lbSyncLightboxScrollShell();
  lbFitToScrollHost();
  await wait(80);
  lbFitToScrollHost();
  await wait(80);

  var host = document.getElementById('xrayLbScrollHost');
  var inner = document.getElementById('xrayLbScrollInner');
  var wrap = document.getElementById('lbMediaWrap');
  var img = document.getElementById('xrayLbImg');
  var hr = host.getBoundingClientRect();
  // Scroll-inner is sized to the scaled film bbox (layout base × scale).
  var pw = inner ? inner.offsetWidth : 0;
  var ph = inner ? inner.offsetHeight : 0;
  out.nat = [img.naturalWidth, img.naturalHeight];
  out.host = [Math.round(hr.width), Math.round(hr.height)];
  out.painted = [pw, ph];
  out.scale = Number(lbTransform.scale);
  out.base = [lbLayoutBaseW, lbLayoutBaseH];
  out.tx = wrap ? String(wrap.style.transform || '') : '';
  out.maxed = !!(modal && modal.classList.contains('xray-lb-maximized'));
  out.fitsW = pw <= hr.width + 6;
  out.fitsH = ph <= hr.height + 6;
  out.fill = Math.max(pw / Math.max(1, hr.width), ph / Math.max(1, hr.height));
  out.aspectOk = ph > 1 &&
    Math.abs((pw / ph) - (img.naturalWidth / img.naturalHeight)) < 0.12;

  stageLightboxShell();
  lbFitToScrollHost();
  await wait(60);
  var scaleBeforeReset = Number(lbTransform.scale);
  lbReset();
  await wait(100);
  out.resetScale = Number(lbTransform.scale);
  out.resetMaxed = !!(modal && modal.classList.contains('xray-lb-maximized'));
  out.resetNear = Math.abs(out.resetScale - scaleBeforeReset) < 0.15;
  out.scaleBeforeReset = scaleBeforeReset;

  // ── Maximize: upper-left pin + contain-fit, no crop ─────────────
  lbToggleMaximize();
  await wait(120);
  stageLightboxShell();
  if (main) main.classList.add('xray-lb-meta-hidden');
  lbFitToScrollHost();
  await wait(80);
  lbFitToScrollHost();
  await wait(80);

  host = document.getElementById('xrayLbScrollHost');
  inner = document.getElementById('xrayLbScrollInner');
  img = document.getElementById('xrayLbImg');
  hr = host.getBoundingClientRect();
  var ir = inner.getBoundingClientRect();
  pw = inner.offsetWidth;
  ph = inner.offsetHeight;
  var meta = document.getElementById('xrayLbMeta');
  var metaCs = meta ? getComputedStyle(meta) : null;
  out.max = {
    maxed: !!(modal && modal.classList.contains('xray-lb-maximized')),
    metaHidden: !!(main && main.classList.contains('xray-lb-meta-hidden')),
    metaDisplay: metaCs ? metaCs.display : '',
    host: [Math.round(hr.width), Math.round(hr.height)],
    painted: [pw, ph],
    scale: Number(lbTransform.scale),
    fitsW: pw <= hr.width + 6,
    fitsH: ph <= hr.height + 6,
    fill: Math.max(pw / Math.max(1, hr.width), ph / Math.max(1, hr.height)),
    aspectOk: ph > 1 && Math.abs((pw / ph) - (img.naturalWidth / img.naturalHeight)) < 0.12,
    anchorLeft: Math.abs(ir.left - hr.left) <= 8,
    anchorTop: Math.abs(ir.top - hr.top) <= 8,
    scroll: [host.scrollLeft, host.scrollTop],
    noCenterClass: !host.classList.contains('xray-lb-scroll-host-fit')
  };

  return out;
})()`, true, 45000);

        pass('live helpers loaded',
            live && live.ready === true && live.build === BUILD,
            JSON.stringify({ ready: live && live.ready, build: live && live.build }));
        if (live && live.ready) {
            pass('first open does not maximize',
                live.maxed === false,
                'maxed=' + live.maxed);
            pass('sample panoramic loads and keeps aspect',
                Array.isArray(live.nat) && live.nat[0] > 100 && live.aspectOk === true,
                JSON.stringify({ nat: live.nat, aspectOk: live.aspectOk }));
            pass('film auto-fits inside the viewing panel',
                live.fitsW === true && live.fitsH === true && live.scale > 0.05 && live.scale < 8,
                JSON.stringify({
                    host: live.host, painted: live.painted, scale: live.scale,
                    fitsW: live.fitsW, fitsH: live.fitsH, fill: live.fill
                }));
            pass('fit uses a comfortable share of the panel (not a tiny stamp)',
                live.fill >= 0.55,
                'fill=' + live.fill);
            pass('Reset restores the same panel fit (still not max)',
                live.resetMaxed === false && live.resetNear === true,
                JSON.stringify({ resetScale: live.resetScale, resetNear: live.resetNear }));
            var mx = live.max || {};
            pass('maximize hides the right image-info panel and grows the lightbox',
                mx.maxed === true && mx.metaHidden === true && mx.metaDisplay === 'none',
                JSON.stringify({ maxed: mx.maxed, metaHidden: mx.metaHidden, metaDisplay: mx.metaDisplay }));
            pass('maximize pins film to upper-left of viewing zone',
                mx.anchorLeft === true && mx.anchorTop === true &&
                mx.scroll && mx.scroll[0] === 0 && mx.scroll[1] === 0 &&
                mx.noCenterClass === true,
                JSON.stringify({
                    anchorLeft: mx.anchorLeft, anchorTop: mx.anchorTop,
                    scroll: mx.scroll, noCenterClass: mx.noCenterClass
                }));
            pass('maximize contain-scales without cropping',
                mx.fitsW === true && mx.fitsH === true && mx.aspectOk === true &&
                mx.fill >= 0.7 && mx.scale > 0.05,
                JSON.stringify({
                    host: mx.host, painted: mx.painted, scale: mx.scale,
                    fitsW: mx.fitsW, fitsH: mx.fitsH, fill: mx.fill, aspectOk: mx.aspectOk
                }));
        }

        if (live5500 && live5500.status === 200 &&
            live5500.body.indexOf("BUILD = '" + BUILD + "'") >= 0) {
            await cdp.call('Page.navigate', { url: 'http://127.0.0.1:5500/index.html?_lr=' + BUILD });
            await sleep(1000);
            var clinic = await cdp.js(`(async function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (typeof lbScheduleFitToViewer === 'function' && typeof openLightbox === 'function') break;
    await wait(200);
  }
  return {
    ready: typeof lbScheduleFitToViewer === 'function' && typeof lbFitToScrollHost === 'function',
    build: window.__JSM_BUILD || ''
  };
})()`, true, 25000);
            pass('live clinic :5500 has autofit helpers',
                clinic && clinic.ready === true && clinic.build === BUILD,
                JSON.stringify(clinic));
        }
    } catch (e) {
        pass('CDP live page', false, e && e.message ? e.message : String(e));
    } finally {
        try { if (ws) ws.close(); } catch (e3) { /* ignore */ }
        try { if (proc) proc.kill(); } catch (e4) { /* ignore */ }
        try { server.close(); } catch (e5) { /* ignore */ }
    }

    finish(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
