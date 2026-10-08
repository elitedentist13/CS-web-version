/* =========================================================
   app-xray-viewer.js - Consultation X-ray viewer tools (no DICOM).
   - calibrated measurements (length, angle, bone level) kept as an
     editable vector layer saved with the film (xrays.measurements)
   - synced-zoom compare and a per-tooth timeline
   - FMX / bitewing mount with the slots that are still missing
   - keyboard shortcuts for the lightbox
   Loads after app-xray-wire.js.
   ========================================================= */

(function () {
    var MORE = {
        'xv.measure': { en: 'Measure', 'zh-CN': '测量', 'zh-Hant': '測量' },
        'xv.mLength': { en: 'Length (M)', 'zh-CN': '长度 (M)', 'zh-Hant': '長度 (M)' },
        'xv.mAngle': { en: 'Angle (A)', 'zh-CN': '角度 (A)', 'zh-Hant': '角度 (A)' },
        'xv.mBone': { en: 'Bone level: CEJ, bone crest, root apex (B)', 'zh-CN': '骨水平：釉牙骨质界、牙槽嵴顶、根尖 (B)', 'zh-Hant': '骨水平：琺瑯質牙骨質交界、牙槽嵴頂、根尖 (B)' },
        'xv.mCal': { en: 'Calibrate: two points of a known length (C)', 'zh-CN': '校准：点击已知长度的两点 (C)', 'zh-Hant': '校準：點選已知長度的兩點 (C)' },
        'xv.knownPh': { en: 'mm', 'zh-CN': '毫米', 'zh-Hant': '毫米' },
        'xv.knownTitle': { en: 'Known length in mm (used by Calibrate)', 'zh-CN': '已知长度（毫米，用于校准）', 'zh-Hant': '已知長度（毫米，用於校準）' },
        'xv.clear': { en: 'Clear all measurements', 'zh-CN': '清除全部测量', 'zh-Hant': '清除全部測量' },
        'xv.clearAsk': { en: 'Remove all measurements and the calibration of this film?', 'zh-CN': '移除此片的全部测量与校准？', 'zh-Hant': '移除此片的全部測量與校準？' },
        'xv.step.length': { en: 'Length: click 2 points', 'zh-CN': '长度：点击 2 个点', 'zh-Hant': '長度：點選 2 個點' },
        'xv.step.angle': { en: 'Angle: click 3 points (vertex second)', 'zh-CN': '角度：点击 3 个点（顶点为第二点）', 'zh-Hant': '角度：點選 3 個點（頂點為第二點）' },
        'xv.step.bone': { en: 'Bone level: click CEJ, bone crest, root apex', 'zh-CN': '骨水平：依次点击釉牙骨质界、牙槽嵴顶、根尖', 'zh-Hant': '骨水平：依序點選琺瑯質牙骨質交界、牙槽嵴頂、根尖' },
        'xv.step.cal': { en: 'Calibrate: click 2 points of the known length', 'zh-CN': '校准：点击已知长度的 2 个点', 'zh-Hant': '校準：點選已知長度的 2 個點' },
        'xv.need': { en: 'Enter the known length in mm first.', 'zh-CN': '请先输入已知长度（毫米）。', 'zh-Hant': '請先輸入已知長度（毫米）。' },
        'xv.cal': { en: 'Calibrated: 1 px = {MM} mm', 'zh-CN': '已校准：1 像素 = {MM} 毫米', 'zh-Hant': '已校準：1 像素 = {MM} 毫米' },
        'xv.uncal': { en: 'Not calibrated - lengths in px', 'zh-CN': '未校准 - 长度以像素显示', 'zh-Hant': '未校準 - 長度以像素顯示' },
        'xv.itemLength': { en: 'Length', 'zh-CN': '长度', 'zh-Hant': '長度' },
        'xv.itemAngle': { en: 'Angle', 'zh-CN': '角度', 'zh-Hant': '角度' },
        'xv.itemBone': { en: 'Bone level', 'zh-CN': '骨水平', 'zh-Hant': '骨水平' },
        'xv.noStore': { en: 'Not saved: run xray_context.sql to keep measurements.', 'zh-CN': '未保存：请运行 xray_context.sql 以保留测量。', 'zh-Hant': '未儲存：請執行 xray_context.sql 以保留測量。' },
        'xv.saveFail': { en: 'Could not save the measurements.', 'zh-CN': '无法保存测量。', 'zh-Hant': '無法儲存測量。' },
        'xv.cropClears': { en: 'Measurements were removed because the image changed.', 'zh-CN': '图像已更改，测量已移除。', 'zh-Hant': '影像已更改，測量已移除。' },
        'xv.readonly': { en: 'View only: this film belongs to another clinic.', 'zh-CN': '仅可查看：此片属于其他诊所。', 'zh-Hant': '僅可檢視：此片屬於其他診所。' },
        'xv.shortcuts': { en: 'Keys: M length · A angle · B bone · C calibrate · Del remove · Esc stop · +/− zoom · 0 reset · R rotate · I invert · H/V flip · [ ] brightness · F maximise · ←/→ film', 'zh-CN': '快捷键：M 长度 · A 角度 · B 骨水平 · C 校准 · Del 删除 · Esc 停止 · +/− 缩放 · 0 复位 · R 旋转 · I 反相 · H/V 翻转 · [ ] 亮度 · F 最大化 · ←/→ 切换', 'zh-Hant': '快速鍵：M 長度 · A 角度 · B 骨水平 · C 校準 · Del 刪除 · Esc 停止 · +/− 縮放 · 0 重設 · R 旋轉 · I 反相 · H/V 翻轉 · [ ] 亮度 · F 最大化 · ←/→ 切換' },
        'xv.toothTl': { en: 'Tooth timeline', 'zh-CN': '牙位时间线', 'zh-Hant': '牙位時間線' },
        'xv.toothTlHint': { en: 'Compare this film with the earlier film of the same tooth', 'zh-CN': '与同一牙位的较早影像对比', 'zh-Hant': '與同一牙位的較早影像對比' },
        'xv.noOther': { en: 'No other film of this tooth to compare.', 'zh-CN': '没有该牙位的其他影像可对比。', 'zh-Hant': '沒有該牙位的其他影像可對比。' },
        'xv.cmpSync': { en: 'Sync zoom & pan', 'zh-CN': '同步缩放与平移', 'zh-Hant': '同步縮放與平移' },
        'xv.cmpReset': { en: 'Reset', 'zh-CN': '复位', 'zh-Hant': '重設' },
        'xv.cmpSwap': { en: 'Swap', 'zh-CN': '对调', 'zh-Hant': '對調' },
        'xv.cmpScopeTooth': { en: 'Films of this tooth', 'zh-CN': '此牙位的影像', 'zh-Hant': '此牙位的影像' },
        'xv.cmpScopeAll': { en: 'All films', 'zh-CN': '全部影像', 'zh-Hant': '全部影像' },
        'xv.mount': { en: 'FMX / BW mount', 'zh-CN': 'FMX / 咬合翼', 'zh-Hant': 'FMX / 咬翼' },
        'xv.mountTitle': { en: 'Full-mouth series / bitewing mount', 'zh-CN': '全口系列 / 咬合翼排版', 'zh-Hant': '全口系列 / 咬翼排版' },
        'xv.layoutFmx': { en: 'FMX (18 films)', 'zh-CN': 'FMX（18 张）', 'zh-Hant': 'FMX（18 張）' },
        'xv.layoutBw': { en: 'Bitewings (4 films)', 'zh-CN': '咬合翼（4 张）', 'zh-Hant': '咬翼（4 張）' },
        'xv.rowUpper': { en: 'Upper periapicals', 'zh-CN': '上颌根尖片', 'zh-Hant': '上顎根尖片' },
        'xv.rowLower': { en: 'Lower periapicals', 'zh-CN': '下颌根尖片', 'zh-Hant': '下顎根尖片' },
        'xv.rowBw': { en: 'Bitewings', 'zh-CN': '咬合翼', 'zh-Hant': '咬翼' },
        'xv.s.molarR': { en: 'R molar', 'zh-CN': '右磨牙', 'zh-Hant': '右大臼齒' },
        'xv.s.premR': { en: 'R premolar', 'zh-CN': '右前磨牙', 'zh-Hant': '右小臼齒' },
        'xv.s.canR': { en: 'R canine', 'zh-CN': '右尖牙', 'zh-Hant': '右犬齒' },
        'xv.s.inc': { en: 'Incisors', 'zh-CN': '切牙', 'zh-Hant': '門齒' },
        'xv.s.canL': { en: 'L canine', 'zh-CN': '左尖牙', 'zh-Hant': '左犬齒' },
        'xv.s.premL': { en: 'L premolar', 'zh-CN': '左前磨牙', 'zh-Hant': '左小臼齒' },
        'xv.s.molarL': { en: 'L molar', 'zh-CN': '左磨牙', 'zh-Hant': '左大臼齒' },
        'xv.mountDone': { en: '{N} of {M} slots filled', 'zh-CN': '已填 {N} / {M} 个位置', 'zh-Hant': '已填 {N} / {M} 個位置' },
        'xv.mountMissing': { en: 'Missing: {LIST}', 'zh-CN': '缺少：{LIST}', 'zh-Hant': '缺少：{LIST}' },
        'xv.mountComplete': { en: 'Complete', 'zh-CN': '已齐全', 'zh-Hant': '已齊全' },
        'xv.mountEmpty': { en: 'No film', 'zh-CN': '无影像', 'zh-Hant': '無影像' },
        'xv.mountNeedCtx': { en: 'The mount needs the teeth field: run xray_context.sql in Supabase.', 'zh-CN': '排版需要牙位字段：请在 Supabase 运行 xray_context.sql。', 'zh-Hant': '排版需要牙位欄位：請在 Supabase 執行 xray_context.sql。' },
        'xv.mountDrag': { en: 'Drag a film onto a slot', 'zh-CN': '把影像拖到位置上', 'zh-Hant': '把影像拖到位置上' },
        'xv.mountNoFilms': { en: 'No film of this kind to drag.', 'zh-CN': '没有可拖动的这类影像。', 'zh-Hant': '沒有可拖動的這類影像。' },
        'xv.mountAssignFail': { en: 'Could not place the film in that slot.', 'zh-CN': '无法把影像放到该位置。', 'zh-Hant': '無法把影像放到該位置。' },
        'xv.mountUpdated': { en: 'Updated {WHEN}', 'zh-CN': '更新于 {WHEN}', 'zh-Hant': '更新於 {WHEN}' }
    };
    if (typeof I18N_STRINGS !== 'undefined') {
        Object.keys(MORE).forEach(function (k) { I18N_STRINGS[k] = MORE[k]; });
    }
})();

