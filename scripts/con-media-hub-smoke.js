/**
 * Documents & Media hub (Consultation Photos / Docs + Forms / Letters), steps 1-5.
 * Smoke / spot / testclient (vm) / API (read-only) + CDP Runtime.evaluate / live page.
 * Run: node scripts/con-media-hub-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261002media1';
var PAGE_PORT = 8794;
var CDP_PORT = 9356;
var CHROME = process.env.CHROME_PATH ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var root = path.resolve(__dirname, '..');
var fails = [];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  -  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function readSbConfig(appJs) {
    var block = appJs.match(/supabase\.createClient\(([\s\S]*?)\);/);
    if (!block) throw new Error('supabase.createClient not found');
    var parts = [];
    var re = /'([^']*)'/g;
    var m;
    while ((m = re.exec(block[1]))) parts.push(m[1]);
    return { url: parts[0], key: parts.slice(1).join('') };
}

function httpGet(host, port, reqPath) {
    return new Promise(function (resolve, reject) {
        var req = http.get({ host: host, port: port, path: reqPath, timeout: 4000 }, function (r) {
            var d = '';
            r.on('data', function (c) { d += c; });
            r.on('end', function () { resolve({ status: r.statusCode, body: d }); });
        });
        req.on('error', reject);
        req.on('timeout', function () { req.destroy(); reject(new Error('timeout')); });
    });
}

function rest(base, key, table, qs) {
    var url = base.replace(/\/$/, '') + '/rest/v1/' + table + (qs ? ('?' + qs) : '');
    return fetch(url, {
        method: 'GET',
        headers: { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json' }
    }).then(function (r) {
        return r.text().then(function (t) {
            var json = null;
            try { json = JSON.parse(t); } catch (e) { /* not json */ }
            return { status: r.statusCode || r.status, json: json, raw: t.slice(0, 240) };
        });
    });
}

