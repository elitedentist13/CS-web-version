// ════════════════════════════════════════════════════════════════
// MASS MESSAGE BROADCAST — Appointment tab (SleekFlow-inspired)
// Contacts table + campaign wizard + Twilio send + message log
// Requires: SB, AIHELPER.sendTwilioOutreach, APP_CLINICS, APP_DOCTORS
// ════════════════════════════════════════════════════════════════
var MASSBC = (function () {
    'use strict';

    var SEG_LS_KEY = 'mb_broadcast_segments_v1';
    var COL_LS_KEY = 'mb_broadcast_cols_v1';
    var SENT_PERIOD_LS_KEY = 'mb_sent_tag_months_v1';
    var SEND_DELAY_MS = 450;
    var PAGE_SIZE = 80;
    /** Supabase/PostgREST typically caps one response at ~1000 rows — page past that. */
    var PATIENT_FETCH_SIZE = 1000;
    var DEFAULT_SENT_MONTHS = 6;

    var _mode = 'contacts'; // contacts | campaign | twilio | history
    var _wizardStep = 1;
    var _allPatients = [];
    var _filtered = [];
    var _selected = {}; // id -> true
    var _sortKey = 'patient_no';
    var _sortAsc = true;
    var _page = 0;
    var _conditions = [];
    var _activeSegmentId = 'all';
    var _channel = 'whatsapp';
    var _campaignName = '';
    var _smsBody = '';
    var _sending = false;
    var _sendAbort = false;
    var _historyCampaigns = [];
    var _historyDetailId = null;
    var _logMissingWarned = false;
    var _doctorPatientIds = null; // Set when doctor filter active
    /** @type {Object.<string,{lastAt:number,channel:string,count:number}>} keyed by patient id */
    var _sentMap = {};
    /** @type {Object.<string,{lastAt:number,channel:string,count:number}>} keyed by patient_no */
    var _sentByNo = {};
    var _sentMonths = DEFAULT_SENT_MONTHS;
    var _inited = false;

    var DEFAULT_COLS = [
        { key: 'patient_no', on: true },
        { key: 'name', on: true },
        { key: 'phone', on: true },
        { key: 'clinic', on: true },
        { key: 'sex', on: true },
        { key: 'dob', on: true },
        { key: 'district', on: false },
        { key: 'email', on: false }
    ];

    function tr(key, fallback) {
        if (typeof appTr === 'function') {
            var s = appTr(key);
            if (s && s !== key) return s;
        }
        return fallback != null ? fallback : key;
    }

    function trRepl(key, map, fallback) {
        var s = tr(key, fallback || key);
        if (!map) return s;
        Object.keys(map).forEach(function (k) {
            s = s.split('{' + k + '}').join(String(map[k]));
        });
        return s;
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function pick(id) {
        return typeof g === 'function' ? g(id) : document.getElementById(id);
    }

    function clinicTagForFilter() {
        if (typeof currentClinicCodeForTagging === 'function') {
            var t = currentClinicCodeForTagging();
            if (t) return t;
        }
        var sel = pick('apptClinicSelect');
        if (!sel || !sel.value) return '';
        var rec = typeof clinicRecordFromId === 'function'
            ? clinicRecordFromId(sel.value)
            : null;
        if (rec && rec.clinic_code) return String(rec.clinic_code).trim();
        return String(sel.value || '').trim();
    }

    function selectedDoctorMeta() {
        var sel = pick('apptDoctorSelect');
        var id = sel ? String(sel.value || '').trim() : '';
        if (!id || typeof APP_DOCTORS === 'undefined') return null;
        for (var i = 0; i < APP_DOCTORS.length; i++) {
            if (String(APP_DOCTORS[i].id) === id) return APP_DOCTORS[i];
        }
        return null;
    }

    function clinicLabel(tag) {
        if (!tag) return '—';
        var t = String(tag).trim();
        if (typeof APP_CLINICS !== 'undefined' && APP_CLINICS) {
            for (var i = 0; i < APP_CLINICS.length; i++) {
                var c = APP_CLINICS[i];
                if (String(c.id) === t || String(c.clinic_code || '') === t) {
                    return c.name || c.clinic_code || t;
                }
            }
        }
        return t;
    }

    function phoneOf(p) {
        return String((p && (p.mobile_phone || p.phone_number)) || '').trim();
    }

    function phoneE164(phone) {
        if (typeof recallPhoneE164 === 'function') return recallPhoneE164(phone);
        if (typeof formatPhoneForWA === 'function') {
            var d = formatPhoneForWA(phone);
            if (!d || d.length < 8) return '';
            return d.charAt(0) === '+' ? d : ('+' + d);
        }
        var digits = String(phone || '').replace(/[^\d]/g, '');
        if (digits.length === 8 && /^[569]/.test(digits)) digits = '852' + digits;
        if (digits.length < 8) return '';
        return '+' + digits;
    }

    function firstName(p) {
        var full = String((p && (p.full_name || p.chinese_name)) || '').trim();
        if (!full) return 'Patient';
        return full.split(/\s+/)[0] || full;
    }

    function displayName(p) {
        var chi = String((p && p.chinese_name) || '').trim();
        var eng = String((p && p.full_name) || '').trim();
        if (chi && eng) return chi + ' / ' + eng;
        return chi || eng || '—';
    }

    /** Shell / import junk rows: no number and no name — they sort first and look blank. */
    function isBlankContact(p) {
        if (!p) return true;
        var no = String(p.patient_no || '').trim();
        var eng = String(p.full_name || '').trim();
        var chi = String(p.chinese_name || '').trim();
        return !no && !eng && !chi;
    }

    function goToPage(pageIndex) {
        var total = _filtered.length;
        var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        var n = parseInt(pageIndex, 10);
        if (isNaN(n)) n = 0;
        _page = Math.max(0, Math.min(pages - 1, n));
        renderTable();
        var top = pick('mbPagerTop');
        if (top && typeof top.scrollIntoView === 'function') {
            try { top.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ }
        }
    }

    function loadColPrefs() {
        try {
            var raw = localStorage.getItem(COL_LS_KEY);
            if (!raw) return DEFAULT_COLS.slice().map(function (c) { return Object.assign({}, c); });
            var parsed = JSON.parse(raw);
            if (!Array.isArray(parsed) || !parsed.length) {
                return DEFAULT_COLS.slice().map(function (c) { return Object.assign({}, c); });
            }
            return parsed;
        } catch (e) {
            return DEFAULT_COLS.slice().map(function (c) { return Object.assign({}, c); });
        }
    }

    function saveColPrefs(cols) {
        try { localStorage.setItem(COL_LS_KEY, JSON.stringify(cols)); } catch (e) { /* ignore */ }
    }

    function loadSegments() {
        try {
            var raw = localStorage.getItem(SEG_LS_KEY);
            var list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    }

    function saveSegments(list) {
        try { localStorage.setItem(SEG_LS_KEY, JSON.stringify(list || [])); } catch (e) { /* ignore */ }
    }

    // ── Init / mode ──────────────────────────────────────────────
    function init() {
        _inited = true;
        bindOnce();
        restoreSentPeriodUi();
        syncSortUiFromState();
        fillClinicFilterSelect();
        setMode('contacts');
        renderSegments();
        refreshFromBar();
        if (typeof applyI18nInRoot === 'function') {
            var root = pick('tab-broadcast');
            if (root) applyI18nInRoot(root);
        }
    }

    function readSentMonths() {
        var sel = pick('mbSentPeriod');
        var n = sel ? parseInt(sel.value, 10) : NaN;
        if (!n || n < 1) {
            try {
                n = parseInt(localStorage.getItem(SENT_PERIOD_LS_KEY) || '', 10);
            } catch (e) { n = NaN; }
        }
        if (!n || n < 1) n = DEFAULT_SENT_MONTHS;
        _sentMonths = n;
        return n;
    }

    function restoreSentPeriodUi() {
        var saved = DEFAULT_SENT_MONTHS;
        try {
            saved = parseInt(localStorage.getItem(SENT_PERIOD_LS_KEY) || '', 10) || DEFAULT_SENT_MONTHS;
        } catch (e) { saved = DEFAULT_SENT_MONTHS; }
        var sel = pick('mbSentPeriod');
        if (sel) sel.value = String(saved);
        _sentMonths = saved;
    }

    function syncSortUiFromState() {
        var sk = pick('mbSortKey');
        var sd = pick('mbSortDir');
        if (sk) sk.value = _sortKey || 'patient_no';
        if (sd) sd.value = _sortAsc ? 'asc' : 'desc';
    }

    function fillClinicFilterSelect() {
        var sel = pick('mbFilterClinic');
        if (!sel) return;
        var prev = sel.value || '';
        sel.innerHTML = '<option value="">' + esc(tr('common.all', 'All')) + '</option>';
        if (typeof APP_CLINICS !== 'undefined' && APP_CLINICS) {
            APP_CLINICS.forEach(function (c) {
                var code = String(c.clinic_code || '').trim();
                var val = code || String(c.id || '');
                if (!val) return;
                var o = document.createElement('option');
                o.value = val;
                o.textContent = c.name || code || val;
                sel.appendChild(o);
            });
        }
        if (prev) {
            var has = false;
            Array.prototype.forEach.call(sel.options, function (o) {
                if (o.value === prev) has = true;
            });
            if (has) sel.value = prev;
        }
    }

    function onSentPeriodChange() {
        var sel = pick('mbSentPeriod');
        var n = sel ? parseInt(sel.value, 10) : DEFAULT_SENT_MONTHS;
        if (!n || n < 1) n = DEFAULT_SENT_MONTHS;
        _sentMonths = n;
        try { localStorage.setItem(SENT_PERIOD_LS_KEY, String(n)); } catch (e) { /* ignore */ }
        loadSentHistory().then(function () {
            applyFilters();
        });
    }

    function onSortChange() {
        var sk = pick('mbSortKey');
        var sd = pick('mbSortDir');
        if (sk) _sortKey = String(sk.value || 'patient_no');
        if (sd) _sortAsc = String(sd.value || 'asc') !== 'desc';
        applyFilters();
    }

    function bindOnce() {
        var root = pick('tab-broadcast');
        if (!root || root.dataset.mbBound === '1') return;
        root.dataset.mbBound = '1';

        root.addEventListener('click', function (ev) {
            var t = ev.target;
            if (!t) return;
            var modeBtn = t.closest('[data-mb-mode]');
            if (modeBtn) {
                setMode(modeBtn.getAttribute('data-mb-mode'));
                return;
            }
            var segDel = t.closest('[data-mb-seg-del]');
            if (segDel) {
                ev.preventDefault();
                ev.stopPropagation();
                deleteSavedSegment(segDel.getAttribute('data-mb-seg-del'));
                return;
            }
            var segBtn = t.closest('[data-mb-seg]');
            if (segBtn) {
                activateSegment(segBtn.getAttribute('data-mb-seg') || 'all');
                return;
            }
            var stepBtn = t.closest('[data-mb-step]');
            if (stepBtn) {
                goWizardStep(parseInt(stepBtn.getAttribute('data-mb-step'), 10) || 1);
                return;
            }
            var sortTh = t.closest('[data-mb-sort]');
            if (sortTh) {
                var key = sortTh.getAttribute('data-mb-sort');
                if (_sortKey === key) _sortAsc = !_sortAsc;
                else {
                    _sortKey = key;
                    // Last sent defaults to newest first
                    _sortAsc = key !== 'last_sent';
                }
                syncSortUiFromState();
                applyFilters();
                return;
            }
            var rowCb = t.closest('input[data-mb-row]');
            if (rowCb) {
                var id = rowCb.getAttribute('data-mb-row');
                if (rowCb.checked) _selected[id] = true;
                else delete _selected[id];
                updateCounts();
                return;
            }
            var histRow = t.closest('[data-mb-campaign]');
            if (histRow) {
                openHistoryDetail(histRow.getAttribute('data-mb-campaign'));
                return;
            }
        });

        var search = pick('mbSearch');
        if (search) {
            var timer = null;
            search.addEventListener('input', function () {
                clearTimeout(timer);
                timer = setTimeout(function () { applyFilters(); }, 200);
            });
        }
        ['mbFilterSex', 'mbFilterDobMonth', 'mbFilterHasPhone', 'mbFilterOptOut',
            'mbFilterSent', 'mbFilterClinic'].forEach(function (id) {
            var el = pick(id);
            if (el) el.addEventListener('change', function () { applyFilters(); });
        });

        // Live-update template preview while editing Notes / vars / label / SID
        ['mbTplLabel', 'mbTplSid', 'mbTplVars', 'mbTplNotes'].forEach(function (id) {
            var el = pick(id);
            if (!el) return;
            el.addEventListener('input', refreshTplPreviewFromForm);
            el.addEventListener('change', refreshTplPreviewFromForm);
        });
        // Mapping dropdowns live inside mbTplVarMap (delegated)
        var mapBox = pick('mbTplVarMap');
        if (mapBox && !mapBox.getAttribute('data-var-map-bound')) {
            mapBox.setAttribute('data-var-map-bound', '1');
            mapBox.addEventListener('change', function (ev) {
                var t = ev && ev.target;
                if (!t || !t.getAttribute || !t.getAttribute('data-tpl-map-key')) return;
                refreshTplPreviewFromForm();
            });
        }
    }

    function setMode(mode) {
        var next = (mode === 'campaign' || mode === 'history' || mode === 'twilio')
            ? mode
            : 'contacts';
        var prev = _mode;
        _mode = next;
        var contacts = pick('mbPaneContacts');
        var campaign = pick('mbPaneCampaign');
        var twilio = pick('mbPaneTwilio');
        var history = pick('mbPaneHistory');
        if (contacts) contacts.style.display = _mode === 'contacts' ? '' : 'none';
        if (campaign) campaign.style.display = _mode === 'campaign' ? '' : 'none';
        if (twilio) twilio.style.display = _mode === 'twilio' ? '' : 'none';
        if (history) history.style.display = _mode === 'history' ? '' : 'none';
        document.querySelectorAll('#tab-broadcast [data-mb-mode]').forEach(function (btn) {
            btn.classList.toggle('mb-mode-active', btn.getAttribute('data-mb-mode') === _mode);
        });
        if (_mode === 'campaign') {
            _wizardStep = 1;
            syncWizardUi();
            fillTwilioSelects();
        }
        if (_mode === 'twilio') {
            fillTwilioSelects();
            refreshTplPreviewFromForm();
        }
        if (_mode === 'history') loadHistory();
        // Returning from Campaign/History: refresh sent tags so the window filter updates.
        if (_mode === 'contacts' && prev !== 'contacts' && prev !== 'twilio') {
            loadSentHistory().then(function () { applyFilters(); });
        }
    }

    function refreshFromBar() {
        loadPatients();
    }

    // ── Segments ─────────────────────────────────────────────────
    function renderSegments() {
        var host = pick('mbSegList');
        if (!host) return;
        var segs = loadSegments();
        var html =
            '<button type="button" class="mb-seg-btn' + (_activeSegmentId === 'all' ? ' active' : '') +
            '" data-mb-seg="all">' + esc(tr('mb.seg.all', 'All contacts')) + '</button>' +
            '<button type="button" class="mb-seg-btn' + (_activeSegmentId === 'scope' ? ' active' : '') +
            '" data-mb-seg="scope">' + esc(tr('mb.seg.scope', 'Clinic / doctor bar')) + '</button>' +
            '<button type="button" class="mb-seg-btn' + (_activeSegmentId === 'hasphone' ? ' active' : '') +
            '" data-mb-seg="hasphone">' + esc(tr('mb.seg.hasPhone', 'Has phone')) + '</button>' +
            '<button type="button" class="mb-seg-btn' + (_activeSegmentId === 'birthday' ? ' active' : '') +
            '" data-mb-seg="birthday">' + esc(tr('mb.seg.birthday', 'Birthday this month')) + '</button>' +
            '<button type="button" class="mb-seg-btn' + (_activeSegmentId === 'sent' ? ' active' : '') +
            '" data-mb-seg="sent">' + esc(tr('mb.seg.sent', 'Messaged in window')) + '</button>' +
            '<button type="button" class="mb-seg-btn' + (_activeSegmentId === 'unsent' ? ' active' : '') +
            '" data-mb-seg="unsent">' + esc(tr('mb.seg.unsent', 'Not messaged in window')) + '</button>';
        segs.forEach(function (s) {
            var n = Array.isArray(s.patientIds) ? s.patientIds.length : 0;
            var label = (s.name || 'List') + (n ? (' (' + n + ')') : '');
            html +=
                '<div class="mb-seg-row" style="display:flex;align-items:center;gap:4px;">' +
                '<button type="button" class="mb-seg-btn' + (_activeSegmentId === s.id ? ' active' : '') +
                '" data-mb-seg="' + esc(s.id) + '" style="flex:1;">' + esc(label) + '</button>' +
                '<button type="button" class="mb-seg-del" data-mb-seg-del="' + esc(s.id) + '" ' +
                'title="' + esc(tr('mb.seg.delete', 'Delete list')) + '" ' +
                'aria-label="' + esc(tr('mb.seg.delete', 'Delete list')) + '" ' +
                'style="flex:none;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;' +
                'background:#fff;color:#94a3b8;cursor:pointer;font-size:12px;">✕</button>' +
                '</div>';
        });
        host.innerHTML = html;
    }

    /** IDs to store: checked rows if any, else current filtered result set. */
    function collectIdsForSavedList() {
        var selectedIds = Object.keys(_selected).filter(function (id) {
            return !!_selected[id];
        });
        if (selectedIds.length) return selectedIds;
        return (_filtered || []).map(function (p) {
            return p && p.id != null ? String(p.id) : '';
        }).filter(Boolean);
    }

    function findSavedSegment(id) {
        var segs = loadSegments();
        for (var i = 0; i < segs.length; i++) {
            if (String(segs[i].id) === String(id)) return segs[i];
        }
        return null;
    }

    function saveCurrentAsSegment() {
        var ids = collectIdsForSavedList();
        if (!ids.length) {
            alert(tr('mb.seg.needContacts',
                'No contacts to save. Filter or select contacts first.'));
            return;
        }
        var usedSelected = Object.keys(_selected).some(function (id) {
            return !!_selected[id];
        });
        var defaultName = usedSelected
            ? tr('mb.seg.defaultSelected', 'Selected contacts')
            : tr('mb.seg.defaultFiltered', 'Filtered contacts');
        var name = window.prompt(
            tr('mb.seg.promptName', 'List name'),
            defaultName + ' (' + ids.length + ')'
        );
        if (name === null || !String(name).trim()) return;
        name = String(name).trim();

        var segs = loadSegments();
        // Overwrite if same name (case-insensitive)
        var existing = null;
        for (var i = 0; i < segs.length; i++) {
            if (String(segs[i].name || '').trim().toLowerCase() === name.toLowerCase()) {
                existing = segs[i];
                break;
            }
        }
        if (existing) {
            if (!window.confirm(trRepl('mb.seg.confirmOverwrite', { NAME: existing.name, N: ids.length },
                'List “{NAME}” already exists. Replace it with {N} contact(s)?'))) {
                return;
            }
            existing.name = name;
            existing.patientIds = ids.slice();
            existing.conditions = snapshotConditions();
            existing.updatedAt = new Date().toISOString();
            // Drop legacy scope fields that incorrectly forced clinic/doctor bar
            delete existing.clinicTag;
            delete existing.doctorId;
            saveSegments(segs);
            _activeSegmentId = existing.id;
        } else {
            var id = 'seg_' + Date.now().toString(36);
            segs.push({
                id: id,
                name: name,
                patientIds: ids.slice(),
                conditions: snapshotConditions(),
                createdAt: new Date().toISOString()
            });
            saveSegments(segs);
            _activeSegmentId = id;
        }
        renderSegments();
        applyFilters();
        var status = pick('mbStatus');
        if (status) {
            status.textContent = trRepl('mb.seg.savedOk', { NAME: name, N: ids.length },
                'Saved list “{NAME}” ({N} contacts).');
        }
    }

    function deleteSavedSegment(id) {
        var sid = String(id || '');
        if (!sid || sid.indexOf('seg_') !== 0) return;
        var seg = findSavedSegment(sid);
        var label = seg && seg.name ? seg.name : sid;
        if (!window.confirm(trRepl('mb.seg.confirmDelete', { NAME: label },
            'Delete list “{NAME}”?'))) {
            return;
        }
        var segs = loadSegments().filter(function (s) {
            return String(s.id) !== sid;
        });
        saveSegments(segs);
        if (_activeSegmentId === sid) _activeSegmentId = 'all';
        renderSegments();
        applyFilters();
    }

    function snapshotConditions() {
        return {
            search: (pick('mbSearch') && pick('mbSearch').value) || '',
            sex: (pick('mbFilterSex') && pick('mbFilterSex').value) || '',
            dobMonth: (pick('mbFilterDobMonth') && pick('mbFilterDobMonth').value) || '',
            hasPhone: (pick('mbFilterHasPhone') && pick('mbFilterHasPhone').value) || '',
            optOut: (pick('mbFilterOptOut') && pick('mbFilterOptOut').value) || '',
            sent: (pick('mbFilterSent') && pick('mbFilterSent').value) || '',
            clinic: (pick('mbFilterClinic') && pick('mbFilterClinic').value) || '',
            extras: _conditions.slice()
        };
    }

    /** Push saved filter criteria back into the Contacts UI (for editing). */
    function restoreConditionsToUi(cond) {
        if (!cond || typeof cond !== 'object') return;
        function setVal(id, v) {
            var el = pick(id);
            if (el) el.value = v != null ? String(v) : '';
        }
        setVal('mbSearch', cond.search || '');
        setVal('mbFilterSex', cond.sex || '');
        setVal('mbFilterDobMonth', cond.dobMonth || '');
        setVal('mbFilterHasPhone', cond.hasPhone || '');
        setVal('mbFilterOptOut', cond.optOut || '');
        setVal('mbFilterSent', cond.sent || '');
        setVal('mbFilterClinic', cond.clinic || '');
        _conditions = Array.isArray(cond.extras) ? cond.extras.slice() : [];
        renderConditionChips();
    }

    function activateSegment(segId) {
        _activeSegmentId = segId || 'all';
        if (_activeSegmentId.indexOf('seg_') === 0) {
            var seg = findSavedSegment(_activeSegmentId);
            // Static membership lists keep current UI filters clear so membership is obvious
            if (seg && Array.isArray(seg.patientIds) && seg.patientIds.length) {
                restoreConditionsToUi({
                    search: '', sex: '', dobMonth: '', hasPhone: '',
                    optOut: '', sent: '', clinic: '', extras: []
                });
            } else if (seg && seg.conditions) {
                restoreConditionsToUi(seg.conditions);
            }
        }
        renderSegments();
        enrichDoctorFilter().then(function () { applyFilters(); });
    }

    function sentSinceIso() {
        var months = readSentMonths();
        var d = new Date();
        d.setMonth(d.getMonth() - months);
        return d.toISOString();
    }

    function rememberSent(patientId, patientNo, channel, atMs) {
        var ts = atMs || Date.now();
        var ch = String(channel || '');
        var info = null;
        var pid = patientId != null && patientId !== '' ? String(patientId) : '';
        var pno = patientNo != null && patientNo !== '' ? String(patientNo).trim() : '';
        if (pid && _sentMap[pid]) info = _sentMap[pid];
        else if (pno && _sentByNo[pno]) info = _sentByNo[pno];
        if (!info) {
            info = { lastAt: ts, channel: ch, count: 1 };
        } else {
            info.count += 1;
            if (ts >= info.lastAt) {
                info.lastAt = ts;
                info.channel = ch || info.channel;
            }
        }
        if (pid) _sentMap[pid] = info;
        if (pno) _sentByNo[pno] = info;
        return info;
    }

    function loadSentHistory() {
        var prevMap = _sentMap;
        var prevByNo = _sentByNo;
        _sentMap = {};
        _sentByNo = {};
        if (typeof SB === 'undefined') return Promise.resolve();
        var since = sentSinceIso();
        return SB.from('message_send_log')
            .select('patient_id,patient_no,channel,created_at,status')
            .eq('status', 'sent')
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(50000)
            .then(function (r) {
                if (r.error) {
                    // Keep any in-session optimistic tags if DB log is unavailable.
                    _sentMap = prevMap;
                    _sentByNo = prevByNo;
                    if (!_logMissingWarned &&
                        /message_send_log|does not exist|schema cache/i.test(String(r.error.message || ''))) {
                        _logMissingWarned = true;
                        console.warn('[MASSBC] message_send_log unavailable for sent tags.');
                    }
                    return;
                }
                (r.data || []).forEach(function (row) {
                    var pid = String(row.patient_id || '');
                    var pno = String(row.patient_no || '').trim();
                    if (!pid && !pno) return;
                    var ts = Date.parse(row.created_at || '') || 0;
                    rememberSent(pid, pno, row.channel, ts);
                });
                // Merge recent in-session sends that may not have flushed yet
                Object.keys(prevMap || {}).forEach(function (pid) {
                    var prev = prevMap[pid];
                    var cur = _sentMap[pid];
                    if (!cur || (prev && prev.lastAt > cur.lastAt)) {
                        _sentMap[pid] = prev;
                    }
                });
                Object.keys(prevByNo || {}).forEach(function (pno) {
                    var prev = prevByNo[pno];
                    var cur = _sentByNo[pno];
                    if (!cur || (prev && prev.lastAt > cur.lastAt)) {
                        _sentByNo[pno] = prev;
                    }
                });
            })
            .catch(function () {
                _sentMap = prevMap;
                _sentByNo = prevByNo;
            });
    }

    function getSentInfo(patientOrId) {
        if (patientOrId && typeof patientOrId === 'object') {
            var byId = patientOrId.id != null ? _sentMap[String(patientOrId.id)] : null;
            if (byId) return byId;
            var no = String(patientOrId.patient_no || '').trim();
            return no ? (_sentByNo[no] || null) : null;
        }
        var key = String(patientOrId || '');
        return _sentMap[key] || _sentByNo[key] || null;
    }

    function formatSentAgo(ts) {
        if (!ts) return '';
        var days = Math.max(0, Math.floor((Date.now() - ts) / 86400000));
        if (days < 1) return tr('mb.sent.today', 'today');
        if (days < 7) return days + tr('mb.sent.d', 'd');
        if (days < 60) return Math.max(1, Math.round(days / 7)) + tr('mb.sent.w', 'w');
        var mo = Math.max(1, Math.round(days / 30.44));
        return mo + tr('mb.sent.mo', 'mo');
    }

    function sentTagHtml(p) {
        var info = getSentInfo(p);
        if (!info || !info.lastAt) return '';
        var ch = String(info.channel || '').toLowerCase();
        var chLbl = ch === 'sms' ? 'SMS' : (ch === 'whatsapp' ? 'WA' : 'Sent');
        var ago = formatSentAgo(info.lastAt);
        var when = '';
        try { when = new Date(info.lastAt).toISOString().slice(0, 10); } catch (e) { when = ''; }
        var title = trRepl('mb.sent.tagTitle', {
            CH: chLbl,
            DATE: when,
            N: info.count,
            M: readSentMonths()
        }, 'Last {CH} {DATE} · {N} in last {M} mo');
        var cls = 'mb-sent-tag' +
            (ch === 'sms' ? ' mb-sent-tag-sms' : ' mb-sent-tag-wa');
        return ' <span class="' + cls + '" title="' + esc(title) + '">' +
            esc(chLbl + ' · ' + ago) + '</span>';
    }

    // ── Load patients ────────────────────────────────────────────
    function fetchAllPatients(cols, onProgress) {
        var all = [];
        var size = PATIENT_FETCH_SIZE;

        function page(from) {
            return SB.from('patients')
                .select(cols)
                .order('patient_no', { ascending: true })
                .range(from, from + size - 1)
                .then(function (r) {
                    if (r.error) return r;
                    var rows = r.data || [];
                    all = all.concat(rows);
                    if (typeof onProgress === 'function') onProgress(all.length);
                    if (rows.length < size) {
                        return { data: all, error: null };
                    }
                    return page(from + size);
                });
        }

        return page(0);
    }

    function loadPatients() {
        var status = pick('mbStatus');
        if (status) status.textContent = tr('mb.loading', 'Loading contacts…');
        if (typeof SB === 'undefined') {
            if (status) status.textContent = tr('mb.noSb', 'Supabase unavailable.');
            return;
        }

        fillClinicFilterSelect();
        readSentMonths();

        var colsWithOptOut =
            'id,patient_no,full_name,chinese_name,phone_number,mobile_phone,sex,dob,' +
            'email,residential_district,referred_by,clinic_tag,messaging_opt_out';
        var colsBasic =
            'id,patient_no,full_name,chinese_name,phone_number,mobile_phone,sex,dob,' +
            'email,residential_district,referred_by,clinic_tag';

        function progress(n) {
            if (status) {
                status.textContent = trRepl('mb.loadingN', { N: n }, 'Loading contacts… {N}');
            }
        }

        fetchAllPatients(colsWithOptOut, progress)
            .then(function (r) {
                // Soft-fail if messaging_opt_out column missing
                if (r.error && /messaging_opt_out/i.test(String(r.error.message || ''))) {
                    return fetchAllPatients(colsBasic, progress);
                }
                return r;
            })
            .then(function (r) {
                if (r.error) {
                    _allPatients = [];
                    if (status) status.textContent = String(r.error.message || r.error);
                    applyFilters();
                    return;
                }
                _allPatients = (r.data || []).map(function (p) {
                    if (p.messaging_opt_out == null) p.messaging_opt_out = false;
                    return p;
                });
                return Promise.all([enrichDoctorFilter(), loadSentHistory()]).then(function () {
                    applyFilters();
                    var tagged = Object.keys(_sentMap).length;
                    if (status) {
                        status.textContent = trRepl('mb.loadedTagged', {
                            N: _allPatients.length,
                            T: tagged,
                            M: readSentMonths()
                        }, 'Loaded {N} contacts · {T} tagged (last {M} mo)');
                    }
                });
            })
            .catch(function (e) {
                _allPatients = [];
                if (status) status.textContent = (e && e.message) ? e.message : tr('mb.loadFail', 'Load failed');
                applyFilters();
            });
    }

    function enrichDoctorFilter() {
        _doctorPatientIds = null;
        // Doctor scope only for built-in "Clinic / doctor bar" segment
        if (_activeSegmentId !== 'scope') return Promise.resolve();

        var doc = selectedDoctorMeta();
        if (!doc) return Promise.resolve();

        var code = String(doc.doctor_code || '').trim();
        var id = String(doc.id || '').trim();
        if (!code && !id) return Promise.resolve();

        var q = SB.from('appointments').select('patient_id');
        if (code) q = q.eq('doctor_code', code);
        else q = q.eq('doctor_id', id);

        return q.limit(20000).then(function (r) {
            if (r.error) {
                return SB.from('appointments').select('patient_id').eq('doctor_id', id).limit(20000);
            }
            return r;
        }).then(function (r) {
            var set = {};
            (r.data || []).forEach(function (row) {
                if (row.patient_id) set[String(row.patient_id)] = true;
            });
            _doctorPatientIds = set;
        }).catch(function () {
            _doctorPatientIds = {};
        });
    }

    function patientMatchesClinicTag(p, clinicTag) {
        if (!clinicTag) return true;
        var pt = String(p.clinic_tag || '').trim();
        if (!pt) return false;
        if (pt === clinicTag) return true;
        if (typeof APP_CLINICS === 'undefined' || !APP_CLINICS) return false;
        for (var i = 0; i < APP_CLINICS.length; i++) {
            var c = APP_CLINICS[i];
            var code = String(c.clinic_code || '').trim();
            var id = String(c.id || '');
            if ((code === clinicTag || id === clinicTag) &&
                (pt === code || pt === id)) {
                return true;
            }
        }
        return false;
    }

    // ── Filter / sort / render ───────────────────────────────────
    function applyFilters() {
        var search = String((pick('mbSearch') && pick('mbSearch').value) || '').trim().toLowerCase();
        var sex = (pick('mbFilterSex') && pick('mbFilterSex').value) || '';
        var dobMonth = (pick('mbFilterDobMonth') && pick('mbFilterDobMonth').value) || '';
        var hasPhone = (pick('mbFilterHasPhone') && pick('mbFilterHasPhone').value) || '';
        var optOut = (pick('mbFilterOptOut') && pick('mbFilterOptOut').value) || '';
        var sentFilter = (pick('mbFilterSent') && pick('mbFilterSent').value) || '';
        var clinicFilter = (pick('mbFilterClinic') && pick('mbFilterClinic').value) || '';
        var clinicTag = clinicFilter;

        // Custom saved list with fixed membership (preferred)
        var membershipSet = null;
        if (_activeSegmentId.indexOf('seg_') === 0) {
            var segs = loadSegments();
            var seg = null;
            for (var si = 0; si < segs.length; si++) {
                if (String(segs[si].id) === String(_activeSegmentId)) {
                    seg = segs[si];
                    break;
                }
            }
            if (seg && Array.isArray(seg.patientIds) && seg.patientIds.length) {
                membershipSet = {};
                seg.patientIds.forEach(function (pid) {
                    if (pid != null && pid !== '') membershipSet[String(pid)] = true;
                });
            } else if (seg && seg.conditions) {
                // Legacy condition-only lists (pre patientIds)
                var c = seg.conditions;
                search = String(c.search != null ? c.search : '').trim().toLowerCase();
                sex = c.sex || '';
                dobMonth = c.dobMonth || '';
                hasPhone = c.hasPhone || '';
                optOut = c.optOut || '';
                sentFilter = c.sent || '';
                clinicTag = c.clinic || '';
                if (Array.isArray(c.extras)) _conditions = c.extras.slice();
            }
        }

        if (_activeSegmentId === 'scope') {
            clinicTag = clinicTagForFilter() || clinicTag;
        }

        if (_activeSegmentId === 'sent') sentFilter = 'yes';
        if (_activeSegmentId === 'unsent') sentFilter = 'no';

        var nowMonth = String(new Date().getMonth() + 1);
        var extras = _conditions;

        _filtered = _allPatients.filter(function (p) {
            if (isBlankContact(p)) return false;

            if (membershipSet) {
                return !!membershipSet[String(p.id)];
            }

            if (_activeSegmentId === 'hasphone' && !phoneOf(p)) return false;
            if (_activeSegmentId === 'birthday') {
                if (!p.dob) return false;
                if (parseInt(String(p.dob).slice(5, 7), 10) !== parseInt(nowMonth, 10)) return false;
            }

            if (clinicTag && !patientMatchesClinicTag(p, clinicTag)) return false;

            if (_doctorPatientIds && !_doctorPatientIds[String(p.id)]) return false;

            if (sex && String(p.sex || '') !== sex) return false;
            if (dobMonth) {
                if (!p.dob) return false;
                if (parseInt(String(p.dob).slice(5, 7), 10) !== parseInt(dobMonth, 10)) return false;
            }
            if (hasPhone === 'yes' && !phoneOf(p)) return false;
            if (hasPhone === 'no' && phoneOf(p)) return false;
            if (optOut === 'exclude' && p.messaging_opt_out) return false;
            if (optOut === 'only' && !p.messaging_opt_out) return false;

            var sentInfo = getSentInfo(p);
            if (sentFilter === 'yes' && !sentInfo) return false;
            if (sentFilter === 'no' && sentInfo) return false;

            if (search) {
                var blob = [
                    p.patient_no, p.full_name, p.chinese_name,
                    p.phone_number, p.mobile_phone, p.email
                ].join(' ').toLowerCase();
                if (blob.indexOf(search) < 0) return false;
            }

            for (var i = 0; i < extras.length; i++) {
                if (!matchCondition(p, extras[i])) return false;
            }
            return true;
        });

        sortFiltered();
        _page = 0;
        renderTable();
        updateCounts();
        renderConditionChips();
    }

    function matchCondition(p, c) {
        if (!c || !c.field) return true;
        var field = c.field;
        var op = c.op || 'eq';
        var val = String(c.value == null ? '' : c.value).trim().toLowerCase();
        var raw = '';
        if (field === 'referred_by') raw = String(p.referred_by || '');
        else if (field === 'district') raw = String(p.residential_district || '');
        else if (field === 'clinic') raw = String(p.clinic_tag || '');
        else if (field === 'email') raw = String(p.email || '');
        else raw = String(p[field] || '');
        var hay = raw.toLowerCase();
        if (op === 'eq') return hay === val;
        if (op === 'contains') return hay.indexOf(val) >= 0;
        if (op === 'neq') return hay !== val;
        if (op === 'empty') return !hay;
        if (op === 'notempty') return !!hay;
        return true;
    }

    function englishSortName(p) {
        return String((p && p.full_name) || '').trim();
    }

    function sortFiltered() {
        var key = _sortKey;
        var asc = _sortAsc;
        _filtered.sort(function (a, b) {
            var av, bv, cmp;
            if (key === 'name') {
                // Alphabetical by English name (full_name); missing English names go last.
                av = englishSortName(a);
                bv = englishSortName(b);
                var aEmpty = !av;
                var bEmpty = !bv;
                if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
                cmp = av.localeCompare(bv, 'en', { sensitivity: 'base', numeric: true });
                if (cmp !== 0) return asc ? cmp : -cmp;
                // Tie-break: Chinese name, then patient no.
                cmp = String(a.chinese_name || '').localeCompare(String(b.chinese_name || ''), 'zh', {
                    sensitivity: 'base'
                });
                if (cmp !== 0) return asc ? cmp : -cmp;
                return String(a.patient_no || '').localeCompare(String(b.patient_no || ''), 'en', {
                    numeric: true
                });
            } else if (key === 'phone') {
                av = phoneOf(a);
                bv = phoneOf(b);
            } else if (key === 'clinic') {
                av = String(a.clinic_tag || '');
                bv = String(b.clinic_tag || '');
            } else if (key === 'last_sent') {
                var sa = getSentInfo(a);
                var sb = getSentInfo(b);
                av = sa ? sa.lastAt : 0;
                bv = sb ? sb.lastAt : 0;
                if (av !== bv) return asc ? (av - bv) : (bv - av);
                return 0;
            } else if (key === 'patient_no') {
                av = String(a.patient_no == null ? '' : a.patient_no).trim();
                bv = String(b.patient_no == null ? '' : b.patient_no).trim();
            } else {
                av = String(a[key] == null ? '' : a[key]);
                bv = String(b[key] == null ? '' : b[key]);
            }
            // Empty sort keys go last (avoids blank rows clustering at the top).
            var aEmpty = !av;
            var bEmpty = !bv;
            if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
            if (key === 'patient_no' || key === 'phone' || key === 'dob') {
                cmp = String(av).localeCompare(String(bv), 'en', { numeric: true, sensitivity: 'base' });
                if (cmp !== 0) return asc ? cmp : -cmp;
                return 0;
            }
            if (av < bv) return asc ? -1 : 1;
            if (av > bv) return asc ? 1 : -1;
            return 0;
        });
    }

    function renderTable() {
        var body = pick('mbTableBody');
        var head = pick('mbTableHead');
        if (!body) return;
        var cols = loadColPrefs();
        if (head) {
            var th =
                '<th class="mb-th-check"><input type="checkbox" id="mbSelectPage" title="' +
                esc(tr('mb.selectPage', 'Select page')) + '"></th>';
            cols.forEach(function (c) {
                if (!c.on) return;
                var label = colLabel(c.key);
                th +=
                    '<th data-mb-sort="' + esc(c.key) + '" class="mb-sortable">' +
                    esc(label) +
                    (_sortKey === c.key ? (_sortAsc ? ' ▲' : ' ▼') : '') +
                    '</th>';
            });
            // Always show Last sent sort affordance when tags are active
            th +=
                '<th data-mb-sort="last_sent" class="mb-sortable mb-th-sent">' +
                esc(tr('mb.col.lastSent', 'Last sent')) +
                (_sortKey === 'last_sent' ? (_sortAsc ? ' ▲' : ' ▼') : '') +
                '</th>';
            head.innerHTML = '<tr>' + th + '</tr>';
            syncSortUiFromState();
            var pageCb = pick('mbSelectPage');
            if (pageCb) {
                pageCb.addEventListener('change', function () {
                    var start = _page * PAGE_SIZE;
                    var slice = _filtered.slice(start, start + PAGE_SIZE);
                    slice.forEach(function (p) {
                        if (pageCb.checked) _selected[p.id] = true;
                        else delete _selected[p.id];
                    });
                    renderTable();
                    updateCounts();
                });
            }
        }

        var start = _page * PAGE_SIZE;
        var slice = _filtered.slice(start, start + PAGE_SIZE);
        var colCount = cols.filter(function (c) { return c.on; }).length + 2; // check + last_sent
        if (!slice.length) {
            body.innerHTML =
                '<tr><td colspan="' + colCount + '" class="mb-empty">' +
                esc(tr('mb.empty', 'No contacts match these filters.')) +
                '</td></tr>';
            renderPager();
            return;
        }

        var html = '';
        slice.forEach(function (p) {
            var checked = _selected[p.id] ? ' checked' : '';
            var sentInfo = getSentInfo(p);
            html += '<tr class="mb-row' +
                (p.messaging_opt_out ? ' mb-row-optout' : '') +
                (sentInfo ? ' mb-row-sent' : '') + '">';
            html +=
                '<td class="mb-td-check"><input type="checkbox" data-mb-row="' +
                esc(p.id) + '"' + checked + '></td>';
            cols.forEach(function (c) {
                if (!c.on) return;
                html += '<td>' + cellHtml(p, c.key) + '</td>';
            });
            html += '<td class="mb-td-sent">' + lastSentCellHtml(p) + '</td>';
            html += '</tr>';
        });
        body.innerHTML = html;
        renderPager();
    }

    function colLabel(key) {
        var map = {
            patient_no: tr('mb.col.no', 'No.'),
            name: tr('mb.col.name', 'Name'),
            phone: tr('mb.col.phone', 'Phone'),
            clinic: tr('mb.col.clinic', 'Clinic'),
            sex: tr('mb.col.sex', 'Sex'),
            dob: tr('mb.col.dob', 'DOB'),
            district: tr('mb.col.district', 'District'),
            email: tr('mb.col.email', 'Email'),
            last_sent: tr('mb.col.lastSent', 'Last sent')
        };
        return map[key] || key;
    }

    function lastSentCellHtml(p) {
        var info = getSentInfo(p);
        if (!info || !info.lastAt) {
            return '<span class="mb-muted">—</span>';
        }
        return sentTagHtml(p).trim() || '<span class="mb-muted">—</span>';
    }

    function cellHtml(p, key) {
        if (key === 'patient_no') return esc(p.patient_no || '—');
        if (key === 'name') {
            var n = esc(displayName(p));
            n += sentTagHtml(p);
            if (p.messaging_opt_out) {
                n += ' <span class="mb-optout-badge">' + esc(tr('mb.optOut', 'Opt-out')) + '</span>';
            }
            return n;
        }
        if (key === 'phone') {
            var ph = phoneOf(p);
            return ph ? esc(ph) : '<span class="mb-muted">—</span>';
        }
        if (key === 'clinic') return esc(clinicLabel(p.clinic_tag));
        if (key === 'sex') return esc(p.sex || '—');
        if (key === 'dob') return esc(p.dob || '—');
        if (key === 'district') return esc(p.residential_district || '—');
        if (key === 'email') return esc(p.email || '—');
        return '—';
    }

    function renderPager() {
        var total = _filtered.length;
        var pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
        if (_page >= pages) _page = pages - 1;
        if (_page < 0) _page = 0;
        var from = total ? (_page * PAGE_SIZE + 1) : 0;
        var to = Math.min(total, (_page + 1) * PAGE_SIZE);
        var atStart = _page <= 0;
        var atEnd = _page >= pages - 1 || total === 0;

        var html =
            '<div class="mb-pager-inner">' +
            '<button type="button" class="mb-btn ghost mb-pager-btn" data-mb-page="first"' +
            (atStart ? ' disabled' : '') + ' title="' + esc(tr('mb.page.first', 'First page')) + '">' +
            esc(tr('mb.page.firstShort', '« First')) + '</button>' +
            '<button type="button" class="mb-btn ghost mb-pager-btn" data-mb-page="prev"' +
            (atStart ? ' disabled' : '') + '>' +
            esc(tr('mb.page.prev', 'Prev')) + '</button>' +
            '<label class="mb-pager-jump">' +
            '<span class="mb-pager-jump-lab">' + esc(tr('mb.page.jump', 'Page')) + '</span>' +
            '<input type="number" class="mb-pager-input" data-mb-page-input min="1" max="' +
            pages + '" value="' + (_page + 1) + '"' + (total === 0 ? ' disabled' : '') + '>' +
            '<span class="mb-pager-meta">/ ' + pages + '</span>' +
            '</label>' +
            '<button type="button" class="mb-btn ghost mb-pager-btn" data-mb-page="go"' +
            (total === 0 ? ' disabled' : '') + '>' +
            esc(tr('mb.page.go', 'Go')) + '</button>' +
            '<button type="button" class="mb-btn ghost mb-pager-btn" data-mb-page="next"' +
            (atEnd ? ' disabled' : '') + '>' +
            esc(tr('mb.page.next', 'Next')) + '</button>' +
            '<button type="button" class="mb-btn ghost mb-pager-btn" data-mb-page="last"' +
            (atEnd ? ' disabled' : '') + ' title="' + esc(tr('mb.page.last', 'Last page')) + '">' +
            esc(tr('mb.page.lastShort', 'Last »')) + '</button>' +
            '<span class="mb-pager-meta mb-pager-range">' +
            esc(trRepl('mb.page.range', { FROM: from, TO: to, N: total },
                'Showing {FROM}–{TO} of {N}')) +
            '</span>' +
            '</div>';

        function bindHost(host) {
            if (!host) return;
            host.innerHTML = html;
            host.querySelectorAll('[data-mb-page]').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var act = btn.getAttribute('data-mb-page');
                    if (act === 'first') goToPage(0);
                    else if (act === 'prev') goToPage(_page - 1);
                    else if (act === 'next') goToPage(_page + 1);
                    else if (act === 'last') goToPage(pages - 1);
                    else if (act === 'go') {
                        var inp = host.querySelector('[data-mb-page-input]');
                        var v = inp ? parseInt(inp.value, 10) : (_page + 1);
                        goToPage((isNaN(v) ? 1 : v) - 1);
                    }
                });
            });
            var input = host.querySelector('[data-mb-page-input]');
            if (input) {
                input.addEventListener('keydown', function (ev) {
                    if (ev.key === 'Enter') {
                        ev.preventDefault();
                        var v = parseInt(input.value, 10);
                        goToPage((isNaN(v) ? 1 : v) - 1);
                    }
                });
            }
        }

        bindHost(pick('mbPagerTop'));
        bindHost(pick('mbPager'));
    }

    function updateCounts() {
        var el = pick('mbCounts');
        if (!el) return;
        var selIds = Object.keys(_selected);
        var withPhone = 0;
        var skippedOpt = 0;
        var taggedShown = 0;
        _filtered.forEach(function (p) {
            if (getSentInfo(p)) taggedShown++;
        });
        selIds.forEach(function (id) {
            var p = _allPatients.find(function (x) { return String(x.id) === String(id); });
            if (!p) return;
            if (p.messaging_opt_out) skippedOpt++;
            else if (phoneOf(p)) withPhone++;
        });
        el.textContent = trRepl('mb.countsTagged', {
            F: _filtered.length,
            S: selIds.length,
            P: withPhone,
            O: skippedOpt,
            T: taggedShown,
            M: readSentMonths()
        }, '{F} shown · {T} tagged/{M}mo · {S} selected · {P} sendable · {O} opt-out');
    }

    function selectAllFiltered() {
        _filtered.forEach(function (p) { _selected[p.id] = true; });
        renderTable();
        updateCounts();
    }

    function clearSelection() {
        _selected = {};
        renderTable();
        updateCounts();
    }

    // ── Condition builder ────────────────────────────────────────
    function addCondition() {
        var field = (pick('mbCondField') && pick('mbCondField').value) || 'district';
        var op = (pick('mbCondOp') && pick('mbCondOp').value) || 'contains';
        var value = (pick('mbCondValue') && pick('mbCondValue').value) || '';
        _conditions.push({ field: field, op: op, value: value });
        if (pick('mbCondValue')) pick('mbCondValue').value = '';
        applyFilters();
    }

    function clearConditions() {
        _conditions = [];
        applyFilters();
    }

    /** Reset every filter dropdown / search / condition chip and show All contacts. */
    function clearAllFilters() {
        restoreConditionsToUi({
            search: '',
            sex: '',
            dobMonth: '',
            hasPhone: '',
            optOut: '',
            sent: '',
            clinic: '',
            extras: []
        });
        var condVal = pick('mbCondValue');
        if (condVal) condVal.value = '';
        var advanced = pick('mbCondChips');
        if (advanced && advanced.closest) {
            var det = advanced.closest('.mb-advanced');
            if (det) det.open = false;
        }
        _activeSegmentId = 'all';
        renderSegments();
        renderConditionChips();
        enrichDoctorFilter().then(function () {
            applyFilters();
            var status = pick('mbStatus');
            if (status) {
                status.textContent = tr('mb.filter.cleared', 'Filters cleared · showing all contacts.');
            }
        });
    }

    function renderConditionChips() {
        var host = pick('mbCondChips');
        if (!host) return;
        var advanced = host.closest ? host.closest('.mb-advanced') : null;
        if (!_conditions.length) {
            host.innerHTML = '';
            return;
        }
        if (advanced) advanced.open = true;
        host.innerHTML = _conditions.map(function (c, i) {
            return (
                '<span class="mb-chip">' +
                esc(c.field + ' ' + c.op + ' ' + (c.value || '∅')) +
                ' <button type="button" data-mb-chip-x="' + i + '" aria-label="Remove">×</button></span>'
            );
        }).join('');
        host.querySelectorAll('[data-mb-chip-x]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var i = parseInt(btn.getAttribute('data-mb-chip-x'), 10);
                _conditions.splice(i, 1);
                applyFilters();
            });
        });
    }

    function toggleColEditor() {
        var panel = pick('mbColPanel');
        if (!panel) return;
        var open = panel.style.display !== 'none';
        if (open) {
            panel.style.display = 'none';
            return;
        }
        var cols = loadColPrefs();
        panel.innerHTML = cols.map(function (c, i) {
            return (
                '<label class="mb-col-item"><input type="checkbox" data-mb-col="' + i + '"' +
                (c.on ? ' checked' : '') + '> ' + esc(colLabel(c.key)) + '</label>'
            );
        }).join('') +
            '<button type="button" class="mb-btn ghost" id="mbColSave">' +
            esc(tr('mb.cols.save', 'Save columns')) + '</button>';
        panel.style.display = '';
        var save = pick('mbColSave');
        if (save) {
            save.onclick = function () {
                panel.querySelectorAll('[data-mb-col]').forEach(function (cb) {
                    var i = parseInt(cb.getAttribute('data-mb-col'), 10);
                    cols[i].on = !!cb.checked;
                });
                saveColPrefs(cols);
                panel.style.display = 'none';
                renderTable();
            };
        }
    }

    // ── Campaign wizard ──────────────────────────────────────────
    function startCampaignFromSelection() {
        var ids = Object.keys(_selected);
        if (!ids.length) {
            alert(tr('mb.alert.selectFirst', 'Select at least one contact first.'));
            return;
        }
        _campaignName = trRepl('mb.campaign.defaultName', {
            D: new Date().toISOString().slice(0, 10)
        }, 'Broadcast {D}');
        var nameEl = pick('mbCampaignName');
        if (nameEl) nameEl.value = _campaignName;
        setMode('campaign');
        goWizardStep(1);
        updateAudienceSummary();
    }

    function goWizardStep(step) {
        _wizardStep = Math.min(5, Math.max(1, step || 1));
        syncWizardUi();
        if (_wizardStep >= 3) updateAudienceSummary();
        if (_wizardStep === 1 || _wizardStep === 2) fillTwilioSelects();
        if (_wizardStep === 5) renderReview();
    }

    function syncWizardUi() {
        for (var i = 1; i <= 5; i++) {
            var pane = pick('mbWizardStep' + i);
            if (pane) pane.style.display = i === _wizardStep ? '' : 'none';
            var rail = document.querySelector('#tab-broadcast [data-mb-step="' + i + '"]');
            if (rail) rail.classList.toggle('mb-step-active', i === _wizardStep);
        }
    }

    function setChannel(ch) {
        _channel = ch === 'sms' ? 'sms' : 'whatsapp';
        var wa = pick('mbChWa');
        var sms = pick('mbChSms');
        if (wa) wa.classList.toggle('is-active', _channel === 'whatsapp');
        if (sms) sms.classList.toggle('is-active', _channel === 'sms');
        var waFields = pick('mbWaFields');
        var smsFields = pick('mbSmsFields');
        if (waFields) waFields.style.display = _channel === 'whatsapp' ? '' : 'none';
        if (smsFields) smsFields.style.display = _channel === 'sms' ? '' : 'none';
        fillTwilioSelects();
    }

    function fromOptionLabel(n) {
        var caps = [];
        if (n.whatsapp !== false) caps.push('WA');
        if (n.sms !== false) caps.push('SMS');
        return (n.label || n.phone) + ' · ' + n.phone +
            (caps.length ? ' (' + caps.join('/') + ')' : '');
    }

    function fillTwilioSelects() {
        var fromSel = pick('mbTwilioFrom');
        var tplSel = pick('mbTwilioTpl');
        var setupFrom = pick('mbSetupFrom');
        var setupTpl = pick('mbSetupTpl');
        var prevFrom = fromSel ? String(fromSel.value || 'default') : 'default';
        var prevSetupFrom = setupFrom ? String(setupFrom.value || '') : '';
        var prevSetupTpl = setupTpl ? String(setupTpl.value || '') : '';
        var prevTpl = tplSel ? String(tplSel.value || '') : '';

        function paintCampaignFrom() {
            if (!fromSel || typeof AIHELPER === 'undefined' || !AIHELPER.listTwilioFromNumbers) return;
            var nums = AIHELPER.listTwilioFromNumbers(_channel) || [];
            var defLabel = AIHELPER.getTwilioFromDefaultLabel
                ? AIHELPER.getTwilioFromDefaultLabel()
                : tr('mb.from.default', 'Default (Edge secret)');
            fromSel.innerHTML = '<option value="default">' + esc(defLabel) + '</option>';
            nums.forEach(function (n) {
                var o = document.createElement('option');
                o.value = n.id;
                o.textContent = fromOptionLabel(n);
                fromSel.appendChild(o);
            });
            var has = prevFrom === 'default';
            if (!has) {
                Array.prototype.forEach.call(fromSel.options, function (o) {
                    if (o.value === prevFrom) has = true;
                });
            }
            fromSel.value = has ? prevFrom : 'default';
            onFromChange();
        }

        function paintSetupFrom() {
            if (!setupFrom || typeof AIHELPER === 'undefined' || !AIHELPER.listTwilioFromNumbers) return;
            var nums = AIHELPER.listTwilioFromNumbers() || [];
            setupFrom.innerHTML = '';
            var newOpt = document.createElement('option');
            newOpt.value = '__new__';
            newOpt.textContent = tr('mb.from.addNewOpt', '+ Add new number…');
            setupFrom.appendChild(newOpt);
            if (!nums.length) {
                setupFrom.value = '__new__';
                if (_pendingNewFrom) applyNewFromForm();
                else fillMbFromForm(null);
            } else {
                nums.forEach(function (n) {
                    var o = document.createElement('option');
                    o.value = n.id;
                    o.textContent = fromOptionLabel(n);
                    setupFrom.appendChild(o);
                });
                var has = false;
                if (prevSetupFrom && prevSetupFrom !== '__new__') {
                    Array.prototype.forEach.call(setupFrom.options, function (o) {
                        if (o.value === prevSetupFrom) has = true;
                    });
                }
                if (_pendingNewFrom) {
                    setupFrom.value = '__new__';
                    applyNewFromForm();
                } else {
                    setupFrom.value = has ? prevSetupFrom : (nums[0] ? nums[0].id : '__new__');
                    onSetupFromChange();
                }
            }
        }

        function paintCampaignTpls() {
            if (!tplSel || typeof AIHELPER === 'undefined' || !AIHELPER.listTwilioContentTemplates) return;
            var tpls = AIHELPER.listTwilioContentTemplates() || [];
            tplSel.innerHTML = '';
            var newOpt = document.createElement('option');
            newOpt.value = '__new__';
            newOpt.textContent = tr('mb.tpl.addNewOpt', '+ Add new template…');
            tplSel.appendChild(newOpt);
            if (!tpls.length) {
                var empty = document.createElement('option');
                empty.value = '';
                empty.textContent = tr('mb.tpl.empty', 'No templates — open Twilio Setup');
                tplSel.appendChild(empty);
                tplSel.value = '__new__';
            } else {
                tpls.forEach(function (t) {
                    var o = document.createElement('option');
                    o.value = t.id;
                    o.textContent = (t.label || t.contentSid) + ' · ' + (t.contentSid || '');
                    tplSel.appendChild(o);
                });
                var hasTpl = false;
                if (prevTpl && prevTpl !== '__new__') {
                    Array.prototype.forEach.call(tplSel.options, function (o) {
                        if (o.value === prevTpl) hasTpl = true;
                    });
                }
                tplSel.value = hasTpl ? prevTpl : tpls[0].id;
            }
            onTplChange();
        }

        function paintSetupTpls() {
            if (!setupTpl || typeof AIHELPER === 'undefined' || !AIHELPER.listTwilioContentTemplates) return;
            var tpls = AIHELPER.listTwilioContentTemplates() || [];
            setupTpl.innerHTML = '';
            var pickOpt = document.createElement('option');
            pickOpt.value = '';
            pickOpt.textContent = tpls.length
                ? tr('mb.setup.tplPick', 'Select a template to edit…')
                : tr('mb.setup.tplEmpty', 'No templates yet — add below');
            setupTpl.appendChild(pickOpt);
            var newOpt = document.createElement('option');
            newOpt.value = '__new__';
            newOpt.textContent = tr('mb.tpl.addNewOpt', '+ Add new template…');
            setupTpl.appendChild(newOpt);
            tpls.forEach(function (t) {
                var o = document.createElement('option');
                o.value = t.id;
                o.textContent = (t.label || t.contentSid) + ' · ' + (t.contentSid || '');
                setupTpl.appendChild(o);
            });
            var has = false;
            if (prevSetupTpl && prevSetupTpl !== '__new__') {
                Array.prototype.forEach.call(setupTpl.options, function (o) {
                    if (o.value === prevSetupTpl) has = true;
                });
            }
            if (_pendingNewTpl) {
                setupTpl.value = '__new__';
                applyNewTemplateForm();
            } else {
                setupTpl.value = has ? prevSetupTpl : '';
                onSetupTplChange();
            }
        }

        var fromP = (typeof AIHELPER !== 'undefined' &&
            typeof AIHELPER.ensureTwilioFromNumbers === 'function')
            ? AIHELPER.ensureTwilioFromNumbers(true)
            : Promise.resolve();
        var tplP = (typeof AIHELPER !== 'undefined' &&
            typeof AIHELPER.ensureTwilioContentTemplates === 'function')
            ? AIHELPER.ensureTwilioContentTemplates(true)
            : Promise.resolve();

        Promise.resolve(fromP).then(function () {
            paintCampaignFrom();
            paintSetupFrom();
        }).catch(function () {
            paintCampaignFrom();
            paintSetupFrom();
        });
        Promise.resolve(tplP).then(function () {
            paintCampaignTpls();
            paintSetupTpls();
        }).catch(function () {
            paintCampaignTpls();
            paintSetupTpls();
        });
    }

    function setFromStatus(msg, isErr) {
        var el = pick('mbFromStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = isErr ? '#b91c1c' : '#0f766e';
    }

    function fillMbFromForm(row) {
        var labelEl = pick('mbFromLabel');
        var phoneEl = pick('mbFromPhone');
        var capWa = pick('mbFromCapWa');
        var capSms = pick('mbFromCapSms');
        if (!row) {
            if (labelEl) labelEl.value = '';
            if (phoneEl) phoneEl.value = '';
            if (capWa) capWa.checked = true;
            if (capSms) capSms.checked = true;
            return;
        }
        if (labelEl) labelEl.value = row.label || '';
        if (phoneEl) phoneEl.value = row.phone || '';
        if (capWa) capWa.checked = row.whatsapp !== false;
        if (capSms) capSms.checked = row.sms !== false;
    }

    function readMbFromForm() {
        return {
            label: pick('mbFromLabel') ? String(pick('mbFromLabel').value || '').trim() : '',
            phone: pick('mbFromPhone') ? String(pick('mbFromPhone').value || '').trim() : '',
            whatsapp: !pick('mbFromCapWa') || !!pick('mbFromCapWa').checked,
            sms: !pick('mbFromCapSms') || !!pick('mbFromCapSms').checked
        };
    }

    function onFromChange() {
        var sel = pick('mbTwilioFrom');
        var hint = pick('mbTwilioFromHint');
        var id = sel ? String(sel.value || 'default') : 'default';
        var row = null;
        if (id !== 'default' && typeof AIHELPER !== 'undefined' && AIHELPER.getTwilioFromNumber) {
            row = AIHELPER.getTwilioFromNumber(id);
        }
        if (hint) {
            if (!row) {
                hint.textContent = tr('mb.from.hintDefault',
                    'Default uses Edge secrets. Pick a saved clinic number to override.');
            } else {
                hint.textContent = trRepl('mb.from.hintSelected', {
                    FROM: row.phone,
                    LABEL: row.label || row.phone
                }, 'Sending from {LABEL} ({FROM})');
            }
        }
    }

    var _pendingNewFrom = false;

    function applyNewFromForm() {
        var setupSel = pick('mbSetupFrom');
        if (setupSel) {
            var hasNew = false;
            Array.prototype.forEach.call(setupSel.options, function (o) {
                if (o.value === '__new__') hasNew = true;
            });
            if (!hasNew) {
                var opt = document.createElement('option');
                opt.value = '__new__';
                opt.textContent = tr('mb.from.addNewOpt', '+ Add new number…');
                if (setupSel.firstChild) setupSel.insertBefore(opt, setupSel.firstChild);
                else setupSel.appendChild(opt);
            }
            setupSel.value = '__new__';
        }
        fillMbFromForm(null);
        setFromStatus(tr('mb.from.newHint',
            'New number — enter Label + E.164 phone (e.g. +85291234567), tick channels, then Add number.'), false);
        var phone = pick('mbFromPhone');
        if (phone) {
            try { phone.focus(); } catch (e) { /* ignore */ }
        }
        _pendingNewFrom = false;
    }

    function beginNewFromNumber() {
        _pendingNewFrom = true;
        if (_mode !== 'twilio') {
            setMode('twilio');
            setTimeout(function () {
                if (_pendingNewFrom) applyNewFromForm();
            }, 200);
            return;
        }
        applyNewFromForm();
    }

    function onSetupFromChange() {
        var sel = pick('mbSetupFrom');
        var id = sel ? String(sel.value || '') : '';
        if (id === '__new__') {
            beginNewFromNumber();
            return;
        }
        var row = null;
        if (id && typeof AIHELPER !== 'undefined' && AIHELPER.getTwilioFromNumber) {
            row = AIHELPER.getTwilioFromNumber(id);
        }
        fillMbFromForm(row);
    }

    function selectFromInDropdown(id) {
        var setupSel = pick('mbSetupFrom');
        var campSel = pick('mbTwilioFrom');
        if (setupSel && id) {
            var hasSetup = false;
            Array.prototype.forEach.call(setupSel.options, function (o) {
                if (o.value === id) hasSetup = true;
            });
            if (hasSetup) {
                setupSel.value = id;
                // Avoid re-entering beginNewFromNumber when selecting a real id
                var row = (typeof AIHELPER !== 'undefined' && AIHELPER.getTwilioFromNumber)
                    ? AIHELPER.getTwilioFromNumber(id) : null;
                fillMbFromForm(row);
            }
        }
        if (campSel && id) {
            var hasCamp = false;
            Array.prototype.forEach.call(campSel.options, function (o) {
                if (o.value === id) hasCamp = true;
            });
            if (hasCamp) {
                campSel.value = id;
                onFromChange();
            }
        }
    }

    function addFromNumber() {
        if (typeof AIHELPER === 'undefined' ||
            typeof AIHELPER.addTwilioFromNumberOpts !== 'function') {
            alert(tr('mb.alert.twilioDown', 'Twilio send unavailable. Open AI Helper → Twilio Send.'));
            return;
        }
        var form = readMbFromForm();
        setFromStatus(tr('mb.from.saving', 'Saving…'), false);
        AIHELPER.addTwilioFromNumberOpts(form).then(function (res) {
            if (!res || !res.ok) {
                var err = res && res.error;
                if (err === 'phone') {
                    alert(tr('mb.from.needPhone',
                        'Enter a valid E.164 phone (e.g. +85291234567). Digits only after +, with country code.'));
                } else if (err === 'caps') alert(tr('mb.from.needCap', 'Enable WhatsApp and/or SMS.'));
                else if (err === 'dup') alert(tr('mb.from.dup', 'That number is already in the list.'));
                else if (err === 'db_missing') {
                    alert(tr('mb.from.dbMissing',
                        'Cloud from-numbers table missing. Run twilio_from_numbers.sql in Supabase.'));
                } else {
                    alert(tr('mb.from.saveFail', 'Could not save sender number.') +
                        (err ? '\n\n' + err : ''));
                }
                setFromStatus(err || tr('mb.from.saveFail', 'Could not save sender number.'), true);
                return;
            }
            fillTwilioSelects();
            if (res.id) setTimeout(function () { selectFromInDropdown(res.id); }, 80);
            setFromStatus(tr('mb.from.added', 'Sender number added for all staff.'), false);
        });
    }

    function saveFromNumber() {
        if (typeof AIHELPER === 'undefined' ||
            typeof AIHELPER.updateTwilioFromNumberOpts !== 'function') {
            alert(tr('mb.alert.twilioDown', 'Twilio send unavailable. Open AI Helper → Twilio Send.'));
            return;
        }
        var sel = pick('mbSetupFrom');
        var id = sel ? String(sel.value || '') : '';
        // No selection / new → add instead of blocking
        if (!id || id === '__new__' ||
            (typeof AIHELPER.getTwilioFromNumber === 'function' && !AIHELPER.getTwilioFromNumber(id))) {
            addFromNumber();
            return;
        }
        var form = readMbFromForm();
        setFromStatus(tr('mb.from.saving', 'Saving…'), false);
        AIHELPER.updateTwilioFromNumberOpts(id, form).then(function (res) {
            if (!res || !res.ok) {
                var err = res && res.error;
                if (err === 'select') {
                    addFromNumber();
                    return;
                }
                if (err === 'phone') {
                    alert(tr('mb.from.needPhone',
                        'Enter a valid E.164 phone (e.g. +85291234567). Digits only after +, with country code.'));
                } else if (err === 'caps') alert(tr('mb.from.needCap', 'Enable WhatsApp and/or SMS.'));
                else if (err === 'db_missing') {
                    alert(tr('mb.from.dbMissing',
                        'Cloud from-numbers table missing. Run twilio_from_numbers.sql in Supabase.'));
                } else {
                    alert(tr('mb.from.saveFail', 'Could not save sender number.') +
                        (err ? '\n\n' + err : ''));
                }
                setFromStatus(err || tr('mb.from.saveFail', 'Could not save sender number.'), true);
                return;
            }
            fillTwilioSelects();
            setTimeout(function () { selectFromInDropdown(id); }, 80);
            setFromStatus(tr('mb.from.saved', 'Sender number saved for all staff.'), false);
        });
    }

    function removeFromNumber() {
        if (typeof AIHELPER === 'undefined' ||
            typeof AIHELPER.removeTwilioFromNumberOpts !== 'function') {
            alert(tr('mb.alert.twilioDown', 'Twilio send unavailable. Open AI Helper → Twilio Send.'));
            return;
        }
        var sel = pick('mbSetupFrom');
        var id = sel ? String(sel.value || '') : '';
        if (!id || id === '__new__') {
            alert(tr('mb.from.needSelect', 'Select a saved number from the list first.'));
            return;
        }
        var row = AIHELPER.getTwilioFromNumber ? AIHELPER.getTwilioFromNumber(id) : null;
        var label = row ? (row.label || row.phone) : id;
        if (!window.confirm(trRepl('mb.from.removeConfirm', { LABEL: label },
            'Remove sender “{LABEL}” from the clinic list?'))) {
            return;
        }
        setFromStatus(tr('mb.from.saving', 'Saving…'), false);
        AIHELPER.removeTwilioFromNumberOpts(id).then(function (res) {
            if (!res || !res.ok) {
                alert(tr('mb.from.saveFail', 'Could not save sender number.') +
                    (res && res.error ? '\n\n' + res.error : ''));
                setFromStatus((res && res.error) || tr('mb.from.saveFail', 'Could not save sender number.'), true);
                return;
            }
            fillTwilioSelects();
            setFromStatus(tr('mb.from.removed', 'Sender number removed from clinic list.'), false);
        });
    }

    function reloadFromNumbers() {
        if (typeof AIHELPER === 'undefined') return;
        setFromStatus(tr('mb.from.reloading', 'Reloading…'), false);
        var p = typeof AIHELPER.reloadTwilioFromNumbers === 'function'
            ? AIHELPER.reloadTwilioFromNumbers()
            : (AIHELPER.ensureTwilioFromNumbers
                ? AIHELPER.ensureTwilioFromNumbers(true)
                : Promise.resolve());
        Promise.resolve(p).then(function () {
            fillTwilioSelects();
            setFromStatus(tr('mb.from.reloaded', 'Sender numbers reloaded from cloud.'), false);
        }).catch(function () {
            fillTwilioSelects();
            setFromStatus(tr('mb.from.saveFail', 'Could not save sender number.'), true);
        });
    }

    function setTplStatus(msg, isErr) {
        var el = pick('mbTplStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = isErr ? '#b91c1c' : '#0f766e';
    }

    function fillMbTplForm(tpl) {
        var labelEl = pick('mbTplLabel');
        var sidEl = pick('mbTplSid');
        var varsEl = pick('mbTplVars');
        var notesEl = pick('mbTplNotes');
        if (!tpl) {
            if (labelEl) labelEl.value = '';
            if (sidEl) sidEl.value = '';
            if (varsEl) varsEl.value = '1';
            if (notesEl) notesEl.value = '';
            renderMbTplVarMap('1', { '1': 'NAME' });
            renderTplPreview(null);
            return;
        }
        if (labelEl) labelEl.value = tpl.label || '';
        if (sidEl) sidEl.value = tpl.contentSid || '';
        if (varsEl) varsEl.value = tpl.vars || '1';
        if (notesEl) notesEl.value = tpl.notes || '';
        renderMbTplVarMap(tpl.vars || '1', tpl.varMap);
        renderTplPreview(tpl);
    }

    function renderMbTplVarMap(varsStr, varMap) {
        if (typeof AIHELPER !== 'undefined' && typeof AIHELPER.renderTplVarMapInto === 'function') {
            AIHELPER.renderTplVarMapInto('mbTplVarMap', varsStr, varMap);
            return;
        }
        var box = pick('mbTplVarMap');
        if (box) box.innerHTML = '';
    }

    function readMbTplVarMap(varsStr) {
        if (typeof AIHELPER !== 'undefined' && typeof AIHELPER.readTplVarMapFromContainer === 'function') {
            return AIHELPER.readTplVarMapFromContainer('mbTplVarMap', varsStr);
        }
        if (typeof AIHELPER !== 'undefined' && typeof AIHELPER.normalizeTplVarMap === 'function') {
            return AIHELPER.normalizeTplVarMap(varsStr, null);
        }
        return { '1': 'NAME' };
    }

    function sampleValueForField(field) {
        var f = String(field || '').toUpperCase();
        if (f === 'NAME' || f === 'FIRST') return 'Alex';
        if (f === 'FULL_NAME' || f === 'ENGLISH') return 'Alex Chan';
        if (f === 'CHINESE') return '陳大文';
        if (f === 'CLINIC') return 'Joyful Smile';
        if (f === 'DATE') return '2026-07-22';
        if (f === 'TIME') return '10:00 AM';
        if (f === 'DOCTOR') return 'Chan';
        if (f === 'TREATMENT') return 'Check-up';
        if (f === 'PHONE') return '+85291234567';
        if (f === 'PATIENT_NO') return '001234';
        if (f === 'BODY') return '…';
        return 'Sample';
    }

    function sampleValueForVarKey(key, varMap) {
        var k = String(key || '').trim();
        var map = varMap || {};
        var field = map[k];
        if (field) return sampleValueForField(field);
        if (k === '1') return 'Alex';
        if (k === '2') return 'Joyful Smile';
        if (k === '3') return '2026-07-22';
        if (k === '4') return '10:00 AM';
        if (k === '5') return 'Chan';
        return 'Sample ' + k;
    }

    /** Build a next-day style body using {{n}} tokens from the current map. */
    function defaultPreviewBodyFromMap(varsStr, varMap) {
        var map = varMap || {};
        if (typeof AIHELPER !== 'undefined' && typeof AIHELPER.normalizeTplVarMap === 'function') {
            map = AIHELPER.normalizeTplVarMap(varsStr, varMap);
        }
        var byField = {};
        Object.keys(map).forEach(function (k) {
            byField[String(map[k] || '').toUpperCase()] = k;
        });
        function tok(field) {
            var k = byField[field];
            return k ? ('{{' + k + '}}') : ('{' + field + '}');
        }
        return 'Hi ' + tok('NAME') + ', this is ' + tok('CLINIC') +
            '. Reminder: your appointment is on ' + tok('DATE') +
            ' at ' + tok('TIME') + ' with Dr ' + tok('DOCTOR') +
            '. Please reply to confirm. Thank you.';
    }

    function broadcastClinicName(p) {
        if (typeof currentClinicLabel !== 'undefined' && currentClinicLabel) {
            return String(currentClinicLabel);
        }
        return clinicLabel(p && p.clinic_tag) || 'Joyful Smile';
    }

    function broadcastDoctorName(appt) {
        if (!appt) return '';
        if (typeof apptDoctorNameForWhatsApp === 'function') {
            return apptDoctorNameForWhatsApp(appt);
        }
        return String(appt.doctor_name || appt.doctor_code || '').trim();
    }

    /** Next upcoming appointment for a patient (for date/time/doctor fields). */
    function fetchNextAppointment(p) {
        if (!p || !p.id || typeof SB === 'undefined' || !SB.from) {
            return Promise.resolve(null);
        }
        if (Object.prototype.hasOwnProperty.call(p, '_nextAppt')) {
            return Promise.resolve(p._nextAppt);
        }
        var today = typeof todayISO === 'function'
            ? todayISO()
            : new Date().toISOString().slice(0, 10);
        return SB.from('appointments')
            .select('date,start_time,doctor_code,doctor_name,patient_name,patient_chinese_name')
            .eq('patient_id', p.id)
            .gte('date', today)
            .order('date', { ascending: true })
            .order('start_time', { ascending: true })
            .limit(1)
            .then(function (r) {
                var row = r && !r.error && r.data && r.data.length ? r.data[0] : null;
                p._nextAppt = row;
                return row;
            })
            .catch(function () {
                p._nextAppt = null;
                return null;
            });
    }

    function buildPreviewBubbleHtml(notes, varsStr, varMap) {
        var keys = String(varsStr || '1').split(',')
            .map(function (s) { return String(s || '').trim(); })
            .filter(Boolean);
        var map = varMap || readMbTplVarMap(varsStr || '1');
        var raw = String(notes || '').trim();
        var auto = false;
        if (!raw) {
            raw = defaultPreviewBodyFromMap(varsStr, map);
            auto = true;
        }
        // Escape first, then highlight {{n}} / {FIELD} with sample values.
        var html = esc(raw);
        keys.forEach(function (k) {
            var sample = esc(sampleValueForVarKey(k, map));
            var chip = '<span class="mb-tpl-var">' + sample + '</span>';
            var reBrace = new RegExp('\\{\\{\\s*' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\}\\}', 'g');
            var reSingle = new RegExp('\\{' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\}', 'g');
            html = html.replace(reBrace, chip).replace(reSingle, chip);
        });
        var fields = (typeof AIHELPER !== 'undefined' && AIHELPER.listTwilioWebFields)
            ? AIHELPER.listTwilioWebFields()
            : ['NAME', 'FULL_NAME', 'CLINIC', 'DATE', 'TIME', 'DOCTOR', 'PHONE', 'PATIENT_NO', 'BODY'];
        fields.forEach(function (f) {
            var sample = esc(sampleValueForField(f));
            var chip = '<span class="mb-tpl-var">' + sample + '</span>';
            var re = new RegExp('\\{\\s*' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\}', 'gi');
            html = html.replace(re, chip);
        });
        html = html.replace(/\{\{\s*([0-9A-Za-z_]+)\s*\}\}/g, function (_m, k) {
            return '<span class="mb-tpl-var">' + esc(sampleValueForVarKey(k, map)) + '</span>';
        });
        return { html: html, muted: false, auto: auto };
    }

    function renderTplPreview(tplOrNull) {
        var emptyEl = pick('mbTplPreviewEmpty');
        var bodyEl = pick('mbTplPreviewBody');
        var textEl = pick('mbTplPreviewText');
        var factsEl = pick('mbTplPreviewFacts');
        var metaEl = pick('mbTplPreviewMeta');
        var form = readMbTplForm();
        var hasSelection = !!(pick('mbSetupTpl') && pick('mbSetupTpl').value);
        var hasDraft = !!(form.label || form.contentSid || form.notes);
        var src = tplOrNull || (hasSelection || hasDraft ? {
            label: form.label,
            contentSid: form.contentSid,
            vars: form.vars || '1',
            varMap: form.varMap,
            notes: form.notes
        } : null);

        if (!src || (!src.label && !src.contentSid && !src.notes && !hasSelection)) {
            if (emptyEl) emptyEl.style.display = '';
            if (bodyEl) bodyEl.style.display = 'none';
            if (metaEl) metaEl.textContent = '';
            return;
        }

        if (emptyEl) emptyEl.style.display = 'none';
        if (bodyEl) bodyEl.style.display = '';
        if (metaEl) {
            metaEl.textContent = src.label
                ? src.label
                : tr('mb.setup.tplPreview', 'Template preview');
        }

        var bubble = buildPreviewBubbleHtml(src.notes, src.vars || '1', src.varMap);
        if (textEl) {
            textEl.innerHTML = bubble.html;
            textEl.classList.toggle('is-muted', !!bubble.muted);
        }
        if (metaEl && bubble.auto) {
            metaEl.textContent = (src.label || tr('mb.setup.tplPreview', 'Template preview')) +
                ' · ' + tr('mb.setup.tplPreviewAuto', 'auto sample');
        }

        if (factsEl) {
            var keys = String(src.vars || '1').split(',')
                .map(function (s) { return String(s || '').trim(); })
                .filter(Boolean);
            var map = src.varMap || readMbTplVarMap(src.vars || '1');
            var varDesc = keys.map(function (k) {
                var field = map[k] || '?';
                return '{{' + k + '}} → {' + field + '} = ' + sampleValueForVarKey(k, map);
            }).join(' · ') || '—';
            factsEl.innerHTML =
                '<dt>' + esc(tr('mb.setup.tplPreviewLabel', 'Label')) + '</dt>' +
                '<dd>' + esc(src.label || '—') + '</dd>' +
                '<dt>' + esc(tr('mb.setup.tplPreviewSid', 'Content SID')) + '</dt>' +
                '<dd>' + esc(src.contentSid || '—') + '</dd>' +
                '<dt>' + esc(tr('mb.setup.tplPreviewVars', 'Variables')) + '</dt>' +
                '<dd>' + esc(keys.length ? keys.map(function (k) {
                    return '{{' + k + '}}→{' + (map[k] || '?') + '}';
                }).join(', ') : '—') + '</dd>' +
                '<dt>' + esc(tr('mb.setup.tplPreviewSample', 'Sample')) + '</dt>' +
                '<dd>' + esc(varDesc) + '</dd>';
        }
    }

    function refreshTplPreviewFromForm(evOrOpts) {
        var remapVars = false;
        if (evOrOpts && evOrOpts.target && evOrOpts.target.id === 'mbTplVars') {
            remapVars = true;
        } else if (evOrOpts && evOrOpts.remapVars) {
            remapVars = true;
        }
        var sel = pick('mbSetupTpl');
        var id = sel ? String(sel.value || '') : '';
        var tpl = null;
        if (id && typeof AIHELPER !== 'undefined' && AIHELPER.getTwilioContentTemplate) {
            tpl = AIHELPER.getTwilioContentTemplate(id);
        }
        var varsVal = (pick('mbTplVars') && pick('mbTplVars').value) || (tpl && tpl.vars) || '1';
        if (remapVars) {
            var keep = readMbTplVarMap(varsVal);
            renderMbTplVarMap(varsVal, keep);
        }
        var liveMap = readMbTplVarMap(varsVal);
        renderTplPreview({
            label: (pick('mbTplLabel') && pick('mbTplLabel').value) || (tpl && tpl.label) || '',
            contentSid: (pick('mbTplSid') && pick('mbTplSid').value) || (tpl && tpl.contentSid) || '',
            vars: varsVal,
            varMap: liveMap,
            notes: (pick('mbTplNotes') && pick('mbTplNotes').value) || (tpl && tpl.notes) || ''
        });
    }

    function readMbTplForm() {
        var vars = pick('mbTplVars') ? String(pick('mbTplVars').value || '1').trim() : '1';
        return {
            label: pick('mbTplLabel') ? String(pick('mbTplLabel').value || '').trim() : '',
            contentSid: pick('mbTplSid') ? String(pick('mbTplSid').value || '').trim() : '',
            vars: vars,
            varMap: readMbTplVarMap(vars),
            notes: pick('mbTplNotes') ? String(pick('mbTplNotes').value || '').trim() : ''
        };
    }

    var _pendingNewTpl = false;

    function applyNewTemplateForm() {
        var setupSel = pick('mbSetupTpl');
        if (setupSel) {
            var hasNew = false;
            Array.prototype.forEach.call(setupSel.options, function (o) {
                if (o.value === '__new__') hasNew = true;
            });
            if (!hasNew) {
                var opt = document.createElement('option');
                opt.value = '__new__';
                opt.textContent = tr('mb.tpl.addNewOpt', '+ Add new template…');
                if (setupSel.options.length > 1) {
                    setupSel.insertBefore(opt, setupSel.options[1]);
                } else {
                    setupSel.appendChild(opt);
                }
            }
            setupSel.value = '__new__';
        }
        fillMbTplForm(null);
        var varsEl = pick('mbTplVars');
        if (varsEl) varsEl.value = '1,2,3,4,5';
        renderMbTplVarMap('1,2,3,4,5', null);
        refreshTplPreviewFromForm({ remapVars: true });
        setTplStatus(tr('mb.tpl.newHint',
            'New template — fill Label + Content SID, map variables, then click Add to list.'), false);
        var label = pick('mbTplLabel');
        if (label) {
            try { label.focus(); } catch (e) { /* ignore */ }
        }
        _pendingNewTpl = false;
    }

    function beginNewTemplate() {
        _pendingNewTpl = true;
        if (_mode !== 'twilio') {
            setMode('twilio');
            // fillTwilioSelects is async — re-apply blank form after lists paint
            setTimeout(function () {
                if (_pendingNewTpl) applyNewTemplateForm();
            }, 250);
            return;
        }
        applyNewTemplateForm();
    }

    function onTplChange() {
        var hint = pick('mbTwilioTplHint');
        var sel = pick('mbTwilioTpl');
        var id = sel ? String(sel.value || '') : '';
        if (id === '__new__') {
            beginNewTemplate();
            return;
        }
        var tpl = null;
        if (id && typeof AIHELPER !== 'undefined' && AIHELPER.getTwilioContentTemplate) {
            tpl = AIHELPER.getTwilioContentTemplate(id);
        }
        if (hint) {
            if (!tpl) hint.textContent = '';
            else {
                var map = tpl.varMap || {};
                var bits = Object.keys(map).sort().map(function (k) {
                    return '{{' + k + '}}={' + map[k] + '}';
                }).join(' · ');
                hint.textContent = (tpl.notes || '') +
                    (bits ? ' · ' + bits : (tpl.vars ? ' · vars: ' + tpl.vars : ''));
            }
        }
    }

    function onSetupTplChange() {
        var sel = pick('mbSetupTpl');
        var id = sel ? String(sel.value || '') : '';
        if (id === '__new__') {
            // Avoid re-entry loops while painting selects
            if (!_pendingNewTpl) applyNewTemplateForm();
            return;
        }
        var tpl = null;
        if (id && typeof AIHELPER !== 'undefined' && AIHELPER.getTwilioContentTemplate) {
            tpl = AIHELPER.getTwilioContentTemplate(id);
        }
        fillMbTplForm(tpl);
        if (!id) setTplStatus('', false);
    }

    function selectTplInDropdown(id) {
        var setupSel = pick('mbSetupTpl');
        var campSel = pick('mbTwilioTpl');
        if (setupSel && id) {
            var hasSetup = false;
            Array.prototype.forEach.call(setupSel.options, function (o) {
                if (o.value === id) hasSetup = true;
            });
            if (hasSetup) {
                setupSel.value = id;
                onSetupTplChange();
            }
        }
        if (campSel && id) {
            var hasCamp = false;
            Array.prototype.forEach.call(campSel.options, function (o) {
                if (o.value === id) hasCamp = true;
            });
            if (hasCamp) {
                campSel.value = id;
                onTplChange();
            }
        }
    }

    function addTemplate() {
        if (typeof AIHELPER === 'undefined' ||
            typeof AIHELPER.addTwilioContentTemplate !== 'function') {
            alert(tr('mb.alert.twilioDown', 'Twilio send unavailable. Open AI Helper → Twilio Send.'));
            return;
        }
        var form = readMbTplForm();
        if (!form.contentSid) {
            alert(tr('mb.tpl.needSid', 'Enter a valid Content SID (HX…, 34 chars).'));
            return;
        }
        if (!form.label) {
            form.label = form.contentSid;
            var labelEl = pick('mbTplLabel');
            if (labelEl && !labelEl.value) labelEl.value = form.label;
        }
        setTplStatus(tr('mb.tpl.saving', 'Saving…'), false);
        AIHELPER.addTwilioContentTemplate(form).then(function (res) {
            if (!res || !res.ok) {
                var err = res && res.error;
                if (err === 'sid') alert(tr('mb.tpl.needSid', 'Enter a valid Content SID (HX…, 34 chars).'));
                else if (err === 'dup') alert(tr('mb.tpl.dup', 'That Content SID is already in the list.'));
                else if (err === 'db_missing') {
                    alert(tr('mb.tpl.dbMissing',
                        'Cloud template table missing. Run twilio_content_templates.sql in Supabase.'));
                } else {
                    alert(tr('mb.tpl.saveFail', 'Could not save template.') +
                        (err ? '\n\n' + err : ''));
                }
                setTplStatus(err || tr('mb.tpl.saveFail', 'Could not save template.'), true);
                return;
            }
            fillTwilioSelects();
            if (res.id) {
                setTimeout(function () { selectTplInDropdown(res.id); }, 80);
            }
            setTplStatus(tr('mb.tpl.added', 'Template added for all staff.'), false);
        });
    }

    function saveTemplate() {
        if (typeof AIHELPER === 'undefined' ||
            typeof AIHELPER.updateTwilioContentTemplate !== 'function') {
            alert(tr('mb.alert.twilioDown', 'Twilio send unavailable. Open AI Helper → Twilio Send.'));
            return;
        }
        var sel = pick('mbSetupTpl');
        var id = sel ? String(sel.value || '') : '';
        // New-template draft (or nothing selected): Save acts as Add to list
        if (!id || id === '__new__') {
            addTemplate();
            return;
        }
        var form = readMbTplForm();
        if (!form.contentSid) {
            alert(tr('mb.tpl.needSid', 'Enter a valid Content SID (HX…, 34 chars).'));
            return;
        }
        setTplStatus(tr('mb.tpl.saving', 'Saving…'), false);
        AIHELPER.updateTwilioContentTemplate(id, form).then(function (res) {
            if (!res || !res.ok) {
                var err = res && res.error;
                if (err === 'sid') alert(tr('mb.tpl.needSid', 'Enter a valid Content SID (HX…, 34 chars).'));
                else if (err === 'select') {
                    // Stale selection — fall back to add
                    addTemplate();
                    return;
                } else if (err === 'db_missing') {
                    alert(tr('mb.tpl.dbMissing',
                        'Cloud template table missing. Run twilio_content_templates.sql in Supabase.'));
                } else {
                    alert(tr('mb.tpl.saveFail', 'Could not save template.') +
                        (err ? '\n\n' + err : ''));
                }
                setTplStatus(err || tr('mb.tpl.saveFail', 'Could not save template.'), true);
                return;
            }
            fillTwilioSelects();
            setTimeout(function () { selectTplInDropdown(id); }, 80);
            setTplStatus(tr('mb.tpl.saved', 'Template saved for all staff.'), false);
        });
    }

    function removeTemplate() {
        if (typeof AIHELPER === 'undefined' ||
            typeof AIHELPER.removeTwilioContentTemplate !== 'function') {
            alert(tr('mb.alert.twilioDown', 'Twilio send unavailable. Open AI Helper → Twilio Send.'));
            return;
        }
        var sel = pick('mbSetupTpl');
        var id = sel ? String(sel.value || '') : '';
        if (!id || id === '__new__') {
            alert(tr('mb.tpl.needSelect', 'Select a template from the list first.'));
            return;
        }
        var tpl = AIHELPER.getTwilioContentTemplate
            ? AIHELPER.getTwilioContentTemplate(id)
            : null;
        var label = tpl ? (tpl.label || tpl.contentSid) : id;
        if (!window.confirm(trRepl('mb.tpl.removeConfirm', { LABEL: label },
            'Remove “{LABEL}” from the clinic template list?'))) {
            return;
        }
        setTplStatus(tr('mb.tpl.saving', 'Saving…'), false);
        AIHELPER.removeTwilioContentTemplate(id).then(function (res) {
            if (!res || !res.ok) {
                var err = res && res.error;
                if (err === 'keep_one') {
                    alert(tr('mb.tpl.keepOne', 'Keep at least one template in the list.'));
                } else {
                    alert(tr('mb.tpl.saveFail', 'Could not save template.') +
                        (err ? '\n\n' + err : ''));
                }
                setTplStatus(err || tr('mb.tpl.saveFail', 'Could not save template.'), true);
                return;
            }
            fillTwilioSelects();
            setTplStatus(tr('mb.tpl.removed', 'Template removed from clinic list.'), false);
        });
    }

    function reloadTemplates() {
        if (typeof AIHELPER === 'undefined') return;
        setTplStatus(tr('mb.tpl.reloading', 'Reloading…'), false);
        var p = typeof AIHELPER.reloadTwilioContentTemplates === 'function'
            ? AIHELPER.reloadTwilioContentTemplates()
            : (AIHELPER.ensureTwilioContentTemplates
                ? AIHELPER.ensureTwilioContentTemplates(true)
                : Promise.resolve());
        Promise.resolve(p).then(function () {
            fillTwilioSelects();
            setTplStatus(tr('mb.tpl.reloaded', 'Templates reloaded from cloud.'), false);
        }).catch(function () {
            fillTwilioSelects();
            setTplStatus(tr('mb.tpl.saveFail', 'Could not save template.'), true);
        });
    }

    function selectedRecipients() {
        var out = [];
        Object.keys(_selected).forEach(function (id) {
            var p = _allPatients.find(function (x) { return String(x.id) === String(id); });
            if (p) out.push(p);
        });
        return out;
    }

    function updateAudienceSummary() {
        var el = pick('mbAudienceSummary');
        if (!el) return;
        var list = selectedRecipients();
        var sendable = list.filter(function (p) {
            return phoneOf(p) && !p.messaging_opt_out && phoneE164(phoneOf(p));
        });
        var noPhone = list.filter(function (p) { return !phoneOf(p) || !phoneE164(phoneOf(p)); });
        var opted = list.filter(function (p) { return p.messaging_opt_out; });
        el.innerHTML =
            '<strong>' + esc(String(list.length)) + '</strong> ' +
            esc(tr('mb.aud.selected', 'selected')) + ' · ' +
            '<strong>' + esc(String(sendable.length)) + '</strong> ' +
            esc(tr('mb.aud.sendable', 'sendable')) + ' · ' +
            esc(String(noPhone.length)) + ' ' +
            esc(tr('mb.aud.noPhone', 'no phone')) + ' · ' +
            esc(String(opted.length)) + ' ' +
            esc(tr('mb.aud.optOut', 'opt-out'));
    }

    function personaliseSms(body, p) {
        var clinic = '';
        if (typeof currentClinicLabel !== 'undefined' && currentClinicLabel) {
            clinic = currentClinicLabel;
        } else {
            clinic = clinicLabel(p.clinic_tag);
        }
        var appt = p && Object.prototype.hasOwnProperty.call(p, '_nextAppt')
            ? p._nextAppt
            : null;
        var date = appt && appt.date ? String(appt.date) : '';
        var time = '';
        if (appt && appt.start_time) {
            time = typeof fmt12 === 'function'
                ? String(fmt12(appt.start_time) || '')
                : String(appt.start_time);
        }
        var doctor = broadcastDoctorName(appt);
        return String(body || '')
            .replace(/\{FULL_NAME\}/gi, displayName(p))
            .replace(/\{NAME\}/gi, firstName(p))
            .replace(/\{CLINIC\}/gi, clinic || 'Joyful Smile')
            .replace(/\{DATE\}/gi, date)
            .replace(/\{TIME\}/gi, time)
            .replace(/\{DOCTOR\}/gi, doctor)
            .replace(/\{PHONE\}/gi, phoneOf(p))
            .replace(/\{PATIENT_NO\}/gi, String(p.patient_no || ''));
    }

    function getFromPhone() {
        var sel = pick('mbTwilioFrom');
        var id = sel ? String(sel.value || 'default') : 'default';
        if (id === 'default' || typeof AIHELPER === 'undefined' || !AIHELPER.getTwilioFromNumber) {
            return '';
        }
        var row = AIHELPER.getTwilioFromNumber(id);
        return row && row.phone ? String(row.phone) : '';
    }

    function getSelectedTpl() {
        if (typeof AIHELPER === 'undefined' || !AIHELPER.getTwilioContentTemplate) return null;
        var sel = pick('mbTwilioTpl');
        return AIHELPER.getTwilioContentTemplate(sel ? sel.value : '');
    }

    function renderReview() {
        var el = pick('mbReviewBox');
        if (!el) return;
        var nameEl = pick('mbCampaignName');
        _campaignName = nameEl ? String(nameEl.value || '').trim() : _campaignName;
        var bodyEl = pick('mbSmsBody');
        _smsBody = bodyEl ? String(bodyEl.value || '') : '';
        var tpl = getSelectedTpl();
        var list = selectedRecipients();
        var sendable = list.filter(function (p) {
            return phoneOf(p) && !p.messaging_opt_out && phoneE164(phoneOf(p));
        });
        el.innerHTML =
            '<dl class="mb-review-dl">' +
            '<dt>' + esc(tr('mb.review.name', 'Name')) + '</dt><dd>' + esc(_campaignName || '—') + '</dd>' +
            '<dt>' + esc(tr('mb.review.channel', 'Channel')) + '</dt><dd>' +
            esc(_channel === 'sms' ? 'Twilio SMS' : 'Twilio WhatsApp') + '</dd>' +
            '<dt>' + esc(tr('mb.review.from', 'From')) + '</dt><dd>' +
            esc(getFromPhone() || tr('mb.from.default', 'Default (Edge secret)')) + '</dd>' +
            '<dt>' + esc(tr('mb.review.content', 'Content')) + '</dt><dd>' +
            (_channel === 'whatsapp'
                ? esc((tpl && (tpl.label + ' · ' + tpl.contentSid)) || '—')
                : '<pre class="mb-pre">' + esc(_smsBody || '—') + '</pre>') +
            '</dd>' +
            '<dt>' + esc(tr('mb.review.audience', 'Audience')) + '</dt><dd>' +
            esc(String(sendable.length)) + ' / ' + esc(String(list.length)) +
            '</dd></dl>';
    }

    function sendTest() {
        var phone = window.prompt(
            tr('mb.test.prompt', 'Send test to phone (E.164, e.g. +85291234567)')
        );
        if (phone === null || !String(phone).trim()) return;
        var to = phoneE164(phone);
        if (!to) {
            alert(tr('mb.alert.badPhone', 'Invalid phone number.'));
            return;
        }
        if (typeof AIHELPER === 'undefined' || typeof AIHELPER.sendTwilioOutreach !== 'function') {
            alert(tr('mb.alert.twilioDown', 'Twilio send unavailable. Open AI Helper → Twilio Send.'));
            return;
        }
        // Prefer the selected contact when testing so the sent-window tag sticks to them.
        var selected = selectedRecipients();
        var matched = selected.find(function (p) {
            return phoneE164(phoneOf(p)) === to;
        }) || (selected.length === 1 ? selected[0] : null);
        var fake = matched || {
            full_name: 'Test',
            chinese_name: '',
            patient_no: '',
            mobile_phone: to,
            clinic_tag: clinicTagForFilter()
        };
        buildOutreachOpts(fake).then(function (opts) {
            if (!opts) return;
            opts.to = to;
            opts.name = matched ? firstName(matched) : 'Test';
            var st = pick('mbTestStatus');
            if (st) st.textContent = tr('mb.sending', 'Sending…');
            return AIHELPER.sendTwilioOutreach(opts).then(function (res) {
                if (st) {
                    st.textContent = res && res.ok
                        ? (tr('mb.test.ok', 'Test sent') + (res.result && res.result.sid ? ' · ' + res.result.sid : ''))
                        : String((res && res.error) || tr('mb.send.fail', 'Send failed'));
                }
                if (!(res && res.ok)) {
                    alert(tr('mb.send.fail', 'Send failed') + '\n\n' + ((res && res.error) || ''));
                    return;
                }
                if (matched && matched.id) {
                    rememberSent(matched.id, matched.patient_no, _channel, Date.now());
                    return insertLogs([{
                        campaign_id: null,
                        patient_id: matched.id,
                        patient_no: matched.patient_no || null,
                        patient_name: displayName(matched),
                        to_phone: to,
                        channel: _channel,
                        from_phone: opts.from || getFromPhone() || null,
                        content_sid: opts.contentSid || null,
                        body_preview: (opts.body || '').slice(0, 200),
                        status: 'sent',
                        twilio_sid: res.result && res.result.sid ? String(res.result.sid) : null,
                        clinic_tag: matched.clinic_tag || null,
                        sent_by: (typeof currentUserId !== 'undefined' ? currentUserId : null) || null
                    }]);
                }
            });
        });
    }

    function buildOutreachOpts(p) {
        var channel = _channel;
        var name = firstName(p);
        var bodyEl = pick('mbSmsBody');
        var rawBody = bodyEl ? bodyEl.value : _smsBody;
        var opts = { channel: channel, to: phoneE164(phoneOf(p)), name: name, body: '' };
        var from = getFromPhone();
        if (from) opts.from = from;
        if (channel === 'whatsapp') {
            var tpl = getSelectedTpl();
            if (!tpl || !tpl.contentSid) {
                alert(tr('mb.alert.needTpl', 'Select a WhatsApp content template.'));
                return Promise.resolve(null);
            }
            opts.contentSid = tpl.contentSid;
            return fetchNextAppointment(p).then(function (appt) {
                p._nextAppt = appt;
                var body = personaliseSms(rawBody, p);
                opts.body = body;
                var clinic = broadcastClinicName(p);
                var date = appt && appt.date ? String(appt.date) : '';
                var time = '';
                if (appt && appt.start_time) {
                    time = typeof fmt12 === 'function'
                        ? fmt12(appt.start_time)
                        : String(appt.start_time);
                }
                var doctor = broadcastDoctorName(appt);
                if (typeof AIHELPER !== 'undefined' &&
                    typeof AIHELPER.buildTwilioContentVariables === 'function') {
                    opts.contentVariables = AIHELPER.buildTwilioContentVariables(tpl, {
                        name: name,
                        fullName: displayName(p),
                        clinic: clinic,
                        date: date,
                        time: time,
                        doctor: doctor,
                        phone: phoneOf(p),
                        patientNo: p.patient_no || '',
                        body: body
                    });
                } else {
                    opts.contentVariables = { '1': name };
                }
                return opts;
            });
        }
        return fetchNextAppointment(p).then(function (appt) {
            p._nextAppt = appt;
            var body = personaliseSms(rawBody, p);
            opts.body = body;
            if (!body) {
                alert(tr('mb.alert.needBody', 'Enter an SMS message body.'));
                return null;
            }
            return opts;
        });
    }

    function publishCampaign() {
        if (_sending) return;
        if (typeof AIHELPER === 'undefined' || typeof AIHELPER.sendTwilioOutreach !== 'function') {
            alert(tr('mb.alert.twilioDown', 'Twilio send unavailable. Open AI Helper → Twilio Send.'));
            return;
        }
        var nameEl = pick('mbCampaignName');
        _campaignName = nameEl ? String(nameEl.value || '').trim() : '';
        if (!_campaignName) {
            alert(tr('mb.alert.needName', 'Enter a campaign name.'));
            return;
        }
        if (_channel === 'whatsapp') {
            var tpl = getSelectedTpl();
            if (!tpl || !tpl.contentSid) {
                alert(tr('mb.alert.needTpl', 'Select a WhatsApp content template.'));
                return;
            }
        } else {
            var bodyEl = pick('mbSmsBody');
            if (!bodyEl || !String(bodyEl.value || '').trim()) {
                alert(tr('mb.alert.needBody', 'Enter an SMS message body.'));
                return;
            }
            _smsBody = bodyEl.value;
        }

        var list = selectedRecipients();
        var queue = list.filter(function (p) {
            return phoneOf(p) && !p.messaging_opt_out && phoneE164(phoneOf(p));
        });
        var skipped = list.filter(function (p) {
            return !queue.some(function (q) { return q.id === p.id; });
        });

        if (!queue.length) {
            alert(tr('mb.alert.noneSendable', 'No sendable recipients (phone + not opted out).'));
            return;
        }

        var ok = window.confirm(trRepl('mb.confirm.publish', {
            N: queue.length,
            SKIP: skipped.length,
            CH: _channel === 'sms' ? 'SMS' : 'WhatsApp'
        }, 'Send {CH} to {N} contacts? ({SKIP} will be skipped)'));
        if (!ok) return;

        _sending = true;
        _sendAbort = false;
        var st = pick('mbSendStatus');
        var prog = pick('mbSendProgress');
        if (st) st.textContent = tr('mb.sending', 'Sending…');

        var doc = selectedDoctorMeta();
        var campaignPayload = {
            name: _campaignName,
            channel: _channel,
            from_phone: getFromPhone() || null,
            content_sid: _channel === 'whatsapp' ? (getSelectedTpl() && getSelectedTpl().contentSid) : null,
            body_template: _channel === 'sms' ? _smsBody : null,
            audience_mode: 'selection',
            audience_snapshot: {
                selectedIds: queue.map(function (p) { return p.id; }),
                skipped: skipped.length,
                filters: snapshotConditions()
            },
            status: 'sending',
            totals: { sent: 0, failed: 0, skipped: skipped.length, queued: queue.length },
            clinic_tag: clinicTagForFilter() || null,
            doctor_code: doc ? String(doc.doctor_code || '') : null,
            created_by: (typeof currentUserId !== 'undefined' ? currentUserId : null) || null
        };

        createCampaign(campaignPayload).then(function (campaignId) {
            // log skips
            var skipLogs = skipped.map(function (p) {
                return {
                    campaign_id: campaignId,
                    patient_id: p.id,
                    patient_no: p.patient_no || null,
                    patient_name: displayName(p),
                    to_phone: phoneOf(p) || null,
                    channel: _channel,
                    from_phone: campaignPayload.from_phone,
                    content_sid: campaignPayload.content_sid,
                    body_preview: null,
                    status: 'skipped',
                    error: p.messaging_opt_out ? 'opt_out' : 'no_phone',
                    clinic_tag: p.clinic_tag || null,
                    doctor_code: campaignPayload.doctor_code,
                    sent_by: campaignPayload.created_by
                };
            });
            var chain = skipLogs.length ? insertLogs(skipLogs) : Promise.resolve();

            var sent = 0;
            var failed = 0;
            var idx = 0;

            function tick() {
                if (_sendAbort || idx >= queue.length) {
                    return finish(campaignId, sent, failed, skipped.length);
                }
                var p = queue[idx];
                idx++;
                if (prog) {
                    prog.style.width = Math.round((idx / queue.length) * 100) + '%';
                }
                if (st) {
                    st.textContent = trRepl('mb.send.progress', {
                        CUR: idx, TOTAL: queue.length, NAME: displayName(p)
                    }, 'Sending {CUR}/{TOTAL}: {NAME}');
                }
                return buildOutreachOpts(p).then(function (opts) {
                    if (!opts) {
                        failed++;
                        return insertLogs([{
                            campaign_id: campaignId,
                            patient_id: p.id,
                            patient_no: p.patient_no || null,
                            patient_name: displayName(p),
                            to_phone: phoneE164(phoneOf(p)),
                            channel: _channel,
                            status: 'failed',
                            error: 'bad_opts',
                            sent_by: campaignPayload.created_by
                        }]).then(delay).then(tick);
                    }
                    return AIHELPER.sendTwilioOutreach(opts).then(function (res) {
                        if (res && res.ok) {
                            sent++;
                            // Tag immediately so Contacts filter works even if log insert lags/fails.
                            rememberSent(p.id, p.patient_no, _channel, Date.now());
                            return insertLogs([{
                                campaign_id: campaignId,
                                patient_id: p.id,
                                patient_no: p.patient_no || null,
                                patient_name: displayName(p),
                                to_phone: opts.to,
                                channel: _channel,
                                from_phone: opts.from || campaignPayload.from_phone,
                                content_sid: opts.contentSid || null,
                                body_preview: (opts.body || '').slice(0, 200),
                                status: 'sent',
                                twilio_sid: res.result && res.result.sid ? String(res.result.sid) : null,
                                clinic_tag: p.clinic_tag || null,
                                doctor_code: campaignPayload.doctor_code,
                                sent_by: campaignPayload.created_by
                            }]);
                        }
                        failed++;
                        return insertLogs([{
                            campaign_id: campaignId,
                            patient_id: p.id,
                            patient_no: p.patient_no || null,
                            patient_name: displayName(p),
                            to_phone: opts.to,
                            channel: _channel,
                            from_phone: opts.from || null,
                            content_sid: opts.contentSid || null,
                            body_preview: (opts.body || '').slice(0, 200),
                            status: 'failed',
                            error: (res && res.error) ? String(res.error).slice(0, 500) : 'fail',
                            clinic_tag: p.clinic_tag || null,
                            doctor_code: campaignPayload.doctor_code,
                            sent_by: campaignPayload.created_by
                        }]);
                    }).then(delay).then(tick);
                });
            }

            return chain.then(tick);
        }).catch(function (e) {
            _sending = false;
            if (st) st.textContent = (e && e.message) ? e.message : tr('mb.send.fail', 'Send failed');
            alert(tr('mb.send.fail', 'Send failed') + '\n\n' + ((e && e.message) || ''));
        });
    }

    function delay() {
        return new Promise(function (resolve) { setTimeout(resolve, SEND_DELAY_MS); });
    }

    function finish(campaignId, sent, failed, skipped) {
        _sending = false;
        var totals = { sent: sent, failed: failed, skipped: skipped, queued: sent + failed };
        var st = pick('mbSendStatus');
        if (st) {
            st.textContent = trRepl('mb.send.done', {
                S: sent, F: failed, K: skipped
            }, 'Done — sent {S}, failed {F}, skipped {K}');
        }
        updateCampaign(campaignId, {
            status: failed && !sent ? 'failed' : 'completed',
            totals: totals,
            completed_at: new Date().toISOString()
        }).finally(function () {
            alert(trRepl('mb.send.done', { S: sent, F: failed, K: skipped },
                'Done — sent {S}, failed {F}, skipped {K}'));
            _historyDetailId = campaignId;
            // Refresh tags first, then open history (contacts pane reloads tags on return).
            loadSentHistory().finally(function () {
                setMode('history');
            });
        });
    }

    function createCampaign(payload) {
        if (typeof SB === 'undefined') return Promise.reject(new Error('No SB'));
        return SB.from('message_campaigns').insert([payload]).select('id').single()
            .then(function (r) {
                if (r.error) {
                    if (!_logMissingWarned && /message_campaigns|does not exist|schema cache/i.test(String(r.error.message || ''))) {
                        _logMissingWarned = true;
                        console.warn('[MASSBC] Run message_broadcast.sql in Supabase. Continuing without DB log.');
                    }
                    // local fallback id so send can proceed
                    return 'local_' + Date.now();
                }
                return r.data.id;
            });
    }

    function updateCampaign(id, patch) {
        if (!id || String(id).indexOf('local_') === 0 || typeof SB === 'undefined') {
            return Promise.resolve();
        }
        return SB.from('message_campaigns').update(patch).eq('id', id).then(function () { /* ok */ });
    }

    function insertLogs(rows) {
        if (!rows || !rows.length || typeof SB === 'undefined') return Promise.resolve();
        // Even if campaign insert failed (local_*), still persist recipient logs so
        // Contacts "messaged in window" tags/filters keep working.
        var payload = rows.map(function (row) {
            var copy = Object.assign({}, row);
            if (String(copy.campaign_id || '').indexOf('local_') === 0) {
                copy.campaign_id = null;
            }
            return copy;
        });
        return SB.from('message_send_log').insert(payload).then(function (r) {
            if (r.error) {
                console.warn('[MASSBC] message_send_log insert failed:', r.error.message);
                if (!_logMissingWarned &&
                    /message_send_log|does not exist|schema cache/i.test(String(r.error.message || ''))) {
                    _logMissingWarned = true;
                }
            }
        });
    }

    // ── History ──────────────────────────────────────────────────
    function loadHistory() {
        var body = pick('mbHistoryBody');
        if (!body) return;
        body.innerHTML =
            '<tr><td colspan="6" class="mb-empty">' + esc(tr('mb.loading', 'Loading…')) + '</td></tr>';
        if (typeof SB === 'undefined') {
            body.innerHTML = '<tr><td colspan="6" class="mb-empty">Supabase unavailable</td></tr>';
            return;
        }
        SB.from('message_campaigns')
            .select('id,name,channel,status,totals,created_at,completed_at,created_by,clinic_tag')
            .order('created_at', { ascending: false })
            .limit(100)
            .then(function (r) {
                if (r.error) {
                    body.innerHTML =
                        '<tr><td colspan="6" class="mb-empty">' +
                        esc(tr('mb.history.needSql',
                            'No campaign log yet. Apply message_broadcast.sql in Supabase SQL Editor.')) +
                        '<br><code>message_broadcast.sql</code></td></tr>';
                    return;
                }
                _historyCampaigns = r.data || [];
                if (!_historyCampaigns.length) {
                    body.innerHTML =
                        '<tr><td colspan="6" class="mb-empty">' +
                        esc(tr('mb.history.empty', 'No campaigns yet.')) +
                        '</td></tr>';
                    return;
                }
                body.innerHTML = _historyCampaigns.map(function (c) {
                    var t = c.totals || {};
                    return (
                        '<tr class="mb-hist-row" data-mb-campaign="' + esc(c.id) + '">' +
                        '<td>' + esc(c.name || '—') + '</td>' +
                        '<td>' + esc(c.channel || '') + '</td>' +
                        '<td>' + esc(c.status || '') + '</td>' +
                        '<td>' + esc(String(t.sent != null ? t.sent : '—')) + ' / ' +
                        esc(String(t.failed != null ? t.failed : '—')) + ' / ' +
                        esc(String(t.skipped != null ? t.skipped : '—')) + '</td>' +
                        '<td>' + esc(clinicLabel(c.clinic_tag)) + '</td>' +
                        '<td>' + esc(String(c.created_at || '').replace('T', ' ').slice(0, 19)) + '</td>' +
                        '</tr>'
                    );
                }).join('');
                if (_historyDetailId) openHistoryDetail(_historyDetailId);
            });
    }

    function openHistoryDetail(campaignId) {
        _historyDetailId = campaignId;
        var host = pick('mbHistoryDetail');
        if (!host || !campaignId) return;
        host.style.display = '';
        host.innerHTML = '<p class="mb-muted">' + esc(tr('mb.loading', 'Loading…')) + '</p>';
        SB.from('message_send_log')
            .select('patient_no,patient_name,to_phone,status,twilio_sid,error,created_at,channel')
            .eq('campaign_id', campaignId)
            .order('created_at', { ascending: true })
            .limit(2000)
            .then(function (r) {
                if (r.error) {
                    host.innerHTML = '<p class="mb-muted">' + esc(r.error.message) + '</p>';
                    return;
                }
                var rows = r.data || [];
                var camp = _historyCampaigns.find(function (c) { return c.id === campaignId; });
                host.innerHTML =
                    '<div class="mb-hist-detail-head">' +
                    '<strong>' + esc(camp ? camp.name : campaignId) + '</strong>' +
                    '<button type="button" class="mb-btn ghost" id="mbExportCsv">' +
                    esc(tr('mb.exportCsv', 'Export CSV')) + '</button></div>' +
                    '<div class="tbl-wrap mb-hist-detail-tbl"><table class="appt-tbl"><thead><tr>' +
                    '<th>' + esc(tr('mb.col.no', 'No.')) + '</th>' +
                    '<th>' + esc(tr('mb.col.name', 'Name')) + '</th>' +
                    '<th>' + esc(tr('mb.col.phone', 'Phone')) + '</th>' +
                    '<th>' + esc(tr('mb.col.status', 'Status')) + '</th>' +
                    '<th>SID</th><th>' + esc(tr('mb.col.error', 'Error')) + '</th>' +
                    '</tr></thead><tbody>' +
                    (rows.length ? rows.map(function (row) {
                        return (
                            '<tr><td>' + esc(row.patient_no || '') + '</td>' +
                            '<td>' + esc(row.patient_name || '') + '</td>' +
                            '<td>' + esc(row.to_phone || '') + '</td>' +
                            '<td>' + esc(row.status || '') + '</td>' +
                            '<td class="mb-mono">' + esc(row.twilio_sid || '') + '</td>' +
                            '<td>' + esc(row.error || '') + '</td></tr>'
                        );
                    }).join('') : '<tr><td colspan="6" class="mb-empty">—</td></tr>') +
                    '</tbody></table></div>';
                var exp = pick('mbExportCsv');
                if (exp) {
                    exp.onclick = function () { exportCsv(camp, rows); };
                }
            });
    }

    function exportCsv(camp, rows) {
        var lines = ['patient_no,patient_name,to_phone,status,twilio_sid,error,created_at'];
        (rows || []).forEach(function (r) {
            lines.push([
                r.patient_no, r.patient_name, r.to_phone, r.status,
                r.twilio_sid, r.error, r.created_at
            ].map(function (v) {
                var s = String(v == null ? '' : v).replace(/"/g, '""');
                return '"' + s + '"';
            }).join(','));
        });
        var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'broadcast_' + (camp && camp.name ? camp.name : 'log')
            .replace(/[^\w\-]+/g, '_') + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function openTwilioSetup() {
        setMode('twilio');
    }

    /** @deprecated Prefer openTwilioSetup — kept for older onclick handlers */
    function openAiTwilioManage() {
        openTwilioSetup();
    }

    // Public API
    return {
        init: init,
        refreshFromBar: refreshFromBar,
        setMode: setMode,
        applyFilters: applyFilters,
        onSentPeriodChange: onSentPeriodChange,
        onSortChange: onSortChange,
        selectAllFiltered: selectAllFiltered,
        clearSelection: clearSelection,
        addCondition: addCondition,
        clearConditions: clearConditions,
        clearAllFilters: clearAllFilters,
        toggleColEditor: toggleColEditor,
        saveCurrentAsSegment: saveCurrentAsSegment,
        startCampaignFromSelection: startCampaignFromSelection,
        goWizardStep: goWizardStep,
        setChannel: setChannel,
        onTplChange: onTplChange,
        onSetupTplChange: onSetupTplChange,
        refreshTplPreviewFromForm: refreshTplPreviewFromForm,
        addTemplate: addTemplate,
        beginNewTemplate: beginNewTemplate,
        saveTemplate: saveTemplate,
        removeTemplate: removeTemplate,
        reloadTemplates: reloadTemplates,
        onFromChange: onFromChange,
        onSetupFromChange: onSetupFromChange,
        addFromNumber: addFromNumber,
        beginNewFromNumber: beginNewFromNumber,
        saveFromNumber: saveFromNumber,
        removeFromNumber: removeFromNumber,
        reloadFromNumbers: reloadFromNumbers,
        sendTest: sendTest,
        publishCampaign: publishCampaign,
        loadHistory: loadHistory,
        openTwilioSetup: openTwilioSetup,
        openAiTwilioManage: openAiTwilioManage,
        loadPatients: loadPatients
    };
})();

window.MASSBC = MASSBC;
