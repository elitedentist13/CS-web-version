// ════════════════════════════════════════════════════════════════
// UI LANGUAGE — English, 中文 (简体), 繁體中文
// ════════════════════════════════════════════════════════════════

var I18N_STORAGE_KEY = 'joyful_ui_lang_v1';

/** @type {'en'|'zh-CN'|'zh-Hant'} */
var appUiLang = 'en';

var I18N_LOCALES = ['en', 'zh-CN', 'zh-Hant'];

var I18N_STRINGS = {
    'app.title': {
        en: 'Banana Clinic Manager',
        'zh-CN': '香蕉診所管理系統',
        'zh-Hant': '香蕉診所管理系統'
    },
    'dashboard.title': {
        en: '🦷 Joyful Smile Dashboard',
        'zh-CN': '🦷 乐意 控制台',
        'zh-Hant': '🦷 樂意 控制台'
    },
    'dashboard.logout': {
        en: '🚪 Logout',
        'zh-CN': '🚪 退出登录',
        'zh-Hant': '🚪 登出'
    },
    'dashboard.help': {
        en: '❓ Help',
        'zh-CN': '❓ 帮助',
        'zh-Hant': '❓ 說明'
    },
    'dashboard.helpTitle': {
        en: 'Open user guide in a new window',
        'zh-CN': '在新窗口打开用户指南',
        'zh-Hant': '在新視窗開啟使用說明'
    },
    'dashboard.langGroup': {
        en: 'Display language',
        'zh-CN': '显示语言',
        'zh-Hant': '顯示語言'
    },
    'lang.en': {
        en: 'English',
        'zh-CN': 'English',
        'zh-Hant': 'English'
    },
    'lang.zhCN': {
        en: 'Chinese',
        'zh-CN': '中文',
        'zh-Hant': '中文'
    },
    'lang.zhHant': {
        en: 'Traditional Chinese',
        'zh-CN': '繁体中文',
        'zh-Hant': '繁體中文'
    },
    'dashboard.card.appointment': {
        en: 'Appointment',
        'zh-CN': '预约',
        'zh-Hant': '預約'
    },
    'dashboard.card.consultation': {
        en: 'Consultation',
        'zh-CN': '诊疗',
        'zh-Hant': '診療'
    },
    'status.inConsultation': {
        en: 'Consult',
        'zh-CN': '诊疗',
        'zh-Hant': '診療'
    },
    'dashboard.card.drugbook': {
        en: 'Drug Book',
        'zh-CN': '药册',
        'zh-Hant': '藥冊'
    },
    'dashboard.card.report': {
        en: 'Report',
        'zh-CN': '报表',
        'zh-Hant': '報表'
    },
    'dashboard.card.aiHelper': {
        en: 'AI Patient Assistant',
        'zh-CN': 'AI 患者助手',
        'zh-Hant': 'AI 患者助手'
    },
    'dashboard.card.memoAi': {
        en: 'Memo Cards + AI',
        'zh-CN': '备忘卡片 + AI',
        'zh-Hant': '備忘卡片 + AI'
    },
    'dashboard.card.patient': {
        en: 'Patient',
        'zh-CN': '患者',
        'zh-Hant': '病人'
    },
    'dashboard.card.expenses': {
        en: 'Expenses',
        'zh-CN': '费用',
        'zh-Hant': '開支'
    },
    'dashboard.card.inventory': {
        en: 'Inventory',
        'zh-CN': '库存',
        'zh-Hant': '庫存'
    },
    'dashboard.card.configuration': {
        en: 'Configuration',
        'zh-CN': '设置',
        'zh-Hant': '設定'
    },
    'dashboard.memoHint': {
        en: '📌 New stickies sit along the bottom by default — tiles stay clear; empty areas still click through · Double‑click opens Memo Cards + AI · Drag anytime',
        'zh-CN': '📌 新便签默认排在底部 — 卡片区域保持清晰；空白处仍可点击 · 双击打开「备忘卡片 + AI」· 可随时拖动',
        'zh-Hant': '📌 新便簽預設排在底部 — 卡片區域保持清晰；空白處仍可點擊 · 雙擊開啟「備忘卡片 + AI」· 可隨時拖動'
    },

    // ── Keyboard refresh hint (dashboard) ──────────────────────
    'dashboard.kbHint.toggleLabel': {
        en: 'Keyboard Refresh Guide',
        'zh-CN': '键盘刷新快捷键说明',
        'zh-Hant': '鍵盤重新整理說明'
    },
    'dashboard.kbHint.f2': {
        en: 'App soft refresh — re-fetches live data for the current screen without reloading the page. Scroll position is preserved.',
        'zh-CN': '应用内刷新 — 仅重新获取当前界面的最新数据，不重载页面，滚动位置不变。',
        'zh-Hant': '應用內重整 — 僅重新取得目前畫面最新資料，不重載頁面，捲動位置不變。'
    },
    'dashboard.kbHint.f5': {
        en: 'Browser soft reload — reloads the page; HTML and assets may be served from the browser cache. Session and clinic context are restored automatically.',
        'zh-CN': '浏览器软重载 — 重新加载页面；HTML 及资源可能来自浏览器缓存。登录状态和诊所设置自动恢复。',
        'zh-Hant': '瀏覽器軟重載 — 重新載入頁面；HTML 及資源可能來自瀏覽器快取。登入狀態與診所設定自動恢復。'
    },
    'dashboard.kbHint.ctrlF5': {
        en: 'Browser hard reload — forces a fresh download of all HTML, JavaScript and CSS, bypassing the browser cache. Use this when the app appears outdated after an update.',
        'zh-CN': '浏览器强制刷新 — 强制重新下载全部 HTML、JavaScript 及 CSS，绕过浏览器缓存。更新后界面未更新时使用。',
        'zh-Hant': '瀏覽器強制重整 — 強制重新下載所有 HTML、JavaScript 及 CSS，跳過瀏覽器快取。更新後介面未更新時使用。'
    },
    'dashboard.kbHint.ctrlShiftR': {
        en: 'Browser hard reload (alternate) — identical effect to Ctrl+F5, supported in Chrome, Firefox and Edge on Windows / Linux.',
        'zh-CN': '浏览器强制刷新（备用键）— 效果与 Ctrl+F5 完全相同，适用于 Windows / Linux 上的 Chrome、Firefox 和 Edge。',
        'zh-Hant': '瀏覽器強制重整（備用鍵）— 效果與 Ctrl+F5 完全相同，適用於 Windows / Linux 的 Chrome、Firefox 和 Edge。'
    },
    'dashboard.kbHint.macNote': {
        en: 'macOS equivalents: ⌘ R = soft reload · ⌘ Shift R = hard reload (Chrome/Firefox/Edge)',
        'zh-CN': 'macOS 对应快捷键：⌘ R = 软重载 · ⌘ Shift R = 强制刷新（Chrome/Firefox/Edge）',
        'zh-Hant': 'macOS 對應捷徑：⌘ R = 軟重載 · ⌘ Shift R = 強制重整（Chrome/Firefox/Edge）'
    }
};

