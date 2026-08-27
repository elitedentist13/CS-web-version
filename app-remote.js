/* app-remote.js — "Any Banana" remote support module.
 *
 * Any Banana browser tab can act as a VIEWER (connect out to another PC's
 * Device ID) with nothing installed. Being a HOST (connectable, controllable)
 * requires tools/banana-remote-agent.ps1 running on that PC -- see
 * tools/README-any-banana.md. This file only ever talks to Supabase (SB,
 * defined in app.js) plus, on the SAME PC the agent runs on, a local
 * 127.0.0.1 endpoint to read "what is my Device ID" -- it never talks
 * to any OTHER PC's agent directly, all remote traffic is relayed through
 * Supabase (remote_sessions / remote_input_events / remote_files tables +
 * remote-screens / remote-files storage buckets, see any_banana_remote.sql).
 */
(function () {
    'use strict';

    var LOCAL_AGENT_BASE = 'http://127.0.0.1:17891';
    var SCREENS_BUCKET = 'remote-screens';
    var FILES_BUCKET = 'remote-files';
    var FRAME_REFRESH_MS = 450;
    var PENDING_TIMEOUT_MS = 120000;

    var myDeviceId = null;
    var myDeviceName = null;
    var activeSessionId = null;
    var sessionChannel = null;
    var frameTimer = null;
    var pendingTimeoutTimer = null;
    var deviceRefreshTimer = null;
    var knownReceivedFileIds = {};

    function tr(key) { return appTr(key); }

    function setConnectStatus(text, cls) {
        var el = g('rbConnectStatus');
        if (!el) return;
        el.style.display = text ? 'block' : 'none';
        el.className = 'rb-connect-status' + (cls ? ' ' + cls : '');
        el.textContent = text || '';
    }

    // ── "Your device" panel ─────────────────────────────────────
    function renderMyDeviceStatus() {
        var box = g('rbMyDeviceStatus');
        if (!box) return;
        if (myDeviceId) {
            box.innerHTML =
                '<span class="rb-device-id">' + esc(myDeviceId) + '</span>' +
                '<span class="rb-device-name">' + esc(myDeviceName || '') + '</span>' +
                '<span class="rb-status-pill ok"><span class="dot"></span>' + esc(tr('remote.agentOnline')) + '</span>';
        } else {
            box.innerHTML =
                '<span class="rb-status-pill off"><span class="dot"></span>' + esc(tr('remote.agentOffline')) + '</span>' +
                '<span class="rb-device-name">' + esc(tr('remote.agentOfflineHint')) + '</span>';
        }
    }

    function refreshMyDeviceStatus() {
        fetch(LOCAL_AGENT_BASE + '/device-id', { cache: 'no-store' })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                myDeviceId = (data && data.device_id) ? data.device_id : null;
                myDeviceName = (data && data.device_name) ? data.device_name : null;
                renderMyDeviceStatus();
            })
            .catch(function () {
                myDeviceId = null;
                myDeviceName = null;
                renderMyDeviceStatus();
            });
    }

    // ── Connect (viewer side) ───────────────────────────────────
    function clearPendingTimeout() {
        if (pendingTimeoutTimer) { clearTimeout(pendingTimeoutTimer); pendingTimeoutTimer = null; }
    }

    function connectToDevice() {
        var input = g('rbTargetDeviceId');
        var targetId = input ? String(input.value || '').trim() : '';
        if (!/^\d{6}$/.test(targetId)) {
            setConnectStatus(tr('remote.invalidId'), 'denied');
            return;
        }
        if (activeSessionId) {
            setConnectStatus(tr('remote.alreadyConnected'), 'waiting');
            return;
        }
        var btn = g('rbConnectBtn');
        if (btn) btn.disabled = true;
        setConnectStatus(tr('remote.waitingApproval'), 'waiting');

        var viewerLabel = (typeof currentUserId !== 'undefined' && currentUserId) ? String(currentUserId) : 'Banana user';

        SB.from('remote_sessions')
            .insert([{ host_device_id: targetId, viewer_label: viewerLabel, status: 'pending' }])
            .select('*')
            .then(function (r) {
                if (btn) btn.disabled = false;
                if (r.error || !r.data || !r.data.length) {
                    setConnectStatus(tr('remote.deviceNotFound'), 'denied');
                    return;
                }
                var session = r.data[0];
                subscribeToSession(session.id, targetId);
                clearPendingTimeout();
                pendingTimeoutTimer = setTimeout(function () {
                    if (activeSessionId) return; // already accepted
                    setConnectStatus(tr('remote.noResponse'), 'denied');
                    SB.from('remote_sessions').update({ status: 'ended', updated_at: new Date().toISOString() }).eq('id', session.id).then(function () {});
                    teardownSessionChannel();
                }, PENDING_TIMEOUT_MS);
            })
            .catch(function () {
                if (btn) btn.disabled = false;
                setConnectStatus(tr('remote.deviceNotFound'), 'denied');
            });
    }

    function subscribeToSession(sessionId, targetDeviceId) {
        teardownSessionChannel();
        sessionChannel = SB.channel('rb-session-' + sessionId)
            .on('postgres_changes', {
                event: 'UPDATE', schema: 'public', table: 'remote_sessions', filter: 'id=eq.' + sessionId
            }, function (payload) {
                handleSessionUpdate(payload.new, targetDeviceId);
            })
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'remote_files', filter: 'session_id=eq.' + sessionId
            }, function (payload) {
                if (payload.new && payload.new.direction === 'to_viewer') {
                    addReceivedFileChip(payload.new);
                }
            })
            .subscribe();
    }

    function teardownSessionChannel() {
        if (sessionChannel) {
            try { SB.removeChannel(sessionChannel); } catch (e) {}
            sessionChannel = null;
        }
    }

    function handleSessionUpdate(row, targetDeviceId) {
        if (!row) return;
        if (row.status === 'accepted') {
            clearPendingTimeout();
            startViewer(row.id, targetDeviceId);
        } else if (row.status === 'denied') {
            clearPendingTimeout();
            setConnectStatus(tr('remote.denied'), 'denied');
            teardownSessionChannel();
        } else if (row.status === 'ended') {
            clearPendingTimeout();
            if (activeSessionId === row.id) stopViewer(tr('remote.hostEnded'));
        }
    }

    // ── Viewer (screen + input + files) ─────────────────────────
    function startViewer(sessionId, targetDeviceId) {
        activeSessionId = sessionId;
        setConnectStatus('', null);
        var panel = g('rbViewerPanel');
        if (panel) panel.style.display = 'block';
        var label = g('rbViewerSessionLabel');
        if (label) label.textContent = tr('remote.connectedTo') + ' ' + targetDeviceId;
        knownReceivedFileIds = {};
        var filesBox = g('rbReceivedFiles');
        if (filesBox) filesBox.innerHTML = '';

        refreshFrame();
        if (frameTimer) clearInterval(frameTimer);
        frameTimer = setInterval(refreshFrame, FRAME_REFRESH_MS);

        bindViewerInputHandlers();
    }

    function refreshFrame() {
        if (!activeSessionId) return;
        var img = g('rbScreenImg');
        if (!img) return;
        var urlRes = SB.storage.from(SCREENS_BUCKET).getPublicUrl(activeSessionId + '/frame.jpg');
        var base = (urlRes && urlRes.data) ? urlRes.data.publicUrl : null;
        if (!base) return;
        img.src = base + '?t=' + Date.now();
    }

    function stopViewer(message) {
        if (frameTimer) { clearInterval(frameTimer); frameTimer = null; }
        teardownSessionChannel();
        activeSessionId = null;
        var panel = g('rbViewerPanel');
        if (panel) panel.style.display = 'none';
        if (message) setConnectStatus(message, 'ended');
    }

    function endSession() {
        if (!activeSessionId) return;
        var sessionId = activeSessionId;
        SB.from('remote_sessions').update({ status: 'ended', updated_at: new Date().toISOString() }).eq('id', sessionId).then(function () {});
        stopViewer(tr('remote.youEnded'));
    }

    // ── Input capture (mouse/keyboard -> remote_input_events) ───
    var viewerHandlersBound = false;

    function sendInputEvent(evt) {
        if (!activeSessionId) return;
        evt.session_id = activeSessionId;
        SB.from('remote_input_events').insert([evt]).then(function () {}).catch(function () {});
    }

    function fractionFromMouseEvent(e, imgEl) {
        var rect = imgEl.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width;
        var y = (e.clientY - rect.top) / rect.height;
        if (x < 0) x = 0; if (x > 1) x = 1;
        if (y < 0) y = 0; if (y > 1) y = 1;
        return { x: x, y: y };
    }

    function buttonName(e) {
        if (e.button === 2) return 'right';
        if (e.button === 1) return 'middle';
        return 'left';
    }

    function bindViewerInputHandlers() {
        var wrap = g('rbScreenWrap');
        var img = g('rbScreenImg');
        if (!wrap || !img || viewerHandlersBound) return;
        viewerHandlersBound = true;

        wrap.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        wrap.addEventListener('mousedown', function () { wrap.focus(); });

        img.addEventListener('mousemove', function (e) {
            var p = fractionFromMouseEvent(e, img);
            sendInputEvent({ event_type: 'mousemove', x: p.x, y: p.y });
        });
        img.addEventListener('mousedown', function (e) {
            e.preventDefault();
            var p = fractionFromMouseEvent(e, img);
            sendInputEvent({ event_type: 'mousedown', x: p.x, y: p.y, button: buttonName(e) });
        });
        img.addEventListener('mouseup', function (e) {
            e.preventDefault();
            var p = fractionFromMouseEvent(e, img);
            sendInputEvent({ event_type: 'mouseup', x: p.x, y: p.y, button: buttonName(e) });
        });
        img.addEventListener('wheel', function (e) {
            e.preventDefault();
            sendInputEvent({ event_type: 'wheel', delta: e.deltaY });
        }, { passive: false });

        var SPECIAL_KEYS = { Enter: 1, Backspace: 1, Tab: 1, Escape: 1, Delete: 1, ArrowLeft: 1, ArrowUp: 1, ArrowRight: 1, ArrowDown: 1, Home: 1, End: 1, PageUp: 1, PageDown: 1, Control: 1, Shift: 1, Alt: 1, ' ': 1 };

        wrap.addEventListener('keydown', function (e) {
            if (!activeSessionId) return;
            e.preventDefault();
            sendInputEvent({
                event_type: 'keydown', key: e.key,
                ctrl_key: e.ctrlKey, shift_key: e.shiftKey, alt_key: e.altKey
            });
            // Modifier/navigation keys need an explicit keyup too (so held
            // combos like Ctrl+C work); printable characters are typed as a
            // single down+up pair on the host side already (see
            // banana-remote-agent.ps1's SendUnicodeChar), so no keyup needed.
            if (!SPECIAL_KEYS[e.key]) return;
        });
        wrap.addEventListener('keyup', function (e) {
            if (!activeSessionId) return;
            e.preventDefault();
            if (!SPECIAL_KEYS[e.key]) return;
            sendInputEvent({
                event_type: 'keyup', key: e.key,
                ctrl_key: e.ctrlKey, shift_key: e.shiftKey, alt_key: e.altKey
            });
        });
    }

    // ── File sharing ─────────────────────────────────────────────
    function sendFile(file) {
        if (!activeSessionId || !file) return;
        var safeName = file.name.replace(/[^\w.\-]+/g, '_');
        var path = activeSessionId + '/to_host/' + Date.now() + '_' + safeName;
        SB.storage.from(FILES_BUCKET).upload(path, file, { cacheControl: '3600', upsert: false })
            .then(function (r) {
                if (r.error) { alert(tr('remote.fileUploadFailed')); return; }
                return SB.from('remote_files').insert([{
                    session_id: activeSessionId, direction: 'to_host',
                    file_name: file.name, storage_path: path, file_size: file.size, delivered: false
                }]);
            })
            .catch(function () { alert(tr('remote.fileUploadFailed')); });
    }

    function addReceivedFileChip(fileRow) {
        if (!fileRow || knownReceivedFileIds[fileRow.id]) return;
        knownReceivedFileIds[fileRow.id] = true;
        var box = g('rbReceivedFiles');
        if (!box) return;
        var urlRes = SB.storage.from(FILES_BUCKET).getPublicUrl(fileRow.storage_path);
        var url = (urlRes && urlRes.data) ? urlRes.data.publicUrl : '#';
        var chip = document.createElement('div');
        chip.className = 'rb-file-chip';
        chip.innerHTML = '📎 <a href="' + esc(url) + '" target="_blank" rel="noopener" download="' + esc(fileRow.file_name) + '">' + esc(fileRow.file_name) + '</a>';
        box.appendChild(chip);
    }

    // ── Wiring ───────────────────────────────────────────────────
    function openAnyBanana() {
        showOnly('anyBananaSection');
        refreshMyDeviceStatus();
        if (deviceRefreshTimer) clearInterval(deviceRefreshTimer);
        deviceRefreshTimer = setInterval(function () {
            if (!activeSessionId) refreshMyDeviceStatus();
        }, 15000);
    }

    function bindOnce() {
        var card = g('card-any-banana');
        if (card) card.addEventListener('click', openAnyBanana);

        var back = g('anyBananaBack');
        if (back) back.addEventListener('click', function () {
            if (deviceRefreshTimer) { clearInterval(deviceRefreshTimer); deviceRefreshTimer = null; }
            showDashboard();
        });

        var refreshBtn = g('rbRefreshDeviceBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', refreshMyDeviceStatus);

        var connectBtn = g('rbConnectBtn');
        if (connectBtn) connectBtn.addEventListener('click', connectToDevice);

        var targetInput = g('rbTargetDeviceId');
        if (targetInput) {
            targetInput.addEventListener('input', function () {
                targetInput.value = targetInput.value.replace(/\D/g, '').slice(0, 6);
            });
            targetInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') connectToDevice();
            });
        }

        var endBtn = g('rbEndSessionBtn');
        if (endBtn) endBtn.addEventListener('click', endSession);

        var sendFileBtn = g('rbSendFileBtn');
        var fileInput = g('rbFileInput');
        if (sendFileBtn && fileInput) {
            sendFileBtn.addEventListener('click', function () { fileInput.click(); });
            fileInput.addEventListener('change', function () {
                if (fileInput.files && fileInput.files[0]) sendFile(fileInput.files[0]);
                fileInput.value = '';
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindOnce);
    } else {
        bindOnce();
    }

    window.openAnyBanana = openAnyBanana;
})();
