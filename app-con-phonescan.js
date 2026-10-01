/* =========================================================
   app-con-phonescan.js — "Phone scan upload" for Consultation > Photos / Docs
   The clinic computer shows a QR code; the phone opens scan.html, scans pages and
   sends them (add-only: the phone cannot list, change or delete anything). This side
   watches the one-time inbox folder, saves every received file to the patient exactly
   like a normal upload, removes the staged copy, then opens the Photos tab on the result.
   ========================================================= */

(function () {
    var MORE = {
        'cm.add.phone': { en: 'Phone scan upload', 'zh-CN': '手机扫描上传', 'zh-Hant': '手機掃描上載' },
        'cm.scan.title': { en: 'Phone scan upload', 'zh-CN': '手机扫描上传', 'zh-Hant': '手機掃描上載' },
        'cm.scan.for': { en: 'Saving to', 'zh-CN': '保存到', 'zh-Hant': '儲存到' },
        'cm.scan.step1': { en: 'Scan this QR code with the phone camera.', 'zh-CN': '用手机相机扫描此二维码。', 'zh-Hant': '用手機相機掃描此 QR 碼。' },
        'cm.scan.step2': { en: 'Scan the pages. Tap Send on the phone.', 'zh-CN': '扫描文件页面，在手机上点“发送”。', 'zh-Hant': '掃描文件頁面，在手機上按「傳送」。' },
        'cm.scan.step3': { en: 'They are saved to this patient automatically.', 'zh-CN': '文件会自动保存到此患者。', 'zh-Hant': '文件會自動儲存到此病人。' },
        'cm.scan.category': { en: 'Save as', 'zh-CN': '保存为', 'zh-Hant': '儲存為' },
        'cm.scan.autoClose': { en: 'Close and show the files when the phone finishes', 'zh-CN': '手机完成后自动关闭并显示文件', 'zh-Hant': '手機完成後自動關閉並顯示檔案' },
        'cm.scan.writeOnly': { en: 'The phone can only add files. It cannot change or delete anything.', 'zh-CN': '手机只能新增文件，无法修改或删除任何内容。', 'zh-Hant': '手機只能新增檔案，無法修改或刪除任何內容。' },
        'cm.scan.stWaiting': { en: 'Waiting for the phone…', 'zh-CN': '等待手机…', 'zh-Hant': '等待手機…' },
        'cm.scan.stConnected': { en: 'Phone connected. Waiting for pages…', 'zh-CN': '手机已连接，等待页面…', 'zh-Hant': '手機已連接，等待頁面…' },
        'cm.scan.stReceiving': { en: 'Receiving and saving…', 'zh-CN': '正在接收并保存…', 'zh-Hant': '正在接收並儲存…' },
        'cm.scan.stSaved': { en: 'Saved {N} file(s). You can keep scanning.', 'zh-CN': '已保存 {N} 个文件，可继续扫描。', 'zh-Hant': '已儲存 {N} 個檔案，可繼續掃描。' },
        'cm.scan.stDone': { en: 'Phone finished. {N} file(s) saved.', 'zh-CN': '手机已完成，已保存 {N} 个文件。', 'zh-Hant': '手機已完成，已儲存 {N} 個檔案。' },
        'cm.scan.stExpired': { en: 'This code has expired. Make a new one.', 'zh-CN': '此二维码已过期，请重新生成。', 'zh-Hant': '此 QR 碼已過期，請重新產生。' },
        'cm.scan.stError': { en: 'Could not check for files: {MSG}', 'zh-CN': '无法检查文件：{MSG}', 'zh-Hant': '無法檢查檔案：{MSG}' },
        'cm.scan.timeLeft': { en: 'Valid for {MIN} min', 'zh-CN': '有效时间 {MIN} 分钟', 'zh-Hant': '有效時間 {MIN} 分鐘' },
        'cm.scan.newCode': { en: 'New code', 'zh-CN': '重新生成', 'zh-Hant': '重新產生' },
        'cm.scan.close': { en: 'Close', 'zh-CN': '关闭', 'zh-Hant': '關閉' },
        'cm.scan.showFiles': { en: 'Show in Photos', 'zh-CN': '在照片中查看', 'zh-Hant': '在相片中查看' },
        'cm.scan.link': { en: 'Phone page address', 'zh-CN': '手机页面地址', 'zh-Hant': '手機頁面位址' },
        'cm.scan.linkHint': { en: 'The phone must be able to open this address. The camera needs https.', 'zh-CN': '手机必须能打开此地址，相机需要 https。', 'zh-Hant': '手機必須能開啟此位址，相機需要 https。' },
        'cm.scan.copy': { en: 'Copy link', 'zh-CN': '复制链接', 'zh-Hant': '複製連結' },
        'cm.scan.copied': { en: 'Link copied', 'zh-CN': '链接已复制', 'zh-Hant': '連結已複製' },
        'cm.scan.localWarn': { en: 'This address only works on this computer. Open the app from its https address (or type the address your phone can reach) first.', 'zh-CN': '此地址只能在本机使用。请从 https 地址打开系统，或填写手机可访问的地址。', 'zh-Hant': '此位址只能在本機使用。請從 https 位址開啟系統，或填寫手機可存取的位址。' },
        'cm.scan.needPatient': { en: 'Pick a patient on Treatment Notes first.', 'zh-CN': '请先在治疗记录中选择患者。', 'zh-Hant': '請先在治療記錄中選擇病人。' },
        'cm.scan.received': { en: 'Received', 'zh-CN': '已接收', 'zh-Hant': '已接收' },
        'cm.scan.itemSaved': { en: 'saved', 'zh-CN': '已保存', 'zh-Hant': '已儲存' },
        'cm.scan.itemFailed': { en: 'failed', 'zh-CN': '失败', 'zh-Hant': '失敗' },
        'cm.scan.itemSaving': { en: 'saving…', 'zh-CN': '保存中…', 'zh-Hant': '儲存中…' },
        'cm.scan.toastAdded': { en: '{N} scanned file(s) added to the patient.', 'zh-CN': '已为患者新增 {N} 个扫描文件。', 'zh-Hant': '已為病人新增 {N} 個掃描檔案。' },
        'cm.scan.qrFail': { en: 'QR code could not be drawn. Copy the link instead.', 'zh-CN': '无法生成二维码，请复制链接。', 'zh-Hant': '無法產生 QR 碼，請複製連結。' },
        'cm.scan.caption': { en: 'Phone scan', 'zh-CN': '手机扫描', 'zh-Hant': '手機掃描' },
        'media.cat.scanDoc': { en: 'Scanned document', 'zh-CN': '扫描文件', 'zh-Hant': '掃描文件' }
    };
    if (typeof I18N_STRINGS !== 'undefined') {
        Object.keys(MORE).forEach(function (k) { I18N_STRINGS[k] = MORE[k]; });
    }
})();