function xvTr(key, repl) {
    var s = (typeof t === 'function') ? t(key) : key;
    Object.keys(repl || {}).forEach(function (k) { s = String(s).split('{' + k + '}').join(repl[k]); });
    return s;
}

function xvEsc(s) {
    if (typeof esc === 'function') return esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function xvEl(id) {
    return (typeof document !== 'undefined') ? document.getElementById(id) : null;
}

function xvToast(msg, kind) {
    if (typeof showAppGlobalToast === 'function') showAppGlobalToast(msg, { kind: kind || 'info' });
}

function xvHomeFilms() {
    var rows = (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) ? xrayAllRecords : [];
    return rows.filter(function (x) { return x && x._isHome !== false; });
}

function xvFilmDay(x) {
    return String((x && (x.taken_date || x.created_at)) || '').slice(0, 10);
}

function xvSortFilms(list) {
    return list.slice().sort(function (a, b) {
        var da = xvFilmDay(a), db = xvFilmDay(b);
        if (da !== db) return da < db ? -1 : 1;
        var ca = String(a.created_at || ''), cb = String(b.created_at || '');
        return ca < cb ? -1 : (ca > cb ? 1 : 0);
    });
}

function xvExplicitTeeth(x) {
    return (Array.isArray(x && x.teeth) ? x.teeth : []).filter(function (c) { return /^[1-8][1-8]$/.test(c); });
}

function xvFilmLabel(x) {
    var type = typeof xrayTypeLabel === 'function' ? xrayTypeLabel(x.xray_type) : (x.xray_type || '');
    var teeth = xvExplicitTeeth(x);
    return [xvFilmDay(x), type, teeth.length ? teeth.join(' ') : ''].filter(Boolean).join(' · ');
}

/* ══════════════════════════════════════════════════════════
   MEASUREMENTS
   Points are kept in the natural pixels of the film, so they
   follow zoom / rotate / flip and survive a reload.
   ══════════════════════════════════════════════════════════ */

var XRAY_MEAS = {
    tool: '',
    pending: [],
    hover: null,
    rec: null,
    data: { cal: null, items: [] },
    sel: '',
    drag: null,
    mem: {},
    nextId: 1,
    saveTimer: null,
    dirty: false,
    off: false
};

var XRAY_MEAS_NEED = { length: 2, angle: 3, bone: 3, cal: 2 };
var XRAY_MEAS_COLOR = { length: '#facc15', angle: '#c084fc', bone: '#34d399', cal: '#38bdf8' };

function xrayMeasDist(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function xrayMeasCleanPoint(p) {
    return Array.isArray(p) && p.length === 2 && isFinite(p[0]) && isFinite(p[1]) ? [Number(p[0]), Number(p[1])] : null;
}

function xrayMeasClean(raw) {
    var out = { cal: null, items: [] };
    if (!raw || typeof raw !== 'object') return out;
    if (raw.cal && raw.cal.mmPerPx > 0 && isFinite(raw.cal.mmPerPx)) {
        out.cal = { mmPerPx: Number(raw.cal.mmPerPx), knownMm: Number(raw.cal.knownMm) || 0, pts: [], source: raw.cal.source || '' };
        var cp = (Array.isArray(raw.cal.pts) ? raw.cal.pts : []).map(xrayMeasCleanPoint);
        if (cp.length === 2 && cp[0] && cp[1]) out.cal.pts = cp;
    }
    (Array.isArray(raw.items) ? raw.items : []).forEach(function (it) {
        if (!it || !XRAY_MEAS_NEED[it.type] || it.type === 'cal') return;
        var pts = (Array.isArray(it.pts) ? it.pts : []).map(xrayMeasCleanPoint);
        if (pts.length !== XRAY_MEAS_NEED[it.type] || pts.some(function (p) { return !p; })) return;
        out.items.push({ id: String(it.id || ('m' + (XRAY_MEAS.nextId++))), type: it.type, pts: pts });
    });
    return out;
}

function xrayMeasPayload() {
    var d = XRAY_MEAS.data;
    if (!d.items.length && !d.cal) return null;
    return JSON.parse(JSON.stringify({ v: 1, cal: d.cal, items: d.items }));
}

function xrayMeasValues(it) {
    var cal = XRAY_MEAS.data.cal;
    var k = cal ? cal.mmPerPx : null;
    if (it.type === 'length') {
        var px = xrayMeasDist(it.pts[0], it.pts[1]);
        return { px: px, mm: k ? px * k : null };
    }
    if (it.type === 'angle') {
        var a = it.pts[0], v = it.pts[1], c = it.pts[2];
        var ux = a[0] - v[0], uy = a[1] - v[1], wx = c[0] - v[0], wy = c[1] - v[1];
        var lu = Math.hypot(ux, uy), lw = Math.hypot(wx, wy);
        var cos = lu && lw ? (ux * wx + uy * wy) / (lu * lw) : 1;
        return { deg: Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI };
    }
    var loss = xrayMeasDist(it.pts[0], it.pts[1]);
    var root = xrayMeasDist(it.pts[0], it.pts[2]);
    return { lossPx: loss, rootPx: root, lossMm: k ? loss * k : null, rootMm: k ? root * k : null, pct: root > 0 ? loss / root * 100 : null };
}

function xrayMeasText(it) {
    var v = xrayMeasValues(it);
    if (it.type === 'length') return v.mm != null ? v.mm.toFixed(1) + ' mm' : Math.round(v.px) + ' px';
    if (it.type === 'angle') return v.deg.toFixed(1) + '°';
    var pct = v.pct != null ? Math.round(v.pct) + '%' : '';
    if (v.lossMm != null) return v.lossMm.toFixed(1) + ' / ' + v.rootMm.toFixed(1) + ' mm · ' + pct;
    return Math.round(v.lossPx) + ' / ' + Math.round(v.rootPx) + ' px · ' + pct;
}

function xrayMeasTypeName(type) {
    return xvTr(type === 'angle' ? 'xv.itemAngle' : (type === 'bone' ? 'xv.itemBone' : 'xv.itemLength'));
}

function xrayMeasStorable(rec) {
    return !!rec && Object.prototype.hasOwnProperty.call(rec, 'measurements') && !XRAY_MEAS.off;
}

function xrayMeasReadonly() {
    var rec = XRAY_MEAS.rec;
    if (!rec) return true;
    try { return typeof xrayIsHomeRecord === 'function' ? !xrayIsHomeRecord(rec) : false; } catch (e) { return false; }
}

function xrayMeasNatural() {
    var img = xvEl('xrayLbImg');
    return { w: (img && img.naturalWidth) || 0, h: (img && img.naturalHeight) || 0 };
}

function xrayMeasUnit(nat) {
    var base = (typeof lbLayoutBaseW === 'number' && lbLayoutBaseW > 0) ? lbLayoutBaseW : ((xvEl('xrayLbImg') || {}).offsetWidth || 1);
    var z = (typeof lbTransform === 'object' && lbTransform && lbTransform.scale) ? lbTransform.scale : 1;
    return nat.w / (base * z);
}

function xrayMeasUpright(x, y) {
    var t = (typeof lbTransform === 'object' && lbTransform) ? lbTransform : { rotate: 0, flipH: false, flipV: false };
    return 'translate(' + x.toFixed(2) + ' ' + y.toFixed(2) + ') rotate(' + (-(t.rotate || 0)) + ') scale(' + (t.flipH ? -1 : 1) + ' ' + (t.flipV ? -1 : 1) + ')';
}

function xrayMeasLabel(x, y, text, color, u) {
    return '<text transform="' + xrayMeasUpright(x, y) + '" x="' + (9 * u).toFixed(2) + '" y="' + (-9 * u).toFixed(2) + '" fill="' + color +
        '" font-size="' + (13 * u).toFixed(2) + '" font-weight="700" font-family="Segoe UI, Arial, sans-serif" stroke="#0f172a" stroke-width="' + (3 * u).toFixed(2) +
        '" paint-order="stroke" stroke-linejoin="round" pointer-events="none">' + xvEsc(text) + '</text>';
}

function xrayMeasRender() {
    var svg = xvEl('xrayLbMeasure');
    if (!svg) return;
    var nat = xrayMeasNatural();
    if (!nat.w || !nat.h) { svg.innerHTML = ''; xrayMeasRenderPanel(); return; }
    svg.setAttribute('viewBox', '0 0 ' + nat.w + ' ' + nat.h);
    svg.classList.toggle('is-active', !!XRAY_MEAS.tool && !xrayMeasReadonly());
    var u = xrayMeasUnit(nat);
    var html = '';
    function line(a, b, color, w, dash) {
        return '<line x1="' + a[0].toFixed(2) + '" y1="' + a[1].toFixed(2) + '" x2="' + b[0].toFixed(2) + '" y2="' + b[1].toFixed(2) +
            '" stroke="' + color + '" stroke-width="' + (w * u).toFixed(2) + '" stroke-linecap="round"' + (dash ? ' stroke-dasharray="' + (6 * u).toFixed(2) + ' ' + (5 * u).toFixed(2) + '"' : '') + ' pointer-events="none"/>';
    }
    function handle(p, color, id, i, sel) {
        return '<circle data-h="1" data-id="' + id + '" data-i="' + i + '" cx="' + p[0].toFixed(2) + '" cy="' + p[1].toFixed(2) + '" r="' + ((sel ? 7 : 5.5) * u).toFixed(2) +
            '" fill="' + (sel ? '#ffffff' : color) + '" stroke="#0f172a" stroke-width="' + (1.5 * u).toFixed(2) + '" pointer-events="all" style="cursor:move"/>';
    }
    var d = XRAY_MEAS.data;
    if (d.cal && d.cal.pts.length === 2) {
        html += line(d.cal.pts[0], d.cal.pts[1], XRAY_MEAS_COLOR.cal, 2, true);
        html += handle(d.cal.pts[0], XRAY_MEAS_COLOR.cal, 'cal', 0, false) + handle(d.cal.pts[1], XRAY_MEAS_COLOR.cal, 'cal', 1, false);
        var mid = [(d.cal.pts[0][0] + d.cal.pts[1][0]) / 2, (d.cal.pts[0][1] + d.cal.pts[1][1]) / 2];
        html += xrayMeasLabel(mid[0], mid[1], '= ' + d.cal.knownMm + ' mm', XRAY_MEAS_COLOR.cal, u);
    }
    d.items.forEach(function (it) {
        var color = XRAY_MEAS_COLOR[it.type];
        var sel = XRAY_MEAS.sel === it.id;
        var w = sel ? 3 : 2;
        var p = it.pts;
        if (it.type === 'length') html += line(p[0], p[1], color, w);
        else if (it.type === 'angle') html += line(p[1], p[0], color, w) + line(p[1], p[2], color, w);
        else html += line(p[0], p[1], color, w) + line(p[0], p[2], color, 1.5, true);
        p.forEach(function (pt, i) { html += handle(pt, color, it.id, i, sel); });
        var at = it.type === 'angle' ? p[1] : [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2];
        html += xrayMeasLabel(at[0], at[1], xrayMeasText(it), color, u);
    });
    if (XRAY_MEAS.tool && XRAY_MEAS.pending.length) {
        var color2 = XRAY_MEAS_COLOR[XRAY_MEAS.tool];
        var pp = XRAY_MEAS.pending;
        for (var i = 1; i < pp.length; i++) html += line(pp[i - 1], pp[i], color2, 2, true);
        if (XRAY_MEAS.hover) html += line(pp[pp.length - 1], XRAY_MEAS.hover, color2, 1.5, true);
        pp.forEach(function (pt) { html += '<circle cx="' + pt[0].toFixed(2) + '" cy="' + pt[1].toFixed(2) + '" r="' + (4.5 * u).toFixed(2) + '" fill="' + color2 + '" pointer-events="none"/>'; });
    }
    svg.innerHTML = html;
    xrayMeasRenderPanel();
}

function xrayMeasRenderPanel() {
    var panel = xvEl('xrayMeasPanel');
    if (!panel) return;
    var d = XRAY_MEAS.data;
    var show = !!XRAY_MEAS.rec && (d.items.length > 0 || !!d.cal || !!XRAY_MEAS.tool);
    panel.hidden = !show;
    ['length', 'angle', 'bone', 'cal'].forEach(function (tool) {
        var b = xvEl('lbMeasBtn-' + tool);
        if (b) b.classList.toggle('lb-tool-active', XRAY_MEAS.tool === tool);
    });
    var ro = xrayMeasReadonly();
    ['lbMeasBtn-length', 'lbMeasBtn-angle', 'lbMeasBtn-bone', 'lbMeasBtn-cal', 'lbMeasClear', 'lbMeasKnown'].forEach(function (id) {
        var b = xvEl(id);
        if (b) b.disabled = ro;
    });
    if (!show) return;
    var status = xvEl('xrayMeasStatus');
    var msg = d.cal
        ? ((d.cal.source === 'dicom' && typeof xdTr === 'function') ? xdTr('xd.cal', { MM: d.cal.mmPerPx.toFixed(4) }) : xvTr('xv.cal', { MM: d.cal.mmPerPx.toFixed(4) }))
        : xvTr('xv.uncal');
    if (ro) msg += ' · ' + xvTr('xv.readonly');
    else if (XRAY_MEAS.rec && !xrayMeasStorable(XRAY_MEAS.rec)) msg += ' · ' + xvTr('xv.noStore');
    if (status) status.textContent = msg;
    var list = xvEl('xrayMeasList');
    if (list) {
        list.innerHTML = d.items.map(function (it, n) {
            return '<div class="xm-item' + (XRAY_MEAS.sel === it.id ? ' is-sel' : '') + '" data-id="' + xvEsc(it.id) + '">' +
                '<span class="xm-dot xm-dot--' + it.type + '"></span>' +
                '<span class="xm-name">' + (n + 1) + '. ' + xvEsc(xrayMeasTypeName(it.type)) + ' <b>' + xvEsc(xrayMeasText(it)) + '</b></span>' +
                (ro ? '' : '<button type="button" class="xm-del" data-del="' + xvEsc(it.id) + '" data-no-click-guard="1">✕</button>') + '</div>';
        }).join('');
    }
    var hint = xvEl('xrayMeasHint');
    if (hint) hint.textContent = XRAY_MEAS.tool ? xvTr('xv.step.' + XRAY_MEAS.tool) : xvTr('xv.shortcuts');
}

function xrayMeasLoad(rec) {
    xrayMeasFlushNow();
    XRAY_MEAS.rec = rec || null;
    XRAY_MEAS.pending = [];
    XRAY_MEAS.hover = null;
    XRAY_MEAS.sel = '';
    XRAY_MEAS.tool = '';
    XRAY_MEAS.drag = null;
    var raw = null;
    if (rec) {
        raw = rec.measurements;
        if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (e) { raw = null; } }
        if (!raw && XRAY_MEAS.mem[rec.id]) raw = XRAY_MEAS.mem[rec.id];
    }
    XRAY_MEAS.data = xrayMeasClean(raw);
    xrayMeasRender();
}

function xrayMeasSetTool(tool) {
    if (!XRAY_MEAS.rec) return;
    if (xrayMeasReadonly()) { xvToast(xvTr('xv.readonly')); return; }
    XRAY_MEAS.pending = [];
    XRAY_MEAS.hover = null;
    XRAY_MEAS.tool = (XRAY_MEAS.tool === tool || !XRAY_MEAS_NEED[tool]) ? '' : tool;
    if (XRAY_MEAS.tool && typeof lbSetTool === 'function') lbSetTool('none');
    xrayMeasRender();
}

function xrayMeasCommit() {
    var tool = XRAY_MEAS.tool;
    var pts = XRAY_MEAS.pending.slice();
    XRAY_MEAS.pending = [];
    XRAY_MEAS.hover = null;
    if (tool === 'cal') {
        var known = parseFloat((xvEl('lbMeasKnown') || {}).value);
        var px = xrayMeasDist(pts[0], pts[1]);
        if (!(known > 0)) { xvToast(xvTr('xv.need')); xrayMeasRender(); return; }
        if (px < 2) { xrayMeasRender(); return; }
        XRAY_MEAS.data.cal = { mmPerPx: known / px, knownMm: known, pts: pts, source: 'user' };
        XRAY_MEAS.tool = '';
    } else {
        var id = 'm' + (XRAY_MEAS.nextId++) + '_' + Date.now().toString(36);
        XRAY_MEAS.data.items.push({ id: id, type: tool, pts: pts });
        XRAY_MEAS.sel = id;
    }
    xrayMeasChanged();
}

function xrayMeasAddPoint(pt) {
    if (!XRAY_MEAS.tool || xrayMeasReadonly()) return;
    var nat = xrayMeasNatural();
    var p = [Math.max(0, Math.min(nat.w, pt[0])), Math.max(0, Math.min(nat.h, pt[1]))];
    XRAY_MEAS.pending.push(p);
    if (XRAY_MEAS.pending.length >= XRAY_MEAS_NEED[XRAY_MEAS.tool]) xrayMeasCommit();
    else xrayMeasRender();
}

function xrayMeasEventPoint(ev) {
    var svg = xvEl('xrayLbMeasure');
    if (!svg || !svg.getScreenCTM) return null;
    var m = svg.getScreenCTM();
    if (!m) return null;
    var p = svg.createSVGPoint();
    p.x = ev.clientX;
    p.y = ev.clientY;
    var q = p.matrixTransform(m.inverse());
    return [q.x, q.y];
}

function xrayMeasDelete(id) {
    var d = XRAY_MEAS.data;
    var n = d.items.length;
    d.items = d.items.filter(function (it) { return it.id !== id; });
    if (d.items.length === n) return;
    if (XRAY_MEAS.sel === id) XRAY_MEAS.sel = '';
    xrayMeasChanged();
}

function xrayMeasClear(skipAsk) {
    var d = XRAY_MEAS.data;
    if (!d.items.length && !d.cal) return;
    if (!skipAsk && typeof window.confirm === 'function' && !window.confirm(xvTr('xv.clearAsk'))) return;
    XRAY_MEAS.data = { cal: null, items: [] };
    XRAY_MEAS.sel = '';
    XRAY_MEAS.pending = [];
    XRAY_MEAS.tool = '';
    xrayMeasChanged();
}

function xrayMeasChanged() {
    XRAY_MEAS.dirty = true;
    xrayMeasRender();
    clearTimeout(XRAY_MEAS.saveTimer);
    XRAY_MEAS.saveTimer = setTimeout(xrayMeasFlushNow, 450);
}

function xrayMeasFlushNow() {
    clearTimeout(XRAY_MEAS.saveTimer);
    XRAY_MEAS.saveTimer = null;
    var rec = XRAY_MEAS.rec;
    if (!rec || !XRAY_MEAS.dirty) return Promise.resolve(null);
    XRAY_MEAS.dirty = false;
    var payload = xrayMeasPayload();
    XRAY_MEAS.mem[rec.id] = payload;
    if (xrayMeasReadonly()) return Promise.resolve(null);
    if (!xrayMeasStorable(rec)) { xrayMeasRenderPanel(); return Promise.resolve(null); }
    if (typeof SB === 'undefined' || !SB || !SB.from) return Promise.resolve(null);
    return Promise.resolve(SB.from('xrays').update({ measurements: payload }).eq('id', rec.id)).then(function (r) {
        if (r && r.error) {
            if (typeof xrayCtxIsMissingColErr === 'function' && xrayCtxIsMissingColErr(r.error)) {
                XRAY_MEAS.off = true;
                xrayMeasRenderPanel();
            } else {
                xvToast(xvTr('xv.saveFail'), 'error');
            }
            return r;
        }
        rec.measurements = payload;
        var other = typeof xrayCtxRecord === 'function' ? xrayCtxRecord(rec.id) : null;
        if (other && other !== rec) other.measurements = payload;
        return r;
    }, function () { xvToast(xvTr('xv.saveFail'), 'error'); return null; });
}

function xrayMeasBind() {
    var svg = xvEl('xrayLbMeasure');
    if (!svg || svg._xvBound) return;
    svg._xvBound = true;
    svg.addEventListener('click', function (ev) {
        if (ev.target && ev.target.closest && ev.target.closest('[data-h]')) return;
        var pt = xrayMeasEventPoint(ev);
        if (pt) xrayMeasAddPoint(pt);
    });
    svg.addEventListener('mousemove', function (ev) {
        if (!XRAY_MEAS.tool || !XRAY_MEAS.pending.length) return;
        XRAY_MEAS.hover = xrayMeasEventPoint(ev);
        xrayMeasRender();
    });
    svg.addEventListener('mousedown', function (ev) {
        if (XRAY_MEAS.tool || (ev.target && ev.target.closest && ev.target.closest('[data-h]'))) ev.stopPropagation();
    });
    svg.addEventListener('pointerdown', function (ev) {
        var h = ev.target && ev.target.closest ? ev.target.closest('[data-h]') : null;
        if (!h) return;
        ev.stopPropagation();
        ev.preventDefault();
        if (xrayMeasReadonly()) return;
        var id = h.getAttribute('data-id');
        XRAY_MEAS.drag = { id: id, i: parseInt(h.getAttribute('data-i'), 10) || 0 };
        if (id !== 'cal') XRAY_MEAS.sel = id;
        function move(e) {
            var pt = xrayMeasEventPoint(e);
            var d = XRAY_MEAS.drag;
            if (!pt || !d) return;
            var nat = xrayMeasNatural();
            var p = [Math.max(0, Math.min(nat.w, pt[0])), Math.max(0, Math.min(nat.h, pt[1]))];
            if (d.id === 'cal') {
                var c = XRAY_MEAS.data.cal;
                if (c) {
                    c.pts[d.i] = p;
                    var px = xrayMeasDist(c.pts[0], c.pts[1]);
                    if (px >= 2 && c.knownMm > 0) c.mmPerPx = c.knownMm / px;
                }
            } else {
                XRAY_MEAS.data.items.forEach(function (it) { if (it.id === d.id) it.pts[d.i] = p; });
            }
            xrayMeasRender();
        }
        function up() {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            if (XRAY_MEAS.drag) { XRAY_MEAS.drag = null; xrayMeasChanged(); }
        }
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        xrayMeasRender();
    });
    var list = xvEl('xrayMeasList');
    if (list) {
        list.addEventListener('click', function (ev) {
            var del = ev.target.closest ? ev.target.closest('[data-del]') : null;
            if (del) { xrayMeasDelete(del.getAttribute('data-del')); return; }
            var row = ev.target.closest ? ev.target.closest('.xm-item') : null;
            if (row) { XRAY_MEAS.sel = row.getAttribute('data-id'); xrayMeasRender(); }
        });
    }
    var img = xvEl('xrayLbImg');
    if (img) img.addEventListener('load', xrayMeasRender);
}

/* ══════════════════════════════════════════════════════════
   SYNCED COMPARE + PER-TOOTH TIMELINE
   ══════════════════════════════════════════════════════════ */

var XRAY_CMP = {
    a: { z: 1, x: 0, y: 0 },
    b: { z: 1, x: 0, y: 0 },
    sync: true,
    idA: '',
    idB: '',
    scope: 'all',
    toothList: [],
    allList: [],
    next: null,
    drag: null
};

function xrayCmpApply() {
    ['a', 'b'].forEach(function (s) {
        var img = xvEl('xrayCompareImg' + s.toUpperCase());
        var st = XRAY_CMP[s];
        if (img) img.style.transform = 'translate(' + st.x.toFixed(1) + 'px,' + st.y.toFixed(1) + 'px) scale(' + st.z.toFixed(3) + ')';
    });
}

function xrayCmpSides(side) {
    return (XRAY_CMP.sync || !side) ? ['a', 'b'] : [side];
}

function xrayCmpZoom(f, side) {
    xrayCmpSides(side).forEach(function (s) {
        var st = XRAY_CMP[s];
        st.z = Math.max(1, Math.min(10, st.z * f));
        if (st.z === 1) { st.x = 0; st.y = 0; }
    });
    xrayCmpApply();
}

function xrayCmpReset() {
    XRAY_CMP.a = { z: 1, x: 0, y: 0 };
    XRAY_CMP.b = { z: 1, x: 0, y: 0 };
    xrayCmpApply();
}

function xrayCmpSetSync(v) {
    XRAY_CMP.sync = !!v;
    var cb = xvEl('xrayCmpSync');
    if (cb) cb.checked = !!v;
    if (v) { XRAY_CMP.b = { z: XRAY_CMP.a.z, x: XRAY_CMP.a.x, y: XRAY_CMP.a.y }; xrayCmpApply(); }
}

function xrayCmpFilm(id) {
    return typeof xrayCtxRecord === 'function' ? xrayCtxRecord(id) : null;
}

function xrayCmpPick(side, id) {
    var rec = xrayCmpFilm(id);
    if (!rec) return;
    var up = side.toUpperCase();
    var img = xvEl('xrayCompareImg' + up);
    var cap = xvEl('xrayCompareCap' + up);
    if (img) img.src = typeof xrayDisplayUrl === 'function' ? xrayDisplayUrl(rec) : (rec.file_url || '');
    if (cap) cap.textContent = ((rec._clinicLabel || '') ? rec._clinicLabel + ' · ' : '') + xvFilmLabel(rec);
    XRAY_CMP['id' + up] = String(rec.id);
    var sel = xvEl('xrayCmpSel' + up);
    if (sel) sel.value = String(rec.id);
}

function xrayCmpFillSelects() {
    var list = XRAY_CMP.scope === 'tooth' && XRAY_CMP.toothList.length ? XRAY_CMP.toothList : XRAY_CMP.allList;
    ['A', 'B'].forEach(function (up) {
        var sel = xvEl('xrayCmpSel' + up);
        if (!sel) return;
        var cur = XRAY_CMP['id' + up];
        var html = '';
        var present = false;
        list.forEach(function (x) {
            if (String(x.id) === cur) present = true;
            html += '<option value="' + xvEsc(x.id) + '">' + xvEsc(xvFilmLabel(x)) + '</option>';
        });
        if (!present && cur) {
            var rec = xrayCmpFilm(cur);
            if (rec) html += '<option value="' + xvEsc(rec.id) + '">' + xvEsc(xvFilmLabel(rec)) + '</option>';
        }
        sel.innerHTML = html;
        sel.value = cur;
        sel.hidden = !html;
    });
    var scope = xvEl('xrayCmpScope');
    if (scope) {
        scope.hidden = !XRAY_CMP.toothList.length;
        scope.value = XRAY_CMP.scope;
    }
}

function xrayCmpSetScope(v) {
    XRAY_CMP.scope = v === 'tooth' ? 'tooth' : 'all';
    xrayCmpFillSelects();
}

function xrayCmpSwap() {
    var a = XRAY_CMP.idA, b = XRAY_CMP.idB;
    if (!a || !b) return;
    xrayCmpPick('a', b);
    xrayCmpPick('b', a);
}

function xrayCmpInit(idA, idB) {
    XRAY_CMP.a = { z: 1, x: 0, y: 0 };
    XRAY_CMP.b = { z: 1, x: 0, y: 0 };
    XRAY_CMP.sync = true;
    var nxt = XRAY_CMP.next || { tooth: [], list: [] };
    XRAY_CMP.next = null;
    XRAY_CMP.toothList = nxt.list;
    XRAY_CMP.allList = xvSortFilms(xvHomeFilms());
    XRAY_CMP.scope = XRAY_CMP.toothList.length ? 'tooth' : 'all';
    XRAY_CMP.idA = String(idA);
    XRAY_CMP.idB = String(idB);
    var cb = xvEl('xrayCmpSync');
    if (cb) cb.checked = true;
    xrayCmpFillSelects();
    xrayCmpApply();
}

function xrayCmpBind() {
    ['A', 'B'].forEach(function (up) {
        var view = xvEl('xrayCmpView' + up);
        if (!view || view._xvBound) return;
        view._xvBound = true;
        var side = up.toLowerCase();
        view.addEventListener('wheel', function (ev) {
            ev.preventDefault();
            xrayCmpZoom(ev.deltaY < 0 ? 1.15 : 1 / 1.15, side);
        }, { passive: false });
        view.addEventListener('pointerdown', function (ev) {
            if (XRAY_CMP[side].z <= 1) return;
            ev.preventDefault();
            XRAY_CMP.drag = { side: side, sx: ev.clientX, sy: ev.clientY, ox: XRAY_CMP[side].x, oy: XRAY_CMP[side].y };
            view.classList.add('is-drag');
            function move(e) {
                var d = XRAY_CMP.drag;
                if (!d) return;
                var nx = d.ox + (e.clientX - d.sx);
                var ny = d.oy + (e.clientY - d.sy);
                xrayCmpSides(d.side).forEach(function (s) { XRAY_CMP[s].x = nx; XRAY_CMP[s].y = ny; });
                xrayCmpApply();
            }
            function up() {
                window.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                XRAY_CMP.drag = null;
                view.classList.remove('is-drag');
            }
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
        });
        view.addEventListener('dblclick', function () { xrayCmpReset(); });
    });
}

function xrayViewerToothTimeline() {
    var rec = (typeof lbCurrentId !== 'undefined' && lbCurrentId && typeof xrayCtxRecord === 'function') ? xrayCtxRecord(lbCurrentId) : null;
    if (!rec) return;
    var teeth = xvExplicitTeeth(rec);
    var all = xvSortFilms(xvHomeFilms());
    var same = teeth.length ? all.filter(function (x) {
        return xvExplicitTeeth(x).some(function (c) { return teeth.indexOf(c) >= 0; });
    }) : all;
    var idx = -1;
    same.forEach(function (x, n) { if (String(x.id) === String(rec.id)) idx = n; });
    var other = null;
    if (idx > 0) other = same[idx - 1];
    else if (idx === 0 && same.length > 1) other = same[1];
    else if (idx < 0 && same.length) other = same[same.length - 1];
    if (!other || String(other.id) === String(rec.id)) { xvToast(xvTr('xv.noOther')); return; }
    var older = xvFilmDay(other) <= xvFilmDay(rec) ? other : rec;
    var newer = older === other ? rec : other;
    XRAY_CMP.next = { tooth: teeth, list: teeth.length ? same : [] };
    if (typeof window.xrayOpenCompare === 'function') window.xrayOpenCompare(older.id, newer.id);
}

/* ══════════════════════════════════════════════════════════
   FMX / BITEWING MOUNT
   ══════════════════════════════════════════════════════════ */

var XRAY_MOUNT_ROWS = {
    upper: { type: 'Periapical', labelKey: 'xv.rowUpper', slots: [
        { k: 'molarR', teeth: ['16', '17', '18'] }, { k: 'premR', teeth: ['14', '15'] }, { k: 'canR', teeth: ['13'] },
        { k: 'inc', teeth: ['11', '12', '21', '22'] },
        { k: 'canL', teeth: ['23'] }, { k: 'premL', teeth: ['24', '25'] }, { k: 'molarL', teeth: ['26', '27', '28'] }
    ] },
    lower: { type: 'Periapical', labelKey: 'xv.rowLower', slots: [
        { k: 'molarR', teeth: ['46', '47', '48'] }, { k: 'premR', teeth: ['44', '45'] }, { k: 'canR', teeth: ['43'] },
        { k: 'inc', teeth: ['41', '42', '31', '32'] },
        { k: 'canL', teeth: ['33'] }, { k: 'premL', teeth: ['34', '35'] }, { k: 'molarL', teeth: ['36', '37', '38'] }
    ] },
    bw: { type: 'Bitewing', labelKey: 'xv.rowBw', slots: [
        { k: 'molarR', teeth: ['16', '17', '46', '47'] }, { k: 'premR', teeth: ['14', '15', '44', '45'] },
        { k: 'premL', teeth: ['24', '25', '34', '35'] }, { k: 'molarL', teeth: ['26', '27', '36', '37'] }
    ] }
};

var XRAY_MOUNT_LAYOUTS = { fmx: ['upper', 'lower', 'bw'], bw: ['bw'] };
var XRAY_MOUNT = { row: '', slot: '', pins: {}, dragId: '', bound: false };

function xvMountPad(n) { return n < 10 ? '0' + n : String(n); }

function xvMountWhen(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).replace('T', ' ').slice(0, 16);
    return d.getFullYear() + '-' + xvMountPad(d.getMonth() + 1) + '-' + xvMountPad(d.getDate()) +
        ' ' + xvMountPad(d.getHours()) + ':' + xvMountPad(d.getMinutes()) + ':' + xvMountPad(d.getSeconds());
}

