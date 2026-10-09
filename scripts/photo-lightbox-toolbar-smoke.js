/**
 * Photos / Docs lightbox toolbar matches the X-ray lightbox toolbar
 * (prev/next, loupe, sharpness, reset tune).
 * Smoke + HTTP spot + API (read-only) + CDP Runtime.evaluate / live page.
 * Run: node scripts/photo-lightbox-toolbar-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261009plb1';
var PAGE_PORT = 8829;
var CDP_PORT = 9398;
var CHROME = process.env.CHROME_PATH || (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
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
        var req = http.get({ host: '127.0.0.1', port: port, path: reqPath, timeout: 8000 }, function (r) {
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

function startStaticServer(port) {
    var types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
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
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + API + CDP + LIVE PAGE ALL PASS (photo lightbox toolbar)'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}

(async function () {
    var html = read('index.html');
    var src = read('app-photos.js');

    console.log('=== source ===');
    pass('index loads photo lightbox toolbar build ' + BUILD,
        html.indexOf("'app-photos.js?v=" + BUILD + "'") >= 0);
    pass('photo lightbox view group has prev, next and loupe like X-ray',
        html.indexOf('id="photoLbPrevBtn"') >= 0 &&
        html.indexOf('id="photoLbNextBtn"') >= 0 &&
        html.indexOf('id="photoLbLoupeBtn"') >= 0 &&
        html.indexOf('onclick="photoLbNav(-1)"') >= 0 &&
        html.indexOf('onclick="photoLbToggleLoupe(event)"') >= 0);
    pass('photo lightbox adjust has sharpness and reset tune like X-ray',
        html.indexOf('id="photoLbSharpSlider"') >= 0 &&
        html.indexOf('onclick="photoLbResetTune()"') >= 0 &&
        html.indexOf('id="photoLbSharpenFx"') >= 0);
    pass('photo lightbox has the 3× loupe overlay',
        html.indexOf('id="photoLbLoupe"') >= 0 &&
        html.indexOf('id="photoLbLoupeCanvas"') >= 0);
    pass('helpers implement nav, loupe, sharpness and reset tune',
        extractFn(src, 'photoLbNav').indexOf('openPhotoLightbox') >= 0 &&
        extractFn(src, 'photoLbToggleLoupe').indexOf('photoLbLoupeStart') >= 0 &&
        extractFn(src, 'photoLbCssFilter').indexOf('photoLbSharpenFx') >= 0 &&
        extractFn(src, 'photoLbResetTune').indexOf('phLbSharpness') >= 0);

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var spotJs = await httpGetText(PAGE_PORT, '/app-photos.js?v=' + BUILD);
    pass('GET /app-photos.js serves the toolbar helpers',
        spotJs.status === 200 &&
        spotJs.body.indexOf('function photoLbNav') >= 0 &&
        spotJs.body.indexOf('function photoLbToggleLoupe') >= 0,
        'HTTP ' + spotJs.status);
    var spotIdx = await httpGetText(PAGE_PORT, '/index.html');
    pass('GET /index.html points at the toolbar build',
        spotIdx.status === 200 && spotIdx.body.indexOf('app-photos.js?v=' + BUILD) >= 0,
        'HTTP ' + spotIdx.status);
    var live5500 = null;
    try {
        live5500 = await new Promise(function (resolve, reject) {
            var req = http.get({ host: '127.0.0.1', port: 5500, path: '/index.html', timeout: 2500 }, function (r) {
                var d = '';
                r.on('data', function (c) { d += c; });
                r.on('end', function () { resolve({ status: r.statusCode, body: d }); });
            });
            req.on('error', reject);
            req.on('timeout', function () { req.destroy(); reject(new Error('timeout')); });
        });
        pass('clinic page on :5500 serves the same script when it is up',
            live5500.status === 200 && live5500.body.indexOf('app-photos.js?v=' + BUILD) >= 0,
            'HTTP ' + live5500.status);
    } catch (e) {
        pass('clinic page on :5500 (optional)', true, 'not running');
        live5500 = null;
    }

    console.log('\n=== API (read-only, anon) ===');
    var sb = readSbConfig(read('app.js'));
    var ph = await fetch(sb.url.replace(/\/$/, '') + '/rest/v1/photos?select=id,category&limit=8', {
        headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
    });
    pass('photos rows still readable for the lightbox',
        ph.status === 200,
        'HTTP ' + ph.status);

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        try { server.close(); } catch (e) { /* ignore */ }
        finish(1);
        return;
    }
    var profile = path.join(os.tmpdir(), 'cs-photo-lb-toolbar-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    fs.mkdirSync(profile, { recursive: true });
    var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/index.html?_lr=' + BUILD;
    var proc = child_process.spawn(CHROME, [
        '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + profile,
        '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-popup-blocking',
        '--host-resolver-rules=MAP xray-ai.test 127.0.0.1',
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
        await sleep(800);

        var live = await cdp.js('(async function(){' +
            'const wait=function(ms){return new Promise(function(r){setTimeout(r,ms);});};' +
            'const deadline=Date.now()+20000;' +
            'while(Date.now()<deadline){ if(typeof openPhotoLightbox==="function" && typeof photoLbNav==="function") break; await wait(200); }' +
            'const out={ ready: typeof photoLbNav==="function" };' +
            'if(!out.ready) return out;' +
            'var login=document.getElementById("loginOverlay"); if(login) login.style.display="none";' +
            'window.sv=function(id,val){ var el=document.getElementById(id); if(el && "value" in el) el.value=val==null?"":String(val); };' +
            'window.openModal=function(id){ var m=document.getElementById(id); if(m) m.style.display="block"; };' +
            'window.mediaTr=window.mediaTr||function(k){ return k; };' +
            'window.photoBareUrl=window.photoBareUrl||function(x){ return (x&&x.public_url)||""; };' +
            'window.photoDisplayUrl=window.photoDisplayUrl||function(x){ return (x&&x.public_url)||""; };' +
            'window.photoLbFillContext=function(){};' +
            'var pix="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";' +
            'window.photoFiltered=[' +
            '{id:"p1", category:"Before", file_path:"a.jpg", public_url:pix, taken_date:"2024-01-01"},' +
            '{id:"p2", category:"After", file_path:"b.jpg", public_url:pix, taken_date:"2024-06-01"}' +
            '];' +
            'window.photoAllRecords=window.photoFiltered.slice();' +
            'try { openPhotoLightbox(0); } catch (err) { out.openErr=String(err&&err.message||err)+" typeofSv="+typeof sv+" w="+typeof window.sv; }' +
            'var modal=document.getElementById("photoLightbox"); if(modal) modal.style.display="block";' +
            'out.prev=!!document.getElementById("photoLbPrevBtn");' +
            'out.next=!!document.getElementById("photoLbNextBtn");' +
            'out.loupeBtn=!!document.getElementById("photoLbLoupeBtn");' +
            'out.sharp=!!document.getElementById("photoLbSharpSlider");' +
            'out.resetTune=!!document.querySelector("#photoLbRasterStrip [onclick=\\"photoLbResetTune()\\"]");' +
            'out.id0=photoLbCurrentId;' +
            'photoLbNav(1);' +
            'out.id1=photoLbCurrentId;' +
            'photoLbSetSharpness(40);' +
            'out.sharpVal=(document.getElementById("photoLbSharpVal")||{}).textContent;' +
            'out.filt=photoLbCssFilter();' +
            'photoLbToggleLoupe();' +
            'out.loupeOn=phLbLoupeActive===true && !document.getElementById("photoLbLoupe").hidden;' +
            'photoLbLoupeStop();' +
            'out.loupeOff=phLbLoupeActive===false;' +
            'photoLbResetTune();' +
            'out.sharpAfter=(document.getElementById("photoLbSharpVal")||{}).textContent;' +
            'out.filtAfter=photoLbCssFilter();' +
            'return out;' +
            '})()', true, 40000);

        pass('live: photo lightbox helpers loaded', live && live.ready === true);
        if (live && live.ready) {
            pass('live: toolbar shows prev, next, loupe, sharpness and reset tune',
                live.prev === true && live.next === true && live.loupeBtn === true &&
                live.sharp === true && live.resetTune === true,
                JSON.stringify({ prev: live.prev, next: live.next, loupe: live.loupeBtn, sharp: live.sharp, reset: live.resetTune }));
            pass('live: next walks to the following photo',
                live.id0 === 'p1' && live.id1 === 'p2',
                JSON.stringify({ from: live.id0, to: live.id1 }));
            pass('live: sharpness updates the filter; reset tune clears it',
                live.sharpVal === '40' && /photoLbSharpenFx/.test(live.filt || '') &&
                live.sharpAfter === '0' && !/photoLbSharpenFx/.test(live.filtAfter || ''),
                JSON.stringify({ val: live.sharpVal, filt: live.filt, after: live.sharpAfter, filtAfter: live.filtAfter }));
            pass('live: loupe turns on and off',
                live.loupeOn === true && live.loupeOff === true,
                JSON.stringify({ on: live.loupeOn, off: live.loupeOff }));
        }

        if (live5500 && live5500.status === 200) {
            await cdp.call('Page.navigate', { url: 'http://xray-ai.test:5500/index.html?_lr=' + BUILD });
            await sleep(1000);
            var clinic = await cdp.js('(async function(){' +
                'const wait=function(ms){return new Promise(function(r){setTimeout(r,ms);});};' +
                'const deadline=Date.now()+20000;' +
                'while(Date.now()<deadline){ if(typeof photoLbNav==="function" && typeof photoLbToggleLoupe==="function") break; await wait(200); }' +
                'return { ready: typeof photoLbNav==="function", build: window.__JSM_BUILD, prev:!!document.getElementById("photoLbPrevBtn"), loupe:!!document.getElementById("photoLbLoupeBtn"), sharp:!!document.getElementById("photoLbSharpSlider") };' +
                '})()', true, 25000);
            pass('live clinic :5500: photo lightbox toolbar helpers loaded',
                clinic && clinic.ready === true && clinic.prev === true && clinic.loupe === true && clinic.sharp === true,
                JSON.stringify(clinic));
        }
    } catch (e) {
        pass('CDP live page', false, e && e.message ? e.message : String(e));
    } finally {
        try { if (ws) ws.close(); } catch (e2) { /* ignore */ }
        try { if (proc) proc.kill(); } catch (e3) { /* ignore */ }
        try { server.close(); } catch (e4) { /* ignore */ }
    }

    finish(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
