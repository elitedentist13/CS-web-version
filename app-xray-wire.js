/* =========================================================
   app-xray-wire.js - connects the Consultation X-ray tab to the
   rest of the app: deep links to one film (timeline, hub, notes,
   dental chart), a per-tooth film badge in the dental chart and an
   "X-rays this visit" bar with suggested bill items.
   Loads after app-charts.js and app-xray-ctx.js.
   ========================================================= */

(function () {
    var MORE = {
        'xw.gone': { en: 'That X-ray is no longer available.', 'zh-CN': '该X光片已不存在。', 'zh-Hant': '該X光片已不存在。' },
        'xw.visitBar': { en: 'X-rays this visit', 'zh-CN': '本次就诊X光', 'zh-Hant': '本次就診X光' },
        'xw.films': { en: '{N} film(s)', 'zh-CN': '{N} 张', 'zh-Hant': '{N} 張' },
        'xw.toReview': { en: '{N} to review', 'zh-CN': '{N} 张待审阅', 'zh-Hant': '{N} 張待審閱' },
        'xw.suggest': { en: 'Suggested bill items', 'zh-CN': '建议收费项目', 'zh-Hant': '建議收費項目' },
        'xw.openBill': { en: 'Open billing', 'zh-CN': '打开收费', 'zh-Hant': '開啟收費' },
        'xw.billToast': { en: 'Suggested to bill: {ITEMS}', 'zh-CN': '建议收费：{ITEMS}', 'zh-Hant': '建議收費：{ITEMS}' },
        'xw.chartTitle': { en: 'X-rays of this tooth: {LIST}', 'zh-CN': '此牙位的X光片：{LIST}', 'zh-Hant': '此牙位的X光片：{LIST}' },
        'xw.hub': { en: 'X-rays', 'zh-CN': 'X光', 'zh-Hant': 'X光' },
        'xw.hubNew': { en: 'To review', 'zh-CN': '待审阅', 'zh-Hant': '待審閱' },
        'xw.openXrays': { en: 'Open X-rays', 'zh-CN': '打开X光', 'zh-Hant': '開啟X光' }
    };
    if (typeof I18N_STRINGS !== 'undefined') {
        Object.keys(MORE).forEach(function (k) { I18N_STRINGS[k] = MORE[k]; });
    }
})();

var XRAY_WIRE = {
    pending: null,
    films: {},
    inflight: {},
    hooked: false
};

function xrayWireTr(key, repl) {
    var s = (typeof t === 'function') ? t(key) : key;
    Object.keys(repl || {}).forEach(function (k) { s = String(s).split('{' + k + '}').join(repl[k]); });
    return s;
}

