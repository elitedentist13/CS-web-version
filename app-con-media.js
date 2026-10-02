/* =========================================================
   app-con-media.js — Consultation "Documents & Media" hub
   Shared by the Photos / Docs and Forms / Letters tabs:
   shared-patient wiring, count strip + quick add, optional
   context columns (visit / tooth / tags / status) with a safe
   fallback when media_context.sql has not been applied,
   deep links, bulk upload + paste/drop, before/after compare,
   quick-create letters, billing/visit placeholders, filterable
   document history and an unsaved-draft safety net.
   ========================================================= */

(function () {
    var MORE = {
        'cm.notes.openPhotos': { en: 'Open this patient\'s photos', 'zh-CN': '打开该患者的照片', 'zh-Hant': '開啟該病人的相片' },
        'cm.notes.openDocs': { en: 'Open this patient\'s letters & forms', 'zh-CN': '打开该患者的信件与表格', 'zh-Hant': '開啟該病人的信件與表格' },
        'cm.need': { en: 'Pick a patient on Treatment Notes first. Photos and Forms always show that same person.', 'zh-CN': '请先在治疗记录中选择患者。照片与表格始终显示同一人。', 'zh-Hant': '請先在治療記錄中選擇病人。相片與表格始終顯示同一人。' },
        'cm.same': { en: 'Same patient as Treatment Notes.', 'zh-CN': '与治疗记录为同一患者。', 'zh-Hant': '與治療記錄為同一病人。' },
        'cm.pick': { en: 'Pick / change patient on Treatment Notes', 'zh-CN': '到治疗记录选择或更换患者', 'zh-Hant': '到治療記錄選擇或更換病人' },
        'cm.notes.openXrays': { en: 'Open this patient\'s X-rays', 'zh-CN': '打开该患者的X光片', 'zh-Hant': '開啟該病人的X光片' },
        'cm.hub.xrays': { en: 'X-rays', 'zh-CN': 'X光', 'zh-Hant': 'X光' },
        'cm.hub.xraysNew': { en: '{N} to review', 'zh-CN': '{N} 张待审阅', 'zh-Hant': '{N} 張待審閱' },
        'cm.hub.photos': { en: 'Photos', 'zh-CN': '照片', 'zh-Hant': '相片' },
        'cm.hub.docs': { en: 'Documents', 'zh-CN': '文件', 'zh-Hant': '文件' },
        'cm.hub.consent': { en: 'Consents, Lab & Scans', 'zh-CN': '同意书、化验与扫描', 'zh-Hant': '同意書、化驗與掃描' },
        'cm.hub.add': { en: '＋ Add', 'zh-CN': '＋ 新增', 'zh-Hant': '＋ 新增' },
        'cm.hub.lastAdded': { en: 'Last added {DATE}', 'zh-CN': '最近新增 {DATE}', 'zh-Hant': '最近新增 {DATE}' },
        'cm.hub.empty': { en: 'Nothing stored yet', 'zh-CN': '尚无记录', 'zh-Hant': '尚無紀錄' },
        'cm.hub.consentDocs': { en: 'Consent documents', 'zh-CN': '同意书文件', 'zh-Hant': '同意書文件' },
        'cm.hub.ctxOff': { en: 'Visit / tooth / tag / status fields are off. Run media_context.sql in Supabase to enable them.', 'zh-CN': '就诊/牙位/标签/状态字段未启用。请在 Supabase 运行 media_context.sql。', 'zh-Hant': '就診/牙位/標籤/狀態欄位未啟用。請在 Supabase 執行 media_context.sql。' },
        'cm.add.photo': { en: 'Photos / files', 'zh-CN': '照片 / 文件', 'zh-Hant': '相片 / 檔案' },
        'cm.add.letter': { en: 'New letter', 'zh-CN': '新信件', 'zh-Hant': '新信件' },
        'cm.add.sickLeave': { en: 'Sick leave', 'zh-CN': '病假证明', 'zh-Hant': '病假證明' },
        'cm.add.referral': { en: 'Referral letter', 'zh-CN': '转介信', 'zh-Hant': '轉介信' },
        'cm.add.consent': { en: 'Consent form', 'zh-CN': '同意书', 'zh-Hant': '同意書' },
        'cm.add.receipt': { en: 'Receipt', 'zh-CN': '收据', 'zh-Hant': '收據' },
        'cm.add.attendance': { en: 'Attendance letter', 'zh-CN': '到诊证明', 'zh-Hant': '到診證明' },
        'cm.qc.noTemplate': { en: 'No matching template for "{KIND}". Add one in Configuration → Document Templates.', 'zh-CN': '找不到「{KIND}」模板。请在配置 → 文件模板中新增。', 'zh-Hant': '找不到「{KIND}」範本。請在設定 → 文件範本中新增。' },
        'cm.qc.timeout': { en: 'Templates are still loading — try again in a moment.', 'zh-CN': '模板仍在加载，请稍后再试。', 'zh-Hant': '範本仍在載入，請稍後再試。' },
        'cm.qc.needPatient': { en: 'Select a patient on Treatment Notes first.', 'zh-CN': '请先在治疗记录中选择患者。', 'zh-Hant': '請先在治療記錄中選擇病人。' },
        'cm.field.visit': { en: 'Linked visit', 'zh-CN': '关联就诊', 'zh-Hant': '關聯就診' },
        'cm.field.visitNone': { en: '— not linked —', 'zh-CN': '— 不关联 —', 'zh-Hant': '— 不關聯 —' },
        'cm.field.visitToday': { en: 'Today', 'zh-CN': '今天', 'zh-Hant': '今天' },
        'cm.field.visitOther': { en: 'Earlier visit', 'zh-CN': '较早就诊', 'zh-Hant': '較早就診' },
        'cm.field.tooth': { en: 'Tooth (FDI)', 'zh-CN': '牙位 (FDI)', 'zh-Hant': '牙位 (FDI)' },
        'cm.field.toothPh': { en: 'e.g. 16, 24', 'zh-CN': '例如 16, 24', 'zh-Hant': '例如 16, 24' },
        'cm.field.tags': { en: 'Tags', 'zh-CN': '标签', 'zh-Hant': '標籤' },
        'cm.field.tagsPh': { en: 'comma separated, e.g. pre-op, crown', 'zh-CN': '以逗号分隔，例如 术前, 牙冠', 'zh-Hant': '以逗號分隔，例如 術前, 牙冠' },
        'cm.field.status': { en: 'Status', 'zh-CN': '状态', 'zh-Hant': '狀態' },
        'cm.field.category': { en: 'Category', 'zh-CN': '分类', 'zh-Hant': '分類' },
        'cm.field.validUntil': { en: 'Valid until', 'zh-CN': '有效至', 'zh-Hant': '有效至' },
        'cm.status.draft': { en: 'Draft', 'zh-CN': '草稿', 'zh-Hant': '草稿' },
        'cm.status.issued': { en: 'Issued', 'zh-CN': '已发出', 'zh-Hant': '已發出' },
        'cm.status.signed': { en: 'Signed', 'zh-CN': '已签署', 'zh-Hant': '已簽署' },
        'cm.dcat.letter': { en: 'Letter', 'zh-CN': '信件', 'zh-Hant': '信件' },
        'cm.dcat.certificate': { en: 'Certificate', 'zh-CN': '证明', 'zh-Hant': '證明' },
        'cm.dcat.referral': { en: 'Referral', 'zh-CN': '转介', 'zh-Hant': '轉介' },
        'cm.dcat.consent': { en: 'Consent', 'zh-CN': '同意书', 'zh-Hant': '同意書' },
        'cm.dcat.receipt': { en: 'Receipt', 'zh-CN': '收据', 'zh-Hant': '收據' },
        'cm.dcat.prescription': { en: 'Prescription', 'zh-CN': '处方', 'zh-Hant': '處方' },
        'cm.dcat.report': { en: 'Report', 'zh-CN': '报告', 'zh-Hant': '報告' },
        'cm.dcat.other': { en: 'Other', 'zh-CN': '其他', 'zh-Hant': '其他' },
        'cm.badge.expired': { en: 'Expired', 'zh-CN': '已过期', 'zh-Hant': '已過期' },
        'cm.badge.validUntil': { en: 'Valid until {DATE}', 'zh-CN': '有效至 {DATE}', 'zh-Hant': '有效至 {DATE}' },
        'cm.photo.catConsentLab': { en: 'Consents & Lab', 'zh-CN': '同意书与化验', 'zh-Hant': '同意書與化驗' },
        'cm.photo.edited': { en: 'Edited copy', 'zh-CN': '编辑副本', 'zh-Hant': '編輯副本' },
        'cm.photo.viewOriginal': { en: 'View original', 'zh-CN': '查看原图', 'zh-Hant': '查看原圖' },
        'cm.photo.originalGone': { en: 'The original photo is no longer available.', 'zh-CN': '原图已不存在。', 'zh-Hant': '原圖已不存在。' },
        'cm.photo.replaceOrig': { en: 'Replace the original instead (cannot be undone)', 'zh-CN': '改为覆盖原图（无法还原）', 'zh-Hant': '改為覆蓋原圖（無法還原）' },
        'cm.photo.savedCopy': { en: 'Saved as a new edited copy — the original is kept.', 'zh-CN': '已另存为编辑副本，原图保留。', 'zh-Hant': '已另存為編輯副本，原圖保留。' },
        'cm.photo.editedSuffix': { en: '(edited)', 'zh-CN': '(edited)', 'zh-Hant': '(edited)' },
        'cm.photo.gone': { en: 'That photo is no longer in this patient\'s record.', 'zh-CN': '该照片已不在此患者记录中。', 'zh-Hant': '該相片已不在此病人紀錄中。' },
        'cm.cmp.btn': { en: '⇄ Compare', 'zh-CN': '⇄ 对比', 'zh-Hant': '⇄ 對比' },
        'cm.cmp.title': { en: 'Compare photos', 'zh-CN': '照片对比', 'zh-Hant': '相片對比' },
        'cm.cmp.pickOne': { en: 'Pick one more photo to compare (1/2).', 'zh-CN': '再选一张照片进行对比 (1/2)。', 'zh-Hant': '再選一張相片進行對比 (1/2)。' },
        'cm.cmp.pickTwo': { en: 'Pick two photos with the ⇄ button on each card.', 'zh-CN': '请用照片卡片上的 ⇄ 按钮选择两张照片。', 'zh-Hant': '請用相片卡片上的 ⇄ 按鈕選擇兩張相片。' },
        'cm.cmp.imageOnly': { en: 'Only still photos can be compared.', 'zh-CN': '仅支持静态照片对比。', 'zh-Hant': '僅支援靜態相片對比。' },
        'cm.cmp.swap': { en: 'Swap', 'zh-CN': '互换', 'zh-Hant': '互換' },
        'cm.cmp.reset': { en: 'Reset view', 'zh-CN': '重置视图', 'zh-Hant': '重設檢視' },
        'cm.cmp.hint': { en: 'Scroll to zoom, drag to pan — both photos move together.', 'zh-CN': '滚轮缩放、拖动平移，两张照片同步。', 'zh-Hant': '滾輪縮放、拖曳平移，兩張相片同步。' },
        'cm.cmp.toggleTitle': { en: 'Add to before/after compare', 'zh-CN': '加入前后对比', 'zh-Hant': '加入前後對比' },
        'cm.batch.title': { en: 'Upload {N} files', 'zh-CN': '上传 {N} 个文件', 'zh-Hant': '上傳 {N} 個檔案' },
        'cm.batch.shared': { en: 'Applies to all files', 'zh-CN': '套用于所有文件', 'zh-Hant': '套用於所有檔案' },
        'cm.batch.perFile': { en: 'Per file (optional)', 'zh-CN': '逐个文件（可选）', 'zh-Hant': '逐個檔案（可選）' },
        'cm.batch.sameCat': { en: 'Same as above', 'zh-CN': '同上', 'zh-Hant': '同上' },
        'cm.batch.captionPh': { en: 'Caption (optional)', 'zh-CN': '说明（可选）', 'zh-Hant': '說明（可選）' },
        'cm.batch.uploadBtn': { en: 'Upload {N}', 'zh-CN': '上传 {N} 个', 'zh-Hant': '上傳 {N} 個' },
        'cm.batch.progress': { en: 'Uploading {I} of {N}…', 'zh-CN': '正在上传 {I} / {N}…', 'zh-Hant': '正在上傳 {I} / {N}…' },
        'cm.batch.done': { en: 'Uploaded {N} files.', 'zh-CN': '已上传 {N} 个文件。', 'zh-Hant': '已上傳 {N} 個檔案。' },
        'cm.batch.partial': { en: 'Uploaded {OK} of {N}; {FAIL} failed.', 'zh-CN': '已上传 {OK} / {N}，{FAIL} 个失败。', 'zh-Hant': '已上傳 {OK} / {N}，{FAIL} 個失敗。' },
        'cm.batch.drop': { en: 'Drop files here to upload', 'zh-CN': '拖放文件到此处上传', 'zh-Hant': '拖放檔案到此處上傳' },
        'cm.batch.removeTitle': { en: 'Remove from this upload', 'zh-CN': '从本次上传中移除', 'zh-Hant': '從本次上傳中移除' },
        'cm.forms.filterSearchPh': { en: 'Search documents…', 'zh-CN': '搜索文件…', 'zh-Hant': '搜尋文件…' },
        'cm.forms.allTypes': { en: 'All types', 'zh-CN': '全部类型', 'zh-Hant': '全部類型' },
        'cm.forms.allStatus': { en: 'Any status', 'zh-CN': '任何状态', 'zh-Hant': '任何狀態' },
        'cm.forms.loadMore': { en: 'Load more', 'zh-CN': '加载更多', 'zh-Hant': '載入更多' },
        'cm.forms.showing': { en: '{N} shown', 'zh-CN': '显示 {N} 份', 'zh-Hant': '顯示 {N} 份' },
        'cm.forms.noMatch': { en: 'No documents match these filters.', 'zh-CN': '没有符合条件的文件。', 'zh-Hant': '沒有符合條件的文件。' },
        'cm.forms.draftFound': { en: 'Unsaved draft from {WHEN}: {NAME}', 'zh-CN': '发现未保存的草稿（{WHEN}）：{NAME}', 'zh-Hant': '發現未儲存的草稿（{WHEN}）：{NAME}' },
        'cm.forms.draftRestore': { en: 'Restore', 'zh-CN': '恢复', 'zh-Hant': '還原' },
        'cm.forms.draftDiscard': { en: 'Discard', 'zh-CN': '丢弃', 'zh-Hant': '捨棄' },
        'cm.forms.draftStashed': { en: 'Unsaved letter kept as a draft for the previous patient.', 'zh-CN': '上一位患者未保存的信件已存为草稿。', 'zh-Hant': '上一位病人未儲存的信件已存為草稿。' },
        'cm.forms.visitApplied': { en: 'Visit changed — reopen the template to refresh the visit placeholders.', 'zh-CN': '就诊已更改，请重新选择模板以刷新占位符。', 'zh-Hant': '就診已更改，請重新選擇範本以更新佔位符。' },
        'cm.ph.visitDate': { en: 'Visit date', 'zh-CN': '就诊日期', 'zh-Hant': '就診日期' },
        'cm.ph.treatmentDone': { en: 'Treatment done', 'zh-CN': '已做治疗', 'zh-Hant': '已做治療' },
        'cm.ph.nextAppt': { en: 'Next appointment', 'zh-CN': '下次预约', 'zh-Hant': '下次預約' },
        'cm.ph.amountPaid': { en: 'Amount paid', 'zh-CN': '已付金额', 'zh-Hant': '已付金額' },
        'cm.ph.balance': { en: 'Balance', 'zh-CN': '余额', 'zh-Hant': '餘額' },
        'cm.ph.billItems': { en: 'Bill items', 'zh-CN': '账单项目', 'zh-Hant': '帳單項目' }
    };
    if (typeof I18N_STRINGS !== 'undefined') {
        Object.keys(MORE).forEach(function (k) { I18N_STRINGS[k] = MORE[k]; });
    }
})();

