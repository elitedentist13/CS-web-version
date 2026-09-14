// ════════════════════════════════════════════════════════════════
// app-file-transfer.js — Clinic file transfer (Tools → File Transfer)
//   • Fast Pass: upload to private storage, 3-day code (clinic_file_passes.sql)
//   • Direct: WebRTC data channel, no storage (Supabase Realtime signaling)
// ════════════════════════════════════════════════════════════════
var FILEXFER = (function () {
    'use strict';

    var BUCKET = 'clinic-pass';
    var TABLE = 'clinic_file_passes';
    var MAX_BYTES = 500 * 1024 * 1024;
    var EXPIRE_MS = 3 * 24 * 60 * 60 * 1000;
    var CODE_ALPH = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
    var CODE_LEN = 4;
    var LIVE_CHUNK = 64 * 1024;
    var LIVE_BUF_HIGH = 4 * 1024 * 1024;
    var LIVE_BUF_LOW = 512 * 1024;
    var PART_SIZE = 8 * 1024 * 1024;
    var PART_CONCUR = 4;
    var ICE_SERVERS = [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' }
    ];
    var ICE_WATCH_MS = 18000;
    var TAB = 'send';
    var sendMode = 'pass';
    var chosenFile = null;
    var lastCreated = null;
    var live = emptyLive();

    function emptyLive() {
        return {
            role: null,
            code: '',
            channel: null,
            pc: null,
            dc: null,
            file: null,
            note: '',
            destId: '',
            destLabel: '',
            chunks: [],
            received: 0,
            expected: 0,
            meta: null,
            pendingIce: [],
            readyTimer: null,
            lookTimer: null,
            iceTimer: null,
            failTimer: null,
            lastPct: -1,
            restarted: false,
            fallingBack: false,
            pollStarted: false,
            closed: false,
            done: false
        };
    }

    function rtcConfig() {
        var servers = ICE_SERVERS.slice();
        var extra = window.FILEXFER_TURN;
        if (Array.isArray(extra)) servers = servers.concat(extra);
        else if (extra) servers.push(extra);
        return { iceServers: servers, iceCandidatePoolSize: 2 };
    }

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
        el.className = 'fx-status' + (tone ? ' fx-status--' + tone : '');
        el.innerHTML = (tone === 'work' ? '<span class="ct-spin"></span> ' : '') + esc(msg || '');
    }
    function setProgress(pct) {
        var bar = gg('fx_prog_bar');
        if (bar) bar.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
        var wrap = gg('fx_prog');
        if (wrap) wrap.style.display = pct > 0 && pct < 100 ? '' : (pct >= 100 ? '' : 'none');
    }

    function hasWebrtc() {
        return typeof RTCPeerConnection === 'function';
    }

    function stopLive(opts) {
        opts = opts || {};
        var prev = live;
        live = emptyLive();
        live.closed = true;
        if (prev.readyTimer) clearInterval(prev.readyTimer);
        if (prev.lookTimer) clearTimeout(prev.lookTimer);
        if (prev.iceTimer) clearTimeout(prev.iceTimer);
        if (prev.failTimer) clearTimeout(prev.failTimer);
        try { if (prev.dc) prev.dc.close(); } catch (e) {}
        try { if (prev.pc) prev.pc.close(); } catch (e2) {}
        if (prev.channel && typeof SB !== 'undefined' && SB.removeChannel) {
            try { SB.removeChannel(prev.channel); } catch (e3) {}
        }
        if (!opts.silent) setProgress(0);
    }

    function sig(payload) {
        if (!live.channel || live.closed) return;
        live.channel.send({
            type: 'broadcast',
            event: 'sig',
            payload: payload
        }).then(function () {}, function () {});
    }

    function liveReadyPayload() {
        var f = live.file;
        return {
            t: 'ready',
            from: myClinicLabel(),
            fromId: myClinicId() || '',
            destId: live.destId || '',
            destLabel: live.destLabel || '',
            name: f ? f.name : '',
            size: f ? f.size : 0,
            type: f ? (f.type || '') : '',
            note: live.note || ''
        };
    }

    function applyRemoteIce(c) {
        if (!live.pc || !c) return;
        var cand = new RTCIceCandidate(c);
        if (!live.pc.remoteDescription) {
            live.pendingIce.push(cand);
            return;
        }
        live.pc.addIceCandidate(cand).then(function () {}, function () {});
    }
    function flushPendingIce() {
        if (!live.pc) return;
        live.pendingIce.forEach(function (c) {
            live.pc.addIceCandidate(c).then(function () {}, function () {});
        });
        live.pendingIce = [];
    }

    function channelOpen() {
        return !!(live.dc && live.dc.readyState === 'open');
    }
    function transferInFlight() {
        if (live.done || live.fallingBack || live.closed) return false;
        if (!channelOpen()) return false;
        if (live.role === 'send') return !!live.file;
        return live.received > 0 || !!(live.meta && live.meta.size);
    }
    function noteLivePct(pct, sending) {
        pct = Math.max(0, Math.min(100, pct || 0));
        if (pct !== 100 && pct < live.lastPct + 1 && pct !== 0) return;
        live.lastPct = pct;
        setProgress(pct);
        status(trReplKey(sending ? 'filexfer.liveSending' : 'filexfer.liveReceiving', {
            PCT: String(pct)
        }), 'work');
    }

    function onIceState() {
        if (!live.pc) return;
        var ice = live.pc.iceConnectionState;
        var conn = live.pc.connectionState;
        if (ice !== 'failed' && conn !== 'failed') return;
        if (transferInFlight()) return;
        schedulePeerFail('ice:' + ice + '/' + conn);
    }

    function armIceWatch() {
        if (live.iceTimer) clearTimeout(live.iceTimer);
        live.iceTimer = setTimeout(function () {
            live.iceTimer = null;
            if (live.done || live.fallingBack || live.closed) return;
            if (channelOpen()) return;
            onPeerFailed('ice-watch');
        }, ICE_WATCH_MS);
    }
    function clearIceWatch() {
        if (live.iceTimer) {
            clearTimeout(live.iceTimer);
            live.iceTimer = null;
        }
    }

    function closePeerOnly() {
        clearIceWatch();
        if (live.failTimer) {
            clearTimeout(live.failTimer);
            live.failTimer = null;
        }
        try { if (live.dc) live.dc.close(); } catch (e) {}
        try { if (live.pc) live.pc.close(); } catch (e2) {}
        live.dc = null;
        live.pc = null;
    }

    function restartIce() {
        if (!live.pc || live.role !== 'send') return Promise.resolve(false);
        status(trKey('filexfer.liveConnecting'), 'work');
        return live.pc.createOffer({ iceRestart: true }).then(function (offer) {
            return live.pc.setLocalDescription(offer);
        }).then(function () {
            sig({
                t: 'offer',
                sdp: { type: live.pc.localDescription.type, sdp: live.pc.localDescription.sdp }
            });
            return true;
        }).catch(function () { return false; });
    }

    function schedulePeerFail(why) {
        if (live.done || live.fallingBack || live.closed || live.failTimer) return;
        if (transferInFlight()) return;
        live.failTimer = setTimeout(function () {
            live.failTimer = null;
            if (transferInFlight()) return;
            onPeerFailed(why);
        }, 1200);
    }

    function onPeerFailed(why) {
        if (live.done || live.fallingBack || live.closed) return;
        if (transferInFlight()) return;
        if (!live.restarted && live.pc && !channelOpen()) {
            live.restarted = true;
            if (live.role === 'send') {
                restartIce().then(function (ok) {
                    if (!ok) fallbackFromLive();
                });
                return;
            }
            status(trKey('filexfer.liveConnecting'), 'work');
            return;
        }
        if (why) {
            try { console.warn('[FILEXFER] peer failed', why, live.role); } catch (e) {}
        }
        fallbackFromLive();
    }

    function fallbackFromLive() {
        if (live.closed || live.done || live.fallingBack) return;
        live.fallingBack = true;
        var code = live.code;
        var file = live.file;
        var note = live.note;
        var destId = live.destId;
        var destLabel = live.destLabel;
        var role = live.role;
        closePeerOnly();
        if (role === 'recv' && code) {
            status(trKey('filexfer.liveFailLookup'), 'warn');
            pollForPass(code);
            return;
        }
        if (role === 'send' && file && code) {
            status(trKey('filexfer.liveFailUpload'), 'warn');
            setProgress(1);
            savePass(code, file, note, destId, destLabel, function (pct, phase) {
                setProgress(pct);
                if (phase === 'finalize') status(trKey('filexfer.finalizing'), 'work');
                else status(trReplKey('filexfer.sending', { PCT: String(pct) }), 'work');
            }).then(function (row) {
                sig({ t: 'stored' });
                lastCreated = row;
                chosenFile = null;
                stopLive({ silent: true });
                setProgress(100);
                renderPanel();
                status(trKey('filexfer.liveFailSaved'), 'warn');
            }).catch(function (err) {
                stopLive({ silent: true });
                setProgress(0);
                status(isMissingTable(err)
                    ? trKey('filexfer.setup')
                    : trKey('filexfer.liveFail'), 'bad');
            });
            return;
        }
        stopLive({ silent: true });
        status(trKey('filexfer.liveFail'), 'bad');
    }

    function wireSenderChannel(dc) {
        live.dc = dc;
        dc.binaryType = 'arraybuffer';
        dc.bufferedAmountLowThreshold = LIVE_BUF_LOW;
        dc.onopen = function () {
            clearIceWatch();
            status(trReplKey('filexfer.liveSending', { PCT: '0' }), 'work');
            sendLiveFile();
        };
        dc.onerror = function () {
            if (!live.done) schedulePeerFail('send-dc-error');
        };
        dc.onclose = function () {
            if (!live.done) schedulePeerFail('send-dc-close');
        };
    }

    function sendLiveFile() {
        var file = live.file;
        var dc = live.dc;
        if (!file || !dc || dc.readyState !== 'open') return;
        dc.send(JSON.stringify({
            t: 'meta',
            name: file.name,
            size: file.size,
            type: file.type || '',
            note: live.note || '',
            from: myClinicLabel()
        }));
        var offset = 0;
        function pump() {
            if (live.closed || !live.dc || live.dc.readyState !== 'open') return;
            if (offset >= file.size) {
                try { dc.send(JSON.stringify({ t: 'end' })); } catch (e) {}
                live.done = true;
                setProgress(100);
                status(trKey('filexfer.liveDone'), 'ok');
                return;
            }
            if (dc.bufferedAmount > LIVE_BUF_HIGH) {
                dc.onbufferedamountlow = function () {
                    dc.onbufferedamountlow = null;
                    pump();
                };
                return;
            }
            var slice = file.slice(offset, offset + LIVE_CHUNK);
            slice.arrayBuffer().then(function (buf) {
                if (live.closed || !live.dc || live.dc.readyState !== 'open') return;
                try { dc.send(buf); } catch (e) {
                    schedulePeerFail('send-chunk');
                    return;
                }
                offset += buf.byteLength;
                noteLivePct(Math.round((offset / file.size) * 100), true);
                if (dc.bufferedAmount > LIVE_BUF_HIGH / 2) setTimeout(pump, 0);
                else pump();
            });
        }
        pump();
    }

    function wireRecvChannel(dc) {
        live.dc = dc;
        dc.binaryType = 'arraybuffer';
        dc.onopen = function () { clearIceWatch(); };
        dc.onmessage = function (ev) {
            handleLiveMessage(ev.data);
        };
        dc.onerror = function () {
            if (!live.done) schedulePeerFail('recv-dc-error');
        };
        dc.onclose = function () {
            if (!live.done) schedulePeerFail('recv-dc-close');
        };
        if (dc.readyState === 'open') clearIceWatch();
    }

    function handleLiveMessage(data) {
        if (typeof data === 'string') {
            var msg;
            try { msg = JSON.parse(data); } catch (e) { return; }
            if (msg.t === 'meta') {
                live.meta = msg;
                live.expected = Number(msg.size) || 0;
                live.received = 0;
                live.lastPct = -1;
                live.chunks = [];
                renderLiveRecvCard();
                noteLivePct(0, false);
                return;
            }
            if (msg.t === 'end') {
                finishLiveRecv();
            }
            return;
        }
        function takeBuf(buf) {
            if (!buf) return;
            live.chunks.push(buf);
            live.received += buf.byteLength || 0;
            noteLivePct(live.expected ? Math.round((live.received / live.expected) * 100) : 0, false);
        }
        if (data instanceof Blob) {
            data.arrayBuffer().then(takeBuf);
            return;
        }
        takeBuf(data);
    }

    function finishLiveRecv() {
        live.done = true;
        var type = (live.meta && live.meta.type) || 'application/octet-stream';
        var name = (live.meta && live.meta.name) || 'download';
        var blob = new Blob(live.chunks, { type: type });
        live.chunks = [];
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
        setProgress(100);
        status(trKey('filexfer.liveRecvDone'), 'ok');
        renderLiveRecvCard(true);
    }

    function renderLiveRecvCard(done) {
        var box = gg('fx_found');
        if (!box) return;
        var meta = live.meta || {};
        box.innerHTML =
            '<div class="fx-pass-card">' +
                '<div class="fx-pass-name">' + esc(meta.name || trKey('filexfer.liveConnecting')) + '</div>' +
                '<div class="fx-pass-meta">' +
                    esc(fmtSize(meta.size)) + ' · ' +
                    esc(trReplKey('filexfer.from', { CLINIC: meta.from || '—' })) +
                    (meta.note ? '<br>' + esc(meta.note) : '') +
                    '<br>' + esc(done ? trKey('filexfer.liveRecvDone') : trKey('filexfer.modeDirect')) +
                '</div>' +
                '<div id="fx_prog" class="fx-progress"' + (done ? ' style="display:none;"' : '') +
                    '><span id="fx_prog_bar"></span></div>' +
            '</div>';
    }

    function createSenderPc() {
        live.pc = new RTCPeerConnection(rtcConfig());
        live.pc.onicecandidate = function (ev) {
            if (ev.candidate) sig({ t: 'ice', role: 'send', c: ev.candidate.toJSON() });
        };
        live.pc.oniceconnectionstatechange = onIceState;
        live.pc.onconnectionstatechange = onIceState;
        wireSenderChannel(live.pc.createDataChannel('file', { ordered: true }));
        armIceWatch();
        return live.pc.createOffer().then(function (offer) {
            return live.pc.setLocalDescription(offer);
        }).then(function () {
            sig({ t: 'offer', sdp: { type: live.pc.localDescription.type, sdp: live.pc.localDescription.sdp } });
        });
    }

    function acceptOffer(sdp) {
        if (live.pc) {
            try { live.pc.close(); } catch (e) {}
            live.pc = null;
            live.dc = null;
            live.pendingIce = [];
        }
        live.pc = new RTCPeerConnection(rtcConfig());
        live.pc.ondatachannel = function (ev) { wireRecvChannel(ev.channel); };
        live.pc.onicecandidate = function (ev) {
            if (ev.candidate) sig({ t: 'ice', role: 'recv', c: ev.candidate.toJSON() });
        };
        live.pc.oniceconnectionstatechange = onIceState;
        live.pc.onconnectionstatechange = onIceState;
        armIceWatch();
        return live.pc.setRemoteDescription(new RTCSessionDescription(sdp)).then(function () {
            flushPendingIce();
            return live.pc.createAnswer();
        }).then(function (answer) {
            return live.pc.setLocalDescription(answer);
        }).then(function () {
            sig({ t: 'answer', sdp: { type: live.pc.localDescription.type, sdp: live.pc.localDescription.sdp } });
        });
    }

    function onLiveSignal(msg) {
        if (!msg || !msg.t || live.closed) return;
        if (msg.t === 'ready' && live.role === 'recv') {
            if (msg.destId && myClinicId() && String(msg.destId) !== myClinicId()) {
                status(trReplKey('filexfer.wrongClinic', { CLINIC: msg.destLabel || msg.destId }), 'bad');
                stopLive({ silent: true });
                return;
            }
            live.meta = {
                name: msg.name,
                size: msg.size,
                type: msg.type,
                note: msg.note,
                from: msg.from
            };
            if (live.lookTimer) {
                clearTimeout(live.lookTimer);
                live.lookTimer = null;
            }
            renderLiveRecvCard();
            status(trKey('filexfer.liveConnecting'), 'work');
            sig({ t: 'hello' });
            return;
        }
        if (msg.t === 'hello' && live.role === 'send' && !live.pc && !live.fallingBack) {
            status(trKey('filexfer.liveConnecting'), 'work');
            createSenderPc().catch(function () { onPeerFailed('offer'); });
            return;
        }
        if (msg.t === 'offer' && live.role === 'recv' && msg.sdp && !live.fallingBack) {
            if (channelOpen() || transferInFlight()) return;
            acceptOffer(msg.sdp).catch(function () { onPeerFailed('answer'); });
            return;
        }
        if (msg.t === 'answer' && live.role === 'send' && live.pc && msg.sdp) {
            live.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp))
                .then(flushPendingIce)
                .catch(function () { onPeerFailed('remote-sdp'); });
            return;
        }
        if (msg.t === 'stored' && live.role === 'recv' && !live.done) {
            status(trKey('filexfer.liveFailLookup'), 'warn');
            pollForPass(live.code);
            return;
        }
        if (msg.t === 'ice' && msg.c && msg.role && msg.role !== live.role) {
            applyRemoteIce(msg.c);
        }
    }

    function subscribeLive(code, role) {
        if (typeof SB === 'undefined' || !SB.channel) {
            return Promise.reject(new Error('rt'));
        }
        live.closed = false;
        live.role = role;
        live.code = code;
        var ch = SB.channel('fx-live-' + code, {
            config: { broadcast: { self: false } }
        });
        live.channel = ch;
        ch.on('broadcast', { event: 'sig' }, function (ev) {
            onLiveSignal(ev && ev.payload);
        });
        return new Promise(function (resolve, reject) {
            var settled = false;
            ch.subscribe(function (st) {
                if (settled) return;
                if (st === 'SUBSCRIBED') {
                    settled = true;
                    resolve(ch);
                } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
                    settled = true;
                    reject(new Error('rt'));
                }
            });
        });
    }

    function makeCode() {
        var out = '';
        var i;
        if (window.crypto && crypto.getRandomValues) {
            var buf = new Uint8Array(CODE_LEN);
            crypto.getRandomValues(buf);
            for (i = 0; i < CODE_LEN; i++) out += CODE_ALPH.charAt(buf[i] % CODE_ALPH.length);
            return out;
        }
        for (i = 0; i < CODE_LEN; i++) out += CODE_ALPH.charAt(Math.floor(Math.random() * CODE_ALPH.length));
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
            '<div class="fx-shell">' +
                '<p class="fx-intro">' + esc(trKey('filexfer.intro')) + '</p>' +
                '<div class="fx-tabs" id="fx_tabs" role="tablist">' +
                    tabBtn('send', trKey('filexfer.tabSend')) +
                    tabBtn('receive', trKey('filexfer.tabReceive')) +
                    tabBtn('mine', trKey('filexfer.tabMine')) +
                '</div>' +
                '<div id="fx_panel" class="fx-card"></div>' +
                '<div id="fx_status" class="fx-status" style="display:none;"></div>' +
            '</div>';
        wireTabs();
        renderPanel();
    }
    function tabBtn(id, label) {
        return '<button type="button" class="fx-tab' + (id === TAB ? ' is-on' : '') +
            '" data-fx="' + id + '" role="tab" aria-selected="' + (id === TAB ? 'true' : 'false') +
            '">' + esc(label) + '</button>';
    }
    function wireTabs() {
        var box = gg('fx_tabs');
        if (!box) return;
        box.addEventListener('click', function (e) {
            var b = e.target.closest('[data-fx]');
            if (!b) return;
            var next = b.getAttribute('data-fx');
            if (next !== TAB && live.role) stopLive();
            TAB = next;
            lastCreated = null;
            box.querySelectorAll('.fx-tab').forEach(function (x) {
                var on = x === b;
                x.classList.toggle('is-on', on);
                x.setAttribute('aria-selected', on ? 'true' : 'false');
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

    function renderSendLiveWait(p) {
        p.innerHTML =
            '<p class="fx-lead">' + esc(trKey('filexfer.liveWait')) + '</p>' +
            '<div class="fx-code-box">' +
                '<div class="fx-code" id="fx_code_out">' + esc(displayCode(live.code)) + '</div>' +
                '<button type="button" class="fx-btn fx-btn-primary" id="fx_copy">' +
                    esc(trKey('filexfer.copy')) + '</button>' +
            '</div>' +
            '<p class="fx-hint">' +
                esc(live.file ? (live.file.name + ' · ' + fmtSize(live.file.size)) : '') +
                (live.note ? ' · ' + esc(live.note) : '') +
            '</p>' +
            '<div id="fx_prog" class="fx-progress" style="display:none;"><span id="fx_prog_bar"></span></div>' +
            '<div class="fx-actions">' +
                '<button type="button" class="fx-btn" id="fx_live_cancel">' +
                    esc(trKey('filexfer.liveCancel')) + '</button>' +
            '</div>';
        gg('fx_copy').addEventListener('click', function () {
            copyText(displayCode(live.code), gg('fx_copy'));
        });
        gg('fx_live_cancel').addEventListener('click', function () {
            stopLive();
            status('', '');
            renderPanel();
        });
    }

    function renderSend(p) {
        if (live.role === 'send' && live.code) {
            renderSendLiveWait(p);
            return;
        }
        if (lastCreated) {
            p.innerHTML =
                '<p class="fx-lead">' + esc(trKey('filexfer.sendOk')) + '</p>' +
                '<div class="fx-code-box">' +
                    '<div class="fx-code" id="fx_code_out">' + esc(displayCode(lastCreated.pass_code)) + '</div>' +
                    '<button type="button" class="fx-btn fx-btn-primary" id="fx_copy">' +
                        esc(trKey('filexfer.copy')) + '</button>' +
                '</div>' +
                '<p class="fx-hint">' + esc(trReplKey('filexfer.expires', { WHEN: fmtWhen(lastCreated.expires_at) })) +
                    (lastCreated.file_name ? ' · ' + esc(lastCreated.file_name) : '') + '</p>' +
                '<div class="fx-actions">' +
                    '<button type="button" class="fx-btn" id="fx_again">' + esc(trKey('filexfer.sendAnother')) + '</button>' +
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
            '<div class="fx-paths" id="fx_modes">' +
                '<button type="button" class="fx-path' + (sendMode === 'pass' ? ' is-on' : '') +
                    '" data-fx-mode="pass">' +
                    '<span class="fx-path-title">' + esc(trKey('filexfer.modePass')) + '</span>' +
                    '<span class="fx-path-sub">' + esc(trKey('filexfer.modePassSub')) + '</span>' +
                '</button>' +
                '<button type="button" class="fx-path' + (sendMode === 'direct' ? ' is-on' : '') +
                    '" data-fx-mode="direct">' +
                    '<span class="fx-path-title">' + esc(trKey('filexfer.modeDirect')) + '</span>' +
                    '<span class="fx-path-sub">' + esc(trKey('filexfer.modeDirectSub')) + '</span>' +
                '</button>' +
            '</div>' +
            '<p class="fx-hint" id="fx_mode_hint">' +
                esc(trKey(sendMode === 'direct' ? 'filexfer.modeDirectHint' : 'filexfer.modePassHint')) +
            '</p>' +
            '<label class="fx-drop" id="fx_drop">' +
                '<span class="fx-drop-title">' + esc(trKey('filexfer.dropTitle')) + '</span>' +
                '<span class="fx-drop-sub">' + esc(trKey('filexfer.fileHint')) + '</span>' +
                '<span class="fx-file-name" id="fx_fname">' + esc(fname) + '</span>' +
                '<input id="fx_file" type="file">' +
            '</label>' +
            '<div class="fx-fields">' +
                '<label class="fx-field"><span>' + esc(trKey('filexfer.dest')) + '</span>' +
                    '<select id="fx_dest" class="fx-input">' + destOptions() + '</select></label>' +
                '<label class="fx-field"><span>' + esc(trKey('filexfer.note')) + '</span>' +
                    '<input id="fx_note" class="fx-input" type="text" maxlength="200" placeholder="' +
                        esc(trKey('filexfer.notePh')) + '"></label>' +
            '</div>' +
            '<div id="fx_prog" class="fx-progress" style="display:none;"><span id="fx_prog_bar"></span></div>' +
            '<div class="fx-submit">' +
                '<button type="button" class="fx-btn fx-btn-primary" id="fx_send">' +
                    esc(trKey(sendMode === 'direct' ? 'filexfer.sendDirectBtn' : 'filexfer.sendBtn')) +
                '</button>' +
            '</div>';
        wireDrop();
        var modeBox = gg('fx_modes');
        if (modeBox) {
            modeBox.addEventListener('click', function (e) {
                var b = e.target.closest('[data-fx-mode]');
                if (!b) return;
                sendMode = b.getAttribute('data-fx-mode') === 'direct' ? 'direct' : 'pass';
                renderPanel();
            });
        }
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
        gg('fx_send').addEventListener('click', function () {
            if (sendMode === 'direct') doDirectSend();
            else doSend();
        });
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
        var keepCode = (gg('fx_in_code') && gg('fx_in_code').value) || (live.role === 'recv' ? displayCode(live.code) : '');
        p.innerHTML =
            '<p class="fx-hint">' + esc(trKey('filexfer.recvHint')) + '</p>' +
            '<div class="fx-recv-row">' +
                '<label class="fx-field"><span>' + esc(trKey('filexfer.code')) + '</span>' +
                    '<input id="fx_in_code" class="fx-input fx-input-code" type="text" maxlength="9" placeholder="' +
                        esc(trKey('filexfer.codePh')) + '" autocomplete="off" value="' +
                        esc(keepCode) + '"></label>' +
                '<button type="button" class="fx-btn fx-btn-primary" id="fx_lookup">' +
                    esc(trKey('filexfer.lookup')) + '</button>' +
            '</div>' +
            '<div id="fx_found" class="fx-found"></div>';
        if (live.role === 'recv' && live.meta) renderLiveRecvCard(live.done);
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
                    '<button type="button" class="fx-btn fx-btn-primary" id="fx_dl">' +
                        esc(trKey('filexfer.download')) + '</button>' +
                '</div>' +
            '</div>';
        gg('fx_dl').addEventListener('click', function () { doDownload(row); });
    }

    function renderMine(p) {
        p.innerHTML =
            '<div class="fx-actions fx-actions-top">' +
                '<button type="button" class="fx-btn" id="fx_mine_refresh">' +
                    esc(trKey('filexfer.refresh')) + '</button>' +
            '</div>' +
            '<div id="fx_mine_list" class="fx-pass-list">' +
                '<p class="fx-hint">' + esc(trKey('filexfer.mineEmpty')) + '</p>' +
            '</div>';
        gg('fx_mine_refresh').addEventListener('click', loadMine);
        loadMine();
    }

    function loadMine() {
        var list = gg('fx_mine_list');
        if (!list) return;
        if (typeof SB === 'undefined' || !SB.from) {
            list.innerHTML = '<p class="fx-hint">' + esc(trKey('filexfer.setup')) + '</p>';
            return;
        }
        var cid = myClinicId();
        var q = SB.from(TABLE).select('*').gt('expires_at', new Date().toISOString())
            .order('created_at', { ascending: false }).limit(40);
        if (cid) q = q.or('from_clinic_id.eq.' + cid + ',to_clinic_id.eq.' + cid);
        q.then(function (r) {
            if (r.error) {
                list.innerHTML = '<p class="fx-hint">' +
                    esc(isMissingTable(r.error) ? trKey('filexfer.setup') : r.error.message) + '</p>';
                return;
            }
            var rows = r.data || [];
            if (!rows.length) {
                list.innerHTML = '<p class="fx-hint">' + esc(trKey('filexfer.mineEmpty')) + '</p>';
                return;
            }
            list.innerHTML = rows.map(function (row) {
                return '<div class="fx-pass-card" data-fx-id="' + esc(row.id) + '">' +
                    '<div class="fx-pass-card-top">' +
                        '<div class="fx-code fx-code-sm">' + esc(displayCode(row.pass_code)) + '</div>' +
                        '<button type="button" class="fx-btn fx-btn-ghost fx-del">' +
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

    function sbAnonKey() {
        return (SB && SB.supabaseKey) || '';
    }
    function tusEndpoint() {
        var storageUrl = (SB && SB.storage && SB.storage.url) || '';
        if (storageUrl) return String(storageUrl).replace(/\/$/, '') + '/upload/resumable';
        var base = (SB && SB.supabaseUrl) ? String(SB.supabaseUrl).replace(/\/$/, '') : '';
        return base + '/storage/v1/upload/resumable';
    }
    function b64utf8(s) {
        return btoa(unescape(encodeURIComponent(String(s || ''))));
    }
    function tusHeaders(extra) {
        var key = sbAnonKey();
        var h = {
            Authorization: 'Bearer ' + key,
            apikey: key,
            'x-upsert': 'false',
            'Tus-Resumable': '1.0.0'
        };
        Object.keys(extra || {}).forEach(function (k) { h[k] = extra[k]; });
        return h;
    }
    function resolveTusLocation(loc) {
        if (!loc) return '';
        if (/^https?:\/\//i.test(loc)) return loc;
        var endp = tusEndpoint();
        var origin = endp.replace(/\/storage\/v1\/upload\/resumable$/, '');
        if (loc.charAt(0) === '/') return origin + loc;
        return endp.replace(/\/$/, '') + '/' + loc;
    }

    /** 6 MB chunks — required by Supabase TUS. Progress advances only after each chunk is accepted. */
    var TUS_CHUNK = 6 * 1024 * 1024;

    function uploadTus(path, file, onPct) {
        var meta = [
            'bucketName ' + b64utf8(BUCKET),
            'objectName ' + b64utf8(path),
            'contentType ' + b64utf8(file.type || 'application/octet-stream'),
            'cacheControl ' + b64utf8('3600')
        ].join(',');
        return fetch(tusEndpoint(), {
            method: 'POST',
            headers: tusHeaders({
                'Upload-Length': String(file.size),
                'Upload-Metadata': meta
            })
        }).then(function (res) {
            if (!res.ok && res.status !== 201) {
                throw new Error('TUS create failed (' + res.status + ')');
            }
            var loc = resolveTusLocation(res.headers.get('Location'));
            if (!loc) throw new Error('TUS location missing');
            var offset = 0;
            function patchNext() {
                if (offset >= file.size) {
                    if (onPct) onPct(100);
                    return Promise.resolve();
                }
                var end = Math.min(offset + TUS_CHUNK, file.size);
                if (end >= file.size && onPct) onPct(Math.min(99, Math.round((offset / file.size) * 100)), 'finalize');
                return fetch(loc, {
                    method: 'PATCH',
                    headers: tusHeaders({
                        'Upload-Offset': String(offset),
                        'Content-Type': 'application/offset+octet-stream'
                    }),
                    body: file.slice(offset, end)
                }).then(function (pres) {
                    if (!pres.ok) throw new Error('TUS patch failed (' + pres.status + ')');
                    var next = parseInt(pres.headers.get('Upload-Offset'), 10);
                    offset = !isNaN(next) ? next : end;
                    if (onPct) onPct(Math.min(99, Math.round((offset / file.size) * 100)));
                    return patchNext();
                });
            }
            return patchNext();
        });
    }

    function xhrPut(url, file, onPct) {
        return new Promise(function (resolve, reject) {
            var xhr = new XMLHttpRequest();
            xhr.open('PUT', url);
            if (file.type) xhr.setRequestHeader('Content-Type', file.type);
            xhr.setRequestHeader('x-upsert', 'false');
            xhr.upload.onprogress = function (e) {
                if (!e.lengthComputable || !onPct) return;
                var pct = Math.round((e.loaded / e.total) * 95);
                if (pct >= 95) onPct(95, 'finalize');
                else onPct(Math.max(1, pct));
            };
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    if (onPct) onPct(100);
                    resolve();
                } else reject(new Error('Upload failed (' + xhr.status + ')'));
            };
            xhr.onerror = function () { reject(new Error('Network error')); };
            xhr.send(file);
        });
    }

    function uploadSigned(path, file, onPct) {
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

    function mapLimit(items, limit, worker) {
        var i = 0;
        var active = 0;
        var out = new Array(items.length);
        return new Promise(function (resolve, reject) {
            function kick() {
                if (i >= items.length && active === 0) return resolve(out);
                while (active < limit && i < items.length) {
                    (function (idx) {
                        active += 1;
                        Promise.resolve(worker(items[idx], idx)).then(function (v) {
                            out[idx] = v;
                            active -= 1;
                            kick();
                        }).catch(reject);
                    }(i++));
                }
            }
            if (!items.length) resolve(out);
            else kick();
        });
    }

    function isManifestPath(p) {
        return /\/manifest\.json$/i.test(String(p || ''));
    }

    function uploadParallel(code, file, onPct) {
        var n = Math.ceil(file.size / PART_SIZE);
        var got = [];
        var idx;
        for (idx = 0; idx < n; idx++) got[idx] = 0;
        function report() {
            var sum = 0;
            for (var j = 0; j < n; j++) sum += got[j];
            if (onPct) onPct(Math.min(99, Math.round((sum / file.size) * 100)));
        }
        var jobs = [];
        for (idx = 0; idx < n; idx++) jobs.push(idx);
        return mapLimit(jobs, PART_CONCUR, function (partIdx) {
            var blob = file.slice(partIdx * PART_SIZE, partIdx * PART_SIZE + PART_SIZE);
            var pth = code + '/p' + ('000' + partIdx).slice(-3) + '.bin';
            return uploadSigned(pth, blob, function (pct) {
                got[partIdx] = Math.round(blob.size * Math.min(pct, 100) / 100);
                report();
            }).then(function () {
                got[partIdx] = blob.size;
                report();
                return pth;
            });
        }).then(function (parts) {
            if (onPct) onPct(99, 'finalize');
            var manPath = code + '/manifest.json';
            var man = new Blob([JSON.stringify({
                v: 1,
                name: file.name,
                size: file.size,
                type: file.type || '',
                parts: parts
            })], { type: 'application/json' });
            return uploadSigned(manPath, man).then(function () {
                if (onPct) onPct(100);
                return manPath;
            });
        });
    }

    function uploadSingle(code, file, onPct) {
        var path = code + '/' + Date.now() + '_' + safeFilePart(file.name);
        var job = file.size <= TUS_CHUNK
            ? uploadSigned(path, file, onPct)
            : uploadTus(path, file, onPct).catch(function (err) {
                console.warn('[FILEXFER] TUS upload failed, using signed PUT', err);
                return uploadSigned(path, file, onPct);
            });
        return job.then(function () { return path; });
    }

    function uploadFile(code, file, onPct) {
        if (file.size > PART_SIZE) {
            return uploadParallel(code, file, onPct).catch(function (err) {
                console.warn('[FILEXFER] parallel upload failed, using single stream', err);
                return uploadSingle(code, file, onPct);
            });
        }
        return uploadSingle(code, file, onPct);
    }

    function removeStored(path) {
        if (!path) return Promise.resolve();
        if (!isManifestPath(path)) {
            return SB.storage.from(BUCKET).remove([path]).then(function () {}, function () {});
        }
        var prefix = path.replace(/\/manifest\.json$/i, '');
        return SB.storage.from(BUCKET).list(prefix, { limit: 200 }).then(function (r) {
            var names = ((r && r.data) || []).map(function (f) {
                return prefix + '/' + f.name;
            });
            if (names.indexOf(path) < 0) names.push(path);
            if (!names.length) return;
            return SB.storage.from(BUCKET).remove(names);
        }).then(function () {}, function () {});
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

    function savePass(code, file, note, destId, destLabel, onPct) {
        var path = '';
        return uploadFile(code, file, onPct).then(function (storedPath) {
            path = storedPath;
            var row = {
                pass_code: code,
                file_name: file.name,
                file_size: file.size,
                mime_type: file.type || null,
                storage_path: path,
                note: note || null,
                from_clinic_id: myClinicId() || null,
                from_clinic_label: myClinicLabel(),
                to_clinic_id: destId || null,
                to_clinic_label: destId ? (destLabel || clinicLabelById(destId) || null) : null,
                created_by: senderName() || null,
                expires_at: new Date(Date.now() + EXPIRE_MS).toISOString()
            };
            return SB.from(TABLE).insert(row).select('id,pass_code,expires_at,file_name').single()
                .then(function (ins) {
                    if (ins.error) throw ins.error;
                    if (ins.data) {
                        row.id = ins.data.id;
                        if (ins.data.expires_at) row.expires_at = ins.data.expires_at;
                    }
                    return row;
                });
        }).catch(function (err) {
            if (path) {
                try { SB.storage.from(BUCKET).remove([path]); } catch (e) {}
            }
            throw err;
        });
    }

    function doDirectSend() {
        if (!isLoggedIn()) return status(trKey('filexfer.needLogin'), 'bad');
        if (!chosenFile) return status(trKey('filexfer.needFile'), 'bad');
        if (chosenFile.size > MAX_BYTES) return status(trKey('filexfer.tooBig'), 'bad');
        if (!hasWebrtc()) return status(trKey('filexfer.needWebrtc'), 'bad');
        if (typeof SB === 'undefined' || !SB.channel) return status(trKey('filexfer.liveNeedRt'), 'bad');

        stopLive({ silent: true });
        live = emptyLive();
        live.file = chosenFile;
        live.note = (gg('fx_note') && gg('fx_note').value || '').trim();
        live.destId = (gg('fx_dest') && gg('fx_dest').value) || '';
        live.destLabel = live.destId ? (clinicLabelById(live.destId) || '') : '';
        var code = makeCode();
        status(trKey('filexfer.liveConnecting'), 'work');
        subscribeLive(code, 'send').then(function () {
            live.readyTimer = setInterval(function () {
                if (live.role === 'send' && !live.pc) sig(liveReadyPayload());
            }, 2000);
            sig(liveReadyPayload());
            renderPanel();
            status(trKey('filexfer.liveWait'), 'work');
        }).catch(function () {
            stopLive({ silent: true });
            status(trKey('filexfer.liveNeedRt'), 'bad');
        });
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

        uniqueCode().then(function (code) {
            status(trKey('filexfer.savingCode'), 'work');
            return savePass(code, chosenFile, note, destId, destId ? (clinicLabelById(destId) || '') : '', function (pct, phase) {
                setProgress(pct);
                if (phase === 'finalize') status(trKey('filexfer.finalizing'), 'work');
                else status(trReplKey('filexfer.sending', { PCT: String(pct) }), 'work');
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
        }).then(function () {
            if (btn) btn.disabled = false;
        });
    }

    function pollForPass(code) {
        if (!code || live.pollStarted) return;
        live.pollStarted = true;
        var n = 0;
        function tick() {
            n += 1;
            if (typeof SB === 'undefined' || !SB.from) {
                stopLive({ silent: true });
                status(trKey('filexfer.setup'), 'bad');
                return;
            }
            SB.from(TABLE).select('*').eq('pass_code', code).maybeSingle().then(function (r) {
                if (r.error) {
                    if (isMissingTable(r.error) || n >= 150) {
                        stopLive({ silent: true });
                        status(isMissingTable(r.error)
                            ? trKey('filexfer.setup')
                            : trReplKey('filexfer.fail', { MSG: r.error.message }), 'bad');
                        return;
                    }
                } else if (r.data) {
                    var row = r.data;
                    stopLive({ silent: true });
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
                    return;
                }
                if (n >= 150) {
                    stopLive({ silent: true });
                    status(trKey('filexfer.notFound'), 'bad');
                    return;
                }
                live.lookTimer = setTimeout(tick, 2000);
            });
        }
        tick();
    }

    function storageLookup(code) {
        if (typeof SB === 'undefined' || !SB.from) {
            status(trKey('filexfer.setup'), 'bad');
            return;
        }
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

    function doLookup() {
        if (!isLoggedIn()) return status(trKey('filexfer.needLogin'), 'bad');
        var code = normalizeCode(gg('fx_in_code') && gg('fx_in_code').value);
        if (code.length < CODE_LEN) return status(trKey('filexfer.notFound'), 'bad');
        if (live.role) stopLive({ silent: true });
        if (!hasWebrtc() || typeof SB === 'undefined' || !SB.channel) {
            storageLookup(code);
            return;
        }
        status(trKey('filexfer.liveLooking'), 'work');
        live = emptyLive();
        subscribeLive(code, 'recv').then(function () {
            sig({ t: 'hello' });
            live.lookTimer = setTimeout(function () {
                if (live.meta || live.pc) return;
                stopLive({ silent: true });
                storageLookup(code);
            }, 2800);
        }).catch(function () {
            stopLive({ silent: true });
            storageLookup(code);
        });
    }

    function markDownloaded(row) {
        if (!row || !row.id) return;
        SB.from(TABLE).update({
            download_count: (row.download_count || 0) + 1,
            last_downloaded_at: new Date().toISOString()
        }).eq('id', row.id).then(function () {}, function () {});
    }

    function clickDownload(blobOrUrl, name, isUrl) {
        var url = isUrl ? blobOrUrl : URL.createObjectURL(blobOrUrl);
        var a = document.createElement('a');
        a.href = url;
        a.download = name || 'download';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (!isUrl) setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
    }

    function doDownload(row) {
        if (!row || !row.storage_path) return;
        status(trKey('filexfer.download') + '…', 'work');
        var signed = function (p) {
            return SB.storage.from(BUCKET).createSignedUrl(p, 180).then(function (r) {
                if (r.error || !r.data || !r.data.signedUrl) throw r.error || new Error('signed url');
                return r.data.signedUrl;
            });
        };
        var job = isManifestPath(row.storage_path)
            ? signed(row.storage_path).then(function (url) {
                return fetch(url).then(function (res) {
                    if (!res.ok) throw new Error('manifest ' + res.status);
                    return res.json();
                });
            }).then(function (man) {
                var parts = (man && man.parts) || [];
                if (!parts.length) throw new Error('empty manifest');
                return mapLimit(parts, PART_CONCUR, function (p) {
                    return signed(p).then(function (u) {
                        return fetch(u).then(function (res) {
                            if (!res.ok) throw new Error('part ' + res.status);
                            return res.blob();
                        });
                    });
                }).then(function (blobs) {
                    clickDownload(
                        new Blob(blobs, { type: (man && man.type) || row.mime_type || '' }),
                        (man && man.name) || row.file_name || 'download',
                        false
                    );
                });
            })
            : signed(row.storage_path).then(function (url) {
                clickDownload(url, row.file_name || 'download', true);
            });
        job.then(function () {
            markDownloaded(row);
            status('', '');
        }).catch(function (err) {
            status(trReplKey('filexfer.fail', { MSG: (err && err.message) || String(err) }), 'bad');
        });
    }

    function deletePass(row) {
        if (!row) return;
        var chain = removeStored(row.storage_path);
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
            var next = Promise.resolve();
            paths.forEach(function (p) {
                next = next.then(function () { return removeStored(p); });
            });
            next.then(function () {
                return SB.from(TABLE).delete().in('id', ids);
            }).then(function () {}, function () {});
        });
    }

    document.addEventListener('app-lang-change', function () {
        var sec = gg('fileTransferSection');
        if (!sec || sec.style.display === 'none') return;
        if (live.role && !live.done) return;
        render();
    });

    return { open: open, refreshI18n: render };
}());
