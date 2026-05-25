// ════════════════════════════════════════════════════════════════
// app-broadcast.js  — Real-time Broadcast Chat Window
// Game-style floating chat panel with Supabase Realtime delivery.
// Requires: SB (app.js), currentUserId, currentName, currentRole,
//           currentClinicId, currentClinicLabel (all from app.js)
// ════════════════════════════════════════════════════════════════

var BROADCAST = (function () {

    if (window.__JOYFUL_BC_INST__) {
        return window.__JOYFUL_BC_INST__;
    }

    var BC_TABLE    = 'broadcast_messages';
    var BC_HISTORY  = 50;    // messages fetched on open
    var BC_MAX_FEED = 150;   // cap before trimming oldest rows
    var BC_CHAR_LIM = 280;

    // ── emoji palette ──────────────────────────────────────────
    var EMOJIS = [
        '😊','😂','😅','🥺','😮','❤️','👍','👎','👋','🤝',
        '🎉','🔥','💯','✅','❌','⚠️','📌','🚨','⏰','🎯',
        '🏥','🦷','💊','💉','🩺','📅','📢','🌐','👨‍⚕️','🌟'
    ];

    // ── message colour options ─────────────────────────────────
    var COLORS = [
        { hex: '#e2e8f0', name: 'White'  },
        { hex: '#fde68a', name: 'Yellow' },
        { hex: '#67e8f9', name: 'Cyan'   },
        { hex: '#86efac', name: 'Green'  },
        { hex: '#fdba74', name: 'Orange' },
        { hex: '#f9a8d4', name: 'Pink'   },
        { hex: '#fca5a5', name: 'Red'    }
    ];

    // ── state ──────────────────────────────────────────────────
    var _open      = false;
    var _minimized = false;
    var _scope     = 'clinic';   // 'clinic' | 'global'
    var _color     = '#e2e8f0';
    var _unread    = 0;
    var _channel   = null;
    var _msgCount  = 0;
    var _dragging  = false;
    var _dragOffX  = 0;
    var _dragOffY  = 0;
    var _built     = false;

    // ── TTS state ──────────────────────────────────────────────
    var _ttsOn        = false;
    var _ttsVoiceKey  = 'auto';    // 'auto' | 'en' | 'yue' | 'cmn'
    var _ttsToneKey   = 'normal';  // character tone preset key
    var _ttsQueue     = [];
    var _ttsSpeaking  = false;
    var _ttsVoices    = [];      // cached after voiceschanged / warm-up
    var _ttsResumeIv  = null;    // Chrome: keep synthesis from going silent
    var _skipTtsMsgIds = {};     // message ids sent from this tab (skip echo here only)
    var _pendingOwnSend = null;  // until insert returns, match realtime echo on sender tab
    var _ttsSpokenIds   = {};    // each message id spoken once per tab
    var _ttsUtterGen    = 0;     // ignore stale onend/onerror from cancelled utterances
    var _ttsPinnedVoiceUri = null;
    var _ttsRecentSig   = '';
    var _ttsRecentAt    = 0;
    var BC_TTS_LS       = 'joyful_bc_tts_v1';
    var BC_TTS_VOICE_LS = 'joyful_bc_tts_voice_v1';
    var BC_TTS_TONE_LS  = 'joyful_bc_tts_tone_v1';

    // Voice options: key, display label, BCP-47 language tag
    var TTS_VOICES = [
        { key: 'auto', label: 'Auto',   langTag: null    },
        { key: 'en',   label: 'EN',     langTag: 'en-US' },
        { key: 'yue',  label: '粵語',   langTag: 'zh-HK' },
        { key: 'cmn',  label: '普通話', langTag: 'zh-CN' }
    ];

    // Character tone presets — pitch (0–2) and rate (0.1–10) via Web Speech API
    var TTS_TONES = [
        { key: 'normal',  label: 'Normal',  icon: '🎙️', rate: 1.00, pitch: 1.00, vol: 0.92 },
        { key: 'female',  label: 'Female',  icon: '👩',  rate: 1.05, pitch: 1.55, vol: 0.92 },
        { key: 'male',    label: 'Male',    icon: '👨',  rate: 0.92, pitch: 0.62, vol: 0.92 },
        { key: 'elder',   label: 'Elder',   icon: '👴',  rate: 0.75, pitch: 0.80, vol: 0.88 },
        { key: 'robot',   label: 'Robot',   icon: '🤖',  rate: 0.82, pitch: 0.38, vol: 0.95 },
        { key: 'cartoon', label: 'Cartoon', icon: '🐭',  rate: 1.45, pitch: 1.92, vol: 0.90 },
        { key: 'beast',   label: 'Beast',   icon: '👹',  rate: 0.58, pitch: 0.18, vol: 1.00 },
        { key: 'whisper', label: 'Whisper', icon: '🤫',  rate: 0.88, pitch: 1.15, vol: 0.28 }
    ];

    // ── tiny helpers ───────────────────────────────────────────
    function g(id) { return document.getElementById(id); }

    function myClinicId() {
        return (typeof currentClinicId !== 'undefined') ? (currentClinicId || null) : null;
    }
    function myName() {
        return (typeof currentName !== 'undefined') ? (currentName || 'Unknown') : 'Unknown';
    }
    function myRole() {
        return (typeof currentRole !== 'undefined') ? (currentRole || 'staff') : 'staff';
    }
    function myUserId() {
        return (typeof currentUserId !== 'undefined') ? (currentUserId || '') : '';
    }

    // ── role display helpers ───────────────────────────────────
    var ROLE_CLASS = {
        admin:   'bc-role-admin',
        doctor:  'bc-role-doctor',
        dentist: 'bc-role-dentist',
        nurse:   'bc-role-nurse'
    };
    function roleCls(role) {
        return ROLE_CLASS[String(role || '').toLowerCase()] || 'bc-role-staff';
    }
    var ROLE_LABEL = {
        admin:   'ADMIN',
        doctor:  'DOC',
        dentist: 'DENT',
        nurse:   'NURSE',
        staff:   'STAFF'
    };
    function roleLbl(role) {
        var r = String(role || '').toLowerCase();
        return ROLE_LABEL[r] || String(role || 'USER').toUpperCase().slice(0, 6);
    }

    // ── format timestamp ───────────────────────────────────────
    function fmtTime(isoStr) {
        try {
            var d = new Date(isoStr);
            var h = d.getHours(), m = d.getMinutes();
            var ampm = h >= 12 ? 'PM' : 'AM';
            h = h % 12 || 12;
            return h + ':' + String(m).padStart(2, '0') + '\u202F' + ampm;
        } catch (e) { return ''; }
    }

    // ── build one message row DOM element ──────────────────────
    function buildRow(msg) {
        var isGlobal = !msg.clinic_id;
        var isOwn    = msg.sender_id && msg.sender_id === String(myUserId());

        var row = document.createElement('div');
        row.className = 'bc-msg' + (isOwn ? ' bc-msg-own' : '');
        row.dataset.msgId = msg.id || '';

        // timestamp
        var time = document.createElement('span');
        time.className = 'bc-msg-time';
        time.textContent = fmtTime(msg.created_at);
        row.appendChild(time);

        // scope badge
        var scope = document.createElement('span');
        scope.className = 'bc-scope-tag' + (isGlobal ? ' bc-scope-global' : '');
        scope.textContent = isGlobal ? '🌐' : '🏥';
        scope.title       = isGlobal ? 'All Clinics' : 'This Clinic';
        row.appendChild(scope);

        // role badge
        var badge = document.createElement('span');
        badge.className = 'bc-role-badge ' + roleCls(msg.sender_role);
        badge.textContent = roleLbl(msg.sender_role);
        row.appendChild(badge);

        // sender name
        var sender = document.createElement('span');
        sender.className = 'bc-msg-sender';
        sender.textContent = msg.sender_name || 'Unknown';
        row.appendChild(sender);

        // colon separator
        var colon = document.createElement('span');
        colon.className = 'bc-msg-colon';
        colon.textContent = ':';
        row.appendChild(colon);

        // message body
        var body = document.createElement('span');
        body.className = 'bc-msg-text';
        body.style.color = msg.msg_color || '#e2e8f0';
        body.textContent = msg.message;
        row.appendChild(body);

        return row;
    }

    // ── append a message to the feed ──────────────────────────
    function appendMsg(msg, animate) {
        var feed = g('bcFeed');
        if (!feed) return;

        var empty = feed.querySelector('.bc-feed-empty');
        if (empty) empty.remove();

        var row = buildRow(msg);
        if (!animate) row.style.animation = 'none';
        feed.appendChild(row);
        _msgCount++;

        // trim oldest
        while (_msgCount > BC_MAX_FEED) {
            var first = feed.querySelector('.bc-msg');
            if (first) { first.remove(); _msgCount--; } else break;
        }
        feed.scrollTop = feed.scrollHeight;
    }

    // ── system notice (italic grey line) ──────────────────────
    function appendSystem(text) {
        var feed = g('bcFeed');
        if (!feed) return;
        var row  = document.createElement('div');
        row.className = 'bc-msg bc-msg-system';
        var sp   = document.createElement('span');
        sp.className = 'bc-msg-system-text';
        sp.textContent = text;
        row.appendChild(sp);
        feed.appendChild(row);
        feed.scrollTop = feed.scrollHeight;
    }

    // ── load recent history from Supabase ──────────────────────
    function loadHistory() {
        if (typeof SB === 'undefined') {
            appendSystem('⚠ Database not connected.');
            return;
        }
        var clinicId = myClinicId();

        SB.from(BC_TABLE)
            .select('*')
            .order('created_at', { ascending: false })
            .limit(BC_HISTORY)
            .then(function (res) {
                if (res.error) {
                    appendSystem('⚠ Could not load history: ' + res.error.message);
                    return;
                }
                var rows = (res.data || []).reverse().filter(function (r) {
                    return !r.clinic_id || r.clinic_id === clinicId;
                });

                var feed = g('bcFeed');
                if (!feed) return;
                feed.innerHTML = '';
                _msgCount = 0;

                if (!rows.length) {
                    var empty = document.createElement('div');
                    empty.className = 'bc-feed-empty';
                    empty.textContent = '— No messages yet. Be the first to say hello! —';
                    feed.appendChild(empty);
                    return;
                }
                rows.forEach(function (r) { appendMsg(r, false); });
            });
    }

    // ════════════════════════════════════════════════════════
    // TTS — Web Speech API (no external library required)
    // ════════════════════════════════════════════════════════

    function ttsSupported() {
        return !!(window.speechSynthesis && window.SpeechSynthesisUtterance);
    }

    // Refresh installed voice list (getVoices() is empty until voiceschanged on many browsers)
    function ttsRefreshVoices() {
        if (!ttsSupported()) return;
        try {
            var list = window.speechSynthesis.getVoices();
            if (list && list.length) _ttsVoices = list;
        } catch (e) {}
    }

    function ttsVoicesList() {
        if (_ttsVoices.length) return _ttsVoices;
        ttsRefreshVoices();
        return _ttsVoices;
    }

    function ttsBindVoices() {
        if (!ttsSupported() || window._bcTtsVoicesBound) return;
        window._bcTtsVoicesBound = true;
        ttsRefreshVoices();
        window.speechSynthesis.onvoiceschanged = ttsRefreshVoices;
        // Safari / older Chrome sometimes need a delayed second read
        setTimeout(ttsRefreshVoices, 120);
        setTimeout(ttsRefreshVoices, 600);
    }

    // Chrome pauses the synthesis queue after ~15s; resume while speaking
    function ttsStartResumeWatch() {
        if (_ttsResumeIv || !ttsSupported()) return;
        _ttsResumeIv = setInterval(function () {
            if (!_ttsSpeaking) return;
            try {
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
            } catch (e) {}
        }, 250);
    }

    function ttsStopResumeWatch() {
        if (_ttsResumeIv) {
            clearInterval(_ttsResumeIv);
            _ttsResumeIv = null;
        }
    }

    // Load saved preferences
    function ttsLoad() {
        try {
            _ttsOn       = localStorage.getItem(BC_TTS_LS) === '1';
            _ttsVoiceKey = localStorage.getItem(BC_TTS_VOICE_LS) || 'auto';
            _ttsToneKey  = localStorage.getItem(BC_TTS_TONE_LS)  || 'normal';
        } catch (e) {}
    }

    function ttsSave() {
        try {
            localStorage.setItem(BC_TTS_LS,       _ttsOn ? '1' : '0');
            localStorage.setItem(BC_TTS_VOICE_LS, _ttsVoiceKey);
            localStorage.setItem(BC_TTS_TONE_LS,  _ttsToneKey);
        } catch (e) {}
    }

    // Resolve the active BCP-47 tag from the chosen voice key
    function ttsResolveLangTag() {
        var v = null;
        for (var i = 0; i < TTS_VOICES.length; i++) {
            if (TTS_VOICES[i].key === _ttsVoiceKey) { v = TTS_VOICES[i]; break; }
        }
        if (v && v.langTag) return v.langTag;
        // Auto: map from app UI language — zh-Hant → zh-HK (Cantonese, HK clinic)
        var lang = (typeof appUiLang !== 'undefined') ? String(appUiLang) : 'en';
        if (lang === 'zh-CN')   return 'zh-CN';
        if (lang === 'zh-Hant') return 'zh-HK';
        return 'en-US';
    }

    // Find the best installed SpeechSynthesisVoice for a given BCP-47 tag
    function findBestVoice(langTag) {
        if (!ttsSupported()) return null;
        var voices = ttsVoicesList();
        if (!voices || !voices.length) return null;
        var lo     = langTag.toLowerCase();
        var prefix = lo.split('-').slice(0, 2).join('-');
        var langOnly = lo.split('-')[0];
        // 1. Exact match
        for (var i = 0; i < voices.length; i++) {
            if (voices[i].lang.toLowerCase() === lo) return voices[i];
        }
        // 2. Prefix match (zh-HK matches zh-HK-HiuMaan, zh-HK-HiuGaai)
        for (var j = 0; j < voices.length; j++) {
            if (voices[j].lang.toLowerCase().startsWith(prefix)) return voices[j];
        }
        // 3. Cantonese fallback: zh-TW / zh-Hant if zh-HK not installed
        if (prefix === 'zh-hk') {
            for (var k = 0; k < voices.length; k++) {
                var vl = voices[k].lang.toLowerCase();
                if (vl.startsWith('zh-tw') || vl.startsWith('zh-hant')) return voices[k];
            }
        }
        // Auto only: same language family, then system default (explicit EN/粵語/普通話 stay strict)
        if (_ttsVoiceKey === 'auto') {
            for (var m = 0; m < voices.length; m++) {
                if (voices[m].lang.toLowerCase().split('-')[0] === langOnly) return voices[m];
            }
            for (var d = 0; d < voices.length; d++) {
                if (voices[d].default) return voices[d];
            }
            return voices[0];
        }
        return null;
    }

    // Strip emoji so the synthesiser doesn't stumble on pictographs
    function ttsStrip(str) {
        return String(str || '')
            .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
            .replace(/[\u2600-\u27BF]/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    // Walkie-talkie body only — never prefix sender; strip legacy "Name says:" / "Name講：" in text
    function ttsMessageText(raw) {
        var clean = ttsStrip(raw);
        if (!clean) return '';
        clean = clean.replace(/^.{1,120}?\s+says\s*[:：]\s*/i, '');
        clean = clean.replace(/^.{1,120}?講\s*[:：]\s*/, '');
        return clean.trim();
    }

    function ttsClearPinnedVoice() {
        _ttsPinnedVoiceUri = null;
    }

    function ttsGetPinnedVoice(langTag) {
        var voices = ttsVoicesList();
        var i, v;
        if (_ttsPinnedVoiceUri && voices.length) {
            for (i = 0; i < voices.length; i++) {
                if (voices[i].voiceURI === _ttsPinnedVoiceUri) return voices[i];
            }
        }
        v = findBestVoice(langTag);
        if (v) _ttsPinnedVoiceUri = v.voiceURI;
        return v;
    }

    function ttsMarkSpoken(msg) {
        if (msg && msg.id) _ttsSpokenIds[msg.id] = Date.now();
    }

    function ttsAlreadySpoken(msg) {
        if (msg && msg.id && _ttsSpokenIds[msg.id]) return true;
        var sig = (msg && msg.id ? msg.id : '') + '|' + ttsMessageText(msg && msg.message);
        var now = Date.now();
        if (sig && sig === _ttsRecentSig && (now - _ttsRecentAt) < 4000) return true;
        _ttsRecentSig = sig;
        _ttsRecentAt  = now;
        return false;
    }

    function ttsPruneSpokenIds() {
        var keys = Object.keys(_ttsSpokenIds);
        if (keys.length < 250) return;
        keys.sort(function (a, b) { return _ttsSpokenIds[a] - _ttsSpokenIds[b]; });
        for (var i = 0; i < keys.length - 200; i++) {
            delete _ttsSpokenIds[keys[i]];
        }
    }

    // Resolve current tone preset
    function ttsCurrentTone() {
        for (var i = 0; i < TTS_TONES.length; i++) {
            if (TTS_TONES[i].key === _ttsToneKey) return TTS_TONES[i];
        }
        return TTS_TONES[0];
    }

    function ttsApplyUtterance(utt, langTag) {
        var tone = ttsCurrentTone();
        var foundVoice = ttsGetPinnedVoice(langTag);
        utt.lang = langTag;
        if (foundVoice) utt.voice = foundVoice;
        utt.rate   = tone.rate;
        utt.pitch  = Math.max(0.1, Math.min(2, tone.pitch));
        utt.volume = Math.max(0.1, Math.min(1, tone.vol));
    }

    function ttsFinishUtterance(gen) {
        if (gen !== _ttsUtterGen) return;
        _ttsSpeaking = false;
        if (!_ttsQueue.length) ttsStopResumeWatch();
        setTimeout(ttsFlush, 50);
    }

    // Drain the queue one utterance at a time (sample + incoming messages share this path)
    function ttsFlush() {
        if (_ttsSpeaking || !_ttsQueue.length || !ttsSupported()) return;
        ttsRefreshVoices();
        var item = _ttsQueue.shift();
        var gen  = ++_ttsUtterGen;
        var utt  = new window.SpeechSynthesisUtterance(item.text);
        ttsApplyUtterance(utt, item.lang);
        _ttsSpeaking = true;
        ttsStartResumeWatch();
        utt.onstart = function () {
            try {
                if (window.speechSynthesis.paused) window.speechSynthesis.resume();
            } catch (e) {}
        };
        utt.onend = function () {
            ttsFinishUtterance(gen);
        };
        utt.onerror = function () {
            ttsFinishUtterance(gen);
        };
        try {
            window.speechSynthesis.resume();
            window.speechSynthesis.speak(utt);
        } catch (e) {
            ttsFinishUtterance(gen);
        }
    }

    function ttsEnqueue(text, langTag) {
        if (!text) return;
        _ttsQueue.push({ text: text, lang: langTag });
        while (_ttsQueue.length > 6) _ttsQueue.shift();
        ttsFlush();
    }

    // Short sample when enabling TTS — same voice/language as incoming messages
    function ttsPlaySample() {
        if (!ttsSupported() || !_ttsOn) return;
        ttsRefreshVoices();
        var langTag = ttsResolveLangTag();
        var lo = langTag.toLowerCase();
        var sample = lo.indexOf('zh-hk') === 0 || lo === 'zh-hk'
            ? '收到。'
            : lo.indexOf('zh') === 0
                ? '收到。'
                : 'Ready.';
        ttsEnqueue(sample, langTag);
    }

    // Skip TTS only for this tab's own send echo, not other devices/tabs with the same login
    function shouldSkipOwnTabTts(msg) {
        if (msg.id && _skipTtsMsgIds[msg.id]) return true;
        if (!_pendingOwnSend) return false;
        if (Date.now() - _pendingOwnSend.at > 15000) {
            _pendingOwnSend = null;
            return false;
        }
        if (String(msg.sender_id || '') !== _pendingOwnSend.senderId) return false;
        return ttsMessageText(msg.message) === ttsMessageText(_pendingOwnSend.text);
    }

    function markPendingOwnSend(text) {
        _pendingOwnSend = {
            text:     text,
            senderId: String(myUserId()),
            at:       Date.now()
        };
    }

    function clearPendingOwnSend() {
        _pendingOwnSend = null;
    }

    function registerSkipTtsId(id) {
        if (!id) return;
        _skipTtsMsgIds[id] = true;
        setTimeout(function () { delete _skipTtsMsgIds[id]; }, 60000);
    }

    // Walkie-talkie: message body only (no sender name), once per message id
    function ttsSpeak(msg) {
        if (!_ttsOn || !ttsSupported()) return;
        if (shouldSkipOwnTabTts(msg)) return;
        if (ttsAlreadySpoken(msg)) return;
        var clean = ttsMessageText(msg.message);
        if (!clean) return;
        ttsMarkSpoken(msg);
        ttsPruneSpokenIds();
        ttsEnqueue(clean, ttsResolveLangTag());
    }

    // Toggle TTS on/off
    function ttsToggle() {
        if (!ttsSupported()) {
            appendSystem('⚠ Text-to-speech is not supported in this browser.');
            return;
        }
        _ttsOn = !_ttsOn;
        ttsSave();
        if (!_ttsOn) {
            try { window.speechSynthesis.cancel(); } catch (e2) {}
            _ttsQueue    = [];
            _ttsSpeaking = false;
            ttsStopResumeWatch();
            closeTtsPopover();
        }
        syncTtsControls();
        appendSystem(_ttsOn
            ? '🔊 Voice reading enabled.'
            : '🔇 Voice reading disabled.');
        if (_ttsOn) ttsPlaySample();
    }

    // Apply a tone preset choice
    function ttsSetTone(key) {
        _ttsToneKey = key;
        ttsClearPinnedVoice();
        ttsSave();
        syncTtsControls();
        if (_ttsOn) {
            var tone = ttsCurrentTone();
            appendSystem('🎭 Tone: ' + tone.icon + ' ' + tone.label);
        }
    }

    // Apply a voice key choice from the picker
    function ttsSetVoice(key) {
        _ttsVoiceKey = key;
        ttsClearPinnedVoice();
        ttsSave();
        syncTtsControls();
        closeTtsPopover();
        if (_ttsOn) {
            var v = null;
            for (var i = 0; i < TTS_VOICES.length; i++) {
                if (TTS_VOICES[i].key === key) { v = TTS_VOICES[i]; break; }
            }
            appendSystem('🔊 Voice: ' + (v ? v.label : key));
        }
    }

    // Voice popover open / close
    function openTtsPopover() {
        var pop  = g('bcTtsPopover');
        var pill = g('bcTtsVoicePill');
        if (!pop || !pill) return;
        var rect = pill.getBoundingClientRect();
        pop.style.top   = (rect.bottom + 5) + 'px';
        pop.style.right = (window.innerWidth - rect.right) + 'px';
        pop.style.left  = 'auto';
        pop.style.display = 'block';
        // mark active option
        pop.querySelectorAll('.bc-voice-opt').forEach(function (btn) {
            btn.classList.toggle('bc-voice-opt-active', btn.dataset.key === _ttsVoiceKey);
        });
    }

    function closeTtsPopover() {
        var pop = g('bcTtsPopover');
        if (pop) pop.style.display = 'none';
    }

    // Sync all TTS UI elements to current state
    function syncTtsControls() {
        var btn  = g('bcTtsBtn');
        var pill = g('bcTtsVoicePill');

        if (btn) {
            if (!ttsSupported()) {
                btn.disabled = true;
                btn.textContent = '🚫';
                btn.title = 'TTS not supported in this browser';
            } else {
                btn.disabled = false;
                btn.classList.toggle('bc-tts-active', _ttsOn);
                btn.textContent = _ttsOn ? '🔊' : '🔇';
                btn.title = _ttsOn ? 'Voice ON — click to mute' : 'Voice OFF — click to enable';
            }
        }

        if (pill) {
            var v = null;
            for (var i = 0; i < TTS_VOICES.length; i++) {
                if (TTS_VOICES[i].key === _ttsVoiceKey) { v = TTS_VOICES[i]; break; }
            }
            var tone = ttsCurrentTone();
            pill.textContent = (v ? v.label : 'Auto') + '\u00A0' + tone.icon + ' ▾';
            pill.style.display = (_ttsOn && ttsSupported()) ? 'inline-flex' : 'none';
        }

        // Sync tone buttons inside the popover (if already built)
        var pop = g('bcTtsPopover');
        if (pop) {
            pop.querySelectorAll('.bc-tone-btn').forEach(function (btn2) {
                btn2.classList.toggle('bc-tone-active', btn2.dataset.toneKey === _ttsToneKey);
            });
            pop.querySelectorAll('.bc-voice-opt').forEach(function (btn3) {
                btn3.classList.toggle('bc-voice-opt-active', btn3.dataset.key === _ttsVoiceKey);
            });
        }
    }

    // ── Supabase Realtime subscription ────────────────────────
    function unsubscribeRealtime() {
        if (!_channel || typeof SB === 'undefined') return;
        try {
            SB.removeChannel(_channel);
        } catch (e) {}
        _channel = null;
    }

    function subscribeRealtime() {
        if (typeof SB === 'undefined') return;
        if (_channel) return;

        _channel = SB.channel('joyful_bc_broadcast_feed')
            .on('postgres_changes', {
                event:  'INSERT',
                schema: 'public',
                table:  BC_TABLE
            }, function (payload) {
                var msg = payload.new;
                if (!msg) return;
                var clinicId = myClinicId();
                if (msg.clinic_id && msg.clinic_id !== clinicId) return;
                appendMsg(msg, true);
                ttsSpeak(msg);
                if (!_open || _minimized) {
                    _unread++;
                    updateBadge();
                }
            })
            .subscribe();
    }

    // ── unread badge + minimised-window star alert ────────────
    function updateBadge() {
        var badge   = g('bcUnreadBadge');
        var trigBtn = g('bcTriggerBtn');
        var win     = g('bcWindow');
        var starBadge = g('bcStarBadge');
        var starCount = g('bcStarCount');

        if (badge && trigBtn) {
            if (_unread > 0) {
                badge.textContent   = _unread > 99 ? '99+' : String(_unread);
                badge.style.display = 'flex';
                trigBtn.classList.add('bc-has-unread');
            } else {
                badge.style.display = 'none';
                trigBtn.classList.remove('bc-has-unread');
            }
        }

        // minimised-window star alert
        if (win && _minimized) {
            if (_unread > 0) {
                win.classList.add('bc-min-alert');
                if (starBadge) starBadge.style.display = 'flex';
                if (starCount) starCount.textContent = _unread > 99 ? '99+' : String(_unread);
            } else {
                win.classList.remove('bc-min-alert');
                if (starBadge) starBadge.style.display = 'none';
            }
        } else if (win) {
            win.classList.remove('bc-min-alert');
            if (starBadge) starBadge.style.display = 'none';
        }
    }

    // ── scope / colour UI sync ────────────────────────────────
    function syncScope() {
        var bC = g('bcScopeClinic');
        var bG = g('bcScopeGlobal');
        if (bC) bC.classList.toggle('bc-scope-active', _scope === 'clinic');
        if (bG) bG.classList.toggle('bc-scope-active', _scope === 'global');
    }

    function syncColor() {
        var row = g('bcColorRow');
        if (row) {
            row.querySelectorAll('.bc-color-swatch').forEach(function (sw) {
                sw.classList.toggle('bc-color-active', sw.dataset.color === _color);
            });
        }
        var inp = g('bcInput');
        if (inp) inp.style.color = _color;
    }

    // ── send ──────────────────────────────────────────────────
    function sendMessage() {
        if (typeof SB === 'undefined') return;
        var inp = g('bcInput');
        if (!inp) return;
        var text = inp.value.trim();
        if (!text) return;
        if (text.length > BC_CHAR_LIM) text = text.slice(0, BC_CHAR_LIM);

        var clinicId = myClinicId();
        var payload  = {
            sender_id:   String(myUserId()),
            sender_name: String(myName()),
            sender_role: String(myRole()),
            message:     text,
            msg_color:   _color,
            clinic_id:   (_scope === 'global') ? null : clinicId,
            created_at:  new Date().toISOString()
        };

        var btn = g('bcSendBtn');
        if (btn) btn.disabled = true;
        markPendingOwnSend(text);

        SB.from(BC_TABLE).insert([payload]).select('id').then(function (res) {
            if (btn) btn.disabled = false;
            clearPendingOwnSend();
            if (res.error) {
                appendSystem('⚠ Send failed: ' + res.error.message);
                return;
            }
            if (res.data && res.data[0] && res.data[0].id) {
                registerSkipTtsId(res.data[0].id);
            }
            inp.value = '';
            inp.style.height = '';
        });
    }

    // ── open / close / minimise ───────────────────────────────
    function openWindow() {
        if (!_built) buildAll();
        var win = g('bcWindow');
        if (!win) return;
        win.style.display = 'flex';
        win.classList.add('bc-entering');
        win.classList.remove('bc-min-alert');
        setTimeout(function () { win.classList.remove('bc-entering'); }, 320);
        _open      = true;
        _minimized = false;
        win.classList.remove('bc-minimized');
        var minBtn = g('bcMinBtn');
        if (minBtn) minBtn.textContent = '▼';
        _unread  = 0;
        updateBadge();
        loadHistory();
        if (!_channel) subscribeRealtime();
        syncScope();
        syncColor();
        setTimeout(function () { var inp = g('bcInput'); if (inp) inp.focus(); }, 180);
    }

    function closeWindow() {
        var win = g('bcWindow');
        if (win) win.style.display = 'none';
        _open = false;
    }

    function toggleWindow() {
        if (_open) closeWindow(); else openWindow();
    }

    function minimizeWindow() {
        var win = g('bcWindow');
        if (!win) return;
        _minimized = !_minimized;
        win.classList.toggle('bc-minimized', _minimized);
        var btn = g('bcMinBtn');
        if (btn) btn.textContent = _minimized ? '▲' : '▼';
        if (!_minimized) {
            // restoring — clear alert and mark messages as seen
            win.classList.remove('bc-min-alert');
            _unread = 0;
            updateBadge();
            var feed = g('bcFeed');
            if (feed) feed.scrollTop = feed.scrollHeight;
        }
    }

    // ── build all DOM ─────────────────────────────────────────
    function buildAll() {
        if (_built) return;
        _built = true;

        // ── floating trigger button ───────────────────────────
        var trigBtn = document.createElement('button');
        trigBtn.type = 'button';
        trigBtn.id   = 'bcTriggerBtn';
        trigBtn.className = 'bc-trigger-btn';
        trigBtn.setAttribute('aria-label', 'Broadcast Chat');
        trigBtn.setAttribute('title', 'Broadcast Chat  (Ctrl+Shift+B)');
        trigBtn.innerHTML = '📢<span id="bcUnreadBadge" class="bc-unread-badge" style="display:none">0</span>';
        trigBtn.addEventListener('click', toggleWindow);
        document.body.appendChild(trigBtn);

        // ── main chat window ──────────────────────────────────
        var win = document.createElement('div');
        win.id        = 'bcWindow';
        win.className = 'bc-window';
        win.style.display = 'none';
        win.setAttribute('role', 'complementary');
        win.setAttribute('aria-label', 'Broadcast Chat');

        // ── header ────────────────────────────────────────────
        var hdr = document.createElement('div');
        hdr.id        = 'bcHeader';
        hdr.className = 'bc-header';

        var icon = document.createElement('span');
        icon.className   = 'bc-header-icon';
        icon.textContent = '📢';

        var title = document.createElement('span');
        title.className   = 'bc-header-title';
        title.textContent = 'BROADCAST';

        // scope toggle group
        var scopeWrap = document.createElement('div');
        scopeWrap.className = 'bc-scope-toggle';

        var btnC = document.createElement('button');
        btnC.type = 'button'; btnC.id = 'bcScopeClinic';
        btnC.className = 'bc-scope-btn bc-scope-active';
        btnC.dataset.scope = 'clinic';
        btnC.textContent = '🏥 Clinic';
        btnC.addEventListener('click', function () { _scope = 'clinic'; syncScope(); });

        var btnG = document.createElement('button');
        btnG.type = 'button'; btnG.id = 'bcScopeGlobal';
        btnG.className = 'bc-scope-btn';
        btnG.dataset.scope = 'global';
        btnG.textContent = '🌐 All';
        btnG.addEventListener('click', function () { _scope = 'global'; syncScope(); });

        scopeWrap.appendChild(btnC);
        scopeWrap.appendChild(btnG);

        // minimise button
        var minBtn = document.createElement('button');
        minBtn.type = 'button'; minBtn.id = 'bcMinBtn';
        minBtn.className = 'bc-min-btn';
        minBtn.setAttribute('aria-label', 'Minimise');
        minBtn.textContent = '▼';
        minBtn.addEventListener('click', function (e) { e.stopPropagation(); minimizeWindow(); });

        // TTS toggle button
        var ttsBtn = document.createElement('button');
        ttsBtn.type = 'button';
        ttsBtn.id   = 'bcTtsBtn';
        ttsBtn.className = 'bc-tts-btn';
        ttsBtn.textContent = _ttsOn ? '🔊' : '🔇';
        ttsBtn.title = _ttsOn ? 'Voice reading ON — click to mute' : 'Voice reading OFF — click to enable';
        ttsBtn.setAttribute('aria-label', 'Toggle voice reading');
        ttsBtn.addEventListener('click', function (e) { e.stopPropagation(); ttsToggle(); });
        if (!ttsSupported()) { ttsBtn.disabled = true; ttsBtn.textContent = '🚫'; ttsBtn.title = 'TTS not supported'; }

        // Voice language picker pill (shown next to TTS button when TTS is on)
        var ttsPill = document.createElement('button');
        ttsPill.type      = 'button';
        ttsPill.id        = 'bcTtsVoicePill';
        ttsPill.className = 'bc-tts-pill';
        ttsPill.style.display = 'none';
        ttsPill.textContent   = 'Auto ▾';
        ttsPill.title         = 'Choose voice language';
        ttsPill.addEventListener('click', function (e) {
            e.stopPropagation();
            var pop = g('bcTtsPopover');
            if (pop && pop.style.display !== 'none') closeTtsPopover();
            else openTtsPopover();
        });

        // Floating popover with voice options (appended to body so it's not clipped)
        var ttsPopover = document.createElement('div');
        ttsPopover.id        = 'bcTtsPopover';
        ttsPopover.className = 'bc-tts-popover';
        ttsPopover.style.display = 'none';
        TTS_VOICES.forEach(function (vo) {
            var opt = document.createElement('button');
            opt.type      = 'button';
            opt.className = 'bc-voice-opt' + (vo.key === _ttsVoiceKey ? ' bc-voice-opt-active' : '');
            opt.dataset.key = vo.key;

            // flag / icon column
            var flagMap = { auto: '🌐', en: '🇬🇧', yue: '🇭🇰', cmn: '🇨🇳' };
            opt.innerHTML =
                '<span class="bc-voice-flag">' + (flagMap[vo.key] || '') + '</span>' +
                '<span class="bc-voice-name">' + vo.label + '</span>' +
                (vo.key === 'auto'
                    ? '<span class="bc-voice-hint">follows app UI language</span>'
                    : vo.key === 'en'
                        ? '<span class="bc-voice-hint">English voice only</span>'
                        : vo.key === 'yue'
                            ? '<span class="bc-voice-hint">廣東話 voice only</span>'
                            : '<span class="bc-voice-hint">普通話 voice only</span>');
            opt.addEventListener('click', function (e) {
                e.stopPropagation();
                ttsSetVoice(vo.key);
            });
            ttsPopover.appendChild(opt);
        });
        // ── Tone preset section ──────────────────────────────
        var toneDivider = document.createElement('div');
        toneDivider.className = 'bc-pop-divider';
        ttsPopover.appendChild(toneDivider);

        var toneHdr = document.createElement('div');
        toneHdr.className   = 'bc-pop-section-hdr';
        toneHdr.textContent = '🎭 Character Tone';
        ttsPopover.appendChild(toneHdr);

        var toneGrid = document.createElement('div');
        toneGrid.className = 'bc-tone-grid';
        TTS_TONES.forEach(function (tone) {
            var tb = document.createElement('button');
            tb.type = 'button';
            tb.className = 'bc-tone-btn' + (tone.key === _ttsToneKey ? ' bc-tone-active' : '');
            tb.dataset.toneKey = tone.key;
            tb.title = tone.label
                + '\u2002rate ' + tone.rate + '\u00B7pitch ' + tone.pitch
                + (tone.key === 'whisper' ? '\u00B7vol ' + tone.vol : '');
            tb.innerHTML =
                '<span class="bc-tone-icon">' + tone.icon + '</span>' +
                '<span class="bc-tone-label">' + tone.label + '</span>';
            tb.addEventListener('click', function (e) {
                e.stopPropagation();
                ttsSetTone(tone.key);
            });
            toneGrid.appendChild(tb);
        });
        ttsPopover.appendChild(toneGrid);

        document.body.appendChild(ttsPopover);

        // Close popover on outside click
        document.addEventListener('click', function () { closeTtsPopover(); });

        // close button
        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'bc-close-btn';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '✕';
        closeBtn.addEventListener('click', function (e) { e.stopPropagation(); closeWindow(); });

        // star badge (shown only when minimised + unread)
        var starBadge = document.createElement('span');
        starBadge.id        = 'bcStarBadge';
        starBadge.className = 'bc-new-star-badge';
        starBadge.style.display = 'none';
        starBadge.innerHTML =
            '✨ NEW <span id="bcStarCount" class="bc-star-count">0</span>';

        hdr.appendChild(icon);
        hdr.appendChild(title);
        hdr.appendChild(starBadge);
        hdr.appendChild(scopeWrap);
        hdr.appendChild(ttsPill);
        hdr.appendChild(ttsBtn);
        hdr.appendChild(minBtn);
        hdr.appendChild(closeBtn);

        // ── drag ──────────────────────────────────────────────
        hdr.addEventListener('mousedown', function (e) {
            if (e.target.tagName === 'BUTTON') return;
            _dragging = true;
            var rect  = win.getBoundingClientRect();
            _dragOffX = e.clientX - rect.left;
            _dragOffY = e.clientY - rect.top;
            win.style.transition = 'none';
            e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
            if (!_dragging) return;
            var nx = Math.max(0, Math.min(e.clientX - _dragOffX, window.innerWidth  - win.offsetWidth));
            var ny = Math.max(0, Math.min(e.clientY - _dragOffY, window.innerHeight - win.offsetHeight));
            win.style.left   = nx + 'px';
            win.style.top    = ny + 'px';
            win.style.right  = 'auto';
            win.style.bottom = 'auto';
        });
        document.addEventListener('mouseup', function () {
            if (_dragging) { _dragging = false; win.style.transition = ''; }
        });

        // ── feed area ─────────────────────────────────────────
        var feed = document.createElement('div');
        feed.id        = 'bcFeed';
        feed.className = 'bc-feed';
        var empty = document.createElement('div');
        empty.className   = 'bc-feed-empty';
        empty.textContent = '— No messages yet. Be the first to say hello! —';
        feed.appendChild(empty);

        // ── compose area ──────────────────────────────────────
        var compose = document.createElement('div');
        compose.className = 'bc-compose';

        // emoji row
        var emojiRow = document.createElement('div');
        emojiRow.className = 'bc-emoji-row';
        EMOJIS.forEach(function (em) {
            var btn = document.createElement('button');
            btn.type      = 'button';
            btn.className = 'bc-emoji-btn';
            btn.textContent = em;
            btn.title       = em;
            btn.addEventListener('click', function () {
                var inp = g('bcInput');
                if (!inp) return;
                var pos = inp.selectionStart != null ? inp.selectionStart : inp.value.length;
                inp.value = inp.value.slice(0, pos) + em + inp.value.slice(pos);
                inp.focus();
                var np = pos + em.length;
                try { inp.setSelectionRange(np, np); } catch (e) {}
            });
            emojiRow.appendChild(btn);
        });

        // colour row
        var colorRow = document.createElement('div');
        colorRow.id        = 'bcColorRow';
        colorRow.className = 'bc-color-row';
        var colorLbl = document.createElement('span');
        colorLbl.className   = 'bc-color-label';
        colorLbl.textContent = 'Text colour:';
        colorRow.appendChild(colorLbl);
        COLORS.forEach(function (c) {
            var sw = document.createElement('button');
            sw.type           = 'button';
            sw.className      = 'bc-color-swatch' + (c.hex === _color ? ' bc-color-active' : '');
            sw.style.background = c.hex;
            sw.dataset.color  = c.hex;
            sw.title          = c.name;
            sw.addEventListener('click', function () { _color = c.hex; syncColor(); });
            colorRow.appendChild(sw);
        });

        // input + send row
        var inputRow = document.createElement('div');
        inputRow.className = 'bc-input-row';

        var textarea = document.createElement('textarea');
        textarea.id          = 'bcInput';
        textarea.className   = 'bc-input';
        textarea.placeholder = 'Type a message… (Enter ⚡ send, Shift+Enter new line)';
        textarea.rows        = 2;
        textarea.maxLength   = BC_CHAR_LIM;
        textarea.style.color = _color;
        textarea.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        textarea.addEventListener('input', function () {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 68) + 'px';
        });

        var sendBtn = document.createElement('button');
        sendBtn.type      = 'button';
        sendBtn.id        = 'bcSendBtn';
        sendBtn.className = 'bc-send-btn';
        sendBtn.innerHTML = '⚡&thinsp;Send';
        sendBtn.addEventListener('click', sendMessage);

        inputRow.appendChild(textarea);
        inputRow.appendChild(sendBtn);

        compose.appendChild(emojiRow);
        compose.appendChild(colorRow);
        compose.appendChild(inputRow);

        win.appendChild(hdr);
        win.appendChild(feed);
        win.appendChild(compose);
        document.body.appendChild(win);
    }

    // ── visibility sync with login state ──────────────────────
    function syncVisibility() {
        var loginEl   = g('loginOverlay');
        var isLogin   = loginEl && loginEl.style.display !== 'none';
        var trigBtn   = g('bcTriggerBtn');
        if (trigBtn) trigBtn.style.display = isLogin ? 'none' : 'flex';
        if (isLogin && _open) closeWindow();
    }

    // ── keyboard shortcut Ctrl+Shift+B ────────────────────────
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
            if (e.key === 'B' || e.key === 'b') {
                var loginEl = g('loginOverlay');
                if (loginEl && loginEl.style.display !== 'none') return;
                e.preventDefault();
                e.stopPropagation();
                toggleWindow();
            }
        }
    }, true);

    // ── init ──────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', function () {
        ttsLoad();
        ttsBindVoices();
        setTimeout(function () {
            buildAll();
            syncTtsControls();
            subscribeRealtime();
            syncVisibility();
        }, 250);
    });

    document.addEventListener('app-session-sync', function () {
        syncVisibility();
        // re-subscribe if channel was lost
        if (!_channel) subscribeRealtime();
    });

    // ── public API ────────────────────────────────────────────
    var _api = {
        open:   openWindow,
        close:  closeWindow,
        toggle: toggleWindow
    };
    window.__JOYFUL_BC_INST__ = _api;
    return _api;

})();

window.openBroadcastWindow   = BROADCAST.open;
window.closeBroadcastWindow  = BROADCAST.close;
window.toggleBroadcastWindow = BROADCAST.toggle;