var CON_MEDIA = {
    ctx: { photos: null, docs: null },
    _probe: null,
    summary: {},
    summaryTimer: null,
    apptCache: {},
    visitCtx: null,
    pendingOpen: null,
    docFilter: { q: '', type: '', status: '', limit: 30 },
    docFilterTimer: null,
    compare: [],
    cmpView: { s: 1, x: 0, y: 0 },
    batch: [],
    draftTimer: null,
    wired: false
};

var CON_MEDIA_PHOTO_CTX_KEYS = ['appointment_id', 'tooth_no', 'tags', 'parent_photo_id'];
var CON_MEDIA_DOC_CTX_KEYS = ['appointment_id', 'bill_id', 'status', 'category', 'valid_until'];
var CON_MEDIA_DOC_STATUSES = ['draft', 'issued', 'signed'];
var CON_MEDIA_DOC_CATEGORIES = ['letter', 'certificate', 'referral', 'consent', 'receipt', 'prescription', 'report', 'other'];
var CON_MEDIA_CONSENT_LAB_CATS = ['Consent Form', 'Lab Report', 'Scanned Document'];
var CON_MEDIA_DRAFT_PREFIX = 'conFormsDraft:v1:';
var CON_MEDIA_DRAFT_MAX_AGE_MS = 14 * 24 * 3600 * 1000;

/* ── helpers ─────────────────────────────────────────────── */

function conMediaTr(key) {
    return (typeof t === 'function') ? t(key) : key;
}

function conMediaTrRepl(key, pairs) {
    var s = conMediaTr(key);
    if (pairs) {
        Object.keys(pairs).forEach(function (k) {
            s = s.split('{' + k + '}').join(String(pairs[k]));
        });
    }
    return s;
}

function conMediaEsc(s) {
    if (typeof esc === 'function') return esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function conMediaEl(id) {
    return (typeof document !== 'undefined') ? document.getElementById(id) : null;
}

function conMediaPid() {
    return (typeof conPatientId !== 'undefined' && conPatientId) ? conPatientId : null;
}

function conMediaToday() {
    if (typeof todayISO === 'function') return todayISO();
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function conMediaLooksLikeError(msg) {
    return /error|fail|denied|cannot|couldn't|invalid|missing|失敗|失败|錯誤|错误|無法|无法/i.test(String(msg || ''));
}

function conMediaNotify(msg, kind) {
    var text = String(msg == null ? '' : msg).trim();
    if (!text) return;
    var k = kind || (conMediaLooksLikeError(text) ? 'error' : 'info');
    if (typeof showAppGlobalToast === 'function') {
        showAppGlobalToast(text, { kind: k });
    } else if (typeof console !== 'undefined') {
        console.log('[media] ' + text);
    }
}

function conMediaDateLabel(iso) {
    if (!iso) return '';
    if (typeof fmtDateLong === 'function') {
        try { return fmtDateLong(iso); } catch (e) { /* fall through */ }
    }
    return String(iso).slice(0, 10);
}

function conMediaMoney(v) {
    var n = parseFloat(v);
    if (!isFinite(n)) return '';
    if (typeof fmtHK === 'function') return fmtHK(n);
    return '$' + n.toFixed(2);
}

/* ── optional context columns (media_context.sql) ─────────── */

function conMediaIsMissingColErr(err) {
    if (!err) return false;
    var code = String(err.code || '');
    if (code === '42703' || code === 'PGRST204') return true;
    var m = String(err.message || err.details || err.hint || '');
    return /column .* does not exist|could not find the .* column|schema cache/i.test(m);
}

function conMediaStripCtx(payload, keys) {
    var out = {};
    Object.keys(payload || {}).forEach(function (k) {
        if (keys.indexOf(k) < 0) out[k] = payload[k];
    });
    return out;
}

function conMediaHasCtx(payload, keys) {
    return Object.keys(payload || {}).some(function (k) { return keys.indexOf(k) >= 0; });
}

/** Run a write; if the optional columns are missing, remember that and retry without them. */
function conMediaWrite(kind, makeOp, payload) {
    var keys = kind === 'docs' ? CON_MEDIA_DOC_CTX_KEYS : CON_MEDIA_PHOTO_CTX_KEYS;
    var knownOff = CON_MEDIA.ctx[kind] === false;
    var body = knownOff ? conMediaStripCtx(payload, keys) : payload;
    var sentCtx = !knownOff && conMediaHasCtx(payload, keys);
    return Promise.resolve(makeOp(body)).then(function (r) {
        if (r && r.error && sentCtx && conMediaIsMissingColErr(r.error)) {
            CON_MEDIA.ctx[kind] = false;
            conMediaApplyCtxVisibility();
            return makeOp(conMediaStripCtx(payload, keys));
        }
        if (r && !r.error && sentCtx && CON_MEDIA.ctx[kind] == null) {
            CON_MEDIA.ctx[kind] = true;
            conMediaApplyCtxVisibility();
        }
        return r;
    });
}

function conMediaProbeCtx() {
    if (CON_MEDIA._probe) return CON_MEDIA._probe;
    if (typeof SB === 'undefined' || !SB || !SB.from) return Promise.resolve(CON_MEDIA.ctx);
    function probe(table, cols, key) {
        return Promise.resolve(SB.from(table).select(cols).limit(1)).then(function (r) {
            if (r && !r.error) CON_MEDIA.ctx[key] = true;
            else if (r && conMediaIsMissingColErr(r.error)) CON_MEDIA.ctx[key] = false;
        }, function () { /* network: stay unknown */ });
    }
    CON_MEDIA._probe = Promise.all([
        probe('photos', CON_MEDIA_PHOTO_CTX_KEYS.join(','), 'photos'),
        probe('patient_documents', CON_MEDIA_DOC_CTX_KEYS.join(','), 'docs')
    ]).then(function () {
        if (CON_MEDIA.ctx.photos == null && CON_MEDIA.ctx.docs == null) CON_MEDIA._probe = null;
        conMediaApplyCtxVisibility();
        return CON_MEDIA.ctx;
    });
    return CON_MEDIA._probe;
}

function conMediaCtxOk(kind) {
    return CON_MEDIA.ctx[kind] === true;
}

function conMediaApplyCtxVisibility() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.con-media-ctx').forEach(function (el) {
        var kind = el.getAttribute('data-ctx-kind');
        el.hidden = CON_MEDIA.ctx[kind] !== true;
    });
    if (typeof conMediaRenderHub === 'function') conMediaRenderHub();
}

