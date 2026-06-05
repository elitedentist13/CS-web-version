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
        { option_key: '6', sort_order: 35, label_en: '6 days', label_zh: '6日' },
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

/** Pack EN + ZH into one DB / line field (⟦|⟧ separator). */
var RX_BILINGUAL_SEP = '\u27E6|\u27E7';

function drugUnpackBilingualText(val) {
    var s = String(val || '').trim();
    if (!s) return { en: '', zh: '' };
    var sep = s.indexOf(RX_BILINGUAL_SEP);
    if (sep >= 0) {
        return {
            en: s.slice(0, sep).trim(),
            zh: s.slice(sep + RX_BILINGUAL_SEP.length).trim()
        };
    }
    if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(s)) {
        return { en: '', zh: s };
    }
    return { en: s, zh: '' };
}

function drugPackBilingualText(en, zh) {
    en = String(en || '').trim();
    zh = String(zh || '').trim();
    if (en && zh && en !== zh) {
        return en + RX_BILINGUAL_SEP + zh;
    }
    return en || zh || '';
}

function drugTextForLang(packedOrPair, lang) {
    var pair = typeof packedOrPair === 'string'
        ? drugUnpackBilingualText(packedOrPair)
        : (packedOrPair || { en: '', zh: '' });
    if (lang === 'zh') return pair.zh || pair.en || '';
    return pair.en || pair.zh || '';
}

/** Same row: primary language first, secondary after " / ". */
function drugFormatBilingualDisplay(en, zh, uiLang) {
    en = String(en || '').trim();
    zh = String(zh || '').trim();
    if (!en && !zh) return '';
    if (!en) return zh;
    if (!zh || en === zh) return en;
    var primary = (uiLang === 'zh') ? zh : en;
    var secondary = (uiLang === 'zh') ? en : zh;
    return primary + ' / ' + secondary;
}

function rxPhrasePair(fieldType, codeOrText) {
    var code = rxMatchCodeFromText(fieldType, codeOrText);
    if (!code) code = rxMatchCodeFromLabelText(fieldType, codeOrText);
    if (code) {
        return {
            en: rxPhraseLabel(fieldType, code, 'en') || code,
            zh: rxPhraseLabel(fieldType, code, 'zh') || code
        };
    }
    var custom = String(codeOrText || '').trim();
    if (!custom) return { en: '', zh: '' };
    return {
        en: rxResolveTextToPhrase(fieldType, custom, 'en') || custom,
        zh: rxResolveTextToPhrase(fieldType, custom, 'zh') || custom
    };
}

function drugCatalogFieldPair(d, fieldType) {
    d = d || {};
    var raw = String(d[fieldType] || '').trim();
    if (!raw) return { en: '', zh: '' };
    var line = rxNormalizeLine({});
    line[fieldType] = raw;
    line = rxNormalizeLine(line);
    var en = rxPhraseDisplay(line, fieldType, 'en');
    var zh = rxPhraseDisplay(line, fieldType, 'zh');
    if (en === '—') en = '';
    if (zh === '—') zh = '';
    if (!en && !zh) return rxPhrasePair(fieldType, raw);
    return { en: en, zh: zh };
}

function drugDefaultRxMetaBilingual(d) {
    var uiLang = rxUiPhraseLang();
    return ['dosage', 'frequency', 'duration'].map(function(ft) {
        var pair = drugCatalogFieldPair(d, ft);
        return drugFormatBilingualDisplay(pair.en, pair.zh, uiLang);
    }).filter(Boolean).join(' · ');
}

function rxPhraseOptionBilingualLabel(fieldType, code, uiLang) {
    var en = rxPhraseLabel(fieldType, code, 'en') || code;
    var zh = rxPhraseLabel(fieldType, code, 'zh') || code;
    return drugFormatBilingualDisplay(en, zh, uiLang) || code;
}

