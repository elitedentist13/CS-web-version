/* =========================================================
   app-xray-ctx.js - Consultation X-ray tab: clinical context.
   Gives every film an optional linked visit (appointment), the
   teeth it shows (FDI) and a review status, with badges, filters
   and a tooth picker. Works without xray_context.sql: the fields
   stay hidden and saves fall back to the old columns until the
   SQL has been run in Supabase.
   Loads after app-xray.js / app-xray-link.js.
   ========================================================= */

(function () {
    var MORE = {
        'xc.visit': { en: 'Linked visit', 'zh-CN': '关联就诊', 'zh-Hant': '關聯就診' },
        'xc.visitNone': { en: '— not linked —', 'zh-CN': '— 不关联 —', 'zh-Hant': '— 不關聯 —' },
        'xc.visitToday': { en: 'Today', 'zh-CN': '今天', 'zh-Hant': '今天' },
        'xc.visitOther': { en: 'Earlier visit', 'zh-CN': '较早就诊', 'zh-Hant': '較早就診' },
        'xc.visitBadge': { en: 'Visit', 'zh-CN': '就诊', 'zh-Hant': '就診' },
        'xc.teeth': { en: 'Teeth (FDI)', 'zh-CN': '牙位 (FDI)', 'zh-Hant': '牙位 (FDI)' },
        'xc.teethPh': { en: 'e.g. 16, 24', 'zh-CN': '例如 16, 24', 'zh-Hant': '例如 16, 24' },
        'xc.teethPick': { en: 'Pick teeth on a chart', 'zh-CN': '在牙位图上选择', 'zh-Hant': '在牙位圖上選擇' },
        'xc.teethClear': { en: 'Clear', 'zh-CN': '清除', 'zh-Hant': '清除' },
        'xc.teethDone': { en: 'Done', 'zh-CN': '完成', 'zh-Hant': '完成' },
        'xc.review': { en: 'Review status', 'zh-CN': '审阅状态', 'zh-Hant': '審閱狀態' },
        'xc.statusNew': { en: 'To review', 'zh-CN': '待审阅', 'zh-Hant': '待審閱' },
        'xc.statusReviewed': { en: 'Reviewed', 'zh-CN': '已审阅', 'zh-Hant': '已審閱' },
        'xc.reviewedBy': { en: 'Reviewed by {NAME} · {DATE}', 'zh-CN': '审阅人 {NAME} · {DATE}', 'zh-Hant': '審閱人 {NAME} · {DATE}' },
        'xc.fAny': { en: 'Any status', 'zh-CN': '全部状态', 'zh-Hant': '全部狀態' },
        'xc.fNew': { en: 'To review', 'zh-CN': '待审阅', 'zh-Hant': '待審閱' },
        'xc.fRev': { en: 'Reviewed', 'zh-CN': '已审阅', 'zh-Hant': '已審閱' },
        'xc.fToothPh': { en: 'Tooth e.g. 16', 'zh-CN': '牙位 例如 16', 'zh-Hant': '牙位 例如 16' },
        'xc.off': { en: 'Visit / teeth / review fields are off. Run xray_context.sql in Supabase to enable them.', 'zh-CN': '就诊/牙位/审阅字段未启用。请在 Supabase 运行 xray_context.sql。', 'zh-Hant': '就診/牙位/審閱欄位未啟用。請在 Supabase 執行 xray_context.sql。' }
    };
    if (typeof I18N_STRINGS !== 'undefined') {
        Object.keys(MORE).forEach(function (k) { I18N_STRINGS[k] = MORE[k]; });
    }
})();

var XRAY_CTX_KEYS = ['appointment_id', 'teeth', 'review_status', 'reviewed_by', 'reviewed_at'];
var XRAY_CTX = {
    ok: null,
    _probe: null,
    appts: {},
    inflight: {},
    revFilter: '',
    toothFilter: [],
    toothBad: false
};

/* ── helpers ─────────────────────────────────────────────── */

function xrayCtxTr(key) {
    return (typeof t === 'function') ? t(key) : key;
}

