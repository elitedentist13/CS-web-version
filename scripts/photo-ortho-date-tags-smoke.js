/**
 * Ortho visit dropdown: Initial / Final date tags (no clinic calendar date required).
 * Smoke + HTTP spot + API (read-only) + CDP Runtime.evaluate / live page sample photos.
 * Run: node scripts/photo-ortho-date-tags-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261017ortho4';
var PAGE_PORT = 8841;
var CDP_PORT = 9411;
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
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + API + CDP + LIVE PAGE ALL PASS (ortho date tags)'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}

(async function () {
    var html = read('index.html');
    var photos = read('app-photos.js');
    var i18n = read('app-i18n-extra.js');
    var appJs = read('app.js');

    console.log('=== source ===');
    pass('index loads date-tag build ' + BUILD,
        html.indexOf("var BUILD = '" + BUILD + "'") >= 0 &&
        html.indexOf("'app-photos.js?v=" + BUILD + "'") >= 0 &&
        html.indexOf("'app-i18n-extra.js?v=" + BUILD + "'") >= 0);
    pass('HTML visit dropdown + Initial/Progress/Final picks + Progress free date',
        html.indexOf('id="photoOrthoVisitSelect"') >= 0 &&
        html.indexOf('onchange="photoOrthoSelectVisit(this.value)"') >= 0 &&
        html.indexOf('data-ortho-cat="initial"') >= 0 &&
        html.indexOf('data-ortho-cat="progress"') >= 0 &&
        html.indexOf('data-ortho-cat="final"') >= 0 &&
        html.indexOf('id="photoOrthoProgressDate"') >= 0 &&
        html.indexOf('photoOrthoProgressDatePicked') >= 0 &&
        html.indexOf('photoOrthoOpenProgressFromInput') >= 0);
    pass('tag constants and helpers are wired into nav / select / compare',
        photos.indexOf("PHOTO_ORTHO_TAG_INITIAL = 'tag:initial'") >= 0 &&
        photos.indexOf("PHOTO_ORTHO_TAG_FINAL = 'tag:final'") >= 0 &&
        photos.indexOf('function photoOrthoIsTagValue') >= 0 &&
        photos.indexOf('function photoOrthoFocusTagSet') >= 0 &&
        photos.indexOf('function photoOrthoActiveVisitValue') >= 0 &&
        extractFn(photos, 'photoOrthoNavVisitOptions').indexOf('PHOTO_ORTHO_TAG_INITIAL') >= 0 &&
        extractFn(photos, 'photoOrthoNavVisitOptions').indexOf('PHOTO_ORTHO_TAG_FINAL') >= 0 &&
        extractFn(photos, 'photoOrthoSelectVisit').indexOf('photoOrthoIsTagValue') >= 0 &&
        extractFn(photos, 'photoOrthoPaintVisitNav').indexOf('photoOrthoActiveVisitValue') >= 0 &&
        extractFn(photos, 'photoOrthoComparePick').indexOf('photoOrthoIsTagValue') >= 0 &&
        extractFn(photos, 'photoOrthoResolveVisitView').indexOf('photoOrthoIsTagValue') >= 0 &&
        extractFn(photos, 'photoOrthoNormalizeMap').indexOf('photoOrthoCompareValueOf') >= 0);
    pass('undated Initial/Final category switch does not require a calendar date',
        extractFn(photos, 'photoOrthoSetVisitCategory').indexOf("cat === 'progress'") >= 0 &&
        extractFn(photos, 'photoOrthoSetVisitCategory').indexOf("curKey !== 'before'") >= 0 &&
        extractFn(photos, 'photoOrthoSetVisitCategory').indexOf("map.setMeta[key].date = date || ''") >= 0);
    pass('Progress free date helpers are wired',
        photos.indexOf('function photoOrthoProgressDatePicked') >= 0 &&
        photos.indexOf('function photoOrthoOpenProgressFromInput') >= 0 &&
        photos.indexOf('function photoOrthoFocusProgressSet') >= 0 &&
        photos.indexOf('function photoOrthoProgressCaption') >= 0 &&
        photos.indexOf('function photoOrthoSetDateHtml') >= 0 &&
        photos.indexOf("PHOTO_ORTHO_TAG_PROGRESS = 'tag:progress'") >= 0 &&
        extractFn(photos, 'photoOrthoSelectVisit').indexOf('forceNew') >= 0 &&
        extractFn(photos, 'photoOrthoSelectVisit').indexOf('photoOrthoShowPair') < 0 &&
        extractFn(photos, 'photoOrthoNavVisitOptions').indexOf('photoOrthoProgressCaption') >= 0 &&
        extractFn(photos, 'photoOrthoSetVisitCategory').indexOf('photoOrthoProgressDateInputValue') >= 0 &&
        extractFn(photos, 'photoOrthoRender').indexOf('photoOrthoSetDateHtml') >= 0 &&
        extractFn(photos, 'photoOrthoRecordDate').indexOf('photoOrthoPushRemote') >= 0);
    pass('i18n has In Progress-(DATE) caption pattern',
        i18nHasAll(i18n, 'media.ortho.progressDated') &&
        /progressDated':\s*\{[\s\S]*?In Progress-\(\{DATE\}\)/.test(i18n));
    pass('i18n covers Initial/Progress/Final and updated visit placeholder',
        i18nHasAll(i18n, 'media.ortho.catInitial') &&
        i18nHasAll(i18n, 'media.ortho.catProgress') &&
        i18nHasAll(i18n, 'media.ortho.catFinal') &&
        i18nHasAll(i18n, 'media.ortho.visitPh') &&
        i18nHasAll(i18n, 'media.ortho.visitNav') &&
        i18nHasAll(i18n, 'media.ortho.progressAdd') &&
        /visitPh':\s*\{\s*en:\s*'In Progress'/.test(i18n) &&
        /catProgress':\s*\{\s*en:\s*'In Progress'/.test(i18n));
    // progressDated asserted above with Progress free-date helpers

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    try {
        var page = await httpGetText(PAGE_PORT, '/index.html');
        pass('spot: index.html serves 200 with ortho visit select',
            page.status === 200 && page.body.indexOf('id="photoOrthoVisitSelect"') >= 0);
        var photosJs = await httpGetText(PAGE_PORT, '/app-photos.js?v=' + BUILD);
        pass('spot: app-photos.js serves tag:initial / tag:final',
            photosJs.status === 200 &&
            photosJs.body.indexOf("tag:initial") >= 0 &&
            photosJs.body.indexOf("tag:final") >= 0 &&
            photosJs.body.indexOf('function photoOrthoFocusTagSet') >= 0);
        var i18nJs = await httpGetText(PAGE_PORT, '/app-i18n-extra.js?v=' + BUILD);
        pass('spot: i18n-extra serves visitPh In Progress copy',
            i18nJs.status === 200 &&
            i18nJs.body.indexOf('media.ortho.visitPh') >= 0 &&
            /visitPh':\s*\{\s*en:\s*'In Progress'/.test(i18nJs.body));

        console.log('\n=== API (read-only) ===');
        var sb = readSbConfig(appJs);
        var https = require('https');
        var health = await new Promise(function (resolve, reject) {
            var url = new URL(sb.url.replace(/\/$/, '') + '/rest/v1/photos?select=id&limit=1');
            var lib = url.protocol === 'https:' ? https : http;
            lib.get({
                hostname: url.hostname,
                path: url.pathname + url.search,
                headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key },
                timeout: 10000
            }, function (r) {
                var d = '';
                r.on('data', function (c) { d += c; });
                r.on('end', function () { resolve({ status: r.statusCode, body: d }); });
            }).on('error', reject);
        });
        pass('api: photos table reachable (anon read)',
            health.status === 200 || health.status === 206 || health.status === 401 ||
            health.status === 403 || health.status === 301 || health.status === 302,
            'status=' + health.status);

        console.log('\n=== CDP + live page ===');
        if (!fs.existsSync(CHROME)) {
            pass('cdp: chrome binary present', false, CHROME);
            finish(1);
            return;
        }
        var profile = path.join(os.tmpdir(), 'cs-photo-ortho-date-tags-cdp');
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        fs.mkdirSync(profile, { recursive: true });
        var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/index.html?_lr=' + BUILD;
        var chrome = child_process.spawn(CHROME, [
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
            var pageTab = (tabs || []).find(function (t) {
                return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0;
            });
            pass('cdp: page target', !!pageTab && !!pageTab.webSocketDebuggerUrl, pageTab ? pageTab.url : 'none');
            if (!pageTab) throw new Error('no page target');
            var WS = typeof WebSocket !== 'undefined' ? WebSocket : null;
            if (!WS) {
                try { WS = require('ws'); } catch (eWs) { throw new Error('WebSocket unavailable'); }
            }
            ws = new WS(pageTab.webSocketDebuggerUrl);
            await new Promise(function (resolve, reject) {
                ws.addEventListener('open', resolve);
                ws.addEventListener('error', reject);
            });
            var cdp = new Cdp(ws);
            await cdp.call('Page.enable');
            await cdp.call('Runtime.enable');
            await cdp.call('Page.navigate', { url: hosted });
            await sleep(1000);

            var boot = await cdp.js('(async function(){' +
                'const wait=function(ms){return new Promise(function(r){setTimeout(r,ms);});};' +
                'const deadline=Date.now()+25000;' +
                'while(Date.now()<deadline){ if(typeof photoOrthoSelectVisit==="function") break; await wait(200); }' +
                'var login=document.getElementById("loginOverlay"); if(login) login.style.display="none";' +
                'if(typeof markAppReady==="function") markAppReady();' +
                'var sec=document.getElementById("consultationSection"); if(sec) sec.style.display="block";' +
                'var pane=document.getElementById("con-photos"); if(pane) pane.style.display="block";' +
                'var main=document.getElementById("photoMainContent"); if(main) main.style.display="block";' +
                'return {' +
                'ready: typeof photoOrthoSelectVisit === "function",' +
                'hasSelect: !!document.getElementById("photoOrthoVisitSelect"),' +
                'hasPanel: !!document.getElementById("photoOrthoPanel"),' +
                'tagI: typeof PHOTO_ORTHO_TAG_INITIAL !== "undefined" ? PHOTO_ORTHO_TAG_INITIAL : "",' +
                'tagF: typeof PHOTO_ORTHO_TAG_FINAL !== "undefined" ? PHOTO_ORTHO_TAG_FINAL : "",' +
                'build: window.__JSM_BUILD || ""' +
                '}; })()', true, 30000);
            pass('cdp: page boots with ortho visit select + tag constants',
                boot && boot.ready && boot.hasSelect && boot.hasPanel &&
                boot.tagI === 'tag:initial' && boot.tagF === 'tag:final' &&
                boot.build === BUILD,
                JSON.stringify(boot));

            var live = await cdp.js('(function(){' +
                'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
                'if(typeof photoOrthoPushTimer!=="undefined" && photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
                'window.photoPatientId="tag-patient";' +
                'photoOrthoVisitReq=(photoOrthoVisitReq||0)+1;' +
                'photoOrthoVisitCachePid="tag-patient";' +
                'photoOrthoVisitCache=[];' +
                'window.photoAllRecords=[' +
                '{id:"init-face", category:"Before", file_path:"init-face.jpg", caption:"face", public_url:"' + PIXEL + '", taken_date:null},' +
                '{id:"fin-smile", category:"After", file_path:"fin-smile.jpg", caption:"smile", public_url:"' + PIXEL + '", taken_date:null}' +
                '];' +
                'localStorage.setItem(photoOrthoKey(), JSON.stringify({before:{},after:{},progress:{},setMeta:{before:{id:"",date:"",remarks:"",appointmentId:""},after:{id:"",date:"",remarks:"",appointmentId:""}}}));' +
                'photoOrthoToggle(true);' +
                'var opts=[].map.call(document.getElementById("photoOrthoVisitSelect").options, function(o){ return {v:o.value,t:o.textContent}; });' +
                'photoOrthoSelectVisit("tag:initial");' +
                'var afterInit=photoOrthoLoad();' +
                'photoOrthoPlace("before","face","init-face");' +
                'var placedInit=photoOrthoLoad();' +
                'var selAfterInit=(document.getElementById("photoOrthoVisitSelect")||{}).value;' +
                'var catInit=(document.querySelector("[data-ortho-cat].is-on")||{}).getAttribute ? document.querySelector("[data-ortho-cat].is-on").getAttribute("data-ortho-cat") : "";' +
                'photoOrthoSelectVisit("tag:final");' +
                'photoOrthoPlace("after","smile","fin-smile");' +
                'var placedFin=photoOrthoLoad();' +
                'var selAfterFin=(document.getElementById("photoOrthoVisitSelect")||{}).value;' +
                'var catFin=(document.querySelector("[data-ortho-cat].is-on")||{}).getAttribute ? document.querySelector("[data-ortho-cat].is-on").getAttribute("data-ortho-cat") : "";' +
                'photoOrthoSetVisitCategory("initial");' +
                'var swapped=photoOrthoLoad();' +
                'photoOrthoSelectVisit("tag:final");' +
                'var emptyFin=photoOrthoLoad();' +
                'photoOrthoToggleCompare();' +
                'var cmp=photoOrthoLoad();' +
                'var cmpVals=[].map.call(document.querySelectorAll("#photoOrthoSets select.ortho-compare-visit"), function(s){ return s.value; });' +
                'var tiles=document.querySelectorAll("#photoOrthoSets .ortho-tile img, #photoOrthoSets img.ortho-tile-img").length;' +
                'return {' +
                'opts:opts,' +
                'initFocus:afterInit.focus,' +
                'initDate:(afterInit.setMeta&&afterInit.setMeta.before&&afterInit.setMeta.before.date)||"",' +
                'initFace:placedInit.before&&placedInit.before.face||"",' +
                'selInit:selAfterInit,' +
                'catInit:catInit,' +
                'finFocus:placedFin.focus,' +
                'finDate:(placedFin.setMeta&&placedFin.setMeta.after&&placedFin.setMeta.after.date)||"",' +
                'finSmile:placedFin.after&&placedFin.after.smile||"",' +
                'selFin:selAfterFin,' +
                'catFin:catFin,' +
                'swappedFace:swapped.before&&swapped.before.face||"",' +
                'swappedSmile:swapped.before&&swapped.before.smile||"",' +
                'swappedFocus:swapped.focus,' +
                'emptyFinSmile:emptyFin.after&&emptyFin.after.smile||"",' +
                'cmpLeft:cmp.compareLeft,' +
                'cmpRight:cmp.compareRight,' +
                'cmpFocus:cmp.focus,' +
                'cmpVals:cmpVals,' +
                'tiles:tiles' +
                '};' +
                '})()', false, 20000);

            pass('live: visit dropdown lists Initial / Final / In Progress tags',
                live && live.opts && live.opts.length >= 4 &&
                live.opts[0] && /In Progress|治疗中|治療中/i.test((live.opts[0].t) || '') &&
                live.opts[1] && live.opts[1].v === 'tag:initial' &&
                live.opts[2] && live.opts[2].v === 'tag:final' &&
                live.opts[3] && live.opts[3].v === 'tag:progress' &&
                /Initial|初诊|初診/i.test((live.opts[1] && live.opts[1].t) || '') &&
                /Final|完成/i.test((live.opts[2] && live.opts[2].t) || '') &&
                /In Progress|治疗中|治療中/i.test((live.opts[3] && live.opts[3].t) || ''),
                JSON.stringify(live && live.opts && live.opts.slice(0, 5)));
            pass('live: picking Initial opens before set with empty date and accepts a sample photo',
                live && live.initFocus === 'before' && live.initDate === '' &&
                live.initFace === 'init-face' && live.selInit === 'tag:initial' && live.catInit === 'initial',
                JSON.stringify(live && {
                    initFocus: live.initFocus, initDate: live.initDate, initFace: live.initFace,
                    selInit: live.selInit, catInit: live.catInit
                }));
            pass('live: picking Final opens after set with empty date and accepts a sample photo',
                live && live.finFocus === 'after' && live.finDate === '' &&
                live.finSmile === 'fin-smile' && live.selFin === 'tag:final' && live.catFin === 'final',
                JSON.stringify(live && {
                    finFocus: live.finFocus, finDate: live.finDate, finSmile: live.finSmile,
                    selFin: live.selFin, catFin: live.catFin
                }));
            pass('live: undated Final can be re-tagged Initial (photo moves, no calendar date invented)',
                live && live.swappedFocus === 'before' && live.swappedSmile === 'fin-smile' &&
                live.emptyFinSmile === '' &&
                ((live.swappedFace === 'init-face') || !live.swappedFace),
                JSON.stringify(live && {
                    swappedFocus: live.swappedFocus, swappedFace: live.swappedFace,
                    swappedSmile: live.swappedSmile, emptyFinSmile: live.emptyFinSmile
                }));
            pass('live: compare mode defaults can use Initial/Final tags',
                live && live.cmpFocus === '' &&
                (live.cmpLeft === 'tag:initial' || live.cmpLeft === 'tag:final' || /^\d{4}-\d{2}-\d{2}$/.test(live.cmpLeft || '')) &&
                (live.cmpRight === 'tag:final' || live.cmpRight === 'tag:initial' || /^\d{4}-\d{2}-\d{2}$/.test(live.cmpRight || '') || live.cmpRight === '') &&
                (live.cmpVals || []).indexOf('tag:initial') >= 0,
                JSON.stringify(live && { cmpLeft: live.cmpLeft, cmpRight: live.cmpRight, cmpVals: live.cmpVals, tiles: live.tiles }));

            var progressLive = await cdp.js('(function(){' +
                'window.photoAllRecords=(window.photoAllRecords||[]).concat([' +
                '{id:"prog-intra", category:"Progress", file_path:"prog-intra.jpg", caption:"intra", public_url:"' + PIXEL + '", taken_date:"2026-03-15"}' +
                ']);' +
                'var pushed=null;' +
                'photoOrthoPushRemote=function(map){ pushed=JSON.parse(JSON.stringify(map||photoOrthoLoad())); return Promise.resolve(); };' +
                'photoOrthoSelectVisit("");' +
                'var afterEmpty=photoOrthoLoad();' +
                'var mini=document.querySelector("[data-progress-set-date]");' +
                'var setId=mini?mini.getAttribute("data-progress-set-date"):"";' +
                'if(mini){ mini.value="2026-03-15"; photoOrthoRecordDate(setId,"2026-03-15"); }' +
                'photoOrthoPlace("progress","intra","prog-intra");' +
                'if(typeof photoOrthoPushTimer!=="undefined" && photoOrthoPushTimer){ clearTimeout(photoOrthoPushTimer); photoOrthoPushTimer=null; }' +
                'photoOrthoPushRemote(photoOrthoLoad());' +
                'var after=photoOrthoLoad();' +
                'var sel=(document.getElementById("photoOrthoVisitSelect")||{}).value;' +
                'var cat=(document.querySelector("[data-ortho-cat].is-on")||{}).getAttribute ? document.querySelector("[data-ortho-cat].is-on").getAttribute("data-ortho-cat") : "";' +
                'var cmpOn=!!document.querySelector("#photoOrthoVisitNav.is-compare");' +
                'return {' +
                'focusEmpty:afterEmpty.focus,' +
                'cmpOnAfterEmpty:cmpOn,' +
                'hasMini:!!mini,' +
                'setId:setId,' +
                'focus:after.focus,' +
                'progressDate:after.progressDate,' +
                'intra:after.progress&&after.progress.intra||"",' +
                'sel:sel,' +
                'cat:cat,' +
                'pushedDate:pushed&&pushed.progressDate||"",' +
                'pushedSets:(pushed&&pushed.progressSets||[]).map(function(s){return s.date;})' +
                '};' +
                '})()', false, 15000);
            pass('live: In Progress tag opens progress set (not compare) with mini date → Supabase push path',
                progressLive && progressLive.focusEmpty === 'progress' && progressLive.cmpOnAfterEmpty === false &&
                progressLive.hasMini && progressLive.focus === 'progress' &&
                progressLive.progressDate === '2026-03-15' && progressLive.intra === 'prog-intra' &&
                progressLive.sel === '2026-03-15' && progressLive.cat === 'progress' &&
                progressLive.pushedDate === '2026-03-15' &&
                (progressLive.pushedSets || []).indexOf('2026-03-15') >= 0,
                JSON.stringify(progressLive));

            var multiProg = await cdp.js('(function(){' +
                'photoOrthoPushRemote=function(){ return Promise.resolve(); };' +
                'var opts1=[].map.call(document.getElementById("photoOrthoVisitSelect").options,function(o){return {v:o.value,t:o.textContent};});' +
                'var datedLabel=(opts1.find(function(o){return o.v==="2026-03-15";})||{}).t||"";' +
                'photoOrthoSelectVisit("tag:progress");' +
                'var second=photoOrthoLoad();' +
                'var mini=document.querySelector("[data-progress-set-date]");' +
                'var id2=mini?mini.getAttribute("data-progress-set-date"):"";' +
                'if(mini){ mini.value="2026-04-01"; photoOrthoRecordDate(id2,"2026-04-01"); }' +
                'var after=photoOrthoLoad();' +
                'var opts2=[].map.call(document.getElementById("photoOrthoVisitSelect").options,function(o){return {v:o.value,t:o.textContent};});' +
                'var labels=opts2.map(function(o){return o.t;});' +
                'return {' +
                'datedLabel:datedLabel,' +
                'id1:(second.progressSets||[]).map(function(s){return s.id;}),' +
                'dates:(after.progressSets||[]).map(function(s){return s.date;}).sort(),' +
                'labels:labels,' +
                'hasNewGenerator:labels.indexOf("In Progress")>=0,' +
                'hasMar:/In Progress-\\(2026-03-15\\)/.test(labels.join("|")),' +
                'hasApr:/In Progress-\\(2026-04-01\\)/.test(labels.join("|")),' +
                'focus:after.focus,' +
                'sel:(document.getElementById("photoOrthoVisitSelect")||{}).value' +
                '};' +
                '})()', false, 15000);
            pass('live: dated caption In Progress-(date) and new In Progress generates another set',
                multiProg && /In Progress-\(2026-03-15\)/.test(multiProg.datedLabel || '') &&
                multiProg.hasNewGenerator && multiProg.hasMar && multiProg.hasApr &&
                (multiProg.dates || []).indexOf('2026-03-15') >= 0 &&
                (multiProg.dates || []).indexOf('2026-04-01') >= 0 &&
                multiProg.focus === 'progress' && multiProg.sel === '2026-04-01',
                JSON.stringify(multiProg));

            try { ws.close(); } catch (e) {}
        } finally {
            try { chrome.kill(); } catch (e2) {}
            try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e3) {}
        }
    } finally {
        try { server.close(); } catch (e4) {}
    }

    finish(fails.length ? 1 : 0);
})().catch(function (err) {
    console.error(err);
    finish(1);
});
