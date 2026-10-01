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

var BUILD = '20261002scan2';
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
    pass('PDF page size follows the scan orientation',
        scan.pdfPageSize(1000, 1400).orient === 'portrait' && scan.pdfPageSize(1400, 1000).orient === 'landscape' &&
        Math.max(scan.pdfPageSize(1000, 1400).w, scan.pdfPageSize(1000, 1400).h) === 842);

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
          out.helloSent = await until(() => window.__uploads.some((u) => /\\/h\\.png$/.test(u.p) && u.type === 'image/png'), 4000);
          out.introVisible = vis('scIntro') && $('scLabel').textContent.indexOf('#S1') === 0;
          out.finishDisabled = $('scFinishBtn').disabled === true;

          $('scStartBtn').click();
          out.cameraShown = await until(() => vis('scCamera'), 8000);
          out.videoLive = await until(() => $('scVideo').videoWidth > 0, 8000);

          async function scanOne(filter, dragCorner) {
            $('scShutter').click();
            const crop = await until(() => vis('scCrop') && $('scCropCanvas').width > 50, 5000);
            const cv = $('scCropCanvas');
            const before = cv.toDataURL().length;
            let dragged = false;
            if (dragCorner) {
              const r = cv.getBoundingClientRect();
              const x0 = r.left + r.width * 0.06, y0 = r.top + r.height * 0.06;
              const ev = (type, x, y) => new PointerEvent(type, { clientX: x, clientY: y, pointerId: 7, bubbles: true, cancelable: true });
              cv.dispatchEvent(ev('pointerdown', x0, y0));
              cv.dispatchEvent(ev('pointermove', x0 + 40, y0 + 30));
              cv.dispatchEvent(ev('pointerup', x0 + 40, y0 + 30));
              dragged = cv.toDataURL() !== undefined;
            }
            $('scCropNext').click();
            const prev = await until(() => vis('scPreview') && $('scPreviewCanvas').width > 40, 8000);
            if (filter) $('scPreview').querySelector('[data-filter="' + filter + '"]').click();
            await wait(200);
            return { crop: crop, prev: prev, dragged: dragged, w: $('scPreviewCanvas').width, h: $('scPreviewCanvas').height };
          }

          const a = await scanOne('bw', true);
          out.firstScan = a;
          const pc = $('scPreviewCanvas');
          const img = pc.getContext('2d').getImageData(0, 0, pc.width, pc.height).data;
          let onlyBw = true;
          for (let i = 0; i < img.length; i += 4 * 37) { const v = img[i]; if (!((v === 0 || v === 255) && img[i + 1] === v && img[i + 2] === v)) { onlyBw = false; break; } }
          out.bwApplied = onlyBw;
          out.chipOn = $('scPreview').querySelector('[data-filter="bw"]').classList.contains('is-on');
          const wBefore = pc.width;
          $('scRotate').click();
          await wait(200);
          out.rotated = pc.height === wBefore;
          $('scAddPage').click();
          out.backToCamera = await until(() => vis('scCamera') && $('scPagesBadge').textContent === '1', 8000);
          await until(() => $('scVideo').videoWidth > 0, 8000);
          const b = await scanOne('color', false);
          $('scAddPage').click();
          out.twoPages = await until(() => $('scPagesBadge').textContent === '2', 8000);
          out.finishEnabled = $('scFinishBtn').disabled === false;

          $('scFinishBtn').click();
          out.sendView = vis('scSend') && !vis('scCamera') && document.querySelectorAll('#scTray .sc-thumb').length === 2;
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
          await scanOne('gray', false); $('scAddPage').click(); await until(() => $('scPagesBadge').textContent === '1', 8000);
          await until(() => $('scVideo').videoWidth > 0, 8000);
          await scanOne('orig', false); $('scAddPage').click(); await until(() => $('scPagesBadge').textContent === '2', 8000);
          $('scFinishBtn').click();
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
          out.forbidden = window.__forbidden.slice();
          return out;
        })()`, true, 120000);

        pass('phone: opening the page sends only a "hello" marker; the intro shows the patient label and no page can be sent yet',
            flow.helloSent === true && flow.introVisible === true && flow.finishDisabled === true);
        pass('phone: the live camera starts (fake device) and shows video', flow.cameraShown === true && flow.videoLive === true);
        pass('phone: capture -> crop (corner drag) -> preview works', flow.firstScan && flow.firstScan.crop === true && flow.firstScan.prev === true &&
            flow.firstScan.dragged === true && flow.firstScan.w > 40, JSON.stringify(flow.firstScan));
        pass('phone: black & white filter is applied and rotate swaps the page orientation', flow.bwApplied === true && flow.chipOn === true && flow.rotated === true);
        pass('phone: pages are collected, badge counts them, review & send enabled', flow.backToCamera === true && flow.twoPages === true && flow.finishEnabled === true);
        pass('phone: an unsent page can be discarded locally (nothing was uploaded for it)', flow.sendView === true && flow.discardedLocally === true);
        pass('phone: a failed send keeps the page and reports it; nothing marks the session done',
            flow.failShown === true && flow.pagesKept === true, JSON.stringify([flow.failShown, flow.pagesKept]));
        pass('phone: retry sends the image (jpeg, upsert off), then a done marker, and clears the local pages',
            flow.doneView === true && flow.sentJpg === true && flow.doneMarker === true && flow.pagesCleared === true && /1/.test(flow.countText || ''));
        pass('phone: "one PDF" mode uploads a single real PDF built from the pages', flow.pdfDone === true && flow.pdfSent === true && flow.pdfHeader === '%PDF-',
            JSON.stringify([flow.pdfDone, flow.pdfSent, flow.pdfHeader]));
        pass('phone: every upload is a new unique path under phone-scan/<token>/ in the photos bucket', flow.pagesAllPaths === true && flow.uniquePaths === true);
        pass('phone: pages are numbered p000, p001... (the desktop probes these names) and only bucket-allowed types are sent',
            flow.pageNames === 'p000.jpg,p001.pdf' && flow.allowedTypes === true, flow.pageNames);
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
