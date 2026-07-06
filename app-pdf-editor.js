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
    var CDN_TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    var CDN_JSPDF = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
    var LS_SIG_KEY = 'joyful_pdf_editor_sig_v1';
    var LS_SIG_TYPE_STYLE = 'joyful_pdf_editor_sig_type_style_v1';
    var LS_PRINT_KEY = 'joyful_pdf_editor_print_settings_v1';
    var PRINTERS_LS_KEY = 'jsm_known_printers_v1';
    var LS_STAMPS_KEY = 'joyful_pdf_editor_stamps_v1';
    var LS_PDE_AUTHOR_KEY = 'joyful_pdf_editor_author_v1';
    var BUILTIN_STAMPS = [
        { id: 'approved', text: 'APPROVED', color: '#dc2626' },
        { id: 'received', text: 'RECEIVED', color: '#2563eb' },
        { id: 'copy', text: 'COPY', color: '#7c3aed' },
        { id: 'void', text: 'VOID', color: '#111827' },
        { id: 'confidential', text: 'CONFIDENTIAL', color: '#b45309' },
        { id: 'date', text: '{date}', color: '#dc2626' },
        { id: 'datetime', text: '{date} {time}', color: '#dc2626' },
        { id: 'clinic', text: '{clinic}', color: '#0f766e' },
        { id: 'user', text: '{user}', color: '#0f766e' }
    ];
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
    function ensureTesseract() {
        if (window.Tesseract) return Promise.resolve(window.Tesseract);
        return loadScript(CDN_TESSERACT).then(function () { return window.Tesseract; });
    }
    function ensureJsPdf() {
        if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
        return loadScript(CDN_JSPDF).then(function () {
            if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF missing');
            return window.jspdf.jsPDF;
        });
    }
    function numVal(v) { var n = parseFloat(v); return isNaN(n) ? NaN : n; }
    function fmtBytes(n) {
        n = Number(n) || 0;
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(2) + ' MB';
    }

    function getPdeAuthor() {
        try {
            var stored = localStorage.getItem(LS_PDE_AUTHOR_KEY);
            if (stored && String(stored).trim()) return String(stored).trim();
        } catch (e) {}
        if (typeof loggedInUserName !== 'undefined' && loggedInUserName) return loggedInUserName;
        if (typeof currentName !== 'undefined' && currentName) return currentName;
        if (typeof currentUserId !== 'undefined' && currentUserId) return currentUserId;
        return t('Staff', '工作人员', '工作人員');
    }

    function setPdeAuthor(name) {
        try { localStorage.setItem(LS_PDE_AUTHOR_KEY, String(name || '').trim()); } catch (e) {}
    }

    function pdeClinicLabel() {
        if (typeof currentClinicLabel !== 'undefined' && currentClinicLabel) return currentClinicLabel;
        if (typeof currentClinicId !== 'undefined' && currentClinicId &&
            typeof clinicRecordFromId === 'function') {
            var rec = clinicRecordFromId(currentClinicId);
            if (rec && typeof clinicDisplayName === 'function') return clinicDisplayName(rec);
        }
        return '';
    }

    function resolveStampTokens(raw) {
        var s = String(raw || '');
        var now = new Date();
        var dateStr = now.toISOString().slice(0, 10);
        var timeStr = now.toTimeString().slice(0, 5);
        s = s.replace(/\{date\}/gi, dateStr);
        s = s.replace(/\{time\}/gi, timeStr);
        s = s.replace(/\{user\}/gi, getPdeAuthor());
        s = s.replace(/\{clinic\}/gi, pdeClinicLabel() || getPdeAuthor());
        return s.trim();
    }

    function withAnnMeta(ann) {
        if (!ann) return ann;
        if (!ann.author) ann.author = getPdeAuthor();
        if (!ann.createdAt) ann.createdAt = new Date().toISOString();
        return ann;
    }

    /** Size a sticky note (normalized 0–1) to fit its text on the current overlay canvas. */
    function measureNoteNormSize(ann) {
        var fs = Math.round((ann && ann.size) || props.fontSize || 11);
        var font = (ann && ann.fontFamily) || props.fontFamily || 'sans-serif';
        var lines = String((ann && ann.text) || ' ').split('\n').slice(0, 14);
        var pad = 10;
        var maxW = 60;
        var lineH = fs * 1.32;
        var maxLinePx = 0;
        if (olCtx && olCanvas) {
            olCtx.save();
            olCtx.font = fs + 'px ' + font;
            lines.forEach(function (line) {
                maxLinePx = Math.max(maxLinePx, olCtx.measureText(line.slice(0, 100)).width);
            });
            olCtx.restore();
        } else {
            lines.forEach(function (line) {
                maxLinePx = Math.max(maxLinePx, line.length * fs * 0.52);
            });
        }
        var boxW = Math.min(380, Math.max(88, maxLinePx + pad * 2));
        var boxH = Math.max(44, lines.length * lineH + pad * 2);
        var cw = olCanvas ? olCanvas.width : 800;
        var ch = olCanvas ? olCanvas.height : 1100;
        return {
            w: Math.min(0.5, Math.max(0.1, boxW / cw)),
            h: Math.min(0.4, Math.max(0.055, boxH / ch))
        };
    }

    function normalizeNoteAnn(ann) {
        if (!ann || ann.type !== 'note') return ann;
        if (!ann.color) ann.color = '#fef08a';
        if (ann.opacity == null) ann.opacity = 0.95;
        if (!ann.size) ann.size = props.fontSize || 11;
        if (!ann.fontFamily) ann.fontFamily = props.fontFamily || 'sans-serif';
        var dims = measureNoteNormSize(ann);
        ann.w = dims.w;
        ann.h = dims.h;
        return ann;
    }

    function formatAnnMetaLine(ann) {
        if (!ann || (!ann.author && !ann.createdAt)) return '';
        var parts = [];
        if (ann.author) parts.push(ann.author);
        if (ann.createdAt) {
            try {
                parts.push(new Date(ann.createdAt).toLocaleString());
            } catch (e) {
                parts.push(ann.createdAt);
            }
        }
        return parts.join(' · ');
    }

    function loadCustomStamps() {
        try {
            var raw = localStorage.getItem(LS_STAMPS_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) { return []; }
    }

    function saveCustomStamps(list) {
        try { localStorage.setItem(LS_STAMPS_KEY, JSON.stringify(list || [])); } catch (e) {}
    }

    function allStampPresets() {
        return BUILTIN_STAMPS.concat(loadCustomStamps());
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

    function readFileArrayBuffer(file) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = function () { reject(fr.error || new Error('read failed')); };
            fr.readAsArrayBuffer(file);
        });
    }

    /** Parse "1-3,5,8-9" → 0-based unique indices within [0..count-1]. */
    function parsePageRange(str, count) {
        var out = [], seen = {};
        String(str || '').split(',').forEach(function (part) {
            part = part.trim();
            if (!part) return;
            var seg = part.split('-');
            if (seg.length === 1) {
                var n = parseInt(seg[0], 10);
                if (n >= 1 && n <= count && !seen[n]) { seen[n] = 1; out.push(n - 1); }
            } else {
                var a = parseInt(seg[0], 10), b = parseInt(seg[1], 10);
                if (isNaN(a) || isNaN(b)) return;
                if (a > b) { var tmp = a; a = b; b = tmp; }
                for (var i = a; i <= b; i++) {
                    if (i >= 1 && i <= count && !seen[i]) { seen[i] = 1; out.push(i - 1); }
                }
            }
        });
        return out;
    }

    function pdfLibAddBufferToDoc(PDFLib, outDoc, buf) {
        return loadPdfLibDocument(buf).then(function (src) {
            return outDoc.copyPages(src, src.getPageIndices()).then(function (pages) {
                pages.forEach(function (pg) { outDoc.addPage(pg); });
            });
        });
    }

    var pdfPassword = null;
    var _pdfPasswordOv = null;

    function isPdfPasswordError(err) {
        if (!err) return false;
        if (err.name === 'PasswordException' || err.code === 1 || err.code === 2) return true;
        var msg = String(err.message || err || '').toLowerCase();
        return msg.indexOf('password') >= 0 || msg.indexOf('encrypted') >= 0 ||
            msg.indexOf('needs password') >= 0 || msg.indexOf('incorrect password') >= 0;
    }

    function closePdfPasswordModal() {
        if (_pdfPasswordOv && _pdfPasswordOv.parentNode) {
            _pdfPasswordOv.parentNode.removeChild(_pdfPasswordOv);
        }
        _pdfPasswordOv = null;
    }

    function promptPdfPassword(wrongPassword) {
        closePdfPasswordModal();
        return new Promise(function (resolve, reject) {
            _pdfPasswordOv = document.createElement('div');
            _pdfPasswordOv.className = 'pde-print-overlay';
            _pdfPasswordOv.innerHTML =
                '<div class="pde-print-modal" role="dialog">' +
                    '<h2>' + esc(t('PDF password', 'PDF 密码', 'PDF 密碼')) + '</h2>' +
                    '<p class="pde-pages-hint">' + esc(wrongPassword
                        ? t('Incorrect password. Try again.', '密码错误，请重试。', '密碼錯誤，請重試。')
                        : t('This PDF is password-protected. Enter the password to open it.', '此 PDF 已加密，请输入密码打开。', '此 PDF 已加密，請輸入密碼開啟。')) +
                    '</p>' +
                    '<label class="pde-print-field pde-print-field--full"><span>' +
                        esc(t('Password', '密码', '密碼')) + '</span>' +
                        '<input id="pde_pdf_pw_input" type="password" autocomplete="current-password"></label>' +
                    '<div class="pde-print-actions">' +
                        '<button type="button" class="ct-btn" id="pde_pdf_pw_cancel">' +
                            esc(t('Cancel', '取消', '取消')) + '</button>' +
                        '<button type="button" class="ct-btn ct-btn-primary" id="pde_pdf_pw_ok">' +
                            esc(t('Unlock', '解锁', '解鎖')) + '</button>' +
                    '</div></div>';
            document.body.appendChild(_pdfPasswordOv);
            var inp = gg('pde_pdf_pw_input');
            function submit() {
                var pw = inp ? String(inp.value || '') : '';
                if (!pw) {
                    if (inp) inp.focus();
                    return;
                }
                closePdfPasswordModal();
                resolve(pw);
            }
            gg('pde_pdf_pw_cancel').addEventListener('click', function () {
                closePdfPasswordModal();
                reject(new Error(t('Password required.', '需要密码。', '需要密碼。')));
            });
            gg('pde_pdf_pw_ok').addEventListener('click', submit);
            if (inp) {
                inp.addEventListener('keydown', function (e) {
                    if (e.key === 'Enter') { e.preventDefault(); submit(); }
                    if (e.key === 'Escape') {
                        closePdfPasswordModal();
                        reject(new Error(t('Password required.', '需要密码。', '需要密碼。')));
                    }
                });
                inp.focus();
            }
        });
    }

    function getPdfJsDocument(data, opts) {
        opts = opts || {};
        var bytes = data && data.slice ? data.slice(0) : data;
        var pwdRef = { value: opts.password != null ? opts.password : pdfPassword };
        return ensurePdfJs().then(function (pdfjs) {
            return new Promise(function (resolve, reject) {
                var docOpts = { data: bytes };
                if (pwdRef.value) docOpts.password = pwdRef.value;
                var task = pdfjs.getDocument(docOpts);
                var settled = false;
                function finish(err, doc) {
                    if (settled) return;
                    settled = true;
                    if (err) reject(err);
                    else resolve(doc);
                }
                task.onPassword = function (updatePassword, reason) {
                    promptPdfPassword(reason === 2).then(function (pw) {
                        pwdRef.value = pw;
                        if (opts.setSessionPassword !== false && !opts.isCompare) pdfPassword = pw;
                        updatePassword(pw);
                    }, function (err) {
                        try { task.destroy(); } catch (e) {}
                        finish(err || new Error(t('Password required.', '需要密码。', '需要密碼。')));
                    });
                };
                task.promise.then(function (doc) {
                    if (opts.setSessionPassword !== false && !opts.isCompare && pwdRef.value) {
                        pdfPassword = pwdRef.value;
                    }
                    if (opts.pwdRef) opts.pwdRef.value = pwdRef.value;
                    finish(null, doc);
                }).catch(function (err) {
                    if (!pwdRef.value && isPdfPasswordError(err)) {
                        promptPdfPassword(false).then(function (pw) {
                            pwdRef.value = pw;
                            if (opts.setSessionPassword !== false && !opts.isCompare) pdfPassword = pw;
                            if (opts.pwdRef) opts.pwdRef.value = pw;
                            return getPdfJsDocument(data, Object.assign({}, opts, { password: pw }));
                        }).then(function (doc) { finish(null, doc); }, finish);
                    } else {
                        finish(err);
                    }
                });
            });
        });
    }

    function loadPdfLibDocument(bytes, opts) {
        opts = opts || {};
        var buf = bytes && bytes.slice ? bytes.slice(0) : bytes;
        return ensurePdfLib().then(function (PDFLib) {
            function attempt(loadOpts) {
                return PDFLib.PDFDocument.load(buf, loadOpts || {});
            }
            var loadOpts = {};
            var pwd = opts.password != null ? opts.password : pdfPassword;
            if (pwd) loadOpts.password = pwd;
            if (opts.ignoreEncryption) loadOpts.ignoreEncryption = true;
            return attempt(loadOpts).catch(function (err) {
                if (opts.ignoreEncryption || pwd || !isPdfPasswordError(err)) throw err;
                return promptPdfPassword(false).then(function (pw) {
                    if (opts.setSessionPassword !== false) pdfPassword = pw;
                    return attempt({ password: pw });
                });
            });
        });
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

    var textLayerEl = null;
    /** @type {Object<number,string>} */
    var ocrResultByPage = {};
    var ocrLang = 'eng+chi_tra';
    var ocrPreview = null;
    var ocrBusy = false;

    var searchHits = [];
    var searchHitIdx = -1;
    var searchQuery = '';
    var pdfOutlineFlat = [];
    var thumbDragFrom = null;

    var pdfFormFields = [];
    var pdfFormValues = {};
    var pendingStampText = null;
    var pendingStampColor = '#dc2626';

    var PDF_DOC_BUCKET = 'patient-documents';
    var pdePatient = null;
    var pdeDocMeta = null;
    var pdeDirty = false;
    var _batchOv = null;
    var _templateOv = null;
    var _savePatientOv = null;
    var _linkPatientOv = null;

    var viewMode = 'single';
    var canvasInvert = false;
    var compareState = null;
    var _shortcutsOv = null;
    var _compareOv = null;
    var PDE_RECENT_MAX = 6;
    var PDE_RECENT_MAX_BYTES = 12 * 1024 * 1024;
    var _pdeNavGuardWired = false;
    var _pdeBeforeUnloadWired = false;
    var _pdeKeydownWired = false;
    var _pdeResizeWired = false;
    var eraserStrokeActive = false;

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
        pdeMarkDirty();
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
        pdeMarkDirty();
    }
    function redo() {
        if (!redoStack.length) return;
        undoStack.push(JSON.stringify(annByPage));
        annByPage = JSON.parse(redoStack.pop());
        selectedIdx = -1;
        syncHistoryButtons();
        redrawOverlay();
        refreshPropsPanel();
        pdeMarkDirty();
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

    // ── text layer (embedded PDF text selection) ─────────────────
    function syncTextLayerMode() {
        if (!textLayerEl || !olCanvas) return;
        var textActive = tool === 'textselect';
        textLayerEl.classList.toggle('active', textActive);
        olCanvas.style.pointerEvents = textActive ? 'none' : '';
    }

    function buildTextLayer(page, vp) {
        if (!textLayerEl || !pdfJsDoc) return Promise.resolve();
        textLayerEl.innerHTML = '';
        return page.getTextContent({ includeMarkedContent: false }).then(function (tc) {
            var util = window.pdfjsLib && window.pdfjsLib.Util;
            var items = tc.items || [];
            if (!items.length) {
                textLayerEl.setAttribute('data-empty', '1');
                return;
            }
            textLayerEl.removeAttribute('data-empty');
            items.forEach(function (textItem) {
                if (!textItem.str) return;
                var tx = util
                    ? util.transform(vp.transform, textItem.transform)
                    : textItem.transform;
                var angle = Math.atan2(tx[1], tx[0]);
                var fontHeight = Math.hypot(tx[2], tx[3]) || Math.abs(tx[0]) || 12;
                var fontAscent = fontHeight * 0.85;
                var span = document.createElement('span');
                span.textContent = textItem.str;
                span.style.left = tx[4] + 'px';
                span.style.top = (tx[5] - fontAscent) + 'px';
                span.style.fontSize = fontHeight + 'px';
                span.style.fontFamily = 'sans-serif';
                if (angle) span.style.transform = 'rotate(' + angle + 'rad)';
                textLayerEl.appendChild(span);
            });
        }).catch(function () {
            textLayerEl.setAttribute('data-empty', '1');
        });
    }

    function getNativeTextSelection() {
        try {
            var sel = window.getSelection();
            if (!sel || sel.isCollapsed || !textLayerEl) return '';
            var anchor = sel.anchorNode;
            if (!anchor || !textLayerEl.contains(anchor)) return '';
            return String(sel.toString() || '').trim();
        } catch (e) {
            return '';
        }
    }

    function copyTextToClipboard(text) {
        text = String(text || '').trim();
        if (!text) {
            setStatus(t('Nothing to copy.', '没有可复制的内容。', '沒有可複製的內容。'), 'bad');
            return;
        }
        function ok() {
            setStatus(t('Copied to clipboard.', '已复制到剪贴板。', '已複製到剪貼簿。'), 'ok');
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(ok).catch(function () {
                fallbackCopy(text);
                ok();
            });
            return;
        }
        fallbackCopy(text);
        ok();
    }

    function fallbackCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        ta.remove();
    }

    function copySelectedOrOcrText() {
        var sel = getNativeTextSelection();
        if (sel) { copyTextToClipboard(sel); return; }
        var ocr = ocrResultByPage[pageNum];
        if (ocr) { copyTextToClipboard(ocr); return; }
        setStatus(t('Select text or run OCR first.', '请先选择文字或运行 OCR。', '請先選擇文字或執行 OCR。'), 'bad');
    }

    function setOcrResult(text, pi) {
        var idx = pi != null ? pi : pageNum;
        ocrResultByPage[idx] = String(text || '').trim();
        if (idx === pageNum) {
            var ta = gg('pde_ocr_result');
            if (ta) ta.value = ocrResultByPage[idx];
            refreshPropsPanel();
        }
    }

    function cropBgCanvasRect(nx, ny, nw, nh) {
        if (!bgCanvas) return null;
        var x = Math.round(Math.max(0, nx * bgCanvas.width));
        var y = Math.round(Math.max(0, ny * bgCanvas.height));
        var w = Math.round(Math.max(1, nw * bgCanvas.width));
        var h = Math.round(Math.max(1, nh * bgCanvas.height));
        if (x + w > bgCanvas.width) w = bgCanvas.width - x;
        if (y + h > bgCanvas.height) h = bgCanvas.height - y;
        if (w < 8 || h < 8) return null;
        var c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(bgCanvas, x, y, w, h, 0, 0, w, h);
        return c;
    }

    function runOcrOnCanvas(sourceCanvas, pageIdx) {
        if (!sourceCanvas || ocrBusy) return Promise.resolve('');
        ocrBusy = true;
        setStatus(t('OCR in progress…', 'OCR 识别中…', 'OCR 辨識中…'), 'work');
        var prog = gg('pde_ocr_progress');
        if (prog) prog.textContent = '0%';
        return ensureTesseract().then(function (Tesseract) {
            return Tesseract.recognize(sourceCanvas, ocrLang, {
                logger: function (m) {
                    if (m.status === 'recognizing text' && prog) {
                        prog.textContent = Math.round((m.progress || 0) * 100) + '%';
                    }
                }
            });
        }).then(function (res) {
            var text = (res && res.data && res.data.text) ? res.data.text : '';
            setOcrResult(text, pageIdx);
            if (pageIdx == null || pageIdx === pageNum) {
                setStatus(
                    text.trim()
                        ? t('OCR complete.', 'OCR 完成。', 'OCR 完成。')
                        : t('OCR found no text.', 'OCR 未识别到文字。', 'OCR 未辨識到文字。'),
                    text.trim() ? 'ok' : 'bad'
                );
            }
            return text;
        }).catch(function (e) {
            if (pageIdx == null || pageIdx === pageNum) {
                setStatus(t('OCR failed: ', 'OCR 失败：', 'OCR 失敗：') + (e && e.message || e), 'bad');
            }
            return '';
        }).finally(function () {
            ocrBusy = false;
            if (prog && (pageIdx == null || pageIdx === pageNum)) prog.textContent = '';
        });
    }

    function runOcrFullPage() {
        if (!bgCanvas || !pdfJsDoc) return;
        runOcrOnCanvas(bgCanvas);
    }

    function runOcrRegionNorm(nx, ny, nw, nh) {
        var c = cropBgCanvasRect(nx, ny, nw, nh);
        if (!c) {
            setStatus(t('Selection too small — drag a larger area or use OCR page.', '选区太小 — 请拖选更大区域或使用整页 OCR。', '選取太小 — 請拖選更大區域或使用整頁 OCR。'), 'bad');
            return;
        }
        runOcrOnCanvas(c);
    }

    function drawOcrPreviewRect() {
        if (!ocrPreview || !olCtx || !olCanvas) return;
        var x1 = Math.min(ocrPreview.x, ocrPreview.x2);
        var y1 = Math.min(ocrPreview.y, ocrPreview.y2);
        var x2 = Math.max(ocrPreview.x, ocrPreview.x2);
        var y2 = Math.max(ocrPreview.y, ocrPreview.y2);
        var tl = normToCanvas(x1, y1);
        var br = normToCanvas(x2, y2);
        olCtx.save();
        olCtx.strokeStyle = '#1473e6';
        olCtx.lineWidth = 2;
        olCtx.setLineDash([6, 4]);
        olCtx.fillStyle = 'rgba(20, 115, 230, 0.12)';
        olCtx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        olCtx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        olCtx.restore();
    }

    // ── render ───────────────────────────────────────────────────
    function renderPage() {
        if (!pdfJsDoc) return Promise.resolve();
        if (compareState) return renderCompareView();
        if (viewMode !== 'single') return renderMultiPageView();
        if (!bgCanvas || !olCanvas) return Promise.resolve();
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
            return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
                return buildTextLayer(page, vp);
            });
        }).then(function () {
            syncTextLayerMode();
            redrawOverlay();
            updatePageLabel();
            updateZoomLabel();
            refreshThumbsActive();
            closeTextEditor(true);
            if (tool === 'textselect' || tool === 'ocr') refreshPropsPanel();
        });
    }

    function redrawOverlay() {
        if (!olCtx || !olCanvas) return;
        olCtx.clearRect(0, 0, olCanvas.width, olCanvas.height);
        pageAnns().forEach(function (ann, i) { drawAnn(ann, i === selectedIdx); });
        if (currentStroke) drawStrokePath(currentStroke, false);
        if (shapePreview) drawShapeAnn(shapePreview, false, true);
        if (ocrPreview) drawOcrPreviewRect();
        drawSearchHighlights();
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
        if (ann.type === 'redact') {
            olCtx.fillStyle = '#ffffff';
            olCtx.fillRect(tl.x, tl.y, w, h);
            olCtx.strokeStyle = preview ? '#dc2626' : (sel ? '#1473e6' : 'rgba(220,38,38,0.35)');
            olCtx.lineWidth = preview ? 2 : 1;
            olCtx.setLineDash(preview ? [6, 4] : [4, 3]);
            olCtx.strokeRect(tl.x, tl.y, w, h);
            olCtx.setLineDash([]);
            if (sel && !preview) drawSelectionHandles(tl.x, tl.y, w, h);
            olCtx.restore();
            return;
        }
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
        } else if (ann.type === 'underline' || ann.type === 'strikeout') {
            var br2 = normToCanvas(ann.x + ann.w, ann.y + ann.h);
            var lx1 = Math.min(tl.x, br2.x);
            var lx2 = Math.max(tl.x, br2.x);
            var ly = ann.type === 'strikeout' ? (tl.y + br2.y) / 2 : Math.max(tl.y, br2.y) + Math.max(2, (ann.width || 2));
            olCtx.beginPath();
            olCtx.moveTo(lx1, ly);
            olCtx.lineTo(lx2, ly);
            olCtx.stroke();
        } else if (ann.type === 'callout') {
            drawCalloutAnn(ann, sel, preview);
            olCtx.restore();
            return;
        }
        if (sel && !preview) drawSelectionHandles(tl.x, tl.y, w, h);
        olCtx.restore();
    }

    function drawCalloutAnn(ann, sel, preview) {
        var box = normToCanvas(ann.x, ann.y);
        var bw = Math.max(8, ann.w * olCanvas.width);
        var bh = Math.max(8, ann.h * olCanvas.height);
        var anchor = normToCanvas(ann.ax != null ? ann.ax : ann.x, ann.ay != null ? ann.ay : ann.y + ann.h);
        var bx = box.x;
        var by = box.y;
        var ca = parseColorAlpha(ann.color || '#111827', ann.opacity);
        olCtx.save();
        olCtx.strokeStyle = preview ? '#1473e6' : (sel ? '#1473e6' : ca.hex);
        olCtx.fillStyle = preview ? 'rgba(20,115,230,0.08)' : 'rgba(255,255,255,0.94)';
        olCtx.lineWidth = ann.width || 2;
        olCtx.setLineDash(preview ? [6, 4] : []);
        olCtx.fillRect(bx, by, bw, bh);
        olCtx.strokeRect(bx, by, bw, bh);
        olCtx.setLineDash([]);
        var cx = bx + bw / 2;
        var cy = by + bh / 2;
        olCtx.beginPath();
        olCtx.moveTo(anchor.x, anchor.y);
        olCtx.lineTo(cx, cy);
        olCtx.stroke();
        olCtx.fillStyle = ca.hex;
        olCtx.beginPath();
        olCtx.arc(anchor.x, anchor.y, 4, 0, Math.PI * 2);
        olCtx.fill();
        if (ann.text) {
            olCtx.fillStyle = ca.hex;
            olCtx.font = Math.round((ann.size || 14) * viewportScale) + 'px ' + (ann.fontFamily || 'sans-serif');
            olCtx.textAlign = 'left';
            olCtx.textBaseline = 'top';
            String(ann.text).split('\n').forEach(function (line, li) {
                olCtx.fillText(line, bx + 6, by + 6 + li * (ann.size || 14) * viewportScale * 1.2);
            });
        }
        if (sel && !preview) drawSelectionHandles(bx, by, bw, bh);
        olCtx.restore();
    }

    function drawNoteAnn(ann, sel) {
        var dims = measureNoteNormSize(ann);
        var nw = ann.w || dims.w;
        var nh = ann.h || dims.h;
        // Upgrade legacy tiny icon-only notes (old 3.5% box) to fit text.
        if (ann.text && (!ann.w || ann.w < 0.06)) {
            ann.w = dims.w;
            ann.h = dims.h;
            nw = ann.w;
            nh = ann.h;
        }
        var st = normToCanvas(ann.x, ann.y);
        var sw = nw * olCanvas.width;
        var sh = nh * olCanvas.height;
        var pad = 8;
        olCtx.save();
        olCtx.fillStyle = ann.color || '#fef08a';
        olCtx.strokeStyle = sel ? '#1473e6' : '#ca8a04';
        olCtx.lineWidth = sel ? 2 : 1;
        olCtx.globalAlpha = ann.opacity != null ? ann.opacity : 0.95;
        olCtx.fillRect(st.x, st.y, sw, sh);
        olCtx.strokeRect(st.x, st.y, sw, sh);
        // Folded corner (visual cue only — no "!" icon).
        var fold = Math.min(16, sw * 0.18, sh * 0.22);
        if (fold > 4) {
            olCtx.beginPath();
            olCtx.moveTo(st.x + sw - fold, st.y);
            olCtx.lineTo(st.x + sw, st.y);
            olCtx.lineTo(st.x + sw, st.y + fold);
            olCtx.closePath();
            olCtx.fillStyle = '#fde047';
            olCtx.fill();
            olCtx.stroke();
        }
        if (ann.text) {
            var fs = Math.round((ann.size || 11) * viewportScale);
            olCtx.font = fs + 'px ' + (ann.fontFamily || 'sans-serif');
            olCtx.fillStyle = '#713f12';
            olCtx.textAlign = 'left';
            olCtx.textBaseline = 'top';
            var lines = String(ann.text).split('\n').slice(0, 14);
            var lh = fs * 1.32;
            lines.forEach(function (line, li) {
                olCtx.fillText(line.slice(0, 100), st.x + pad, st.y + pad + li * lh);
            });
        }
        if (sel) drawSelectionHandles(st.x, st.y, sw, sh);
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
        if (ann.type === 'note') {
            drawNoteAnn(ann, sel);
            return;
        }
        if (ann.type === 'callout') {
            drawCalloutAnn(ann, sel, false);
            return;
        }
        if (ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'line' || ann.type === 'arrow' ||
            ann.type === 'redact' || ann.type === 'underline' || ann.type === 'strikeout') {
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
        if (ann.type === 'line' || ann.type === 'arrow' || ann.type === 'underline' || ann.type === 'strikeout') {
            return {
                x: Math.min(ann.x, ann.x + ann.w),
                y: Math.min(ann.y, ann.y + ann.h),
                w: Math.abs(ann.w),
                h: Math.abs(ann.h)
            };
        }
        if (ann.type === 'callout') {
            var minX = Math.min(ann.x, ann.ax != null ? ann.ax : ann.x);
            var minY = Math.min(ann.y, ann.ay != null ? ann.ay : ann.y);
            var maxX = Math.max(ann.x + (ann.w || 0), ann.ax != null ? ann.ax : ann.x);
            var maxY = Math.max(ann.y + (ann.h || 0), ann.ay != null ? ann.ay : ann.y);
            return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
        }
        if (ann.type === 'note') {
            var nd = measureNoteNormSize(ann);
            return { x: ann.x, y: ann.y, w: ann.w || nd.w, h: ann.h || nd.h };
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
            if (ann.type === 'draw' || ann.type === 'highlight' ||
                ann.type === 'line' || ann.type === 'arrow' ||
                ann.type === 'underline' || ann.type === 'strikeout') {
                if (ann.type === 'line' || ann.type === 'arrow' || ann.type === 'underline' || ann.type === 'strikeout') {
                    if (ptSegDist(nx, ny, ann.x, ann.y, ann.x + ann.w, ann.y + ann.h) < 0.015) return i;
                    continue;
                }
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
        var b;
        if (ann.type === 'callout' || ann.type === 'note') {
            var nb = ann;
            if (ann.type === 'note') {
                var ndh = measureNoteNormSize(ann);
                nb = { x: ann.x, y: ann.y, w: ann.w || ndh.w, h: ann.h || ndh.h };
            }
            b = { x: nb.x, y: nb.y, w: nb.w || 0.1, h: nb.h || 0.05 };
        } else {
            b = annBounds(ann);
        }
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

    function eraseAt(nx, ny, skipUndo) {
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
        if (changed) {
            if (!skipUndo) pushUndo();
            else redrawOverlay();
        }
    }

    function hideCompareBar() {
        compareState = null;
        var bar = gg('pde_compare_bar');
        if (bar) bar.style.display = 'none';
    }

    function goToPage(pi) {
        if (!pdfJsDoc) return Promise.resolve();
        pageNum = Math.max(0, Math.min(pi, pageCount - 1));
        selectedIdx = -1;
        refreshThumbsActive();
        if (compareState && compareState.pdfJsDoc) {
            compareState.pageNum = Math.min(pageNum, compareState.pdfJsDoc.numPages - 1);
            return renderCompareView().then(function () {
                updatePageLabel();
            });
        }
        return renderPage().then(function () {
            updatePageLabel();
        });
    }

    var PDE_CANVAS_TOOLS = {
        select: 1, hand: 1, pen: 1, highlight: 1, eraser: 1, text: 1, note: 1, callout: 1,
        underline: 1, strikeout: 1, redact: 1, rect: 1, ellipse: 1, line: 1, arrow: 1, ocr: 1
    };

    function ensureSingleEditMode() {
        if (compareState) {
            setStatus(t('Exit compare mode to edit.', '请先退出对比模式再编辑。', '請先退出對比模式再編輯。'), 'bad');
            return false;
        }
        if (viewMode !== 'single') {
            setViewMode('single');
        }
        return !!olCanvas;
    }

    /** Switch to single-page edit mode, then run callback once the overlay canvas exists. */
    function whenCanvasReadyForEdit(cb) {
        if (compareState) {
            setStatus(t('Exit compare mode to edit.', '请先退出对比模式再编辑。', '請先退出對比模式再編輯。'), 'bad');
            return Promise.resolve(false);
        }
        if (viewMode !== 'single') {
            return setViewMode('single').then(function () { return !!olCanvas; });
        }
        return Promise.resolve(!!olCanvas);
    }

    function activateCanvasTool(toolId) {
        if (!PDE_CANVAS_TOOLS[toolId]) {
            setTool(toolId);
            return;
        }
        whenCanvasReadyForEdit().then(function (ready) {
            if (!ready) {
                setStatus(t('Open a PDF in single-page view to annotate.', '请在单页视图中打开 PDF 再标注。', '請在單頁檢視中打開 PDF 再標註。'), 'bad');
                return;
            }
            setTool(toolId);
        });
    }

    function clampNormBox(x, y, w, h) {
        w = Math.max(0.04, Math.min(0.92, w));
        h = Math.max(0.03, Math.min(0.55, h));
        return {
            x: Math.max(0, Math.min(1 - w, x)),
            y: Math.max(0, Math.min(1 - h, y)),
            w: w,
            h: h
        };
    }

    function finalizeCalloutPreview(sp) {
        if (!sp || sp.type !== 'callout') return sp;
        var ax = sp.ax != null ? sp.ax : sp.x;
        var ay = sp.ay != null ? sp.ay : sp.y;
        sp.ax = ax;
        sp.ay = ay;
        if (Math.abs(sp.w) <= 0.01 && Math.abs(sp.h) <= 0.01) {
            sp.w = 0.22;
            sp.h = 0.08;
            sp.x = ax + 0.02;
            if (ay >= sp.h + 0.03) {
                sp.y = ay - sp.h - 0.025;
            } else {
                sp.y = Math.min(0.97 - sp.h, ay + 0.025);
            }
        } else {
            if (sp.w < 0) { sp.x += sp.w; sp.w = Math.abs(sp.w); }
            if (sp.h < 0) { sp.y += sp.h; sp.h = Math.abs(sp.h); }
            if (sp.w < 0.06) sp.w = 0.06;
            if (sp.h < 0.04) sp.h = 0.04;
        }
        var cl = clampNormBox(sp.x, sp.y, sp.w, sp.h);
        sp.x = cl.x;
        sp.y = cl.y;
        sp.w = cl.w;
        sp.h = cl.h;
        return sp;
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

    function pushAnn(ann) {
        pushUndo();
        pageAnns().push(withAnnMeta(ann));
        selectedIdx = pageAnns().length - 1;
        redrawOverlay();
        refreshPropsPanel();
    }

    function onPointerDown(ev) {
        if (!pdfJsDoc || textEditorEl) return;
        if (tool === 'textselect') return;
        if (tool === 'hand') {
            panDrag = { x: ev.clientX, y: ev.clientY, sl: viewportEl.scrollLeft, st: viewportEl.scrollTop };
            if (olCanvas) olCanvas.style.cursor = 'grabbing';
            return;
        }
        if (!olCanvas) {
            if (pdfJsDoc && tool !== 'hand') {
                whenCanvasReadyForEdit().then(function (ready) {
                    if (ready) setStatus(t('Click again to place the annotation.', '请再次点击以放置标注。', '請再次點擊以放置標註。'));
                });
            }
            return;
        }
        var p = pointerPos(ev);

        // One-shot tools: skip pointer capture so the inline editor can keep focus.
        if (tool === 'text') {
            ev.preventDefault();
            openTextEditor(p.x, p.y, null, -1, 'text');
            return;
        }
        if (tool === 'note') {
            ev.preventDefault();
            openTextEditor(p.x, p.y, null, -1, 'note');
            return;
        }

        ev.preventDefault();
        olCanvas.setPointerCapture(ev.pointerId);

        if (tool === 'eraser') {
            if (!eraserStrokeActive) {
                pushUndo();
                eraserStrokeActive = true;
            }
            eraseAt(p.x, p.y, true);
            return;
        }

        if (placeMode === 'image' && pendingImageUrl) { placeImageAt(p); return; }
        if (placeMode === 'signature' && pendingSigUrl) { placeSignatureAt(p); return; }
        if (placeMode === 'stamp' && pendingStampText) {
            pushAnn({
                type: 'stamp',
                text: resolveStampTokens(pendingStampText),
                color: pendingStampColor || '#dc2626',
                x: p.x,
                y: p.y,
                w: 0.18,
                h: 0.06,
                opacity: 0.9
            });
            placeMode = null;
            pendingStampText = null;
            olCanvas.classList.remove('pde-cursor-place');
            setTool('select');
            return;
        }

        if (tool === 'eraser') { eraseAt(p.x, p.y, true); return; }

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

        if (tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow' ||
            tool === 'underline' || tool === 'strikeout') {
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

        if (tool === 'callout') {
            shapePreview = {
                type: 'callout',
                ax: p.x, ay: p.y,
                x: p.x + 0.02, y: p.y + 0.02, w: 0, h: 0,
                text: t('Comment', '评论', '評論'),
                color: props.color,
                width: props.width,
                opacity: props.opacity,
                size: props.fontSize,
                fontFamily: props.fontFamily
            };
            return;
        }

        if (tool === 'stamp') {
            openStampPicker();
            return;
        }

        if (tool === 'redact') {
            shapePreview = {
                type: 'redact',
                x: p.x, y: p.y, w: 0, h: 0,
                color: '#ffffff',
                width: 1,
                opacity: 1,
                fill: true
            };
            return;
        }

        if (tool === 'ocr') {
            ocrPreview = { x: p.x, y: p.y, x2: p.x, y2: p.y };
            redrawOverlay();
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
                pushUndo();
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

        if (tool === 'eraser') { eraseAt(p.x, p.y, true); return; }

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

        if (ocrPreview) {
            ocrPreview.x2 = p.x;
            ocrPreview.y2 = p.y;
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
                } else if (o.type === 'line' || o.type === 'arrow' || o.type === 'underline' || o.type === 'strikeout') {
                    ann.x = o.x + dx; ann.y = o.y + dy;
                } else if (o.type === 'callout') {
                    ann.x = o.x + dx; ann.y = o.y + dy;
                    ann.ax = o.ax + dx; ann.ay = o.ay + dy;
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
        if (o.type === 'line' || o.type === 'arrow' || o.type === 'underline' || o.type === 'strikeout') {
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
        if (o.type === 'callout') {
            ann.ax = o.ax;
            ann.ay = o.ay;
        }
    }

    function onPointerUp(ev) {
        if (panDrag) {
            panDrag = null;
            updateToolCursors();
            return;
        }
        try { if (olCanvas) olCanvas.releasePointerCapture(ev.pointerId); } catch (e) {}
        if (currentStroke) {
            if (currentStroke.points.length >= 2) {
                pushAnn(currentStroke);
            }
            currentStroke = null;
            redrawOverlay();
        }
        if (shapePreview) {
            var sp = shapePreview;
            var created = null;
            if (sp.type === 'callout') {
                sp = finalizeCalloutPreview(JSON.parse(JSON.stringify(sp)));
                created = withAnnMeta(sp);
                pushUndo();
                pageAnns().push(created);
                selectedIdx = pageAnns().length - 1;
                var calloutIdx = pageAnns().length - 1;
                var calloutAnn = created;
                requestAnimationFrame(function () {
                    openTextEditor(calloutAnn.x, calloutAnn.y, calloutAnn, calloutIdx, 'callout', { removeOnCancel: true });
                });
            } else if (Math.abs(sp.w) > 0.01 || Math.abs(sp.h) > 0.01) {
                if (sp.type === 'rect' || sp.type === 'ellipse' || sp.type === 'redact') {
                    if (sp.w < 0) { sp.x += sp.w; sp.w = Math.abs(sp.w); }
                    if (sp.h < 0) { sp.y += sp.h; sp.h = Math.abs(sp.h); }
                }
                created = withAnnMeta(JSON.parse(JSON.stringify(sp)));
                pushUndo();
                pageAnns().push(created);
                selectedIdx = pageAnns().length - 1;
            }
            shapePreview = null;
            redrawOverlay();
            refreshPropsPanel();
        }
        if (ocrPreview) {
            var ox1 = Math.min(ocrPreview.x, ocrPreview.x2);
            var oy1 = Math.min(ocrPreview.y, ocrPreview.y2);
            var ox2 = Math.max(ocrPreview.x, ocrPreview.x2);
            var oy2 = Math.max(ocrPreview.y, ocrPreview.y2);
            var ow = ox2 - ox1;
            var oh = oy2 - oy1;
            ocrPreview = null;
            redrawOverlay();
            if (ow > 0.008 && oh > 0.008) {
                runOcrRegionNorm(ox1, oy1, ow, oh);
            } else {
                runOcrFullPage();
            }
        }
        if (dragState) {
            dragState = null;
        }
        if (eraserStrokeActive) {
            eraserStrokeActive = false;
            redrawOverlay();
        }
    }

    function onDoubleClick(ev) {
        if (tool !== 'select') return;
        var p = pointerPos(ev);
        var idx = hitTest(p.x, p.y);
        if (idx < 0) return;
        var ann = pageAnns()[idx];
        if (ann.type === 'text' || ann.type === 'note' || ann.type === 'callout') {
            openTextEditor(ann.x, ann.y, ann, idx, ann.type);
        }
    }

    // ── inline text editor ───────────────────────────────────────
    function closeTextEditor(commit) {
        if (!textEditorEl) return;
        var meta = textEditorEl._pdeMeta;
        if (!commit && meta && meta.removeOnCancel && meta.idx >= 0) {
            var list = pageAnns();
            if (list[meta.idx]) {
                pushUndo();
                list.splice(meta.idx, 1);
                if (selectedIdx === meta.idx) selectedIdx = -1;
                else if (selectedIdx > meta.idx) selectedIdx--;
                redrawOverlay();
                refreshPropsPanel();
            }
        } else if (commit && meta) {
            var val = textEditorEl.value;
            var kind = meta.kind || 'text';
            if (val.trim()) {
                if (meta.idx >= 0) {
                    pushUndo();
                    var row = pageAnns()[meta.idx];
                    if (row) {
                        row.text = val;
                        if (kind === 'callout' || kind === 'note') {
                            row.size = props.fontSize;
                            row.fontFamily = props.fontFamily;
                        }
                        if (kind === 'note') normalizeNoteAnn(row);
                    }
                } else {
                    var payload = {
                        type: kind,
                        text: val,
                        x: meta.x,
                        y: meta.y,
                        size: props.fontSize,
                        fontFamily: props.fontFamily,
                        color: props.color,
                        opacity: props.opacity
                    };
                    if (kind === 'note') {
                        payload.color = '#fef08a';
                        payload.opacity = 0.95;
                        normalizeNoteAnn(payload);
                    }
                    if (kind === 'callout') {
                        payload.w = 0.22;
                        payload.h = 0.08;
                        payload.ax = meta.x;
                        payload.ay = meta.y;
                        payload.x = Math.min(0.97 - payload.w, meta.x + 0.02);
                        payload.y = meta.y >= payload.h + 0.03
                            ? meta.y - payload.h - 0.025
                            : Math.min(0.97 - payload.h, meta.y + 0.025);
                        var cl = clampNormBox(payload.x, payload.y, payload.w, payload.h);
                        payload.x = cl.x;
                        payload.y = cl.y;
                        payload.w = cl.w;
                        payload.h = cl.h;
                    }
                    pushAnn(payload);
                }
                redrawOverlay();
                refreshPropsPanel();
            } else if (meta.removeOnCancel && meta.idx >= 0) {
                pushUndo();
                pageAnns().splice(meta.idx, 1);
                if (selectedIdx === meta.idx) selectedIdx = -1;
                else if (selectedIdx > meta.idx) selectedIdx--;
                redrawOverlay();
                refreshPropsPanel();
            }
        }
        textEditorEl.remove();
        textEditorEl = null;
    }

    function openTextEditor(nx, ny, existing, idx, kind, opts) {
        kind = kind || 'text';
        opts = opts || {};
        closeTextEditor(false);
        if (!stageEl || !olCanvas) return;
        var cp = normToCanvas(nx, ny);
        var stageRect = stageEl.getBoundingClientRect();
        var scaleX = stageEl.offsetWidth / olCanvas.width;
        var scaleY = stageEl.offsetHeight / olCanvas.height;
        var left = stageRect.left + cp.x * scaleX;
        var top = stageRect.top + cp.y * scaleY;
        if (kind === 'note') {
            left += 6;
            top += 6;
        } else if (kind === 'callout') {
            left += 6;
            top += 6;
        } else {
            top -= Math.round(props.fontSize * viewportScale);
        }
        var ta = document.createElement('textarea');
        ta.className = 'pde-text-editor';
        ta.style.left = Math.round(left) + 'px';
        ta.style.top = Math.round(top) + 'px';
        ta.style.fontSize = Math.round((existing && existing.size ? existing.size : props.fontSize) * viewportScale) + 'px';
        ta.style.fontFamily = (existing && existing.fontFamily) || props.fontFamily;
        if (kind === 'note') {
            ta.style.color = '#713f12';
            ta.placeholder = t('Type a note…', '输入备注…', '輸入備註…');
            ta.style.minWidth = '180px';
            ta.style.minHeight = '60px';
        } else if (kind === 'callout') {
            ta.style.color = (existing && existing.color) || props.color;
            ta.placeholder = t('Type a comment…', '输入评论…', '輸入評論…');
        } else {
            ta.style.color = props.color;
        }
        ta.value = existing ? (existing.text || '') : '';
        ta._pdeMeta = {
            x: nx,
            y: ny,
            idx: idx,
            kind: kind,
            removeOnCancel: !!opts.removeOnCancel
        };
        if (kind === 'callout') ta.style.minWidth = '220px';
        document.body.appendChild(ta);
        textEditorEl = ta;
        var allowBlur = false;
        ta.addEventListener('mousedown', function (e) { e.stopPropagation(); });
        ta.addEventListener('blur', function () {
            if (!allowBlur) return;
            closeTextEditor(true);
        });
        ta.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); closeTextEditor(false); }
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                closeTextEditor(true);
            }
            e.stopPropagation();
        });
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                ta.focus({ preventScroll: true });
                if (idx < 0 || opts.removeOnCancel) {
                    ta.select();
                } else {
                    var end = ta.value.length;
                    ta.setSelectionRange(end, end);
                }
                allowBlur = true;
            });
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
            pendingStampText = null;
            olCanvas && olCanvas.classList.remove('pde-cursor-place');
        }
        if (!opts.keepSelect) selectedIdx = -1;
        syncTextLayerMode();
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
            eraser: 'cell', text: 'text', textselect: 'text', ocr: 'crosshair', redact: 'crosshair',
            rect: 'crosshair', ellipse: 'crosshair',
            line: 'crosshair', arrow: 'crosshair', stamp: 'copy',
            note: 'copy', callout: 'crosshair', underline: 'crosshair', strikeout: 'crosshair'
        };
        olCanvas.style.cursor = placeMode ? 'copy' : (map[tool] || 'default');
    }

    // ── properties panel ─────────────────────────────────────────
    function textToolPanelHtml() {
        if (tool === 'textselect') {
            var emptyHint = textLayerEl && textLayerEl.getAttribute('data-empty') === '1'
                ? t('No embedded text on this page — try OCR for scans.', '此页无嵌入文字 — 扫描件请用 OCR。', '此頁無嵌入文字 — 掃描件請用 OCR。')
                : t('Drag to select text on the page. Ctrl+C to copy.', '在页面上拖选文字。Ctrl+C 复制。', '在頁面上拖選文字。Ctrl+C 複製。');
            return '<p class="pde-props-type">' + esc(t('Text select', '文字选择', '文字選取')) + '</p>' +
                '<p class="pde-props-empty">' + esc(emptyHint) + '</p>' +
                '<button type="button" class="ct-btn pde-props-btn" id="pde_copy_text_btn">' +
                esc(t('Copy selection', '复制选中', '複製選取')) + '</button>';
        }
        if (tool === 'ocr') {
            var ocrText = ocrResultByPage[pageNum] || '';
            return '<p class="pde-props-type">' + esc(t('OCR (scan → text)', 'OCR（扫描识别）', 'OCR（掃描辨識）')) + '</p>' +
                '<p class="pde-props-empty">' + esc(t(
                    'Drag a rectangle to OCR a region, or click without dragging for the full page. First run downloads language data (~15 MB).',
                    '拖选矩形识别区域；不拖动则识别整页。首次运行会下载语言包（约 15 MB）。',
                    '拖選矩形辨識區域；不拖動則辨識整頁。首次執行會下載語言包（約 15 MB）。')) + '</p>' +
                fieldSelect('pde_ocr_lang', t('Languages', '语言', '語言'), ocrLang, [
                    ['eng', 'English'],
                    ['chi_tra', 'Chinese (Traditional)'],
                    ['chi_sim', 'Chinese (Simplified)'],
                    ['eng+chi_tra', 'English + Traditional Chinese'],
                    ['eng+chi_sim', 'English + Simplified Chinese']
                ]) +
                '<button type="button" class="ct-btn pde-props-btn" id="pde_ocr_page_btn"' +
                (ocrBusy ? ' disabled' : '') + '>' + esc(t('OCR this page', '识别本页', '辨識本頁')) + '</button>' +
                '<div id="pde_ocr_progress" class="pde-ocr-progress"></div>' +
                '<label class="pde-prop-field"><span>' + esc(t('OCR result', '识别结果', '辨識結果')) + '</span>' +
                '<textarea id="pde_ocr_result" class="pde-ocr-result" rows="8" readonly>' +
                esc(ocrText) + '</textarea></label>' +
                '<button type="button" class="ct-btn pde-props-btn" id="pde_copy_ocr_btn"' +
                (ocrText ? '' : ' disabled') + '>' + esc(t('Copy OCR text', '复制 OCR 文字', '複製 OCR 文字')) + '</button>' +
                '<button type="button" class="ct-btn pde-props-btn" id="pde_ocr_to_ann_btn"' +
                (ocrText ? '' : ' disabled') + '>' + esc(t('Add as text box', '添加为文本框', '新增為文字框')) + '</button>';
        }
        return '';
    }

    function wireTextToolPanel() {
        var copySel = gg('pde_copy_text_btn');
        if (copySel) copySel.addEventListener('click', copySelectedOrOcrText);
        var ocrPage = gg('pde_ocr_page_btn');
        if (ocrPage) ocrPage.addEventListener('click', runOcrFullPage);
        var copyOcr = gg('pde_copy_ocr_btn');
        if (copyOcr) copyOcr.addEventListener('click', function () {
            copyTextToClipboard(ocrResultByPage[pageNum] || '');
        });
        var langSel = gg('pde_ocr_lang');
        if (langSel) {
            langSel.addEventListener('change', function () {
                ocrLang = langSel.value || 'eng+chi_tra';
            });
        }
        var toAnn = gg('pde_ocr_to_ann_btn');
        if (toAnn) {
            toAnn.addEventListener('click', function () {
                var txt = String(ocrResultByPage[pageNum] || '').trim();
                if (!txt) return;
                pushUndo();
                pageAnns().push({
                    type: 'text',
                    text: txt,
                    x: 0.08,
                    y: 0.12,
                    size: props.fontSize || 14,
                    fontFamily: props.fontFamily || 'sans-serif',
                    color: props.color || '#111827',
                    opacity: 1
                });
                selectedIdx = pageAnns().length - 1;
                setTool('select');
                redrawOverlay();
                refreshPropsPanel();
            });
        }
    }

    function refreshPropsPanel() {
        var panel = gg('pde_props_body');
        if (!panel) return;
        var ann = selectedIdx >= 0 ? pageAnns()[selectedIdx] : null;
            if (!ann) {
            if (tool === 'textselect' || tool === 'ocr') {
                panel.innerHTML = textToolPanelHtml();
                wireTextToolPanel();
                return;
            }
            if (tool === 'redact') {
                panel.innerHTML =
                    '<p class="pde-props-type">' + esc(t('Redact / whiteout', '涂黑 / 白底遮盖', '塗黑 / 白底遮蓋')) + '</p>' +
                    '<p class="pde-props-empty">' + esc(t(
                        'Drag a rectangle over sensitive text. Exported PDFs burn in solid white — content underneath is permanently covered.',
                        '拖选矩形遮盖敏感文字。导出时涂白会永久覆盖下方内容。',
                        '拖選矩形遮蓋敏感文字。匯出時塗白會永久覆蓋下方內容。')) + '</p>';
                return;
            }
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
        var isText = ann && (ann.type === 'text' || ann.type === 'note' || ann.type === 'callout');
        var isStroke = ann && (ann.type === 'draw' || ann.type === 'highlight' || ann.type === 'rect' ||
            ann.type === 'ellipse' || ann.type === 'line' || ann.type === 'arrow' ||
            ann.type === 'underline' || ann.type === 'strikeout' || ann.type === 'callout');
        var isBox = ann && (ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'image' ||
            ann.type === 'signature' || ann.type === 'stamp' || ann.type === 'redact' ||
            ann.type === 'note' || ann.type === 'callout');
        var color = ann ? ann.color : props.color;
        var width = ann ? ann.width : props.width;
        var opacity = ann ? (ann.opacity != null ? ann.opacity : 1) : props.opacity;
        var html = '';
        if (!ann) {
            html += fieldText('pde_prop_author', t('Author name', '作者姓名', '作者姓名'), getPdeAuthor());
        }
        if (ann && (ann.author || ann.createdAt)) {
            html += '<p class="pde-prop-meta">' + esc(formatAnnMetaLine(ann)) + '</p>';
        }
        html += fieldColor('pde_prop_color', t('Color', '颜色', '顏色'), color);
        if (isStroke || !ann) {
            html += fieldRange('pde_prop_width', t('Stroke', '线宽', '線寬'), width, 1, 24);
        }
        html += fieldRange('pde_prop_opacity', t('Opacity', '不透明度', '不透明度'), Math.round(opacity * 100), 10, 100, '%');
        if (isText || (!ann && (tool === 'text' || tool === 'note' || tool === 'callout'))) {
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
        if (ann && (ann.type === 'stamp' || ann.type === 'note' || ann.type === 'callout')) {
            html += fieldText('pde_prop_ann_text', t('Text', '文字', '文字'), ann.text || '');
        }
        if (ann && ann.type === 'stamp') {
            html += fieldText('pde_prop_stamp', t('Stamp text', '图章文字', '圖章文字'), ann.text || 'APPROVED');
        }
        if (!ann) {
            html += fieldText('pde_prop_stamptext', t('Default stamp', '默认图章', '預設圖章'), props.stampText || 'APPROVED');
            html += '<p class="pde-props-hint">' + esc(t('Tokens: {date} {time} {user} {clinic}', '变量：{date} {time} {user} {clinic}', '變數：{date} {time} {user} {clinic}')) + '</p>';
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
            if (ann) { ann.color = v; redrawOverlay(); pdeMarkDirty(); }
            else props.color = v;
        });
        bind('pde_prop_width', function () {
            var v = parseInt(gg('pde_prop_width').value, 10);
            if (ann) { ann.width = v; redrawOverlay(); pdeMarkDirty(); }
            else props.width = v;
            var em = gg('pde_prop_width') && gg('pde_prop_width').nextElementSibling;
            if (em) em.textContent = v;
        });
        bind('pde_prop_opacity', function () {
            var v = parseInt(gg('pde_prop_opacity').value, 10) / 100;
            if (ann) { ann.opacity = v; redrawOverlay(); pdeMarkDirty(); }
            else props.opacity = v;
        });
        bind('pde_prop_fontsize', function () {
            var v = parseInt(gg('pde_prop_fontsize').value, 10);
            if (ann) {
                ann.size = v;
                if (ann.type === 'note') normalizeNoteAnn(ann);
                redrawOverlay();
                pdeMarkDirty();
            } else props.fontSize = v;
            var em = gg('pde_prop_fontsize') && gg('pde_prop_fontsize').nextElementSibling;
            if (em) em.textContent = v + 'px';
        });
        bind('pde_prop_font', function () {
            var v = gg('pde_prop_font').value;
            if (ann) {
                ann.fontFamily = v;
                if (ann.type === 'note') normalizeNoteAnn(ann);
                redrawOverlay();
                pdeMarkDirty();
            } else props.fontFamily = v;
        });
        bind('pde_prop_fill', function () {
            if (!ann) return;
            ann.fill = gg('pde_prop_fill').checked;
            redrawOverlay();
            pdeMarkDirty();
        });
        bind('pde_prop_stamp', function () {
            if (!ann) return;
            ann.text = gg('pde_prop_stamp').value;
            redrawOverlay();
            pdeMarkDirty();
        });
        bind('pde_prop_ann_text', function () {
            if (!ann) return;
            ann.text = gg('pde_prop_ann_text').value;
            if (ann.type === 'note') normalizeNoteAnn(ann);
            redrawOverlay();
            pdeMarkDirty();
        });
        bind('pde_prop_stamptext', function () {
            props.stampText = gg('pde_prop_stamptext').value;
        });
        bind('pde_prop_author', function () {
            setPdeAuthor(gg('pde_prop_author').value);
        });
    }

    // ── thumbnails ───────────────────────────────────────────────
    function buildThumbnails() {
        var box = gg('pde_thumbs');
        if (!box || !pdfJsDoc) return Promise.resolve();
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
                            btn.draggable = true;
                            btn.title = t('Drag to reorder', '拖曳以重排', '拖曳以重排');
                            btn.innerHTML = '<img src="' + c.toDataURL('image/jpeg', 0.7) + '" alt="" draggable="false"><span>' + (pi + 1) + '</span>';
                            btn.addEventListener('click', function () {
                                goToPage(pi);
                            });
                            btn.addEventListener('dragstart', onThumbDragStart);
                            btn.addEventListener('dragover', onThumbDragOver);
                            btn.addEventListener('dragleave', function () { btn.classList.remove('pde-thumb-drop-target'); });
                            btn.addEventListener('drop', onThumbDrop);
                            btn.addEventListener('dragend', function () {
                                btn.classList.remove('pde-thumb-dragging');
                                thumbDragFrom = null;
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
            if (!ensureSingleEditMode()) return;
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
    function reloadPdfDocument(opts) {
        opts = opts || {};
        if (!pdfBytes) return Promise.reject(new Error('No PDF data'));
        return ensurePdfJs().then(function (pdfjs) {
            return getPdfJsDocument(pdfBytes);
        }).then(function (doc) {
            pdfJsDoc = doc;
            pageCount = doc.numPages;
            if (opts.pageNum != null) {
                pageNum = Math.max(0, Math.min(opts.pageNum, pageCount - 1));
            } else {
                pageNum = Math.min(pageNum, Math.max(0, pageCount - 1));
            }
            if (!opts.keepAnnotations) {
                annByPage = {};
                pdfFormValues = {};
                undoStack = [];
                redoStack = [];
                syncHistoryButtons();
            }
            if (!opts.keepOcr) ocrResultByPage = {};
            if (!opts.keepSearch) { searchHits = []; searchHitIdx = -1; }
            pageDims = {};
            return loadPdfOutline().then(function () {
                return scanPdfForms().then(function () {
                    return buildThumbnails().then(renderPage);
                });
            });
        });
    }

    function loadPdfFromBytes(bytes, name, opts) {
        opts = opts || {};
        compareState = null;
        viewMode = 'single';
        var bar = gg('pde_compare_bar');
        if (bar) bar.style.display = 'none';
        if (!opts.keepPassword) pdfPassword = null;
        pdfBytes = bytes;
        fileName = name || 'document.pdf';
        setStatus(t('Loading…', '加载中…', '載入中…'), 'work');
        if (opts.pageNum != null) pageNum = opts.pageNum;
        var emptyEl = gg('pde_empty');
        var shellEl = gg('pde_shell');
        if (emptyEl) emptyEl.style.display = 'none';
        if (shellEl) shellEl.style.display = 'flex';
        var saveBtn = gg('pde_save');
        if (saveBtn) saveBtn.disabled = false;
        setDocActionButtonsEnabled(true);
        return reloadPdfDocument({
            keepAnnotations: !!opts.keepAnnotations,
            keepOcr: !!opts.keepOcr,
            keepSearch: !!opts.keepSearch,
            pageNum: opts.pageNum
        }).then(function () {
            setStatus(t('Ready.', '就绪。', '就緒。'));
            pdeClearDirty();
            updatePdePatientBanner();
            return saveRecentPdf(fileName, pdfBytes);
        }).then(function () {
            refreshRecentListUI();
        }).catch(function (e) {
            pdfBytes = null;
            pdfJsDoc = null;
            pdfPassword = null;
            var emptyEl = gg('pde_empty');
            var shellEl = gg('pde_shell');
            if (emptyEl) emptyEl.style.display = 'flex';
            if (shellEl) shellEl.style.display = 'none';
            setDocActionButtonsEnabled(false);
            setStatus(t('Failed: ', '失败：', '失敗：') + (e && e.message || e), 'bad');
        });
    }

    function loadPdfFile(file) {
        if (!file) return;
        pdeConfirmLeave(function () {
            fileName = file.name || 'document.pdf';
            setStatus(t('Loading…', '加载中…', '載入中…'), 'work');
            readFileArrayBuffer(file).then(function (buf) {
                pageNum = 0;
                return loadPdfFromBytes(buf, fileName);
            }).catch(function (e) {
                setStatus(t('Failed: ', '失败：', '失敗：') + (e && e.message || e), 'bad');
            });
        });
    }

    function setDocActionButtonsEnabled(on) {
        ['pde_save', 'pde_print', 'pde_print_setup', 'pde_copy_text', 'pde_ocr_page', 'pde_extract',
            'pde_watermark', 'pde_compress', 'pde_forms', 'pde_batch', 'pde_template', 'pde_link_patient',
            'pde_compare', 'pde_view_continuous', 'pde_view_twoup',
            'pde_find_go', 'pde_find_prev', 'pde_find_next',
            'pde_pg_delete', 'pde_pg_rotate', 'pde_pg_duplicate', 'pde_pg_blank'].forEach(function (id) {
            var b = gg(id);
            if (b) b.disabled = !on;
        });
        var findInp = gg('pde_find_input');
        if (findInp) findInp.disabled = !on;
    }

    // ── tier-1: page ops, watermark, compress, search, bookmarks ─
    function applyStructureMutation(mutator, opts) {
        opts = opts || {};
        if (!pdfBytes) return Promise.reject(new Error('No PDF loaded'));
        var keepPage = opts.pageNum != null ? opts.pageNum : pageNum;
        setStatus(t('Updating pages…', '更新页面中…', '更新頁面中…'), 'work');
        return buildFlattenedPdfBytes().then(function (bytes) {
            return ensurePdfLib().then(function (PDFLib) {
                return loadPdfLibDocument(bytes).then(function (doc) {
                    return mutator(doc, PDFLib);
                }).then(function (doc) { return doc.save(); });
            });
        }).then(function (newBytes) {
            pdfBytes = newBytes;
            pdfPassword = null;
            var nextPage = Math.max(0, Math.min(keepPage, pageCount - 1));
            if (opts.afterDelete && keepPage >= pageCount - 1) {
                nextPage = Math.max(0, pageCount - 2);
            }
            return reloadPdfDocument({ pageNum: nextPage, keepAnnotations: false, keepOcr: false, keepSearch: false });
        }).then(function () {
            setStatus(t('Pages updated.', '页面已更新。', '頁面已更新。'), 'ok');
            pdeMarkDirty();
        });
    }

    function reorderPages(order, opts) {
        opts = opts || {};
        if (!order || !order.length) return Promise.reject(new Error('empty order'));
        var targetPage = opts.pageNum != null ? opts.pageNum : (order.indexOf(pageNum) >= 0 ? order.indexOf(pageNum) : 0);
        return applyStructureMutation(function (doc, PDFLib) {
            return PDFLib.PDFDocument.create().then(function (out) {
                return out.copyPages(doc, order).then(function (pages) {
                    pages.forEach(function (pg) { out.addPage(pg); });
                    return out;
                });
            });
        }, { pageNum: targetPage });
    }

    function deleteCurrentPage() {
        if (pageCount <= 1) {
            alert(t('Cannot delete the only page.', '无法删除唯一的一页。', '無法刪除唯一的一頁。'));
            return Promise.resolve();
        }
        if (!confirm(t('Delete page ', '删除第 ', '刪除第 ') + (pageNum + 1) + '?')) return Promise.resolve();
        var order = [];
        for (var i = 0; i < pageCount; i++) {
            if (i !== pageNum) order.push(i);
        }
        return reorderPages(order).catch(function (e) {
            setStatus(t('Delete failed: ', '删除失败：', '刪除失敗：') + (e && e.message || e), 'bad');
        });
    }

    function rotateCurrentPage(angle) {
        angle = angle || 90;
        var idx = pageNum;
        return applyStructureMutation(function (doc, PDFLib) {
            var pages = doc.getPages();
            if (idx < 0 || idx >= pages.length) return doc;
            var pg = pages[idx];
            var cur = pg.getRotation().angle || 0;
            pg.setRotation(PDFLib.degrees((cur + angle) % 360));
            return doc;
        }, { pageNum: idx });
    }

    function duplicateCurrentPage() {
        var idx = pageNum;
        var order = [];
        for (var i = 0; i < pageCount; i++) {
            order.push(i);
            if (i === idx) order.push(i);
        }
        return reorderPages(order, { pageNum: idx + 1 });
    }

    function insertBlankPageAfterCurrent() {
        var idx = pageNum;
        return applyStructureMutation(function (doc, PDFLib) {
            var pages = doc.getPages();
            var ref = pages[idx] || pages[0];
            var w = ref.getWidth();
            var h = ref.getHeight();
            doc.insertPage(idx + 1, [w, h]);
            return doc;
        }, { pageNum: idx + 1 });
    }

    function onThumbDragStart(ev) {
        var btn = ev.target.closest('.pde-thumb');
        if (!btn) return;
        thumbDragFrom = parseInt(btn.getAttribute('data-page'), 10);
        ev.dataTransfer.effectAllowed = 'move';
        try { ev.dataTransfer.setData('text/plain', String(thumbDragFrom)); } catch (e) {}
        btn.classList.add('pde-thumb-dragging');
    }

    function onThumbDragOver(ev) {
        if (thumbDragFrom == null) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        var btn = ev.target.closest('.pde-thumb');
        document.querySelectorAll('.pde-thumb').forEach(function (b) { b.classList.remove('pde-thumb-drop-target'); });
        if (btn) btn.classList.add('pde-thumb-drop-target');
    }

    function onThumbDrop(ev) {
        ev.preventDefault();
        var btn = ev.target.closest('.pde-thumb');
        document.querySelectorAll('.pde-thumb').forEach(function (b) {
            b.classList.remove('pde-thumb-dragging', 'pde-thumb-drop-target');
        });
        if (thumbDragFrom == null || !btn) { thumbDragFrom = null; return; }
        var toIdx = parseInt(btn.getAttribute('data-page'), 10);
        var fromIdx = thumbDragFrom;
        thumbDragFrom = null;
        if (fromIdx === toIdx || isNaN(fromIdx) || isNaN(toIdx)) return;
        var order = [];
        for (var i = 0; i < pageCount; i++) order.push(i);
        order.splice(fromIdx, 1);
        order.splice(toIdx, 0, fromIdx);
        var newPageNum = pageNum;
        if (pageNum === fromIdx) newPageNum = toIdx;
        else if (fromIdx < pageNum && toIdx >= pageNum) newPageNum = pageNum - 1;
        else if (fromIdx > pageNum && toIdx <= pageNum) newPageNum = pageNum + 1;
        reorderPages(order, { pageNum: newPageNum }).catch(function (e) {
            setStatus(t('Reorder failed: ', '重排失败：', '重排失敗：') + (e && e.message || e), 'bad');
        });
    }

    function loadPdfOutline() {
        pdfOutlineFlat = [];
        if (!pdfJsDoc || typeof pdfJsDoc.getOutline !== 'function') {
            refreshBookmarksPanel();
            return Promise.resolve();
        }
        return pdfJsDoc.getOutline().then(function (items) {
            return flattenOutlineItems(items || [], 0);
        }).catch(function () {
            pdfOutlineFlat = [];
        }).then(function () {
            refreshBookmarksPanel();
        });
    }

    function flattenOutlineItems(items, depth) {
        var chain = Promise.resolve();
        (items || []).forEach(function (item) {
            chain = chain.then(function () {
                var entry = { title: item.title || t('Untitled', '无标题', '無標題'), page: 0, depth: depth };
                pdfOutlineFlat.push(entry);
                var destP = Promise.resolve();
                if (item.dest) {
                    destP = pdfJsDoc.getPageIndex(item.dest[0]).then(function (pi) {
                        entry.page = pi;
                    }).catch(function () {});
                }
                return destP.then(function () {
                    if (item.items && item.items.length) {
                        return flattenOutlineItems(item.items, depth + 1);
                    }
                });
            });
        });
        return chain;
    }

    function refreshBookmarksPanel() {
        var box = gg('pde_bookmarks');
        if (!box) return;
        if (!pdfOutlineFlat.length) {
            box.innerHTML = '<p class="pde-side-empty">' + esc(t('No bookmarks in this PDF.', '此 PDF 无书签。', '此 PDF 無書籤。')) + '</p>';
            return;
        }
        var html = '';
        pdfOutlineFlat.forEach(function (bm, i) {
            html += '<button type="button" class="pde-bookmark-item" data-bm-page="' + bm.page +
                '" style="padding-left:' + (8 + bm.depth * 12) + 'px">' +
                esc(bm.title) + ' <span class="pde-bm-pg">' + (bm.page + 1) + '</span></button>';
        });
        box.innerHTML = html;
        box.querySelectorAll('[data-bm-page]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                goToPage(parseInt(btn.getAttribute('data-bm-page'), 10) || 0);
            });
        });
    }

    function textItemNormBox(item, vp) {
        var util = window.pdfjsLib && window.pdfjsLib.Util;
        var tr = util ? util.transform(vp.transform, item.transform) : item.transform;
        var fontHeight = Math.hypot(tr[2], tr[3]) || Math.abs(tr[0]) || 12;
        var x = tr[4];
        var y = tr[5] - fontHeight * 0.85;
        var w = item.width || (String(item.str || '').length * fontHeight * 0.5);
        var h = fontHeight * 1.15;
        return {
            x: x / vp.width,
            y: y / vp.height,
            w: w / vp.width,
            h: h / vp.height
        };
    }

    function runDocumentSearch(query) {
        query = String(query || '').trim();
        searchQuery = query;
        searchHits = [];
        searchHitIdx = -1;
        if (!query || !pdfJsDoc) {
            redrawOverlay();
            updateSearchStatus();
            return Promise.resolve();
        }
        var q = query.toLowerCase();
        setStatus(t('Searching…', '搜索中…', '搜尋中…'), 'work');
        var chain = Promise.resolve();
        for (var p = 1; p <= pageCount; p++) {
            (function (pageIndex) {
                chain = chain.then(function () {
                    return pdfJsDoc.getPage(pageIndex).then(function (page) {
                        var vp = page.getViewport({ scale: 1 });
                        return page.getTextContent({ includeMarkedContent: false }).then(function (tc) {
                            (tc.items || []).forEach(function (it) {
                                var s = String(it.str || '');
                                if (!s) return;
                                var low = s.toLowerCase();
                                var start = 0;
                                var pos;
                                while ((pos = low.indexOf(q, start)) >= 0) {
                                    var box = textItemNormBox(it, vp);
                                    var charW = box.w / Math.max(1, s.length);
                                    searchHits.push({
                                        page: pageIndex - 1,
                                        text: s.substring(pos, pos + query.length),
                                        x: box.x + charW * pos,
                                        y: box.y,
                                        w: charW * query.length,
                                        h: box.h
                                    });
                                    start = pos + query.length;
                                }
                            });
                        });
                    });
                });
            })(p);
        }
        return chain.then(function () {
            if (searchHits.length) {
                searchHitIdx = 0;
                goToSearchHit(0);
            } else {
                setStatus(t('No matches found.', '未找到匹配。', '未找到符合項目。'), 'bad');
                redrawOverlay();
            }
            updateSearchStatus();
        }).catch(function (e) {
            setStatus(t('Search failed: ', '搜索失败：', '搜尋失敗：') + (e && e.message || e), 'bad');
        });
    }

    function updateSearchStatus() {
        var el = gg('pde_find_status');
        if (!el) return;
        if (!searchQuery) { el.textContent = ''; return; }
        if (!searchHits.length) {
            el.textContent = t('0 matches', '0 个匹配', '0 個符合');
            return;
        }
        el.textContent = (searchHitIdx + 1) + ' / ' + searchHits.length;
    }

    function goToSearchHit(idx) {
        if (!searchHits.length) return;
        searchHitIdx = ((idx % searchHits.length) + searchHits.length) % searchHits.length;
        var hit = searchHits[searchHitIdx];
        goToPage(hit.page).then(function () {
            updateSearchStatus();
            setStatus(t('Match found.', '找到匹配。', '找到符合項目。'), 'ok');
        });
    }

    function findNextHit(dir) {
        if (!searchHits.length) {
            runDocumentSearch(gg('pde_find_input') ? gg('pde_find_input').value : '');
            return;
        }
        goToSearchHit(searchHitIdx + (dir || 1));
    }

    function drawSearchHighlights() {
        if (!olCtx || !olCanvas || searchHitIdx < 0 || !searchHits.length) return;
        var hit = searchHits[searchHitIdx];
        if (hit.page !== pageNum) return;
        var tl = normToCanvas(hit.x, hit.y);
        var w = hit.w * olCanvas.width;
        var h = hit.h * olCanvas.height;
        olCtx.save();
        olCtx.fillStyle = 'rgba(250, 204, 21, 0.45)';
        olCtx.strokeStyle = '#ca8a04';
        olCtx.lineWidth = 2;
        olCtx.fillRect(tl.x, tl.y, w, h);
        olCtx.strokeRect(tl.x, tl.y, w, h);
        olCtx.restore();
        searchHits.forEach(function (h, i) {
            if (h.page !== pageNum || i === searchHitIdx) return;
            var p = normToCanvas(h.x, h.y);
            olCtx.save();
            olCtx.fillStyle = 'rgba(250, 204, 21, 0.2)';
            olCtx.fillRect(p.x, p.y, h.w * olCanvas.width, h.h * olCanvas.height);
            olCtx.restore();
        });
    }

    var _watermarkOv = null;
    var _compressOv = null;

    function closeWatermarkModal() {
        if (_watermarkOv && _watermarkOv.parentNode) _watermarkOv.parentNode.removeChild(_watermarkOv);
        _watermarkOv = null;
    }

    function closeCompressModal() {
        if (_compressOv && _compressOv.parentNode) _compressOv.parentNode.removeChild(_compressOv);
        _compressOv = null;
    }

    function applyWatermarkAndHeaders(opts) {
        opts = opts || {};
        return buildFlattenedPdfBytes().then(function (bytes) {
            return ensurePdfLib().then(function (PDFLib) {
                return loadPdfLibDocument(bytes).then(function (doc) {
                    return doc.embedFont(PDFLib.StandardFonts.Helvetica).then(function (fontReg) {
                        return doc.embedFont(PDFLib.StandardFonts.HelveticaBold).then(function (fontBold) {
                            var pages = doc.getPages();
                            var scope = opts.scope || 'all';
                            pages.forEach(function (pg, pi) {
                                if (scope === 'current' && pi !== pageNum) return;
                                var w = pg.getWidth();
                                var h = pg.getHeight();
                                if (opts.watermarkText) {
                                    var wt = String(opts.watermarkText);
                                    var size = Math.max(24, Math.min(w, h) / 8);
                                    var font = fontBold;
                                    var tw = font.widthOfTextAtSize(wt, size);
                                    pg.drawText(wt, {
                                        x: w / 2 - tw / 2 * Math.cos(Math.PI / 4),
                                        y: h / 2 - size / 2,
                                        size: size,
                                        font: font,
                                        color: PDFLib.rgb(0.6, 0.6, 0.6),
                                        opacity: opts.wmOpacity != null ? opts.wmOpacity : 0.3,
                                        rotate: PDFLib.degrees(opts.wmAngle != null ? opts.wmAngle : 45)
                                    });
                                }
                                var header = String(opts.headerText || '').trim();
                                var footer = String(opts.footerText || '').trim();
                                var fs = 10;
                                if (header) {
                                    pg.drawText(header, {
                                        x: 24, y: h - 18, size: fs, font: fontReg,
                                        color: PDFLib.rgb(0.35, 0.35, 0.35)
                                    });
                                }
                                if (footer) {
                                    pg.drawText(footer, {
                                        x: 24, y: 14, size: fs, font: fontReg,
                                        color: PDFLib.rgb(0.35, 0.35, 0.35)
                                    });
                                }
                                if (opts.pageNumbers) {
                                    var pn = t('Page', '第', '第') + ' ' + (pi + 1) +
                                        ' ' + t('of', '页，共', '頁，共') + ' ' + pages.length;
                                    var pw = fontReg.widthOfTextAtSize(pn, fs);
                                    pg.drawText(pn, {
                                        x: w - pw - 24, y: 14, size: fs, font: fontReg,
                                        color: PDFLib.rgb(0.35, 0.35, 0.35)
                                    });
                                }
                            });
                            return doc.save();
                        });
                    });
                });
            });
        });
    }

    function openWatermarkModal() {
        if (!pdfBytes) return;
        closeWatermarkModal();
        _watermarkOv = document.createElement('div');
        _watermarkOv.className = 'pde-print-overlay';
        _watermarkOv.innerHTML =
            '<div class="pde-print-modal" role="dialog">' +
                '<h2>' + esc(t('Watermark & headers', '水印与页眉页脚', '浮水印與頁眉頁腳')) + '</h2>' +
                '<label class="pde-print-field pde-print-field--full"><span>' +
                    esc(t('Diagonal watermark', '对角水印', '對角浮水印')) + '</span>' +
                    '<input id="pde_wm_text" type="text" placeholder="' + esc(t('CONFIDENTIAL', '机密', '機密')) + '"></label>' +
                '<label class="pde-print-field"><span>' + esc(t('Opacity', '不透明度', '不透明度')) + '</span>' +
                    '<input id="pde_wm_opacity" type="range" min="10" max="80" value="30"></label>' +
                '<label class="pde-print-field pde-print-field--full"><span>' + esc(t('Header (top left)', '页眉（左上）', '頁眉（左上）')) + '</span>' +
                    '<input id="pde_wm_header" type="text"></label>' +
                '<label class="pde-print-field pde-print-field--full"><span>' + esc(t('Footer (bottom left)', '页脚（左下）', '頁腳（左下）')) + '</span>' +
                    '<input id="pde_wm_footer" type="text"></label>' +
                '<label class="pde-print-check"><input type="checkbox" id="pde_wm_pagenum" checked> ' +
                    esc(t('Page numbers (bottom right)', '页码（右下）', '頁碼（右下）')) + '</label>' +
                '<label class="pde-print-field"><span>' + esc(t('Apply to', '应用于', '套用於')) + '</span>' +
                    '<select id="pde_wm_scope"><option value="all">' + esc(t('All pages', '全部页面', '全部頁面')) +
                    '</option><option value="current">' + esc(t('Current page only', '仅当前页', '僅目前頁')) + '</option></select></label>' +
                '<div class="pde-print-actions">' +
                    '<button type="button" class="ct-btn" id="pde_wm_cancel">' + esc(t('Cancel', '取消', '取消')) + '</button>' +
                    '<button type="button" class="ct-btn ct-btn-primary" id="pde_wm_apply">' + esc(t('Apply', '应用', '套用')) + '</button>' +
                '</div></div>';
        document.body.appendChild(_watermarkOv);
        gg('pde_wm_cancel').addEventListener('click', closeWatermarkModal);
        _watermarkOv.addEventListener('click', function (e) { if (e.target === _watermarkOv) closeWatermarkModal(); });
        gg('pde_wm_apply').addEventListener('click', function () {
            var opts = {
                watermarkText: (gg('pde_wm_text').value || '').trim(),
                headerText: gg('pde_wm_header').value,
                footerText: gg('pde_wm_footer').value,
                pageNumbers: gg('pde_wm_pagenum').checked,
                wmOpacity: (parseInt(gg('pde_wm_opacity').value, 10) || 30) / 100,
                scope: gg('pde_wm_scope').value || 'all'
            };
            if (!opts.watermarkText && !opts.headerText && !opts.footerText && !opts.pageNumbers) {
                alert(t('Enter watermark, header, footer, or enable page numbers.', '请输入水印、页眉、页脚或启用页码。', '請輸入浮水印、頁眉、頁腳或啟用頁碼。'));
                return;
            }
            closeWatermarkModal();
            setStatus(t('Applying watermark…', '应用水印中…', '套用浮水印中…'), 'work');
            applyWatermarkAndHeaders(opts).then(function (newBytes) {
                pdfBytes = newBytes;
                pdfPassword = null;
                return reloadPdfDocument({ pageNum: pageNum, keepAnnotations: false });
            }).then(function () {
                setStatus(t('Watermark applied.', '水印已应用。', '浮水印已套用。'), 'ok');
                pdeAuditLog('WATERMARK', { scope: opts.scope || 'all' });
            }).catch(function (e) {
                setStatus(t('Failed: ', '失败：', '失敗：') + (e && e.message || e), 'bad');
            });
        });
    }

    function compressPdfBytes(quality) {
        quality = numVal(quality) || 0.6;
        return ensurePdfJs().then(function (pdfjsLib) {
            return ensureJsPdf().then(function (jsPDF) {
                return getPdfJsDocument(pdfBytes).then(function (pdf) {
                    var out = null;
                    var chain = Promise.resolve();
                    for (var i = 1; i <= pdf.numPages; i++) {
                        (function (n) {
                            chain = chain.then(function () {
                                return pdf.getPage(n).then(function (page) {
                                    var vp = page.getViewport({ scale: 1.5 });
                                    var c = document.createElement('canvas');
                                    c.width = vp.width;
                                    c.height = vp.height;
                                    return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
                                        var img = c.toDataURL('image/jpeg', quality);
                                        var orient = vp.width > vp.height ? 'l' : 'p';
                                        if (!out) out = new jsPDF({ unit: 'pt', format: [vp.width, vp.height], orientation: orient });
                                        else out.addPage([vp.width, vp.height], orient);
                                        out.addImage(img, 'JPEG', 0, 0, vp.width, vp.height);
                                    });
                                });
                            });
                        })(i);
                    }
                    return chain.then(function () {
                        if (!out) throw new Error('compress empty');
                        return out.output('arraybuffer');
                    });
                });
            });
        });
    }

    function openCompressModal() {
        if (!pdfBytes) return;
        closeCompressModal();
        var origSize = pdfBytes.byteLength || pdfBytes.length || 0;
        _compressOv = document.createElement('div');
        _compressOv.className = 'pde-print-overlay';
        _compressOv.innerHTML =
            '<div class="pde-print-modal" role="dialog">' +
                '<h2>' + esc(t('Compress PDF', '压缩 PDF', '壓縮 PDF')) + '</h2>' +
                '<p class="pde-pages-hint">' + esc(t(
                    'Re-renders pages as JPEG images. Text will no longer be selectable. Original size: ',
                    '将页面重绘为 JPEG 图片。文字将无法再选取。原始大小：',
                    '將頁面重繪為 JPEG 圖片。文字將無法再選取。原始大小：')) + fmtBytes(origSize) + '</p>' +
                '<label class="pde-print-field"><span>' + esc(t('JPEG quality', 'JPEG 质量', 'JPEG 品質')) + '</span>' +
                    '<input id="pde_compress_q" type="range" min="30" max="90" step="5" value="60">' +
                    ' <em id="pde_compress_q_lbl">60%</em></label>' +
                '<p id="pde_compress_result" class="pde-pages-meta"></p>' +
                '<label class="pde-print-check"><input type="checkbox" id="pde_compress_download" checked> ' +
                    esc(t('Download compressed PDF', '下载压缩 PDF', '下載壓縮 PDF')) + '</label>' +
                '<label class="pde-print-check"><input type="checkbox" id="pde_compress_load" checked> ' +
                    esc(t('Open compressed PDF in editor', '在编辑器中打开', '在編輯器中開啟')) + '</label>' +
                '<div class="pde-print-actions">' +
                    '<button type="button" class="ct-btn" id="pde_compress_cancel">' + esc(t('Cancel', '取消', '取消')) + '</button>' +
                    '<button type="button" class="ct-btn ct-btn-primary" id="pde_compress_go">' + esc(t('Compress', '压缩', '壓縮')) + '</button>' +
                '</div></div>';
        document.body.appendChild(_compressOv);
        var qR = gg('pde_compress_q');
        var qL = gg('pde_compress_q_lbl');
        if (qR && qL) qR.addEventListener('input', function () { qL.textContent = qR.value + '%'; });
        gg('pde_compress_cancel').addEventListener('click', closeCompressModal);
        _compressOv.addEventListener('click', function (e) { if (e.target === _compressOv) closeCompressModal(); });
        gg('pde_compress_go').addEventListener('click', function () {
            var q = (parseInt(gg('pde_compress_q').value, 10) || 60) / 100;
            var dlOn = gg('pde_compress_download').checked;
            var loadOn = gg('pde_compress_load').checked;
            if (!dlOn && !loadOn) {
                alert(t('Choose download and/or open in editor.', '请选择下载和/或在编辑器中打开。', '請選擇下載和/或在編輯器中開啟。'));
                return;
            }
            var btn = gg('pde_compress_go');
            if (btn) btn.disabled = true;
            closeCompressModal();
            setStatus(t('Compressing…', '压缩中…', '壓縮中…'), 'work');
            showPdeProgress(t('Compressing…', '压缩中…', '壓縮中…'), 20);
            compressPdfBytes(q).then(function (arr) {
                showPdeProgress(t('Compressing…', '压缩中…', '壓縮中…'), 75);
                var newBytes = arr;
                var resEl = gg('pde_compress_result');
                var msg = fmtBytes(origSize) + ' → ' + fmtBytes(newBytes.byteLength || newBytes.length);
                if (dlOn) {
                    var base = fileName.replace(/\.pdf$/i, '') || 'document';
                    dl(new Blob([newBytes], { type: 'application/pdf' }), base + '_compressed.pdf');
                }
                if (loadOn) {
                    pdfBytes = newBytes;
                    pdfPassword = null;
                    return reloadPdfDocument({ pageNum: 0, keepAnnotations: false, keepOcr: false, keepSearch: false });
                }
            }).then(function () {
                hidePdeProgress();
                setStatus(t('Compression complete.', '压缩完成。', '壓縮完成。'), 'ok');
            }).catch(function (e) {
                hidePdeProgress();
                setStatus(t('Compress failed: ', '压缩失败：', '壓縮失敗：') + (e && e.message || e), 'bad');
            }).finally(function () {
                if (btn) btn.disabled = false;
            });
        });
    }

    // ── tier-2: review comments, stamp library, form fill ────────
    var _stampOv = null;
    var _formsOv = null;

    function closeStampPicker() {
        if (_stampOv && _stampOv.parentNode) _stampOv.parentNode.removeChild(_stampOv);
        _stampOv = null;
    }

    function closeFormsModal() {
        if (_formsOv && _formsOv.parentNode) _formsOv.parentNode.removeChild(_formsOv);
        _formsOv = null;
    }

    function scanPdfForms() {
        pdfFormFields = [];
        if (!pdfBytes) {
            pdfFormValues = {};
            return Promise.resolve();
        }
        return ensurePdfLib().then(function (PDFLib) {
            return loadPdfLibDocument(pdfBytes).then(function (doc) {
                try {
                    var form = doc.getForm();
                    form.getFields().forEach(function (field) {
                        var name = field.getName();
                        var kind = 'text';
                        var cn = field.constructor && field.constructor.name ? field.constructor.name : '';
                        if (cn.indexOf('CheckBox') >= 0) kind = 'checkbox';
                        else if (cn.indexOf('Dropdown') >= 0 || cn.indexOf('Option') >= 0) kind = 'dropdown';
                        else if (cn.indexOf('Radio') >= 0) kind = 'radio';
                        var entry = { name: name, kind: kind, options: [] };
                        try {
                            if (kind === 'dropdown' && field.getOptions) entry.options = field.getOptions();
                            if (kind === 'checkbox' && field.isChecked) {
                                if (pdfFormValues[name] == null) pdfFormValues[name] = !!field.isChecked();
                            } else if (field.getText) {
                                if (pdfFormValues[name] == null) pdfFormValues[name] = field.getText() || '';
                            }
                        } catch (e2) {}
                        pdfFormFields.push(entry);
                    });
                } catch (e) {}
            });
        }).catch(function () { return null; });
    }

    function applyFormValuesToDoc(doc) {
        if (!pdfFormValues || !Object.keys(pdfFormValues).length) return;
        try {
            var form = doc.getForm();
            Object.keys(pdfFormValues).forEach(function (name) {
                try {
                    var field = form.getField(name);
                    if (!field) return;
                    var val = pdfFormValues[name];
                    if (field.setText) field.setText(String(val != null ? val : ''));
                    else if (field.check && field.uncheck) {
                        if (val) field.check(); else field.uncheck();
                    } else if (field.select) field.select(String(val));
                } catch (e2) {}
            });
        } catch (e) {}
    }

    function openStampPicker() {
        closeStampPicker();
        var custom = loadCustomStamps();
        var presetHtml = allStampPresets().map(function (s) {
            var preview = resolveStampTokens(s.text);
            return '<button type="button" class="pde-stamp-pick" data-stamp-text="' + esc(s.text) +
                '" data-stamp-color="' + esc(s.color || '#dc2626') + '" style="border-color:' +
                esc(s.color || '#dc2626') + ';color:' + esc(s.color || '#dc2626') + '">' +
                esc(preview) + '</button>';
        }).join('');
        var customHtml = custom.map(function (s, i) {
            return '<div class="pde-stamp-custom-row">' +
                '<button type="button" class="pde-stamp-pick" data-stamp-text="' + esc(s.text) +
                '" data-stamp-color="' + esc(s.color || '#dc2626') + '">' + esc(resolveStampTokens(s.text)) + '</button>' +
                '<button type="button" class="pde-stamp-del" data-stamp-idx="' + i + '" title="' +
                esc(t('Remove', '删除', '刪除')) + '">×</button></div>';
        }).join('');
        _stampOv = document.createElement('div');
        _stampOv.className = 'pde-print-overlay';
        _stampOv.innerHTML =
            '<div class="pde-print-modal pde-stamp-modal" role="dialog">' +
                '<h2>' + esc(t('Stamp library', '图章库', '圖章庫')) + '</h2>' +
                '<p class="pde-pages-hint">' + esc(t('Pick a stamp, then click on the page to place it.', '选择图章后点击页面放置。', '選擇圖章後點擊頁面放置。')) + '</p>' +
                '<div class="pde-stamp-grid">' + presetHtml + '</div>' +
                (customHtml ? '<h3>' + esc(t('Custom stamps', '自定义图章', '自訂圖章')) + '</h3><div class="pde-stamp-custom">' + customHtml + '</div>' : '') +
                '<div class="pde-stamp-add">' +
                    '<label>' + esc(t('New stamp', '新建图章', '新建圖章')) +
                    '<input type="text" id="pde_stamp_new_text" placeholder="{date} APPROVED"></label>' +
                    '<input type="color" id="pde_stamp_new_color" value="#dc2626">' +
                    '<button type="button" class="ct-btn" id="pde_stamp_save_custom">' + esc(t('Save custom', '保存自定义', '儲存自訂')) + '</button>' +
                '</div>' +
                '<div class="pde-print-actions">' +
                    '<button type="button" class="ct-btn" id="pde_stamp_cancel">' + esc(t('Cancel', '取消', '取消')) + '</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(_stampOv);
        gg('pde_stamp_cancel').addEventListener('click', closeStampPicker);
        gg('pde_stamp_save_custom').addEventListener('click', function () {
            var txt = (gg('pde_stamp_new_text').value || '').trim();
            if (!txt) return;
            var col = gg('pde_stamp_new_color').value || '#dc2626';
            var list = loadCustomStamps();
            list.push({ id: 'custom_' + Date.now(), text: txt, color: col });
            saveCustomStamps(list);
            closeStampPicker();
            openStampPicker();
        });
        _stampOv.querySelectorAll('.pde-stamp-pick').forEach(function (btn) {
            btn.addEventListener('click', function () {
                pendingStampText = btn.getAttribute('data-stamp-text');
                pendingStampColor = btn.getAttribute('data-stamp-color') || '#dc2626';
                props.stampText = pendingStampText;
                placeMode = 'stamp';
                closeStampPicker();
                setTool('select', { keepPlace: true, keepSelect: true });
                olCanvas.classList.add('pde-cursor-place');
                setStatus(t('Click to place stamp.', '点击放置图章。', '點擊放置圖章。'));
            });
        });
        _stampOv.querySelectorAll('.pde-stamp-del').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(btn.getAttribute('data-stamp-idx'), 10);
                var list = loadCustomStamps();
                if (idx >= 0 && idx < list.length) {
                    list.splice(idx, 1);
                    saveCustomStamps(list);
                    closeStampPicker();
                    openStampPicker();
                }
            });
        });
    }

    function openFormsModal() {
        closeFormsModal();
        if (!pdfBytes) return;
        setStatus(t('Scanning form fields…', '扫描表单字段…', '掃描表單欄位…'), 'work');
        scanPdfForms().then(function () {
            if (!pdfFormFields.length) {
                alert(t('No fillable form fields found in this PDF.', '此 PDF 没有可填写的表单字段。', '此 PDF 沒有可填寫的表單欄位。'));
                setStatus(t('Ready.', '就绪。', '就緒。'));
                return;
            }
            var fieldsHtml = pdfFormFields.map(function (f) {
                var val = pdfFormValues[f.name];
                if (f.kind === 'checkbox') {
                    return '<label class="pde-form-field pde-form-check"><input type="checkbox" data-form-name="' +
                        esc(f.name) + '"' + (val ? ' checked' : '') + '> ' + esc(f.name) + '</label>';
                }
                if (f.kind === 'dropdown' && f.options && f.options.length) {
                    var opts = f.options.map(function (o) {
                        return '<option value="' + esc(o) + '"' + (String(val) === String(o) ? ' selected' : '') + '>' + esc(o) + '</option>';
                    }).join('');
                    return '<label class="pde-form-field"><span>' + esc(f.name) + '</span><select data-form-name="' +
                        esc(f.name) + '">' + opts + '</select></label>';
                }
                return '<label class="pde-form-field"><span>' + esc(f.name) + '</span><input type="text" data-form-name="' +
                    esc(f.name) + '" value="' + esc(val != null ? val : '') + '"></label>';
            }).join('');
            _formsOv = document.createElement('div');
            _formsOv.className = 'pde-print-overlay';
            _formsOv.innerHTML =
                '<div class="pde-print-modal pde-forms-modal" role="dialog">' +
                    '<h2>' + esc(t('Fill PDF form', '填写 PDF 表单', '填寫 PDF 表單')) + '</h2>' +
                    '<p class="pde-pages-hint">' + esc(t('Values are applied when you save or export the PDF.', '保存或导出 PDF 时将应用这些值。', '儲存或匯出 PDF 時將套用這些值。')) + '</p>' +
                    '<div class="pde-forms-list">' + fieldsHtml + '</div>' +
                    '<div class="pde-print-actions">' +
                        '<button type="button" class="ct-btn" id="pde_forms_cancel">' + esc(t('Cancel', '取消', '取消')) + '</button>' +
                        '<button type="button" class="ct-btn ct-btn-primary" id="pde_forms_apply">' + esc(t('Apply', '应用', '套用')) + '</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(_formsOv);
            gg('pde_forms_cancel').addEventListener('click', closeFormsModal);
            gg('pde_forms_apply').addEventListener('click', function () {
                _formsOv.querySelectorAll('[data-form-name]').forEach(function (el) {
                    var name = el.getAttribute('data-form-name');
                    if (el.type === 'checkbox') pdfFormValues[name] = el.checked;
                    else pdfFormValues[name] = el.value;
                });
                closeFormsModal();
                setStatus(t('Form values saved — export to apply.', '表单值已保存 — 导出以应用。', '表單值已儲存 — 匯出以套用。'), 'ok');
            });
            setStatus(t('Ready.', '就绪。', '就緒。'));
        });
    }

    // ── tier-3: patient link, templates, batch, audit ───────────
    function pdeAuditLog(action, detail) {
        if (typeof recordAuditTrail !== 'function') return;
        detail = detail || {};
        var item = 'PDF EDITOR ' + String(action || 'ACTION').replace(/_/g, ' ');
        recordAuditTrail({
            audit_item: item,
            table_name: 'pdf_editor',
            operation: 'ACTION',
            patient_no: (pdePatient && pdePatient.patient_no) || detail.patient_no || null,
            changes_detail: detail.summary || JSON.stringify(detail),
            payload: detail
        });
    }

    function pdeMarkDirty() {
        pdeDirty = true;
        var badge = gg('pde_dirty_badge');
        if (badge) badge.style.display = 'inline';
    }

    function pdeClearDirty() {
        pdeDirty = false;
        var badge = gg('pde_dirty_badge');
        if (badge) badge.style.display = 'none';
    }

    function pdeResolveActivePatient() {
        if (typeof conFormsPatientData !== 'undefined' && conFormsPatientData && conFormsPatientData.id) {
            return conFormsPatientData;
        }
        if (typeof conPatientData !== 'undefined' && conPatientData && conPatientData.id) {
            return conPatientData;
        }
        return null;
    }

    function pdeNormalizeTemplateMeta(tpl) {
        if (!tpl) return null;
        return {
            id: tpl.id || null,
            template_code: tpl.template_code || tpl.code || null,
            template_name: tpl.template_name || tpl.name || null,
            template_type: tpl.template_type || tpl.type || 'pdf'
        };
    }

    function pdeDefaultDocumentName() {
        if (pdeDocMeta && pdeDocMeta.document_name) return String(pdeDocMeta.document_name);
        if (pdeDocMeta && pdeDocMeta.template_name) return String(pdeDocMeta.template_name);
        var base = fileName.replace(/\.pdf$/i, '') || 'document';
        return base;
    }

    function pdeBuildExportFilename(kind, ext) {
        var pno = pdePatient && pdePatient.patient_no
            ? String(pdePatient.patient_no).replace(/[^\w\-]/g, '_') : 'doc';
        var formType = (pdeDocMeta && pdeDocMeta.template_code)
            ? String(pdeDocMeta.template_code).replace(/[^\w\-]/g, '_')
            : (kind || 'pdf');
        var dateStr = typeof todayISO === 'function' ? todayISO() : new Date().toISOString().slice(0, 10);
        return pno + '_' + formType + '_' + dateStr + (ext || '.pdf');
    }

    function pdePlaceholderMap() {
        var p = pdePatient || {};
        var clinicName = pdeClinicLabel();
        var now = typeof nowLocal === 'function' ? nowLocal() : new Date();
        return {
            patient_no: p.patient_no || '',
            patient_name: p.full_name || '',
            patient_chinese_name: p.chinese_name || '',
            patient_phone: p.mobile_phone || p.phone_number || '',
            patient_hkid: p.hkid || '',
            patient_dob: p.dob || '',
            patient_address: p.address || '',
            doctor_name: getPdeAuthor(),
            clinic_name: clinicName,
            date: typeof todayISO === 'function' ? todayISO() : now.toISOString().slice(0, 10),
            time: now.toTimeString().slice(0, 5)
        };
    }

    function updatePdePatientBanner() {
        var bar = gg('pde_patient_bar');
        var lbl = gg('pde_patient_label');
        if (!bar || !lbl) return;
        if (pdePatient && pdePatient.id) {
            var name = pdePatient.full_name || pdePatient.patient_no || pdePatient.id;
            var meta = pdeDocMeta && pdeDocMeta.template_name
                ? ' · ' + pdeDocMeta.template_name : '';
            lbl.textContent = t('Patient', '患者', '患者') + ': ' + name +
                (pdePatient.patient_no ? ' (' + pdePatient.patient_no + ')' : '') + meta;
            bar.style.display = 'flex';
        } else {
            bar.style.display = 'none';
        }
        ['pde_save_patient', 'pde_sign_file', 'pde_fill_fields'].forEach(function (id) {
            var b = gg(id);
            if (b) b.disabled = !(pdePatient && pdePatient.id && pdfBytes);
        });
    }

    function fetchPatientById(pid) {
        if (!pid || typeof SB === 'undefined') return Promise.resolve(null);
        return SB.from('patients').select('*').eq('id', pid).single().then(function (r) {
            if (r.error || !r.data) return null;
            return r.data;
        }).catch(function () { return null; });
    }

    function pdeGetPublicUrl(path) {
        if (typeof SB === 'undefined' || !SB.storage || !path) return null;
        try {
            var ur = SB.storage.from(PDF_DOC_BUCKET).getPublicUrl(path);
            return ur.data && ur.data.publicUrl ? ur.data.publicUrl : null;
        } catch (e) { return null; }
    }

    function watermarkPdfBytes(bytes, opts) {
        opts = opts || {};
        return ensurePdfLib().then(function (PDFLib) {
            return loadPdfLibDocument(bytes).then(function (doc) {
                return doc.embedFont(PDFLib.StandardFonts.Helvetica).then(function (fontReg) {
                    return doc.embedFont(PDFLib.StandardFonts.HelveticaBold).then(function (fontBold) {
                        var pages = doc.getPages();
                        pages.forEach(function (pg, pi) {
                            if (opts.scope === 'current' && pi !== pageNum) return;
                            var w = pg.getWidth();
                            var h = pg.getHeight();
                            if (opts.watermarkText) {
                                var wt = String(opts.watermarkText);
                                var size = Math.max(24, Math.min(w, h) / 8);
                                var tw = fontBold.widthOfTextAtSize(wt, size);
                                pg.drawText(wt, {
                                    x: w / 2 - tw / 2 * Math.cos(Math.PI / 4),
                                    y: h / 2 - size / 2,
                                    size: size,
                                    font: fontBold,
                                    color: PDFLib.rgb(0.6, 0.6, 0.6),
                                    opacity: opts.wmOpacity != null ? opts.wmOpacity : 0.3,
                                    rotate: PDFLib.degrees(45)
                                });
                            }
                            if (opts.pageNumbers) {
                                var pn = t('Page', '第', '第') + ' ' + (pi + 1) +
                                    ' ' + t('of', '页，共', '頁，共') + ' ' + pages.length;
                                var pw = fontReg.widthOfTextAtSize(pn, 10);
                                pg.drawText(pn, {
                                    x: w - pw - 24, y: 14, size: 10, font: fontReg,
                                    color: PDFLib.rgb(0.35, 0.35, 0.35)
                                });
                            }
                        });
                        return doc.save();
                    });
                });
            });
        });
    }

    function buildExportBytes(mode) {
        mode = mode || 'internal';
        return buildFlattenedPdfBytes().then(function (bytes) {
            if (mode === 'patient') {
                return watermarkPdfBytes(bytes, {
                    watermarkText: t('PATIENT COPY', '患者副本', '患者副本'),
                    wmOpacity: 0.28,
                    scope: 'all',
                    pageNumbers: true
                });
            }
            return bytes;
        });
    }

    function savePdfToPatientRecord(bytes, docName) {
        if (!pdePatient || !pdePatient.id) {
            return Promise.reject(new Error(t('Link a patient first.', '请先关联患者。', '請先關聯患者。')));
        }
        if (typeof SB === 'undefined') {
            return Promise.reject(new Error(t('Database not available.', '数据库不可用。', '資料庫不可用。')));
        }
        docName = String(docName || '').trim() || pdeDefaultDocumentName();
        var fname = pdeBuildExportFilename('document', '.pdf');
        var path = pdePatient.id + '/' + Date.now() + '_' + fname.replace(/[^\w.\-]/g, '_');
        return SB.storage.from(PDF_DOC_BUCKET).upload(path, bytes, {
            cacheControl: '3600',
            upsert: false,
            contentType: 'application/pdf'
        }).then(function (up) {
            if (up.error) throw up.error;
            var url = pdeGetPublicUrl(path);
            var html = '<div class="pde-saved-pdf" data-file-path="' + esc(path) + '">' +
                '<p>PDF: <a href="' + esc(url || '#') + '" target="_blank" rel="noopener">' +
                esc(docName) + '</a></p></div>';
            var payload = {
                patient_id: pdePatient.id,
                patient_no: pdePatient.patient_no || null,
                patient_name: pdePatient.full_name || null,
                doctor_name: getPdeAuthor(),
                template_id: (pdeDocMeta && pdeDocMeta.id) || null,
                template_code: (pdeDocMeta && pdeDocMeta.template_code) || null,
                template_name: (pdeDocMeta && pdeDocMeta.template_name) || null,
                template_type: 'pdf',
                document_name: docName,
                document_date: typeof todayISO === 'function' ? todayISO() : new Date().toISOString().slice(0, 10),
                content_html: html
            };
            return SB.from('patient_documents').insert([payload]).select('id');
        }).then(function (r) {
            if (r.error) throw r.error;
            pdeClearDirty();
            pdeAuditLog('SAVE_TO_PATIENT', {
                summary: docName,
                document_name: docName,
                patient_no: pdePatient.patient_no
            });
            if (typeof refreshConFormsDocs === 'function') refreshConFormsDocs();
            return r.data && r.data[0] ? r.data[0].id : null;
        });
    }

    function closeSavePatientModal() {
        if (_savePatientOv && _savePatientOv.parentNode) _savePatientOv.parentNode.removeChild(_savePatientOv);
        _savePatientOv = null;
    }

    function openSaveToPatientModal(opts) {
        opts = opts || {};
        closeSavePatientModal();
        if (!pdePatient || !pdePatient.id) {
            openLinkPatientModal(function () { openSaveToPatientModal(opts); });
            return;
        }
        if (!pdfBytes) return;
        _savePatientOv = document.createElement('div');
        _savePatientOv.className = 'pde-print-overlay';
        _savePatientOv.innerHTML =
            '<div class="pde-print-modal" role="dialog">' +
                '<h2>' + esc(t('Save to patient record', '保存到患者档案', '儲存到患者檔案')) + '</h2>' +
                '<p class="pde-pages-hint">' + esc(
                    t('Filename: {patient_no}_{form}_{date}.pdf', '文件名：{patient_no}_{form}_{date}.pdf', '檔名：{patient_no}_{form}_{date}.pdf')
                        .replace('{patient_no}', pdePatient.patient_no || '—')
                        .replace('{form}', (pdeDocMeta && pdeDocMeta.template_code) || 'pdf')
                        .replace('{date}', typeof todayISO === 'function' ? todayISO() : '')) +
                '</p>' +
                '<label class="pde-print-field pde-print-field--full"><span>' +
                    esc(t('Document name', '文件名称', '文件名稱')) + '</span>' +
                    '<input id="pde_save_doc_name" type="text" value="' + esc(pdeDefaultDocumentName()) + '"></label>' +
                '<label class="pde-print-check"><input type="checkbox" id="pde_save_patient_copy"' +
                    (opts.patientCopy ? ' checked' : '') + '> ' +
                    esc(t('Apply "PATIENT COPY" watermark', '添加「患者副本」水印', '添加「患者副本」浮水印')) + '</label>' +
                '<div class="pde-print-actions">' +
                    '<button type="button" class="ct-btn" id="pde_save_pat_cancel">' + esc(t('Cancel', '取消', '取消')) + '</button>' +
                    '<button type="button" class="ct-btn ct-btn-primary" id="pde_save_pat_go">' +
                        esc(opts.signAndFile ? t('Sign & file', '签名并归档', '簽名並歸檔') : t('Save', '保存', '儲存')) +
                    '</button>' +
                '</div></div>';
        document.body.appendChild(_savePatientOv);
        gg('pde_save_pat_cancel').addEventListener('click', closeSavePatientModal);
        gg('pde_save_pat_go').addEventListener('click', function () {
            var docName = (gg('pde_save_doc_name').value || '').trim();
            if (!docName) {
                alert(t('Enter a document name.', '请输入文件名称。', '請輸入文件名稱。'));
                return;
            }
            var patientCopy = gg('pde_save_patient_copy') && gg('pde_save_patient_copy').checked;
            var btn = gg('pde_save_pat_go');
            if (btn) btn.disabled = true;
            closeSavePatientModal();
            setStatus(t('Saving to patient…', '保存到患者档案…', '儲存到患者檔案…'), 'work');
            buildExportBytes(patientCopy ? 'patient' : 'internal').then(function (bytes) {
                return savePdfToPatientRecord(bytes, docName);
            }).then(function () {
                setStatus(t('Saved to patient record.', '已保存到患者档案。', '已儲存到患者檔案。'), 'ok');
            }).catch(function (e) {
                setStatus(t('Save failed: ', '保存失败：', '儲存失敗：') + (e && e.message || e), 'bad');
            }).finally(function () {
                if (btn) btn.disabled = false;
            });
        });
    }

    function closeLinkPatientModal() {
        if (_linkPatientOv && _linkPatientOv.parentNode) _linkPatientOv.parentNode.removeChild(_linkPatientOv);
        _linkPatientOv = null;
    }

    function openLinkPatientModal(onLinked) {
        closeLinkPatientModal();
        var active = pdeResolveActivePatient();
        _linkPatientOv = document.createElement('div');
        _linkPatientOv.className = 'pde-print-overlay';
        _linkPatientOv.innerHTML =
            '<div class="pde-print-modal" role="dialog">' +
                '<h2>' + esc(t('Link patient', '关联患者', '關聯患者')) + '</h2>' +
                (active
                    ? '<p class="pde-pages-hint">' + esc(t('Use active consultation patient?', '使用当前咨询患者？', '使用目前諮詢患者？')) +
                        '<br><strong>' + esc(active.full_name || active.patient_no || '') + '</strong></p>' +
                      '<button type="button" class="ct-btn ct-btn-primary pde-link-active-btn">' +
                        esc(t('Use active patient', '使用当前患者', '使用目前患者')) + '</button>'
                    : '<p class="pde-pages-hint">' + esc(t('Open a patient in Consultation first, or search by patient no.', '请先在咨询中打开患者，或按患者编号搜索。', '請先在諮詢中開啟患者，或按患者編號搜尋。')) + '</p>') +
                '<label class="pde-print-field pde-print-field--full"><span>' +
                    esc(t('Patient no.', '患者编号', '患者編號')) + '</span>' +
                    '<input id="pde_link_patient_no" type="text"></label>' +
                '<div class="pde-print-actions">' +
                    '<button type="button" class="ct-btn" id="pde_link_cancel">' + esc(t('Cancel', '取消', '取消')) + '</button>' +
                    '<button type="button" class="ct-btn ct-btn-primary" id="pde_link_search">' + esc(t('Link', '关联', '關聯')) + '</button>' +
                '</div></div>';
        document.body.appendChild(_linkPatientOv);
        gg('pde_link_cancel').addEventListener('click', closeLinkPatientModal);
        var activeBtn = _linkPatientOv.querySelector('.pde-link-active-btn');
        if (activeBtn) {
            activeBtn.addEventListener('click', function () {
                pdePatient = active;
                closeLinkPatientModal();
                updatePdePatientBanner();
                if (onLinked) onLinked();
            });
        }
        gg('pde_link_search').addEventListener('click', function () {
            var pno = (gg('pde_link_patient_no').value || '').trim();
            if (!pno) { alert(t('Enter patient no.', '请输入患者编号。', '請輸入患者編號。')); return; }
            if (typeof SB === 'undefined') return;
            SB.from('patients').select('*').eq('patient_no', pno).limit(1).then(function (r) {
                if (r.error || !r.data || !r.data.length) {
                    alert(t('Patient not found.', '未找到患者。', '未找到患者。'));
                    return;
                }
                pdePatient = r.data[0];
                closeLinkPatientModal();
                updatePdePatientBanner();
                if (onLinked) onLinked();
            });
        });
    }

    function applyPatientFieldAnnotations() {
        if (!pdePatient) {
            openLinkPatientModal(applyPatientFieldAnnotations);
            return;
        }
        var map = pdePlaceholderMap();
        var rows = [
            ['patient_name', map.patient_name],
            ['patient_no', map.patient_no],
            ['patient_chinese_name', map.patient_chinese_name],
            ['date', map.date],
            ['doctor_name', map.doctor_name],
            ['clinic_name', map.clinic_name]
        ];
        pushUndo();
        var y = 0.06;
        rows.forEach(function (row) {
            if (!row[1]) return;
            pageAnns().push(withAnnMeta({
                type: 'text',
                text: row[1],
                x: 0.08,
                y: y,
                size: 12,
                fontFamily: props.fontFamily,
                color: props.color,
                opacity: 1
            }));
            y += 0.035;
        });
        selectedIdx = pageAnns().length - 1;
        redrawOverlay();
        refreshPropsPanel();
        pdeMarkDirty();
        setStatus(t('Patient fields added.', '已添加患者字段。', '已新增患者欄位。'), 'ok');
    }

    function closeTemplateModal() {
        if (_templateOv && _templateOv.parentNode) _templateOv.parentNode.removeChild(_templateOv);
        _templateOv = null;
    }

    function openTemplatePickerModal() {
        closeTemplateModal();
        if (typeof SB === 'undefined') {
            alert(t('Database not available.', '数据库不可用。', '資料庫不可用。'));
            return;
        }
        setStatus(t('Loading templates…', '加载模板…', '載入模板…'), 'work');
        SB.from('doc_templates').select('id,template_code,template_name,template_type').order('template_code')
            .then(function (r) {
                setStatus(t('Ready.', '就绪。', '就緒。'));
                if (r.error) {
                    alert(t('Failed to load templates.', '加载模板失败。', '載入模板失敗。'));
                    return;
                }
                var rows = r.data || [];
                var opts = rows.map(function (tpl) {
                    return '<option value="' + esc(tpl.id) + '">' + esc(tpl.template_code + ' — ' + tpl.template_name) + '</option>';
                }).join('');
                _templateOv = document.createElement('div');
                _templateOv.className = 'pde-print-overlay';
                _templateOv.innerHTML =
                    '<div class="pde-print-modal" role="dialog">' +
                        '<h2>' + esc(t('Document template', '文件模板', '文件模板')) + '</h2>' +
                        '<p class="pde-pages-hint">' + esc(t(
                            'Select a template for naming and filing. Open your PDF form separately, then use Fill patient fields.',
                            '选择模板用于命名和归档。请单独打开 PDF 表单，然后使用「填充患者字段」。',
                            '選擇模板用於命名和歸檔。請單獨開啟 PDF 表單，然後使用「填充患者欄位」。')) + '</p>' +
                        '<label class="pde-print-field pde-print-field--full"><span>' + esc(t('Template', '模板', '模板')) + '</span>' +
                            '<select id="pde_tpl_sel"><option value="">—</option>' + opts + '</select></label>' +
                        '<label class="pde-print-field pde-print-field--full"><span>' + esc(t('Document name', '文件名称', '文件名稱')) + '</span>' +
                            '<input id="pde_tpl_doc_name" type="text"></label>' +
                        '<div class="pde-print-actions">' +
                            '<button type="button" class="ct-btn" id="pde_tpl_cancel">' + esc(t('Cancel', '取消', '取消')) + '</button>' +
                            '<button type="button" class="ct-btn ct-btn-primary" id="pde_tpl_apply">' + esc(t('Apply', '应用', '套用')) + '</button>' +
                        '</div></div>';
                document.body.appendChild(_templateOv);
                gg('pde_tpl_cancel').addEventListener('click', closeTemplateModal);
                var sel = gg('pde_tpl_sel');
                if (sel) {
                    sel.addEventListener('change', function () {
                        var id = sel.value;
                        var tpl = rows.filter(function (x) { return String(x.id) === String(id); })[0];
                        if (tpl && gg('pde_tpl_doc_name')) {
                            gg('pde_tpl_doc_name').value = tpl.template_name || tpl.template_code || '';
                        }
                    });
                }
                gg('pde_tpl_apply').addEventListener('click', function () {
                    var id = sel && sel.value;
                    if (!id) { alert(t('Select a template.', '请选择模板。', '請選擇模板。')); return; }
                    var tpl = rows.filter(function (x) { return String(x.id) === String(id); })[0];
                    pdeDocMeta = pdeNormalizeTemplateMeta(tpl);
                    pdeDocMeta.document_name = (gg('pde_tpl_doc_name').value || '').trim() || tpl.template_name;
                    closeTemplateModal();
                    updatePdePatientBanner();
                    if (!pdePatient) pdePatient = pdeResolveActivePatient();
                    updatePdePatientBanner();
                    setStatus(t('Template applied.', '模板已应用。', '模板已套用。'), 'ok');
                });
            });
    }

    function renderPageToCanvas(pi, scale) {
        scale = scale || 1.5;
        return pdfJsDoc.getPage(pi + 1).then(function (page) {
            var vp = page.getViewport({ scale: scale });
            var c = document.createElement('canvas');
            c.width = vp.width;
            c.height = vp.height;
            return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
                return c;
            });
        });
    }

    function runOcrAllPages(onProgress) {
        if (!pdfJsDoc) return Promise.reject(new Error(t('No PDF loaded.', '未加载 PDF。', '未載入 PDF。')));
        if (ocrBusy) return Promise.reject(new Error(t('OCR already running.', 'OCR 正在运行。', 'OCR 正在執行。')));
        var chain = Promise.resolve();
        for (var i = 0; i < pageCount; i++) {
            (function (pi) {
                chain = chain.then(function () {
                    showPdeProgress(t('OCR page ', 'OCR 第 ', 'OCR 第 ') + (pi + 1) + '/' + pageCount,
                        Math.round(((pi + 1) / pageCount) * 100));
                    setStatus(t('OCR page ', 'OCR 第 ', 'OCR 第 ') + (pi + 1) + '/' + pageCount + '…', 'work');
                    return renderPageToCanvas(pi).then(function (c) {
                        return runOcrOnCanvas(c, pi);
                    });
                });
            })(i);
        }
        return chain.then(function () {
            hidePdeProgress();
            setStatus(t('OCR all pages complete.', '全部页面 OCR 完成。', '全部頁面 OCR 完成。'), 'ok');
            pdeAuditLog('OCR_ALL', { pages: pageCount });
        }).catch(function (e) {
            hidePdeProgress();
            setStatus(t('OCR failed: ', 'OCR 失败：', 'OCR 失敗：') + (e && e.message || e), 'bad');
        });
    }

    function exportOcrDocument(format) {
        format = format || 'txt';
        var parts = [];
        var hasText = false;
        for (var i = 0; i < pageCount; i++) {
            var txt = ocrResultByPage[i] || '';
            if (txt.trim()) hasText = true;
            if (format === 'md') {
                parts.push('## ' + t('Page', '第', '第') + ' ' + (i + 1) + '\n\n' + txt);
            } else {
                parts.push('--- ' + t('Page', '第', '第') + ' ' + (i + 1) + ' ---\n' + txt);
            }
        }
        if (!hasText) {
            alert(t('Run OCR first (current page or all pages).', '请先运行 OCR（本页或全部页面）。', '請先執行 OCR（本頁或全部頁面）。'));
            return;
        }
        var blob = new Blob([parts.join('\n\n')], { type: 'text/plain;charset=utf-8' });
        dl(blob, pdeBuildExportFilename('ocr', format === 'md' ? '.md' : '.txt'));
        pdeAuditLog('EXPORT_OCR', { format: format, pages: pageCount });
    }

    function repeatSelectedAnnToAllPages() {
        if (selectedIdx < 0) {
            alert(t('Select an annotation first.', '请先选择一个标注。', '請先選擇一個標註。'));
            return;
        }
        var src = pageAnns()[selectedIdx];
        if (!src) return;
        var cloneTypes = ['stamp', 'signature', 'text', 'note', 'image'];
        if (cloneTypes.indexOf(src.type) < 0) {
            alert(t('Select a stamp, signature, text, note, or image to repeat.', '请选择图章、签名、文字、便笺或图片。', '請選擇圖章、簽名、文字、便箋或圖片。'));
            return;
        }
        pushUndo();
        for (var pi = 0; pi < pageCount; pi++) {
            if (pi === pageNum) continue;
            if (!annByPage[pi]) annByPage[pi] = [];
            var c = JSON.parse(JSON.stringify(src));
            delete c._img;
            annByPage[pi].push(withAnnMeta(c));
        }
        redrawOverlay();
        setStatus(t('Copied to all pages.', '已复制到全部页面。', '已複製到全部頁面。'), 'ok');
        pdeAuditLog('REPEAT_ANN', { type: src.type, pages: pageCount });
    }

    function closeBatchModal() {
        if (_batchOv && _batchOv.parentNode) _batchOv.parentNode.removeChild(_batchOv);
        _batchOv = null;
    }

    function openBatchModal() {
        closeBatchModal();
        if (!pdfBytes) return;
        _batchOv = document.createElement('div');
        _batchOv.className = 'pde-print-overlay';
        _batchOv.innerHTML =
            '<div class="pde-print-modal pde-batch-modal" role="dialog">' +
                '<h2>' + esc(t('Batch operations', '批量操作', '批次操作')) + '</h2>' +
                '<p id="pde_batch_progress" class="pde-pages-meta"></p>' +
                '<div class="pde-batch-actions">' +
                    '<button type="button" class="ct-btn" id="pde_batch_ocr_all">' + esc(t('OCR all pages', 'OCR 全部页面', 'OCR 全部頁面')) + '</button>' +
                    '<button type="button" class="ct-btn" id="pde_batch_ocr_txt">' + esc(t('Export OCR as .txt', '导出 OCR 为 .txt', '匯出 OCR 為 .txt')) + '</button>' +
                    '<button type="button" class="ct-btn" id="pde_batch_ocr_md">' + esc(t('Export OCR as .md', '导出 OCR 为 .md', '匯出 OCR 為 .md')) + '</button>' +
                    '<button type="button" class="ct-btn" id="pde_batch_wm_all">' + esc(t('Watermark all pages…', '全部页面水印…', '全部頁面浮水印…')) + '</button>' +
                    '<button type="button" class="ct-btn" id="pde_batch_repeat">' + esc(t('Repeat selected to all pages', '复制选中项到全部页', '複製選取項到全部頁')) + '</button>' +
                '</div>' +
                '<div class="pde-print-actions">' +
                    '<button type="button" class="ct-btn" id="pde_batch_close">' + esc(t('Close', '关闭', '關閉')) + '</button>' +
                '</div></div>';
        document.body.appendChild(_batchOv);
        gg('pde_batch_close').addEventListener('click', closeBatchModal);
        gg('pde_batch_ocr_all').addEventListener('click', function () {
            var prog = gg('pde_batch_progress');
            closeBatchModal();
            runOcrAllPages(function (cur, tot) {
                if (prog) prog.textContent = cur + ' / ' + tot;
            });
        });
        gg('pde_batch_ocr_txt').addEventListener('click', function () { exportOcrDocument('txt'); });
        gg('pde_batch_ocr_md').addEventListener('click', function () { exportOcrDocument('md'); });
        gg('pde_batch_wm_all').addEventListener('click', function () {
            closeBatchModal();
            openWatermarkModal();
        });
        gg('pde_batch_repeat').addEventListener('click', function () {
            closeBatchModal();
            repeatSelectedAnnToAllPages();
        });
    }

    function openExportModeModal() {
        if (!pdfBytes) return;
        var ov = document.createElement('div');
        ov.className = 'pde-print-overlay';
        ov.innerHTML =
            '<div class="pde-print-modal" role="dialog">' +
                '<h2>' + esc(t('Export PDF', '导出 PDF', '匯出 PDF')) + '</h2>' +
                '<p class="pde-pages-hint">' + esc(t('Choose export mode for download.', '选择导出模式以下载。', '選擇匯出模式以下載。')) + '</p>' +
                '<div class="pde-batch-actions">' +
                    '<button type="button" class="ct-btn ct-btn-primary" data-export-mode="internal">' +
                        esc(t('Internal copy', '内部副本', '內部副本')) + '</button>' +
                    '<button type="button" class="ct-btn" data-export-mode="patient">' +
                        esc(t('Patient copy (watermarked)', '患者副本（加水印）', '患者副本（加浮水印）')) + '</button>' +
                '</div>' +
                '<div class="pde-print-actions">' +
                    '<button type="button" class="ct-btn pde-export-cancel">' + esc(t('Cancel', '取消', '取消')) + '</button>' +
                '</div></div>';
        document.body.appendChild(ov);
        ov.querySelector('.pde-export-cancel').addEventListener('click', function () {
            ov.parentNode.removeChild(ov);
        });
        ov.querySelectorAll('[data-export-mode]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var mode = btn.getAttribute('data-export-mode');
                ov.parentNode.removeChild(ov);
                exportPdfDownload(mode);
            });
        });
    }

    function exportPdfDownload(mode) {
        if (!pdfBytes) return;
        mode = mode || 'internal';
        setStatus(t('Exporting…', '导出中…', '匯出中…'), 'work');
        var saveBtn = gg('pde_save');
        if (saveBtn) saveBtn.disabled = true;
        showPdeProgress(t('Exporting PDF…', '导出 PDF 中…', '匯出 PDF 中…'), 10);
        buildExportBytes(mode).then(function (bytes) {
            showPdeProgress(t('Exporting PDF…', '导出 PDF 中…', '匯出 PDF 中…'), 85);
            var fname = pdeBuildExportFilename('document', '.pdf');
            if (!pdePatient) fname = (fileName.replace(/\.pdf$/i, '') || 'document') + '_edited.pdf';
            dl(new Blob([bytes], { type: 'application/pdf' }), fname);
            pdeClearDirty();
            pdeAuditLog(mode === 'patient' ? 'EXPORT_PATIENT_COPY' : 'EXPORT', {
                file: fname,
                patient_no: pdePatient && pdePatient.patient_no
            });
            setStatus(t('Saved successfully.', '保存成功。', '儲存成功。'), 'ok');
        }).catch(function (e) {
            setStatus(t('Export failed: ', '导出失败：', '匯出失敗：') + (e && e.message || e), 'bad');
        }).then(function () {
            hidePdeProgress();
            if (saveBtn) saveBtn.disabled = false;
        });
    }

    // ── tier-4: UX polish — recent, views, compare, shortcuts ────
    function pdeConfirmLeave(proceed) {
        if (!pdeDirty) {
            if (proceed) proceed();
            return;
        }
        var ok = confirm(t(
            'You have unsaved changes. Leave without saving?',
            '有未保存的更改。不保存并离开？',
            '有未儲存的變更。不儲存並離開？'));
        if (ok) {
            pdeClearDirty();
            if (proceed) proceed();
        }
    }

    function wireNavigationGuard() {
        if (_pdeNavGuardWired) return;
        _pdeNavGuardWired = true;
        var back = gg('pdfEditorBack');
        if (back) {
            back.addEventListener('click', function (e) {
                if (!pdeDirty) return;
                e.preventDefault();
                e.stopImmediatePropagation();
                pdeConfirmLeave(function () {
                    if (typeof showOnly === 'function') showOnly('toolsSection');
                });
            }, true);
        }
        if (!_pdeBeforeUnloadWired) {
            _pdeBeforeUnloadWired = true;
            window.addEventListener('beforeunload', function (e) {
                var sec = gg('pdfEditorSection');
                if (!pdeDirty || !sec || sec.style.display === 'none') return;
                e.preventDefault();
                e.returnValue = '';
            });
        }
    }

    function showPdeProgress(label, pct) {
        var wrap = gg('pde_progress_wrap');
        var bar = gg('pde_progress_bar');
        var lbl = gg('pde_progress_label');
        if (!wrap) return;
        wrap.style.display = 'block';
        if (lbl) lbl.textContent = label || '';
        if (bar) bar.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
    }

    function hidePdeProgress() {
        var wrap = gg('pde_progress_wrap');
        if (wrap) wrap.style.display = 'none';
        var bar = gg('pde_progress_bar');
        if (bar) bar.style.width = '0%';
    }

    function idbOpenPde() {
        return new Promise(function (resolve, reject) {
            if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
            var req = indexedDB.open('joyful_pdf_editor_v1', 1);
            req.onupgradeneeded = function (ev) {
                if (!ev.target.result.objectStoreNames.contains('recent')) {
                    ev.target.result.createObjectStore('recent', { keyPath: 'id' });
                }
            };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
        });
    }

    function saveRecentPdf(name, bytes) {
        if (!bytes || !name) return Promise.resolve();
        if (pdePatient && (pdePatient.id || pdePatient.patient_no)) return Promise.resolve();
        var buf = bytes.slice ? bytes.slice(0) : bytes;
        if (buf.byteLength > PDE_RECENT_MAX_BYTES) return Promise.resolve();
        var id = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
        var entry = { id: id, name: name, at: Date.now(), size: buf.byteLength, data: buf };
        return idbOpenPde().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('recent', 'readwrite');
                tx.objectStore('recent').put(entry);
                tx.oncomplete = function () { resolve(); };
                tx.onerror = function () { reject(tx.error); };
            });
        }).then(function () {
            return idbOpenPde().then(function (db) {
                return new Promise(function (resolve) {
                    var tx = db.transaction('recent', 'readonly');
                    var req = tx.objectStore('recent').getAll();
                    req.onsuccess = function () {
                        var all = (req.result || []).sort(function (a, b) { return b.at - a.at; });
                        if (all.length <= PDE_RECENT_MAX) { resolve(); return; }
                        var drop = all.slice(PDE_RECENT_MAX);
                        var tx2 = db.transaction('recent', 'readwrite');
                        drop.forEach(function (d) { tx2.objectStore('recent').delete(d.id); });
                        tx2.oncomplete = function () { resolve(); };
                    };
                });
            });
        }).catch(function () { return null; });
    }

    function listRecentPdfs() {
        return idbOpenPde().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('recent', 'readonly');
                var req = tx.objectStore('recent').getAll();
                req.onsuccess = function () {
                    resolve((req.result || []).sort(function (a, b) { return b.at - a.at; }).slice(0, PDE_RECENT_MAX));
                };
                req.onerror = function () { reject(req.error); };
            });
        }).catch(function () { return []; });
    }

    function loadRecentPdf(id) {
        return idbOpenPde().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction('recent', 'readonly');
                var req = tx.objectStore('recent').get(id);
                req.onsuccess = function () { resolve(req.result || null); };
                req.onerror = function () { reject(req.error); };
            });
        });
    }

    function refreshRecentListUI() {
        var host = gg('pde_recent_list');
        if (!host) return;
        listRecentPdfs().then(function (rows) {
            if (!rows.length) {
                host.innerHTML = '';
                host.style.display = 'none';
                return;
            }
            host.style.display = 'block';
            host.innerHTML = '<div class="pde-recent-head">' + esc(t('Recent files', '最近文件', '最近檔案')) + '</div>' +
                rows.map(function (r) {
                    var when = '';
                    try { when = new Date(r.at).toLocaleString(); } catch (e2) {}
                    return '<button type="button" class="pde-recent-item" data-recent-id="' + esc(r.id) + '">' +
                        '<strong>' + esc(r.name) + '</strong>' +
                        '<span>' + esc(when) + ' · ' + esc(fmtBytes(r.size)) + '</span></button>';
                }).join('');
            host.querySelectorAll('[data-recent-id]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var rid = btn.getAttribute('data-recent-id');
                    pdeConfirmLeave(function () {
                        loadRecentPdf(rid).then(function (rec) {
                            if (!rec || !rec.data) return;
                            pageNum = 0;
                            hideCompareBar();
                            setViewMode('single');
                            return loadPdfFromBytes(rec.data, rec.name || 'document.pdf');
                        });
                    });
                });
            });
        });
    }

    function restoreSingleStageDOM() {
        if (!stageEl) return;
        stageEl.className = 'pde-stage' + (canvasInvert ? ' pde-invert-canvas' : '');
        stageEl.innerHTML =
            '<canvas id="pde_bg"></canvas>' +
            '<div id="pde_text_layer" class="pde-text-layer" aria-hidden="true"></div>' +
            '<canvas id="pde_ol"></canvas>';
        bgCanvas = gg('pde_bg');
        olCanvas = gg('pde_ol');
        textLayerEl = gg('pde_text_layer');
        olCtx = null;
        olCanvas._pdeEvWired = false;
        wireCanvasEvents();
        applyInvertClass();
    }

    function applyInvertClass() {
        if (viewportEl) viewportEl.classList.toggle('pde-invert-canvas', canvasInvert);
    }

    function toggleCanvasInvert() {
        canvasInvert = !canvasInvert;
        applyInvertClass();
        var btn = gg('pde_invert');
        if (btn) btn.classList.toggle('active', canvasInvert);
        if (viewMode !== 'single') renderMultiPageView();
        else renderPage();
    }

    function updateViewModeButtons() {
        ['pde_view_single', 'pde_view_continuous', 'pde_view_twoup'].forEach(function (id) {
            var b = gg(id);
            if (!b) return;
            var mode = id.replace('pde_view_', '');
            if (mode === 'twoup') mode = 'twoUp';
            b.classList.toggle('active', viewMode === mode);
        });
    }

    function setViewMode(mode) {
        if (compareState) hideCompareBar();
        viewMode = mode;
        updateViewModeButtons();
        if (mode === 'single') {
            restoreSingleStageDOM();
            return renderPage();
        }
        closeTextEditor(true);
        selectedIdx = -1;
        return renderMultiPageView();
    }

    function renderMultiPageView() {
        if (!pdfJsDoc || !stageEl || !viewportEl) return Promise.resolve();
        stageEl.className = 'pde-stage pde-stage-' + viewMode + (canvasInvert ? ' pde-invert-canvas' : '');
        stageEl.innerHTML = '';
        olCanvas = null;
        bgCanvas = null;
        textLayerEl = null;
        olCtx = null;

        var indices = [];
        if (viewMode === 'twoUp') {
            indices.push(pageNum);
            if (pageNum + 1 < pageCount) indices.push(pageNum + 1);
        } else {
            var lim = Math.min(pageCount, 60);
            for (var ci = 0; ci < lim; ci++) indices.push(ci);
            if (pageCount > 60) {
                setStatus(t('Continuous view shows first 60 pages.', '连续视图显示前 60 页。', '連續檢視顯示前 60 頁。'), 'bad');
            }
        }

        showPdeProgress(t('Rendering pages…', '渲染页面中…', '渲染頁面中…'), 5);
        var chain = Promise.resolve();
        indices.forEach(function (pi, idx) {
            chain = chain.then(function () {
                showPdeProgress(t('Rendering pages…', '渲染页面中…', '渲染頁面中…'),
                    5 + Math.round(((idx + 1) / indices.length) * 90));
                return renderPageBlock(pi, idx === 0);
            });
        });
        return chain.then(function () {
            hidePdeProgress();
            updatePageLabel();
            setStatus(t('View mode — click a page to edit.', '视图模式 — 点击页面以编辑。', '檢視模式 — 點擊頁面以編輯。'));
        });
    }

    function renderPageBlock(pi, isPrimary) {
        var wrap = document.createElement('div');
        wrap.className = 'pde-page-block' + (pi === pageNum ? ' active' : '');
        wrap.setAttribute('data-page', pi);
        var label = document.createElement('div');
        label.className = 'pde-page-block-label';
        label.textContent = t('Page', '第', '第') + ' ' + (pi + 1);
        var canvas = document.createElement('canvas');
        wrap.appendChild(label);
        wrap.appendChild(canvas);
        stageEl.appendChild(wrap);

        return pdfJsDoc.getPage(pi + 1).then(function (page) {
            var vp1 = page.getViewport({ scale: 1 });
            pageDims[pi] = { w: vp1.width, h: vp1.height };
            var scale = computeBaseScale(vp1.width) * (viewMode === 'twoUp' ? 0.88 : 0.92);
            var vp = page.getViewport({ scale: scale });
            canvas.width = vp.width;
            canvas.height = vp.height;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, vp.width, vp.height);
            return page.render({ canvasContext: ctx, viewport: vp }).promise;
        }).then(function () {
            wrap.addEventListener('click', function () {
                pageNum = pi;
                setViewMode('single');
            });
            if (isPrimary && viewportEl) wrap.scrollIntoView({ block: 'start', behavior: 'auto' });
        });
    }

    function closeCompareView() {
        hideCompareBar();
        setViewMode('single');
    }

    function openComparePicker() {
        if (!pdfBytes) return;
        var inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = 'application/pdf,.pdf';
        inp.onchange = function () {
            var f = inp.files && inp.files[0];
            if (!f) return;
            readFileArrayBuffer(f).then(function (buf) {
                var comparePwdRef = { value: null };
                return getPdfJsDocument(buf, {
                    isCompare: true,
                    setSessionPassword: false,
                    password: compareState && compareState.password,
                    pwdRef: comparePwdRef
                }).then(function (doc) {
                    compareState = {
                        pdfJsDoc: doc,
                        pdfBytes: buf,
                        fileName: f.name || 'compare.pdf',
                        pageNum: pageNum,
                        password: comparePwdRef.value
                    };
                    viewMode = 'single';
                    updateViewModeButtons();
                    var bar = gg('pde_compare_bar');
                    if (bar) {
                        bar.style.display = 'flex';
                        var lbl = gg('pde_compare_label');
                        if (lbl) {
                            lbl.textContent = t('Compare', '对比', '對比') + ': ' + fileName + ' ↔ ' + compareState.fileName;
                        }
                    }
                    return renderCompareView();
                });
            }).catch(function (e) {
                setStatus(t('Compare failed: ', '对比失败：', '對比失敗：') + (e && e.message || e), 'bad');
            });
        };
        inp.click();
    }

    function renderCompareView() {
        if (!pdfJsDoc || !compareState || !stageEl) return Promise.resolve();
        stageEl.className = 'pde-stage pde-stage-compare' + (canvasInvert ? ' pde-invert-canvas' : '');
        stageEl.innerHTML =
            '<div class="pde-compare-col"><div class="pde-compare-cap">' + esc(fileName) +
            ' · ' + esc(t('Page', '第', '第') + ' ' + (pageNum + 1)) + '</div><canvas id="pde_compare_left"></canvas></div>' +
            '<div class="pde-compare-col"><div class="pde-compare-cap">' + esc(compareState.fileName) +
            ' · ' + esc(t('Page', '第', '第') + ' ' + (compareState.pageNum + 1)) + '</div><canvas id="pde_compare_right"></canvas></div>';
        olCanvas = null;
        bgCanvas = null;
        textLayerEl = null;

        var leftPi = pageNum;
        var rightPi = Math.min(compareState.pageNum, compareState.pdfJsDoc.numPages - 1);
        return Promise.all([
            pdfJsDoc.getPage(leftPi + 1).then(function (page) {
                var c = gg('pde_compare_left');
                if (!c) return;
                var vp = page.getViewport({ scale: computeBaseScale(page.getViewport({ scale: 1 }).width) * 0.85 });
                c.width = vp.width;
                c.height = vp.height;
                return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            }),
            compareState.pdfJsDoc.getPage(rightPi + 1).then(function (page) {
                var c = gg('pde_compare_right');
                if (!c) return;
                var vp = page.getViewport({ scale: computeBaseScale(page.getViewport({ scale: 1 }).width) * 0.85 });
                c.width = vp.width;
                c.height = vp.height;
                return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
            })
        ]).then(function () {
            updatePageLabel();
            setStatus(t('Compare view — use page buttons to sync.', '对比视图 — 用翻页按钮同步。', '對比檢視 — 用翻頁按鈕同步。'));
        });
    }

    function closeShortcutsModal() {
        if (_shortcutsOv && _shortcutsOv.parentNode) _shortcutsOv.parentNode.removeChild(_shortcutsOv);
        _shortcutsOv = null;
    }

    function openShortcutsModal() {
        closeShortcutsModal();
        var rows = [
            ['V', t('Select', '选择', '選擇')],
            ['H', t('Pan', '平移', '平移')],
            ['P', t('Pen', '画笔', '畫筆')],
            ['E', t('Eraser', '橡皮', '橡皮')],
            ['T', t('Text', '文字', '文字')],
            ['O', t('OCR tool', 'OCR 工具', 'OCR 工具')],
            ['R', t('Redact', '涂黑', '塗黑')],
            ['Ctrl+Z / Ctrl+Y', t('Undo / Redo', '撤销 / 重做', '復原 / 重做')],
            ['Ctrl+S', t('Quick save (internal)', '快速保存（内部）', '快速儲存（內部）')],
            ['Ctrl+P', t('Print', '打印', '列印')],
            ['Ctrl+F / F3', t('Find / next hit', '查找 / 下一处', '搜尋 / 下一處')],
            ['Ctrl+C / Ctrl+V', t('Copy / paste annotation', '复制 / 粘贴标注', '複製 / 貼上標註')],
            ['Ctrl+Shift+C', t('Copy text / OCR', '复制文字 / OCR', '複製文字 / OCR')],
            ['Delete', t('Delete selected', '删除选中', '刪除選取')],
            ['?', t('This cheat sheet', '本快捷键表', '本快捷鍵表')]
        ];
        var html = rows.map(function (r) {
            return '<div class="pde-shortcut-row"><kbd>' + esc(r[0]) + '</kbd><span>' + esc(r[1]) + '</span></div>';
        }).join('');
        _shortcutsOv = document.createElement('div');
        _shortcutsOv.className = 'pde-print-overlay';
        _shortcutsOv.innerHTML =
            '<div class="pde-print-modal pde-shortcuts-modal" role="dialog">' +
                '<h2>' + esc(t('Keyboard shortcuts', '键盘快捷键', '鍵盤快捷鍵')) + '</h2>' +
                '<div class="pde-shortcuts-list">' + html + '</div>' +
                '<div class="pde-print-actions">' +
                    '<button type="button" class="ct-btn ct-btn-primary" id="pde_shortcuts_close">' +
                        esc(t('Close', '关闭', '關閉')) + '</button></div></div>';
        document.body.appendChild(_shortcutsOv);
        gg('pde_shortcuts_close').addEventListener('click', closeShortcutsModal);
        _shortcutsOv.addEventListener('click', function (e) { if (e.target === _shortcutsOv) closeShortcutsModal(); });
    }

    function wirePinchZoom() {
        if (!viewportEl || viewportEl._pdePinchWired) return;
        viewportEl._pdePinchWired = true;
        viewportEl.addEventListener('wheel', function (e) {
            if (!pdfJsDoc || viewMode !== 'single' || compareState) return;
            if (!e.ctrlKey) return;
            e.preventDefault();
            if (zoomMode !== 'custom') zoomCustom = effectiveZoom();
            zoomMode = 'custom';
            zoomCustom = Math.max(0.35, Math.min(3, zoomCustom + (e.deltaY < 0 ? 0.06 : -0.06)));
            renderPage();
        }, { passive: false });

        var touchDist = 0;
        var touchZoom = 1;
        viewportEl.addEventListener('touchstart', function (e) {
            if (e.touches.length === 2 && pdfJsDoc && viewMode === 'single' && !compareState) {
                touchDist = Math.hypot(
                    e.touches[0].clientX - e.touches[1].clientX,
                    e.touches[0].clientY - e.touches[1].clientY);
                touchZoom = zoomMode === 'custom' ? zoomCustom : effectiveZoom();
            }
        }, { passive: true });
        viewportEl.addEventListener('touchmove', function (e) {
            if (e.touches.length !== 2 || !touchDist || !pdfJsDoc) return;
            e.preventDefault();
            var dist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY);
            zoomMode = 'custom';
            zoomCustom = Math.max(0.35, Math.min(3, touchZoom * (dist / touchDist)));
            renderPage();
        }, { passive: false });
    }

    function wireCanvasEvents() {
        if (!olCanvas || olCanvas._pdeEvWired) return;
        olCanvas._pdeEvWired = true;
        olCanvas.addEventListener('pointerdown', onPointerDown);
        olCanvas.addEventListener('pointermove', onPointerMove);
        olCanvas.addEventListener('pointerup', onPointerUp);
        olCanvas.addEventListener('pointercancel', onPointerUp);
        olCanvas.addEventListener('dblclick', onDoubleClick);
    }

    function drawExportMeta(page, PDFLib, pt, ann, sx) {
        var meta = formatAnnMetaLine(ann);
        if (!meta) return;
        var mp = pt(ann.x, (ann.y || 0) + (ann.h || 0.02));
        try {
            page.drawText(meta, {
                x: mp.x,
                y: Math.max(8, mp.y - 10),
                size: Math.max(6, 8 * sx),
                color: hexRgb(PDFLib, '#64748b'),
                opacity: 0.75
            });
        } catch (e) {}
    }

    function buildFlattenedPdfBytes() {
        if (!pdfBytes) return Promise.reject(new Error('No PDF loaded'));
        return ensurePdfLib().then(function (PDFLib) {
            return loadPdfLibDocument(pdfBytes).then(function (doc) {
            applyFormValuesToDoc(doc);
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
                            if (ann.type === 'redact') {
                                var rd = pt(ann.x, ann.y + ann.h);
                                page.drawRectangle({
                                    x: rd.x,
                                    y: rd.y,
                                    width: ann.w * pw,
                                    height: ann.h * ph,
                                    color: PDFLib.rgb(1, 1, 1),
                                    borderWidth: 0,
                                    opacity: 1
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
                            if (ann.type === 'underline' || ann.type === 'strikeout') {
                                var ul1 = pt(Math.min(ann.x, ann.x + ann.w), ann.y);
                                var ul2 = pt(Math.max(ann.x, ann.x + ann.w), ann.y + ann.h);
                                var ly = ann.type === 'strikeout'
                                    ? (ul1.y + ul2.y) / 2
                                    : Math.min(ul1.y, ul2.y) - 2 * sy;
                                page.drawLine({
                                    start: { x: ul1.x, y: ly },
                                    end: { x: ul2.x, y: ly },
                                    thickness: (ann.width || 2) * sx * 0.5,
                                    color: hexRgb(PDFLib, ca.hex),
                                    opacity: ca.opacity
                                });
                                if (ann.author || ann.createdAt) drawExportMeta(page, PDFLib, pt, ann, sx);
                                return;
                            }
                            if (ann.type === 'note') {
                                var noteAnn = Object.assign({}, ann);
                                normalizeNoteAnn(noteAnn);
                                var nt = pt(noteAnn.x, noteAnn.y + noteAnn.h);
                                var nw = noteAnn.w * pw;
                                var nh = noteAnn.h * ph;
                                page.drawRectangle({
                                    x: nt.x, y: nt.y,
                                    width: nw, height: nh,
                                    color: hexRgb(PDFLib, noteAnn.color || '#fef08a'),
                                    borderColor: hexRgb(PDFLib, '#ca8a04'),
                                    borderWidth: 1,
                                    opacity: noteAnn.opacity != null ? noteAnn.opacity : 0.95
                                });
                                if (noteAnn.text) {
                                    var noteFs = Math.max(8, (noteAnn.size || 11) * sx);
                                    var noteLines = String(noteAnn.text).split('\n').slice(0, 14);
                                    var notePad = 6 * sx;
                                    var noteLh = noteFs * 1.32;
                                    noteLines.forEach(function (line, li) {
                                        page.drawText(line.slice(0, 100), {
                                            x: nt.x + notePad,
                                            y: nt.y + nh - notePad - noteFs - li * noteLh,
                                            size: noteFs,
                                            color: hexRgb(PDFLib, '#713f12')
                                        });
                                    });
                                }
                                drawExportMeta(page, PDFLib, pt, noteAnn, sx);
                                return;
                            }
                            if (ann.type === 'callout') {
                                var cb = pt(ann.x, ann.y + ann.h);
                                page.drawRectangle({
                                    x: cb.x, y: cb.y,
                                    width: ann.w * pw, height: ann.h * ph,
                                    borderColor: hexRgb(PDFLib, ca.hex),
                                    borderWidth: (ann.width || 2) * sx * 0.4,
                                    color: PDFLib.rgb(1, 1, 1),
                                    opacity: 0.92
                                });
                                if (ann.text) {
                                    page.drawText(String(ann.text), {
                                        x: cb.x + 6,
                                        y: cb.y + ann.h * ph - 14 * sy,
                                        size: Math.max(8, (ann.size || 14) * sx),
                                        color: hexRgb(PDFLib, ca.hex)
                                    });
                                }
                                var anc = pt(ann.ax, ann.ay);
                                var mid = { x: cb.x + ann.w * pw / 2, y: cb.y + ann.h * ph / 2 };
                                page.drawLine({
                                    start: anc, end: mid,
                                    thickness: (ann.width || 2) * sx * 0.4,
                                    color: hexRgb(PDFLib, ca.hex)
                                });
                                drawExportMeta(page, PDFLib, pt, ann, sx);
                                return;
                            }
                            if (ann.type === 'stamp') {
                                var stCol = ann.color || '#dc2626';
                                var st = pt(ann.x, ann.y + ann.h);
                                page.drawRectangle({
                                    x: st.x, y: st.y,
                                    width: ann.w * pw, height: ann.h * ph,
                                    borderColor: hexRgb(PDFLib, stCol),
                                    borderWidth: 2,
                                    opacity: 0.85
                                });
                                page.drawText(String(ann.text || 'APPROVED'), {
                                    x: st.x + ann.w * pw * 0.15,
                                    y: st.y + ann.h * ph * 0.35,
                                    size: Math.min(ann.h * ph * 0.45, 24),
                                    color: hexRgb(PDFLib, stCol)
                                });
                                drawExportMeta(page, PDFLib, pt, ann, sx);
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
        });
    }

    function exportPdf() {
        openExportModeModal();
    }

    function exportPdfQuick() {
        exportPdfDownload('internal');
    }

    // ── merge / extract pages ─────────────────────────────────────
    var _mergeOv = null;
    var _extractOv = null;

    function closeMergeModal() {
        if (_mergeOv && _mergeOv.parentNode) _mergeOv.parentNode.removeChild(_mergeOv);
        _mergeOv = null;
    }

    function closeExtractModal() {
        if (_extractOv && _extractOv.parentNode) _extractOv.parentNode.removeChild(_extractOv);
        _extractOv = null;
    }

    function mergePdfBuffers(buffers) {
        return ensurePdfLib().then(function (PDFLib) {
            return PDFLib.PDFDocument.create().then(function (outDoc) {
                var chain = Promise.resolve();
                buffers.forEach(function (buf) {
                    chain = chain.then(function () { return pdfLibAddBufferToDoc(PDFLib, outDoc, buf); });
                });
                return chain.then(function () { return outDoc.save(); });
            });
        });
    }

    function runMergeFromModal(extraFiles, position) {
        closeMergeModal();
        setStatus(t('Merging PDFs…', '合并 PDF 中…', '合併 PDF 中…'), 'work');
        showPdeProgress(t('Merging PDFs…', '合并 PDF 中…', '合併 PDF 中…'), 15);
        var job;
        if (pdfBytes) {
            job = buildFlattenedPdfBytes().then(function (currentBytes) {
                var bufs = position === 'prepend' ? [] : [currentBytes];
                var tail = Promise.resolve();
                extraFiles.forEach(function (f) {
                    tail = tail.then(function () {
                        return readFileArrayBuffer(f).then(function (b) { bufs.push(b); });
                    });
                });
                return tail.then(function () {
                    if (position === 'prepend') bufs.push(currentBytes);
                    return mergePdfBuffers(bufs);
                });
            });
        } else {
            if (extraFiles.length < 2) {
                return Promise.reject(new Error(t('Choose at least 2 PDF files.', '请至少选择 2 个 PDF 文件。', '請至少選擇 2 個 PDF 檔案。')));
            }
            var bufs = [];
            var chain = Promise.resolve();
            extraFiles.forEach(function (f) {
                chain = chain.then(function () {
                    return readFileArrayBuffer(f).then(function (b) { bufs.push(b); });
                });
            });
            job = chain.then(function () { return mergePdfBuffers(bufs); });
        }
        return job.then(function (bytes) {
            showPdeProgress(t('Merge complete', '合并完成', '合併完成'), 95);
            var base = fileName.replace(/\.pdf$/i, '') || 'document';
            pageNum = 0;
            return loadPdfFromBytes(bytes, base + '_merged.pdf');
        }).then(function () {
            hidePdeProgress();
            setStatus(t('Merge complete.', '合并完成。', '合併完成。'), 'ok');
            pdeAuditLog('MERGE', { pages: pageCount });
        }).catch(function (e) {
            hidePdeProgress();
            setStatus(t('Merge failed: ', '合并失败：', '合併失敗：') + (e && e.message || e), 'bad');
        });
    }

    function openMergeModal() {
        closeMergeModal();
        var hasDoc = !!pdfBytes;
        _mergeOv = document.createElement('div');
        _mergeOv.className = 'pde-print-overlay';
        _mergeOv.innerHTML =
            '<div class="pde-print-modal" role="dialog">' +
                '<h2>' + esc(t('Merge PDFs', '合并 PDF', '合併 PDF')) + '</h2>' +
                '<p class="pde-pages-hint">' + esc(hasDoc
                    ? t('Add other PDF files to the current document. Annotations on open pages are included.',
                        '将其他 PDF 添加到当前文档。当前页上的标注会一并合并。',
                        '將其他 PDF 新增至目前文件。目前頁面上的標註會一併合併。')
                    : t('Choose two or more PDF files to combine into one document.',
                        '选择两个或以上 PDF 文件合并为一个文档。',
                        '選擇兩個或以上 PDF 檔案合併為一個文件。')) + '</p>' +
                '<label class="pde-print-field pde-print-field--full">' +
                    '<span>' + esc(t('PDF files to add', '要添加的 PDF 文件', '要新增的 PDF 檔案')) +
                    (hasDoc ? '' : ' (' + esc(t('2 or more', '2 个或以上', '2 個或以上')) + ')') + '</span>' +
                    '<input id="pde_merge_files" type="file" accept="application/pdf,.pdf" multiple></label>' +
                (hasDoc
                    ? ('<fieldset class="pde-pages-fieldset">' +
                        '<legend>' + esc(t('Position', '位置', '位置')) + '</legend>' +
                        '<label class="pde-print-check"><input type="radio" name="pde_merge_pos" value="append" checked> ' +
                        esc(t('Append after current document', '追加到当前文档之后', '追加至目前文件之後')) + '</label>' +
                        '<label class="pde-print-check"><input type="radio" name="pde_merge_pos" value="prepend"> ' +
                        esc(t('Insert before current document', '插入到当前文档之前', '插入至目前文件之前')) + '</label>' +
                    '</fieldset>')
                    : '') +
                '<div class="pde-print-actions">' +
                    '<button type="button" class="ct-btn" id="pde_merge_cancel">' + esc(t('Cancel', '取消', '取消')) + '</button>' +
                    '<button type="button" class="ct-btn ct-btn-primary" id="pde_merge_go">' +
                        esc(t('Merge', '合并', '合併')) + '</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(_mergeOv);
        gg('pde_merge_cancel').addEventListener('click', closeMergeModal);
        _mergeOv.addEventListener('click', function (e) { if (e.target === _mergeOv) closeMergeModal(); });
        gg('pde_merge_go').addEventListener('click', function () {
            var inp = gg('pde_merge_files');
            var files = inp && inp.files ? Array.prototype.slice.call(inp.files) : [];
            if (!files.length) {
                alert(t('Please choose PDF file(s).', '请选择 PDF 文件。', '請選擇 PDF 檔案。'));
                return;
            }
            if (!hasDoc && files.length < 2) {
                alert(t('Choose at least 2 PDF files.', '请至少选择 2 个 PDF 文件。', '請至少選擇 2 個 PDF 檔案。'));
                return;
            }
            var pos = 'append';
            var posEl = _mergeOv.querySelector('input[name="pde_merge_pos"]:checked');
            if (posEl) pos = posEl.value || 'append';
            var btn = gg('pde_merge_go');
            if (btn) btn.disabled = true;
            runMergeFromModal(files, pos).finally(function () {
                if (btn) btn.disabled = false;
            });
        });
    }

    function runExtractFromModal(rangeStr, download, loadInEditor) {
        if (!pdfBytes) return Promise.reject(new Error(t('No PDF loaded.', '未打开 PDF。', '未開啟 PDF。')));
        if (!download && !loadInEditor) {
            return Promise.reject(new Error(t('Choose download and/or open in editor.', '请选择下载和/或在编辑器中打开。', '請選擇下載和/或在編輯器中開啟。')));
        }
        var indices = parsePageRange(rangeStr, pageCount);
        if (!indices.length) {
            return Promise.reject(new Error(t('No valid pages.', '没有有效页码。', '沒有有效頁碼。')));
        }
        closeExtractModal();
        setStatus(t('Extracting pages…', '提取页面中…', '提取頁面中…'), 'work');
        return buildFlattenedPdfBytes().then(function (currentBytes) {
            return ensurePdfLib().then(function (PDFLib) {
                return loadPdfLibDocument(currentBytes).then(function (src) {
                    return PDFLib.PDFDocument.create().then(function (out) {
                        return out.copyPages(src, indices).then(function (pages) {
                            pages.forEach(function (pg) { out.addPage(pg); });
                            return out.save();
                        });
                    });
                });
            });
        }).then(function (bytes) {
            var base = fileName.replace(/\.pdf$/i, '') || 'document';
            var outName = base + '_pages_' + String(rangeStr).replace(/\s+/g, '') + '.pdf';
            if (download) {
                dl(new Blob([bytes], { type: 'application/pdf' }), outName);
            }
            if (loadInEditor) {
                pageNum = 0;
                return loadPdfFromBytes(bytes, outName);
            }
        }).then(function () {
            setStatus(t('Extract complete.', '提取完成。', '提取完成。'), 'ok');
        }).catch(function (e) {
            setStatus(t('Extract failed: ', '提取失败：', '提取失敗：') + (e && e.message || e), 'bad');
        });
    }

    function openExtractModal() {
        if (!pdfBytes) return;
        closeExtractModal();
        var defaultRange = String(pageNum + 1);
        _extractOv = document.createElement('div');
        _extractOv.className = 'pde-print-overlay';
        _extractOv.innerHTML =
            '<div class="pde-print-modal" role="dialog">' +
                '<h2>' + esc(t('Extract pages', '提取页面', '提取頁面')) + '</h2>' +
                '<p class="pde-pages-hint">' + esc(t(
                    'Keep selected pages as a new PDF. Use commas and dashes (e.g. 1-3,5). Current annotations are included.',
                    '将选定页保存为新 PDF。可用逗号和连字符（如 1-3,5）。包含当前标注。',
                    '將選定頁儲存為新 PDF。可用逗號和連字符（如 1-3,5）。包含目前標註。')) + '</p>' +
                '<label class="pde-print-field pde-print-field--full">' +
                    '<span>' + esc(t('Pages to extract', '要提取的页', '要提取的頁')) + '</span>' +
                    '<input id="pde_extract_range" type="text" value="' + esc(defaultRange) +
                    '" placeholder="1-3,5"></label>' +
                '<p class="pde-pages-meta">' + esc(t('Document has', '文档共', '文件共') + ' ' + pageCount + ' ' +
                    t('pages', '页', '頁') + ' · ' + t('viewing page', '当前第', '目前第') + ' ' + (pageNum + 1)) + '</p>' +
                '<label class="pde-print-check"><input type="checkbox" id="pde_extract_download" checked> ' +
                    esc(t('Download extracted PDF', '下载提取的 PDF', '下載提取的 PDF')) + '</label>' +
                '<label class="pde-print-check"><input type="checkbox" id="pde_extract_load"> ' +
                    esc(t('Open extracted pages in editor', '在编辑器中打开提取的页', '在編輯器中開啟提取的頁')) + '</label>' +
                '<div class="pde-print-actions">' +
                    '<button type="button" class="ct-btn" id="pde_extract_current">' +
                        esc(t('Current page only', '仅当前页', '僅目前頁')) + '</button>' +
                    '<button type="button" class="ct-btn" id="pde_extract_cancel">' + esc(t('Cancel', '取消', '取消')) + '</button>' +
                    '<button type="button" class="ct-btn ct-btn-primary" id="pde_extract_go">' +
                        esc(t('Extract', '提取', '提取')) + '</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(_extractOv);
        gg('pde_extract_cancel').addEventListener('click', closeExtractModal);
        _extractOv.addEventListener('click', function (e) { if (e.target === _extractOv) closeExtractModal(); });
        gg('pde_extract_current').addEventListener('click', function () {
            var inp = gg('pde_extract_range');
            if (inp) inp.value = String(pageNum + 1);
        });
        gg('pde_extract_go').addEventListener('click', function () {
            var rangeInp = gg('pde_extract_range');
            var dl = gg('pde_extract_download');
            var load = gg('pde_extract_load');
            var btn = gg('pde_extract_go');
            if (btn) btn.disabled = true;
            runExtractFromModal(
                rangeInp ? rangeInp.value : '',
                dl && dl.checked,
                load && load.checked
            ).finally(function () {
                if (btn) btn.disabled = false;
            });
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
            return getPdfJsDocument(flatBytes);
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
    function restoreUiAfterRender() {
        if (!pdfBytes || !pdfJsDoc) return Promise.resolve();
        var emptyEl = gg('pde_empty');
        var shellEl = gg('pde_shell');
        if (emptyEl) emptyEl.style.display = 'none';
        if (shellEl) shellEl.style.display = 'flex';
        setDocActionButtonsEnabled(true);
        if (pdeDirty) pdeMarkDirty();
        updateViewModeButtons();
        if (compareState && compareState.pdfJsDoc) {
            var bar = gg('pde_compare_bar');
            if (bar) {
                bar.style.display = 'flex';
                var lbl = gg('pde_compare_label');
                if (lbl) {
                    lbl.textContent = t('Compare', '对比', '對比') + ': ' + fileName + ' ↔ ' + compareState.fileName;
                }
            }
            return renderCompareView().then(function () {
                syncHistoryButtons();
                refreshThumbsActive();
            });
        }
        if (viewMode !== 'single') {
            return renderMultiPageView().then(function () {
                syncHistoryButtons();
                refreshThumbsActive();
            });
        }
        if (olCanvas) olCanvas._pdeEvWired = false;
        wireCanvasEvents();
        applyInvertClass();
        return renderPage().then(function () {
            syncHistoryButtons();
            refreshThumbsActive();
        });
    }

    function ribbonBtn(id, label, title) {
        return '<button type="button" class="pde-rib-btn' + (id === 'select' ? ' active' : '') +
            '" data-pde-tool="' + id + '" title="' + esc(title || label) + '">' + label + '</button>';
    }

    function render() {
        closeTextEditor(false);
        var app = gg('pdfEditorApp');
        if (!app) return;
        app.innerHTML =
            '<div class="pde-app">' +
                '<div class="pde-menubar">' +
                    '<label class="pde-mb-btn pde-open-lbl">' + esc(t('Open', '打开', '打開')) +
                        '<input type="file" id="pde_file" accept="application/pdf,.pdf" hidden></label>' +
                    '<button type="button" class="pde-mb-btn pde-mb-primary" id="pde_save" disabled title="Ctrl+S">' + esc(t('Save PDF', '保存', '儲存')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_save_patient" disabled>' + esc(t('Save to patient…', '保存到患者…', '儲存到患者…')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_sign_file" disabled>' + esc(t('Sign & file', '签名并归档', '簽名並歸檔')) + '</button>' +
                    '<span id="pde_dirty_badge" class="pde-dirty-badge" style="display:none;" title="' +
                        esc(t('Unsaved changes', '未保存的更改', '未儲存的變更')) + '">●</span>' +
                    '<button type="button" class="pde-mb-btn" id="pde_link_patient">' + esc(t('Link patient…', '关联患者…', '關聯患者…')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_template">' + esc(t('Template…', '模板…', '模板…')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_batch" disabled>' + esc(t('Batch…', '批量…', '批次…')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_merge">' + esc(t('Merge…', '合并…', '合併…')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_extract" disabled>' + esc(t('Extract…', '提取…', '提取…')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_watermark" disabled>' + esc(t('Watermark…', '水印…', '浮水印…')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_compress" disabled>' + esc(t('Compress…', '压缩…', '壓縮…')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_forms" disabled>' + esc(t('Forms…', '表单…', '表單…')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_print" disabled title="Ctrl+P">' + esc(t('Print', '打印', '列印')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_print_setup" disabled>' + esc(t('Print setup', '打印设置', '列印設定')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_copy_text" disabled title="Ctrl+Shift+C">' + esc(t('Copy text', '复制文字', '複製文字')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_ocr_page" disabled>' + esc(t('OCR page', 'OCR 本页', 'OCR 本頁')) + '</button>' +
                    '<span class="pde-mb-sep"></span>' +
                    '<input type="search" id="pde_find_input" class="pde-find-input" disabled placeholder="' + esc(t('Find in document…', '在文档中查找…', '在文件中搜尋…')) + '">' +
                    '<button type="button" class="pde-mb-btn" id="pde_find_go" disabled>' + esc(t('Find', '查找', '搜尋')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_find_prev" disabled title="Shift+F3">◀</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_find_next" disabled title="F3">▶</button>' +
                    '<span id="pde_find_status" class="pde-find-status"></span>' +
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
                    '<button type="button" class="pde-mb-btn pde-view-btn active" id="pde_view_single" title="' +
                        esc(t('Single page (edit)', '单页（编辑）', '單頁（編輯）')) + '">1</button>' +
                    '<button type="button" class="pde-mb-btn pde-view-btn" id="pde_view_continuous" title="' +
                        esc(t('Continuous scroll', '连续滚动', '連續捲動')) + '">☰</button>' +
                    '<button type="button" class="pde-mb-btn pde-view-btn" id="pde_view_twoup" title="' +
                        esc(t('Two-page spread', '双页', '雙頁')) + '">2</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_invert" title="' +
                        esc(t('Invert (X-ray view)', '反色（X 光查看）', '反色（X 光檢視）')) + '">◐</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_compare" disabled>' + esc(t('Compare…', '对比…', '對比…')) + '</button>' +
                    '<button type="button" class="pde-mb-btn" id="pde_shortcuts" title="?">' + esc(t('Shortcuts', '快捷键', '快捷鍵')) + '</button>' +
                    '<span class="pde-mb-sep"></span>' +
                    '<button type="button" class="pde-mb-btn" id="pde_prev" disabled>◀</button>' +
                    '<span id="pde_page_label" class="pde-page-lbl">—</span>' +
                    '<button type="button" class="pde-mb-btn" id="pde_next" disabled>▶</button>' +
                '</div>' +
                '<div id="pde_patient_bar" class="pde-patient-bar" style="display:none;">' +
                    '<span id="pde_patient_label" class="pde-patient-label"></span>' +
                    '<button type="button" class="pde-patient-btn" id="pde_fill_fields" disabled>' +
                        esc(t('Fill patient fields', '填充患者字段', '填充患者欄位')) + '</button>' +
                '</div>' +
                '<div id="pde_compare_bar" class="pde-compare-bar" style="display:none;">' +
                    '<span id="pde_compare_label" class="pde-compare-label"></span>' +
                    '<button type="button" class="pde-patient-btn" id="pde_compare_close">' +
                        esc(t('Exit compare', '退出对比', '退出對比')) + '</button>' +
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
                    '<div class="pde-rib-group"><span>' + esc(t('Text', '文字', '文字')) + '</span>' +
                        ribbonBtn('textselect', 'Aa', t('Select text', '选择文字', '選取文字')) +
                        ribbonBtn('ocr', '🔍', t('OCR', 'OCR 识别', 'OCR 辨識')) +
                    '</div>' +
                    '<div class="pde-rib-group"><span>' + esc(t('Review', '审阅', '審閱')) + '</span>' +
                        ribbonBtn('note', '📝', t('Sticky note', '便笺', '便箋')) +
                        ribbonBtn('callout', '💬', t('Callout', '标注', '標註')) +
                        ribbonBtn('underline', 'U̲', t('Underline', '下划线', '底線')) +
                        ribbonBtn('strikeout', 'S̶', t('Strikethrough', '删除线', '刪除線')) +
                    '</div>' +
                    '<div class="pde-rib-group"><span>' + esc(t('Protect', '保护', '保護')) + '</span>' +
                        ribbonBtn('redact', '█', t('Redact (whiteout)', '涂黑遮盖', '塗黑遮蓋')) +
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
                    '<p>' + esc(t('Open a PDF to annotate, review, fill forms, merge, extract pages, select text, OCR scans, sign, and export.', '打开 PDF 进行标注、审阅、填表、合并、提取页面、选择文字、OCR 识别、签名并导出。', '打開 PDF 進行標註、審閱、填表、合併、提取頁面、選取文字、OCR 辨識、簽名並匯出。')) + '</p>' +
                    '<label class="ct-btn ct-btn-primary pde-open-lbl">' + esc(t('Open PDF…', '打开 PDF…', '打開 PDF…')) +
                        '<input type="file" id="pde_file_empty" accept="application/pdf,.pdf" hidden></label>' +
                    '<div id="pde_recent_list" class="pde-recent-list" style="display:none;"></div>' +
                '</div>' +
                '<div id="pde_shell" class="pde-shell" style="display:none;">' +
                    '<aside class="pde-thumbs-panel">' +
                        '<div class="pde-thumbs-head">' +
                            '<span>' + esc(t('Pages', '页面', '頁面')) + '</span>' +
                            '<div class="pde-page-toolbar">' +
                                '<button type="button" class="pde-pg-btn" id="pde_pg_delete" disabled title="' + esc(t('Delete page', '删除页', '刪除頁')) + '">🗑</button>' +
                                '<button type="button" class="pde-pg-btn" id="pde_pg_rotate" disabled title="' + esc(t('Rotate 90°', '旋转 90°', '旋轉 90°')) + '">↻</button>' +
                                '<button type="button" class="pde-pg-btn" id="pde_pg_duplicate" disabled title="' + esc(t('Duplicate page', '复制页', '複製頁')) + '">⧉</button>' +
                                '<button type="button" class="pde-pg-btn" id="pde_pg_blank" disabled title="' + esc(t('Insert blank page', '插入空白页', '插入空白頁')) + '">+</button>' +
                            '</div>' +
                        '</div>' +
                        '<div id="pde_thumbs" class="pde-thumbs"></div>' +
                        '<div class="pde-side-head">' + esc(t('Bookmarks', '书签', '書籤')) + '</div>' +
                        '<div id="pde_bookmarks" class="pde-bookmarks"></div>' +
                    '</aside>' +
                    '<div class="pde-center">' +
                        '<div id="pde_viewport" class="pde-viewport">' +
                            '<div id="pde_stage" class="pde-stage">' +
                                '<canvas id="pde_bg"></canvas>' +
                                '<div id="pde_text_layer" class="pde-text-layer" aria-hidden="true"></div>' +
                                '<canvas id="pde_ol"></canvas>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<aside class="pde-props-panel">' +
                        '<div class="pde-props-head">' + esc(t('Properties', '属性', '屬性')) + '</div>' +
                        '<div id="pde_props_body" class="pde-props-body"></div>' +
                    '</aside>' +
                '</div>' +
                '<div id="pde_progress_wrap" class="pde-progress-wrap" style="display:none;">' +
                    '<div class="pde-progress-track"><div id="pde_progress_bar" class="pde-progress-bar"></div></div>' +
                    '<span id="pde_progress_label" class="pde-progress-label"></span>' +
                '</div>' +
                '<div id="pde_status" class="pde-statusbar"></div>' +
            '</div>';
        wireUi();
        refreshPropsPanel();
        updatePdePatientBanner();
        refreshRecentListUI();
        preloadPrintersForEditor();
        restoreUiAfterRender();
    }

    function wireUi() {
        bgCanvas = gg('pde_bg');
        olCanvas = gg('pde_ol');
        textLayerEl = gg('pde_text_layer');
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
        var savePatBtn = gg('pde_save_patient');
        if (savePatBtn) savePatBtn.addEventListener('click', function () { openSaveToPatientModal({}); });
        var signFileBtn = gg('pde_sign_file');
        if (signFileBtn) signFileBtn.addEventListener('click', function () { openSaveToPatientModal({ signAndFile: true }); });
        var linkPatBtn = gg('pde_link_patient');
        if (linkPatBtn) linkPatBtn.addEventListener('click', function () { openLinkPatientModal(); });
        var tplBtn = gg('pde_template');
        if (tplBtn) tplBtn.addEventListener('click', openTemplatePickerModal);
        var batchBtn = gg('pde_batch');
        if (batchBtn) batchBtn.addEventListener('click', openBatchModal);
        var fillBtn = gg('pde_fill_fields');
        if (fillBtn) fillBtn.addEventListener('click', applyPatientFieldAnnotations);
        var mergeBtn = gg('pde_merge');
        if (mergeBtn) mergeBtn.addEventListener('click', openMergeModal);
        var extractBtn = gg('pde_extract');
        if (extractBtn) extractBtn.addEventListener('click', openExtractModal);
        var wmBtn = gg('pde_watermark');
        if (wmBtn) wmBtn.addEventListener('click', openWatermarkModal);
        var compressBtn = gg('pde_compress');
        if (compressBtn) compressBtn.addEventListener('click', openCompressModal);
        var formsBtn = gg('pde_forms');
        if (formsBtn) formsBtn.addEventListener('click', openFormsModal);

        var pgDel = gg('pde_pg_delete');
        if (pgDel) pgDel.addEventListener('click', function () { deleteCurrentPage(); });
        var pgRot = gg('pde_pg_rotate');
        if (pgRot) pgRot.addEventListener('click', function () {
            rotateCurrentPage(90).catch(function (e) {
                setStatus(t('Rotate failed: ', '旋转失败：', '旋轉失敗：') + (e && e.message || e), 'bad');
            });
        });
        var pgDup = gg('pde_pg_duplicate');
        if (pgDup) pgDup.addEventListener('click', function () {
            duplicateCurrentPage().catch(function (e) {
                setStatus(t('Duplicate failed: ', '复制失败：', '複製失敗：') + (e && e.message || e), 'bad');
            });
        });
        var pgBlank = gg('pde_pg_blank');
        if (pgBlank) pgBlank.addEventListener('click', function () {
            insertBlankPageAfterCurrent().catch(function (e) {
                setStatus(t('Insert failed: ', '插入失败：', '插入失敗：') + (e && e.message || e), 'bad');
            });
        });

        var findInp = gg('pde_find_input');
        var findGo = gg('pde_find_go');
        if (findGo) findGo.addEventListener('click', function () {
            runDocumentSearch(findInp ? findInp.value : '');
        });
        if (findInp) {
            findInp.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    runDocumentSearch(findInp.value);
                }
            });
        }
        var findPrev = gg('pde_find_prev');
        if (findPrev) findPrev.addEventListener('click', function () { findNextHit(-1); });
        var findNext = gg('pde_find_next');
        if (findNext) findNext.addEventListener('click', function () { findNextHit(1); });

        var printBtn = gg('pde_print');
        if (printBtn) printBtn.addEventListener('click', function () { openPrintSetupModal({ focusPrint: true }); });
        var printSetupBtn = gg('pde_print_setup');
        if (printSetupBtn) printSetupBtn.addEventListener('click', function () { openPrintSetupModal({}); });
        gg('pde_undo').addEventListener('click', undo);
        gg('pde_redo').addEventListener('click', redo);

        var copyTextBtn = gg('pde_copy_text');
        if (copyTextBtn) copyTextBtn.addEventListener('click', copySelectedOrOcrText);
        var ocrPageBtn = gg('pde_ocr_page');
        if (ocrPageBtn) {
            ocrPageBtn.addEventListener('click', function () {
                setTool('ocr');
                runOcrFullPage();
            });
        }

        gg('pde_prev').addEventListener('click', function () {
            if (pageNum <= 0) return;
            goToPage(pageNum - 1);
        });
        gg('pde_next').addEventListener('click', function () {
            if (pageNum >= pageCount - 1) return;
            goToPage(pageNum + 1);
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

        var viewSingle = gg('pde_view_single');
        if (viewSingle) viewSingle.addEventListener('click', function () { setViewMode('single'); });
        var viewCont = gg('pde_view_continuous');
        if (viewCont) viewCont.addEventListener('click', function () { setViewMode('continuous'); });
        var viewTwo = gg('pde_view_twoup');
        if (viewTwo) viewTwo.addEventListener('click', function () { setViewMode('twoUp'); });
        var invertBtn = gg('pde_invert');
        if (invertBtn) invertBtn.addEventListener('click', toggleCanvasInvert);
        var compareBtn = gg('pde_compare');
        if (compareBtn) compareBtn.addEventListener('click', openComparePicker);
        var compareClose = gg('pde_compare_close');
        if (compareClose) compareClose.addEventListener('click', closeCompareView);
        var shortcutsBtn = gg('pde_shortcuts');
        if (shortcutsBtn) shortcutsBtn.addEventListener('click', openShortcutsModal);

        gg('pde_toolbar').addEventListener('click', function (e) {
            var btn = e.target.closest('[data-pde-tool]');
            if (!btn) return;
            var id = btn.getAttribute('data-pde-tool');
            if (id === 'image') {
                if (!ensureSingleEditMode()) return;
                var inp = document.createElement('input');
                inp.type = 'file'; inp.accept = 'image/*';
                inp.onchange = function () {
                    var f = inp.files && inp.files[0];
                    if (!f) return;
                    var fr = new FileReader();
                    fr.onload = function () {
                        var img = new Image();
                        img.onload = function () {
                            if (!ensureSingleEditMode()) return;
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
            if (id === 'stamp') { openStampPicker(); return; }
            activateCanvasTool(id);
        });

        wireCanvasEvents();
        wirePinchZoom();
        wireNavigationGuard();

        if (!_pdeKeydownWired) {
            _pdeKeydownWired = true;
            document.addEventListener('keydown', onKeyDown);
        }
        if (!_pdeResizeWired) {
            _pdeResizeWired = true;
            window.addEventListener('resize', function () {
                if (pdfJsDoc) {
                    if (compareState) renderCompareView();
                    else if (viewMode !== 'single') renderMultiPageView();
                    else renderPage();
                }
            });
        }
    }

    function onKeyDown(e) {
        if (!gg('pdfEditorSection') || gg('pdfEditorSection').style.display === 'none') return;
        if (textEditorEl) return;
        if (document.activeElement && /input|textarea|select/i.test(document.activeElement.tagName)) return;

        var k = e.key.toLowerCase();
        if (e.key === 'Delete' || e.key === 'Backspace') {
            if (tool !== 'textselect') deleteSelected();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
        if ((e.ctrlKey || e.metaKey) && k === 'c') {
            if (tool === 'textselect' || tool === 'ocr') {
                e.preventDefault();
                copySelectedOrOcrText();
                return;
            }
            e.preventDefault();
            copySelected();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && k === 'v') { e.preventDefault(); pasteClip(); return; }
        if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); exportPdfQuick(); return; }
        if ((e.ctrlKey || e.metaKey) && k === 'p') { e.preventDefault(); openPrintSetupModal({ focusPrint: true }); return; }

        if ((e.ctrlKey || e.metaKey) && k === 'f') {
            e.preventDefault();
            var fi = gg('pde_find_input');
            if (fi) { fi.focus(); fi.select(); }
            return;
        }
        if (e.key === 'F3') {
            e.preventDefault();
            findNextHit(e.shiftKey ? -1 : 1);
            return;
        }
        if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            openShortcutsModal();
            return;
        }

        if (!e.ctrlKey && !e.metaKey) {
            var map = { v: 'select', h: 'hand', p: 'pen', e: 'eraser', t: 'text', o: 'ocr', r: 'redact' };
            if (map[k]) setTool(map[k]);
        }
    }

    function open(opts) {
        opts = opts || {};
        if (typeof showOnly === 'function') showOnly('pdfEditorSection');
        pdePatient = opts.patient || null;
        pdeDocMeta = opts.template ? pdeNormalizeTemplateMeta(opts.template) : null;
        if (opts.documentName) {
            if (!pdeDocMeta) pdeDocMeta = {};
            pdeDocMeta.document_name = opts.documentName;
        }
        if (!pdePatient && !opts.patientId) pdePatient = pdeResolveActivePatient();
        render();
        updatePdePatientBanner();
        var after = Promise.resolve();
        if (opts.patientId && !pdePatient) {
            after = fetchPatientById(opts.patientId).then(function (p) {
                pdePatient = p;
                updatePdePatientBanner();
            });
        }
        after.then(function () {
            if (opts.pdfBytes) {
                return loadPdfFromBytes(opts.pdfBytes, opts.fileName || 'document.pdf', opts.loadOpts || {});
            }
            if (opts.file) return loadPdfFile(opts.file);
        }).then(function () {
            pdeAuditLog('OPEN', {
                file: opts.fileName || (opts.file && opts.file.name) || null,
                patient_no: pdePatient && pdePatient.patient_no
            });
        });
    }

    window.PDFEDITOR = {
        open: open,
        openForPatient: function (patient, moreOpts) {
            moreOpts = moreOpts || {};
            moreOpts.patient = patient;
            open(moreOpts);
        }
    };
})();