function xvMountWhenMini(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d.getTime())) return xvMountWhen(iso).slice(5, 16);
    return xvMountPad(d.getMonth() + 1) + '-' + xvMountPad(d.getDate()) +
        ' ' + xvMountPad(d.getHours()) + ':' + xvMountPad(d.getMinutes());
}

function xrayMountAtKey() {
    var pid = (typeof xrayPatientId !== 'undefined' && xrayPatientId) ? String(xrayPatientId) : '';
    return 'jsm_xray_mount_at_v1' + (pid ? ':' + pid : '');
}

function xrayMountAtMap() {
    try {
        if (typeof localStorage === 'undefined') return {};
        var raw = localStorage.getItem(xrayMountAtKey());
        var map = raw ? JSON.parse(raw) : {};
        return map && typeof map === 'object' ? map : {};
    } catch (e) { return {}; }
}

function xrayMountRememberedAt(id) {
    if (id == null || id === '') return '';
    return xrayMountAtMap()[String(id)] || '';
}

function xrayMountRememberAt(id, iso) {
    if (id == null || id === '' || !iso) return;
    try {
        if (typeof localStorage === 'undefined') return;
        var map = xrayMountAtMap();
        map[String(id)] = iso;
        localStorage.setItem(xrayMountAtKey(), JSON.stringify(map));
    } catch (e) { /* caption still updates in memory */ }
}