function rxEmptyLine() {
    return {
        drug_id: '', drug_name: '',
        dosage: '', frequency: '', duration: '', route: '', quantity: '',
        intake_remarks: '', remarks: '',
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

function rxPhraseFieldHasPreset(fieldType, code) {
    var c = String(code || '').trim();
    if (!c) return false;
    return rxGetPhraseOptions(fieldType).some(function(o) {
        return String(o.option_key) === c;
    });
}

/** Map line state → dropdown value + custom input text (preset code or __custom__). */
function rxResolvePhraseSelectValue(fieldType, line) {
    if (typeof rxNormalizeLine === 'function') line = rxNormalizeLine(line || {});
    var code = String(line[fieldType + '_code'] || '').trim();
    var custom = String(line[fieldType + '_custom'] || '').trim();
    if (code && rxPhraseFieldHasPreset(fieldType, code)) {
        return { sel: code, custom: custom };
    }
    var val = custom || code;
    return { sel: val ? '__custom__' : '', custom: val };
}

function rxResolveDaysSelectValue(line) {
    return rxResolvePhraseSelectValue('duration', line);
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

function rxLineQuantityText(line) {
    if (!line) return '';
    if (typeof rxNormalizeLine === 'function') line = rxNormalizeLine(line);
    var custom = String(line.quantity_custom || '').trim();
    if (custom && custom !== '—') return custom;
    var code = String(line.quantity_code || '').trim();
    if (code && code !== '—') return code;
    var leg = String(line.quantity || '').trim();
    if (leg && leg !== '—') return leg;
    var q = typeof rxComputeQuantityFromLine === 'function'
        ? rxComputeQuantityFromLine(line) : '';
    if (q) return q;
    return '';
}

function rxSyncLineLegacyFields(line) {
    if (!line) return line;
    line.dosage    = rxPhraseDisplay(line, 'dosage', 'en');
    line.frequency = rxPhraseDisplay(line, 'frequency', 'en');
    line.duration  = rxPhraseDisplay(line, 'duration', 'en');
    line.route     = '';
    var qty = rxLineQuantityText(line);
    line.quantity  = qty || '';
    line.dosage_zh    = rxPhraseDisplay(line, 'dosage', 'zh');
    line.frequency_zh = rxPhraseDisplay(line, 'frequency', 'zh');
    line.duration_zh  = rxPhraseDisplay(line, 'duration', 'zh');
    line.route_zh     = '';
    line.quantity_zh  = qty || rxPhraseDisplay(line, 'quantity', 'zh');
    if (line.quantity_zh === '—') line.quantity_zh = qty || '';
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
    if (sel.value === '__custom__') {
        var inp = g('rx-' + fieldType + '-custom-' + idx);
        if (inp) {
            inp.focus();
            if (inp.value.trim()) {
                rxApplyComboTextToLine(rxLines[idx], fieldType, inp.value);
            }
        }
        if (typeof rxSyncLineLegacyFields === 'function') {
            rxSyncLineLegacyFields(rxLines[idx]);
        }
        if (typeof rxRefreshAutoLoadedSummary === 'function') {
            rxRefreshAutoLoadedSummary(idx);
        }
        rxUpdatePhrasePreview(idx);
        return;
    }
    rxApplyComboTextToLine(rxLines[idx], fieldType, sel.value || '');
    if (fieldType === 'dosage' || fieldType === 'frequency') {
        var qty = rxComputeQuantityFromLine(rxLines[idx]);
        if (qty) rxApplyComboTextToLine(rxLines[idx], 'quantity', qty);
    }
    if (typeof rxSyncLineLegacyFields === 'function') rxSyncLineLegacyFields(rxLines[idx]);
    if (typeof rxRefreshAutoLoadedSummary === 'function') rxRefreshAutoLoadedSummary(idx);
    rxUpdatePhrasePreview(idx);
}

function rxOnPhraseCustomInput(fieldType, idx) {
    var inp = g('rx-' + fieldType + '-custom-' + idx);
    if (!inp || !rxLines[idx]) return;
    var sel = g('rx-' + fieldType + '-sel-' + idx);
    if (sel) sel.value = '__custom__';
    rxApplyComboTextToLine(rxLines[idx], fieldType, inp.value || '');
    if (fieldType === 'dosage' || fieldType === 'frequency') {
        var qty = rxComputeQuantityFromLine(rxLines[idx]);
        if (qty) rxApplyComboTextToLine(rxLines[idx], 'quantity', qty);
    }
    if (typeof rxSyncLineLegacyFields === 'function') rxSyncLineLegacyFields(rxLines[idx]);
    if (typeof rxRefreshAutoLoadedSummary === 'function') rxRefreshAutoLoadedSummary(idx);
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

function rxSyncPhraseFieldFromDom(idx, fieldType) {
    var line = rxLines[idx];
    if (!line) return;
    var sel = g('rx-' + fieldType + '-sel-' + idx);
    var inp = g('rx-' + fieldType + '-custom-' + idx);
    if (sel && sel.value === '__custom__') {
        rxApplyComboTextToLine(line, fieldType, inp ? inp.value : '');
        return;
    }
    if (sel && sel.value) {
        rxApplyComboTextToLine(line, fieldType, sel.value);
        return;
    }
    if (inp && String(inp.value || '').trim()) {
        rxApplyComboTextToLine(line, fieldType, inp.value);
    }
}

function rxSyncLineFromDom(idx) {
    var line = rxLines[idx];
    if (!line) return;
    var daysSel = g('rx-days-sel-' + idx);
    var daysInp = g('rx-days-custom-' + idx);
    if (daysSel && daysSel.value === '__custom__') {
        if (daysInp && String(daysInp.value || '').trim()) {
            rxApplyDaysToLine(idx, daysInp.value.trim());
        }
    } else if (daysSel && daysSel.value) {
        rxApplyDaysToLine(idx, daysSel.value);
    } else if (daysInp && String(daysInp.value || '').trim()) {
        rxApplyDaysToLine(idx, daysInp.value.trim());
    }
    RX_PHRASE_FIELDS.forEach(function(ft) {
        rxSyncPhraseFieldFromDom(idx, ft);
    });
    var rem = g('rxline-' + idx);
    if (rem) {
        var intakeEl = rem.querySelector('.rx-intake-remarks');
        if (intakeEl) line.intake_remarks = intakeEl.value || '';
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

/** Parse "7 days", "5 days", "14" etc. from drug catalog default duration. */
function rxParseDaysFromCatalogText(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    if (/^\d+$/.test(t)) return t;
    var m = t.match(/(\d+)\s*days?/i) || t.match(/(\d+)\s*日/);
    if (m) return m[1];
    var code = rxMatchCodeFromText('duration', t) || rxMatchCodeFromLabelText('duration', t);
    if (code && /^\d+$/.test(String(code))) return String(code);
    return '';
}

function rxFrequencyTimesPerDay(code) {
    var c = String(code || '').trim().toUpperCase();
    if (!c) return null;
    if (/^\d+$/.test(c)) return parseInt(c, 10);
    var map = { OD: 1, BD: 2, TDS: 3, QID: 4, QHS: 1, STAT: 1, PRN: null };
    if (Object.prototype.hasOwnProperty.call(map, c)) return map[c];
    return null;
}

/** Dose amount per intake (tablets, ml, puffs, etc.). */
function rxParseDoseUnits(line) {
    if (!line) return null;
    line = rxNormalizeLine(line);
    var c = String(line.dosage_code || '').trim();
    if (!c) {
        var raw = String(line.dosage_custom || line.dosage || '').trim();
        if (raw) {
            c = rxMatchCodeFromText('dosage', raw) ||
                rxMatchCodeFromLabelText('dosage', raw) || raw;
        }
    }
    if (!c) return null;
    var tab = rxParseDosageTabletCount(c);
    if (tab && tab.n) return tab.n;
    if (tab && tab.half) return 0.5;
    var ml = c.match(/^(\d+(?:\.\d+)?)\s*ml$/i);
    if (ml) return parseFloat(ml[1]);
    var puff = c.match(/^(\d+)\s*puff$/i);
    if (puff) return parseInt(puff[1], 10);
    return null;
}

/** Auto qty from dose × frequency × days when calculable. */
function rxComputeQuantityFromLine(line) {
    if (!line) return '';
    line = rxNormalizeLine(line);
    var days = parseInt(line.duration_code, 10);
    if (!isFinite(days) || days <= 0) {
        var dc = String(line.duration_custom || line.duration || '').trim();
        var parsed = rxParseDaysFromCatalogText(dc);
        days = parsed ? parseInt(parsed, 10) : NaN;
    }
    if (!isFinite(days) || days <= 0) return '';

    var freq = rxFrequencyTimesPerDay(line.frequency_code);
    if (!freq) {
        var fc = String(line.frequency_custom || line.frequency || '').trim();
        freq = rxFrequencyTimesPerDay(
            rxMatchCodeFromText('frequency', fc) ||
            rxMatchCodeFromLabelText('frequency', fc)
        );
        if (!freq && /^\d+$/.test(fc)) freq = parseInt(fc, 10);
    }
    if (!freq) return '';

    var dose = rxParseDoseUnits(line);
    // If dosage units are not parseable (e.g. mg text), fall back to 1 unit per dose
    // so quantity still reflects number of doses for the course.
    if (!dose) dose = 1;

    var total = dose * freq * days;
    if (Math.abs(total - Math.round(total)) < 0.001) return String(Math.round(total));
    return total.toFixed(2);
}

function rxApplyDaysToLine(idx, daysCode) {
    if (!rxLines[idx]) return;
    var d = String(daysCode || '').trim();
    if (!d) return;
    rxApplyComboTextToLine(rxLines[idx], 'duration', d);
    var qty = rxComputeQuantityFromLine(rxLines[idx]);
    if (qty) {
        rxApplyComboTextToLine(rxLines[idx], 'quantity', qty);
    }
    if (typeof rxSyncLineLegacyFields === 'function') rxSyncLineLegacyFields(rxLines[idx]);
}

function rxCanConfirmLine(line) {
    if (!line || !line.drug_name || !String(line.drug_name).trim()) return false;
    return !!(line.duration_code ||
        String(line.duration_custom || line.duration || '').trim());
}

function rxAddToListBtnMarkup(idx, line) {
    line = line || {};
    var enabled = rxCanConfirmLine(line);
    return (
        '<button type="button" id="rx-header-add-' + idx + '" class="rx-header-add-btn" ' +
        (enabled ? '' : 'disabled ') +
        'title="' + esc(rxTr('con.rx.btnAddToListTitle')) + '" ' +
        'onclick="rxConfirmLineAndAddNext(' + idx + ')">' +
        esc(rxTr('con.rx.btnAddToList')) +
        '</button>'
    );
}

function rxRefreshHeaderAddBtn(idx) {
    var btn = g('rx-header-add-' + idx);
    if (!btn || !rxLines[idx]) return;
    btn.disabled = !rxCanConfirmLine(rxLines[idx]);
}

function rxRefreshPhraseField(idx, fieldType) {
    var line = rxLines[idx];
    if (!line) return;
    if (typeof rxNormalizeLine === 'function') line = rxNormalizeLine(line);
    var resolved = rxResolvePhraseSelectValue(fieldType, line);
    var sel = g('rx-' + fieldType + '-sel-' + idx);
    var inp = g('rx-' + fieldType + '-custom-' + idx);
    if (inp) inp.value = resolved.custom;
    if (sel) sel.value = resolved.sel;
}

function rxRefreshDaysField(idx) {
    var line = rxLines[idx];
    if (!line) return;
    if (typeof rxNormalizeLine === 'function') line = rxNormalizeLine(line);
    var resolved = rxResolveDaysSelectValue(line);
    var sel = g('rx-days-sel-' + idx);
    var inp = g('rx-days-custom-' + idx);
    if (inp) inp.value = resolved.custom;
    if (sel) sel.value = resolved.sel;
    rxRefreshPhraseField(idx, 'duration');
}

function rxRefreshQuantityField(idx) {
    rxRefreshPhraseField(idx, 'quantity');
}

function rxRefreshLineQuickUi(idx) {
    rxRefreshAutoLoadedSummary(idx);
    rxRefreshDaysField(idx);
    rxRefreshQuantityField(idx);
    rxRefreshHeaderAddBtn(idx);
}

function rxNormalizeCatalogFrequency(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    var head = t.split(/[–\-]/)[0].trim().toUpperCase();
    var alias = { TID: 'TDS', OD: '1' };
    if (alias[head]) head = alias[head];
    var code = rxMatchCodeFromText('frequency', head) ||
        rxMatchCodeFromLabelText('frequency', t) ||
        rxMatchCodeFromText('frequency', t);
    return code || t;
}

function rxNormalizeCatalogDosage(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    var code = rxMatchCodeFromText('dosage', t) || rxMatchCodeFromLabelText('dosage', t);
    if (code) return code;
    var mg = t.match(/^(\d+(?:\.\d+)?)\s*mg$/i);
    if (mg) return mg[1] + 'mg';
    return t;
}

/** Load dosage + frequency from drug catalog; optional default days from catalog duration. */
function rxApplyCatalogDefaultsToLine(idx, fields) {
    if (!rxLines[idx]) return;
    fields = fields || {};
    var dosageTxt = rxNormalizeCatalogDosage(fields.dosage);
    var freqTxt = rxNormalizeCatalogFrequency(fields.frequency);
    if (dosageTxt) rxApplyComboTextToLine(rxLines[idx], 'dosage', dosageTxt);
    if (freqTxt) rxApplyComboTextToLine(rxLines[idx], 'frequency', freqTxt);
    if (fields.intake_remarks !== undefined) {
        rxLines[idx].intake_remarks = String(fields.intake_remarks || '').trim();
    }
    if (fields.remarks !== undefined) {
        rxLines[idx].remarks = String(fields.remarks || '').trim();
    }
    var defaultDays = rxParseDaysFromCatalogText(fields.duration);
    if (defaultDays) {
        rxApplyDaysToLine(idx, defaultDays);
    } else {
        rxLines[idx].duration_code = '';
        rxLines[idx].duration_custom = '';
        rxLines[idx].quantity_code = '';
        rxLines[idx].quantity_custom = '';
    }
    if (typeof rxSyncLineLegacyFields === 'function') rxSyncLineLegacyFields(rxLines[idx]);
}

function rxDaysFieldMarkup(idx, line) {
    line = rxNormalizeLine(line);
    var resolved = rxResolveDaysSelectValue(line);
    var opts = rxGetPhraseOptions('duration');
    var uiLang = rxUiPhraseLang();
    var optHtml = '<option value="">' + esc(rxTr('con.rx.selectDays')) + '</option>';
    opts.forEach(function (o) {
        var k = String(o.option_key);
        optHtml +=
            '<option value="' + esc(k) + '"' +
            (k === resolved.sel ? ' selected' : '') + '>' +
            esc(rxPhraseOptionBilingualLabel('duration', k, uiLang) || k) + '</option>';
    });
    optHtml +=
        '<option value="__custom__"' +
        (resolved.sel === '__custom__' ? ' selected' : '') + '>' +
        esc(rxTr('con.rx.daysCustom')) + '</option>';
    return (
        '<div class="rx-days-cell">' +
        '<label class="rx-phrase-label">' + esc(rxTr('con.rx.labelDays')) + '</label>' +
        '<div class="rx-phrase-row">' +
        '<select id="rx-days-sel-' + idx + '" class="rx-days-sel" ' +
        'onchange="rxOnDaysSelectChange(' + idx + ')">' +
        optHtml +
        '</select>' +
        '<input id="rx-days-custom-' + idx + '" class="rx-days-custom" type="text" ' +
        'placeholder="' + esc(rxTr('con.rx.daysCustomPh')) + '" value="' + esc(resolved.custom) + '" ' +
        'oninput="rxOnDaysCustomInput(' + idx + ')">' +
        '</div>' +
        '</div>'
    );
}

function rxConfirmLineAndAddNext(idx) {
    if (!rxLines[idx]) return;
    if (typeof rxSyncLineFromDom === 'function') rxSyncLineFromDom(idx);
    var line = rxLines[idx];
    if (!line.drug_name || !String(line.drug_name).trim()) {
        alert(rxTr('con.rx.alertLabelNeedDrug'));
        return;
    }
    if (!line.duration_code && !String(line.duration_custom || line.duration || '').trim()) {
        alert(rxTr('con.rx.autoPickDays'));
        return;
    }
    if (typeof rxNormalizeLine === 'function') line = rxNormalizeLine(line);
    var qty = typeof rxComputeQuantityFromLine === 'function'
        ? rxComputeQuantityFromLine(line) : '';
    if (qty) rxApplyComboTextToLine(line, 'quantity', qty);
    if (typeof rxSyncLineLegacyFields === 'function') rxSyncLineLegacyFields(line);
    rxLines[idx] = line;

    if (typeof rxCloneSavedLine === 'function' && typeof rxStagedLines !== 'undefined') {
        rxStagedLines.push(rxCloneSavedLine(line));
        rxLines[idx] = typeof rxEmptyLine === 'function' ? rxEmptyLine() : {};
        if (typeof renderRxStagedList === 'function') renderRxStagedList();
        if (typeof renderRxLines === 'function') renderRxLines();
    } else if (typeof addDrugLine === 'function') {
        addDrugLine();
    }
    if (typeof showAppGlobalToast === 'function') {
        showAppGlobalToast(rxTr('con.rx.daysReady'));
    }
}

function rxAutoLoadedSummaryMarkup(idx, line) {
    if (!line || !String(line.drug_name || '').trim()) {
        return (
            '<div class="rx-auto-summary rx-auto-summary--empty" id="rx-auto-' + idx + '">' +
            esc(rxTr('con.rx.autoSelectDrug')) +
            '</div>'
        );
    }
    line = rxNormalizeLine(line);
    if (typeof rxSyncLineLegacyFields === 'function') rxSyncLineLegacyFields(line);
    var lang = rxUiPhraseLang();
    var dosage = rxPhraseDisplay(line, 'dosage', 'en');
    var dosageZh = rxPhraseDisplay(line, 'dosage', 'zh');
    var freq = rxPhraseDisplay(line, 'frequency', 'en');
    var freqZh = rxPhraseDisplay(line, 'frequency', 'zh');
    var days = rxPhraseDisplay(line, 'duration', 'en');
    var daysZh = rxPhraseDisplay(line, 'duration', 'zh');
    var qty = rxLineQuantityText(line);
    var parts = [];
    if (dosage && dosage !== '—') {
        parts.push(esc(rxTr('con.rx.labelDosage')) + ' ' +
            esc(drugFormatBilingualDisplay(dosage, dosageZh, lang)));
    }
    if (freq && freq !== '—') {
        parts.push(esc(rxTr('con.rx.labelFrequency')) + ' ' +
            esc(drugFormatBilingualDisplay(freq, freqZh, lang)));
    }
    if (days && days !== '—') {
        parts.push(esc(rxTr('con.rx.labelDuration')) + ' ' +
            esc(drugFormatBilingualDisplay(days, daysZh, lang)));
    }
    if (qty && qty !== '—') parts.push(esc(rxTr('con.rx.labelQty')) + ' ' + esc(qty));
    return (
        '<div class="rx-auto-summary" id="rx-auto-' + idx + '">' +
        '<span class="rx-auto-summary__title">' + esc(rxTr('con.rx.autoLoadedTitle')) + '</span> ' +
        (parts.length ? parts.join(' · ') : esc(rxTr('con.rx.autoPickDays'))) +
        '</div>'
    );
}

function rxRefreshAutoLoadedSummary(idx) {
    var el = g('rx-auto-' + idx);
    if (!el || !rxLines[idx]) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = rxAutoLoadedSummaryMarkup(idx, rxLines[idx]);
    var inner = tmp.firstElementChild;
    if (inner) {
        el.className = inner.className;
        el.innerHTML = inner.innerHTML;
    }
}

function rxDrugCautionNotesMarkup(idx, line) {
    line = line || {};
    var id = 'rx-caution-' + idx;
    if (!line.drug_name || !String(line.drug_name).trim()) {
        return '<div class="rx-caution-notes rx-caution-notes--empty" id="' + id + '"></div>';
    }
    var uiLang = rxUiPhraseLang();
    var intakePair = drugUnpackBilingualText(line.intake_remarks || '');
    var generalPair = drugUnpackBilingualText(line.remarks || '');
    var intakeDisp = drugFormatBilingualDisplay(intakePair.en, intakePair.zh, uiLang);
    var generalDisp = drugFormatBilingualDisplay(generalPair.en, generalPair.zh, uiLang);
    if (!intakeDisp && !generalDisp) {
        return '<div class="rx-caution-notes rx-caution-notes--empty" id="' + id + '"></div>';
    }
    var html = '<div class="rx-caution-notes" id="' + id + '">';
    if (intakeDisp) {
        html +=
            '<div class="rx-caution-note rx-caution-note--intake">' +
            '<span class="rx-caution-note__label">' + esc(rxTr('con.rx.labelIntakeRemarks')) + '</span>' +
            '<span class="rx-caution-note__text">' + esc(intakeDisp) + '</span>' +
            '</div>';
    }
    if (generalDisp) {
        html +=
            '<div class="rx-caution-note rx-caution-note--general">' +
            '<span class="rx-caution-note__label">' + esc(rxTr('con.rx.labelRemarks')) + '</span>' +
            '<span class="rx-caution-note__text">' + esc(generalDisp) + '</span>' +
            '</div>';
    }
    html += '</div>';
    return html;
}

function rxRefreshDrugCautionNotes(idx) {
    var el = g('rx-caution-' + idx);
    if (!el || !rxLines[idx]) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = rxDrugCautionNotesMarkup(idx, rxLines[idx]);
    var inner = tmp.firstElementChild;
    if (inner) {
        el.className = inner.className;
        el.innerHTML = inner.innerHTML;
    }
}

function rxRemarkFieldMarkup(idx, line, fieldKey, labelKey, phKey) {
    line = line || {};
    var pair = drugUnpackBilingualText(line[fieldKey] || '');
    var lsKey = fieldKey === 'intake_remarks' ? DRUG_INTAKE_PRESET_LS : DRUG_GENERAL_PRESET_LS;
    var seed = fieldKey === 'intake_remarks' ? DRUG_INTAKE_PRESET_SEED : DRUG_GENERAL_PRESET_SEED;
    var list = (typeof drugReadPresetList === 'function')
        ? drugReadPresetList(lsKey, seed)
        : seed.slice();
    var enList = list.filter(function(t) { return !/[\u4e00-\u9fff\u3400-\u4dbf]/.test(t); });
    var zhList = list.filter(function(t) { return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(t); });
    if (!enList.length) enList = list.slice();
    if (!zhList.length) zhList = list.slice();

    function presetOpts(items, val) {
        var html = '<option value="">' + esc(rxTr('drug.remarkPresetPick')) + '</option>';
        items.forEach(function(txt) {
            html += '<option value="' + esc(txt) + '"' +
                (txt === val ? ' selected' : '') + '>' + esc(txt) + '</option>';
        });
        return html;
    }

    var enListId = fieldKey + '-en-list-' + idx;
    var zhListId = fieldKey + '-zh-list-' + idx;
    var dlEn = enList.map(function(t) { return '<option value="' + esc(t) + '">'; }).join('');
    var dlZh = zhList.map(function(t) { return '<option value="' + esc(t) + '">'; }).join('');

    return (
        '<div class="rx-remark-cell rx-remark-cell--bilingual">' +
        '<label class="rx-phrase-label">' + esc(rxTr(labelKey)) + '</label>' +
        '<div class="drug-bilingual-row drug-bilingual-row--compact">' +
        '<div class="drug-bilingual-col">' +
        '<span class="drug-bilingual-tag">EN</span>' +
        '<div class="rx-phrase-row">' +
        '<select class="rx-remark-preset-sel" data-rx-idx="' + idx + '" data-rx-field="' + fieldKey + '" data-rx-lang="en" ' +
        'onchange="rxOnRemarkPresetPick(this)">' + presetOpts(enList, pair.en) + '</select>' +
        '<input class="rx-remark-input rx-remark-input-en" list="' + enListId + '" type="text" ' +
        'placeholder="' + esc(rxTr(phKey)) + '" value="' + esc(pair.en) + '" ' +
        'data-rx-idx="' + idx + '" data-rx-field="' + fieldKey + '" data-rx-lang="en" ' +
        'oninput="rxOnRemarkBilingualInput(this)">' +
        '</div>' +
        '<datalist id="' + enListId + '">' + dlEn + '</datalist>' +
        '</div>' +
        '<div class="drug-bilingual-col">' +
        '<span class="drug-bilingual-tag">中</span>' +
        '<div class="rx-phrase-row">' +
        '<select class="rx-remark-preset-sel" data-rx-idx="' + idx + '" data-rx-field="' + fieldKey + '" data-rx-lang="zh" ' +
        'onchange="rxOnRemarkPresetPick(this)">' + presetOpts(zhList, pair.zh) + '</select>' +
        '<input class="rx-remark-input rx-remark-input-zh" list="' + zhListId + '" type="text" ' +
        'placeholder="' + esc(rxTr('con.rx.remarksPhZh')) + '" value="' + esc(pair.zh) + '" ' +
        'data-rx-idx="' + idx + '" data-rx-field="' + fieldKey + '" data-rx-lang="zh" ' +
        'oninput="rxOnRemarkBilingualInput(this)">' +
        '</div>' +
        '<datalist id="' + zhListId + '">' + dlZh + '</datalist>' +
        '</div>' +
        '</div>' +
        '</div>'
    );
}

function rxOnRemarkBilingualInput(inp) {
    if (!inp) return;
    var idx = parseInt(inp.getAttribute('data-rx-idx') || '-1', 10);
    var field = inp.getAttribute('data-rx-field') || '';
    if (idx < 0 || !field || !rxLines[idx]) return;
    var card = g('rxline-' + idx);
    var enInp = card ? card.querySelector('.rx-remark-input-en[data-rx-field="' + field + '"]') : null;
    var zhInp = card ? card.querySelector('.rx-remark-input-zh[data-rx-field="' + field + '"]') : null;
    var en = enInp ? enInp.value.trim() : '';
    var zh = zhInp ? zhInp.value.trim() : '';
    rxLines[idx][field] = drugPackBilingualText(en, zh);
}

function rxOnRemarkPresetPick(sel) {
    if (!sel) return;
    var idx = parseInt(sel.getAttribute('data-rx-idx') || '-1', 10);
    var field = sel.getAttribute('data-rx-field') || '';
    if (idx < 0 || !field || !rxLines[idx] || !sel.value) return;
    var lang = sel.getAttribute('data-rx-lang') || 'en';
    var card = g('rxline-' + idx);
    var cls = lang === 'zh' ? '.rx-remark-input-zh' : '.rx-remark-input-en';
    var inp = card ? card.querySelector(cls + '[data-rx-field="' + field + '"]') : null;
    if (inp) {
        inp.value = sel.value;
        rxOnRemarkBilingualInput(inp);
    }
}

function rxOnDaysCustomInput(idx) {
    var inp = g('rx-days-custom-' + idx);
    var sel = g('rx-days-sel-' + idx);
    if (!inp || !rxLines[idx]) return;
    if (sel) sel.value = '__custom__';
    var v = String(inp.value || '').trim();
    if (v) {
        rxApplyDaysToLine(idx, v);
    } else {
        rxLines[idx].duration_code = '';
        rxLines[idx].duration_custom = '';
        if (typeof rxSyncLineLegacyFields === 'function') {
            rxSyncLineLegacyFields(rxLines[idx]);
        }
    }
    rxRefreshLineQuickUi(idx);
    if (typeof rxUpdatePhrasePreview === 'function') rxUpdatePhrasePreview(idx);
}

function rxOnDaysSelectChange(idx) {
    var sel = g('rx-days-sel-' + idx);
    if (!sel || !rxLines[idx]) return;
    var val = String(sel.value || '').trim();
    if (!val) return;
    if (val === '__custom__') {
        var inp = g('rx-days-custom-' + idx);
        if (inp) {
            inp.focus();
            if (inp.value.trim()) {
                rxApplyDaysToLine(idx, inp.value.trim());
                rxRefreshLineQuickUi(idx);
                if (typeof rxUpdatePhrasePreview === 'function') rxUpdatePhrasePreview(idx);
            }
        }
        return;
    }
    rxApplyDaysToLine(idx, val);
    var daysInp = g('rx-days-custom-' + idx);
    if (daysInp) daysInp.value = '';
    rxRefreshLineQuickUi(idx);
    if (typeof rxUpdatePhrasePreview === 'function') rxUpdatePhrasePreview(idx);
}

function rxPhraseFieldMarkup(fieldType, idx, line, labelText) {
    line = rxNormalizeLine(line);
    var opts = rxGetPhraseOptions(fieldType);
    var resolved = rxResolvePhraseSelectValue(fieldType, line);
    var selId = 'rx-' + fieldType + '-sel-' + idx;
    var customId = 'rx-' + fieldType + '-custom-' + idx;

    var uiLang = rxUiPhraseLang();
    var optHtml = '<option value="">' + esc(rxTr('con.rx.phrasePick')) + '</option>';
    opts.forEach(function(o) {
        var k = String(o.option_key);
        var dispLbl = rxPhraseOptionBilingualLabel(fieldType, k, uiLang) || k;
        optHtml +=
            '<option value="' + esc(k) + '"' +
            (k === resolved.sel ? ' selected' : '') + '>' +
            esc(dispLbl) + '</option>';
    });
    optHtml +=
        '<option value="__custom__"' +
        (resolved.sel === '__custom__' ? ' selected' : '') + '>' +
        esc(rxTr('con.rx.phraseCustomOption')) + '</option>';

    return (
        '<div class="rx-phrase-cell">' +
        '<label class="rx-phrase-label">' + labelText + '</label>' +
        '<div class="rx-phrase-row">' +
        '<select id="' + selId + '" class="rx-phrase-sel" ' +
        'onchange="rxOnPhraseSelectChange(\'' + fieldType + '\',' + idx + ')">' +
        optHtml +
        '</select>' +
        '<input id="' + customId + '" class="rx-phrase-custom" type="text" ' +
        'placeholder="' + esc(rxTr('con.rx.phraseCustom')) + '" value="' + esc(resolved.custom) + '" ' +
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
        intake_remarks:  drugTextForLang(line.intake_remarks || '', lang),
        remarks:         drugTextForLang(line.remarks || '', lang),
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
        intake_remarks:  drugTextForLang(d.intakeRemarks || '', lang),
        remarks:         drugTextForLang(d.remarks || '', lang),
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
        intake_remarks:  line.intake_remarks || null,
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
