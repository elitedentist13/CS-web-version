/* Doctor colour keys for appointment weekly / monthly calendars (Google Calendar style). */
var CalDoctorColors = (function () {
    var STORAGE = 'cal_doctor_colors_v1';
    var STORAGE_LEGACY = 'gcal_settings_v2';
    var FILTER_STORAGE = 'cal_doctor_visible_v1';
    var SERVER_SETTING_KEY = 'cal_doctor_colors_v1';
    var serverSaveTimer = null;
    /* Google Calendar–like palette */
    var PALETTE = [
        '#7986cb', '#33b679', '#8e24aa', '#e67c73', '#f6bf26', '#f4511e',
        '#039be5', '#3f51b5', '#0b8043', '#d50000', '#f09300', '#009688',
        '#9e69af', '#5c6bc0', '#7cb342', '#c2185b'
    ];
    var colors = {};
    var filterByClinic = {};
    var lastKeys = [];
    var cachedAppts = [];
    var cachedClinicId = null;
    var filterStripCache = {};

    function calTr(key) {
        return typeof t === 'function' ? t(key) : key;
    }

    function calTrRepl(key, pairs) {
        var s = calTr(key);
        if (!pairs) return s;
        for (var k in pairs) {
            if (Object.prototype.hasOwnProperty.call(pairs, k)) {
                s = s.split('{' + k + '}').join(String(pairs[k]));
            }
        }
        return s;
    }

    function clinicFilterId() {
        if (cachedClinicId != null && cachedClinicId !== '') return String(cachedClinicId);
        if (typeof currentClinicId !== 'undefined' && currentClinicId != null && currentClinicId !== '') {
            return String(currentClinicId);
        }
        return '_all';
    }

    function loadFilter() {
        try {
            var raw = localStorage.getItem(FILTER_STORAGE);
            filterByClinic = raw ? JSON.parse(raw) : {};
        } catch (e) { filterByClinic = {}; }
        if (!filterByClinic || typeof filterByClinic !== 'object') filterByClinic = {};
    }

    function getFilterMap() {
        loadFilter();
        var cid = clinicFilterId();
        if (!filterByClinic[cid]) filterByClinic[cid] = {};
        migrateFilterMapForClinic(cid);
        return filterByClinic[cid];
    }

    function saveFilter() {
        try { localStorage.setItem(FILTER_STORAGE, JSON.stringify(filterByClinic)); } catch (e) {}
    }

    function isDoctorVisible(key) {
        var map = getFilterMap();
        key = normalizeStoredDoctorKey(key);
        return map[key] !== false;
    }

    function refreshQueueTodayAfterDoctorFilter() {
        if (typeof loadToday === 'function') loadToday();
        if (typeof loadQueue === 'function') loadQueue();
        if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
    }

    function setDoctorVisible(key, visible) {
        var map = getFilterMap();
        key = normalizeStoredDoctorKey(key);
        if (visible) delete map[key];
        else map[key] = false;
        saveFilter();
        syncLegendCheckboxes();
        refreshQueueTodayAfterDoctorFilter();
        if (typeof renderCal === 'function') renderCal();
    }

    function isApptVisible(a) {
        if (!a) return true;
        return isDoctorVisible(resolveDoctorKeyForAppt(a));
    }

    function filterAppts(list) {
        if (!list || !list.length) return list || [];
        return list.filter(isApptVisible);
    }

    function showAllDoctors() {
        filterByClinic[clinicFilterId()] = {};
        saveFilter();
        syncLegendCheckboxes();
        refreshQueueTodayAfterDoctorFilter();
        if (typeof renderCal === 'function') renderCal();
        if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
    }

    function hideAllDoctors() {
        var map = {};
        var seen = {};
        if (typeof document !== 'undefined') {
            document.querySelectorAll('.cal-legend-check').forEach(function (cb) {
                var k = cb.dataset.key;
                try { k = decodeURIComponent(k); } catch (e) {}
                if (k) { map[k] = false; seen[k] = true; }
            });
        }
        if (!Object.keys(seen).length) {
            lastKeys.forEach(function (item) { map[item.key] = false; });
        }
        filterByClinic[clinicFilterId()] = map;
        saveFilter();
        syncLegendCheckboxes();
        refreshQueueTodayAfterDoctorFilter();
        if (typeof renderCal === 'function') renderCal();
    }

    function syncLegendCheckboxes() {
        if (typeof document === 'undefined') return;
        document.querySelectorAll('.cal-legend-check').forEach(function (cb) {
            var k = cb.dataset.key;
            try { k = decodeURIComponent(k); } catch (e) {}
            cb.checked = isDoctorVisible(k);
            var row = cb.closest('.cal-legend-filter-item');
            if (row) row.classList.toggle('cal-legend-off', !cb.checked);
        });
    }

    function loadFromStorage() {
        colors = {};
        try {
            var raw = localStorage.getItem(STORAGE);
            if (raw) colors = JSON.parse(raw) || {};
        } catch (e) { colors = {}; }
        if (!colors || typeof colors !== 'object') colors = {};
        var hasPrimary = Object.keys(colors).length > 0;
        if (!hasPrimary) {
            try {
                var leg = localStorage.getItem(STORAGE_LEGACY);
                if (leg) {
                    var s = JSON.parse(leg);
                    if (s && s.doctorColors) {
                        Object.keys(s.doctorColors).forEach(function (k) {
                            if (!colors[k]) colors[k] = s.doctorColors[k];
                        });
                    }
                }
            } catch (e2) {}
        }
    }

    function syncLegacyGcalDoctorColors() {
        try {
            var legRaw = localStorage.getItem(STORAGE_LEGACY);
            var s = legRaw ? JSON.parse(legRaw) : {};
            if (!s || typeof s !== 'object') s = {};
            s.doctorColors = Object.assign({}, colors);
            localStorage.setItem(STORAGE_LEGACY, JSON.stringify(s));
        } catch (e) {}
    }

    function canUseServerSync() {
        return typeof SB !== 'undefined' && SB && typeof SB.from === 'function' &&
            typeof persistProgramSettingRow === 'function';
    }

    function parseServerColorsPayload(raw) {
        if (raw == null || raw === '') return null;
        try {
            var parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
            if (parsed.colors && typeof parsed.colors === 'object') return parsed.colors;
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function scheduleServerSave() {
        if (!canUseServerSync()) return;
        if (serverSaveTimer) clearTimeout(serverSaveTimer);
        serverSaveTimer = setTimeout(function () {
            serverSaveTimer = null;
            saveColorsToServer();
        }, 700);
    }

    function saveColorsToServer() {
        if (!canUseServerSync()) return;
        var payload = JSON.stringify(Object.assign({}, colors));
        persistProgramSettingRow({
            setting_key: SERVER_SETTING_KEY,
            setting_value: payload
        }).then(function (r) {
            if (r && r.error) {
                console.warn('Doctor colours server save:', r.error.message || r.error);
                return;
            }
            if (typeof PROGRAM_SETTINGS !== 'undefined') {
                PROGRAM_SETTINGS[SERVER_SETTING_KEY] = payload;
            }
        }).catch(function () {});
    }

    function hydrateFromProgramSettings() {
        var raw = typeof getProgramSetting === 'function'
            ? getProgramSetting(SERVER_SETTING_KEY, '')
            : '';
        var fromServer = parseServerColorsPayload(raw);
        if (!fromServer || !Object.keys(fromServer).length) return false;

        loadFromStorage();
        var next = Object.assign({}, colors);
        var changed = false;
        Object.keys(fromServer).forEach(function (k) {
            var v = normalizeHex(fromServer[k]);
            if (!v) return;
            if (next[k] !== v) {
                next[k] = v;
                changed = true;
            }
        });
        if (!changed) return false;

        colors = next;
        consolidateStoredColors();
        try { localStorage.setItem(STORAGE, JSON.stringify(colors)); } catch (e) {}
        syncLegacyGcalDoctorColors();
        return true;
    }

    function refreshColorViews() {
        renderLegend(cachedAppts, cachedClinicId);
        var cid;
        for (cid in filterStripCache) {
            if (!Object.prototype.hasOwnProperty.call(filterStripCache, cid)) continue;
            var bar = typeof g === 'function' ? g(cid) : null;
            if (bar && !bar.hasAttribute('hidden')) {
                renderDoctorFilterStrip(cid, filterStripCache[cid]);
            }
        }
        refreshOpenColorPanels();
        var settingsOpen = false;
        if (typeof document !== 'undefined') {
            var gcalSp = document.getElementById('gcalSettingsPanel');
            var plusSp = typeof g === 'function' ? g('plusApptSettingsPanel') : null;
            var modal = document.getElementById('calDoctorColorsModal');
            settingsOpen = !!(
                (gcalSp && gcalSp.classList.contains('open')) ||
                (plusSp && plusSp.classList.contains('open')) ||
                (modal && modal.classList.contains('open'))
            );
        }
        if (settingsOpen) {
            repaintVisibleAppointmentColors();
        } else if (typeof renderCal === 'function') {
            renderCal();
        }
        if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
        if (typeof renderApptDoctorColorPreview === 'function') renderApptDoctorColorPreview();
    }

    function hydrateFromServer(opts) {
        opts = opts || {};
        var changed = hydrateFromProgramSettings();
        if (changed && opts.refresh !== false) refreshColorViews();
        return changed;
    }

    /** Push browser-cached colours to server when DB row is still empty (upgrade path). */
    function migrateLocalColorsToServerIfNeeded() {
        if (!canUseServerSync()) return;
        var raw = typeof getProgramSetting === 'function'
            ? getProgramSetting(SERVER_SETTING_KEY, '')
            : '';
        if (parseServerColorsPayload(raw)) return;
        loadFromStorage();
        if (!Object.keys(colors).length) return;
        saveColorsToServer();
    }

    function persistColors() {
        try { localStorage.setItem(STORAGE, JSON.stringify(colors)); } catch (e) {}
        syncLegacyGcalDoctorColors();
        scheduleServerSave();
    }

    function save() {
        persistColors();
    }

    function findClinicalDoctorByAnyKey(key) {
        var k = String(key || '').trim();
        if (!k || k === '__unassigned__') return null;
        var kl = k.toLowerCase();
        var docs = getClinicalDoctorsForClinic(null);
        var i;
        var d;
        var canon;
        var dn;
        var en;
        var cn;
        var id;
        var dc;
        for (i = 0; i < docs.length; i++) {
            d = docs[i];
            canon = doctorKeyFromDoc(d);
            dn = String(typeof doctorDisplayName === 'function'
                ? doctorDisplayName(d) : '').trim();
            en = String(d.english_name || '').trim();
            cn = String(d.chinese_name || '').trim();
            id = String(d.id || '').trim();
            dc = String(d.doctor_code || '').trim();
            if (k === canon || k === id || k === dc || k === dn || k === en || k === cn) return d;
            if (kl === String(canon).toLowerCase() || kl === dn.toLowerCase() ||
                kl === en.toLowerCase() || kl === cn.toLowerCase()) {
                return d;
            }
        }
        return null;
    }

    function aliasKeysForDoctorRecord(d, extraKey) {
        var out = [];
        function add(k) {
            k = String(k || '').trim();
            if (k && out.indexOf(k) < 0) out.push(k);
        }
        if (extraKey) add(extraKey);
        if (!d) return out;
        add(doctorKeyFromDoc(d));
        add(d.id);
        add(d.doctor_code);
        add(typeof doctorDisplayName === 'function' ? doctorDisplayName(d) : '');
        add(d.english_name);
        add(d.chinese_name);
        return out;
    }

    /** Collapse alias keys to one canonical doctor_code entry per clinical doctor. */
    function consolidateStoredColors() {
        var docs = getClinicalDoctorsForClinic(null);
        var next = Object.assign({}, colors);
        var changed = false;
        docs.forEach(function (d) {
            var aliases = aliasKeysForDoctorRecord(d);
            var picked = null;
            var i;
            for (i = 0; i < aliases.length; i++) {
                if (colors[aliases[i]]) {
                    picked = normalizeHex(colors[aliases[i]]);
                    break;
                }
            }
            if (!picked) return;
            var canon = doctorKeyFromDoc(d);
            if (canon && next[canon] !== picked) {
                next[canon] = picked;
                changed = true;
            }
            aliases.forEach(function (a) {
                if (a && a !== canon && Object.prototype.hasOwnProperty.call(next, a)) {
                    delete next[a];
                    changed = true;
                }
            });
        });
        if (changed) {
            colors = next;
            persistColors();
        }
        return changed;
    }

    function lookupStoredColor(key) {
        var k = String(key || '').trim();
        if (!k || k === '__unassigned__') return null;
        var matched = findClinicalDoctorByAnyKey(k);
        var canon = matched ? doctorKeyFromDoc(matched) : normalizeStoredDoctorKey(k);
        if (canon && colors[canon]) return normalizeHex(colors[canon]);
        if (colors[k]) return normalizeHex(colors[k]);
        return null;
    }

    function load() {
        loadFromStorage();
        consolidateStoredColors();
    }

    function exportColorsMap() {
        load();
        return Object.assign({}, colors);
    }

    function onDoctorsLoaded() {
        load();
        renderLegend(cachedAppts, cachedClinicId);
        if (typeof renderCal === 'function') renderCal();
        if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
    }

    function normalizeHex(hex) {
        var h = String(hex || '').trim();
        if (!h) return '';
        if (h.charAt(0) !== '#') h = '#' + h;
        return h;
    }

    function hexToRgb(hex) {
        hex = String(normalizeHex(hex) || '').replace('#', '');
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        if (hex.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(hex)) {
            return '121,130,156';
        }
        return parseInt(hex.slice(0, 2), 16) + ',' +
            parseInt(hex.slice(2, 4), 16) + ',' +
            parseInt(hex.slice(4, 6), 16);
    }

    function colorHash(str) {
        var h = 0;
        var s = String(str || '');
        for (var i = 0; i < s.length; i++) {
            h = (h * 31 + s.charCodeAt(i)) & 0xffff;
        }
        return PALETTE[h % PALETTE.length];
    }

    function doctorKeyFromDoc(doc) {
        if (!doc) return '';
        var code = String(doc.doctor_code || '').trim();
        if (code) return code;
        var id = String(doc.id || '').trim();
        if (id) return id;
        return String(typeof doctorDisplayName === 'function'
            ? doctorDisplayName(doc) : (doc.english_name || doc.chinese_name || '')).trim();
    }

    function activeClinicIdForKeys(clinicId) {
        if (clinicId != null && clinicId !== '') return clinicId;
        if (cachedClinicId != null && cachedClinicId !== '') return cachedClinicId;
        if (typeof currentClinicId !== 'undefined' && currentClinicId != null && currentClinicId !== '') {
            return currentClinicId;
        }
        return null;
    }

    function getClinicalDoctorsForClinic(clinicId) {
        var list = typeof doctorsForClinic === 'function'
            ? doctorsForClinic(activeClinicIdForKeys(clinicId))
            : (typeof APP_DOCTORS !== 'undefined' ? APP_DOCTORS : []);
        var out = [];
        var seen = {};
        (list || []).forEach(function (d) {
            if (!d) return;
            if (typeof isClinicalDoctorRecord === 'function' && !isClinicalDoctorRecord(d)) return;
            if (typeof isLoginPlaceholderDoctorCode === 'function' &&
                isLoginPlaceholderDoctorCode(d.doctor_code)) {
                return;
            }
            var k = doctorKeyFromDoc(d);
            if (!k || seen[k]) return;
            seen[k] = true;
            out.push(d);
        });
        return out;
    }

  /** Match appointment row to one clinical doctor record (code / EN / 中文 / remarks tag). */
    function findClinicalDoctorForAppt(a, clinicId) {
        if (!a) return null;
        var docs = getClinicalDoctorsForClinic(clinicId);
        if (!docs.length) return null;

        var code = String(a.doctor_code || '').trim();
        var tag = parseDoctorTagFromRemarks(a.remarks);
        var name = String(a.doctor_name || '').trim();
        var nameLc = name.toLowerCase();
        var i;
        var d;
        var dc;
        var id;
        var dn;
        var en;
        var cn;

        function matchByCode(probe) {
            if (!probe) return null;
            for (i = 0; i < docs.length; i++) {
                d = docs[i];
                dc = String(d.doctor_code || '').trim();
                id = String(d.id || '').trim();
                if (probe === dc || probe === id) return d;
            }
            return null;
        }

        var hit = matchByCode(code) || matchByCode(tag);
        if (hit) return hit;

        if (name) {
            for (i = 0; i < docs.length; i++) {
                d = docs[i];
                dn = String(typeof doctorDisplayName === 'function'
                    ? doctorDisplayName(d) : '').trim().toLowerCase();
                en = String(d.english_name || '').trim().toLowerCase();
                cn = String(d.chinese_name || '').trim().toLowerCase();
                if (nameLc === dn || nameLc === en || nameLc === cn) return d;
            }
        }
        return null;
    }

    function labelForDoctorRecord(d, fallback) {
        if (!d) return fallback || '';
        return typeof doctorDisplayName === 'function'
            ? doctorDisplayName(d)
            : (d.english_name || d.chinese_name || fallback || doctorKeyFromDoc(d));
    }

    /** Map legacy legend keys (stored name strings) to canonical doctor_code. */
    function normalizeStoredDoctorKey(key) {
        var k = String(key || '').trim();
        if (!k || k === '__unassigned__') return k;
        if (isKnownDoctorCodeKey(k)) return k;
        var kl = k.toLowerCase();
        var docs = getClinicalDoctorsForClinic(null);
        for (var i = 0; i < docs.length; i++) {
            var d = docs[i];
            var canon = doctorKeyFromDoc(d);
            var dn = String(typeof doctorDisplayName === 'function'
                ? doctorDisplayName(d) : '').trim().toLowerCase();
            var en = String(d.english_name || '').trim().toLowerCase();
            var cn = String(d.chinese_name || '').trim().toLowerCase();
            if (kl === String(canon).toLowerCase() || kl === dn || kl === en || kl === cn) {
                return canon;
            }
        }
        return k;
    }

    function migrateFilterMapForClinic(cid) {
        var map = filterByClinic[cid];
        if (!map || typeof map !== 'object') return;
        var next = {};
        Object.keys(map).forEach(function (rawKey) {
            var canon = normalizeStoredDoctorKey(rawKey);
            if (map[rawKey] === false) next[canon] = false;
        });
        filterByClinic[cid] = next;
    }

    /** Hidden tag in remarks when DB has no doctor columns yet: |@dr:CODE| */
    function parseDoctorTagFromRemarks(remarks) {
        var s = String(remarks || '');
        var m = s.match(/\|@dr:([^|]+)\|/i);
        if (m) return String(m[1]).trim();
        m = s.match(/@dr:([^|]+)/i);
        return m ? String(m[1]).trim() : '';
    }

    /** All keys that may identify the same doctor on an appointment row. */
    function possibleKeysForAppt(a) {
        if (!a) return ['__unassigned__'];
        var out = [];
        function add(k) {
            k = String(k || '').trim();
            if (k && out.indexOf(k) < 0) out.push(k);
        }
        var code = String(a.doctor_code || '').trim();
        var name = String(a.doctor_name || '').trim();
        add(code);
        add(name);
        add(parseDoctorTagFromRemarks(a.remarks));

        var docs = typeof APP_DOCTORS !== 'undefined' ? APP_DOCTORS : [];
        docs.forEach(function (d) {
            var k = doctorKeyFromDoc(d);
            var dn = typeof doctorDisplayName === 'function'
                ? doctorDisplayName(d)
                : (d.english_name || d.chinese_name || '');
            var id = String(d.id || '').trim();
            var dc = String(d.doctor_code || '').trim();
            if (code && (id === code || dc === code)) add(k);
            if (name && (dn === name || d.english_name === name || d.chinese_name === name)) add(k);
        });

        if (!out.length) add('__unassigned__');
        return out;
    }

    function isKnownDoctorCodeKey(key) {
        var k = String(key || '').trim();
        if (!k || k === '__unassigned__') return false;
        var docs = typeof APP_DOCTORS !== 'undefined' ? APP_DOCTORS : [];
        for (var i = 0; i < docs.length; i++) {
            var dc = String(docs[i].doctor_code || '').trim();
            if (dc && dc === k) return true;
        }
        return false;
    }

    function preferredDoctorKey(keys) {
        for (var i = 0; i < keys.length; i++) {
            if (isKnownDoctorCodeKey(keys[i])) return keys[i];
        }
        for (var j = 0; j < keys.length; j++) {
            if (keys[j] !== '__unassigned__') return keys[j];
        }
        return '__unassigned__';
    }

    function getSavedColorForKeys(keys) {
        load();
        for (var i = 0; i < keys.length; i++) {
            var hit = lookupStoredColor(keys[i]);
            if (hit) return hit;
        }
        return null;
    }

    /** Key used for saved colours — one canonical key per clinical doctor. */
    function resolveDoctorKeyForAppt(a, clinicId) {
        var matched = findClinicalDoctorForAppt(a, activeClinicIdForKeys(clinicId));
        if (matched) return doctorKeyFromDoc(matched);
        var keys = possibleKeysForAppt(a);
        return preferredDoctorKey(keys);
    }

    function doctorKeyFromAppt(a) {
        return resolveDoctorKeyForAppt(a);
    }

    function labelForKey(key, fallback) {
        if (key === '__unassigned__') return calTr('cal.doctor.noDoctor');
        return fallback || key;
    }

    /** Omit redundant "All" legend row (checkbox + colour duplicates bulk All control). */
    function isRedundantCalLegendKey(key, label) {
        var kl = String(key || '').trim().toLowerCase();
        var ll = String(label || '').trim().toLowerCase();
        if (typeof isLoginPlaceholderDoctorCode === 'function' && isLoginPlaceholderDoctorCode(key)) {
            return true;
        }
        if (kl === 'all' || kl === '_all' || kl === '__all__') return true;
        if (/^all[_-]/.test(kl)) return true;
        if (ll === 'all') return true;
        try {
            var allLbl = String(calTr('appt.calAll') || '').trim().toLowerCase();
            if (allLbl && ll === allLbl) return true;
        } catch (eAll) {}
        return false;
    }

    function getPreviewColor(key) {
        var canon = normalizeStoredDoctorKey(key);
        if (canon === '__unassigned__' || key === '__unassigned__') return '#94a3b8';
        return colorHash(canon || key);
    }

    function getSavedColor(key) {
        load();
        return lookupStoredColor(key);
    }

    function getColor(key) {
        return getSavedColor(key) || getPreviewColor(key);
    }

    function setColor(key, hex) {
        loadFromStorage();
        consolidateStoredColors();
        if (!key || !hex) return;
        hex = normalizeHex(hex);
        if (!hex) return;
        var matched = findClinicalDoctorByAnyKey(key);
        var canon = matched ? doctorKeyFromDoc(matched) : normalizeStoredDoctorKey(key);
        if (!canon || canon === '__unassigned__') return;
        colors[canon] = hex;
        if (matched) {
            aliasKeysForDoctorRecord(matched).forEach(function (a) {
                if (a && a !== canon && Object.prototype.hasOwnProperty.call(colors, a)) {
                    delete colors[a];
                }
            });
        }
        persistColors();
    }

    function getStyle(key) {
        var color = getColor(key);
        var rgb = hexToRgb(color);
        return {
            color: color,
            borderColor: color,
            background: 'rgba(' + rgb + ',0.24)',
            dot: color
        };
    }

    function getStyleForAppt(a) {
        var keys = possibleKeysForAppt(a);
        var canon = resolveDoctorKeyForAppt(a);
        var saved = getSavedColorForKeys(keys);
        if (!saved && canon) saved = getSavedColor(canon);
        var key = canon || keys[0] || '__unassigned__';
        var color = saved || getPreviewColor(key);
        color = normalizeHex(color);
        var rgb = hexToRgb(color);
        return {
            color: color,
            borderColor: color,
            background: 'rgba(' + rgb + ',0.35)',
            dot: color
        };
    }

    /** Apply doctor colours to a DOM element (weekly cards, etc.). */
    function paintElement(el, a) {
        if (!el || !a) return;
        var sty = getStyleForAppt(a);
        el.style.setProperty('border-left', '4px solid ' + sty.borderColor, 'important');
        el.style.setProperty('background', sty.background, 'important');
        el.style.setProperty('background-color', sty.background, 'important');
        el.dataset.drColor = sty.color;
        return sty;
    }

    function collectKeys(appts, clinicId) {
        load();
        var cid = activeClinicIdForKeys(clinicId);
        var map = {};
        var docs = getClinicalDoctorsForClinic(cid);
        docs.forEach(function (d) {
            var k = doctorKeyFromDoc(d);
            if (k && !map[k]) map[k] = labelForDoctorRecord(d, k);
        });
        (appts || []).forEach(function (a) {
            var matched = findClinicalDoctorForAppt(a, cid);
            if (matched) {
                var k = doctorKeyFromDoc(matched);
                if (k && !map[k]) map[k] = labelForDoctorRecord(matched, k);
                return;
            }
            var k = resolveDoctorKeyForAppt(a, cid);
            if (k && k !== '__unassigned__' && !map[k]) {
                map[k] = labelForKey(k, a.doctor_name || k);
            }
        });
        var keys = Object.keys(map).sort();
        return keys.map(function (k) {
            return { key: k, label: labelForKey(k, map[k]) };
        }).filter(function (item) {
            return !isRedundantCalLegendKey(item.key, item.label);
        });
    }

    function listHasMultipleDoctors(appts, clinicId) {
        var seen = {};
        var count = 0;
        (appts || []).forEach(function (a) {
            if (!a) return;
            var k = resolveDoctorKeyForAppt(a, clinicId);
            if (!k || k === '__unassigned__') return;
            if (seen[k]) return;
            seen[k] = true;
            count++;
        });
        return count > 1;
    }

    function rowDoctorLabelForAppt(a, clinicId) {
        if (!a) return '';
        var matched = findClinicalDoctorForAppt(a, clinicId);
        if (matched) return labelForDoctorRecord(matched, '');
        var code = String(a.doctor_code || '').trim();
        var name = String(a.doctor_name || '').trim();
        if (name) return name;
        if (code) return code;
        var k = resolveDoctorKeyForAppt(a, clinicId);
        return (k && k !== '__unassigned__') ? k : '';
    }

    /** Display-only colour dot for Today / Queue rows (no click handlers). */
    function rowDoctorDotHtml(a, opts) {
        opts = opts || {};
        if (!a) return '';
        if (opts.multiDoctorOnly && !opts.hasMultipleDoctors) return '';
        var cid = opts.clinicId != null
            ? opts.clinicId
            : (typeof currentClinicId !== 'undefined' ? currentClinicId : null);
        var key = resolveDoctorKeyForAppt(a, cid);
        if (!key || key === '__unassigned__') return '';
        var sty = getStyleForAppt(a);
        var label = rowDoctorLabelForAppt(a, cid) || key;
        return '<span class="appt-row-dr-dot" role="img" ' +
            'style="background:' + esc(sty.dot) + ';" ' +
            'title="' + esc(label) + '" ' +
            'aria-label="' + esc(calTrRepl('cal.doctor.rowDotAria', { NAME: label })) + '"></span>';
    }

    function renderDoctorFilterStrip(containerId, appts) {
        var wrap = typeof g === 'function' ? g(containerId) : null;
        if (!wrap) return;
        filterStripCache[containerId] = appts || [];
        var cid = typeof currentClinicId !== 'undefined' ? currentClinicId : null;
        var keysList = collectKeys(appts || [], cid);
        if (!keysList.length) {
            filterStripCache[containerId] = [];
            wrap.innerHTML = '';
            wrap.style.display = 'none';
            wrap.setAttribute('hidden', 'hidden');
            wrap.setAttribute('aria-hidden', 'true');
            return;
        }
        wrap.removeAttribute('hidden');
        wrap.setAttribute('aria-hidden', 'false');
        wrap.style.display = '';
        wrap.className = 'appt-dr-filter-host appt-dr-filter-bar';
        wrap.innerHTML =
            '<span class="appt-dr-filter-label">' + esc(calTr('appt.calShowDoctors')) + '</span>' +
            '<div class="cal-doctor-filter-actions">' +
            '<button type="button" class="cal-filter-link" onclick="CalDoctorColors.showAllDoctors()">' +
                esc(calTr('appt.calAll')) + '</button>' +
            '<span class="cal-filter-sep" aria-hidden="true">·</span>' +
            '<button type="button" class="cal-filter-link" onclick="CalDoctorColors.hideAllDoctors()">' +
                esc(calTr('appt.calNone')) + '</button>' +
            '</div>' +
            '<div class="cal-doctor-legend appt-dr-filter-chips"></div>';
        var chips = wrap.querySelector('.appt-dr-filter-chips');
        keysList.forEach(function (item) {
            var sty = getStyle(item.key);
            var row = document.createElement('label');
            row.className = 'cal-legend-filter-item' + (isDoctorVisible(item.key) ? '' : ' cal-legend-off');
            row.title = calTrRepl('cal.doctor.filterListTitle', { NAME: item.label });

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'cal-legend-check';
            cb.checked = isDoctorVisible(item.key);
            cb.dataset.key = encodeURIComponent(item.key);
            cb.setAttribute('aria-label', calTrRepl('cal.doctor.filterShowAria', { NAME: item.label }));
            cb.addEventListener('change', function () {
                setDoctorVisible(item.key, cb.checked);
            });

            var colorBtn = document.createElement('button');
            colorBtn.type = 'button';
            colorBtn.className = 'cal-legend-color-btn';
            colorBtn.title = calTrRepl('cal.doctor.changeColourTitle', { NAME: item.label });
            colorBtn.innerHTML = '<span class="cal-legend-dot" style="background:' + sty.dot + ';"></span>';
            colorBtn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                openSettings(item.key);
            });

            var lbl = document.createElement('span');
            lbl.className = 'cal-legend-label';
            lbl.textContent = item.label;

            row.appendChild(cb);
            row.appendChild(colorBtn);
            row.appendChild(lbl);
            chips.appendChild(row);
        });
    }

    function renderLegend(appts, clinicId) {
        if (appts) cachedAppts = appts;
        if (clinicId != null) cachedClinicId = clinicId;
        var box = typeof g === 'function' ? g('calDoctorLegend') : null;
        if (!box) return;
        lastKeys = collectKeys(cachedAppts, cachedClinicId);
        if (!lastKeys.length) {
            box.innerHTML =
                '<span class="cal-legend-empty">' + esc(calTr('cal.doctor.legendEmpty')) + '</span>';
            return;
        }
        box.innerHTML = '';
        lastKeys.forEach(function (item) {
            var sty = getStyle(item.key);
            var row = document.createElement('label');
            row.className = 'cal-legend-filter-item' + (isDoctorVisible(item.key) ? '' : ' cal-legend-off');
            row.title = calTrRepl('cal.doctor.filterCalendarTitle', { NAME: item.label });

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'cal-legend-check';
            cb.checked = isDoctorVisible(item.key);
            cb.dataset.key = encodeURIComponent(item.key);
            cb.setAttribute('aria-label', calTrRepl('cal.doctor.filterShowAria', { NAME: item.label }));
            cb.addEventListener('change', function () {
                setDoctorVisible(item.key, cb.checked);
            });

            var colorBtn = document.createElement('button');
            colorBtn.type = 'button';
            colorBtn.className = 'cal-legend-color-btn';
            colorBtn.title = calTrRepl('cal.doctor.changeColourTitle', { NAME: item.label });
            colorBtn.innerHTML = '<span class="cal-legend-dot" style="background:' + sty.dot + ';"></span>';
            colorBtn.addEventListener('click', function (ev) {
                ev.preventDefault();
                ev.stopPropagation();
                openSettings(item.key);
            });

            var lbl = document.createElement('span');
            lbl.className = 'cal-legend-label';
            lbl.textContent = item.label;

            row.appendChild(cb);
            row.appendChild(colorBtn);
            row.appendChild(lbl);
            box.appendChild(row);
        });
    }

    function presetSwatchesHtml(key, current) {
        var html = '<div class="gcal-preset-swatches">';
        PALETTE.forEach(function (c) {
            var sel = c.toLowerCase() === String(current || '').toLowerCase() ? ' gcal-swatch-on' : '';
            html += '<button type="button" class="gcal-swatch' + sel + '" data-key="' + encodeURIComponent(key) +
                '" data-color="' + c + '" style="background:' + c + ';" title="' + c + '"></button>';
        });
        return html + '</div>';
    }

    function decodeDataKey(raw) {
        if (raw == null) return '';
        try { return decodeURIComponent(String(raw)); } catch (e) { return String(raw); }
    }

    function findColorInput(container, key) {
        if (!container || key == null) return null;
        var inputs = container.querySelectorAll('.gcal-dr-color-inp');
        for (var i = 0; i < inputs.length; i++) {
            if (decodeDataKey(inputs[i].dataset.key) === key) return inputs[i];
        }
        return null;
    }

    function isDeferredCalendarColorPanel(container) {
        if (!container) return false;
        if (container.id === 'gcalDrColorsBox' ||
            container.id === 'plusApptDrColorsBox' ||
            container.id === 'calDoctorColorsModalBody') return true;
        return container.getAttribute && container.getAttribute('data-appt-field') === 'drColorsBox';
    }

    function repaintVisibleAppointmentColors() {
        renderLegend(cachedAppts, cachedClinicId);
        if (typeof GCAL !== 'undefined' && typeof GCAL.repaintCards === 'function') {
            GCAL.repaintCards();
        }
        if (typeof repaintCalMonthPills === 'function') repaintCalMonthPills();
        if (typeof renderApptDoctorColorPreview === 'function') renderApptDoctorColorPreview();
        if (typeof apptRepaintListRowDoctorDots === 'function') apptRepaintListRowDoctorDots();
    }

    function applyColorPick(container, key, col) {
        if (container && container.dataset.calColorsHydrating === '1') return;
        key = decodeDataKey(key);
        if (!key || !col) return;
        setColor(key, col);
        var inp = findColorInput(container, key);
        if (inp) inp.value = col;
        var row = inp ? inp.closest('.gcal-dr-row') : null;
        if (row) {
            row.querySelectorAll('.gcal-swatch').forEach(function (b) {
                var on = (b.dataset.color || '').toLowerCase() === String(col).toLowerCase();
                b.classList.toggle('gcal-swatch-on', on);
            });
        }
        if (isDeferredCalendarColorPanel(container)) {
            repaintVisibleAppointmentColors();
            if ((container.id === 'plusApptDrColorsBox' ||
                    (container.getAttribute && container.getAttribute('data-appt-field') === 'drColorsBox')) &&
                typeof refreshApptPlannerData === 'function') {
                refreshApptPlannerData();
            }
            if (container.getAttribute && container.getAttribute('data-appt-field') === 'drColorsBox' &&
                typeof loadQueue === 'function') {
                loadQueue();
            }
            return;
        }
        renderLegend(cachedAppts, cachedClinicId);
        if (typeof renderApptDoctorColorPreview === 'function') renderApptDoctorColorPreview();
        if (typeof renderCal === 'function') renderCal();
    }

    /** Event delegation — safe when panel HTML is rebuilt. */
    function wireColorPanel(container) {
        if (!container || container._calColorPanelWired) return;
        container._calColorPanelWired = true;
        container.dataset.calColorsHydrating = '1';
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                if (container) delete container.dataset.calColorsHydrating;
            });
        });

        container.addEventListener('click', function (ev) {
            var btn = ev.target.closest('.gcal-swatch');
            if (!btn || !container.contains(btn)) return;
            ev.preventDefault();
            ev.stopPropagation();
            applyColorPick(container, decodeDataKey(btn.dataset.key), btn.dataset.color);
        });

        container.addEventListener('input', function (ev) {
            var inp = ev.target;
            if (!inp.classList || !inp.classList.contains('gcal-dr-color-inp')) return;
            applyColorPick(container, decodeDataKey(inp.dataset.key), inp.value);
        });

        container.addEventListener('change', function (ev) {
            var inp = ev.target;
            if (!inp.classList || !inp.classList.contains('gcal-dr-color-inp')) return;
            applyColorPick(container, decodeDataKey(inp.dataset.key), inp.value);
        });
    }

    function buildColorRowsHtml() {
        load();
        var keys = collectKeys(cachedAppts, cachedClinicId);
        if (!keys.length) {
            return '<p class="cal-colors-empty">' + esc(calTr('cal.doctor.colorsEmpty')) + '</p>';
        }
        var html = '';
        keys.forEach(function (item) {
            var col = getColor(item.key);
            html +=
                '<div class="gcal-dr-row">' +
                '<input type="color" class="gcal-dr-color-inp" data-key="' + encodeURIComponent(item.key) + '" value="' + col + '">' +
                '<span class="gcal-dr-row-label">' + esc(item.label) + '</span>' +
                presetSwatchesHtml(item.key, col) +
                '</div>';
        });
        return html;
    }

    function resetControlHtml() {
        return '<div class="cal-dr-colors-reset-row">' +
            '<button type="button" class="cal-dr-colors-reset-btn" onclick="CalDoctorColors.resetAll()">' +
                esc(calTr('cal.doctor.resetBtn')) +
            '</button>' +
            '<span class="cal-dr-colors-reset-hint">' + esc(calTr('cal.doctor.resetHint')) + '</span>' +
            '</div>';
    }

    function refreshOpenColorPanels() {
        var modal = document.getElementById('calDoctorColorsModal');
        var body = document.getElementById('calDoctorColorsModalBody');
        if (modal && modal.classList.contains('open') && body) {
            body.innerHTML = buildColorRowsHtml();
            body._calColorPanelWired = false;
            wireColorPanel(body);
        }
        if (typeof GCAL !== 'undefined' && typeof GCAL.refreshSettingsPanelIfOpen === 'function') {
            GCAL.refreshSettingsPanelIfOpen();
        }
        if (typeof plusApptFillSettingsPanel === 'function') {
            var psp = typeof g === 'function' ? g('plusApptSettingsPanel') : null;
            if (psp && psp.classList.contains('open')) plusApptFillSettingsPanel();
        }
        if (typeof queueFillSettingsPanel === 'function') {
            var qsp = typeof g === 'function' ? g('queueSettingsPanel') : null;
            if (qsp && qsp.classList.contains('open')) queueFillSettingsPanel();
        }
    }

    function resetAll() {
        if (!confirm(calTr('cal.doctor.resetConfirm'))) return;
        colors = {};
        try { localStorage.setItem(STORAGE, JSON.stringify({})); } catch (e) {}
        syncLegacyGcalDoctorColors();
        if (canUseServerSync()) {
            persistProgramSettingRow({
                setting_key: SERVER_SETTING_KEY,
                setting_value: '{}'
            }).then(function (r) {
                if (r && r.error) {
                    console.warn('Doctor colours server reset:', r.error.message || r.error);
                }
            }).catch(function () {});
            if (typeof PROGRAM_SETTINGS !== 'undefined') {
                PROGRAM_SETTINGS[SERVER_SETTING_KEY] = '{}';
            }
        }
        refreshColorViews();
    }

    function syncColorModalCopy(modal) {
        if (!modal) return;
        var head = modal.querySelector('.cal-colors-modal-head strong');
        if (head) head.textContent = calTr('cal.doctor.modalTitle');
        var hint = modal.querySelector('.cal-colors-hint');
        if (hint) hint.textContent = calTr('cal.doctor.modalHint');
        var resetBtn = modal.querySelector('.cal-colors-reset');
        if (resetBtn) resetBtn.textContent = calTr('cal.doctor.resetBtn');
        var resetHint = modal.querySelector('.cal-colors-reset-hint');
        if (resetHint) resetHint.textContent = calTr('cal.doctor.resetHint');
        var doneBtn = modal.querySelector('.cal-colors-done');
        if (doneBtn) doneBtn.textContent = calTr('cal.doctor.done');
        var closeBtn = modal.querySelector('.cal-colors-close');
        if (closeBtn) closeBtn.setAttribute('aria-label', calTr('common.closeAria'));
    }

    function openColorModal(focusKey) {
        var modal = document.getElementById('calDoctorColorsModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'calDoctorColorsModal';
            modal.className = 'cal-colors-modal';
            modal.innerHTML =
                '<div class="cal-colors-modal-backdrop" onclick="CalDoctorColors.closeColorModal()"></div>' +
                '<div class="cal-colors-modal-card">' +
                '<div class="cal-colors-modal-head">' +
                '<strong>' + esc(calTr('cal.doctor.modalTitle')) + '</strong>' +
                '<button type="button" class="cal-colors-close" ' +
                'data-i18n-aria-label="common.closeAria" aria-label="' + esc(calTr('common.closeAria')) + '" ' +
                'onclick="CalDoctorColors.closeColorModal()">×</button>' +
                '</div>' +
                '<p class="cal-colors-hint">' + esc(calTr('cal.doctor.modalHint')) + '</p>' +
                '<div id="calDoctorColorsModalBody"></div>' +
                '<div class="cal-colors-modal-foot">' +
                '<button type="button" class="cal-colors-reset" onclick="CalDoctorColors.resetAll()">' +
                    esc(calTr('cal.doctor.resetBtn')) + '</button>' +
                '<span class="cal-colors-reset-hint">' + esc(calTr('cal.doctor.resetHint')) + '</span>' +
                '<button type="button" class="cal-colors-done" onclick="CalDoctorColors.closeColorModal()">' +
                    esc(calTr('cal.doctor.done')) + '</button>' +
                '</div></div>';
            document.body.appendChild(modal);
            modal = document.getElementById('calDoctorColorsModal');
        }
        syncColorModalCopy(modal);
        modal.className = 'cal-colors-modal open';
        var body = document.getElementById('calDoctorColorsModalBody');
        if (body) {
            body.innerHTML = buildColorRowsHtml();
            body._calColorPanelWired = false;
            wireColorPanel(body);
            if (focusKey) {
                var inp = findColorInput(body, focusKey);
                if (inp) inp.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
    }

    function closeColorModal() {
        var modal = document.getElementById('calDoctorColorsModal');
        if (modal) modal.classList.remove('open');
    }

    function openSettings(focusKey) {
        openColorModal(focusKey);
    }

    /** Strip remarks to plain text for compact monthly pill display. */
    function _pillRemarksPlain(remarks) {
        if (!remarks) return '';
        var s = String(remarks);
        // Strip [[DR:...]] doctor tags
        s = s.replace(/\[\[DR:[^\]]*\]\]/g, '');
        // Strip staff-author spans
        s = s.replace(/<span[^>]+data-rm-by[^>]*>[\s\S]*?<\/span>/gi, '');
        // Strip remaining HTML tags (turn them into spaces)
        s = s.replace(/<[^>]+>/g, ' ');
        // Decode common HTML entities
        s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        return s.replace(/\s+/g, ' ').trim();
    }

    function monthPillHtml(a) {
        var sty       = getStyleForAppt(a);
        var isWalkIn  = !a.patient_id;
        var cnName    = String(a.patient_chinese_name || '').trim();
        var enName    = String(a.patient_name || '').trim();
        var displayCN = cnName || (isWalkIn ? calTr('appt.cal.cardWalkin') : enName);
        var treatment = String(a.treatment_items || '').trim();
        var timeStr   = fmt12(a.start_time) + (a.end_time ? '\u2013' + fmt12(a.end_time) : '');
        var rmkPlain  = _pillRemarksPlain(a.remarks);

        // Row 1: Chinese name (or walk-in label) + treatment item
        var row1 = '<span class="gmp-row gmp-r1">' +
            (isWalkIn
                ? '<span class="gcal-month-walkin">' + esc(calTr('appt.badge.newWalkin')) + '</span>'
                : '<span class="gmp-cn">' + esc(displayCN) + '</span>') +
            (treatment ? '<span class="gmp-treat">\u00a0\u00b7\u00a0' + esc(treatment) + '</span>' : '') +
        '</span>';

        // Row 2: English name (only when distinct from row-1 name) + time span
        var row2Inner = '';
        if (cnName && enName) {
            row2Inner += '<span class="gmp-en">' + esc(enName) + '</span><span class="gmp-sep"> \u00b7 </span>';
        }
        row2Inner += '<span class="gmp-time">' + esc(timeStr) + '</span>';
        var row2 = '<span class="gmp-row gmp-r2">' + row2Inner + '</span>';

        // Row 3: Remarks plain text (if any, capped at 80 chars)
        var row3 = rmkPlain
            ? '<span class="gmp-row gmp-r3">' + esc(rmkPlain.length > 80 ? rmkPlain.substring(0, 80) + '\u2026' : rmkPlain) + '</span>'
            : '';

        return '<div class="gcal-month-pill" data-id="' + esc(a.id) + '" data-dr-color="' + esc(sty.color) + '" ' +
            'style="border-left:4px solid ' + sty.borderColor + ' !important;background:' + sty.background + ' !important;">' +
            row1 + row2 + row3 +
            '</div>';
    }

    function refreshCalDoctorColorsI18n() {
        renderLegend(cachedAppts, cachedClinicId);
        var cid;
        for (cid in filterStripCache) {
            if (!Object.prototype.hasOwnProperty.call(filterStripCache, cid)) continue;
            var bar = typeof g === 'function' ? g(cid) : null;
            if (bar && !bar.hasAttribute('hidden')) {
                renderDoctorFilterStrip(cid, filterStripCache[cid]);
            }
        }
        var modal = document.getElementById('calDoctorColorsModal');
        if (modal) {
            syncColorModalCopy(modal);
        }
        if (modal && modal.classList.contains('open')) {
            var body = document.getElementById('calDoctorColorsModalBody');
            if (body) {
                body.innerHTML = buildColorRowsHtml();
                body._calColorPanelWired = false;
                wireColorPanel(body);
            }
        }
    }

    document.addEventListener('app-lang-change', function () {
        refreshCalDoctorColorsI18n();
    });

    try { load(); } catch (bootErr) {}
    if (typeof getProgramSetting === 'function' && getProgramSetting(SERVER_SETTING_KEY, '')) {
        try { hydrateFromServer({ refresh: false }); } catch (hydrateErr) {}
    }

    return {
        load: load,
        save: save,
        exportColorsMap: exportColorsMap,
        hydrateFromServer: hydrateFromServer,
        migrateLocalColorsToServerIfNeeded: migrateLocalColorsToServerIfNeeded,
        onDoctorsLoaded: onDoctorsLoaded,
        PALETTE: PALETTE,
        doctorKeyFromAppt: doctorKeyFromAppt,
        doctorKeyFromDoc: doctorKeyFromDoc,
        resolveDoctorKeyForAppt: resolveDoctorKeyForAppt,
        getColor: getColor,
        getSavedColor: getSavedColor,
        getPreviewColor: getPreviewColor,
        setColor: setColor,
        getStyle: getStyle,
        getStyleForAppt: getStyleForAppt,
        paintElement: paintElement,
        parseDoctorTagFromRemarks: parseDoctorTagFromRemarks,
        collectKeys: collectKeys,
        isDoctorVisible: isDoctorVisible,
        setDoctorVisible: setDoctorVisible,
        isApptVisible: isApptVisible,
        filterAppts: filterAppts,
        showAllDoctors: showAllDoctors,
        hideAllDoctors: hideAllDoctors,
        renderDoctorFilterStrip: renderDoctorFilterStrip,
        listHasMultipleDoctors: listHasMultipleDoctors,
        rowDoctorDotHtml: rowDoctorDotHtml,
        rowDoctorLabelForAppt: rowDoctorLabelForAppt,
        renderLegend: renderLegend,
        presetSwatchesHtml: presetSwatchesHtml,
        wireColorPanel: wireColorPanel,
        openSettings: openSettings,
        openColorModal: openColorModal,
        closeColorModal: closeColorModal,
        resetAll: resetAll,
        resetControlHtml: resetControlHtml,
        monthPillHtml: monthPillHtml,
        refreshI18n: refreshCalDoctorColorsI18n,
        repaintVisibleColors: repaintVisibleAppointmentColors
    };
})();
