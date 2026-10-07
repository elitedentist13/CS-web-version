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

    function catalogNorm() {
        var norm = {};
        defs().forEach(function (d) {
            if (d.nx == null || d.ny == null) return;
            norm[d.id] = { x: d.nx, y: d.ny };
        });
        return norm;
    }

    function averageShapes(indices) {
        var list = SHAPES && SHAPES.shapes;
        var ids = (SHAPES && SHAPES.ids) || IDS_FALLBACK();
        if (!list || !list.length || !indices || !indices.length) return catalogNorm();
        var acc = {};
        var j, p, sh, k;
        ids.forEach(function (id) { acc[id] = { x: 0, y: 0 }; });
        k = indices.length;
        for (j = 0; j < k; j++) {
            sh = list[indices[j]];
            p = sh && (sh.p || sh);
            if (!p) continue;
            ids.forEach(function (id, idx) {
                acc[id].x += p[idx * 2];
                acc[id].y += p[idx * 2 + 1];
            });
        }
        var norm = {};
        ids.forEach(function (id) {
            norm[id] = { x: acc[id].x / k, y: acc[id].y / k };
        });
        return norm;
    }

    function allShapeIndices() {
        var list = SHAPES && SHAPES.shapes;
        var idx = [];
        var i;
        if (!list) return idx;
        for (i = 0; i < list.length; i++) idx.push(i);
        return idx;
    }

    function neighbourIndices(box, kWant) {
        var list = SHAPES && SHAPES.shapes;
        if (!list || !list.length) return [];
        var aspect = box.w / Math.max(1, box.h);
        var scored = list.map(function (sh, i) {
            var a = (sh && sh.a != null) ? sh.a : (CAT && CAT.meanBoxAspect) || 0.89;
            return { i: i, d: Math.abs(a - aspect) };
        });
        scored.sort(function (a, b) { return a.d - b.d; });
        var want = Math.min(kWant || 24, scored.length);
        var close = scored.filter(function (s) { return s.d <= 0.12; });
        if (close.length < 8) close = scored.slice(0, want);
        else if (close.length > want) close = close.slice(0, want);
        return close.map(function (s) { return s.i; });
    }

    function placeNormOnBox(norm, box) {
        var pts = {};
        Object.keys(norm || {}).forEach(function (id) {
            var n = norm[id];
            pts[id] = {
                x: box.x + n.x * box.w,
                y: box.y + n.y * box.h
            };
        });
        return pts;
    }

    function localBoxMean(box, kWant) {
        var norm = averageShapes(neighbourIndices(box, kWant));
        if (!norm.Po) return placeOn(box, 'nx', 'ny');
        return placeNormOnBox(norm, box);
    }

    function globalBoxMean(box) {
        var list = SHAPES && SHAPES.shapes;
        var idx = [];
        var i;
        if (list && list.length) {
            for (i = 0; i < list.length; i++) idx.push(i);
        }
        var norm = averageShapes(idx);
        if (!norm.Po) return placeOn(box, 'nx', 'ny');
        return placeNormOnBox(norm, box);
    }

    // Po is the white circle at the ear hole. Po–Pog sets the direction, then the
    // 1502 shape is drawn at three quarters of that length so it stays inside the skull.
    var PO_POG_LIMIT_IDS = { S: 1, N: 1, A: 1, B: 1, Go: 1, Me: 1, Po: 1, Or: 1, Ar: 1 };

    function peelOutliers(list, marginX, marginY) {
        if (list.length < 5) return list;
        var kept = list.slice();
        var guard = 0;
        var changed = true;
        while (changed && kept.length >= 5 && guard < 3) {
            guard += 1;
            changed = false;
            var i, worst = -1, worstOver = 1;
            for (i = 0; i < kept.length; i++) {
                var others = [];
                var j;
                for (j = 0; j < kept.length; j++) if (j !== i) others.push(kept[j]);
                var ext = extentsOf(others);
                var overX = 0;
                var overY = 0;
                if (kept[i].x < ext.minx) overX = (ext.minx - kept[i].x) / ext.w;
                else if (kept[i].x > ext.maxx) overX = (kept[i].x - ext.maxx) / ext.w;
                if (kept[i].y < ext.miny) overY = (ext.miny - kept[i].y) / ext.h;
                else if (kept[i].y > ext.maxy) overY = (kept[i].y - ext.maxy) / ext.h;
                var over = Math.max(overX / marginX, overY / marginY);
                if (over > worstOver) { worstOver = over; worst = i; }
            }
            if (worst >= 0) {
                kept.splice(worst, 1);
                changed = true;
            }
        }
        return kept.length >= 4 ? kept : list;
    }

    function poPogLimit(guide, po) {
        var list = [];
        Object.keys(PO_POG_LIMIT_IDS).forEach(function (id) {
            var p = guide[id];
            if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
            list.push({ id: id, x: p.x, y: p.y });
        });
        if (list.length < 4) return 0;
        var core = peelOutliers(list, 0.28, 0.28);
        var maxD = 0;
        var i, p;
        for (i = 0; i < core.length; i++) {
            p = core[i];
            if (p.id === 'Po') continue;
            maxD = Math.max(maxD, Math.hypot(p.x - po.x, p.y - po.y));
        }
        if (!(maxD > 8)) return 0;
        return maxD;
    }

    function skullShrink(out, po, guide) {
        var list = [];
        Object.keys(PO_POG_LIMIT_IDS).forEach(function (id) {
            var p = guide[id];
            if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
            list.push({ id: id, x: p.x, y: p.y });
        });
        if (list.length < 4) return 1;
        var ext = extentsOf(peelOutliers(list, 0.28, 0.28));
        var minx = ext.minx;
        var maxx = ext.maxx;
        var miny = ext.miny;
        var maxy = ext.maxy;
        var shrink = 1;
        Object.keys(out).forEach(function (id) {
            var dx = out[id].x - po.x;
            var dy = out[id].y - po.y;
            if (dx > 1 && po.x + dx > maxx) shrink = Math.min(shrink, (maxx - po.x) / dx);
            if (dx < -1 && po.x + dx < minx) shrink = Math.min(shrink, (minx - po.x) / dx);
            if (dy > 1 && po.y + dy > maxy) shrink = Math.min(shrink, (maxy - po.y) / dy);
            if (dy < -1 && po.y + dy < miny) shrink = Math.min(shrink, (miny - po.y) / dy);
        });
        return (shrink > 0 && shrink < 1) ? shrink : 1;
    }

    function placeByPoPog(norm, guide) {
        var po = guide && guide.Po;
        var pog = guide && guide.Pog;
        var dPo = norm && norm.Po;
        var dPog = norm && norm.Pog;
        if (!po || !pog || !dPo || !dPog) return null;
        if (!isFinite(po.x) || !isFinite(po.y) || !isFinite(pog.x) || !isFinite(pog.y)) return null;
        var aspect = (CAT && CAT.meanBoxAspect) || 0.948;
        var ddx = (dPog.x - dPo.x) * aspect;
        var ddy = dPog.y - dPo.y;
        var dLen = Math.hypot(ddx, ddy);
        var pdx = pog.x - po.x;
        var pdy = pog.y - po.y;
        var pLen = Math.hypot(pdx, pdy);
        if (!(dLen > 0.05) || !(pLen > 8)) return null;
        var cap = poPogLimit(guide, po);
        if (cap && pLen > cap) {
            pdx *= cap / pLen;
            pdy *= cap / pLen;
            pLen = cap;
        }
        var scale = (pLen / dLen) * 0.75;
        var ang = Math.atan2(pdy, pdx) - Math.atan2(ddy, ddx);
        var cos = Math.cos(ang);
        var sin = Math.sin(ang);
        var out = {};
        Object.keys(norm).forEach(function (id) {
            var n = norm[id];
            if (!n) return;
            var x = (n.x - dPo.x) * aspect;
            var y = n.y - dPo.y;
            out[id] = {
                x: po.x + (x * cos - y * sin) * scale,
                y: po.y + (x * sin + y * cos) * scale
            };
        });
        if (!out.Po || !out.Pog) return null;
        var fit = skullShrink(out, po, guide);
        if (fit < 1) {
            Object.keys(out).forEach(function (id) {
                out[id] = {
                    x: po.x + (out[id].x - po.x) * fit,
                    y: po.y + (out[id].y - po.y) * fit
                };
            });
        }
        return out;
    }

    function catalogIdSet() {
        var o = {};
        defs().forEach(function (d) { o[d.id] = true; });
        return o;
    }

    function boxPad() {
        if (SHAPES && SHAPES.pad != null) return Number(SHAPES.pad);
        if (CAT && CAT.bboxPad != null) return Number(CAT.bboxPad);
        return 0.06;
    }

    // The 1502 shape is scaled to this rectangle. Size it from the bony
    // landmarks, then keep a point only if it still sits near that skull.
    var BONY_BOX = { S: 1, N: 1, A: 1, B: 1, Go: 1, Me: 1 };
    var BOX_MARGIN_X = 0.55;
    var BOX_MARGIN_Y = 0.40;

    function dropFarBony(list) {
        if (list.length < 5) return list;
        var kept = list.slice();
        var guard = 0;
        var changed = true;
        while (changed && kept.length >= 5 && guard < 3) {
            guard += 1;
            changed = false;
            var i, worst = -1, worstOver = 1;
            for (i = 0; i < kept.length; i++) {
                var others = [];
                var j;
                for (j = 0; j < kept.length; j++) if (j !== i) others.push(kept[j]);
                var ext = extentsOf(others);
                var overX = 0;
                var overY = 0;
                if (kept[i].x < ext.minx) overX = (ext.minx - kept[i].x) / ext.w;
                else if (kept[i].x > ext.maxx) overX = (kept[i].x - ext.maxx) / ext.w;
                if (kept[i].y < ext.miny) overY = (ext.miny - kept[i].y) / ext.h;
                else if (kept[i].y > ext.maxy) overY = (kept[i].y - ext.maxy) / ext.h;
                var over = Math.max(overX / BOX_MARGIN_X, overY / BOX_MARGIN_Y);
                if (over > worstOver) { worstOver = over; worst = i; }
            }
            if (worst >= 0) {
                kept.splice(worst, 1);
                changed = true;
            }
        }
        return kept.length >= 4 ? kept : list;
    }

    function extentsOf(list) {
        var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity, i, p;
        for (i = 0; i < list.length; i++) {
            p = list[i];
            if (p.x < minx) minx = p.x;
            if (p.y < miny) miny = p.y;
            if (p.x > maxx) maxx = p.x;
            if (p.y > maxy) maxy = p.y;
        }
        return {
            minx: minx, miny: miny, maxx: maxx, maxy: maxy,
            w: Math.max(1, maxx - minx),
            h: Math.max(1, maxy - miny)
        };
    }

    function pointsInSkull(all, core) {
        var ext = extentsOf(core);
        var mx = ext.w * BOX_MARGIN_X;
        var my = ext.h * BOX_MARGIN_Y;
        var kept = [], i, p;
        for (i = 0; i < all.length; i++) {
            p = all[i];
            if (p.x < ext.minx - mx || p.x > ext.maxx + mx) continue;
            if (p.y < ext.miny - my || p.y > ext.maxy + my) continue;
            kept.push(p);
        }
        return kept.length ? kept : core;
    }

    function boxFromPts(pts, img) {
        var ids = catalogIdSet();
        var all = [], bony = [], id, p, row, kept, ext, pad, box;
        for (id in pts) {
            if (!Object.prototype.hasOwnProperty.call(pts, id) || !ids[id]) continue;
            p = pts[id];
            if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
            row = { id: id, x: p.x, y: p.y };
            all.push(row);
            if (BONY_BOX[id]) bony.push(row);
        }
        if (all.length < 8) return null;
        var core = dropFarBony(bony);
        kept = core.length >= 4 ? pointsInSkull(all, core) : all;
        if (kept.length < 4) return null;
        ext = extentsOf(kept);
        pad = boxPad();
        box = {
            x: ext.minx - ext.w * pad,
            y: ext.miny - ext.h * pad,
            w: ext.w * (1 + 2 * pad),
            h: ext.h * (1 + 2 * pad),
            via: 'unet'
        };
        if (img && img.naturalWidth) {
            if (box.w > img.naturalWidth * 1.5 || box.h > img.naturalHeight * 1.5) return null;
        }
        return box;
    }

    function libPrefix() {
        var n = (CAT && CAT.importedFilms) || (SHAPES && SHAPES.n) || 1502;
        return 'isbi+aariz+pku-' + n;
    }

    function placeLibAverage(img, box, opts) {
        opts = opts || {};
        var useTraining = !!opts.useTraining;
        var all = !!opts.all;
        var prefix = libPrefix();
        var tag = all
            ? ((box && box.via === 'unet') ? 'allmean+unetbox' : 'allmean')
            : ((box && box.via === 'unet') ? 'boxmean+unetbox' : 'boxmean+edge');
        var norm = averageShapes(all ? allShapeIndices() : neighbourIndices(box, opts.k || 24));
        var fitted = placeByPoPog(norm, opts.guidePts);
        var fitBox = box ? {
            x: box.x + box.w * 0.125,
            y: box.y + box.h * 0.125,
            w: box.w * 0.75,
            h: box.h * 0.75,
            via: box.via
        } : box;
        var mean = fitted || (norm.Po ? placeNormOnBox(norm, fitBox) : (all ? globalBoxMean(fitBox) : localBoxMean(fitBox, opts.k || 24)));
        if (fitted) tag += '+popog';
        var spanW = box.w;
        var spanH = box.h;
        if (fitted) {
            var span = extentsOf(Object.keys(mean).map(function (id) { return mean[id]; }));
            spanW = span.w;
            spanH = span.h;
        }
        var pts = (all || opts.snap === false) ? mean : refinePts(img, mean, spanW, spanH, false);
        var over = overlayTraining(pts, box, useTraining);
        var trainSrc = over.used ? ('clinic-train-' + over.films) : '';
        return {
            id: all ? 'lib1502all' : 'lib1502',
            label: all
                ? (over.used ? '1502 mean + self-training' : '1502 library mean (all films)')
                : (over.used ? '1502 + self-training library average' : '1502 library ± self-training average'),
            source: prefix + '-' + tag + (trainSrc ? ('; training:' + trainSrc) : ''),
            publishedSource: prefix + '-' + tag,
            trainingSource: trainSrc,
            pts: clonePts(over.used ? over.pts : pts),
            box: box,
            usedTraining: over.used,
            clinicFilms: over.films || 0
        };
    }

    function guideBox(img, guidePts) {
        var box = boxFromPts(guidePts, img);
        if (!box) {
            box = findHeadBox(img);
            box.via = 'head';
        }
        return box;
    }

    function withGuide(opts, guidePts, all) {
        var next = {};
        opts = opts || {};
        Object.keys(opts).forEach(function (k) { next[k] = opts[k]; });
        next.guidePts = guidePts;
        if (all) next.all = true;
        return next;
    }

    function fitLibToGuide(img, guidePts, opts) {
        return placeLibAverage(img, guideBox(img, guidePts), withGuide(opts, guidePts, false));
    }

    function fitLibAll(img, guidePts, opts) {
        return placeLibAverage(img, guideBox(img, guidePts), withGuide(opts, guidePts, true));
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
        var prefix = libPrefix();
        var imgMean = placeImgMean(img);
        var imgEdge = refinePts(img, imgMean, img.naturalWidth, img.naturalHeight, true);
        var lib = placeLibAverage(img, box, { useTraining: useTraining });
        var libAll = placeLibAverage(img, lib.box || box, { useTraining: useTraining, all: true });
        var sets = [
            {
                id: 'unet',
                label: 'UNet auto landmarks',
                source: prefix + '-imgmean+edge',
                publishedSource: prefix + '-imgmean+edge',
                pts: clonePts(imgEdge)
            },
            lib,
            libAll
        ];
        return {
            sets: sets,
            defaultIndex: 0,
            box: lib.box || box,
            films: (CAT && CAT.importedFilms) || (SHAPES && SHAPES.n) || 1502,
            clinic: lib.clinicFilms || 0,
            trainingSource: lib.trainingSource || '',
            usedTraining: !!lib.usedTraining,
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
        var extra = {};
        var extras = (payload && payload.extra) || [];
        for (i = 0; i < extras.length; i++) {
            p = extras[i];
            id = p && (p.id || p.name);
            if (id && p.x != null && p.y != null) extra[id] = { x: Number(p.x), y: Number(p.y) };
        }
        return {
            pts: pts,
            extra: extra,
            source: payload && payload.source ? payload.source : 'api',
            via: payload && payload.via
        };
    }

    function cephAiBase(apiBase) {
        return String(apiBase || g.XRAY_AI_API_URL || 'http://127.0.0.1:8877').replace(/\/$/, '');
    }
    function cephAiProtocol() {
        try {
            if (g.opener && !g.opener.closed && typeof g.opener.xrayAiProtocolFetch === 'function') {
                return g.opener.xrayAiProtocolFetch;
            }
        } catch (e) { /* ignore */ }
        return null;
    }
    function cephAiDirect(url, options) {
        return fetch(url, options || {});
    }
    function cephAiWake() {
        var href = '';
        try {
            if (g.opener && !g.opener.closed && typeof g.opener.xrayAiProtocolClaimLaunch === 'function') {
                href = g.opener.xrayAiProtocolClaimLaunch() || '';
            }
        } catch (e) { /* ignore */ }
        if (!href) return;
        try {
            var link = g.document.createElement('a');
            link.href = href;
            link.style.display = 'none';
            (g.document.body || g.document.documentElement).appendChild(link);
            link.click();
            link.remove();
        } catch (e2) { /* ignore */ }
    }
    function cephAiFetch(url, options, ms) {
        var call = cephAiProtocol();
        if (!call) return cephAiDirect(url, options);
        return call(url, options || {}, ms || 240000).then(function (r) {
            return r;
        }, function () {
            return cephAiDirect(url, options);
        });
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
                cephAiFetch(cephAiBase(apiBase) + '/ceph/landmarks', {
                    method: 'POST',
                    body: fd
                }, 240000).then(function (r) {
                    if (!r.ok) throw new Error('http ' + r.status);
                    return r.json();
                }).then(function (j) { resolve(applyRemote(j, img)); }).catch(reject);
            }, 'image/jpeg', 0.9);
        });
    }

    function detectCvmApi(img, apiBase, extraPts) {
        return new Promise(function (resolve, reject) {
            if (!img || !img.naturalWidth) { reject(new Error('image')); return; }
            var c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            c.toBlob(function (blob) {
                if (!blob) { reject(new Error('blob')); return; }
                var fd = new FormData();
                fd.append('file', blob, 'ceph.jpg');
                if (extraPts) {
                    try { fd.append('landmarks', JSON.stringify(extraPts)); } catch (e) { /* ignore */ }
                }
                cephAiFetch(cephAiBase(apiBase) + '/ceph/cvm', {
                    method: 'POST',
                    body: fd
                }, 240000).then(function (r) {
                    return r.json().then(function (j) {
                        if (!r.ok) {
                            var err = new Error((j && j.detail && j.detail.error) || ('http ' + r.status));
                            err.status = r.status;
                            err.body = j;
                            throw err;
                        }
                        return j;
                    });
                }).then(resolve).catch(reject);
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
        aiFetch: cephAiFetch,
        wakeProtocol: cephAiWake,
        detectCvmApi: detectCvmApi,
        placeMean: placeMean,
        findHeadBox: findHeadBox,
        boxFromPts: boxFromPts,
        fitLibToGuide: fitLibToGuide,
        placeByPoPog: placeByPoPog,
        fitLibAll: fitLibAll,
        placeLibAverage: placeLibAverage,
        publishedStats: publishedStats
    };
})(typeof window !== 'undefined' ? window : this);
