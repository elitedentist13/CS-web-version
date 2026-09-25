/**
 * Report tab presentation: grouped labels, headline totals, plain-language hints.
 * Presentation only. Does not write bills or payments.
 * Run: node scripts/report-headline-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-report.js'))) root = process.cwd();

var BUILD = '20260925notes9';
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
        method: 'GET',
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
    if (start >= 6 && src.slice(start - 6, start) === 'async ') start -= 6;
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

function sliceOf(src, name) {
    return extractFn(src, name);
}

(async function main() {
    var reportSrc = fs.readFileSync(path.join(root, 'app-report.js'), 'utf8');
    var appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    var idxSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    var i18nSrc = fs.readFileSync(path.join(root, 'app-i18n-extra.js'), 'utf8');
    var cssSrc = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
    var paintFn = sliceOf(reportSrc, 'paintReportHeadline');
    var fillFn = sliceOf(reportSrc, 'fillHeadlineCompare');
    var presetFn = sliceOf(reportSrc, 'applyPresetDatesForTab');

    console.log('=== smoke: source ===');
    pass('build stamp is the report presentation',
        idxSrc.indexOf("BUILD = '" + BUILD + "'") >= 0);
    pass('tabs are grouped and the old numbers are gone',
        idxSrc.indexOf('class="rpt-tab-bar"') >= 0 &&
        idxSrc.indexOf('report.tabGroup.income') >= 0 &&
        idxSrc.indexOf('report.tabGroup.doctors') >= 0 &&
        idxSrc.indexOf('report.tabGroup.records') >= 0 &&
        idxSrc.indexOf('data-rpt="dailySummary"') >= 0 &&
        idxSrc.indexOf('0) Clinic Summary') < 0);
    pass('headline mount is present',
        idxSrc.indexOf('id="rptHeadline"') >= 0);
    pass('opening reports lands on clinic this month',
        /tabKey === 'dailySummary'[\s\S]{0,500}_dailySummaryView = 'monthly'/.test(presetFn));
    pass('hints say what the total means',
        i18nSrc.indexOf('Money received in this period, including installments on older bills.') >= 0 &&
        i18nSrc.indexOf('Money received in this period, split across the treatments on those bills.') >= 0 &&
        /collectTreatmentItemStatGroupsFromPayments\(txSlices/.test(reportSrc) &&
        i18nSrc.indexOf('Bill (reference)') >= 0 &&
        reportSrc.indexOf('drMonthlyAmountPlain(dayAmounts.bill)') < 0 &&
        reportSrc.indexOf('drMonthlyAmountPlain(grandAmounts.bill)') < 0 &&
        i18nSrc.indexOf('Same {A} as clinic income for this doctor.') >= 0);
    pass('detail excel puts the doctor name on each section',
        /dailySummaryGroupTxByDoctor\(dayTx\)[\s\S]{0,500}_type: 'doctorSection'/.test(reportSrc) &&
        /_type === 'doctorSection'\) return \{ sectionHeader: true \}/.test(reportSrc));
    pass('headline paint does not write clinic data',
        paintFn.indexOf('.update(') < 0 &&
        paintFn.indexOf('.insert(') < 0 &&
        paintFn.indexOf('.delete(') < 0 &&
        paintFn.indexOf('.upsert(') < 0 &&
        fillFn.indexOf('.update(') < 0 &&
        fillFn.indexOf('.insert(') < 0 &&
        fillFn.indexOf('.delete(') < 0 &&
        fillFn.indexOf('loadReportPaymentSlices(range.from, range.to)') >= 0);
    pass('headline styles are in the stylesheet',
        cssSrc.indexOf('.rpt-headline-total') >= 0 &&
        cssSrc.indexOf('.rpt-headline-pill.is-up') >= 0 &&
        cssSrc.indexOf('.rpt-headline-pill.is-down') >= 0 &&
        cssSrc.indexOf('.rpt-tab-group-label') >= 0);

    console.log('\n=== spot / client simulation ===');
    var els = {
        rptHeadline: {
            hidden: true,
            innerHTML: '',
            querySelector: function (sel) {
                if (sel === '.rpt-headline-total') return { textContent: 'HK$ 23440.00' };
                return null;
            }
        },
        rptHeadlineCompare: { textContent: '', className: '' }
    };
    var loads = 0;
    var ctx = {
        console: console,
        tr: function (k) { return k === 'report.headline.lastMonth' ? 'Last month' : k; },
        esc: function (s) {
            return String(s == null ? '' : s)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        },
        fmtHK: function (n) { return 'HK$ ' + Number(n || 0).toFixed(2); },
        drMonthlyAccountLabel: function (m) { return String(m || '').toUpperCase(); },
        g: function (id) { return els[id]; },
        _headlineToken: 1,
        loadReportPaymentSlices: function () {
            loads += 1;
            return Promise.resolve([
                { amount: 16000, method: 'VISA' },
                { amount: 10300, method: 'CASH' }
            ]);
        }
    };
    vm.createContext(ctx);
    vm.runInContext(
        'function iso(d) {\n' +
        '  var pad = function (n) { return String(n).padStart(2, "0"); };\n' +
        '  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());\n' +
        '}\n' +
        'function parseDateToLocal(isoLike) {\n' +
        '  var s = String(isoLike || "").slice(0, 10);\n' +
        '  var m = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(s);\n' +
        '  if (!m) return new Date();\n' +
        '  return new Date(+m[1], +m[2] - 1, +m[3]);\n' +
        '}\n' +
        ['previousPeriodRange', 'reportMethodColor', 'headlinePartsFromSlices', 'paintReportHeadline', 'fillHeadlineCompare']
            .map(function (n) { return extractFn(reportSrc, n); }).join('\n'),
        ctx);

    var prev = ctx.previousPeriodRange('2026-09-01', '2026-09-30');
    pass('a calendar month compares with the previous month',
        prev && prev.from === '2026-08-01' && prev.to === '2026-08-31' && prev.label === 'Last month',
        prev ? (prev.from + ' ' + prev.to) : 'missing');
    var dayPrev = ctx.previousPeriodRange('2026-09-22', '2026-09-22');
    pass('a single day compares with the previous day',
        dayPrev && dayPrev.from === '2026-09-21' && dayPrev.to === '2026-09-21',
        dayPrev ? (dayPrev.from + ' ' + dayPrev.to) : 'missing');

    var parts = ctx.headlinePartsFromSlices([
        { amount: 17000, method: 'CASH' },
        { amount: 500, method: 'CASH' },
        { amount: 500, method: 'VISA' },
        { amount: 0, method: 'CASH' }
    ]);
    pass('headline total is the sum of the payments already on screen',
        parts.total === 18000 && parts.methods.CASH === 17500 && parts.methods.VISA === 500,
        'total=' + parts.total + ' cash=' + parts.methods.CASH);

    ctx.paintReportHeadline({
        total: 23440,
        methods: { VISA: 16000, CASH: 7440 },
        doctors: [{ label: 'Dr Ng Pui Ching', amount: 23440 }],
        agree: 'Same HK$ 23440.00 as clinic income for this doctor.'
    });
    var html = els.rptHeadline.innerHTML;
    pass('headline shows the total, methods, doctor, and agreement line',
        els.rptHeadline.hidden === false &&
        html.indexOf('HK$ 23440.00') >= 0 &&
        html.indexOf('VISA') >= 0 &&
        html.indexOf('Dr Ng Pui Ching') >= 0 &&
        html.indexOf('Same HK$ 23440.00 as clinic income for this doctor.') >= 0 &&
        loads === 0,
        'loads=' + loads);

    els.rptHeadlineCompare.textContent = '';
    ctx._headlineToken = 7;
    await ctx.fillHeadlineCompare(7, '2026-09-01', '2026-09-30', null);
    pass('last month difference keeps the minus on the change, not inside the amount',
        (els.rptHeadlineCompare.innerHTML || '').indexOf('Last month HK$ 26300.00') >= 0 &&
        (els.rptHeadlineCompare.innerHTML || '').indexOf('rpt-headline-pill is-down') >= 0 &&
        (els.rptHeadlineCompare.innerHTML || '').indexOf('−HK$ 2860.00') >= 0 &&
        (els.rptHeadlineCompare.innerHTML || '').indexOf('HK$ -') < 0 &&
        els.rptHeadlineCompare.className.indexOf('is-down') >= 0,
        els.rptHeadlineCompare.innerHTML || '');

    console.log('\n=== live server ===');
    var live = null;
    var livePort = 0;
    var ports = [5500, 8123, 8124];
    // Prefer the port serving this checkout's BUILD; other checkouts may share the machine.
    for (var pi = 0; pi < ports.length; pi++) {
        try {
            var probe = await httpGet('127.0.0.1', ports[pi], '/index.html?_lr=' + BUILD);
            if (!probe || probe.status !== 200) continue;
            var isOurs = probe.body.indexOf("BUILD = '" + BUILD + "'") >= 0;
            if (!livePort || isOurs) { live = probe; livePort = ports[pi]; }
            if (isOurs) break;
        } catch (e) {}
    }
    pass('clinic UI reachable', !!live && live.status === 200, livePort ? (':' + livePort) : 'no listener');
    if (live && live.status === 200) {
        pass('served page build is ' + BUILD,
            live.body.indexOf("BUILD = '" + BUILD + "'") >= 0 &&
            live.body.indexOf('id="rptHeadline"') >= 0 &&
            live.body.indexOf('report.tabGroup.income') >= 0);
        var servedReport = await httpGet('127.0.0.1', livePort, '/app-report.js?b=' + BUILD);
        var servedCss = await httpGet('127.0.0.1', livePort, '/style.css?b=' + BUILD);
        var servedI18n = await httpGet('127.0.0.1', livePort, '/app-i18n-extra.js?b=' + BUILD);
        pass('served report paints a headline from existing payment slices',
            servedReport.status === 200 &&
            servedReport.body.indexOf('function paintReportHeadline(') >= 0 &&
            servedReport.body.indexOf('function headlinePartsFromSlices(') >= 0 &&
            servedReport.body.indexOf("_dailySummaryView = 'monthly'") >= 0);
        pass('served styles and wording match the page',
            servedCss.status === 200 && servedCss.body.indexOf('.rpt-headline-total') >= 0 &&
            servedI18n.status === 200 &&
            servedI18n.body.indexOf('Money received in this period, including installments on older bills.') >= 0);
    }

    console.log('\n=== API ===');
    var sb = readSbConfig(appSrc);
    var readRes = await restGet(sb.url, sb.key, 'bill_payments',
        'select=id,paid_date,amount&paid_date=eq.2026-09-22&voided_at=is.null&limit=1');
    pass('payment read still answers and this test does not write',
        readRes.status === 200 && Array.isArray(readRes.json),
        'HTTP ' + readRes.status + ' rows=' + ((readRes.json && readRes.json.length) || 0));

    console.log('\n' + (fails.length ? 'FAILED ' + fails.length : 'SMOKE + SPOT + CLIENT + LIVE + API ALL PASS'));
    if (fails.length) {
        fails.forEach(function (f) { console.log(' - ' + f); });
        process.exit(1);
    }
})().catch(function (e) {
    console.error(e);
    process.exit(1);
});
