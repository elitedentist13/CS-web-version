// app-patient-advanced-search.js — Patients directory Advanced Search → Broadcast lists
(function () {
    'use strict';

    var PAGE_SIZE = 100;
    var FETCH_SIZE = 1000;

    function dirPageSize() {
        return (typeof PATIENT_DIR_PAGE_SIZE === 'number' && PATIENT_DIR_PAGE_SIZE > 0)
            ? PATIENT_DIR_PAGE_SIZE
            : PAGE_SIZE;
    }
    var TREAT_DEFS = [
        { key: 'root_planing', labelKey: 'patient.adv.treat.rootPlaning', label: 'Root planing',
            match: [/root\s*planing/i] },
        { key: 'implants', labelKey: 'patient.adv.treat.implants', label: 'Dental implants',
            match: [
                /implant/i,
                /植牙/, /种植/, /種植/, /植體/, /植体/,
                // Brand / system names (with or without "implant" prefix)
                /osstem/i, /hiossen/i, /nobel(?:\s*biocare)?/i,
                /straumann?/i, /\bBLX\b/i, /\bITI\b/i,
                /dentium/i, /mega(?:\s*gen)?/i, /neodent/i, /anthogyr/i,
                /zimmer(?:\s*biomet)?/i, /biohorizons/i, /astra(?:\s*tech)?/i
            ] },
        // Umbrella: all orthodontics (fixed appliances + Invisalign + general ortho).
        // Sub-filters fixed_appliances / invisalign stay independent and narrower.
        { key: 'orthodontics', labelKey: 'patient.adv.treat.ortho', label: 'Orthodontics (all)',
            match: [
                /ortho\s*treatment/i, /orthodontic/i, /ortho\s*consultation/i,
                /ortho-?rpe/i, /\bRPE\b/,
                /fixed\s*appliances?/i, /fixed\s*braces?/i, /fixed\s*ortho/i,
                /metal\s*braces?/i, /ceramic\s*braces?/i,
                /鋼線/, /钢线/, /鋼絲/, /钢丝/, /牙箍/, /箍牙/,
                /invisalign/i, /隱適美/, /隐适美/,
                /vivera/i, /viverra/i,
                /fixed\s*retainer/i, /\bretainers?\b/i,
                /矯齒/, /矫齿/, /正畸/
            ] },
        { key: 'fixed_appliances', labelKey: 'patient.adv.treat.fixedAppliances',
            label: 'Fixed appliances (鋼線)',
            match: [
                /fixed\s*appliances?/i, /fixed\s*braces?/i, /fixed\s*ortho/i,
                /metal\s*braces?/i, /ceramic\s*braces?/i,
                /鋼線/, /钢线/, /鋼絲/, /钢丝/, /牙箍/, /箍牙/
            ] },
        { key: 'invisalign', labelKey: 'patient.adv.treat.invisalign', label: 'Invisalign',
            match: [/invisalign/i, /隱適美/, /隐适美/] },
        { key: 'bleaching', labelKey: 'patient.adv.treat.bleaching', label: 'Bleaching',
            match: [/bleach/i, /美白/, /漂白/] },
        { key: 'root_canal', labelKey: 'patient.adv.treat.rootCanal', label: 'Root canal treatment',
            match: [/root\s*canal/i, /\bRCT\b/i, /根管/] },
        { key: 'crown', labelKey: 'patient.adv.treat.crown', label: 'Crown / ceramic crown',
            match: [/ceramic\s*crown/i, /ceramic\s*cr(?:\/|\b)/i, /metal\s*ceramic\s*crown/i,
                /\bcrown\b/i, /全瓷牙套/, /烤瓷牙套/, /牙套/, /牙冠/] },
        { key: 'wisdom_mos', labelKey: 'patient.adv.treat.wisdomMos',
            label: 'Wisdom teeth removal / minor oral surgery',
            match: [/extraction\s*of\s*wisdom/i, /wisdom\s*tooth\s*(extraction|removal|surg)/i,
                /minor\s*oral\s*surg/i, /\bMOS\b/i, /脫智慧齒/, /智[齒齿]/, /小型口腔手術/, /小型口腔手术/] }
    ];
    var SCALING_MATCH = [/scaling/i, /洗牙/];
    /** Slider steps: 0 = Any, 1 = below 1k, then minimum totals up to ≥200k+. */
    var EXPEND_STEPS = [
        { key: '', mode: '', amount: 0 },
        { key: 'lt1000', mode: 'lt', amount: 1000 },
        { key: 'gte1000', mode: 'gte', amount: 1000 },
        { key: 'gte2000', mode: 'gte', amount: 2000 },
        { key: 'gte5000', mode: 'gte', amount: 5000 },
        { key: 'gte10000', mode: 'gte', amount: 10000 },
        { key: 'gte20000', mode: 'gte', amount: 20000 },
        { key: 'gte50000', mode: 'gte', amount: 50000 },
        { key: 'gte100000', mode: 'gte', amount: 100000 },
        { key: 'gte150000', mode: 'gte', amount: 150000 },
        { key: 'gte200000', mode: 'gte', amount: 200000 }
    ];
    /**
     * Installment slider: 0 = Any, then "more than 2" … "more than 10+".
     * moreThan N means at least one bill with > N non-void payment rows.
     */
    var INSTALL_STEPS = [
        { key: '', moreThan: 0 },
        { key: 'gt2', moreThan: 2 },
        { key: 'gt3', moreThan: 3 },
        { key: 'gt4', moreThan: 4 },
        { key: 'gt5', moreThan: 5 },
        { key: 'gt6', moreThan: 6 },
        { key: 'gt7', moreThan: 7 },
        { key: 'gt8', moreThan: 8 },
        { key: 'gt9', moreThan: 9 },
        { key: 'gt10', moreThan: 10 }
    ];

    var _open = false;
    var _busy = false;
    var _results = [];
    var _selected = Object.create(null);
    var _page = 0;
    var _lastConditions = null;
    var _bound = false;
    /** Saved filter-result library (broadcast_contact_lists with adv source). */
    var _savedLists = [];
    var _activeSavedId = '';
    var _activeSavedName = '';

    function tr(key, fallback) {
        if (typeof appTr === 'function') return appTr(key, fallback);
        if (typeof t === 'function') {
            try { return t(key) || fallback; } catch (e) { /* ignore */ }
        }
        return fallback;
    }
    function trRepl(key, vars, fallback) {
        if (typeof appTrRepl === 'function') return appTrRepl(key, vars, fallback);
        var s = tr(key, fallback || '');
        Object.keys(vars || {}).forEach(function (k) {
            s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
        });
        return s;
    }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function g(id) { return document.getElementById(id); }

    function setStatus(msg, isErr) {
        var el = g('patientAdvStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = isErr ? '#b91c1c' : '#64748b';
    }

    function clinicTag() {
        var sel = g('patientDirClinicFilter');
        return sel ? String(sel.value || '').trim().toUpperCase() : '';
    }

    function readFilters() {
        var age = '';
        var ageBtn = document.querySelector('#patientAdvAgeBtns .patient-adv-chip.is-active[data-adv-age]');
        if (ageBtn) age = ageBtn.getAttribute('data-adv-age') || '';
        var sex = '';
        var sexBtn = document.querySelector('#patientAdvSexBtns .patient-adv-chip.is-active[data-adv-sex]');
        if (sexBtn) sex = sexBtn.getAttribute('data-adv-sex') || '';
        var bday = (g('patientAdvBday') && g('patientAdvBday').value) || '';
        var district = (g('patientAdvDistrict') && g('patientAdvDistrict').value) || '';
        var notes = (g('patientAdvNotes') && g('patientAdvNotes').value) || '';
        var scaling = (g('patientAdvScaling') && g('patientAdvScaling').value) || '';
        var treats = [];
        TREAT_DEFS.forEach(function (d) {
            var cb = g('patientAdvTreat_' + d.key);
            if (cb && cb.checked) treats.push(d.key);
        });
        var unpaidEl = g('patientAdvHasUnpaid');
        var slider = g('patientAdvSpendSlider');
        var spendIdx = slider ? parseInt(slider.value, 10) : 0;
        if (!isFinite(spendIdx) || spendIdx < 0) spendIdx = 0;
        if (spendIdx >= EXPEND_STEPS.length) spendIdx = EXPEND_STEPS.length - 1;
        var spendStep = EXPEND_STEPS[spendIdx] || EXPEND_STEPS[0];
        var stale = (g('patientAdvStaleBal') && g('patientAdvStaleBal').value) || '';
        var installSlider = g('patientAdvInstallSlider');
        var installIdx = installSlider ? parseInt(installSlider.value, 10) : 0;
        if (!isFinite(installIdx) || installIdx < 0) installIdx = 0;
        if (installIdx >= INSTALL_STEPS.length) installIdx = INSTALL_STEPS.length - 1;
        var installStep = INSTALL_STEPS[installIdx] || INSTALL_STEPS[0];
        return {
            age: age || 'all',
            sex: sex || 'all',
            birthday: bday || '',
            district: district || '',
            notesOlder: notes || '',
            scalingOlder: scaling || '',
            treatments: treats,
            hasUnpaid: !!(unpaidEl && unpaidEl.checked),
            spendIdx: spendIdx,
            spendKey: spendStep.key || '',
            spendMode: spendStep.mode || '',
            spendAmount: spendStep.amount || 0,
            staleUnpaidYears: stale || '',
            installIdx: installIdx,
            installKey: installStep.key || '',
            installMoreThan: installStep.moreThan || 0
        };
    }

    function districtCodes() {
        if (typeof PATIENT_RES_DISTRICT_CODES !== 'undefined' &&
            Array.isArray(PATIENT_RES_DISTRICT_CODES) && PATIENT_RES_DISTRICT_CODES.length) {
            return PATIENT_RES_DISTRICT_CODES.slice();
        }
        return [
            'central_western', 'wanchai', 'eastern', 'southern',
            'yautsimmong', 'shamshuipo', 'klncity', 'wongtaisin', 'kwuntong',
            'tuenmun', 'yuenlong', 'tsuenwan', 'kwaising', 'north', 'tupo',
            'shatin', 'saikung', 'islands'
        ];
    }

    function districtLabel(code) {
        if (typeof patientResDistrictLabel === 'function') {
            return patientResDistrictLabel(code);
        }
        var keys = {
            central_western: 'ai.district.centralWestern',
            wanchai: 'ai.district.wanchai',
            eastern: 'ai.district.eastern',
            southern: 'ai.district.southern',
            yautsimmong: 'ai.district.yauTsimMong',
            shamshuipo: 'ai.district.shamShuiPo',
            klncity: 'ai.district.kowloonCity',
            wongtaisin: 'ai.district.wongTaiSin',
            kwuntong: 'ai.district.kwunTong',
            tuenmun: 'ai.district.tuenMun',
            yuenlong: 'ai.district.yuenLong',
            tsuenwan: 'ai.district.tsuenWan',
            kwaising: 'ai.district.kwaiTsing',
            north: 'ai.district.northNt',
            tupo: 'ai.district.taiPo',
            shatin: 'ai.district.shaTin',
            saikung: 'ai.district.saiKung',
            islands: 'ai.district.islands'
        };
        return tr(keys[code] || '', code);
    }

    function fillDistrictSelect(sel) {
        if (!sel) return;
        var prev = String(sel.value || '');
        var html = '<option value="">' + esc(tr('patient.adv.district.any', 'Any')) + '</option>';
        districtCodes().forEach(function (code) {
            html += '<option value="' + esc(code) + '">' + esc(districtLabel(code)) + '</option>';
        });
        sel.innerHTML = html;
        if (prev) sel.value = prev;
    }

    function ensureDistrictField() {
        var panel = g('patientAdvPanel');
        if (!panel) return;
        var sel = g('patientAdvDistrict');
        if (!sel) {
            var grid = panel.querySelector('.patient-adv-grid');
            if (!grid) return;
            var field = document.createElement('div');
            field.className = 'patient-adv-field';
            field.innerHTML =
                '<label class="patient-adv-label" for="patientAdvDistrict">' +
                esc(tr('patient.adv.district', 'Living district')) + '</label>' +
                '<select id="patientAdvDistrict" class="patient-adv-select">' +
                '<option value="">' + esc(tr('patient.adv.district.any', 'Any')) + '</option>' +
                '</select>';
            var bdayField = g('patientAdvBday') && g('patientAdvBday').closest
                ? g('patientAdvBday').closest('.patient-adv-field') : null;
            if (bdayField && bdayField.parentNode) {
                bdayField.parentNode.insertBefore(field, bdayField.nextSibling);
            } else {
                grid.appendChild(field);
            }
            sel = g('patientAdvDistrict');
        }
        fillDistrictSelect(sel);
    }

    /** Ensure newer treatment checkboxes exist even if HTML was cached. */
    function ensureTreatCheckboxes() {
        var host = document.querySelector('#patientAdvPanel .patient-adv-treats');
        if (!host) return;
        TREAT_DEFS.forEach(function (d) {
            if (g('patientAdvTreat_' + d.key)) return;
            var lab = document.createElement('label');
            lab.innerHTML = '<input type="checkbox" id="patientAdvTreat_' + d.key + '"> <span>' +
                esc(tr(d.labelKey, d.label)) + '</span>';
            host.appendChild(lab);
        });
    }

    function districtMatches(patientDistrict, want) {
        if (!want) return true;
        return String(patientDistrict || '').trim() === String(want).trim();
    }

    function formatSpendAmount(n) {
        if (n >= 1000) {
            var k = n / 1000;
            return (Math.abs(k - Math.round(k)) < 0.001 ? String(Math.round(k)) : String(k)) + 'k';
        }
        return String(n);
    }

    function spendStepLabel(step) {
        if (!step || !step.key) return tr('patient.adv.spend.any', 'Any');
        if (step.mode === 'lt') return tr('patient.adv.spend.below1k', 'Below 1k');
        if (step.mode === 'gte' && step.amount >= 200000) {
            return tr('patient.adv.spend.over200k', '≥ 200k+');
        }
        return trRepl('patient.adv.spend.gte', { AMT: formatSpendAmount(step.amount) },
            '≥ HK$' + '{AMT}');
    }

    function syncSpendLabel() {
        var slider = g('patientAdvSpendSlider');
        var label = g('patientAdvSpendLabel');
        if (!slider || !label) return;
        var idx = parseInt(slider.value, 10) || 0;
        if (idx < 0) idx = 0;
        if (idx >= EXPEND_STEPS.length) idx = EXPEND_STEPS.length - 1;
        label.textContent = spendStepLabel(EXPEND_STEPS[idx]);
    }

    function spendHtmlBlock() {
        return '<div class="patient-adv-field patient-adv-field-wide" id="patientAdvSpendBlock">' +
            '<div class="patient-adv-label">' + esc(tr('patient.adv.spend', 'Accumulated expenditure')) + '</div>' +
            '<label class="patient-adv-check"><input type="checkbox" id="patientAdvHasUnpaid"> <span>' +
            esc(tr('patient.adv.spend.unpaid', 'Has unpaid balances')) + '</span></label>' +
            '<div class="patient-adv-spend-slider-wrap">' +
            '<div class="patient-adv-spend-slider-head"><span>' +
            esc(tr('patient.adv.spend.total', 'Total expenditure')) +
            '</span><strong id="patientAdvSpendLabel">' +
            esc(tr('patient.adv.spend.any', 'Any')) + '</strong></div>' +
            '<input type="range" id="patientAdvSpendSlider" class="patient-adv-spend-slider" ' +
            'min="0" max="' + (EXPEND_STEPS.length - 1) + '" step="1" value="0">' +
            '<div class="patient-adv-spend-ends"><span>' +
            esc(tr('patient.adv.spend.below1k', 'Below 1k')) + '</span><span>' +
            esc(tr('patient.adv.spend.over200k', '≥ 200k+')) + '</span></div></div>' +
            '<div class="patient-adv-field patient-adv-stale-field">' +
            '<label class="patient-adv-label" for="patientAdvStaleBal">' +
            esc(tr('patient.adv.spend.stale', 'Stale unsettled balance')) + '</label>' +
            '<select id="patientAdvStaleBal" class="patient-adv-select">' +
            '<option value="">' + esc(tr('patient.adv.spend.stale.any', 'Any')) + '</option>' +
            '<option value="1">' + esc(tr('patient.adv.spend.stale.1y', 'More than 1 year ago')) + '</option>' +
            '<option value="2">' + esc(tr('patient.adv.spend.stale.2y', 'More than 2 years ago')) + '</option>' +
            '<option value="3">' + esc(tr('patient.adv.spend.stale.3y', 'More than 3 years ago')) + '</option>' +
            '<option value="5">' + esc(tr('patient.adv.spend.stale.5y', 'More than 5 years ago')) + '</option>' +
            '</select></div></div>';
    }

    function ensureSpendFields() {
        var panel = g('patientAdvPanel');
        if (!panel || g('patientAdvSpendBlock')) {
            syncSpendLabel();
            return;
        }
        var grid = panel.querySelector('.patient-adv-grid');
        if (!grid) return;
        var wrap = document.createElement('div');
        wrap.innerHTML = spendHtmlBlock();
        var node = wrap.firstChild;
        if (node) grid.appendChild(node);
        syncSpendLabel();
        var slider = g('patientAdvSpendSlider');
        if (slider && !slider._advBound) {
            slider._advBound = true;
            slider.addEventListener('input', syncSpendLabel);
            slider.addEventListener('change', syncSpendLabel);
        }
    }

    function installStepLabel(step) {
        if (!step || !step.key || !step.moreThan) {
            return tr('patient.adv.install.any', 'Any');
        }
        if (step.moreThan >= 10) {
            return tr('patient.adv.install.gt10', 'More than 10+');
        }
        return trRepl('patient.adv.install.gt', { N: String(step.moreThan) },
            'More than {N}');
    }

    function syncInstallLabel() {
        var slider = g('patientAdvInstallSlider');
        var label = g('patientAdvInstallLabel');
        if (!slider || !label) return;
        var idx = parseInt(slider.value, 10) || 0;
        if (idx < 0) idx = 0;
        if (idx >= INSTALL_STEPS.length) idx = INSTALL_STEPS.length - 1;
        label.textContent = installStepLabel(INSTALL_STEPS[idx]);
    }

    function installHtmlBlock() {
        return '<div class="patient-adv-field patient-adv-field-wide" id="patientAdvInstallBlock">' +
            '<div class="patient-adv-label">' +
            esc(tr('patient.adv.install', 'Installment payments')) + '</div>' +
            '<div class="patient-adv-spend-slider-wrap">' +
            '<div class="patient-adv-spend-slider-head"><span>' +
            esc(tr('patient.adv.install.moreThan', 'More than')) +
            '</span><strong id="patientAdvInstallLabel">' +
            esc(tr('patient.adv.install.any', 'Any')) + '</strong></div>' +
            '<input type="range" id="patientAdvInstallSlider" class="patient-adv-spend-slider" ' +
            'min="0" max="' + (INSTALL_STEPS.length - 1) + '" step="1" value="0">' +
            '<div class="patient-adv-spend-ends"><span>' +
            esc(tr('patient.adv.install.any', 'Any')) + '</span><span>' +
            esc(tr('patient.adv.install.gt10', 'More than 10+')) +
            '</span></div></div></div>';
    }

    function bindInstallSlider() {
        var slider = g('patientAdvInstallSlider');
        if (slider && !slider._advBound) {
            slider._advBound = true;
            slider.addEventListener('input', syncInstallLabel);
            slider.addEventListener('change', syncInstallLabel);
        }
        syncInstallLabel();
    }

    function ensureInstallFields() {
        var panel = g('patientAdvPanel');
        if (!panel) return;
        if (g('patientAdvInstallBlock')) {
            bindInstallSlider();
            return;
        }
        var grid = panel.querySelector('.patient-adv-grid');
        if (!grid) return;
        var wrap = document.createElement('div');
        wrap.innerHTML = installHtmlBlock();
        var node = wrap.firstChild;
        var after = g('patientAdvSpendBlock');
        if (node && after && after.parentNode) {
            after.parentNode.insertBefore(node, after.nextSibling);
        } else if (node) {
            grid.appendChild(node);
        }
        bindInstallSlider();
    }

    function ageMatches(dob, ageMode) {
        if (!ageMode || ageMode === 'all') return true;
        var age = typeof patientAgeYears === 'function' ? patientAgeYears(dob) : null;
        if (age == null) return ageMode === 'unknown';
        if (ageMode === 'child') return age < 12;
        if (ageMode === 'adult') return age >= 12 && age <= 65;
        if (ageMode === 'senior') return age > 65;
        if (ageMode === 'unknown') return false;
        return true;
    }

    function sexMatches(sex, mode) {
        if (!mode || mode === 'all') return true;
        var k = typeof patientSexKind === 'function' ? patientSexKind(sex) : '';
        if (mode === 'male') return k === 'male';
        if (mode === 'female') return k === 'female';
        return true;
    }

    function birthdayMatches(dob, mode) {
        if (!mode) return true;
        var s = String(dob || '').trim();
        if (s.length < 7) return false;
        var mm = s.slice(5, 7);
        if (mode === 'coming') {
            var now = new Date();
            var next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
            var mNum = next.getMonth() + 1;
            var want = (mNum < 10 ? '0' : '') + String(mNum);
            return mm === want;
        }
        return mm === mode;
    }

    function itemsText(itemsJson) {
        try {
            if (typeof itemsJson === 'string') return itemsJson;
            return JSON.stringify(itemsJson || []);
        } catch (e) {
            return String(itemsJson || '');
        }
    }

    function itemsMatchTreatments(itemsJson, treatKeys) {
        if (!treatKeys || !treatKeys.length) return true;
        var text = itemsText(itemsJson);
        if (!text) return false;
        return treatKeys.some(function (key) {
            var def = null;
            for (var i = 0; i < TREAT_DEFS.length; i++) {
                if (TREAT_DEFS[i].key === key) { def = TREAT_DEFS[i]; break; }
            }
            if (!def) return false;
            return def.match.some(function (re) { return re.test(text); });
        });
    }

    function itemsMatchScaling(itemsJson) {
        var text = itemsText(itemsJson);
        if (!text) return false;
        return SCALING_MATCH.some(function (re) { return re.test(text); });
    }

    function billDateTs(bill) {
        var raw = (bill && (bill.bill_date || bill.created_at)) || '';
        if (!raw) return null;
        // YYYY-MM-DD or YYYYMMDD
        var s = String(raw).trim();
        if (/^\d{8}$/.test(s)) {
            s = s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8);
        }
        var ts = Date.parse(s);
        return isNaN(ts) ? null : ts;
    }

    function fetchAll(table, cols, onProgress) {
        var all = [];
        function page(from) {
            return SB.from(table)
                .select(cols)
                .range(from, from + FETCH_SIZE - 1)
                .then(function (r) {
                    if (r.error) return r;
                    var rows = r.data || [];
                    all = all.concat(rows);
                    if (typeof onProgress === 'function') onProgress(all.length);
                    if (rows.length < FETCH_SIZE) return { data: all, error: null };
                    return page(from + FETCH_SIZE);
                });
        }
        return page(0);
    }

    function fetchPatientsScoped(onProgress) {
        var colsWithDist =
            'id,patient_no,full_name,chinese_name,phone_number,mobile_phone,sex,dob,clinic_tag,hkid,residential_district';
        var colsCore =
            'id,patient_no,full_name,chinese_name,phone_number,mobile_phone,sex,dob,clinic_tag,hkid';
        var all = [];
        var useCols = colsWithDist;
        function page(from) {
            var q = SB.from('patients').select(useCols).order('patient_no', { ascending: true });
            if (typeof applyPatientQueryClinicTag === 'function') {
                q = applyPatientQueryClinicTag(q, 'patientDirClinicFilter');
            } else {
                var tag = clinicTag();
                if (tag) q = q.eq('clinic_tag', tag);
            }
            return q.range(from, from + FETCH_SIZE - 1).then(function (r) {
                if (r.error && useCols === colsWithDist &&
                    /residential_district|column/i.test(String(r.error.message || ''))) {
                    useCols = colsCore;
                    all = [];
                    return page(0);
                }
                if (r.error) return r;
                var rows = r.data || [];
                all = all.concat(rows);
                if (typeof onProgress === 'function') onProgress(all.length);
                if (rows.length < FETCH_SIZE) return { data: all, error: null };
                return page(from + FETCH_SIZE);
            });
        }
        return page(0);
    }

    function loadTreatmentPatientIds(treatKeys, onProgress) {
        if (!treatKeys.length) return Promise.resolve(null);
        return fetchAll('bills', 'patient_id,items', onProgress).then(function (r) {
            if (r.error) return r;
            var set = Object.create(null);
            (r.data || []).forEach(function (b) {
                if (!b || !b.patient_id) return;
                if (itemsMatchTreatments(b.items, treatKeys)) {
                    set[String(b.patient_id)] = true;
                }
            });
            return { data: set, error: null };
        });
    }

    /** Latest scaling bill date (ms) per patient_id. */
    function loadLastScalingDates(onProgress) {
        function buildMap(rows) {
            var map = Object.create(null);
            (rows || []).forEach(function (b) {
                if (!b || !b.patient_id || b.voided_at) return;
                if (!itemsMatchScaling(b.items)) return;
                var ts = billDateTs(b);
                if (ts == null) return;
                var id = String(b.patient_id);
                if (map[id] == null || ts > map[id]) map[id] = ts;
            });
            return { data: map, error: null };
        }
        return fetchAll('bills', 'patient_id,items,bill_date,created_at,voided_at', onProgress)
            .then(function (r) {
                if (r.error && /voided_at/i.test(String(r.error.message || ''))) {
                    return fetchAll('bills', 'patient_id,items,bill_date,created_at', onProgress)
                        .then(function (r2) {
                            if (r2.error) return r2;
                            return buildMap(r2.data);
                        });
                }
                if (r.error) return r;
                return buildMap(r.data);
            });
    }

    function scalingOlderMatches(lastTs, monthsMode) {
        if (!monthsMode) return true;
        var months = parseInt(monthsMode, 10);
        if (!months) return true;
        var cutoff = Date.now() - months * 30.44 * 24 * 3600 * 1000;
        if (lastTs == null) return true; // never scaled → due for recall
        return lastTs < cutoff;
    }

    function loadLastNoteDates(onProgress) {
        return fetchAll('treatments', 'patient_id,created_at', onProgress).then(function (r) {
            if (r.error) return r;
            var map = Object.create(null);
            (r.data || []).forEach(function (row) {
                if (!row || !row.patient_id || !row.created_at) return;
                var id = String(row.patient_id);
                var ts = Date.parse(row.created_at);
                if (isNaN(ts)) return;
                if (map[id] == null || ts > map[id]) map[id] = ts;
            });
            return { data: map, error: null };
        });
    }

    function notesOlderMatches(lastTs, mode) {
        if (!mode) return true;
        var years = parseInt(mode, 10);
        if (!years) return true;
        var cutoff = Date.now() - years * 365.25 * 24 * 3600 * 1000;
        if (lastTs == null) return true; // never treated → include for recall
        return lastTs < cutoff;
    }

    /** Per-patient spend stats from non-voided bills. */
    function loadSpendStats(onProgress) {
        function buildMap(rows) {
            var map = Object.create(null);
            (rows || []).forEach(function (b) {
                if (!b || !b.patient_id || b.voided_at) return;
                var id = String(b.patient_id);
                var st = map[id];
                if (!st) {
                    st = map[id] = { total: 0, unpaid: 0, oldestUnpaidTs: null };
                }
                var tot = parseFloat(b.total);
                if (isFinite(tot) && tot > 0) st.total += tot;
                var bal = parseFloat(b.balance);
                if (isFinite(bal) && bal > 0.005) {
                    st.unpaid += bal;
                    var ts = billDateTs(b);
                    if (ts != null && (st.oldestUnpaidTs == null || ts < st.oldestUnpaidTs)) {
                        st.oldestUnpaidTs = ts;
                    }
                }
            });
            return { data: map, error: null };
        }
        return fetchAll('bills', 'patient_id,total,balance,bill_date,created_at,voided_at', onProgress)
            .then(function (r) {
                if (r.error && /voided_at/i.test(String(r.error.message || ''))) {
                    return fetchAll('bills', 'patient_id,total,balance,bill_date,created_at', onProgress)
                        .then(function (r2) {
                            if (r2.error) return r2;
                            return buildMap(r2.data);
                        });
                }
                if (r.error) return r;
                return buildMap(r.data);
            });
    }

    function spendTotalMatches(st, f) {
        if (!f.spendKey) return true;
        var total = (st && st.total) || 0;
        if (f.spendMode === 'lt') return total < f.spendAmount;
        if (f.spendMode === 'gte') return total >= f.spendAmount;
        return true;
    }

    function unpaidMatches(st, want) {
        if (!want) return true;
        return !!(st && st.unpaid > 0.005);
    }

    function staleUnpaidMatches(st, yearsMode) {
        if (!yearsMode) return true;
        var years = parseInt(yearsMode, 10);
        if (!years) return true;
        if (!st || !(st.unpaid > 0.005) || st.oldestUnpaidTs == null) return false;
        var cutoff = Date.now() - years * 365.25 * 24 * 3600 * 1000;
        return st.oldestUnpaidTs < cutoff;
    }

    function needsSpendScan(f) {
        return !!(f.hasUnpaid || f.spendKey || f.staleUnpaidYears);
    }

    function needsInstallScan(f) {
        return !!(f && f.installKey && f.installMoreThan > 0);
    }

    function isInstallmentPayMethod(method) {
        if (typeof window.isBalanceTransferPayMethod === 'function' &&
            window.isBalanceTransferPayMethod(method)) {
            return false;
        }
        var s = String(method == null ? '' : method).trim().toLowerCase();
        if (!s) return true;
        if (s === 'pending' || s === 'n/a' || s === 'na') return false;
        return true;
    }

    /**
     * Per-patient max installment count = max # of non-void, non-BT payment
     * rows on any single bill.
     */
    function loadInstallmentStats(onProgress) {
        function buildMap(bills, payments) {
            var billPatient = Object.create(null);
            (bills || []).forEach(function (b) {
                if (!b || !b.id || !b.patient_id || b.voided_at) return;
                billPatient[String(b.id)] = String(b.patient_id);
            });
            var billCounts = Object.create(null);
            (payments || []).forEach(function (p) {
                if (!p || !p.bill_id || p.voided_at) return;
                if (!isInstallmentPayMethod(p.method)) return;
                var amt = parseFloat(p.amount);
                if (isFinite(amt) && amt <= 0.005) return;
                var bid = String(p.bill_id);
                if (!billPatient[bid]) return;
                billCounts[bid] = (billCounts[bid] || 0) + 1;
            });
            var map = Object.create(null);
            Object.keys(billCounts).forEach(function (bid) {
                var pid = billPatient[bid];
                if (!pid) return;
                var n = billCounts[bid] || 0;
                if (map[pid] == null || n > map[pid]) map[pid] = n;
            });
            return { data: map, error: null };
        }

        function loadPayments(bills, cols) {
            cols = cols || 'bill_id,amount,method,voided_at';
            return fetchAll('bill_payments', cols, onProgress)
                .then(function (pr) {
                    var msg = String((pr.error && pr.error.message) || '');
                    if (pr.error && /voided_at/i.test(msg)) {
                        return loadPayments(bills, cols.replace(/,?voided_at/, ''));
                    }
                    if (pr.error && /amount/i.test(msg) && /amount/.test(cols)) {
                        return loadPayments(bills, cols.replace(/,?amount/, ''));
                    }
                    if (pr.error) return pr;
                    return buildMap(bills, pr.data);
                });
        }

        return fetchAll('bills', 'id,patient_id,voided_at', onProgress)
            .then(function (br) {
                if (br.error && /voided_at/i.test(String(br.error.message || ''))) {
                    return fetchAll('bills', 'id,patient_id', onProgress).then(function (br2) {
                        if (br2.error) return br2;
                        return loadPayments(br2.data);
                    });
                }
                if (br.error) return br;
                return loadPayments(br.data);
            });
    }

    function installmentMatches(maxCount, f) {
        if (!needsInstallScan(f)) return true;
        var n = maxCount == null ? 0 : Number(maxCount);
        return n > f.installMoreThan;
    }

    function runSearch() {
        if (_busy) return;
        if (typeof SB === 'undefined' || !SB.from) {
            setStatus(tr('patient.adv.noSb', 'Supabase unavailable.'), true);
            return;
        }
        ensureSpendFields();
        ensureInstallFields();
        ensureDistrictField();
        ensureTreatCheckboxes();
        var f = readFilters();
        var hasAny = (f.age && f.age !== 'all') || (f.sex && f.sex !== 'all') ||
            f.birthday || f.district || f.notesOlder || f.scalingOlder ||
            (f.treatments && f.treatments.length) ||
            needsSpendScan(f) || needsInstallScan(f);
        if (!hasAny) {
            setStatus(tr('patient.adv.needFilter',
                'Choose at least one advanced filter, then search.'), true);
            return;
        }
        _busy = true;
        _selected = Object.create(null);
        _page = 0;
        _results = [];
        renderResults();
        setStatus(tr('patient.adv.searching', 'Searching…'), false);

        var treatSet = null;
        var noteMap = null;
        var scalingMap = null;
        var spendMap = null;
        var installMap = null;

        fetchPatientsScoped(function (n) {
            setStatus(trRepl('patient.adv.loadingPatients', { N: n }, 'Loading patients… {N}'), false);
        }).then(function (pr) {
            if (pr.error) throw pr.error;
            var patients = pr.data || [];
            var chain = Promise.resolve();
            if (f.treatments.length) {
                chain = chain.then(function () {
                    return loadTreatmentPatientIds(f.treatments, function (n) {
                        setStatus(trRepl('patient.adv.loadingBills', { N: n },
                            'Scanning treatment history… {N}'), false);
                    }).then(function (tr2) {
                        if (tr2.error) throw tr2.error;
                        treatSet = tr2.data;
                    });
                });
            }
            if (f.notesOlder) {
                chain = chain.then(function () {
                    return loadLastNoteDates(function (n) {
                        setStatus(trRepl('patient.adv.loadingNotes', { N: n },
                            'Scanning consultation notes… {N}'), false);
                    }).then(function (nr) {
                        if (nr.error) throw nr.error;
                        noteMap = nr.data;
                    });
                });
            }
            if (f.scalingOlder) {
                chain = chain.then(function () {
                    return loadLastScalingDates(function (n) {
                        setStatus(trRepl('patient.adv.loadingScaling', { N: n },
                            'Scanning scaling history… {N}'), false);
                    }).then(function (sr) {
                        if (sr.error) throw sr.error;
                        scalingMap = sr.data;
                    });
                });
            }
            if (needsSpendScan(f)) {
                chain = chain.then(function () {
                    return loadSpendStats(function (n) {
                        setStatus(trRepl('patient.adv.loadingSpend', { N: n },
                            'Scanning bill expenditure… {N}'), false);
                    }).then(function (sr) {
                        if (sr.error) throw sr.error;
                        spendMap = sr.data;
                    });
                });
            }
            if (needsInstallScan(f)) {
                chain = chain.then(function () {
                    return loadInstallmentStats(function (n) {
                        setStatus(trRepl('patient.adv.loadingInstallments', { N: n },
                            'Scanning installment payments… {N}'), false);
                    }).then(function (ir) {
                        if (ir.error) throw ir.error;
                        installMap = ir.data;
                    });
                });
            }
            return chain.then(function () {
                var out = patients.filter(function (p) {
                    if (!ageMatches(p.dob, f.age)) return false;
                    if (!sexMatches(p.sex, f.sex)) return false;
                    if (!birthdayMatches(p.dob, f.birthday)) return false;
                    if (!districtMatches(p.residential_district, f.district)) return false;
                    if (treatSet && !treatSet[String(p.id)]) return false;
                    if (f.notesOlder && !notesOlderMatches(
                        noteMap ? noteMap[String(p.id)] : null, f.notesOlder
                    )) return false;
                    if (f.scalingOlder && !scalingOlderMatches(
                        scalingMap ? scalingMap[String(p.id)] : null, f.scalingOlder
                    )) return false;
                    if (needsSpendScan(f)) {
                        var st = spendMap ? spendMap[String(p.id)] : null;
                        if (!unpaidMatches(st, f.hasUnpaid)) return false;
                        if (!spendTotalMatches(st, f)) return false;
                        if (!staleUnpaidMatches(st, f.staleUnpaidYears)) return false;
                    }
                    if (needsInstallScan(f)) {
                        var maxInst = installMap ? installMap[String(p.id)] : 0;
                        if (!installmentMatches(maxInst, f)) return false;
                    }
                    return true;
                });
                _results = out;
                _page = 0;
                _lastConditions = {
                    source: 'patient_advanced_search',
                    age: f.age,
                    sex: f.sex,
                    birthday: f.birthday,
                    district: f.district,
                    notesOlder: f.notesOlder,
                    scalingOlder: f.scalingOlder,
                    treatments: f.treatments.slice(),
                    hasUnpaid: f.hasUnpaid,
                    spendKey: f.spendKey,
                    spendMode: f.spendMode,
                    spendAmount: f.spendAmount,
                    staleUnpaidYears: f.staleUnpaidYears,
                    installKey: f.installKey,
                    installMoreThan: f.installMoreThan,
                    clinic: clinicTag() || ''
                };
                setStatus(trRepl('patient.adv.found', { N: out.length },
                    'Found {N} patient(s).'), false);
                // Push the same ordered set into the live patient directory rows.
                if (typeof applyPatientDirAdvancedFilter === 'function') {
                    applyPatientDirAdvancedFilter(_results);
                } else {
                    renderResults();
                }
            });
        }).catch(function (err) {
            setStatus(String((err && err.message) || err || 'Search failed'), true);
        }).then(function () {
            _busy = false;
        });
    }

    function selectedIds() {
        return Object.keys(_selected).filter(function (id) { return !!_selected[id]; });
    }

    function visiblePageRows() {
        var ps = dirPageSize();
        var from = _page * ps;
        return _results.slice(from, from + ps);
    }

    function renderResults() {
        var wrap = g('patientAdvResults');
        var body = g('patientAdvResultBody');
        var meta = g('patientAdvResultMeta');
        if (!wrap || !body) return;
        wrap.hidden = false;
        var total = _results.length;
        var ps = dirPageSize();
        var pages = Math.max(1, Math.ceil(total / ps) || 1);
        if (_page >= pages) _page = pages - 1;
        if (_page < 0) _page = 0;
        var rows = visiblePageRows();
        var selN = selectedIds().length;
        if (meta) {
            meta.textContent = trRepl('patient.adv.resultMeta', {
                N: total, SEL: selN, PAGE: _page + 1, PAGES: pages
            }, '{N} results · {SEL} selected · page {PAGE}/{PAGES}');
        }
        if (!total) {
            body.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:18px;">' +
                esc(tr('patient.adv.noResults', 'No matching patients.')) + '</td></tr>';
            return;
        }
        var activeId = (typeof selPatientId !== 'undefined' && selPatientId != null)
            ? String(selPatientId) : '';
        body.innerHTML = rows.map(function (p) {
            var id = String(p.id);
            var checked = _selected[id] ? ' checked' : '';
            var name = (p.chinese_name ? (p.chinese_name + ' ') : '') + (p.full_name || '');
            var phone = String(p.phone_number || p.mobile_phone || '').trim() || '—';
            var dob = typeof formatDobAge === 'function' ? formatDobAge(p.dob) : (p.dob || '—');
            var activeCls = (activeId && activeId === id) ? ' class="is-adv-active"' : '';
            return '<tr data-adv-id="' + esc(id) + '"' + activeCls + '>' +
                '<td><input type="checkbox" class="patient-adv-cb" data-id="' + esc(id) + '"' + checked + '></td>' +
                '<td>' + esc(p.patient_no || '') + '</td>' +
                '<td>' + esc(name) + '</td>' +
                '<td>' + esc(phone) + '</td>' +
                '<td>' + esc(p.clinic_tag || '') + '</td>' +
                '<td>' + esc(dob) + '</td>' +
                '</tr>';
        }).join('');
        var prev = g('patientAdvPrev');
        var next = g('patientAdvNext');
        if (prev) prev.disabled = _page <= 0;
        if (next) next.disabled = _page >= pages - 1;
    }

    /** Keep Advanced Search result pager aligned with the directory pager. */
    function syncPageFromDirectory(pageIndex) {
        var ps = dirPageSize();
        var pages = Math.max(1, Math.ceil((_results.length || 0) / ps) || 1);
        var p = parseInt(pageIndex, 10);
        if (!isFinite(p) || p < 0) p = 0;
        if (p >= pages) p = pages - 1;
        _page = p;
        renderResults();
    }

    function onDirectoryLiveSearch() {
        _results = [];
        _selected = Object.create(null);
        _page = 0;
        _lastConditions = null;
        _activeSavedId = '';
        _activeSavedName = '';
        var wrap = g('patientAdvResults');
        if (wrap) wrap.hidden = true;
        setStatus('', false);
        renderSavedLibrary();
    }

    function changeAdvPage(delta) {
        if (typeof isPatientDirAdvFiltered === 'function' && isPatientDirAdvFiltered() &&
            typeof patientDirChangePage === 'function') {
            patientDirChangePage(delta);
            return;
        }
        _page += (parseInt(delta, 10) || 0);
        renderResults();
    }

    function selectPage(on) {
        visiblePageRows().forEach(function (p) {
            if (on) _selected[String(p.id)] = true;
            else delete _selected[String(p.id)];
        });
        renderResults();
    }

    function selectAllResults(on) {
        if (on) {
            _results.forEach(function (p) { _selected[String(p.id)] = true; });
        } else {
            _selected = Object.create(null);
        }
        renderResults();
    }

    function currentResultIds() {
        var ids = selectedIds();
        if (!ids.length) {
            ids = _results.map(function (p) { return String(p.id); });
        }
        return ids;
    }

    function advSaveConditions(extra) {
        var base = _lastConditions && typeof _lastConditions === 'object'
            ? Object.assign({}, _lastConditions)
            : {};
        base.source = 'patient_advanced_search';
        base.library = 'patient_adv_saved';
        if (extra && typeof extra === 'object') {
            Object.keys(extra).forEach(function (k) { base[k] = extra[k]; });
        }
        return base;
    }

    function isAdvSavedList(seg) {
        if (!seg || seg.kind === 'folder') return false;
        var c = seg.conditions;
        if (typeof c === 'string') {
            try { c = JSON.parse(c); } catch (e) { c = null; }
        }
        if (!c || typeof c !== 'object') return false;
        return c.source === 'patient_advanced_search' || c.library === 'patient_adv_saved';
    }

    function segmentPatientIds(seg) {
        if (!seg) return [];
        var ids = seg.patientIds || seg.patient_ids || [];
        if (typeof ids === 'string') {
            try { ids = JSON.parse(ids); } catch (e) { ids = []; }
        }
        if (!Array.isArray(ids)) return [];
        return ids.map(function (id) { return id != null ? String(id) : ''; }).filter(Boolean);
    }

    function normalizeSavedRow(row) {
        if (!row) return null;
        var ids = row.patient_ids || row.patientIds || [];
        if (typeof ids === 'string') {
            try { ids = JSON.parse(ids); } catch (e) { ids = []; }
        }
        var cond = row.conditions;
        if (typeof cond === 'string') {
            try { cond = JSON.parse(cond); } catch (e) { cond = null; }
        }
        return {
            id: String(row.id),
            name: String(row.name || '').trim() || '—',
            patientIds: Array.isArray(ids) ? ids.map(String) : [],
            conditions: cond && typeof cond === 'object' ? cond : null,
            updated_at: row.updated_at || row.updatedAt || row.created_at || row.createdAt || '',
            kind: row.kind || 'list'
        };
    }

    function refreshSavedLibrary() {
        function applyList(list) {
            _savedLists = (list || []).map(normalizeSavedRow).filter(function (s) {
                return s && isAdvSavedList(s);
            });
            renderSavedLibrary();
            return _savedLists;
        }
        if (typeof MASSBC !== 'undefined' && typeof MASSBC.refreshSegmentsFromCloud === 'function') {
            return Promise.resolve(MASSBC.refreshSegmentsFromCloud()).then(function () {
                var segs = typeof MASSBC.getSegments === 'function' ? MASSBC.getSegments() : [];
                return applyList(segs);
            });
        }
        if (typeof SB === 'undefined' || !SB.from) {
            _savedLists = [];
            renderSavedLibrary();
            return Promise.resolve([]);
        }
        return SB.from('broadcast_contact_lists')
            .select('id,name,patient_ids,conditions,updated_at,created_at,kind')
            .eq('is_active', true)
            .order('updated_at', { ascending: false })
            .then(function (r) {
                if (r.error) {
                    setStatus(String(r.error.message || r.error), true);
                    return [];
                }
                return applyList(r.data || []);
            });
    }

    function renderSavedLibrary() {
        ensureSavedLibraryDom();
        var host = g('patientAdvSavedList');
        if (!host) return;
        if (!_savedLists.length) {
            host.innerHTML = '<div class="patient-adv-saved-empty">' +
                esc(tr('patient.adv.saved.empty',
                    'No saved filter results yet. Run a search, then Save result.')) +
                '</div>';
            return;
        }
        host.innerHTML = _savedLists.map(function (s) {
            var n = (s.patientIds && s.patientIds.length) || 0;
            var active = _activeSavedId && String(_activeSavedId) === String(s.id);
            var when = '';
            if (s.updated_at) {
                try {
                    var d = new Date(s.updated_at);
                    if (!isNaN(d.getTime())) when = d.toLocaleDateString();
                } catch (e) { when = ''; }
            }
            return '<div class="patient-adv-saved-row' + (active ? ' is-active' : '') +
                '" data-saved-id="' + esc(s.id) + '">' +
                '<div class="patient-adv-saved-main">' +
                '<strong class="patient-adv-saved-name">' + esc(s.name) + '</strong>' +
                '<span class="patient-adv-saved-meta">' +
                esc(trRepl('patient.adv.saved.meta', { N: n, D: when || '—' },
                    '{N} patients · {D}')) +
                '</span></div>' +
                '<div class="patient-adv-saved-actions">' +
                '<button type="button" class="patient-adv-link-btn" data-adv-saved-act="open" data-id="' +
                esc(s.id) + '">' + esc(tr('patient.adv.saved.open', 'Open')) + '</button>' +
                '<button type="button" class="patient-adv-link-btn" data-adv-saved-act="rename" data-id="' +
                esc(s.id) + '">' + esc(tr('patient.adv.saved.rename', 'Rename')) + '</button>' +
                '<button type="button" class="patient-adv-link-btn" data-adv-saved-act="update" data-id="' +
                esc(s.id) + '">' + esc(tr('patient.adv.saved.update', 'Update')) + '</button>' +
                '<button type="button" class="patient-adv-link-btn" data-adv-saved-act="transfer" data-id="' +
                esc(s.id) + '">' + esc(tr('patient.adv.saved.transfer', 'Transfer')) + '</button>' +
                '<button type="button" class="patient-adv-link-btn patient-adv-danger" data-adv-saved-act="delete" data-id="' +
                esc(s.id) + '">' + esc(tr('patient.adv.saved.delete', 'Delete')) + '</button>' +
                '</div></div>';
        }).join('');
    }

    function ensureSavedLibraryDom() {
        var panel = g('patientAdvPanel');
        var results = g('patientAdvResults');
        if (!panel && !results) return;
        if (g('patientAdvSaved')) return;
        var block = document.createElement('div');
        block.id = 'patientAdvSaved';
        block.className = 'patient-adv-saved';
        block.hidden = !_open;
        block.innerHTML =
            '<div class="patient-adv-saved-head">' +
            '<strong data-i18n="patient.adv.saved.title">' +
            esc(tr('patient.adv.saved.title', 'Saved filter results')) + '</strong>' +
            '<button type="button" id="patientAdvSavedRefresh" class="patient-adv-link-btn">' +
            esc(tr('patient.adv.saved.refresh', 'Refresh')) + '</button></div>' +
            '<div id="patientAdvSavedList" class="patient-adv-saved-list"></div>';
        if (results && results.parentNode) {
            results.parentNode.insertBefore(block, results);
        } else if (panel && panel.parentNode) {
            panel.parentNode.insertBefore(block, panel.nextSibling);
        }
    }

    function fetchPatientsByIds(ids) {
        var idArr = (ids || []).map(String).filter(Boolean);
        if (!idArr.length) return Promise.resolve([]);
        if (typeof SB === 'undefined' || !SB.from) {
            return Promise.reject(new Error(tr('patient.adv.noSb', 'Supabase unavailable.')));
        }
        var cols = 'id,patient_no,full_name,chinese_name,phone_number,mobile_phone,sex,dob,clinic_tag,hkid';
        var out = [];
        var CHUNK = 80;
        function page(i) {
            if (i >= idArr.length) return Promise.resolve(out);
            var chunk = idArr.slice(i, i + CHUNK);
            return SB.from('patients').select(cols).in('id', chunk).then(function (r) {
                if (r.error) throw r.error;
                out = out.concat(r.data || []);
                return page(i + CHUNK);
            });
        }
        return page(0).then(function () {
            var map = Object.create(null);
            out.forEach(function (p) {
                if (p && p.id != null) map[String(p.id)] = p;
            });
            return idArr.map(function (id) { return map[id]; }).filter(Boolean);
        });
    }

    function openSavedList(id) {
        var sid = String(id || '');
        var seg = null;
        for (var i = 0; i < _savedLists.length; i++) {
            if (String(_savedLists[i].id) === sid) { seg = _savedLists[i]; break; }
        }
        if (!seg && typeof MASSBC !== 'undefined' && typeof MASSBC.findSegment === 'function') {
            seg = normalizeSavedRow(MASSBC.findSegment(sid));
        }
        if (!seg) {
            setStatus(tr('patient.adv.saved.missing', 'Saved list not found.'), true);
            return;
        }
        var ids = segmentPatientIds(seg);
        if (!ids.length) {
            setStatus(tr('patient.adv.saved.emptyMembers', 'This saved list has no patients.'), true);
            return;
        }
        setStatus(tr('patient.adv.saved.loading', 'Loading saved result…'), false);
        fetchPatientsByIds(ids).then(function (rows) {
            _results = rows;
            _selected = Object.create(null);
            _page = 0;
            _activeSavedId = String(seg.id);
            _activeSavedName = seg.name || '';
            _lastConditions = (seg.conditions && typeof seg.conditions === 'object')
                ? Object.assign({}, seg.conditions)
                : { source: 'patient_advanced_search' };
            if (typeof applyPatientDirAdvancedFilter === 'function') {
                applyPatientDirAdvancedFilter(_results);
            } else {
                renderResults();
            }
            renderSavedLibrary();
            setStatus(trRepl('patient.adv.saved.opened', {
                NAME: seg.name, N: rows.length
            }, 'Opened “{NAME}” ({N} patients).'), false);
        }).catch(function (err) {
            setStatus(String((err && err.message) || err || 'Load failed'), true);
        });
    }

    function renameSavedList(id) {
        var sid = String(id || '');
        if (typeof MASSBC !== 'undefined' && typeof MASSBC.renameSavedSegment === 'function') {
            MASSBC.renameSavedSegment(sid);
            setTimeout(function () { refreshSavedLibrary(); }, 400);
            return;
        }
        var seg = null;
        for (var i = 0; i < _savedLists.length; i++) {
            if (String(_savedLists[i].id) === sid) { seg = _savedLists[i]; break; }
        }
        if (!seg) return;
        var name = window.prompt(tr('patient.adv.saved.renamePrompt', 'Rename saved result:'), seg.name);
        if (name === null || !String(name).trim()) return;
        name = String(name).trim();
        SB.from('broadcast_contact_lists').update({
            name: name, updated_at: new Date().toISOString()
        }).eq('id', sid).then(function (r) {
            if (r.error) {
                setStatus(String(r.error.message || r.error), true);
                return;
            }
            if (_activeSavedId === sid) _activeSavedName = name;
            refreshSavedLibrary();
            setStatus(trRepl('patient.adv.saved.renamed', { NAME: name }, 'Renamed to “{NAME}”.'), false);
        });
    }

    function updateSavedList(id) {
        var sid = String(id || _activeSavedId || '');
        var ids = currentResultIds();
        if (!sid) {
            setStatus(tr('patient.adv.saved.needActive',
                'Open a saved result first, or use Save result.'), true);
            return;
        }
        if (!ids.length) {
            setStatus(tr('patient.adv.needResults', 'Run a search first.'), true);
            return;
        }
        if (!window.confirm(trRepl('patient.adv.saved.confirmUpdate', { N: ids.length },
            'Replace this saved result with the current {N} patient(s)?'))) {
            return;
        }
        setStatus(tr('patient.adv.savingList', 'Saving contact list…'), false);
        var cond = advSaveConditions();
        var done = function (row) {
            if (!row) {
                setStatus(tr('patient.adv.saveFail', 'Could not save list.'), true);
                return;
            }
            _activeSavedId = String(row.id);
            _activeSavedName = row.name || '';
            refreshSavedLibrary();
            setStatus(trRepl('patient.adv.saved.updated', {
                NAME: row.name, N: ids.length
            }, 'Updated “{NAME}” ({N}).'), false);
        };
        if (typeof MASSBC !== 'undefined' && typeof MASSBC.updateListPatientIds === 'function') {
            Promise.resolve(MASSBC.updateListPatientIds(sid, ids, cond)).then(done);
            return;
        }
        SB.from('broadcast_contact_lists').update({
            patient_ids: ids,
            conditions: cond,
            updated_at: new Date().toISOString()
        }).eq('id', sid).select('id,name').single().then(function (r) {
            if (r.error) {
                setStatus(String(r.error.message || r.error), true);
                return;
            }
            done(r.data);
        });
    }

    function deleteSavedList(id) {
        var sid = String(id || '');
        var seg = null;
        for (var i = 0; i < _savedLists.length; i++) {
            if (String(_savedLists[i].id) === sid) { seg = _savedLists[i]; break; }
        }
        var label = (seg && seg.name) || sid;
        if (!window.confirm(trRepl('patient.adv.saved.confirmDelete', { NAME: label },
            'Delete saved result “{NAME}”?'))) {
            return;
        }
        function finish() {
            if (_activeSavedId === sid) {
                _activeSavedId = '';
                _activeSavedName = '';
            }
            refreshSavedLibrary();
            setStatus(trRepl('patient.adv.saved.deleted', { NAME: label },
                'Deleted “{NAME}”.'), false);
        }
        if (typeof MASSBC !== 'undefined' && typeof MASSBC.deleteListById === 'function') {
            Promise.resolve(MASSBC.deleteListById(sid)).then(finish);
            return;
        }
        SB.from('broadcast_contact_lists').update({
            is_active: false, updated_at: new Date().toISOString()
        }).eq('id', sid).then(function (r) {
            if (r.error) {
                setStatus(String(r.error.message || r.error), true);
                return;
            }
            finish();
        });
    }

    function transferToBroadcast(listIdOpt) {
        var sid = String(listIdOpt || _activeSavedId || '');
        function navigate(id) {
            setStatus(tr('patient.adv.saved.transferring',
                'Opening Broadcast…'), false);
            if (typeof showOnly === 'function') {
                showOnly('appointmentSection');
            }
            setTimeout(function () {
                if (typeof switchApptTab === 'function') {
                    try { switchApptTab('broadcast'); } catch (e) { /* ignore */ }
                }
                setTimeout(function () {
                    if (typeof MASSBC !== 'undefined') {
                        if (typeof MASSBC.setMode === 'function') MASSBC.setMode('contacts');
                        if (typeof MASSBC.activateSegment === 'function') {
                            MASSBC.activateSegment(id);
                        }
                    }
                    setStatus(tr('patient.adv.saved.transferred',
                        'Opened in Appointment → Broadcast for mass messaging.'), false);
                }, 180);
            }, 80);
        }
        if (sid) {
            navigate(sid);
            return;
        }
        // No saved list yet — save current results, then transfer.
        var ids = currentResultIds();
        if (!ids.length) {
            setStatus(tr('patient.adv.needResults', 'Run a search first.'), true);
            return;
        }
        saveResultList({ transferAfter: true });
    }

    function saveResultList(opts) {
        opts = opts || {};
        var ids = currentResultIds();
        if (!ids.length) {
            setStatus(tr('patient.adv.needResults', 'Run a search first.'), true);
            return;
        }
        var defaultName = _activeSavedName ||
            (tr('patient.adv.defaultListName', 'Advanced search') + ' (' + ids.length + ')');
        var name = window.prompt(
            tr('patient.adv.promptListName', 'Save filter result — name:'),
            defaultName
        );
        if (name === null || !String(name).trim()) return;
        name = String(name).trim();
        setStatus(tr('patient.adv.savingList', 'Saving contact list…'), false);
        var cond = advSaveConditions();

        function doneOk(row) {
            if (!row) {
                setStatus(tr('patient.adv.saveFail', 'Could not save list.'), true);
                return;
            }
            _activeSavedId = String(row.id);
            _activeSavedName = row.name || name;
            refreshSavedLibrary();
            setStatus(trRepl('patient.adv.savedOk', { NAME: row.name || name, N: ids.length },
                'Saved “{NAME}” ({N}). Re-open anytime from Saved filter results.'), false);
            if (opts.transferAfter) {
                transferToBroadcast(row.id);
            }
        }

        if (_activeSavedId && _activeSavedName &&
            String(_activeSavedName).toLowerCase() === name.toLowerCase() &&
            typeof MASSBC !== 'undefined' && typeof MASSBC.updateListPatientIds === 'function') {
            Promise.resolve(MASSBC.updateListPatientIds(_activeSavedId, ids, cond)).then(doneOk);
            return;
        }
        if (typeof MASSBC !== 'undefined' && typeof MASSBC.saveListFromPatientIds === 'function') {
            Promise.resolve(MASSBC.saveListFromPatientIds(name, ids, cond)).then(doneOk);
            return;
        }
        if (typeof SB === 'undefined' || !SB.from) {
            setStatus(tr('patient.adv.noSb', 'Supabase unavailable.'), true);
            return;
        }
        SB.from('broadcast_contact_lists').insert([{
            name: name,
            patient_ids: ids,
            conditions: cond
        }]).select('id,name').single().then(function (r) {
            if (r.error) {
                setStatus(String(r.error.message || r.error), true);
                return;
            }
            doneOk(r.data);
        });
    }

    /** @deprecated name kept for any external callers */
    function saveToBroadcast() {
        saveResultList({ transferAfter: false });
    }

    function setChipGroup(containerSel, attr, value) {
        var root = document.querySelector(containerSel);
        if (!root) return;
        root.querySelectorAll('.patient-adv-chip').forEach(function (btn) {
            var v = btn.getAttribute(attr) || '';
            btn.classList.toggle('is-active', v === value);
        });
    }

    function clearFilters() {
        setChipGroup('#patientAdvAgeBtns', 'data-adv-age', 'all');
        setChipGroup('#patientAdvSexBtns', 'data-adv-sex', 'all');
        if (g('patientAdvBday')) g('patientAdvBday').value = '';
        if (g('patientAdvDistrict')) g('patientAdvDistrict').value = '';
        if (g('patientAdvNotes')) g('patientAdvNotes').value = '';
        if (g('patientAdvScaling')) g('patientAdvScaling').value = '';
        TREAT_DEFS.forEach(function (d) {
            var cb = g('patientAdvTreat_' + d.key);
            if (cb) cb.checked = false;
        });
        if (g('patientAdvHasUnpaid')) g('patientAdvHasUnpaid').checked = false;
        if (g('patientAdvSpendSlider')) g('patientAdvSpendSlider').value = '0';
        if (g('patientAdvStaleBal')) g('patientAdvStaleBal').value = '';
        if (g('patientAdvInstallSlider')) g('patientAdvInstallSlider').value = '0';
        syncSpendLabel();
        syncInstallLabel();
        _results = [];
        _selected = Object.create(null);
        _page = 0;
        _lastConditions = null;
        _activeSavedId = '';
        _activeSavedName = '';
        var wrap = g('patientAdvResults');
        if (wrap) wrap.hidden = true;
        setStatus('', false);
        renderSavedLibrary();
        if (typeof clearPatientDirAdvancedFilter === 'function') {
            clearPatientDirAdvancedFilter({ force: true });
        }
    }

    function syncToggleButtons() {
        var btn = g('patientAdvSearchBtn');
        if (btn) btn.classList.toggle('is-active', _open);
    }

    function ensureDom() {
        var toolbar = document.querySelector('#patientViewDirectory .patient-dir-toolbar');
        if (toolbar && !g('patientAdvSearchBtn')) {
            var b = document.createElement('button');
            b.type = 'button';
            b.id = 'patientAdvSearchBtn';
            b.className = 'patient-adv-toggle-btn';
            b.textContent = tr('patient.adv.toggle', 'Advanced search');
            toolbar.appendChild(b);
        }
        // Remove legacy header duplicate if present (keep only search-toolbar control)
        var btnH = g('patientAdvSearchBtnHeader');
        if (btnH && btnH.parentNode) btnH.parentNode.removeChild(btnH);
        var dir = g('patientViewDirectory');
        if (dir && !g('patientAdvPanel') && toolbar) {
            var panel = document.createElement('div');
            panel.id = 'patientAdvPanel';
            panel.className = 'patient-adv-panel';
            panel.hidden = true;
            panel.innerHTML =
                '<div class="patient-adv-panel-head">' +
                '<strong>' + esc(tr('patient.adv.title', 'Advanced search')) + '</strong>' +
                '<button type="button" id="patientAdvCloseBtn" class="patient-adv-link-btn">' +
                esc(tr('patient.adv.close', 'Close')) + '</button></div>' +
                '<div class="patient-adv-grid">' +
                '<div class="patient-adv-field"><div class="patient-adv-label">' +
                esc(tr('patient.adv.age', 'Age group')) + '</div>' +
                '<div id="patientAdvAgeBtns" class="patient-adv-chips">' +
                '<button type="button" class="patient-adv-chip is-active" data-adv-age="all">' +
                esc(tr('patient.adv.age.all', 'All')) + '</button>' +
                '<button type="button" class="patient-adv-chip" data-adv-age="child">' +
                esc(tr('patient.adv.age.child', 'Under 12')) + '</button>' +
                '<button type="button" class="patient-adv-chip" data-adv-age="adult">' +
                esc(tr('patient.adv.age.adult', 'Ages 12–65')) + '</button>' +
                '<button type="button" class="patient-adv-chip" data-adv-age="senior">' +
                esc(tr('patient.adv.age.senior', 'Over 65')) + '</button></div></div>' +
                '<div class="patient-adv-field"><div class="patient-adv-label">' +
                esc(tr('patient.adv.sex', 'Sex')) + '</div>' +
                '<div id="patientAdvSexBtns" class="patient-adv-chips">' +
                '<button type="button" class="patient-adv-chip is-active" data-adv-sex="all">' +
                esc(tr('patient.adv.sex.all', 'All')) + '</button>' +
                '<button type="button" class="patient-adv-chip" data-adv-sex="male">' +
                esc(tr('patient.adv.sex.male', 'Male')) + '</button>' +
                '<button type="button" class="patient-adv-chip" data-adv-sex="female">' +
                esc(tr('patient.adv.sex.female', 'Female')) + '</button></div></div>' +
                '<div class="patient-adv-field"><label class="patient-adv-label" for="patientAdvBday">' +
                esc(tr('patient.adv.birthday', 'Birthday')) + '</label>' +
                '<select id="patientAdvBday" class="patient-adv-select">' +
                '<option value="">' + esc(tr('patient.adv.birthday.any', 'Any')) + '</option>' +
                '<option value="coming">' + esc(tr('patient.adv.birthday.coming', 'Coming month')) + '</option>' +
                '<option value="01">Jan</option><option value="02">Feb</option><option value="03">Mar</option>' +
                '<option value="04">Apr</option><option value="05">May</option><option value="06">Jun</option>' +
                '<option value="07">Jul</option><option value="08">Aug</option><option value="09">Sep</option>' +
                '<option value="10">Oct</option><option value="11">Nov</option><option value="12">Dec</option>' +
                '</select></div>' +
                '<div class="patient-adv-field"><label class="patient-adv-label" for="patientAdvDistrict">' +
                esc(tr('patient.adv.district', 'Living district')) + '</label>' +
                '<select id="patientAdvDistrict" class="patient-adv-select">' +
                '<option value="">' + esc(tr('patient.adv.district.any', 'Any')) + '</option></select></div>' +
                '<div class="patient-adv-field"><label class="patient-adv-label" for="patientAdvNotes">' +
                esc(tr('patient.adv.notes', 'Last treatment notes')) + '</label>' +
                '<select id="patientAdvNotes" class="patient-adv-select">' +
                '<option value="">' + esc(tr('patient.adv.notes.any', 'Any')) + '</option>' +
                '<option value="1">' + esc(tr('patient.adv.notes.1y', 'More than 1 year ago')) + '</option>' +
                '<option value="2">' + esc(tr('patient.adv.notes.2y', 'More than 2 years ago')) + '</option>' +
                '<option value="3">' + esc(tr('patient.adv.notes.3y', 'More than 3 years ago')) + '</option>' +
                '<option value="5">' + esc(tr('patient.adv.notes.5y', 'More than 5 years ago')) + '</option>' +
                '</select></div>' +
                '<div class="patient-adv-field"><label class="patient-adv-label" for="patientAdvScaling">' +
                esc(tr('patient.adv.scaling', 'Last scaling')) + '</label>' +
                '<select id="patientAdvScaling" class="patient-adv-select">' +
                '<option value="">' + esc(tr('patient.adv.scaling.any', 'Any')) + '</option>' +
                '<option value="6">' + esc(tr('patient.adv.scaling.6m', 'More than 6 months ago')) + '</option>' +
                '<option value="9">' + esc(tr('patient.adv.scaling.9m', 'More than 9 months ago')) + '</option>' +
                '<option value="12">' + esc(tr('patient.adv.scaling.12m', 'More than 12 months ago')) + '</option>' +
                '</select></div>' +
                '<div class="patient-adv-field patient-adv-field-wide"><div class="patient-adv-label">' +
                esc(tr('patient.adv.treatments', 'Treatment received')) + '</div><div class="patient-adv-treats">' +
                TREAT_DEFS.map(function (d) {
                    return '<label><input type="checkbox" id="patientAdvTreat_' + d.key + '"> <span>' +
                        esc(tr(d.labelKey, d.label)) + '</span></label>';
                }).join('') +
                '</div></div>' +
                spendHtmlBlock() +
                installHtmlBlock() +
                '</div>' +
                '<div class="patient-adv-actions">' +
                '<button type="button" id="patientAdvRunBtn" class="patient-adv-primary-btn">' +
                esc(tr('patient.adv.run', 'Search')) + '</button>' +
                '<button type="button" id="patientAdvClearBtn" class="patient-adv-link-btn">' +
                esc(tr('patient.adv.clear', 'Clear')) + '</button>' +
                '<span id="patientAdvStatus" class="patient-adv-status"></span></div>';
            toolbar.parentNode.insertBefore(panel, toolbar.nextSibling);
        }
        ensureSpendFields();
        ensureInstallFields();
        ensureDistrictField();
        ensureTreatCheckboxes();
        if (dir && !g('patientAdvResults')) {
            var res = document.createElement('div');
            res.id = 'patientAdvResults';
            res.className = 'patient-adv-results';
            res.hidden = true;
            res.innerHTML =
                '<div class="patient-adv-results-bar">' +
                '<div id="patientAdvResultMeta" class="patient-adv-result-meta"></div>' +
                '<div class="patient-adv-results-actions">' +
                '<button type="button" id="patientAdvSelPage" class="patient-adv-link-btn">' +
                esc(tr('patient.adv.selPage', 'Select page')) + '</button>' +
                '<button type="button" id="patientAdvSelAll" class="patient-adv-link-btn">' +
                esc(tr('patient.adv.selAll', 'Select all')) + '</button>' +
                '<button type="button" id="patientAdvSelNone" class="patient-adv-link-btn">' +
                esc(tr('patient.adv.selNone', 'Clear selection')) + '</button>' +
                '<button type="button" id="patientAdvPrev" class="patient-dir-page-btn">' +
                esc(tr('patient.page.prev', 'Prev')) + '</button>' +
                '<button type="button" id="patientAdvNext" class="patient-dir-page-btn">' +
                esc(tr('patient.page.next', 'Next')) + '</button>' +
                '<button type="button" id="patientAdvSaveResult" class="patient-adv-primary-btn">' +
                esc(tr('patient.adv.saveResult', 'Save result')) + '</button>' +
                '<button type="button" id="patientAdvTransferBroadcast" class="patient-adv-primary-btn patient-adv-transfer-btn">' +
                esc(tr('patient.adv.transferBroadcast', 'Transfer to Broadcast')) + '</button>' +
                '</div></div>' +
                '<table class="patient-adv-result-table"><thead><tr>' +
                '<th></th><th>No.</th><th>Name</th><th>Phone</th><th>Clinic</th><th>DOB</th>' +
                '</tr></thead><tbody id="patientAdvResultBody"></tbody></table>';
            var after = g('patientAdvPanel') || toolbar;
            if (after && after.parentNode) {
                after.parentNode.insertBefore(res, after.nextSibling);
            }
        }
    }

    function togglePanel(force) {
        ensureDom();
        ensureSavedLibraryDom();
        ensureDistrictField();
        ensureTreatCheckboxes();
        ensureInstallFields();
        _open = force != null ? !!force : !_open;
        var panel = g('patientAdvPanel');
        if (panel) panel.hidden = !_open;
        var saved = g('patientAdvSaved');
        if (saved) saved.hidden = !_open;
        syncToggleButtons();
        if (!_open) {
            var wrap = g('patientAdvResults');
            if (wrap && !_results.length) wrap.hidden = true;
        } else {
            if (typeof applyI18nInRoot === 'function' && panel) {
                applyI18nInRoot(panel);
            }
            if (typeof applyI18nInRoot === 'function' && saved) applyI18nInRoot(saved);
            refreshSavedLibrary();
        }
    }

    function bindOnce() {
        if (_bound) return;
        ensureDom();
        _bound = true;
        function onToggleClick(ev) {
            ev.preventDefault();
            togglePanel();
        }
        var btn = g('patientAdvSearchBtn');
        if (btn && !btn._advBound) {
            btn._advBound = true;
            btn.addEventListener('click', onToggleClick);
        }
        var root = g('patientAdvPanel');
        if (!root) return;
        ensureSpendFields();
        ensureInstallFields();
        var slider = g('patientAdvSpendSlider');
        if (slider && !slider._advBound) {
            slider._advBound = true;
            slider.addEventListener('input', syncSpendLabel);
            slider.addEventListener('change', syncSpendLabel);
        }
        syncSpendLabel();
        bindInstallSlider();
        root.addEventListener('click', function (ev) {
            var age = ev.target && ev.target.closest ? ev.target.closest('[data-adv-age]') : null;
            if (age) {
                setChipGroup('#patientAdvAgeBtns', 'data-adv-age', age.getAttribute('data-adv-age') || 'all');
                return;
            }
            var sex = ev.target && ev.target.closest ? ev.target.closest('[data-adv-sex]') : null;
            if (sex) {
                setChipGroup('#patientAdvSexBtns', 'data-adv-sex', sex.getAttribute('data-adv-sex') || 'all');
                return;
            }
            var t = ev.target;
            if (t && t.id === 'patientAdvRunBtn') { runSearch(); return; }
            if (t && t.id === 'patientAdvClearBtn') { clearFilters(); return; }
            if (t && t.id === 'patientAdvCloseBtn') { togglePanel(false); return; }
        });
        var results = g('patientAdvResults');
        if (results) {
            // Migrate old single "Save to Broadcast" button if present
            var oldSave = g('patientAdvSaveBroadcast');
            if (oldSave && !g('patientAdvSaveResult')) {
                oldSave.id = 'patientAdvSaveResult';
                oldSave.textContent = tr('patient.adv.saveResult', 'Save result');
                oldSave.setAttribute('data-i18n', 'patient.adv.saveResult');
            }
            if (!g('patientAdvTransferBroadcast') && results.querySelector('.patient-adv-results-actions')) {
                var tb = document.createElement('button');
                tb.type = 'button';
                tb.id = 'patientAdvTransferBroadcast';
                tb.className = 'patient-adv-primary-btn patient-adv-transfer-btn';
                tb.textContent = tr('patient.adv.transferBroadcast', 'Transfer to Broadcast');
                results.querySelector('.patient-adv-results-actions').appendChild(tb);
            }
            results.addEventListener('change', function (ev) {
                var t = ev.target;
                if (t && t.classList && t.classList.contains('patient-adv-cb')) {
                    var id = t.getAttribute('data-id');
                    if (t.checked) _selected[id] = true;
                    else delete _selected[id];
                    renderResults();
                }
            });
            results.addEventListener('click', function (ev) {
                var t = ev.target;
                if (!t) return;
                if (t.id === 'patientAdvSelPage') { selectPage(true); return; }
                if (t.id === 'patientAdvSelAll') { selectAllResults(true); return; }
                if (t.id === 'patientAdvSelNone') { selectAllResults(false); return; }
                if (t.id === 'patientAdvSaveBroadcast' || t.id === 'patientAdvSaveResult') {
                    saveResultList();
                    return;
                }
                if (t.id === 'patientAdvTransferBroadcast') {
                    transferToBroadcast();
                    return;
                }
                if (t.id === 'patientAdvPrev') { changeAdvPage(-1); return; }
                if (t.id === 'patientAdvNext') { changeAdvPage(1); return; }
                var row = t.closest ? t.closest('tr[data-adv-id]') : null;
                if (row && !(t.classList && t.classList.contains('patient-adv-cb'))) {
                    var pid = row.getAttribute('data-adv-id');
                    var match = null;
                    for (var i = 0; i < _results.length; i++) {
                        if (String(_results[i].id) === String(pid)) { match = _results[i]; break; }
                    }
                    if (match && typeof setDirectoryActivePatient === 'function') {
                        setDirectoryActivePatient(match, 'patient-adv-result');
                        renderResults();
                    }
                }
            });
        }
        ensureSavedLibraryDom();
        var savedHost = g('patientAdvSaved');
        if (savedHost && !savedHost._advBound) {
            savedHost._advBound = true;
            savedHost.addEventListener('click', function (ev) {
                var t = ev.target;
                if (!t) return;
                if (t.id === 'patientAdvSavedRefresh') {
                    refreshSavedLibrary();
                    return;
                }
                var actBtn = t.closest ? t.closest('[data-adv-saved-act]') : null;
                if (!actBtn) return;
                var act = actBtn.getAttribute('data-adv-saved-act');
                var sid = actBtn.getAttribute('data-id');
                if (act === 'open') openSavedList(sid);
                else if (act === 'rename') renameSavedList(sid);
                else if (act === 'update') {
                    _activeSavedId = String(sid || '');
                    updateSavedList(sid);
                } else if (act === 'transfer') transferToBroadcast(sid);
                else if (act === 'delete') deleteSavedList(sid);
            });
        }
        refreshSavedLibrary();
    }

    function init() {
        bindOnce();
        // Re-ensure after patient module paints (handles late DOM / view switches)
        setTimeout(function () {
            ensureDom();
            if (!_bound) bindOnce();
            else {
                var btn = g('patientAdvSearchBtn');
                if (btn && !btn._advBound) {
                    btn._advBound = true;
                    btn.addEventListener('click', function (ev) {
                        ev.preventDefault();
                        togglePanel();
                    });
                }
            }
        }, 800);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.PatientAdvancedSearch = {
        init: init,
        open: function () { togglePanel(true); },
        close: function () { togglePanel(false); },
        run: runSearch,
        syncPageFromDirectory: syncPageFromDirectory,
        onDirectoryLiveSearch: onDirectoryLiveSearch,
        getResults: function () { return _results.slice(); }
    };
})();
