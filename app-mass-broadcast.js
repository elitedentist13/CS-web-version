// ════════════════════════════════════════════════════════════════
// MASS MESSAGE BROADCAST — Appointment tab (SleekFlow-inspired)
// Contacts table + campaign wizard + Twilio send + message log
// Requires: SB, AIHELPER.sendTwilioOutreach, APP_CLINICS, APP_DOCTORS
// ════════════════════════════════════════════════════════════════
var MASSBC = (function () {
    'use strict';

    var SEG_LS_KEY = 'mb_broadcast_segments_v1';
    var SEG_TABLE = 'broadcast_contact_lists';
    var ORG_META_TABLE = 'broadcast_organiser_meta';
    var COL_LS_KEY = 'mb_broadcast_cols_v1';
    var SENT_PERIOD_LS_KEY = 'mb_sent_tag_months_v1';
    /** Local cache of organiser meta (cloud is source of truth for marker/remark). */
    var ORG_LS_KEY = 'mb_list_org_v1';
    var SEND_DELAY_MS = 450;
    var PAGE_SIZE = 80;
    /** Supabase/PostgREST typically caps one response at ~1000 rows — page past that. */
    var PATIENT_FETCH_SIZE = 1000;
    var DEFAULT_SENT_MONTHS = 6;
    var BUILTIN_SEGMENTS = {
        all: 1, scope: 1, hasphone: 1, birthday: 1, sent: 1, unsent: 1
    };
    var BUILTIN_ORDER = ['all', 'scope', 'hasphone', 'birthday', 'sent', 'unsent'];
    /** Active mode when 2+ organiser checkboxes are ticked (OR-union of lists). */
    var UNION_SEGMENT_ID = '__checked_union__';
    /** Gmail-style list markers (remarks column). */
    var LIST_MARKERS = [
        { id: '', icon: '·', labelKey: 'mb.org.mark.none', label: 'None' },
        { id: 'star', icon: '★', labelKey: 'mb.org.mark.star', label: 'Starred' },
        { id: 'important', icon: '❗', labelKey: 'mb.org.mark.important', label: 'Important' },
        { id: 'done', icon: '✓', labelKey: 'mb.org.mark.done', label: 'Done' },
        { id: 'flag', icon: '⚑', labelKey: 'mb.org.mark.flag', label: 'Flagged' },
        { id: 'question', icon: '?', labelKey: 'mb.org.mark.question', label: 'Question' },
        { id: 'progress', icon: '◎', labelKey: 'mb.org.mark.progress', label: 'In progress' },
        { id: 'hold', icon: '⏸', labelKey: 'mb.org.mark.hold', label: 'On hold' }
    ];

    var _mode = 'contacts'; // contacts | campaign | twilio | history
    var _wizardStep = 1;
    var _allPatients = [];
    var _filtered = [];
    var _selected = {}; // id -> true
    /** Anchor patient id for Shift+click range selection in filtered results. */
    var _selectAnchorId = null;
    var _sortKey = 'patient_no';
    var _sortAsc = true;
    var _page = 0;
    var _conditions = [];
    var _activeSegmentId = 'all';
    /** In-memory cache of clinic-wide saved lists (from Supabase). */
    var _segments = [];
    var _segmentsLoading = false;
    var _segmentsDbMissing = false;
    var _segmentsMigrating = false;
    /** In-memory clinic-wide organiser remarks/markers (from Supabase). */
    var _orgCloud = {};
    var _orgCloudLoading = false;
    var _orgMetaDbMissing = false;
    /** Checked list/folder rows in the LHS organiser (id -> true). */
    var _listSelected = {};
    /** Collapsed folder ids (id -> true). */
    var _listCollapsed = {};
    /** Floating marker menu element (body-attached). */
    var _markMenuEl = null;
    var _markMenuTargetId = null;
    /** When set, marker menu applies to these ids (toolbar bulk mark). */
    var _markMenuBulkIds = null;
    /** HTML5 drag-and-drop state for list/folder moves. */
    var _dragListIds = null;
    var _dragOverTargetId = null;
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

    /** Staff UI label: Chinese / English when both exist. */
    function displayName(p) {
        var chi = String((p && p.chinese_name) || '').trim();
        var eng = String((p && p.full_name) || '').trim();
        if (chi && eng) return chi + ' / ' + eng;
        return chi || eng || '—';
    }

    /** Message-language patient full name for {FULL_NAME} in SMS/WhatsApp. */
    function displayNameForMessage(p, bodyHint) {
        var chi = String((p && p.chinese_name) || '').trim();
        var eng = String((p && p.full_name) || '').trim();
        var lang = messageLangFromBody(bodyHint);
        if (lang === 'zh') return chi || eng || '—';
        return eng || chi || '—';
    }

    /** Resolve EN/ZH from message body (same detector as {CLINIC}). */
    function messageLangFromBody(bodyHint) {
        var lang = '';
        if (typeof detectOutboundMessageLang === 'function') {
            lang = detectOutboundMessageLang(bodyHint || '');
        }
        if (!lang && typeof printUiLangIsChinese === 'function' && printUiLangIsChinese()) {
            lang = 'zh';
        }
        return lang === 'zh' ? 'zh' : 'en';
    }

    /**
     * Message-language greeting for {NAME}:
     * - Chinese paragraph → Chinese full name (e.g. 陳大文)
     * - English paragraph → English given/first token (e.g. Alex), fallback Chinese
     */
    function firstNameForMessage(p, bodyHint) {
        var chi = String((p && p.chinese_name) || '').trim();
        var eng = String((p && p.full_name) || '').trim();
        var lang = messageLangFromBody(bodyHint);
        if (lang === 'zh') {
            return chi || eng || 'Patient';
        }
        if (eng) {
            return eng.split(/\s+/)[0] || eng;
        }
        return chi || 'Patient';
    }

    /** Forced English greeting name for {NAME_EN}. */
    function patientNameEn(p) {
        var eng = String((p && p.full_name) || '').trim();
        var chi = String((p && p.chinese_name) || '').trim();
        if (eng) return eng.split(/\s+/)[0] || eng;
        return chi || 'Patient';
    }

    /** Forced Chinese greeting name for {NAME_ZH}. */
    function patientNameZh(p) {
        var chi = String((p && p.chinese_name) || '').trim();
        var eng = String((p && p.full_name) || '').trim();
        return chi || eng || 'Patient';
    }

    function patientFullEn(p) {
        var eng = String((p && p.full_name) || '').trim();
        var chi = String((p && p.chinese_name) || '').trim();
        return eng || chi || '—';
    }

    function patientFullZh(p) {
        var chi = String((p && p.chinese_name) || '').trim();
        var eng = String((p && p.full_name) || '').trim();
        return chi || eng || '—';
    }

    function clinicRecordForPatient(p) {
        if (typeof currentClinicId !== 'undefined' && currentClinicId &&
            typeof clinicRecordFromId === 'function') {
            var cur = clinicRecordFromId(currentClinicId);
            if (cur) return cur;
        }
        if (p && p.clinic_tag && typeof APP_CLINICS !== 'undefined' && APP_CLINICS) {
            var t = String(p.clinic_tag).trim();
            for (var i = 0; i < APP_CLINICS.length; i++) {
                var c = APP_CLINICS[i];
                if (String(c.id) === t || String(c.clinic_code || '') === t) return c;
            }
        }
        return null;
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
        return _segments.slice();
    }

    function readLegacyLocalSegments() {
        try {
            var raw = localStorage.getItem(SEG_LS_KEY);
            var list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    }

    function clearLegacyLocalSegments() {
        try { localStorage.removeItem(SEG_LS_KEY); } catch (e) { /* ignore */ }
    }

    function isSavedListId(id) {
        var sid = String(id || '');
        return !!sid && !BUILTIN_SEGMENTS[sid];
    }

    function segmentCreatedBy() {
        try {
            if (typeof currentUserId !== 'undefined' && currentUserId) {
                return String(currentUserId);
            }
        } catch (e) { /* ignore */ }
        return '';
    }

    function segmentsTableMissing(err) {
        var msg = String((err && err.message) || err || '');
        return /broadcast_contact_lists|does not exist|schema cache|Could not find the table/i.test(msg);
    }

    function normalizePatientIds(raw) {
        var ids = raw;
        if (typeof ids === 'string') {
            try { ids = JSON.parse(ids); } catch (e) { ids = []; }
        }
        if (!Array.isArray(ids)) return [];
        return ids.map(function (pid) {
            return pid != null && pid !== '' ? String(pid) : '';
        }).filter(Boolean);
    }

    function readOrgStore() {
        try {
            var raw = localStorage.getItem(ORG_LS_KEY);
            var obj = raw ? JSON.parse(raw) : {};
            return obj && typeof obj === 'object' ? obj : {};
        } catch (e) {
            return {};
        }
    }

    function writeOrgStore(store) {
        try { localStorage.setItem(ORG_LS_KEY, JSON.stringify(store || {})); } catch (e) { /* ignore */ }
    }

    function orgMetaTableMissing(err) {
        var msg = String((err && err.message) || err || '');
        return /broadcast_organiser_meta|does not exist|schema cache|Could not find the table/i.test(msg);
    }

    /** Cloud remarks/markers win when a cloud row exists; collapsed stays local. */
    function getOrgMeta(id) {
        var sid = String(id || '');
        var local = readOrgStore()[sid];
        local = local && typeof local === 'object' ? local : {};
        var hasCloud = Object.prototype.hasOwnProperty.call(_orgCloud, sid);
        var cloud = hasCloud && _orgCloud[sid] && typeof _orgCloud[sid] === 'object'
            ? _orgCloud[sid]
            : null;
        return {
            parentId: local.parentId || '',
            kind: local.kind || '',
            collapsed: local.collapsed || '',
            marker: hasCloud ? String(cloud.marker || '') : String(local.marker || ''),
            remark: hasCloud ? String(cloud.remark || '') : String(local.remark || '')
        };
    }

    function patchOrgMeta(id, patch) {
        var sid = String(id || '');
        if (!sid) return;
        var store = readOrgStore();
        var cur = store[sid] && typeof store[sid] === 'object' ? store[sid] : {};
        var next = Object.assign({}, cur, patch || {});
        Object.keys(next).forEach(function (k) {
            if (next[k] == null || next[k] === '') delete next[k];
        });
        if (Object.keys(next).length) store[sid] = next;
        else delete store[sid];
        writeOrgStore(store);
        // Keep in-memory cloud cache in sync for marker/remark
        if (patch && (Object.prototype.hasOwnProperty.call(patch, 'marker') ||
            Object.prototype.hasOwnProperty.call(patch, 'remark'))) {
            var c = _orgCloud[sid] && typeof _orgCloud[sid] === 'object' ? _orgCloud[sid] : {};
            if (Object.prototype.hasOwnProperty.call(patch, 'marker')) c.marker = patch.marker || '';
            if (Object.prototype.hasOwnProperty.call(patch, 'remark')) c.remark = patch.remark || '';
            _orgCloud[sid] = c;
        }
    }

    function persistOrgMetaToCloud(id, meta) {
        var sid = String(id || '');
        if (!sid) return Promise.resolve(false);
        var marker = String((meta && meta.marker) || '');
        var remark = String((meta && meta.remark) || '');
        _orgCloud[sid] = { marker: marker, remark: remark };
        patchOrgMeta(sid, { marker: marker, remark: remark });

        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function' || _orgMetaDbMissing) {
            return Promise.resolve(false);
        }
        var row = {
            list_key: sid,
            marker: marker,
            remark: remark,
            updated_at: new Date().toISOString(),
            updated_by: segmentCreatedBy() || null
        };
        return SB.from(ORG_META_TABLE)
            .upsert([row], { onConflict: 'list_key' })
            .then(function (r) {
                if (r.error) {
                    if (orgMetaTableMissing(r.error)) {
                        _orgMetaDbMissing = true;
                        console.warn('[broadcast] organiser meta table missing — run broadcast_organiser_meta.sql');
                        return false;
                    }
                    console.warn('[broadcast] save organiser meta', r.error);
                    return false;
                }
                return true;
            })
            .catch(function (err) {
                console.warn('[broadcast] save organiser meta', err);
                return false;
            });
    }

    function refreshOrgMetaFromCloud() {
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            return Promise.resolve(_orgCloud);
        }
        if (_orgCloudLoading) return Promise.resolve(_orgCloud);
        _orgCloudLoading = true;
        return SB.from(ORG_META_TABLE)
            .select('list_key,marker,remark,updated_at')
            .then(function (r) {
                _orgCloudLoading = false;
                if (r.error) {
                    if (orgMetaTableMissing(r.error)) {
                        _orgMetaDbMissing = true;
                        console.warn('[broadcast] organiser meta table missing — run broadcast_organiser_meta.sql');
                        return migrateLocalOrgMetaToCloud();
                    }
                    console.warn('[broadcast] load organiser meta', r.error);
                    return _orgCloud;
                }
                _orgMetaDbMissing = false;
                var map = {};
                (r.data || []).forEach(function (row) {
                    var key = String((row && row.list_key) || '').trim();
                    if (!key) return;
                    map[key] = {
                        marker: String(row.marker || ''),
                        remark: String(row.remark || '')
                    };
                });
                _orgCloud = map;
                // Mirror into local cache so offline reads still work
                var store = readOrgStore();
                Object.keys(map).forEach(function (key) {
                    var cur = store[key] && typeof store[key] === 'object' ? store[key] : {};
                    store[key] = Object.assign({}, cur, {
                        marker: map[key].marker || undefined,
                        remark: map[key].remark || undefined
                    });
                    if (!store[key].marker) delete store[key].marker;
                    if (!store[key].remark) delete store[key].remark;
                });
                writeOrgStore(store);
                // Push any local-only remarks that are not yet in cloud
                return migrateLocalOrgMetaToCloud();
            })
            .catch(function (err) {
                _orgCloudLoading = false;
                console.warn('[broadcast] load organiser meta', err);
                return _orgCloud;
            });
    }

    /** One-time / incremental: upload local remarks not present in cloud. */
    function migrateLocalOrgMetaToCloud() {
        if (_orgMetaDbMissing || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            return Promise.resolve(_orgCloud);
        }
        var store = readOrgStore();
        var pending = [];
        Object.keys(store).forEach(function (key) {
            var local = store[key];
            if (!local || typeof local !== 'object') return;
            var hasLocal = !!(local.marker || local.remark);
            if (!hasLocal) return;
            // Cloud already has this key — do not overwrite clinic data
            if (Object.prototype.hasOwnProperty.call(_orgCloud, key)) return;
            pending.push({
                list_key: key,
                marker: String(local.marker || ''),
                remark: String(local.remark || ''),
                updated_at: new Date().toISOString(),
                updated_by: segmentCreatedBy() || 'migrate'
            });
        });
        if (!pending.length) return Promise.resolve(_orgCloud);
        return SB.from(ORG_META_TABLE)
            .upsert(pending, { onConflict: 'list_key' })
            .then(function (r) {
                if (r.error) {
                    if (orgMetaTableMissing(r.error)) _orgMetaDbMissing = true;
                    else console.warn('[broadcast] migrate organiser meta', r.error);
                    return _orgCloud;
                }
                pending.forEach(function (row) {
                    _orgCloud[row.list_key] = { marker: row.marker, remark: row.remark };
                });
                return _orgCloud;
            })
            .catch(function () { return _orgCloud; });
    }

    function markerDef(id) {
        var mid = String(id || '');
        for (var i = 0; i < LIST_MARKERS.length; i++) {
            if (LIST_MARKERS[i].id === mid) return LIST_MARKERS[i];
        }
        return LIST_MARKERS[0];
    }

    function stripOrgFromConditions(cond) {
        if (!cond || typeof cond !== 'object') return null;
        var out = {};
        Object.keys(cond).forEach(function (k) {
            if (k === '_org') return;
            out[k] = cond[k];
        });
        return Object.keys(out).length ? out : null;
    }

    function conditionsWithOrg(seg) {
        var base = seg && seg.conditions && typeof seg.conditions === 'object'
            ? Object.assign({}, seg.conditions)
            : {};
        var org = {
            parentId: seg.parentId || '',
            marker: seg.marker || '',
            remark: seg.remark || '',
            kind: seg.kind === 'folder' ? 'folder' : 'list'
        };
        if (!org.parentId && !org.marker && !org.remark && org.kind === 'list') {
            delete base._org;
            return Object.keys(base).length ? base : null;
        }
        base._org = org;
        return base;
    }

    function normalizeSegmentRow(row) {
        if (!row || typeof row !== 'object') return null;
        var id = String(row.id || '').trim();
        var name = String(row.name || '').trim();
        if (!id || !name) return null;
        var conditions = row.conditions;
        if (typeof conditions === 'string') {
            try { conditions = JSON.parse(conditions); } catch (e) { conditions = null; }
        }
        if (!conditions || typeof conditions !== 'object') conditions = null;
        var orgFromCond = conditions && conditions._org && typeof conditions._org === 'object'
            ? conditions._org
            : null;
        var local = getOrgMeta(id);
        var hasCloudMeta = Object.prototype.hasOwnProperty.call(_orgCloud, id);
        var parentId = String(
            row.parent_id || row.parentId ||
            (orgFromCond && orgFromCond.parentId) ||
            local.parentId || ''
        ).trim();
        var marker = hasCloudMeta
            ? String((_orgCloud[id] && _orgCloud[id].marker) || '')
            : String(
                row.marker ||
                (orgFromCond && orgFromCond.marker) ||
                local.marker || ''
            ).trim();
        var remark = hasCloudMeta
            ? String((_orgCloud[id] && _orgCloud[id].remark) || '')
            : String(
                row.remark ||
                (orgFromCond && orgFromCond.remark) ||
                local.remark || ''
            ).trim();
        var kind = String(
            row.kind ||
            (orgFromCond && orgFromCond.kind) ||
            local.kind || 'list'
        ).trim();
        if (kind !== 'folder') kind = 'list';
        if (local.collapsed) _listCollapsed[id] = true;
        return {
            id: id,
            name: name,
            patientIds: normalizePatientIds(row.patient_ids != null ? row.patient_ids : row.patientIds),
            conditions: stripOrgFromConditions(conditions),
            parentId: parentId,
            marker: marker,
            remark: remark,
            kind: kind,
            createdAt: row.created_at || row.createdAt || null,
            updatedAt: row.updated_at || row.updatedAt || null
        };
    }

    function applyOrgToSegment(seg) {
        if (!seg) return seg;
        var local = getOrgMeta(seg.id);
        if (!seg.parentId && local.parentId) seg.parentId = String(local.parentId);
        if (!seg.marker && local.marker) seg.marker = String(local.marker);
        if (!seg.remark && local.remark) seg.remark = String(local.remark);
        if (seg.kind !== 'folder' && local.kind === 'folder') seg.kind = 'folder';
        return seg;
    }

    function persistSegmentOrg(seg) {
        if (!seg || !seg.id) return;
        patchOrgMeta(seg.id, {
            parentId: seg.parentId || '',
            marker: seg.marker || '',
            remark: seg.remark || '',
            kind: seg.kind === 'folder' ? 'folder' : 'list',
            collapsed: _listCollapsed[seg.id] ? 1 : ''
        });
        // Clinic-wide remarks/markers for every organiser row (builtin + saved)
        persistOrgMetaToCloud(seg.id, {
            marker: seg.marker || '',
            remark: seg.remark || ''
        });
        if (!isSavedListId(seg.id)) return;
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function' || _segmentsDbMissing) {
            persistSegmentLocalFallback(_segments);
            return;
        }
        var payload = {
            conditions: conditionsWithOrg(seg),
            updated_at: new Date().toISOString(),
            parent_id: seg.parentId || null,
            kind: seg.kind === 'folder' ? 'folder' : 'list',
            marker: seg.marker || '',
            remark: seg.remark || ''
        };
        SB.from(SEG_TABLE).update(payload).eq('id', seg.id).then(function (r) {
            if (!r.error) return;
            if (segmentsTableMissing(r.error)) {
                _segmentsDbMissing = true;
                persistSegmentLocalFallback(_segments);
                return;
            }
            // Columns may not exist yet — retry with conditions._org only
            if (/parent_id|kind|marker|remark|column/i.test(String(r.error.message || ''))) {
                SB.from(SEG_TABLE).update({
                    conditions: conditionsWithOrg(seg),
                    updated_at: new Date().toISOString()
                }).eq('id', seg.id).then(function () { /* ignore */ });
            }
        }).catch(function () { /* ignore */ });
    }

    function activeSavedList() {
        if (!isSavedListId(_activeSegmentId)) return null;
        return findSavedSegment(_activeSegmentId);
    }

    function getCheckedListIds() {
        return Object.keys(_listSelected).filter(function (id) {
            return !!_listSelected[id];
        });
    }

    function activeListLabel() {
        if (_activeSegmentId === UNION_SEGMENT_ID) {
            var n = getCheckedListIds().length;
            return trRepl('mb.union.label', { N: n }, '{N} lists combined');
        }
        var seg = activeSavedList();
        if (seg) {
            applyOrgToSegment(seg);
            var base = seg.name || '';
            if (seg.kind === 'folder') {
                return base + ' · ' + tr('mb.org.folderTag', 'folder');
            }
            return base;
        }
        if (_activeSegmentId === 'scope') return tr('mb.seg.scope', 'Clinic / doctor bar');
        if (_activeSegmentId === 'hasphone') return tr('mb.seg.hasPhone', 'Has phone');
        if (_activeSegmentId === 'birthday') return tr('mb.seg.birthday', 'Birthday this month');
        if (_activeSegmentId === 'sent') return tr('mb.seg.sent', 'Messaged in window');
        if (_activeSegmentId === 'unsent') return tr('mb.seg.unsent', 'Not messaged in window');
        return tr('mb.seg.all', 'All contacts');
    }

    function migrateLegacyLocalSegmentsToDb() {
        if (_segmentsMigrating || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            return Promise.resolve(0);
        }
        var legacy = readLegacyLocalSegments();
        if (!legacy.length) return Promise.resolve(0);
        _segmentsMigrating = true;
        var chain = Promise.resolve(0);
        legacy.forEach(function (s, idx) {
            var name = String((s && s.name) || '').trim();
            if (!name) return;
            var patientIds = normalizePatientIds(s.patientIds || s.patient_ids);
            var conditions = s.conditions && typeof s.conditions === 'object' ? s.conditions : null;
            chain = chain.then(function (n) {
                return SB.from(SEG_TABLE).insert([{
                    name: name,
                    patient_ids: patientIds,
                    conditions: conditions,
                    sort_order: idx,
                    created_by: segmentCreatedBy() || 'migrate'
                }]).then(function (r) {
                    if (r.error) return n;
                    return n + 1;
                });
            });
        });
        return chain.then(function (n) {
            _segmentsMigrating = false;
            if (n > 0) clearLegacyLocalSegments();
            return n;
        }).catch(function () {
            _segmentsMigrating = false;
            return 0;
        });
    }

    function refreshSegmentsFromCloud() {
        renderSegments();
        return refreshOrgMetaFromCloud().then(function () {
            if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
                _segments = readLegacyLocalSegments().map(normalizeSegmentRow).filter(Boolean);
                renderSegments();
                return _segments;
            }
            if (_segmentsLoading) return _segments;
            _segmentsLoading = true;
            var selectCols = 'id,name,patient_ids,conditions,sort_order,created_at,updated_at,parent_id,kind,marker,remark';
            function loadWithSelect(cols) {
                return SB.from(SEG_TABLE)
                    .select(cols)
                    .eq('is_active', true)
                    .order('sort_order', { ascending: true })
                    .order('name', { ascending: true });
            }
            return loadWithSelect(selectCols)
                .then(function (r) {
                    if (r.error && /parent_id|kind|marker|remark|column/i.test(String(r.error.message || ''))) {
                        return loadWithSelect('id,name,patient_ids,conditions,sort_order,created_at,updated_at');
                    }
                    return r;
                })
                .then(function (r) {
                    _segmentsLoading = false;
                    if (r.error) {
                        if (segmentsTableMissing(r.error)) {
                            _segmentsDbMissing = true;
                            _segments = readLegacyLocalSegments().map(normalizeSegmentRow).filter(Boolean);
                            renderSegments();
                            return _segments;
                        }
                        console.warn('[broadcast] load lists', r.error);
                        return _segments;
                    }
                    _segmentsDbMissing = false;
                    var list = (r.data || []).map(normalizeSegmentRow).filter(Boolean);
                    if (!list.length) {
                        return migrateLegacyLocalSegmentsToDb().then(function (migrated) {
                            if (migrated) return refreshSegmentsFromCloud();
                            _segments = [];
                            renderSegments();
                            return _segments;
                        });
                    }
                    _segments = list;
                    // Prefer cloud; drop stale local copy once cloud has data
                    if (readLegacyLocalSegments().length) clearLegacyLocalSegments();
                    renderSegments();
                    if (isSavedListId(_activeSegmentId) && !findSavedSegment(_activeSegmentId)) {
                        _activeSegmentId = 'all';
                        applyFilters();
                    }
                    return _segments;
                })
                .catch(function (err) {
                    _segmentsLoading = false;
                    console.warn('[broadcast] load lists', err);
                    _segments = readLegacyLocalSegments().map(normalizeSegmentRow).filter(Boolean);
                    renderSegments();
                    return _segments;
                });
        });
    }

    function persistSegmentLocalFallback(list) {
        try { localStorage.setItem(SEG_LS_KEY, JSON.stringify(list || [])); } catch (e) { /* ignore */ }
    }

    function alertSegmentsNeedCloud() {
        alert(tr('mb.seg.needCloud',
            'Cloud contact lists need the Supabase table. Run broadcast_contact_lists.sql in the Supabase SQL Editor, then refresh.'));
    }

    // ── Init / mode ──────────────────────────────────────────────
    function init() {
        _inited = true;
        bindOnce();
        restoreSentPeriodUi();
        syncSortUiFromState();
        fillClinicFilterSelect();
        setMode('contacts');
        refreshOrgMetaFromCloud().then(function () {
            renderSegments();
            return refreshSegmentsFromCloud();
        });
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

        // Prevent checkbox toggle flicker before Shift+range select applies
        root.addEventListener('mousedown', function (ev) {
            if (!ev.shiftKey) return;
            var cb = ev.target && ev.target.closest && ev.target.closest('input[data-mb-row]');
            if (!cb) return;
            ev.preventDefault();
        }, true);

        // Use change (not click) so .checked is committed before we sync counts
        root.addEventListener('change', function (ev) {
            var t = ev.target;
            if (!t || !t.getAttribute) return;
            if (t.id === 'mbSelectPage') {
                // Handled by listener attached in renderTable
                return;
            }
            if (t.getAttribute('data-mb-row') != null) {
                var id = String(t.getAttribute('data-mb-row') || '');
                if (!id) return;
                if (t.checked && isMessagingOptOut(findPatientById(id))) {
                    t.checked = false;
                    setPatientSelected(id, false);
                    syncSelectionUi();
                    return;
                }
                setPatientSelected(id, !!t.checked);
                _selectAnchorId = id;
                syncSelectionUi();
                return;
            }
            if (t.getAttribute('data-mb-list-check') != null) {
                var lid = String(t.getAttribute('data-mb-list-check') || '');
                if (!lid) return;
                if (t.checked) _listSelected[lid] = true;
                else delete _listSelected[lid];
                syncListSelectAllUi();
                syncMoveUnderUi();
                // 1 checked → that list; 2+ checked → OR-union (add-on sum)
                applyCheckedListsToBody();
                return;
            }
            if (t.getAttribute('data-mb-list-check-all') != null) {
                toggleSelectAllLists(
                    t.getAttribute('data-mb-list-check-all'),
                    !!t.checked
                );
            }
        });

        root.addEventListener('click', function (ev) {
            var t = ev.target;
            if (!t) return;
            var modeBtn = t.closest('[data-mb-mode]');
            if (modeBtn) {
                setMode(modeBtn.getAttribute('data-mb-mode'));
                return;
            }
            // List / row checkbox toggles are handled on `change` (committed state).
            if (t.closest('input[data-mb-list-check], input[data-mb-list-check-all], #mbSelectPage')) {
                return;
            }
            var markBtn = t.closest('[data-mb-list-mark]');
            if (markBtn) {
                ev.preventDefault();
                ev.stopPropagation();
                openMarkerMenu(markBtn.getAttribute('data-mb-list-mark'), markBtn);
                return;
            }
            var optToggle = t.closest('[data-mb-optout-toggle]');
            if (optToggle) {
                ev.preventDefault();
                ev.stopPropagation();
                var optId = optToggle.getAttribute('data-mb-optout-toggle');
                var setAttr = optToggle.getAttribute('data-mb-optout-set');
                var setOut = setAttr === '1' ? true : (setAttr === '0' ? false : null);
                toggleOneOptOut(optId, setOut);
                return;
            }
            var toggleBtn = t.closest('[data-mb-list-toggle]');
            if (toggleBtn) {
                ev.preventDefault();
                ev.stopPropagation();
                toggleListCollapsed(toggleBtn.getAttribute('data-mb-list-toggle'));
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
                // Ignore synthetic click after a drag-move
                if (segBtn.getAttribute('data-mb-dragged') === '1') {
                    segBtn.removeAttribute('data-mb-dragged');
                    return;
                }
                // Defer activate so a double-click can rename instead
                var sidClick = segBtn.getAttribute('data-mb-seg') || 'all';
                clearTimeout(root._mbSegClickTimer);
                root._mbSegClickTimer = setTimeout(function () {
                    activateSegment(sidClick);
                }, 260);
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
                var id = String(rowCb.getAttribute('data-mb-row') || '');
                if (!id) return;
                // Normal toggles: `change` handler syncs selection + counts.
                // Shift+click: range-select in filtered order (across pages).
                if (ev.shiftKey && _selectAnchorId) {
                    ev.preventDefault();
                    selectFilteredRange(_selectAnchorId, id, true);
                    renderTable();
                    syncSelectionUi();
                    return;
                }
                return;
            }
            // Shift+click on a result row (not only the checkbox) also ranges
            var dataRow = t.closest('tr.mb-row');
            if (dataRow && ev.shiftKey && root.contains(dataRow)) {
                var rowInput = dataRow.querySelector('input[data-mb-row]');
                var rid = rowInput ? String(rowInput.getAttribute('data-mb-row') || '') : '';
                if (rid && _selectAnchorId) {
                    ev.preventDefault();
                    selectFilteredRange(_selectAnchorId, rid, true);
                    renderTable();
                    syncSelectionUi();
                    return;
                }
            }
            var histRow = t.closest('[data-mb-campaign]');
            if (histRow) {
                openHistoryDetail(histRow.getAttribute('data-mb-campaign'));
                return;
            }
        });

        root.addEventListener('dblclick', function (ev) {
            var t = ev.target;
            if (!t || !t.closest) return;
            var segBtn = t.closest('[data-mb-seg]');
            if (!segBtn || !root.contains(segBtn)) return;
            var sid = segBtn.getAttribute('data-mb-seg') || '';
            if (!isSavedListId(sid)) return;
            clearTimeout(root._mbSegClickTimer);
            ev.preventDefault();
            ev.stopPropagation();
            renameSavedSegment(sid);
        });

        // Windows-style drag lists/folders onto a folder (or root drop zone)
        root.addEventListener('dragstart', function (ev) {
            var t = ev.target;
            if (t && t.closest && t.closest('input, .mb-org-mark-btn, .mb-seg-del, .mb-org-toggle')) {
                ev.preventDefault();
                return;
            }
            var row = t && t.closest && t.closest('[data-mb-org-row][draggable="true"]');
            if (!row || !root.contains(row)) return;
            var id = row.getAttribute('data-mb-org-row');
            if (!isSavedListId(id)) {
                ev.preventDefault();
                return;
            }
            var ids = collectMoveCandidateIds(id);
            _dragListIds = ids;
            try {
                ev.dataTransfer.setData('text/plain', ids.join(','));
                ev.dataTransfer.effectAllowed = 'move';
            } catch (e) { /* ignore */ }
            row.classList.add('is-dragging');
            ids.forEach(function (mid) {
                var r = null;
                Array.prototype.forEach.call(root.querySelectorAll('[data-mb-org-row]'), function (el) {
                    if (!r && el.getAttribute('data-mb-org-row') === mid) r = el;
                });
                if (r) r.classList.add('is-dragging');
            });
        });
        root.addEventListener('dragend', function () {
            _dragListIds = null;
            _dragOverTargetId = null;
            root.querySelectorAll('.mb-org-row.is-dragging, .mb-org-row.is-drop-target, .mb-org-root-drop.is-drop-target')
                .forEach(function (el) {
                    el.classList.remove('is-dragging', 'is-drop-target');
                });
        });
        root.addEventListener('dragover', function (ev) {
            if (!_dragListIds || !_dragListIds.length) return;
            var rootDrop = ev.target && ev.target.closest && ev.target.closest('[data-mb-org-drop-root]');
            var folderRow = ev.target && ev.target.closest && ev.target.closest('[data-mb-org-row].is-folder');
            var targetId = null;
            if (rootDrop && root.contains(rootDrop)) {
                targetId = '';
            } else if (folderRow && root.contains(folderRow)) {
                targetId = folderRow.getAttribute('data-mb-org-row') || '';
                if (!canMoveListsUnder(_dragListIds, targetId)) return;
            } else {
                return;
            }
            ev.preventDefault();
            try { ev.dataTransfer.dropEffect = 'move'; } catch (e2) { /* ignore */ }
            if (_dragOverTargetId === targetId) return;
            _dragOverTargetId = targetId;
            root.querySelectorAll('.mb-org-row.is-drop-target, .mb-org-root-drop.is-drop-target')
                .forEach(function (el) { el.classList.remove('is-drop-target'); });
            if (targetId === '') {
                var zone = root.querySelector('[data-mb-org-drop-root]');
                if (zone) zone.classList.add('is-drop-target');
            } else if (folderRow) {
                folderRow.classList.add('is-drop-target');
            }
        });
        root.addEventListener('dragleave', function (ev) {
            var related = ev.relatedTarget;
            if (related && root.contains(related)) return;
            root.querySelectorAll('.mb-org-row.is-drop-target, .mb-org-root-drop.is-drop-target')
                .forEach(function (el) { el.classList.remove('is-drop-target'); });
            _dragOverTargetId = null;
        });
        root.addEventListener('drop', function (ev) {
            if (!_dragListIds || !_dragListIds.length) return;
            var rootDrop = ev.target && ev.target.closest && ev.target.closest('[data-mb-org-drop-root]');
            var folderRow = ev.target && ev.target.closest && ev.target.closest('[data-mb-org-row].is-folder');
            var targetId = null;
            if (rootDrop && root.contains(rootDrop)) targetId = '';
            else if (folderRow && root.contains(folderRow)) {
                targetId = folderRow.getAttribute('data-mb-org-row') || '';
            } else {
                return;
            }
            ev.preventDefault();
            ev.stopPropagation();
            var ids = _dragListIds.slice();
            _dragListIds = null;
            _dragOverTargetId = null;
            root.querySelectorAll('.mb-org-row.is-dragging, .mb-org-row.is-drop-target, .mb-org-root-drop.is-drop-target')
                .forEach(function (el) {
                    el.classList.remove('is-dragging', 'is-drop-target');
                });
            // Prevent the trailing click from activating the drop target / source
            ids.forEach(function (mid) {
                var nameEl = null;
                Array.prototype.forEach.call(root.querySelectorAll('[data-mb-seg]'), function (el) {
                    if (!nameEl && el.getAttribute('data-mb-seg') === mid) nameEl = el;
                });
                if (nameEl) nameEl.setAttribute('data-mb-dragged', '1');
            });
            moveListsUnderFolder(ids, targetId);
        });

        if (!document.documentElement.dataset.mbOrgMarkBound) {
            document.documentElement.dataset.mbOrgMarkBound = '1';
            document.addEventListener('click', function (ev) {
                if (!_markMenuEl || !_markMenuEl.classList.contains('is-open')) return;
                if (ev.target && _markMenuEl.contains(ev.target)) return;
                if (ev.target && ev.target.closest && ev.target.closest('[data-mb-list-mark]')) return;
                if (ev.target && ev.target.closest && ev.target.closest('#mbOrgMarkBtn')) return;
                closeMarkerMenu();
            });
            document.addEventListener('keydown', function (ev) {
                if (ev.key === 'Escape') closeMarkerMenu();
            });
        }

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

    // ── Segments / campaign organiser ────────────────────────────
    function builtinLabel(id) {
        if (id === 'scope') return tr('mb.seg.scope', 'Clinic / doctor bar');
        if (id === 'hasphone') return tr('mb.seg.hasPhone', 'Has phone');
        if (id === 'birthday') return tr('mb.seg.birthday', 'Birthday this month');
        if (id === 'sent') return tr('mb.seg.sent', 'Messaged in window');
        if (id === 'unsent') return tr('mb.seg.unsent', 'Not messaged in window');
        return tr('mb.seg.all', 'All contacts');
    }

    function listChildrenOf(parentId) {
        var pid = String(parentId || '');
        return loadSegments().filter(function (s) {
            return String(s.parentId || '') === pid;
        });
    }

    function listDescendantIds(rootId) {
        var out = [];
        var stack = [String(rootId || '')];
        var seen = {};
        while (stack.length) {
            var cur = stack.pop();
            if (!cur || seen[cur]) continue;
            seen[cur] = true;
            listChildrenOf(cur).forEach(function (ch) {
                out.push(ch.id);
                stack.push(ch.id);
            });
        }
        return out;
    }

    function flattenSavedTree() {
        var roots = listChildrenOf('');
        var rows = [];
        function walk(nodes, depth) {
            nodes.forEach(function (s) {
                applyOrgToSegment(s);
                var kids = listChildrenOf(s.id);
                rows.push({ seg: s, depth: depth, hasKids: kids.length > 0 });
                if (kids.length && !_listCollapsed[s.id]) walk(kids, depth + 1);
            });
        }
        walk(roots, 0);
        // Orphans whose parent is missing (e.g. deleted) still show at root
        var shown = {};
        rows.forEach(function (r) { shown[r.seg.id] = true; });
        loadSegments().forEach(function (s) {
            if (shown[s.id]) return;
            var p = String(s.parentId || '');
            if (p && findSavedSegment(p)) return;
            applyOrgToSegment(s);
            rows.push({ seg: s, depth: 0, hasKids: listChildrenOf(s.id).length > 0 });
        });
        return rows;
    }

    function ensureMarkerMenu() {
        if (_markMenuEl) return _markMenuEl;
        var el = document.createElement('div');
        el.id = 'mbMarkMenu';
        el.className = 'mb-mark-menu';
        el.setAttribute('role', 'menu');
        el.innerHTML =
            '<div class="mb-mark-menu-title" id="mbMarkMenuTitle">' +
            esc(tr('mb.org.mark.title', 'Remarks')) + '</div>' +
            '<div class="mb-mark-menu-sub" id="mbMarkMenuSub" style="display:none;"></div>' +
            '<div class="mb-mark-menu-opts mb-mark-menu-icons">' +
            LIST_MARKERS.map(function (m) {
                return (
                    '<button type="button" class="mb-mark-opt" role="menuitem" data-mb-mark-pick="' +
                    esc(m.id) + '" title="' + esc(tr(m.labelKey, m.label)) + '">' +
                    '<span class="mb-mark-opt-icon mb-mark-' + esc(m.id || 'none') + '">' +
                    esc(m.icon) + '</span>' +
                    '<span class="mb-mark-opt-lab">' + esc(tr(m.labelKey, m.label)) + '</span></button>'
                );
            }).join('') +
            '</div>' +
            '<div class="mb-mark-menu-remark" id="mbMarkMenuRemark">' +
            '<label class="mb-mark-remark-lab">' + esc(tr('mb.org.remark', 'Note')) + '</label>' +
            '<input type="text" id="mbMarkRemarkInput" class="mb-input mb-mark-remark-input" maxlength="120" ' +
            'placeholder="' + esc(tr('mb.org.remarkPh', 'Optional note…')) + '">' +
            '<button type="button" class="mb-btn primary mb-mark-remark-save" data-mb-mark-save-remark="1">' +
            esc(tr('mb.org.remarkSave', 'Save note')) + '</button>' +
            '</div>';
        document.body.appendChild(el);
        el.addEventListener('click', function (ev) {
            var pickBtn = ev.target && ev.target.closest && ev.target.closest('[data-mb-mark-pick]');
            if (pickBtn) {
                var marker = pickBtn.getAttribute('data-mb-mark-pick') || '';
                if (_markMenuBulkIds && _markMenuBulkIds.length) {
                    _markMenuBulkIds.forEach(function (id) { setListMarker(id, marker); });
                } else if (_markMenuTargetId) {
                    setListMarker(_markMenuTargetId, marker);
                }
                closeMarkerMenu();
                return;
            }
            if (ev.target && ev.target.closest && ev.target.closest('[data-mb-mark-save-remark]')) {
                var inp = pick('mbMarkRemarkInput');
                var note = inp ? inp.value : '';
                if (_markMenuBulkIds && _markMenuBulkIds.length) {
                    _markMenuBulkIds.forEach(function (id) { setListRemark(id, note); });
                } else if (_markMenuTargetId) {
                    setListRemark(_markMenuTargetId, note);
                }
                closeMarkerMenu();
            }
        });
        _markMenuEl = el;
        return el;
    }

    function positionMarkerMenu(anchorEl) {
        var el = ensureMarkerMenu();
        if (!anchorEl || !anchorEl.getBoundingClientRect) return;
        var rect = anchorEl.getBoundingClientRect();
        var mw = el.offsetWidth || 220;
        var mh = el.offsetHeight || 280;
        var left = Math.min(window.innerWidth - mw - 8, Math.max(8, rect.left));
        var top = rect.bottom + 6;
        if (top + mh > window.innerHeight - 8) top = Math.max(8, rect.top - mh - 6);
        el.style.left = left + 'px';
        el.style.top = top + 'px';
    }

    function closeMarkerMenu() {
        if (!_markMenuEl) return;
        _markMenuEl.classList.remove('is-open', 'is-bulk');
        _markMenuTargetId = null;
        _markMenuBulkIds = null;
        var markBtn = pick('mbOrgMarkBtn');
        if (markBtn) markBtn.setAttribute('aria-expanded', 'false');
    }

    function openMarkerMenu(listId, anchorEl) {
        var el = ensureMarkerMenu();
        _markMenuBulkIds = null;
        _markMenuTargetId = String(listId || '');
        var meta = resolveListOrg(_markMenuTargetId);
        var title = pick('mbMarkMenuTitle');
        var sub = pick('mbMarkMenuSub');
        var remarkBox = pick('mbMarkMenuRemark');
        if (title) title.textContent = tr('mb.org.mark.title', 'Remarks');
        if (sub) {
            sub.style.display = 'none';
            sub.textContent = '';
        }
        if (remarkBox) remarkBox.style.display = '';
        var inp = pick('mbMarkRemarkInput');
        if (inp) inp.value = meta.remark || '';
        el.classList.remove('is-bulk');
        el.querySelectorAll('[data-mb-mark-pick]').forEach(function (btn) {
            btn.classList.toggle('is-active',
                String(btn.getAttribute('data-mb-mark-pick') || '') === String(meta.marker || ''));
        });
        el.classList.add('is-open');
        positionMarkerMenu(anchorEl);
    }

    function openBulkMarkerMenu(anchorEl, ids) {
        var el = ensureMarkerMenu();
        _markMenuTargetId = null;
        _markMenuBulkIds = (ids || []).slice();
        var title = pick('mbMarkMenuTitle');
        var sub = pick('mbMarkMenuSub');
        var remarkBox = pick('mbMarkMenuRemark');
        if (title) title.textContent = tr('mb.org.markSelected', 'Mark selected');
        if (sub) {
            sub.style.display = '';
            sub.textContent = trRepl('mb.org.bulkMarkSub', { N: _markMenuBulkIds.length },
                'Apply to {N} selected');
        }
        if (remarkBox) remarkBox.style.display = 'none';
        el.classList.add('is-bulk');
        el.querySelectorAll('[data-mb-mark-pick]').forEach(function (btn) {
            btn.classList.remove('is-active');
        });
        el.classList.add('is-open');
        positionMarkerMenu(anchorEl);
        var markBtn = pick('mbOrgMarkBtn');
        if (markBtn) markBtn.setAttribute('aria-expanded', 'true');
    }

    function resolveListOrg(id) {
        var sid = String(id || '');
        if (isSavedListId(sid)) {
            var seg = findSavedSegment(sid);
            if (seg) {
                applyOrgToSegment(seg);
                return {
                    marker: seg.marker || '',
                    remark: seg.remark || '',
                    parentId: seg.parentId || '',
                    kind: seg.kind || 'list'
                };
            }
        }
        var local = getOrgMeta(sid);
        return {
            marker: local.marker || '',
            remark: local.remark || '',
            parentId: local.parentId || '',
            kind: local.kind || 'list'
        };
    }

    function setListMarker(id, markerId) {
        var sid = String(id || '');
        if (!sid) return;
        var marker = String(markerId || '');
        var cur = getOrgMeta(sid);
        if (isSavedListId(sid)) {
            var seg = findSavedSegment(sid);
            if (seg) {
                seg.marker = marker;
                persistSegmentOrg(seg);
                renderSegments();
                return;
            }
        }
        persistOrgMetaToCloud(sid, { marker: marker, remark: cur.remark || '' })
            .then(function (ok) {
                if (!ok && _orgMetaDbMissing) {
                    var status = pick('mbStatus');
                    if (status) {
                        status.textContent = tr('mb.org.metaNeedCloud',
                            'Remarks need Supabase table broadcast_organiser_meta — run broadcast_organiser_meta.sql, then refresh.');
                    }
                }
                renderSegments();
            });
        renderSegments();
    }

    function setListRemark(id, remark) {
        var sid = String(id || '');
        if (!sid) return;
        var note = String(remark || '').trim();
        var cur = getOrgMeta(sid);
        if (isSavedListId(sid)) {
            var seg = findSavedSegment(sid);
            if (seg) {
                seg.remark = note;
                persistSegmentOrg(seg);
                renderSegments();
                return;
            }
        }
        persistOrgMetaToCloud(sid, { marker: cur.marker || '', remark: note })
            .then(function (ok) {
                if (!ok && _orgMetaDbMissing) {
                    var status = pick('mbStatus');
                    if (status) {
                        status.textContent = tr('mb.org.metaNeedCloud',
                            'Remarks need Supabase table broadcast_organiser_meta — run broadcast_organiser_meta.sql, then refresh.');
                    }
                }
                renderSegments();
            });
        renderSegments();
    }

    function toggleListCollapsed(id) {
        var sid = String(id || '');
        if (!sid) return;
        if (_listCollapsed[sid]) delete _listCollapsed[sid];
        else _listCollapsed[sid] = true;
        patchOrgMeta(sid, { collapsed: _listCollapsed[sid] ? 1 : '' });
        renderSegments();
    }

    function toggleSelectAllLists(scope, on) {
        if (scope === 'smart') {
            BUILTIN_ORDER.forEach(function (id) {
                if (on) _listSelected[id] = true;
                else delete _listSelected[id];
            });
        } else {
            loadSegments().forEach(function (s) {
                if (on) _listSelected[s.id] = true;
                else delete _listSelected[s.id];
            });
        }
        // Select-all also drives the contacts body (union when 2+)
        applyCheckedListsToBody();
    }

    function syncListSelectAllUi() {
        var smartAll = pick('mbListCheckAllSmart');
        var savedAll = pick('mbListCheckAllSaved');
        if (smartAll) {
            var sn = BUILTIN_ORDER.filter(function (id) { return _listSelected[id]; }).length;
            smartAll.checked = sn === BUILTIN_ORDER.length && sn > 0;
            smartAll.indeterminate = sn > 0 && sn < BUILTIN_ORDER.length;
        }
        if (savedAll) {
            var segs = loadSegments();
            var sn2 = segs.filter(function (s) { return _listSelected[s.id]; }).length;
            savedAll.checked = segs.length > 0 && sn2 === segs.length;
            savedAll.indeterminate = sn2 > 0 && sn2 < segs.length;
        }
    }

    function renderOrgRow(opts) {
        var id = opts.id;
        var label = opts.label;
        var active = _activeSegmentId === id ||
            (_activeSegmentId === UNION_SEGMENT_ID && !!_listSelected[id]);
        var checked = !!_listSelected[id];
        var org = resolveListOrg(id);
        var md = markerDef(org.marker);
        var depth = opts.depth || 0;
        var hasKids = !!opts.hasKids;
        var collapsed = !!_listCollapsed[id];
        var isFolder = opts.kind === 'folder';
        var countHtml = opts.count != null
            ? '<span class="mb-org-count">' + esc(String(opts.count)) + '</span>'
            : '';
        var toggleHtml = hasKids
            ? ('<button type="button" class="mb-org-toggle' + (collapsed ? ' is-collapsed' : '') +
                '" data-mb-list-toggle="' + esc(id) + '" aria-label="Expand/collapse">▸</button>')
            : '<span class="mb-org-toggle-spacer"></span>';
        var icon = isFolder ? '📁' : (opts.smart ? '⚡' : '📋');
        var remarkTitle = org.remark
            ? esc(org.remark)
            : esc(tr('mb.org.mark.hint', 'Set remark / marker'));
        var canDrag = !!opts.canDrag;
        var canRename = !!opts.canDelete;
        var rowTitle = canDrag
            ? (tr('mb.org.dragTitle', 'Drag onto a folder to move') +
                (canRename ? ' · ' + tr('mb.org.renameHint', 'Double-click to rename') : ''))
            : '';
        return (
            '<tr class="mb-org-row' + (active ? ' is-active' : '') +
            (isFolder ? ' is-folder' : '') +
            (org.marker ? (' is-mark-' + esc(org.marker)) : '') +
            '" data-mb-org-row="' + esc(id) + '"' +
            (canDrag
                ? ' draggable="true" title="' + esc(rowTitle) + '"'
                : '') + '>' +
            '<td class="mb-org-td-check">' +
            '<input type="checkbox" draggable="false" data-mb-list-check="' + esc(id) + '"' +
            (checked ? ' checked' : '') + ' aria-label="Select list"></td>' +
            '<td class="mb-org-td-mark">' +
            '<button type="button" draggable="false" class="mb-org-mark-btn mb-mark-' +
            esc(org.marker || 'none') +
            '" data-mb-list-mark="' + esc(id) + '" title="' + remarkTitle + '" ' +
            'aria-haspopup="menu" aria-label="' + remarkTitle + '">' +
            esc(md.icon) +
            (org.remark ? '<span class="mb-org-mark-dot"></span>' : '') +
            '</button></td>' +
            '<td class="mb-org-td-name" style="padding-left:' + (8 + depth * 14) + 'px">' +
            '<div class="mb-org-name-wrap">' + toggleHtml +
            '<div role="button" tabindex="0" class="mb-seg-btn mb-org-name-btn' +
            (active ? ' active' : '') +
            '" data-mb-seg="' + esc(id) + '">' +
            '<span class="mb-org-type-icon" aria-hidden="true">' + icon + '</span> ' +
            '<span class="mb-org-name-text">' + esc(label) + '</span>' + countHtml +
            (org.remark ? ('<span class="mb-org-remark-snip" title="' + esc(org.remark) + '">' +
                esc(org.remark) + '</span>') : '') +
            '</div>' +
            (opts.canDelete
                ? ('<button type="button" draggable="false" class="mb-seg-del" data-mb-seg-del="' +
                    esc(id) + '" ' +
                    'title="' + esc(tr('mb.seg.delete', 'Delete list')) + '" ' +
                    'aria-label="' + esc(tr('mb.seg.delete', 'Delete list')) + '">✕</button>')
                : '') +
            '</div></td></tr>'
        );
    }

    function renderSegments() {
        var host = pick('mbSegList');
        if (!host) return;
        var smartRows = BUILTIN_ORDER.map(function (id) {
            return renderOrgRow({
                id: id,
                label: builtinLabel(id),
                smart: true,
                kind: 'list',
                canDelete: false
            });
        }).join('');
        var tree = flattenSavedTree();
        var savedRows = tree.length
            ? tree.map(function (r) {
                var s = r.seg;
                var n = s.kind === 'folder'
                    ? listChildrenOf(s.id).length
                    : (Array.isArray(s.patientIds) ? s.patientIds.length : 0);
                return renderOrgRow({
                    id: s.id,
                    label: s.name || (s.kind === 'folder' ? 'Folder' : 'List'),
                    kind: s.kind,
                    depth: r.depth,
                    hasKids: r.hasKids,
                    count: n,
                    canDelete: true,
                    canDrag: true
                });
            }).join('')
            : '<tr class="mb-org-empty"><td colspan="3">' +
                esc(tr('mb.org.emptySaved', 'No saved folders or lists yet.')) +
                '</td></tr>';

        host.innerHTML =
            '<div class="mb-org-block">' +
            '<div class="mb-org-block-title">' + esc(tr('mb.org.smart', 'Default filters')) + '</div>' +
            '<table class="mb-org-tbl" aria-label="' + esc(tr('mb.org.smart', 'Default filters')) + '">' +
            '<thead><tr>' +
            '<th class="mb-org-th-check"><input type="checkbox" id="mbListCheckAllSmart" ' +
            'data-mb-list-check-all="smart" title="' + esc(tr('mb.org.selectAll', 'Select all')) + '"></th>' +
            '<th class="mb-org-th-mark" title="' + esc(tr('mb.org.mark.title', 'Remarks')) + '">★</th>' +
            '<th class="mb-org-th-name">' + esc(tr('mb.org.col.name', 'List')) + '</th>' +
            '</tr></thead><tbody>' + smartRows + '</tbody></table></div>' +
            '<div class="mb-org-block">' +
            '<div class="mb-org-block-title mb-org-root-drop" data-mb-org-drop-root="1" ' +
            'title="' + esc(tr('mb.org.dropRootHint', 'Drop here to move to top level')) + '">' +
            esc(tr('mb.org.saved', 'Folders & lists')) +
            ' <span class="mb-org-root-drop-lab">' +
            esc(tr('mb.org.dropRootShort', '↓ top level')) + '</span></div>' +
            '<table class="mb-org-tbl" aria-label="' + esc(tr('mb.org.saved', 'Folders & lists')) + '">' +
            '<thead><tr>' +
            '<th class="mb-org-th-check"><input type="checkbox" id="mbListCheckAllSaved" ' +
            'data-mb-list-check-all="saved" title="' + esc(tr('mb.org.selectAll', 'Select all')) + '"></th>' +
            '<th class="mb-org-th-mark" title="' + esc(tr('mb.org.mark.title', 'Remarks')) + '">★</th>' +
            '<th class="mb-org-th-name">' + esc(tr('mb.org.col.name', 'List')) + '</th>' +
            '</tr></thead><tbody>' + savedRows + '</tbody></table></div>';
        syncListSelectAllUi();
        syncMoveUnderUi();
    }

    /** Only folders may own children. Lists never become parents. */
    function resolveFolderParentId(candidateId) {
        var pid = String(candidateId || '').trim();
        if (!pid || !isSavedListId(pid)) return '';
        var seg = findSavedSegment(pid);
        if (!seg) return '';
        applyOrgToSegment(seg);
        return seg.kind === 'folder' ? seg.id : '';
    }

    function currentFolderParentId() {
        if (!isSavedListId(_activeSegmentId)) return '';
        var seg = findSavedSegment(_activeSegmentId);
        if (!seg) return '';
        applyOrgToSegment(seg);
        // Nest only under a folder — never under another patient list
        if (seg.kind === 'folder') return seg.id;
        return resolveFolderParentId(seg.parentId);
    }

    /**
     * Create a folder or membership list. Returns Promise<row|null>.
     * opts: { name, parentId, kind, patientIds, activate, quiet }
     */
    function createSegmentRecord(opts) {
        opts = opts || {};
        var nm = String(opts.name || '').trim();
        if (!nm) return Promise.resolve(null);
        var rawParent = opts.parentId != null ? String(opts.parentId) : '';
        var parent = rawParent ? resolveFolderParentId(rawParent) : '';
        if (rawParent && !parent) {
            alert(tr('mb.org.listCannotNest',
                'A patient list cannot contain other lists. Open a folder, then use “Save under folder”.'));
            return Promise.resolve(null);
        }
        var isFolder = opts.kind === 'folder';
        var patientIds = normalizePatientIds(opts.patientIds || []);
        var activate = opts.activate !== false;
        var quiet = !!opts.quiet;
        var status = pick('mbStatus');

        function finish(row) {
            applyOrgToSegment(row);
            row.parentId = parent;
            row.kind = isFolder ? 'folder' : 'list';
            row.patientIds = isFolder ? [] : patientIds.slice();
            var exists = false;
            for (var i = 0; i < _segments.length; i++) {
                if (String(_segments[i].id) === String(row.id)) {
                    _segments[i] = row;
                    exists = true;
                    break;
                }
            }
            if (!exists) _segments.push(row);
            persistSegmentOrg(row);
            if (activate) {
                _activeSegmentId = row.id;
                if (!quiet) {
                    renderSegments();
                    applyFilters();
                }
            }
            if (!quiet && status) {
                status.textContent = isFolder
                    ? trRepl('mb.org.folderCreated', { NAME: row.name }, 'Folder “{NAME}” created.')
                    : trRepl('mb.seg.savedOk', { NAME: row.name, N: row.patientIds.length },
                        'Saved list “{NAME}” ({N} contacts).');
            }
            return row;
        }

        function localCreate() {
            var localId = 'seg_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e4);
            var row = finish({
                id: localId,
                name: nm,
                patientIds: isFolder ? [] : patientIds.slice(),
                conditions: null,
                parentId: parent,
                marker: '',
                remark: '',
                kind: isFolder ? 'folder' : 'list',
                createdAt: new Date().toISOString()
            });
            persistSegmentLocalFallback(_segments);
            return Promise.resolve(row);
        }

        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function' || _segmentsDbMissing) {
            if (!isFolder) alertSegmentsNeedCloud();
            return localCreate();
        }

        if (!quiet && status) status.textContent = tr('mb.seg.saving', 'Saving list to cloud…');
        var payload = {
            name: nm,
            patient_ids: isFolder ? [] : patientIds.slice(),
            conditions: conditionsWithOrg({
                parentId: parent,
                marker: '',
                remark: '',
                kind: isFolder ? 'folder' : 'list',
                conditions: null
            }),
            sort_order: _segments.length,
            created_by: segmentCreatedBy() || null
        };
        return SB.from(SEG_TABLE).insert([payload])
            .select('id,name,patient_ids,conditions,created_at,updated_at')
            .single()
            .then(function (r) {
                if (r.error) {
                    if (segmentsTableMissing(r.error)) {
                        _segmentsDbMissing = true;
                        alertSegmentsNeedCloud();
                        return localCreate();
                    }
                    alert(trRepl('mb.seg.saveFail', { MSG: r.error.message || r.error },
                        'Could not save list: {MSG}'));
                    return null;
                }
                var row = normalizeSegmentRow(r.data);
                if (!row) {
                    alert(tr('mb.seg.saveFailGeneric', 'Could not save list.'));
                    return null;
                }
                return finish(row);
            })
            .catch(function (err) {
                alert(trRepl('mb.seg.saveFail', { MSG: (err && err.message) || err },
                    'Could not save list: {MSG}'));
                return null;
            });
    }

    function createFolderNode(name, parentId, kind) {
        return createSegmentRecord({
            name: name,
            parentId: parentId || '',
            kind: kind === 'folder' ? 'folder' : 'list',
            patientIds: [],
            activate: true,
            quiet: false
        });
    }

    function createFolder() {
        var name = window.prompt(
            tr('mb.org.folderPrompt', 'Folder name'),
            tr('mb.org.folderDefault', 'Campaign folder')
        );
        if (name === null || !String(name).trim()) return;
        createFolderNode(name, '', 'folder');
    }

    function createSubfolder() {
        var parent = currentFolderParentId();
        if (!parent) {
            alert(tr('mb.org.needParent',
                'Open a folder first (lists cannot contain subfolders), then create a subfolder under it.'));
            return;
        }
        var parentSeg = findSavedSegment(parent);
        var name = window.prompt(
            trRepl('mb.org.subfolderPrompt', { NAME: parentSeg ? parentSeg.name : '' },
                'Subfolder name (under “{NAME}”)'),
            tr('mb.org.subfolderDefault', 'Subfolder')
        );
        if (name === null || !String(name).trim()) return;
        createFolderNode(name, parent, 'folder');
    }

    /** Selected ids in current filtered order; else full filtered set. */
    function collectIdsForPatchLists() {
        var selectedIds = Object.keys(_selected).filter(function (id) {
            return !!_selected[id];
        });
        if (selectedIds.length) {
            var set = {};
            selectedIds.forEach(function (id) { set[String(id)] = true; });
            return (_filtered || []).map(function (p) {
                return p && p.id != null && set[String(p.id)] ? String(p.id) : '';
            }).filter(Boolean);
        }
        return (_filtered || []).map(function (p) {
            return p && p.id != null ? String(p.id) : '';
        }).filter(Boolean);
    }

    /**
     * Auto patch list former:
     * selection/filtered pool → daily limit → folder + Patch 1..N lists under it.
     */
    function autoPatchListsFromSelection() {
        var ids = collectIdsForPatchLists();
        if (!ids.length) {
            alert(tr('mb.patch.needContacts',
                'Select contacts (or open a list / filter) first, then run Auto patch lists.'));
            return;
        }

        var limitStr = window.prompt(
            trRepl('mb.patch.limitPrompt', { N: ids.length },
                'Daily send limit (contacts per patch).\nCurrent pool: {N} contacts.'),
            '250'
        );
        if (limitStr === null) return;
        var limit = parseInt(String(limitStr).trim(), 10);
        if (!limit || limit < 1) {
            alert(tr('mb.patch.limitInvalid', 'Enter a valid daily limit (e.g. 250).'));
            return;
        }

        var patchCount = Math.ceil(ids.length / limit);
        var defaultFolder = trRepl('mb.patch.folderDefault', {
            D: new Date().toISOString().slice(0, 10)
        }, 'Patches {D}');
        var folderName = window.prompt(
            trRepl('mb.patch.folderPrompt', { P: patchCount, L: limit, N: ids.length },
                'New folder name for {P} patches ({N} contacts ÷ {L}/day):'),
            defaultFolder
        );
        if (folderName === null || !String(folderName).trim()) return;
        folderName = String(folderName).trim();

        if (!window.confirm(trRepl('mb.patch.confirm', {
            FOLDER: folderName,
            P: patchCount,
            L: limit,
            N: ids.length
        }, 'Create folder “{FOLDER}” with {P} lists (Patch 1…Patch {P}), up to {L} contacts each?\nTotal: {N} contacts.'))) {
            return;
        }

        var status = pick('mbStatus');
        if (status) {
            status.textContent = tr('mb.patch.working', 'Creating patch folder and lists…');
        }

        var chunks = [];
        for (var i = 0; i < ids.length; i += limit) {
            chunks.push(ids.slice(i, i + limit));
        }

        createSegmentRecord({
            name: folderName,
            parentId: '',
            kind: 'folder',
            patientIds: [],
            activate: false,
            quiet: true
        }).then(function (folder) {
            if (!folder) {
                if (status) {
                    status.textContent = tr('mb.patch.fail', 'Could not create patch folder.');
                }
                return null;
            }
            var chain = Promise.resolve(0);
            chunks.forEach(function (chunk, idx) {
                chain = chain.then(function (n) {
                    if (status) {
                        status.textContent = trRepl('mb.patch.progress', {
                            CUR: idx + 1,
                            P: chunks.length
                        }, 'Saving Patch {CUR} / {P}…');
                    }
                    return createSegmentRecord({
                        name: 'Patch ' + (idx + 1),
                        parentId: folder.id,
                        kind: 'list',
                        patientIds: chunk,
                        activate: false,
                        quiet: true
                    }).then(function (row) {
                        return row ? (n + 1) : n;
                    });
                });
            });
            return chain.then(function (made) {
                _activeSegmentId = folder.id;
                if (_listCollapsed[folder.id]) {
                    delete _listCollapsed[folder.id];
                    patchOrgMeta(folder.id, { collapsed: '' });
                }
                renderSegments();
                applyFilters();
                if (status) {
                    status.textContent = trRepl('mb.patch.done', {
                        FOLDER: folder.name,
                        P: made,
                        N: ids.length,
                        L: limit
                    }, 'Created “{FOLDER}” with {P} patches ({N} contacts, {L}/list).');
                }
                return made;
            });
        });
    }

    function saveCurrentAsSegmentUnder() {
        var parent = currentFolderParentId();
        if (!parent) {
            var active = activeSavedList();
            if (active && active.kind !== 'folder') {
                alert(tr('mb.org.listCannotNest',
                    'A patient list cannot contain other lists. Open a folder, then use “Save under folder”.'));
                return;
            }
            alert(tr('mb.org.needParentSave',
                'Open a saved folder first, then save contacts under it.'));
            return;
        }
        saveCurrentAsSegment(parent);
    }

    function renameSavedSegment(id) {
        var sid = String(id || '');
        if (!isSavedListId(sid)) return;
        var seg = findSavedSegment(sid);
        if (!seg) return;
        applyOrgToSegment(seg);
        var kindLabel = seg.kind === 'folder'
            ? tr('mb.org.folderTag', 'folder')
            : tr('mb.aud.list', 'List');
        var name = window.prompt(
            trRepl('mb.org.renamePrompt', { KIND: kindLabel }, 'Rename {KIND}'),
            seg.name || ''
        );
        if (name === null) return;
        name = String(name).trim();
        if (!name) {
            alert(tr('mb.org.renameEmpty', 'Name cannot be empty.'));
            return;
        }
        if (String(seg.name || '').trim() === name) return;

        var clash = null;
        loadSegments().forEach(function (s) {
            if (String(s.id) === sid) return;
            if (String(s.name || '').trim().toLowerCase() === name.toLowerCase()) clash = s;
        });
        if (clash) {
            alert(trRepl('mb.org.renameClash', { NAME: clash.name },
                'Another item is already named “{NAME}”.'));
            return;
        }

        var status = pick('mbStatus');
        function finishRename() {
            seg.name = name;
            persistSegmentOrg(seg);
            persistSegmentLocalFallback(_segments);
            renderSegments();
            if (status) {
                status.textContent = trRepl('mb.org.renamedOk', { NAME: name },
                    'Renamed to “{NAME}”.');
            }
        }

        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function' || _segmentsDbMissing) {
            finishRename();
            return;
        }
        if (status) status.textContent = tr('mb.org.renaming', 'Renaming…');
        SB.from(SEG_TABLE).update({
            name: name,
            updated_at: new Date().toISOString()
        }).eq('id', sid).then(function (r) {
            if (r.error) {
                if (segmentsTableMissing(r.error)) {
                    _segmentsDbMissing = true;
                    finishRename();
                    return;
                }
                alert(trRepl('mb.org.renameFail', { MSG: r.error.message || r.error },
                    'Could not rename: {MSG}'));
                return;
            }
            finishRename();
        }).catch(function (err) {
            alert(trRepl('mb.org.renameFail', { MSG: (err && err.message) || err },
                'Could not rename: {MSG}'));
        });
    }

    function collectMoveCandidateIds(preferId) {
        var checked = Object.keys(_listSelected).filter(function (id) {
            return _listSelected[id] && isSavedListId(id);
        });
        var pref = String(preferId || '');
        if (pref && checked.indexOf(pref) >= 0) return checked;
        if (pref && isSavedListId(pref)) return [pref];
        if (checked.length) return checked;
        if (isSavedListId(_activeSegmentId)) return [_activeSegmentId];
        return [];
    }

    function listFolderOptions(excludeIds) {
        var ban = {};
        (excludeIds || []).forEach(function (id) {
            ban[String(id)] = true;
            listDescendantIds(id).forEach(function (d) { ban[String(d)] = true; });
        });
        return loadSegments().filter(function (s) {
            applyOrgToSegment(s);
            return s.kind === 'folder' && !ban[String(s.id)];
        });
    }

    function canMoveListsUnder(ids, folderId) {
        var target = String(folderId || '');
        if (!ids || !ids.length) return false;
        for (var i = 0; i < ids.length; i++) {
            var id = String(ids[i]);
            if (!isSavedListId(id)) return false;
            if (target && (target === id || listDescendantIds(id).indexOf(target) >= 0)) {
                return false;
            }
            var seg = findSavedSegment(id);
            if (!seg) return false;
            if (String(seg.parentId || '') === target) {
                // already there — still allow UI highlight but move is no-op
            }
        }
        return true;
    }

    function moveListsUnderFolder(ids, folderId) {
        var target = String(folderId || '');
        var list = (ids || []).filter(function (id) { return isSavedListId(id); });
        if (!list.length) return false;
        if (!canMoveListsUnder(list, target)) {
            alert(tr('mb.org.moveCycle',
                'Cannot move a folder into itself or one of its subfolders.'));
            return false;
        }
        if (target) {
            var folder = findSavedSegment(target);
            if (!folder || folder.kind !== 'folder') {
                alert(tr('mb.org.moveNeedFolder', 'Choose a folder as the destination.'));
                return false;
            }
            // Auto-expand destination so the moved item is visible
            if (_listCollapsed[target]) {
                delete _listCollapsed[target];
                patchOrgMeta(target, { collapsed: '' });
            }
        }
        var moved = 0;
        list.forEach(function (id) {
            var seg = findSavedSegment(id);
            if (!seg) return;
            applyOrgToSegment(seg);
            if (String(seg.parentId || '') === target) return;
            seg.parentId = target;
            persistSegmentOrg(seg);
            moved += 1;
        });
        if (!moved) {
            var status0 = pick('mbStatus');
            if (status0) {
                status0.textContent = tr('mb.org.moveAlready', 'Already in that folder.');
            }
            return true;
        }
        renderSegments();
        applyFilters();
        var status = pick('mbStatus');
        if (status) {
            var destName = target
                ? ((findSavedSegment(target) && findSavedSegment(target).name) || target)
                : tr('mb.org.topLevel', 'Top level');
            status.textContent = trRepl('mb.org.movedOk', { N: moved, NAME: destName },
                'Moved {N} item(s) under “{NAME}”.');
        }
        return true;
    }

    function syncMoveUnderUi() {
        var btn = pick('mbMoveUnderFolderBtn');
        if (!btn) return;
        var ids = collectMoveCandidateIds();
        var show = ids.length > 0;
        btn.style.display = show ? '' : 'none';
        if (show) {
            btn.textContent = ids.length > 1
                ? trRepl('mb.org.moveTopN', { N: ids.length }, 'Move {N} to top level')
                : tr('mb.org.moveTop', 'Move to top level');
        }
    }

    function moveToTopLevel() {
        var ids = collectMoveCandidateIds();
        if (!ids.length) {
            alert(tr('mb.org.needSelectSavedMove',
                'Select a saved list or folder first, then choose Move to top level.'));
            return;
        }
        moveListsUnderFolder(ids, '');
    }

    /** @deprecated Use moveToTopLevel — kept for older onclick handlers */
    function moveUnderFolderPrompt() {
        moveToTopLevel();
    }

    function bulkSetMarkerPrompt(ev) {
        var ids = Object.keys(_listSelected).filter(function (id) { return _listSelected[id]; });
        if (!ids.length) {
            alert(tr('mb.org.needSelect', 'Select one or more lists first (left checkboxes).'));
            return;
        }
        var anchor = (ev && ev.currentTarget) || pick('mbOrgMarkBtn');
        // Toggle closed if already open for bulk
        if (_markMenuEl && _markMenuEl.classList.contains('is-open') &&
            _markMenuBulkIds && _markMenuBulkIds.length) {
            closeMarkerMenu();
            return;
        }
        if (ev && ev.stopPropagation) ev.stopPropagation();
        openBulkMarkerMenu(anchor, ids);
    }

    function deleteSelectedLists() {
        var ids = Object.keys(_listSelected).filter(function (id) {
            return _listSelected[id] && isSavedListId(id);
        });
        if (!ids.length) {
            alert(tr('mb.org.needSelectSaved',
                'Select one or more saved folders/lists to delete.'));
            return;
        }
        if (!window.confirm(trRepl('mb.org.confirmBulkDelete', { N: ids.length },
            'Delete {N} selected folder(s)/list(s)? Subfolders are removed too.'))) {
            return;
        }
        var all = {};
        ids.forEach(function (id) {
            all[id] = true;
            listDescendantIds(id).forEach(function (d) { all[d] = true; });
        });
        var chain = Promise.resolve();
        Object.keys(all).forEach(function (id) {
            chain = chain.then(function () { return deleteSavedSegmentSilent(id); });
        });
        chain.then(function () {
            _listSelected = {};
            applyCheckedListsToBody();
        });
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

    function saveCurrentAsSegment(parentIdOpt) {
        var ids = collectIdsForSavedList();
        if (!ids.length) {
            alert(tr('mb.seg.needContacts',
                'No contacts to save. Filter or select contacts first.'));
            return;
        }

        // "Save as list" (no parent arg) always stays top-level.
        // Nesting is only allowed when an explicit folder parent is passed
        // ("Save under folder") — never under another patient list.
        var parentId = '';
        if (parentIdOpt != null && String(parentIdOpt) !== '') {
            parentId = resolveFolderParentId(parentIdOpt);
            if (!parentId) {
                alert(tr('mb.org.listCannotNest',
                    'A patient list cannot contain other lists. Open a folder, then use “Save under folder”.'));
                return;
            }
        } else {
            // Guard: if a list is selected, do not silently nest under it
            var activeSel = activeSavedList();
            if (activeSel) {
                applyOrgToSegment(activeSel);
                if (activeSel.kind !== 'folder') {
                    // Keep flat — intentional no-op parent; status hint after save
                }
            }
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
        var existing = null;
        for (var i = 0; i < segs.length; i++) {
            if (String(segs[i].name || '').trim().toLowerCase() === name.toLowerCase()) {
                existing = segs[i];
                break;
            }
        }
        if (existing) {
            applyOrgToSegment(existing);
            if (existing.kind === 'folder') {
                alert(tr('mb.org.saveClashFolder',
                    'A folder already uses that name. Choose a different list name.'));
                return;
            }
            if (!window.confirm(trRepl('mb.seg.confirmOverwrite', { NAME: existing.name, N: ids.length },
                'List “{NAME}” already exists. Replace it with {N} contact(s)?'))) {
                return;
            }
            // Overwrite keeps the existing list's folder parent (if any),
            // but never attaches under a list.
            if (!parentId) {
                parentId = resolveFolderParentId(existing.parentId);
            }
        }

        var conditions = snapshotConditions();
        var status = pick('mbStatus');

        function finishOk(segId, savedName, count, rowRef) {
            if (rowRef) {
                rowRef.parentId = parentId || '';
                rowRef.kind = 'list';
                persistSegmentOrg(rowRef);
            }
            _activeSegmentId = segId;
            renderSegments();
            applyFilters();
            if (status) {
                status.textContent = trRepl('mb.seg.savedOk', { NAME: savedName, N: count },
                    'Saved list “{NAME}” ({N} contacts).');
            }
        }

        function saveLocalFallback(segId) {
            var list = _segments.slice();
            var found = null;
            for (var j = 0; j < list.length; j++) {
                if ((segId && String(list[j].id) === String(segId)) ||
                    String(list[j].name || '').trim().toLowerCase() === name.toLowerCase()) {
                    found = list[j];
                    break;
                }
            }
            if (found) {
                found.name = name;
                found.patientIds = ids.slice();
                found.conditions = conditions;
                found.parentId = parentId || '';
                found.kind = 'list';
                found.updatedAt = new Date().toISOString();
                _segments = list;
                persistSegmentLocalFallback(list);
                finishOk(found.id, name, ids.length, found);
            } else {
                var localId = segId || ('seg_' + Date.now().toString(36));
                var neu = {
                    id: localId,
                    name: name,
                    patientIds: ids.slice(),
                    conditions: conditions,
                    parentId: parentId,
                    marker: '',
                    remark: '',
                    kind: 'list',
                    createdAt: new Date().toISOString()
                };
                list.push(neu);
                _segments = list;
                persistSegmentLocalFallback(list);
                finishOk(localId, name, ids.length, neu);
            }
        }

        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function' || _segmentsDbMissing) {
            alertSegmentsNeedCloud();
            saveLocalFallback(existing && existing.id);
            return;
        }

        if (status) status.textContent = tr('mb.seg.saving', 'Saving list to cloud…');

        var orgShell = {
            parentId: parentId || '',
            marker: (existing && existing.marker) || '',
            remark: (existing && existing.remark) || '',
            kind: 'list',
            conditions: conditions
        };
        var payload = {
            name: name,
            patient_ids: ids.slice(),
            conditions: conditionsWithOrg(orgShell),
            updated_at: new Date().toISOString()
        };

        var req = existing
            ? SB.from(SEG_TABLE).update(payload).eq('id', existing.id).select(
                'id,name,patient_ids,conditions,created_at,updated_at'
            ).single()
            : SB.from(SEG_TABLE).insert([{
                name: name,
                patient_ids: ids.slice(),
                conditions: conditionsWithOrg(orgShell),
                sort_order: segs.length,
                created_by: segmentCreatedBy() || null
            }]).select('id,name,patient_ids,conditions,created_at,updated_at').single();

        req.then(function (r) {
            if (r.error) {
                if (segmentsTableMissing(r.error)) {
                    _segmentsDbMissing = true;
                    alertSegmentsNeedCloud();
                    saveLocalFallback(existing && existing.id);
                    return;
                }
                alert(trRepl('mb.seg.saveFail', { MSG: r.error.message || r.error },
                    'Could not save list: {MSG}'));
                return;
            }
            var row = normalizeSegmentRow(r.data);
            if (!row) {
                alert(tr('mb.seg.saveFailGeneric', 'Could not save list.'));
                return;
            }
            if (parentId) row.parentId = parentId;
            row.kind = 'list';
            if (existing) {
                for (var k = 0; k < _segments.length; k++) {
                    if (String(_segments[k].id) === String(row.id)) {
                        _segments[k] = row;
                        break;
                    }
                }
            } else {
                _segments.push(row);
            }
            finishOk(row.id, row.name, row.patientIds.length, row);
        }).catch(function (err) {
            alert(trRepl('mb.seg.saveFail', { MSG: (err && err.message) || err },
                'Could not save list: {MSG}'));
        });
    }

    function deleteSavedSegmentSilent(id) {
        var sid = String(id || '');
        if (!isSavedListId(sid)) return Promise.resolve();

        function finishDelete() {
            _segments = _segments.filter(function (s) {
                return String(s.id) !== sid;
            });
            delete _listSelected[sid];
            delete _listCollapsed[sid];
            var store = readOrgStore();
            if (store[sid]) {
                delete store[sid];
                writeOrgStore(store);
            }
            if (_activeSegmentId === sid) _activeSegmentId = 'all';
        }

        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function' || _segmentsDbMissing) {
            finishDelete();
            persistSegmentLocalFallback(_segments);
            return Promise.resolve();
        }

        return SB.from(SEG_TABLE).update({
            is_active: false,
            updated_at: new Date().toISOString()
        }).eq('id', sid).then(function (r) {
            if (r.error) {
                if (segmentsTableMissing(r.error)) {
                    _segmentsDbMissing = true;
                    finishDelete();
                    persistSegmentLocalFallback(_segments);
                    return;
                }
                console.warn('[broadcast] delete list', r.error);
                return;
            }
            finishDelete();
        }).catch(function (err) {
            console.warn('[broadcast] delete list', err);
        });
    }

    function deleteSavedSegment(id) {
        var sid = String(id || '');
        if (!isSavedListId(sid)) return;
        var seg = findSavedSegment(sid);
        var label = seg && seg.name ? seg.name : sid;
        var kids = listDescendantIds(sid);
        var msg = kids.length
            ? trRepl('mb.org.confirmDeleteTree', { NAME: label, N: kids.length },
                'Delete “{NAME}” and {N} subfolder(s)/list(s)?')
            : trRepl('mb.seg.confirmDelete', { NAME: label }, 'Delete list “{NAME}”?');
        if (!window.confirm(msg)) return;

        var chain = Promise.resolve();
        kids.slice().reverse().forEach(function (cid) {
            chain = chain.then(function () { return deleteSavedSegmentSilent(cid); });
        });
        chain.then(function () { return deleteSavedSegmentSilent(sid); })
            .then(function () {
                renderSegments();
                applyFilters();
            });
    }

    /** Union of patient ids for a folder (all descendant lists). */
    function membershipIdsForSegment(seg) {
        if (!seg) return [];
        if (seg.kind === 'folder') {
            var set = {};
            var ids = [seg.id].concat(listDescendantIds(seg.id));
            ids.forEach(function (id) {
                var s = findSavedSegment(id);
                if (!s || s.kind === 'folder') return;
                (s.patientIds || []).forEach(function (pid) {
                    if (pid != null && pid !== '') set[String(pid)] = true;
                });
            });
            return Object.keys(set);
        }
        return normalizePatientIds(seg.patientIds);
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
        // Name click = exclusive: one checked list matching the active filter
        _listSelected = {};
        if (_activeSegmentId) _listSelected[_activeSegmentId] = true;
        if (isSavedListId(_activeSegmentId)) {
            var seg = findSavedSegment(_activeSegmentId);
            if (seg) applyOrgToSegment(seg);
            // Folders / membership lists: clear UI filters so membership is obvious
            if (seg && (seg.kind === 'folder' ||
                (Array.isArray(seg.patientIds) && seg.patientIds.length))) {
                restoreConditionsToUi({
                    search: '', sex: '', dobMonth: '', hasPhone: '',
                    optOut: '', sent: '', clinic: '', extras: []
                });
            } else if (seg && seg.conditions) {
                restoreConditionsToUi(seg.conditions);
            }
        } else if (!BUILTIN_SEGMENTS[_activeSegmentId]) {
            restoreConditionsToUi({
                search: '', sex: '', dobMonth: '', hasPhone: '',
                optOut: '', sent: '', clinic: '', extras: []
            });
        }
        renderSegments();
        syncMoveUnderUi();
        enrichDoctorFilter().then(function () { applyFilters(); });
    }

    /**
     * Apply organiser checkbox selection to the contacts body.
     * 0 → All contacts; 1 → that list; 2+ → OR-union (add-on sum of contacts).
     */
    function applyCheckedListsToBody() {
        var checked = getCheckedListIds();
        if (!checked.length) {
            _activeSegmentId = 'all';
            restoreConditionsToUi({
                search: '', sex: '', dobMonth: '', hasPhone: '',
                optOut: '', sent: '', clinic: '', extras: []
            });
            renderSegments();
            syncMoveUnderUi();
            enrichDoctorFilter().then(function () { applyFilters(); });
            return;
        }
        if (checked.length === 1) {
            activateSegment(checked[0]);
            return;
        }
        _activeSegmentId = UNION_SEGMENT_ID;
        restoreConditionsToUi({
            search: '', sex: '', dobMonth: '', hasPhone: '',
            optOut: '', sent: '', clinic: '', extras: []
        });
        renderSegments();
        syncMoveUnderUi();
        enrichDoctorFilter().then(function () { applyFilters(); });
        var status = pick('mbStatus');
        if (status) {
            status.textContent = trRepl('mb.union.status', { N: checked.length },
                'Combined {N} checked lists (add-on / union).');
        }
    }

    /** Whether patient belongs to a single organiser segment (builtin or saved). */
    function patientMatchesSegmentId(p, segId, ctx) {
        if (!p || !segId) return false;
        ctx = ctx || {};
        var nowMonth = ctx.nowMonth || String(new Date().getMonth() + 1);
        if (segId === 'all') return !isBlankContact(p);
        if (segId === 'hasphone') return !!phoneOf(p);
        if (segId === 'birthday') {
            if (!p.dob) return false;
            return parseInt(String(p.dob).slice(5, 7), 10) === parseInt(nowMonth, 10);
        }
        if (segId === 'sent') return !!getSentInfo(p);
        if (segId === 'unsent') return !getSentInfo(p);
        if (segId === 'scope') {
            var clinicTag = ctx.scopeClinicTag || clinicTagForFilter();
            if (clinicTag && !patientMatchesClinicTag(p, clinicTag)) return false;
            if (ctx.doctorPatientIds && !ctx.doctorPatientIds[String(p.id)]) return false;
            return true;
        }
        if (isSavedListId(segId)) {
            var seg = findSavedSegment(segId);
            if (!seg) return false;
            applyOrgToSegment(seg);
            if (seg.kind === 'folder' ||
                (Array.isArray(seg.patientIds) && seg.patientIds.length)) {
                var ids = membershipIdsForSegment(seg);
                for (var i = 0; i < ids.length; i++) {
                    if (String(ids[i]) === String(p.id)) return true;
                }
                return false;
            }
            // Legacy condition-only saved list
            if (seg.conditions) {
                return patientMatchesLegacyConditions(p, seg.conditions, nowMonth);
            }
        }
        return false;
    }

    function patientMatchesLegacyConditions(p, c, nowMonth) {
        if (!c || typeof c !== 'object') return true;
        if (c.sex && String(p.sex || '') !== String(c.sex)) return false;
        if (c.dobMonth) {
            if (!p.dob) return false;
            if (parseInt(String(p.dob).slice(5, 7), 10) !== parseInt(c.dobMonth, 10)) return false;
        }
        if (c.hasPhone === 'yes' && !phoneOf(p)) return false;
        if (c.hasPhone === 'no' && phoneOf(p)) return false;
        if (c.optOut === 'exclude' && p.messaging_opt_out) return false;
        if (c.optOut === 'only' && !p.messaging_opt_out) return false;
        if (c.clinic && !patientMatchesClinicTag(p, c.clinic)) return false;
        var sentInfo = getSentInfo(p);
        if (c.sent === 'yes' && !sentInfo) return false;
        if (c.sent === 'no' && sentInfo) return false;
        var search = String(c.search != null ? c.search : '').trim().toLowerCase();
        if (search) {
            var blob = [
                p.patient_no, p.full_name, p.chinese_name,
                p.phone_number, p.mobile_phone, p.email
            ].join(' ').toLowerCase();
            if (blob.indexOf(search) < 0) return false;
        }
        var extras = Array.isArray(c.extras) ? c.extras : [];
        for (var i = 0; i < extras.length; i++) {
            if (!matchCondition(p, extras[i])) return false;
        }
        return !isBlankContact(p);
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
                // Drop any previously selected contacts that are opted out
                Object.keys(_selected).forEach(function (sid) {
                    if (isMessagingOptOut(findPatientById(sid))) delete _selected[sid];
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
        // Doctor scope for built-in "Clinic / doctor bar", or union that includes it
        var needsScope = _activeSegmentId === 'scope' ||
            (_activeSegmentId === UNION_SEGMENT_ID && !!_listSelected.scope);
        if (!needsScope) return Promise.resolve();

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

        // Custom saved list / folder with fixed membership (preferred)
        var membershipSet = null;
        var unionMode = _activeSegmentId === UNION_SEGMENT_ID;
        var unionIds = unionMode ? getCheckedListIds() : [];
        var unionCtx = null;

        if (unionMode) {
            unionCtx = {
                nowMonth: String(new Date().getMonth() + 1),
                scopeClinicTag: clinicTagForFilter(),
                doctorPatientIds: _doctorPatientIds
            };
            // Preload saved-list membership into a set for speed; builtins stay predicate-based
            unionCtx.savedSets = {};
            unionIds.forEach(function (id) {
                if (!isSavedListId(id)) return;
                var seg = findSavedSegment(id);
                if (!seg) return;
                applyOrgToSegment(seg);
                var set = {};
                membershipIdsForSegment(seg).forEach(function (pid) {
                    set[String(pid)] = true;
                });
                // Legacy condition lists: empty patientIds — match via patientMatchesSegmentId
                unionCtx.savedSets[id] = {
                    seg: seg,
                    set: set,
                    useSet: seg.kind === 'folder' ||
                        (Array.isArray(seg.patientIds) && seg.patientIds.length > 0)
                };
            });
        } else if (isSavedListId(_activeSegmentId)) {
            var seg = findSavedSegment(_activeSegmentId);
            if (seg) applyOrgToSegment(seg);
            if (seg && seg.kind === 'folder') {
                membershipSet = {};
                membershipIdsForSegment(seg).forEach(function (pid) {
                    membershipSet[String(pid)] = true;
                });
                // Empty folder → show no contacts (organiser shell)
                if (!Object.keys(membershipSet).length) membershipSet.__emptyFolder = true;
            } else if (seg && Array.isArray(seg.patientIds) && seg.patientIds.length) {
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

            if (unionMode) {
                var hit = false;
                for (var ui = 0; ui < unionIds.length; ui++) {
                    var uid = unionIds[ui];
                    if (isSavedListId(uid) && unionCtx.savedSets[uid] &&
                        unionCtx.savedSets[uid].useSet) {
                        if (unionCtx.savedSets[uid].set[String(p.id)]) {
                            hit = true;
                            break;
                        }
                        continue;
                    }
                    if (patientMatchesSegmentId(p, uid, unionCtx)) {
                        hit = true;
                        break;
                    }
                }
                if (!hit) return false;
                // Continue with optional UI search only (list OR already applied)
                if (search) {
                    var ublob = [
                        p.patient_no, p.full_name, p.chinese_name,
                        p.phone_number, p.mobile_phone, p.email
                    ].join(' ').toLowerCase();
                    if (ublob.indexOf(search) < 0) return false;
                }
                if (optOut === 'exclude' && p.messaging_opt_out) return false;
                if (optOut === 'only' && !p.messaging_opt_out) return false;
                return true;
            }

            if (membershipSet) {
                if (membershipSet.__emptyFolder) return false;
                if (!membershipSet[String(p.id)]) return false;
                if (optOut === 'exclude' && p.messaging_opt_out) return false;
                if (optOut === 'only' && !p.messaging_opt_out) return false;
                return true;
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
        renderTable(); // syncSelectionUi → updateCounts
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
                    var on = !!pageCb.checked;
                    slice.forEach(function (p) {
                        if (!p || p.id == null) return;
                        if (on && !isSelectablePatient(p)) return;
                        setPatientSelected(p.id, on);
                    });
                    if (slice.length) {
                        _selectAnchorId = String(slice[0].id);
                    }
                    renderTable();
                    syncSelectionUi();
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
            syncSelectionUi();
            return;
        }

        var html = '';
        slice.forEach(function (p) {
            var pid = String(p.id);
            var checked = _selected[pid] ? ' checked' : '';
            var sentInfo = getSentInfo(p);
            html += '<tr class="mb-row' +
                (p.messaging_opt_out ? ' mb-row-optout' : '') +
                (sentInfo ? ' mb-row-sent' : '') + '"' +
                (p.messaging_opt_out
                    ? ' title="' + esc(tr('mb.optOut.rowTitle',
                        'Opted out — will not receive clinic broadcast messages')) + '"'
                    : '') + '>';
            html +=
                '<td class="mb-td-check"><input type="checkbox" data-mb-row="' +
                esc(pid) + '"' + checked +
                (p.messaging_opt_out
                    ? ' disabled title="' + esc(tr('mb.optOut.disabledCheck',
                        'Opted-out contacts cannot be selected for broadcast')) + '"'
                    : '') +
                '></td>';
            cols.forEach(function (c) {
                if (!c.on) return;
                html += '<td>' + cellHtml(p, c.key) + '</td>';
            });
            html += '<td class="mb-td-sent">' + lastSentCellHtml(p) + '</td>';
            html += '</tr>';
        });
        body.innerHTML = html;
        renderPager();
        syncSelectionUi();
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
                n += ' <button type="button" class="mb-optout-toggle is-allow" data-mb-optout-toggle="' +
                    esc(String(p.id)) + '" data-mb-optout-set="0">' +
                    esc(tr('mb.optOut.allowOne', 'Allow')) + '</button>';
            } else {
                n += ' <button type="button" class="mb-optout-toggle" data-mb-optout-toggle="' +
                    esc(String(p.id)) + '" data-mb-optout-set="1">' +
                    esc(tr('mb.optOut.markOne', 'Opt out')) + '</button>';
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
        syncPageSelectInputs();
    }

    function findPatientById(id) {
        var want = String(id == null ? '' : id);
        if (!want) return null;
        for (var i = 0; i < _allPatients.length; i++) {
            if (_allPatients[i] && String(_allPatients[i].id) === want) return _allPatients[i];
        }
        return null;
    }

    function isMessagingOptOut(p) {
        return !!(p && p.messaging_opt_out);
    }

    function isSelectablePatient(p) {
        return !!(p && p.id != null && !p.messaging_opt_out);
    }

    function setPatientSelected(id, on) {
        var sid = String(id == null ? '' : id);
        if (!sid) return;
        if (on) {
            // Hard gate: opted-out patients never enter receiver selection
            if (isMessagingOptOut(findPatientById(sid))) {
                delete _selected[sid];
                return;
            }
            _selected[sid] = true;
        } else {
            delete _selected[sid];
        }
    }

    /**
     * Persist messaging_opt_out on patients and refresh local caches.
     * @param {string[]} ids
     * @param {boolean} optedOut
     * @returns {Promise<{ok:number,fail:number,error?:string}>}
     */
    function persistMessagingOptOut(ids, optedOut) {
        var flag = !!optedOut;
        var list = (ids || []).map(String).filter(Boolean);
        if (!list.length) {
            return Promise.resolve({ ok: 0, fail: 0 });
        }
        if (typeof SB === 'undefined' || !SB) {
            return Promise.resolve({
                ok: 0,
                fail: list.length,
                error: tr('mb.optOut.noSb', 'Supabase is not available.')
            });
        }
        var CHUNK = 40;
        var ok = 0;
        var fail = 0;
        var lastErr = '';
        var columnMissing = false;

        function applyLocal(id) {
            var p = findPatientById(id);
            if (p) p.messaging_opt_out = flag;
            if (flag) delete _selected[String(id)];
        }

        function runChunk(offset) {
            if (offset >= list.length) {
                return Promise.resolve({
                    ok: ok,
                    fail: fail,
                    error: lastErr || undefined,
                    columnMissing: columnMissing
                });
            }
            var slice = list.slice(offset, offset + CHUNK);
            return Promise.all(slice.map(function (id) {
                return SB.from('patients')
                    .update({ messaging_opt_out: flag })
                    .eq('id', id)
                    .then(function (r) {
                        if (r.error) {
                            fail += 1;
                            lastErr = r.error.message || String(r.error);
                            if (/messaging_opt_out/i.test(lastErr)) {
                                columnMissing = true;
                                // Keep UI usable this session if schema not applied yet
                                applyLocal(id);
                                ok += 1;
                                fail -= 1;
                            }
                        } else {
                            applyLocal(id);
                            ok += 1;
                        }
                    })
                    .catch(function (err) {
                        fail += 1;
                        lastErr = (err && err.message) || String(err);
                    });
            })).then(function () {
                return runChunk(offset + CHUNK);
            });
        }

        return runChunk(0);
    }

    function markSelectedOptOut(optedOut) {
        var ids = selectedPatientIds();
        if (!ids.length) {
            alert(tr('mb.alert.selectFirst', 'Select at least one contact first.'));
            return;
        }
        var flag = !!optedOut;
        var msg = flag
            ? trRepl('mb.optOut.confirmMark', { N: ids.length },
                'Mark {N} contact(s) as opt-out? They will not receive clinic broadcasts.')
            : trRepl('mb.optOut.confirmClear', { N: ids.length },
                'Allow {N} contact(s) to receive clinic broadcasts again?');
        if (!window.confirm(msg)) return;

        var status = pick('mbStatus');
        if (status) {
            status.textContent = tr('mb.optOut.saving', 'Saving opt-out preference…');
        }

        persistMessagingOptOut(ids, flag).then(function (res) {
            applyFilters();
            if (status) {
                if (res.fail && !res.ok) {
                    status.textContent = trRepl('mb.optOut.saveFail', {
                        ERR: res.error || ''
                    }, 'Could not save opt-out. {ERR}');
                } else if (res.fail) {
                    status.textContent = trRepl('mb.optOut.savePartial', {
                        OK: res.ok, FAIL: res.fail
                    }, 'Updated {OK}; failed {FAIL}.');
                } else {
                    status.textContent = flag
                        ? trRepl('mb.optOut.markedOk', { N: res.ok },
                            'Marked {N} contact(s) as opt-out.')
                        : trRepl('mb.optOut.clearedOk', { N: res.ok },
                            'Cleared opt-out for {N} contact(s).');
                }
            }
            if (res.columnMissing) {
                alert(tr('mb.optOut.needSql',
                    'Opt-out needs the patients.messaging_opt_out column. Run message_broadcast.sql in Supabase SQL Editor.'));
            }
        });
    }

    function toggleOneOptOut(patientId, setOut) {
        var id = String(patientId || '');
        if (!id) return;
        var p = findPatientById(id);
        var next = setOut == null ? !(p && p.messaging_opt_out) : !!setOut;
        var status = pick('mbStatus');
        if (status) {
            status.textContent = tr('mb.optOut.saving', 'Saving opt-out preference…');
        }
        persistMessagingOptOut([id], next).then(function (res) {
            applyFilters();
            if (status) {
                if (res.fail && !res.ok) {
                    status.textContent = trRepl('mb.optOut.saveFail', {
                        ERR: res.error || ''
                    }, 'Could not save opt-out. {ERR}');
                } else {
                    status.textContent = next
                        ? tr('mb.optOut.markedOneOk', 'Contact marked as opt-out.')
                        : tr('mb.optOut.clearedOneOk', 'Contact can receive broadcasts again.');
                }
            }
            if (res.columnMissing || (res.fail && !res.ok && res.error && /messaging_opt_out/i.test(res.error))) {
                alert(tr('mb.optOut.needSql',
                    'Opt-out needs the patients.messaging_opt_out column. Run message_broadcast.sql in Supabase SQL Editor.'));
            }
        });
    }

    function selectedPatientIds() {
        return Object.keys(_selected).filter(function (id) {
            return !!_selected[id];
        });
    }

    function syncPageSelectCheckbox() {
        var pageCb = pick('mbSelectPage');
        if (!pageCb) return;
        var start = _page * PAGE_SIZE;
        var slice = _filtered.slice(start, start + PAGE_SIZE);
        var selectable = slice.filter(isSelectablePatient);
        if (!selectable.length) {
            pageCb.checked = false;
            pageCb.indeterminate = false;
            pageCb.disabled = !slice.length ? false : true;
            return;
        }
        pageCb.disabled = false;
        var n = 0;
        selectable.forEach(function (p) {
            if (p && p.id != null && _selected[String(p.id)]) n += 1;
        });
        pageCb.checked = n === selectable.length;
        pageCb.indeterminate = n > 0 && n < selectable.length;
    }

    function syncSelectionUi() {
        syncPageSelectCheckbox();
        updateCounts();
    }

    function updateCounts() {
        var el = pick('mbCounts');
        if (!el) return;
        var selIds = selectedPatientIds();
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

    function filteredIndexOfPatientId(pid) {
        var want = String(pid || '');
        if (!want) return -1;
        for (var i = 0; i < _filtered.length; i++) {
            if (_filtered[i] && String(_filtered[i].id) === want) return i;
        }
        return -1;
    }

    /**
     * Shift+click range: select every filtered row between two patient ids (inclusive).
     * Works across pages using the current filtered sort order.
     */
    function selectFilteredRange(fromId, toId, selectOn) {
        var a = filteredIndexOfPatientId(fromId);
        var b = filteredIndexOfPatientId(toId);
        if (a < 0 && b < 0) return 0;
        if (a < 0) a = b;
        if (b < 0) b = a;
        var lo = Math.min(a, b);
        var hi = Math.max(a, b);
        var on = selectOn !== false;
        var n = 0;
        for (var i = lo; i <= hi; i++) {
            var p = _filtered[i];
            if (!p || p.id == null) continue;
            if (on && !isSelectablePatient(p)) continue;
            setPatientSelected(p.id, on);
            if (on) n += 1;
        }
        var status = pick('mbStatus');
        if (status && on) {
            status.textContent = trRepl('mb.shiftSelect.ok', { N: n },
                'Shift-selected {N} contacts (from–to).');
        }
        return n;
    }

    function selectAllFiltered() {
        var n = 0;
        _filtered.forEach(function (p) {
            if (!isSelectablePatient(p)) return;
            setPatientSelected(p.id, true);
            n += 1;
        });
        if (_filtered.length) {
            var firstSel = _filtered.find(isSelectablePatient);
            _selectAnchorId = firstSel ? String(firstSel.id) : String(_filtered[0].id);
        }
        renderTable();
        syncSelectionUi();
        var status = pick('mbStatus');
        if (status) {
            status.textContent = trRepl('mb.selectAll.ok', { N: n },
                'Selected {N} sendable contacts (opt-out skipped).');
        }
    }

    function clearSelection() {
        _selected = {};
        _selectAnchorId = null;
        renderTable();
        syncSelectionUi();
    }

    function syncPageSelectInputs() {
        var total = _filtered.length;
        var pages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
        var fromEl = pick('mbSelPageFrom');
        var toEl = pick('mbSelPageTo');
        var cur = (_page || 0) + 1;
        [fromEl, toEl].forEach(function (el) {
            if (!el) return;
            el.max = String(pages);
            el.disabled = total === 0;
            var v = parseInt(el.value, 10);
            if (!el.value || isNaN(v) || v < 1) el.value = String(cur);
            else if (v > pages) el.value = String(pages);
        });
    }

    /** Select contacts on pages from–to only (1-based, inclusive). */
    function selectByPageRange() {
        var total = _filtered.length;
        var pages = Math.max(1, Math.ceil(total / PAGE_SIZE) || 1);
        if (!total) {
            alert(tr('mb.selectByPage.empty', 'No contacts to select on this result set.'));
            return;
        }
        var fromEl = pick('mbSelPageFrom');
        var toEl = pick('mbSelPageTo');
        var from = parseInt(fromEl && fromEl.value, 10);
        var to = parseInt(toEl && toEl.value, 10);
        if (isNaN(from) || from < 1) from = 1;
        if (isNaN(to) || to < 1) to = from;
        if (from > to) {
            var swap = from;
            from = to;
            to = swap;
        }
        from = Math.min(from, pages);
        to = Math.min(to, pages);
        if (fromEl) fromEl.value = String(from);
        if (toEl) toEl.value = String(to);

        var startIdx = (from - 1) * PAGE_SIZE;
        var endIdx = Math.min(total, to * PAGE_SIZE);
        _selected = {};
        var n = 0;
        var firstId = null;
        for (var i = startIdx; i < endIdx; i++) {
            var p = _filtered[i];
            if (!p || p.id == null) continue;
            if (!isSelectablePatient(p)) continue;
            var pid = String(p.id);
            setPatientSelected(pid, true);
            if (!firstId) firstId = pid;
            n += 1;
        }
        _selectAnchorId = firstId;
        // Show the first page of the selected range
        goToPage(from - 1);
        syncSelectionUi();
        var status = pick('mbStatus');
        if (status) {
            status.textContent = from === to
                ? trRepl('mb.selectByPage.okOne', { P: from, N: n },
                    'Selected page {P} ({N} contacts).')
                : trRepl('mb.selectByPage.okRange', { FROM: from, TO: to, N: n },
                    'Selected pages {FROM}–{TO} ({N} contacts).');
        }
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
        var bodyEl = pick('mbSmsBody');
        var bodyHint = bodyEl ? String(bodyEl.value || '') : String(_smsBody || '');
        var lang = messageLangFromBody(bodyHint);
        if (f === 'NAME' || f === 'FIRST') return lang === 'zh' ? '陳大文' : 'Alex';
        if (f === 'NAME_EN') return 'Alex';
        if (f === 'NAME_ZH') return '陳大文';
        if (f === 'FULL_NAME') return lang === 'zh' ? '陳大文' : 'Alex Chan';
        if (f === 'FULL_NAME_EN' || f === 'ENGLISH') return 'Alex Chan';
        if (f === 'FULL_NAME_ZH' || f === 'CHINESE') return '陳大文';
        if (f === 'CLINIC') {
            if (typeof clinicNameForOutboundMessage === 'function') {
                return clinicNameForOutboundMessage({ body: bodyHint, fallback: 'Joyful Smile' });
            }
            return lang === 'zh' ? '歡樂笑容牙科' : 'Joyful Smile';
        }
        if (f === 'CLINIC_EN') {
            return typeof clinicNameForOutboundMessage === 'function'
                ? (clinicNameForOutboundMessage({ lang: 'en', fallback: 'Joyful Smile' }) || 'Joyful Smile')
                : 'Joyful Smile';
        }
        if (f === 'CLINIC_ZH' || f === 'CLINIC_CHI') {
            return typeof clinicNameForOutboundMessage === 'function'
                ? (clinicNameForOutboundMessage({ lang: 'zh', fallback: 'Joyful Smile' }) || 'Joyful Smile')
                : '歡樂笑容牙科';
        }
        if (f === 'DATE') return '2026-07-22';
        if (f === 'TIME') return '10:00 AM';
        if (f === 'DOCTOR') {
            if (typeof doctorNameForOutboundMessage === 'function') {
                return doctorNameForOutboundMessage({}, {
                    body: bodyHint,
                    doctor: { english_name: 'Chan Tai Man', chinese_name: '陳大文' }
                }) || (lang === 'zh' ? '陳大文' : 'Chan Tai Man');
            }
            return lang === 'zh' ? '陳大文' : 'Chan Tai Man';
        }
        if (f === 'DOCTOR_EN') return 'Chan Tai Man';
        if (f === 'DOCTOR_ZH' || f === 'DOCTOR_CHI') return '陳大文';
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

    function broadcastClinicName(p, bodyHint) {
        var rec = clinicRecordForPatient(p);
        if (typeof clinicNameForOutboundMessage === 'function') {
            return clinicNameForOutboundMessage({
                body: bodyHint || '',
                clinic: rec,
                fallback: 'Joyful Smile'
            });
        }
        if (typeof currentClinicLabel !== 'undefined' && currentClinicLabel) {
            return String(currentClinicLabel);
        }
        return clinicLabel(p && p.clinic_tag) || 'Joyful Smile';
    }

    function broadcastClinicNameLang(p, lang) {
        var rec = clinicRecordForPatient(p);
        if (typeof clinicNameForOutboundMessage === 'function') {
            return clinicNameForOutboundMessage({
                lang: lang,
                clinic: rec,
                fallback: 'Joyful Smile'
            });
        }
        return broadcastClinicName(p, lang === 'zh' ? '診所' : 'clinic');
    }

    function personaliseSms(body, p) {
        var clinic = broadcastClinicName(p, body);
        var clinicEn = broadcastClinicNameLang(p, 'en');
        var clinicZh = broadcastClinicNameLang(p, 'zh');
        var fullName = displayNameForMessage(p, body);
        var fullEn = patientFullEn(p);
        var fullZh = patientFullZh(p);
        var name = firstNameForMessage(p, body);
        var nameEn = patientNameEn(p);
        var nameZh = patientNameZh(p);
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
        var doctor = broadcastDoctorName(appt, body);
        var doctorEn = broadcastDoctorNameLang(appt, 'en');
        var doctorZh = broadcastDoctorNameLang(appt, 'zh');
        // Longer dual tokens first so {NAME_EN} is not eaten by {NAME}.
        return String(body || '')
            .replace(/\{FULL_NAME_EN\}/gi, fullEn)
            .replace(/\{FULL_NAME_ZH\}/gi, fullZh)
            .replace(/\{NAME_EN\}/gi, nameEn)
            .replace(/\{NAME_ZH\}/gi, nameZh)
            .replace(/\{CLINIC_EN\}/gi, clinicEn || 'Joyful Smile')
            .replace(/\{CLINIC_ZH\}/gi, clinicZh || clinicEn || 'Joyful Smile')
            .replace(/\{CLINIC_CHI\}/gi, clinicZh || clinicEn || 'Joyful Smile')
            .replace(/\{DOCTOR_EN\}/gi, doctorEn || '-')
            .replace(/\{DOCTOR_ZH\}/gi, doctorZh || doctorEn || '-')
            .replace(/\{DOCTOR_CHI\}/gi, doctorZh || doctorEn || '-')
            .replace(/\{FULL_NAME\}/gi, fullName)
            .replace(/\{NAME\}/gi, name)
            .replace(/\{CLINIC\}/gi, clinic || 'Joyful Smile')
            .replace(/\{DATE\}/gi, date)
            .replace(/\{TIME\}/gi, time)
            .replace(/\{DOCTOR\}/gi, doctor)
            .replace(/\{PHONE\}/gi, phoneOf(p))
            .replace(/\{PATIENT_NO\}/gi, String(p.patient_no || ''));
    }

    function broadcastDoctorName(appt, bodyHint) {
        if (!appt) return '';
        if (typeof apptDoctorNameForWhatsApp === 'function') {
            return apptDoctorNameForWhatsApp(appt, { body: bodyHint || '' });
        }
        if (typeof doctorNameForOutboundMessage === 'function') {
            return doctorNameForOutboundMessage(appt, { body: bodyHint || '' });
        }
        return String(appt.doctor_name || appt.doctor_code || '').trim();
    }

    function broadcastDoctorNameLang(appt, lang) {
        if (!appt) return '';
        if (typeof doctorNameForOutboundMessage === 'function') {
            return doctorNameForOutboundMessage(appt, { lang: lang }) || '-';
        }
        return broadcastDoctorName(appt, lang === 'zh' ? '醫生' : 'doctor');
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
            .select('date,start_time,doctor_id,doctor_code,doctor_name,patient_name,patient_chinese_name')
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
        var listLabel = activeListLabel();
        var saved = activeSavedList();
        el.innerHTML =
            '<div class="mb-aud-list">' +
            '<strong>' + esc(tr('mb.aud.list', 'List')) + ':</strong> ' +
            esc(listLabel) +
            (saved && Array.isArray(saved.patientIds)
                ? ' <span class="mb-hint">(' + esc(String(saved.patientIds.length)) + ')</span>'
                : '') +
            '</div>' +
            '<strong>' + esc(String(list.length)) + '</strong> ' +
            esc(tr('mb.aud.selected', 'selected')) + ' · ' +
            '<strong>' + esc(String(sendable.length)) + '</strong> ' +
            esc(tr('mb.aud.sendable', 'sendable')) + ' · ' +
            esc(String(noPhone.length)) + ' ' +
            esc(tr('mb.aud.noPhone', 'no phone')) + ' · ' +
            esc(String(opted.length)) + ' ' +
            esc(tr('mb.aud.optOut', 'opt-out'));
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
            ' · ' + esc(tr('mb.aud.list', 'List')) + ': ' + esc(activeListLabel()) +
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
            opts.name = matched ? firstNameForMessage(matched, (pick('mbSmsBody') && pick('mbSmsBody').value) || _smsBody) : 'Test';
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
        var bodyEl = pick('mbSmsBody');
        var rawBody = bodyEl ? bodyEl.value : _smsBody;
        var name = firstNameForMessage(p, rawBody);
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
                var tplHint = [
                    rawBody,
                    tpl && tpl.notes,
                    tpl && tpl.label,
                    tpl && tpl.name,
                    tpl && tpl.body
                ].filter(Boolean).join('\n');
                var clinic = broadcastClinicName(p, tplHint);
                var date = appt && appt.date ? String(appt.date) : '';
                var time = '';
                if (appt && appt.start_time) {
                    time = typeof fmt12 === 'function'
                        ? fmt12(appt.start_time)
                        : String(appt.start_time);
                }
                var doctor = broadcastDoctorName(appt, tplHint);
                if (typeof AIHELPER !== 'undefined' &&
                    typeof AIHELPER.buildTwilioContentVariables === 'function') {
                    opts.contentVariables = AIHELPER.buildTwilioContentVariables(tpl, {
                        name: firstNameForMessage(p, tplHint),
                        fullName: displayNameForMessage(p, tplHint),
                        clinic: clinic,
                        date: date,
                        time: time,
                        doctor: doctor,
                        phone: phoneOf(p),
                        patientNo: p.patient_no || '',
                        body: body,
                        fields: {
                            NAME_EN: patientNameEn(p),
                            NAME_ZH: patientNameZh(p),
                            FULL_NAME_EN: patientFullEn(p),
                            FULL_NAME_ZH: patientFullZh(p),
                            CLINIC_EN: broadcastClinicNameLang(p, 'en'),
                            CLINIC_ZH: broadcastClinicNameLang(p, 'zh'),
                            CLINIC_CHI: broadcastClinicNameLang(p, 'zh'),
                            DOCTOR_EN: broadcastDoctorNameLang(appt, 'en'),
                            DOCTOR_ZH: broadcastDoctorNameLang(appt, 'zh'),
                            DOCTOR_CHI: broadcastDoctorNameLang(appt, 'zh'),
                            ENGLISH: patientFullEn(p),
                            CHINESE: patientFullZh(p)
                        }
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
        var savedList = activeSavedList();
        var campaignPayload = {
            name: _campaignName,
            channel: _channel,
            from_phone: getFromPhone() || null,
            content_sid: _channel === 'whatsapp' ? (getSelectedTpl() && getSelectedTpl().contentSid) : null,
            body_template: _channel === 'sms' ? _smsBody : null,
            audience_mode: savedList ? 'list' : 'selection',
            audience_snapshot: {
                selectedIds: queue.map(function (p) { return p.id; }),
                skipped: skipped.length,
                filters: snapshotConditions(),
                listId: savedList ? savedList.id : null,
                listName: savedList ? savedList.name : activeListLabel()
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
            .select('id,name,channel,status,totals,created_at,completed_at,created_by,clinic_tag,audience_snapshot,audience_mode')
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
                    var snap = c.audience_snapshot || {};
                    var listName = snap.listName || '';
                    var nameCell = esc(c.name || '—') +
                        (listName
                            ? '<div class="mb-hint">' + esc(tr('mb.aud.list', 'List') + ': ' + listName) + '</div>'
                            : '');
                    return (
                        '<tr class="mb-hist-row" data-mb-campaign="' + esc(c.id) + '">' +
                        '<td>' + nameCell + '</td>' +
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
                var snap = (camp && camp.audience_snapshot) || {};
                var listLine = snap.listName
                    ? '<div class="mb-hint">' + esc(tr('mb.aud.list', 'List') + ': ' + snap.listName) + '</div>'
                    : '';
                host.innerHTML =
                    '<div class="mb-hist-detail-head">' +
                    '<div><strong>' + esc(camp ? camp.name : campaignId) + '</strong>' + listLine + '</div>' +
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
        // UTF-8 BOM so Excel opens Traditional Chinese names correctly (CSV UTF-8).
        var blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
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
        selectByPageRange: selectByPageRange,
        clearSelection: clearSelection,
        addCondition: addCondition,
        clearConditions: clearConditions,
        clearAllFilters: clearAllFilters,
        toggleColEditor: toggleColEditor,
        saveCurrentAsSegment: saveCurrentAsSegment,
        saveCurrentAsSegmentUnder: saveCurrentAsSegmentUnder,
        moveToTopLevel: moveToTopLevel,
        moveUnderFolderPrompt: moveUnderFolderPrompt,
        moveListsUnderFolder: moveListsUnderFolder,
        renameSavedSegment: renameSavedSegment,
        createFolder: createFolder,
        createSubfolder: createSubfolder,
        autoPatchListsFromSelection: autoPatchListsFromSelection,
        bulkSetMarkerPrompt: bulkSetMarkerPrompt,
        deleteSelectedLists: deleteSelectedLists,
        setListMarker: setListMarker,
        setListRemark: setListRemark,
        refreshSegmentsFromCloud: refreshSegmentsFromCloud,
        startCampaignFromSelection: startCampaignFromSelection,
        markSelectedOptOut: markSelectedOptOut,
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
