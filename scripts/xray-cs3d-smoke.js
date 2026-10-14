/**
 * Banana Dicom Reader sidecar (Cornerstone3D). Independent of OHIF.
 * Banana opens /cs3d/ and starts X-ray Helper. Save-back is Helper.
 * Run: node scripts/xray-cs3d-smoke.js
 */
var fs = require('fs');
var http = require('http');
var https = require('https');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261003cbe';
var PAGE_PORT = 8808;
var CDP_PORT = 9378;
var CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var root = path.resolve(__dirname, '..');
var fails = [];
var extraFiles = {};

var BBMRI_SLICES = [
    'bbmri-53323131.dcm',
    'bbmri-53323275.dcm',
    'bbmri-53323419.dcm',
    'bbmri-53323563.dcm',
    'bbmri-53323707.dcm',
    'bbmri-53323851.dcm'
];
var BBMRI_BASE = 'https://raw.githubusercontent.com/ivmartel/dwv/develop/tests/data/';
var JUNO_API = 'https://api.github.com/repos/OHIF/viewer-testdata/contents/dcm/Juno';
var JUNO_BASE = 'https://raw.githubusercontent.com/OHIF/viewer-testdata/master/dcm/Juno/';
var CT_SOP = '1.2.840.10008.5.1.4.1.1.2';

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
                var buf = Buffer.concat(d);
                resolve({ status: r.statusCode, body: buf, text: buf.toString('utf8') });
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

function sbCfg() {
    var block = read('app.js').match(/supabase\.createClient\(([\s\S]*?)\);/);
    var parts = [], re = /'([^']*)'/g, m;
    while ((m = re.exec(block[1]))) parts.push(m[1]);
    return { url: parts[0], key: parts.slice(1).join('') };
}

async function mapLimit(items, limit, fn) {
    var out = new Array(items.length);
    var next = 0;
    async function worker() {
        while (next < items.length) {
            var i = next++;
            out[i] = await fn(items[i], i);
        }
    }
    var n = Math.min(limit, items.length);
    var jobs = [];
    var w;
    for (w = 0; w < n; w++) jobs.push(worker());
    await Promise.all(jobs);
    return out;
}

function downloadUrl(url) {
    return new Promise(function (resolve, reject) {
        https.get(url, { headers: { 'User-Agent': 'banana-cs3d-smoke' } }, function (r) {
            if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
                downloadUrl(r.headers.location).then(resolve, reject);
                return;
            }
            var chunks = [];
            r.on('data', function (c) { chunks.push(c); });
            r.on('end', function () {
                resolve({ status: r.statusCode, buf: Buffer.concat(chunks), type: r.headers['content-type'] || 'application/dicom' });
            });
        }).on('error', reject);
    });
}

