// ════════════════════════════════════════════════════════════════
// AI PATIENT ASSISTANT — roster filters, checklist, templates, drafts
// ════════════════════════════════════════════════════════════════

var AIHELPER = AIHELPER || {};

(function(ns) {

    var LS_PROXY_URL = 'joyful_ai_proxy_url';
    var SS_PROXY_AUTH = 'joyful_ai_proxy_auth_session';

    var _patientsCache = [];

    /** last rendered lists (ids in display order) */
    var _listBirth = [];
    var _listRecall = [];

    var _checksBirth = Object.create(null);
    var _checksRecall = Object.create(null);

    var DISTRICTS = [
        { code: '', labelKey: 'ai.district.any', needles: [] },
        { code: 'central_western', labelKey: 'ai.district.centralWestern',
            needles: ['central', 'western', 'sheung wan', 'sai wan'] },
        { code: 'wanchai', labelKey: 'ai.district.wanchai',
            needles: ['wan chai', 'causeway bay', 'tin hau'] },
        { code: 'eastern', labelKey: 'ai.district.eastern',
            needles: ['north point', 'eastern', 'quarry bay'] },
        { code: 'southern', labelKey: 'ai.district.southern',
            needles: ['aberdeen', 'stanley', 'repulse bay', 'south'] },
        { code: 'yautsimmong', labelKey: 'ai.district.yauTsimMong',
            needles: ['yau ma tei', 'tsim sha tsui', 'mong kok'] },
        { code: 'shamshuipo', labelKey: 'ai.district.shamShuiPo',
            needles: ['sham shui po', 'cheung sha wan', 'yau mai tei'] },
        { code: 'klncity', labelKey: 'ai.district.kowloonCity',
            needles: ['kowloon city', 'hung hom', 'kowloon tong'] },
        { code: 'wongtaisin', labelKey: 'ai.district.wongTaiSin',
            needles: ['wong tai sin', 'lung cheung'] },
        { code: 'kwuntong', labelKey: 'ai.district.kwunTong',
            needles: ['kwun tong', 'ngau tau kok', 'lai chi kok bay'] },
        { code: 'tuenmun', labelKey: 'ai.district.tuenMun',
            needles: ['tuen mun'] },
        { code: 'yuenlong', labelKey: 'ai.district.yuenLong',
            needles: ['yuen long'] },
        { code: 'tsuenwan', labelKey: 'ai.district.tsuenWan',
            needles: ['tsuen wan'] },
        { code: 'kwaising', labelKey: 'ai.district.kwaiTsing',
            needles: ['kwai chung', 'tsing yi'] },
        { code: 'north', labelKey: 'ai.district.northNt',
            needles: ['fanling', 'sheung shui', 'north nt'] },
        { code: 'tupo', labelKey: 'ai.district.taiPo',
            needles: ['tai po'] },
        { code: 'shatin', labelKey: 'ai.district.shaTin',
            needles: ['sha tin', 'fo tan', 'ma on shan'] },
        { code: 'saikung', labelKey: 'ai.district.saiKung',
            needles: ['sai kung', 'tseung kwan o'] },
        { code: 'islands', labelKey: 'ai.district.islands',
            needles: ['lantau', 'lantau island', 'tung chung', 'ching'] }
    ];

    var SMART_BIRTH = {
        festive_offerspot: '[Staff note] Occasion warm birthday greeting with space for promo.\nAdd at end: Mention March hygiene weekday slots if booked before month-end.\nTone: Celebrate patient loyalty; HK English.\nPatient first name: {{first}}',
        sms_short_sweet: '[Format] Two short paragraphs max (~320 chars).\nHappy birthday {{first}} from {{clinic}}—thank you for trusting us.\nTiny invite to ping us for preventive care scheduling.\n',
        bilingual_hint: '{{first}}, warm birthday wishes.\n(Optional second line zh-HK cue if bilingual)\nWarmly,\n{{clinic}} Team',
        long_email: '{{first}},\nWe hope your special day overflows with smiles and comfort.\nWe appreciate your loyalty to {{clinic}}.\nIf you\'d ever like weekday hygiene timings, reception can quietly suggest options.\n\nKind regards,\n{{clinic}}'
    };

    var SMART_RECALL = {
        hygiene_standard: '{{first}}, gentle reminder preventive hygiene helps protect gums enamel long term {{clinic}} happy reserve calm slot Tuesdays Thursdays afternoons if helpful.\nTone: reassuring no pressure HK English.',
        treatment_followup: '{{first}}, checking kindly if ready continue planned treatment steps—we move at pace comfortable explain anything unclear anytime {{clinic}}.',
        sms_nudge_narrow: '{{first}}, quick polite nudge hygienist visit overdue friendly reply reschedule {{clinic}} thanks.',
        postop_comfort: '{{first}}, wellbeing check recent visit—tell us settles comfortably—we stand by anytime {{clinic}}.'
    };

    var BIRTH_TEMPLATE_SLUGS = [
        'festive_offerspot', 'sms_short_sweet', 'bilingual_hint', 'long_email'
    ];
    var RECALL_TEMPLATE_SLUGS = [
        'hygiene_standard', 'treatment_followup', 'sms_nudge_narrow', 'postop_comfort'
    ];

    function aiTemplateLabel(slug, kind) {
        var key = 'ai.template.' + kind + '.' + slug + '.label';
        var s = aiTr(key);
        if (s !== key) return s;
        return slug.replace(/_/g, ' ').replace(/^./, function(c) {
            return c.toUpperCase();
        });
    }

    function aiTemplateBody(slug, kind, fallbackMap) {
        var key = 'ai.template.' + kind + '.' + slug + '.body';
        var s = aiTr(key);
        if (s !== key) return s;
        return fallbackMap && fallbackMap[slug] ? fallbackMap[slug] : '';
    }

    function firstName(full) {
        var s = String(full || '').trim();
        if (!s) return aiTr('ai.name.there');
        return s.split(/\s+/)[0] || aiTr('ai.name.there');
    }

    function sexLabel(raw) {
        if (raw === 'M') return aiTr('ai.sex.male');
        if (raw === 'F') return aiTr('ai.sex.female');
        return '';
    }

    function normPhoneDig(p) {
        return String(p || '').replace(/\D/g, '');
    }

    function normalizePhoneWa(raw) {
        var d = normPhoneDig(raw);
        if (d.length >= 11 && d.slice(0, 3) === '852') return d;
        if (d.length === 8 && /^[569]/.test(d)) return '852' + d;
        if (d.length >= 10) return d;
        return d;
    }

    function clinicTitle() {
        return (typeof currentClinicLabel === 'string' && currentClinicLabel.trim())
            ? currentClinicLabel.trim()
            : aiTr('ai.clinicFallback');
    }

    function pick(elId) {
        var e = typeof g !== 'undefined' ? g(elId) : document.getElementById(elId);
        return e;
    }

    function aiTr(key) {
        return typeof t === 'function' ? t(key) : key;
    }

    function aiTrRepl(key, pairs) {
        var s = aiTr(key);
        if (pairs) {
            Object.keys(pairs).forEach(function(k) {
                s = s.split('{' + k + '}').join(String(pairs[k]));
            });
        }
        return s;
    }

    var BIRTH_DEMO_META = {
        warm_professional: { slug: 'warmProf', count: 3 },
        festive_light: { slug: 'festive', count: 2 },
        minimal_modern: { slug: 'minimal', count: 2 }
    };

    var RECALL_KIND_SLUG = {
        checkup: 'checkup',
        incomplete_tx: 'incompleteTx',
        review_followup: 'reviewFollowup',
        custom: 'custom'
    };

    var RECALL_TONE_SLUG = {
        warm_professional: 'warmProf',
        gentle_reminder: 'gentle',
        concise_busy: 'concise'
    };

    function aiDemoText(key, fallback) {
        var s = aiTr(key);
        return s !== key ? s : (fallback || '');
    }

    function aiDemoBirthLines(tone) {
        var meta = BIRTH_DEMO_META[tone] || BIRTH_DEMO_META.warm_professional;
        var out = [];
        var i;
        for (i = 0; i < meta.count; i++) {
            var key = 'ai.demo.birth.' + meta.slug + '.' + i;
            var fb = BIRTH_LINES[tone] && BIRTH_LINES[tone][i]
                ? BIRTH_LINES[tone][i] : '';
            var line = aiDemoText(key, fb);
            if (line) out.push(line);
        }
        return out.length ? out : BIRTH_LINES.warm_professional;
    }

    function aiDemoRecallParts(recallKind, tone) {
        var kind = RECALL_KIND_SLUG[recallKind] || 'checkup';
        var ton = RECALL_TONE_SLUG[tone] || 'warmProf';
        var bank = RECALL_LINES[recallKind] || RECALL_LINES.checkup;
        var toneBank = bank[tone] || bank.warm_professional;
        var parts = [];
        var j;
        for (j = 0; j < 2; j++) {
            var key = 'ai.demo.recall.' + kind + '.' + ton + '.' + j;
            var fb = toneBank[j] || '';
            var line = aiDemoText(key, fb);
            if (line) parts.push(line);
        }
        return parts;
    }

    function setStatus(which, txt) {
        var id = which === 'birth' ? 'aiGenStatusBirth' : 'aiGenStatusRecall';
        var sp = pick(id);
        if (sp) sp.textContent = txt || '';
    }

    /** Age in completed years today (TZ local). */
    function ageYears(dobIso) {
        if (!dobIso) return NaN;
        var p = String(dobIso).split('-').map(Number);
        if (p.length < 3 || !p[1] || !p[2]) return NaN;
        var dob = new Date(p[0], p[1] - 1, p[2]);
        if (isNaN(+dob)) return NaN;
        var td = new Date();
        var a = td.getFullYear() - dob.getFullYear();
        var m = td.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && td.getDate() < dob.getDate())) a--;
        return a;
    }

    function fmtMd(isoDob) {
        if (!isoDob || String(isoDob).split('-').length < 3) return '';
        var x = isoDob.split('-');
        return pad2(x[2]) + '/' + pad2(x[1]);
    }

    function pad2(n) { return String(n).padStart(2, '0'); }

    function daysUntilBirthday(md, fromD) {
        if (!md) return 9999;
        var p = md.split('-');
        if (p.length < 3) return 9999;
        var bm = parseInt(p[1], 10);
        var bd = parseInt(p[2], 10);
        if (!bm || !bd) return 9999;
        var y = fromD.getFullYear();
        var next = new Date(y, bm - 1, bd);
        if (next < fromD) next = new Date(y + 1, bm - 1, bd);
        return Math.ceil((next - fromD) / 86400000);
    }

    function districtMatch(addr, code) {
        if (!code) return true;
        var row = DISTRICTS.find(function(d) { return d.code === code; });
        if (!row || !row.needles.length) return true;
        var ax = String(addr || '').toLowerCase();
        for (var i = 0; i < row.needles.length; i++) {
            if (ax.indexOf(row.needles[i]) >= 0) return true;
        }
        return false;
    }

    var _districtInited = false;
    function refreshDistrictSelects() {
        ['aiBirthDistrict', 'aiRecallDistrict'].forEach(function(id) {
            var s = pick(id);
            if (!s) return;
            var cur = s.value;
            s.innerHTML = '';
            DISTRICTS.forEach(function(d) {
                var o = document.createElement('option');
                o.value = d.code;
                o.textContent = aiTr(d.labelKey);
                s.appendChild(o);
            });
            s.value = cur;
        });
    }
    function initDistrictSelectsOnce() {
        if (_districtInited) return;
        _districtInited = true;
        refreshDistrictSelects();
    }

    function fillTemplatesBirth() {
        var sel = pick('aiBirthTemplate');
        if (!sel) return;
        sel.innerHTML = '';
        var z = document.createElement('option');
        z.value = '';
        z.textContent = aiTr('ai.template.choose');
        sel.appendChild(z);
        BIRTH_TEMPLATE_SLUGS.forEach(function(k) {
            var o = document.createElement('option');
            o.value = k;
            o.textContent = aiTemplateLabel(k, 'birth');
            sel.appendChild(o);
        });
        if (sel.options.length > 1) sel.selectedIndex = 1;
    }

    function fillTemplatesRecall() {
        var sel = pick('aiRecallTemplate');
        if (!sel) return;
        sel.innerHTML = '';
        var z = document.createElement('option');
        z.value = '';
        z.textContent = aiTr('ai.template.choose');
        sel.appendChild(z);
        RECALL_TEMPLATE_SLUGS.forEach(function(k) {
            var o = document.createElement('option');
            o.value = k;
            o.textContent = aiTemplateLabel(k, 'recall');
            sel.appendChild(o);
        });
        if (sel.options.length > 1) sel.selectedIndex = 1;
    }

    ns.onBirthTemplateChange = function() {
        var sel = pick('aiBirthTemplate');
        var ta = pick('aiBirthSmartBody');
        if (!sel || !ta) return;
        var slug = sel.value;
        ta.value = aiTemplateBody(slug, 'birth', SMART_BIRTH);
        scheduleSendTargetRefresh('birth');
    };

    ns.onRecallTemplateChange = function() {
        var sel = pick('aiRecallTemplate');
        var ta = pick('aiRecallSmartBody');
        if (!sel || !ta) return;
        var slug = sel.value;
        ta.value = aiTemplateBody(slug, 'recall', SMART_RECALL);
        scheduleSendTargetRefresh('recall');
    };

    /** Replace {{first}}, {{full}}, {{no}}, {{clinic}}, {{dob_dm}}, {{sex}} */
    function applyPlaceholders(tpl, p) {
        var fn = firstName(p.full_name);
        return String(tpl || '')
            .replace(/\{\{first\}\}/gi, fn)
            .replace(/\{\{full\}\}/gi, String(p.full_name || '').trim())
            .replace(/\{\{no\}\}/gi, String(p.patient_no || '').trim())
            .replace(/\{\{patient_no\}\}/gi, String(p.patient_no || '').trim())
            .replace(/\{\{clinic\}\}/gi, clinicTitle())
            .replace(/\{\{dob_dm\}\}/gi, fmtMd(p.dob))
            .replace(/\{\{sex\}\}/gi, sexLabel(p.sex || ''))
            ;
    }

    var BIRTH_LINES = {
        warm_professional: [
            'Wishing you a wonderful birthday filled with smiles.',
            'We hope this year keeps you confident and comfortable every day.',
            'Thank you for trusting us with your dental health — warm regards from everyone here.'
        ],
        festive_light: [
            '🎉 Happy Birthday! Celebrate with laughter and treats.',
            'We’re cheering for your healthiest, happiest smile year yet.'
        ],
        minimal_modern: [
            'Happy birthday from all of us.',
            'Warm wishes — here anytime for preventive care bookings.'
        ]
    };

    var RECALL_LINES = {
        checkup: {
            warm_professional:
                ['Preventive hygiene helps protect enamel long term.', 'We can whisper-book a calm hygienist slot.'],
            gentle_reminder:
                ['Friendly nudge for upcoming preventive timing.', 'No pressure — reply anytime.'],
            concise_busy:
                ['Time for preventive care.', 'SMS us for quick booking.']
        },
        incomplete_tx: {
            warm_professional:
                ['Thoughtful update on unfinished treatment—we’ll finish steps patiently.', 'Whenever ready.'],
            gentle_reminder:
                ['Continuing care avoids small issues layering—no hurry.', 'Ask questions anytime.'],
            concise_busy:
                ['Plan reminder concise.', 'Text when ready.']
        },
        review_followup: {
            warm_professional:
                ['Checking comfort after recent visit.', 'Tell us if anything unfamiliar.'],
            gentle_reminder:
                ['Comfort check—reply if sensations odd.', 'We’re reachable.'],
            concise_busy:
                ['Post-op check quick.', 'Reply if concern.']
        },
        custom: {
            warm_professional: ['Courteous reminder outreach from ', ''],
            gentle_reminder: ['Gentle follow-up ', ''],
            concise_busy: ['Note from ', '']
        }
    };

    function weaveExtra(userPrompt) {
        var u = (userPrompt || '').trim();
        if (!u) return '';
        return '\n\n' + u + '\n';
    }

    function demoBirthday(first, tone, userPrompt, clinic) {
        var lines = aiDemoBirthLines(tone);
        var pickLine = lines[Math.floor(Math.random() * lines.length)];
        return aiTrRepl('ai.demo.letter.dear', { NAME: first }) + '\n\n' +
            aiTrRepl('ai.demo.letter.happyBirth', { CLINIC: clinic }) + '\n\n' +
            pickLine + '\n' +
            weaveExtra(userPrompt) +
            aiTr('ai.demo.letter.withCare') + '\n' +
            clinic;
    }

    function demoRecall(first, tone, recallKind, userPrompt, clinic) {
        var parts = aiDemoRecallParts(recallKind, tone);
        var open;
        if (recallKind === 'custom') {
            open = (parts[0] || '') + clinic + '.';
        } else {
            open = parts.join(' ');
        }
        var closing =
            weaveExtra(userPrompt) +
            aiTr('ai.demo.letter.kindRegards') + '\n' +
            clinic;
        return aiTrRepl('ai.demo.letter.dear', { NAME: first }) + '\n\n' +
            open + '\n\n' + closing;
    }

    function patientRowById(pid) {
        return _patientsCache.find(function(p) {
            return p.id === pid;
        }) || null;
    }

    function filterPatients(kind) {
        var ageMinRaw = trimmedVal(kind === 'birth' ? 'aiBirthAgeMin' : 'aiRecallAgeMin');
        var ageMaxRaw = trimmedVal(kind === 'birth' ? 'aiBirthAgeMax' : 'aiRecallAgeMax');
        var sexSel = trimmedVal(kind === 'birth' ? 'aiBirthSex' : 'aiRecallSex');
        var dc = trimmedVal(kind === 'birth' ? 'aiBirthDistrict' : 'aiRecallDistrict');
        var clinicSel = trimmedVal(kind === 'birth' ? 'aiBirthClinicFilter' : 'aiRecallClinicFilter');
        var upcoming = kind === 'birth' && pick('aiBirthUpcomingOnly') &&
            pick('aiBirthUpcomingOnly').checked;
        var reqPhoneRecall = kind === 'recall' && pick('aiRecallRequirePhone') &&
            pick('aiRecallRequirePhone').checked;

        var ageMin = ageMinRaw === '' ? NaN : parseInt(ageMinRaw, 10);
        var ageMax = ageMaxRaw === '' ? NaN : parseInt(ageMaxRaw, 10);

        var today = new Date();
        today.setHours(0, 0, 0, 0);

        return _patientsCache.filter(function(p) {
            var a = ageYears(p.dob);
            if (!isNaN(ageMin) && (isNaN(a) || a < ageMin)) return false;
            if (!isNaN(ageMax) && (isNaN(a) || a > ageMax)) return false;

            if (sexSel === 'M' || sexSel === 'F') {
                if ((p.sex || '') !== sexSel) return false;
            }

            if (!districtMatch(p.address, dc)) return false;

            if (clinicSel && String(p.clinic_tag || '') !== clinicSel) return false;

            if (upcoming && (!p.dob || daysUntilBirthday(p.dob, today) > 60)) return false;

            if (reqPhoneRecall && normPhoneDig(p.phone_number).length < 8) return false;

            return true;
        });
    }

    function renderPickList(which) {
        var list = filterPatients(which);
        if (which === 'birth') _listBirth = list; else _listRecall = list;
        var hostId = which === 'birth' ? 'aiBirthPickList' : 'aiRecallPickList';
        var host = pick(hostId);
        var checks = which === 'birth' ? _checksBirth : _checksRecall;
        if (!host) return;

        host.innerHTML = '';
        if (!list.length) {
            host.innerHTML =
                '<div class="ai-empty-note">' + esc(aiTr('ai.emptyFilter')) + '</div>';
            var mc = pick(which === 'birth'
                ? 'aiBirthCbMaster'
                : 'aiRecallCbMaster');
            if (mc) {
                mc.checked = false;
                mc.indeterminate = false;
            }
            scheduleSendTargetRefresh(which);
            var countZ = pick(which === 'birth'
                ? 'aiBirthFilterCount'
                : 'aiRecallFilterCount');
            if (countZ) countZ.textContent = '0';
            return;
        }
        list.forEach(function(p) {
            var row = document.createElement('label');
            row.className = 'ai-patient-row';

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.dataset.pid = p.id;
            cb.checked = !!checks[p.id];
            cb.addEventListener('change', function() {
                checks[p.id] = cb.checked;
                scheduleSendTargetRefresh(which);
                syncMasterCheck(which);
            });

            var a = ageYears(p.dob);
            var ageShow = !isNaN(a) ? a + 'y' : '—';
            var meta = '#' + esc(String(p.patient_no || '?')) +
                ' · ' + ageShow +
                ' · ' + (p.sex === 'M' ? 'M' : p.sex === 'F' ? 'F' : '—');

            row.appendChild(cb);
            var txt = document.createElement('span');
            txt.innerHTML =
                '<span class="ai-patient-name">' + esc(String(p.full_name || '')) +
                '</span><span class="ai-patient-sn">' + meta + '</span>';
            row.appendChild(txt);
            host.appendChild(row);
        });

        syncMasterCheck(which);
        scheduleSendTargetRefresh(which);

        var countEl = pick(which === 'birth' ? 'aiBirthFilterCount' : 'aiRecallFilterCount');
        if (countEl) countEl.textContent = String(list.length);
    }

    function esc(t) {
        return String(t || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    function trimmedVal(id) {
        var el = pick(id);
        return el ? String(el.value || '').trim() : '';
    }

    ns.applyPatientFilter = function(which) {
        renderPickList(which);
    };

    ns.togglePickAllBirth = function() {
        var m = pick('aiBirthCbMaster');
        if (!m) return;
        toggleAllFiltered('birth', m.checked);
    };

    ns.togglePickAllRecall = function() {
        var m = pick('aiRecallCbMaster');
        if (!m) return;
        toggleAllFiltered('recall', m.checked);
    };

    ns.clearPickBirth = function() {
        toggleAllFiltered('birth', false);
        var m = pick('aiBirthCbMaster'); if (m) m.checked = false;
        syncMasterCheck('birth');
    };

    ns.clearPickRecall = function() {
        toggleAllFiltered('recall', false);
        var m = pick('aiRecallCbMaster'); if (m) m.checked = false;
        syncMasterCheck('recall');
    };

    function toggleAllFiltered(which, checked) {
        var list = which === 'birth' ? _listBirth : _listRecall;
        var checks = which === 'birth' ? _checksBirth : _checksRecall;
        list.forEach(function(p) {
            checks[p.id] = checked;
        });
        renderPickList(which);
    }

    function syncMasterCheck(which) {
        var list = which === 'birth' ? _listBirth : _listRecall;
        var checks = which === 'birth' ? _checksBirth : _checksRecall;
        var m = pick(which === 'birth' ? 'aiBirthCbMaster' : 'aiRecallCbMaster');
        if (!m || !list.length) return;
        var cnt = list.filter(function(p) {
            return checks[p.id]; }).length;
        m.checked = cnt === list.length;
        m.indeterminate = cnt > 0 && cnt < list.length;
    }

    ns.refreshPatients = function() {
        ns.init(true);
    };

    ns.init = function(silentReload) {
        initDistrictSelectsOnce();
        fillTemplatesBirth();
        fillTemplatesRecall();
        ns.onBirthTemplateChange();
        ns.onRecallTemplateChange();

        if (typeof SB === 'undefined') {
            setPatientBanner(aiTr('ai.banner.dataMissing'));
            return;
        }
        SB.from('patients').select('*').order('patient_no', { ascending: true })
            .then(function(r) {
                if (r.error) {
                    _patientsCache = [];
                    _listBirth = [];
                    _listRecall = [];
                    setPatientBanner(aiTr('ai.banner.rosterUnavailable'));
                } else {
                    _patientsCache = r.data || [];
                    var logged =
                        typeof currentUserId !== 'undefined' &&
                        currentUserId !== null &&
                        String(currentUserId).trim() !== '';
                    if (!_patientsCache.length && logged)
                        setPatientBanner(aiTr('ai.banner.noPatients'));
                    else if (!_patientsCache.length && !logged)
                        setPatientBanner(aiTr('ai.banner.guestPreview'));
                    else setPatientBanner('');
                    renderPickList('birth');
                    renderPickList('recall');
                }
                if (!silentReload) syncProxyInputs();
            });
    };

    function setPatientBanner(html) {
        var bn = pick('aiPatientLoadBanner');
        if (!bn) return;
        bn.textContent = html || '';
    }

    function refreshAiPatientBannerForLang() {
        if (typeof SB === 'undefined') {
            setPatientBanner(aiTr('ai.banner.dataMissing'));
            return;
        }
        if (!_patientsCache.length) {
            var logged =
                typeof currentUserId !== 'undefined' &&
                currentUserId !== null &&
                String(currentUserId).trim() !== '';
            if (logged) setPatientBanner(aiTr('ai.banner.noPatients'));
            else setPatientBanner(aiTr('ai.banner.guestPreview'));
        } else {
            setPatientBanner('');
        }
    }

    function syncProxyInputs() {
        var u = pick('aiProxyUrl');
        var a = pick('aiProxyAuth');
        try {
            if (u && localStorage.getItem(LS_PROXY_URL))
                u.value = localStorage.getItem(LS_PROXY_URL);
            if (a && sessionStorage.getItem(SS_PROXY_AUTH))
                a.value = sessionStorage.getItem(SS_PROXY_AUTH);
        } catch (e) {}
    }

    ns.saveProxySettings = function() {
        var urlEl = pick('aiProxyUrl');
        var auEl = pick('aiProxyAuth');
        try {
            if (urlEl) localStorage.setItem(LS_PROXY_URL, String(urlEl.value || '').trim());
            if (auEl) sessionStorage.setItem(SS_PROXY_AUTH, String(auEl.value || '').trim());
            alert(aiTr('ai.alert.settingsSaved'));
        } catch (err) {
            alert(aiTr('ai.alert.storageFail'));
        }
    };

    ns.clearProxySettings = function() {
        try {
            localStorage.removeItem(LS_PROXY_URL);
            sessionStorage.removeItem(SS_PROXY_AUTH);
        } catch (e) {}
        var u = pick('aiProxyUrl');
        var a = pick('aiProxyAuth');
        if (u) u.value = '';
        if (a) a.value = '';
    };

    function getProxyConf() {
        var url = '';
        var auth = '';
        try {
            url = (localStorage.getItem(LS_PROXY_URL) || '').trim();
            auth = (sessionStorage.getItem(SS_PROXY_AUTH) || '').trim();
        } catch (e) {}
        var uEl = pick('aiProxyUrl');
        if (!url && uEl && uEl.value) url = uEl.value.trim();
        var aEl = pick('aiProxyAuth');
        if (!auth && aEl && aEl.value) auth = aEl.value.trim();
        return { url: url, authHeader: auth };
    }

    var EDGE_FN = 'ai-patient-draft';

    function callerSnippet() {
        var uid =
            typeof currentUserId !== 'undefined' && currentUserId
                ? String(currentUserId).trim()
                : '';
        var cid =
            typeof currentClinicId !== 'undefined' && currentClinicId
                ? String(currentClinicId).trim()
                : '';
        return { callerUserId: uid, callerClinicId: cid };
    }

    function withCaller(basePayload) {
        var c = callerSnippet();
        var o = {};
        Object.keys(basePayload).forEach(function(k) {
            o[k] = basePayload[k];
        });
        o.callerUserId = c.callerUserId;
        o.callerClinicId = c.callerClinicId;
        return o;
    }

    function invokeSupabaseEdge(fullPayload) {
        if (typeof SB === 'undefined' || !SB.functions ||
            typeof SB.functions.invoke !== 'function') {
            return Promise.reject(new Error('no_functions'));
        }
        return SB.functions.invoke(EDGE_FN, { body: fullPayload }).then(function(res) {
            var errRes = res.error;
            var data = res.data;
            if (errRes) throw errRes;
            if (data && typeof data.message === 'string') {
                var s = data.message.trim();
                if (s.length) return s;
            }
            throw new Error('bad_edge_payload');
        });
    }

    function invokeCustomProxy(fullPayload) {
        var c = getProxyConf();
        if (!c.url) return Promise.reject(new Error('no_proxy'));
        var headers = { 'Content-Type': 'application/json' };
        if (c.authHeader) headers.Authorization = c.authHeader;
        return fetch(c.url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(fullPayload)
        }).then(function(res) {
            if (!res.ok) throw new Error('http_' + res.status);
            return res.json();
        }).then(function(j) {
            if (!j || typeof j.message !== 'string')
                throw new Error('bad_proxy_response');
            return j.message.trim();
        });
    }

    function composeStatusBanner(origin) {
        var pc = getProxyConf();
        if (origin === 'edge') return aiTr('ai.origin.edge');
        if (origin === 'proxy') return aiTr('ai.origin.proxy');
        if (pc.url.length) return aiTr('ai.origin.demoProxy');
        return aiTr('ai.origin.demo');
    }

    function runAiChainInner(fullPayload, makeDemoLocal) {
        return invokeSupabaseEdge(fullPayload)
            .then(function(txt) {
                return { text: txt, origin: 'edge' }; })
            .catch(function() {
                return invokeCustomProxy(fullPayload).then(function(txt) {
                    return { text: txt, origin: 'proxy' }; }); })
            .catch(function() {
                return { text: makeDemoLocal(), origin: 'demo' }; });
    }

    ns.invokeAiPipeline = function(fullPayload, makeDemoLocal) {
        return runAiChainInner(fullPayload, makeDemoLocal);
    };

    ns.composeAiBanner = composeStatusBanner;

    function runAiChain(fullPayload, makeDemoLocal, statusKey) {
        return runAiChainInner(fullPayload, makeDemoLocal).then(function(r) {
            if (statusKey) setStatus(statusKey, composeStatusBanner(r.origin));
            return r.text;
        });
    }

    ns.fillNextBirthdays = function() {
        var c = pick('aiBirthUpcomingOnly');
        if (c) c.checked = true;
        ns.applyPatientFilter('birth');
        toggleAllFiltered('birth', true);
        var chk = pick('aiBirthCbMaster');
        if (chk) chk.checked = true;
        alert(aiTr('ai.alert.birthFiltered'));
    };

    function resolvedGuestBirth() {
        var guestNm = trimmedVal('aiBirthGuestName');
        if (!guestNm) return null;
        return {
            id: '__guest',
            patient_no: '—',
            full_name: guestNm,
            phone_number: trimmedVal('aiBirthGuestPhone'),
            email: trimmedVal('aiBirthGuestEmail'),
            dob: '',
            sex: ''
        };
    }

    function resolvedGuestRecall() {
        var guestNm = trimmedVal('aiRecallGuestName');
        if (!guestNm) return null;
        return {
            id: '__guest_r',
            patient_no: '—',
            full_name: guestNm,
            phone_number: trimmedVal('aiRecallGuestPhone'),
            email: trimmedVal('aiRecallGuestEmail'),
            dob: '',
            sex: ''
        };
    }

    function collectChecked(which) {
        var list = which === 'birth' ? _listBirth : _listRecall;
        var checks = which === 'birth' ? _checksBirth : _checksRecall;
        return list.filter(function(p) {
            return checks[p.id]; });
    }

    ns.generateBirthday = function() {
        var checked = collectChecked('birth');
        var guest = resolvedGuestBirth();
        var targets = [];
        if (guest && !checked.length) targets.push(guest);
        else targets = checked.slice();

        if (!targets.length) {
            alert(aiTr('ai.alert.needRosterBirth'));
            return;
        }

        var tpl = trimmedVal('aiBirthSmartBody');
        var extra = trimmedVal('aiBirthExtraNotes');
        var toneEl = pick('aiBirthTone');
        var tone = toneEl ? toneEl.value : 'warm_professional';

        pick('aiBirthGen').disabled = true;
        setStatus('birth', targets.length > 1
            ? aiTrRepl('ai.status.draftingBulk', { N: targets.length })
            : aiTr('ai.status.drafting'));

        var clinic = clinicTitle();

        /** @returns {Promise<string>} */
        function segmentForPatient(p, lastOriginHold) {
            var mergedPrompt = applyPlaceholders(tpl, p) +
                (extra ? weaveExtra(extra) : '');
            var fn = firstName(p.full_name);
            var payload = withCaller({
                workflow: 'birthday',
                tone: tone,
                clinicName: clinic,
                patientFirstName: fn,
                patientLanguageHint: 'auto',
                recallKind: null,
                userPrompt: mergedPrompt,
                dobDisplay: fmtMd(p.dob)
            });

            var fb = function() {
                return demoBirthday(fn, tone, mergedPrompt, clinic); };

            return runAiChainInner(payload, fb).then(function(r) {
                lastOriginHold[0] = r.origin;
                var head = aiTrRepl('ai.draft.patientHeader', {
                    NO: String(p.patient_no || '—'),
                    NAME: String(p.full_name || '')
                });
                return head + r.text.trim(); });
        }

        var lastO = ['demo'];

        targets.reduce(function(ch, p) {
            return ch.then(function(acc) {
                return segmentForPatient(p, lastO).then(function(seg) {
                    return acc.concat([seg]); });
            });
        }, Promise.resolve([]))
            .then(function(parts) {
                pick('aiBirthOutput').value = parts.join('\n\n').trim();
                setStatus('birth',
                    composeStatusBanner(lastO[0]) +
                    (targets.length > 1
                        ? aiTrRepl('ai.status.patientsSuffix', { N: targets.length })
                        : ''));
                pick('aiBirthGen').disabled = false;
                scheduleSendTargetRefresh('birth');
            });
    };

    ns.generateRecall = function() {
        var checked = collectChecked('recall');
        var guest = resolvedGuestRecall();
        var targets = [];
        if (guest && !checked.length) targets.push(guest);
        else targets = checked.slice();

        if (!targets.length) {
            alert(aiTr('ai.alert.needRosterRecall'));
            return;
        }

        var tpl = trimmedVal('aiRecallSmartBody');
        var extra = trimmedVal('aiRecallExtraNotes');
        var toneEl = pick('aiRecallTone');
        var tone = toneEl ? toneEl.value : 'warm_professional';
        var rkEl = pick('aiRecallKind');
        var recallKind = rkEl ? rkEl.value : 'checkup';

        pick('aiRecallGen').disabled = true;
        setStatus('recall', targets.length > 1
            ? aiTrRepl('ai.status.draftingRecallBulk', { N: targets.length })
            : aiTr('ai.status.drafting'));

        var clinic = clinicTitle();

        function segmentRecall(p, lastOriginHold) {
            var mergedPrompt =
                applyPlaceholders(tpl, p) +
                (extra ? weaveExtra(extra) : '');
            var fn = firstName(p.full_name);
            var payload = withCaller({
                workflow: 'recall',
                tone: tone,
                clinicName: clinic,
                patientFirstName: fn,
                patientLanguageHint: 'auto',
                recallKind: recallKind,
                userPrompt: mergedPrompt,
                dobDisplay: fmtMd(p.dob)
            });
            var fb = function() {
                return demoRecall(fn, tone, recallKind, mergedPrompt, clinic); };
            return runAiChainInner(payload, fb).then(function(r) {
                lastOriginHold[0] = r.origin;
                var head = aiTrRepl('ai.draft.patientHeader', {
                    NO: String(p.patient_no || '—'),
                    NAME: String(p.full_name || '')
                });
                return head + r.text.trim(); });
        }

        var lastR = ['demo'];

        targets.reduce(function(ch, p) {
            return ch.then(function(acc) {
                return segmentRecall(p, lastR).then(function(seg) {
                    return acc.concat([seg]); });
            });
        }, Promise.resolve([]))
            .then(function(parts) {
                pick('aiRecallOutput').value = parts.join('\n\n').trim();
                setStatus('recall',
                    composeStatusBanner(lastR[0]) +
                    (targets.length > 1
                        ? aiTrRepl('ai.status.patientsSuffix', { N: targets.length })
                        : ''));
                pick('aiRecallGen').disabled = false;
                scheduleSendTargetRefresh('recall');
            });
    };

    ns.copyOut = function(which) {
        var taId = which === 'birth' ? 'aiBirthOutput' : 'aiRecallOutput';
        var ta = pick(taId);
        if (!ta || !ta.value) {
            alert(aiTr('ai.alert.nothingCopy'));
            return;
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(ta.value).then(function() {
                alert(aiTr('ai.alert.copied'));
            }).catch(function() {
                fallbackCopy(ta.value);
            });
        } else fallbackCopy(ta.value);
    };

    function fallbackCopy(t) {
        var x = document.createElement('textarea');
        x.value = t;
        document.body.appendChild(x);
        x.select();
        document.execCommand('copy');
        document.body.removeChild(x);
        alert(aiTr('ai.alert.copied'));
    }

    function sliceBlockForPatient(raw, patientNoTrim, patientNameTrim) {
        if (!raw) return '';
        var pn = String(patientNoTrim || '').trim();
        var nm = String(patientNameTrim || '').trim();
        var marks = [
            '\n===== PATIENT #' + pn + ' — ' + nm + ' =====\n',
            '\n===== PATIENT #' + pn + ' — ' + nm + ' =====',
            '===== PATIENT #' + pn + ' — ' + nm + ' =====\n',
            '===== PATIENT #' + pn + ' — ' + nm + ' ====='
        ];
        var used = '';
        var ix = -1;
        for (var mi = 0; mi < marks.length; mi++) {
            ix = raw.indexOf(marks[mi]);
            if (ix >= 0) {
                used = marks[mi];
                break;
            }
        }
        if (ix < 0 || !used) return '';
        var tail = raw.slice(ix + used.length);
        var j = tail.indexOf('\n===== PATIENT #');
        if (j < 0) return tail.trim();
        return tail.slice(0, j).trim();
    }

    ns.openChannelBirth = function(ch) {
        openBulkChannel(ch, 'birth');
    };

    ns.openChannelRecall = function(ch) {
        openBulkChannel(ch, 'recall');
    };

    function openBulkChannel(ch, side) {
        var outId = side === 'birth' ? 'aiBirthOutput' : 'aiRecallOutput';
        var selId = side === 'birth' ? 'aiBirthBulkTarget' : 'aiRecallBulkTarget';
        var bodyPack = (pick(outId).value || '').trim();
        var gid = trimmedVal(selId);

        var gb = resolvedGuestBirth();
        var gr = resolvedGuestRecall();
        var p = patientRowById(gid);
        var guestChosen =
            (side === 'birth' && gb && gid === gb.id) ||
            (side === 'recall' && gr && gid === gr.id);

        if (!p && gb && gid === gb.id && side === 'birth') p = gb;
        if (!p && gr && gid === gr.id && side === 'recall') p = gr;

        if (!p) {
            alert(aiTr('ai.alert.choosePatient'));
            return;
        }

        var msg = '';
        if (guestChosen) msg = bodyPack;
        else {
            msg = sliceBlockForPatient(bodyPack,
                String(p.patient_no || ''),
                String(p.full_name || '').trim());
            if (!msg) msg = bodyPack;
        }
        msg = msg.trim();
        if (!msg) {
            alert(aiTr('ai.alert.draftMissing'));
            return;
        }

        if (ch === 'wa') return openWa(p.phone_number, msg);
        if (ch === 'sms') return openSms(p.phone_number, msg);
        if (ch === 'email')
            return openMail(p.email,
                side === 'birth'
                    ? aiTr('ai.demo.email.subjectBirth')
                    : aiTr('ai.demo.email.subjectRecall'),
                msg);
        alert(aiTr('ai.alert.unknownChannel'));
    }

    /** debounce refill send-target dropdown */
    var _tgtTimerBirth;
    var _tgtTimerRecall;
    function scheduleSendTargetRefresh(which) {
        if (which === 'birth') clearTimeout(_tgtTimerBirth); else clearTimeout(_tgtTimerRecall);
        var tmr = setTimeout(function() {
            rebuildSendDropdown(which === 'birth' ? 'birth' : 'recall'); }, 140);
        if (which === 'birth') _tgtTimerBirth = tmr;
        else _tgtTimerRecall = tmr;
    }

    function rebuildSendDropdown(which) {
        var checked = collectChecked(which).slice();
        var guest = which === 'birth'
            ? resolvedGuestBirth()
            : resolvedGuestRecall();
        var selId = which === 'birth'
            ? 'aiBirthBulkTarget'
            : 'aiRecallBulkTarget';
        var sel = pick(selId);
        if (!sel) return;
        var prev = sel.value;

        sel.innerHTML = '';

        checked.forEach(function(p) {
            var o = document.createElement('option');
            o.value = p.id;
            o.textContent = '#' +
                String(p.patient_no || '').trim() + ' · ' +
                String(p.full_name || '').trim();
            sel.appendChild(o);
        });

        if (guest) {
            var g = document.createElement('option');
            g.value = guest.id;
            g.textContent = aiTrRepl('ai.send.guestDemo', {
                NAME: String(guest.full_name || '').slice(0, 56)
            });
            sel.appendChild(g);
        }

        if (checked.length === 1)
            sel.value = checked[0].id;
        else if (!checked.length && guest)
            sel.value = guest.id;
        else if (prev &&
            checked.some(function(p) {
                return p.id === prev; }))
            sel.value = prev;

        else if (!sel.value && sel.options.length)
            sel.selectedIndex = 0;
    }

    function openWa(rawPhone, msg) {
        var d = normalizePhoneWa(rawPhone);
        if (!d) {
            alert(aiTr('ai.alert.noMobile'));
            return;
        }
        var url =
            'https://wa.me/' +
            encodeURIComponent(d) +
            '?text=' + encodeURIComponent(msg);
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    function openSms(rawPhone, msg) {
        var d = normalizePhoneWa(rawPhone);
        if (!d) {
            alert(aiTr('ai.alert.noMobile'));
            return;
        }
        window.location.href =
            'sms:' + d + '?body=' + encodeURIComponent(msg);
    }

    function openMail(email, subj, body) {
        if (!email || !email.includes('@')) {
            alert(aiTr('ai.alert.emailMissing'));
            return;
        }
        window.location.href =
            'mailto:' + encodeURIComponent(email) +
            '?subject=' + encodeURIComponent(subj) +
            '&body=' + encodeURIComponent(body);
    }

    ns.switchTab = function(tab) {
        document.querySelectorAll('.ai-tab-btn').forEach(function(b) {
            var on = b.getAttribute('data-ai-tab') === tab;
            b.classList.toggle('ai-tab-active', on);
        });
        var map = {
            birthday: 'aiPanelBirthday',
            recall: 'aiPanelRecall',
            settings: 'aiPanelSettings'
        };
        Object.keys(map).forEach(function(k) {
            var panel = pick(map[k]);
            if (!panel) return;
            panel.style.display = (k === tab) ? 'block' : 'none';
        });
        if (tab === 'settings') syncProxyInputs();

        if (tab === 'birthday') scheduleSendTargetRefresh('birth');
        else if (tab === 'recall') scheduleSendTargetRefresh('recall');
    };

    document.addEventListener('app-lang-change', function() {
        refreshDistrictSelects();
        var pitchDet = pick('aiPitchDetail');
        var pitchBtn = pick('aiPitchToggle');
        if (pitchBtn && pitchDet) {
            pitchBtn.textContent = pitchDet.style.display !== 'none'
                ? aiTr('ai.pitchHide')
                : aiTr('ai.pitchToggle');
        }
        if (_patientsCache.length) {
            renderPickList('birth');
            renderPickList('recall');
        }
        fillTemplatesBirth();
        fillTemplatesRecall();
        scheduleSendTargetRefresh('birth');
        scheduleSendTargetRefresh('recall');
        refreshAiPatientBannerForLang();
        var sec = pick('aiHelperSection');
        if (typeof applyI18nInRoot === 'function') {
            if (_patientsCache.length) {
                var birthPanel = pick('aiPanelBirthday');
                var recallPanel = pick('aiPanelRecall');
                var settingsPanel = pick('aiPanelSettings');
                if (birthPanel) applyI18nInRoot(birthPanel);
                if (recallPanel) applyI18nInRoot(recallPanel);
                if (settingsPanel) applyI18nInRoot(settingsPanel);
            }
            if (sec && (_patientsCache.length || sec.style.display !== 'none')) {
                applyI18nInRoot(sec);
            }
        }
        ns.onBirthTemplateChange();
        ns.onRecallTemplateChange();
    });

})(AIHELPER);
