/**
 * Photos / Docs orthodontic board: lossless 9-frame PNG composite
 * and before/after PDF with patient info.
 * Smoke + HTTP spot + API (read-only) + CDP Runtime.evaluate / live page.
 * Run: node scripts/photo-ortho-export-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var ORTHO_JS = '20261008ortho2';
var PAGE_PORT = 8812;
var CDP_PORT = 9381;
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

function i18nHasAll(src, key) {
    var i = src.indexOf("'" + key + "':");
    if (i < 0) return false;
    var end = src.indexOf("\n        '", i + 5);
    var block = src.slice(i, end < 0 ? i + 800 : end);
    return block.indexOf('en:') >= 0 && block.indexOf("'zh-CN':") >= 0 && block.indexOf("'zh-Hant':") >= 0;
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
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + API + CDP + LIVE PAGE ALL PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}

(async function () {
    var photos = read('app-photos.js');
    var i18n = read('app-i18n-extra.js');
    var html = read('index.html');
    var css = read('style.css');
    var composite = extractFn(photos, 'photoOrthoComposite');
    var exportPdf = extractFn(photos, 'photoOrthoExportPdf');
    var drawSet = extractFn(photos, 'photoOrthoDrawSet');
    var drawPdf = extractFn(photos, 'photoOrthoDrawPdfPage');
    var jpegPdf = extractFn(photos, 'photoOrthoJpegPageToPdf');
    var metaFn = extractFn(photos, 'photoOrthoPatientMeta');
    var pickSave = extractFn(photos, 'photoOrthoPickSave');

    console.log('=== source ===');
    pass('index loads the ortho export photos script',
        html.indexOf("'app-photos.js?v=" + ORTHO_JS + "'") >= 0 &&
        html.indexOf("var BUILD = '" + ORTHO_JS + "'") >= 0);
    pass('index loads the ortho export i18n script',
        html.indexOf("'app-i18n-extra.js?v=" + ORTHO_JS + "'") >= 0);
    pass('Photos / Docs board has composite and PDF buttons',
        html.indexOf('id="photoOrthoCompBtn"') >= 0 &&
        html.indexOf('onclick="photoOrthoComposite()"') >= 0 &&
        html.indexOf('id="photoOrthoPdfBtn"') >= 0 &&
        html.indexOf('onclick="photoOrthoExportPdf()"') >= 0 &&
        html.indexOf('data-i18n="media.ortho.composite"') >= 0 &&
        html.indexOf('data-i18n="media.ortho.pdf"') >= 0);
    pass('composite writes a lossless PNG and opens a folder picker',
        composite.indexOf("showDirectoryPicker") >= 0 &&
        composite.indexOf("'image/png'") >= 0 &&
        composite.indexOf('photoOrthoToBlob') >= 0 &&
        composite.indexOf('image/jpeg') < 0);
    pass('PDF export opens a save-location picker and includes patient meta',
        exportPdf.indexOf('photoOrthoPickSave') >= 0 &&
        exportPdf.indexOf("'application/pdf'") >= 0 &&
        exportPdf.indexOf('photoOrthoDrawPdfPage') >= 0 &&
        exportPdf.indexOf('photoOrthoJpegPageToPdf') >= 0);
    pass('the 9-frame mosaic is 3x3 and the PDF page carries patient lines',
        drawSet.indexOf('cols = 3') >= 0 &&
        drawSet.indexOf('rows = 3') >= 0 &&
        drawPdf.indexOf('media.ortho.pdfTitle') >= 0 &&
        drawPdf.indexOf('meta.name') >= 0 &&
        drawPdf.indexOf('meta.no') >= 0 &&
        drawPdf.indexOf('meta.dob') >= 0 &&
        metaFn.indexOf('full_name') >= 0 &&
        metaFn.indexOf('patient_no') >= 0 &&
        metaFn.indexOf('formatDobAge') >= 0);
    pass('PDF embeds a JPEG page and the save picker is a location dialog',
        jpegPdf.indexOf('%PDF-1.4') >= 0 &&
        jpegPdf.indexOf('/DCTDecode') >= 0 &&
        pickSave.indexOf('showSaveFilePicker') >= 0);
    pass('board CSS has composite and PDF buttons',
        css.indexOf('.ortho-comp-btn') >= 0 && css.indexOf('.ortho-pdf-btn') >= 0);
    ['media.ortho.composite', 'media.ortho.pdf', 'media.ortho.compositeOk',
        'media.ortho.pdfOk', 'media.ortho.noPins', 'media.ortho.pdfTitle',
        'media.ortho.lblPatient', 'media.ortho.exportCancel'].forEach(function (key) {
        pass('i18n ' + key + ' en / zh-CN / zh-Hant', i18nHasAll(i18n, key));
    });

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var spotIdx = await httpGetText(PAGE_PORT, '/index.html');
    pass('GET /index.html serves the ortho export markup and script tags',
        spotIdx.status === 200 &&
        spotIdx.body.indexOf('app-photos.js?v=' + ORTHO_JS) >= 0 &&
        spotIdx.body.indexOf('app-i18n-extra.js?v=' + ORTHO_JS) >= 0 &&
        spotIdx.body.indexOf('photoOrthoCompBtn') >= 0 &&
        spotIdx.body.indexOf('photoOrthoPdfBtn') >= 0,
        'HTTP ' + spotIdx.status);
    var spotJs = await httpGetText(PAGE_PORT, '/app-photos.js?v=' + ORTHO_JS);
    pass('GET /app-photos.js serves composite and PDF export',
        spotJs.status === 200 &&
        spotJs.body.indexOf('function photoOrthoComposite') >= 0 &&
        spotJs.body.indexOf('function photoOrthoExportPdf') >= 0 &&
        spotJs.body.indexOf('showDirectoryPicker') >= 0,
        'HTTP ' + spotJs.status);
    var live5500 = null;
    try { live5500 = await httpGetText(5500, '/app-photos.js?v=' + ORTHO_JS); } catch (e) { live5500 = null; }
    pass('clinic page on :5500 serves the same ortho export script when it is up',
        !live5500 || (live5500.status === 200 && live5500.body.indexOf('function photoOrthoComposite') >= 0),
        live5500 ? ('HTTP ' + live5500.status) : '5500 not answering');

    console.log('\n=== API (read-only, anon) ===');
    var sb = readSbConfig(read('app.js'));
    var photoUrl = sb.url.replace(/\/$/, '') +
        '/rest/v1/photos?select=id,patient_id,category,public_url,file_path&limit=8';
    var photoRes = await fetch(photoUrl, {
        headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
    });
    var photoJson = await photoRes.json();
    pass('photos table readable for the ortho board',
        photoRes.status === 200 && Array.isArray(photoJson),
        'HTTP ' + photoRes.status + (Array.isArray(photoJson) ? (', ' + photoJson.length + ' rows') : ''));
    var patUrl = sb.url.replace(/\/$/, '') +
        '/rest/v1/patients?select=id,full_name,patient_no,dob&limit=4';
    var patRes = await fetch(patUrl, {
        headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
    });
    var patJson = await patRes.json();
    pass('patients table readable for PDF header fields',
        patRes.status === 200 && Array.isArray(patJson),
        'HTTP ' + patRes.status);
    var withInfo = Array.isArray(patJson) ? patJson.filter(function (r) {
        return r && r.full_name && r.patient_no;
    }) : [];
    pass('API patient rows carry name and chart no used on the PDF',
        patJson.length === 0 || withInfo.length > 0,
        withInfo.length + '/' + (Array.isArray(patJson) ? patJson.length : 0));

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        finish(1);
        return;
    }
    var profile = path.join(os.tmpdir(), 'cs-photo-ortho-export-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    fs.mkdirSync(profile, { recursive: true });
    var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/index.html?_lr=' + ORTHO_JS;
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
            'while(Date.now()<deadline){ if(typeof photoOrthoComposite==="function" && typeof photoOrthoExportPdf==="function") break; await wait(200); }' +
            'const out={ ready: typeof photoOrthoComposite==="function", build: window.__JSM_BUILD, notes:[], files:{} };' +
            'if(!out.ready) return out;' +
            'const origNotify=typeof mediaNotify==="function"?mediaNotify:function(){};' +
            'mediaNotify=function(msg,kind){ out.notes.push({msg:String(msg),kind:kind||""}); origNotify(msg,kind); };' +
            'const login=document.getElementById("loginOverlay"); if(login) login.style.display="none";' +
            'const sec=document.getElementById("consultationSection"); if(sec){ sec.style.display="block"; sec.removeAttribute("aria-hidden"); }' +
            'const pane=document.getElementById("con-photos"); if(pane) pane.style.display="block";' +
            'const main=document.getElementById("photoMainContent"); if(main) main.style.display="block";' +
            'function swatch(color,label){ var c=document.createElement("canvas"); c.width=640; c.height=480; var g=c.getContext("2d"); g.fillStyle=color; g.fillRect(0,0,640,480); g.fillStyle="#fff"; g.font="bold 42px sans-serif"; g.fillText(label,20,250); return c.toDataURL("image/png"); }' +
            'window.photoPatientId="ortho-smoke-patient";' +
            'window.photoPatientData={ full_name:"Chan Tai Man", patient_no:"P1001", dob:"1990-05-01" };' +
            'window.photoAllRecords=[' +
            '{id:"b1", file_path:"b1.png", public_url:swatch("#0ea5e9","Before face") },' +
            '{id:"b2", file_path:"b2.png", public_url:swatch("#0369a1","Before smile") },' +
            '{id:"a1", file_path:"a1.png", public_url:swatch("#16a34a","After face") },' +
            '{id:"a2", file_path:"a2.png", public_url:swatch("#15803d","After smile") }' +
            '];' +
            'localStorage.setItem("jsm_ortho_mount_v1:ortho-smoke-patient", JSON.stringify({ before:{face:"b1",smile:"b2"}, after:{face:"a1",smile:"a2"} }));' +
            'photoOrthoToggle(true);' +
            'out.btnComp=!!document.getElementById("photoOrthoCompBtn");' +
            'out.btnPdf=!!document.getElementById("photoOrthoPdfBtn");' +
            'out.btnSlide=!!document.getElementById("photoOrthoSlideBtn");' +
            'out.panelOpen=!document.getElementById("photoOrthoPanel").hasAttribute("hidden");' +
            'out.tiles=document.querySelectorAll("#photoOrthoSets .ortho-tile").length;' +
            'out.filled=document.querySelectorAll("#photoOrthoSets .ortho-tile.is-filled").length;' +
            'out.compLabel=(document.getElementById("photoOrthoCompBtn")||{}).textContent||"";' +
            'out.pdfLabel=(document.getElementById("photoOrthoPdfBtn")||{}).textContent||"";' +
            'out.meta=photoOrthoPatientMeta();' +
            'function fakeHandle(name){' +
            '  return { createWritable:function(){ var chunks=[]; return Promise.resolve({' +
            '    write:function(blob){ return (blob.arrayBuffer?blob.arrayBuffer():Promise.resolve(blob)).then(function(buf){ chunks.push(buf instanceof Uint8Array?buf:new Uint8Array(buf)); }); },' +
            '    close:function(){ var n=0; chunks.forEach(function(c){ n+=c.length; }); var u=new Uint8Array(n); var p=0; chunks.forEach(function(c){ u.set(c,p); p+=c.length; }); out.files[name]=Array.from(u.slice(0,24)).concat([u.length]); return Promise.resolve(); }' +
            '  }); } };' +
            '}' +
            'window.showDirectoryPicker=function(){ return Promise.resolve({ getFileHandle:function(name){ return Promise.resolve(fakeHandle(name)); } }); };' +
            'window.showSaveFilePicker=function(opts){ out.suggested=opts&&opts.suggestedName||""; return Promise.resolve(fakeHandle(out.suggested||"out.bin")); };' +
            'out.emptyNotes=[];' +
            'var keep=localStorage.getItem("jsm_ortho_mount_v1:ortho-smoke-patient");' +
            'localStorage.setItem("jsm_ortho_mount_v1:ortho-smoke-patient", JSON.stringify({before:{},after:{}}));' +
            'out.notes.length=0; photoOrthoComposite(); photoOrthoExportPdf();' +
            'out.emptyNotes=out.notes.slice();' +
            'localStorage.setItem("jsm_ortho_mount_v1:ortho-smoke-patient", keep);' +
            'out.notes.length=0; out.files={};' +
            'document.getElementById("photoOrthoCompBtn").click();' +
            'var t1=Date.now()+12000; while(Date.now()<t1){ if(!document.getElementById("photoOrthoCompBtn").disabled && Object.keys(out.files).length>=2) break; await wait(50); }' +
            'out.pngNames=Object.keys(out.files);' +
            'out.png=[];' +
            'out.pngNames.forEach(function(n){ var a=out.files[n]; out.png.push({ name:n, png:a[0]===137&&a[1]===80&&a[2]===78&&a[3]===71, jpeg:a[0]===255&&a[1]===216, w:(a[16]<<24)|(a[17]<<16)|(a[18]<<8)|a[19], h:(a[20]<<24)|(a[21]<<16)|(a[22]<<8)|a[23], bytes:a[a.length-1] }); });' +
            'out.compNotes=out.notes.slice();' +
            'out.notes.length=0; out.files={};' +
            'document.getElementById("photoOrthoPdfBtn").click();' +
            'var t2=Date.now()+12000; while(Date.now()<t2){ if(!document.getElementById("photoOrthoPdfBtn").disabled && Object.keys(out.files).length>=1) break; await wait(50); }' +
            'out.pdfNames=Object.keys(out.files);' +
            'out.pdf=[];' +
            'out.pdfNames.forEach(function(n){ var a=out.files[n]; var head=String.fromCharCode.apply(null,a.slice(0,8)); out.pdf.push({ name:n, head:head, bytes:a[a.length-1] }); });' +
            'out.pdfNotes=out.notes.slice();' +
            'out.suggestedPdf=out.suggested;' +
            'window.showDirectoryPicker=function(){ var e=new Error("cancel"); e.name="AbortError"; return Promise.reject(e); };' +
            'out.notes.length=0; photoOrthoComposite(); await wait(80);' +
            'out.cancelNotes=out.notes.slice();' +
            'out.compIdle=document.getElementById("photoOrthoCompBtn").textContent;' +
            'out.pdfIdle=document.getElementById("photoOrthoPdfBtn").textContent;' +
            'out.compDisabled=!!document.getElementById("photoOrthoCompBtn").disabled;' +
            'localStorage.removeItem("jsm_ortho_mount_v1:ortho-smoke-patient");' +
            'return out;' +
            '})()', true, 45000);

        pass('live: ortho export functions loaded on the clinic page',
            !!(live && live.ready && live.build === ORTHO_JS),
            live ? ('build=' + live.build) : 'no live');
        if (live && live.ready) {
            pass('live: board opens with composite, PDF, and slideshow buttons',
                live.btnComp === true && live.btnPdf === true && live.btnSlide === true &&
                live.panelOpen === true && live.tiles === 18 && live.filled === 4,
                'tiles=' + live.tiles + ' filled=' + live.filled +
                ' labels=' + live.compLabel + ' / ' + live.pdfLabel);
            pass('live: PDF header reads name, chart no, and DOB',
                !!(live.meta && live.meta.name === 'Chan Tai Man' && live.meta.no === 'P1001' &&
                    String(live.meta.dob || '').indexOf('1990') >= 0),
                JSON.stringify(live.meta));
            pass('live: empty board refuses both exports',
                (live.emptyNotes || []).length >= 2 &&
                (live.emptyNotes || []).every(function (n) { return /Place at least one photo/i.test(n.msg); }),
                JSON.stringify(live.emptyNotes));
            var pngOk = (live.png || []).filter(function (p) {
                return p.png && !p.jpeg && p.w === 3180 && p.h === 3340 && p.bytes > 1000;
            });
            pass('live: Create composite photo writes two lossless 3x3 PNGs via the folder picker',
                pngOk.length === 2 &&
                (live.pngNames || []).some(function (n) { return /before\\.png$/i.test(n) || /before.png$/i.test(n); }) &&
                (live.pngNames || []).some(function (n) { return /after\\.png$/i.test(n) || /after.png$/i.test(n); }),
                JSON.stringify(live.png));
            pass('live: composite filenames include the patient',
                (live.pngNames || []).every(function (n) { return /P1001/.test(n) && /Chan Tai Man/.test(n); }),
                JSON.stringify(live.pngNames));
            var pdfName = String(live.suggestedPdf || (live.pdf[0] && live.pdf[0].name) || '');
            pass('live: Export PDF writes a PDF named with the patient',
                (live.pdf || []).length === 1 &&
                String((live.pdf[0] && live.pdf[0].head) || '').indexOf('%PDF-1') === 0 &&
                /P1001-Chan Tai Man-ortho\.pdf/.test(pdfName),
                JSON.stringify({ pdf: live.pdf, suggested: live.suggestedPdf }));
            pass('live: cancel on the location picker is not treated as a hard error',
                (live.cancelNotes || []).some(function (n) { return /cancel/i.test(n.msg); }),
                JSON.stringify(live.cancelNotes));
            pass('live: buttons return to idle after export',
                /composite/i.test(live.compIdle || '') && /PDF/i.test(live.pdfIdle || '') && live.compDisabled === false,
                live.compIdle + ' / ' + live.pdfIdle);
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
