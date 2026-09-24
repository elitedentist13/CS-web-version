/**
 * Dr Crystal Zhang August 2026 income alignment.
 * Clinic monthly counts payments by paid_date. Doctor monthly detail and
 * treatment statistics must include installments received in August on bills
 * opened earlier.
 * Run: node scripts/zhang-aug-income-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-report.js'))) root = process.cwd();

var BUILD = '20260925notes5';
var ZHANG_ID = 'd19183c0-183a-414e-b0e1-ab760f376a93';
var FROM = '2026-08-01';
var TO = '2026-08-31';
var fails = [];

var EXPECTED = [
    { chart: 'TKO004253', paid_date: '2026-08-02', amount: 17000, method: 'CASH', bill_date: '2026-05-17', doctor_name: '張樂怡牙科醫生', doctor_tag: 'Dr CRYSTAL ZHANG_TKO' },
    { chart: 'TKO004542', paid_date: '2026-08-02', amount: 500, method: 'CASH', bill_date: '2026-05-17', doctor_name: '張樂怡牙科醫生', doctor_tag: 'Dr CRYSTAL ZHANG_TKO' },
    { chart: 'TKO004543', paid_date: '2026-08-02', amount: 500, method: 'CASH', bill_date: '2026-05-17', doctor_name: '張樂怡牙科醫生', doctor_tag: 'Dr CRYSTAL ZHANG_TKO' },
    { chart: 'TKO003622', paid_date: '2026-08-16', amount: 4000, method: 'ALIPAY HK', bill_date: '2025-03-30', doctor_name: 'DR.CRYSTAL ZHANG', doctor_tag: 'DR.CRYSTAL ZHANG' },
    { chart: 'TKO001115', paid_date: '2026-08-30', amount: 15000, method: 'MASTERCARD', bill_date: '2026-06-21', doctor_name: '張樂怡牙科醫生', doctor_tag: '張樂怡牙科醫生' },
    { chart: 'TKO002300', paid_date: '2026-08-30', amount: 3000, method: 'MASTERCARD', bill_date: '2024-12-01', doctor_name: 'DR.CRYSTAL ZHANG', doctor_tag: 'DR.CRYSTAL ZHANG' },
    { chart: 'TKO004542', paid_date: '2026-08-30', amount: 1000, method: 'VISA', bill_date: '2026-05-17', doctor_name: '張樂怡牙科醫生', doctor_tag: 'Dr CRYSTAL ZHANG_TKO' },
    { chart: 'TKO004543', paid_date: '2026-08-30', amount: 1000, method: 'VISA', bill_date: '2026-05-17', doctor_name: '張樂怡牙科醫生', doctor_tag: 'Dr CRYSTAL ZHANG_TKO' }
];

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
        var req = http.get({ host: host, port: port, path: reqPath, timeout: 8000 }, function (r) {
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
            return { status: r.status, json: json, raw: t.slice(0, 400) };
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

function loadReportDoctorFns(reportSrc) {
    var names = [
        'normName',
        'drDisplayName',
        'doctorPersonFromRecord',
        'doctorTagOf',
        'doctorTextVariants',
        'billMatchesDoctor',
        'resolveBillDoctorFields',
        'groupDrMonthlySlicesByDoctor'
    ];
    var src = names.map(function (n) { return extractFn(reportSrc, n); }).join('\n');
    var ctx = {
        console: console,
        window: {},
        _drDailyDoctors: [],
        tr: function (k) { return k; }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'app-doctor-aliases.js'), 'utf8'), ctx);
    vm.runInContext(src, ctx);
    return ctx;
}

function fnBody(src, name) {
    return extractFn(src, name);
}

function inAugust(iso) {
    return iso >= FROM && iso <= TO;
}

function methodKey(raw) {
    return String(raw || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

(async function main() {
    var reportSrc = fs.readFileSync(path.join(root, 'app-report.js'), 'utf8');
    var appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    var idxSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    var detailFn = fnBody(reportSrc, 'buildDoctorPaymentTxRows');
    var monthlyFn = fnBody(reportSrc, 'buildDrMonthly');
    var dailyFn = fnBody(reportSrc, 'buildDrDaily');

    console.log('=== smoke: source ===');
    pass('build stamp is the Zhang payment fix',
        idxSrc.indexOf("BUILD = '" + BUILD + "'") >= 0);
    pass('doctor income loads payments by paid date',
        /async function loadDoctorIncomeSlices\(from, to, dr, allDoctors\)/.test(reportSrc) &&
        reportSrc.indexOf('loadReportPaymentSlices(from, to)') >= 0 &&
        reportSrc.indexOf('loadBillPaymentsByPaidDate(from, to)') >= 0);
    pass('monthly detail rows come from those payment slices',
        /var incomeSlices = await loadDoctorIncomeSlices\(from, to, dr, allDoctors\)/.test(monthlyFn) &&
        /buildDoctorPaymentTxRows\(incomeSlices, from, to, _drDailyDoctors\)/.test(monthlyFn));
    pass('monthly treatment stats prices items from the month\'s payments',
        /collectTreatmentItemStatGroupsFromPayments\(incomeSlices/.test(monthlyFn) &&
        /function collectTreatmentItemStatGroupsFromPayments\(slices, pmap, apptIndex\)/.test(reportSrc));
    pass('detail amount is the in-month payment, not the lifetime bill paid',
        /var paidAmount = payRows\.reduce\(function \(sum, x\) \{ return sum \+ Number\(x\.amount \|\| 0\); \}, 0\)/.test(detailFn) &&
        /buildDailySummaryTxRowFromPaymentSlice\(b, p, paidAmount/.test(detailFn) &&
        detailFn.indexOf('buildDailySummaryTxRow(') < 0);
    pass('daily doctor detail uses the same payment-date rows',
        /var daySlices = await loadDoctorIncomeSlices\(day, day, dr, allDoctors\)/.test(dailyFn) &&
        /buildDoctorPaymentTxRows\(daySlices, day, day, _drDailyDoctors\)/.test(dailyFn));

    console.log('\n=== spot: client simulation ===');
    var ctx = loadReportDoctorFns(reportSrc);
    var zhang = {
        id: ZHANG_ID,
        doctor_code: 'Dr CRYSTAL ZHANG_TKO',
        english_name: 'DR ZHANG LEYI',
        chinese_name: '張樂怡牙科醫生'
    };
    var ng = {
        id: '1533a0e9-9279-4dfd-9f31-17c989e89a8e',
        doctor_code: 'DR. NG PUI CHING',
        english_name: 'DR. NG PUI CHING',
        chinese_name: '吳培精牙科醫生'
    };
    ctx._drDailyDoctors = [zhang, ng];

    var fixtures = EXPECTED.map(function (row, i) {
        return {
            chart: row.chart,
            paid_date: row.paid_date,
            amount: row.amount,
            method: row.method,
            bill: {
                id: 'bill-' + row.chart + '-' + i,
                patient_no: row.chart,
                bill_date: row.bill_date,
                doctor_id: null,
                doctor_name: row.doctor_name,
                doctor_tag: row.doctor_tag,
                dentist_name: row.doctor_name
            }
        };
    });
    var matched = fixtures.filter(function (row) {
        return inAugust(row.paid_date) && ctx.billMatchesDoctor(row.bill, zhang);
    });
    var billDateOnly = fixtures.filter(function (row) {
        return inAugust(row.bill.bill_date) && ctx.billMatchesDoctor(row.bill, zhang);
    });
    var matchedSum = matched.reduce(function (s, row) { return s + row.amount; }, 0);
    pass('all eight August installments match Dr Crystal Zhang',
        matched.length === 8 && matchedSum === 42000,
        'rows=' + matched.length + ' sum=' + matchedSum);
    pass('a bill-date filter drops every one of them',
        billDateOnly.length === 0,
        'kept=' + billDateOnly.length);
    pass('none of the eight match Dr Ng',
        fixtures.every(function (row) { return !ctx.billMatchesDoctor(row.bill, ng); }));

    var groups = {};
    matched.forEach(function (row) {
        var gk = row.paid_date + '|' + row.bill.id + '|TKO';
        if (!groups[gk]) groups[gk] = { chart: row.chart, paid_date: row.paid_date, amount: 0, method: row.method };
        groups[gk].amount += row.amount;
    });
    var groupList = Object.keys(groups).map(function (k) { return groups[k]; });
    var liangDays = groupList.filter(function (g) { return g.chart === 'TKO004542'; }).map(function (g) { return g.paid_date + ':' + g.amount; }).sort();
    pass('same chart on two pay days stays two rows',
        groupList.length === 8 && liangDays.join(',') === '2026-08-02:500,2026-08-30:1000',
        liangDays.join(','));
    var allen = groupList.filter(function (g) { return g.chart === 'TKO004253'; })[0];
    pass('TKO004253 detail amount is the $17000 cash installment',
        !!allen && allen.amount === 17000 && allen.method === 'CASH' && allen.paid_date === '2026-08-02',
        allen ? (allen.paid_date + ' ' + allen.amount) : 'missing');

    var slices = matched.map(function (row) {
        return { bill: row.bill, paid_date: row.paid_date, amount: row.amount, method: row.method };
    });
    var grouped = ctx.groupDrMonthlySlicesByDoctor(slices, ctx._drDailyDoctors);
    var zhangGroup = grouped.filter(function (g) { return g.doctorLabel === 'Dr Crystal Zhang'; })[0];
    var zhangAmt = zhangGroup ? zhangGroup.slices.reduce(function (s, x) { return s + x.amount; }, 0) : 0;
    pass('simple monthly group holds HK$42000 under Dr Crystal Zhang',
        !!zhangGroup && zhangGroup.slices.length === 8 && zhangAmt === 42000,
        zhangGroup ? ('slices=' + zhangGroup.slices.length + ' amt=' + zhangAmt) : 'missing');

    var txNames = [
        'billItemLineAmount',
        'reportBillItemDiscPct',
        'reportBillItemNet',
        'parseBillItems',
        'txStatsDateArranged',
        'allocateTreatmentPaymentCents',
        'treatmentStatsReceivedFee',
        'collectTreatmentItemStatGroupsFromPayments'
    ];
    var txCtx = {
        console: console,
        tr: function (k) { return k === 'report.treat.defaultName' ? 'Treatment' : k; }
    };
    vm.createContext(txCtx);
    vm.runInContext(txNames.map(function (n) { return extractFn(reportSrc, n); }).join('\n'), txCtx);
    var scaled = txCtx.collectTreatmentItemStatGroupsFromPayments([
        {
            amount: 3000,
            paid_date: '2026-08-30',
            bill: {
                id: 'old-sin',
                patient_no: 'TKO002300',
                patient_name: 'SIN KA WING',
                bill_date: '2024-12-01',
                items: JSON.stringify([{ desc: 'Implant', qty: 1, price: 35000, disc: 0 }])
            }
        },
        {
            amount: 17000,
            paid_date: '2026-08-02',
            bill: {
                id: 'allen',
                patient_no: 'TKO004253',
                patient_name: 'TONG NGA LUN ALLEN',
                bill_date: '2026-05-17',
                items: JSON.stringify([
                    { desc: 'Crown', qty: 1, price: 20000, disc: 0 },
                    { desc: 'Xray', qty: 1, price: 2000, disc: 0 }
                ])
            }
        }
    ], {}, null);
    var scaledNet = 0;
    var byPatient = {};
    scaled.forEach(function (g) {
        scaledNet += g.net;
        g.details.forEach(function (d) {
            byPatient[d.patient_no] = (byPatient[d.patient_no] || 0) + d.net;
        });
    });
    pass('treatment statistics net equals the payments, not the full fees',
        Math.round(scaledNet * 100) === 2000000 &&
        byPatient.TKO002300 === 3000 &&
        byPatient.TKO004253 === 17000,
        'net=' + scaledNet + ' sin=' + byPatient.TKO002300 + ' allen=' + byPatient.TKO004253);
    var crown = null;
    var xray = null;
    scaled.forEach(function (g) {
        g.details.forEach(function (d) {
            if (d.patient_no !== 'TKO004253') return;
            if (g.item === 'Crown') crown = d.net;
            if (g.item === 'Xray') xray = d.net;
        });
    });
    pass('a partial payment keeps each item\'s share',
        crown === 15454.54 && xray === 1545.46,
        'crown=' + crown + ' xray=' + xray);

    console.log('\n=== live server ===');
    var live = null;
    var livePort = 0;
    var ports = [5500, 8123, 8124];
    // Prefer the port serving this checkout's BUILD; other checkouts may share the machine.
    for (var pi = 0; pi < ports.length; pi++) {
        try {
            var probe = await httpGet('127.0.0.1', ports[pi], '/app-report.js?b=' + BUILD);
            if (!probe || probe.status !== 200) continue;
            var idxProbe = await httpGet('127.0.0.1', ports[pi], '/index.html?_lr=' + BUILD);
            var isOurs = idxProbe.status === 200 && idxProbe.body.indexOf("BUILD = '" + BUILD + "'") >= 0;
            if (!livePort || isOurs) { live = probe; livePort = ports[pi]; }
            if (isOurs) break;
        } catch (e) {}
    }
    pass('clinic UI reachable', !!live && live.status === 200, livePort ? (':' + livePort) : 'no listener');
    if (live && live.status === 200) {
        var index = await httpGet('127.0.0.1', livePort, '/index.html?_lr=' + BUILD);
        pass('served page build is ' + BUILD,
            index.status === 200 && index.body.indexOf("BUILD = '" + BUILD + "'") >= 0);
        pass('served report builds doctor detail from payment-date slices',
            live.body.indexOf('async function loadDoctorIncomeSlices(from, to, dr, allDoctors)') >= 0 &&
            live.body.indexOf('buildDoctorPaymentTxRows(incomeSlices, from, to, _drDailyDoctors)') >= 0 &&
            live.body.indexOf('collectTreatmentItemStatGroupsFromPayments(incomeSlices') >= 0);
        var served = loadReportDoctorFns(live.body);
        served._drDailyDoctors = [zhang, ng];
        pass('served code attributes the $17000 bill to Dr Crystal Zhang',
            served.billMatchesDoctor(fixtures[0].bill, zhang) &&
            !served.billMatchesDoctor(fixtures[0].bill, ng));
    }

    console.log('\n=== API ===');
    var sb = readSbConfig(appSrc);
    var charts = [];
    EXPECTED.forEach(function (row) {
        if (charts.indexOf(row.chart) < 0) charts.push(row.chart);
    });
    var docRes = await restGet(sb.url, sb.key, 'doctors',
        'select=id,doctor_code,english_name,chinese_name&id=eq.' + ZHANG_ID);
    pass('Dr Crystal Zhang doctor row readable',
        docRes.status === 200 && docRes.json && docRes.json[0] && docRes.json[0].id === ZHANG_ID,
        'HTTP ' + docRes.status);
    var billRes = await restGet(sb.url, sb.key, 'bills',
        'select=id,patient_no,patient_name,bill_date,doctor_id,doctor_name,doctor_tag,dentist_name,voided_at,items' +
        '&voided_at=is.null&patient_no=in.(' + charts.join(',') + ')');
    pass('the six charts are readable',
        billRes.status === 200 && Array.isArray(billRes.json) && billRes.json.length > 0,
        'HTTP ' + billRes.status + ' bills=' + ((billRes.json && billRes.json.length) || 0));
    var bills = billRes.json || [];
    var billIds = bills.map(function (b) { return b.id; }).filter(Boolean);
    var payRes = billIds.length
        ? await restGet(sb.url, sb.key, 'bill_payments',
            'select=id,bill_id,paid_date,amount,method,voided_at&voided_at=is.null' +
            '&paid_date=gte.' + FROM + '&paid_date=lte.' + TO +
            '&bill_id=in.(' + billIds.join(',') + ')')
        : { status: 0, json: [] };
    pass('August payments for those charts are readable',
        payRes.status === 200 && Array.isArray(payRes.json),
        'HTTP ' + payRes.status);
    var byId = {};
    bills.forEach(function (b) { byId[b.id] = b; });
    var apiRows = (payRes.json || []).map(function (p) {
        var b = byId[p.bill_id] || {};
        return {
            chart: b.patient_no,
            paid_date: String(p.paid_date || '').slice(0, 10),
            amount: Number(p.amount || 0),
            method: methodKey(p.method),
            bill_date: String(b.bill_date || '').slice(0, 10),
            bill: b
        };
    });
    var missing = [];
    EXPECTED.forEach(function (want) {
        var hit = apiRows.filter(function (row) {
            return row.chart === want.chart &&
                row.paid_date === want.paid_date &&
                row.amount === want.amount &&
                row.method === want.method &&
                row.bill_date === want.bill_date;
        })[0];
        if (!hit) missing.push(want.chart + ' ' + want.paid_date + ' ' + want.amount);
        else if (!ctx.billMatchesDoctor(hit.bill, zhang)) missing.push(want.chart + ' not Zhang');
        else if (inAugust(hit.bill_date)) missing.push(want.chart + ' bill date is inside August');
    });
    var apiSum = EXPECTED.reduce(function (s, row) { return s + row.amount; }, 0);
    pass('API has the eight outside-August installments under Dr Zhang',
        missing.length === 0 && apiSum === 42000,
        missing.length ? missing.join('; ') : ('sum=' + apiSum));
    var withItems = {};
    EXPECTED.forEach(function (want) {
        apiRows.forEach(function (row) {
            if (row.chart !== want.chart || row.paid_date !== want.paid_date || row.amount !== want.amount) return;
            var items = row.bill && row.bill.items;
            var n = 0;
            if (Array.isArray(items)) n = items.length;
            else if (typeof items === 'string' && items.trim()) {
                try { n = JSON.parse(items).length; } catch (e) { n = 0; }
            }
            if (n > 0) withItems[want.chart] = true;
        });
    });
    pass('each of the six charts has treatment lines for the statistics view',
        charts.every(function (c) { return withItems[c]; }),
        charts.filter(function (c) { return !withItems[c]; }).join(',') || 'all six');

    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + LIVE + API ALL PASS'));
    if (fails.length) {
        fails.forEach(function (f) { console.log(' - ' + f); });
        process.exit(1);
    }
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