var CON_SCAN_TTL_MS = 20 * 60 * 1000;
var CON_SCAN_POLL_MS = 2500;
var CON_SCAN_BASE_KEY = 'csPhoneScanBase';
var CON_SCAN_AUTOCLOSE_KEY = 'csPhoneScanAutoClose';
var CON_SCAN_PREFIX = 'phone-scan';
var CON_SCAN_CATEGORY = 'Scanned Document';
var CON_SCAN_QR_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

var CON_SCAN = {
    active: false,
    token: '',
    pid: null,
    pdata: null,
    expiresAt: 0,
    handled: {},
    attempts: {},
    markers: {},
    items: [],
    savedIds: [],
    phoneSeen: false,
    phoneDone: false,
    busy: false,
    pollTimer: null,
    tickTimer: null,
    state: 'waiting',
    errMsg: ''
};

/* ── pure helpers ────────────────────────────────────────── */

function conScanNewToken() {
    var bytes = [];
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        var a = new Uint8Array(20);
        crypto.getRandomValues(a);
        bytes = Array.prototype.slice.call(a);
    } else {
        for (var i = 0; i < 20; i++) bytes.push(Math.floor(Math.random() * 256));
    }
    var t = bytes.map(function (b) { return (b % 36).toString(36); }).join('');
    return t.length >= 20 ? t : (t + '0000000000000000000000').slice(0, 20);
}

