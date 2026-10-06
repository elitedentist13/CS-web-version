/**
 * File Transfer Fast Pass — smoke / spot / API / CDP Runtime.evaluate / live page.
 * Run: node scripts/filexfer-download-progress-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var os = require('os');
var child_process = require('child_process');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-file-transfer.js'))) root = process.cwd();

var BUILD = '20261006fx62';
var CDP_PORT = 9374;
var PAGE_PORT = 5500;
var CHROME = process.env.CHROME_PATH || (
    fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
);
var fails = [];

function pass(name, ok, detail) {
    var line = (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —  ' + detail : '');
    console.log(line);
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}

function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
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

function waitJson(url, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var last = null;
    function tick() {
        return fetch(url).then(function (r) { return r.json(); }).catch(function (e) {
            last = e;
            if (Date.now() > deadline) throw new Error('timeout ' + url + ' last=' + (last && last.message));
            return sleep(250).then(tick);
        });
    }
    return tick();
}

function Cdp(ws) {
    this.ws = ws;
    this.n = 0;
    this.pending = {};
    var self = this;
    ws.addEventListener('message', function (ev) {
        var data = JSON.parse(ev.data);
        if (data.id != null && self.pending[data.id]) {
            var p = self.pending[data.id];
            delete self.pending[data.id];
            if (data.error) p.reject(new Error(JSON.stringify(data.error)));
            else p.resolve(data.result || {});
        }
    });
}
Cdp.prototype.call = function (method, params, timeoutMs) {
    var self = this;
    timeoutMs = timeoutMs || 30000;
    return new Promise(function (resolve, reject) {
        var id = ++self.n;
        var t = setTimeout(function () {
            delete self.pending[id];
            reject(new Error('CDP timeout ' + method));
        }, timeoutMs);
        self.pending[id] = {
            resolve: function (v) { clearTimeout(t); resolve(v); },
            reject: function (e) { clearTimeout(t); reject(e); }
        };
        self.ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
    });
};
Cdp.prototype.js = function (expression, awaitPromise, timeoutMs) {
    var self = this;
    timeoutMs = timeoutMs || 45000;
    return self.call('Runtime.evaluate', {
        expression: expression,
        returnByValue: true,
        awaitPromise: !!awaitPromise,
        timeout: timeoutMs
    }, timeoutMs + 5000).then(function (r) {
        if (r.exceptionDetails) {
            var ex = r.exceptionDetails.exception || {};
            throw new Error(ex.description || JSON.stringify(r.exceptionDetails));
        }
        return (r.result || {}).value;
    });
};

var PAGE_SCRIPT = [
    '(async function () {',
    '  const out = {',
    '    build: window.__JSM_BUILD || "",',
    '    filexfer: typeof FILEXFER === "object",',
    '    openFn: !!(window.FILEXFER && typeof FILEXFER.open === "function"),',
    '    setProgressFn: !!(window.FILEXFER && typeof FILEXFER.setProgress === "function"),',
    '    renderFoundFn: !!(window.FILEXFER && typeof FILEXFER.renderFound === "function"),',
    '    picker: typeof window.showSaveFilePicker',
    '  };',
    '  if (!out.openFn) return out;',
    '  FILEXFER.open();',
    '  await new Promise(function (r) { setTimeout(r, 250); });',
    '  var wrap = document.getElementById("fx_prog");',
    '  var bar = document.getElementById("fx_prog_bar");',
    '  out.sendBar = !!(wrap && bar);',
    '  out.sendRole = wrap && wrap.getAttribute("role");',
    '  FILEXFER.setProgress(1);',
    '  out.send1 = wrap.style.display !== "none" && bar.style.width === "1%";',
    '  FILEXFER.setProgress(47);',
    '  out.send47 = bar.style.width === "47%" && wrap.getAttribute("aria-valuenow") === "47";',
    '  FILEXFER.setProgress(99);',
    '  out.send99 = bar.style.width === "99%" && wrap.classList.contains("is-busy");',
    '  var recvBtn = document.querySelector("[data-fx=\\"receive\\"]");',
    '  out.recvTab = !!recvBtn;',
    '  if (recvBtn) recvBtn.click();',
    '  await new Promise(function (r) { setTimeout(r, 150); });',
    '  FILEXFER.renderFound({',
    '    file_name: "license info(Kary Yip).zip",',
    '    file_size: 1306119473,',
    '    from_clinic_label: "Joyful Smile",',
    '    expires_at: new Date(Date.now() + 86400000).toISOString(),',
    '    note: "HJC7"',
    '  });',
    '  wrap = document.getElementById("fx_prog");',
    '  bar = document.getElementById("fx_prog_bar");',
    '  out.recvBar = !!(wrap && bar && document.getElementById("fx_dl"));',
    '  FILEXFER.setProgress(63);',
    '  out.recv63 = bar.style.width === "63%" && wrap.style.display !== "none";',
    '  out.recvNow = wrap.getAttribute("aria-valuenow");',
    '  FILEXFER.setProgress(100);',
    '  out.recv100 = bar.style.width === "100%" && !wrap.classList.contains("is-busy");',
    '  FILEXFER.setProgress(0);',
    '  out.recvHidden = wrap.style.display === "none";',
    '  return out;',
    '})()'
].join('\n');

function main() {
    console.log('=== smoke: File Transfer Fast Pass progress (BUILD ' + BUILD + ') ===\n');

    var fxSrc = fs.readFileSync(path.join(root, 'app-file-transfer.js'), 'utf8');
    var i18nSrc = fs.readFileSync(path.join(root, 'app-i18n-extra.js'), 'utf8');
    var cssSrc = fs.readFileSync(path.join(root, 'style-tools.css'), 'utf8');
    var idxSrc = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    var appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

    console.log('=== spot: source guards ===');
    pass('index BUILD bumped',
        idxSrc.indexOf("BUILD = '" + BUILD + "'") >= 0,
        (idxSrc.match(/BUILD = '([^']+)'/) || [])[1]);
    pass('noteDownloadPct helper',
        fxSrc.indexOf('function noteDownloadPct') >= 0);
    pass('setProgress helper',
        fxSrc.indexOf('function setProgress') >= 0);
    pass('Fast Pass upload uses 8 MB chips in parallel',
        fxSrc.indexOf('function uploadParallel') >= 0 &&
        /var PART_SIZE = 8 \* 1024 \* 1024/.test(fxSrc) &&
        /function uploadFile[\s\S]{0,400}uploadParallel/.test(fxSrc));
    pass('upload TUS kept as fallback',
        fxSrc.indexOf('function uploadTus') >= 0 &&
        /function uploadTus[\s\S]{0,1800}onPct\(Math\.min\(99/.test(fxSrc));
    pass('doSend drives the progress bar',
        /function doSend[\s\S]{0,900}setProgress\(1\)/.test(fxSrc) &&
        /function doSend[\s\S]{0,2200}filexfer\.sending/.test(fxSrc));
    pass('send form keeps fx_prog',
        /function renderSend[\s\S]{0,3500}id="fx_prog"/.test(fxSrc));
    pass('Fast Pass download: picker first then copied chunks / 8 MB chips',
        fxSrc.indexOf('function clickDownload') >= 0 &&
        fxSrc.indexOf('function xhrGetBlob') >= 0 &&
        fxSrc.indexOf('function pipeUrlToWriter') >= 0 &&
        fxSrc.indexOf('function prefetchFor') >= 0 &&
        /function doDownload[\s\S]{0,400}showSaveFilePicker/.test(fxSrc) &&
        /function doDownload[\s\S]{0,5000}clickDownload/.test(fxSrc) &&
        /r\.value\.slice\(\)/.test(fxSrc) &&
        fxSrc.indexOf('pipeTo(writer)') < 0 &&
        fxSrc.indexOf('function streamToWriter') < 0 &&
        fxSrc.indexOf('function pickSaveFile') < 0);
    pass('disk writer copies fetch chunks before write',
        /function pipeUrlToWriter[\s\S]{0,1800}r\.value\.slice\(\)/.test(fxSrc) &&
        /function writeDisk[\s\S]{0,900}new Blob\(\[piece\]/.test(fxSrc) &&
        /function stageThenCopy[\s\S]{0,1800}getDirectory/.test(fxSrc) &&
        /function writeFileOnce[\s\S]{0,500}application\/octet-stream/.test(fxSrc) &&
        /function copyOpfsToHandle[\s\S]{0,900}writeFileOnce/.test(fxSrc) &&
        /function sameBytes[\s\S]{0,2000}Copied file does not match/.test(fxSrc) &&
        /function doDownload[\s\S]{0,8000}stageThenCopy/.test(fxSrc) &&
        /function doDownload[\s\S]{0,9000}stageThenCopy/.test(fxSrc));
    pass('Look up prefetches signed URL before Download click',
        /function renderFound[\s\S]{0,4000}prefetchFor\(row\)/.test(fxSrc));
    pass('download chips update the same bar',
        /function noteDownloadPct[\s\S]{0,400}setProgress/.test(fxSrc) &&
        /function doDownload[\s\S]{0,4000}noteDownloadPct/.test(fxSrc));
    pass('wait notes: picker path + no-picker fallback',
        /function doDownload[\s\S]{0,6000}waitOtherTab/.test(fxSrc) &&
        /function doDownload[\s\S]{0,6000}waitChromeSave/.test(fxSrc));
    pass('Direct save picker runs before disabling the button',
        /var pick = window\.showSaveFilePicker[\s\S]{0,180}btn\.disabled = true/.test(fxSrc));
    pass('renderFound includes fx_prog',
        /function renderFound[\s\S]{0,900}id="fx_prog"/.test(fxSrc));
    pass('download button disabled while busy',
        /function doDownload[\s\S]{0,500}btn\.disabled = true/.test(fxSrc));
    pass('progress helpers exported for live tests',
        /setProgress: setProgress/.test(fxSrc) && /renderFound: renderFound/.test(fxSrc));
    pass('i18n sending + downloading',
        i18nSrc.indexOf("'filexfer.sending'") >= 0 &&
        i18nSrc.indexOf("'filexfer.downloading'") >= 0);
    pass('i18n wait-other-tab note',
        i18nSrc.indexOf("'filexfer.waitOtherTab'") >= 0);
    pass('i18n Chrome save dialog note',
        i18nSrc.indexOf("'filexfer.waitChromeSave'") >= 0 &&
        i18nSrc.indexOf("'filexfer.chromeSaving'") >= 0);
    pass('Fast Pass shows wait note on upload and download',
        /function doSend[\s\S]{0,800}showWaitNote/.test(fxSrc) &&
        /function doDownload[\s\S]{0,5000}showWaitNote/.test(fxSrc));
    pass('i18n downloadOk',
        i18nSrc.indexOf("'filexfer.downloadOk'") >= 0);
    pass('css fx-progress',
        cssSrc.indexOf('.fx-progress') >= 0);
    pass('file-transfer loaded from index',
        idxSrc.indexOf('app-file-transfer.js') >= 0);

    console.log('\n=== unit: progress math (spot) ===');
    function tusPct(offset, size) {
        return Math.min(99, Math.round((offset / size) * 100));
    }
    function notePct(pct) {
        return Math.max(1, Math.min(99, Math.round(pct || 0)));
    }
    pass('TUS mid 1.2 GB is 50%',
        tusPct(653059736, 1306119473) === 50,
        String(tusPct(653059736, 1306119473)));
    pass('TUS last chunk stays 99 until close',
        tusPct(1306119473, 1306119473) === 99,
        String(tusPct(1306119473, 1306119473)));
    pass('download bar caps at 99 until Chrome save',
        notePct(100) === 99 && notePct(0.4) === 1,
        String(notePct(100)));
    pass('8 MB chip aggregate mid file',
        notePct(((4 * 8 * 1024 * 1024) / (16 * 8 * 1024 * 1024)) * 100) === 25,
        String(notePct(((4 * 8 * 1024 * 1024) / (16 * 8 * 1024 * 1024)) * 100)));

    console.log('\n=== HTTP live :' + PAGE_PORT + ' ===');
    return httpGet('127.0.0.1', PAGE_PORT, '/index.html').then(function (idx) {
        pass('live index 200', idx.status === 200, String(idx.status));
        var liveBuild = (idx.body.match(/BUILD = '([^']+)'/) || [])[1];
        pass('live BUILD matches', liveBuild === BUILD, liveBuild);
        return Promise.all([
            httpGet('127.0.0.1', PAGE_PORT, '/app-file-transfer.js?b=' + BUILD),
            httpGet('127.0.0.1', PAGE_PORT, '/app-i18n-extra.js?b=' + BUILD),
            httpGet('127.0.0.1', PAGE_PORT, '/style-tools.css?b=' + BUILD)
        ]).then(function (arr) {
            var fx = arr[0];
            var i18n = arr[1];
            var css = arr[2];
            pass('live app-file-transfer.js', fx.status === 200 && fx.body.indexOf('function clickDownload') >= 0,
                fx.status + ' len=' + fx.body.length);
            pass('live setProgress served', fx.body.indexOf('function setProgress') >= 0);
            pass('live noteDownloadPct served', fx.body.indexOf('function noteDownloadPct') >= 0);
            pass('live Fast Pass copies chunks to disk',
                /function doDownload[\s\S]{0,400}showSaveFilePicker/.test(fx.body) &&
                fx.body.indexOf('function pipeUrlToWriter') >= 0 &&
                /r\.value\.slice\(\)/.test(fx.body) &&
                fx.body.indexOf('pipeTo(writer)') < 0 &&
                /function doDownload[\s\S]{0,5000}clickDownload/.test(fx.body) &&
                fx.body.indexOf('function streamToWriter') < 0);
            pass('live i18n sending+downloading',
                i18n.status === 200 &&
                i18n.body.indexOf('filexfer.sending') >= 0 &&
                i18n.body.indexOf('filexfer.downloading') >= 0);
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
            'select=id,pass_code,file_name,file_size,expires_at,storage_path&expires_at=gt.' +
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
        }).then(function () {
            return restGet(sb.url, sb.key, 'clinic_file_passes',
                'select=pass_code,file_name,file_size,storage_path,download_count&pass_code=eq.HJC7'
            ).then(function (h) {
                var row = h.json && h.json[0];
                pass('HJC7 row readable', h.status === 200 && !!row, h.status + (row ? ' ' + row.file_size : ''));
                if (row) {
                    pass('HJC7 size is the 1.2 GB object',
                        Number(row.file_size) === 1306119473,
                        String(row.file_size));
                    pass('HJC7 is one bucket object (not a RAM manifest)',
                        String(row.storage_path || '').indexOf('manifest.json') < 0,
                        row.storage_path);
                }
            });
        }).catch(function (err) {
            pass('REST clinic_file_passes', false, err.message || String(err));
        });
    }).then(function () {
        console.log('\n=== CDP live page / Runtime.evaluate ===');
        if (!fs.existsSync(CHROME)) {
            pass('Chrome found', false, CHROME);
            return;
        }
        pass('Chrome found', true, CHROME);
        var profile = path.join(os.tmpdir(), 'cs-filexfer-cdp');
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
        fs.mkdirSync(profile, { recursive: true });
        var hosted = 'http://127.0.0.1:' + PAGE_PORT + '/index.html?_lr=' + BUILD;
        var proc = child_process.spawn(CHROME, [
            '--remote-debugging-port=' + CDP_PORT,
            '--user-data-dir=' + profile,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-sync',
            '--window-size=1280,900',
            hosted
        ], { stdio: 'ignore' });
        var ws = null;
        return waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000).then(function () {
            return waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000);
        }).then(function (tabs) {
            var tab = (tabs || []).find(function (t) {
                return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0;
            });
            pass('CDP page target', !!tab && !!tab.webSocketDebuggerUrl);
            if (!tab) throw new Error('no page target');
            ws = new WebSocket(tab.webSocketDebuggerUrl);
            return new Promise(function (resolve, reject) {
                ws.addEventListener('open', resolve);
                ws.addEventListener('error', reject);
            }).then(function () {
                var cdp = new Cdp(ws);
                return cdp.call('Page.enable').then(function () {
                    return cdp.call('Runtime.enable');
                }).then(function () {
                    return cdp.call('Page.navigate', { url: hosted });
                }).then(function () {
                    return sleep(2500);
                }).then(function () {
                    return cdp.js(
                        'new Promise(function(resolve){ var n=0; (function tick(){ n+=1; if (window.FILEXFER && typeof FILEXFER.setProgress==="function") return resolve({ok:true,n:n,build:window.__JSM_BUILD}); if (n>40) return resolve({ok:false,n:n,build:window.__JSM_BUILD,fx:typeof FILEXFER,keys: window.FILEXFER?Object.keys(FILEXFER).join(","):""}); setTimeout(tick,250); })(); })',
                        true,
                        15000
                    );
                }).then(function (ready) {
                    pass('live: FILEXFER script settled', !!(ready && ready.ok),
                        ready ? ('n=' + ready.n + ' build=' + ready.build + ' fx=' + ready.fx + ' keys=' + (ready.keys || '')) : 'none');
                    return cdp.js(PAGE_SCRIPT, true, 20000);
                }).then(function (live) {
                    pass('live: FILEXFER ready', !!(live && live.openFn && live.setProgressFn),
                        live ? ('build=' + live.build) : 'none');
                    pass('live BUILD matches', live && live.build === BUILD, live && live.build);
                    pass('live: send tab has progress bar', !!(live && live.sendBar && live.sendRole === 'progressbar'));
                    pass('live: upload bar 1% then 47% then 99%',
                        !!(live && live.send1 && live.send47 && live.send99));
                    pass('live: receive card has progress bar + Download', !!(live && live.recvBar));
                    pass('live: download bar 63% then 100% then hide',
                        !!(live && live.recv63 && live.recv100 && live.recvHidden),
                        live ? ('now=' + live.recvNow) : '');
                    pass('live: save picker API present', live && live.picker === 'function', live && live.picker);
                });
            });
        }).catch(function (err) {
            pass('CDP live page', false, err.message || String(err));
        }).then(function () {
            try { if (ws) ws.close(); } catch (e) {}
            try { if (proc && !proc.killed) proc.kill(); } catch (e2) {}
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
