// Consultation → Treatment Notes composer: structured sections, per-patient drafts,
// phrase chips, FDI tooth picker, dictation, today's context strip and history filters.
// #conNoteInput stays the canonical text; the sections editor composes into it.

var CN_SECTIONS = [
    { key: 'co',   label: 'C/O',   aliases: ['c/o', 'cc', 'chief complaint'] },
    { key: 'mh',   label: 'MH',    aliases: ['mh', 'pmh', 'medical history'] },
    { key: 'hpc',  label: 'HPC',   aliases: ['hpc', 'history of presenting complaint'] },
    { key: 'eo',   label: 'E/O',   aliases: ['e/o', 'extra-oral', 'extraoral', 'extra oral', 'extra-oral examination', 'extra oral examination'] },
    { key: 'io',   label: 'I/O',   aliases: ['i/o', 'intra-oral', 'intraoral', 'intra oral', 'intra-oral examination', 'intra oral examination'] },
    { key: 'xr',   label: 'Xrays', aliases: ['xrays', 'xray', 'x-ray', 'x-rays', 'radiographs'] },
    { key: 'si',   label: 'Special investigation', short: 'SI', aliases: ['special investigation', 'special investigations', 'si'] },
    { key: 'tx',   label: 'Tx',    aliases: ['tx', 'treatment'] },
    { key: 'px',   label: 'Px',    aliases: ['px', 'rx', 'prescription'] },
    { key: 'next', label: 'Next',  aliases: ['next', 'next visit', 'plan'] }
];
var CN_TOOTH_KEYS = { co: 1, hpc: 1, io: 1, xr: 1, si: 1, tx: 1, next: 1 };
var CN_DEFAULT_OPEN = { co: 1, tx: 1, next: 1 };
var CN_DEFAULT_PHRASES = {
    co:   ['Pain', 'Swelling', 'Sensitivity to cold', 'Broken filling', 'Bleeding gums', 'Check-up and cleaning'],
    mh:   ['NAD', 'No change', 'Hypertension', 'Diabetes', 'On anticoagulants'],
    hpc:  ['x 3 days', 'x 1 week', 'Intermittent', 'Worse at night', 'Pain on biting'],
    eo:   ['NAD', 'No facial swelling', 'No lymphadenopathy', 'TMJ NAD', 'Mouth opening normal'],
    io:   ['Soft tissues NAD', 'Caries', 'Fractured cusp', 'Gingival inflammation', 'Plaque and calculus', 'Buccal sulcus swelling'],
    xr:   ['PA', 'BW', 'OPG', 'No periapical pathology', 'Periapical radiolucency', 'Caries into dentine'],
    si:   ['EPT +ve', 'EPT -ve', 'Cold test +ve', 'TTP +ve', 'TTP -ve', 'Mobility grade I'],
    tx:   ['LA 2% lignocaine 1:80k 2.2 ml', 'Scaling and polishing', 'OHI given', 'Composite restoration', 'Access cavity', 'Pt tolerated well'],
    px:   ['Analgesics as needed', 'Chlorhexidine mouthwash', 'Post-op instructions given'],
    next: ['Review 1 week', 'RCT continue', 'Recall 6 months', 'Scaling and polishing'],
    other: []
};
var CN_MODE_KEY = 'conNoteMode';
var CN_PHRASES_KEY = 'conNotePhrases:v1';
var CN_DRAFT_PREFIX = 'conNoteDraft:v1:';
var CN_DRAFT_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
var CN_SURFACES = ['M', 'O', 'D', 'B', 'L', 'P', 'I'];

var CN = {
    mode: 'sections',
    draftPid: null,
    draftTimer: null,
    lastFocusEl: null,
    open: {},
    filter: { q: '', doctor: '', showDeleted: false },
    carryDismissed: false,
    todayRx: [],
    todayRxKey: '',
    toothTarget: null,
    toothSurfaces: {},
    toothLastEnd: -1
};

var cnLabelRe = null;
var cnAliasMap = null;

