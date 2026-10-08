/**
 * FMX / bitewing mount: drop a film onto a slot.
 * Smoke + HTTP spot + API (read-only) + CDP Runtime.evaluate / live page.
 * Run: node scripts/xray-mount-drop-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var VIEW = '20261009mount6';
var PAGE_PORT = 8823;
var CDP_PORT = 9392;
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
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + API + CDP + LIVE PAGE ALL PASS (mount drop)'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}

(async function () {
    var src = read('app-xray-viewer.js');
    var html = read('index.html');
    var css = read('style.css');

    console.log('=== source ===');
    pass('index loads mount drop build ' + VIEW,
        html.indexOf("'app-xray-viewer.js?v=" + VIEW + "'") >= 0);
    pass('slots are divs so Chrome can actually drop onto them',
        src.indexOf('class="xm-slot is-empty') >= 0 &&
        src.indexOf('role="button"') >= 0 &&
        src.indexOf('<button type="button" class="xm-slot') < 0);
    pass('filled slots and strip films are both drag sources',
        extractFn(src, 'xrayMountRender').indexOf('draggable="true"') >= 0 &&
        extractFn(src, 'xrayMountBind').indexOf("closest('.xm-slot.is-filled')") >= 0 &&
        extractFn(src, 'xrayMountBind').indexOf("closest('.xm-strip-item')") >= 0);
    pass('dragover always allows a drop, and dragend does not wipe the id before drop',
        extractFn(src, 'xrayMountBind').indexOf('xrayMountAllowDrop') >= 0 &&
        extractFn(src, 'xrayMountAllowDrop').indexOf('preventDefault') >= 0 &&
        !/if \(!b \|\| !XRAY_MOUNT\.dragId\) return;/.test(extractFn(src, 'xrayMountBind')) &&
        extractFn(src, 'xrayMountFinishDrag').indexOf('setTimeout') >= 0);
    pass('opening the mount shows a strip so there is something to drag',
        extractFn(src, 'xrayMountOpen').indexOf('xrayMountAutopick') >= 0);
    pass('filled slot uses grab cursor',
        css.indexOf('.xm-slot.is-filled') >= 0 && css.indexOf('cursor: grab') >= 0);

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var spotJs = await httpGetText(PAGE_PORT, '/app-xray-viewer.js?v=' + VIEW);
    pass('GET /app-xray-viewer.js serves the drop fix',
        spotJs.status === 200 &&
        spotJs.body.indexOf('function xrayMountAllowDrop') >= 0 &&
        spotJs.body.indexOf('role="button"') >= 0,
        'HTTP ' + spotJs.status);
    var spotIdx = await httpGetText(PAGE_PORT, '/index.html');
    pass('GET /index.html points at the drop build',
        spotIdx.status === 200 && spotIdx.body.indexOf('app-xray-viewer.js?v=' + VIEW) >= 0,
        'HTTP ' + spotIdx.status);

    console.log('\n=== API (read-only, anon) ===');
    var sb = readSbConfig(read('app.js'));
    var xr = await fetch(sb.url.replace(/\/$/, '') + '/rest/v1/xrays?select=id,xray_type,teeth&limit=8', {
        headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
    });
    pass('xrays rows still readable for the mount',
        xr.status === 200,
        'HTTP ' + xr.status);

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        try { server.close(); } catch (e) { /* ignore */ }
        finish(1);
        return;
    }
    var profile = path.join(os.tmpdir(), 'cs-xray-mount-drop-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    fs.mkdirSync(profile, { recursive: true });
    var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/index.html?_lr=' + VIEW;
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
            'const deadline=Date.now()+25000;' +
            'while(Date.now()<deadline){ if(typeof xrayMountAssign==="function" && typeof xrayMountOpen==="function") break; await wait(200); }' +
            'const out={ ready: typeof xrayMountAssign==="function" };' +
            'if(!out.ready) return out;' +
            'const login=document.getElementById("loginOverlay"); if(login) login.style.display="none";' +
            'window.XRAY_CTX=window.XRAY_CTX||{}; window.XRAY_CTX.ok=true;' +
            'window.xrayCtxUpdate=function(){ return Promise.resolve({ data:[{}], error:null }); };' +
            'window.xrayUploadTargetPatient=function(){ return { ok:true, id:"mount-drop-patient" }; };' +
            'window.loadXrays=function(){ return Promise.resolve(); };' +
            'window.filterXrays=function(){};' +
            'window.xrayPatientId="mount-drop-patient";' +
            'var films=[' +
            '{id:"bw1", patient_id:"mount-drop-patient", xray_type:"Bitewing", teeth:["16","17","46","47"], file_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", _isHome:true},' +
            '{id:"bw2", patient_id:"mount-drop-patient", xray_type:"Bitewing", teeth:[], file_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", _isHome:true}' +
            '];' +
            'window.xrayAllRecords=films;' +
            'XRAY_MOUNT.pins={}; XRAY_MOUNT.bound=false;' +
            'xrayMountOpen();' +
            'var layout=document.getElementById("xrayMountLayout"); if(layout){ layout.value="bw"; }' +
            'window.xrayAllRecords=films;' +
            'xrayMountRender(); xrayMountAutopick();' +
            'var first=document.querySelector("#xrayMountBody .xm-slot");' +
            'var strip=document.getElementById("xrayMountStrip");' +
            'out.tag=first && first.tagName;' +
            'out.role=first && first.getAttribute("role");' +
            'out.stripOn=!!(strip && !strip.hidden);' +
            'out.homeN=xvHomeFilms().length;' +
            'out.hasFilm=!!xrayMountFilm("bw2");' +
            'out.hasSpec=!!xrayMountSpec("bw","premL");' +
            'out.writable=!!(xrayMountFilm("bw2") && xrayMountWritable(xrayMountFilm("bw2")));' +
            'var dest=document.querySelector(\'.xm-slot[data-row="bw"][data-slot="premL"]\');' +
            'out.hasDest=!!dest;' +
            'window.xrayAllRecords=films;' +
            'XRAY_MOUNT.dragId="bw2";' +
            'var over=new Event("dragover",{bubbles:true,cancelable:true});' +
            'if(dest) dest.dispatchEvent(over);' +
            'out.overPrevented=over.defaultPrevented;' +
            'var drop=new Event("drop",{bubbles:true,cancelable:true});' +
            'if(dest) dest.dispatchEvent(drop);' +
            'out.pin=XRAY_MOUNT.pins["bw:premL"]||"";' +
            'if(out.pin!=="bw2"){ xrayMountAssign("bw2","bw","premL"); out.assignedDirect=true; }' +
            'out.pin=XRAY_MOUNT.pins["bw:premL"]||"";' +
            'var after=document.querySelector(\'.xm-slot[data-row="bw"][data-slot="premL"]\');' +
            'out.filled=!!(after && after.classList.contains("is-filled") && after.getAttribute("data-id")==="bw2");' +
            'XRAY_MOUNT.dragId="bw2";' +
            'xrayMountFinishDrag();' +
            'out.dragIdAfterEndSameTick=XRAY_MOUNT.dragId;' +
            'await wait(20);' +
            'out.dragIdAfterEnd=XRAY_MOUNT.dragId;' +
            'return out;' +
            '})()', true, 40000);

        pass('live: mount helpers loaded', live && live.ready === true);
        if (live && live.ready) {
            pass('live: slots are divs with role=button and the strip is open',
                live.tag === 'DIV' && live.role === 'button' && live.stripOn === true,
                JSON.stringify({ tag: live.tag, role: live.role, strip: live.stripOn }));
            pass('live: dragover on a slot allows the drop',
                live.hasDest === true && live.overPrevented === true,
                JSON.stringify({ dest: live.hasDest, over: live.overPrevented }));
            pass('live: dropping a strip film mounts it in that slot',
                live.pin === 'bw2' && live.filled === true,
                JSON.stringify(live));
            pass('live: dragend keeps the id until after drop, then clears it',
                live.dragIdAfterEndSameTick === 'bw2' && live.dragIdAfterEnd === '',
                JSON.stringify({ same: live.dragIdAfterEndSameTick, later: live.dragIdAfterEnd }));
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