function xvMountStamp(film) {
    if (!film) return '';
    return film._mountAt || xrayMountRememberedAt(film.id) || film.updated_at || film.created_at || '';
}

function xrayMountPinStoreKey() {
    var pid = (typeof xrayPatientId !== 'undefined' && xrayPatientId) ? String(xrayPatientId) : 'none';
    return 'jsm_xray_mount_pin_v1:' + pid;
}

function xrayMountLoadPins() {
    XRAY_MOUNT.pins = {};
    try {
        if (typeof localStorage === 'undefined') return;
        var raw = localStorage.getItem(xrayMountPinStoreKey());
        var map = raw ? JSON.parse(raw) : {};
        if (map && typeof map === 'object') XRAY_MOUNT.pins = map;
    } catch (e) { XRAY_MOUNT.pins = {}; }
}

function xrayMountSavePins() {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(xrayMountPinStoreKey(), JSON.stringify(XRAY_MOUNT.pins || {}));
    } catch (e) { /* session pins still apply */ }
}

function xrayMountLayout() {
    var sel = xvEl('xrayMountLayout');
    return sel && sel.value === 'bw' ? 'bw' : 'fmx';
}

function xrayMountSpec(rowKey, slotKey) {
    var row = XRAY_MOUNT_ROWS[rowKey];
    if (!row || !slotKey) return null;
    for (var i = 0; i < row.slots.length; i++) {
        if (row.slots[i].k === slotKey) return { rowKey: rowKey, row: row, slot: row.slots[i] };
    }
    return null;
}

