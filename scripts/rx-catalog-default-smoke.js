/**
 * Rx panel: smoke / unit / HTTP spot / API.
 *  - one add model (cards), cached drug catalog, defaults only on user pick
 *  - sticky manual quantity, allergy + duplicate checks, doctor required
 *  - rx_group_id / drug_id saved with graceful fallback
 * Run: node scripts/rx-catalog-default-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-consultation.js'))) root = process.cwd();

var EXPECTED_BUILD = '20260925notes9';
var fails = [];

function pass(name, ok, detail) {
    var line = (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —  ' + detail : '');
    console.log(line);
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}

function readSbConfig(appJs) {
    var block = appJs.match(/supabase\.createClient\(([\s\S]*?)\);/);
    if (!block) throw new Error('supabase.createClient not found');
    var parts = [];
    var re = /'([^']*)'/g;
    var m;
    while ((m = re.exec(block[1]))) parts.push(m[1]);
    if (parts.length < 2) throw new Error('could not parse SB url/key');
    return { url: parts[0], key: parts.slice(1).join('') };
}

function httpGet(host, port, reqPath) {
    return new Promise(function (resolve, reject) {
        var req = http.get({ host: host, port: port, path: reqPath, timeout: 5000 }, function (r) {
            var d = '';
            r.on('data', function (c) { d += c; });
            r.on('end', function () { resolve({ status: r.statusCode, body: d }); });
        });
        req.on('error', reject);
        req.on('timeout', function () {
            req.destroy();
            reject(new Error('timeout ' + port + reqPath));
        });
    });
}

function rest(base, key, method, table, qs, body) {
    var url = base.replace(/\/$/, '') + '/rest/v1/' + table + (qs ? '?' + qs : '');
    var headers = {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json',
        Prefer: 'return=representation'
    };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(url, {
        method: method,
        headers: headers,
        body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
        return r.text().then(function (t) {
            var json = null;
            try { json = JSON.parse(t); } catch (e) {}
            return { status: r.status, json: json, raw: t.slice(0, 240) };
        });
    });
}

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

function buildSandbox(phraseSrc, conSrc) {
    var ctx = {
        console: console,
        window: {},
        document: { querySelectorAll: function () { return []; } },
        localStorage: { getItem: function () { return null; }, setItem: function () {} },
        g: function () { return null; },
        esc: function (s) { return String(s == null ? '' : s); },
        currentLang: 'en',
        rxLines: [],
        conPatientId: 'p1',
        conPatientData: { allergy: '' },
        rxPatientAllergy: null
    };
    vm.createContext(ctx);
    vm.runInContext(phraseSrc, ctx);
    vm.runInContext([
        extractVar(conSrc, 'RX_ALLERGY_CLASSES', '];'),
        extractVar(conSrc, 'RX_ALLERGY_NONE_RE', '/i;'),
        extractFn(conSrc, 'rxAllergyTerms'),
        extractFn(conSrc, 'rxAllergyMatch'),
        extractFn(conSrc, 'rxCurrentAllergyText'),
        extractFn(conSrc, 'rxCloneSavedLine'),
        extractFn(conSrc, 'rxInferQuantityManual'),
        extractFn(conSrc, 'rxLineHasDrug'),
        extractFn(conSrc, 'rxDrugKey'),
        extractFn(conSrc, 'rxStripLinkCols')
    ].join('\n'), ctx);
    return ctx;
}

(async function main() {
    var conSrc = fs.readFileSync(path.join(root, 'app-consultation.js'), 'utf8');
    var phraseSrc = fs.readFileSync(path.join(root, 'app-rx-phrases.js'), 'utf8');
    var idxSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    var appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    var cssSrc = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
    var i18nSrc = fs.readFileSync(path.join(root, 'app-i18n-extra.js'), 'utf8');

    console.log('=== smoke: source ===');
    pass('index BUILD', new RegExp("BUILD = '" + EXPECTED_BUILD + "'").test(idxSrc), EXPECTED_BUILD);
    pass('staged strip removed',
        conSrc.indexOf('rxStagedLines') < 0 && idxSrc.indexOf('rxStagedWrap') < 0 &&
        phraseSrc.indexOf('rxConfirmLineAndAddNext') < 0);
    pass('per-line druglist select removed', conSrc.indexOf('function populateDrugSelect') < 0);
    pass('catalog fetched once (rxLoadDrugCatalog) and cached',
        /function rxLoadDrugCatalog/.test(conSrc) && /rxDrugCatalog = rows/.test(conSrc));
    var choose = extractFn(conSrc, 'rxApplyCatalogDrugToLine');
    pass('catalog defaults applied only on user pick',
        choose.indexOf('rxApplyCatalogDefaultsToLine') >= 0 &&
        extractFn(conSrc, 'rxLineCardHtml').indexOf('rxApplyCatalogDefaultsToLine') < 0 &&
        extractFn(conSrc, 'rxOnDrugCatalogLoaded').indexOf('rxApplyCatalogDefaultsToLine') < 0);
    pass('saved list paste goes into rxLines',
        extractFn(conSrc, 'rxApplySavedDrugList').indexOf('rxLines.push(line)') >= 0);
    var save = extractFn(conSrc, 'saveFullPrescription');
    pass('save requires doctor', save.indexOf('conActiveDoctorId') >= 0 && save.indexOf('con.rx.needDoctor') >= 0);
    pass('save guards double submit', save.indexOf('rxSaveInFlight') >= 0);
    pass('save runs allergy/duplicate checks', save.indexOf('rxConfirmSafetyChecks') >= 0);
    pass('replace asks for confirmation', save.indexOf('con.rx.confirmReplaceSaved') >= 0);
    var write = extractFn(conSrc, 'rxWritePrescription');
    pass('replace inserts before deleting old rows',
        write.lastIndexOf('rxInsertDrughistoryRows(rows).then') < write.lastIndexOf('rxDeleteDrughistoryForReplace(replaceCtx).then'));
    pass('rx_group_id reused on replace', write.indexOf('replaceCtx.rx_group_id') >= 0);
    pass('insert falls back when link columns missing',
        extractFn(conSrc, 'rxInsertDrughistoryRows').indexOf('rxHistoryLinkColsMissing = true') >= 0);
    pass('history groups by rx_group_id', extractFn(conSrc, 'loadDrugHistory').indexOf("'g:' + gid") >= 0);
    pass('row saves route + drug_id + rx_group_id',
        /route:\s+String\(line\.route/.test(phraseSrc) && phraseSrc.indexOf('row.rx_group_id = rxGroupId') >= 0 &&
        phraseSrc.indexOf('row.drug_id = drugId') >= 0);
    pass('SQL migration present',
        fs.existsSync(path.join(root, 'drughistory_rx_group.sql')) &&
        /add column if not exists rx_group_id/.test(fs.readFileSync(path.join(root, 'drughistory_rx_group.sql'), 'utf8')));
    pass('cancel confirms discard', /btnCancelRx'\)\.addEventListener\('click', rxCancelDraft\)/.test(appSrc));
    pass('allergy modal proceed key present', i18nSrc.indexOf("'con.rx.allergyWarnProceed'") >= 0);
    pass('new CSS present', cssSrc.indexOf('.rx-drug-menu') >= 0 && cssSrc.indexOf('.rx-more-menu') >= 0);
    var printFn = extractFn(conSrc, 'printDrugLabel');
    pass('label print keeps reminder + popup flow',
        printFn.indexOf('confirmPrintReminder()') >= 0 && printFn.indexOf('window.open(') >= 0);
    pass('label print falls back to hidden iframe when popup blocked',
        printFn.indexOf('rxPrintLabelsInFrame(html)') >= 0 &&
        conSrc.indexOf('function rxPrintLabelsInFrame(') >= 0);
    var labelDocFn = extractFn(conSrc, 'rxLabelDocHtml');
    pass('label document prints itself on load',
        labelDocFn.indexOf('window.onload=function(){') >= 0 && labelDocFn.indexOf('window.print();') >= 0);

    console.log('\n=== unit: sandbox ===');
    var sb = buildSandbox(phraseSrc, conSrc);
    var run = function (code) { return vm.runInContext(code, sb); };

    run("rxLines = [rxEmptyLine()]; rxLines[0].drug_name = 'AMOXYCILLIN 250MG';" +
        "rxApplyComboTextToLine(rxLines[0], 'dosage', '1 tab');" +
        "rxApplyComboTextToLine(rxLines[0], 'frequency', 'TDS');" +
        "rxApplyDaysToLine(0, '7');");
    var autoQty = run('rxLineQuantityText(rxLines[0])');
    pass('auto qty = dose × freq × days', autoQty === '21', 'got ' + autoQty);

    run("rxApplyComboTextToLine(rxLines[0], 'quantity', '20'); rxSetQuantityFromUser(rxLines[0]); rxApplyDaysToLine(0, '5');");
    var stickyQty = run('rxLineQuantityText(rxLines[0])');
    pass('manual qty survives days change', stickyQty === '20' && run('rxLines[0].quantity_manual') === true,
        'got ' + stickyQty);

    run("rxLines[0].quantity_code=''; rxLines[0].quantity_custom=''; rxSetQuantityFromUser(rxLines[0]);");
    var backAuto = run('rxLineQuantityText(rxLines[0])');
    pass('clearing qty returns to auto', backAuto === '15' && run('rxLines[0].quantity_manual') === false,
        'got ' + backAuto);

    var legacy = run("rxCloneSavedLine({ drug_name: 'AMOXY', dosage: '1 tab', frequency: 'TDS', duration: '7 days', quantity: '20' })");
    pass('legacy history qty ≠ computed → manual', legacy.quantity_manual === true);
    var legacyAuto = run("rxCloneSavedLine({ drug_name: 'AMOXY', dosage: '1 tab', frequency: 'TDS', duration: '7 days', quantity: '21' })");
    pass('legacy history qty = computed → auto', legacyAuto.quantity_manual === false);

    var synced = run("(function(){ var l = rxEmptyLine(); l.drug_name='X'; l.route='oral'; rxSyncLineLegacyFields(l); return l; })()");
    pass('route kept, empty phrases not saved as —', synced.route === 'oral' && synced.dosage === '');

    var cases = [
        ['AMOXYCILLIN 500MG', 'Penicillin', true],
        ['AUGMENTIN 625MG', 'penicillin allergy', true],
        ['PONSTAN 250MG', 'NSAID', true],
        ['IBUPROFEN 400MG', 'aspirin', true],
        ['PARACETAMOL 500MG', 'Penicillin; sulfa drugs', false],
        ['AMOXYCILLIN 250MG', 'NKDA', false],
        ['AMOXYCILLIN 250MG', 'Nil', false],
        ['AMOXYCILLIN 250MG', 'no known drug allergy', false],
        ['AMOXYCILLIN 250MG', '青霉素過敏', true],
        ['PANADOL', 'paracetamol', true],
        ['METRONIDAZOLE 200MG', 'Flagyl', true],
        ['CHLORHEXIDINE MOUTHWASH', '', false]
    ];
    cases.forEach(function (c) {
        var hit = run('rxAllergyMatch(' + JSON.stringify(c[0]) + ', ' + JSON.stringify(c[1]) + ')');
        pass('allergy ' + c[0] + ' vs "' + c[1] + '"', !!hit === c[2], hit ? 'hit=' + hit : 'no hit');
    });

    var stripped = run("rxStripLinkCols({ a: 1, rx_group_id: 'x', drug_id: 'y' })");
    pass('strip link cols', stripped.a === 1 && stripped.rx_group_id === undefined && stripped.drug_id === undefined);

    console.log('\n=== HTTP spot: live / static ===');
    var served = null;
    var ports = [8124, 8123, 5500];
    var i;
    for (i = 0; i < ports.length; i++) {
        try {
            var idx = await httpGet('127.0.0.1', ports[i], '/index.html?b=' + EXPECTED_BUILD);
            var js = await httpGet('127.0.0.1', ports[i], '/app-consultation.js?b=' + EXPECTED_BUILD);
            var hit = { port: ports[i], idx: idx, js: js };
            if (new RegExp("BUILD = '" + EXPECTED_BUILD + "'").test(idx.body)) {
                served = hit;
                break;
            }
            if (!served) served = hit;
        } catch (e) {
            if (!served) served = { error: String(e.message || e), port: ports[i] };
        }
    }
    if (!served || (served.error && !served.idx)) {
        pass('client reachable', false, served && served.error);
    } else {
        var servedBuild = (served.idx.body.match(/BUILD = '([^']+)'/) || [])[1] || '';
        pass('index.html ' + served.port, served.idx.status === 200, 'HTTP ' + served.idx.status);
        pass('served BUILD', servedBuild === EXPECTED_BUILD, servedBuild + ' port=' + served.port);
        pass('served JS has new panel',
            served.js.status === 200 && served.js.body.indexOf('function rxDrugComboRender') >= 0 &&
            served.js.body.indexOf('function populateDrugSelect') < 0);
    }

    console.log('\n=== API: druglist + drughistory ===');
    var sbc = readSbConfig(appSrc);
    var drugs = await rest(sbc.url, sbc.key, 'GET', 'druglist',
        'select=id,drug_name,duration&is_active=eq.true&limit=50');
    pass('druglist REST ok', drugs.status === 200 && Array.isArray(drugs.json), 'HTTP ' + drugs.status);
    pass('catalog non-empty', Array.isArray(drugs.json) && drugs.json.length >= 2,
        'n=' + (drugs.json && drugs.json.length));

    var hist = await rest(sbc.url, sbc.key, 'GET', 'drughistory', 'select=id,drug_name,route&limit=1');
    pass('drughistory REST ok', hist.status === 200 && Array.isArray(hist.json), 'HTTP ' + hist.status);

    var linkCols = await rest(sbc.url, sbc.key, 'GET', 'drughistory', 'select=id,rx_group_id,drug_id&limit=1');
    var linkReady = linkCols.status === 200;
    console.log('INFO  drughistory rx_group_id/drug_id columns: ' +
        (linkReady ? 'present' : 'missing — run drughistory_rx_group.sql (app falls back to date grouping)'));

    if (linkReady) {
        console.log('\n=== test client: rx_group_id round-trip ===');
        var crypto = require('crypto');
        var PID = '18d4d8a2-7d16-403c-962c-cba93540b132';
        var today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
        var catalog = (drugs.json || []).slice(0, 2);
        var gA = crypto.randomUUID();
        var gB = crypto.randomUUID();
        var mkRow = function (d, group, days, tag) {
            return {
                patient_id: PID, drug_name: d.drug_name, drug_id: String(d.id), route: 'Oral',
                dosage: '1 tablet each time', frequency: '2 times per day',
                duration: days + ' days', quantity: String(days * 2),
                prescribed_date: today, dentist_name: 'SMOKE DR', doctor_tag: 'SMOKE DR',
                remarks: 'SMOKE_RX ' + tag, rx_group_id: group
            };
        };
        var insA = await rest(sbc.url, sbc.key, 'POST', 'drughistory', '',
            catalog.map(function (d) { return mkRow(d, gA, 3, 'A1'); }));
        pass('insert prescription A (2 rows, group + drug_id)',
            insA.status === 201 && Array.isArray(insA.json) && insA.json.length === 2,
            'HTTP ' + insA.status + (insA.status !== 201 ? ' ' + insA.raw : ''));
        var oldIds = Array.isArray(insA.json) ? insA.json.map(function (r) { return r.id; }) : [];

        var readA = await rest(sbc.url, sbc.key, 'GET', 'drughistory',
            'select=id,drug_id,route,rx_group_id&rx_group_id=eq.' + gA);
        var rowsA = readA.json || [];
        pass('read back by rx_group_id', rowsA.length === 2, 'n=' + rowsA.length);
        pass('drug_id + route persisted', rowsA.length === 2 && rowsA.every(function (r) {
            return r.route === 'Oral' && catalog.some(function (d) { return String(d.id) === r.drug_id; });
        }));

        var insB = await rest(sbc.url, sbc.key, 'POST', 'drughistory', '', [mkRow(catalog[0], gB, 5, 'B1')]);
        pass('insert prescription B (same day + doctor)', insB.status === 201, 'HTTP ' + insB.status);
        var both = await rest(sbc.url, sbc.key, 'GET', 'drughistory',
            'select=rx_group_id&rx_group_id=in.(' + gA + ',' + gB + ')');
        var distinct = {};
        (both.json || []).forEach(function (r) { distinct[r.rx_group_id] = 1; });
        pass('same-day same-doctor prescriptions stay separate groups',
            Object.keys(distinct).length === 2, 'groups=' + Object.keys(distinct).length);

        var insA2 = await rest(sbc.url, sbc.key, 'POST', 'drughistory', '',
            catalog.map(function (d) { return mkRow(d, gA, 7, 'A2'); }));
        pass('replace: insert new version under same group', insA2.status === 201, 'HTTP ' + insA2.status);
        var delOld = await rest(sbc.url, sbc.key, 'DELETE', 'drughistory', 'id=in.(' + oldIds.join(',') + ')');
        pass('replace: delete old rows after insert', delOld.status >= 200 && delOld.status < 300,
            'HTTP ' + delOld.status);
        var readA2 = await rest(sbc.url, sbc.key, 'GET', 'drughistory',
            'select=id,duration&rx_group_id=eq.' + gA);
        var rowsA2 = readA2.json || [];
        pass('group A now holds only the new version', rowsA2.length === 2 && rowsA2.every(function (r) {
            return r.duration === '7 days';
        }), 'n=' + rowsA2.length);
    }

    var leftover = await rest(sbc.url, sbc.key, 'GET', 'drughistory',
        'select=id,remarks&remarks=like.SMOKE_RX*');
    var leftoverN = Array.isArray(leftover.json) ? leftover.json.length : 0;
    if (leftoverN) {
        var ids = leftover.json.map(function (r) { return r.id; }).join(',');
        var del = await rest(sbc.url, sbc.key, 'DELETE', 'drughistory', 'id=in.(' + ids + ')');
        pass('cleanup leftover smoke Rx rows', del.status >= 200 && del.status < 300, 'n=' + leftoverN);
    } else {
        pass('no leftover smoke Rx rows', leftover.status === 200, 'n=0');
    }

    console.log('\n=== result ===');
    if (fails.length) {
        console.log('FAILED ' + fails.length + '  ' + fails.join(' | '));
        process.exit(1);
    }
    console.log('SMOKE + UNIT + HTTP + API ALL PASS');
    process.exit(0);
})().catch(function (err) {
    console.error('ERROR', err && err.stack ? err.stack : err);
    process.exit(1);
});