function cnBuildLabelRe() {
    if (cnLabelRe) return;
    cnAliasMap = {};
    var all = [];
    CN_SECTIONS.forEach(function (s) {
        s.aliases.concat([s.label.toLowerCase()]).forEach(function (a) {
            cnAliasMap[a] = s.key;
            all.push(a);
        });
    });
    all.sort(function (a, b) { return b.length - a.length; });
    var alt = all.map(function (a) { return a.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&'); }).join('|');
    cnLabelRe = new RegExp('^\\s*(' + alt + ')\\s*[:：]\\s*', 'i');
}

function cnSectionByKey(key) {
    for (var i = 0; i < CN_SECTIONS.length; i++) if (CN_SECTIONS[i].key === key) return CN_SECTIONS[i];
    return null;
}

/** Ordered blocks [{key, text}] — text before the first label is key "other". */
function cnParseBlocks(text) {
    cnBuildLabelRe();
    var blocks = [];
    var cur = { key: 'other', lines: [] };
    blocks.push(cur);
    String(text || '').split(/\r?\n/).forEach(function (line) {
        var m = line.match(cnLabelRe);
        if (m) {
            cur = { key: cnAliasMap[m[1].toLowerCase()] || 'other', lines: [line.slice(m[0].length)], labeled: true };
            blocks.push(cur);
        } else {
            cur.lines.push(line);
        }
    });
    return blocks.map(function (b) {
        return { key: b.key, labeled: !!b.labeled, text: b.lines.join('\n').replace(/^\s*\n+|\s+$/g, '') };
    }).filter(function (b) { return b.text || b.labeled; });
}

function cnParse(text) {
    var out = { other: '' };
    CN_SECTIONS.forEach(function (s) { out[s.key] = ''; });
    var labeled = 0;
    cnParseBlocks(text).forEach(function (b) {
        if (b.labeled) labeled++;
        if (!b.text) return;
        out[b.key] = out[b.key] ? out[b.key] + '\n' + b.text : b.text;
    });
    return { sections: out, labeled: labeled };
}

function cnCompose(sections) {
    var parts = [];
    var other = String(sections.other || '').trim();
    if (other) parts.push(other);
    CN_SECTIONS.forEach(function (s) {
        var v = String(sections[s.key] || '').trim();
        if (v) parts.push(s.label + ': ' + v);
    });
    return parts.join('\n');
}

/** History display: label column when the note has two or more labelled sections. */
function conNotesFormatBodyHtml(text) {
    var blocks = cnParseBlocks(text);
    var labeled = blocks.filter(function (b) { return b.labeled; }).length;
    if (labeled < 2) return esc(text || '');
    return '<div class="cn-disp">' + blocks.map(function (b) {
        if (!b.labeled) return '<div class="cn-disp-free">' + esc(b.text) + '</div>';
        var s = cnSectionByKey(b.key);
        return '<div class="cn-disp-row cn-disp-row--' + b.key + '">' +
            '<span class="cn-disp-lbl">' + esc(s ? (s.short || s.label) : '') + '</span>' +
            '<span class="cn-disp-val">' + (b.text ? esc(b.text) : '<span class="cn-disp-empty">—</span>') + '</span>' +
        '</div>';
    }).join('') + '</div>';
}

// ─── Composer DOM ──────────────────────────────────────────────
function cnInput() { return g('conNoteInput'); }

function cnSecName(key) { return conTr('con.note.sec.' + key); }

function cnSectionKeysForEditor() { return CN_SECTIONS.map(function (s) { return s.key; }).concat(['other']); }

function cnRenderSections() {
    var host = g('conNoteSections');
    if (!host) return;
    var parsed = cnParse((cnInput() || {}).value || '').sections;
    host.innerHTML = cnSectionKeysForEditor().map(function (key) {
        var s = cnSectionByKey(key);
        return '<div class="cn-sec" data-key="' + key + '">' +
            '<button type="button" class="cn-sec-head" aria-expanded="false">' +
                (s ? '<span class="cn-sec-lbl">' + esc(s.short || s.label) + '</span>' : '<span class="cn-sec-lbl cn-sec-lbl--other">…</span>') +
                '<span class="cn-sec-name">' + esc(cnSecName(key)) + '</span>' +
                '<span class="cn-sec-peek"></span>' +
                '<span class="cn-sec-caret" aria-hidden="true">▸</span>' +
            '</button>' +
            '<div class="cn-sec-body">' +
                '<textarea class="cn-sec-input" rows="1" data-key="' + key + '" aria-label="' + esc(cnSecName(key)) + '"></textarea>' +
                '<div class="cn-chips" data-key="' + key + '"></div>' +
            '</div>' +
        '</div>';
    }).join('');
    host.querySelectorAll('.cn-sec').forEach(function (sec) {
        var key = sec.getAttribute('data-key');
        var ta = sec.querySelector('.cn-sec-input');
        ta.value = parsed[key] || '';
        sec.querySelector('.cn-sec-head').addEventListener('click', function () {
            cnSetSectionOpen(key, !sec.classList.contains('is-open'), true);
        });
        ta.addEventListener('input', function () {
            cnAutoSize(ta);
            cnRefreshSectionState(sec);
            cnSyncToTextarea();
        });
        ta.addEventListener('focus', function () { CN.lastFocusEl = ta; });
        cnRenderChips(key);
    });
    cnApplyOpenStates();
}

function cnApplyOpenStates() {
    var host = g('conNoteSections');
    if (!host) return;
    host.querySelectorAll('.cn-sec').forEach(function (sec) {
        var key = sec.getAttribute('data-key');
        var ta = sec.querySelector('.cn-sec-input');
        var open = CN.open[key] != null ? CN.open[key] : (!!CN_DEFAULT_OPEN[key] || !!ta.value.trim());
        if (ta.value.trim()) open = true;
        cnSetSectionOpen(key, open, false);
        cnRefreshSectionState(sec);
    });
}

function cnSetSectionOpen(key, open, focus) {
    var sec = document.querySelector('#conNoteSections .cn-sec[data-key="' + key + '"]');
    if (!sec) return;
    CN.open[key] = !!open;
    sec.classList.toggle('is-open', !!open);
    sec.querySelector('.cn-sec-head').setAttribute('aria-expanded', open ? 'true' : 'false');
    var ta = sec.querySelector('.cn-sec-input');
    if (open) {
        cnAutoSize(ta);
        if (focus) ta.focus();
    }
}

function cnRefreshSectionState(sec) {
    var ta = sec.querySelector('.cn-sec-input');
    var v = String(ta.value || '').trim();
    sec.classList.toggle('has-text', !!v);
    var peek = sec.querySelector('.cn-sec-peek');
    if (peek) peek.textContent = v ? v.replace(/\s+/g, ' ').slice(0, 60) + (v.length > 60 ? '…' : '') : '';
}

function cnAutoSize(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(Math.max(ta.scrollHeight, 34), 260) + 'px';
}

function cnReadSections() {
    var out = {};
    document.querySelectorAll('#conNoteSections .cn-sec-input').forEach(function (ta) {
        out[ta.getAttribute('data-key')] = ta.value;
    });
    return out;
}

function cnSyncToTextarea() {
    var inp = cnInput();
    if (!inp || CN.mode !== 'sections') return;
    inp.value = cnCompose(cnReadSections());
    cnScheduleDraft();
    cnRefreshContextMarks();
}

/** Re-fill the sections from #conNoteInput (after template, draft restore, save or patient switch). */
function conNotesSyncFromTextarea() {
    var inp = cnInput();
    if (!inp || CN.mode !== 'sections') return;
    var parsed = cnParse(inp.value || '').sections;
    if (!String(inp.value || '').trim()) CN.open = {};
    document.querySelectorAll('#conNoteSections .cn-sec-input').forEach(function (ta) {
        ta.value = parsed[ta.getAttribute('data-key')] || '';
    });
    cnApplyOpenStates();
    cnRefreshContextMarks();
}

function cnModeUserKey() {
    var uid = (typeof currentUserId !== 'undefined' && currentUserId) ? String(currentUserId) : '';
    return uid ? CN_MODE_KEY + ':' + uid : '';
}

/** Per-login choice; falls back to the older per-browser choice, then Sections. */
function cnPreferredMode() {
    try {
        var k = cnModeUserKey();
        return (k && localStorage.getItem(k)) || localStorage.getItem(CN_MODE_KEY) || 'sections';
    } catch (e) { return 'sections'; }
}

function cnSectionInput(key) {
    return document.querySelector('#conNoteSections .cn-sec-input[data-key="' + key + '"]');
}

function cnFocusEnd(ta, pos) {
    if (!ta) return;
    var p = typeof pos === 'number' ? pos : ta.value.length;
    try { ta.focus(); ta.setSelectionRange(p, p); } catch (e) {}
    CN.lastFocusEl = ta;
}

/** @param {boolean} fromUser  persist the choice and carry the cursor across */
function cnSetMode(mode, fromUser) {
    mode = mode === 'free' ? 'free' : 'sections';
    var inp = cnInput();
    var host = g('conNoteSections');
    if (!inp || !host) return;
    var prev = CN.mode;
    var focusKey = '';
    var active = document.activeElement;
    if (prev === 'sections' && active && active.classList && active.classList.contains('cn-sec-input')) {
        focusKey = active.getAttribute('data-key');
    } else if (prev === 'free' && active === inp) {
        var blocks = cnParseBlocks(String(inp.value || '').slice(0, inp.selectionStart || 0));
        focusKey = blocks.length ? blocks[blocks.length - 1].key : '';
    }
    if (prev === 'sections' && mode === 'free' && !host.hidden) inp.value = cnCompose(cnReadSections());
    CN.mode = mode;
    if (fromUser) {
        try {
            var k = cnModeUserKey();
            if (k) localStorage.setItem(k, mode);
            localStorage.setItem(CN_MODE_KEY, mode);
        } catch (e) {}
    }
    host.hidden = mode !== 'sections';
    inp.hidden = mode === 'sections';
    var composer = g('conNoteComposer');
    if (composer) composer.classList.toggle('cn-mode-free', mode === 'free');
    document.querySelectorAll('#conNoteComposer .cn-mode-btn').forEach(function (b) {
        var on = b.getAttribute('data-mode') === mode;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (mode === 'sections') {
        conNotesSyncFromTextarea();
        if (fromUser) {
            var key = focusKey && cnSectionInput(focusKey) ? focusKey : '';
            if (!key) {
                var firstFilled = host.querySelector('.cn-sec.has-text .cn-sec-input');
                key = firstFilled ? firstFilled.getAttribute('data-key') : 'co';
            }
            cnSetSectionOpen(key, true, false);
            cnFocusEnd(cnSectionInput(key));
        }
    } else {
        cnAutoSize(inp);
        if (fromUser) {
            var pos = inp.value.length;
            var s = focusKey && cnSectionByKey(focusKey);
            if (s) {
                var val = String((cnSectionInput(focusKey) || {}).value || '').trim();
                var at = val ? inp.value.indexOf(s.label + ': ' + val) : -1;
                if (at >= 0) pos = at + s.label.length + 2 + val.length;
            }
            cnFocusEnd(inp, pos);
        }
    }
    if (prev !== mode && g('conNoteContext')) cnRenderContext();
    if (prev !== mode && cnMic.wantOn) {
        cnMicSetTarget(cnIsNoteField(document.activeElement) ? document.activeElement : null);
        cnMicSetTarget(cnMicTarget());
        cnMicStatus('on', cnMicListeningText());
    }
}

// ─── Phrase chips ──────────────────────────────────────────────
function cnUserPhrases() {
    try {
        var o = JSON.parse(localStorage.getItem(CN_PHRASES_KEY) || '{}');
        return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
}

function cnSaveUserPhrases(o) {
    try { localStorage.setItem(CN_PHRASES_KEY, JSON.stringify(o || {})); } catch (e) {}
}

function cnRenderChips(key) {
    var box = document.querySelector('#conNoteSections .cn-chips[data-key="' + key + '"]');
    if (!box) return;
    var mine = (cnUserPhrases()[key] || []).filter(Boolean);
    var html = '';
    if (CN_TOOTH_KEYS[key]) {
        html += '<button type="button" data-no-click-guard="1" class="cn-chip cn-chip--tooth" data-tooth="1">🦷 ' + esc(conTr('con.note.tooth')) + '</button>';
    }
    (CN_DEFAULT_PHRASES[key] || []).forEach(function (p) {
        html += '<button type="button" data-no-click-guard="1" class="cn-chip" data-phrase="' + esc(p) + '">' + esc(p) + '</button>';
    });
    mine.forEach(function (p, i) {
        html += '<span class="cn-chip cn-chip--mine" data-phrase="' + esc(p) + '" role="button" tabindex="0">' + esc(p) +
            '<button type="button" data-no-click-guard="1" class="cn-chip-x" data-remove="' + i + '" aria-label="' + esc(conTr('con.note.removePhrase')) + '">×</button></span>';
    });
    html += '<button type="button" data-no-click-guard="1" class="cn-chip cn-chip--add" data-add="1" title="' + esc(conTr('con.note.addPhraseTitle')) + '">+ ' +
        esc(conTr('con.note.addPhrase')) + '</button>';
    box.innerHTML = html;
}

function cnOnChipsClick(e) {
    var box = e.target.closest('.cn-chips');
    if (!box) return;
    var key = box.getAttribute('data-key');
    var ta = document.querySelector('#conNoteSections .cn-sec-input[data-key="' + key + '"]');
    var rm = e.target.closest('[data-remove]');
    if (rm) {
        e.stopPropagation();
        var o = cnUserPhrases();
        var list = (o[key] || []).slice();
        list.splice(Number(rm.getAttribute('data-remove')), 1);
        o[key] = list;
        cnSaveUserPhrases(o);
        cnRenderChips(key);
        return;
    }
    if (e.target.closest('[data-add]')) {
        var seed = ta ? String(ta.value.substring(ta.selectionStart, ta.selectionEnd) || '').trim() : '';
        var p = prompt(conTrRepl('con.note.addPhrasePrompt', { SECTION: cnSecName(key) }), seed);
        p = String(p || '').trim();
        if (!p) return;
        var o2 = cnUserPhrases();
        var l2 = (o2[key] || []).filter(function (x) { return x !== p; });
        l2.push(p);
        o2[key] = l2.slice(-20);
        cnSaveUserPhrases(o2);
        cnRenderChips(key);
        return;
    }
    if (e.target.closest('[data-tooth]')) {
        cnOpenToothPicker(e.target.closest('[data-tooth]'), ta);
        return;
    }
    var chip = e.target.closest('[data-phrase]');
    if (chip && ta) cnInsertAtCursor(ta, chip.getAttribute('data-phrase'));
}

/** opts.noFocus: insert without moving focus (focus changes abort Chrome dictation). */
function cnInsertAtCursor(ta, text, sepOverride, opts) {
    if (!ta || !text) return;
    opts = opts || {};
    var v = ta.value || '';
    var s = typeof ta.selectionStart === 'number' ? ta.selectionStart : v.length;
    var e = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : v.length;
    if (document.activeElement !== ta && CN.lastFocusEl !== ta) { s = v.length; e = v.length; }
    var before = v.slice(0, s);
    var after = v.slice(e);
    var sep = '';
    if (sepOverride != null) sep = before ? sepOverride : '';
    else if (before && !/\s$/.test(before)) sep = (/[A-Za-z)]$/.test(before) && /^[A-Z]/.test(text)) ? '. ' : ' ';
    var ins = sep + text;
    var tail = (after && !/^\s/.test(after)) ? ' ' : '';
    ta.value = before + ins + tail + after;
    var pos = before.length + ins.length;
    try {
        if (!opts.noFocus) ta.focus();
        ta.setSelectionRange(pos, pos);
    } catch (err) {}
    CN.lastFocusEl = ta;
    if (opts.noFocus && ta.classList.contains('cn-sec-input')) cnAutoSize(ta);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return pos;
}

/** Append a line to a section (sections mode) or as "Label: text" (free text mode). */
function cnAppendToSection(key, text) {
    var inp = cnInput();
    if (!inp || !text) return;
    if (CN.mode === 'sections') {
        var ta = document.querySelector('#conNoteSections .cn-sec-input[data-key="' + key + '"]');
        if (!ta) return;
        var v = String(ta.value || '').replace(/\s+$/, '');
        ta.value = v ? v + '\n' + text : text;
        cnSetSectionOpen(key, true, false);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        var sec = ta.closest('.cn-sec');
        if (sec) {
            sec.classList.remove('cn-flash');
            void sec.offsetWidth;
            sec.classList.add('cn-flash');
        }
        return;
    }
    var s = cnSectionByKey(key);
    var cur = String(inp.value || '').replace(/\s+$/, '');
    inp.value = (cur ? cur + '\n' : '') + (s ? s.label + ': ' : '') + text;
    cnAutoSize(inp);
    cnScheduleDraft();
    cnRefreshContextMarks();
}

function conNotesApplyTemplateText(tpl) {
    var inp = cnInput();
    if (!inp) return;
    var cur = String(inp.value || '').trim();
    if (cur && cur !== tpl && !confirm(conTr('con.note.replaceWithTemplate'))) return;
    inp.value = tpl;
    var parsed = cnParse(tpl);
    if (parsed.labeled === 0 && CN.mode === 'sections') cnSetMode('free', false);
    else if (CN.mode === 'sections') conNotesSyncFromTextarea();
    cnScheduleDraft();
    if (CN.mode === 'sections') {
        var first = document.querySelector('#conNoteSections .cn-sec.is-open .cn-sec-input');
        if (first) first.focus();
    } else {
        cnAutoSize(inp);
        inp.focus();
    }
}

// ─── Tooth picker (FDI) ────────────────────────────────────────
function cnToothRows(primary) {
    if (primary) return [[55, 54, 53, 52, 51], [61, 62, 63, 64, 65], [85, 84, 83, 82, 81], [71, 72, 73, 74, 75]];
    return [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28],
        [48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]];
}

function cnEnsureToothPop() {
    var pop = g('cnToothPop');
    if (pop) return pop;
    pop = document.createElement('div');
    pop.id = 'cnToothPop';
    pop.className = 'cn-tooth-pop';
    pop.setAttribute('role', 'dialog');
    pop.hidden = true;
    document.body.appendChild(pop);
    pop.addEventListener('mousedown', function (e) { e.preventDefault(); });
    pop.addEventListener('click', function (e) {
        var t = e.target;
        if (t.closest('[data-close]')) { cnCloseToothPicker(); return; }
        var surf = t.closest('[data-surf]');
        if (surf) {
            var k = surf.getAttribute('data-surf');
            CN.toothSurfaces[k] = !CN.toothSurfaces[k];
            surf.classList.toggle('is-on', !!CN.toothSurfaces[k]);
            return;
        }
        var tooth = t.closest('[data-fdi]');
        if (tooth && CN.toothTarget) {
            var code = tooth.getAttribute('data-fdi') + CN_SURFACES.filter(function (x) { return CN.toothSurfaces[x]; }).join('');
            var ta = CN.toothTarget;
            var chained = CN.toothLastEnd >= 0 && ta.selectionStart === CN.toothLastEnd;
            CN.toothLastEnd = cnInsertAtCursor(ta, code, chained ? ', ' : null);
            CN.toothSurfaces = {};
            pop.querySelectorAll('[data-surf].is-on').forEach(function (b) { b.classList.remove('is-on'); });
        }
    });
    pop.addEventListener('change', function (e) {
        if (e.target && e.target.id === 'cnToothPrimary') cnRenderToothGrid(e.target.checked);
    });
    return pop;
}

function cnRenderToothGrid(primary) {
    var grid = document.querySelector('#cnToothPop .cn-tooth-grid');
    if (!grid) return;
    var rows = cnToothRows(primary);
    function row(a, b) {
        return '<div class="cn-tooth-row">' +
            '<div class="cn-tooth-q cn-tooth-q--r">' + a.map(function (n) { return '<button type="button" data-no-click-guard="1" data-fdi="' + n + '">' + n + '</button>'; }).join('') + '</div>' +
            '<div class="cn-tooth-q">' + b.map(function (n) { return '<button type="button" data-no-click-guard="1" data-fdi="' + n + '">' + n + '</button>'; }).join('') + '</div>' +
        '</div>';
    }
    grid.innerHTML = row(rows[0], rows[1]) + '<div class="cn-tooth-mid"></div>' + row(rows[2], rows[3]);
}

function cnOpenToothPicker(anchor, ta) {
    if (!ta) return;
    var pop = cnEnsureToothPop();
    CN.toothTarget = ta;
    CN.toothSurfaces = {};
    CN.toothLastEnd = -1;
    pop.innerHTML =
        '<div class="cn-tooth-head">' +
            '<strong>' + esc(conTr('con.note.toothTitle')) + '</strong>' +
            '<label class="cn-tooth-primary"><input type="checkbox" id="cnToothPrimary"> ' + esc(conTr('con.note.toothPrimary')) + '</label>' +
            '<button type="button" class="cn-tooth-close" data-close="1" aria-label="' + esc(conTr('con.note.close')) + '">×</button>' +
        '</div>' +
        '<div class="cn-tooth-surf">' + CN_SURFACES.map(function (s) {
            return '<button type="button" data-no-click-guard="1" data-surf="' + s + '">' + s + '</button>';
        }).join('') + '</div>' +
        '<div class="cn-tooth-grid"></div>' +
        '<div class="cn-tooth-hint">' + esc(conTr('con.note.toothHint')) + '</div>';
    cnRenderToothGrid(false);
    pop.hidden = false;
    var r = anchor.getBoundingClientRect();
    var w = pop.offsetWidth || 360;
    var left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    var top = r.bottom + 6;
    if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
}

function cnCloseToothPicker() {
    var pop = g('cnToothPop');
    if (pop) pop.hidden = true;
    CN.toothTarget = null;
}

// ─── Dictation ────────────────────────────────────────────────
function cnMicSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

var CN_MIC_MAX_NET_ERRORS = 3;
var cnMic = {
    wantOn: false,
    rec: null,
    stream: null,
    target: null,
    lang: '',
    restartTimer: null,
    netErrors: 0,
    aborts: 0,
    gotResult: false,
    log: []
};

function cnMicLog(msg) {
    cnMic.log.push(new Date().toTimeString().slice(0, 8) + ' ' + msg);
    if (cnMic.log.length > 30) cnMic.log.shift();
}

/** Chrome can abort recognition while a text field has focus; after repeated aborts
 *  with nothing heard, move focus off the field (text still goes to cnMic.target). */
function cnMicReleaseFieldFocus() {
    var ae = document.activeElement;
    if (cnIsNoteField(ae)) {
        try { ae.blur(); } catch (e) {}
        cnMicLog('blurred field after aborts');
    }
}

function cnMicLang() {
    var lang = (typeof appUiLang !== 'undefined') ? appUiLang : 'en';
    if (lang === 'zh-Hant') return 'yue-Hant-HK';
    if (lang === 'zh-CN') return 'cmn-Hans-CN';
    return 'en-US';
}

function cnIsNoteField(el) {
    return !!(el && (el.id === 'conNoteInput' || (el.classList && el.classList.contains('cn-sec-input'))));
}

function cnMicTarget() {
    var el = cnMic.target || CN.lastFocusEl;
    if (cnIsNoteField(el) && document.body.contains(el) && el.offsetParent !== null) return el;
    if (CN.mode === 'sections') {
        var ta = document.querySelector('#conNoteSections .cn-sec-input[data-key="tx"]');
        cnSetSectionOpen('tx', true, false);
        return ta;
    }
    return cnInput();
}

function cnMicSetTarget(el) {
    document.querySelectorAll('#conNoteSections .cn-sec--dictating').forEach(function (s) {
        s.classList.remove('cn-sec--dictating');
    });
    var inp = cnInput();
    if (inp) inp.classList.remove('cn-dictating');
    cnMic.target = el || null;
    if (!el || !cnMic.wantOn) return;
    var sec = el.closest && el.closest('.cn-sec');
    if (sec) sec.classList.add('cn-sec--dictating');
    else el.classList.add('cn-dictating');
}

function cnMicTargetName() {
    var el = cnMic.target;
    var key = el && el.getAttribute && el.getAttribute('data-key');
    return key ? cnSecName(key) : conTr('con.note.modeFree');
}

function cnMicStatus(kind, text) {
    var el = g('conNoteMicState');
    if (!el) return;
    el.className = 'cn-mic-state' + (kind ? ' cn-mic-state--' + kind : '');
    el.textContent = text || '';
    el.hidden = !text;
}

function cnMicRefresh() {
    var btn = g('conNoteMicBtn');
    if (!btn) return;
    btn.classList.toggle('is-listening', cnMic.wantOn);
    btn.setAttribute('aria-pressed', cnMic.wantOn ? 'true' : 'false');
    btn.title = conTr(cnMic.wantOn ? 'con.note.micStop' : 'con.note.micTitle');
}

function cnMicListeningText() {
    return conTrRepl('con.note.micListening', { SECTION: cnMicTargetName() });
}

function cnMicReleaseStream() {
    if (!cnMic.stream) return;
    try { cnMic.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    cnMic.stream = null;
}

/** Grant the mic in the click gesture and keep the stream open while dictating —
 *  releasing it early can leave Chrome "listening" with a dead mic. */
function cnMicEnsureStream() {
    if (!window.isSecureContext) return Promise.reject({ name: 'insecure' });
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve();
    if (cnMic.stream && cnMic.stream.getTracks().some(function (t) { return t.readyState === 'live'; })) {
        return Promise.resolve();
    }
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (s) { cnMic.stream = s; });
}

function cnMicStop(msg) {
    cnMic.wantOn = false;
    clearTimeout(cnMic.restartTimer);
    cnMic.restartTimer = null;
    var rec = cnMic.rec;
    cnMic.rec = null;
    if (rec) {
        rec.onend = null;
        rec.onerror = null;
        rec.onresult = null;
        try { rec.stop(); } catch (e) { try { rec.abort(); } catch (e2) {} }
    }
    cnMicReleaseStream();
    cnMicSetTarget(null);
    cnMicRefresh();
    if (msg) cnMicStatus('error', msg);
    else cnMicStatus('', '');
}

function cnMicScheduleRestart(ms) {
    if (!cnMic.wantOn) return;
    clearTimeout(cnMic.restartTimer);
    cnMic.restartTimer = setTimeout(function () {
        cnMic.restartTimer = null;
        cnMicStartRecognition();
    }, ms == null ? 150 : ms);
}

function cnMicStartRecognition() {
    if (!cnMic.wantOn) return;
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) { cnMicStop(conTr('con.note.micUnsupported')); return; }
    if (cnMic.rec) {
        var old = cnMic.rec;
        cnMic.rec = null;
        old.onend = null;
        old.onerror = null;
        old.onresult = null;
        try { old.abort(); } catch (e) {}
    }
    var rec = new Ctor();
    rec.lang = cnMic.lang || cnMicLang();
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onaudiostart = function () { cnMicLog('audiostart'); };
    rec.onspeechstart = function () { cnMicLog('speechstart'); };
    rec.onresult = function (ev) {
        cnMic.aborts = 0;
        cnMicLog('result');
        var interim = '';
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
            var piece = String(ev.results[i][0].transcript || '');
            if (ev.results[i].isFinal) {
                var text = piece.trim();
                var ta = cnMicTarget();
                if (text && ta) cnInsertAtCursor(ta, text, null, { noFocus: true });
                cnMic.gotResult = true;
            } else {
                interim += piece;
            }
        }
        cnMic.netErrors = 0;
        cnMicStatus('on', interim.trim()
            ? '🎙 ' + interim.trim().slice(-80)
            : cnMicListeningText());
    };
    rec.onerror = function (ev) {
        var code = ev && ev.error ? String(ev.error) : '';
        cnMicLog('error ' + code);
        if (code === 'aborted') {
            cnMic.aborts++;
            if (cnMic.aborts >= 2 && !cnMic.gotResult) cnMicReleaseFieldFocus();
            return;
        }
        if (code === 'no-speech') return;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
            cnMicStop(conTr('con.note.micBlocked'));
            return;
        }
        if (code === 'audio-capture') {
            cnMicStop(conTr('con.note.micNoDevice'));
            return;
        }
        if (code === 'language-not-supported' && rec.lang !== 'en-US') {
            cnMic.lang = 'en-US';
            return;
        }
        if (code === 'network') {
            cnMic.netErrors++;
            if (cnMic.netErrors >= CN_MIC_MAX_NET_ERRORS) cnMicStop(conTr('con.note.micNetwork'));
            return;
        }
        cnMicStatus('error', conTrRepl('con.note.micError', { ERR: code || '?' }));
    };
    rec.onend = function () {
        cnMicLog('end');
        if (cnMic.rec !== rec) return;
        cnMic.rec = null;
        if (cnMic.wantOn) cnMicScheduleRestart(cnMic.netErrors ? 800 : 150);
    };
    try {
        rec.start();
        cnMic.rec = rec;
        cnMicLog('start ' + rec.lang);
        cnMicStatus('on', cnMicListeningText());
    } catch (e) {
        cnMicLog('start failed ' + (e && e.name));
        cnMicScheduleRestart(400);
    }
}

