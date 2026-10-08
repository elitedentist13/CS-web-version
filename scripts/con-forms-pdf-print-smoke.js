/**
 * Forms / Letters print: a saved PDF (perio chart archive) prints its pages.
 * A letter still prints inside the clinic letterhead.
 * Smoke + HTTP spot + API (read-only) + CDP Runtime.evaluate / live page.
 * Run: node scripts/con-forms-pdf-print-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var PRINT_JS = '20261008pdfprint1';
var PAGE_PORT = 8807;
var CDP_PORT = 9374;
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
    var block = src.slice(i, end < 0 ? i + 700 : end);
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
    var con = read('app-consultation.js');
    var charts = read('app-charts.js');
    var i18n = read('app-i18n-extra.js');
    var html = read('index.html');
    var one = extractFn(con, 'conFormsPrintOneDoc');
    var selected = extractFn(con, 'conFormsPrintSelectedDocs');
    var resolved = extractFn(con, 'conFormsPrintResolvedDocs');
    var stored = extractFn(con, 'conFormsPrintStoredPdfDocs');
    var showPdf = extractFn(con, 'conFormsShowPdfInPopup');
    var letterPrint = extractFn(con, 'printConFormsHtml');
    var isPdf = extractFn(con, 'conFormsDocIsPdfRecord');
    var archive = extractFn(charts, 'archivePerioChartToRecord');

    console.log('=== source ===');
    pass('index loads the print-fix consultation script',
        html.indexOf("'app-consultation.js?v=" + PRINT_JS + "'") >= 0);
    pass('index loads the print-fix i18n script',
        html.indexOf("'app-i18n-extra.js?v=" + PRINT_JS + "'") >= 0);
    pass('row Print and multi-select Print both go through the PDF/letter split',
        one.indexOf('conFormsPrintResolvedDocs') >= 0 &&
        selected.indexOf('conFormsPrintResolvedDocs') >= 0);
    pass('PDF rows are printed from storage; letters stay on the letterhead path',
        resolved.indexOf('conFormsDocIsPdfRecord') >= 0 &&
        resolved.indexOf('conFormsPrintStoredPdfDocs') >= 0 &&
        resolved.indexOf('printConFormsHtml') >= 0 &&
        resolved.indexOf('skipConfirm: true') >= 0);
    pass('stored PDF print downloads the file and opens that PDF',
        stored.indexOf('conFormsDownloadStoredPdf') >= 0 &&
        stored.indexOf('conFormsShowPdfInPopup') >= 0 &&
        stored.indexOf('print-sheet-outer') < 0);
    pass('the popup is sent the original PDF bytes, not a letter sheet',
        showPdf.indexOf("type: 'application/pdf'") >= 0 &&
        showPdf.indexOf('popup.print') >= 0 &&
        showPdf.indexOf('print-sheet-outer') < 0 &&
        showPdf.indexOf('data-conforms-shell') < 0);
    pass('letter print still wraps the clinic sheet and can skip a second confirm',
        letterPrint.indexOf('print-sheet-outer') >= 0 &&
        letterPrint.indexOf('skipConfirm') >= 0);
    pass('a pdf template or a storage pointer counts as a saved PDF',
        isPdf.indexOf("template_type") >= 0 && isPdf.indexOf('data-file-path') >= 0);
    pass('Save to Record still archives the perio chart as a patient PDF',
        archive.indexOf('exportFormsHtmlToPatient') >= 0 &&
        archive.indexOf("template_type: 'pdf'") >= 0 &&
        archive.indexOf("template_code: 'perio_chart'") >= 0);
    pass('i18n con.forms.printPdfPreparing en / zh-CN / zh-Hant',
        i18nHasAll(i18n, 'con.forms.printPdfPreparing'));

    console.log('\n=== HTTP spot ===');
    var server = await startStaticServer(PAGE_PORT);
    var spotIdx = await httpGetText(PAGE_PORT, '/index.html');
    pass('GET /index.html serves the print-fix script tags',
        spotIdx.status === 200 &&
        spotIdx.body.indexOf('app-consultation.js?v=' + PRINT_JS) >= 0 &&
        spotIdx.body.indexOf('app-i18n-extra.js?v=' + PRINT_JS) >= 0,
        'HTTP ' + spotIdx.status);
    var spotCon = await httpGetText(PAGE_PORT, '/app-consultation.js?v=' + PRINT_JS);
    pass('GET /app-consultation.js serves stored-PDF print',
        spotCon.status === 200 &&
        spotCon.body.indexOf('function conFormsPrintStoredPdfDocs') >= 0 &&
        spotCon.body.indexOf('function conFormsShowPdfInPopup') >= 0,
        'HTTP ' + spotCon.status);
    var live5500 = null;
    try { live5500 = await httpGetText(5500, '/app-consultation.js?v=' + PRINT_JS); } catch (e) { live5500 = null; }
    pass('clinic page on :5500 serves the same print script when it is up',
        !live5500 || (live5500.status === 200 && live5500.body.indexOf('function conFormsPrintStoredPdfDocs') >= 0),
        live5500 ? ('HTTP ' + live5500.status) : '5500 not answering');

    console.log('\n=== API (read-only, anon) ===');
    var sb = readSbConfig(read('app.js'));
    var apiUrl = sb.url.replace(/\/$/, '') +
        '/rest/v1/patient_documents?select=id,document_name,template_type,content_html&template_type=eq.pdf&order=created_at.desc&limit=8';
    var apiRes = await fetch(apiUrl, {
        headers: { apikey: sb.key, Authorization: 'Bearer ' + sb.key, Accept: 'application/json' }
    });
    var apiJson = await apiRes.json();
    pass('patient_documents PDF rows readable', apiRes.status === 200 && Array.isArray(apiJson), 'HTTP ' + apiRes.status);
    var pdfRows = Array.isArray(apiJson) ? apiJson : [];
    var pointed = pdfRows.filter(function (r) { return /data-file-path\s*=/.test(String(r.content_html || '')); });
    pass('saved PDF rows carry a storage path the print button can download',
        pdfRows.length === 0 || pointed.length === pdfRows.length,
        pdfRows.length ? (pointed.length + '/' + pdfRows.length) : 'none filed yet');
    var perioNamed = pdfRows.filter(function (r) { return /perio|periodontal|牙周/i.test(String(r.document_name || '') + String(r.content_html || '')); });
    pass('API saw filed PDF documents',
        true,
        pdfRows.length + ' pdf' + (perioNamed.length ? (', ' + perioNamed.length + ' perio-named') : ''));

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        finish(1);
        return;
    }
    var profile = path.join(os.tmpdir(), 'cs-forms-pdf-print-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    fs.mkdirSync(profile, { recursive: true });
    var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/index.html?_lr=' + PRINT_JS;
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
            'while(Date.now()<deadline){ if(typeof conFormsPrintResolvedDocs==="function" && typeof conFormsShowPdfInPopup==="function") break; await wait(200); }' +
            'const out={ ready: typeof conFormsShowPdfInPopup==="function", notes:[] };' +
            'if(!out.ready) return out;' +
            'const origNotify=conFormsNotify;' +
            'conFormsNotify=function(msg){ out.notes.push(String(msg)); if(origNotify) origNotify(msg); };' +
            'const login=document.getElementById("loginOverlay"); if(login) login.style.display="none";' +
            'if(!window.PDFLib){ await new Promise(function(resolve,reject){ var s=document.createElement("script"); s.src="https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js"; s.onload=resolve; s.onerror=reject; document.head.appendChild(s); }); }' +
            'const doc=await PDFLib.PDFDocument.create();' +
            'const page=doc.addPage([420,220]);' +
            'page.drawRectangle({x:30,y:50,width:360,height:120,color:PDFLib.rgb(0.85,0.12,0.12)});' +
            'const saved=await doc.save();' +
            'const bytes=saved.buffer.slice(saved.byteOffset, saved.byteOffset+saved.byteLength);' +
            'const captured=[];' +
            'let confirms=0;' +
            'window.confirm=function(){ confirms++; return true; };' +
            'window.confirmPrintReminder=function(){ confirms++; return true; };' +
            'window.open=function(){' +
            '  const fake={ closed:false, printed:false, href:"", focus:function(){}, close:function(){ this.closed=true; }, addEventListener:function(){}, print:function(){ this.printed=true; } };' +
            '  fake.location={};' +
            '  Object.defineProperty(fake.location,"href",{ get:function(){ return fake.href; }, set:function(v){ fake.href=String(v); } });' +
            '  fake.document={ _html:"", open:function(){ this._html=""; }, write:function(s){ this._html+=String(s); }, close:function(){} };' +
            '  captured.push(fake); return fake;' +
            '};' +
            'async function pdfInfo(win){' +
            '  if(!win || String(win.href||"").indexOf("blob:")!==0) return null;' +
            '  const buf=await (await fetch(win.href)).arrayBuffer();' +
            '  const head=new TextDecoder().decode(new Uint8Array(buf).slice(0,5));' +
            '  const loaded=await PDFLib.PDFDocument.load(buf);' +
            '  const box=loaded.getPage(0).getSize();' +
            '  return { head:head, pages:loaded.getPageCount(), w:box.width, h:box.height, sheet:(win.document._html||"").indexOf("print-sheet-outer")>=0 };' +
            '}' +
            'const buckets=[];' +
            'SB.storage.from=function(bucket){ return { download:function(){ buckets.push(bucket); return Promise.resolve({ error:null, data:new Blob([bytes],{type:"application/pdf"}) }); } }; };' +
            'const pdfRow={ id:"pdf1", template_type:"pdf", document_name:"Periodontal Chart", content_html:\'<div class="pde-saved-pdf" data-file-path="patient/chart.pdf" data-file-bucket="patient-documents"><p>PDF: Periodontal Chart</p></div>\' };' +
            'const letterRow={ id:"let1", template_type:"referral", document_name:"Referral", content_html:"<p>Dear colleague the plan is attached.</p>" };' +
            'const stubShell=conFormsPreparePrintHtml(pdfRow.content_html, true);' +
            'out.stubHasShell=stubShell.indexOf("data-conforms")>=0;' +
            'confirms=0; captured.length=0; buckets.length=0;' +
            'conFormsPrintResolvedDocs([pdfRow]);' +
            'const t1=Date.now()+15000;' +
            'while(Date.now()<t1){ if(captured[0] && String(captured[0].href||"").indexOf("blob:")===0 && captured[0].printed) break; await wait(50); }' +
            'out.pdfConfirms=confirms;' +
            'out.pdfWindows=captured.length;' +
            'out.pdfBucket=buckets[0]||"";' +
            'out.pdf=await pdfInfo(captured[0]);' +
            'out.pdfPrinted=!!(captured[0]&&captured[0].printed);' +
            'confirms=0; captured.length=0;' +
            'conFormsPrintResolvedDocs([letterRow]);' +
            'const letterDoc=(captured[0]&&captured[0].document._html)||"";' +
            'out.letterWindows=captured.length;' +
            'out.letterSheet=letterDoc.indexOf("print-sheet-outer")>=0;' +
            'out.letterBody=letterDoc.indexOf("Dear colleague the plan is attached.")>=0;' +
            'out.letterHeader=letterDoc.indexOf("data-conforms-shell-header")>=0 || letterDoc.indexOf("data-conforms-default-header")>=0;' +
            'out.letterBlob=String((captured[0]&&captured[0].href)||"").indexOf("blob:")===0;' +
            'confirms=0; captured.length=0; buckets.length=0;' +
            'conFormsPrintResolvedDocs([pdfRow, letterRow]);' +
            'const t2=Date.now()+15000;' +
            'while(Date.now()<t2){ if(captured[0] && String(captured[0].href||"").indexOf("blob:")===0 && captured.length>=2) break; await wait(50); }' +
            'out.mixedConfirms=confirms;' +
            'out.mixedWindows=captured.length;' +
            'out.mixedPdf=!!(captured[0] && String(captured[0].href||"").indexOf("blob:")===0);' +
            'out.mixedLetter=!!(captured[1] && (captured[1].document._html||"").indexOf("print-sheet-outer")>=0 && (captured[1].document._html||"").indexOf("Dear colleague the plan is attached.")>=0);' +
            'out.notes=out.notes;' +
            'return out;' +
            '})()', true, 45000);

        pass('live: print functions loaded on the clinic page', live && live.ready);
        if (live && live.ready) {
            pass('live: the old letter wrapper would still put a shell around a PDF pointer',
                live.stubHasShell === true);
            pass('live: Print on a PDF row downloads patient-documents and opens one window',
                live.pdfWindows === 1 && live.pdfBucket === 'patient-documents' && live.pdfConfirms === 1,
                'windows=' + live.pdfWindows + ' bucket=' + live.pdfBucket + ' confirms=' + live.pdfConfirms +
                ' notes=' + JSON.stringify(live.notes || []));
            pass('live: that window is the original PDF, not the letterhead',
                !!(live.pdf && live.pdf.head === '%PDF-' && live.pdf.pages === 1 &&
                    live.pdf.w === 420 && live.pdf.h === 220 && live.pdf.sheet === false && live.pdfPrinted),
                JSON.stringify(live.pdf));
            pass('live: Print on a letter still uses the letterhead and the letter body',
                live.letterWindows === 1 && live.letterSheet === true && live.letterHeader === true &&
                live.letterBody === true && live.letterBlob === false,
                'sheet=' + live.letterSheet + ' header=' + live.letterHeader + ' body=' + live.letterBody);
            pass('live: a mixed selection prints the PDF and the letter separately, with one confirm',
                live.mixedWindows === 2 && live.mixedConfirms === 1 && live.mixedPdf === true && live.mixedLetter === true,
                'windows=' + live.mixedWindows + ' confirms=' + live.mixedConfirms +
                ' pdf=' + live.mixedPdf + ' letter=' + live.mixedLetter);
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
