/**
 * Bill doctor dropdown collapse smoke / spot / API test.
 * Display-only: no clinic suffix, one row per person, quiet clinic wiring.
 * Run: node scripts/bill-doctor-collapse-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app.js'))) root = process.cwd();

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
        var req = http.get({ host: host, port: port, path: reqPath, timeout: 4000 }, function (r) {
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

function loadBillDoctorFns(appSrc) {
    var start = appSrc.indexOf('function normalizeDoctorNameKey');
    var end = appSrc.indexOf('/** Active doctors for one clinic');
    if (start < 0 || end < 0) throw new Error('bill doctor helpers not found in app.js');
    var slice = appSrc.slice(start, end);
    // Pull dependency helpers used by exclusion checks.
    var depStart = appSrc.indexOf('function isLoginPlaceholderDoctorCode');
    var depEnd = appSrc.indexOf('function normalizeDoctorNameKey');
    var deps = appSrc.slice(depStart, depEnd);
    var ctx = {
        APP_CLINICS: [],
        currentClinicId: '',
        doctorDisplayName: function (d) {
            if (!d) return '';
            return d.english_name || d.chinese_name || d.display_name || d.doctor_code || '';
        },
        clinicRecordFromId: function (id) {
            return (ctx.APP_CLINICS || []).find(function (c) {
                return String(c.id) === String(id);
            }) || null;
        },
        billClinicFieldsForSave: null,
        console: console
    };
    vm.createContext(ctx);
    vm.runInContext(deps + '\n' + slice, ctx);
    return ctx;
}

(async function main() {
    var appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    var idxSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    var apptSrc = fs.readFileSync(path.join(root, 'app-appt.js'), 'utf8');

    console.log('=== smoke: source ===');
    pass('strongBillDoctorNameKey present',
        appSrc.indexOf('function strongBillDoctorNameKey') >= 0);
    pass('label has no clinic suffix append',
        !/billDoctorDropdownLabel[\s\S]{0,400}return String\(base\) \+ ' \(' \+ clinic/.test(appSrc));
    pass('dedupe is global name key',
        /function billDoctorDropdownDedupeKey[\s\S]{0,260}return 'name:' \+ labelKey/.test(appSrc));
    pass('pickBest accepts preferredClinicId',
        /function billDoctorDropdownPickBest\(candidates, preferredClinicId\)/.test(appSrc));
    pass('resolveBillDoctorDropdownId present',
        appSrc.indexOf('function resolveBillDoctorDropdownId') >= 0);
    pass('renderBillDoctorOptions remaps sibling ids',
        apptSrc.indexOf('resolveBillDoctorDropdownId') >= 0);
    pass('billDoctorFieldsForSave remaps sibling ids',
        /function billDoctorFieldsForSave[\s\S]{0,350}resolveBillDoctorDropdownId/.test(apptSrc));
    pass('index BUILD bumped',
        /BUILD = '20260915billdr1'/.test(idxSrc));
    pass('index ships cache-busted app.js',
        /app\.js\?v=20260915billdr1/.test(idxSrc));

    console.log('\n=== unit: strong name key ===');
    var fns = loadBillDoctorFns(appSrc);
    pass('AU YEUNG == Au-Yeung,Irene',
        fns.strongBillDoctorNameKey('DR AU YEUNG YUEN KWAN IRENE') ===
        fns.strongBillDoctorNameKey('Dr Au-Yeung Yuen Kwan,Irene'));
    pass('Dr. NG == Dr Ng',
        fns.strongBillDoctorNameKey('DR. NG PUI CHING') ===
        fns.strongBillDoctorNameKey('Dr Ng Pui Ching'));
    pass('hyphen/comma stripped',
        fns.strongBillDoctorNameKey('A-B,C') === 'a b c');

    console.log('\n=== HTTP spot: live-server ===');
    var served = null;
    var ports = [5500, 8123];
    var i;
    for (i = 0; i < ports.length; i++) {
        try {
            var idx = await httpGet('127.0.0.1', ports[i], '/index.html');
            var js = await httpGet('127.0.0.1', ports[i], '/app.js?v=20260915billdr1');
            served = { port: ports[i], idx: idx, js: js };
            break;
        } catch (e) {
            served = { error: String(e.message || e), port: ports[i] };
        }
    }
    if (!served || (served.error && !served.idx)) {
        pass('live-server reachable', false, served && served.error);
    } else {
        pass('index.html ' + served.port, served.idx.status === 200, 'status ' + served.idx.status);
        pass('served BUILD',
            /BUILD = '20260915billdr1'/.test(served.idx.body),
            (served.idx.body.match(/BUILD = '([^']+)'/) || [])[1]);
        pass('served app.js has strong key',
            served.js.status === 200 && served.js.body.indexOf('function strongBillDoctorNameKey') >= 0,
            'status ' + served.js.status);
        pass('served app.js no clinic-suffix label',
            !/billDoctorDropdownLabel[\s\S]{0,400}return String\(base\) \+ ' \(' \+ clinic/.test(served.js.body));
    }

    console.log('\n=== API: doctors collapse ===');
    var sb = readSbConfig(appSrc);
    var docsRes = await restGet(sb.url, sb.key, 'doctors',
        'select=id,doctor_code,english_name,chinese_name,display_name,is_active,clinic_id&order=doctor_code.asc');
    var clinRes = await restGet(sb.url, sb.key, 'clinics',
        'select=id,clinic_code&order=clinic_code.asc');
    pass('doctors REST ok',
        docsRes.status === 200 && Array.isArray(docsRes.json),
        'HTTP ' + docsRes.status);
    pass('clinics REST ok',
        clinRes.status === 200 && Array.isArray(clinRes.json),
        'HTTP ' + clinRes.status);

    var doctors = Array.isArray(docsRes.json) ? docsRes.json : [];
    var clinics = Array.isArray(clinRes.json) ? clinRes.json : [];
    fns.APP_CLINICS = clinics;

    var clinical = doctors.filter(function (d) {
        return d && d.is_active !== false && !fns.isBillDropdownExcludedDoctor(d);
    });
    pass('clinical doctors loaded', clinical.length >= 10, 'n=' + clinical.length);

    // Old behavior count approximation: per clinic + label with suffix
    var oldGroups = {};
    clinical.forEach(function (d) {
        var base = fns.billDoctorDropdownBaseLabel(d);
        var cl = fns.billDoctorClinicCode(d);
        var label = base && cl ? (base + ' (' + cl + ')') : base;
        var key = 'clinic:' + String(d.clinic_id || '') + '|name:' + fns.normalizeDoctorNameKey(label);
        oldGroups[key] = true;
    });
    var oldCount = Object.keys(oldGroups).length;

    var collapsed = fns.doctorsForBillDoctorDropdown(clinical);
    var labels = collapsed.map(function (d) { return fns.billDoctorDropdownLabel(d); });
    pass('collapsed count < branch-split count',
        collapsed.length < oldCount,
        collapsed.length + ' < ' + oldCount);
    pass('collapsed count is 19',
        collapsed.length === 19,
        'n=' + collapsed.length);
    pass('no clinic suffixes in labels',
        labels.every(function (l) { return !/\([A-Z]{2,4}\)\s*$/.test(l); }),
        labels.filter(function (l) { return /\([A-Z]{2,4}\)\s*$/.test(l); }).join(' | ') || 'none');

    var au = labels.filter(function (l) { return /au\s*-?\s*yeung/i.test(l); });
    var ng = labels.filter(function (l) { return /ng\s+pui\s+ching/i.test(l); });
    var lam = labels.filter(function (l) { return /lam\s+chun\s+mo/i.test(l); });
    pass('Au Yeung appears once', au.length === 1, au.join(' | '));
    pass('Ng Pui Ching appears once', ng.length === 1, ng.join(' | '));
    pass('Lam Chun Mo appears once', lam.length === 1, lam.join(' | '));

    var pl = clinics.find(function (c) { return String(c.clinic_code || '').toUpperCase() === 'PL'; });
    var kt = clinics.find(function (c) { return String(c.clinic_code || '').toUpperCase() === 'KT'; });
    var pickPL = fns.doctorsForBillDoctorDropdown(clinical, { preferredClinicId: pl && pl.id })
        .find(function (d) { return /au\s*-?\s*yeung/i.test(fns.billDoctorDropdownLabel(d)); });
    var pickKT = fns.doctorsForBillDoctorDropdown(clinical, { preferredClinicId: kt && kt.id })
        .find(function (d) { return /au\s*-?\s*yeung/i.test(fns.billDoctorDropdownLabel(d)); });
    pass('Au Yeung wires PL row',
        !!(pickPL && fns.billDoctorClinicCode(pickPL) === 'PL'),
        pickPL ? fns.billDoctorClinicCode(pickPL) : 'missing');
    pass('Au Yeung wires KT row',
        !!(pickKT && fns.billDoctorClinicCode(pickKT) === 'KT'),
        pickKT ? fns.billDoctorClinicCode(pickKT) : 'missing');
    pass('PL/KT Au Yeung keep distinct existing ids',
        !!(pickPL && pickKT && String(pickPL.id) !== String(pickKT.id)));

    if (pickKT) {
        var mapped = fns.resolveBillDoctorDropdownId(pickKT.id, clinical, {
            preferredClinicId: pl && pl.id
        });
        pass('resolve maps KT Au Yeung -> PL preferred',
            !!(mapped && pickPL && String(mapped) === String(pickPL.id)),
            mapped || 'none');
    }

    console.log('\n=== collapsed list ===');
    labels.forEach(function (l, idx) {
        console.log(String(idx + 1).padStart(2, ' ') + '. ' + l);
    });

    console.log('\n=== result ===');
    if (fails.length) {
        console.log('FAILED ' + fails.length + '  ' + fails.join(' | '));
        process.exit(1);
    }
    console.log('SMOKE + HTTP + API ALL PASS');
    process.exit(0);
})().catch(function (err) {
    console.error('ERROR', err && err.stack ? err.stack : err);
    process.exit(1);
});
