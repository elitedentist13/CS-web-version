// ════════════════════════════════════════════════════════════════
// PERIO DICTATION — audio widget (English commands)
// Mirrors periodontalchart-online.com "Dictation with the audio widget":
// Chrome/Edge SpeechRecognition → parse → write perioState along the
// clinic probing sequence. No server. Hands-free chairside entry.
// ════════════════════════════════════════════════════════════════

var PD_DICT_TRAIN_KEY = 'banana_perio_speech_training';

var pdDict = {
    listening: false,
    mode: 'live',          // 'live' | 'batch'
    expanded: false,
    tipsOpen: false,       // mini voice-control notes capsule
    rec: null,
    wantOn: false,
    heard: '',
    status: '',
    cursor: null,          // { tn, surface, pos, measure }
    handSite: null,        // last manually clicked/focused perio cell
    undoStack: [],         // recent writes for voice "undo" / "back"
    batchBuf: '',
    batchTimer: null,
    restartTimer: null,    // delayed SpeechRecognition restart
    watchdogTimer: null,   // revive dead sessions while wantOn
    lastHeardAt: 0,
    train: [],
    lastError: '',
    micBlocked: false,
    micStream: null
};

var PD_DICT_FDI = [
    18, 17, 16, 15, 14, 13, 12, 11,
    21, 22, 23, 24, 25, 26, 27, 28,
    48, 47, 46, 45, 44, 43, 42, 41,
    31, 32, 33, 34, 35, 36, 37, 38
];

var PD_DICT_WISDOM = [18, 28, 38, 48];

var UNIVERSAL_TO_FDI = {
    1: 18, 2: 17, 3: 16, 4: 15, 5: 14, 6: 13, 7: 12, 8: 11,
    9: 21, 10: 22, 11: 23, 12: 24, 13: 25, 14: 26, 15: 27, 16: 28,
    17: 38, 18: 37, 19: 36, 20: 35, 21: 34, 22: 33, 23: 32, 24: 31,
    25: 41, 26: 42, 27: 43, 28: 44, 29: 45, 30: 46, 31: 47, 32: 48
};

/* Spoken digit words = one pocket each (“one two one” → 1, 2, 1).
 * Two-digit PD only via compound words (“twelve” → 12). Chrome may glue
 * pauses into “121” / “12 1”; those are split on the PD/GM walk. */
var PD_DICT_NUM_WORDS = [
    ['twenty eight', '28'], ['twenty seven', '27'], ['twenty six', '26'],
    ['twenty five', '25'], ['twenty four', '24'], ['twenty three', '23'],
    ['twenty two', '22'], ['twenty one', '21'], ['twenty', '20'],
    ['thirty eight', '38'], ['thirty seven', '37'], ['thirty six', '36'],
    ['thirty five', '35'], ['thirty four', '34'], ['thirty three', '33'],
    ['thirty two', '32'], ['thirty one', '31'], ['thirty', '30'],
    ['forty eight', '48'], ['forty seven', '47'], ['forty six', '46'],
    ['forty five', '45'], ['forty four', '44'], ['forty three', '43'],
    ['forty two', '42'], ['forty one', '41'], ['forty', '40'],
    ['eighteen', '18'], ['seventeen', '17'], ['sixteen', '16'],
    ['fifteen', '15'], ['fourteen', '14'], ['thirteen', '13'],
    ['twelve', '12'], ['eleven', '11'], ['ten', '10'],
    ['nine', '9'], ['eight', '8'], ['seven', '7'], ['six', '6'],
    ['five', '5'], ['four', '4'], ['three', '3'], ['two', '2'],
    ['zero', '0'], ['oh', '0'], ['nought', '0']
];

// Longest site phrases first. surface null = keep the current surface.
var PD_DICT_SITES = [
    { phrase: 'disto buccal', surface: 'b', pos: 'd' },
    { phrase: 'distal buccal', surface: 'b', pos: 'd' },
    { phrase: 'distobuccal', surface: 'b', pos: 'd' },
    { phrase: 'mesio buccal', surface: 'b', pos: 'me' },
    { phrase: 'mesial buccal', surface: 'b', pos: 'me' },
    { phrase: 'mesiobuccal', surface: 'b', pos: 'me' },
    { phrase: 'mid buccal', surface: 'b', pos: 'm' },
    { phrase: 'midbuccal', surface: 'b', pos: 'm' },
    { phrase: 'disto lingual', surface: 'l', pos: 'd' },
    { phrase: 'distal lingual', surface: 'l', pos: 'd' },
    { phrase: 'distolingual', surface: 'l', pos: 'd' },
    { phrase: 'mesio lingual', surface: 'l', pos: 'me' },
    { phrase: 'mesial lingual', surface: 'l', pos: 'me' },
    { phrase: 'mesiolingual', surface: 'l', pos: 'me' },
    { phrase: 'mid lingual', surface: 'l', pos: 'm' },
    { phrase: 'midlingual', surface: 'l', pos: 'm' },
    { phrase: 'disto palatal', surface: 'l', pos: 'd' },
    { phrase: 'distal palatal', surface: 'l', pos: 'd' },
    { phrase: 'distopalatal', surface: 'l', pos: 'd' },
    { phrase: 'mesio palatal', surface: 'l', pos: 'me' },
    { phrase: 'mesial palatal', surface: 'l', pos: 'me' },
    { phrase: 'mesiopalatal', surface: 'l', pos: 'me' },
    { phrase: 'mid palatal', surface: 'l', pos: 'm' },
    { phrase: 'midpalatal', surface: 'l', pos: 'm' },
    { phrase: 'buccal', surface: 'b', pos: 'm' },
    { phrase: 'lingual', surface: 'l', pos: 'm' },
    { phrase: 'palatal', surface: 'l', pos: 'm' },
    { phrase: 'distal', surface: null, pos: 'd' },
    { phrase: 'mesial', surface: null, pos: 'me' },
    { phrase: 'mid', surface: null, pos: 'm' },
    { phrase: 'db', surface: 'b', pos: 'd' },
    { phrase: 'mb', surface: 'b', pos: 'me' },
    { phrase: 'dl', surface: 'l', pos: 'd' },
    { phrase: 'ml', surface: 'l', pos: 'me' },
    { phrase: 'dp', surface: 'l', pos: 'd' },
    { phrase: 'mp', surface: 'l', pos: 'me' }
];

function pdDictTr(key) {
    return (typeof t === 'function') ? t(key) : key;
}

function pdDictSpeechSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function pdDictMicSecureContext() {
    return window.isSecureContext === true;
}

function pdDictStopMicStream() {
    if (pdDict.micStream) {
        try {
            pdDict.micStream.getTracks().forEach(function(t) { t.stop(); });
        } catch (e) { /* ignore */ }
        pdDict.micStream = null;
    }
}

/** Ask for microphone access in the same user gesture before SpeechRecognition.
 *  Keep the stream open while dictating — releasing it immediately can leave
 *  Chrome's SpeechRecognition with a dead mic and "listening" but no results. */
function pdDictEnsureMicPermission() {
    return new Promise(function(resolve, reject) {
        if (!pdDictMicSecureContext()) {
            reject(new Error('insecure'));
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            resolve();
            return;
        }
        if (pdDict.micStream && pdDict.micStream.getTracks().some(function(t) {
            return t.readyState === 'live';
        })) {
            pdDict.micBlocked = false;
            resolve();
            return;
        }
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function(stream) {
                pdDict.micStream = stream;
                pdDict.micBlocked = false;
                resolve();
            })
            .catch(function(err) {
                pdDictStopMicStream();
                reject(err || new Error('denied'));
            });
    });
}

function pdDictHandleMicBlocked(err) {
    pdDict.wantOn = false;
    pdDict.listening = false;
    pdDict.micBlocked = true;
    pdDictClearRestartTimer();
    pdDictClearWatchdog();
    pdDictStopMicStream();
    if (err && err.message === 'insecure') {
        pdDict.status = pdDictTr('chart.perio.dictate.needSecure');
    } else {
        pdDict.status = pdDictTr('chart.perio.dictate.micDenied');
    }
    pdDict.expanded = true;
    if (typeof showChartToast === 'function') {
        showChartToast(pdDict.status);
    }
    pdDictSyncUi();
}

function pdDictLoadTrain() {
    try {
        var raw = localStorage.getItem(PD_DICT_TRAIN_KEY);
        var parsed = raw ? JSON.parse(raw) : [];
        pdDict.train = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        pdDict.train = [];
    }
}

function pdDictSaveTrain() {
    try { localStorage.setItem(PD_DICT_TRAIN_KEY, JSON.stringify(pdDict.train)); }
    catch (e) { /* ignore quota */ }
}

function pdDictApplyTrain(s) {
    pdDict.train.forEach(function(pair) {
        if (!pair || !pair.heard || !pair.expect) return;
        var heard = String(pair.heard).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (!heard) return;
        s = s.replace(new RegExp('\\b' + heard + '\\b', 'g'), String(pair.expect).toLowerCase());
    });
    return s;
}

function pdDictReplaceNumWords(s) {
    PD_DICT_NUM_WORDS.forEach(function(pair) {
        var keep = String(pair[1]).length > 1;
        var repl = keep ? ('\uE000' + pair[1] + '\uE001') : pair[1];
        s = s.replace(new RegExp('\\b' + pair[0] + '\\b', 'g'), repl);
    });
    // "one" last so it cannot eat "twenty one" leftovers
    s = s.replace(/\bone\b/g, '1');
    return s;
}

function pdDictRestoreKeptNums(s) {
    return String(s || '').replace(/\uE000(\d+)\uE001/g, '$1');
}

function pdDictOnPdWalk() {
    if (!pdDict.cursor) return false;
    var m = pdDictEffectiveMeasure(pdDict.cursor.measure);
    return m === 'pd' || m === 'gm';
}