/** Add optional photo columns to a select list only when the DB has them. */
function conMediaPhotoCols(base) {
    return conMediaCtxOk('photos') ? base + ',' + CON_MEDIA_PHOTO_CTX_KEYS.join(',') : base;
}

function conMediaDocCols(base) {
    return conMediaCtxOk('docs') ? base + ',' + CON_MEDIA_DOC_CTX_KEYS.join(',') : base;
}

/* ── tooth / tag parsing ─────────────────────────────────── */

function conMediaParseTooth(raw) {
    var seen = {};
    var out = [];
    String(raw || '').split(/[\s,;，、]+/).forEach(function (tok) {
        var v = tok.trim().toUpperCase();
        if (!v) return;
        if (!/^([1-8][1-8]|UR|UL|LR|LL|ALL)$/.test(v)) return;
        if (seen[v]) return;
        seen[v] = 1;
        out.push(v);
    });
    return out.join(', ');
}

function conMediaParseTags(raw) {
    var seen = {};
    var out = [];
    String(raw || '').split(/[,;，、\n]+/).forEach(function (tok) {
        var v = tok.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 32);
        if (!v || seen[v]) return;
        seen[v] = 1;
        if (out.length < 12) out.push(v);
    });
    return out;
}

function conMediaTagsText(tags) {
    return Array.isArray(tags) ? tags.join(', ') : '';
}

function conMediaIsConsentLabCat(cat) {
    return CON_MEDIA_CONSENT_LAB_CATS.indexOf(String(cat || '')) >= 0;
}

function conMediaIsEditedRec(x) {
    if (!x) return false;
    return !!x.parent_photo_id || /\(edited\)\s*$/i.test(String(x.caption || ''));
}

function conMediaIsStillImageRec(x) {
    var p = String((x && x.file_path) || '').toLowerCase();
    return !!p && !/\.(pdf|mp4|webm|mov|avi|mkv|ogv)$/.test(p);
}

/* ── visits (appointments) ───────────────────────────────── */

function conMediaLoadAppts(pid, force) {
    if (!pid || typeof SB === 'undefined' || !SB || !SB.from) return Promise.resolve([]);
    var c = CON_MEDIA.apptCache[pid];
    if (!force && c && Date.now() - c.at < 60000) return Promise.resolve(c.rows);
    CON_MEDIA.apptInflight = CON_MEDIA.apptInflight || {};
    if (!force && CON_MEDIA.apptInflight[pid]) return CON_MEDIA.apptInflight[pid];
    var p = Promise.resolve(
        SB.from('appointments')
            .select('id,date,start_time,dentist_name,doctor_code,treatment_items,bill_status')
            .eq('patient_id', pid)
            .order('date', { ascending: false })
            .limit(40)
    ).then(function (r) {
        var rows = (r && !r.error && Array.isArray(r.data)) ? r.data : [];
        CON_MEDIA.apptCache[pid] = { at: Date.now(), rows: rows };
        return rows;
    }, function () { return []; });
    CON_MEDIA.apptInflight[pid] = p;
    var clear = function () { if (CON_MEDIA.apptInflight[pid] === p) delete CON_MEDIA.apptInflight[pid]; };
    p.then(clear, clear);
    return p;
}

function conMediaApptLabel(a) {
    if (!a) return '';
    var bits = [String(a.date || '')];
    if (a.start_time) bits[0] += ' ' + String(a.start_time).slice(0, 5);
    var who = a.dentist_name || a.doctor_code || '';
    if (who) bits.push(who);
    if (typeof a.treatment_items === 'string' && a.treatment_items.trim()) {
        var ti = a.treatment_items.trim();
        bits.push(ti.length > 26 ? ti.slice(0, 25) + '…' : ti);
    }
    return bits.join(' · ');
}

function conMediaApptDateFor(pid, id) {
    var c = CON_MEDIA.apptCache[pid];
    if (!c || !id) return '';
    for (var i = 0; i < c.rows.length; i++) {
        if (String(c.rows[i].id) === String(id)) return c.rows[i].date || '';
    }
    return '';
}

function conMediaFillApptSelect(selId, pid, selected, preferToday) {
    var sel = conMediaEl(selId);
    if (!sel) return Promise.resolve();
    var stamp = String(Date.now()) + ':' + Math.random();
    sel.dataset.cmStamp = stamp;
    return conMediaLoadAppts(pid).then(function (rows) {
        if (sel.dataset.cmStamp !== stamp) return;
        var today = conMediaToday();
        var todayId = '';
        var html = '<option value="">' + conMediaEsc(conMediaTr('cm.field.visitNone')) + '</option>';
        var present = false;
        rows.forEach(function (a) {
            var isToday = a.date === today;
            if (isToday && !todayId) todayId = a.id;
            if (selected && String(a.id) === String(selected)) present = true;
            html += '<option value="' + conMediaEsc(a.id) + '">' +
                (isToday ? conMediaEsc(conMediaTr('cm.field.visitToday')) + ' · ' : '') +
                conMediaEsc(conMediaApptLabel(a)) + '</option>';
        });
        if (selected && !present) {
            html += '<option value="' + conMediaEsc(selected) + '">' + conMediaEsc(conMediaTr('cm.field.visitOther')) + '</option>';
        }
        sel.innerHTML = html;
        sel.value = selected || (preferToday ? todayId : '') || '';
    });
}

/* ── summary strip + hub ─────────────────────────────────── */

function conMediaBuildSummary(photos, docs, xrays) {
    photos = photos || [];
    docs = docs || [];
    xrays = xrays || [];
    var consentLabPhotos = photos.filter(function (p) { return conMediaIsConsentLabCat(p.category); });
    var consentDocs = docs.filter(function (d) { return String(d.template_type || '').toLowerCase() === 'consent'; });
    var last = '';
    photos.concat(docs, xrays).forEach(function (r) {
        var ts = String((r && r.created_at) || '');
        if (ts > last) last = ts;
    });
    var trackReview = xrays.some(function (x) { return x && Object.prototype.hasOwnProperty.call(x, 'review_status'); });
    return {
        photos: photos.length - consentLabPhotos.length,
        docs: docs.length - consentDocs.length,
        xrays: xrays.length,
        xraysNew: trackReview ? xrays.filter(function (x) { return x.review_status !== 'reviewed'; }).length : 0,
        consentLab: consentLabPhotos.length + consentDocs.length,
        lastAt: last,
        consentDocs: consentDocs.slice(0, 6).map(function (d) {
            return { id: d.id, name: d.document_name || '—', date: d.document_date || String(d.created_at || '').slice(0, 10) };
        }),
        loadedAt: Date.now()
    };
}

function conMediaLoadSummary(pid) {
    if (!pid || typeof SB === 'undefined' || !SB || !SB.from) return Promise.resolve(null);
    return Promise.all([
        Promise.resolve(SB.from('photos').select('id,category,taken_date,created_at').eq('patient_id', pid)),
        Promise.resolve(SB.from('patient_documents')
            .select('id,template_type,document_name,document_date,created_at')
            .eq('patient_id', pid)
            .order('created_at', { ascending: false })),
        Promise.resolve(SB.from('xrays').select('*').eq('patient_id', pid))
    ]).then(function (res) {
        var photos = (res[0] && !res[0].error && res[0].data) || [];
        var docs = (res[1] && !res[1].error && res[1].data) || [];
        var xrays = (res[2] && !res[2].error && res[2].data) || [];
        var sum = conMediaBuildSummary(photos, docs, xrays);
        CON_MEDIA.summary[pid] = sum;
        if (String(conMediaPid()) === String(pid)) {
            conMediaRenderHub();
            if (typeof cnRenderContext === 'function' && typeof conPatientId !== 'undefined' &&
                String(conPatientId) === String(pid) && document.getElementById('conNoteContext')) {
                cnRenderContext();
            }
        }
        return sum;
    }, function () { return null; });
}

function conMediaScheduleSummary(force) {
    var pid = conMediaPid();
    if (!pid) return;
    var cached = CON_MEDIA.summary[pid];
    if (!force && cached && Date.now() - cached.loadedAt < 20000) return;
    clearTimeout(CON_MEDIA.summaryTimer);
    CON_MEDIA.summaryTimer = setTimeout(function () { conMediaLoadSummary(pid); }, 200);
}

function conMediaSummaryFor(pid) {
    return CON_MEDIA.summary[pid] || null;
}

function conMediaCurrentView() {
    if (typeof document === 'undefined') return 'photos';
    if (document.querySelector('.con-tab[data-tab="forms"].active')) return 'docs';
    var sel = conMediaEl('photoFilterCat');
    if (sel && sel.value === '__consent_lab') return 'consent';
    return 'photos';
}

function conMediaHubHtml(view, sum) {
    function seg(v, icon, key, n) {
        return '<button type="button" class="con-media-seg' + (view === v ? ' is-active' : '') +
            '" data-cm-view="' + v + '">' + icon + ' ' + conMediaEsc(conMediaTr(key)) +
            ' <span class="con-media-count">' + (sum ? n : '·') + '</span></button>';
    }
    var last = sum
        ? (sum.lastAt ? conMediaTrRepl('cm.hub.lastAdded', { DATE: sum.lastAt.slice(0, 10) }) : conMediaTr('cm.hub.empty'))
        : '';
    var items = [
        ['upload', '📷', 'cm.add.photo'],
        ['phone', '📱', 'cm.add.phone'],
        ['qc:letter', '✉️', 'cm.add.letter'],
        ['qc:sick_leave', '🩺', 'cm.add.sickLeave'],
        ['qc:referral', '🔁', 'cm.add.referral'],
        ['qc:consent', '📝', 'cm.add.consent'],
        ['qc:receipt', '🧾', 'cm.add.receipt'],
        ['qc:attendance', '📅', 'cm.add.attendance']
    ];
    var menu = items.map(function (it) {
        return '<button type="button" class="con-media-menu-item" data-cm-act="' + it[0] + '">' +
            it[1] + ' ' + conMediaEsc(conMediaTr(it[2])) + '</button>';
    }).join('');
    var html = '<div class="con-media-nav">' +
        seg('photos', '📷', 'cm.hub.photos', sum ? sum.photos : 0) +
        seg('docs', '📄', 'cm.hub.docs', sum ? sum.docs : 0) +
        seg('consent', '📝', 'cm.hub.consent', sum ? sum.consentLab : 0) +
        '<button type="button" class="con-media-seg" data-cm-view="xrays">🩻 ' + conMediaEsc(conMediaTr('cm.hub.xrays')) +
        ' <span class="con-media-count">' + (sum ? (sum.xrays || 0) : '·') + '</span>' +
        (sum && sum.xraysNew ? '<span class="con-media-new" title="' + conMediaEsc(conMediaTrRepl('cm.hub.xraysNew', { N: sum.xraysNew })) + '">' + sum.xraysNew + '</span>' : '') +
        '</button>' +
        '<span class="con-media-last">' + conMediaEsc(last) + '</span>' +
        '<div class="con-media-add"><button type="button" class="btn-add con-media-add-btn" data-cm-act="menu">' +
        conMediaEsc(conMediaTr('cm.hub.add')) + ' ▾</button>' +
        '<div class="con-media-menu" hidden>' + menu + '</div></div></div>';
    if (view === 'consent' && sum && sum.consentDocs.length) {
        html += '<div class="con-media-consent-docs"><span class="con-media-consent-lbl">' +
            conMediaEsc(conMediaTr('cm.hub.consentDocs')) + '</span>' +
            sum.consentDocs.map(function (d) {
                return '<button type="button" class="con-media-chip" data-cm-doc="' + conMediaEsc(d.id) + '">📝 ' +
                    conMediaEsc(d.name) + (d.date ? ' · ' + conMediaEsc(d.date) : '') + '</button>';
            }).join('') + '</div>';
    }
    var isAdmin = (typeof currentRole !== 'undefined' && currentRole === 'admin');
    if (isAdmin && (CON_MEDIA.ctx.photos === false || CON_MEDIA.ctx.docs === false)) {
        html += '<div class="con-media-hint">' + conMediaEsc(conMediaTr('cm.hub.ctxOff')) + '</div>';
    }
    return html;
}

