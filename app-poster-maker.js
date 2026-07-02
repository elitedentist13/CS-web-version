// ════════════════════════════════════════════════════════════════
// app-poster-maker.js — Clinic Poster Maker (POSTERMKR)
//   Canvas-based poster designer for clinic staff.
//   Uses Fabric.js 5.x (loaded lazily from CDN).
// ════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var CDN_FABRIC = 'https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.js';
    var CDN_JSPDF  = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';

    // export state
    var _expFmt   = 'png';  // png | jpg | bmp | tiff | pdf
    var _expScale = 2;      // output multiplier (1–4)
    var _expQual  = 85;     // jpeg/pdf quality 0–100

    var _fabric = null;   // cached Fabric.js reference
    var _canvas = null;   // active Fabric.Canvas instance
    var _size   = 'a4p';  // current size preset key
    var _history = [];    // undo/redo stack (JSON snapshots)
    var _histPos = -1;
    var _pauseHistory = false;
    var _pmZoom    = 1.0;       // user zoom multiplier (1 = fit)
    var _clipboard = null;      // copy/paste clipboard (cloned Fabric object)
    var _pages     = [null];    // multi-page: array of {json,bg} per page
    var _pageIdx   = 0;         // active page index
    var _snapGrid  = false;     // snap-to-grid toggle
    var _gridSize  = 20;        // grid cell size in poster units
    var _updatingCtx = false;   // guard for ctx-bar input→canvas loops
    // Drawing tool state
    var _drawTool    = 'select';  // select|pencil|pen|marker|calli|spray|circle|eraser
    var _drawSize    = 6;
    var _drawColor   = '#1a1a1a';
    var _drawOpacity = 1.0;

    // Poster-maker template language (independent of global app language)
    var _pmLang = null;   // null = follow global app lang; 'en'|'zh-CN'|'zh-Hant' = override

    // Online Library state
    var _olTab        = 'photos';   // 'photos' | 'icons' | 'import'
    var _olPhotoSrc   = 'openverse'; // 'openverse' | 'unsplash' | 'pexels'
    var _olResults    = [];         // current search results (photos or icons)
    var _olIconPrefix = 'medical-icon'; // last Iconify search context

    var SIZES = {
        a4p:    { w: 794, h: 1123, label: 'A4 Portrait'   },
        a4l:    { w: 1123, h: 794, label: 'A4 Landscape'  },
        a5p:    { w: 559,  h: 794, label: 'A5 Portrait'   },
        sq:     { w: 700,  h: 700, label: 'Square'        },
        banner: { w: 1050, h: 350, label: 'Wide Banner'   }
    };

    // ── Font library ─────────────────────────────────────────────
    var FONT_GROUPS = [
        { grp: 'System',     sys: true, fonts: [
            'Arial','Arial Black','Comic Sans MS','Courier New','Georgia',
            'Impact','Palatino','Times New Roman','Trebuchet MS','Verdana','Tahoma'
        ]},
        { grp: 'Sans-Serif', sys: false, fonts: [
            'Barlow','Inter','Lato','Montserrat','Mulish','Nunito',
            'Open Sans','Oswald','Poppins','Raleway','Roboto','Ubuntu','Work Sans'
        ]},
        { grp: 'Serif',      sys: false, fonts: [
            'Crimson Text','EB Garamond','Libre Baskerville','Lora',
            'Merriweather','Playfair Display','PT Serif'
        ]},
        { grp: 'Display',    sys: false, fonts: [
            'Abril Fatface','Alfa Slab One','Bebas Neue','Black Ops One',
            'Dancing Script','Lobster','Pacifico','Righteous','Satisfy','Secular One'
        ]},
        { grp: 'Mono',       sys: false, fonts: [
            'Source Code Pro','Space Mono','Roboto Mono'
        ]}
    ];
    // Flat list (kept for compat)
    var FONTS = FONT_GROUPS.reduce(function (a, g) { return a.concat(g.fonts); }, []);
    // Track loaded Google Fonts
    var _gfLoaded = {};

    // ── i18n helpers ────────────────────────────────────────────
    function lang() {
        // _pmLang overrides global app language for template text
        if (_pmLang) return _pmLang;
        return typeof getAppLang === 'function' ? getAppLang() : 'en';
    }
    function t(en, cn, ht) {
        var l = lang();
        if (l === 'zh-CN')   return cn != null ? cn : en;
        if (l === 'zh-Hant') return ht != null ? ht : (cn != null ? cn : en);
        return en;
    }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/[&<>"]/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
            });
    }
    function g(id) { return document.getElementById(id); }

    // ── CDN loader ───────────────────────────────────────────────
    function loadScript(url) {
        var key = '__pmscript_' + url;
        if (window[key]) return window[key];
        window[key] = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = url; s.async = true;
            s.onload  = resolve;
            s.onerror = function () { window[key] = null; reject(new Error('Failed: ' + url)); };
            document.head.appendChild(s);
        });
        return window[key];
    }
    function ensureFabric() {
        if (window.fabric) { _fabric = window.fabric; return Promise.resolve(_fabric); }
        return loadScript(CDN_FABRIC).then(function () {
            _fabric = window.fabric;
            return _fabric;
        });
    }

    // ── Entry point ──────────────────────────────────────────────
    function open() {
        if (typeof showOnly === 'function') showOnly('posterMakerSection');
        if (_canvas) { try { _canvas.dispose(); } catch (e) {} _canvas = null; }
        // Reset per-session state
        _pmZoom  = 1.0;
        _pages   = [null];
        _pageIdx = 0;
        _snapGrid = false;
        _pmLang   = null;   // reset language override on fresh open
        var app = g('posterMakerApp');
        if (app) app.innerHTML =
            '<div style="padding:20px;color:#64748b;text-align:center;">' +
            esc(t('Loading canvas engine…', '加载画布引擎…', '載入畫布引擎…')) + '</div>';
        // Silently fetch API keys from Supabase so new browsers get them automatically
        pmFetchApiKeysFromSupabase();
        ensureFabric().then(function (fabric) {
            render(fabric);
        }).catch(function (e) {
            if (app) app.innerHTML =
                '<p style="color:#dc2626;padding:20px;">Fabric.js failed to load: ' +
                esc(String(e && e.message || e)) + '</p>';
        });
    }

    // ── Style helpers ────────────────────────────────────────────
    function sideBtn(extra) {
        return 'width:100%;padding:7px 10px;background:#1e293b;color:#e2e8f0;' +
               'border:1px solid #334155;border-radius:8px;cursor:pointer;' +
               'font-size:12px;text-align:left;box-sizing:border-box;' + (extra || '');
    }
    function toolBtn() { return sideBtn(); }
    function tplBtn()  { return sideBtn(); }
    function fmtBtn()  {
        return 'flex:1;padding:5px 2px;border:1px solid #e5e7eb;border-radius:6px;' +
               'background:#f8fafc;cursor:pointer;font-size:13px;min-width:0;';
    }
    function actBtn(col) {
        return 'width:100%;padding:7px 10px;background:' + col + ';color:#fff;border:none;' +
               'border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;';
    }
    function tbBtn(col) {
        return 'padding:8px 14px;background:' + col + ';color:#fff;border:none;' +
               'border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;';
    }

    // ── Main render ──────────────────────────────────────────────
    function render(fabric) {
        var app = g('posterMakerApp');
        if (!app) return;

        var sizeOpts = Object.keys(SIZES).map(function (k) {
            return '<option value="' + k + '"' + (k === _size ? ' selected' : '') + '>' +
                   esc(SIZES[k].label) + '</option>';
        }).join('');
        // Build font picker list HTML (shown in custom dropdown)
        var fontListHtml = FONT_GROUPS.map(function (grp) {
            var items = grp.fonts.map(function (f) {
                return '<div class="pm-font-opt" data-font="' + esc(f) + '"' +
                    (grp.sys ? ' data-sys="1"' : '') +
                    ' style="padding:5px 10px;cursor:pointer;font-size:14px;line-height:1.3;' +
                    'font-family:\'' + esc(f) + '\',sans-serif;' +
                    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#1a1a1a;"' +
                    ' onmouseover="this.style.background=\'#f1f5f9\';"' +
                    ' onmouseout="this.style.background=\'\';">' +
                    esc(f) + '</div>';
            }).join('');
            return '<div class="pm-font-group-hdr" style="padding:3px 10px;font-size:9px;font-weight:700;' +
                'color:#94a3b8;letter-spacing:0.5px;background:#f8fafc;border-top:1px solid #f1f5f9;' +
                'text-transform:uppercase;">' + esc(grp.grp) + '</div>' + items;
        }).join('');

        app.innerHTML =
        // ── Outer wrapper ──────────────────────────────────────
        '<div id="pm-shell" style="display:flex;flex-direction:column;gap:10px;">' +

        // ── Main Toolbar ──────────────────────────────────────────
        '<div id="pm-toolbar" style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;' +
            'background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:8px 12px;">' +

            // History
            '<button id="pm-undo" title="Undo (Ctrl+Z)" style="' + tbBtn('#475569') + '">↩</button>' +
            '<button id="pm-redo" title="Redo (Ctrl+Y)" style="' + tbBtn('#475569') + '">↪</button>' +
            '<div style="width:1px;height:22px;background:#e5e7eb;margin:0 2px;"></div>' +

            // Clipboard
            '<button id="pm-copy"  title="Copy (Ctrl+C)"      style="' + tbBtn('#0891b2') + '">⎘</button>' +
            '<button id="pm-paste" title="Paste (Ctrl+V)"     style="' + tbBtn('#0891b2') + '">⎙</button>' +
            '<button id="pm-dup"   title="Duplicate (Ctrl+D)" style="' + tbBtn('#0891b2') + '">⧉</button>' +
            '<button id="pm-sel-all" title="Select All (Ctrl+A)" style="' + tbBtn('#64748b') + '">⊞ ' + esc(t('All','全选','全選')) + '</button>' +
            '<div style="width:1px;height:22px;background:#e5e7eb;margin:0 2px;"></div>' +

            // Zoom
            '<button id="pm-zoom-out" title="Zoom Out"   style="' + tbBtn('#374151') + '">−</button>' +
            '<span   id="pm-zoom-pct" style="font-size:12px;font-weight:700;color:#374151;' +
                'min-width:38px;text-align:center;cursor:default;">100%</span>' +
            '<button id="pm-zoom-in"  title="Zoom In"    style="' + tbBtn('#374151') + '">+</button>' +
            '<button id="pm-zoom-fit" title="Fit to Window" style="' + tbBtn('#374151') + '">⊡ ' + esc(t('Fit','适合','適合')) + '</button>' +
            '<div style="width:1px;height:22px;background:#e5e7eb;margin:0 2px;"></div>' +

            // Grid snap toggle
            '<button id="pm-grid-toggle" title="Snap to Grid" style="' + tbBtn('#94a3b8') + '">⊞ ' + esc(t('Grid','网格','網格')) + '</button>' +
            '<div style="width:1px;height:22px;background:#e5e7eb;margin:0 4px;"></div>' +

            // Template language selector
            '<span style="font-size:10px;color:#94a3b8;white-space:nowrap;">' + esc(t('Template Lang:','模板语言:','模板語言:')) + '</span>' +
            '<div style="display:flex;gap:0;border:1px solid #e5e7eb;border-radius:7px;overflow:hidden;">' +
                '<button class="pm-lang-btn" data-pmlang="" ' +
                    'style="font-size:10px;padding:4px 7px;border:none;cursor:pointer;font-weight:700;' +
                    'background:#3b82f6;color:#fff;" title="Follow app language">Auto</button>' +
                '<button class="pm-lang-btn" data-pmlang="en" ' +
                    'style="font-size:10px;padding:4px 7px;border:none;cursor:pointer;font-weight:700;' +
                    'background:#f1f5f9;color:#374151;border-left:1px solid #e5e7eb;" title="English">EN</button>' +
                '<button class="pm-lang-btn" data-pmlang="zh-CN" ' +
                    'style="font-size:10px;padding:4px 7px;border:none;cursor:pointer;font-weight:700;' +
                    'background:#f1f5f9;color:#374151;border-left:1px solid #e5e7eb;" title="Simplified Chinese">简</button>' +
                '<button class="pm-lang-btn" data-pmlang="zh-Hant" ' +
                    'style="font-size:10px;padding:4px 7px;border:none;cursor:pointer;font-weight:700;' +
                    'background:#f1f5f9;color:#374151;border-left:1px solid #e5e7eb;" title="Traditional Chinese">繁</button>' +
            '</div>' +
            '<div style="flex:1;"></div>' +

            // Canvas size (moved here from sidebar)
            '<select id="pm-size" style="padding:6px 8px;border:1px solid #e5e7eb;border-radius:8px;' +
                'font-size:12px;background:#f8fafc;cursor:pointer;">' + sizeOpts + '</select>' +

            '<button id="pm-clear"   title="Clear Canvas" style="' + tbBtn('#dc2626') + '">🗑</button>' +
            '<button id="pm-save-as" style="' + tbBtn('#7c3aed') + '">💾 ' + esc(t('Save As…','另存为…','另存為…')) + '</button>' +
            '<button id="pm-print"   style="' + tbBtn('#0d6efd') + '">🖨 ' + esc(t('Print','打印','列印')) + '</button>' +
            '<div style="width:1px;height:22px;background:#e5e7eb;margin:0 2px;"></div>' +
            '<button id="pm-proj-open" title="' + esc(t('Open Project File','打开项目文件','開啟專案檔案')) + '" style="' + tbBtn('#0f766e') + '">📂 ' + esc(t('Open','打开','開啟')) + '</button>' +
            '<button id="pm-proj-save" title="' + esc(t('Save Project File','保存项目文件','儲存專案檔案')) + '" style="' + tbBtn('#0f766e') + '">🗂 ' + esc(t('Save Project','保存项目','儲存專案')) + '</button>' +
            '<input type="file" id="pm-proj-file-input" accept=".postermkr,.json" style="display:none;">' +
        '</div>' +

        // ── Save-As panel (hidden until button clicked) ───────
        '<div id="pm-save-panel" style="display:none;background:#fff;border:1px solid #e5e7eb;' +
            'border-radius:12px;padding:14px 16px;gap:14px;flex-wrap:wrap;align-items:center;">' +

            // Format pills
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                '<span style="font-size:11px;font-weight:700;color:#64748b;white-space:nowrap;">' + esc(t('Format', '格式', '格式')) + '</span>' +
                '<div id="pm-fmt-group" style="display:flex;gap:4px;flex-wrap:wrap;">' +
                    ['png','jpg','bmp','tiff','pdf'].map(function(f) {
                        var active = f === _expFmt;
                        return '<button class="pm-fmt-btn" data-fmt="' + f + '" style="' +
                            'padding:5px 12px;border-radius:20px;border:1px solid ' + (active ? '#7c3aed' : '#e5e7eb') + ';' +
                            'background:' + (active ? '#7c3aed' : '#fff') + ';' +
                            'color:' + (active ? '#fff' : '#374151') + ';' +
                            'font-size:12px;font-weight:700;cursor:pointer;text-transform:uppercase;">' + f + '</button>';
                    }).join('') +
                '</div>' +
            '</div>' +

            // Scale pills
            '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
                '<span style="font-size:11px;font-weight:700;color:#64748b;white-space:nowrap;">' + esc(t('Resolution', '分辨率', '解析度')) + '</span>' +
                '<div id="pm-scale-group" style="display:flex;gap:4px;flex-wrap:wrap;">' +
                    [['1','Screen 1×','屏幕 1×','螢幕 1×'],['2','Standard 2×','标准 2×','標準 2×'],
                     ['3','High 3×','高清 3×','高清 3×'],['4','Print 4×','印刷 4×','印刷 4×']].map(function(s) {
                        var active = Number(s[0]) === _expScale;
                        return '<button class="pm-scale-btn" data-scale="' + s[0] + '" style="' +
                            'padding:5px 11px;border-radius:20px;border:1px solid ' + (active ? '#0ea5e9' : '#e5e7eb') + ';' +
                            'background:' + (active ? '#0ea5e9' : '#fff') + ';' +
                            'color:' + (active ? '#fff' : '#374151') + ';' +
                            'font-size:12px;font-weight:700;cursor:pointer;">' + esc(t(s[1], s[2], s[3])) + '</button>';
                    }).join('') +
                '</div>' +
            '</div>' +

            // Quality slider (JPG / PDF only)
            '<div id="pm-qual-row" style="display:' + (_expFmt === 'jpg' || _expFmt === 'pdf' ? 'flex' : 'none') + ';' +
                'align-items:center;gap:8px;">' +
                '<span style="font-size:11px;font-weight:700;color:#64748b;white-space:nowrap;">' + esc(t('Quality', '质量', '質量')) + '</span>' +
                '<input type="range" id="pm-qual-slider" min="20" max="100" step="5" value="' + _expQual + '" ' +
                    'style="width:120px;">' +
                '<span id="pm-qual-val" style="font-size:12px;font-weight:700;color:#374151;min-width:32px;">' + _expQual + '%</span>' +
            '</div>' +

            // Size estimate + Download button
            '<div style="display:flex;align-items:center;gap:10px;margin-left:auto;">' +
                '<span id="pm-size-hint" style="font-size:11px;color:#94a3b8;"></span>' +
                '<button id="pm-do-save" style="' + tbBtn('#16a34a') + '">📥 ' + esc(t('Download', '下载', '下載')) + '</button>' +
            '</div>' +
        '</div>' +

        // ── Contextual Action Bar (shown when object selected) ────
        '<div id="pm-ctx-bar" style="display:none;background:#f8fafc;border:1px solid #e2e8f0;' +
            'border-radius:10px;padding:6px 10px;gap:5px;align-items:center;flex-wrap:wrap;">' +

            // Position & Size
            '<span style="font-size:10px;font-weight:700;color:#64748b;">X</span>' +
            '<input type="number" id="pm-pos-x" min="0" style="width:54px;padding:4px 5px;' +
                'border:1px solid #e5e7eb;border-radius:5px;font-size:11px;text-align:center;">' +
            '<span style="font-size:10px;font-weight:700;color:#64748b;">Y</span>' +
            '<input type="number" id="pm-pos-y" min="0" style="width:54px;padding:4px 5px;' +
                'border:1px solid #e5e7eb;border-radius:5px;font-size:11px;text-align:center;">' +
            '<span style="font-size:10px;font-weight:700;color:#64748b;">W</span>' +
            '<input type="number" id="pm-ctx-w"  min="1" style="width:54px;padding:4px 5px;' +
                'border:1px solid #e5e7eb;border-radius:5px;font-size:11px;text-align:center;">' +
            '<span style="font-size:10px;font-weight:700;color:#64748b;">H</span>' +
            '<input type="number" id="pm-ctx-h"  min="1" style="width:54px;padding:4px 5px;' +
                'border:1px solid #e5e7eb;border-radius:5px;font-size:11px;text-align:center;">' +
            '<div style="width:1px;height:20px;background:#e5e7eb;margin:0 2px;"></div>' +

            // Flip
            '<button id="pm-flip-h" title="Flip Horizontal" style="' + tbBtn('#475569') + '">⇄ ' + esc(t('Flip H','翻转H','翻轉H')) + '</button>' +
            '<button id="pm-flip-v" title="Flip Vertical"   style="' + tbBtn('#475569') + '">⇅ ' + esc(t('Flip V','翻转V','翻轉V')) + '</button>' +
            '<div style="width:1px;height:20px;background:#e5e7eb;margin:0 2px;"></div>' +

            // Layer
            '<button id="pm-to-front" title="Bring to Front" style="' + tbBtn('#0ea5e9') + '">⤒</button>' +
            '<button id="pm-bring-fwd" title="Bring Forward" style="' + tbBtn('#38bdf8') + '">↑</button>' +
            '<button id="pm-send-bk"   title="Send Backward" style="' + tbBtn('#94a3b8') + '">↓</button>' +
            '<button id="pm-to-back"  title="Send to Back"  style="' + tbBtn('#64748b') + '">⤓</button>' +
            '<div style="width:1px;height:20px;background:#e5e7eb;margin:0 2px;"></div>' +

            // Group / Ungroup
            '<button id="pm-group"   title="Group (Ctrl+G)"         style="' + tbBtn('#7c3aed') + '">⊞ ' + esc(t('Group','组合','組合')) + '</button>' +
            '<button id="pm-ungroup" title="Ungroup (Ctrl+Shift+G)" style="' + tbBtn('#a78bfa') + '">⊟ ' + esc(t('Ungroup','取消组合','取消組合')) + '</button>' +
            '<div style="width:1px;height:20px;background:#e5e7eb;margin:0 2px;"></div>' +

            // Lock
            '<button id="pm-lock" title="Lock / Unlock" style="' + tbBtn('#64748b') + '">🔒 ' + esc(t('Lock','锁定','鎖定')) + '</button>' +

            // Opacity (quick slider)
            '<div style="width:1px;height:20px;background:#e5e7eb;margin:0 2px;"></div>' +
            '<span style="font-size:10px;font-weight:700;color:#64748b;">' + esc(t('Opacity','不透明度','不透明度')) + '</span>' +
            '<input type="range" id="pm-ctx-opacity" min="0" max="100" value="100" style="width:80px;">' +
            '<span id="pm-ctx-opval" style="font-size:11px;font-weight:700;color:#374151;min-width:32px;">100%</span>' +

            // Align (spacer then align row)
            '<div style="flex:1;min-width:8px;"></div>' +
            '<div id="pm-align-btns" style="display:flex;gap:2px;align-items:center;">' +
                '<span style="font-size:9px;font-weight:700;color:#94a3b8;">' + esc(t('ALIGN','对齐','對齊')) + '</span>' +
                '<button id="pm-aln-l"  title="Align Left"               style="' + tbBtn('#0f172a') + '" onclick="">⬛⬜⬜</button>' +
                '<button id="pm-aln-ch" title="Align Centre Horizontally" style="' + tbBtn('#0f172a') + '">⬜⬛⬜</button>' +
                '<button id="pm-aln-r"  title="Align Right"              style="' + tbBtn('#0f172a') + '">⬜⬜⬛</button>' +
                '<button id="pm-aln-t"  title="Align Top"                style="' + tbBtn('#1e293b') + '">⬛⬜</button>' +
                '<button id="pm-aln-cv" title="Align Centre Vertically"  style="' + tbBtn('#1e293b') + '">⬜⬛</button>' +
                '<button id="pm-aln-b"  title="Align Bottom"             style="' + tbBtn('#1e293b') + '">⬜⬛</button>' +
                '<button id="pm-dist-h" title="Distribute Horizontally"  style="' + tbBtn('#334155') + '">⇔</button>' +
                '<button id="pm-dist-v" title="Distribute Vertically"    style="' + tbBtn('#334155') + '">⇕</button>' +
            '</div>' +
            '<div style="margin-left:4px;">' +
                '<button id="pm-dup-obj" title="Duplicate" style="' + tbBtn('#16a34a') + '">⧉</button>' +
                '<button id="pm-del-obj" title="Delete (Del)" style="' + tbBtn('#dc2626') + '" style="margin-left:3px;">🗑</button>' +
            '</div>' +
        '</div>' +

        // Main row: sidebar + canvas + props
        '<div style="display:flex;gap:0;border:1px solid #e5e7eb;border-radius:14px;' +
            'overflow:hidden;background:#f1f5f9;min-height:560px;">' +

        // ── Left sidebar ──────────────────────────────────────
        '<div id="pm-sidebar" style="width:192px;min-width:192px;background:#0f172a;color:#f1f5f9;' +
            'padding:10px 10px;display:flex;flex-direction:column;gap:8px;overflow-y:auto;">' +

            // ── CANVAS (background only; size is in toolbar) ──────
            '<div style="font-size:10px;font-weight:900;color:#94a3b8;letter-spacing:1px;">' +
                esc(t('CANVAS', '画布', '畫布')) + '</div>' +
            '<div>' +
                '<label style="font-size:10px;color:#94a3b8;display:block;margin-bottom:3px;">' +
                    esc(t('Background', '背景', '背景')) + '</label>' +
                '<input type="color" id="pm-bg" value="#ffffff" ' +
                    'style="width:100%;height:28px;border-radius:6px;border:1px solid #334155;' +
                    'cursor:pointer;background:none;box-sizing:border-box;">' +
            '</div>' +

            // ── DRAW TOOLS ─────────────────────────────────────────
            (function () {
                var SB = '#1e293b'; // button bg
                var SA = '#3b82f6'; // active bg
                function dtBtn(id, icon, label, active) {
                    return '<button class="pm-draw-btn" data-dtool="' + id + '" title="' + esc(label) + '" ' +
                        'style="display:flex;flex-direction:column;align-items:center;justify-content:center;' +
                        'width:38px;height:38px;background:' + (active ? SA : SB) + ';' +
                        'border:1px solid ' + (active ? '#60a5fa' : '#334155') + ';' +
                        'border-radius:6px;cursor:pointer;color:#f1f5f9;font-size:14px;' +
                        'box-sizing:border-box;padding:0;transition:background 0.15s;">' +
                        icon +
                        '</button>';
                }
                return (
                    '<div style="border-top:1px solid #1e293b;"></div>' +
                    '<div style="font-size:10px;font-weight:900;color:#94a3b8;letter-spacing:1px;">' +
                        esc(t('DRAW', '绘图', '繪圖')) + '</div>' +

                    // Tool grid (4 per row)
                    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:3px;">' +
                        dtBtn('select',  '↖',  t('Select (V)','选择','選擇'),        _drawTool==='select') +
                        dtBtn('pencil',  '✏️', t('Pencil','铅笔','鉛筆'),             _drawTool==='pencil') +
                        dtBtn('pen',     '🖊',  t('Pen','圆珠笔','原子筆'),           _drawTool==='pen') +
                        dtBtn('marker',  '🖍',  t('Marker','马克笔','麥克筆'),        _drawTool==='marker') +
                        dtBtn('calli',   '✒️', t('Calligraphy','书法笔','書法筆'),   _drawTool==='calli') +
                        dtBtn('spray',   '💨',  t('Spray','喷漆','噴漆'),            _drawTool==='spray') +
                        dtBtn('circle',  '⭕',  t('Circle Brush','圆形笔','圓形筆'), _drawTool==='circle') +
                        dtBtn('eraser',  '⬜',  t('Eraser','橡皮擦','橡皮擦'),       _drawTool==='eraser') +
                    '</div>' +

                    // Brush colour
                    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;align-items:center;">' +
                        '<label style="font-size:10px;color:#94a3b8;">' + esc(t('Colour','颜色','顏色')) + '</label>' +
                        '<input type="color" id="pm-draw-color" value="' + _drawColor + '" ' +
                            'style="width:100%;height:26px;border-radius:5px;border:1px solid #334155;' +
                            'cursor:pointer;background:none;box-sizing:border-box;">' +
                    '</div>' +

                    // Brush size
                    '<div>' +
                        '<label style="font-size:10px;color:#94a3b8;display:flex;justify-content:space-between;">' +
                            esc(t('Size','笔刷大小','筆刷大小')) +
                            '<span id="pm-draw-size-val">' + _drawSize + 'px</span>' +
                        '</label>' +
                        '<input type="range" id="pm-draw-size" min="1" max="80" value="' + _drawSize + '" ' +
                            'style="width:100%;accent-color:#3b82f6;">' +
                    '</div>' +

                    // Opacity (used by marker)
                    '<div>' +
                        '<label style="font-size:10px;color:#94a3b8;display:flex;justify-content:space-between;">' +
                            esc(t('Opacity','不透明度','不透明度')) +
                            '<span id="pm-draw-op-val">' + Math.round(_drawOpacity * 100) + '%</span>' +
                        '</label>' +
                        '<input type="range" id="pm-draw-opacity" min="10" max="100" value="' + Math.round(_drawOpacity * 100) + '" ' +
                            'style="width:100%;accent-color:#3b82f6;">' +
                    '</div>'
                );
            })() +

            // ── TEMPLATES (collapsible groups) ────────────────────
            (function () {
                // <details> styles for dark sidebar
                var DS = 'margin-bottom:3px;border-radius:6px;overflow:hidden;';
                var SS = 'cursor:pointer;list-style:none;display:flex;align-items:center;gap:5px;' +
                         'padding:5px 6px;font-size:10px;font-weight:900;color:#94a3b8;letter-spacing:0.5px;' +
                         'background:#1e293b;border-radius:5px;user-select:none;' +
                         'border:none;outline:none;-webkit-appearance:none;';
                var CI = 'display:flex;flex-direction:column;gap:3px;padding:5px 0 5px 4px;';

                function grp(label, icon, items, open) {
                    return '<details' + (open ? ' open' : '') + ' style="' + DS + '">' +
                        '<summary style="' + SS + '">' +
                            '<span style="font-size:8px;display:inline-block;width:10px;' +
                                'transform:rotate(0deg);transition:transform 0.2s;">▶</span>' +
                            icon + ' ' + esc(label) +
                        '</summary>' +
                        '<div style="' + CI + '">' + items + '</div>' +
                    '</details>';
                }
                function tp(id, icon, label) {
                    return '<button class="pm-tpl" data-tpl="' + id + '" style="' + tplBtn() + '">' +
                        icon + ' ' + esc(label) + '</button>';
                }

                return (
                    '<div style="border-top:1px solid #1e293b;"></div>' +
                    '<div style="font-size:10px;font-weight:900;color:#94a3b8;letter-spacing:1px;">' +
                        esc(t('TEMPLATES','模板','模板')) +
                    '</div>' +

                    grp(t('General','通用','通用'), '📋',
                        tp('blank','📄',t('Blank','空白','空白')) +
                        tp('info','ℹ️',t('Clinic Info','诊所资讯','診所資訊')) +
                        tp('newdr','👨‍⚕️',t('New Doctor','新医生','新醫生')) +
                        tp('newsvc','✨',t('New Service','新服务','新服務')),
                    true) +

                    grp(t('Appointments','预约','預約'), '📅',
                        tp('appt','📅',t('Appointment','预约提醒','預約提醒')) +
                        tp('followup','🔁',t('Follow-up','复诊提醒','覆診提醒')) +
                        tp('missed','⚠️',t('Missed Appt','缺席通知','缺席通知')),
                    false) +

                    grp(t('Health Tips','健康贴士','健康貼士'), '💚',
                        tp('health','💚',t('Health Tip','健康贴士','健康貼士')) +
                        tp('dental','🦷',t('Dental Care','牙齿护理','牙齒護理')) +
                        tp('vaccine','💉',t('Vaccination','疫苗接种','疫苗接種')) +
                        tp('flu','🤧',t('Flu Alert','流感警报','流感警報')) +
                        tp('hygiene','🧼',t('Hand Hygiene','手部卫生','手部衛生')),
                    false) +

                    grp(t('Notices','通告','通告'), '📢',
                        tp('holiday','🎉',t('Holiday Notice','假期通知','假期通知')) +
                        tp('closed','🔴',t('Clinic Closed','今日停诊','今日停診')) +
                        tp('redhours','🕐',t('Reduced Hours','缩短时间','縮短時間')) +
                        tp('emergency','🚨',t('Emergency Info','紧急资讯','緊急資訊')),
                    false) +

                    grp(t('Waiting Room','候诊室','候診室'), '🪑',
                        tp('register','🪪',t('Registration','登记处','登記處')) +
                        tp('mask','😷',t('Mask Required','请戴口罩','請戴口罩')) +
                        tp('nophone','📵',t('No Mobile','请勿使用手机','請勿使用手機')) +
                        tp('quiet','🤫',t('Quiet Please','请保持安静','請保持安靜')),
                    false) +

                    grp(t('Promotions','推广','推廣'), '🔬',
                        tp('screening','🔬',t('Health Screening','健康检查','健康檢查')) +
                        tp('bpcheck','❤️',t('BP Check','血压检测','血壓檢測')) +
                        tp('senior','👴',t('Senior Package','乐龄配套','樂齡配套')),
                    false) +

                    grp(t('Dental Education','牙科教育','牙科教育'), '🦷',
                        tp('de_brushing','🪥',t('Brushing Guide','刷牙指南','刷牙指南')) +
                        tp('de_flossing','🧵',t('Flossing 101','牙线使用','牙線使用')) +
                        tp('de_cavity','🦷',t('Cavities','蛀牙成因','蛀牙成因')) +
                        tp('de_gum','🩸',t('Gum Disease','牙周病','牙周病')) +
                        tp('de_kidsteeth','🧒',t('Kids Teeth','儿童牙齿','兒童牙齒')) +
                        tp('de_diet','🍎',t('Diet & Teeth','饮食与牙齿','飲食與牙齒')) +
                        tp('de_whitening','✨',t('Whitening','牙齿美白','牙齒美白')) +
                        tp('de_implant','🔩',t('Implants','植牙','植牙')) +
                        tp('de_braces','😁',t('Braces','牙齿矫正','牙齒矯正')) +
                        tp('de_dentalemer','🚑',t('Dental Emergency','牙科急症','牙科急症')),
                    false) +

                    grp(t('Events & Info','活动资讯','活動資訊'), '🎪',
                        tp('ev_healthtalk','🎤',t('Health Talk','健康讲座','健康講座')) +
                        tp('ev_openday','🚪',t('Open Day','开放日','開放日')) +
                        tp('ev_dentalcamp','⛺',t('Dental Camp','义诊活动','義診活動')) +
                        tp('ev_workshop','🛠',t('Workshop','工作坊','工作坊')) +
                        tp('ev_grandopening','🎀',t('Grand Opening','盛大开幕','盛大開幕')) +
                        tp('ev_anniversary','🎂',t('Anniversary','周年庆典','週年慶典')) +
                        tp('ev_promo','🏷',t('Special Offer','特别优惠','特別優惠')) +
                        tp('ev_schedule','🗓',t('Event Schedule','活动流程','活動流程')) +
                        tp('ev_webinar','💻',t('Webinar','网络研讨会','網路研討會')) +
                        tp('ev_charity','🤝',t('Charity Event','慈善活动','慈善活動')),
                    false) +

                    grp(t('Other Templates','其他模板','其他模板'), '📌',
                        tp('diabcare','🩺',t('Diabetes Care','糖尿病护理','糖尿病護理')) +
                        tp('mentalhealth','🧠',t('Mental Health','心理健康','心理健康')) +
                        tp('eyecare','👁',t('Eye Care','眼部护理','眼部護理')) +
                        tp('physio','💪',t('Physiotherapy','物理治疗','物理治療')) +
                        tp('telemedicine','📱',t('Telemedicine','视频诊疗','視像診療')) +
                        tp('pharmacy','💊',t('Pharmacy','药房','藥房')) +
                        tp('thankyou','🙏',t('Thank You','感谢','感謝')) +
                        tp('feedback','📝',t('Feedback','意见收集','意見收集')) +
                        tp('wifi','📶',t('WiFi Display','WiFi密码','WiFi密碼')) +
                        tp('blooddrive','🩸',t('Blood Donation','献血活动','獻血活動')) +
                        tp('backpain','🦴',t('Back Pain Tips','背痛贴士','背痛貼士')) +
                        tp('kidsflu','🤒',t("Kids' Flu Season",'儿童流感季','兒童流感季')) +
                        tp('newcomer','🌟',t('New Patient','新病人欢迎','新病人歡迎')) +
                        tp('prenatal','🤰',t('Prenatal Care','产前护理','產前護理')) +
                        tp('weightmgmt','⚖️',t('Weight Management','体重管理','體重管理')) +
                        tp('hearthealthy','💓',t('Heart Health','心脏健康','心臟健康')) +
                        tp('skincheck','☀️',t('Sun Safety','防晒护肤','防曬護膚')) +
                        tp('covidcare','😷',t('Infection Control','感染控制','感染控制')) +
                        tp('staffwanted','📣',t('Staff Vacancy','招聘员工','招聘員工')) +
                        tp('childvax','👶',t('Child Vaccination','儿童疫苗','兒童疫苗')),
                    false)
                );
            })() +

            '<div style="border-top:1px solid #1e293b;margin:2px 0;"></div>' +
            '<div style="font-size:10px;font-weight:900;color:#94a3b8;letter-spacing:1px;">' +
                esc(t('ELEMENTS', '元素', '元素')) + '</div>' +

            (function () {
                // ── SVG thumbnail helpers ──────────────────────────────
                var EB = '#0f172a';   // button background
                var EC = '#94a3b8';  // icon color (default)
                function eb(id, title, svgInner, clr) {
                    return '<button class="pm-el-btn" data-el="' + id + '" title="' + esc(title) + '" ' +
                        'style="width:38px;height:38px;padding:3px;background:' + EB + ';' +
                        'border:1px solid #334155;border-radius:6px;cursor:pointer;color:' + (clr || EC) + ';' +
                        'display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;' +
                        'transition:border-color 0.15s,background 0.15s;" ' +
                        'onmouseover="this.style.borderColor=\'#64748b\';this.style.background=\'#1e293b\';" ' +
                        'onmouseout="this.style.borderColor=\'#334155\';this.style.background=\'' + EB + '\';">' +
                        '<svg width="26" height="26" viewBox="0 0 26 26" fill="currentColor" overflow="visible">' + svgInner + '</svg>' +
                        '</button>';
                }
                function grid(btns) {
                    return '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-bottom:4px;">' + btns + '</div>';
                }
                function cat(label) {
                    return '<div style="font-size:9px;color:#475569;font-weight:700;letter-spacing:0.5px;margin:4px 0 2px;">' + esc(label) + '</div>';
                }
                // Pre-computed polygon SVG point strings (center 13,13)
                var S5  = '13,2 23.5,9.6 19.5,21.9 6.5,21.9 2.5,9.6';
                var S6  = '13,2 22.5,7.5 22.5,18.5 13,24 3.5,18.5 3.5,7.5';
                var S8  = '13,2 20.8,5.2 24,13 20.8,20.8 13,24 5.2,20.8 2,13 5.2,5.2';
                var STAR4 = '13,2 15.8,10.2 24,13 15.8,15.8 13,24 10.2,15.8 2,13 10.2,10.2';
                var STAR5 = '13,2 15.6,9.4 23.5,9.6 17.3,14.4 19.5,21.9 13,17.5 6.5,21.9 8.7,14.4 2.5,9.6 10.4,9.4';
                var STAR6 = '13,2 16,7.8 22.5,7.5 19,13 22.5,18.5 16,18.2 13,24 10,18.2 3.5,18.5 7,13 3.5,7.5 10,7.8';
                var STAR8 = '13,2 14.9,8.1 20.8,5.2 17.6,11.1 24,13 17.6,14.9 20.8,20.8 14.9,17.9 13,24 11.1,17.9 5.2,20.8 8.4,14.9 2,13 8.4,11.1 5.2,5.2 11.1,8.1';
                var BURST = '13,2 14,8.5 18,4 16,10 22,8 17.5,13 23,15 17,15.5 21,20 15.5,18 16,24 13,19.5 10,24 10.5,18 5,20 9,15.5 3,15 8.5,13 4,8 10,10 8,4 12,8.5';
                var ARWR  = '<polygon points="2,10 17,10 17,5 24,13 17,21 17,16 2,16"/>';
                var ARWL  = '<polygon points="24,10 9,10 9,5 2,13 9,21 9,16 24,16"/>';
                var ARWU  = '<polygon points="16,24 16,9 21,9 13,2 5,9 10,9 10,24"/>';
                var ARWD  = '<polygon points="10,2 10,17 5,17 13,24 21,17 16,17 16,2"/>';
                var ARWLR = '<polygon points="2,13 7,7 7,11 19,11 19,7 24,13 19,19 19,15 7,15 7,19"/>';
                var ARWUD = '<polygon points="13,2 19,7 15,7 15,19 19,19 13,24 7,19 11,19 11,7 7,7"/>';
                var NOTCH = '<polygon points="2,8 18,8 24,13 18,18 2,18 6,13"/>';
                var CHEVR = '<polygon points="2,5 16,13 2,21 5,21 19,13 5,5"/>';
                var HEART = '<path d="M13 8 Q13 5 10 5 Q4 5 4 11 Q4 17 13 21 Q22 17 22 11 Q22 5 16 5 Q13 5 13 8Z"/>';
                var BUBBL = '<path d="M3 3 Q3 1 5 1 L21 1 Q23 1 23 3 L23 17 Q23 19 21 19 L15 19 L11 23 L9 19 L5 19 Q3 19 3 17Z" fill="currentColor"/>';
                var CLOUD = '<path d="M7 18 Q3 18 3 14 Q3 10 7 10 Q7 6 11 6 Q12 3 15 3 Q19 3 20 7 Q23 7 23 11 Q23 15 20 15 Q20 18 17 18Z"/>';
                var SHIELD= '<path d="M13 2 L22 6 L22 15 Q22 21 13 25 Q4 21 4 15 L4 6Z"/>';
                var BANNER= '<path d="M2 8 L24 8 L24 18 L13 22 L2 18Z"/>';
                var CROSS = '<polygon points="9,2 17,2 17,9 24,9 24,17 17,17 17,24 9,24 9,17 2,17 2,9 9,9"/>';
                var RING  = '<circle cx="13" cy="13" r="11" fill="none" stroke="currentColor" stroke-width="4"/>';
                var FRAME = '<rect x="1" y="1" width="24" height="24" fill="none" stroke="currentColor" stroke-width="3" rx="2"/>' +
                            '<rect x="5" y="5" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" rx="1"/>';
                var LBAND = '<rect x="2" y="8" width="22" height="10" rx="3"/>';
                var CALLR = '<path d="M2 3 Q2 1 4 1 L22 1 Q24 1 24 3 L24 15 Q24 17 22 17 L14 17 L18 23 L10 17 L4 17 Q2 17 2 15Z"/>';
                var DIAMO = '<polygon points="13,2 24,13 13,24 2,13"/>';
                var PARA  = '<polygon points="7,2 24,2 19,24 2,24"/>';
                var RTRI  = '<polygon points="2,24 24,24 2,2"/>';
                var TRAPZ = '<polygon points="6,2 20,2 24,24 2,24"/>';
                var PENTA = '<polygon points="' + S5 + '"/>';
                var HEXA  = '<polygon points="' + S6 + '"/>';
                var OCTA  = '<polygon points="' + S8 + '"/>';

                return (
                    // ── Text ────────────────────────────────────────────
                    cat(t('TEXT', '文字', '文字')) +
                    grid(
                        eb('txt-h',  t('Heading','标题','標題'),        '<text x="13" y="22" text-anchor="middle" font-size="22" font-weight="900" font-family="Arial">H</text>','#f1f5f9') +
                        eb('txt-s',  t('Subheading','副标题','副標題'), '<text x="13" y="21" text-anchor="middle" font-size="17" font-weight="700" font-family="Arial">Aa</text>','#cbd5e1') +
                        eb('txt-b',  t('Body','正文','正文'),            '<text x="13" y="20" text-anchor="middle" font-size="13" font-family="Arial">Aa</text>','#94a3b8') +
                        eb('txt-c',  t('Caption','说明','說明'),         '<text x="13" y="19" text-anchor="middle" font-size="10" font-style="italic" font-family="Arial">caption</text>','#64748b')
                    ) +

                    // ── Basic Shapes ─────────────────────────────────────
                    cat(t('SHAPES', '形状', '形狀')) +
                    grid(
                        eb('sq',    t('Square','正方形','正方形'),           '<rect x="3" y="3" width="20" height="20"/>','#818cf8') +
                        eb('circ',  t('Circle','圆形','圓形'),               '<circle cx="13" cy="13" r="10"/>','#38bdf8') +
                        eb('tri',   t('Triangle','三角形','三角形'),         '<polygon points="13,2 24,23 2,23"/>','#fbbf24') +
                        eb('diamo', t('Diamond','菱形','菱形'),             DIAMO,'#f472b6') +
                        eb('rrect', t('Rounded Rect','圆角矩形','圓角矩形'), '<rect x="2" y="6" width="22" height="14" rx="5"/>','#a78bfa') +
                        eb('oval',  t('Oval','椭圆','橢圓'),                '<ellipse cx="13" cy="13" rx="11" ry="7"/>','#34d399') +
                        eb('rtri',  t('Right Triangle','直角三角形','直角三角形'), RTRI,'#fb923c') +
                        eb('para',  t('Parallelogram','平行四边形','平行四邊形'), PARA,'#60a5fa')
                    ) +
                    grid(
                        eb('trapz', t('Trapezoid','梯形','梯形'),           TRAPZ,'#f87171') +
                        eb('lband', t('Banner Label','横幅','橫幅'),        LBAND,'#e879f9') +
                        eb('penta', t('Pentagon','五边形','五邊形'),         PENTA,'#4ade80') +
                        eb('hexa',  t('Hexagon','六边形','六邊形'),          HEXA,'#22d3ee') +
                        eb('octa',  t('Octagon','八边形','八邊形'),          OCTA,'#fb923c') +
                        eb('ring',  t('Ring','圆环','圓環'),                 RING,'#a3e635') +
                        eb('frame', t('Frame','边框','邊框'),                FRAME,'#94a3b8') +
                        eb('cross', t('Cross / Plus','十字','十字'),        CROSS,'#f87171')
                    ) +

                    // ── Stars ────────────────────────────────────────────
                    cat(t('STARS', '星形', '星形')) +
                    grid(
                        eb('star4',  t('4-Point Star','四角星','四角星'),    '<polygon points="' + STAR4 + '"/>','#fde68a') +
                        eb('star5',  t('5-Point Star','五角星','五角星'),    '<polygon points="' + STAR5 + '"/>','#fcd34d') +
                        eb('star6',  t('6-Point Star','六角星','六角星'),    '<polygon points="' + STAR6 + '"/>','#fbbf24') +
                        eb('star8',  t('8-Point Star','八角星','八角星'),    '<polygon points="' + STAR8 + '"/>','#f59e0b') +
                        eb('burst',  t('Burst / Badge','爆炸形','爆炸形'),   '<polygon points="' + BURST + '"/>','#ef4444') +
                        eb('shield', t('Shield','盾牌','盾牌'),              SHIELD,'#60a5fa') +
                        eb('banner', t('Banner / Ribbon','旗帜','旗幟'),     BANNER,'#f472b6') +
                        eb('heart',  t('Heart','心形','心形'),               HEART,'#f87171')
                    ) +

                    // ── Arrows ───────────────────────────────────────────
                    cat(t('ARROWS', '箭头', '箭頭')) +
                    grid(
                        eb('arr-r',    t('Right Arrow','右箭头','右箭頭'),   ARWR,'#67e8f9') +
                        eb('arr-l',    t('Left Arrow','左箭头','左箭頭'),    ARWL,'#67e8f9') +
                        eb('arr-u',    t('Up Arrow','上箭头','上箭頭'),      ARWU,'#67e8f9') +
                        eb('arr-d',    t('Down Arrow','下箭头','下箭頭'),    ARWD,'#67e8f9') +
                        eb('arr-lr',   t('Double H Arrow','双向箭头','雙向箭頭'), ARWLR,'#a5f3fc') +
                        eb('arr-ud',   t('Double V Arrow','垂直双向','垂直雙向'), ARWUD,'#a5f3fc') +
                        eb('notch',    t('Notched Arrow','缺口箭头','缺口箭頭'), NOTCH,'#7dd3fc') +
                        eb('chevron',  t('Chevron','人字箭头','人字箭頭'),   CHEVR,'#93c5fd')
                    ) +

                    // ── Lines ────────────────────────────────────────────
                    cat(t('LINES', '线条', '線條')) +
                    grid(
                        eb('line-s',   t('Solid Line','实线','實線'),        '<line x1="2" y1="13" x2="24" y2="13" stroke="currentColor" stroke-width="3" fill="none"/>','#94a3b8') +
                        eb('line-d',   t('Dashed Line','虚线','虛線'),       '<line x1="2" y1="13" x2="24" y2="13" stroke="currentColor" stroke-width="3" stroke-dasharray="5,3" fill="none"/>','#94a3b8') +
                        eb('line-dot', t('Dotted Line','点线','點線'),       '<line x1="2" y1="13" x2="24" y2="13" stroke="currentColor" stroke-width="3" stroke-dasharray="1,4" fill="none"/>','#94a3b8') +
                        eb('line-ar',  t('Arrow Line','箭线','箭線'),        '<line x1="2" y1="13" x2="20" y2="13" stroke="currentColor" stroke-width="2.5" fill="none"/><polygon points="18,9 24,13 18,17"/>','#94a3b8') +
                        eb('line-v',   t('Vertical Line','竖线','豎線'),     '<line x1="13" y1="2" x2="13" y2="24" stroke="currentColor" stroke-width="3" fill="none"/>','#94a3b8') +
                        eb('line-dv',  t('Diagonal Line','斜线','斜線'),     '<line x1="3" y1="3" x2="23" y2="23" stroke="currentColor" stroke-width="3" fill="none"/>','#94a3b8') +
                        eb('line-th',  t('Thick Line','粗线','粗線'),        '<line x1="2" y1="13" x2="24" y2="13" stroke="currentColor" stroke-width="6" stroke-linecap="round" fill="none"/>','#94a3b8') +
                        eb('line-dbl', t('Double Line','双线','雙線'),       '<line x1="2" y1="10" x2="24" y2="10" stroke="currentColor" stroke-width="2" fill="none"/><line x1="2" y1="16" x2="24" y2="16" stroke="currentColor" stroke-width="2" fill="none"/>','#94a3b8')
                    ) +

                    // ── Special ──────────────────────────────────────────
                    cat(t('CALLOUTS', '标注', '標注')) +
                    grid(
                        eb('bubble',  t('Speech Bubble','对话框','對話框'),  BUBBL,'#c4b5fd') +
                        eb('callout', t('Callout','标注框','標注框'),        CALLR,'#a5b4fc') +
                        eb('cloud',   t('Cloud','云形','雲形'),              CLOUD,'#bae6fd') +
                        eb('diamo2',  t('Thought Bubble','思考泡泡','思考泡泡'), '<circle cx="8" cy="20" r="2.5"/><circle cx="12" cy="15" r="3.5"/><ellipse cx="16" cy="9" rx="8" ry="7"/>','#e0f2fe')
                    ) +

                    // ── Image ────────────────────────────────────────────
                    cat(t('IMAGE', '图片', '圖片')) +
                    '<label id="pm-img-label" style="' + sideBtn('display:flex;align-items:center;gap:6px;') + '">🖼 ' +
                        esc(t('Add Image', '添加图片', '新增圖片')) +
                        '<input type="file" id="pm-img-file" accept="image/*" style="display:none;">' +
                    '</label>'
                );
            })() +

            // ── ONLINE LIBRARY ─────────────────────────────────────────
            '<div style="border-top:1px solid #1e293b;margin:2px 0;"></div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;">' +
                '<div style="font-size:10px;font-weight:900;color:#94a3b8;letter-spacing:1px;">' +
                    esc(t('ONLINE LIBRARY','在线素材库','線上素材庫')) + '</div>' +
                '<button id="pm-ol-apikey-btn" title="' + esc(t('Configure API keys','配置API密钥','設定API密鑰')) + '" ' +
                    'style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:12px;padding:2px 4px;" ' +
                    'onmouseover="this.style.color=\'#f1f5f9\';" onmouseout="this.style.color=\'#94a3b8\';">⚙️</button>' +
            '</div>' +

            // API key modal (hidden)
            '<div id="pm-ol-keymodal" style="display:none;background:#1e293b;border:1px solid #334155;' +
                'border-radius:8px;padding:10px;font-size:11px;color:#e2e8f0;max-width:172px;">' +

                '<div style="font-weight:700;margin-bottom:4px;color:#60a5fa;">' +
                    esc(t('API Key Settings','API密钥设置','API密鑰設定')) + '</div>' +

                // Supabase status indicator
                '<div id="pm-ol-key-sb-status" style="font-size:8px;color:#94a3b8;margin-bottom:6px;' +
                    'padding:3px 6px;background:#0f172a;border-radius:4px;line-height:1.4;word-break:break-all;">' +
                    '⏳ ' + esc(t('Checking Supabase…','检查Supabase中…','檢查Supabase中…')) +
                '</div>' +

                '<label style="font-size:9px;color:#94a3b8;display:block;margin-bottom:2px;">Unsplash Access Key</label>' +
                '<div style="display:flex;gap:3px;margin-bottom:5px;">' +
                    '<input id="pm-ol-ukey" type="password" placeholder="unsplash.com/developers" ' +
                        'style="flex:1;font-size:9px;padding:3px 5px;background:#0f172a;border:1px solid #334155;' +
                        'border-radius:4px;color:#f1f5f9;box-sizing:border-box;min-width:0;">' +
                '</div>' +
                '<label style="font-size:9px;color:#94a3b8;display:block;margin-bottom:2px;">Pexels API Key</label>' +
                '<div style="display:flex;gap:3px;margin-bottom:7px;">' +
                    '<input id="pm-ol-pkey" type="password" placeholder="pexels.com/api" ' +
                        'style="flex:1;font-size:9px;padding:3px 5px;background:#0f172a;border:1px solid #334155;' +
                        'border-radius:4px;color:#f1f5f9;box-sizing:border-box;min-width:0;">' +
                '</div>' +

                // Primary: Save to Supabase for all users
                '<button id="pm-ol-key-save-sb" style="width:100%;font-size:9px;padding:5px 8px;margin-bottom:3px;' +
                    'background:#0d9488;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700;">' +
                    '☁️ ' + esc(t('Save to Supabase (all users)','保存到Supabase（所有用户）','儲存到Supabase（所有使用者）')) +
                '</button>' +

                // Secondary: copy SQL snippet
                '<button id="pm-ol-key-copy-sql" style="width:100%;font-size:9px;padding:4px 8px;margin-bottom:7px;' +
                    'background:#1e40af;color:#bfdbfe;border:1px solid #1d4ed8;border-radius:4px;cursor:pointer;">' +
                    '📋 ' + esc(t('Copy Setup SQL (run in Supabase)','复制安装SQL（在Supabase运行）','複製安裝SQL（在Supabase執行）')) +
                '</button>' +

                '<div style="display:flex;gap:4px;justify-content:flex-end;">' +
                    '<button id="pm-ol-key-save" style="font-size:9px;padding:3px 8px;background:#3b82f6;' +
                        'color:#fff;border:none;border-radius:4px;cursor:pointer;">' +
                        '💾 ' + esc(t('This browser only','仅此浏览器','僅此瀏覽器')) + '</button>' +
                    '<button id="pm-ol-key-cancel" style="font-size:9px;padding:3px 8px;background:#334155;' +
                        'color:#e2e8f0;border:none;border-radius:4px;cursor:pointer;">' +
                        esc(t('Cancel','取消','取消')) + '</button>' +
                '</div>' +
            '</div>' +

            // Source tabs
            '<div style="display:flex;gap:3px;">' +
                '<button class="pm-ol-tab" data-oltab="photos" ' +
                    'style="flex:1;font-size:9px;padding:4px 2px;border-radius:5px;cursor:pointer;' +
                    'background:#3b82f6;color:#fff;border:1px solid #3b82f6;font-weight:700;">' +
                    '📷 ' + esc(t('Photos','图片','圖片')) + '</button>' +
                '<button class="pm-ol-tab" data-oltab="icons" ' +
                    'style="flex:1;font-size:9px;padding:4px 2px;border-radius:5px;cursor:pointer;' +
                    'background:#1e293b;color:#94a3b8;border:1px solid #334155;font-weight:700;">' +
                    '🔷 ' + esc(t('Icons','图标','圖標')) + '</button>' +
                '<button class="pm-ol-tab" data-oltab="import" ' +
                    'style="flex:1;font-size:9px;padding:4px 2px;border-radius:5px;cursor:pointer;' +
                    'background:#1e293b;color:#94a3b8;border:1px solid #334155;font-weight:700;">' +
                    '📥 ' + esc(t('Import','导入','匯入')) + '</button>' +
            '</div>' +

            // ── PHOTOS panel ──────────────────────────────────────────
            '<div id="pm-ol-photos" style="display:flex;flex-direction:column;gap:5px;">' +

                // Free-tier badge for Openverse
                '<div style="background:#052e16;border:1px solid #166534;border-radius:5px;padding:4px 6px;' +
                    'font-size:8px;color:#86efac;line-height:1.5;">' +
                    '✅ <strong>' + esc(t('Openverse (default)','Openverse（默认）','Openverse（預設）')) + '</strong> — ' +
                    esc(t('700 M+ CC-licensed images · No API key required',
                          '7亿+CC授权图片 · 无需API密钥',
                          '7億+CC授權圖片 · 無需API密鑰')) +
                '</div>' +

                // Source selector
                '<div style="display:flex;gap:3px;align-items:center;">' +
                    '<span style="font-size:8px;color:#94a3b8;white-space:nowrap;">' +
                        esc(t('Source:','来源:','來源:')) + '</span>' +
                    '<select id="pm-ol-src" style="flex:1;font-size:9px;padding:3px;background:#1e293b;' +
                        'border:1px solid #334155;color:#e2e8f0;border-radius:4px;">' +
                        '<option value="openverse" selected>Openverse ✅ Free</option>' +
                        '<option value="unsplash">Unsplash (API key)</option>' +
                        '<option value="pexels">Pexels (API key)</option>' +
                    '</select>' +
                '</div>' +

                // Quick category pills
                '<div style="font-size:8px;color:#94a3b8;margin-bottom:1px;">' +
                    esc(t('Quick search:','快捷搜索:','快速搜尋:')) + '</div>' +
                '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:2px;">' +
                    ['clinic','doctor','nurse','pharmacy','health','hospital',
                     'vaccine','stethoscope','medicine','wellness',
                     'dental','blood','heart','eye care','elderly'].map(function(kw) {
                        return '<button class="pm-ol-cat-btn" data-q="' + kw + '" ' +
                            'style="font-size:8px;padding:2px 6px;background:#1e293b;color:#94a3b8;' +
                            'border:1px solid #334155;border-radius:10px;cursor:pointer;white-space:nowrap;" ' +
                            'onmouseover="this.style.background=\'#334155\';this.style.color=\'#f1f5f9\';" ' +
                            'onmouseout="this.style.background=\'#1e293b\';this.style.color=\'#94a3b8\';">' +
                            kw + '</button>';
                    }).join('') +
                '</div>' +

                // Search box
                '<div style="display:flex;gap:3px;">' +
                    '<input id="pm-ol-photo-q" type="text" placeholder="' + esc(t('Search photos…','搜索图片…','搜尋圖片…')) + '" ' +
                        'style="flex:1;font-size:9px;padding:4px 6px;background:#1e293b;border:1px solid #334155;' +
                        'color:#f1f5f9;border-radius:4px;box-sizing:border-box;" ' +
                        'onkeydown="if(event.key===\'Enter\'){document.getElementById(\'pm-ol-photo-go\').click();}">' +
                    '<button id="pm-ol-photo-go" style="font-size:10px;padding:3px 7px;background:#3b82f6;' +
                        'color:#fff;border:none;border-radius:4px;cursor:pointer;">🔍</button>' +
                '</div>' +

                // Results grid
                '<div id="pm-ol-photo-res" style="display:grid;grid-template-columns:repeat(2,1fr);gap:3px;' +
                    'max-height:260px;overflow-y:auto;">' +
                    '<div style="grid-column:1/-1;font-size:9px;color:#475569;text-align:center;padding:8px 0;">' +
                        esc(t('Click a category or type a keyword and press 🔍.',
                              '点击类别或输入关键词后点击🔍。',
                              '點擊類別或輸入關鍵字後點擊🔍。')) +
                    '</div>' +
                '</div>' +
                '<div id="pm-ol-photo-credit" style="font-size:8px;color:#475569;text-align:center;display:none;">' +
                    esc(t('Images via Openverse · CC-licensed · Click for attribution',
                          '图片来自Openverse · CC授权 · 点击查看署名',
                          '圖片來自Openverse · CC授權 · 點擊查看署名')) +
                '</div>' +
            '</div>' +

            // ── ICONS panel (hidden by default) ───────────────────────
            '<div id="pm-ol-icons" style="display:none;flex-direction:column;gap:5px;">' +
                '<div style="font-size:8px;color:#22c55e;padding:2px 0;">' +
                    '✅ ' + esc(t('Free · No API key needed','免费·无需API密钥','免費·無需API密鑰')) + '</div>' +
                '<div style="display:flex;gap:3px;">' +
                    '<input id="pm-ol-icon-q" type="text" placeholder="' + esc(t('Search icons…','搜索图标…','搜尋圖標…')) + '" ' +
                        'style="flex:1;font-size:9px;padding:4px 6px;background:#1e293b;border:1px solid #334155;' +
                        'color:#f1f5f9;border-radius:4px;box-sizing:border-box;" ' +
                        'onkeydown="if(event.key===\'Enter\'){document.getElementById(\'pm-ol-icon-go\').click();}">' +
                    '<button id="pm-ol-icon-go" style="font-size:10px;padding:3px 7px;background:#3b82f6;' +
                        'color:#fff;border:none;border-radius:4px;cursor:pointer;">🔍</button>' +
                '</div>' +
                '<div id="pm-ol-icon-res" style="display:grid;grid-template-columns:repeat(4,1fr);gap:3px;' +
                    'max-height:280px;overflow-y:auto;">' +
                    '<div style="grid-column:1/-1;font-size:9px;color:#475569;text-align:center;padding:8px 0;">' +
                        esc(t('Search 200,000+ free icons.','搜索20万+免费图标。','搜尋20萬+免費圖標。')) +
                    '</div>' +
                '</div>' +
                '<div style="font-size:8px;color:#475569;text-align:center;">' +
                    'Icons by <a href="https://iconify.design" target="_blank" style="color:#3b82f6;">Iconify</a>' +
                    ' (CC / MIT / Apache licensed)' +
                '</div>' +
            '</div>' +

            // ── IMPORT panel (hidden by default) ──────────────────────
            '<div id="pm-ol-import" style="display:none;flex-direction:column;gap:6px;">' +
                '<div style="font-size:9px;color:#94a3b8;line-height:1.5;">' +
                    esc(t('Import a poster template from a URL (JSON format):',
                          '从URL导入海报模板（JSON格式）：',
                          '從URL匯入海報模板（JSON格式）：')) + '</div>' +
                '<input id="pm-ol-import-url" type="url" placeholder="https://example.com/template.json" ' +
                    'style="font-size:9px;padding:4px 6px;background:#1e293b;border:1px solid #334155;' +
                    'color:#f1f5f9;border-radius:4px;box-sizing:border-box;width:100%;">' +
                '<button id="pm-ol-import-go" style="font-size:10px;padding:5px;background:#3b82f6;' +
                    'color:#fff;border:none;border-radius:5px;cursor:pointer;width:100%;">' +
                    '📥 ' + esc(t('Load Template','载入模板','載入模板')) + '</button>' +
                '<div style="border-top:1px solid #1e293b;padding-top:5px;">' +
                    '<div style="font-size:9px;color:#94a3b8;margin-bottom:4px;">' +
                        esc(t('Or paste JSON directly:','或直接粘贴JSON：','或直接貼上JSON：')) + '</div>' +
                    '<textarea id="pm-ol-import-json" rows="4" placeholder=\'{"version":"5.3","objects":[...]}\' ' +
                        'style="width:100%;font-size:8px;padding:4px;background:#0f172a;border:1px solid #334155;' +
                        'color:#94a3b8;border-radius:4px;box-sizing:border-box;resize:vertical;"></textarea>' +
                    '<button id="pm-ol-import-json-go" style="margin-top:4px;font-size:10px;padding:5px;' +
                        'background:#0d9488;color:#fff;border:none;border-radius:5px;cursor:pointer;width:100%;">' +
                        '📋 ' + esc(t('Apply JSON','应用JSON','套用JSON')) + '</button>' +
                '</div>' +
                '<div style="font-size:8px;color:#475569;text-align:center;line-height:1.5;">' +
                    esc(t('Note: Canva templates are proprietary and cannot be imported directly. ' +
                          'Use this to import templates shared in Fabric.js JSON format.',
                          '注意：Canva模板具有专有权，无法直接导入。此功能用于导入以Fabric.js JSON格式共享的模板。',
                          '注意：Canva模板具有專有權，無法直接匯入。此功能用於匯入以Fabric.js JSON格式共享的模板。')) +
                '</div>' +
            '</div>' +

        '</div>' +

        // ── Canvas area ───────────────────────────────────────
        '<div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">' +
            '<div id="pm-canvas-area" style="flex:1;display:flex;align-items:flex-start;' +
                'justify-content:center;background:#e2e8f0;padding:20px;overflow:auto;">' +
                '<div id="pm-canvas-wrap" style="box-shadow:0 4px 32px rgba(0,0,0,0.22);' +
                    'background:#fff;flex-shrink:0;position:relative;">' +
                    '<canvas id="pm-canvas"></canvas>' +
                    '<canvas id="pm-grid-canvas" style="position:absolute;top:0;left:0;' +
                        'pointer-events:none;display:none;"></canvas>' +
                '</div>' +
            '</div>' +

            // ── Page strip ────────────────────────────────────────
            '<div id="pm-page-strip" style="display:flex;align-items:center;gap:8px;' +
                'padding:8px 14px;background:#1e293b;border-top:1px solid #334155;' +
                'overflow-x:auto;min-height:64px;">' +
                '<div id="pm-page-thumbs" style="display:flex;gap:6px;align-items:center;"></div>' +
                '<button id="pm-add-page" style="' +
                    'padding:6px 12px;background:#334155;color:#94a3b8;' +
                    'border:1px dashed #475569;border-radius:6px;cursor:pointer;' +
                    'font-size:12px;font-weight:700;white-space:nowrap;flex-shrink:0;">' +
                    '+ ' + esc(t('Page','页面','頁面')) +
                '</button>' +
            '</div>' +
        '</div>' +

        // ── Right properties panel ────────────────────────────
        '<div id="pm-props" style="width:220px;min-width:220px;background:#fff;' +
            'border-left:1px solid #e5e7eb;padding:12px 10px;overflow-y:auto;display:none;">' +

            // ── TEXT PROPERTIES ───────────────────────────────────
            '<div id="pm-text-props">' +

                // ── Section header ──────────────────────────────────
                '<div style="font-size:10px;font-weight:900;color:#94a3b8;letter-spacing:1px;margin-bottom:8px;">' +
                    esc(t('TEXT','文字','文字')) + '</div>' +

                // ── Custom font picker ──────────────────────────────
                '<label style="font-size:10px;color:#64748b;display:block;margin-bottom:3px;">' + esc(t('Font','字体','字體')) + '</label>' +
                '<div id="pm-font-wrap" style="position:relative;margin-bottom:7px;">' +
                    '<div id="pm-font-trigger" style="display:flex;justify-content:space-between;' +
                        'align-items:center;padding:5px 8px;border:1px solid #e5e7eb;border-radius:6px;' +
                        'cursor:pointer;background:#fff;user-select:none;" ' +
                        'onmouseover="this.style.borderColor=\'#94a3b8\';" ' +
                        'onmouseout="this.style.borderColor=\'#e5e7eb\';">' +
                        '<span id="pm-font-display-name" style="font-family:Arial,sans-serif;font-size:13px;' +
                            'color:#1a1a1a;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Arial</span>' +
                        '<span style="color:#94a3b8;font-size:9px;margin-left:4px;flex-shrink:0;">▾</span>' +
                    '</div>' +
                    '<div id="pm-font-dropdown" style="display:none;position:absolute;z-index:9999;' +
                        'background:#fff;border:1px solid #e5e7eb;border-radius:8px;width:100%;' +
                        'box-shadow:0 8px 28px rgba(0,0,0,0.15);top:calc(100% + 3px);left:0;overflow:hidden;">' +
                        '<div style="padding:6px 6px 4px;">' +
                            '<input type="text" id="pm-font-search" placeholder="' + esc(t('Search fonts…','搜索字体…','搜索字體…')) + '" ' +
                                'style="width:100%;padding:5px 8px;border:1px solid #e5e7eb;border-radius:5px;' +
                                'font-size:11px;box-sizing:border-box;outline:none;">' +
                        '</div>' +
                        '<div id="pm-font-list" style="max-height:200px;overflow-y:auto;">' + fontListHtml + '</div>' +
                    '</div>' +
                '</div>' +

                // ── Font weight pills + size row ─────────────────────
                '<div style="display:grid;grid-template-columns:1fr 80px;gap:6px;margin-bottom:7px;align-items:end;">' +
                    '<div>' +
                        '<label style="font-size:10px;color:#64748b;display:block;margin-bottom:3px;">' + esc(t('Weight','字重','字重')) + '</label>' +
                        '<div id="pm-weight-row" style="display:flex;flex-wrap:wrap;gap:2px;">' +
                        [['300','Light'],['400','Reg'],['500','Med'],['600','Semi'],['700','Bold'],['900','Black']].map(function(w){
                            return '<button class="pm-wt-btn" data-wt="' + w[0] + '" title="' + w[1] + '" ' +
                                'style="flex:1;padding:3px 2px;font-size:9px;font-weight:' + w[0] + ';' +
                                'border:1px solid #e5e7eb;border-radius:4px;background:#f8fafc;cursor:pointer;' +
                                'min-width:28px;color:#374151;">' + w[1] + '</button>';
                        }).join('') +
                        '</div>' +
                    '</div>' +
                    '<div>' +
                        '<label style="font-size:10px;color:#64748b;display:block;margin-bottom:3px;">' + esc(t('Size','字号','字號')) + '</label>' +
                        '<input type="number" id="pm-fontsize" value="30" min="6" max="400" ' +
                            'style="width:100%;padding:4px 5px;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;box-sizing:border-box;">' +
                    '</div>' +
                '</div>' +

                // Quick size presets
                '<div style="display:flex;flex-wrap:wrap;gap:2px;margin-bottom:7px;">' +
                [12,16,20,24,30,36,48,60,72,96].map(function(s){
                    return '<button class="pm-sz-btn" data-sz="' + s + '" ' +
                        'style="padding:2px 5px;font-size:9px;border:1px solid #e5e7eb;border-radius:4px;' +
                        'background:#f8fafc;cursor:pointer;color:#374151;">' + s + '</button>';
                }).join('') +
                '</div>' +

                // ── Colours row ──────────────────────────────────────
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:7px;">' +
                    '<div>' +
                        '<label style="font-size:10px;color:#64748b;display:block;margin-bottom:2px;">' + esc(t('Text Color','文字颜色','文字顏色')) + '</label>' +
                        '<input type="color" id="pm-fontcolor" value="#1a1a1a" ' +
                            'style="width:100%;height:28px;border-radius:6px;border:1px solid #e5e7eb;cursor:pointer;box-sizing:border-box;">' +
                    '</div>' +
                    '<div>' +
                        '<label style="font-size:10px;color:#64748b;display:block;margin-bottom:2px;">' + esc(t('Highlight','高亮','高亮')) + '</label>' +
                        '<div style="display:flex;gap:3px;align-items:center;">' +
                            '<input type="color" id="pm-txt-bgcolor" value="#ffff00" ' +
                                'style="flex:1;height:28px;border-radius:6px;border:1px solid #e5e7eb;cursor:pointer;box-sizing:border-box;">' +
                            '<button id="pm-txt-bgcolor-clear" title="Remove highlight" ' +
                                'style="width:24px;height:28px;border:1px solid #e5e7eb;border-radius:5px;' +
                                'background:#f8fafc;cursor:pointer;font-size:10px;padding:0;color:#64748b;">✕</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +

                // ── Style buttons row 1: B I U S ──────────────────────
                '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:5px;">' +
                    '<button id="pm-bold"      title="Bold"          style="' + fmtBtn() + '"><b>B</b></button>' +
                    '<button id="pm-italic"    title="Italic"        style="' + fmtBtn() + '"><i>I</i></button>' +
                    '<button id="pm-underline" title="Underline"     style="' + fmtBtn() + '"><u>U</u></button>' +
                    '<button id="pm-strike"    title="Strikethrough" style="' + fmtBtn() + '"><s>S</s></button>' +
                    '<button id="pm-supsub-sup" title="Superscript" style="' + fmtBtn() + '">X<sup style="font-size:7px;">2</sup></button>' +
                    '<button id="pm-supsub-sub" title="Subscript"   style="' + fmtBtn() + '">X<sub style="font-size:7px;">2</sub></button>' +
                    '<button id="pm-caps"      title="Toggle CAPS"   style="' + fmtBtn() + '">AA</button>' +
                '</div>' +

                // ── Style buttons row 2: text case + alignment ────────
                '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:2px;margin-bottom:7px;">' +
                    // Alignment with SVG icons
                    '<button id="pm-align-l" title="Align Left" style="' + fmtBtn() + '">' +
                        '<svg width="14" height="12" viewBox="0 0 14 12"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="0" y="5" width="10" height="2" rx="1"/><rect x="0" y="10" width="12" height="2" rx="1"/></svg>' +
                    '</button>' +
                    '<button id="pm-align-c" title="Align Centre" style="' + fmtBtn() + '">' +
                        '<svg width="14" height="12" viewBox="0 0 14 12"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="2" y="5" width="10" height="2" rx="1"/><rect x="1" y="10" width="12" height="2" rx="1"/></svg>' +
                    '</button>' +
                    '<button id="pm-align-r" title="Align Right" style="' + fmtBtn() + '">' +
                        '<svg width="14" height="12" viewBox="0 0 14 12"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="4" y="5" width="10" height="2" rx="1"/><rect x="2" y="10" width="12" height="2" rx="1"/></svg>' +
                    '</button>' +
                    '<button id="pm-align-j" title="Justify" style="' + fmtBtn() + '">' +
                        '<svg width="14" height="12" viewBox="0 0 14 12"><rect x="0" y="0" width="14" height="2" rx="1"/><rect x="0" y="5" width="14" height="2" rx="1"/><rect x="0" y="10" width="14" height="2" rx="1"/></svg>' +
                    '</button>' +
                '</div>' +

                // ── Text Outline (stroke) ─────────────────────────────
                '<details style="margin-bottom:6px;">' +
                    '<summary style="font-size:10px;font-weight:700;color:#64748b;cursor:pointer;' +
                        'list-style:none;display:flex;align-items:center;gap:4px;padding:3px 0;' +
                        'user-select:none;">▶ ' + esc(t('Text Outline','文字描边','文字描邊')) + '</summary>' +
                    '<div style="padding:6px 0 2px;">' +
                        '<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;">' +
                            '<input type="color" id="pm-txt-stroke-color" value="#000000" ' +
                                'style="width:32px;height:26px;border-radius:4px;border:1px solid #e5e7eb;cursor:pointer;">' +
                            '<label style="font-size:10px;color:#64748b;flex:1;">' + esc(t('Width','宽度','寬度')) + '</label>' +
                            '<span id="pm-txt-strokew-val" style="font-size:10px;color:#374151;min-width:20px;">0</span>' +
                        '</div>' +
                        '<input type="range" id="pm-txt-strokew" min="0" max="20" value="0" style="width:100%;">' +
                    '</div>' +
                '</details>' +

                // ── Letter Spacing ────────────────────────────────────
                '<label style="font-size:10px;color:#64748b;display:flex;justify-content:space-between;margin-bottom:2px;">' +
                    esc(t('Letter Spacing','字距','字距')) +
                    '<span id="pm-ls-val" style="color:#374151;">0</span>' +
                '</label>' +
                '<input type="range" id="pm-letterspacing" min="-20" max="200" value="0" step="1" style="width:100%;margin-bottom:7px;">' +

                // ── Line Height ───────────────────────────────────────
                '<label style="font-size:10px;color:#64748b;display:flex;justify-content:space-between;margin-bottom:2px;">' +
                    esc(t('Line Height','行高','行高')) +
                    '<span id="pm-lh-val" style="color:#374151;">1.2</span>' +
                '</label>' +
                '<input type="range" id="pm-lineheight" min="0.5" max="5" value="1.2" step="0.05" style="width:100%;margin-bottom:7px;">' +

                // ── Opacity ───────────────────────────────────────────
                '<label style="font-size:10px;color:#64748b;display:flex;justify-content:space-between;margin-bottom:2px;">' +
                    esc(t('Opacity','不透明度','不透明度')) +
                    '<span id="pm-txt-opval" style="color:#374151;">100%</span>' +
                '</label>' +
                '<input type="range" id="pm-txt-opacity" min="0" max="100" value="100" style="width:100%;margin-bottom:7px;">' +

                // ── Text Shadow ───────────────────────────────────────
                '<details style="margin-bottom:4px;">' +
                    '<summary style="font-size:10px;font-weight:700;color:#64748b;cursor:pointer;' +
                        'list-style:none;display:flex;align-items:center;gap:4px;padding:3px 0;' +
                        'user-select:none;">▶ ' + esc(t('Text Shadow','文字阴影','文字陰影')) + '</summary>' +
                    '<div style="padding:5px 0 2px;">' +
                        '<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px;">' +
                            '<input type="color" id="pm-txt-shadow-color" value="#000000" ' +
                                'style="width:32px;height:26px;border-radius:4px;border:1px solid #e5e7eb;cursor:pointer;">' +
                            '<input type="checkbox" id="pm-txt-shadow" style="margin-left:2px;">' +
                            '<label for="pm-txt-shadow" style="font-size:10px;color:#64748b;cursor:pointer;">' + esc(t('Enable','启用','啟用')) + '</label>' +
                        '</div>' +
                        '<div id="pm-txt-shadow-row" style="display:none;gap:4px;flex-wrap:wrap;">' +
                            '<div style="display:flex;align-items:center;gap:3px;">' +
                                '<label style="font-size:9px;color:#94a3b8;">Blur</label>' +
                                '<input type="number" id="pm-txt-shadow-blur" value="4" min="0" max="40" ' +
                                    'style="width:38px;padding:2px 4px;border:1px solid #e5e7eb;border-radius:4px;font-size:10px;">' +
                            '</div>' +
                            '<div style="display:flex;align-items:center;gap:3px;">' +
                                '<label style="font-size:9px;color:#94a3b8;">X</label>' +
                                '<input type="number" id="pm-txt-shadow-x" value="2" min="-20" max="20" ' +
                                    'style="width:38px;padding:2px 4px;border:1px solid #e5e7eb;border-radius:4px;font-size:10px;">' +
                            '</div>' +
                            '<div style="display:flex;align-items:center;gap:3px;">' +
                                '<label style="font-size:9px;color:#94a3b8;">Y</label>' +
                                '<input type="number" id="pm-txt-shadow-y" value="2" min="-20" max="20" ' +
                                    'style="width:38px;padding:2px 4px;border:1px solid #e5e7eb;border-radius:4px;font-size:10px;">' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                '</details>' +

            '</div>' +

            '<div style="border-top:1px solid #f1f5f9;margin:6px 0;"></div>' +

            // ── SHAPE / LINE PROPERTIES ───────────────────────────
            '<div id="pm-shape-props">' +
                '<div style="font-size:10px;font-weight:900;color:#94a3b8;letter-spacing:1px;' +
                    'margin-bottom:6px;">' + esc(t('SHAPE', '形状', '形狀')) + '</div>' +

                // Fill + Stroke color
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:6px;">' +
                    '<div>' +
                        '<label style="font-size:10px;color:#64748b;display:block;margin-bottom:2px;">' + esc(t('Fill','填充色','填充色')) + '</label>' +
                        '<input type="color" id="pm-fill" value="#4f46e5" ' +
                            'style="width:100%;height:30px;border-radius:6px;border:1px solid #e5e7eb;cursor:pointer;box-sizing:border-box;">' +
                    '</div>' +
                    '<div>' +
                        '<label style="font-size:10px;color:#64748b;display:block;margin-bottom:2px;">' + esc(t('Border','边框色','邊框色')) + '</label>' +
                        '<input type="color" id="pm-stroke" value="#000000" ' +
                            'style="width:100%;height:30px;border-radius:6px;border:1px solid #e5e7eb;cursor:pointer;box-sizing:border-box;">' +
                    '</div>' +
                '</div>' +

                // Border width + Border dash
                '<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:6px;">' +
                    '<div>' +
                        '<label style="font-size:10px;color:#64748b;display:block;margin-bottom:2px;">' + esc(t('Border W','边框宽','邊框寬')) + '</label>' +
                        '<input type="range" id="pm-strokew" value="0" min="0" max="30" ' +
                            'style="width:100%;">' +
                    '</div>' +
                    '<div>' +
                        '<label style="font-size:10px;color:#64748b;display:block;margin-bottom:2px;">' + esc(t('Dash','虚线','虛線')) + '</label>' +
                        '<select id="pm-strokedash" style="width:100%;padding:3px 4px;border:1px solid #e5e7eb;border-radius:6px;font-size:11px;box-sizing:border-box;">' +
                            '<option value="solid">' + esc(t('Solid','实线','實線')) + '</option>' +
                            '<option value="dash">' + esc(t('Dashed','虚线','虛線')) + '</option>' +
                            '<option value="dot">' + esc(t('Dotted','点线','點線')) + '</option>' +
                        '</select>' +
                    '</div>' +
                '</div>' +

                // Corner radius (for rect)
                '<div id="pm-corner-row" style="display:none;margin-bottom:6px;">' +
                    '<label style="font-size:10px;color:#64748b;display:block;margin-bottom:2px;">' + esc(t('Corner Radius','圆角','圓角')) + '</label>' +
                    '<input type="range" id="pm-corner" value="0" min="0" max="100" style="width:100%;">' +
                '</div>' +

                // Opacity
                '<label style="font-size:10px;color:#64748b;display:block;margin-bottom:2px;">' +
                    esc(t('Opacity','不透明度','不透明度')) + ' <span id="pm-opacity-val">100</span>%</label>' +
                '<input type="range" id="pm-opacity" value="100" min="0" max="100" style="width:100%;margin-bottom:6px;">' +

                // Shadow
                '<div style="border-top:1px solid #f1f5f9;padding-top:6px;margin-bottom:4px;">' +
                    '<label style="font-size:10px;color:#64748b;display:flex;align-items:center;gap:6px;cursor:pointer;">' +
                        '<input type="checkbox" id="pm-shape-shadow"> ' + esc(t('Drop Shadow','投影','投影')) +
                    '</label>' +
                '</div>' +
                '<div id="pm-shape-shadow-row" style="display:none;gap:4px;flex-wrap:wrap;margin-bottom:6px;">' +
                    '<input type="color" id="pm-shd-color" value="#000000" title="Shadow Color" ' +
                        'style="width:36px;height:26px;border-radius:4px;border:1px solid #e5e7eb;cursor:pointer;">' +
                    '<input type="number" id="pm-shd-blur" value="8" min="0" max="60" placeholder="Blur" ' +
                        'style="width:44px;padding:3px 4px;border:1px solid #e5e7eb;border-radius:5px;font-size:11px;" title="Blur">' +
                    '<input type="number" id="pm-shd-x" value="4" min="-40" max="40" placeholder="X" ' +
                        'style="width:38px;padding:3px 4px;border:1px solid #e5e7eb;border-radius:5px;font-size:11px;" title="Offset X">' +
                    '<input type="number" id="pm-shd-y" value="4" min="-40" max="40" placeholder="Y" ' +
                        'style="width:38px;padding:3px 4px;border:1px solid #e5e7eb;border-radius:5px;font-size:11px;" title="Offset Y">' +
                '</div>' +
            '</div>' +
        '</div>' + // end props

        '</div>' + // end main row
        '</div>';  // end shell

        initCanvas(fabric);
        wireControls(fabric);
    }

    // ── Canvas initialisation ────────────────────────────────────
    function initCanvas(fabric) {
        var sz = SIZES[_size];
        var area = g('pm-canvas-area');
        var areaW = area ? (area.clientWidth - 40) : 520;
        var maxW = Math.max(300, Math.min(areaW, 660));
        var scale = Math.min(1, maxW / sz.w);
        var dispW = Math.round(sz.w * scale);
        var dispH = Math.round(sz.h * scale);

        var wrap = g('pm-canvas-wrap');
        if (wrap) { wrap.style.width = dispW + 'px'; wrap.style.height = dispH + 'px'; }

        // Fabric replaces the <canvas> element; make sure it exists fresh
        var el = g('pm-canvas');
        if (!el) return;

        _canvas = new fabric.Canvas('pm-canvas', {
            width:  dispW,
            height: dispH,
            backgroundColor: '#ffffff',
            selection: true,
            preserveObjectStacking: true
        });
        _canvas._pmLogicalW = sz.w;
        _canvas._pmLogicalH = sz.h;
        _canvas._pmScale    = scale;

        _history = []; _histPos = -1;
        snapshotHistory();

        _canvas.on('object:modified', snapshotHistory);
    }

    // ── History (undo / redo) ────────────────────────────────────
    function snapshotHistory() {
        if (!_canvas || _pauseHistory) return;
        var json = JSON.stringify(_canvas.toJSON());
        _history = _history.slice(0, _histPos + 1);
        _history.push(json);
        if (_history.length > 60) { _history.shift(); }
        _histPos = _history.length - 1;
    }
    function undo() {
        if (!_canvas || _histPos <= 0) return;
        _histPos--;
        restoreHistory();
    }
    function redo() {
        if (!_canvas || _histPos >= _history.length - 1) return;
        _histPos++;
        restoreHistory();
    }
    function restoreHistory() {
        var json = _history[_histPos];
        if (!json || !_canvas) return;
        _pauseHistory = true;
        _canvas.loadFromJSON(JSON.parse(json), function () {
            _canvas.renderAll();
            _pauseHistory = false;
        });
    }

    // ── Control wiring ────────────────────────────────────────────
    function wireControls(fabric) {
        // Size picker
        var sizeEl = g('pm-size');
        if (sizeEl) sizeEl.addEventListener('change', function () {
            _size = sizeEl.value;
            if (_canvas) { try { _canvas.dispose(); } catch (e) {} _canvas = null; }
            // Re-inject fresh canvas element then re-init
            var wrap = g('pm-canvas-wrap');
            if (wrap) {
                wrap.innerHTML = '<canvas id="pm-canvas"></canvas>';
            }
            initCanvas(fabric);
        });

        // Background colour
        var bgEl = g('pm-bg');
        if (bgEl) bgEl.addEventListener('input', function () {
            if (_canvas) _canvas.setBackgroundColor(bgEl.value, function () { _canvas.renderAll(); });
        });

        // Templates
        var tplBtns = document.querySelectorAll('#pm-shell .pm-tpl');
        tplBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                applyTemplate(fabric, btn.getAttribute('data-tpl'));
            });
        });

        // ── Draw tool buttons ─────────────────────────────────────────
        document.querySelectorAll('#pm-sidebar .pm-draw-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _drawTool = btn.getAttribute('data-dtool');
                setDrawTool(_drawTool, fabric);
                // Update active highlight on buttons
                document.querySelectorAll('#pm-sidebar .pm-draw-btn').forEach(function (b) {
                    var on = b === btn;
                    b.style.background   = on ? '#3b82f6' : '#1e293b';
                    b.style.borderColor  = on ? '#60a5fa' : '#334155';
                });
            });
        });

        // Brush colour
        var drawColorEl = g('pm-draw-color');
        if (drawColorEl) drawColorEl.addEventListener('input', function () {
            _drawColor = drawColorEl.value;
            if (_canvas && _canvas.freeDrawingBrush) _canvas.freeDrawingBrush.color = _drawColor;
        });

        // Brush size
        var drawSizeEl    = g('pm-draw-size');
        var drawSizeValEl = g('pm-draw-size-val');
        if (drawSizeEl) drawSizeEl.addEventListener('input', function () {
            _drawSize = parseInt(drawSizeEl.value, 10);
            if (drawSizeValEl) drawSizeValEl.textContent = _drawSize + 'px';
            if (_canvas && _canvas.freeDrawingBrush) _canvas.freeDrawingBrush.width = _drawSize;
        });

        // Brush opacity
        var drawOpEl    = g('pm-draw-opacity');
        var drawOpValEl = g('pm-draw-op-val');
        if (drawOpEl) drawOpEl.addEventListener('input', function () {
            _drawOpacity = parseInt(drawOpEl.value, 10) / 100;
            if (drawOpValEl) drawOpValEl.textContent = Math.round(_drawOpacity * 100) + '%';
            if (_canvas && _canvas.freeDrawingBrush) {
                var col = hexToRgba(_drawColor, _drawOpacity);
                _canvas.freeDrawingBrush.color = col;
            }
        });

        // ── Element buttons (delegated) ───────────────────────────────
        document.querySelectorAll('#pm-sidebar .pm-el-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                // Adding an element exits draw mode
                if (_drawTool !== 'select') {
                    _drawTool = 'select';
                    setDrawTool('select', fabric);
                    document.querySelectorAll('#pm-sidebar .pm-draw-btn').forEach(function (b) {
                        var on = b.getAttribute('data-dtool') === 'select';
                        b.style.background  = on ? '#3b82f6' : '#1e293b';
                        b.style.borderColor = on ? '#60a5fa' : '#334155';
                    });
                }
                addElement(fabric, btn.getAttribute('data-el'));
            });
        });

        // Image upload
        var imgFile = g('pm-img-file');
        if (imgFile) imgFile.addEventListener('change', function () {
            if (!imgFile.files || !imgFile.files[0] || !_canvas) return;
            var reader = new FileReader();
            reader.onload = function (e) {
                fabric.Image.fromURL(e.target.result, function (img) {
                    var maxSide = sf(220);
                    if (img.width > maxSide || img.height > maxSide) {
                        img.scale(Math.min(maxSide / img.width, maxSide / img.height));
                    }
                    img.set({ left: sf(50), top: sf(50) });
                    _canvas.add(img);
                    _canvas.setActiveObject(img);
                    _canvas.renderAll();
                    snapshotHistory();
                });
            };
            reader.readAsDataURL(imgFile.files[0]);
            imgFile.value = '';
        });

        // ── Custom font picker ──────────────────────────────────────
        var fontTrigger     = g('pm-font-trigger');
        var fontDropdown    = g('pm-font-dropdown');
        var fontSearch      = g('pm-font-search');
        var fontListEl      = g('pm-font-list');
        var fontDisplayName = g('pm-font-display-name');

        function applyFont(name, isSystem) {
            if (!isSystem) loadGoogleFont(name);
            setTxtProp('fontFamily', name);
            if (fontDisplayName) {
                fontDisplayName.textContent = name;
                fontDisplayName.style.fontFamily = "'" + name + "', sans-serif";
            }
            if (fontDropdown) fontDropdown.style.display = 'none';
        }

        if (fontTrigger) fontTrigger.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!fontDropdown) return;
            var isOpen = fontDropdown.style.display !== 'none';
            fontDropdown.style.display = isOpen ? 'none' : 'block';
            if (!isOpen && fontSearch) { fontSearch.value = ''; filterFonts(''); setTimeout(function () { fontSearch.focus(); }, 50); }
        });

        if (fontSearch) fontSearch.addEventListener('input', function () { filterFonts(fontSearch.value.toLowerCase()); });

        if (fontListEl) fontListEl.addEventListener('click', function (e) {
            var opt = e.target.closest('.pm-font-opt');
            if (!opt) return;
            applyFont(opt.getAttribute('data-font'), !!opt.getAttribute('data-sys'));
            snapshotHistory();
        });

        // Preload Google Font on hover so it's ready when clicked
        if (fontListEl) fontListEl.addEventListener('mouseover', function (e) {
            var opt = e.target.closest('.pm-font-opt');
            if (opt && !opt.getAttribute('data-sys')) loadGoogleFont(opt.getAttribute('data-font'));
        });

        document.addEventListener('click', function (e) {
            if (!fontDropdown) return;
            var wrap = g('pm-font-wrap');
            if (wrap && !wrap.contains(e.target)) fontDropdown.style.display = 'none';
        });

        function filterFonts(q) {
            if (!fontListEl) return;
            fontListEl.querySelectorAll('.pm-font-opt').forEach(function (opt) {
                opt.style.display = (!q || opt.getAttribute('data-font').toLowerCase().includes(q)) ? '' : 'none';
            });
            fontListEl.querySelectorAll('.pm-font-group-hdr').forEach(function (hdr) {
                var sib = hdr.nextElementSibling, allHidden = true;
                while (sib && !sib.classList.contains('pm-font-group-hdr')) {
                    if (sib.style.display !== 'none') { allHidden = false; break; }
                    sib = sib.nextElementSibling;
                }
                hdr.style.display = allHidden ? 'none' : '';
            });
        }

        // ── Text property controls ──────────────────────────────────
        var fontsizeEl    = g('pm-fontsize');
        var fontcolorEl   = g('pm-fontcolor');
        var txtBgColorEl  = g('pm-txt-bgcolor');
        var txtBgClearBtn = g('pm-txt-bgcolor-clear');
        var letterSpEl    = g('pm-letterspacing');
        var lsValEl       = g('pm-ls-val');
        var lineHEl       = g('pm-lineheight');
        var lhValEl       = g('pm-lh-val');
        var txtOpEl       = g('pm-txt-opacity');
        var txtOpValEl    = g('pm-txt-opval');

        if (fontsizeEl)  fontsizeEl.addEventListener('input',  function () { setTxtProp('fontSize', parseInt(fontsizeEl.value, 10) || 12); });
        if (fontsizeEl)  fontsizeEl.addEventListener('change', function () { setTxtProp('fontSize', parseInt(fontsizeEl.value, 10) || 12); snapshotHistory(); });
        if (fontcolorEl) fontcolorEl.addEventListener('input', function () { setTxtProp('fill', fontcolorEl.value); });

        // Highlight / text background
        if (txtBgColorEl) txtBgColorEl.addEventListener('input', function () {
            setTxtProp('textBackgroundColor', txtBgColorEl.value);
        });
        if (txtBgClearBtn) txtBgClearBtn.addEventListener('click', function () {
            setTxtProp('textBackgroundColor', '');
        });

        // Font weight pills
        document.querySelectorAll('#pm-weight-row .pm-wt-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var wt = btn.getAttribute('data-wt');
                setTxtProp('fontWeight', wt);
                document.querySelectorAll('#pm-weight-row .pm-wt-btn').forEach(function (b) {
                    var on = b === btn;
                    b.style.background   = on ? '#0f172a' : '#f8fafc';
                    b.style.color        = on ? '#fff'    : '#374151';
                    b.style.borderColor  = on ? '#0f172a' : '#e5e7eb';
                });
            });
        });

        // Quick size presets
        document.querySelectorAll('.pm-sz-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var sz = parseInt(btn.getAttribute('data-sz'), 10);
                if (fontsizeEl) fontsizeEl.value = sz;
                setTxtProp('fontSize', sz); snapshotHistory();
            });
        });

        // Style toggles
        var boldBtn       = g('pm-bold');
        var italicBtn     = g('pm-italic');
        var underlineBtn  = g('pm-underline');
        var strikeBtn     = g('pm-strike');
        var capsBtn       = g('pm-caps');
        var supBtn        = g('pm-supsub-sup');
        var subBtn        = g('pm-supsub-sub');

        if (boldBtn)     boldBtn.addEventListener('click',     function () { toggleTxtStyle('fontWeight', 'bold', 'normal'); refreshStyleBtns(); });
        if (italicBtn)   italicBtn.addEventListener('click',   function () { toggleTxtStyle('fontStyle', 'italic', 'normal'); refreshStyleBtns(); });
        if (underlineBtn) underlineBtn.addEventListener('click', function () {
            var o = activeObj(); if (!o) return;
            o.set('underline', !o.underline); _canvas.renderAll(); refreshStyleBtns();
        });
        if (strikeBtn) strikeBtn.addEventListener('click', function () {
            var o = activeObj(); if (!o) return;
            o.set('linethrough', !o.linethrough); _canvas.renderAll(); refreshStyleBtns();
        });
        if (capsBtn) capsBtn.addEventListener('click', function () {
            var o = activeObj(); if (!o || (o.type !== 'i-text' && o.type !== 'text')) return;
            var cur = o.text || '';
            o.set('text', cur === cur.toUpperCase() ? cur.toLowerCase() : cur.toUpperCase());
            _canvas.renderAll(); snapshotHistory();
        });
        // Superscript / Subscript (scale + baseline shift)
        if (supBtn) supBtn.addEventListener('click', function () {
            var o = activeObj(); if (!o || (o.type !== 'i-text' && o.type !== 'text')) return;
            if (o._pmScript === 'sup') {
                o.set({ fontSize: o._pmOrigFs || o.fontSize, deltaY: 0 }); delete o._pmScript; delete o._pmOrigFs;
            } else {
                o._pmOrigFs = o.fontSize;
                o.set({ fontSize: Math.max(8, Math.round(o.fontSize * 0.65)), deltaY: -(o._pmOrigFs * 0.35) });
                o._pmScript = 'sup';
                if (o._pmScript === 'sub') { delete o._pmScript; }
            }
            _canvas.renderAll(); snapshotHistory();
        });
        if (subBtn) subBtn.addEventListener('click', function () {
            var o = activeObj(); if (!o || (o.type !== 'i-text' && o.type !== 'text')) return;
            if (o._pmScript === 'sub') {
                o.set({ fontSize: o._pmOrigFs || o.fontSize, deltaY: 0 }); delete o._pmScript; delete o._pmOrigFs;
            } else {
                o._pmOrigFs = o.fontSize;
                o.set({ fontSize: Math.max(8, Math.round(o.fontSize * 0.65)), deltaY: o._pmOrigFs * 0.2 });
                o._pmScript = 'sub';
            }
            _canvas.renderAll(); snapshotHistory();
        });

        function refreshStyleBtns() {
            var o = activeObj(); if (!o) return;
            function mark(id, on) {
                var b = g(id); if (!b) return;
                b.style.background  = on ? '#0f172a' : '';
                b.style.color       = on ? '#fff'    : '';
                b.style.borderColor = on ? '#0f172a' : '';
            }
            mark('pm-bold',      o.fontWeight === 'bold' || o.fontWeight >= 700);
            mark('pm-italic',    o.fontStyle  === 'italic');
            mark('pm-underline', !!o.underline);
            mark('pm-strike',    !!o.linethrough);
        }

        // Alignment
        ['l','c','r','j'].forEach(function (a) {
            var btn = g('pm-align-' + a);
            if (btn) btn.addEventListener('click', function () {
                setTxtProp('textAlign', {l:'left',c:'center',r:'right',j:'justify'}[a]);
            });
        });

        // Text outline (stroke)
        var txtStrokeColorEl = g('pm-txt-stroke-color');
        var txtStrokewEl     = g('pm-txt-strokew');
        var txtStrokewValEl  = g('pm-txt-strokew-val');
        function applyTxtStroke() {
            var o = activeObj(); if (!o || (o.type !== 'i-text' && o.type !== 'text')) return;
            var w = txtStrokewEl ? parseInt(txtStrokewEl.value, 10) : 0;
            o.set({
                stroke: (txtStrokeColorEl ? txtStrokeColorEl.value : '#000'),
                strokeWidth: w,
                paintFirst: w > 0 ? 'stroke' : 'fill'
            });
            _canvas.renderAll();
            if (txtStrokewValEl) txtStrokewValEl.textContent = w;
        }
        if (txtStrokeColorEl) txtStrokeColorEl.addEventListener('input', applyTxtStroke);
        if (txtStrokewEl) txtStrokewEl.addEventListener('input', function () { applyTxtStroke(); });

        // Letter spacing (slider)
        if (letterSpEl) letterSpEl.addEventListener('input', function () {
            var v = parseFloat(letterSpEl.value);
            if (lsValEl) lsValEl.textContent = v;
            setTxtProp('charSpacing', v * 10);
        });

        // Line height (slider)
        if (lineHEl) lineHEl.addEventListener('input', function () {
            var v = parseFloat(lineHEl.value).toFixed(2);
            if (lhValEl) lhValEl.textContent = v;
            setTxtProp('lineHeight', parseFloat(v));
        });

        // Opacity slider
        if (txtOpEl) txtOpEl.addEventListener('input', function () {
            var v = parseInt(txtOpEl.value, 10);
            if (txtOpValEl) txtOpValEl.textContent = v + '%';
            setTxtProp('opacity', v / 100);
        });

        // Text shadow
        var txtShadowChk = g('pm-txt-shadow');
        var txtShadowRow = g('pm-txt-shadow-row');
        function applyTxtShadow() {
            var o = activeObj(); if (!o || (o.type !== 'i-text' && o.type !== 'text')) return;
            if (!txtShadowChk || !txtShadowChk.checked) { o.set('shadow', null); }
            else {
                var sc = g('pm-txt-shadow-color'), sb = g('pm-txt-shadow-blur'),
                    sx = g('pm-txt-shadow-x'),     sy = g('pm-txt-shadow-y');
                o.set('shadow', new _fabric.Shadow({
                    color: sc ? sc.value : '#000', blur: sb ? +sb.value : 4,
                    offsetX: sx ? +sx.value : 2, offsetY: sy ? +sy.value : 2
                }));
            }
            _canvas.renderAll();
        }
        if (txtShadowChk) txtShadowChk.addEventListener('change', function () {
            if (txtShadowRow) txtShadowRow.style.display = txtShadowChk.checked ? 'flex' : 'none';
            applyTxtShadow();
        });
        ['pm-txt-shadow-color','pm-txt-shadow-blur','pm-txt-shadow-x','pm-txt-shadow-y'].forEach(function (id) {
            var el = g(id); if (el) el.addEventListener('input', applyTxtShadow);
        });

        // ── Shape property controls ─────────────────────────────
        var fillEl      = g('pm-fill');
        var strokeEl    = g('pm-stroke');
        var strokewEl   = g('pm-strokew');
        var strokedashEl= g('pm-strokedash');
        var cornerEl    = g('pm-corner');
        var opacityEl   = g('pm-opacity');
        var opValEl     = g('pm-opacity-val');

        if (fillEl)    fillEl.addEventListener('input',    function () { setShapeProp('fill', fillEl.value); });
        if (strokeEl)  strokeEl.addEventListener('input',  function () { setShapeProp('stroke', strokeEl.value); });
        if (strokewEl) strokewEl.addEventListener('input', function () { setShapeProp('strokeWidth', parseInt(strokewEl.value, 10)); });
        if (strokedashEl) strokedashEl.addEventListener('change', function () {
            var o = activeObj(); if (!o) return;
            var v = strokedashEl.value;
            o.set('strokeDashArray', v === 'dash' ? [12,6] : v === 'dot' ? [2,6] : null);
            _canvas.renderAll();
        });
        if (cornerEl) cornerEl.addEventListener('input', function () {
            var o = activeObj(); if (!o) return;
            var r = parseInt(cornerEl.value, 10);
            if (o.type === 'rect') { o.set({ rx: r, ry: r }); _canvas.renderAll(); }
        });
        if (opacityEl) opacityEl.addEventListener('input', function () {
            var v = parseInt(opacityEl.value, 10);
            if (opValEl) opValEl.textContent = v;
            setShapeProp('opacity', v / 100);
        });

        // Shape shadow
        var shdChk = g('pm-shape-shadow');
        var shdRow = g('pm-shape-shadow-row');
        function applyShapeShadow() {
            var o = activeObj(); if (!o) return;
            if (!shdChk || !shdChk.checked) { o.set('shadow', null); }
            else {
                var sc = g('pm-shd-color'), sb = g('pm-shd-blur'),
                    sx = g('pm-shd-x'),     sy = g('pm-shd-y');
                o.set('shadow', new _fabric.Shadow({
                    color: sc ? sc.value : '#00000055', blur: sb ? +sb.value : 8,
                    offsetX: sx ? +sx.value : 4, offsetY: sy ? +sy.value : 4
                }));
            }
            _canvas.renderAll();
        }
        if (shdChk) shdChk.addEventListener('change', function () {
            if (shdRow) shdRow.style.display = shdChk.checked ? 'flex' : 'none';
            applyShapeShadow();
        });
        ['pm-shd-color','pm-shd-blur','pm-shd-x','pm-shd-y'].forEach(function (id) {
            var el = g(id); if (el) el.addEventListener('input', applyShapeShadow);
        });

        // ── Contextual action bar controls ──────────────────────
        // Position / size inputs
        ['pm-pos-x','pm-pos-y','pm-ctx-w','pm-ctx-h'].forEach(function (id) {
            var el = g(id); if (!el) return;
            el.addEventListener('change', function () {
                if (_updatingCtx) return;
                var o = activeObj(); if (!o) return;
                var x  = parseFloat(g('pm-pos-x').value),
                    y  = parseFloat(g('pm-pos-y').value),
                    ww = parseFloat(g('pm-ctx-w').value),
                    hh = parseFloat(g('pm-ctx-h').value);
                if (!isNaN(x))  o.set('left', x);
                if (!isNaN(y))  o.set('top',  y);
                if (!isNaN(ww) && ww > 0) o.scaleToWidth(ww);
                if (!isNaN(hh) && hh > 0) o.scaleToHeight(hh);
                o.setCoords(); _canvas.renderAll(); snapshotHistory();
            });
        });

        // Context-bar opacity slider
        var ctxOpEl  = g('pm-ctx-opacity');
        var ctxOpVal = g('pm-ctx-opval');
        if (ctxOpEl) ctxOpEl.addEventListener('input', function () {
            var v = parseInt(ctxOpEl.value, 10);
            if (ctxOpVal) ctxOpVal.textContent = v + '%';
            var o = activeObj(); if (o) { o.set('opacity', v / 100); _canvas.renderAll(); }
        });

        // Flip
        var flipHBtn = g('pm-flip-h');
        var flipVBtn = g('pm-flip-v');
        if (flipHBtn) flipHBtn.addEventListener('click', function () { flipObj('h'); });
        if (flipVBtn) flipVBtn.addEventListener('click', function () { flipObj('v'); });

        // Layer
        var toFrontBtn  = g('pm-to-front');
        var bringFwdBtn = g('pm-bring-fwd');
        var sendBkBtn   = g('pm-send-bk');
        var toBackBtn   = g('pm-to-back');
        if (toFrontBtn)  toFrontBtn.addEventListener('click', function () { var o=activeObj(); if(o){_canvas.bringToFront(o);_canvas.renderAll();snapshotHistory();} });
        if (bringFwdBtn) bringFwdBtn.addEventListener('click', function () { var o=activeObj(); if(o){_canvas.bringForward(o);_canvas.renderAll();snapshotHistory();} });
        if (sendBkBtn)   sendBkBtn.addEventListener('click',  function () { var o=activeObj(); if(o){_canvas.sendBackwards(o);_canvas.renderAll();snapshotHistory();} });
        if (toBackBtn)   toBackBtn.addEventListener('click',  function () { var o=activeObj(); if(o){_canvas.sendToBack(o);_canvas.renderAll();snapshotHistory();} });

        // Group / Ungroup
        var groupBtn   = g('pm-group');
        var ungroupBtn = g('pm-ungroup');
        if (groupBtn)   groupBtn.addEventListener('click',   groupSelected);
        if (ungroupBtn) ungroupBtn.addEventListener('click', ungroupSelected);

        // Lock
        var lockBtn = g('pm-lock');
        if (lockBtn) lockBtn.addEventListener('click', lockToggle);

        // Align buttons
        var ALIGNS = { l:'left', ch:'center-h', r:'right', t:'top', cv:'center-v', b:'bottom' };
        Object.keys(ALIGNS).forEach(function (k) {
            var btn = g('pm-aln-' + k);
            if (btn) btn.addEventListener('click', function () { alignObjects(ALIGNS[k]); });
        });
        var distHBtn = g('pm-dist-h');
        var distVBtn = g('pm-dist-v');
        if (distHBtn) distHBtn.addEventListener('click', function () { distributeObjects('h'); });
        if (distVBtn) distVBtn.addEventListener('click', function () { distributeObjects('v'); });

        // Duplicate + Delete (ctx bar)
        var dupBtn = g('pm-dup-obj');
        var delBtn = g('pm-del-obj');
        if (dupBtn) dupBtn.addEventListener('click', duplicateObj);
        if (delBtn) delBtn.addEventListener('click', function () {
            var o = activeObj(); if (o) { _canvas.remove(o); _canvas.renderAll(); snapshotHistory(); }
        });

        // Select All / Copy / Paste / Duplicate (toolbar)
        var selAllBtn = g('pm-sel-all');
        var copyBtn   = g('pm-copy');
        var pasteBtn  = g('pm-paste');
        var dupTbBtn  = g('pm-dup');
        if (selAllBtn) selAllBtn.addEventListener('click', selectAll);
        if (copyBtn)   copyBtn.addEventListener('click',   copyObj);
        if (pasteBtn)  pasteBtn.addEventListener('click',  pasteObj);
        if (dupTbBtn)  dupTbBtn.addEventListener('click',  duplicateObj);

        // Zoom
        var zoomOutBtn = g('pm-zoom-out');
        var zoomInBtn  = g('pm-zoom-in');
        var zoomFitBtn = g('pm-zoom-fit');
        if (zoomOutBtn) zoomOutBtn.addEventListener('click', function () { setZoomLevel(_pmZoom / 1.25); });
        if (zoomInBtn)  zoomInBtn.addEventListener('click',  function () { setZoomLevel(_pmZoom * 1.25); });
        if (zoomFitBtn) zoomFitBtn.addEventListener('click', function () { setZoomLevel(1); });

        // Grid toggle
        var gridBtn = g('pm-grid-toggle');
        if (gridBtn) gridBtn.addEventListener('click', function () {
            _snapGrid = !_snapGrid;
            gridBtn.style.background = _snapGrid ? '#1d4ed8' : '#94a3b8';
            drawGrid();
        });

        // Pages
        var addPageBtn = g('pm-add-page');
        if (addPageBtn) addPageBtn.addEventListener('click', addPage);

        // Update ctx bar when canvas selection changes
        _canvas.on('selection:created', function () { updateCtxBar(); updatePropsPanel(); });
        _canvas.on('selection:updated', function () { updateCtxBar(); updatePropsPanel(); });
        _canvas.on('selection:cleared', function () { hideCtxBar(); hidePropsPanel(); });
        _canvas.on('object:moving',   updateCtxBarPosition);
        _canvas.on('object:scaling',  updateCtxBarPosition);
        _canvas.on('object:rotating', updateCtxBarPosition);
        if (_snapGrid) _canvas.on('object:moving', snapToGrid);

        // ── Keyboard shortcuts ───────────────────────────────────
        document.addEventListener('keydown', function (e) {
            if (!_canvas) return;
            var inInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT');
            var section = g('posterMakerSection');
            if (!section || section.style.display === 'none') return;

            var ctrl = e.ctrlKey || e.metaKey;

            // Inside IText editor: only intercept copy/paste/undo
            if (_canvas.isEditing) {
                if (ctrl && e.key === 'z') { undo(); e.preventDefault(); }
                return;
            }
            if (inInput) return;

            if (e.key === 'Delete' || e.key === 'Backspace') {
                var o = activeObj();
                if (o) { _canvas.remove(o); _canvas.renderAll(); snapshotHistory(); e.preventDefault(); }
            }
            if (ctrl && e.key === 'z') { undo(); e.preventDefault(); }
            if (ctrl && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) { redo(); e.preventDefault(); }
            if (ctrl && e.key === 'c') { copyObj(); e.preventDefault(); }
            if (ctrl && e.key === 'v') { pasteObj(); e.preventDefault(); }
            if (ctrl && e.key === 'd') { duplicateObj(); e.preventDefault(); }
            if (ctrl && e.key === 'a') { selectAll(); e.preventDefault(); }
            if (ctrl && e.key === 'g' && !e.shiftKey) { groupSelected(); e.preventDefault(); }
            if (ctrl && e.key === 'G' &&  e.shiftKey) { ungroupSelected(); e.preventDefault(); }

            // Arrow nudge
            var STEP = e.shiftKey ? 10 : 1;
            var ao = activeObj();
            if (ao) {
                if (e.key === 'ArrowLeft')  { ao.set('left', ao.left - STEP); ao.setCoords(); _canvas.renderAll(); e.preventDefault(); }
                if (e.key === 'ArrowRight') { ao.set('left', ao.left + STEP); ao.setCoords(); _canvas.renderAll(); e.preventDefault(); }
                if (e.key === 'ArrowUp')    { ao.set('top',  ao.top  - STEP); ao.setCoords(); _canvas.renderAll(); e.preventDefault(); }
                if (e.key === 'ArrowDown')  { ao.set('top',  ao.top  + STEP); ao.setCoords(); _canvas.renderAll(); e.preventDefault(); }
            }
        });
        document.addEventListener('keyup', function (e) {
            if (!_canvas) return;
            var section = g('posterMakerSection');
            if (!section || section.style.display === 'none') return;
            var ao = activeObj();
            if (ao && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].indexOf(e.key) >= 0) {
                snapshotHistory();
            }
        });

        // ── Toolbar ─────────────────────────────────────────────
        var undoBtn   = g('pm-undo');
        var redoBtn   = g('pm-redo');
        var clearBtn  = g('pm-clear');
        var saveAsBtn = g('pm-save-as');
        var printBtn  = g('pm-print');

        if (undoBtn)  undoBtn.addEventListener('click', undo);
        if (redoBtn)  redoBtn.addEventListener('click', redo);
        if (clearBtn) clearBtn.addEventListener('click', clearAll);
        if (printBtn) printBtn.addEventListener('click', doPrint);

        // Toggle save panel
        if (saveAsBtn) saveAsBtn.addEventListener('click', function () {
            var panel = g('pm-save-panel');
            if (!panel) return;
            var open = panel.style.display !== 'none';
            panel.style.display = open ? 'none' : 'flex';
            saveAsBtn.style.background = open ? '#7c3aed' : '#4c1d95';
            if (!open) updateSizeHint();
        });

        // Format pills
        document.querySelectorAll('#pm-save-panel .pm-fmt-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _expFmt = btn.getAttribute('data-fmt');
                document.querySelectorAll('#pm-save-panel .pm-fmt-btn').forEach(function (b) {
                    var active = b === btn;
                    b.style.background    = active ? '#7c3aed' : '#fff';
                    b.style.color         = active ? '#fff'    : '#374151';
                    b.style.borderColor   = active ? '#7c3aed' : '#e5e7eb';
                });
                var qualRow = g('pm-qual-row');
                if (qualRow) qualRow.style.display =
                    (_expFmt === 'jpg' || _expFmt === 'pdf') ? 'flex' : 'none';
                updateSizeHint();
            });
        });

        // Scale pills
        document.querySelectorAll('#pm-save-panel .pm-scale-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                _expScale = parseInt(btn.getAttribute('data-scale'), 10);
                document.querySelectorAll('#pm-save-panel .pm-scale-btn').forEach(function (b) {
                    var active = b === btn;
                    b.style.background  = active ? '#0ea5e9' : '#fff';
                    b.style.color       = active ? '#fff'    : '#374151';
                    b.style.borderColor = active ? '#0ea5e9' : '#e5e7eb';
                });
                updateSizeHint();
            });
        });

        // Quality slider
        var qualSlider = g('pm-qual-slider');
        var qualVal    = g('pm-qual-val');
        if (qualSlider) qualSlider.addEventListener('input', function () {
            _expQual = parseInt(qualSlider.value, 10);
            if (qualVal) qualVal.textContent = _expQual + '%';
            updateSizeHint();
        });

        // Download button
        var doSaveBtn = g('pm-do-save');
        if (doSaveBtn) doSaveBtn.addEventListener('click', function () {
            doSaveBtn.disabled = true;
            doSaveBtn.textContent = t('Working…', '处理中…', '處理中…');
            doExport().catch(function (e) {
                alert(t('Export failed: ', '导出失败：', '匯出失敗：') + (e && e.message || e));
            }).then(function () {
                doSaveBtn.disabled = false;
                doSaveBtn.innerHTML = '📥 ' + esc(t('Download', '下载', '下載'));
            });
        });

        // ── Project Save / Open ───────────────────────────────────
        var projSaveBtn = g('pm-proj-save');
        if (projSaveBtn) {
            projSaveBtn.addEventListener('click', function () { doSaveProject(); });
        }
        var projOpenBtn = g('pm-proj-open'), projFileInput = g('pm-proj-file-input');
        if (projOpenBtn && projFileInput) {
            projOpenBtn.addEventListener('click', function () { projFileInput.click(); });
            projFileInput.addEventListener('change', function () {
                var file = projFileInput.files && projFileInput.files[0];
                if (file) { doOpenProject(file, fabric); }
                projFileInput.value = '';  // reset so same file can be re-opened
            });
        }

        // ── Template language toggle ──────────────────────────────
        var pmLangBtns = document.querySelectorAll('.pm-lang-btn');
        function updateLangBtns() {
            pmLangBtns.forEach(function (b) {
                var val = b.dataset.pmlang;
                var active = (val === (_pmLang || ''));
                b.style.background = active ? '#3b82f6' : '#f1f5f9';
                b.style.color      = active ? '#fff'    : '#374151';
            });
        }
        pmLangBtns.forEach(function (b) {
            b.addEventListener('click', function () {
                _pmLang = b.dataset.pmlang || null;
                updateLangBtns();
            });
        });
        updateLangBtns();

        // Initialise page strip, zoom display, and grid overlay
        updatePageStrip();
        drawGrid();
        var pct = g('pm-zoom-pct'); if (pct) pct.textContent = Math.round(_pmZoom * 100) + '%';

        // ── Online Library wiring ──────────────────────────────────
        // Restore saved API keys from localStorage
        var ukEl = g('pm-ol-ukey'), pkEl = g('pm-ol-pkey');
        if (ukEl) ukEl.value = (localStorage.getItem('pm_unsplash_key') || '');
        if (pkEl) pkEl.value = (localStorage.getItem('pm_pexels_key')   || '');

        // API key modal open/close
        var olApiBtnEl = g('pm-ol-apikey-btn'), olModalEl = g('pm-ol-keymodal');
        if (olApiBtnEl && olModalEl) {
            olApiBtnEl.addEventListener('click', function () {
                olModalEl.style.display = olModalEl.style.display === 'none' ? 'block' : 'none';
            });
        }
        // "This browser only" save — localStorage only
        var olKeySaveEl = g('pm-ol-key-save'), olKeyCancelEl = g('pm-ol-key-cancel');
        if (olKeySaveEl) {
            olKeySaveEl.addEventListener('click', function () {
                var uv = ((g('pm-ol-ukey') || {}).value || '').trim();
                var pv = ((g('pm-ol-pkey') || {}).value || '').trim();
                if (uv) localStorage.setItem('pm_unsplash_key', uv);
                else    localStorage.removeItem('pm_unsplash_key');
                if (pv) localStorage.setItem('pm_pexels_key', pv);
                else    localStorage.removeItem('pm_pexels_key');
                if (olModalEl) olModalEl.style.display = 'none';
                alert(t('Keys saved for this browser.','密钥已保存到此浏览器。','密鑰已儲存至此瀏覽器。'));
            });
        }

        // "Save to Supabase (all users)" — upsert to app_config table
        var olKeySaveSbEl = g('pm-ol-key-save-sb');
        if (olKeySaveSbEl) {
            olKeySaveSbEl.addEventListener('click', function () {
                var uv = ((g('pm-ol-ukey') || {}).value || '').trim();
                var pv = ((g('pm-ol-pkey') || {}).value || '').trim();
                olKeySaveSbEl.disabled = true;
                olKeySaveSbEl.textContent = '⏳ ' + t('Saving…','保存中…','儲存中…');
                pmSaveApiKeysToSupabase(uv, pv)
                    .then(function (result) {
                        olKeySaveSbEl.disabled = false;
                        olKeySaveSbEl.innerHTML = '☁️ ' + esc(t('Save to Supabase (all users)','保存到Supabase（所有用户）','儲存到Supabase（所有使用者）'));
                        if (result.ok) {
                            if (uv) localStorage.setItem('pm_unsplash_key', uv);
                            else    localStorage.removeItem('pm_unsplash_key');
                            if (pv) localStorage.setItem('pm_pexels_key', pv);
                            else    localStorage.removeItem('pm_pexels_key');
                            if (olModalEl) olModalEl.style.display = 'none';
                            pmRefreshKeyModalStatus();
                            alert(t('✅ Keys saved to Supabase — all users will receive them automatically.',
                                    '✅ 密钥已保存到Supabase，所有用户将自动获取。',
                                    '✅ 密鑰已儲存到Supabase，所有使用者將自動獲取。'));
                        } else {
                            // Show specific error and guide user to copy-SQL approach
                            var errMsg = result.error || 'Unknown error';
                            var sbStatus = g('pm-ol-key-sb-status');
                            if (sbStatus) {
                                sbStatus.style.color = '#f87171';
                                sbStatus.textContent = '❌ ' + errMsg + ' → ' +
                                    t('Click "Copy Setup SQL" and run it in your Supabase SQL Editor first.',
                                      '请点击"复制安装SQL"并在Supabase SQL编辑器中运行。',
                                      '請點擊「複製安裝SQL」並在Supabase SQL編輯器中執行。');
                            }
                        }
                    });
            });
        }

        // "Copy Setup SQL" — generates complete SQL and copies to clipboard
        var olCopySqlEl = g('pm-ol-key-copy-sql');
        if (olCopySqlEl) {
            olCopySqlEl.addEventListener('click', function () {
                var uv = ((g('pm-ol-ukey') || {}).value || '').trim();
                var pv = ((g('pm-ol-pkey') || {}).value || '').trim();
                var sql = pmGenerateSetupSql(uv, pv);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(sql).then(function () {
                        olCopySqlEl.textContent = '✅ Copied!';
                        setTimeout(function () {
                            olCopySqlEl.innerHTML = '📋 ' + esc(t('Copy Setup SQL (run in Supabase)','复制安装SQL（在Supabase运行）','複製安裝SQL（在Supabase執行）'));
                        }, 2500);
                    });
                } else {
                    // Fallback: show in a prompt for manual copy
                    window.prompt(t('Copy this SQL and run it in your Supabase SQL Editor:',
                                    '请复制此SQL并在Supabase SQL编辑器中运行：',
                                    '請複製此SQL並在Supabase SQL編輯器中執行：'), sql);
                }
            });
        }

        if (olKeyCancelEl) {
            olKeyCancelEl.addEventListener('click', function () {
                if (olModalEl) olModalEl.style.display = 'none';
            });
        }

        // Refresh Supabase status whenever the modal is opened
        if (olApiBtnEl && olModalEl) {
            olApiBtnEl.addEventListener('click', function () {
                pmRefreshKeyModalStatus();
            }, true);
        }

        // Tab switching
        var olTabBtns = document.querySelectorAll('.pm-ol-tab');
        olTabBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                _olTab = btn.dataset.oltab;
                olTabBtns.forEach(function (b) {
                    var active = b.dataset.oltab === _olTab;
                    b.style.background = active ? '#3b82f6' : '#1e293b';
                    b.style.color      = active ? '#fff'    : '#94a3b8';
                    b.style.borderColor= active ? '#3b82f6' : '#334155';
                });
                var panels = ['photos','icons','import'];
                panels.forEach(function (p) {
                    var el = g('pm-ol-' + p);
                    if (el) el.style.display = p === _olTab ? 'flex' : 'none';
                });
            });
        });

        // Photo source selector
        var olSrcEl = g('pm-ol-src');
        if (olSrcEl) {
            olSrcEl.addEventListener('change', function () { _olPhotoSrc = olSrcEl.value; });
        }

        // Photo quick-category pills
        var olCatBtns = document.querySelectorAll('.pm-ol-cat-btn');
        olCatBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var qEl = g('pm-ol-photo-q');
                if (qEl) qEl.value = btn.dataset.q;
                var resEl = g('pm-ol-photo-res');
                if (resEl) resEl.innerHTML = '<div style="grid-column:1/-1;font-size:9px;color:#94a3b8;text-align:center;padding:8px;">⏳ ' +
                    esc(t('Searching…','搜索中…','搜尋中…')) + '</div>';
                olSearchPhotos(btn.dataset.q);
            });
        });

        // Photo search
        var olPhotoGoEl = g('pm-ol-photo-go');
        if (olPhotoGoEl) {
            olPhotoGoEl.addEventListener('click', function () {
                var q = ((g('pm-ol-photo-q') || {}).value || '').trim();
                if (!q) return;
                var resEl = g('pm-ol-photo-res');
                if (resEl) resEl.innerHTML = '<div style="grid-column:1/-1;font-size:9px;color:#94a3b8;text-align:center;padding:8px;">⏳ ' +
                    esc(t('Searching…','搜索中…','搜尋中…')) + '</div>';
                olSearchPhotos(q);
            });
        }

        // Icon search
        var olIconGoEl = g('pm-ol-icon-go');
        if (olIconGoEl) {
            olIconGoEl.addEventListener('click', function () {
                var q = ((g('pm-ol-icon-q') || {}).value || '').trim();
                if (!q) return;
                var resEl = g('pm-ol-icon-res');
                if (resEl) resEl.innerHTML = '<div style="grid-column:1/-1;font-size:9px;color:#94a3b8;text-align:center;padding:8px;">⏳ ' +
                    esc(t('Searching…','搜索中…','搜尋中…')) + '</div>';
                olSearchIcons(q);
            });
        }

        // Import from URL
        var olImpGoEl = g('pm-ol-import-go');
        if (olImpGoEl) {
            olImpGoEl.addEventListener('click', function () {
                var url = ((g('pm-ol-import-url') || {}).value || '').trim();
                if (!url) return;
                olImportFromUrl(url, fabric);
            });
        }

        // Import from pasted JSON
        var olImpJsonGoEl = g('pm-ol-import-json-go');
        if (olImpJsonGoEl) {
            olImpJsonGoEl.addEventListener('click', function () {
                var raw = ((g('pm-ol-import-json') || {}).value || '').trim();
                if (!raw) return;
                try {
                    var json = JSON.parse(raw);
                    olApplyTemplateJson(json, fabric);
                } catch (e) {
                    alert(t('Invalid JSON: ','JSON无效：','JSON無效：') + e.message);
                }
            });
        }
    }

    // ── Object helpers ────────────────────────────────────────────
    // ── Element factory ───────────────────────────────────────────────
    function addElement(fabric, elId) {
        if (!_canvas) return;
        var obj = _createElement(fabric, elId);
        if (!obj) return;
        _canvas.add(obj);
        _canvas.setActiveObject(obj);
        _canvas.renderAll();
        snapshotHistory();
    }

    function _createElement(fabric, elId) {
        // Helper: place near canvas center with slight random offset
        var cx = (_canvas._pmLogicalW || 400) * 0.5;
        var cy = (_canvas._pmLogicalH || 500) * 0.5;
        var jx = sf(Math.round((Math.random() - 0.5) * 60));
        var jy = sf(Math.round((Math.random() - 0.5) * 60));
        var lx = Math.round(cx * (_canvas._pmScale || 1) - sf(80) + jx);
        var ly = Math.round(cy * (_canvas._pmScale || 1) - sf(50) + jy);
        if (lx < 0) lx = sf(20);
        if (ly < 0) ly = sf(20);

        // Regular polygon helper
        function poly(sides, r, fillClr) {
            var pts = [];
            for (var i = 0; i < sides; i++) {
                var a = (i * 2 * Math.PI / sides) - Math.PI / 2;
                pts.push({ x: r + Math.cos(a) * r, y: r + Math.sin(a) * r });
            }
            return new fabric.Polygon(pts, { left: lx, top: ly, fill: fillClr, strokeWidth: 0 });
        }
        // Star/burst polygon helper
        function star(points, outerR, innerR, fillClr) {
            var pts = [];
            for (var i = 0; i < points * 2; i++) {
                var a = (i * Math.PI / points) - Math.PI / 2;
                var r = (i % 2 === 0) ? outerR : innerR;
                pts.push({ x: outerR + Math.cos(a) * r, y: outerR + Math.sin(a) * r });
            }
            return new fabric.Polygon(pts, { left: lx, top: ly, fill: fillClr, strokeWidth: 0 });
        }
        // Arrow shape helper (points-based chevron)
        function arrowPoly(pts, fillClr) {
            return new fabric.Polygon(pts, { left: lx, top: ly, fill: fillClr, strokeWidth: 0 });
        }
        // Line helper
        function mkLine(dashArr) {
            var opts = {
                left: lx, top: ly + sf(40),
                stroke: '#334155', strokeWidth: sf(3),
                selectable: true, evented: true, hasControls: true
            };
            if (dashArr) opts.strokeDashArray = dashArr.map(function(v) { return sf(v); });
            return new fabric.Line([0, 0, sf(200), 0], opts);
        }
        // SVG path helper (scaled)
        function scaledPath(d, scale, fillClr) {
            return new fabric.Path(d, {
                left: lx, top: ly, fill: fillClr, strokeWidth: 0,
                scaleX: sf(scale) / 100, scaleY: sf(scale) / 100
            });
        }

        var R = sf(80);  // common radius
        var W = sf(200), H = sf(100);
        var BLUE = '#4f46e5', CYAN = '#06b6d4', AMBER = '#f59e0b',
            PINK = '#ec4899', TEAL = '#10b981', ROSE = '#ef4444',
            VIOLET = '#8b5cf6', SKY = '#0ea5e9', LIME = '#84cc16';

        switch (elId) {
            // ── Text ──────────────────────────────────────────────────
            case 'txt-h': return new fabric.IText(t('Heading', '标题', '標題'), {
                left: lx, top: ly, fontSize: sf(52), fontWeight: '900',
                fill: '#1a1a1a', fontFamily: 'Arial', editable: true });
            case 'txt-s': return new fabric.IText(t('Subheading', '副标题', '副標題'), {
                left: lx, top: ly, fontSize: sf(32), fontWeight: '700',
                fill: '#334155', fontFamily: 'Arial', editable: true });
            case 'txt-b': return new fabric.IText(t('Body text', '正文', '正文'), {
                left: lx, top: ly, fontSize: sf(20),
                fill: '#475569', fontFamily: 'Arial', editable: true });
            case 'txt-c': return new fabric.IText(t('Caption', '说明', '說明'), {
                left: lx, top: ly, fontSize: sf(14), fontStyle: 'italic',
                fill: '#64748b', fontFamily: 'Arial', editable: true });

            // ── Basic shapes ──────────────────────────────────────────
            case 'sq': return new fabric.Rect({
                left: lx, top: ly, width: sf(150), height: sf(150),
                fill: BLUE, strokeWidth: 0 });
            case 'circ': return new fabric.Circle({
                left: lx, top: ly, radius: R, fill: CYAN, strokeWidth: 0 });
            case 'tri': return new fabric.Triangle({
                left: lx, top: ly, width: sf(160), height: sf(140),
                fill: AMBER, strokeWidth: 0 });
            case 'diamo': return new fabric.Polygon(
                [{ x: R, y: 0 }, { x: sf(160), y: R }, { x: R, y: sf(160) }, { x: 0, y: R }],
                { left: lx, top: ly, fill: PINK, strokeWidth: 0 });
            case 'rrect': return new fabric.Rect({
                left: lx, top: ly, width: W, height: H, rx: sf(20), ry: sf(20),
                fill: VIOLET, strokeWidth: 0 });
            case 'oval': return new fabric.Ellipse({
                left: lx, top: ly, rx: sf(110), ry: sf(65),
                fill: TEAL, strokeWidth: 0 });
            case 'rtri': return new fabric.Polygon(
                [{ x: 0, y: 0 }, { x: sf(160), y: sf(160) }, { x: 0, y: sf(160) }],
                { left: lx, top: ly, fill: '#f97316', strokeWidth: 0 });
            case 'para': return new fabric.Polygon(
                [{ x: sf(40), y: 0 }, { x: sf(200), y: 0 }, { x: sf(160), y: sf(100) }, { x: 0, y: sf(100) }],
                { left: lx, top: ly, fill: SKY, strokeWidth: 0 });
            case 'trapz': return new fabric.Polygon(
                [{ x: sf(40), y: 0 }, { x: sf(160), y: 0 }, { x: sf(200), y: sf(100) }, { x: 0, y: sf(100) }],
                { left: lx, top: ly, fill: ROSE, strokeWidth: 0 });
            case 'lband': return new fabric.Rect({
                left: lx, top: ly, width: W, height: sf(60), rx: sf(8), ry: sf(8),
                fill: '#e879f9', strokeWidth: 0 });
            case 'penta': return poly(5, R, '#6366f1');
            case 'hexa':  return poly(6, R, CYAN);
            case 'octa':  return poly(8, R, '#f97316');
            case 'ring':  return new fabric.Circle({
                left: lx, top: ly, radius: R, fill: 'transparent',
                stroke: LIME, strokeWidth: sf(18) });
            case 'frame': return new fabric.Rect({
                left: lx, top: ly, width: sf(200), height: sf(160),
                fill: 'transparent', stroke: '#64748b', strokeWidth: sf(6),
                rx: sf(4), ry: sf(4) });
            case 'cross': {
                var sz = sf(140), aw = sf(50);
                var off = (sz - aw) / 2;
                return new fabric.Polygon([
                    { x: off, y: 0 }, { x: sz - off, y: 0 }, { x: sz - off, y: off },
                    { x: sz, y: off }, { x: sz, y: sz - off }, { x: sz - off, y: sz - off },
                    { x: sz - off, y: sz }, { x: off, y: sz }, { x: off, y: sz - off },
                    { x: 0, y: sz - off }, { x: 0, y: off }, { x: off, y: off }
                ], { left: lx, top: ly, fill: ROSE, strokeWidth: 0 });
            }

            // ── Stars ─────────────────────────────────────────────────
            case 'star4':  return star(4,  R, sf(32), '#fde68a');
            case 'star5':  return star(5,  R, sf(35), '#fcd34d');
            case 'star6':  return star(6,  R, sf(44), '#fbbf24');
            case 'star8':  return star(8,  R, sf(40), AMBER);
            case 'burst': {
                var pts = [], nbr = 12, ro = R, ri = sf(60);
                for (var bi = 0; bi < nbr * 2; bi++) {
                    var ba = (bi * Math.PI / nbr) - Math.PI / 2;
                    var br = (bi % 2 === 0) ? ro : ri;
                    pts.push({ x: ro + Math.cos(ba) * br, y: ro + Math.sin(ba) * br });
                }
                return new fabric.Polygon(pts, { left: lx, top: ly, fill: ROSE, strokeWidth: 0 });
            }
            case 'shield': return new fabric.Path(
                'M 80 0 L 160 40 L 160 110 Q 160 160 80 200 Q 0 160 0 110 L 0 40 Z',
                { left: lx, top: ly, fill: SKY, strokeWidth: 0,
                  scaleX: sf(1.1)/100, scaleY: sf(1.1)/100 });
            case 'banner': return new fabric.Polygon(
                [{ x: 0, y: sf(40) }, { x: W, y: sf(40) }, { x: W, y: sf(120) },
                 { x: W / 2, y: sf(160) }, { x: 0, y: sf(120) }],
                { left: lx, top: ly, fill: PINK, strokeWidth: 0 });
            case 'heart': return new fabric.Path(
                'M 100 60 Q 100 20 65 20 Q 20 20 20 65 Q 20 110 100 155 Q 180 110 180 65 Q 180 20 135 20 Q 100 20 100 60 Z',
                { left: lx, top: ly, fill: ROSE, strokeWidth: 0,
                  scaleX: sf(1)/100, scaleY: sf(1)/100 });

            // ── Arrows ────────────────────────────────────────────────
            case 'arr-r': return arrowPoly([
                { x: 0, y: sf(35) }, { x: sf(130), y: sf(35) }, { x: sf(130), y: 0 },
                { x: W, y: sf(50) }, { x: sf(130), y: H }, { x: sf(130), y: sf(65) }, { x: 0, y: sf(65) }
            ], CYAN);
            case 'arr-l': return arrowPoly([
                { x: W, y: sf(35) }, { x: sf(70), y: sf(35) }, { x: sf(70), y: 0 },
                { x: 0, y: sf(50) }, { x: sf(70), y: H }, { x: sf(70), y: sf(65) }, { x: W, y: sf(65) }
            ], CYAN);
            case 'arr-u': return arrowPoly([
                { x: sf(35), y: H }, { x: sf(35), y: sf(70) }, { x: 0, y: sf(70) },
                { x: sf(50), y: 0 }, { x: H, y: sf(70) }, { x: sf(65), y: sf(70) }, { x: sf(65), y: H }
            ], CYAN);
            case 'arr-d': return arrowPoly([
                { x: sf(35), y: 0 }, { x: sf(35), y: sf(30) }, { x: 0, y: sf(30) },
                { x: sf(50), y: H }, { x: H, y: sf(30) }, { x: sf(65), y: sf(30) }, { x: sf(65), y: 0 }
            ], CYAN);
            case 'arr-lr': return arrowPoly([
                { x: 0, y: sf(50) }, { x: sf(40), y: 0 }, { x: sf(40), y: sf(30) },
                { x: sf(160), y: sf(30) }, { x: sf(160), y: 0 }, { x: W, y: sf(50) },
                { x: sf(160), y: H }, { x: sf(160), y: sf(70) },
                { x: sf(40), y: sf(70) }, { x: sf(40), y: H }
            ], '#a5f3fc');
            case 'arr-ud': return arrowPoly([
                { x: sf(50), y: 0 }, { x: H, y: sf(40) }, { x: sf(65), y: sf(40) },
                { x: sf(65), y: sf(120) }, { x: H, y: sf(120) }, { x: sf(50), y: sf(160) },
                { x: 0, y: sf(120) }, { x: sf(35), y: sf(120) },
                { x: sf(35), y: sf(40) }, { x: 0, y: sf(40) }
            ], '#a5f3fc');
            case 'notch': return arrowPoly([
                { x: 0, y: 0 }, { x: sf(155), y: 0 }, { x: W, y: sf(50) },
                { x: sf(155), y: H }, { x: 0, y: H }, { x: sf(45), y: sf(50) }
            ], '#7dd3fc');
            case 'chevron': return arrowPoly([
                { x: 0, y: 0 }, { x: sf(130), y: sf(50) }, { x: 0, y: H },
                { x: sf(30), y: H }, { x: sf(160), y: sf(50) }, { x: sf(30), y: 0 }
            ], '#93c5fd');

            // ── Lines ─────────────────────────────────────────────────
            case 'line-s':   return mkLine(null);
            case 'line-d':   return mkLine([12, 6]);
            case 'line-dot': return mkLine([2, 6]);
            case 'line-ar': {
                var lineAr = mkLine(null);
                lineAr.strokeWidth = sf(2);
                return lineAr;
            }
            case 'line-v': return new fabric.Line([0, 0, 0, sf(200)], {
                left: lx, top: ly, stroke: '#334155', strokeWidth: sf(3) });
            case 'line-dv': return new fabric.Line([0, 0, sf(140), sf(140)], {
                left: lx, top: ly, stroke: '#334155', strokeWidth: sf(3) });
            case 'line-th': return new fabric.Line([0, 0, sf(200), 0], {
                left: lx, top: ly, stroke: '#1e293b', strokeWidth: sf(8),
                strokeLineCap: 'round' });
            case 'line-dbl': {
                var g1 = new fabric.Line([0, 0, sf(200), 0], {
                    stroke: '#334155', strokeWidth: sf(2) });
                var g2 = new fabric.Line([0, sf(10), sf(200), sf(10)], {
                    stroke: '#334155', strokeWidth: sf(2) });
                return new fabric.Group([g1, g2], { left: lx, top: ly });
            }

            // ── Callouts ──────────────────────────────────────────────
            case 'bubble': return new fabric.Path(
                'M 10 10 Q 10 0 20 0 L 180 0 Q 190 0 190 10 L 190 90 Q 190 100 180 100 ' +
                'L 120 100 L 100 125 L 80 100 L 20 100 Q 10 100 10 90 Z',
                { left: lx, top: ly, fill: VIOLET, strokeWidth: 0,
                  scaleX: sf(1)/100, scaleY: sf(1)/100 });
            case 'callout': return new fabric.Path(
                'M 10 10 Q 10 0 20 0 L 180 0 Q 190 0 190 10 L 190 90 Q 190 100 180 100 ' +
                'L 140 100 L 160 130 L 100 100 L 20 100 Q 10 100 10 90 Z',
                { left: lx, top: ly, fill: '#818cf8', strokeWidth: 0,
                  scaleX: sf(1)/100, scaleY: sf(1)/100 });
            case 'cloud': return new fabric.Path(
                'M 55 140 Q 10 140 10 100 Q 10 65 45 60 Q 45 20 80 20 Q 95 0 120 0 ' +
                'Q 160 0 165 35 Q 195 35 195 70 Q 195 100 170 105 Q 170 140 130 140 Z',
                { left: lx, top: ly, fill: '#bae6fd', strokeWidth: 0,
                  scaleX: sf(0.9)/100, scaleY: sf(0.9)/100 });
            case 'diamo2': {
                var c1 = new fabric.Circle({ left: sf(0),  top: sf(90), radius: sf(15), fill: '#e0f2fe', strokeWidth: 0 });
                var c2 = new fabric.Circle({ left: sf(20), top: sf(55), radius: sf(22), fill: '#bae6fd', strokeWidth: 0 });
                var c3 = new fabric.Ellipse({ left: sf(0), top: 0, rx: sf(60), ry: sf(48), fill: '#7dd3fc', strokeWidth: 0 });
                return new fabric.Group([c1, c2, c3], { left: lx, top: ly });
            }

            default: return null;
        }
    }

    function activeObj() { return _canvas ? _canvas.getActiveObject() : null; }
    function sf(n) {
        return _canvas ? Math.round(n * (_canvas._pmScale || 1)) : n;
    }

    // ── Zoom ──────────────────────────────────────────────────────────
    function setZoomLevel(z) {
        if (!_canvas) return;
        _pmZoom = Math.max(0.1, Math.min(5, z));
        var sz = SIZES[_size];
        var baseW = Math.round(sz.w * (_canvas._pmScale || 1));
        var baseH = Math.round(sz.h * (_canvas._pmScale || 1));
        var newW = Math.round(baseW * _pmZoom);
        var newH = Math.round(baseH * _pmZoom);
        _canvas.setZoom(_pmZoom);
        _canvas.setWidth(newW);
        _canvas.setHeight(newH);
        var wrap = g('pm-canvas-wrap');
        if (wrap) { wrap.style.width = newW + 'px'; wrap.style.height = newH + 'px'; }
        _canvas.renderAll();
        var pct = g('pm-zoom-pct');
        if (pct) pct.textContent = Math.round(_pmZoom * 100) + '%';
        drawGrid();
    }

    // ── Flip ─────────────────────────────────────────────────────────
    function flipObj(dir) {
        var o = activeObj(); if (!o) return;
        if (dir === 'h') o.set('flipX', !o.flipX);
        else             o.set('flipY', !o.flipY);
        _canvas.renderAll(); snapshotHistory();
    }

    // ── Copy / Paste / Duplicate ──────────────────────────────────────
    function copyObj() {
        var o = activeObj(); if (!o) return;
        o.clone(function (c) { _clipboard = c; });
    }
    function pasteObj() {
        if (!_clipboard || !_canvas) return;
        _clipboard.clone(function (c) {
            _canvas.discardActiveObject();
            c.set({ left: c.left + sf(20), top: c.top + sf(20), evented: true });
            if (c.type === 'activeSelection') {
                c.canvas = _canvas;
                c.forEachObject(function (obj) { _canvas.add(obj); });
                c.setCoords();
            } else { _canvas.add(c); }
            _clipboard.set({ left: _clipboard.left + sf(20), top: _clipboard.top + sf(20) });
            _canvas.setActiveObject(c);
            _canvas.renderAll(); snapshotHistory();
        });
    }
    function duplicateObj() {
        var o = activeObj(); if (!o) return;
        o.clone(function (c) {
            c.set({ left: o.left + sf(20), top: o.top + sf(20) });
            _canvas.add(c);
            _canvas.setActiveObject(c);
            _canvas.renderAll(); snapshotHistory();
        });
    }

    // ── Select All ────────────────────────────────────────────────────
    function selectAll() {
        if (!_canvas) return;
        _canvas.discardActiveObject();
        var sel = new _fabric.ActiveSelection(_canvas.getObjects(), { canvas: _canvas });
        _canvas.setActiveObject(sel);
        _canvas.renderAll();
    }

    // ── Group / Ungroup ───────────────────────────────────────────────
    function groupSelected() {
        if (!_canvas) return;
        var o = activeObj();
        if (!o || o.type !== 'activeSelection') return;
        var grp = o.toGroup();
        _canvas.setActiveObject(grp);
        _canvas.renderAll(); snapshotHistory();
    }
    function ungroupSelected() {
        if (!_canvas) return;
        var o = activeObj();
        if (!o || o.type !== 'group') return;
        var sel = o.toActiveSelection();
        _canvas.setActiveObject(sel);
        _canvas.renderAll(); snapshotHistory();
    }

    // ── Lock / Unlock ─────────────────────────────────────────────────
    function lockToggle() {
        var o = activeObj(); if (!o) return;
        var locked = !o.lockMovementX;
        o.set({
            lockMovementX: locked, lockMovementY: locked,
            lockScalingX: locked,  lockScalingY: locked,
            lockRotation: locked,  hasControls: !locked
        });
        _canvas.renderAll();
        var lockBtn = g('pm-lock');
        if (lockBtn) lockBtn.innerHTML = locked ? '🔒 ' + esc(t('Locked','已锁定','已鎖定')) : '🔒 ' + esc(t('Lock','锁定','鎖定'));
    }

    // ── Alignment ─────────────────────────────────────────────────────
    function alignObjects(dir) {
        if (!_canvas) return;
        var o = activeObj(); if (!o) return;
        var cw = _canvas._pmLogicalW * (_canvas._pmScale || 1);
        var ch = _canvas._pmLogicalH * (_canvas._pmScale || 1);

        function alignOne(obj) {
            var bnd = obj.getBoundingRect(true);
            if      (dir === 'left')     obj.set('left', 0);
            else if (dir === 'center-h') obj.set('left', (cw - bnd.width)  / 2);
            else if (dir === 'right')    obj.set('left', cw - bnd.width);
            else if (dir === 'top')      obj.set('top',  0);
            else if (dir === 'center-v') obj.set('top',  (ch - bnd.height) / 2);
            else if (dir === 'bottom')   obj.set('top',  ch - bnd.height);
            obj.setCoords();
        }

        if (o.type === 'activeSelection') {
            o.forEachObject(alignOne);
        } else { alignOne(o); }
        _canvas.renderAll(); snapshotHistory();
    }

    function distributeObjects(axis) {
        if (!_canvas) return;
        var o = activeObj();
        if (!o || o.type !== 'activeSelection') return;
        var objs = o.getObjects().slice().sort(function (a, b) {
            return axis === 'h' ? a.left - b.left : a.top - b.top;
        });
        if (objs.length < 3) return;
        var first = axis === 'h' ? objs[0].left  : objs[0].top;
        var last  = axis === 'h' ? objs[objs.length-1].left : objs[objs.length-1].top;
        var gap   = (last - first) / (objs.length - 1);
        objs.forEach(function (obj, i) {
            if (axis === 'h') obj.set('left', first + gap * i);
            else              obj.set('top',  first + gap * i);
            obj.setCoords();
        });
        _canvas.renderAll(); snapshotHistory();
    }

    // ── Multi-page ────────────────────────────────────────────────────
    function saveCurPage() {
        if (!_canvas) return;
        _pages[_pageIdx] = { json: JSON.stringify(_canvas.toJSON()), bg: _canvas.backgroundColor };
    }
    function loadPageAt(idx) {
        if (!_canvas) return;
        saveCurPage();
        _pageIdx = idx;
        var pg = _pages[idx];
        _pauseHistory = true;
        if (!pg) {
            _canvas.clear();
            _canvas.setBackgroundColor('#ffffff', function () { _canvas.renderAll(); _pauseHistory = false; });
        } else {
            _canvas.loadFromJSON(JSON.parse(pg.json), function () {
                _canvas.setBackgroundColor(pg.bg || '#ffffff', function () {
                    _canvas.renderAll(); _pauseHistory = false;
                });
            });
        }
        _history = []; _histPos = -1; snapshotHistory();
        updatePageStrip();
    }
    function addPage() {
        saveCurPage();
        _pages.push(null);
        _pageIdx = _pages.length - 1;
        _canvas.clear();
        _canvas.setBackgroundColor('#ffffff', function () { _canvas.renderAll(); });
        _history = []; _histPos = -1; snapshotHistory();
        updatePageStrip();
    }
    function deletePage(idx) {
        if (_pages.length <= 1) { return; }
        _pages.splice(idx, 1);
        if (_pageIdx >= _pages.length) _pageIdx = _pages.length - 1;
        loadPageAt(_pageIdx);
    }
    function updatePageStrip() {
        var thumbs = g('pm-page-thumbs');
        if (!thumbs) return;
        var html = '';
        for (var i = 0; i < _pages.length; i++) {
            var active = i === _pageIdx;
            html += '<div class="pm-page-thumb" data-pidx="' + i + '" style="' +
                'width:40px;height:52px;background:' + (active ? '#3b82f6' : '#334155') + ';' +
                'border:2px solid ' + (active ? '#60a5fa' : '#475569') + ';border-radius:4px;' +
                'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
                'cursor:pointer;flex-shrink:0;position:relative;">' +
                '<div style="width:28px;height:36px;background:#fff;border-radius:2px;margin-bottom:2px;"></div>' +
                '<div style="font-size:9px;color:' + (active ? '#fff' : '#94a3b8') + ';font-weight:700;">' + (i + 1) + '</div>' +
                (i > 0 ? '<div class="pm-del-page" data-pidx="' + i + '" style="position:absolute;top:-5px;right:-5px;' +
                    'width:14px;height:14px;background:#ef4444;border-radius:50%;color:#fff;font-size:9px;' +
                    'line-height:14px;text-align:center;cursor:pointer;">×</div>' : '') +
                '</div>';
        }
        thumbs.innerHTML = html;
        thumbs.querySelectorAll('.pm-page-thumb').forEach(function (el) {
            el.addEventListener('click', function (ev) {
                if (ev.target.classList.contains('pm-del-page')) return;
                var idx = parseInt(el.getAttribute('data-pidx'), 10);
                if (idx !== _pageIdx) loadPageAt(idx);
            });
        });
        thumbs.querySelectorAll('.pm-del-page').forEach(function (el) {
            el.addEventListener('click', function (ev) {
                ev.stopPropagation();
                deletePage(parseInt(el.getAttribute('data-pidx'), 10));
            });
        });
    }

    // ── Grid / Snap ───────────────────────────────────────────────────
    function drawGrid() {
        var gc = g('pm-grid-canvas');
        if (!gc || !_canvas) return;
        gc.style.display = _snapGrid ? '' : 'none';
        if (!_snapGrid) return;
        var w = _canvas.getWidth(), h = _canvas.getHeight();
        gc.width = w; gc.height = h;
        var ctx2 = gc.getContext('2d');
        ctx2.clearRect(0, 0, w, h);
        ctx2.strokeStyle = 'rgba(99,102,241,0.25)';
        ctx2.lineWidth = 0.5;
        var cell = _gridSize * (_canvas._pmScale || 1) * _pmZoom;
        for (var x2 = 0; x2 <= w; x2 += cell) { ctx2.beginPath(); ctx2.moveTo(x2, 0); ctx2.lineTo(x2, h); ctx2.stroke(); }
        for (var y2 = 0; y2 <= h; y2 += cell) { ctx2.beginPath(); ctx2.moveTo(0, y2); ctx2.lineTo(w, y2); ctx2.stroke(); }
    }
    function snapToGrid(opt) {
        if (!_snapGrid || !opt || !opt.target) return;
        var obj  = opt.target;
        var cell = _gridSize * (_canvas._pmScale || 1) * _pmZoom;
        obj.set({
            left: Math.round(obj.left / cell) * cell,
            top:  Math.round(obj.top  / cell) * cell
        });
    }

    // ── Contextual bar ────────────────────────────────────────────────
    function updateCtxBar() {
        var bar = g('pm-ctx-bar');
        if (!bar) return;
        var o = activeObj();
        if (!o) { bar.style.display = 'none'; return; }
        bar.style.display = 'flex';
        updateCtxBarPosition();
        // opacity
        var v = Math.round((o.opacity != null ? o.opacity : 1) * 100);
        var ctxOp = g('pm-ctx-opacity'); if (ctxOp) ctxOp.value = v;
        var ctxOpV = g('pm-ctx-opval'); if (ctxOpV) ctxOpV.textContent = v + '%';
        // lock button label
        var lockBtn = g('pm-lock');
        if (lockBtn) lockBtn.innerHTML = o.lockMovementX
            ? '🔒 ' + esc(t('Locked','已锁定','已鎖定'))
            : '🔒 ' + esc(t('Lock','锁定','鎖定'));
        // corner radius row
        var cornerRow = g('pm-corner-row');
        if (cornerRow) cornerRow.style.display = (o.type === 'rect') ? '' : 'none';
    }
    function updateCtxBarPosition() {
        var o = activeObj(); if (!o || !_canvas) return;
        _updatingCtx = true;
        var bnd = o.getBoundingRect(true);
        var xEl = g('pm-pos-x'), yEl = g('pm-pos-y'),
            wEl = g('pm-ctx-w'), hEl = g('pm-ctx-h');
        if (xEl) xEl.value = Math.round(bnd.left);
        if (yEl) yEl.value = Math.round(bnd.top);
        if (wEl) wEl.value = Math.round(bnd.width);
        if (hEl) hEl.value = Math.round(bnd.height);
        _updatingCtx = false;
    }
    function hideCtxBar() {
        var bar = g('pm-ctx-bar'); if (bar) bar.style.display = 'none';
    }

    // ── Google Fonts loader ───────────────────────────────────────────
    function loadGoogleFont(name) {
        if (!name || _gfLoaded[name]) return;
        _gfLoaded[name] = true;
        var link = document.createElement('link');
        link.rel  = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=' +
            encodeURIComponent(name) + ':wght@300;400;500;600;700;900&display=swap';
        document.head.appendChild(link);
    }

    // ── Drawing tools ─────────────────────────────────────────────────
    function hexToRgba(hex, alpha) {
        var r = parseInt(hex.slice(1,3),16), g2 = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return 'rgba(' + r + ',' + g2 + ',' + b + ',' + (alpha != null ? alpha : 1) + ')';
    }

    function setDrawTool(tool, fabric) {
        if (!_canvas) return;
        if (tool === 'select') {
            _canvas.isDrawingMode = false;
            _canvas.selection = true;
            _canvas.defaultCursor = 'default';
            return;
        }
        // Eraser: white pencil brush matching background colour
        if (tool === 'eraser') {
            _canvas.isDrawingMode = true;
            _canvas.selection = false;
            var bg = (_canvas.backgroundColor && _canvas.backgroundColor !== '') ? _canvas.backgroundColor : '#ffffff';
            var brush = new fabric.PencilBrush(_canvas);
            brush.color  = bg;
            brush.width  = _drawSize * 2.5; // eraser wider for usability
            _canvas.freeDrawingBrush = brush;
            _canvas.defaultCursor = 'cell';
            return;
        }
        _canvas.isDrawingMode = true;
        _canvas.selection = false;
        var col = (_drawOpacity < 1 && tool === 'marker')
            ? hexToRgba(_drawColor, _drawOpacity)
            : _drawColor;

        var brush;
        switch (tool) {
            case 'spray':
                brush = new fabric.SprayBrush(_canvas);
                brush.color      = col;
                brush.width      = _drawSize * 3;
                brush.density    = 20;
                brush.dotWidth   = Math.max(1, _drawSize / 4);
                break;
            case 'circle':
                brush = new fabric.CircleBrush(_canvas);
                brush.color  = col;
                brush.width  = _drawSize;
                break;
            case 'marker':
                brush = new fabric.PencilBrush(_canvas);
                brush.color          = hexToRgba(_drawColor, _drawOpacity);
                brush.width          = _drawSize * 3;
                brush.strokeLineCap  = 'square';
                brush.strokeLineJoin = 'miter';
                break;
            case 'pen':
                brush = new fabric.PencilBrush(_canvas);
                brush.color         = col;
                brush.width         = Math.max(1, _drawSize / 2);
                brush.strokeLineCap = 'round';
                break;
            case 'calli':
                brush = new fabric.PencilBrush(_canvas);
                brush.color         = col;
                brush.width         = _drawSize * 1.8;
                brush.strokeLineCap = 'butt';
                brush.decimate      = 2;
                break;
            default: // pencil
                brush = new fabric.PencilBrush(_canvas);
                brush.color         = col;
                brush.width         = _drawSize;
                brush.strokeLineCap = 'round';
                break;
        }
        _canvas.freeDrawingBrush = brush;
        _canvas.defaultCursor = 'crosshair';
    }

    // ── Background colour helper ──────────────────────────────────────
    function setBgInput(color) {
        var bgEl = g('pm-bg'); if (bgEl) bgEl.value = color || '#ffffff';
    }

    function setTxtProp(prop, value) {
        var o = activeObj();
        if (!o || (o.type !== 'i-text' && o.type !== 'text')) return;
        o.set(prop, value);
        if (_canvas) _canvas.renderAll();
    }
    function toggleTxtStyle(prop, on, off) {
        var o = activeObj();
        if (!o || (o.type !== 'i-text' && o.type !== 'text')) return;
        o.set(prop, o[prop] === on ? off : on);
        if (_canvas) _canvas.renderAll();
    }
    function setShapeProp(prop, value) {
        var o = activeObj();
        if (!o) return;
        o.set(prop, value);
        if (_canvas) _canvas.renderAll();
    }

    // ── Properties panel ─────────────────────────────────────────
    function updatePropsPanel() {
        var panel      = g('pm-props');
        var textProps  = g('pm-text-props');
        var shapeProps = g('pm-shape-props');
        if (!panel) return;
        var o = activeObj();
        if (!o) { panel.style.display = 'none'; return; }
        panel.style.display = '';

        var isText  = (o.type === 'i-text' || o.type === 'text');
        var isShape = !isText; // show shape panel for everything else (rect, circle, path, group, image…)

        if (textProps)  textProps.style.display  = isText  ? '' : 'none';
        if (shapeProps) shapeProps.style.display = isShape ? '' : 'none';

        function sv(id, val) { var e = g(id); if (e) e.value = val; }
        function sc(id, v)   { var e = g(id); if (e) e.checked = v; }
        function st(id, txt) { var e = g(id); if (e) e.textContent = txt; }

        var opPct = Math.round((o.opacity != null ? o.opacity : 1) * 100);

        if (isText) {
            // Font picker display
            var fontName = o.fontFamily || 'Arial';
            var fdn = g('pm-font-display-name');
            if (fdn) { fdn.textContent = fontName; fdn.style.fontFamily = "'" + fontName + "',sans-serif"; }
            if (!FONT_GROUPS[0].fonts.includes(fontName)) loadGoogleFont(fontName);

            sv('pm-fontsize',      Math.round(o.fontSize || 30));
            sv('pm-fontcolor',     toHex(o.fill) || '#1a1a1a');
            sv('pm-txt-bgcolor',   toHex(o.textBackgroundColor) || '#ffff00');

            // Weight pills
            var curWt = String(o.fontWeight || '400');
            document.querySelectorAll('#pm-weight-row .pm-wt-btn').forEach(function (b) {
                var on = b.getAttribute('data-wt') === curWt || (curWt === 'bold' && b.getAttribute('data-wt') === '700');
                b.style.background  = on ? '#0f172a' : '#f8fafc';
                b.style.color       = on ? '#fff'    : '#374151';
                b.style.borderColor = on ? '#0f172a' : '#e5e7eb';
            });

            // Style buttons active state
            function markStyle(id, on) {
                var b = g(id); if (!b) return;
                b.style.background  = on ? '#0f172a' : '';
                b.style.color       = on ? '#fff'    : '';
                b.style.borderColor = on ? '#0f172a' : '';
            }
            markStyle('pm-bold',      o.fontWeight === 'bold' || Number(o.fontWeight) >= 700);
            markStyle('pm-italic',    o.fontStyle === 'italic');
            markStyle('pm-underline', !!o.underline);
            markStyle('pm-strike',    !!o.linethrough);

            // Letter spacing (slider + label)
            var ls = (o.charSpacing || 0) / 10;
            sv('pm-letterspacing', ls);
            st('pm-ls-val', ls);

            // Line height (slider + label)
            var lh = (o.lineHeight || 1.2).toFixed(2);
            sv('pm-lineheight', lh);
            st('pm-lh-val', lh);

            // Opacity
            sv('pm-txt-opacity', opPct);
            st('pm-txt-opval',   opPct + '%');

            // Text outline
            sv('pm-txt-stroke-color', toHex(o.stroke) || '#000000');
            var sw = o.strokeWidth || 0;
            sv('pm-txt-strokew', sw);
            st('pm-txt-strokew-val', sw);

            // Text shadow
            var hasTxtShd = !!(o.shadow);
            sc('pm-txt-shadow', hasTxtShd);
            var shdRow2 = g('pm-txt-shadow-row');
            if (shdRow2) shdRow2.style.display = hasTxtShd ? 'flex' : 'none';
            if (hasTxtShd && o.shadow) {
                sv('pm-txt-shadow-color', toHex(o.shadow.color) || '#000000');
                sv('pm-txt-shadow-blur',  o.shadow.blur    || 4);
                sv('pm-txt-shadow-x',     o.shadow.offsetX || 2);
                sv('pm-txt-shadow-y',     o.shadow.offsetY || 2);
            }
        }
        if (isShape) {
            sv('pm-fill',      toHex(o.fill)   || '#4f46e5');
            sv('pm-stroke',    toHex(o.stroke) || '#000000');
            sv('pm-strokew',   o.strokeWidth   || 0);
            sv('pm-opacity',   opPct);
            st('pm-opacity-val', opPct);
            // dash
            var dash = o.strokeDashArray;
            sv('pm-strokedash', !dash ? 'solid' : (dash[0] <= 2 ? 'dot' : 'dash'));
            // corner radius (rect only)
            var crRow = g('pm-corner-row');
            if (crRow) crRow.style.display = (o.type === 'rect') ? '' : 'none';
            if (o.type === 'rect') sv('pm-corner', o.rx || 0);
            // shadow
            var hasShd = !!(o.shadow);
            sc('pm-shape-shadow', hasShd);
            var shRow = g('pm-shape-shadow-row');
            if (shRow) shRow.style.display = hasShd ? 'flex' : 'none';
            if (hasShd && o.shadow) {
                sv('pm-shd-color', toHex(o.shadow.color) || '#000000');
                sv('pm-shd-blur',  o.shadow.blur  || 8);
                sv('pm-shd-x',     o.shadow.offsetX || 4);
                sv('pm-shd-y',     o.shadow.offsetY || 4);
            }
        }
    }
    function hidePropsPanel() {
        var panel = g('pm-props');
        if (panel) panel.style.display = 'none';
    }
    function toHex(color) {
        if (!color || typeof color !== 'string') return '#000000';
        if (/^#[0-9a-f]{3,6}$/i.test(color)) return color;
        var m = color.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);
        if (!m) return '#000000';
        return '#' + [m[1], m[2], m[3]].map(function (n) {
            return ('0' + parseInt(n).toString(16)).slice(-2);
        }).join('');
    }

    // ── Clear canvas ──────────────────────────────────────────────
    function clearAll() {
        if (!_canvas) return;
        if (!confirm(t('Clear all elements?', '清除所有元素？', '清除所有元素？'))) return;
        _canvas.clear();
        _canvas.setBackgroundColor('#ffffff', function () { _canvas.renderAll(); });
        var bgEl = g('pm-bg'); if (bgEl) bgEl.value = '#ffffff';
        snapshotHistory();
    }

    // ── Templates ─────────────────────────────────────────────────
    function clinicName() {
        var name = '';
        try {
            if (typeof APP_CLINICS !== 'undefined' && APP_CLINICS && APP_CLINICS.length) {
                var clinic = APP_CLINICS.find(function (c) {
                    return String(c.id) === String(
                        typeof currentClinicId !== 'undefined' ? currentClinicId : ''
                    );
                }) || APP_CLINICS[0];
                name = (clinic && (clinic.name || clinic.clinic_name)) || '';
            }
        } catch (e) {}
        return name || t('Your Clinic', '诊所名称', '診所名稱');
    }

    // ════════════════════════════════════════════════════════════════
    //  SUPABASE API-KEY SYNC
    //  Table:  public.app_config  (key TEXT PK, value TEXT, updated_at TIMESTAMPTZ)
    //  RLS:    SELECT → public (anon + authenticated)
    //          INSERT/UPDATE/DELETE → authenticated only
    // ════════════════════════════════════════════════════════════════

    var _pmKeysFetched = false;   // fetch only once per session

    // Fetch Unsplash + Pexels keys from Supabase and cache in localStorage.
    // Called silently when the poster maker opens — works for any browser.
    function pmFetchApiKeysFromSupabase() {
        if (_pmKeysFetched) return Promise.resolve();
        if (typeof SB === 'undefined') return Promise.resolve();
        return SB.from('app_config')
            .select('key, value')
            .in('key', ['unsplash_api_key', 'pexels_api_key'])
            .then(function (result) {
                _pmKeysFetched = true;
                if (result.error || !result.data) return;
                result.data.forEach(function (row) {
                    if (!row.value) return;
                    if (row.key === 'unsplash_api_key') localStorage.setItem('pm_unsplash_key', row.value);
                    if (row.key === 'pexels_api_key')   localStorage.setItem('pm_pexels_key',   row.value);
                });
                var ukEl = g('pm-ol-ukey'), pkEl = g('pm-ol-pkey');
                if (ukEl) ukEl.value = localStorage.getItem('pm_unsplash_key') || '';
                if (pkEl) pkEl.value = localStorage.getItem('pm_pexels_key')   || '';
            })
            .catch(function () { /* silently ignore */ });
    }

    // Upsert keys to Supabase.  Returns { ok: bool, error: string|null }.
    // Requires the app_config table to exist with an open-write RLS policy
    // (run pmGenerateSetupSql() to get the SQL).
    function pmSaveApiKeysToSupabase(unsplashKey, pexelsKey) {
        if (typeof SB === 'undefined') return Promise.resolve({ ok: false, error: 'Supabase SDK not loaded' });
        var ts   = new Date().toISOString();
        var rows = [
            { key: 'unsplash_api_key', value: unsplashKey || '', updated_at: ts },
            { key: 'pexels_api_key',   value: pexelsKey   || '', updated_at: ts }
        ];
        return SB.from('app_config')
            .upsert(rows, { onConflict: 'key' })
            .then(function (result) {
                if (result.error) {
                    var code = result.error.code || '';
                    var msg  = result.error.message || 'Unknown Supabase error';
                    var hint = '';
                    if (code === '42P01') hint = ' (Table does not exist — run the Setup SQL first)';
                    else if (code === '42501') hint = ' (Permission denied — run the Setup SQL to fix RLS policy)';
                    console.warn('pmSaveApiKeysToSupabase:', msg, result.error);
                    return { ok: false, error: msg + hint };
                }
                _pmKeysFetched = false;
                return { ok: true, error: null };
            })
            .catch(function (err) {
                var msg = (err && err.message) ? err.message : String(err);
                console.warn('pmSaveApiKeysToSupabase exception:', msg);
                return { ok: false, error: msg };
            });
    }

    // Generate the complete one-time setup SQL for the Supabase SQL Editor.
    // Embeds the actual key values if provided so the admin can run it in one shot.
    function pmGenerateSetupSql(unsplashKey, pexelsKey) {
        var uSafe = (unsplashKey || 'PASTE_UNSPLASH_KEY_HERE').replace(/'/g, "''");
        var pSafe = (pexelsKey   || 'PASTE_PEXELS_KEY_HERE').replace(/'/g, "''");
        return [
            '-- ═══════════════════════════════════════════════════════',
            '-- Clinic Poster Maker — Supabase API Key Setup',
            '-- Paste and run this in: Supabase Dashboard → SQL Editor',
            '-- ═══════════════════════════════════════════════════════',
            '',
            '-- 1. Create config table',
            'CREATE TABLE IF NOT EXISTS public.app_config (',
            '    key         TEXT PRIMARY KEY,',
            '    value       TEXT,',
            '    updated_at  TIMESTAMPTZ DEFAULT NOW()',
            ');',
            '',
            '-- 2. Enable Row Level Security',
            'ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;',
            '',
            '-- 3. Allow anyone to read (so new browsers auto-fetch keys)',
            'DO $$ BEGIN',
            '  IF NOT EXISTS (',
            '    SELECT 1 FROM pg_policies',
            '    WHERE tablename=\'app_config\' AND policyname=\'app_config_public_read\'',
            '  ) THEN',
            '    CREATE POLICY "app_config_public_read"',
            '      ON public.app_config FOR SELECT USING (true);',
            '  END IF;',
            'END $$;',
            '',
            '-- 4. Allow anyone to write the photo API keys',
            '--    (these are non-personal keys; risk is minimal)',
            'DO $$ BEGIN',
            '  IF NOT EXISTS (',
            '    SELECT 1 FROM pg_policies',
            '    WHERE tablename=\'app_config\' AND policyname=\'app_config_public_write\'',
            '  ) THEN',
            '    CREATE POLICY "app_config_public_write"',
            '      ON public.app_config FOR ALL USING (true) WITH CHECK (true);',
            '  END IF;',
            'END $$;',
            '',
            '-- 5. Insert / update the API keys',
            'INSERT INTO public.app_config (key, value, updated_at) VALUES',
            '  (\'unsplash_api_key\', \'' + uSafe + '\', NOW()),',
            '  (\'pexels_api_key\',   \'' + pSafe + '\', NOW())',
            'ON CONFLICT (key) DO UPDATE',
            '  SET value = EXCLUDED.value, updated_at = NOW();',
            '',
            '-- Done! All users will now receive these keys automatically.'
        ].join('\n');
    }

    // Update the status badge inside the API key modal.
    function pmRefreshKeyModalStatus() {
        var el = g('pm-ol-key-sb-status');
        if (!el) return;
        if (typeof SB === 'undefined') {
            el.style.color = '#f87171';
            el.textContent = '⚠️ Supabase SDK not available';
            return;
        }
        el.style.color = '#94a3b8';
        el.textContent = '⏳ ' + t('Checking Supabase…','检查Supabase中…','檢查Supabase中…');
        SB.from('app_config')
            .select('key, updated_at')
            .in('key', ['unsplash_api_key', 'pexels_api_key'])
            .then(function (result) {
                if (result.error) {
                    var code = result.error.code || '';
                    el.style.color = '#f87171';
                    if (code === '42P01') {
                        el.textContent = '❌ ' +
                            t('Table not set up yet. Click "Copy Setup SQL", paste it in Supabase SQL Editor and run it.',
                              '表尚未创建。点击"复制安装SQL"，粘贴到Supabase SQL编辑器并运行。',
                              '資料表尚未建立。點擊「複製安裝SQL」，貼到Supabase SQL編輯器並執行。');
                    } else {
                        el.textContent = '❌ ' + (result.error.message || 'Supabase error');
                    }
                    return;
                }
                var rows = result.data || [];
                if (rows.length === 0) {
                    el.style.color = '#f59e0b';
                    el.textContent = '⚠️ ' +
                        t('Table exists but no keys yet. Enter keys and click "Save to Supabase" or "Copy Setup SQL".',
                          '表已存在但尚无密钥。请输入密钥后点击"保存到Supabase"或"复制安装SQL"。',
                          '資料表已存在但尚無密鑰。請輸入密鑰後點擊「儲存到Supabase」或「複製安裝SQL」。');
                } else {
                    var latest = rows.reduce(function (acc, r) {
                        return r.updated_at > acc ? r.updated_at : acc;
                    }, '');
                    var d = latest ? new Date(latest).toLocaleString() : '';
                    el.style.color = '#86efac';
                    el.textContent = '✅ ' + rows.length + '/2 ' +
                        t('keys in Supabase','个密钥已存入Supabase','個密鑰已存入Supabase') +
                        (d ? ' · ' + d : '');
                }
            })
            .catch(function (err) {
                el.style.color = '#f87171';
                el.textContent = '❌ ' + t('Cannot reach Supabase.','无法连接Supabase。','無法連線Supabase。');
            });
    }

    // ════════════════════════════════════════════════════════════════
    //  PROJECT FILE — Save & Open (.postermkr)
    // ════════════════════════════════════════════════════════════════

    var PM_FILE_VERSION = '2';
    var PM_FILE_EXT     = 'postermkr';

    function doSaveProject() {
        if (!_canvas) return;
        // Flush current page state before serialising
        saveCurPage();

        var project = {
            version:       PM_FILE_VERSION,
            app:           'ClinPosterMkr',
            savedAt:       new Date().toISOString(),
            size:          _size,
            pmLang:        _pmLang || null,
            activePageIdx: _pageIdx,
            pages:         _pages.map(function (pg) {
                if (!pg) return null;
                return { json: pg.json, bg: pg.bg || '#ffffff' };
            })
        };

        var blob = new Blob([JSON.stringify(project, null, 2)],
                            { type: 'application/json' });
        var ts   = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        dlBlob(blob, 'clinic-poster-' + ts + '.' + PM_FILE_EXT);
    }

    function doOpenProject(file, fabric) {
        var reader = new FileReader();
        reader.onload = function (e) {
            var raw = e.target.result;
            var project;
            try {
                project = JSON.parse(raw);
            } catch (err) {
                alert(t('Cannot read file — invalid format.',
                        '无法读取文件 — 格式无效。',
                        '無法讀取檔案 — 格式無效。'));
                return;
            }
            if (!project || project.app !== 'ClinPosterMkr') {
                if (!confirm(t('This file was not created by the Poster Maker. Try to open anyway?',
                               '此文件并非由海报制作工具创建，仍要尝试打开吗？',
                               '此檔案並非由海報製作工具建立，仍要嘗試開啟嗎？'))) return;
            }

            // ── Restore size ─────────────────────────────────────
            if (project.size && SIZES[project.size]) {
                _size = project.size;
                var sizeEl = g('pm-size');
                if (sizeEl) sizeEl.value = _size;
                // Resize the canvas to match the saved size
                var S = SIZES[_size];
                var wrap = g('pm-canvas-wrap');
                if (_canvas && wrap) {
                    var scale = _canvas._pmScale || 1;
                    _canvas.setWidth(Math.round(S.w * scale));
                    _canvas.setHeight(Math.round(S.h * scale));
                    _canvas._pmLogicalW = S.w;
                    _canvas._pmLogicalH = S.h;
                    wrap.style.width  = _canvas.getWidth()  + 'px';
                    wrap.style.height = _canvas.getHeight() + 'px';
                    var gridC = g('pm-grid-canvas');
                    if (gridC) { gridC.width = _canvas.getWidth(); gridC.height = _canvas.getHeight(); }
                }
            }

            // ── Restore template language override ────────────────
            if (typeof project.pmLang !== 'undefined') {
                _pmLang = project.pmLang || null;
                // Update language toggle buttons
                document.querySelectorAll('.pm-lang-btn').forEach(function (b) {
                    var val    = b.dataset.pmlang;
                    var active = (val === (_pmLang || ''));
                    b.style.background = active ? '#3b82f6' : '#f1f5f9';
                    b.style.color      = active ? '#fff'    : '#374151';
                });
            }

            // ── Restore pages ─────────────────────────────────────
            _pages   = (project.pages || [null]).map(function (pg) { return pg || null; });
            _pageIdx = Math.min(project.activePageIdx || 0, _pages.length - 1);
            if (_pages.length === 0) _pages = [null];

            // ── Load the active page onto the canvas ──────────────
            _pauseHistory = true;
            var activePg = _pages[_pageIdx];
            if (!activePg) {
                _canvas.clear();
                _canvas.setBackgroundColor('#ffffff', function () {
                    _canvas.renderAll();
                    _pauseHistory = false;
                    _history = []; _histPos = -1; snapshotHistory();
                    updatePageStrip();
                    drawGrid();
                });
            } else {
                _canvas.loadFromJSON(JSON.parse(activePg.json), function () {
                    _canvas.setBackgroundColor(activePg.bg || '#ffffff', function () {
                        _canvas.renderAll();
                        _pauseHistory = false;
                        _history = []; _histPos = -1; snapshotHistory();
                        updatePageStrip();
                        drawGrid();
                        setBgInput(activePg.bg || '#ffffff');
                    });
                });
            }
        };
        reader.onerror = function () {
            alert(t('Failed to read file.','读取文件失败。','讀取檔案失敗。'));
        };
        reader.readAsText(file);
    }

    // ════════════════════════════════════════════════════════════════
    //  ONLINE LIBRARY — Photo / Icon / Import helpers
    // ════════════════════════════════════════════════════════════════

    // ── Photo rendering helper ────────────────────────────────────
    function olRenderPhotoResults(photos) {
        var resEl = g('pm-ol-photo-res');
        var credEl = g('pm-ol-photo-credit');
        if (!resEl) return;
        if (!photos || photos.length === 0) {
            resEl.innerHTML = '<div style="grid-column:1/-1;font-size:9px;color:#ef4444;text-align:center;padding:8px;">' +
                esc(t('No results. Check API key.','无结果，请检查API密钥。','無結果，請檢查API密鑰。')) + '</div>';
            return;
        }
        resEl.innerHTML = '';
        if (credEl) credEl.style.display = 'block';
        photos.forEach(function (ph) {
            var thumb = ph.thumb, full = ph.full, credit = ph.credit || '';
            var wrap = document.createElement('div');
            wrap.style.cssText = 'position:relative;border-radius:4px;overflow:hidden;cursor:pointer;' +
                'border:1px solid #334155;background:#1e293b;';
            wrap.innerHTML = '<img src="' + esc(thumb) + '" style="width:100%;height:56px;object-fit:cover;display:block;" ' +
                'crossorigin="anonymous" onerror="this.style.display=\'none\';">' +
                '<div style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.7);' +
                'flex-direction:column;align-items:center;justify-content:center;gap:3px;" class="pm-ol-ph-over">' +
                    '<button class="pm-ol-ph-bg" style="font-size:8px;padding:2px 5px;background:#3b82f6;' +
                        'color:#fff;border:none;border-radius:3px;cursor:pointer;white-space:nowrap;">' +
                        esc(t('Set BG','设为背景','設為背景')) + '</button>' +
                    '<button class="pm-ol-ph-add" style="font-size:8px;padding:2px 5px;background:#0d9488;' +
                        'color:#fff;border:none;border-radius:3px;cursor:pointer;white-space:nowrap;">' +
                        esc(t('Add','添加','添加')) + '</button>' +
                '</div>';
            wrap.addEventListener('mouseenter', function () {
                wrap.querySelector('.pm-ol-ph-over').style.display = 'flex';
            });
            wrap.addEventListener('mouseleave', function () {
                wrap.querySelector('.pm-ol-ph-over').style.display = 'none';
            });
            wrap.querySelector('.pm-ol-ph-bg').addEventListener('click', function (e) {
                e.stopPropagation();
                olAddPhoto(full, true);
            });
            wrap.querySelector('.pm-ol-ph-add').addEventListener('click', function (e) {
                e.stopPropagation();
                olAddPhoto(full, false);
            });
            if (credit) wrap.title = 'Photo by ' + credit;
            resEl.appendChild(wrap);
        });
    }

    // ── Add photo to canvas ───────────────────────────────────────
    function olAddPhoto(url, asBackground) {
        if (!_canvas || !_fabric) return;
        var fab = _fabric;
        fab.Image.fromURL(url, function (img) {
            if (!img) { alert(t('Could not load image.','无法加载图片。','無法載入圖片。')); return; }
            if (asBackground) {
                var W = _canvas.getWidth(), H = _canvas.getHeight();
                img.scaleX = W / img.width;
                img.scaleY = H / img.height;
                img.set({ left: 0, top: 0, selectable: false, evented: false });
                _canvas.insertAt(img, 0);
            } else {
                var W2 = _canvas.getWidth();
                img.scaleToWidth(Math.min(W2 * 0.55, img.width));
                img.set({ left: W2 * 0.2, top: _canvas.getHeight() * 0.2 });
                _canvas.add(img);
                _canvas.setActiveObject(img);
            }
            _canvas.renderAll();
            snapshotHistory();
        }, { crossOrigin: 'anonymous' });
    }

    // ── Unsplash search ───────────────────────────────────────────
    function olSearchUnsplash(query) {
        var key = localStorage.getItem('pm_unsplash_key') || '';
        if (!key) {
            var resEl = g('pm-ol-photo-res');
            if (resEl) resEl.innerHTML = '<div style="grid-column:1/-1;font-size:9px;color:#f59e0b;' +
                'text-align:center;padding:8px;line-height:1.6;">' +
                '⚠️ ' + esc(t('Unsplash API key required. Click ⚙️ above to add your free key from unsplash.com/developers',
                              'Unsplash API密钥缺失。点击上方⚙️添加从unsplash.com/developers获取的免费密钥。',
                              'Unsplash API密鑰缺失。點擊上方⚙️添加從unsplash.com/developers獲取的免費密鑰。')) +
                '</div>';
            return;
        }
        var url = 'https://api.unsplash.com/search/photos?query=' + encodeURIComponent(query) +
                  '&per_page=12&orientation=portrait&client_id=' + encodeURIComponent(key);
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.errors) { throw new Error(data.errors.join(', ')); }
                var photos = (data.results || []).map(function (p) {
                    return {
                        thumb: p.urls.thumb,
                        full:  p.urls.regular,
                        credit: p.user ? p.user.name : ''
                    };
                });
                olRenderPhotoResults(photos);
            })
            .catch(function (err) {
                var resEl = g('pm-ol-photo-res');
                if (resEl) resEl.innerHTML = '<div style="grid-column:1/-1;font-size:9px;color:#ef4444;' +
                    'text-align:center;padding:8px;">' + esc('Error: ' + err.message) + '</div>';
            });
    }

    // ── Pexels search ─────────────────────────────────────────────
    function olSearchPexels(query) {
        var key = localStorage.getItem('pm_pexels_key') || '';
        if (!key) {
            var resEl = g('pm-ol-photo-res');
            if (resEl) resEl.innerHTML = '<div style="grid-column:1/-1;font-size:9px;color:#f59e0b;' +
                'text-align:center;padding:8px;line-height:1.6;">' +
                '⚠️ ' + esc(t('Pexels API key required. Click ⚙️ above to add your free key from pexels.com/api',
                              'Pexels API密钥缺失。点击上方⚙️添加从pexels.com/api获取的免费密钥。',
                              'Pexels API密鑰缺失。點擊上方⚙️添加從pexels.com/api獲取的免費密鑰。')) +
                '</div>';
            return;
        }
        var url = 'https://api.pexels.com/v1/search?query=' + encodeURIComponent(query) + '&per_page=12&orientation=portrait';
        fetch(url, { headers: { Authorization: key } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var photos = (data.photos || []).map(function (p) {
                    return {
                        thumb: p.src.tiny,
                        full:  p.src.large,
                        credit: p.photographer || ''
                    };
                });
                olRenderPhotoResults(photos);
            })
            .catch(function (err) {
                var resEl = g('pm-ol-photo-res');
                if (resEl) resEl.innerHTML = '<div style="grid-column:1/-1;font-size:9px;color:#ef4444;' +
                    'text-align:center;padding:8px;">' + esc('Error: ' + err.message) + '</div>';
            });
    }

    // ── Openverse search (no API key required) ────────────────────
    function olSearchOpenverse(query) {
        var url = 'https://api.openverse.org/v1/images/' +
                  '?q=' + encodeURIComponent(query) +
                  '&page_size=12' +
                  '&license_type=commercial,modification' +  // commercial-friendly CC licences
                  '&mature=false';
        var resEl   = g('pm-ol-photo-res');
        var credEl  = g('pm-ol-photo-credit');
        fetch(url, { headers: { 'Accept': 'application/json' } })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                var results = data.results || [];
                if (!results.length) {
                    if (resEl) resEl.innerHTML =
                        '<div style="grid-column:1/-1;font-size:9px;color:#94a3b8;text-align:center;padding:8px;">' +
                        esc(t('No results found. Try another keyword.',
                              '未找到结果，请尝试其他关键词。',
                              '未找到結果，請嘗試其他關鍵字。')) + '</div>';
                    return;
                }
                var photos = results.map(function (item) {
                    return {
                        thumb:  item.thumbnail || item.url,
                        full:   item.url,
                        credit: (item.creator || '') + (item.license ? ' · ' + item.license.toUpperCase() : ''),
                        attrUrl: item.foreign_landing_url || item.url
                    };
                });
                olRenderPhotoResults(photos);
                if (credEl) {
                    credEl.style.display = 'block';
                    credEl.textContent = t('Openverse · CC-licensed · Free to use',
                                           'Openverse · CC授权 · 免费使用',
                                           'Openverse · CC授權 · 免費使用');
                }
            })
            .catch(function (err) {
                if (resEl) resEl.innerHTML =
                    '<div style="grid-column:1/-1;font-size:9px;color:#ef4444;text-align:center;padding:8px;">' +
                    esc('Openverse error: ' + err.message) + '</div>';
            });
    }

    // ── Dispatcher ────────────────────────────────────────────────
    function olSearchPhotos(query) {
        if      (_olPhotoSrc === 'pexels')     { olSearchPexels(query); }
        else if (_olPhotoSrc === 'unsplash')   { olSearchUnsplash(query); }
        else                                   { olSearchOpenverse(query); }
    }

    // ── Iconify search (no API key) ───────────────────────────────
    function olSearchIcons(query) {
        var url = 'https://api.iconify.design/search?query=' + encodeURIComponent(query) + '&limit=32';
        var resEl = g('pm-ol-icon-res');
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var icons = data.icons || [];
                if (!icons.length) {
                    if (resEl) resEl.innerHTML = '<div style="grid-column:1/-1;font-size:9px;color:#94a3b8;' +
                        'text-align:center;padding:8px;">' + esc(t('No icons found.','未找到图标。','未找到圖標。')) + '</div>';
                    return;
                }
                if (resEl) resEl.innerHTML = '';
                icons.forEach(function (iconId) {
                    var parts  = iconId.split(':');
                    var prefix = parts[0], name = parts[1] || parts[0];
                    var svgUrl = 'https://api.iconify.design/' + encodeURIComponent(prefix) + '/' +
                                 encodeURIComponent(name) + '.svg';
                    var btn = document.createElement('button');
                    btn.title = iconId;
                    btn.style.cssText = 'width:38px;height:38px;padding:3px;background:#1e293b;' +
                        'border:1px solid #334155;border-radius:5px;cursor:pointer;overflow:hidden;' +
                        'display:flex;align-items:center;justify-content:center;transition:border-color 0.15s;';
                    btn.innerHTML = '<img src="' + esc(svgUrl) + '" width="26" height="26" ' +
                        'style="filter:invert(0.85);pointer-events:none;" onerror="this.style.display=\'none\';">';
                    btn.addEventListener('mouseenter', function () { btn.style.borderColor = '#64748b'; });
                    btn.addEventListener('mouseleave', function () { btn.style.borderColor = '#334155'; });
                    btn.addEventListener('click', function () { olAddIcon(svgUrl); });
                    if (resEl) resEl.appendChild(btn);
                });
            })
            .catch(function (err) {
                if (resEl) resEl.innerHTML = '<div style="grid-column:1/-1;font-size:9px;color:#ef4444;' +
                    'text-align:center;padding:8px;">' + esc('Error: ' + err.message) + '</div>';
            });
    }

    // ── Add SVG icon to canvas ────────────────────────────────────
    function olAddIcon(svgUrl) {
        if (!_canvas || !_fabric) return;
        var fab = _fabric;
        fetch(svgUrl)
            .then(function (r) { return r.text(); })
            .then(function (svgStr) {
                fab.loadSVGFromString(svgStr, function (objects, options) {
                    if (!objects || !objects.length) return;
                    var group = fab.util.groupSVGElements(objects, options);
                    var W = _canvas.getWidth(), H = _canvas.getHeight();
                    group.scaleToWidth(Math.min(sf(120), W * 0.35));
                    group.set({
                        left: W / 2, top: H / 2,
                        originX: 'center', originY: 'center'
                    });
                    _canvas.add(group);
                    _canvas.setActiveObject(group);
                    _canvas.renderAll();
                    snapshotHistory();
                });
            })
            .catch(function (err) {
                alert(t('Could not load icon: ','无法加载图标：','無法載入圖標：') + err.message);
            });
    }

    // ── Import template JSON from URL ─────────────────────────────
    function olImportFromUrl(url, fabric) {
        var goBtn = g('pm-ol-import-go');
        if (goBtn) goBtn.textContent = '⏳ ' + t('Loading…','载入中…','載入中…');
        fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (json) {
                olApplyTemplateJson(json, fabric);
                if (goBtn) goBtn.innerHTML = '📥 ' + esc(t('Load Template','载入模板','載入模板'));
            })
            .catch(function (err) {
                if (goBtn) goBtn.innerHTML = '📥 ' + esc(t('Load Template','载入模板','載入模板'));
                alert(t('Failed to load: ','加载失败：','載入失敗：') + err.message);
            });
    }

    // ── Apply Fabric.js JSON template to canvas ───────────────────
    function olApplyTemplateJson(json, fabric) {
        if (!_canvas) return;
        _pauseHistory = true;
        _canvas.loadFromJSON(json, function () {
            _canvas.renderAll();
            _pauseHistory = false;
            snapshotHistory();
        });
    }

    // ════════════════════════════════════════════════════════════════

    function applyTemplate(fabric, tpl) {
        if (!_canvas) return;
        _pauseHistory = true;
        _canvas.clear();
        var W = _canvas.getWidth(), H = _canvas.getHeight();
        var cn = clinicName();

        // ── Shared builder helpers ───────────────────────────────
        function add(o) { _canvas.add(o); }
        function txt(str, opts) {
            return new fabric.IText(str, Object.assign({ fontFamily: 'Arial', editable: true }, opts));
        }
        function rect(opts)  { return new fabric.Rect(opts); }
        function circle(opts) { return new fabric.Circle(opts); }
        function line(x1, y1, x2, y2, opts) { return new fabric.Line([x1, y1, x2, y2], opts); }

        // Full-width header bar
        function header(fillColor, heightFrac) {
            add(rect({ left: 0, top: 0, width: W, height: Math.round(H * (heightFrac || 0.18)),
                fill: fillColor, selectable: false, evented: false }));
        }
        // Full-width footer bar
        function footer(fillColor, heightFrac) {
            var fh = Math.round(H * (heightFrac || 0.10));
            add(rect({ left: 0, top: H - fh, width: W, height: fh,
                fill: fillColor, selectable: false, evented: false }));
        }
        // Clinic name in header
        function cnHeader(color, yFrac, sizePt) {
            add(txt(cn, { left: W / 2, top: Math.round(H * yFrac),
                fontSize: sf(sizePt || 24), fill: color || '#ffffff',
                fontWeight: 'bold', originX: 'center', originY: 'center' }));
        }
        // Centred divider line
        function divider(yFrac, color) {
            add(line(Math.round(W * 0.08), Math.round(H * yFrac), Math.round(W * 0.92), Math.round(H * yFrac),
                { stroke: color || '#e2e8f0', strokeWidth: sf(2), selectable: false, evented: false }));
        }
        // Big centred title
        function bigTitle(label, yFrac, color, sizePt) {
            add(txt(label, { left: W / 2, top: Math.round(H * yFrac),
                fontSize: sf(sizePt || 32), fill: color || '#0f172a',
                fontWeight: 'bold', originX: 'center', originY: 'center' }));
        }
        // Centred body text
        function body(label, yFrac, color, sizePt) {
            add(txt(label, { left: W / 2, top: Math.round(H * yFrac),
                fontSize: sf(sizePt || 16), fill: color || '#334155',
                textAlign: 'center', originX: 'center' }));
        }
        // Left-aligned field row
        function field(label, yFrac, color, sizePt) {
            add(txt(label, { left: Math.round(W * 0.1), top: Math.round(H * yFrac),
                fontSize: sf(sizePt || 17), fill: color || '#0f172a' }));
        }
        // Accent badge rectangle (centred)
        function badge(fillColor, yFrac, widthFrac, heightFrac) {
            var bw = Math.round(W * (widthFrac || 0.6)), bh = Math.round(H * (heightFrac || 0.08));
            add(rect({ left: (W - bw) / 2, top: Math.round(H * yFrac),
                width: bw, height: bh, fill: fillColor, rx: sf(10), ry: sf(10),
                selectable: false, evented: false }));
        }

        // ── Enhanced visual helpers (dental education & events) ──
        // Set background colour + sync the bg colour input
        function bgFill(color) {
            setBgInput(color);
            _canvas.setBackgroundColor(color, function () { _canvas.renderAll(); });
        }
        // Left vertical accent bar
        function sideBar(color, widthFrac) {
            var bw = Math.round(W * (widthFrac || 0.032));
            add(rect({ left: 0, top: 0, width: bw, height: H, fill: color,
                selectable: false, evented: false }));
        }
        // Decorative circle centred at (cx,cy) — great for corners / accents
        function blob(color, cx, cy, r, opacity) {
            add(circle({ left: cx - r, top: cy - r, radius: r, fill: color,
                opacity: (opacity == null ? 1 : opacity), selectable: false, evented: false }));
        }
        // Numbered step: filled circle + number + label line
        function stepRow(n, label, yFrac, circColor, textColor, sizePt) {
            var cr = sf(15);
            var cx = Math.round(W * 0.135);
            var cy = Math.round(H * yFrac);
            blob(circColor, cx, cy, cr, 1);
            add(txt(String(n), { left: cx, top: cy, fontSize: sf(15), fill: '#ffffff',
                fontWeight: 'bold', originX: 'center', originY: 'center',
                selectable: false, evented: false }));
            add(txt(label, { left: Math.round(W * 0.225), top: cy, fontSize: sf(sizePt || 14),
                fill: textColor || '#334155', originY: 'center' }));
        }
        // Centred pill chip with text (CTA / tagline)
        function chip(label, yFrac, fillColor, textColor, sizePt) {
            var tw = Math.max(Math.round(W * 0.42), label.length * sf(9) + sf(46));
            if (tw > W * 0.92) tw = Math.round(W * 0.92);
            var th = Math.round(H * 0.052);
            var top = Math.round(H * yFrac);
            add(rect({ left: (W - tw) / 2, top: top, width: tw, height: th,
                fill: fillColor, rx: th / 2, ry: th / 2, selectable: false, evented: false }));
            add(txt(label, { left: W / 2, top: top + th / 2, fontSize: sf(sizePt || 13),
                fill: textColor || '#ffffff', fontWeight: 'bold',
                originX: 'center', originY: 'center' }));
        }
        // Rounded info-card row: icon + label (for event date/time/venue)
        function infoRow(icon, label, yFrac, accent) {
            var rh = Math.round(H * 0.072);
            var top = Math.round(H * yFrac);
            add(rect({ left: Math.round(W * 0.08), top: top, width: Math.round(W * 0.84),
                height: rh, fill: '#ffffff', rx: sf(10), ry: sf(10),
                stroke: accent, strokeWidth: sf(1.5), selectable: false, evented: false }));
            add(rect({ left: Math.round(W * 0.08), top: top, width: sf(6), height: rh,
                fill: accent, rx: sf(3), ry: sf(3), selectable: false, evented: false }));
            add(txt(icon, { left: Math.round(W * 0.145), top: top + rh / 2, fontSize: sf(20),
                originX: 'center', originY: 'center', selectable: false, evented: false }));
            add(txt(label, { left: Math.round(W * 0.215), top: top + rh / 2, fontSize: sf(14),
                fill: '#0f172a', fontWeight: 'bold', originY: 'center' }));
        }
        // Eyebrow / banner label above a big title
        function eyebrow(label, yFrac, color, sizePt) {
            add(txt(label, { left: W / 2, top: Math.round(H * yFrac),
                fontSize: sf(sizePt || 14), fill: color, fontWeight: 'bold',
                charSpacing: 200, originX: 'center', originY: 'center',
                selectable: false, evented: false }));
        }

        // ════════════════════════════════════════════════════════
        //  GENERAL
        // ════════════════════════════════════════════════════════
        if (tpl === 'blank') {
            _canvas.setBackgroundColor('#ffffff', function () { _canvas.renderAll(); });
            setBgInput('#ffffff');
            _pauseHistory = false; snapshotHistory(); return;
        }

        if (tpl === 'info') {
            setBgInput('#f8fafc');
            _canvas.setBackgroundColor('#f8fafc', function () { _canvas.renderAll(); });
            header('#0f172a', 0.17); cnHeader('#f1f5f9', 0.085, 28);
            divider(0.21, '#cbd5e1');
            field('📞  ' + t('Tel: ___________', '电话：___________', '電話：___________'), 0.285, '#0f172a');
            field('📍  ' + t('Address:', '地址：', '地址：'), 0.375, '#0f172a');
            field(t('___________________________', '___________________________', '___________________________'), 0.435, '#475569', 15);
            field('🕐  ' + t('Opening Hours', '营业时间', '營業時間'), 0.520, '#1e40af', 20);
            field(t('Mon – Fri : 9:00 am – 6:00 pm', '周一至五：09:00 – 18:00', '週一至五：09:00 – 18:00'), 0.610, '#334155', 15);
            field(t('Saturday   : 9:00 am – 1:00 pm', '周六：09:00 – 13:00', '週六：09:00 – 13:00'), 0.665, '#334155', 15);
            field(t('Sun & PH  : Closed', '周日及公假：休息', '週日及公假：休息'), 0.720, '#dc2626', 15);
            footer('#0f172a', 0.07);
        }

        if (tpl === 'newdr') {
            setBgInput('#f0f9ff');
            _canvas.setBackgroundColor('#f0f9ff', function () { _canvas.renderAll(); });
            header('#0369a1', 0.18); cnHeader('#ffffff', 0.085, 24);
            add(circle({ left: W / 2 - sf(55), top: Math.round(H * 0.22),
                radius: sf(55), fill: '#e0f2fe', stroke: '#0ea5e9',
                strokeWidth: sf(3), selectable: false, evented: false }));
            add(txt('👨‍⚕️', { left: W / 2, top: Math.round(H * 0.295),
                fontSize: sf(44), originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Welcome', '欢迎加入', '歡迎加入'), 0.44, '#0369a1', 30);
            bigTitle(t('Our New Doctor', '我们的新医生', '我們的新醫生'), 0.515, '#0c4a6e', 26);
            divider(0.58, '#bae6fd');
            body(t('Dr. ___________________________', '医生姓名：___________________________', '醫生姓名：___________________________'), 0.635, '#0369a1', 18);
            body(t('Specialty: ___________________________', '专科：___________________________', '專科：___________________________'), 0.700, '#334155', 15);
            body(t('Now accepting new patients.\nBook your appointment today!',
                   '现正接受新病人预约，\n欢迎来电预约！',
                   '現正接受新病人預約，\n歡迎來電預約！'), 0.790, '#0369a1', 14);
        }

        if (tpl === 'newsvc') {
            setBgInput('#faf5ff');
            _canvas.setBackgroundColor('#faf5ff', function () { _canvas.renderAll(); });
            header('#7c3aed', 0.18); cnHeader('#ffffff', 0.085, 24);
            bigTitle('✨ ' + t('New Service', '全新服务', '全新服務'), 0.29, '#6d28d9', 32);
            divider(0.35, '#ddd6fe');
            body(t('We are pleased to announce:', '我们很高兴宣布：', '我們很高興宣布：'), 0.41, '#7c3aed', 15);
            badge('#7c3aed', 0.475, 0.70, 0.09);
            add(txt(t('___________________________', '___________________________', '___________________________'), {
                left: W / 2, top: Math.round(H * 0.520), fontSize: sf(20),
                fill: '#ffffff', fontWeight: 'bold', textAlign: 'center', originX: 'center' }));
            body(t('Available starting from ___________', '即日起提供此服务 ___________', '即日起提供此服務 ___________'), 0.62, '#334155', 14);
            body(t('For enquiries please call us or\nask at the reception desk.',
                   '如有查询，请致电或在接待处询问。',
                   '如有查詢，請致電或在接待處詢問。'), 0.735, '#6d28d9', 14);
            footer('#7c3aed', 0.07);
        }

        // ════════════════════════════════════════════════════════
        //  APPOINTMENTS
        // ════════════════════════════════════════════════════════
        if (tpl === 'appt') {
            setBgInput('#eff6ff');
            _canvas.setBackgroundColor('#eff6ff', function () { _canvas.renderAll(); });
            header('#1d4ed8', 0.20); cnHeader('#ffffff', 0.068, 26);
            add(txt(t('Appointment Reminder', '预约提醒', '預約提醒'), {
                left: W / 2, top: Math.round(H * 0.155), fontSize: sf(17),
                fill: '#bfdbfe', originX: 'center', originY: 'center' }));
            divider(0.26, '#bfdbfe');
            field('📅  ' + t('Date :', '日期：', '日期：'), 0.31, '#1e3a8a');
            field('🕐  ' + t('Time :', '时间：', '時間：'), 0.40, '#1e3a8a');
            field('👨‍⚕️  ' + t('Doctor :', '医生：', '醫生：'), 0.49, '#1e3a8a');
            field('📋  ' + t('Treatment :', '诊疗：', '診療：'), 0.58, '#1e3a8a');
            divider(0.675, '#bfdbfe');
            body(t('Please arrive 10 minutes early.\nRemember to bring your records.', '请提前10分钟到达。\n请携带您的病历记录。', '請提前10分鐘到達。\n請攜帶您的病歷記錄。'), 0.735, '#3b82f6', 14);
            body(t('Thank you! 😊', '谢谢！😊', '謝謝！😊'), 0.845, '#1d4ed8', 18);
        }

        if (tpl === 'followup') {
            setBgInput('#f0fdfa');
            _canvas.setBackgroundColor('#f0fdfa', function () { _canvas.renderAll(); });
            header('#0d9488', 0.18); cnHeader('#ffffff', 0.085, 24);
            bigTitle('🔁 ' + t('Follow-up Reminder', '复诊提醒', '覆診提醒'), 0.28, '#0f766e', 28);
            divider(0.34, '#99f6e4');
            body(t('Dear Patient,', '亲爱的病人，', '親愛的病人，'), 0.400, '#134e4a', 15);
            body(t('It is time for your follow-up appointment.', '您的复诊时间已到。', '您的覆診時間已到。'), 0.460, '#0f766e', 15);
            divider(0.535, '#99f6e4');
            field('📅  ' + t('Date :', '日期：', '日期：'), 0.580, '#134e4a');
            field('🕐  ' + t('Time :', '时间：', '時間：'), 0.655, '#134e4a');
            divider(0.735, '#99f6e4');
            body(t('Please call to confirm or reschedule.\nWe look forward to seeing you!',
                   '请致电确认或更改预约。\n期待您的到来！',
                   '請致電確認或更改預約。\n期待您的到來！'), 0.800, '#0d9488', 14);
        }

        if (tpl === 'missed') {
            setBgInput('#fffbeb');
            _canvas.setBackgroundColor('#fffbeb', function () { _canvas.renderAll(); });
            header('#d97706', 0.18); cnHeader('#fef3c7', 0.085, 24);
            add(txt('⚠️', { left: W / 2, top: Math.round(H * 0.265),
                fontSize: sf(52), originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Missed Appointment', '缺席通知', '缺席通知'), 0.37, '#92400e', 28);
            divider(0.435, '#fcd34d');
            body(t('We noticed you missed your appointment\nscheduled on ___________.',
                   '您于 ___________ 的预约已缺席。',
                   '您於 ___________ 的預約已缺席。'), 0.505, '#78350f', 15);
            body(t('Please contact us to reschedule\nat your earliest convenience.',
                   '请尽快与我们联系重新预约。',
                   '請盡快與我們聯繫重新預約。'), 0.625, '#b45309', 15);
            divider(0.72, '#fcd34d');
            body(t('📞 Tel: ___________', '📞 电话：___________', '📞 電話：___________'), 0.775, '#d97706', 17);
            footer('#d97706', 0.07);
        }

        // ════════════════════════════════════════════════════════
        //  HEALTH TIPS
        // ════════════════════════════════════════════════════════
        if (tpl === 'health') {
            setBgInput('#f0fdf4');
            _canvas.setBackgroundColor('#f0fdf4', function () { _canvas.renderAll(); });
            header('#16a34a', 0.18); cnHeader('#ffffff', 0.065, 24);
            divider(0.22, '#86efac');
            bigTitle('💚 ' + t('Health Tip', '健康贴士', '健康貼士'), 0.31, '#15803d', 32);
            divider(0.38, '#86efac');
            body(t('💧 Drink 8 glasses of water daily.',
                   '💧 每天喝8杯水。',
                   '💧 每天喝8杯水。'), 0.455, '#166534', 16);
            body(t('🚶 Walk 30 minutes every day.',
                   '🚶 每天步行30分钟。',
                   '🚶 每天步行30分鐘。'), 0.525, '#166534', 16);
            body(t('😴 Get 7–8 hours of sleep nightly.',
                   '😴 每晚睡7至8小时。',
                   '😴 每晚睡7至8小時。'), 0.595, '#166534', 16);
            body(t('🥗 Eat plenty of fruits & vegetables.',
                   '🥗 多吃蔬菜水果。',
                   '🥗 多吃蔬菜水果。'), 0.665, '#166534', 16);
            divider(0.74, '#86efac');
            body('— ' + cn + ' —', 0.81, '#4ade80', 13);
        }

        if (tpl === 'dental') {
            setBgInput('#f0f9ff');
            _canvas.setBackgroundColor('#f0f9ff', function () { _canvas.renderAll(); });
            header('#0284c7', 0.18); cnHeader('#ffffff', 0.065, 24);
            bigTitle('🦷 ' + t('Dental Care Tips', '牙齿护理贴士', '牙齒護理貼士'), 0.28, '#0369a1', 28);
            divider(0.34, '#bae6fd');
            body(t('🪥 Brush teeth twice a day — 2 minutes each time.',
                   '🪥 每天刷牙两次，每次至少2分钟。',
                   '🪥 每天刷牙兩次，每次至少2分鐘。'), 0.405, '#0c4a6e', 14);
            body(t('🧵 Floss daily to remove plaque between teeth.',
                   '🧵 每天使用牙线清除牙缝间的牙菌斑。',
                   '🧵 每天使用牙線清除牙縫間的牙菌斑。'), 0.475, '#0c4a6e', 14);
            body(t('🪣 Use fluoride toothpaste for strong enamel.',
                   '🪣 使用含氟牙膏保护牙釉质。',
                   '🪣 使用含氟牙膏保護牙釉質。'), 0.545, '#0c4a6e', 14);
            body(t('🩺 Visit your dentist every 6 months.',
                   '🩺 每6个月检查牙齿一次。',
                   '🩺 每6個月檢查牙齒一次。'), 0.615, '#0c4a6e', 14);
            body(t('🚫 Limit sugary drinks & sweets.',
                   '🚫 减少含糖饮料和零食的摄入。',
                   '🚫 減少含糖飲料和零食的攝入。'), 0.685, '#0c4a6e', 14);
            divider(0.755, '#bae6fd');
            body('— ' + cn + ' —', 0.82, '#0ea5e9', 13);
        }

        if (tpl === 'vaccine') {
            setBgInput('#faf5ff');
            _canvas.setBackgroundColor('#faf5ff', function () { _canvas.renderAll(); });
            header('#7c3aed', 0.20); cnHeader('#ffffff', 0.075, 24);
            add(txt(t('Vaccination Drive', '疫苗接种活动', '疫苗接種活動'), {
                left: W / 2, top: Math.round(H * 0.165),
                fontSize: sf(15), fill: '#ddd6fe', originX: 'center', originY: 'center' }));
            bigTitle('💉', 0.28, '#6d28d9', 48);
            bigTitle(t('Get Vaccinated', '立即接种疫苗', '立即接種疫苗'), 0.38, '#6d28d9', 28);
            divider(0.44, '#ddd6fe');
            body(t('Protect yourself and your loved ones.\nVaccination saves lives.',
                   '保护自己与家人，\n疫苗接种拯救生命。',
                   '保護自己與家人，\n疫苗接種拯救生命。'), 0.520, '#4c1d95', 16);
            body(t('Available vaccines: ___________________________', '可接种疫苗：___________________________', '可接種疫苗：___________________________'), 0.62, '#334155', 13);
            body(t('Dates: ___________________________', '日期：___________________________', '日期：___________________________'), 0.675, '#334155', 13);
            badge('#7c3aed', 0.740, 0.65, 0.09);
            add(txt(t('Book Now — Call Us Today!', '立即预约 — 今日致电！', '立即預約 — 今日致電！'), {
                left: W / 2, top: Math.round(H * 0.786), fontSize: sf(15),
                fill: '#ffffff', fontWeight: 'bold', textAlign: 'center', originX: 'center' }));
        }

        if (tpl === 'flu') {
            setBgInput('#fff1f2');
            _canvas.setBackgroundColor('#fff1f2', function () { _canvas.renderAll(); });
            header('#dc2626', 0.20); cnHeader('#fecaca', 0.075, 22);
            add(txt(t('Health Alert', '健康警报', '健康警報'), {
                left: W / 2, top: Math.round(H * 0.165), fontSize: sf(15),
                fill: '#fca5a5', originX: 'center', originY: 'center' }));
            bigTitle('🤧 ' + t('Flu Season Alert', '流感高峰期警报', '流感高峰期警報'), 0.29, '#991b1b', 24);
            divider(0.350, '#fca5a5');
            body(t('Protect yourself this flu season:', '流感季节，保护自己：', '流感季節，保護自己：'), 0.405, '#7f1d1d', 15);
            body(t('✅ Get your flu vaccination today.',
                   '✅ 立即接种流感疫苗。',
                   '✅ 立即接種流感疫苗。'), 0.468, '#dc2626', 14);
            body(t('✅ Wash hands frequently with soap.',
                   '✅ 经常用肥皂洗手。',
                   '✅ 經常用肥皂洗手。'), 0.528, '#dc2626', 14);
            body(t('✅ Wear a mask in crowded places.',
                   '✅ 在人多处佩戴口罩。',
                   '✅ 在人多處佩戴口罩。'), 0.588, '#dc2626', 14);
            body(t('✅ Stay home if you feel unwell.',
                   '✅ 身体不适请留在家中。',
                   '✅ 身體不適請留在家中。'), 0.648, '#dc2626', 14);
            divider(0.715, '#fca5a5');
            body(t('If symptoms persist, see a doctor immediately.',
                   '如症状持续，请立即就医。',
                   '如症狀持續，請立即就醫。'), 0.775, '#7f1d1d', 13);
            footer('#dc2626', 0.07);
        }

        if (tpl === 'hygiene') {
            setBgInput('#f0fdfa');
            _canvas.setBackgroundColor('#f0fdfa', function () { _canvas.renderAll(); });
            header('#0d9488', 0.18); cnHeader('#ffffff', 0.065, 24);
            bigTitle('🧼 ' + t('Hand Hygiene', '手部卫生', '手部衛生'), 0.27, '#0f766e', 28);
            divider(0.33, '#99f6e4');
            body(t('Clean hands save lives!', '清洁双手，保护生命！', '清潔雙手，保護生命！'), 0.385, '#134e4a', 18);
            body(t('🖐 Wet  →  Soap  →  Scrub 20 sec\n→  Rinse  →  Dry',
                   '🖐 湿手 → 涂皂 → 搓洗20秒\n→ 冲洗 → 擦干',
                   '🖐 濕手 → 塗皂 → 搓洗20秒\n→ 沖洗 → 擦乾'), 0.495, '#0f766e', 15);
            divider(0.615, '#99f6e4');
            body(t('Remember to wash your hands:\n• Before & after eating\n• After using the restroom\n• After coughing or sneezing',
                   '在以下情况请洗手：\n• 进食前后\n• 如厕后\n• 咳嗽或打喷嚏后',
                   '在以下情況請洗手：\n• 進食前後\n• 如廁後\n• 咳嗽或打噴嚏後'), 0.710, '#134e4a', 13);
        }

        // ════════════════════════════════════════════════════════
        //  NOTICES
        // ════════════════════════════════════════════════════════
        if (tpl === 'holiday') {
            setBgInput('#fffbeb');
            _canvas.setBackgroundColor('#fffbeb', function () { _canvas.renderAll(); });
            header('#b45309', 0.17); cnHeader('#fef3c7', 0.065, 24);
            bigTitle('🎉  ' + t('Holiday Notice', '假期通知', '假期通知'), 0.295, '#92400e', 34);
            divider(0.36, '#fcd34d');
            body(t('Our clinic will be closed on:', '本诊所于以下日期休诊：', '本診所於以下日期休診：'), 0.425, '#78350f', 16);
            badge('#b45309', 0.485, 0.68, 0.10);
            add(txt('___________________', { left: W / 2, top: Math.round(H * 0.535),
                fontSize: sf(22), fill: '#ffffff', fontWeight: 'bold',
                textAlign: 'center', originX: 'center' }));
            body(t('Normal hours resume on:', '恢复正常营业：', '恢復正常營業：'), 0.640, '#92400e', 14);
            body('___________________', 0.695, '#b45309', 20);
            divider(0.760, '#fcd34d');
            body(t('Sorry for any inconvenience. Thank you!', '如有不便，敬请原谅，谢谢！', '如有不便，敬請原諒，謝謝！'), 0.820, '#78350f', 13);
        }

        if (tpl === 'closed') {
            setBgInput('#fef2f2');
            _canvas.setBackgroundColor('#fef2f2', function () { _canvas.renderAll(); });
            header('#b91c1c', 0.22); cnHeader('#fecaca', 0.085, 24);
            add(txt(t('Important Notice', '重要通知', '重要通知'), {
                left: W / 2, top: Math.round(H * 0.185), fontSize: sf(14),
                fill: '#fca5a5', originX: 'center', originY: 'center' }));
            add(txt('🔴', { left: W / 2, top: Math.round(H * 0.295),
                fontSize: sf(56), originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Clinic Closed Today', '今日停诊', '今日停診'), 0.40, '#991b1b', 34);
            divider(0.465, '#fca5a5');
            body(t('We apologise for the inconvenience.', '对于不便之处，我们深感抱歉。', '對於不便之處，我們深感抱歉。'), 0.530, '#7f1d1d', 15);
            body(t('We will resume normal operations on:', '我们将于以下日期恢复正常营业：', '我們將於以下日期恢復正常營業：'), 0.600, '#7f1d1d', 14);
            body('___________________', 0.660, '#b91c1c', 24);
            body(t('For urgent matters, please contact:', '如有紧急事项，请联络：', '如有緊急事項，請聯絡：'), 0.745, '#7f1d1d', 13);
            body('📞 ___________________________', 0.800, '#b91c1c', 17);
        }

        if (tpl === 'redhours') {
            setBgInput('#fff7ed');
            _canvas.setBackgroundColor('#fff7ed', function () { _canvas.renderAll(); });
            header('#c2410c', 0.18); cnHeader('#fed7aa', 0.065, 24);
            bigTitle('🕐 ' + t('Reduced Operating Hours', '缩短营业时间通知', '縮短營業時間通知'), 0.275, '#9a3412', 24);
            divider(0.335, '#fdba74');
            body(t('Please note that our clinic will operate\non reduced hours on the following dates:',
                   '请注意，本诊所将于以下日期\n缩短营业时间：',
                   '請注意，本診所將於以下日期\n縮短營業時間：'), 0.415, '#7c2d12', 14);
            badge('#c2410c', 0.500, 0.68, 0.085);
            add(txt('___________________', { left: W / 2, top: Math.round(H * 0.543),
                fontSize: sf(18), fill: '#ffffff', fontWeight: 'bold',
                textAlign: 'center', originX: 'center' }));
            body(t('Temporary Hours:', '临时营业时间：', '臨時營業時間：'), 0.635, '#9a3412', 15);
            body('_____________  to  _____________', 0.690, '#c2410c', 17);
            divider(0.760, '#fdba74');
            body(t('We apologise for any inconvenience.', '如有不便，敬请原谅。', '如有不便，敬請原諒。'), 0.820, '#7c2d12', 13);
        }

        if (tpl === 'emergency') {
            setBgInput('#fef2f2');
            _canvas.setBackgroundColor('#fef2f2', function () { _canvas.renderAll(); });
            header('#991b1b', 0.18); cnHeader('#fecaca', 0.065, 24);
            bigTitle('🚨 ' + t('Emergency Contact', '紧急联络资讯', '緊急聯絡資訊'), 0.270, '#7f1d1d', 26);
            divider(0.330, '#fca5a5');
            field('🏥 ' + t('A&E (Hospital):', '急症室（医院）：', '急症室（醫院）：'), 0.385, '#7f1d1d', 15);
            field('   ___________________________', 0.440, '#b91c1c', 18);
            field('🚑 ' + t('Ambulance:', '救护车：', '救護車：'), 0.515, '#7f1d1d', 15);
            field('   ___________________________', 0.570, '#b91c1c', 18);
            field('📞 ' + t('After-hours GP:', '非办公时间诊所：', '非辦公時間診所：'), 0.645, '#7f1d1d', 15);
            field('   ___________________________', 0.700, '#b91c1c', 18);
            divider(0.765, '#fca5a5');
            body(t('For life-threatening emergencies\ncall 999 immediately.',
                   '如遇生命危险，请立即致电999。',
                   '如遇生命危險，請立即致電999。'), 0.830, '#991b1b', 14);
        }

        // ════════════════════════════════════════════════════════
        //  WAITING ROOM
        // ════════════════════════════════════════════════════════
        if (tpl === 'register') {
            setBgInput('#f0f9ff');
            _canvas.setBackgroundColor('#f0f9ff', function () { _canvas.renderAll(); });
            header('#1e40af', 0.20); cnHeader('#dbeafe', 0.085, 24);
            add(txt('🪪', { left: W / 2, top: Math.round(H * 0.30),
                fontSize: sf(60), originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Please Register', '请到登记处登记', '請到登記處登記'), 0.415, '#1e3a8a', 30);
            divider(0.475, '#bfdbfe');
            body(t('Please report to the registration counter\nupon arrival.',
                   '到达后请先到登记处报到。',
                   '到達後請先到登記處報到。'), 0.550, '#1e40af', 16);
            body(t('Our staff will be happy to assist you.',
                   '我们的工作人员将乐意为您服务。',
                   '我們的工作人員將樂意為您服務。'), 0.640, '#3b82f6', 14);
            body(t('Thank you for your cooperation!',
                   '感谢您的配合！',
                   '感謝您的配合！'), 0.715, '#1e40af', 15);
            footer('#1e40af', 0.07);
        }

        if (tpl === 'mask') {
            setBgInput('#f0fdfa');
            _canvas.setBackgroundColor('#f0fdfa', function () { _canvas.renderAll(); });
            header('#0f766e', 0.20); cnHeader('#ccfbf1', 0.085, 24);
            add(txt('😷', { left: W / 2, top: Math.round(H * 0.295),
                fontSize: sf(72), originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Mask Required', '请佩戴口罩', '請佩戴口罩'), 0.425, '#134e4a', 34);
            divider(0.490, '#99f6e4');
            body(t('For the health and safety of all patients\nand staff, please wear a face mask\nthroughout your visit.',
                   '为保障所有病人及员工的健康，\n请在就诊期间全程佩戴口罩。',
                   '為保障所有病人及員工的健康，\n請在就診期間全程佩戴口罩。'), 0.605, '#0f766e', 14);
            body(t('Masks are available at the front desk.',
                   '如需口罩，请向前台索取。',
                   '如需口罩，請向前台索取。'), 0.740, '#0d9488', 13);
            footer('#0f766e', 0.07);
        }

        if (tpl === 'nophone') {
            setBgInput('#f8fafc');
            _canvas.setBackgroundColor('#f8fafc', function () { _canvas.renderAll(); });
            header('#1e293b', 0.20); cnHeader('#94a3b8', 0.085, 24);
            add(txt('📵', { left: W / 2, top: Math.round(H * 0.295),
                fontSize: sf(72), originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Please Silence', '请将手机静音', '請將手機靜音'), 0.42, '#0f172a', 30);
            bigTitle(t('Your Mobile Phone', '您的手机', '您的手機'), 0.49, '#0f172a', 30);
            divider(0.555, '#cbd5e1');
            body(t('Out of respect for other patients,\nplease switch your phone to silent\nor vibrate mode.',
                   '为尊重其他病人，\n请将手机调至静音或振动模式。',
                   '為尊重其他病人，\n請將手機調至靜音或振動模式。'), 0.660, '#475569', 14);
            body(t('Thank you for your understanding.',
                   '感谢您的谅解。',
                   '感謝您的諒解。'), 0.790, '#64748b', 13);
        }

        if (tpl === 'quiet') {
            setBgInput('#fafafa');
            _canvas.setBackgroundColor('#fafafa', function () { _canvas.renderAll(); });
            header('#374151', 0.20); cnHeader('#d1d5db', 0.085, 24);
            add(txt('🤫', { left: W / 2, top: Math.round(H * 0.295),
                fontSize: sf(72), originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Quiet Please', '请保持安静', '請保持安靜'), 0.425, '#111827', 36);
            divider(0.490, '#d1d5db');
            body(t('Patients are resting and recovering.\nPlease keep noise to a minimum\nand speak softly.',
                   '病人正在休息中。\n请保持安静，轻声细语。',
                   '病人正在休息中。\n請保持安靜，輕聲細語。'), 0.610, '#374151', 15);
            body(t('Your consideration is greatly appreciated.',
                   '感谢您的体谅与配合。',
                   '感謝您的體諒與配合。'), 0.760, '#6b7280', 13);
            footer('#374151', 0.07);
        }

        // ════════════════════════════════════════════════════════
        //  PROMOTIONS
        // ════════════════════════════════════════════════════════
        if (tpl === 'screening') {
            setBgInput('#f0fdf4');
            _canvas.setBackgroundColor('#f0fdf4', function () { _canvas.renderAll(); });
            header('#15803d', 0.20); cnHeader('#bbf7d0', 0.085, 24);
            bigTitle('🔬 ' + t('Annual Health Screening', '年度健康检查', '年度健康檢查'), 0.295, '#14532d', 26);
            divider(0.355, '#86efac');
            body(t('Take charge of your health today!', '今天就关注您的健康！', '今天就關注您的健康！'), 0.410, '#15803d', 16);
            body(t('Our comprehensive package includes:', '我们的综合检查套餐包括：', '我們的綜合檢查套餐包括：'), 0.465, '#166534', 14);
            body(t('✅ Blood Test   ✅ Urine Test\n✅ Blood Pressure   ✅ BMI\n✅ Vision & Hearing Test',
                   '✅ 血液检查   ✅ 尿液检查\n✅ 血压   ✅ BMI指数\n✅ 视力及听力检查',
                   '✅ 血液檢查   ✅ 尿液檢查\n✅ 血壓   ✅ BMI指數\n✅ 視力及聽力檢查'), 0.565, '#166534', 14);
            divider(0.678, '#86efac');
            badge('#15803d', 0.715, 0.65, 0.09);
            add(txt(t('Book Now — Limited Slots!', '立即预约 — 名额有限！', '立即預約 — 名額有限！'), {
                left: W / 2, top: Math.round(H * 0.760), fontSize: sf(16),
                fill: '#ffffff', fontWeight: 'bold', textAlign: 'center', originX: 'center' }));
            body('📞 ___________________________', 0.860, '#15803d', 17);
        }

        if (tpl === 'bpcheck') {
            setBgInput('#fff1f2');
            _canvas.setBackgroundColor('#fff1f2', function () { _canvas.renderAll(); });
            header('#be123c', 0.20); cnHeader('#fecdd3', 0.085, 24);
            add(txt('❤️', { left: W / 2, top: Math.round(H * 0.285),
                fontSize: sf(60), originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Free Blood Pressure Check', '免费血压检测', '免費血壓檢測'), 0.395, '#881337', 26);
            divider(0.455, '#fda4af');
            body(t('Know your numbers. Protect your heart.',
                   '了解您的血压数值，保护您的心脏。',
                   '了解您的血壓數值，保護您的心臟。'), 0.515, '#9f1239', 15);
            body(t('Available to all patients.\nNo appointment needed!',
                   '所有病人均可参与，\n无需预约！',
                   '所有病人均可參與，\n無需預約！'), 0.600, '#be123c', 16);
            divider(0.685, '#fda4af');
            body(t('Ask our staff at the front desk today.',
                   '今日向前台工作人员询问。',
                   '今日向前台工作人員詢問。'), 0.745, '#9f1239', 14);
            body('— ' + cn + ' —', 0.830, '#fda4af', 13);
        }

        if (tpl === 'senior') {
            setBgInput('#fffbeb');
            _canvas.setBackgroundColor('#fffbeb', function () { _canvas.renderAll(); });
            header('#92400e', 0.20); cnHeader('#fde68a', 0.085, 24);
            add(txt('👴', { left: W / 2, top: Math.round(H * 0.285),
                fontSize: sf(58), originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Senior Health Package', '乐龄健康配套', '樂齡健康配套'), 0.395, '#78350f', 26);
            divider(0.455, '#fcd34d');
            body(t('Special care packages designed for\npatients aged 60 and above.',
                   '专为60岁及以上长者设计的\n特别健康配套。',
                   '專為60歲及以上長者設計的\n特別健康配套。'), 0.535, '#92400e', 14);
            body(t('Includes: Health Screening • GP Consultation\nPhysio Assessment • Medication Review',
                   '包括：健康检查 • 门诊咨询\n物理治疗评估 • 药物审查',
                   '包括：健康檢查 • 門診咨詢\n物理治療評估 • 藥物審查'), 0.640, '#78350f', 13);
            divider(0.725, '#fcd34d');
            badge('#d97706', 0.760, 0.65, 0.09);
            add(txt(t('Ask us for details today!', '今日向我们查询详情！', '今日向我們查詢詳情！'), {
                left: W / 2, top: Math.round(H * 0.806), fontSize: sf(15),
                fill: '#ffffff', fontWeight: 'bold', textAlign: 'center', originX: 'center' }));
            body('📞 ___________________________', 0.890, '#92400e', 17);
        }

        // ════════════════════════════════════════════════════════
        //  OTHER TEMPLATES
        // ════════════════════════════════════════════════════════

        if (tpl === 'diabcare') {
            setBgInput('#f0fdf4');
            _canvas.setBackgroundColor('#f0fdf4', function () { _canvas.renderAll(); });
            header('#065f46', 0.18); cnHeader('#a7f3d0', 0.068, 24);
            add(txt('🩺', { left: W/2, top: Math.round(H*0.265),
                fontSize: sf(50), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Diabetes Care', '糖尿病护理', '糖尿病護理'), 0.375, '#064e3b', 30);
            divider(0.435, '#6ee7b7');
            body(t('Managing diabetes starts with daily habits:', '糖尿病管理从日常习惯开始：', '糖尿病管理從日常習慣開始：'), 0.485, '#065f46', 14);
            field('✅ ' + t('Check blood sugar regularly', '定期检测血糖', '定期檢測血糖'), 0.540, '#047857', 14);
            field('✅ ' + t('Follow your meal plan', '遵守饮食计划', '遵守飲食計劃'), 0.590, '#047857', 14);
            field('✅ ' + t('Take medications as prescribed', '按医嘱服药', '按醫囑服藥'), 0.640, '#047857', 14);
            field('✅ ' + t('Exercise 150 min / week', '每周运动150分钟', '每週運動150分鐘'), 0.690, '#047857', 14);
            divider(0.745, '#6ee7b7');
            body(t('Ask your doctor about your HbA1c target.', '询问医生您的HbA1c目标值。', '詢問醫生您的HbA1c目標值。'), 0.800, '#065f46', 13);
            body('— ' + cn + ' —', 0.870, '#34d399', 12);
        }

        if (tpl === 'mentalhealth') {
            setBgInput('#faf5ff');
            _canvas.setBackgroundColor('#faf5ff', function () { _canvas.renderAll(); });
            header('#6d28d9', 0.20); cnHeader('#e9d5ff', 0.085, 24);
            add(txt('🧠', { left: W/2, top: Math.round(H*0.285),
                fontSize: sf(56), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Your Mental Health Matters', '心理健康很重要', '心理健康很重要'), 0.395, '#5b21b6', 26);
            divider(0.455, '#ddd6fe');
            body(t('It\'s okay to ask for help. You are not alone.',
                   '寻求帮助是没关系的。您并不孤单。',
                   '尋求協助是沒關係的。您並不孤單。'), 0.515, '#4c1d95', 15);
            body(t('Signs to watch for:\nAnxiety • Low mood • Sleep issues • Fatigue',
                   '需关注的迹象：\n焦虑 • 情绪低落 • 睡眠问题 • 疲劳',
                   '需關注的跡象：\n焦慮 • 情緒低落 • 睡眠問題 • 疲勞'), 0.615, '#5b21b6', 14);
            divider(0.715, '#ddd6fe');
            body(t('Talk to your doctor — help is available here.',
                   '请与医生交谈，我们可以为您提供帮助。',
                   '請與醫生交談，我們可以為您提供協助。'), 0.775, '#6d28d9', 14);
            body('— ' + cn + ' —', 0.850, '#a78bfa', 12);
        }

        if (tpl === 'eyecare') {
            setBgInput('#eff6ff');
            _canvas.setBackgroundColor('#eff6ff', function () { _canvas.renderAll(); });
            header('#1d4ed8', 0.18); cnHeader('#bfdbfe', 0.068, 24);
            add(txt('👁', { left: W/2, top: Math.round(H*0.260),
                fontSize: sf(56), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Eye Care Tips', '眼部护理贴士', '眼部護理貼士'), 0.365, '#1e3a8a', 30);
            divider(0.430, '#bfdbfe');
            field('👓 ' + t('Get an eye test every 2 years', '每两年检查一次视力', '每兩年檢查一次視力'), 0.480, '#1d4ed8', 14);
            field('💻 ' + t('Take screen breaks every 20 min', '每20分钟休息眼睛', '每20分鐘休息眼睛'), 0.530, '#1d4ed8', 14);
            field('☀️ ' + t('Wear UV-protective sunglasses', '佩戴防紫外线太阳镜', '佩戴防紫外線太陽鏡'), 0.580, '#1d4ed8', 14);
            field('🥕 ' + t('Eat foods rich in Vitamin A', '多吃富含维生素A的食物', '多吃富含維生素A的食物'), 0.630, '#1d4ed8', 14);
            field('🚭 ' + t('Avoid smoking — it harms your eyes', '避免吸烟，吸烟损害视力', '避免吸煙，吸煙損害視力'), 0.680, '#1d4ed8', 14);
            divider(0.740, '#bfdbfe');
            body(t('Eye exams available — ask our staff.', '可预约眼部检查，请向工作人员询问。', '可預約眼部檢查，請向工作人員詢問。'), 0.800, '#1e40af', 14);
        }

        if (tpl === 'physio') {
            setBgInput('#fff7ed');
            _canvas.setBackgroundColor('#fff7ed', function () { _canvas.renderAll(); });
            header('#c2410c', 0.18); cnHeader('#fed7aa', 0.068, 24);
            add(txt('💪', { left: W/2, top: Math.round(H*0.265),
                fontSize: sf(54), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Physiotherapy Services', '物理治疗服务', '物理治療服務'), 0.375, '#7c2d12', 26);
            divider(0.435, '#fdba74');
            body(t('We help you recover, move better & live pain-free.',
                   '我们帮助您康复、改善行动能力及减轻疼痛。',
                   '我們幫助您康復、改善行動能力及減輕疼痛。'), 0.490, '#9a3412', 14);
            field('✔ ' + t('Back & neck pain', '背部及颈部疼痛', '背部及頸部疼痛'), 0.550, '#c2410c', 14);
            field('✔ ' + t('Sports injuries & rehabilitation', '运动损伤及康复', '運動損傷及康復'), 0.595, '#c2410c', 14);
            field('✔ ' + t('Post-surgery recovery', '手术后康复', '手術後康復'), 0.640, '#c2410c', 14);
            field('✔ ' + t('Elderly mobility & balance', '老年人行动能力及平衡', '老年人行動能力及平衡'), 0.685, '#c2410c', 14);
            divider(0.745, '#fdba74');
            body(t('Book a session today. Ask at reception.',
                   '立即预约，请向接待处询问。',
                   '立即預約，請向接待處詢問。'), 0.800, '#7c2d12', 14);
            body('📞 ___________________________', 0.860, '#ea580c', 16);
        }

        if (tpl === 'telemedicine') {
            setBgInput('#ecfeff');
            _canvas.setBackgroundColor('#ecfeff', function () { _canvas.renderAll(); });
            header('#0891b2', 0.18); cnHeader('#a5f3fc', 0.068, 24);
            add(txt('📱', { left: W/2, top: Math.round(H*0.265),
                fontSize: sf(56), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Virtual Consultation', '视频诊疗', '視像診療'), 0.370, '#164e63', 28);
            body(t('See your doctor from home', '在家中与医生视频诊疗', '在家中與醫生視像診療'), 0.435, '#0e7490', 17);
            divider(0.490, '#a5f3fc');
            field('📲 ' + t('Available via WhatsApp / Video Call', '通过WhatsApp / 视频通话', '透過WhatsApp / 視像通話'), 0.540, '#0e7490', 14);
            field('📅 ' + t('Book online or by phone', '网上或电话预约', '網上或電話預約'), 0.590, '#0e7490', 14);
            field('🏠 ' + t('Ideal for follow-ups & mild symptoms', '适合复诊及轻微症状', '適合覆診及輕微症狀'), 0.640, '#0e7490', 14);
            field('🔒 ' + t('Private & confidential', '私密及保密', '私密及保密'), 0.690, '#0e7490', 14);
            divider(0.750, '#a5f3fc');
            badge('#0891b2', 0.790, 0.65, 0.085);
            add(txt(t('Call us to book now!', '立即致电预约！', '立即致電預約！'), {
                left: W/2, top: Math.round(H*0.835), fontSize: sf(16),
                fill:'#fff', fontWeight:'bold', textAlign:'center', originX:'center' }));
        }

        if (tpl === 'pharmacy') {
            setBgInput('#f0fdf4');
            _canvas.setBackgroundColor('#f0fdf4', function () { _canvas.renderAll(); });
            header('#15803d', 0.18); cnHeader('#bbf7d0', 0.068, 24);
            add(txt('💊', { left: W/2, top: Math.round(H*0.260),
                fontSize: sf(56), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Pharmacy Services', '药房服务', '藥房服務'), 0.370, '#14532d', 28);
            divider(0.430, '#86efac');
            field('💊 ' + t('Prescription dispensing', '处方药配发', '處方藥配發'), 0.475, '#166534', 14);
            field('🩺 ' + t('OTC medications available', '非处方药品供应', '非處方藥品供應'), 0.520, '#166534', 14);
            field('📋 ' + t('Medication counselling', '药物咨询服务', '藥物諮詢服務'), 0.565, '#166534', 14);
            field('🔄 ' + t('Chronic medication refills', '慢性病药物续配', '慢性病藥物續配'), 0.610, '#166534', 14);
            field('🧴 ' + t('Health & wellness products', '健康及保健产品', '健康及保健產品'), 0.655, '#166534', 14);
            divider(0.715, '#86efac');
            body(t('Our pharmacists are here to help you.', '我们的药剂师随时为您提供帮助。', '我們的藥劑師隨時為您提供協助。'), 0.770, '#15803d', 14);
            body('🕐 ' + t('Mon–Sat : 9 am – 6 pm', '周一至六：9:00am – 6:00pm', '週一至六：9:00am – 6:00pm'), 0.840, '#166534', 14);
        }

        if (tpl === 'thankyou') {
            setBgInput('#fffbeb');
            _canvas.setBackgroundColor('#fffbeb', function () { _canvas.renderAll(); });
            header('#92400e', 0.20); cnHeader('#fde68a', 0.085, 24);
            add(txt('🙏', { left: W/2, top: Math.round(H*0.295),
                fontSize: sf(64), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Thank You', '衷心感谢', '衷心感謝'), 0.410, '#78350f', 36);
            divider(0.470, '#fcd34d');
            body(t('We appreciate your trust in us.\nYour health is our priority.',
                   '感谢您对我们的信任。\n您的健康是我们的首要任务。',
                   '感謝您對我們的信任。\n您的健康是我們的首要任務。'), 0.545, '#92400e', 16);
            divider(0.635, '#fcd34d');
            body(t('We look forward to caring for you\nand your family.',
                   '我们期待继续为您和您的家人提供医疗服务。',
                   '我們期待繼續為您和您的家人提供醫療服務。'), 0.710, '#78350f', 14);
            body('— ' + cn + ' —', 0.820, '#fbbf24', 15);
            footer('#92400e', 0.07);
        }

        if (tpl === 'feedback') {
            setBgInput('#eff6ff');
            _canvas.setBackgroundColor('#eff6ff', function () { _canvas.renderAll(); });
            header('#2563eb', 0.20); cnHeader('#bfdbfe', 0.085, 24);
            add(txt('📝', { left: W/2, top: Math.round(H*0.285),
                fontSize: sf(52), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('We Value Your Feedback', '我们重视您的意见', '我們重視您的意見'), 0.390, '#1e3a8a', 26);
            divider(0.450, '#bfdbfe');
            body(t('Please take a moment to share\nyour experience with us.',
                   '请花一点时间分享您的就诊体验。',
                   '請花一點時間分享您的就診體驗。'), 0.520, '#1d4ed8', 15);
            body(t('Scan the QR code below or\nask our staff for a feedback form.',
                   '扫描下方二维码或向工作人员索取意见表。',
                   '掃描下方QR碼或向工作人員索取意見表。'), 0.620, '#3b82f6', 14);
            add(rect({ left: (W-sf(100))/2, top: Math.round(H*0.710),
                width: sf(100), height: sf(100), fill:'none', stroke:'#3b82f6',
                strokeWidth: sf(3), rx: sf(8), selectable:false, evented:false }));
            add(txt('QR', { left: W/2, top: Math.round(H*0.760),
                fontSize: sf(20), fill:'#94a3b8', textAlign:'center', originX:'center', originY:'center' }));
            body(t('Thank you for helping us improve!', '感谢您帮助我们改善服务！', '感謝您幫助我們改善服務！'), 0.895, '#2563eb', 13);
        }

        if (tpl === 'wifi') {
            setBgInput('#f8fafc');
            _canvas.setBackgroundColor('#f8fafc', function () { _canvas.renderAll(); });
            header('#1e293b', 0.16); cnHeader('#94a3b8', 0.065, 22);
            add(txt('📶', { left: W/2, top: Math.round(H*0.255),
                fontSize: sf(60), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Free WiFi', '免费Wi-Fi', '免費Wi-Fi'), 0.360, '#0f172a', 34);
            divider(0.420, '#e2e8f0');
            add(txt(t('Network  :', '网络名称：', '網路名稱：'), { left: Math.round(W*0.10), top: Math.round(H*0.465),
                fontSize: sf(15), fill:'#475569', fontWeight:'bold' }));
            badge('#1e293b', 0.500, 0.80, 0.09);
            add(txt('________________________________', { left: W/2, top: Math.round(H*0.545),
                fontSize: sf(18), fill:'#f1f5f9', fontWeight:'bold', textAlign:'center', originX:'center' }));
            add(txt(t('Password :', '密码：', '密碼：'), { left: Math.round(W*0.10), top: Math.round(H*0.615),
                fontSize: sf(15), fill:'#475569', fontWeight:'bold' }));
            badge('#334155', 0.650, 0.80, 0.09);
            add(txt('________________________________', { left: W/2, top: Math.round(H*0.695),
                fontSize: sf(18), fill:'#e2e8f0', fontWeight:'bold', textAlign:'center', originX:'center' }));
            divider(0.765, '#e2e8f0');
            body(t('For patient & visitor use only.\nPlease do not share outside the clinic.',
                   '仅供病人及访客使用，请勿对外分享。',
                   '僅供病人及訪客使用，請勿對外分享。'), 0.835, '#64748b', 12);
        }

        if (tpl === 'blooddrive') {
            setBgInput('#fff1f2');
            _canvas.setBackgroundColor('#fff1f2', function () { _canvas.renderAll(); });
            header('#be123c', 0.20); cnHeader('#fecdd3', 0.085, 24);
            add(txt('🩸', { left: W/2, top: Math.round(H*0.285),
                fontSize: sf(60), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Blood Donation Drive', '献血活动', '獻血活動'), 0.390, '#881337', 28);
            divider(0.450, '#fda4af');
            body(t('Give the gift of life — donate blood today.',
                   '捐献生命之礼 — 今日参与献血。',
                   '捐獻生命之禮 — 今日參與獻血。'), 0.505, '#9f1239', 15);
            field('📅 ' + t('Date : ___________', '日期：___________', '日期：___________'), 0.565, '#be123c');
            field('🕐 ' + t('Time : ___________', '时间：___________', '時間：___________'), 0.630, '#be123c');
            field('📍 ' + t('Venue: ___________', '地点：___________', '地點：___________'), 0.695, '#be123c');
            divider(0.760, '#fda4af');
            body(t('Eligibility: Age 17–65 · Weight ≥ 45 kg · Healthy',
                   '资格：17–65岁 · 体重≥45公斤 · 健康',
                   '資格：17–65歲 · 體重≥45公斤 · 健康'), 0.815, '#9f1239', 13);
            body('— ' + cn + ' —', 0.880, '#fda4af', 12);
        }

        if (tpl === 'backpain') {
            setBgInput('#fffbeb');
            _canvas.setBackgroundColor('#fffbeb', function () { _canvas.renderAll(); });
            header('#b45309', 0.18); cnHeader('#fde68a', 0.068, 24);
            add(txt('🦴', { left: W/2, top: Math.round(H*0.260),
                fontSize: sf(52), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Beat Back Pain', '告别背痛', '告別背痛'), 0.365, '#78350f', 30);
            divider(0.425, '#fcd34d');
            body(t('Simple daily habits to protect your spine:', '保护脊柱的简单日常习惯：', '保護脊柱的簡單日常習慣：'), 0.475, '#92400e', 14);
            field('🪑 ' + t('Sit with back fully supported', '坐姿保持背部有支撑', '坐姿保持背部有支撐'), 0.525, '#b45309', 14);
            field('🖥 ' + t('Screen at eye level', '屏幕与眼睛齐平', '螢幕與眼睛齊平'), 0.572, '#b45309', 14);
            field('🧘 ' + t('Stretch every 30 minutes', '每30分钟伸展一次', '每30分鐘伸展一次'), 0.619, '#b45309', 14);
            field('🏋 ' + t('Strengthen core muscles', '强化核心肌肉', '強化核心肌肉'), 0.666, '#b45309', 14);
            field('😴 ' + t('Sleep on a firm mattress', '使用硬床垫睡眠', '使用硬床墊睡眠'), 0.713, '#b45309', 14);
            divider(0.766, '#fcd34d');
            body(t('Persistent pain? See your doctor today.', '疼痛持续？今日求诊。', '疼痛持續？今日求診。'), 0.820, '#78350f', 14);
        }

        if (tpl === 'kidsflu') {
            setBgInput('#fef9c3');
            _canvas.setBackgroundColor('#fef9c3', function () { _canvas.renderAll(); });
            header('#ca8a04', 0.18); cnHeader('#fef08a', 0.068, 24);
            add(txt('🤒', { left: W/2, top: Math.round(H*0.260),
                fontSize: sf(54), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t("Children's Flu Season", '儿童流感季节', '兒童流感季節'), 0.365, '#713f12', 26);
            divider(0.425, '#fde047');
            body(t('Protect your child this season:', '在这个季节保护您的孩子：', '在這個季節保護您的孩子：'), 0.475, '#854d0e', 14);
            field('💉 ' + t('Annual flu vaccination', '每年流感疫苗接种', '每年流感疫苗接種'), 0.525, '#ca8a04', 14);
            field('🧼 ' + t('Regular handwashing', '定期洗手', '定期洗手'), 0.572, '#ca8a04', 14);
            field('😷 ' + t('Wear a mask when unwell', '不适时佩戴口罩', '不適時佩戴口罩'), 0.619, '#ca8a04', 14);
            field('🏠 ' + t('Stay home if sick', '生病时留在家中休息', '生病時留在家中休息'), 0.666, '#ca8a04', 14);
            divider(0.720, '#fde047');
            body(t('Is your child unwell?\nBring them in — we are here to help.',
                   '您的孩子生病了吗？\n带他来就诊，我们随时为您服务。',
                   '您的孩子生病了嗎？\n帶他來就診，我們隨時為您服務。'), 0.790, '#854d0e', 14);
            body('📞 ' + cn + ' — ___________', 0.875, '#ca8a04', 14);
        }

        if (tpl === 'newcomer') {
            setBgInput('#ecfdf5');
            _canvas.setBackgroundColor('#ecfdf5', function () { _canvas.renderAll(); });
            header('#059669', 0.20); cnHeader('#a7f3d0', 0.085, 24);
            add(txt('🌟', { left: W/2, top: Math.round(H*0.290),
                fontSize: sf(60), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Welcome to Our Clinic', '欢迎来到我们的诊所', '歡迎來到我們的診所'), 0.400, '#064e3b', 26);
            divider(0.460, '#6ee7b7');
            body(t('We are glad you chose us for your healthcare needs.',
                   '很高兴您选择我们作为您的医疗服务提供者。',
                   '很高興您選擇我們作為您的醫療服務提供者。'), 0.520, '#065f46', 14);
            field('📋 ' + t('Please register at the front desk', '请在前台办理登记手续', '請在前台辦理登記手續'), 0.580, '#059669', 14);
            field('🪪 ' + t('Bring your IC / passport', '携带您的身份证/护照', '攜帶您的身份證/護照'), 0.630, '#059669', 14);
            field('📋 ' + t('Medical records (if any)', '如有病历记录请一并携带', '如有病歷記錄請一併攜帶'), 0.680, '#059669', 14);
            divider(0.740, '#6ee7b7');
            body(t('Our team is here to provide you with\ncompassionate, professional care.',
                   '我们的团队将为您提供专业和贴心的医疗服务。',
                   '我們的團隊將為您提供專業和貼心的醫療服務。'), 0.810, '#065f46', 13);
            footer('#059669', 0.07);
        }

        if (tpl === 'prenatal') {
            setBgInput('#fdf2f8');
            _canvas.setBackgroundColor('#fdf2f8', function () { _canvas.renderAll(); });
            header('#9d174d', 0.18); cnHeader('#fbcfe8', 0.068, 24);
            add(txt('🤰', { left: W/2, top: Math.round(H*0.260),
                fontSize: sf(56), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Prenatal Care', '产前护理', '產前護理'), 0.365, '#831843', 30);
            divider(0.425, '#f9a8d4');
            body(t('Your pregnancy journey — important reminders:',
                   '您的孕期旅程 — 重要提醒：',
                   '您的孕期旅程 — 重要提醒：'), 0.475, '#9d174d', 14);
            field('✅ ' + t('Regular antenatal check-ups', '定期产前检查', '定期產前檢查'), 0.525, '#be185d', 14);
            field('✅ ' + t('Take folic acid daily', '每日服用叶酸', '每日服用葉酸'), 0.572, '#be185d', 14);
            field('✅ ' + t('Avoid smoking & alcohol', '避免吸烟及饮酒', '避免吸煙及飲酒'), 0.619, '#be185d', 14);
            field('✅ ' + t('Eat a balanced diet', '均衡饮食', '均衡飲食'), 0.666, '#be185d', 14);
            field('✅ ' + t('Attend all ultrasound scans', '按时进行超声波检查', '按時進行超聲波檢查'), 0.713, '#be185d', 14);
            divider(0.766, '#f9a8d4');
            body(t('Book your antenatal appointment today.',
                   '今日预约产前检查。',
                   '今日預約產前檢查。'), 0.820, '#9d174d', 14);
        }

        if (tpl === 'weightmgmt') {
            setBgInput('#f0fdfa');
            _canvas.setBackgroundColor('#f0fdfa', function () { _canvas.renderAll(); });
            header('#0d9488', 0.18); cnHeader('#99f6e4', 0.068, 24);
            add(txt('⚖️', { left: W/2, top: Math.round(H*0.260),
                fontSize: sf(56), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Weight Management', '体重管理', '體重管理'), 0.365, '#134e4a', 30);
            divider(0.425, '#5eead4');
            body(t('Achieving a healthy weight improves\nyour overall health and wellbeing.',
                   '维持健康体重有助于改善您的整体健康。',
                   '維持健康體重有助於改善您的整體健康。'), 0.490, '#0f766e', 14);
            field('🥗 ' + t('Eat smaller portions more frequently', '少食多餐', '少食多餐'), 0.555, '#0d9488', 14);
            field('🚶 ' + t('30 minutes of exercise daily', '每天运动30分钟', '每天運動30分鐘'), 0.600, '#0d9488', 14);
            field('💧 ' + t('Drink water before meals', '餐前喝水', '餐前喝水'), 0.645, '#0d9488', 14);
            field('😴 ' + t('Prioritise quality sleep', '保证充足睡眠', '保證充足睡眠'), 0.690, '#0d9488', 14);
            divider(0.745, '#5eead4');
            body(t('Our doctor can create a personalised plan for you.',
                   '我们的医生可为您制定个性化方案。',
                   '我們的醫生可為您制定個性化方案。'), 0.800, '#134e4a', 13);
            body('— ' + cn + ' —', 0.870, '#2dd4bf', 12);
        }

        if (tpl === 'hearthealthy') {
            setBgInput('#fff1f2');
            _canvas.setBackgroundColor('#fff1f2', function () { _canvas.renderAll(); });
            header('#e11d48', 0.18); cnHeader('#fecdd3', 0.068, 24);
            add(txt('💓', { left: W/2, top: Math.round(H*0.260),
                fontSize: sf(60), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Heart Healthy Living', '心脏健康生活', '心臟健康生活'), 0.365, '#881337', 28);
            divider(0.425, '#fda4af');
            body(t('Simple steps for a stronger heart:', '保持心脏健康的简单步骤：', '保持心臟健康的簡單步驟：'), 0.475, '#9f1239', 14);
            field('🫀 ' + t('Know your blood pressure', '了解您的血压', '了解您的血壓'), 0.525, '#e11d48', 14);
            field('🚭 ' + t('Don\'t smoke — quit today', '不吸烟 — 今日戒烟', '不吸煙 — 今日戒煙'), 0.572, '#e11d48', 14);
            field('🥦 ' + t('Eat less salt, fat & sugar', '减少盐、脂肪及糖', '減少鹽、脂肪及糖'), 0.619, '#e11d48', 14);
            field('🏃 ' + t('Exercise at least 5×/week', '每周至少运动5次', '每週至少運動5次'), 0.666, '#e11d48', 14);
            field('😌 ' + t('Manage stress levels', '管理压力', '管理壓力'), 0.713, '#e11d48', 14);
            divider(0.766, '#fda4af');
            body(t('Regular heart check-ups save lives.', '定期心脏检查可拯救生命。', '定期心臟檢查可拯救生命。'), 0.820, '#881337', 13);
        }

        if (tpl === 'skincheck') {
            setBgInput('#fefce8');
            _canvas.setBackgroundColor('#fefce8', function () { _canvas.renderAll(); });
            header('#a16207', 0.18); cnHeader('#fef08a', 0.068, 24);
            add(txt('☀️', { left: W/2, top: Math.round(H*0.260),
                fontSize: sf(56), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Sun Safety & Skin Check', '防晒及皮肤检查', '防曬及皮膚檢查'), 0.365, '#713f12', 26);
            divider(0.425, '#fde047');
            body(t('Protect your skin every day:', '每天保护您的皮肤：', '每天保護您的皮膚：'), 0.475, '#a16207', 14);
            field('🧴 ' + t('Apply SPF 30+ sunscreen daily', '每天使用SPF 30+防晒霜', '每天使用SPF 30+防曬霜'), 0.525, '#ca8a04', 14);
            field('👒 ' + t('Wear hat & sunglasses outdoors', '户外活动时戴帽子及太阳镜', '戶外活動時戴帽子及太陽鏡'), 0.572, '#ca8a04', 14);
            field('🕐 ' + t('Avoid peak sun hours 10am–4pm', '避开高峰日照时段10am–4pm', '避開高峰日照時段10am–4pm'), 0.619, '#ca8a04', 14);
            field('🔍 ' + t('Check moles monthly for changes', '每月检查痣的变化', '每月檢查痣的變化'), 0.666, '#ca8a04', 14);
            divider(0.725, '#fde047');
            body(t('Concerned about a mole or skin change?\nBook a skin check today.',
                   '担心痣或皮肤变化？今日预约皮肤检查。',
                   '擔心痣或皮膚變化？今日預約皮膚檢查。'), 0.795, '#713f12', 13);
        }

        if (tpl === 'covidcare') {
            setBgInput('#f0f9ff');
            _canvas.setBackgroundColor('#f0f9ff', function () { _canvas.renderAll(); });
            header('#0369a1', 0.18); cnHeader('#bae6fd', 0.068, 24);
            add(txt('😷', { left: W/2, top: Math.round(H*0.260),
                fontSize: sf(56), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Infection Control', '感染控制', '感染控制'), 0.365, '#0c4a6e', 30);
            divider(0.425, '#7dd3fc');
            body(t('Help keep our clinic safe for everyone:',
                   '协助保持诊所安全环境：',
                   '協助保持診所安全環境：'), 0.475, '#0369a1', 14);
            field('😷 ' + t('Wear a mask if you have symptoms', '有症状时请佩戴口罩', '有症狀時請佩戴口罩'), 0.525, '#0284c7', 14);
            field('🧼 ' + t('Wash hands on arrival', '到达时请洗手', '到達時請洗手'), 0.572, '#0284c7', 14);
            field('📏 ' + t('Maintain safe distancing', '保持安全距离', '保持安全距離'), 0.619, '#0284c7', 14);
            field('🏠 ' + t('Stay home if unwell', '若身体不适请留在家中', '若身體不適請留在家中'), 0.666, '#0284c7', 14);
            field('🤧 ' + t('Cover coughs & sneezes', '咳嗽及打喷嚏时遮掩口鼻', '咳嗽及打噴嚏時遮掩口鼻'), 0.713, '#0284c7', 14);
            divider(0.765, '#7dd3fc');
            body(t('Thank you for protecting our community.',
                   '感谢您保护我们的社区。',
                   '感謝您保護我們的社區。'), 0.820, '#0c4a6e', 13);
        }

        if (tpl === 'staffwanted') {
            setBgInput('#faf5ff');
            _canvas.setBackgroundColor('#faf5ff', function () { _canvas.renderAll(); });
            header('#7c3aed', 0.20); cnHeader('#e9d5ff', 0.085, 24);
            add(txt('📣', { left: W/2, top: Math.round(H*0.285),
                fontSize: sf(56), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('We Are Hiring!', '我们正在招聘！', '我們正在招聘！'), 0.395, '#5b21b6', 30);
            divider(0.455, '#ddd6fe');
            body(t('Join our dedicated healthcare team.', '加入我们专业的医疗团队。', '加入我們專業的醫療團隊。'), 0.510, '#6d28d9', 15);
            field('👩‍⚕️ ' + t('Position : ___________________________', '职位：___________________________', '職位：___________________________'), 0.570, '#5b21b6');
            field('📅 ' + t('Start Date : ___________________________', '开始日期：___________________________', '開始日期：___________________________'), 0.635, '#5b21b6');
            field('📍 ' + t('Location : ' + cn, '地点：' + cn, '地點：' + cn), 0.700, '#5b21b6');
            divider(0.763, '#ddd6fe');
            body(t('Send your resume to:\n___________________________',
                   '请将履历发送至：\n___________________________',
                   '請將履歷發送至：\n___________________________'), 0.820, '#6d28d9', 14);
            footer('#7c3aed', 0.07);
        }

        if (tpl === 'childvax') {
            setBgInput('#f0fdfa');
            _canvas.setBackgroundColor('#f0fdfa', function () { _canvas.renderAll(); });
            header('#0d9488', 0.16); cnHeader('#99f6e4', 0.065, 22);
            add(txt('👶', { left: W/2, top: Math.round(H*0.230),
                fontSize: sf(50), originX:'center', originY:'center', selectable:false, evented:false }));
            bigTitle(t('Child Vaccination Schedule', '儿童疫苗接种时间表', '兒童疫苗接種時間表'), 0.330, '#134e4a', 24);
            divider(0.385, '#5eead4');
            function vaxRow(age, vaccine, yFrac, bgcol) {
                add(rect({ left: Math.round(W*0.05), top: Math.round(H*yFrac),
                    width: Math.round(W*0.90), height: Math.round(H*0.062),
                    fill: bgcol, rx: sf(6), selectable:false, evented:false }));
                add(txt(age, { left: Math.round(W*0.09), top: Math.round(H*(yFrac+0.031)),
                    fontSize: sf(12), fill:'#134e4a', fontWeight:'bold', originY:'center' }));
                add(txt(vaccine, { left: Math.round(W*0.32), top: Math.round(H*(yFrac+0.031)),
                    fontSize: sf(12), fill:'#0f766e', originY:'center' }));
            }
            vaxRow(t('Birth','出生','出生'),    'BCG, Hep B',                       0.400, '#ccfbf1');
            vaxRow('2 m',                        'DTaP, IPV, Hib, PCV',             0.470, '#99f6e4');
            vaxRow('4 m',                        'DTaP, IPV, Hib, PCV, Rota',       0.540, '#ccfbf1');
            vaxRow('6 m',                        'DTaP, Hep B, Flu',                0.610, '#99f6e4');
            vaxRow('12 m',                       'MMR, Varicella, PCV booster',     0.680, '#ccfbf1');
            vaxRow('18 m',                       'DTaP booster, IPV booster',       0.750, '#99f6e4');
            divider(0.820, '#5eead4');
            body(t('Consult your doctor for personalised advice.',
                   '请咨询医生以获取个性化建议。',
                   '請諮詢醫生以獲取個性化建議。'), 0.870, '#134e4a', 12);
        }

        // ════════════════════════════════════════════════════════
        //  DENTAL EDUCATION
        // ════════════════════════════════════════════════════════
        if (tpl === 'de_brushing') {
            bgFill('#eff6ff');
            sideBar('#2563eb', 0.03);
            header('#2563eb', 0.17); cnHeader('#dbeafe', 0.06, 22);
            blob('#3b82f6', W, Math.round(H * 0.17), sf(60), 0.30);
            bigTitle('🪥 ' + t('How to Brush Correctly', '正确刷牙方法', '正確刷牙方法'), 0.245, '#1e3a8a', 26);
            body(t('Five easy steps for a healthy smile.', '五个简单步骤，笑容更健康。', '五個簡單步驟，笑容更健康。'), 0.305, '#2563eb', 13);
            divider(0.355, '#bfdbfe');
            stepRow(1, t('Use a pea-sized amount of fluoride paste.', '使用豌豆大小的含氟牙膏。', '使用豌豆大小的含氟牙膏。'), 0.43, '#2563eb', '#1e3a8a');
            stepRow(2, t('Angle the brush 45° to the gumline.', '牙刷与牙龈成45度角。', '牙刷與牙齦成45度角。'), 0.52, '#2563eb', '#1e3a8a');
            stepRow(3, t('Brush gently in small circles.', '以小圈方式轻柔刷牙。', '以小圈方式輕柔刷牙。'), 0.61, '#2563eb', '#1e3a8a');
            stepRow(4, t('Brush 2 minutes, twice a day.', '每天刷牙两次，每次2分钟。', '每天刷牙兩次，每次2分鐘。'), 0.70, '#2563eb', '#1e3a8a');
            stepRow(5, t('Brush your tongue, then rinse.', '清洁舌头，然后漱口。', '清潔舌頭，然後漱口。'), 0.79, '#2563eb', '#1e3a8a');
            footer('#2563eb', 0.06);
            body('— ' + cn + ' —', 0.955, '#dbeafe', 11);
        }

        if (tpl === 'de_flossing') {
            bgFill('#f0fdfa');
            sideBar('#0d9488', 0.03);
            header('#0d9488', 0.17); cnHeader('#ccfbf1', 0.06, 22);
            blob('#14b8a6', 0, Math.round(H * 0.17), sf(55), 0.30);
            bigTitle('🧵 ' + t('Flossing 101', '牙线使用指南', '牙線使用指南'), 0.245, '#0f766e', 27);
            body(t("Clean where your brush can't reach.", '清洁牙刷无法触及的地方。', '清潔牙刷無法觸及的地方。'), 0.305, '#0d9488', 13);
            divider(0.355, '#99f6e4');
            stepRow(1, t('Use about 45 cm of dental floss.', '取约45厘米长的牙线。', '取約45厘米長的牙線。'), 0.43, '#0d9488', '#134e4a');
            stepRow(2, t('Wrap around fingers, hold it tight.', '缠绕手指并拉紧。', '纏繞手指並拉緊。'), 0.52, '#0d9488', '#134e4a');
            stepRow(3, t('Glide gently between each tooth.', '轻柔滑入每颗牙缝。', '輕柔滑入每顆牙縫。'), 0.61, '#0d9488', '#134e4a');
            stepRow(4, t("Curve into a 'C' against the tooth.", '沿牙面弯成C形。', '沿牙面彎成C形。'), 0.70, '#0d9488', '#134e4a');
            stepRow(5, t('Floss once every day.', '每天使用牙线一次。', '每天使用牙線一次。'), 0.79, '#0d9488', '#134e4a');
            footer('#0d9488', 0.06);
            body('— ' + cn + ' —', 0.955, '#ccfbf1', 11);
        }

        if (tpl === 'de_cavity') {
            bgFill('#fff1f2');
            header('#dc2626', 0.18); cnHeader('#fecaca', 0.065, 22);
            add(txt('🦷', { left: W / 2, top: Math.round(H * 0.265), fontSize: sf(52),
                originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Understanding Cavities', '认识蛀牙', '認識蛀牙'), 0.375, '#991b1b', 28);
            divider(0.435, '#fca5a5');
            body(t('How tooth decay happens — and how to stop it:', '蛀牙如何形成，以及如何预防：', '蛀牙如何形成，以及如何預防：'), 0.485, '#b91c1c', 13);
            field('🍭 ' + t('Sugar feeds harmful mouth bacteria', '糖分滋养有害口腔细菌', '糖分滋養有害口腔細菌'), 0.545, '#dc2626', 14);
            field('🦠 ' + t('Bacteria make enamel-eroding acid', '细菌产生侵蚀牙釉质的酸', '細菌產生侵蝕牙釉質的酸'), 0.595, '#dc2626', 14);
            field('🕳️ ' + t('Untreated decay reaches the nerve', '未治疗的蛀牙会伤及牙神经', '未治療的蛀牙會傷及牙神經'), 0.645, '#dc2626', 14);
            field('✅ ' + t('Prevent: brush, floss & check-ups', '预防：刷牙、牙线及定期检查', '預防：刷牙、牙線及定期檢查'), 0.695, '#16a34a', 14);
            divider(0.755, '#fca5a5');
            body(t('Early decay is painless — regular checks catch it.', '早期蛀牙无痛，定期检查及早发现。', '早期蛀牙無痛，定期檢查及早發現。'), 0.815, '#991b1b', 13);
            body('— ' + cn + ' —', 0.885, '#f87171', 12);
        }

        if (tpl === 'de_gum') {
            bgFill('#fdf2f8');
            header('#be185d', 0.18); cnHeader('#fbcfe8', 0.065, 22);
            add(txt('🩸', { left: W / 2, top: Math.round(H * 0.265), fontSize: sf(50),
                originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Gum Disease Awareness', '牙周病警觉', '牙周病警覺'), 0.375, '#9d174d', 26);
            divider(0.435, '#f9a8d4');
            body(t('Watch for these early warning signs:', '留意以下早期警示信号：', '留意以下早期警示信號：'), 0.485, '#be185d', 13);
            field('🔴 ' + t('Red, swollen or tender gums', '牙龈红肿或触痛', '牙齦紅腫或觸痛'), 0.545, '#be185d', 14);
            field('🩸 ' + t('Gums bleed when brushing', '刷牙时牙龈出血', '刷牙時牙齦出血'), 0.595, '#be185d', 14);
            field('😮‍💨 ' + t('Persistent bad breath', '持续口臭', '持續口臭'), 0.645, '#be185d', 14);
            field('🦷 ' + t('Loose or shifting teeth', '牙齿松动或移位', '牙齒鬆動或移位'), 0.695, '#be185d', 14);
            divider(0.755, '#f9a8d4');
            body(t("Healthy gums don't bleed. See us early!", '健康牙龈不出血，请及早求诊！', '健康牙齦不出血，請及早求診！'), 0.815, '#9d174d', 13);
            body('— ' + cn + ' —', 0.885, '#f472b6', 12);
        }

        if (tpl === 'de_kidsteeth') {
            bgFill('#fef9c3');
            sideBar('#ca8a04', 0.03);
            header('#ca8a04', 0.17); cnHeader('#fef08a', 0.06, 22);
            add(txt('🧒', { left: W / 2, top: Math.round(H * 0.255), fontSize: sf(46),
                originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Healthy Smiles for Kids', '孩子的健康笑容', '孩子的健康笑容'), 0.355, '#854d0e', 25);
            divider(0.415, '#fde047');
            field('🪥 ' + t('Start brushing at the first tooth', '长第一颗牙就开始刷牙', '長第一顆牙就開始刷牙'), 0.470, '#a16207', 14);
            field('⏳ ' + t('Supervise brushing until age 7', '7岁前需协助刷牙', '7歲前需協助刷牙'), 0.520, '#a16207', 14);
            field('🍬 ' + t('Limit sweets & sugary drinks', '限制糖果及含糖饮料', '限制糖果及含糖飲料'), 0.570, '#a16207', 14);
            field('🦷 ' + t('First dental visit by age 1', '一岁前首次看牙医', '一歲前首次看牙醫'), 0.620, '#a16207', 14);
            field('😀 ' + t('Make brushing fun together!', '让刷牙成为亲子乐趣！', '讓刷牙成為親子樂趣！'), 0.670, '#a16207', 14);
            divider(0.730, '#fde047');
            body(t('Good habits early mean lifelong smiles.', '及早养成好习惯，笑容伴一生。', '及早養成好習慣，笑容伴一生。'), 0.790, '#854d0e', 13);
            body('— ' + cn + ' —', 0.860, '#eab308', 12);
        }

        if (tpl === 'de_diet') {
            bgFill('#f0fdf4');
            header('#15803d', 0.18); cnHeader('#bbf7d0', 0.065, 22);
            bigTitle('🍎 ' + t('Eat Well for Strong Teeth', '健康饮食强健牙齿', '健康飲食強健牙齒'), 0.28, '#14532d', 25);
            divider(0.345, '#86efac');
            body(t('Smart food choices protect your teeth:', '聪明的饮食选择保护牙齿：', '聰明的飲食選擇保護牙齒：'), 0.400, '#15803d', 13);
            field('✅ ' + t('Cheese, milk & yoghurt (calcium)', '芝士、牛奶及乳酪（钙质）', '芝士、牛奶及乳酪（鈣質）'), 0.455, '#16a34a', 14);
            field('✅ ' + t('Crunchy fruit & vegetables', '爽脆的水果与蔬菜', '爽脆的水果與蔬菜'), 0.505, '#16a34a', 14);
            field('✅ ' + t('Water instead of soft drinks', '以清水代替汽水', '以清水代替汽水'), 0.555, '#16a34a', 14);
            field('❌ ' + t('Sticky sweets & sugary snacks', '黏性糖果及含糖零食', '黏性糖果及含糖零食'), 0.615, '#dc2626', 14);
            field('❌ ' + t('Frequent snacking between meals', '两餐之间频繁进食', '兩餐之間頻繁進食'), 0.665, '#dc2626', 14);
            divider(0.725, '#86efac');
            body(t('Rinse with water after sugary treats.', '吃甜食后用清水漱口。', '吃甜食後用清水漱口。'), 0.785, '#14532d', 13);
            body('— ' + cn + ' —', 0.855, '#4ade80', 12);
        }

        if (tpl === 'de_whitening') {
            bgFill('#faf5ff');
            header('#7c3aed', 0.18); cnHeader('#e9d5ff', 0.065, 22);
            add(txt('✨', { left: W / 2, top: Math.round(H * 0.265), fontSize: sf(48),
                originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Teeth Whitening Facts', '牙齿美白真相', '牙齒美白真相'), 0.375, '#5b21b6', 27);
            divider(0.435, '#ddd6fe');
            field('❌ ' + t('Myth: Whitening ruins your enamel', '误解：美白会破坏牙釉质', '誤解：美白會破壞牙釉質'), 0.495, '#dc2626', 14);
            field('✅ ' + t('Fact: Professional whitening is safe', '事实：专业美白安全可靠', '事實：專業美白安全可靠'), 0.545, '#16a34a', 14);
            field('❌ ' + t('Myth: Results last forever', '误解：效果永久不变', '誤解：效果永久不變'), 0.610, '#dc2626', 14);
            field('✅ ' + t('Fact: Touch-ups keep it bright', '事实：定期护理保持亮白', '事實：定期護理保持亮白'), 0.660, '#16a34a', 14);
            divider(0.725, '#ddd6fe');
            chip(t('Ask us about professional whitening', '向我们查询专业美白', '向我們查詢專業美白'), 0.775, '#7c3aed', '#ffffff', 13);
            body('— ' + cn + ' —', 0.875, '#a78bfa', 12);
        }

        if (tpl === 'de_implant') {
            bgFill('#f0f9ff');
            sideBar('#0369a1', 0.03);
            header('#0369a1', 0.17); cnHeader('#bae6fd', 0.06, 22);
            add(txt('🔩', { left: W / 2, top: Math.round(H * 0.255), fontSize: sf(44),
                originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Dental Implants', '植牙修复', '植牙修復'), 0.355, '#0c4a6e', 28);
            body(t('A permanent solution for missing teeth.', '缺牙的永久解决方案。', '缺牙的永久解決方案。'), 0.420, '#0369a1', 14);
            divider(0.475, '#7dd3fc');
            field('✔ ' + t('Look & feel like natural teeth', '外观与触感如真牙', '外觀與觸感如真牙'), 0.530, '#0284c7', 14);
            field('✔ ' + t('Preserve jawbone & face shape', '保护颚骨与脸型', '保護顎骨與臉型'), 0.580, '#0284c7', 14);
            field('✔ ' + t('Eat & speak with confidence', '进食说话更自信', '進食說話更自信'), 0.630, '#0284c7', 14);
            field('✔ ' + t('Long-lasting with good care', '悉心护理可长久使用', '悉心護理可長久使用'), 0.680, '#0284c7', 14);
            divider(0.740, '#7dd3fc');
            chip(t('Book a consultation today', '今日预约咨询', '今日預約諮詢'), 0.790, '#0369a1', '#ffffff', 13);
            body('📞 ___________________________', 0.885, '#0c4a6e', 15);
        }

        if (tpl === 'de_braces') {
            bgFill('#eef2ff');
            header('#4338ca', 0.18); cnHeader('#c7d2fe', 0.065, 22);
            add(txt('😁', { left: W / 2, top: Math.round(H * 0.265), fontSize: sf(48),
                originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Braces & Orthodontics', '牙齿矫正', '牙齒矯正'), 0.375, '#3730a3', 27);
            body(t('Straighter teeth, healthier bite.', '牙齿更整齐，咬合更健康。', '牙齒更整齊，咬合更健康。'), 0.435, '#4338ca', 14);
            divider(0.490, '#a5b4fc');
            field('🦷 ' + t('Correct crowding & gaps', '矫正牙齿拥挤与缝隙', '矯正牙齒擁擠與縫隙'), 0.545, '#4f46e5', 14);
            field('😬 ' + t('Fix bite & alignment issues', '改善咬合与排列问题', '改善咬合與排列問題'), 0.595, '#4f46e5', 14);
            field('✨ ' + t('Metal, ceramic or clear aligners', '金属、陶瓷或隐形牙套', '金屬、陶瓷或隱形牙套'), 0.645, '#4f46e5', 14);
            field('🕐 ' + t('Treatment usually 12–24 months', '疗程一般为12至24个月', '療程一般為12至24個月'), 0.695, '#4f46e5', 14);
            divider(0.755, '#a5b4fc');
            chip(t('Free orthodontic assessment', '免费矫齿评估', '免費矯齒評估'), 0.805, '#4338ca', '#ffffff', 13);
            body('— ' + cn + ' —', 0.895, '#818cf8', 12);
        }

        if (tpl === 'de_dentalemer') {
            bgFill('#fff1f2');
            header('#b91c1c', 0.18); cnHeader('#fecaca', 0.065, 22);
            add(txt('🚑', { left: W / 2, top: Math.round(H * 0.265), fontSize: sf(50),
                originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Dental Emergency? Act Fast', '牙科急症？立即处理', '牙科急症？立即處理'), 0.375, '#7f1d1d', 24);
            divider(0.435, '#fca5a5');
            field('🦷 ' + t('Knocked-out tooth: keep it in milk', '牙齿脱落：放入牛奶保存', '牙齒脫落：放入牛奶保存'), 0.495, '#dc2626', 14);
            field('🩸 ' + t('Bleeding: apply gentle pressure', '出血：轻压止血', '出血：輕壓止血'), 0.550, '#dc2626', 14);
            field('🧊 ' + t('Swelling: use a cold compress', '肿胀：冷敷患处', '腫脹：冷敷患處'), 0.605, '#dc2626', 14);
            field('💊 ' + t('Pain: rinse with warm salt water', '疼痛：以温盐水漱口', '疼痛：以溫鹽水漱口'), 0.660, '#dc2626', 14);
            divider(0.720, '#fca5a5');
            badge('#b91c1c', 0.765, 0.80, 0.085);
            add(txt('📞 ' + t('Call us now: ___________', '立即致电：___________', '立即致電：___________'), {
                left: W / 2, top: Math.round(H * 0.807), fontSize: sf(15),
                fill: '#ffffff', fontWeight: 'bold', textAlign: 'center', originX: 'center' }));
            body('— ' + cn + ' —', 0.905, '#f87171', 12);
        }

        // ════════════════════════════════════════════════════════
        //  EVENTS & INFO DISPLAY
        // ════════════════════════════════════════════════════════
        if (tpl === 'ev_healthtalk') {
            bgFill('#eff6ff');
            header('#1d4ed8', 0.22); cnHeader('#dbeafe', 0.055, 20);
            blob('#3b82f6', W, 0, sf(70), 0.25);
            eyebrow(t('FREE HEALTH TALK', '免费健康讲座', '免費健康講座'), 0.135, '#bfdbfe', 12);
            bigTitle(t('Health Seminar', '健康讲座', '健康講座'), 0.30, '#1e3a8a', 30);
            body(t('Topic: ___________________________', '主题：___________________________', '主題：___________________________'), 0.365, '#2563eb', 14);
            infoRow('📅', t('Date : ___________', '日期：___________', '日期：___________'), 0.44, '#1d4ed8');
            infoRow('🕐', t('Time : ___________', '时间：___________', '時間：___________'), 0.55, '#1d4ed8');
            infoRow('📍', t('Venue: ___________', '地点：___________', '地點：___________'), 0.66, '#1d4ed8');
            chip(t('Free Admission · All Welcome', '免费入场 · 欢迎参加', '免費入場 · 歡迎參加'), 0.78, '#1d4ed8', '#ffffff', 14);
            body(t('Reserve your seat — call us today!', '预留座位 — 今日致电！', '預留座位 — 今日致電！'), 0.865, '#1e3a8a', 13);
            footer('#1d4ed8', 0.06);
            body('— ' + cn + ' —', 0.955, '#dbeafe', 11);
        }

        if (tpl === 'ev_openday') {
            bgFill('#f0fdfa');
            header('#0d9488', 0.22); cnHeader('#ccfbf1', 0.055, 20);
            blob('#14b8a6', 0, 0, sf(70), 0.25);
            eyebrow(t("YOU'RE INVITED", '诚邀出席', '誠邀出席'), 0.135, '#99f6e4', 12);
            bigTitle('🚪 ' + t('Clinic Open Day', '诊所开放日', '診所開放日'), 0.30, '#0f766e', 28);
            infoRow('📅', t('Date : ___________', '日期：___________', '日期：___________'), 0.40, '#0d9488');
            infoRow('🕐', t('Time : ___________', '时间：___________', '時間：___________'), 0.51, '#0d9488');
            infoRow('📍', t('Venue: ___________', '地点：___________', '地點：___________'), 0.62, '#0d9488');
            body(t('Tours · Free mini check-ups · Meet our team', '导览 · 免费小检查 · 认识团队', '導覽 · 免費小檢查 · 認識團隊'), 0.735, '#0f766e', 13);
            chip(t('Free Entry · Refreshments Provided', '免费入场 · 备有茶点', '免費入場 · 備有茶點'), 0.79, '#0d9488', '#ffffff', 13);
            footer('#0d9488', 0.06);
            body('— ' + cn + ' —', 0.955, '#ccfbf1', 11);
        }

        if (tpl === 'ev_dentalcamp') {
            bgFill('#f0fdf4');
            header('#15803d', 0.22); cnHeader('#bbf7d0', 0.055, 20);
            blob('#22c55e', W, 0, sf(70), 0.25);
            eyebrow(t('COMMUNITY SERVICE', '社区服务', '社區服務'), 0.135, '#86efac', 12);
            bigTitle('⛺ ' + t('Free Dental Check Camp', '免费牙科义诊', '免費牙科義診'), 0.30, '#14532d', 25);
            infoRow('📅', t('Date : ___________', '日期：___________', '日期：___________'), 0.40, '#15803d');
            infoRow('🕐', t('Time : ___________', '时间：___________', '時間：___________'), 0.51, '#15803d');
            infoRow('📍', t('Venue: ___________', '地点：___________', '地點：___________'), 0.62, '#15803d');
            body(t('Includes: oral exam · cleaning advice · Q&A', '包括：口腔检查 · 洁牙建议 · 问答', '包括：口腔檢查 · 潔牙建議 · 問答'), 0.735, '#166534', 13);
            chip(t('Free for All · Bring the Family', '全民免费 · 欢迎全家', '全民免費 · 歡迎全家'), 0.79, '#15803d', '#ffffff', 13);
            footer('#15803d', 0.06);
            body('— ' + cn + ' —', 0.955, '#bbf7d0', 11);
        }

        if (tpl === 'ev_workshop') {
            bgFill('#fff7ed');
            header('#c2410c', 0.22); cnHeader('#fed7aa', 0.055, 20);
            blob('#f97316', 0, 0, sf(70), 0.25);
            eyebrow(t('HANDS-ON WORKSHOP', '实作工作坊', '實作工作坊'), 0.135, '#fdba74', 12);
            bigTitle('🛠 ' + t('Workshop', '工作坊', '工作坊'), 0.30, '#7c2d12', 28);
            body(t('Title: ___________________________', '题目：___________________________', '題目：___________________________'), 0.365, '#c2410c', 14);
            infoRow('📅', t('Date : ___________', '日期：___________', '日期：___________'), 0.44, '#c2410c');
            infoRow('🕐', t('Time : ___________', '时间：___________', '時間：___________'), 0.55, '#c2410c');
            infoRow('📍', t('Venue: ___________', '地点：___________', '地點：___________'), 0.66, '#c2410c');
            body(t('Limited seats — registration required.', '名额有限 — 需预先报名。', '名額有限 — 需預先報名。'), 0.78, '#7c2d12', 13);
            chip(t('Register Now', '立即报名', '立即報名'), 0.83, '#c2410c', '#ffffff', 14);
            footer('#c2410c', 0.06);
            body('— ' + cn + ' —', 0.955, '#fed7aa', 11);
        }

        if (tpl === 'ev_grandopening') {
            bgFill('#fffbeb');
            header('#a16207', 0.20); cnHeader('#fde68a', 0.075, 22);
            blob('#eab308', W, 0, sf(70), 0.28);
            blob('#eab308', 0, 0, sf(60), 0.28);
            eyebrow(t('GRAND OPENING', '盛大开幕', '盛大開幕'), 0.255, '#ca8a04', 14);
            bigTitle('🎀 ' + t('Grand Opening', '盛大开幕', '盛大開幕'), 0.335, '#713f12', 30);
            body(t("We're delighted to welcome you.", '我们诚挚欢迎您的到来。', '我們誠摯歡迎您的到來。'), 0.400, '#a16207', 14);
            infoRow('📅', t('Date : ___________', '日期：___________', '日期：___________'), 0.470, '#a16207');
            infoRow('🕐', t('Time : ___________', '时间：___________', '時間：___________'), 0.580, '#a16207');
            infoRow('📍', t('Address: ___________', '地址：___________', '地址：___________'), 0.690, '#a16207');
            chip(t('Ribbon-Cutting · Gifts · Refreshments', '剪彩 · 礼品 · 茶点', '剪綵 · 禮品 · 茶點'), 0.80, '#a16207', '#ffffff', 13);
            footer('#a16207', 0.06);
            body('— ' + cn + ' —', 0.955, '#fde68a', 11);
        }

        if (tpl === 'ev_anniversary') {
            bgFill('#faf5ff');
            header('#6d28d9', 0.20); cnHeader('#e9d5ff', 0.075, 22);
            blob('#8b5cf6', W, 0, sf(70), 0.25);
            add(txt('🎂', { left: W / 2, top: Math.round(H * 0.29), fontSize: sf(56),
                originX: 'center', originY: 'center', selectable: false, evented: false }));
            eyebrow(t('CELEBRATING TOGETHER', '共同庆祝', '共同慶祝'), 0.395, '#a78bfa', 12);
            bigTitle(t('___ Year Anniversary', '___ 周年庆典', '___ 週年慶典'), 0.465, '#5b21b6', 27);
            body(t('Thank you for your trust over the years.', '感谢您多年来的信任。', '感謝您多年來的信任。'), 0.535, '#6d28d9', 14);
            divider(0.595, '#ddd6fe');
            infoRow('📅', t('Celebration Date : ___________', '庆祝日期：___________', '慶祝日期：___________'), 0.640, '#6d28d9');
            chip(t('Special Thank-You Offers Inside', '内有特别答谢优惠', '內有特別答謝優惠'), 0.775, '#6d28d9', '#ffffff', 13);
            footer('#6d28d9', 0.06);
            body('— ' + cn + ' —', 0.955, '#e9d5ff', 11);
        }

        if (tpl === 'ev_promo') {
            bgFill('#fff1f2');
            header('#dc2626', 0.18); cnHeader('#fecaca', 0.065, 22);
            eyebrow(t('LIMITED TIME OFFER', '限时优惠', '限時優惠'), 0.235, '#ef4444', 13);
            blob('#dc2626', W / 2, Math.round(H * 0.42), sf(95), 1);
            add(txt(t('__% OFF', '__% 折扣', '__% 折扣'), { left: W / 2, top: Math.round(H * 0.42),
                fontSize: sf(42), fill: '#ffffff', fontWeight: 'bold',
                originX: 'center', originY: 'center', selectable: false, evented: false }));
            bigTitle(t('Special Offer', '特别优惠', '特別優惠'), 0.585, '#991b1b', 28);
            body(t('On: ___________________________', '项目：___________________________', '項目：___________________________'), 0.650, '#dc2626', 14);
            body(t('Valid: ___________ to ___________', '有效期：___________ 至 ___________', '有效期：___________ 至 ___________'), 0.705, '#7f1d1d', 13);
            chip(t('Book Now to Save!', '立即预约享优惠！', '立即預約享優惠！'), 0.775, '#dc2626', '#ffffff', 14);
            footer('#dc2626', 0.06);
            body('— ' + cn + ' —', 0.955, '#fecaca', 11);
        }

        if (tpl === 'ev_schedule') {
            bgFill('#f8fafc');
            header('#1e293b', 0.17); cnHeader('#cbd5e1', 0.06, 22);
            bigTitle('🗓 ' + t('Event Schedule', '活动流程', '活動流程'), 0.245, '#0f172a', 26);
            body(t('Event: ___________________________', '活动：___________________________', '活動：___________________________'), 0.305, '#475569', 13);
            divider(0.355, '#e2e8f0');
            (function () {
                function timeRow(time, item, yFrac, bg) {
                    add(rect({ left: Math.round(W * 0.06), top: Math.round(H * yFrac),
                        width: Math.round(W * 0.88), height: Math.round(H * 0.072),
                        fill: bg, rx: sf(8), ry: sf(8), selectable: false, evented: false }));
                    add(txt(time, { left: Math.round(W * 0.10), top: Math.round(H * (yFrac + 0.036)),
                        fontSize: sf(14), fill: '#0f172a', fontWeight: 'bold', originY: 'center' }));
                    add(txt(item, { left: Math.round(W * 0.34), top: Math.round(H * (yFrac + 0.036)),
                        fontSize: sf(14), fill: '#334155', originY: 'center' }));
                }
                timeRow('09:00', t('Registration', '签到登记', '簽到登記'),        0.41, '#e2e8f0');
                timeRow('09:30', t('Welcome & Intro', '欢迎与介绍', '歡迎與介紹'), 0.50, '#f1f5f9');
                timeRow('10:00', t('Main Talk', '主题演讲', '主題演講'),           0.59, '#e2e8f0');
                timeRow('11:00', t('Q&A Session', '问答环节', '問答環節'),         0.68, '#f1f5f9');
                timeRow('11:30', t('Refreshments', '茶点交流', '茶點交流'),        0.77, '#e2e8f0');
            })();
            divider(0.855, '#e2e8f0');
            body('— ' + cn + ' —', 0.905, '#94a3b8', 12);
        }

        if (tpl === 'ev_webinar') {
            bgFill('#ecfeff');
            header('#0891b2', 0.20); cnHeader('#a5f3fc', 0.075, 22);
            blob('#06b6d4', W, 0, sf(70), 0.25);
            add(txt('💻', { left: W / 2, top: Math.round(H * 0.275), fontSize: sf(48),
                originX: 'center', originY: 'center', selectable: false, evented: false }));
            eyebrow(t('ONLINE WEBINAR', '网络研讨会', '網路研討會'), 0.375, '#67e8f9', 12);
            bigTitle(t('Live Webinar', '线上讲座', '線上講座'), 0.440, '#164e63', 27);
            body(t('Topic: ___________________________', '主题：___________________________', '主題：___________________________'), 0.505, '#0e7490', 13);
            infoRow('📅', t('Date : ___________', '日期：___________', '日期：___________'), 0.560, '#0891b2');
            infoRow('🕐', t('Time : ___________', '时间：___________', '時間：___________'), 0.660, '#0891b2');
            chip(t('Join Free · Link Below', '免费参加 · 连结如下', '免費參加 · 連結如下'), 0.780, '#0891b2', '#ffffff', 13);
            body('🔗 ___________________________', 0.870, '#164e63', 14);
        }

        if (tpl === 'ev_charity') {
            bgFill('#fff1f2');
            header('#be123c', 0.20); cnHeader('#fecdd3', 0.075, 22);
            blob('#f43f5e', 0, 0, sf(70), 0.25);
            add(txt('🤝', { left: W / 2, top: Math.round(H * 0.275), fontSize: sf(50),
                originX: 'center', originY: 'center', selectable: false, evented: false }));
            eyebrow(t('COMMUNITY EVENT', '社区活动', '社區活動'), 0.375, '#fda4af', 12);
            bigTitle(t('Charity Health Drive', '慈善健康活动', '慈善健康活動'), 0.440, '#881337', 26);
            infoRow('📅', t('Date : ___________', '日期：___________', '日期：___________'), 0.510, '#be123c');
            infoRow('🕐', t('Time : ___________', '时间：___________', '時間：___________'), 0.610, '#be123c');
            infoRow('📍', t('Venue: ___________', '地点：___________', '地點：___________'), 0.710, '#be123c');
            chip(t('Together for a Healthier Community', '携手共建健康社区', '攜手共建健康社區'), 0.82, '#be123c', '#ffffff', 12);
            body('— ' + cn + ' —', 0.915, '#fda4af', 12);
        }

        _canvas.renderAll();
        _pauseHistory = false;
        snapshotHistory();
    }

    // ── Export system ─────────────────────────────────────────────

    function exportMultiplier() {
        // Convert from logical-pixel scale to canvas pixel multiplier
        return _expScale / (_canvas._pmScale || 1);
    }

    // Returns the output pixel dimensions for the current settings
    function exportDims() {
        if (!_canvas) return { w: 0, h: 0 };
        var m = exportMultiplier();
        return {
            w: Math.round(_canvas.getWidth()  * m),
            h: Math.round(_canvas.getHeight() * m)
        };
    }

    // Rough file-size hint (shown before download)
    function updateSizeHint() {
        var hint = g('pm-size-hint');
        if (!hint || !_canvas) return;
        var d = exportDims();
        var px = d.w * d.h;
        var bytes;
        if (_expFmt === 'png')  bytes = px * 1.5;          // rough PNG compression
        if (_expFmt === 'jpg')  bytes = px * (_expQual / 100) * 0.35;
        if (_expFmt === 'bmp')  bytes = px * 3 + 54;
        if (_expFmt === 'tiff') bytes = px * 3 + 200;
        if (_expFmt === 'pdf')  bytes = px * (_expQual / 100) * 0.35 + 5000;
        var kb = bytes / 1024;
        var label = kb > 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.round(kb) + ' KB';
        hint.textContent = d.w + '×' + d.h + ' px  ~' + label;
    }

    // Download helper — URL
    function dlUrl(url, filename) {
        var a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
    }
    // Download helper — Blob
    function dlBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        dlUrl(url, filename);
        setTimeout(function () { URL.revokeObjectURL(url); }, 8000);
    }

    // Render canvas to an off-screen canvas at target resolution and call back with ImageData
    function renderOffscreen(multiplier) {
        return new Promise(function (resolve) {
            var dataUrl = _canvas.toDataURL({ format: 'png', multiplier: multiplier });
            var img = new Image();
            img.onload = function () {
                var c = document.createElement('canvas');
                c.width = img.width; c.height = img.height;
                c.getContext('2d').drawImage(img, 0, 0);
                resolve({ canvas: c, imageData: c.getContext('2d').getImageData(0, 0, c.width, c.height) });
            };
            img.src = dataUrl;
        });
    }

    // ── Pure-JS BMP encoder (24-bit uncompressed) ─────────────────
    function encodeBmp(rgba, W, H) {
        var rowSize = Math.floor((24 * W + 31) / 32) * 4; // padded to 4-byte boundary
        var pixBytes = rowSize * H;
        var buf = new ArrayBuffer(54 + pixBytes);
        var v = new DataView(buf), le = true;
        // File header
        v.setUint8(0, 0x42); v.setUint8(1, 0x4D);
        v.setUint32(2, 54 + pixBytes, le);
        v.setUint32(6, 0, le);
        v.setUint32(10, 54, le);
        // BITMAPINFOHEADER
        v.setUint32(14, 40, le);
        v.setInt32(18, W, le);
        v.setInt32(22, H, le);          // positive = bottom-to-top rows
        v.setUint16(26, 1, le);         // planes
        v.setUint16(28, 24, le);        // bpp
        v.setUint32(30, 0, le);         // compression = none
        v.setUint32(34, pixBytes, le);
        v.setInt32(38, 3780, le);       // ~96 DPI x
        v.setInt32(42, 3780, le);       // ~96 DPI y
        v.setUint32(46, 0, le); v.setUint32(50, 0, le);
        // Pixel data — BMP rows are bottom-to-top, channels are BGR
        var off = 54;
        for (var y = H - 1; y >= 0; y--) {
            for (var x = 0; x < W; x++) {
                var pi = (y * W + x) * 4;
                v.setUint8(off++, rgba[pi + 2]); // B
                v.setUint8(off++, rgba[pi + 1]); // G
                v.setUint8(off++, rgba[pi]);      // R
            }
            for (var p = 0; p < rowSize - W * 3; p++) v.setUint8(off++, 0); // padding
        }
        return new Blob([buf], { type: 'image/bmp' });
    }

    // ── Pure-JS TIFF encoder (uncompressed baseline, little-endian) ──
    function encodeTiff(rgba, W, H) {
        var rgb = new Uint8Array(W * H * 3);
        for (var i = 0; i < W * H; i++) {
            rgb[i * 3]     = rgba[i * 4];
            rgb[i * 3 + 1] = rgba[i * 4 + 1];
            rgb[i * 3 + 2] = rgba[i * 4 + 2];
        }
        var N_TAGS   = 13;
        var HDR      = 8;
        var IFD_SIZE = 2 + N_TAGS * 12 + 4;
        var BPS_OFF  = HDR + IFD_SIZE;           // BitsPerSample: 3×SHORT = 6 bytes
        var XRES_OFF = BPS_OFF + 6;              // XResolution: RATIONAL = 8 bytes
        var YRES_OFF = XRES_OFF + 8;             // YResolution: RATIONAL = 8 bytes
        var PIX_OFF  = YRES_OFF + 8;
        var buf = new ArrayBuffer(PIX_OFF + rgb.length);
        var v = new DataView(buf), le = true;

        // Header: II + magic 42 + IFD offset
        v.setUint8(0, 0x49); v.setUint8(1, 0x49);
        v.setUint16(2, 42, le);
        v.setUint32(4, HDR, le);

        // IFD
        var p = HDR;
        v.setUint16(p, N_TAGS, le); p += 2;
        function tag(t, type, count, val) {
            v.setUint16(p, t, le); v.setUint16(p+2, type, le);
            v.setUint32(p+4, count, le); v.setUint32(p+8, val, le);
            p += 12;
        }
        tag(256, 4, 1, W);           // ImageWidth
        tag(257, 4, 1, H);           // ImageLength
        tag(258, 3, 3, BPS_OFF);     // BitsPerSample → offset (3 shorts)
        tag(259, 3, 1, 1);           // Compression = None
        tag(262, 3, 1, 2);           // PhotometricInterpretation = RGB
        tag(273, 4, 1, PIX_OFF);     // StripOffsets
        tag(277, 3, 1, 3);           // SamplesPerPixel
        tag(278, 4, 1, H);           // RowsPerStrip
        tag(279, 4, 1, rgb.length);  // StripByteCounts
        tag(282, 5, 1, XRES_OFF);    // XResolution → offset
        tag(283, 5, 1, YRES_OFF);    // YResolution → offset
        tag(284, 3, 1, 1);           // PlanarConfiguration = chunky
        tag(296, 3, 1, 2);           // ResolutionUnit = inch
        v.setUint32(p, 0, le);       // next IFD = 0

        // Extra values
        v.setUint16(BPS_OFF, 8, le); v.setUint16(BPS_OFF+2, 8, le); v.setUint16(BPS_OFF+4, 8, le);
        v.setUint32(XRES_OFF, 96, le);   v.setUint32(XRES_OFF+4, 1, le);
        v.setUint32(YRES_OFF, 96, le);   v.setUint32(YRES_OFF+4, 1, le);

        new Uint8Array(buf, PIX_OFF).set(rgb);
        return new Blob([buf], { type: 'image/tiff' });
    }

    // ── jsPDF lazy loader ─────────────────────────────────────────
    function ensureJsPdfLocal() {
        if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
        return loadScript(CDN_JSPDF).then(function () {
            if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not found');
            return window.jspdf.jsPDF;
        });
    }

    // ── Main export dispatcher ────────────────────────────────────
    function doExport() {
        if (!_canvas) return Promise.resolve();
        var m    = exportMultiplier();
        var fmt  = _expFmt;
        var qual = _expQual / 100;

        if (fmt === 'png') {
            var url = _canvas.toDataURL({ format: 'png', multiplier: m });
            dlUrl(url, 'clinic-poster.png');
            return Promise.resolve();
        }

        if (fmt === 'jpg') {
            var url = _canvas.toDataURL({ format: 'jpeg', multiplier: m, quality: qual });
            dlUrl(url, 'clinic-poster.jpg');
            return Promise.resolve();
        }

        if (fmt === 'bmp') {
            return renderOffscreen(m).then(function (r) {
                dlBlob(encodeBmp(r.imageData.data, r.canvas.width, r.canvas.height), 'clinic-poster.bmp');
            });
        }

        if (fmt === 'tiff') {
            return renderOffscreen(m).then(function (r) {
                dlBlob(encodeTiff(r.imageData.data, r.canvas.width, r.canvas.height), 'clinic-poster.tiff');
            });
        }

        if (fmt === 'pdf') {
            var jpegUrl = _canvas.toDataURL({ format: 'jpeg', multiplier: m, quality: qual });
            return ensureJsPdfLocal().then(function (jsPDF) {
                var d   = exportDims();
                var ori = d.w >= d.h ? 'landscape' : 'portrait';
                var pdf = new jsPDF({ orientation: ori, unit: 'pt', format: 'a4' });
                var pw  = pdf.internal.pageSize.getWidth();
                var ph  = pdf.internal.pageSize.getHeight();
                var mg  = 20;
                var iw  = pw - mg * 2;
                var ih  = iw * d.h / d.w;
                if (ih > ph - mg * 2) { ih = ph - mg * 2; iw = ih * d.w / d.h; }
                var ox  = (pw - iw) / 2;
                var oy  = (ph - ih) / 2;
                pdf.addImage(jpegUrl, 'JPEG', ox, oy, iw, ih);
                pdf.save('clinic-poster.pdf');
            });
        }

        return Promise.resolve();
    }

    function doPrint() {
        if (!_canvas) return;
        var m = 1 / (_canvas._pmScale || 1);
        var dataUrl = _canvas.toDataURL({ format: 'png', multiplier: m });
        var w = window.open('', '_blank', 'width=900,height=1100');
        if (!w) return;
        w.document.write(
            '<!doctype html><html><head><meta charset="utf-8">' +
            '<title>' + esc(t('Clinic Poster', '诊所海报', '診所海報')) + '</title>' +
            '<style>*{margin:0;padding:0;box-sizing:border-box;}' +
            'body{display:flex;justify-content:center;align-items:flex-start;min-height:100vh;}' +
            'img{max-width:100%;display:block;}</style></head>' +
            '<body><img src="' + dataUrl + '" onload="window.focus();window.print();"></body></html>'
        );
        w.document.close();
    }

    // ── Expose ────────────────────────────────────────────────────
    window.POSTERMKR = { open: open };

})();