function pdDictSplitGluedPdDigits(s) {
    s = String(s || '');
    var structural = /\b(missing|present|tooth|teeth|mobility|implant|dental|furcation|wisdom|start|begin)\b/.test(s);
    var parts = s.split(/(\uE000\d+\uE001)/);

    // Count every "loose" (unmarked) digit run in the whole utterance first.
    // Speech recognition often renders a spoken number word as its own digit
    // form directly (e.g. "ten" → the literal text "10") without ever going
    // through the word list above, so it never gets the \uE000..\uE001
    // protection. A LONE two-digit run in the realistic PD/GM range (10-15)
    // with nothing else numeric in the same utterance is almost certainly
    // that — a single genuine reading — not two single-digit pocket depths
    // mashed together. That "glued digits" ambiguity only makes sense once a
    // *second* number is also present in the same utterance (e.g. "12 1"
    // from a rushed "one two one"), so only skip the split in the lone case.
    var looseRuns = [];
    parts.forEach(function(p) {
        if (!p || /^\uE000\d+\uE001$/.test(p)) return;
        var m = p.match(/-?\d+/g);
        if (m) looseRuns = looseRuns.concat(m);
    });
    // Allow the sign too: a lone "-10" is the GM equivalent of a lone "10".
    var soleTeen = pdDictOnPdWalk() && !structural && looseRuns.length === 1 &&
        /^-?1[0-5]$/.test(looseRuns[0]);

    var out = [];
    var i;
    for (i = 0; i < parts.length; i++) {
        var p = parts[i];
        if (!p) continue;
        if (/^\uE000\d+\uE001$/.test(p)) {
            out.push(pdDictRestoreKeptNums(p));
            continue;
        }
        if (pdDictOnPdWalk() && !structural) {
            p = p.replace(/-?\d+/g, function(tok) {
                if (soleTeen) return tok;
                var neg = tok.charAt(0) === '-';
                var digits = neg ? tok.slice(1) : tok;
                if (digits.length <= 1) return tok;
                // 3+ glued digits — with or without a spurious leading "-"
                // some engines slap on a fast-spoken run of digits (e.g.
                // "six seven two" transcribed as "-672" instead of "6 7 2",
                // the way a score or range might be formatted) — are
                // essentially never one real reading; PD/GM clamp to ±15,
                // so anything bigger is always separate single-digit
                // readings. Split back into single digits and drop any such
                // sign — a genuine run of negative GM readings is dictated
                // with "minus" before each digit, not as one glued blob, so
                // there's nothing legitimate lost by dropping it here.
                return digits.split('').join(' ');
            });
        }
        out.push(p);
    }
    return out.join('').replace(/\s+/g, ' ').trim();
}

function pdDictTranscriptSplitScore(t) {
    t = String(t || '').toLowerCase();
    if (/\b(one|two|three|four|five|six|seven|eight|nine|zero|oh)\b/.test(t)) return 2;
    if (/\d\s+\d/.test(t)) return 1;
    return 0;
}

function pdDictPickResultTranscript(result) {
    if (!result || !result.length) return '';
    var best = (result[0] && result[0].transcript) ? result[0].transcript : '';
    if (!pdDictOnPdWalk()) return best;
    // A transcript that is nothing but one bare number ("10", "-3") is already
    // an unambiguous single reading — don't let the "prefer a split-looking
    // alternate" heuristic below swap it for a worse one (this is how saying
    // "ten" could end up picking an alternate like "one zero").
    if (/^-?\d{1,2}$/.test(String(best || '').trim())) return best;
    var i, picked = best, score = pdDictTranscriptSplitScore(best);
    for (i = 1; i < result.length; i++) {
        var t = (result[i] && result[i].transcript) ? result[i].transcript : '';
        var sc = pdDictTranscriptSplitScore(t);
        if (sc > score) {
            score = sc;
            picked = t;
        }
    }
    return picked;
}

function pdDictIsFdi(n) {
    return PD_DICT_FDI.indexOf(n) >= 0;
}

function pdDictResolveTooth(n) {
    n = parseInt(n, 10);
    if (isNaN(n)) return null;
    var preferUni = perioSettings && perioSettings.numbering === 'universal';
    if (preferUni) {
        if (UNIVERSAL_TO_FDI[n]) return UNIVERSAL_TO_FDI[n];
        if (pdDictIsFdi(n)) return n;
    } else {
        if (pdDictIsFdi(n)) return n;
        if (UNIVERSAL_TO_FDI[n]) return UNIVERSAL_TO_FDI[n];
    }
    return null;
}

function pdDictCollapseToothDigits(s) {
    // Join spoken FDI pairs only after an explicit lead-in ("tooth 2 8",
    // "start 1 7"). Never join bare "3 2 4" pocket depths into tooth 32.
    s = s.replace(
        /\b(tooth|start|begin|bop|bleeding|plaque|pi)\s+([1-8])\s+([1-8])\b/g,
        function(m, lead, a, b) {
            var joined = parseInt(a + b, 10);
            return pdDictResolveTooth(joined) ? (lead + ' ' + joined) : m;
        }
    );
    if (!pdDict.cursor) {
        s = s.replace(/^([1-8])\s+([1-8])\b/, function(m, a, b) {
            var joined = parseInt(a + b, 10);
            return pdDictResolveTooth(joined) ? String(joined) : m;
        });
    }
    return s;
}