function conMediaWireHub(host) {
    if (host.dataset.cmWired === '1') return;
    host.dataset.cmWired = '1';
    host.addEventListener('click', function (e) {
        var seg = e.target.closest ? e.target.closest('[data-cm-view]') : null;
        if (seg) { conMediaSetView(seg.getAttribute('data-cm-view')); return; }
        var docBtn = e.target.closest ? e.target.closest('[data-cm-doc]') : null;
        if (docBtn) { conMediaOpenDoc(conMediaPid(), docBtn.getAttribute('data-cm-doc')); return; }
        var actBtn = e.target.closest ? e.target.closest('[data-cm-act]') : null;
        if (!actBtn) return;
        var act = actBtn.getAttribute('data-cm-act');
        var menu = host.querySelector('.con-media-menu');
        if (act === 'menu') {
            if (menu) menu.hidden = !menu.hidden;
            return;
        }
        if (menu) menu.hidden = true;
        if (act === 'upload') conMediaPickFiles();
        else if (act === 'phone') { if (typeof conScanOpen === 'function') conScanOpen(); }
        else if (act.indexOf('qc:') === 0) conMediaQuickCreate(act.slice(3));
    });
}

function conMediaRenderHub() {
    if (typeof document === 'undefined') return;
    var pid = conMediaPid();
    ['conMediaHubPhotos', 'conMediaHubForms'].forEach(function (id) {
        var host = conMediaEl(id);
        if (!host) return;
        if (!pid) {
            host.hidden = true;
            host.innerHTML = '';
            return;
        }
        var openMenu = host.querySelector('.con-media-menu:not([hidden])');
        if (openMenu) return;
        host.hidden = false;
        host.innerHTML = conMediaHubHtml(conMediaCurrentView(), CON_MEDIA.summary[pid] || null);
        conMediaWireHub(host);
    });
}

function conMediaSetView(v) {
    if (v === 'xrays') {
        if (typeof switchConTab === 'function') switchConTab('xrays');
        return;
    }
    if (v === 'docs') {
        if (typeof switchConTab === 'function') switchConTab('forms');
        return;
    }
    if (typeof switchConTab === 'function') switchConTab('photos');
    var sel = conMediaEl('photoFilterCat');
    if (sel) {
        sel.value = v === 'consent' ? '__consent_lab' : '';
        if (typeof filterPhotos === 'function') filterPhotos();
    }
    conMediaRenderHub();
}

function conMediaPickFiles() {
    if (typeof switchConTab === 'function' && !document.querySelector('.con-tab[data-tab="photos"].active')) {
        switchConTab('photos');
    }
    var fi = conMediaEl('photoFileInput');
    if (fi) fi.click();
}

function conMediaApplySharedPatient() {
    if (typeof document === 'undefined') return;
    var has = !!conMediaPid();
    [
        ['conPhotoNeedPatient', 'conPhotoSamePatient', 'conPhotoPickPatientBtn'],
        ['conFormsNeedPatient', 'conFormsSamePatient', 'conFormsPickPatientBtn']
    ].forEach(function (ids) {
        var need = conMediaEl(ids[0]);
        var same = conMediaEl(ids[1]);
        var btn = conMediaEl(ids[2]);
        if (need) need.hidden = has;
        if (same) same.hidden = !has;
        if (btn) btn.hidden = has;
    });
    if (!has) {
        var banner = conMediaEl('conPhotoBanner');
        if (banner) banner.style.display = 'none';
        var main = conMediaEl('photoMainContent');
        if (main) main.style.display = 'none';
    }
    conMediaRenderHub();
    if (has) conMediaScheduleSummary();
}

function conMediaOnTabShown(tab) {
    if (tab !== 'photos' && tab !== 'forms') return;
    conMediaApplySharedPatient();
    conMediaProbeCtx().then(function () {
        if (tab === 'forms') conMediaFormsCtxRefresh();
    });
}

/* ── deep links ──────────────────────────────────────────── */

function conMediaOpenPhoto(pid, photoId) {
    CON_MEDIA.pendingOpen = { kind: 'photo', id: photoId, pid: pid };
    function go() {
        if (typeof switchConTab === 'function') switchConTab('photos');
        if (typeof refreshPhotos === 'function') refreshPhotos();
    }
    if (pid && String(conMediaPid()) !== String(pid) && typeof openConForPatient === 'function') {
        openConForPatient(pid);
        setTimeout(go, 220);
    } else {
        go();
    }
}

function conMediaConsumePendingOpen() {
    var p = CON_MEDIA.pendingOpen;
    if (!p || p.kind !== 'photo') return;
    if (typeof photoPatientId === 'undefined' || String(photoPatientId) !== String(p.pid || photoPatientId)) return;
    function find() {
        return photoFiltered.findIndex(function (x) { return String(x.id) === String(p.id); });
    }
    var idx = find();
    if (idx < 0) {
        var inAll = photoAllRecords.some(function (x) { return String(x.id) === String(p.id); });
        if (inAll) {
            ['photoFilterCat', 'photoFilterYear', 'photoFilterSearch'].forEach(function (id) {
                var el = conMediaEl(id);
                if (el) el.value = '';
            });
            if (typeof filterPhotos === 'function') filterPhotos();
            idx = find();
        }
    }
    CON_MEDIA.pendingOpen = null;
    if (idx >= 0 && typeof openPhotoLightbox === 'function') openPhotoLightbox(idx);
    else conMediaNotify(conMediaTr('cm.photo.gone'));
}

function conMediaOpenDoc(pid, docId) {
    function go() {
        if (typeof switchConTab === 'function') switchConTab('forms');
        if (docId && typeof openConFormsDoc === 'function') setTimeout(function () { openConFormsDoc(docId); }, 150);
    }
    if (pid && String(conMediaPid()) !== String(pid) && typeof openConForPatient === 'function') {
        openConForPatient(pid);
        setTimeout(go, 220);
    } else {
        go();
    }
}

/* ── photo context fields (upload modal + lightbox) ───────── */

function conMediaPhotoCtxRead(prefix) {
    if (!conMediaCtxOk('photos')) return {};
    var tooth = conMediaEl(prefix + 'Tooth');
    var tags = conMediaEl(prefix + 'Tags');
    var appt = conMediaEl(prefix + 'Appt');
    return {
        tooth_no: tooth ? (conMediaParseTooth(tooth.value) || null) : null,
        tags: tags ? conMediaParseTags(tags.value) : [],
        appointment_id: appt && appt.value ? appt.value : null
    };
}

function conMediaPhotoCtxFill(prefix, rec, preferToday) {
    var tooth = conMediaEl(prefix + 'Tooth');
    var tags = conMediaEl(prefix + 'Tags');
    if (tooth) tooth.value = rec && rec.tooth_no ? rec.tooth_no : '';
    if (tags) tags.value = rec ? conMediaTagsText(rec.tags) : '';
    var pid = conMediaPid() || (typeof photoPatientId !== 'undefined' ? photoPatientId : null);
    conMediaFillApptSelect(prefix + 'Appt', pid, rec && rec.appointment_id ? rec.appointment_id : '', !!preferToday);
}

function conMediaPhotoBadgesHtml(x) {
    var bits = [];
    if (x.tooth_no) bits.push('<span class="con-media-badge con-media-badge--tooth">🦷 ' + conMediaEsc(x.tooth_no) + '</span>');
    if (x.appointment_id) {
        var d = conMediaApptDateFor(x.patient_id || conMediaPid(), x.appointment_id);
        bits.push('<span class="con-media-badge con-media-badge--visit">📅 ' + conMediaEsc(d || '') + '</span>');
    }
    if (conMediaIsEditedRec(x)) {
        bits.push('<span class="con-media-badge con-media-badge--edit">✎ ' + conMediaEsc(conMediaTr('cm.photo.edited')) + '</span>');
    }
    (Array.isArray(x.tags) ? x.tags : []).slice(0, 3).forEach(function (tg) {
        bits.push('<span class="con-media-badge con-media-badge--tag">#' + conMediaEsc(tg) + '</span>');
    });
    return bits.length ? '<div class="con-media-badges">' + bits.join('') + '</div>' : '';
}

function conMediaPhotoMatchesQuery(x, q) {
    q = String(q || '').toLowerCase();
    if (!q) return true;
    return String(x.caption || '').toLowerCase().indexOf(q) >= 0 ||
        String(x.notes || '').toLowerCase().indexOf(q) >= 0 ||
        String(x.tooth_no || '').toLowerCase().indexOf(q) >= 0 ||
        conMediaTagsText(x.tags).toLowerCase().indexOf(q) >= 0;
}

function conMediaPhotoLbOpenOriginal() {
    if (typeof photoLbCurrentId === 'undefined' || !photoLbCurrentId) return;
    var rec = photoAllRecords.find(function (x) { return x.id === photoLbCurrentId; });
    if (!rec || !rec.parent_photo_id) return;
    var idx = photoFiltered.findIndex(function (x) { return x.id === rec.parent_photo_id; });
    if (idx < 0) {
        conMediaNotify(conMediaTr('cm.photo.originalGone'));
        return;
    }
    if (typeof _forceClosePhotoLightbox === 'function') _forceClosePhotoLightbox();
    openPhotoLightbox(idx);
}

function conMediaPhotoLbSyncExtras(rec) {
    var row = conMediaEl('photoLbOriginalRow');
    if (row) row.hidden = !(rec && rec.parent_photo_id);
    var rep = conMediaEl('photoLbReplaceOrig');
    if (rep) rep.checked = false;
}

/* ── compare (before / after) ────────────────────────────── */

