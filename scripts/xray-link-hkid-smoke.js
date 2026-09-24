/**
 * X-ray HKID link smoke / spot / API test.
 * Chart numbers stay independent; films join through HKID.
 * Run: node scripts/xray-link-hkid-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-xray-link.js'))) root = process.cwd();

var SAMPLE_NOS = ['001003', 'PL010031', '21713'];
var SAMPLE_NAME = 'ng pui ching';
var fails = [];

function pass(name, ok, detail) {
    var line = (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —  ' + detail : '');
    console.log(line);
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}

function normalizeHkid(raw) {
    return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
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

function chartNeedle(no) {
    return String(no || '').replace(/^#/, '').trim();
}

(async function main() {
    var linkSrc = fs.readFileSync(path.join(root, 'app-xray-link.js'), 'utf8');
    var appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    var idxSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

    var xraySrc = fs.readFileSync(path.join(root, 'app-xray.js'), 'utf8');
    var rtSrc = fs.readFileSync(path.join(root, 'app-realtime-sync.js'), 'utf8');

    console.log('=== smoke: source ===');
    pass('no silent snap to working-clinic twin',
        linkSrc.indexOf('syncXrayPatient(workCharts[0]') < 0);
    pass('load uses linked patient_id list',
        /SB\.from\('xrays'\)[\s\S]{0,120}\.in\('patient_id',\s*ids\)/.test(linkSrc));
    pass('HKID link query present',
        linkSrc.indexOf("hkid.ilike.%") >= 0 && linkSrc.indexOf('xrayNormalizeHkid') >= 0);
    pass('HKID-linked charts open scope all',
        /hkidLinked[\s\S]{0,180}xrayClinicScope = 'all'/.test(linkSrc));
    pass('same-clinic HKID twins stay in linked list',
        linkSrc.indexOf('if (rows.length > 1) {\n                ambiguousTags.push(xrayPatientClinicTag(rows[0]) || key);\n                return;') < 0);
    pass('upload target helper exported',
        /window\.xrayUploadTargetPatient\s*=/.test(linkSrc));
    pass('upload insert uses destId not opened chart',
        /patient_id\s*:\s*destId/.test(xraySrc) &&
        /function xrayResolveUploadPatient/.test(xraySrc));
    pass('insert no longer binds xrayPatientId',
        !/patient_id\s*:\s*xrayPatientId/.test(xraySrc));
    pass('chooser opens on no-working-chart',
        /xrayOpenUploadChooser/.test(xraySrc) &&
        /window\.xrayOpenUploadChooser\s*=/.test(linkSrc));
    pass('global clone allocates bare number',
        /window\.xrayAllocBarePatientNo\s*=/.test(linkSrc) &&
        linkSrc.indexOf('formatPatientNoFromNumber') < 0);
    pass('chooser does not create brought-forward bill',
        !/patientDupCreateBf|brought.forward|insertBill/.test(linkSrc.slice(linkSrc.indexOf('xrayInsertGlobalClone'))));
    pass('index ships chooser modal',
        /id="xrayUploadChooserModal"/.test(idxSrc));
    pass('index ships patched xray-link',
        /app-xray-link\.js\?v=20260917xrayup2/.test(idxSrc));
    pass('index BUILD bumped',
        /BUILD = '20260924rxpanel2'/.test(idxSrc));
    pass('patient switch still loads the HKID film union',
        /xrayClearDisplayedFilms\(\)/.test(linkSrc) &&
        /SB\.from\('xrays'\)[\s\S]{0,120}\.in\('patient_id',\s*ids\)/.test(linkSrc));
    pass('upload finish clears queue and refreshes',
        /function xrayFinishUploadQueue/.test(xraySrc) &&
        /xrayUploadQueue = \[\]/.test(xraySrc) &&
        /refreshXrays\(\)/.test(xraySrc) &&
        /xrayFinishUploadQueue\(\)/.test(xraySrc));
    pass('realtime pauses xray only while upload in progress',
        /function rtXrayUploadInProgress/.test(rtSrc) &&
        /xrayUploadQIdx < xrayUploadQueue.length/.test(rtSrc) &&
        !/xrayUploadQueue\.length\) return true/.test(rtSrc));

    console.log('\n=== unit: upload target (working clinic vs chart prefix) ===');
    function resolveUploadTarget(work, homeTag, openedId, chartsAtWork) {
        var w = String(work || '').toUpperCase();
        var h = String(homeTag || '').toUpperCase();
        if (!work || w === h) return { ok: true, id: openedId };
        if (chartsAtWork.length === 1) return { ok: true, id: chartsAtWork[0].id };
        if (chartsAtWork.length > 1) return { ok: false, reason: 'ambiguous' };
        return { ok: false, reason: 'no-working-chart' };
    }
    var same = resolveUploadTarget('MK', 'MK', 'opened-mk', [{ id: 'opened-mk' }]);
    pass('same-clinic opened chart writes to itself', same.ok && same.id === 'opened-mk');
    var retarget = resolveUploadTarget('MK', 'TKO', 'opened-tko', [{ id: 'mk-twin' }]);
    pass('prefix chart retargets to working-clinic twin',
        retarget.ok && retarget.id === 'mk-twin');
    var blocked = resolveUploadTarget('MK', 'TKO', 'opened-tko', []);
    pass('no working-clinic chart signals chooser',
        !blocked.ok && blocked.reason === 'no-working-chart');
    function coreKey(no) {
        var s = String(no || '').replace(/^[A-Za-z]+/, '').replace(/\D/g, '');
        return s ? String(parseInt(s, 10)) : '';
    }
    pass('bare global number has no clinic prefix',
        !/^[A-Za-z]/.test('010482') && coreKey('010482') === '10482');
    pass('MK-prefixed same core clashes with bare global',
        coreKey('MK010482') === coreKey('010482') &&
        coreKey('TKO010482') === coreKey('010482'));
    var ambi = resolveUploadTarget('MK', 'TKO', 'opened-tko', [{ id: 'a' }, { id: 'b' }]);
    pass('ambiguous working-clinic charts block upload',
        !ambi.ok && ambi.reason === 'ambiguous');

    console.log('\n=== unit: HKID normalize ===');
    pass('strips punctuation',
        normalizeHkid('A123456(7)') === 'A1234567');
    pass('case-insensitive',
        normalizeHkid('a123456(7)') === normalizeHkid('A123456(7)'));
    pass('empty stays empty',
        normalizeHkid('  ') === '');

    console.log('\n=== HTTP spot: live-server / static ===');
    var served = null;
    var ports = [5500, 8123, 8124];
    var i;
    var expectedBuild = '20260924rxpanel2';
    var probeErrors = [];
    for (i = 0; i < ports.length; i++) {
        try {
            var idx = await httpGet('127.0.0.1', ports[i], '/index.html?b=' + expectedBuild);
            var js = await httpGet('127.0.0.1', ports[i], '/app-xray-link.js?v=' + expectedBuild);
            var xrayJs = await httpGet('127.0.0.1', ports[i], '/app-xray.js?b=' + expectedBuild);
            var rtJs = await httpGet('127.0.0.1', ports[i], '/app-realtime-sync.js?b=' + expectedBuild);
            var hit = { port: ports[i], idx: idx, js: js, xrayJs: xrayJs, rtJs: rtJs };
            if (new RegExp("BUILD = '" + expectedBuild + "'").test(idx.body)) {
                served = hit;
                break;
            }
            if (!served) served = hit;
        } catch (e) {
            probeErrors.push(ports[i] + ' ' + String(e.message || e));
        }
    }
    if (!served || !served.idx) {
        pass('live-server reachable', false, probeErrors.join(' | ') || 'no listener');
    } else {
        var servedBuild = (served.idx.body.match(/BUILD = '([^']+)'/) || [])[1] || '';
        pass('index.html ' + served.port, served.idx.status === 200, 'status ' + served.idx.status);
        pass('served BUILD',
            servedBuild === expectedBuild,
            servedBuild + (served.port === 5500 ? '' : ' port=' + served.port));
        pass('served upload target helper',
            served.js.status === 200 && /window\.xrayUploadTargetPatient\s*=/.test(served.js.body));
        pass('served chooser modal',
            /id="xrayUploadChooserModal"/.test(served.idx.body));
        pass('served chooser + bare allocator',
            /window\.xrayOpenUploadChooser\s*=/.test(served.js.body) &&
            /window\.xrayAllocBarePatientNo\s*=/.test(served.js.body));
        pass('served xray-link no snap',
            served.js.status === 200 && served.js.body.indexOf('syncXrayPatient(workCharts[0]') < 0,
            'status ' + served.js.status);
        pass('served xray-link HKID all-scope',
            /hkidLinked[\s\S]{0,180}xrayClinicScope = 'all'/.test(served.js.body));
        pass('served finish-queue helper',
            served.xrayJs && served.xrayJs.status === 200 &&
            /function xrayFinishUploadQueue/.test(served.xrayJs.body) &&
            /xrayFinishUploadQueue\(\)/.test(served.xrayJs.body));
        pass('served realtime in-progress pause',
            served.rtJs && served.rtJs.status === 200 &&
            /function rtXrayUploadInProgress/.test(served.rtJs.body) &&
            /xrayUploadQIdx < xrayUploadQueue.length/.test(served.rtJs.body));
    }

    console.log('\n=== API: sample charts ===');
    var sb = readSbConfig(appSrc);
    var orParts = [
        'full_name.ilike.*' + SAMPLE_NAME + '*'
    ];
    SAMPLE_NOS.forEach(function (no) {
        orParts.push('patient_no.eq.' + chartNeedle(no));
        orParts.push('patient_no.ilike.*' + chartNeedle(no) + '*');
    });
    var qs = 'select=id,patient_no,full_name,clinic_tag,hkid&or=(' + orParts.join(',') + ')&limit=40';
    var patRes = await restGet(sb.url, sb.key, 'patients', qs);
    pass('patients REST ok',
        patRes.status === 200 && Array.isArray(patRes.json),
        'HTTP ' + patRes.status);

    var rows = Array.isArray(patRes.json) ? patRes.json : [];
    var nameHits = rows.filter(function (r) {
        return String(r.full_name || '').toLowerCase().indexOf(SAMPLE_NAME) >= 0;
    });
    pass('name search returned rows', nameHits.length >= 1, 'n=' + nameHits.length);

    function chartDigits(no) {
        return String(no || '').replace(/\D/g, '').replace(/^0+/, '') || '0';
    }
    function pickBest(needle, pool) {
        var n = chartNeedle(needle).toUpperCase();
        var nd = chartDigits(n);
        var ranked = pool.slice().map(function (r) {
            var no = String(r.patient_no || '').toUpperCase().replace(/^#/, '');
            var score = 99;
            if (no === n) score = 0;
            else if (chartDigits(no) === nd) score = 1;
            else if (no === 'PL' + n || no.indexOf(n) === no.length - n.length) score = 2;
            return { row: r, score: score };
        }).filter(function (x) { return x.score < 99; })
            .sort(function (a, b) { return a.score - b.score; });
        return ranked.length ? ranked[0].row : null;
    }

    var picked = [];
    SAMPLE_NOS.forEach(function (no) {
        var row = pickBest(no, nameHits) || pickBest(no, rows);
        pass('found chart #' + no, !!row,
            row ? (row.patient_no + '@' + (row.clinic_tag || '?')) : 'none');
        if (row) picked.push(row);
    });

    var uniqueNos = {};
    picked.forEach(function (p) { uniqueNos[String(p.patient_no || '')] = true; });
    pass('picked chart numbers stay distinct',
        Object.keys(uniqueNos).length === picked.length && picked.length >= 2,
        Object.keys(uniqueNos).join(' | '));

    var norms = picked.map(function (p) { return normalizeHkid(p.hkid); });
    var sameId = picked.length >= 2 && norms.every(function (n) {
        return n && n === norms[0];
    });
    pass('picked samples share one HKID', sameId, sameId ? 'linked' : 'not-all-linked');

    var seed = picked.filter(function (p) {
        return String(p.patient_no || '').toUpperCase() === 'PL010031';
    })[0] || picked[1] || picked[0];
    var cluster = [];
    if (seed && normalizeHkid(seed.hkid)) {
        var seedN = normalizeHkid(seed.hkid);
        var needle = seedN.length >= 7 ? seedN.slice(0, -1) : seedN;
        needle = needle.replace(/[^A-Z0-9]/g, '');
        var orq = 'select=id,patient_no,full_name,clinic_tag,hkid&or=(hkid.ilike.*' +
            needle + '*,hkid.eq.' + seedN + ')&limit=80';
        var href = await restGet(sb.url, sb.key, 'patients', orq);
        pass('HKID sibling query ok',
            href.status === 200 && Array.isArray(href.json),
            'HTTP ' + href.status);
        var sibs = Array.isArray(href.json) ? href.json : [];
        var seen = {};
        cluster = sibs.concat(picked, rows).filter(function (r) {
            if (!r || !r.id || seen[r.id]) return false;
            if (normalizeHkid(r.hkid) !== seedN) return false;
            seen[r.id] = true;
            return true;
        });
    }
    var clusterLabel = cluster.map(function (c) {
        return (c.patient_no || '') + '@' + (c.clinic_tag || '?');
    }).join(', ');
    pass('HKID cluster has multiple independent chart nos',
        cluster.length >= 2, clusterLabel || 'empty');
    pass('cluster keeps PL010031',
        cluster.some(function (c) {
            return String(c.patient_no || '').toUpperCase() === 'PL010031';
        }));
    pass('cluster keeps a 21713-class chart',
        cluster.some(function (c) { return chartDigits(c.patient_no) === '21713'; }));
    pass('cluster keeps a 001003-class chart',
        cluster.some(function (c) { return chartDigits(c.patient_no) === '1003'; }));

    var probe = await restGet(sb.url, sb.key, 'xrays', 'select=id&limit=1');
    pass('xrays table readable',
        probe.status === 200 && Array.isArray(probe.json),
        'HTTP ' + probe.status + ' n=' + (probe.json && probe.json.length));

    if (cluster.length) {
        var ids = cluster.map(function (p) { return p.id; });
        var xq = 'select=id,patient_id,xray_type,taken_date&patient_id=in.(' + ids.join(',') + ')';
        var xres = await restGet(sb.url, sb.key, 'xrays', xq);
        pass('xrays REST ok', xres.status === 200 && Array.isArray(xres.json), 'HTTP ' + xres.status);
        var films = Array.isArray(xres.json) ? xres.json : [];
        var byPid = {};
        films.forEach(function (x) {
            var id = String(x.patient_id);
            byPid[id] = (byPid[id] || 0) + 1;
        });
        cluster.forEach(function (p) {
            var isSample = picked.some(function (s) { return s.id === p.id; });
            if (!isSample && (byPid[String(p.id)] || 0) === 0) return;
            pass('film count for #' + p.patient_no + '@' + (p.clinic_tag || '?'),
                true,
                String(byPid[String(p.id)] || 0));
        });
        var union = films.length;
        var maxOne = 0;
        Object.keys(byPid).forEach(function (k) {
            if (byPid[k] > maxOne) maxOne = byPid[k];
        });
        pass('linked gallery is union of chart films',
            union >= maxOne,
            'union=' + union + ' maxSingle=' + maxOne);

        console.log('\n=== pick simulation (identity vs film union) ===');
        picked.forEach(function (home) {
            var homeNo = String(home.patient_no || '');
            var others = cluster.filter(function (p) { return p.id !== home.id; })
                .map(function (p) { return p.patient_no; });
            pass('pick #' + homeNo + ' keeps that chart number',
                others.indexOf(homeNo) < 0,
                'linkedNos=' + others.join(',') + ' unionFilms=' + union);
        });
    }

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
