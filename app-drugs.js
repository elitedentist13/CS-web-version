// ════════════════════════════════════════════════════════════════
// APP-DRUGS.JS  —  Standalone Drug Masterlist Editor
// Dashboard card "Drug Book" → full-screen drugSection
// Data source: druglist table
    // Schema: id, drug_name, category, dosage, frequency, duration,
    //         route, intake_caution, remarks,
//         dentist_name, dentist_id, is_active, created_at
// ════════════════════════════════════════════════════════════════

var DRUG_REMARKS_LEGACY_SEP = '\u27E6|\u27E7'; /* intake | general when one column */
var DRUG_INTAKE_PRESET_LS = 'joyful_drug_intake_presets_v1';
var DRUG_GENERAL_PRESET_LS = 'joyful_drug_general_presets_v1';

var DRUG_INTAKE_PRESET_SEED = [
    'Take after meal',
    'Take before meal',
    'Take with plenty of water',
    'Do not take on empty stomach',
    '飯後服用',
    '飯前服用',
    '用開水送服'
];

var DRUG_GENERAL_PRESET_SEED = [
    'For pain',
    'As directed',
    'Complete the course',
    'Store in cool dry place',
    '止痛',
    '按醫生指示',
    '完成整個療程'
];

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

function drugLooksLikeUuid(v) {
    var s = String(v || '').trim();
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function drugResolveDoctorIdByName(name) {
    var n = String(name || '').trim().toLowerCase();
    var docs = (typeof APP_DOCTORS !== 'undefined' && Array.isArray(APP_DOCTORS)) ? APP_DOCTORS : [];
    var i;
    for (i = 0; i < docs.length; i++) {
        var d = docs[i] || {};
        var id = String(d.id || '').trim();
        if (!drugLooksLikeUuid(id)) continue;
        var a = String(d.display_name || '').trim().toLowerCase();
        var b = String(d.english_name || '').trim().toLowerCase();
        var c = String(d.chinese_name || '').trim().toLowerCase();
        if (n && (n === a || n === b || n === c)) return id;
    }
    for (i = 0; i < docs.length; i++) {
        var anyId = String((docs[i] || {}).id || '').trim();
        if (drugLooksLikeUuid(anyId)) return anyId;
    }
    return '';
}

function drugIsUuidSyntaxError(msg) {
    var m = String(msg || '').toLowerCase();
    return m.indexOf('invalid input syntax for type uuid') >= 0;
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

function drugReadPresetList(lsKey, seed) {
    try {
        var raw = localStorage.getItem(lsKey);
        if (raw) {
            var a = JSON.parse(raw);
            if (Array.isArray(a) && a.length) return a;
        }
    } catch (e) {}
    return seed.slice();
}

function drugWritePresetList(lsKey, list) {
    try {
        localStorage.setItem(lsKey, JSON.stringify(list || []));
    } catch (e) {}
}

function drugUiLang() {
    return typeof rxUiPhraseLang === 'function' ? rxUiPhraseLang() : 'en';
}

function drugUnpackRemarks(row) {
    row = row || {};
    var intakeRaw = String(row.intake_caution || '').trim();
    var generalRaw = String(row.remarks || '').trim();
    if (!intakeRaw && generalRaw.indexOf(DRUG_REMARKS_LEGACY_SEP) >= 0) {
        var sep = generalRaw.indexOf(DRUG_REMARKS_LEGACY_SEP);
        intakeRaw = generalRaw.slice(0, sep).trim();
        generalRaw = generalRaw.slice(sep + DRUG_REMARKS_LEGACY_SEP.length).trim();
    }
    var intake = typeof drugUnpackBilingualText === 'function'
        ? drugUnpackBilingualText(intakeRaw)
        : { en: intakeRaw, zh: '' };
    var general = typeof drugUnpackBilingualText === 'function'
        ? drugUnpackBilingualText(generalRaw)
        : { en: generalRaw, zh: '' };
    var uiLang = drugUiLang();
    return {
        intakeEn: intake.en,
        intakeZh: intake.zh,
        generalEn: general.en,
        generalZh: general.zh,
        intake: typeof drugFormatBilingualDisplay === 'function'
            ? drugFormatBilingualDisplay(intake.en, intake.zh, uiLang)
            : (intake.en || intake.zh),
        general: typeof drugFormatBilingualDisplay === 'function'
            ? drugFormatBilingualDisplay(general.en, general.zh, uiLang)
            : (general.en || general.zh)
    };
}

function drugPackRemarksForLegacyColumn(intake, general) {
    var i = String(intake || '').trim();
    var g = String(general || '').trim();
    if (i && g) return i + DRUG_REMARKS_LEGACY_SEP + g;
    return g || i || null;
}

function drugColumnMissing(msg, col) {
    var m = String(msg || '').toLowerCase();
    var c = String(col || '').toLowerCase();
    return m.indexOf(c) >= 0 && (m.indexOf('column') >= 0 || m.indexOf('schema') >= 0);
}

function drugEditorRecalcDefaultQty() {
    if (typeof rxComputeQuantityFromLine !== 'function') return;
    var line = drugReadEditorRxLine();
    if (typeof rxNormalizeLine === 'function') line = rxNormalizeLine(line);
    var qty = rxComputeQuantityFromLine(line);
    // quantity is computed during prescribing (days selection), not stored in catalog
}

function drugReadEditorRxLine() {
    var line = typeof rxEmptyLine === 'function' ? rxEmptyLine() : {};
    line.dosage_code = (g('deDosageSel') && g('deDosageSel').value) || '';
    line.dosage_custom = (g('deDosageCustom') && g('deDosageCustom').value) || '';
    line.frequency_code = (g('deFrequencySel') && g('deFrequencySel').value) || '';
    line.frequency_custom = (g('deFrequencyCustom') && g('deFrequencyCustom').value) || '';
    line.duration_code = (g('deDurationSel') && g('deDurationSel').value) || '';
    line.duration_custom = (g('deDurationCustom') && g('deDurationCustom').value) || '';
    return line;
}

function drugPopulatePhraseSelect(fieldType, selId) {
    var sel = g(selId);
    if (!sel || typeof rxGetPhraseOptions !== 'function') return;
    var prev = sel.value;
    var uiLang = drugUiLang();
    var opts = rxGetPhraseOptions(fieldType);
    sel.innerHTML = '<option value="">' + esc(drugTr('drug.phrasePick')) + '</option>';
    opts.forEach(function(o) {
        var k = String(o.option_key);
        var label = typeof rxPhraseOptionBilingualLabel === 'function'
            ? (rxPhraseOptionBilingualLabel(fieldType, k, uiLang) || k)
            : k;
        var opt = document.createElement('option');
        opt.value = k;
        opt.textContent = label;
        sel.appendChild(opt);
    });
    if (prev) sel.value = prev;
}

function drugRefreshPhraseSelects() {
    drugPopulatePhraseSelect('dosage', 'deDosageSel');
    drugPopulatePhraseSelect('frequency', 'deFrequencySel');
    drugPopulatePhraseSelect('duration', 'deDurationSel');
    drugUpdateAllPhrasePreviews();
}

function drugUpdatePhrasePreview(fieldType) {
    var previewId = 'de' + fieldType.charAt(0).toUpperCase() + fieldType.slice(1) + 'Preview';
    var el = g(previewId);
    if (!el) return;
    var line = drugReadEditorRxLine();
    if (typeof rxNormalizeLine === 'function') line = rxNormalizeLine(line);
    var en = typeof rxPhraseDisplay === 'function'
        ? rxPhraseDisplay(line, fieldType, 'en') : '';
    var zh = typeof rxPhraseDisplay === 'function'
        ? rxPhraseDisplay(line, fieldType, 'zh') : '';
    if (en === '—') en = '';
    if (zh === '—') zh = '';
    el.textContent = typeof drugFormatBilingualDisplay === 'function'
        ? drugFormatBilingualDisplay(en, zh, drugUiLang())
        : (en || zh);
}

function drugUpdateAllPhrasePreviews() {
    ['dosage', 'frequency', 'duration'].forEach(drugUpdatePhrasePreview);
}

function drugFillPhraseFields(d) {
    d = d || {};
    var line = typeof rxNormalizeLine === 'function'
        ? rxNormalizeLine({
            dosage: d.dosage || '',
            frequency: d.frequency || '',
            duration: d.duration || ''
        })
        : {};
    if (g('deDosageSel')) g('deDosageSel').value = line.dosage_code || '';
    if (g('deDosageCustom')) g('deDosageCustom').value = line.dosage_custom || '';
    if (g('deFrequencySel')) g('deFrequencySel').value = line.frequency_code || '';
    if (g('deFrequencyCustom')) g('deFrequencyCustom').value = line.frequency_custom || '';
    if (g('deDurationSel')) g('deDurationSel').value = line.duration_code || '';
    if (g('deDurationCustom')) g('deDurationCustom').value = line.duration_custom || '';
    drugUpdateAllPhrasePreviews();
}

function drugReadPhraseValueForSave(fieldType) {
    var line = drugReadEditorRxLine();
    if (typeof rxNormalizeLine === 'function') line = rxNormalizeLine(line);
    if (typeof rxSyncLineLegacyFields === 'function') {
        var tmp = Object.assign({}, line);
        rxSyncLineLegacyFields(tmp);
        return tmp[fieldType] || null;
    }
    var code = line[fieldType + '_code'];
    var custom = line[fieldType + '_custom'];
    return (code || custom || '').trim() || null;
}

function drugOnPhraseSelectChange(fieldType) {
    var sel = g('de' + fieldType.charAt(0).toUpperCase() + fieldType.slice(1) + 'Sel');
    var custom = g('de' + fieldType.charAt(0).toUpperCase() + fieldType.slice(1) + 'Custom');
    if (sel && sel.value && custom) custom.value = '';
    drugUpdatePhrasePreview(fieldType);
    drugEditorRecalcDefaultQty();
    setDrugDirty(true);
}

function drugOnPhraseCustomInput(fieldType) {
    var sel = g('de' + fieldType.charAt(0).toUpperCase() + fieldType.slice(1) + 'Sel');
    if (sel && sel.value) sel.value = '';
    drugUpdatePhrasePreview(fieldType);
    drugEditorRecalcDefaultQty();
    setDrugDirty(true);
}

function drugPresetListForLang(list, lang) {
    list = list || [];
    var filtered = list.filter(function(t) {
        var isCjk = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(t);
        return lang === 'zh' ? isCjk : !isCjk;
    });
    return filtered.length ? filtered : list.slice();
}

function drugPopulateRemarkPresetSelect(selId, list) {
    var sel = g(selId);
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '<option value="">' + esc(drugTr('drug.remarkPresetPick')) + '</option>';
    (list || []).forEach(function(txt) {
        var o = document.createElement('option');
        o.value = txt;
        o.textContent = txt;
        sel.appendChild(o);
    });
    if (prev) sel.value = prev;
}

function drugRefreshRemarkPresetDatalists() {
    var intakeList = drugReadPresetList(DRUG_INTAKE_PRESET_LS, DRUG_INTAKE_PRESET_SEED);
    var generalList = drugReadPresetList(DRUG_GENERAL_PRESET_LS, DRUG_GENERAL_PRESET_SEED);
    drugPopulateRemarkPresetSelect('deIntakeCautionSel', drugPresetListForLang(intakeList, 'en'));
    drugPopulateRemarkPresetSelect('deIntakeCautionZhSel', drugPresetListForLang(intakeList, 'zh'));
    drugPopulateRemarkPresetSelect('deGeneralRemarksSel', drugPresetListForLang(generalList, 'en'));
    drugPopulateRemarkPresetSelect('deGeneralRemarksZhSel', drugPresetListForLang(generalList, 'zh'));
    drugPopulateRemarkPresetSelect('dlIntakeCautionSel', drugPresetListForLang(intakeList, 'en'));
    drugPopulateRemarkPresetSelect('dlIntakeCautionZhSel', drugPresetListForLang(intakeList, 'zh'));
    drugPopulateRemarkPresetSelect('dlGeneralRemarksSel', drugPresetListForLang(generalList, 'en'));
    drugPopulateRemarkPresetSelect('dlGeneralRemarksZhSel', drugPresetListForLang(generalList, 'zh'));
    var pairs = [
        ['deIntakeCautionList', drugPresetListForLang(intakeList, 'en')],
        ['deIntakeCautionZhList', drugPresetListForLang(intakeList, 'zh')],
        ['deGeneralRemarksList', drugPresetListForLang(generalList, 'en')],
        ['deGeneralRemarksZhList', drugPresetListForLang(generalList, 'zh')],
        ['dlIntakeCautionList', drugPresetListForLang(intakeList, 'en')],
        ['dlIntakeCautionZhList', drugPresetListForLang(intakeList, 'zh')],
        ['dlGeneralRemarksList', drugPresetListForLang(generalList, 'en')],
        ['dlGeneralRemarksZhList', drugPresetListForLang(generalList, 'zh')]
    ];
    pairs.forEach(function(pair) {
        var dl = g(pair[0]);
        if (!dl) return;
        dl.innerHTML = pair[1].map(function(t) {
            return '<option value="' + esc(t) + '">';
        }).join('');
    });
}

function drugBindRemarkPresetControls() {
    function bindSel(selId, inputId) {
        var sel = g(selId);
        var inp = g(inputId);
        if (!sel || sel.dataset.drugRemarkBound) return;
        sel.dataset.drugRemarkBound = '1';
        sel.addEventListener('change', function() {
            if (!sel.value || !inp) return;
            inp.value = sel.value;
            setDrugDirty(true);
        });
    }
    bindSel('deIntakeCautionSel', 'deIntakeCaution');
    bindSel('deIntakeCautionZhSel', 'deIntakeCautionZh');
    bindSel('deGeneralRemarksSel', 'deGeneralRemarks');
    bindSel('deGeneralRemarksZhSel', 'deGeneralRemarksZh');
    bindSel('dlIntakeCautionSel', 'dlIntakeCaution');
    bindSel('dlIntakeCautionZhSel', 'dlIntakeCautionZh');
    bindSel('dlGeneralRemarksSel', 'dlGeneralRemarks');
    bindSel('dlGeneralRemarksZhSel', 'dlGeneralRemarksZh');

    function bindAdd(btnId, inputId, lsKey, seed) {
        var btn = g(btnId);
        if (!btn || btn.dataset.drugRemarkBound) return;
        btn.dataset.drugRemarkBound = '1';
        btn.addEventListener('click', function() {
            var inp = g(inputId);
            var v = (inp && inp.value || '').trim();
            if (!v) return;
            var list = drugReadPresetList(lsKey, seed);
            if (list.indexOf(v) < 0) {
                list.push(v);
                drugWritePresetList(lsKey, list);
                drugRefreshRemarkPresetDatalists();
            }
            setDrugDirty(true);
        });
    }

    function bindDel(btnId, selId, lsKey, seed) {
        var btn = g(btnId);
        if (!btn || btn.dataset.drugRemarkBound) return;
        btn.dataset.drugRemarkBound = '1';
        btn.addEventListener('click', function() {
            var sel = g(selId);
            if (!sel || !sel.value) return;
            var list = drugReadPresetList(lsKey, seed).filter(function(x) {
                return x !== sel.value;
            });
            drugWritePresetList(lsKey, list);
            drugRefreshRemarkPresetDatalists();
            sel.value = '';
            setDrugDirty(true);
        });
    }

    bindAdd('deIntakePresetAdd', 'deIntakeCaution', DRUG_INTAKE_PRESET_LS, DRUG_INTAKE_PRESET_SEED);
    bindAdd('deIntakePresetAddZh', 'deIntakeCautionZh', DRUG_INTAKE_PRESET_LS, DRUG_INTAKE_PRESET_SEED);
    bindAdd('deGeneralPresetAdd', 'deGeneralRemarks', DRUG_GENERAL_PRESET_LS, DRUG_GENERAL_PRESET_SEED);
    bindAdd('deGeneralPresetAddZh', 'deGeneralRemarksZh', DRUG_GENERAL_PRESET_LS, DRUG_GENERAL_PRESET_SEED);
    bindDel('deIntakePresetDel', 'deIntakeCautionSel', DRUG_INTAKE_PRESET_LS, DRUG_INTAKE_PRESET_SEED);
    bindDel('deIntakePresetDelZh', 'deIntakeCautionZhSel', DRUG_INTAKE_PRESET_LS, DRUG_INTAKE_PRESET_SEED);
    bindDel('deGeneralPresetDel', 'deGeneralRemarksSel', DRUG_GENERAL_PRESET_LS, DRUG_GENERAL_PRESET_SEED);
    bindDel('deGeneralPresetDelZh', 'deGeneralRemarksZhSel', DRUG_GENERAL_PRESET_LS, DRUG_GENERAL_PRESET_SEED);
}

function drugFillRemarkFields(d) {
    var packed = drugUnpackRemarks(d || {});
    sv('deIntakeCaution', packed.intakeEn);
    sv('deIntakeCautionZh', packed.intakeZh);
    sv('deGeneralRemarks', packed.generalEn);
    sv('deGeneralRemarksZh', packed.generalZh);
}

function drugBindPhraseEditorControls() {
    var fields = [
        { type: 'dosage', sel: 'deDosageSel', custom: 'deDosageCustom' },
        { type: 'frequency', sel: 'deFrequencySel', custom: 'deFrequencyCustom' },
        { type: 'duration', sel: 'deDurationSel', custom: 'deDurationCustom' }
    ];
    fields.forEach(function(f) {
        var sel = g(f.sel);
        var custom = g(f.custom);
        if (sel && !sel.dataset.drugPhraseBound) {
            sel.dataset.drugPhraseBound = '1';
            sel.addEventListener('change', function() {
                drugOnPhraseSelectChange(f.type);
            });
        }
        if (custom && !custom.dataset.drugPhraseBound) {
            custom.dataset.drugPhraseBound = '1';
            custom.addEventListener('input', function() {
                drugOnPhraseCustomInput(f.type);
            });
        }
    });
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
            drugFillPhraseFields(d);
            drugUpdateAllPhrasePreviews();
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
    drugRefreshPhraseSelects();
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

    drugRefreshRemarkPresetDatalists();
    drugBindRemarkPresetControls();
    drugBindPhraseEditorControls();
    drugRefreshPhraseSelects();
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

            // meta line: bilingual dosage · frequency · days
            var meta = typeof drugDefaultRxMetaBilingual === 'function'
                ? drugDefaultRxMetaBilingual(d)
                : [d.dosage, d.frequency, d.duration].filter(Boolean).join(' · ');

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
    drugFillPhraseFields(d);
    sv('deRoute',       d.route        || '');
    drugFillRemarkFields(d);
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
    drugFillPhraseFields({});
    sv('deRoute',       '');
    drugFillRemarkFields({});
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

    var intakeEn = (g('deIntakeCaution') ? g('deIntakeCaution').value : '').trim();
    var intakeZh = (g('deIntakeCautionZh') ? g('deIntakeCautionZh').value : '').trim();
    var generalEn = (g('deGeneralRemarks') ? g('deGeneralRemarks').value : '').trim();
    var generalZh = (g('deGeneralRemarksZh') ? g('deGeneralRemarksZh').value : '').trim();
    var intakeV = typeof drugPackBilingualText === 'function'
        ? drugPackBilingualText(intakeEn, intakeZh)
        : (intakeEn || intakeZh);
    var generalV = typeof drugPackBilingualText === 'function'
        ? drugPackBilingualText(generalEn, generalZh)
        : (generalEn || generalZh);

    var payload = {
        drug_name:    name,
        category:     (g('deCategory')  ? g('deCategory').value.trim()  : '') || null,
        dosage:       drugReadPhraseValueForSave('dosage'),
        frequency:    drugReadPhraseValueForSave('frequency'),
        duration:     drugReadPhraseValueForSave('duration'),
        route:        (g('deRoute')     ? g('deRoute').value.trim()     : '') || null,
        intake_caution: intakeV || null,
        remarks:      generalV || null,
        dentist_name: dentistNameV || null,
        is_active:    activeEl ? activeEl.checked : true
    };

    var isNew = !drugSelectedId;

    // dentist_id must be UUID in DB; prefer doctor UUID from session.
    var dentistId = '';
    var existing = isNew ? null : (drugMasterList.find(function(x) { return x.id === drugSelectedId; }) || null);
    if (typeof currentDoctorId !== 'undefined' && currentDoctorId && drugLooksLikeUuid(currentDoctorId)) {
        dentistId = String(currentDoctorId).trim();
    } else if (existing && existing.dentist_id && drugLooksLikeUuid(existing.dentist_id)) {
        dentistId = String(existing.dentist_id).trim();
    } else if (typeof currentUserId !== 'undefined' && currentUserId && drugLooksLikeUuid(currentUserId)) {
        dentistId = String(currentUserId).trim();
    } else {
        dentistId = drugResolveDoctorIdByName(dentistNameV || currentName || '');
    }
    if (dentistId) payload.dentist_id = dentistId;

    setSaveBtn(true);

    function runSave(sendPayload, allowUuidRetry, allowColumnFallback) {
        var p = isNew
            ? SB.from('druglist').insert([sendPayload]).select().single()
            : SB.from('druglist').update(sendPayload)
                  .eq('id', drugSelectedId).select().single();
        p.then(function(r) {
            if (r.error) {
                if (allowUuidRetry && drugIsUuidSyntaxError(r.error.message)) {
                    var retryPayload = {};
                    var k;
                    for (k in sendPayload) {
                        if (!Object.prototype.hasOwnProperty.call(sendPayload, k)) continue;
                        if (k === 'dentist_id' || k === 'dentist_name') continue;
                        retryPayload[k] = sendPayload[k];
                    }
                    runSave(retryPayload, false, allowColumnFallback);
                    return;
                }
                if (allowColumnFallback) {
                    var fb = Object.assign({}, sendPayload);
                    var merged = false;
                    if (fb.intake_caution !== undefined &&
                        drugColumnMissing(r.error.message, 'intake_caution')) {
                        fb.remarks = drugPackRemarksForLegacyColumn(
                            fb.intake_caution, fb.remarks
                        );
                        delete fb.intake_caution;
                        merged = true;
                    }
                    if (merged) {
                        runSave(fb, allowUuidRetry, false);
                        return;
                    }
                }
                setSaveBtn(false);
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

            setSaveBtn(false);
            showDrugToast(drugTrRepl('drug.toastSaved', { NAME: saved.drug_name }));
        });
    }

    runSave(payload, true, true);
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
        'duration', 'route',
        'intake_caution', 'remarks', 'dentist_name', 'is_active', 'created_at'
    ];

    var rows = drugMasterList.map(function(d) {
        var packed = drugUnpackRemarks(d);
        return headers.map(function(h) {
            var v;
            if (h === 'intake_caution') v = packed.intake;
            else if (h === 'remarks') v = packed.general;
            else v = d[h];
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
        'deDrugName', 'deCategory', 'deDosageCustom', 'deFrequencyCustom', 'deDurationCustom',
        'deRoute',
        'deIntakeCaution', 'deIntakeCautionZh', 'deGeneralRemarks', 'deGeneralRemarksZh',
        'deDentistName'
    ];

    fields.forEach(function(fid) {
        var el = g(fid);
        if (el) {
            el.addEventListener('input', function() { setDrugDirty(true); });
        }
    });

    drugBindPhraseEditorControls();
    drugBindRemarkPresetControls();
    drugRefreshRemarkPresetDatalists();
    drugRefreshPhraseSelects();

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