function xrayMountFilm(id) {
    if (id == null || id === '') return null;
    var lists = [xvHomeFilms(), (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) ? xrayAllRecords : []];
    for (var n = 0; n < lists.length; n++) {
        for (var i = 0; i < lists[n].length; i++) {
            if (String(lists[n][i].id) === String(id)) return lists[n][i];
        }
    }
    return null;
}

function xrayMountWritable(rec) {
    if (!rec) return false;
    if (typeof xrayIsHomeRecord === 'function') return !!xrayIsHomeRecord(rec);
    return rec._isHome !== false;
}

function xrayMountCompute(layout, films) {
    var pins = XRAY_MOUNT.pins || {};
    var rows = (XRAY_MOUNT_LAYOUTS[layout] || XRAY_MOUNT_LAYOUTS.fmx).map(function (rk) {
        var row = XRAY_MOUNT_ROWS[rk];
        return {
            key: rk,
            labelKey: row.labelKey,
            slots: row.slots.map(function (s) {
                var hits = xvSortFilms((films || []).filter(function (x) {
                    return x.xray_type === row.type && xvExplicitTeeth(x).some(function (c) { return s.teeth.indexOf(c) >= 0; });
                })).reverse();
                var pinId = pins[rk + ':' + s.k];
                var pinned = pinId ? (films || []).filter(function (x) { return String(x.id) === String(pinId); })[0] : null;
                var film = pinned || hits[0] || null;
                var allHits = film ? [film].concat(hits.filter(function (h) { return String(h.id) !== String(film.id); })) : hits;
                return { k: s.k, teeth: s.teeth, film: film, more: Math.max(0, allHits.length - 1), hits: allHits };
            })
        };
    });
    var total = 0, filled = 0, missing = [];
    rows.forEach(function (r) {
        r.slots.forEach(function (s) {
            total++;
            if (s.film) filled++;
            else missing.push(xvTr(r.labelKey) + ' ' + xvTr('xv.s.' + s.k));
        });
    });
    return { rows: rows, total: total, filled: filled, missing: missing };
}

