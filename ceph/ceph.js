(function () {
    var img = new Image();
    var pts = {};
    var sel = '';
    var drag = null;
    var mmPerPx = 0.1;
    var source = '';
    var ctxInfo = null;
    var fileName = 'ceph.png';
    var lastBox = null;
    var lastDetect = null;
    var touched = {};
    var setTouched = [{}, {}, {}, {}, {}];
    var sets = [];
    var setIndex = 0;
    var userPickedSet = false;
    var USE_TRAIN_KEY = 'banana.ceph.useTrain.v1';
    var useTraining = false;

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
            bar.textContent = 'Banana cephalometric sidecar — ' + who + ' — choose Published 1502 or Published + in-house, then compare sets 1–5. Share this window in X-ray Helper to save a view.';
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
            var mark = touched[d.id] ? ' is-touched' : '';
            return '<div class="lm' + (sel === d.id ? ' is-on' : '') + mark + '" data-id="' + d.id + '">' +
                '<span>' + d.i + '. ' + d.id + ' — ' + d.name + (touched[d.id] ? ' (moved)' : '') + '</span>' +
                '<span>' + (p.x ? Math.round(p.x) + ',' + Math.round(p.y) : '—') + '</span></div>';
        }).join('');
        host.querySelectorAll('.lm').forEach(function (el) {
            el.onclick = function () {
                sel = el.getAttribute('data-id');
                renderList();
                draw();
            };
        });
        renderLearn();
    }

    function placedIds() {
        return CEPH_LM.defs().map(function (d) { return d.id; }).filter(function (id) {
            var p = pts[id];
            return p && isFinite(p.x) && isFinite(p.y) && (p.x !== 0 || p.y !== 0);
        });
    }

    function publishedN() {
        if (window.CEPH_LM && typeof CEPH_LM.publishedStats === 'function') return CEPH_LM.publishedStats().films;
        return 1502;
    }

    function readUseTraining() {
        try {
            return !!(window.localStorage && localStorage.getItem(USE_TRAIN_KEY) === '1');
        } catch (e) {
            return false;
        }
    }

    function writeUseTraining(on) {
        useTraining = !!on;
        try {
            if (window.localStorage) localStorage.setItem(USE_TRAIN_KEY, useTraining ? '1' : '0');
        } catch (e) { /* private mode */ }
        syncUseTrainBtn();
        renderLearn();
        return useTraining;
    }

    function syncUseTrainBtn() {
        var pubN = String(publishedN());
        var pairs = [
            [$('btnRefPub'), !useTraining],
            [$('btnRefPlus'), useTraining],
            [$('btnRefPubBar'), !useTraining],
            [$('btnRefPlusBar'), useTraining]
        ];
        pairs.forEach(function (pair) {
            var btn = pair[0];
            if (!btn) return;
            var on = pair[1];
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            if (on) btn.classList.add('is-on');
            else btn.classList.remove('is-on');
        });
        if ($('btnRefPub')) $('btnRefPub').textContent = 'Published ' + pubN;
        if ($('btnRefPubBar')) $('btnRefPubBar').textContent = 'Published ' + pubN;
    }

    function setRefMode(onPlus) {
        var st = (window.CEPH_LEARN && CEPH_LEARN.stats) ? CEPH_LEARN.stats() : { films: 0 };
        writeUseTraining(!!onPlus);
        if (useTraining && !st.films) {
            setStatus('Published + in-house is selected, but there are no in-house films yet. Adopt a set and add it to clinic training first.');
        } else if (useTraining) {
            setStatus('Reference: 1502 published PLUS ' + st.films + ' in-house training film(s). Libraries stay separate.');
        } else {
            setStatus('Reference: published 1502 library only. In-house training is stored but not used.');
        }
        if (img.naturalWidth) runDetect();
        return useTraining;
    }

    function renderLearn() {
        var nEl = $('learnCount');
        var filmsEl = $('learnFilms');
        var pubEl = $('pubCount');
        var st = (window.CEPH_LEARN && CEPH_LEARN.stats) ? CEPH_LEARN.stats() : { films: 0, points: 0 };
        if (pubEl) pubEl.textContent = String(publishedN());
        if (filmsEl) filmsEl.textContent = String(st.films);
        if (nEl) {
            nEl.textContent = st.films + ' whole set' + (st.films === 1 ? '' : 's') +
                ', ' + st.points + ' points. Reference: ' +
                (useTraining ? ('1502 + in-house') : 'published 1502 only') +
                '. Never mixed into the 1502 library.';
        }
    }

    function includeSelected() {
        if (!window.CEPH_LEARN) return { ok: false, error: 'learn' };
        if (!img.naturalWidth) { setStatus('Load a lateral ceph first.'); return { ok: false }; }
        var picked = placedIds();
        if (!picked.length) { setStatus('Auto-detect or adopt a set first. Training stores the whole 19-point set.'); return { ok: false, error: 'none' }; }
        var box = lastBox || (CEPH_LM.findHeadBox ? CEPH_LM.findHeadBox(img) : null);
        var out = CEPH_LEARN.includeSelected({
            pts: pts,
            box: box,
            fileName: fileName,
            patientNo: ctxInfo && ctxInfo.patientNo,
            setId: sets[setIndex] && sets[setIndex].id,
            setLabel: sets[setIndex] && sets[setIndex].label
        });
        if (!out.ok) { setStatus('Could not add that set.'); return out; }
        setStatus('Added the whole adopted set (' + out.included.length + ' landmarks' +
            (sets[setIndex] && sets[setIndex].label ? ', ' + sets[setIndex].label : '') +
            ') to clinic training (' + out.films + ' film(s)). The 1502 published tracings stay unchanged.');
        renderLearn();
        if (out.trace && typeof CEPH_LEARN.postRemote === 'function') {
            CEPH_LEARN.postRemote(out.trace);
        }
        return out;
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

    function setMeta() {
        return (sets || []).map(function (s, i) {
            return { i: i, id: s.id, label: s.label, source: s.source, on: i === setIndex };
        });
    }

    function renderSetBar() {
        var host = $('setBtns');
        var cap = $('setCaption');
        if (host) {
            if (!sets.length) {
                host.innerHTML = [0, 1, 2, 3, 4].map(function (i) {
                    return '<button type="button" disabled>' + (i + 1) + '</button>';
                }).join('');
            } else {
                host.innerHTML = sets.map(function (s, i) {
                    var on = i === setIndex;
                    return '<button type="button" class="' + (on ? 'is-on' : '') + '" data-set="' + i +
                        '" aria-pressed="' + (on ? 'true' : 'false') + '" title="' + (s.label || ('Set ' + (i + 1))) +
                        '">' + (i + 1) + '</button>';
                }).join('');
                host.querySelectorAll('button').forEach(function (btn) {
                    btn.onclick = function () {
                        adoptSet(parseInt(btn.getAttribute('data-set'), 10), true);
                    };
                });
            }
        }
        if (cap) {
            var s = sets[setIndex];
            cap.textContent = s
                ? ((useTraining ? 'Published + in-house' : 'Published ' + publishedN()) +
                    ' · adopted set ' + (setIndex + 1) + ' · ' + s.label + '. Click 1–5 to compare.')
                : 'Choose Published 1502 or Published + in-house, then run Auto landmarks.';
        }
    }

    function adoptSet(i, fromUser) {
        if (!sets.length) return { ok: false };
        i = ((i % sets.length) + sets.length) % sets.length;
        if (fromUser) userPickedSet = true;
        setIndex = i;
        if (!setTouched[i]) setTouched[i] = {};
        touched = setTouched[i];
        var s = sets[i];
        pts = s.pts || {};
        source = s.source || source;
        lastDetect = s;
        renderSetBar();
        refresh();
        if (fromUser) {
            setStatus('Adopted auto-detect set ' + (i + 1) + ' · ' + s.label + ' (' + s.source + ').');
        }
        return { ok: true, i: i, id: s.id, label: s.label, source: s.source };
    }

    function setPts(next, src) {
        pts = next || {};
        source = src || source;
        if (sets[setIndex]) {
            sets[setIndex].pts = pts;
            if (src) sets[setIndex].source = src;
        }
        refresh();
    }

    function afterLoad(done) {
        userPickedSet = false;
        var pack = CEPH_LM.detectSets(img, { useTraining: useTraining });
        sets = pack.sets || [];
        lastBox = pack.box || lastBox;
        lastDetect = pack;
        setTouched = [{}, {}, {}, {}, {}];
        var idx = pack.defaultIndex || 0;
        adoptSet(idx, false);
        var clinicN = pack.clinic || 0;
        if (useTraining && clinicN > 0) {
            setStatus('Reference: 1502 published + ' + clinicN + ' in-house film(s). Adopted set ' +
                (setIndex + 1) + ' · ' + ((sets[setIndex] && sets[setIndex].label) || 'clinic overlay') +
                '. Published library was not rewritten.');
            if (done) done({
                ok: true,
                source: source,
                via: 'clinic',
                publishedSource: sets[setIndex] && sets[setIndex].publishedSource,
                trainingSource: pack.trainingSource,
                useTraining: true,
                setIndex: setIndex,
                nSets: sets.length
            });
            return;
        }
        var api = (window.XRAY_AI_API_URL || 'http://127.0.0.1:8877');
        CEPH_LM.detectApi(img, api).then(function (remote) {
            sets[4] = {
                id: 'api',
                label: 'AI service',
                source: remote.source,
                publishedSource: remote.source,
                pts: remote.pts
            };
            if (!userPickedSet) adoptSet(4, false);
            else renderSetBar();
            setStatus('5 auto-detect sets ready. Adopted set ' + (setIndex + 1) + ' · ' +
                (sets[setIndex] && sets[setIndex].label) + ' (' + source + '). Click 1–5 to compare.');
            if (done) done({
                ok: true,
                source: source,
                via: userPickedSet ? 'local' : 'api',
                useTraining: false,
                setIndex: setIndex,
                nSets: sets.length
            });
        }).catch(function () {
            setStatus('5 auto-detect sets from the 1502 published tracings. Adopted set ' +
                (setIndex + 1) + ' · ' + ((sets[setIndex] && sets[setIndex].label) || '') +
                '. Click 1–5 or scroll the set bar to compare.');
            if (done) done({
                ok: true,
                source: source,
                via: 'local',
                publishedSource: sets[setIndex] && sets[setIndex].publishedSource,
                trainingSource: pack.trainingSource,
                useTraining: false,
                setIndex: setIndex,
                nSets: sets.length
            });
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
        var train = window.CEPH_LEARN ? CEPH_LEARN.stats() : { films: 0, points: 0 };
        var blob = new Blob([JSON.stringify({
            v: 1,
            kind: 'banana.ceph',
            dataset: 'ISBI2015-19',
            source: source,
            fileName: fileName,
            patient: ctxInfo,
            mmPerPx: mmPerPx,
            landmarks: pts,
            analysis: last.result,
            adoptedSet: sets[setIndex] ? {
                index: setIndex,
                id: sets[setIndex].id,
                label: sets[setIndex].label,
                source: sets[setIndex].source
            } : null,
            published: {
                dataset: 'ISBI2015+Aariz+PKU',
                films: publishedN(),
                kind: 'published',
                readOnly: true
            },
            clinicTraining: {
                kind: 'banana.ceph.clinicTrain',
                films: train.films,
                points: train.points,
                usedAsReference: !!useTraining
            }
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
            renderSetBar();
            renderList();
            if (window.CEPH_LEARN && typeof CEPH_LEARN.pullRemote === 'function') {
                CEPH_LEARN.pullRemote().then(function () { renderLearn(); });
            }
            if (ctxInfo && ctxInfo.studyUrl) loadUrl(ctxInfo.studyUrl, ctxInfo.fileName);
            else setStatus('Load a lateral cephalogram (JPG / PNG / BMP). Compare sets 1–5, then Add this set to clinic training to store all 19 points.');
        }).catch(function () { setStatus('Missing data/isbi2015.json'); });

        $('btnLoad').onclick = function () { $('filePick').click(); };
        $('filePick').onchange = function () { loadFile(this.files && this.files[0]); this.value = ''; };
        $('btnDetect').onclick = runDetect;
        useTraining = readUseTraining();
        syncUseTrainBtn();
        function bindRef(id, onPlus) {
            if ($(id)) $(id).onclick = function (e) {
                e.stopPropagation();
                setRefMode(onPlus);
            };
        }
        bindRef('btnRefPub', false);
        bindRef('btnRefPlus', true);
        bindRef('btnRefPubBar', false);
        bindRef('btnRefPlusBar', true);
        var setBar = $('setBar');
        if (setBar) {
            setBar.addEventListener('wheel', function (e) {
                if (!sets.length) return;
                e.preventDefault();
                var d = e.deltaY > 0 ? 1 : -1;
                adoptSet(setIndex + d, true);
            }, { passive: false });
        }
        if ($('btnLearn')) $('btnLearn').onclick = includeSelected;
        if ($('btnLearnUndo')) $('btnLearnUndo').onclick = function () {
            if (!window.CEPH_LEARN) return;
            var st = CEPH_LEARN.undoLast();
            setStatus('Removed the last clinic training film. Now ' + st.films + ' film(s). Published 1502 unchanged.');
            renderLearn();
        };
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
        window.addEventListener('mouseup', function () {
            if (!drag) return;
            touched[drag] = true;
            drag = null;
            renderList();
        });
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
        includeSelected: includeSelected,
        setUseTraining: writeUseTraining,
        setRefMode: setRefMode,
        adoptSet: function (i) { return adoptSet(i, true); },
        sets: setMeta,
        learnStats: function () { return window.CEPH_LEARN ? CEPH_LEARN.stats() : { films: 0, points: 0 }; },
        state: function () {
            var last = window.__cephLast || {};
            var keys = Object.keys(pts || {}).filter(function (k) { return pts[k] && pts[k].x; });
            var st = window.CEPH_LEARN ? CEPH_LEARN.stats() : { films: 0, points: 0 };
            return {
                fileName: fileName,
                source: source,
                imgW: img.naturalWidth || 0,
                imgH: img.naturalHeight || 0,
                nPts: keys.length,
                pts: pts,
                sna: last.result && last.result.groups && last.result.groups[0] && last.result.groups[0].rows[0] && last.result.groups[0].rows[0].value,
                groups: last.result ? last.result.groups.map(function (g) { return g.id; }) : [],
                patient: ctxInfo,
                publishedFilms: publishedN(),
                publishedSource: (sets[setIndex] && sets[setIndex].publishedSource) || (lastDetect && lastDetect.publishedSource),
                trainingSource: (sets[setIndex] && sets[setIndex].trainingSource) || (lastDetect && lastDetect.trainingSource),
                clinicFilms: st.films,
                clinicPoints: st.points,
                useTraining: !!useTraining,
                setIndex: setIndex,
                nSets: sets.length,
                setId: sets[setIndex] && sets[setIndex].id,
                setLabel: sets[setIndex] && sets[setIndex].label,
                selected: placedIds()
            };
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