function cnMicToggle() {
    if (cnMic.wantOn) { cnMicStop(); return; }
    if (!cnMicSupported()) { cnMicStatus('error', conTr('con.note.micUnsupported')); return; }
    var active = document.activeElement;
    cnMic.wantOn = true;
    cnMic.netErrors = 0;
    cnMic.aborts = 0;
    cnMic.gotResult = false;
    cnMic.log = [];
    cnMic.lang = cnMicLang();
    cnMicSetTarget(cnIsNoteField(active) ? active : cnMicTarget());
    cnMicRefresh();
    cnMicStatus('on', conTr('con.note.micStarting'));
    cnMicEnsureStream().then(function () {
        if (!cnMic.wantOn) { cnMicReleaseStream(); return; }
        cnMicStartRecognition();
    }).catch(function (err) {
        var name = err && err.name ? err.name : '';
        cnMicLog('getUserMedia failed ' + name);
        if (name === 'insecure') cnMicStop(conTr('con.note.micInsecure'));
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') cnMicStop(conTr('con.note.micNoDevice'));
        else cnMicStop(conTr('con.note.micBlocked'));
    });
}

/** While dictating, clicking into another note field redirects the text there. */
function cnMicOnFocusIn(e) {
    if (!cnMic.wantOn || !cnIsNoteField(e.target)) return;
    if (e.target !== cnMic.target) {
        cnMicSetTarget(e.target);
        cnMicStatus('on', cnMicListeningText());
    }
}