/** "A.B." for Latin names, first character + circles for CJK names. Never the full name. */
function conScanMaskName(name) {
    var s = String(name || '').trim();
    if (!s) return '';
    if (/[\u3400-\u9fff]/.test(s)) {
        var chars = Array.from(s.replace(/\s+/g, ''));
        return chars[0] + chars.slice(1).map(function () { return '○'; }).join('');
    }
    return s.split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase() + '.'; }).join(' ');
}

function conScanLabel(p) {
    if (!p) return '';
    var bits = [];
    if (p.patient_no) bits.push('#' + p.patient_no);
    var m = conScanMaskName(p.full_name || p.english_name || '');
    if (m) bits.push(m);
    return bits.join(' · ');
}

function conScanDefaultBase(loc) {
    var l = loc || (typeof location !== 'undefined' ? location : null);
    if (!l) return 'scan.html';
    var href = String(l.href || '').split('#')[0].split('?')[0];
    var i = href.lastIndexOf('/');
    return (i >= 0 ? href.slice(0, i + 1) : href + '/') + 'scan.html';
}

function conScanIsLocalBase(base) {
    var m = /^(https?:)\/\/([^\/:?#]+)/i.exec(String(base || ''));
    if (!m) return true;
    var h = m[2].toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '0.0.0.0' || /\.test$/.test(h) || /\.local$/.test(h);
}

function conScanBuildUrl(base, token, label, lang, expiresAt) {
    var b = String(base || '').trim() || conScanDefaultBase();
    var q = 't=' + encodeURIComponent(token) +
        (label ? '&l=' + encodeURIComponent(label) : '') +
        (lang ? '&g=' + encodeURIComponent(lang) : '') +
        (expiresAt ? '&x=' + String(expiresAt) : '');
    return b + (b.indexOf('?') >= 0 ? '&' : '?') + q;
}

/** Classify a listing of the inbox folder into files to import and markers. */
function conScanClassify(listing) {
    var out = { files: [], hello: [], done: [] };
    (listing || []).forEach(function (o) {
        var n = o && o.name ? String(o.name) : '';
        if (!n || n.charAt(0) === '.') return;
        if (n.indexOf('_hello_') === 0) out.hello.push(n);
        else if (n.indexOf('_done_') === 0) out.done.push(n);
        else if (n.charAt(0) === '_') return;
        else out.files.push(n);
    });
    out.files.sort();
    return out;
}

function conScanExt(name) {
    var m = /\.([a-z0-9]{2,5})$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : 'jpg';
}

function conScanMime(ext) {
    return { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }[ext] || 'application/octet-stream';
}

function conScanFileName(now, n, ext) {
    var d = new Date(now);
    var p = function (x) { return String(x).padStart(2, '0'); };
    return 'scan_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' +
        p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '_' + n + '.' + ext;
}

function conScanTr(key) { return (typeof conMediaTr === 'function') ? conMediaTr(key) : key; }
function conScanTrRepl(key, pairs) { return (typeof conMediaTrRepl === 'function') ? conMediaTrRepl(key, pairs) : key; }
function conScanEl(id) { return (typeof document !== 'undefined') ? document.getElementById(id) : null; }

function conScanEsc(s) {
    return (typeof conMediaEsc === 'function') ? conMediaEsc(s) :
        String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
}

/* ── QR ──────────────────────────────────────────────────── */

var _conScanQrLoad = null;
function conScanLoadQR() {
    if (typeof window !== 'undefined' && window.QRCode) return Promise.resolve(window.QRCode);
    if (_conScanQrLoad) return _conScanQrLoad;
    _conScanQrLoad = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = CON_SCAN_QR_CDN;
        s.async = true;
        s.onload = function () { resolve(window.QRCode); };
        s.onerror = function () { _conScanQrLoad = null; reject(new Error('qr load failed')); };
        document.head.appendChild(s);
    });
    return _conScanQrLoad;
}

function conScanDrawQr(url) {
    var host = conScanEl('conScanQr');
    if (!host) return Promise.resolve(false);
    host.innerHTML = '';
    return conScanLoadQR().then(function (QR) {
        if (!QR) throw new Error('no qr');
        new QR(host, { text: url, width: 220, height: 220, colorDark: '#0f172a', colorLight: '#ffffff', correctLevel: QR.CorrectLevel.M });
        host.setAttribute('data-url', url);
        return true;
    }).catch(function () {
        host.innerHTML = '<div class="con-scan-qr-fail">' + conScanEsc(conScanTr('cm.scan.qrFail')) + '</div>';
        return false;
    });
}

