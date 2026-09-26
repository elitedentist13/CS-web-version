// app-xray-capture.js — Banana X-ray Helper.
// A small yellow always-on-top panel (Document Picture-in-Picture, Chrome/Edge 116+) that floats
// above the X-ray imaging software. The user shares the screen (or the imaging window) once;
// every "Capture" then grabs a full-resolution frame, opens a cropper in the floating window,
// shows the usual upload fields, and saves a lossless PNG to the patient's X-rays in Banana
// (8-bit greyscale when the crop is grey — about a third of the storage of an RGBA PNG).
// Without Document PiP the same cropper runs as a one-shot overlay inside the Banana page.
(function () {
    'use strict';

    // PNG keeps every pixel; only fall back to near-lossless JPEG for huge full-screen grabs.
    var XH_MAX_PNG_BYTES = 25 * 1024 * 1024;
    var XH_JPEG_QUALITY = 0.97;
    var XH_MIN_SEL = 8;
    var XH_HANDLE = 9;
    // Slim horizontal bar meant to sit over the imaging software's title/toolbar strip.
    var XH_BAR_W = 920;
    var XH_BAR_H = 60;
    // Pages cannot position a PiP window; Chrome reopens it where the user last dragged it.
    var XH_HEADER_ZONE_PX = 140;

    var XH_CSS = [
        '.xh-root{font-family:system-ui,"Segoe UI","Microsoft JhengHei",sans-serif;color:#422006;box-sizing:border-box}',
        '.xh-root *{box-sizing:border-box}',
        'body.xh-pip{margin:0;background:#fde047;overflow:hidden}',
        '.xh-bar{display:flex;align-items:center;gap:8px;height:100vh;padding:6px 10px;white-space:nowrap;',
        '  background:linear-gradient(180deg,#fef08a 0%,#fde047 55%,#facc15 100%);border-bottom:2px solid #eab308}',
        '.xh-brand{display:flex;align-items:center;font-size:20px;line-height:1;flex:0 0 auto;cursor:default}',
        '.xh-patient{background:#fffbeb;border:1px solid #f59e0b;border-radius:999px;padding:3px 10px;font-size:12px;',
        '  line-height:1.3;flex:0 0 auto;max-width:200px;overflow:hidden;text-overflow:ellipsis}',
        '.xh-patient b{color:#1e293b}',
        '.xh-patient.is-none{border-style:dashed;color:#92400e}',
        '.xh-status{font-size:11px;color:#713f12;display:flex;align-items:center;gap:5px;min-width:0;flex:1 1 auto;',
        '  overflow:hidden;text-overflow:ellipsis}',
        '.xh-status span:last-child{overflow:hidden;text-overflow:ellipsis}',
        '.xh-status.ok{color:#166534;font-weight:700}',
        '.xh-status.err{color:#b91c1c;font-weight:700}',
        '.xh-status.tip{color:#1e3a8a;font-weight:700}',
        '.xh-bar .xh-btn{padding:6px 10px;font-size:12px;flex:0 0 auto}',
        '.xh-bar .xh-btn--go{font-size:14px;padding:8px 14px}',
        '.xh-btn--x{width:30px;padding:6px 0!important}',
        '.xh-crop--snip .xh-stage{cursor:crosshair}',
        '.xh-snip-tip{position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:2;display:flex;align-items:center;',
        '  gap:8px;background:#facc15;color:#422006;border-radius:999px;padding:5px 6px 5px 14px;font-size:12px;font-weight:700;',
        '  box-shadow:0 6px 18px rgba(0,0,0,.35);white-space:nowrap}',
        '.xh-snip-tip .xh-btn{padding:4px 10px;font-size:12px}',
        '.xh-crop--snip{position:relative}',
        '.xh-overlay .xh-snip-tip{top:auto;bottom:18px}',
        '.xh-guess{font-weight:600;font-size:11px;color:#92400e}',
        '.xh-dot{width:8px;height:8px;border-radius:50%;background:#a8a29e;flex:0 0 auto}',
        '.xh-dot.on{background:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.2)}',
        '.xh-btn{border:none;border-radius:8px;padding:8px 10px;font-size:13px;font-weight:700;cursor:pointer;',
        '  background:#fff;color:#713f12;border:1px solid #eab308}',
        '.xh-btn:hover:not(:disabled){background:#fefce8}',
        '.xh-btn:disabled{opacity:.5;cursor:not-allowed}',
        '.xh-btn--go{background:#1e293b;color:#fde047;border-color:#0f172a;font-size:15px;padding:12px 10px}',
        '.xh-btn--go:hover:not(:disabled){background:#0f172a}',
        '.xh-row{display:flex;gap:6px}',
        '.xh-row .xh-btn{flex:1}',
        '.xh-msg{font-size:11px;line-height:1.35;color:#713f12;min-height:15px}',
        '.xh-msg.ok{color:#166534;font-weight:700}',
        '.xh-msg.err{color:#b91c1c;font-weight:700}',
        '.xh-crop{display:flex;flex-direction:column;height:100%;background:#0b1020;color:#e2e8f0}',
        '.xh-crop-bar{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#facc15;color:#422006;flex-wrap:wrap}',
        '.xh-crop-title{font-weight:800;font-size:14px}',
        '.xh-crop-size{font-size:12px;font-weight:700;background:#fffbeb;border-radius:999px;padding:2px 10px}',
        '.xh-crop-actions{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}',
        '.xh-crop-hint{font-size:12px;padding:5px 12px;color:#cbd5e1;background:#111827}',
        '.xh-stage{flex:1;position:relative;min-height:0}',
        '.xh-canvas{position:absolute;inset:0;display:block;cursor:crosshair;touch-action:none}',
        '.xh-form{display:flex;flex-direction:column;gap:10px;height:100%;padding:14px 16px;background:#fffbeb;overflow:auto}',
        '.xh-form h3{margin:0;font-size:16px;color:#713f12}',
        '.xh-form .xh-to{font-size:13px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:6px 10px}',
        '.xh-form .xh-to b{color:#1e293b}',
        '.xh-prev{text-align:center;background:#1a1a2e;border-radius:8px;padding:6px}',
        '.xh-prev img{max-width:100%;max-height:34vh;object-fit:contain;display:inline-block}',
        '.xh-prev small{display:block;color:#cbd5e1;font-size:11px;margin-top:4px}',
        '.xh-fg{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:700;color:#713f12}',
        '.xh-fg select,.xh-fg input,.xh-fg textarea{font:inherit;font-weight:400;font-size:13px;padding:7px 8px;',
        '  border:1px solid #d6d3d1;border-radius:6px;background:#fff;color:#1e293b}',
        '.xh-overlay{position:fixed;inset:0;z-index:2147483000;background:#0b1020}',
        'html.xh-overlay-open,html.xh-overlay-open body{overflow:hidden}'
    ].join('\n');

    var helper = {
        pip: null,
        big: false,
        stream: null,
        video: null,
        view: 'bar',
        msg: '',
        msgKind: '',
        cropper: null,
        pendingName: null,
        timer: null,
        busy: false
    };
    var inpage = { overlay: null, cropper: null, busy: false, fromHelper: false };

    function tr(k) { return typeof mediaTr === 'function' ? mediaTr(k) : k; }
    function trRepl(k, p) {
        var s = tr(k);
        Object.keys(p || {}).forEach(function (n) { s = s.split('{' + n + '}').join(String(p[n])); });
        return s;
    }
    function h(s) { return typeof esc === 'function' ? esc(s) : String(s == null ? '' : s); }

    function ensureCss(doc) {
        if (doc.getElementById('xhCss')) return;
        var s = doc.createElement('style');
        s.id = 'xhCss';
        s.textContent = XH_CSS;
        (doc.head || doc.documentElement).appendChild(s);
    }

    function pipSupported() { return typeof window.documentPictureInPicture !== 'undefined'; }
    function displaySupported() {
        return !!(navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function');
    }
    function hasPatient() { return typeof xrayPatientId !== 'undefined' && !!xrayPatientId; }

    function patientInfo() {
        if (!hasPatient()) return null;
        var p = (typeof xrayPatientData !== 'undefined' && xrayPatientData) || {};
        return {
            no: p.patient_no ? '#' + p.patient_no : '',
            name: String(p.chinese_name || p.full_name || '').trim(),
            en: String(p.chinese_name && p.full_name ? p.full_name : '').trim()
        };
    }

    function stopStream(stream) {
        if (!stream) return;
        stream.getTracks().forEach(function (t) { try { t.stop(); } catch (_) {} });
    }

    function requestDisplayStream() {
        return navigator.mediaDevices.getDisplayMedia({
            // The imaging software is its own program: open Chrome's picker on the "Window" tab.
            video: { displaySurface: 'window', frameRate: { ideal: 5, max: 30 } },
            audio: false,
            preferCurrentTab: false,
            selfBrowserSurface: 'exclude',
            surfaceSwitching: 'include',
            systemAudio: 'exclude',
            monitorTypeSurfaces: 'include'
        }).then(function (stream) {
            var track = stream.getVideoTracks()[0];
            if (track && 'contentHint' in track) {
                try { track.contentHint = 'detail'; } catch (_) {}
            }
            if (sharedBrowserTab(stream)) {
                stopStream(stream);
                var err = new Error('wrong surface');
                err.name = 'WrongSurface';
                throw err;
            }
            return stream;
        });
    }

    /** A shared Chrome tab would capture Banana (or a web page), never the imaging software. */
    function sharedBrowserTab(stream) {
        var track = stream && stream.getVideoTracks()[0];
        var s = track && typeof track.getSettings === 'function' ? track.getSettings() : null;
        return !!(s && s.displaySurface === 'browser');
    }

    function bitmapToCanvas(src, w, h2) {
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h2;
        c.getContext('2d').drawImage(src, 0, 0, w, h2);
        return c;
    }

    function waitMs(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function playVideoForStream(stream, hostDoc) {
        var v = (hostDoc || document).createElement('video');
        v.muted = true;
        v.playsInline = true;
        v.autoplay = true;
        v.setAttribute('aria-hidden', 'true');
        v.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none;';
        v.srcObject = stream;
        (hostDoc || document).body.appendChild(v);
        return new Promise(function (resolve, reject) {
            v.onloadedmetadata = function () { v.play().then(function () { resolve(v); }, reject); };
            v.onerror = function () { reject(new Error('video error')); };
        });
    }

    function grabViaVideo(video) {
        var w = video.videoWidth;
        var h2 = video.videoHeight;
        if (!w || !h2) return Promise.reject(new Error('empty frame'));
        return Promise.resolve(bitmapToCanvas(video, w, h2));
    }

    /** Current frame of the stream at the source's native pixel size. */
    function grabFrame(stream, video) {
        var track = stream && stream.getVideoTracks()[0];
        if (!track || track.readyState !== 'live') return Promise.reject(new Error('not sharing'));
        if (typeof ImageCapture === 'function') {
            return new ImageCapture(track).grabFrame().then(function (bmp) {
                var c = bitmapToCanvas(bmp, bmp.width, bmp.height);
                if (bmp.close) bmp.close();
                return c;
            }).catch(function () {
                return video ? grabViaVideo(video) : Promise.reject(new Error('grab failed'));
            });
        }
        return video ? grabViaVideo(video) : Promise.reject(new Error('grab failed'));
    }

    // ── Encoding ─────────────────────────────────────────────────

    /** Integer crop of the full-resolution frame, copied 1:1 (no resampling). */
    function cropToCanvas(frame, sel) {
        var x = Math.max(0, Math.floor(sel.x));
        var y = Math.max(0, Math.floor(sel.y));
        var x1 = Math.min(frame.width, Math.ceil(sel.x + sel.w));
        var y1 = Math.min(frame.height, Math.ceil(sel.y + sel.h));
        var w = Math.max(1, x1 - x);
        var h2 = Math.max(1, y1 - y);
        var out = document.createElement('canvas');
        out.width = w;
        out.height = h2;
        var ctx = out.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(frame, x, y, w, h2, 0, 0, w, h2);
        return out;
    }

    function canvasToBlob(canvas, type, quality) {
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('encode failed')); }, type, quality);
        });
    }

    // ── 8-bit greyscale PNG (X-rays are grey; canvas.toBlob can only write RGBA) ──

    var CRC_TABLE = null;
    function crc32(bytes, start, end) {
        if (!CRC_TABLE) {
            CRC_TABLE = new Uint32Array(256);
            for (var n = 0; n < 256; n++) {
                var c = n;
                for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                CRC_TABLE[n] = c >>> 0;
            }
        }
        var crc = 0xFFFFFFFF;
        for (var i = start; i < end; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    /**
     * One luma byte per pixel, or null when the crop really contains colour.
     * Screen-capture pipelines can add ±few levels of chroma noise to grey pixels, so a pixel only
     * counts as coloured when its channels differ by more than XH_GREY_TOLERANCE.
     */
    var XH_GREY_TOLERANCE = 12;
    var XH_GREY_MAX_COLOUR_RATIO = 0.002;
    function greyPlane(rgba, count) {
        var out = new Uint8Array(count);
        var coloured = 0;
        var limit = Math.floor(count * XH_GREY_MAX_COLOUR_RATIO);
        for (var i = 0, p = 0; i < count; i++, p += 4) {
            var r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
            var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
            var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
            if (mx - mn > XH_GREY_TOLERANCE && ++coloured > limit) return null;
            // BT.601 weights summing to 256, so r = g = b maps back to exactly the same value.
            out[i] = (r * 77 + g * 150 + b * 29 + 128) >> 8;
        }
        return out;
    }

    /** PNG row filtering (adaptive: per row, the filter with the smallest sum of |residual|). */
    function pngPredict(f, a, b, c) {
        if (f === 0) return 0;
        if (f === 1) return a;
        if (f === 2) return b;
        if (f === 3) return (a + b) >> 1;
        var p = a + b - c;
        var pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
    }

    function filterGreyRows(px, w, h2) {
        var stride = w + 1;
        var out = new Uint8Array(stride * h2);
        for (var y = 0; y < h2; y++) {
            var row = y * w;
            var prev = row - w;
            var best = 0, bestSum = Infinity;
            for (var f = 0; f < 5; f++) {
                var sum = 0;
                for (var x = 0; x < w && sum < bestSum; x++) {
                    var a = x > 0 ? px[row + x - 1] : 0;
                    var b = y > 0 ? px[prev + x] : 0;
                    var c = (x > 0 && y > 0) ? px[prev + x - 1] : 0;
                    var v = (px[row + x] - pngPredict(f, a, b, c)) & 0xFF;
                    sum += v < 128 ? v : 256 - v;
                }
                if (sum < bestSum) { bestSum = sum; best = f; }
            }
            var o = y * stride;
            out[o] = best;
            for (var x2 = 0; x2 < w; x2++) {
                var a2 = x2 > 0 ? px[row + x2 - 1] : 0;
                var b2 = y > 0 ? px[prev + x2] : 0;
                var c2 = (x2 > 0 && y > 0) ? px[prev + x2 - 1] : 0;
                out[o + 1 + x2] = (px[row + x2] - pngPredict(best, a2, b2, c2)) & 0xFF;
            }
        }
        return out;
    }

    function zlibDeflate(bytes) {
        var cs = new CompressionStream('deflate');
        return new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer()
            .then(function (buf) { return new Uint8Array(buf); });
    }

    function pngChunk(type, data) {
        var out = new Uint8Array(12 + data.length);
        var dv = new DataView(out.buffer);
        dv.setUint32(0, data.length);
        for (var i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
        out.set(data, 8);
        dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
        return out;
    }

    function encodeGreyPng(px, w, h2) {
        return zlibDeflate(filterGreyRows(px, w, h2)).then(function (idat) {
            var ihdr = new Uint8Array(13);
            var dv = new DataView(ihdr.buffer);
            dv.setUint32(0, w);
            dv.setUint32(4, h2);
            ihdr[8] = 8;  // bit depth
            ihdr[9] = 0;  // colour type 0 = greyscale
            var sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
            return new Blob([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))],
                { type: 'image/png' });
        });
    }

    /** Greyscale PNG when the crop is grey, else the browser's RGBA PNG (JPEG only past the size cap). */
    function encodeBest(canvas) {
        var grey = null;
        if (typeof CompressionStream === 'function') {
            try {
                var w = canvas.width, h2 = canvas.height;
                var data = canvas.getContext('2d').getImageData(0, 0, w, h2).data;
                var plane = greyPlane(data, w * h2);
                if (plane) grey = encodeGreyPng(plane, w, h2);
            } catch (_) { grey = null; }
        }
        var start = grey
            ? grey.then(function (b) { return { blob: b, ext: 'png', grey: true }; }, function () { return null; })
            : Promise.resolve(null);
        return start.then(function (res) {
            if (res && res.blob.size <= XH_MAX_PNG_BYTES) return res;
            return canvasToBlob(canvas, 'image/png').then(function (png) {
                if (png.size <= XH_MAX_PNG_BYTES) return { blob: png, ext: 'png', grey: false };
                return canvasToBlob(canvas, 'image/jpeg', XH_JPEG_QUALITY).then(function (jpg) {
                    return { blob: jpg, ext: 'jpg', grey: false };
                });
            });
        });
    }

    function captureFileName(ext) {
        var d = new Date();
        var p2 = function (n) { return ('0' + n).slice(-2); };
        return 'banana-capture-' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' +
            p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()) + '-' +
            Math.random().toString(36).slice(2, 6) + '.' + ext;
    }

    /**
     * Best guess of the film type from the crop's shape; staff confirm it in the upload panel.
     * Portrait sensors → periapical, very wide → panoramic, large landscape → ceph, else bitewing.
     */
    function guessXrayType(w, h2) {
        if (!w || !h2) return 'Periapical';
        var r = w / h2;
        if (r >= 1.75) return 'Panoramic';
        if (r < 0.9) return 'Periapical';
        var big = Math.min(w, h2) >= 850;
        if (r < 1.15) return big ? 'Cephalometric' : 'Periapical';
        return big && w >= 1100 ? 'Cephalometric' : 'Bitewing';
    }

    // ── Auto: suggest the biggest X-ray-looking area on the shared screen ──
    // Works on a downscaled copy split into small blocks. A block looks like film when it is grey,
    // not dominated by one exact grey level (UI panels and text backgrounds are pixel-perfect,
    // film always carries sensor noise), has some tonal variation, and few hard edges (not text).
    var XH_AUTO_MAX_SIDE = 960;
    var XH_AUTO_BLOCK = 8;
    var XH_AUTO_MIN_BLOCKS = 16;
    var XH_AUTO_MAX_RESULTS = 12;

    var XH_AUTO_LINE_HIST = new Uint16Array(256);
    function autoLineStats(L, C, w, horizontal, idx, a, b) {
        var hist = XH_AUTO_LINE_HIST;
        hist.fill(0);
        var n = 0, sum = 0, sq = 0, col = 0, sharp = 0, prev = -1, mode = 0;
        for (var t = a; t < b; t++) {
            var i = horizontal ? idx * w + t : t * w + idx;
            var v = L[i];
            sum += v; sq += v * v; col += C[i]; n++;
            if (++hist[v] > mode) mode = hist[v];
            if (prev >= 0 && Math.abs(v - prev) > 48) sharp++;
            prev = v;
        }
        if (!n) return { std: 0, colour: 1, sharp: 1, mode: 1 };
        var mean = sum / n;
        return { std: Math.sqrt(Math.max(0, sq / n - mean * mean)), colour: col / n, sharp: sharp / n, mode: mode / n };
    }

    function autoFilmLine(s) { return s.colour < 0.1 && s.mode < 0.3 && s.std >= 1.2 && s.sharp < 0.2; }
    // Only strip lines that are almost entirely one level (viewer background); burned-out film corners stay.
    function autoBorderLine(s) { return s.colour >= 0.1 || s.mode > 0.8 || s.std < 0.8; }

    /** Candidate X-ray rectangles in frame pixels, biggest first (empty when nothing looks like film). */
    function detectXrayAreas(frame) {
        var fw = frame.width, fh = frame.height;
        if (!fw || !fh) return [];
        var sc = Math.min(1, XH_AUTO_MAX_SIDE / Math.max(fw, fh));
        var w = Math.max(1, Math.round(fw * sc));
        var hh = Math.max(1, Math.round(fh * sc));
        var cv = document.createElement('canvas');
        cv.width = w;
        cv.height = hh;
        var ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(frame, 0, 0, w, hh);
        var d = ctx.getImageData(0, 0, w, hh).data;
        var n = w * hh;
        var L = new Uint8Array(n);
        var C = new Uint8Array(n);
        for (var i = 0, p = 0; i < n; i++, p += 4) {
            var r = d[p], g = d[p + 1], b = d[p + 2];
            var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
            var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
            C[i] = mx - mn > 16 ? 1 : 0;
            L[i] = (r * 77 + g * 150 + b * 29 + 128) >> 8;
        }

        var B = XH_AUTO_BLOCK;
        var gw = Math.floor(w / B), gh = Math.floor(hh / B);
        if (gw < 4 || gh < 4) return [];
        var mask = new Uint8Array(gw * gh);
        var hist = new Uint16Array(256);
        for (var by = 0; by < gh; by++) {
            for (var bx = 0; bx < gw; bx++) {
                hist.fill(0);
                var sum = 0, sq = 0, col = 0, sharp = 0, diffs = 0, mode = 0, flatH = 0, flatV = 0;
                for (var y = by * B; y < by * B + B; y++) {
                    for (var x = bx * B; x < bx * B + B; x++) {
                        var k = y * w + x;
                        var v = L[k];
                        sum += v; sq += v * v; col += C[k];
                        if (++hist[v] > mode) mode = hist[v];
                        if (x + 1 < bx * B + B) {
                            var dh = Math.abs(v - L[k + 1]);
                            diffs++; if (dh > 48) sharp++; if (!dh) flatH++;
                        }
                        if (y + 1 < by * B + B) {
                            var dv = Math.abs(v - L[k + w]);
                            diffs++; if (dv > 48) sharp++; if (!dv) flatV++;
                        }
                    }
                }
                var cnt = B * B;
                var lines = B * (B - 1);
                // Gradient toolbars change in one direction only; film noise changes in both.
                if (col > cnt * 0.1 || mode > cnt * 0.3 || flatH > lines * 0.6 || flatV > lines * 0.6) continue;
                var mean = sum / cnt;
                var std = Math.sqrt(Math.max(0, sq / cnt - mean * mean));
                if (std < 1.2 || sharp > diffs * 0.12) continue;
                mask[by * gw + bx] = 1;
            }
        }

        autoFillHoles(mask, gw, gh);

        var seen = new Uint8Array(gw * gh);
        var comps = [];
        var stack = [];
        for (var s0 = 0; s0 < gw * gh; s0++) {
            if (!mask[s0] || seen[s0]) continue;
            var c = { n: 0, x0: gw, y0: gh, x1: -1, y1: -1 };
            stack.push(s0);
            seen[s0] = 1;
            while (stack.length) {
                var cur = stack.pop();
                var cx = cur % gw, cy = (cur - cx) / gw;
                c.n++;
                if (cx < c.x0) c.x0 = cx;
                if (cx > c.x1) c.x1 = cx;
                if (cy < c.y0) c.y0 = cy;
                if (cy > c.y1) c.y1 = cy;
                if (cx > 0 && mask[cur - 1] && !seen[cur - 1]) { seen[cur - 1] = 1; stack.push(cur - 1); }
                if (cx < gw - 1 && mask[cur + 1] && !seen[cur + 1]) { seen[cur + 1] = 1; stack.push(cur + 1); }
                if (cy > 0 && mask[cur - gw] && !seen[cur - gw]) { seen[cur - gw] = 1; stack.push(cur - gw); }
                if (cy < gh - 1 && mask[cur + gw] && !seen[cur + gw]) { seen[cur + gw] = 1; stack.push(cur + gw); }
            }
            var bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1;
            if (c.n < XH_AUTO_MIN_BLOCKS || bw < 4 || bh < 4 || c.n / (bw * bh) < 0.45) continue;
            comps.push(c);
        }
        comps.sort(function (a, b2) { return b2.n - a.n; });

        var out = [];
        for (var ci = 0; ci < comps.length && out.length < XH_AUTO_MAX_RESULTS; ci++) {
            var rc = autoRefine(L, C, w, hh, comps[ci], B);
            var sel = {
                x: Math.max(0, Math.floor(rc.x0 / sc)),
                y: Math.max(0, Math.floor(rc.y0 / sc))
            };
            sel.w = Math.min(fw, Math.ceil(rc.x1 / sc)) - sel.x;
            sel.h = Math.min(fh, Math.ceil(rc.y1 / sc)) - sel.y;
            if (sel.w >= XH_MIN_SEL && sel.h >= XH_MIN_SEL) out.push(sel);
        }
        return out;
    }

    /** Smooth areas fully enclosed by film (dark air, bright crowns) belong to the film. */
    function autoFillHoles(mask, gw, gh) {
        var out = new Uint8Array(gw * gh);
        var stack = [];
        function seed(i) { if (!mask[i] && !out[i]) { out[i] = 1; stack.push(i); } }
        for (var x = 0; x < gw; x++) { seed(x); seed((gh - 1) * gw + x); }
        for (var y = 0; y < gh; y++) { seed(y * gw); seed(y * gw + gw - 1); }
        while (stack.length) {
            var cur = stack.pop();
            var cx = cur % gw;
            if (cx > 0) seed(cur - 1);
            if (cx < gw - 1) seed(cur + 1);
            if (cur >= gw) seed(cur - gw);
            if (cur < (gh - 1) * gw) seed(cur + gw);
        }
        for (var i = 0; i < gw * gh; i++) if (!mask[i] && !out[i]) mask[i] = 1;
    }

    /** Pixel-accurate edges: grow into film rows the blocks missed, then trim flat borders. */
    function autoRefine(L, C, w, hh, c, B) {
        var r = { x0: c.x0 * B, y0: c.y0 * B, x1: (c.x1 + 1) * B, y1: (c.y1 + 1) * B };
        var k;
        for (k = 0; k < B && r.y0 > 0 && autoFilmLine(autoLineStats(L, C, w, true, r.y0 - 1, r.x0, r.x1)); k++) r.y0--;
        for (k = 0; k < B && r.y1 < hh && autoFilmLine(autoLineStats(L, C, w, true, r.y1, r.x0, r.x1)); k++) r.y1++;
        for (k = 0; k < B && r.x0 > 0 && autoFilmLine(autoLineStats(L, C, w, false, r.x0 - 1, r.y0, r.y1)); k++) r.x0--;
        for (k = 0; k < B && r.x1 < w && autoFilmLine(autoLineStats(L, C, w, false, r.x1, r.y0, r.y1)); k++) r.x1++;
        while (r.y1 - r.y0 > 2 * B && autoBorderLine(autoLineStats(L, C, w, true, r.y0, r.x0, r.x1))) r.y0++;
        while (r.y1 - r.y0 > 2 * B && autoBorderLine(autoLineStats(L, C, w, true, r.y1 - 1, r.x0, r.x1))) r.y1--;
        while (r.x1 - r.x0 > 2 * B && autoBorderLine(autoLineStats(L, C, w, false, r.x0, r.y0, r.y1))) r.x0++;
        while (r.x1 - r.x0 > 2 * B && autoBorderLine(autoLineStats(L, C, w, false, r.x1 - 1, r.y0, r.y1))) r.x1--;
        return r;
    }

    function safeDetect(frame) {
        try { return detectXrayAreas(frame); } catch (_) { return []; }
    }

    function makeCaptureFile(frame, sel) {
        var canvas = cropToCanvas(frame, sel);
        return encodeBest(canvas).then(function (res) {
            var file = new File([res.blob], captureFileName(res.ext), { type: res.blob.type, lastModified: Date.now() });
            file.xhGrey = !!res.grey;
            file.xhCapture = true;
            file.xhTypeGuess = guessXrayType(canvas.width, canvas.height);
            file.xhSel = {
                x: Math.max(0, Math.floor(sel.x)), y: Math.max(0, Math.floor(sel.y)),
                w: canvas.width, h: canvas.height, fw: frame.width, fh: frame.height
            };
            return file;
        });
    }

    // ── Patient lock: a capture belongs to the patient open when Selection was pressed ──

    function patientLabel() {
        var pi = patientInfo();
        return pi ? (pi.no + ' ' + pi.name).trim() : '';
    }

    function currentLock() {
        return hasPatient() ? { pid: String(xrayPatientId), label: patientLabel() } : null;
    }

    function stampLock(file, lock) {
        if (!file || !lock) return;
        file.xhLockedPid = lock.pid;
        file.xhLockedLabel = lock.label;
    }

    /** Used by the upload panel: blocks a capture from being saved to a different patient. */
    function xrayCaptureLockCheck(file) {
        if (!file || !file.xhLockedPid) return { ok: true };
        var ok = hasPatient() && String(xrayPatientId) === String(file.xhLockedPid);
        return { ok: ok, captured: file.xhLockedLabel || '', current: hasPatient() ? patientLabel() : '' };
    }

    // ── Cropper (works in the PiP window or the Banana page) ─────

    /**
     * opts.snip: Snipping-Tool style — dimmed frozen screen, one drag, crop on mouse release.
     * Otherwise a full cropper with move/resize handles and a Crop button.
     */
    function copySel(s) { return { x: s.x, y: s.y, w: s.w, h: s.h }; }

    function createCropper(doc, win, host, frame, cb, opts) {
        opts = opts || {};
        var snip = !!opts.snip;
        var list = snip && opts.auto && opts.suggest && opts.suggest.length ? opts.suggest : null;
        var st = { sel: null, drag: null, view: null, base: null, done: false, auto: list ? { list: list, idx: 0 } : null };
        if (st.auto) st.sel = copySel(list[0]);
        var tipText = !opts.auto ? tr('media.xcap.snipHint') : tr(list ? 'media.xcap.autoFound' : 'media.xcap.autoNone');
        host.innerHTML = snip
            ? '<div class="xh-root xh-crop xh-crop--snip">' +
                '<div class="xh-snip-tip">' +
                    '<span>' + h(tipText) + '</span>' +
                    '<span class="xh-crop-size" data-xh="size"></span>' +
                    (list ? '<button type="button" class="xh-btn xh-btn--go" data-xh="use">' + h(tr('media.xcap.autoUse')) + '</button>' : '') +
                    (list && list.length > 1
                        ? '<button type="button" class="xh-btn" data-xh="next">' + h(tr('media.xcap.autoNext')) + '</button>' : '') +
                    '<button type="button" class="xh-btn" data-xh="whole">' + h(tr('media.xcap.whole')) + '</button>' +
                    '<button type="button" class="xh-btn" data-xh="cancel">' + h(tr('media.xcap.cancel')) + '</button>' +
                    '<button type="button" data-xh="confirm" hidden></button>' +
                '</div>' +
                '<div class="xh-stage"><canvas class="xh-canvas"></canvas></div>' +
              '</div>'
            : '<div class="xh-root xh-crop">' +
                '<div class="xh-crop-bar">' +
                    '<span class="xh-crop-title">' + h(tr('media.xcap.title')) + '</span>' +
                    '<span class="xh-crop-size" data-xh="size"></span>' +
                    '<span class="xh-crop-actions">' +
                        '<button type="button" class="xh-btn" data-xh="whole">' + h(tr('media.xcap.whole')) + '</button>' +
                        '<button type="button" class="xh-btn" data-xh="retake">' + h(tr('media.xcap.retake')) + '</button>' +
                        '<button type="button" class="xh-btn" data-xh="cancel">' + h(tr('media.xcap.cancel')) + '</button>' +
                        '<button type="button" class="xh-btn xh-btn--go" data-xh="confirm" disabled>' +
                            h(tr('media.xcap.confirm')) + '</button>' +
                    '</span>' +
                '</div>' +
                '<div class="xh-crop-hint">' + h(tr('media.xcap.hint')) + '</div>' +
                '<div class="xh-stage"><canvas class="xh-canvas"></canvas></div>' +
            '</div>';
        var stage = host.querySelector('.xh-stage');
        var cv = host.querySelector('.xh-canvas');
        var sizeEl = host.querySelector('[data-xh="size"]');
        var goBtn = host.querySelector('[data-xh="confirm"]');

        function layout() {
            var cw = Math.max(50, stage.clientWidth);
            var ch = Math.max(50, stage.clientHeight);
            var dpr = win.devicePixelRatio || 1;
            cv.style.width = cw + 'px';
            cv.style.height = ch + 'px';
            cv.width = Math.round(cw * dpr);
            cv.height = Math.round(ch * dpr);
            // Small snips may be shown up to 2x for easier cropping; the saved crop stays 1:1.
            var pad = snip ? 0 : 20;
            var s = Math.min((cw - pad) / frame.width, (ch - pad) / frame.height, 2);
            var dw = frame.width * s;
            var dh = frame.height * s;
            st.view = { x: (cw - dw) / 2, y: (ch - dh) / 2, s: s, cw: cw, ch: ch, dpr: dpr };
            var base = doc.createElement('canvas');
            base.width = Math.max(1, Math.round(dw * dpr));
            base.height = Math.max(1, Math.round(dh * dpr));
            var bctx = base.getContext('2d');
            bctx.imageSmoothingEnabled = true;
            bctx.imageSmoothingQuality = 'high';
            bctx.drawImage(frame, 0, 0, base.width, base.height);
            st.base = base;
            draw();
        }

        function toStage(fx, fy) { return { x: st.view.x + fx * st.view.s, y: st.view.y + fy * st.view.s }; }

        function toFrame(clientX, clientY) {
            var r = cv.getBoundingClientRect();
            var x = (clientX - r.left - st.view.x) / st.view.s;
            var y = (clientY - r.top - st.view.y) / st.view.s;
            return { x: Math.max(0, Math.min(frame.width, x)), y: Math.max(0, Math.min(frame.height, y)) };
        }

        function handlePoints(sel) {
            var x0 = sel.x, y0 = sel.y, x1 = sel.x + sel.w, y1 = sel.y + sel.h;
            var xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
            return [
                { k: 'nw', x: x0, y: y0 }, { k: 'n', x: xm, y: y0 }, { k: 'ne', x: x1, y: y0 },
                { k: 'e', x: x1, y: ym }, { k: 'se', x: x1, y: y1 }, { k: 's', x: xm, y: y1 },
                { k: 'sw', x: x0, y: y1 }, { k: 'w', x: x0, y: ym }
            ];
        }

        function selOk() { return !!(st.sel && st.sel.w >= XH_MIN_SEL && st.sel.h >= XH_MIN_SEL); }

        function draw() {
            var v = st.view;
            if (!v || !st.base) return;
            var ctx = cv.getContext('2d');
            ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
            ctx.clearRect(0, 0, v.cw, v.ch);
            var dw = frame.width * v.s;
            var dh = frame.height * v.s;
            ctx.drawImage(st.base, v.x, v.y, dw, dh);
            ctx.fillStyle = 'rgba(2, 6, 23, 0.58)';
            var sel = st.sel;
            if (!sel) {
                ctx.fillRect(v.x, v.y, dw, dh);
            } else {
                var a = toStage(sel.x, sel.y);
                var sw = sel.w * v.s;
                var sh = sel.h * v.s;
                ctx.fillRect(v.x, v.y, dw, a.y - v.y);
                ctx.fillRect(v.x, a.y + sh, dw, v.y + dh - (a.y + sh));
                ctx.fillRect(v.x, a.y, a.x - v.x, sh);
                ctx.fillRect(a.x + sw, a.y, v.x + dw - (a.x + sw), sh);
                ctx.strokeStyle = '#facc15';
                ctx.lineWidth = 2;
                ctx.strokeRect(a.x, a.y, sw, sh);
                ctx.strokeStyle = 'rgba(250, 204, 21, 0.35)';
                ctx.lineWidth = 1;
                ctx.beginPath();
                for (var i = 1; i < 3; i++) {
                    ctx.moveTo(a.x + sw * i / 3, a.y); ctx.lineTo(a.x + sw * i / 3, a.y + sh);
                    ctx.moveTo(a.x, a.y + sh * i / 3); ctx.lineTo(a.x + sw, a.y + sh * i / 3);
                }
                ctx.stroke();
                if (!snip) {
                    ctx.fillStyle = '#facc15';
                    handlePoints(sel).forEach(function (hp) {
                        var p = toStage(hp.x, hp.y);
                        ctx.fillRect(p.x - XH_HANDLE / 2, p.y - XH_HANDLE / 2, XH_HANDLE, XH_HANDLE);
                    });
                }
            }
            sizeEl.textContent = sel
                ? Math.round(sel.w) + ' × ' + Math.round(sel.h) + ' px' +
                    (st.auto && st.auto.list.length > 1 && !st.drag ? ' · ' + (st.auto.idx + 1) + '/' + st.auto.list.length : '')
                : trRepl('media.xcap.sourceSize', { W: frame.width, H: frame.height });
            goBtn.disabled = !selOk();
        }

        function hitTest(clientX, clientY) {
            if (!st.sel || snip) return null;
            var r = cv.getBoundingClientRect();
            var px = clientX - r.left;
            var py = clientY - r.top;
            var hs = handlePoints(st.sel);
            for (var i = 0; i < hs.length; i++) {
                var p = toStage(hs[i].x, hs[i].y);
                if (Math.abs(px - p.x) <= XH_HANDLE && Math.abs(py - p.y) <= XH_HANDLE) return hs[i].k;
            }
            var a = toStage(st.sel.x, st.sel.y);
            if (px >= a.x && px <= a.x + st.sel.w * st.view.s &&
                py >= a.y && py <= a.y + st.sel.h * st.view.s) return 'move';
            return null;
        }

        var CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
            n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', move: 'move' };

        function onDown(e) {
            if (e.button !== 0) return;
            e.preventDefault();
            try { cv.setPointerCapture(e.pointerId); } catch (_) {}
            var hit = hitTest(e.clientX, e.clientY);
            var p = toFrame(e.clientX, e.clientY);
            if (hit) {
                st.drag = { mode: hit, start: p, orig: { x: st.sel.x, y: st.sel.y, w: st.sel.w, h: st.sel.h } };
            } else {
                st.drag = { mode: 'new', start: p };
                st.sel = { x: p.x, y: p.y, w: 0, h: 0 };
            }
            draw();
        }

        function onMove(e) {
            if (!st.drag) {
                var hit = hitTest(e.clientX, e.clientY);
                cv.style.cursor = hit ? CURSORS[hit] : 'crosshair';
                return;
            }
            var p = toFrame(e.clientX, e.clientY);
            var d = st.drag;
            var o = d.orig;
            if (d.mode === 'new') {
                st.sel = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y),
                    w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
            } else if (d.mode === 'move') {
                st.sel = {
                    x: Math.max(0, Math.min(frame.width - o.w, o.x + (p.x - d.start.x))),
                    y: Math.max(0, Math.min(frame.height - o.h, o.y + (p.y - d.start.y))),
                    w: o.w, h: o.h
                };
            } else {
                var x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
                if (d.mode.indexOf('w') >= 0) x0 = p.x;
                if (d.mode.indexOf('e') >= 0) x1 = p.x;
                if (d.mode.indexOf('n') >= 0) y0 = p.y;
                if (d.mode.indexOf('s') >= 0) y1 = p.y;
                st.sel = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
            }
            draw();
        }

        function onUp(e) {
            if (!st.drag) return;
            onMove(e);
            try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
            st.drag = null;
            if (!selOk()) {
                // A stray click must not throw away the Auto suggestion.
                st.sel = st.auto ? copySel(st.auto.list[st.auto.idx]) : null;
                draw();
                return;
            }
            draw();
            if (snip) confirm();
        }

        function nextSuggestion() {
            if (!st.auto || st.done) return;
            st.auto.idx = (st.auto.idx + 1) % st.auto.list.length;
            st.sel = copySel(st.auto.list[st.auto.idx]);
            draw();
        }

        function selectWhole() {
            st.sel = { x: 0, y: 0, w: frame.width, h: frame.height };
            draw();
            if (snip) confirm();
        }

        function nudge(dx, dy, resize) {
            var s = st.sel;
            if (!s) return;
            if (resize) {
                s.w = Math.max(XH_MIN_SEL, Math.min(frame.width - s.x, s.w + dx));
                s.h = Math.max(XH_MIN_SEL, Math.min(frame.height - s.y, s.h + dy));
            } else {
                s.x = Math.max(0, Math.min(frame.width - s.w, s.x + dx));
                s.y = Math.max(0, Math.min(frame.height - s.h, s.y + dy));
            }
            draw();
        }

        function confirm() {
            if (!selOk() || st.done) return;
            st.done = true;
            goBtn.disabled = true;
            goBtn.textContent = tr('media.xcap.preparing');
            if (snip) sizeEl.textContent = tr('media.xcap.preparing');
            makeCaptureFile(frame, st.sel).then(function (file) {
                cb.onConfirm(file);
            }).catch(function (err) {
                st.done = false;
                goBtn.disabled = false;
                goBtn.textContent = tr('media.xcap.confirm');
                win.alert(trRepl('media.xcap.failed', { MSG: err && err.message ? err.message : String(err) }));
            });
        }

        function onKey(e) {
            var k = e.key;
            var handled = true;
            if (k === 'Escape') cb.onCancel();
            else if (k === 'Enter') confirm();
            else if (k === 'Tab' && st.auto) nextSuggestion();
            else if (snip) handled = false;
            else if ((e.ctrlKey || e.metaKey) && String(k).toLowerCase() === 'a') selectWhole();
            else if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
                var step = e.shiftKey ? 10 : 1;
                nudge(k === 'ArrowLeft' ? -step : (k === 'ArrowRight' ? step : 0),
                    k === 'ArrowUp' ? -step : (k === 'ArrowDown' ? step : 0), e.altKey);
            } else handled = false;
            if (handled) { e.preventDefault(); e.stopPropagation(); }
        }

        host.addEventListener('click', function (e) {
            var b = e.target.closest && e.target.closest('[data-xh]');
            if (!b || b.disabled) return;
            var act = b.getAttribute('data-xh');
            if (act === 'whole') selectWhole();
            else if (act === 'retake') cb.onRetake();
            else if (act === 'cancel') cb.onCancel();
            else if (act === 'confirm' || act === 'use') confirm();
            else if (act === 'next') nextSuggestion();
        });
        cv.addEventListener('pointerdown', onDown);
        cv.addEventListener('pointermove', onMove);
        cv.addEventListener('pointerup', onUp);
        cv.addEventListener('pointercancel', onUp);
        doc.addEventListener('keydown', onKey, true);
        win.addEventListener('resize', layout);
        var ro = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(layout) : null;
        if (ro) ro.observe(stage);
        layout();

        return {
            state: st,
            selectWhole: selectWhole,
            confirm: confirm,
            destroy: function () {
                doc.removeEventListener('keydown', onKey, true);
                win.removeEventListener('resize', layout);
                if (ro) ro.disconnect();
                host.innerHTML = '';
            }
        };
    }

    // ── Upload fields (same as the usual X-ray upload panel) ─────

    function todayStr() {
        if (typeof todayISO === 'function') return todayISO();
        var d = new Date();
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    }

    function renderUploadForm(doc, host, file, cb) {
        var pi = patientInfo();
        var url = URL.createObjectURL(file);
        var defType = file.xhTypeGuess || 'Periapical';
        var opts = (typeof XRAY_TYPE_PAIRS !== 'undefined' ? XRAY_TYPE_PAIRS : [['Other', 'media.categoryOther']])
            .map(function (pair) {
                return '<option value="' + h(pair[0]) + '"' + (pair[0] === defType ? ' selected' : '') + '>' +
                    h(tr(pair[1])) + '</option>';
            }).join('');
        host.innerHTML =
            '<div class="xh-root xh-form">' +
                '<h3>' + h(tr('media.upload.xrayTitle')) + '</h3>' +
                '<div class="xh-to">' + h(tr('media.xcap.uploadTo')) + ' <b>' +
                    h(pi ? (pi.no + ' ' + pi.name).trim() : '—') + '</b></div>' +
                '<div class="xh-prev"><img alt="" src="' + url + '"><small data-xh="dim"></small></div>' +
                '<label class="xh-fg">' + h(tr('media.upload.xrayType')) +
                    '<select data-xh="type">' + opts + '</select>' +
                    (file.xhTypeGuess ? '<small class="xh-guess">' + h(tr('media.xcap.typeGuessed')) + '</small>' : '') +
                '</label>' +
                '<label class="xh-fg">' + h(tr('media.upload.dateTaken')) +
                    '<input type="date" data-xh="date" value="' + h(todayStr()) + '"></label>' +
                '<label class="xh-fg">' + h(tr('media.upload.notesFindings')) +
                    '<textarea rows="3" data-xh="notes" placeholder="' + h(tr('media.upload.notesPh')) + '"></textarea></label>' +
                '<div class="xh-row">' +
                    '<button type="button" class="xh-btn xh-btn--go" data-xh="upload">' + h(tr('media.upload.confirmBtn')) + '</button>' +
                '</div>' +
                '<div class="xh-row">' +
                    '<button type="button" class="xh-btn" data-xh="back">' + h(tr('media.xcap.backToCrop')) + '</button>' +
                    '<button type="button" class="xh-btn" data-xh="cancel">' + h(tr('media.xcap.cancel')) + '</button>' +
                '</div>' +
            '</div>';
        var img = host.querySelector('img');
        img.onload = function () {
            var dim = host.querySelector('[data-xh="dim"]');
            if (dim) dim.textContent = img.naturalWidth + ' × ' + img.naturalHeight + ' px · ' +
                (file.size / 1024 / 1024).toFixed(2) + ' MB · ' + (file.type === 'image/png' ? 'PNG' : 'JPEG') +
                (file.xhGrey ? ' · ' + tr('media.xcap.greyscale') : '');
        };
        host.querySelector('[data-xh="upload"]').focus();
        host.onclick = function (e) {
            var b = e.target.closest && e.target.closest('[data-xh]');
            if (!b || b.tagName !== 'BUTTON') return;
            var act = b.getAttribute('data-xh');
            if (act === 'upload') {
                cb.onUpload(host.querySelector('[data-xh="type"]').value || 'Other',
                    host.querySelector('[data-xh="date"]').value || todayStr(),
                    String(host.querySelector('[data-xh="notes"]').value || '').trim());
            } else if (act === 'back') cb.onBack();
            else if (act === 'cancel') cb.onCancel();
        };
        return function () { URL.revokeObjectURL(url); host.onclick = null; };
    }

    /** Refresh the X-ray list and open the just-uploaded capture in the lightbox. */
    function openUploadedInLightbox(name, onResult) {
        if (typeof loadXrayRecords !== 'function') { if (onResult) onResult(false); return; }
        Promise.resolve(loadXrayRecords()).then(function () {
            var found = false;
            if (typeof xrayFiltered !== 'undefined' && typeof openLightbox === 'function') {
                for (var i = 0; i < xrayFiltered.length; i++) {
                    if (xrayFiltered[i] && xrayFiltered[i].file_name === name) { openLightbox(i); found = true; break; }
                }
            }
            if (onResult) onResult(found);
        }, function () { if (onResult) onResult(false); });
        if (typeof loadConPatientTimeline === 'function' && typeof conPatientId !== 'undefined' && conPatientId) {
            try { loadConPatientTimeline(conPatientId); } catch (_) {}
        }
        if (window.__JOYFUL_RT_SYNC__ && typeof window.__JOYFUL_RT_SYNC__.nudge === 'function') {
            window.__JOYFUL_RT_SYNC__.nudge('xray');
        }
    }

    /** Hook from xrayFinishUploadQueue (in-page flow through the normal upload panel). */
    function xrayCaptureAfterUpload() {
        var name = helper.pendingName;
        helper.pendingName = null;
        if (!name) return;
        var pi = patientInfo();
        openUploadedInLightbox(name, function (found) {
            if (!helper.pip) return;
            if (found) setMsg(trRepl('media.xcap.saved', { NAME: pi ? (pi.no + ' ' + pi.name).trim() : '' }), 'ok');
            else setMsg('', '');
        });
    }

    // ── Floating helper (Document Picture-in-Picture) ────────────

    function pipDoc() { return helper.pip && helper.pip.document; }

    /** resizeTo on a PiP window needs (and consumes) a fresh user gesture; returns false when refused. */
    function pipResize(w, h2) {
        var pw = helper.pip;
        if (!pw || typeof pw.resizeTo !== 'function') return false;
        try { pw.resizeTo(Math.round(w), Math.round(h2)); return true; } catch (_) { return false; }
    }

    function shrinkToBar() {
        if (!helper.big) return true;
        if (pipResize(XH_BAR_W, XH_BAR_H)) { helper.big = false; return true; }
        return false;
    }

    function sharing() {
        var t = helper.stream && helper.stream.getVideoTracks()[0];
        return !!(t && t.readyState === 'live');
    }

    function setMsg(text, kind) {
        helper.msg = text || '';
        helper.msgKind = kind || '';
        if (helper.view === 'bar') renderBar();
    }

    function renderBar() {
        var doc = pipDoc();
        if (!doc) return;
        helper.view = 'bar';
        var pi = patientInfo();
        var on = sharing();
        var root = doc.getElementById('xhRoot');
        var status = helper.msg;
        var kind = status ? helper.msgKind : '';
        if (!status && !helperInHeaderZone()) { status = tr('media.xcap.dragToHeader'); kind = 'tip'; }
        if (!status) status = tr(on ? 'media.xcap.tipCapture' : 'media.xcap.tipShare');
        var who = pi ? (pi.no + ' ' + pi.name).trim() : '';
        root.innerHTML =
            '<div class="xh-root xh-bar">' +
                '<div class="xh-brand" title="Banana ' + h(tr('media.xcap.helperName')) + '">🍌</div>' +
                '<div class="xh-patient' + (pi ? '' : ' is-none') + '" title="' + h(who + (pi && pi.en ? ' ' + pi.en : '')) + '">' +
                    (pi ? h(tr('media.xcap.uploadTo')) + ' <b>' + h(who) + '</b>' : h(tr('media.xcap.noPatient'))) +
                '</div>' +
                '<button type="button" class="xh-btn xh-btn--go" data-xh="capture"' + (pi ? '' : ' disabled') +
                    ' title="' + h(tr('media.xcap.selectionTitle')) + '">' + h(tr('media.xcap.selectionBtn')) + '</button>' +
                '<button type="button" class="xh-btn xh-btn--auto" data-xh="auto"' + (pi ? '' : ' disabled') +
                    ' title="' + h(tr('media.xcap.autoTitle')) + '">' + h(tr('media.xcap.autoBtn')) + '</button>' +
                (hasSavedSel()
                    ? '<button type="button" class="xh-btn xh-btn--same" data-xh="same"' + (pi ? '' : ' disabled') +
                        ' title="' + h(tr('media.xcap.sameAreaTitle')) + '">' + h(tr('media.xcap.sameAreaBtn')) + '</button>'
                    : '') +
                '<div class="xh-status' + (kind ? ' ' + kind : '') + '" title="' + h(status) + '">' +
                    '<span class="xh-dot' + (on ? ' on' : '') + '" title="' +
                        h(tr(on ? 'media.xcap.sharingOn' : 'media.xcap.sharingOff')) + '"></span>' +
                    '<span>' + h(status) + '</span></div>' +
                (on ? '<button type="button" class="xh-btn" data-xh="stop">' + h(tr('media.xcap.stopShare')) + '</button>'
                    : '<button type="button" class="xh-btn" data-xh="share">' + h(tr('media.xcap.shareBtn')) + '</button>') +
                '<button type="button" class="xh-btn xh-btn--x" data-xh="close" title="' + h(tr('media.xcap.closeHelper')) +
                    '" aria-label="' + h(tr('media.xcap.closeHelper')) + '">✕</button>' +
            '</div>';
    }

    /** True once the user has parked the bar near the top of the screen (the imaging software's header). */
    function helperInHeaderZone() {
        var pw = helper.pip;
        if (!pw) return true;
        var top = typeof pw.screenY === 'number' ? pw.screenY : pw.screenTop;
        var availTop = (window.screen && typeof window.screen.availTop === 'number') ? window.screen.availTop : 0;
        if (typeof top !== 'number') return true;
        return (top - availTop) <= XH_HEADER_ZONE_PX;
    }

    function startSharing() {
        if (!displaySupported()) {
            setMsg(tr('media.xcap.unsupported'), 'err');
            return Promise.reject(new Error('unsupported'));
        }
        setMsg(tr('media.xcap.pickWindow'), 'tip');
        return requestDisplayStream().then(function (stream) {
            if (helper.stream && helper.stream !== stream) stopStream(helper.stream);
            helper.stream = stream;
            var track = stream.getVideoTracks()[0];
            if (track) track.addEventListener('ended', function () {
                if (helper.stream === stream) {
                    helper.stream = null;
                    if (helper.video && helper.video.parentNode) helper.video.parentNode.removeChild(helper.video);
                    helper.video = null;
                    setMsg('', '');
                }
            });
            var doc = pipDoc();
            return playVideoForStream(stream, doc || document).then(function (v) {
                helper.video = v;
                setMsg('', '');
                return stream;
            }, function () { setMsg('', ''); return stream; });
        }).catch(function (err) {
            if (err && err.name === 'WrongSurface') {
                setMsg(tr('media.xcap.wrongSurface'), 'err');
            } else if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
                setMsg(tr('media.xcap.shareCancelled'), 'err');
            } else if (err && err.message !== 'unsupported') {
                setMsg(trRepl('media.xcap.failed', { MSG: err.message || err.name || String(err) }), 'err');
            }
            throw err;
        });
    }

    function stopSharing() {
        stopStream(helper.stream);
        helper.stream = null;
        if (helper.video && helper.video.parentNode) helper.video.parentNode.removeChild(helper.video);
        helper.video = null;
        setMsg('', '');
    }

    function screenSize() {
        var s = window.screen || {};
        return { w: s.width || s.availWidth || 1600, h: s.height || s.availHeight || 900 };
    }

    /**
     * "Selection": freeze the shared screen, then grow the floating window to its largest size
     * (Chrome allows 80% of the display) and show the frozen frame dimmed for a one-drag snip.
     * The frame is grabbed before growing so the enlarged helper never appears in it.
     */
    function helperSelection(auto) {
        auto = auto === true;
        if (helper.busy) return;
        if (!hasPatient()) { setMsg(tr('media.xcap.noPatient'), 'err'); return; }
        if (!sharing()) {
            // The share picker uses up this click; the next Selection click does the snip.
            startSharing().then(function () { setMsg(tr('media.xcap.nowSelect'), 'tip'); }, function () {});
            return;
        }
        helper.busy = true;
        helper.lock = currentLock();
        setMsg(tr('media.xcap.grabbing'), '');
        grabFrame(helper.stream, helper.video).then(function (frame) {
            helper.busy = false;
            // Preferred: bring the Banana tab to the front (Chrome allows opener focus from a PiP click)
            // and snip there, so the bar never has to grow and Banana is already in front after saving.
            try { window.focus(); } catch (_) {}
            revealConsultation();
            var extra = { auto: auto, suggest: auto ? safeDetect(frame) : null };
            inpageOpenCropper(frame, { snip: true, fromHelper: true, lock: helper.lock, auto: extra.auto, suggest: extra.suggest });
            setMsg(tr('media.xcap.selectInBanana'), 'tip');
            setTimeout(function () {
                if (document.hasFocus() || !inpage.overlay || !inpage.fromHelper) return;
                // Focus refused (older browser): that leaves the click unused, so snip inside the bar instead.
                inpageClose();
                var sc = screenSize();
                if (pipResize(sc.w * 0.8, sc.h * 0.8)) helper.big = true;
                showCropper(frame, extra);
            }, 500);
        }).catch(function (err) {
            helper.busy = false;
            setMsg(trRepl('media.xcap.failed', { MSG: (err && (err.message || err.name)) || String(err) }), 'err');
        });
    }

    // Same area is per desktop (each clinic's X-ray software sits in a different place), so it lives
    // in this browser's localStorage, keyed by shared-screen size for PCs that switch monitor layouts.
    var XH_SAME_AREA_KEY = 'banana.xrayHelper.sameArea.v1';
    var XH_SAME_AREA_MAX = 6;

    function loadSameAreas() {
        try {
            var o = JSON.parse(localStorage.getItem(XH_SAME_AREA_KEY) || '{}');
            return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
        } catch (_) { return {}; }
    }

    function validSel(s) {
        return !!s && [s.x, s.y, s.w, s.h, s.fw, s.fh].every(function (n) { return typeof n === 'number' && isFinite(n) && n >= 0; }) &&
            s.w > 0 && s.h > 0 && s.x + s.w <= s.fw && s.y + s.h <= s.fh;
    }

    function savedSelFor(fw, fh) {
        var s = loadSameAreas()[fw + 'x' + fh];
        return validSel(s) ? s : null;
    }

    function hasSavedSel() {
        if (helper.lastSel) return true;
        var all = loadSameAreas();
        return Object.keys(all).some(function (k) { return validSel(all[k]); });
    }

    function rememberSel(file) {
        var s = file && file.xhSel;
        if (!validSel(s)) return;
        helper.lastSel = s;
        try {
            var all = loadSameAreas();
            delete all[s.fw + 'x' + s.fh];
            all[s.fw + 'x' + s.fh] = { x: s.x, y: s.y, w: s.w, h: s.h, fw: s.fw, fh: s.fh, at: Date.now() };
            var keys = Object.keys(all).sort(function (a, b) { return (all[b].at || 0) - (all[a].at || 0); });
            keys.slice(XH_SAME_AREA_MAX).forEach(function (k) { delete all[k]; });
            localStorage.setItem(XH_SAME_AREA_KEY, JSON.stringify(all));
        } catch (_) {}
    }

    /** Opens the usual Banana upload panel for a capture (Banana must already be in front). */
    function uploadInBanana(file) {
        revealConsultation();
        helper.pendingName = file.name;
        setMsg(tr('media.xcap.continueInBanana'), 'tip');
        if (typeof xrayStartQueuedUpload === 'function') xrayStartQueuedUpload([file]);
    }

    /**
     * "Same area": re-crop last time's rectangle from a fresh frame — imaging software shows each new
     * film in the same place, so no dragging is needed.
     */
    function helperSameArea() {
        if (helper.busy || !hasSavedSel()) return;
        if (!hasPatient()) { setMsg(tr('media.xcap.noPatient'), 'err'); return; }
        if (!sharing()) {
            startSharing().then(function () { setMsg(tr('media.xcap.nowSelect'), 'tip'); }, function () {});
            return;
        }
        helper.busy = true;
        var lock = currentLock();
        setMsg(tr('media.xcap.grabbing'), '');
        grabFrame(helper.stream, helper.video).then(function (frame) {
            var last = helper.lastSel;
            var sel = last && last.fw === frame.width && last.fh === frame.height
                ? last : savedSelFor(frame.width, frame.height);
            if (!sel) {
                helper.busy = false;
                setMsg(tr('media.xcap.sameAreaChanged'), 'err');
                return null;
            }
            // Focus before the slow encode, while the click's permission is still fresh.
            try { window.focus(); } catch (_) {}
            revealConsultation();
            return makeCaptureFile(frame, sel).then(function (file) {
                helper.busy = false;
                stampLock(file, lock);
                uploadInBanana(file);
            });
        }).catch(function (err) {
            helper.busy = false;
            setMsg(trRepl('media.xcap.failed', { MSG: (err && (err.message || err.name)) || String(err) }), 'err');
        });
    }

    /** The upload panel and lightbox live inside the Consultation section and are invisible elsewhere. */
    function revealConsultation() {
        var sec = document.getElementById('consultationSection');
        if (sec && sec.offsetParent === null && typeof showOnly === 'function') {
            try { showOnly('consultationSection'); } catch (_) {}
        }
    }

    function backToBar(msg, kind) {
        if (helper.cropper) { helper.cropper.destroy(); helper.cropper = null; }
        if (helper.formCleanup) { helper.formCleanup(); helper.formCleanup = null; }
        shrinkToBar();
        helper.msg = msg || '';
        helper.msgKind = kind || '';
        renderBar();
    }

    function showCropper(frame, extra) {
        extra = extra || {};
        var doc = pipDoc();
        if (!doc) return;
        helper.view = 'crop';
        helper.lastFrame = frame;
        var root = doc.getElementById('xhRoot');
        helper.cropper = createCropper(doc, helper.pip, root, frame, {
            onConfirm: function (file) {
                helper.cropper.destroy();
                helper.cropper = null;
                stampLock(file, helper.lock);
                rememberSel(file);
                showForm(file);
            },
            onCancel: function () { backToBar('', ''); },
            onRetake: function () { backToBar('', ''); }
        }, { snip: true, auto: !!extra.auto, suggest: extra.suggest });
        try { helper.pip.focus(); } catch (_) {}
    }

    function showForm(file) {
        var doc = pipDoc();
        if (!doc) return;
        helper.view = 'form';
        // Still inside the snip's mouse gesture, so the window can usually shrink to form size.
        if (helper.big) pipResize(560, 720);
        var root = doc.getElementById('xhRoot');
        helper.formCleanup = renderUploadForm(doc, root, file, {
            onUpload: function (type, date, notes) { helperUpload(file, type, date, notes); },
            onBack: function () {
                if (helper.formCleanup) { helper.formCleanup(); helper.formCleanup = null; }
                showCropper(helper.lastFrame);
            },
            onCancel: function () { backToBar('', ''); }
        });
    }

    function helperUpload(file, type, date, notes) {
        var lock = xrayCaptureLockCheck(file);
        if (!lock.ok) {
            backToBar(tr('media.xcap.patientChangedShort'), 'err');
            alert(trRepl('media.xcap.patientChanged', { CAPTURED: lock.captured || '—', CURRENT: lock.current || '—' }));
            return;
        }
        var target = typeof xrayResolveUploadPatient === 'function' ? xrayResolveUploadPatient() : null;
        if (!target || !target.ok || !target.id) {
            // Chart choice / linking prompts live in the Banana window: continue there.
            helper.pendingName = file.name;
            backToBar(tr('media.xcap.continueInBanana'), 'err');
            if (typeof xrayStartQueuedUpload === 'function') xrayStartQueuedUpload([file]);
            return;
        }
        backToBar(tr('media.upload.uploadingStorage'), '');
        uploadSingleXrayFile(file, type, date, notes, function () {
            setMsg(trRepl('media.xcap.saved', { NAME: (target.patient_no ? '#' + target.patient_no + ' ' : '') +
                (target.full_name || '') }), 'ok');
            if (typeof xrayRevealWriteClinic === 'function') { try { xrayRevealWriteClinic(target); } catch (_) {} }
            openUploadedInLightbox(file.name);
        }, function (title) {
            setMsg(trRepl('media.xcap.failed', { MSG: title || '' }), 'err');
        });
    }

    function onPipClick(e) {
        if (helper.view !== 'bar') return;
        var b = e.target.closest && e.target.closest('[data-xh]');
        var act = b && !b.disabled ? b.getAttribute('data-xh') : '';
        // After an Esc (no gesture) the window may still be large: the next click on the bar shrinks it.
        if (helper.big && act !== 'capture' && act !== 'auto') {
            shrinkToBar();
            if (!act) return;
        }
        if (act === 'capture') helperSelection();
        else if (act === 'auto') helperSelection(true);
        else if (act === 'same') helperSameArea();
        else if (act === 'share') startSharing().catch(function () {});
        else if (act === 'stop') stopSharing();
        else if (act === 'close') closeHelper();
    }

    function closeHelper() {
        var pw = helper.pip;
        // Leave the window at bar size so Chrome reopens it as a bar in the same (header) spot.
        shrinkToBar();
        cleanupHelper();
        if (pw) { try { pw.close(); } catch (_) {} }
    }

    function cleanupHelper() {
        if (helper.cropper) { try { helper.cropper.destroy(); } catch (_) {} helper.cropper = null; }
        if (helper.formCleanup) { try { helper.formCleanup(); } catch (_) {} helper.formCleanup = null; }
        stopStream(helper.stream);
        helper.stream = null;
        helper.video = null;
        helper.pip = null;
        helper.big = false;
        helper.view = 'bar';
        helper.msg = '';
        helper.busy = false;
        clearInterval(helper.timer);
        helper.timer = null;
        syncLaunchButton();
    }

    function openHelper() {
        if (helper.pip) {
            try { helper.pip.focus(); } catch (_) {}
            return;
        }
        window.documentPictureInPicture.requestWindow({ width: XH_BAR_W, height: XH_BAR_H })
            .then(function (pw) {
                helper.pip = pw;
                var doc = pw.document;
                doc.title = '🍌 ' + tr('media.xcap.helperName');
                ensureCss(doc);
                doc.body.className = 'xh-pip';
                doc.body.innerHTML = '<div id="xhRoot" style="height:100vh"></div>';
                doc.addEventListener('click', onPipClick);
                pw.addEventListener('pagehide', cleanupHelper);
                // Chrome may restore a larger remembered size; the opener's click usually still allows a resize.
                helper.big = true;
                shrinkToBar();
                renderBar();
                syncLaunchButton();
                var lastKey = '';
                helper.timer = setInterval(function () {
                    if (helper.view !== 'bar') return;
                    var pi = patientInfo();
                    var key = (pi ? pi.no + pi.name : '') + '|' + sharing() + '|' + helperInHeaderZone();
                    if (key !== lastKey) { lastKey = key; renderBar(); }
                }, 1000);
                // Start sharing straight away when the browser still allows it; otherwise the bar offers the button.
                startSharing().catch(function (err) {
                    if (!err || err.name !== 'WrongSurface') setMsg('', '');
                });
            })
            .catch(function (err) {
                alert(trRepl('media.xcap.failed', { MSG: (err && (err.message || err.name)) || String(err) }));
            });
    }

    function syncLaunchButton() {
        var b = document.getElementById('btnXrayHelper');
        if (!b) return;
        b.classList.toggle('is-on', !!helper.pip);
        b.setAttribute('aria-pressed', helper.pip ? 'true' : 'false');
    }

    // ── In-page one-shot (browsers without Document PiP) ─────────

    function inpageClose() {
        if (inpage.cropper) { inpage.cropper.destroy(); inpage.cropper = null; }
        if (inpage.overlay && inpage.overlay.parentNode) inpage.overlay.parentNode.removeChild(inpage.overlay);
        inpage.overlay = null;
        inpage.fromHelper = false;
        document.documentElement.classList.remove('xh-overlay-open');
    }

    function inpageOpenCropper(frame, opts) {
        opts = opts || {};
        ensureCss(document);
        inpageClose();
        var ov = document.createElement('div');
        ov.className = 'xh-overlay';
        ov.setAttribute('role', 'dialog');
        ov.setAttribute('aria-modal', 'true');
        document.body.appendChild(ov);
        document.documentElement.classList.add('xh-overlay-open');
        inpage.overlay = ov;
        inpage.fromHelper = !!opts.fromHelper;
        var fromHelper = inpage.fromHelper;
        var lock = opts.lock || currentLock();
        inpage.cropper = createCropper(document, window, ov, frame, {
            onConfirm: function (file) {
                inpageClose();
                stampLock(file, lock);
                if (fromHelper) {
                    rememberSel(file);
                    uploadInBanana(file);
                    return;
                }
                helper.pendingName = file.name;
                if (typeof xrayStartQueuedUpload === 'function') xrayStartQueuedUpload([file]);
            },
            onCancel: function () {
                inpageClose();
                if (fromHelper) setMsg('', '');
            },
            onRetake: function () { inpageClose(); inpageCaptureOnce(); }
        }, { snip: !!opts.snip, auto: !!opts.auto, suggest: opts.suggest });
        return inpage.cropper;
    }

    function inpageCaptureOnce() {
        if (inpage.busy) return;
        if (!hasPatient()) { alert(tr('con.forms.alertSelectPatient')); return; }
        if (!displaySupported()) { alert(tr('media.xcap.unsupported')); return; }
        inpage.busy = true;
        var stream = null;
        requestDisplayStream().then(function (s) {
            stream = s;
            return playVideoForStream(s, document);
        }).then(function (video) {
            return waitMs(350).then(function () { return grabFrame(stream, video); }).then(function (frame) {
                if (video.parentNode) video.parentNode.removeChild(video);
                return frame;
            });
        }).then(function (frame) {
            stopStream(stream);
            inpage.busy = false;
            inpageOpenCropper(frame);
        }).catch(function (err) {
            stopStream(stream);
            inpage.busy = false;
            if (err && err.name === 'WrongSurface') { alert(tr('media.xcap.wrongSurfaceLong')); return; }
            if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) return;
            alert(trRepl('media.xcap.failed', { MSG: (err && (err.message || err.name)) || String(err) }));
        });
    }

    /** X-ray tab button: floating helper when available, else one-shot capture in the page. */
    function xrayHelperLaunch() {
        if (!hasPatient()) { alert(tr('con.forms.alertSelectPatient')); return; }
        // Screen capture and the floating window only exist on https:// or http://localhost / 127.0.0.1.
        if (window.isSecureContext === false) {
            alert(trRepl('media.xcap.insecure', { URL: location.origin }));
            return;
        }
        if (pipSupported()) {
            if (helper.pip) closeHelper();
            else openHelper();
            return;
        }
        inpageCaptureOnce();
    }

    // ── Paste fallback: Win+Shift+S snip, then Ctrl+V on the X-ray tab ──

    function xrayTabVisible() {
        var main = document.getElementById('xrayMainContent');
        return !!(main && main.offsetParent !== null);
    }

    function isTypingTarget(el) {
        if (!el) return false;
        var tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || !!el.isContentEditable;
    }

    function openCropperFromBlob(blob) {
        return createImageBitmap(blob).then(function (bmp) {
            var c = bitmapToCanvas(bmp, bmp.width, bmp.height);
            if (bmp.close) bmp.close();
            inpageOpenCropper(c).selectWhole();
        });
    }

    document.addEventListener('paste', function (e) {
        if (inpage.overlay || !xrayTabVisible() || isTypingTarget(e.target)) return;
        var lb = document.getElementById('xrayLightbox');
        if (lb && lb.style.display === 'block') return;
        var items = (e.clipboardData && e.clipboardData.items) || [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].kind !== 'file' || !/^image\//.test(items[i].type)) continue;
            var blob = items[i].getAsFile();
            if (!blob) continue;
            e.preventDefault();
            if (!hasPatient()) { alert(tr('con.forms.alertSelectPatient')); return; }
            openCropperFromBlob(blob).catch(function (err) {
                alert(trRepl('media.xcap.failed', { MSG: err && err.message ? err.message : String(err) }));
            });
            return;
        }
    });

    /** 📖 How to use opens the manual at the section for the language picked on the dashboard. */
    function syncGuideLink() {
        var a = document.getElementById('btnXrayHelperGuide');
        if (!a) return;
        var lang = typeof getAppLang === 'function' ? String(getAppLang() || 'en') : 'en';
        if (lang !== 'zh-Hant' && lang !== 'zh-CN') lang = lang.indexOf('zh') === 0 ? 'zh-Hant' : 'en';
        a.href = a.getAttribute('href').split('#')[0] + '#lang-' + lang;
    }

    window.addEventListener('app-lang-change', function () {
        if (helper.pip && helper.view === 'bar') renderBar();
        syncGuideLink();
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncGuideLink);
    else syncGuideLink();
    document.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('#btnXrayHelperGuide')) syncGuideLink();
    }, true);

    window.xrayHelperLaunch = xrayHelperLaunch;
    window.xrayCaptureAfterUpload = xrayCaptureAfterUpload;
    window.xrayCaptureLockCheck = xrayCaptureLockCheck;
    window.__XRAY_HELPER__ = {
        helper: helper,
        inpage: inpage,
        pipSupported: pipSupported,
        createCropper: createCropper,
        renderUploadForm: renderUploadForm,
        cropToCanvas: cropToCanvas,
        encodeBest: encodeBest,
        greyPlane: greyPlane,
        encodeGreyPng: encodeGreyPng,
        makeCaptureFile: makeCaptureFile,
        inpageOpenCropper: inpageOpenCropper,
        inpageClose: inpageClose,
        openCropperFromBlob: openCropperFromBlob,
        openHelper: openHelper,
        closeHelper: closeHelper,
        renderBar: renderBar,
        helperSelection: helperSelection,
        helperSameArea: helperSameArea,
        guessXrayType: guessXrayType,
        detectXrayAreas: detectXrayAreas,
        ensureCss: ensureCss,
        onPipClick: onPipClick,
        helperInHeaderZone: helperInHeaderZone,
        showCropper: showCropper,
        showForm: showForm,
        helperUpload: helperUpload,
        grabFrame: grabFrame,
        startSharing: startSharing,
        sharedBrowserTab: sharedBrowserTab
    };
})();
