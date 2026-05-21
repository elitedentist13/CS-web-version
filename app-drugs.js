// ════════════════════════════════════════════════════════════════
// APP-DRUGS.JS  —  Standalone Drug Masterlist Editor
// Dashboard card "Drug Book" → full-screen drugSection
// Data source: druglist table
// Schema: id, drug_name, category, dosage, frequency, duration,
//         route, remarks, dentist_name, dentist_id, is_active,
//         created_at
// ════════════════════════════════════════════════════════════════

// ── Module state ─────────────────────────────────────────────
var drugMasterList  = [];   // local cache of all drugs
var drugSelectedId  = null; // id of drug currently in editor
var drugIsDirty     = false;// unsaved changes flag
var drugFilterCat   = '';   // active category filter
var drugSearchTimer = null; // debounce handle

var DRUG_UNCAT_KEY = 'Uncategorised';

var DRUG_CATEGORY_PAIRS = [
    ['Antibiotic',     'drug.cat.antibiotic'],
    ['Analgesic',      'drug.cat.analgesic'],
    ['Antiseptic',     'drug.cat.antiseptic'],
    ['Steroid',        'drug.cat.steroid'],
    ['Antifungal',     'drug.cat.antifungal'],
    ['Antiviral',      'drug.cat.antiviral'],
    ['Anaesthetic',    'drug.cat.anaesthetic'],
    ['Antihistamine',  'drug.cat.antihistamine'],
    ['Fluoride',       'drug.cat.fluoride'],
    ['Gastroprotect',  'drug.cat.gastroprotect'],
    ['Other',          'drug.cat.other']
];

var DRUG_DATALIST_PAIRS = DRUG_CATEGORY_PAIRS.concat([
    ['Anti-inflammatory',    'drug.cat.antiInflammatory'],
    ['Local Anaesthetic',    'drug.cat.localAnaesthetic'],
    ['Sedative',             'drug.cat.sedative'],
    ['Vitamin / Supplement', 'drug.cat.vitaminSupplement'],
    ['Mouthwash',            'drug.cat.mouthwash']
]);

function drugTr(key) {
    return typeof t === 'function' ? t(key) : key;
}

function drugTrRepl(key, pairs) {
    var s = drugTr(key);
    if (!pairs) return s;
    for (var k in pairs) {
        if (Object.prototype.hasOwnProperty.call(pairs, k)) {
            s = s.split('{' + k + '}').join(String(pairs[k]));
        }
    }
    return s;
}

function drugCatKey(cat) {
    return (cat || DRUG_UNCAT_KEY).trim();
}

function drugCategoryLabel(cat) {
    var s = String(cat || '').trim();
    if (!s || s === DRUG_UNCAT_KEY) return drugTr('drug.uncategorised');
    var pairs = DRUG_DATALIST_PAIRS;
    var i;
    for (i = 0; i < pairs.length; i++) {
        if (pairs[i][0] === s) return drugTr(pairs[i][1]);
    }
    if (/^other$/i.test(s)) return drugTr('drug.cat.other');
    return s;
}

function refreshDrugCategoryDatalist() {
    var dl = g('drugCategoryList');
    if (!dl) return;
    var html = '';
    DRUG_DATALIST_PAIRS.forEach(function(pair) {
        html += '<option value="' + esc(pair[0]) + '">' + esc(drugTr(pair[1])) + '</option>';
    });
    dl.innerHTML = html;
}

function drugCatDisplay(cat) {
    return drugCategoryLabel(cat === DRUG_UNCAT_KEY ? '' : cat);
}

function refreshDrugCategorySelect() {
    var sel = g('dlCategory');
    if (!sel) return;
    var prev = sel.value;
    var html = '<option value="">' + esc(drugTr('patient.form.select')) + '</option>';
    DRUG_CATEGORY_PAIRS.forEach(function(pair) {
        html += '<option value="' + esc(pair[0]) + '">' + esc(drugTr(pair[1])) + '</option>';
    });
    sel.innerHTML = html;
    if (prev) sel.value = prev;
}