/* ── session ─────────────────────────────────────────────── */

function conScanBase() {
    var el = conScanEl('conScanBase');
    var v = el ? el.value.trim() : '';
    if (v) return v;
    try { v = localStorage.getItem(CON_SCAN_BASE_KEY) || ''; } catch (e) { v = ''; }
    return v || conScanDefaultBase();
}

function conScanCurrentUrl() {
    return conScanBuildUrl(conScanBase(), CON_SCAN.token, conScanLabel(CON_SCAN.pdata),
        (typeof getAppLang === 'function') ? getAppLang() : 'en', CON_SCAN.expiresAt);
}

function conScanOpen() {
    var pid = (typeof conMediaPid === 'function') ? conMediaPid() : null;
    if (!pid) {
        if (typeof conMediaNotify === 'function') conMediaNotify(conScanTr('cm.scan.needPatient'), 'info');
        return false;
    }
    if (typeof switchConTab === 'function' && typeof document !== 'undefined' &&
        !document.querySelector('.con-tab[data-tab="photos"].active')) {
        switchConTab('photos');
    }
    conScanStop(true);
    CON_SCAN.pid = pid;
    CON_SCAN.pdata = (typeof conPatientData !== 'undefined' && conPatientData && conPatientData.id === pid) ? conPatientData : { id: pid };
    conScanStartSession();
    var m = conScanEl('conScanModal');
    if (m) {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(m);
        conScanFillStatic();
        if (typeof openModal === 'function') openModal('conScanModal'); else m.style.display = 'block';
    }
    conScanRender();
    conScanDrawQr(conScanCurrentUrl());
    return true;
}

function conScanStartSession() {
    CON_SCAN.active = true;
    CON_SCAN.token = conScanNewToken();
    CON_SCAN.expiresAt = Date.now() + CON_SCAN_TTL_MS;
    CON_SCAN.handled = {};
    CON_SCAN.attempts = {};
    CON_SCAN.markers = {};
    CON_SCAN.items = [];
    CON_SCAN.savedIds = [];
    CON_SCAN.phoneSeen = false;
    CON_SCAN.phoneDone = false;
    CON_SCAN.busy = false;
    CON_SCAN.state = 'waiting';
    CON_SCAN.errMsg = '';
    clearInterval(CON_SCAN.pollTimer);
    clearInterval(CON_SCAN.tickTimer);
    CON_SCAN.pollTimer = setInterval(conScanPoll, CON_SCAN_POLL_MS);
    CON_SCAN.tickTimer = setInterval(conScanTick, 1000);
}

function conScanStop(silent) {
    CON_SCAN.active = false;
    clearInterval(CON_SCAN.pollTimer);
    clearInterval(CON_SCAN.tickTimer);
    CON_SCAN.pollTimer = null;
    CON_SCAN.tickTimer = null;
    if (!silent) conScanRender();
}

function conScanNewCode() {
    if (!CON_SCAN.pid) return;
    var pid = CON_SCAN.pid;
    var pdata = CON_SCAN.pdata;
    conScanStop(true);
    CON_SCAN.pid = pid;
    CON_SCAN.pdata = pdata;
    conScanStartSession();
    conScanRender();
    conScanDrawQr(conScanCurrentUrl());
}

function conScanClose() {
    var ids = CON_SCAN.savedIds.slice();
    var pid = CON_SCAN.pid;
    conScanStop(true);
    var m = conScanEl('conScanModal');
    if (m) {
        if (typeof closeModal === 'function') closeModal('conScanModal'); else m.style.display = 'none';
    }
    return conScanRevealSaved(pid, ids);
}

/* ── polling + import ────────────────────────────────────── */

function conScanTick() {
    if (!CON_SCAN.active) return;
    if (Date.now() > CON_SCAN.expiresAt) {
        CON_SCAN.state = 'expired';
        conScanStop(true);
    }
    conScanRenderTimer();
    if (CON_SCAN.state === 'expired') conScanRender();
}

