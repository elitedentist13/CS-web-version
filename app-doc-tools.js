// ════════════════════════════════════════════════════════════════
// app-doc-tools.js — Document Converter (markitdown-inspired, client-side)
//
// Supported conversions
//   Word  (.docx)  → PDF · HTML · Markdown · Text
//   PDF            → JPG · PNG · Markdown · Text · Word
//   Excel (.xlsx/.xls) → Markdown table · HTML table
//   PowerPoint (.pptx) → Markdown · Text
//   CSV            → Markdown table
//   Images (multi) → PDF (combine)
//   Image (single) → JPG · PNG · WebP
//
// Libraries loaded lazily from CDN on first use (no build step required):
//   pdfjs-dist, jsPDF, mammoth, html2canvas, SheetJS, Turndown, JSZip
// ════════════════════════════════════════════════════════════════
var DOCTOOLS = (function () {
    'use strict';

    // ── CDN endpoints ────────────────────────────────────────────────
    var CDN = {
        pdfjs:       'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
        pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
        jspdf:       'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
        mammoth:     'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
        html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
        sheetjs:     'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
        turndown:    'https://cdn.jsdelivr.net/npm/turndown@7.2.0/dist/turndown.min.js',
        jszip:       'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
    };

    var _files      = [];   // currently selected File objects
    var _objectUrls = [];   // blob URLs to revoke on reset

    // ── i18n ────────────────────────────────────────────────────────
    var STR = {
        title:       { en: '🔄 Document Converter',       'zh-CN': '🔄 文件格式转换',          'zh-Hant': '🔄 文件格式轉換' },
        intro:       { en: 'Convert files right in your browser — nothing is uploaded to any server.',
                       'zh-CN': '直接在浏览器中转换文件，不会上传到任何服务器。',
                       'zh-Hant': '直接在瀏覽器中轉換檔案，不會上傳到任何伺服器。' },
        drop:        { en: 'Drop files here, or click to choose',  'zh-CN': '将文件拖到此处，或点击选择', 'zh-Hant': '將檔案拖到此處，或點擊選擇' },
        dropHint:    { en: 'Word · PDF · Excel · PowerPoint · CSV · Images',
                       'zh-CN': 'Word · PDF · Excel · PowerPoint · CSV · 图片',
                       'zh-Hant': 'Word · PDF · Excel · PowerPoint · CSV · 圖片' },
        chooseBtn:   { en: '📁 Choose files',   'zh-CN': '📁 选择文件',   'zh-Hant': '📁 選擇檔案' },
        clearBtn:    { en: '✕ Clear',           'zh-CN': '✕ 清除',       'zh-Hant': '✕ 清除' },
        selected:    { en: 'Selected',           'zh-CN': '已选择',       'zh-Hant': '已選擇' },
        actionsTitle:{ en: 'Available conversions', 'zh-CN': '可用的转换', 'zh-Hant': '可用的轉換' },
        results:     { en: 'Results',            'zh-CN': '转换结果',     'zh-Hant': '轉換結果' },
        download:    { en: '⬇ Download',         'zh-CN': '⬇ 下载',      'zh-Hant': '⬇ 下載' },
        downloadAll: { en: '⬇ Download all',     'zh-CN': '⬇ 全部下载',  'zh-Hant': '⬇ 全部下載' },
        quality:     { en: 'Image quality',      'zh-CN': '图片质量',     'zh-Hant': '圖片品質' },
        resolution:  { en: 'PDF render scale',   'zh-CN': 'PDF 渲染倍率', 'zh-Hant': 'PDF 渲染倍率' },
        working:     { en: 'Working…',           'zh-CN': '处理中…',      'zh-Hant': '處理中…' },
        page:        { en: 'Page',               'zh-CN': '第',           'zh-Hant': '第' },
        pageSuffix:  { en: '',                   'zh-CN': '页',           'zh-Hant': '頁' },
        errLib:      { en: 'Could not load converter library. Check your internet connection and try again.',
                       'zh-CN': '无法加载转换库，请检查网络后重试。',
                       'zh-Hant': '無法載入轉換程式庫，請檢查網路後重試。' },
        errGeneric:  { en: 'Conversion failed: ', 'zh-CN': '转换失败：', 'zh-Hant': '轉換失敗：' },
        errNoText:   { en: 'No text could be extracted. This file may be image-only or use an unsupported font encoding.',
                       'zh-CN': '无法提取文字内容。此文件可能为纯图片或使用不支持的字体编码。',
                       'zh-Hant': '無法提取文字內容。此檔案可能為純圖片或使用不支援的字型編碼。' },
        noActions:   { en: 'No conversions available. Select a Word, PDF, Excel, PowerPoint, CSV, or image file.',
                       'zh-CN': '无可用转换。请选择 Word、PDF、Excel、PowerPoint、CSV 或图片文件。',
                       'zh-Hant': '無可用轉換。請選擇 Word、PDF、Excel、PowerPoint、CSV 或圖片檔案。' },
        // Action labels
        a_docx_pdf:  { en: '📄 Word → PDF',         'zh-CN': '📄 Word → PDF',       'zh-Hant': '📄 Word → PDF' },
        a_docx_html: { en: '🌐 Word → HTML',         'zh-CN': '🌐 Word → HTML',      'zh-Hant': '🌐 Word → HTML' },
        a_docx_md:   { en: '📝 Word → Markdown',     'zh-CN': '📝 Word → Markdown',  'zh-Hant': '📝 Word → Markdown' },
        a_docx_txt:  { en: '🔤 Word → Text',         'zh-CN': '🔤 Word → 文本',      'zh-Hant': '🔤 Word → 文字' },
        a_pdf_jpg:   { en: '🖼️ PDF → JPG',           'zh-CN': '🖼️ PDF → JPG',       'zh-Hant': '🖼️ PDF → JPG' },
        a_pdf_png:   { en: '🖼️ PDF → PNG',           'zh-CN': '🖼️ PDF → PNG',       'zh-Hant': '🖼️ PDF → PNG' },
        a_pdf_md:    { en: '📝 PDF → Markdown',      'zh-CN': '📝 PDF → Markdown',   'zh-Hant': '📝 PDF → Markdown' },
        a_pdf_txt:   { en: '🔤 PDF → Text',          'zh-CN': '🔤 PDF → 文本',       'zh-Hant': '🔤 PDF → 文字' },
        a_pdf_word:  { en: '📄 PDF → Word',          'zh-CN': '📄 PDF → Word',       'zh-Hant': '📄 PDF → Word' },
        a_xlsx_md:   { en: '📊 Excel → Markdown',    'zh-CN': '📊 Excel → Markdown', 'zh-Hant': '📊 Excel → Markdown' },
        a_xlsx_html: { en: '🌐 Excel → HTML',        'zh-CN': '🌐 Excel → HTML',     'zh-Hant': '🌐 Excel → HTML' },
        a_pptx_md:   { en: '📊 PowerPoint → Markdown','zh-CN': '📊 PPT → Markdown', 'zh-Hant': '📊 PPT → Markdown' },
        a_pptx_txt:  { en: '🔤 PowerPoint → Text',  'zh-CN': '🔤 PPT → 文本',       'zh-Hant': '🔤 PPT → 文字' },
        a_csv_md:    { en: '📊 CSV → Markdown',      'zh-CN': '📊 CSV → Markdown',   'zh-Hant': '📊 CSV → Markdown' },
        a_imgs_pdf:  { en: '📚 Images → PDF',        'zh-CN': '📚 图片 → PDF',       'zh-Hant': '📚 圖片 → PDF' },
        a_img_jpg:   { en: '🖼️ Convert to JPG',      'zh-CN': '🖼️ 转为 JPG',        'zh-Hant': '🖼️ 轉為 JPG' },
        a_img_png:   { en: '🖼️ Convert to PNG',      'zh-CN': '🖼️ 转为 PNG',        'zh-Hant': '🖼️ 轉為 PNG' },
        a_img_webp:  { en: '🖼️ Convert to WebP',     'zh-CN': '🖼️ 转为 WebP',       'zh-Hant': '🖼️ 轉為 WebP' }
    };
    function lang() { return (typeof getAppLang === 'function') ? getAppLang() : 'en'; }
    function L(id) { var e = STR[id]; if (!e) return id; return e[lang()] || e.en || id; }
    function gg(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
        });
    }

    // ── Lazy library loaders ─────────────────────────────────────────
    var _loaded = {};
    function loadScript(url) {
        if (_loaded[url]) return _loaded[url];
        _loaded[url] = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = url; s.async = true;
            s.onload = resolve;
            s.onerror = function () { _loaded[url] = null; reject(new Error('load failed: ' + url)); };
            document.head.appendChild(s);
        });
        return _loaded[url];
    }
    function ensurePdfJs() {
        if (window.pdfjsLib) { trySetWorker(); return Promise.resolve(window.pdfjsLib); }
        return loadScript(CDN.pdfjs).then(function () { trySetWorker(); return window.pdfjsLib; });
    }
    function trySetWorker() {
        try {
            if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions &&
                !window.pdfjsLib.GlobalWorkerOptions.workerSrc)
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker;
        } catch (e) {}
    }
    function ensureJsPdf() {
        if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
        return loadScript(CDN.jspdf).then(function () { return window.jspdf.jsPDF; });
    }
    function ensureMammoth() {
        if (window.mammoth) return Promise.resolve(window.mammoth);
        return loadScript(CDN.mammoth).then(function () { return window.mammoth; });
    }
    function ensureHtml2Canvas() {
        if (window.html2canvas) return Promise.resolve(window.html2canvas);
        return loadScript(CDN.html2canvas).then(function () { return window.html2canvas; });
    }
    function ensureSheetJs() {
        if (window.XLSX) return Promise.resolve(window.XLSX);
        return loadScript(CDN.sheetjs).then(function () { return window.XLSX; });
    }
    function ensureTurndown() {
        if (window.TurndownService) return Promise.resolve(window.TurndownService);
        return loadScript(CDN.turndown).then(function () { return window.TurndownService; });
    }
    function ensureJsZip() {
        if (window.JSZip) return Promise.resolve(window.JSZip);
        return loadScript(CDN.jszip).then(function () { return window.JSZip; });
    }

    // ── File classification ──────────────────────────────────────────
    var IMG_EXT = ['jpg','jpeg','png','webp','gif','bmp'];
    function extOf(f) {
        var n = String(f && f.name || '').toLowerCase();
        var i = n.lastIndexOf('.');
        return i >= 0 ? n.slice(i + 1) : '';
    }
    function kindOf(f) {
        var ext = extOf(f);
        var type = String(f && f.type || '').toLowerCase();
        if (type.indexOf('image/') === 0 || IMG_EXT.indexOf(ext) >= 0) return 'image';
        if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
        if (type.indexOf('wordprocessingml') >= 0 || ext === 'docx') return 'docx';
        if (ext === 'doc') return 'doc';
        if (ext === 'xlsx' || ext === 'xls' ||
            type.indexOf('spreadsheetml') >= 0 ||
            type === 'application/vnd.ms-excel') return 'spreadsheet';
        if (ext === 'pptx' || ext === 'ppt' ||
            type.indexOf('presentationml') >= 0) return 'presentation';
        if (ext === 'csv' || type === 'text/csv') return 'csv';
        return 'other';
    }
    function kindIcon(k) {
        return { image:'🖼️', pdf:'📕', docx:'📘', doc:'📘',
                 spreadsheet:'📊', presentation:'📑', csv:'📋', other:'📄' }[k] || '📄';
    }
    function baseName(f) {
        var n = String(f && f.name || 'file');
        var i = n.lastIndexOf('.');
        return i > 0 ? n.slice(0, i) : n;
    }

    // ════════════════════════════════════════════════════════════════
    //  UI
    // ════════════════════════════════════════════════════════════════
    function open() {
        if (typeof showOnly === 'function') showOnly('docToolsSection');
        else {
            var sec = gg('docToolsSection');
            if (sec) { sec.style.display = 'block'; sec.removeAttribute('aria-hidden'); }
        }
        render();
        var hdr = gg('docToolsTitleH1');
        if (hdr) hdr.textContent = L('title');
        var back = gg('docToolsBack');
        if (back && !back._dtBound) {
            back._dtBound = true;
            back.addEventListener('click', function () {
                if (typeof showOnly === 'function') showOnly('toolsSection');
                else if (typeof showDashboard === 'function') showDashboard();
            });
        }
    }

    function render() {
        var app = gg('docToolsApp');
        if (!app) return;
        resetOutputs();
        _files = [];
        app.innerHTML =
            '<p class="dt-intro">' + esc(L('intro')) + '</p>' +
            '<div id="dtDrop" class="dt-drop" tabindex="0" role="button">' +
                '<div class="dt-drop-icon">📥</div>' +
                '<div class="dt-drop-main">' + esc(L('drop')) + '</div>' +
                '<div class="dt-drop-hint">' + esc(L('dropHint')) + '</div>' +
                '<button type="button" class="dt-choose" id="dtChoose">' + esc(L('chooseBtn')) + '</button>' +
                '<input type="file" id="dtInput" multiple ' +
                    'accept=".docx,.pdf,.xlsx,.xls,.pptx,.csv,.jpg,.jpeg,.png,.webp,.gif,.bmp,' +
                    'application/pdf,image/*,' +
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,' +
                    'application/vnd.ms-excel,' +
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation,' +
                    'text/csv" hidden>' +
            '</div>' +
            '<div id="dtFiles" class="dt-files" style="display:none;"></div>' +
            '<div id="dtPanel" class="dt-panel" style="display:none;"></div>' +
            '<div id="dtResults" class="dt-results" style="display:none;"></div>';

        var drop = gg('dtDrop'), input = gg('dtInput');
        gg('dtChoose').addEventListener('click', function (e) { e.stopPropagation(); input.click(); });
        drop.addEventListener('click', function () { input.click(); });
        drop.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
        });
        input.addEventListener('change', function () { addFiles(input.files); });
        ['dragenter','dragover'].forEach(function (ev) {
            drop.addEventListener(ev, function (e) {
                e.preventDefault(); e.stopPropagation(); drop.classList.add('dt-over');
            });
        });
        ['dragleave','drop'].forEach(function (ev) {
            drop.addEventListener(ev, function (e) {
                e.preventDefault(); e.stopPropagation(); drop.classList.remove('dt-over');
            });
        });
        drop.addEventListener('drop', function (e) {
            if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
        });
    }

    function addFiles(fileList) {
        var arr = Array.prototype.slice.call(fileList || []);
        if (!arr.length) return;
        _files = arr;
        renderFiles();
        renderActions();
    }

    function renderFiles() {
        var box = gg('dtFiles');
        if (!box) return;
        if (!_files.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
        var chips = _files.map(function (f) {
            var k = kindOf(f);
            return '<div class="dt-file"><span class="dt-file-ic">' + kindIcon(k) + '</span>' +
                   '<span class="dt-file-name">' + esc(f.name) + '</span>' +
                   '<span class="dt-file-size">' + fmtSize(f.size) + '</span></div>';
        }).join('');
        box.innerHTML =
            '<div class="dt-files-head"><b>' + esc(L('selected')) + ' (' + _files.length + ')</b>' +
                '<button type="button" class="dt-clear" id="dtClear">' + esc(L('clearBtn')) + '</button></div>' +
            '<div class="dt-files-list">' + chips + '</div>';
        box.style.display = 'block';
        gg('dtClear').addEventListener('click', function () { render(); });
    }

    function fmtSize(n) {
        n = Number(n || 0);
        if (n < 1024) return n + ' B';
        if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1048576).toFixed(1) + ' MB';
    }

    function renderActions() {
        var panel = gg('dtPanel');
        if (!panel) return;
        var single = _files.length === 1;
        var allImages = _files.length > 0 && _files.every(function (f) { return kindOf(f) === 'image'; });
        var k0 = single ? kindOf(_files[0]) : null;
        var actions = [];

        if (k0 === 'doc') {
            // Old binary .doc — limited support
            panel.innerHTML =
                '<div class="dt-panel" style="display:block;">' +
                '<p class="dt-empty">⚠️ Old-format <code>.doc</code> files are not supported. ' +
                'Please re-save as <code>.docx</code> in Microsoft Word first.</p></div>';
            panel.style.display = 'block';
            return;
        }

        if (k0 === 'docx') {
            var opts =
                '<div class="dt-opt">' + esc(L('quality')) +
                '<input type="range" id="dtQuality" min="40" max="100" value="92">' +
                '<b id="dtQualityVal">92%</b></div>';
            actions = [
                { id: 'a_docx_pdf',  run: function () { return docxToPdf(_files[0]); } },
                { id: 'a_docx_html', run: function () { return docxToHtml(_files[0]); } },
                { id: 'a_docx_md',   run: function () { return docxToMarkdown(_files[0]); } },
                { id: 'a_docx_txt',  run: function () { return docxToText(_files[0]); } }
            ];
            buildPanel(panel, actions, opts);
        } else if (k0 === 'pdf') {
            var opts2 =
                '<div class="dt-opt">' + esc(L('quality')) +
                '<input type="range" id="dtQuality" min="40" max="100" value="92">' +
                '<b id="dtQualityVal">92%</b></div>' +
                '<div class="dt-opt">' + esc(L('resolution')) +
                '<input type="range" id="dtScale" min="1" max="4" value="2">' +
                '<b id="dtScaleVal">2×</b></div>';
            actions = [
                { id: 'a_pdf_jpg',  run: function () { return pdfToImages(_files[0], 'image/jpeg'); } },
                { id: 'a_pdf_png',  run: function () { return pdfToImages(_files[0], 'image/png'); } },
                { id: 'a_pdf_md',   run: function () { return pdfToMarkdown(_files[0]); } },
                { id: 'a_pdf_txt',  run: function () { return pdfToText(_files[0]); } },
                { id: 'a_pdf_word', run: function () { return pdfToWord(_files[0]); } }
            ];
            buildPanel(panel, actions, opts2);
        } else if (k0 === 'spreadsheet') {
            actions = [
                { id: 'a_xlsx_md',   run: function () { return xlsxToMarkdown(_files[0]); } },
                { id: 'a_xlsx_html', run: function () { return xlsxToHtml(_files[0]); } }
            ];
            buildPanel(panel, actions, '');
        } else if (k0 === 'presentation') {
            actions = [
                { id: 'a_pptx_md',  run: function () { return pptxToMarkdown(_files[0]); } },
                { id: 'a_pptx_txt', run: function () { return pptxToText(_files[0]); } }
            ];
            buildPanel(panel, actions, '');
        } else if (k0 === 'csv') {
            actions = [
                { id: 'a_csv_md', run: function () { return csvToMarkdown(_files[0]); } }
            ];
            buildPanel(panel, actions, '');
        } else if (allImages && _files.length > 1) {
            actions = [
                { id: 'a_imgs_pdf', run: function () { return imagesToPdf(_files); } }
            ];
            buildPanel(panel, actions, '');
        } else if (k0 === 'image') {
            var opts3 =
                '<div class="dt-opt">' + esc(L('quality')) +
                '<input type="range" id="dtQuality" min="40" max="100" value="92">' +
                '<b id="dtQualityVal">92%</b></div>';
            actions = [
                { id: 'a_img_jpg',  run: function () { return imagesToFormat(_files, 'image/jpeg'); } },
                { id: 'a_img_png',  run: function () { return imagesToFormat(_files, 'image/png'); } },
                { id: 'a_img_webp', run: function () { return imagesToFormat(_files, 'image/webp'); } }
            ];
            buildPanel(panel, actions, opts3);
        } else {
            panel.innerHTML = '<p class="dt-empty">' + esc(L('noActions')) + '</p>';
            panel.style.display = 'block';
            return;
        }
    }

    function buildPanel(panel, actions, optsHtml) {
        var btns = actions.map(function (a, i) {
            return '<button type="button" class="dt-action" data-i="' + i + '">' + esc(L(a.id)) + '</button>';
        }).join('');
        panel.innerHTML =
            '<div class="dt-actions-head"><b>' + esc(L('actionsTitle')) + '</b></div>' +
            (optsHtml ? '<div class="dt-opts">' + optsHtml + '</div>' : '') +
            '<div class="dt-actions">' + btns + '</div>' +
            '<div id="dtStatus" class="dt-status" style="display:none;"></div>';
        panel.style.display = 'block';
        var q = gg('dtQuality');
        if (q) q.addEventListener('input', function () { gg('dtQualityVal').textContent = q.value + '%'; });
        var sc = gg('dtScale');
        if (sc) sc.addEventListener('input', function () { gg('dtScaleVal').textContent = sc.value + '×'; });
        panel.querySelectorAll('.dt-action').forEach(function (btn) {
            btn.addEventListener('click', function () { runAction(actions[Number(btn.dataset.i)], btn); });
        });
    }

    function qualityVal() { var q = gg('dtQuality'); return q ? Math.max(0.4, Math.min(1, Number(q.value) / 100)) : 0.9; }
    function scaleVal()   { var s = gg('dtScale');   return s ? Math.max(1, Math.min(4, Number(s.value))) : 2; }

    function setStatus(msg, busy) {
        var s = gg('dtStatus');
        if (!s) return;
        if (!msg) { s.style.display = 'none'; s.innerHTML = ''; return; }
        s.style.display = 'flex';
        s.innerHTML = (busy ? '<span class="dt-spin"></span>' : '') + '<span>' + esc(msg) + '</span>';
    }

    function runAction(a, btn) {
        var all = document.querySelectorAll('.dt-action');
        all.forEach(function (b) { b.disabled = true; });
        setStatus(L('working'), true);
        resetOutputs();
        var res = gg('dtResults'); if (res) { res.style.display = 'none'; res.innerHTML = ''; }
        Promise.resolve().then(a.run).then(function () {
            setStatus('', false);
        }).catch(function (err) {
            var msg = (err && /load failed/i.test(err.message || ''))
                ? L('errLib')
                : (L('errGeneric') + (err && err.message ? err.message : String(err)));
            setStatus(msg, false);
        }).then(function () {
            all.forEach(function (b) { b.disabled = false; });
        });
    }

    // ── Results rendering ────────────────────────────────────────────
    function resetOutputs() {
        _objectUrls.forEach(function (u) { try { URL.revokeObjectURL(u); } catch (e) {} });
        _objectUrls = [];
    }
    function makeUrl(blob) { var u = URL.createObjectURL(blob); _objectUrls.push(u); return u; }

    function triggerDownload(blob, filename) {
        var u = makeUrl(blob);
        var a = document.createElement('a');
        a.href = u; a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 0);
    }

    function showSingleResult(blob, filename, previewUrl) {
        triggerDownload(blob, filename);
        var res = gg('dtResults'); if (!res) return;
        var thumb = previewUrl
            ? '<img class="dt-thumb" src="' + previewUrl + '" alt="">'
            : '<div class="dt-thumb dt-thumb-doc">' + kindIconFromName(filename) + '</div>';
        res.innerHTML =
            '<div class="dt-results-head"><b>' + esc(L('results')) + '</b></div>' +
            '<div class="dt-grid"><div class="dt-result">' + thumb +
                '<div class="dt-result-name">' + esc(filename) + '</div>' +
                '<button type="button" class="dt-dl" id="dtDl0">' + esc(L('download')) + '</button>' +
            '</div></div>';
        res.style.display = 'block';
        gg('dtDl0').addEventListener('click', function () { triggerDownload(blob, filename); });
    }

    function showImageResults(items) {
        var res = gg('dtResults'); if (!res) return;
        var cards = items.map(function (it, i) {
            return '<div class="dt-result">' +
                '<img class="dt-thumb" src="' + it.url + '" alt="">' +
                '<div class="dt-result-name">' + esc(it.filename) + '</div>' +
                '<button type="button" class="dt-dl" data-i="' + i + '">' + esc(L('download')) + '</button>' +
            '</div>';
        }).join('');
        res.innerHTML =
            '<div class="dt-results-head"><b>' + esc(L('results')) + ' (' + items.length + ')</b>' +
                (items.length > 1 ? '<button type="button" class="dt-dl-all" id="dtDlAll">' + esc(L('downloadAll')) + '</button>' : '') +
            '</div><div class="dt-grid">' + cards + '</div>';
        res.style.display = 'block';
        res.querySelectorAll('.dt-dl').forEach(function (b) {
            b.addEventListener('click', function () {
                var it = items[Number(b.dataset.i)]; triggerDownload(it.blob, it.filename);
            });
        });
        var all = gg('dtDlAll');
        if (all) all.addEventListener('click', function () {
            items.forEach(function (it, i) { setTimeout(function () { triggerDownload(it.blob, it.filename); }, i * 350); });
        });
    }

    function kindIconFromName(name) {
        var ext = String(name || '').toLowerCase().split('.').pop();
        if (IMG_EXT.indexOf(ext) >= 0) return '🖼️';
        if (ext === 'pdf')  return '📕';
        if (ext === 'docx' || ext === 'doc') return '📘';
        if (ext === 'xlsx' || ext === 'xls') return '📊';
        if (ext === 'pptx' || ext === 'ppt') return '📑';
        if (ext === 'csv')  return '📋';
        if (ext === 'md')   return '📝';
        return '📄';
    }

    // ════════════════════════════════════════════════════════════════
    //  Shared helpers
    // ════════════════════════════════════════════════════════════════
    function readArrayBuffer(file) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () { resolve(r.result); };
            r.onerror = function () { reject(new Error('read error')); };
            r.readAsArrayBuffer(file);
        });
    }
    function readText(file) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () { resolve(r.result); };
            r.onerror = function () { reject(new Error('read error')); };
            r.readAsText(file, 'utf-8');
        });
    }
    function loadImage(src) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('image decode error')); };
            img.src = src;
        });
    }
    function canvasToBlob(canvas, mime, q) {
        return new Promise(function (resolve) {
            if (canvas.toBlob) canvas.toBlob(function (b) { resolve(b); }, mime, q);
            else {
                var data = canvas.toDataURL(mime, q);
                var parts = data.split(','), mtype = parts[0].match(/:(.*?);/)[1];
                var bin = atob(parts[1]), n = bin.length, u8 = new Uint8Array(n);
                while (n--) u8[n] = bin.charCodeAt(n);
                resolve(new Blob([u8], { type: mtype }));
            }
        });
    }

    // ════════════════════════════════════════════════════════════════
    //  IMAGE conversions
    // ════════════════════════════════════════════════════════════════
    function imagesToFormat(files, mime) {
        var ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
        var q = qualityVal();
        var out = [];
        return files.reduce(function (chain, f) {
            return chain.then(function () {
                var url = URL.createObjectURL(f);
                return loadImage(url).then(function (img) {
                    var cv = document.createElement('canvas');
                    cv.width = img.naturalWidth; cv.height = img.naturalHeight;
                    var ctx = cv.getContext('2d');
                    if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
                    ctx.drawImage(img, 0, 0);
                    URL.revokeObjectURL(url);
                    return canvasToBlob(cv, mime, q).then(function (blob) {
                        out.push({ blob: blob, filename: baseName(f) + '.' + ext, url: makeUrl(blob) });
                    });
                });
            });
        }, Promise.resolve()).then(function () {
            if (out.length === 1) showSingleResult(out[0].blob, out[0].filename, out[0].url);
            else showImageResults(out);
        });
    }

    function imagesToPdf(files) {
        return ensureJsPdf().then(function (JsPDF) {
            var doc = new JsPDF({ unit: 'pt', format: 'a4' });
            var pageW = doc.internal.pageSize.getWidth();
            var pageH = doc.internal.pageSize.getHeight();
            var margin = 24, maxW = pageW - margin * 2, maxH = pageH - margin * 2;
            return files.reduce(function (chain, f, idx) {
                return chain.then(function () {
                    var url = URL.createObjectURL(f);
                    return loadImage(url).then(function (img) {
                        var cv = document.createElement('canvas');
                        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
                        var ctx = cv.getContext('2d');
                        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
                        ctx.drawImage(img, 0, 0);
                        URL.revokeObjectURL(url);
                        var ratio = Math.min(maxW / cv.width, maxH / cv.height);
                        if (ratio > 1) ratio = Math.min(ratio, maxW / cv.width);
                        ratio = Math.min(ratio, maxW / cv.width, maxH / cv.height);
                        var w = cv.width * ratio, h = cv.height * ratio;
                        var x = (pageW - w) / 2, y = (pageH - h) / 2;
                        if (idx > 0) doc.addPage();
                        doc.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', x, y, w, h);
                    });
                });
            }, Promise.resolve()).then(function () {
                var blob = doc.output('blob');
                var name = (files.length === 1 ? baseName(files[0]) : 'images') + '.pdf';
                showSingleResult(blob, name, null);
            });
        });
    }

    // ════════════════════════════════════════════════════════════════
    //  PDF conversions
    // ════════════════════════════════════════════════════════════════
    function pdfToImages(file, mime) {
        var ext = mime === 'image/png' ? 'png' : 'jpg';
        var q = qualityVal(), scale = scaleVal();
        return ensurePdfJs().then(function (pdfjsLib) {
            return readArrayBuffer(file).then(function (buf) {
                return pdfjsLib.getDocument({ data: buf }).promise;
            }).then(function (pdf) {
                var out = [];
                var chain = Promise.resolve();
                for (var p = 1; p <= pdf.numPages; p++) {
                    (function (pageNum) {
                        chain = chain.then(function () {
                            return pdf.getPage(pageNum).then(function (page) {
                                var vp = page.getViewport({ scale: scale });
                                var cv = document.createElement('canvas');
                                cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
                                var ctx = cv.getContext('2d');
                                if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
                                return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
                                    return canvasToBlob(cv, mime, q).then(function (blob) {
                                        var pad = ('000' + pageNum).slice(-3);
                                        out.push({ blob: blob, filename: baseName(file) + '_p' + pad + '.' + ext, url: makeUrl(blob) });
                                    });
                                });
                            });
                        });
                    })(p);
                }
                return chain.then(function () {
                    if (out.length === 1) showSingleResult(out[0].blob, out[0].filename, out[0].url);
                    else showImageResults(out);
                });
            });
        });
    }

    // Extract text items from one PDF page into structured lines.
    function pdfExtractLines(tc) {
        var items = [];
        (tc.items || []).forEach(function (it) {
            if (it.str == null) return;
            var s = it.str;
            if (s === '') return;
            var tr = it.transform || [1, 0, 0, 1, 0, 0];
            // Font size from the magnitude of the first column of the 2×2 matrix
            var sz = Math.hypot(tr[0], tr[1]) || Math.abs(tr[3]) || it.height || 10;
            items.push({ x: tr[4], y: tr[5], sz: sz, w: it.width || 0, str: s });
        });
        if (!items.length) return [];
        // Sort top-to-bottom (PDF y-axis is upward → descending y = top-to-bottom)
        items.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
        var lines = [];
        items.forEach(function (it) {
            var ln = lines.length ? lines[lines.length - 1] : null;
            if (ln && Math.abs(ln.y - it.y) <= Math.max(2, it.sz * 0.55)) {
                ln.items.push(it);
                ln.sz = Math.max(ln.sz, it.sz);
                if (it.x < ln.minX) ln.minX = it.x;
                if (it.x + it.w > ln.maxX) ln.maxX = it.x + it.w;
            } else {
                lines.push({ y: it.y, sz: it.sz, minX: it.x, maxX: it.x + it.w, items: [it] });
            }
        });
        return lines;
    }

    function pdfLinesToMarkdown(lines, pageWidth) {
        if (!lines.length) return '';
        var sizes = lines.map(function (l) { return l.sz; }).sort(function (a, b) { return a - b; });
        var bodySize = sizes[Math.floor(sizes.length / 2)] || 10;
        var out = [], para = [];
        function flushPara() {
            if (para.length) { out.push('\n' + para.join(' ') + '\n'); para = []; }
        }
        for (var i = 0; i < lines.length; i++) {
            var ln = lines[i];
            ln.items.sort(function (a, b) { return a.x - b.x; });
            var text = ln.items.map(function (it) { return it.str; }).join('').trim();
            if (!text) continue;

            var centered = pageWidth > 0 &&
                ln.minX > pageWidth * 0.18 &&
                (pageWidth - ln.maxX) > pageWidth * 0.18 &&
                Math.abs(ln.minX - (pageWidth - ln.maxX)) < pageWidth * 0.14;

            if (ln.sz >= bodySize * 1.6) {
                flushPara();
                out.push('\n# ' + text + '\n');
                continue;
            }
            if (ln.sz >= bodySize * 1.25) {
                flushPara();
                out.push('\n## ' + text + '\n');
                continue;
            }
            // Big vertical gap → new paragraph
            if (i > 0) {
                var gap = lines[i - 1].y - ln.y;
                if (gap > ln.sz * 2) flushPara();
            }
            if (centered) { flushPara(); out.push('\n> ' + text + '\n'); }
            else para.push(text);
        }
        flushPara();
        return out.join('').replace(/\n{3,}/g, '\n\n').trim();
    }

    function pdfToMarkdown(file) {
        return ensurePdfJs().then(function (pdfjsLib) {
            return readArrayBuffer(file).then(function (buf) {
                return pdfjsLib.getDocument({ data: buf }).promise;
            }).then(function (pdf) {
                var pages = [];
                var chain = Promise.resolve();
                for (var p = 1; p <= pdf.numPages; p++) {
                    (function (pageNum) {
                        chain = chain.then(function () {
                            return pdf.getPage(pageNum).then(function (page) {
                                var pw = page.getViewport({ scale: 1 }).width;
                                return page.getTextContent({ includeMarkedContent: false }).then(function (tc) {
                                    var lines = pdfExtractLines(tc);
                                    var md = pdfLinesToMarkdown(lines, pw);
                                    pages.push(md);
                                });
                            });
                        });
                    })(p);
                }
                return chain.then(function () {
                    var nonEmpty = pages.filter(function (p) { return p.trim() !== ''; });
                    if (!nonEmpty.length) throw new Error(L('errNoText'));
                    var content = '# ' + baseName(file) + '\n\n' +
                        nonEmpty.map(function (pg, i) {
                            return (pages.length > 1 ? '---\n*Page ' + (i + 1) + '*\n\n' : '') + pg;
                        }).join('\n\n');
                    var blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
                    showSingleResult(blob, baseName(file) + '.md', null);
                });
            });
        });
    }

    function pdfToText(file) {
        return ensurePdfJs().then(function (pdfjsLib) {
            return readArrayBuffer(file).then(function (buf) {
                return pdfjsLib.getDocument({ data: buf }).promise;
            }).then(function (pdf) {
                var parts = [];
                var chain = Promise.resolve();
                for (var p = 1; p <= pdf.numPages; p++) {
                    (function (pageNum) {
                        chain = chain.then(function () {
                            return pdf.getPage(pageNum).then(function (page) {
                                return page.getTextContent({ includeMarkedContent: false }).then(function (tc) {
                                    var lines = pdfExtractLines(tc);
                                    var text = lines.map(function (ln) {
                                        return ln.items.map(function (it) { return it.str; }).join('');
                                    }).join('\n');
                                    parts.push('─── Page ' + pageNum + ' ───\n' + text);
                                });
                            });
                        });
                    })(p);
                }
                return chain.then(function () {
                    var blob = new Blob([parts.join('\n\n')], { type: 'text/plain;charset=utf-8' });
                    showSingleResult(blob, baseName(file) + '.txt', null);
                });
            });
        });
    }

    // ── PDF → Word ───────────────────────────────────────────────────
    // Reconstructs paragraphs / headings from the text layer and emits
    // a Word-compatible HTML .doc that opens in Word / LibreOffice.
    function pdfToWord(file) {
        return ensurePdfJs().then(function (pdfjsLib) {
            return readArrayBuffer(file).then(function (buf) {
                return pdfjsLib.getDocument({ data: buf }).promise;
            }).then(function (pdf) {
                var pages = [];
                var chain = Promise.resolve();
                for (var p = 1; p <= pdf.numPages; p++) {
                    (function (pageNum) {
                        chain = chain.then(function () {
                            return pdf.getPage(pageNum).then(function (page) {
                                var pw = page.getViewport({ scale: 1 }).width;
                                return page.getTextContent({ includeMarkedContent: false }).then(function (tc) {
                                    pages.push(pdfPageToWordHtml(pdfExtractLines(tc), pw));
                                });
                            });
                        });
                    })(p);
                }
                return chain.then(function () {
                    // Drop empty pages (image-only or unresolvable encoding).
                    // Keeping empty strings would produce blank pages in Word.
                    var nonEmpty = pages.filter(function (pg) { return pg.trim() !== ''; });
                    if (!nonEmpty.length) throw new Error(L('errNoText'));
                    // Use a block-level <p> as page separator — <br> is inline and
                    // page-break-before is silently ignored on it by some Word versions.
                    var sep = '\n<p style="margin:0;line-height:0;page-break-after:always">' +
                              '<span style="font-size:1pt">\u00a0</span></p>\n';
                    var html = wordHtmlDoc(baseName(file), nonEmpty.join(sep));
                    var blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
                    showSingleResult(blob, baseName(file) + '.doc', null);
                });
            });
        });
    }

    function pdfPageToWordHtml(lines, pageWidth) {
        if (!lines.length) return '';
        var sizes = lines.map(function (l) { return l.sz; }).sort(function (a, b) { return a - b; });
        var bodySize = sizes[Math.floor(sizes.length / 2)] || 10;
        var out = [], para = [];
        function flushPara() {
            if (para.length) { out.push('<p>' + para.join(' ') + '</p>'); para = []; }
        }
        for (var i = 0; i < lines.length; i++) {
            var ln = lines[i];
            ln.items.sort(function (a, b) { return a.x - b.x; });
            var text = ln.items.map(function (it) { return esc(it.str); }).join('').trim();
            if (!text) continue;

            var centered = pageWidth > 0 &&
                ln.minX > pageWidth * 0.18 &&
                (pageWidth - ln.maxX) > pageWidth * 0.18 &&
                Math.abs(ln.minX - (pageWidth - ln.maxX)) < pageWidth * 0.14;

            if (ln.sz >= bodySize * 1.6) {
                flushPara();
                out.push('<h1' + (centered ? ' style="text-align:center"' : '') + '>' + text + '</h1>');
                continue;
            }
            if (ln.sz >= bodySize * 1.25) {
                flushPara();
                out.push('<h2' + (centered ? ' style="text-align:center"' : '') + '>' + text + '</h2>');
                continue;
            }
            if (i > 0) {
                var gap = lines[i - 1].y - ln.y;
                if (gap > ln.sz * 2) flushPara();
            }
            if (centered) { flushPara(); out.push('<p style="text-align:center">' + text + '</p>'); }
            else para.push(text);
        }
        flushPara();
        return out.join('\n');
    }

    function wordHtmlDoc(title, body) {
        return '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
            'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
            'xmlns="http://www.w3.org/TR/REC-html40">\n' +
            '<head><meta charset="utf-8"><title>' + esc(title) + '</title>\n' +
            '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View>' +
            '<w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->\n' +
            '<style>\n' +
            '@page WordSection1{size:595.3pt 841.9pt;margin:72pt 72pt 72pt 72pt}\n' +
            'div.WordSection1{page:WordSection1}\n' +
            'body{font-family:Calibri,"Microsoft JhengHei","PingFang TC",sans-serif;font-size:11pt;color:#1a1a1a;line-height:1.5}\n' +
            'p{margin:0 0 8pt 0}h1{font-size:20pt;margin:14pt 0 8pt}h2{font-size:15pt;margin:12pt 0 6pt}\n' +
            '</style></head>\n' +
            '<body><div class="WordSection1">\n' + body + '\n</div></body></html>';
    }

    // ════════════════════════════════════════════════════════════════
    //  WORD (.docx) conversions
    // ════════════════════════════════════════════════════════════════
    function docxToHtml(file) {
        return ensureMammoth().then(function (mammoth) {
            return readArrayBuffer(file).then(function (buf) {
                return mammoth.convertToHtml({ arrayBuffer: buf });
            }).then(function (r) {
                var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(baseName(file)) + '</title>' +
                    '<style>body{font-family:"Microsoft JhengHei","PingFang TC",Arial,sans-serif;max-width:800px;margin:32px auto;padding:0 16px;line-height:1.6;color:#111}' +
                    'table{border-collapse:collapse}td,th{border:1px solid #888;padding:5px 8px}img{max-width:100%}</style>' +
                    '</head><body>' + (r.value || '') + '</body></html>';
                var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                showSingleResult(blob, baseName(file) + '.html', null);
            });
        });
    }

    function docxToMarkdown(file) {
        return ensureMammoth().then(function (mammoth) {
            return ensureTurndown().then(function (TurndownService) {
                return readArrayBuffer(file).then(function (buf) {
                    return mammoth.convertToHtml({ arrayBuffer: buf });
                }).then(function (r) {
                    var td = new TurndownService({
                        headingStyle: 'atx',
                        bulletListMarker: '-',
                        codeBlockStyle: 'fenced'
                    });
                    var md = td.turndown(r.value || '');
                    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
                    showSingleResult(blob, baseName(file) + '.md', null);
                });
            });
        });
    }

    function docxToText(file) {
        return ensureMammoth().then(function (mammoth) {
            return readArrayBuffer(file).then(function (buf) {
                return mammoth.extractRawText({ arrayBuffer: buf });
            }).then(function (r) {
                var blob = new Blob([r.value || ''], { type: 'text/plain;charset=utf-8' });
                showSingleResult(blob, baseName(file) + '.txt', null);
            });
        });
    }

    // ── Word .docx → PDF ─────────────────────────────────────────────
    // mammoth → HTML → jsPDF doc.html() with autoPaging:'text'
    // This ensures page breaks fall only in whitespace between lines,
    // never mid-glyph (the old slice-at-fixed-interval approach was broken).
    function docxToPdf(file) {
        var mammothLib, JsPDF;
        return ensureMammoth().then(function (m) { mammothLib = m; return ensureHtml2Canvas(); })
            .then(function () { return ensureJsPdf(); })
            .then(function (J) { JsPDF = J; return readArrayBuffer(file); })
            .then(function (buf) { return mammothLib.convertToHtml({ arrayBuffer: buf }); })
            .then(function (r) {
                var holder = document.createElement('div');
                holder.className = 'dt-docx-page';
                holder.style.cssText =
                    'position:fixed;left:-99999px;top:0;width:794px;' +
                    'background:#fff;color:#111;' +
                    'font-family:\'Microsoft JhengHei\',\'PingFang TC\',Arial,sans-serif;' +
                    'font-size:15px;line-height:1.6;box-sizing:border-box;';
                holder.innerHTML = styledDocxHtml(r.value || '');
                document.body.appendChild(holder);

                var doc = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
                var margin = 48;
                var contentW = 595.28 - margin * 2;

                return new Promise(function (resolve, reject) {
                    doc.html(holder, {
                        callback: function (pdf) {
                            if (holder.parentNode) holder.parentNode.removeChild(holder);
                            try {
                                showSingleResult(pdf.output('blob'), baseName(file) + '.pdf', null);
                                resolve();
                            } catch (e) { reject(e); }
                        },
                        x: margin, y: margin,
                        width: contentW,
                        windowWidth: 794,
                        margin: [margin, margin, margin, margin],
                        autoPaging: 'text',
                        image: { type: 'jpeg', quality: 0.92 },
                        html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false }
                    });
                }).catch(function (e) {
                    if (holder.parentNode) holder.parentNode.removeChild(holder);
                    throw e;
                });
            });
    }

    function styledDocxHtml(inner) {
        return '<style>' +
            '.dt-docx-page h1{font-size:24px;margin:.4em 0;page-break-after:avoid}' +
            '.dt-docx-page h2{font-size:20px;margin:.4em 0;page-break-after:avoid}' +
            '.dt-docx-page h3{font-size:17px;margin:.4em 0;page-break-after:avoid}' +
            '.dt-docx-page p{margin:.5em 0}' +
            '.dt-docx-page table{border-collapse:collapse;width:100%;margin:.6em 0;page-break-inside:avoid}' +
            '.dt-docx-page td,.dt-docx-page th{border:1px solid #888;padding:5px 8px}' +
            '.dt-docx-page img{max-width:100%;page-break-inside:avoid}' +
            '.dt-docx-page ul,.dt-docx-page ol{margin:.5em 0 .5em 1.4em}' +
            '</style>' + inner;
    }

    // ════════════════════════════════════════════════════════════════
    //  EXCEL (.xlsx / .xls) conversions
    // ════════════════════════════════════════════════════════════════
    // Convert one worksheet to a GFM Markdown table.
    function sheetToMarkdown(sheet, XLSX) {
        var aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (!aoa.length) return '';
        var cols = aoa.reduce(function (mx, row) { return Math.max(mx, row.length); }, 0);
        if (!cols) return '';
        function mkRow(cells) {
            var padded = cells.slice();
            while (padded.length < cols) padded.push('');
            return '| ' + padded.map(function (c) { return String(c == null ? '' : c).replace(/\|/g, '\\|'); }).join(' | ') + ' |';
        }
        var lines = [];
        lines.push(mkRow(aoa[0]));
        lines.push('| ' + Array(cols).fill('---').join(' | ') + ' |');
        for (var r = 1; r < aoa.length; r++) lines.push(mkRow(aoa[r]));
        return lines.join('\n');
    }

    function xlsxToMarkdown(file) {
        return ensureSheetJs().then(function (XLSX) {
            return readArrayBuffer(file).then(function (buf) {
                var workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
                var parts = workbook.SheetNames.map(function (name) {
                    var md = sheetToMarkdown(workbook.Sheets[name], XLSX);
                    return '## ' + name + '\n\n' + (md || '*Empty sheet*');
                });
                var content = '# ' + baseName(file) + '\n\n' + parts.join('\n\n---\n\n');
                var blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
                showSingleResult(blob, baseName(file) + '.md', null);
            });
        });
    }

    function xlsxToHtml(file) {
        return ensureSheetJs().then(function (XLSX) {
            return readArrayBuffer(file).then(function (buf) {
                var workbook = XLSX.read(new Uint8Array(buf), { type: 'array' });
                var sheets = workbook.SheetNames.map(function (name) {
                    var html = XLSX.utils.sheet_to_html(workbook.Sheets[name]);
                    return '<h2>' + esc(name) + '</h2>\n' + html;
                }).join('\n<hr>\n');
                var full = '<!doctype html><html><head><meta charset="utf-8">' +
                    '<title>' + esc(baseName(file)) + '</title>' +
                    '<style>body{font-family:Arial,sans-serif;padding:20px}' +
                    'table{border-collapse:collapse;margin:12px 0}' +
                    'td,th{border:1px solid #ccc;padding:6px 10px;font-size:13px}' +
                    'th{background:#f0f4ff;font-weight:700}</style>' +
                    '</head><body><h1>' + esc(baseName(file)) + '</h1>' + sheets + '</body></html>';
                var blob = new Blob([full], { type: 'text/html;charset=utf-8' });
                showSingleResult(blob, baseName(file) + '.html', null);
            });
        });
    }

    // ════════════════════════════════════════════════════════════════
    //  POWERPOINT (.pptx) conversions
    // ════════════════════════════════════════════════════════════════
    function pptxExtractSlides(arrayBuffer) {
        return ensureJsZip().then(function (JSZip) {
            return JSZip.loadAsync(arrayBuffer);
        }).then(function (zip) {
            // Collect slide XML files in presentation order
            var slideFiles = Object.keys(zip.files)
                .filter(function (n) { return /^ppt\/slides\/slide\d+\.xml$/.test(n); })
                .sort(function (a, b) {
                    var na = parseInt(a.match(/\d+/)[0]), nb = parseInt(b.match(/\d+/)[0]);
                    return na - nb;
                });
            return Promise.all(slideFiles.map(function (path) {
                return zip.files[path].async('string').then(function (xml) {
                    return pptxSlideToText(xml);
                });
            }));
        });
    }

    function pptxSlideToText(xml) {
        // Extract text from <a:t> elements while preserving paragraph structure
        var parser = new DOMParser();
        var doc = parser.parseFromString(xml, 'text/xml');
        var paragraphs = doc.querySelectorAll('p');
        var lines = [];
        paragraphs.forEach(function (p) {
            var runs = p.querySelectorAll('t, r > t, r t');
            var texts = Array.prototype.slice.call(runs).map(function (t) { return t.textContent || ''; });
            var line = texts.join('').trim();
            if (line) lines.push(line);
        });
        return lines;
    }

    function pptxToMarkdown(file) {
        return readArrayBuffer(file).then(function (buf) {
            return pptxExtractSlides(buf);
        }).then(function (slides) {
            var nonEmpty = slides.filter(function (s) { return s.length > 0; });
            if (!nonEmpty.length) throw new Error(L('errNoText'));
            var md = '# ' + baseName(file) + '\n\n' +
                slides.map(function (lines, i) {
                    if (!lines.length) return '';
                    var title = lines[0];
                    var body = lines.slice(1);
                    return '## Slide ' + (i + 1) + ': ' + title + '\n\n' +
                        body.map(function (l) { return '- ' + l; }).join('\n');
                }).filter(Boolean).join('\n\n---\n\n');
            var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
            showSingleResult(blob, baseName(file) + '.md', null);
        });
    }

    function pptxToText(file) {
        return readArrayBuffer(file).then(function (buf) {
            return pptxExtractSlides(buf);
        }).then(function (slides) {
            var nonEmpty = slides.filter(function (s) { return s.length > 0; });
            if (!nonEmpty.length) throw new Error(L('errNoText'));
            var text = slides.map(function (lines, i) {
                return '─── Slide ' + (i + 1) + ' ───\n' + lines.join('\n');
            }).join('\n\n');
            var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            showSingleResult(blob, baseName(file) + '.txt', null);
        });
    }

    // ════════════════════════════════════════════════════════════════
    //  CSV conversion
    // ════════════════════════════════════════════════════════════════
    function csvToMarkdown(file) {
        return readText(file).then(function (text) {
            var rows = parseCsv(text);
            if (!rows.length) throw new Error('CSV file appears to be empty.');
            var cols = rows.reduce(function (mx, r) { return Math.max(mx, r.length); }, 0);
            function mkRow(cells) {
                var padded = cells.slice();
                while (padded.length < cols) padded.push('');
                return '| ' + padded.map(function (c) { return String(c).replace(/\|/g, '\\|'); }).join(' | ') + ' |';
            }
            var lines = [mkRow(rows[0]), '| ' + Array(cols).fill('---').join(' | ') + ' |'];
            for (var r = 1; r < rows.length; r++) lines.push(mkRow(rows[r]));
            var md = '# ' + baseName(file) + '\n\n' + lines.join('\n') + '\n';
            var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
            showSingleResult(blob, baseName(file) + '.md', null);
        });
    }

    // Minimal RFC 4180 CSV parser (handles quoted fields with embedded commas/newlines)
    function parseCsv(text) {
        var rows = [], row = [], field = '', inQuote = false;
        for (var i = 0; i < text.length; i++) {
            var c = text[i], next = text[i + 1];
            if (inQuote) {
                if (c === '"' && next === '"') { field += '"'; i++; }
                else if (c === '"') { inQuote = false; }
                else { field += c; }
            } else {
                if (c === '"') { inQuote = true; }
                else if (c === ',') { row.push(field); field = ''; }
                else if (c === '\n' || (c === '\r' && next === '\n')) {
                    if (c === '\r') i++;
                    row.push(field); field = '';
                    if (row.some(function (f) { return f !== ''; })) rows.push(row);
                    row = [];
                } else { field += c; }
            }
        }
        row.push(field);
        if (row.some(function (f) { return f !== ''; })) rows.push(row);
        return rows;
    }

    // ════════════════════════════════════════════════════════════════
    return { open: open };
})();

window.DOCTOOLS = DOCTOOLS;
