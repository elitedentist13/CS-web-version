/**
 * Live Fast Pass round-trip: send a >1 GB file from the page, then receive it.
 * Run: node scripts/filexfer-1gb-roundtrip-trial.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var os = require('os');
var child_process = require('child_process');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-file-transfer.js'))) root = process.cwd();

var BUILD = '20261006fx60';
var CDP_PORT = 9376;
var PAGE_PORT = 5500;
var CHROME = process.env.CHROME_PATH || (
    fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
        ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
        : 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
);
var PART_SIZE = 8 * 1024 * 1024;
var PART_CONCUR = 6;
var TRIAL_SIZE = 1024 * 1024 * 1024 + 32 * 1024 * 1024;
var HEAD = Buffer.from('FXTRIAL1GBHEAD!!');
var TAIL = Buffer.from('FXTRIAL1GBTAIL!!');
var TRIAL_DIR = path.join(os.tmpdir(), 'cs-fx-1gb-trial');
var SEND_FILE = path.join(TRIAL_DIR, 'fx-trial-1gb.bin');
var RECV_FILE = path.join(TRIAL_DIR, 'fx-trial-1gb-recv.bin');
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
            if (Date.now() > deadline) throw new Error('timeout ' + url + ' last=' + (last && last.message));
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

function sbHeaders(key, extra) {
    var h = {
        apikey: key,
        Authorization: 'Bearer ' + key
    };
    Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
    return h;
}

function rest(sb, method, table, qs, body) {
    var url = sb.url.replace(/\/$/, '') + '/rest/v1/' + table + (qs ? '?' + qs : '');
    var opts = {
        method: method,
        headers: sbHeaders(sb.key, {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        })
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(url, opts).then(function (r) {
        return r.text().then(function (t) {
            var json = null;
            try { json = JSON.parse(t); } catch (e) {}
            return { status: r.status, json: json, raw: t.slice(0, 400) };
        });
    });
}

function signUpload(sb, objectPath) {
    var url = sb.url.replace(/\/$/, '') + '/storage/v1/object/upload/sign/clinic-pass/' +
        objectPath.split('/').map(encodeURIComponent).join('/');
    return fetch(url, {
        method: 'POST',
        headers: sbHeaders(sb.key, { 'Content-Type': 'application/json' }),
        body: '{}'
    }).then(function (r) {
        return r.json().then(function (j) {
            if (!r.ok) throw new Error('sign upload ' + r.status + ' ' + JSON.stringify(j));
            var signed = (j && (j.signedUrl || j.url || (j.data && (j.data.signedUrl || j.data.url)))) || '';
            if (!signed) throw new Error('no signed upload url ' + JSON.stringify(j));
            if (signed.indexOf('http') !== 0) {
                signed = sb.url.replace(/\/$/, '') + '/storage/v1' + (signed.charAt(0) === '/' ? signed : '/' + signed);
            }
            try { signed = new URL(signed).href; } catch (e) { signed = signed.replace(/ /g, '%20'); }
            return signed;
        });
    });
}

function putFileSlice(url, filePath, start, end) {
    return new Promise(function (resolve, reject) {
        var fd = fs.openSync(filePath, 'r');
        var len = end - start;
        var buf = Buffer.alloc(len);
        fs.read(fd, buf, 0, len, start, function (err) {
            fs.closeSync(fd);
            if (err) return reject(err);
            fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' },
                body: buf
            }).then(function (r) {
                if (!r.ok) return r.text().then(function (t) {
                    throw new Error('PUT ' + r.status + ' ' + t.slice(0, 180));
                });
                resolve();
            }).catch(reject);
        });
    });
}

function mapLimit(items, limit, worker) {
    return new Promise(function (resolve, reject) {
        var i = 0;
        var active = 0;
        var out = [];
        function kick() {
            while (active < limit && i < items.length) {
                (function (idx) {
                    active += 1;
                    Promise.resolve(worker(items[idx], idx)).then(function (v) {
                        out[idx] = v;
                        active -= 1;
                        if (i >= items.length && active === 0) resolve(out);
                        else kick();
                    }).catch(reject);
                }(i++));
            }
        }
        if (!items.length) resolve(out);
        else kick();
    });
}

function nodeUpload(sb, filePath) {
    var st = fs.statSync(filePath);
    var n = Math.ceil(st.size / PART_SIZE);
    var code = 'T' + Math.random().toString(36).slice(2, 5).toUpperCase();
    var jobs = [];
    var i;
    for (i = 0; i < n; i++) jobs.push(i);
    console.log('Node upload ' + n + ' chips of 8 MB, code seed ' + code);
    return rest(sb, 'GET', 'clinic_file_passes', 'select=id&pass_code=eq.' + code).then(function () {
        return mapLimit(jobs, PART_CONCUR, function (partIdx) {
            var start = partIdx * PART_SIZE;
            var end = Math.min(start + PART_SIZE, st.size);
            var pth = code + '/p' + ('000' + partIdx).slice(-3) + '.bin';
            return signUpload(sb, pth).then(function (url) {
                return putFileSlice(url, filePath, start, end).then(function () { return pth; });
            }).then(function (pthDone) {
                if (partIdx % 10 === 0 || partIdx === n - 1) {
                    console.log('  uploaded chip ' + (partIdx + 1) + '/' + n);
                }
                return pthDone;
            });
        });
    }).then(function (parts) {
        var manPath = code + '/manifest.json';
        var man = JSON.stringify({
            v: 1,
            name: path.basename(filePath),
            size: st.size,
            type: 'application/octet-stream',
            parts: parts
        });
        return signUpload(sb, manPath).then(function (url) {
            return fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'x-upsert': 'false' },
                body: man
            }).then(function (r) {
                if (!r.ok) throw new Error('manifest PUT ' + r.status);
                return manPath;
            });
        }).then(function (storedPath) {
            var row = {
                pass_code: code,
                file_name: path.basename(filePath),
                file_size: st.size,
                mime_type: 'application/octet-stream',
                storage_path: storedPath,
                note: 'agent 1gb roundtrip trial',
                from_clinic_label: 'Joyful Smile',
                expires_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
            };
            return rest(sb, 'POST', 'clinic_file_passes', '', row).then(function (ins) {
                if (ins.status >= 300) throw new Error('insert ' + ins.status + ' ' + ins.raw);
                var rec = Array.isArray(ins.json) ? ins.json[0] : ins.json;
                if (rec && rec.pass_code) row.pass_code = rec.pass_code;
                if (rec && rec.id) row.id = rec.id;
                return row;
            });
        });
    });
}

function nodeDownload(sb, storagePath, saveName, destPath) {
    var url = sb.url.replace(/\/$/, '') + '/storage/v1/object/sign/clinic-pass/' +
        storagePath.split('/').map(encodeURIComponent).join('/');
    return fetch(url, {
        method: 'POST',
        headers: sbHeaders(sb.key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn: 14400, download: saveName || true })
    }).then(function (r) {
        return r.json().then(function (j) {
            if (!r.ok) throw new Error('sign ' + r.status + ' ' + JSON.stringify(j));
            var signed = (j && (j.signedURL || j.signedUrl || (j.data && (j.data.signedUrl || j.data.signedURL)))) || '';
            if (!signed) throw new Error('no signed url ' + JSON.stringify(j));
            if (signed.indexOf('http') !== 0) {
                signed = sb.url.replace(/\/$/, '') + '/storage/v1' + (signed.charAt(0) === '/' ? signed : '/' + signed);
            }
            try { signed = new URL(signed).href; } catch (e) { signed = signed.replace(/ /g, '%20'); }
            return signed;
        });
    }).then(function (signed) {
        if (/\/manifest\.json$/i.test(storagePath)) {
            return fetch(signed).then(function (r) {
                if (!r.ok) throw new Error('manifest get ' + r.status);
                return r.json();
            }).then(function (man) {
                var parts = (man && man.parts) || [];
                var ws = fs.createWriteStream(destPath);
                var chain = Promise.resolve();
                parts.forEach(function (p) {
                    chain = chain.then(function () {
                        return nodeDownloadOne(sb, p, destPath, ws);
                    });
                });
                return chain.then(function () {
                    return new Promise(function (resolve, reject) {
                        ws.end(function (err) { if (err) reject(err); else resolve(destPath); });
                    });
                });
            });
        }
        return fetch(signed).then(function (r) {
            if (!r.ok) throw new Error('download ' + r.status);
            var ws = fs.createWriteStream(destPath);
            return new Promise(function (resolve, reject) {
                r.body.pipeTo(new WritableStream({
                    write: function (chunk) { ws.write(Buffer.from(chunk)); },
                    close: function () { ws.end(function () { resolve(destPath); }); },
                    abort: function (e) { reject(e); }
                })).catch(function () {
                    return r.arrayBuffer().then(function (ab) {
                        fs.writeFileSync(destPath, Buffer.from(ab));
                        resolve(destPath);
                    });
                });
            });
        });
    });
}

function nodeDownloadOne(sb, objectPath, destPath, ws) {
    var url = sb.url.replace(/\/$/, '') + '/storage/v1/object/sign/clinic-pass/' +
        objectPath.split('/').map(encodeURIComponent).join('/');
    return fetch(url, {
        method: 'POST',
        headers: sbHeaders(sb.key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn: 14400 })
    }).then(function (r) {
        return r.json().then(function (j) {
            var signed = (j && (j.signedURL || j.signedUrl || (j.data && (j.data.signedUrl || j.data.signedURL)))) || '';
            if (signed.indexOf('http') !== 0) {
                signed = sb.url.replace(/\/$/, '') + '/storage/v1' + (signed.charAt(0) === '/' ? signed : '/' + signed);
            }
            try { signed = new URL(signed).href; } catch (e) {}
            return fetch(signed).then(function (res) {
                if (!res.ok) throw new Error('part ' + objectPath + ' ' + res.status);
                return res.arrayBuffer();
            }).then(function (ab) {
                ws.write(Buffer.from(ab));
            });
        });
    });
}

function verifyFile(p, expectedSize) {
    var st = fs.statSync(p);
    var fd = fs.openSync(p, 'r');
    var h = Buffer.alloc(16);
    var t = Buffer.alloc(16);
    fs.readSync(fd, h, 0, 16, 0);
    fs.readSync(fd, t, 0, 16, st.size - 16);
    fs.closeSync(fd);
    return {
        size: st.size,
        sizeOk: st.size === expectedSize,
        headOk: h.equals(HEAD),
        tailOk: t.equals(TAIL),
        head: h.toString(),
        tail: t.toString()
    };
}

function killChrome() {
    try { if (ws) ws.close(); } catch (e) {}
    try { if (proc && !proc.killed) proc.kill(); } catch (e2) {}
}

function startChrome() {
    var profile = path.join(os.tmpdir(), 'cs-filexfer-1gb-cdp');
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    fs.mkdirSync(profile, { recursive: true });
    var hosted = 'http://127.0.0.1:' + PAGE_PORT + '/index.html?_lr=' + BUILD + '-1gb';
    proc = child_process.spawn(CHROME, [
        '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + profile,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-sync',
        '--window-size=1280,900',
        hosted
    ], { stdio: 'ignore' });
    return waitJson('http://127.0.0.1:' + CDP_PORT + '/json/version', 20000).then(function () {
        return waitJson('http://127.0.0.1:' + CDP_PORT + '/json/list', 8000);
    }).then(function (tabs) {
        var tab = (tabs || []).find(function (t) {
            return t.type === 'page' && String(t.url || '').indexOf('devtools://') < 0;
        });
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
                return cdp.call('DOM.enable');
            }).then(function () {
                return cdp.call('Page.navigate', { url: hosted });
            }).then(function () {
                return sleep(2500);
            }).then(function () { return cdp; });
        });
    });
}

function waitReady(cdp) {
    return cdp.js(
        'new Promise(function(resolve){ var n=0; (function tick(){ n+=1; if (window.FILEXFER && typeof FILEXFER.open==="function") return resolve({ok:true,n:n,build:window.__JSM_BUILD}); if (n>40) return resolve({ok:false,n:n,build:window.__JSM_BUILD}); setTimeout(tick,250); })(); })',
        true,
        15000
    );
}

function attachFile(cdp, filePath) {
    return cdp.call('DOM.getDocument', { depth: 0 }).then(function (doc) {
        return cdp.call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fx_file' });
    }).then(function (q) {
        if (!q || !q.nodeId) throw new Error('fx_file input missing');
        return cdp.call('DOM.setFileInputFiles', { nodeId: q.nodeId, files: [filePath] });
    });
}

function pollSend(cdp, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var lastPct = '';
    function tick() {
        return cdp.js(
            '(function(){ var code=document.getElementById("fx_code_out"); var bar=document.getElementById("fx_prog_bar"); var st=document.getElementById("fx_status"); var note=document.getElementById("fx_wait_note"); return { code: code && code.textContent, bar: bar && bar.style.width, status: st && st.textContent, noteOn: !!(note && note.style.display==="block"), fail: !!(st && /fx-status--bad/.test(st.className) && st.textContent) }; })()',
            false,
            10000
        ).then(function (s) {
            if (s && s.bar && s.bar !== lastPct) {
                lastPct = s.bar;
                console.log('  send ' + s.bar + (s.status ? '  ' + s.status : ''));
            }
            if (s && s.code && String(s.code).replace(/\s/g, '').length >= 4) return s;
            if (s && s.fail) throw new Error('send failed: ' + s.status);
            if (Date.now() > deadline) throw new Error('send timeout last=' + JSON.stringify(s));
            return sleep(4000).then(tick);
        });
    }
    return tick();
}

function pollRecv(cdp, timeoutMs) {
    var deadline = Date.now() + timeoutMs;
    var lastPct = '';
    function tick() {
        return cdp.js(
            '(function(){ var bar=document.getElementById("fx_prog_bar"); var st=document.getElementById("fx_status"); return { bar: bar && bar.style.width, status: st && st.textContent, ok: !!(st && /downloadOk|saved|Download complete/i.test(st.textContent||"") || (bar && bar.style.width==="100%")), fail: !!(st && /fx-status--bad/.test(st.className) && st.textContent) }; })()',
            false,
            10000
        ).then(function (s) {
            if (s && s.bar && s.bar !== lastPct) {
                lastPct = s.bar;
                console.log('  recv ' + s.bar + (s.status ? '  ' + s.status : ''));
            }
            if (s && s.ok) return s;
            if (s && s.fail) throw new Error('recv failed: ' + s.status);
            if (Date.now() > deadline) throw new Error('recv timeout last=' + JSON.stringify(s));
            return sleep(4000).then(tick);
        });
    }
    return tick();
}

function cleanupPass(sb, row) {
    if (!row) return Promise.resolve();
    var delRow = row.id
        ? rest(sb, 'DELETE', 'clinic_file_passes', 'id=eq.' + row.id)
        : rest(sb, 'DELETE', 'clinic_file_passes', 'pass_code=eq.' + row.pass_code);
    var prefix = String(row.storage_path || '').replace(/\/manifest\.json$/i, '');
    var listUrl = sb.url.replace(/\/$/, '') + '/storage/v1/object/list/clinic-pass';
    return fetch(listUrl, {
        method: 'POST',
        headers: sbHeaders(sb.key, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefix: prefix + '/', limit: 200 })
    }).then(function (r) { return r.json(); }).then(function (files) {
        var names = Array.isArray(files) ? files.map(function (f) {
            return prefix + '/' + f.name;
        }) : [];
        if (row.storage_path && names.indexOf(row.storage_path) < 0) names.push(row.storage_path);
        if (!names.length) return;
        return fetch(sb.url.replace(/\/$/, '') + '/storage/v1/object/clinic-pass', {
            method: 'DELETE',
            headers: sbHeaders(sb.key, { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ prefixes: names })
        });
    }).then(function () { return delRow; }).catch(function (e) {
        console.log('cleanup note: ' + (e && e.message));
    });
}

function main() {
    console.log('=== trial: Fast Pass send+receive >1 GB (BUILD ' + BUILD + ') ===\n');
    var appJs = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    var sb = readSbConfig(appJs);
    var st = fs.statSync(SEND_FILE);
    pass('trial payload exists', st.size === TRIAL_SIZE, st.size + ' bytes');
    var markers = verifyFile(SEND_FILE, TRIAL_SIZE);
    pass('trial payload markers', markers.headOk && markers.tailOk, markers.head + ' / ' + markers.tail);

    var row = null;
    var via = '';
    return startChrome().then(function (cdp) {
        return waitReady(cdp).then(function (ready) {
            pass('live FILEXFER ready', !!(ready && ready.ok), ready && ready.build);
            return cdp.js(
                '(function(){ window.currentUserId="fx-trial"; window.currentName="fx-trial"; FILEXFER.open(); return { build: window.__JSM_BUILD, picker: typeof window.showSaveFilePicker }; })()',
                false,
                10000
            );
        }).then(function (opened) {
            pass('live BUILD', opened && opened.build === BUILD, opened && opened.build);
            pass('save picker present', opened && opened.picker === 'function', opened && opened.picker);
            return sleep(400).then(function () { return attachFile(cdp, SEND_FILE); });
        }).then(function () {
            return cdp.js(
                '(function(){ var n=document.getElementById("fx_fname"); var inp=document.getElementById("fx_file"); var note=document.getElementById("fx_note"); if(note) note.value="agent 1gb roundtrip trial"; return { fname: n && n.textContent, files: inp && inp.files && inp.files[0] && inp.files[0].size }; })()',
                false,
                10000
            );
        }).then(function (attached) {
            pass('page attached >1 GB file', !!(attached && attached.files === TRIAL_SIZE), JSON.stringify(attached));
            return cdp.js('document.getElementById("fx_send") && document.getElementById("fx_send").click(); "clicked"', false, 5000);
        }).then(function () {
            console.log('Sending via live page…');
            return pollSend(cdp, 40 * 60 * 1000);
        }).then(function (sent) {
            via = 'chrome-page';
            var code = String(sent.code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
            pass('live send produced a Fast Pass code', code.length >= 4, code);
            return rest(sb, 'GET', 'clinic_file_passes',
                'select=id,pass_code,file_name,file_size,storage_path,note&pass_code=eq.' + code
            ).then(function (r) {
                row = r.json && r.json[0];
                pass('API row after send', !!(row && Number(row.file_size) === TRIAL_SIZE),
                    row ? (row.pass_code + ' ' + row.file_size + ' ' + row.storage_path) : r.raw);
                return { cdp: cdp, code: code };
            });
        }).catch(function (err) {
            pass('live page send', false, err.message || String(err));
            console.log('Falling back to Node chip upload…');
            return nodeUpload(sb, SEND_FILE).then(function (created) {
                via = 'node-fallback';
                row = created;
                pass('Node send produced a Fast Pass', !!(row && row.pass_code), row && (row.pass_code + ' ' + row.storage_path));
                return { cdp: cdp, code: row.pass_code };
            });
        });
    }).then(function (ctx) {
        var cdp = ctx.cdp;
        var code = ctx.code;
        return cdp.js(
            '(async function(){\n' +
            '  window.currentUserId="fx-trial"; window.currentName="fx-trial";\n' +
            '  window.showSaveFilePicker = function(opts){\n' +
            '    return navigator.storage.getDirectory().then(function(root){\n' +
            '      return root.getFileHandle((opts && opts.suggestedName) || "fx-trial-1gb.bin", { create: true });\n' +
            '    });\n' +
            '  };\n' +
            '  FILEXFER.open();\n' +
            '  await new Promise(function(r){ setTimeout(r, 200); });\n' +
            '  var recv = document.querySelector("[data-fx=\\"receive\\"]");\n' +
            '  if (recv) recv.click();\n' +
            '  await new Promise(function(r){ setTimeout(r, 200); });\n' +
            '  var inp = document.getElementById("fx_in_code");\n' +
            '  if (inp) { inp.value = ' + JSON.stringify(code) + '; }\n' +
            '  var btn = document.getElementById("fx_lookup");\n' +
            '  if (btn) btn.click();\n' +
            '  return { code: inp && inp.value, recvTab: !!recv };\n' +
            '})()',
            true,
            20000
        ).then(function (look) {
            pass('live receive lookup started', !!(look && look.recvTab), JSON.stringify(look));
            return sleep(8500);
        }).then(function () {
            return cdp.js(
                '(function(){ var dl=document.getElementById("fx_dl"); var name=document.querySelector(".fx-pass-name"); return { dl: !!dl, name: name && name.textContent, meta: (document.querySelector(".fx-pass-meta")||{}).textContent }; })()',
                false,
                10000
            );
        }).then(function (card) {
            pass('live receive card shows the trial file', !!(card && card.dl), JSON.stringify(card));
            return cdp.js(
                'document.getElementById("fx_dl") && document.getElementById("fx_dl").click(); "dl-clicked"',
                false,
                5000
            );
        }).then(function () {
            console.log('Receiving via live page (OPFS picker stub + pipeTo)…');
            return pollRecv(cdp, 40 * 60 * 1000);
        }).then(function (recv) {
            pass('live receive reached completion UI', !!recv, JSON.stringify(recv));
            return cdp.js(
                '(async function(){\n' +
                '  var root = await navigator.storage.getDirectory();\n' +
                '  var names = [];\n' +
                '  for await (var e of root.values()) names.push({name:e.name, kind:e.kind});\n' +
                '  var handle;\n' +
                '  try { handle = await root.getFileHandle("fx-trial-1gb.bin"); } catch(e) {}\n' +
                '  if (!handle) return { names: names, missing: true };\n' +
                '  var f = await handle.getFile();\n' +
                '  var head = new Uint8Array(await f.slice(0, 16).arrayBuffer());\n' +
                '  var tail = new Uint8Array(await f.slice(f.size-16).arrayBuffer());\n' +
                '  return { names: names, size: f.size, head: Array.from(head), tail: Array.from(tail) };\n' +
                '})()',
                true,
                30000
            );
        }).then(function (opfs) {
            var headBuf = opfs && opfs.head ? Buffer.from(opfs.head) : Buffer.alloc(0);
            var tailBuf = opfs && opfs.tail ? Buffer.from(opfs.tail) : Buffer.alloc(0);
            pass('live OPFS file size matches send', !!(opfs && opfs.size === TRIAL_SIZE), opfs && (opfs.size + ' names=' + JSON.stringify(opfs.names)));
            pass('live OPFS head marker', headBuf.equals(HEAD), headBuf.toString());
            pass('live OPFS tail marker', tailBuf.equals(TAIL), tailBuf.toString());
        }).catch(function (err) {
            pass('live page receive', false, err.message || String(err));
        }).then(function () { return ctx; });
    }).then(function (ctx) {
        if (!row) throw new Error('no pass row to download');
        console.log('Node disk receive from bucket…');
        try { if (fs.existsSync(RECV_FILE)) fs.unlinkSync(RECV_FILE); } catch (e) {}
        return nodeDownload(sb, row.storage_path, row.file_name, RECV_FILE).then(function () {
            var v = verifyFile(RECV_FILE, TRIAL_SIZE);
            pass('disk receive size', v.sizeOk, v.size + ' expected ' + TRIAL_SIZE);
            pass('disk receive head marker', v.headOk, v.head);
            pass('disk receive tail marker', v.tailOk, v.tail);
        });
    }).then(function () {
        return cleanupPass(sb, row).then(function () {
            pass('cleanup attempted for trial pass', true, row && row.pass_code);
        });
    }).catch(function (err) {
        pass('round-trip', false, err.message || String(err));
    }).then(function () {
        killChrome();
        console.log('\nvia=' + (via || 'none') + (row ? ' pass=' + row.pass_code : ''));
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
