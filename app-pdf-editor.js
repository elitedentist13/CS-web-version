// ════════════════════════════════════════════════════════════════
// app-pdf-editor.js — Professional PDF Editor (PDFEDITOR)
//   Acrobat-style: thumbnails, zoom, ribbon tools, properties panel.
//   pdf.js (render) + pdf-lib (export). Client-side only.
// ════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var CDN_PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
    var CDN_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    var CDN_PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
    var LS_SIG_KEY = 'joyful_pdf_editor_sig_v1';
    var LS_SIG_TYPE_STYLE = 'joyful_pdf_editor_sig_type_style_v1';
    var LS_PRINT_KEY = 'joyful_pdf_editor_print_settings_v1';
    var PRINTERS_LS_KEY = 'jsm_known_printers_v1';
    var PDE_PRINT_TO_PDF_NAMES = ['Microsoft Print to PDF', 'Save as PDF', 'Print to PDF'];
    var _pdeCachedSystemPrinters = [];
    var _pdePrinterPreloadPromise = null;

    function sigTypeFontOptions() {
        return [
            { id: 'normal', label: t('Normal (upright)', '正常（直体）', '正常（直體）'), font: '500 44px system-ui, -apple-system, "Segoe UI", sans-serif' },
            { id: 'italic', label: t('Italic', '斜体', '斜體'), font: 'italic 500 44px Georgia, "Times New Roman", serif' },
            { id: 'bold', label: t('Bold formal', '粗体正式', '粗體正式'), font: '700 42px Georgia, "Times New Roman", serif' },
            { id: 'script_dancing', label: t('Script — linked stroke', '连笔花体', '連筆花體'), font: '700 52px "Dancing Script", "Segoe Script", cursive' },
            { id: 'script_great', label: t('Elegant script', '优雅花体', '優雅花體'), font: '400 56px "Great Vibes", "Snell Roundhand", cursive' },
            { id: 'script_allura', label: t('Classic script', '经典花体', '經典花體'), font: '400 54px "Allura", "Brush Script MT", cursive' },
            { id: 'script_sacramento', label: t('Light script', '纤细连笔', '纖細連筆'), font: '400 52px "Sacramento", "Segoe Script", cursive' },
            { id: 'system_script', label: t('System handwriting', '系统手写体', '系統手寫體'), font: '400 48px "Segoe Script", "Brush Script MT", "Apple Chancery", cursive' },
            { id: 'hand', label: t('Casual handwriting', '随意手写', '隨意手寫'), font: '400 44px "Bradley Hand", "Comic Sans MS", cursive' },
            { id: 'formal_serif', label: t('Formal serif', '正式衬线', '正式襯線'), font: '600 40px "Times New Roman", Times, serif' },
            { id: 'modern', label: t('Modern thin', '现代细体', '現代細體'), font: '300 46px Helvetica, Arial, sans-serif' }
        ];
    }

    function sigTypeFontCss(styleId) {
        var opts = sigTypeFontOptions();
        for (var i = 0; i < opts.length; i++) {
            if (opts[i].id === styleId) return opts[i].font;
        }
        return opts[0].font;
    }

    function ensureSigTypeFonts() {
        if (document.getElementById('pde_sig_gf_link')) return Promise.resolve();
        return new Promise(function (resolve) {
            var link = document.createElement('link');
            link.id = 'pde_sig_gf_link';
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Allura&family=Dancing+Script:wght@400;700&family=Great+Vibes&family=Sacramento&display=swap';
            link.onload = function () { setTimeout(resolve, 150); };
            link.onerror = function () { resolve(); };
            document.head.appendChild(link);
        });
    }

    function buildSigTypeStyleOptions(selectedId) {
        var html = '';
        sigTypeFontOptions().forEach(function (opt) {
            html += '<option value="' + esc(opt.id) + '"' +
                (opt.id === selectedId ? ' selected' : '') + '>' + esc(opt.label) + '</option>';
        });
        return html;
    }

    var _loaded = {};
    function loadScript(url) {
        if (_loaded[url]) return _loaded[url];
        _loaded[url] = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = url; s.async = true;
            s.onload = function () { resolve(); };
            s.onerror = function () { _loaded[url] = null; reject(new Error('load failed')); };
            document.head.appendChild(s);
        });
        return _loaded[url];
    }
    function ensurePdfJs() {
        if (window.pdfjsLib) {
            if (window.pdfjsLib.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN_WORKER;
            }
            return Promise.resolve(window.pdfjsLib);
        }
        return loadScript(CDN_PDFJS).then(function () {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN_WORKER;
            return window.pdfjsLib;
        });
    }
    function ensurePdfLib() {
        if (window.PDFLib) return Promise.resolve(window.PDFLib);
        return loadScript(CDN_PDFLIB).then(function () { return window.PDFLib; });
    }

    function lang() { return (typeof getAppLang === 'function') ? getAppLang() : 'en'; }
    function t(en, cn, ht) {
        var l = lang();
        if (l === 'zh-CN') return cn != null ? cn : en;
        if (l === 'zh-Hant') return ht != null ? ht : (cn != null ? cn : en);
        return en;
    }
    function gg(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }
    function dl(blob, name) {
        var u = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = u; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
    }

    // ── document state ───────────────────────────────────────────
    var pdfJsDoc = null;
    var pdfBytes = null;
    var fileName = 'document.pdf';
    var pageNum = 0;
    var pageCount = 0;
    /** @type {Object<number,{w:number,h:number}>} */
    var pageDims = {};
    var thumbUrls = [];

    var annByPage = {};
    var undoStack = [];
    var redoStack = [];
    var clipAnn = null;

    var tool = 'select';
    var zoomMode = 'fitWidth';
    var zoomCustom = 1;
    var baseScale = 1;
    var viewportScale = 1;

    var placeMode = null;
    var pendingImageUrl = null;
    var pendingImageAspect = 1;
    var pendingSigUrl = null;

    var props = {
        color: '#111827',
        width: 3,
        opacity: 1,
        fontSize: 16,
        fontFamily: 'sans-serif',
        fill: false,
        stampText: 'APPROVED'
    };

    var selectedIdx = -1;
    var dragState = null;
    var currentStroke = null;
    var shapePreview = null;
    var panDrag = null;
    var textEditorEl = null;

    var bgCanvas = null;
    var olCanvas = null;
    var olCtx = null;
    var viewportEl = null;
    var stageEl = null;

    function pushUndo() {
        undoStack.push(JSON.stringify(annByPage));
        if (undoStack.length > 60) undoStack.shift();
        redoStack = [];
        syncHistoryButtons();
        refreshPropsPanel();
    }
    function undo() {
        if (!undoStack.length) return;
        redoStack.push(JSON.stringify(annByPage));
        annByPage = JSON.parse(undoStack.pop());
        selectedIdx = -1;
        syncHistoryButtons();
        redrawOverlay();
        refreshPropsPanel();
        refreshThumbsActive();
    }
    function redo() {
        if (!redoStack.length) return;
        undoStack.push(JSON.stringify(annByPage));
        annByPage = JSON.parse(redoStack.pop());
        selectedIdx = -1;
        syncHistoryButtons();
        redrawOverlay();
        refreshPropsPanel();
    }
    function syncHistoryButtons() {
        var u = gg('pde_undo'); var r = gg('pde_redo');
        if (u) u.disabled = !undoStack.length;
        if (r) r.disabled = !redoStack.length;
    }

    function pageAnns() {
        if (!annByPage[pageNum]) annByPage[pageNum] = [];
        return annByPage[pageNum];
    }
    function pageDim() {
        return pageDims[pageNum] || { w: 595, h: 842 };
    }

    function canvasToNorm(cx, cy) {
        var w = olCanvas ? olCanvas.width : 1;
        var h = olCanvas ? olCanvas.height : 1;
        return { x: cx / w, y: cy / h };
    }
    function normToCanvas(nx, ny) {
        var w = olCanvas ? olCanvas.width : 1;
        var h = olCanvas ? olCanvas.height : 1;
        return { x: nx * w, y: ny * h };
    }
    function normToPdfPt(nx, ny, dim) {
        dim = dim || pageDim();
        return { x: nx * dim.w, y: dim.h - ny * dim.h };
    }

    function hexRgb(PDFLib, hex, opacity) {
        hex = String(hex || '#000').replace('#', '');
        if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        var r = parseInt(hex.slice(0, 2), 16) / 255;
        var g = parseInt(hex.slice(2, 4), 16) / 255;
        var b = parseInt(hex.slice(4, 6), 16) / 255;
        if (opacity != null && opacity < 1) return PDFLib.rgb(r, g, b);
        return PDFLib.rgb(r, g, b);
    }
    function parseColorAlpha(hex, fallbackOpacity) {
        hex = String(hex || '#000000');
        var op = fallbackOpacity != null ? fallbackOpacity : 1;
        if (hex.length === 9 && hex.charAt(0) === '#') {
            op = parseInt(hex.slice(7, 9), 16) / 255;
            hex = hex.slice(0, 7);
        }
        return { hex: hex, opacity: op };
    }
    function dataUrlToBytes(dataUrl) {
        var parts = String(dataUrl).split(',');
        var bin = atob(parts[1] || '');
        var out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function setStatus(msg, tone) {
        var el = gg('pde_status');
        if (!el) return;
        el.textContent = msg || '';
        el.className = 'pde-statusbar' + (tone ? ' pde-status-' + tone : '');
    }

    function effectiveZoom() {
        if (zoomMode === 'custom') return zoomCustom;
        return 1;
    }

    function computeBaseScale(pageWidthPt) {
        if (!viewportEl) return 1;
        var pad = 48;
        var vw = viewportEl.clientWidth - pad;
        var vh = viewportEl.clientHeight - pad;
        if (zoomMode === 'fitPage') {
            return Math.min(vw / pageWidthPt, vh / (pageDim().h || 842));
        }
        return vw / pageWidthPt;
    }

    function updateZoomLabel() {
        var el = gg('pde_zoom_label');
        if (!el) return;
        var pct = Math.round(viewportScale * 100);
        el.textContent = pct + '%';
    }

    // ── render ───────────────────────────────────────────────────
    function renderPage() {
        if (!pdfJsDoc || !bgCanvas || !olCanvas) return Promise.resolve();
        return pdfJsDoc.getPage(pageNum + 1).then(function (page) {
            var vp1 = page.getViewport({ scale: 1 });
            pageDims[pageNum] = { w: vp1.width, h: vp1.height };
            baseScale = computeBaseScale(vp1.width);
            viewportScale = baseScale * effectiveZoom();
            var vp = page.getViewport({ scale: viewportScale });
            bgCanvas.width = olCanvas.width = vp.width;
            bgCanvas.height = olCanvas.height = vp.height;
            if (stageEl) {
                stageEl.style.width = vp.width + 'px';
                stageEl.style.height = vp.height + 'px';
            }
            olCtx = olCanvas.getContext('2d');
            var ctx = bgCanvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, vp.width, vp.height);
            return page.render({ canvasContext: ctx, viewport: vp }).promise;
        }).then(function () {
            redrawOverlay();
            updatePageLabel();
            updateZoomLabel();
            refreshThumbsActive();
            closeTextEditor();
        });
    }

    function redrawOverlay() {
        if (!olCtx || !olCanvas) return;
        olCtx.clearRect(0, 0, olCanvas.width, olCanvas.height);
        pageAnns().forEach(function (ann, i) { drawAnn(ann, i === selectedIdx); });
        if (currentStroke) drawStrokePath(currentStroke, false);
        if (shapePreview) drawShapeAnn(shapePreview, false, true);
    }

    function strokeStyle(ctx, ann, sel) {
        var ca = parseColorAlpha(ann.color, ann.opacity);
        ctx.strokeStyle = ca.hex;
        ctx.globalAlpha = ca.opacity;
        ctx.lineWidth = ann.width || 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (sel) {
            ctx.shadowColor = '#1473e6';
            ctx.shadowBlur = 8;
        }
    }

    function drawStrokePath(st, sel) {
        if (!st.points || st.points.length < 2) return;
        olCtx.save();
        strokeStyle(olCtx, st, sel);
        olCtx.beginPath();
        var p0 = normToCanvas(st.points[0][0], st.points[0][1]);
        olCtx.moveTo(p0.x, p0.y);
        for (var i = 1; i < st.points.length; i++) {
            var p = normToCanvas(st.points[i][0], st.points[i][1]);
            olCtx.lineTo(p.x, p.y);
        }
        olCtx.stroke();
        olCtx.restore();
    }

    function drawShapeAnn(ann, sel, preview) {
        var ca = parseColorAlpha(ann.color, ann.opacity);
        var tl = normToCanvas(ann.x, ann.y);
        var w = ann.w * olCanvas.width;
        var h = ann.h * olCanvas.height;
        olCtx.save();
        olCtx.globalAlpha = ca.opacity;
        if (ann.fill && ann.type === 'rect') {
            olCtx.fillStyle = ca.hex;
            olCtx.fillRect(tl.x, tl.y, w, h);
        }
        olCtx.strokeStyle = preview ? '#1473e6' : ca.hex;
        olCtx.lineWidth = ann.width || 2;
        olCtx.setLineDash(preview ? [6, 4] : []);
        if (ann.type === 'rect') {
            olCtx.strokeRect(tl.x, tl.y, w, h);
        } else if (ann.type === 'ellipse') {
            olCtx.beginPath();
            olCtx.ellipse(tl.x + w / 2, tl.y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
            if (ann.fill) { olCtx.fillStyle = ca.hex; olCtx.fill(); }
            olCtx.stroke();
        } else if (ann.type === 'line' || ann.type === 'arrow') {
            var br = normToCanvas(ann.x + ann.w, ann.y + ann.h);
            olCtx.beginPath();
            olCtx.moveTo(tl.x, tl.y);
            olCtx.lineTo(br.x, br.y);
            olCtx.stroke();
            if (ann.type === 'arrow') {
                var ang = Math.atan2(br.y - tl.y, br.x - tl.x);
                var sz = 10 + (ann.width || 2);
                olCtx.beginPath();
                olCtx.moveTo(br.x, br.y);
                olCtx.lineTo(br.x - sz * Math.cos(ang - 0.4), br.y - sz * Math.sin(ang - 0.4));
                olCtx.moveTo(br.x, br.y);
                olCtx.lineTo(br.x - sz * Math.cos(ang + 0.4), br.y - sz * Math.sin(ang + 0.4));
                olCtx.stroke();
            }
        }
        if (sel && !preview) drawSelectionHandles(tl.x, tl.y, w, h);
        olCtx.restore();
    }

    function drawSelectionHandles(x, y, w, h) {
        olCtx.save();
        olCtx.strokeStyle = '#1473e6';
        olCtx.lineWidth = 1.5;
        olCtx.setLineDash([5, 3]);
        olCtx.strokeRect(x, y, w, h);
        olCtx.setLineDash([]);
        olCtx.fillStyle = '#fff';
        [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].forEach(function (c) {
            olCtx.fillRect(c[0] - 4, c[1] - 4, 8, 8);
            olCtx.strokeRect(c[0] - 4, c[1] - 4, 8, 8);
        });
        olCtx.restore();
    }

    function drawAnn(ann, sel) {
        if (ann.type === 'draw' || ann.type === 'highlight') {
            drawStrokePath(ann, sel);
            return;
        }
        if (ann.type === 'text') {
            var tp = normToCanvas(ann.x, ann.y);
            olCtx.save();
            var fs = Math.round((ann.size || 16) * viewportScale);
            olCtx.font = (ann.bold ? '700 ' : '400 ') + fs + 'px ' + (ann.fontFamily || 'sans-serif');
            olCtx.fillStyle = ann.color || '#111';
            olCtx.globalAlpha = ann.opacity != null ? ann.opacity : 1;
            var lines = String(ann.text || '').split('\n');
            var lh = fs * 1.25;
            lines.forEach(function (line, li) {
                olCtx.fillText(line, tp.x, tp.y + li * lh);
            });
            if (sel) {
                var mw = 0;
                lines.forEach(function (line) {
                    mw = Math.max(mw, olCtx.measureText(line).width);
                });
                olCtx.strokeStyle = '#1473e6';
                olCtx.lineWidth = 2;
                olCtx.strokeRect(tp.x - 2, tp.y - fs, mw + 4, lh * lines.length + 4);
            }
            olCtx.restore();
            return;
        }
        if (ann.type === 'stamp') {
            var st = normToCanvas(ann.x, ann.y);
            var sw = ann.w * olCanvas.width;
            var sh = ann.h * olCanvas.height;
            olCtx.save();
            olCtx.strokeStyle = ann.color || '#dc2626';
            olCtx.lineWidth = 3;
            olCtx.globalAlpha = 0.85;
            olCtx.strokeRect(st.x, st.y, sw, sh);
            olCtx.font = '700 ' + Math.round(Math.min(sw, sh) * 0.22) + 'px sans-serif';
            olCtx.fillStyle = ann.color || '#dc2626';
            olCtx.textAlign = 'center';
            olCtx.textBaseline = 'middle';
            olCtx.fillText(ann.text || 'APPROVED', st.x + sw / 2, st.y + sh / 2);
            if (sel) drawSelectionHandles(st.x, st.y, sw, sh);
            olCtx.restore();
            return;
        }
        if (ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'line' || ann.type === 'arrow') {
            drawShapeAnn(ann, sel, false);
            return;
        }
        if (ann.type === 'image' || ann.type === 'signature') {
            if (!ann._img) {
                ann._img = new Image();
                ann._img.src = ann.dataUrl;
                ann._img.onload = function () { redrawOverlay(); };
            }
            if (!ann._img.complete) return;
            var r = normToCanvas(ann.x, ann.y);
            var rw = ann.w * olCanvas.width;
            var rh = ann.h * olCanvas.height;
            olCtx.save();
            olCtx.globalAlpha = ann.opacity != null ? ann.opacity : 1;
            olCtx.drawImage(ann._img, r.x, r.y, rw, rh);
            if (sel) drawSelectionHandles(r.x, r.y, rw, rh);
            olCtx.restore();
        }
    }

    function annBounds(ann) {
        if (ann.type === 'draw' || ann.type === 'highlight') {
            if (!ann.points || !ann.points.length) return null;
            var minX = 1, minY = 1, maxX = 0, maxY = 0;
            ann.points.forEach(function (p) {
                minX = Math.min(minX, p[0]); minY = Math.min(minY, p[1]);
                maxX = Math.max(maxX, p[0]); maxY = Math.max(maxY, p[1]);
            });
            return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }
        if (ann.type === 'line' || ann.type === 'arrow') {
            return {
                x: Math.min(ann.x, ann.x + ann.w),
                y: Math.min(ann.y, ann.y + ann.h),
                w: Math.abs(ann.w),
                h: Math.abs(ann.h)
            };
        }
        if (ann.type === 'text') {
            var fs = (ann.size || 16) / (pageDim().h || 842);
            var lines = String(ann.text || '').split('\n').length;
            return { x: ann.x, y: ann.y - fs * 1.1, w: 0.25, h: fs * 1.25 * lines };
        }
        return { x: ann.x, y: ann.y, w: ann.w || 0.1, h: ann.h || 0.05 };
    }

    function hitTest(nx, ny) {
        var list = pageAnns();
        for (var i = list.length - 1; i >= 0; i--) {
            var ann = list[i];
            if (ann.type === 'draw' || ann.type === 'highlight') {
                if (!ann.points) continue;
                for (var j = 1; j < ann.points.length; j++) {
                    if (ptSegDist(nx, ny, ann.points[j - 1][0], ann.points[j - 1][1], ann.points[j][0], ann.points[j][1]) < 0.012) return i;
                }
            } else {
                var b = annBounds(ann);
                if (b && nx >= b.x && nx <= b.x + b.w && ny >= b.y && ny <= b.y + b.h) return i;
            }
        }
        return -1;
    }

    function hitTestHandle(nx, ny, ann) {
        var b = annBounds(ann);
        if (!b) return null;
        var handles = {
            nw: [b.x, b.y], ne: [b.x + b.w, b.y],
            sw: [b.x, b.y + b.h], se: [b.x + b.w, b.y + b.h]
        };
        for (var k in handles) {
            var h = handles[k];
            if (Math.hypot(nx - h[0], ny - h[1]) < 0.025) return k;
        }
        return null;
    }

    function ptSegDist(px, py, x1, y1, x2, y2) {
        var dx = x2 - x1, dy = y2 - y1;
        if (!dx && !dy) return Math.hypot(px - x1, py - y1);
        var tt = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(px - (x1 + tt * dx), py - (y1 + tt * dy));
    }

    function pointerPos(ev) {
        var rect = olCanvas.getBoundingClientRect();
        var cx = (ev.clientX - rect.left) * (olCanvas.width / rect.width);
        var cy = (ev.clientY - rect.top) * (olCanvas.height / rect.height);
        return canvasToNorm(cx, cy);
    }

    function eraseAt(nx, ny) {
        var list = pageAnns();
        var changed = false;
        for (var i = list.length - 1; i >= 0; i--) {
            var ann = list[i];
            if (ann.type !== 'draw' && ann.type !== 'highlight') continue;
            if (!ann.points) continue;
            for (var j = 1; j < ann.points.length; j++) {
                if (ptSegDist(nx, ny, ann.points[j - 1][0], ann.points[j - 1][1], ann.points[j][0], ann.points[j][1]) < 0.018) {
                    list.splice(i, 1);
                    changed = true;
                    break;
                }
            }
        }
        if (changed) { pushUndo(); redrawOverlay(); }
    }

    function placeImageAt(p) {
        var h = 0.2 / pendingImageAspect;
        pushUndo();
        pageAnns().push({
            type: 'image',
            dataUrl: pendingImageUrl,
            x: p.x,
            y: p.y,
            w: 0.2,
            h: Math.max(0.04, h),
            opacity: 1
        });
        pendingImageUrl = null;
        placeMode = null;
        olCanvas.classList.remove('pde-cursor-place');
        selectedIdx = pageAnns().length - 1;
        refreshPropsPanel();
        redrawOverlay();
    }

    function placeSignatureAt(p) {
        pushUndo();
        pageAnns().push({
            type: 'signature',
            dataUrl: pendingSigUrl,
            x: p.x,
            y: p.y,
            w: 0.22,
            h: 0.08,
            opacity: 1
        });
        pendingSigUrl = null;
        placeMode = null;
        olCanvas.classList.remove('pde-cursor-place');
        selectedIdx = pageAnns().length - 1;
        refreshPropsPanel();
        redrawOverlay();
    }

    function onPointerDown(ev) {
        if (!pdfJsDoc || textEditorEl) return;
        if (tool === 'hand') {
            panDrag = { x: ev.clientX, y: ev.clientY, sl: viewportEl.scrollLeft, st: viewportEl.scrollTop };
            if (olCanvas) olCanvas.style.cursor = 'grabbing';
            return;
        }
        ev.preventDefault();
        olCanvas.setPointerCapture(ev.pointerId);
        var p = pointerPos(ev);

        if (placeMode === 'image' && pendingImageUrl) { placeImageAt(p); return; }
        if (placeMode === 'signature' && pendingSigUrl) { placeSignatureAt(p); return; }

        if (tool === 'eraser') { eraseAt(p.x, p.y); return; }

        if (tool === 'pen' || tool === 'highlight') {
            currentStroke = {
                type: tool === 'highlight' ? 'highlight' : 'draw',
                color: tool === 'highlight' ? '#facc15' : props.color,
                width: tool === 'highlight' ? Math.max(props.width, 8) : props.width,
                opacity: tool === 'highlight' ? 0.45 : props.opacity,
                points: [[p.x, p.y]]
            };
            redrawOverlay();
            return;
        }

        if (tool === 'text') {
            openTextEditor(p.x, p.y, null, -1);
            return;
        }

        if (tool === 'stamp') {
            pushUndo();
            pageAnns().push({
                type: 'stamp',
                text: props.stampText || 'APPROVED',
                color: '#dc2626',
                x: p.x,
                y: p.y,
                w: 0.18,
                h: 0.06,
                opacity: 0.9
            });
            selectedIdx = pageAnns().length - 1;
            redrawOverlay();
            refreshPropsPanel();
            return;
        }

        if (tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow') {
            shapePreview = {
                type: tool,
                x: p.x, y: p.y, w: 0, h: 0,
                color: props.color,
                width: props.width,
                opacity: props.opacity,
                fill: props.fill
            };
            return;
        }

        if (tool === 'select') {
            var idx = hitTest(p.x, p.y);
            if (idx >= 0) {
                selectedIdx = idx;
                var ann = pageAnns()[idx];
                var handle = hitTestHandle(p.x, p.y, ann);
                if (handle) {
                    dragState = { kind: 'resize', idx: idx, handle: handle, start: p, orig: JSON.parse(JSON.stringify(ann)) };
                } else {
                    dragState = {
                        kind: 'move', idx: idx, start: p,
                        orig: JSON.parse(JSON.stringify(ann))
                    };
                }
                refreshPropsPanel();
            } else {
                selectedIdx = -1;
                refreshPropsPanel();
            }
            redrawOverlay();
        }
    }

    function onPointerMove(ev) {
        if (panDrag && viewportEl) {
            viewportEl.scrollLeft = panDrag.sl - (ev.clientX - panDrag.x);
            viewportEl.scrollTop = panDrag.st - (ev.clientY - panDrag.y);
            return;
        }
        if (!pdfJsDoc) return;
        var p = pointerPos(ev);

        if (tool === 'eraser') { eraseAt(p.x, p.y); return; }

        if (currentStroke) {
            var pts = currentStroke.points;
            var last = pts[pts.length - 1];
            if (Math.hypot(p.x - last[0], p.y - last[1]) > 0.0015) {
                pts.push([p.x, p.y]);
                redrawOverlay();
            }
            return;
        }

        if (shapePreview) {
            shapePreview.w = p.x - shapePreview.x;
            shapePreview.h = p.y - shapePreview.y;
            redrawOverlay();
            return;
        }

        if (dragState) {
            var ann = pageAnns()[dragState.idx];
            var dx = p.x - dragState.start.x;
            var dy = p.y - dragState.start.y;
            var o = dragState.orig;
            if (dragState.kind === 'move') {
                if (o.type === 'draw' || o.type === 'highlight') {
                    ann.points = o.points.map(function (pt) { return [pt[0] + dx, pt[1] + dy]; });
                } else if (o.type === 'line' || o.type === 'arrow') {
                    ann.x = o.x + dx; ann.y = o.y + dy;
                } else {
                    ann.x = o.x + dx; ann.y = o.y + dy;
                }
            } else if (dragState.kind === 'resize') {
                applyResize(ann, o, dragState.handle, dx, dy);
            }
            redrawOverlay();
            refreshPropsPanel();
        }
    }

    function applyResize(ann, o, handle, dx, dy) {
        if (o.type === 'line' || o.type === 'arrow') {
            ann.w = o.w + dx;
            ann.h = o.h + dy;
            return;
        }
        var x = o.x, y = o.y, w = o.w, h = o.h;
        if (handle === 'se') { w = Math.max(0.02, o.w + dx); h = Math.max(0.02, o.h + dy); }
        else if (handle === 'sw') { x = o.x + dx; w = Math.max(0.02, o.w - dx); h = Math.max(0.02, o.h + dy); }
        else if (handle === 'ne') { y = o.y + dy; w = Math.max(0.02, o.w + dx); h = Math.max(0.02, o.h - dy); }
        else if (handle === 'nw') { x = o.x + dx; y = o.y + dy; w = Math.max(0.02, o.w - dx); h = Math.max(0.02, o.h - dy); }
        ann.x = x; ann.y = y; ann.w = w; ann.h = h;
    }

    function onPointerUp(ev) {
        if (panDrag) {
            panDrag = null;
            updateToolCursors();
            return;
        }
        try { olCanvas.releasePointerCapture(ev.pointerId); } catch (e) {}
        if (currentStroke) {
            if (currentStroke.points.length >= 2) {
                pushUndo();
                pageAnns().push(currentStroke);
            }
            currentStroke = null;
            redrawOverlay();
        }
        if (shapePreview) {
            if (Math.abs(shapePreview.w) > 0.01 || Math.abs(shapePreview.h) > 0.01) {
                if (shapePreview.type === 'rect' || shapePreview.type === 'ellipse') {
                    if (shapePreview.w < 0) { shapePreview.x += shapePreview.w; shapePreview.w = Math.abs(shapePreview.w); }
                    if (shapePreview.h < 0) { shapePreview.y += shapePreview.h; shapePreview.h = Math.abs(shapePreview.h); }
                }
                pushUndo();
                pageAnns().push(shapePreview);
                selectedIdx = pageAnns().length - 1;
            }
            shapePreview = null;
            redrawOverlay();
            refreshPropsPanel();
        }
        if (dragState) {
            pushUndo();
            dragState = null;
        }
    }

    function onDoubleClick(ev) {
        if (tool !== 'select') return;
        var p = pointerPos(ev);
        var idx = hitTest(p.x, p.y);
        if (idx < 0) return;
        var ann = pageAnns()[idx];
        if (ann.type === 'text') openTextEditor(ann.x, ann.y, ann, idx);
    }

    // ── inline text editor ───────────────────────────────────────
    function closeTextEditor(commit) {
        if (!textEditorEl) return;
        if (commit && textEditorEl._pdeMeta) {
            var meta = textEditorEl._pdeMeta;
            var val = textEditorEl.value;
            if (val.trim()) {
                if (meta.idx >= 0) {
                    pushUndo();
                    pageAnns()[meta.idx].text = val;
                } else {
                    pushUndo();
                    pageAnns().push({
                        type: 'text',
                        text: val,
                        x: meta.x,
                        y: meta.y,
                        size: props.fontSize,
                        fontFamily: props.fontFamily,
                        color: props.color,
                        opacity: props.opacity
                    });
                    selectedIdx = pageAnns().length - 1;
                }
                redrawOverlay();
                refreshPropsPanel();
            }
        }
        textEditorEl.remove();
        textEditorEl = null;
    }

    function openTextEditor(nx, ny, existing, idx) {
        closeTextEditor(false);
        var cp = normToCanvas(nx, ny);
        var stageRect = stageEl.getBoundingClientRect();
        var ta = document.createElement('textarea');
        ta.className = 'pde-text-editor';
        ta.style.left = (stageRect.left + cp.x * (stageEl.offsetWidth / olCanvas.width)) + 'px';
        ta.style.top = (stageRect.top + cp.y * (stageEl.offsetHeight / olCanvas.height) - props.fontSize) + 'px';
        ta.style.fontSize = Math.round(props.fontSize * viewportScale) + 'px';
        ta.style.fontFamily = props.fontFamily;
        ta.style.color = props.color;
        ta.value = existing ? existing.text : '';
        ta._pdeMeta = { x: nx, y: ny, idx: idx };
        document.body.appendChild(ta);
        textEditorEl = ta;
        ta.focus();
        ta.addEventListener('blur', function () { closeTextEditor(true); });
        ta.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); closeTextEditor(false); }
            e.stopPropagation();
        });
    }

    function deleteSelected() {
        if (selectedIdx < 0) return;
        pushUndo();
        pageAnns().splice(selectedIdx, 1);
        selectedIdx = -1;
        redrawOverlay();
        refreshPropsPanel();
    }

    function copySelected() {
        if (selectedIdx < 0) return;
        clipAnn = JSON.parse(JSON.stringify(pageAnns()[selectedIdx]));
        setStatus(t('Copied.', '已复制。', '已複製。'));
    }

    function pasteClip() {
        if (!clipAnn) return;
        pushUndo();
        var c = JSON.parse(JSON.stringify(clipAnn));
        delete c._img;
        if (c.x != null) { c.x += 0.02; c.y += 0.02; }
        if (c.points) c.points = c.points.map(function (p) { return [p[0] + 0.02, p[1] + 0.02]; });
        pageAnns().push(c);
        selectedIdx = pageAnns().length - 1;
        redrawOverlay();
        refreshPropsPanel();
    }

    function layerOrder(dir) {
        if (selectedIdx < 0) return;
        var list = pageAnns();
        var ann = list.splice(selectedIdx, 1)[0];
        pushUndo();
        if (dir === 'front') list.push(ann);
        else list.unshift(ann);
        selectedIdx = dir === 'front' ? list.length - 1 : 0;
        redrawOverlay();
    }

    function updatePageLabel() {
        var el = gg('pde_page_label');
        if (el) el.textContent = (pageNum + 1) + ' / ' + pageCount;
        var prev = gg('pde_prev'); var next = gg('pde_next');
        if (prev) prev.disabled = pageNum <= 0;
        if (next) next.disabled = pageNum >= pageCount - 1;
    }

    function setTool(next, opts) {
        opts = opts || {};
        closeTextEditor(true);
        tool = next;
        if (!opts.keepPlace) {
            placeMode = null;
            pendingImageUrl = null;
            pendingSigUrl = null;
            olCanvas && olCanvas.classList.remove('pde-cursor-place');
        }
        if (!opts.keepSelect) selectedIdx = -1;
        updateToolCursors();
        document.querySelectorAll('[data-pde-tool]').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-pde-tool') === next);
        });
        refreshPropsPanel();
        redrawOverlay();
    }

    function updateToolCursors() {
        if (!olCanvas) return;
        var map = {
            select: 'default', hand: 'grab', pen: 'crosshair', highlight: 'crosshair',
            eraser: 'cell', text: 'text', rect: 'crosshair', ellipse: 'crosshair',
            line: 'crosshair', arrow: 'crosshair', stamp: 'copy'
        };
        olCanvas.style.cursor = placeMode ? 'copy' : (map[tool] || 'default');
    }

    // ── properties panel ─────────────────────────────────────────
    function refreshPropsPanel() {
        var panel = gg('pde_props_body');
        if (!panel) return;
        var ann = selectedIdx >= 0 ? pageAnns()[selectedIdx] : null;
        if (!ann) {
            panel.innerHTML =
                '<p class="pde-props-empty">' + esc(t('Select an object to edit properties, or adjust defaults below.', '选择对象以编辑属性，或调整默认设置。', '選擇物件以編輯屬性，或調整預設設定。')) + '</p>' +
                propsFields(null);
            wirePropsFields(null);
            return;
        }
        panel.innerHTML =
            '<p class="pde-props-type">' + esc(t('Selected', '已选', '已選') + ': ' + ann.type) + '</p>' +
            propsFields(ann) +
            '<div class="pde-props-actions">' +
                '<button type="button" class="ct-btn pde-props-btn" data-act="front">' + esc(t('Bring front', '置于顶层', '移至頂層')) + '</button>' +
                '<button type="button" class="ct-btn pde-props-btn" data-act="back">' + esc(t('Send back', '置于底层', '移至底層')) + '</button>' +
                '<button type="button" class="ct-btn pde-props-btn" data-act="delete">' + esc(t('Delete', '删除', '刪除')) + '</button>' +
            '</div>';
        wirePropsFields(ann);
        panel.querySelectorAll('[data-act]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var act = btn.getAttribute('data-act');
                if (act === 'front') layerOrder('front');
                else if (act === 'back') layerOrder('back');
                else if (act === 'delete') deleteSelected();
            });
        });
    }

    function propsFields(ann) {
        var isText = ann && ann.type === 'text';
        var isStroke = ann && (ann.type === 'draw' || ann.type === 'highlight' || ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'line' || ann.type === 'arrow');
        var isBox = ann && (ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'image' || ann.type === 'signature' || ann.type === 'stamp');
        var color = ann ? ann.color : props.color;
        var width = ann ? ann.width : props.width;
        var opacity = ann ? (ann.opacity != null ? ann.opacity : 1) : props.opacity;
        var html = '';
        html += fieldColor('pde_prop_color', t('Color', '颜色', '顏色'), color);
        if (isStroke || !ann) {
            html += fieldRange('pde_prop_width', t('Stroke', '线宽', '線寬'), width, 1, 24);
        }
        html += fieldRange('pde_prop_opacity', t('Opacity', '不透明度', '不透明度'), Math.round(opacity * 100), 10, 100, '%');
        if (isText || (!ann && tool === 'text')) {
            html += fieldRange('pde_prop_fontsize', t('Font size', '字号', '字號'), ann ? ann.size : props.fontSize, 8, 72, 'px');
            html += fieldSelect('pde_prop_font', t('Font', '字体', '字體'), ann ? ann.fontFamily : props.fontFamily, [
                ['sans-serif', 'Sans'],
                ['serif', 'Serif'],
                ['"Joyful CJK Sans", sans-serif', 'CJK Sans'],
                ['monospace', 'Mono']
            ]);
        }
        if (isBox && ann && ann.type === 'rect') {
            html += fieldCheck('pde_prop_fill', t('Fill shape', '填充', '填充'), !!ann.fill);
        }
        if (ann && ann.type === 'stamp') {
            html += fieldText('pde_prop_stamp', t('Stamp text', '图章文字', '圖章文字'), ann.text || 'APPROVED');
        }
        if (!ann) {
            html += fieldText('pde_prop_stamptext', t('Default stamp', '默认图章', '預設圖章'), props.stampText || 'APPROVED');
        }
        return html;
    }

    function fieldColor(id, label, val) {
        return '<label class="pde-prop-field"><span>' + esc(label) + '</span><input type="color" id="' + id + '" value="' + esc(val || '#111827') + '"></label>';
    }
    function fieldRange(id, label, val, min, max, suffix) {
        return '<label class="pde-prop-field"><span>' + esc(label) + '</span><input type="range" id="' + id + '" min="' + min + '" max="' + max + '" value="' + val + '"> <em>' + val + (suffix || '') + '</em></label>';
    }
    function fieldSelect(id, label, val, opts) {
        var h = '<label class="pde-prop-field"><span>' + esc(label) + '</span><select id="' + id + '">';
        opts.forEach(function (o) {
            h += '<option value="' + esc(o[0]) + '"' + (val === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        });
        return h + '</select></label>';
    }
    function fieldCheck(id, label, checked) {
        return '<label class="pde-prop-field pde-prop-check"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '> ' + esc(label) + '</label>';
    }
    function fieldText(id, label, val) {
        return '<label class="pde-prop-field"><span>' + esc(label) + '</span><input type="text" id="' + id + '" value="' + esc(val || '') + '"></label>';
    }

    function wirePropsFields(ann) {
        function bind(id, fn) {
            var el = gg(id);
            if (el) el.addEventListener('input', fn);
            if (el) el.addEventListener('change', fn);
        }
        bind('pde_prop_color', function () {
            var v = gg('pde_prop_color').value;
            if (ann) { ann.color = v; redrawOverlay(); }
            else props.color = v;
        });
        bind('pde_prop_width', function () {
            var v = parseInt(gg('pde_prop_width').value, 10);
            if (ann) { ann.width = v; redrawOverlay(); }
            else props.width = v;
            var em = gg('pde_prop_width') && gg('pde_prop_width').nextElementSibling;
            if (em) em.textContent = v;
        });
        bind('pde_prop_opacity', function () {
            var v = parseInt(gg('pde_prop_opacity').value, 10) / 100;
            if (ann) { ann.opacity = v; redrawOverlay(); }
            else props.opacity = v;
        });
        bind('pde_prop_fontsize', function () {
            var v = parseInt(gg('pde_prop_fontsize').value, 10);
            if (ann) { ann.size = v; redrawOverlay(); }
            else props.fontSize = v;
        });
        bind('pde_prop_font', function () {
            var v = gg('pde_prop_font').value;
            if (ann) { ann.fontFamily = v; redrawOverlay(); }
            else props.fontFamily = v;
        });
        bind('pde_prop_fill', function () {
            if (!ann) return;
            ann.fill = gg('pde_prop_fill').checked;
            redrawOverlay();
        });
        bind('pde_prop_stamp', function () {
            if (!ann) return;
            ann.text = gg('pde_prop_stamp').value;
            redrawOverlay();
        });
        bind('pde_prop_stamptext', function () {
            props.stampText = gg('pde_prop_stamptext').value;
        });
    }

    // ── thumbnails ───────────────────────────────────────────────
    function buildThumbnails() {
        var box = gg('pde_thumbs');
        if (!box || !pdfJsDoc) return;
        box.innerHTML = '';
        thumbUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
        thumbUrls = [];
        var chain = Promise.resolve();
        for (var i = 0; i < pageCount; i++) {
            (function (pi) {
                chain = chain.then(function () {
                    return pdfJsDoc.getPage(pi + 1).then(function (page) {
                        var vp = page.getViewport({ scale: 0.18 });
                        var c = document.createElement('canvas');
                        c.width = vp.width; c.height = vp.height;
                        return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
                            var btn = document.createElement('button');
                            btn.type = 'button';
                            btn.className = 'pde-thumb' + (pi === pageNum ? ' active' : '');
                            btn.setAttribute('data-page', pi);
                            btn.innerHTML = '<img src="' + c.toDataURL('image/jpeg', 0.7) + '" alt=""><span>' + (pi + 1) + '</span>';
                            btn.addEventListener('click', function () {
                                pageNum = pi;
                                selectedIdx = -1;
                                renderPage();
                            });
                            box.appendChild(btn);
                        });
                    });
                });
            })(i);
        }
        return chain;
    }

    function refreshThumbsActive() {
        document.querySelectorAll('.pde-thumb').forEach(function (btn) {
            btn.classList.toggle('active', parseInt(btn.getAttribute('data-page'), 10) === pageNum);
        });
    }

    // ── signature modal ──────────────────────────────────────────
    function openSignaturePad() {
        var saved = null;
        var savedTypeStyle = 'normal';
        try { saved = localStorage.getItem(LS_SIG_KEY); } catch (e) {}
        try { savedTypeStyle = localStorage.getItem(LS_SIG_TYPE_STYLE) || 'normal'; } catch (e2) {}

        var ov = document.createElement('div');
        ov.className = 'pde-sig-overlay';
        ov.innerHTML =
            '<div class="pde-sig-modal" role="dialog">' +
                '<div class="pde-sig-tabs">' +
                    '<button type="button" class="active" data-sigtab="draw">' + esc(t('Draw', '绘制', '繪製')) + '</button>' +
                    '<button type="button" data-sigtab="type">' + esc(t('Type', '输入', '輸入')) + '</button>' +
                '</div>' +
                '<div id="pde_sig_draw_pane">' +
                    '<canvas id="pde_sig_canvas" class="pde-sig-canvas" width="520" height="160"></canvas>' +
                '</div>' +
                '<div id="pde_sig_type_pane" class="pde-sig-type-pane" style="display:none;">' +
                    '<label class="pde-sig-type-lbl">' + esc(t('Your name', '您的姓名', '您的姓名')) +
                        '<input type="text" id="pde_sig_type_input" class="pde-sig-type-input" placeholder="' +
                        esc(t('Type signature here…', '在此输入签名…', '在此輸入簽名…')) + '"></label>' +
                    '<label class="pde-sig-type-lbl">' + esc(t('Letter style', '字体样式', '字體樣式')) +
                        '<select id="pde_sig_type_font" class="pde-sig-type-font">' +
                        buildSigTypeStyleOptions(savedTypeStyle) +
                        '</select></label>' +
                    '<div class="pde-sig-type-preview-wrap">' +
                        '<span class="pde-sig-type-preview-hd">' + esc(t('Preview', '预览', '預覽')) + '</span>' +
                        '<canvas id="pde_sig_type_preview" class="pde-sig-type-preview" width="520" height="100"></canvas>' +
                    '</div>' +
                '</div>' +
                (saved ? '<button type="button" class="ct-btn" id="pde_use_saved" style="width:100%;margin-top:8px;">' + esc(t('Use saved signature', '使用已保存签名', '使用已保存簽名')) + '</button>' : '') +
                '<label class="pde-sig-save-lbl"><input type="checkbox" id="pde_sig_save"> ' + esc(t('Remember signature', '记住签名', '記住簽名')) + '</label>' +
                '<div class="pde-sig-actions">' +
                    '<button type="button" class="ct-btn" id="pde_sig_clear">' + esc(t('Clear', '清除', '清除')) + '</button>' +
                    '<button type="button" class="ct-btn" id="pde_sig_cancel">' + esc(t('Cancel', '取消', '取消')) + '</button>' +
                    '<button type="button" class="ct-btn ct-btn-primary" id="pde_sig_ok">' + esc(t('Apply', '应用', '套用')) + '</button>' +
                '</div></div>';
        document.body.appendChild(ov);

        var sigTab = 'draw';
        ov.querySelectorAll('[data-sigtab]').forEach(function (b) {
            b.addEventListener('click', function () {
                sigTab = b.getAttribute('data-sigtab');
                ov.querySelectorAll('[data-sigtab]').forEach(function (x) { x.classList.toggle('active', x === b); });
                gg('pde_sig_draw_pane').style.display = sigTab === 'draw' ? 'block' : 'none';
                gg('pde_sig_type_pane').style.display = sigTab === 'type' ? 'block' : 'none';
                if (sigTab === 'type') refreshTypePreview();
            });
        });

        var typePreviewCv = gg('pde_sig_type_preview');
        var typeInput = gg('pde_sig_type_input');
        var typeFontSel = gg('pde_sig_type_font');

        function refreshTypePreview() {
            if (!typePreviewCv) return;
            var cx = typePreviewCv.getContext('2d');
            cx.fillStyle = '#fafafa';
            cx.fillRect(0, 0, typePreviewCv.width, typePreviewCv.height);
            cx.strokeStyle = '#ddd';
            cx.strokeRect(0.5, 0.5, typePreviewCv.width - 1, typePreviewCv.height - 1);
            var txt = (typeInput && typeInput.value || '').trim();
            if (!txt) {
                cx.fillStyle = '#aaa';
                cx.font = '400 14px sans-serif';
                cx.textAlign = 'center';
                cx.textBaseline = 'middle';
                cx.fillText(t('Preview appears here', '预览显示在这里', '預覽顯示在這裡'), typePreviewCv.width / 2, typePreviewCv.height / 2);
                return;
            }
            var styleId = typeFontSel ? typeFontSel.value : 'normal';
            cx.font = sigTypeFontCss(styleId);
            cx.fillStyle = '#111827';
            cx.textAlign = 'center';
            cx.textBaseline = 'middle';
            cx.fillText(txt, typePreviewCv.width / 2, typePreviewCv.height / 2);
        }

        if (typeInput) {
            typeInput.addEventListener('input', refreshTypePreview);
        }
        if (typeFontSel) {
            typeFontSel.addEventListener('change', function () {
                try { localStorage.setItem(LS_SIG_TYPE_STYLE, typeFontSel.value); } catch (e) {}
                refreshTypePreview();
            });
        }
        refreshTypePreview();
        ensureSigTypeFonts().then(refreshTypePreview);

        var sigCv = gg('pde_sig_canvas');
        var sigCtx = sigCv.getContext('2d');
        sigCtx.fillStyle = '#fff';
        sigCtx.fillRect(0, 0, sigCv.width, sigCv.height);
        sigCtx.strokeStyle = '#111827';
        sigCtx.fillStyle = '#111827';
        sigCtx.lineWidth = 2.5;
        sigCtx.lineCap = 'round';
        sigCtx.lineJoin = 'round';
        var drawing = false;
        /** @type {Array<Array<{x:number,y:number}>>} finished strokes */
        var sigStrokes = [];
        /** @type {Array<{x:number,y:number}>|null} stroke in progress */
        var currentSigStroke = null;

        function sigPos(ev) {
            var r = sigCv.getBoundingClientRect();
            return { x: (ev.clientX - r.left) * (sigCv.width / r.width), y: (ev.clientY - r.top) * (sigCv.height / r.height) };
        }

        function drawSigStroke(ctx, stroke) {
            if (!stroke || !stroke.length) return;
            if (stroke.length === 1) {
                ctx.beginPath();
                ctx.arc(stroke[0].x, stroke[0].y, 1.8, 0, Math.PI * 2);
                ctx.fill();
                return;
            }
            ctx.beginPath();
            ctx.moveTo(stroke[0].x, stroke[0].y);
            for (var i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
            ctx.stroke();
        }

        function sigRedraw() {
            sigCtx.fillStyle = '#fff';
            sigCtx.fillRect(0, 0, sigCv.width, sigCv.height);
            sigCtx.strokeStyle = '#111827';
            sigCtx.fillStyle = '#111827';
            sigCtx.lineWidth = 2.5;
            sigCtx.lineCap = 'round';
            sigCtx.lineJoin = 'round';
            sigStrokes.forEach(function (stroke) { drawSigStroke(sigCtx, stroke); });
            if (currentSigStroke) drawSigStroke(sigCtx, currentSigStroke);
        }

        function sigHasInk() {
            if (sigStrokes.length) return true;
            return !!(currentSigStroke && currentSigStroke.length);
        }

        sigCv.addEventListener('pointerdown', function (ev) {
            ev.preventDefault();
            sigCv.setPointerCapture(ev.pointerId);
            drawing = true;
            currentSigStroke = [sigPos(ev)];
            sigRedraw();
        });
        sigCv.addEventListener('pointermove', function (ev) {
            if (!drawing || !currentSigStroke) return;
            var p = sigPos(ev);
            var last = currentSigStroke[currentSigStroke.length - 1];
            if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.5) {
                currentSigStroke.push(p);
                sigRedraw();
            }
        });
        function sigUp(ev) {
            if (drawing && currentSigStroke && currentSigStroke.length) {
                sigStrokes.push(currentSigStroke);
                currentSigStroke = null;
                sigRedraw();
            }
            drawing = false;
            try { sigCv.releasePointerCapture(ev.pointerId); } catch (e) {}
        }
        sigCv.addEventListener('pointerup', sigUp);
        sigCv.addEventListener('pointercancel', sigUp);

        function closeOv() { if (ov.parentNode) ov.parentNode.removeChild(ov); }

        function renderTypeSig() {
            var txt = (gg('pde_sig_type_input').value || '').trim();
            if (!txt) return null;
            var styleId = gg('pde_sig_type_font') ? gg('pde_sig_type_font').value : 'normal';
            var c = document.createElement('canvas');
            c.width = 520;
            c.height = 160;
            var cx = c.getContext('2d');
            cx.fillStyle = '#fff';
            cx.fillRect(0, 0, c.width, c.height);
            cx.font = sigTypeFontCss(styleId);
            cx.fillStyle = '#111827';
            cx.textAlign = 'center';
            cx.textBaseline = 'middle';
            cx.fillText(txt, c.width / 2, c.height / 2);
            return c.toDataURL('image/png');
        }

        function applySig(url) {
            if (gg('pde_sig_save') && gg('pde_sig_save').checked) {
                try { localStorage.setItem(LS_SIG_KEY, url); } catch (e) {}
            }
            pendingSigUrl = url;
            placeMode = 'signature';
            setTool('select', { keepPlace: true, keepSelect: true });
            olCanvas.classList.add('pde-cursor-place');
            setStatus(t('Click on the page to place signature.', '点击页面放置签名。', '點擊頁面放置簽名。'));
            closeOv();
        }

        gg('pde_sig_clear').addEventListener('click', function () {
            if (sigTab === 'type') {
                if (typeInput) typeInput.value = '';
                refreshTypePreview();
                return;
            }
            sigStrokes = [];
            currentSigStroke = null;
            drawing = false;
            sigRedraw();
        });
        gg('pde_sig_cancel').addEventListener('click', closeOv);
        if (saved && gg('pde_use_saved')) {
            gg('pde_use_saved').addEventListener('click', function () { applySig(saved); });
        }
        gg('pde_sig_ok').addEventListener('click', function () {
            if (drawing && currentSigStroke && currentSigStroke.length) {
                sigStrokes.push(currentSigStroke);
                currentSigStroke = null;
                drawing = false;
                sigRedraw();
            }
            function finishApply() {
                var url = sigTab === 'type' ? renderTypeSig() : (sigHasInk() ? sigCv.toDataURL('image/png') : null);
                if (!url) { alert(t('Please create a signature first.', '请先创建签名。', '請先建立簽名。')); return; }
                applySig(url);
            }
            if (sigTab === 'type') {
                ensureSigTypeFonts().then(finishApply);
            } else {
                finishApply();
            }
        });
    }

    // ── load / export ────────────────────────────────────────────
    function loadPdfFile(file) {
        if (!file) return;
        fileName = file.name || 'document.pdf';
        setStatus(t('Loading…', '加载中…', '載入中…'), 'work');
        var reader = new FileReader();
        reader.onload = function () {
            pdfBytes = reader.result;
            ensurePdfJs().then(function (pdfjs) {
                return pdfjs.getDocument({ data: pdfBytes.slice(0) }).promise;
            }).then(function (doc) {
                pdfJsDoc = doc;
                pageCount = doc.numPages;
                pageNum = 0;
                annByPage = {};
                pageDims = {};
                undoStack = [];
                redoStack = [];
                syncHistoryButtons();
                gg('pde_empty').style.display = 'none';
                gg('pde_shell').style.display = 'flex';
                gg('pde_save').disabled = false;
                setPrintButtonsEnabled(true);
                return buildThumbnails().then(renderPage);
            }).then(function () {
                setStatus(t('Ready.', '就绪。', '就緒。'));
            }).catch(function (e) {
                setStatus(t('Failed: ', '失败：', '失敗：') + (e && e.message || e), 'bad');
            });
        };
        reader.readAsArrayBuffer(file);
    }

    function setPrintButtonsEnabled(on) {
        ['pde_print', 'pde_print_setup'].forEach(function (id) {
            var b = gg(id);
            if (b) b.disabled = !on;
        });
    }

    function buildFlattenedPdfBytes() {
        if (!pdfBytes) return Promise.reject(new Error('No PDF loaded'));
        return ensurePdfLib().then(function (PDFLib) {
            return PDFLib.PDFDocument.load(pdfBytes.slice(0), { ignoreEncryption: true });
        }).then(function (doc) {
            var pages = doc.getPages();
            var chain = Promise.resolve();
            Object.keys(annByPage).forEach(function (pk) {
                chain = chain.then(function () {
                    var pi = parseInt(pk, 10);
                    if (pi < 0 || pi >= pages.length) return;
                    var page = pages[pi];
                    var dim = pageDims[pi] || { w: page.getWidth(), h: page.getHeight() };
                    var pw = page.getWidth();
                    var ph = page.getHeight();
                    var sx = pw / dim.w;
                    var sy = ph / dim.h;
                    var list = annByPage[pk] || [];
                    var inner = Promise.resolve();

                    list.forEach(function (ann) {
                        inner = inner.then(function () {
                            function pt(nx, ny) {
                                var p = normToPdfPt(nx, ny, dim);
                                return { x: p.x * sx, y: p.y * sy };
                            }
                            var ca = parseColorAlpha(ann.color, ann.opacity);

                            if ((ann.type === 'draw' || ann.type === 'highlight') && ann.points && ann.points.length >= 2) {
                                var col = hexRgb(PDFLib, ca.hex);
                                var th = Math.max(0.5, (ann.width || 2) * sx * 0.85);
                                var op = ann.opacity != null ? ann.opacity : 1;
                                for (var i = 1; i < ann.points.length; i++) {
                                    var a = pt(ann.points[i - 1][0], ann.points[i - 1][1]);
                                    var b = pt(ann.points[i][0], ann.points[i][1]);
                                    page.drawLine({
                                        start: a, end: b,
                                        thickness: th,
                                        color: col,
                                        opacity: op
                                    });
                                }
                                return;
                            }
                            if (ann.type === 'text') {
                                var tp = pt(ann.x, ann.y);
                                page.drawText(String(ann.text || ''), {
                                    x: tp.x,
                                    y: tp.y,
                                    size: Math.max(8, (ann.size || 14) * sx),
                                    color: hexRgb(PDFLib, ann.color),
                                    opacity: ann.opacity != null ? ann.opacity : 1
                                });
                                return;
                            }
                            if (ann.type === 'rect') {
                                var rtl = pt(ann.x, ann.y + ann.h);
                                page.drawRectangle({
                                    x: rtl.x,
                                    y: rtl.y,
                                    width: ann.w * pw,
                                    height: ann.h * ph,
                                    borderColor: hexRgb(PDFLib, ca.hex),
                                    borderWidth: (ann.width || 2) * sx * 0.5,
                                    color: ann.fill ? hexRgb(PDFLib, ca.hex) : undefined,
                                    opacity: ca.opacity
                                });
                                return;
                            }
                            if (ann.type === 'ellipse') {
                                var ec = pt(ann.x + ann.w / 2, ann.y + ann.h / 2);
                                page.drawEllipse({
                                    x: ec.x,
                                    y: ec.y,
                                    xScale: (ann.w * pw) / 2,
                                    yScale: (ann.h * ph) / 2,
                                    borderColor: hexRgb(PDFLib, ca.hex),
                                    borderWidth: (ann.width || 2) * sx * 0.5,
                                    color: ann.fill ? hexRgb(PDFLib, ca.hex) : undefined,
                                    opacity: ca.opacity
                                });
                                return;
                            }
                            if (ann.type === 'line' || ann.type === 'arrow') {
                                var l1 = pt(ann.x, ann.y);
                                var l2 = pt(ann.x + ann.w, ann.y + ann.h);
                                page.drawLine({
                                    start: l1, end: l2,
                                    thickness: (ann.width || 2) * sx * 0.5,
                                    color: hexRgb(PDFLib, ca.hex),
                                    opacity: ca.opacity
                                });
                                return;
                            }
                            if (ann.type === 'stamp') {
                                var st = pt(ann.x, ann.y + ann.h);
                                page.drawRectangle({
                                    x: st.x, y: st.y,
                                    width: ann.w * pw, height: ann.h * ph,
                                    borderColor: hexRgb(PDFLib, '#dc2626'),
                                    borderWidth: 2,
                                    opacity: 0.85
                                });
                                page.drawText(String(ann.text || 'APPROVED'), {
                                    x: st.x + ann.w * pw * 0.15,
                                    y: st.y + ann.h * ph * 0.35,
                                    size: Math.min(ann.h * ph * 0.45, 24),
                                    color: hexRgb(PDFLib, '#dc2626')
                                });
                                return;
                            }
                            if ((ann.type === 'image' || ann.type === 'signature') && ann.dataUrl) {
                                var bytes = dataUrlToBytes(ann.dataUrl);
                                var embedP = (ann.dataUrl.indexOf('image/jpeg') >= 0)
                                    ? doc.embedJpg(bytes) : doc.embedPng(bytes);
                                return embedP.then(function (img) {
                                    var tl = pt(ann.x, ann.y);
                                    var bl = pt(ann.x, ann.y + ann.h);
                                    page.drawImage(img, {
                                        x: tl.x,
                                        y: bl.y,
                                        width: ann.w * pw,
                                        height: ann.h * ph,
                                        opacity: ann.opacity != null ? ann.opacity : 1
                                    });
                                });
                            }
                        });
                    });
                    return inner;
                });
            });
            return chain.then(function () { return doc.save(); });
        });
    }

    function exportPdf() {
        if (!pdfBytes) return;
        setStatus(t('Exporting…', '导出中…', '匯出中…'), 'work');
        var saveBtn = gg('pde_save');
        if (saveBtn) saveBtn.disabled = true;
        buildFlattenedPdfBytes().then(function (bytes) {
            var base = fileName.replace(/\.pdf$/i, '') || 'document';
            dl(new Blob([bytes], { type: 'application/pdf' }), base + '_edited.pdf');
            setStatus(t('Saved successfully.', '保存成功。', '儲存成功。'), 'ok');
        }).catch(function (e) {
            setStatus(t('Export failed: ', '导出失败：', '匯出失敗：') + (e && e.message || e), 'bad');
        }).then(function () {
            if (saveBtn) saveBtn.disabled = false;
        });
    }

    // ── print setup & print ───────────────────────────────────────
    function defaultPrintSettings() {
        return {
            printer_name: 'Microsoft Print to PDF',
            paper_size: 'A4',
            paper_width_mm: null,
            paper_height_mm: null,
            margin_left: 10,
            margin_right: 10,
            margin_top: 10,
            margin_bottom: 10,
            orientation: 'portrait',
            scale_percent: 100,
            copies: 1,
            color_mode: 'color',
            fit_to_page: true,
            page_range: 'all'
        };
    }

    function loadPrintSettings() {
        try {
            var raw = localStorage.getItem(LS_PRINT_KEY);
            if (!raw) return defaultPrintSettings();
            return Object.assign(defaultPrintSettings(), JSON.parse(raw) || {});
        } catch (e) {
            return defaultPrintSettings();
        }
    }

    function savePrintSettings(settings) {
        try {
            localStorage.setItem(LS_PRINT_KEY, JSON.stringify(settings || {}));
        } catch (e) {}
    }

    function readKnownPrintersList() {
        try {
            var raw = localStorage.getItem(PRINTERS_LS_KEY);
            var arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr.filter(function (n) { return String(n || '').trim(); }) : [];
        } catch (e) {
            return [];
        }
    }

    function addKnownPrinterName(name) {
        var n = String(name || '').trim();
        if (!n) return;
        var list = readKnownPrintersList();
        if (list.indexOf(n) >= 0) return;
        list.push(n);
        list.sort(function (a, b) { return a.localeCompare(b, undefined, { sensitivity: 'base' }); });
        try {
            localStorage.setItem(PRINTERS_LS_KEY, JSON.stringify(list));
        } catch (e) {}
    }

    function collectPrintersFromClinicStore() {
        var names = [];
        function add(n) {
            var s = String(n || '').trim();
            if (s && names.indexOf(s) < 0) names.push(s);
        }
        try {
            var raw = localStorage.getItem('jsm_clinic_print_settings_v1');
            var all = raw ? JSON.parse(raw) : {};
            Object.keys(all).forEach(function (cid) {
                var map = all[cid] || {};
                Object.keys(map).forEach(function (dt) {
                    add(map[dt] && map[dt].printer_name);
                });
            });
        } catch (e) {}
        return names;
    }

    function mergedPrinterNames(current) {
        var map = {};
        PDE_PRINT_TO_PDF_NAMES.forEach(function (n) { map[n] = true; });
        _pdeCachedSystemPrinters.forEach(function (n) { map[n] = true; });
        collectPrintersFromClinicStore().forEach(function (n) { map[n] = true; });
        readKnownPrintersList().forEach(function (n) { map[n] = true; });
        if (typeof CFG !== 'undefined' && CFG && typeof CFG.getMergedPrinterNames === 'function') {
            CFG.getMergedPrinterNames().forEach(function (n) { map[n] = true; });
        }
        var cur = String(current || '').trim();
        if (cur) map[cur] = true;
        return Object.keys(map).sort(function (a, b) {
            return a.localeCompare(b, undefined, { sensitivity: 'base' });
        });
    }

    function updatePrintPrinterStatus(count, systemCount) {
        var el = gg('pde_print_printer_status');
        if (!el) return;
        if (systemCount > 0) {
            el.textContent = t(
                count + ' printer(s) listed (' + systemCount + ' from this device).',
                '已列出 ' + count + ' 个打印机（本机检测到 ' + systemCount + ' 个）。',
                '已列出 ' + count + ' 部印表機（本機偵測到 ' + systemCount + ' 部）。'
            );
        } else if (count > 0) {
            el.textContent = t(
                count + ' printer(s) listed (saved names + Print to PDF). System list unavailable in this browser.',
                '已列出 ' + count + ' 个打印机（已保存名称 + 打印到 PDF）。此浏览器无法读取系统打印机列表。',
                '已列出 ' + count + ' 部印表機（已儲存名稱 + 列印到 PDF）。此瀏覽器無法讀取系統印表機列表。'
            );
        } else {
            el.textContent = t(
                'No printers found yet. Use Refresh or type a printer name.',
                '尚未找到打印机。请刷新或手动输入名称。',
                '尚未找到印表機。請重新整理或手動輸入名稱。'
            );
        }
    }

    function setPrintPrinterSelectLoading(loading) {
        var sel = gg('pde_print_printer_sel');
        var refreshBtn = gg('pde_print_refresh_printers');
        if (!sel) return;
        if (loading) {
            sel.disabled = true;
            sel.innerHTML = '<option value="">' +
                esc(t('Detecting printers…', '正在检测打印机…', '正在偵測印表機…')) + '</option>';
        } else {
            sel.disabled = false;
        }
        if (refreshBtn) refreshBtn.disabled = !!loading;
    }

    function enumeratePrintersAsync(forceRefresh) {
        if (forceRefresh) _pdePrinterPreloadPromise = null;
        if (!forceRefresh && _pdePrinterPreloadPromise) return _pdePrinterPreloadPromise;

        _pdePrinterPreloadPromise = new Promise(function (resolve) {
            var detected = [];
            var systemDetected = [];
            function add(n, isSystem) {
                var s = String(n || '').trim();
                if (!s || detected.indexOf(s) >= 0) return;
                detected.push(s);
                if (isSystem && systemDetected.indexOf(s) < 0) systemDetected.push(s);
            }

            var tasks = [];

            if (typeof CFG !== 'undefined' && CFG &&
                typeof CFG.enumerateSystemPrintersAsync === 'function') {
                tasks.push(
                    CFG.enumerateSystemPrintersAsync().then(function (sys) {
                        (sys || []).forEach(function (n) { add(n, true); });
                    }).catch(function () {})
                );
            } else {
                if (typeof navigator !== 'undefined' && navigator.printers &&
                    typeof navigator.printers.getPrinters === 'function') {
                    tasks.push(
                        navigator.printers.getPrinters().then(function (list) {
                            (list || []).forEach(function (p) {
                                if (typeof p === 'string') add(p, true);
                                else add(p.name || p.deviceName || p.displayName || p.id, true);
                            });
                        }).catch(function () {})
                    );
                }
                if (typeof printing !== 'undefined' && printing &&
                    typeof printing.getPrinters === 'function') {
                    tasks.push(
                        printing.getPrinters().then(function (list) {
                            (list || []).forEach(function (p) {
                                if (typeof p === 'string') add(p, true);
                                else add(p.name || p.id, true);
                            });
                        }).catch(function () {})
                    );
                }
            }

            if (typeof CFG !== 'undefined' && CFG && typeof CFG.preloadPrinterLists === 'function') {
                tasks.push(CFG.preloadPrinterLists().catch(function () {}));
            }

            Promise.all(tasks.length ? tasks : [Promise.resolve()]).then(function () {
                collectPrintersFromClinicStore().forEach(function (n) { add(n, false); });
                readKnownPrintersList().forEach(function (n) { add(n, false); });
                if (typeof CFG !== 'undefined' && CFG && typeof CFG.getMergedPrinterNames === 'function') {
                    CFG.getMergedPrinterNames().forEach(function (n) { add(n, false); });
                }
                _pdeCachedSystemPrinters = systemDetected.slice();
                detected.forEach(addKnownPrinterName);

                if (forceRefresh) _pdePrinterPreloadPromise = null;
                resolve({
                    all: mergedPrinterNames(),
                    system: systemDetected.length
                });
            }).catch(function () {
                if (forceRefresh) _pdePrinterPreloadPromise = null;
                resolve({ all: mergedPrinterNames(), system: _pdeCachedSystemPrinters.length });
            });
        });

        return _pdePrinterPreloadPromise;
    }

    function preloadPrintersForEditor() {
        return enumeratePrintersAsync(false);
    }

    function refreshPrintSetupPrinterList(currentPrinter, showLoading) {
        if (showLoading) setPrintPrinterSelectLoading(true);
        return enumeratePrintersAsync(true).then(function (result) {
            setPrintPrinterSelectLoading(false);
            rebuildPrintPrinterSelect(currentPrinter);
            updatePrintPrinterStatus(result.all.length, result.system);
            return result;
        });
    }

    function rebuildPrintPrinterSelect(current) {
        var sel = gg('pde_print_printer_sel');
        var inp = gg('pde_print_printer');
        var dl = gg('pde_print_printer_list');
        if (!sel) return;
        var names = mergedPrinterNames(current || (inp && inp.value));
        var cur = String(current || (inp && inp.value) || '').trim();
        var html = '<option value="">' + esc(t('— Select printer —', '— 选择打印机 —', '— 選擇印表機 —')) + '</option>';
        names.forEach(function (n) {
            html += '<option value="' + esc(n) + '">' + esc(n) + '</option>';
        });
        html += '<option value="__custom__">' + esc(t('Other / type name…', '其他 / 手动输入…', '其他 / 手動輸入…')) + '</option>';
        sel.innerHTML = html;
        if (dl) {
            dl.innerHTML = names.map(function (n) {
                return '<option value="' + esc(n) + '">';
            }).join('');
        }
        if (cur && names.indexOf(cur) >= 0) {
            sel.value = cur;
            if (inp) inp.value = cur;
        } else if (cur) {
            sel.value = '__custom__';
            if (inp) inp.value = cur;
        } else {
            sel.value = '';
            if (inp) inp.value = '';
        }
    }

    function isPrintToPdfPrinter(name) {
        return /print\s*to\s*pdf|save\s*as\s*pdf|microsoft\s*print\s*to\s*pdf/i.test(String(name || '').trim());
    }

    function printSettingsToPrintRow(settings) {
        return {
            paper_size: settings.paper_size || 'A4',
            paper_width_mm: settings.paper_width_mm,
            paper_height_mm: settings.paper_height_mm,
            margin_left: settings.margin_left,
            margin_right: settings.margin_right,
            margin_top: settings.margin_top,
            margin_bottom: settings.margin_bottom,
            orientation: settings.orientation || 'portrait',
            scale_percent: settings.scale_percent,
            fit_to_page: settings.fit_to_page !== false,
            color_mode: settings.color_mode || 'color'
        };
    }

    function buildLocalPrintSheetCss(settings) {
        var row = printSettingsToPrintRow(settings);
        if (typeof CFG !== 'undefined' && CFG && typeof CFG.buildPrintSheetStylesCss === 'function') {
            return CFG.buildPrintSheetStylesCss(row);
        }
        var sz = String(row.paper_size || 'A4');
        var pw = 210;
        var ph = 297;
        if (sz === 'A5') { pw = 148; ph = 210; }
        else if (sz === 'Letter') { pw = 216; ph = 279; }
        else if (sz === 'Custom' && row.paper_width_mm && row.paper_height_mm) {
            pw = Math.max(20, Number(row.paper_width_mm) || pw);
            ph = Math.max(20, Number(row.paper_height_mm) || ph);
        }
        if (String(row.orientation || '').toLowerCase() === 'landscape') {
            var tmp = pw; pw = ph; ph = tmp;
        }
        var ml = Number(row.margin_left) || 0;
        var mr = Number(row.margin_right) || 0;
        var mt = Number(row.margin_top) || 0;
        var mb = Number(row.margin_bottom) || 0;
        return '@page{margin:' + mt + 'mm ' + mr + 'mm ' + mb + 'mm ' + ml + 'mm;size:' + pw + 'mm ' + ph + 'mm;}' +
            'html,body{margin:0;background:#d4d4d4;}' +
            '.print-sheet-outer{box-sizing:border-box;width:' + pw + 'mm;margin:14px auto;background:#fff;' +
            'box-shadow:0 4px 28px rgba(0,0,0,.22);padding:' + mt + 'mm ' + mr + 'mm ' + mb + 'mm ' + ml + 'mm;}' +
            '.pde-print-page{page-break-after:always;}' +
            '.pde-print-page:last-child{page-break-after:auto;}' +
            '@media print{html,body{background:#fff!important;}.print-sheet-outer{margin:0!important;' +
            'padding:0!important;box-shadow:none!important;width:auto!important;}}';
    }

    function syncPrintPaperCustomFields() {
        var sel = gg('pde_print_paper');
        var wrap = gg('pde_print_custom_dims');
        if (!sel || !wrap) return;
        wrap.style.display = sel.value === 'Custom' ? 'grid' : 'none';
    }

    function readPrintSetupForm() {
        function num(id, fb) {
            var el = gg(id);
            var n = el ? parseFloat(el.value) : NaN;
            return isFinite(n) ? n : fb;
        }
        function int(id, fb) {
            return Math.max(0, Math.round(num(id, fb)));
        }
        var sel = gg('pde_print_printer_sel');
        var inp = gg('pde_print_printer');
        var printer = '';
        if (sel && sel.value === '__custom__') printer = inp ? String(inp.value || '').trim() : '';
        else if (sel && sel.value) printer = sel.value;
        else if (inp) printer = String(inp.value || '').trim();
        return {
            printer_name: printer,
            paper_size: (gg('pde_print_paper') && gg('pde_print_paper').value) || 'A4',
            paper_width_mm: num('pde_print_w_mm', null),
            paper_height_mm: num('pde_print_h_mm', null),
            margin_left: int('pde_print_ml', 10),
            margin_right: int('pde_print_mr', 10),
            margin_top: int('pde_print_mt', 10),
            margin_bottom: int('pde_print_mb', 10),
            orientation: (gg('pde_print_orient') && gg('pde_print_orient').value) || 'portrait',
            scale_percent: Math.min(200, Math.max(25, int('pde_print_scale', 100))),
            copies: Math.max(1, int('pde_print_copies', 1)),
            color_mode: (gg('pde_print_color') && gg('pde_print_color').value) || 'color',
            fit_to_page: !!(gg('pde_print_fit') && gg('pde_print_fit').checked),
            page_range: (gg('pde_print_range') && gg('pde_print_range').value) || 'all'
        };
    }

    function fillPrintSetupForm(settings, opts) {
        opts = opts || {};
        settings = settings || defaultPrintSettings();
        if (!opts.skipPrinter) rebuildPrintPrinterSelect(settings.printer_name);
        var fields = {
            pde_print_paper: settings.paper_size,
            pde_print_w_mm: settings.paper_width_mm != null ? settings.paper_width_mm : '',
            pde_print_h_mm: settings.paper_height_mm != null ? settings.paper_height_mm : '',
            pde_print_ml: settings.margin_left,
            pde_print_mr: settings.margin_right,
            pde_print_mt: settings.margin_top,
            pde_print_mb: settings.margin_bottom,
            pde_print_orient: settings.orientation,
            pde_print_scale: settings.scale_percent,
            pde_print_copies: settings.copies,
            pde_print_color: settings.color_mode,
            pde_print_range: settings.page_range
        };
        Object.keys(fields).forEach(function (id) {
            var el = gg(id);
            if (!el) return;
            el.value = fields[id] === null || fields[id] === undefined ? '' : String(fields[id]);
        });
        var fit = gg('pde_print_fit');
        if (fit) fit.checked = settings.fit_to_page !== false;
        syncPrintPaperCustomFields();
    }

    function getPrintPageIndices(settings) {
        if (settings.page_range === 'current') return [pageNum];
        var out = [];
        for (var i = 0; i < pageCount; i++) out.push(i);
        return out;
    }

    function renderPagesForPrint(flatBytes, pageIndices) {
        return ensurePdfJs().then(function (pdfjs) {
            return pdfjs.getDocument({ data: flatBytes.slice(0) }).promise;
        }).then(function (doc) {
            var images = [];
            var chain = Promise.resolve();
            pageIndices.forEach(function (pi) {
                chain = chain.then(function () {
                    return doc.getPage(pi + 1).then(function (page) {
                        var vp = page.getViewport({ scale: 2 });
                        var c = document.createElement('canvas');
                        c.width = vp.width;
                        c.height = vp.height;
                        var ctx = c.getContext('2d');
                        ctx.fillStyle = '#fff';
                        ctx.fillRect(0, 0, c.width, c.height);
                        return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
                            images.push(c.toDataURL('image/jpeg', 0.92));
                        });
                    });
                });
            });
            return chain.then(function () { return images; });
        });
    }

    function printViaBrowserPopup(images, settings) {
        if (!images || !images.length) return false;
        var row = printSettingsToPrintRow(settings);
        var sheetCss = buildLocalPrintSheetCss(settings);
        var wh = { width: 920, height: 720 };
        if (typeof CFG !== 'undefined' && CFG && typeof CFG.estimatePrintPopupSizePx === 'function') {
            wh = CFG.estimatePrintPopupSizePx(row);
        }
        var popup = window.open('', '_blank',
            'width=' + wh.width + ',height=' + wh.height + ',scrollbars=1,resizable=1');
        if (!popup) {
            alert(t('Pop-up blocked. Allow pop-ups to print.', '弹窗被阻止，请允许弹窗以打印。', '彈出視窗被阻止，請允許彈出以列印。'));
            return false;
        }

        var imgStyle = 'display:block;margin:0 auto;';
        if (settings.fit_to_page !== false) {
            imgStyle += 'max-width:100%;height:auto;object-fit:contain;';
        }
        if (settings.scale_percent && settings.scale_percent !== 100) {
            imgStyle += 'width:' + settings.scale_percent + '%;';
        }
        if (settings.color_mode === 'grayscale') {
            imgStyle += '-webkit-filter:grayscale(100%);filter:grayscale(100%);';
        }

        var pagesHtml = images.map(function (src) {
            return '<div class="pde-print-page"><img src="' + src + '" style="' + imgStyle + '" alt=""></div>';
        }).join('');

        var printerHint = settings.printer_name
            ? '<p class="pde-print-hint">' + esc(t('In the print dialog, choose:', '在打印对话框中选择：', '在列印對話框中選擇：')) +
                ' <strong>' + esc(settings.printer_name) + '</strong></p>'
            : '';

        popup.document.write(
            '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
            '<title>' + esc(t('Print PDF', '打印 PDF', '列印 PDF')) + '</title>' +
            '<style>' + sheetCss +
            '.pde-print-hint{font:13px/1.5 sans-serif;color:#444;text-align:center;margin:12px 0;}' +
            '@media print{.pde-print-hint{display:none!important;}}' +
            '</style></head><body>' +
            printerHint +
            '<div class="print-sheet-outer">' + pagesHtml + '</div>' +
            '<script>(function(){' +
            (typeof printPopupAutoCloseInlineScript === 'function' ? printPopupAutoCloseInlineScript() : '') +
            'window.onload=function(){setTimeout(function(){try{window.print();}catch(e){' +
            'if(typeof __ppClose==="function")__ppClose();}},300);};})();<\/script>' +
            '</body></html>'
        );
        popup.document.close();
        if (typeof wirePrintPopupAutoClose === 'function') wirePrintPopupAutoClose(popup);
        return true;
    }

    function printToPdfFile(bytes) {
        var base = fileName.replace(/\.pdf$/i, '') || 'document';
        dl(new Blob([bytes], { type: 'application/pdf' }), base + '_print.pdf');
        setStatus(t('Saved as PDF.', '已保存为 PDF。', '已儲存為 PDF。'), 'ok');
    }

    function executePrint(settings) {
        if (!pdfBytes) return;
        settings = settings || loadPrintSettings();
        if (settings.printer_name) addKnownPrinterName(settings.printer_name);
        savePrintSettings(settings);

        setStatus(t('Preparing print…', '准备打印…', '準備列印…'), 'work');
        var pageIndices = getPrintPageIndices(settings);

        buildFlattenedPdfBytes().then(function (bytes) {
            if (isPrintToPdfPrinter(settings.printer_name)) {
                printToPdfFile(bytes);
                return null;
            }
            return renderPagesForPrint(bytes, pageIndices).then(function (images) {
                if (!printViaBrowserPopup(images, settings)) {
                    throw new Error(t('Print blocked', '打印被阻止', '列印被阻止'));
                }
                setStatus(t('Print dialog opened.', '已打开打印对话框。', '已開啟列印對話框。'), 'ok');
            });
        }).catch(function (e) {
            setStatus(t('Print failed: ', '打印失败：', '列印失敗：') + (e && e.message || e), 'bad');
        });
    }

    var _printSetupOv = null;

    function closePrintSetupModal() {
        if (_printSetupOv && _printSetupOv.parentNode) _printSetupOv.parentNode.removeChild(_printSetupOv);
        _printSetupOv = null;
    }

    function openPrintSetupModal(opts) {
        opts = opts || {};
        if (!pdfBytes) return;
        closePrintSetupModal();

        var settings = loadPrintSettings();
        _printSetupOv = document.createElement('div');
        _printSetupOv.className = 'pde-print-overlay';
        _printSetupOv.innerHTML =
            '<div class="pde-print-modal" role="dialog" aria-labelledby="pde_print_title">' +
                '<h2 id="pde_print_title">' + esc(t('Print setup', '打印设置', '列印設定')) + '</h2>' +
                '<div class="pde-print-grid">' +
                    '<label class="pde-print-field pde-print-field--full">' +
                        '<span>' + esc(t('Printer', '打印机', '印表機')) + '</span>' +
                        '<div class="pde-print-printer-row">' +
                            '<select id="pde_print_printer_sel"></select>' +
                            '<button type="button" class="ct-btn" id="pde_print_refresh_printers" title="' +
                                esc(t('Refresh list', '刷新列表', '重新整理列表')) + '">↻</button>' +
                        '</div>' +
                        '<input type="text" id="pde_print_printer" list="pde_print_printer_list" placeholder="' +
                            esc(t('Printer name (e.g. Microsoft Print to PDF)', '打印机名称（如 Microsoft Print to PDF）',
                                '印表機名稱（如 Microsoft Print to PDF）')) + '">' +
                        '<datalist id="pde_print_printer_list"></datalist>' +
                        '<small id="pde_print_printer_status"></small>' +
                        '<small>' + esc(t('Includes Print to PDF. Browser print dialog chooses the actual device.',
                            '包含“打印到 PDF”。实际设备在浏览器打印对话框中选择。',
                            '包含「列印到 PDF」。實際裝置在瀏覽器列印對話框中選擇。')) + '</small>' +
                    '</label>' +
                    '<label class="pde-print-field"><span>' + esc(t('Paper', '纸张', '紙張')) + '</span>' +
                        '<select id="pde_print_paper">' +
                            '<option value="A4">A4</option>' +
                            '<option value="A5">A5</option>' +
                            '<option value="Letter">Letter</option>' +
                            '<option value="Custom">' + esc(t('Custom', '自定义', '自訂')) + '</option>' +
                        '</select></label>' +
                    '<label class="pde-print-field"><span>' + esc(t('Orientation', '方向', '方向')) + '</span>' +
                        '<select id="pde_print_orient">' +
                            '<option value="portrait">' + esc(t('Portrait', '纵向', '直向')) + '</option>' +
                            '<option value="landscape">' + esc(t('Landscape', '横向', '橫向')) + '</option>' +
                        '</select></label>' +
                    '<div id="pde_print_custom_dims" class="pde-print-field pde-print-field--full pde-print-custom-dims">' +
                        '<label><span>' + esc(t('Width (mm)', '宽 (mm)', '寬 (mm)')) + '</span>' +
                            '<input type="number" id="pde_print_w_mm" min="20" step="1"></label>' +
                        '<label><span>' + esc(t('Height (mm)', '高 (mm)', '高 (mm)')) + '</span>' +
                            '<input type="number" id="pde_print_h_mm" min="20" step="1"></label>' +
                    '</div>' +
                    '<label class="pde-print-field"><span>' + esc(t('Margin L (mm)', '左边距 (mm)', '左邊距 (mm)')) + '</span>' +
                        '<input type="number" id="pde_print_ml" min="0" step="1"></label>' +
                    '<label class="pde-print-field"><span>' + esc(t('Margin R (mm)', '右边距 (mm)', '右邊距 (mm)')) + '</span>' +
                        '<input type="number" id="pde_print_mr" min="0" step="1"></label>' +
                    '<label class="pde-print-field"><span>' + esc(t('Margin T (mm)', '上边距 (mm)', '上邊距 (mm)')) + '</span>' +
                        '<input type="number" id="pde_print_mt" min="0" step="1"></label>' +
                    '<label class="pde-print-field"><span>' + esc(t('Margin B (mm)', '下边距 (mm)', '下邊距 (mm)')) + '</span>' +
                        '<input type="number" id="pde_print_mb" min="0" step="1"></label>' +
                    '<label class="pde-print-field"><span>' + esc(t('Scale (%)', '缩放 (%)', '縮放 (%)')) + '</span>' +
                        '<input type="number" id="pde_print_scale" min="25" max="200" step="5"></label>' +
                    '<label class="pde-print-field"><span>' + esc(t('Copies', '份数', '份數')) + '</span>' +
                        '<input type="number" id="pde_print_copies" min="1" max="99" step="1"></label>' +
                    '<label class="pde-print-field"><span>' + esc(t('Color', '颜色', '色彩')) + '</span>' +
                        '<select id="pde_print_color">' +
                            '<option value="color">' + esc(t('Color', '彩色', '彩色')) + '</option>' +
                            '<option value="grayscale">' + esc(t('Grayscale', '灰度', '灰階')) + '</option>' +
                        '</select></label>' +
                    '<label class="pde-print-field"><span>' + esc(t('Pages', '页面', '頁面')) + '</span>' +
                        '<select id="pde_print_range">' +
                            '<option value="all">' + esc(t('All pages', '全部页面', '全部頁面')) + '</option>' +
                            '<option value="current">' + esc(t('Current page only', '仅当前页', '僅目前頁')) + '</option>' +
                        '</select></label>' +
                    '<label class="pde-print-field pde-print-check">' +
                        '<input type="checkbox" id="pde_print_fit" checked> ' +
                        esc(t('Fit to page', '适应页面', '適應頁面')) + '</label>' +
                '</div>' +
                '<div class="pde-print-actions">' +
                    '<button type="button" class="ct-btn" id="pde_print_cancel">' + esc(t('Cancel', '取消', '取消')) + '</button>' +
                    '<button type="button" class="ct-btn" id="pde_print_save_setup">' +
                        esc(t('Save setup', '保存设置', '儲存設定')) + '</button>' +
                    '<button type="button" class="ct-btn ct-btn-primary" id="pde_print_go">' +
                        esc(t('Print', '打印', '列印')) + '</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(_printSetupOv);

        fillPrintSetupForm(settings, { skipPrinter: true });
        var cachedNames = mergedPrinterNames(settings.printer_name);
        var hasCachedList = cachedNames.length > PDE_PRINT_TO_PDF_NAMES.length ||
            _pdeCachedSystemPrinters.length > 0;
        if (hasCachedList) {
            rebuildPrintPrinterSelect(settings.printer_name);
            updatePrintPrinterStatus(cachedNames.length, _pdeCachedSystemPrinters.length);
        } else {
            setPrintPrinterSelectLoading(true);
        }
        refreshPrintSetupPrinterList(settings.printer_name, !hasCachedList);

        gg('pde_print_printer_sel').addEventListener('change', function () {
            var sel = gg('pde_print_printer_sel');
            var inp = gg('pde_print_printer');
            if (!sel || !inp) return;
            if (sel.value === '__custom__') {
                if (!inp.value) inp.focus();
            } else if (sel.value) {
                inp.value = sel.value;
            }
        });
        gg('pde_print_paper').addEventListener('change', syncPrintPaperCustomFields);
        gg('pde_print_cancel').addEventListener('click', closePrintSetupModal);
        _printSetupOv.addEventListener('click', function (e) {
            if (e.target === _printSetupOv) closePrintSetupModal();
        });
        gg('pde_print_refresh_printers').addEventListener('click', function () {
            var cur = readPrintSetupForm().printer_name;
            refreshPrintSetupPrinterList(cur, true).then(function () {
                setStatus(t('Printer list refreshed.', '打印机列表已刷新。', '印表機列表已重新整理。'));
            });
        });
        gg('pde_print_save_setup').addEventListener('click', function () {
            var s = readPrintSetupForm();
            if (s.printer_name) addKnownPrinterName(s.printer_name);
            savePrintSettings(s);
            setStatus(t('Print setup saved.', '打印设置已保存。', '列印設定已儲存。'), 'ok');
            closePrintSetupModal();
        });
        gg('pde_print_go').addEventListener('click', function () {
            var s = readPrintSetupForm();
            closePrintSetupModal();
            executePrint(s);
        });

        if (opts.focusPrint && gg('pde_print_go')) gg('pde_print_go').focus();
    }

    // ── UI shell ─────────────────────────────────────────────────
    function ribbonBtn(id, label, title) {
        return '<button type="button" class="pde-rib-btn' + (id === 'select' ? ' active' : '') +
            '" data-pde-tool="' + id + '" title="' + esc(title || label) + '">' + label + '</button>';
    }

    function render() {
        var app = gg('pdfEditorApp');
        if (!app) return;
        app.innerHTML =
            '<div class="pde-app">' +
                '<div class="pde-menubar">' +
                    '<label class="pde-mb-btn pde-open-lbl">' + esc(t('Open', '打开', '打開')) +
                        '<input type="file" id="pde_file" accept="application/pdf,.pdf" hidden></label>' +
                    '<button type="button" class="pde-mb-btn pde-mb-primary" id="pde_save" disabled>' + esc(t('Save PDF', '保存', '儲存')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_print" disabled title="Ctrl+P">' + esc(t('Print', '打印', '列印')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_print_setup" disabled>' + esc(t('Print setup', '打印设置', '列印設定')) + '</button>' +
                    '<span class="pde-mb-sep"></span>' +
                    '<button type="button" class="pde-mb-btn" id="pde_undo" disabled title="Ctrl+Z">↶</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_redo" disabled title="Ctrl+Y">↷</button>' +
                    '<span class="pde-mb-sep"></span>' +
                    '<button type="button" class="pde-mb-btn" id="pde_zoom_out" title="-">−</button>' +
                    '<span id="pde_zoom_label" class="pde-zoom-lbl">100%</span>' +
                    '<button type="button" class="pde-mb-btn" id="pde_zoom_in" title="+">+</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_fit_width">' + esc(t('Fit width', '适宽', '適寬')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_fit_page">' + esc(t('Fit page', '适页', '適頁')) + '</button>' +
                    '<span class="pde-mb-sep"></span>' +
                    '<button type="button" class="pde-mb-btn" id="pde_prev" disabled>◀</button>' +
                    '<span id="pde_page_label" class="pde-page-lbl">—</span>' +
                    '<button type="button" class="pde-mb-btn" id="pde_next" disabled>▶</button>' +
                '</div>' +
                '<div class="pde-ribbon" id="pde_toolbar">' +
                    '<div class="pde-rib-group"><span>' + esc(t('Navigate', '导航', '導覽')) + '</span>' +
                        ribbonBtn('select', '↖', t('Select (V)', '选择 (V)', '選擇 (V)')) +
                        ribbonBtn('hand', '✋', t('Pan (H)', '平移 (H)', '平移 (H)')) +
                    '</div>' +
                    '<div class="pde-rib-group"><span>' + esc(t('Draw', '绘制', '繪製')) + '</span>' +
                        ribbonBtn('pen', '✏️', t('Pen (P)', '画笔 (P)', '畫筆 (P)')) +
                        ribbonBtn('highlight', '🖍', t('Highlight', '荧光笔', '螢光筆')) +
                        ribbonBtn('eraser', '⌫', t('Eraser (E)', '橡皮 (E)', '橡皮 (E)')) +
                    '</div>' +
                    '<div class="pde-rib-group"><span>' + esc(t('Content', '内容', '內容')) + '</span>' +
                        ribbonBtn('text', 'T', t('Text (T)', '文字 (T)', '文字 (T)')) +
                        ribbonBtn('image', '🖼', t('Image', '图片', '圖片')) +
                        ribbonBtn('signature', '✍', t('Sign', '签名', '簽名')) +
                        ribbonBtn('stamp', '🔴', t('Stamp', '图章', '圖章')) +
                    '</div>' +
                    '<div class="pde-rib-group"><span>' + esc(t('Shapes', '形状', '形狀')) + '</span>' +
                        ribbonBtn('rect', '▭', t('Rectangle', '矩形', '矩形')) +
                        ribbonBtn('ellipse', '○', t('Ellipse', '椭圆', '橢圓')) +
                        ribbonBtn('line', '／', t('Line', '直线', '直線')) +
                        ribbonBtn('arrow', '➤', t('Arrow', '箭头', '箭頭')) +
                    '</div>' +
                '</div>' +
                '<div id="pde_empty" class="pde-empty">' +
                    '<div class="pde-empty-icon">📄</div>' +
                    '<h2>' + esc(t('PDF Editor', 'PDF 编辑器', 'PDF 編輯器')) + '</h2>' +
                    '<p>' + esc(t('Open a PDF to annotate, sign, and export — like a lightweight Acrobat.', '打开 PDF 进行标注、签名并导出 — 轻量版 Acrobat 体验。', '打開 PDF 進行標註、簽名並匯出 — 輕量版 Acrobat 體驗。')) + '</p>' +
                    '<label class="ct-btn ct-btn-primary pde-open-lbl">' + esc(t('Open PDF…', '打开 PDF…', '打開 PDF…')) +
                        '<input type="file" id="pde_file_empty" accept="application/pdf,.pdf" hidden></label>' +
                '</div>' +
                '<div id="pde_shell" class="pde-shell" style="display:none;">' +
                    '<aside class="pde-thumbs-panel"><div class="pde-thumbs-head">' + esc(t('Pages', '页面', '頁面')) + '</div><div id="pde_thumbs" class="pde-thumbs"></div></aside>' +
                    '<div class="pde-center">' +
                        '<div id="pde_viewport" class="pde-viewport">' +
                            '<div id="pde_stage" class="pde-stage">' +
                                '<canvas id="pde_bg"></canvas>' +
                                '<canvas id="pde_ol"></canvas>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<aside class="pde-props-panel">' +
                        '<div class="pde-props-head">' + esc(t('Properties', '属性', '屬性')) + '</div>' +
                        '<div id="pde_props_body" class="pde-props-body"></div>' +
                    '</aside>' +
                '</div>' +
                '<div id="pde_status" class="pde-statusbar"></div>' +
            '</div>';
        wireUi();
        refreshPropsPanel();
        preloadPrintersForEditor();
    }

    function wireUi() {
        bgCanvas = gg('pde_bg');
        olCanvas = gg('pde_ol');
        viewportEl = gg('pde_viewport');
        stageEl = gg('pde_stage');

        function onFilePick(e) {
            var f = e.target.files && e.target.files[0];
            if (f) loadPdfFile(f);
            e.target.value = '';
        }
        gg('pde_file').addEventListener('change', onFilePick);
        var fe = gg('pde_file_empty');
        if (fe) fe.addEventListener('change', onFilePick);

        gg('pde_save').addEventListener('click', exportPdf);
        var printBtn = gg('pde_print');
        if (printBtn) printBtn.addEventListener('click', function () { openPrintSetupModal({ focusPrint: true }); });
        var printSetupBtn = gg('pde_print_setup');
        if (printSetupBtn) printSetupBtn.addEventListener('click', function () { openPrintSetupModal({}); });
        gg('pde_undo').addEventListener('click', undo);
        gg('pde_redo').addEventListener('click', redo);

        gg('pde_prev').addEventListener('click', function () {
            if (pageNum <= 0) return;
            pageNum--; selectedIdx = -1; renderPage();
        });
        gg('pde_next').addEventListener('click', function () {
            if (pageNum >= pageCount - 1) return;
            pageNum++; selectedIdx = -1; renderPage();
        });

        gg('pde_zoom_in').addEventListener('click', function () {
            if (zoomMode !== 'custom') zoomCustom = 1;
            zoomMode = 'custom';
            zoomCustom = Math.min(3, zoomCustom + 0.15);
            renderPage();
        });
        gg('pde_zoom_out').addEventListener('click', function () {
            if (zoomMode !== 'custom') zoomCustom = 1;
            zoomMode = 'custom';
            zoomCustom = Math.max(0.35, zoomCustom - 0.15);
            renderPage();
        });
        gg('pde_fit_width').addEventListener('click', function () {
            zoomMode = 'fitWidth'; zoomCustom = 1; renderPage();
        });
        gg('pde_fit_page').addEventListener('click', function () {
            zoomMode = 'fitPage'; zoomCustom = 1; renderPage();
        });

        gg('pde_toolbar').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-pde-tool]');
            if (!btn) return;
            var id = btn.getAttribute('data-pde-tool');
            if (id === 'image') {
                var inp = document.createElement('input');
                inp.type = 'file'; inp.accept = 'image/*';
                inp.onchange = function () {
                    var f = inp.files && inp.files[0];
                    if (!f) return;
                    var fr = new FileReader();
                    fr.onload = function () {
                        var img = new Image();
                        img.onload = function () {
                            pendingImageAspect = img.width / img.height;
                            pendingImageUrl = fr.result;
                            placeMode = 'image';
                            setTool('select', { keepPlace: true, keepSelect: true });
                            olCanvas.classList.add('pde-cursor-place');
                            setStatus(t('Click to place image.', '点击放置图片。', '點擊放置圖片。'));
                        };
                        img.src = fr.result;
                    };
                    fr.readAsDataURL(f);
                };
                inp.click();
                return;
            }
            if (id === 'signature') { openSignaturePad(); return; }
            setTool(id);
        });

        olCanvas.addEventListener('pointerdown', onPointerDown);
        olCanvas.addEventListener('pointermove', onPointerMove);
        olCanvas.addEventListener('pointerup', onPointerUp);
        olCanvas.addEventListener('pointercancel', onPointerUp);
        olCanvas.addEventListener('dblclick', onDoubleClick);

        document.addEventListener('keydown', onKeyDown);
        window.addEventListener('resize', function () { if (pdfJsDoc) renderPage(); });
    }

    function onKeyDown(e) {
        if (!gg('pdfEditorSection') || gg('pdfEditorSection').style.display === 'none') return;
        if (textEditorEl) return;
        if (document.activeElement && /input|textarea|select/i.test(document.activeElement.tagName)) return;

        var k = e.key.toLowerCase();
        if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
        if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
        if ((e.ctrlKey || e.metaKey) && k === 'c') { e.preventDefault(); copySelected(); return; }
        if ((e.ctrlKey || e.metaKey) && k === 'v') { e.preventDefault(); pasteClip(); return; }
        if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); exportPdf(); return; }
        if ((e.ctrlKey || e.metaKey) && k === 'p') { e.preventDefault(); openPrintSetupModal({ focusPrint: true }); return; }

        if (!e.ctrlKey && !e.metaKey) {
            var map = { v: 'select', h: 'hand', p: 'pen', e: 'eraser', t: 'text' };
            if (map[k]) setTool(map[k]);
        }
    }

    function open() {
        if (typeof showOnly === 'function') showOnly('pdfEditorSection');
        render();
    }

    window.PDFEDITOR = { open: open };
})();
