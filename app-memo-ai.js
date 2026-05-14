// ════════════════════════════════════════════════════════════════
// MEMO CARDS — local sticky-note library + shared AI polish pipeline
// ════════════════════════════════════════════════════════════════

var MEMO_AI = MEMO_AI || {};

(function(ns) {

    var LS_KEY = 'joyful_memo_cards_v1';

    var _cards = [];
    var _selectedId = null;
    var _saveTimer = null;

    function gmem(id) { return typeof g !== 'undefined' ? g(id) : document.getElementById(id); }

    function isoNow() { return new Date().toISOString(); }

    function genId() {
        return 'm_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 99999).toString(36);
    }

    function clinicTitleMemo() {
        return (typeof currentClinicLabel === 'string' && currentClinicLabel.trim())
            ? currentClinicLabel.trim()
            : 'Joyful Smile Clinic';
    }

    function callerPayloadBase() {
        var uid =
            typeof currentUserId !== 'undefined' && currentUserId
                ? String(currentUserId).trim()
                : '';
        var cid =
            typeof currentClinicId !== 'undefined' && currentClinicId
                ? String(currentClinicId).trim()
                : '';
        return {
            callerUserId: uid,
            callerClinicId: cid
        };
    }

    function flattenPayload(baseFields) {
        var c = callerPayloadBase();
        var o = {};
        Object.keys(baseFields).forEach(function(k) { o[k] = baseFields[k]; });
        o.callerUserId = c.callerUserId;
        o.callerClinicId = c.callerClinicId;
        return o;
    }

    function starterCards() {
        return [
            {
                id: genId(),
                title: 'End-of-shift checklist',
                body: '- Restock pamphlets.\n- Check tomorrow’s first-chair setup.\n- Log handpiece steriliser cycle.',
                updatedAt: isoNow(),
                hue: '#e0ecff'
            },
            {
                id: genId(),
                title: 'Insurance wording (gentle)',
                body: 'We’re happy to help with claim forms — please bring both your HKID copy and insurer card snapshot so we fill the payer box correctly.',
                updatedAt: isoNow(),
                hue: '#dcfcee'
            },
            {
                id: genId(),
                title: 'Patient running late?',
                body: 'Hi team — ring once, offer reschedule after 15 minutes, note reason in diary comment.',
                updatedAt: isoNow(),
                hue: '#fff7d6'
            }
        ];
    }

    function loadStore() {
        try {
            var raw = localStorage.getItem(LS_KEY);
            if (!raw) {
                _cards = starterCards();
                persist();
                return;
            }
            var j = JSON.parse(raw);
            if (!Array.isArray(j) || !j.length) {
                _cards = starterCards();
                persist();
                return;
            }
            _cards = j.map(normalizeCard);
        } catch (e) {
            _cards = starterCards();
            persist();
        }
    }

    function normalizeCard(c) {
        return {
            id: c.id || genId(),
            title: String(c.title || '').trim() || 'Untitled memo',
            body: String(c.body || ''),
            updatedAt: c.updatedAt || isoNow(),
            hue: c.hue || '#f1f5f9'
        };
    }

    function persist() {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(_cards));
        } catch (e) {}
    }

    function sortCards() {
        _cards.sort(function(a, b) {
            return String(b.updatedAt).localeCompare(String(a.updatedAt));
        });
    }

    function demoMemoAssist(action, title, body, custom) {
        var t = (body || '').trim();
        if (!t && action !== 'shorten')
            return '(Demo) Nothing to reshape yet — jot a memo first.';
        var act = action || 'polish';
        if (act === 'shorten') {
            if (t.length <= 260) return t;
            return t.slice(0, 258).replace(/\s+\S*$/, '') + '…';
        }
        if (act === 'bulletize' || act === 'bullets') {
            var lines = t.split(/\s*\n+/).filter(Boolean);
            if (!lines.length) lines = [t];
            return lines.map(function(l) {
                var s = String(l || '').trim();
                if (!s.length) return '';
                return (/^[•\-*]/.test(s) ? s : '• ' + s.replace(/^[-•]+\s*/, ''));
            }).filter(Boolean).join('\n');
        }
        if (act === 'custom' && custom) return t + '\n\n[Tweak — demo] ' + custom;
        return t + '\n\n[Demo polish] Link Supabase ai-patient-draft for full AI rewrite.';
    }

    ns.init = function() {
        loadStore();
        sortCards();
        if (!_cards.length) {
            _cards = starterCards();
            persist();
            sortCards();
        }
        if (!_selectedId || !_cards.some(function(x) { return x.id === _selectedId; })) {
            _selectedId = _cards[0].id;
        }
        attachListenersOnce();
        renderList();
        loadEditor();
    };

    var _wired = false;
    function attachListenersOnce() {
        if (_wired) return;
        _wired = true;
        var t = gmem('memoEditTitle');
        var b = gmem('memoEditBody');
        if (t) t.addEventListener('input', scheduleSave);
        if (b) b.addEventListener('input', scheduleSave);
    }

    function scheduleSave() {
        if (!_selectedId) return;
        clearTimeout(_saveTimer);
        _saveTimer = setTimeout(function() {
            saveCurrentQuiet(true);
        }, 450);
    }

    function getCurrentDraft() {
        return {
            title: (gmem('memoEditTitle') && String(gmem('memoEditTitle').value)) || '',
            body: (gmem('memoEditBody') && String(gmem('memoEditBody').value)) || ''
        };
    }

    function saveCurrentQuiet(skipRenderHighlight) {
        if (!_selectedId) return;
        var d = getCurrentDraft();
        var ix = _cards.findIndex(function(c) { return c.id === _selectedId; });
        if (ix < 0) return;
        var row = _cards[ix];
        row.title = d.title.trim() || 'Untitled memo';
        row.body = d.body;
        row.updatedAt = isoNow();
        persist();
        sortCards();
        if (!skipRenderHighlight) renderList();
        else refreshListTexts();
    }

    function refreshListTexts() {
        var host = gmem('memoCardList');
        if (!host) return;
        _cards.forEach(function(c) {
            var sub = host.querySelector('[data-memo-sub="' + c.id + '"]');
            if (sub) {
                sub.textContent = formatShortTime(c.updatedAt)
                    ? 'Updated ' + formatShortTime(c.updatedAt)
                    : '';
            }
            var tit = host.querySelector('[data-memo-title="' + c.id + '"]');
            if (tit) {
                var snip =
                    String(c.title || '').trim() ||
                    String(c.body || '').replace(/\s+/g, ' ').slice(0, 52) ||
                    '(empty)';
                tit.textContent = snip;
            }
        });
    }

    function formatShortTime(iso) {
        if (!iso) return '';
        try {
            var d = new Date(iso);
            return d.toLocaleString('en-HK', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } catch (e) {
            return '';
        }
    }

    function renderList() {
        var host = gmem('memoCardList');
        if (!host) return;
        host.innerHTML = '';
        sortCards();
        _cards.forEach(function(c) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'memo-picker' + (c.id === _selectedId ? ' memo-picker-active' : '');
            btn.setAttribute('data-memo-id', c.id);
            var snip =
                String(c.title || '').trim() ||
                String(c.body || '').replace(/\s+/g, ' ').slice(0, 52) ||
                '(empty)';
            btn.style.borderLeft = '4px solid ' + (c.hue || '#cbd5e1');
            btn.innerHTML =
                '<span class="memo-picker-title" data-memo-title="' + c.id + '">' +
                escHtml(snip) + '</span>' +
                '<span class="memo-picker-meta" data-memo-sub="' + c.id + '">' +
                (formatShortTime(c.updatedAt)
                    ? 'Updated ' + formatShortTime(c.updatedAt)
                    : '') +
                '</span>';
            btn.addEventListener('click', function() {
                saveCurrentQuiet(true);
                _selectedId = c.id;
                renderList();
                loadEditor();
            });
            host.appendChild(btn);
        });
    }

    function escHtml(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function loadEditor() {
        var row = _cards.find(function(c) { return c.id === _selectedId; });
        var tt = gmem('memoEditTitle');
        var bb = gmem('memoEditBody');
        if (!row) {
            if (tt) tt.value = '';
            if (bb) bb.value = '';
            return;
        }
        if (tt) tt.value = row.title === 'Untitled memo' ? '' : row.title;
        if (bb) bb.value = row.body;
        var hue = gmem('memoHue');
        if (hue) hue.value = row.hue || '#f1f5f9';
    }

    ns.newMemo = function() {
        saveCurrentQuiet(true);
        var c = normalizeCard({
            id: genId(),
            title: 'Untitled memo',
            body: '',
            hue: '#f8fafc',
            updatedAt: isoNow()
        });
        _cards.unshift(c);
        _selectedId = c.id;
        persist();
        sortCards();
        renderList();
        loadEditor();
    };

    ns.deleteMemo = function() {
        if (!_selectedId || _cards.length < 2) {
            alert('Keep at least one memo card.');
            return;
        }
        if (!confirm('Delete this memo card?')) return;
        var id = _selectedId;
        _cards = _cards.filter(function(c) { return c.id !== id; });
        _selectedId = _cards[0].id;
        persist();
        renderList();
        loadEditor();
    };

    ns.duplicateMemo = function() {
        saveCurrentQuiet(true);
        var src = _cards.find(function(c) { return c.id === _selectedId; });
        if (!src) return;
        var c = normalizeCard({
            id: genId(),
            title: src.title === 'Untitled memo' ? 'Copy' : ('Copy · ' + src.title),
            body: src.body,
            hue: src.hue || '#f1f5f9'
        });
        _cards.unshift(c);
        _selectedId = c.id;
        persist();
        sortCards();
        renderList();
        loadEditor();
    };

    ns.saveMemoNow = function() {
        saveCurrentQuiet(false);
    };

    ns.updateHueFromPicker = function() {
        saveCurrentQuiet(true);
        var row = _cards.find(function(c) { return c.id === _selectedId; });
        var hueEl = gmem('memoHue');
        if (!row || !hueEl) return;
        row.hue = hueEl.value || '#f1f5f9';
        row.updatedAt = isoNow();
        persist();
        sortCards();
        renderList();
    };

    ns.applyAiAssist = function() {
        if (typeof AIHELPER === 'undefined' ||
            typeof AIHELPER.invokeAiPipeline !== 'function') {
            alert('AI helpers are still loading.');
            return;
        }
        saveCurrentQuiet(true);
        var d = getCurrentDraft();
        var actEl = gmem('memoAssistAction');
        var custEl = gmem('memoAssistCustom');
        var action = actEl ? actEl.value : 'polish';
        var customInst = custEl ? String(custEl.value || '').trim() : '';
        var st = gmem('memoAssistStatus');

        var title = String(d.title || '').trim() || 'Untitled memo';
        var body = String(d.body || '');

        var payload = flattenPayload({
            workflow: 'memo',
            memoAction: action,
            memoCustomInstruction: customInst,
            memoTitle: title,
            memoBody: body,
            clinicName: clinicTitleMemo(),
            patientFirstName: '',
            patientLanguageHint: 'en-HK',
            tone: '',
            recallKind: null,
            dobDisplay: '',
            userPrompt: ''
        });

        var btn = gmem('memoAssistApply');
        if (btn) btn.disabled = true;

        var fallback = function() {
            return demoMemoAssist(action, title, body, customInst);
        };

        AIHELPER.invokeAiPipeline(payload, fallback)
            .then(function(r) {
                var bb = gmem('memoEditBody');
                if (bb) bb.value = String(r.text || '');
                scheduleSave();
                var ban = AIHELPER.composeAiBanner(r.origin);
                if (st) st.textContent = ban;
                if (btn) btn.disabled = false;
            })
            .catch(function() {
                if (st) st.textContent = 'Could not run AI.';
                if (btn) btn.disabled = false;
            });
    };

})(MEMO_AI);