function xrayMountWhenHtml(film) {
    var when = xvMountWhen(xvMountStamp(film));
    if (!when) return '';
    return '<span class="xm-slot-when" title="' + xvEsc(xvTr('xv.mountUpdated', { WHEN: when })) + '">' + xvEsc(xvMountWhenMini(xvMountStamp(film))) + '</span>';
}

function xrayMountHideStrip() {
    var strip = xvEl('xrayMountStrip');
    if (strip) strip.hidden = true;
    var track = xvEl('xrayMountStripTrack');
    if (track) track.innerHTML = '';
    var head = xvEl('xrayMountStripHead');
    if (head) head.innerHTML = '';
}

function xrayMountStripFilms(rowKey) {
    var row = XRAY_MOUNT_ROWS[rowKey];
    if (!row) return [];
    return xvSortFilms(xvHomeFilms().filter(function (x) {
        var t = x.xray_type || '';
        return !t || t === row.type;
    })).reverse();
}

function xrayMountPaintStrip(rowKey, slotKey) {
    var strip = xvEl('xrayMountStrip');
    var head = xvEl('xrayMountStripHead');
    var track = xvEl('xrayMountStripTrack');
    var spec = xrayMountSpec(rowKey, slotKey);
    if (!strip || !track || !spec) { xrayMountHideStrip(); return; }
    var current = null;
    xrayMountCompute(xrayMountLayout(), xvHomeFilms()).rows.forEach(function (r) {
        if (r.key !== rowKey) return;
        r.slots.forEach(function (s) { if (s.k === slotKey) current = s.film; });
    });
    var when = current ? xvMountWhen(xvMountStamp(current)) : '';
    var name = xvTr(spec.row.labelKey) + ' · ' + xvTr('xv.s.' + spec.slot.k);
    if (head) {
        head.innerHTML = '<span class="xm-strip-title">' + xvEsc(xvTr('xv.mountDrag')) + '</span>' +
            '<span class="xm-strip-for">' + xvEsc(name) + '</span>' +
            (when ? '<span class="xm-slot-when" title="' + xvEsc(xvTr('xv.mountUpdated', { WHEN: when })) + '">' + xvEsc(xvMountWhenMini(xvMountStamp(current))) + '</span>' : '');
    }
    var films = xrayMountStripFilms(rowKey);
    if (!films.length) {
        track.innerHTML = '<div class="xm-strip-empty">' + xvEsc(xvTr('xv.mountNoFilms')) + '</div>';
    } else {
        var html = '';
        films.forEach(function (x) {
            var url = typeof xrayDisplayUrl === 'function' ? xrayDisplayUrl(x) : (x.file_url || '');
            var on = current && String(current.id) === String(x.id);
            var full = xvMountWhen(xvMountStamp(x));
            var cap = xvMountWhenMini(xvMountStamp(x)) || xvFilmDay(x);
            html += '<div class="xm-strip-item' + (on ? ' is-current' : '') + '" draggable="true" role="button" data-id="' + xvEsc(x.id) + '" aria-label="' + xvEsc(full || cap) + '" title="' + xvEsc(full ? xvTr('xv.mountUpdated', { WHEN: full }) : xvFilmLabel(x)) + '">' +
                '<span class="xm-strip-img"><img src="' + xvEsc(url) + '" alt="" draggable="false"></span>' +
                '<span class="xm-strip-cap">' + xvEsc(cap) + '</span></div>';
        });
        track.innerHTML = html;
    }
    strip.hidden = false;
}