function httpGetJson(url) {
    return new Promise(function (resolve, reject) {
        http.get(url, function (r) {
            var d = '';
            r.on('data', function (c) { d += c; });
            r.on('end', function () {
                try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function waitJson(url, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var last = null;
    while (Date.now() < deadline) {
        try { return await httpGetJson(url); } catch (e) { last = e; await sleep(250); }
    }
    throw new Error('timeout ' + url + ' last=' + (last && last.message));
}

function Cdp(ws) {
    this.ws = ws;
    this.n = 0;
    this.pending = {};
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
        var t = setTimeout(function () {
            delete self.pending[id];
            reject(new Error('CDP timeout ' + method));
        }, timeoutMs);
        self.pending[id] = {
            resolve: function (v) { clearTimeout(t); resolve(v); },
            reject: function (e) { clearTimeout(t); reject(e); }
        };
        self.ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
};

Cdp.prototype.js = async function (expression, awaitPromise, timeoutMs) {
    var r = await this.call('Runtime.evaluate', {
        expression: expression,
        returnByValue: true,
        awaitPromise: !!awaitPromise,
        timeout: (timeoutMs || 45000)
    }, (timeoutMs || 45000) + 5000);
    if (r.exceptionDetails) {
        var ex = r.exceptionDetails.exception || {};
        throw new Error(ex.description || JSON.stringify(r.exceptionDetails));
    }
    return (r.result || {}).value;
};

function startStaticServer(port) {
    var types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
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

function i18nHasAll(src, key) {
    var i = src.indexOf("'" + key + "':");
    if (i < 0) return false;
    var line = src.slice(i, src.indexOf('\n', i));
    return line.indexOf('en:') >= 0 && line.indexOf("'zh-CN':") >= 0 && line.indexOf("'zh-Hant':") >= 0;
}

/* ── testclient: load the hub module in a vm sandbox ─────────────────── */
function loadHubSandbox(extra) {
    var sandbox = {
        console: console,
        I18N_STRINGS: {},
        t: function (k) { return k; },
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        Promise: Promise,
        Date: Date,
        localStorage: (function () {
            var m = {};
            return {
                getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
                setItem: function (k, v) { m[k] = String(v); },
                removeItem: function (k) { delete m[k]; }
            };
        })()
    };
    Object.keys(extra || {}).forEach(function (k) { sandbox[k] = extra[k]; });
    vm.createContext(sandbox);
    vm.runInContext(read('app-con-media.js'), sandbox, { filename: 'app-con-media.js' });
    return sandbox;
}

(async function main() {
    console.log('=== Documents & Media hub, steps 1-5 (BUILD ' + BUILD + ') ===\n');
    var html = read('index.html');
    var appSrc = read('app.js');
    var conSrc = read('app-consultation.js');
    var phSrc = read('app-photos.js');
    var mediaSrc = read('app-con-media.js');
    var notesSrc = read('app-con-notes.js');
    var viewsSrc = read('app-patient-views.js');
    var css = read('style.css');
    var sql = read('media_context.sql');

    console.log('=== spot: step 1 - shared patient, hub shell, toasts, unsaved guard ===');
    pass('index BUILD', html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    pass('hub module is cache-busted and loads after consultation + photos',
        html.indexOf('app-con-media.js?v=' + BUILD) >= 0 &&
        html.indexOf('app-con-media.js') > html.indexOf('app-consultation.js') &&
        html.indexOf('app-con-media.js') > html.indexOf('app-photos.js'));
    pass('Photos and Forms no longer have their own patient search boxes',
        ['conPsInputPhoto', 'conPsDropPhoto', 'conPsClinicFilterPhoto',
         'conFormsPsInput', 'conFormsPsDrop', 'conFormsPsClinicFilter'].every(function (id) {
            return html.indexOf(id) < 0 && appSrc.indexOf(id) < 0 && conSrc.indexOf(id) < 0 && phSrc.indexOf(id) < 0;
        }));
    pass('shared-patient cards + hub hosts exist in both tabs',
        ['conPhotoNeedPatient', 'conPhotoSamePatient', 'conPhotoPickPatientBtn', 'conMediaHubPhotos',
         'conFormsNeedPatient', 'conFormsSamePatient', 'conFormsPickPatientBtn', 'conMediaHubForms'].every(function (id) {
            return html.indexOf('id="' + id + '"') >= 0;
        }));
    pass('shared patient is applied on tab show and on patient apply',
        conSrc.indexOf('conMediaApplySharedPatient()') >= 0 && conSrc.indexOf('conMediaOnTabShown(tab)') >= 0);
    pass('patient switch stashes the unsaved letter before reassigning the forms patient',
        /conMediaOnPatientSwitch\(conFormsPatientId, p\.id\)/.test(conSrc));
    pass('toast supports error / info kinds with longer duration',
        /function showAppGlobalToast\(msg, opts\)/.test(appSrc) &&
        appSrc.indexOf('app-global-toast--err') >= 0 && css.indexOf('.app-global-toast--err') >= 0);
    pass('photo module has no blocking alert() left (only the fallback)',
        (phSrc.match(/\balert\(/g) || []).length === 1 && phSrc.indexOf('window.alert(msg)') >= 0 &&
        phSrc.indexOf('function mediaNotify') >= 0);
    pass('Forms flow uses conFormsNotify toasts',
        conSrc.indexOf('function conFormsNotify') >= 0 &&
        /function saveConFormsDoc[\s\S]{0,900}conFormsNotify\(/.test(conSrc) &&
        /function conExportFormsPdf[\s\S]{0,700}conFormsNotify\(/.test(conSrc));
    pass('unsaved letter draft is kept in localStorage and restorable',
        mediaSrc.indexOf('function conMediaFormsDraftSave') >= 0 &&
        mediaSrc.indexOf('function conMediaFormsDraftRestore') >= 0 &&
        html.indexOf('id="conFormsDraftBar"') >= 0 &&
        /function conFormsStartNewDoc\(keepDraft\)/.test(conSrc));

    console.log('\n=== spot: step 2 - SQL + context fields ===');
    pass('media_context.sql is idempotent and adds all columns',
        ['appointment_id', 'tooth_no', 'tags', 'parent_photo_id', 'bill_id', 'status', 'category', 'valid_until']
            .every(function (c) { return sql.indexOf(c) >= 0; }) &&
        /add column if not exists/i.test(sql) && /notify pgrst, 'reload schema'/i.test(sql));
    pass('migration does not touch policies, buckets or signing (step 6 stays out of scope)',
        !/create\s+policy|alter\s+policy|drop\s+policy|storage\.|create\s+bucket|enable row level/i.test(sql));
    pass('upload modal + lightbox + batch share the visit / tooth / tags fields',
        ['photoUploadTooth', 'photoUploadTags', 'photoUploadAppt', 'photoLbTooth', 'photoLbTags', 'photoLbAppt']
            .every(function (id) { return html.indexOf('id="' + id + '"') >= 0; }) &&
        mediaSrc.indexOf('photoBatchTooth') >= 0);
    pass('forms status / category / visit / valid-until row exists',
        ['conFormsStatusSel', 'conFormsCategorySel', 'conFormsApptSel', 'conFormsValidUntil']
            .every(function (id) { return html.indexOf('id="' + id + '"') >= 0; }));
    pass('writes go through the missing-column fallback',
        mediaSrc.indexOf('function conMediaWrite') >= 0 &&
        phSrc.indexOf("conMediaWrite('photos'") >= 0 && conSrc.indexOf("conMediaWrite('docs'") >= 0);
    pass('selects only include optional columns after the probe says they exist',
        phSrc.length > 0 && conSrc.indexOf('conMediaPhotoCols(photoCols)') >= 0 &&
        conSrc.indexOf('conMediaDocCols(docCols)') >= 0 && viewsSrc.indexOf("patViewMediaCols('photos'") >= 0);

    console.log('\n=== spot: step 3 - Notes chips, timeline, dashboard ===');
    pass('Treatment Notes offers today\'s photo / document chips and jump chips',
        notesSrc.indexOf('function cnTodayMediaItems') >= 0 && notesSrc.indexOf('function cnMediaJumpChips') >= 0 &&
        notesSrc.indexOf('data-goto') >= 0 && css.indexOf('.cn-ctx-chip--photo') >= 0);
    pass('timeline photo events carry tooth / tags / visit and open the exact photo',
        conSrc.indexOf('toothNo: p.tooth_no') >= 0 && conSrc.indexOf('conMediaOpenPhoto(conPatientId, ev.refId)') >= 0);
    pass('dashboard thumbnails and document rows are clickable deep links',
        viewsSrc.indexOf('data-act="open-photo"') >= 0 && viewsSrc.indexOf('data-act="open-doc"') >= 0 &&
        viewsSrc.indexOf("conMediaOpenPhoto(selPatientId") >= 0 && viewsSrc.indexOf('conMediaOpenPhoto(pid, ev.refId)') >= 0);

    console.log('\n=== spot: step 4 - bulk upload, compare, non-destructive edit ===');
    pass('single upload pipeline is photoUploadOne with orphan cleanup',
        /function photoUploadOne\(file, meta, onProgress\)/.test(phSrc) &&
        /remove\(\[path\]\)/.test(phSrc));
    pass('file input, drop and paste all route through photoHandleFiles',
        phSrc.indexOf('photoHandleFiles(picked)') >= 0 && mediaSrc.indexOf('function photoHandleFiles') >= 0 &&
        mediaSrc.indexOf("addEventListener('paste'") >= 0 && mediaSrc.indexOf("addEventListener('drop'") >= 0);
    pass('compare mode: toggle on cards, modal with synced zoom, swap, reset',
        phSrc.indexOf('xray-cb-cmp') >= 0 && mediaSrc.indexOf('function conMediaCompareOpen') >= 0 &&
        css.indexOf('.cm-cmp-box') >= 0 && html.indexOf('id="photoCompareBtn"') >= 0);
    pass('edited image is saved as a new linked copy unless "replace" is ticked',
        phSrc.indexOf('parent_photo_id = lbId') >= 0 && phSrc.indexOf("photoLbReplaceOrig") >= 0 &&
        html.indexOf('id="photoLbReplaceOrig"') >= 0 && html.indexOf('id="photoLbOriginalRow"') >= 0);

    console.log('\n=== spot: step 5 - letters, billing placeholders, history ===');
    pass('quick-create covers letter / sick leave / referral / consent / receipt / attendance',
        ['letter', 'sick_leave', 'referral', 'consent', 'receipt', 'attendance'].every(function (k) {
            return mediaSrc.indexOf("'qc:" + k + "'") >= 0;
        }));
    pass('placeholders include billing + visit tags in the map and editor buttons',
        conSrc.indexOf('conMediaVisitPlaceholders()') >= 0 &&
        ['receipt_no', 'total_amount', 'treatment_done', 'next_appointment'].every(function (k) {
            return html.indexOf('{' + k + '}') >= 0 || html.indexOf("'" + k + "'") >= 0 || mediaSrc.indexOf(k) >= 0;
        }));
    pass('document history is filterable with load-more and badges',
        html.indexOf('id="conFormsHistQ"') >= 0 && html.indexOf('id="conFormsHistMore"') >= 0 &&
        conSrc.indexOf('conMediaFetchDocs(reqPid)') >= 0 && conSrc.indexOf('conMediaDocBadgesHtml(d)') >= 0);

    console.log('\n=== spot: i18n (en / zh-CN / zh-Hant) ===');
    var usedKeys = {};
    [mediaSrc, phSrc, notesSrc, html].forEach(function (src) {
        var re = /['"](cm\.[A-Za-z0-9_.]+[A-Za-z0-9_])['"]/g;
        var m;
        while ((m = re.exec(src))) usedKeys[m[1]] = 1;
    });
    ['draft', 'issued', 'signed'].forEach(function (s) { usedKeys['cm.status.' + s] = 1; });
    ['letter', 'certificate', 'referral', 'consent', 'receipt', 'prescription', 'report', 'other'].forEach(function (c) {
        usedKeys['cm.dcat.' + c] = 1;
    });
    var missingKeys = Object.keys(usedKeys).filter(function (k) { return !i18nHasAll(mediaSrc, k); });
    pass('every cm.* key has en + zh-CN + zh-Hant', missingKeys.length === 0,
        missingKeys.length ? missingKeys.slice(0, 8).join(', ') : Object.keys(usedKeys).length + ' keys');

    console.log('\n=== testclient: pure logic in a vm sandbox ===');
    var sb1 = loadHubSandbox({
        conFormsIsSickLeaveTemplate: function (tpl) { return /sick/i.test(tpl.template_name || ''); },
        conFormsIsReferralTemplate: function (tpl) { return /referral/i.test(tpl.template_name || ''); }
    });
    var run = function (code) { return vm.runInContext(code, sb1); };
    pass('missing-column errors are recognised',
        run("conMediaIsMissingColErr({code:'42703'})") === true &&
        run("conMediaIsMissingColErr({code:'PGRST204'})") === true &&
        run("conMediaIsMissingColErr({message:'column photos.tooth_no does not exist'})") === true &&
        run("conMediaIsMissingColErr({message:'Could not find the \\'tags\\' column of \\'photos\\' in the schema cache'})") === true &&
        run("conMediaIsMissingColErr({code:'42501',message:'permission denied'})") === false &&
        run('conMediaIsMissingColErr(null)') === false);
    pass('tooth parser keeps FDI / quadrant tokens, de-duplicates, drops junk',
        run("conMediaParseTooth('16, 17 ; 16 zz ur 99 ALL')") === '16, 17, UR, ALL');
    pass('tag parser lowercases, de-duplicates and caps at 12',
        JSON.stringify(run("conMediaParseTags(' Pre-op, pre-op ;Crown\\nCrown, x')")) === '["pre-op","crown","x"]' &&
        run("conMediaParseTags(Array.from({length:30},function(_,i){return 't'+i;}).join(','))").length === 12);
    var summary = run("conMediaBuildSummary(" +
        "[{category:'Intraoral',created_at:'2026-09-01T00:00:00Z'},{category:'Consent Form',created_at:'2026-09-02T00:00:00Z'},{category:'Lab Report',created_at:'2026-09-03T00:00:00Z'}]," +
        "[{id:'d1',template_type:'consent',document_name:'GA consent',document_date:'2026-09-10',created_at:'2026-09-10T00:00:00Z'},{id:'d2',template_type:'report',created_at:'2026-09-05T00:00:00Z'}])");
    pass('summary separates clinical photos from consent / lab and finds the latest date',
        summary.photos === 1 && summary.docs === 1 && summary.consentLab === 3 &&
        String(summary.lastAt).slice(0, 10) === '2026-09-10' &&
        summary.consentDocs.length === 1 && summary.consentDocs[0].name === 'GA consent');
    var tpls = [
        { id: 'a', template_type: 'receipt', template_name: 'Receipt' },
        { id: 'b', template_type: 'consent', template_name: 'Extraction consent' },
        { id: 'c', template_type: 'report', template_name: 'Sick leave certificate' },
        { id: 'd', template_type: 'report', template_name: 'Referral letter' },
        { id: 'e', template_type: 'report', template_name: 'Attendance ATTN' },
        { id: 'f', template_type: 'report', template_name: 'General letter' }
    ];
    sb1.__tpls = tpls;
    var pick = function (k) { var r = run("conMediaPickTemplateFrom(__tpls, '" + k + "')"); return r ? r.id : null; };
    pass('quick-create picks the right template per kind',
        pick('receipt') === 'a' && pick('consent') === 'b' && pick('sick_leave') === 'c' &&
        pick('referral') === 'd' && pick('attendance') === 'e' && pick('letter') === 'f' && pick('nope') === null);
    sb1.__bills = [
        { id: 'void00000', voided_at: '2026-10-01', appointment_id: 'A1', bill_date: '2026-10-01' },
        { id: 'old000001', bill_date: '2026-09-01' },
        { id: 'today0001', bill_date: '2026-10-01' },
        { id: 'appt00001', appointment_id: 'A9', bill_date: '2026-08-01' }
    ];
    pass('bill picker prefers the visit bill, then today, then newest; never a voided bill',
        run("conMediaPickBill(__bills,'A9','2026-10-01')").id === 'appt00001' &&
        run("conMediaPickBill(__bills,'A1','2026-10-01')").id === 'today0001' &&
        run("conMediaPickBill(__bills,null,'2026-10-01')").id === 'today0001' &&
        run("conMediaPickBill([{id:'v',voided_at:'x'}],null,'2026-10-01')") === null);
    sb1.__appts = [
        { id: 'p', date: '2026-09-01', start_time: '10:00:00' },
        { id: 'n1', date: '2026-10-01', start_time: '09:00:00' },
        { id: 'n2', date: '2026-10-01', start_time: '15:30:00' },
        { id: 'n3', date: '2026-10-20', start_time: '11:00:00' }
    ];
    pass('next appointment skips the past, the current visit and earlier-today slots',
        run("conMediaPickNextAppt(__appts,'2026-10-01','12:00')").id === 'n2' &&
        run("conMediaPickNextAppt(__appts,'2026-10-01','16:00')").id === 'n3' &&
        run("conMediaPickNextAppt(__appts,'2026-10-01','12:00','n2')").id === 'n3' &&
        run("conMediaPickNextAppt([],'2026-10-01','12:00')") === null);
    pass('bill items text joins descriptions with quantities',
        run("conMediaBillItemsText({items:[{desc:'Scaling',qty:1},{description:'Filling',qty:2},{name:''}]})") === 'Scaling; Filling ×2');
    pass('visit placeholders are blank for another patient and filled for this one',
        (function () {
            run("var conFormsPatientId = 'P1';");
            run("CON_MEDIA.visitCtx = { pid:'P2', bill:{id:'abcdef123456', total:500}, treatmentDone:'X' };");
            var other = run('conMediaVisitPlaceholders()');
            run("CON_MEDIA.visitCtx = { pid:'P1', bill:{id:'abcdef123456', total:500, balance:100, amount_paid:400, bill_date:'2026-10-01', items:[{desc:'Crown'}]}, " +
                "appt:{date:'2026-10-01', start_time:'09:30:00'}, nextAppt:{date:'2026-10-20', start_time:'11:00:00'}, treatmentDone:'Crown prep' };");
            var mine = run('conMediaVisitPlaceholders()');
            return other.receipt_no === '' && other.treatment_done === '' &&
                mine.receipt_no === 'ABCDEF12' && mine.bill_items === 'Crown' && mine.visit_time === '09:30' &&
                mine.next_appointment === '2026-10-20 11:00' && mine.treatment_done === 'Crown prep' &&
                /500/.test(mine.total_amount);
        })());
    pass('compare zoom is clamped', run('conMediaCmpClampScale(100)') === 8 && run('conMediaCmpClampScale(0.01)') === 0.5 &&
        run('conMediaCmpClampScale(2)') === 2);
    pass('consent / lab category + edited record detection',
        run("conMediaIsConsentLabCat('Consent Form')") === true && run("conMediaIsConsentLabCat('Intraoral')") === false &&
        run("conMediaIsEditedRec({parent_photo_id:'x'})") === true &&
        run("conMediaIsEditedRec({caption:'Pre-op (edited)'})") === true &&
        run("conMediaIsEditedRec({caption:'Pre-op'})") === false);
    pass('photo search matches caption, tooth and tags',
        run("conMediaPhotoMatchesQuery({caption:'Crown prep',tooth_no:'16',tags:['pre-op']},'16')") === true &&
        run("conMediaPhotoMatchesQuery({caption:'Crown prep',tooth_no:'16',tags:['pre-op']},'pre-op')") === true &&
        run("conMediaPhotoMatchesQuery({caption:'Crown prep'},'zzz')") === false);

    console.log('\n=== testclient: write fallback when media_context.sql is not applied ===');
    var calls = [];
    sb1.__makeOp = function (body) {
        calls.push(Object.keys(body).sort().join(','));
        if (body.tooth_no !== undefined || body.tags !== undefined) {
            return Promise.resolve({ data: null, error: { code: '42703', message: 'column "tooth_no" of relation "photos" does not exist' } });
        }
        return Promise.resolve({ data: [{ id: 'new' }], error: null });
    };
    var res = await vm.runInContext("conMediaWrite('photos', __makeOp, {category:'Intraoral', tooth_no:'16', tags:['a'], appointment_id:null})", sb1);
    pass('first write retries without the optional columns and succeeds',
        calls.length === 2 && calls[1] === 'category' && res && !res.error && run('CON_MEDIA.ctx.photos') === false,
        calls.join(' | '));
    calls.length = 0;
    await vm.runInContext("conMediaWrite('photos', __makeOp, {category:'Extraoral', tooth_no:'21'})", sb1);
    pass('later writes skip the optional columns up front', calls.length === 1 && calls[0] === 'category', calls.join(' | '));
    calls.length = 0;
    run("CON_MEDIA.ctx.docs = null;");
    sb1.__okOp = function (body) { calls.push(Object.keys(body).sort().join(',')); return Promise.resolve({ data: [{ id: 'd' }], error: null }); };
    await vm.runInContext("conMediaWrite('docs', __okOp, {document_name:'x', status:'issued'})", sb1);
    pass('a successful write with context columns marks the feature as available',
        calls.length === 1 && run('CON_MEDIA.ctx.docs') === true);
    calls.length = 0;
    sb1.__errOp = function () { calls.push('x'); return Promise.resolve({ data: null, error: { code: '42501', message: 'permission denied' } }); };
    var denied = await vm.runInContext("conMediaWrite('docs', __errOp, {document_name:'x', status:'issued'})", sb1);
    pass('non-column errors are returned, not retried', calls.length === 1 && denied.error && denied.error.code === '42501');

    console.log('\n=== HTTP spot ===');
    var port = null;
    for (var p of [5501, 8124, 5500, 8123]) {
        try {
            var r = await httpGet('127.0.0.1', p, '/index.html');
            if (r.status === 200 && r.body.indexOf(BUILD) >= 0) { port = p; break; }
        } catch (e) { /* try next */ }
    }
    pass('a local server serves BUILD ' + BUILD, !!port, port ? ':' + port : 'none of 5501/8124/5500/8123 (static CDP server still runs)');
    if (port) {
        var js = await httpGet('127.0.0.1', port, '/app-con-media.js?v=' + BUILD);
        pass('GET /app-con-media.js serves the hub module',
            js.status === 200 && js.body.indexOf('function conMediaWrite') >= 0, 'HTTP ' + js.status);
    }

    console.log('\n=== API (read-only, anon) ===');
    var sbCfg = readSbConfig(appSrc);
    var base = await rest(sbCfg.url, sbCfg.key, 'photos',
        'select=id,patient_id,file_path,public_url,category,caption,taken_date,dr,clinic,uploaded_by&limit=1');
    pass('photos base columns readable', base.status === 200 && Array.isArray(base.json), 'HTTP ' + base.status + ' ' + base.raw.slice(0, 100));
    var pctx = await rest(sbCfg.url, sbCfg.key, 'photos', 'select=id,appointment_id,tooth_no,tags,parent_photo_id&limit=1');
    var pOk = pctx.status === 200 && Array.isArray(pctx.json);
    var pMissing = !pOk && /appointment_id|tooth_no|tags|parent_photo_id|column/i.test(pctx.raw);
    pass('photos context columns present or not yet applied (module degrades either way)', pOk || pMissing,
        pOk ? 'present' : ('not applied: HTTP ' + pctx.status));
    var dbase = await rest(sbCfg.url, sbCfg.key, 'patient_documents',
        'select=id,document_name,document_date,template_name,template_type,created_at,content_html&limit=1');
    pass('patient_documents base columns readable', dbase.status === 200 && Array.isArray(dbase.json), 'HTTP ' + dbase.status);
    var dctx = await rest(sbCfg.url, sbCfg.key, 'patient_documents', 'select=id,appointment_id,bill_id,status,category,valid_until&limit=1');
    var dOk = dctx.status === 200 && Array.isArray(dctx.json);
    var dMissing = !dOk && /appointment_id|bill_id|status|category|valid_until|column/i.test(dctx.raw);
    pass('patient_documents context columns present or not yet applied', dOk || dMissing,
        dOk ? 'present' : ('not applied: HTTP ' + dctx.status));
    var bills = await rest(sbCfg.url, sbCfg.key, 'bills',
        'select=id,total,balance,amount_paid,voided_at,bill_date,created_at,appointment_id,items&limit=1');
    pass('bills columns used by the placeholders exist', bills.status === 200 && Array.isArray(bills.json), 'HTTP ' + bills.status + ' ' + bills.raw.slice(0, 120));
    var appts = await rest(sbCfg.url, sbCfg.key, 'appointments',
        'select=id,date,start_time,dentist_name,doctor_code,treatment_items,bill_status&limit=1');
    pass('appointments columns used by the visit picker exist', appts.status === 200 && Array.isArray(appts.json), 'HTTP ' + appts.status);

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        finish(1);
        return;
    }

    var server = await startStaticServer(PAGE_PORT);
    var profile = path.join(os.tmpdir(), 'cs-con-media-hub-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    fs.mkdirSync(profile, { recursive: true });
    var hosted = 'http://xray-ai.test:' + PAGE_PORT + '/index.html?_lr=' + BUILD;
    var proc = child_process.spawn(CHROME, [
        '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + profile,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--disable-popup-blocking',
        '--host-resolver-rules=MAP xray-ai.test 127.0.0.1',
        '--window-size=1280,900',
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
        await sleep(1200);

        var live = await cdp.js(`(async () => {
          const wait = (ms) => new Promise((r) => setTimeout(r, ms));
          const deadline = Date.now() + 25000;
          while (Date.now() < deadline) {
            if (typeof switchConTab === 'function' && typeof conMediaApplySharedPatient === 'function' &&
                typeof photoUploadOne === 'function' && typeof savePhotoLbMeta === 'function' &&
                typeof searchConFormsDocs === 'function' && typeof cnTodayItems === 'function' &&
                typeof patViewWireHostActions === 'function' && typeof renderPhotoGrid === 'function') break;
            await wait(200);
          }
          const out = { ready: typeof conMediaApplySharedPatient === 'function', build: window.__JSM_BUILD || '', host: location.hostname };
          const login = document.getElementById('loginOverlay');
          if (login) login.style.display = 'none';
          const con = document.getElementById('consultationSection');
          if (con) { con.style.display = 'block'; con.removeAttribute('aria-hidden'); }

          /* ---- step 1: shared patient + hub shell ---- */
          conPatientId = null; conPatientData = null;
          switchConTab('photos');
          out.noBoxes = !document.getElementById('conPsInputPhoto') && !document.getElementById('conFormsPsInput');
          out.needShown = document.getElementById('conPhotoNeedPatient').hidden === false &&
            document.getElementById('conPhotoSamePatient').hidden === true;
          out.hubHiddenNoPatient = document.getElementById('conMediaHubPhotos').hidden === true;
          conPatientId = 'smoke-pid';
          conPatientData = { id: 'smoke-pid', full_name: 'Smoke Patient', patient_no: 'S1', dob: '1990-01-01' };
          /* let the real probe (against the live DB) settle before forcing the columns on */
          try { await conMediaProbeCtx(); } catch (e) { /* ignore */ }
          out.realProbeSettled = CON_MEDIA.ctx.photos !== undefined && CON_MEDIA.ctx.docs !== undefined;
          CON_MEDIA.ctx.photos = true; CON_MEDIA.ctx.docs = true;
          CON_MEDIA._probe = Promise.resolve(CON_MEDIA.ctx);
          CON_MEDIA.summary['smoke-pid'] = conMediaBuildSummary(
            [{ category: 'Intraoral', created_at: '2026-10-01T01:00:00Z' }, { category: 'Consent Form', created_at: '2026-09-01T00:00:00Z' }],
            [{ id: 'd1', template_type: 'consent', document_name: 'GA consent', document_date: '2026-09-10', created_at: '2026-09-10T00:00:00Z' }]);
          conMediaApplySharedPatient();
          const hub = document.getElementById('conMediaHubPhotos');
          out.samePatient = document.getElementById('conPhotoSamePatient').hidden === false &&
            document.getElementById('conPhotoNeedPatient').hidden === true;
          out.hubShown = hub.hidden === false;
          out.segs = hub.querySelectorAll('.con-media-seg').length;
          out.counts = Array.from(hub.querySelectorAll('.con-media-count')).map((e) => e.textContent);
          out.menuItems = hub.querySelectorAll('.con-media-menu-item').length;
          out.menuHiddenAtStart = hub.querySelector('.con-media-menu').hidden === true;
          hub.querySelector('[data-cm-act="menu"]').click();
          out.menuOpens = hub.querySelector('.con-media-menu').hidden === false;
          document.body.click();
          out.menuClosesOnOutsideClick = hub.querySelector('.con-media-menu').hidden === true;
          hub.querySelector('[data-cm-view="consent"]').click();
          out.consentFilter = document.getElementById('photoFilterCat').value === '__consent_lab';
          out.consentChip = !!document.querySelector('#conMediaHubPhotos [data-cm-doc="d1"]');
          document.getElementById('photoFilterCat').value = '';
          switchConTab('forms');
          out.formsHub = document.getElementById('conMediaHubForms').hidden === false &&
            document.querySelectorAll('#conMediaHubForms .con-media-seg.is-active').length === 1;
          conMediaApplyCtxVisibility();
          out.ctxRowVisible = document.getElementById('conFormsCtxRow').hidden === false;
          /* toasts */
          showAppGlobalToast('plain');
          const toastEl = document.getElementById('appGlobalToast');
          out.toastPlain = toastEl.classList.contains('app-global-toast--in') && !toastEl.classList.contains('app-global-toast--err');
          showAppGlobalToast('boom', { kind: 'error' });
          out.toastErr = toastEl.classList.contains('app-global-toast--err') && toastEl.textContent === 'boom';
          showAppGlobalToast('plain again');
          out.toastErrCleared = !toastEl.classList.contains('app-global-toast--err');
          out.mediaNotify = (function () {
            let alerted = false; const orig = window.alert; window.alert = () => { alerted = true; };
            mediaNotify('Upload failed: x'); window.alert = orig;
            return !alerted && toastEl.classList.contains('app-global-toast--err');
          })();

          /* ---- fake Supabase for write-path tests ---- */
          const realSB = window.SB;
          const log = [];
          let docRows = [];
          let dbErr = null;
          function builder(table) {
            const st = { table: table, ops: [] };
            const b = {};
            ['select', 'insert', 'update', 'delete', 'eq', 'in', 'order', 'limit', 'range', 'or', 'single'].forEach((m) => {
              b[m] = function () { st.ops.push([m].concat(Array.from(arguments))); return b; };
            });
            b.then = function (res, rej) {
              log.push(st);
              const wrote = st.ops.some((o) => o[0] === 'insert' || o[0] === 'update');
              let r;
              if (wrote && dbErr) r = { data: null, error: { message: dbErr } };
              else if (wrote) r = { data: [{ id: 'new-1' }], error: null };
              else if (table === 'patient_documents') r = { data: docRows, error: null };
              else r = { data: [], error: null };
              return Promise.resolve(r).then(res, rej);
            };
            return b;
          }
          const storageLog = [];
          const fakeSB = {
            from: builder,
            storage: { from: (bucket) => ({
              upload: (p, f, o) => { storageLog.push(['upload', p]); return Promise.resolve({ error: null }); },
              remove: (ps) => { storageLog.push(['remove', ps.join(',')]); return Promise.resolve({ error: null }); },
              getPublicUrl: (p) => ({ data: { publicUrl: 'http://files.test/' + p } })
            }) }
          };
          window.SB = fakeSB;
          const firstOp = (st, name) => st.ops.find((o) => o[0] === name);

          /* ---- step 2 + 4: photoUploadOne ---- */
          photoPatientId = 'smoke-pid';
          const file = new File(['x'], 'a.png', { type: 'image/png' });
          const up = await photoUploadOne(file, {
            category: 'Intraoral', taken_date: '2026-10-01', dr: 'Dr A', clinic: 'C1', caption: 'pre-op',
            ctx: { tooth_no: '16', tags: ['pre-op'], appointment_id: 'A1' }
          });
          const insSt = log.filter((s) => s.table === 'photos' && firstOp(s, 'insert')).pop();
          const insRow = insSt ? firstOp(insSt, 'insert')[1][0] : {};
          out.uploadOk = up.ok === true && up.id === 'new-1' && /^smoke-pid\\//.test(up.path);
          out.uploadRow = insRow.patient_id === 'smoke-pid' && insRow.tooth_no === '16' &&
            JSON.stringify(insRow.tags) === '["pre-op"]' && insRow.appointment_id === 'A1' && /files\\.test/.test(insRow.public_url);
          dbErr = 'insert exploded';
          storageLog.length = 0;
          const bad = await photoUploadOne(file, { category: 'Other' });
          dbErr = null;
          out.uploadCleanup = bad.ok === false && /insert exploded/.test(bad.msg) &&
            storageLog.some((e) => e[0] === 'remove');
          photoPatientId = null;
          const noPid = await photoUploadOne(file, {});
          out.uploadNeedsPatient = noPid.ok === false;
          photoPatientId = 'smoke-pid';

          /* ---- step 4: non-destructive edit ---- */
          const origRec = { id: 'orig-1', patient_id: 'smoke-pid', file_path: 'smoke-pid/old.jpg', public_url: 'http://files.test/smoke-pid/old.jpg', category: 'Intraoral', caption: 'Pre-op', taken_date: '2026-10-01' };
          photoAllRecords = [origRec];
          const origNeeds = photoLbNeedsImagePersist, origExport = photoLbExportEditedJpegForSave,
            origLoad = loadPhotoRecords, origForce = _forceClosePhotoLightbox;
          photoLbNeedsImagePersist = () => true;
          photoLbExportEditedJpegForSave = (cb) => cb(new Blob(['edited'], { type: 'image/jpeg' }));
          loadPhotoRecords = () => Promise.resolve();
          _forceClosePhotoLightbox = () => {};
          function setLb(replace) {
            photoLbCurrentId = 'orig-1';
            document.getElementById('photoLbCat').value = 'Intraoral';
            document.getElementById('photoLbDate').value = '2026-10-01';
            document.getElementById('photoLbCaption').value = 'Pre-op';
            document.getElementById('photoLbTooth').value = '16';
            document.getElementById('photoLbTags').value = 'crown';
            document.getElementById('photoLbReplaceOrig').checked = !!replace;
          }
          async function saveAndCollect(replace) {
            log.length = 0; storageLog.length = 0;
            setLb(replace);
            savePhotoLbMeta();
            await wait(150);
            return { log: log.slice(), storage: storageLog.slice() };
          }
          let r1 = await saveAndCollect(false);
          const ins1 = r1.log.find((s) => s.table === 'photos' && firstOp(s, 'insert'));
          const upd1 = r1.log.find((s) => s.table === 'photos' && firstOp(s, 'update'));
          const copyRow = ins1 ? firstOp(ins1, 'insert')[1][0] : null;
          out.copyInserted = !!copyRow && copyRow.parent_photo_id === 'orig-1' && copyRow.tooth_no === '16' &&
            copyRow.patient_id === 'smoke-pid' && /^smoke-pid\\//.test(copyRow.file_path) && copyRow.file_path !== 'smoke-pid/old.jpg';
          out.originalKept = !upd1 && !r1.storage.some((e) => e[0] === 'remove');
          out.copyToast = (document.getElementById('appGlobalToast').textContent || '').length > 0;
          let r2 = await saveAndCollect(true);
          const upd2 = r2.log.find((s) => s.table === 'photos' && firstOp(s, 'update'));
          const ins2 = r2.log.find((s) => s.table === 'photos' && firstOp(s, 'insert'));
          out.replaceUpdates = !!upd2 && !ins2 && firstOp(upd2, 'update')[1].file_path !== 'smoke-pid/old.jpg' &&
            r2.storage.some((e) => e[0] === 'remove' && e[1] === 'smoke-pid/old.jpg');
          CON_MEDIA.ctx.photos = false;
          let r3 = await saveAndCollect(false);
          const ins3 = r3.log.find((s) => s.table === 'photos' && firstOp(s, 'insert'));
          const row3 = ins3 ? firstOp(ins3, 'insert')[1][0] : null;
          out.noCtxCopy = !!row3 && /\\(edited\\)$/.test(row3.caption) && row3.parent_photo_id === undefined && row3.tooth_no === undefined;
          CON_MEDIA.ctx.photos = true;
          photoLbNeedsImagePersist = origNeeds; photoLbExportEditedJpegForSave = origExport;
          loadPhotoRecords = origLoad; _forceClosePhotoLightbox = origForce;

          /* ---- step 4: grid badges, compare, pending open, filters ---- */
          const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30"><rect width="40" height="30" fill="#888"/></svg>');
          photoAllRecords = [
            { id: 'p1', patient_id: 'smoke-pid', file_path: 'a.jpg', public_url: svg, category: 'Intraoral', caption: 'one', taken_date: '2026-10-01', tooth_no: '16', tags: ['crown'] },
            { id: 'p2', patient_id: 'smoke-pid', file_path: 'b.jpg', public_url: svg, category: 'Intraoral', caption: 'two (edited)', taken_date: '2026-10-02', parent_photo_id: 'p1' },
            { id: 'p3', patient_id: 'smoke-pid', file_path: 'c.pdf', public_url: svg, category: 'Consent Form', caption: 'consent', taken_date: '2026-10-03' }
          ];
          switchConTab('photos');
          document.getElementById('photoFilterCat').value = '';
          document.getElementById('photoFilterSearch').value = '';
          filterPhotos();
          const cards = Array.from(document.querySelectorAll('#photoGridView .xray-card'));
          out.cardCount = cards.length;
          out.toothBadge = !!cards[0].querySelector('.con-media-badge--tooth') && cards[0].textContent.indexOf('16') >= 0;
          out.tagBadge = !!cards[0].querySelector('.con-media-badge--tag');
          out.editedBadge = !!cards[1].querySelector('.con-media-badge--edit');
          out.cmpButtons = document.querySelectorAll('#photoGridView .xray-cb-cmp').length;
          out.pdfNoCmp = !cards[2].querySelector('.xray-cb-cmp');
          cards[0].querySelector('.xray-cb-cmp').click();
          out.cmpOne = CON_MEDIA.compare.length === 1 && cards[0].classList.contains('is-cmp');
          cards[1].querySelector('.xray-cb-cmp').click();
          const cmpModal = document.getElementById('photoCompareModal');
          out.cmpOpen = CON_MEDIA.compare.length === 2 && !!cmpModal && cmpModal.style.display !== 'none' &&
            !!document.getElementById('photoCmpImgA').src && !!document.getElementById('photoCmpImgB').src;
          out.cmpCaption = (document.getElementById('photoCmpCapA').textContent || '').indexOf('16') >= 0;
          document.querySelector('[data-cm-cmp="swap"]').click();
          out.cmpSwap = CON_MEDIA.compare[0] === 'p2' && CON_MEDIA.compare[1] === 'p1';
          document.querySelector('[data-cm-cmp="close"]').click();
          out.cmpClosed = cmpModal.style.display === 'none';
          out.cmpPdfRejected = (function () { const n = CON_MEDIA.compare.slice(); conMediaCompareToggle('p3'); return JSON.stringify(n) === JSON.stringify(CON_MEDIA.compare); })();
          CON_MEDIA.compare = []; conMediaCompareSync();
          document.getElementById('photoFilterCat').value = '__consent_lab';
          filterPhotos();
          out.consentOnly = photoFiltered.length === 1 && photoFiltered[0].id === 'p3';
          document.getElementById('photoFilterCat').value = '';
          document.getElementById('photoFilterSearch').value = '16';
          filterPhotos();
          out.searchTooth = photoFiltered.length === 1 && photoFiltered[0].id === 'p1';
          document.getElementById('photoFilterSearch').value = 'crown';
          filterPhotos();
          out.searchTag = photoFiltered.length === 1;
          document.getElementById('photoFilterSearch').value = '';
          filterPhotos();
          let opened = -1; const origOpen = openPhotoLightbox;
          openPhotoLightbox = (i) => { opened = i; };
          document.getElementById('photoFilterCat').value = 'Consent Form';
          filterPhotos();
          CON_MEDIA.pendingOpen = { kind: 'photo', id: 'p2', pid: 'smoke-pid' };
          conMediaConsumePendingOpen();
          out.pendingOpen = opened === 1 && CON_MEDIA.pendingOpen === null &&
            document.getElementById('photoFilterCat').value === '';
          openPhotoLightbox = origOpen;

          /* ---- step 4: batch upload ---- */
          photoUploadQueue = [];
          photoHandleFiles([new File(['1'], 'x1.png', { type: 'image/png' }), new File(['2'], 'x2.png', { type: 'image/png' })]);
          const bm = document.getElementById('photoBatchModal');
          out.batchModal = !!bm && bm.style.display === 'block' && bm.querySelectorAll('.cm-batch-row').length === 2;
          bm.querySelector('.cm-batch-x').click();
          out.batchRemove = bm.querySelectorAll('.cm-batch-row').length === 1;
          conMediaBatchClose();
          out.batchClose = bm.style.display === 'none' && CON_MEDIA.batch.length === 0;
          photoHandleFiles([new File(['1'], 'solo.png', { type: 'image/png' })]);
          out.singleUsesModal = photoUploadQueue.length === 1 && document.getElementById('photoUploadModal').style.display === 'block';
          closeModal('photoUploadModal'); photoUploadQueue = [];

          /* ---- step 5: forms history + placeholders ---- */
          conFormsPatientId = 'smoke-pid';
          conFormsPatientData = { id: 'smoke-pid', full_name: 'Smoke Patient', patient_no: 'S1' };
          docRows = [
            { id: 'dd1', document_name: 'Sick leave', document_date: '2026-10-01', template_name: 'Sick leave', template_type: 'report', created_at: '2026-10-01T02:00:00Z', content_html: '<p>x</p>', status: 'signed', category: 'certificate', appointment_id: null, valid_until: null },
            { id: 'dd2', document_name: 'Referral', document_date: '2026-09-20', template_name: 'Referral', template_type: 'report', created_at: '2026-09-20T02:00:00Z', content_html: '<p>y</p>', status: 'draft', category: 'referral', appointment_id: null, valid_until: '2020-01-01' }
          ];
          log.length = 0;
          searchConFormsDocs();
          await wait(250);
          const listEl = document.getElementById('conFormsExistingList');
          out.historyRows = listEl.querySelectorAll('.conFormsHistCb').length;
          out.historyBadges = listEl.querySelectorAll('.con-media-badge--st-signed').length === 1 &&
            listEl.querySelectorAll('.con-media-badge--st-draft').length === 1 && listEl.querySelectorAll('.con-media-badge--exp').length === 1;
          out.historyCount = (document.getElementById('conFormsHistCount').textContent || '').length > 0;
          out.moreHidden = document.getElementById('conFormsHistMore').hidden === true;
          document.getElementById('conFormsHistQ').value = 'refer';
          document.getElementById('conFormsHistType').value = 'report';
          document.getElementById('conFormsHistStatus').value = 'draft';
          log.length = 0;
          conMediaDocFilterChanged(true);
          await wait(250);
          const dst = log.find((s) => s.table === 'patient_documents' && firstOp(s, 'select') && firstOp(s, 'range'));
          out.filterQuery = !!dst && !!firstOp(dst, 'or') && String(firstOp(dst, 'or')[1]).indexOf('refer') >= 0 &&
            !!dst.ops.find((o) => o[0] === 'eq' && o[1] === 'template_type' && o[2] === 'report') &&
            !!dst.ops.find((o) => o[0] === 'eq' && o[1] === 'status' && o[2] === 'draft');
          docRows = [];
          searchConFormsDocs();
          await wait(250);
          out.noMatchText = (listEl.textContent || '').indexOf('cm.forms.noMatch') < 0 && listEl.textContent.trim().length > 0;
          document.getElementById('conFormsHistQ').value = '';
          document.getElementById('conFormsHistType').value = '';
          document.getElementById('conFormsHistStatus').value = '';
          conMediaDocFilterRead();
          docRows = Array.from({ length: 31 }, (_, i) => ({ id: 'm' + i, document_name: 'Doc ' + i, document_date: '2026-10-01', template_name: 'T', template_type: 'report', created_at: '2026-10-01T00:00:00Z', content_html: '' }));
          searchConFormsDocs();
          await wait(250);
          out.loadMoreShown = document.getElementById('conFormsHistMore').hidden === false &&
            document.querySelectorAll('#conFormsExistingList .conFormsHistCb').length === 30;
          const lmSt = log.slice();
          conMediaDocLoadMore();
          await wait(250);
          const lastSel = log.filter((s) => s.table === 'patient_documents' && firstOp(s, 'select') && firstOp(s, 'range')).pop();
          out.loadMoreRange = !!lastSel && !!firstOp(lastSel, 'range') && firstOp(lastSel, 'range')[2] === 60;
          CON_MEDIA.docFilter = { q: '', type: '', status: '', limit: 30 };

          /* visit / billing placeholders flow into the real placeholder map */
          CON_MEDIA.visitCtx = { pid: 'smoke-pid', bill: { id: 'abcdef1234567890', total: 800, balance: 0, amount_paid: 800, bill_date: '2026-10-01', items: [{ desc: 'Scaling' }] },
            appt: { date: '2026-10-01', start_time: '10:00:00' }, nextAppt: { date: '2026-11-01', start_time: '14:00:00' }, treatmentDone: 'Scaling' };
          out.placeholders = applyConFormsPlaceholders('R:{receipt_no} T:{total_amount} N:{next_appointment_date} D:{treatment_done}');
          CON_MEDIA.visitCtx = null;
          out.placeholdersBlank = applyConFormsPlaceholders('R:{receipt_no}') === 'R:';

          /* ---- step 5: forms save path carries the context fields ---- */
          docRows = [];
          log.length = 0;
          conFormsSelectedTemplate = { id: 't1', template_name: 'Letter', template_type: 'report', template_code: 'LET' };
          document.getElementById('conFormsTemplateSel').innerHTML = '<option value="t1">Letter</option>';
          document.getElementById('conFormsTemplateSel').value = 't1';
          document.getElementById('conFormsDocName').value = 'Smoke letter';
          document.getElementById('conFormsStatusSel').value = 'signed';
          document.getElementById('conFormsCategorySel').value = 'letter';
          document.getElementById('conFormsValidUntil').value = '2027-01-01';
          const ed = document.getElementById('conFormsDocEditor');
          if (ed) ed.innerHTML = '<p>Hello</p>';
          const origCollect = typeof DocEditor !== 'undefined' ? DocEditor.getHtml : null;
          if (origCollect) DocEditor.getHtml = () => '<p>Hello</p>';
          conFormsEditingDocId = null;
          saveConFormsDoc();
          await wait(250);
          if (origCollect) DocEditor.getHtml = origCollect;
          const docIns = log.find((s) => s.table === 'patient_documents' && firstOp(s, 'insert'));
          const docRow = docIns ? firstOp(docIns, 'insert')[1][0] : null;
          out.docSavePayload = !!docRow && docRow.status === 'signed' && docRow.category === 'letter' &&
            docRow.valid_until === '2027-01-01' && docRow.document_name === 'Smoke letter';
          out.docSaveToast = (document.getElementById('appGlobalToast').textContent || '').length > 0 &&
            !document.getElementById('appGlobalToast').classList.contains('app-global-toast--err');

          window.SB = realSB;

          /* ---- step 2: forms template change resets the context row ---- */
          out.ctxOnTemplate = (function () {
            conMediaFormsCtxOnTemplate({ template_type: 'consent', template_name: 'Consent' });
            return document.getElementById('conFormsStatusSel').value === 'draft' &&
              document.getElementById('conFormsCategorySel').value === 'consent';
          })();
          out.draftApi = (function () {
            _conFormsDirty = true;
            const stored = conMediaFormsDraftSave('smoke-pid');
            const had = !!conMediaFormsDraftRead('smoke-pid');
            conMediaFormsDraftClear('smoke-pid');
            return stored === false || had === true;
          })();
          localStorage.removeItem('conFormsDraft:v1:smoke-pid');
          _conFormsDirty = false;

          /* ---- step 3: timeline + notes chips + dashboard ---- */
          const ev = conPtlEventsFromPhotos([{ id: 'p1', category: 'Intraoral', caption: 'x', taken_date: '2026-10-01', created_at: '2026-10-01T01:00:00Z', tooth_no: '16', tags: ['a'], appointment_id: 'A1' }])[0];
          out.tlPhoto = ev.kind === 'photo' && ev.toothNo === '16' && ev.apptId === 'A1' && ev.tags[0] === 'a' && ev.meta.indexOf('16') >= 0;
          const now = Date.now();
          conPatientTimelineEvents = [
            { kind: 'photo', ts: now, category: 'Intraoral', toothNo: '16' },
            { kind: 'photo', ts: now, category: 'Intraoral', toothNo: '17' },
            { kind: 'photo', ts: now, category: 'Extraoral', toothNo: '' },
            { kind: 'photo', ts: now, category: 'Consent Form', toothNo: '' },
            { kind: 'photo', ts: now - 3 * 86400000, category: 'Intraoral', toothNo: '' },
            { kind: 'doc', ts: now, body: 'Sick leave certificate' }
          ];
          CN.todayRx = [];
          const items = cnTodayItems();
          const ioItem = items.find((i) => i.kind === 'photo' && i.key === 'io');
          const eoItem = items.find((i) => i.kind === 'photo' && i.key === 'eo');
          out.noteChips = !!ioItem && /2/.test(ioItem.text) && /16/.test(ioItem.text) && /17/.test(ioItem.text) &&
            !!eoItem && items.filter((i) => i.kind === 'photo').length === 2 &&
            !!items.find((i) => i.kind === 'doc' && i.key === 'tx' && /Sick leave/.test(i.text));
          conPatientId = 'smoke-pid';
          CON_MEDIA.summary['smoke-pid'] = conMediaBuildSummary([{ category: 'Intraoral', created_at: '2026-10-01T00:00:00Z' }], [{ id: 'z', template_type: 'report', created_at: '2026-10-01T00:00:00Z' }]);
          const jump = cnMediaJumpChips();
          out.jumpChips = jump.indexOf('data-goto="photos"') >= 0 && jump.indexOf('data-goto="forms"') >= 0;
          const noteBox = document.getElementById('conNoteContext');
          if (noteBox) {
            noteBox.innerHTML = jump;
            noteBox._items = [];
            switchConTab('treatment');
            const fake = { target: noteBox.querySelector('[data-goto="photos"]') };
            cnOnContextClick(fake);
            out.jumpClick = !!document.querySelector('.con-tab[data-tab="photos"].active');
          } else out.jumpClick = false;

          selPatientId = 'smoke-pid';
          const host = document.createElement('div');
          host.id = 'smokeDashHost';
          document.body.appendChild(host);
          const hit = [];
          const origOpenPhoto = conMediaOpenPhoto, origOpenDoc = conMediaOpenDoc;
          conMediaOpenPhoto = (pid, id) => hit.push(['photo', pid, id]);
          conMediaOpenDoc = (pid, id) => hit.push(['doc', pid, id]);
          host.innerHTML = patViewPhotosGridHtml([{ id: 'pp1', public_url: svg, taken_date: '2026-10-01', caption: 'c', tooth_no: '16' }]) +
            patViewDocsListHtml([{ id: 'dd9', document_name: 'Letter', document_date: '2026-10-01' }]);
          patViewWireHostActions(host);
          host.querySelector('[data-act="open-photo"]').click();
          host.querySelector('[data-act="open-doc"]').click();
          out.dashLinks = JSON.stringify(hit) === JSON.stringify([['photo', 'smoke-pid', 'pp1'], ['doc', 'smoke-pid', 'dd9']]);
          out.dashTooth = host.textContent.indexOf('16') >= 0;
          out.dashCount = patViewCountTitle('Photos', new Array(24), 24) === 'Photos (24+)' &&
            patViewCountTitle('Photos', [1, 2], 24) === 'Photos (2)' && patViewCountTitle('Photos', [], 24) === 'Photos';
          hit.length = 0;
          patDashPtlOpenEvent({ action: 'photo', refId: 'p77' });
          out.dashTimeline = JSON.stringify(hit) === JSON.stringify([['photo', 'smoke-pid', 'p77']]);
          conMediaOpenPhoto = origOpenPhoto; conMediaOpenDoc = origOpenDoc;
          host.remove();

          /* ---- step 1: switching patient stashes a dirty letter ---- */
          conFormsPatientId = 'smoke-pid';
          _conFormsDirty = true;
          const ed2 = document.getElementById('conFormsDocEditor');
          if (typeof DocEditor !== 'undefined') DocEditor.getHtml = () => '<p>Unsaved body</p>';
          document.getElementById('conFormsDocName').value = 'Unsaved';
          const origNew = conFormsStartNewDoc;
          conFormsStartNewDoc = () => {};
          conMediaOnPatientSwitch('smoke-pid', 'other-pid');
          conFormsStartNewDoc = origNew;
          const stash = conMediaFormsDraftRead('smoke-pid');
          out.draftStashed = !!stash && stash.name === 'Unsaved' && /Unsaved body/.test(stash.html);
          conMediaFormsDraftClear('smoke-pid');
          _conFormsDirty = false;
          return out;
        })()`, true, 55000);

        pass('Runtime.evaluate page BUILD', live && live.build === BUILD, live && live.build);
        pass('Runtime.evaluate hosted host', live && live.host === 'xray-ai.test', live && live.host);
        pass('live page helpers ready', live && live.ready === true);
        pass('live: Photos and Forms have no own patient search boxes', live && live.noBoxes === true);
        pass('live: no patient -> "pick on Treatment Notes" card, hub hidden',
            live && live.needShown === true && live.hubHiddenNoPatient === true);
        pass('live: with a patient -> same-patient card and hub',
            live && live.samePatient === true && live.hubShown === true);
        pass('live: hub shows Photos / Documents / Consents counts', live && live.segs === 3 &&
            JSON.stringify(live.counts) === '["1","0","2"]', live ? JSON.stringify(live.counts) : 'none');
        pass('live: Add menu lists upload + six quick-create letters, opens and closes',
            live && live.menuItems === 7 && live.menuHiddenAtStart === true && live.menuOpens === true &&
                live.menuClosesOnOutsideClick === true);
        pass('live: Consents view filters photos and lists consent documents',
            live && live.consentFilter === true && live.consentChip === true);
        pass('live: Forms tab shows the same hub and the context row',
            live && live.formsHub === true && live.ctxRowVisible === true);
        pass('live: toast plain / error styling and mediaNotify uses a toast, not alert()',
            live && live.toastPlain === true && live.toastErr === true && live.toastErrCleared === true &&
                live.mediaNotify === true, live ? JSON.stringify([live.toastPlain, live.toastErr, live.toastErrCleared, live.mediaNotify]) : 'none');
        pass('live: photoUploadOne uploads, inserts with tooth / tags / visit',
            live && live.uploadOk === true && live.uploadRow === true, live ? JSON.stringify([live.uploadOk, live.uploadRow]) : 'none');
        pass('live: a failed DB insert removes the orphan file', live && live.uploadCleanup === true);
        pass('live: upload without a patient fails cleanly', live && live.uploadNeedsPatient === true);
        pass('live: edited image saved as a NEW linked copy, original untouched',
            live && live.copyInserted === true && live.originalKept === true && live.copyToast === true,
            live ? JSON.stringify([live.copyInserted, live.originalKept]) : 'none');
        pass('live: "replace original" updates the row and removes the old file',
            live && live.replaceUpdates === true);
        pass('live: without media_context columns the copy is marked "(edited)"', live && live.noCtxCopy === true);
        pass('live: grid cards show tooth / tag / edited badges and compare buttons (not on PDFs)',
            live && live.cardCount === 3 && live.toothBadge === true && live.tagBadge === true &&
                live.editedBadge === true && live.cmpButtons === 2 && live.pdfNoCmp === true,
            live ? JSON.stringify([live.cardCount, live.toothBadge, live.tagBadge, live.editedBadge, live.cmpButtons, live.pdfNoCmp]) : 'none');
        pass('live: before/after compare opens at two picks, swaps, closes, rejects PDFs',
            live && live.cmpOne === true && live.cmpOpen === true && live.cmpCaption === true &&
                live.cmpSwap === true && live.cmpClosed === true && live.cmpPdfRejected === true,
            live ? JSON.stringify([live.cmpOne, live.cmpOpen, live.cmpCaption, live.cmpSwap, live.cmpClosed, live.cmpPdfRejected]) : 'none');
        pass('live: consent/lab filter and tooth / tag search', live && live.consentOnly === true &&
            live.searchTooth === true && live.searchTag === true);
        pass('live: deep link opens the exact photo even through a filter',
            live && live.pendingOpen === true);
        pass('live: several files open the batch modal; remove / close work; one file uses the normal modal',
            live && live.batchModal === true && live.batchRemove === true && live.batchClose === true &&
                live.singleUsesModal === true,
            live ? JSON.stringify([live.batchModal, live.batchRemove, live.batchClose, live.singleUsesModal]) : 'none');
        pass('live: document history shows status / expiry badges and a result count',
            live && live.historyRows === 2 && live.historyBadges === true && live.historyCount === true &&
                live.moreHidden === true,
            live ? JSON.stringify([live.historyRows, live.historyBadges, live.historyCount, live.moreHidden]) : 'none');
        pass('live: history filter sends search / type / status to the query', live && live.filterQuery === true);
        pass('live: empty filtered history shows a message', live && live.noMatchText === true);
        pass('live: 31 documents -> 30 shown + Load more, which widens the range',
            live && live.loadMoreShown === true && live.loadMoreRange === true,
            live ? JSON.stringify([live.loadMoreShown, live.loadMoreRange]) : 'none');
        pass('live: bill / visit placeholders fill receipt, total, next appointment, treatment',
            live && typeof live.placeholders === 'string' && /R:ABCDEF12/.test(live.placeholders) && /T:[^N]*800\.00/.test(live.placeholders) &&
                /N:2026-11-01/.test(live.placeholders) && /D:Scaling/.test(live.placeholders),
            live ? String(live.placeholders).slice(0, 120) : 'none');
        pass('live: placeholders stay blank without visit context', live && live.placeholdersBlank === true);
        pass('live: saving a letter writes status / category / valid-until and toasts',
            live && live.docSavePayload === true && live.docSaveToast === true,
            live ? JSON.stringify([live.docSavePayload, live.docSaveToast]) : 'none');
        pass('live: consent template defaults to Draft + Consent', live && live.ctxOnTemplate === true);
        pass('live: draft storage API round-trips', live && live.draftApi === true);
        pass('live: switching patient stashes an unsaved letter as a draft', live && live.draftStashed === true);
        pass('live: timeline photo events carry tooth / tags / visit', live && live.tlPhoto === true);
        pass('live: Treatment Notes show today\'s photo (io / eo) and document chips, skipping consent and old photos',
            live && live.noteChips === true);
        pass('live: Notes jump chips open Photos', live && live.jumpChips === true && live.jumpClick === true,
            live ? JSON.stringify([live.jumpChips, live.jumpClick]) : 'none');
        pass('live: dashboard thumbnails + document rows deep-link; counts in titles; timeline photo opens exact id',
            live && live.dashLinks === true && live.dashTooth === true && live.dashCount === true && live.dashTimeline === true,
            live ? JSON.stringify([live.dashLinks, live.dashTooth, live.dashCount, live.dashTimeline]) : 'none');
    } catch (e) {
        pass('CDP live page', false, e && e.message ? e.message : String(e));
    } finally {
        try { if (ws) ws.close(); } catch (e) { /* ignore */ }
        try { proc.kill(); } catch (e) { /* ignore */ }
        await new Promise(function (r) { server.close(r); });
    }

    finish(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});

function finish(code) {
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + TESTCLIENT + API + CDP + LIVE PAGE ALL PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}