function refreshDrugBookI18n() {
    var sec = g('drugSection');
    var visible = sec && sec.style.display !== 'none';
    if (sec && typeof applyI18nInRoot === 'function') {
        if (drugMasterList.length || visible) applyI18nInRoot(sec);
    }
    refreshDrugCategoryDatalist();
    if (drugSelectedId) {
        var d = drugMasterList.find(function(x) { return x.id === drugSelectedId; });
        if (d) {
            updateDrugEditorTitle(d.drug_name);
            var createdEl = g('deCreatedAt');
            if (createdEl) {
                createdEl.textContent = d.created_at ? fmtDateTime(d.created_at) : '—';
            }
        } else {
            updateDrugEditorTitle(drugTr('drug.newDrugTitle'));
        }
    } else {
        updateDrugEditorTitle('');
    }
    if (drugMasterList.length) {
        renderDrugCatFilter();
        renderDrugList();
    }
    if (!visible) return;
    setSaveBtn(false);
}

// ════════════════════════════════════════════════════════════════
// INIT  (called by card-drugbook click in app.js)
// ════════════════════════════════════════════════════════════════
function initDrugs() {
    showOnly('drugSection');
    drugSelectedId = null;
    drugIsDirty    = false;
    drugFilterCat  = '';
    drugMasterList = [];

    var si = document.getElementById('drugSearchInput');
    if (si) si.value = '';

    resetDrugEditor();
    loadDrugMaster();

    // ✅ Re-attach search listener every time Drug Book opens
    if (si) {
        si.removeEventListener('input', onDrugSearch);
        si.addEventListener('input', onDrugSearch);
    }
}


// ════════════════════════════════════════════════════════════════
// LOAD ALL DRUGS FROM SUPABASE  ←  table: druglist
// ════════════════════════════════════════════════════════════════
function loadDrugMaster() {
    setDrugListLoading(true);

    SB.from('druglist')
        .select('*')
        .order('category',   { ascending: true })
        .order('drug_name',  { ascending: true })
    .then(function(r) {
        setDrugListLoading(false);

        if (r.error) {
            showDrugListError(r.error.message);
            return;
        }

        drugMasterList = r.data || [];
        renderDrugCatFilter();
        renderDrugList();
    });
}

// ════════════════════════════════════════════════════════════════
// RENDER CATEGORY FILTER PILLS
// ════════════════════════════════════════════════════════════════
function renderDrugCatFilter() {
    var wrap = g('drugCatPills');
    if (!wrap) return;

    // collect unique categories
    var cats = [];
    drugMasterList.forEach(function(d) {
        var c = drugCatKey(d.category);
        if (cats.indexOf(c) === -1) cats.push(c);
    });
    cats.sort();

    wrap.innerHTML = '';

    // "All" pill
    var all = document.createElement('button');
    all.className   = 'drug-cat-pill' + (drugFilterCat === '' ? ' active' : '');
    all.textContent = drugTrRepl('drug.allPill', { N: drugMasterList.length });
    all.addEventListener('click', function() {
        drugFilterCat = '';
        renderDrugCatFilter();
        renderDrugList();
    });
    wrap.appendChild(all);

    cats.forEach(function(c) {
        var count = drugMasterList.filter(function(d) {
            return drugCatKey(d.category) === c;
        }).length;

        var pill = document.createElement('button');
        pill.className   = 'drug-cat-pill' + (drugFilterCat === c ? ' active' : '');
        pill.textContent = drugCatDisplay(c) + ' (' + count + ')';
        pill.addEventListener('click', function() {
            drugFilterCat = c;
            renderDrugCatFilter();
            renderDrugList();
        });
        wrap.appendChild(pill);
    });
}