function xrayCtxEsc(s) {
    if (typeof esc === 'function') return esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function xrayCtxEl(id) {
    return (typeof document !== 'undefined') ? document.getElementById(id) : null;
}

function xrayCtxToday() {
    if (typeof todayISO === 'function') return todayISO();
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function xrayCtxIsMissingColErr(err) {
    if (!err) return false;
    var code = String(err.code || '');
    if (code === '42703' || code === 'PGRST204') return true;
    var m = String(err.message || err.details || err.hint || '');
    return /column .* does not exist|could not find the .* column|schema cache/i.test(m);
}

function xrayCtxOk() {
    return XRAY_CTX.ok === true;
}

function xrayCtxApplyVisibility() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.xray-ctx').forEach(function (el) {
        el.hidden = XRAY_CTX.ok !== true;
    });
    document.querySelectorAll('.xray-ctx-off').forEach(function (el) {
        el.hidden = XRAY_CTX.ok !== false;
    });
}

function xrayCtxSetOk(v) {
    if (XRAY_CTX.ok === v) return;
    XRAY_CTX.ok = v;
    xrayCtxApplyVisibility();
    if (v === false) {
        XRAY_CTX.revFilter = '';
        XRAY_CTX.toothFilter = [];
        XRAY_CTX.toothBad = false;
    }
}

function xrayCtxStrip(payload) {
    var out = {};
    Object.keys(payload || {}).forEach(function (k) {
        if (XRAY_CTX_KEYS.indexOf(k) < 0) out[k] = payload[k];
    });
    return out;
}

function xrayCtxHasKeys(payload) {
    return Object.keys(payload || {}).some(function (k) { return XRAY_CTX_KEYS.indexOf(k) >= 0; });
}

/** Run a write; if the optional columns are missing, remember that and retry without them. */
function xrayCtxWrite(makeOp, payload) {
    var knownOff = XRAY_CTX.ok === false;
    var body = knownOff ? xrayCtxStrip(payload) : payload;
    var sentCtx = !knownOff && xrayCtxHasKeys(payload);
    return Promise.resolve(makeOp(body)).then(function (r) {
        if (r && r.error && sentCtx && xrayCtxIsMissingColErr(r.error)) {
            xrayCtxSetOk(false);
            return makeOp(xrayCtxStrip(payload));
        }
        if (r && !r.error && sentCtx && XRAY_CTX.ok == null) xrayCtxSetOk(true);
        return r;
    });
}

function xrayCtxProbe() {
    if (XRAY_CTX.ok != null) return Promise.resolve(XRAY_CTX.ok);
    if (XRAY_CTX._probe) return XRAY_CTX._probe;
    if (typeof SB === 'undefined' || !SB || !SB.from) return Promise.resolve(XRAY_CTX.ok);
    XRAY_CTX._probe = Promise.resolve(SB.from('xrays').select(XRAY_CTX_KEYS.join(',')).limit(1)).then(function (r) {
        if (r && !r.error) xrayCtxSetOk(true);
        else if (r && xrayCtxIsMissingColErr(r.error)) xrayCtxSetOk(false);
        else XRAY_CTX._probe = null;
        return XRAY_CTX.ok;
    }, function () {
        XRAY_CTX._probe = null;
        return XRAY_CTX.ok;
    });
    return XRAY_CTX._probe;
}

/** Records come from select('*'), so their keys already tell whether the columns exist. */
function xrayCtxSync() {
    var rows = (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) ? xrayAllRecords : [];
    if (rows.length) {
        xrayCtxSetOk(Object.prototype.hasOwnProperty.call(rows[0], 'review_status'));
    } else if (XRAY_CTX.ok == null) {
        xrayCtxProbe();
    }
    if (XRAY_CTX.ok === true) xrayCtxPrefetchVisits(rows);
}

/* ── visits (appointments) ───────────────────────────────── */