function i18nNormalizeLang(raw) {
    var s = String(raw || '').trim();
    if (s === 'zh' || s === 'zh-CN' || s === 'zh-cn' || s === 'cn') return 'zh-CN';
    if (s === 'zh-Hant' || s === 'zh-TW' || s === 'zh-HK' || s === 'zh-hant' || s === 'tw') return 'zh-Hant';
    if (s === 'en' || s === 'en-US' || s === 'en-GB') return 'en';
    return 'en';
}

function getAppLang() {
    return appUiLang;
}

function t(key, lang) {
    var L = lang || appUiLang;
    var row = I18N_STRINGS[key];
    if (!row) return key;
    if (row[L]) return row[L];
    if (row.en) return row.en;
    return key;
}

/** Replace {TOKEN} placeholders in a translated string. */
function i18nRepl(str, pairs) {
    var out = String(str == null ? '' : str);
    var k;
    if (!pairs) return out;
    for (k in pairs) {
        if (!Object.prototype.hasOwnProperty.call(pairs, k)) continue;
        out = out.split('{' + k + '}').join(String(pairs[k]));
    }
    return out;
}

/** Format amount with locale-aware currency prefix (UI display only; DB values unchanged). */
function fmtHK(amount) {
    var amt = typeof fmt2 === 'function' ? fmt2(amount) : parseFloat(amount || 0).toFixed(2);
    var sym = (typeof getCurrencySymbol === 'function') ? getCurrencySymbol() : t('common.currencyPrefix');
    return sym + ' ' + amt;
}

function fmtHKNeg(amount) {
    var amt = typeof fmt2 === 'function' ? fmt2(amount) : parseFloat(amount || 0).toFixed(2);
    var sym = (typeof getCurrencySymbol === 'function') ? getCurrencySymbol() : t('common.currencyPrefix');
    return '- ' + sym + ' ' + amt;
}

/** fmtHK for HTML snippets (non-breaking space after symbol). */
function fmtHKHtml(amount) {
    var amt = typeof fmt2 === 'function' ? fmt2(amount) : parseFloat(amount || 0).toFixed(2);
    var sym = (typeof getCurrencySymbol === 'function') ? getCurrencySymbol() : t('common.currencyPrefix');
    return sym + '&nbsp;' + amt;
}

