// ════════════════════════════════════════════════════════════════
// AI PATIENT ASSISTANT — roster filters, checklist, templates, drafts
// ════════════════════════════════════════════════════════════════

var AIHELPER = AIHELPER || {};

(function(ns) {

    var LS_PROXY_URL = 'joyful_ai_proxy_url';
    var SS_PROXY_AUTH = 'joyful_ai_proxy_auth_session';
    /** Local tools/ai-local-proxy.mjs — dev only (not used on GitHub Pages). */
    var LOCAL_AI_PROXY_DEFAULT = 'http://127.0.0.1:8787';

    function isLocalDevHost() {
        try {
            var h = String(window.location.hostname || '').toLowerCase();
            return !h || h === 'localhost' || h === '127.0.0.1';
        } catch (e) {
            return false;
        }
    }

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

    function clinicTitle(bodyHint) {
        if (typeof clinicNameForOutboundMessage === 'function') {
            return clinicNameForOutboundMessage({
                body: bodyHint || '',
                fallback: aiTr('ai.clinicFallback')
            }) || aiTr('ai.clinicFallback');
        }
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
            .replace(/\{\{clinic\}\}/gi, clinicTitle(tpl))
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
                ensureLocalProxyDefaultInUi();
                if (!silentReload) syncProxyInputs();
                ensureTwilioFromCache(true).then(function() {
                    ns.refreshTwilioFromSelect();
                });
                ensureTwilioTplCache(true).then(function() {
                    ns.refreshTwilioTplSelect();
                });
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
        if (!url && isLocalDevHost()) url = LOCAL_AI_PROXY_DEFAULT;
        var aEl = pick('aiProxyAuth');
        if (!auth && aEl && aEl.value) auth = aEl.value.trim();
        return { url: url, authHeader: auth };
    }

    function ensureLocalProxyDefaultInUi() {
        if (!isLocalDevHost()) return;
        try {
            if (!localStorage.getItem(LS_PROXY_URL)) {
                localStorage.setItem(LS_PROXY_URL, LOCAL_AI_PROXY_DEFAULT);
            }
        } catch (e) {}
        var u = pick('aiProxyUrl');
        if (u && !String(u.value || '').trim()) u.value = LOCAL_AI_PROXY_DEFAULT;
    }

    var EDGE_FN = 'ai-patient-draft';
    /** Last edge/proxy failure (for status banner when falling back to demo). */
    var _lastAiPipeError = '';

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

    function normalizeEdgeData(data) {
        if (!data) return null;
        if (typeof data === 'string') {
            try { return JSON.parse(data); } catch (e) { return null; }
        }
        if (typeof data === 'object') return data;
        return null;
    }

    /** Turn raw Twilio/Edge errors into actionable clinic guidance. */
    function humanizeTwilioSendError(raw, fromUsed) {
        var msg = String(raw || '').trim();
        if (!msg) return aiTr('ai.twilio.fail');
        var from = String(fromUsed || '').replace(/^whatsapp:/i, '').trim();
        if (/21659/i.test(msg) ||
            (/from/i.test(msg) && /not a twilio phone number|short code country mismatch/i.test(msg))) {
            return aiTr('ai.twilio.err21659').replace(/\{FROM\}/g, from || 'From');
        }
        if (/21606/i.test(msg) ||
            (/from/i.test(msg) && /not a valid.*message-capable|not.*sms-capable/i.test(msg))) {
            return aiTr('ai.twilio.err21606').replace(/\{FROM\}/g, from || 'From');
        }
        return msg;
    }

    /** Parse Supabase functions.invoke result, including non-2xx body when present. */
    function parseTwilioInvokeResult(res) {
        var dataObj = normalizeEdgeData(res && res.data);
        if (dataObj) return Promise.resolve(dataObj);

        var err = res && res.error;
        if (!err) return Promise.resolve(null);

        // FunctionsHttpError may expose Response as context
        var ctx = err.context;
        if (ctx && typeof ctx.json === 'function') {
            return ctx.json().then(function(j) {
                return normalizeEdgeData(j);
            }).catch(function() {
                return {
                    ok: false,
                    error: err.message || aiTr('ai.twilio.fail')
                };
            });
        }
        if (typeof err === 'object' && (err.error || err.message)) {
            return Promise.resolve({
                ok: false,
                error: String(err.error || err.message)
            });
        }
        return Promise.resolve({
            ok: false,
            error: String(err.message || err || aiTr('ai.twilio.fail'))
        });
    }

    /** Prefer an SMS-capable saved From when sending SMS and UI From is Default. */
    function resolveOutreachFrom(channel, explicitFrom) {
        if (explicitFrom) return String(explicitFrom).trim();
        if (channel !== 'sms') return '';
        var store = loadTwilioFromStore();
        var sel = pick('aiTwilioFrom');
        var id = sel ? String(sel.value || store.selectedId || 'default') : (store.selectedId || 'default');
        if (id && id !== 'default') {
            for (var i = 0; i < store.numbers.length; i++) {
                if (store.numbers[i].id === id && store.numbers[i].sms !== false) {
                    return store.numbers[i].phone;
                }
            }
        }
        for (var j = 0; j < store.numbers.length; j++) {
            if (store.numbers[j].sms !== false && store.numbers[j].phone) {
                return store.numbers[j].phone;
            }
        }
        return '';
    }

    function edgeErrorHint(errRes, dataObj) {
        if (dataObj && dataObj.error) return String(dataObj.error);
        if (dataObj && dataObj.detail) return String(dataObj.detail).slice(0, 120);
        if (errRes && errRes.message) return String(errRes.message);
        return '';
    }

    function invokeSupabaseEdge(fullPayload) {
        if (typeof SB === 'undefined' || !SB.functions ||
            typeof SB.functions.invoke !== 'function') {
            return Promise.reject(new Error('no_functions'));
        }
        return SB.functions.invoke(EDGE_FN, { body: fullPayload }).then(function(res) {
            var errRes = res.error;
            var dataObj = normalizeEdgeData(res.data);
            if (dataObj && typeof dataObj.message === 'string') {
                var s = dataObj.message.trim();
                if (s.length) return s;
            }
            if (errRes) {
                var hint = edgeErrorHint(errRes, dataObj);
                throw new Error(hint || 'edge_invoke_failed');
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
        var errTail = _lastAiPipeError
            ? (' — ' + String(_lastAiPipeError).slice(0, 160))
            : '';
        if (pc.url.length) return aiTr('ai.origin.demoProxy') + errTail;
        return aiTr('ai.origin.demo') + errTail;
    }

    function runAiChainInner(fullPayload, makeDemoLocal) {
        _lastAiPipeError = '';
        var edgeErrMsg = '';
        return invokeSupabaseEdge(fullPayload)
            .then(function(txt) {
                return { text: txt, origin: 'edge' }; })
            .catch(function(errEdge) {
                edgeErrMsg = (errEdge && errEdge.message)
                    ? String(errEdge.message)
                    : 'edge_failed';
                _lastAiPipeError = edgeErrMsg;
                console.warn('[AI] Edge failed:', errEdge);
                var pc = getProxyConf();
                if (!pc.url) {
                    return Promise.reject(new Error('no_proxy_configured'));
                }
                return invokeCustomProxy(fullPayload).then(function(txt) {
                    return { text: txt, origin: 'proxy' }; });
            })
            .catch(function(errProxy) {
                var pm = (errProxy && errProxy.message)
                    ? String(errProxy.message)
                    : '';
                if (pm === 'no_proxy_configured' || pm === 'no_proxy') {
                    _lastAiPipeError = edgeErrMsg || aiTr('ai.err.edgeOnly');
                } else if (pm) {
                    _lastAiPipeError = edgeErrMsg
                        ? (edgeErrMsg + ' | proxy: ' + pm)
                        : pm;
                }
                console.warn('[AI] Proxy skipped/failed:', errProxy);
                return { text: makeDemoLocal(), origin: 'demo' };
            });
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

        var clinic = clinicTitle(tpl);

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

        var clinic = clinicTitle(tpl);

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

    var TWILIO_WA_EDGE_FN = 'twilio-whatsapp';
    /** Fallback WhatsApp Content SID when no template is selected. */
    var TWILIO_WA_CONTENT_SID = 'HXf63c7a58271df43f5c63d97c6a514413';
    /** Active channel in Twilio Send panel: 'whatsapp' | 'sms' */
    var _twilioChannel = 'whatsapp';
    var TWILIO_FROM_LS_KEY = 'ai_twilio_from_numbers_v1';
    /** Legacy browser store — migrated once into Supabase twilio_content_templates. */
    var TWILIO_TPL_LS_KEY = 'ai_twilio_content_tpls_v1';
    /** Per-browser last-selected template id (clinic list lives in Supabase). */
    var TWILIO_TPL_SELECTED_KEY = 'ai_twilio_content_tpl_selected_v1';
    var TWILIO_TPL_TABLE = 'twilio_content_templates';
    var TWILIO_TPL_CONSOLE_URL =
        'https://console.twilio.com/us1/develop/sms/content-template-builder';

    /** In-memory clinic-wide template cache (synced from Supabase). */
    var _tplCache = null;
    var _tplLoadPromise = null;
    var _tplDbReady = false;
    var _tplDbMissing = false;

    function setTwilioStatus(msg, isErr) {
        var el = pick('aiTwilioStatus');
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = isErr ? '#b91c1c' : '#047857';
    }

    function defaultTwilioTplSeed() {
        return {
            selectedId: 'builtin_recall',
            templates: [
                {
                    id: 'builtin_recall',
                    label: 'Clinic recall (default)',
                    contentSid: TWILIO_WA_CONTENT_SID,
                    vars: '1',
                    varMap: { '1': 'NAME' },
                    notes: 'Approved WhatsApp recall · {{1}} = patient name',
                    builtin: true
                }
            ]
        };
    }

    /** Web-app placeholders staff can map onto Twilio {{n}} slots. */
    var TWILIO_WEB_FIELDS = [
        'NAME', 'NAME_EN', 'NAME_ZH', 'FULL_NAME', 'FULL_NAME_EN', 'FULL_NAME_ZH',
        'FIRST', 'CHINESE', 'ENGLISH',
        'CLINIC', 'CLINIC_EN', 'CLINIC_ZH', 'CLINIC_CHI',
        'DATE', 'TIME',
        'DOCTOR', 'DOCTOR_EN', 'DOCTOR_ZH', 'DOCTOR_CHI',
        'TREATMENT', 'PHONE', 'PATIENT_NO', 'BODY'
    ];

    /** Sensible defaults when a template has no saved var_map yet. */
    var TWILIO_DEFAULT_KEY_FIELD = {
        '1': 'NAME',
        '2': 'CLINIC',
        '3': 'DATE',
        '4': 'TIME',
        '5': 'DOCTOR'
    };

    function normalizeContentSid(raw) {
        var s = String(raw || '').trim();
        if (!s) return '';
        if (!/^HX[a-zA-Z0-9]{32}$/.test(s)) return '';
        return s;
    }

    function normalizeTplVars(raw) {
        var parts = String(raw || '1')
            .split(/[,;\s]+/)
            .map(function(x) { return String(x || '').trim(); })
            .filter(Boolean);
        if (!parts.length) parts = ['1'];
        var seen = Object.create(null);
        var out = [];
        parts.forEach(function(k) {
            if (!/^\d+$/.test(k)) return;
            if (seen[k]) return;
            seen[k] = true;
            out.push(k);
        });
        if (!out.length) out = ['1'];
        if (out.indexOf('1') < 0) out.unshift('1');
        return out.join(',');
    }

    function normalizeFieldToken(raw) {
        var s = String(raw || '').trim().toUpperCase().replace(/[{}]/g, '');
        if (!s) return '';
        if (TWILIO_WEB_FIELDS.indexOf(s) >= 0) return s;
        // Allow custom tokens that look like placeholders (A-Z0-9_)
        if (/^[A-Z][A-Z0-9_]{0,31}$/.test(s)) return s;
        return '';
    }

    /**
     * Build/normalize { "1":"NAME", "2":"CLINIC", … } for the given vars list.
     * @param {string} varsStr e.g. "1,2,3"
     * @param {Object|string|null} rawMap
     */
    function normalizeTplVarMap(varsStr, rawMap) {
        var keys = String(normalizeTplVars(varsStr) || '1').split(',').filter(Boolean);
        var src = rawMap;
        if (typeof src === 'string') {
            try { src = JSON.parse(src); } catch (e) { src = null; }
        }
        if (!src || typeof src !== 'object') src = {};
        var out = {};
        keys.forEach(function(k) {
            var fromRaw = normalizeFieldToken(src[k] != null ? src[k] : src[String(k)]);
            if (fromRaw) {
                out[k] = fromRaw;
                return;
            }
            out[k] = TWILIO_DEFAULT_KEY_FIELD[k] || 'BODY';
        });
        return out;
    }

    function varMapToCompact(varMap) {
        var m = varMap && typeof varMap === 'object' ? varMap : {};
        var out = {};
        Object.keys(m).forEach(function(k) {
            var f = normalizeFieldToken(m[k]);
            if (f) out[String(k)] = f;
        });
        return out;
    }

    ns.listTwilioWebFields = function() {
        return TWILIO_WEB_FIELDS.slice();
    };

    ns.normalizeTplVarMap = normalizeTplVarMap;

    function normalizeTplRow(t) {
        if (!t || typeof t !== 'object') return null;
        var sid = normalizeContentSid(t.contentSid || t.content_sid);
        if (!sid) return null;
        var id = String(t.id || '').trim();
        if (!id) id = 'tpl_' + sid.slice(0, 12);
        var vars = normalizeTplVars(t.vars);
        var rawMap = t.varMap != null ? t.varMap
            : (t.var_map != null ? t.var_map : null);
        return {
            id: id,
            label: String(t.label || '').trim() || sid,
            contentSid: sid,
            vars: vars,
            varMap: normalizeTplVarMap(vars, rawMap),
            notes: String(t.notes || '').trim().slice(0, 1000),
            builtin: !!t.builtin
        };
    }

    function readSelectedTplPref() {
        try {
            return String(localStorage.getItem(TWILIO_TPL_SELECTED_KEY) || '').trim();
        } catch (e) {
            return '';
        }
    }

    function writeSelectedTplPref(id) {
        try {
            if (id) localStorage.setItem(TWILIO_TPL_SELECTED_KEY, String(id));
        } catch (e) { /* ignore */ }
    }

    function readLegacyLocalTplTemplates() {
        try {
            var raw = localStorage.getItem(TWILIO_TPL_LS_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return [];
            var list = Array.isArray(parsed.templates) ? parsed.templates : [];
            var out = [];
            list.forEach(function(t) {
                var row = normalizeTplRow(t);
                if (row) out.push(row);
            });
            return out;
        } catch (e) {
            return [];
        }
    }

    function setTplCache(templates, selectedId) {
        var list = Array.isArray(templates) ? templates.slice() : [];
        if (!list.length) list = defaultTwilioTplSeed().templates.slice();
        var sel = String(selectedId || readSelectedTplPref() || '');
        var found = false;
        for (var i = 0; i < list.length; i++) {
            if (list[i].id === sel) { found = true; break; }
        }
        if (!found) sel = list[0].id;
        _tplCache = { selectedId: sel, templates: list };
        writeSelectedTplPref(sel);
        return _tplCache;
    }

    function loadTwilioTplStore() {
        if (_tplCache && _tplCache.templates && _tplCache.templates.length) {
            return _tplCache;
        }
        return setTplCache(defaultTwilioTplSeed().templates, readSelectedTplPref());
    }

    function saveTwilioTplStore(store) {
        // Selected id is per-browser; template rows live in Supabase.
        if (!store) return;
        _tplCache = {
            selectedId: String(store.selectedId || ''),
            templates: Array.isArray(store.templates) ? store.templates.slice() : []
        };
        writeSelectedTplPref(_tplCache.selectedId);
    }

    function mapDbRowToTpl(row) {
        if (!row) return null;
        return normalizeTplRow({
            id: row.id,
            label: row.label,
            contentSid: row.content_sid,
            vars: row.vars,
            varMap: row.var_map,
            notes: row.notes,
            builtin: false
        });
    }

    function tplTableMissing(err) {
        var msg = String((err && err.message) || err || '');
        return /twilio_content_templates|does not exist|schema cache|Could not find the table/i.test(msg);
    }

    function tplVarMapColumnMissing(err) {
        var msg = String((err && err.message) || err || '');
        // Only treat as missing var_map column — not a missing table (also mentions schema cache).
        return /var_map/i.test(msg) &&
            (/column|schema cache|does not exist|Could not find/i.test(msg));
    }

    function callerUserIdForTpl() {
        try {
            if (typeof currentUserId !== 'undefined' && currentUserId) {
                return String(currentUserId);
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function seedDefaultTplToDb() {
        if (typeof SB === 'undefined') return Promise.resolve(null);
        var row = {
            label: 'Clinic recall (default)',
            content_sid: TWILIO_WA_CONTENT_SID,
            vars: '1',
            var_map: { '1': 'NAME' },
            notes: 'Approved WhatsApp recall · {{1}} = patient name',
            sort_order: 0,
            created_by: 'seed'
        };
        return SB.from(TWILIO_TPL_TABLE).insert([row])
            .select('id,label,content_sid,vars,var_map,notes')
            .then(function(r) {
                if (r.error && tplVarMapColumnMissing(r.error)) {
                    delete row.var_map;
                    return SB.from(TWILIO_TPL_TABLE).insert([row])
                        .select('id,label,content_sid,vars,notes')
                        .then(function(r2) {
                            if (r2.error) return null;
                            return r2.data && r2.data[0] ? mapDbRowToTpl(r2.data[0]) : null;
                        });
                }
                if (r.error) return null;
                return r.data && r.data[0] ? mapDbRowToTpl(r.data[0]) : null;
            });
    }

    function migrateLegacyLocalTplsToDb() {
        var legacy = readLegacyLocalTplTemplates();
        if (!legacy.length || typeof SB === 'undefined') return Promise.resolve(0);
        var rows = legacy.map(function(t, idx) {
            return {
                label: t.label || t.contentSid,
                content_sid: t.contentSid,
                vars: t.vars || '1',
                var_map: varMapToCompact(t.varMap || normalizeTplVarMap(t.vars || '1', null)),
                notes: t.notes || null,
                sort_order: idx,
                created_by: callerUserIdForTpl() || 'migrate'
            };
        });
        // Upsert-like: insert one by one, ignore duplicate SIDs
        var chain = Promise.resolve(0);
        rows.forEach(function(row) {
            chain = chain.then(function(n) {
                return SB.from(TWILIO_TPL_TABLE).insert([row]).then(function(r) {
                    if (r.error && tplVarMapColumnMissing(r.error)) {
                        var bare = {
                            label: row.label,
                            content_sid: row.content_sid,
                            vars: row.vars,
                            notes: row.notes,
                            sort_order: row.sort_order,
                            created_by: row.created_by
                        };
                        return SB.from(TWILIO_TPL_TABLE).insert([bare]).then(function(r2) {
                            if (r2.error) return n;
                            return n + 1;
                        });
                    }
                    if (r.error) return n;
                    return n + 1;
                });
            });
        });
        return chain;
    }

    function fetchTwilioTemplatesFromDb() {
        if (typeof SB === 'undefined') {
            _tplDbReady = false;
            return Promise.resolve(setTplCache(defaultTwilioTplSeed().templates, readSelectedTplPref()));
        }
        return SB.from(TWILIO_TPL_TABLE)
            .select('id,label,content_sid,vars,var_map,notes,sort_order,is_active')
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .order('label', { ascending: true })
            .then(function(r) {
                if (r.error && tplVarMapColumnMissing(r.error)) {
                    return SB.from(TWILIO_TPL_TABLE)
                        .select('id,label,content_sid,vars,notes,sort_order,is_active')
                        .eq('is_active', true)
                        .order('sort_order', { ascending: true })
                        .order('label', { ascending: true });
                }
                return r;
            })
            .then(function(r) {
                if (r.error) {
                    if (tplTableMissing(r.error)) {
                        _tplDbMissing = true;
                        _tplDbReady = false;
                        var legacy = readLegacyLocalTplTemplates();
                        setTplCache(
                            legacy.length ? legacy : defaultTwilioTplSeed().templates,
                            readSelectedTplPref()
                        );
                        return _tplCache;
                    }
                    _tplDbReady = false;
                    setTplCache(defaultTwilioTplSeed().templates, readSelectedTplPref());
                    return _tplCache;
                }
                _tplDbMissing = false;
                _tplDbReady = true;
                var list = (r.data || []).map(mapDbRowToTpl).filter(Boolean);
                if (!list.length) {
                    return migrateLegacyLocalTplsToDb().then(function(migrated) {
                        if (migrated) {
                            return SB.from(TWILIO_TPL_TABLE)
                                .select('id,label,content_sid,vars,var_map,notes,sort_order,is_active')
                                .eq('is_active', true)
                                .order('sort_order', { ascending: true })
                                .order('label', { ascending: true })
                                .then(function(r2) {
                                    if (r2.error && tplVarMapColumnMissing(r2.error)) {
                                        return SB.from(TWILIO_TPL_TABLE)
                                            .select('id,label,content_sid,vars,notes,sort_order,is_active')
                                            .eq('is_active', true)
                                            .order('sort_order', { ascending: true })
                                            .order('label', { ascending: true });
                                    }
                                    return r2;
                                })
                                .then(function(r2) {
                                    var list2 = (r2.data || []).map(mapDbRowToTpl).filter(Boolean);
                                    if (list2.length) {
                                        setTplCache(list2, readSelectedTplPref());
                                        return _tplCache;
                                    }
                                    return seedDefaultTplToDb().then(function(row) {
                                        setTplCache(
                                            row ? [row] : defaultTwilioTplSeed().templates,
                                            row ? row.id : readSelectedTplPref()
                                        );
                                        return _tplCache;
                                    });
                                });
                        }
                        return seedDefaultTplToDb().then(function(row) {
                            setTplCache(
                                row ? [row] : defaultTwilioTplSeed().templates,
                                row ? row.id : readSelectedTplPref()
                            );
                            return _tplCache;
                        });
                    });
                }
                setTplCache(list, readSelectedTplPref());
                return _tplCache;
            });
    }

    function ensureTwilioTplCache(force) {
        if (!force && _tplCache && _tplDbReady && _tplCache.templates.length) {
            return Promise.resolve(_tplCache);
        }
        if (!force && _tplLoadPromise) return _tplLoadPromise;
        _tplLoadPromise = fetchTwilioTemplatesFromDb().then(function(store) {
            _tplLoadPromise = null;
            return store;
        }).catch(function() {
            _tplLoadPromise = null;
            return loadTwilioTplStore();
        });
        return _tplLoadPromise;
    }

    function getSelectedTwilioTpl() {
        var store = loadTwilioTplStore();
        var sel = pick('aiTwilioTpl');
        var id = sel
            ? String(sel.value || store.selectedId || '')
            : String(store.selectedId || '');
        for (var i = 0; i < store.templates.length; i++) {
            if (store.templates[i].id === id) return store.templates[i];
        }
        return store.templates[0] || null;
    }

    function syncTwilioTplHint() {
        var hint = pick('aiTwilioTplHint');
        if (!hint) return;
        var tpl = getSelectedTwilioTpl();
        if (!tpl) {
            hint.textContent = aiTr('ai.twilio.tplHintEmpty');
            return;
        }
        var sidShort = tpl.contentSid;
        var notes = tpl.notes ? ' — ' + tpl.notes : '';
        var map = normalizeTplVarMap(tpl.vars || '1', tpl.varMap);
        var mapBits = Object.keys(map).sort().map(function(k) {
            return '{{' + k + '}}={' + map[k] + '}';
        }).join(' · ');
        hint.textContent =
            aiTr('ai.twilio.tplHint')
                .replace('{sid}', sidShort)
                .replace('{vars}', mapBits || ('{{' + String(tpl.vars || '1').split(',').join('}}, {{') + '}}')) +
            notes;
    }

    function fillTwilioTplForm(tpl) {
        var labelEl = pick('aiTwilioTplLabel');
        var sidEl = pick('aiTwilioTplSid');
        var varsEl = pick('aiTwilioTplVars');
        var notesEl = pick('aiTwilioTplNotes');
        if (!tpl) {
            if (labelEl) labelEl.value = '';
            if (sidEl) sidEl.value = '';
            if (varsEl) varsEl.value = '1';
            if (notesEl) notesEl.value = '';
            renderTwilioTplVarMapUi('1', { '1': 'NAME' });
            return;
        }
        if (labelEl) labelEl.value = tpl.label || '';
        if (sidEl) sidEl.value = tpl.contentSid || '';
        if (varsEl) varsEl.value = tpl.vars || '1';
        if (notesEl) notesEl.value = tpl.notes || '';
        renderTwilioTplVarMapUi(tpl.vars || '1', tpl.varMap);
    }

    function readTwilioTplVarMapFromUi(varsStr) {
        var box = pick('aiTwilioTplVarMap');
        var raw = {};
        if (box) {
            var sels = box.querySelectorAll('select[data-tpl-map-key], input[data-tpl-map-key]');
            Array.prototype.forEach.call(sels, function(el) {
                var k = el.getAttribute('data-tpl-map-key');
                if (!k) return;
                raw[k] = el.value;
            });
        }
        return normalizeTplVarMap(varsStr, raw);
    }

    function readTwilioTplForm() {
        var labelEl = pick('aiTwilioTplLabel');
        var sidEl = pick('aiTwilioTplSid');
        var varsEl = pick('aiTwilioTplVars');
        var notesEl = pick('aiTwilioTplNotes');
        var sid = normalizeContentSid(sidEl ? sidEl.value : '');
        if (!sid) return { error: 'sid' };
        var vars = normalizeTplVars(varsEl ? varsEl.value : '1');
        return {
            label: labelEl ? String(labelEl.value || '').trim() : '',
            contentSid: sid,
            vars: vars,
            varMap: readTwilioTplVarMapFromUi(vars),
            notes: notesEl ? String(notesEl.value || '').trim().slice(0, 1000) : ''
        };
    }

    function fieldLabelForUi(field) {
        var f = String(field || '').toUpperCase();
        var key = 'ai.twilio.field.' + f.toLowerCase();
        var translated = aiTr(key);
        if (translated && translated !== key) return translated + ' ({' + f + '})';
        return '{' + f + '}';
    }

    /**
     * Render matching rows: Twilio {{n}} → web placeholder select.
     * @param {string} containerId
     * @param {string} varsStr
     * @param {Object} varMap
     */
    function renderTplVarMapInto(containerId, varsStr, varMap) {
        var box = pick(containerId);
        if (!box) return;
        var keys = String(normalizeTplVars(varsStr) || '1').split(',').filter(Boolean);
        var map = normalizeTplVarMap(varsStr, varMap);
        box.innerHTML = '';
        if (!keys.length) return;

        var title = document.createElement('div');
        title.className = 'ai-hint';
        title.style.margin = '8px 0 6px';
        title.textContent = aiTr('ai.twilio.varMapHint');
        box.appendChild(title);

        keys.forEach(function(k) {
            var row = document.createElement('div');
            row.className = 'ai-twilio-var-map-row';
            row.style.cssText =
                'display:flex;align-items:center;gap:8px;margin-top:6px;flex-wrap:wrap;';

            var lab = document.createElement('label');
            lab.className = 'ai-label';
            lab.style.cssText = 'margin:0;min-width:72px;font-family:ui-monospace,Consolas,monospace;';
            lab.textContent = '{{' + k + '}}';

            var arrow = document.createElement('span');
            arrow.textContent = '→';
            arrow.style.color = '#64748b';

            var sel = document.createElement('select');
            sel.className = 'ai-input';
            sel.style.cssText = 'flex:1;min-width:160px;';
            sel.setAttribute('data-tpl-map-key', k);
            TWILIO_WEB_FIELDS.forEach(function(f) {
                var opt = document.createElement('option');
                opt.value = f;
                opt.textContent = fieldLabelForUi(f);
                if (map[k] === f) opt.selected = true;
                sel.appendChild(opt);
            });
            // Preserve custom mapped field not in catalog
            if (map[k] && TWILIO_WEB_FIELDS.indexOf(map[k]) < 0) {
                var custom = document.createElement('option');
                custom.value = map[k];
                custom.textContent = '{' + map[k] + '}';
                custom.selected = true;
                sel.appendChild(custom);
            }

            row.appendChild(lab);
            row.appendChild(arrow);
            row.appendChild(sel);
            box.appendChild(row);
        });
    }

    function renderTwilioTplVarMapUi(varsStr, varMap) {
        renderTplVarMapInto('aiTwilioTplVarMap', varsStr, varMap);
    }

    ns.renderTplVarMapInto = renderTplVarMapInto;
    ns.readTplVarMapFromContainer = function(containerId, varsStr) {
        var box = pick(containerId);
        var raw = {};
        if (box) {
            var els = box.querySelectorAll('select[data-tpl-map-key], input[data-tpl-map-key]');
            Array.prototype.forEach.call(els, function(el) {
                var k = el.getAttribute('data-tpl-map-key');
                if (!k) return;
                raw[k] = el.value;
            });
        }
        return normalizeTplVarMap(varsStr, raw);
    };

    function defaultClinicForTwilio(opts) {
        opts = opts || {};
        if (typeof clinicNameForOutboundMessage === 'function') {
            return clinicNameForOutboundMessage(opts) || 'Joyful Smile';
        }
        if (typeof currentClinicLabel !== 'undefined' && currentClinicLabel) {
            return String(currentClinicLabel);
        }
        if (typeof currentClinicId !== 'undefined' && currentClinicId &&
            typeof clinicRecordFromId === 'function' && typeof clinicDisplayName === 'function') {
            var rec = clinicRecordFromId(currentClinicId);
            if (rec) return clinicDisplayName(rec) || '';
        }
        return 'Joyful Smile';
    }

    function buildFieldBag(ctx) {
        ctx = ctx || {};
        var f = {};
        if (ctx.fields && typeof ctx.fields === 'object') {
            Object.keys(ctx.fields).forEach(function(k) {
                var tok = normalizeFieldToken(k);
                if (tok) f[tok] = String(ctx.fields[k] != null ? ctx.fields[k] : '');
            });
        }
        function put(key, val) {
            if (f[key] != null && String(f[key]).trim() !== '') return;
            if (val == null || String(val).trim() === '') return;
            f[key] = String(val);
        }
        put('NAME', ctx.name);
        put('FULL_NAME', ctx.fullName || ctx.full_name);
        put('FIRST', ctx.first);
        put('CHINESE', ctx.chinese);
        put('ENGLISH', ctx.english);
        put('CLINIC', ctx.clinic);
        put('DATE', ctx.date);
        put('TIME', ctx.time);
        put('DOCTOR', ctx.doctor);
        put('TREATMENT', ctx.treatment);
        put('PHONE', ctx.phone);
        put('PATIENT_NO', ctx.patientNo || ctx.patient_no);
        put('BODY', ctx.body);
        if (!f.CLINIC) {
            put('CLINIC', defaultClinicForTwilio({
                body: ctx.body || ctx.text || ctx.templateBody || '',
                lang: ctx.lang
            }));
        }
        if (!f.NAME) put('NAME', 'Patient');
        return f;
    }

    /**
     * Build Twilio contentVariables using per-template varMap.
     * Convention fallback when map missing: {{1}}=NAME {{2}}=CLINIC {{3}}=DATE {{4}}=TIME {{5}}=DOCTOR
     * @param {string|{vars?:string,varMap?:Object}} tplOrVars
     * @param {{name?:string,clinic?:string,date?:string,time?:string,doctor?:string,body?:string,fields?:Object,overrides?:Object}} ctx
     */
    ns.buildTwilioContentVariables = function(tplOrVars, ctx) {
        ctx = ctx || {};
        var varsStr = typeof tplOrVars === 'string'
            ? tplOrVars
            : ((tplOrVars && tplOrVars.vars) || '1');
        var rawMap = typeof tplOrVars === 'object' && tplOrVars
            ? (tplOrVars.varMap || tplOrVars.var_map || null)
            : null;
        var varMap = normalizeTplVarMap(varsStr, rawMap);
        var keys = String(normalizeTplVars(varsStr) || '1').split(',').filter(Boolean);
        if (!keys.length) keys = ['1'];

        var fields = buildFieldBag(ctx);
        var overrides = (ctx.overrides && typeof ctx.overrides === 'object')
            ? ctx.overrides
            : {};
        var out = {};

        keys.forEach(function(k) {
            if (Object.prototype.hasOwnProperty.call(overrides, k) &&
                String(overrides[k] != null ? overrides[k] : '').trim() !== '') {
                out[k] = String(overrides[k]).trim().slice(0, 120);
                return;
            }
            var field = varMap[k] || TWILIO_DEFAULT_KEY_FIELD[k] || 'BODY';
            var val = fields[field];
            if (val == null || String(val).trim() === '') {
                // Meta rejects empty substitution values
                out[k] = '-';
                return;
            }
            out[k] = String(val).trim().slice(0, 120);
        });
        return out;
    };

    function renderTwilioTplExtraVars(tpl) {
        var box = pick('aiTwilioTplExtraVars');
        if (!box) return;
        box.innerHTML = '';
        if (!tpl) return;
        // Manual overrides only for fields not auto-filled from NAME (key 1 uses Name input).
        // Show mapped field labels so staff know what {{n}} means for this template.
        var map = normalizeTplVarMap(tpl.vars || '1', tpl.varMap);
        var keys = String(tpl.vars || '1').split(',').filter(Boolean);
        keys.forEach(function(k) {
            if (k === '1') return;
            var field = map[k] || '';
            var wrap = document.createElement('div');
            wrap.style.marginTop = '10px';
            var lab = document.createElement('label');
            lab.className = 'ai-label';
            lab.textContent = '{{' + k + '}}' +
                (field ? ' → {' + field + '}' : '') +
                ' (' + aiTr('ai.twilio.tplVarOverride') + ')';
            var inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'ai-input';
            inp.id = 'aiTwilioTplVar_' + k;
            inp.maxLength = 120;
            inp.setAttribute('data-tpl-var', k);
            inp.placeholder = field ? '{' + field + '}' : ('{{' + k + '}}');
            if (field === 'CLINIC') {
                var clinicDefault = defaultClinicForTwilio({
                    body: [tpl && tpl.notes, tpl && tpl.label, tpl && tpl.name, tpl && tpl.body]
                        .filter(Boolean).join('\n')
                });
                if (clinicDefault) inp.value = clinicDefault;
            }
            wrap.appendChild(lab);
            wrap.appendChild(inp);
            box.appendChild(wrap);
        });
    }

    function collectTwilioContentVariables(tpl, name) {
        var overrides = {};
        if (tpl) {
            var keys = String(tpl.vars || '1').split(',').filter(Boolean);
            keys.forEach(function(k) {
                if (k === '1') return;
                var el = pick('aiTwilioTplVar_' + k);
                if (el) overrides[k] = String(el.value || '').trim();
            });
        }
        return ns.buildTwilioContentVariables(tpl, {
            name: name || 'Patient',
            clinic: defaultClinicForTwilio({
                body: [tpl && tpl.notes, tpl && tpl.label, tpl && tpl.name, tpl && tpl.body]
                    .filter(Boolean).join('\n')
            }),
            overrides: overrides
        });
    }

    function paintTwilioTplSelect() {
        var sel = pick('aiTwilioTpl');
        if (!sel) return;
        var store = loadTwilioTplStore();
        var prev = sel.value || store.selectedId;
        sel.innerHTML = '';
        store.templates.forEach(function(t) {
            var o = document.createElement('option');
            o.value = t.id;
            o.textContent = t.label + ' · ' + t.contentSid.slice(0, 10) + '…';
            sel.appendChild(o);
        });
        var exists = false;
        for (var i = 0; i < store.templates.length; i++) {
            if (store.templates[i].id === prev) {
                exists = true;
                break;
            }
        }
        sel.value = exists ? prev : (store.templates[0] ? store.templates[0].id : '');
        store.selectedId = sel.value;
        saveTwilioTplStore(store);
        ns.onTwilioTplChange();
        if (_tplDbMissing) {
            setTwilioStatus(aiTr('ai.twilio.tplDbMissing'), true);
        }
    }

    ns.refreshTwilioTplSelect = function() {
        return ensureTwilioTplCache(false).then(function() {
            paintTwilioTplSelect();
        });
    };

    ns.reloadTwilioContentTemplates = function() {
        _tplDbReady = false;
        return ensureTwilioTplCache(true).then(function() {
            paintTwilioTplSelect();
            setTwilioStatus(
                _tplDbMissing
                    ? aiTr('ai.twilio.tplDbMissing')
                    : aiTr('ai.twilio.tplReloaded'),
                !!_tplDbMissing
            );
            return loadTwilioTplStore().templates.slice();
        });
    };

    ns.ensureTwilioContentTemplates = function(force) {
        return ensureTwilioTplCache(!!force);
    };

    ns.onTwilioTplChange = function() {
        var sel = pick('aiTwilioTpl');
        var store = loadTwilioTplStore();
        store.selectedId = sel ? String(sel.value || '') : store.selectedId;
        saveTwilioTplStore(store);
        var tpl = getSelectedTwilioTpl();
        fillTwilioTplForm(tpl);
        renderTwilioTplExtraVars(tpl);
        syncTwilioTplHint();
    };

    /** Re-draw mapping rows when Variable keys text changes; keep chosen fields where possible. */
    ns.onTwilioTplVarsInput = function() {
        var varsEl = pick('aiTwilioTplVars');
        var vars = varsEl ? String(varsEl.value || '1') : '1';
        var current = readTwilioTplVarMapFromUi(vars);
        renderTwilioTplVarMapUi(vars, current);
    };

    /**
     * Programmatic clinic-wide template APIs (Broadcast tab, AI Helper UI).
     * @returns {Promise<{ok:boolean, id?:string, error?:string, templates?:Array}>}
     */
    ns.addTwilioContentTemplate = function(opts) {
        opts = opts || {};
        var sid = normalizeContentSid(opts.contentSid || opts.content_sid || '');
        if (!sid) {
            return Promise.resolve({ ok: false, error: 'sid' });
        }
        var form = {
            label: String(opts.label || '').trim() || sid,
            contentSid: sid,
            vars: normalizeTplVars(opts.vars || '1'),
            varMap: normalizeTplVarMap(opts.vars || '1', opts.varMap || opts.var_map || null),
            notes: String(opts.notes || '').trim().slice(0, 1000)
        };
        // Always refresh from Supabase before write — never silently save local-only.
        return ensureTwilioTplCache(true).then(function() {
            if (!_tplDbReady || _tplDbMissing || typeof SB === 'undefined') {
                return { ok: false, error: 'db_missing' };
            }
            var store = loadTwilioTplStore();
            for (var i = 0; i < store.templates.length; i++) {
                if (store.templates[i].contentSid === form.contentSid) {
                    return { ok: false, error: 'dup' };
                }
            }
            var insertRow = {
                label: form.label,
                content_sid: form.contentSid,
                vars: form.vars,
                var_map: form.varMap,
                notes: form.notes || null,
                sort_order: store.templates.length,
                created_by: callerUserIdForTpl()
            };
            return SB.from(TWILIO_TPL_TABLE).insert([insertRow]).select('id').single().then(function(r) {
                if (r.error && tplVarMapColumnMissing(r.error)) {
                    delete insertRow.var_map;
                    return SB.from(TWILIO_TPL_TABLE).insert([insertRow]).select('id').single();
                }
                return r;
            }).then(function(r) {
                if (r.error) {
                    var msg = String(r.error.message || '');
                    if (/duplicate|unique/i.test(msg)) return { ok: false, error: 'dup' };
                    if (tplTableMissing(r.error)) return { ok: false, error: 'db_missing' };
                    return { ok: false, error: msg };
                }
                var newId = r.data && r.data.id ? String(r.data.id) : '';
                if (newId) writeSelectedTplPref(newId);
                return ensureTwilioTplCache(true).then(function() {
                    paintTwilioTplSelect();
                    return {
                        ok: true,
                        id: newId,
                        templates: loadTwilioTplStore().templates.slice()
                    };
                });
            });
        });
    };

    ns.updateTwilioContentTemplate = function(id, opts) {
        opts = opts || {};
        var tplId = String(id || '').trim();
        if (!tplId || tplId === '__new__') {
            return Promise.resolve({ ok: false, error: 'select' });
        }
        var sid = normalizeContentSid(opts.contentSid || opts.content_sid || '');
        if (!sid) return Promise.resolve({ ok: false, error: 'sid' });
        var form = {
            label: String(opts.label || '').trim() || sid,
            contentSid: sid,
            vars: normalizeTplVars(opts.vars || '1'),
            varMap: normalizeTplVarMap(opts.vars || '1', opts.varMap || opts.var_map || null),
            notes: String(opts.notes || '').trim().slice(0, 1000)
        };
        return ensureTwilioTplCache(true).then(function() {
            if (!_tplDbReady || _tplDbMissing || typeof SB === 'undefined') {
                return { ok: false, error: 'db_missing' };
            }
            var store = loadTwilioTplStore();
            var prev = null;
            for (var i = 0; i < store.templates.length; i++) {
                if (store.templates[i].id === tplId) {
                    prev = store.templates[i];
                    break;
                }
            }
            if (!prev) return { ok: false, error: 'select' };

            var patch = {
                label: form.label,
                content_sid: form.contentSid,
                vars: form.vars,
                var_map: form.varMap,
                notes: form.notes || null,
                updated_at: new Date().toISOString()
            };
            return SB.from(TWILIO_TPL_TABLE).update(patch).eq('id', prev.id).then(function(r) {
                if (r.error && tplVarMapColumnMissing(r.error)) {
                    delete patch.var_map;
                    return SB.from(TWILIO_TPL_TABLE).update(patch).eq('id', prev.id);
                }
                return r;
            }).then(function(r) {
                if (r.error) {
                    if (tplTableMissing(r.error)) return { ok: false, error: 'db_missing' };
                    return { ok: false, error: String(r.error.message || '') };
                }
                writeSelectedTplPref(prev.id);
                return ensureTwilioTplCache(true).then(function() {
                    paintTwilioTplSelect();
                    return {
                        ok: true,
                        id: prev.id,
                        templates: loadTwilioTplStore().templates.slice()
                    };
                });
            });
        });
    };

    ns.removeTwilioContentTemplate = function(id) {
        var tplId = String(id || '').trim();
        if (!tplId || tplId === '__new__') {
            return Promise.resolve({ ok: false, error: 'select' });
        }
        return ensureTwilioTplCache(true).then(function() {
            if (!_tplDbReady || _tplDbMissing || typeof SB === 'undefined') {
                return { ok: false, error: 'db_missing' };
            }
            var store = loadTwilioTplStore();
            var row = null;
            for (var i = 0; i < store.templates.length; i++) {
                if (store.templates[i].id === tplId) {
                    row = store.templates[i];
                    break;
                }
            }
            if (!row) return { ok: false, error: 'select' };
            if (store.templates.length <= 1) return { ok: false, error: 'keep_one' };

            return SB.from(TWILIO_TPL_TABLE).update({
                is_active: false,
                updated_at: new Date().toISOString()
            }).eq('id', tplId).then(function(r) {
                if (r.error) {
                    if (tplTableMissing(r.error)) return { ok: false, error: 'db_missing' };
                    return { ok: false, error: String(r.error.message || '') };
                }
                return ensureTwilioTplCache(true).then(function() {
                    paintTwilioTplSelect();
                    return {
                        ok: true,
                        templates: loadTwilioTplStore().templates.slice()
                    };
                });
            });
        });
    };

    ns.saveTwilioTpl = function() {
        var form = readTwilioTplForm();
        if (form.error === 'sid') {
            alert(aiTr('ai.twilio.needTplSid'));
            return;
        }
        var sel = pick('aiTwilioTpl');
        var id = sel ? String(sel.value || '') : '';
        // No selection / unknown id → add as new
        if (!id || id === '__new__' || !ns.getTwilioContentTemplate(id)) {
            ns.addTwilioTpl();
            return;
        }
        setTwilioStatus(aiTr('ai.twilio.tplSaving'), false);
        ns.updateTwilioContentTemplate(id, form).then(function(res) {
            if (!res || !res.ok) {
                if (res && res.error === 'db_missing') alert(aiTr('ai.twilio.tplDbMissing'));
                else if (res && res.error === 'select') {
                    ns.addTwilioTpl();
                    return;
                } else if (res && res.error === 'sid') alert(aiTr('ai.twilio.needTplSid'));
                else alert(aiTr('ai.twilio.tplSaveFail') + (res && res.error ? '\n\n' + res.error : ''));
                setTwilioStatus((res && res.error) || aiTr('ai.twilio.tplSaveFail'), true);
                return;
            }
            setTwilioStatus(aiTr('ai.twilio.tplSavedClinic'), false);
        });
    };

    ns.addTwilioTpl = function() {
        var form = readTwilioTplForm();
        if (form.error === 'sid') {
            alert(aiTr('ai.twilio.needTplSid'));
            return;
        }
        setTwilioStatus(aiTr('ai.twilio.tplSaving'), false);
        ns.addTwilioContentTemplate(form).then(function(res) {
            if (!res || !res.ok) {
                if (res && res.error === 'dup') alert(aiTr('ai.twilio.tplDupSid'));
                else if (res && res.error === 'db_missing') alert(aiTr('ai.twilio.tplDbMissing'));
                else if (res && res.error === 'sid') alert(aiTr('ai.twilio.needTplSid'));
                else alert(aiTr('ai.twilio.tplSaveFail') + (res && res.error ? '\n\n' + res.error : ''));
                setTwilioStatus((res && res.error) || aiTr('ai.twilio.tplSaveFail'), true);
                return;
            }
            setTwilioStatus(aiTr('ai.twilio.tplAddedClinic'), false);
        });
    };

    ns.removeTwilioTpl = function() {
        var sel = pick('aiTwilioTpl');
        var id = sel ? String(sel.value || '') : '';
        var store = loadTwilioTplStore();
        var row = null;
        for (var i = 0; i < store.templates.length; i++) {
            if (store.templates[i].id === id) {
                row = store.templates[i];
                break;
            }
        }
        if (!row) {
            alert(aiTr('ai.twilio.needTplSelect'));
            return;
        }
        if (!window.confirm(aiTr('ai.twilio.tplRemoveConfirm').replace('{label}', row.label))) {
            return;
        }
        setTwilioStatus(aiTr('ai.twilio.tplSaving'), false);
        ns.removeTwilioContentTemplate(id).then(function(res) {
            if (!res || !res.ok) {
                if (res && res.error === 'keep_one') alert(aiTr('ai.twilio.tplKeepOne'));
                else if (res && res.error === 'select') alert(aiTr('ai.twilio.needTplSelect'));
                else alert(aiTr('ai.twilio.tplSaveFail') + (res && res.error ? '\n\n' + res.error : ''));
                setTwilioStatus((res && res.error) || aiTr('ai.twilio.tplSaveFail'), true);
                return;
            }
            setTwilioStatus(aiTr('ai.twilio.tplRemovedClinic'), false);
        });
    };

    var TWILIO_FROM_TABLE = 'twilio_from_numbers';
    var TWILIO_FROM_SELECTED_KEY = 'ai_twilio_from_selected_v1';
    var _fromCache = null;
    var _fromLoadPromise = null;
    var _fromDbReady = false;
    var _fromDbMissing = false;

    function normalizeE164Phone(raw) {
        var s = String(raw || '').trim();
        if (!s) return '';
        // Accept pasted Twilio WhatsApp addresses
        s = s.replace(/^whatsapp:\s*/i, '');
        // Spaces, dashes, parentheses, dots, NBSP
        s = s.replace(/[\s()\-.\u00a0\u3000]/g, '');
        // International dial prefix 00… → +…
        if (/^00[1-9]/.test(s)) s = '+' + s.slice(2);
        if (!s) return '';
        if (s.charAt(0) !== '+') {
            var digitsOnly = s.replace(/\D/g, '');
            if (digitsOnly.length >= 8 && digitsOnly.length <= 15) s = '+' + digitsOnly;
            else return '';
        } else {
            s = '+' + s.slice(1).replace(/\D/g, '');
        }
        // E.164: + then 8–15 digits, first digit 1–9
        if (!/^\+[1-9]\d{7,14}$/.test(s)) return '';
        return s;
    }

    function formatTwilioFromAddress(phone, channel) {
        var e164 = normalizeE164Phone(phone);
        if (!e164) return '';
        if (channel === 'whatsapp') return 'whatsapp:' + e164;
        return e164;
    }

    function normalizeFromRow(n) {
        if (!n || typeof n !== 'object') return null;
        var phone = normalizeE164Phone(n.phone);
        if (!phone) return null;
        var id = String(n.id || '').trim();
        if (!id) id = 'n_' + phone.replace(/\D/g, '').slice(-10);
        return {
            id: id,
            label: String(n.label || '').trim() || phone,
            phone: phone,
            whatsapp: n.whatsapp !== false,
            sms: n.sms !== false
        };
    }

    function readSelectedFromPref() {
        try {
            return String(localStorage.getItem(TWILIO_FROM_SELECTED_KEY) || '').trim() || 'default';
        } catch (e) {
            return 'default';
        }
    }

    function writeSelectedFromPref(id) {
        try {
            localStorage.setItem(TWILIO_FROM_SELECTED_KEY, String(id || 'default'));
        } catch (e) { /* ignore */ }
    }

    function readLegacyLocalFromNumbers() {
        try {
            var raw = localStorage.getItem(TWILIO_FROM_LS_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return [];
            var nums = Array.isArray(parsed.numbers) ? parsed.numbers : [];
            return nums.map(normalizeFromRow).filter(Boolean);
        } catch (e) {
            return [];
        }
    }

    function setFromCache(numbers, selectedId) {
        var list = Array.isArray(numbers) ? numbers.slice() : [];
        var sel = String(selectedId || readSelectedFromPref() || 'default');
        if (sel !== 'default') {
            var found = false;
            for (var i = 0; i < list.length; i++) {
                if (list[i].id === sel) { found = true; break; }
            }
            if (!found) sel = 'default';
        }
        _fromCache = { selectedId: sel, numbers: list };
        writeSelectedFromPref(sel);
        return _fromCache;
    }

    function loadTwilioFromStore() {
        if (_fromCache) return _fromCache;
        return setFromCache(readLegacyLocalFromNumbers(), readSelectedFromPref());
    }

    function saveTwilioFromStore(store) {
        if (!store) return;
        _fromCache = {
            selectedId: String(store.selectedId || 'default'),
            numbers: Array.isArray(store.numbers) ? store.numbers.slice() : []
        };
        writeSelectedFromPref(_fromCache.selectedId);
        // Keep legacy key in sync for older code paths / offline fallback
        try {
            localStorage.setItem(TWILIO_FROM_LS_KEY, JSON.stringify(_fromCache));
        } catch (e) { /* ignore */ }
    }

    function fromTableMissing(err) {
        var msg = String((err && err.message) || err || '');
        return /twilio_from_numbers|does not exist|schema cache|Could not find the table/i.test(msg);
    }

    function mapDbRowToFrom(row) {
        if (!row) return null;
        return normalizeFromRow({
            id: row.id,
            label: row.label,
            phone: row.phone,
            whatsapp: row.whatsapp,
            sms: row.sms
        });
    }

    function migrateLegacyFromToDb() {
        var legacy = readLegacyLocalFromNumbers();
        if (!legacy.length || typeof SB === 'undefined') return Promise.resolve(0);
        var chain = Promise.resolve(0);
        legacy.forEach(function(n, idx) {
            chain = chain.then(function(count) {
                return SB.from(TWILIO_FROM_TABLE).insert([{
                    label: n.label,
                    phone: n.phone,
                    whatsapp: n.whatsapp !== false,
                    sms: n.sms !== false,
                    sort_order: idx,
                    created_by: callerUserIdForTpl() || 'migrate'
                }]).then(function(r) {
                    return r.error ? count : count + 1;
                });
            });
        });
        return chain;
    }

    function fetchTwilioFromFromDb() {
        if (typeof SB === 'undefined') {
            _fromDbReady = false;
            return Promise.resolve(setFromCache(readLegacyLocalFromNumbers(), readSelectedFromPref()));
        }
        return SB.from(TWILIO_FROM_TABLE)
            .select('id,label,phone,whatsapp,sms,sort_order,is_active')
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .order('label', { ascending: true })
            .then(function(r) {
                if (r.error) {
                    if (fromTableMissing(r.error)) {
                        _fromDbMissing = true;
                        _fromDbReady = false;
                        return setFromCache(readLegacyLocalFromNumbers(), readSelectedFromPref());
                    }
                    _fromDbReady = false;
                    return setFromCache(readLegacyLocalFromNumbers(), readSelectedFromPref());
                }
                _fromDbMissing = false;
                _fromDbReady = true;
                var list = (r.data || []).map(mapDbRowToFrom).filter(Boolean);
                if (!list.length) {
                    return migrateLegacyFromToDb().then(function(migrated) {
                        if (!migrated) {
                            setFromCache([], readSelectedFromPref());
                            return _fromCache;
                        }
                        return SB.from(TWILIO_FROM_TABLE)
                            .select('id,label,phone,whatsapp,sms,sort_order,is_active')
                            .eq('is_active', true)
                            .order('sort_order', { ascending: true })
                            .order('label', { ascending: true })
                            .then(function(r2) {
                                var list2 = (r2.data || []).map(mapDbRowToFrom).filter(Boolean);
                                setFromCache(list2, readSelectedFromPref());
                                return _fromCache;
                            });
                    });
                }
                setFromCache(list, readSelectedFromPref());
                return _fromCache;
            });
    }

    function ensureTwilioFromCache(force) {
        if (!force && _fromCache && _fromDbReady) {
            return Promise.resolve(_fromCache);
        }
        if (!force && _fromLoadPromise) return _fromLoadPromise;
        _fromLoadPromise = fetchTwilioFromFromDb().then(function(store) {
            _fromLoadPromise = null;
            return store;
        }).catch(function() {
            _fromLoadPromise = null;
            return loadTwilioFromStore();
        });
        return _fromLoadPromise;
    }

    function getSelectedTwilioFrom() {
        var store = loadTwilioFromStore();
        var sel = pick('aiTwilioFrom');
        var id = sel ? String(sel.value || store.selectedId || 'default') : (store.selectedId || 'default');
        if (!id || id === 'default') return null;
        for (var i = 0; i < store.numbers.length; i++) {
            if (store.numbers[i].id === id) return store.numbers[i];
        }
        return null;
    }

    function syncTwilioFromHint() {
        var hint = pick('aiTwilioFromHint');
        if (!hint) return;
        var row = getSelectedTwilioFrom();
        var isWa = _twilioChannel === 'whatsapp';
        if (!row) {
            hint.setAttribute('data-i18n', 'ai.twilio.fromHintDefault');
            hint.textContent = aiTr('ai.twilio.fromHintDefault');
            return;
        }
        var addr = formatTwilioFromAddress(row.phone, isWa ? 'whatsapp' : 'sms');
        var key = isWa ? 'ai.twilio.fromHintWa' : 'ai.twilio.fromHintSms';
        hint.setAttribute('data-i18n', key);
        hint.textContent = aiTr(key).replace('{from}', addr || row.phone);
    }

    function paintTwilioFromSelect() {
        var sel = pick('aiTwilioFrom');
        if (!sel) return;
        var store = loadTwilioFromStore();
        var prev = sel.value || store.selectedId || 'default';
        var channel = _twilioChannel === 'sms' ? 'sms' : 'whatsapp';
        sel.innerHTML = '';

        var defOpt = document.createElement('option');
        defOpt.value = 'default';
        defOpt.textContent = aiTr('ai.twilio.fromDefault');
        sel.appendChild(defOpt);

        var shown = [];
        store.numbers.forEach(function(n) {
            if (channel === 'whatsapp' && n.whatsapp === false) return;
            if (channel === 'sms' && n.sms === false) return;
            shown.push(n);
            var o = document.createElement('option');
            o.value = n.id;
            var caps = [];
            if (n.whatsapp) caps.push('WA');
            if (n.sms) caps.push('SMS');
            o.textContent =
                n.label +
                ' · ' +
                n.phone +
                (caps.length ? ' (' + caps.join('/') + ')' : '');
            sel.appendChild(o);
        });

        var exists = prev === 'default';
        if (!exists) {
            for (var i = 0; i < shown.length; i++) {
                if (shown[i].id === prev) {
                    exists = true;
                    break;
                }
            }
        }
        sel.value = exists ? prev : 'default';
        store.selectedId = sel.value;
        saveTwilioFromStore(store);
        syncTwilioFromHint();
        if (_fromDbMissing) {
            setTwilioStatus(aiTr('ai.twilio.fromDbMissing'), true);
        }
    }

    ns.refreshTwilioFromSelect = function() {
        return ensureTwilioFromCache(false).then(function() {
            paintTwilioFromSelect();
        });
    };

    ns.ensureTwilioFromNumbers = function(force) {
        return ensureTwilioFromCache(!!force);
    };

    ns.reloadTwilioFromNumbers = function() {
        _fromDbReady = false;
        return ensureTwilioFromCache(true).then(function() {
            paintTwilioFromSelect();
            setTwilioStatus(
                _fromDbMissing ? aiTr('ai.twilio.fromDbMissing') : aiTr('ai.twilio.fromReloaded'),
                !!_fromDbMissing
            );
            return loadTwilioFromStore().numbers.slice();
        });
    };

    ns.onTwilioFromChange = function() {
        var sel = pick('aiTwilioFrom');
        var store = loadTwilioFromStore();
        store.selectedId = sel ? String(sel.value || 'default') : 'default';
        saveTwilioFromStore(store);
        syncTwilioFromHint();
    };

    /** @returns {Promise<{ok:boolean, id?:string, error?:string, numbers?:Array}>} */
    ns.addTwilioFromNumberOpts = function(opts) {
        opts = opts || {};
        var phone = normalizeE164Phone(opts.phone);
        if (!phone) return Promise.resolve({ ok: false, error: 'phone' });
        var wa = opts.whatsapp !== false;
        var sms = opts.sms !== false;
        if (!wa && !sms) return Promise.resolve({ ok: false, error: 'caps' });
        var label = String(opts.label || '').trim() || phone;

        // Always refresh from Supabase before write — never silently save local-only.
        return ensureTwilioFromCache(true).then(function() {
            if (!_fromDbReady || _fromDbMissing || typeof SB === 'undefined') {
                return { ok: false, error: 'db_missing' };
            }
            var store = loadTwilioFromStore();
            for (var i = 0; i < store.numbers.length; i++) {
                if (store.numbers[i].phone === phone) return { ok: false, error: 'dup' };
            }

            return SB.from(TWILIO_FROM_TABLE).insert([{
                label: label,
                phone: phone,
                whatsapp: wa,
                sms: sms,
                sort_order: store.numbers.length,
                created_by: callerUserIdForTpl()
            }]).select('id').single().then(function(r) {
                if (r.error) {
                    var msg = String(r.error.message || '');
                    if (/duplicate|unique/i.test(msg)) return { ok: false, error: 'dup' };
                    if (fromTableMissing(r.error)) return { ok: false, error: 'db_missing' };
                    return { ok: false, error: msg };
                }
                var newId = r.data && r.data.id ? String(r.data.id) : '';
                if (newId) writeSelectedFromPref(newId);
                return ensureTwilioFromCache(true).then(function() {
                    paintTwilioFromSelect();
                    return {
                        ok: true,
                        id: newId,
                        numbers: loadTwilioFromStore().numbers.slice()
                    };
                });
            });
        });
    };

    ns.updateTwilioFromNumberOpts = function(id, opts) {
        opts = opts || {};
        var fromId = String(id || '').trim();
        if (!fromId || fromId === 'default' || fromId === '__new__') {
            return Promise.resolve({ ok: false, error: 'select' });
        }
        var phone = normalizeE164Phone(opts.phone);
        if (!phone) return Promise.resolve({ ok: false, error: 'phone' });
        var wa = opts.whatsapp !== false;
        var sms = opts.sms !== false;
        if (!wa && !sms) return Promise.resolve({ ok: false, error: 'caps' });
        var label = String(opts.label || '').trim() || phone;

        return ensureTwilioFromCache(true).then(function() {
            if (!_fromDbReady || _fromDbMissing || typeof SB === 'undefined') {
                return { ok: false, error: 'db_missing' };
            }
            var store = loadTwilioFromStore();
            var prev = null;
            for (var i = 0; i < store.numbers.length; i++) {
                if (store.numbers[i].id === fromId) {
                    prev = store.numbers[i];
                    break;
                }
            }
            if (!prev) return { ok: false, error: 'select' };

            return SB.from(TWILIO_FROM_TABLE).update({
                label: label,
                phone: phone,
                whatsapp: wa,
                sms: sms,
                updated_at: new Date().toISOString()
            }).eq('id', prev.id).then(function(r) {
                if (r.error) {
                    if (fromTableMissing(r.error)) return { ok: false, error: 'db_missing' };
                    return { ok: false, error: String(r.error.message || '') };
                }
                writeSelectedFromPref(prev.id);
                return ensureTwilioFromCache(true).then(function() {
                    paintTwilioFromSelect();
                    return {
                        ok: true,
                        id: prev.id,
                        numbers: loadTwilioFromStore().numbers.slice()
                    };
                });
            });
        });
    };

    ns.removeTwilioFromNumberOpts = function(id) {
        var fromId = String(id || '').trim();
        if (!fromId || fromId === 'default' || fromId === '__new__') {
            return Promise.resolve({ ok: false, error: 'default' });
        }
        return ensureTwilioFromCache(true).then(function() {
            if (!_fromDbReady || _fromDbMissing || typeof SB === 'undefined') {
                return { ok: false, error: 'db_missing' };
            }
            var store = loadTwilioFromStore();
            var row = null;
            for (var i = 0; i < store.numbers.length; i++) {
                if (store.numbers[i].id === fromId) {
                    row = store.numbers[i];
                    break;
                }
            }
            if (!row) return { ok: false, error: 'select' };

            return SB.from(TWILIO_FROM_TABLE).update({
                is_active: false,
                updated_at: new Date().toISOString()
            }).eq('id', fromId).then(function(r) {
                if (r.error) {
                    if (fromTableMissing(r.error)) return { ok: false, error: 'db_missing' };
                    return { ok: false, error: String(r.error.message || '') };
                }
                writeSelectedFromPref('default');
                return ensureTwilioFromCache(true).then(function() {
                    paintTwilioFromSelect();
                    return {
                        ok: true,
                        numbers: loadTwilioFromStore().numbers.slice()
                    };
                });
            });
        });
    };

    ns.addTwilioFromNumber = function() {
        var labelEl = pick('aiTwilioFromLabel');
        var phoneEl = pick('aiTwilioFromPhone');
        var capWa = pick('aiTwilioFromCapWa');
        var capSms = pick('aiTwilioFromCapSms');
        setTwilioStatus(aiTr('ai.twilio.fromSaving'), false);
        ns.addTwilioFromNumberOpts({
            label: labelEl ? labelEl.value : '',
            phone: phoneEl ? phoneEl.value : '',
            whatsapp: !capWa || !!capWa.checked,
            sms: !capSms || !!capSms.checked
        }).then(function(res) {
            if (!res || !res.ok) {
                if (res && res.error === 'phone') alert(aiTr('ai.twilio.needFromPhone'));
                else if (res && res.error === 'caps') alert(aiTr('ai.twilio.needFromCap'));
                else if (res && res.error === 'dup') alert(aiTr('ai.twilio.fromDup'));
                else if (res && res.error === 'db_missing') alert(aiTr('ai.twilio.fromDbMissing'));
                else alert(aiTr('ai.twilio.fromSaveFail') + (res && res.error ? '\n\n' + res.error : ''));
                setTwilioStatus((res && res.error) || aiTr('ai.twilio.fromSaveFail'), true);
                return;
            }
            if (labelEl) labelEl.value = '';
            if (phoneEl) phoneEl.value = '';
            setTwilioStatus(aiTr('ai.twilio.fromAddedClinic'), false);
        });
    };

    ns.removeTwilioFromNumber = function() {
        var sel = pick('aiTwilioFrom');
        var id = sel ? String(sel.value || '') : '';
        if (!id || id === 'default') {
            alert(aiTr('ai.twilio.cannotRemoveDefault'));
            return;
        }
        setTwilioStatus(aiTr('ai.twilio.fromSaving'), false);
        ns.removeTwilioFromNumberOpts(id).then(function(res) {
            if (!res || !res.ok) {
                alert(aiTr('ai.twilio.fromSaveFail') + (res && res.error ? '\n\n' + res.error : ''));
                setTwilioStatus((res && res.error) || aiTr('ai.twilio.fromSaveFail'), true);
                return;
            }
            setTwilioStatus(aiTr('ai.twilio.fromRemovedClinic'), false);
        });
    };

    function syncTwilioChannelUi() {
        var waBtn = pick('aiTwilioChWa');
        var smsBtn = pick('aiTwilioChSms');
        var waFields = pick('aiTwilioWaFields');
        var modeHint = pick('aiTwilioModeHint');
        var sendBtn = pick('aiTwilioSendBtn');
        var isWa = _twilioChannel === 'whatsapp';
        if (waBtn) waBtn.classList.toggle('is-active', isWa);
        if (smsBtn) smsBtn.classList.toggle('is-active', !isWa);
        if (waFields) waFields.style.display = isWa ? 'block' : 'none';
        if (modeHint) {
            modeHint.setAttribute(
                'data-i18n',
                isWa ? 'ai.twilio.mode.wa' : 'ai.twilio.mode.sms'
            );
            modeHint.textContent = aiTr(isWa ? 'ai.twilio.mode.wa' : 'ai.twilio.mode.sms');
        }
        if (sendBtn) {
            sendBtn.className = 'ai-channel-btn ' + (isWa ? 'whatsapp' : 'sms');
            sendBtn.setAttribute('data-i18n', 'ai.twilio.btn.send');
            sendBtn.textContent = aiTr('ai.twilio.btn.send');
        }
        syncTwilioFromHint();
        syncTwilioTplHint();
    }

    ns.setTwilioChannel = function(ch) {
        _twilioChannel = (ch === 'sms') ? 'sms' : 'whatsapp';
        syncTwilioChannelUi();
        ns.refreshTwilioFromSelect();
    };

    /**
     * Prefill Twilio Send from Birthday/Recall and open the panel.
     * @param {'birth'|'recall'} side
     * @param {'whatsapp'|'sms'} channel
     */
    ns.prepareTwilioSend = function(side, channel) {
        var isBirth = side === 'birth';
        var outId = isBirth ? 'aiBirthOutput' : 'aiRecallOutput';
        var selId = isBirth ? 'aiBirthBulkTarget' : 'aiRecallBulkTarget';
        var bodyPack = '';
        var outEl = pick(outId);
        if (outEl) bodyPack = String(outEl.value || '').trim();

        var gid = trimmedVal(selId);
        var gb = resolvedGuestBirth();
        var gr = resolvedGuestRecall();
        var p = patientRowById(gid);
        if (!p && gb && gid === gb.id && isBirth) p = gb;
        if (!p && gr && gid === gr.id && !isBirth) p = gr;

        _twilioChannel = (channel === 'sms') ? 'sms' : 'whatsapp';

        var srcEl = pick('aiTwilioDraftSource');
        if (srcEl) srcEl.value = isBirth ? 'birth' : 'recall';

        var bodyEl = pick('aiTwilioBody');
        if (bodyEl) bodyEl.value = bodyPack;

        ns.switchTab('twilio');
        ns.refreshTwilioFromSelect();
        ns.refreshTwilioTplSelect();
        ns.refreshTwilioRecipients();

        if (p) {
            var recip = pick('aiTwilioRecipient');
            if (recip) {
                var hasOpt = false;
                for (var i = 0; i < recip.options.length; i++) {
                    if (recip.options[i].value === p.id) {
                        hasOpt = true;
                        break;
                    }
                }
                if (hasOpt) recip.value = p.id;
            }
            var toEl = pick('aiTwilioTo');
            var nameEl = pick('aiTwilioName');
            if (toEl && p.phone_number) toEl.value = String(p.phone_number || '').trim();
            if (nameEl && p.full_name) {
                nameEl.value = String(p.full_name || '').trim().split(/\s+/)[0] || '';
            }
        }

        syncTwilioChannelUi();
        setTwilioStatus(aiTr('ai.twilio.prefilled'), false);
        var panel = pick('aiPanelTwilio');
        if (panel && typeof panel.scrollIntoView === 'function') {
            try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e2) { panel.scrollIntoView(true); }
        }
    };

    ns.refreshTwilioRecipients = function() {
        var sel = pick('aiTwilioRecipient');
        if (!sel) return;
        var prev = sel.value;
        var seen = Object.create(null);
        var rows = [];

        function pushUnique(list) {
            (list || []).forEach(function(p) {
                if (!p || !p.id || seen[p.id]) return;
                seen[p.id] = true;
                rows.push(p);
            });
        }
        pushUnique(collectChecked('birth'));
        pushUnique(collectChecked('recall'));
        var gb = resolvedGuestBirth();
        var gr = resolvedGuestRecall();
        if (gb) pushUnique([gb]);
        if (gr && (!gb || gr.id !== gb.id)) pushUnique([gr]);

        sel.innerHTML = '';
        var blank = document.createElement('option');
        blank.value = '';
        blank.textContent = aiTr('ai.twilio.recipientNone');
        sel.appendChild(blank);

        rows.forEach(function(p) {
            var o = document.createElement('option');
            o.value = p.id;
            var no = String(p.patient_no || '').trim();
            var nm = String(p.full_name || '').trim();
            o.textContent = (no ? ('#' + no + ' · ') : '') + nm;
            sel.appendChild(o);
        });

        if (prev && seen[prev]) sel.value = prev;
        else if (rows.length === 1) sel.value = rows[0].id;
        ns.onTwilioRecipientChange();
    };

    ns.onTwilioRecipientChange = function() {
        var sel = pick('aiTwilioRecipient');
        var id = sel ? String(sel.value || '').trim() : '';
        if (!id) return;
        var p = patientRowById(id);
        if (!p) {
            var gb = resolvedGuestBirth();
            var gr = resolvedGuestRecall();
            if (gb && gb.id === id) p = gb;
            else if (gr && gr.id === id) p = gr;
        }
        if (!p) return;
        var toEl = pick('aiTwilioTo');
        var nameEl = pick('aiTwilioName');
        if (toEl && p.phone_number) toEl.value = String(p.phone_number || '').trim();
        if (nameEl && p.full_name) {
            nameEl.value = String(p.full_name || '').trim().split(/\s+/)[0] || '';
        }
    };

    ns.loadTwilioDraft = function() {
        var srcEl = pick('aiTwilioDraftSource');
        var src = srcEl ? String(srcEl.value || 'custom') : 'custom';
        var bodyEl = pick('aiTwilioBody');
        if (!bodyEl) return;
        if (src === 'birth') {
            var b = pick('aiBirthOutput');
            bodyEl.value = b ? String(b.value || '') : '';
        } else if (src === 'recall') {
            var r = pick('aiRecallOutput');
            bodyEl.value = r ? String(r.value || '') : '';
        }
        ns.refreshTwilioRecipients();
    };

    /**
     * Send SMS or WhatsApp via Edge Function twilio-whatsapp.
     * WhatsApp → selected Content Template + contentVariables
     * SMS → free-form body from clinic Twilio number
     * Optional payload.from overrides Edge secret when a saved number is selected.
     */
    ns.sendTwilioMessage = function() {
        var toEl = pick('aiTwilioTo');
        var nameEl = pick('aiTwilioName');
        var bodyEl = pick('aiTwilioBody');
        var btn = pick('aiTwilioSendBtn');
        var to = toEl ? String(toEl.value || '').trim() : '';
        var name = nameEl ? String(nameEl.value || '').trim() : '';
        var body = bodyEl ? String(bodyEl.value || '').trim() : '';
        var channel = _twilioChannel === 'sms' ? 'sms' : 'whatsapp';
        var caller = callerSnippet();
        var fromRow = getSelectedTwilioFrom();
        var tpl = getSelectedTwilioTpl();

        if (!caller.callerUserId) {
            alert(aiTr('ai.twilio.needLogin'));
            return;
        }
        if (!to) {
            alert(aiTr('ai.twilio.needPhone'));
            return;
        }
        if (channel === 'sms' && !body) {
            alert(aiTr('ai.twilio.needBody'));
            return;
        }
        if (fromRow) {
            if (channel === 'whatsapp' && fromRow.whatsapp === false) {
                alert(aiTr('ai.twilio.fromNoWa'));
                return;
            }
            if (channel === 'sms' && fromRow.sms === false) {
                alert(aiTr('ai.twilio.fromNoSms'));
                return;
            }
        }
        if (channel === 'whatsapp') {
            if (!tpl || !tpl.contentSid) {
                alert(aiTr('ai.twilio.needTplSelect'));
                return;
            }
            var extraKeys = String(tpl.vars || '1').split(',').filter(function(k) {
                return k && k !== '1';
            });
            for (var ei = 0; ei < extraKeys.length; ei++) {
                var ek = extraKeys[ei];
                var eEl = pick('aiTwilioTplVar_' + ek);
                if (!eEl || !String(eEl.value || '').trim()) {
                    alert(aiTr('ai.twilio.needTplVar').replace('{n}', ek));
                    return;
                }
            }
        }
        if (!name) name = 'Patient';

        if (typeof SB === 'undefined' || !SB.functions ||
            typeof SB.functions.invoke !== 'function') {
            alert(aiTr('ai.twilio.apiDown'));
            return;
        }

        setTwilioStatus(aiTr('ai.twilio.sending'), false);
        if (btn) btn.disabled = true;

        var payload = withCaller({
            channel: channel,
            to: to,
            name: name
        });
        if (body) payload.body = body.slice(0, 1500);

        if (channel === 'whatsapp') {
            payload.contentSid = String(tpl.contentSid || '').trim();
            if (!payload.contentSid) {
                alert(aiTr('ai.twilio.needTplSelect'));
                if (btn) btn.disabled = false;
                return;
            }
            payload.contentVariables = collectTwilioContentVariables(tpl, name);
            // Debug aid in status while sending
            setTwilioStatus(
                aiTr('ai.twilio.sending') + ' · ' + payload.contentSid,
                false
            );
        }

        if (fromRow && fromRow.phone) {
            var fromAddr = formatTwilioFromAddress(fromRow.phone, channel);
            if (fromAddr) payload.from = fromAddr;
        } else if (channel === 'sms') {
            var autoFrom = resolveOutreachFrom('sms', '');
            if (autoFrom) {
                var autoAddr = formatTwilioFromAddress(autoFrom, 'sms');
                if (autoAddr) payload.from = autoAddr;
            }
        }

        SB.functions.invoke(TWILIO_WA_EDGE_FN, { body: payload })
            .then(function(res) {
                return parseTwilioInvokeResult(res).then(function(dataObj) {
                    if (btn) btn.disabled = false;
                    if (dataObj && dataObj.ok && dataObj.result) {
                        var sid = dataObj.result.sid ? String(dataObj.result.sid) : '';
                        var mode = dataObj.result.mode
                            ? String(dataObj.result.mode)
                            : channel;
                        var usedTpl = dataObj.result.contentSid
                            ? String(dataObj.result.contentSid)
                            : (channel === 'whatsapp' && tpl && tpl.contentSid
                                ? String(tpl.contentSid)
                                : '');
                        setTwilioStatus(
                            aiTr('ai.twilio.ok') +
                                (sid ? ' · ' + sid : '') +
                                ' (' + mode + ')' +
                                (usedTpl ? ' · ' + usedTpl : ''),
                            false
                        );
                        return;
                    }
                    var err =
                        (dataObj && (dataObj.error || dataObj.detail)) ||
                        aiTr('ai.twilio.fail');
                    err = humanizeTwilioSendError(err, payload.from);
                    setTwilioStatus(String(err), true);
                    alert(aiTr('ai.twilio.fail') + '\n\n' + String(err));
                });
            })
            .catch(function(e) {
                if (btn) btn.disabled = false;
                var msg = humanizeTwilioSendError(
                    (e && e.message) ? String(e.message) : aiTr('ai.twilio.apiDown'),
                    payload.from
                );
                setTwilioStatus(msg, true);
                alert(aiTr('ai.twilio.fail') + '\n\n' + msg);
            });
    };

    /** @deprecated use sendTwilioMessage — kept for any leftover callers */
    ns.sendTwilioWhatsAppTest = function() {
        _twilioChannel = 'whatsapp';
        syncTwilioChannelUi();
        var oldPhone = pick('aiTwilioWaTestPhone');
        var oldName = pick('aiTwilioWaTestName');
        var toEl = pick('aiTwilioTo');
        var nameEl = pick('aiTwilioName');
        var bodyEl = pick('aiTwilioBody');
        var outEl = pick('aiRecallOutput');
        if (toEl && oldPhone) toEl.value = String(oldPhone.value || '').trim();
        if (nameEl && oldName) nameEl.value = String(oldName.value || '').trim();
        if (bodyEl && outEl && !String(bodyEl.value || '').trim()) {
            bodyEl.value = String(outEl.value || '');
        }
        ns.sendTwilioMessage();
    };

    /**
     * Shared clinic-wide list (Supabase twilio_content_templates, cached).
     * Call ensureTwilioContentTemplates() before first use if dropdown may be empty.
     */
    ns.listTwilioContentTemplates = function() {
        return loadTwilioTplStore().templates.slice();
    };

    ns.getTwilioContentTemplate = function(id) {
        var store = loadTwilioTplStore();
        var want = String(id || '').trim();
        if (!want) return store.templates[0] || null;
        for (var i = 0; i < store.templates.length; i++) {
            if (store.templates[i].id === want) return store.templates[i];
        }
        // Also match by Content SID for older prefs
        for (var j = 0; j < store.templates.length; j++) {
            if (store.templates[j].contentSid === want) return store.templates[j];
        }
        return null;
    };

    /**
     * Clinic-wide From numbers (Supabase twilio_from_numbers, cached).
     * Call ensureTwilioFromNumbers() before first use if the list may be empty.
     */
    ns.listTwilioFromNumbers = function(channel) {
        var store = loadTwilioFromStore();
        var list = store.numbers.slice();
        if (channel === 'whatsapp') {
            return list.filter(function(n) { return n.whatsapp !== false; });
        }
        if (channel === 'sms') {
            return list.filter(function(n) { return n.sms !== false; });
        }
        return list;
    };

    ns.getTwilioFromNumber = function(id) {
        var store = loadTwilioFromStore();
        var want = String(id || '').trim();
        if (!want || want === 'default') return null;
        for (var i = 0; i < store.numbers.length; i++) {
            if (store.numbers[i].id === want) return store.numbers[i];
        }
        for (var j = 0; j < store.numbers.length; j++) {
            if (store.numbers[j].phone === want) return store.numbers[j];
        }
        return null;
    };

    ns.getTwilioFromDefaultLabel = function() {
        return aiTr('ai.twilio.fromDefault');
    };

    /**
     * Programmatic Twilio send (Appointment Recall, etc.).
     * @param {{channel:'whatsapp'|'sms', to:string, name?:string, body?:string, contentSid?:string, contentVariables?:Object, from?:string}} opts
     * @returns {Promise<{ok:boolean, result?:Object, error?:string}>}
     */
    ns.sendTwilioOutreach = function(opts) {
        opts = opts || {};
        var caller = callerSnippet();
        if (!caller.callerUserId) {
            return Promise.resolve({ ok: false, error: aiTr('ai.twilio.needLogin') });
        }
        if (typeof SB === 'undefined' || !SB.functions ||
            typeof SB.functions.invoke !== 'function') {
            return Promise.resolve({ ok: false, error: aiTr('ai.twilio.apiDown') });
        }
        var channel = opts.channel === 'sms' ? 'sms' : 'whatsapp';
        var to = String(opts.to || '').trim();
        var name = String(opts.name || 'Patient').trim() || 'Patient';
        var body = String(opts.body || '').trim();
        if (!to) {
            return Promise.resolve({ ok: false, error: aiTr('ai.twilio.needPhone') });
        }
        if (channel === 'sms' && !body) {
            return Promise.resolve({ ok: false, error: aiTr('ai.twilio.needBody') });
        }

        var payload = withCaller({
            channel: channel,
            to: to,
            name: name
        });
        if (body) payload.body = body.slice(0, 1500);

        if (channel === 'whatsapp') {
            var contentSid = normalizeContentSid(opts.contentSid);
            if (!contentSid && opts.templateId) {
                var tpl = ns.getTwilioContentTemplate(opts.templateId);
                if (tpl) contentSid = normalizeContentSid(tpl.contentSid);
            }
            if (!contentSid) {
                return Promise.resolve({ ok: false, error: aiTr('ai.twilio.needTplSelect') });
            }
            payload.contentSid = contentSid;
            if (opts.contentVariables && typeof opts.contentVariables === 'object') {
                payload.contentVariables = opts.contentVariables;
            } else {
                payload.contentVariables = { '1': name };
            }
        }

        if (opts.from) {
            var fromAddr = formatTwilioFromAddress(opts.from, channel);
            if (fromAddr) payload.from = fromAddr;
        } else if (channel === 'sms') {
            var autoFrom = resolveOutreachFrom('sms', '');
            if (autoFrom) {
                var autoAddr = formatTwilioFromAddress(autoFrom, 'sms');
                if (autoAddr) payload.from = autoAddr;
            }
        }

        return SB.functions.invoke(TWILIO_WA_EDGE_FN, { body: payload })
            .then(function(res) {
                return parseTwilioInvokeResult(res).then(function(dataObj) {
                    if (dataObj && dataObj.ok && dataObj.result) {
                        return { ok: true, result: dataObj.result };
                    }
                    var err =
                        (dataObj && (dataObj.error || dataObj.detail)) ||
                        aiTr('ai.twilio.fail');
                    return {
                        ok: false,
                        error: humanizeTwilioSendError(err, payload.from || opts.from),
                        result: dataObj && dataObj.result
                    };
                });
            })
            .catch(function(e) {
                return {
                    ok: false,
                    error: humanizeTwilioSendError(
                        (e && e.message) ? String(e.message) : aiTr('ai.twilio.apiDown'),
                        opts.from
                    )
                };
            });
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
            twilio: 'aiPanelTwilio',
            settings: 'aiPanelSettings'
        };
        Object.keys(map).forEach(function(k) {
            var panel = pick(map[k]);
            if (!panel) return;
            panel.style.display = (k === tab) ? 'block' : 'none';
        });
        if (tab === 'settings') syncProxyInputs();
        if (tab === 'twilio') {
            syncTwilioChannelUi();
            ns.refreshTwilioFromSelect();
            ns.refreshTwilioTplSelect();
            ns.refreshTwilioRecipients();
            var srcEl = pick('aiTwilioDraftSource');
            if (srcEl && String(srcEl.value || '') !== 'custom') ns.loadTwilioDraft();
        }

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
                var twilioPanel = pick('aiPanelTwilio');
                var settingsPanel = pick('aiPanelSettings');
                if (birthPanel) applyI18nInRoot(birthPanel);
                if (recallPanel) applyI18nInRoot(recallPanel);
                if (twilioPanel) applyI18nInRoot(twilioPanel);
                if (settingsPanel) applyI18nInRoot(settingsPanel);
            }
            if (sec && (_patientsCache.length || sec.style.display !== 'none')) {
                applyI18nInRoot(sec);
            }
        }
        ns.onBirthTemplateChange();
        ns.onRecallTemplateChange();
        syncTwilioChannelUi();
        ns.refreshTwilioFromSelect();
        ns.refreshTwilioTplSelect();
    });

    // Live-update placeholder matching rows when Variable keys change
    (function bindTwilioTplVarMapUi() {
        var varsEl = pick('aiTwilioTplVars');
        if (!varsEl || varsEl.getAttribute('data-var-map-bound')) return;
        varsEl.setAttribute('data-var-map-bound', '1');
        varsEl.addEventListener('input', function() { ns.onTwilioTplVarsInput(); });
        varsEl.addEventListener('change', function() { ns.onTwilioTplVarsInput(); });
    })();

})(AIHELPER);
