(function () {
    var img = new Image();
    var pts = {};
    var sel = '';
    var drag = null;
    var mmPerPx = 0.1;
    var calibrated = false;
    var calMode = false;
    var calFirst = null;
    var ruler = null;
    var source = '';
    var ctxInfo = null;
    var fileName = 'ceph.png';
    var lastBox = null;
    var lastDetect = null;
    var touched = {};
    var setTouched = [{}, {}, {}];
    var sets = [];
    var setIndex = 0;
    var userPickedSet = false;
    var setBarHidden = true;
    var viewedSets = [false, false, false];
    var USE_TRAIN_KEY = 'banana.ceph.useTrain.v1';
    var useTraining = false;
    var NORM_KEY = 'banana.ceph.normSet.v1';
    var TRACE_KEY = 'banana.ceph.savedTrace.v1';
    var normSet = 'chinese';

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
            bar.textContent = 'Banana cephalometric sidecar — ' + who + ' — choose Published 1502 or Published + in-house, then view sets 1–3 and Adopt selection. Share this window in X-ray Helper to save a view.';
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
        var s = Math.min(vs.w / iw, vs.h / ih) * viewZoom;
        var ox = (vs.w - iw * s) / 2 + panX, oy = (vs.h - ih * s) / 2 + panY;
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

    var extra = {};
    var extraTouched = {};
    var EXTRA_DEFS = [
        { id: 'U1a', name: 'U1 apex', pair: 'U1' },
        { id: 'L1a', name: 'L1 apex', pair: 'L1' },
        { id: 'FopA', name: 'FOP anterior', pair: '' },
        { id: 'FopP', name: 'FOP posterior', pair: '' }
    ];
    var viewZoom = 1;
    var panX = 0;
    var panY = 0;
    var panning = null;
    var invertFilm = false;
    var hiMeasure = '';
    var labOpen = false;
    var qaIds = {};
    var undoStack = [];
    var HIGHLIGHT = {
        SNA: [['S', 'N'], ['N', 'A']],
        SNB: [['S', 'N'], ['N', 'B']],
        ANB: [['A', 'N'], ['N', 'B']],
        'SN–GoGn': [['S', 'N'], ['Go', 'Gn']],
        Interincisal: [['U1a', 'U1'], ['L1a', 'L1']],
        'Facial angle': [['Po', 'Or'], ['N', 'Pog']],
        'Angle of convexity': [['N', 'A'], ['A', 'Pog']],
        'Y-axis': [['Po', 'Or'], ['S', 'Gn']],
        'FH–MP': [['Po', 'Or'], ['Go', 'Me']],
        FMA: [['Po', 'Or'], ['Go', 'Me']],
        IMPA: [['L1a', 'L1'], ['Go', 'Me']],
        FMIA: [['Po', 'Or'], ['L1a', 'L1']],
        'AO–BO': [['FopA', 'FopP']],
        'A to N-perp': [['Po', 'Or'], ['N', 'A']],
        'Pog to N-perp': [['Po', 'Or'], ['N', 'Pog']],
        'ANS–Me': [['ANS', 'Me']],
        'N–Me': [['N', 'Me']],
        'S–Go': [['S', 'Go']],
        'Ar–Go': [['Ar', 'Go']],
        'Ls to Sn–PogS': [['Sn', 'PogS'], ['Ls', 'Sn']],
        'Li to Sn–PogS': [['Sn', 'PogS'], ['Li', 'Sn']]
    };
    function loc(id) { return (pts && pts[id]) || extra[id] || null; }
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
            if (invertFilm) {
                ctx.filter = 'invert(1) hue-rotate(180deg)';
                ctx.drawImage(img, f.ox, f.oy, img.naturalWidth * f.s, img.naturalHeight * f.s);
                ctx.filter = 'none';
            } else {
                ctx.drawImage(img, f.ox, f.oy, img.naturalWidth * f.s, img.naturalHeight * f.s);
            }
        }
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = 'rgba(56,189,248,0.75)';
        PLANES.forEach(function (ab) {
            var a = loc(ab[0]), b = loc(ab[1]);
            if (!a || !b) return;
            var A = toView(a), B = toView(b);
            ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        });
        var hi = HIGHLIGHT[hiMeasure];
        if (hi) {
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 2.6;
            hi.forEach(function (ab) {
                var a = loc(ab[0]), b = loc(ab[1]);
                if (!a || !b) return;
                var A = toView(a), Bv = toView(b);
                ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(Bv.x, Bv.y); ctx.stroke();
            });
        }
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
        if (pts.U1 && pts.L1) {
            ctx.strokeStyle = 'rgba(196,181,253,0.85)';
            ctx.lineWidth = 1.6;
            [['U1', 'U1a'], ['L1', 'L1a']].forEach(function (ab) {
                var a = pts[ab[0]], b = extra[ab[1]];
                if (!a || !b) return;
                var A = toView(a), B = toView(b);
                ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
            });
            if (extra.FopA && extra.FopP) {
                ctx.strokeStyle = 'rgba(249,168,212,0.9)';
                var Fa = toView(extra.FopA), Fb = toView(extra.FopP);
                ctx.beginPath(); ctx.moveTo(Fa.x, Fa.y); ctx.lineTo(Fb.x, Fb.y); ctx.stroke();
            }
        }
        EXTRA_DEFS.forEach(function (d) {
            var p = extra[d.id];
            if (!p) return;
            var v = toView(p);
            ctx.save();
            ctx.translate(v.x, v.y);
            ctx.rotate(Math.PI / 4);
            ctx.fillStyle = d.id === sel ? '#facc15' : '#c4b5fd';
            ctx.fillRect(-4, -4, 8, 8);
            ctx.restore();
            ctx.fillStyle = '#fffbeb';
            ctx.font = '10px system-ui';
            ctx.fillText(d.id, v.x + 7, v.y - 6);
        });
        if (ruler && ruler.a && ruler.b) {
            var Ra = toView(ruler.a), Rb = toView(ruler.b);
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(Ra.x, Ra.y); ctx.lineTo(Rb.x, Rb.y); ctx.stroke();
            ctx.fillStyle = '#facc15';
            ctx.font = 'bold 11px system-ui';
            ctx.fillText((ruler.mm || '') + ' mm', (Ra.x + Rb.x) / 2 + 6, (Ra.y + Rb.y) / 2);
        }
        if (calFirst) {
            var cf = toView(calFirst);
            ctx.fillStyle = '#facc15';
            ctx.beginPath(); ctx.arc(cf.x, cf.y, 5, 0, Math.PI * 2); ctx.fill();
        }
    }

    function renderList() {
        var host = $('lmList');
        if (!host) return;
        host.innerHTML = CEPH_LM.defs().map(function (d) {
            var p = pts[d.id] || {};
            var mark = touched[d.id] ? ' is-touched' : '';
            if (qaIds[d.id]) mark += ' is-qa';
            return '<div class="lm' + (sel === d.id ? ' is-on' : '') + mark + '" data-id="' + d.id + '">' +
                '<span>' + d.i + '. ' + d.id + ' — ' + d.name +
                (qaIds[d.id] ? ' (check)' : '') +
                (touched[d.id] ? ' (moved)' : '') + '</span>' +
                '<span>' + (p.x ? Math.round(p.x) + ',' + Math.round(p.y) : '—') + '</span></div>';
        }).join('');
        host.innerHTML += EXTRA_DEFS.map(function (d) {
            var p = extra[d.id] || {};
            return '<div class="lm' + (sel === d.id ? ' is-on' : '') + '" data-id="' + d.id + '">' +
                '<span>' + d.id + ' — ' + d.name + (extraTouched[d.id] ? ' (moved)' : '') + '</span>' +
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

    function readNormSet() {
        try {
            var v = window.localStorage && localStorage.getItem(NORM_KEY);
            if (v === 'caucasian' || v === 'chinese') return v;
        } catch (e) { /* ignore */ }
        return 'chinese';
    }
    function writeNormSet(id) {
        normSet = (id === 'caucasian') ? 'caucasian' : 'chinese';
        try { if (window.localStorage) localStorage.setItem(NORM_KEY, normSet); } catch (e2) { /* ignore */ }
        syncNormBtn();
        renderAnalysis();
        var pack = window.CEPH_AN && CEPH_AN.getSet ? CEPH_AN.getSet(normSet) : null;
        setStatus('Norms: ' + ((pack && pack.label) || normSet) + '. Green = within 1 SD, amber = 1–2 SD, red = beyond.');
        return normSet;
    }
    function syncNormBtn() {
        var cauc = $('btnNormCauc');
        var cn = $('btnNormCn');
        var src = $('normSource');
        var pack = window.CEPH_AN && CEPH_AN.getSet ? CEPH_AN.getSet(normSet) : null;
        [[cauc, normSet === 'caucasian'], [cn, normSet === 'chinese']].forEach(function (pair) {
            var btn = pair[0];
            if (!btn) return;
            btn.setAttribute('aria-pressed', pair[1] ? 'true' : 'false');
            if (pair[1]) btn.classList.add('is-on');
            else btn.classList.remove('is-on');
        });
        if (src && pack) src.textContent = pack.source || '';
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
            [$('btnRefPlus'), useTraining]
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
        var res = CEPH_AN.run(pts, mmPerPx, { normSet: normSet, calibrated: calibrated, extra: extra });
        host.innerHTML = res.groups.map(function (g) {
            return '<h2>' + g.title + '</h2><table><tr><th>Measure</th><th>Value</th><th>Δ</th><th>Norm</th><th></th></tr>' +
                g.rows.map(function (r) {
                    var cls = r.band ? (' class="band-' + r.band + '"') : '';
                    var delta = r.delta == null ? '' : ((r.delta > 0 ? '+' : '') + r.delta);
                    return '<tr' + cls + ' data-measure="' + r.name + '"><td>' + r.name + '</td><td>' +
                        (r.value == null ? '—' : r.value + ' ' + r.unit) +
                        '</td><td class="delta">' + delta + '</td><td>' + (r.norm || '') + '</td><td>' + (r.note || '') + '</td></tr>';
                }).join('') + '</table>';
        }).join('');
        host.querySelectorAll('tr[data-measure]').forEach(function (tr) {
            if (tr.getAttribute('data-measure') === hiMeasure) tr.classList.add('is-hi');
            tr.onclick = function () {
                hiMeasure = tr.getAttribute('data-measure') || '';
                renderAnalysis();
                draw();
            };
        });
        window.__cephLast = { result: res, pts: pts, source: source, fileName: fileName, ctx: ctxInfo };
        var sum = $('summary');
        if (sum && res.summary) {
            var s = res.summary;
            sum.innerHTML = [
                ['Skeletal · 骨性', s.skeletal],
                ['Vertical · 垂直', s.vertical],
                ['Profile · 侧貌', s.profile],
                ['Incisors / lip · 切牙/唇', s.incisor + ' · lip ' + s.lip]
            ].map(function (pair) {
                return '<div><div class="k">' + pair[0] + '</div><div class="v">' + pair[1] + '</div></div>';
            }).join('');
        }
    }

    function highlightMeasure(name) {
        hiMeasure = name || '';
        renderAnalysis();
        draw();
        return { ok: true, measure: hiMeasure, planes: HIGHLIGHT[hiMeasure] || [] };
    }
    function isExtraId(id) {
        return EXTRA_DEFS.some(function (d) { return d.id === id; });
    }
    function cloneUndo() {
        return {
            pts: JSON.parse(JSON.stringify(pts)),
            extra: JSON.parse(JSON.stringify(extra)),
            touched: JSON.parse(JSON.stringify(touched)),
            extraTouched: JSON.parse(JSON.stringify(extraTouched))
        };
    }
    function pushUndo() {
        try { undoStack.push(cloneUndo()); } catch (e) { return; }
        if (undoStack.length > 40) undoStack.shift();
    }
    function clearUndo() { undoStack = []; }
    function undoMove() {
        var s = undoStack.pop();
        if (!s) { setStatus('Nothing to undo.'); return { ok: false }; }
        pts = s.pts || pts;
        extra = s.extra || extra;
        if (s.touched) {
            touched = s.touched;
            if (sets[setIndex]) setTouched[setIndex] = touched;
        }
        if (s.extraTouched) extraTouched = s.extraTouched;
        if (sets[setIndex]) sets[setIndex].pts = pts;
        refresh();
        setStatus('Undid the last point move.');
        return { ok: true, n: undoStack.length };
    }
    function setPointAt(id, imgPt, record) {
        if (!id || !imgPt || !isFinite(imgPt.x) || !isFinite(imgPt.y)) return { ok: false };
        if (record) pushUndo();
        if (isExtraId(id)) {
            extra[id] = { x: imgPt.x, y: imgPt.y };
            extraTouched[id] = true;
        } else {
            pts[id] = { x: imgPt.x, y: imgPt.y };
            touched[id] = true;
            if (sets[setIndex]) sets[setIndex].pts = pts;
        }
        sel = id;
        refresh();
        return { ok: true, id: id, x: imgPt.x, y: imgPt.y };
    }
    function resetView() {
        viewZoom = 1;
        panX = 0;
        panY = 0;
        draw();
        return { ok: true, zoom: viewZoom };
    }
    function setInvert(on) {
        invertFilm = !!on;
        if ($('btnInvert')) {
            $('btnInvert').classList.toggle('is-on', invertFilm);
            $('btnInvert').setAttribute('aria-pressed', invertFilm ? 'true' : 'false');
        }
        draw();
        return invertFilm;
    }
    function traceStoreKey() {
        var p = (ctxInfo && (ctxInfo.patientNo || ctxInfo.patientId)) || 'anon';
        var x = (ctxInfo && ctxInfo.xrayId) || fileName || 'film';
        return String(p) + ':' + String(x);
    }
    function readTraceStore() {
        try {
            var raw = window.localStorage && localStorage.getItem(TRACE_KEY);
            var db = raw ? JSON.parse(raw) : {};
            return db && typeof db === 'object' ? db : {};
        } catch (e) { return {}; }
    }
    function saveTrace() {
        if (!img.naturalWidth || !placedIds().length) {
            setStatus('Adopt a set before saving a tracing.');
            return { ok: false };
        }
        var db = readTraceStore();
        var key = traceStoreKey();
        db[key] = {
            v: 1,
            kind: 'banana.ceph.savedTrace',
            key: key,
            patientNo: ctxInfo && ctxInfo.patientNo,
            xrayId: ctxInfo && ctxInfo.xrayId,
            fileName: fileName,
            pts: pts,
            extra: extra,
            mmPerPx: mmPerPx,
            calibrated: !!calibrated,
            normSet: normSet,
            source: source,
            setId: sets[setIndex] && sets[setIndex].id,
            savedAt: new Date().toISOString()
        };
        try { localStorage.setItem(TRACE_KEY, JSON.stringify(db)); } catch (e) { return { ok: false, error: 'store' }; }
        setStatus('Tracing saved for this patient (' + key + '). Reopen Ceph analysis to restore it.');
        return { ok: true, key: key };
    }
    function loadTrace(key) {
        var db = readTraceStore();
        var rec = db[key || traceStoreKey()];
        if (!rec || !rec.pts) return { ok: false };
        pts = rec.pts;
        extra = rec.extra || {};
        if (rec.mmPerPx) {
            mmPerPx = rec.mmPerPx;
            if ($('mmPerPx')) $('mmPerPx').value = String(mmPerPx);
        }
        if (rec.calibrated) calibrated = true;
        if (rec.normSet) { normSet = rec.normSet; syncNormBtn(); }
        source = rec.source || source;
        if (sets[setIndex]) sets[setIndex].pts = pts;
        refresh();
        setStatus('Restored the saved tracing for this patient.');
        return { ok: true, key: rec.key || key, nPts: placedIds().length };
    }
    function printReport() {
        window.print();
        return { ok: true };
    }

    function refresh() {
        qaScan();
        renderList();
        renderAnalysis();
        draw();
    }
    function qaScan() {
        qaIds = {};
        if (!img.naturalWidth) return [];
        var watch = { Go: 1, Po: 1, Or: 1, Ar: 1 };
        (CEPH_LM.defs() || []).forEach(function (d) {
            if (!watch[d.id] || d.ix == null || d.iy == null) return;
            var p = pts[d.id];
            if (!p || !p.x) return;
            var mx = d.ix * img.naturalWidth, my = d.iy * img.naturalHeight;
            var nrm = Math.hypot(p.x - mx, p.y - my) / Math.max(img.naturalWidth, 1);
            if (nrm > 0.08) qaIds[d.id] = true;
        });
        return Object.keys(qaIds);
    }
    function setLabMode(on) {
        labOpen = !!on;
        document.querySelectorAll('.labOnly').forEach(function (el) {
            if (labOpen) el.classList.remove('is-hidden');
            else el.classList.add('is-hidden');
        });
        if ($('btnAdvanced')) {
            $('btnAdvanced').classList.toggle('is-on', labOpen);
            $('btnAdvanced').setAttribute('aria-pressed', labOpen ? 'true' : 'false');
        }
        return labOpen;
    }

    function setMeta() {
        return (sets || []).map(function (s, i) {
            return { i: i, id: s.id, label: s.label, source: s.source, on: i === setIndex };
        });
    }

    function showSetBar() {
        setBarHidden = false;
        var bar = $('setBar');
        var chip = $('btnChangeSet');
        if (bar) bar.classList.remove('is-hidden');
        if (chip) chip.classList.add('is-hidden');
        renderSetBar();
    }

    function hideSetBar() {
        setBarHidden = true;
        var bar = $('setBar');
        var chip = $('btnChangeSet');
        if (bar) bar.classList.add('is-hidden');
        if (chip) chip.classList.remove('is-hidden');
    }

    function viewedAll() {
        return sets.length > 0 && viewedSets.slice(0, sets.length).every(Boolean);
    }

    function remainingView() {
        var left = [];
        sets.forEach(function (s, i) { if (!viewedSets[i]) left.push(String(i + 1)); });
        return left;
    }

    function renderSetBar() {
        var host = $('setBtns');
        var cap = $('setCaption');
        var adopt = $('btnAdoptSet');
        var ready = viewedAll();
        if (host) {
            if (!sets.length) {
                host.innerHTML = [0, 1, 2].map(function (i) {
                    return '<button type="button" disabled>' + (i + 1) + '</button>';
                }).join('');
                if (adopt) adopt.disabled = true;
            } else {
                host.innerHTML = sets.map(function (s, i) {
                    var on = i === setIndex;
                    return '<button type="button" class="' + (on ? 'is-on' : '') + '" data-set="' + i +
                        '" aria-pressed="' + (on ? 'true' : 'false') + '" title="' + (s.label || ('Set ' + (i + 1))) +
                        '">' + (i + 1) + '</button>';
                }).join('');
                host.querySelectorAll('button').forEach(function (btn) {
                    btn.onclick = function () {
                        previewSet(parseInt(btn.getAttribute('data-set'), 10), true);
                    };
                });
                if (adopt) adopt.disabled = !ready;
            }
        }
        if (cap) {
            var s = sets[setIndex];
            if (!s) cap.textContent = 'Run Auto landmarks, then view 1–3.';
            else if (!ready) cap.textContent = 'View ' + remainingView().join(', ') + ' still, then Adopt.';
            else cap.textContent = (setIndex + 1) + ' · ' + s.label + ' — Adopt to keep.';
        }
    }

    function seedExtra(force) {
        if (!pts.U1 || !pts.L1) return extra;
        if (force || !extra.U1a) extra.U1a = { x: pts.U1.x - 6, y: pts.U1.y + 26 };
        if (force || !extra.L1a) extra.L1a = { x: pts.L1.x - 8, y: pts.L1.y + 28 };
        if (force || !extra.FopA) {
            extra.FopA = { x: (pts.U1.x + pts.L1.x) / 2, y: (pts.U1.y + pts.L1.y) / 2 };
        }
        if (force || !extra.FopP) {
            extra.FopP = { x: extra.FopA.x - 80, y: extra.FopA.y + 10 };
        }
        return extra;
    }

    function previewSet(i, fromUser) {
        if (!sets.length) return { ok: false };
        i = ((i % sets.length) + sets.length) % sets.length;
        if (fromUser) userPickedSet = true;
        setIndex = i;
        viewedSets[i] = true;
        if (!setTouched[i]) setTouched[i] = {};
        touched = setTouched[i];
        var s = sets[i];
        pts = s.pts || {};
        source = s.source || source;
        lastDetect = s;
        extraTouched = {};
        extra = {};
        seedExtra(true);
        renderSetBar();
        refresh();
        if (fromUser) {
            setStatus(viewedAll()
                ? ('Viewing set ' + (i + 1) + ' · ' + s.label + '. Click Adopt selection to keep it.')
                : ('Viewing set ' + (i + 1) + ' · ' + s.label + '. Click the other sets first.'));
        }
        return { ok: true, i: i, id: s.id, label: s.label, source: s.source };
    }

    function lockAdopt() {
        if (!sets.length || !sets[setIndex]) {
            setStatus('Run Auto landmarks first, then view the 3 sets.');
            return { ok: false };
        }
        if (!viewedAll()) {
            setStatus('Click-view all 3 sets first, then Adopt selection.');
            return { ok: false };
        }
        var s = sets[setIndex];
        hideSetBar();
        setStatus('Adopted set ' + (setIndex + 1) + ' · ' + s.label + '. Selection bar hidden so the film is clear.');
        return { ok: true, i: setIndex, id: s.id, label: s.label, source: s.source };
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

    function afterLoad(done, skipRestore) {
        clearUndo();
        userPickedSet = false;
        var pack = CEPH_LM.detectSets(img, { useTraining: useTraining });
        sets = pack.sets || [];
        lastBox = pack.box || lastBox;
        lastDetect = pack;
        setTouched = [{}, {}, {}];
        viewedSets = [false, false, false];
        var idx = pack.defaultIndex || 0;
        showSetBar();
        previewSet(idx, false);
        var clinicN = pack.clinic || 0;
        function finish(payload) {
            if (!skipRestore) {
                var restored = loadTrace();
                if (restored && restored.ok) payload.restored = true;
            }
            if (done) done(payload);
        }
        if (useTraining && clinicN > 0) {
            setStatus('Reference: 1502 published + ' + clinicN + ' in-house film(s). Viewing set ' +
                (setIndex + 1) + ' · ' + ((sets[setIndex] && sets[setIndex].label) || 'clinic overlay') +
                '. Click 1–3 to compare, then Adopt selection.');
            finish({
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
            sets[2] = {
                id: 'api',
                label: 'AI service',
                source: remote.source,
                publishedSource: remote.source,
                pts: remote.pts
            };
            if (!userPickedSet) previewSet(2, false);
            else renderSetBar();
            setStatus('3 auto-detect sets ready. Viewing set ' + (setIndex + 1) + ' · ' +
                (sets[setIndex] && sets[setIndex].label) + '. Click 1–3 to compare, then Adopt selection.');
            finish({
                ok: true,
                source: source,
                via: userPickedSet ? 'local' : 'api',
                useTraining: false,
                setIndex: setIndex,
                nSets: sets.length
            });
        }).catch(function () {
            setStatus('3 auto-detect sets from the 1502 published tracings. Viewing set ' +
                (setIndex + 1) + ' · ' + ((sets[setIndex] && sets[setIndex].label) || '') +
                '. Click 1–3 to compare, then Adopt selection.');
            finish({
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
        return new Promise(function (resolve) { afterLoad(resolve, true); });
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

    function applyRuler(a, b, mm) {
        if (!a || !b) return { ok: false, error: 'pts' };
        mm = Number(mm);
        if (!isFinite(mm) || mm <= 0) mm = 10;
        var px = Math.hypot(b.x - a.x, b.y - a.y);
        if (px < 4) return { ok: false, error: 'short' };
        mmPerPx = mm / px;
        calibrated = true;
        calMode = false;
        calFirst = null;
        ruler = { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y }, mm: mm };
        if ($('mmPerPx')) $('mmPerPx').value = String(Math.round(mmPerPx * 10000) / 10000);
        if ($('btnCalibrate')) {
            $('btnCalibrate').classList.remove('is-on');
            $('btnCalibrate').setAttribute('aria-pressed', 'false');
        }
        renderAnalysis();
        draw();
        setStatus('Calibrated: ' + mm + ' mm = ' + Math.round(px) + ' px → ' +
            (Math.round(mmPerPx * 10000) / 10000) + ' mm/px. Linear measures are now in millimetres.');
        return { ok: true, mmPerPx: mmPerPx, px: px, mm: mm, calibrated: true };
    }
    function startCalibrate() {
        if (!img.naturalWidth) { setStatus('Load a lateral ceph first.'); return false; }
        calMode = true;
        calFirst = null;
        if ($('btnCalibrate')) {
            $('btnCalibrate').classList.add('is-on');
            $('btnCalibrate').setAttribute('aria-pressed', 'true');
        }
        var mm = ($('rulerMm') && parseFloat($('rulerMm').value)) || 10;
        setStatus('Calibration: click two ends of a ' + mm + ' mm marker on the film.');
        return true;
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
            calibrated: !!calibrated,
            normSet: normSet,
            landmarks: pts,
            extra: extra,
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

    function csvText() {
        var last = window.__cephLast;
        if (!last || !last.result) renderAnalysis();
        last = window.__cephLast;
        return CEPH_AN.toCsv(last && last.result);
    }
    function exportCsv() {
        var text = csvText();
        var blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
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
        if (drag && extra[drag]) {
            extra[drag] = toImg(x, y);
            extraTouched[drag] = true;
            refresh();
        }
    }
    function hit(x, y) {
        var best = '', bestD = 22;
        CEPH_LM.defs().forEach(function (d) {
            var p = pts[d.id];
            if (!p) return;
            var v = toView(p);
            var dd = Math.hypot(v.x - x, v.y - y);
            if (dd < bestD) { bestD = dd; best = d.id; }
        });
        EXTRA_DEFS.forEach(function (d) {
            var p = extra[d.id];
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
            else setStatus('Load a lateral cephalogram (JPG / PNG / BMP). Auto-detect shows 3 sets; Adopt selection keeps one.');
        }).catch(function () { setStatus('Missing data/isbi2015.json'); });

        $('btnLoad').onclick = function () { $('filePick').click(); };
        $('filePick').onchange = function () { loadFile(this.files && this.files[0]); this.value = ''; };
        $('btnDetect').onclick = runDetect;
        useTraining = readUseTraining();
        syncUseTrainBtn();
        normSet = readNormSet();
        syncNormBtn();
        if ($('btnNormCauc')) $('btnNormCauc').onclick = function () { writeNormSet('caucasian'); };
        if ($('btnNormCn')) $('btnNormCn').onclick = function () { writeNormSet('chinese'); };
        if ($('btnAdvanced')) $('btnAdvanced').onclick = function () { setLabMode(!labOpen); };
        setLabMode(false);
        function bindRef(id, onPlus) {
            if ($(id)) $(id).onclick = function (e) {
                e.stopPropagation();
                setRefMode(onPlus);
            };
        }
        bindRef('btnRefPub', false);
        bindRef('btnRefPlus', true);
        var setBar = $('setBar');
        if (setBar) {
            setBar.addEventListener('wheel', function (e) {
                if (!sets.length || setBarHidden) return;
                e.preventDefault();
                var d = e.deltaY > 0 ? 1 : -1;
                previewSet(setIndex + d, true);
            }, { passive: false });
        }
        if ($('btnAdoptSet')) $('btnAdoptSet').onclick = function (e) {
            e.stopPropagation();
            lockAdopt();
        };
        if ($('btnChangeSet')) $('btnChangeSet').onclick = function () {
            showSetBar();
            setStatus('Compare sets 1–3, then Adopt selection.');
        };
        if ($('btnLearn')) $('btnLearn').onclick = includeSelected;
        if ($('btnLearnUndo')) $('btnLearnUndo').onclick = function () {
            if (!window.CEPH_LEARN) return;
            var st = CEPH_LEARN.undoLast();
            setStatus('Removed the last clinic training film. Now ' + st.films + ' film(s). Published 1502 unchanged.');
            renderLearn();
        };
        $('btnJson') && ($('btnJson').onclick = exportJson);
        $('btnCsv').onclick = exportCsv;
        $('btnPng').onclick = exportPng;
        if ($('btnSaveTrace')) $('btnSaveTrace').onclick = saveTrace;
        if ($('btnPrint')) $('btnPrint').onclick = printReport;
        if ($('btnCalibrate')) $('btnCalibrate').onclick = function () {
            if (calMode) {
                calMode = false;
                calFirst = null;
                $('btnCalibrate').classList.remove('is-on');
                $('btnCalibrate').setAttribute('aria-pressed', 'false');
                setStatus('Calibration cancelled.');
                draw();
                return;
            }
            startCalibrate();
        };
        $('mmPerPx').onchange = function () {
            mmPerPx = parseFloat(this.value) || 0.1;
            calibrated = true;
            renderAnalysis();
            setStatus('Manual scale ' + mmPerPx + ' mm/px. Linear measures use this value.');
        };
        var c = canvas();
        c.addEventListener('mousedown', function (e) {
            var r = c.getBoundingClientRect();
            var x = e.clientX - r.left, y = e.clientY - r.top;
            if (calMode) {
                e.preventDefault();
                var imgPt = toImg(x, y);
                if (!calFirst) {
                    calFirst = imgPt;
                    draw();
                    setStatus('First ruler point set. Click the other end.');
                    return;
                }
                var mm = ($('rulerMm') && parseFloat($('rulerMm').value)) || 10;
                applyRuler(calFirst, imgPt, mm);
                return;
            }
            var id = hit(x, y);
            if (id) {
                pushUndo();
                sel = id;
                drag = id;
                refresh();
                return;
            }
            panning = { x: x, y: y, panX: panX, panY: panY };
        });
        window.addEventListener('mousemove', function (e) {
            if (panning) {
                var r = c.getBoundingClientRect();
                panX = panning.panX + (e.clientX - r.left - panning.x);
                panY = panning.panY + (e.clientY - r.top - panning.y);
                draw();
                return;
            }
            onMove(e);
        });
        window.addEventListener('mouseup', function () {
            panning = null;
            if (!drag) return;
            if (pts[drag]) touched[drag] = true;
            if (extra[drag]) extraTouched[drag] = true;
            drag = null;
            renderList();
        });
        c.addEventListener('wheel', function (e) {
            e.preventDefault();
            var next = viewZoom * (e.deltaY > 0 ? 0.9 : 1.1);
            if (next < 0.5) next = 0.5;
            if (next > 6) next = 6;
            viewZoom = next;
            draw();
        }, { passive: false });
        if ($('btnInvert')) $('btnInvert').onclick = function () { setInvert(!invertFilm); };
        if ($('btnUndoPt')) $('btnUndoPt').onclick = undoMove;
        if ($('btnResetView')) $('btnResetView').onclick = resetView;
        window.addEventListener('keydown', function (e) {
            if (!e.ctrlKey && !e.metaKey) return;
            if (e.key !== 'z' && e.key !== 'Z') return;
            if (e.shiftKey) return;
            var t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            e.preventDefault();
            undoMove();
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
        csvText: csvText,
        movePoint: function (id, x, y) { return setPointAt(id, { x: x, y: y }, true); },
        exportPng: exportPng,
        includeSelected: includeSelected,
        setUseTraining: writeUseTraining,
        setRefMode: setRefMode,
        setNormSet: writeNormSet,
        calibrate: applyRuler,
        startCalibrate: startCalibrate,
        highlightMeasure: highlightMeasure,
        undoMove: undoMove,
        resetView: resetView,
        setInvert: setInvert,
        saveTrace: saveTrace,
        loadTrace: loadTrace,
        printReport: printReport,
        setLabMode: setLabMode,
        qaScan: qaScan,
        extra: function () { return extra; },
        adoptSet: function (i) { return previewSet(i, true); },
        lockAdopt: lockAdopt,
        showSetBar: showSetBar,
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
                snaBand: last.result && last.result.groups && last.result.groups[0] && last.result.groups[0].rows[0] && last.result.groups[0].rows[0].band,
                snaNorm: last.result && last.result.groups && last.result.groups[0] && last.result.groups[0].rows[0] && last.result.groups[0].rows[0].norm,
                normSet: (last.result && last.result.normSet) || normSet,
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
                setBarHidden: !!setBarHidden,
                calibrated: !!calibrated,
                mmPerPx: mmPerPx,
                extra: extra,
                hiMeasure: hiMeasure,
                viewZoom: viewZoom,
                invert: !!invertFilm,
                summary: last.result && last.result.summary,
                labOpen: !!labOpen,
                qa: Object.keys(qaIds),
                selected: placedIds(),
                undoN: undoStack.length
            };
        }
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
