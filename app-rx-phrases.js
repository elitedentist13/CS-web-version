// ════════════════════════════════════════════════════════════════
// RX PHRASE OPTIONS — dropdown keys → full EN/ZH label text
// Table: rx_phrase_options (field_type, option_key, label_en, label_zh)
// ════════════════════════════════════════════════════════════════

/** Prescription UI fields (route omitted — dental default is oral). */
var RX_PHRASE_FIELDS = ['dosage', 'frequency', 'duration', 'quantity'];

var RX_PHRASE_DEFAULTS = {
    frequency: [
        { option_key: '1', sort_order: 10, label_en: '1 time per day', label_zh: '每日一次' },
        { option_key: '2', sort_order: 20, label_en: '2 times per day', label_zh: '每日兩次' },
        { option_key: '3', sort_order: 30, label_en: '3 times per day', label_zh: '每日三次' },
        { option_key: '4', sort_order: 40, label_en: '4 times per day', label_zh: '每日四次' },
        { option_key: 'BD', sort_order: 50, label_en: 'Twice daily (BD)', label_zh: '每日兩次 (BD)' },
        { option_key: 'TDS', sort_order: 60, label_en: 'Three times daily (TDS)', label_zh: '每日三次 (TDS)' },
        { option_key: 'QID', sort_order: 70, label_en: 'Four times daily (QID)', label_zh: '每日四次 (QID)' },
        { option_key: 'QHS', sort_order: 80, label_en: 'At bedtime (QHS)', label_zh: '睡前服用 (QHS)' },
        { option_key: 'PRN', sort_order: 90, label_en: 'As needed (PRN)', label_zh: '需要時服用 (PRN)' },
        { option_key: 'STAT', sort_order: 100, label_en: 'Immediately (STAT)', label_zh: '立即服用 (STAT)' }
    ],
    dosage: [
        { option_key: '1', sort_order: 5, label_en: '', label_zh: '' },
        { option_key: '1 tab', sort_order: 10, label_en: '', label_zh: '' },
        { option_key: '2', sort_order: 15, label_en: '', label_zh: '' },
        { option_key: '2 tab', sort_order: 20, label_en: '', label_zh: '' },
        { option_key: '3', sort_order: 25, label_en: '', label_zh: '' },
        { option_key: '3 tab', sort_order: 30, label_en: '', label_zh: '' },
        { option_key: '1/2 tab', sort_order: 35, label_en: '', label_zh: '' },
        { option_key: '5ml', sort_order: 40, label_en: '', label_zh: '' },
        { option_key: '10ml', sort_order: 50, label_en: '', label_zh: '' },
        { option_key: '250mg', sort_order: 60, label_en: '', label_zh: '' },
        { option_key: '500mg', sort_order: 70, label_en: '', label_zh: '' },
        { option_key: '1 puff', sort_order: 80, label_en: '', label_zh: '' }
    ],
    duration: [
        { option_key: '1', sort_order: 10, label_en: '1 day', label_zh: '1日' },
        { option_key: '3', sort_order: 20, label_en: '3 days', label_zh: '3日' },
        { option_key: '5', sort_order: 30, label_en: '5 days', label_zh: '5日' },
        { option_key: '7', sort_order: 40, label_en: '7 days (1 week)', label_zh: '7日（1星期）' },
        { option_key: '10', sort_order: 50, label_en: '10 days', label_zh: '10日' },
        { option_key: '14', sort_order: 60, label_en: '14 days (2 weeks)', label_zh: '14日（2星期）' }
    ],
    route: [
        { option_key: 'PO', sort_order: 10, label_en: 'Oral (PO)', label_zh: '口服 (PO)' },
        { option_key: 'SL', sort_order: 20, label_en: 'Sublingual (SL)', label_zh: '舌下 (SL)' },
        { option_key: 'TOP', sort_order: 30, label_en: 'Topical', label_zh: '外用' },
        { option_key: 'GAR', sort_order: 40, label_en: 'Gargle', label_zh: '漱口' },
        { option_key: 'INH', sort_order: 50, label_en: 'Inhalation', label_zh: '吸入' }
    ],
    quantity: [
        { option_key: '10', sort_order: 10, label_en: '10', label_zh: '10' },
        { option_key: '15', sort_order: 20, label_en: '15', label_zh: '15' },
        { option_key: '20', sort_order: 30, label_en: '20', label_zh: '20' },
        { option_key: '30', sort_order: 40, label_en: '30', label_zh: '30' },
        { option_key: '60', sort_order: 50, label_en: '60', label_zh: '60' }
    ]
};

