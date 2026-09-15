/**
 * + Appointment scroll restore — smoke / spot / API test.
 * Run: node scripts/plusappt-scroll-restore-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-appt.js'))) root = process.cwd();

var BUILD = '20260916plussc4';
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

function loadScrollFns() {
    var src = fs.readFileSync(path.join(root, 'app-appt.js'), 'utf8');
    var wrapEl = null;
    var allEl = { scrollLeft: 0 };
    var ctx = {
        plusApptScrollMem: null,
        plusApptScrollRestoring: false,
        plusApptScrollRestoreGen: 0,
        PLUSAPPT_SCROLL_MEM_TTL_MS: 180000,
        PLUSAPPT_SCROLL_PIN_MS: 3500,
        plusApptScrollUserUnpinned: false,
        plusApptSelectedAppt: null,
        plusApptSelectedSlot: null,
        plusApptIsAllDoctorsMode: function () { return false; },
        g: function (id) { return id === 'plusApptAllScroll' ? allEl : null; },
        window: {
            pageYOffset: 0,
            scrollTo: function (x, y) { ctx.window.pageYOffset = y; }
        },
        document: {
            documentElement: { scrollTop: 0 },
            querySelector: function (sel) {
                if (sel === '#plusApptSingleView .plusappt-schedule-wrap') return wrapEl;
                return null;
            }
        },
        pad: function (n) { return String(n).padStart(2, '0'); }
    };
    ctx.window = ctx.window;
    var code = [
        'function pad(n) { return String(n).padStart(2, "0"); }',
        sliceFn(src, 'plusApptNormTime', 'plusApptTimeToMin'),
        sliceFn(src, 'plusApptTimeToMin', 'gcalNormalizeTimelineSettings'),
        sliceFn(src, 'plusApptScheduleScrollWraps', 'plusApptSlotFromScrollWrap'),
        sliceFn(src, 'plusApptSlotFromScrollWrap', 'plusApptSlotAnchorOffset'),
        sliceFn(src, 'plusApptSlotAnchorOffset', 'plusApptScrollMemHasOffset'),
        sliceFn(src, 'plusApptScrollMemHasOffset', 'plusApptWrapLooksCollapsed'),
        sliceFn(src, 'plusApptWrapLooksCollapsed', 'plusApptMemIsPinned'),
        sliceFn(src, 'plusApptMemIsPinned', 'plusApptOwnsScheduleScrollRestore'),
        sliceFn(src, 'plusApptOwnsScheduleScrollRestore', 'plusApptStripScheduleFromAppScrollState'),
        sliceFn(src, 'plusApptStripScheduleFromAppScrollState', 'plusApptClearScheduleScrollMem'),
        sliceFn(src, 'plusApptClearScheduleScrollMem', 'plusApptPinScheduleScrollMem'),
        sliceFn(src, 'plusApptPinScheduleScrollMem', 'plusApptCaptureScheduleScroll'),
        sliceFn(src, 'plusApptCaptureScheduleScroll', 'plusApptFindSlotRow'),
        sliceFn(src, 'plusApptFindSlotRow', 'plusApptApplyScrollToWrap'),
        sliceFn(src, 'plusApptApplyScrollToWrap', 'plusApptRestoreScheduleScroll'),
        sliceFn(src, 'plusApptRestoreScheduleScroll', 'plusApptScheduleRestoreAfterRender'),
        // Move helpers live near dragstart — pull a small extra slice if present.
        (function () {
            var a = src.indexOf('function plusApptPinScheduleForMove');
            var b = src.indexOf('function plusApptIsRowMoveInteractionActive');
            var c = src.indexOf('function plusApptRestoreDoctorSelection');
            if (a < 0 || c < 0) return '';
            return src.slice(a, c);
        })()
    ].join('\n');
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    ctx.__setWrap = function (el) { wrapEl = el; };
    ctx.__allEl = allEl;
    return ctx;
}

function fakeWrap(scrollTop, slots) {
    var wrap = {
        scrollTop: scrollTop,
        scrollLeft: 0,
        closest: function () { return null; },
        getBoundingClientRect: function () { return { top: 0, bottom: 400, left: 0, right: 800 }; }
    };
    var rows = (slots || []).map(function (t, i) {
        var layoutTop = 40 + i * 24;
        return {
            getAttribute: function (n) { return n === 'data-slot-time' ? t : ''; },
            getBoundingClientRect: function () {
                var y = layoutTop - wrap.scrollTop;
                return { top: y, bottom: y + 24 };
            }
        };
    });
    wrap.querySelector = function (sel) {
        if (sel === 'thead') return { offsetHeight: 32 };
        var m = String(sel || '').match(/data-slot-time="([^"]+)"/);
        if (m) {
            var hit = null;
            rows.forEach(function (r) {
                if (r.getAttribute('data-slot-time') === m[1]) hit = r;
            });
            return hit;
        }
        return null;
    };
    wrap.querySelectorAll = function () { return rows; };
    wrap.scrollHeight = 40 + Math.max(1, rows.length) * 24 + 800;
    wrap.clientHeight = 400;
    return wrap;
}

(async function main() {
    var appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    var idxSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    var apptSrc = fs.readFileSync(path.join(root, 'app-appt.js'), 'utf8');

    console.log('=== smoke: source ===');
    pass('capture helper', apptSrc.indexOf('function plusApptCaptureScheduleScroll') >= 0);
    pass('restore helper', apptSrc.indexOf('function plusApptRestoreScheduleScroll') >= 0);
    pass('render restores after fill',
        /function renderPlusApptSchedule\(force\)[\s\S]{0,700}plusApptScheduleRestoreAfterRender\(\)/.test(apptSrc));
    pass('loadPlusApptDay captures before fetch',
        /function loadPlusApptDay[\s\S]{0,450}plusApptCaptureScheduleScroll\(\)/.test(apptSrc));
    pass('edit modal pins time area',
        /function openApptEditModal[\s\S]{0,280}pin: true/.test(apptSrc));
    pass('remarks editor pins on plusappt',
        /function openQueueRemarksEditor[\s\S]{0,420}pin: true/.test(apptSrc));
    pass('date change clears mem',
        /function plusApptSetDate[\s\S]{0,80}plusApptClearScheduleScrollMem\(\)/.test(apptSrc));
    pass('unpaid hydrate restores again',
        /hydrateApptUnpaidBalances\(plusApptDayAppts[\s\S]{0,900}plusApptScheduleRestoreAfterRender\(\)/.test(apptSrc));
    pass('snapshot uses element offset not only winY',
        apptSrc.indexOf('function apptScrollStateHasOffset') >= 0);
    pass('index BUILD bumped',
        idxSrc.indexOf("BUILD = '" + BUILD + "'") >= 0,
        (idxSrc.match(/BUILD = '([^']+)'/) || [])[1]);
    pass('owns-restore guard',
        apptSrc.indexOf('function plusApptOwnsScheduleScrollRestore') >= 0);
    pass('strips plusappt from app scroll state',
        apptSrc.indexOf('function plusApptStripScheduleFromAppScrollState') >= 0);
    pass('apptFinish defers to plusAppt owner',
        /function apptFinishScrollPreserve[\s\S]{0,900}plusApptOwnsScheduleScrollRestore/.test(apptSrc));
    pass('applyAppScrollState skips plusappt wraps',
        /function applyAppScrollState[\s\S]{0,700}plusApptOwnsScheduleScrollRestore/.test(appSrc));
    pass('pin for move helper',
        apptSrc.indexOf('function plusApptPinScheduleForMove') >= 0);
    pass('dragstart pins viewport',
        /function plusApptMarkRowDragTransfer[\s\S]{0,450}plusApptCaptureScheduleScroll/.test(apptSrc));
    pass('drop reschedule soft refresh',
        /plusApptPinScheduleForMove\(newStart[\s\S]{0,700}refreshApptPlannerData\(\{ soft: true \}\)/.test(apptSrc));
    pass('transfer refresh soft',
        /function apptRefreshListsAfterTransfer[\s\S]{0,280}refreshApptPlannerData\(\{ soft: true \}\)/.test(apptSrc));
    pass('drag auto-scroll does not unpin',
        /plusApptIsRowMoveInteractionActive[\s\S]{0,220}return;/.test(apptSrc) &&
        apptSrc.indexOf('plusApptOnUserScrollGesture') >= 0);

    console.log('\n=== unit: time + capture/restore ===');
    var fns = loadScrollFns();
    pass('norm 16:00', fns.plusApptNormTime('16:00:00') === '16:00');
    pass('norm 9:05', fns.plusApptNormTime('9:05') === '09:05');
    pass('min 16:00 is 960', fns.plusApptTimeToMin('16:00') === 960);

    var slots = ['09:00', '09:15', '13:30', '16:00', '16:15', '19:00'];
    var wrap = fakeWrap(420, slots);
    fns.__setWrap(wrap);
    var mem = fns.plusApptCaptureScheduleScroll({ force: true, pin: true, slotTime: '16:00', apptId: 'row-16' });
    pass('pin capture stores wrapTop', mem && mem.wrapTop === 420, mem && String(mem.wrapTop));
    pass('pin capture stores slot', mem && mem.slotTime === '16:00', mem && mem.slotTime);
    pass('pin flag set', !!(mem && mem.pinned));

    wrap.scrollTop = 0;
    var clobber = fns.plusApptCaptureScheduleScroll();
    pass('pinned mem survives zeroed wrap',
        clobber === mem && clobber.wrapTop === 420,
        clobber && String(clobber.wrapTop));

    fns.plusApptScrollMem.pinned = false;
    wrap.scrollTop = 0;
    wrap.scrollHeight = 48;
    wrap.clientHeight = 400;
    var zeroed = fns.plusApptCaptureScheduleScroll();
    pass('collapsed zero capture keeps afternoon mem',
        zeroed && zeroed.wrapTop === 420 && zeroed.slotTime === '16:00',
        zeroed && (zeroed.wrapTop + ' @ ' + zeroed.slotTime));

    wrap.scrollHeight = 40 + slots.length * 24 + 800;
    fns.plusApptRestoreScheduleScroll();
    pass('restore moves wrap off morning',
        wrap.scrollTop !== 0,
        'scrollTop=' + wrap.scrollTop);

    var found = fns.plusApptFindSlotRow(wrap, '16:07');
    pass('findSlotRow nearest to 16:07 is 16:00 or 16:15',
        !!(found && /16:0[05]/.test(found.getAttribute('data-slot-time'))),
        found && found.getAttribute('data-slot-time'));

    // Race: after restore, a morningish live capture must not clobber the pin.
    wrap.scrollTop = 0;
    wrap.scrollHeight = 40 + slots.length * 24 + 800;
    var raced = fns.plusApptCaptureScheduleScroll();
    pass('morningish capture cannot clobber pinned afternoon',
        raced && raced.slotTime === '16:00' && raced.wrapTop === 420,
        raced && (raced.wrapTop + ' @ ' + raced.slotTime));
    var stripped = fns.plusApptStripScheduleFromAppScrollState({
        winY: 10,
        els: {
            '.plusappt-schedule-wrap': { top: 0, left: 0 },
            '#plusApptAllScroll': { top: 0, left: 12 },
            '.queue-wrap': { top: 55, left: 0 }
        }
    });
    pass('strip removes plusappt keys only',
        !!(stripped && stripped.els && !stripped.els['.plusappt-schedule-wrap'] &&
            !stripped.els['#plusApptAllScroll'] && stripped.els['.queue-wrap']),
        stripped && JSON.stringify(stripped.els));
    pass('owns restore while pinned',
        typeof fns.plusApptOwnsScheduleScrollRestore === 'function' &&
        fns.plusApptOwnsScheduleScrollRestore() === true);

    // Move path: pin destination while wrap is at morning must keep prior afternoon viewport.
    if (typeof fns.plusApptPinScheduleForMove === 'function') {
        wrap.scrollTop = 0;
        wrap.scrollHeight = 48;
        fns.plusApptPinScheduleForMove('16:15', 'move-row');
        pass('pin-for-move keeps prior afternoon wrapTop',
            !!(fns.plusApptScrollMem && fns.plusApptScrollMem.wrapTop === 420 &&
                fns.plusApptScrollMem.slotTime === '16:15'),
            fns.plusApptScrollMem && (fns.plusApptScrollMem.wrapTop + '@' + fns.plusApptScrollMem.slotTime));
        wrap.scrollHeight = 40 + slots.length * 24 + 800;
        fns.plusApptRestoreScheduleScroll();
        pass('pin-for-move restore leaves morning',
            wrap.scrollTop !== 0,
            'scrollTop=' + wrap.scrollTop);
    } else {
        pass('pin-for-move helper in unit harness', false, 'missing from vm slice');
    }

    fns.plusApptClearScheduleScrollMem();
    pass('clear wipes mem', fns.plusApptScrollMem == null);

    console.log('\n=== HTTP spot: live-server ===');
    var served = null;
    var ports = [5500, 8123];
    var i;
    for (i = 0; i < ports.length; i++) {
        try {
            var idx = await httpGet('127.0.0.1', ports[i], '/index.html');
            var js = await httpGet('127.0.0.1', ports[i], '/app-appt.js?b=' + BUILD);
            served = { port: ports[i], idx: idx, js: js };
            break;
        } catch (e) {
            served = { error: String(e.message || e), port: ports[i] };
        }
    }
    if (!served || !served.idx) {
        pass('live-server reachable', false, served && served.error);
    } else {
        pass('index.html :' + served.port, served.idx.status === 200, 'status ' + served.idx.status);
        pass('served BUILD',
            served.idx.body.indexOf("BUILD = '" + BUILD + "'") >= 0,
            (served.idx.body.match(/BUILD = '([^']+)'/) || [])[1]);
        pass('served app-appt.js',
            served.js.status === 200 && served.js.body.indexOf('function plusApptCaptureScheduleScroll') >= 0,
            'status ' + served.js.status + ' bytes=' + (served.js.body || '').length);
        pass('served restore-after-render',
            served.js.body.indexOf('function plusApptScheduleRestoreAfterRender') >= 0);
        pass('served pin on edit modal',
            /function openApptEditModal[\s\S]{0,280}pin: true/.test(served.js.body));
    }

    console.log('\n=== API: afternoon appointments exist to restore to ===');
    var sb = readSbConfig(appSrc);
    var today = new Date();
    var iso = today.getFullYear() + '-' +
        String(today.getMonth() + 1).padStart(2, '0') + '-' +
        String(today.getDate()).padStart(2, '0');
    var apRes = await restGet(sb.url, sb.key, 'appointments',
        'select=id,date,start_time,patient_name,clinic_tag&date=eq.' + iso +
        '&order=start_time.asc&limit=80');
    pass('appointments REST ok',
        apRes.status === 200 && Array.isArray(apRes.json),
        'HTTP ' + apRes.status + (apRes.raw && apRes.status !== 200 ? ' ' + apRes.raw : ''));
    var rows = Array.isArray(apRes.json) ? apRes.json : [];
    var pm = rows.filter(function (a) {
        var t = String(a.start_time || '');
        var hh = parseInt(t.slice(0, 2), 10);
        return hh >= 14;
    });
    pass('today has rows', rows.length > 0, 'n=' + rows.length + ' date=' + iso);
    pass('today has afternoon rows (>=14:00)',
        pm.length > 0,
        'pm=' + pm.length + (pm[0] ? ' first=' + String(pm[0].start_time).slice(0, 5) : ''));

    var later = await restGet(sb.url, sb.key, 'appointments',
        'select=id,date,start_time&start_time=gte.14:00:00&order=date.desc&limit=5');
    pass('gte 14:00 query ok',
        later.status === 200 && Array.isArray(later.json) && later.json.length > 0,
        'HTTP ' + later.status + ' n=' + (later.json && later.json.length));

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
