/**
 * Prove Fast Pass picker-download copies bytes (fetch buffer reuse used to
 * save a full-size junk file). Run: node scripts/filexfer-download-integrity-smoke.js
 */
var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var child_process = require('child_process');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-file-transfer.js'))) root = process.cwd();

var BUILD = '20261006fx64';
var CDP_PORT = 9377;
var PAGE_PORT = 5500;
var SIZE = 2 * 1024 * 1024;
var OBJECT = 'FX60/integrity.bin';
var CHROME = process.env.CHROME_PATH || (
    fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
);
var fails = [];
var proc = null;
var ws = null;

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

function waitJson(url, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var last = null;
    function tick() {
        return fetch(url).then(function (r) { return r.json(); }).catch(function (e) {
            last = e;
            if (Date.now() > deadline) throw new Error('timeout ' + url);
            return sleep(250).then(tick);
        });
    }
    return tick();
}

function Cdp(sock) {
    this.ws = sock;
    this.n = 0;
    this.pending = {};
    var self = this;
    sock.addEventListener('message', function (ev) {
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
    timeoutMs = timeoutMs || 45000;
    return this.call('Runtime.evaluate', {
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

function sbHeaders(key, extra) {
    var h = { apikey: key, Authorization: 'Bearer ' + key };
    Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
    return h;
}

function makePayload() {
    var buf = Buffer.alloc(SIZE);
    var i;
    for (i = 0; i < SIZE; i++) buf[i] = (i * 131 + 17) & 255;
    buf.write('FX60HEAD', 0);
    buf.write('FX60TAIL', SIZE - 8);
    return buf;
}

function main() {
    console.log('=== smoke: Fast Pass picker download integrity (BUILD ' + BUILD + ') ===\n');
    var fxSrc = fs.readFileSync(path.join(root, 'app-file-transfer.js'), 'utf8');
    pass('copies fetch chunks with slice', /r\.value\.slice\(\)/.test(fxSrc));
    pass('does not pipeTo the disk writer', fxSrc.indexOf('pipeTo(writer)') < 0);
    pass('checks saved file size', fxSrc.indexOf('function assertSavedSize') >= 0);
    pass('stages in OPFS then copies as octet-stream',
        fxSrc.indexOf('function stageThenCopy') >= 0 &&
        fxSrc.indexOf('function sameBytes') >= 0 &&
        /function writeFileOnce[\s\S]{0,500}application\/octet-stream/.test(fxSrc));

    var sb = readSbConfig(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
    var payload = makePayload();
    var expectSha = crypto.createHash('sha256').update(payload).digest('hex');
    var signUrl = sb.url.replace(/\/$/, '') + '/storage/v1/object/upload/sign/clinic-pass/' +
        OBJECT.split('/').map(encodeURIComponent).join('/');

    return fetch(signUrl, {
        method: 'POST',
        headers: sbHeaders(sb.key, { 'Content-Type': 'application/json' }),
        body: '{}'
    }).then(function (r) {
        return r.json().then(function (j) {
            if (!r.ok) throw new Error('sign upload ' + r.status + ' ' + JSON.stringify(j));
            var signed = j.signedUrl || j.url || (j.data && (j.data.signedUrl || j.data.url));
            if (signed.indexOf('http') !== 0) {
                signed = sb.url.replace(/\/$/, '') + '/storage/v1' + (signed.charAt(0) === '/' ? signed : '/' + signed);
            }
            return fetch(new URL(signed).href, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
                body: payload
            });
        });
    }).then(function (put) {
        pass('uploaded 2 MB patterned object', put.ok, String(put.status));
        if (!put.ok) throw new Error('upload failed');
        var profile = path.join(os.tmpdir(), 'cs-filexfer-integrity-cdp');
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
        fs.mkdirSync(profile, { recursive: true });
        var hosted = 'http://127.0.0.1:' + PAGE_PORT + '/index.html?_lr=' + BUILD + '-int';
        proc = child_process.spawn(CHROME, [
            '--remote-debugging-port=' + CDP_PORT,
            '--user-data-dir=' + profile,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-sync',
            '--window-size=1100,800',
            hosted
        ], { stdio: 'ignore' });
        return waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000)
            .then(function () { return waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000); })
            .then(function (tabs) {
                var tab = (tabs || []).find(function (t) {
                    return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0;
                });
                if (!tab) throw new Error('no page');
                ws = new WebSocket(tab.webSocketDebuggerUrl);
                return new Promise(function (resolve, reject) {
                    ws.addEventListener('open', resolve);
                    ws.addEventListener('error', reject);
                });
            }).then(function () {
                var cdp = new Cdp(ws);
                return cdp.call('Page.enable').then(function () {
                    return cdp.call('Runtime.enable');
                }).then(function () {
                    return cdp.call('Page.navigate', { url: hosted });
                }).then(function () { return sleep(2500); }).then(function () {
                    return cdp.js(
                        'new Promise(function(resolve){ var n=0; (function tick(){ if (window.FILEXFER && FILEXFER.renderFound) return resolve(true); if (++n>40) return resolve(false); setTimeout(tick,250); })(); })',
                        true,
                        15000
                    );
                }).then(function (ready) {
                    pass('FILEXFER ready', !!ready);
                    return cdp.js(
                        '(async function(){\n' +
                        '  window.currentUserId="fx-trial";\n' +
                        '  window.__FX_FORCE_PICKER = true;\n' +
                        '  window.showSaveFilePicker = function(opts){\n' +
                        '    return navigator.storage.getDirectory().then(function(root){\n' +
                        '      return root.getFileHandle((opts && opts.suggestedName) || "integrity.bin", { create: true });\n' +
                        '    });\n' +
                        '  };\n' +
                        '  FILEXFER.open();\n' +
                        '  await new Promise(function(r){ setTimeout(r,200); });\n' +
                        '  var recv=document.querySelector("[data-fx=\\"receive\\"]");\n' +
                        '  if (recv) recv.click();\n' +
                        '  await new Promise(function(r){ setTimeout(r,200); });\n' +
                        '  FILEXFER.renderFound({\n' +
                        '    id: "fx60-integrity",\n' +
                        '    storage_path: ' + JSON.stringify(OBJECT) + ',\n' +
                        '    file_name: "integrity.bin",\n' +
                        '    file_size: ' + SIZE + ',\n' +
                        '    from_clinic_label: "Joyful Smile",\n' +
                        '    expires_at: new Date(Date.now()+86400000).toISOString(),\n' +
                        '    note: "integrity"\n' +
                        '  });\n' +
                        '  await new Promise(function(r){ setTimeout(r,400); });\n' +
                        '  document.getElementById("fx_dl").click();\n' +
                        '  var deadline = Date.now() + 60000;\n' +
                        '  while (Date.now() < deadline) {\n' +
                        '    var st = document.getElementById("fx_status");\n' +
                        '    var txt = st ? st.textContent : "";\n' +
                        '    if (/Download completed|downloadOk/i.test(txt)) break;\n' +
                        '    if (st && /fx-status--bad/.test(st.className) && txt) throw new Error(txt);\n' +
                        '    await new Promise(function(r){ setTimeout(r,250); });\n' +
                        '  }\n' +
                        '  var root = await navigator.storage.getDirectory();\n' +
                        '  var fh = await root.getFileHandle("integrity.bin");\n' +
                        '  var f = await fh.getFile();\n' +
                        '  var buf = new Uint8Array(await f.arrayBuffer());\n' +
                        '  var head = String.fromCharCode.apply(null, buf.slice(0,8));\n' +
                        '  var tail = String.fromCharCode.apply(null, buf.slice(buf.length-8));\n' +
                        '  var hex = [];\n' +
                        '  var digest = await crypto.subtle.digest("SHA-256", buf);\n' +
                        '  new Uint8Array(digest).forEach(function(b){ hex.push(b.toString(16).padStart(2,"0")); });\n' +
                        '  return { size: f.size, head: head, tail: tail, sha: hex.join(""), status: (document.getElementById("fx_status")||{}).textContent };\n' +
                        '})()',
                        true,
                        90000
                    );
                }).then(function (got) {
                    pass('downloaded size', !!(got && got.size === SIZE), got && (got.size + ' ' + got.status));
                    pass('head marker', !!(got && got.head === 'FX60HEAD'), got && got.head);
                    pass('tail marker', !!(got && got.tail === 'FX60TAIL'), got && got.tail);
                    pass('sha256 matches upload', !!(got && got.sha === expectSha), got && got.sha);
                });
            });
    }).catch(function (err) {
        pass('integrity run', false, err.message || String(err));
    }).then(function () {
        try { if (ws) ws.close(); } catch (e) {}
        try { if (proc && !proc.killed) proc.kill(); } catch (e2) {}
        return fetch(sb.url.replace(/\/$/, '') + '/storage/v1/object/clinic-pass', {
            method: 'DELETE',
            headers: sbHeaders(sb.key, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ prefixes: [OBJECT] })
        }).catch(function () {});
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