// ─── Drafts ───────────────────────────────────────────────────
function cnDraftKey(pid) { return CN_DRAFT_PREFIX + String(pid); }

function cnDraftRead(pid) {
    if (!pid) return null;
    try {
        var o = JSON.parse(localStorage.getItem(cnDraftKey(pid)) || 'null');
        if (!o || !String(o.text || '').trim()) return null;
        if (o.at && Date.now() - o.at > CN_DRAFT_MAX_AGE_MS) return null;
        return o;
    } catch (e) { return null; }
}

function cnDraftWrite(pid, text) {
    if (!pid) return;
    try {
        if (!String(text || '').trim()) localStorage.removeItem(cnDraftKey(pid));
        else localStorage.setItem(cnDraftKey(pid), JSON.stringify({ text: String(text), at: Date.now() }));
    } catch (e) {}
}

function cnPruneDrafts() {
    try {
        var drop = [];
        for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k || k.indexOf(CN_DRAFT_PREFIX) !== 0) continue;
            var o = null;
            try { o = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) {}
            if (!o || !o.at || Date.now() - o.at > CN_DRAFT_MAX_AGE_MS) drop.push(k);
        }
        drop.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
}

function cnSetDraftState(kind, at) {
    var el = g('conNoteDraftState');
    if (!el) return;
    el.className = 'cn-draft-state' + (kind ? ' cn-draft-state--' + kind : '');
    if (!kind) { el.textContent = ''; return; }
    var time = at ? new Date(at).toLocaleTimeString(conUiLocale(), { hour: '2-digit', minute: '2-digit' }) : '';
    if (kind === 'unsaved') el.textContent = conTr('con.note.draftUnsaved');
    else if (kind === 'saved') el.textContent = conTrRepl('con.note.draftSaved', { TIME: time });
    else if (kind === 'restored') el.textContent = conTrRepl('con.note.draftRestored', { TIME: time });
}

