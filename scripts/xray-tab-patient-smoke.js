/**
 * X-ray tab patient switch: smoke, client simulation, live server, API.
 * Opening the consultation X-ray tab must drop the previous patient's films
 * and load the current consultation patient.
 * Run: node scripts/xray-tab-patient-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-xray.js'))) root = process.cwd();

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
        req.on('timeout', function () { req.destroy(); reject(new Error('timeout ' + port + reqPath)); });
    });
}

function restGet(base, key, table, qs) {
    var url = base.replace(/\/$/, '') + '/rest/v1/' + table + '?' + qs;
    return fetch(url, {
        headers: {
            apikey: key,
            Authorization: 'Bearer ' + key,
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

(async function main() {
    var xraySrc = fs.readFileSync(path.join(root, 'app-xray.js'), 'utf8');
    var conSrc = fs.readFileSync(path.join(root, 'app-consultation.js'), 'utf8');
    var linkSrc = fs.readFileSync(path.join(root, 'app-xray-link.js'), 'utf8');
    var idxSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    var appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

    console.log('=== smoke: source ===');
    pass('merge keeps the incoming chart when ids differ',
        /if \(String\(base\.id\) !== String\(extra\.id\)\) return Object\.assign\(\{\}, base\);/.test(xraySrc));
    pass('merge no longer returns the previous chart on a switch',
        !/String\(base\.id\) !== String\(extra\.id\)[\s\S]{0,80}return Object\.assign\(\{\}, extra\)/.test(xraySrc));
    pass('films clear before the next fetch',
        /function xrayClearDisplayedFilms\(/.test(xraySrc) &&
        /if \(patientChanged\) xrayClearDisplayedFilms\(\);/.test(xraySrc));
    var tabBranch = conSrc.slice(conSrc.indexOf("if (tab === 'xrays')"), conSrc.indexOf("if (tab === 'forms')"));
    pass('xray tab syncs when consultation patient differs',
        /xrayMismatch/.test(tabBranch) && /syncXrayPatient\(xrayNow\.id, xrayNow\)/.test(tabBranch));
    pass('xray tab does not reload a stale xrayPatientId first',
        !/if \(typeof xrayPatientId !== 'undefined' && xrayPatientId\) \{\s*if \(typeof loadXrayRecords/.test(tabBranch));
    pass('linked loader clears on patient change',
        /_xrayLinkLastPid !== String\(xrayPatientId\)[\s\S]{0,400}xrayClearDisplayedFilms\(/.test(linkSrc));
    pass('build stamp bumped',
        /BUILD = '20260925notes8'/.test(idxSrc));

    console.log('\n=== client simulation ===');
    var strips = { innerHTML: '<div class="xray-card" data-id="old-film">OLD PATIENT FILM</div>' };
    var bannerName = { textContent: 'Old Patient' };
    var bannerNo = { textContent: '111' };
    var loads = [];
    var sandbox = {
        xrayPatientId: 'patient-old',
        xrayPatientData: { id: 'patient-old', full_name: 'Old Patient', patient_no: '111' },
        xrayAllRecords: [{ id: 'old-film', patient_id: 'patient-old', notes: 'OLD' }],
        xrayFiltered: [{ id: 'old-film', patient_id: 'patient-old' }],
        xraySelected: new Set(['old-film']),
        xrayCurrentIdx: 2,
        conPatientId: 'patient-new',
        conPatientData: { id: 'patient-new', full_name: 'New Patient', patient_no: '222' },
        activePatientSlots: [{ id: 'patient-new', full_name: 'New Patient', patient_no: '222' }],
        g: function (id) {
            if (id === 'xrayClinicStrips') return strips;
            if (id === 'conXrayBannerName') return bannerName;
            if (id === 'conXrayBannerNo') return bannerNo;
            if (id === 'conXrayBanner') return { style: { display: '' } };
            if (id === 'xrayMainContent') return { style: { display: '' } };
            return null;
        },
        esc: function (s) { return String(s); },
        mediaTr: function (k) { return k === 'common.loadingEllipsis' ? 'Loading…' : k; },
        document: { activeElement: null },
        loadXrayRecords: function () { loads.push(sandbox.xrayPatientId); return Promise.resolve(); },
        loadDiyLinks: function () {},
        loadNntLocalScans: function () {},
        syncXrayNotesToggleLabel: function () {},
        xrayPatientSearchLabel: function (p) { return p.full_name; },
        xrayPatientBannerName: function (p) { return p.full_name || '—'; },
        formatDobAge: function () { return ''; },
        updateSelectedCount: function () {},
        console: console
    };
    sandbox.global = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(extractFn(xraySrc, 'xrayMergePatientRecord'), sandbox);
    vm.runInContext(extractFn(xraySrc, 'xrayClearDisplayedFilms'), sandbox);
    vm.runInContext(extractFn(xraySrc, 'xrayResolveCurrentPatient'), sandbox);
    vm.runInContext(extractFn(xraySrc, 'syncXrayPatient'), sandbox);

    var merged = sandbox.xrayMergePatientRecord(
        { id: 'patient-new', full_name: 'New Patient', patient_no: '222' },
        { id: 'patient-old', full_name: 'Old Patient', patient_no: '111', hkid: 'A123' }
    );
    pass('merge simulation returns the new chart',
        merged && merged.id === 'patient-new' && merged.patient_no === '222',
        merged && merged.patient_no);

    var same = sandbox.xrayMergePatientRecord(
        { id: 'patient-new', full_name: 'New' },
        { id: 'patient-new', full_name: 'New Patient', patient_no: '222' }
    );
    pass('merge simulation still fills fields for the same chart',
        same && same.patient_no === '222' && same.full_name === 'New Patient');

    sandbox.xraySyncFromActive = function (p) {
        var m = sandbox.xrayMergePatientRecord(p, sandbox.xrayResolveCurrentPatient());
        sandbox.syncXrayPatient(m.id, m);
    };
    sandbox.xraySyncFromActive({ id: 'patient-new', full_name: 'New Patient', patient_no: '222' });
    pass('active-patient sync leaves the new id',
        sandbox.xrayPatientId === 'patient-new', String(sandbox.xrayPatientId));
    pass('active-patient sync clears the old film marker',
        strips.innerHTML.indexOf('OLD PATIENT FILM') < 0 &&
        strips.innerHTML.indexOf('Loading') >= 0,
        strips.innerHTML.slice(0, 80));
    pass('active-patient sync requests films for the new id',
        loads.indexOf('patient-new') >= 0 && loads.indexOf('patient-old') < 0,
        loads.join(','));
    pass('banner shows the new patient before films return',
        bannerName.textContent === 'New Patient' && bannerNo.textContent === '222');

    strips.innerHTML = '<div class="xray-card">OLD PATIENT FILM</div>';
    sandbox.xrayAllRecords = [{ id: 'old-film' }];
    sandbox.xrayPatientId = 'patient-old';
    sandbox.xrayPatientData = { id: 'patient-old', full_name: 'Old Patient', patient_no: '111' };
    sandbox.conPatientId = 'patient-new';
    sandbox.conPatientData = { id: 'patient-new', full_name: 'New Patient', patient_no: '222' };
    loads.length = 0;
    var xrayNow = sandbox.conPatientData;
    var xrayMismatch = String(sandbox.xrayPatientId || '') !== String(xrayNow.id);
    if (xrayMismatch) sandbox.syncXrayPatient(xrayNow.id, xrayNow);
    pass('tab click switches off the previous patient',
        xrayMismatch && sandbox.xrayPatientId === 'patient-new' &&
        strips.innerHTML.indexOf('OLD PATIENT FILM') < 0,
        'id=' + sandbox.xrayPatientId);

    console.log('\n=== live server ===');
    var live = null;
    var livePort = 0;
    // Prefer the port serving this checkout's BUILD; other checkouts may share the machine.
    var ports = [5500, 8123, 8124];
    for (var pi = 0; pi < ports.length; pi++) {
        try {
            var probe = await httpGet('127.0.0.1', ports[pi], '/index.html');
            if (!probe || probe.status !== 200) continue;
            var isOurs = probe.body.indexOf("BUILD = '20260925notes8'") >= 0;
            if (!livePort || isOurs) { live = probe; livePort = ports[pi]; }
            if (isOurs) break;
        } catch (e) {}
    }
    if (!live) pass('clinic UI reachable', false, 'no listener on ' + ports.join('/'));
    if (live) {
        pass('clinic UI reachable', live.status === 200, ':' + livePort);
        var build = (live.body.match(/BUILD = '([^']+)'/) || [])[1];
        pass('served build is 20260925notes8', build === '20260925notes8', build || 'missing');
        var xrayJs = await httpGet('127.0.0.1', livePort, '/app-xray.js?b=20260925notes8');
        var conJs = await httpGet('127.0.0.1', livePort, '/app-consultation.js?b=20260925notes8');
        pass('served app-xray.js clears on patient change',
            xrayJs.status === 200 &&
            xrayJs.body.indexOf('if (patientChanged) xrayClearDisplayedFilms();') >= 0 &&
            xrayJs.body.indexOf('return Object.assign({}, base);') >= 0,
            'HTTP ' + xrayJs.status);
        pass('served app-consultation.js syncs mismatched xray tab',
            conJs.status === 200 && conJs.body.indexOf('syncXrayPatient(xrayNow.id, xrayNow)') >= 0,
            'HTTP ' + conJs.status);
    }

    console.log('\n=== API ===');
    var sb = readSbConfig(appSrc);
    var plist = await restGet(sb.url, sb.key, 'patients',
        'select=id,patient_no,full_name,clinic_tag&order=patient_no.asc&limit=40');
    pass('patients readable', plist.status === 200 && Array.isArray(plist.json),
        'HTTP ' + plist.status);
    var patients = Array.isArray(plist.json) ? plist.json : [];
    var withFilms = [];
    for (var i = 0; i < patients.length && withFilms.length < 2; i++) {
        var xr = await restGet(sb.url, sb.key, 'xrays',
            'select=id,patient_id,xray_type&patient_id=eq.' + patients[i].id + '&limit=5');
        if (xr.status === 200 && Array.isArray(xr.json) && xr.json.length) {
            withFilms.push({ patient: patients[i], films: xr.json });
        }
    }
    if (withFilms.length < 2) {
        var any = await restGet(sb.url, sb.key, 'xrays',
            'select=id,patient_id,xray_type&limit=30');
        pass('xrays readable', any.status === 200 && Array.isArray(any.json), 'HTTP ' + any.status);
        var seen = {};
        (any.json || []).forEach(function (row) {
            if (!seen[row.patient_id]) seen[row.patient_id] = [];
            if (seen[row.patient_id].length < 5) seen[row.patient_id].push(row);
        });
        var pids = Object.keys(seen).filter(function (id) { return seen[id].length; });
        for (var k = 0; k < pids.length && withFilms.length < 2; k++) {
            var prow = await restGet(sb.url, sb.key, 'patients',
                'select=id,patient_no,full_name,clinic_tag&id=eq.' + pids[k] + '&limit=1');
            var p = prow.json && prow.json[0];
            if (p) withFilms.push({ patient: p, films: seen[pids[k]] });
        }
    }
    pass('two patients with films', withFilms.length >= 2,
        withFilms.map(function (w) { return w.patient.patient_no + ':' + w.films.length; }).join(' | '));
    if (withFilms.length >= 2) {
        var a = withFilms[0];
        var b = withFilms[1];
        var aIds = a.films.map(function (f) { return f.id; });
        var bOnly = await restGet(sb.url, sb.key, 'xrays',
            'select=id,patient_id&patient_id=eq.' + b.patient.id + '&limit=20');
        var bIds = (bOnly.json || []).map(function (f) { return f.id; });
        var leak = bIds.filter(function (id) { return aIds.indexOf(id) >= 0; });
        pass('current-patient query excludes the previous patient films',
            bOnly.status === 200 && leak.length === 0 && bIds.length > 0,
            '#' + a.patient.patient_no + ' vs #' + b.patient.patient_no +
            ' leak=' + leak.length + ' current=' + bIds.length);
        pass('film rows are tagged with the queried patient',
            (bOnly.json || []).every(function (f) { return String(f.patient_id) === String(b.patient.id); }));
    }

    console.log('\n=== result ===');
    if (fails.length) {
        console.log('FAILED ' + fails.length + '  ' + fails.join(' | '));
        process.exit(1);
    }
    console.log('SMOKE + CLIENT + LIVE + API ALL PASS');
    process.exit(0);
})().catch(function (err) {
    console.error('ERROR', err && err.stack ? err.stack : err);
    process.exit(1);
});
