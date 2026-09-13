// ════════════════════════════════════════════════════════════════
// app-file-transfer.js — Clinic Fast Pass (Tools → File Transfer)
// Send one file (up to 500 MB) to another Banana clinic. 3-day expiry.
// Requires clinic_file_passes.sql in Supabase (table + clinic-pass bucket).
// ════════════════════════════════════════════════════════════════
var FILEXFER = (function () {
    'use strict';

    var BUCKET = 'clinic-pass';
    var TABLE = 'clinic_file_passes';
    var MAX_BYTES = 500 * 1024 * 1024;
    var EXPIRE_MS = 3 * 24 * 60 * 60 * 1000;
    var CODE_ALPH = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
    var TAB = 'send';
    var chosenFile = null;
    var lastCreated = null;

    function trKey(key, fallback) {
        return (typeof t === 'function') ? t(key) : (fallback || key);
    }
    function trReplKey(key, vars, fallback) {
        if (typeof trRepl === 'function') return trRepl(key, vars);
        var s = trKey(key, fallback || key);
        Object.keys(vars || {}).forEach(function (k) {
            s = s.split('{' + k + '}').join(vars[k]);
        });
        return s;
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }
    function gg(id) { return document.getElementById(id); }

    function fmtSize(n) {
        var b = Number(n) || 0;
        if (b < 1024) return b + ' B';
        if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
        return (b / (1024 * 1024)).toFixed(1) + ' MB';
    }
    function fmtWhen(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return String(iso);
        if (typeof fmtDateLong === 'function') {
            var datePart = fmtDateLong(d.toISOString().slice(0, 10));
            var hh = ('0' + d.getHours()).slice(-2);
            var mm = ('0' + d.getMinutes()).slice(-2);
            return datePart + ' ' + hh + ':' + mm;
        }
        return d.toLocaleString();
    }
    function displayCode(raw) {
        var s = String(raw || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        if (s.length === 8) return s.slice(0, 4) + '-' + s.slice(4);
        return s;
    }
    function normalizeCode(raw) {
        return String(raw || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    }
    function clinicList() {
        if (typeof clinicsForWorkingSession === 'function') return clinicsForWorkingSession();
        return (typeof APP_CLINICS !== 'undefined' && APP_CLINICS) ? APP_CLINICS : [];
    }
    function clinicLabel(c) {
        if (!c) return '';
        return String(c.english_name || c.clinic_code || c.id || '').trim();
    }
    function clinicLabelById(id) {
        if (!id) return '';
        if (typeof clinicRecordFromId === 'function') return clinicLabel(clinicRecordFromId(id));
        return '';
    }
    function myClinicId() {
        return (typeof currentClinicId !== 'undefined' && currentClinicId) ? String(currentClinicId) : '';
    }
    function myClinicLabel() {
        if (typeof currentClinicLabel === 'string' && currentClinicLabel) return currentClinicLabel;
        return clinicLabelById(myClinicId()) || 'Clinic';
    }
    function senderName() {
        return (typeof currentName === 'string' && currentName)
            || (typeof currentUserId === 'string' && currentUserId)
            || '';
    }
    function isLoggedIn() {
        return !!(typeof currentUserId !== 'undefined' && currentUserId);
    }
    function isMissingTable(err) {
        var msg = String((err && (err.message || err.details || err)) || '').toLowerCase();
        return msg.indexOf(TABLE) >= 0 || msg.indexOf('clinic-pass') >= 0 ||
            msg.indexOf('does not exist') >= 0 || msg.indexOf('not found') >= 0 ||
            (err && (err.code === '42P01' || err.statusCode === '404' || err.status === 404));
    }
    function status(msg, tone) {
        var el = gg('fx_status');
        if (!el) return;
        el.style.display = msg ? 'block' : 'none';
        el.className = 'ct-status' + (tone ? ' ct-tone-' + tone : '');
        el.innerHTML = (tone === 'work' ? '<span class="ct-spin"></span> ' : '') + esc(msg || '');
    }
    function setProgress(pct) {
        var bar = gg('fx_prog_bar');
        if (bar) bar.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
        var wrap = gg('fx_prog');
        if (wrap) wrap.style.display = pct > 0 && pct < 100 ? '' : (pct >= 100 ? '' : 'none');
    }

    function makeCode() {
        var out = '';
        var i;
        if (window.crypto && crypto.getRandomValues) {
            var buf = new Uint8Array(8);
            crypto.getRandomValues(buf);
            for (i = 0; i < 8; i++) out += CODE_ALPH.charAt(buf[i] % CODE_ALPH.length);
            return out;
        }
        for (i = 0; i < 8; i++) out += CODE_ALPH.charAt(Math.floor(Math.random() * CODE_ALPH.length));
        return out;
    }
    function safeFilePart(name) {
        return String(name || 'file').replace(/[^\w.\-()+ ]+/g, '_').slice(0, 80) || 'file';
    }

    function open() {
        if (typeof showOnly === 'function') showOnly('fileTransferSection');
        render();
        sweepExpired();
    }

    function render() {
        var app = gg('fileTransferApp');
        if (!app) return;
        app.innerHTML =
            '<div class="fx-layout">' +
                '<p class="ct-intro">' + esc(trKey('filexfer.intro')) + '</p>' +
                '<div class="ct-seg" id="fx_tabs">' +
                    tabBtn('send', '📤 ' + trKey('filexfer.tabSend')) +
                    tabBtn('receive', '📥 ' + trKey('filexfer.tabReceive')) +
                    tabBtn('mine', '📋 ' + trKey('filexfer.tabMine')) +
                '</div>' +
                '<div id="fx_panel" class="ct-panel-box"></div>' +
                '<div id="fx_status" class="ct-status" style="display:none;"></div>' +
            '</div>';
        wireTabs();
        renderPanel();
    }
    function tabBtn(id, label) {
        return '<button type="button" class="ct-seg-btn' + (id === TAB ? ' active' : '') +
            '" data-fx="' + id + '">' + esc(label) + '</button>';
    }
    function wireTabs() {
        var box = gg('fx_tabs');
        if (!box) return;
        box.addEventListener('click', function (e) {
            var b = e.target.closest('[data-fx]');
            if (!b) return;
            TAB = b.getAttribute('data-fx');
            lastCreated = null;
            box.querySelectorAll('.ct-seg-btn').forEach(function (x) {
                x.classList.toggle('active', x === b);
            });
            renderPanel();
        });
    }

    function destOptions() {
        var html = '<option value="">' + esc(trKey('filexfer.destAny')) + '</option>';
        clinicList().forEach(function (c) {
            if (!c || !c.id) return;
            html += '<option value="' + esc(String(c.id)) + '">' + esc(clinicLabel(c)) + '</option>';
        });
        return html;
    }

    function renderPanel() {
        var p = gg('fx_panel');
        if (!p) return;
        if (TAB === 'send') renderSend(p);
        else if (TAB === 'receive') renderReceive(p);
        else renderMine(p);
    }

    function renderSend(p) {
        if (lastCreated) {
            p.innerHTML =
                '<p>' + esc(trKey('filexfer.sendOk')) + '</p>' +
                '<div class="fx-code-box">' +
                    '<div class="fx-code" id="fx_code_out">' + esc(displayCode(lastCreated.pass_code)) + '</div>' +
                    '<button type="button" class="ct-btn ct-btn-primary" id="fx_copy">' +
                        esc(trKey('filexfer.copy')) + '</button>' +
                '</div>' +
                '<p class="ct-note">' + esc(trReplKey('filexfer.expires', { WHEN: fmtWhen(lastCreated.expires_at) })) +
                    (lastCreated.file_name ? ' · ' + esc(lastCreated.file_name) : '') + '</p>' +
                '<div class="fx-actions">' +
                    '<button type="button" class="ct-btn" id="fx_again">' + esc(trKey('filexfer.sendAnother')) + '</button>' +
                '</div>';
            gg('fx_copy').addEventListener('click', function () {
                copyText(displayCode(lastCreated.pass_code), gg('fx_copy'));
            });
            gg('fx_again').addEventListener('click', function () {
                lastCreated = null;
                chosenFile = null;
                renderPanel();
            });
            return;
        }
        var fname = chosenFile ? chosenFile.name + ' · ' + fmtSize(chosenFile.size) : '';
        p.innerHTML =
            '<label class="fx-drop" id="fx_drop">' +
                esc(trKey('filexfer.fileHint')) +
                '<div class="fx-file-name" id="fx_fname">' + esc(fname) + '</div>' +
                '<input id="fx_file" type="file">' +
            '</label>' +
            '<label class="ct-field"><span>' + esc(trKey('filexfer.dest')) + '</span>' +
                '<select id="fx_dest" class="ct-select">' + destOptions() + '</select></label>' +
            '<label class="ct-field"><span>' + esc(trKey('filexfer.note')) + '</span>' +
                '<input id="fx_note" type="text" maxlength="200" placeholder="' +
                    esc(trKey('filexfer.notePh')) + '"></label>' +
            '<div id="fx_prog" class="fx-progress" style="display:none;"><span id="fx_prog_bar"></span></div>' +
            '<button type="button" class="ct-btn ct-btn-primary" id="fx_send">' +
                esc(trKey('filexfer.sendBtn')) + '</button>';
        wireDrop();
        var dest = gg('fx_dest');
        var mine = myClinicId();
        if (dest && mine) {
            var opts = dest.options;
            for (var i = 0; i < opts.length; i++) {
                if (opts[i].value && opts[i].value !== mine) {
                    dest.value = opts[i].value;
                    break;
                }
            }
        }
        gg('fx_send').addEventListener('click', doSend);
    }

    function wireDrop() {
        var drop = gg('fx_drop');
        var inp = gg('fx_file');
        if (!drop || !inp) return;
        function take(file) {
            if (!file) return;
            if (file.size > MAX_BYTES) {
                status(trKey('filexfer.tooBig'), 'bad');
                chosenFile = null;
                return;
            }
            chosenFile = file;
            var nameEl = gg('fx_fname');
            if (nameEl) nameEl.textContent = file.name + ' · ' + fmtSize(file.size);
            status('', '');
        }
        inp.addEventListener('change', function () {
            take(inp.files && inp.files[0]);
        });
        drop.addEventListener('dragover', function (e) {
            e.preventDefault();
            drop.classList.add('is-drag');
        });
        drop.addEventListener('dragleave', function () { drop.classList.remove('is-drag'); });
        drop.addEventListener('drop', function (e) {
            e.preventDefault();
            drop.classList.remove('is-drag');
            take(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
        });
    }

    function renderReceive(p) {
        p.innerHTML =
            '<label class="ct-field"><span>' + esc(trKey('filexfer.code')) + '</span>' +
                '<input id="fx_in_code" type="text" maxlength="12" placeholder="' +
                    esc(trKey('filexfer.codePh')) + '" autocomplete="off"></label>' +
            '<button type="button" class="ct-btn ct-btn-primary" id="fx_lookup">' +
                esc(trKey('filexfer.lookup')) + '</button>' +
            '<div id="fx_found" style="margin-top:16px;"></div>';
        gg('fx_lookup').addEventListener('click', doLookup);
        gg('fx_in_code').addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); doLookup(); }
        });
    }

    function renderFound(row) {
        var box = gg('fx_found');
        if (!box) return;
        box.innerHTML =
            '<div class="fx-pass-card">' +
                '<div class="fx-pass-name">' + esc(row.file_name || '') + '</div>' +
                '<div class="fx-pass-meta">' +
                    esc(fmtSize(row.file_size)) + ' · ' +
                    esc(trReplKey('filexfer.from', { CLINIC: row.from_clinic_label || '—' })) + '<br>' +
                    esc(trReplKey('filexfer.expires', { WHEN: fmtWhen(row.expires_at) })) +
                    (row.note ? '<br>' + esc(row.note) : '') +
                '</div>' +
                '<div class="fx-actions">' +
                    '<button type="button" class="ct-btn ct-btn-primary" id="fx_dl">' +
                        esc(trKey('filexfer.download')) + '</button>' +
                '</div>' +
            '</div>';
        gg('fx_dl').addEventListener('click', function () { doDownload(row); });
    }

    function renderMine(p) {
        p.innerHTML =
            '<div class="fx-actions" style="margin-top:0;margin-bottom:10px;">' +
                '<button type="button" class="ct-btn" id="fx_mine_refresh">' +
                    esc(trKey('filexfer.refresh')) + '</button>' +
            '</div>' +
            '<div id="fx_mine_list" class="fx-pass-list">' +
                '<p class="ct-note">' + esc(trKey('filexfer.mineEmpty')) + '</p>' +
            '</div>';
        gg('fx_mine_refresh').addEventListener('click', loadMine);
        loadMine();
    }

    function loadMine() {
        var list = gg('fx_mine_list');
        if (!list) return;
        if (typeof SB === 'undefined' || !SB.from) {
            list.innerHTML = '<p class="ct-note">' + esc(trKey('filexfer.setup')) + '</p>';
            return;
        }
        var cid = myClinicId();
        var q = SB.from(TABLE).select('*').gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false }).limit(40);
        if (cid) q = q.or('from_clinic_id.eq.' + cid + ',to_clinic_id.eq.' + cid);
        q.then(function (r) {
            if (r.error) {
                list.innerHTML = '<p class="ct-note">' +
                    esc(isMissingTable(r.error) ? trKey('filexfer.setup') : r.error.message) + '</p>';
                return;
            }
            var rows = r.data || [];
            if (!rows.length) {
                list.innerHTML = '<p class="ct-note">' + esc(trKey('filexfer.mineEmpty')) + '</p>';
                return;
            }
            list.innerHTML = rows.map(function (row) {
                return '<div class="fx-pass-card" data-fx-id="' + esc(row.id) + '">' +
                    '<div class="fx-pass-card-top">' +
                        '<div class="fx-code" style="font-size:18px;">' + esc(displayCode(row.pass_code)) + '</div>' +
                        '<button type="button" class="ct-btn ct-btn-ghost ct-btn-sm fx-del">' +
                            esc(trKey('filexfer.delete')) + '</button>' +
                    '</div>' +
                    '<div class="fx-pass-name">' + esc(row.file_name || '') + '</div>' +
                    '<div class="fx-pass-meta">' +
                        esc(fmtSize(row.file_size)) + ' · ' +
                        esc(trReplKey('filexfer.from', { CLINIC: row.from_clinic_label || '—' })) +
                        (row.to_clinic_label ? ' → ' + esc(row.to_clinic_label) : '') + '<br>' +
                        esc(trReplKey('filexfer.expires', { WHEN: fmtWhen(row.expires_at) })) +
                    '</div></div>';
            }).join('');
            list.querySelectorAll('.fx-del').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var card = btn.closest('[data-fx-id]');
                    var id = card && card.getAttribute('data-fx-id');
                    var row = rows.filter(function (x) { return String(x.id) === String(id); })[0];
                    if (row) deletePass(row);
                });
            });
        });
    }

    function copyText(text, btn) {
        var done = function () {
            if (!btn) return;
            var old = btn.textContent;
            btn.textContent = trKey('filexfer.copied');
            setTimeout(function () { btn.textContent = old; }, 1200);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text); done(); });
        } else {
            fallbackCopy(text);
            done();
        }
    }
    function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        ta.remove();
    }

    function xhrPut(url, file, onPct) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('PUT', url);
            if (file.type) xhr.setRequestHeader('Content-Type', file.type);
            xhr.setRequestHeader('x-upsert', 'false');
            xhr.upload.onprogress = function (e) {
                if (e.lengthComputable && onPct) onPct(Math.round((e.loaded / e.total) * 100));
            };
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) resolve();
                else reject(new Error('Upload failed (' + xhr.status + ')'));
            };
            xhr.onerror = function () { reject(new Error('Network error')); };
            xhr.send(file);
        });
    }

    function uploadFile(path, file, onPct) {
        return SB.storage.from(BUCKET).createSignedUploadUrl(path).then(function (r) {
            if (!r.error && r.data && r.data.signedUrl) {
                return xhrPut(r.data.signedUrl, file, onPct);
            }
            if (onPct) onPct(5);
            return SB.storage.from(BUCKET).upload(path, file, {
                cacheControl: '3600',
                upsert: false,
                contentType: file.type || 'application/octet-stream'
            }).then(function (up) {
                if (up.error) throw up.error;
                if (onPct) onPct(100);
            });
        });
    }

    function uniqueCode() {
        var tries = 0;
        function attempt() {
            var code = makeCode();
            tries += 1;
            return SB.from(TABLE).select('id').eq('pass_code', code).maybeSingle()
                .then(function (r) {
                    if (r.error && isMissingTable(r.error)) throw r.error;
                    if (r.data && r.data.id && tries < 8) return attempt();
                    return code;
                });
        }
        return attempt();
    }

    function doSend() {
        if (!isLoggedIn()) return status(trKey('filexfer.needLogin'), 'bad');
        if (!chosenFile) return status(trKey('filexfer.needFile'), 'bad');
        if (chosenFile.size > MAX_BYTES) return status(trKey('filexfer.tooBig'), 'bad');
        if (typeof SB === 'undefined' || !SB.from) return status(trKey('filexfer.setup'), 'bad');

        var destId = (gg('fx_dest') && gg('fx_dest').value) || '';
        var note = (gg('fx_note') && gg('fx_note').value || '').trim();
        var btn = gg('fx_send');
        if (btn) btn.disabled = true;
        setProgress(1);
        status(trReplKey('filexfer.sending', { PCT: '1' }), 'work');

        var code = '';
        var path = '';
        uniqueCode().then(function (c) {
            code = c;
            path = c + '/' + Date.now() + '_' + safeFilePart(chosenFile.name);
            return uploadFile(path, chosenFile, function (pct) {
                setProgress(pct);
                status(trReplKey('filexfer.sending', { PCT: String(pct) }), 'work');
            });
        }).then(function () {
            var row = {
                pass_code: code,
                file_name: chosenFile.name,
                file_size: chosenFile.size,
                mime_type: chosenFile.type || null,
                storage_path: path,
                note: note || null,
                from_clinic_id: myClinicId() || null,
                from_clinic_label: myClinicLabel(),
                to_clinic_id: destId || null,
                to_clinic_label: destId ? (clinicLabelById(destId) || null) : null,
                created_by: senderName() || null,
                expires_at: new Date(Date.now() + EXPIRE_MS).toISOString()
            };
            return SB.from(TABLE).insert(row).select('*').single().then(function (ins) {
                if (ins.error) throw ins.error;
                return ins.data;
            });
        }).then(function (row) {
            lastCreated = row;
            chosenFile = null;
            setProgress(100);
            status('', '');
            renderPanel();
        }).catch(function (err) {
            setProgress(0);
            status(isMissingTable(err)
                ? trKey('filexfer.setup')
                : trReplKey('filexfer.fail', { MSG: (err && err.message) || String(err) }), 'bad');
            if (path) {
                try { SB.storage.from(BUCKET).remove([path]); } catch (e) {}
            }
        }).then(function () {
            if (btn) btn.disabled = false;
        });
    }

    function doLookup() {
        if (!isLoggedIn()) return status(trKey('filexfer.needLogin'), 'bad');
        var code = normalizeCode(gg('fx_in_code') && gg('fx_in_code').value);
        if (code.length < 6) return status(trKey('filexfer.notFound'), 'bad');
        if (typeof SB === 'undefined' || !SB.from) return status(trKey('filexfer.setup'), 'bad');
        status(trKey('filexfer.lookup') + '…', 'work');
        SB.from(TABLE).select('*').eq('pass_code', code).maybeSingle().then(function (r) {
            if (r.error) {
                status(isMissingTable(r.error) ? trKey('filexfer.setup')
                    : trReplKey('filexfer.fail', { MSG: r.error.message }), 'bad');
                return;
            }
            var row = r.data;
            if (!row) return status(trKey('filexfer.notFound'), 'bad');
            if (new Date(row.expires_at).getTime() <= Date.now()) {
                return status(trKey('filexfer.expired'), 'bad');
            }
            if (row.to_clinic_id && myClinicId() && String(row.to_clinic_id) !== myClinicId()) {
                return status(trReplKey('filexfer.wrongClinic', {
                    CLINIC: row.to_clinic_label || clinicLabelById(row.to_clinic_id) || row.to_clinic_id
                }), 'bad');
            }
            status('', '');
            renderFound(row);
        });
    }

    function doDownload(row) {
        if (!row || !row.storage_path) return;
        status(trKey('filexfer.download') + '…', 'work');
        SB.storage.from(BUCKET).createSignedUrl(row.storage_path, 180).then(function (r) {
            if (r.error || !r.data || !r.data.signedUrl) {
                throw r.error || new Error('signed url');
            }
            var a = document.createElement('a');
            a.href = r.data.signedUrl;
            a.download = row.file_name || 'download';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
            SB.from(TABLE).update({
                download_count: (row.download_count || 0) + 1,
                last_downloaded_at: new Date().toISOString()
            }).eq('id', row.id).then(function () {});
            status('', '');
        }).catch(function (err) {
            status(trReplKey('filexfer.fail', { MSG: (err && err.message) || String(err) }), 'bad');
        });
    }

    function deletePass(row) {
        if (!row) return;
        var chain = Promise.resolve();
        if (row.storage_path) {
            chain = SB.storage.from(BUCKET).remove([row.storage_path]).then(function () {}, function () {});
        }
        chain.then(function () {
            return SB.from(TABLE).delete().eq('id', row.id);
        }).then(function (r) {
            if (r && r.error) throw r.error;
            status(trKey('filexfer.deleted'), 'ok');
            if (TAB === 'mine') loadMine();
        }).catch(function (err) {
            status(trReplKey('filexfer.fail', { MSG: (err && err.message) || String(err) }), 'bad');
        });
    }

    function sweepExpired() {
        if (typeof SB === 'undefined' || !SB.from) return;
        var now = new Date().toISOString();
        SB.from(TABLE).select('id,storage_path').lt('expires_at', now).limit(20).then(function (r) {
            if (r.error || !r.data || !r.data.length) return;
            var paths = r.data.map(function (x) { return x.storage_path; }).filter(Boolean);
            var ids = r.data.map(function (x) { return x.id; });
            var next = paths.length
                ? SB.storage.from(BUCKET).remove(paths)
                : Promise.resolve();
            next.then(function () {
                return SB.from(TABLE).delete().in('id', ids);
            }).then(function () {}, function () {});
        });
    }

    document.addEventListener('app-lang-change', function () {
        var sec = gg('fileTransferSection');
        if (!sec || sec.style.display === 'none') return;
        render();
    });

    return { open: open, refreshI18n: render };
}());
