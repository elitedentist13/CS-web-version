/**
 * Consultation treatment notes: smoke / unit / HTTP spot / API.
 *  - sections parse/compose (C/O, MH, HPC, E/O, I/O, Xrays, SI, Tx, Px, Next)
 *  - doctor required, author saved, edit history, soft delete, addenda (graceful fallback)
 *  - drafts, context chips, history filters wiring
 * Run: node scripts/con-notes-smoke.js
 */
var fs = require('fs');
var http = require('http');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(root, 'app-con-notes.js'))) root = process.cwd();

var EXPECTED_BUILD = '20260925notes8';
var PID = '18d4d8a2-7d16-403c-962c-cba93540b132';
var fails = [];

function pass(name, ok, detail) {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  —  ' + detail : ''));
    if (!ok) fails.push(name + (detail ? ': ' + detail : ''));
}

function read(f) { return fs.readFileSync(path.join(root, f), 'utf8'); }

function readSbConfig(appJs) {
    var block = appJs.match(/supabase\.createClient\(([\s\S]*?)\);/);
    if (!block) throw new Error('supabase.createClient not found');
    var parts = [];
    var re = /'([^']*)'/g;
    var m;
    while ((m = re.exec(block[1]))) parts.push(m[1]);
    return { url: parts[0], key: parts.slice(1).join('') };
}

function httpGet(port, reqPath) {
    return new Promise(function (resolve, reject) {
        var req = http.get({ host: '127.0.0.1', port: port, path: reqPath, timeout: 5000 }, function (r) {
            var d = '';
            r.on('data', function (c) { d += c; });
            r.on('end', function () { resolve({ status: r.statusCode, body: d }); });
        });
        req.on('error', reject);
        req.on('timeout', function () { req.destroy(); reject(new Error('timeout')); });
    });
}

function rest(base, key, method, table, qs, body) {
    var headers = { apikey: key, Authorization: 'Bearer ' + key, Accept: 'application/json', Prefer: 'return=representation' };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(base.replace(/\/$/, '') + '/rest/v1/' + table + (qs ? '?' + qs : ''), {
        method: method, headers: headers, body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
        return r.text().then(function (t) {
            var json = null;
            try { json = JSON.parse(t); } catch (e) {}
            return { status: r.status, json: json, raw: t.slice(0, 240) };
        });
    });
}

function extractFn(src, name) {
    var start = src.indexOf('function ' + name + '(');
    if (start < 0) throw new Error('missing ' + name);
    var depth = 0;
    for (var j = src.indexOf('{', start); j < src.length; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) return src.slice(start, j + 1);
    }
    throw new Error('unclosed ' + name);
}