var rxPhraseCache = null;
var rxPhraseLoadPromise = null;
/** When true, skip Supabase rx_phrase_options (table missing or unreachable). */
var rxPhraseDbSkip = false;
var RX_PHRASE_DB_FLAG_KEY = 'jsm_rx_phrase_db_ok';

function rxPhraseDbLooksMissing(err) {
    if (!err) return false;
    var msg = String(err.message || err.details || '').toLowerCase();
    var code = String(err.code || '');
    return code === 'PGRST205' ||
        code === '42P01' ||
        msg.indexOf('does not exist') >= 0 ||
        msg.indexOf('not found') >= 0 ||
        msg.indexOf('404') >= 0;
}

function readRxPhraseDbFlag() {
    try {
        return localStorage.getItem(RX_PHRASE_DB_FLAG_KEY);
    } catch (e) {
        return null;
    }
}

function writeRxPhraseDbFlag(ok) {
    try {
        localStorage.setItem(RX_PHRASE_DB_FLAG_KEY, ok ? '1' : '0');
    } catch (e) {}
}

function rxTr(key) {
    return typeof t === 'function' ? t(key) : key;
}

function rxUiPhraseLang() {
    if (typeof appUiLang === 'string' && appUiLang.indexOf('zh') >= 0) return 'zh';
    return 'en';
}

function rxEmptyLine() {
    return {
        drug_id: '', drug_name: '',
        dosage: '', frequency: '', duration: '', route: '', quantity: '', remarks: '',
        dosage_code: '', dosage_custom: '',
        frequency_code: '', frequency_custom: '',
        duration_code: '', duration_custom: '',
        route_code: '', route_custom: '',
        quantity_code: '', quantity_custom: ''
    };
}

function rxGetPhraseOptions(fieldType) {
    if (rxPhraseCache && rxPhraseCache[fieldType] && rxPhraseCache[fieldType].length) {
        return rxPhraseCache[fieldType];
    }
    return (RX_PHRASE_DEFAULTS[fieldType] || []).slice();
}

function loadRxPhraseOptions(force) {
    if (rxPhraseLoadPromise && !force) return rxPhraseLoadPromise;

    rxPhraseLoadPromise = new Promise(function(resolve) {
        var merged = {};
        RX_PHRASE_FIELDS.forEach(function(ft) {
            merged[ft] = (RX_PHRASE_DEFAULTS[ft] || []).slice();
        });

        if (typeof SB === 'undefined') {
            rxPhraseCache = merged;
            resolve(rxPhraseCache);
            return;
        }

        /* Only query Supabase when table is known to exist (localStorage flag "1"). */
        if (readRxPhraseDbFlag() !== '1') {
            rxPhraseDbSkip = true;
            if (readRxPhraseDbFlag() !== '0') {
                writeRxPhraseDbFlag(false);
            }
            rxPhraseCache = merged;
            resolve(rxPhraseCache);
            return;
        }

        SB.from('rx_phrase_options')
            .select('field_type,option_key,sort_order,label_en,label_zh,is_active')
            .eq('is_active', true)
            .order('field_type', { ascending: true })
            .order('sort_order', { ascending: true })
            .then(function(r) {
                if (r.error) {
                    if (rxPhraseDbLooksMissing(r.error)) {
                        rxPhraseDbSkip = true;
                        writeRxPhraseDbFlag(false);
                    }
                } else if (r.data && r.data.length) {
                    writeRxPhraseDbFlag(true);
                    r.data.forEach(function(row) {
                        var ft = row.field_type;
                        if (RX_PHRASE_FIELDS.indexOf(ft) < 0) return;
                        if (!merged[ft]) merged[ft] = [];
                        var exists = merged[ft].some(function(o) {
                            return String(o.option_key) === String(row.option_key);
                        });
                        if (!exists) {
                            merged[ft].push({
                                option_key: row.option_key,
                                sort_order: row.sort_order || 0,
                                label_en: row.label_en || row.option_key,
                                label_zh: row.label_zh || row.label_en || row.option_key
                            });
                        }
                    });
                    RX_PHRASE_FIELDS.forEach(function(ft) {
                        merged[ft].sort(function(a, b) {
                            return (a.sort_order || 0) - (b.sort_order || 0);
                        });
                    });
                }
                rxPhraseCache = merged;
                resolve(rxPhraseCache);
            })
            .catch(function() {
                rxPhraseDbSkip = true;
                writeRxPhraseDbFlag(false);
                rxPhraseCache = merged;
                resolve(rxPhraseCache);
            });
    });

    return rxPhraseLoadPromise;
}