function cnScheduleDraft() {
    if (!CN.draftPid) return;
    var inp = cnInput();
    cnSetDraftState(inp && String(inp.value || '').trim() ? 'unsaved' : '');
    clearTimeout(CN.draftTimer);
    CN.draftTimer = setTimeout(cnFlushDraft, 600);
}

function cnFlushDraft() {
    clearTimeout(CN.draftTimer);
    CN.draftTimer = null;
    if (!CN.draftPid) return;
    var inp = cnInput();
    var text = inp ? String(inp.value || '') : '';
    if (CN.mode === 'sections' && g('conNoteSections') && !g('conNoteSections').hidden) text = cnCompose(cnReadSections());
    cnDraftWrite(CN.draftPid, text);
    cnSetDraftState(text.trim() ? 'saved' : '', Date.now());
}

function conNotesOnPatientSwitch() {
    if (cnMic.wantOn) cnMicStop();
    var inp = cnInput();
    var had = !!(CN.draftPid && inp && String(inp.value || '').trim());
    if (CN.draftPid) cnFlushDraft();
    if (had) cnToast(conTr('con.note.draftKept'));
    CN.draftPid = null;
    CN.carryDismissed = false;
    CN.todayRx = [];
    CN.todayRxKey = '';
    CN.open = {};
    CN.filter.q = '';
    CN.filter.doctor = '';
    CN.filter.showDeleted = false;
    if (g('conNoteSearch')) g('conNoteSearch').value = '';
    if (g('conNoteShowDeleted')) g('conNoteShowDeleted').checked = false;
    cnSetDraftState('');
    cnCloseToothPicker();
    var ctx = g('conNoteContext');
    if (ctx) { ctx.hidden = true; ctx.innerHTML = ''; }
}

