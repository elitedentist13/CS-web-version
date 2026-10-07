/**
 * Banana CBCT Viewer (DenCT sidecar) on the X-ray tab.
 * Run: node scripts/xray-denct-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');

var BUILD = '20261007den1';
var PAGE_PORT = 8796;
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
            if (err && /^\/denct(\/|$)/.test(urlPath) && !/\.[a-z0-9]+$/i.test(urlPath.replace(/\/index\.html$/i, ''))) {
                fs.readFile(path.join(root, 'denct', 'index.html'), function (err2, buf2) {
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
    var launch = read('app-xray-denct.js');
    var boot = read('denct/banana-boot.js');
    var cs3d = read('app-xray-cs3d.js');
    var cbct = read('app-xray-cbct.js');
    var buildSrc = read('scripts/build-denct-sidecar.js');

    console.log('=== source ===');
    pass('index BUILD ' + BUILD, html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    pass('CBCT Viewer button sits next to Banana Dicom Reader',
        html.indexOf('id="btnDenctViewer"') >= 0 && html.indexOf('onclick="xrayDenctViewerOpen()"') >= 0 &&
        html.indexOf('id="btnCs3dViewer"') < html.indexOf('id="btnDenctViewer"') &&
        html.indexOf('id="btnDenctViewer"') < html.indexOf('id="btnCephViewer"'));
    pass('OHIF CBCT button is still on the X-ray tab',
        html.indexOf('id="btnCbctViewer"') >= 0 && html.indexOf('onclick="xrayCbctViewerOpen()"') >= 0);
    pass('launcher is cache-busted after Banana Dicom Reader',
        html.indexOf("'app-xray-denct.js?v=" + BUILD + "'") > html.indexOf("'app-xray-cs3d.js?v="));
    pass('launcher opens denct/ and starts Helper on its own key',
        /denct\/\?v=/.test(launch) && /xrayHelperLaunch/.test(launch) && /XRAY_DENCT_KEY = 'banana.denct.v1'/.test(launch) &&
        !/ohif\/\?v=/.test(launch) && !/cs3d\/\?v=/.test(launch));
    pass('OHIF and Banana Dicom Reader launchers stay on their own keys',
        /ohif\/\?v=/.test(cbct) && /banana\.cbct\.v1/.test(cbct) &&
        /cs3d\/\?v=/.test(cs3d) && /banana\.cs3d\.v1/.test(cs3d) &&
        !/denct\/\?v=/.test(cbct) && !/denct\/\?v=/.test(cs3d));
    pass('denct.html forwards to the sidecar folder', /denct\//.test(read('denct.html')));
    pass('boot maps /denct and paints the Helper bar',
        /lastIndexOf\('\/denct'\)/.test(boot) && /bananaDenctBar/.test(boot) && /banana\.denct\.v1/.test(boot));
    pass('build script fetches ZoliQua/Dental-CBCT-Viewer',
        /ZoliQua\/Dental-CBCT-Viewer/.test(buildSrc) && /demo-dist/.test(buildSrc) && /banana-boot\.js/.test(buildSrc));

    console.log('\n=== testclient (vm) ===');
    var box = {
        I18N_STRINGS: {},
        xrayPatientId: 'p1',
        xrayPatientData: { id: 'p1', patient_no: '88', full_name: 'DenCT Test', chinese_name: '' },
        xrayAllRecords: [],
        xraySelected: { size: 0, forEach: function () {} },
        xrayNotify: function () { box._note = true; },
        xrayHelperLaunch: function () { box._helper = true; },
        window: { open: function (url, name) { box._url = url; box._name = name; return { document: { title: '' } }; } }
    };
    box.window.xrayDenctViewerOpen = null;
    vm.createContext(box);
    vm.runInContext(read('app-xray-denct.js'), box);
    box.xrayDenctViewerOpen();
    pass('vm: opens denct/?v= and starts Helper',
        /^denct\/\?v=/.test(String(box._url || '')) && box._name === 'banana-denct' && box._helper === true);
    box.xrayPatientId = '';
    box._url = '';
    box._helper = false;
    box.xrayDenctViewerOpen();
    pass('vm: refuses without a patient', box._note === true && !box._url && box._helper === false);

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    try {
        var idx = await httpGetText(PAGE_PORT, '/index.html');
        pass('GET /index.html has CBCT Viewer next to Banana Dicom Reader',
            idx.status === 200 && idx.body.indexOf('btnDenctViewer') >= 0 && idx.body.indexOf('btnCs3dViewer') >= 0);
        var den = await httpGetText(PAGE_PORT, '/denct/');
        pass('GET /denct/ serves the sidecar',
            den.status === 200 && /banana-boot\.js/.test(den.body) && /CBCT Viewer|DenCT/.test(den.body));
        pass('GET /denct/ is the built DenCT app',
            /assets\/index-/.test(den.body) && /DicomViewer|DenCT|dental-cbct/.test(den.body + read('denct/README.md')));
        var bootGet = await httpGetText(PAGE_PORT, '/denct/banana-boot.js');
        pass('GET /denct/banana-boot.js', bootGet.status === 200 && /banana\.denct\.v1/.test(bootGet.body));
        var hop = await httpGetText(PAGE_PORT, '/denct.html');
        pass('GET /denct.html hops to denct/', hop.status === 200 && /denct\//.test(hop.body));
    } finally {
        server.close();
    }

    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'DENCT / CBCT VIEWER SMOKE PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
