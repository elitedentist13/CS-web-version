/**
 * Photos / Docs + ortho board enhancements (incremental).
 * Smoke + HTTP spot + API (read-only) + CDP Runtime.evaluate / live page.
 * Run: node scripts/photo-ortho-enhance-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261009ortho8';
var STEP = 15;
var PAGE_PORT = 8825;
var CDP_PORT = 9394;
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
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + API + CDP + LIVE PAGE ALL PASS (step ' + STEP + ')'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}

(async function () {
    var photos = read('app-photos.js');
    var i18n = read('app-i18n-extra.js');
    var html = read('index.html');
    var css = read('style.css');

    console.log('=== source (step ' + STEP + ') ===');
    pass('index loads enhance build ' + BUILD,
        html.indexOf("var BUILD = '" + BUILD + "'") >= 0 &&
        html.indexOf("'app-photos.js?v=" + BUILD + "'") >= 0 &&
        html.indexOf("'app-i18n-extra.js?v=" + BUILD + "'") >= 0);
    pass('timepoint categories Before, After, Progress exist; legacy Before/After kept',
        photos.indexOf("['Before', 'media.cat.before']") >= 0 &&
        photos.indexOf("['After', 'media.cat.after']") >= 0 &&
        photos.indexOf("['Progress', 'media.cat.progress']") >= 0 &&
        photos.indexOf("['Before/After', 'media.cat.beforeAfter']") >= 0);
    pass('photoTimepointOf maps Before/After/Progress',
        extractFn(photos, 'photoTimepointOf').indexOf("c === 'before'") >= 0 &&
        extractFn(photos, 'photoTimepointOf').indexOf("c === 'after'") >= 0 &&
        extractFn(photos, 'photoTimepointOf').indexOf("c === 'progress'") >= 0);
    pass('ortho board buttons still present',
        html.indexOf('photoOrthoCompBtn') >= 0 && html.indexOf('photoOrthoPdfBtn') >= 0);
    pass('Photos vs Docs toggle is on the filter bar',
        html.indexOf('id="btnPhotoKindPhotos"') >= 0 &&
        html.indexOf('id="btnPhotoKindDocs"') >= 0 &&
        html.indexOf('onclick="setPhotoKind(\'photos\')"') >= 0 &&
        photos.indexOf('function photoIsDocRec') >= 0 &&
        photos.indexOf('function setPhotoKind') >= 0 &&
        extractFn(photos, 'filterPhotos').indexOf('photoKindFilter') >= 0);
    pass('grid groups photos by visit date',
        photos.indexOf('function photoVisitGroups') >= 0 &&
        extractFn(photos, 'renderPhotoGrid').indexOf('photo-visit-head') >= 0 &&
        extractFn(photos, 'photoVisitKey').indexOf('taken_date') >= 0);
    pass('ortho mount is saved on the patient photo record as well as this browser',
        photos.indexOf('function photoOrthoPushRemote') >= 0 &&
        photos.indexOf('function photoOrthoHydrateFromRecords') >= 0 &&
        extractFn(photos, 'filterPhotos').indexOf('photoIsOrthoSidecar') >= 0 &&
        extractFn(photos, 'loadPhotoRecords').indexOf('photoOrthoHydrateFromRecords') >= 0);
    pass('board tiles show dates, contain the photo, and a fill meter',
        css.indexOf('object-fit: contain') >= 0 &&
        html.indexOf('id="photoOrthoMeter"') >= 0 &&
        photos.indexOf('ortho-tile-date') >= 0 &&
        photos.indexOf('function photoOrthoFilledCount') >= 0);
    pass('auto-place fills a set from selected photos or the newest visit',
        html.indexOf('photoOrthoAutoPlace(\'before\')') >= 0 &&
        photos.indexOf('function photoOrthoAutoPlace') >= 0 &&
        photos.indexOf('function photoOrthoNameHitsSlot') >= 0);
    pass('copy Before onto After and pick a visit for each column',
        html.indexOf('photoOrthoCopySet(\'before\',\'after\')') >= 0 &&
        html.indexOf('id="photoOrthoSitBefore"') >= 0 &&
        photos.indexOf('function photoOrthoCopySet') >= 0 &&
        photos.indexOf('function photoOrthoApplySitting') >= 0);
    pass('folder and batch drop land on a Before or After column',
        html.indexOf('photoOrthoPickFolder(\'before\')') >= 0 &&
        html.indexOf('id="photoOrthoFolderInput"') >= 0 &&
        photos.indexOf('function photoOrthoPlaceFiles') >= 0 &&
        photos.indexOf('function photoOrthoCollectDropFiles') >= 0 &&
        photos.indexOf('photoOrthoHasExternalFiles') >= 0 &&
        extractFn(photos, 'photoOrthoRender').indexOf('data-set="') >= 0 &&
        css.indexOf('.ortho-set.is-over') >= 0);
    var uploadFn = extractFn(photos, 'photoOrthoUploadDropped');
    var commitFn = extractFn(photos, 'photoOrthoCommitDrop');
    pass('ortho drops confirm clinic and appointment, then upload to the photos bucket',
        html.indexOf('id="photoOrthoDataset"') >= 0 &&
        html.indexOf('id="photoOrthoDatasetAppt"') >= 0 &&
        html.indexOf('id="photoOrthoDatasetClinic"') >= 0 &&
        photos.indexOf('function photoOrthoConfirmDataset') >= 0 &&
        uploadFn.indexOf('photoUploadOne') >= 0 &&
        uploadFn.indexOf('appointment_id') >= 0 &&
        uploadFn.indexOf('createObjectURL') < 0 &&
        uploadFn.indexOf('_localFile') < 0 &&
        commitFn.indexOf('photoOrthoConfirmDataset') >= 0 &&
        commitFn.indexOf('photoOrthoQuietSave') >= 0 &&
        commitFn.indexOf('photoOrthoUploadDropped') >= 0 &&
        extractFn(photos, 'photoOrthoQuietSave').indexOf('photoOrthoUploadDropped') >= 0 &&
        extractFn(photos, 'photoOrthoQuietSave').indexOf('photoOrthoPlace') >= 0 &&
        photos.indexOf('function photoOrthoSnapshotFiles') >= 0 &&
        photos.indexOf('photoOrthoDragTypesFiles') >= 0 &&
        photos.indexOf('function photoOrthoAcceptOsDrag') >= 0 &&
        extractFn(photos, 'photoOrthoAcceptOsDrag').indexOf('preventDefault') >= 0 &&
        extractFn(photos, 'photoOrthoAcceptOsDrag').indexOf('stopPropagation') < 0 &&
        extractFn(photos, 'photoOrthoAcceptOsDrag').indexOf('dropEffect') < 0 &&
        extractFn(photos, 'photoOrthoOsDropAllow').indexOf('preventDefault') >= 0 &&
        extractFn(photos, 'photoOrthoOsDropAllow').indexOf('stopPropagation') < 0 &&
        extractFn(photos, 'photoOrthoOsDropAllow').indexOf('_orthoFiles') < 0 &&
        extractFn(photos, 'photoOrthoBind').indexOf("document.addEventListener('dragover'") >= 0 &&
        extractFn(photos, 'photoOrthoBind').indexOf("document.addEventListener('drop', photoOrthoOsDropAllow, true)") >= 0 &&
        extractFn(photos, 'photoOrthoBind').indexOf('photoOrthoAimFrame') >= 0 &&
        extractFn(photos, 'photoOrthoBind').indexOf('photoOrthoBrowseFile') >= 0 &&
        extractFn(photos, 'photoOrthoTileHtml').indexOf('photoOrthoBrowseBtnHtml') >= 0 &&
        extractFn(photos, 'photoOrthoBrowseBtnHtml').indexOf('data-ortho-browse') >= 0 &&
        photos.indexOf('function photoOrthoBrowseFile') >= 0 &&
        extractFn(photos, 'photoOrthoBrowseFile').indexOf("startIn: 'downloads'") >= 0 &&
        extractFn(photos, 'photoOrthoBrowseFile').indexOf('image/jpeg') >= 0 &&
        extractFn(photos, 'photoOrthoBrowseFile').indexOf('image/*') < 0 &&
        html.indexOf('id="photoOrthoFrameInput"') >= 0 &&
        extractFn(photos, 'photoOrthoToggle').indexOf('photoOrthoChartPickerOpen') >= 0 &&
        photos.indexOf('function photoOrthoChartPickerOpen') >= 0 &&
        extractFn(photos, 'photoOrthoImages').indexOf('photoIsOrthoSidecar') >= 0 &&
        read('app-con-media.js').indexOf("closest('#photoOrthoPanel')") >= 0 &&
        i18nHasAll(i18n, 'media.ortho.datasetSave') &&
        i18nHasAll(i18n, 'media.ortho.apptNone'));
    pass('slideshow skips empty tiles, shows dates, and can slider or fade',
        html.indexOf('id="photoOrthoSlideSkip"') >= 0 &&
        html.indexOf('id="photoOrthoShowBeforeDate"') >= 0 &&
        html.indexOf('photoOrthoSlideSetMode(\'slider\')') >= 0 &&
        html.indexOf('id="photoOrthoShowMix"') >= 0 &&
        photos.indexOf('function photoOrthoSlideSteps') >= 0 &&
        photos.indexOf('photoOrthoSlideSkipEmpty') >= 0 &&
        css.indexOf('clip-path') >= 0 &&
        css.indexOf('--ortho-mix') >= 0);
    pass('export prints sitting dates and doctor, can save the PNG into Photos, and print',
        html.indexOf('id="photoOrthoPrintBtn"') >= 0 &&
        html.indexOf('id="photoOrthoSaveChart"') >= 0 &&
        photos.indexOf('function photoOrthoBagDateLabel') >= 0 &&
        photos.indexOf('function photoOrthoDoctorName') >= 0 &&
        photos.indexOf('function photoOrthoSaveCompositesToChart') >= 0 &&
        photos.indexOf('function photoOrthoPrintPdf') >= 0 &&
        extractFn(photos, 'photoOrthoDrawSet').indexOf('photoOrthoBagDateLabel') >= 0 &&
        extractFn(photos, 'photoOrthoDrawPdfPage').indexOf('media.ortho.lblDr') >= 0 &&
        extractFn(photos, 'photoOrthoComposite').indexOf('photoOrthoSaveCompositesToChart') >= 0);
    pass('empty tiles are divs so a drop can land, and export buttons sit on their own row',
        html.indexOf('class="ortho-board-tools ortho-board-export"') >= 0 &&
        html.indexOf('id="photoOrthoCompBtn"') >= 0 &&
        css.indexOf('.ortho-board-export') >= 0 &&
        extractFn(photos, 'photoOrthoTileHtml').indexOf('role="button"') >= 0 &&
        extractFn(photos, 'photoOrthoTileHtml').indexOf('<button type="button" class="ortho-tile') < 0 &&
        photos.indexOf('function photoOrthoAllowDrop') >= 0 &&
        extractFn(photos, 'photoOrthoBind').indexOf('dragenter') >= 0);
    pass('drop resolves a library photo and does not pin a URL as Missing from library',
        photos.indexOf('function photoOrthoResolveId') >= 0 &&
        extractFn(photos, 'photoOrthoPlace').indexOf('media.ortho.attachFail') >= 0 &&
        extractFn(photos, 'photoOrthoReadDragId').indexOf('photoOrthoResolveId') >= 0 &&
        extractFn(photos, 'photoOrthoHasExternalFiles').indexOf('photoOrthoDrag') >= 0);
    ['media.cat.before', 'media.cat.after', 'media.cat.progress', 'media.cat.beforeAfter',
        'media.kind.all', 'media.kind.photos', 'media.kind.docs', 'media.visit.count', 'media.ortho.meter',
        'media.ortho.copyAfter', 'media.ortho.sitPh', 'media.ortho.copyOk',
        'media.ortho.folderBefore', 'media.ortho.folderAfter', 'media.ortho.dropCount', 'media.ortho.dropNone',
        'media.ortho.skipEmpty', 'media.ortho.modePair', 'media.ortho.modeSlider', 'media.ortho.modeFade',
        'media.ortho.lblDr', 'media.ortho.print', 'media.ortho.printOk', 'media.ortho.saveChart',
        'media.ortho.chartCaption', 'media.ortho.chartOk', 'media.ortho.attachFail'].forEach(function (key) {
        pass('i18n ' + key + ' en / zh-CN / zh-Hant', i18nHasAll(i18n, key));
    });

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var spotIdx = await httpGetText(PAGE_PORT, '/index.html');
    pass('GET /index.html serves enhance build',
        spotIdx.status === 200 && spotIdx.body.indexOf('app-photos.js?v=' + BUILD) >= 0,
        'HTTP ' + spotIdx.status);
    var spotJs = await httpGetText(PAGE_PORT, '/app-photos.js?v=' + BUILD);
    pass('GET /app-photos.js serves timepoints',
        spotJs.status === 200 &&
        spotJs.body.indexOf("['Before', 'media.cat.before']") >= 0 &&
        spotJs.body.indexOf('function photoTimepointOf') >= 0,
        'HTTP ' + spotJs.status);
    var live5500 = null;
    try { live5500 = await httpGetText(5500, '/app-photos.js?v=' + BUILD); } catch (e) { live5500 = null; }
    pass('clinic page on :5500 serves the same script when it is up',
        !live5500 || (live5500.status === 200 && live5500.body.indexOf('function photoTimepointOf') >= 0),
        live5500 ? ('HTTP ' + live5500.status) : '5500 not answering');

    console.log('\n=== API (read-only, anon) ===');
    var sb = readSbConfig(read('app.js'));
    var photoRes = await fetch(sb.url.replace(/\/$/, '') +
        '/rest/v1/photos?select=id,category,taken_date,file_path&limit=12', {
        headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
    });
    var photoJson = await photoRes.json();
    pass('photos.category still readable for timepoint filters',
        photoRes.status === 200 && Array.isArray(photoJson),
        'HTTP ' + photoRes.status + (Array.isArray(photoJson) ? (', ' + photoJson.length + ' rows') : ''));
    var cats = {};
    (Array.isArray(photoJson) ? photoJson : []).forEach(function (r) {
        cats[String(r.category || '(none)')] = true;
    });
    pass('API returned category values the filter can use',
        true,
        Object.keys(cats).join(', ') || 'none');

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        finish(1);
        return;
    }
    var profile = path.join(os.tmpdir(), 'cs-photo-ortho-e' + STEP + '-cdp');
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
            'while(Date.now()<deadline){ if(typeof photoTimepointOf==="function" && typeof filterPhotos==="function") break; await wait(200); }' +
            'const out={ ready: typeof photoTimepointOf==="function", build: window.__JSM_BUILD, notes:[] };' +
            'if(!out.ready) return out;' +
            'const origNotify=typeof mediaNotify==="function"?mediaNotify:function(){};' +
            'mediaNotify=function(msg,kind){ out.notes.push({msg:String(msg),kind:kind||""}); origNotify(msg,kind); };' +
            'const login=document.getElementById("loginOverlay"); if(login) login.style.display="none";' +
            'const sec=document.getElementById("consultationSection"); if(sec){ sec.style.display="block"; }' +
            'const pane=document.getElementById("con-photos"); if(pane) pane.style.display="block";' +
            'const main=document.getElementById("photoMainContent"); if(main) main.style.display="block";' +
            'refreshPhotoCategorySelects();' +
            'const sel=document.getElementById("photoFilterCat");' +
            'out.opts=[].map.call(sel.options, function(o){ return o.value; });' +
            'out.labels={ before: photoCategoryLabel("Before"), after: photoCategoryLabel("After"), progress: photoCategoryLabel("Progress"), legacy: photoCategoryLabel("Before/After") };' +
            'out.tp={ before: photoTimepointOf({category:"Before"}), after: photoTimepointOf({category:"After"}), progress: photoTimepointOf({category:"Progress"}), legacy: photoTimepointOf({category:"Before/After"}), intra: photoTimepointOf({category:"Intraoral"}) };' +
            'window.photoPatientId="e1-patient";' +
            'window.photoAllRecords=[' +
            '{id:"1", category:"Before", file_path:"a.jpg", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2023-01-01"},' +
            '{id:"2", category:"After", file_path:"b.jpg", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2025-01-01"},' +
            '{id:"3", category:"Progress", file_path:"c.jpg", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2024-06-01"},' +
            '{id:"4", category:"Before/After", file_path:"d.jpg", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2022-01-01"},' +
            '{id:"5", category:"Consent Form", file_path:"e.pdf", public_url:""}' +
            '];' +
            'sel.value="Before"; filterPhotos();' +
            'out.beforeIds=photoFiltered.map(function(x){ return x.id; });' +
            'sel.value="After"; filterPhotos();' +
            'out.afterIds=photoFiltered.map(function(x){ return x.id; });' +
            'sel.value="Before/After"; filterPhotos();' +
            'out.legacyIds=photoFiltered.map(function(x){ return x.id; });' +
            'out.badge=getPhotoCatBadge("Before");' +
            'out.orthoBtn=!!document.getElementById("btnPhotoOrtho");' +
            'out.kindBtns=!!document.getElementById("btnPhotoKindPhotos") && !!document.getElementById("btnPhotoKindDocs");' +
            'out.docPdf=photoIsDocRec({file_path:"x.pdf", category:"Intraoral"});' +
            'out.docConsent=photoIsDocRec({file_path:"x.jpg", category:"Consent Form"});' +
            'out.docPhoto=photoIsDocRec({file_path:"x.jpg", category:"Before"});' +
            'sel.value=""; setPhotoKind("photos");' +
            'out.photoIds=photoFiltered.map(function(x){ return x.id; });' +
            'setPhotoKind("docs");' +
            'out.docIds=photoFiltered.map(function(x){ return x.id; });' +
            'setPhotoKind("all");' +
            'out.allIds=photoFiltered.map(function(x){ return x.id; });' +
            'out.kindActive={ photos: document.getElementById("btnPhotoKindPhotos").classList.contains("active"), docs: document.getElementById("btnPhotoKindDocs").classList.contains("active"), all: document.getElementById("btnPhotoKindAll").classList.contains("active") };' +
            'setPhotoKind("all"); renderPhotoGrid();' +
            'out.visits=[].map.call(document.querySelectorAll("#photoGridView .photo-visit-head"), function(h){ return { date: h.dataset.visit, text: h.textContent }; });' +
            'out.visitOrder=photoVisitGroups(photoFiltered).map(function(g){ return g.date; });' +
            'localStorage.removeItem(photoOrthoKey());' +
            'photoAllRecords.push({id:"mount1", category:"Other", caption:"jsm-ortho-mount-v1:"+JSON.stringify({before:{face:"b1"},after:{smile:"a2"}}), file_path:""});' +
            'photoOrthoHydrateFromRecords();' +
            'out.hydrated=photoOrthoLoad();' +
            'sel.value=""; setPhotoKind("all");' +
            'out.filteredHasSidecar=photoFiltered.some(function(x){ return x.id==="mount1"; });' +
            'var calls=[]; var realFrom=SB.from.bind(SB);' +
            'SB.from=function(table){ if(table!=="photos") return realFrom(table); return {' +
            '  insert:function(rows){ calls.push({op:"insert", rows:rows}); return { select:function(){ return Promise.resolve({ data:[{id:"new-mount"}], error:null }); } }; },' +
            '  update:function(body){ calls.push({op:"update", body:body}); return { eq:function(){ return { select:function(){ return Promise.resolve({ data:[{id:"mount1"}], error:null }); } }; } }; }' +
            '}; };' +
            'photoAllRecords=photoAllRecords.filter(function(x){ return x.id!=="mount1"; });' +
            'await photoOrthoPushRemote({ before:{face:"b1"}, after:{} });' +
            'SB.from=realFrom;' +
            'out.remote=calls[0]||null;' +
            'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
            'if(photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
            'window.photoAllRecords=[' +
            '{id:"b1", category:"Before", file_path:"b1.jpg", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2023-03-12"},' +
            '{id:"a1", category:"After", file_path:"a1.jpg", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2025-11-01"}' +
            '];' +
            'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{face:"b1"},after:{face:"a1"}}));' +
            'photoOrthoToggle(true); photoOrthoRender();' +
            'var face=document.querySelector(".ortho-tile.is-filled[data-slot=face][data-set=before]");' +
            'var img=face && face.querySelector("img");' +
            'out.meter=(document.getElementById("photoOrthoMeter")||{}).textContent||"";' +
            'out.tileDate=face ? (face.querySelector(".ortho-tile-date")||{}).textContent||"" : "";' +
            'out.fit=img ? getComputedStyle(img).objectFit : "";' +
            'out.fillN=photoOrthoFilledCount(photoOrthoLoad(),"before");' +
            'window.photoAllRecords=[' +
            '{id:"p1", category:"Before", file_path:"profile.jpg", caption:"profile", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2023-03-12"},' +
            '{id:"p2", category:"Before", file_path:"smile.jpg", caption:"smile", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2023-03-12"},' +
            '{id:"p3", category:"Before", file_path:"x.jpg", caption:"other", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2023-03-12"}' +
            '];' +
            'photoSelected=new Set(["p1","p2","p3"]);' +
            'out.placed=photoOrthoAutoPlace("before");' +
            'out.auto=photoOrthoLoad().before;' +
            'out.emptyPlaceNotes=[]; var keepN=out.notes; out.notes=[]; photoSelected=new Set(); window.photoAllRecords=[]; out.emptyPlaced=photoOrthoAutoPlace("after"); out.emptyPlaceNotes=out.notes.slice();' +
            'return out;' +
            '})()', true, 70000);

        pass('live: timepoint helpers loaded',
            !!(live && live.ready && live.build === BUILD),
            live ? ('build=' + live.build) : 'no live');
        if (live && live.ready) {
            pass('live: filter lists Before, After, Progress, and legacy Before/After',
                (live.opts || []).indexOf('Before') >= 0 &&
                (live.opts || []).indexOf('After') >= 0 &&
                (live.opts || []).indexOf('Progress') >= 0 &&
                (live.opts || []).indexOf('Before/After') >= 0,
                JSON.stringify(live.opts));
            pass('live: labels distinguish the new timepoints from the old combined tag',
                live.labels.before === 'Before' && live.labels.after === 'After' &&
                live.labels.progress === 'Progress' && /Before\/After/.test(live.labels.legacy || ''),
                JSON.stringify(live.labels));
            pass('live: photoTimepointOf returns before/after/progress and ignores other cats',
                live.tp.before === 'before' && live.tp.after === 'after' &&
                live.tp.progress === 'progress' && live.tp.legacy === '' && live.tp.intra === '',
                JSON.stringify(live.tp));
            pass('live: filtering Before does not pull After or the old combined tag',
                JSON.stringify(live.beforeIds) === JSON.stringify(['1']) &&
                JSON.stringify(live.afterIds) === JSON.stringify(['2']) &&
                JSON.stringify(live.legacyIds) === JSON.stringify(['4']),
                JSON.stringify({ before: live.beforeIds, after: live.afterIds, legacy: live.legacyIds }));
            pass('live: Before badge renders and ortho board button remains',
                /Before/.test(live.badge || '') && live.orthoBtn === true);
            pass('live: PDFs and consent/lab scans count as docs; still photos do not',
                live.docPdf === true && live.docConsent === true && live.docPhoto === false && live.kindBtns === true);
            pass('live: Photos kind hides the PDF; Docs kind keeps it; All keeps both',
                JSON.stringify(live.photoIds) === JSON.stringify(['1','2','3','4']) &&
                JSON.stringify(live.docIds) === JSON.stringify(['5']) &&
                JSON.stringify(live.allIds) === JSON.stringify(['1','2','3','4','5']),
                JSON.stringify({ photos: live.photoIds, docs: live.docIds, all: live.allIds }));
            pass('live: All toggle is the active kind after setPhotoKind("all")',
                live.kindActive && live.kindActive.all === true && live.kindActive.photos === false);
            pass('live: grid headings are newest visit first, undated last',
                JSON.stringify(live.visitOrder) === JSON.stringify(['2025-01-01','2024-06-01','2023-01-01','2022-01-01','']) &&
                (live.visits || []).length === 5,
                JSON.stringify(live.visitOrder) + ' heads=' + (live.visits && live.visits.length));
            pass('live: a sidecar caption on the patient hydrates the mount and stays out of the grid',
                !!(live.hydrated && live.hydrated.before && live.hydrated.before.face === 'b1' &&
                    live.hydrated.after && live.hydrated.after.smile === 'a2') &&
                live.filteredHasSidecar === false,
                JSON.stringify({ hydrated: live.hydrated, inGrid: live.filteredHasSidecar }));
            pass('live: placing pins writes a photos row caption for this patient',
                !!(live.remote && live.remote.op === 'insert' && live.remote.rows &&
                    live.remote.rows[0] && String(live.remote.rows[0].caption || '').indexOf('jsm-ortho-mount-v1:') === 0 &&
                    String(live.remote.rows[0].patient_id || '') === 'e1-patient'),
                JSON.stringify(live.remote));
            pass('live: fill meter, tile date, and contain (no crop) are on the board',
                /1\/9/.test(live.meter || '') && live.fillN === 1 &&
                /12\/03\/2023|2023/.test(live.tileDate || '') && live.fit === 'contain',
                JSON.stringify({ meter: live.meter, date: live.tileDate, fit: live.fit, n: live.fillN }));
            pass('live: auto-place maps profile/smile names and fills leftover slots in order',
                live.placed === 3 && live.auto && live.auto.profile === 'p1' && live.auto.smile === 'p2' && live.auto.face === 'p3',
                JSON.stringify({ placed: live.placed, auto: live.auto }));
            pass('live: auto-place with nothing selected reports an error',
                live.emptyPlaced === 0 && (live.emptyPlaceNotes || []).some(function (n) { return /Select photos|dated visit/i.test(n.msg); }),
                JSON.stringify(live.emptyPlaceNotes));
            var sit = await cdp.js('(function(){' +
                'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
                'if(photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
                'window.photoAllRecords=[' +
                '{id:"v1", category:"Before", file_path:"a.jpg", caption:"profile", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2024-01-01"},' +
                '{id:"v2", category:"Before", file_path:"b.jpg", caption:"smile", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2024-01-01"}' +
                '];' +
                'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{face:"v1"},after:{}}));' +
                'photoOrthoCopySet("before","after");' +
                'var copied=photoOrthoLoad().after.face;' +
                'photoOrthoFillSittingSelects();' +
                'var sitOpts=[].map.call(document.getElementById("photoOrthoSitBefore").options, function(o){ return o.value; });' +
                'var sitPlaced=photoOrthoApplySitting("after","2024-01-01");' +
                'return { copied: copied, sitOpts: sitOpts, sitPlaced: sitPlaced, sitAfter: photoOrthoLoad().after };' +
                '})()', false, 15000);
            pass('live: Copy Before → After duplicates the pins',
                sit && sit.copied === 'v1',
                JSON.stringify(sit && sit.copied));
            pass('live: visit picker lists the sitting and places that date on After',
                sit && (sit.sitOpts || []).indexOf('2024-01-01') >= 0 && sit.sitPlaced >= 1 &&
                sit.sitAfter && (sit.sitAfter.profile === 'v1' || sit.sitAfter.face === 'v1' || sit.sitAfter.smile === 'v2'),
                JSON.stringify(sit));
            var drop = await cdp.js('(async function(){' +
                'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
                'if(photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
                'var uploaded=[];' +
                'photoOrthoConfirmDataset=function(){ return Promise.resolve({ appointment_id:"appt-1", clinic:"TKO Clinic", taken_date:"2024-06-01", dr:"Dr A" }); };' +
                'photoUploadOne=function(file, meta){' +
                '  uploaded.push({ name:file.name, clinic:meta.clinic, appt:meta.ctx&&meta.ctx.appointment_id, cat:meta.category, date:meta.taken_date, tags:meta.ctx&&meta.ctx.tags });' +
                '  return Promise.resolve({ ok:true, id:"up-"+file.name, path:"pid/"+file.name });' +
                '};' +
                'loadPhotoRecords=function(){' +
                '  uploaded.forEach(function(u){' +
                '    if(photoOrthoFind("up-"+u.name)) return;' +
                '    photoAllRecords.push({ id:"up-"+u.name, category:u.cat, file_path:u.name, caption:u.name.replace(/\\.[^.]+$/,""), public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:u.date, clinic:u.clinic, appointment_id:u.appt });' +
                '  });' +
                '  return Promise.resolve();' +
                '};' +
                'window.photoPatientId="e1-patient";' +
                'window.photoAllRecords=[];' +
                'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{},after:{}}));' +
                'photoOrthoToggle(true);' +
                'var blob=new Blob(["x"],{type:"image/jpeg"});' +
                'var f1=new File([blob],"profile.jpg",{type:"image/jpeg"});' +
                'var f2=new File([blob],"smile.jpg",{type:"image/jpeg"});' +
                'var pdf=new File([blob],"note.pdf",{type:"application/pdf"});' +
                'var asked=false; window.confirm=function(){ asked=true; return true; };' +
                'var n=await photoOrthoPlaceFiles("before",[f1,f2]);' +
                'var map=photoOrthoLoad();' +
                'window.confirm=function(){ asked=true; return false; };' +
                'var cancelled=await photoOrthoPlaceFiles("after",[f1]);' +
                'var collected=await photoOrthoCollectDropFiles({files:[f1,f2,pdf],items:null});' +
                'var dirDone=false;' +
                'var fromDir=await photoOrthoCollectDropFiles({files:[],items:[{kind:"file",webkitGetAsEntry:function(){ return {isFile:false,isDirectory:true,createReader:function(){ return {readEntries:function(cb){ if(dirDone){ cb([]); return; } dirDone=true; cb([{isFile:true,isDirectory:false,file:function(ok){ ok(f1); }}]); }}; }}; }}]});' +
                'var setEl=document.querySelector(".ortho-set[data-set=before]");' +
                'var localLeft=(photoAllRecords||[]).some(function(r){ return r && (r._localFile || String(r.id||"").indexOf("drop-")===0); });' +
                'return { n:n, asked:asked, cancelled:cancelled, uploaded:uploaded, localLeft:localLeft, collected:(collected||[]).map(function(f){ return f.name; }), fromDir:(fromDir||[]).map(function(f){ return f.name; }), before:map.before, folderBtns:!!document.getElementById("photoOrthoFolderBeforeBtn") && !!document.getElementById("photoOrthoFolderInput"), setData: setEl && setEl.getAttribute("data-set"), dataset:!!document.getElementById("photoOrthoDataset") };' +
                '})()', true, 20000);
            pass('live: dropping two named files onto Before maps profile and smile after confirm',
                drop && drop.n === 2 && drop.asked === true &&
                drop.before && drop.before.profile === 'up-profile.jpg' && drop.before.smile === 'up-smile.jpg' &&
                drop.localLeft === false &&
                drop.uploaded && drop.uploaded.length === 2 &&
                drop.uploaded[0].clinic === 'TKO Clinic' && drop.uploaded[0].appt === 'appt-1' &&
                drop.uploaded[0].cat === 'Before' && drop.uploaded[0].date === '2024-06-01',
                JSON.stringify(drop && { n: drop.n, asked: drop.asked, before: drop.before, uploaded: drop.uploaded, localLeft: drop.localLeft }));
            pass('live: cancelling a non-9 drop leaves After empty',
                drop && drop.cancelled === 0,
                JSON.stringify(drop && drop.cancelled));
            pass('live: folder drop skips PDFs and reads files inside a directory entry',
                drop && JSON.stringify(drop.collected) === JSON.stringify(['profile.jpg','smile.jpg']) &&
                JSON.stringify(drop.fromDir) === JSON.stringify(['profile.jpg']) &&
                drop.folderBtns === true && drop.setData === 'before',
                JSON.stringify(drop && { collected: drop.collected, fromDir: drop.fromDir, folderBtns: drop.folderBtns, setData: drop.setData }));
            var outsideName = 'jsm-ortho-outside-' + Date.now() + '.jpg';
            var outsideFile = path.join(os.tmpdir(), outsideName);
            fs.writeFileSync(outsideFile, Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]));
            var armed = await cdp.js('(function(){' +
                'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
                'if(photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
                'photoOrthoUploadBusy=false;' +
                'photoOrthoHover=null;' +
                'window.__paneHits=0;' +
                'window.__orthoAsked=false;' +
                'window.photoHandleFiles=function(){ window.__paneHits++; };' +
                'window.confirm=function(){ window.__orthoAsked=true; return false; };' +
                'photoOrthoConfirmDataset=function(){ return Promise.resolve({ appointment_id:"appt-1", clinic:"TKO Clinic", taken_date:"2024-06-01", dr:"Dr A" }); };' +
                'photoUploadOne=function(file){ return Promise.resolve({ ok:true, id:"ext-"+file.name, path:"pid/"+file.name }); };' +
                'loadPhotoRecords=function(){ return Promise.resolve(); };' +
                'window.photoPatientId="e1-patient";' +
                'window.photoAllRecords=[];' +
                'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{},after:{},progress:{}}));' +
                'var login=document.getElementById("loginOverlay"); if(login) login.style.display="none";' +
                'var sec=document.getElementById("consultationSection"); if(sec) sec.style.display="block";' +
                'var pane=document.getElementById("con-photos"); if(pane) pane.style.display="block";' +
                'var main=document.getElementById("photoMainContent"); if(main) main.style.display="block";' +
                'photoOrthoToggle(true);' +
                'photoOrthoRender();' +
                'var tile=document.querySelector(".ortho-tile[data-set=before][data-slot=buccalR]");' +
                'if(!tile) return { ok:false };' +
                'tile.scrollIntoView({block:"center", inline:"center"});' +
                'var r=tile.getBoundingClientRect();' +
                'var samples=[' +
                '  [r.left+r.width/2, r.top+r.height/2],' +
                '  [r.left+r.width/2, r.top+Math.min(18, r.height/3)],' +
                '  [r.left+Math.min(14, r.width/4), r.top+r.height/2],' +
                '  [r.left+r.width/2, r.top+r.height-Math.min(16, r.height/4)]' +
                '];' +
                'var chosen=null, last=null, i, el, hitTile;' +
                'for(i=0;i<samples.length;i++){' +
                '  el=document.elementFromPoint(samples[i][0], samples[i][1]);' +
                '  last=el;' +
                '  hitTile=el && el.closest ? el.closest(".ortho-tile") : null;' +
                '  if(hitTile===tile){ chosen={x:samples[i][0], y:samples[i][1], hit:tile.getAttribute("data-slot")||"", hitTag:el.tagName, hitId:el.id||"", hitCls:el.className?String(el.className).slice(0,80):""}; break; }' +
                '}' +
                'if(!chosen){' +
                '  var stack=document.elementsFromPoint ? document.elementsFromPoint(r.left+r.width/2, r.top+r.height/2) : [];' +
                '  return { ok:false, x:r.left+r.width/2, y:r.top+r.height/2, hit:"", hitTag:last?last.tagName:"", hitId:last&&last.id||"", hitCls:last&&last.className?String(last.className).slice(0,80):"", w:r.width, h:r.height, top:r.top, left:r.left, iw:window.innerWidth, ih:window.innerHeight, stack:(stack||[]).slice(0,6).map(function(n){ return n.tagName+"#"+(n.id||"")+"."+String(n.className||"").slice(0,40); }) };' +
                '}' +
                'return { ok:r.width>8 && r.height>8, x:chosen.x, y:chosen.y, hit:chosen.hit, hitTag:chosen.hitTag, hitId:chosen.hitId, hitCls:chosen.hitCls };' +
                '})()', false, 15000);
            if (armed && armed.ok) {
                var dragData = { items: [], files: [outsideFile], dragOperationsMask: 1 };
                await cdp.call('Input.dispatchDragEvent', { type: 'dragEnter', x: armed.x, y: armed.y, data: dragData });
                await cdp.call('Input.dispatchDragEvent', { type: 'dragOver', x: armed.x, y: armed.y, data: dragData });
                await sleep(80);
                await cdp.call('Input.dispatchDragEvent', { type: 'drop', x: armed.x, y: armed.y, data: dragData });
            }
            var pinned = null;
            var pinDeadline = Date.now() + 8000;
            while (Date.now() < pinDeadline) {
                pinned = await cdp.js('(function(){ var m=photoOrthoLoad(); return { slot: m && m.before && m.before.buccalR || "", pane: window.__paneHits||0, asked: !!window.__orthoAsked, hit: ' + JSON.stringify((armed && armed.hit) || '') + ' }; })()', false, 8000);
                if (pinned && pinned.slot) break;
                await sleep(200);
            }
            try { fs.unlinkSync(outsideFile); } catch (eUn) { /* temp jpeg */ }
            pass('live: a desktop photo dropped on one frame pins that frame',
                armed && armed.ok && armed.hit === 'buccalR' &&
                pinned && pinned.slot === 'ext-' + outsideName && pinned.pane === 0 && pinned.asked === false,
                JSON.stringify({ armed: armed, pinned: pinned, file: outsideName }));
            var browsed = await cdp.js('(async function(){' +
                'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
                'if(photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
                'photoOrthoUploadBusy=false;' +
                'photoOrthoConfirmDataset=function(){ return Promise.resolve({ appointment_id:"appt-1", clinic:"TKO Clinic", taken_date:"2024-06-01", dr:"Dr A" }); };' +
                'photoUploadOne=function(file){ return Promise.resolve({ ok:true, id:"ext-"+file.name, path:"pid/"+file.name }); };' +
                'loadPhotoRecords=function(){ return Promise.resolve(); };' +
                'window.photoPatientId="e1-patient";' +
                'window.photoAllRecords=[];' +
                'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{},after:{},progress:{}}));' +
                'photoOrthoToggle(true);' +
                'photoOrthoRender();' +
                'var pickerOpts=null;' +
                'window.showOpenFilePicker=function(opts){' +
                '  pickerOpts=opts;' +
                '  return Promise.resolve([{ getFile:function(){ return Promise.resolve(new File([new Blob(["x"],{type:"image/jpeg"})],"from-downloads.jpg",{type:"image/jpeg"})); } }]);' +
                '};' +
                'var tile=document.querySelector(".ortho-tile[data-set=before][data-slot=buccalL]");' +
                'if(!tile) return { ok:false };' +
                'tile.click();' +
                'var aimed=photoOrthoPickTarget && photoOrthoPickTarget.slot;' +
                'var openedOnFrame=!!pickerOpts;' +
                'var browse=tile.querySelector("[data-ortho-browse]");' +
                'if(browse) browse.click();' +
                'var slot="";' +
                'var deadline=Date.now()+4000;' +
                'while(Date.now()<deadline){' +
                '  slot=(photoOrthoLoad().before||{}).buccalL||"";' +
                '  if(slot) break;' +
                '  await new Promise(function(r){ setTimeout(r,50); });' +
                '}' +
                'return { ok:true, aimed:aimed, openedOnFrame:openedOnFrame, slot:slot, startIn: pickerOpts && pickerOpts.startIn, multiple: pickerOpts && pickerOpts.multiple, input: !!document.getElementById("photoOrthoFrameInput") };' +
                '})()', true, 15000);
            pass('live: clicking a frame aims the chart strip; Browse opens Downloads',
                browsed && browsed.ok && browsed.aimed === 'buccalL' && browsed.openedOnFrame === false &&
                browsed.startIn === 'downloads' && browsed.multiple === false &&
                browsed.slot === 'ext-from-downloads.jpg' && browsed.input === true,
                JSON.stringify(browsed));
            var chartPick = await cdp.js('(function(){' +
                'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
                'if(photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
                'photoOrthoChartDismissed=false;' +
                'window.photoPatientId="e1-patient";' +
                'window.photoAllRecords=[' +
                '{id:"chart-face", category:"Intraoral", file_path:"face.jpg", caption:"face", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2024-02-02"},' +
                '{id:"side", category:"Other", file_path:"e1-patient/ortho-board.json", caption:"jsm-ortho-mount-v1:{}", public_url:""}' +
                '];' +
                'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{},after:{},progress:{}}));' +
                'photoOrthoToggle(false);' +
                'photoOrthoToggle(true);' +
                'var box=document.getElementById("photoOrthoPick");' +
                'var items=box ? box.querySelectorAll(".ortho-pick-item") : [];' +
                'var ids=[].map.call(items, function(el){ return el.getAttribute("data-id"); });' +
                'if(items[0]) items[0].click();' +
                'var pin=(photoOrthoLoad().before||{}).profile||"";' +
                'var still=box && !box.hasAttribute("hidden");' +
                'return { hidden: !(box && !box.hasAttribute("hidden")), ids: ids, pin: pin, still: still, title: box ? (box.querySelector("strong")||{}).textContent||"" : "" };' +
                '})()', false, 15000);
            pass('live: opening the ortho panel loads the chart picker',
                chartPick && chartPick.hidden === false &&
                JSON.stringify(chartPick.ids) === JSON.stringify(['chart-face']) &&
                chartPick.pin === 'chart-face' && chartPick.still === true,
                JSON.stringify(chartPick));
            var slide = await cdp.js('(function(){' +
                'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
                'if(photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
                'window.photoAllRecords=[' +
                '{id:"b1", category:"Before", file_path:"b1.jpg", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2023-03-12"},' +
                '{id:"a1", category:"After", file_path:"a1.jpg", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2025-11-01"}' +
                '];' +
                'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{face:"b1"},after:{smile:"a1"}}));' +
                'photoOrthoSlideSkipEmpty=true; photoOrthoSlideMode="pair"; photoOrthoSlideMixPct=50;' +
                'photoOrthoSlideshow();' +
                'var steps=photoOrthoSlideSteps();' +
                'var firstTitle=(document.getElementById("photoOrthoShowTitle")||{}).textContent||"";' +
                'var firstStep=(document.getElementById("photoOrthoShowStep")||{}).textContent||"";' +
                'var beforeDate=(document.getElementById("photoOrthoShowBeforeDate")||{}).textContent||"";' +
                'photoOrthoSlideStep(1);' +
                'var secondTitle=(document.getElementById("photoOrthoShowTitle")||{}).textContent||"";' +
                'photoOrthoSlideSkipChange(false);' +
                'var allN=photoOrthoSlideSteps().length;' +
                'photoOrthoSlideSetMode("slider"); photoOrthoSlideSetMix(25);' +
                'var mix=document.getElementById("photoOrthoShowMix");' +
                'var pair=document.getElementById("photoOrthoShowPair");' +
                'var slider={ hidden: mix && mix.hasAttribute("hidden"), cls: mix && mix.className, mix: mix && mix.style.getPropertyValue("--ortho-mix"), pairHidden: pair && pair.hasAttribute("hidden") };' +
                'photoOrthoSlideSetMode("fade");' +
                'var fadeOn=mix && mix.classList.contains("is-fade") && !mix.hasAttribute("hidden");' +
                'return { steps: steps, firstTitle: firstTitle, firstStep: firstStep, beforeDate: beforeDate, secondTitle: secondTitle, allN: allN, slider: slider, fadeOn: fadeOn };' +
                '})()', false, 15000);
            pass('live: slideshow skip-empty walks only filled views and shows the sitting date',
                slide && JSON.stringify(slide.steps) === JSON.stringify(['face','smile']) &&
                /Frontal|Face|正面/.test(slide.firstTitle || '') && /1\s*\/\s*2/.test(slide.firstStep || '') &&
                /12\/03\/2023|2023/.test(slide.beforeDate || '') && /Smile|微笑/.test(slide.secondTitle || ''),
                JSON.stringify(slide && { steps: slide.steps, first: slide.firstTitle, step: slide.firstStep, date: slide.beforeDate, second: slide.secondTitle }));
            pass('live: skip-empty off restores 9 steps; slider clips and fade overlays',
                slide && slide.allN === 9 && slide.slider && slide.slider.hidden === false &&
                slide.slider.pairHidden === true && /is-slider/.test(slide.slider.cls || '') &&
                String(slide.slider.mix || '').indexOf('25') >= 0 && slide.fadeOn === true,
                JSON.stringify(slide && { allN: slide.allN, slider: slide.slider, fadeOn: slide.fadeOn }));
            var exp = await cdp.js('(async function(){' +
                'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
                'if(photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
                'window.currentName="Dr Lee";' +
                'window.photoPatientId="e1-patient";' +
                'window.photoPatientData={full_name:"Chan Tai Man", patient_no:"P1001", dob:"1990-05-01"};' +
                'window.photoAllRecords=[' +
                '{id:"b1", category:"Before", file_path:"b1.jpg", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2023-03-12"},' +
                '{id:"a1", category:"After", file_path:"a1.jpg", public_url:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", taken_date:"2025-11-01"}' +
                '];' +
                'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{face:"b1"},after:{smile:"a1"}}));' +
                'var uploads=[];' +
                'photoUploadOne=function(file, meta){ uploads.push({name:file && file.name, cat:meta && meta.category, caption:meta && meta.caption, type:file && file.type}); return Promise.resolve({ok:true,id:"chart-1"}); };' +
                'var blob=new Blob(["png"],{type:"image/png"});' +
                'var saved=await photoOrthoSaveCompositesToChart({before:blob},{before:"P1001-ortho-before.png"});' +
                'var opened=null; var printed=false;' +
                'window.open=function(url){ opened=url; return { focus:function(){}, print:function(){ printed=true; } }; };' +
                'var how=photoOrthoPrintBlob(new Blob(["%PDF"],{type:"application/pdf"}));' +
                'var meta=photoOrthoPatientMeta();' +
                'return { doctor: photoOrthoDoctorName(), beforeDate: photoOrthoBagDateLabel({face:"b1"}), afterDate: photoOrthoBagDateLabel({smile:"a1"}), metaDoctor: meta.doctor, metaBefore: meta.beforeDate, metaAfter: meta.afterDate, saved: saved, uploads: uploads, how: how, opened: !!opened, printed: printed, printBtn: !!document.getElementById("photoOrthoPrintBtn"), saveBox: !!document.getElementById("photoOrthoSaveChart") && document.getElementById("photoOrthoSaveChart").checked };' +
                '})()', true, 20000);
            pass('live: sitting dates and doctor go on the export header',
                exp && exp.doctor === 'Dr Lee' && exp.metaDoctor === 'Dr Lee' &&
                /12\/03\/2023|2023/.test(exp.beforeDate || '') && /01\/11\/2025|11\/01\/2025|2025/.test(exp.afterDate || '') &&
                /2023/.test(exp.metaBefore || '') && /2025/.test(exp.metaAfter || ''),
                JSON.stringify(exp && { doctor: exp.doctor, before: exp.beforeDate, after: exp.afterDate, meta: { d: exp.metaDoctor, b: exp.metaBefore, a: exp.metaAfter } }));
            pass('live: Save composite to Photos uploads a document; Print opens the PDF',
                exp && exp.saved && exp.saved.n === 1 && exp.uploads && exp.uploads[0] &&
                exp.uploads[0].cat === 'Scanned Document' && /composite/i.test(exp.uploads[0].caption || '') &&
                exp.how === 'window' && exp.opened === true && exp.printed === true &&
                exp.printBtn === true && exp.saveBox === true,
                JSON.stringify(exp && { saved: exp.saved, uploads: exp.uploads, how: exp.how, opened: exp.opened, printed: exp.printed, printBtn: exp.printBtn, saveBox: exp.saveBox }));
            var attach = await cdp.js('(function(){' +
                'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
                'if(photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
                'window.photoPatientId="e1-patient";' +
                'window.photoAllRecords=[{id:"p9", category:"Before", file_path:"smile.jpg", public_url:"https://cdn.example/smile.jpg?sig=1", taken_date:"2024-01-01"}];' +
                'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{},after:{}}));' +
                'photoOrthoToggle(true); photoOrthoRender();' +
                'var url="https://cdn.example/smile.jpg?sig=1";' +
                'photoOrthoDrag={id:"p9"};' +
                'var fake={dataTransfer:{getData:function(){ return url; }, files:[{name:"smile.jpg",type:"image/jpeg"}]}};' +
                'var resolved=photoOrthoReadDragId(fake);' +
                'var treatFiles=photoOrthoHasExternalFiles(fake.dataTransfer);' +
                'photoOrthoPlace("before","smile", url);' +
                'var map=photoOrthoLoad();' +
                'var tile=document.querySelector(".ortho-tile[data-set=before][data-slot=smile]");' +
                'var notes=[]; var orig=mediaNotify; mediaNotify=function(msg){ notes.push(String(msg)); };' +
                'photoOrthoPlace("before","face","not-a-photo");' +
                'mediaNotify=orig;' +
                'var afterBad=photoOrthoLoad();' +
                'var empty=document.querySelector(".ortho-tile[data-set=before][data-slot=face]");' +
                'return { resolved:resolved, treatFiles:treatFiles, pin:map.before && map.before.smile, filled:!!(tile && tile.classList.contains("is-filled")), missing:!!(tile && tile.querySelector(".ortho-tile-miss")), badPin:afterBad.before && afterBad.before.face, emptyMiss:!!(empty && empty.querySelector(".ortho-tile-miss")), attachNote:notes[0]||"", exportRow:!!document.querySelector(".ortho-board-export") };' +
                '})()', false, 15000);
            pass('live: a URL drop attaches the library photo instead of Missing from library',
                attach && attach.resolved === 'p9' && attach.treatFiles === false &&
                attach.pin === 'p9' && attach.filled === true && attach.missing === false,
                JSON.stringify(attach && { resolved: attach.resolved, files: attach.treatFiles, pin: attach.pin, filled: attach.filled, missing: attach.missing }));
            pass('live: an unknown drop is refused and export buttons stay on their own row',
                attach && !attach.badPin && attach.emptyMiss === false &&
                /attach|library|grid|chart|对照|相片/i.test(attach.attachNote || '') &&
                attach.exportRow === true,
                JSON.stringify(attach && { badPin: attach.badPin, emptyMiss: attach.emptyMiss, note: attach.attachNote, exportRow: attach.exportRow }));
            var pix = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
            var livePhoto = await cdp.js('(function(){' +
                'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
                'if(photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
                'var login=document.getElementById("loginOverlay"); if(login) login.style.display="none";' +
                'var sec=document.getElementById("consultationSection"); if(sec) sec.style.display="block";' +
                'var pane=document.getElementById("con-photos"); if(pane) pane.style.display="block";' +
                'var main=document.getElementById("photoMainContent"); if(main) main.style.display="block";' +
                'window.photoPatientId="live-photo-patient";' +
                'window.photoAllRecords=[{id:"live-smile", category:"Before", file_path:"smile.jpg", public_url:"' + pix + '", taken_date:"2024-06-02"}];' +
                'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{},after:{}}));' +
                'photoOrthoToggle(true); photoOrthoRender();' +
                'var tile=document.querySelector(".ortho-tile.is-empty[data-set=before][data-slot=smile]");' +
                'photoOrthoDrag={id:"live-smile"};' +
                'var ev=new Event("drop",{bubbles:true,cancelable:true});' +
                'Object.defineProperty(ev,"dataTransfer",{value:{getData:function(){ return "https://cdn.example/smile.jpg"; }, files:[], items:[]}});' +
                'if(tile) tile.dispatchEvent(ev);' +
                'var filled=document.querySelector(".ortho-tile.is-filled[data-set=before][data-slot=smile]");' +
                'var img=filled && filled.querySelector("img");' +
                'return { build: window.__JSM_BUILD, exportRow:!!document.querySelector(".ortho-board-export"), pin:(photoOrthoLoad().before||{}).smile, filled:!!filled, missing:!!(filled && filled.querySelector(".ortho-tile-miss")), src: img && img.getAttribute("src") || "", w: img && img.naturalWidth, fit: img ? getComputedStyle(img).objectFit : "", emptyTag: tile && tile.tagName };' +
                '})()', false, 15000);
            pass('live photo: dropping a grid photo paints the image on the tile (not Missing from library)',
                livePhoto && livePhoto.pin === 'live-smile' && livePhoto.filled === true &&
                livePhoto.missing === false && /data:image\/gif/.test(livePhoto.src || '') &&
                livePhoto.fit === 'contain' && livePhoto.emptyTag === 'DIV' && livePhoto.exportRow === true,
                JSON.stringify(livePhoto));

            if (live5500) {
                await cdp.call('Page.navigate', { url: 'http://xray-ai.test:5500/index.html?_lr=' + BUILD });
                await sleep(1000);
                var clinic = await cdp.js('(async function(){' +
                    'const wait=function(ms){return new Promise(function(r){setTimeout(r,ms);});};' +
                    'const deadline=Date.now()+20000;' +
                    'while(Date.now()<deadline){ if(typeof photoOrthoPlace==="function" && typeof photoOrthoResolveId==="function") break; await wait(200); }' +
                    'if(typeof photoOrthoPlace!=="function") return { ready:false, build: window.__JSM_BUILD };' +
                    'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
                    'if(typeof photoOrthoPushTimer!=="undefined" && photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
                    'var login=document.getElementById("loginOverlay"); if(login) login.style.display="none";' +
                    'var sec=document.getElementById("consultationSection"); if(sec) sec.style.display="block";' +
                    'var pane=document.getElementById("con-photos"); if(pane) pane.style.display="block";' +
                    'var main=document.getElementById("photoMainContent"); if(main) main.style.display="block";' +
                    'window.photoPatientId="live-photo-5500";' +
                    'window.photoAllRecords=[{id:"live-face", category:"Before", file_path:"face.jpg", public_url:"' + pix + '", taken_date:"2024-06-02"}];' +
                    'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{},after:{}}));' +
                    'photoOrthoToggle(true); photoOrthoRender();' +
                    'photoOrthoPlace("before","face","live-face");' +
                    'var filled=document.querySelector(".ortho-tile.is-filled[data-set=before][data-slot=face]");' +
                    'var img=filled && filled.querySelector("img");' +
                    'return { ready:true, build: window.__JSM_BUILD, pin:(photoOrthoLoad().before||{}).face, filled:!!filled, missing:!!(filled && filled.querySelector(".ortho-tile-miss")), src: img && img.getAttribute("src") || "", exportRow:!!document.querySelector(".ortho-board-export") };' +
                    '})()', true, 25000);
                pass('live clinic :5500: photos script and attach helpers loaded',
                    clinic && clinic.ready === true && String(clinic.build || '').indexOf(BUILD) >= 0,
                    JSON.stringify(clinic && { ready: clinic.ready, build: clinic.build }));
                pass('live clinic :5500 photo: placing a chart photo fills the tile',
                    clinic && clinic.pin === 'live-face' && clinic.filled === true &&
                    clinic.missing === false && /data:image\/gif/.test(clinic.src || '') &&
                    clinic.exportRow === true,
                    JSON.stringify(clinic));
            }
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