// ════════════════════════════════════════════════════════════════
// RENDER DRUG LIST  (left panel)
// ════════════════════════════════════════════════════════════════
function renderDrugList() {
    var wrap = g('drugListWrap');
    if (!wrap) return;

    var q = ((g('drugSearchInput') || {}).value || '').toLowerCase().trim();

    var filtered = drugMasterList.filter(function(d) {
        var catMatch = !drugFilterCat ||
            drugCatKey(d.category) === drugFilterCat;
        var qMatch   = !q ||
            (d.drug_name    || '').toLowerCase().indexOf(q) !== -1 ||
            (d.category     || '').toLowerCase().indexOf(q) !== -1 ||
            (d.dosage       || '').toLowerCase().indexOf(q) !== -1 ||
            (d.route        || '').toLowerCase().indexOf(q) !== -1 ||
            (d.dentist_name || '').toLowerCase().indexOf(q) !== -1 ||
            (d.remarks      || '').toLowerCase().indexOf(q) !== -1;
        return catMatch && qMatch;
    });

    if (!filtered.length) {
        wrap.innerHTML =
            '<div class="drug-empty">' +
            (drugMasterList.length
                ? drugTr('drug.noMatch')
                : drugTr('drug.noDrugsYet')) +
            '</div>';
        return;
    }

    // group by category
    var groups = {};
    var order  = [];
    filtered.forEach(function(d) {
        var c = drugCatKey(d.category);
        if (!groups[c]) { groups[c] = []; order.push(c); }
        groups[c].push(d);
    });

    wrap.innerHTML = '';

    order.forEach(function(cat) {
        // group header
        var header = document.createElement('div');
        header.className = 'drug-group-header';
        header.textContent = drugCatDisplay(cat) + ' (' + groups[cat].length + ')';
        wrap.appendChild(header);

        groups[cat].forEach(function(d) {
            var item = document.createElement('div');
            item.className =
                'drug-list-item' +
                (d.id === drugSelectedId ? ' selected' : '') +
                (!d.is_active ? ' inactive' : '');
            item.dataset.id = d.id;

            // meta line: dosage · frequency · route
            var meta = [d.dosage, d.frequency, d.route]
                .filter(Boolean).join(' · ');

            // dentist badge if present
            var dentistBadge = d.dentist_name
                ? '<span class="dli-dentist">👤 ' + esc(d.dentist_name) + '</span>'
                : '';

            // inactive badge
            var inactiveBadge = !d.is_active
                ? '<span class="dli-inactive-badge">' + esc(drugTr('drug.inactive')) + '</span>'
                : '';

            item.innerHTML =
                '<div class="dli-name">' + esc(d.drug_name) + inactiveBadge + '</div>' +
                '<div class="dli-meta">' + esc(meta) + dentistBadge + '</div>';

            item.addEventListener('click', function() {
                if (drugIsDirty) {
                    if (!confirm(drugTr('drug.confirmDiscardSwitch')))
                        return;
                }
                selectDrugItem(d.id);
            });

            wrap.appendChild(item);
        });
    });
}

// ════════════════════════════════════════════════════════════════
// SELECT A DRUG  →  populate editor
// ════════════════════════════════════════════════════════════════
function selectDrugItem(id) {
    var d = drugMasterList.find(function(x) { return x.id === id; });
    if (!d) return;

    drugSelectedId = id;
    drugIsDirty    = false;

    renderDrugList(); // refresh highlight

    // show editor, hide placeholder
    var editor      = g('drugEditorWrap');
    var placeholder = g('drugEditorPlaceholder');
    if (editor)      editor.style.display      = 'block';
    if (placeholder) placeholder.style.display = 'none';

    // ── populate all fields ──────────────────────────────────
    sv('deDrugName',    d.drug_name    || '');
    sv('deCategory',    d.category     || '');
    sv('deDosage',      d.dosage       || '');
    sv('deFrequency',   d.frequency    || '');
    sv('deDuration',    d.duration     || '');
    sv('deRoute',       d.route        || '');
    sv('deRemarks',     d.remarks      || '');
    sv('deDentistName', d.dentist_name || '');

    // read-only / display fields
    var createdEl = g('deCreatedAt');
    if (createdEl) {
        createdEl.textContent = d.created_at
            ? fmtDateTime(d.created_at)
            : '—';
    }

    var idEl = g('deDrugId');
    if (idEl) idEl.textContent = d.id || '—';

    // active toggle
    var activeToggle = g('deIsActive');
    if (activeToggle) activeToggle.checked = !!d.is_active;

    updateDrugEditorTitle(d.drug_name);
    setDrugDirty(false);

    // show delete button for existing records
    var delBtn = g('btnDrugDelete');
    if (delBtn) delBtn.style.display = 'inline-block';
}