function xrayCtxAppts(pid, force) {
    if (!pid || typeof SB === 'undefined' || !SB || !SB.from) return Promise.resolve([]);
    var c = XRAY_CTX.appts[pid];
    if (!force && c && Date.now() - c.at < 60000) return Promise.resolve(c.rows);
    if (!force && XRAY_CTX.inflight[pid]) return XRAY_CTX.inflight[pid];
    var p = Promise.resolve(
        SB.from('appointments')
            .select('id,date,start_time,dentist_name,doctor_code,treatment_items')
            .eq('patient_id', pid)
            .order('date', { ascending: false })
            .limit(60)
    ).then(function (r) {
        var rows = (r && !r.error && Array.isArray(r.data)) ? r.data : [];
        XRAY_CTX.appts[pid] = { at: Date.now(), rows: rows };
        return rows;
    }, function () {
        XRAY_CTX.appts[pid] = { at: Date.now(), rows: [] };
        return [];
    });
    XRAY_CTX.inflight[pid] = p;
    var clear = function () { if (XRAY_CTX.inflight[pid] === p) delete XRAY_CTX.inflight[pid]; };
    p.then(clear, clear);
    return p;
}

function xrayCtxApptLabel(a) {
    if (!a) return '';
    var head = String(a.date || '');
    if (a.start_time) head += ' ' + String(a.start_time).slice(0, 5);
    var bits = [head];
    var who = a.dentist_name || a.doctor_code || '';
    if (who) bits.push(who);
    if (typeof a.treatment_items === 'string' && a.treatment_items.trim()) {
        var ti = a.treatment_items.trim();
        bits.push(ti.length > 26 ? ti.slice(0, 25) + '…' : ti);
    }
    return bits.join(' · ');
}

function xrayCtxApptFor(pid, id) {
    var c = XRAY_CTX.appts[pid];
    if (!c || !id) return null;
    for (var i = 0; i < c.rows.length; i++) {
        if (String(c.rows[i].id) === String(id)) return c.rows[i];
    }
    return null;
}

function xrayCtxApptIdOnDate(rows, date) {
    for (var i = 0; i < (rows || []).length; i++) {
        if (rows[i].date === date) return rows[i].id;
    }
    return '';
}

function xrayCtxFillApptSelect(selId, pid, selected, preferDate) {
    var sel = xrayCtxEl(selId);
    if (!sel) return Promise.resolve();
    var stamp = String(Date.now()) + ':' + Math.random();
    sel.dataset.xcStamp = stamp;
    sel.dataset.xcLoaded = '';
    sel.dataset.xcManual = '';
    var none = '<option value="">' + xrayCtxEsc(xrayCtxTr('xc.visitNone')) + '</option>';
    if (!pid) {
        sel.innerHTML = none;
        sel.dataset.xcLoaded = '1';
        return Promise.resolve();
    }
    return xrayCtxAppts(pid).then(function (rows) {
        if (sel.dataset.xcStamp !== stamp) return;
        var today = xrayCtxToday();
        var html = none;
        var present = false;
        rows.forEach(function (a) {
            if (selected && String(a.id) === String(selected)) present = true;
            html += '<option value="' + xrayCtxEsc(a.id) + '">' +
                (a.date === today ? xrayCtxEsc(xrayCtxTr('xc.visitToday')) + ' · ' : '') +
                xrayCtxEsc(xrayCtxApptLabel(a)) + '</option>';
        });
        if (selected && !present) {
            html += '<option value="' + xrayCtxEsc(selected) + '">' + xrayCtxEsc(xrayCtxTr('xc.visitOther')) + '</option>';
        }
        sel.innerHTML = html;
        sel.value = selected || (preferDate ? xrayCtxApptIdOnDate(rows, preferDate) : '') || '';
        sel.dataset.xcLoaded = '1';
    });
}

/** Load the visits of every chart that has linked films, then redraw once so the badges can show dates. */
function xrayCtxPrefetchVisits(rows) {
    var need = {};
    (rows || []).forEach(function (x) {
        if (x.appointment_id && x.patient_id && !XRAY_CTX.appts[x.patient_id]) need[x.patient_id] = true;
    });
    var ids = Object.keys(need);
    if (!ids.length) return;
    Promise.all(ids.map(function (pid) { return xrayCtxAppts(pid); })).then(function () {
        if (typeof filterXrays === 'function') filterXrays(true);
    });
}