function conMediaCmpClampScale(s) {
    return Math.max(0.5, Math.min(8, s));
}

function conMediaCompareToggle(id) {
    var i = CON_MEDIA.compare.indexOf(id);
    if (i >= 0) {
        CON_MEDIA.compare.splice(i, 1);
    } else {
        var rec = photoAllRecords.find(function (x) { return x.id === id; });
        if (!rec || !conMediaIsStillImageRec(rec)) {
            conMediaNotify(conMediaTr('cm.cmp.imageOnly'));
            return;
        }
        if (CON_MEDIA.compare.length >= 2) CON_MEDIA.compare.shift();
        CON_MEDIA.compare.push(id);
    }
    conMediaCompareSync();
    if (CON_MEDIA.compare.length === 2) conMediaCompareOpen();
    else if (CON_MEDIA.compare.length === 1) conMediaNotify(conMediaTr('cm.cmp.pickOne'), 'info');
}

function conMediaCompareButton() {
    if (CON_MEDIA.compare.length === 2) conMediaCompareOpen();
    else conMediaNotify(conMediaTr('cm.cmp.pickTwo'), 'info');
}

function conMediaCompareSync() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('#photoGridView .xray-card').forEach(function (card) {
        card.classList.toggle('is-cmp', CON_MEDIA.compare.indexOf(card.dataset.id) >= 0);
    });
    var btn = conMediaEl('photoCompareBtn');
    if (btn) btn.textContent = conMediaTr('cm.cmp.btn') + ' (' + CON_MEDIA.compare.length + '/2)';
}

function conMediaCompareApply() {
    var v = CON_MEDIA.cmpView;
    ['A', 'B'].forEach(function (k) {
        var img = conMediaEl('photoCmpImg' + k);
        if (img) img.style.transform = 'translate(' + v.x + 'px,' + v.y + 'px) scale(' + v.s + ')';
    });
}

function conMediaEnsureCompareModal() {
    var m = conMediaEl('photoCompareModal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'photoCompareModal';
    m.className = 'modal';
    m.style.zIndex = '10020';
    m.innerHTML =
        '<div class="cm-cmp-box">' +
        '<button type="button" class="mclose" data-cm-cmp="close" aria-label="Close">×</button>' +
        '<div class="cm-cmp-head"><strong id="photoCmpTitle"></strong>' +
        '<span class="cm-cmp-hint" id="photoCmpHint"></span>' +
        '<span class="cm-cmp-tools">' +
        '<button type="button" class="xray-btn" data-cm-cmp="swap" id="photoCmpSwap"></button>' +
        '<button type="button" class="xray-btn" data-cm-cmp="reset" id="photoCmpReset"></button>' +
        '</span></div>' +
        '<div class="cm-cmp-panes">' +
        '<div class="cm-cmp-pane"><div class="cm-cmp-cap" id="photoCmpCapA"></div>' +
        '<div class="cm-cmp-view" data-cm-pane="A"><img id="photoCmpImgA" alt="" draggable="false"></div></div>' +
        '<div class="cm-cmp-pane"><div class="cm-cmp-cap" id="photoCmpCapB"></div>' +
        '<div class="cm-cmp-view" data-cm-pane="B"><img id="photoCmpImgB" alt="" draggable="false"></div></div>' +
        '</div></div>';
    document.body.appendChild(m);
    var drag = null;
    m.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('[data-cm-cmp]') : null;
        if (!b) { if (e.target === m) m.style.display = 'none'; return; }
        var act = b.getAttribute('data-cm-cmp');
        if (act === 'close') m.style.display = 'none';
        else if (act === 'swap') { CON_MEDIA.compare.reverse(); conMediaCompareOpen(true); }
        else if (act === 'reset') { CON_MEDIA.cmpView = { s: 1, x: 0, y: 0 }; conMediaCompareApply(); }
    });
    m.addEventListener('wheel', function (e) {
        if (!e.target.closest || !e.target.closest('.cm-cmp-view')) return;
        e.preventDefault();
        var v = CON_MEDIA.cmpView;
        v.s = conMediaCmpClampScale(v.s * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
        conMediaCompareApply();
    }, { passive: false });
    m.addEventListener('mousedown', function (e) {
        if (!e.target.closest || !e.target.closest('.cm-cmp-view')) return;
        drag = { x: e.clientX, y: e.clientY };
        e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) {
        if (!drag) return;
        CON_MEDIA.cmpView.x += e.clientX - drag.x;
        CON_MEDIA.cmpView.y += e.clientY - drag.y;
        drag = { x: e.clientX, y: e.clientY };
        conMediaCompareApply();
    });
    document.addEventListener('mouseup', function () { drag = null; });
    return m;
}

function conMediaCompareOpen(keepView) {
    if (CON_MEDIA.compare.length !== 2) return;
    var recs = CON_MEDIA.compare.map(function (id) {
        return photoAllRecords.find(function (x) { return x.id === id; });
    });
    if (!recs[0] || !recs[1]) { CON_MEDIA.compare = []; conMediaCompareSync(); return; }
    var m = conMediaEnsureCompareModal();
    if (!keepView) CON_MEDIA.cmpView = { s: 1, x: 0, y: 0 };
    conMediaEl('photoCmpTitle').textContent = conMediaTr('cm.cmp.title');
    conMediaEl('photoCmpHint').textContent = conMediaTr('cm.cmp.hint');
    conMediaEl('photoCmpSwap').textContent = conMediaTr('cm.cmp.swap');
    conMediaEl('photoCmpReset').textContent = conMediaTr('cm.cmp.reset');
    ['A', 'B'].forEach(function (k, i) {
        var x = recs[i];
        var cap = [
            typeof photoCategoryLabel === 'function' ? photoCategoryLabel(x.category) : (x.category || ''),
            x.taken_date ? conMediaDateLabel(x.taken_date) : '',
            x.tooth_no ? '🦷 ' + x.tooth_no : ''
        ].filter(Boolean).join(' · ');
        conMediaEl('photoCmpCap' + k).textContent = cap;
        var img = conMediaEl('photoCmpImg' + k);
        img.src = typeof photoDisplayUrl === 'function' ? photoDisplayUrl(x) : (x.public_url || '');
    });
    conMediaCompareApply();
    m.style.display = 'block';
}

/* ── upload: bulk dialog, drop, paste ────────────────────── */

function photoHandleFiles(files) {
    files = Array.prototype.slice.call(files || []).filter(function (f) { return f && f.size >= 0; });
    if (!files.length) return;
    if (typeof photoPatientId === 'undefined' || !photoPatientId) {
        var cur = typeof photoResolveCurrentPatient === 'function' ? photoResolveCurrentPatient() : null;
        if (cur && cur.id && typeof selectPhotoPatient === 'function') selectPhotoPatient(cur);
    }
    if (!photoPatientId) {
        conMediaNotify(conMediaTr('cm.qc.needPatient'));
        return;
    }
    if (files.length === 1) {
        photoUploadQueue = files;
        photoUploadQIdx = 0;
        processNextPhotoUpload();
        return;
    }
    conMediaBatchOpen(files);
}

function conMediaBatchCatOptions(withSame) {
    var pairs = (typeof PHOTO_CATEGORY_PAIRS !== 'undefined') ? PHOTO_CATEGORY_PAIRS : [['Other', 'media.categoryOther']];
    var html = withSame ? '<option value="">' + conMediaEsc(conMediaTr('cm.batch.sameCat')) + '</option>' : '';
    pairs.forEach(function (p) {
        html += '<option value="' + conMediaEsc(p[0]) + '">' + conMediaEsc(conMediaTr(p[1])) + '</option>';
    });
    return html;
}

function conMediaBatchField(label, inner) {
    return '<div class="fg"><label>' + conMediaEsc(label) + '</label>' + inner + '</div>';
}

function conMediaBatchRenderList() {
    var host = conMediaEl('photoBatchList');
    if (!host) return;
    host.innerHTML = CON_MEDIA.batch.map(function (it, i) {
        var thumb = it.url
            ? '<img src="' + conMediaEsc(it.url) + '" alt="">'
            : '<span class="cm-batch-file-ico">📄</span>';
        return '<div class="cm-batch-row" data-i="' + i + '">' +
            '<div class="cm-batch-thumb">' + thumb + '</div>' +
            '<div class="cm-batch-name" title="' + conMediaEsc(it.file.name) + '">' + conMediaEsc(it.file.name) + '</div>' +
            '<select class="cm-batch-cat" data-i="' + i + '">' + conMediaBatchCatOptions(true) + '</select>' +
            '<input type="text" class="cm-batch-cap" data-i="' + i + '" placeholder="' +
            conMediaEsc(conMediaTr('cm.batch.captionPh')) + '" value="' + conMediaEsc(it.caption || '') + '">' +
            '<button type="button" class="cm-batch-x" data-i="' + i + '" title="' +
            conMediaEsc(conMediaTr('cm.batch.removeTitle')) + '">×</button></div>';
    }).join('');
    host.querySelectorAll('.cm-batch-cat').forEach(function (s) {
        s.value = CON_MEDIA.batch[Number(s.dataset.i)].cat || '';
    });
    var btn = conMediaEl('photoBatchGo');
    if (btn) {
        btn.textContent = conMediaTrRepl('cm.batch.uploadBtn', { N: CON_MEDIA.batch.length });
        btn.disabled = !CON_MEDIA.batch.length;
    }
    var title = conMediaEl('photoBatchTitle');
    if (title) title.textContent = conMediaTrRepl('cm.batch.title', { N: CON_MEDIA.batch.length });
}

function conMediaBatchClose() {
    CON_MEDIA.batch.forEach(function (it) { if (it.url) { try { URL.revokeObjectURL(it.url); } catch (e) { /* ignore */ } } });
    CON_MEDIA.batch = [];
    var m = conMediaEl('photoBatchModal');
    if (m) m.style.display = 'none';
}

