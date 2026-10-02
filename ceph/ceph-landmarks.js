/* ISBI 2015 19-landmark set + mean-shape auto placement.
   Images are not shipped. Mean (nx, ny) is a right-facing template. */
(function (g) {
    var CAT = null;

    function loadCatalog(done) {
        if (CAT) { if (done) done(CAT); return Promise.resolve(CAT); }
        return fetch('data/isbi2015.json').then(function (r) { return r.json(); }).then(function (j) {
            CAT = j;
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

    function placeMean(img, box) {
        var b = box || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
        var pts = {};
        defs().forEach(function (d) {
            pts[d.id] = {
                x: b.x + d.nx * b.w,
                y: b.y + d.ny * b.h
            };
        });
        return pts;
    }

    function detectLocal(img) {
        if (!img || !img.naturalWidth) return { pts: emptyPts(), source: 'empty' };
        var box = findHeadBox(img);
        return { pts: placeMean(img, box), source: 'isbi2015-mean+bbox', box: box };
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
        if (payload && payload.normalized && img) {
            Object.keys(pts).forEach(function (k) {
                if (payload.landmarks) return;
            });
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