function xrayWireEsc(s) {
    if (typeof esc === 'function') return esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function xrayWireEl(id) {
    return (typeof document !== 'undefined') ? document.getElementById(id) : null;
}

function xrayWireToast(msg, opts) {
    if (typeof showAppGlobalToast === 'function') showAppGlobalToast(msg, opts || {});
}

function xrayWireDay(x) {
    return String((x && (x.taken_date || x.created_at)) || '').slice(0, 10);
}

/* ── deep link: open one film (or a tooth's films) ───────────── */

function xrayWireOpenFilm(pid, id, tooth) {
    var p = pid ? String(pid) : '';
    XRAY_WIRE.pending = { pid: p, id: id ? String(id) : '', tooth: tooth ? String(tooth) : '', at: Date.now() };
    var stamp = XRAY_WIRE.pending.at;
    function go() {
        if (typeof switchConTab === 'function') switchConTab('xrays');
        xrayWireConsumeOpen();
        setTimeout(function () {
            var cur = XRAY_WIRE.pending;
            if (cur && cur.at === stamp) {
                XRAY_WIRE.pending = null;
                if (cur.id) xrayWireToast(xrayWireTr('xw.gone'));
            }
        }, 6500);
    }
    var here = (typeof conPatientId !== 'undefined') ? conPatientId : null;
    if (p && String(here || '') !== p && typeof openConForPatient === 'function') {
        openConForPatient(p);
        setTimeout(go, 220);
    } else {
        go();
    }
}

function xrayWireClearFilters(rec) {
    if (typeof XRAY_CTX !== 'undefined') {
        XRAY_CTX.revFilter = '';
        XRAY_CTX.toothFilter = [];
        XRAY_CTX.toothBad = false;
    }
    var tf = xrayWireEl('xrayFilterTooth');
    if (tf) tf.value = '';
    var chips = xrayWireEl('xrayCtxRevChips');
    if (chips) {
        chips.querySelectorAll('[data-rev]').forEach(function (b) {
            b.classList.toggle('active', (b.getAttribute('data-rev') || '') === '');
        });
    }
    ['xrayFilterType', 'xrayFilterYear', 'xrayFilterSearch'].forEach(function (id) {
        var el = xrayWireEl(id);
        if (el) el.value = '';
    });
    if (typeof xrayFillTypeChips === 'function') xrayFillTypeChips();
    if (rec && rec._isHome === false && typeof xrayClinicScope !== 'undefined' && xrayClinicScope !== 'all') {
        xrayClinicScope = 'all';
        if (typeof xrayFillClinicScopeSelect === 'function') xrayFillClinicScopeSelect();
    }
    if (typeof xraySetWhenFilter === 'function') xraySetWhenFilter('');
    else if (typeof filterXrays === 'function') filterXrays();
}

function xrayWireConsumeOpen() {
    var p = XRAY_WIRE.pending;
    if (!p) return;
    if (typeof xrayAllRecords === 'undefined' || !xrayAllRecords || !xrayAllRecords.length) return;
    if (p.pid && String(typeof xrayPatientId !== 'undefined' ? xrayPatientId : '') !== p.pid) return;
    if (p.tooth) {
        XRAY_WIRE.pending = null;
        xrayWireClearFilters(null);
        var tf = xrayWireEl('xrayFilterTooth');
        if (tf && typeof xrayCtxOnToothInput === 'function') {
            tf.value = p.tooth;
            xrayCtxOnToothInput();
        }
        return;
    }
    var rec = null;
    for (var i = 0; i < xrayAllRecords.length; i++) {
        if (String(xrayAllRecords[i].id) === p.id) { rec = xrayAllRecords[i]; break; }
    }
    if (!rec) return;
    XRAY_WIRE.pending = null;
    function idx() {
        for (var j = 0; j < xrayFiltered.length; j++) {
            if (String(xrayFiltered[j].id) === p.id) return j;
        }
        return -1;
    }
    var at = idx();
    if (at < 0) {
        xrayWireClearFilters(rec);
        at = idx();
    }
    if (at >= 0 && typeof openLightbox === 'function') openLightbox(at);
    else xrayWireToast(xrayWireTr('xw.gone'));
}

/* ── "X-rays this visit" bar + suggested bill items ──────────── */

var XRAY_WIRE_BILL_RULES = [
    { types: ['Panoramic'], item: 'ORTHOPANTOMOGRAM (OPG) - 環口腔X光片' },
    { types: ['Cephalometric'], item: 'LATERAL CEPH XRAY' },
    { types: ['CBCT'], item: '' },
    { types: null, item: 'X-RAY - 口內X光片' }
];

function xrayWireCatalogPrice(name) {
    var cat = (typeof TREATMENT_ITEMS_CATALOG !== 'undefined' && Array.isArray(TREATMENT_ITEMS_CATALOG)) ? TREATMENT_ITEMS_CATALOG : [];
    for (var i = 0; i < cat.length; i++) {
        if (cat[i].item_name === name) return cat[i].unit_price;
    }
    return null;
}

function xrayWireBillLines(films) {
    var counts = {};
    var order = [];
    (films || []).forEach(function (x) {
        var type = String(x.xray_type || '');
        var rule = null;
        for (var i = 0; i < XRAY_WIRE_BILL_RULES.length; i++) {
            var r = XRAY_WIRE_BILL_RULES[i];
            if (r.types === null || r.types.indexOf(type) >= 0) { rule = r; break; }
        }
        if (!rule || !rule.item) return;
        if (!counts[rule.item]) { counts[rule.item] = 0; order.push(rule.item); }
        counts[rule.item]++;
    });
    return order.map(function (name) {
        return { name: name, qty: counts[name], price: xrayWireCatalogPrice(name) };
    });
}

function xrayWireVisitFilms() {
    var rows = (typeof xrayAllRecords !== 'undefined' && xrayAllRecords) ? xrayAllRecords : [];
    var today = (typeof xrayCtxToday === 'function') ? xrayCtxToday() : new Date().toISOString().slice(0, 10);
    return rows.filter(function (x) {
        if (x._isHome === false) return false;
        var d = String(x.taken_date || '').slice(0, 10);
        return typeof xrayCtxMatchesVisit === 'function' ? xrayCtxMatchesVisit(x, d, today) : d === today;
    });
}

function xrayWireRenderVisitBar() {
    var host = xrayWireEl('xrayVisitBar');
    if (!host) return;
    var films = xrayWireVisitFilms();
    if (!films.length) {
        host.hidden = true;
        host.innerHTML = '';
        return;
    }
    var byType = {};
    films.forEach(function (x) {
        var label = typeof xrayTypeLabel === 'function' ? xrayTypeLabel(x.xray_type) : (x.xray_type || '');
        byType[label] = (byType[label] || 0) + 1;
    });
    var parts = Object.keys(byType).map(function (k) { return byType[k] > 1 ? byType[k] + ' × ' + k : k; });
    var html = '<span class="xvb-title">🩻 ' + xrayWireEsc(xrayWireTr('xw.visitBar')) + '</span>' +
        '<span class="xvb-count">' + xrayWireEsc(xrayWireTr('xw.films', { N: films.length })) + '</span>' +
        '<span class="xvb-types">' + xrayWireEsc(parts.join(' · ')) + '</span>';
    var pending = (typeof XRAY_CTX !== 'undefined' && XRAY_CTX.ok === true)
        ? films.filter(function (x) { return x.review_status !== 'reviewed'; }).length : 0;
    if (pending) {
        html += '<button type="button" class="xvb-chip xvb-chip--new" data-no-click-guard="1" onclick="xrayCtxSetRev(\'new\')">' +
            xrayWireEsc(xrayWireTr('xw.toReview', { N: pending })) + '</button>';
    }
    var lines = xrayWireBillLines(films);
    if (lines.length) {
        html += '<span class="xvb-suggest"><span class="xvb-suggest-lbl">' + xrayWireEsc(xrayWireTr('xw.suggest')) + ':</span> ' +
            lines.map(function (l) {
                return '<span class="xvb-item">' + xrayWireEsc(l.name) + ' ×' + l.qty +
                    (l.price != null ? ' @' + l.price : '') + '</span>';
            }).join('') +
            '</span><button type="button" class="xvb-bill" data-no-click-guard="1" onclick="xrayWireOpenBilling()">' +
            xrayWireEsc(xrayWireTr('xw.openBill')) + '</button>';
    }
    host.innerHTML = html;
    host.hidden = false;
}

function xrayWireOpenBilling() {
    var lines = xrayWireBillLines(xrayWireVisitFilms());
    if (typeof openBillFromConsultation === 'function') openBillFromConsultation();
    if (lines.length) {
        xrayWireToast(xrayWireTr('xw.billToast', {
            ITEMS: lines.map(function (l) { return l.name + ' ×' + l.qty; }).join(', ')
        }), { duration: 9000 });
    }
}

/* ── dental chart: films per tooth ───────────────────────────── */

function xrayWireStoreFilms(pid, rows) {
    XRAY_WIRE.films[String(pid)] = {
        at: Date.now(),
        rows: (rows || []).filter(function (x) { return x && Array.isArray(x.teeth) && x.teeth.length; }).map(function (x) {
            return { id: x.id, teeth: x.teeth, xray_type: x.xray_type, taken_date: x.taken_date || '' };
        })
    };
}

function xrayWireLoadChartFilms(pid) {
    var key = String(pid);
    if (XRAY_WIRE.inflight[key]) return;
    if (typeof XRAY_CTX !== 'undefined' && XRAY_CTX.ok === false) return;
    if (typeof SB === 'undefined' || !SB || !SB.from) return;
    XRAY_WIRE.inflight[key] = true;
    Promise.resolve(SB.from('xrays').select('id,teeth,taken_date,xray_type,patient_id')
        .eq('patient_id', pid).order('taken_date', { ascending: false }))
        .then(function (r) {
            xrayWireStoreFilms(pid, (r && !r.error && r.data) ? r.data : []);
        }, function () { xrayWireStoreFilms(pid, []); })
        .then(function () {
            XRAY_WIRE.inflight[key] = false;
            xrayWirePaintChart();
        });
}

function xrayWireToothFilms(rows) {
    var map = {};
    (rows || []).forEach(function (f) {
        f.teeth.forEach(function (tn) {
            if (!/^[1-8][1-8]$/.test(tn)) return;
            (map[tn] = map[tn] || []).push(f);
        });
    });
    return map;
}

function xrayWirePaintChart() {
    if (typeof document === 'undefined') return;
    var cells = document.querySelectorAll('.tooth-cell');
    document.querySelectorAll('.tooth-xr-badge').forEach(function (b) { b.remove(); });
    var pid = (typeof chartPatientId !== 'undefined') ? chartPatientId : null;
    if (!pid || !cells.length) return;
    var c = XRAY_WIRE.films[String(pid)];
    if (!c || Date.now() - c.at > 60000) xrayWireLoadChartFilms(pid);
    if (!c) return;
    var map = xrayWireToothFilms(c.rows);
    cells.forEach(function (cell) {
        var tn = String(cell.id || '').replace('tooth-cell-', '');
        var list = map[tn];
        if (!list || !list.length) return;
        var lower = cell.parentNode && cell.parentNode.dataset && cell.parentNode.dataset.chartArch === 'lower';
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tooth-xr-badge' + (lower ? ' tooth-xr-badge--low' : '');
        b.setAttribute('data-no-click-guard', '1');
        b.setAttribute('data-tn', tn);
        b.title = xrayWireTr('xw.chartTitle', {
            LIST: list.map(function (f) {
                return (typeof xrayTypeLabel === 'function' ? xrayTypeLabel(f.xray_type) : (f.xray_type || '')) +
                    (f.taken_date ? ' ' + String(f.taken_date).slice(0, 10) : '');
            }).join(', ')
        });
        b.textContent = '🩻' + (list.length > 1 ? list.length : '');
        b.addEventListener('click', function (ev) {
            ev.stopPropagation();
            xrayWireOpenFilm(pid, list.length === 1 ? list[0].id : '', list.length === 1 ? '' : tn);
        });
        cell.appendChild(b);
    });
}

/* ── hooks into the existing screens ─────────────────────────── */

function xrayWireHook() {
    if (XRAY_WIRE.hooked) return;
    if (typeof window.filterXrays !== 'function') return;
    XRAY_WIRE.hooked = true;
    var baseFilter = window.filterXrays;
    window.filterXrays = function () {
        var out = baseFilter.apply(this, arguments);
        try {
            if (typeof xrayPatientId !== 'undefined' && xrayPatientId && typeof xrayAllRecords !== 'undefined') {
                xrayWireStoreFilms(xrayPatientId, (xrayAllRecords || []).filter(function (x) { return x._isHome !== false; }));
            }
            xrayWireRenderVisitBar();
            xrayWireConsumeOpen();
            xrayWirePaintChart();
        } catch (e) { console.error('[xray-wire]', e); }
        return out;
    };
    ['refreshAllTeeth', 'renderChartShell'].forEach(function (name) {
        var base = window[name];
        if (typeof base !== 'function' || base._xw) return;
        var wrapped = function () {
            var out = base.apply(this, arguments);
            try { xrayWirePaintChart(); } catch (e) { console.error('[xray-wire]', e); }
            return out;
        };
        wrapped._xw = true;
        window[name] = wrapped;
    });
}

xrayWireHook();
