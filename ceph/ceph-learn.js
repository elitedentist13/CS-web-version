/* Clinic training set for lateral ceph — separate from the read-only
   1502 published ISBI + Aariz + PKU tracings in data/shapes.json.
   Each adopted auto-detect set is stored as one whole 19-point film. */
(function (g) {
    var KEY = 'banana.ceph.clinicTrain.v1';
    var LEGACY_KEY = 'banana.ceph.clinicRef.v1';
    var mem = null;
    var IDS_FALLBACK = ['S', 'N', 'Or', 'Po', 'A', 'B', 'Pog', 'Me', 'Gn', 'Go', 'L1', 'U1', 'Ls', 'Li', 'Sn', 'PogS', 'PNS', 'ANS', 'Ar'];
    var MAX_TRACES = 400;

    function ids() {
        if (g.CEPH_LM && typeof g.CEPH_LM.defs === 'function') {
            var d = g.CEPH_LM.defs() || [];
            if (d.length) return d.map(function (x) { return x.id; });
        }
        return IDS_FALLBACK.slice();
    }

    function emptyDb() {
        return { v: 1, kind: 'banana.ceph.clinicTrain', traces: [] };
    }

    function readStore() {
        if (mem) return mem;
        try {
            var raw = g.localStorage && g.localStorage.getItem(KEY);
            if (!raw && g.localStorage) raw = g.localStorage.getItem(LEGACY_KEY);
            if (!raw) return emptyDb();
            var db = JSON.parse(raw);
            if (!db || !Array.isArray(db.traces)) return emptyDb();
            db.kind = 'banana.ceph.clinicTrain';
            if (g.localStorage && !g.localStorage.getItem(KEY) && db.traces.length) {
                g.localStorage.setItem(KEY, JSON.stringify(db));
            }
            return db;
        } catch (e) {
            return emptyDb();
        }
    }

    function writeStore(db) {
        if (mem) { mem = db; return; }
        try {
            if (g.localStorage) g.localStorage.setItem(KEY, JSON.stringify(db));
        } catch (e) { /* quota / private mode */ }
    }

    function stats(db) {
        db = db || readStore();
        var films = (db.traces || []).length;
        var points = 0;
        (db.traces || []).forEach(function (t) {
            points += (t.included && t.included.length) ? t.included.length : 0;
        });
        return { films: films, points: points, kind: 'banana.ceph.clinicTrain' };
    }

    function placedIds(pts) {
        return ids().filter(function (id) {
            var pt = pts && pts[id];
            return pt && isFinite(pt.x) && isFinite(pt.y) && (pt.x !== 0 || pt.y !== 0);
        });
    }

    function normalizePts(pts, box, included) {
        var list = ids();
        var want = {};
        (included || []).forEach(function (id) { want[id] = true; });
        var p = [];
        var kept = [];
        list.forEach(function (id) {
            var pt = pts && pts[id];
            if (!want[id] || !pt || !isFinite(pt.x) || !isFinite(pt.y)) {
                p.push(null, null);
                return;
            }
            var nx = (pt.x - box.x) / Math.max(1e-6, box.w);
            var ny = (pt.y - box.y) / Math.max(1e-6, box.h);
            if (!isFinite(nx) || !isFinite(ny)) { p.push(null, null); return; }
            p.push(nx, ny);
            kept.push(id);
        });
        return { p: p, included: kept, a: box.w / Math.max(1e-6, box.h) };
    }

    function includeSelected(opts) {
        opts = opts || {};
        var pts = opts.pts || {};
        var included = placedIds(pts);
        if (!included.length) return { ok: false, error: 'none' };
        var box = opts.box;
        if (!box || !box.w || !box.h) {
            var xs = [], ys = [];
            included.forEach(function (id) {
                xs.push(pts[id].x);
                ys.push(pts[id].y);
            });
            var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
            var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
            var pad = 0.08;
            var bw = Math.max(8, maxX - minX);
            var bh = Math.max(8, maxY - minY);
            box = {
                x: minX - bw * pad,
                y: minY - bh * pad,
                w: bw * (1 + pad * 2),
                h: bh * (1 + pad * 2)
            };
        }
        var norm = normalizePts(pts, box, included);
        if (!norm.included.length) return { ok: false, error: 'none' };
        var db = readStore();
        var trace = {
            id: 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
            ts: new Date().toISOString(),
            fileName: String(opts.fileName || '').slice(0, 180),
            patientNo: String(opts.patientNo || '').slice(0, 32),
            setId: String(opts.setId || '').slice(0, 24),
            setLabel: String(opts.setLabel || '').slice(0, 40),
            included: norm.included,
            a: norm.a,
            p: norm.p,
            clinic: true,
            whole: true
        };
        db.traces.push(trace);
        if (db.traces.length > MAX_TRACES) db.traces = db.traces.slice(-MAX_TRACES);
        writeStore(db);
        var st = stats(db);
        st.ok = true;
        st.included = norm.included;
        st.id = trace.id;
        st.trace = trace;
        return st;
    }

    function undoLast() {
        var db = readStore();
        if (!db.traces.length) return stats(db);
        db.traces.pop();
        writeStore(db);
        return stats(db);
    }

    function clear() {
        writeStore(emptyDb());
        return stats();
    }

    function shapes() {
        var db = readStore();
        return {
            ids: ids(),
            n: db.traces.length,
            shapes: db.traces.map(function (t) {
                return { a: t.a, p: t.p, clinic: true, included: t.included };
            })
        };
    }

    function useMemory(db) {
        mem = db || emptyDb();
        return mem;
    }

    function useKey(k) {
        mem = null;
        if (k) KEY = k;
    }

    function placeTraining(box) {
        var lib = shapes();
        var empty = { pts: {}, films: 0, ids: [] };
        if (!box || !box.w || !box.h || !lib.n) return empty;
        var aspect = box.w / Math.max(1e-6, box.h);
        var scored = (lib.shapes || []).map(function (sh, i) {
            var a = (sh && sh.a != null) ? sh.a : aspect;
            return { i: i, d: Math.abs(a - aspect) };
        });
        scored.sort(function (a, b) { return a.d - b.d; });
        var k = Math.min(12, scored.length);
        var acc = {};
        lib.ids.forEach(function (id) { acc[id] = { x: 0, y: 0, n: 0 }; });
        var j, sh, p, x, y;
        for (j = 0; j < k; j++) {
            sh = lib.shapes[scored[j].i];
            p = sh.p || [];
            lib.ids.forEach(function (id, idx) {
                x = p[idx * 2];
                y = p[idx * 2 + 1];
                if (x == null || y == null || !isFinite(x) || !isFinite(y)) return;
                acc[id].x += x;
                acc[id].y += y;
                acc[id].n += 1;
            });
        }
        var pts = {};
        var used = [];
        lib.ids.forEach(function (id) {
            if (!acc[id].n) return;
            pts[id] = {
                x: box.x + (acc[id].x / acc[id].n) * box.w,
                y: box.y + (acc[id].y / acc[id].n) * box.h
            };
            used.push(id);
        });
        return { pts: pts, films: lib.n, ids: used, kind: 'banana.ceph.clinicTrain' };
    }

    function postRemote(trace, apiBase) {
        var url = String(apiBase || (g.XRAY_AI_API_URL || 'http://127.0.0.1:8877')).replace(/\/$/, '') + '/ceph/reference';
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(trace)
        }).then(function (r) { return r.ok; }).catch(function () { return false; });
    }

    function pullRemote(apiBase) {
        var url = String(apiBase || (g.XRAY_AI_API_URL || 'http://127.0.0.1:8877')).replace(/\/$/, '') + '/ceph/reference';
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error('http');
            return r.json();
        }).then(function (j) {
            var remote = (j && j.traces) || [];
            if (!remote.length) return stats();
            var db = readStore();
            var have = {};
            db.traces.forEach(function (t) { if (t.id) have[t.id] = true; });
            var n = 0;
            remote.forEach(function (t) {
                if (!t || !t.id || have[t.id] || !Array.isArray(t.p)) return;
                db.traces.push(t);
                have[t.id] = true;
                n++;
            });
            if (n) writeStore(db);
            var st = stats(db);
            st.pulled = n;
            return st;
        }).catch(function () { return stats(); });
    }

    g.CEPH_LEARN = {
        stats: stats,
        includeSelected: includeSelected,
        undoLast: undoLast,
        clear: clear,
        shapes: shapes,
        placeTraining: placeTraining,
        useMemory: useMemory,
        useKey: useKey,
        postRemote: postRemote,
        pullRemote: pullRemote,
        ids: ids
    };
})(typeof window !== 'undefined' ? window : this);