// ════════════════════════════════════════════════════════════════
// NEW DRUG  —  clear editor for a fresh entry
// ════════════════════════════════════════════════════════════════
function newDrugItem() {
    if (drugIsDirty) {
        if (!confirm(drugTr('drug.confirmDiscardNew')))
            return;
    }

    drugSelectedId = null;
    drugIsDirty    = false;

    renderDrugList(); // deselect all items

    var editor      = g('drugEditorWrap');
    var placeholder = g('drugEditorPlaceholder');
    if (editor)      editor.style.display      = 'block';
    if (placeholder) placeholder.style.display = 'none';

    // clear all editable fields
    sv('deDrugName',    '');
    sv('deCategory',    '');
    sv('deDosage',      '');
    sv('deFrequency',   '');
    sv('deDuration',    '');
    sv('deRoute',       '');
    sv('deRemarks',     '');
    sv('deDentistName', currentName || ''); // pre-fill with logged-in user

    // clear read-only display fields
    var createdEl = g('deCreatedAt');
    if (createdEl) createdEl.textContent = drugTr('drug.labelNew');

    var idEl = g('deDrugId');
    if (idEl) idEl.textContent = drugTr('drug.labelNew');

    // active toggle defaults to true
    var activeToggle = g('deIsActive');
    if (activeToggle) activeToggle.checked = true;

    updateDrugEditorTitle(drugTr('drug.newDrugTitle'));
    setDrugDirty(false);

    // hide delete button — nothing to delete yet
    var delBtn = g('btnDrugDelete');
    if (delBtn) delBtn.style.display = 'none';

    // focus first field
    var nameEl = g('deDrugName');
    if (nameEl) nameEl.focus();
}

// ════════════════════════════════════════════════════════════════
// SAVE DRUG  (insert or update)  →  table: druglist
// ════════════════════════════════════════════════════════════════
function saveDrugMaster() {
    var nameEl = g('deDrugName');
    var name   = (nameEl ? nameEl.value : '').trim();

    if (!name) {
        alert(drugTr('drug.alertNameRequired'));
        if (nameEl) nameEl.focus();
        return;
    }

    var activeEl     = g('deIsActive');
    var dentistNameV = (g('deDentistName') ? g('deDentistName').value : '').trim();

    var payload = {
        drug_name:    name,
        category:     (g('deCategory')  ? g('deCategory').value.trim()  : '') || null,
        dosage:       (g('deDosage')    ? g('deDosage').value.trim()    : '') || null,
        frequency:    (g('deFrequency') ? g('deFrequency').value.trim() : '') || null,
        duration:     (g('deDuration')  ? g('deDuration').value.trim()  : '') || null,
        route:        (g('deRoute')     ? g('deRoute').value.trim()     : '') || null,
        remarks:      (g('deRemarks')   ? g('deRemarks').value.trim()   : '') || null,
        dentist_name: dentistNameV || null,
        is_active:    activeEl ? activeEl.checked : true
    };

    // attach dentist_id from global session if available
    if (typeof currentUserId !== 'undefined' && currentUserId) {
        payload.dentist_id = currentUserId;
    }

    var isNew   = !drugSelectedId;
    var promise = isNew
        ? SB.from('druglist').insert([payload]).select().single()
        : SB.from('druglist').update(payload)
              .eq('id', drugSelectedId).select().single();

    setSaveBtn(true);

    promise.then(function(r) {
        setSaveBtn(false);

        if (r.error) {
            alert(drugTrRepl('drug.alertSaveFailed', { MSG: r.error.message }));
            return;
        }

        var saved = r.data;

        if (isNew) {
            drugMasterList.push(saved);
            drugSelectedId = saved.id;
        } else {
            var idx = drugMasterList.findIndex(function(x) {
                return x.id === drugSelectedId;
            });
            if (idx !== -1) drugMasterList[idx] = saved;
        }

        // refresh display fields with returned data
        var createdEl = g('deCreatedAt');
        if (createdEl && saved.created_at) {
            createdEl.textContent = fmtDateTime(saved.created_at);
        }
        var idEl = g('deDrugId');
        if (idEl) idEl.textContent = saved.id;

        setDrugDirty(false);
        updateDrugEditorTitle(saved.drug_name);
        renderDrugCatFilter();
        renderDrugList();

        var delBtn = g('btnDrugDelete');
        if (delBtn) delBtn.style.display = 'inline-block';

        showDrugToast(drugTrRepl('drug.toastSaved', { NAME: saved.drug_name }));
    });
}

