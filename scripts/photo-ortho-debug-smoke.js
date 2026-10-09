/**
 * Photos / Docs slideshow, ortho slideshow, export fallback,
 * category 1-vs-2 column board, and tile pencil menu.
 * Smoke + HTTP spot + API (read-only) + CDP Runtime.evaluate / live page.
 * Run: node scripts/photo-ortho-debug-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261009od3';
var PAGE_PORT = 8833;
var CDP_PORT = 9402;
var CHROME = process.env.CHROME_PATH || (fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
var root = path.resolve(__dirname, '..');
var fails = [];
var PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';

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

function waitJson(url, timeoutMs) {
    var start = Date.now();
    return new Promise(function (resolve, reject) {
        function tick() {
            http.get(url, function (r) {
                var d = '';
                r.on('data', function (c) { d += c; });
                r.on('end', function () {
                    try { resolve(JSON.parse(d)); }
                    catch (e) {
                        if (Date.now() - start > timeoutMs) reject(e);
                        else setTimeout(tick, 250);
                    }
                });
            }).on('error', function (err) {
                if (Date.now() - start > timeoutMs) reject(err);
                else setTimeout(tick, 250);
            });
        }
        tick();
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
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + API + CDP + LIVE PAGE ALL PASS (photo ortho debug)'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}

(async function () {
    var html = read('index.html');
    var photos = read('app-photos.js');
    var css = read('style.css');
    var i18n = read('app-i18n-extra.js');
    var slide = extractFn(photos, 'renderPhotoSlideAt');
    var ensure = extractFn(photos, 'photoEnsureSlideImg');
    var vis = extractFn(photos, 'photoOrthoVisibleSets');
    var tile = extractFn(photos, 'photoOrthoTileHtml');
    var menu = extractFn(photos, 'photoOrthoTileMenuOpen');
    var frame = extractFn(photos, 'photoOrthoFrameHtml');
    var composite = extractFn(photos, 'photoOrthoComposite');
    var exportPdf = extractFn(photos, 'photoOrthoExportPdf');

    console.log('=== source ===');
    pass('index loads debug build ' + BUILD,
        html.indexOf("var BUILD = '" + BUILD + "'") >= 0 &&
        html.indexOf("'app-photos.js?v=" + BUILD + "'") >= 0 &&
        html.indexOf("'app-i18n-extra.js?v=" + BUILD + "'") >= 0);
    pass('slide view keeps a real img node instead of wiping innerHTML',
        photos.indexOf('function photoEnsureSlideImg') >= 0 &&
        ensure.indexOf("createElement('img')") >= 0 &&
        slide.indexOf('innerHTML') < 0 &&
        slide.indexOf('photoEnsureSlideImg') >= 0 &&
        slide.indexOf('photoDisplayUrl') >= 0);
    pass('ortho slideshow frames force width/height so the photo is visible',
        frame.indexOf('width:100%') >= 0 &&
        frame.indexOf('height:100%') >= 0 &&
        css.indexOf('.ortho-show-frame img') >= 0 &&
        css.indexOf('min-height: 280px') >= 0);
    pass('export asks for write permission and falls back to a download',
        composite.indexOf('showDirectoryPicker') >= 0 &&
        composite.indexOf('photoOrthoEnsureWrite') >= 0 &&
        composite.indexOf('photoOrthoWriteDirFile') >= 0 &&
        exportPdf.indexOf('photoOrthoPickSave') >= 0 &&
        exportPdf.indexOf('photoOrthoWriteOrDownload') >= 0 &&
        photos.indexOf('function photoOrthoDownloadBlob') >= 0);
    pass('category Before or After is one 9-frame; Before/After stays two',
        vis.indexOf("cat === 'before'") >= 0 &&
        vis.indexOf("cat === 'after'") >= 0 &&
        vis.indexOf("return ['before', 'after']") >= 0 &&
        extractFn(photos, 'photoOrthoRender').indexOf('photoOrthoVisibleSets') >= 0 &&
        css.indexOf('#photoOrthoSets.is-single') >= 0);
    pass('each 9-frame set can toggle individual tiles or one pre-merged composite',
        photos.indexOf('function photoOrthoSetInputMode') >= 0 &&
        photos.indexOf('function photoOrthoCompositeTileHtml') >= 0 &&
        extractFn(photos, 'photoOrthoRender').indexOf('photoOrthoModeToggleHtml') >= 0 &&
        extractFn(photos, 'photoOrthoSlideSteps').indexOf("return ['composite']") >= 0 &&
        html.indexOf('id="photoOrthoShowBack"') >= 0 &&
        html.indexOf('onclick="photoOrthoSlideBack()"') >= 0 &&
        html.indexOf('onclick="photoSlideBack()"') >= 0 &&
        css.indexOf('.ortho-comp-tile') >= 0 &&
        css.indexOf('.ortho-show-back') >= 0 &&
        css.indexOf('body:has(#photoOrthoShow:not([hidden]))') >= 0 &&
        css.indexOf('body.photo-ortho-show-open') >= 0 &&
        extractFn(photos, 'photoOrthoSlideshow').indexOf('photoOrthoShowChrome') >= 0);
    pass('filled tiles have a clickable pencil that opens the edit menu',
        tile.indexOf('data-ortho-edit') >= 0 &&
        tile.indexOf('<button type="button" class="ortho-tile') < 0 &&
        menu.indexOf('media.ortho.flipV') >= 0 &&
        menu.indexOf('media.ortho.flipH') >= 0 &&
        menu.indexOf('media.ortho.rotateL') >= 0 &&
        menu.indexOf('media.ortho.rotateR') >= 0 &&
        menu.indexOf('media.ortho.crop') >= 0 &&
        menu.indexOf('media.ortho.replace') >= 0 &&
        menu.indexOf('media.ortho.delete') >= 0 &&
        css.indexOf('.ortho-tile-menu') >= 0 &&
        /pointer-events:\s*auto/.test(css));
    ['media.ortho.flipV', 'media.ortho.flipH', 'media.ortho.rotateL', 'media.ortho.rotateR',
        'media.ortho.crop', 'media.ortho.replace', 'media.ortho.delete', 'media.ortho.edit',
        'media.ortho.progress', 'media.ortho.modeTiles', 'media.ortho.modeComp',
        'media.ortho.compTile', 'media.ortho.compHint', 'media.ortho.back'].forEach(function (key) {
        pass('i18n ' + key + ' en / zh-CN / zh-Hant', i18nHasAll(i18n, key));
    });

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var spotIdx = await httpGetText(PAGE_PORT, '/index.html');
    pass('GET /index.html serves the debug build',
        spotIdx.status === 200 && spotIdx.body.indexOf('app-photos.js?v=' + BUILD) >= 0,
        'HTTP ' + spotIdx.status);
    var spotJs = await httpGetText(PAGE_PORT, '/app-photos.js?v=' + BUILD);
    pass('GET /app-photos.js serves slide, layout, export and pencil helpers',
        spotJs.status === 200 &&
        spotJs.body.indexOf('function photoEnsureSlideImg') >= 0 &&
        spotJs.body.indexOf('function photoOrthoVisibleSets') >= 0 &&
        spotJs.body.indexOf('function photoOrthoTileMenuOpen') >= 0 &&
        spotJs.body.indexOf('function photoOrthoSetInputMode') >= 0 &&
        spotJs.body.indexOf('function photoOrthoSlideBack') >= 0 &&
        spotJs.body.indexOf('function photoOrthoWriteOrDownload') >= 0,
        'HTTP ' + spotJs.status);
    var live5500 = null;
    try { live5500 = await httpGetText(5500, '/app-photos.js?v=' + BUILD); } catch (e) { live5500 = null; }
    pass('clinic page on :5500 serves the same debug script when it is up',
        !live5500 || (live5500.status === 200 && live5500.body.indexOf('function photoOrthoVisibleSets') >= 0),
        live5500 ? ('HTTP ' + live5500.status) : '5500 not answering');

    console.log('\n=== API (read-only, anon) ===');
    var sb = readSbConfig(read('app.js'));
    var photoRes = await fetch(sb.url.replace(/\/$/, '') +
        '/rest/v1/photos?select=id,category,public_url,file_path&limit=8', {
        headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
    });
    var photoJson = await photoRes.json();
    pass('photos table readable for slideshow / ortho pins',
        photoRes.status === 200 && Array.isArray(photoJson),
        'HTTP ' + photoRes.status + (Array.isArray(photoJson) ? (', ' + photoJson.length + ' rows') : ''));

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        finish(1);
        return;
    }
    var profile = path.join(os.tmpdir(), 'cs-photo-ortho-od1-cdp');
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
            'while(Date.now()<deadline){ if(typeof photoEnsureSlideImg==="function" && typeof photoOrthoVisibleSets==="function") break; await wait(200); }' +
            'const out={ ready: typeof photoEnsureSlideImg==="function", build: window.__JSM_BUILD };' +
            'if(!out.ready) return out;' +
            'const login=document.getElementById("loginOverlay"); if(login) login.style.display="none";' +
            'const sec=document.getElementById("consultationSection"); if(sec) sec.style.display="block";' +
            'const pane=document.getElementById("con-photos"); if(pane) pane.style.display="block";' +
            'const main=document.getElementById("photoMainContent"); if(main) main.style.display="block";' +
            'window.photoPatientId="od1-patient";' +
            'window.photoAllRecords=[' +
            '{id:"s1", category:"Before", file_path:"a.jpg", public_url:"' + PIXEL + '", taken_date:"2023-01-01"},' +
            '{id:"s2", category:"After", file_path:"b.jpg", public_url:"' + PIXEL + '", taken_date:"2025-01-01"}' +
            '];' +
            'photoFiltered=window.photoAllRecords.slice();' +
            'photoCurrentIdx=0;' +
            'setPhotoView("slide");' +
            'renderPhotoSlide();' +
            'var img=document.getElementById("photoSlideImg");' +
            'out.slide={ display: document.getElementById("photoSlideView").style.display, src: img && img.getAttribute("src") || "", shown: !!(img && img.style.display !== "none"), w: img && img.clientWidth, h: img && img.naturalWidth };' +
            'var sel=document.getElementById("photoFilterCat");' +
            'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
            'if(photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
            'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{face:"s1",smile:"s1"},after:{face:"s2"}}));' +
            'photoOrthoToggle(true);' +
            'sel.value="Before"; filterPhotos(); photoOrthoRender();' +
            'out.beforeSets=[].map.call(document.querySelectorAll("#photoOrthoSets .ortho-set"), function(s){ return s.dataset.set; });' +
            'out.beforeSingle=document.getElementById("photoOrthoSets").classList.contains("is-single");' +
            'out.beforeTiles=document.querySelectorAll("#photoOrthoSets .ortho-tile").length;' +
            'sel.value="After"; filterPhotos(); photoOrthoRender();' +
            'out.afterSets=[].map.call(document.querySelectorAll("#photoOrthoSets .ortho-set"), function(s){ return s.dataset.set; });' +
            'out.afterSingle=document.getElementById("photoOrthoSets").classList.contains("is-single");' +
            'sel.value="Before/After"; filterPhotos(); photoOrthoRender();' +
            'out.dualSets=[].map.call(document.querySelectorAll("#photoOrthoSets .ortho-set"), function(s){ return s.dataset.set; });' +
            'out.dualSingle=document.getElementById("photoOrthoSets").classList.contains("is-single");' +
            'sel.value=""; filterPhotos(); photoOrthoRender();' +
            'var edit=document.querySelector(".ortho-tile.is-filled [data-ortho-edit]");' +
            'out.pencil=!!edit;' +
            'out.pencilPe=edit ? getComputedStyle(edit).pointerEvents : "";' +
            'if(edit){ photoOrthoTileMenuOpen(edit); }' +
            'var menu=document.getElementById("photoOrthoTileMenu");' +
            'out.menuOpen=!!(menu && !menu.hasAttribute("hidden"));' +
            'out.menuActs=menu ? [].map.call(menu.querySelectorAll("[data-ortho-act]"), function(b){ return b.getAttribute("data-ortho-act"); }) : [];' +
            'photoOrthoSlideshow();' +
            'var frame=document.getElementById("photoOrthoShowBefore");' +
            'var fimg=frame && frame.querySelector("img");' +
            'out.show={ hidden: document.getElementById("photoOrthoShow").hasAttribute("hidden"), src: fimg && fimg.getAttribute("src") || "", w: fimg && getComputedStyle(fimg).width, h: fimg && getComputedStyle(fimg).height };' +
            'out.exportFns={ write: typeof photoOrthoWriteOrDownload==="function", perm: typeof photoOrthoEnsureWrite==="function", dl: typeof photoOrthoDownloadBlob==="function" };' +
            'photoOrthoSlideClose();' +
            'sel.value="Before"; filterPhotos();' +
            'photoOrthoSetInputMode("before","composite");' +
            'out.compSets=!!document.querySelector(".ortho-set.is-composite[data-set=before]");' +
            'out.compTile=!!document.querySelector(".ortho-comp-tile[data-set=before][data-slot=composite]");' +
            'out.modeOn=(document.querySelector(\'[data-ortho-mode=composite][data-set=before]\')||{}).className||"";' +
            'out.gridHidden=!document.querySelector(".ortho-set[data-set=before] .ortho-set-grid");' +
            'photoOrthoPlace("before","composite","s1",null);' +
            'out.compPin=(photoOrthoLoad().before||{}).composite;' +
            'photoOrthoSlideshow();' +
            'out.compShow={ title:(document.getElementById("photoOrthoShowTitle")||{}).textContent||"", steps:photoOrthoSlideSteps(), src:((document.querySelector("#photoOrthoShowBefore img")||{}).getAttribute&&document.querySelector("#photoOrthoShowBefore img").getAttribute("src"))||"" };' +
            'out.backBtn=!!document.getElementById("photoOrthoShowBack");' +
            'var back=document.getElementById("photoOrthoShowBack");' +
            'var br=back ? back.getBoundingClientRect() : {top:-1,height:0};' +
            'var strip=document.querySelector(".app-session-strip");' +
            'out.backOpen={ bodyOn: document.body.classList.contains("photo-ortho-show-open"), top: Math.round(br.top), h: Math.round(br.height), stripVis: strip ? getComputedStyle(strip).visibility : "missing", stripPe: strip ? getComputedStyle(strip).pointerEvents : "" };' +
            'photoOrthoSlideBack();' +
            'out.backClosed=document.getElementById("photoOrthoShow").hasAttribute("hidden");' +
            'out.bodyOff=!document.body.classList.contains("photo-ortho-show-open");' +
            'out.photosPane=!!(document.getElementById("con-photos") && (document.getElementById("con-photos").classList.contains("active") || document.getElementById("con-photos").style.display==="block"));' +
            'return out;' +
            '})()', true, 70000);

        pass('live: debug helpers loaded',
            !!(live && live.ready && live.build === BUILD),
            live ? ('build=' + live.build) : 'no live');
        if (live && live.ready) {
            pass('live: Photos slideshow paints the image src',
                !!(live.slide && live.slide.src && live.slide.shown),
                JSON.stringify(live.slide));
            pass('live: Before category is one 9-frame panel',
                JSON.stringify(live.beforeSets) === JSON.stringify(['before']) &&
                live.beforeSingle === true && live.beforeTiles === 9,
                JSON.stringify({ sets: live.beforeSets, single: live.beforeSingle, tiles: live.beforeTiles }));
            pass('live: After category is one 9-frame panel',
                JSON.stringify(live.afterSets) === JSON.stringify(['after']) && live.afterSingle === true,
                JSON.stringify({ sets: live.afterSets, single: live.afterSingle }));
            pass('live: Before/After category is two 9-frame panels',
                JSON.stringify(live.dualSets) === JSON.stringify(['before', 'after']) && live.dualSingle === false,
                JSON.stringify({ sets: live.dualSets, single: live.dualSingle }));
            pass('live: pencil is clickable and opens flip/rotate/crop/replace/delete',
                live.pencil === true && live.pencilPe === 'auto' && live.menuOpen === true &&
                (live.menuActs || []).join(',') === 'flipV,flipH,rotateL,rotateR,crop,replace,delete',
                JSON.stringify({ pencil: live.pencil, pe: live.pencilPe, open: live.menuOpen, acts: live.menuActs }));
            pass('live: ortho slideshow frame has an image',
                !!(live.show && live.show.hidden === false && live.show.src),
                JSON.stringify(live.show));
            pass('live: export write helpers are present',
                !!(live.exportFns && live.exportFns.write && live.exportFns.perm && live.exportFns.dl),
                JSON.stringify(live.exportFns));
            pass('live: Before can switch from 9 tiles to one composite drop zone',
                live.compSets === true && live.compTile === true && live.gridHidden === true &&
                /is-on/.test(live.modeOn || '') && live.compPin === 's1',
                JSON.stringify({ sets: live.compSets, tile: live.compTile, grid: live.gridHidden, pin: live.compPin, mode: live.modeOn }));
            pass('live: composite slideshow shows the merged photo and Back returns to Photos/Docs',
                !!(live.compShow && live.compShow.src) &&
                JSON.stringify(live.compShow.steps) === JSON.stringify(['composite']) &&
                live.backBtn === true && live.backClosed === true && live.photosPane === true,
                JSON.stringify({ show: live.compShow, back: live.backBtn, closed: live.backClosed, pane: live.photosPane }));
            pass('live: Back sits below the banana header and is not covered by it',
                !!(live.backOpen && live.backOpen.bodyOn && live.backOpen.top >= 0 && live.backOpen.h > 20 &&
                    live.backOpen.stripVis === 'hidden' && live.backOpen.stripPe === 'none' && live.bodyOff === true),
                JSON.stringify({ open: live.backOpen, bodyOff: live.bodyOff }));
        }

        if (live5500 && live5500.status === 200 && live5500.body.indexOf('function photoOrthoVisibleSets') >= 0) {
            await cdp.call('Page.navigate', { url: 'http://xray-ai.test:5500/index.html?_lr=' + BUILD });
            await sleep(1000);
            var clinic = await cdp.js(
                'typeof photoOrthoVisibleSets==="function" && typeof photoEnsureSlideImg==="function" && window.__JSM_BUILD',
                false, 15000);
            pass('live clinic :5500 has the debug helpers',
                clinic === BUILD,
                String(clinic));
        }
    } catch (err) {
        pass('CDP / live page ran', false, String(err && err.message || err));
    } finally {
        try { if (ws) ws.close(); } catch (e) { /* ignore */ }
        try { proc.kill(); } catch (e2) { /* ignore */ }
        try { server.close(); } catch (e3) { /* ignore */ }
    }

    finish(fails.length ? 1 : 0);
})().catch(function (err) {
    console.error(err);
    process.exit(1);
});
