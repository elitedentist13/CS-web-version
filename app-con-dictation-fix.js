// Consultation notes dictation — accuracy layer (no DOM).
// Chrome's speech engine is general-purpose and ignores vocabulary hints, so we
// pick the alternative that reads most like a dental note, then fix known mishearings
// and apply each user's learned corrections.

var CN_DICT_LEXICON = [
    'scaling', 'charting', 'polishing', 'plaque', 'calculus', 'caries', 'buccal', 'lingual', 'palatal',
    'mesial', 'distal', 'occlusal', 'incisal', 'periapical', 'composite', 'amalgam', 'crown', 'bridge',
    'extraction', 'root canal', 'pulpitis', 'gingivitis', 'periodontitis', 'lignocaine', 'articaine',
    'OHI', 'OPG', 'bitewing', 'X-ray', 'RCT', 'TTP', 'EPT', 'TMJ', 'NAD', 'filling', 'restoration',
    'access cavity', 'obturation', 'irrigation', 'recall', 'review', 'sensitivity', 'abscess', 'swelling',
    'fissure sealant', 'fluoride', 'denture', 'implant', 'mobility', 'pocket', 'bleeding', 'tooth', 'teeth',
    'molar', 'premolar', 'incisor', 'canine', 'gingiva', 'mucosa', 'suture', 'anaesthetic', 'anesthetic'
];

var CN_DICT_ACRONYMS = ['OHI', 'OPG', 'RCT', 'TTP', 'EPT', 'TMJ', 'NAD', 'CBCT', 'LA', 'PA', 'BW'];

var CN_DICT_NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

/** [pattern, replacement] — whole-word, case-insensitive. */
var CN_DICT_RULES = [
    [/\b(ceiling|sailing|skating|scalene|scaring|scailing|scalling)\b/gi, 'scaling'],
    [/\b(chatting|charging|carting|charing|chartering)\b/gi, 'charting'],
    [/\bplague\b/gi, 'plaque'],
    [/\b(buckle|buckel|bucal)\b/gi, 'buccal'],
    [/\b(palette|pallet|palatial|palate all)\b/gi, 'palatal'],
    [/\bcarries\b/gi, 'caries'],
    [/\b(measles|measle|meazel|mesle)\b/gi, 'mesial'],
    [/\b(a clue sal|occlusional|oclusal|a closure)\b/gi, 'occlusal'],
    [/\b(perry|peri|pairy|parry)[\s-]+apical\b/gi, 'periapical'],
    [/\blig\s*(no|nor|na)\s*(cane|kane|caine)\b/gi, 'lignocaine'],
    [/\bcompass it\b/gi, 'composite'],
    [/\ba?\s?mal gum\b/gi, 'amalgam'],
    [/\bpulp\s+(itis|itus|eye tis)\b/gi, 'pulpitis'],
    [/\bbite\s+wing(s?)\b/gi, 'bitewing$1'],
    [/\bx[\s-]?ray(s?)\b/gi, 'X-ray$1'],
    [/\boh\s+hi\b/gi, 'OHI'],
    [/\b(s|ess) and p\b/gi, 'S&P']
];