/* ── teeth ───────────────────────────────────────────────── */

function xrayCtxParseTeeth(raw) {
    var seen = {};
    var out = [];
    String(raw || '').split(/[\s,;，、]+/).forEach(function (tok) {
        var v = tok.trim().toUpperCase();
        if (!v || !/^([1-8][1-8]|UR|UL|LR|LL|ALL)$/.test(v) || seen[v]) return;
        seen[v] = 1;
        out.push(v);
    });
    return out;
}

function xrayCtxTeethText(arr) {
    return Array.isArray(arr) ? arr.join(', ') : '';
}

var XRAY_CTX_CHART = [
    [['18', '17', '16', '15', '14', '13', '12', '11'], ['21', '22', '23', '24', '25', '26', '27', '28']],
    [['48', '47', '46', '45', '44', '43', '42', '41'], ['31', '32', '33', '34', '35', '36', '37', '38']]
];

function xrayCtxPickerEl() {
    var p = xrayCtxEl('xrayTeethPicker');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'xrayTeethPicker';
    p.className = 'xray-teeth-picker';
    p.hidden = true;
    document.body.appendChild(p);
    document.addEventListener('mousedown', function (ev) {
        if (p.hidden) return;
        if (p.contains(ev.target)) return;
        if (ev.target && ev.target.closest && ev.target.closest('[data-xc-pick]')) return;
        xrayCtxCloseTeethPicker();
    });
    document.addEventListener('keydown', function (ev) {
        if (!p.hidden && ev.key === 'Escape') xrayCtxCloseTeethPicker();
    });
    return p;
}

function xrayCtxCloseTeethPicker() {
    var p = xrayCtxEl('xrayTeethPicker');
    if (p) { p.hidden = true; p.dataset.target = ''; }
}

function xrayCtxPaintPicker() {
    var p = xrayCtxEl('xrayTeethPicker');
    if (!p || p.hidden) return;
    var input = xrayCtxEl(p.dataset.target);
    var on = {};
    xrayCtxParseTeeth(input ? input.value : '').forEach(function (v) { on[v] = true; });
    p.querySelectorAll('[data-t]').forEach(function (b) {
        b.classList.toggle('is-on', !!on[b.getAttribute('data-t')]);
    });
}

function xrayCtxToggleTooth(code) {
    var p = xrayCtxEl('xrayTeethPicker');
    var input = p ? xrayCtxEl(p.dataset.target) : null;
    if (!input || input.disabled) return;
    var list = xrayCtxParseTeeth(input.value);
    var i = list.indexOf(code);
    if (i >= 0) list.splice(i, 1); else list.push(code);
    input.value = list.join(', ');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    xrayCtxPaintPicker();
}

function xrayCtxClearTeeth() {
    var p = xrayCtxEl('xrayTeethPicker');
    var input = p ? xrayCtxEl(p.dataset.target) : null;
    if (!input || input.disabled) return;
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    xrayCtxPaintPicker();
}