function xrayMountPick(rowKey, slotKey) {
    if (!xrayMountSpec(rowKey, slotKey)) return;
    XRAY_MOUNT.row = rowKey;
    XRAY_MOUNT.slot = slotKey;
    var body = xvEl('xrayMountBody');
    if (body) {
        var nodes = body.querySelectorAll('.xm-slot');
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            el.classList.toggle('is-selected', el.getAttribute('data-row') === rowKey && el.getAttribute('data-slot') === slotKey);
        }
    }
    xrayMountPaintStrip(rowKey, slotKey);
}

function xrayMountClearOver() {
    var body = xvEl('xrayMountBody');
    if (!body) return;
    var nodes = body.querySelectorAll('.xm-slot.is-over');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('is-over');
}

function xrayMountMissingCol(err) {
    if (typeof xrayCtxIsMissingColErr === 'function' && xrayCtxIsMissingColErr(err)) return true;
    var msg = String((err && (err.message || err.details || err.hint)) || err || '').toLowerCase();
    return msg.indexOf('updated_at') >= 0;
}

function xrayMountAssign(filmId, rowKey, slotKey) {
    var spec = xrayMountSpec(rowKey, slotKey);
    var rec = xrayMountFilm(filmId);
    if (!spec || !rec) return Promise.resolve(false);
    if (!xrayMountWritable(rec)) { xvToast(xvTr('xv.readonly')); return Promise.resolve(false); }
    var prevTeeth = Array.isArray(rec.teeth) ? rec.teeth.slice() : [];
    var prevType = rec.xray_type;
    var prevAt = rec._mountAt || '';
    var pinKey = rowKey + ':' + slotKey;
    var prevPin = XRAY_MOUNT.pins[pinKey];
    var iso = new Date().toISOString();
    rec.teeth = spec.slot.teeth.slice();
    rec.xray_type = spec.row.type;
    rec._mountAt = iso;
    xrayMountRememberAt(rec.id, iso);
    Object.keys(XRAY_MOUNT.pins).forEach(function (k) {
        if (String(XRAY_MOUNT.pins[k]) === String(rec.id)) delete XRAY_MOUNT.pins[k];
    });
    XRAY_MOUNT.pins[pinKey] = String(rec.id);
    xrayMountSavePins();
    XRAY_MOUNT.row = rowKey;
    XRAY_MOUNT.slot = slotKey;
    xrayMountRender();
    function revert() {
        rec.teeth = prevTeeth;
        rec.xray_type = prevType;
        rec._mountAt = prevAt;
        if (prevPin) XRAY_MOUNT.pins[pinKey] = prevPin;
        else delete XRAY_MOUNT.pins[pinKey];
        xrayMountSavePins();
        xrayMountRender();
        xvToast(xvTr('xv.mountAssignFail'));
    }
    if (typeof xrayCtxUpdate !== 'function') return Promise.resolve(true);
    var payload = { teeth: rec.teeth.slice(), xray_type: spec.row.type };
    if (Object.prototype.hasOwnProperty.call(rec, 'updated_at')) payload.updated_at = iso;
    return Promise.resolve().then(function () { return xrayCtxUpdate(rec.id, payload); }).then(function (r) {
        if (r && r.error && payload.updated_at && xrayMountMissingCol(r.error)) {
            delete payload.updated_at;
            return xrayCtxUpdate(rec.id, payload);
        }
        return r;
    }).then(function (r) {
        if (r && r.error) { revert(); return false; }
        var saved = r && r.data && r.data[0];
        if (saved && saved.updated_at) {
            rec.updated_at = saved.updated_at;
            rec._mountAt = saved.updated_at;
            xrayMountRememberAt(rec.id, rec._mountAt);
            xrayMountRender();
        }
        if (typeof filterXrays === 'function') {
            try { filterXrays(); } catch (e) { /* mount caption already updated */ }
        }
        return true;
    }, function () { revert(); return false; });
}

function xrayMountBind() {
    if (XRAY_MOUNT.bound) return;
    var body = xvEl('xrayMountBody');
    var strip = xvEl('xrayMountStrip');
    if (!body || !strip) return;
    XRAY_MOUNT.bound = true;
    body.addEventListener('click', function (ev) {
        var b = ev.target.closest ? ev.target.closest('.xm-slot') : null;
        if (!b) return;
        xrayMountPick(b.getAttribute('data-row'), b.getAttribute('data-slot'));
    });
    body.addEventListener('dblclick', function (ev) {
        var b = ev.target.closest ? ev.target.closest('.xm-slot.is-filled') : null;
        if (!b) return;
        var rec = xrayMountFilm(b.getAttribute('data-id'));
        if (!rec) return;
        if (typeof closeModal === 'function') closeModal('xrayMountModal');
        if (typeof openLightboxRecord === 'function') openLightboxRecord(rec, body._navList || [rec]);
    });
    body.addEventListener('dragover', function (ev) {
        var b = ev.target.closest ? ev.target.closest('.xm-slot') : null;
        if (!b || !XRAY_MOUNT.dragId) return;
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
        if (!b.classList.contains('is-over')) {
            xrayMountClearOver();
            b.classList.add('is-over');
        }
    });
    body.addEventListener('drop', function (ev) {
        var b = ev.target.closest ? ev.target.closest('.xm-slot') : null;
        if (!b) return;
        ev.preventDefault();
        xrayMountClearOver();
        var id = (ev.dataTransfer && ev.dataTransfer.getData('text/plain')) || XRAY_MOUNT.dragId;
        XRAY_MOUNT.dragId = '';
        if (id) xrayMountAssign(id, b.getAttribute('data-row'), b.getAttribute('data-slot'));
    });
    strip.addEventListener('dragstart', function (ev) {
        var item = ev.target.closest ? ev.target.closest('.xm-strip-item') : null;
        if (!item) return;
        var id = item.getAttribute('data-id') || '';
        XRAY_MOUNT.dragId = id;
        item.classList.add('is-dragging');
        if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = 'copy';
            try { ev.dataTransfer.setData('text/plain', id); } catch (e) {}
        }
    });
    strip.addEventListener('dragend', function () {
        var nodes = strip.querySelectorAll('.xm-strip-item.is-dragging');
        for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('is-dragging');
        XRAY_MOUNT.dragId = '';
        xrayMountClearOver();
    });
}

