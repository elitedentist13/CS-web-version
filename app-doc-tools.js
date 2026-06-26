// ════════════════════════════════════════════════════════════════
// app-doc-tools.js — Document Converter (client-side, no server)
//   • Word (.docx) → PDF / HTML / Text
//   • PDF → JPG / PNG (per page) / Text
//   • Images → PDF (combine)  ·  Image → JPG / PNG / WebP
//
// Heavy libraries (pdf.js, jsPDF, mammoth, html2canvas) are loaded lazily
// from jsDelivr only when a conversion that needs them is first run.
// ════════════════════════════════════════════════════════════════
var DOCTOOLS = (function () {
    'use strict';

    var CDN = {
        pdfjs:      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
        pdfjsWorker:'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
        jspdf:      'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
        mammoth:    'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
        html2canvas:'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
    };

    var _files = [];          // currently selected File objects
    var _objectUrls = [];     // blob URLs to revoke when leaving / re-running

    // ── tiny self-contained i18n (en / zh-CN / zh-Hant) ─────────────
    var STR = {
        title:        { en: '🔄 Document Converter',       'zh-CN': '🔄 文件格式转换',          'zh-Hant': '🔄 文件格式轉換' },
        intro:        { en: 'Convert files right in your browser — nothing is uploaded to any server.',
                        'zh-CN': '直接在浏览器中转换文件 — 不会上传到任何服务器。',
                        'zh-Hant': '直接在瀏覽器中轉換檔案 — 不會上傳到任何伺服器。' },
        drop:         { en: 'Drop files here, or click to choose',  'zh-CN': '将文件拖到此处，或点击选择', 'zh-Hant': '將檔案拖到此處，或點擊選擇' },
        dropHint:     { en: 'Word (.docx) · PDF · Images (JPG/PNG/WebP/GIF/BMP)',
                        'zh-CN': 'Word (.docx)·PDF·图片 (JPG/PNG/WebP/GIF/BMP)',
                        'zh-Hant': 'Word (.docx)·PDF·圖片 (JPG/PNG/WebP/GIF/BMP)' },
        chooseBtn:    { en: '📁 Choose files',             'zh-CN': '📁 选择文件',             'zh-Hant': '📁 選擇檔案' },
        clearBtn:     { en: '✕ Clear',                     'zh-CN': '✕ 清除',                 'zh-Hant': '✕ 清除' },
        selected:     { en: 'Selected',                    'zh-CN': '已选择',                 'zh-Hant': '已選擇' },
        actionsTitle: { en: 'Available conversions',       'zh-CN': '可用的转换',             'zh-Hant': '可用的轉換' },
        results:      { en: 'Results',                     'zh-CN': '转换结果',               'zh-Hant': '轉換結果' },
        download:     { en: '⬇ Download',                  'zh-CN': '⬇ 下载',                 'zh-Hant': '⬇ 下載' },
        downloadAll:  { en: '⬇ Download all',              'zh-CN': '⬇ 全部下载',             'zh-Hant': '⬇ 全部下載' },
        quality:      { en: 'Image quality',               'zh-CN': '图片质量',               'zh-Hant': '圖片品質' },
        resolution:   { en: 'PDF render scale',            'zh-CN': 'PDF 渲染倍率',           'zh-Hant': 'PDF 渲染倍率' },
        working:      { en: 'Working…',                    'zh-CN': '处理中…',                'zh-Hant': '處理中…' },
        page:         { en: 'Page',                        'zh-CN': '第',                     'zh-Hant': '第' },
        pageSuffix:   { en: '',                            'zh-CN': '页',                     'zh-Hant': '頁' },
        noActions:    { en: 'No conversions available for this selection. Pick a Word, PDF, or image file.',
                        'zh-CN': '该选择没有可用的转换。请选择 Word、PDF 或图片文件。',
                        'zh-Hant': '此選擇沒有可用的轉換。請選擇 Word、PDF 或圖片檔案。' },
        mixedNote:    { en: 'Tip: select one document at a time, or several images together to merge into one PDF.',
                        'zh-CN': '提示：一次选择一个文档，或一起选择多张图片合并为一个 PDF。',
                        'zh-Hant': '提示：一次選擇一個文件，或一起選擇多張圖片合併為一個 PDF。' },
        docOnly:      { en: 'Only modern Word .docx files are supported (not the old .doc format).',
                        'zh-CN': '仅支持新版 Word .docx 文件（不支持旧版 .doc 格式）。',
                        'zh-Hant': '僅支援新版 Word .docx 檔案（不支援舊版 .doc 格式）。' },
        errLib:       { en: 'Could not load the converter library. Check your internet connection and try again.',
                        'zh-CN': '无法加载转换库。请检查网络连接后重试。',
                        'zh-Hant': '無法載入轉換程式庫。請檢查網路連線後重試。' },
        errGeneric:   { en: 'Conversion failed: ',         'zh-CN': '转换失败：',             'zh-Hant': '轉換失敗：' },
        // action labels
        a_docx_pdf:   { en: '📄 Word → PDF',               'zh-CN': '📄 Word → PDF',          'zh-Hant': '📄 Word → PDF' },
        a_docx_html:  { en: '🌐 Word → HTML',              'zh-CN': '🌐 Word → HTML',         'zh-Hant': '🌐 Word → HTML' },
        a_docx_txt:   { en: '📝 Word → Text',              'zh-CN': '📝 Word → 文本',         'zh-Hant': '📝 Word → 文字' },
        a_pdf_jpg:    { en: '🖼️ PDF → JPG',                'zh-CN': '🖼️ PDF → JPG',           'zh-Hant': '🖼️ PDF → JPG' },
        a_pdf_png:    { en: '🖼️ PDF → PNG',                'zh-CN': '🖼️ PDF → PNG',           'zh-Hant': '🖼️ PDF → PNG' },
        a_pdf_word:   { en: '📄 PDF → Word',               'zh-CN': '📄 PDF → Word',          'zh-Hant': '📄 PDF → Word' },
        a_pdf_txt:    { en: '📝 PDF → Text',               'zh-CN': '📝 PDF → 文本',          'zh-Hant': '📝 PDF → 文字' },
        a_imgs_pdf:   { en: '📚 Images → PDF',             'zh-CN': '📚 图片 → PDF',          'zh-Hant': '📚 圖片 → PDF' },
        a_img_jpg:    { en: '🖼️ Convert to JPG',           'zh-CN': '🖼️ 转为 JPG',            'zh-Hant': '🖼️ 轉為 JPG' },
        a_img_png:    { en: '🖼️ Convert to PNG',           'zh-CN': '🖼️ 转为 PNG',            'zh-Hant': '🖼️ 轉為 PNG' },
        a_img_webp:   { en: '🖼️ Convert to WebP',          'zh-CN': '🖼️ 转为 WebP',           'zh-Hant': '🖼️ 轉為 WebP' }
    };

    function lang() {
        return (typeof getAppLang === 'function') ? getAppLang() : 'en';
    }
    function L(id) {
        var e = STR[id]; if (!e) return id;
        return e[lang()] || e.en || id;
    }
    function gg(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c];
        });
    }

    // ── lazy library loader ─────────────────────────────────────────
    var _loaded = {};
    function loadScript(url) {
        if (_loaded[url]) return _loaded[url];
        _loaded[url] = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = url; s.async = true;
            s.onload = function () { resolve(); };
            s.onerror = function () { _loaded[url] = null; reject(new Error('load failed: ' + url)); };
            document.head.appendChild(s);
        });
        return _loaded[url];
    }
    function ensurePdfJs() {
        if (window.pdfjsLib) { trySetWorker(); return Promise.resolve(window.pdfjsLib); }
        return loadScript(CDN.pdfjs).then(function () {
            trySetWorker();
            return window.pdfjsLib;
        });
    }
    function trySetWorker() {
        try {
            if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions &&
                !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker;
            }
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

    // ── file classification ────────────────────────────────────────
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
        return 'other';
    }
    function kindIcon(k) {
        return { image:'🖼️', pdf:'📕', docx:'📘', doc:'📘', other:'📄' }[k] || '📄';
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
                    'accept=".docx,.pdf,.jpg,.jpeg,.png,.webp,.gif,.bmp,application/pdf,image/*" hidden>' +
            '</div>' +
            '<div id="dtFiles" class="dt-files" style="display:none;"></div>' +
            '<div id="dtPanel" class="dt-panel" style="display:none;"></div>' +
            '<div id="dtResults" class="dt-results" style="display:none;"></div>';

        var drop = gg('dtDrop'), input = gg('dtInput');
        gg('dtChoose').addEventListener('click', function (e) { e.stopPropagation(); input.click(); });
        drop.addEventListener('click', function () { input.click(); });
        drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
        input.addEventListener('change', function () { addFiles(input.files); });
        ['dragenter','dragover'].forEach(function (ev) {
            drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.add('dt-over'); });
        });
        ['dragleave','drop'].forEach(function (ev) {
            drop.addEventListener(ev, function (e) { e.preventDefault(); e.stopPropagation(); drop.classList.remove('dt-over'); });
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
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    function renderActions() {
        var panel = gg('dtPanel');
        if (!panel) return;
        var kinds = {};
        _files.forEach(function (f) { kinds[kindOf(f)] = (kinds[kindOf(f)] || 0) + 1; });
        var allImages = _files.length > 0 && _files.every(function (f) { return kindOf(f) === 'image'; });
        var single = _files.length === 1;
        var k0 = single ? kindOf(_files[0]) : null;

        var actions = [];   // {id, label, run}
        var note = '';

        if (k0 === 'doc') {
            note = L('docOnly');
        } else if (k0 === 'docx') {
            actions.push({ id:'a_docx_pdf',  run: function () { return docxToPdf(_files[0]); } });
            actions.push({ id:'a_docx_html', run: function () { return docxToHtml(_files[0]); } });
            actions.push({ id:'a_docx_txt',  run: function () { return docxToText(_files[0]); } });
        } else if (k0 === 'pdf') {
            actions.push({ id:'a_pdf_jpg', run: function () { return pdfToImages(_files[0], 'image/jpeg'); } });
            actions.push({ id:'a_pdf_png', run: function () { return pdfToImages(_files[0], 'image/png'); } });
            actions.push({ id:'a_pdf_word', run: function () { return pdfToWord(_files[0]); } });
        } else if (allImages) {
            if (_files.length > 1) actions.push({ id:'a_imgs_pdf', run: function () { return imagesToPdf(_files); } });
            else actions.push({ id:'a_imgs_pdf', run: function () { return imagesToPdf(_files); } });
            actions.push({ id:'a_img_jpg',  run: function () { return imagesToFormat(_files, 'image/jpeg'); } });
            actions.push({ id:'a_img_png',  run: function () { return imagesToFormat(_files, 'image/png'); } });
            actions.push({ id:'a_img_webp', run: function () { return imagesToFormat(_files, 'image/webp'); } });
        }

        if (!actions.length) {
            panel.innerHTML = '<div class="dt-empty">' + esc(note || L('noActions')) + '</div>' +
                '<div class="dt-tip">' + esc(L('mixedNote')) + '</div>';
            panel.style.display = 'block';
            return;
        }

        // option controls (quality for image outputs, scale for pdf→image)
        var needsQuality = (k0 === 'image' || allImages);
        var needsScale = (k0 === 'pdf');
        var opts = '';
        if (needsQuality) {
            opts += '<label class="dt-opt"><span>' + esc(L('quality')) + '</span>' +
                '<input type="range" id="dtQuality" min="40" max="100" step="5" value="90">' +
                '<b id="dtQualityVal">90%</b></label>';
        }
        if (needsScale) {
            opts += '<label class="dt-opt"><span>' + esc(L('resolution')) + '</span>' +
                '<input type="range" id="dtScale" min="1" max="4" step="0.5" value="2">' +
                '<b id="dtScaleVal">2×</b></label>';
        }

        var btns = actions.map(function (a, i) {
            return '<button type="button" class="dt-action" data-i="' + i + '">' + esc(L(a.id)) + '</button>';
        }).join('');

        panel.innerHTML =
            '<div class="dt-actions-head"><b>' + esc(L('actionsTitle')) + '</b></div>' +
            (opts ? '<div class="dt-opts">' + opts + '</div>' : '') +
            '<div class="dt-actions">' + btns + '</div>' +
            '<div id="dtStatus" class="dt-status" style="display:none;"></div>';
        panel.style.display = 'block';

        var q = gg('dtQuality'); if (q) q.addEventListener('input', function () { gg('dtQualityVal').textContent = q.value + '%'; });
        var sc = gg('dtScale'); if (sc) sc.addEventListener('input', function () { gg('dtScaleVal').textContent = sc.value + '×'; });

        panel.querySelectorAll('.dt-action').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var a = actions[Number(btn.dataset.i)];
                if (a) runAction(a, btn);
            });
        });
    }

    function qualityVal() { var q = gg('dtQuality'); return q ? Math.max(0.4, Math.min(1, Number(q.value) / 100)) : 0.9; }
    function scaleVal() { var s = gg('dtScale'); return s ? Math.max(1, Math.min(4, Number(s.value))) : 2; }

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
            var msg = (err && /load failed/i.test(err.message || '')) ? L('errLib')
                    : (L('errGeneric') + (err && err.message ? err.message : String(err)));
            setStatus(msg, false);
        }).then(function () {
            all.forEach(function (b) { b.disabled = false; });
        });
    }

    // ── results rendering ───────────────────────────────────────────
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

    // single output → auto-download + a result card with a re-download button
    function showSingleResult(blob, filename, previewUrl) {
        triggerDownload(blob, filename);
        var res = gg('dtResults'); if (!res) return;
        var thumb = previewUrl
            ? '<img class="dt-thumb" src="' + previewUrl + '" alt="">'
            : '<div class="dt-thumb dt-thumb-doc">' + kindIcon(kindFromName(filename)) + '</div>';
        res.innerHTML =
            '<div class="dt-results-head"><b>' + esc(L('results')) + '</b></div>' +
            '<div class="dt-grid">' +
                '<div class="dt-result">' + thumb +
                    '<div class="dt-result-name">' + esc(filename) + '</div>' +
                    '<button type="button" class="dt-dl" id="dtDl0">' + esc(L('download')) + '</button>' +
                '</div>' +
            '</div>';
        res.style.display = 'block';
        gg('dtDl0').addEventListener('click', function () { triggerDownload(blob, filename); });
    }

    function kindFromName(name) {
        var ext = String(name || '').toLowerCase().split('.').pop();
        if (IMG_EXT.indexOf(ext) >= 0) return 'image';
        if (ext === 'pdf') return 'pdf';
        if (ext === 'html') return 'other';
        if (ext === 'txt') return 'other';
        return 'other';
    }

    // multiple image outputs (e.g. PDF → pages) → grid of thumbnails
    function showImageResults(items) {
        // items: [{blob, filename, url}]
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
            '</div>' +
            '<div class="dt-grid">' + cards + '</div>';
        res.style.display = 'block';
        res.querySelectorAll('.dt-dl').forEach(function (b) {
            b.addEventListener('click', function () { var it = items[Number(b.dataset.i)]; triggerDownload(it.blob, it.filename); });
        });
        var all = gg('dtDlAll');
        if (all) all.addEventListener('click', function () {
            items.forEach(function (it, i) { setTimeout(function () { triggerDownload(it.blob, it.filename); }, i * 350); });
        });
    }

    // ════════════════════════════════════════════════════════════════
    //  CONVERSIONS
    // ════════════════════════════════════════════════════════════════
    function readArrayBuffer(file) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () { resolve(r.result); };
            r.onerror = function () { reject(new Error('read error')); };
            r.readAsArrayBuffer(file);
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

    // ── Image → JPG / PNG / WebP ────────────────────────────────────
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

    function canvasToBlob(canvas, mime, q) {
        return new Promise(function (resolve) {
            if (canvas.toBlob) canvas.toBlob(function (b) { resolve(b); }, mime, q);
            else {
                var data = canvas.toDataURL(mime, q);
                resolve(dataUrlToBlob(data));
            }
        });
    }
    function dataUrlToBlob(dataUrl) {
        var parts = dataUrl.split(','), mime = parts[0].match(/:(.*?);/)[1];
        var bin = atob(parts[1]), n = bin.length, u8 = new Uint8Array(n);
        while (n--) u8[n] = bin.charCodeAt(n);
        return new Blob([u8], { type: mime });
    }

    // ── Images → PDF (one image per page, fit to A4) ────────────────
    function imagesToPdf(files) {
        return ensureJsPdf().then(function (JsPDF) {
            var doc = new JsPDF({ unit: 'pt', format: 'a4' });
            var pageW = doc.internal.pageSize.getWidth();
            var pageH = doc.internal.pageSize.getHeight();
            var margin = 24;
            var maxW = pageW - margin * 2, maxH = pageH - margin * 2;
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
                        var ratio = Math.min(maxW / cv.width, maxH / cv.height, 1);
                        // upscale small images to fill width nicely but cap at maxW
                        if (ratio === 1 && cv.width < maxW) ratio = maxW / cv.width;
                        ratio = Math.min(ratio, maxW / cv.width, maxH / cv.height);
                        var w = cv.width * ratio, h = cv.height * ratio;
                        var x = (pageW - w) / 2, y = (pageH - h) / 2;
                        if (idx > 0) doc.addPage();
                        var data = cv.toDataURL('image/jpeg', 0.92);
                        doc.addImage(data, 'JPEG', x, y, w, h);
                    });
                });
            }, Promise.resolve()).then(function () {
                var blob = doc.output('blob');
                var name = (files.length === 1 ? baseName(files[0]) : 'images') + '.pdf';
                showSingleResult(blob, name, null);
            });
        });
    }

    // ── PDF → images (per page) ─────────────────────────────────────
    function pdfToImages(file, mime) {
        var ext = mime === 'image/png' ? 'png' : 'jpg';
        var q = qualityVal();
        var scale = scaleVal();
        return ensurePdfJs().then(function (pdfjsLib) {
            return readArrayBuffer(file).then(function (buf) {
                return pdfjsLib.getDocument({ data: buf }).promise;
            }).then(function (pdf) {
                var out = [];
                var pageChain = Promise.resolve();
                for (var p = 1; p <= pdf.numPages; p++) {
                    (function (pageNum) {
                        pageChain = pageChain.then(function () {
                            return pdf.getPage(pageNum).then(function (page) {
                                var viewport = page.getViewport({ scale: scale });
                                var cv = document.createElement('canvas');
                                cv.width = Math.ceil(viewport.width);
                                cv.height = Math.ceil(viewport.height);
                                var ctx = cv.getContext('2d');
                                if (mime === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); }
                                return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
                                    return canvasToBlob(cv, mime, q).then(function (blob) {
                                        var pad = ('000' + pageNum).slice(-3);
                                        out.push({ blob: blob, filename: baseName(file) + '_p' + pad + '.' + ext, url: makeUrl(blob) });
                                    });
                                });
                            });
                        });
                    })(p);
                }
                return pageChain.then(function () {
                    if (out.length === 1) showSingleResult(out[0].blob, out[0].filename, out[0].url);
                    else showImageResults(out);
                });
            });
        });
    }

    // ── PDF → Word (.doc, rich text) ────────────────────────────────
    // Reconstructs paragraphs / headings / page breaks from the PDF text
    // layer and emits a Word-compatible HTML document that opens directly
    // in Microsoft Word (and Google Docs / WPS / LibreOffice).
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
                                return page.getTextContent().then(function (tc) {
                                    pages.push(pdfPageToHtml(tc, pw));
                                });
                            });
                        });
                    })(p);
                }
                return chain.then(function () {
                    var body = pages.join(
                        '\n<br clear="all" style="mso-special-character:line-break;page-break-before:always">\n'
                    );
                    var html = wordHtmlDoc(baseName(file), body);
                    var blob = new Blob(['\ufeff' + html], { type: 'application/msword' });
                    showSingleResult(blob, baseName(file) + '.doc', null);
                });
            });
        });
    }

    // Turn one page's text content into formatted HTML.
    function pdfPageToHtml(tc, pageWidth) {
        var styles = tc.styles || {};
        var items = [];
        (tc.items || []).forEach(function (it) {
            if (it.str == null || it.str === '') return;
            var tr = it.transform || [1, 0, 0, 1, 0, 0];
            var sz = Math.hypot(tr[2], tr[3]) || it.height || 10;
            var st = styles[it.fontName] || {};
            var fam = String(st.fontFamily || '').toLowerCase();
            items.push({
                x: tr[4], y: tr[5], sz: sz,
                w: it.width || 0, str: it.str,
                bold: /bold|black|heavy|semibold|demi/.test(fam),
                italic: /italic|oblique/.test(fam)
            });
        });
        if (!items.length) return '';

        // Group items into lines by similar baseline (y).
        items.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
        var lines = [];
        items.forEach(function (it) {
            var ln = lines.length ? lines[lines.length - 1] : null;
            if (ln && Math.abs(ln.y - it.y) <= Math.max(2, it.sz * 0.5)) {
                ln.items.push(it);
                ln.sz = Math.max(ln.sz, it.sz);
                if (it.x < ln.minX) ln.minX = it.x;
                if (it.x + it.w > ln.maxX) ln.maxX = it.x + it.w;
            } else {
                lines.push({ y: it.y, sz: it.sz, minX: it.x, maxX: it.x + it.w, items: [it] });
            }
        });

        // Body font size = median of line sizes (for heading detection).
        var sizes = lines.map(function (l) { return l.sz; }).sort(function (a, b) { return a - b; });
        var body = sizes[Math.floor(sizes.length / 2)] || 10;

        var out = [];
        var para = [];
        function flushPara() {
            if (para.length) { out.push('<p>' + para.join(' ') + '</p>'); para = []; }
        }
        for (var i = 0; i < lines.length; i++) {
            var ln = lines[i];
            ln.items.sort(function (a, b) { return a.x - b.x; });
            var runs = lineRuns(ln.items);
            if (!runs.replace(/<[^>]+>/g, '').trim()) continue;

            var centered = pageWidth > 0 &&
                ln.minX > pageWidth * 0.18 &&
                (pageWidth - ln.maxX) > pageWidth * 0.18 &&
                Math.abs(ln.minX - (pageWidth - ln.maxX)) < pageWidth * 0.12;

            var heading = ln.sz >= body * 1.25;
            if (heading) {
                flushPara();
                var tag = ln.sz >= body * 1.7 ? 'h1' : 'h2';
                out.push('<' + tag + (centered ? ' style="text-align:center"' : '') + '>' + runs + '</' + tag + '>');
                continue;
            }

            // Big vertical gap from previous line → new paragraph.
            if (i > 0) {
                var gap = lines[i - 1].y - ln.y;
                if (gap > ln.sz * 1.7) flushPara();
            }
            if (centered) { flushPara(); out.push('<p style="text-align:center">' + runs + '</p>'); }
            else para.push(runs);
        }
        flushPara();
        return out.join('\n');
    }

    // Build inline HTML for one line, inserting spaces where the PDF used
    // positional gaps, and wrapping bold / italic runs.
    function lineRuns(its) {
        var html = '';
        var prevEnd = null;
        for (var i = 0; i < its.length; i++) {
            var it = its[i];
            var s = it.str;
            if (s === '') continue;
            if (prevEnd != null && (it.x - prevEnd) > it.sz * 0.22 &&
                !/\s$/.test(html) && !/^\s/.test(s)) html += ' ';
            var t = esc(s);
            if (it.italic) t = '<i>' + t + '</i>';
            if (it.bold) t = '<b>' + t + '</b>';
            html += t;
            prevEnd = it.x + (it.w || 0);
        }
        return html;
    }

    // Word-compatible HTML wrapper (opens natively in MS Word).
    function wordHtmlDoc(title, body) {
        return '' +
            '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
            'xmlns:w="urn:schemas-microsoft-com:office:word" ' +
            'xmlns="http://www.w3.org/TR/REC-html40">\n' +
            '<head><meta charset="utf-8"><title>' + esc(title) + '</title>\n' +
            '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View>' +
            '<w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->\n' +
            '<style>\n' +
            '@page WordSection1 { size: 595.3pt 841.9pt; margin: 72pt 72pt 72pt 72pt; }\n' +
            'div.WordSection1 { page: WordSection1; }\n' +
            'body { font-family: Calibri, "Microsoft JhengHei", "PingFang TC", sans-serif; font-size: 11pt; color:#1a1a1a; line-height:1.5; }\n' +
            'p { margin: 0 0 8pt 0; }\n' +
            'h1 { font-size: 20pt; margin: 14pt 0 8pt 0; }\n' +
            'h2 { font-size: 15pt; margin: 12pt 0 6pt 0; }\n' +
            '</style></head>\n' +
            '<body><div class="WordSection1">\n' + body + '\n</div></body></html>';
    }

    // ── PDF → Text ──────────────────────────────────────────────────
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
                                return page.getTextContent().then(function (tc) {
                                    var line = tc.items.map(function (it) { return it.str; }).join(' ');
                                    parts.push('— Page ' + pageNum + ' —\n' + line);
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

    // ── Word .docx → HTML ───────────────────────────────────────────
    function docxToHtml(file) {
        return ensureMammoth().then(function (mammoth) {
            return readArrayBuffer(file).then(function (buf) {
                return mammoth.convertToHtml({ arrayBuffer: buf });
            }).then(function (r) {
                var html = wrapHtmlDoc(baseName(file), r.value || '');
                var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
                showSingleResult(blob, baseName(file) + '.html', null);
            });
        });
    }

    // ── Word .docx → Text ───────────────────────────────────────────
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

    // ── Word .docx → PDF (mammoth → styled HTML → html2canvas → jsPDF)
    function docxToPdf(file) {
        var mammothLib, JsPDF, h2c;
        return ensureMammoth().then(function (m) { mammothLib = m; return ensureHtml2Canvas(); })
            .then(function (h) { h2c = h; return ensureJsPdf(); })
            .then(function (J) { JsPDF = J; return readArrayBuffer(file); })
            .then(function (buf) { return mammothLib.convertToHtml({ arrayBuffer: buf }); })
            .then(function (r) {
                var holder = document.createElement('div');
                holder.className = 'dt-docx-page';
                holder.style.cssText =
                    'position:fixed;left:-99999px;top:0;width:794px;padding:48px 56px;' +
                    'background:#fff;color:#111;font-family:\'Microsoft JhengHei\',\'PingFang TC\',Arial,sans-serif;' +
                    'font-size:15px;line-height:1.6;box-sizing:border-box;';
                holder.innerHTML = styledDocxHtml(r.value || '');
                document.body.appendChild(holder);
                return h2c(holder, { scale: 2, backgroundColor: '#ffffff', useCORS: true }).then(function (canvas) {
                    if (holder.parentNode) holder.parentNode.removeChild(holder);
                    var doc = new JsPDF({ unit: 'pt', format: 'a4' });
                    var pageW = doc.internal.pageSize.getWidth();
                    var pageH = doc.internal.pageSize.getHeight();
                    var imgW = pageW;
                    var imgH = canvas.height * pageW / canvas.width;
                    var data = canvas.toDataURL('image/jpeg', 0.92);
                    var heightLeft = imgH;
                    var position = 0;
                    doc.addImage(data, 'JPEG', 0, position, imgW, imgH);
                    heightLeft -= pageH;
                    while (heightLeft > 0) {
                        position = heightLeft - imgH;
                        doc.addPage();
                        doc.addImage(data, 'JPEG', 0, position, imgW, imgH);
                        heightLeft -= pageH;
                    }
                    var blob = doc.output('blob');
                    showSingleResult(blob, baseName(file) + '.pdf', null);
                }).catch(function (e) {
                    if (holder.parentNode) holder.parentNode.removeChild(holder);
                    throw e;
                });
            });
    }

    function styledDocxHtml(inner) {
        return '<style>' +
            '.dt-docx-page h1{font-size:24px;margin:.4em 0;}' +
            '.dt-docx-page h2{font-size:20px;margin:.4em 0;}' +
            '.dt-docx-page h3{font-size:17px;margin:.4em 0;}' +
            '.dt-docx-page p{margin:.5em 0;}' +
            '.dt-docx-page table{border-collapse:collapse;width:100%;margin:.6em 0;}' +
            '.dt-docx-page td,.dt-docx-page th{border:1px solid #888;padding:5px 8px;}' +
            '.dt-docx-page img{max-width:100%;}' +
            '.dt-docx-page ul,.dt-docx-page ol{margin:.5em 0 .5em 1.4em;}' +
            '</style>' + inner;
    }

    function wrapHtmlDoc(title, inner) {
        return '<!doctype html><html><head><meta charset="utf-8">' +
            '<title>' + esc(title) + '</title>' +
            '<style>body{font-family:\'Microsoft JhengHei\',\'PingFang TC\',Arial,sans-serif;' +
            'max-width:800px;margin:32px auto;padding:0 16px;line-height:1.6;color:#111;}' +
            'table{border-collapse:collapse;}td,th{border:1px solid #888;padding:5px 8px;}' +
            'img{max-width:100%;}</style></head><body>' + inner + '</body></html>';
    }

    return { open: open };
})();

window.DOCTOOLS = DOCTOOLS;