// ════════════════════════════════════════════════════════════════
// DELETE DRUG  →  removes from druglist table
// ════════════════════════════════════════════════════════════════
function deleteDrugMaster() {
    if (!drugSelectedId) return;

    var d     = drugMasterList.find(function(x) { return x.id === drugSelectedId; });
    var label = d ? d.drug_name : drugTr('drug.thisDrug');

    if (!confirm(drugTrRepl('drug.confirmDelete', { NAME: label })))
        return;

    SB.from('druglist')
        .delete()
        .eq('id', drugSelectedId)
    .then(function(r) {
        if (r.error) {
            alert(drugTrRepl('drug.alertDeleteFailed', { MSG: r.error.message }));
            return;
        }

        drugMasterList = drugMasterList.filter(function(x) {
            return x.id !== drugSelectedId;
        });

        drugSelectedId = null;
        drugIsDirty    = false;

        resetDrugEditor();
        renderDrugCatFilter();
        renderDrugList();
        showDrugToast(drugTr('drug.toastDeleted'));
    });
}

// ════════════════════════════════════════════════════════════════
// TOGGLE ACTIVE  (quick toggle — immediate DB update)
// ════════════════════════════════════════════════════════════════
function toggleDrugActive(id, current) {
    SB.from('druglist')
        .update({ is_active: !current })
        .eq('id', id)
    .then(function(r) {
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }

        var idx = drugMasterList.findIndex(function(x) { return x.id === id; });
        if (idx !== -1) drugMasterList[idx].is_active = !current;

        // sync toggle in editor if this drug is open
        if (drugSelectedId === id) {
            var tog = g('deIsActive');
            if (tog) tog.checked = !current;
        }

        renderDrugList();
        var dName = drugMasterList[idx] ? drugMasterList[idx].drug_name : '';
        showDrugToast(!current
            ? drugTrRepl('drug.toastActivated', { NAME: dName })
            : drugTrRepl('drug.toastDeactivated', { NAME: dName }));
    });
}

// ════════════════════════════════════════════════════════════════
// SEARCH — debounced 220 ms
// ════════════════════════════════════════════════════════════════
function onDrugSearch() {
    clearTimeout(drugSearchTimer);
    drugSearchTimer = setTimeout(renderDrugList, 220);
}