function cnDictEscape(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function cnDictHasCjk(s) { return /[\u3400-\u9fff\uf900-\ufaff]/.test(String(s || '')); }

function cnDictMatchCase(src, rep) {
    if (!src || !rep) return rep;
    if (rep === rep.toUpperCase()) return rep;
    if (src[0] === src[0].toUpperCase() && src[0] !== src[0].toLowerCase()) {
        return rep[0].toUpperCase() + rep.slice(1);
    }
    return rep;
}

function cnDictApplyLearned(text, learned) {
    var out = String(text || '');
    (learned || []).slice().sort(function (a, b) {
        return String(b.from).length - String(a.from).length;
    }).forEach(function (fx) {
        var from = String(fx && fx.from || '').trim();
        var to = String(fx && fx.to || '');
        if (!from || !to) return;
        var re = new RegExp('(?<![\\w])' + cnDictEscape(from).replace(/\s+/g, '\\s+') + '(?![\\w])', 'gi');
        out = out.replace(re, function (m) { return cnDictMatchCase(m, to); });
    });
    return out;
}

function cnDictApplyBuiltin(text) {
    var out = String(text || '');
    CN_DICT_RULES.forEach(function (r) {
        out = out.replace(r[0], function (m) {
            var args = arguments;
            var rep = r[1].replace(/\$(\d)/g, function (_, n) { return args[Number(n)] || ''; });
            return cnDictMatchCase(m, rep);
        });
    });
    CN_DICT_ACRONYMS.forEach(function (a) {
        var spaced = new RegExp('\\b' + a.toLowerCase().split('').join('[\\s.]+') + '\\b\\.?', 'gi');
        out = out.replace(spaced, a);
        if (a.length >= 3) out = out.replace(new RegExp('\\b' + a + '\\b', 'gi'), a);
    });
    out = out.replace(/\b(one|two|three|four|five|six|seven|eight)\s+(one|two|three|four|five|six|seven|eight)\b/gi,
        function (m, a, b) { return String(CN_DICT_NUM_WORDS[a.toLowerCase()]) + CN_DICT_NUM_WORDS[b.toLowerCase()]; });
    out = out.replace(/\b(tooth|teeth)\s+([1-8])\s+([1-8])\b/gi, '$1 $2$3');
    return out;
}

/** Learned corrections first (they reflect the user's accent), then built-in dental fixes. */
function cnDictCorrect(text, opts) {
    opts = opts || {};
    return cnDictApplyBuiltin(cnDictApplyLearned(text, opts.learned));
}

function cnDictScore(text, opts) {
    opts = opts || {};
    var lower = ' ' + String(text || '').toLowerCase() + ' ';
    var score = 0;
    CN_DICT_LEXICON.concat(opts.extraTerms || []).forEach(function (term) {
        var t = String(term || '').toLowerCase().trim();
        if (t && new RegExp('(?<![a-z])' + cnDictEscape(t) + '(?![a-z])').test(lower)) score++;
    });
    if (/\b[1-8][1-8]\b/.test(lower)) score++;
    if (/^en/i.test(opts.lang || '') && cnDictHasCjk(text)) score -= 5;
    return score;
}

/** alts: Chrome's alternatives, best first. Returns {text, raw, index, alts}; alts = distinct
 *  corrected texts in Chrome's order. Ties keep Chrome's order. */
function cnDictBest(alts, opts) {
    opts = opts || {};
    var best = null;
    var all = [];
    (alts || []).forEach(function (raw, i) {
        raw = String(raw || '').trim();
        if (!raw) return;
        var fixed = cnDictCorrect(raw, opts);
        if (all.indexOf(fixed) < 0) all.push(fixed);
        var s = cnDictScore(fixed, opts);
        if (!best || s > best.score) best = { text: fixed, raw: raw, index: i, score: s };
    });
    best = best || { text: '', raw: '', index: -1, score: 0 };
    best.alts = all;
    return best;
}

var CN_DICT_COMMON = ('the and for with was were are has had have not but this that from they them then than '
    + 'there their what when will would could should into onto over under after before again also only very '
    + 'some more most less left right upper lower done good well days week weeks today pain said gave given '
    + 'said came back need needs next time patient says felt feel took take').split(' ');

function cnDictLevenshtein(a, b) {
    var m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
        cur = [i];
        for (j = 1; j <= n; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
    }
    return prev[n];
}

/** Single-word lexicon terms that sound/look close to `word` (e.g. calling → scaling). */
function cnDictNearTerms(word, opts) {
    var w = String(word || '').toLowerCase();
    if (w.length < 4 || CN_DICT_COMMON.indexOf(w) >= 0) return [];
    var terms = CN_DICT_LEXICON.concat((opts && opts.extraTerms) || []);
    var seen = {};
    var hits = [];
    terms.forEach(function (t) {
        t = String(t || '').trim();
        var tl = t.toLowerCase();
        if (!t || /\s/.test(t) || tl.length < 4 || seen[tl] || tl === w) return;
        seen[tl] = 1;
        var d = cnDictLevenshtein(w, tl);
        if (d <= 3 && d / Math.max(w.length, tl.length) <= 0.4) hits.push({ t: t, d: d });
    });
    hits.sort(function (a, b) { return a.d - b.d; });
    return hits.map(function (h) { return h.t; });
}

/** Alternatives built by swapping one non-dental word for a close dental term. */
function cnDictSuggest(text, opts) {
    var out = [];
    var lexLow = CN_DICT_LEXICON.map(function (t) { return t.toLowerCase(); });
    String(text || '').replace(/[A-Za-z]+/g, function (word, at) {
        if (lexLow.indexOf(word.toLowerCase()) >= 0) return word;
        cnDictNearTerms(word, opts).slice(0, 2).forEach(function (term) {
            var alt = text.slice(0, at) + cnDictMatchCase(word, term) + text.slice(at + word.length);
            if (out.indexOf(alt) < 0) out.push(alt);
        });
        return word;
    });
    return out;
}

/** After the user edits dictated text, find a single word/phrase swap inside the dictated
 *  range [start, end) of oldVal. Returns {from, to} or null. */
function cnDictFindCorrection(oldVal, newVal, start, end) {
    oldVal = String(oldVal || '');
    newVal = String(newVal || '');
    if (oldVal === newVal) return null;
    var p = 0;
    var max = Math.min(oldVal.length, newVal.length);
    while (p < max && oldVal[p] === newVal[p]) p++;
    var s = 0;
    while (s < max - p && oldVal[oldVal.length - 1 - s] === newVal[newVal.length - 1 - s]) s++;
    var isW = function (c) { return !!c && /[\w'-]/.test(c); };
    // Widen to whole words only where the change cuts through a word.
    if (isW(oldVal[p]) || isW(newVal[p])) {
        while (p > 0 && isW(oldVal[p - 1])) p--;
    }
    if (isW(oldVal[oldVal.length - s - 1]) || isW(newVal[newVal.length - s - 1])) {
        while (s > 0 && isW(oldVal[oldVal.length - s])) s--;
    }
    var oldEnd = oldVal.length - s;
    if (p < start || oldEnd > end) return null;
    var from = oldVal.slice(p, oldEnd).trim();
    var to = newVal.slice(p, newVal.length - s).trim();
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return null;
    var fw = from.split(/\s+/).length;
    var tw = to.split(/\s+/).length;
    if (fw > 3 || tw > 4) return null;
    if (!/[a-z]/i.test(from) || !/[a-z0-9]/i.test(to)) return null;
    return { from: from, to: to };
}
