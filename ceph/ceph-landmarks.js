/* ISBI 2015 19-landmark set. Auto-place uses the empirical mean of
   ISBI + Aariz + PKU/DentalCepha tracings, then a local edge/darkness snap.
   Images are not shipped. */
(function (g) {
    var CAT = null;
    var SHAPES = null;

    function loadCatalog(done) {
        if (CAT && SHAPES) {
            if (done) done(CAT);
            return Promise.resolve(CAT);
        }
        return Promise.all([
            fetch('data/isbi2015.json').then(function (r) { return r.json(); }),
            fetch('data/shapes.json').then(function (r) { return r.json(); }).catch(function () { return null; })
        ]).then(function (pair) {
            CAT = pair[0];
            SHAPES = pair[1];
            if (done) done(CAT);
            return CAT;
        });
    }

    function defs() {
        return (CAT && CAT.landmarks) || [];
    }

    function emptyPts() {
        var o = {};
        defs().forEach(function (d) { o[d.id] = { x: 0, y: 0 }; });
        return o;
    }

    function findHeadBox(img) {
        var max = 320;
        var s = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        var w = Math.max(1, Math.round((img.naturalWidth || 1) * s));
        var h = Math.max(1, Math.round((img.naturalHeight || 1) * s));
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        var data = ctx.getImageData(0, 0, w, h).data;
        var hist = new Array(256);
        var i, y, x, lu, acc, mid, med, k;
        for (i = 0; i < 256; i++) hist[i] = 0;
        for (i = 0; i < data.length; i += 4) {
            lu = (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11) | 0;
            hist[lu]++;
        }
        mid = (w * h) / 2; acc = 0; med = 128;
        for (k = 0; k < 256; k++) { acc += hist[k]; if (acc >= mid) { med = k; break; } }
        var minX = w, minY = h, maxX = 0, maxY = 0, n = 0;
        for (y = 0; y < h; y++) {
            for (x = 0; x < w; x++) {
                i = (y * w + x) * 4;
                lu = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
                if (Math.abs(lu - med) > 22) {
                    n++;
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (n < 40) {
            return { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
        }
        var pad = 0.04;
        var bw = (maxX - minX + 1) / s;
        var bh = (maxY - minY + 1) / s;
        var bx = minX / s;
        var by = minY / s;
        return {
            x: Math.max(0, bx - bw * pad),
            y: Math.max(0, by - bh * pad),
            w: Math.min(img.naturalWidth, bw * (1 + pad * 2)),
            h: Math.min(img.naturalHeight, bh * (1 + pad * 2))
        };
    }

    function placeOn(box, keyX, keyY) {
        var pts = {};
        defs().forEach(function (d) {
            var nx = d[keyX], ny = d[keyY];
            if (nx == null || ny == null) { nx = d.nx; ny = d.ny; }
            pts[d.id] = {
                x: box.x + nx * box.w,
                y: box.y + ny * box.h
            };
        });
        return pts;
    }

    function placeMean(img, box) {
        return placeOn(box || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }, 'nx', 'ny');
    }

    function placeImgMean(img) {
        return placeOn({ x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }, 'ix', 'iy');
    }

    function clonePts(pts) {
        var o = {};
        Object.keys(pts || {}).forEach(function (id) {
            var p = pts[id];
            o[id] = p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
        });
        return o;
    }

    function localBoxMean(box, kWant) {
        var list = SHAPES && SHAPES.shapes;
        var ids = (SHAPES && SHAPES.ids) || IDS_FALLBACK();
        if (!list || !list.length) return placeOn(box, 'nx', 'ny');
        var aspect = box.w / Math.max(1, box.h);
        var scored = list.map(function (sh, i) {
            var a = (sh && sh.a != null) ? sh.a : (CAT && CAT.meanBoxAspect) || 0.89;
            return { i: i, d: Math.abs(a - aspect) };
        });
        scored.sort(function (a, b) { return a.d - b.d; });
        var k = Math.min(kWant || 24, scored.length);
        var acc = {};
        var j, p, sh;
        ids.forEach(function (id) { acc[id] = { x: 0, y: 0 }; });
        for (j = 0; j < k; j++) {
            sh = list[scored[j].i];
            p = sh.p || sh;
            ids.forEach(function (id, idx) {
                acc[id].x += p[idx * 2];
                acc[id].y += p[idx * 2 + 1];
            });
        }
        var pts = {};
        ids.forEach(function (id) {
            pts[id] = {
                x: box.x + (acc[id].x / k) * box.w,
                y: box.y + (acc[id].y / k) * box.h
            };
        });
        return pts;
    }

    function IDS_FALLBACK() {
        return defs().map(function (d) { return d.id; });
    }

    function grayProxy(img) {
        var max = 400;
        var s = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
        var w = Math.max(1, Math.round((img.naturalWidth || 1) * s));
        var h = Math.max(1, Math.round((img.naturalHeight || 1) * s));
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        return { data: ctx.getImageData(0, 0, w, h).data, w: w, h: h, s: s };
    }

    function luAt(g, x, y) {
        x = Math.max(0, Math.min(g.w - 1, x | 0));
        y = Math.max(0, Math.min(g.h - 1, y | 0));
        var i = (y * g.w + x) * 4;
        return g.data[i] * 0.3 + g.data[i + 1] * 0.59 + g.data[i + 2] * 0.11;
    }

    function diskMean(g, x, y, r) {
        var acc = 0, n = 0, dy, dx;
        for (dy = -r; dy <= r; dy++) {
            for (dx = -r; dx <= r; dx++) {
                if (dx * dx + dy * dy > r * r) continue;
                acc += luAt(g, x + dx, y + dy);
                n++;
            }
        }
        return n ? acc / n : 128;
    }

    function gradAt(g, x, y) {
        return {
            gx: luAt(g, x + 1, y) - luAt(g, x - 1, y),
            gy: luAt(g, x, y + 1) - luAt(g, x, y - 1)
        };
    }

    function edgeScore(g, id, x, y) {
        var gr = gradAt(g, x, y);
        var mag = Math.hypot(gr.gx, gr.gy);
        if (id === 'S' || id === 'Po' || id === 'Ar') return 255 - diskMean(g, x, y, 3);
        if (id === 'Me' || id === 'Gn') return mag + gr.gy * 0.45;
        if (id === 'N') return mag + gr.gx * 0.4;
        if (id === 'A' || id === 'ANS') return mag + gr.gx * 0.3;
        if (id === 'Pog' || id === 'Go' || id === 'Or') return mag;
        if (id === 'U1' || id === 'L1') return mag;
        return mag * 0.55;
    }

    var SNAP = { S: 1, Me: 1, Go: 1, Po: 1, Or: 1, Ar: 1, Pog: 1, ANS: 1 };

    function refinePts(img, pts, scaleX, scaleY, useImgStd) {
        var g = grayProxy(img);
        var out = {};
        defs().forEach(function (d) {
            var p = pts[d.id];
            if (!p) return;
            if (!SNAP[d.id]) { out[d.id] = { x: p.x, y: p.y }; return; }
            var sx = useImgStd ? (d.isx || 0.03) : (d.sx || 0.04);
            var sy = useImgStd ? (d.isy || 0.03) : (d.sy || 0.04);
            var capX = Math.max(4, sx * scaleX * 1.15);
            var capY = Math.max(4, sy * scaleY * 1.15);
            var winX = capX * g.s, winY = capY * g.s;
            var cx = p.x * g.s, cy = p.y * g.s;
            var bestX = cx, bestY = cy, best = edgeScore(g, d.id, cx, cy);
            var step = Math.max(1, Math.round(Math.min(winX, winY) / 6));
            var x, y, sc;
            for (y = cy - winY; y <= cy + winY; y += step) {
                for (x = cx - winX; x <= cx + winX; x += step) {
                    sc = edgeScore(g, d.id, x, y);
                    if (sc > best) { best = sc; bestX = x; bestY = y; }
                }
            }
            out[d.id] = {
                x: (p.x * 0.55) + (bestX / g.s) * 0.45,
                y: (p.y * 0.55) + (bestY / g.s) * 0.45
            };
        });
        return out;
    }

    function overlayTraining(pts, box, useTraining) {
        var out = clonePts(pts);
        var train = { pts: {}, films: 0, ids: [] };
        if (useTraining && g.CEPH_LEARN && typeof g.CEPH_LEARN.placeTraining === 'function') {
            train = g.CEPH_LEARN.placeTraining(box) || train;
            (train.ids || Object.keys(train.pts || {})).forEach(function (id) {
                if (train.pts && train.pts[id]) out[id] = { x: train.pts[id].x, y: train.pts[id].y };
            });
        }
        return {
            pts: out,
            films: train.films || 0,
            ids: train.ids || [],
            used: !!(useTraining && train.films)
        };
    }

    function detectSets(img, opts) {
        if (!img || !img.naturalWidth) {
            return { sets: [], defaultIndex: 0, box: null, films: 0, clinic: 0, trainingSource: '', usedTraining: false };
        }
        opts = opts || {};
        var useTraining = !!opts.useTraining;
        var box = findHeadBox(img);
        var area = (box.w * box.h) / Math.max(1, img.naturalWidth * img.naturalHeight);
        var n = (CAT && CAT.importedFilms) || (SHAPES && SHAPES.n) || 1502;
        var prefix = 'isbi+aariz+pku-' + n;
        var imgMean = placeImgMean(img);
        var boxMean = localBoxMean(box, 24);
        var closeMean = localBoxMean(box, 8);
        var imgEdge = refinePts(img, imgMean, img.naturalWidth, img.naturalHeight, true);
        var boxEdge = refinePts(img, boxMean, box.w, box.h, false);
        var closeEdge = refinePts(img, closeMean, box.w, box.h, false);
        var over = overlayTraining(boxEdge, box, useTraining);
        var trainSrc = over.used ? ('clinic-train-' + over.films) : '';
        var fifth = over.used
            ? { id: 'clinic', label: 'Clinic overlay', source: prefix + '-boxmean+edge; training:' + trainSrc, pts: over.pts, publishedSource: prefix + '-boxmean+edge', trainingSource: trainSrc }
            : { id: 'close', label: 'Close-match', source: prefix + '-boxmean8+edge', pts: clonePts(closeEdge), publishedSource: prefix + '-boxmean8+edge', trainingSource: '' };
        var sets = [
            { id: 'img', label: 'Image mean', source: prefix + '-imgmean', pts: clonePts(imgMean), publishedSource: prefix + '-imgmean' },
            { id: 'box', label: 'Head-box', source: prefix + '-boxmean', pts: clonePts(boxMean), publishedSource: prefix + '-boxmean' },
            { id: 'imgEdge', label: 'Image + edge', source: prefix + '-imgmean+edge', pts: clonePts(imgEdge), publishedSource: prefix + '-imgmean+edge' },
            { id: 'boxEdge', label: 'Box + edge', source: prefix + '-boxmean+edge', pts: clonePts(boxEdge), publishedSource: prefix + '-boxmean+edge' },
            fifth
        ];
        var defaultIndex = over.used ? 4 : (area >= 0.68 ? 2 : 3);
        return {
            sets: sets,
            defaultIndex: defaultIndex,
            box: box,
            films: n,
            clinic: over.films || 0,
            trainingSource: trainSrc,
            usedTraining: over.used,
            area: area
        };
    }

    function detectLocal(img, opts) {
        var pack = detectSets(img, opts);
        var i = pack.defaultIndex || 0;
        var s = (pack.sets && pack.sets[i]) || { pts: emptyPts(), source: 'empty', publishedSource: '' };
        return {
            pts: s.pts,
            source: s.source,
            publishedSource: s.publishedSource || s.source,
            trainingSource: pack.trainingSource || '',
            box: pack.box,
            films: pack.films,
            clinic: pack.clinic || 0,
            usedTraining: !!pack.usedTraining,
            sets: pack.sets,
            setIndex: i
        };
    }

    function applyRemote(payload, img) {
        var pts = emptyPts();
        var list = (payload && (payload.landmarks || payload.points)) || [];
        var i, p, id;
        for (i = 0; i < list.length; i++) {
            p = list[i];
            id = p.id || p.name;
            if (!id && p.i) {
                defs().forEach(function (d) { if (d.i === p.i) id = d.id; });
            }
            if (id && pts[id] !== undefined) {
                pts[id] = { x: Number(p.x), y: Number(p.y) };
            }
        }
        return { pts: pts, source: payload && payload.source ? payload.source : 'api' };
    }

    function detectApi(img, apiBase) {
        return new Promise(function (resolve, reject) {
            var c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            c.toBlob(function (blob) {
                if (!blob) { reject(new Error('blob')); return; }
                var fd = new FormData();
                fd.append('file', blob, 'ceph.jpg');
                fetch(String(apiBase || '').replace(/\/$/, '') + '/ceph/landmarks', {
                    method: 'POST',
                    body: fd
                }).then(function (r) {
                    if (!r.ok) throw new Error('http ' + r.status);
                    return r.json();
                }).then(function (j) { resolve(applyRemote(j, img)); }).catch(reject);
            }, 'image/jpeg', 0.9);
        });
    }

    function publishedStats() {
        return {
            films: (CAT && CAT.importedFilms) || (SHAPES && SHAPES.n) || 1502,
            ids: ((SHAPES && SHAPES.ids) || IDS_FALLBACK()).length,
            dataset: 'ISBI2015+Aariz+PKU',
            kind: 'published'
        };
    }

    g.CEPH_LM = {
        loadCatalog: loadCatalog,
        defs: defs,
        emptyPts: emptyPts,
        detectLocal: detectLocal,
        detectSets: detectSets,
        detectApi: detectApi,
        placeMean: placeMean,
        findHeadBox: findHeadBox,
        publishedStats: publishedStats
    };
})(typeof window !== 'undefined' ? window : this);
