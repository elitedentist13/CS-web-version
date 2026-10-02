/**
 * Banana opens the full OHIF Viewer as a sidecar for DICOM zip / folder.
 * Save-back stays the existing X-ray Helper (share that window).
 * Run: node scripts/xray-cbct-ohif-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');

var BUILD = '20261002cb8';
var PAGE_PORT = 8794;
var root = path.resolve(__dirname, '..');
var fails = [];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

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

function startStaticServer(port) {
    var types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/markdown' };
    var server = http.createServer(function (req, res) {
        var urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
        if (urlPath.charAt(urlPath.length - 1) === '/') urlPath += 'index.html';
        if (urlPath === '/') urlPath = '/index.html';
        var file = path.normalize(path.join(root, urlPath));
        if (file.indexOf(root) !== 0) { res.writeHead(403); res.end('no'); return; }
        fs.readFile(file, function (err, buf) {
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

(async function () {
    var html = read('index.html');
    var launch = read('app-xray-cbct.js');
    var cfg = read('ohif/banana-app-config.js');
    var ohifIdx = read('ohif/index.html');
    var buildSrc = read('scripts/build-ohif-sidecar.js');

    console.log('=== source ===');
    pass('index BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    pass('CBCT button is on the X-ray tab', html.indexOf('id="btnCbctViewer"') >= 0 && html.indexOf('onclick="xrayCbctViewerOpen()"') >= 0);
    pass('launcher module is cache-busted after the DICOM module',
        html.indexOf("'app-xray-cbct.js?v=" + BUILD + "'") > html.indexOf("'app-xray-dicom.js?v=" + BUILD + "'"));
    pass('launcher opens the OHIF sidecar window and starts the Helper',
        /ohif\/\?v=/.test(launch) && /xrayHelperLaunch/.test(launch) && /banana\.cbct\.v1/.test(launch));
    pass('OHIF sidecar config is local zip/folder only (no public PACS)',
        /dicomlocal/.test(cfg) && /defaultDataSourceName: 'dicomlocal'/.test(cfg) && !/cloudfront\.net/.test(cfg));
    pass('build script clones the official OHIF Viewer tag',
        /OHIF\/Viewers\.git/.test(buildSrc) && /v3\.11\.1/.test(buildSrc) && /banana-app-config\.js/.test(buildSrc));
    pass('cbct.html forwards to the OHIF folder', /ohif\//.test(read('cbct.html')));
    pass('boot lands on OHIF /local zip-folder page without a reload',
        /replaceState/.test(read('ohif/banana-boot.js')) && /\/local/.test(read('ohif/banana-boot.js')));
    pass('config basename stays the /ohif folder on /local and /viewer',
        /lastIndexOf\('\/ohif'\)/.test(cfg));
    pass('sidecar index is present (placeholder or full build)',
        /OHIF/.test(ohifIdx) && /banana-boot\.js/.test(ohifIdx));
    pass('sidecar unpacks zip before handing files to OHIF',
        /banana-load\.js/.test(ohifIdx) && /bananaOhifUnzip/.test(read('ohif/banana-load.js')));
    var built = fs.readdirSync(path.join(root, 'ohif')).some(function (f) {
        return /^app\.bundle\.[a-f0-9]+\.js$/.test(f);
    });
    pass('OHIF app bundle state: ' + (built ? 'BUILT' : 'placeholder — run node scripts/build-ohif-sidecar.js'), true, built ? 'dist present' : 'not built yet');

    console.log('\n=== testclient (vm) ===');
    var box = {
        I18N_STRINGS: {},
        t: function (k) { return k; },
        sessionStorage: { setItem: function (k, v) { box._s = v; }, getItem: function () { return box._s; } },
        xrayPatientId: 'p1',
        xrayPatientData: { id: 'p1', patient_no: '88', full_name: 'CBCT Test' },
        xraySelected: { size: 0 },
        xrayHelperLaunch: function () { box._helper = true; },
        console: console
    };
    box.window = box;
    box.open = function (u) { box._url = u; return {}; };
    box.__JSM_BUILD = BUILD;
    vm.createContext(box);
    vm.runInContext(launch, box);
    box.xrayCbctViewerOpen();
    pass('testclient: refuses to open without a patient when id is empty', (function () {
        var warned = false;
        box.xrayPatientId = '';
        box.xrayNotify = function () { warned = true; };
        box._url = '';
        box.xrayCbctViewerOpen();
        box.xrayPatientId = 'p1';
        return warned && !box._url;
    })());
    box.xrayCbctViewerOpen();
    pass('testclient: opens ohif/ and launches Helper',
        /ohif\/\?/.test(box._url || '') && box._helper === true, box._url);

    var cfgBox = { location: { pathname: '/CS-web-version/ohif/local' }, console: console };
    cfgBox.window = cfgBox;
    vm.createContext(cfgBox);
    vm.runInContext(cfg, cfgBox);
    pass('testclient: routerBasename is the /ohif folder when the path is /local',
        cfgBox.config && cfgBox.config.routerBasename === '/CS-web-version/ohif'
        && cfgBox.config.defaultDataSourceName === 'dicomlocal');

    var loadBox = {
        document: {
            addEventListener: function () {},
            readyState: 'complete',
            getElementById: function () { return null; },
            querySelector: function () { return null; },
            querySelectorAll: function () { return []; },
            createElement: function () {
                return { setAttribute: function () {}, addEventListener: function () {}, style: {}, appendChild: function () {} };
            }
        },
        TextDecoder: TextDecoder,
        Uint8Array: Uint8Array,
        Promise: Promise,
        console: console,
        setTimeout: setTimeout
    };
    loadBox.window = loadBox;
    vm.createContext(loadBox);
    vm.runInContext(read('ohif/banana-load.js'), loadBox);
    var dcm = Buffer.alloc(140, 0);
    dcm[128] = 68; dcm[129] = 73; dcm[130] = 67; dcm[131] = 77;
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
    var zipped = storeZip('study/slice.dcm', dcm);
    var unzipped = await loadBox.bananaOhifUnzip(new Uint8Array(zipped), 0);
    pass('testclient: a store zip of one .dcm unpacks to a DICOM instance',
        unzipped && unzipped.length === 1 && unzipped[0].name === 'slice.dcm'
        && loadBox.bananaOhifLooksDicom(unzipped[0].name, unzipped[0].bytes));

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var idx = await httpGetText(PAGE_PORT, '/index.html?_lr=' + BUILD);
    pass('GET /index.html has the CBCT button', idx.status === 200 && idx.body.indexOf('btnCbctViewer') >= 0);
    var js = await httpGetText(PAGE_PORT, '/app-xray-cbct.js?v=' + BUILD);
    pass('GET /app-xray-cbct.js is served', js.status === 200 && /function xrayCbctViewerOpen/.test(js.body));
    var oh = await httpGetText(PAGE_PORT, '/ohif/index.html');
    pass('GET /ohif/index.html is served', oh.status === 200 && /OHIF/.test(oh.body));
    var loc = await httpGetText(PAGE_PORT, '/ohif/local');
    pass('GET /ohif/local falls back to the OHIF SPA', loc.status === 200 && /OHIF/.test(loc.body));
    var boot = await httpGetText(PAGE_PORT, '/ohif/banana-boot.js');
    pass('GET /ohif/banana-boot.js is served', boot.status === 200 && /banana\.cbct\.v1/.test(boot.body) && /replaceState/.test(boot.body));
    var loadJs = await httpGetText(PAGE_PORT, '/ohif/banana-load.js');
    pass('GET /ohif/banana-load.js is served', loadJs.status === 200 && /bananaOhifUnzip/.test(loadJs.body));
    try { server.close(); } catch (e) { /* ignore */ }

    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + TESTCLIENT PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