function ensureRxPhrasesLoaded(cb) {
    loadRxPhraseOptions(false).then(function() {
        if (cb) cb();
    });
}

/** Tablet count from dosage code: "1", "3", "1 tab", "3 tab". */
function rxParseDosageTabletCount(code) {
    var c = String(code || '').trim();
    if (!c) return null;
    if (/^1\/2(\s*tab)?$/i.test(c)) return { half: true };
    var m = c.match(/^(\d+)\s*tab$/i) || (/^\d+$/.test(c) ? c.match(/^(\d+)$/) : null);
    if (m) return { n: parseInt(m[1], 10) };
    return null;
}

/** Chinese dosage: 每次X粒 / 每次X毫升 / … */
function rxDosageLabelZh(code) {
    var c = String(code || '').trim();
    if (!c) return '';
    var tab = rxParseDosageTabletCount(c);
    if (tab && tab.half) return '每次半粒';
    if (tab && tab.n) return '每次' + tab.n + '粒';
    var ml = c.match(/^(\d+(?:\.\d+)?)\s*ml$/i);
    if (ml) return '每次' + ml[1] + '毫升';
    var mg = c.match(/^(\d+(?:\.\d+)?)\s*mg$/i);
    if (mg) return '每次' + mg[1] + '毫克';
    var puff = c.match(/^(\d+)\s*puff$/i);
    if (puff) return '每次' + puff[1] + '下';
    var opts = rxGetPhraseOptions('dosage');
    var i;
    for (i = 0; i < opts.length; i++) {
        if (String(opts[i].option_key) === c && opts[i].label_zh) {
            return opts[i].label_zh;
        }
    }
    return c;
}

/** English dosage: X tablet(s) each time / X ml each time / … */
function rxDosageLabelEn(code) {
    var c = String(code || '').trim();
    if (!c) return '';
    var tab = rxParseDosageTabletCount(c);
    if (tab && tab.half) return 'half tablet each time';
    if (tab && tab.n) {
        return tab.n + ' ' + (tab.n === 1 ? 'tablet' : 'tablets') + ' each time';
    }
    var ml = c.match(/^(\d+(?:\.\d+)?)\s*ml$/i);
    if (ml) return ml[1] + ' ml each time';
    var mg = c.match(/^(\d+(?:\.\d+)?)\s*mg$/i);
    if (mg) return mg[1] + ' mg each time';
    var puff = c.match(/^(\d+)\s*puff$/i);
    if (puff) {
        var pn = parseInt(puff[1], 10);
        return pn + ' ' + (pn === 1 ? 'puff' : 'puffs') + ' each time';
    }
    var opts = rxGetPhraseOptions('dosage');
    var i;
    for (i = 0; i < opts.length; i++) {
        if (String(opts[i].option_key) === c && opts[i].label_en) {
            return opts[i].label_en;
        }
    }
    return c;
}