function conMediaBatchOpen(files) {
    CON_MEDIA.batch = files.map(function (f) {
        return { file: f, cat: '', caption: '', url: /^image\//.test(f.type || '') ? URL.createObjectURL(f) : '' };
    });
    var m = conMediaEl('photoBatchModal');
    if (!m) {
        m = document.createElement('div');
        m.id = 'photoBatchModal';
        m.className = 'modal';
        m.style.zIndex = '10010';
        document.body.appendChild(m);
        m.addEventListener('click', function (e) {
            var rm = e.target.closest ? e.target.closest('.cm-batch-x') : null;
            if (rm) {
                var i = Number(rm.dataset.i);
                var gone = CON_MEDIA.batch.splice(i, 1)[0];
                if (gone && gone.url) { try { URL.revokeObjectURL(gone.url); } catch (e2) { /* ignore */ } }
                if (!CON_MEDIA.batch.length) conMediaBatchClose();
                else conMediaBatchRenderList();
                return;
            }
            var act = e.target.closest ? e.target.closest('[data-cm-batch]') : null;
            if (!act) return;
            if (act.getAttribute('data-cm-batch') === 'cancel') conMediaBatchClose();
            else if (act.getAttribute('data-cm-batch') === 'go') conMediaBatchRun();
        });
        m.addEventListener('input', function (e) {
            var c = e.target;
            if (c.classList && c.classList.contains('cm-batch-cap')) CON_MEDIA.batch[Number(c.dataset.i)].caption = c.value;
        });
        m.addEventListener('change', function (e) {
            var c = e.target;
            if (c.classList && c.classList.contains('cm-batch-cat')) CON_MEDIA.batch[Number(c.dataset.i)].cat = c.value;
        });
    }
    m.innerHTML =
        '<div class="modal-box cm-batch-box">' +
        '<button type="button" class="mclose" data-cm-batch="cancel" aria-label="Close">×</button>' +
        '<h3 id="photoBatchTitle"></h3>' +
        '<div class="cm-batch-shared"><div class="cm-batch-shared-title">' + conMediaEsc(conMediaTr('cm.batch.shared')) + '</div>' +
        '<div class="cm-batch-grid">' +
        conMediaBatchField(conMediaTr('media.upload.category'), '<select id="photoBatchCat">' + conMediaBatchCatOptions(false) + '</select>') +
        conMediaBatchField(conMediaTr('media.upload.dateTaken'), '<input type="date" id="photoBatchDate">') +
        conMediaBatchField(conMediaTr('media.upload.doctor'), '<input type="text" id="photoBatchDr">') +
        conMediaBatchField(conMediaTr('media.upload.clinicBranch'), '<input type="text" id="photoBatchClinic">') +
        '<div class="con-media-ctx" data-ctx-kind="photos" hidden>' +
        conMediaBatchField(conMediaTr('cm.field.tooth'), '<input type="text" id="photoBatchTooth" placeholder="' + conMediaEsc(conMediaTr('cm.field.toothPh')) + '">') +
        conMediaBatchField(conMediaTr('cm.field.tags'), '<input type="text" id="photoBatchTags" placeholder="' + conMediaEsc(conMediaTr('cm.field.tagsPh')) + '">') +
        conMediaBatchField(conMediaTr('cm.field.visit'), '<select id="photoBatchAppt"></select>') +
        '</div></div>' +
        conMediaBatchField(conMediaTr('media.upload.captionNotes'), '<textarea id="photoBatchCaption" rows="2"></textarea>') +
        '</div>' +
        '<div class="cm-batch-shared-title">' + conMediaEsc(conMediaTr('cm.batch.perFile')) + '</div>' +
        '<div id="photoBatchList" class="cm-batch-list"></div>' +
        '<div class="cm-batch-actions">' +
        '<button type="button" class="btn-add" id="photoBatchGo" data-cm-batch="go"></button>' +
        '<button type="button" class="cm-batch-cancel" data-cm-batch="cancel">' + conMediaEsc(conMediaTr('patient.edit.cancelBtn')) + '</button>' +
        '</div></div>';
    conMediaEl('photoBatchDate').value = conMediaToday();
    conMediaEl('photoBatchCat').value = 'Intraoral';
    conMediaBatchRenderList();
    conMediaProbeCtx().then(function () {
        conMediaApplyCtxVisibility();
        if (conMediaCtxOk('photos')) conMediaFillApptSelect('photoBatchAppt', photoPatientId, '', true);
    });
    m.style.display = 'block';
}

function conMediaBatchRun() {
    var items = CON_MEDIA.batch.slice();
    if (!items.length) return;
    function val(id) { var el = conMediaEl(id); return el ? el.value.trim() : ''; }
    var shared = {
        category: val('photoBatchCat') || 'Other',
        taken_date: val('photoBatchDate') || conMediaToday(),
        dr: val('photoBatchDr'),
        clinic: val('photoBatchClinic'),
        caption: val('photoBatchCaption'),
        ctx: conMediaPhotoCtxRead('photoBatch')
    };
    var goBtn = conMediaEl('photoBatchGo');
    if (goBtn) goBtn.disabled = true;
    var ok = 0;
    var fail = 0;
    var i = 0;
    function next() {
        if (i >= items.length) {
            if (typeof showPhotoUploadProgress === 'function') showPhotoUploadProgress(false);
            conMediaBatchClose();
            if (typeof loadPhotoRecords === 'function') loadPhotoRecords();
            conMediaScheduleSummary(true);
            if (typeof conSchedulePatientTimelineRefresh === 'function' && conMediaPid()) conSchedulePatientTimelineRefresh(conMediaPid());
            conMediaNotify(fail
                ? conMediaTrRepl('cm.batch.partial', { OK: ok, N: items.length, FAIL: fail })
                : conMediaTrRepl('cm.batch.done', { N: ok }), fail ? 'error' : 'info');
            return;
        }
        var it = items[i++];
        if (typeof showPhotoUploadProgress === 'function') {
            showPhotoUploadProgress(true, conMediaTrRepl('cm.batch.progress', { I: i, N: items.length }), Math.round(((i - 1) / items.length) * 100));
        }
        var meta = {
            category: it.cat || shared.category,
            taken_date: shared.taken_date,
            dr: shared.dr,
            clinic: shared.clinic,
            caption: it.caption || shared.caption,
            ctx: shared.ctx
        };
        photoUploadOne(it.file, meta).then(function (res) {
            if (res && res.ok) ok++; else fail++;
            next();
        });
    }
    next();
}

function conMediaWireUploadSurface() {
    var pane = conMediaEl('con-photos');
    if (pane && !pane.dataset.cmDrop) {
        pane.dataset.cmDrop = '1';
        var depth = 0;
        pane.addEventListener('dragenter', function (e) {
            if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') < 0) return;
            depth++;
            pane.classList.add('is-drop');
        });
        pane.addEventListener('dragleave', function () {
            depth = Math.max(0, depth - 1);
            if (!depth) pane.classList.remove('is-drop');
        });
        pane.addEventListener('dragover', function (e) {
            if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) e.preventDefault();
        });
        pane.addEventListener('drop', function (e) {
            depth = 0;
            pane.classList.remove('is-drop');
            if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
            e.preventDefault();
            photoHandleFiles(e.dataTransfer.files);
        });
    }
    if (!document._cmPasteWired) {
        document._cmPasteWired = true;
        document.addEventListener('paste', function (e) {
            if (!document.querySelector('.con-tab[data-tab="photos"].active')) return;
            var tg = e.target;
            if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
            var files = [];
            var items = (e.clipboardData && e.clipboardData.items) || [];
            for (var i = 0; i < items.length; i++) {
                if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
                    var f = items[i].getAsFile();
                    if (f) {
                        var ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
                        var name = 'pasted-' + Date.now() + '-' + i + '.' + ext;
                        try { f = new File([f], name, { type: f.type }); } catch (err) { /* keep original */ }
                        files.push(f);
                    }
                }
            }
            if (!files.length) return;
            e.preventDefault();
            photoHandleFiles(files);
        });
    }
}

/* ── Forms: context row (status / category / visit / validity) ── */

function conMediaDocCategoryFor(tpl) {
    if (!tpl) return 'letter';
    if (typeof conFormsIsSickLeaveTemplate === 'function' && conFormsIsSickLeaveTemplate(tpl)) return 'certificate';
    if (typeof conFormsIsReferralTemplate === 'function' && conFormsIsReferralTemplate(tpl)) return 'referral';
    var type = String(tpl.template_type || '').toLowerCase();
    if (type === 'consent') return 'consent';
    if (type === 'receipt') return 'receipt';
    if (type === 'prescription') return 'prescription';
    var label = String(tpl.template_code || '') + ' ' + String(tpl.template_name || '');
    if (/ATTN|ATTEND|CERTIF|到診|到诊|證明|证明/i.test(label)) return 'certificate';
    if (type === 'report') return 'letter';
    return 'other';
}

function conMediaDocDefaultStatus(tpl) {
    return tpl && String(tpl.template_type || '').toLowerCase() === 'consent' ? 'draft' : 'issued';
}

function conMediaFillFormsCtxSelects() {
    var st = conMediaEl('conFormsStatusSel');
    if (st) {
        var cur = st.value;
        st.innerHTML = CON_MEDIA_DOC_STATUSES.map(function (s) {
            return '<option value="' + s + '">' + conMediaEsc(conMediaTr('cm.status.' + s)) + '</option>';
        }).join('');
        st.value = cur || 'issued';
    }
    var cat = conMediaEl('conFormsCategorySel');
    if (cat) {
        var curC = cat.value;
        cat.innerHTML = CON_MEDIA_DOC_CATEGORIES.map(function (c) {
            return '<option value="' + c + '">' + conMediaEsc(conMediaTr('cm.dcat.' + c)) + '</option>';
        }).join('');
        cat.value = curC || 'letter';
    }
    var fs = conMediaEl('conFormsHistStatus');
    if (fs) {
        var curS = fs.value;
        fs.innerHTML = '<option value="">' + conMediaEsc(conMediaTr('cm.forms.allStatus')) + '</option>' +
            CON_MEDIA_DOC_STATUSES.map(function (s) {
                return '<option value="' + s + '">' + conMediaEsc(conMediaTr('cm.status.' + s)) + '</option>';
            }).join('');
        fs.value = curS;
    }
    var ft = conMediaEl('conFormsHistType');
    if (ft) {
        var curT = ft.value;
        var types = ['receipt', 'prescription', 'consent', 'report', 'pdf'];
        ft.innerHTML = '<option value="">' + conMediaEsc(conMediaTr('cm.forms.allTypes')) + '</option>' +
            types.map(function (ty) {
                var lbl = ty === 'pdf' ? 'PDF' : (typeof conDispTplType === 'function' ? conDispTplType(ty) : ty);
                return '<option value="' + ty + '">' + conMediaEsc(lbl) + '</option>';
            }).join('');
        ft.value = curT;
    }
}

function conMediaFormsCtxRefresh() {
    conMediaFillFormsCtxSelects();
    var pid = typeof conFormsPatientId !== 'undefined' ? conFormsPatientId : null;
    if (!pid) return;
    var cur = conMediaEl('conFormsApptSel');
    conMediaFillApptSelect('conFormsApptSel', pid, cur ? cur.value : '', false);
}

function conMediaFormsCtxRead() {
    var st = conMediaEl('conFormsStatusSel');
    var cat = conMediaEl('conFormsCategorySel');
    var ap = conMediaEl('conFormsApptSel');
    var vu = conMediaEl('conFormsValidUntil');
    return {
        status: st && st.value ? st.value : 'issued',
        category: cat && cat.value ? cat.value : null,
        appointment_id: ap && ap.value ? ap.value : null,
        valid_until: vu && vu.value ? vu.value : null
    };
}

function conMediaFormsCtxWrite(d) {
    conMediaFillFormsCtxSelects();
    var st = conMediaEl('conFormsStatusSel');
    var cat = conMediaEl('conFormsCategorySel');
    var vu = conMediaEl('conFormsValidUntil');
    if (st) st.value = d && d.status ? d.status : 'issued';
    if (cat) cat.value = d && d.category ? d.category : conMediaDocCategoryFor(d && d.template_type ? { template_type: d.template_type, template_code: d.template_code, template_name: d.template_name } : null);
    if (vu) vu.value = d && d.valid_until ? d.valid_until : '';
    var pid = typeof conFormsPatientId !== 'undefined' ? conFormsPatientId : null;
    conMediaFillApptSelect('conFormsApptSel', pid, d && d.appointment_id ? d.appointment_id : '', false);
}