function conNotesAfterLoad(pid) {
    if (!pid || typeof conPatientId === 'undefined' || String(pid) !== String(conPatientId)) return;
    var userKey = cnModeUserKey();
    if (userKey !== CN.modeUser) {
        CN.modeUser = userKey;
        var want = cnPreferredMode();
        if (want !== CN.mode) cnSetMode(want, false);
    }
    if (String(CN.draftPid || '') !== String(pid)) {
        CN.draftPid = pid;
        var inp = cnInput();
        var d = cnDraftRead(pid);
        if (inp && d && !String(inp.value || '').trim()) {
            inp.value = d.text;
            if (CN.mode === 'sections') conNotesSyncFromTextarea();
            else cnAutoSize(inp);
            cnSetDraftState('restored', d.at);
        }
    }
    conNotesRefreshContext();
}

function conNotesAfterSave(pid) {
    cnDraftWrite(pid, '');
    clearTimeout(CN.draftTimer);
    CN.open = {};
    conNotesSyncFromTextarea();
    cnSetDraftState('');
}

function cnToast(msg) {
    if (typeof showAppGlobalToast === 'function') showAppGlobalToast(msg);
}

// ─── Doctor chip ──────────────────────────────────────────────
function conNotesRefreshDoctorChip() {
    var chip = g('conNoteDoctorChip');
    if (!chip) return;
    var name = (typeof conActiveDoctorId !== 'undefined' && conActiveDoctorId)
        ? String(conActiveDoctorName || '').trim() : '';
    chip.textContent = name
        ? conTrRepl('con.note.forDoctor', { NAME: name.replace(/^dr\.?\s+/i, '') })
        : conTr('con.note.chooseDoctor');
    chip.classList.toggle('cn-doctor-chip--missing', !name);
    chip.title = conTr('con.note.doctorChipTitle');
}