/** Chinese frequency: 每日X次 */
function rxFrequencyLabelZh(code) {
    var c = String(code || '').trim();
    if (!c) return '';
    var special = {
        QHS: '睡前服用 (QHS)',
        PRN: '需要時服用 (PRN)',
        STAT: '立即服用 (STAT)'
    };
    if (special[c]) return special[c];
    return '每日' + c + '次';
}

/** Chinese duration: X日 */
function rxDurationLabelZh(code) {
    var c = String(code || '').trim();
    if (!c) return '';
    if (/^\d+$/.test(c)) return c + '日';
    var opts = rxGetPhraseOptions('duration');
    var i;
    for (i = 0; i < opts.length; i++) {
        if (String(opts[i].option_key) === c && opts[i].label_zh) {
            return opts[i].label_zh;
        }
    }
    return c;
}

function rxMatchCodeFromLabelText(fieldType, text) {
    var t = String(text || '').trim();
    if (!t) return '';
    var low = t.toLowerCase();
    var opts = rxGetPhraseOptions(fieldType);
    var i;
    for (i = 0; i < opts.length; i++) {
        var o = opts[i];
        if (String(o.option_key).toLowerCase() === low) return o.option_key;
        if (String(o.label_en || '').toLowerCase() === low) return o.option_key;
        if (String(o.label_zh || '').trim() === t) return o.option_key;
    }
    return '';
}

function rxPhraseLabel(fieldType, code, lang) {
    if (!code) return '';
    var key = String(code).trim();
    if (fieldType === 'dosage' && lang === 'zh') return rxDosageLabelZh(key);
    if (fieldType === 'dosage' && lang === 'en') return rxDosageLabelEn(key);
    if (fieldType === 'frequency' && lang === 'zh') return rxFrequencyLabelZh(key);
    if (fieldType === 'duration' && lang === 'zh') return rxDurationLabelZh(key);
    var opts = rxGetPhraseOptions(fieldType);
    var i;
    for (i = 0; i < opts.length; i++) {
        if (String(opts[i].option_key) === key) {
            if (lang === 'zh') {
                if (fieldType === 'frequency') return rxFrequencyLabelZh(key);
                if (fieldType === 'duration') return rxDurationLabelZh(key);
            }
            return lang === 'zh'
                ? (opts[i].label_zh || opts[i].label_en || key)
                : (opts[i].label_en || opts[i].label_zh || key);
        }
    }
    return key;
}

function rxMatchCodeFromText(fieldType, text) {
    var t = String(text || '').trim();
    if (!t) return '';
    if (fieldType === 'dosage') {
        var dm = t.match(/^每次(\d+)粒$/);
        if (dm) return dm[1];
        if (t === '每次半粒') return '1/2 tab';
        var de = t.match(/^(\d+)\s+(tablet|tablets)\s+each\s+time$/i);
        if (de) return de[1] + ' tab';
        if (/^half\s+tablet\s+each\s+time$/i.test(t)) return '1/2 tab';
        var deml = t.match(/^(\d+(?:\.\d+)?)\s+ml\s+each\s+time$/i);
        if (deml) return deml[1] + 'ml';
        var demg = t.match(/^(\d+(?:\.\d+)?)\s+mg\s+each\s+time$/i);
        if (demg) return demg[1] + 'mg';
        var depf = t.match(/^(\d+)\s+puffs?\s+each\s+time$/i);
        if (depf) return depf[1] + ' puff';
    }
    if (fieldType === 'frequency') {
        var fm = t.match(/^每日(.+?)次$/);
        if (fm) return fm[1];
        var fe = t.match(/^(\d+)\s+times?\s+per\s+day$/i);
        if (fe) return fe[1];
    }
    if (fieldType === 'duration') {
        var dz = t.match(/^(\d+)日$/);
        if (dz) return dz[1];
        var de = t.match(/^(\d+)\s+days?$/i);
        if (de) return de[1];
    }
    var low = t.toLowerCase();
    var opts = rxGetPhraseOptions(fieldType);
    var i;
    for (i = 0; i < opts.length; i++) {
        var o = opts[i];
        if (String(o.option_key).toLowerCase() === low) return o.option_key;
        if (String(o.label_en || '').toLowerCase() === low) return o.option_key;
        if (String(o.label_zh || '').trim() === t) return o.option_key;
    }
    return '';
}