function conScanComputeState() {
    if (CON_SCAN.state === 'expired') return 'expired';
    if (CON_SCAN.errMsg) return 'error';
    var pending = CON_SCAN.items.some(function (it) { return it.status === 'saving'; });
    if (pending) return 'receiving';
    var saved = CON_SCAN.savedIds.length;
    if (CON_SCAN.phoneDone && saved) return 'done';
    if (saved) return 'saved';
    if (CON_SCAN.phoneSeen) return 'connected';
    return 'waiting';
}

function conScanPoll() {
    if (!CON_SCAN.active || CON_SCAN.busy) return Promise.resolve();
    if (typeof SB === 'undefined' || !SB || !SB.storage) return Promise.resolve();
    CON_SCAN.busy = true;
    var token = CON_SCAN.token;
    var bucket = (typeof PHOTO_BUCKET !== 'undefined') ? PHOTO_BUCKET : 'photos';
    return Promise.resolve(SB.storage.from(bucket).list(CON_SCAN_PREFIX + '/' + token, {
        limit: 100, sortBy: { column: 'name', order: 'asc' }
    })).then(function (r) {
        if (token !== CON_SCAN.token || !CON_SCAN.active) return;
        if (r && r.error) {
            CON_SCAN.errMsg = String(r.error.message || r.error);
            conScanRender();
            return;
        }
        CON_SCAN.errMsg = '';
        var cls = conScanClassify(r && r.data);
        if (cls.hello.length) CON_SCAN.phoneSeen = true;
        var newDone = false;
        cls.done.forEach(function (n) {
            if (!CON_SCAN.markers[n]) { CON_SCAN.markers[n] = 1; newDone = true; }
        });
        if (cls.hello.length || cls.done.length) {
            cls.hello.concat(cls.done).forEach(function (n) { conScanRemoveStaged(bucket, token, n); });
        }
        var fresh = cls.files.filter(function (n) {
            var h = CON_SCAN.handled[n];
            return !h || (h === 'failed' && (CON_SCAN.attempts[n] || 0) < 3);
        });
        fresh.forEach(function (n) { CON_SCAN.handled[n] = 'queued'; });
        if (newDone) CON_SCAN.phoneDone = true;
        conScanRender();
        return fresh.reduce(function (chain, name) {
            return chain.then(function () { return conScanImportOne(bucket, token, name); });
        }, Promise.resolve());
    }).catch(function (e) {
        CON_SCAN.errMsg = String((e && e.message) || e);
        conScanRender();
    }).then(function () {
        CON_SCAN.busy = false;
        conScanAfterPoll();
    });
}

function conScanRemoveStaged(bucket, token, name) {
    try {
        Promise.resolve(SB.storage.from(bucket).remove([CON_SCAN_PREFIX + '/' + token + '/' + name])).then(function () {}, function () {});
    } catch (e) { /* best effort */ }
}

function conScanImportOne(bucket, token, name) {
    var item = null;
    CON_SCAN.items.forEach(function (it) { if (it.name === name) item = it; });
    if (!item) {
        item = { name: name, status: 'saving', ext: conScanExt(name), id: null, msg: '' };
        CON_SCAN.items.push(item);
    }
    item.status = 'saving';
    item.msg = '';
    CON_SCAN.attempts[name] = (CON_SCAN.attempts[name] || 0) + 1;
    CON_SCAN.handled[name] = 'saving';
    conScanRender();
    var path = CON_SCAN_PREFIX + '/' + token + '/' + name;
    var pid = CON_SCAN.pid;
    return Promise.resolve(SB.storage.from(bucket).download(path)).then(function (r) {
        if (!r || r.error || !r.data) throw new Error((r && r.error && r.error.message) || 'download failed');
        var ext = item.ext;
        var file = new File([r.data], conScanFileName(Date.now(), CON_SCAN.items.length, ext), { type: conScanMime(ext) });
        var catEl = conScanEl('conScanCat');
        var meta = {
            category: (catEl && catEl.value) || CON_SCAN_CATEGORY,
            taken_date: (typeof todayISO === 'function') ? todayISO() : new Date().toISOString().slice(0, 10),
            caption: conScanTr('cm.scan.caption'),
            ctx: { tags: ['phone-scan'] },
            patientId: pid
        };
        return photoUploadOne(file, meta, function () {});
    }).then(function (res) {
        if (!res || !res.ok) throw new Error((res && res.msg) || 'save failed');
        item.status = 'saved';
        item.id = res.id;
        CON_SCAN.handled[name] = 'saved';
        if (res.id) CON_SCAN.savedIds.push(res.id);
        else CON_SCAN.savedIds.push('?' + name);
        conScanRemoveStaged(bucket, token, name);
    }).catch(function (e) {
        item.status = 'failed';
        item.msg = String((e && e.message) || e);
        CON_SCAN.handled[name] = 'failed';
    }).then(function () { conScanRender(); });
}

