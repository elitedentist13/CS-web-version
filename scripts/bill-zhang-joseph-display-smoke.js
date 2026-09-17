/**
 * Bill payment-panel doctor label — 張樂怡 must not display as Joseph Lam.
 * Run: node scripts/bill-zhang-joseph-display-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-appt.js'))) root = process.cwd();

var BUILD = '20260917zhang1';
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

function sliceFn(src, name, untilName) {
    var start = src.indexOf('function ' + name);
    if (start < 0) throw new Error(name + ' not found');
    var end = untilName ? src.indexOf('function ' + untilName, start + 1) : src.length;
    if (end < 0) end = src.length;
    return src.slice(start, end);
}

function loadFns() {
    var aliasSrc = fs.readFileSync(path.join(root, 'app-doctor-aliases.js'), 'utf8');
    var apptSrc = fs.readFileSync(path.join(root, 'app-appt.js'), 'utf8');
    var ctx = {
        window: {},
        module: { exports: {} },
        billDoctorList: [
            {
                id: '5c971459-6d0a-4996-89c7-813ee2cd099e',
                english_name: 'DR. JOSEPH LAM',
                chinese_name: '林錦銳牙科醫生',
                doctor_code: 'DR. JOSEPH LAM'
            },
            {
                id: 'd19183c0-183a-414e-b0e1-ab760f376a93',
                english_name: 'DR ZHANG LEYI',
                chinese_name: '張樂怡牙科醫生',
                doctor_code: 'Dr CRYSTAL ZHANG_TKO'
            }
        ]
    };
    vm.createContext(ctx);
    vm.runInContext(aliasSrc + '\n' + sliceFn(apptSrc, 'billDisplayDoctorLabel', 'renderBillDoctorOptions'), ctx);
    return ctx;
}

(async function main() {
    var appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    var idxSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    var apptSrc = fs.readFileSync(path.join(root, 'app-appt.js'), 'utf8');
    var aliasSrc = fs.readFileSync(path.join(root, 'app-doctor-aliases.js'), 'utf8');

    console.log('=== smoke: source ===');
    pass('display helper', apptSrc.indexOf('function billDisplayDoctorLabel') >= 0);
    pass('history rows use helper',
        /function renderBillHistoryRows[\s\S]{0,400}billDisplayDoctorLabel/.test(apptSrc));
    pass('history rows do not prefer tag',
        !/function renderBillHistoryRows[\s\S]{0,500}var drTag\s*=\s*b\.doctor_tag\s*\|\|/.test(apptSrc));
    pass('detail panel uses helper',
        /bdSet\('bdDoctor'[\s\S]{0,180}billDisplayDoctorLabel/.test(apptSrc));
    pass('print uses helper',
        /function billHistoryPrintRowLabel[\s\S]{0,400}billDisplayDoctorLabel/.test(apptSrc));
    pass('張樂怡 aliased to Crystal Zhang',
        /key: 'crystal-zhang'[\s\S]{0,500}張樂怡/.test(aliasSrc));
    pass('Joseph group has no 張樂怡',
        !/key: 'joseph-lam'[\s\S]{0,400}張樂怡/.test(aliasSrc));
    pass('index BUILD bumped',
        idxSrc.indexOf("BUILD = '" + BUILD + "'") >= 0,
        (idxSrc.match(/BUILD = '([^']+)'/) || [])[1]);

    console.log('\n=== unit: display label ===');
    var fns = loadFns();
    var zhangMisTag = {
        doctor_id: '5c971459-6d0a-4996-89c7-813ee2cd099e',
        doctor_name: '張樂怡牙科醫生',
        doctor_tag: 'DR. JOSEPH LAM'
    };
    var zhangOk = {
        doctor_id: 'd19183c0-183a-414e-b0e1-ab760f376a93',
        doctor_name: 'DR ZHANG LEYI',
        doctor_tag: 'Dr CRYSTAL ZHANG_TKO'
    };
    var josephReal = {
        doctor_id: '86f1a4c6-a19f-4541-add1-438000a2ee02',
        doctor_name: '林錦銳牙科醫生',
        doctor_tag: 'DR. LAM KAM YUI JOSEPH'
    };
    var zhangLbl = fns.billDisplayDoctorLabel(zhangMisTag);
    var zhangOkLbl = fns.billDisplayDoctorLabel(zhangOk);
    var josephLbl = fns.billDisplayDoctorLabel(josephReal);
    pass('mistagged 張樂怡 is Crystal Zhang',
        /crystal|zhang/i.test(zhangLbl) && !/joseph|lam kam/i.test(zhangLbl),
        zhangLbl);
    pass('correct TKO Crystal row stays Zhang',
        /crystal|zhang/i.test(zhangOkLbl) && !/joseph/i.test(zhangOkLbl),
        zhangOkLbl);
    pass('real Joseph row stays Joseph',
        /joseph|lam/i.test(josephLbl) && !/zhang|crystal|張樂怡/i.test(josephLbl),
        josephLbl);
    pass('name-only 張樂怡 is not Joseph',
        !/joseph/i.test(fns.billDisplayDoctorLabel({ doctor_name: '張樂怡' })),
        fns.billDisplayDoctorLabel({ doctor_name: '張樂怡' }));

    console.log('\n=== HTTP spot: live-server ===');
    var served = null;
    var ports = [8123, 5500];
    var i;
    for (i = 0; i < ports.length; i++) {
        try {
            var idx = await httpGet('127.0.0.1', ports[i], '/index.html?b=' + BUILD);
            var js = await httpGet('127.0.0.1', ports[i], '/app-appt.js?b=' + BUILD);
            var hit = { port: ports[i], idx: idx, js: js };
            if (idx.body.indexOf("BUILD = '" + BUILD + "'") >= 0) {
                served = hit;
                break;
            }
            if (!served) served = hit;
        } catch (e) {
            if (!served) served = { error: String(e.message || e), port: ports[i] };
        }
    }
    if (!served || !served.idx) {
        pass('live-server reachable', false, served && served.error);
    } else {
        pass('index.html :' + served.port, served.idx.status === 200, 'status ' + served.idx.status);
        pass('served BUILD',
            served.idx.body.indexOf("BUILD = '" + BUILD + "'") >= 0,
            (served.idx.body.match(/BUILD = '([^']+)'/) || [])[1]);
        pass('served display helper',
            served.js.status === 200 && served.js.body.indexOf('function billDisplayDoctorLabel') >= 0,
            'status ' + served.js.status);
        pass('served history uses helper',
            /function renderBillHistoryRows[\s\S]{0,400}billDisplayDoctorLabel/.test(served.js.body));
    }

    console.log('\n=== API: Aug 2 / 16 / 30 / Sep 13 mistags ===');
    var sb = readSbConfig(appSrc);
    var dates = ['2026-08-02', '2026-08-16', '2026-08-30', '2026-09-13'];
    var josephId = '5c971459-6d0a-4996-89c7-813ee2cd099e';
    var totalMis = 0;
    var resolvedZhang = 0;
    for (i = 0; i < dates.length; i++) {
        var d = dates[i];
        var res = await restGet(sb.url, sb.key, 'bills',
            'select=id,bill_date,patient_no,doctor_id,doctor_name,doctor_tag&bill_date=eq.' + d +
            '&doctor_name=like.*張樂怡*&limit=80');
        var rows = Array.isArray(res.json) ? res.json : [];
        var mis = rows.filter(function (b) {
            return String(b.doctor_tag || '').toUpperCase().indexOf('JOSEPH') >= 0 ||
                String(b.doctor_id || '') === josephId;
        });
        totalMis += mis.length;
        mis.forEach(function (b) {
            var lbl = fns.billDisplayDoctorLabel(b);
            if (/crystal|zhang/i.test(lbl) && !/joseph/i.test(lbl)) resolvedZhang++;
        });
        pass(d + ' REST 張樂怡 rows',
            res.status === 200 && rows.length > 0,
            'HTTP ' + res.status + ' n=' + rows.length + ' mistag=' + mis.length);
    }
    pass('mistagged rows resolve to Zhang not Joseph',
        totalMis > 0 && resolvedZhang === totalMis,
        'mis=' + totalMis + ' zhang=' + resolvedZhang);

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