/** Called when a template is chosen for a NEW document. */
function conMediaFormsCtxOnTemplate(tpl) {
    conMediaFillFormsCtxSelects();
    var st = conMediaEl('conFormsStatusSel');
    var cat = conMediaEl('conFormsCategorySel');
    var vu = conMediaEl('conFormsValidUntil');
    if (st) st.value = conMediaDocDefaultStatus(tpl);
    if (cat) cat.value = conMediaDocCategoryFor(tpl);
    if (vu) vu.value = '';
    var ap = conMediaEl('conFormsApptSel');
    var pid = typeof conFormsPatientId !== 'undefined' ? conFormsPatientId : null;
    conMediaFillApptSelect('conFormsApptSel', pid, ap ? ap.value : '', true);
}

function conMediaOnFormsApptChange() {
    var wasDirty = typeof _conFormsDirty !== 'undefined' && _conFormsDirty;
    if (typeof _conFormsDirty !== 'undefined') _conFormsDirty = true;
    if (typeof conFormsEditingDocId !== 'undefined' && conFormsEditingDocId) return;
    if (typeof conFormsSelectedTemplate === 'undefined' || !conFormsSelectedTemplate) return;
    CON_MEDIA.visitCtx = null;
    if (wasDirty) return;
    if (typeof conFormsWhenReadyForPlaceholders === 'function' && typeof conFormsRenderDocumentInEditor === 'function') {
        conFormsWhenReadyForPlaceholders(function () {
            if (!conFormsSelectedTemplate) return;
            if (typeof conFormsIsSickLeaveTemplate === 'function' && conFormsIsSickLeaveTemplate(conFormsSelectedTemplate) &&
                typeof conFormsScheduleSickLeaveRender === 'function') {
                conFormsScheduleSickLeaveRender();
            } else {
                conFormsRenderDocumentInEditor(conFormsSelectedTemplate.content || '');
            }
            _conFormsDirty = false;
            conMediaNotify(conMediaTr('cm.forms.visitApplied'), 'info');
        });
    }
}

function conMediaDocBadgesHtml(d) {
    var bits = [];
    if (d.status && conMediaCtxOk('docs')) {
        bits.push('<span class="con-media-badge con-media-badge--st-' + conMediaEsc(d.status) + '">' +
            conMediaEsc(conMediaTr('cm.status.' + d.status)) + '</span>');
    }
    if (d.category && conMediaCtxOk('docs')) {
        bits.push('<span class="con-media-badge con-media-badge--cat">' + conMediaEsc(conMediaTr('cm.dcat.' + d.category)) + '</span>');
    }
    if (d.appointment_id) {
        var dt = conMediaApptDateFor(conMediaPid(), d.appointment_id);
        bits.push('<span class="con-media-badge con-media-badge--visit">📅 ' + conMediaEsc(dt || '') + '</span>');
    }
    if (d.valid_until) {
        var expired = String(d.valid_until) < conMediaToday();
        bits.push('<span class="con-media-badge ' + (expired ? 'con-media-badge--exp' : 'con-media-badge--ok') + '">' +
            conMediaEsc(expired ? conMediaTr('cm.badge.expired') : conMediaTrRepl('cm.badge.validUntil', { DATE: d.valid_until })) + '</span>');
    }
    return bits.join('');
}

/* ── Forms: quick create ─────────────────────────────────── */

function conMediaPickTemplateFrom(list, kind) {
    list = list || [];
    function type(tpl) { return String(tpl.template_type || '').toLowerCase(); }
    function label(tpl) { return String(tpl.template_code || '') + ' ' + String(tpl.template_name || ''); }
    var isSick = function (tpl) { return typeof conFormsIsSickLeaveTemplate === 'function' && conFormsIsSickLeaveTemplate(tpl); };
    var isRef = function (tpl) { return typeof conFormsIsReferralTemplate === 'function' && conFormsIsReferralTemplate(tpl); };
    var isAtt = function (tpl) { return /ATTN|ATTEND|到診|到诊/i.test(label(tpl)); };
    var finder = {
        sick_leave: isSick,
        referral: isRef,
        consent: function (tpl) { return type(tpl) === 'consent'; },
        receipt: function (tpl) { return type(tpl) === 'receipt'; },
        attendance: isAtt,
        letter: function (tpl) {
            return type(tpl) === 'report' && !isSick(tpl) && !isRef(tpl) && !isAtt(tpl);
        }
    }[kind];
    if (!finder) return null;
    var hit = list.filter(finder)[0] || null;
    if (!hit && kind === 'letter') {
        hit = list.filter(function (tpl) {
            return type(tpl) !== 'consent' && type(tpl) !== 'receipt' && type(tpl) !== 'prescription';
        })[0] || null;
    }
    return hit;
}

function conMediaWhenFormsReady(cb, tries) {
    tries = tries || 0;
    var sel = conMediaEl('conFormsTemplateSel');
    var ready = typeof conFormsPatientId !== 'undefined' && conFormsPatientId &&
        typeof conFormsTemplates !== 'undefined' && conFormsTemplates.length &&
        sel && sel.options.length > 1;
    if (ready) { cb(true); return; }
    if (tries > 40) { cb(false); return; }
    setTimeout(function () { conMediaWhenFormsReady(cb, tries + 1); }, 100);
}

