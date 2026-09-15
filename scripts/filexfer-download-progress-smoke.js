/**
 * File Transfer Fast Pass download progress — smoke / spot / API test.
 * Run: node scripts/filexfer-download-progress-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-file-transfer.js'))) root = process.cwd();

var BUILD = '20260916fxdl1';
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

function main() {
    console.log('=== smoke: File Transfer download progress (BUILD ' + BUILD + ') ===\n');

    var fxSrc = fs.readFileSync(path.join(root, 'app-file-transfer.js'), 'utf8');
    var i18nSrc = fs.readFileSync(path.join(root, 'app-i18n-extra.js'), 'utf8');
    var cssSrc = fs.readFileSync(path.join(root, 'style-tools.css'), 'utf8');
    var idxSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    var appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

    console.log('=== spot: source guards ===');
    pass('index BUILD bumped',
        idxSrc.indexOf("BUILD = '" + BUILD + "'") >= 0,
        (idxSrc.match(/BUILD = '([^']+)'/) || [])[1]);
    pass('xhrGetBlob helper',
        fxSrc.indexOf('function xhrGetBlob') >= 0);
    pass('noteDownloadPct helper',
        fxSrc.indexOf('function noteDownloadPct') >= 0);
    pass('doDownload uses xhrGetBlob',
        /function doDownload[\s\S]{0,2200}xhrGetBlob/.test(fxSrc));
    pass('renderFound includes fx_prog',
        /function renderFound[\s\S]{0,900}id="fx_prog"/.test(fxSrc));
    pass('multipart download reports progress',
        /isManifestPath[\s\S]{0,1800}noteDownloadPct/.test(fxSrc));
    pass('download button disabled while busy',
        /function doDownload[\s\S]{0,200}btn\.disabled = true/.test(fxSrc));
    pass('i18n downloading',
        i18nSrc.indexOf("'filexfer.downloading'") >= 0);
    pass('i18n downloadOk',
        i18nSrc.indexOf("'filexfer.downloadOk'") >= 0);
    pass('css fx-progress',
        cssSrc.indexOf('.fx-progress') >= 0);
    pass('file-transfer loaded from index',
        idxSrc.indexOf('app-file-transfer.js') >= 0);

    console.log('\n=== unit: progress math (spot) ===');
    // Mirror multipart aggregate used in doDownload
    function aggregatePct(got, total) {
        var sum = 0;
        for (var j = 0; j < got.length; j++) sum += got[j];
        if (total > 0) return Math.max(1, Math.min(99, Math.round((sum / total) * 100)));
        var done = 0;
        for (var k = 0; k < got.length; k++) if (got[k] > 0) done += 1;
        return Math.max(1, Math.min(99, Math.round((done / got.length) * 100)));
    }
    pass('aggregate mid multipart',
        aggregatePct([4 * 1024 * 1024, 2 * 1024 * 1024, 0, 0], 16 * 1024 * 1024) === 38,
        String(aggregatePct([4 * 1024 * 1024, 2 * 1024 * 1024, 0, 0], 16 * 1024 * 1024)));
    pass('aggregate near complete',
        aggregatePct([8e6, 8e6, 68e5, 0], 24e6) === 95,
        String(aggregatePct([8e6, 8e6, 68e5, 0], 24e6)));
    pass('aggregate unknown total by parts touched',
        aggregatePct([1, 1, 0, 0], 0) === 50,
        String(aggregatePct([1, 1, 0, 0], 0)));

    console.log('\n=== HTTP live :5500 ===');
    return httpGet('127.0.0.1', 5500, '/index.html').then(function (idx) {
        pass('live index 200', idx.status === 200, String(idx.status));
        var liveBuild = (idx.body.match(/BUILD = '([^']+)'/) || [])[1];
        pass('live BUILD matches', liveBuild === BUILD, liveBuild);
        return Promise.all([
            httpGet('127.0.0.1', 5500, '/app-file-transfer.js?b=' + BUILD),
            httpGet('127.0.0.1', 5500, '/app-i18n-extra.js?b=' + BUILD),
            httpGet('127.0.0.1', 5500, '/style-tools.css?b=' + BUILD)
        ]).then(function (arr) {
            var fx = arr[0];
            var i18n = arr[1];
            var css = arr[2];
            pass('live app-file-transfer.js', fx.status === 200 && fx.body.indexOf('function xhrGetBlob') >= 0,
                fx.status + ' len=' + fx.body.length);
            pass('live noteDownloadPct served', fx.body.indexOf('function noteDownloadPct') >= 0);
            pass('live doDownload xhr path', /function doDownload[\s\S]{0,2200}xhrGetBlob/.test(fx.body));
            pass('live i18n downloading', i18n.status === 200 && i18n.body.indexOf('filexfer.downloading') >= 0);
            pass('live style-tools fx-progress', css.status === 200 && css.body.indexOf('.fx-progress') >= 0);
        });
    }).catch(function (err) {
        pass('live HTTP', false, err.message || String(err));
    }).then(function () {
        console.log('\n=== API spot: clinic_file_passes ===');
        var sb;
        try { sb = readSbConfig(appJs); } catch (e) {
            pass('parse supabase config', false, e.message);
            return;
        }
        pass('parse supabase config', !!(sb && sb.url && sb.key), sb.url);
        return restGet(sb.url, sb.key, 'clinic_file_passes',
            'select=id,file_name,file_size,expires_at,storage_path&expires_at=gt.' +
            encodeURIComponent(new Date().toISOString()) + '&limit=5'
        ).then(function (r) {
            pass('REST clinic_file_passes reachable',
                r.status === 200 || r.status === 401 || r.status === 403,
                'HTTP ' + r.status);
            if (r.status === 200 && Array.isArray(r.json)) {
                pass('active passes sample', true, r.json.length + ' row(s)');
                var withSize = r.json.filter(function (x) { return Number(x.file_size) > 0; });
                pass('passes expose file_size for progress total',
                    r.json.length === 0 || withSize.length === r.json.length,
                    withSize.length + '/' + r.json.length + ' sized');
            } else if (r.status === 404 || (r.raw && /does not exist|schema cache/i.test(r.raw))) {
                pass('table missing (setup may be needed)', false, r.raw);
            } else {
                pass('API response', r.status < 500, r.raw);
            }
        }).catch(function (err) {
            pass('REST clinic_file_passes', false, err.message || String(err));
        });
    }).then(function () {
        console.log('\n=== RESULT ===');
        if (fails.length) {
            console.log('FAIL  ' + fails.length + ' check(s)');
            fails.forEach(function (f) { console.log('  - ' + f); });
            process.exitCode = 1;
        } else {
            console.log('ALL PASS');
        }
    });
}

main();