function xrayCtxToggleTeethPicker(inputId, btn) {
    var input = xrayCtxEl(inputId);
    if (!input || input.disabled) return;
    var p = xrayCtxPickerEl();
    if (!p.hidden && p.dataset.target === inputId) { xrayCtxCloseTeethPicker(); return; }
    var html = '<div class="xtp-title">' + xrayCtxEsc(xrayCtxTr('xc.teethPick')) + '</div>';
    XRAY_CTX_CHART.forEach(function (row, ri) {
        html += '<div class="xtp-row' + (ri === 1 ? ' xtp-row--lower' : '') + '">';
        row.forEach(function (half, hi) {
            html += '<div class="xtp-half' + (hi === 0 ? ' xtp-half--right' : '') + '">';
            half.forEach(function (c) {
                html += '<button type="button" class="xtp-tooth" data-t="' + c + '">' + c + '</button>';
            });
            html += '</div>';
        });
        html += '</div>';
    });
    html += '<div class="xtp-actions"><button type="button" class="xtp-clear">' + xrayCtxEsc(xrayCtxTr('xc.teethClear')) +
        '</button><button type="button" class="xtp-done">' + xrayCtxEsc(xrayCtxTr('xc.teethDone')) + '</button></div>';
    p.innerHTML = html;
    p.dataset.target = inputId;
    p.querySelectorAll('.xtp-tooth').forEach(function (b) {
        b.addEventListener('click', function () { xrayCtxToggleTooth(b.getAttribute('data-t')); });
    });
    p.querySelector('.xtp-clear').addEventListener('click', xrayCtxClearTeeth);
    p.querySelector('.xtp-done').addEventListener('click', xrayCtxCloseTeethPicker);
    p.hidden = false;
    xrayCtxPaintPicker();
    var r = (btn || input).getBoundingClientRect();
    var w = p.offsetWidth || 360;
    var h = p.offsetHeight || 200;
    var left = Math.max(8, Math.min(r.left, (window.innerWidth || 1200) - w - 8));
    var top = r.bottom + 6;
    if (top + h > (window.innerHeight || 800) - 8) top = Math.max(8, r.top - h - 6);
    p.style.left = left + 'px';
    p.style.top = top + 'px';
}

/* ── upload modal fields ─────────────────────────────────── */

function xrayCtxUploadPid() {
    try {
        if (typeof xrayResolveUploadPatient === 'function') {
            var tg = xrayResolveUploadPatient();
            if (tg && tg.ok && tg.id) return tg.id;
        }
    } catch (e) { /* fall through */ }
    return (typeof xrayPatientId !== 'undefined') ? xrayPatientId : null;
}

function xrayCtxFillUpload(file) {
    var date = (xrayCtxEl('uploadDate') && xrayCtxEl('uploadDate').value) || xrayCtxToday();
    var teeth = xrayCtxEl('uploadTeeth');
    if (teeth) teeth.value = xrayCtxTeethText(file && file.xhTeeth ? file.xhTeeth : []);
    xrayCtxCloseTeethPicker();
    xrayCtxProbe().then(function () {
        xrayCtxApplyVisibility();
        if (XRAY_CTX.ok === true) xrayCtxFillApptSelect('uploadAppt', xrayCtxUploadPid(), '', date);
    });
}

function xrayCtxReadUpload() {
    if (XRAY_CTX.ok !== true) return null;
    var sel = xrayCtxEl('uploadAppt');
    var teeth = xrayCtxEl('uploadTeeth');
    var appt = sel && sel.dataset.xcLoaded === '1' && sel.value ? sel.value : null;
    return {
        appointment_id: appt,
        teeth: xrayCtxParseTeeth(teeth ? teeth.value : ''),
        review_status: 'new'
    };
}

/** Context to store with a film. Explicit picks win; uploads from the helpers link to the visit on the same date. */
function xrayCtxResolve(ctx, pid, date) {
    return xrayCtxProbe().then(function () {
        if (XRAY_CTX.ok === false) return {};
        if (ctx) return ctx;
        if (XRAY_CTX.ok !== true || !pid || !date) return {};
        return xrayCtxAppts(pid).then(function (rows) {
            var id = xrayCtxApptIdOnDate(rows, String(date).slice(0, 10));
            return id ? { appointment_id: id } : {};
        });
    });
}

function xrayCtxInsert(row, ctx, pid, date) {
    return xrayCtxResolve(ctx, pid, date).then(function (c) {
        var body = {};
        Object.keys(row).forEach(function (k) { body[k] = row[k]; });
        Object.keys(c || {}).forEach(function (k) { body[k] = c[k]; });
        return xrayCtxWrite(function (b) { return SB.from('xrays').insert([b]); }, body);
    });
}