(async function () {
    var notesSrc = read('app-con-notes.js');
    var conSrc = read('app-consultation.js');
    var html = read('index.html');
    var i18n = read('app-i18n-extra.js');
    var rtSrc = read('app-realtime-sync.js');
    var css = read('style.css');
    var appSrc = read('app.js');

    console.log('=== source ===');
    pass('index BUILD ' + EXPECTED_BUILD, html.indexOf("var BUILD = '" + EXPECTED_BUILD + "'") >= 0);
    pass('index loads app-con-notes.js after app-consultation.js',
        html.indexOf("'app-consultation.js',") >= 0 &&
        html.indexOf("'app-con-notes.js'") > html.indexOf("'app-consultation.js',"));
    ['conNoteComposer', 'conNoteContext', 'conNoteDoctorChip', 'conNoteSections', 'conNoteDraftState',
        'conNoteMicBtn', 'conNoteHistoryBar', 'conNoteSearch', 'conNoteDoctorFilter', 'conNoteShowDeleted', 'conNoteInput']
        .forEach(function (id) { pass('markup #' + id, html.indexOf('id="' + id + '"') >= 0); });
    pass('doctor required for consultation note', conSrc.indexOf("inputId === 'conNoteInput' && !conActiveDoctorId") >= 0);
    pass('doctor fields no longer fall back to login name',
        extractFn(conSrc, 'conBuildNoteRow').indexOf('currentName') < 0);
    pass('author columns saved', extractFn(conSrc, 'conBuildNoteRow').indexOf('author_name') >= 0);
    pass('soft delete with hard-delete fallback', extractFn(conSrc, 'conDeleteNoteRow').indexOf('deleted_at') >= 0 &&
        extractFn(conSrc, 'conDeleteNoteRow').indexOf('.delete()') >= 0);
    pass('edit pushes previous version into edit_history', extractFn(conSrc, 'conUpdateNoteText').indexOf('edit_history') >= 0);
    pass('timeline skips deleted notes', extractFn(conSrc, 'conPtlEventsFromNotes').indexOf('deleted_at') >= 0);
    pass('realtime focusout covers .con-note-editing', rtSrc.indexOf("target.closest('.con-note-editing')") >= 0);
    pass('sections container pauses realtime', /id="conNoteSections" class="[^"]*con-note-editing/.test(html));
    pass('chips opt out of the 650ms click guard', notesSrc.indexOf('data-no-click-guard="1" class="cn-chip') >= 0 &&
        appSrc.indexOf("data-no-click-guard") >= 0);
    pass('free text mode really hides the sections panel', css.indexOf('.cn-sections[hidden]') >= 0 &&
        css.indexOf('.cn-context[hidden]') >= 0);
    pass('mode remembered per login', notesSrc.indexOf("CN_MODE_KEY + ':' + uid") >= 0);
    pass('free text mode keeps only the allergy chip', notesSrc.indexOf("var compact = CN.mode === 'free'") >= 0);
    pass('dictation grants mic stream before recognition', notesSrc.indexOf('getUserMedia({ audio: true })') >= 0 &&
        extractFn(notesSrc, 'cnMicToggle').indexOf('cnMicEnsureStream()') >= 0);
    pass('dictation auto-restarts after Chrome ends a session', extractFn(notesSrc, 'cnMicStartRecognition').indexOf('cnMicScheduleRestart') >= 0);
    pass('dictation inserts without moving focus', extractFn(notesSrc, 'cnMicStartRecognition').indexOf('noFocus: true') >= 0);
    pass('mic button keeps focus in the note field', notesSrc.indexOf("mic.addEventListener('mousedown'") >= 0);
    pass('dictation status line in markup', html.indexOf('id="conNoteMicState"') >= 0);
    pass('index loads app-con-dictation-fix.js before app-con-notes.js',
        html.indexOf("'app-con-dictation-fix.js'") >= 0 &&
        html.indexOf("'app-con-dictation-fix.js'") < html.indexOf("'app-con-notes.js'"));
    ['conNoteMicLang', 'conNoteMicFixesBtn', 'conNoteTeach', 'conNoteAlts']
        .forEach(function (id) { pass('markup #' + id, html.indexOf('id="' + id + '"') >= 0); });
    pass('dictation language no longer follows UI language', extractFn(notesSrc, 'cnMicLang').indexOf('appUiLang') < 0);
    pass('dictation asks Chrome for 5 alternatives', extractFn(notesSrc, 'cnMicStartRecognition').indexOf('maxAlternatives = 5') >= 0);
    pass('final results go through the accuracy layer', extractFn(notesSrc, 'cnMicStartRecognition').indexOf('cnMicProcessFinal(') >= 0);
    pass('learned corrections stored per login', extractFn(notesSrc, 'cnDictLearned').indexOf('cnUserScopedKey(CN_MIC_FIXES_KEY)') >= 0);
    pass('migration SQL present', fs.existsSync(path.join(root, 'treatments_note_audit.sql')));
    pass('CSS for composer + cards', css.indexOf('.cn-sec-head') >= 0 && css.indexOf('.note-card--addendum') >= 0 &&
        css.indexOf('.cn-tooth-pop') >= 0);

    console.log('\n=== i18n ===');
    var keys = {};
    [notesSrc, conSrc].forEach(function (s) {
        var re = /conTr(?:Repl)?\('(con\.note\.[A-Za-z0-9_.]+)'/g, m;
        while ((m = re.exec(s))) keys[m[1]] = 1;
    });
    var re2 = /data-i18n(?:-placeholder|-title|-aria-label)?="(con\.note\.[A-Za-z0-9_.]+)"/g, m2;
    while ((m2 = re2.exec(html))) keys[m2[1]] = 1;
    ['co', 'mh', 'hpc', 'eo', 'io', 'xr', 'si', 'tx', 'px', 'next', 'other'].forEach(function (k) { keys['con.note.sec.' + k] = 1; });
    var re3 = /key: '(con\.note\.[A-Za-z0-9_.]+)'/g, m3;
    while ((m3 = re3.exec(notesSrc))) keys[m3[1]] = 1;
    var missing = Object.keys(keys).filter(function (k) { return !/\.$/.test(k); }).filter(function (k) {
        var i = i18n.indexOf("'" + k + "':");
        if (i < 0) return true;
        var line = i18n.slice(i, i18n.indexOf('\n', i));
        return !(line.indexOf('en:') >= 0 && line.indexOf("'zh-CN':") >= 0 && line.indexOf("'zh-Hant':") >= 0);
    });
    pass('all con.note.* keys defined in en / zh-CN / zh-Hant', !missing.length,
        missing.length ? missing.join(', ') : Object.keys(keys).length + ' keys');

    console.log('\n=== unit: sections ===');
    var store = {};
    var ctx = {
        console: console,
        window: { addEventListener: function () {} },
        document: { readyState: 'complete', addEventListener: function () {}, querySelectorAll: function () { return []; } },
        localStorage: {
            getItem: function (k) { return store[k] == null ? null : store[k]; },
            setItem: function (k, v) { store[k] = String(v); },
            removeItem: function (k) { delete store[k]; },
            key: function (i) { return Object.keys(store)[i]; },
            get length() { return Object.keys(store).length; }
        },
        g: function () { return null; },
        esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
        conTr: function (k) { return k; },
        conTrRepl: function (k) { return k; }
    };
    vm.createContext(ctx);
    vm.runInContext(read('app-con-dictation-fix.js'), ctx);
    vm.runInContext(notesSrc, ctx);
    ['conNoteNameKey', 'conNoteWrittenByLabel', 'conNoteEditHistory', 'conNoteIsMine', 'conNoteCanEdit', 'conNoteActorName']
        .forEach(function (fn) { vm.runInContext(extractFn(conSrc, fn), ctx); });

    var full = {
        co: 'Pain 36 x 3 days', mh: 'NAD', hpc: 'Worse at night', eo: 'No facial swelling, TMJ NAD',
        io: '36 deep caries DO\nGingiva healthy', xr: 'PA 36: deep caries close to pulp', si: 'Cold test +ve lingering',
        tx: 'LA given. Access cavity 36', px: 'Ibuprofen 400mg tds x 3 days', next: 'RCT continue 36', other: ''
    };
    var composed = ctx.cnCompose(full);
    pass('compose order C/O → Next with E/O, I/O',
        composed.indexOf('C/O: ') === 0 && composed.indexOf('E/O: ') > composed.indexOf('HPC: ') &&
        composed.indexOf('I/O: ') > composed.indexOf('E/O: ') && composed.indexOf('Xrays: ') > composed.indexOf('I/O: ') &&
        composed.indexOf('Next: ') > composed.indexOf('Px: '));
    var back = ctx.cnParse(composed);
    pass('round trip keeps every section (incl. multi-line I/O)', Object.keys(full).every(function (k) {
        return String(back.sections[k] || '') === full[k];
    }), 'labeled=' + back.labeled);
    pass('empty sections skipped', ctx.cnCompose({ co: 'x', tx: '', next: ' ' }) === 'C/O: x');
    var aliases = ctx.cnParse('Extra-oral: swelling L cheek\nintraoral: 46 fractured cusp\nspecial investigation: TTP +ve');
    pass('aliases: Extra-oral / intraoral / special investigation',
        aliases.sections.eo === 'swelling L cheek' && aliases.sections.io === '46 fractured cusp' &&
        aliases.sections.si === 'TTP +ve');
    pass('E/O and I/O short forms', ctx.cnParse('E/O: NAD\nI/O: plaque').sections.eo === 'NAD' &&
        ctx.cnParse('E/O: NAD\nI/O: plaque').sections.io === 'plaque');
    var free = ctx.cnParse('Scaling done, OHI given');
    pass('free text → Other section', free.labeled === 0 && free.sections.other === 'Scaling done, OHI given');
    pass('no false label mid-sentence', ctx.cnParse('Pt says tx: later').labeled === 0);
    var mixed = ctx.cnParse('Walk-in\nTx: S&P');
    pass('preamble + labelled section', mixed.sections.other === 'Walk-in' && mixed.sections.tx === 'S&P');
    pass('compose puts preamble first', ctx.cnCompose(mixed.sections) === 'Walk-in\nTx: S&P');

    var disp = ctx.conNotesFormatBodyHtml('C/O: pain\nE/O: NAD\nI/O: <36> caries');
    pass('history display: label column for 2+ sections', disp.indexOf('cn-disp-row--eo') >= 0 &&
        disp.indexOf('cn-disp-row--io') >= 0 && disp.indexOf('&lt;36&gt;') >= 0);
    pass('history display: SI short label', ctx.conNotesFormatBodyHtml('Tx: a\nSpecial investigation: b').indexOf('>SI<') >= 0);
    pass('history display: plain text when <2 labels', ctx.conNotesFormatBodyHtml('Tx: a <b>') === 'Tx: a &lt;b&gt;');
    pass('E/O + I/O have phrase chips', ctx.CN_DEFAULT_PHRASES.eo.length > 0 && ctx.CN_DEFAULT_PHRASES.io.length > 0);
    pass('tooth picker on I/O', !!ctx.CN_TOOTH_KEYS.io);

    console.log('\n=== unit: author / audit helpers ===');
    ctx.currentName = 'Nurse Amy';
    ctx.currentUserId = 'u-1';
    ctx.currentRole = 'nurse';
    pass('written-by shown when author ≠ doctor',
        ctx.conNoteWrittenByLabel({ author_name: 'Nurse Amy', doctor_name: 'Dr NG PUI CHING' }) === 'con.note.writtenBy');
    pass('written-by hidden when doctor typed it',
        ctx.conNoteWrittenByLabel({ author_name: 'NG PUI CHING', doctor_name: 'Dr NG PUI CHING', doctor_tag: 'Dr NG PUI CHING_CWB' }) === '');
    pass('written-by hidden for legacy rows', ctx.conNoteWrittenByLabel({ dentist_name: 'Dr X' }) === '');
    pass('nurse can edit own note today', ctx.conNoteCanEdit({ author_id: 'u-1' }, true) === true);
    pass('nurse cannot edit others', ctx.conNoteCanEdit({ author_id: 'u-2', author_name: 'Dr X' }, true) === false);
    pass('nobody edits past-day notes (addendum instead)', ctx.conNoteCanEdit({ author_id: 'u-1' }, false) === false);
    pass('deleted notes not editable', ctx.conNoteCanEdit({ author_id: 'u-1', deleted_at: 'x' }, true) === false);
    ctx.currentRole = 'doctor';
    pass('doctor edits any note today', ctx.conNoteCanEdit({ author_id: 'u-9' }, true) === true);
    ctx.loggedInUserName = 'nurse01';
    ctx.currentName = 'DR NG PUI CHING';
    pass('author = login user, not the active doctor', ctx.conNoteActorName() === 'nurse01');
    pass('author_name saved from login', conSrc.indexOf('loggedInUserName') >= 0 &&
        extractFn(conSrc, 'conBuildNoteRow').indexOf('conNoteActorName()') >= 0);
    pass('edit_history parses json string', ctx.conNoteEditHistory({ edit_history: '[{"notes":"a"}]' }).length === 1);

    console.log('\n=== unit: drafts ===');
    ctx.cnDraftWrite('p1', 'Tx: draft');
    pass('draft stored per patient', ctx.cnDraftRead('p1').text === 'Tx: draft' && ctx.cnDraftRead('p2') === null);
    ctx.cnDraftWrite('p1', '   ');
    pass('empty text removes draft', ctx.cnDraftRead('p1') === null);
    store['conNoteDraft:v1:old'] = JSON.stringify({ text: 'x', at: Date.now() - 20 * 86400e3 });
    ctx.cnPruneDrafts();
    pass('drafts older than 14 days pruned', !('conNoteDraft:v1:old' in store));

    console.log('\n=== unit: dictation accuracy ===');
    var fix = function (s, o) { return ctx.cnDictCorrect(s, o); };
    pass('ceiling and polishing → scaling and polishing', fix('ceiling and polishing done') === 'scaling and polishing done');
    pass('Ceiling (capitalised) → Scaling', fix('Ceiling done') === 'Scaling done');
    pass('chatting → charting', fix('perio chatting completed') === 'perio charting completed');
    pass('plague / buckle / carries', fix('plague on buckle surface, carries 36') === 'plaque on buccal surface, caries 36');
    pass('perry apical / lig no cane / bite wings', fix('perry apical x ray, lig no cane, bite wings') === 'periapical X-ray, lignocaine, bitewings');
    pass('spelled acronyms: o h i / t t p / r c t', fix('o h i given, t t p negative, r c t continue') === 'OHI given, TTP negative, RCT continue');
    pass('lowercase acronyms uppercased', fix('ohi given, opg taken, tmj nad') === 'OHI given, OPG taken, TMJ NAD');
    pass('"four six" → 46; "tooth 3 6" → tooth 36', fix('four six MOD') === '46 MOD' && fix('tooth 3 6 caries') === 'tooth 36 caries');
    pass('normal words untouched', fix('review in two weeks, pain started yesterday') === 'review in two weeks, pain started yesterday');
    var learned = [{ from: 'sky ling', to: 'scaling' }, { from: 'mouth wash', to: 'mouthwash' }];
    pass('learned phrase applied (case-insensitive)', fix('Sky ling done, mouth wash given', { learned: learned }) === 'Scaling done, mouthwash given');
    pass('learned word needs whole-word match', fix('skyline view', { learned: [{ from: 'sky', to: 'X' }] }) === 'skyline view');
    var best = ctx.cnDictBest(['starting done', 'charting done'], { lang: 'en-GB' });
    pass('picks the alternative with dental terms', best.text === 'charting done' && best.index === 1);
    var tie = ctx.cnDictBest(['pain on the left', 'paint on the left'], { lang: 'en-GB' });
    pass('tie keeps Chrome\'s first choice', tie.index === 0);
    var cjk = ctx.cnDictBest(['洗牙', 'scaling'], { lang: 'en-GB' });
    pass('English mode rejects Chinese-character alternatives', cjk.text === 'scaling');
    var sec = ctx.cnDictBest(['access cavity', 'excess cavity'], { lang: 'en-GB', extraTerms: ctx.cnDictSectionTerms('tx') });
    pass('section chips steer the pick', sec.text === 'access cavity');
    pass('best keeps Chrome\'s other guesses as choices', ctx.cnDictBest(['a b', 'charting done', 'a b'], { lang: 'en-GB' }).alts.length === 2);
    var sug = ctx.cnDictSuggest('calling done');
    pass('suggests close dental word (calling → scaling)', sug.indexOf('scaling done') >= 0, JSON.stringify(sug));
    pass('no suggestions for common words / dental words', ctx.cnDictSuggest('pain done today, scaling given').length === 0,
        JSON.stringify(ctx.cnDictSuggest('pain done today, scaling given')));
    pass('suggestion keeps capital letter', ctx.cnDictSuggest('Calling done').indexOf('Scaling done') >= 0);
    var fc = ctx.cnDictFindCorrection;
    var old = 'Tx: ceiling done';
    var d1 = fc(old, 'Tx: scaling done', 4, old.length);
    pass('detects a word swap inside dictated text', d1 && d1.from === 'ceiling' && d1.to === 'scaling', JSON.stringify(d1));
    var d2 = fc('ok. sky ling done', 'ok. scaling done', 4, 17);
    pass('detects a two-word → one-word fix', d2 && d2.from === 'sky ling' && d2.to === 'scaling', JSON.stringify(d2));
    pass('ignores edits outside the dictated range', fc('Pain. ceiling done', 'Pains. ceiling done', 6, 18) === null);
    pass('ignores pure appends after dictation', fc('ceiling done', 'ceiling done, OHI given', 0, 12) === null);
    pass('ignores big rewrites', fc('ceiling done today ok', 'completely different sentence here now yes', 0, 21) === null);
    pass('ignores case-only changes', fc('ceiling done', 'Ceiling done', 0, 12) === null);
    store = {};
    ctx.localStorage.getItem = function (k) { return store[k] == null ? null : store[k]; };
    ctx.localStorage.setItem = function (k, v) { store[k] = String(v); };
    ctx.currentUserId = 'u-dict';
    pass('dictation language defaults to English (UK) even with Chinese UI', (ctx.appUiLang = 'zh-Hant', ctx.cnMicLang() === 'en-GB'));
    ctx.cnMicSetLang('yue-Hant-HK');
    pass('dictation language remembered per login', store['conNoteMicLang:u-dict'] === 'yue-Hant-HK' && ctx.cnMicLang() === 'yue-Hant-HK');
    ctx.currentUserId = 'u-other';
    delete store['conNoteMicLang'];
    pass('another login keeps its own default', ctx.cnMicLang() === 'en-GB');
    ctx.cnDictAddLearned('ceiling', 'scaling');
    ctx.cnDictAddLearned('Ceiling', 'sealing');
    pass('learned corrections per login, latest wins', ctx.cnDictLearned().length === 1 && ctx.cnDictLearned()[0].to === 'sealing' &&
        !store['conNoteDictFixes:v1:u-dict']);
    ctx.currentUserId = 'u-1';

    console.log('\n=== HTTP spot ===');
    var port = null;
    for (var p of [5501, 8124, 5500, 8123]) {
        try {
            var r = await httpGet(p, '/index.html');
            if (r.status === 200 && r.body.indexOf(EXPECTED_BUILD) >= 0) { port = p; break; }
        } catch (e) {}
    }
    pass('a local server serves BUILD ' + EXPECTED_BUILD, !!port, port ? ':' + port : 'none of 5501/8124/5500/8123');
    if (port) {
        var js = await httpGet(port, '/app-con-notes.js');
        pass('GET /app-con-notes.js', js.status === 200 && js.body.indexOf('conNotesFormatBodyHtml') >= 0, 'HTTP ' + js.status);
    }

    console.log('\n=== API: treatments ===');
    var sbc = readSbConfig(appSrc);
    var base = await rest(sbc.url, sbc.key, 'GET', 'treatments', 'select=id,notes,doctor_id,doctor_name,doctor_tag,clinic_tag&limit=1');
    pass('treatments REST ok', base.status === 200, 'HTTP ' + base.status);
    var audit = await rest(sbc.url, sbc.key, 'GET', 'treatments',
        'select=id,author_name,author_role,author_id,edited_at,edited_by,edit_history,deleted_at,deleted_by,parent_id&limit=1');
    var auditReady = audit.status === 200;
    console.log('INFO  audit columns: ' + (auditReady ? 'present' : 'missing — run treatments_note_audit.sql (app falls back)'));

    var tag = 'SMOKE_NOTE ' + Date.now();
    var row = { patient_id: PID, notes: 'C/O: ' + tag + '\nE/O: NAD\nI/O: 36 caries', dentist_name: 'SMOKE DR', doctor_name: 'SMOKE DR', doctor_tag: 'SMOKE DR' };
    if (auditReady) { row.author_name = 'Smoke Nurse'; row.author_role = 'nurse'; row.author_id = 'smoke'; }
    var ins = await rest(sbc.url, sbc.key, 'POST', 'treatments', '', [row]);
    pass('test client: insert note', ins.status === 201 && Array.isArray(ins.json), 'HTTP ' + ins.status + (ins.status !== 201 ? ' ' + ins.raw : ''));
    var nid = ins.json && ins.json[0] && ins.json[0].id;
    if (nid && auditReady) {
        pass('author saved', ins.json[0].author_name === 'Smoke Nurse');
        var ed = await rest(sbc.url, sbc.key, 'PATCH', 'treatments', 'id=eq.' + nid, {
            notes: row.notes + '\nTx: edited', edited_at: new Date().toISOString(), edited_by: 'Smoke Dr',
            edit_history: [{ at: ins.json[0].created_at, by: 'Smoke Nurse', notes: row.notes }]
        });
        pass('edit with history', ed.status === 200 && ed.json && ed.json[0] &&
            ed.json[0].edit_history.length === 1 && ed.json[0].edit_history[0].notes === row.notes, 'HTTP ' + ed.status);
        var add = await rest(sbc.url, sbc.key, 'POST', 'treatments', '', [{
            patient_id: PID, notes: tag + ' addendum', parent_id: nid, author_name: 'Smoke Dr', dentist_name: 'SMOKE DR'
        }]);
        pass('addendum with parent_id', add.status === 201 && add.json[0].parent_id === nid, 'HTTP ' + add.status);
        var sd = await rest(sbc.url, sbc.key, 'PATCH', 'treatments', 'id=eq.' + nid, { deleted_at: new Date().toISOString(), deleted_by: 'Smoke Dr' });
        pass('soft delete keeps the row', sd.status === 200 && sd.json[0].deleted_at && sd.json[0].notes.indexOf(tag) >= 0);
    }
    var left = await rest(sbc.url, sbc.key, 'GET', 'treatments', 'select=id&patient_id=eq.' + PID + '&notes=like.*SMOKE_NOTE*');
    var ids = (left.json || []).map(function (r) { return r.id; });
    if (ids.length) {
        var del = await rest(sbc.url, sbc.key, 'DELETE', 'treatments', 'id=in.(' + ids.join(',') + ')');
        pass('cleanup smoke notes', del.status >= 200 && del.status < 300, 'n=' + ids.length);
    } else {
        pass('no leftover smoke notes', left.status === 200);
    }

    console.log('\n=== result ===');
    if (fails.length) {
        console.log('FAILED ' + fails.length + '  ' + fails.join(' | '));
        process.exit(1);
    }
    console.log('SMOKE + UNIT + HTTP + API ALL PASS');
    process.exit(0);
})().catch(function (err) {
    console.error('ERROR', err && err.stack ? err.stack : err);
    process.exit(1);
});
