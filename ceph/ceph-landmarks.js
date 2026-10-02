/* ISBI 2015 19-landmark set. Auto-place uses the empirical mean of 400
   published senior tracings (Hugging Face + GitHub CSVs). Images are not shipped. */
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

    function localBoxMean(box) {
        var list = SHAPES && SHAPES.shapes;
        var ids = (SHAPES && SHAPES.ids) || IDS_FALLBACK();
        if (!list || !list.length) return placeOn(box, 'nx', 'ny');
        var aspect = box.w / Math.max(1, box.h);
        var scored = list.map(function (sh, i) {
            var a = (sh && sh.a != null) ? sh.a : (CAT && CAT.meanBoxAspect) || 0.89;
            return { i: i, d: Math.abs(a - aspect) };
        });
        scored.sort(function (a, b) { return a.d - b.d; });
        var k = Math.min(24, scored.length);
        var acc = {};
        var j, p, id, sh;
        for (j = 0; j < ids.length; j++) acc[ids[j]] = { x: 0, y: 0 };
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

    function detectLocal(img) {
        if (!img || !img.naturalWidth) return { pts: emptyPts(), source: 'empty' };
        var box = findHeadBox(img);
        var area = (box.w * box.h) / Math.max(1, img.naturalWidth * img.naturalHeight);
        var n = (SHAPES && SHAPES.n) || (CAT && CAT.importedFilms) || 400;
        if (area >= 0.68) {
            return {
                pts: placeImgMean(img),
                source: 'isbi2015-' + n + '-imgmean',
                box: box,
                films: n
            };
        }
        return {
            pts: localBoxMean(box),
            source: 'isbi2015-' + n + '-boxmean',
            box: box,
            films: n
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

    g.CEPH_LM = {
        loadCatalog: loadCatalog,
        defs: defs,
        emptyPts: emptyPts,
        detectLocal: detectLocal,
        detectApi: detectApi,
        placeMean: placeMean
    };
})(typeof window !== 'undefined' ? window : this);