function xrayMountRender() {
    var body = xvEl('xrayMountBody');
    if (!body) return;
    var layout = xrayMountLayout();
    var rowsInLayout = XRAY_MOUNT_LAYOUTS[layout] || XRAY_MOUNT_LAYOUTS.fmx;
    if (XRAY_MOUNT.row && rowsInLayout.indexOf(XRAY_MOUNT.row) < 0) {
        XRAY_MOUNT.row = '';
        XRAY_MOUNT.slot = '';
    }
    var films = xvHomeFilms();
    var m = xrayMountCompute(layout, films);
    var navList = [];
    var html = '';
    m.rows.forEach(function (r) {
        html += '<div class="xm-rowlbl">' + xvEsc(xvTr(r.labelKey)) + '</div><div class="xm-row xm-row--' + r.slots.length + '">';
        r.slots.forEach(function (s) {
            var teeth = '<span class="xm-slot-teeth">' + xvEsc(s.teeth.join(' ')) + '</span>';
            var name = '<span class="xm-slot-name">' + xvEsc(xvTr('xv.s.' + s.k)) + '</span>';
            var selected = XRAY_MOUNT.row === r.key && XRAY_MOUNT.slot === s.k ? ' is-selected' : '';
            if (!s.film) {
                html += '<button type="button" class="xm-slot is-empty' + selected + '" data-row="' + r.key + '" data-slot="' + s.k + '" data-no-click-guard="1">' +
                    name + teeth + '<span class="xm-slot-none">' + xvEsc(xvTr('xv.mountEmpty')) + '</span></button>';
                return;
            }
            navList.push(s.film);
            var url = typeof xrayDisplayUrl === 'function' ? xrayDisplayUrl(s.film) : (s.film.file_url || '');
            html += '<button type="button" class="xm-slot is-filled' + selected + '" data-row="' + r.key + '" data-slot="' + s.k + '" data-id="' + xvEsc(s.film.id) + '" data-no-click-guard="1">' +
                '<span class="xm-slot-img"><img src="' + xvEsc(url) + '" alt="" loading="lazy" draggable="false" data-xray-id="' + xvEsc(s.film.id) + '"></span>' + name + teeth +
                '<span class="xm-slot-date">' + xvEsc(xvFilmDay(s.film)) + (s.more ? ' <b>+' + s.more + '</b>' : '') + '</span>' +
                xrayMountWhenHtml(s.film) + '</button>';
        });
        html += '</div>';
    });
    body.innerHTML = html;
    body._navList = navList;
    var sum = xvEl('xrayMountSummary');
    if (sum) {
        sum.textContent = xvTr('xv.mountDone', { N: m.filled, M: m.total }) + ' · ' +
            (m.missing.length ? xvTr('xv.mountMissing', { LIST: m.missing.join(', ') }) : xvTr('xv.mountComplete'));
        sum.classList.toggle('is-complete', !m.missing.length);
    }
    xrayMountBind();
    if (XRAY_MOUNT.row && XRAY_MOUNT.slot) xrayMountPaintStrip(XRAY_MOUNT.row, XRAY_MOUNT.slot);
    else xrayMountHideStrip();
}

function xrayMountOpen() {
    if (typeof XRAY_CTX !== 'undefined' && XRAY_CTX.ok !== true) { xvToast(xvTr('xv.mountNeedCtx')); return; }
    xrayMountLoadPins();
    XRAY_MOUNT.row = '';
    XRAY_MOUNT.slot = '';
    XRAY_MOUNT.dragId = '';
    xrayMountRender();
    if (typeof openModal === 'function') openModal('xrayMountModal');
}

/* ══════════════════════════════════════════════════════════
   KEYBOARD SHORTCUTS (lightbox)
   ══════════════════════════════════════════════════════════ */

function xrayViewerLightboxOpen() {
    var modal = xvEl('xrayLightbox');
    if (!modal) return false;
    if (modal.style && modal.style.display && modal.style.display !== 'none') return true;
    var vis = window.getComputedStyle(modal);
    return vis.display !== 'none' && vis.visibility !== 'hidden';
}

function xrayViewerKey(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (ev.target && ev.target.isContentEditable)) return;
    if (!xrayViewerLightboxOpen()) return;
    var k = ev.key;
    var done = true;
    var low = k && k.length === 1 ? k.toLowerCase() : k;
    if (low === 'm') xrayMeasSetTool('length');
    else if (low === 'a') xrayMeasSetTool('angle');
    else if (low === 'b') xrayMeasSetTool('bone');
    else if (low === 'c') xrayMeasSetTool('cal');
    else if (k === 'Escape') {
        if (XRAY_MEAS.tool || XRAY_MEAS.pending.length) { XRAY_MEAS.tool = ''; XRAY_MEAS.pending = []; XRAY_MEAS.hover = null; xrayMeasRender(); }
        else done = false;
    } else if (k === 'Delete' || k === 'Backspace') {
        if (XRAY_MEAS.sel && !xrayMeasReadonly()) xrayMeasDelete(XRAY_MEAS.sel);
        else done = false;
    } else if (k === '+' || k === '=') { if (typeof lbZoom === 'function') lbZoom(1.25); }
    else if (k === '-' || k === '_') { if (typeof lbZoom === 'function') lbZoom(0.8); }
    else if (k === '0') { if (typeof lbReset === 'function') lbReset(); }
    else if (low === 'r') { if (typeof lbRotate === 'function') lbRotate(90); }
    else if (low === 'i') { if (typeof lbInvert === 'function') lbInvert(); }
    else if (low === 'h') { if (typeof lbFlip === 'function') lbFlip('h'); }
    else if (low === 'v') { if (typeof lbFlip === 'function') lbFlip('v'); }
    else if (low === 'f') { if (typeof lbToggleMaximize === 'function') lbToggleMaximize(); }
    else if (k === '[' || k === ']') {
        if (typeof lbSetBrightness === 'function' && typeof lbBrightness === 'number') {
            var nb = Math.max(0, Math.min(300, lbBrightness + (k === ']' ? 10 : -10)));
            var sl = xvEl('lbBrightSlider');
            if (sl) sl.value = nb;
            lbSetBrightness(nb);
        }
    } else done = false;
    if (done) { ev.preventDefault(); ev.stopPropagation(); }
}

/* ══════════════════════════════════════════════════════════
   HOOKS
   ══════════════════════════════════════════════════════════ */

var XRAY_VIEWER = { hooked: false };

function xrayViewerHook() {
    if (XRAY_VIEWER.hooked) return;
    if (typeof window.openLightboxRecord !== 'function') return;
    XRAY_VIEWER.hooked = true;

    var baseOpen = window.openLightboxRecord;
    window.openLightboxRecord = function (rec) {
        var out = baseOpen.apply(this, arguments);
        try {
            if (rec && typeof lbCurrentId !== 'undefined' && String(lbCurrentId) === String(rec.id)) xrayMeasLoad(rec);
        } catch (e) { console.error('[xray-viewer]', e); }
        return out;
    };
    window.openLightboxRecord._xv = true;

    var wrap = function (name, after, before) {
        var base = window[name];
        if (typeof base !== 'function' || base._xv) return;
        var w = function () {
            try { if (before) before.apply(this, arguments); } catch (e) { console.error('[xray-viewer]', e); }
            var out = base.apply(this, arguments);
            try { if (after) after.apply(this, arguments); } catch (e) { console.error('[xray-viewer]', e); }
            return out;
        };
        w._xv = true;
        window[name] = w;
    };
    wrap('lbSyncLightboxScrollShell', function () { if (XRAY_MEAS.rec) xrayMeasRender(); });
    wrap('_forceCloseLightbox', function () { xrayMeasLoad(null); });
    wrap('lbCropApply', null, function () {
        var d = XRAY_MEAS.data;
        var crops = typeof lbCropRect === 'object' && lbCropRect && lbCropRect.w >= 5 && lbCropRect.h >= 5;
        if (crops && XRAY_MEAS.rec && (d.items.length || d.cal)) {
            XRAY_MEAS.data = { cal: null, items: [] };
            XRAY_MEAS.sel = '';
            XRAY_MEAS.tool = '';
            xrayMeasChanged();
            xvToast(xvTr('xv.cropClears'));
        }
    });
    wrap('saveLbMeta', null, function () {
        var d = XRAY_MEAS.data;
        if (XRAY_MEAS.rec && (d.items.length || d.cal) && typeof lbNeedsImagePersist === 'function' && lbNeedsImagePersist()) {
            XRAY_MEAS.data = { cal: null, items: [] };
            XRAY_MEAS.sel = '';
            XRAY_MEAS.tool = '';
            xrayMeasChanged();
            xvToast(xvTr('xv.cropClears'));
        }
    });

    var baseCmp = window.xrayOpenCompare;
    if (typeof baseCmp === 'function' && !baseCmp._xv) {
        var cmp = function (idA, idB) {
            var out = baseCmp.apply(this, arguments);
            try { xrayCmpInit(idA, idB); } catch (e) { console.error('[xray-viewer]', e); }
            return out;
        };
        cmp._xv = true;
        window.xrayOpenCompare = cmp;
    }

    document.addEventListener('keydown', xrayViewerKey, true);
    xrayMeasBind();
    xrayCmpBind();
}

(function () {
    function boot() {
        xrayViewerHook();
        xrayMeasBind();
        xrayCmpBind();
    }
    xrayViewerHook();
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
        else boot();
    }
})();
