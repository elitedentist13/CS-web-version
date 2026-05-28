/* Doctor colour keys for appointment weekly / monthly calendars (Google Calendar style). */
var CalDoctorColors = (function () {
    var STORAGE = 'cal_doctor_colors_v1';
    var STORAGE_LEGACY = 'gcal_settings_v2';
    var FILTER_STORAGE = 'cal_doctor_visible_v1';
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
        return filterByClinic[cid];
    }

    function saveFilter() {
        try { localStorage.setItem(FILTER_STORAGE, JSON.stringify(filterByClinic)); } catch (e) {}
    }

    function isDoctorVisible(key) {
        var map = getFilterMap();
        return map[key] !== false;
    }

    function refreshQueueTodayAfterDoctorFilter() {
        if (typeof loadToday === 'function') loadToday();
        if (typeof loadQueue === 'function') loadQueue();
        if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
    }

    function setDoctorVisible(key, visible) {
        var map = getFilterMap();
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

    function load() {
        colors = {};
        try {
            var raw = localStorage.getItem(STORAGE);
            if (raw) colors = JSON.parse(raw) || {};
        } catch (e) { colors = {}; }
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
        if (!colors || typeof colors !== 'object') colors = {};
    }

    function save() {
        try { localStorage.setItem(STORAGE, JSON.stringify(colors)); } catch (e) {}
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
        return String(typeof doctorDisplayName === 'function'
            ? doctorDisplayName(doc) : (doc.english_name || doc.chinese_name || '')).trim();
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
            if (colors[keys[i]]) return normalizeHex(colors[keys[i]]);
        }
        return null;
    }

    /** Key used for saved colours — matches colour panel (doctor code preferred). */
    function resolveDoctorKeyForAppt(a) {
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

    function getColor(key) {
        load();
        if (colors[key]) return colors[key];
        if (key === '__unassigned__') return '#94a3b8';
        return colorHash(key);
    }

    function setColor(key, hex) {
        load();
        if (!key || !hex) return;
        hex = normalizeHex(hex);
        colors[key] = hex;
        var docs = typeof APP_DOCTORS !== 'undefined' ? APP_DOCTORS : [];
        docs.forEach(function (d) {
            var k = doctorKeyFromDoc(d);
            var id = String(d.id || '').trim();
            var dc = String(d.doctor_code || '').trim();
            var dn = typeof doctorDisplayName === 'function'
                ? doctorDisplayName(d)
                : (d.english_name || d.chinese_name || '');
            if (key === k || key === id || key === dc || key === dn) {
                if (k) colors[k] = hex;
                if (dc) colors[dc] = hex;
                if (id) colors[id] = hex;
                if (dn) colors[dn] = hex;
            }
        });
        save();
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
        var saved = getSavedColorForKeys(keys);
        var key = keys[0] || '__unassigned__';
        for (var j = 0; j < keys.length; j++) {
            if (keys[j] !== '__unassigned__') { key = keys[j]; break; }
        }
        var color = saved || (key === '__unassigned__' ? '#94a3b8' : colorHash(key));
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
        var map = {};
        var docs = typeof doctorsForClinic === 'function'
            ? doctorsForClinic(clinicId || (typeof currentClinicId !== 'undefined' ? currentClinicId : null))
            : [];
        docs.forEach(function (d) {
            if (typeof isClinicalDoctorRecord === 'function' && !isClinicalDoctorRecord(d)) {
                return;
            }
            if (typeof isLoginPlaceholderDoctorCode === 'function' &&
                isLoginPlaceholderDoctorCode(d.doctor_code)) {
                return;
            }
            var k = doctorKeyFromDoc(d);
            if (k && !map[k]) {
                map[k] = typeof doctorDisplayName === 'function'
                    ? doctorDisplayName(d)
                    : k;
            }
        });
        (appts || []).forEach(function (a) {
            var k = doctorKeyFromAppt(a);
            if (k && !map[k]) map[k] = a.doctor_name || k;
        });
        var keys = Object.keys(map).sort();
        return keys.map(function (k) {
            return { key: k, label: labelForKey(k, map[k]) };
        }).filter(function (item) {
            return !isRedundantCalLegendKey(item.key, item.label);
        });
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

    function applyColorPick(container, key, col) {
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
        renderLegend(cachedAppts, cachedClinicId);
        if (typeof renderApptDoctorColorPreview === 'function') renderApptDoctorColorPreview();
        if (typeof renderCal === 'function') renderCal();
    }

    /** Event delegation — safe when panel HTML is rebuilt. */
    function wireColorPanel(container) {
        if (!container || container._calColorPanelWired) return;
        container._calColorPanelWired = true;

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

    function syncColorModalCopy(modal) {
        if (!modal) return;
        var head = modal.querySelector('.cal-colors-modal-head strong');
        if (head) head.textContent = calTr('cal.doctor.modalTitle');
        var hint = modal.querySelector('.cal-colors-hint');
        if (hint) hint.textContent = calTr('cal.doctor.modalHint');
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
                '<button type="button" class="cal-colors-done" onclick="CalDoctorColors.closeColorModal()">' +
                    esc(calTr('cal.doctor.done')) + '</button>' +
                '</div>';
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

    function monthPillHtml(a) {
        var sty = getStyleForAppt(a);
        var dr = a.doctor_code || a.doctor_name || parseDoctorTagFromRemarks(a.remarks) || '';
        var walkBadge = !a.patient_id
            ? '<span class="gcal-month-walkin">' + esc(calTr('appt.badge.newWalkin')) + '</span> '
            : '';
        return '<div class="gcal-month-pill" data-id="' + esc(a.id) + '" data-dr-color="' + esc(sty.color) + '" ' +
            'style="border-left:4px solid ' + sty.borderColor + ' !important;background:' + sty.background + ' !important;">' +
            '<span class="gcal-month-pill-time">' + esc(fmt12(a.start_time)) + '</span> ' +
            walkBadge +
            '<span class="gcal-month-pill-title">' + esc(a.patient_name || calTr('appt.cal.cardWalkin')) + '</span>' +
            (dr ? '<span class="gcal-month-pill-dr" style="color:' + sty.color + ';">' + esc(dr) + '</span>' : '') +
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

    return {
        load: load,
        save: save,
        PALETTE: PALETTE,
        doctorKeyFromAppt: doctorKeyFromAppt,
        doctorKeyFromDoc: doctorKeyFromDoc,
        resolveDoctorKeyForAppt: resolveDoctorKeyForAppt,
        getColor: getColor,
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
        renderLegend: renderLegend,
        presetSwatchesHtml: presetSwatchesHtml,
        wireColorPanel: wireColorPanel,
        openSettings: openSettings,
        openColorModal: openColorModal,
        closeColorModal: closeColorModal,
        monthPillHtml: monthPillHtml,
        refreshI18n: refreshCalDoctorColorsI18n
    };
})();
