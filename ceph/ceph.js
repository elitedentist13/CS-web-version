(function () {
    var img = new Image();
    var pts = {};
    var sel = '';
    var drag = null;
    var mmPerPx = 0.1;
    var source = '';
    var ctxInfo = null;
    var fileName = 'ceph.png';

    function $(id) { return document.getElementById(id); }
    function canvas() { return $('view'); }

    function readCtx() {
        try { ctxInfo = JSON.parse(sessionStorage.getItem('banana.ceph.v1') || 'null'); } catch (e) { ctxInfo = null; }
        if (!ctxInfo) {
            try { ctxInfo = JSON.parse(localStorage.getItem('banana.ceph.v1') || 'null'); } catch (e2) { ctxInfo = null; }
        }
        var title = 'Ceph';
        if (ctxInfo && ctxInfo.patientNo) title += ' · #' + ctxInfo.patientNo;
        if (ctxInfo && ctxInfo.name) title += ' · ' + ctxInfo.name;
        document.title = title;
        var bar = $('bananaCephBar');
        if (bar) {
            var who = (ctxInfo && (ctxInfo.name || ctxInfo.patientNo)) ? ('Patient ' + (ctxInfo.patientNo || '') + ' ' + (ctxInfo.name || '')).trim() : 'No Banana patient in this window';
            bar.textContent = 'Banana cephalometric sidecar — ' + who + ' — share this window in X-ray Helper to save a view. Export JSON / PNG for the numbers and marked film.';
        }
    }

    function setStatus(s) {
        var el = $('status');
        if (el) el.textContent = s || '';
    }

    function viewSize() {
        var c = canvas();
        var w = c.clientWidth || 800;
        var h = c.clientHeight || 600;
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        return { w: c.width, h: c.height };
    }

    function fit() {
        var vs = viewSize();
        var iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
        var s = Math.min(vs.w / iw, vs.h / ih);
        var ox = (vs.w - iw * s) / 2, oy = (vs.h - ih * s) / 2;
        return { s: s, ox: ox, oy: oy };
    }

    function toView(p) {
        var f = fit();
        return { x: f.ox + p.x * f.s, y: f.oy + p.y * f.s };
    }
    function toImg(x, y) {
        var f = fit();
        return { x: (x - f.ox) / f.s, y: (y - f.oy) / f.s };
    }

    var PLANES = [
        ['S', 'N'], ['Po', 'Or'], ['Go', 'Gn'], ['Go', 'Me'], ['N', 'Pog'],
        ['U1', 'L1'], ['A', 'B'], ['PNS', 'ANS'], ['S', 'Gn']
    ];

    function draw() {
        var c = canvas();
        var ctx = c.getContext('2d');
        var vs = viewSize();
        ctx.clearRect(0, 0, vs.w, vs.h);
        ctx.fillStyle = '#080b14';
        ctx.fillRect(0, 0, vs.w, vs.h);
        if (img.naturalWidth) {
            var f = fit();
            ctx.drawImage(img, f.ox, f.oy, img.naturalWidth * f.s, img.naturalHeight * f.s);
        }
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(56,189,248,0.75)';
        PLANES.forEach(function (ab) {
            var a = pts[ab[0]], b = pts[ab[1]];
            if (!a || !b) return;
            var A = toView(a), B = toView(b);
            ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        });
        (CEPH_LM.defs() || []).forEach(function (d) {
            var p = pts[d.id];
            if (!p) return;
            var v = toView(p);
            ctx.beginPath();
            ctx.fillStyle = d.id === sel ? '#facc15' : '#38bdf8';
            ctx.arc(v.x, v.y, d.id === sel ? 6 : 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#fffbeb';
            ctx.font = '11px system-ui';
            ctx.fillText(d.id, v.x + 7, v.y - 6);
        });
    }

    function renderList() {
        var host = $('lmList');
        if (!host) return;
        host.innerHTML = CEPH_LM.defs().map(function (d) {
            var p = pts[d.id] || {};
            return '<div class="lm' + (sel === d.id ? ' is-on' : '') + '" data-id="' + d.id + '">' +
                '<span>' + d.i + '. ' + d.id + ' — ' + d.name + '</span>' +
                '<span>' + (p.x ? Math.round(p.x) + ',' + Math.round(p.y) : '—') + '</span></div>';
        }).join('');
        host.querySelectorAll('.lm').forEach(function (el) {
            el.onclick = function () { sel = el.getAttribute('data-id'); renderList(); draw(); };
        });
    }

    function renderAnalysis() {
        var host = $('tables');
        if (!host || typeof CEPH_AN === 'undefined') return;
        var res = CEPH_AN.run(pts, mmPerPx);
        host.innerHTML = res.groups.map(function (g) {
            return '<h2>' + g.title + '</h2><table><tr><th>Measure</th><th>Value</th><th>Norm</th><th></th></tr>' +
                g.rows.map(function (r) {
                    return '<tr><td>' + r.name + '</td><td>' + (r.value == null ? '—' : r.value + ' ' + r.unit) +
                        '</td><td>' + (r.norm || '') + '</td><td>' + (r.note || '') + '</td></tr>';
                }).join('') + '</table>';
        }).join('');
        window.__cephLast = { result: res, pts: pts, source: source, fileName: fileName, ctx: ctxInfo };
    }

    function refresh() { renderList(); renderAnalysis(); draw(); }

    function setPts(next, src) {
        pts = next || {};
        source = src || source;
        refresh();
    }

    function afterLoad(done) {
        var local = CEPH_LM.detectLocal(img);
        var api = (window.XRAY_AI_API_URL || 'http://127.0.0.1:8877');
        CEPH_LM.detectApi(img, api).then(function (remote) {
            setPts(remote.pts, remote.source);
            setStatus('Landmarks from the local AI service (' + remote.source + '). Drag to correct.');
            if (done) done({ ok: true, source: remote.source, via: 'api' });
        }).catch(function () {
            setPts(local.pts, local.source);
            setStatus('Landmarks from the ISBI + Aariz mean (' + local.source + '). Drag to correct.');
            if (done) done({ ok: true, source: local.source, via: 'local' });
        });
    }

    function runDetect() {
        if (!img.naturalWidth) { setStatus('Load a lateral ceph first.'); return Promise.resolve({ ok: false }); }
        setStatus('Auto-detecting landmarks…');
        return new Promise(function (resolve) { afterLoad(resolve); });
    }

    function loadFile(file) {
        if (!file) return Promise.resolve({ ok: false });
        fileName = file.name || 'ceph.png';
        var url = URL.createObjectURL(file);
        return new Promise(function (resolve) {
            img.onload = function () {
                URL.revokeObjectURL(url);
                afterLoad(resolve);
            };
            img.onerror = function () { setStatus('Could not read that file.'); resolve({ ok: false }); };
            img.src = url;
        });
    }

    function loadUrl(url, name) {
        if (!url) return Promise.resolve({ ok: false });
        fileName = name || 'ceph.png';
        img.crossOrigin = 'anonymous';
        return new Promise(function (resolve) {
            img.onload = function () { afterLoad(resolve); };
            img.onerror = function () { setStatus('Could not fetch the Banana film (CORS). Use Load file.'); resolve({ ok: false, error: 'load' }); };
            img.src = url;
        });
    }

    function exportJson() {
        var last = window.__cephLast || { pts: pts };
        var blob = new Blob([JSON.stringify({
            v: 1,
            kind: 'banana.ceph',
            dataset: 'ISBI2015-19',
            source: source,
            fileName: fileName,
            patient: ctxInfo,
            mmPerPx: mmPerPx,
            landmarks: pts,
            analysis: last.result
        }, null, 2)], { type: 'application/json' });
        download(blob, (fileName.replace(/\.[^.]+$/, '') || 'ceph') + '-analysis.json');
    }

    function exportCsv() {
        var last = window.__cephLast;
        if (!last || !last.result) renderAnalysis();
        last = window.__cephLast;
        var blob = new Blob([CEPH_AN.toCsv(last.result)], { type: 'text/csv' });
        download(blob, (fileName.replace(/\.[^.]+$/, '') || 'ceph') + '-analysis.csv');
    }

    function exportPng() {
        var out = document.createElement('canvas');
        if (!img.naturalWidth) { setStatus('Nothing to export.'); return; }
        out.width = img.naturalWidth;
        out.height = img.naturalHeight;
        var ctx = out.getContext('2d');
        ctx.drawImage(img, 0, 0);
        ctx.strokeStyle = 'rgba(56,189,248,0.85)';
        ctx.lineWidth = Math.max(2, out.width / 900);
        PLANES.forEach(function (ab) {
            var a = pts[ab[0]], b = pts[ab[1]];
            if (!a || !b) return;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        });
        CEPH_LM.defs().forEach(function (d) {
            var p = pts[d.id];
            if (!p) return;
            ctx.beginPath();
            ctx.fillStyle = '#facc15';
            ctx.arc(p.x, p.y, Math.max(4, out.width / 280), 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#111';
            ctx.font = 'bold ' + Math.max(14, Math.round(out.width / 90)) + 'px sans-serif';
            ctx.fillText(d.id, p.x + 8, p.y - 8);
        });
        out.toBlob(function (blob) {
            download(blob, (fileName.replace(/\.[^.]+$/, '') || 'ceph') + '-marked.png');
        }, 'image/png');
    }

    function download(blob, name) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    }

    function onMove(e) {
        var r = canvas().getBoundingClientRect();
        var x = e.clientX - r.left, y = e.clientY - r.top;
        if (drag && pts[drag]) {
            pts[drag] = toImg(x, y);
            refresh();
            return;
        }
    }
    function hit(x, y) {
        var best = '', bestD = 12;
        CEPH_LM.defs().forEach(function (d) {
            var p = pts[d.id];
            if (!p) return;
            var v = toView(p);
            var dd = Math.hypot(v.x - x, v.y - y);
            if (dd < bestD) { bestD = dd; best = d.id; }
        });
        return best;
    }

    function boot() {
        readCtx();
        CEPH_LM.loadCatalog().then(function () {
            pts = CEPH_LM.emptyPts();
            renderList();
            if (ctxInfo && ctxInfo.studyUrl) loadUrl(ctxInfo.studyUrl, ctxInfo.fileName);
            else setStatus('Load a lateral cephalogram (JPG / PNG / BMP).');
        }).catch(function () { setStatus('Missing data/isbi2015.json'); });

        $('btnLoad').onclick = function () { $('filePick').click(); };
        $('filePick').onchange = function () { loadFile(this.files && this.files[0]); this.value = ''; };
        $('btnDetect').onclick = runDetect;
        $('btnJson').onclick = exportJson;
        $('btnCsv').onclick = exportCsv;
        $('btnPng').onclick = exportPng;
        $('mmPerPx').onchange = function () {
            mmPerPx = parseFloat(this.value) || 0.1;
            renderAnalysis();
        };
        var c = canvas();
        c.addEventListener('mousedown', function (e) {
            var r = c.getBoundingClientRect();
            var id = hit(e.clientX - r.left, e.clientY - r.top);
            if (id) { sel = id; drag = id; refresh(); }
        });
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', function () { drag = null; });
        window.addEventListener('resize', draw);
        c.addEventListener('dragover', function (e) { e.preventDefault(); });
        c.addEventListener('drop', function (e) {
            e.preventDefault();
            var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) loadFile(f);
        });
    }

    window.CEPH_PAGE = {
        loadUrl: loadUrl,
        loadFile: loadFile,
        runDetect: runDetect,
        exportJson: exportJson,
        exportCsv: exportCsv,
        exportPng: exportPng,
        state: function () {
            var last = window.__cephLast || {};
            var keys = Object.keys(pts || {}).filter(function (k) { return pts[k] && pts[k].x; });
            return {
                fileName: fileName,
                source: source,
                imgW: img.naturalWidth || 0,
                imgH: img.naturalHeight || 0,
                nPts: keys.length,
                pts: pts,
                sna: last.result && last.result.groups && last.result.groups[0] && last.result.groups[0].rows[0] && last.result.groups[0].rows[0].value,
                groups: last.result ? last.result.groups.map(function (g) { return g.id; }) : [],
                patient: ctxInfo
            };
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