function conScanAfterPoll() {
    if (!CON_SCAN.active) return;
    var blocked = CON_SCAN.items.some(function (it) { return it.status === 'saving' || it.status === 'failed'; });
    if (blocked) return;
    if (CON_SCAN.phoneDone && CON_SCAN.savedIds.length && conScanAutoClose()) {
        conScanClose();
    }
}

function conScanAutoClose() {
    var el = conScanEl('conScanAutoClose');
    if (el) return !!el.checked;
    return true;
}

/* ── show the result in Photos & Docs ─────────────────────── */

function conScanRevealSaved(pid, ids) {
    var real = (ids || []).filter(function (x) { return String(x).charAt(0) !== '?'; });
    if (!ids || !ids.length) return Promise.resolve(false);
    if (typeof conMediaNotify === 'function') {
        conMediaNotify(conScanTrRepl('cm.scan.toastAdded', { N: ids.length }), 'info');
    }
    if (typeof switchConTab === 'function') switchConTab('photos');
    var sel = conScanEl('photoFilterCat');
    if (sel) sel.value = '';
    var reload = (typeof photoPatientId !== 'undefined' && photoPatientId === pid && typeof loadPhotoRecords === 'function')
        ? loadPhotoRecords() : Promise.resolve();
    return Promise.resolve(reload).then(function () {
        if (typeof conMediaSetView === 'function') conMediaSetView('photos');
        var first = null;
        real.forEach(function (id) {
            var card = document.querySelector('#photoGridView .xray-card[data-id="' + String(id).replace(/"/g, '') + '"]');
            if (!card) return;
            card.classList.add('con-scan-new');
            if (!first) first = card;
            setTimeout(function () { card.classList.remove('con-scan-new'); }, 8000);
        });
        if (first && first.scrollIntoView) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return true;
    });
}

/* ── render ──────────────────────────────────────────────── */

function conScanFillStatic() {
    var cat = conScanEl('conScanCat');
    if (cat) {
        var prev = cat.value || CON_SCAN_CATEGORY;
        var pairs = (typeof PHOTO_CATEGORY_PAIRS !== 'undefined') ? PHOTO_CATEGORY_PAIRS : [[CON_SCAN_CATEGORY, 'media.cat.scanDoc']];
        cat.innerHTML = pairs.map(function (pr) {
            return '<option value="' + conScanEsc(pr[0]) + '">' + conScanEsc(conScanTr(pr[1])) + '</option>';
        }).join('');
        cat.value = prev;
        if (cat.value !== prev) cat.value = CON_SCAN_CATEGORY;
    }
    var base = conScanEl('conScanBase');
    if (base) {
        var saved = '';
        try { saved = localStorage.getItem(CON_SCAN_BASE_KEY) || ''; } catch (e) { saved = ''; }
        base.value = saved || conScanDefaultBase();
        if (!base.dataset.wired) {
            base.dataset.wired = '1';
            base.addEventListener('change', function () {
                var v = base.value.trim();
                try {
                    if (v && v !== conScanDefaultBase()) localStorage.setItem(CON_SCAN_BASE_KEY, v);
                    else localStorage.removeItem(CON_SCAN_BASE_KEY);
                } catch (e) { /* ignore */ }
                if (CON_SCAN.active) { conScanDrawQr(conScanCurrentUrl()); conScanRender(); }
            });
        }
    }
    var ac = conScanEl('conScanAutoClose');
    if (ac && !ac.dataset.wired) {
        ac.dataset.wired = '1';
        var v = null;
        try { v = localStorage.getItem(CON_SCAN_AUTOCLOSE_KEY); } catch (e) { v = null; }
        ac.checked = v !== '0';
        ac.addEventListener('change', function () {
            try { localStorage.setItem(CON_SCAN_AUTOCLOSE_KEY, ac.checked ? '1' : '0'); } catch (e) { /* ignore */ }
        });
    }
}

function conScanRenderTimer() {
    var el = conScanEl('conScanTimer');
    if (!el) return;
    var left = Math.max(0, CON_SCAN.expiresAt - Date.now());
    el.textContent = CON_SCAN.active ? conScanTrRepl('cm.scan.timeLeft', { MIN: Math.max(1, Math.ceil(left / 60000)) }) : '';
}

function conScanRender() {
    var modal = conScanEl('conScanModal');
    if (!modal) return;
    var forEl = conScanEl('conScanFor');
    if (forEl) {
        var p = CON_SCAN.pdata || {};
        forEl.textContent = conScanTr('cm.scan.for') + ': ' + [p.patient_no ? '#' + p.patient_no : '', p.full_name || ''].filter(Boolean).join(' · ');
    }
    var st = conScanComputeState();
    CON_SCAN.state = CON_SCAN.state === 'expired' ? 'expired' : st;
    var n = CON_SCAN.savedIds.length;
    var text = {
        waiting: conScanTr('cm.scan.stWaiting'),
        connected: conScanTr('cm.scan.stConnected'),
        receiving: conScanTr('cm.scan.stReceiving'),
        saved: conScanTrRepl('cm.scan.stSaved', { N: n }),
        done: conScanTrRepl('cm.scan.stDone', { N: n }),
        expired: conScanTr('cm.scan.stExpired'),
        error: conScanTrRepl('cm.scan.stError', { MSG: CON_SCAN.errMsg })
    }[st];
    var stEl = conScanEl('conScanStatus');
    if (stEl) {
        stEl.textContent = text;
        stEl.setAttribute('data-state', st);
    }
    var list = conScanEl('conScanList');
    if (list) {
        list.innerHTML = CON_SCAN.items.map(function (it) {
            var label = it.status === 'saved' ? conScanTr('cm.scan.itemSaved')
                : it.status === 'failed' ? conScanTr('cm.scan.itemFailed') + (it.msg ? ': ' + it.msg : '')
                : conScanTr('cm.scan.itemSaving');
            return '<div class="con-scan-item is-' + it.status + '">' +
                (it.ext === 'pdf' ? '📄' : '🖼️') + ' <span class="con-scan-item-name">' + conScanEsc(it.name) + '</span> · ' +
                conScanEsc(label) + '</div>';
        }).join('');
    }
    var show = conScanEl('conScanShowBtn');
    if (show) show.hidden = !n;
    var qrCol = conScanEl('conScanQrCol');
    if (qrCol) qrCol.classList.toggle('is-dim', st === 'expired');
    var warn = conScanEl('conScanLocalWarn');
    if (warn) warn.hidden = !conScanIsLocalBase(conScanBase());
    conScanRenderTimer();
}

function conScanCopyLink() {
    var url = conScanCurrentUrl();
    var done = function () {
        if (typeof conMediaNotify === 'function') conMediaNotify(conScanTr('cm.scan.copied'), 'info');
    };
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () { window.prompt(conScanTr('cm.scan.copy'), url); });
    } else if (typeof window !== 'undefined') {
        window.prompt(conScanTr('cm.scan.copy'), url);
    }
}

function conScanWire() {
    var modal = conScanEl('conScanModal');
    if (!modal || modal.dataset.wired === '1') return;
    modal.dataset.wired = '1';
    modal.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-scan-act]') : null;
        if (!b) return;
        var act = b.getAttribute('data-scan-act');
        if (act === 'close') conScanClose();
        else if (act === 'new') conScanNewCode();
        else if (act === 'copy') conScanCopyLink();
        else if (act === 'show') conScanClose();
    });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', conScanWire);
    else conScanWire();
}
