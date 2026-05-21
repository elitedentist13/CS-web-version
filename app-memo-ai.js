// ════════════════════════════════════════════════════════════════
// MEMO CARDS — local sticky-note library + shared AI polish pipeline
// ════════════════════════════════════════════════════════════════

var MEMO_AI = MEMO_AI || {};

(function(ns) {

    var LS_KEY = 'joyful_memo_cards_v1';

    var _cards = [];
    var _selectedId = null;
    var _saveTimer = null;

    /** Dashboard mini-stickies */
    var STICKY_W = 172;
    var STICKY_H = 140;
    var _stickyDockRO = null;
    var _stickyPaintRetryTid = null;
    var _stickyPaintAttempts = 0;

    function gmem(id) { return typeof g !== 'undefined' ? g(id) : document.getElementById(id); }

    function memoTr(key) {
        return typeof t === 'function' ? t(key) : key;
    }

    function memoTrRepl(key, pairs) {
        var s = memoTr(key);
        if (pairs) {
            Object.keys(pairs).forEach(function(k) {
                s = s.split('{' + k + '}').join(String(pairs[k]));
            });
        }
        return s;
    }

    var MEMO_UNTITLED_LEGACY = 'Untitled memo';

    function memoNormalizeStoredTitle(title) {
        var tt = String(title || '').trim();
        if (!tt || tt === MEMO_UNTITLED_LEGACY) return '';
        return tt;
    }

    function isMemoUntitled(title) {
        return !memoNormalizeStoredTitle(title);
    }

    function memoTitleForStore(title) {
        return memoNormalizeStoredTitle(title);
    }

    function memoTitleForAi(title) {
        var tt = memoNormalizeStoredTitle(title);
        return tt || memoTr('memo.untitled');
    }

    function memoListSnip(c) {
        if (!isMemoUntitled(c.title)) return String(c.title || '').trim();
        var bodySnip = String(c.body || '').replace(/\s+/g, ' ').slice(0, 52);
        if (bodySnip) return bodySnip;
        return memoTr('memo.untitled');
    }

    function memoDuplicateTitle(srcTitle) {
        if (isMemoUntitled(srcTitle)) return memoTr('memo.copyLabel');
        return memoTrRepl('memo.copyPrefix', { TITLE: srcTitle });
    }

    function memoUpdatedLabel(iso) {
        var ft = formatShortTime(iso);
        return ft ? memoTrRepl('memo.updatedLabel', { TIME: ft }) : '';
    }

    function isoNow() { return new Date().toISOString(); }

    function genId() {
        return 'm_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 99999).toString(36);
    }

    function clinicTitleMemo() {
        return (typeof currentClinicLabel === 'string' && currentClinicLabel.trim())
            ? currentClinicLabel.trim()
            : memoTr('ai.clinicFallback');
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
                title: memoTr('memo.starter1.title'),
                body: memoTr('memo.starter1.body'),
                updatedAt: isoNow(),
                hue: '#e0ecff'
            },
            {
                id: genId(),
                title: memoTr('memo.starter2.title'),
                body: memoTr('memo.starter2.body'),
                updatedAt: isoNow(),
                hue: '#dcfcee'
            },
            {
                id: genId(),
                title: memoTr('memo.starter3.title'),
                body: memoTr('memo.starter3.body'),
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
        var sx = c.stickyX;
        var sy = c.stickyY;
        return {
            id: c.id || genId(),
            title: memoTitleForStore(c.title),
            body: String(c.body || ''),
            updatedAt: c.updatedAt || isoNow(),
            hue: c.hue || '#f1f5f9',
            stickyX: typeof sx === 'number' && !isNaN(sx) ? sx : null,
            stickyY: typeof sy === 'number' && !isNaN(sy) ? sy : null
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
            return memoTr('memo.demo.noBody');
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
        if (act === 'custom' && custom) {
            return t + '\n\n' + memoTrRepl('memo.demo.customSuffix', { TEXT: custom });
        }
        return t + '\n\n' + memoTr('memo.demo.polishSuffix');
    }

    function dashboardVisible() {
        var el = document.getElementById('dashboardSection');
        if (!el) return false;
        try {
            return window.getComputedStyle(el).display !== 'none';
        } catch (e) {
            return el.style.display !== 'none';
        }
    }

    /** Chrome/Blink quirk: inset:0 overlay can compute 0×0 when shell height comes only from min-height */
    function syncStickyDockToShell(dock) {
        var shell = dock.closest && dock.closest('.dashboard-float-shell');
        if (!shell) return;
        var r = shell.getBoundingClientRect();
        var w = Math.round(r.width);
        var h = Math.round(r.height);
        if (w < 40) w = shell.offsetWidth || w;
        if (h < 40) h = shell.offsetHeight || h;
        if (w < 40 || h < 40) return;
        dock.style.position = 'absolute';
        dock.style.left = '0';
        dock.style.top = '0';
        dock.style.right = 'auto';
        dock.style.bottom = 'auto';
        dock.style.width = w + 'px';
        dock.style.height = h + 'px';
        dock.style.boxSizing = 'border-box';
        dock.style.transform = 'translateZ(0)';
    }

    function stickyDockBounds(dock) {
        syncStickyDockToShell(dock);
        var w = dock.clientWidth;
        var h = dock.clientHeight;
        var shell = dock.closest
            ? dock.closest('.dashboard-float-shell')
            : null;
        if (shell && (w < 60 || h < 60)) {
            syncStickyDockToShell(dock);
            w = dock.clientWidth;
            h = dock.clientHeight;
            if (w < 60 || h < 60) {
                w = Math.max(w, shell.clientWidth);
                h = Math.max(h, shell.clientHeight);
            }
        }
        return { w: w, h: h };
    }

    function scheduleStickyDockRepaint(dock) {
        if (_stickyPaintAttempts > 24) return;
        clearTimeout(_stickyPaintRetryTid);
        _stickyPaintAttempts++;
        var delay = _stickyPaintAttempts < 5 ? 70 * _stickyPaintAttempts : 220;
        _stickyPaintRetryTid = setTimeout(function() {
            paintStickyDock(dock);
        }, delay);
    }

    function ensureStickyDockObserver(dock) {
        if (!dock || _stickyDockRO) return;
        var tid = null;
        function debouncedPaint() {
            if (!dashboardVisible()) return;
            clearTimeout(tid);
            tid = setTimeout(function() {
                paintStickyDock(dock);
            }, 60);
        }
        _stickyDockRO = new ResizeObserver(debouncedPaint);
        _stickyDockRO.observe(dock);
        var shell = dock.closest && dock.closest('.dashboard-float-shell');
        if (shell) _stickyDockRO.observe(shell);
    }

    function clampStickyPos(x, y, dw, dh, nw, nh) {
        var maxX = Math.max(0, dw - nw);
        var maxY = Math.max(0, dh - nh);
        return {
            x: Math.min(Math.max(0, x), maxX),
            y: Math.min(Math.max(0, y), maxY)
        };
    }

    function defaultStickyXY(i, dw, dh) {
        var gap = 12;
        var margin = 10;
        var cols = Math.max(1, Math.floor((dw - margin * 2) / (STICKY_W + gap)));
        var col = i % cols;
        var rowFromBottom = Math.floor(i / cols);
        var x = margin + col * (STICKY_W + gap);
        var y = dh - STICKY_H - margin - rowFromBottom * (STICKY_H + gap);
        return clampStickyPos(x, y, dw, dh, STICKY_W, STICKY_H);
    }

    function noteZBoost(note, dock) {
        var maxZ = 10;
        var nodes = dock.querySelectorAll('.memo-sticky-note');
        for (var i = 0; i < nodes.length; i++) {
            var z = parseInt(nodes[i].style.zIndex, 10) || 10;
            if (z > maxZ) maxZ = z;
        }
        note.style.zIndex = String(maxZ + 1);
    }

    function bindStickyDrag(noteEl, dock, cardId) {
        var head = noteEl.querySelector('.memo-sticky-draghead');
        if (!head) return;

        var drag = false;
        var sx = 0;
        var sy = 0;
        var ox = 0;
        var oy = 0;

        function onMove(ev) {
            if (!drag) return;
            var nx = ox + (ev.clientX - sx);
            var ny = oy + (ev.clientY - sy);
            var dw = dock.clientWidth;
            var dh = dock.clientHeight;
            var cl = clampStickyPos(nx, ny, dw, dh, STICKY_W, STICKY_H);
            noteEl.style.left = cl.x + 'px';
            noteEl.style.top = cl.y + 'px';
        }

        function onUp(ev) {
            if (!drag) return;
            drag = false;
            noteEl.classList.remove('memo-sticky-dragging');
            try {
                head.releasePointerCapture(ev.pointerId);
            } catch (e2) {}

            var dw = dock.clientWidth;
            var dh = dock.clientHeight;
            var left = parseFloat(noteEl.style.left) || 0;
            var top = parseFloat(noteEl.style.top) || 0;
            var cl = clampStickyPos(left, top, dw, dh, STICKY_W, STICKY_H);
            noteEl.style.left = cl.x + 'px';
            noteEl.style.top = cl.y + 'px';

            var row = _cards.find(function(c) { return c.id === cardId; });
            if (row) {
                row.stickyX = cl.x;
                row.stickyY = cl.y;
                persist();
            }

            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        }

        head.addEventListener('pointerdown', function(ev) {
            if (ev.button !== 0) return;
            ev.preventDefault();
            noteZBoost(noteEl, dock);
            drag = true;
            noteEl.classList.add('memo-sticky-dragging');
            sx = ev.clientX;
            sy = ev.clientY;
            ox = parseFloat(noteEl.style.left) || 0;
            oy = parseFloat(noteEl.style.top) || 0;
            try {
                head.setPointerCapture(ev.pointerId);
            } catch (e3) {}
            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        });
    }

    function paintStickyDock(dock) {
        ensureStickyDockObserver(dock);

        var box = stickyDockBounds(dock);
        var dw = box.w;
        var dh = box.h;

        if (dw < 60 || dh < 60) {
            scheduleStickyDockRepaint(dock);
            return;
        }

        _stickyPaintAttempts = 0;

        loadStore();
        sortCards();

        var dirty = false;
        _cards.forEach(function(c, i) {
            if (c.stickyX == null || c.stickyY == null ||
                    typeof c.stickyX !== 'number' || typeof c.stickyY !== 'number') {
                var d0 = defaultStickyXY(i, dw, dh);
                c.stickyX = d0.x;
                c.stickyY = d0.y;
                dirty = true;
            } else {
                var cl = clampStickyPos(c.stickyX, c.stickyY, dw, dh, STICKY_W, STICKY_H);
                if (cl.x !== c.stickyX || cl.y !== c.stickyY) {
                    c.stickyX = cl.x;
                    c.stickyY = cl.y;
                    dirty = true;
                }
            }
        });
        if (dirty) persist();

        dock.innerHTML = '';
        var zBase = 10;
        _cards.forEach(function(c, idx) {
            var note = document.createElement('div');
            note.className = 'memo-sticky-note';
            note.style.width = STICKY_W + 'px';
            note.style.height = STICKY_H + 'px';
            note.style.left = c.stickyX + 'px';
            note.style.top = c.stickyY + 'px';
            note.style.zIndex = String(zBase + idx);
            note.style.borderLeftColor = c.hue || '#cbd5e1';

            var head = document.createElement('div');
            head.className = 'memo-sticky-draghead';
            var tit = isMemoUntitled(c.title)
                ? memoTr('memo.untitledShort')
                : c.title;
            head.innerHTML =
                '<span class="memo-sticky-drag-grip" aria-hidden="true"></span>' +
                '<span class="memo-sticky-head-title">' +
                escHtml(String(tit).slice(0, 40)) + '</span>';

            var body = document.createElement('div');
            body.className = 'memo-sticky-mini-body';
            var preview =
                String(c.body || '').replace(/\s+/g, ' ').trim().slice(0, 220) ||
                memoTr('memo.emptySticky');
            body.textContent = preview;

            note.appendChild(head);
            note.appendChild(body);

            note.addEventListener('dblclick', function(ev) {
                ev.stopPropagation();
                ns.openMemoEditorForId(c.id);
            });

            bindStickyDrag(note, dock, c.id);
            dock.appendChild(note);
        });
    }


    function maybeRefreshDashStickies() {
        if (dashboardVisible()) ns.refreshDashboardStickies();
    }

    ns.refreshDashboardStickies = function() {
        var dock = gmem('memoStickyDock');
        if (!dock || !_cards.length) return;
        _stickyPaintAttempts = 0;
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                    paintStickyDock(dock);
                });
            });
        });
    };

    ns.openMemoEditorForId = function(id) {
        if (!id) return;
        var memoSec = document.getElementById('memoCardsSection');
        if (memoSec && memoSec.style.display !== 'none') {
            saveCurrentQuiet(true);
        }
        loadStore();
        if (!_cards.some(function(x) { return x.id === id; })) return;
        _selectedId = id;
        if (typeof showOnly === 'function') {
            showOnly('memoCardsSection');
        }
        ns.init();
    };

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
        row.title = memoTitleForStore(d.title);
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
                sub.textContent = memoUpdatedLabel(c.updatedAt);
            }
            var tit = host.querySelector('[data-memo-title="' + c.id + '"]');
            if (tit) tit.textContent = memoListSnip(c);
        });
    }

    function memoUiLocale() {
        if (typeof appUiLocale === 'function') return appUiLocale();
        if (typeof appUiLang === 'string' && appUiLang.indexOf('Hant') >= 0) return 'zh-HK';
        if (typeof appUiLang === 'string' && appUiLang.indexOf('CN') >= 0) return 'zh-CN';
        return 'en-HK';
    }

    function formatShortTime(iso) {
        if (!iso) return '';
        try {
            var d = new Date(iso);
            return d.toLocaleString(memoUiLocale(), {
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
            var snip = memoListSnip(c);
            btn.style.borderLeft = '4px solid ' + (c.hue || '#cbd5e1');
            btn.innerHTML =
                '<span class="memo-picker-title" data-memo-title="' + c.id + '">' +
                escHtml(snip) + '</span>' +
                '<span class="memo-picker-meta" data-memo-sub="' + c.id + '">' +
                (memoUpdatedLabel(c.updatedAt)) +
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
        if (tt) tt.value = isMemoUntitled(row.title) ? '' : row.title;
        if (bb) bb.value = row.body;
        var hue = gmem('memoHue');
        if (hue) hue.value = row.hue || '#f1f5f9';
    }

    ns.newMemo = function() {
        saveCurrentQuiet(true);
        var c = normalizeCard({
            id: genId(),
            title: '',
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
        maybeRefreshDashStickies();
    };

    ns.deleteMemo = function() {
        if (!_selectedId || _cards.length < 2) {
            alert(memoTr('memo.alert.keepOne'));
            return;
        }
        if (!confirm(memoTr('memo.alert.confirmDelete'))) return;
        var id = _selectedId;
        _cards = _cards.filter(function(c) { return c.id !== id; });
        _selectedId = _cards[0].id;
        persist();
        renderList();
        loadEditor();
        maybeRefreshDashStickies();
    };

    ns.duplicateMemo = function() {
        saveCurrentQuiet(true);
        var src = _cards.find(function(c) { return c.id === _selectedId; });
        if (!src) return;
        var c = normalizeCard({
            id: genId(),
            title: memoDuplicateTitle(src.title),
            body: src.body,
            hue: src.hue || '#f1f5f9'
        });
        if (typeof src.stickyX === 'number' && typeof src.stickyY === 'number') {
            c.stickyX = src.stickyX + 14;
            c.stickyY = src.stickyY + 14;
        }
        _cards.unshift(c);
        _selectedId = c.id;
        persist();
        sortCards();
        renderList();
        loadEditor();
        maybeRefreshDashStickies();
    };

    ns.saveMemoNow = function() {
        saveCurrentQuiet(false);
        maybeRefreshDashStickies();
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
        maybeRefreshDashStickies();
    };

    ns.applyAiAssist = function() {
        if (typeof AIHELPER === 'undefined' ||
            typeof AIHELPER.invokeAiPipeline !== 'function') {
            alert(memoTr('memo.alert.aiLoading'));
            return;
        }
        saveCurrentQuiet(true);
        var d = getCurrentDraft();
        var actEl = gmem('memoAssistAction');
        var custEl = gmem('memoAssistCustom');
        var action = actEl ? actEl.value : 'polish';
        var customInst = custEl ? String(custEl.value || '').trim() : '';
        var st = gmem('memoAssistStatus');

        var title = memoTitleForAi(d.title);
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
                setTimeout(maybeRefreshDashStickies, 500);
            })
            .catch(function() {
                if (st) st.textContent = memoTr('memo.status.aiFail');
                if (btn) btn.disabled = false;
            });
    };

    document.addEventListener('app-lang-change', function() {
        if (typeof ns.refreshDashboardStickies === 'function') {
            ns.refreshDashboardStickies();
        }
        if (_cards.length) {
            if (gmem('memoCardList')) refreshListTexts();
            renderList();
        }
        var memoSec = gmem('memoCardsSection');
        if (memoSec && typeof applyI18nInRoot === 'function') {
            applyI18nInRoot(memoSec);
            var memoAiBar = memoSec.querySelector('.memo-ai-bar');
            if (memoAiBar) applyI18nInRoot(memoAiBar);
            var memoEditor = memoSec.querySelector('.memo-editor-pane');
            if (memoEditor) applyI18nInRoot(memoEditor);
        }
    });

})(MEMO_AI);