function rxNormalizeLine(line) {
    if (!line) return rxEmptyLine();
    RX_PHRASE_FIELDS.forEach(function(ft) {
        var codeKey = ft + '_code';
        var customKey = ft + '_custom';
        if (line[codeKey] === undefined) line[codeKey] = '';
        if (line[customKey] === undefined) line[customKey] = '';

        if (!line[codeKey] && !line[customKey] && line[ft]) {
            var matched = rxMatchCodeFromText(ft, line[ft]);
            if (matched) {
                line[codeKey] = matched;
            } else {
                line[customKey] = String(line[ft]);
            }
        }
    });
    return line;
}

function rxResolveTextToPhrase(fieldType, rawText, lang) {
    var t = String(rawText || '').trim();
    if (!t) return '';
    var code = rxMatchCodeFromText(fieldType, t);
    if (!code) code = rxMatchCodeFromLabelText(fieldType, t);
    if (code) return rxPhraseLabel(fieldType, code, lang) || t;
    return t;
}

function rxPhraseDisplay(line, fieldType, lang) {
    if (!line) return '—';
    var code = String(line[fieldType + '_code'] || '').trim();
    if (code) {
        var fromCode = rxPhraseLabel(fieldType, code, lang);
        return fromCode || code;
    }
    var custom = String(line[fieldType + '_custom'] || '').trim();
    if (custom) {
        return rxResolveTextToPhrase(fieldType, custom, lang);
    }
    var legacy = String(line[fieldType] || '').trim();
    if (legacy) {
        if (lang === 'zh') {
            var zhField = line[fieldType + '_zh'];
            if (zhField && String(zhField).trim() &&
                String(zhField).trim() !== legacy) {
                return String(zhField).trim();
            }
        }
        return rxResolveTextToPhrase(fieldType, legacy, lang);
    }
    return '—';
}

function rxSyncLineLegacyFields(line) {
    if (!line) return line;
    line.dosage    = rxPhraseDisplay(line, 'dosage', 'en');
    line.frequency = rxPhraseDisplay(line, 'frequency', 'en');
    line.duration  = rxPhraseDisplay(line, 'duration', 'en');
    line.route     = '';
    line.quantity  = rxPhraseDisplay(line, 'quantity', 'en');
    line.dosage_zh    = rxPhraseDisplay(line, 'dosage', 'zh');
    line.frequency_zh = rxPhraseDisplay(line, 'frequency', 'zh');
    line.duration_zh  = rxPhraseDisplay(line, 'duration', 'zh');
    line.route_zh     = '';
    line.quantity_zh  = rxPhraseDisplay(line, 'quantity', 'zh');
    return line;
}

function rxApplyComboTextToLine(line, fieldType, rawText) {
    if (!line) return;
    var val = String(rawText || '').trim();
    if (!val) {
        line[fieldType + '_code'] = '';
        line[fieldType + '_custom'] = '';
        return;
    }
    var code = rxMatchCodeFromText(fieldType, val);
    if (!code) code = rxMatchCodeFromLabelText(fieldType, val);
    if (code) {
        line[fieldType + '_code'] = code;
        line[fieldType + '_custom'] = '';
    } else {
        line[fieldType + '_code'] = '';
        line[fieldType + '_custom'] = val;
    }
}

function rxOnPhraseSelectChange(fieldType, idx) {
    var sel = g('rx-' + fieldType + '-sel-' + idx);
    if (!sel || !rxLines[idx]) return;
    rxApplyComboTextToLine(rxLines[idx], fieldType, sel.value || '');
    if (typeof rxSyncLineLegacyFields === 'function') rxSyncLineLegacyFields(rxLines[idx]);
    rxUpdatePhrasePreview(idx);
}

