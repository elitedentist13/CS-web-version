/**
 * Phone document scanner (scan.html) - upload-only companion to Consultation > Photos / Docs.
 *
 * Write-only by design: the phone can ADD new files and nothing else. This script never lists,
 * downloads, renames, overwrites or deletes anything in storage, and never touches database tables.
 * Every file goes to a fresh, unique path under phone-scan/<token>/ with upsert disabled.
 * Pages that were scanned but not yet sent can be discarded locally; once sent they are out of
 * the phone's hands and are handled (saved, edited, deleted) on the clinic computer.
 */
(function (root) {
    'use strict';

    var BUCKET = 'photos';
    var PREFIX = 'phone-scan';
    var TOKEN_RE = /^[a-z0-9]{20,48}$/;
    var MAX_OUT_EDGE = 2000;
    var MAX_SRC_EDGE = 3000;
    var CDN_JSPDF = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
    var MAX_PAGES = 40;
    var MAX_FILE_BYTES = 19 * 1024 * 1024;
    var MAX_PICK_EDGE = 4000;

    /* ── pure helpers (unit-tested in Node) ───────────────────── */

    /**
     * What to do with a file picked from the phone's albums / files:
     *  'pdf'   - sent exactly as it is;
     *  'image' - a picture: turned upright and saved as JPEG (so any phone format works, and it can join a PDF);
     *  ''      - not usable (empty, too large, or another file type).
     */
    function classifyFile(f) {
        if (!f) return '';
        var type = String(f.type || '').toLowerCase();
        var name = String(f.name || '').toLowerCase();
        var size = f.size == null ? 0 : f.size;
        if (size <= 0 || size > MAX_FILE_BYTES) return '';
        if (type === 'application/pdf' || (!type && /\.pdf$/.test(name))) return 'pdf';
        if (type.indexOf('image/') === 0 || (!type && /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/.test(name))) return 'image';
        return '';
    }

    /** How many of `incoming` files fit when `have` pages are already collected. */
    function roomFor(have, incoming) { return Math.max(0, Math.min(incoming, MAX_PAGES - have)); }

    /* ── enlarged-page viewer: pinch / drag / double-tap maths ──────────────
     * view = { s, tx, ty }: scale relative to "fit the screen" and the shift of the page centre from the
     * centre of the viewing box. */

    var VIEW_MAX = 8;

    function clampScale(s, lo, hi) { return Math.max(lo == null ? 1 : lo, Math.min(hi == null ? VIEW_MAX : hi, s)); }

    /** Size of an image shown "contain" inside a cw x ch box. */
    function fitSize(nw, nh, cw, ch) {
        if (!nw || !nh || !cw || !ch) return { w: 0, h: 0 };
        var k = Math.min(cw / nw, ch / nh);
        return { w: nw * k, h: nh * k };
    }

    /** Keep the page inside the box: centred when smaller than the box, edge-to-edge limits when larger. */
    function viewClamp(v, fw, fh, cw, ch) {
        var s = clampScale(v.s);
        var maxX = Math.max(0, (fw * s - cw) / 2), maxY = Math.max(0, (fh * s - ch) / 2);
        return { s: s, tx: Math.max(-maxX, Math.min(maxX, v.tx)), ty: Math.max(-maxY, Math.min(maxY, v.ty)) };
    }

    /** Zoom to scale ns keeping the point under (cx, cy) - container coordinates - where it is. */
    function zoomAbout(v, ns, cx, cy, cw, ch) {
        var fx = cx - cw / 2, fy = cy - ch / 2;
        var r = ns / v.s;
        return { s: ns, tx: fx - (fx - v.tx) * r, ty: fy - (fy - v.ty) * r };
    }

    /** Zoom as % of real pixels (100% = one image pixel per device pixel). */
    function zoomPercent(s, fitW, naturalW, dpr) {
        if (!naturalW) return 0;
        return Math.round(s * fitW * (dpr > 0 ? dpr : 1) / naturalW * 100);
    }

    /** The zoom button / double-tap: fit -> real pixels -> fit. */
    function nextViewScale(s, fitW, naturalW, dpr) {
        var real = Math.max(1.5, naturalW / (dpr > 0 ? dpr : 1) / Math.max(1, fitW));
        return s < real * 0.95 ? clampScale(real) : 1;
    }

    /* ── automatic page detection: runs on a small grey copy of the camera frame ── */

    var DET_W = 200;
    var DETX_W = 360;

    function rgbaToGray(data, w, h) {
        var g = new Uint8Array(w * h);
        for (var i = 0, p = 0; i < g.length; i++, p += 4) g[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
        return g;
    }

    function blur3(g, w, h) {
        var o = new Uint8Array(w * h);
        for (var y = 0; y < h; y++) {
            for (var x = 0; x < w; x++) {
                var s = 0, n = 0;
                for (var dy = -1; dy <= 1; dy++) {
                    var yy = y + dy;
                    if (yy < 0 || yy >= h) continue;
                    for (var dx = -1; dx <= 1; dx++) {
                        var xx = x + dx;
                        if (xx < 0 || xx >= w) continue;
                        s += g[yy * w + xx];
                        n++;
                    }
                }
                o[y * w + x] = (s / n) | 0;
            }
        }
        return o;
    }

    function otsuThreshold(g) {
        var hist = new Uint32Array(256), i;
        for (i = 0; i < g.length; i++) hist[g[i]]++;
        var total = g.length, sum = 0;
        for (i = 0; i < 256; i++) sum += i * hist[i];
        var sumB = 0, wB = 0, best = -1, thr = 127;
        for (i = 0; i < 256; i++) {
            wB += hist[i];
            if (!wB) continue;
            var wF = total - wB;
            if (!wF) break;
            sumB += i * hist[i];
            var mB = sumB / wB, mF = (sum - sumB) / wF;
            var between = wB * wF * (mB - mF) * (mB - mF);
            if (between > best) { best = between; thr = i; }
        }
        return thr;
    }

    function polyArea(q) {
        var a = 0;
        for (var i = 0; i < q.length; i++) {
            var p = q[i], n = q[(i + 1) % q.length];
            a += p.x * n.y - n.x * p.y;
        }
        return Math.abs(a) / 2;
    }

    function pointInQuad(q, x, y) {
        var sign = 0;
        for (var i = 0; i < 4; i++) {
            var a = q[i], b = q[(i + 1) % 4];
            var c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
            if (c !== 0) {
                var s = c > 0 ? 1 : -1;
                if (sign && s !== sign) return false;
                sign = s;
            }
        }
        return true;
    }

    function scaleQuad(q, w, h) { return q.map(function (p) { return { x: p.x * w, y: p.y * h }; }); }

    function fullQuad(w, h) { return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]; }

    /** Largest corner movement between two normalised quads (fractions of the frame). */
    function quadShift(a, b) {
        var m = 0;
        for (var i = 0; i < 4; i++) m = Math.max(m, Math.sqrt(Math.pow(a[i].x - b[i].x, 2) + Math.pow(a[i].y - b[i].y, 2)));
        return m;
    }

    function quadsClose(a, b, tol) { return !!a && !!b && quadShift(a, b) <= tol; }

    /**
     * Is a page with printed or written text in front of the camera? gray = Uint8Array w*h (a small frame).
     * Looks for the biggest bright blob that is shaped like a page, sits wholly inside the frame and carries
     * text-like dark marks spread over it. Resolves { found, quad (normalised, tl tr br bl), reason }:
     * reason is 'ok' | 'none' | 'small' | 'full' | 'shape' | 'notext'.
     */
    function detectDocument(gray, w, h) {
        var N = w * h;
        var g = blur3(gray, w, h);
        var t = otsuThreshold(g);
        var sumHi = 0, nHi = 0, sumLo = 0, nLo = 0, i;
        for (i = 0; i < N; i++) { if (g[i] > t) { sumHi += g[i]; nHi++; } else { sumLo += g[i]; nLo++; } }
        if (!nHi || !nLo || sumHi / nHi - sumLo / nLo < 35) return { found: false, quad: null, reason: 'none' };

        var label = new Int32Array(N);
        var stack = new Int32Array(N);
        var comps = [];
        for (var start = 0; start < N; start++) {
            if (g[start] <= t || label[start]) continue;
            var id = comps.length + 1;
            var sp = 0;
            stack[sp++] = start;
            label[start] = id;
            var c = { id: id, area: 0, border: 0, minS: 1e9, maxS: -1e9, minD: 1e9, maxD: -1e9, tl: null, br: null, tr: null, bl: null };
            while (sp) {
                var p = stack[--sp];
                var x = p % w, y = (p / w) | 0;
                c.area++;
                var s = x + y, d = x - y;
                if (s < c.minS) { c.minS = s; c.tl = { x: x, y: y }; }
                if (s > c.maxS) { c.maxS = s; c.br = { x: x, y: y }; }
                if (d > c.maxD) { c.maxD = d; c.tr = { x: x, y: y }; }
                if (d < c.minD) { c.minD = d; c.bl = { x: x, y: y }; }
                if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.border++;
                if (x > 0 && g[p - 1] > t && !label[p - 1]) { label[p - 1] = id; stack[sp++] = p - 1; }
                if (x < w - 1 && g[p + 1] > t && !label[p + 1]) { label[p + 1] = id; stack[sp++] = p + 1; }
                if (y > 0 && g[p - w] > t && !label[p - w]) { label[p - w] = id; stack[sp++] = p - w; }
                if (y < h - 1 && g[p + w] > t && !label[p + w]) { label[p + w] = id; stack[sp++] = p + w; }
            }
            comps.push(c);
        }
        comps.sort(function (a, b) { return b.area - a.area; });

        var firstReason = 'none';
        for (var ci = 0; ci < comps.length && ci < 3; ci++) {
            var comp = comps[ci];
            if (comp.area < N * 0.08) { if (ci === 0) firstReason = 'small'; break; }
            var reason = null;
            var q = [comp.tl, comp.tr, comp.br, comp.bl];
            var qa = polyArea(q);
            if (comp.border > Math.max(6, w * 0.03)) reason = 'full';
            else if (qa < N * 0.12) reason = 'small';
            else if (qa > N * 0.97) reason = 'full';
            else if (comp.area / qa < 0.7) reason = 'shape';
            else {
                var sign = 0, convex = true, minSide = 1e9;
                for (var k = 0; k < 4; k++) {
                    var a0 = q[k], b0 = q[(k + 1) % 4], c0 = q[(k + 2) % 4];
                    var cr = (b0.x - a0.x) * (c0.y - b0.y) - (b0.y - a0.y) * (c0.x - b0.x);
                    var sg = cr > 0 ? 1 : (cr < 0 ? -1 : 0);
                    if (!sg || (sign && sg !== sign)) convex = false;
                    sign = sg || sign;
                    minSide = Math.min(minSide, dist(a0, b0));
                }
                if (!convex || minSide < Math.min(w, h) * 0.12) reason = 'shape';
            }
            if (reason) { if (ci === 0) firstReason = reason; continue; }

            /* text check: dark marks inside the page, spread over the page */
            var cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
            var sq = q.map(function (pt) { return { x: cx + (pt.x - cx) * 0.9, y: cy + (pt.y - cy) * 0.9 }; });
            var x0 = Math.max(0, Math.floor(Math.min(sq[0].x, sq[1].x, sq[2].x, sq[3].x)));
            var x1 = Math.min(w - 1, Math.ceil(Math.max(sq[0].x, sq[1].x, sq[2].x, sq[3].x)));
            var y0 = Math.max(0, Math.floor(Math.min(sq[0].y, sq[1].y, sq[2].y, sq[3].y)));
            var y1 = Math.min(h - 1, Math.ceil(Math.max(sq[0].y, sq[1].y, sq[2].y, sq[3].y)));
            var hist = new Uint32Array(256), nPaper = 0, xx, yy;
            for (yy = y0; yy <= y1; yy++) for (xx = x0; xx <= x1; xx++) {
                if (label[yy * w + xx] === comp.id) { hist[gray[yy * w + xx]]++; nPaper++; }
            }
            var acc = 0, median = 200;
            for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= nPaper / 2) { median = i; break; } }
            var inkLevel = median * 0.78;
            var cellInk = new Uint32Array(16), cellN = new Uint32Array(16), nQ = 0, ink = 0;
            var bw = Math.max(1, x1 - x0 + 1), bh = Math.max(1, y1 - y0 + 1);
            for (yy = y0; yy <= y1; yy++) {
                for (xx = x0; xx <= x1; xx++) {
                    if (!pointInQuad(sq, xx + 0.5, yy + 0.5)) continue;
                    var cell = Math.min(3, ((yy - y0) * 4 / bh) | 0) * 4 + Math.min(3, ((xx - x0) * 4 / bw) | 0);
                    nQ++;
                    cellN[cell]++;
                    if (label[yy * w + xx] !== comp.id || gray[yy * w + xx] < inkLevel) { ink++; cellInk[cell]++; }
                }
            }
            if (!nQ) { if (ci === 0) firstReason = 'shape'; continue; }
            var inkFrac = ink / nQ;
            var spread = 0;
            for (i = 0; i < 16; i++) if (cellN[i] > 8 && cellInk[i] / cellN[i] > 0.004) spread++;
            if (inkFrac < 0.006 || spread < 5) { if (ci === 0) firstReason = 'notext'; continue; }
            if (inkFrac > 0.55) { if (ci === 0) firstReason = 'shape'; continue; }
            return {
                found: true,
                reason: 'ok',
                inkFrac: inkFrac,
                quad: q.map(function (pt) { return { x: (pt.x + 0.5) / w, y: (pt.y + 0.5) / h }; })
            };
        }
        return { found: false, quad: null, reason: firstReason };
    }

    /* ── the dotted frame: text-on-paper test and a movement signature of what is inside it ──
     * The camera view is cropped to the dotted guide; whatever sits inside is the page. So auto-capture does
     * not need to find page corners (fragile with real lighting and desks): it needs "paper with text fills
     * the frame" and "it is holding still". */

    var SIG_N = 24;

    /** SIG_N x SIG_N brightness signature of a grey frame, normalised for overall brightness. */
    function sigOf(gray, w, h) {
        var out = new Float32Array(SIG_N * SIG_N), cnt = new Uint32Array(SIG_N * SIG_N), i, x, y;
        for (y = 0; y < h; y++) {
            var cy = Math.min(SIG_N - 1, (y * SIG_N / h) | 0);
            for (x = 0; x < w; x++) {
                var k = cy * SIG_N + Math.min(SIG_N - 1, (x * SIG_N / w) | 0);
                out[k] += gray[y * w + x];
                cnt[k]++;
            }
        }
        var mean = 0;
        for (i = 0; i < out.length; i++) { out[i] = cnt[i] ? out[i] / cnt[i] : 0; mean += out[i]; }
        mean /= out.length;
        for (i = 0; i < out.length; i++) out[i] -= mean;
        return out;
    }

    function sigDiff(a, b) {
        if (!a || !b || a.length !== b.length) return 255;
        var d = 0;
        for (var i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
        return d / a.length;
    }

    /**
     * Is there a page with printed / written text filling this (guide-cropped) grey frame?
     * Works on 6 x 6 pixel blocks: text blocks have a strong light/dark range, blank paper blocks are bright and
     * flat. Needs both, and the text spread over the page, so a blank sheet, a wall, a desk or a dark room do not count.
     * Resolves { found, reason: 'ok' | 'dark' | 'nopaper' | 'notext', quad (the whole frame), sig }.
     */
    function detectText(gray, w, h) {
        var B = 6, bw = Math.floor(w / B), bh = Math.floor(h / B);
        var whole = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
        var res = { found: false, quad: null, reason: 'dark', sig: null, textFrac: 0, blankFrac: 0 };
        if (bw < 8 || bh < 8) return res;
        var N = bw * bh, mean = new Float32Array(N), range = new Float32Array(N), i, x, y;
        var hist = new Uint32Array(256), total = 0;
        for (var by = 0; by < bh; by++) {
            for (var bx = 0; bx < bw; bx++) {
                var lo = 255, hi = 0, sum = 0;
                for (y = 0; y < B; y++) {
                    var row = (by * B + y) * w + bx * B;
                    for (x = 0; x < B; x++) {
                        var v = gray[row + x];
                        if (v < lo) lo = v;
                        if (v > hi) hi = v;
                        sum += v;
                    }
                }
                var m = sum / (B * B);
                mean[by * bw + bx] = m;
                range[by * bw + bx] = hi - lo;
                hist[m | 0]++;
                total++;
            }
        }
        var acc = 0, P = 255;
        for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * 0.85) { P = i; break; } }
        if (P < 80) return res;
        var text = 0, blank = 0, cellT = new Uint32Array(16), cellN = new Uint32Array(16);
        for (var cy = 0; cy < bh; cy++) {
            for (var cx = 0; cx < bw; cx++) {
                var k = cy * bw + cx, cell = Math.min(3, (cy * 4 / bh) | 0) * 4 + Math.min(3, (cx * 4 / bw) | 0);
                cellN[cell]++;
                if (range[k] >= 24 && mean[k] > 0.3 * P) { text++; cellT[cell]++; }
                else if (range[k] < 14 && mean[k] >= 0.6 * P) blank++;
            }
        }
        var spread = 0;
        for (i = 0; i < 16; i++) if (cellN[i] && cellT[i] / cellN[i] >= 0.03) spread++;
        res.textFrac = text / N;
        res.blankFrac = blank / N;
        res.sig = sigOf(gray, w, h);
        if (blank / N < 0.1) { res.reason = 'nopaper'; return res; }
        if (text / N < 0.03 || text / N > 0.85 || spread < 6) { res.reason = 'notext'; return res; }
        res.found = true;
        res.reason = 'ok';
        res.quad = whole;
        return res;
    }

    /** The dotted guide (box coordinates) as a pixel rectangle of the camera frame, for object-fit: cover. */
    function guideToVideo(gx, gy, gw, gh, cw, ch, vw, vh) {
        var m = coverMap(vw, vh, cw, ch);
        var x0 = (gx - m.ox) / m.s, y0 = (gy - m.oy) / m.s, x1 = (gx + gw - m.ox) / m.s, y1 = (gy + gh - m.oy) / m.s;
        x0 = Math.max(0, Math.min(vw, x0)); x1 = Math.max(0, Math.min(vw, x1));
        y0 = Math.max(0, Math.min(vh, y0)); y1 = Math.max(0, Math.min(vh, y1));
        return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    }

    /* Auto-capture: a page must hold still for a moment, then a 3-second count-down runs; moving the page
     * or taking it away cancels it. After a capture it re-arms only once the page is taken away or the
     * camera moves to another page, so one page is never captured twice. */

    var AUTO = {
        steadyMs: 700, countdownMs: 3000, loseMs: 900, rearmGoneMs: 700,
        steadyTol: 0.035, countTol: 0.07, rearmMove: 0.12,
        sigSteady: 6, sigCount: 12, sigRearm: 16
    };

    function autoNew(armed, ref) {
        return { phase: 'search', armed: armed !== false, since: 0, ref: null, lostAt: 0, goneAt: 0, countAt: 0, refDet: Array.isArray(ref) ? { quad: ref } : (ref || null) };
    }

    function detClose(a, b, tolQuad, tolSig) {
        if (!a || !b) return false;
        if (a.sig && b.sig) return sigDiff(a.sig, b.sig) <= tolSig;
        return quadsClose(a.quad, b.quad, tolQuad);
    }

    function detFar(a, b, cfg) {
        if (!a || !b) return false;
        if (a.sig && b.sig) return sigDiff(a.sig, b.sig) > cfg.sigRearm;
        return !!a.quad && !!b.quad && quadShift(a.quad, b.quad) > cfg.rearmMove;
    }

    /** One detection result in; returns { action: none|steady|lost|start|tick|cancel|fire, remaining }. Mutates st. */
    function autoStep(st, det, now, cfg) {
        cfg = cfg || AUTO;
        var found = !!(det && det.found);
        var out = { action: 'none', remaining: 0 };
        if (!st.armed) {
            if (!found) {
                if (!st.goneAt) st.goneAt = now;
                if (now - st.goneAt >= cfg.rearmGoneMs) st.armed = true;
            } else {
                st.goneAt = 0;
                if (st.refDet && detFar(det, st.refDet, cfg)) st.armed = true;
            }
            if (!st.armed) return out;
            st.phase = 'search';
            st.ref = null;
            if (!found) return out;
        }
        if (st.phase === 'search') {
            if (found) { st.phase = 'steady'; st.ref = det; st.since = now; out.action = 'steady'; }
            return out;
        }
        if (st.phase === 'steady') {
            if (!found) { st.phase = 'search'; st.ref = null; out.action = 'lost'; return out; }
            if (!detClose(det, st.ref, cfg.steadyTol, cfg.sigSteady)) { st.ref = det; st.since = now; return out; }
            if (now - st.since >= cfg.steadyMs) { st.phase = 'count'; st.countAt = now; st.lostAt = 0; out.action = 'start'; out.remaining = cfg.countdownMs; }
            return out;
        }
        if (found && detClose(det, st.ref, cfg.countTol, cfg.sigCount)) {
            st.lostAt = 0;
        } else if (found) {
            st.phase = 'steady'; st.ref = det; st.since = now; out.action = 'cancel';
            return out;
        } else {
            if (!st.lostAt) st.lostAt = now;
            if (now - st.lostAt > cfg.loseMs) { st.phase = 'search'; st.ref = null; out.action = 'cancel'; return out; }
        }
        var remaining = cfg.countdownMs - (now - st.countAt);
        if (remaining <= 0) {
            st.phase = 'search';
            st.armed = false;
            st.goneAt = 0;
            st.refDet = st.ref;
            out.action = 'fire';
            return out;
        }
        out.action = 'tick';
        out.remaining = remaining;
        return out;
    }

    /** Where a normalised video point lands on screen when the video fills its box with object-fit: cover. */
    function coverMap(vw, vh, cw, ch) {
        var s = Math.max(cw / vw, ch / vh);
        return { s: s, ox: (cw - vw * s) / 2, oy: (ch - vh * s) / 2 };
    }

    /** Pages (as collected on the phone) split into pictures and ready-made PDFs. */
    function splitPages(pages) {
        var out = { images: [], pdfs: [] };
        (pages || []).forEach(function (p) { (p.pdf ? out.pdfs : out.images).push(p); });
        return out;
    }

    function parseParams(search) {
        var out = { token: '', label: '', lang: '', exp: 0 };
        var s = String(search || '').replace(/^\?/, '');
        s.split('&').forEach(function (pair) {
            if (!pair) return;
            var i = pair.indexOf('=');
            var k = i < 0 ? pair : pair.slice(0, i);
            var v = i < 0 ? '' : pair.slice(i + 1);
            try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { /* keep raw */ }
            if (k === 't') out.token = v.toLowerCase();
            else if (k === 'l') out.label = v.slice(0, 60);
            else if (k === 'g') out.lang = v;
            else if (k === 'x') out.exp = parseInt(v, 10) || 0;
        });
        return out;
    }

    function isValidToken(t) { return TOKEN_RE.test(String(t || '')); }

    function isExpired(exp, now) {
        if (!exp) return false;
        return (now == null ? Date.now() : now) > exp;
    }

    function normLang(l) {
        var s = String(l || '').toLowerCase();
        if (s === 'zh-cn' || s === 'zh-hans' || s === 'zh-sg') return 'zh-CN';
        if (s.indexOf('zh') === 0) return 'zh-Hant';
        return 'en';
    }

    /*
     * The photos bucket is public but anonymous users cannot LIST it, and it only accepts image / PDF
     * types. So the clinic computer finds files by PREDICTABLE names (it asks for p000, p001, ... on the
     * public URL) and the "phone connected" / "phone finished" signals are tiny PNG markers.
     */
    function pad3(n) {
        var s = String(n == null ? 0 : n);
        while (s.length < 3) s = '0' + s;
        return s;
    }

    function buildPath(token, seq, ext) {
        var e = String(ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        return PREFIX + '/' + token + '/p' + pad3(seq) + '.' + e;
    }

    function buildHelloPath(token) { return PREFIX + '/' + token + '/h.png'; }

    function buildDonePath(token, k) { return PREFIX + '/' + token + '/d' + String(k == null ? 1 : k) + '.png'; }

    /* 1x1 transparent PNG, used as a marker because the bucket rejects non-image types */
    var PNG_1PX = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
        0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130];

    function isConflict(msg) { return /already exists|duplicate/i.test(String(msg || '')); }

    /** Heckbert square-to-quad projective map. quad = [tl, tr, br, bl] each {x,y}. */
    function squareToQuad(q) {
        var x0 = q[0].x, y0 = q[0].y, x1 = q[1].x, y1 = q[1].y;
        var x2 = q[2].x, y2 = q[2].y, x3 = q[3].x, y3 = q[3].y;
        var dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
        var dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
        var a, b, c, d, e, f, g, h;
        if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
            a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; g = 0; h = 0;
        } else {
            var den = dx1 * dy2 - dy1 * dx2;
            g = (dx3 * dy2 - dy3 * dx2) / den;
            h = (dx1 * dy3 - dy1 * dx3) / den;
            a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
            d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
        }
        return { a: a, b: b, c: c, d: d, e: e, f: f, g: g, h: h };
    }

    function mapUnit(m, u, v) {
        var w = m.g * u + m.h * v + 1;
        return { x: (m.a * u + m.b * v + m.c) / w, y: (m.d * u + m.e * v + m.f) / w };
    }

    function dist(p, q) { return Math.sqrt((p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y)); }

    function outputSize(q, maxEdge) {
        var w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
        var h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
        var cap = maxEdge || MAX_OUT_EDGE;
        var k = Math.min(1, cap / Math.max(w, h, 1));
        return { w: Math.max(40, Math.round(w * k)), h: Math.max(40, Math.round(h * k)) };
    }

    function defaultQuad(w, h) {
        var mx = w * 0.06, my = h * 0.06;
        return [{ x: mx, y: my }, { x: w - mx, y: my }, { x: w - mx, y: h - my }, { x: mx, y: h - my }];
    }

    function quadIsValid(q, w, h) {
        if (!q || q.length !== 4) return false;
        for (var i = 0; i < 4; i++) {
            if (!isFinite(q[i].x) || !isFinite(q[i].y)) return false;
            if (q[i].x < -1 || q[i].y < -1 || q[i].x > w + 1 || q[i].y > h + 1) return false;
        }
        var area = 0;
        for (var j = 0; j < 4; j++) {
            var p = q[j], n = q[(j + 1) % 4];
            area += p.x * n.y - n.x * p.y;
        }
        if (Math.abs(area) / 2 < w * h * 0.02) return false;
        /* convex: every cross product has the same sign */
        var sign = 0;
        for (var k = 0; k < 4; k++) {
            var a = q[k], b = q[(k + 1) % 4], c = q[(k + 2) % 4];
            var cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
            if (cr === 0) return false;
            var sg = cr > 0 ? 1 : -1;
            if (sign && sg !== sign) return false;
            sign = sg;
        }
        return true;
    }

    /** Perspective-correct the quad of src ({data,width,height}) into a w x h RGBA buffer. */
    function warpQuad(src, q, outW, outH) {
        var m = squareToQuad(q);
        var out = new Uint8ClampedArray(outW * outH * 4);
        var sw = src.width, sh = src.height, sd = src.data;
        for (var y = 0; y < outH; y++) {
            var v = (y + 0.5) / outH;
            for (var x = 0; x < outW; x++) {
                var u = (x + 0.5) / outW;
                var p = mapUnit(m, u, v);
                var sx = p.x - 0.5, sy = p.y - 0.5;
                var x0 = Math.floor(sx), y0 = Math.floor(sy);
                var fx = sx - x0, fy = sy - y0;
                var xa = Math.min(sw - 1, Math.max(0, x0)), xb = Math.min(sw - 1, Math.max(0, x0 + 1));
                var ya = Math.min(sh - 1, Math.max(0, y0)), yb = Math.min(sh - 1, Math.max(0, y0 + 1));
                var i00 = (ya * sw + xa) * 4, i10 = (ya * sw + xb) * 4, i01 = (yb * sw + xa) * 4, i11 = (yb * sw + xb) * 4;
                var o = (y * outW + x) * 4;
                for (var c = 0; c < 4; c++) {
                    var top = sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx;
                    var bot = sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx;
                    out[o + c] = top * (1 - fy) + bot * fy;
                }
            }
        }
        return { data: out, width: outW, height: outH };
    }

    function lumaHistogram(d) {
        var hist = new Uint32Array(256);
        for (var i = 0; i < d.length; i += 4) {
            hist[(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0]++;
        }
        return hist;
    }

    function percentiles(hist, total, loP, hiP) {
        var acc = 0, lo = 0, hi = 255, i;
        for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * loP) { lo = i; break; } }
        acc = 0;
        for (i = 0; i < 256; i++) { acc += hist[i]; if (acc >= total * hiP) { hi = i; break; } }
        if (hi - lo < 16) { lo = 0; hi = 255; }
        return { lo: lo, hi: hi };
    }

    /** modes: orig | color | gray | bw. Works in place on { data, width, height }. */
    function enhance(img, mode) {
        if (!mode || mode === 'orig') return img;
        var d = img.data, w = img.width, h = img.height, n = w * h, i;
        if (mode === 'bw') {
            var gray = new Uint8ClampedArray(n);
            for (i = 0; i < n; i++) gray[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
            var integral = new Float64Array((w + 1) * (h + 1));
            for (var y = 0; y < h; y++) {
                var row = 0;
                for (var x = 0; x < w; x++) {
                    row += gray[y * w + x];
                    integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + row;
                }
            }
            var s = Math.max(15, Math.round(Math.min(w, h) / 10)), half = s >> 1;
            for (var yy = 0; yy < h; yy++) {
                var y1 = Math.max(0, yy - half), y2 = Math.min(h - 1, yy + half);
                for (var xx = 0; xx < w; xx++) {
                    var x1 = Math.max(0, xx - half), x2 = Math.min(w - 1, xx + half);
                    var count = (x2 - x1 + 1) * (y2 - y1 + 1);
                    var sum = integral[(y2 + 1) * (w + 1) + (x2 + 1)] - integral[y1 * (w + 1) + (x2 + 1)] -
                        integral[(y2 + 1) * (w + 1) + x1] + integral[y1 * (w + 1) + x1];
                    var v = gray[yy * w + xx] * count < sum * 0.88 ? 0 : 255;
                    var o = (yy * w + xx) * 4;
                    d[o] = d[o + 1] = d[o + 2] = v;
                    d[o + 3] = 255;
                }
            }
            return img;
        }
        var pr = percentiles(lumaHistogram(d), n, 0.02, 0.97);
        var span = pr.hi - pr.lo;
        for (i = 0; i < d.length; i += 4) {
            if (mode === 'gray') {
                var g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
                g = (g - pr.lo) * 255 / span;
                d[i] = d[i + 1] = d[i + 2] = g;
            } else {
                d[i] = (d[i] - pr.lo) * 255 / span;
                d[i + 1] = (d[i + 1] - pr.lo) * 255 / span;
                d[i + 2] = (d[i + 2] - pr.lo) * 255 / span;
            }
            d[i + 3] = 255;
        }
        return img;
    }

    function pdfPageSize(w, h) {
        var k = 842 / Math.max(w, h, 1);
        return { w: Math.round(w * k), h: Math.round(h * k), orient: w > h ? 'landscape' : 'portrait' };
    }

    /* ── write-only storage gateway ──────────────────────────── */

    /**
     * The only storage access this page has. Exposes upload(path, blob, contentType) and nothing else,
     * and refuses to overwrite: upsert is always false.
     */
    function makeUploader(sb) {
        var bucket = sb && sb.storage ? sb.storage.from(BUCKET) : null;
        return {
            upload: function (path, blob, contentType) {
                if (!bucket) return Promise.resolve({ error: { message: 'storage unavailable' } });
                if (String(path).indexOf(PREFIX + '/') !== 0) {
                    return Promise.resolve({ error: { message: 'path not allowed' } });
                }
                return Promise.resolve(bucket.upload(path, blob, {
                    cacheControl: '3600',
                    upsert: false,
                    contentType: contentType || 'application/octet-stream'
                }));
            }
        };
    }

    function sendOne(up, path, blob, contentType, tries) {
        var left = tries == null ? 2 : tries;
        return up.upload(path, blob, contentType).then(function (r) {
            if (r && r.error) {
                var m = String(r.error.message || '');
                if (left > 0 && !isConflict(m) && !/not allowed/i.test(m)) {
                    return new Promise(function (res) { setTimeout(res, 600); })
                        .then(function () { return sendOne(up, path, blob, contentType, left - 1); });
                }
                return { ok: false, conflict: isConflict(m), msg: m || 'upload failed' };
            }
            return { ok: true };
        }, function (err) {
            if (left > 0) {
                return new Promise(function (res) { setTimeout(res, 600); })
                    .then(function () { return sendOne(up, path, blob, contentType, left - 1); });
            }
            return { ok: false, msg: String((err && err.message) || err) };
        });
    }

    /**
     * items: [{ blob, ext, contentType }]. Sequential, numbered p000, p001, ... If a number is already
     * taken (page reloaded mid-session) the next free one is used. Resolves { sent, failed, nextSeq }.
     */
    function uploadItems(sb, token, items, onProgress, seqStart) {
        var up = makeUploader(sb);
        var sent = 0, failed = 0, seq = seqStart || 0;
        var chain = Promise.resolve();
        function attempt(it, bumps) {
            return sendOne(up, buildPath(token, seq, it.ext), it.blob, it.contentType).then(function (r) {
                if (!r.ok && r.conflict && bumps < 8) { seq++; return attempt(it, bumps + 1); }
                if (r.ok) seq++;
                return r;
            });
        }
        items.forEach(function (it, idx) {
            chain = chain.then(function () {
                return attempt(it, 0).then(function (r) {
                    if (r.ok) sent++; else failed++;
                    if (onProgress) onProgress(idx + 1, items.length, r);
                });
            });
        });
        return chain.then(function () { return { sent: sent, failed: failed, nextSeq: seq }; });
    }

    /** kind 'hello' -> h.png ; kind 'done' -> d<k>.png (next free k from the given one). */
    function sendMarker(sb, token, kind, k) {
        var up = makeUploader(sb);
        var blob = new Blob([new Uint8Array(PNG_1PX)], { type: 'image/png' });
        if (kind === 'hello') return sendOne(up, buildHelloPath(token), blob, 'image/png', 1);
        var n = k || 1;
        function attempt(bumps) {
            return sendOne(up, buildDonePath(token, n), blob, 'image/png', 1).then(function (r) {
                if (!r.ok && r.conflict && bumps < 5) { n++; return attempt(bumps + 1); }
                r.k = n;
                return r;
            });
        }
        return attempt(0);
    }

    /* ── UI strings ──────────────────────────────────────────── */

    var S = {
        en: {
            title: 'Scan a document', for: 'Scanning for', start: 'Open scanner', gallery: 'Choose photos / PDF',
            added: 'added', skipped: 'skipped (unreadable, too large or over the page limit)',
            hintTap: 'Tap a page to enlarge it and check the clarity, or crop it. PDF files are sent as they are.',
            cropPage: 'Crop', close: 'Close', fit: 'Fit',
            queueTitle: 'Pending upload', cancel: 'Cancel', apply: 'Apply', save: 'Save',
            maxPages: 'Page limit reached - send these first.', tapEnlarge: 'Tap the page to enlarge it and check the clarity',
            autoOn: 'Auto', autoOff: 'Manual', autoSearch: 'Fit the page inside the dotted frame', autoHold: 'Hold steady…',
            autoCount: 'Capturing in', autoFull: 'Fit the whole page in view', autoNoText: 'Looking for text on the page',
            autoOffMsg: 'Tap the round button to scan',
            writeOnly: 'This page can only add new pages. Nothing can be changed or deleted from your phone.',
            camDenied: 'Camera not available. Use "Choose photos / PDF" or the camera button instead.',
            needHttps: 'The live camera needs a secure (https) page. Use the camera button instead.',
            capture: 'Take photo', pages: 'Pages', finish: 'Next', crop: 'Drag the corners to fit the page',
            next: 'Next', retake: 'Retake', back: 'Back', add: 'Add page', rotate: 'Rotate',
            fOrig: 'Original', fColor: 'Enhanced', fGray: 'Grey', fBw: 'Black & white',
            send: 'Send to computer', asPdf: 'One PDF', asImages: 'Separate images', format: 'Send as',
            discard: 'Discard', sending: 'Sending…', sent: 'Sent!', sentN: 'pages sent to the clinic computer.',
            more: 'Scan more', failed: 'Some pages did not send. Check the connection and try again.',
            retry: 'Try again', expired: 'This scan link has expired. Ask the clinic computer for a new QR code.',
            invalid: 'This scan link is not valid. Scan the QR code on the clinic computer again.',
            noPages: 'No pages yet', sentLocked: 'Sent pages are kept on the clinic computer and cannot be changed here.',
            keepOpen: 'You can close this page, or scan more pages.', pdfFail: 'PDF could not be created, sending images instead.'
        },
        'zh-Hant': {
            title: '掃描文件', for: '掃描對象', start: '開啟掃描器', gallery: '選擇相片／PDF（可多選）',
            added: '已加入', skipped: '已略過（無法讀取、檔案過大或超過頁數上限）',
            hintTap: '點選頁面可放大檢查清晰度，或重新裁切；PDF 檔案會原樣傳送。',
            cropPage: '裁切', close: '關閉', fit: '適合',
            queueTitle: '待上傳', cancel: '取消', apply: '套用', save: '儲存',
            maxPages: '已達頁數上限，請先傳送。', tapEnlarge: '點選頁面可放大檢查清晰度',
            autoOn: '自動', autoOff: '手動', autoSearch: '請將文件放入虛線框內', autoHold: '請保持穩定…',
            autoCount: '即將拍攝', autoFull: '請讓整頁文件入鏡', autoNoText: '正在尋找頁面上的文字',
            autoOffMsg: '請按圓形按鈕拍攝',
            writeOnly: '此頁面只能新增頁面，無法在手機上修改或刪除任何內容。',
            camDenied: '無法使用相機。請改用「選擇相片／PDF」或相機按鈕。',
            needHttps: '即時相機需要安全 (https) 網頁，請改用相機按鈕。',
            capture: '拍照', pages: '頁數', finish: '下一步', crop: '拖曳四角對齊文件',
            next: '下一步', retake: '重拍', back: '返回', add: '加入頁面', rotate: '旋轉',
            fOrig: '原圖', fColor: '增強', fGray: '灰階', fBw: '黑白',
            send: '傳送到電腦', asPdf: '單一 PDF', asImages: '分開圖片', format: '傳送格式',
            discard: '捨棄', sending: '傳送中…', sent: '已傳送！', sentN: '頁已傳送到診所電腦。',
            more: '繼續掃描', failed: '部分頁面未能傳送，請檢查網絡後重試。',
            retry: '重試', expired: '此掃描連結已過期，請在診所電腦重新產生 QR 碼。',
            invalid: '此掃描連結無效，請重新掃描診所電腦上的 QR 碼。',
            noPages: '尚未有頁面', sentLocked: '已傳送的頁面保存在診所電腦，無法在此更改。',
            keepOpen: '你可以關閉此頁，或繼續掃描更多頁面。', pdfFail: '無法建立 PDF，改為傳送圖片。'
        },
        'zh-CN': {
            title: '扫描文件', for: '扫描对象', start: '打开扫描器', gallery: '选择照片/PDF（可多选）',
            added: '已加入', skipped: '已跳过（无法读取、文件过大或超过页数上限）',
            hintTap: '点按页面可放大检查清晰度，或重新裁剪；PDF 文件会原样发送。',
            cropPage: '裁剪', close: '关闭', fit: '适合',
            queueTitle: '待上传', cancel: '取消', apply: '应用', save: '保存',
            maxPages: '已达页数上限，请先发送。', tapEnlarge: '点按页面可放大检查清晰度',
            autoOn: '自动', autoOff: '手动', autoSearch: '请将文件放入虚线框内', autoHold: '请保持稳定…',
            autoCount: '即将拍摄', autoFull: '请让整页文件入镜', autoNoText: '正在寻找页面上的文字',
            autoOffMsg: '请按圆形按钮拍摄',
            writeOnly: '此页面只能新增页面，无法在手机上修改或删除任何内容。',
            camDenied: '无法使用相机。请改用“选择照片/PDF”或相机按钮。',
            needHttps: '实时相机需要安全 (https) 网页，请改用相机按钮。',
            capture: '拍照', pages: '页数', finish: '下一步', crop: '拖动四角对齐文件',
            next: '下一步', retake: '重拍', back: '返回', add: '加入页面', rotate: '旋转',
            fOrig: '原图', fColor: '增强', fGray: '灰度', fBw: '黑白',
            send: '发送到电脑', asPdf: '单个 PDF', asImages: '分开图片', format: '发送格式',
            discard: '丢弃', sending: '发送中…', sent: '已发送！', sentN: '页已发送到诊所电脑。',
            more: '继续扫描', failed: '部分页面未能发送，请检查网络后重试。',
            retry: '重试', expired: '此扫描链接已过期，请在诊所电脑重新生成二维码。',
            invalid: '此扫描链接无效，请重新扫描诊所电脑上的二维码。',
            noPages: '暂无页面', sentLocked: '已发送的页面保存在诊所电脑，无法在此更改。',
            keepOpen: '你可以关闭此页，或继续扫描更多页面。', pdfFail: '无法创建 PDF，改为发送图片。'
        }
    };

    function strings(lang) { return S[normLang(lang)] || S.en; }

    /* ── browser UI ──────────────────────────────────────────── */

    function bootUi(env) {
        var doc = root.document;
        var $ = function (id) { return doc.getElementById(id); };
        var params = parseParams(root.location.search);
        var L = strings(params.lang || (root.navigator && root.navigator.language));
        var sb = env.sb;
        var pages = [];
        var sentCount = 0;
        /* page numbering survives a reload of this tab, so the clinic computer never misses a page */
        var seqKey = 'csScanSeq_' + params.token;
        var seq = 0, doneK = 1;
        try {
            var kept = (root.sessionStorage.getItem(seqKey) || '').split(',');
            seq = Math.max(0, parseInt(kept[0], 10) || 0);
            doneK = Math.max(1, parseInt(kept[1], 10) || 1);
        } catch (e) { /* private mode: start from zero */ }
        function keepSeq() {
            try { root.sessionStorage.setItem(seqKey, seq + ',' + doneK); } catch (e) { /* ignore */ }
        }
        var stream = null;
        var cur = null;
        var dragIdx = -1;
        var editIdx = -1;

        doc.querySelectorAll('[data-s]').forEach(function (el) { el.textContent = L[el.getAttribute('data-s')] || el.textContent; });
        $('scLabel').textContent = params.label || '';
        $('scForRow').hidden = !params.label;

        function show(view) {
            ['scIntro', 'scCamera', 'scCrop', 'scPreview', 'scSend', 'scDone', 'scError'].forEach(function (id) {
                $(id).hidden = id !== view;
            });
            if (view !== 'scCamera') stopCamera();
        }
        function fail(msg) { $('scErrorMsg').textContent = msg; show('scError'); }

        if (!isValidToken(params.token)) { fail(L.invalid); return; }
        if (isExpired(params.exp)) { fail(L.expired); return; }

        sendMarker(sb, params.token, 'hello');

        function updateBadges() {
            var n = pages.length;
            ['scPagesBadge', 'scTrayCount'].forEach(function (id) { $(id).textContent = String(n); });
            $('scFinishBtn').disabled = n === 0;
            var tray = $('scTray');
            tray.innerHTML = '';
            pages.forEach(function (p, i) {
                var b = doc.createElement('div');
                b.className = 'sc-thumb';
                var img = doc.createElement('img');
                img.src = p.thumb;
                img.alt = '#' + (i + 1);
                img.addEventListener('click', function () { openPageViewer(i); });
                var x = doc.createElement('button');
                x.type = 'button';
                x.className = 'sc-thumb-x';
                x.setAttribute('aria-label', L.discard);
                x.textContent = '×';
                x.addEventListener('click', function () {
                    URL.revokeObjectURL(p.thumb);
                    pages.splice(i, 1);
                    updateBadges();
                    if (!pages.length && $('scSend').hidden === false) startCamera();
                });
                b.appendChild(img);
                b.appendChild(x);
                tray.appendChild(b);
            });
            $('scTrayEmpty').hidden = n > 0;
            $('scLastThumb').hidden = n === 0;
            if (n) $('scLastImg').src = pages[n - 1].thumb;
        }

        /* ── enlarged page viewer: check how sharp a scan is ───── */

        /* Two fingers apart / together = zoom, one finger = move when zoomed or swipe to the next / previous
         * page when not zoomed, double-tap = real pixels / fit. */
        var viewer = { items: [], idx: 0, v: { s: 1, tx: 0, ty: 0 }, fw: 0, fh: 0, cw: 0, ch: 0, ptrs: {}, g: null, lastTap: null, dragX: 0 };

        function viewerPaint() {
            var img = $('scViewerImg');
            var v = viewer.v;
            img.style.transform = 'translate(' + (v.tx + viewer.dragX) + 'px,' + v.ty + 'px) scale(' + v.s + ')';
            $('scViewerZoom').textContent = v.s <= 1.02 ? L.fit : zoomPercent(v.s, viewer.fw, img.naturalWidth, root.devicePixelRatio || 1) + '%';
        }

        function viewerLayout() {
            var box = $('scViewerScroll');
            var img = $('scViewerImg');
            viewer.cw = box.clientWidth;
            viewer.ch = box.clientHeight;
            var fs = fitSize(img.naturalWidth, img.naturalHeight, viewer.cw, viewer.ch);
            viewer.fw = fs.w;
            viewer.fh = fs.h;
            img.style.width = fs.w + 'px';
            img.style.height = fs.h + 'px';
            img.style.marginLeft = (-fs.w / 2) + 'px';
            img.style.marginTop = (-fs.h / 2) + 'px';
            viewer.v = viewClamp(viewer.v, viewer.fw, viewer.fh, viewer.cw, viewer.ch);
            viewerPaint();
        }

        function viewerRender() {
            var it = viewer.items[viewer.idx];
            if (!it) return;
            viewer.v = { s: 1, tx: 0, ty: 0 };
            viewer.dragX = 0;
            viewer.ptrs = {};
            viewer.g = null;
            var img = $('scViewerImg');
            img.onload = viewerLayout;
            img.src = it.url;
            if (img.complete && img.naturalWidth) viewerLayout();
            $('scViewerLabel').textContent = it.label || '';
            $('scViewerCrop').hidden = it.pageIdx == null;
            var many = viewer.items.length > 1;
            $('scViewerPrev').hidden = !many;
            $('scViewerNext').hidden = !many;
            $('scViewerPrev').disabled = viewer.idx === 0;
            $('scViewerNext').disabled = viewer.idx === viewer.items.length - 1;
        }

        function viewerGo(step) {
            var n = viewer.idx + step;
            if (n < 0 || n >= viewer.items.length) return false;
            viewer.idx = n;
            viewerRender();
            return true;
        }

        function openViewer(items, idx) {
            viewer.items = items;
            viewer.idx = idx || 0;
            $('scViewer').hidden = false;
            viewerRender();
        }

        function closeViewer() {
            viewer.items.forEach(function (it) { if (it.revoke) URL.revokeObjectURL(it.url); });
            viewer.items = [];
            viewer.ptrs = {};
            viewer.g = null;
            $('scViewer').hidden = true;
            $('scViewerImg').removeAttribute('src');
        }

        function viewerPoint(e) {
            var r = $('scViewerScroll').getBoundingClientRect();
            return { x: e.clientX - r.left, y: e.clientY - r.top };
        }

        function viewerPtrList() { return Object.keys(viewer.ptrs).map(function (k) { return viewer.ptrs[k]; }); }

        function viewerBaseline() {
            var ps = viewerPtrList();
            if (ps.length >= 2) {
                var a = ps[0], b = ps[1];
                viewer.g = { mode: 'pinch', d0: Math.max(1, dist(a, b)), m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, v0: { s: viewer.v.s, tx: viewer.v.tx, ty: viewer.v.ty } };
            } else if (ps.length === 1) {
                viewer.g = { mode: 'one', sx: ps[0].x, sy: ps[0].y, t: Date.now(), moved: false, v0: { s: viewer.v.s, tx: viewer.v.tx, ty: viewer.v.ty }, fromPinch: !!viewer.g && viewer.g.mode === 'pinch' };
            } else {
                viewer.g = null;
            }
        }

        function viewerDown(e) {
            if (!viewer.items.length) return;
            try { $('scViewerScroll').setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            viewer.ptrs[e.pointerId] = viewerPoint(e);
            viewerBaseline();
            e.preventDefault();
        }

        function viewerMove(e) {
            if (!viewer.ptrs[e.pointerId] || !viewer.g) return;
            viewer.ptrs[e.pointerId] = viewerPoint(e);
            var g = viewer.g;
            var ps = viewerPtrList();
            if (g.mode === 'pinch' && ps.length >= 2) {
                var d = dist(ps[0], ps[1]);
                var m = { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
                var nv = zoomAbout(g.v0, clampScale(g.v0.s * d / g.d0), g.m0.x, g.m0.y, viewer.cw, viewer.ch);
                nv.tx += m.x - g.m0.x;
                nv.ty += m.y - g.m0.y;
                viewer.v = viewClamp(nv, viewer.fw, viewer.fh, viewer.cw, viewer.ch);
                viewerPaint();
            } else if (g.mode === 'one' && ps.length === 1) {
                var dx = ps[0].x - g.sx, dy = ps[0].y - g.sy;
                if (Math.abs(dx) > 6 || Math.abs(dy) > 6) g.moved = true;
                if (viewer.v.s > 1.02) {
                    viewer.v = viewClamp({ s: g.v0.s, tx: g.v0.tx + dx, ty: g.v0.ty + dy }, viewer.fw, viewer.fh, viewer.cw, viewer.ch);
                } else if (viewer.items.length > 1 && Math.abs(dx) > Math.abs(dy)) {
                    var edge = (viewer.idx === 0 && dx > 0) || (viewer.idx === viewer.items.length - 1 && dx < 0);
                    viewer.dragX = edge ? dx / 4 : dx;
                }
                viewerPaint();
            }
            e.preventDefault();
        }

        function viewerUp(e) {
            if (!viewer.ptrs[e.pointerId]) return;
            var last = viewer.ptrs[e.pointerId];
            var g = viewer.g;
            delete viewer.ptrs[e.pointerId];
            if (!g) return;
            if (g.mode === 'pinch') {
                viewerBaseline();
                if (viewer.g) viewer.g.moved = true;
                return;
            }
            var dx = last.x - g.sx, dy = last.y - g.sy;
            viewer.g = null;
            var swiped = false;
            if (viewer.v.s <= 1.02 && !g.fromPinch && viewer.items.length > 1 && Math.abs(dx) >= 50 && Math.abs(dx) > 1.4 * Math.abs(dy)) {
                viewer.dragX = 0;
                swiped = viewerGo(dx < 0 ? 1 : -1);
            }
            if (!swiped) {
                viewer.dragX = 0;
                if (!g.moved && !g.fromPinch) {
                    var now = Date.now();
                    var lt = viewer.lastTap;
                    if (lt && now - lt.t < 320 && Math.abs(lt.x - last.x) < 36 && Math.abs(lt.y - last.y) < 36) {
                        var ns = nextViewScale(viewer.v.s, viewer.fw, $('scViewerImg').naturalWidth, root.devicePixelRatio || 1);
                        viewer.v = viewClamp(zoomAbout(viewer.v, ns, last.x, last.y, viewer.cw, viewer.ch), viewer.fw, viewer.fh, viewer.cw, viewer.ch);
                        viewer.lastTap = null;
                    } else {
                        viewer.lastTap = { t: now, x: last.x, y: last.y };
                    }
                }
                viewerPaint();
            }
        }

        function viewerWheel(e) {
            if (!viewer.items.length) return;
            e.preventDefault();
            var p = viewerPoint(e);
            var ns = clampScale(viewer.v.s * Math.exp(-e.deltaY * 0.0015));
            viewer.v = viewClamp(zoomAbout(viewer.v, ns, p.x, p.y, viewer.cw, viewer.ch), viewer.fw, viewer.fh, viewer.cw, viewer.ch);
            viewerPaint();
        }

        function viewerZoomButton() {
            var ns = nextViewScale(viewer.v.s, viewer.fw, $('scViewerImg').naturalWidth, root.devicePixelRatio || 1);
            viewer.v = viewClamp(zoomAbout(viewer.v, ns, viewer.cw / 2, viewer.ch / 2, viewer.cw, viewer.ch), viewer.fw, viewer.fh, viewer.cw, viewer.ch);
            viewerPaint();
        }

        function openPageViewer(pageIdx) {
            var p = pages[pageIdx];
            if (!p) return;
            if (p.pdf) {
                var u = URL.createObjectURL(p.blob);
                root.open(u, '_blank');
                setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
                return;
            }
            var items = [];
            var at = 0;
            pages.forEach(function (pg, i) {
                if (pg.pdf) return;
                if (i === pageIdx) at = items.length;
                items.push({ url: pg.thumb, pageIdx: i, label: '#' + (i + 1) + ' / ' + pages.length });
            });
            openViewer(items, at);
        }

        function openPreviewViewer() {
            $('scPreviewCanvas').toBlob(function (blob) {
                if (!blob) return;
                openViewer([{ url: URL.createObjectURL(blob), label: '', revoke: true }], 0);
            }, 'image/jpeg', 0.86);
        }

        /* ── automatic page detection + 3 second count-down ───── */

        var auto = { on: true, st: autoNew(true), timer: null, det: null, counting: false, work: null, refDet: null };

        function autoPaintBtn() {
            var a = $('scModeAuto'), m = $('scModeManual');
            a.textContent = L.autoOn;
            m.textContent = L.autoOff;
            a.classList.toggle('is-on', auto.on);
            m.classList.toggle('is-on', !auto.on);
            a.setAttribute('aria-pressed', auto.on ? 'true' : 'false');
            m.setAttribute('aria-pressed', auto.on ? 'false' : 'true');
        }

        function guideMark(det) {
            var g = $('scGuide');
            g.classList.toggle('is-found', !!(det && det.found));
            g.classList.toggle('is-count', auto.counting);
        }

        function countShow(on) {
            var el = $('scCount');
            auto.counting = on;
            if (on) {
                el.hidden = false;
                el.className = '';
                void el.offsetWidth;
                el.className = 'is-run';
            } else {
                el.hidden = true;
                el.className = '';
            }
            $('scGuide').classList.toggle('is-count', on);
        }

        /** The area inside the dotted frame, in camera-frame pixels - this is what gets scanned. */
        function guideRoi() {
            var v = $('scVideo'), g = $('scGuide');
            if (!v.videoWidth) return null;
            var vr = v.getBoundingClientRect(), gr = g.getBoundingClientRect();
            if (!vr.width || !gr.width) return null;
            var r = guideToVideo(gr.left - vr.left, gr.top - vr.top, gr.width, gr.height, vr.width, vr.height, v.videoWidth, v.videoHeight);
            return (r.w > 20 && r.h > 20) ? r : null;
        }

        function detectFrame(el, sw, sh) {
            var w = DET_W, h = Math.max(8, Math.round(w * sh / sw));
            var c = auto.work || (auto.work = doc.createElement('canvas'));
            c.width = w;
            c.height = h;
            var x = c.getContext('2d', { willReadFrequently: true });
            x.drawImage(el, 0, 0, w, h);
            var d = x.getImageData(0, 0, w, h);
            return detectDocument(rgbaToGray(d.data, w, h), w, h);
        }

        function detectInGuide(v) {
            var r = guideRoi();
            if (!r) return null;
            var w = DETX_W, h = Math.max(24, Math.round(w * r.h / r.w));
            var c = auto.work || (auto.work = doc.createElement('canvas'));
            c.width = w;
            c.height = h;
            var x = c.getContext('2d', { willReadFrequently: true });
            x.drawImage(v, r.x, r.y, r.w, r.h, 0, 0, w, h);
            var d = x.getImageData(0, 0, w, h);
            return detectText(rgbaToGray(d.data, w, h), w, h);
        }

        function autoMessage(det) {
            if (!auto.on) return L.autoOffMsg;
            if (auto.counting) return L.autoCount + '…';
            if (auto.st.phase === 'steady' && auto.st.armed) return L.autoHold;
            if (det && det.reason === 'notext') return L.autoNoText;
            return L.autoSearch;
        }

        function autoTick() {
            auto.timer = null;
            if (!stream || $('scCamera').hidden) return;
            var fire = false;
            try {
                var v = $('scVideo');
                if (auto.on && v.videoWidth > 0 && v.readyState >= 2) {
                    var det = detectInGuide(v);
                    if (det) {
                        auto.det = det;
                        var r = autoStep(auto.st, det, Date.now());
                        if (r.action === 'start') countShow(true);
                        else if (r.action === 'cancel') countShow(false);
                        else if (r.action === 'fire') fire = true;
                        guideMark(det);
                        $('scAutoMsg').textContent = autoMessage(det);
                    }
                } else {
                    auto.det = null;
                    guideMark(null);
                    $('scAutoMsg').textContent = auto.on ? '' : L.autoOffMsg;
                }
            } catch (e) {
                auto.det = null;
            }
            if (fire) {
                countShow(false);
                guideMark(null);
                capture();
                return;
            }
            auto.timer = setTimeout(autoTick, 250);
        }

        function autoStart() {
            clearTimeout(auto.timer);
            auto.det = null;
            countShow(false);
            guideMark(null);
            autoPaintBtn();
            $('scAutoMsg').textContent = auto.on ? L.autoSearch : L.autoOffMsg;
            auto.timer = setTimeout(autoTick, 300);
        }

        function autoStop() {
            clearTimeout(auto.timer);
            auto.timer = null;
            countShow(false);
            guideMark(null);
        }

        function autoSet(on) {
            if (auto.on === on) return;
            auto.on = on;
            auto.st = autoNew(true);
            auto.det = null;
            countShow(false);
            guideMark(null);
            autoPaintBtn();
            $('scAutoMsg').textContent = auto.on ? L.autoSearch : L.autoOffMsg;
        }

        /* camera */
        function stopCamera() {
            autoStop();
            if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
            var v = $('scVideo');
            if (v) v.srcObject = null;
        }
        function startCamera() {
            var md = root.navigator && root.navigator.mediaDevices;
            if (!md || !md.getUserMedia || (root.isSecureContext === false)) {
                $('scIntroNote').textContent = L.needHttps;
                show('scIntro');
                return Promise.resolve(false);
            }
            return md.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } }, audio: false })
                .then(function (s) {
                    stream = s;
                    var v = $('scVideo');
                    v.srcObject = s;
                    v.setAttribute('playsinline', 'true');
                    show('scCamera');
                    autoStart();
                    return v.play().then(function () { return true; }, function () { return true; });
                }, function () {
                    $('scIntroNote').textContent = L.camDenied;
                    show('scIntro');
                    return false;
                });
        }

        function drawToSource(srcEl, w, h) {
            var k = Math.min(1, MAX_SRC_EDGE / Math.max(w, h));
            var c = doc.createElement('canvas');
            c.width = Math.round(w * k);
            c.height = Math.round(h * k);
            c.getContext('2d').drawImage(srcEl, 0, 0, c.width, c.height);
            return c;
        }

        /** Crop editor, opened from the preview (Crop) or from a page in the pending list. */
        function beginCrop(canvas, mode) {
            cur = { src: canvas, quad: defaultQuad(canvas.width, canvas.height), mode: mode || 'color', base: null };
            show('scCrop');
            drawCrop();
        }

        /** A new capture / picked photo goes straight to the preview with the page edges already cut out. */
        function beginFromSource(canvas, quad) {
            cur = { src: canvas, quad: quad, mode: 'color', base: null };
            applyCrop();
        }

        /** Page corners inside a picture; the whole picture when none are found (or the page is smaller than minArea of it). */
        function detectQuadFor(canvas, minArea) {
            var d = detectFrame(canvas, canvas.width, canvas.height);
            if (!d.found) return { quad: fullQuad(canvas.width, canvas.height), det: null };
            if (minArea && polyArea(d.quad) < minArea) return { quad: fullQuad(canvas.width, canvas.height), det: null };
            var q = scaleQuad(d.quad, canvas.width, canvas.height);
            var cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4, cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
            q = q.map(function (p) {
                return { x: Math.max(0, Math.min(canvas.width, cx + (p.x - cx) * 1.012)), y: Math.max(0, Math.min(canvas.height, cy + (p.y - cy) * 1.012)) };
            });
            return { quad: quadIsValid(q, canvas.width, canvas.height) ? q : fullQuad(canvas.width, canvas.height), det: d };
        }

        function cropGeom() {
            var stage = $('scCropStage');
            var maxW = stage.clientWidth || 320;
            var maxH = Math.max(200, (root.innerHeight || 640) * 0.62);
            var k = Math.min(maxW / cur.src.width, maxH / cur.src.height);
            return { k: k, w: Math.round(cur.src.width * k), h: Math.round(cur.src.height * k) };
        }

        function drawCrop() {
            var gm = cropGeom();
            var cv = $('scCropCanvas');
            cv.width = gm.w;
            cv.height = gm.h;
            var ctx = cv.getContext('2d');
            ctx.drawImage(cur.src, 0, 0, gm.w, gm.h);
            var q = cur.quad.map(function (p) { return { x: p.x * gm.k, y: p.y * gm.k }; });
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.beginPath();
            ctx.rect(0, 0, gm.w, gm.h);
            ctx.moveTo(q[0].x, q[0].y);
            for (var i = 3; i >= 0; i--) ctx.lineTo(q[i].x, q[i].y);
            ctx.closePath();
            ctx.fill('evenodd');
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(q[0].x, q[0].y);
            for (var j = 1; j < 4; j++) ctx.lineTo(q[j].x, q[j].y);
            ctx.closePath();
            ctx.stroke();
            q.forEach(function (p) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();
                ctx.strokeStyle = '#0891b2';
                ctx.lineWidth = 3;
                ctx.stroke();
            });
        }

        function pointerPos(e) {
            var cv = $('scCropCanvas');
            var r = cv.getBoundingClientRect();
            var gm = cropGeom();
            return { x: (e.clientX - r.left) * (cv.width / r.width) / gm.k, y: (e.clientY - r.top) * (cv.height / r.height) / gm.k, gm: gm };
        }

        var cropCv = $('scCropCanvas');
        cropCv.addEventListener('pointerdown', function (e) {
            if (!cur) return;
            var p = pointerPos(e);
            var best = -1, bd = 1e9;
            cur.quad.forEach(function (c, i) {
                var d = dist(c, p) * p.gm.k;
                if (d < bd) { bd = d; best = i; }
            });
            if (bd <= 48) {
                dragIdx = best;
                try { cropCv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
                e.preventDefault();
            }
        });
        cropCv.addEventListener('pointermove', function (e) {
            if (dragIdx < 0 || !cur) return;
            var p = pointerPos(e);
            var trial = cur.quad.slice();
            trial[dragIdx] = { x: Math.max(0, Math.min(cur.src.width, p.x)), y: Math.max(0, Math.min(cur.src.height, p.y)) };
            if (quadIsValid(trial, cur.src.width, cur.src.height)) { cur.quad = trial; drawCrop(); }
            e.preventDefault();
        });
        ['pointerup', 'pointercancel'].forEach(function (ev) { cropCv.addEventListener(ev, function () { dragIdx = -1; }); });

        function rotateCanvas(c) {
            var r = doc.createElement('canvas');
            r.width = c.height;
            r.height = c.width;
            var x = r.getContext('2d');
            x.translate(r.width / 2, r.height / 2);
            x.rotate(Math.PI / 2);
            x.drawImage(c, -c.width / 2, -c.height / 2);
            return r;
        }

        function applyCrop() {
            var sctx = cur.src.getContext('2d');
            var srcData = sctx.getImageData(0, 0, cur.src.width, cur.src.height);
            var size = outputSize(cur.quad);
            var warped = warpQuad(srcData, cur.quad, size.w, size.h);
            var c = doc.createElement('canvas');
            c.width = warped.width;
            c.height = warped.height;
            c.getContext('2d').putImageData(new root.ImageData(warped.data, warped.width, warped.height), 0, 0);
            cur.base = c;
            show('scPreview');
            renderPreview();
            var editing = editIdx >= 0;
            $('scPreviewPages').textContent = String(pages.length + (editing ? 0 : 1));
            $('scAddPage').textContent = editing ? L.save : L.add;
            $('scPreviewStatus').textContent = '';
        }

        function renderPreview() {
            var b = cur.base;
            var pv = $('scPreviewCanvas');
            pv.width = b.width;
            pv.height = b.height;
            var ctx = pv.getContext('2d');
            ctx.drawImage(b, 0, 0);
            var img = ctx.getImageData(0, 0, b.width, b.height);
            enhance(img, cur.mode);
            ctx.putImageData(img, 0, 0);
            doc.querySelectorAll('[data-filter]').forEach(function (el) {
                el.classList.toggle('is-on', el.getAttribute('data-filter') === cur.mode);
            });
        }

        /** Keep what is on the preview as a page in the pending list; done(editing) says what to show next. */
        function commitPreview(done) {
            if (!cur) return;
            if (editIdx < 0 && pages.length >= MAX_PAGES) { $('scPreviewStatus').textContent = L.maxPages; return; }
            $('scPreviewCanvas').toBlob(function (blob) {
                if (!blob || !cur) return;
                var pv = $('scPreviewCanvas');
                var np = { blob: blob, w: pv.width, h: pv.height, thumb: URL.createObjectURL(blob) };
                var editing = editIdx >= 0 && !!pages[editIdx];
                if (editing) {
                    URL.revokeObjectURL(pages[editIdx].thumb);
                    pages[editIdx] = np;
                } else {
                    pages.push(np);
                    auto.st = autoNew(!auto.refDet, auto.refDet);
                }
                editIdx = -1;
                cur = null;
                updateBadges();
                done(editing);
            }, 'image/jpeg', 0.86);
        }

        function addPage() { commitPreview(function (editing) { if (editing) show('scSend'); else startCamera(); }); }

        function previewNext() { commitPreview(function () { show('scSend'); }); }

        function previewRetake() {
            cur = null;
            if (editIdx >= 0) { editIdx = -1; show('scSend'); return; }
            auto.st = autoNew(true);
            auto.refDet = null;
            startCamera();
        }

        function loadFile(file) {
            if (!file) return;
            var url = URL.createObjectURL(file);
            var im = new root.Image();
            im.onload = function () {
                var c = drawToSource(im, im.naturalWidth, im.naturalHeight);
                URL.revokeObjectURL(url);
                editIdx = -1;
                auto.refDet = null;
                beginFromSource(c, detectQuadFor(c).quad);
            };
            im.onerror = function () { URL.revokeObjectURL(url); };
            im.src = url;
        }

        /* ── several photos / PDFs picked from the phone ───────── */

        function pdfThumb() {
            var c = doc.createElement('canvas');
            c.width = 84;
            c.height = 112;
            var x = c.getContext('2d');
            x.fillStyle = '#334155';
            x.fillRect(0, 0, 84, 112);
            x.fillStyle = '#f87171';
            x.fillRect(0, 36, 84, 34);
            x.fillStyle = '#fff';
            x.font = 'bold 22px sans-serif';
            x.textAlign = 'center';
            x.fillText('PDF', 42, 61);
            return c.toDataURL('image/png');
        }

        function readPicked(file) {
            var kind = classifyFile(file);
            if (kind === 'pdf') return Promise.resolve({ pdf: true, blob: file, w: 0, h: 0, thumb: pdfThumb(), name: file.name || '' });
            if (kind !== 'image') return Promise.resolve(null);
            return new Promise(function (resolve) {
                var url = URL.createObjectURL(file);
                var im = new root.Image();
                im.onload = function () {
                    var w = im.naturalWidth, h = im.naturalHeight;
                    var k = Math.min(1, MAX_PICK_EDGE / Math.max(w, h));
                    var c = doc.createElement('canvas');
                    c.width = Math.max(1, Math.round(w * k));
                    c.height = Math.max(1, Math.round(h * k));
                    var x = c.getContext('2d');
                    x.fillStyle = '#fff';
                    x.fillRect(0, 0, c.width, c.height);
                    x.drawImage(im, 0, 0, c.width, c.height);
                    URL.revokeObjectURL(url);
                    c.toBlob(function (blob) {
                        if (!blob) { resolve(null); return; }
                        resolve({ blob: blob, w: c.width, h: c.height, thumb: URL.createObjectURL(blob), name: file.name || '' });
                    }, 'image/jpeg', 0.9);
                };
                im.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
                im.src = url;
            });
        }

        /** One picture keeps the crop screen; several pictures or any PDF go straight to the page list. */
        function pickFiles(list) {
            var files = Array.prototype.slice.call(list || []);
            if (!files.length) return Promise.resolve();
            if (files.length === 1 && classifyFile(files[0]) === 'image' && pages.length < MAX_PAGES) {
                loadFile(files[0]);
                return Promise.resolve();
            }
            var take = files.slice(0, roomFor(pages.length, files.length));
            var added = 0;
            var chain = Promise.resolve();
            take.forEach(function (f) {
                chain = chain.then(function () {
                    return readPicked(f).then(function (p) { if (p) { pages.push(p); added++; } });
                });
            });
            return chain.then(function () {
                updateBadges();
                if (added) { stopCamera(); show('scSend'); }
                var skipped = files.length - added;
                setProgress(added + ' ' + L.added + (skipped > 0 ? ', ' + skipped + ' ' + L.skipped : ''));
            });
        }

        function recropPage(i) {
            var p = pages[i];
            if (!p || p.pdf) return;
            var url = URL.createObjectURL(p.blob);
            var im = new root.Image();
            im.onload = function () {
                var c = drawToSource(im, im.naturalWidth, im.naturalHeight);
                URL.revokeObjectURL(url);
                editIdx = i;
                beginCrop(c, 'orig');
            };
            im.onerror = function () { URL.revokeObjectURL(url); };
            im.src = url;
        }

        function flash() {
            var f = $('scFlash');
            f.hidden = false;
            setTimeout(function () { f.hidden = true; }, 140);
        }

        /** Shutter - pressed by hand at any time (also during the count-down) or fired by the auto timer. */
        function capture() {
            var v = $('scVideo');
            if (!v.videoWidth) return;
            countShow(false);
            /* only what is inside the dotted frame is scanned */
            var roi = guideRoi() || { x: 0, y: 0, w: v.videoWidth, h: v.videoHeight };
            var k = Math.min(1, MAX_SRC_EDGE / Math.max(roi.w, roi.h));
            var src = doc.createElement('canvas');
            src.width = Math.max(1, Math.round(roi.w * k));
            src.height = Math.max(1, Math.round(roi.h * k));
            src.getContext('2d').drawImage(v, roi.x, roi.y, roi.w, roi.h, 0, 0, src.width, src.height);
            var found = detectQuadFor(src, 0.5);
            auto.refDet = (auto.det && auto.det.found) ? auto.det : null;
            editIdx = -1;
            flash();
            beginFromSource(src, found.quad);
        }

        function blobToDataUrl(blob) {
            return new Promise(function (res, rej) {
                var fr = new root.FileReader();
                fr.onload = function () { res(fr.result); };
                fr.onerror = function () { rej(fr.error); };
                fr.readAsDataURL(blob);
            });
        }

        function loadJsPdf() {
            if (root.jspdf && root.jspdf.jsPDF) return Promise.resolve(root.jspdf.jsPDF);
            return new Promise(function (res, rej) {
                var s = doc.createElement('script');
                s.src = CDN_JSPDF;
                s.onload = function () { res(root.jspdf && root.jspdf.jsPDF); };
                s.onerror = function () { rej(new Error('jspdf')); };
                doc.head.appendChild(s);
            });
        }

        function buildPdfBlob(list) {
            return loadJsPdf().then(function (JsPDF) {
                if (!JsPDF) throw new Error('jspdf');
                return Promise.all(list.map(function (p) { return blobToDataUrl(p.blob); })).then(function (urls) {
                    var pdf = null;
                    list.forEach(function (p, i) {
                        var sz = pdfPageSize(p.w, p.h);
                        if (!pdf) pdf = new JsPDF({ unit: 'pt', format: [sz.w, sz.h], orientation: sz.orient });
                        else pdf.addPage([sz.w, sz.h], sz.orient);
                        pdf.addImage(urls[i], 'JPEG', 0, 0, sz.w, sz.h);
                    });
                    return pdf.output('blob');
                });
            });
        }

        function setProgress(txt) { $('scSendStatus').textContent = txt || ''; }

        function send() {
            if (!pages.length) return;
            var asPdf = $('scFmtPdf').checked;
            $('scSendBtn').disabled = true;
            setProgress(L.sending);
            var sp = splitPages(pages);
            var jpgItems = sp.images.map(function (p) { return { blob: p.blob, ext: 'jpg', contentType: 'image/jpeg' }; });
            var pdfItems = sp.pdfs.map(function (p) { return { blob: p.blob, ext: 'pdf', contentType: 'application/pdf' }; });
            var prep = (asPdf && sp.images.length)
                ? buildPdfBlob(sp.images).then(function (b) { return [{ blob: b, ext: 'pdf', contentType: 'application/pdf' }].concat(pdfItems); })
                    .catch(function () {
                        setProgress(L.pdfFail);
                        return jpgItems.concat(pdfItems);
                    })
                : Promise.resolve(jpgItems.concat(pdfItems));
            prep.then(function (items) {
                return uploadItems(sb, params.token, items, function (i, n) { setProgress(L.sending + ' ' + i + '/' + n); }, seq)
                    .then(function (res) {
                        seq = res.nextSeq;
                        keepSeq();
                        $('scSendBtn').disabled = false;
                        if (res.failed) {
                            setProgress(L.failed);
                            return;
                        }
                        sentCount += pages.length;
                        pages.forEach(function (p) { URL.revokeObjectURL(p.thumb); });
                        pages = [];
                        updateBadges();
                        sendMarker(sb, params.token, 'done', doneK).then(function (m) { if (m && m.k) { doneK = m.k + 1; keepSeq(); } });
                        $('scDoneCount').textContent = sentCount + ' ' + L.sentN;
                        setProgress('');
                        show('scDone');
                    });
            });
        }

        /* wiring */
        $('scStartBtn').addEventListener('click', function () { startCamera(); });
        $('scShutter').addEventListener('click', capture);
        ['scCamFile', 'scGalleryFile'].forEach(function (id) {
            $(id).addEventListener('change', function (e) {
                var picked = Array.prototype.slice.call(e.target.files || []);
                e.target.value = '';
                pickFiles(picked);
            });
        });
        $('scIntroCamFile').addEventListener('change', function (e) { loadFile(e.target.files && e.target.files[0]); e.target.value = ''; });
        $('scFinishBtn').addEventListener('click', function () { if (pages.length) { stopCamera(); show('scSend'); } });
        $('scCropNext').addEventListener('click', applyCrop);
        $('scCropRetake').addEventListener('click', function () {
            if (cur && cur.base) { show('scPreview'); renderPreview(); return; }
            cur = null;
            if (editIdx >= 0) { editIdx = -1; show('scSend'); } else startCamera();
        });
        $('scPreviewCrop').addEventListener('click', function () { if (cur) { show('scCrop'); drawCrop(); } });
        $('scPreviewRetake').addEventListener('click', previewRetake);
        $('scPreviewNext').addEventListener('click', previewNext);
        $('scModeAuto').addEventListener('click', function () { autoSet(true); });
        $('scModeManual').addEventListener('click', function () { autoSet(false); });
        $('scRotate').addEventListener('click', function () { cur.base = rotateCanvas(cur.base); renderPreview(); });
        $('scAddPage').addEventListener('click', addPage);
        doc.querySelectorAll('[data-filter]').forEach(function (el) {
            el.addEventListener('click', function () { cur.mode = el.getAttribute('data-filter'); renderPreview(); });
        });
        $('scLastThumb').addEventListener('click', function () { openPageViewer(pages.length - 1); });
        $('scPreviewCanvas').addEventListener('click', openPreviewViewer);
        $('scViewerClose').addEventListener('click', closeViewer);
        var vbox = $('scViewerScroll');
        vbox.addEventListener('pointerdown', viewerDown);
        vbox.addEventListener('pointermove', viewerMove);
        vbox.addEventListener('pointerup', viewerUp);
        vbox.addEventListener('pointercancel', viewerUp);
        vbox.addEventListener('wheel', viewerWheel, { passive: false });
        $('scViewerZoom').addEventListener('click', viewerZoomButton);
        $('scViewerPrev').addEventListener('click', function () { viewerGo(-1); });
        $('scViewerNext').addEventListener('click', function () { viewerGo(1); });
        doc.addEventListener('keydown', function (e) {
            if ($('scViewer').hidden) return;
            if (e.key === 'ArrowLeft') viewerGo(-1);
            else if (e.key === 'ArrowRight') viewerGo(1);
            else if (e.key === 'Escape') closeViewer();
        });
        $('scViewerCrop').addEventListener('click', function () {
            var it = viewer.items[viewer.idx];
            var pi = it ? it.pageIdx : null;
            closeViewer();
            if (pi != null) recropPage(pi);
        });
        $('scSendBack').addEventListener('click', function () { startCamera(); });
        $('scSendBtn').addEventListener('click', send);
        $('scMoreBtn').addEventListener('click', function () { startCamera(); });
        root.addEventListener('pagehide', stopCamera);
        root.addEventListener('resize', function () {
            if (cur && $('scCrop').hidden === false) drawCrop();
            if (!$('scViewer').hidden && viewer.items.length) viewerLayout();
        });

        updateBadges();
        autoPaintBtn();
        show('scIntro');
        root.__scanState = function () {
            return {
                pages: pages.length, sent: sentCount, hasCurrent: !!cur,
                auto: { on: auto.on, phase: auto.st.phase, armed: auto.st.armed, counting: auto.counting, reason: auto.det ? auto.det.reason : '', roi: guideRoi() },
                viewer: { s: viewer.v.s, tx: viewer.v.tx, ty: viewer.v.ty, idx: viewer.idx, n: viewer.items.length }
            };
        };
    }

    function boot() {
        var sb = root.__CS_SCAN_SB || null;
        if (!sb && root.supabase && root.supabase.createClient) {
            sb = root.supabase.createClient(
                'https://kprihawipljrltfzpfjd.supabase.co',
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
                'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtwcmloYXdpcGxqcmx0ZnpwZmpkIiwi' +
                'cm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzUyMzAsImV4cCI6MjA5MjM1MTIzMH0.' +
                'fHbfVQOmIMOTbjBTG6iy2yrgmo-iZXEe-wNLlAlVtM4'
            );
        }
        bootUi({ sb: sb });
    }

    var api = {
        BUCKET: BUCKET, PREFIX: PREFIX,
        parseParams: parseParams, isValidToken: isValidToken, isExpired: isExpired, normLang: normLang,
        buildPath: buildPath, buildHelloPath: buildHelloPath, buildDonePath: buildDonePath,
        squareToQuad: squareToQuad, mapUnit: mapUnit, outputSize: outputSize, defaultQuad: defaultQuad,
        quadIsValid: quadIsValid, warpQuad: warpQuad, enhance: enhance, pdfPageSize: pdfPageSize,
        clampScale: clampScale, fitSize: fitSize, viewClamp: viewClamp, zoomAbout: zoomAbout, zoomPercent: zoomPercent, nextViewScale: nextViewScale,
        rgbaToGray: rgbaToGray, detectDocument: detectDocument, quadShift: quadShift, quadsClose: quadsClose, scaleQuad: scaleQuad, fullQuad: fullQuad,
        autoNew: autoNew, autoStep: autoStep, AUTO: AUTO, coverMap: coverMap, DET_W: DET_W, DETX_W: DETX_W,
        detectText: detectText, sigOf: sigOf, sigDiff: sigDiff, guideToVideo: guideToVideo,
        classifyFile: classifyFile, roomFor: roomFor, splitPages: splitPages, MAX_PAGES: MAX_PAGES,
        makeUploader: makeUploader, uploadItems: uploadItems, sendMarker: sendMarker,
        strings: strings, boot: boot
    };

    root.CSPhoneScan = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
