/**
 * Dr Ng installment alignment: smoke, client simulation, live server, API.
 * Today's $1000 on bill c861f318 must group under Dr Ng Pui Ching.
 * Run: node scripts/ng-installment-doctor-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-report.js'))) root = process.cwd();

var BILL_ID = 'c861f318-b930-4096-9196-9b82f80de429';
var NG_ID = '1533a0e9-9279-4dfd-9f31-17c989e89a8e';
var PAY_DAY = '2026-09-22';
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

function restGet(base, key, table, qs, extraHeaders) {
    var url = base.replace(/\/$/, '') + '/rest/v1/' + table + '?' + qs;
    var headers = {
        apikey: key,
        Authorization: 'Bearer ' + key,
        Accept: 'application/json'
    };
    if (extraHeaders) Object.keys(extraHeaders).forEach(function (k) { headers[k] = extraHeaders[k]; });
    return fetch(url, { headers: headers }).then(function (r) {
        return r.text().then(function (t) {
            var json = null;
            try { json = JSON.parse(t); } catch (e) {}
            return { status: r.status, json: json, raw: t.slice(0, 300), range: r.headers.get('content-range') };
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
        tr: function (k) { return k; },
        doctorDisplayName: undefined
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(root, 'app-doctor-aliases.js'), 'utf8'), ctx);
    vm.runInContext(src, ctx);
    return ctx;
}

function sliceFor(bill, amount) {
    return {
        bill: bill,
        payment: { paid_date: PAY_DAY, amount: amount, method: 'Mastercard', voided_at: null, clinic_tag: 'PY' },
        paid_date: PAY_DAY,
        amount: amount,
        method: 'Mastercard'
    };
}

(async function main() {
    var reportSrc = fs.readFileSync(path.join(root, 'app-report.js'), 'utf8');
    var appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    var aliasSrc = fs.readFileSync(path.join(root, 'app-doctor-aliases.js'), 'utf8');

    console.log('=== smoke: source ===');
    pass('income slices use payment date',
        /async function loadReportPaymentSlices\(from, to\)/.test(reportSrc) &&
        reportSrc.indexOf('loadBillPaymentsByPaidDate(from, to)') >= 0);
    pass('doctor daily income filters slices by bill doctor',
        /filtered = filtered\.filter\(function \(s\) \{\s*return billMatchesDoctor\(s\.bill, dr\);/.test(reportSrc));
    pass('daily summary stamps doctor from the bill',
        /resolveBillDoctorFields\(b, doctors\)/.test(reportSrc));
    pass('bill match uses DoctorAliases.resolveFromBill',
        /function billMatchesDoctor\(b, d\)[\s\S]{0,280}DoctorAliases\.resolveFromBill\(b/.test(reportSrc));
    pass('Ng short name is grouped, not a loose surname',
        /key: 'ng-pui-ching'[\s\S]{0,500}'DR NG'/.test(aliasSrc));
    pass('doctor monthly detail uses payment-date slices',
        /async function loadDoctorIncomeSlices\(from, to, dr, allDoctors\)/.test(reportSrc) &&
        /var incomeSlices = await loadDoctorIncomeSlices\(from, to, dr, allDoctors\)/.test(reportSrc) &&
        /buildDoctorPaymentTxRows\(incomeSlices, from, to, _drDailyDoctors\)/.test(reportSrc));
    pass('add-payment save does not clear doctor columns',
        (function () {
            var appt = fs.readFileSync(path.join(root, 'app-appt.js'), 'utf8');
            var start = appt.indexOf('function executeAddPaymentSave');
            var end = appt.indexOf('\nfunction ', start + 10);
            var body = appt.slice(start, end > start ? end : start + 4000);
            return body.indexOf('doctor_name') < 0 && body.indexOf('doctor_id') < 0;
        })());

    console.log('\n=== client simulation ===');
    var ctx = loadReportDoctorFns(reportSrc);
    var ngDoctor = {
        id: NG_ID,
        doctor_code: 'DR. NG PUI CHING',
        english_name: 'DR. NG PUI CHING',
        chinese_name: '吳培精牙科醫生'
    };
    var ngPy = {
        id: 'c4c54d8d-d7fb-4332-80ee-35fd34efa1ee',
        doctor_code: 'Dr NG PUI CHING_PY',
        english_name: 'DR NG PUI CHING',
        chinese_name: '吳培精牙科醫生'
    };
    var annette = {
        id: 'annette-id',
        doctor_code: 'DR. NG SI KI ANNETTE',
        english_name: 'DR. NG SI KI ANNETTE',
        chinese_name: ''
    };
    ctx._drDailyDoctors = [ngDoctor, ngPy, annette];

    var restored = {
        id: BILL_ID,
        patient_id: '32746650-2f34-41a7-a3dd-680ad0a9657d',
        patient_no: '021712',
        patient_name: '陳嘉卓 CHAN KA CHEUK',
        bill_date: '2026-08-11',
        doctor_id: NG_ID,
        doctor_name: '吳培精牙科醫生',
        doctor_tag: 'DR. NG PUI CHING',
        dentist_name: null,
        notes: 'INV case transfer 自 TKO 結轉',
        clinic_tag: 'PY'
    };
    var blank = {
        id: 'blank',
        patient_no: '021712',
        doctor_id: null,
        doctor_name: null,
        doctor_tag: null,
        dentist_name: null,
        notes: 'INV case transfer 自 TKO 結轉'
    };
    var fields = ctx.resolveBillDoctorFields(restored, ctx._drDailyDoctors);
    pass('restored bill resolves to Dr Ng Pui Ching',
        fields.doctor_key === 'ng-pui-ching' && fields.doctor_display === 'Dr Ng Pui Ching',
        fields.doctor_key + ' / ' + fields.doctor_display);
    pass('matches canonical Ng and the PY Ng row',
        ctx.billMatchesDoctor(restored, ngDoctor) && ctx.billMatchesDoctor(restored, ngPy));
    pass('does not match Dr Annette Ng',
        !ctx.billMatchesDoctor(restored, annette));
    var blankFields = ctx.resolveBillDoctorFields(blank, ctx._drDailyDoctors);
    pass('empty doctor stays out of the Ng group',
        blankFields.doctor_key !== 'ng-pui-ching' &&
        String(blankFields.doctor_display || '').indexOf('unknownDoctor') >= 0,
        blankFields.doctor_key + ' / ' + blankFields.doctor_display);

    var groups = ctx.groupDrMonthlySlicesByDoctor([sliceFor(restored, 1000), sliceFor(blank, 50)], ctx._drDailyDoctors);
    var ngGroup = groups.filter(function (g) { return g.doctorLabel === 'Dr Ng Pui Ching'; })[0];
    var ngAmt = ngGroup ? ngGroup.slices.reduce(function (s, x) { return s + x.amount; }, 0) : 0;
    pass('summary group holds the $1000 under Dr Ng Pui Ching',
        !!ngGroup && ngAmt === 1000 && ngGroup.slices.length === 1 &&
        ngGroup.slices[0].paid_date === PAY_DAY && ngGroup.slices[0].bill.patient_no === '021712',
        ngGroup ? ('slices=' + ngGroup.slices.length + ' amt=' + ngAmt) : 'missing group');
    pass('the blank bill is not inside the Ng group',
        !ngGroup || ngGroup.slices.every(function (s) { return s.bill.id !== 'blank'; }));

    console.log('\n=== live server ===');
    var live = null;
    var livePort = 0;
    var ports = [5500, 8123, 8124];
    for (var pi = 0; pi < ports.length; pi++) {
        try {
            live = await httpGet('127.0.0.1', ports[pi], '/app-report.js');
            if (live && live.status === 200) { livePort = ports[pi]; break; }
        } catch (e) {
            live = null;
        }
    }
    pass('clinic UI reachable', !!live && live.status === 200, livePort ? (':' + livePort) : 'no listener');
    if (live && live.status === 200) {
        pass('served report attributes income by payment date and bill doctor',
            live.body.indexOf('loadBillPaymentsByPaidDate(from, to)') >= 0 &&
            live.body.indexOf('return billMatchesDoctor(s.bill, dr);') >= 0 &&
            live.body.indexOf('resolveBillDoctorFields(b, doctors)') >= 0);
        var servedCtx = loadReportDoctorFns(live.body);
        servedCtx._drDailyDoctors = ctx._drDailyDoctors;
        var servedFields = servedCtx.resolveBillDoctorFields(restored, servedCtx._drDailyDoctors);
        pass('served report code resolves this bill to Dr Ng Pui Ching',
            servedFields.doctor_key === 'ng-pui-ching' && servedFields.doctor_display === 'Dr Ng Pui Ching',
            servedFields.doctor_display);
    }

    console.log('\n=== API ===');
    var sb = readSbConfig(appSrc);
    var billRes = await restGet(sb.url, sb.key, 'bills',
        'select=id,patient_no,patient_name,bill_date,doctor_id,doctor_name,doctor_tag,dentist_name,notes,amount_paid,balance,voided_at,clinic_tag&id=eq.' + BILL_ID);
    pass('bill readable', billRes.status === 200 && billRes.json && billRes.json[0], 'HTTP ' + billRes.status);
    var bill = billRes.json && billRes.json[0];
    if (bill) {
        pass('021712 bill stores Dr Ng',
            bill.doctor_id === NG_ID &&
            bill.doctor_name === '吳培精牙科醫生' &&
            bill.doctor_tag === 'DR. NG PUI CHING' &&
            !bill.voided_at,
            bill.patient_no + ' ' + bill.doctor_name);
        var apiFields = ctx.resolveBillDoctorFields(bill, ctx._drDailyDoctors);
        pass('API bill resolves to Dr Ng Pui Ching',
            apiFields.doctor_key === 'ng-pui-ching' && apiFields.doctor_display === 'Dr Ng Pui Ching',
            apiFields.doctor_display);
    }
    var payRes = await restGet(sb.url, sb.key, 'bill_payments',
        'select=id,bill_id,paid_date,amount,method,received_by,clinic_tag,voided_at&bill_id=eq.' + BILL_ID +
        '&paid_date=eq.' + PAY_DAY + '&voided_at=is.null');
    pass('today payment readable', payRes.status === 200 && Array.isArray(payRes.json), 'HTTP ' + payRes.status);
    var pay = (payRes.json || []).filter(function (p) { return Number(p.amount) === 1000; })[0];
    pass('today $1000 Mastercard is on this bill',
        !!pay && pay.method === 'Mastercard' && pay.clinic_tag === 'PY' && pay.bill_id === BILL_ID,
        pay ? (pay.paid_date + ' ' + pay.method + ' ' + pay.amount + ' ' + pay.clinic_tag) : 'missing');
    if (bill && pay) {
        var liveGroups = ctx.groupDrMonthlySlicesByDoctor([sliceFor(bill, Number(pay.amount))], ctx._drDailyDoctors);
        var hit = liveGroups.filter(function (g) { return g.doctorLabel === 'Dr Ng Pui Ching'; })[0];
        pass('API payment lands in the Dr Ng Pui Ching summary group',
            !!hit && hit.slices.length === 1 && hit.slices[0].amount === 1000 && hit.slices[0].paid_date === PAY_DAY,
            hit ? hit.doctorLabel : 'missing');
        pass('matches the doctor row used by the report picker',
            ctx.billMatchesDoctor(bill, ngDoctor) && ctx.billMatchesDoctor(bill, ngPy));
    }

    var left = await restGet(sb.url, sb.key, 'bills',
        'select=id&voided_at=is.null&doctor_name=is.null&or=(dentist_name.ilike.DR%20NG,dentist_name.ilike.DR.%20NG%20PUI%20CHING,notes.ilike.*Doctor:%20DR%20NG*)',
        { Prefer: 'count=exact', Range: '0-0' });
    var leftCount = left.range ? Number(String(left.range).split('/')[1]) : -1;
    pass('no Dr NG bill still has an empty doctor name',
        left.status === 200 && leftCount === 0,
        'remaining ' + leftCount + ' HTTP ' + left.status);

    var annetteRes = await restGet(sb.url, sb.key, 'bills',
        'select=id,doctor_name,dentist_name,notes&voided_at=is.null&notes=ilike.*Doctor:%20DR.%20NG%20SI%20KI%20ANNETTE*&doctor_name=eq.' +
        encodeURIComponent('吳培精牙科醫生') + '&limit=1');
    pass('Annette Ng bills were not rewritten as Dr Ng Pui Ching',
        annetteRes.status === 200 && Array.isArray(annetteRes.json) && annetteRes.json.length === 0,
        'HTTP ' + annetteRes.status + ' rows ' + ((annetteRes.json && annetteRes.json.length) || 0));

    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + CLIENT + LIVE + API ALL PASS'));
    if (fails.length) {
        fails.forEach(function (f) { console.log(' - ' + f); });
        process.exit(1);
    }
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