/** Display label for appointment / queue status stored in English in the DB. */
function dispApptStatus(raw) {
    var s = String(raw || '').trim();
    if (!s) return t('status.scheduled');
    var lk = s.toLowerCase().replace(/\s+/g, ' ');
    var keyMap = {
        'scheduled': 'status.scheduled',
        'queue': 'status.queue',
        'in consultation': 'status.inConsultation',
        'consultation': 'status.inConsultation',
        'consult': 'status.inConsultation',
        'done': 'status.done',
        'no show': 'status.noShow',
        'noshow': 'status.noShow',
        'cancelled': 'status.cancelled',
        'canceled': 'status.cancelled',
        'billed': 'status.billed',
        'paid': 'status.paid',
        'partial': 'status.partial',
        'arrived': 'status.arrived'
    };
    if (keyMap[lk]) return t(keyMap[lk]);
    if (/no.?show/i.test(s)) return t('status.noShow');
    if (/cancel/i.test(s)) return t('status.cancelled');
    if (/^done$/i.test(s)) return t('status.done');
    if (/consult/i.test(s)) return t('status.inConsultation');
    if (/queue|arrived/i.test(s)) return t('status.queue');
    if (/partial/i.test(s)) return t('status.partial');
    if (/^paid$/i.test(s)) return t('status.paid');
    if (/bill/i.test(s)) return t('status.billed');
    if (/sched/i.test(s)) return t('status.scheduled');
    return s;
}

/** Display label for app user role codes (admin, doctor, nurse, …). */
function dispRole(raw) {
    var s = String(raw || '').trim().toLowerCase();
    if (!s) return '-';
    var keyMap = {
        admin: 'cfg.role.adminGlobal',
        doctor: 'cfg.role.doctor',
        staff: 'cfg.role.staff',
        nurse: 'cfg.role.nurse',
        receptionist: 'cfg.role.receptionist'
    };
    if (keyMap[s]) return t(keyMap[s]);
    return raw;
}

/** Display label for bill payment method / type_group stored in English in the DB. */
function dispPayMethod(raw, noCfgLookup) {
    var s = String(raw == null ? '' : raw).trim();
    if (!s || /^unknown$/i.test(s)) return t('report.unknown');
    if (!noCfgLookup && typeof window.findBillTypeRow === 'function' &&
        typeof window.billTypeDisplayLabel === 'function') {
        var cfgRow = window.findBillTypeRow(s);
        if (cfgRow) return window.billTypeDisplayLabel(cfgRow, true);
    }
    var lk = s.toLowerCase().replace(/\s+/g, ' ');
    var keyMap = {
        'cash': 'bill.pay.cash',
        'visa': 'bill.pay.visa',
        'mastercard': 'bill.pay.mastercard',
        'eps': 'bill.pay.eps',
        'hkbc': 'bill.pay.hkbc',
        'cheque': 'bill.pay.cheque',
        'bank transfer': 'bill.pay.bankTransfer',
        'insurance': 'bill.pay.insurance',
        'waived': 'bill.pay.waived',
        'other': 'bill.pay.other',
        'pending': 'bill.pay.pending',
        'n/a': 'bill.pay.na',
        'na': 'bill.pay.na',
        'card': 'bill.payGroup.card',
        'bank': 'bill.payGroup.bank',
        'ewallet': 'bill.payGroup.ewallet',
        'e-wallet': 'bill.payGroup.ewallet'
    };
    if (keyMap[lk]) return t(keyMap[lk]);
    return s;
}

function readStoredAppLang() {
    try {
        return localStorage.getItem(I18N_STORAGE_KEY);
    } catch (e) {
        return null;
    }
}

function writeStoredAppLang(lang) {
    try {
        localStorage.setItem(I18N_STORAGE_KEY, lang);
    } catch (e) { /* ignore */ }
}

function applyHtmlLang(lang) {
    var html = document.documentElement;
    if (!html) return;
    if (lang === 'zh-Hant') {
        html.setAttribute('lang', 'zh-Hant');
    } else if (lang === 'zh-CN') {
        html.setAttribute('lang', 'zh-CN');
    } else {
        html.setAttribute('lang', 'en');
    }
}

/** Set label/text without removing nested inputs, selects, or other markup. */
function setI18nText(el, text) {
    if (!el) return;
    var i;
    var kids = el.childNodes;
    var firstEl = null;
    for (i = 0; i < kids.length; i++) {
        if (kids[i].nodeType === 1) {
            firstEl = kids[i];
            break;
        }
    }
    if (!firstEl) {
        el.textContent = text;
        return;
    }
    var toRemove = [];
    for (i = 0; i < kids.length; i++) {
        if (kids[i].nodeType === 3) toRemove.push(kids[i]);
    }
    for (i = 0; i < toRemove.length; i++) {
        el.removeChild(toRemove[i]);
    }
    el.insertBefore(document.createTextNode(text), firstEl);
}

