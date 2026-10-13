/**
 * Medical-history allergy save refreshes the Add-drug allergy guard.
 * Smoke / unit / HTML / HTTP spot / API / CDP Runtime.evaluate / live page.
 * Run: node scripts/rx-allergy-refresh-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');
var child_process = require('child_process');
var os = require('os');

var root = path.resolve(__dirname, '..');
var EXPECTED_BUILD = '20261013allergy1';
var LIVE_PORT = 5500;
var CDP_PORT = 9382;
var CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
var fails = [];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}

function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

function extractFn(src, name) {
    var marker = 'function ' + name + '(';
    var start = src.indexOf(marker);
    if (start < 0) throw new Error('missing ' + name);
    var i = src.indexOf('{', start);
    var depth = 0;
    for (var j = i; j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') {
            depth--;
            if (depth === 0) return src.slice(start, j + 1);
        }
    }
    throw new Error('unclosed ' + name);
}

function extractVar(src, name, endToken) {
    var start = src.indexOf('var ' + name + ' =');
    if (start < 0) throw new Error('missing var ' + name);
    var end = src.indexOf(endToken, start);
    return src.slice(start, end + endToken.length);
}

function readSbConfig(appJs) {
    var block = appJs.match(/supabase\.createClient\(([\s\S]*?)\);/);
    if (!block) throw new Error('supabase.createClient not found');
    var parts = [];
    var re = /'([^']*)'/g;
    var m;
    while ((m = re.exec(block[1]))) parts.push(m[1]);
    return { url: parts[0], key: parts.slice(1).join('') };
}

function httpGet(port, reqPath) {
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

function rest(base, key, method, table, qs, body) {
    var headers = {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
        Prefer: 'return=representation'
    };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(base.replace(/\/$/, '') + '/rest/v1/' + table + (qs ? '?' + qs : ''), {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
        return r.text().then(function (t) {
            var json = null;
            try { json = JSON.parse(t); } catch (e) {}
            return { status: r.status, json: json, raw: t.slice(0, 300) };
        });
    });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

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

var PAGE_SCRIPT = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline && typeof saveMedicalHistory !== 'function') await wait(100);
  if (typeof saveMedicalHistory !== 'function' || typeof rxPublishAllergyText !== 'function') {
    return { ready: false, build: window.__JSM_BUILD || '' };
  }
  const pid = 'allergy-live-probe';
  const idx = 77;
  const prev = {
    conPatientId: conPatientId,
    conPatientData: conPatientData,
    conMedPatientId: conMedPatientId,
    conMedPatientData: conMedPatientData,
    rxPatientAllergy: rxPatientAllergy,
    rxAllergyEpoch: rxAllergyEpoch,
    rxDrugCatalog: rxDrugCatalog,
    rxLines: rxLines,
    rxComboState: rxComboState,
    update: conHistPatientsUpdate,
    allowed: medicalNotesEditingAllowed,
    from: SB.from,
    allergy: (document.getElementById('fldAllergy') || {}).value,
    med: (document.getElementById('fldMedHistory') || {}).value,
    meds: (document.getElementById('fldMedications') || {}).value
  };
  const host = document.createElement('div');
  host.id = 'rx-allergy-probe-host';
  host.innerHTML = '<input id="rx-drug-input-' + idx + '" value="">' +
    '<div class="rx-drug-menu" id="rx-drug-menu-' + idx + '" hidden></div>';
  document.body.appendChild(host);
  const menu = document.getElementById('rx-drug-menu-' + idx);
  let seen = null;
  try {
    conPatientId = pid;
    conMedPatientId = pid;
    conPatientData = { id: pid, full_name: 'Allergy Probe', allergy: '' };
    conMedPatientData = conPatientData;
    rxPatientAllergy = { pid: pid, text: '' };
    rxLines = [];
    rxLines[idx] = { drug_name: '', drug_id: '' };
    rxComboState = { idx: -1, items: [], hi: -1 };
    rxDrugCatalog = [
      { id: 'd-amox', drug_name: 'AMOXYCILLIN 500MG', category: 'Antibiotic', dosage: '1 cap', frequency: 'TDS', duration: '5 days' },
      { id: 'd-asp', drug_name: 'ASPIRIN 100MG', category: 'Pain', dosage: '1 tab', frequency: 'OD', duration: '5 days' },
      { id: 'd-para', drug_name: 'PARACETAMOL 500MG', category: 'Pain', dosage: '1 tab', frequency: 'QID', duration: '5 days' }
    ];
    medicalNotesEditingAllowed = function () { return true; };
    conHistPatientsUpdate = function (id, payload) {
      seen = { id: id, allergy: payload && payload.allergy };
      return Promise.resolve({ error: null });
    };
    const fld = document.getElementById('fldAllergy');
    const med = document.getElementById('fldMedHistory');
    const meds = document.getElementById('fldMedications');
    if (med && !med.value) med.value = 'Nil';
    if (meds && !meds.value) meds.value = '';
    rxDrugComboRender(idx);
    const before = menu.innerHTML;
    fld.value = 'Penicillin';
    saveMedicalHistory();
    await wait(60);
    const seenPen = seen && seen.allergy;
    const afterPen = menu.innerHTML;
    const penName = menu.querySelector('.rx-drug-opt--allergy .rx-drug-opt-name');
    const penColor = penName ? getComputedStyle(penName).color : '';
    fld.value = 'NKDA';
    saveMedicalHistory();
    await wait(60);
    const afterNkda = menu.innerHTML;
    const cacheNkda = rxCurrentAllergyText();
    fld.value = 'Penicillin';
    saveMedicalHistory();
    await wait(60);
    let release = null;
    const realFrom = SB.from.bind(SB);
    SB.from = function (table) {
      if (table !== 'patients') return realFrom(table);
      return {
        select: function () { return this; },
        eq: function () { return this; },
        maybeSingle: function () {
          return new Promise(function (res) {
            release = function () { res({ data: { allergy: 'OLDSTALE' }, error: null }); };
          });
        }
      };
    };
    const pending = rxLoadPatientAllergy(pid, { force: true });
    SB.from = realFrom;
    fld.value = 'Aspirin';
    saveMedicalHistory();
    await wait(60);
    const beforeRelease = rxPatientAllergy && rxPatientAllergy.text;
    if (release) release();
    await pending;
    const afterRelease = rxPatientAllergy && rxPatientAllergy.text;
    const afterAsp = menu.innerHTML;
    return {
      ready: true,
      build: window.__JSM_BUILD || '',
      href: location.href,
      beforeAmox: before.indexOf('rx-drug-opt--allergy') >= 0 && before.indexOf('AMOXYCILLIN 500MG') >= 0,
      beforeHtmlHasClass: before.indexOf('rx-drug-opt--allergy') >= 0,
      seenPen: seenPen,
      afterPenAmox: afterPen.indexOf('AMOXYCILLIN 500MG') >= 0 &&
        afterPen.slice(Math.max(0, afterPen.indexOf('AMOXYCILLIN 500MG') - 180), afterPen.indexOf('AMOXYCILLIN 500MG') + 40).indexOf('rx-drug-opt--allergy') >= 0,
      afterPenPara: afterPen.indexOf('PARACETAMOL 500MG') >= 0 &&
        afterPen.slice(Math.max(0, afterPen.indexOf('PARACETAMOL 500MG') - 180), afterPen.indexOf('PARACETAMOL 500MG') + 40).indexOf('rx-drug-opt--allergy') >= 0,
      penBadge: afterPen.indexOf('rx-badge--danger') >= 0,
      penColor: penColor,
      menuOpen: menu.hidden === false,
      afterNkdaClass: afterNkda.indexOf('rx-drug-opt--allergy') >= 0,
      cacheNkda: cacheNkda,
      beforeRelease: beforeRelease,
      afterRelease: afterRelease,
      afterAspAspirin: afterAsp.indexOf('ASPIRIN 100MG') >= 0 &&
        afterAsp.slice(Math.max(0, afterAsp.indexOf('ASPIRIN 100MG') - 180), afterAsp.indexOf('ASPIRIN 100MG') + 40).indexOf('rx-drug-opt--allergy') >= 0,
      afterAspAmox: afterAsp.indexOf('AMOXYCILLIN 500MG') >= 0 &&
        afterAsp.slice(Math.max(0, afterAsp.indexOf('AMOXYCILLIN 500MG') - 180), afterAsp.indexOf('AMOXYCILLIN 500MG') + 40).indexOf('rx-drug-opt--allergy') >= 0
    };
  } finally {
    conPatientId = prev.conPatientId;
    conPatientData = prev.conPatientData;
    conMedPatientId = prev.conMedPatientId;
    conMedPatientData = prev.conMedPatientData;
    rxPatientAllergy = prev.rxPatientAllergy;
    rxAllergyEpoch = prev.rxAllergyEpoch;
    rxDrugCatalog = prev.rxDrugCatalog;
    rxLines = prev.rxLines;
    rxComboState = prev.rxComboState;
    conHistPatientsUpdate = prev.update;
    medicalNotesEditingAllowed = prev.allowed;
    SB.from = prev.from;
    var a = document.getElementById('fldAllergy');
    var h = document.getElementById('fldMedHistory');
    var m = document.getElementById('fldMedications');
    if (a) a.value = prev.allergy || '';
    if (h) h.value = prev.med || '';
    if (m) m.value = prev.meds || '';
    host.remove();
  }
})()`;

(async function main() {
    var conSrc = read('app-consultation.js');
    var idxSrc = read('index.html');
    var cssSrc = read('style.css');
    var appSrc = read('app.js');

    console.log('=== smoke: source ===');
    pass('index BUILD', idxSrc.indexOf("BUILD = '" + EXPECTED_BUILD + "'") >= 0, EXPECTED_BUILD);
    pass('save publishes allergy into the drug guard',
        extractFn(conSrc, 'saveMedicalHistory').indexOf('rxPublishAllergyText(conMedPatientId, payload.allergy)') >= 0);
    pass('open drug menu is repainted from the published allergy',
        extractFn(conSrc, 'rxPublishAllergyText').indexOf('rxRepaintOpenDrugMenus') >= 0);
    pass('in-flight allergy read cannot overwrite a newer save',
        extractFn(conSrc, 'rxLoadPatientAllergy').indexOf('epoch !== rxAllergyEpoch') >= 0);
    pass('dropdown marks a matching drug',
        extractFn(conSrc, 'rxDrugComboRender').indexOf('rx-drug-opt--allergy') >= 0 &&
        extractFn(conSrc, 'rxDrugComboRender').indexOf('rxAllergyMatch') >= 0);

    console.log('\n=== unit ===');
    var ctx = {
        console: console,
        document: { querySelectorAll: function () { return []; } },
        conPatientId: 'p1',
        conPatientData: { allergy: '' },
        rxPatientAllergy: { pid: 'p1', text: '' },
        rxAllergyEpoch: 0,
        rxRefreshAllBadges: function () { ctx.badgeRefreshes = (ctx.badgeRefreshes || 0) + 1; }
    };
    vm.createContext(ctx);
    vm.runInContext([
        extractVar(conSrc, 'RX_ALLERGY_CLASSES', '];'),
        extractVar(conSrc, 'RX_ALLERGY_NONE_RE', '/i;'),
        extractFn(conSrc, 'rxAllergyTerms'),
        extractFn(conSrc, 'rxAllergyMatch'),
        extractFn(conSrc, 'rxCurrentAllergyText'),
        extractFn(conSrc, 'rxRepaintOpenDrugMenus'),
        extractFn(conSrc, 'rxPublishAllergyText')
    ].join('\n'), ctx);
    function run(code) { return vm.runInContext(code, ctx); }
    pass('stale cache does not flag Amoxicillin', run("rxAllergyMatch('AMOXYCILLIN 500MG')") === '');
    run("rxPublishAllergyText('p1', 'Penicillin')");
    var hit = run("rxAllergyMatch('AMOXYCILLIN 500MG')");
    pass('publish makes Amoxicillin an allergy hit', hit === 'penicillin', hit || 'no hit');
    pass('publish refreshes line badges', ctx.badgeRefreshes >= 1, 'n=' + ctx.badgeRefreshes);
    run("rxPublishAllergyText('p1', 'NKDA')");
    pass('NKDA clears the guard', run("rxAllergyMatch('AMOXYCILLIN 500MG')") === '');

    var deferred = {};
    deferred.promise = new Promise(function (resolve) { deferred.resolve = resolve; });
    ctx.SB = {
        from: function () {
            return {
                select: function () { return this; },
                eq: function () { return this; },
                maybeSingle: function () { return deferred.promise; }
            };
        }
    };
    ctx.Promise = Promise;
    vm.runInContext(extractFn(conSrc, 'rxLoadPatientAllergy'), ctx);
    var loadP = vm.runInContext("rxLoadPatientAllergy('p1', { force: true })", ctx);
    run("rxPublishAllergyText('p1', 'Aspirin')");
    deferred.resolve({ data: { allergy: 'OLDSTALE' }, error: null });
    await loadP;
    pass('late DB read keeps the saved allergy', run('rxPatientAllergy.text') === 'Aspirin', run('rxPatientAllergy.text'));
    pass('Aspirin flags aspirin and not amoxicillin',
        !!run("rxAllergyMatch('ASPIRIN 100MG')") && run("rxAllergyMatch('AMOXYCILLIN 500MG')") === '');

    console.log('\n=== HTML ===');
    pass('medical history save button calls saveMedicalHistory',
        /onclick="saveMedicalHistory\(\)"/.test(idxSrc));
    pass('allergy chips and NKDA control are in the medical history tab',
        idxSrc.indexOf('id="conAllergyChips"') >= 0 &&
        idxSrc.indexOf('id="fldAllergy"') >= 0 &&
        idxSrc.indexOf('id="conAllergyNkda"') >= 0);
    pass('allergy row is red and the badge is the danger style',
        cssSrc.indexOf('.rx-drug-opt--allergy .rx-drug-opt-name { color: #b91c1c; }') >= 0 &&
        cssSrc.indexOf('.rx-badge--danger { background: #fee2e2; color: #b91c1c; }') >= 0);

    console.log('\n=== HTTP spot: live :' + LIVE_PORT + ' ===');
    var liveIdx = null;
    var liveJs = null;
    var liveCss = null;
    try {
        liveIdx = await httpGet(LIVE_PORT, '/index.html?allergycheck=1');
        liveJs = await httpGet(LIVE_PORT, '/app-consultation.js?allergycheck=1');
        liveCss = await httpGet(LIVE_PORT, '/style.css?allergycheck=1');
    } catch (e) {
        pass('live server reachable', false, e && e.message);
    }
    if (liveIdx) {
        pass('GET /index.html', liveIdx.status === 200 && liveIdx.body.indexOf(EXPECTED_BUILD) >= 0,
            'HTTP ' + liveIdx.status);
        pass('served page still wires saveMedicalHistory',
            liveIdx.status === 200 && liveIdx.body.indexOf('saveMedicalHistory()') >= 0);
    }
    if (liveJs) {
        pass('GET /app-consultation.js publishes on save',
            liveJs.status === 200 &&
            liveJs.body.indexOf('rxPublishAllergyText(conMedPatientId, payload.allergy)') >= 0,
            'HTTP ' + liveJs.status);
    }
    if (liveCss) {
        pass('GET /style.css has the allergy row colour',
            liveCss.status === 200 && liveCss.body.indexOf('.rx-drug-opt--allergy') >= 0,
            'HTTP ' + liveCss.status);
    }

    console.log('\n=== API: patients.allergy + druglist ===');
    var sbc = readSbConfig(appSrc);
    var drugs = await rest(sbc.url, sbc.key, 'GET', 'druglist',
        'select=id,drug_name&order=drug_name.asc&limit=5');
    pass('druglist REST ok', drugs.status === 200 && Array.isArray(drugs.json) && drugs.json.length > 0,
        'HTTP ' + drugs.status + (drugs.json ? ' n=' + drugs.json.length : ' ' + drugs.raw));
    var allergyCol = await rest(sbc.url, sbc.key, 'GET', 'patients', 'select=id,allergy&limit=1');
    pass('patients.allergy column readable',
        allergyCol.status === 200 && Array.isArray(allergyCol.json),
        'HTTP ' + allergyCol.status + ' ' + (allergyCol.status === 200 ? '' : allergyCol.raw));

    var smokeNo = '9' + String(Date.now()).slice(-7);
    var createdId = null;
    try {
        var ins = await rest(sbc.url, sbc.key, 'POST', 'patients', '', [{
            patient_no: smokeNo,
            full_name: 'Smoke Allergy Guard',
            allergy: ''
        }]);
        pass('test client: insert smoke patient',
            ins.status === 201 && ins.json && ins.json[0] && ins.json[0].id,
            'HTTP ' + ins.status + (ins.status === 201 ? '' : ' ' + ins.raw));
        createdId = ins.json && ins.json[0] && ins.json[0].id;
        if (createdId) {
            var patch = await rest(sbc.url, sbc.key, 'PATCH', 'patients', 'id=eq.' + createdId, {
                allergy: 'Penicillin'
            });
            pass('API write allergy Penicillin',
                patch.status === 200 && patch.json && patch.json[0] && patch.json[0].allergy === 'Penicillin',
                'HTTP ' + patch.status);
            var got = await rest(sbc.url, sbc.key, 'GET', 'patients',
                'select=allergy&id=eq.' + createdId);
            pass('API read-back allergy',
                got.status === 200 && got.json && got.json[0] && got.json[0].allergy === 'Penicillin',
                'HTTP ' + got.status);
            var nk = await rest(sbc.url, sbc.key, 'PATCH', 'patients', 'id=eq.' + createdId, { allergy: 'NKDA' });
            pass('API write NKDA',
                nk.status === 200 && nk.json && nk.json[0] && nk.json[0].allergy === 'NKDA',
                'HTTP ' + nk.status);
        }
    } finally {
        if (createdId) {
            var del = await rest(sbc.url, sbc.key, 'DELETE', 'patients', 'id=eq.' + createdId);
            pass('cleanup smoke patient', del.status >= 200 && del.status < 300, 'HTTP ' + del.status);
            var left = await rest(sbc.url, sbc.key, 'GET', 'patients',
                'select=id&id=eq.' + createdId);
            pass('smoke patient is gone', left.status === 200 && Array.isArray(left.json) && left.json.length === 0,
                'n=' + ((left.json && left.json.length) || 0));
        }
    }

    console.log('\n=== CDP live page / Runtime.evaluate ===');
    var proc = null;
    var ws = null;
    try {
        if (!fs.existsSync(CHROME)) throw new Error('Chrome not found: ' + CHROME);
        var profile = path.join(os.tmpdir(), 'cs-rx-allergy-refresh-cdp');
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* ignore */ }
        fs.mkdirSync(profile, { recursive: true });
        var hosted = 'http://127.0.0.1:' + LIVE_PORT + '/index.html?_lr=' + EXPECTED_BUILD;
        proc = child_process.spawn(CHROME, [
            '--headless=new',
            '--remote-debugging-port=' + CDP_PORT,
            '--user-data-dir=' + profile,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-sync',
            '--window-size=1400,900',
            hosted
        ], { stdio: 'ignore' });
        await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000);
        var tabs = await waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000);
        var page = (tabs || []).find(function (t) {
            return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0;
        });
        pass('CDP page target', !!page && !!page.webSocketDebuggerUrl, page && page.url);
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise(function (resolve, reject) {
            ws.addEventListener('open', resolve);
            ws.addEventListener('error', reject);
        });
        var cdp = new Cdp(ws);
        await cdp.call('Runtime.enable');
        await cdp.call('Page.enable');
        await cdp.call('Page.navigate', { url: hosted });
        await sleep(1500);
        var build = await cdp.js('window.__JSM_BUILD || ""');
        pass('Runtime.evaluate page BUILD', build === EXPECTED_BUILD, build);
        var live = await cdp.js(PAGE_SCRIPT, true, 60000);
        pass('live page helpers ready', live && live.ready === true && live.build === EXPECTED_BUILD,
            live ? ('build=' + live.build) : 'none');
        if (live && live.ready) {
            pass('live: stale cache leaves the drug menu unmarked',
                live.beforeHtmlHasClass === false, 'classPresent=' + live.beforeHtmlHasClass);
            pass('live: save sends the allergy text',
                live.seenPen === 'Penicillin', live.seenPen);
            pass('live: save marks Amoxicillin and not paracetamol',
                live.afterPenAmox === true && live.afterPenPara === false && live.penBadge === true,
                'amox=' + live.afterPenAmox + ' para=' + live.afterPenPara + ' badge=' + live.penBadge);
            pass('live: allergy name is red (#b91c1c)',
                live.penColor === 'rgb(185, 28, 28)', live.penColor);
            pass('live: menu stayed open so the repaint is visible',
                live.menuOpen === true);
            pass('live: saving NKDA clears the red marks',
                live.afterNkdaClass === false && live.cacheNkda === 'NKDA',
                'class=' + live.afterNkdaClass + ' cache=' + live.cacheNkda);
            pass('live: a late allergy read does not undo the newer save',
                live.beforeRelease === 'Aspirin' && live.afterRelease === 'Aspirin',
                'before=' + live.beforeRelease + ' after=' + live.afterRelease);
            pass('live: saved Aspirin marks aspirin and clears amoxicillin',
                live.afterAspAspirin === true && live.afterAspAmox === false,
                'asp=' + live.afterAspAspirin + ' amox=' + live.afterAspAmox);
        }
    } catch (e) {
        pass('CDP live page', false, e && e.message ? e.message : String(e));
    } finally {
        try { if (ws) ws.close(); } catch (e) { /* ignore */ }
        try { if (proc) proc.kill(); } catch (e) { /* ignore */ }
    }

    console.log('\n=== result ===');
    if (fails.length) {
        console.log('FAILED ' + fails.length + '  ' + fails.join(' | '));
        process.exit(1);
    }
    console.log('SMOKE + UNIT + HTML + SPOT + API + CDP + LIVE PAGE ALL PASS');
    process.exit(0);
})().catch(function (err) {
    console.error('ERROR', err && err.stack ? err.stack : err);
    process.exit(1);
});