// ─── Today's context, carry-forward, allergy ──────────────────
function cnTodayIso() {
    return (typeof todayISO === 'function') ? todayISO() : new Date().toISOString().slice(0, 10);
}

function cnAllergyText() {
    var a = (typeof conPatientData !== 'undefined' && conPatientData && conPatientData.allergy)
        ? String(conPatientData.allergy).replace(/\s*[\r\n]+\s*/g, ', ').trim() : '';
    if (!a) return '';
    if (typeof RX_ALLERGY_NONE_RE !== 'undefined' && RX_ALLERGY_NONE_RE.test(a)) return '';
    return a;
}

/** Plan from the most recent note before today: its Next section, else a "Next"/"TCA" line. */
function cnPlanHasText(s) { return /[A-Za-z0-9\u3400-\u9fff]/.test(String(s || '')); }

function cnPlanFromNote(t) {
    var plan = String(cnParse(t.notes || '').sections.next || '').trim();
    if (cnPlanHasText(plan)) return plan;
    var lines = String(t.notes || '').split(/\r?\n/);
    for (var j = lines.length - 1; j >= 0; j--) {
        var line = lines[j].trim();
        var m = line.match(/^(next(?:\s+visit)?|tca|plan)\b\s*[:：\-]?\s*(.*)$/i);
        if (!m || !cnPlanHasText(m[2])) continue;
        return /^tca$/i.test(m[1]) ? 'TCA ' + m[2].trim() : m[2].trim();
    }
    return '';
}

/** Plan from the most recent visit day before today (any note that day with a Next / TCA line). */
function cnCarryForward() {
    var today = cnTodayIso();
    var list = (typeof conTreatmentNotesCache !== 'undefined' ? conTreatmentNotesCache : []) || [];
    var lastDay = '';
    for (var i = 0; i < list.length; i++) {
        var t = list[i];
        var dk = conDateIsoFromTs(t.created_at);
        if (!dk || dk >= today) continue;
        if (lastDay && dk !== lastDay) break;
        lastDay = dk;
        var plan = cnPlanFromNote(t);
        if (plan) return { plan: plan, created_at: t.created_at, id: t.id };
    }
    return null;
}

function cnRxLineText(r) {
    var parts = [r.drug_name, r.dosage, r.frequency].map(function (x) { return String(x || '').trim(); }).filter(Boolean);
    var dur = String(r.duration || '').trim();
    if (dur) parts.push('x ' + dur);
    return parts.join(' ');
}

function cnFetchTodayRx(pid, done) {
    var key = String(pid) + '|' + cnTodayIso();
    if (typeof SB === 'undefined' || !pid) { done(); return; }
    SB.from('drughistory').select('drug_name,dosage,frequency,duration,prescribed_date')
        .eq('patient_id', pid).eq('prescribed_date', cnTodayIso())
        .then(function (r) {
            if (String(pid) !== String(conPatientId)) return;
            CN.todayRx = (r && !r.error && r.data) ? r.data.filter(function (x) { return x && x.drug_name; }) : [];
            CN.todayRxKey = key;
            done();
        });
}

function conNotesRefreshContext() {
    var pid = (typeof conPatientId !== 'undefined') ? conPatientId : null;
    if (!pid) return;
    cnFetchTodayRx(pid, cnRenderContext);
}

function cnTodayItems() {
    var items = [];
    (CN.todayRx || []).forEach(function (r) {
        var text = cnRxLineText(r);
        if (text) items.push({ kind: 'rx', icon: '💊', key: 'px', text: text, match: String(r.drug_name || '') });
    });
    var today = cnTodayIso();
    var seen = {};
    ((typeof conPatientTimelineEvents !== 'undefined' ? conPatientTimelineEvents : []) || []).forEach(function (ev) {
        if (!ev || ev.kind !== 'xray' || !ev.ts) return;
        if (conDateIsoFromTs(new Date(ev.ts)) !== today) return;
        var text = String(ev.body || '').trim();
        if (!text || text === '—' || seen[text]) return;
        seen[text] = 1;
        items.push({ kind: 'xray', icon: '🩻', key: 'xr', text: text, match: text });
    });
    return items;
}

function cnRenderContext() {
    var box = g('conNoteContext');
    if (!box) return;
    var allergy = cnAllergyText();
    var compact = CN.mode === 'free';
    var items = compact ? [] : cnTodayItems();
    var carry = (compact || CN.carryDismissed) ? null : cnCarryForward();
    var html = '';
    if (allergy || items.length) {
        html += '<div class="cn-ctx-row">';
        if (allergy) {
            html += '<span class="cn-ctx-allergy" title="' + esc(conTr('con.note.allergyTitle')) + '">⚠ ' +
                esc(conTrRepl('con.note.allergyChip', { TEXT: allergy })) + '</span>';
        }
        if (items.length) {
            html += '<span class="cn-ctx-lbl">' + esc(conTr('con.note.todayLbl')) + '</span>';
            items.forEach(function (it, i) {
                html += '<button type="button" data-no-click-guard="1" class="cn-ctx-chip cn-ctx-chip--' + it.kind + '" data-ctx="' + i + '" data-match="' + esc(it.match) +
                    '" title="' + esc(conTrRepl('con.note.insertInto', { SECTION: cnSecName(it.key) })) + '">' +
                    it.icon + ' ' + esc(it.text) + '</button>';
            });
        }
        html += '</div>';
    }
    if (carry) {
        html += '<div class="cn-ctx-carry">' +
            '<span class="cn-ctx-carry-lbl">' + esc(conTrRepl('con.note.lastPlan', {
                WHEN: new Date(carry.created_at).toLocaleDateString(conUiLocale(), { day: 'numeric', month: 'short' })
            })) + '</span>' +
            '<span class="cn-ctx-carry-text">' + esc(carry.plan) + '</span>' +
            '<button type="button" class="cn-ctx-carry-btn" data-carry="add">' + esc(conTr('con.note.carryAdd')) + '</button>' +
            '<button type="button" class="cn-ctx-carry-x" data-carry="dismiss" aria-label="' + esc(conTr('con.note.close')) + '">×</button>' +
        '</div>';
    }
    box.innerHTML = html;
    box.hidden = !html;
    box._items = items;
    box._carry = carry;
    cnRefreshContextMarks();
}