function startStaticServer(port) {
    var types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/markdown', '.wasm': 'application/wasm', '.dcm': 'application/dicom' };
    var server = http.createServer(function (req, res) {
        var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (extraFiles[urlPath]) {
            var ex = extraFiles[urlPath];
            res.writeHead(200, { 'Content-Type': ex.type || 'application/octet-stream', 'Content-Length': ex.buf.length });
            res.end(ex.buf);
            return;
        }
        if (urlPath.charAt(urlPath.length - 1) === '/') urlPath += 'index.html';
        if (urlPath === '/') urlPath = '/index.html';
        var file = path.normalize(path.join(root, urlPath));
        if (file.indexOf(root) !== 0) { res.writeHead(403); res.end('no'); return; }
        fs.readFile(file, function (err, buf) {
            if (err && /^\/cs3d(\/|$)/.test(urlPath) && !/\.[a-z0-9]+$/i.test(urlPath.replace(/\/index\.html$/i, ''))) {
                fs.readFile(path.join(root, 'cs3d', 'index.html'), function (err2, buf2) {
                    if (err2) { res.writeHead(404); res.end('missing'); return; }
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(buf2);
                });
                return;
            }
            if (err && /^\/ohif(\/|$)/.test(urlPath) && !/\.[a-z0-9]+$/i.test(urlPath.replace(/\/index\.html$/i, ''))) {
                fs.readFile(path.join(root, 'ohif', 'index.html'), function (err2, buf2) {
                    if (err2) { res.writeHead(404); res.end('missing'); return; }
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(buf2);
                });
                return;
            }
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

(async function () {
    var html = read('index.html');
    var launch = read('app-xray-cs3d.js');
    var cbct = read('app-xray-cbct.js');
    var boot = read('cs3d/cs3d-boot.js');
    var idx = read('cs3d/index.html');
    var app = read('cs3d/cs3d.js');
    var buildSrc = read('scripts/build-cs3d-sidecar.js');

    console.log('=== source ===');
    pass('index BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    pass('Banana Dicom Reader button is on the X-ray tab',
        html.indexOf('id="btnCs3dViewer"') >= 0 && html.indexOf('onclick="xrayCs3dViewerOpen()"') >= 0 &&
        html.indexOf('data-i18n="xdr.open"') >= 0);
    pass('CBCT / OHIF button is still on the X-ray tab',
        html.indexOf('id="btnCbctViewer"') >= 0 && html.indexOf('onclick="xrayCbctViewerOpen()"') >= 0);
    pass('launcher is cache-busted after the OHIF CBCT module',
        html.indexOf("'app-xray-cs3d.js?v=" + BUILD + "'") > html.indexOf("'app-xray-cbct.js?v=" + BUILD + "'"));
    pass('launcher opens cs3d/ and starts Helper on its own key',
        /cs3d\/\?v=/.test(launch) && /xrayHelperLaunch/.test(launch) && /XRAY_CS3D_KEY = 'banana.cs3d.v1'/.test(launch) &&
        !/ohif\/\?v=/.test(launch) && !/XRAY_CBCT_KEY/.test(launch));
    pass('OHIF launcher is unchanged (ohif/ + banana.cbct.v1)',
        /ohif\/\?v=/.test(cbct) && /banana\.cbct\.v1/.test(cbct) && /xrayHelperLaunch/.test(cbct) &&
        !/cs3d\/\?v=/.test(cbct) && !/banana\.cs3d\.v1/.test(cbct));
    pass('dicom-reader.html forwards to the cs3d folder', /cs3d\//.test(read('dicom-reader.html')));
    pass('boot maps GitHub Pages /cs3d basename and hops to /local',
        /lastIndexOf\('\/cs3d'\)/.test(boot) && /replaceState/.test(boot) && /\/local/.test(boot));
    pass('sidecar has volume + three planes + measure tools',
        /VOLUME_3D/.test(app) && /OrientationAxis\.AXIAL/.test(app) && /LengthTool/.test(app) &&
        /CrosshairsTool/.test(app) && /WindowLevelTool/.test(app));
    pass('sidecar skips zip members without slice positions instead of crashing',
        /function pickVolumeImageIds/.test(app) && /function hasReconstructablePlane/.test(app) &&
        /imagePositionPatient/.test(app) && /No CBCT volume/.test(app));
    pass('sidecar prefers the CT/CBCT stack over panoramics and reports',
        /1\.2\.840\.10008\.5\.1\.4\.1\.1\.2/.test(app) && /sample\.mod === 'CT'/.test(app) &&
        /g\.length >= 40/.test(app));
    pass('sidecar unpacks zip without calling OHIF',
        /bananaCs3dUnzip/.test(read('cs3d/cs3d-load.js')) && !/bananaOhif/.test(read('cs3d/cs3d-load.js')) &&
        /banana-load\.js/.test(read('ohif/index.html')));
    pass('build script vendors Cornerstone3D and does not clone OHIF',
        /@cornerstonejs\/core/.test(buildSrc) && /cs3d\.bundle\.js/.test(buildSrc) &&
        !/OHIF\/Viewers/.test(buildSrc) && !/copy-ohif/.test(buildSrc));
    var bundle = read('cs3d/vendor/cs3d.bundle.js');
    var built = bundle.indexOf('BananaCS3DVendor') >= 0 && bundle.indexOf('vendor placeholder') < 0;
    pass('Cornerstone3D vendor bundle state: ' + (built ? 'BUILT' : 'placeholder — run node scripts/build-cs3d-sidecar.js'), true,
        built ? (Math.round(bundle.length / 1024) + ' KB') : 'not built yet');

    console.log('\n=== testclient (vm) ===');
    var box = {
        I18N_STRINGS: {},
        t: function (k) { return k; },
        sessionStorage: { setItem: function (k, v) { box._s[k] = v; }, getItem: function (k) { return box._s[k]; } },
        localStorage: { setItem: function (k, v) { box._l[k] = v; }, getItem: function (k) { return box._l[k]; } },
        _s: {},
        _l: {},
        xrayPatientId: 'p1',
        xrayPatientData: { id: 'p1', patient_no: '88', full_name: 'CS3D Test' },
        xraySelected: { size: 0 },
        xrayHelperLaunch: function () { box._helper = true; },
        console: console
    };
    box.window = box;
    box.open = function (u) { box._url = u; return {}; };
    box.__JSM_BUILD = BUILD;
    vm.createContext(box);
    vm.runInContext(launch, box);
    pass('testclient: refuses to open without a patient', (function () {
        var warned = false;
        box.xrayPatientId = '';
        box.xrayNotify = function () { warned = true; };
        box._url = '';
        box.xrayCs3dViewerOpen();
        box.xrayPatientId = 'p1';
        return warned && !box._url;
    })());
    box.xrayCs3dViewerOpen();
    pass('testclient: opens cs3d/ and launches Helper',
        /cs3d\/\?/.test(box._url || '') && box._helper === true, box._url);
    pass('testclient: writes banana.cs3d.v1, not the OHIF key',
        /CS3D Test/.test(box._s['banana.cs3d.v1'] || '') && !box._s['banana.cbct.v1']);

    var bootBox = {
        location: { pathname: '/CS-web-version/cs3d/', search: '', hash: '' },
        history: { replaceState: function (a, b, u) { bootBox._hop = u; } },
        sessionStorage: { getItem: function () { return null; } },
        localStorage: { getItem: function () { return null; } },
        document: {
            querySelector: function () { return null; },
            createElement: function () { return { href: '' }; },
            head: { insertBefore: function () {} },
            readyState: 'complete',
            addEventListener: function () {},
            getElementById: function () { return null; }
        },
        console: console
    };
    bootBox.window = bootBox;
    vm.createContext(bootBox);
    vm.runInContext(boot, bootBox);
    pass('testclient: basename stays /CS-web-version/cs3d on /local hop',
        bootBox.BANANA_CS3D_BASE === '/CS-web-version/cs3d' &&
        /\/CS-web-version\/cs3d\/local/.test(bootBox._hop || ''));

    var loadBox = {
        document: {
            addEventListener: function () {},
            readyState: 'complete',
            getElementById: function () { return null; }
        },
        TextDecoder: TextDecoder,
        Uint8Array: Uint8Array,
        Promise: Promise,
        File: function (bits, name, opt) { this.name = name; this.type = (opt && opt.type) || ''; this._bits = bits; },
        console: console
    };
    loadBox.window = loadBox;
    vm.createContext(loadBox);
    vm.runInContext(read('cs3d/cs3d-load.js'), loadBox);
    var dcm = Buffer.alloc(140, 0);
    dcm[128] = 68; dcm[129] = 73; dcm[130] = 67; dcm[131] = 77;
    function storeZipMany(entries) {
        var locals = [];
        var cds = [];
        var offset = 0;
        entries.forEach(function (ent) {
            var nameB = Buffer.from(ent.name);
            var data = Buffer.isBuffer(ent.data) ? ent.data : Buffer.from(ent.data);
            var local = Buffer.alloc(30 + nameB.length + data.length);
            local.writeUInt32LE(0x04034b50, 0);
            local.writeUInt16LE(20, 4);
            local.writeUInt32LE(data.length, 18);
            local.writeUInt32LE(data.length, 22);
            local.writeUInt16LE(nameB.length, 26);
            nameB.copy(local, 30);
            data.copy(local, 30 + nameB.length);
            var cd = Buffer.alloc(46 + nameB.length);
            cd.writeUInt32LE(0x02014b50, 0);
            cd.writeUInt16LE(20, 4);
            cd.writeUInt16LE(20, 6);
            cd.writeUInt32LE(data.length, 20);
            cd.writeUInt32LE(data.length, 24);
            cd.writeUInt16LE(nameB.length, 28);
            cd.writeUInt32LE(offset, 42);
            nameB.copy(cd, 46);
            locals.push(local);
            cds.push(cd);
            offset += local.length;
        });
        var cdBuf = Buffer.concat(cds);
        var eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(entries.length, 8);
        eocd.writeUInt16LE(entries.length, 10);
        eocd.writeUInt32LE(cdBuf.length, 12);
        eocd.writeUInt32LE(offset, 16);
        return Buffer.concat(locals.concat([cdBuf, eocd]));
    }
    function storeZip(name, data) {
        var nameB = Buffer.from(name);
        var local = Buffer.alloc(30 + nameB.length + data.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameB.length, 26);
        nameB.copy(local, 30);
        data.copy(local, 30 + nameB.length);
        var cd = Buffer.alloc(46 + nameB.length);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt32LE(data.length, 20);
        cd.writeUInt32LE(data.length, 24);
        cd.writeUInt16LE(nameB.length, 28);
        nameB.copy(cd, 46);
        var eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(1, 8);
        eocd.writeUInt16LE(1, 10);
        eocd.writeUInt32LE(cd.length, 12);
        eocd.writeUInt32LE(local.length, 16);
        return Buffer.concat([local, cd, eocd]);
    }
    var unzipped = await loadBox.bananaCs3dUnzip(new Uint8Array(storeZip('study/slice.dcm', dcm)), 0);
    pass('testclient: a store zip of one .dcm unpacks to a DICOM instance',
        unzipped && unzipped.length === 1 && unzipped[0].name === 'slice.dcm'
        && loadBox.bananaCs3dLooksDicom(unzipped[0].name, unzipped[0].bytes));
    var winZip = await loadBox.bananaCs3dUnzip(new Uint8Array(storeZip('study\\IM0001', dcm)), 0);
    pass('testclient: Windows backslash zip names still yield the DICOM file',
        winZip && winZip.length === 1 && winZip[0].name === 'IM0001'
        && loadBox.bananaCs3dLooksDicom(winZip[0].name, winZip[0].bytes, winZip[0].bytes.length));
    var bare = Buffer.alloc(16, 0);
    bare[0] = 0x08; bare[2] = 0x16;
    pass('testclient: extensionless DICOM with a DICM marker is kept',
        loadBox.bananaCs3dLooksDicom('IM0001', new Uint8Array(dcm), dcm.length) === true);
    pass('testclient: preamble-less group 0008 file is kept',
        loadBox.bananaCs3dLooksDicom('IM0002', new Uint8Array(bare), 400) === true);
    var jpeg = Buffer.alloc(140, 0);
    jpeg[128] = 68; jpeg[129] = 73; jpeg[130] = 67; jpeg[131] = 77;
    pass('testclient: a .jpg is not treated as a slice',
        loadBox.bananaCs3dLooksDicom('photo.jpg', new Uint8Array(jpeg), jpeg.length) === false);
    function zip64One(name, data) {
        var nameB = Buffer.from(name);
        var local = Buffer.alloc(30 + nameB.length + data.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameB.length, 26);
        nameB.copy(local, 30);
        data.copy(local, 30 + nameB.length);
        var cd = Buffer.alloc(46 + nameB.length);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt32LE(data.length, 20);
        cd.writeUInt32LE(data.length, 24);
        cd.writeUInt16LE(nameB.length, 28);
        nameB.copy(cd, 46);
        var z64 = Buffer.alloc(56);
        z64.writeUInt32LE(0x06064b50, 0);
        z64.writeUInt32LE(44, 4);
        z64.writeUInt32LE(1, 32);
        z64.writeUInt32LE(cd.length, 40);
        z64.writeUInt32LE(local.length, 48);
        var loc = Buffer.alloc(20);
        loc.writeUInt32LE(0x07064b50, 0);
        loc.writeUInt32LE(local.length + cd.length, 8);
        var eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(0xFFFF, 8);
        eocd.writeUInt16LE(0xFFFF, 10);
        eocd.writeUInt32LE(0xFFFFFFFF, 12);
        eocd.writeUInt32LE(0xFFFFFFFF, 16);
        return Buffer.concat([local, cd, z64, loc, eocd]);
    }
    var z64unzip = await loadBox.bananaCs3dUnzip(new Uint8Array(zip64One('series/0001.dcm', dcm)), 0);
    pass('testclient: a ZIP64 directory still unpacks the DICOM slice',
        z64unzip && z64unzip.length === 1 && z64unzip[0].name === '0001.dcm'
        && loadBox.bananaCs3dLooksDicom(z64unzip[0].name, z64unzip[0].bytes));

    var metaMap = {};
    var axialOri = [1, 0, 0, 0, 1, 0];
    var coronalOri = [1, 0, 0, 0, 0, -1];
    var CT_SOP = '1.2.840.10008.5.1.4.1.1.2';
    var pickIds = [];
    function addSlice(id, mod, sop, uid, z, ori, rows, cols) {
        pickIds.push(id);
        metaMap[id] = {
            imagePlaneModule: {
                imagePositionPatient: [0, 0, z],
                imageOrientationPatient: ori,
                rows: rows,
                columns: cols,
                frameOfReferenceUID: '1.2.for'
            },
            generalSeriesModule: { modality: mod, seriesInstanceUID: uid },
            sopCommonModule: { sopClassUID: sop }
        };
    }
    for (var zi = 7; zi >= 0; zi--) addSlice('ax' + zi, 'CT', CT_SOP, '1.2.axial', zi, axialOri, 512, 512);
    for (var si = 0; si < 2; si++) addSlice('sc' + si, 'CT', CT_SOP, '1.2.axial', si * 40, coronalOri, 512, 512);
    for (var di = 0; di < 12; di++) addSlice('dx' + di, 'DX', '1.2.840.10008.5.1.4.1.1.1.1', '1.2.pano', di, axialOri, 2000, 1000);
    for (var ci = 0; ci < 5; ci++) addSlice('cor' + ci, 'CT', CT_SOP, '1.2.cor', ci, coronalOri, 512, 512);
    for (var oi = 0; oi < 50; oi++) addSlice('ot' + oi, 'OT', '1.2.840.10008.5.1.4.1.1.7', '1.2.ot', 49 - oi, axialOri, 512, 512);
    var stubEl = function () {
        return { addEventListener: function () {}, click: function () {}, appendChild: function () {}, className: '', textContent: '', innerHTML: '' };
    };
    var pickBox = {
        document: {
            getElementById: stubEl,
            querySelectorAll: function () { return []; },
            addEventListener: function () {},
            createElement: function () { return stubEl(); },
            baseURI: 'http://127.0.0.1/cs3d/'
        },
        URL: URL,
        addEventListener: function () {},
        csCore: { metaData: { get: function (type, id) { return (metaMap[id] || {})[type] || null; } } },
        csTools: {},
        csDicom: {},
        console: console
    };
    pickBox.window = pickBox;
    vm.createContext(pickBox);
    vm.runInContext(app, pickBox);
    var picked = pickBox.CS3D_PAGE.pickVolumeImageIds(pickIds);
    pass('testclient: CBCT picker keeps the axial CT stack, sorted, and drops scout, pano, reformat, and a longer OT series',
        picked.length === 8 && picked[0] === 'ax0' && picked[7] === 'ax7',
        picked.join(','));
    var panoOnly = pickBox.CS3D_PAGE.pickVolumeImageIds(pickIds.filter(function (id) { return id.indexOf('dx') === 0; }));
    pass('testclient: a panoramic series is not treated as a CBCT volume', panoOnly.length === 0, String(panoOnly.length));
    var otOnly = pickBox.CS3D_PAGE.pickVolumeImageIds(pickIds.filter(function (id) { return id.indexOf('ot') === 0; }));
    pass('testclient: a long stack with no CT tag is used only when no CT series exists',
        otOnly.length === 50 && otOnly[0] === 'ot49' && otOnly[49] === 'ot0',
        otOnly.length + ' first=' + otOnly[0]);

    console.log('\n=== HTML ===');
    pass('HTML: the reader page asks for a CBCT zip or folder',
        idx.indexOf('Load a CBCT DICOM zip or folder') >= 0 &&
        idx.indexOf('panoramics, photos and reports are skipped') >= 0);
    pass('HTML: axial, sagittal, coronal, and volume panes are on the page',
        idx.indexOf('id="vpAxial"') >= 0 && idx.indexOf('id="vpSagittal"') >= 0 &&
        idx.indexOf('id="vpCoronal"') >= 0 && idx.indexOf('id="vpVolume"') >= 0);
    pass('HTML: the CBCT picker script is cache-busted',
        /cs3d\.js\?v=20261014fit1/.test(idx) && /cs3d-load\.js\?v=20261014fit1/.test(idx));

    console.log('\n=== API (read-only, anon): clinic xrays + public DICOM sample ===');
    var sb = sbCfg();
    try {
        var r = await fetch(sb.url.replace(/\/$/, '') +
            '/rest/v1/xrays?select=id,xray_type,file_name,file_url,file_path&limit=40', {
            headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
        });
        var rows = await r.json();
        var dcmN = (rows || []).filter(function (x) {
            return /\.(dcm|dicom|ima)$/i.test(String((x && (x.file_name || x.file_path)) || ''));
        }).length;
        pass('xrays table readable for DICOM hunt', r.status === 200 && Array.isArray(rows),
            'HTTP ' + r.status + ', n=' + (rows && rows.length) + ', clinic .dcm=' + dcmN);
    } catch (e) {
        pass('xrays table readable for DICOM hunt', false, e.message);
    }

    var samples = [];
    try {
        for (var si = 0; si < BBMRI_SLICES.length; si++) {
            var got = await downloadUrl(BBMRI_BASE + BBMRI_SLICES[si]);
            if (got.status !== 200 || got.buf.length < 1000 || got.buf[128] !== 68) {
                throw new Error(BBMRI_SLICES[si] + ' HTTP ' + got.status + ' n=' + got.buf.length);
            }
            samples.push({ name: BBMRI_SLICES[si], buf: got.buf, type: 'application/dicom' });
            extraFiles['/__cs3d-sample/' + BBMRI_SLICES[si]] = { buf: got.buf, type: 'application/dicom' };
        }
        pass('public BBMRI MR series downloaded (6 real DICOM slices)',
            samples.length === 6 && samples.every(function (s) { return s.buf[128] === 68 && s.buf[131] === 77; }),
            samples.reduce(function (n, s) { return n + s.buf.length; }, 0) + ' bytes');
        var dummyDcm = Buffer.alloc(140, 0);
        dummyDcm[128] = 68; dummyDcm[129] = 73; dummyDcm[130] = 67; dummyDcm[131] = 77;
        extraFiles['/__cs3d-sample/report.dcm'] = { buf: dummyDcm, type: 'application/dicom' };
        if (samples.length === 6) {
            var zipEntries = samples.map(function (s) {
                return { name: 'study/' + s.name, data: s.buf };
            });
            zipEntries.push({ name: 'study/report.dcm', data: dummyDcm });
            var mixedZip = storeZipMany(zipEntries);
            extraFiles['/__cs3d-sample/mixed.zip'] = { buf: mixedZip, type: 'application/zip' };
        }
    } catch (e) {
        pass('public BBMRI MR series downloaded (6 real DICOM slices)', false, e.message);
    }

    var junoSlices = [];
    try {
        var junoList = await downloadUrl(JUNO_API);
        var junoMeta = JSON.parse(junoList.buf.toString('utf8'));
        if (!Array.isArray(junoMeta)) throw new Error('Juno listing HTTP ' + junoList.status);
        var junoNames = junoMeta.filter(function (f) { return f && f.name && f.size > 10000; }).map(function (f) { return f.name; });
        var gotJuno = await mapLimit(junoNames, 6, async function (name) {
            var one = await downloadUrl(JUNO_BASE + encodeURIComponent(name));
            if (one.status !== 200 || one.buf.length < 1000 || one.buf[128] !== 68) {
                throw new Error(name + ' HTTP ' + one.status + ' n=' + one.buf.length);
            }
            return { name: name, buf: one.buf };
        });
        gotJuno.forEach(function (s) {
            junoSlices.push(s);
            extraFiles['/__cs3d-sample/juno/' + s.name] = { buf: s.buf, type: 'application/dicom' };
        });
        var ctSopN = junoSlices.filter(function (s) { return s.buf.indexOf(CT_SOP) >= 0; }).length;
        var jlsN = junoSlices.filter(function (s) { return s.buf.indexOf('1.2.840.10008.1.2.4.80') >= 0; }).length;
        pass('public real CT series downloaded (CT Image Storage, JPEG-LS, extensionless)',
            junoSlices.length >= 40 && ctSopN === junoSlices.length && jlsN >= 40,
            junoSlices.length + ' slices, CT SOP ' + ctSopN + ', JPEG-LS ' + jlsN + ', ' +
            junoSlices.reduce(function (n, s) { return n + s.buf.length; }, 0) + ' bytes');
        if (junoSlices.length) {
            var junoReport = Buffer.alloc(140, 0);
            junoReport[128] = 68; junoReport[129] = 73; junoReport[130] = 67; junoReport[131] = 77;
            var junoZip = storeZipMany(junoSlices.map(function (s) {
                return { name: 'study/' + s.name, data: s.buf };
            }).concat([{ name: 'study/report.dcm', data: junoReport }]));
            extraFiles['/__cs3d-sample/juno.zip'] = { buf: junoZip, type: 'application/zip' };
            pass('real CT series packed with a report into a zip',
                junoZip.length > 1000000 && junoZip[0] === 0x50 && junoZip[1] === 0x4b,
                junoZip.length + ' bytes');
        }
    } catch (eJuno) {
        pass('public real CT series downloaded (CT Image Storage, JPEG-LS, extensionless)', false, eJuno.message);
    }

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var idxGet = await httpGetText(PAGE_PORT, '/index.html?_lr=' + BUILD);
    pass('GET /index.html has both CBCT and Banana Dicom Reader buttons',
        idxGet.status === 200 && idxGet.body.indexOf('btnCbctViewer') >= 0 && idxGet.body.indexOf('btnCs3dViewer') >= 0);
    var js = await httpGetText(PAGE_PORT, '/app-xray-cs3d.js?v=' + BUILD);
    pass('GET /app-xray-cs3d.js is served', js.status === 200 && /function xrayCs3dViewerOpen/.test(js.body));
    var oh = await httpGetText(PAGE_PORT, '/ohif/index.html');
    pass('GET /ohif/index.html is still the OHIF sidecar', oh.status === 200 && /OHIF/.test(oh.body) && /banana-boot\.js/.test(oh.body));
    var cs = await httpGetText(PAGE_PORT, '/cs3d/index.html');
    pass('GET /cs3d/index.html is the Banana Dicom Reader', cs.status === 200 && /Banana Dicom Reader/.test(cs.body) && /cs3d-boot\.js/.test(cs.body));
    var loc = await httpGetText(PAGE_PORT, '/cs3d/local');
    pass('GET /cs3d/local falls back to the sidecar SPA', loc.status === 200 && /Banana Dicom Reader/.test(loc.body));
    var bootGet = await httpGetText(PAGE_PORT, '/cs3d/cs3d-boot.js');
    pass('GET /cs3d/cs3d-boot.js is served', bootGet.status === 200 && /banana\.cs3d\.v1/.test(bootGet.body) && /replaceState/.test(bootGet.body));
    var ven = await httpGetText(PAGE_PORT, '/cs3d/vendor/cs3d.bundle.js');
    pass('GET /cs3d/vendor/cs3d.bundle.js is the Cornerstone3D bundle',
        ven.status === 200 && /BananaCS3DVendor/.test(ven.body) && ven.body.indexOf('vendor placeholder') < 0);
    if (samples.length) {
        var samp = await httpGetText(PAGE_PORT, '/__cs3d-sample/' + samples[0].name);
        pass('GET /__cs3d-sample serves a real DICOM',
            samp.status === 200 && samp.body.length > 8000 && samp.body[128] === 68,
            samp.body.length + ' bytes');
        var zipGet = await httpGetText(PAGE_PORT, '/__cs3d-sample/mixed.zip');
        pass('GET /__cs3d-sample/mixed.zip is a study zip',
            zipGet.status === 200 && zipGet.body[0] === 0x50 && zipGet.body[1] === 0x4b,
            zipGet.body.length + ' bytes');
    }
    if (junoSlices.length) {
        var junoGet = await httpGetText(PAGE_PORT, '/__cs3d-sample/juno/' + encodeURIComponent(junoSlices[0].name));
        pass('spot: GET a real CT slice is DICOM CT Image Storage',
            junoGet.status === 200 && junoGet.body[128] === 68 && junoGet.body.indexOf(CT_SOP) >= 0,
            junoGet.body.length + ' bytes');
        var junoZipGet = await httpGetText(PAGE_PORT, '/__cs3d-sample/juno.zip');
        pass('spot: GET the real CT zip',
            junoZipGet.status === 200 && junoZipGet.body[0] === 0x50 && junoZipGet.body[1] === 0x4b,
            junoZipGet.body.length + ' bytes');
    }
    try {
        var liveReader = await httpGetText(5500, '/cs3d/index.html?cbct=1');
        pass('spot: live :5500 serves the CBCT reader page',
            liveReader.status === 200 && liveReader.text.indexOf('Load a CBCT DICOM zip or folder') >= 0 &&
            liveReader.text.indexOf('cs3d.js?v=20261014fit1') >= 0,
            'HTTP ' + liveReader.status);
    } catch (eLive) {
        pass('spot: live :5500 serves the CBCT reader page', false, eLive.message);
    }

    console.log('\n=== CDP live page ===');
    var proc = null;
    var ws = null;
    try {
        if (!fs.existsSync(CHROME)) throw new Error('Chrome not found: ' + CHROME);
        var profile = path.join(os.tmpdir(), 'cs-cs3d-cdp');
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e0) { /* ignore */ }
        fs.mkdirSync(profile, { recursive: true });
        var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/cs3d/?v=' + BUILD;
        proc = child_process.spawn(CHROME, [
            '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile,
            '--no-first-run', '--no-default-browser-check', '--disable-sync',
            '--host-resolver-rules=MAP xray-ai.test 127.0.0.1', '--window-size=1440,900', hosted
        ], { stdio: 'ignore' });
        await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000);
        var tabs = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000);
        var page = (tabs || []).find(function (t) { return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0; });
        pass('CDP page target', !!page && !!page.webSocketDebuggerUrl, page && page.url);
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
        var cdp = new Cdp(ws);
        await cdp.call('Page.enable');
        await cdp.call('Runtime.enable');
        try { await cdp.call('Page.bringToFront'); } catch (e1) { /* ignore */ }
        await cdp.call('Page.navigate', { url: hosted });
        await sleep(1500);
        var ready = await cdp.js(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const deadline = Date.now() + 20000;
          while (Date.now() < deadline) {
            if (window.CS3D_PAGE && typeof CS3D_PAGE.state === 'function') return true;
            await wait(150);
          }
          return false;
        })()`, true, 25000);
        pass('live: sidecar ready', ready === true);
        if (!ready) throw new Error('CS3D_PAGE never appeared');
        var st = await cdp.js('CS3D_PAGE.state()');
        var diag = await cdp.js('({ vendor: !!(window.csCore && window.csTools && window.csDicom), err: window.BananaCS3DError || "", scripts: Array.prototype.map.call(document.scripts, function(s){ return s.src; }), title: document.title })');
        pass('live: vendor flag is a boolean', st && typeof st.vendor === 'boolean', st && String(st.vendor) + ' ' + JSON.stringify(diag));
        if (st && st.vendor) {
            var synth = await cdp.js('(async function(){ try { return await CS3D_PAGE.loadTestVolume(8); } catch(e){ return String(e && e.message || e); } })()', true, 60000);
            var afterSynth = await cdp.js(`(function(){
              var st = CS3D_PAGE.state();
              var actors = 0;
              try {
                var engine = csCore.getRenderingEngine('banana-cs3d');
                var vp = engine && engine.getViewport('CS3D_VOLUME');
                if (vp && vp.getActors) actors = (vp.getActors() || []).length;
              } catch (e) {}
              return { st: st, volActors: actors, status: (document.getElementById('status') || {}).textContent };
            })()`);
            pass('live: synthetic CT volume loaded with the 3D pane',
                synth === true && afterSynth && afterSynth.st && afterSynth.st.mode === 'volume' &&
                afterSynth.st.n === 8 && afterSynth.st.include3d === true && afterSynth.volActors >= 1 &&
                String(afterSynth.status || '').indexOf('Volume skipped') < 0,
                afterSynth && afterSynth.st ? (afterSynth.st.mode + ' n=' + afterSynth.st.n + ' volActors=' + afterSynth.volActors + ' err=' + afterSynth.st.error) : String(synth));
        } else {
            pass('live: vendor not built yet — skip volume load', true, 'placeholder');
        }
        if (st && st.vendor && samples.length >= 3) {
            var live = await cdp.js(`(async () => {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              const names = ${JSON.stringify(BBMRI_SLICES)};
              const files = [];
              for (const name of names) {
                const r = await fetch('/__cs3d-sample/' + name);
                if (!r.ok) throw new Error('sample HTTP ' + r.status + ' ' + name);
                const buf = await r.arrayBuffer();
                files.push(new File([buf], name, { type: 'application/dicom' }));
              }
              const sizes = files.map(function (f) { return f.size; });
              const ok = await CS3D_PAGE.loadFiles(files, 'bbmri');
              await wait(600);
              const state = CS3D_PAGE.state();
              let range = null, dims = null, actors = 0, spacing = null;
              try {
                const vol = window.csCore && csCore.cache && csCore.cache.getVolume && csCore.cache.getVolume(state.volumeId);
                if (vol) {
                  dims = vol.dimensions;
                  spacing = vol.spacing;
                  range = vol.voxelManager && vol.voxelManager.getRange && vol.voxelManager.getRange();
                }
                const engine = window.csCore && csCore.getRenderingEngine && csCore.getRenderingEngine('banana-cs3d');
                if (engine) {
                  ['CS3D_AXIAL','CS3D_SAGITTAL','CS3D_CORONAL','CS3D_VOLUME'].forEach(function (id) {
                    const vp = engine.getViewport(id);
                    if (vp && vp.getActors) actors += (vp.getActors() || []).length;
                  });
                }
              } catch (e) {}
              CS3D_PAGE.setTool('Length');
              return { ok, state, range, dims, spacing, actors, sizes, tool: CS3D_PAGE.state().tool, status: (document.getElementById('status') || {}).textContent };
            })()`, true, 90000);
            pass('live: a real MR series is not opened as a CBCT volume',
                live && live.ok === false && live.state &&
                /No CBCT volume/.test(String(live.state.error || '')) &&
                !/could not be read/.test(String(live.state.error || '')),
                live && live.state ? (live.state.mode + ' n=' + live.state.n + ' err=' + live.state.error) : 'none');
            pass('live: that MR series did not become the three-plane volume',
                live && live.ok === false && !(live.dims && live.dims[2] >= 3),
                live ? JSON.stringify({ mode: live.state && live.state.mode, dims: live.dims, actors: live.actors, err: live.state && live.state.error, status: live.status }) : 'none');
            pass('live: Length tool is active after the real load',
                live && live.tool === 'Length', live && live.tool);
            var mixed = await cdp.js(`(async () => {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              const names = ${JSON.stringify(BBMRI_SLICES)};
              const files = [];
              for (const name of names) {
                const r = await fetch('/__cs3d-sample/' + name);
                const buf = await r.arrayBuffer();
                files.push(new File([buf], name, { type: 'application/dicom' }));
              }
              const dummy = await fetch('/__cs3d-sample/report.dcm');
              files.push(new File([await dummy.arrayBuffer()], 'report.dcm', { type: 'application/dicom' }));
              const ok = await CS3D_PAGE.loadFiles(files, 'mixed-study');
              await wait(600);
              const state = CS3D_PAGE.state();
              const vol = csCore.cache && csCore.cache.getVolume && csCore.cache.getVolume(state.volumeId);
              return {
                ok, mode: state.mode, n: state.n, skipped: state.skipped, err: state.error,
                dims: vol && vol.dimensions, range: vol && vol.voxelManager && vol.voxelManager.getRange && vol.voxelManager.getRange(),
                status: (document.getElementById('status') || {}).textContent
              };
            })()`, true, 90000);
            pass('live: mixed MR plus a report is not treated as a CBCT volume',
                mixed && mixed.ok === false && mixed.skipped >= 6 &&
                /No CBCT volume/.test(String(mixed.err || '')) &&
                /could not be read/.test(String(mixed.err || '')),
                mixed ? JSON.stringify(mixed) : 'none');
            var zipped = await cdp.js(`(async () => {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              const r = await fetch('/__cs3d-sample/mixed.zip');
              if (!r.ok) throw new Error('mixed zip HTTP ' + r.status);
              const f = new File([await r.arrayBuffer()], 'mixed.zip', { type: 'application/zip' });
              const ok = await bananaCs3dHandleList([f], 'zip');
              await wait(800);
              const state = CS3D_PAGE.state();
              const vol = csCore.cache && csCore.cache.getVolume && csCore.cache.getVolume(state.volumeId);
              return {
                ok, mode: state.mode, n: state.n, skipped: state.skipped, err: state.error,
                dims: vol && vol.dimensions,
                status: (document.getElementById('status') || {}).textContent
              };
            })()`, true, 90000);
            pass('live: a zip of MR plus a report is not opened as CBCT',
                zipped && zipped.ok === false &&
                /No CBCT volume/.test(String(zipped.err || zipped.status || '')),
                zipped ? JSON.stringify(zipped) : 'none');
            var ctMixed = await cdp.js(`(async () => {
              const wait = (ms) => new Promise((r) => setTimeout(r, ms));
              const files = [];
              for (let i = 0; i < 8; i++) {
                files.push(new File([CS3D_PAGE.ctSlice(i, 8)], 'ct-' + i + '.dcm', { type: 'application/dicom' }));
              }
              const dummy = await fetch('/__cs3d-sample/report.dcm');
              files.push(new File([await dummy.arrayBuffer()], 'pano-report.dcm', { type: 'application/dicom' }));
              const ok = await CS3D_PAGE.loadFiles(files, 'ct-plus-report');
              await wait(400);
              const state = CS3D_PAGE.state();
              const vol = csCore.cache && csCore.cache.getVolume && csCore.cache.getVolume(state.volumeId);
              return {
                ok, mode: state.mode, n: state.n, skipped: state.skipped, err: state.error,
                dims: vol && vol.dimensions,
                status: (document.getElementById('status') || {}).textContent
              };
            })()`, true, 60000);
            pass('live: CT stack plus a report loads the CBCT slices and skips the report',
                ctMixed && ctMixed.ok === true && ctMixed.mode === 'volume' && ctMixed.n === 8 &&
                ctMixed.skipped >= 1 && ctMixed.dims && ctMixed.dims[2] >= 3 &&
                String(ctMixed.err || '') === '' && /CBCT/.test(String(ctMixed.status || '')),
                ctMixed ? JSON.stringify(ctMixed) : 'none');
            var reportOnly = await cdp.js(`(async () => {
              const r = await fetch('/__cs3d-sample/report.dcm');
              const f = new File([await r.arrayBuffer()], 'report.dcm', { type: 'application/dicom' });
              const ok = await CS3D_PAGE.loadFiles([f], 'report-only');
              const state = CS3D_PAGE.state();
              return { ok, mode: state.mode, err: state.error, status: (document.getElementById('status') || {}).textContent };
            })()`, true, 30000);
            pass('live: a report DICOM is not opened as a CBCT volume',
                reportOnly && reportOnly.ok === false && /No CBCT volume/.test(String(reportOnly.err || reportOnly.status || '')),
                reportOnly ? JSON.stringify(reportOnly) : 'none');
        } else {
            pass('live: a real MR series is not opened as a CBCT volume', false, 'no sample files');
        }
        if (st && st.vendor && junoSlices.length >= 8) {
            var junoNames = junoSlices.map(function (s) { return s.name; });
            var realCt = await cdp.js(`(async () => {
              const names = ${JSON.stringify(junoNames)};
              const files = [];
              for (const name of names) {
                const r = await fetch('/__cs3d-sample/juno/' + encodeURIComponent(name));
                if (!r.ok) throw new Error('juno HTTP ' + r.status + ' ' + name);
                files.push(new File([await r.arrayBuffer()], name, { type: 'application/dicom' }));
              }
              const t0 = performance.now();
              const ok = await CS3D_PAGE.loadFiles(files, 'real-ct');
              const state = CS3D_PAGE.state();
              let range = null, dims = null, actors = 0, spacing = null;
              const deadline = Date.now() + 45000;
              while (Date.now() < deadline) {
                try {
                  const vol = csCore.cache && csCore.cache.getVolume && csCore.cache.getVolume(state.volumeId);
                  if (vol) {
                    dims = vol.dimensions;
                    spacing = vol.spacing;
                    range = vol.voxelManager && vol.voxelManager.getRange && vol.voxelManager.getRange();
                  }
                  const engine = csCore.getRenderingEngine && csCore.getRenderingEngine('banana-cs3d');
                  actors = 0;
                  if (engine) {
                    ['CS3D_AXIAL','CS3D_SAGITTAL','CS3D_CORONAL','CS3D_VOLUME'].forEach(function (id) {
                      const vp = engine.getViewport(id);
                      if (vp && vp.getActors) actors += (vp.getActors() || []).length;
                    });
                  }
                } catch (e) {}
                if (range && range[1] > range[0]) break;
                await new Promise(function (r) { setTimeout(r, 400); });
              }
              return {
                ok, mode: state.mode, n: state.n, skipped: state.skipped, err: state.error,
                dims, spacing, range, actors, include3d: state.include3d, files: files.length,
                ms: Math.round(performance.now() - t0),
                status: (document.getElementById('status') || {}).textContent
              };
            })()`, true, 180000);
            var spacingOk = realCt && realCt.spacing && realCt.spacing.length >= 3 &&
                realCt.spacing.every(function (v) { return isFinite(v) && v > 0; });
            pass('live: real CT DICOM series builds a CBCT volume',
                realCt && realCt.ok === true && realCt.mode === 'volume' && realCt.n >= 40 &&
                realCt.dims && realCt.dims[0] >= 128 && realCt.dims[2] >= 40 &&
                realCt.actors >= 4 && realCt.include3d === true && spacingOk &&
                realCt.range && realCt.range[1] > realCt.range[0] &&
                !(realCt.range[0] === 20 && realCt.range[1] === 220) &&
                String(realCt.err || '') === '' && /CBCT/.test(String(realCt.status || '')),
                realCt ? JSON.stringify(realCt) : 'none');
            var realZip = await cdp.js(`(async () => {
              const r = await fetch('/__cs3d-sample/juno.zip');
              if (!r.ok) throw new Error('juno zip HTTP ' + r.status);
              const f = new File([await r.arrayBuffer()], 'juno.zip', { type: 'application/zip' });
              const t0 = performance.now();
              const ok = await bananaCs3dHandleList([f], 'zip');
              const state = CS3D_PAGE.state();
              const vol = csCore.cache && csCore.cache.getVolume && csCore.cache.getVolume(state.volumeId);
              return {
                ok, mode: state.mode, n: state.n, skipped: state.skipped, err: state.error,
                dims: vol && vol.dimensions,
                ms: Math.round(performance.now() - t0),
                status: (document.getElementById('status') || {}).textContent
              };
            })()`, true, 180000);
            pass('live: zip of the real CT series plus a report loads the CT stack',
                realZip && realZip.ok === true && realZip.mode === 'volume' && realZip.n >= 40 &&
                realZip.skipped >= 1 && realZip.dims && realZip.dims[2] >= 40 &&
                String(realZip.err || '') === '' && /CBCT/.test(String(realZip.status || '')),
                realZip ? JSON.stringify(realZip) : 'none');
        } else if (st && st.vendor) {
            pass('live: real CT DICOM series builds a CBCT volume', false, 'no real CT slices');
        }
    } catch (e) {
        pass('CDP live page', false, e && e.message);
    } finally {
        try { if (ws) ws.close(); } catch (e2) { /* ignore */ }
        try { if (proc) proc.kill(); } catch (e3) { /* ignore */ }
        try { server.close(); } catch (e4) { /* ignore */ }
    }

    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + HTML + SPOT + API + TESTCLIENT + CDP + LIVE PAGE + REAL CT PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
