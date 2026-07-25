// ════════════════════════════════════════════════════════════════
// app-tools.js — Clinic / office utilities (client-side, no server)
//   • MEDCALC  : medical calculators (BMI, BSA, paediatric dose, EDD,
//                eGFR CKD-EPI 2021, age)
//   • QRTOOL   : QR code generator (text / URL / Wi-Fi / phone / email)
//   • PDFUTIL  : PDF utilities (merge, extract, delete, rotate,
//                watermark, compress)
//   • CERTGEN  : certificate / receipt / medicine-label generator
//
// Heavy libraries (qrcode.js, pdf-lib, jsPDF, pdf.js, html2canvas) are
// loaded lazily from jsDelivr only when first needed.
// ════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ── shared CDN endpoints ────────────────────────────────────────
    var CDN = {
        qrcode:      'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
        pdflib:      'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js',
        jspdf:       'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
        pdfjs:       'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
        pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
        html2canvas: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js'
    };

    // ── shared helpers ──────────────────────────────────────────────
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
    function num(v) { var n = parseFloat(v); return isNaN(n) ? NaN : n; }
    function r1(n) { return Math.round(n * 10) / 10; }
    function r2(n) { return Math.round(n * 100) / 100; }

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
    function ensureQRCode() {
        if (window.QRCode) return Promise.resolve(window.QRCode);
        return loadScript(CDN.qrcode).then(function () { return window.QRCode; });
    }
    function ensurePdfLib() {
        if (window.PDFLib) return Promise.resolve(window.PDFLib);
        return loadScript(CDN.pdflib).then(function () { return window.PDFLib; });
    }
    function ensureJsPdf() {
        if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
        return loadScript(CDN.jspdf).then(function () { return window.jspdf.jsPDF; });
    }
    function ensureHtml2Canvas() {
        if (window.html2canvas) return Promise.resolve(window.html2canvas);
        return loadScript(CDN.html2canvas).then(function () { return window.html2canvas; });
    }
    function ensurePdfJs() {
        if (window.pdfjsLib) { setWorker(); return Promise.resolve(window.pdfjsLib); }
        return loadScript(CDN.pdfjs).then(function () { setWorker(); return window.pdfjsLib; });
    }
    function setWorker() {
        try {
            if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions &&
                !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker;
            }
        } catch (e) {}
    }

    function readArrayBuffer(file) {
        return new Promise(function (resolve, reject) {
            var fr = new FileReader();
            fr.onload = function () { resolve(fr.result); };
            fr.onerror = function () { reject(fr.error); };
            fr.readAsArrayBuffer(file);
        });
    }
    function dl(blob, name) {
        var u = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = u; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
    }
    function goBackToTools() {
        if (typeof showOnly === 'function') showOnly('toolsSection');
        else if (typeof showDashboard === 'function') showDashboard();
    }
    // parse "1-3,5,8-9" → 0-based unique indices within [1..count]
    function parseRange(str, count) {
        var out = [], seen = {};
        String(str || '').split(',').forEach(function (part) {
            part = part.trim(); if (!part) return;
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

    // ════════════════════════════════════════════════════════════════
    //  MEDICAL CALCULATORS
    // ════════════════════════════════════════════════════════════════
    var MEDCALC = (function () {
        function open() {
            if (typeof showOnly === 'function') showOnly('medCalcSection');
            render();
        }
        function render() {
            var app = gg('medCalcApp'); if (!app) return;
            app.innerHTML =
                '<p class="ct-intro">' + esc(t(
                    'Quick bedside calculations. All values stay in your browser.',
                    '快速床边计算，所有数据仅保留在你的浏览器中。',
                    '快速床邊計算，所有資料僅保留在你的瀏覽器中。')) + '</p>' +
                '<div class="ct-calc-grid">' +
                    bmiCard() + bsaCard() + pedCard() + eddCard() + egfrCard() + ageCard() +
                '</div>';
            wire();
        }

        function field(label, id, attrs, suffix) {
            return '<label class="ct-field"><span>' + esc(label) + '</span>' +
                '<span class="ct-input-wrap">' +
                '<input id="' + id + '" ' + (attrs || '') + '>' +
                (suffix ? '<em class="ct-unit">' + esc(suffix) + '</em>' : '') +
                '</span></label>';
        }
        function card(title, body, resId) {
            return '<div class="ct-calc-card"><h3>' + esc(title) + '</h3>' +
                '<div class="ct-calc-body">' + body + '</div>' +
                '<div class="ct-calc-result" id="' + resId + '">—</div></div>';
        }

        function bmiCard() {
            return card('⚖️ ' + t('BMI', 'BMI 身体质量指数', 'BMI 身體質量指數'),
                field(t('Weight', '体重', '體重'), 'mc_bmi_w', 'type="number" min="0" step="0.1"', 'kg') +
                field(t('Height', '身高', '身高'), 'mc_bmi_h', 'type="number" min="0" step="0.1"', 'cm'),
                'mc_bmi_r');
        }
        function bsaCard() {
            return card('📐 ' + t('Body Surface Area', '体表面积', '體表面積') + ' (Mosteller)',
                field(t('Weight', '体重', '體重'), 'mc_bsa_w', 'type="number" min="0" step="0.1"', 'kg') +
                field(t('Height', '身高', '身高'), 'mc_bsa_h', 'type="number" min="0" step="0.1"', 'cm'),
                'mc_bsa_r');
        }
        function pedCard() {
            return card('🧒 ' + t('Paediatric Dose', '儿童剂量', '兒童劑量'),
                field(t('Weight', '体重', '體重'), 'mc_ped_w', 'type="number" min="0" step="0.1"', 'kg') +
                field(t('Dose', '剂量', '劑量'), 'mc_ped_d', 'type="number" min="0" step="0.1"', 'mg/kg/day') +
                field(t('Doses / day', '每日次数', '每日次數'), 'mc_ped_f', 'type="number" min="1" step="1" value="3"', '×'),
                'mc_ped_r');
        }
        function eddCard() {
            return card('🤰 ' + t('Due Date (EDD)', '预产期', '預產期'),
                field(t('First day of LMP', '末次月经首日', '末次月經首日'), 'mc_edd_l', 'type="date"', ''),
                'mc_edd_r');
        }
        function egfrCard() {
            return card('🩺 ' + t('eGFR', '肾小球滤过率', '腎絲球過濾率') + ' (CKD-EPI 2021)',
                field(t('Age', '年龄', '年齡'), 'mc_gfr_age', 'type="number" min="1" step="1"', t('years', '岁', '歲')) +
                '<label class="ct-field"><span>' + esc(t('Sex', '性别', '性別')) + '</span>' +
                '<select id="mc_gfr_sex" class="ct-select">' +
                '<option value="m">' + esc(t('Male', '男', '男')) + '</option>' +
                '<option value="f">' + esc(t('Female', '女', '女')) + '</option></select></label>' +
                field(t('Creatinine', '肌酐', '肌酸酐'), 'mc_gfr_scr', 'type="number" min="0" step="0.01"', '') +
                '<label class="ct-field"><span>' + esc(t('Creatinine unit', '肌酐单位', '肌酸酐單位')) + '</span>' +
                '<select id="mc_gfr_unit" class="ct-select">' +
                '<option value="mgdl">mg/dL</option>' +
                '<option value="umol">µmol/L</option></select></label>',
                'mc_gfr_r');
        }
        function ageCard() {
            return card('🎂 ' + t('Age Calculator', '年龄计算', '年齡計算'),
                field(t('Date of birth', '出生日期', '出生日期'), 'mc_age_d', 'type="date"', ''),
                'mc_age_r');
        }

        function wire() {
            ['mc_bmi_w', 'mc_bmi_h'].forEach(bind(calcBmi));
            ['mc_bsa_w', 'mc_bsa_h'].forEach(bind(calcBsa));
            ['mc_ped_w', 'mc_ped_d', 'mc_ped_f'].forEach(bind(calcPed));
            ['mc_edd_l'].forEach(bind(calcEdd));
            ['mc_gfr_age', 'mc_gfr_sex', 'mc_gfr_scr', 'mc_gfr_unit'].forEach(bind(calcGfr));
            ['mc_age_d'].forEach(bind(calcAge));
        }
        function bind(fn) {
            return function (id) {
                var el = gg(id); if (!el) return;
                el.addEventListener('input', fn);
                el.addEventListener('change', fn);
            };
        }
        function setRes(id, html, tone) {
            var el = gg(id); if (!el) return;
            el.innerHTML = html;
            el.className = 'ct-calc-result' + (tone ? ' ct-tone-' + tone : '');
        }

        function calcBmi() {
            var w = num(gg('mc_bmi_w').value), h = num(gg('mc_bmi_h').value);
            if (isNaN(w) || isNaN(h) || h <= 0) return setRes('mc_bmi_r', '—');
            var m = h / 100, bmi = w / (m * m);
            var cat, tone;
            if (bmi < 18.5) { cat = t('Underweight', '体重过轻', '體重過輕'); tone = 'warn'; }
            else if (bmi < 25) { cat = t('Normal', '正常', '正常'); tone = 'ok'; }
            else if (bmi < 30) { cat = t('Overweight', '超重', '超重'); tone = 'warn'; }
            else { cat = t('Obese', '肥胖', '肥胖'); tone = 'bad'; }
            setRes('mc_bmi_r', '<b>' + r1(bmi) + '</b> kg/m² · ' + esc(cat), tone);
        }
        function calcBsa() {
            var w = num(gg('mc_bsa_w').value), h = num(gg('mc_bsa_h').value);
            if (isNaN(w) || isNaN(h)) return setRes('mc_bsa_r', '—');
            var bsa = Math.sqrt((h * w) / 3600);
            setRes('mc_bsa_r', '<b>' + r2(bsa) + '</b> m²', 'ok');
        }
        function calcPed() {
            var w = num(gg('mc_ped_w').value), d = num(gg('mc_ped_d').value), f = num(gg('mc_ped_f').value);
            if (isNaN(w) || isNaN(d)) return setRes('mc_ped_r', '—');
            var perDay = w * d;
            var perDose = (f && f > 0) ? perDay / f : perDay;
            setRes('mc_ped_r',
                '<b>' + r1(perDay) + '</b> mg/' + t('day', '日', '日') +
                ' · <b>' + r1(perDose) + '</b> mg/' + t('dose', '次', '次'), 'ok');
        }
        function calcEdd() {
            var v = gg('mc_edd_l').value;
            if (!v) return setRes('mc_edd_r', '—');
            var lmp = new Date(v + 'T00:00:00');
            if (isNaN(lmp.getTime())) return setRes('mc_edd_r', '—');
            var edd = new Date(lmp.getTime() + 280 * 86400000);
            var now = new Date();
            var days = Math.floor((now - lmp) / 86400000);
            var ga = days >= 0 ? (Math.floor(days / 7) + 'w ' + (days % 7) + 'd') : '—';
            setRes('mc_edd_r',
                'EDD: <b>' + fmtDate(edd) + '</b><br>' +
                t('Gestational age', '孕周', '孕週') + ': <b>' + ga + '</b>', 'ok');
        }
        function calcGfr() {
            var age = num(gg('mc_gfr_age').value);
            var sex = gg('mc_gfr_sex').value;
            var scr = num(gg('mc_gfr_scr').value);
            var unit = gg('mc_gfr_unit').value;
            if (isNaN(age) || isNaN(scr) || scr <= 0 || age <= 0) return setRes('mc_gfr_r', '—');
            if (unit === 'umol') scr = scr / 88.4;
            var female = sex === 'f';
            var k = female ? 0.7 : 0.9;
            var a = female ? -0.241 : -0.302;
            var egfr = 142 *
                Math.pow(Math.min(scr / k, 1), a) *
                Math.pow(Math.max(scr / k, 1), -1.200) *
                Math.pow(0.9938, age) *
                (female ? 1.012 : 1);
            var stage, tone;
            if (egfr >= 90) { stage = 'G1'; tone = 'ok'; }
            else if (egfr >= 60) { stage = 'G2'; tone = 'ok'; }
            else if (egfr >= 45) { stage = 'G3a'; tone = 'warn'; }
            else if (egfr >= 30) { stage = 'G3b'; tone = 'warn'; }
            else if (egfr >= 15) { stage = 'G4'; tone = 'bad'; }
            else { stage = 'G5'; tone = 'bad'; }
            setRes('mc_gfr_r', '<b>' + Math.round(egfr) + '</b> mL/min/1.73m² · ' + stage, tone);
        }
        function calcAge() {
            var v = gg('mc_age_d').value;
            if (!v) return setRes('mc_age_r', '—');
            var dob = new Date(v + 'T00:00:00'); var now = new Date();
            if (isNaN(dob.getTime()) || dob > now) return setRes('mc_age_r', '—');
            var y = now.getFullYear() - dob.getFullYear();
            var m = now.getMonth() - dob.getMonth();
            var d = now.getDate() - dob.getDate();
            if (d < 0) { m--; d += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
            if (m < 0) { y--; m += 12; }
            setRes('mc_age_r',
                '<b>' + y + '</b> ' + t('y', '岁', '歲') + ' <b>' + m + '</b> ' +
                t('mo', '月', '月') + ' <b>' + d + '</b> ' + t('d', '天', '天'), 'ok');
        }
        function fmtDate(dt) {
            var mm = ('0' + (dt.getMonth() + 1)).slice(-2);
            var dd = ('0' + dt.getDate()).slice(-2);
            return dt.getFullYear() + '-' + mm + '-' + dd;
        }
        return { open: open };
    })();

    // ════════════════════════════════════════════════════════════════
    //  QR CODE GENERATOR
    // ════════════════════════════════════════════════════════════════
    var QRTOOL = (function () {
        var TYPE = 'text';
        var _logoDataUrl = null;
        var _logoScale = 18;
        var _centreLabel = '';
        var _labelColor = '#111827';
        var _labelScale = 100;
        var _baseCanvas = null;
        var _baseKey = '';
        var _lastEcOverlay = false;
        var QR_PREVIEW_PLACEHOLDER = 'https://joyful-smile.preview/qr';
        var LOGO_SCALE_MIN = 12;
        var LOGO_SAFE_MAX_SOLO = 22;
        var LOGO_SAFE_MAX_WITH_LABEL = 16;

        function logoSafeMaxPct() {
            return readCentreLabel(false) ? LOGO_SAFE_MAX_WITH_LABEL : LOGO_SAFE_MAX_SOLO;
        }
        function clampLogoScale(value) {
            var n = num(value);
            if (isNaN(n)) n = 18;
            return Math.max(LOGO_SCALE_MIN, Math.min(logoSafeMaxPct(), Math.round(n)));
        }
        function effectiveLogoScalePct() {
            return clampLogoScale(_logoScale);
        }
        function updateOverlayScanHint() {
            var el = gg('qr_scan_hint');
            if (!el) return;
            if (!_logoDataUrl) {
                el.style.display = 'none';
                el.textContent = '';
                return;
            }
            var safe = logoSafeMaxPct();
            var current = num(_logoScale) || effectiveLogoScalePct();
            if (current > safe) {
                el.style.display = '';
                el.textContent = t(
                    'Logo size was reduced to ' + safe + '% so the QR stays scannable.',
                    '标志大小已限制为 ' + safe + '%，以确保二维码可扫描。',
                    '標誌大小已限制為 ' + safe + '%，以確保 QR 碼可掃描。');
            } else if (current >= safe - 1) {
                el.style.display = '';
                el.textContent = t(
                    'Near the maximum safe logo size (' + safe + '%). Larger overlays often fail to scan.',
                    '已接近安全上限（' + safe + '%）。更大的标志常导致无法扫描。',
                    '已接近安全上限（' + safe + '%）。更大的標誌常導致無法掃描。');
            } else {
                el.style.display = 'none';
                el.textContent = '';
            }
        }

        /** Approximate print size at 300 dpi (mm) for hint text. */
        function qrPrintMm(px) {
            return Math.round((px / 300) * 25.4);
        }

        /** Suggested print use from pixel output size. */
        function qrSizeHint(px) {
            var mm = qrPrintMm(px);
            if (px <= 192) {
                return t(
                    mm + ' mm (~' + px + ' px) — sticker, business-card back, email signature',
                    mm + ' mm（约 ' + px + ' px）— 贴纸、名片背面、邮件签名',
                    mm + ' mm（約 ' + px + ' px）— 貼紙、名片背面、電郵簽名');
            }
            if (px <= 320) {
                return t(
                    mm + ' mm (~' + px + ' px) — A6 flyer corner, appointment card, desk tent',
                    mm + ' mm（约 ' + px + ' px）— A6 传单角落、预约卡、桌面展示牌',
                    mm + ' mm（約 ' + px + ' px）— A6 傳單角落、預約卡、桌面展示牌');
            }
            if (px <= 448) {
                return t(
                    mm + ' mm (~' + px + ' px) — A5 handout, counter sign, leaflet insert',
                    mm + ' mm（约 ' + px + ' px）— A5 宣传单、柜台告示、单张内页',
                    mm + ' mm（約 ' + px + ' px）— A5 宣傳單、櫃台告示、單張內頁');
            }
            if (px <= 576) {
                return t(
                    mm + ' mm (~' + px + ' px) — A4 quarter-page, window decal, notice board',
                    mm + ' mm（约 ' + px + ' px）— A4 四分之一页、橱窗贴、布告栏',
                    mm + ' mm（約 ' + px + ' px）— A4 四分之一頁、櫥窗貼、佈告欄');
            }
            if (px <= 768) {
                return t(
                    mm + ' mm (~' + px + ' px) — A4 half-page, door sign, reception display',
                    mm + ' mm（约 ' + px + ' px）— A4 半页、门口告示、接待处展示',
                    mm + ' mm（約 ' + px + ' px）— A4 半頁、門口告示、接待處展示');
            }
            return t(
                mm + ' mm (~' + px + ' px) — A4 full page, poster, wall banner',
                mm + ' mm（约 ' + px + ' px）— A4 整页、海报、墙面横幅',
                mm + ' mm（約 ' + px + ' px）— A4 整頁、海報、牆面橫幅');
        }

        function updateSizeHint() {
            var hint = gg('qr_size_hint');
            var sizeEl = gg('qr_size');
            var valEl = gg('qr_size_val');
            if (!hint || !sizeEl) return;
            var px = num(sizeEl.value) || 320;
            if (valEl) valEl.textContent = px + ' px';
            hint.textContent = qrSizeHint(px);
        }

        function open() {
            if (typeof showOnly === 'function') showOnly('qrToolSection');
            render();
        }
        function render() {
            var app = gg('qrToolApp'); if (!app) return;
            app.innerHTML =
                '<p class="ct-intro">' + esc(t(
                    'Generate a QR code for a link, Wi-Fi, phone, email or any text.',
                    '为链接、Wi-Fi、电话、邮箱或任意文字生成二维码。',
                    '為連結、Wi-Fi、電話、電郵或任意文字產生 QR 碼。')) + '</p>' +
                '<div class="ct-qr-layout">' +
                    '<div class="ct-qr-form">' +
                        '<div class="ct-seg" id="qr_types">' +
                            seg('text', '🔤 ' + t('Text/URL', '文字/网址', '文字/網址')) +
                            seg('wifi', '📶 Wi-Fi') +
                            seg('tel', '📞 ' + t('Phone', '电话', '電話')) +
                            seg('email', '✉️ ' + t('Email', '邮箱', '電郵')) +
                            seg('sms', '💬 SMS') +
                        '</div>' +
                        '<div id="qr_fields"></div>' +
                        '<div class="ct-qr-opts">' +
                            '<label class="ct-field ct-field--full"><span>' +
                                esc(t('Size', '尺寸', '尺寸')) + ' · <strong id="qr_size_val">320 px</strong></span>' +
                            '<input id="qr_size" type="range" min="128" max="1024" step="32" value="320"></label>' +
                            '<p id="qr_size_hint" class="ct-qr-size-hint" aria-live="polite"></p>' +
                            '<label class="ct-field"><span>' + esc(t('Dark', '前景色', '前景色')) + '</span>' +
                            '<input id="qr_fg" type="color" value="#111827"></label>' +
                            '<label class="ct-field"><span>' + esc(t('Light', '背景色', '背景色')) + '</span>' +
                            '<input id="qr_bg" type="color" value="#ffffff"></label>' +
                        '</div>' +
                        '<div class="ct-qr-logo-block">' +
                            '<div class="ct-qr-logo-head">' +
                                '<span>' + esc(t('Centre overlay (optional)', '中心叠加（可选）', '中心疊加（可選）')) + '</span>' +
                                '<button type="button" class="ct-btn ct-btn-ghost ct-btn-sm" id="qr_overlay_clear" ' +
                                    'style="display:none;">' +
                                    esc(t('Clear all', '全部清除', '全部清除')) + '</button>' +
                            '</div>' +
                            '<label class="ct-field ct-field--full">' +
                                '<span>' + esc(t('Centre label', '中心文字', '中心文字')) + '</span>' +
                                '<input id="qr_label" type="text" maxlength="28" value="' + esc(_centreLabel) +
                                '" placeholder="' + esc(t('e.g. SCAN ME', '例如：扫码预约', '例如：掃碼預約')) + '">' +
                            '</label>' +
                            '<label class="ct-field">' +
                                '<span>' + esc(t('Label colour', '文字颜色', '文字顏色')) + '</span>' +
                                '<input id="qr_label_color" type="color" value="' + esc(_labelColor) + '">' +
                            '</label>' +
                            '<label class="ct-field ct-field--full">' +
                                '<span>' + esc(t('Label size', '文字大小', '文字大小')) +
                                    ' · <strong id="qr_label_scale_val">' + _labelScale + '%</strong></span>' +
                                '<input id="qr_label_scale" type="range" min="50" max="200" step="5" value="' +
                                    _labelScale + '"' + (readCentreLabel(false) ? '' : ' disabled') + '></label>' +
                            '<label class="ct-field ct-field--full">' +
                                '<span>' + esc(t('Centre logo', '中心标志', '中心標誌')) + '</span>' +
                                '<input id="qr_logo_file" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml">' +
                            '</label>' +
                            '<label class="ct-field ct-field--full">' +
                                '<span>' + esc(t('Logo size', '标志大小', '標誌大小')) +
                                    ' · <strong id="qr_logo_scale_val">' + _logoScale + '%</strong></span>' +
                                '<input id="qr_logo_scale" type="range" min="12" max="' + logoSafeMaxPct() + '" step="1" value="' +
                                    clampLogoScale(_logoScale) + '"' + (_logoDataUrl ? '' : ' disabled') + '></label>' +
                            '<p id="qr_scan_hint" class="ct-qr-scan-hint" style="display:none;" aria-live="polite"></p>' +
                            '<p class="ct-qr-logo-hint">' + esc(t(
                                'Keep the centre logo under ~22% (or ~16% with a label) for reliable scanning. High error correction is used automatically.',
                                '为保证可扫描，中心标志建议不超过 QR 约 22%（含文字时约 16%）。系统会自动使用高容错等级。',
                                '為確保可掃描，中心標誌建議不超過 QR 約 22%（含文字時約 16%）。系統會自動使用高容錯等級。')) + '</p>' +
                        '</div>' +
                    '</div>' +
                    '<div class="ct-qr-preview">' +
                        '<div id="qr_box" class="ct-qr-box"></div>' +
                        '<p id="qr_preview_note" class="ct-qr-preview-note" style="display:none;" aria-live="polite"></p>' +
                        '<button type="button" class="ct-btn ct-btn-primary" id="qr_dl" disabled>⬇ ' +
                            esc(t('Download PNG', '下载 PNG', '下載 PNG')) + '</button>' +
                    '</div>' +
                '</div>';
            renderFields();
            wireTypes();
            updateSizeHint();
            gg('qr_size').addEventListener('input', function () {
                updateSizeHint();
                regen();
            });
            gg('qr_fg').addEventListener('input', regen);
            gg('qr_bg').addEventListener('input', regen);
            gg('qr_dl').addEventListener('click', download);
            wireOverlayControls();
            _lastEcOverlay = overlayEcActive();
            refreshPreview({ force: true });
        }
        function readCentreLabel(live) {
            var el = gg('qr_label');
            var s = el ? String(el.value || '') : String(_centreLabel || '');
            return live ? s : s.trim();
        }
        function overlayEcActive() {
            return !!_logoDataUrl || !!readCentreLabel(false);
        }
        function hasVisibleOverlay() {
            return !!_logoDataUrl || !!readCentreLabel(false);
        }
        function buildPayloadOrPreview() {
            var real = buildPayload();
            if (real) return { payload: real, placeholder: false };
            if (hasVisibleOverlay()) return { payload: QR_PREVIEW_PLACEHOLDER, placeholder: true };
            return { payload: '', placeholder: false };
        }
        function baseCacheKey(payload, size, fg, bg, needsH) {
            return [payload, size, fg, bg, needsH ? 'H' : 'M'].join('\u0001');
        }
        function updatePreviewNotice(placeholder) {
            var note = gg('qr_preview_note');
            if (!note) return;
            if (placeholder) {
                note.style.display = '';
                note.textContent = t(
                    'Live preview — enter QR content above to enable download.',
                    '实时预览中 — 请在上方填写 QR 内容后再下载。',
                    '即時預覽中 — 請在上方填寫 QR 內容後再下載。');
            } else {
                note.style.display = 'none';
                note.textContent = '';
            }
        }
        function syncDownloadState(placeholder) {
            var btn = gg('qr_dl');
            if (btn) btn.disabled = !!placeholder || !buildPayload();
            updatePreviewNotice(!!placeholder);
        }
        function captureBaseFromCanvas(canvas) {
            if (!canvas) return;
            if (!_baseCanvas) _baseCanvas = document.createElement('canvas');
            _baseCanvas.width = canvas.width;
            _baseCanvas.height = canvas.height;
            _baseCanvas.getContext('2d').drawImage(canvas, 0, 0);
        }
        function waitForQrCanvas(container, tries) {
            return new Promise(function (resolve) {
                function attempt(n) {
                    var c = container.querySelector('canvas');
                    if (c && c.width > 0) return resolve(c);
                    if (n <= 0) return resolve(null);
                    requestAnimationFrame(function () { attempt(n - 1); });
                }
                attempt(tries || 16);
            });
        }
        function paintPreviewCanvas() {
            var box = gg('qr_box');
            if (!box || !_baseCanvas) return Promise.resolve(null);
            var size = _baseCanvas.width;
            var canvas = box.querySelector('canvas');
            if (!canvas) {
                box.innerHTML = '';
                canvas = document.createElement('canvas');
                box.appendChild(canvas);
            }
            if (canvas.width !== size || canvas.height !== size) {
                canvas.width = size;
                canvas.height = size;
            }
            var ctx = canvas.getContext('2d');
            ctx.drawImage(_baseCanvas, 0, 0);
            if (hasVisibleOverlay()) return applyCentreOverlay(canvas);
            return Promise.resolve(canvas);
        }
        function regenBase(force) {
            var meta = buildPayloadOrPreview();
            var box = gg('qr_box');
            if (!box) return Promise.resolve();
            syncDownloadState(meta.placeholder);

            if (!meta.payload) {
                _baseCanvas = null;
                _baseKey = '';
                box.innerHTML = '<span class="ct-qr-empty">' +
                    esc(t('Fill in the fields to preview', '填写内容以预览', '填寫內容以預覽')) + '</span>';
                updatePreviewNotice(false);
                return Promise.resolve();
            }

            var size = num(gg('qr_size').value) || 320;
            var fg = gg('qr_fg').value;
            var bg = gg('qr_bg').value;
            var needsH = overlayEcActive();
            var key = baseCacheKey(meta.payload, size, fg, bg, needsH);

            if (!force && key === _baseKey && _baseCanvas) {
                return paintPreviewCanvas();
            }

            return ensureQRCode().then(function (QRCode) {
                var off = document.createElement('div');
                off.setAttribute('aria-hidden', 'true');
                off.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;';
                document.body.appendChild(off);
                new QRCode(off, {
                    text: meta.payload,
                    width: size,
                    height: size,
                    colorDark: fg,
                    colorLight: bg,
                    correctLevel: needsH ? QRCode.CorrectLevel.H : QRCode.CorrectLevel.M
                });
                return waitForQrCanvas(off, 20).then(function (src) {
                    if (off.parentNode) off.parentNode.removeChild(off);
                    if (!src) throw new Error('QR canvas missing');
                    captureBaseFromCanvas(src);
                    _baseKey = key;
                    if (!box.querySelector('canvas')) box.innerHTML = '';
                    return paintPreviewCanvas();
                });
            }).catch(function () {
                _baseCanvas = null;
                _baseKey = '';
                box.innerHTML = '<span class="ct-qr-empty">' +
                    esc(t('Could not load QR library.', '无法加载二维码库。', '無法載入 QR 程式庫。')) + '</span>';
            });
        }
        function refreshPreview(opts) {
            opts = opts || {};
            var meta = buildPayloadOrPreview();
            if (!meta.payload) {
                _lastEcOverlay = overlayEcActive();
                return regenBase(true);
            }
            var ecNow = overlayEcActive();
            var ecChanged = ecNow !== _lastEcOverlay;
            _lastEcOverlay = ecNow;
            if (opts.force || ecChanged || !_baseCanvas) return regenBase(true);
            if (opts.overlayOnly) {
                syncDownloadState(meta.placeholder);
                return paintPreviewCanvas();
            }
            return regenBase(false);
        }
        function regen(opts) {
            refreshPreview(opts && opts.overlayOnly
                ? { overlayOnly: true }
                : { force: true });
        }
        function wireOverlayControls() {
            var fileIn = gg('qr_logo_file');
            var scaleIn = gg('qr_logo_scale');
            var clearBtn = gg('qr_overlay_clear');
            var labelIn = gg('qr_label');
            var labelColorIn = gg('qr_label_color');
            var labelScaleIn = gg('qr_label_scale');
            if (labelIn) {
                labelIn.addEventListener('input', function () {
                    _centreLabel = labelIn.value;
                    syncOverlayUi();
                    var ecNow = overlayEcActive();
                    var ecChanged = ecNow !== _lastEcOverlay;
                    _lastEcOverlay = ecNow;
                    if (ecChanged || !_baseCanvas) refreshPreview({ force: true });
                    else refreshPreview({ overlayOnly: true });
                });
            }
            if (labelColorIn) {
                labelColorIn.addEventListener('input', function () {
                    _labelColor = labelColorIn.value;
                    refreshPreview({ overlayOnly: true });
                });
            }
            if (labelScaleIn) {
                labelScaleIn.addEventListener('input', function () {
                    _labelScale = num(labelScaleIn.value) || 100;
                    var valEl = gg('qr_label_scale_val');
                    if (valEl) valEl.textContent = _labelScale + '%';
                    refreshPreview({ overlayOnly: true });
                });
            }
            if (fileIn) {
                fileIn.addEventListener('change', function () {
                    var file = fileIn.files && fileIn.files[0];
                    if (!file) return;
                    if (file.size > 2 * 1024 * 1024) {
                        alert(t('Logo file is too large (max 2 MB).', '标志文件过大（最大 2 MB）。', '標誌檔案過大（最大 2 MB）。'));
                        fileIn.value = '';
                        return;
                    }
                    var reader = new FileReader();
                    reader.onload = function () {
                        _logoDataUrl = reader.result;
                        syncOverlayUi();
                        var ecChanged = overlayEcActive() !== _lastEcOverlay;
                        _lastEcOverlay = overlayEcActive();
                        refreshPreview({ force: ecChanged || !_baseCanvas });
                    };
                    reader.onerror = function () {
                        alert(t('Could not read logo file.', '无法读取标志文件。', '無法讀取標誌檔案。'));
                    };
                    reader.readAsDataURL(file);
                });
            }
            if (scaleIn) {
                scaleIn.addEventListener('input', function () {
                    _logoScale = clampLogoScale(scaleIn.value);
                    scaleIn.value = String(_logoScale);
                    var valEl = gg('qr_logo_scale_val');
                    if (valEl) valEl.textContent = _logoScale + '%';
                    updateOverlayScanHint();
                    refreshPreview({ overlayOnly: true });
                });
            }
            if (clearBtn) {
                clearBtn.addEventListener('click', function () {
                    _logoDataUrl = null;
                    _centreLabel = '';
                    _labelColor = '#111827';
                    _logoScale = 18;
                    _labelScale = 100;
                    if (fileIn) fileIn.value = '';
                    if (labelIn) labelIn.value = '';
                    if (labelColorIn) labelColorIn.value = '#111827';
                    if (labelScaleIn) labelScaleIn.value = '100';
                    var labelScaleVal = gg('qr_label_scale_val');
                    if (labelScaleVal) labelScaleVal.textContent = '100%';
                    syncOverlayUi();
                    _lastEcOverlay = overlayEcActive();
                    refreshPreview({ force: true });
                });
            }
            syncOverlayUi();
        }
        function syncOverlayUi() {
            var clearBtn = gg('qr_overlay_clear');
            var scaleIn = gg('qr_logo_scale');
            var labelScaleIn = gg('qr_label_scale');
            if (clearBtn) clearBtn.style.display = (hasVisibleOverlay() || readCentreLabel(true)) ? '' : 'none';
            if (scaleIn) {
                scaleIn.disabled = !_logoDataUrl;
                if (_logoDataUrl) {
                    var cap = logoSafeMaxPct();
                    scaleIn.max = String(cap);
                    _logoScale = clampLogoScale(scaleIn.value || _logoScale);
                    scaleIn.value = String(_logoScale);
                    var logoVal = gg('qr_logo_scale_val');
                    if (logoVal) logoVal.textContent = _logoScale + '%';
                }
            }
            if (labelScaleIn) labelScaleIn.disabled = !readCentreLabel(false);
            updateOverlayScanHint();
        }
        function seg(id, label) {
            return '<button type="button" class="ct-seg-btn' + (id === TYPE ? ' active' : '') +
                '" data-qt="' + id + '">' + esc(label) + '</button>';
        }
        function wireTypes() {
            var box = gg('qr_types'); if (!box) return;
            box.addEventListener('click', function (e) {
                var b = e.target.closest('[data-qt]'); if (!b) return;
                TYPE = b.getAttribute('data-qt');
                box.querySelectorAll('.ct-seg-btn').forEach(function (x) {
                    x.classList.toggle('active', x === b);
                });
                renderFields();
                regen();
            });
        }
        function fld(label, id, ph, type) {
            return '<label class="ct-field"><span>' + esc(label) + '</span>' +
                '<input id="' + id + '" type="' + (type || 'text') + '" placeholder="' + esc(ph || '') + '"></label>';
        }
        function renderFields() {
            var f = gg('qr_fields'); if (!f) return;
            var html = '';
            if (TYPE === 'text') {
                html = '<label class="ct-field"><span>' + esc(t('Content', '内容', '內容')) + '</span>' +
                    '<textarea id="qr_text" rows="3" placeholder="https://…"></textarea></label>';
            } else if (TYPE === 'wifi') {
                html = fld(t('Network name (SSID)', '网络名称 (SSID)', '網路名稱 (SSID)'), 'qr_ssid') +
                    fld(t('Password', '密码', '密碼'), 'qr_pass') +
                    '<label class="ct-field"><span>' + esc(t('Security', '加密', '加密')) + '</span>' +
                    '<select id="qr_enc" class="ct-select"><option value="WPA">WPA/WPA2</option>' +
                    '<option value="WEP">WEP</option><option value="nopass">' +
                    esc(t('None', '无', '無')) + '</option></select></label>';
            } else if (TYPE === 'tel') {
                html = fld(t('Phone number', '电话号码', '電話號碼'), 'qr_tel', '+852…', 'tel');
            } else if (TYPE === 'email') {
                html = fld(t('Email address', '邮箱地址', '電郵地址'), 'qr_em', 'name@clinic.com', 'email') +
                    fld(t('Subject', '主题', '主旨'), 'qr_sub') +
                    '<label class="ct-field"><span>' + esc(t('Body', '内容', '內容')) + '</span>' +
                    '<textarea id="qr_body" rows="2"></textarea></label>';
            } else if (TYPE === 'sms') {
                html = fld(t('Phone number', '电话号码', '電話號碼'), 'qr_sms_n', '+852…', 'tel') +
                    '<label class="ct-field"><span>' + esc(t('Message', '短信内容', '簡訊內容')) + '</span>' +
                    '<textarea id="qr_sms_m" rows="2"></textarea></label>';
            }
            f.innerHTML = html;
            f.querySelectorAll('input,textarea,select').forEach(function (el) {
                el.addEventListener('input', regen);
                el.addEventListener('change', regen);
            });
        }
        function buildPayload() {
            function v(id) { var e = gg(id); return e ? e.value : ''; }
            if (TYPE === 'text') return v('qr_text').trim();
            if (TYPE === 'wifi') {
                var ssid = v('qr_ssid'), pass = v('qr_pass'), enc = v('qr_enc') || 'WPA';
                if (!ssid) return '';
                var e = function (s) { return String(s).replace(/([\\;,:"])/g, '\\$1'); };
                if (enc === 'nopass') return 'WIFI:T:nopass;S:' + e(ssid) + ';;';
                return 'WIFI:T:' + enc + ';S:' + e(ssid) + ';P:' + e(pass) + ';;';
            }
            if (TYPE === 'tel') { var n = v('qr_tel').trim(); return n ? 'tel:' + n : ''; }
            if (TYPE === 'email') {
                var em = v('qr_em').trim(); if (!em) return '';
                var q = [];
                if (v('qr_sub')) q.push('subject=' + encodeURIComponent(v('qr_sub')));
                if (v('qr_body')) q.push('body=' + encodeURIComponent(v('qr_body')));
                return 'mailto:' + em + (q.length ? '?' + q.join('&') : '');
            }
            if (TYPE === 'sms') {
                var sn = v('qr_sms_n').trim(); if (!sn) return '';
                var msg = v('qr_sms_m');
                return 'sms:' + sn + (msg ? '?body=' + encodeURIComponent(msg) : '');
            }
            return '';
        }
        var _qr = null;
        function qrOverlayBg() {
            var bgEl = gg('qr_bg');
            return bgEl ? bgEl.value : '#ffffff';
        }
        function qrOverlayLabelColor() {
            var c = gg('qr_label_color');
            return c ? c.value : _labelColor;
        }
        function computeLabelFontSize(qrSize, labelTrim) {
            var base = labelTrim.length > 10 ? 0.042 : 0.05;
            var scale = (_labelScale || 100) / 100;
            return Math.max(8, Math.round(qrSize * base * scale));
        }
        function drawCentreLabel(ctx, qrSize, cx, cy, maxWidth) {
            var label = readCentreLabel(true);
            var labelTrim = label.trim();
            if (!labelTrim || !ctx) return 0;
            var fontSize = computeLabelFontSize(qrSize, labelTrim);
            var maxBoxW = Math.min(maxWidth || qrSize * 0.34, Math.round(qrSize * 0.34));
            ctx.font = '700 ' + fontSize + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            var textW = ctx.measureText(label).width;
            var pad = Math.max(4, Math.round(fontSize * 0.3));
            var boxW = Math.min(maxBoxW, textW + pad * 2);
            var boxH = fontSize + pad * 2;
            var x = Math.round(cx - boxW / 2);
            var y = Math.round(cy - boxH / 2);
            ctx.fillStyle = qrOverlayBg();
            ctx.fillRect(x, y, boxW, boxH);
            ctx.fillStyle = qrOverlayLabelColor();
            ctx.fillText(label, cx, cy);
            return boxH;
        }
        function applyCentreOverlay(canvas) {
            if (!canvas) return Promise.resolve(canvas);
            var label = readCentreLabel(true);
            var labelTrim = label.trim();
            if (!_logoDataUrl && !labelTrim) return Promise.resolve(canvas);

            function finishOverlay() {
                try {
                    if (!_logoDataUrl && labelTrim) {
                        var ctxOnly = canvas.getContext('2d');
                        drawCentreLabel(ctxOnly, canvas.width, canvas.width / 2, canvas.height / 2, canvas.width * 0.34);
                    }
                } catch (e) { /* keep plain QR */ }
                return canvas;
            }

            if (!_logoDataUrl) return Promise.resolve(finishOverlay());

            return new Promise(function (resolve) {
                var img = new Image();
                img.onload = function () {
                    try {
                        var ctx = canvas.getContext('2d');
                        var qrSize = canvas.width;
                        var pct = effectiveLogoScalePct() / 100;
                        var logoSize = Math.round(qrSize * pct);
                        var gap = labelTrim ? Math.max(4, Math.round(qrSize * 0.015)) : 0;
                        var labelFont = labelTrim ? computeLabelFontSize(qrSize, labelTrim) : 0;
                        var labelBlockH = labelTrim ? labelFont + Math.max(8, Math.round(qrSize * 0.02)) : 0;
                        var totalH = logoSize + (labelTrim ? gap + labelBlockH : 0);
                        var pad = Math.max(3, Math.round(logoSize * 0.06));
                        var maxBlockH = Math.round(qrSize * (labelTrim ? 0.30 : 0.26));
                        if (totalH + pad * 2 > maxBlockH) {
                            logoSize = Math.max(
                                Math.round(qrSize * LOGO_SCALE_MIN / 100),
                                maxBlockH - pad * 2 - gap - labelBlockH
                            );
                            totalH = logoSize + (labelTrim ? gap + labelBlockH : 0);
                        }
                        var startY = Math.round((qrSize - totalH) / 2);
                        var x = Math.round((qrSize - logoSize) / 2);
                        var blockW = Math.max(logoSize + pad * 2, Math.round(qrSize * 0.34));
                        var blockH = totalH + pad * 2;
                        var bx = Math.round((qrSize - blockW) / 2);
                        var by = startY - pad;
                        ctx.fillStyle = qrOverlayBg();
                        ctx.fillRect(bx, by, blockW, blockH);
                        ctx.drawImage(img, x, startY, logoSize, logoSize);
                        if (labelTrim) {
                            drawCentreLabel(
                                ctx, qrSize, qrSize / 2,
                                startY + logoSize + gap + labelBlockH / 2,
                                blockW - pad
                            );
                        }
                    } catch (e) { /* keep plain QR */ }
                    resolve(canvas);
                };
                img.onerror = function () { resolve(finishOverlay()); };
                img.src = _logoDataUrl;
            });
        }
        function download() {
            if (!buildPayload()) return;
            var box = gg('qr_box'); if (!box) return;
            var canvas = box.querySelector('canvas');
            if (canvas) {
                canvas.toBlob(function (b) {
                    if (b) dl(b, 'qrcode.png');
                }, 'image/png');
                return;
            }
            var url = (box.querySelector('img') || {}).src;
            if (!url) return;
            fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
                dl(b, 'qrcode.png');
            }).catch(function () {
                var a = document.createElement('a'); a.href = url; a.download = 'qrcode.png';
                document.body.appendChild(a); a.click(); a.remove();
            });
        }
        return { open: open };
    })();

    // ════════════════════════════════════════════════════════════════
    //  PDF UTILITIES
    // ════════════════════════════════════════════════════════════════
    var PDFUTIL = (function () {
        var TAB = 'merge';
        function open() {
            if (typeof showOnly === 'function') showOnly('pdfUtilSection');
            render();
        }
        function render() {
            var app = gg('pdfUtilApp'); if (!app) return;
            app.innerHTML =
                '<p class="ct-intro">' + esc(t(
                    'Merge, organise, watermark or shrink PDFs — entirely in your browser.',
                    '合并、整理、加水印或压缩 PDF — 全部在浏览器中完成。',
                    '合併、整理、加浮水印或壓縮 PDF — 全部在瀏覽器中完成。')) + '</p>' +
                '<div class="ct-seg" id="pu_tabs">' +
                    ptab('merge', '🔗 ' + t('Merge', '合并', '合併')) +
                    ptab('extract', '✂️ ' + t('Extract', '提取', '提取')) +
                    ptab('delete', '🗑️ ' + t('Delete pages', '删除页', '刪除頁')) +
                    ptab('rotate', '🔁 ' + t('Rotate', '旋转', '旋轉')) +
                    ptab('watermark', '💧 ' + t('Watermark', '水印', '浮水印')) +
                    ptab('compress', '🗜️ ' + t('Compress', '压缩', '壓縮')) +
                '</div>' +
                '<div id="pu_panel" class="ct-panel-box"></div>' +
                '<div id="pu_status" class="ct-status" style="display:none;"></div>';
            wireTabs();
            renderPanel();
        }
        function ptab(id, label) {
            return '<button type="button" class="ct-seg-btn' + (id === TAB ? ' active' : '') +
                '" data-pt="' + id + '">' + esc(label) + '</button>';
        }
        function wireTabs() {
            var box = gg('pu_tabs');
            box.addEventListener('click', function (e) {
                var b = e.target.closest('[data-pt]'); if (!b) return;
                TAB = b.getAttribute('data-pt');
                box.querySelectorAll('.ct-seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
                renderPanel();
            });
        }
        function fileInput(id, multiple) {
            return '<label class="ct-field"><span>' + esc(t('PDF file', 'PDF 文件', 'PDF 檔案')) +
                (multiple ? ' (' + t('2 or more', '2 个或以上', '2 個或以上') + ')' : '') + '</span>' +
                '<input id="' + id + '" type="file" accept="application/pdf,.pdf"' +
                (multiple ? ' multiple' : '') + '></label>';
        }
        function rangeInput(id, label) {
            return '<label class="ct-field"><span>' + esc(label) +
                '</span><input id="' + id + '" type="text" placeholder="1-3,5,8"></label>';
        }
        function runBtn(label) {
            return '<button type="button" class="ct-btn ct-btn-primary" id="pu_run">' + esc(label) + '</button>';
        }
        function renderPanel() {
            var p = gg('pu_panel'); if (!p) return;
            var html = '';
            if (TAB === 'merge') {
                html = fileInput('pu_files', true) + runBtn('🔗 ' + t('Merge PDFs', '合并 PDF', '合併 PDF'));
            } else if (TAB === 'extract') {
                html = fileInput('pu_files', false) +
                    rangeInput('pu_range', t('Pages to keep', '要保留的页', '要保留的頁')) +
                    runBtn('✂️ ' + t('Extract pages', '提取页面', '提取頁面'));
            } else if (TAB === 'delete') {
                html = fileInput('pu_files', false) +
                    rangeInput('pu_range', t('Pages to remove', '要删除的页', '要刪除的頁')) +
                    runBtn('🗑️ ' + t('Delete pages', '删除页面', '刪除頁面'));
            } else if (TAB === 'rotate') {
                html = fileInput('pu_files', false) +
                    '<label class="ct-field"><span>' + esc(t('Rotation', '旋转角度', '旋轉角度')) + '</span>' +
                    '<select id="pu_angle" class="ct-select"><option value="90">90° ↻</option>' +
                    '<option value="180">180°</option><option value="270">270° ↺</option></select></label>' +
                    rangeInput('pu_range', t('Pages (blank = all)', '页码（留空=全部）', '頁碼（留空=全部）')) +
                    runBtn('🔁 ' + t('Rotate', '旋转', '旋轉'));
            } else if (TAB === 'watermark') {
                html = fileInput('pu_files', false) +
                    '<label class="ct-field"><span>' + esc(t('Watermark text', '水印文字', '浮水印文字')) + '</span>' +
                    '<input id="pu_wm" type="text" placeholder="' + esc(t('CONFIDENTIAL', '机密', '機密')) + '"></label>' +
                    runBtn('💧 ' + t('Add watermark', '添加水印', '加入浮水印'));
            } else if (TAB === 'compress') {
                html = fileInput('pu_files', false) +
                    '<label class="ct-field"><span>' + esc(t('Quality', '质量', '品質')) + '</span>' +
                    '<input id="pu_q" type="range" min="0.3" max="0.9" step="0.05" value="0.6"></label>' +
                    '<p class="ct-note">' + esc(t(
                        'Compression re-renders pages as images (text becomes non-selectable).',
                        '压缩会将页面重绘为图片（文字将无法选取）。',
                        '壓縮會將頁面重繪為圖片（文字將無法選取）。')) + '</p>' +
                    runBtn('🗜️ ' + t('Compress', '压缩', '壓縮'));
            }
            p.innerHTML = html;
            gg('pu_run').addEventListener('click', run);
        }
        function status(msg, tone) {
            var s = gg('pu_status'); if (!s) return;
            s.style.display = 'block';
            s.className = 'ct-status' + (tone ? ' ct-tone-' + tone : '');
            s.innerHTML = (tone === 'work' ? '<span class="ct-spin"></span> ' : '') + esc(msg);
        }
        function filesOf() {
            var inp = gg('pu_files');
            return inp && inp.files ? Array.prototype.slice.call(inp.files) : [];
        }
        function run() {
            var files = filesOf();
            if (!files.length) return status(t('Please choose a PDF file.', '请选择 PDF 文件。', '請選擇 PDF 檔案。'), 'bad');
            gg('pu_run').disabled = true;
            status(t('Working…', '处理中…', '處理中…'), 'work');
            var job;
            if (TAB === 'merge') job = doMerge(files);
            else if (TAB === 'extract') job = doExtractDelete(files[0], true);
            else if (TAB === 'delete') job = doExtractDelete(files[0], false);
            else if (TAB === 'rotate') job = doRotate(files[0]);
            else if (TAB === 'watermark') job = doWatermark(files[0]);
            else if (TAB === 'compress') job = doCompress(files[0]);
            else job = Promise.reject(new Error('?'));
            job.then(function () {
                status(t('Done — file downloaded.', '完成 — 文件已下载。', '完成 — 檔案已下載。'), 'ok');
            }).catch(function (e) {
                status(t('Failed: ', '失败：', '失敗：') + (e && e.message || e), 'bad');
            }).then(function () { gg('pu_run').disabled = false; });
        }
        function doMerge(files) {
            return ensurePdfLib().then(function (PDFLib) {
                var out;
                return PDFLib.PDFDocument.create().then(function (doc) {
                    out = doc;
                    var chain = Promise.resolve();
                    files.forEach(function (f) {
                        chain = chain.then(function () {
                            return readArrayBuffer(f).then(function (buf) {
                                return PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
                            }).then(function (src) {
                                return out.copyPages(src, src.getPageIndices());
                            }).then(function (pages) {
                                pages.forEach(function (pg) { out.addPage(pg); });
                            });
                        });
                    });
                    return chain;
                }).then(function () {
                    return out.save();
                }).then(function (bytes) {
                    dl(new Blob([bytes], { type: 'application/pdf' }), 'merged.pdf');
                });
            });
        }
        function doExtractDelete(file, keep) {
            return ensurePdfLib().then(function (PDFLib) {
                return readArrayBuffer(file).then(function (buf) {
                    return PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
                }).then(function (src) {
                    var count = src.getPageCount();
                    var sel = parseRange(gg('pu_range').value, count);
                    if (!sel.length) throw new Error(t('No valid pages.', '没有有效页码。', '沒有有效頁碼。'));
                    var idx;
                    if (keep) idx = sel;
                    else { var rm = {}; sel.forEach(function (i) { rm[i] = 1; });
                        idx = []; for (var i = 0; i < count; i++) if (!rm[i]) idx.push(i); }
                    if (!idx.length) throw new Error(t('Nothing left.', '没有剩余页面。', '沒有剩餘頁面。'));
                    return PDFLib.PDFDocument.create().then(function (out) {
                        return out.copyPages(src, idx).then(function (pages) {
                            pages.forEach(function (pg) { out.addPage(pg); });
                            return out.save();
                        });
                    });
                }).then(function (bytes) {
                    dl(new Blob([bytes], { type: 'application/pdf' }), (keep ? 'extracted' : 'trimmed') + '.pdf');
                });
            });
        }
        function doRotate(file) {
            return ensurePdfLib().then(function (PDFLib) {
                var angle = parseInt(gg('pu_angle').value, 10) || 90;
                return readArrayBuffer(file).then(function (buf) {
                    return PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
                }).then(function (doc) {
                    var pages = doc.getPages();
                    var sel = parseRange(gg('pu_range').value, pages.length);
                    var set = null;
                    if (sel.length) { set = {}; sel.forEach(function (i) { set[i] = 1; }); }
                    pages.forEach(function (pg, i) {
                        if (set && !set[i]) return;
                        var cur = pg.getRotation().angle || 0;
                        pg.setRotation(PDFLib.degrees((cur + angle) % 360));
                    });
                    return doc.save();
                }).then(function (bytes) {
                    dl(new Blob([bytes], { type: 'application/pdf' }), 'rotated.pdf');
                });
            });
        }
        function doWatermark(file) {
            return ensurePdfLib().then(function (PDFLib) {
                var text = (gg('pu_wm').value || '').trim();
                if (!text) throw new Error(t('Enter watermark text.', '请输入水印文字。', '請輸入浮水印文字。'));
                return readArrayBuffer(file).then(function (buf) {
                    return PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
                }).then(function (doc) {
                    return doc.embedFont(PDFLib.StandardFonts.HelveticaBold).then(function (font) {
                        doc.getPages().forEach(function (pg) {
                            var w = pg.getWidth(), h = pg.getHeight();
                            var size = Math.max(24, Math.min(w, h) / 8);
                            var tw = font.widthOfTextAtSize(text, size);
                            pg.drawText(text, {
                                x: w / 2 - tw / 2 * Math.cos(Math.PI / 4),
                                y: h / 2 - size / 2,
                                size: size, font: font,
                                color: PDFLib.rgb(0.6, 0.6, 0.6),
                                opacity: 0.3,
                                rotate: PDFLib.degrees(45)
                            });
                        });
                        return doc.save();
                    });
                }).then(function (bytes) {
                    dl(new Blob([bytes], { type: 'application/pdf' }), 'watermarked.pdf');
                });
            });
        }
        function doCompress(file) {
            return ensurePdfJs().then(function (pdfjsLib) {
                return ensureJsPdf().then(function (jsPDF) {
                    var q = num(gg('pu_q').value) || 0.6;
                    return readArrayBuffer(file).then(function (buf) {
                        return pdfjsLib.getDocument({ data: buf }).promise;
                    }).then(function (pdf) {
                        var out = null;
                        var chain = Promise.resolve();
                        for (var i = 1; i <= pdf.numPages; i++) {
                            (function (n) {
                                chain = chain.then(function () {
                                    return pdf.getPage(n).then(function (page) {
                                        var vp = page.getViewport({ scale: 1.5 });
                                        var c = document.createElement('canvas');
                                        c.width = vp.width; c.height = vp.height;
                                        return page.render({ canvasContext: c.getContext('2d'), viewport: vp })
                                            .promise.then(function () {
                                                var img = c.toDataURL('image/jpeg', q);
                                                var orient = vp.width > vp.height ? 'l' : 'p';
                                                if (!out) out = new jsPDF({ unit: 'pt', format: [vp.width, vp.height], orientation: orient });
                                                else out.addPage([vp.width, vp.height], orient);
                                                out.addImage(img, 'JPEG', 0, 0, vp.width, vp.height);
                                            });
                                    });
                                });
                            })(i);
                        }
                        return chain.then(function () { out.save('compressed.pdf'); });
                    });
                });
            });
        }
        return { open: open };
    })();

    // ════════════════════════════════════════════════════════════════
    //  CERTIFICATE / RECEIPT / LABEL GENERATOR
    // ════════════════════════════════════════════════════════════════
    var CERTGEN = (function () {
        var DOC = 'cert';
        function clinicName() {
            try {
                if (typeof CLINIC_NAME === 'string' && CLINIC_NAME) return CLINIC_NAME;
                if (typeof window.CLINIC_NAME === 'string' && window.CLINIC_NAME) return window.CLINIC_NAME;
            } catch (e) {}
            return '';
        }
        function open() {
            if (typeof showOnly === 'function') showOnly('certGenSection');
            render();
        }
        function render() {
            var app = gg('certGenApp'); if (!app) return;
            app.innerHTML =
                '<div class="ct-seg" id="cg_tabs">' +
                    ctab('cert', '📜 ' + t('Medical Certificate', '病假证明', '病假證明')) +
                    ctab('receipt', '🧾 ' + t('Receipt', '收据', '收據')) +
                    ctab('label', '🏷️ ' + t('Medicine Label', '药物标签', '藥物標籤')) +
                '</div>' +
                '<div class="ct-cg-layout">' +
                    '<div id="cg_form" class="ct-cg-form"></div>' +
                    '<div class="ct-cg-preview-wrap">' +
                        '<div id="cg_preview" class="ct-cg-preview"></div>' +
                        '<div class="ct-cg-actions">' +
                            '<button type="button" class="ct-btn" id="cg_print">🖨️ ' + esc(t('Print', '打印', '列印')) + '</button>' +
                            '<button type="button" class="ct-btn ct-btn-primary" id="cg_pdf">⬇ ' + esc(t('Download PDF', '下载 PDF', '下載 PDF')) + '</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';
            wireTabs();
            renderForm();
            gg('cg_print').addEventListener('click', doPrint);
            gg('cg_pdf').addEventListener('click', doPdf);
        }
        function ctab(id, label) {
            return '<button type="button" class="ct-seg-btn' + (id === DOC ? ' active' : '') +
                '" data-cg="' + id + '">' + esc(label) + '</button>';
        }
        function wireTabs() {
            var box = gg('cg_tabs');
            box.addEventListener('click', function (e) {
                var b = e.target.closest('[data-cg]'); if (!b) return;
                DOC = b.getAttribute('data-cg');
                box.querySelectorAll('.ct-seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
                renderForm();
            });
        }
        function F(label, id, val, type) {
            return '<label class="ct-field"><span>' + esc(label) + '</span>' +
                '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val || '') + '"></label>';
        }
        function TA(label, id, val) {
            return '<label class="ct-field"><span>' + esc(label) + '</span>' +
                '<textarea id="' + id + '" rows="3">' + esc(val || '') + '</textarea></label>';
        }
        function today() { return new Date().toISOString().slice(0, 10); }
        function renderForm() {
            var f = gg('cg_form'); if (!f) return;
            var html = F(t('Clinic / practice name', '诊所名称', '診所名稱'), 'cg_clinic', clinicName());
            if (DOC === 'cert') {
                html += F(t('Patient name', '病人姓名', '病人姓名'), 'cg_name') +
                    F(t('ID / document no.', '证件号码', '證件號碼'), 'cg_id') +
                    TA(t('Diagnosis (optional)', '诊断（可选）', '診斷（可選）'), 'cg_dx') +
                    F(t('Rest from', '休息自', '休息自'), 'cg_from', today(), 'date') +
                    F(t('Rest to', '休息至', '休息至'), 'cg_to', today(), 'date') +
                    F(t('Doctor name', '医生姓名', '醫生姓名'), 'cg_dr') +
                    F(t('Date issued', '签发日期', '簽發日期'), 'cg_date', today(), 'date');
            } else if (DOC === 'receipt') {
                html += F(t('Receipt no.', '收据编号', '收據編號'), 'cg_no') +
                    F(t('Patient name', '病人姓名', '病人姓名'), 'cg_name') +
                    F(t('Date', '日期', '日期'), 'cg_date', today(), 'date') +
                    TA(t('Items (one per line: description | amount)', '项目（每行：说明 | 金额）', '項目（每行：說明 | 金額）'),
                        'cg_items', t('Consultation | 300\nMedication | 120', '诊金 | 300\n药费 | 120', '診金 | 300\n藥費 | 120')) +
                    F(t('Currency symbol', '货币符号', '貨幣符號'), 'cg_cur', '$') +
                    F(t('Received by', '收款人', '收款人'), 'cg_by');
            } else if (DOC === 'label') {
                html += F(t('Patient name', '病人姓名', '病人姓名'), 'cg_name') +
                    F(t('Drug name', '药物名称', '藥物名稱'), 'cg_drug') +
                    TA(t('Directions', '服用方法', '服用方法'), 'cg_dir', t('Take 1 tablet 3 times daily after meals', '每日三次，每次一片，饭后服用', '每日三次，每次一片，飯後服用')) +
                    F(t('Quantity', '数量', '數量'), 'cg_qty') +
                    F(t('Date', '日期', '日期'), 'cg_date', today(), 'date');
            }
            f.innerHTML = html;
            f.querySelectorAll('input,textarea').forEach(function (el) {
                el.addEventListener('input', renderPreview);
                el.addEventListener('change', renderPreview);
            });
            renderPreview();
        }
        function val(id) { var e = gg(id); return e ? e.value : ''; }
        function renderPreview() {
            var box = gg('cg_preview'); if (!box) return;
            if (DOC === 'cert') box.innerHTML = certHtml();
            else if (DOC === 'receipt') box.innerHTML = receiptHtml();
            else box.innerHTML = labelHtml();
        }
        function fmt(d) { return d || ''; }
        function certHtml() {
            return '<div class="cg-doc cg-cert">' +
                '<h2 class="cg-clinic">' + esc(val('cg_clinic') || t('Clinic Name', '诊所名称', '診所名稱')) + '</h2>' +
                '<h1 class="cg-title">' + esc(t('MEDICAL CERTIFICATE', '病假证明书', '病假證明書')) + '</h1>' +
                '<p class="cg-line">' + esc(t('This is to certify that', '兹证明', '茲證明')) + ' <b>' +
                    esc(val('cg_name') || '__________') + '</b>' +
                    (val('cg_id') ? ' (' + esc(val('cg_id')) + ')' : '') + '</p>' +
                (val('cg_dx') ? '<p class="cg-line">' + esc(t('Diagnosis', '诊断', '診斷')) + ': ' + esc(val('cg_dx')) + '</p>' : '') +
                '<p class="cg-line">' + esc(t('is advised to rest from', '建议休息自', '建議休息自')) +
                    ' <b>' + esc(fmt(val('cg_from'))) + '</b> ' + esc(t('to', '至', '至')) +
                    ' <b>' + esc(fmt(val('cg_to'))) + '</b>.</p>' +
                '<div class="cg-sign">' +
                    '<div class="cg-sign-line">' + esc(val('cg_dr') || '__________') + '<span>' +
                        esc(t('Doctor', '医生', '醫生')) + '</span></div>' +
                    '<div class="cg-sign-line">' + esc(fmt(val('cg_date'))) + '<span>' +
                        esc(t('Date', '日期', '日期')) + '</span></div>' +
                '</div></div>';
        }
        function receiptHtml() {
            var cur = val('cg_cur') || '$';
            var rows = '', total = 0;
            (val('cg_items') || '').split('\n').forEach(function (ln) {
                ln = ln.trim(); if (!ln) return;
                var parts = ln.split('|');
                var desc = (parts[0] || '').trim();
                var amt = parseFloat((parts[1] || '').replace(/[^0-9.\-]/g, ''));
                if (!isNaN(amt)) total += amt;
                rows += '<tr><td>' + esc(desc) + '</td><td class="cg-amt">' +
                    (isNaN(amt) ? '' : cur + r2(amt)) + '</td></tr>';
            });
            return '<div class="cg-doc cg-receipt">' +
                '<h2 class="cg-clinic">' + esc(val('cg_clinic') || t('Clinic Name', '诊所名称', '診所名稱')) + '</h2>' +
                '<h1 class="cg-title">' + esc(t('RECEIPT', '收据', '收據')) + '</h1>' +
                '<div class="cg-meta"><span>' + esc(t('No.', '编号', '編號')) + ': ' + esc(val('cg_no')) + '</span>' +
                    '<span>' + esc(t('Date', '日期', '日期')) + ': ' + esc(fmt(val('cg_date'))) + '</span></div>' +
                '<p class="cg-line">' + esc(t('Received from', '收到', '收到')) + ': <b>' + esc(val('cg_name')) + '</b></p>' +
                '<table class="cg-table"><thead><tr><th>' + esc(t('Description', '说明', '說明')) +
                    '</th><th class="cg-amt">' + esc(t('Amount', '金额', '金額')) + '</th></tr></thead>' +
                    '<tbody>' + rows + '</tbody>' +
                    '<tfoot><tr><td>' + esc(t('Total', '总计', '總計')) + '</td><td class="cg-amt"><b>' +
                        cur + r2(total) + '</b></td></tr></tfoot></table>' +
                '<div class="cg-sign"><div class="cg-sign-line">' + esc(val('cg_by') || '__________') +
                    '<span>' + esc(t('Received by', '收款人', '收款人')) + '</span></div></div></div>';
        }
        function labelHtml() {
            return '<div class="cg-doc cg-label">' +
                '<div class="cg-label-clinic">' + esc(val('cg_clinic') || t('Clinic Name', '诊所名称', '診所名稱')) + '</div>' +
                '<div class="cg-label-row"><b>' + esc(val('cg_name') || '__________') + '</b>' +
                    '<span>' + esc(fmt(val('cg_date'))) + '</span></div>' +
                '<div class="cg-label-drug">' + esc(val('cg_drug') || '__________') +
                    (val('cg_qty') ? ' × ' + esc(val('cg_qty')) : '') + '</div>' +
                '<div class="cg-label-dir">' + esc(val('cg_dir')) + '</div></div>';
        }
        function doPrint() {
            var node = gg('cg_preview'); if (!node) return;
            var w = window.open('', '_blank', 'width=820,height=920');
            if (!w) return;
            w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' +
                esc(t('Print', '打印', '列印')) + '</title>' + printCss() + '</head><body>' +
                node.innerHTML + '<' + '/body><' + '/html>');
            w.document.close(); w.focus();
            setTimeout(function () { w.print(); }, 350);
        }
        function printCss() {
            return '<style>' +
                'body{font-family:"Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif;color:#1a1a1a;margin:32px;}' +
                '.cg-doc{max-width:680px;margin:0 auto;}' +
                '.cg-clinic{text-align:center;margin:0 0 4px;font-size:18px;}' +
                '.cg-title{text-align:center;letter-spacing:2px;font-size:22px;margin:0 0 24px;}' +
                '.cg-line{font-size:15px;line-height:1.9;margin:8px 0;}' +
                '.cg-meta{display:flex;justify-content:space-between;font-size:13px;color:#555;margin-bottom:12px;}' +
                '.cg-table{width:100%;border-collapse:collapse;margin:12px 0;font-size:14px;}' +
                '.cg-table th,.cg-table td{border-bottom:1px solid #ddd;padding:8px;text-align:left;}' +
                '.cg-amt{text-align:right;}' +
                '.cg-sign{display:flex;justify-content:space-between;margin-top:56px;}' +
                '.cg-sign-line{border-top:1px solid #333;padding-top:6px;min-width:180px;text-align:center;font-size:13px;}' +
                '.cg-sign-line span{display:block;color:#777;font-size:11px;}' +
                '.cg-label{border:2px dashed #888;border-radius:8px;padding:16px;max-width:380px;}' +
                '.cg-label-clinic{font-weight:700;text-align:center;border-bottom:1px solid #ccc;padding-bottom:6px;margin-bottom:8px;}' +
                '.cg-label-row{display:flex;justify-content:space-between;font-size:14px;}' +
                '.cg-label-drug{font-size:17px;font-weight:700;margin:8px 0;}' +
                '.cg-label-dir{font-size:14px;line-height:1.6;}' +
                '</style>';
        }
        function doPdf() {
            var node = gg('cg_preview'); if (!node) return;
            var btn = gg('cg_pdf'); btn.disabled = true;
            var oldTxt = btn.textContent; btn.textContent = t('Working…', '处理中…', '處理中…');
            ensureHtml2Canvas().then(function (html2canvas) {
                return ensureJsPdf().then(function (jsPDF) {
                    return html2canvas(node.firstChild || node, { scale: 2, backgroundColor: '#ffffff' })
                        .then(function (canvas) {
                            var img = canvas.toDataURL('image/jpeg', 0.95);
                            var pdf = new jsPDF({ unit: 'pt', format: 'a4' });
                            var pw = pdf.internal.pageSize.getWidth();
                            var margin = 36;
                            var iw = pw - margin * 2;
                            var ih = iw * canvas.height / canvas.width;
                            pdf.addImage(img, 'JPEG', margin, margin, iw, ih);
                            pdf.save(DOC + '.pdf');
                        });
                });
            }).catch(function (e) {
                alert(t('PDF export failed: ', 'PDF 导出失败：', 'PDF 匯出失敗：') + (e && e.message || e));
            }).then(function () { btn.disabled = false; btn.textContent = oldTxt; });
        }
        return { open: open };
    })();

    // ── export ──────────────────────────────────────────────────────
    window.MEDCALC = MEDCALC;
    window.QRTOOL = QRTOOL;
    window.PDFUTIL = PDFUTIL;
    window.CERTGEN = CERTGEN;
})();