function xrayCtxUpdate(id, payload) {
    return xrayCtxWrite(function (b) { return SB.from('xrays').update(b).eq('id', id); }, payload);
}

/* ── lightbox fields ─────────────────────────────────────── */

function xrayCtxRecord(id) {
    var rows = (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) ? xrayAllRecords : [];
    for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].id) === String(id)) return rows[i];
    }
    return null;
}

function xrayCtxFillLightbox(x) {
    if (!x) return;
    var home = true;
    try { home = typeof xrayIsHomeRecord === 'function' ? !!xrayIsHomeRecord(x) : true; } catch (e) { home = true; }
    var teeth = xrayCtxEl('lbTeeth');
    var review = xrayCtxEl('lbReviewStatus');
    var info = xrayCtxEl('lbReviewInfo');
    var pick = xrayCtxEl('lbTeethPick');
    xrayCtxCloseTeethPicker();
    if (teeth) { teeth.value = xrayCtxTeethText(x.teeth); teeth.disabled = !home; }
    if (pick) pick.disabled = !home;
    if (review) { review.value = x.review_status === 'reviewed' ? 'reviewed' : 'new'; review.disabled = !home; }
    if (info) {
        if (x.review_status === 'reviewed' && (x.reviewed_by || x.reviewed_at)) {
            var d = x.reviewed_at ? String(x.reviewed_at).slice(0, 10) : '';
            info.textContent = xrayCtxTr('xc.reviewedBy').split('{NAME}').join(x.reviewed_by || '—').split('{DATE}').join(d);
            info.hidden = false;
        } else {
            info.textContent = '';
            info.hidden = true;
        }
    }
    var appt = xrayCtxEl('lbAppt');
    if (appt) {
        xrayCtxFillApptSelect('lbAppt', x.patient_id, x.appointment_id || '', '').then(function () {
            appt.disabled = !home;
        });
        appt.disabled = true;
    }
    xrayCtxProbe().then(function () { xrayCtxApplyVisibility(); });
}

/** Fields of the open film to save with its other details; {} while the columns are off. */
function xrayCtxReadLightbox() {
    if (XRAY_CTX.ok !== true) return {};
    var rec = (typeof lbCurrentId !== 'undefined' && lbCurrentId) ? xrayCtxRecord(lbCurrentId) : null;
    var appt = xrayCtxEl('lbAppt');
    var teeth = xrayCtxEl('lbTeeth');
    var review = xrayCtxEl('lbReviewStatus');
    var out = {};
    if (appt && appt.dataset.xcLoaded === '1') out.appointment_id = appt.value || null;
    if (teeth) out.teeth = xrayCtxParseTeeth(teeth.value);
    if (review) {
        out.review_status = review.value === 'reviewed' ? 'reviewed' : 'new';
        var was = rec && rec.review_status === 'reviewed';
        if (out.review_status === 'reviewed' && !was) {
            out.reviewed_by = (typeof currentName !== 'undefined' && currentName) ? currentName : null;
            out.reviewed_at = new Date().toISOString();
        } else if (out.review_status === 'new' && was) {
            out.reviewed_by = null;
            out.reviewed_at = null;
        }
    }
    return out;
}

/* ── badges ──────────────────────────────────────────────── */

function xrayCtxBadgesHtml(x) {
    if (XRAY_CTX.ok !== true || !x) return '';
    var bits = [];
    var teeth = Array.isArray(x.teeth) ? x.teeth : [];
    if (teeth.length) {
        bits.push('<span class="xray-ctx-badge xray-ctx-badge--tooth" title="' + xrayCtxEsc(teeth.join(', ')) + '">🦷 ' +
            xrayCtxEsc(teeth.slice(0, 4).join(', ')) + (teeth.length > 4 ? ' +' + (teeth.length - 4) : '') + '</span>');
    }
    if (x.appointment_id) {
        var a = xrayCtxApptFor(x.patient_id, x.appointment_id);
        bits.push('<span class="xray-ctx-badge xray-ctx-badge--visit">📅 ' +
            xrayCtxEsc(a && a.date ? a.date : xrayCtxTr('xc.visitBadge')) + '</span>');
    }
    if (x.review_status === 'reviewed') {
        bits.push('<span class="xray-ctx-badge xray-ctx-badge--ok">✔ ' + xrayCtxEsc(xrayCtxTr('xc.statusReviewed')) + '</span>');
    }
    return bits.length ? '<span class="xray-ctx-badges">' + bits.join('') + '</span>' : '';
}