function rxOnPhraseCustomInput(fieldType, idx) {
    var inp = g('rx-' + fieldType + '-custom-' + idx);
    if (!inp || !rxLines[idx]) return;
    rxApplyComboTextToLine(rxLines[idx], fieldType, inp.value || '');
    if (typeof rxSyncLineLegacyFields === 'function') rxSyncLineLegacyFields(rxLines[idx]);
    rxUpdatePhrasePreview(idx);
}

function rxUpdatePhrasePreview(idx) {
    var card = g('rxline-' + idx);
    if (!card || !rxLines[idx]) return;
    var prev = card.querySelector('.rx-phrase-preview');
    if (!prev) return;
    var line = rxLines[idx];
    prev.innerHTML =
        '<span class="rx-prev-en">' + esc(rxTr('con.rx.previewEn')) + ' ' +
        esc(rxPhraseDisplay(line, 'frequency', 'en')) + ' · ' +
        esc(rxPhraseDisplay(line, 'dosage', 'en')) + ' · ' +
        esc(rxPhraseDisplay(line, 'duration', 'en')) +
        '</span>' +
        '<span class="rx-prev-zh">' + esc(rxTr('con.rx.previewZh')) + ' ' +
        esc(rxPhraseDisplay(line, 'frequency', 'zh')) + ' · ' +
        esc(rxPhraseDisplay(line, 'dosage', 'zh')) + ' · ' +
        esc(rxPhraseDisplay(line, 'duration', 'zh')) +
        '</span>';
}

function rxSyncLineFromDom(idx) {
    var line = rxLines[idx];
    if (!line) return;
    RX_PHRASE_FIELDS.forEach(function(ft) {
        var sel = g('rx-' + ft + '-sel-' + idx);
        var inp = g('rx-' + ft + '-custom-' + idx);
        if (sel && sel.value) {
            rxApplyComboTextToLine(line, ft, sel.value);
        } else if (inp) {
            rxApplyComboTextToLine(line, ft, inp.value);
        }
    });
    var rem = g('rxline-' + idx);
    if (rem) {
        var remarksEl = rem.querySelector('.rx-remarks');
        if (remarksEl) line.remarks = remarksEl.value || '';
    }
    rxSyncLineLegacyFields(line);
}

function rxApplyCatalogTextToLine(idx, fields) {
    if (!rxLines[idx]) return;
    fields = fields || {};
    RX_PHRASE_FIELDS.forEach(function(ft) {
        var txt = String(fields[ft] || '').trim();
        if (!txt) return;
        rxApplyComboTextToLine(rxLines[idx], ft, txt);
    });
}

function rxPhraseFieldMarkup(fieldType, idx, line, labelText) {
    line = rxNormalizeLine(line);
    var opts = rxGetPhraseOptions(fieldType);
    var code = line[fieldType + '_code'] || '';
    var custom = line[fieldType + '_custom'] || '';
    var selId = 'rx-' + fieldType + '-sel-' + idx;
    var customId = 'rx-' + fieldType + '-custom-' + idx;

    var uiLang = rxUiPhraseLang();
    var optHtml = '<option value="">' + esc(rxTr('con.rx.phrasePick')) + '</option>';
    opts.forEach(function(o) {
        var k = String(o.option_key);
        var dispLbl = rxPhraseLabel(fieldType, k, uiLang) || k;
        optHtml +=
            '<option value="' + esc(k) + '"' +
            (k === String(code) ? ' selected' : '') + '>' +
            esc(dispLbl) + '</option>';
    });

    return (
        '<div class="rx-phrase-cell">' +
        '<label class="rx-phrase-label">' + labelText + '</label>' +
        '<div class="rx-phrase-row">' +
        '<select id="' + selId + '" class="rx-phrase-sel" ' +
        'onchange="rxOnPhraseSelectChange(\'' + fieldType + '\',' + idx + ')">' +
        optHtml +
        '</select>' +
        '<input id="' + customId + '" class="rx-phrase-custom" type="text" ' +
        'placeholder="' + esc(rxTr('con.rx.phraseCustom')) + '" value="' + esc(custom) + '" ' +
        'oninput="rxOnPhraseCustomInput(\'' + fieldType + '\',' + idx + ')">' +
        '</div>' +
        '</div>'
    );
}

