/**
 * Live Fast Pass zip round-trip: send a >8 MB zip (chip path) and a small zip,
 * then download via the picker/OPFS writer and prove PK/sha256.
 * Run: node scripts/filexfer-zip-roundtrip-trial.js
 */
var fs = require('fs');
var path = require('path');
var os = require('os');
var crypto = require('crypto');
var child_process = require('child_process');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-file-transfer.js'))) root = process.cwd();

var BUILD = '20261006fx64';
var CDP_PORT = Number(process.env.FX_CDP_PORT) || 9378;
var PAGE_PORT = 5500;
var CHROME = process.env.CHROME_PATH || (
    fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
);
var ZIP_BIG = process.env.FX_ZIP_BIG || path.join(os.tmpdir(), 'cs-fx-zip-trial', 'chips.zip');
var ZIP_SMALL = process.env.FX_ZIP_SMALL || path.join(os.tmpdir(), 'cs-fx-zip-trial', 'small.zip');
var SKIP_SMALL = process.env.FX_SKIP_SMALL === '1';
var NATIVE_DL = process.env.FX_NATIVE_DL === '1';
var DL_DIR = path.join(os.tmpdir(), 'cs-fx-native-dl');
var fails = [];
var proc = null;
var ws = null;

function pass(name, ok, detail) {
    var line = (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —  ' + detail : '');
    console.log(line);
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function sha(p) {
    return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function pkOk(p) {
    var b = Buffer.alloc(4);
    var fd = fs.openSync(p, 'r');
    fs.readSync(fd, b, 0, 4, 0);
    fs.closeSync(fd);
    return b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04;
}

function readSbConfig(appJs) {
    var block = appJs.match(/supabase\.createClient\(([\s\S]*?)\);/);
    var parts = [];
    var re = /'([^']*)'/g;
    var m;
    while ((m = re.exec(block[1]))) parts.push(m[1]);
    return { url: parts[0], key: parts.slice(1).join('') };
}

function waitJson(url, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    function tick() {
        return fetch(url).then(function (r) { return r.json(); }).catch(function (e) {
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

function rest(sb, method, table, qs) {
    return fetch(sb.url.replace(/\/$/, '') + '/rest/v1/' + table + (qs ? '?' + qs : ''), {
        method: method,
        headers: {
            apikey: sb.key,
            Authorization: 'Bearer ' + sb.key,
            Accept: 'application/json'
        }
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); });
}

function cleanupPass(sb, code) {
    if (!code) return Promise.resolve();
    return rest(sb, 'GET', 'clinic_file_passes', 'select=id,storage_path&pass_code=eq.' + code).then(function (r) {
        var row = r.json && r.json[0];
        if (!row) return;
        var prefix = String(row.storage_path || '').replace(/\/manifest\.json$/i, '');
        return fetch(sb.url.replace(/\/$/, '') + '/storage/v1/object/clinic-pass', {
            method: 'DELETE',
            headers: {
                apikey: sb.key,
                Authorization: 'Bearer ' + sb.key,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ prefixes: [prefix] })
        }).then(function () {
            return rest(sb, 'DELETE', 'clinic_file_passes', 'id=eq.' + row.id);
        });
    }).catch(function () {});
}

function waitNativeFile(dir, expectSize, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    function tick() {
        var names = [];
        try { names = fs.readdirSync(dir); } catch (e) { names = []; }
        var i;
        for (i = 0; i < names.length; i++) {
            if (/\.crdownload$/i.test(names[i]) || /\.tmp$/i.test(names[i]) || names[i] === 'desktop.ini') continue;
            var p = path.join(dir, names[i]);
            try {
                var st = fs.statSync(p);
                if (st.isFile() && Number(st.size) === Number(expectSize)) return Promise.resolve(p);
            } catch (e2) {}
        }
        if (Date.now() > deadline) throw new Error('native download missing; saw ' + names.join(','));
        return sleep(400).then(tick);
    }
    return tick();
}

function nativeReceive(cdp, code, filePath, expectSha, label) {
    var expectSize = fs.statSync(filePath).size;
    try { fs.rmSync(DL_DIR, { recursive: true, force: true }); } catch (e) {}
    fs.mkdirSync(DL_DIR, { recursive: true });
    return cdp.call('Browser.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: DL_DIR,
        eventsEnabled: true
    }).catch(function () {
        return cdp.call('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR });
    }).then(function () {
        return cdp.js(
            '(async function(){\n' +
            '  window.currentUserId="fx-trial";\n' +
            '  window.__FX_FORCE_PICKER = false;\n' +
            '  FILEXFER.open();\n' +
            '  await new Promise(function(r){ setTimeout(r,200); });\n' +
            '  var recv=document.querySelector("[data-fx=\\"receive\\"]");\n' +
            '  if (recv) recv.click();\n' +
            '  await new Promise(function(r){ setTimeout(r,200); });\n' +
            '  var inp=document.getElementById("fx_in_code");\n' +
            '  if (inp) inp.value=' + JSON.stringify(code) + ';\n' +
            '  var btn=document.getElementById("fx_lookup");\n' +
            '  if (btn) btn.click();\n' +
            '  await new Promise(function(r){ setTimeout(r,8500); });\n' +
            '  var dl=document.getElementById("fx_dl");\n' +
            '  if (!dl) throw new Error("no download button");\n' +
            '  dl.click();\n' +
            '  return "clicked";\n' +
            '})()',
            true,
            60000
        );
    }).then(function () {
        return waitNativeFile(DL_DIR, expectSize, 180000);
    }).then(function (gotPath) {
        pass(label + ' native disk size', fs.statSync(gotPath).size === expectSize, gotPath + ' ' + fs.statSync(gotPath).size);
        pass(label + ' native PK', pkOk(gotPath));
        pass(label + ' native sha256', sha(gotPath) === expectSha, sha(gotPath));
        var listed = child_process.spawnSync('tar.exe', ['-tf', gotPath], { encoding: 'utf8' });
        pass(label + ' native unzip list', listed.status === 0 && String(listed.stdout || '').trim().length > 0,
            ((listed.stdout || listed.stderr || '') + '').trim().slice(0, 180));
        return code;
    });
}

function roundTrip(cdp, filePath, expectSha, label) {
    return cdp.js(
        'window.currentUserId="fx-trial"; FILEXFER.open(); var s=document.querySelector("[data-fx=\\"send\\"]"); if(s) s.click(); "send-tab"',
        false, 8000
    ).then(function () { return sleep(400); }).then(function () {
        return cdp.call('DOM.getDocument', { depth: 0 });
    }).then(function (doc) {
        return cdp.call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fx_file' });
    }).then(function (q) {
        if (!q || !q.nodeId) throw new Error(label + ': fx_file missing');
        return cdp.call('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [filePath] });
    }).then(function () {
        return cdp.js(
            '(function(){ window.currentUserId="fx-trial"; var n=document.getElementById("fx_note"); if(n) n.value="zip trial"; document.getElementById("fx_send").click(); return "clicked"; })()',
            false, 8000
        );
    }).then(function () {
        var deadline = Date.now() + 10 * 60 * 1000;
        function tick() {
            return cdp.js(
                '(function(){ var c=document.getElementById("fx_code_out"); var st=document.getElementById("fx_status"); return { code: c && c.textContent, status: st && st.textContent, fail: !!(st && /fx-status--bad/.test(st.className) && st.textContent) }; })()',
                false, 10000
            ).then(function (s) {
                if (s && s.code && String(s.code).replace(/\s/g, '').length >= 4) return String(s.code).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
                if (s && s.fail) throw new Error(label + ' send: ' + s.status);
                if (Date.now() > deadline) throw new Error(label + ' send timeout ' + JSON.stringify(s));
                return sleep(2000).then(tick);
            });
        }
        return tick();
    }).then(function (code) {
        pass(label + ' send code', code.length >= 4, code);
        if (NATIVE_DL) return nativeReceive(cdp, code, filePath, expectSha, label);
        return cdp.js(
            '(async function(){\n' +
            '  window.currentUserId="fx-trial";\n' +
            '  window.__FX_FORCE_PICKER = true;\n' +
            '  window.showSaveFilePicker = function(opts){\n' +
            '    return navigator.storage.getDirectory().then(function(root){\n' +
            '      return root.getFileHandle((opts && opts.suggestedName) || "dl.zip", { create: true });\n' +
            '    });\n' +
            '  };\n' +
            '  FILEXFER.open();\n' +
            '  await new Promise(function(r){ setTimeout(r,200); });\n' +
            '  var recv=document.querySelector("[data-fx=\\"receive\\"]");\n' +
            '  if (recv) recv.click();\n' +
            '  await new Promise(function(r){ setTimeout(r,200); });\n' +
            '  var inp=document.getElementById("fx_in_code");\n' +
            '  if (inp) inp.value=' + JSON.stringify(code) + ';\n' +
            '  var btn=document.getElementById("fx_lookup");\n' +
            '  if (btn) btn.click();\n' +
            '  await new Promise(function(r){ setTimeout(r,8500); });\n' +
            '  var dl=document.getElementById("fx_dl");\n' +
            '  if (!dl) throw new Error("no download button");\n' +
            '  dl.click();\n' +
            '  var deadline=Date.now()+180000;\n' +
            '  while(Date.now()<deadline){\n' +
            '    var st=document.getElementById("fx_status");\n' +
            '    var txt=st?st.textContent:"";\n' +
            '    if (/Download completed/i.test(txt)) break;\n' +
            '    if (st && /fx-status--bad/.test(st.className) && txt) throw new Error(txt);\n' +
            '    await new Promise(function(r){ setTimeout(r,300); });\n' +
            '  }\n' +
            '  var stDone=document.getElementById("fx_status");\n' +
            '  var doneTxt=stDone?stDone.textContent:"";\n' +
            '  if (!/Download completed/i.test(doneTxt)) throw new Error("download did not finish: "+doneTxt);\n' +
            '  var root=await navigator.storage.getDirectory();\n' +
            '  var name=(document.querySelector(".fx-pass-name")||{}).textContent || "chips.zip";\n' +
            '  var fh=await root.getFileHandle(name.trim() || "chips.zip").catch(function(){ return root.getFileHandle("dl.zip"); });\n' +
            '  var f=await fh.getFile();\n' +
            '  var buf=new Uint8Array(await f.arrayBuffer());\n' +
            '  var hex=[];\n' +
            '  var digest=await crypto.subtle.digest("SHA-256", buf);\n' +
            '  new Uint8Array(digest).forEach(function(b){ hex.push(b.toString(16).padStart(2,"0")); });\n' +
            '  var eocd=-1;\n' +
            '  for (var i=Math.max(0,buf.length-65557); i<buf.length-3; i++) {\n' +
            '    if (buf[i]===0x50 && buf[i+1]===0x4B && buf[i+2]===0x05 && buf[i+3]===0x06) { eocd=i; break; }\n' +
            '  }\n' +
            '  return { size:f.size, pk:[buf[0],buf[1],buf[2],buf[3]], sha:hex.join(""), name:f.name, eocd:eocd };\n' +
            '})()',
            true,
            200000
        ).then(function (got) {
            pass(label + ' PK zip header', !!(got && got.pk && got.pk[0] === 80 && got.pk[1] === 75 && got.pk[2] === 3 && got.pk[3] === 4), JSON.stringify(got && got.pk));
            pass(label + ' zip end-of-central-directory', !!(got && got.eocd >= 0), got && got.eocd);
            pass(label + ' sha256 matches original', !!(got && got.sha === expectSha), got && got.sha);
            pass(label + ' size matches', !!(got && got.size === fs.statSync(filePath).size), got && got.size);
            return code;
        });
    });
}

function main() {
    console.log('=== trial: Fast Pass zip upload+download (BUILD ' + BUILD + ') ===\n');
    pass('big zip exists (>8 MB chips)', fs.existsSync(ZIP_BIG) && fs.statSync(ZIP_BIG).size > 8 * 1024 * 1024, ZIP_BIG + ' ' + (fs.existsSync(ZIP_BIG) ? fs.statSync(ZIP_BIG).size : 0));
    if (!SKIP_SMALL) pass('small zip exists', fs.existsSync(ZIP_SMALL), ZIP_SMALL);
    pass('big zip PK', pkOk(ZIP_BIG));
    if (!SKIP_SMALL) pass('small zip PK', pkOk(ZIP_SMALL));
    var bigSha = sha(ZIP_BIG);
    var smallSha = SKIP_SMALL ? '' : sha(ZIP_SMALL);
    var bigLabel = (fs.statSync(ZIP_BIG).size / (1024 * 1024)).toFixed(1) + 'MB zip chips';
    var sb = readSbConfig(fs.readFileSync(path.join(root, 'app.js'), 'utf8'));
    var codes = [];
    var profile = path.join(os.tmpdir(), 'cs-filexfer-zip-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    fs.mkdirSync(profile, { recursive: true });
    var hosted = 'http://127.0.0.1:' + PAGE_PORT + '/index.html?_lr=' + BUILD + '-zip';
    proc = child_process.spawn(CHROME, [
        '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + profile,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--window-size=1200,800',
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
            }).then(function () { return cdp.call('DOM.enable'); }).then(function () {
                return cdp.call('Page.navigate', { url: hosted });
            }).then(function () { return sleep(2500); }).then(function () {
                return cdp.js(
                    'new Promise(function(resolve){ var n=0; (function tick(){ if (window.FILEXFER && FILEXFER.open) return resolve(window.__JSM_BUILD); if(++n>40) return resolve(""); setTimeout(tick,250); })(); })',
                    true, 15000
                );
            }).then(function (build) {
                pass('live BUILD', build === BUILD, build);
                return cdp.js('window.currentUserId="fx-trial"; FILEXFER.open(); "ok"', false, 8000)
                    .then(function () { return sleep(400); })
                    .then(function () { return roundTrip(cdp, ZIP_BIG, bigSha, bigLabel); });
            }).then(function (code) {
                codes.push(code);
                if (SKIP_SMALL) return;
                return cdp.js('window.currentUserId="fx-trial"; FILEXFER.open(); "ok"', false, 8000)
                    .then(function () { return sleep(400); })
                    .then(function () { return roundTrip(cdp, ZIP_SMALL, smallSha, 'small zip'); })
                    .then(function (code) {
                        codes.push(code);
                    });
            });
        }).catch(function (err) {
            pass('zip round-trip', false, err.message || String(err));
        }).then(function () {
            try { if (ws) ws.close(); } catch (e) {}
            try { if (proc && !proc.killed) proc.kill(); } catch (e2) {}
            var chain = Promise.resolve();
            codes.forEach(function (c) {
                chain = chain.then(function () { return cleanupPass(sb, c); });
            });
            return chain;
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