// ════════════════════════════════════════════════════════════════
// EXPORT CSV  (optional utility)
// ════════════════════════════════════════════════════════════════
function exportDrugCSV() {
    if (!drugMasterList.length) {
        alert(drugTr('drug.alertNoExport'));
        return;
    }

    var headers = [
        'drug_name', 'category', 'dosage', 'frequency',
        'duration', 'route', 'remarks', 'dentist_name', 'is_active', 'created_at'
    ];

    var rows = drugMasterList.map(function(d) {
        return headers.map(function(h) {
            var v = d[h];
            if (v === null || v === undefined) v = '';
            v = String(v).replace(/"/g, '""');
            return '"' + v + '"';
        }).join(',');
    });

    var csv  = headers.join(',') + '\n' + rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var url  = URL.createObjectURL(blob);
    var a    = document.createElement('a');
    a.href     = url;
    a.download = 'druglist_' + todayISO() + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// ════════════════════════════════════════════════════════════════
// UI HELPERS
// ════════════════════════════════════════════════════════════════
function resetDrugEditor() {
    var editor      = g('drugEditorWrap');
    var placeholder = g('drugEditorPlaceholder');
    if (editor)      editor.style.display      = 'none';
    if (placeholder) placeholder.style.display = 'flex';
}

function updateDrugEditorTitle(name) {
    var el = g('drugEditorTitle');
    var def = drugTr('drug.editorTitle');
    if (el) {
        if (name) {
            el.textContent = name;
            el.removeAttribute('data-i18n');
        } else {
            el.setAttribute('data-i18n', 'drug.editorTitle');
            el.textContent = def;
        }
    }
}

function setDrugDirty(val) {
    drugIsDirty = val;
    var indicator = g('drugDirtyIndicator');
    if (indicator) indicator.style.display = val ? 'inline' : 'none';
}

function setDrugListLoading(on) {
    var wrap = g('drugListWrap');
    if (!wrap) return;
    if (on) {
        wrap.innerHTML =
            '<div class="drug-empty" style="color:#aaa;">' +
            esc(drugTr('drug.loadingList')) + '</div>';
    }
}

function showDrugListError(msg) {
    var wrap = g('drugListWrap');
    if (wrap) {
        wrap.innerHTML =
            '<div class="drug-empty" style="color:var(--danger);">' +
            esc(drugTrRepl('drug.loadError', { MSG: msg })) + '</div>';
    }
}

function setSaveBtn(loading) {
    var btn = g('btnDrugSave');
    if (!btn) return;
    btn.disabled    = loading;
    btn.textContent = loading ? drugTr('drug.btnSaving') : drugTr('drug.btnSave');
}

function showDrugToast(msg) {
    var toast = g('drugToast');
    if (!toast) return;
    toast.textContent   = msg;
    toast.style.opacity = '1';
    toast.style.display = 'block';
    setTimeout(function() {
        toast.style.opacity = '0';
        setTimeout(function() { toast.style.display = 'none'; }, 400);
    }, 2800);
}

// ════════════════════════════════════════════════════════════════
// WIRE INPUT LISTENERS FOR DIRTY-STATE TRACKING
// Called once after DOM ready — from app.js  initApp()
// ════════════════════════════════════════════════════════════════
function initDrugEditorListeners() {
    var fields = [
        'deDrugName', 'deCategory', 'deDosage',
        'deFrequency', 'deDuration', 'deRoute',
        'deRemarks', 'deDentistName'
    ];

    fields.forEach(function(fid) {
        var el = g(fid);
        if (el) {
            el.addEventListener('input', function() { setDrugDirty(true); });
        }
    });

    var tog = g('deIsActive');
    if (tog) {
        tog.addEventListener('change', function() { setDrugDirty(true); });
    }

    // search box
    var si = g('drugSearchInput');
    if (si) si.addEventListener('input', onDrugSearch);
}

document.addEventListener('DOMContentLoaded', function() {
    if (typeof refreshDrugCategorySelect === 'function') refreshDrugCategorySelect();
});

document.addEventListener('app-lang-change', function() {
    refreshDrugCategorySelect();
    refreshDrugCategoryDatalist();
    if (typeof refreshDrugBookI18n === 'function') refreshDrugBookI18n();
    var dlModal = g('drugListModal');
    if (dlModal && dlModal.style.display === 'block' &&
        typeof refreshConOpenModalsI18n === 'function') {
        refreshConOpenModalsI18n();
    }
});