function rxLineToPrintDrug(line, lang, meta) {
    line = rxNormalizeLine(line);
    meta = meta || {};
    var out = {
        drug_name:       line.drug_name || '',
        dosage:          rxPhraseDisplay(line, 'dosage', lang),
        route:           '',
        frequency:       rxPhraseDisplay(line, 'frequency', lang),
        duration:        rxPhraseDisplay(line, 'duration', lang),
        quantity:        rxPhraseDisplay(line, 'quantity', lang),
        remarks:         line.remarks || '',
        dentist_name:    meta.dentist_name || '',
        doctor_tag:      meta.doctor_tag || '',
        prescribed_date: meta.prescribed_date || '',
        patient_no:      meta.patient_no || '',
        patient_name:    meta.patient_name || '',
        patient_chinese_name: meta.patient_chinese_name || ''
    };
    rxSyncLineLegacyFields(line);
    return out;
}

function rxHistoryFieldDisplay(d, fieldType, enKey, zhKey, lang) {
    var en = d[enKey] || '';
    var zh = d[zhKey] || '';
    if (lang === 'zh') {
        if (zh && String(zh).trim() && zh !== en) return zh;
        return rxResolveTextToPhrase(fieldType, en, 'zh') || zh || en;
    }
    return en;
}

function rxHistoryRowToDrug(row, lang) {
    if (!row || !row.dataset) return null;
    var d = row.dataset;
    return {
        drug_name:       d.drugName || '',
        dosage:          rxHistoryFieldDisplay(d, 'dosage', 'dosage', 'dosageZh', lang),
        route:           '',
        frequency:       rxHistoryFieldDisplay(d, 'frequency', 'frequency', 'frequencyZh', lang),
        duration:        rxHistoryFieldDisplay(d, 'duration', 'duration', 'durationZh', lang),
        quantity:        rxHistoryFieldDisplay(d, 'quantity', 'quantity', 'quantityZh', lang),
        remarks:         d.remarks || '',
        dentist_name:    d.dentistName || '',
        doctor_tag:      d.doctorTag || d.dentistName || '',
        prescribed_date: d.prescribedDate || '',
        patient_no:      d.patientNo || '',
        patient_name:    d.patientName || ''
    };
}

function rxDrughistoryRowForSave(line, date, dentist) {
    line = rxNormalizeLine(line);
    rxSyncLineLegacyFields(line);
    return {
        patient_id:      conPatientId,
        patient_no:      conPatientData.patient_no  || null,
        patient_name:    conPatientData.full_name,
        prescribed_date: date,
        drug_name:       line.drug_name || rxTr('report.unknown'),
        dosage:          line.dosage || null,
        dosage_zh:       line.dosage_zh || null,
        frequency:       line.frequency || null,
        frequency_zh:    line.frequency_zh || null,
        duration:        line.duration || null,
        duration_zh:     line.duration_zh || null,
        route:           null,
        route_zh:        null,
        quantity:        line.quantity || null,
        quantity_zh:     line.quantity_zh || null,
        remarks:         line.remarks || null,
        dentist_name:    dentist,
        doctor_id:       conActiveDoctorId || null,
        doctor_name:     conActiveDoctorName || currentName || null,
        doctor_tag:      conActiveDoctorTag || dentist || null
    };
}

function rxStripZhColumns(row) {
    var o = {};
    Object.keys(row).forEach(function(k) {
        if (k.indexOf('_zh') === k.length - 3) return;
        o[k] = row[k];
    });
    return o;
}
