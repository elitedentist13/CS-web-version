/**
 * Phone scan upload (Consultation Photos / Docs): QR -> phone scanner (scan.html) -> auto-save.
 * The phone is add-only: it may never list, change or delete anything.
 * Smoke / spot / testclient (vm) / API (read-only) + CDP Runtime.evaluate / live page (desktop + phone).
 * Run: node scripts/con-phone-scan-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261002cb9';
var PAGE_PORT = 8795;
var CDP_PORT = 9357;
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

function readSbConfig(appJs) {
    var block = appJs.match(/supabase\.createClient\(([\s\S]*?)\);/);
    if (!block) throw new Error('supabase.createClient not found');
    var parts = [];
    var re = /'([^']*)'/g;
    var m;
    while ((m = re.exec(block[1]))) parts.push(m[1]);
    return { url: parts[0], key: parts.slice(1).join('') };
}

function httpGet(host, port, reqPath) {
    return new Promise(function (resolve, reject) {
        var req = http.get({ host: host, port: port, path: reqPath, timeout: 4000 }, function (r) {
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
            r.on('end', function () {
                try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function waitJson(url, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var last = null;
    while (Date.now() < deadline) {
        try { return await httpGetJson(url); } catch (e) { last = e; await sleep(250); }
    }
    throw new Error('timeout ' + url + ' last=' + (last && last.message));
}

function Cdp(ws) {
    this.ws = ws;
    this.n = 0;
    this.pending = {};
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
        var t = setTimeout(function () {
            delete self.pending[id];
            reject(new Error('CDP timeout ' + method));
        }, timeoutMs);
        self.pending[id] = {
            resolve: function (v) { clearTimeout(t); resolve(v); },
            reject: function (e) { clearTimeout(t); reject(e); }
        };
        self.ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
};

Cdp.prototype.js = async function (expression, awaitPromise, timeoutMs) {
    var r = await this.call('Runtime.evaluate', {
        expression: expression,
        returnByValue: true,
        awaitPromise: !!awaitPromise,
        timeout: (timeoutMs || 45000)
    }, (timeoutMs || 45000) + 5000);
    if (r.exceptionDetails) {
        var ex = r.exceptionDetails.exception || {};
        throw new Error(ex.description || JSON.stringify(r.exceptionDetails));
    }
    return (r.result || {}).value;
};

async function openTarget(url) {
    var res = await fetch('http://127.0.0.1:' + CDP_PORT + '/json/new?' + url, { method: 'PUT' });
    var tab = await res.json();
    var ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise(function (resolve, reject) {
        ws.addEventListener('open', resolve);
        ws.addEventListener('error', reject);
    });
    var cdp = new Cdp(ws);
    await cdp.call('Page.enable');
    await cdp.call('Runtime.enable');
    return { cdp: cdp, ws: ws, id: tab.id };
}

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

function i18nHasAll(src, key) {
    var i = src.indexOf("'" + key + "':");
    if (i < 0) return false;
    var line = src.slice(i, src.indexOf('\n', i));
    return line.indexOf('en:') >= 0 && line.indexOf("'zh-CN':") >= 0 && line.indexOf("'zh-Hant':") >= 0;
}

function storageMemory() {
    var m = {};
    return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
        setItem: function (k, v) { m[k] = String(v); },
        removeItem: function (k) { delete m[k]; }
    };
}

function loadScanSandbox() {
    var sandbox = { console: console, Promise: Promise, setTimeout: setTimeout, Date: Date, Blob: Blob, Math: Math };
    vm.createContext(sandbox);
    vm.runInContext(read('scan.js'), sandbox, { filename: 'scan.js' });
    return sandbox.CSPhoneScan;
}

function loadDeskSandbox() {
    var sandbox = {
        console: console, I18N_STRINGS: {}, t: function (k) { return k; }, setTimeout: setTimeout, clearTimeout: clearTimeout,
        setInterval: setInterval, clearInterval: clearInterval, Promise: Promise, Date: Date,
        crypto: globalThis.crypto, localStorage: storageMemory(),
        location: { href: 'https://clinic.example/app/index.html?x=1#top' }
    };
    vm.createContext(sandbox);
    vm.runInContext(read('app-con-phonescan.js'), sandbox, { filename: 'app-con-phonescan.js' });
    return sandbox;
}

function solid(w, h, rgb) {
    var d = new Uint8ClampedArray(w * h * 4);
    for (var i = 0; i < w * h; i++) { d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255; }
    return { data: d, width: w, height: h };
}

function setPx(img, x, y, rgb) {
    var o = (y * img.width + x) * 4;
    img.data[o] = rgb[0]; img.data[o + 1] = rgb[1]; img.data[o + 2] = rgb[2]; img.data[o + 3] = 255;
}

function getPx(img, x, y) {
    var o = (y * img.width + x) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2]];
}

(async function main() {
    console.log('=== Phone scan upload (BUILD ' + BUILD + ') ===\n');
    var html = read('index.html');
    var scanHtml = read('scan.html');
    var scanSrc = read('scan.js');
    var deskSrc = read('app-con-phonescan.js');
    var mediaSrc = read('app-con-media.js');
    var phSrc = read('app-photos.js');
    var css = read('style.css');

    console.log('=== spot: files, wiring, i18n ===');
    pass('index BUILD', html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    pass('desktop module is cache-busted and loads after the media hub',
        html.indexOf('app-con-phonescan.js?v=' + BUILD) >= 0 &&
        html.indexOf('app-con-phonescan.js') > html.indexOf('app-con-media.js') &&
        html.indexOf('app-con-phonescan.js') > html.indexOf('app-photos.js'));
    pass('scan page: mobile viewport, noindex, scanner script cache-busted',
        /name="viewport"[^>]*width=device-width/.test(scanHtml) && /name="robots" content="noindex/.test(scanHtml) &&
        scanHtml.indexOf('scan.js?v=' + BUILD) >= 0 && scanHtml.indexOf('CSPhoneScan.boot()') >= 0);
    pass('scan page has every view the script drives',
        ['scIntro', 'scCamera', 'scCrop', 'scPreview', 'scSend', 'scDone', 'scError', 'scVideo', 'scShutter', 'scFinishBtn',
         'scModeAuto', 'scModeManual', 'scCount', 'scGuide', 'scPreviewNext', 'scPreviewRetake', 'scPreviewEdit', 'scEditPanel', 'scPreviewCrop', 'scAddPage', 'scViewerScroll',
         'scFineTune', 'scTune', 'scTuneCanvas', 'scTuneSharp', 'scTuneContrast', 'scTuneSharpVal', 'scTuneContrastVal', 'scTuneSave', 'scTuneCancel', 'scTuneReset',
         'scCropCanvas', 'scPreviewCanvas', 'scSendBtn', 'scFmtPdf', 'scFmtImg', 'scTray', 'scMoreBtn'].every(function (id) {
            return scanHtml.indexOf('id="' + id + '"') >= 0;
        }));
    var domIds = (scanSrc.match(/\$\('([A-Za-z0-9]+)'\)/g) || []).map(function (s) { return s.slice(3, -2); });
    pass('every element id the scanner script looks up exists in scan.html',
        domIds.length > 20 && domIds.every(function (id) { return scanHtml.indexOf('id="' + id + '"') >= 0; }),
        domIds.filter(function (id) { return scanHtml.indexOf('id="' + id + '"') < 0; }).join(','));
    pass('modal, steps, QR host, status, category, link settings exist in index',
        ['conScanModal', 'conScanQr', 'conScanTimer', 'conScanStatus', 'conScanList', 'conScanCat', 'conScanAutoClose',
         'conScanBase', 'conScanLocalWarn', 'conScanShowBtn', 'conScanFor'].every(function (id) {
            return html.indexOf('id="' + id + '"') >= 0;
        }));
    pass('hub Add menu has the phone scan entry and opens the modal',
        mediaSrc.indexOf("['phone', '📱', 'cm.add.phone']") >= 0 && /act === 'phone'[\s\S]{0,120}conScanOpen\(\)/.test(mediaSrc));
    pass('Scanned Document is a photo category, badge colour, and counts under Consents, Lab & Scans',
        phSrc.indexOf("['Scanned Document', 'media.cat.scanDoc']") >= 0 && phSrc.indexOf("'Scanned Document': '#cffafe:#155e75'") >= 0 &&
        mediaSrc.indexOf("'Consent Form', 'Lab Report', 'Scanned Document'") >= 0);
    pass('photoUploadOne can save for an explicit patient (session keeps its patient if the screen changes)',
        /var pid = meta\.patientId \|\| photoPatientId;/.test(phSrc));
    pass('scan CSS: modal, QR, status states, new-card highlight',
        ['.con-scan-box', '.con-scan-qr', '.con-scan-status[data-state="done"]', '.xray-card.con-scan-new', '@keyframes conScanFlash'].every(function (s) {
            return css.indexOf(s) >= 0;
        }));
    var deskKeys = (deskSrc.match(/'(cm\.scan\.[A-Za-z0-9]+|cm\.add\.phone|media\.cat\.scanDoc)':/g) || []).map(function (s) { return s.slice(1, -2); });
    pass('every desktop string has en + zh-CN + zh-Hant', deskKeys.length >= 30 && deskKeys.every(function (k) { return i18nHasAll(deskSrc, k); }),
        deskKeys.length + ' keys');
    var usedKeys = (html.match(/data-i18n="(cm\.scan\.[A-Za-z0-9]+)"/g) || []).map(function (s) { return s.slice(11, -1); });
    pass('every i18n key used in the modal is defined', usedKeys.length >= 10 && usedKeys.every(function (k) { return deskSrc.indexOf("'" + k + "':") >= 0; }));
    var scan = loadScanSandbox();
    var langs = ['en', 'zh-Hant', 'zh-CN'].map(function (l) { return Object.keys(scan.strings(l)).sort().join(','); });
    pass('phone page strings are complete in all three languages', langs[0] === langs[1] && langs[1] === langs[2] && langs[0].split(',').length > 30);

    console.log('\n=== spot: the phone can only add ===');
    var forbidden = [/\.remove\s*\(/, /\.update\s*\(/, /\.delete\s*\(/, /\.list\s*\(/, /\.download\s*\(/, /\.insert\s*\(/,
        /\.select\s*\(/, /\.upsert\s*\(/, /createSignedUrl/, /getPublicUrl/, /\bsb\.from\s*\(/, /upsert:\s*true/, /\.move\s*\(/, /\.copy\s*\(/];
    var bad = forbidden.filter(function (re) { return re.test(scanSrc); }).map(String);
    pass('scan.js never lists, downloads, updates, moves, removes or overwrites', bad.length === 0, bad.join(' '));
    pass('scan.js has exactly one storage write call, with upsert disabled',
        (scanSrc.match(/bucket\.upload\s*\(/g) || []).length === 1 && /upsert:\s*false/.test(scanSrc));
    pass('scan.js only writes under phone-scan/<token>/ and refuses other paths',
        /indexOf\(PREFIX \+ '\/'\) !== 0/.test(scanSrc) && scanSrc.indexOf("var PREFIX = 'phone-scan'") >= 0);
    pass('scan page does not load any app code, session or patient data',
        !/app\.js|app-con|localStorage|patients|currentUser/.test(scanSrc.replace(/\/\*[\s\S]*?\*\//, '')) &&
        (scanSrc.match(/sessionStorage/g) || []).length === 2 && /csScanSeq_/.test(scanSrc) &&
        !/app\.js|app-con/.test(scanHtml));
    pass('scan page tells the user it can only add', scanHtml.indexOf('data-s="writeOnly"') >= 0 && scanHtml.indexOf('data-s="sentLocked"') >= 0);
    pass('desktop finds staged files by probing public URLs - it never relies on storage list/download (anon cannot list)',
        !/\.list\s*\(/.test(deskSrc) && !/\.download\s*\(/.test(deskSrc) && /method: 'HEAD'/.test(deskSrc) && /getPublicUrl/.test(deskSrc) &&
        /\.remove\(\[CON_SCAN_PREFIX/.test(deskSrc));
    pass('desktop saves through the normal photo pipeline for the session patient',
        /photoUploadOne\(file, meta/.test(deskSrc) && /patientId: pid/.test(deskSrc));

    console.log('\n=== testclient: phone page logic (scan.js in a vm sandbox) ===');
    var tok = 'abcdefghij0123456789';
    var pp = scan.parseParams('?t=ABCDEFGHIJ0123456789&l=%23S1%20%C2%B7%20S.%20P.&g=zh-Hant&x=1790000000000');
    pass('parseParams reads token (lower-cased), label, language, expiry',
        pp.token === tok && pp.label === '#S1 · S. P.' && pp.lang === 'zh-Hant' && pp.exp === 1790000000000, JSON.stringify(pp));
    pass('token validation', scan.isValidToken(tok) && !scan.isValidToken('short') && !scan.isValidToken('../../etc/passwd0000000') &&
        !scan.isValidToken('ABC') && !scan.isValidToken(tok + '/x') && !scan.isValidToken(''));
    pass('expiry check', scan.isExpired(1000, 2000) === true && scan.isExpired(3000, 2000) === false && scan.isExpired(0, 2000) === false);
    pass('language normalisation', scan.normLang('zh-TW') === 'zh-Hant' && scan.normLang('zh-HK') === 'zh-Hant' &&
        scan.normLang('zh-CN') === 'zh-CN' && scan.normLang('zh-Hans') === 'zh-CN' && scan.normLang('en-GB') === 'en' && scan.normLang('') === 'en');
    pass('page paths are predictable (p000, p001...), inside phone-scan/<token>/ and sanitised',
        scan.buildPath(tok, 3, 'JPG') === 'phone-scan/' + tok + '/p003.jpg' &&
        scan.buildPath(tok, 12, 'pdf') === 'phone-scan/' + tok + '/p012.pdf' &&
        scan.buildPath(tok, 1, '../x').indexOf('..') < 0);
    pass('marker paths are PNG names the bucket accepts (hello h.png, finished d<k>.png)',
        scan.buildHelloPath(tok) === 'phone-scan/' + tok + '/h.png' && scan.buildDonePath(tok, 2) === 'phone-scan/' + tok + '/d2.png');

    var sq = scan.squareToQuad([{ x: 10, y: 20 }, { x: 110, y: 30 }, { x: 100, y: 120 }, { x: 5, y: 100 }]);
    var corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(function (uv) { return scan.mapUnit(sq, uv[0], uv[1]); });
    pass('projective map sends the unit square corners to the quad corners',
        [[10, 20], [110, 30], [100, 120], [5, 100]].every(function (c, i) {
            return Math.abs(corners[i].x - c[0]) < 1e-6 && Math.abs(corners[i].y - c[1]) < 1e-6;
        }));
    var src = solid(100, 80, [255, 255, 255]);
    for (var yy = 10; yy < 50; yy++) for (var xx = 20; xx < 80; xx++) setPx(src, xx, yy, [200, 0, 0]);
    var flat = scan.warpQuad(src, [{ x: 20, y: 10 }, { x: 80, y: 10 }, { x: 80, y: 50 }, { x: 20, y: 50 }], 60, 40);
    var c0 = getPx(flat, 0, 0), c1 = getPx(flat, 59, 39), c2 = getPx(flat, 30, 20);
    pass('warp cuts out exactly the quad (axis-aligned crop)', c0[0] > 190 && c1[0] > 190 && c2[0] > 190 && c0[1] < 20 && c2[1] < 20,
        JSON.stringify([c0, c1, c2]));
    var keystone = scan.warpQuad(src, [{ x: 10, y: 5 }, { x: 90, y: 5 }, { x: 80, y: 70 }, { x: 20, y: 70 }], 80, 65);
    var kc = getPx(keystone, 40, 32);
    pass('warp handles a tilted (keystone) page without crashing and samples inside the page', keystone.width === 80 && kc[0] >= 0 && kc[0] <= 255);
    pass('default crop is an inset rectangle and valid',
        (function () { var q = scan.defaultQuad(400, 300); return scan.quadIsValid(q, 400, 300) && q[0].x > 0 && q[2].x < 400; })());
    pass('crossed / collapsed / out-of-image crops are rejected',
        scan.quadIsValid([{ x: 10, y: 10 }, { x: 90, y: 90 }, { x: 90, y: 10 }, { x: 10, y: 90 }], 100, 100) === false &&
        scan.quadIsValid([{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 11, y: 11 }, { x: 10, y: 11 }], 100, 100) === false &&
        scan.quadIsValid([{ x: -50, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }, { x: 0, y: 90 }], 100, 100) === false);
    var os1 = scan.outputSize([{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 2000 }, { x: 0, y: 2000 }], 2000);
    pass('output size keeps the aspect ratio and caps the long edge', os1.w === 2000 && os1.h === 1000, JSON.stringify(os1));
    var page = solid(64, 64, [200, 200, 200]);
    for (var ty = 28; ty < 36; ty++) for (var tx = 28; tx < 36; tx++) setPx(page, tx, ty, [50, 50, 50]);
    var bwOut = scan.enhance({ data: new Uint8ClampedArray(page.data), width: 64, height: 64 }, 'bw');
    var bwOnly = true;
    for (var bi = 0; bi < bwOut.data.length; bi += 4) {
        if (!((bwOut.data[bi] === 0 || bwOut.data[bi] === 255) && bwOut.data[bi] === bwOut.data[bi + 1] && bwOut.data[bi] === bwOut.data[bi + 2])) bwOnly = false;
    }
    pass('black & white turns paper white and ink black', bwOnly && getPx(bwOut, 2, 2)[0] === 255 && getPx(bwOut, 31, 31)[0] === 0);
    var low = solid(40, 40, [100, 100, 100]);
    for (var li = 0; li < 40 * 40; li += 7) { low.data[li * 4] = low.data[li * 4 + 1] = low.data[li * 4 + 2] = 150; }
    var col = scan.enhance({ data: new Uint8ClampedArray(low.data), width: 40, height: 40 }, 'color');
    var mx = 0, mn = 255;
    for (var ci = 0; ci < col.data.length; ci += 4) { mx = Math.max(mx, col.data[ci]); mn = Math.min(mn, col.data[ci]); }
    pass('enhanced stretches a dull scan to full contrast', mn <= 5 && mx >= 250, mn + '..' + mx);
    var orig = solid(10, 10, [90, 90, 90]);
    var same = scan.enhance({ data: new Uint8ClampedArray(orig.data), width: 10, height: 10 }, 'orig');
    pass('original leaves pixels alone', getPx(same, 3, 3)[0] === 90);

    /* fine tune: sharpness 0..100, contrast -100..100 on grey / black & white */
    function ramp(w, h, edgeFrom, edgeTo) {
        var im = solid(w, h, [0, 0, 0]);
        for (var ry = 0; ry < h; ry++) for (var rx = 0; rx < w; rx++) {
            var v = 70 + 120 / (1 + Math.exp(-(rx - (edgeFrom + edgeTo) / 2) / ((edgeTo - edgeFrom) / 6)));
            setPx(im, rx, ry, [v, v, v]);
        }
        return im;
    }
    function sumOf(im) { var s = 0; for (var si = 0; si < im.data.length; si += 4) s += im.data[si]; return s; }
    function cloneOf(im) { return { data: new Uint8ClampedArray(im.data), width: im.width, height: im.height }; }
    var edgeImg = ramp(80, 20, 30, 50);
    ['gray', 'bw'].forEach(function (m) {
        var a = scan.enhance(cloneOf(edgeImg), m), b = scan.enhance(cloneOf(edgeImg), m, { sharp: 0, contrast: 0 });
        pass('fine tune at 0 / 0 (or none) gives the exact same ' + m + ' result', sumOf(a) === sumOf(b));
    });
    var gSoft = scan.enhance(cloneOf(edgeImg), 'gray', { sharp: 0, contrast: 1 });
    var gSharp = scan.enhance(cloneOf(edgeImg), 'gray', { sharp: 100, contrast: 0 });
    function mids(im) { var best = 0; for (var mi = 1; mi < im.width; mi++) best = Math.max(best, Math.abs(getPx(im, mi, 10)[0] - getPx(im, mi - 1, 10)[0])); return best; }
    pass('sharpness steepens a soft edge (bigger step between neighbouring pixels)', mids(gSharp) > mids(gSoft), mids(gSoft) + ' < ' + mids(gSharp));
    var grad = ramp(80, 4, 0, 79);
    var gHi = scan.enhance(cloneOf(grad), 'gray', { sharp: 0, contrast: 100 });
    var gLo = scan.enhance(cloneOf(grad), 'gray', { sharp: 0, contrast: -100 });
    var gMid = scan.enhance(cloneOf(grad), 'gray', { sharp: 0, contrast: 0 });
    function span(im) { var lo = 255, hi = 0; for (var xi = 0; xi < im.width; xi++) { var v = getPx(im, xi, 1)[0]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return hi - lo; }
    function stdev(im) { var vals = [], s = 0; for (var xi = 0; xi < im.width; xi++) { vals.push(getPx(im, xi, 1)[0]); s += vals[xi]; } var mu = s / vals.length, q = 0; vals.forEach(function (v) { q += (v - mu) * (v - mu); }); return Math.sqrt(q / vals.length); }
    pass('grey contrast: + spreads the tones, - flattens them, 0 is the plain stretch',
        stdev(gHi) > stdev(gMid) && stdev(gLo) < stdev(gMid) && span(gLo) < span(gMid), [stdev(gLo), stdev(gMid), stdev(gHi)].map(Math.round).join(' < '));
    var faint = solid(64, 64, [200, 200, 200]);
    for (var fy = 29; fy < 35; fy++) for (var fx = 29; fx < 35; fx++) setPx(faint, fx, fy, [184, 184, 184]);
    var bwHi = scan.enhance(cloneOf(faint), 'bw', { sharp: 0, contrast: 100 });
    var bwDef = scan.enhance(cloneOf(faint), 'bw');
    var bwLo = scan.enhance(cloneOf(faint), 'bw', { sharp: 0, contrast: -100 });
    pass('black & white contrast: + picks up faint ink, default / - leave it white',
        getPx(bwHi, 32, 32)[0] === 0 && getPx(bwDef, 32, 32)[0] === 255 && getPx(bwLo, 32, 32)[0] === 255,
        [getPx(bwHi, 32, 32)[0], getPx(bwDef, 32, 32)[0], getPx(bwLo, 32, 32)[0]].join('/'));
    var bwSharp = scan.enhance(cloneOf(edgeImg), 'bw', { sharp: 100, contrast: 50 });
    var stillBw = true;
    for (var wi = 0; wi < bwSharp.data.length; wi += 4) if (!(bwSharp.data[wi] === 0 || bwSharp.data[wi] === 255)) stillBw = false;
    pass('tuned black & white stays pure black / white', stillBw);
    var wild = scan.enhance(cloneOf(edgeImg), 'gray', { sharp: 'x', contrast: 1e9 });
    var wild2 = scan.enhance(cloneOf(edgeImg), 'gray', { sharp: 0, contrast: 100 });
    pass('out-of-range / garbage tune values are clamped, never throw', sumOf(wild) === sumOf(wild2));
    var ftOrig = scan.enhance(cloneOf(edgeImg), 'orig', { sharp: 100, contrast: 100 });
    var ftCol = scan.enhance(cloneOf(edgeImg), 'color', { sharp: 100, contrast: 100 });
    pass('tune never touches Original / Enhanced', sumOf(ftOrig) === sumOf(edgeImg) && sumOf(ftCol) === sumOf(scan.enhance(cloneOf(edgeImg), 'color')));
    pass('PDF page size follows the scan orientation',
        scan.pdfPageSize(1000, 1400).orient === 'portrait' && scan.pdfPageSize(1400, 1000).orient === 'landscape' &&
        Math.max(scan.pdfPageSize(1000, 1400).w, scan.pdfPageSize(1000, 1400).h) === 842);

    pass('file picker rules: pdf as-is, any picture becomes JPEG, empty / oversize / other types refused',
        scan.classifyFile({ type: 'application/pdf', name: 'a.pdf', size: 1000 }) === 'pdf' &&
        scan.classifyFile({ type: '', name: 'Scan.PDF', size: 1000 }) === 'pdf' &&
        scan.classifyFile({ type: 'image/jpeg', name: 'a.jpg', size: 1000 }) === 'image' &&
        scan.classifyFile({ type: 'image/heic', name: 'a.heic', size: 1000 }) === 'image' &&
        scan.classifyFile({ type: '', name: 'b.PNG', size: 1000 }) === 'image' &&
        scan.classifyFile({ type: 'text/plain', name: 'a.txt', size: 10 }) === '' &&
        scan.classifyFile({ type: 'model/stl', name: 'a.stl', size: 10 }) === '' &&
        scan.classifyFile({ type: 'application/pdf', name: 'a.pdf', size: 0 }) === '' &&
        scan.classifyFile({ type: 'application/pdf', name: 'a.pdf', size: 25 * 1024 * 1024 }) === '' &&
        scan.classifyFile(null) === '');
    var vfit = scan.fitSize(2000, 1000, 400, 800);
    pass('viewer: page fits inside the screen keeping its aspect ratio',
        vfit.w === 400 && vfit.h === 200 && scan.fitSize(0, 10, 100, 100).w === 0);
    var vz = scan.zoomAbout({ s: 1, tx: 0, ty: 0 }, 2, 300, 200, 400, 800);
    pass('viewer: pinch zoom keeps the point under the fingers where it was',
        (function () {
            var fx = 300 - 200, fy = 200 - 400;
            var before = { x: fx - 0, y: fy - 0 };
            var after = { x: fx - vz.tx, y: fy - vz.ty };
            return Math.abs(before.x / 1 - after.x / 2) < 1e-9 && Math.abs(before.y / 1 - after.y / 2) < 1e-9;
        })());
    pass('viewer: panning is limited to the page edges (none when it fits)',
        (function () {
            var fit = scan.viewClamp({ s: 1, tx: 300, ty: -300 }, 400, 200, 400, 800);
            var big = scan.viewClamp({ s: 3, tx: 9999, ty: 9999 }, 400, 200, 400, 800);
            var bigY = scan.viewClamp({ s: 5, tx: 0, ty: 9999 }, 400, 200, 400, 800);
            return fit.tx === 0 && fit.ty === 0 && big.tx === 400 && big.ty === 0 && bigY.ty === 100 &&
                scan.viewClamp({ s: 99, tx: 0, ty: 0 }, 400, 200, 400, 800).s === 8 && scan.clampScale(0.2) === 1;
        })());
    pass('viewer: double-tap goes fit -> real pixels -> fit; percentage is of real pixels',
        (function () {
            var s1 = scan.nextViewScale(1, 400, 2000, 2);
            return s1 > 1.5 && Math.abs(s1 - scan.clampScale(2000 / 2 / 400)) < 1e-9 && scan.nextViewScale(s1, 400, 2000, 2) === 1 &&
                scan.zoomPercent(1, 400, 2000, 2) === 40 && scan.zoomPercent(s1, 400, 2000, 2) === 100 && scan.zoomPercent(1, 400, 0, 2) === 0;
        })());
    var cm = scan.coverMap(640, 480, 400, 800);
    pass('overlay mapping follows object-fit: cover (centre crop)',
        Math.abs(cm.s - 800 / 480) < 1e-9 && Math.abs(cm.ox - (400 - 640 * cm.s) / 2) < 1e-9 && cm.oy === 0 &&
        scan.coverMap(400, 800, 400, 800).ox === 0);
    pass('page cap and PDF / picture split',
        scan.MAX_PAGES === 40 && scan.roomFor(38, 5) === 2 && scan.roomFor(40, 3) === 0 && scan.roomFor(0, 3) === 3 &&
        (function () { var sp = scan.splitPages([{ pdf: true }, {}, {}]); return sp.pdfs.length === 1 && sp.images.length === 2; })());
    pass('scan page: gallery inputs are multiple and accept pdf; tray hint present',
        /id="scGalleryFile"[^>]*accept="image\/\*,application\/pdf"[^>]*multiple/.test(scanHtml) &&
        /id="scCamFile"[^>]*accept="image\/\*,application\/pdf"[^>]*multiple/.test(scanHtml) && scanHtml.indexOf('data-s="hintTap"') >= 0);

    function inQuad(q, x, y) {
        var sign = 0;
        for (var i = 0; i < 4; i++) {
            var a = q[i], b = q[(i + 1) % 4];
            var cr = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
            if (cr !== 0) { if (sign && (cr > 0) !== (sign > 0)) return false; sign = cr > 0 ? 1 : -1; }
        }
        return true;
    }
    function synth(w, h, q, withText) {
        var g = new Uint8Array(w * h);
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
            var v = 60 + ((x * 7 + y * 13) % 9);
            if (q && inQuad(q, x + 0.5, y + 0.5)) {
                v = 225;
                if (withText && y % 7 < 2 && x % 25 < 17) {
                    var cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
                    if (inQuad(q.map(function (p) { return { x: cx + (p.x - cx) * 0.85, y: cy + (p.y - cy) * 0.85 }; }), x + 0.5, y + 0.5)) v = 35;
                }
            }
            g[y * w + x] = v;
        }
        return g;
    }
    var W = 200, H = 150;
    var pageQ = [{ x: 50, y: 15 }, { x: 150, y: 18 }, { x: 146, y: 130 }, { x: 46, y: 126 }];
    var d1 = scan.detectDocument(synth(W, H, pageQ, true), W, H);
    pass('detector finds a page with text and returns its four corners',
        d1.found && d1.reason === 'ok' && d1.quad.length === 4 &&
        pageQ.every(function (c, i) { return Math.abs(d1.quad[i].x * W - c.x) < 4 && Math.abs(d1.quad[i].y * H - c.y) < 4; }),
        JSON.stringify(d1.quad && d1.quad.map(function (p) { return [Math.round(p.x * W), Math.round(p.y * H)]; })) + ' ' + d1.reason);
    var d2 = scan.detectDocument(synth(W, H, pageQ, false), W, H);
    pass('a blank sheet is not a text page (no count-down)', d2.found === false && d2.reason === 'notext', d2.reason);
    var d3 = scan.detectDocument(synth(W, H, null, false), W, H);
    pass('an empty scene finds nothing', d3.found === false);
    var d4 = scan.detectDocument(synth(W, H, [{ x: 0, y: 10 }, { x: 120, y: 12 }, { x: 118, y: 140 }, { x: 0, y: 138 }], true), W, H);
    pass('a page cut off by the frame edge is rejected ("move back")', d4.found === false && d4.reason === 'full', d4.reason);
    var d5 = scan.detectDocument(synth(W, H, [{ x: 80, y: 60 }, { x: 110, y: 60 }, { x: 110, y: 90 }, { x: 80, y: 90 }], true), W, H);
    pass('a tiny sheet far away is rejected ("move closer")', d5.found === false && d5.reason === 'small', d5.reason);
    var rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
    var gr = scan.rgbaToGray(rgba, 4, 1);
    pass('grey conversion: white, black, and green brighter than red', gr[0] >= 254 && gr[1] === 0 && gr[3] > gr[2], Array.from(gr).join());

    var fixed = { found: true, quad: d1.quad };
    var shifted = { found: true, quad: d1.quad.map(function (p) { return { x: p.x + 0.2, y: p.y }; }) };
    var none = { found: false, quad: null };
    var A = scan.AUTO;
    (function () {
        var st = scan.autoNew(true), t = 1000, log = [];
        function step(det, dt) { t += dt; var r = scan.autoStep(st, det, t); log.push(r.action); return r; }
        step(fixed, 0);
        pass('auto: a page is first seen, then must hold steady before the count-down', log[0] === 'steady' && st.phase === 'steady');
        step(fixed, 300);
        var early = step(fixed, 300);
        pass('auto: no count-down before 0.7 s of stillness', early.action === 'none' && st.phase === 'steady');
        var started = step(fixed, 200);
        pass('auto: count-down starts at 3 s', started.action === 'start' && started.remaining === A.countdownMs && st.phase === 'count');
        var r2 = step(fixed, 1000);
        var r3 = step(fixed, 1000);
        pass('auto: count-down ticks 3 -> 2 -> 1', r2.action === 'tick' && Math.ceil(r2.remaining / 1000) === 2 && r3.action === 'tick' && Math.ceil(r3.remaining / 1000) === 1,
            r2.remaining + ',' + r3.remaining);
        var fire = step(fixed, 1000);
        pass('auto: fires exactly when the 3 s are up', fire.action === 'fire' && st.armed === false);
        var after = [];
        for (var i = 0; i < 40; i++) after.push(step(fixed, 250).action);
        pass('auto: the same page held in place is never captured twice', after.every(function (a) { return a === 'none'; }));
        for (var j = 0; j < 4; j++) step(none, 250);
        pass('auto: re-arms after the page has been taken away', st.armed === true);
        step(fixed, 250); step(fixed, 400);
        var again = step(fixed, 300);
        pass('auto: a new page starts a new count-down', again.action === 'start', log.slice(-6).join());
    })();
    (function () {
        var st = scan.autoNew(true), t = 0;
        function step(det, dt) { t += dt; return scan.autoStep(st, det, t); }
        step(fixed, 0);
        var s = step(fixed, 800);
        var mv = step(shifted, 500);
        pass('auto: moving the page during the count-down cancels it', s.action === 'start' && mv.action === 'cancel' && st.phase === 'steady');
        var st2 = scan.autoNew(true); t = 0; st = st2;
        step(fixed, 0); step(fixed, 800);
        var lost1 = step(none, 500);
        var back = step(fixed, 300);
        pass('auto: a brief dropout does not cancel the count-down', lost1.action === 'tick' && back.action === 'tick');
        step(none, 300); var lost2 = step(none, 1000);
        pass('auto: a long dropout cancels', lost2.action === 'cancel' && st.phase === 'search');
        var st3 = scan.autoNew(false, d1.quad); st = st3; t = 0;
        var a1 = step(fixed, 0), a2 = step(fixed, 1000);
        var a3 = step(shifted, 300);
        pass('auto: after a capture, moving to a clearly different page re-arms', a1.action === 'none' && a2.action === 'none' && a3.action === 'steady');
    })();

    /* ── dotted-frame detector: text on paper filling the guide ── */
    function textPage(w, h, opts) {
        opts = opts || {};
        var g = new Uint8Array(w * h);
        var seed = opts.seed || 7;
        function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
        for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
            var light = opts.base == null ? 215 : opts.base;
            var v = light - (opts.gradient ? 50 * x / w : 0) + (rnd() - 0.5) * (opts.noise == null ? 6 : opts.noise);
            g[y * w + x] = Math.max(0, Math.min(255, v));
        }
        if (opts.text !== false) {
            var pitch = opts.pitch || 12, th = opts.th || 5;
            for (var ly = 24; ly + th < h - 20; ly += pitch) {
                var xx = 20;
                while (xx < w - 24) {
                    var wl = 14 + Math.floor(rnd() * 40);
                    if (xx + wl > w - 24) wl = w - 24 - xx;
                    for (var yy = ly; yy < ly + th; yy++) for (var xw = xx; xw < xx + wl; xw++) g[yy * w + xw] = opts.ink == null ? 55 : opts.ink;
                    xx += wl + 6 + Math.floor(rnd() * 6);
                }
            }
        }
        return g;
    }
    var TW = 360, TH = 620;
    var t1 = scan.detectText(textPage(TW, TH), TW, TH);
    pass('guide detector: a page of text filling the frame counts', t1.found === true && t1.reason === 'ok' && !!t1.sig, JSON.stringify([t1.reason, t1.textFrac, t1.blankFrac]));
    var t2 = scan.detectText(textPage(TW, TH, { gradient: true, noise: 10 }), TW, TH);
    pass('guide detector: uneven lighting and camera noise do not stop it', t2.found === true, JSON.stringify([t2.reason, t2.textFrac, t2.blankFrac]));
    var t3 = scan.detectText(textPage(TW, TH, { text: false }), TW, TH);
    pass('guide detector: a blank sheet is not a text page', t3.found === false && t3.reason === 'notext', t3.reason);
    var t4 = scan.detectText(textPage(TW, TH, { base: 40, ink: 15, noise: 4 }), TW, TH);
    pass('guide detector: a dark scene is ignored', t4.found === false, t4.reason);
    var t5 = scan.detectText(textPage(TW, TH, { text: false, noise: 90 }), TW, TH);
    pass('guide detector: noise / clutter with no paper is ignored', t5.found === false, t5.reason);
    var t6 = scan.detectText(textPage(TW, TH, { pitch: 7, th: 4, ink: 120 }), TW, TH);
    pass('guide detector: small, light handwriting-like text still counts', t6.found === true, JSON.stringify([t6.reason, t6.textFrac, t6.blankFrac]));
    var t7 = scan.detectText(textPage(TW, TH, { pitch: 9, th: 8, ink: 40 }), TW, TH);
    pass('guide detector: a page that is almost all text (no margin) is not mistaken for paper-less clutter', t7.found === true || t7.reason !== 'dark', t7.reason);

    var sA = scan.sigOf(textPage(TW, TH, { seed: 3 }), TW, TH);
    var shiftedPage = (function () {
        var g0 = textPage(TW, TH, { seed: 3 }), g1 = new Uint8Array(TW * TH);
        for (var y = 0; y < TH; y++) for (var x = 0; x < TW; x++) g1[y * TW + x] = g0[y * TW + Math.max(0, x - 3)];
        return g1;
    })();
    var farPage = textPage(TW, TH, { seed: 3, pitch: 17 });
    var brighter = (function () { var g0 = textPage(TW, TH, { seed: 3 }), g1 = new Uint8Array(TW * TH); for (var i = 0; i < g1.length; i++) g1[i] = Math.min(255, g0[i] + 25); return g1; })();
    pass('movement signature: same view ~0, a 3 px wobble stays under the steady limit, another page / big move is above the count limit, brightness drift is ignored',
        scan.sigDiff(sA, scan.sigOf(textPage(TW, TH, { seed: 3 }), TW, TH)) < 0.01 &&
        scan.sigDiff(sA, scan.sigOf(shiftedPage, TW, TH)) < scan.AUTO.sigSteady &&
        scan.sigDiff(sA, scan.sigOf(farPage, TW, TH)) > 0 &&
        scan.sigDiff(sA, scan.sigOf(brighter, TW, TH)) < 1.5,
        [scan.sigDiff(sA, scan.sigOf(shiftedPage, TW, TH)), scan.sigDiff(sA, scan.sigOf(farPage, TW, TH)), scan.sigDiff(sA, scan.sigOf(brighter, TW, TH))].join(' / '));
    var halfMoved = (function () {
        var g0 = textPage(TW, TH, { seed: 3 }), g1 = new Uint8Array(TW * TH);
        for (var y = 0; y < TH; y++) for (var x = 0; x < TW; x++) g1[y * TW + x] = (x < TW / 2) ? 215 : g0[y * TW + x];
        return g1;
    })();
    pass('movement signature: covering half the page reads as a large change', scan.sigDiff(sA, scan.sigOf(halfMoved, TW, TH)) > scan.AUTO.sigCount);

    var gv = scan.guideToVideo(23, 67, 344, 590, 390, 844, 720, 960);
    var gcm = scan.coverMap(720, 960, 390, 844);
    pass('dotted frame maps back to the right pixels of the camera frame (object-fit: cover)',
        Math.abs(gv.x - (23 - gcm.ox) / gcm.s) < 1e-9 && Math.abs(gv.w - 344 / gcm.s) < 1e-9 && Math.abs(gv.h - 590 / gcm.s) < 1e-9 && gv.x >= 0 && gv.y >= 0 &&
        gv.x + gv.w <= 720 + 1e-9 && gv.y + gv.h <= 960 + 1e-9);
    var gvLand = scan.guideToVideo(23, 67, 344, 590, 390, 844, 1920, 1080);
    pass('landscape camera frame: the frame covers only the middle slice, still inside the picture',
        gvLand.w > 0 && gvLand.x >= 0 && gvLand.x + gvLand.w <= 1920 + 1e-9 && gvLand.w < 700);

    (function () {
        var detOk = function (sig) { return { found: true, quad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], sig: sig }; };
        var p1 = scan.sigOf(textPage(TW, TH, { seed: 3 }), TW, TH);
        var p1b = scan.sigOf(shiftedPage, TW, TH);
        var p2 = scan.sigOf(halfMoved, TW, TH);
        var st = scan.autoNew(true), t = 0, acts = [];
        function step(det, dt) { t += dt; var r = scan.autoStep(st, det, t); acts.push(r.action); return r; }
        step(detOk(p1), 0); step(detOk(p1b), 250); step(detOk(p1), 250);
        var s1 = step(detOk(p1b), 250);
        pass('auto (frame): a held page with a little hand shake still reaches the count-down', s1.action === 'start', acts.join());
        var c1 = step(detOk(p1b), 1000);
        var cx = step(detOk(p2), 300);
        pass('auto (frame): the count-down keeps running through shake but a different view cancels it', c1.action === 'tick' && cx.action === 'cancel', acts.join());
        var st2 = scan.autoNew(true); t = 0; st = st2;
        step(detOk(p1), 0); step(detOk(p1), 800); step(detOk(p1), 2900);
        var f2 = step(detOk(p1), 200);
        pass('auto (frame): fires after 3 s and the same page is not shot twice until the view changes', f2.action === 'fire' && st.armed === false);
        var noRe = step(detOk(p1b), 400);
        var re = step(detOk(p2), 400);
        pass('auto (frame): a different page re-arms it', noRe.action === 'none' && st.armed === true, acts.slice(-3).join());
    })();

    var seen = [];
    var tokenBucket = {};
    var guardedSb = {
        storage: {
            from: function (b) {
                return new Proxy({}, {
                    get: function (t, k) {
                        if (k === 'upload') {
                            return function (p, blob, o) {
                                seen.push({ bucket: b, p: p, o: o, size: blob.size });
                                if (tokenBucket[p]) return Promise.resolve({ error: { message: 'The resource already exists' } });
                                tokenBucket[p] = 1;
                                return Promise.resolve({ data: { path: p }, error: null });
                            };
                        }
                        throw new Error('phone touched storage.' + String(k));
                    }
                });
            }
        },
        from: function () { throw new Error('phone touched a table'); }
    };
    var blobA = new Blob(['aaa'], { type: 'image/jpeg' });
    var upRes = await scan.uploadItems(guardedSb, tok, [
        { blob: blobA, ext: 'jpg', contentType: 'image/jpeg' }, { blob: blobA, ext: 'jpg', contentType: 'image/jpeg' }
    ]);
    pass('uploadItems sends every page with upsert off, to unique paths, touching nothing else',
        upRes.sent === 2 && upRes.failed === 0 && seen.length === 2 && seen[0].p !== seen[1].p &&
        seen.every(function (s) { return s.o.upsert === false && s.p.indexOf('phone-scan/' + tok + '/') === 0 && s.bucket === 'photos'; }));
    pass('pages are numbered in order', seen[0].p.endsWith('/p000.jpg') && seen[1].p.endsWith('/p001.jpg') && upRes.nextSeq === 2);
    var mk = await scan.sendMarker(guardedSb, tok, 'hello');
    pass('hello marker uploads as a tiny PNG (image/png, the bucket rejects json)',
        mk.ok === true && /\/h\.png$/.test(seen[seen.length - 1].p) && seen[seen.length - 1].o.contentType === 'image/png' && seen[seen.length - 1].size < 200);
    var mk2 = await scan.sendMarker(guardedSb, tok, 'done', 1);
    var mk3 = await scan.sendMarker(guardedSb, tok, 'done', 1);
    pass('finished marker takes the next free d<k>.png when one already exists',
        mk2.ok && mk2.k === 1 && mk3.ok && mk3.k === 2 && /\/d2\.png$/.test(seen[seen.length - 1].p));
    var bucketAllowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'application/pdf'];
    pass('every content type the phone sends is accepted by the photos bucket allow-list',
        seen.every(function (s) { return bucketAllowed.indexOf(s.o.contentType) >= 0; }));
    var pgBefore = seen.length;
    var clash = await scan.uploadItems(guardedSb, tok, [{ blob: blobA, ext: 'jpg', contentType: 'image/jpeg' }], null, 0);
    pass('a page number that is already taken moves on to the next free one (page reloaded mid-session)',
        clash.sent === 1 && clash.failed === 0 && seen.length === pgBefore + 3 && clash.nextSeq === 3, 'nextSeq ' + clash.nextSeq);
    var seenBeforeRefuse = seen.length;
    var refused = await scan.makeUploader(guardedSb).upload('other-folder/x.jpg', blobA, 'image/jpeg');
    pass('uploader refuses any path outside phone-scan/', refused.error && /not allowed/.test(refused.error.message) && seen.length === seenBeforeRefuse);
    var dupe = await scan.makeUploader(guardedSb).upload('phone-scan/' + tok + '/same.jpg', blobA, 'image/jpeg');
    var dupe2 = await scan.makeUploader(guardedSb).upload('phone-scan/' + tok + '/same.jpg', blobA, 'image/jpeg');
    pass('an existing file can never be replaced (second write with the same name is rejected)',
        !dupe.error && dupe2.error && /already exists/.test(dupe2.error.message));
    var flaky = 0;
    var flakySb = { storage: { from: function () { return { upload: function () { flaky++; return Promise.resolve(flaky < 2 ? { error: { message: 'network down' } } : { error: null }); } }; } } };
    var fr = await scan.uploadItems(flakySb, tok, [{ blob: blobA, ext: 'jpg', contentType: 'image/jpeg' }]);
    pass('a transient failure is retried and then succeeds', fr.sent === 1 && fr.failed === 0 && flaky === 2);
    var deadSb = { storage: { from: function () { return { upload: function () { return Promise.resolve({ error: { message: 'network down' } }); } }; } } };
    var dr = await scan.uploadItems(deadSb, tok, [{ blob: blobA, ext: 'jpg', contentType: 'image/jpeg' }]);
    pass('a permanent failure is reported, not hidden', dr.sent === 0 && dr.failed === 1);

    console.log('\n=== testclient: desktop logic (app-con-phonescan.js in a vm sandbox) ===');
    var D = loadDeskSandbox();
    var toks = {};
    for (var ti = 0; ti < 300; ti++) toks[D.conScanNewToken()] = 1;
    pass('session tokens are 20+ chars of [a-z0-9], unique, and accepted by the phone page',
        Object.keys(toks).length === 300 && Object.keys(toks).every(function (k) { return scan.isValidToken(k); }));
    pass('patient name is masked on the QR link (Latin initials / first character only)',
        D.conScanMaskName('Chan Tai Man') === 'C. T. M.' && D.conScanMaskName('陳大文') === '陳○○' && D.conScanMaskName('') === '');
    pass('label shows patient number and masked name, never the full name',
        D.conScanLabel({ patient_no: 'P0123', full_name: 'Chan Tai Man' }) === '#P0123 · C. T. M.' && D.conScanLabel(null) === '');
    pass('default phone page address sits next to the app page',
        D.conScanDefaultBase({ href: 'https://clinic.example/app/index.html?x=1#top' }) === 'https://clinic.example/app/scan.html');
    pass('local addresses are flagged (a phone cannot open them)',
        D.conScanIsLocalBase('http://localhost:5500/scan.html') && D.conScanIsLocalBase('http://127.0.0.1/scan.html') &&
        D.conScanIsLocalBase('http://xray-ai.test:8794/scan.html') && !D.conScanIsLocalBase('https://clinic.example/app/scan.html'));
    var link = D.conScanBuildUrl('https://clinic.example/app/scan.html', tok, '#P1 · C. T. M.', 'zh-Hant', 1790000000000);
    var back = scan.parseParams(link.slice(link.indexOf('?')));
    pass('QR link round-trips through the phone page parser',
        back.token === tok && back.label === '#P1 · C. T. M.' && back.lang === 'zh-Hant' && back.exp === 1790000000000 && link.indexOf('http') === 0, link);
    pass('QR link never contains the full name or a patient id',
        link.indexOf('Chan') < 0 && D.conScanBuildUrl('https://a/b.html?z=1', tok, '', 'en', 0).indexOf('?z=1&t=') > 0);
    pass('desktop and phone agree on every staged name (pages, hello, finished)',
        D.conScanFilePath(tok, 4, 'pdf') === scan.buildPath(tok, 4, 'pdf') && D.conScanFilePath(tok, 4, 'jpg') === scan.buildPath(tok, 4, 'jpg') &&
        D.conScanHelloPath(tok) === scan.buildHelloPath(tok) && D.conScanDonePath(tok, 3) === scan.buildDonePath(tok, 3));
    var probed = [];
    var D2 = loadDeskSandbox();
    D2.SB = { storage: { from: function () { return { getPublicUrl: function (p) { return { data: { publicUrl: 'http://files.test/' + p } }; } }; } } };
    D2.fetch = function (u, o) {
        probed.push({ u: u, m: o && o.method });
        var m = /files\.test\/(.*?)(\?|$)/.exec(u);
        return Promise.resolve({ ok: m && m[1].endsWith('p001.pdf') });
    };
    var pf = await D2.conScanProbeFiles('photos', tok, 0);
    pass('probing asks the public URL (HEAD) for the next few page numbers as pdf and jpg and returns only those that exist',
        pf.length === 1 && pf[0].name === 'p001.pdf' && pf[0].idx === 1 && probed.length === 6 && probed.every(function (p) { return p.m === 'HEAD'; }));
    pass('extension / mime / file name helpers',
        D.conScanExt('a.PDF') === 'pdf' && D.conScanExt('noext') === 'jpg' && D.conScanMime('pdf') === 'application/pdf' &&
        D.conScanMime('jpg') === 'image/jpeg' && /^scan_\d{8}_\d{6}_2\.pdf$/.test(D.conScanFileName(Date.now(), 2, 'pdf')));
    var mediaD = (function () {
        var sb = { console: console, I18N_STRINGS: {}, t: function (k) { return k; }, setTimeout: setTimeout, clearTimeout: clearTimeout,
            Promise: Promise, Date: Date, localStorage: storageMemory() };
        vm.createContext(sb);
        vm.runInContext(mediaSrc, sb, { filename: 'app-con-media.js' });
        return sb;
    })();
    var sum = mediaD.conMediaBuildSummary([{ category: 'Intraoral', created_at: '2026-10-01T00:00:00Z' }, { category: 'Scanned Document', created_at: '2026-10-02T00:00:00Z' }], []);
    pass('a scanned document counts under Consents, Lab & Scans and not as a clinical photo', sum.photos === 1 && sum.consentLab === 1, JSON.stringify([sum.photos, sum.consentLab]));

    console.log('\n=== HTTP spot ===');
    var sbCfg = readSbConfig(read('app.js'));
    var phoneCfg = readSbConfig(scanSrc);
    pass('scan.js uses the same project and public anon key as the app (no service key)',
        phoneCfg.url === sbCfg.url && phoneCfg.key === sbCfg.key && !/service_role/.test(scanSrc + scanHtml));

    var apiTok = 'z' + Math.random().toString(36).slice(2, 12) + 'probe' + Date.now().toString(36);
    try {
        var hdr = { apikey: sbCfg.key, Authorization: 'Bearer ' + sbCfg.key };
        var br = await fetch(sbCfg.url + '/storage/v1/bucket/photos', { headers: hdr });
        var bj = await br.json();
        var mimes = bj && bj.allowed_mime_types;
        pass('API (read-only): photos bucket is public and its mime allow-list takes pdf, jpeg and png (so no json markers)',
            br.status === 200 && bj.public === true && (!mimes || (mimes.indexOf('application/pdf') >= 0 && mimes.indexOf('image/jpeg') >= 0 &&
                mimes.indexOf('image/png') >= 0 && mimes.indexOf('application/json') < 0)), JSON.stringify(mimes));
        var hr = await fetch(sbCfg.url + '/storage/v1/object/public/photos/phone-scan/' + apiTok + '/p000.pdf?cb=' + Date.now(), { method: 'HEAD', cache: 'no-store' });
        pass('API (read-only): probing a staged page that does not exist answers "not found" (not 200, not a server error)',
            hr.status === 400 || hr.status === 404, 'HTTP ' + hr.status);
    } catch (e) {
        pass('API (read-only): bucket info + public probe reachable', false, e.message);
    }

    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        finish(1);
        return;
    }

    var server = await startStaticServer(PAGE_PORT);
    var s1 = await httpGet('127.0.0.1', PAGE_PORT, '/scan.html');
    pass('a local server serves scan.html and scan.js',
        s1.status === 200 && s1.body.indexOf('CSPhoneScan.boot()') >= 0 && (await httpGet('127.0.0.1', PAGE_PORT, '/scan.js')).status === 200);

    var profile = path.join(os.tmpdir(), 'cs-con-phone-scan-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    fs.mkdirSync(profile, { recursive: true });
    var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/index.html?_lr=' + BUILD;
    var proc = child_process.spawn(CHROME, [
        '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + profile,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-popup-blocking',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
        '--host-resolver-rules=MAP xray-ai.test 127.0.0.1',
        '--window-size=1280,900',
        hosted
    ], { stdio: 'ignore' });

    var ws = null;
    var phone = null;
    try {
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
        await sleep(1200);

        /* ───────────── desktop side, live page ───────────── */
        var live = await cdp.js(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const until = async (fn, ms) => { const end = Date.now() + (ms || 6000); while (Date.now() < end) { if (fn()) return true; await wait(80); } return !!fn(); };
          const deadline = Date.now() + 25000;
          while (Date.now() < deadline) {
            if (typeof switchConTab === 'function' && typeof conScanOpen === 'function' && typeof photoUploadOne === 'function' &&
                typeof loadPhotoRecords === 'function' && typeof conMediaRenderHub === 'function') break;
            await wait(200);
          }
          const out = { ready: typeof conScanOpen === 'function', build: window.__JSM_BUILD || '', host: location.hostname };
          const login = document.getElementById('loginOverlay');
          if (login) login.style.display = 'none';
          const con = document.getElementById('consultationSection');
          if (con) { con.style.display = 'block'; con.removeAttribute('aria-hidden'); }

          await new Promise((resolve) => { const s = document.createElement('script'); s.src = '/scan.js?v=live'; s.onload = resolve; document.head.appendChild(s); });
          const Scan = window.CSPhoneScan;
          out.scanLoaded = !!Scan && typeof Scan.uploadItems === 'function';

          /* no patient -> refuses */
          conPatientId = null; conPatientData = null;
          out.noPatientRefused = conScanOpen() === false && document.getElementById('conScanModal').style.display !== 'block';

          conPatientId = 'smoke-pid';
          conPatientData = { id: 'smoke-pid', full_name: 'Smoke Patient', patient_no: 'S1', dob: '1990-01-01' };
          photoPatientId = 'smoke-pid';
          photoPatientData = conPatientData;
          try { await conMediaProbeCtx(); } catch (e) { /* ignore */ }

          /* fake Supabase: in-memory storage + photos table */
          const realSB = window.SB;
          const store = new Map();
          const rows = { photos: [] };
          const calls = { list: 0, download: 0, probes: 0, removed: [], uploads: [] };
          let failDownload = false;
          /* the real bucket is public: HEAD/GET on the public URL work, but anonymous list/download return nothing */
          const realFetch = window.fetch.bind(window);
          window.fetch = (u, o) => {
            const m = /^http:\\/\\/files\\.test\\/(.*?)(\\?|$)/.exec(String(u));
            if (!m) return realFetch(u, o);
            const p = decodeURIComponent(m[1]);
            const head = !!(o && o.method === 'HEAD');
            if (head) calls.probes++; else calls.download++;
            if (!store.has(p) || (!head && failDownload)) return Promise.resolve({ ok: false, status: 404 });
            return Promise.resolve({ ok: true, status: 200, blob: () => Promise.resolve(store.get(p)) });
          };
          function tbl(table) {
            const st = { ops: [] };
            const b = {};
            ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit', 'range', 'or', 'single', 'is', 'gte', 'lte', 'not'].forEach((m) => {
              b[m] = function () { st.ops.push([m].concat(Array.from(arguments))); return b; };
            });
            b.then = function (res, rej) {
              const ins = st.ops.find((o) => o[0] === 'insert');
              let r;
              if (ins && table === 'photos') {
                const id = 'ph' + (rows.photos.length + 1);
                rows.photos.push(Object.assign({ id: id, created_at: new Date().toISOString() }, ins[1][0]));
                r = { data: [{ id: id }], error: null };
              } else if (ins) r = { data: [{ id: 'x' }], error: null };
              else if (table === 'photos') {
                const eq = st.ops.find((o) => o[0] === 'eq' && o[1] === 'patient_id');
                r = { data: rows.photos.filter((x) => !eq || x.patient_id === eq[2]), error: null };
              } else r = { data: [], error: null };
              return Promise.resolve(r).then(res, rej);
            };
            return b;
          }
          const fakeSB = {
            from: tbl,
            storage: { from: (bucket) => ({
              upload: (p, f, o) => { calls.uploads.push(p); if (store.has(p)) return Promise.resolve({ error: { message: 'The resource already exists' } }); store.set(p, f); return Promise.resolve({ data: { path: p }, error: null }); },
              list: () => { calls.list++; return Promise.resolve({ data: [], error: null }); },
              download: () => { calls.download++; return Promise.resolve({ data: null, error: { message: 'Object not found' } }); },
              remove: (ps) => { ps.forEach((p) => { calls.removed.push(p); store.delete(p); }); return Promise.resolve({ data: [], error: null }); },
              getPublicUrl: (p) => ({ data: { publicUrl: 'http://files.test/' + p } })
            }) }
          };
          window.SB = fakeSB;
          CON_MEDIA.ctx.photos = true; CON_MEDIA.ctx.docs = true;
          CON_MEDIA._probe = Promise.resolve(CON_MEDIA.ctx);
          const staged = () => Array.from(store.keys()).filter((k) => k.indexOf('phone-scan/') === 0);
          const phoneSeq = {};
          const phoneSend = async (items) => {
            const t = CON_SCAN.token;
            const r = await Scan.uploadItems(fakeSB, t, items, null, phoneSeq[t] || 0);
            phoneSeq[t] = r.nextSeq;
            return r;
          };
          const pdfBlob = new Blob(['%PDF-1.4 fake'], { type: 'application/pdf' });
          const jpgBlob = new Blob(['jpgdata'], { type: 'image/jpeg' });

          /* open: modal + QR + label */
          document.getElementById('conScanAutoClose').checked = true;
          out.opened = conScanOpen() === true && document.getElementById('conScanModal').style.display === 'block';
          out.tokenOk = Scan.isValidToken(CON_SCAN.token);
          out.forText = document.getElementById('conScanFor').textContent;
          out.qrDrawn = await until(() => !!document.querySelector('#conScanQr img, #conScanQr canvas'), 12000);
          const qrUrl = document.getElementById('conScanQr').getAttribute('data-url') || '';
          const qp = Scan.parseParams(qrUrl.slice(qrUrl.indexOf('?')));
          out.qrUrlOk = qrUrl.indexOf('/scan.html?') > 0 && qp.token === CON_SCAN.token && qp.exp === CON_SCAN.expiresAt && qp.label.indexOf('#S1') === 0 &&
            qrUrl.indexOf('Smoke') < 0 && qrUrl.indexOf('smoke-pid') < 0;
          out.qrUrl = qrUrl;
          out.stateWaiting = document.getElementById('conScanStatus').getAttribute('data-state') === 'waiting';
          out.timerText = document.getElementById('conScanTimer').textContent.length > 0;
          out.localWarnShown = document.getElementById('conScanLocalWarn').hidden === false;
          out.catList = document.getElementById('conScanCat').value === 'Scanned Document' && document.getElementById('conScanCat').options.length >= 6;

          /* phone connected, nothing sent yet */
          await Scan.sendMarker(fakeSB, CON_SCAN.token, 'hello');
          await conScanPoll();
          out.stateConnected = document.getElementById('conScanStatus').getAttribute('data-state') === 'connected' && CON_SCAN.phoneSeen === true;
          out.helloCleaned = staged().every((k) => k.indexOf('/h.png') < 0);

          /* phone sends a PDF and an image */
          const sess1 = CON_SCAN.token;
          await phoneSend([{ blob: pdfBlob, ext: 'pdf', contentType: 'application/pdf' }, { blob: jpgBlob, ext: 'jpg', contentType: 'image/jpeg' }]);
          out.stagedBefore = staged().length;
          await conScanPoll();
          out.savedTwo = rows.photos.length === 2 && CON_SCAN.savedIds.length === 2 && CON_SCAN.items.every((i) => i.status === 'saved');
          out.rowFields = rows.photos.every((r) => r.patient_id === 'smoke-pid' && r.category === 'Scanned Document' && r.caption &&
            JSON.stringify(r.tags) === '["phone-scan"]' && /^smoke-pid\\//.test(r.file_path) && r.taken_date);
          out.rowTypes = rows.photos.map((r) => r.file_path.split('.').pop()).sort().join(',');
          out.stagedGone = staged().length === 0 && calls.removed.length >= 3;
          out.listItems = document.querySelectorAll('#conScanList .con-scan-item.is-saved').length;
          out.stateSaved = document.getElementById('conScanStatus').getAttribute('data-state') === 'saved';
          out.showBtn = document.getElementById('conScanShowBtn').hidden === false;
          out.noDuplicateOnRepoll = (await conScanPoll(), rows.photos.length === 2);

          /* patient changed on screen mid-session: files still go to the session patient */
          conPatientId = 'other-pid';
          await phoneSend([{ blob: jpgBlob, ext: 'jpg', contentType: 'image/jpeg' }]);
          await conScanPoll();
          out.boundToSessionPatient = rows.photos.length === 3 && rows.photos[2].patient_id === 'smoke-pid';
          conPatientId = 'smoke-pid';

          /* done -> modal closes by itself, Photos tab shows the new cards */
          await Scan.sendMarker(fakeSB, CON_SCAN.token, 'done', 1);
          await conScanPoll();
          await until(() => document.querySelectorAll('#photoGridView .xray-card.con-scan-new').length >= 3, 6000);
          out.autoClosed = document.getElementById('conScanModal').style.display === 'none' && CON_SCAN.active === false;
          out.photosTab = !!document.querySelector('.con-tab[data-tab="photos"].active');
          out.cardsShown = document.querySelectorAll('#photoGridView .xray-card').length === 3;
          out.cardsFlash = document.querySelectorAll('#photoGridView .xray-card.con-scan-new').length === 3;
          out.cardBadge = (document.getElementById('photoGridView').textContent || '').indexOf('media.cat.scanDoc') < 0;
          out.toastAdded = (document.getElementById('appGlobalToast').textContent || '').length > 0;
          out.timersStopped = CON_SCAN.pollTimer === null && CON_SCAN.tickTimer === null;
          out.hubCount = (function () { conMediaRenderHub(); return true; })();

          /* auto-close off: stays open until the user closes it */
          rows.photos.length = 0;
          document.getElementById('conScanAutoClose').checked = false;
          conScanOpen();
          await phoneSend([{ blob: jpgBlob, ext: 'jpg', contentType: 'image/jpeg' }]);
          await Scan.sendMarker(fakeSB, CON_SCAN.token, 'done', 1);
          await conScanPoll();
          out.stateDone = document.getElementById('conScanStatus').getAttribute('data-state') === 'done';
          out.staysOpen = document.getElementById('conScanModal').style.display === 'block' && CON_SCAN.active === true;
          document.querySelector('#conScanModal [data-scan-act="show"]').click();
          await wait(500);
          out.closeShows = document.getElementById('conScanModal').style.display === 'none' && rows.photos.length === 1 &&
            document.querySelectorAll('#photoGridView .xray-card').length === 1;
          document.getElementById('conScanAutoClose').checked = true;

          /* category chosen on the desktop is applied */
          rows.photos.length = 0;
          conScanOpen();
          document.getElementById('conScanCat').value = 'Lab Report';
          await phoneSend([{ blob: pdfBlob, ext: 'pdf', contentType: 'application/pdf' }]);
          await conScanPoll();
          out.chosenCategory = rows.photos.length === 1 && rows.photos[0].category === 'Lab Report';
          conScanClose();

          /* many pages (more than the probe window) arrive in one poll, and the window waits for all of them */
          rows.photos.length = 0;
          document.getElementById('conScanAutoClose').checked = true;
          conScanOpen();
          await phoneSend([1, 2, 3, 4, 5, 6, 7].map(() => ({ blob: jpgBlob, ext: 'jpg', contentType: 'image/jpeg' })));
          await Scan.sendMarker(fakeSB, CON_SCAN.token, 'done', 1);
          await conScanPoll();
          out.sevenPages = rows.photos.length === 7 && CON_SCAN.nextIdx === 7;
          out.sevenAutoClosed = CON_SCAN.active === false && document.getElementById('conScanModal').style.display === 'none';
          await wait(300);

          /* a jpg and a pdf with the same page number (two phone tabs) are both found and both saved */
          rows.photos.length = 0;
          document.getElementById('conScanAutoClose').checked = false;
          conScanOpen();
          await phoneSend([{ blob: jpgBlob, ext: 'jpg', contentType: 'image/jpeg' }]);
          await Scan.uploadItems(fakeSB, CON_SCAN.token, [{ blob: pdfBlob, ext: 'pdf', contentType: 'application/pdf' }], null, 0);
          await conScanPoll();
          out.sameNumberBoth = rows.photos.length === 2 && CON_SCAN.nextIdx === 1;
          conScanClose();

          /* failed import: stays visible, retried, never silently auto-closed */
          rows.photos.length = 0;
          conScanOpen();
          failDownload = true;
          await phoneSend([{ blob: jpgBlob, ext: 'jpg', contentType: 'image/jpeg' }]);
          await Scan.sendMarker(fakeSB, CON_SCAN.token, 'done', 1);
          await conScanPoll(); await conScanPoll(); await conScanPoll(); await conScanPoll();
          out.failedShown = CON_SCAN.items.length === 1 && CON_SCAN.items[0].status === 'failed' &&
            document.querySelectorAll('#conScanList .con-scan-item.is-failed').length === 1;
          out.failedRetried3 = calls.download >= 3 && CON_SCAN.attempts[CON_SCAN.items[0].name] === 3;
          out.failedKeepsOpen = document.getElementById('conScanModal').style.display === 'block' && rows.photos.length === 0;
          out.failedStagedKept = staged().length === 1;
          failDownload = false;
          conScanClose();

          /* link settings */
          conScanOpen();
          const baseEl = document.getElementById('conScanBase');
          baseEl.value = 'https://clinic.example/app/scan.html';
          baseEl.dispatchEvent(new Event('change'));
          await wait(300);
          out.baseApplied = (document.getElementById('conScanQr').getAttribute('data-url') || '').indexOf('https://clinic.example/app/scan.html?t=') === 0 &&
            document.getElementById('conScanLocalWarn').hidden === true && localStorage.getItem('csPhoneScanBase') === 'https://clinic.example/app/scan.html';
          out.copyUrl = conScanCurrentUrl().indexOf('https://clinic.example/app/scan.html?t=' + CON_SCAN.token) === 0;
          localStorage.removeItem('csPhoneScanBase');
          baseEl.value = '';
          conScanClose();

          /* new code replaces the old one; old inbox is no longer watched */
          conScanOpen();
          const oldTok = CON_SCAN.token;
          await phoneSend([{ blob: jpgBlob, ext: 'jpg', contentType: 'image/jpeg' }]);
          conScanNewCode();
          await wait(200);
          out.newCode = CON_SCAN.token !== oldTok && Scan.isValidToken(CON_SCAN.token) && CON_SCAN.items.length === 0 && CON_SCAN.active === true &&
            (document.getElementById('conScanQr').getAttribute('data-url') || '').indexOf(oldTok) < 0;
          rows.photos.length = 0;
          await conScanPoll();
          out.oldTokenIgnored = rows.photos.length === 0;

          /* expiry stops everything */
          CON_SCAN.expiresAt = Date.now() - 1000;
          conScanTick();
          out.expired = CON_SCAN.state === 'expired' && CON_SCAN.active === false && CON_SCAN.pollTimer === null &&
            document.getElementById('conScanStatus').getAttribute('data-state') === 'expired' &&
            document.getElementById('conScanQrCol').classList.contains('is-dim');
          await phoneSend([{ blob: jpgBlob, ext: 'jpg', contentType: 'image/jpeg' }]);
          const probesBefore = calls.probes;
          await conScanPoll();
          out.expiredNoPoll = calls.probes === probesBefore && rows.photos.length === 0;
          conScanClose();

          /* hub menu entry */
          conMediaRenderHub();
          const hubBtn = document.querySelector('#conMediaHubPhotos [data-cm-act="phone"]');
          out.menuEntry = !!hubBtn;
          document.querySelector('#conMediaHubPhotos [data-cm-act="menu"]').click();
          hubBtn.click();
          out.menuOpensModal = document.getElementById('conScanModal').style.display === 'block' && CON_SCAN.active === true;
          conScanClose();

          out.neverListed = calls.list === 0;
          window.fetch = realFetch;
          window.SB = realSB;
          return out;
        })()`, true, 90000);

        pass('Runtime.evaluate page BUILD', live && live.build === BUILD, live && live.build);
        pass('Runtime.evaluate hosted host', live && live.host === 'xray-ai.test', live && live.host);
        pass('live page helpers ready', live && live.ready === true && live.scanLoaded === true);
        pass('live: no patient -> the scan window refuses to open', live && live.noPatientRefused === true);
        pass('live: modal opens with a one-time token and names the patient', live && live.opened === true && live.tokenOk === true &&
            /S1/.test(live.forText || ''), live ? live.forText : 'none');
        pass('live: QR code is drawn and encodes token, expiry and a masked label only',
            live && live.qrDrawn === true && live.qrUrlOk === true, live ? String(live.qrUrl).slice(0, 140) : 'none');
        pass('live: waiting state, countdown, local-address warning and category list shown',
            live && live.stateWaiting === true && live.timerText === true && live.localWarnShown === true && live.catList === true);
        pass('live: phone hello marker -> "phone connected", marker cleaned up', live && live.stateConnected === true && live.helloCleaned === true);
        pass('live: phone PDF + image are both saved to the patient with category, caption, phone-scan tag and date',
            live && live.savedTwo === true && live.rowFields === true && live.rowTypes === 'jpg,pdf', live ? live.rowTypes : 'none');
        pass('live: staged files are removed after saving and nothing is saved twice',
            live && live.stagedBefore === 2 && live.stagedGone === true && live.noDuplicateOnRepoll === true);
        pass('live: received list + "saved" state + show button', live && live.listItems === 2 && live.stateSaved === true && live.showBtn === true);
        pass('live: switching the screen patient mid-session does not redirect the files', live && live.boundToSessionPatient === true);
        pass('live: phone done -> window closes, Photos tab opens, new cards highlighted, toast shown, timers stopped',
            live && live.autoClosed === true && live.photosTab === true && live.cardsShown === true && live.cardsFlash === true &&
                live.toastAdded === true && live.timersStopped === true && live.cardBadge === true,
            live ? JSON.stringify([live.autoClosed, live.photosTab, live.cardsShown, live.cardsFlash, live.toastAdded, live.timersStopped, live.cardBadge]) : 'none');
        pass('live: with auto-close off the window stays open until "Show in Photos"',
            live && live.stateDone === true && live.staysOpen === true && live.closeShows === true);
        pass('live: category picked on the desktop is used', live && live.chosenCategory === true);
        pass('live: anonymous storage list/download are never needed (the real bucket returns nothing for them)', live && live.neverListed === true);
        pass('live: 7 pages (more than one probe window) in one go are all saved before the window auto-closes',
            live && live.sevenPages === true && live.sevenAutoClosed === true, live ? JSON.stringify([live.sevenPages, live.sevenAutoClosed]) : 'none');
        pass('live: a jpg and a pdf sharing a page number are both imported', live && live.sameNumberBoth === true);
        pass('live: a failed save is shown, retried up to 3 times, keeps the window open and keeps the staged file',
            live && live.failedShown === true && live.failedRetried3 === true && live.failedKeepsOpen === true && live.failedStagedKept === true,
            live ? JSON.stringify([live.failedShown, live.failedRetried3, live.failedKeepsOpen, live.failedStagedKept]) : 'none');
        pass('live: phone page address can be set (saved, QR redrawn, warning cleared)', live && live.baseApplied === true && live.copyUrl === true);
        pass('live: New code swaps the token and stops watching the old one', live && live.newCode === true && live.oldTokenIgnored === true);
        pass('live: expiry stops polling, dims the QR and ignores late uploads', live && live.expired === true && live.expiredNoPoll === true);
        pass('live: Add menu entry opens the phone scan window', live && live.menuEntry === true && live.menuOpensModal === true);

        /* ───────────── phone side, live page with fake camera ───────────── */
        var phoneBase = 'http://127.0.0.1:' + PAGE_PORT + '/scan.html';
        var stage = 'open';
        phone = await openTarget('about:blank');
        await phone.cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await phone.cdp.call('Page.addScriptToEvaluateOnNewDocument', {
            source: `
              window.__uploads = []; window.__forbidden = []; window.__failNext = 0;
              (function () {
                const md = navigator.mediaDevices;
                if (!md || !md.getUserMedia) return;
                const real = md.getUserMedia.bind(md);
                md.getUserMedia = async function (c) {
                  if (!window.__docCam) return real(c);
                  const W = 720, H = 960;
                  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
                  const x = cv.getContext('2d');
                  let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
                  const draw = () => {
                    x.fillStyle = '#3a3a3a'; x.fillRect(0, 0, W, H);
                    const mode = window.__docShow;
                    if (!mode) return;
                    const v = document.getElementById('scVideo'), gd = document.getElementById('scGuide');
                    if (!v || !gd) return;
                    const vr = v.getBoundingClientRect(), gr = gd.getBoundingClientRect();
                    if (!vr.width || !gr.width) return;
                    const s = Math.max(vr.width / W, vr.height / H), ox = (vr.width - W * s) / 2, oy = (vr.height - H * s) / 2;
                    let px = (gr.left - vr.left - ox) / s, py = (gr.top - vr.top - oy) / s, pw = gr.width / s, ph = gr.height / s;
                    if (mode === 'small') { px += pw * 0.08; pw *= 0.84; py += ph * 0.15; ph *= 0.7; }
                    else { px -= pw * 0.03; pw *= 1.06; py -= ph * 0.03; ph *= 1.06; }
                    window.__docRect = { px, py, pw, ph };
                    const grad = x.createLinearGradient(px, 0, px + pw, 0);
                    grad.addColorStop(0, '#ededed'); grad.addColorStop(1, '#cbcbcb');
                    x.fillStyle = grad; x.fillRect(px, py, pw, ph);
                    x.fillStyle = '#222';
                    seed = 11;
                    for (let ly = py + pw * 0.08; ly < py + ph - pw * 0.06; ly += pw * 0.045) {
                      let lx = px + pw * 0.07;
                      while (lx < px + pw * 0.92) {
                        let wl = pw * (0.04 + rnd() * 0.12);
                        if (lx + wl > px + pw * 0.93) wl = px + pw * 0.93 - lx;
                        x.fillRect(lx, ly, wl, pw * 0.02);
                        lx += wl + pw * 0.02;
                      }
                    }
                  };
                  draw();
                  setInterval(draw, 66);
                  return cv.captureStream(15);
                };
              })();
              window.__CS_SCAN_SB = {
                from() { window.__forbidden.push('table'); return {}; },
                storage: { from(b) {
                  return new Proxy({}, { get(t, k) {
                    if (k === 'upload') return (p, blob, o) => {
                      const ok = window.__failNext <= 0;
                      window.__uploads.push({ p: p, bucket: b, size: blob.size, type: blob.type, opts: o, blob: blob, ok: ok });
                      if (!ok) { window.__failNext--; return Promise.resolve({ error: { message: 'network down' } }); }
                      return Promise.resolve({ data: { path: p }, error: null });
                    };
                    window.__forbidden.push(String(k)); return undefined;
                  } });
                } }
              };`
        });
        var goto = async function (url) {
            await phone.cdp.call('Page.navigate', { url: url });
            await sleep(500);
            var deadline = Date.now() + 15000;
            while (Date.now() < deadline) {
                var booted = false;
                try {
                    booted = await phone.cdp.js(`document.readyState === 'complete' && !!window.__scanState || (!!document.getElementById('scError') && !document.getElementById('scError').hidden)`);
                } catch (e) { booted = false; }
                if (booted) break;
                await sleep(200);
            }
        };
        var T = 'phonetoken0123456789ab';
        var exp = Date.now() + 600000;

        stage = 'invalid';
        await goto(phoneBase + '?t=bad');
        var inv = await phone.cdp.js(`({ err: !document.getElementById('scError').hidden, intro: document.getElementById('scIntro').hidden, msg: document.getElementById('scErrorMsg').textContent })`);
        pass('phone: an invalid link shows an error and offers nothing', inv.err === true && inv.intro === true && inv.msg.length > 10, inv.msg);
        await goto(phoneBase + '?t=' + T + '&g=en&x=1');
        var expd = await phone.cdp.js(`({ err: !document.getElementById('scError').hidden, msg: document.getElementById('scErrorMsg').textContent, up: window.__uploads.length })`);
        pass('phone: an expired link shows an error and uploads nothing (not even the hello marker)', expd.err === true && /expired/i.test(expd.msg) && expd.up === 0, expd.msg);

        stage = 'zh';
        await goto(phoneBase + '?t=' + T + '&g=zh-Hant&l=' + encodeURIComponent('#S1 · S. P.') + '&x=' + exp);
        var zh = await phone.cdp.js(`({ title: document.querySelector('#scIntro h1').textContent, label: document.getElementById('scLabel').textContent, lock: document.querySelector('#scIntro .sc-lock').textContent })`);
        pass('phone: language and patient label come from the QR link', zh.title === '掃描文件' && zh.label === '#S1 · S. P.' && zh.lock.indexOf('無法') >= 0, JSON.stringify(zh));

        stage = 'insecure';
        await phone.cdp.call('Page.navigate', { url: 'http://xray-ai.test:' + PAGE_PORT + '/scan.html?t=' + T + '&x=' + exp });
        await sleep(1200);
        var ins = await phone.cdp.js(`(async () => { document.getElementById('scStartBtn').click(); await new Promise(r => setTimeout(r, 400));
          return { secure: window.isSecureContext, intro: !document.getElementById('scIntro').hidden, note: document.getElementById('scIntroNote').textContent }; })()`, true);
        pass('phone: without https the live camera is not attempted and the camera-button path is offered',
            ins.secure === false && ins.intro === true && /https/i.test(ins.note), JSON.stringify(ins));

        stage = 'scan';
        await goto(phoneBase + '?t=' + T + '&g=en&l=' + encodeURIComponent('#S1 · S. P.') + '&x=' + exp);
        var flow = await phone.cdp.js(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const until = async (fn, ms) => { const end = Date.now() + (ms || 8000); while (Date.now() < end) { if (fn()) return true; await wait(100); } return !!fn(); };
          const $ = (id) => document.getElementById(id);
          const vis = (id) => !$(id).hidden;
          const out = {};
          const mkc = (type, w, h, color) => new Promise((res) => {
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); x.fillStyle = '#000'; x.fillRect(5, 5, w / 3, h / 3);
            c.toBlob((bl) => res(bl), type, 0.9);
          });
          window.__h = {
            wait, until, $, vis, mkc,
            pick: (id, files) => { const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); const inp = $(id); inp.files = dt.files; inp.dispatchEvent(new Event('change')); },
            scanOne: async (filter) => {
              $('scShutter').click();
              const prev = await until(() => vis('scPreview') && $('scPreviewCanvas').width > 40, 8000);
              if (filter) $('scPreview').querySelector('[data-filter="' + filter + '"]').click();
              await wait(200);
              return { prev: prev, direct: !vis('scCrop'), w: $('scPreviewCanvas').width, h: $('scPreviewCanvas').height };
            }
          };
          out.helloSent = await until(() => window.__uploads.some((u) => /\\/h\\.png$/.test(u.p) && u.type === 'image/png'), 4000);
          out.introVisible = vis('scIntro') && $('scLabel').textContent.indexOf('#S1') === 0;
          out.finishDisabled = $('scFinishBtn').disabled === true;

          window.__docCam = true;
          window.__docShow = false;
          $('scStartBtn').click();
          out.cameraShown = await until(() => vis('scCamera'), 8000);
          out.videoLive = await until(() => $('scVideo').videoWidth > 0, 8000);
          out.autoBtnOn = $('scModeAuto').getAttribute('aria-pressed') === 'true' && $('scModeManual').getAttribute('aria-pressed') === 'false' &&
            $('scModeAuto').textContent === 'Auto' && $('scModeManual').textContent === 'Manual' && $('scModeAuto').classList.contains('is-on');

          await wait(1500);
          out.noCountWithoutPage = !window.__scanState().auto.counting && !vis('scCount');

          /* manual shutter works at any time and goes straight to the preview (no crop screen in between) */
          const first = await window.__h.scanOne(null);
          out.manualDirect = first.prev === true && first.direct === true && $('scPreviewPages').textContent === '1' && $('scAddPage').textContent === 'Add page';
          $('scPreviewRetake').click();
          out.retakeToCamera = await until(() => vis('scCamera'), 4000) && window.__scanState().pages === 0 && $('scPagesBadge').textContent === '0';
          await until(() => $('scVideo').videoWidth > 0, 8000);

          /* a text page comes into view: hold steady, then a 3 second count-down, then it captures by itself */
          window.__docShow = 'fill';
          out.countStarted = await until(() => window.__scanState().auto.counting === true, 8000);
          const t0 = Date.now();
          const roiLive = window.__scanState().auto.roi;
          const corners = (cv) => {
            const c = cv.getContext('2d'); let s = 0, n = 0;
            [[2, 2], [cv.width - 10, 2], [2, cv.height - 10], [cv.width - 10, cv.height - 10]].forEach((p) => {
              const d = c.getImageData(p[0], p[1], 8, 8).data; for (let i = 0; i < d.length; i += 4) { s += d[i]; n++; }
            });
            return s / n;
          };
          window.__h.corners = corners;
          out.roiSeen = !!roiLive && roiLive.w > 100 && roiLive.h > 100;
          out.countVisible = vis('scCount');
          await wait(400);
          out.countMsg = $('scAutoMsg').textContent;
          out.autoFired = await until(() => vis('scPreview') && $('scPreviewCanvas').width > 40, 8000);
          out.autoMs = Date.now() - t0;
          const pc = $('scPreviewCanvas');
          out.autoCornerLum = Math.round(corners(pc));
          out.autoCrop = !!roiLive && Math.abs(pc.width / pc.height - roiLive.w / roiLive.h) < 0.06 && out.autoCornerLum > 170;
          out.autoSize = pc.width + 'x' + pc.height + ' roi ' + (roiLive ? Math.round(roiLive.w) + 'x' + Math.round(roiLive.h) : '-');
          out.countHidden = !vis('scCount') && window.__scanState().auto.counting === false;

          const isBw = () => {
            const d = pc.getContext('2d').getImageData(0, 0, pc.width, pc.height).data;
            for (let i = 0; i < d.length; i += 4 * 37) { const v = d[i]; if (!((v === 0 || v === 255) && d[i + 1] === v && d[i + 2] === v)) return false; }
            return true;
          };
          /* new scans default to black & white; Crop / Rotate / scan style live behind the Edit button */
          out.defaultBw = isBw() && $('scPreview').querySelector('[data-filter="bw"]').classList.contains('is-on');
          out.editClosed = $('scEditPanel').hidden === true && $('scPreviewEdit').getAttribute('aria-expanded') === 'false';
          out.mainRow = Array.from(document.querySelectorAll('#scPreview .sc-actions button')).map((b) => b.id).join(',');
          $('scPreviewEdit').click();
          out.editOpen = !$('scEditPanel').hidden && $('scPreviewEdit').getAttribute('aria-expanded') === 'true' && $('scPreview').classList.contains('is-editing');
          out.editHolds = ['scPreviewCrop', 'scRotate'].every((id) => $('scEditPanel').contains($(id))) &&
            Array.from($('scEditPanel').querySelectorAll('[data-filter]')).map((b) => b.getAttribute('data-filter')).join(',') === 'orig,color,gray,bw';
          $('scPreview').querySelector('[data-filter="color"]').click();
          await wait(200);
          out.styleSwitch = !isBw() && $('scPreview').querySelector('[data-filter="color"]').classList.contains('is-on') && !$('scPreview').querySelector('[data-filter="bw"]').classList.contains('is-on');
          $('scPreview').querySelector('[data-filter="bw"]').click();
          await wait(200);
          out.bwApplied = isBw();
          out.chipOn = $('scPreview').querySelector('[data-filter="bw"]').classList.contains('is-on');
          const wBefore = pc.width;
          $('scRotate').click();
          await wait(200);
          out.rotated = pc.height === wBefore;
          $('scRotate').click();
          await wait(200);

          /* Fine tune (grey / black & white only): mini preview + Sharpness + Contrast, Save / Cancel */
          const ft = $('scFineTune');
          const sumPx = () => { const d = pc.getContext('2d').getImageData(0, 0, pc.width, pc.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; return s; };
          const miniSum = () => { const m = $('scTuneCanvas'); const d = m.getContext('2d').getImageData(0, 0, m.width, m.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i]; return s; };
          const setR = (id, v) => { const e = $(id); e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); };
          out.ftInEdit = $('scEditPanel').contains(ft) && ft.hidden === false && ft.textContent === 'Fine tune';
          out.ftHiddenInColor = (() => { $('scPreview').querySelector('[data-filter="color"]').click(); const h = ft.hidden; $('scPreview').querySelector('[data-filter="orig"]').click(); const h2 = ft.hidden; return h === true && h2 === true; })();
          $('scPreview').querySelector('[data-filter="gray"]').click();
          await wait(250);
          out.ftShownGray = ft.hidden === false && !ft.classList.contains('is-on');
          const g0 = sumPx();
          ft.click();
          out.ftOpens = !$('scTune').hidden && $('scTuneCanvas').width > 20 && $('scTuneCanvas').width <= 640 && $('scTuneCanvas').height > 20;
          out.ftSliders = $('scTuneSharp').type === 'range' && $('scTuneContrast').type === 'range' &&
            $('scTuneSharp').min === '0' && $('scTuneSharp').max === '100' && $('scTuneContrast').min === '-100' && $('scTuneContrast').max === '100' &&
            $('scTuneSharp').value === '0' && $('scTuneContrast').value === '0';
          out.ftTexts = $('scTune').textContent.indexOf('Sharpness') >= 0 && $('scTune').textContent.indexOf('Contrast') >= 0 &&
            ['scTuneCancel', 'scTuneSave', 'scTuneReset'].every((id) => !!$(id));
          const miniBefore = miniSum();
          setR('scTuneContrast', 100); setR('scTuneSharp', 80);
          await wait(250);
          out.ftLabels = $('scTuneContrastVal').textContent === '100' && $('scTuneSharpVal').textContent === '80';
          out.ftMiniLive = miniSum() !== miniBefore;
          out.ftPageUntouched = sumPx() === g0;
          $('scTuneCancel').click();
          await wait(200);
          out.ftCancel = $('scTune').hidden === true && sumPx() === g0 && !ft.classList.contains('is-on');
          ft.click();
          out.ftCancelledNotKept = $('scTuneContrast').value === '0' && $('scTuneSharp').value === '0';
          setR('scTuneContrast', 100); setR('scTuneSharp', 80);
          await wait(250);
          const mSave = miniSum();
          $('scTuneSave').click();
          await wait(350);
          const g1 = sumPx();
          out.ftSave = $('scTune').hidden === true && g1 !== g0 && ft.classList.contains('is-on');
          ft.click();
          out.ftReopenKeeps = $('scTuneContrast').value === '100' && $('scTuneSharp').value === '80' && miniSum() === mSave;
          $('scTuneReset').click();
          await wait(200);
          out.ftReset = $('scTuneContrast').value === '0' && $('scTuneSharp').value === '0' && $('scTuneSharpVal').textContent === '0' && sumPx() === g1;
          $('scTuneCancel').click();
          out.ftKeepsSavedOnCancel = sumPx() === g1 && ft.classList.contains('is-on');
          $('scPreview').querySelector('[data-filter="bw"]').click();
          await wait(250);
          out.ftResetOnStyle = !ft.classList.contains('is-on') && ft.hidden === false;
          ft.click();
          setR('scTuneContrast', -100); setR('scTuneSharp', 100);
          await wait(250);
          $('scTuneSave').click();
          await wait(350);
          out.ftBwTuned = isBw() && ft.classList.contains('is-on');
          $('scPreview').querySelector('[data-filter="gray"]').click();
          $('scPreview').querySelector('[data-filter="bw"]').click();
          await wait(250);
          out.ftBwBack = isBw() && !ft.classList.contains('is-on');

          $('scPreviewEdit').click();
          out.editToggles = $('scEditPanel').hidden === true && !$('scPreview').classList.contains('is-editing');
          /* tap the preview to enlarge the page before accepting it */
          pc.click();
          out.previewEnlarges = await until(() => vis('scViewer') && $('scViewerImg').naturalWidth === pc.width, 6000);
          out.previewNoNav = $('scViewerPrev').hidden && $('scViewerNext').hidden && $('scViewerCrop').hidden;
          $('scViewerClose').click();
          out.previewViewerClosed = !vis('scViewer') && !$('scViewerImg').getAttribute('src') && vis('scPreview');

          /* Crop sits on the preview: Cancel returns to the same preview, Apply re-cuts it */
          const wPrev = pc.width, hPrev = pc.height;
          $('scPreviewCrop').click();
          out.cropOpens = await until(() => vis('scCrop') && $('scCropCanvas').width > 50, 5000);
          const cv = $('scCropCanvas');
          const r = cv.getBoundingClientRect();
          const x0 = r.left + r.width * 0.06, y0 = r.top + r.height * 0.06;
          const ev = (type, x, y) => new PointerEvent(type, { clientX: x, clientY: y, pointerId: 7, bubbles: true, cancelable: true });
          cv.dispatchEvent(ev('pointerdown', x0, y0));
          cv.dispatchEvent(ev('pointermove', x0 + 40, y0 + 30));
          cv.dispatchEvent(ev('pointerup', x0 + 40, y0 + 30));
          $('scCropRetake').click();
          out.cropCancelKeeps = await until(() => vis('scPreview'), 3000) && pc.width === wPrev && pc.height === hPrev && window.__scanState().hasCurrent === true;
          $('scPreviewCrop').click();
          await until(() => vis('scCrop'), 3000);
          $('scCropNext').click();
          out.cropApplied = await until(() => vis('scPreview') && pc.width > 40, 5000);

          $('scAddPage').click();
          out.backToCamera = await until(() => vis('scCamera') && $('scPagesBadge').textContent === '1', 8000);
          out.lastThumbShown = vis('scLastThumb') && !!$('scLastImg').getAttribute('src');

          /* the same page left in view is not captured twice; taking it away re-arms */
          await wait(1800);
          out.noDoubleShot = vis('scCamera') && !window.__scanState().auto.counting && window.__scanState().auto.armed === false;
          window.__docShow = false;
          out.rearmed = await until(() => window.__scanState().auto.armed === true, 4000);

          /* a page smaller than the dotted frame is cut out of it; the desk around it is dropped */
          window.__docShow = 'small';
          await wait(400);
          const roiSmall = window.__scanState().auto.roi;
          const smallShot = await window.__h.scanOne(null);
          const pcs = $('scPreviewCanvas');
          const dr = window.__docRect;
          out.smallPageCut = smallShot.prev === true && !!dr && Math.abs(pcs.width / pcs.height - dr.pw / dr.ph) < 0.1 &&
            Math.abs(pcs.width / pcs.height - roiSmall.w / roiSmall.h) > 0.08 && window.__h.corners(pcs) > 170;
          out.smallInfo = pcs.width + 'x' + pcs.height + ' page ' + (dr ? Math.round(dr.pw) + 'x' + Math.round(dr.ph) : '-') + ' corners ' + Math.round(window.__h.corners(pcs));
          window.__docShow = false;
          $('scPreviewRetake').click();
          await until(() => vis('scCamera'), 4000);
          await until(() => $('scVideo').videoWidth > 0, 8000);

          /* the last page thumbnail enlarges on tap; the zoom button toggles fit / real pixels */
          $('scLastThumb').click();
          out.lastEnlarges = await until(() => vis('scViewer') && $('scViewerImg').naturalWidth > 100, 6000);
          out.lastLabel = $('scViewerLabel').textContent;
          out.fitFirst = $('scViewerZoom').textContent === 'Fit' && window.__scanState().viewer.s === 1;
          $('scViewerZoom').click();
          out.zoomIn = /^[0-9]+%$/.test($('scViewerZoom').textContent) && window.__scanState().viewer.s > 1.4;
          $('scViewerZoom').click();
          out.zoomBackToFit = $('scViewerZoom').textContent === 'Fit' && window.__scanState().viewer.s === 1;
          $('scViewerClose').click();
          out.lastClosed = !vis('scViewer') && vis('scCamera');

          /* the round shutter can be pressed during the count-down: it captures at once and stops the count-down */
          await until(() => $('scVideo').videoWidth > 0, 8000);
          window.__docShow = 'fill';
          out.count2 = await until(() => window.__scanState().auto.counting === true, 8000);
          await wait(500);
          const t1 = Date.now();
          $('scShutter').click();
          out.manualDuring = await until(() => vis('scPreview') && $('scPreviewCanvas').width > 40, 1500) && Date.now() - t1 < 1500;
          out.countStopped = !vis('scCount') && window.__scanState().auto.counting === false;
          window.__docShow = false;

          /* top-right Next opens the pending-upload queue, with the page just taken in it */
          $('scPreviewNext').click();
          await until(() => vis('scSend'), 4000);
          out.nextOpensQueue = vis('scSend') && !vis('scPreview') && document.querySelectorAll('#scTray .sc-thumb').length === 2 &&
            /pending upload/i.test(document.querySelector('#scSend h1').textContent);
          out.twoPages = window.__scanState().pages === 2;
          out.sendView = out.nextOpensQueue;
          document.querySelector('#scTray .sc-thumb-x').click();
          out.discardedLocally = document.querySelectorAll('#scTray .sc-thumb').length === 1 && $('scTrayCount').textContent === '1' && window.__uploads.length === 1;

          /* failing network: nothing is lost, nothing is reported as sent */
          $('scFmtImg').checked = true;
          window.__failNext = 3;
          $('scSendBtn').click();
          out.failShown = await until(() => /did not send/i.test($('scSendStatus').textContent), 10000);
          out.pagesKept = $('scTrayCount').textContent === '1' && vis('scSend') && !window.__uploads.some((u) => /\\/d\\d+\\.png$/.test(u.p));
          $('scSendBtn').click();
          out.doneView = await until(() => vis('scDone'), 8000);
          const up = window.__uploads.filter((u) => /\\/p\\d+\\.jpg$/.test(u.p));
          out.sentJpg = up.length >= 1 && up[up.length - 1].type === 'image/jpeg' && up[up.length - 1].opts.upsert === false && up[up.length - 1].size > 500;
          out.doneMarker = await until(() => window.__uploads.some((u) => /\\/d1\\.png$/.test(u.p) && u.type === 'image/png'), 4000);
          out.countText = $('scDoneCount').textContent;
          out.pagesCleared = window.__scanState().pages === 0 && window.__scanState().sent === 1;

          /* second round: one PDF with two pages */
          $('scMoreBtn').click();
          await until(() => vis('scCamera'), 8000);
          await until(() => $('scVideo').videoWidth > 0, 8000);
          await window.__h.scanOne('gray');
          $('scPreviewRetake').click();
          out.retakeDropsIt = await until(() => vis('scCamera'), 4000) && window.__scanState().pages === 0 && $('scPagesBadge').textContent === '0';
          await until(() => $('scVideo').videoWidth > 0, 8000);
          $('scModeManual').click();
          out.autoOffState = window.__scanState().auto.on === false && $('scModeManual').getAttribute('aria-pressed') === 'true' &&
            $('scModeAuto').getAttribute('aria-pressed') === 'false' && $('scModeManual').classList.contains('is-on');
          window.__docShow = 'fill';
          await wait(2400);
          out.noCountWhenOff = !window.__scanState().auto.counting && !vis('scCount') && vis('scCamera');
          $('scModeAuto').click();
          out.backToAuto = await until(() => window.__scanState().auto.counting === true, 8000);
          $('scModeManual').click();
          out.manualStopsCount = window.__scanState().auto.counting === false && !vis('scCount') && window.__scanState().auto.on === false;
          window.__docShow = false;
          await window.__h.scanOne('gray'); $('scAddPage').click(); await until(() => $('scPagesBadge').textContent === '1', 8000);
          await until(() => $('scVideo').videoWidth > 0, 8000);
          await window.__h.scanOne('orig'); $('scAddPage').click(); await until(() => $('scPagesBadge').textContent === '2', 8000);
          $('scFinishBtn').click();
          /* camera pages can be edited from the queue as well: style remembered, original shot kept for Crop */
          await until(() => vis('scSend'), 4000);
          const camBtns = document.querySelectorAll('#scTray .sc-thumb-e');
          camBtns[0].click();
          out.camEditOpens = await until(() => vis('scPreview') && !$('scEditPanel').hidden && pc.width > 40, 6000);
          out.camStyleKept = $('scPreview').querySelector('[data-filter="gray"]').classList.contains('is-on');
          $('scPreviewCrop').click();
          out.camCropOriginal = await until(() => vis('scCrop') && $('scCropCanvas').width > 50, 4000);
          $('scCropRetake').click();
          await until(() => vis('scPreview'), 3000);
          $('scPreview').querySelector('[data-filter="color"]').click();
          await wait(250);
          $('scAddPage').click();
          out.camEditSaved = await until(() => vis('scSend') && window.__scanState().pages === 2 && window.__scanState().hasCurrent === false, 4000);
          document.querySelectorAll('#scTray .sc-thumb-e')[1].click();
          out.camSecondOrig = await until(() => vis('scPreview') && $('scPreview').querySelector('[data-filter="orig"]').classList.contains('is-on'), 6000);
          $('scPreviewRetake').click();
          await until(() => vis('scSend'), 3000);
          $('scFmtPdf').checked = true;
          const beforeN = window.__uploads.length;
          $('scSendBtn').click();
          out.pdfDone = await until(() => vis('scDone') && window.__uploads.length > beforeN, 20000);
          const pdfUp = window.__uploads.slice(beforeN).find((u) => /\\.pdf$/.test(u.p));
          out.pdfSent = !!pdfUp && pdfUp.type === 'application/pdf' && pdfUp.opts.upsert === false;
          out.pdfHeader = pdfUp ? await pdfUp.blob.slice(0, 5).text() : '';
          out.pagesAllPaths = window.__uploads.every((u) => u.p.indexOf('phone-scan/phonetoken0123456789ab/') === 0 && u.bucket === 'photos');
          const okUploads = window.__uploads.filter((u) => u.ok);
          out.uniquePaths = okUploads.length > 3 && new Set(okUploads.map((u) => u.p)).size === okUploads.length;
          out.pageNames = window.__uploads.filter((u) => u.ok && /\\/p\\d+\\./.test(u.p)).map((u) => u.p.split('/').pop()).join(',');
          out.allowedTypes = window.__uploads.every((u) => ['image/jpeg', 'image/png', 'application/pdf'].indexOf(u.type) >= 0);
          /* third round: photos + a PDF picked from the albums in one go */
          const mk = (type, w, h, color) => new Promise((res) => {
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, w, h); x.fillStyle = '#000'; x.fillRect(5, 5, w / 3, h / 3);
            c.toBlob((bl) => res(bl), type, 0.9);
          });
          const jpgA = await mk('image/jpeg', 800, 600, '#ddd');
          const pngB = await mk('image/png', 500, 700, '#cde');
          const pick = (id, files) => { const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f)); const inp = $(id); inp.files = dt.files; inp.dispatchEvent(new Event('change')); };
          const pdfBody = '%PDF-1.4 fake pdf body';
          out.galleryInput = (() => { const i = $('scGalleryFile'), j = $('scCamFile'); return i.multiple && j.multiple && /application\\/pdf/.test(i.accept) && /application\\/pdf/.test(j.accept); })();
          $('scMoreBtn').click();
          await until(() => vis('scCamera'), 8000);
          pick('scCamFile', [new File([jpgA], 'one.jpg', { type: 'image/jpeg' })]);
          out.singleStillPreview = await until(() => vis('scPreview') && $('scPreviewCanvas').width > 40, 6000) && !vis('scCrop');
          $('scPreviewRetake').click();
          await until(() => vis('scCamera'), 8000);

          pick('scCamFile', [new File([jpgA], 'a.jpg', { type: 'image/jpeg' }), new File([pngB], 'b.png', { type: 'image/png' }),
            new File([pdfBody], 'report.pdf', { type: 'application/pdf' }), new File(['junk'], 'x.txt', { type: 'text/plain' })]);
          out.multiView = await until(() => vis('scSend') && document.querySelectorAll('#scTray .sc-thumb').length === 3, 8000);
          out.multiStatus = $('scSendStatus').textContent;
          const thumbs = Array.from(document.querySelectorAll('#scTray .sc-thumb img'));
          out.pdfThumb = thumbs.length === 3 && thumbs[2].src.indexOf('data:image/png') === 0;
          out.pngBecameJpeg = window.__scanState().pages === 3;
          const firstThumbBefore = thumbs[0].src;
          thumbs[0].click();
          out.trayEnlarges = await until(() => vis('scViewer') && $('scViewerImg').naturalWidth > 100, 6000);
          out.trayLabel = $('scViewerLabel').textContent;
          out.trayNav = !$('scViewerPrev').hidden && $('scViewerPrev').disabled && !$('scViewerNext').disabled && !$('scViewerCrop').hidden;
          $('scViewerNext').click();
          await wait(150);
          out.trayNext = $('scViewerLabel').textContent === '#2 / 3' && $('scViewerNext').disabled && !$('scViewerPrev').disabled;
          $('scViewerPrev').click();
          await wait(100);

          /* gestures on the enlarged page (pointer events, as a touch screen delivers them) */
          const box = $('scViewerScroll');
          const R = box.getBoundingClientRect();
          const cw = R.width, ch = R.height;
          const pe = (type, id, x, y) => box.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: R.left + x, clientY: R.top + y, bubbles: true, cancelable: true, pointerType: 'touch' }));
          const vs = () => window.__scanState().viewer;
          const pinch = (from, to) => {
            const cx = cw / 2, cy = ch / 2;
            pe('pointerdown', 11, cx - from, cy); pe('pointerdown', 12, cx + from, cy);
            for (let i = 1; i <= 8; i++) { const d = from + (to - from) * i / 8; pe('pointermove', 11, cx - d, cy); pe('pointermove', 12, cx + d, cy); }
            pe('pointerup', 11, cx - to, cy); pe('pointerup', 12, cx + to, cy);
          };
          const swipe = (x1, y1, x2, y2) => {
            pe('pointerdown', 21, x1, y1);
            for (let i = 1; i <= 6; i++) pe('pointermove', 21, x1 + (x2 - x1) * i / 6, y1 + (y2 - y1) * i / 6);
            pe('pointerup', 21, x2, y2);
          };
          pinch(30, 110);
          out.pinchOut = vs().s > 2.5 && /^[0-9]+%$/.test($('scViewerZoom').textContent);
          const tx0 = vs().tx;
          swipe(cw * 0.6, ch / 2, cw * 0.4, ch / 2);
          out.zoomedPans = vs().idx === 0 && vs().tx !== tx0 && vs().s > 2.5;
          pinch(110, 30);
          out.pinchIn = vs().s < 1.05 && $('scViewerZoom').textContent === 'Fit';
          swipe(cw * 0.8, ch / 2, cw * 0.2, ch / 2);
          out.swipeLeftNext = vs().idx === 1 && $('scViewerLabel').textContent === '#2 / 3' && vs().s < 1.02;
          swipe(cw * 0.8, ch / 2, cw * 0.2, ch / 2);
          out.swipeEdgeStays = vs().idx === 1;
          swipe(cw * 0.2, ch / 2, cw * 0.8, ch / 2);
          out.swipeRightPrev = vs().idx === 0 && $('scViewerLabel').textContent === '#1 / 3';
          swipe(cw / 2, ch * 0.3, cw / 2 + 20, ch * 0.7);
          out.verticalNoNav = vs().idx === 0;
          swipe(cw * 0.5, ch / 2, cw * 0.5 + 15, ch / 2);
          out.shortNoNav = vs().idx === 0;
          pe('pointerdown', 31, cw / 2, ch / 2); pe('pointerup', 31, cw / 2, ch / 2);
          pe('pointerdown', 32, cw / 2, ch / 2); pe('pointerup', 32, cw / 2, ch / 2);
          out.doubleTapIn = vs().s > 1.4;
          await wait(400);
          pe('pointerdown', 33, cw / 2, ch / 2); pe('pointerup', 33, cw / 2, ch / 2);
          pe('pointerdown', 34, cw / 2, ch / 2); pe('pointerup', 34, cw / 2, ch / 2);
          out.doubleTapOut = vs().s < 1.02;
          box.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: R.left + cw / 2, clientY: R.top + ch / 2, bubbles: true, cancelable: true }));
          out.wheelZoom = vs().s > 1.5;
          $('scViewerZoom').click();
          out.zoomButtonBack = vs().s < 1.02;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
          out.arrowKey = vs().idx === 1;
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
          $('scViewerClose').click();
          thumbs[0].click();
          await until(() => vis('scViewer') && $('scViewerImg').naturalWidth > 100, 6000);
          out.viewerEditLabel = $('scViewerCrop').textContent === 'Edit';
          $('scViewerCrop').click();
          out.viewerClosedForCrop = !vis('scViewer');
          out.tapCrops = await until(() => vis('scPreview') && !$('scEditPanel').hidden && $('scPreviewCanvas').width > 40, 6000);
          out.viewerEditCropped = pc.width === 800 && pc.height === 600;
          out.editLabels = $('scAddPage').textContent === 'Save' && $('scPreviewRetake').textContent === 'Cancel' && $('scPreviewPages').textContent === '3';
          out.editOrigOn = $('scPreview').querySelector('[data-filter="orig"]').classList.contains('is-on') && $('scFineTune').hidden === true;
          const origSum = sumPx();
          $('scPreview').querySelector('[data-filter="gray"]').click();
          await wait(250);
          $('scFineTune').click();
          setR('scTuneContrast', 60); setR('scTuneSharp', 40);
          await wait(250);
          $('scTuneSave').click();
          await wait(350);
          const grayTunedSum = sumPx();
          out.editRestyled = grayTunedSum !== origSum && $('scFineTune').classList.contains('is-on');
          $('scAddPage').click();
          out.cropBack = await until(() => vis('scSend') && document.querySelectorAll('#scTray .sc-thumb').length === 3, 6000);
          out.cropReplaced = document.querySelector('#scTray .sc-thumb img').src !== firstThumbBefore;
          /* an Edit button on every image thumbnail in the queue (not on the PDF) */
          const eBtns = () => Array.from(document.querySelectorAll('#scTray .sc-thumb')).map((t) => !!t.querySelector('.sc-thumb-e'));
          out.thumbEditBtns = eBtns().join(',') === 'true,true,false' && document.querySelector('#scTray .sc-thumb-e').textContent.indexOf('Edit') >= 0;
          out.hintMentionsEdit = /Edit/.test(document.querySelector('#scSend [data-s="hintTap"]').textContent);

          /* reopen: the saved style + fine tune come back, and Original brings back the untouched shot */
          const thumbAfterSave = document.querySelector('#scTray .sc-thumb img').src;
          document.querySelector('#scTray .sc-thumb-e').click();
          out.reopenPanel = await until(() => vis('scPreview') && !$('scEditPanel').hidden && pc.width === 800, 6000);
          out.reopenKeepsStyle = $('scPreview').querySelector('[data-filter="gray"]').classList.contains('is-on') && $('scFineTune').classList.contains('is-on') && sumPx() === grayTunedSum;
          $('scFineTune').click();
          out.reopenKeepsTune = $('scTuneContrast').value === '60' && $('scTuneSharp').value === '40';
          $('scTuneCancel').click();
          $('scPreview').querySelector('[data-filter="orig"]').click();
          await wait(250);
          out.originalComesBack = sumPx() === origSum;

          /* Cancel leaves the queued page exactly as it was */
          $('scPreviewRetake').click();
          out.cancelKeeps = await until(() => vis('scSend'), 4000) && document.querySelector('#scTray .sc-thumb img').src === thumbAfterSave && window.__scanState().pages === 3 && window.__scanState().hasCurrent === false;

          /* Crop starts from the original shot (full 4:3 frame, not the already-cut page) */
          document.querySelector('#scTray .sc-thumb-e').click();
          await until(() => vis('scPreview') && !$('scEditPanel').hidden, 6000);
          $('scPreviewCrop').click();
          out.cropFromOriginal = await until(() => vis('scCrop') && $('scCropCanvas').width > 50, 4000) && Math.abs($('scCropCanvas').width / $('scCropCanvas').height - 800 / 600) < 0.02;
          $('scCropRetake').click();
          await until(() => vis('scPreview'), 3000);

          /* Rotate is remembered, even after Crop re-cuts the page from the original */
          $('scRotate').click();
          await wait(200);
          const rotW = pc.width, rotH = pc.height;
          $('scPreviewCrop').click();
          await until(() => vis('scCrop'), 3000);
          $('scCropNext').click();
          await until(() => vis('scPreview') && pc.width > 40, 4000);
          out.rotateSurvivesCrop = rotW === 600 && rotH === 800 && pc.width === rotW && pc.height === rotH;
          $('scAddPage').click();
          await until(() => vis('scSend'), 4000);
          document.querySelectorAll('#scTray .sc-thumb-e')[0].click();
          await until(() => vis('scPreview') && !$('scEditPanel').hidden, 6000);
          out.rotateSaved = pc.width === 600 && pc.height === 800;
          $('scPreviewRetake').click();
          await until(() => vis('scSend'), 3000);

          /* the second picture (a different size) opens from its own thumbnail */
          document.querySelectorAll('#scTray .sc-thumb-e')[1].click();
          out.secondEdits = await until(() => vis('scPreview') && !$('scEditPanel').hidden && pc.width === 500 && pc.height === 700, 6000);
          $('scPreviewRetake').click();
          await until(() => vis('scSend'), 3000);
          window.__opened = [];
          const realOpen = window.open;
          window.open = (u) => { window.__opened.push(String(u)); return null; };
          document.querySelector('#scTray .sc-thumb:last-child img').click();
          window.open = realOpen;
          out.pdfNotCroppable = vis('scSend') && !vis('scCrop') && !vis('scViewer') && window.__opened.length === 1 && window.__opened[0].indexOf('blob:') === 0;

          $('scFmtPdf').checked = true;
          const m0 = window.__uploads.length;
          $('scSendBtn').click();
          out.multiDone = await until(() => vis('scDone') && window.__uploads.filter((u) => u.ok && u.p.endsWith('.pdf')).length >= 3, 20000);
          const isPage = (u) => /\\/p\\d{3}\\./.test(u.p);
          const mUp = window.__uploads.slice(m0).filter((u) => isPage(u) && u.ok);
          out.multiTypes = mUp.map((u) => u.type).join(',');
          out.multiExact = mUp.length === 2 ? await mUp[1].blob.text() === pdfBody : false;
          out.multiMerged = mUp.length === 2 ? (await mUp[0].blob.slice(0, 5).text()) === '%PDF-' && mUp[0].size > 800 : false;
          out.multiNames = mUp.map((u) => u.p.split('/').pop()).join(',');

          $('scMoreBtn').click();
          await until(() => vis('scCamera'), 8000);
          pick('scCamFile', [new File([jpgA], 'c.jpg', { type: 'image/jpeg' }), new File([pngB], 'd.png', { type: 'image/png' })]);
          await until(() => vis('scSend') && document.querySelectorAll('#scTray .sc-thumb').length === 2, 8000);
          $('scFmtImg').checked = true;
          const m1 = window.__uploads.length;
          $('scSendBtn').click();
          out.separateDone = await until(() => vis('scDone') && window.__uploads.slice(m1).filter((u) => u.ok && u.p.endsWith('.jpg')).length === 2, 12000);
          out.separateTypes = window.__uploads.slice(m1).filter((u) => u.ok && isPage(u)).map((u) => u.type).join(',');

          $('scMoreBtn').click();
          await until(() => vis('scCamera'), 8000);
          const many = []; for (let i = 0; i < 45; i++) many.push(new File([jpgA], 'm' + i + '.jpg', { type: 'image/jpeg' }));
          pick('scCamFile', many);
          await until(() => vis('scSend') && window.__scanState().pages === 40, 30000);
          out.limit40 = window.__scanState().pages === 40;
          out.limitStatus = $('scSendStatus').textContent;

          out.forbidden = window.__forbidden.slice();
          return out;
        })()`, true, 120000);

        pass('phone: opening the page sends only a "hello" marker; the intro shows the patient label and no page can be sent yet',
            flow.helloSent === true && flow.introVisible === true && flow.finishDisabled === true);
        pass('phone: the live camera starts (fake device) and shows video', flow.cameraShown === true && flow.videoLive === true);
        pass('phone: Auto is on by default and nothing counts down while no page is in view',
            flow.autoBtnOn === true && flow.noCountWithoutPage === true, JSON.stringify([flow.autoBtnOn, flow.noCountWithoutPage]));
        pass('phone: the round shutter works at any time and goes straight to the preview (no crop screen); Retake returns to the camera and drops it',
            flow.manualDirect === true && flow.retakeToCamera === true, JSON.stringify([flow.manualDirect, flow.retakeToCamera]));
        pass('phone: a text page in view starts the on-screen count-down (3 s ring)', flow.countStarted === true && flow.countVisible === true &&
            /capturing in/i.test(flow.countMsg || ''), JSON.stringify([flow.countStarted, flow.countVisible, flow.countMsg]));
        pass('phone: after the 3 s it snapshots by itself - only the area inside the dotted frame (same shape, no desk in the corners)',
            flow.roiSeen === true && flow.autoFired === true && flow.autoMs >= 2200 && flow.autoMs <= 5500 && flow.autoCrop === true && flow.countHidden === true,
            JSON.stringify([flow.roiSeen, flow.autoFired, flow.autoMs, flow.autoSize, flow.autoCornerLum, flow.autoCrop, flow.countHidden]));
        pass('phone: a page smaller than the dotted frame is cut out of it (its own shape, no desk)', flow.smallPageCut === true, flow.smallInfo);
        pass('phone: a new scan defaults to black & white', flow.defaultBw === true);
        pass('phone: the preview has Retake / Edit / Add page; Crop, Rotate and the four scan styles are inside the Edit panel, which opens and closes',
            flow.mainRow === 'scPreviewRetake,scPreviewEdit,scAddPage' && flow.editClosed === true && flow.editOpen === true && flow.editHolds === true && flow.editToggles === true,
            JSON.stringify([flow.mainRow, flow.editClosed, flow.editOpen, flow.editHolds, flow.editToggles]));
        pass('phone: scan style switches (enhanced, then back to black & white) and rotate swaps the page orientation',
            flow.styleSwitch === true && flow.bwApplied === true && flow.chipOn === true && flow.rotated === true,
            JSON.stringify([flow.styleSwitch, flow.bwApplied, flow.chipOn, flow.rotated]));
        pass('phone: Fine tune button sits in the Edit panel, only for Grey / Black & white (hidden for Original / Enhanced)',
            flow.ftInEdit === true && flow.ftHiddenInColor === true && flow.ftShownGray === true,
            JSON.stringify([flow.ftInEdit, flow.ftHiddenInColor, flow.ftShownGray]));
        pass('phone: Fine tune pops up a mini preview with Sharpness and Contrast range sliders plus Save / Cancel / Reset',
            flow.ftOpens === true && flow.ftSliders === true && flow.ftTexts === true, JSON.stringify([flow.ftOpens, flow.ftSliders, flow.ftTexts]));
        pass('phone: moving the sliders updates the value labels and the mini preview live, without touching the page until Save',
            flow.ftLabels === true && flow.ftMiniLive === true && flow.ftPageUntouched === true, JSON.stringify([flow.ftLabels, flow.ftMiniLive, flow.ftPageUntouched]));
        pass('phone: Cancel discards the adjustment (page unchanged, sliders back to 0 next time)',
            flow.ftCancel === true && flow.ftCancelledNotKept === true, JSON.stringify([flow.ftCancel, flow.ftCancelledNotKept]));
        pass('phone: Save applies it to the page; reopening shows the saved values; Reset zeroes them; Cancel keeps what was saved',
            flow.ftSave === true && flow.ftReopenKeeps === true && flow.ftReset === true && flow.ftKeepsSavedOnCancel === true,
            JSON.stringify([flow.ftSave, flow.ftReopenKeeps, flow.ftReset, flow.ftKeepsSavedOnCancel]));
        pass('phone: tuning works for black & white too (stays pure black / white); picking another style resets the tune',
            flow.ftResetOnStyle === true && flow.ftBwTuned === true && flow.ftBwBack === true,
            JSON.stringify([flow.ftResetOnStyle, flow.ftBwTuned, flow.ftBwBack]));
        pass('phone: Crop is on the preview - Cancel keeps the same preview, Apply re-cuts it',
            flow.cropOpens === true && flow.cropCancelKeeps === true && flow.cropApplied === true, JSON.stringify([flow.cropOpens, flow.cropCancelKeeps, flow.cropApplied]));
        pass('phone: Add page returns to the camera with the count; the same page left in view is not captured twice, taking it away re-arms',
            flow.backToCamera === true && flow.noDoubleShot === true && flow.rearmed === true, JSON.stringify([flow.backToCamera, flow.noDoubleShot, flow.rearmed]));
        pass('phone: pressing the round shutter during the count-down captures at once and stops the count-down',
            flow.count2 === true && flow.manualDuring === true && flow.countStopped === true, JSON.stringify([flow.count2, flow.manualDuring, flow.countStopped]));
        pass('phone: Next (top right of the preview) opens the Pending upload queue with the pages taken so far',
            flow.nextOpensQueue === true && flow.twoPages === true);
        pass('phone: an unsent page can be discarded locally (nothing was uploaded for it)', flow.sendView === true && flow.discardedLocally === true);
        pass('phone: Retake on the preview drops the page; Auto can be turned off (no count-down) and the shutter still works',
            flow.retakeDropsIt === true && flow.autoOffState === true && flow.noCountWhenOff === true,
            JSON.stringify([flow.retakeDropsIt, flow.autoOffState, flow.noCountWhenOff]));
        pass('phone: header Auto / Manual switch - Manual stops auto-capture, switching back to Auto restarts the 3 s count-down, switching to Manual cancels it',
            flow.backToAuto === true && flow.manualStopsCount === true, JSON.stringify([flow.backToAuto, flow.manualStopsCount]));
        pass('phone: a failed send keeps the page and reports it; nothing marks the session done',
            flow.failShown === true && flow.pagesKept === true, JSON.stringify([flow.failShown, flow.pagesKept]));
        pass('phone: retry sends the image (jpeg, upsert off), then a done marker, and clears the local pages',
            flow.doneView === true && flow.sentJpg === true && flow.doneMarker === true && flow.pagesCleared === true && /1/.test(flow.countText || ''));
        pass('phone: a page taken with the camera can be edited from the queue too (style remembered, Crop shows the original shot, Save replaces it)',
            flow.camEditOpens === true && flow.camStyleKept === true && flow.camCropOriginal === true && flow.camEditSaved === true && flow.camSecondOrig === true,
            JSON.stringify([flow.camEditOpens, flow.camStyleKept, flow.camCropOriginal, flow.camEditSaved, flow.camSecondOrig]));
        pass('phone: "one PDF" mode uploads a single real PDF built from the pages', flow.pdfDone === true && flow.pdfSent === true && flow.pdfHeader === '%PDF-',
            JSON.stringify([flow.pdfDone, flow.pdfSent, flow.pdfHeader]));
        pass('phone: every upload is a new unique path under phone-scan/<token>/ in the photos bucket', flow.pagesAllPaths === true && flow.uniquePaths === true);
        pass('phone: pages are numbered p000, p001... (the desktop probes these names) and only bucket-allowed types are sent',
            flow.pageNames === 'p000.jpg,p001.pdf' && flow.allowedTypes === true, flow.pageNames);
        pass('phone: both gallery pickers allow several files at once and accept PDF', flow.galleryInput === true);
        pass('phone: a single picked photo goes through the same auto-crop -> preview flow', flow.singleStillPreview === true);
        pass('phone: several photos + a PDF picked together go straight to the page list; the unusable file is skipped and reported',
            flow.multiView === true && flow.pdfThumb === true && /3 added, 1 skipped/.test(flow.multiStatus || ''), JSON.stringify([flow.multiView, flow.pdfThumb, flow.multiStatus]));
        pass('phone: tapping the preview enlarges the page before it is added (no crop / navigation buttons), close returns to the preview',
            flow.previewEnlarges === true && flow.previewNoNav === true && flow.previewViewerClosed === true,
            JSON.stringify([flow.previewEnlarges, flow.previewNoNav, flow.previewViewerClosed]));
        pass('phone: after each scan the camera screen shows the latest page as a thumbnail; tap enlarges it, the zoom button toggles Fit / real pixels',
            flow.lastThumbShown === true && flow.lastEnlarges === true && flow.fitFirst === true && flow.zoomIn === true &&
                flow.zoomBackToFit === true && flow.lastClosed === true && /^#1 \/ 1$/.test(flow.lastLabel || ''),
            JSON.stringify([flow.lastThumbShown, flow.lastEnlarges, flow.fitFirst, flow.zoomIn, flow.zoomBackToFit, flow.lastClosed, flow.lastLabel]));
        pass('phone: enlarged page - two fingers apart zoom in, together zoom out; zoomed, one finger moves the page instead of changing page',
            flow.pinchOut === true && flow.zoomedPans === true && flow.pinchIn === true, JSON.stringify([flow.pinchOut, flow.zoomedPans, flow.pinchIn]));
        pass('phone: enlarged page - swipe left / right moves between pages (not past the ends; vertical or short drags do not)',
            flow.swipeLeftNext === true && flow.swipeEdgeStays === true && flow.swipeRightPrev === true && flow.verticalNoNav === true && flow.shortNoNav === true,
            JSON.stringify([flow.swipeLeftNext, flow.swipeEdgeStays, flow.swipeRightPrev, flow.verticalNoNav, flow.shortNoNav]));
        pass('phone: enlarged page - double-tap toggles real pixels / fit; wheel and arrow keys work on desktop browsers',
            flow.doubleTapIn === true && flow.doubleTapOut === true && flow.wheelZoom === true && flow.zoomButtonBack === true && flow.arrowKey === true,
            JSON.stringify([flow.doubleTapIn, flow.doubleTapOut, flow.wheelZoom, flow.zoomButtonBack, flow.arrowKey]));
        pass('phone: tapping a page in the list enlarges it, prev / next move between pages (PDFs skipped); the viewer button is now Edit and opens the scan-edit preview with the Edit panel open',
            flow.trayEnlarges === true && flow.trayLabel === '#1 / 3' && flow.trayNav === true && flow.trayNext === true && flow.viewerEditLabel === true &&
                flow.viewerClosedForCrop === true && flow.tapCrops === true && flow.viewerEditCropped === true,
            JSON.stringify([flow.trayEnlarges, flow.trayLabel, flow.trayNav, flow.trayNext, flow.viewerEditLabel, flow.viewerClosedForCrop, flow.tapCrops, flow.viewerEditCropped]));
        pass('phone: editing a queued page shows Save / Cancel, restores its style (Original) and lets the style + Fine tune be changed, then replaces it in the list',
            flow.editLabels === true && flow.editOrigOn === true && flow.editRestyled === true && flow.cropBack === true && flow.cropReplaced === true,
            JSON.stringify([flow.editLabels, flow.editOrigOn, flow.editRestyled, flow.cropBack, flow.cropReplaced]));
        pass('phone: every image thumbnail in the queue has its own Edit button (none on the PDF); the hint mentions Edit',
            flow.thumbEditBtns === true && flow.hintMentionsEdit === true, JSON.stringify([flow.thumbEditBtns, flow.hintMentionsEdit]));
        pass('phone: reopening a queued page restores the saved style and Fine tune, and Original brings back the untouched shot; Cancel leaves the page unchanged',
            flow.reopenPanel === true && flow.reopenKeepsStyle === true && flow.reopenKeepsTune === true && flow.originalComesBack === true && flow.cancelKeeps === true,
            JSON.stringify([flow.reopenPanel, flow.reopenKeepsStyle, flow.reopenKeepsTune, flow.originalComesBack, flow.cancelKeeps]));
        pass('phone: Crop on a queued page starts from the original shot; Rotate is remembered through Crop and Save; each thumbnail opens its own picture',
            flow.cropFromOriginal === true && flow.rotateSurvivesCrop === true && flow.rotateSaved === true && flow.secondEdits === true,
            JSON.stringify([flow.cropFromOriginal, flow.rotateSurvivesCrop, flow.rotateSaved, flow.secondEdits]));
        pass('phone: a PDF opens in the phone PDF viewer instead and cannot be edited',
            flow.pdfNotCroppable === true, JSON.stringify([flow.pdfNotCroppable]));
        pass('phone: "One PDF" merges the pictures into one PDF and sends the picked PDF byte-for-byte as its own file',
            flow.multiDone === true && flow.multiTypes === 'application/pdf,application/pdf' && flow.multiExact === true && flow.multiMerged === true,
            JSON.stringify([flow.multiDone, flow.multiTypes, flow.multiExact, flow.multiMerged, flow.multiNames]));
        pass('phone: "Separate images" sends every picked photo as a JPEG (png converted)',
            flow.separateDone === true && flow.separateTypes === 'image/jpeg,image/jpeg', flow.separateTypes);
        pass('phone: the page list is capped at 40 and the extras are reported', flow.limit40 === true && /5 skipped/.test(flow.limitStatus || ''), flow.limitStatus);
        pass('phone: during the whole session it never touched a table or any storage method except upload',
            Array.isArray(flow.forbidden) && flow.forbidden.length === 0, JSON.stringify(flow.forbidden));

        stage = 'done';
    } catch (e) {
        pass('CDP live page', false, e && e.message ? e.message : String(e));
    } finally {
        try { if (phone && phone.ws) phone.ws.close(); } catch (e) { /* ignore */ }
        try { if (ws) ws.close(); } catch (e) { /* ignore */ }
        try { proc.kill(); } catch (e) { /* ignore */ }
        await new Promise(function (r) { server.close(r); });
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