function conMediaQuickCreate(kind) {
    if (!conMediaPid()) {
        conMediaNotify(conMediaTr('cm.qc.needPatient'));
        return;
    }
    var kindKey = {
        sick_leave: 'cm.add.sickLeave', referral: 'cm.add.referral', consent: 'cm.add.consent',
        receipt: 'cm.add.receipt', attendance: 'cm.add.attendance', letter: 'cm.add.letter'
    }[kind] || 'cm.add.letter';
    function go() {
        if (typeof switchConTab === 'function') switchConTab('forms');
        conMediaWhenFormsReady(function (ok) {
            if (!ok) { conMediaNotify(conMediaTr('cm.qc.timeout')); return; }
            var tpl = conMediaPickTemplateFrom(conFormsTemplates, kind);
            if (!tpl) {
                conMediaNotify(conMediaTrRepl('cm.qc.noTemplate', { KIND: conMediaTr(kindKey) }));
                return;
            }
            if (typeof conFormsStartNewDoc === 'function') conFormsStartNewDoc();
            var sel = conMediaEl('conFormsTemplateSel');
            sel.value = tpl.id;
            if (typeof onConFormsTemplateChange === 'function') onConFormsTemplateChange();
            var wrap = conMediaEl('conFormsEditorWrap');
            if (wrap && wrap.scrollIntoView) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }
    var onForms = typeof document !== 'undefined' && document.querySelector('.con-tab[data-tab="forms"].active');
    if (onForms && typeof _conFormsDirty !== 'undefined' && _conFormsDirty && typeof _conFormsCheckUnsavedThen === 'function') {
        _conFormsCheckUnsavedThen(go);
    } else {
        go();
    }
}

/* ── Forms: visit / billing placeholders ─────────────────── */

function conMediaPickBill(bills, apptId, today) {
    var live = (bills || []).filter(function (b) { return b && !b.voided_at; });
    if (apptId) {
        var byAppt = live.filter(function (b) { return String(b.appointment_id || '') === String(apptId); })[0];
        if (byAppt) return byAppt;
    }
    var onDay = live.filter(function (b) { return b.bill_date === today; })[0];
    return onDay || live[0] || null;
}

function conMediaBillItemsText(bill) {
    var items = bill && Array.isArray(bill.items) ? bill.items : [];
    var out = [];
    items.forEach(function (it) {
        var d = String((it && (it.desc || it.description || it.name)) || '').trim();
        if (!d) return;
        var qty = it.qty && Number(it.qty) !== 1 ? ' ×' + it.qty : '';
        out.push(d + qty);
    });
    return out.join('; ');
}

function conMediaPickNextAppt(rows, today, nowHm, excludeId) {
    var future = (rows || []).filter(function (a) {
        if (!a || !a.date || String(a.id) === String(excludeId || '')) return false;
        if (a.date > today) return true;
        return a.date === today && String(a.start_time || '').slice(0, 5) > nowHm;
    });
    future.sort(function (a, b) {
        return (a.date + ' ' + String(a.start_time || '')).localeCompare(b.date + ' ' + String(b.start_time || ''));
    });
    return future[0] || null;
}

function conMediaLoadVisitCtx(pid, apptId) {
    var key = String(pid) + '|' + String(apptId || '');
    if (CON_MEDIA.visitCtx && CON_MEDIA.visitCtx.key === key && Date.now() - CON_MEDIA.visitCtx.at < 15000) {
        return Promise.resolve(CON_MEDIA.visitCtx);
    }
    if (!pid || typeof SB === 'undefined' || !SB || !SB.from) return Promise.resolve(null);
    return Promise.all([
        conMediaLoadAppts(pid, true),
        Promise.resolve(SB.from('bills')
            .select('id,total,balance,amount_paid,voided_at,bill_date,created_at,appointment_id,items')
            .eq('patient_id', pid)
            .order('created_at', { ascending: false })
            .limit(40))
    ]).then(function (res) {
        var appts = res[0] || [];
        var bills = (res[1] && !res[1].error && res[1].data) || [];
        var today = conMediaToday();
        var now = new Date();
        var nowHm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        var appt = apptId ? (appts.filter(function (a) { return String(a.id) === String(apptId); })[0] || null) : null;
        var bill = conMediaPickBill(bills, apptId, today);
        var treatment = '';
        if (appt && typeof appt.treatment_items === 'string' && appt.treatment_items.trim()) treatment = appt.treatment_items.trim();
        if (!treatment) treatment = conMediaBillItemsText(bill);
        CON_MEDIA.visitCtx = {
            key: key,
            at: Date.now(),
            pid: pid,
            appt: appt,
            bill: bill,
            nextAppt: conMediaPickNextAppt(appts, today, nowHm, apptId),
            treatmentDone: treatment
        };
        return CON_MEDIA.visitCtx;
    }, function () { return null; });
}

function conMediaVisitPlaceholders() {
    var pid = typeof conFormsPatientId !== 'undefined' ? conFormsPatientId : null;
    var c = CON_MEDIA.visitCtx;
    var out = {
        receipt_no: '', total_amount: '', amount_paid: '', balance: '', bill_date: '',
        bill_items: '', visit_date: conMediaToday(), visit_time: '', treatment_done: '',
        next_appointment: '', next_appointment_date: '', next_appointment_time: ''
    };
    if (!c || !pid || String(c.pid) !== String(pid)) return out;
    if (c.bill) {
        out.receipt_no = c.bill.id ? String(c.bill.id).slice(0, 8).toUpperCase() : '';
        out.total_amount = conMediaMoney(c.bill.total);
        out.amount_paid = conMediaMoney(c.bill.amount_paid);
        out.balance = conMediaMoney(c.bill.balance);
        out.bill_date = c.bill.bill_date || '';
        out.bill_items = conMediaBillItemsText(c.bill);
    }
    if (c.appt) {
        out.visit_date = c.appt.date || out.visit_date;
        out.visit_time = c.appt.start_time ? String(c.appt.start_time).slice(0, 5) : '';
    }
    out.treatment_done = c.treatmentDone || '';
    if (c.nextAppt) {
        out.next_appointment_date = c.nextAppt.date || '';
        out.next_appointment_time = c.nextAppt.start_time ? String(c.nextAppt.start_time).slice(0, 5) : '';
        out.next_appointment = (out.next_appointment_date + ' ' + out.next_appointment_time).trim();
    }
    return out;
}

/* ── Forms: filterable history ───────────────────────────── */

function conMediaDocFilterRead() {
    var q = conMediaEl('conFormsHistQ');
    var ty = conMediaEl('conFormsHistType');
    var st = conMediaEl('conFormsHistStatus');
    CON_MEDIA.docFilter.q = q ? q.value.trim() : '';
    CON_MEDIA.docFilter.type = ty ? ty.value : '';
    CON_MEDIA.docFilter.status = st && conMediaCtxOk('docs') ? st.value : '';
    return CON_MEDIA.docFilter;
}

function conMediaDocFilterChanged(immediate) {
    clearTimeout(CON_MEDIA.docFilterTimer);
    function run() {
        conMediaDocFilterRead();
        CON_MEDIA.docFilter.limit = 30;
        if (typeof searchConFormsDocs === 'function') searchConFormsDocs();
    }
    if (immediate) run();
    else CON_MEDIA.docFilterTimer = setTimeout(run, 250);
}

function conMediaDocLoadMore() {
    conMediaDocFilterRead();
    CON_MEDIA.docFilter.limit += 30;
    if (typeof searchConFormsDocs === 'function') searchConFormsDocs();
}

function conMediaSafeSearchTerm(q) {
    return String(q || '').replace(/[,()*%\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

function conMediaFetchDocs(pid) {
    var f = conMediaDocFilterRead();
    var limit = f.limit;
    return conMediaProbeCtx().then(function () {
        function run() {
            var cols = conMediaDocCols('id,document_name,document_date,template_name,template_type,created_at,content_html');
            var q = SB.from('patient_documents').select(cols).eq('patient_id', pid);
            var term = conMediaSafeSearchTerm(f.q);
            if (term) q = q.or('document_name.ilike.*' + term + '*,template_name.ilike.*' + term + '*');
            if (f.type) q = q.eq('template_type', f.type);
            if (f.status && conMediaCtxOk('docs')) q = q.eq('status', f.status);
            return Promise.resolve(q.order('created_at', { ascending: false }).range(0, limit));
        }
        return run().then(function (r) {
            if (r && r.error && conMediaIsMissingColErr(r.error) && conMediaCtxOk('docs')) {
                CON_MEDIA.ctx.docs = false;
                conMediaApplyCtxVisibility();
                return run();
            }
            return r;
        }).then(function (r) {
            if (!r || r.error) return { error: r && r.error, rows: [], hasMore: false };
            var rows = r.data || [];
            return { error: null, rows: rows.slice(0, limit), hasMore: rows.length > limit };
        });
    });
}

function conMediaDocAfterRender(res) {
    var more = conMediaEl('conFormsHistMore');
    if (more) {
        more.hidden = !res.hasMore;
        more.textContent = conMediaTr('cm.forms.loadMore');
    }
    var cnt = conMediaEl('conFormsHistCount');
    if (cnt) cnt.textContent = res.rows.length ? conMediaTrRepl('cm.forms.showing', { N: res.rows.length }) : '';
    conMediaScheduleSummary(true);
}

/* ── Forms: draft safety net ─────────────────────────────── */

function conMediaDraftKey(pid) { return CON_MEDIA_DRAFT_PREFIX + String(pid); }

function conMediaFormsEditorHtml() {
    if (typeof DocEditor !== 'undefined' && typeof DocEditor.getHtml === 'function') {
        return DocEditor.getHtml('conFormsDocEditor') || '';
    }
    var ed = conMediaEl('conFormsDocEditor');
    return ed ? ed.innerHTML : '';
}

function conMediaFormsDraftSave(pid) {
    pid = pid || (typeof conFormsPatientId !== 'undefined' ? conFormsPatientId : null);
    if (!pid || typeof localStorage === 'undefined') return false;
    if (typeof _conFormsDirty === 'undefined' || !_conFormsDirty) return false;
    var html = conMediaFormsEditorHtml();
    if (!html || !String(html).trim()) return false;
    var name = conMediaEl('conFormsDocName');
    try {
        localStorage.setItem(conMediaDraftKey(pid), JSON.stringify({
            tpl: typeof conFormsSelectedTemplate !== 'undefined' && conFormsSelectedTemplate ? conFormsSelectedTemplate.id : '',
            name: name ? name.value : '',
            html: html,
            editingId: typeof conFormsEditingDocId !== 'undefined' ? conFormsEditingDocId : null,
            ts: Date.now()
        }));
        return true;
    } catch (e) { return false; }
}

function conMediaFormsDraftRead(pid) {
    if (!pid || typeof localStorage === 'undefined') return null;
    try {
        var raw = localStorage.getItem(conMediaDraftKey(pid));
        if (!raw) return null;
        var d = JSON.parse(raw);
        if (!d || !d.html || Date.now() - (d.ts || 0) > CON_MEDIA_DRAFT_MAX_AGE_MS) {
            localStorage.removeItem(conMediaDraftKey(pid));
            return null;
        }
        return d;
    } catch (e) { return null; }
}

function conMediaFormsDraftClear(pid) {
    pid = pid || (typeof conFormsPatientId !== 'undefined' ? conFormsPatientId : null);
    if (!pid || typeof localStorage === 'undefined') return;
    try { localStorage.removeItem(conMediaDraftKey(pid)); } catch (e) { /* ignore */ }
    conMediaFormsDraftBar();
}

function conMediaFormsDraftBar() {
    var bar = conMediaEl('conFormsDraftBar');
    if (!bar) return;
    var pid = typeof conFormsPatientId !== 'undefined' ? conFormsPatientId : null;
    var d = conMediaFormsDraftRead(pid);
    var active = typeof _conFormsDirty !== 'undefined' && _conFormsDirty;
    if (!d || active) { bar.hidden = true; return; }
    var txt = conMediaEl('conFormsDraftText');
    if (txt) {
        txt.textContent = conMediaTrRepl('cm.forms.draftFound', {
            WHEN: new Date(d.ts).toLocaleString(typeof conUiLocale === 'function' ? conUiLocale() : undefined, { dateStyle: 'medium', timeStyle: 'short' }),
            NAME: d.name || '—'
        });
    }
    bar.hidden = false;
}

function conMediaFormsDraftDiscard() {
    conMediaFormsDraftClear();
}

function conMediaFormsDraftRestore() {
    var pid = typeof conFormsPatientId !== 'undefined' ? conFormsPatientId : null;
    var d = conMediaFormsDraftRead(pid);
    if (!d) { conMediaFormsDraftBar(); return; }
    conMediaWhenFormsReady(function (ok) {
        if (!ok) { conMediaNotify(conMediaTr('cm.qc.timeout')); return; }
        var tpl = (conFormsTemplates || []).filter(function (x) { return x.id === d.tpl; })[0] || null;
        var sel = conMediaEl('conFormsTemplateSel');
        if (sel && tpl) sel.value = tpl.id;
        conFormsSelectedTemplate = tpl;
        conFormsEditingDocId = d.editingId || null;
        if (typeof conFormsUpdateEditingBadge === 'function') conFormsUpdateEditingBadge();
        var nm = conMediaEl('conFormsDocName');
        if (nm) nm.value = d.name || '';
        var wrap = conMediaEl('conFormsEditorWrap');
        if (wrap) wrap.style.display = 'block';
        if (typeof conFormsEnsureRichEditor === 'function') conFormsEnsureRichEditor();
        if (typeof DocEditor !== 'undefined') DocEditor.setHtml('conFormsDocEditor', d.html);
        else conMediaEl('conFormsDocEditor').innerHTML = d.html;
        if (typeof conFormsSyncSickLeaveDatePanel === 'function') conFormsSyncSickLeaveDatePanel();
        if (typeof conFormsHydrateSickLeaveFieldsFromHtml === 'function') conFormsHydrateSickLeaveFieldsFromHtml(d.html);
        _conFormsDirty = true;
        var bar = conMediaEl('conFormsDraftBar');
        if (bar) bar.hidden = true;
    });
}

/** Selecting a different patient: keep unsaved letter text as a draft, then reset the editor. */
function conMediaOnPatientSwitch(prevId, nextId) {
    CON_MEDIA.compare = [];
    CON_MEDIA.visitCtx = null;
    CON_MEDIA.pendingOpen = (CON_MEDIA.pendingOpen && String(CON_MEDIA.pendingOpen.pid) === String(nextId)) ? CON_MEDIA.pendingOpen : null;
    var prev = prevId || (typeof conFormsPatientId !== 'undefined' ? conFormsPatientId : null);
    if (prev && typeof _conFormsDirty !== 'undefined' && _conFormsDirty) {
        if (conMediaFormsDraftSave(prev)) conMediaNotify(conMediaTr('cm.forms.draftStashed'), 'info');
    }
    try {
        if (typeof conFormsStartNewDoc === 'function') conFormsStartNewDoc(true);
    } catch (e) { /* editor not mounted yet */ }
    var q = conMediaEl('conFormsHistQ');
    if (q) q.value = '';
    CON_MEDIA.docFilter = { q: '', type: '', status: '', limit: 30 };
}

/* ── init ────────────────────────────────────────────────── */

function conMediaInit() {
    if (typeof document === 'undefined' || CON_MEDIA.wired) return;
    CON_MEDIA.wired = true;
    conMediaFillFormsCtxSelects();
    conMediaWireUploadSurface();
    document.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.con-media-add')) return;
        document.querySelectorAll('.con-media-menu').forEach(function (m) { m.hidden = true; });
    });
    var ctxRow = conMediaEl('conFormsCtxRow');
    if (ctxRow) {
        ctxRow.addEventListener('change', function (e) {
            if (e.target && e.target.id === 'conFormsApptSel') conMediaOnFormsApptChange();
            else if (typeof _conFormsDirty !== 'undefined') _conFormsDirty = true;
        });
    }
    document.addEventListener('input', function (e) {
        if (!e.target || e.target.id !== 'conFormsDocEditor') return;
        clearTimeout(CON_MEDIA.draftTimer);
        CON_MEDIA.draftTimer = setTimeout(function () { conMediaFormsDraftSave(); }, 2000);
    });
    document.addEventListener('app-lang-change', function () {
        conMediaFillFormsCtxSelects();
        conMediaRenderHub();
    });
    document.addEventListener('app-active-patient-change', function () {
        if (conMediaPid()) conMediaScheduleSummary();
    });
    conMediaProbeCtx();
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', conMediaInit);
    else conMediaInit();
}