function xrayCtxPaintSlide(x) {
    var host = xrayCtxEl('xraySlideCtx');
    if (!host) return;
    var html = xrayCtxBadgesHtml(x);
    host.innerHTML = html;
    host.classList.toggle('is-empty', !html);
}

/* ── filters ─────────────────────────────────────────────── */

function xrayCtxFilter(x) {
    if (XRAY_CTX.ok !== true) return true;
    if (XRAY_CTX.revFilter) {
        var st = x.review_status === 'reviewed' ? 'reviewed' : 'new';
        if (st !== XRAY_CTX.revFilter) return false;
    }
    if (XRAY_CTX.toothBad) return false;
    if (XRAY_CTX.toothFilter.length) {
        var teeth = Array.isArray(x.teeth) ? x.teeth : [];
        if (teeth.indexOf('ALL') >= 0) return true;
        var hit = XRAY_CTX.toothFilter.some(function (c) { return teeth.indexOf(c) >= 0; });
        if (!hit) return false;
    }
    return true;
}

/** "This visit" = the film belongs to today's appointment, or (not linked) was taken today. */
function xrayCtxMatchesVisit(x, d, today) {
    if (XRAY_CTX.ok === true && x && x.appointment_id) {
        var a = xrayCtxApptFor(x.patient_id, x.appointment_id);
        if (a) return a.date === today;
    }
    return d === today;
}

function xrayCtxSetRev(v) {
    XRAY_CTX.revFilter = v === 'new' || v === 'reviewed' ? v : '';
    var host = xrayCtxEl('xrayCtxRevChips');
    if (host) {
        host.querySelectorAll('[data-rev]').forEach(function (b) {
            b.classList.toggle('active', (b.getAttribute('data-rev') || '') === XRAY_CTX.revFilter);
        });
    }
    if (typeof filterXrays === 'function') filterXrays();
}

function xrayCtxOnToothInput() {
    var el = xrayCtxEl('xrayFilterTooth');
    var raw = el ? el.value : '';
    XRAY_CTX.toothFilter = xrayCtxParseTeeth(raw);
    XRAY_CTX.toothBad = !XRAY_CTX.toothFilter.length && /\S/.test(raw);
    if (typeof filterXrays === 'function') filterXrays();
}

/* ── wiring ──────────────────────────────────────────────── */

(function () {
    function wire() {
        xrayCtxApplyVisibility();
        var ud = xrayCtxEl('uploadDate');
        if (ud && !ud._xcBound) {
            ud._xcBound = true;
            ud.addEventListener('change', function () {
                var sel = xrayCtxEl('uploadAppt');
                if (!sel || sel.dataset.xcManual === '1' || sel.dataset.xcLoaded !== '1') return;
                var c = XRAY_CTX.appts[xrayCtxUploadPid()];
                sel.value = xrayCtxApptIdOnDate(c ? c.rows : [], ud.value) || '';
            });
        }
        var ua = xrayCtxEl('uploadAppt');
        if (ua && !ua._xcBound) {
            ua._xcBound = true;
            ua.addEventListener('change', function () { ua.dataset.xcManual = '1'; });
        }
        ['lbAppt', 'lbTeeth', 'lbReviewStatus'].forEach(function (id) {
            var el = xrayCtxEl(id);
            if (!el || el._xcBound) return;
            el._xcBound = true;
            var mark = function () { try { _lbMetaDirty = true; } catch (e) { /* ignore */ } };
            el.addEventListener('input', mark);
            el.addEventListener('change', mark);
        });
    }
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
        else wire();
    }
})();