function cnRefreshContextMarks() {
    var box = g('conNoteContext');
    var inp = cnInput();
    if (!box || !inp) return;
    var text = CN.mode === 'sections' ? cnCompose(cnReadSections()) : String(inp.value || '');
    var lower = text.toLowerCase();
    box.querySelectorAll('[data-ctx]').forEach(function (b) {
        var m = String(b.getAttribute('data-match') || '').toLowerCase();
        b.classList.toggle('is-used', !!m && lower.indexOf(m) >= 0);
    });
}

function cnOnContextClick(e) {
    var box = g('conNoteContext');
    var chip = e.target.closest('[data-ctx]');
    if (chip) {
        var it = (box._items || [])[Number(chip.getAttribute('data-ctx'))];
        if (it) cnAppendToSection(it.key, it.text);
        return;
    }
    var c = e.target.closest('[data-carry]');
    if (!c) return;
    if (c.getAttribute('data-carry') === 'dismiss') {
        CN.carryDismissed = true;
        cnRenderContext();
        return;
    }
    if (box._carry) cnAppendToSection('tx', box._carry.plan);
}

// ─── History filters ──────────────────────────────────────────
function conNotesFilterState() { return CN.filter; }

function conNotesAfterRender(rows) {
    rows = rows || [];
    var sel = g('conNoteDoctorFilter');
    if (sel) {
        var seen = {};
        var names = [];
        rows.forEach(function (t) {
            var n = String(t.doctor_name || t.dentist_name || t.doctor_tag || '').trim();
            var k = conNoteNameKey(n);
            if (!n || !k || seen[k]) return;
            seen[k] = 1;
            names.push(n);
        });
        names.sort(function (a, b) { return a.localeCompare(b); });
        var cur = CN.filter.doctor;
        sel.innerHTML = '<option value="">' + esc(conTr('con.note.allDoctors')) + '</option>' +
            names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + '</option>'; }).join('');
        sel.value = names.indexOf(cur) >= 0 ? cur : '';
        if (sel.value !== cur) CN.filter.doctor = '';
        sel.hidden = names.length < 2;
    }
    var delWrap = g('conNoteShowDeletedWrap');
    if (delWrap) delWrap.hidden = !rows.some(function (t) { return t.deleted_at; });
    var bar = g('conNoteHistoryBar');
    if (bar) bar.hidden = !rows.length;
}

var cnFilterTimer = null;
function cnApplyFilters() {
    clearTimeout(cnFilterTimer);
    cnFilterTimer = setTimeout(function () {
        if (typeof renderConNotesIntoHost !== 'function') return;
        renderConNotesIntoHost('conTimeline', conTreatmentNotesAll || [], { idPrefix: 'cnt', allowEdit: true, applyFilters: true });
    }, 120);
}

// ─── Wiring ───────────────────────────────────────────────────
function cnInit() {
    var composer = g('conNoteComposer');
    var inp = cnInput();
    if (!composer || !inp || composer.dataset.cnWired) return;
    composer.dataset.cnWired = '1';
    cnPruneDrafts();

    var mode = 'sections';
    mode = cnPreferredMode();
    CN.modeUser = cnModeUserKey();
    cnRenderSections();
    CN.mode = 'free';
    cnSetMode(mode, false);

    composer.querySelectorAll('.cn-mode-btn').forEach(function (b) {
        b.addEventListener('click', function () { cnSetMode(b.getAttribute('data-mode'), true); });
    });
    g('conNoteSections').addEventListener('click', cnOnChipsClick);
    g('conNoteSections').addEventListener('keydown', function (e) {
        var chip = e.target.closest && e.target.closest('.cn-chip--mine');
        if (chip && (e.key === 'Enter' || e.key === ' ') && e.target === chip) {
            e.preventDefault();
            var box = chip.closest('.cn-chips');
            var ta = box && document.querySelector('#conNoteSections .cn-sec-input[data-key="' + box.getAttribute('data-key') + '"]');
            if (ta) cnInsertAtCursor(ta, chip.getAttribute('data-phrase'));
        }
    });
    inp.addEventListener('input', function () {
        if (CN.mode !== 'free') return;
        cnScheduleDraft();
        cnRefreshContextMarks();
    });
    inp.addEventListener('focus', function () { CN.lastFocusEl = inp; });
    composer.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            cnFlushDraft();
            if (typeof saveConNote === 'function') saveConNote();
        }
    });

    var ctx = g('conNoteContext');
    if (ctx) ctx.addEventListener('click', cnOnContextClick);

    var chip = g('conNoteDoctorChip');
    if (chip) chip.addEventListener('click', function () {
        if (typeof rxFocusDoctorPicker === 'function') rxFocusDoctorPicker();
    });
    conNotesRefreshDoctorChip();

    var mic = g('conNoteMicBtn');
    if (mic && cnMicSupported()) {
        mic.hidden = false;
        mic.setAttribute('data-no-click-guard', '1');
        mic.addEventListener('mousedown', function (e) { e.preventDefault(); });
        mic.addEventListener('click', cnMicToggle);
        composer.addEventListener('focusin', cnMicOnFocusIn);
    }

    var search = g('conNoteSearch');
    if (search) search.addEventListener('input', function () {
        CN.filter.q = String(search.value || '').trim();
        cnApplyFilters();
    });
    var docSel = g('conNoteDoctorFilter');
    if (docSel) docSel.addEventListener('change', function () {
        CN.filter.doctor = docSel.value || '';
        cnApplyFilters();
    });
    var showDel = g('conNoteShowDeleted');
    if (showDel) showDel.addEventListener('change', function () {
        CN.filter.showDeleted = !!showDel.checked;
        cnApplyFilters();
    });
    var bar = g('conNoteHistoryBar');
    if (bar) bar.hidden = true;

    document.addEventListener('mousedown', function (e) {
        var pop = g('cnToothPop');
        if (!pop || pop.hidden) return;
        if (pop.contains(e.target) || (e.target.closest && e.target.closest('.cn-chip--tooth'))) return;
        cnCloseToothPicker();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && g('cnToothPop') && !g('cnToothPop').hidden) cnCloseToothPicker();
    });
    window.addEventListener('beforeunload', cnFlushDraft);
    window.addEventListener('app-lang-change', function () {
        var vals = cnReadSections();
        cnRenderSections();
        document.querySelectorAll('#conNoteSections .cn-sec-input').forEach(function (ta) {
            ta.value = vals[ta.getAttribute('data-key')] || '';
        });
        cnApplyOpenStates();
        conNotesRefreshDoctorChip();
        cnRenderContext();
        var st = g('conNoteDraftState');
        if (st && st.textContent) cnSetDraftState('saved', Date.now());
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', cnInit);
else cnInit();