/** Update elements with data-i18n / data-i18n-placeholder / data-i18n-title / data-i18n-aria-label / data-i18n-alt inside root. */
function applyI18nInRoot(root) {
    if (!root) return;
    var i;
    var nodes = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        var key = el.getAttribute('data-i18n');
        if (key) setI18nText(el, t(key));
    }
    nodes = root.querySelectorAll('[data-i18n-placeholder]');
    for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        key = el.getAttribute('data-i18n-placeholder');
        if (key) el.setAttribute('placeholder', t(key));
    }
    nodes = root.querySelectorAll('[data-i18n-title]');
    for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        key = el.getAttribute('data-i18n-title');
        if (key) el.setAttribute('title', t(key));
    }
    nodes = root.querySelectorAll('[data-i18n-aria-label]');
    for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        key = el.getAttribute('data-i18n-aria-label');
        if (key) el.setAttribute('aria-label', t(key));
    }
    nodes = root.querySelectorAll('[data-i18n-alt]');
    for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        key = el.getAttribute('data-i18n-alt');
        if (key) el.setAttribute('alt', t(key));
    }
    nodes = root.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        key = el.getAttribute('data-i18n-html');
        if (key) el.innerHTML = t(key);
    }
}

/** Apply stored language to the whole document (all modules share the same UI language). */
function applyAppI18n() {
    applyI18nInRoot(document.body);
    var group = document.getElementById('dashLangToggle');
    if (group) {
        group.setAttribute('aria-label', t('dashboard.langGroup'));
    }
    var loginGroup = document.getElementById('loginLangToggle');
    if (loginGroup) {
        loginGroup.setAttribute('aria-label', t('dashboard.langGroup'));
    }
    updateLangToggleButtons();
    try {
        document.title = t('app.title');
    } catch (eTitle) { /* ignore */ }
    if (typeof refreshPhotoCategorySelects === 'function') refreshPhotoCategorySelects();
    if (typeof refreshXrayTypeSelects === 'function') refreshXrayTypeSelects();
    if (typeof refreshDrugCategorySelect === 'function') refreshDrugCategorySelect();
    if (typeof refreshDrugCategoryDatalist === 'function') refreshDrugCategoryDatalist();
    if (typeof refreshAllClinicDropdowns === 'function') refreshAllClinicDropdowns();
    if (typeof refreshLoginDoctorSelect === 'function') {
        var ls = typeof g === 'function' ? g('loginDoctor') : null;
        var mode = (typeof loginDoctorSelectMode !== 'undefined') ? loginDoctorSelectMode : 'default';
        refreshLoginDoctorSelect(ls && ls.value ? ls.value : '', mode);
    }
    if (typeof loadConsultationDoctors === 'function') loadConsultationDoctors();
}

function updateLangToggleButtons() {
    var groups = document.querySelectorAll('#dashLangToggle, #loginLangToggle');
    var g;
    for (g = 0; g < groups.length; g++) {
        var wrap = groups[g];
        var btns = wrap.querySelectorAll('.lang-toggle-btn');
        var i;
        for (i = 0; i < btns.length; i++) {
            var btn = btns[i];
            var code = btn.getAttribute('data-lang');
            var on = i18nNormalizeLang(code) === appUiLang;
            btn.classList.toggle('active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    }
}

function applyDashboardI18n() {
    applyAppI18n();
}

function setAppLang(lang, opts) {
    opts = opts || {};
    appUiLang = i18nNormalizeLang(lang);
    writeStoredAppLang(appUiLang);
    applyHtmlLang(appUiLang);

    if (opts.dashboardOnly !== false) {
        applyDashboardI18n();
    }

    if (typeof window !== 'undefined' && typeof window.CustomEvent === 'function') {
        try {
            window.dispatchEvent(new CustomEvent('app-lang-change', { detail: { lang: appUiLang } }));
        } catch (eLangEvt) { /* ignore */ }
    }
}

function bindLangToggleOn(wrap) {
    if (!wrap || wrap.dataset.i18nBound) return;
    wrap.dataset.i18nBound = '1';
    wrap.addEventListener('click', function(ev) {
        var btn = ev.target.closest('.lang-toggle-btn');
        if (!btn || !wrap.contains(btn)) return;
        var code = btn.getAttribute('data-lang');
        if (!code) return;
        setAppLang(code);
    });
}

function bindLangToggle() {
    bindLangToggleOn(document.getElementById('dashLangToggle'));
    bindLangToggleOn(document.getElementById('loginLangToggle'));
}

function initAppI18n() {
    appUiLang = i18nNormalizeLang(readStoredAppLang() || 'en');
    applyHtmlLang(appUiLang);
    bindLangToggle();
    applyAppI18n();
}

document.addEventListener('DOMContentLoaded', initAppI18n);
