/**
 * Step 1–10 — shared patient through history version snapshots.
 * Smoke / spot / API + CDP Runtime.evaluate / live page.
 * Run: node scripts/con-hist-shared-patient-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var child_process = require('child_process');
var os = require('os');

var BUILD = '20261002cbc';
var PAGE_PORT = 8792;
var CDP_PORT = 9354;
var CHROME = process.env.CHROME_PATH ||
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var root = path.resolve(__dirname, '..');
var fails = [];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

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

function rest(base, key, method, table, qs) {
    var url = base.replace(/\/$/, '') + '/rest/v1/' + table + (qs ? ('?' + qs) : '');
    return fetch(url, {
        method: method,
        headers: {
            apikey: key, Authorization: 'Bearer ' + key,
            Accept: 'application/json'
        }
    }).then(function (r) {
        return r.text().then(function (t) {
            var json = null;
            try { json = JSON.parse(t); } catch (e) {}
            return { status: r.status, json: json, raw: t.slice(0, 240) };
        });
    });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function httpGetJson(url) {
    return new Promise(function (resolve, reject) {
        http.get(url, function (r) {
            var d = '';
            r.on('data', function (c) { d += c; });
            r.on('end', function () {
                try { resolve(JSON.parse(d)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function waitJson(url, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var last = null;
    while (Date.now() < deadline) {
        try { return await httpGetJson(url); }
        catch (e) { last = e; await sleep(250); }
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
        if (file.indexOf(root) !== 0) {
            res.writeHead(403); res.end('no'); return;
        }
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

(async function main() {
    console.log('=== smoke / spot: shared Consultation patient (BUILD ' + BUILD + ') ===\n');
    var html = read('index.html');
    var conSrc = read('app-consultation.js');
    var appSrc = read('app.js');
    var i18n = read('app-i18n-extra.js');

    console.log('=== spot: source ===');
    pass('index BUILD', html.indexOf("var BUILD = '" + BUILD + "'") >= 0);
    pass('consultation cache bust', html.indexOf('app-consultation.js?v=' + BUILD) >= 0);
    pass('no Medical History search box', html.indexOf('id="conPsInputMed"') < 0);
    pass('no Dental History search box', html.indexOf('id="conPsInputDen"') < 0);
    pass('Medical pick-patient button', html.indexOf('id="conMedPickPatientBtn"') >= 0);
    pass('Dental pick-patient button', html.indexOf('id="conDenPickPatientBtn"') >= 0);
    pass('need-patient copy', html.indexOf('id="conMedNeedPatient"') >= 0 && html.indexOf('id="conDenNeedPatient"') >= 0);
    pass('selectMedPatient hands off to selectConPatient',
        /function selectMedPatient\(p\) \{[\s\S]{0,180}selectConPatient\(p\)/.test(conSrc));
    pass('selectDenPatient hands off to selectConPatient',
        /function selectDenPatient\(p\) \{[\s\S]{0,180}selectConPatient\(p\)/.test(conSrc));
    pass('tab switch applies shared patient',
        conSrc.indexOf("tab === 'medhistory' || tab === 'denhistory'") >= 0 &&
        conSrc.indexOf('conHistApplySharedPatient()') >= 0);
    pass('app.js no longer binds med/den search',
        appSrc.indexOf('conPsInputMed') < 0 && appSrc.indexOf('conPsInputDen') < 0);
    pass('i18n en / zh-CN / zh-Hant for shared-patient keys',
        ['con.hist.needPatient', 'con.hist.samePatient', 'con.hist.pickPatient',
         'con.hist.unsaved.message', 'con.hist.unsaved.save',
         'con.hist.review.never', 'con.hist.review.stamp', 'con.hist.review.noChange',
         'con.hist.jumpMed', 'con.hist.jumpNotes', 'con.hist.summary.meds', 'con.forms.histTagsLabel',
         'con.hist.allergy.nkda', 'con.hist.meds.addPh', 'con.hist.appt.due',
         'con.ptl.filter.history', 'con.ptl.type.medHist'].every(function (k) {
            var i = i18n.indexOf("'" + k + "':");
            if (i < 0) return false;
            var line = i18n.slice(i, i18n.indexOf('\n', i) + 200);
            return line.indexOf('en:') >= 0 && line.indexOf("'zh-CN':") >= 0 && line.indexOf("'zh-Hant':") >= 0;
        }));
    var progSrc = read('app-program-settings.js');
    pass('history lock covers dental fields',
        progSrc.indexOf("'fldDentalHistory'") >= 0 &&
        progSrc.indexOf("'#conDenForm'") >= 0);
    pass('dental save blocked when history is locked',
        conSrc.indexOf("conTr('con.alert.denReadOnly')") >= 0 &&
        conSrc.indexOf('function syncConDentalFieldsToPatientData') >= 0);
    pass('dental load refreshes in-memory patient fields',
        /function loadDentalHistory[\s\S]{0,900}syncConDentalFieldsToPatientData/.test(conSrc));
    pass('history save uses toast, not alert()',
        conSrc.indexOf("conTrRepl('con.alert.medSaved'") >= 0 &&
        conSrc.indexOf('conHistToast(opts.reviewedOnly') >= 0 &&
        conSrc.indexOf("alert(conTrRepl('con.alert.medSaved'") < 0 &&
        conSrc.indexOf("alert(conTrRepl('con.alert.denSaved'") < 0);
    pass('unsaved history is caught before leaving the tab',
        conSrc.indexOf('conHistCheckUnsavedThen') >= 0 &&
        conSrc.indexOf("conHistDirty.med") >= 0);
    pass('review stamp SQL is in the repo',
        fs.existsSync(path.join(root, 'patients_history_review.sql')) &&
        read('patients_history_review.sql').indexOf('mh_reviewed_at') >= 0);
    pass('Medical and Dental review stamps are in the form footer',
        html.indexOf('id="conMedReviewed"') >= 0 && html.indexOf('id="conDenReviewed"') >= 0 &&
        html.indexOf("conHistMarkReviewed('med')") >= 0 &&
        html.indexOf("conHistMarkReviewed('den')") >= 0);
    pass('save stamps last-reviewed columns and strips them if missing',
        conSrc.indexOf('function conHistRenderReview') >= 0 &&
        conSrc.indexOf('function conHistMarkReviewed') >= 0 &&
        conSrc.indexOf('conHistStampPayload') >= 0 &&
        conSrc.indexOf('conHistStripReviewCols') >= 0);
    pass('program lock hides the Reviewed button',
        progSrc.indexOf('.history-review-btn') >= 0);
    pass('Treatment Notes jump to Medical History and show a review chip',
        html.indexOf('id="conJumpMedHistBtn"') >= 0 && html.indexOf('id="conMhReviewChip"') >= 0 &&
        html.indexOf('id="conMedJumpNotesBtn"') >= 0 &&
        conSrc.indexOf('function conHistJumpToMed') >= 0 &&
        conSrc.indexOf('function refreshConMhReviewChip') >= 0);
    pass('forms fill allergy / medications / medical_summary placeholders',
        html.indexOf('id="conFormsHistTags"') >= 0 &&
        conSrc.indexOf("allergy: conHistFormFieldText('allergy')") >= 0 &&
        conSrc.indexOf('medical_summary: conHistMedicalSummaryText()') >= 0 &&
        conSrc.indexOf('function conHistNormalizeFormPlaceholders') >= 0);
    pass('structured allergy chips still write the allergy text field',
        html.indexOf('id="conAllergyNkda"') >= 0 && html.indexOf('id="conAllergyChips"') >= 0 &&
        conSrc.indexOf('function conAllergyWrite') >= 0 &&
        conSrc.indexOf("return 'NKDA'") >= 0);
    pass('structured medications still write current_medications',
        html.indexOf('id="conMedsChips"') >= 0 && html.indexOf('id="conMedsChipInput"') >= 0 &&
        conSrc.indexOf('function conMedsWrite') >= 0 &&
        conSrc.indexOf('conMedsSuggest') >= 0 &&
        conSrc.indexOf('rxLoadDrugCatalog') >= 0);
    var apptSrc = read('app-appt.js');
    pass('appointments show an MH review-due badge',
        apptSrc.indexOf('function apptMhDueCount') >= 0 &&
        apptSrc.indexOf('conHistMhReviewDueInfo') >= 0 &&
        apptSrc.indexOf('appt-mh-due') >= 0 &&
        conSrc.indexOf('function conHistMhReviewDueInfo') >= 0);
    pass('history saves keep a version snapshot for the timeline',
        conSrc.indexOf('function conHistPushSnapshot') >= 0 &&
        conSrc.indexOf('function conPtlEventsFromHistorySnaps') >= 0 &&
        conSrc.indexOf("kind: 'history'") >= 0 &&
        read('patients_history_review.sql').indexOf('mh_edit_history') >= 0);

    console.log('\n=== HTTP spot ===');
    var port = null;
    for (var p of [5501, 8124, 5500, 8123]) {
        try {
            var r = await httpGet('127.0.0.1', p, '/index.html');
            if (r.status === 200 && r.body.indexOf(BUILD) >= 0) { port = p; break; }
        } catch (e) {}
    }
    pass('a local server serves BUILD ' + BUILD, !!port, port ? ':' + port : 'none of 5501/8124/5500/8123 (static CDP server still runs)');
    if (port) {
        var js = await httpGet('127.0.0.1', port, '/app-consultation.js?v=' + BUILD);
        pass('GET /app-consultation.js shared-patient helpers',
            js.status === 200 && js.body.indexOf('function conHistApplySharedPatient') >= 0,
            'HTTP ' + js.status);
    }

    console.log('\n=== API ===');
    var sb = readSbConfig(appSrc);
    var listed = await rest(sb.url, sb.key, 'GET', 'patients',
        'select=id,full_name,medical_history,current_medications,allergy,dental_history,parafunctional_habits,oral_hygiene_notes&limit=1');
    pass('patients history columns readable', listed.status === 200 && Array.isArray(listed.json),
        'HTTP ' + listed.status + ' ' + (listed.raw || '').slice(0, 120));
    var reviewCols = await rest(sb.url, sb.key, 'GET', 'patients',
        'select=id,mh_reviewed_at,mh_reviewed_by,dh_reviewed_at,dh_reviewed_by&limit=1');
    var reviewOk = reviewCols.status === 200 && Array.isArray(reviewCols.json);
    var reviewMissing = !reviewOk && /mh_reviewed_at|dh_reviewed_at|column/i.test(reviewCols.raw || '');
    pass('patients review columns readable or not yet applied',
        reviewOk || reviewMissing,
        reviewOk ? 'HTTP 200 present' : ('HTTP ' + reviewCols.status + ' ' + (reviewCols.raw || '').slice(0, 120)));

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    if (!fs.existsSync(CHROME)) {
        pass('Chrome found for CDP', false, CHROME);
        finish(1);
        return;
    }

    var server = await startStaticServer(PAGE_PORT);
    var profile = path.join(os.tmpdir(), 'cs-con-hist-shared-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
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
          const deadline = Date.now() + 25000;
          while (Date.now() < deadline) {
            if (typeof switchConTab === 'function' && typeof conHistApplySharedPatient === 'function' &&
                typeof conHistGoToPatientSearch === 'function' && typeof selectMedPatient === 'function' &&
                typeof applyMedicalNotesProgramLocks === 'function' &&
                typeof conHistBindDirtyOnce === 'function' && typeof conHistToast === 'function' &&
                typeof conHistRenderReview === 'function' && typeof conHistMarkReviewed === 'function' &&
                typeof conHistJumpToMed === 'function' && typeof refreshConMhReviewChip === 'function' &&
                typeof applyConFormsPlaceholders === 'function' &&
                typeof conAllergySyncFromTextarea === 'function' && typeof conAllergyNkdaChange === 'function' &&
                typeof conHistMhReviewDueInfo === 'function' && typeof conHistPushSnapshot === 'function') break;
            await new Promise(function (r) { setTimeout(r, 200); });
          }
          const login = document.getElementById('loginOverlay');
          if (login) login.style.display = 'none';
          const con = document.getElementById('consultationSection');
          if (con) { con.style.display = 'block'; con.removeAttribute('aria-hidden'); }
          const pages = document.querySelectorAll('.app-section, .container');
          /* leave other screens; consultation is shown */
          switchConTab('medhistory');
          const empty = {
            medSearch: !!document.getElementById('conPsInputMed'),
            denSearch: !!document.getElementById('conPsInputDen'),
            need: !!(document.getElementById('conMedNeedPatient') && document.getElementById('conMedNeedPatient').hidden === false),
            same: !!(document.getElementById('conMedSamePatient') && document.getElementById('conMedSamePatient').hidden === true),
            form: (document.getElementById('conMedForm') || {}).style ? document.getElementById('conMedForm').style.display : '',
            pane: document.getElementById('con-medhistory') && document.getElementById('con-medhistory').classList.contains('active')
          };
          conPatientId = 'smoke-pid';
          conPatientData = { id: 'smoke-pid', full_name: 'Smoke Patient', patient_no: 'S1', dob: '1990-01-01' };
          conMedPatientId = conPatientId;
          conMedPatientData = conPatientData;
          conDenPatientId = conPatientId;
          conDenPatientData = conPatientData;
          conHistApplySharedPatient();
          const filled = {
            need: document.getElementById('conMedNeedPatient').hidden === true,
            same: document.getElementById('conMedSamePatient').hidden === false,
            banner: (document.getElementById('conMedBanner') || {}).style.display,
            name: (document.getElementById('conMedBannerName') || {}).textContent,
            denName: (document.getElementById('conDenBannerName') || {}).textContent
          };
          switchConTab('denhistory');
          const denPane = document.getElementById('con-denhistory') && document.getElementById('con-denhistory').classList.contains('active');
          const denSame = document.getElementById('conDenSamePatient').hidden === false;
          conHistGoToPatientSearch();
          const back = document.getElementById('con-treatment') && document.getElementById('con-treatment').classList.contains('active');
          const origLock = typeof medicalNotesEditingAllowed === 'function' ? medicalNotesEditingAllowed : function () { return true; };
          medicalNotesEditingAllowed = function () { return false; };
          applyMedicalNotesProgramLocks();
          const denFld = document.getElementById('fldDentalHistory');
          const denSave = document.querySelector('#conDenForm .history-save-btn');
          const medFld = document.getElementById('fldAllergy');
          const locked = {
            denReadOnly: !!(denFld && denFld.readOnly),
            denSaveHidden: !!(denSave && denSave.style.display === 'none'),
            medReadOnly: !!(medFld && medFld.readOnly)
          };
          medicalNotesEditingAllowed = origLock;
          applyMedicalNotesProgramLocks();
          const unlocked = {
            denReadOnly: !!(denFld && denFld.readOnly),
            denSaveHidden: !!(denSave && denSave.style.display === 'none')
          };
          switchConTab('medhistory');
          conHistBindDirtyOnce();
          const medTa = document.getElementById('fldMedHistory');
          if (medTa) {
            medTa.value = 'smoke edit';
            medTa.dispatchEvent(new Event('input', { bubbles: true }));
          }
          conHistDirty.med = true;
          switchConTab('treatment');
          const overlay = document.querySelector('#consultationSection .media-unsaved-overlay');
          const stayedOnMed = document.getElementById('con-medhistory') && document.getElementById('con-medhistory').classList.contains('active');
          const discard = overlay && overlay.querySelector('.media-unsaved-discard');
          if (discard) discard.click();
          const afterDiscard = document.getElementById('con-treatment') && document.getElementById('con-treatment').classList.contains('active');
          conHistToast('hist-toast-ok');
          const toast = document.getElementById('appGlobalToast');
          switchConTab('medhistory');
          const medForm = document.getElementById('conMedForm');
          if (medForm) medForm.style.display = 'block';
          conHistRenderReview('med', '', '');
          const neverEl = document.getElementById('conMedReviewed');
          const never = neverEl && neverEl.classList.contains('is-never');
          const oldIso = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
          conHistRenderReview('med', oldIso, 'Dr Old');
          const stale = neverEl && neverEl.classList.contains('is-stale') &&
            String(neverEl.textContent || '').indexOf('Dr Old') >= 0;
          conHistRenderReview('med', new Date().toISOString(), 'Dr Smoke');
          const fresh = neverEl && !neverEl.classList.contains('is-stale') &&
            !neverEl.classList.contains('is-never') &&
            String(neverEl.textContent || '').indexOf('Dr Smoke') >= 0;
          medicalNotesEditingAllowed = function () { return false; };
          applyMedicalNotesProgramLocks();
          const revBtn = document.getElementById('conMedReviewedBtn');
          const reviewLocked = !!(revBtn && revBtn.style.display === 'none');
          medicalNotesEditingAllowed = origLock;
          applyMedicalNotesProgramLocks();
          const reviewUnlocked = !!(revBtn && revBtn.style.display !== 'none');
          switchConTab('denhistory');
          const denForm = document.getElementById('conDenForm');
          if (denForm) denForm.style.display = 'block';
          conHistRenderReview('den', new Date().toISOString(), 'Dr Den');
          const denStamp = document.getElementById('conDenReviewed');
          const denFresh = denStamp && String(denStamp.textContent || '').indexOf('Dr Den') >= 0;
          switchConTab('treatment');
          conHistJumpToMed();
          const jumpedMed = document.getElementById('con-medhistory') &&
            document.getElementById('con-medhistory').classList.contains('active');
          conHistJumpToNotes();
          const jumpedNotes = document.getElementById('con-treatment') &&
            document.getElementById('con-treatment').classList.contains('active');
          conPatientData.mh_reviewed_at = '';
          refreshConMhReviewChip();
          const chip = document.getElementById('conMhReviewChip');
          const chipNever = chip && chip.hidden === false && chip.classList.contains('is-never');
          conPatientData.mh_reviewed_at = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
          refreshConMhReviewChip();
          const chipStale = chip && chip.classList.contains('is-stale');
          conPatientData.mh_reviewed_at = new Date().toISOString();
          conPatientData.mh_reviewed_by = 'Dr Chip';
          refreshConMhReviewChip();
          const chipOk = chip && chip.classList.contains('is-ok') &&
            String((document.getElementById('conMhReviewChipText') || {}).textContent || '').indexOf('Dr Chip') >= 0;
          medicalNotesEditingAllowed = function () { return false; };
          refreshConMhReviewChip();
          const chipBtn = document.getElementById('conMhReviewChipBtn');
          const chipBtnLocked = !!(chipBtn && chipBtn.style.display === 'none');
          medicalNotesEditingAllowed = origLock;
          refreshConMhReviewChip();
          conFormsPatientData = {
            id: 'smoke-pid',
            full_name: 'Smoke Patient',
            allergy: 'Penicillin',
            current_medications: 'Amlodipine 5mg',
            medical_history: 'Hypertension'
          };
          const filledForm = applyConFormsPlaceholders(
            'A:{allergy};M:{medications};S:{medical_summary};D:{{allergy}}'
          );
          const formTags = !!document.getElementById('conFormsHistTags');
          const allTa = document.getElementById('fldAllergy');
          if (allTa) allTa.value = 'Penicillin, Latex';
          conHistDirty.med = false;
          conAllergySyncFromTextarea();
          const chips = document.querySelectorAll('#conAllergyChips .history-chip').length;
          const nk = document.getElementById('conAllergyNkda');
          if (nk) { nk.checked = true; conAllergyNkdaChange(); }
          const nkdaText = allTa ? String(allTa.value || '') : '';
          const chipsAfterNkda = document.querySelectorAll('#conAllergyChips .history-chip').length;
          if (nk) { nk.checked = false; conAllergyNkdaChange(); }
          conAllergyAddNamed('Aspirin');
          const aspirin = allTa ? String(allTa.value || '') : '';
          const medsTa = document.getElementById('fldMedications');
          if (medsTa) medsTa.value = 'Amlodipine 5mg, Metformin';
          conMedsSyncFromTextarea();
          const medChips = document.querySelectorAll('#conMedsChips .history-chip').length;
          conMedsAddNamed('Atorvastatin');
          const medsText = medsTa ? String(medsTa.value || '') : '';
          const dueUnknown = conHistMhReviewDueInfo({});
          const dueNever = conHistMhReviewDueInfo({ mh_reviewed_at: '' });
          const dueStale = conHistMhReviewDueInfo({
            mh_reviewed_at: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString()
          });
          const dueOk = conHistMhReviewDueInfo({ mh_reviewed_at: new Date().toISOString() });
          const alertHtml = typeof apptAlertCellHtml === 'function'
            ? apptAlertCellHtml({ mh_reviewed_at: '', medical_alerts: '' })
            : '';
          const snaps = conHistPushSnapshot('med', { mh_edit_history: [] }, {
            medical_history: 'HTN', current_medications: 'Amlodipine', allergy: 'NKDA'
          });
          const tlev = conPtlEventsFromHistorySnaps('med', snaps);
          return {
            ready: typeof conHistApplySharedPatient === 'function',
            build: window.__JSM_BUILD || '',
            host: location.hostname,
            empty: empty,
            filled: filled,
            denPane: denPane,
            denSame: denSame,
            backToTreatment: back,
            medSelectIsShared: String(selectMedPatient).indexOf('selectConPatient') >= 0,
            locked: locked,
            unlocked: unlocked,
            overlay: !!(overlay),
            stayedOnMed: stayedOnMed,
            afterDiscard: afterDiscard,
            toast: toast ? String(toast.textContent || '') : '',
            never: never,
            stale: stale,
            fresh: fresh,
            reviewLocked: reviewLocked,
            reviewUnlocked: reviewUnlocked,
            denFresh: denFresh,
            jumpedMed: jumpedMed,
            jumpedNotes: jumpedNotes,
            chipNever: chipNever,
            chipStale: chipStale,
            chipOk: chipOk,
            chipBtnLocked: chipBtnLocked,
            filledForm: filledForm,
            formTags: formTags,
            allergyChips: chips,
            nkdaText: nkdaText,
            chipsAfterNkda: chipsAfterNkda,
            aspirin: aspirin,
            medChips: medChips,
            medsText: medsText,
            dueUnknown: dueUnknown,
            dueNever: dueNever,
            dueStale: dueStale,
            dueOk: dueOk,
            alertHtml: alertHtml,
            snapCount: snaps && snaps.length,
            tlKind: tlev && tlev[0] && tlev[0].kind,
            tlAction: tlev && tlev[0] && tlev[0].action,
            tlBody: tlev && tlev[0] && tlev[0].body
          };
        })()`, true, 40000);

        pass('Runtime.evaluate page BUILD', live && live.build === BUILD, live && live.build);
        pass('Runtime.evaluate hosted host', live && live.host === 'xray-ai.test', live && live.host);
        pass('live page helpers ready', live && live.ready === true);
        pass('live page has no extra history search boxes',
            live && live.empty && live.empty.medSearch === false && live.empty.denSearch === false);
        pass('live Medical tab with no patient asks to pick on Treatment Notes',
            live && live.empty && live.empty.need === true && live.empty.pane === true,
            live ? JSON.stringify(live.empty) : 'none');
        pass('live Medical tab with a patient shows the shared banner',
            live && live.filled && live.filled.need === true && live.filled.same === true &&
                live.filled.name === 'Smoke Patient',
            live ? JSON.stringify(live.filled) : 'none');
        pass('live Dental tab uses the same patient name',
            live && live.denPane === true && live.denSame === true && live.filled.denName === 'Smoke Patient');
        pass('Pick patient returns to Treatment Notes', live && live.backToTreatment === true);
        pass('selectMedPatient still routes through selectConPatient', live && live.medSelectIsShared === true);
        pass('program lock makes Dental History read-only like Medical History',
            live && live.locked && live.locked.denReadOnly === true && live.locked.medReadOnly === true &&
                live.locked.denSaveHidden === true,
            live ? JSON.stringify(live.locked) : 'none');
        pass('unlocking history editing restores Dental History fields',
            live && live.unlocked && live.unlocked.denReadOnly === false && live.unlocked.denSaveHidden === false,
            live ? JSON.stringify(live.unlocked) : 'none');
        pass('unsaved Medical History prompts before leaving the tab',
            live && live.overlay === true && live.stayedOnMed === true,
            live ? ('overlay=' + live.overlay + ' stayed=' + live.stayedOnMed) : 'none');
        pass('discard leaves Medical History and opens Treatment Notes',
            live && live.afterDiscard === true);
        pass('save confirmation is a toast, not a dialog',
            live && live.toast === 'hist-toast-ok');
        pass('empty review stamp shows Never reviewed', live && live.never === true);
        pass('old review stamp is marked stale', live && live.stale === true);
        pass('fresh review stamp shows reviewer name', live && live.fresh === true);
        pass('program lock hides Reviewed, no change',
            live && live.reviewLocked === true && live.reviewUnlocked === true);
        pass('Dental History has the same review stamp', live && live.denFresh === true);
        pass('jump Medical History opens the Medical tab', live && live.jumpedMed === true);
        pass('jump Treatment Notes returns to notes', live && live.jumpedNotes === true);
        pass('MH review chip is hidden until a patient, then never/stale/ok',
            live && live.chipNever === true && live.chipStale === true && live.chipOk === true);
        pass('MH review chip button hides when history is locked', live && live.chipBtnLocked === true);
        pass('form placeholders fill allergy, medications, summary, and {{allergy}}',
            live && typeof live.filledForm === 'string' &&
                live.filledForm.indexOf('A:Penicillin') >= 0 &&
                live.filledForm.indexOf('M:Amlodipine 5mg') >= 0 &&
                live.filledForm.indexOf('D:Penicillin') >= 0 &&
                live.filledForm.indexOf('{allergy}') < 0 &&
                live.filledForm.indexOf('{{') < 0 &&
                /Allergy: Penicillin/.test(live.filledForm),
            live ? String(live.filledForm).slice(0, 180) : 'none');
        pass('Forms editor has history placeholder buttons', live && live.formTags === true);
        pass('allergy chips parse the text field', live && live.allergyChips === 2);
        pass('NKDA checkbox writes NKDA into allergy and clears chips',
            live && live.nkdaText === 'NKDA' && live.chipsAfterNkda === 0);
        pass('adding an allergen updates the allergy text field',
            live && String(live.aspirin || '').indexOf('Aspirin') >= 0);
        pass('medication chips parse current medications', live && live.medChips === 2);
        pass('adding a medicine updates the medications text field',
            live && String(live.medsText || '').indexOf('Atorvastatin') >= 0);
        pass('MH review-due treats missing columns as unknown, empty as due, fresh as ok',
            live && live.dueUnknown && live.dueUnknown.unknown === true && live.dueUnknown.due === false &&
                live.dueNever && live.dueNever.due === true && live.dueNever.never === true &&
                live.dueStale && live.dueStale.due === true && live.dueStale.stale === true &&
                live.dueOk && live.dueOk.due === false);
        pass('appointment alert cell shows MH never reviewed',
            live && String(live.alertHtml || '').indexOf('appt-mh-due') >= 0);
        pass('history snapshot lands on the patient timeline as a history event',
            live && live.snapCount === 1 && live.tlKind === 'history' && live.tlAction === 'medhistory' &&
                String(live.tlBody || '').indexOf('HTN') >= 0);
    } catch (e) {
        pass('CDP live page', false, e && e.message ? e.message : String(e));
    } finally {
        try { if (ws) ws.close(); } catch (e) {}
        try { proc.kill(); } catch (e) {}
        await new Promise(function (r) { server.close(r); });
    }

    finish(fails.length ? 1 : 0);
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});

function finish(code) {
    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + API + CDP + LIVE PAGE ALL PASS'));
    fails.forEach(function (f) { console.log('  - ' + f); });
    process.exit(code);
}
