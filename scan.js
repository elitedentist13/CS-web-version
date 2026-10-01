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

    /* ── pure helpers (unit-tested in Node) ───────────────────── */

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
            title: 'Scan a document', for: 'Scanning for', start: 'Open scanner', gallery: 'Choose from gallery',
            writeOnly: 'This page can only add new pages. Nothing can be changed or deleted from your phone.',
            camDenied: 'Camera not available. Use "Choose from gallery" or the camera button instead.',
            needHttps: 'The live camera needs a secure (https) page. Use the camera button instead.',
            capture: 'Take photo', pages: 'Pages', finish: 'Review & send', crop: 'Drag the corners to fit the page',
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
            title: '掃描文件', for: '掃描對象', start: '開啟掃描器', gallery: '從相簿選擇',
            writeOnly: '此頁面只能新增頁面，無法在手機上修改或刪除任何內容。',
            camDenied: '無法使用相機。請改用「從相簿選擇」或相機按鈕。',
            needHttps: '即時相機需要安全 (https) 網頁，請改用相機按鈕。',
            capture: '拍照', pages: '頁數', finish: '檢查並傳送', crop: '拖曳四角對齊文件',
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
            title: '扫描文件', for: '扫描对象', start: '打开扫描器', gallery: '从相册选择',
            writeOnly: '此页面只能新增页面，无法在手机上修改或删除任何内容。',
            camDenied: '无法使用相机。请改用“从相册选择”或相机按钮。',
            needHttps: '实时相机需要安全 (https) 网页，请改用相机按钮。',
            capture: '拍照', pages: '页数', finish: '检查并发送', crop: '拖动四角对齐文件',
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
        }

        /* camera */
        function stopCamera() {
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

        function beginCrop(canvas) {
            cur = { src: canvas, quad: defaultQuad(canvas.width, canvas.height), mode: 'color', base: null };
            show('scCrop');
            drawCrop();
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

        function addPage() {
            $('scPreviewCanvas').toBlob(function (blob) {
                if (!blob) return;
                var pv = $('scPreviewCanvas');
                pages.push({ blob: blob, w: pv.width, h: pv.height, thumb: URL.createObjectURL(blob) });
                cur = null;
                updateBadges();
                startCamera();
            }, 'image/jpeg', 0.86);
        }

        function loadFile(file) {
            if (!file) return;
            var url = URL.createObjectURL(file);
            var im = new root.Image();
            im.onload = function () {
                var c = drawToSource(im, im.naturalWidth, im.naturalHeight);
                URL.revokeObjectURL(url);
                beginCrop(c);
            };
            im.onerror = function () { URL.revokeObjectURL(url); };
            im.src = url;
        }

        function capture() {
            var v = $('scVideo');
            if (!v.videoWidth) return;
            beginCrop(drawToSource(v, v.videoWidth, v.videoHeight));
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

        function buildPdfBlob() {
            return loadJsPdf().then(function (JsPDF) {
                if (!JsPDF) throw new Error('jspdf');
                return Promise.all(pages.map(function (p) { return blobToDataUrl(p.blob); })).then(function (urls) {
                    var pdf = null;
                    pages.forEach(function (p, i) {
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
            var prep = asPdf
                ? buildPdfBlob().then(function (b) { return [{ blob: b, ext: 'pdf', contentType: 'application/pdf' }]; })
                    .catch(function () {
                        setProgress(L.pdfFail);
                        return pages.map(function (p) { return { blob: p.blob, ext: 'jpg', contentType: 'image/jpeg' }; });
                    })
                : Promise.resolve(pages.map(function (p) { return { blob: p.blob, ext: 'jpg', contentType: 'image/jpeg' }; }));
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
        $('scCamFile').addEventListener('change', function (e) { loadFile(e.target.files && e.target.files[0]); e.target.value = ''; });
        $('scGalleryFile').addEventListener('change', function (e) { loadFile(e.target.files && e.target.files[0]); e.target.value = ''; });
        $('scIntroCamFile').addEventListener('change', function (e) { loadFile(e.target.files && e.target.files[0]); e.target.value = ''; });
        $('scFinishBtn').addEventListener('click', function () { if (pages.length) { stopCamera(); show('scSend'); } });
        $('scCropNext').addEventListener('click', applyCrop);
        $('scCropRetake').addEventListener('click', function () { cur = null; startCamera(); });
        $('scPreviewBack').addEventListener('click', function () { show('scCrop'); drawCrop(); });
        $('scRotate').addEventListener('click', function () { cur.base = rotateCanvas(cur.base); renderPreview(); });
        $('scAddPage').addEventListener('click', addPage);
        doc.querySelectorAll('[data-filter]').forEach(function (el) {
            el.addEventListener('click', function () { cur.mode = el.getAttribute('data-filter'); renderPreview(); });
        });
        $('scSendBack').addEventListener('click', function () { startCamera(); });
        $('scSendBtn').addEventListener('click', send);
        $('scMoreBtn').addEventListener('click', function () { startCamera(); });
        root.addEventListener('pagehide', stopCamera);
        root.addEventListener('resize', function () { if (cur && $('scCrop').hidden === false) drawCrop(); });

        updateBadges();
        show('scIntro');
        root.__scanState = function () { return { pages: pages.length, sent: sentCount, hasCurrent: !!cur }; };
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
        makeUploader: makeUploader, uploadItems: uploadItems, sendMarker: sendMarker,
        strings: strings, boot: boot
    };

    root.CSPhoneScan = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