function pdDictNormalize(raw) {
    var s = String(raw || '').toLowerCase();
    s = s.replace(/[_'`’]+/g, '');
    s = s.replace(/[.,!?;:]+/g, ' ');
    // Keep GM negatives like "-2"; only break hyphenated words / ranges.
    s = s.replace(/([a-z])-([a-z])/g, '$1 $2');
    s = s.replace(/(\d)-(\d)/g, '$1 $2');
    s = s.replace(/\s+/g, ' ').trim();
    s = pdDictApplyTrain(s);
    s = pdDictReplaceNumWords(s);
    // Common Chrome mishears for single pocket depths while a site cursor is active.
    // Skip when the utterance is clearly a tooth-status / structural command.
    if (pdDict.cursor &&
        !/\b(missing|present|tooth|teeth|mobility|implant|dental|furcation|wisdom)\b/.test(s)) {
        s = s.replace(/\b(for|fore)\b/g, '4');
        s = s.replace(/\b(to|too|tu)\b/g, '2');
        s = s.replace(/\b(tree|free)\b/g, '3');
        s = s.replace(/\b(won)\b/g, '1');
        s = s.replace(/\b(ate)\b/g, '8');
    }
    s = pdDictCollapseToothDigits(s);
    s = pdDictSplitGluedPdDigits(s);
    s = pdDictRestoreKeptNums(s);
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}

function pdDictParseSiteFromWords(words, idx) {
    var max = Math.min(3, words.length - idx);
    var n, i;
    for (n = max; n >= 1; n--) {
        var phrase = words.slice(idx, idx + n).join(' ');
        for (i = 0; i < PD_DICT_SITES.length; i++) {
            if (PD_DICT_SITES[i].phrase === phrase) {
                return {
                    surface: PD_DICT_SITES[i].surface,
                    pos: PD_DICT_SITES[i].pos,
                    consumed: n
                };
            }
        }
    }
    return null;
}

function pdDictParseGrade(token) {
    token = String(token || '').toLowerCase();
    if (token === '0' || token === 'zero') return '0';
    if (token === '1' || token === 'i' || token === 'one') return 'I';
    if (token === '2' || token === 'ii' || token === 'two') return 'II';
    if (token === '3' || token === 'iii' || token === 'three') return 'III';
    return null;
}

function pdDictSkipFiller(words, idx) {
    while (idx < words.length &&
        (words[idx] === 'is' || words[idx] === 'are' || words[idx] === 'the' ||
         words[idx] === 'a' || words[idx] === 'an' || words[idx] === 'grade' ||
         words[idx] === 'class' || words[idx] === 'its' || words[idx] === 'it' ||
         words[idx] === 'was' || words[idx] === 'been' || words[idx] === 'has' ||
         words[idx] === 'have' || words[idx] === 'as' || words[idx] === 'marked')) {
        idx += 1;
    }
    return idx;
}

function pdDictIsMissingWord(w) {
    w = String(w || '').toLowerCase();
    return w === 'missing' || w === 'absent' || w === 'extracted' ||
        w === 'extract' || w === 'gone' || w === 'out' || w === 'mission'; // mission ≈ Chrome mishear
}

function pdDictIsPresentWord(w) {
    w = String(w || '').toLowerCase();
    return w === 'present' || w === 'exists' || w === 'existing' || w === 'natural';
}

/**
 * Parse an English dictation chunk into ordered actions.
 * Exposed for tests: window.perioDictationParse
 */
function pdDictParse(raw) {
    var s = pdDictNormalize(raw);
    if (!s) return [];
    // Soften common Chrome mishears for tooth-status phrases
    s = s.replace(/\bmission\b/g, 'missing');
    s = s.replace(/\bmissin\b/g, 'missing');
    s = s.replace(/\bmissed\b/g, 'missing');
    s = s.replace(/\bits\b/g, 'is');
    s = s.replace(/\s+/g, ' ').trim();
    var actions = [];
    var words = s.split(' ');
    var i = 0;

    function takeGroupTail(idx) {
        var j = pdDictSkipFiller(words, idx);
        if (j < words.length && pdDictIsPresentWord(words[j])) {
            return { state: 'present', next: j + 1 };
        }
        if (j < words.length && pdDictIsMissingWord(words[j])) {
            return { state: 'missing', next: j + 1 };
        }
        return { state: 'missing', next: idx };
    }

    /** After a tooth number, accept “is missing / missing / absent …” within a few words. */
    function takeToothStatus(fromIdx) {
        var j = pdDictSkipFiller(words, fromIdx);
        var look;
        for (look = j; look < words.length && look <= j + 3; look++) {
            if (pdDictIsMissingWord(words[look])) {
                return { type: 'missing', next: look + 1 };
            }
            if (pdDictIsPresentWord(words[look])) {
                return { type: 'present', next: look + 1 };
            }
            // Keep scanning through light fillers only
            if (words[look] === 'is' || words[look] === 'are' || words[look] === 'the' ||
                words[look] === 'a' || words[look] === 'an' || words[look] === 'now' ||
                words[look] === 'already' || words[look] === 'still') {
                continue;
            }
            break;
        }
        return null;
    }

    while (i < words.length) {
        var w = words[i];

        if (w === 'stop' || w === 'cancel') {
            actions.push({ type: 'stop' });
            i += 1;
            continue;
        }
        if (w === 'undo' || w === 'wipe' || w === 'oops' || w === 'back' ||
            w === 'correct' || w === 'erase') {
            actions.push({ type: 'undo' });
            i += 1;
            continue;
        }
        if (w === 'go' && words[i + 1] === 'back') {
            actions.push({ type: 'undo' });
            i += 2;
            continue;
        }
        if (w === 'delete' && (words[i + 1] === 'last' || words[i + 1] === 'previous')) {
            actions.push({ type: 'undo' });
            i += 2;
            continue;
        }
        if ((w === 'live' || w === 'batch') && words[i + 1] === 'mode') {
            actions.push({ type: 'mode', mode: w });
            i += 2;
            continue;
        }
        if (w === 'next' || w === 'continue' || w === 'skip') {
            actions.push({ type: 'next' });
            i += 1;
            continue;
        }

        // Short form: “missing 18” / “missing tooth 28” / “absent 2 8”
        if (pdDictIsMissingWord(w) || pdDictIsPresentWord(w)) {
            var statusType = pdDictIsMissingWord(w) ? 'missing' : 'present';
            var si = i + 1;
            if (words[si] === 'tooth' || words[si] === 'teeth') si += 1;
            si = pdDictSkipFiller(words, si);
            var statusTn = null;
            var statusNext = si;
            if (words[si] && /^\d+$/.test(words[si])) {
                if (words[si + 1] && /^\d$/.test(words[si + 1])) {
                    var joinedMiss = pdDictResolveTooth(
                        parseInt(String(Math.abs(parseInt(words[si], 10))) + words[si + 1], 10)
                    );
                    if (joinedMiss) {
                        statusTn = joinedMiss;
                        statusNext = si + 2;
                    }
                }
                if (!statusTn) {
                    statusTn = pdDictResolveTooth(words[si]);
                    if (statusTn) statusNext = si + 1;
                }
            }
            if (statusTn) {
                actions.push({ type: statusType, tn: statusTn });
                i = statusNext;
                continue;
            }
        }

        // Short form: “dental implant 14” / “implant 14” / “implant tooth 36”
        if ((w === 'dental' && words[i + 1] === 'implant') || w === 'implant') {
            var impOn = true;
            var ii = (w === 'dental') ? i + 2 : i + 1;
            if (words[ii] === 'remove' || words[ii] === 'off' || words[ii] === 'clear') {
                impOn = false;
                ii += 1;
            }
            if (words[ii] === 'tooth' || words[ii] === 'teeth') ii += 1;
            ii = pdDictSkipFiller(words, ii);
            var impTn = null;
            var impNext = ii;
            if (words[ii] && /^\d+$/.test(words[ii])) {
                if (words[ii + 1] && /^\d$/.test(words[ii + 1])) {
                    var joinedImp = pdDictResolveTooth(
                        parseInt(String(Math.abs(parseInt(words[ii], 10))) + words[ii + 1], 10)
                    );
                    if (joinedImp) {
                        impTn = joinedImp;
                        impNext = ii + 2;
                    }
                }
                if (!impTn) {
                    impTn = pdDictResolveTooth(words[ii]);
                    if (impTn) impNext = ii + 1;
                }
            }
            // “implant 14 remove” (remove after the number)
            if (impTn && (words[impNext] === 'remove' || words[impNext] === 'off' ||
                words[impNext] === 'clear')) {
                impOn = false;
                impNext += 1;
            }
            if (impTn) {
                actions.push({ type: 'implant', tn: impTn, on: impOn });
                i = impNext;
                continue;
            }
        }

        if ((w === 'start' || w === 'begin' || w === 'bop' || w === 'bleeding' ||
            w === 'plaque' || w === 'pi') && words[i + 1] && pdDictResolveTooth(words[i + 1])) {
            var tn0 = pdDictResolveTooth(words[i + 1]);
            var measure0 = 'auto';
            if (w === 'bop' || w === 'bleeding') measure0 = 'bop';
            else if (w === 'plaque' || w === 'pi') measure0 = 'pi';
            var surface0 = 'b';
            var pos0 = 'd';
            var consumed0 = 2;
            var site0 = pdDictParseSiteFromWords(words, i + 2);
            if (site0) {
                if (site0.surface) surface0 = site0.surface;
                pos0 = site0.pos;
                consumed0 += site0.consumed;
            }
            actions.push({
                type: 'start', tn: tn0, surface: surface0, pos: pos0, measure: measure0
            });
            i += consumed0;
            continue;
        }

        if (w === 'all' && words[i + 1] === 'wisdom' && words[i + 2] === 'teeth') {
            var g1 = takeGroupTail(i + 3);
            actions.push({ type: g1.state + 'Group', group: 'wisdom' });
            i = g1.next;
            continue;
        }
        if (w === 'all' && (words[i + 1] === 'upper' || words[i + 1] === 'lower' ||
            words[i + 1] === 'maxillary' || words[i + 1] === 'mandibular')) {
            var gWord = words[i + 1];
            var group = (gWord === 'upper' || gWord === 'maxillary') ? 'upper' : 'lower';
            var skipTeeth = words[i + 2] === 'teeth' ? 3 : 2;
            var g2 = takeGroupTail(i + skipTeeth);
            actions.push({ type: g2.state + 'Group', group: group });
            i = g2.next;
            continue;
        }

        var toothIdx = (w === 'tooth' && words[i + 1]) ? i + 1 : i;
        var tn = pdDictResolveTooth(words[toothIdx]);
        if (tn) {
            var statusHit = takeToothStatus(toothIdx + 1);
            if (statusHit) {
                actions.push({ type: statusHit.type, tn: tn });
                i = statusHit.next;
                continue;
            }
            var k = pdDictSkipFiller(words, toothIdx + 1);
            var nextW = words[k];
            if (nextW === 'mobility') {
                var mk = pdDictSkipFiller(words, k + 1);
                var gradeM = pdDictParseGrade(words[mk]);
                if (gradeM) {
                    actions.push({ type: 'mobility', tn: tn, grade: gradeM });
                    i = mk + 1;
                    continue;
                }
            }
            if (nextW === 'implant' || (w === 'implant' && tn)) {
                var remove = words[k + 1] === 'remove' || words[toothIdx + 1] === 'remove';
                actions.push({ type: 'implant', tn: tn, on: !remove });
                i = k + (nextW === 'implant' ? 1 : 0) + (remove ? 1 : 0);
                if (w === 'implant') i = toothIdx + 1;
                continue;
            }
            if (nextW === 'furcation' || words[k + 1] === 'furcation') {
                var fk = nextW === 'furcation' ? k + 1 : k + 2;
                fk = pdDictSkipFiller(words, fk);
                var gradeF = pdDictParseGrade(words[fk]) || 'I';
                actions.push({ type: 'furcation', tn: tn, grade: gradeF });
                i = pdDictParseGrade(words[fk]) ? fk + 1 : fk;
                continue;
            }
            // Bare FDI while mic is on with a cursor is a PD value, not a tooth jump —
            // unless the word "tooth" introduced it (then skip the filler word only).
            if (w === 'tooth') {
                i = toothIdx + 1;
                continue;
            }
        }

        if (w === 'mobility' && words[i + 1]) {
            var tnMob = pdDictResolveTooth(words[i + 1]);
            var mk2 = pdDictSkipFiller(words, i + 2);
            var gMob = pdDictParseGrade(words[mk2]);
            if (tnMob && gMob) {
                actions.push({ type: 'mobility', tn: tnMob, grade: gMob });
                i = mk2 + 1;
                continue;
            }
        }
        if (w === 'implant' && words[i + 1]) {
            var tnImp = pdDictResolveTooth(words[i + 1]);
            if (tnImp) {
                actions.push({ type: 'implant', tn: tnImp, on: words[i + 2] !== 'remove' });
                i += 2;
                continue;
            }
        }

        if (w === 'plus' || w === 'positive' || w === 'yes' || w === 'yep' || w === 'true') {
            actions.push({ type: 'plus' });
            i += 1;
            continue;
        }
        if (w === 'minus' && words[i + 1] && /^-?\d+$/.test(words[i + 1])) {
            actions.push({ type: 'value', n: -Math.abs(parseInt(words[i + 1], 10)) });
            i += 2;
            continue;
        }
        if (w === 'minus' || w === 'negative' || w === 'no' || w === 'none' || w === 'false' ||
            w === 'blank' || w === 'clear') {
            actions.push({ type: 'minus' });
            i += 1;
            continue;
        }
        if (w === 'bleeding' || w === 'bop') {
            actions.push({ type: 'measure', measure: 'bop' });
            i += 1;
            continue;
        }
        if (w === 'plaque' || w === 'pi') {
            actions.push({ type: 'measure', measure: 'pi' });
            i += 1;
            continue;
        }
        if (w === 'probing' || w === 'pd') {
            actions.push({ type: 'measure', measure: 'pd' });
            i += 1;
            continue;
        }
        if (w === 'gingival' || w === 'gm' || w === 'recession') {
            actions.push({ type: 'measure', measure: 'gm' });
            i += 1;
            continue;
        }
        if (/^-?\d+$/.test(w)) {
            var num = parseInt(w, 10);
            // “2 8 is missing” (split FDI) before treating “2” as Universal #2.
            if (words[i + 1] && /^\d$/.test(words[i + 1])) {
                var joinedTn = pdDictResolveTooth(parseInt(String(Math.abs(num)) + words[i + 1], 10));
                var statusJoin = takeToothStatus(i + 2);
                if (joinedTn && statusJoin) {
                    actions.push({ type: statusJoin.type, tn: joinedTn });
                    i = statusJoin.next;
                    continue;
                }
            }
            // Prefer “18 is missing” / “28 missing” over treating the FDI as a PD value.
            var statusBare = takeToothStatus(i + 1);
            var tnBare = pdDictResolveTooth(num);
            if (statusBare && tnBare && Math.abs(num) >= 11) {
                actions.push({ type: statusBare.type, tn: tnBare });
                i = statusBare.next;
                continue;
            }
            if (!pdDict.cursor && tnBare && Math.abs(num) >= 11) {
                var siteBare = pdDictParseSiteFromWords(words, i + 1);
                actions.push({
                    type: 'start',
                    tn: tnBare,
                    surface: siteBare && siteBare.surface ? siteBare.surface : 'b',
                    pos: siteBare ? siteBare.pos : 'd',
                    measure: 'auto'
                });
                i += 1 + (siteBare ? siteBare.consumed : 0);
                continue;
            }
            actions.push({ type: 'value', n: num });
            i += 1;
            continue;
        }

        i += 1;
    }
    return actions;
}

function pdDictDefaultMeasure() {
    return 'pd';
}

function pdDictEffectiveMeasure(measure) {
    if (measure === 'auto' || !measure) return pdDictDefaultMeasure();
    if (typeof perioCompactMode !== 'undefined' && perioCompactMode && measure === 'gm') {
        return 'pd';
    }
    return measure;
}

function pdDictSequence() {
    if (typeof pdProbeWalkSequence === 'function') return pdProbeWalkSequence();
    return [];
}

function pdDictSiteKey(site, measure) {
    return site.tn + '_' + measure + '_' + site.surface + '_' + site.pos;
}

function pdDictCellId(site, measure) {
    return 'perio_' + pdDictSiteKey(site, measure);
}

function pdDictClearFocus() {
    var nodes = document.querySelectorAll('.perio-dictate-focus');
    Array.prototype.forEach.call(nodes, function(el) {
        el.classList.remove('perio-dictate-focus');
    });
}

function pdDictPaintCursor(opts) {
    opts = opts || {};
    pdDictClearFocus();
    var c = pdDict.cursor;
    if (!c) {
        if (typeof pdDictSyncUi === 'function') pdDictSyncUi();
        return;
    }
    // Manual data entry is the default. Never leave a green site frame when
    // the sound widget is closed — that was hanging on PI/BI after clicks.
    if (!pdDict.wantOn && !pdDict.listening) {
        if (typeof pdDictSyncUi === 'function') pdDictSyncUi();
        return;
    }
    var id = pdDictCellId(c, c.measure);
    var el = typeof g === 'function' ? g(id) : document.getElementById(id);
    if (el) {
        el.classList.add('perio-dictate-focus');
        if (!opts.skipFocus) {
            try {
                el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } catch (e) { /* ignore */ }
        }
    }
    pdDictSyncUi();
}

function pdDictCursorLabel() {
    var c = pdDict.cursor;
    if (!c) return '';
    var tn = (typeof pdToothLabel === 'function') ? pdToothLabel(c.tn) : c.tn;
    var site =
        (c.pos === 'd' ? 'D' : c.pos === 'me' ? 'Me' : 'M') +
        (c.surface === 'b' ? 'B' : 'L');
    return tn + ' ' + site + ' · ' + String(c.measure).toUpperCase();
}

function pdDictEnsureTableView() {
    if (typeof perioViewMode !== 'undefined' && perioViewMode !== 'table') {
        perioViewMode = 'table';
        if (typeof renderPerioPane === 'function') renderPerioPane();
    }
}

function pdDictSetCursor(tn, surface, pos, measure) {
    pdDictEnsureTableView();
    if (typeof pdToothIsMissing === 'function' && pdToothIsMissing(tn)) {
        pdDict.cursor = { tn: tn, surface: surface, pos: pos, measure: pdDictEffectiveMeasure(measure) };
        pdDictAdvance(true);
        return;
    }
    pdDict.cursor = {
        tn: tn,
        surface: surface,
        pos: pos,
        measure: pdDictEffectiveMeasure(measure)
    };
    pdDict.status = pdDictCursorLabel();
    pdDictPaintCursor({ skipFocus: !!(pdDict.wantOn || pdDict.listening) });
}

function pdDictAdvance(force) {
    var seq = pdDictSequence();
    var start = 0;
    var c = pdDict.cursor;
    if (c) {
        var i;
        for (i = 0; i < seq.length; i++) {
            if (seq[i].tn === c.tn && seq[i].surface === c.surface && seq[i].pos === c.pos) {
                start = i + 1;
                break;
            }
        }
    }
    var j;
    for (j = start; j < seq.length; j++) {
        var site = seq[j];
        if (typeof pdToothIsMissing === 'function' && pdToothIsMissing(site.tn)) continue;
        pdDict.cursor = {
            tn: site.tn,
            surface: site.surface,
            pos: site.pos,
            measure: c ? c.measure : pdDictDefaultMeasure()
        };
        pdDict.status = pdDictCursorLabel();
        pdDictPaintCursor({ skipFocus: true });
        return;
    }
    if (!force) {
        pdDict.status = pdDictTr('chart.perio.dictate.endOfSeq');
        pdDictSyncUi();
    }
}

function pdDictRetreat() {
    var seq = pdDictSequence();
    if (!seq.length || !pdDict.cursor) return false;
    var c = pdDict.cursor;
    var idx = -1;
    var i;
    for (i = 0; i < seq.length; i++) {
        if (seq[i].tn === c.tn && seq[i].surface === c.surface && seq[i].pos === c.pos) {
            idx = i;
            break;
        }
    }
    for (i = idx - 1; i >= 0; i--) {
        if (typeof pdToothIsMissing === 'function' && pdToothIsMissing(seq[i].tn)) continue;
        pdDict.cursor = {
            tn: seq[i].tn,
            surface: seq[i].surface,
            pos: seq[i].pos,
            measure: c.measure
        };
        return true;
    }
    return false;
}

function pdDictPushUndo(site, measure) {
    if (!site) return;
    measure = pdDictEffectiveMeasure(measure || site.measure);
    var key = pdDictSiteKey(site, measure);
    pdDict.undoStack.push({
        tn: site.tn,
        surface: site.surface,
        pos: site.pos,
        measure: measure,
        prev: perioState[key]
    });
    if (pdDict.undoStack.length > 80) pdDict.undoStack.shift();
}

function pdDictClearSite(site, measure) {
    measure = pdDictEffectiveMeasure(measure || (site && site.measure));
    if (!site || !measure) return;
    var key = pdDictSiteKey(site, measure);
    var el = typeof g === 'function' ? g('perio_' + key) : document.getElementById('perio_' + key);
    if (measure === 'bop' || measure === 'pi') {
        perioState[key] = false;
        if (el) {
            el.classList.remove('on');
            el.setAttribute('aria-checked', 'false');
        }
    } else {
        perioState[key] = null;
        if (el && el.tagName === 'INPUT') {
            el.value = '';
            el.classList.remove('deep', 'shallow');
            try {
                el.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (eEv) { /* ignore */ }
        }
        if (typeof calcCAL === 'function') calcCAL(site.tn, site.pos);
    }
    if (typeof updatePerioSummary === 'function') updatePerioSummary();
    if (typeof refreshPerioLivePreview === 'function') refreshPerioLivePreview();
}

/** Wipe the immediately previous filled box and put the cursor back on it. */
function pdDictUndo() {
    var entry = pdDict.undoStack.length ? pdDict.undoStack.pop() : null;
    if (entry) {
        pdDictClearSite(entry, entry.measure);
        pdDict.cursor = {
            tn: entry.tn,
            surface: entry.surface,
            pos: entry.pos,
            measure: pdDictEffectiveMeasure(entry.measure)
        };
        pdDict.status = pdDictTr('chart.perio.dictate.undid') + ' · ' + pdDictCursorLabel();
        pdDictPaintCursor({ skipFocus: true });
        return true;
    }
    if (!pdDictNeedCursor()) return false;
    if (!pdDictRetreat()) {
        pdDict.status = pdDictTr('chart.perio.dictate.nothingToUndo');
        pdDictSyncUi();
        return false;
    }
    pdDictClearSite(pdDict.cursor, pdDict.cursor.measure);
    pdDict.status = pdDictTr('chart.perio.dictate.undid') + ' · ' + pdDictCursorLabel();
    pdDictPaintCursor({ skipFocus: true });
    return true;
}

function pdDictSiteFromElement(el) {
    if (!el) return null;
    var node = el;
    if (!node.id && node.closest) {
        node = node.closest('[id^="perio_"]') || el;
    }
    if (!node || !node.id) return null;
    var parsed = (typeof pdParsePerioCellId === 'function')
        ? pdParsePerioCellId(node.id)
        : null;
    if (!parsed) return null;
    // CAL is read-only — start dictation on that site's PD instead.
    var measure = parsed.measure === 'cal' ? 'pd' : parsed.measure;
    return {
        tn: parsed.tn,
        surface: parsed.surface,
        pos: parsed.pos,
        measure: measure
    };
}

/** Remember the cell the clinician last clicked or focused by hand. */
function pdDictRememberHandSite(el) {
    var site = pdDictSiteFromElement(el);
    if (!site) return null;
    pdDict.handSite = site;
    return site;
}

/** Remember a hand-picked site. Mic starts only via the 🎙 button. */
function pdDictStartFromHandSite(site, opts) {
    opts = opts || {};
    if (!site) return false;
    pdDict.handSite = site;

    // Default = manual entry. Do not paint / arm the sound widget.
    if (!pdDict.listening && !pdDict.wantOn) {
        pdDictClearFocus();
        return true;
    }

    pdDict.cursor = {
        tn: site.tn,
        surface: site.surface,
        pos: site.pos,
        measure: pdDictEffectiveMeasure(site.measure)
    };
    if (typeof pdToothIsMissing === 'function' && pdToothIsMissing(site.tn)) {
        pdDictAdvance(true);
        return true;
    }
    pdDict.status = pdDictCursorLabel();
    pdDictPaintCursor({ skipFocus: true });
    return true;
}

function pdDictBlurActivePerioCell() {
    try {
        var ae = document.activeElement;
        if (!ae || !ae.blur) return;
        if (ae.classList &&
            (ae.classList.contains('perio-input') ||
             ae.classList.contains('perio-bop-cell') ||
             ae.classList.contains('perio-calc-span'))) {
            ae.blur();
            return;
        }
        if (ae.id && String(ae.id).indexOf('perio_') === 0) ae.blur();
    } catch (e) { /* ignore */ }
}

function pdDictClearRestartTimer() {
    if (pdDict.restartTimer) {
        clearTimeout(pdDict.restartTimer);
        pdDict.restartTimer = null;
    }
}

function pdDictClearWatchdog() {
    if (pdDict.watchdogTimer) {
        clearInterval(pdDict.watchdogTimer);
        pdDict.watchdogTimer = null;
    }
}

function pdDictArmWatchdog() {
    pdDictClearWatchdog();
    pdDict.lastHeardAt = Date.now();
    pdDict.watchdogTimer = setInterval(function() {
        if (!pdDict.wantOn || pdDict.micBlocked) {
            pdDictClearWatchdog();
            return;
        }
        // If Chrome silently stopped restarting after focus/abort races,
        // force a fresh recognition instance so the session stays live.
        var quietMs = Date.now() - (pdDict.lastHeardAt || 0);
        if (quietMs > 12000) {
            pdDict.lastHeardAt = Date.now();
            pdDictScheduleRestart(30);
        }
    }, 4000);
}

/** Restart SpeechRecognition without dropping wantOn (used after abort/end). */
function pdDictScheduleRestart(delayMs) {
    if (!pdDict.wantOn || pdDict.micBlocked) return;
    pdDictClearRestartTimer();
    pdDict.listening = true;
    pdDict.restartTimer = setTimeout(function() {
        pdDict.restartTimer = null;
        if (!pdDict.wantOn || pdDict.micBlocked) return;
        pdDictForceRestartRecognition();
    }, typeof delayMs === 'number' ? delayMs : 120);
}

function pdDictForceRestartRecognition() {
    if (!pdDict.wantOn || pdDict.micBlocked) return;
    pdDictBlurActivePerioCell();
    try {
        if (pdDict.rec) {
            try { pdDict.rec.onend = null; } catch (e0) { /* ignore */ }
            try { pdDict.rec.onerror = null; } catch (e1) { /* ignore */ }
            try { pdDict.rec.abort(); } catch (e2) { /* ignore */ }
            pdDict.rec = null;
        }
    } catch (eKill) { /* ignore */ }
    try {
        pdDict.rec = pdDictBindRecognition();
        if (!pdDict.rec) return;
        pdDict.listening = true;
        pdDict.rec.start();
        pdDictSyncUi();
    } catch (eStart) {
        // InvalidStateError / transient failures — retry once, do not block mic.
        pdDictClearRestartTimer();
        pdDict.restartTimer = setTimeout(function() {
            pdDict.restartTimer = null;
            if (!pdDict.wantOn || pdDict.micBlocked) return;
            try {
                pdDict.rec = pdDictBindRecognition();
                if (pdDict.rec) {
                    pdDict.listening = true;
                    pdDict.rec.start();
                    pdDictSyncUi();
                }
            } catch (e2) {
                pdDict.status = pdDictTr('chart.perio.dictate.listening') + ' (retry)';
                pdDictSyncUi();
                pdDictScheduleRestart(400);
            }
        }, 250);
    }
}

function pdDictBindHandSiteTracking() {
    if (typeof window === 'undefined' || window.__pdDictHandBound) return;
    window.__pdDictHandBound = true;
    document.addEventListener('focusin', function(e) {
        pdDictRememberHandSite(e.target);
        // Chrome aborts SpeechRecognition when a form control is focused.
        if (pdDict.wantOn) pdDictBlurActivePerioCell();
    }, true);
    // While dictating, block focus on chart cells (mousedown) so Chrome
    // does not kill the recognition session; cursor still moves on click.
    document.addEventListener('mousedown', function(e) {
        if (!pdDict.wantOn && !pdDict.listening) return;
        var t = e.target;
        if (!t) return;
        if (t.closest && t.closest('#perioDictationWidget')) return;
        var cell = null;
        if (t.classList &&
            (t.classList.contains('perio-input') ||
             t.classList.contains('perio-bop-cell') ||
             t.classList.contains('perio-calc-span'))) {
            cell = t;
        } else if (t.closest) {
            cell = t.closest('.perio-input, .perio-bop-cell, .perio-calc-span');
        }
        if (!cell) return;
        e.preventDefault();
        pdDictBlurActivePerioCell();
    }, true);
    document.addEventListener('click', function(e) {
        var t = e.target;
        if (!t) return;
        // Ignore clicks inside the dictation chrome itself.
        if (t.closest && t.closest('#perioDictationWidget')) return;

        var cell = null;
        if (t.classList &&
            (t.classList.contains('perio-input') ||
             t.classList.contains('perio-bop-cell') ||
             t.classList.contains('perio-calc-span'))) {
            cell = t;
        } else if (t.closest) {
            cell = t.closest('.perio-input, .perio-bop-cell, .perio-calc-span');
        }
        if (!cell) return;

        var site = pdDictRememberHandSite(cell);
        if (!site) return;
        if (pdDict.wantOn || pdDict.listening) {
            pdDictStartFromHandSite(site);
            pdDictBlurActivePerioCell();
            pdDictScheduleRestart(60);
        } else {
            // Manual mode: remember site for a later 🎙 press; strip leftover rings
            pdDict.handSite = site;
            pdDictClearFocus();
            if (cell.classList && cell.classList.contains('perio-bop-cell')) {
                cell.classList.add('perio-dictate-focus');
            }
        }
    }, true);
}

function pdDictStartAtHandOrDefault() {
    // Prefer the site the user clicked before pressing the mic. Falling back
    // to activeElement covers the rare case focus is still on a cell.
    var hand = pdDict.handSite || pdDictSiteFromElement(document.activeElement);
    if (hand) {
        if (typeof pdToothIsMissing === 'function' && pdToothIsMissing(hand.tn)) {
            pdDict.cursor = {
                tn: hand.tn,
                surface: hand.surface,
                pos: hand.pos,
                measure: pdDictEffectiveMeasure(hand.measure)
            };
            pdDictAdvance(true);
            return !!pdDict.cursor;
        }
        pdDict.cursor = {
            tn: hand.tn,
            surface: hand.surface,
            pos: hand.pos,
            measure: pdDictEffectiveMeasure(hand.measure)
        };
        pdDict.status = pdDictCursorLabel();
        pdDictPaintCursor({ skipFocus: true });
        return true;
    }
    return pdDictStartAtEighteenPd();
}

function pdDictStartAtEighteenPd() {
    var start = (typeof pdDefaultStartSite === 'function')
        ? pdDefaultStartSite()
        : { tn: 18, surface: 'b', pos: 'd', measure: 'pd' };
    if (typeof pdToothIsMissing === 'function' && pdToothIsMissing(start.tn) &&
        typeof pdProbeWalkSequence === 'function') {
        var seq = pdProbeWalkSequence();
        var i;
        for (i = 0; i < seq.length; i++) {
            if (typeof pdToothIsMissing === 'function' && pdToothIsMissing(seq[i].tn)) continue;
            start = { tn: seq[i].tn, surface: seq[i].surface, pos: seq[i].pos, measure: 'pd' };
            break;
        }
    }
    pdDict.cursor = {
        tn: start.tn,
        surface: start.surface,
        pos: start.pos,
        measure: 'pd'
    };
    pdDict.status = pdDictCursorLabel();
    pdDictPaintCursor({ skipFocus: true });
    return !!pdDict.cursor;
}

function pdDictNeedCursor() {
    if (pdDict.cursor) return true;
    if (pdDictStartAtHandOrDefault()) return true;
    pdDict.status = pdDictTr('chart.perio.dictate.noCursor');
    pdDictSyncUi();
    return false;
}

function pdDictWriteThreeval(site, measure, n) {
    if (measure === 'pd' && n < 0) n = 0;
    if (n > 15) n = 15;
    if (n < -15) n = -15;
    pdDictPushUndo(site, measure);
    var key = pdDictSiteKey(site, measure);
    perioState[key] = n;
    var el = typeof g === 'function' ? g('perio_' + key) : document.getElementById('perio_' + key);
    if (el && el.tagName === 'INPUT') {
        el.value = String(n);
        el.classList.remove('deep', 'shallow');
        if (n >= 4) el.classList.add('deep');
        else if (n <= 2 && n > 0) el.classList.add('shallow');
        try {
            el.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (eEv) { /* ignore */ }
    }
    if (typeof calcCAL === 'function') calcCAL(site.tn, site.pos);
    if (typeof updatePerioSummary === 'function') updatePerioSummary();
    if (typeof refreshPerioLivePreview === 'function') refreshPerioLivePreview();
}

function pdDictWriteFlag(site, measure, on) {
    pdDictPushUndo(site, measure);
    var key = pdDictSiteKey(site, measure);
    perioState[key] = !!on;
    var el = typeof g === 'function' ? g('perio_' + key) : null;
    if (el) {
        el.classList.toggle('on', !!on);
        el.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    if (typeof updatePerioSummary === 'function') updatePerioSummary();
    if (typeof refreshPerioLivePreview === 'function') refreshPerioLivePreview();
}

function pdDictGroupTeeth(group) {
    if (group === 'wisdom') return PD_DICT_WISDOM.slice();
    if (group === 'upper') return UPPER_RIGHT.concat(UPPER_LEFT);
    if (group === 'lower') return LOWER_RIGHT.concat(LOWER_LEFT);
    return [];
}

function pdDictRerender() {
    var wasOn = !!(pdDict.wantOn || pdDict.listening);
    if (wasOn) {
        // Preserve intent across full pane remount before DOM tear-down.
        pdDict.wantOn = true;
    }
    if (typeof renderPerioPane === 'function') renderPerioPane();
    pdDictPaintCursor({ skipFocus: true });
    // Full pane remount can abort Chrome SpeechRecognition — revive if still on.
    if (pdDict.wantOn && !pdDict.micBlocked) {
        pdDict.listening = true;
        pdDictBlurActivePerioCell();
        pdDictScheduleRestart(180);
        pdDictArmWatchdog();
        pdDictSyncUi();
    }
}

function pdDictApplyActions(actions) {
    var structural = false;
    var i;
    for (i = 0; i < actions.length; i++) {
        var a = actions[i];
        if (a.type === 'stop') {
            pdDictationStop();
            return;
        }
        if (a.type === 'mode') {
            pdDict.mode = a.mode === 'batch' ? 'batch' : 'live';
            pdDict.status = pdDict.mode === 'live'
                ? pdDictTr('chart.perio.dictate.live')
                : pdDictTr('chart.perio.dictate.batch');
            continue;
        }
        if (a.type === 'start') {
            pdDictSetCursor(a.tn, a.surface, a.pos, a.measure);
            continue;
        }
        if (a.type === 'next') {
            if (pdDictNeedCursor()) pdDictAdvance();
            continue;
        }
        if (a.type === 'undo') {
            pdDictUndo();
            continue;
        }
        if (a.type === 'missing' || a.type === 'present') {
            if (typeof pdSetToothMissing === 'function') {
                pdSetToothMissing(a.tn, a.type === 'missing', { promptReason: false });
            }
            structural = true;
            pdDict.status = (a.type === 'missing' ? 'missing ' : 'present ') +
                ((typeof pdToothLabel === 'function') ? pdToothLabel(a.tn) : a.tn);
            // If the live cursor was on that tooth, step to the next present site.
            if (a.type === 'missing' && pdDict.cursor && pdDict.cursor.tn === a.tn) {
                pdDictAdvance(true);
            }
            if (typeof showChartToast === 'function') {
                showChartToast(pdDict.status);
            }
            continue;
        }
        if (a.type === 'missingGroup' || a.type === 'presentGroup') {
            pdDictGroupTeeth(a.group).forEach(function(tn) {
                if (typeof pdSetToothMissing === 'function') {
                    pdSetToothMissing(tn, a.type === 'missingGroup', { promptReason: false });
                }
            });
            structural = true;
            pdDict.status = a.group + ' ' + (a.type === 'missingGroup' ? 'missing' : 'present');
            continue;
        }
        if (a.type === 'mobility') {
            if (typeof pdPerioImplantActive === 'function' && pdPerioImplantActive(a.tn)) {
                pdDict.status = pdDictTr('chart.perio.dictate.noMobImplant');
                continue;
            }
            perioState[a.tn + '_mob'] = a.grade;
            structural = true;
            pdDict.status = 'mobility ' + a.tn + ' ' + a.grade;
            continue;
        }
        if (a.type === 'implant') {
            if (a.on) {
                perioState[a.tn + '_implant'] = 1;
                if (typeof pdClearMobFrcForImplant === 'function') pdClearMobFrcForImplant(a.tn);
            } else {
                delete perioState[a.tn + '_implant'];
            }
            structural = true;
            pdDict.status = (a.on ? 'implant ' : 'natural ') + a.tn;
            if (typeof showChartToast === 'function') {
                showChartToast(pdDict.status);
            }
            continue;
        }
        if (a.type === 'furcation') {
            perioState[a.tn + '_frc'] = a.grade === '0' ? null : a.grade;
            structural = true;
            pdDict.status = 'furcation ' + a.tn + ' ' + a.grade;
            continue;
        }
        if (a.type === 'measure') {
            if (!pdDictNeedCursor()) continue;
            pdDict.cursor.measure = pdDictEffectiveMeasure(a.measure);
            pdDict.status = pdDictCursorLabel();
            pdDictPaintCursor({ skipFocus: !!(pdDict.wantOn || pdDict.listening) });
            continue;
        }
        if (a.type === 'plus' || a.type === 'minus' || a.type === 'value') {
            if (!pdDictNeedCursor()) continue;
            var c = pdDict.cursor;
            if (c.measure === 'bop' || c.measure === 'pi') {
                // Bleeding / plaque index: 1 (or plus/yes) = marked;
                // zero/0 (or minus/no) = blank.
                var on = false;
                if (a.type === 'plus') on = true;
                else if (a.type === 'minus') on = false;
                else if (a.type === 'value') on = a.n >= 1;
                var wroteFlagAt = pdDictCursorLabel();
                pdDictWriteFlag(c, c.measure, on);
                pdDictAdvance();
                pdDict.status = wroteFlagAt + ' ← ' + (on ? '1' : '0') +
                    (pdDict.cursor ? (' → ' + pdDictCursorLabel()) : '');
            } else if (a.type === 'value') {
                var wroteAt = pdDictCursorLabel();
                pdDictWriteThreeval(c, c.measure, a.n);
                pdDictAdvance();
                pdDict.status = wroteAt + ' ← ' + a.n +
                    (pdDict.cursor ? (' → ' + pdDictCursorLabel()) : '');
            } else {
                pdDict.status = pdDictTr('chart.perio.dictate.needNumber');
            }
        }
    }
    if (structural) pdDictRerender();
    else pdDictSyncUi();
}

function pdDictApplyText(raw) {
    var actions = pdDictParse(raw);
    if (!actions.length) {
        pdDict.status = pdDictTr('chart.perio.dictate.unknown');
        pdDictSyncUi();
        return;
    }
    pdDictApplyActions(actions);
}

function pdDictFlushBatch() {
    if (pdDict.batchTimer) {
        clearTimeout(pdDict.batchTimer);
        pdDict.batchTimer = null;
    }
    if (!pdDict.batchBuf) return;
    var buf = pdDict.batchBuf;
    pdDict.batchBuf = '';
    pdDictApplyText(buf);
}

function pdDictOnHeard(text, isFinal) {
    pdDict.heard = text;
    pdDict.lastHeardAt = Date.now();
    pdDictSyncUi();
    if (!isFinal) return;
    if (pdDict.mode === 'batch') {
        pdDict.batchBuf = (pdDict.batchBuf + ' ' + text).trim();
        if (pdDict.batchTimer) clearTimeout(pdDict.batchTimer);
        pdDict.batchTimer = setTimeout(pdDictFlushBatch, 500);
        return;
    }
    pdDictApplyText(text);
    // Keep focus off chart inputs so Chrome does not abort the next listen cycle.
    if (pdDict.wantOn) pdDictBlurActivePerioCell();
}

function pdDictBindRecognition() {
    var Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return null;
    var rec = new Ctor();
    rec.lang = 'en-US';
    // Keep one session so ~0.5s gaps between pocket depths stay in the same
    // listen. onend still restarts after Chrome's own silence timeout.
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 3;
    rec.onresult = function(ev) {
        var interim = '';
        var finals = [];
        var i;
        for (i = ev.resultIndex; i < ev.results.length; i++) {
            var piece = pdDictPickResultTranscript(ev.results[i]);
            if (ev.results[i].isFinal) finals.push(piece);
            else interim += piece;
        }
        if (finals.length) pdDictOnHeard(finals.join(' '), true);
        else if (interim) pdDictOnHeard(interim, false);
    };
    rec.onerror = function(ev) {
        pdDict.lastError = (ev && ev.error) ? ev.error : 'error';
        if (pdDict.lastError === 'not-allowed' || pdDict.lastError === 'service-not-allowed') {
            pdDictHandleMicBlocked(new Error('denied'));
            return;
        }
        // Focus changes / silence / transient network: keep session; onend restarts.
        if (pdDict.lastError === 'aborted' ||
            pdDict.lastError === 'no-speech' ||
            pdDict.lastError === 'network' ||
            pdDict.lastError === 'audio-capture') {
            return;
        }
        pdDict.status = pdDictTr('chart.perio.dictate.listening') +
            ' (' + pdDict.lastError + ')';
        pdDictSyncUi();
    };
    rec.onend = function() {
        if (pdDict.wantOn && !pdDict.micBlocked) {
            // Keep UI "on" during the brief gap between Chrome sessions.
            pdDict.listening = true;
            pdDictScheduleRestart(120);
        } else {
            pdDict.listening = false;
            pdDictSyncUi();
        }
    };
    return rec;
}

function pdDictationStop(opts) {
    opts = opts || {};
    pdDict.wantOn = false;
    pdDict.listening = false;
    pdDictClearRestartTimer();
    pdDictClearWatchdog();
    pdDictFlushBatch();
    pdDictStopMicStream();
    if (pdDict.rec) {
        try { pdDict.rec.onend = null; } catch (e0) { /* ignore */ }
        try { pdDict.rec.stop(); } catch (e) {
            try { pdDict.rec.abort(); } catch (e2) { /* ignore */ }
        }
    }
    pdDictClearFocus();
    pdDictBlurActivePerioCell();
    if (!opts.silent) {
        pdDict.status = pdDictTr('chart.perio.dictate.stopped');
    }
    pdDictSyncUi();
}

function pdDictBeginRecognition() {
    pdDict.wantOn = true;
    pdDict.listening = true;
    pdDict.micBlocked = false;
    pdDict.lastError = '';
    pdDictClearRestartTimer();
    // Capture hand-selected site BEFORE blurring the cell (mic click steals focus)
    var handBeforeBlur = pdDict.handSite || pdDictSiteFromElement(document.activeElement);
    if (handBeforeBlur) pdDict.handSite = handBeforeBlur;
    pdDictBlurActivePerioCell();
    // Start at the clicked site when one was selected; else 18 PD distobuccal
    try { pdDictStartAtHandOrDefault(); }
    catch (eCur) { /* keep listening */ }
    pdDict.status = (pdDict.mode === 'live'
        ? pdDictTr('chart.perio.dictate.live')
        : pdDictTr('chart.perio.dictate.batch')) +
        (pdDict.cursor ? (' · ' + pdDictCursorLabel()) : '');
    pdDictSyncUi();
    pdDictForceRestartRecognition();
    pdDictArmWatchdog();
    pdDictPaintCursor({ skipFocus: true });
}

function pdDictationStart() {
    if (!pdDictSpeechSupported()) {
        pdDict.status = pdDictTr('chart.perio.dictate.needChrome');
        if (typeof showChartToast === 'function') {
            showChartToast(pdDict.status);
        }
        pdDict.expanded = true;
        pdDictSyncUi();
        return;
    }
    if (!pdDictMicSecureContext()) {
        pdDictHandleMicBlocked(new Error('insecure'));
        return;
    }
    pdDict.status = pdDictTr('chart.perio.dictate.requestingMic');
    pdDictSyncUi();
    pdDictEnsureMicPermission()
        .then(function() { pdDictBeginRecognition(); })
        .catch(function(err) { pdDictHandleMicBlocked(err); });
}

function pdDictToggleListen() {
    if (pdDict.listening || pdDict.wantOn) pdDictationStop();
    else pdDictationStart();
}

function pdDictToggleMode() {
    pdDict.mode = pdDict.mode === 'live' ? 'batch' : 'live';
    pdDict.status = pdDict.mode === 'live'
        ? pdDictTr('chart.perio.dictate.live')
        : pdDictTr('chart.perio.dictate.batch');
    pdDictSyncUi();
}

function pdDictTipsLines() {
    return [
        'chart.perio.dictate.tipStart',
        'chart.perio.dictate.tipBopPi',
        'chart.perio.dictate.tipUndo',
        'chart.perio.dictate.tipMissing',
        'chart.perio.dictate.tipImplant',
        'chart.perio.dictate.tipNumbers',
        'chart.perio.dictate.tipStop'
    ];
}

function pdDictSyncUi() {
    var root = document.getElementById('perioDictationWidget');
    if (!root) return;
    root.classList.toggle('is-on', !!(pdDict.listening || pdDict.wantOn));
    root.classList.toggle('is-open', !!pdDict.expanded);
    root.classList.toggle('is-blocked', !!pdDict.micBlocked);
    var tips = document.getElementById('perioDictationTips');
    if (tips) {
        tips.classList.toggle('is-open', !!pdDict.tipsOpen);
        var tipBtn = tips.querySelector('.perio-dictation-tips-toggle');
        if (tipBtn) {
            tipBtn.setAttribute('aria-expanded', pdDict.tipsOpen ? 'true' : 'false');
            tipBtn.textContent = pdDictTr('chart.perio.dictate.tipsLabel') +
                (pdDict.tipsOpen ? ' ▴' : ' ▾');
        }
    }
    var mic = root.querySelector('.perio-dictation-mic');
    if (mic) {
        mic.classList.toggle('is-on', !!(pdDict.listening || pdDict.wantOn));
        mic.classList.toggle('is-blocked', !!pdDict.micBlocked);
        mic.setAttribute('aria-pressed', (pdDict.listening || pdDict.wantOn) ? 'true' : 'false');
    }
    var stopBtn = root.querySelector('.perio-dictation-stop');
    if (stopBtn) {
        var armed = !!(pdDict.listening || pdDict.wantOn);
        stopBtn.classList.toggle('is-armed', armed);
        stopBtn.disabled = false;
        stopBtn.setAttribute('aria-disabled', 'false');
        stopBtn.title = pdDictTr('chart.perio.dictate.stopTitle');
    }
    var extras = root.querySelector('.perio-dictation-extras');
    if (extras) extras.style.display = (pdDict.listening || pdDict.wantOn || pdDict.expanded) ? 'flex' : 'none';
    var modeBtn = root.querySelector('.perio-dictation-mode');
    if (modeBtn) {
        modeBtn.textContent = pdDict.mode === 'live'
            ? pdDictTr('chart.perio.dictate.live')
            : pdDictTr('chart.perio.dictate.batch');
    }
    var heard = root.querySelector('.perio-dictation-heard');
    if (heard) {
        heard.textContent = pdDict.heard ||
            ((pdDict.listening || pdDict.wantOn) ? pdDictTr('chart.perio.dictate.listening') : '');
    }
    var cur = root.querySelector('.perio-dictation-cursor');
    if (cur) cur.textContent = pdDict.cursor ? pdDictCursorLabel() : (pdDict.status || '');
    var blocked = root.querySelector('.perio-dictation-blocked');
    if (blocked) blocked.textContent = pdDictTr('chart.perio.dictate.micHelp');
    var pairs = root.querySelector('.perio-dictation-pairs');
    if (pairs) {
        if (!pdDict.train.length) {
            pairs.innerHTML = '<li>' + (typeof esc === 'function' ? esc(pdDictTr('chart.perio.dictate.noneLearned')) : pdDictTr('chart.perio.dictate.noneLearned')) + '</li>';
        } else {
            pairs.innerHTML = pdDict.train.map(function(p, idx) {
                return '<li><span>' + (typeof esc === 'function' ? esc(p.heard) : p.heard) +
                    ' → ' + (typeof esc === 'function' ? esc(p.expect) : p.expect) +
                    '</span><button type="button" data-unlearn="' + idx + '">✕</button></li>';
            }).join('');
        }
    }
    pdDictPlacePanel();
}

function pdDictPlacePanel() {
    var root = document.getElementById('perioDictationWidget');
    if (!root) return;
    var panel = root.querySelector('.perio-dictation-panel');
    if (!panel) return;
    if (!pdDict.expanded) {
        panel.style.position = '';
        panel.style.top = '';
        panel.style.left = '';
        panel.style.right = '';
        panel.style.width = '';
        panel.style.maxWidth = '';
        return;
    }
    var r = root.getBoundingClientRect();
    var width = Math.min(420, Math.max(260, window.innerWidth - 24));
    var left = r.right - width;
    if (left < 12) left = 12;
    if (left + width > window.innerWidth - 12) left = Math.max(12, window.innerWidth - width - 12);
    var top = r.bottom + 6;
    var maxH = Math.max(180, window.innerHeight - top - 16);
    panel.style.position = 'fixed';
    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
    panel.style.right = 'auto';
    panel.style.width = width + 'px';
    panel.style.maxWidth = 'calc(100vw - 24px)';
    panel.style.maxHeight = maxH + 'px';
    panel.style.overflowY = 'auto';
    panel.style.zIndex = '5600';
}

if (typeof window !== 'undefined' && !window.__pdDictPanelBound) {
    window.__pdDictPanelBound = true;
    window.addEventListener('resize', function() {
        if (pdDict.expanded) pdDictPlacePanel();
    });
    window.addEventListener('scroll', function() {
        if (pdDict.expanded) pdDictPlacePanel();
    }, true);
}

function mountPerioDictationWidget(bar) {
    if (!bar) return;
    pdDictLoadTrain();
    pdDictBindHandSiteTracking();
    // Remounts (missing / implant / structural edits) rebuild this widget.
    // Keep an already-open session alive — only first/manual open starts via 🎙.
    var keepAlive = !!(pdDict.wantOn || pdDict.listening);
    if (!keepAlive) {
        pdDictClearFocus();
    }

    var shell = document.createElement('div');
    shell.className = 'perio-dictation-shell';

    var wrap = document.createElement('div');
    wrap.id = 'perioDictationWidget';
    wrap.className = 'perio-dictation';

    var mic = document.createElement('button');
    mic.type = 'button';
    mic.className = 'perio-dictation-mic' + (pdDictSpeechSupported() ? '' : ' is-unsupported');
    mic.textContent = '🎙';
    mic.title = pdDictSpeechSupported()
        ? pdDictTr('chart.perio.dictate.micTitle')
        : pdDictTr('chart.perio.dictate.needChrome');
    mic.setAttribute('aria-label', pdDictTr('chart.perio.dictate.mic'));
    mic.addEventListener('click', function() { pdDictToggleListen(); });
    wrap.appendChild(mic);

    var stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'perio-dictation-stop';
    stopBtn.title = pdDictTr('chart.perio.dictate.stopTitle');
    stopBtn.setAttribute('aria-label', pdDictTr('chart.perio.dictate.stop'));
    stopBtn.innerHTML = '<span class="perio-dictation-stop-icon" aria-hidden="true"></span>';
    stopBtn.addEventListener('click', function() {
        pdDictationStop();
    });
    wrap.appendChild(stopBtn);

    var extras = document.createElement('div');
    extras.className = 'perio-dictation-extras';
    extras.style.cssText = 'display:none;align-items:center;gap:6px;';

    var modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.className = 'perio-dictation-mode';
    modeBtn.title = pdDictTr('chart.perio.dictate.modeTitle');
    modeBtn.addEventListener('click', pdDictToggleMode);
    extras.appendChild(modeBtn);

    var heard = document.createElement('span');
    heard.className = 'perio-dictation-heard';
    extras.appendChild(heard);

    var cur = document.createElement('span');
    cur.className = 'perio-dictation-cursor';
    extras.appendChild(cur);

    var more = document.createElement('button');
    more.type = 'button';
    more.className = 'perio-dictation-more';
    more.textContent = '▾';
    more.title = pdDictTr('chart.perio.dictate.commands');
    more.addEventListener('click', function() {
        pdDict.expanded = !pdDict.expanded;
        pdDictSyncUi();
    });
    wrap.appendChild(extras);
    wrap.appendChild(more);

    var panel = document.createElement('div');
    panel.className = 'perio-dictation-panel';
    panel.innerHTML =
        '<div class="perio-dictation-blocked"></div>' +
        '<h4>' + (typeof esc === 'function' ? esc(pdDictTr('chart.perio.dictate.commands')) : pdDictTr('chart.perio.dictate.commands')) + '</h4>' +
        '<div style="font-size:11px;color:#64748b;margin-bottom:6px;">' +
            (typeof esc === 'function' ? esc(pdDictTr('chart.perio.dictate.langNote')) : pdDictTr('chart.perio.dictate.langNote')) +
        '</div>' +
        '<table>' +
            '<tr><td>Tooth status</td><td>missing 18 · missing tooth 28 · tooth 18 is missing · present 21 · all wisdom teeth missing</td></tr>' +
            '<tr><td>Mobility</td><td>tooth 18 mobility grade 2 · mobility 46 zero</td></tr>' +
            '<tr><td>Implant / furcation</td><td>dental implant 14 · implant 36 · implant 14 remove · 46 furcation grade 2</td></tr>' +
            '<tr><td>BOP / plaque</td><td>click BOP/PI cell (or say BOP / plaque) · then 1 = positive · zero = blank · also plus/minus · yes/no</td></tr>' +
            '<tr><td>Undo last</td><td>undo · back · wipe · oops · go back · delete last</td></tr>' +
            '<tr><td>Start site</td><td>click 🎙 to start (green) · click a chart cell to choose site · default 18 PD distobuccal</td></tr>' +
            '<tr><td>Mode / stop</td><td>live mode · batch mode · next · stop · or tap black ■</td></tr>' +
        '</table>' +
        '<div style="font-size:11px;color:#92400e;background:#fff7ed;border-radius:6px;padding:6px 8px;">' +
            (typeof esc === 'function' ? esc(pdDictTr('chart.perio.dictate.stutterTip')) : pdDictTr('chart.perio.dictate.stutterTip')) +
        '</div>' +
        '<div class="perio-dictation-try">' +
            '<input id="perioDictTry" type="text" placeholder="' +
                (typeof esc === 'function' ? esc(pdDictTr('chart.perio.dictate.typePh')) : pdDictTr('chart.perio.dictate.typePh')) + '">' +
            '<button type="button" id="perioDictTryBtn">' +
                (typeof esc === 'function' ? esc(pdDictTr('chart.perio.dictate.apply')) : pdDictTr('chart.perio.dictate.apply')) +
            '</button>' +
        '</div>' +
        '<h4>' + (typeof esc === 'function' ? esc(pdDictTr('chart.perio.dictate.training')) : pdDictTr('chart.perio.dictate.training')) + '</h4>' +
        '<div class="perio-dictation-learn-row">' +
            '<input id="perioDictHeardAs" type="text" placeholder="' +
                (typeof esc === 'function' ? esc(pdDictTr('chart.perio.dictate.heardAs')) : pdDictTr('chart.perio.dictate.heardAs')) + '">' +
            '<input id="perioDictExpect" type="text" placeholder="' +
                (typeof esc === 'function' ? esc(pdDictTr('chart.perio.dictate.expected')) : pdDictTr('chart.perio.dictate.expected')) + '">' +
            '<button type="button" id="perioDictLearnBtn">' +
                (typeof esc === 'function' ? esc(pdDictTr('chart.perio.dictate.learn')) : pdDictTr('chart.perio.dictate.learn')) +
            '</button>' +
        '</div>' +
        '<ul class="perio-dictation-pairs"></ul>' +
        '<div class="perio-dictation-io" style="display:flex;gap:6px;">' +
            '<button type="button" id="perioDictExport">' +
                (typeof esc === 'function' ? esc(pdDictTr('chart.perio.dictate.export')) : pdDictTr('chart.perio.dictate.export')) +
            '</button>' +
            '<button type="button" id="perioDictImport">' +
                (typeof esc === 'function' ? esc(pdDictTr('chart.perio.dictate.import')) : pdDictTr('chart.perio.dictate.import')) +
            '</button>' +
            '<input id="perioDictImportFile" type="file" accept="application/json" style="display:none">' +
        '</div>';
    wrap.appendChild(panel);

    panel.querySelector('#perioDictTryBtn').addEventListener('click', function() {
        var inp = panel.querySelector('#perioDictTry');
        if (!inp || !inp.value.trim()) return;
        pdDict.heard = inp.value.trim();
        if (!pdDict.cursor) pdDictStartAtHandOrDefault();
        pdDictApplyText(inp.value);
        inp.value = '';
        pdDictSyncUi();
    });
    panel.querySelector('#perioDictTry').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            panel.querySelector('#perioDictTryBtn').click();
        }
    });
    panel.querySelector('#perioDictLearnBtn').addEventListener('click', function() {
        var heardIn = panel.querySelector('#perioDictHeardAs');
        var expectIn = panel.querySelector('#perioDictExpect');
        var heard = heardIn && heardIn.value.trim();
        var expect = expectIn && expectIn.value.trim();
        if (!heard || !expect) return;
        pdDict.train.push({ heard: heard, expect: expect });
        pdDictSaveTrain();
        heardIn.value = '';
        expectIn.value = '';
        pdDictSyncUi();
    });
    panel.querySelector('.perio-dictation-pairs').addEventListener('click', function(e) {
        var btn = e.target && e.target.closest ? e.target.closest('[data-unlearn]') : null;
        if (!btn) return;
        var idx = parseInt(btn.getAttribute('data-unlearn'), 10);
        if (isNaN(idx)) return;
        pdDict.train.splice(idx, 1);
        pdDictSaveTrain();
        pdDictSyncUi();
    });
    panel.querySelector('#perioDictExport').addEventListener('click', function() {
        var blob = new Blob([JSON.stringify(pdDict.train, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'banana-perio-speech-training.json';
        a.click();
        setTimeout(function() { URL.revokeObjectURL(a.href); }, 500);
    });
    panel.querySelector('#perioDictImport').addEventListener('click', function() {
        panel.querySelector('#perioDictImportFile').click();
    });
    panel.querySelector('#perioDictImportFile').addEventListener('change', function() {
        var file = this.files && this.files[0];
        this.value = '';
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function() {
            try {
                var parsed = JSON.parse(reader.result);
                if (Array.isArray(parsed)) {
                    pdDict.train = parsed.filter(function(p) { return p && p.heard && p.expect; });
                    pdDictSaveTrain();
                    pdDictSyncUi();
                }
            } catch (err) { /* ignore bad file */ }
        };
        reader.readAsText(file);
    });

    shell.appendChild(wrap);

    var tips = document.createElement('div');
    tips.id = 'perioDictationTips';
    tips.className = 'perio-dictation-tips' + (pdDict.tipsOpen ? ' is-open' : '');

    var tipsBtn = document.createElement('button');
    tipsBtn.type = 'button';
    tipsBtn.className = 'perio-dictation-tips-toggle';
    tipsBtn.setAttribute('aria-expanded', pdDict.tipsOpen ? 'true' : 'false');
    tipsBtn.setAttribute('aria-controls', 'perioDictationTipsBody');
    tipsBtn.title = pdDictTr('chart.perio.dictate.tipsTitle');
    tipsBtn.textContent = pdDictTr('chart.perio.dictate.tipsLabel') +
        (pdDict.tipsOpen ? ' ▴' : ' ▾');
    tipsBtn.addEventListener('click', function() {
        pdDict.tipsOpen = !pdDict.tipsOpen;
        pdDictSyncUi();
    });
    tips.appendChild(tipsBtn);

    var tipsBody = document.createElement('div');
    tipsBody.id = 'perioDictationTipsBody';
    tipsBody.className = 'perio-dictation-tips-body';
    tipsBody.setAttribute('role', 'region');
    tipsBody.setAttribute('aria-label', pdDictTr('chart.perio.dictate.tipsLabel'));
    var tipEsc = typeof esc === 'function' ? esc : function(s) { return String(s || ''); };
    tipsBody.innerHTML =
        '<ul class="perio-dictation-tips-list">' +
        pdDictTipsLines().map(function(key) {
            return '<li>' + tipEsc(pdDictTr(key)) + '</li>';
        }).join('') +
        '</ul>' +
        '<div class="perio-dictation-tips-foot">' + tipEsc(pdDictTr('chart.perio.dictate.tipsMore')) + '</div>';
    tips.appendChild(tipsBody);
    shell.appendChild(tips);

    bar.appendChild(shell);
    pdDictSyncUi();
    // Pane remount (e.g. after “missing 18” / “implant 14”) rebuilds the DOM
    // and can abort Chrome SpeechRecognition — keep the green session alive.
    if (keepAlive && pdDict.wantOn && !pdDict.micBlocked) {
        pdDict.listening = true;
        pdDictBlurActivePerioCell();
        pdDictScheduleRestart(120);
        pdDictArmWatchdog();
        pdDictPaintCursor({ skipFocus: true });
        pdDictSyncUi();
    }
}

if (typeof window !== 'undefined') {
    window.perioDictationParse = pdDictParse;
    window.mountPerioDictationWidget = mountPerioDictationWidget;
    window.pdDictationStop = pdDictationStop;
    window.pdDictationStart = pdDictationStart;
    window.pdDictClearFocus = pdDictClearFocus;
    window.pdDictPaintCursor = pdDictPaintCursor;
}
