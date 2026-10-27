/**
 * Discount coupons. Separate from reward points.
 * KT is joined by default. Other clinics stay off until Configuration says otherwise.
 * A treatment coupon reduces only catalog lines ticked for that coupon.
 */
var COUPONS = (function () {
    var WALLET_CAP = 20;
    var CASH_GRANT_MAX = 200;
    var DEFAULT_JOIN_CODE = 'KT';
    var LOCKED_TRANSFER_KEYS = { new_chart: 1, referral: 1 };
    var AUTO_GRANT_KEYS = {
        new_chart: 1, referral: 1, target_spend: 1,
        spend_1: 1, spend_2: 1, spend_3: 1, spend_4: 1, spend_5: 1
    };
    var GRANT_ROLES = { doctor: 1, dentist: 1, nurse: 1, receptionist: 1, reception: 1, staff: 1, admin: 1 };
    /** Shared logins that cannot authorize a gift or transfer (the anonymous Nurse desk login). */
    var SHARED_LOGIN_IDS = { nurse: 1 };
    var SETTING_KEY = 'discount_coupon_scheme';
    var SMS_HEADING = '[Joyful Smile Dental Clinic 樂意牙科中心]';
    var EXPIRY_SMS_DAYS = 7;
    var EXPIRY_RUN_KEY = 'dc_expiry_sms_run';

    var ITEM_GROUPS = {
        free_scaling: ['SCALING & POLISHING - 洗牙'],
        free_filling: [
            'FILLING - AMALGAM',
            'FILLING - COMPLICATE',
            'FILLING - COMPOSITE',
            'FILLING - GLASS IONOMER'
        ],
        free_extraction: [
            'EXTRACTION - 脫牙',
            'COMPLICATED EXTRACTION - 複雜脫牙',
            'EXTRACTION OF WISDOM TOOTH - 脫智慧齒',
            'SURGICAL EXTRACTION - 手術脫牙'
        ],
        implant: [
            'IMPLANT - 植牙',
            'IMPLANT BRIDGE PONTIC',
            'IMPLANT-HIOSSEN',
            'IMPLANT-NOBEL',
            'IMPLANT-OSSTEM'
        ],
        ortho: [
            'FIXED ORTHO',
            'FIXED ORTHO - CERAMIC',
            'FIXED ORTHO - METAL',
            'ORTHO CONSULTATION',
            'ORTHO TREATMENT',
            'ORTHODONTIC CONSULTATION - 矯齒諮詢',
            'ORTHO-RPE',
            'DEBOND',
            'RETAINER'
        ],
        crown_bridge: [
            'CERAMIC CROWN - 全瓷牙套',
            'CERAMIC CR/BR',
            'CROWN AND BRIDGE WORK',
            'METAL CERAMIC CROWN - 金屬烤瓷牙套',
            'CEMENT CR/BR'
        ],
        root_canal: ['ROOT CANAL TREATMENT (RCT) - 根管治療'],
        whitening: ['BLEACHING']
    };

    /** Smart filter: a catalog name that contains an include word and no exclude word fits the coupon. */
    var ITEM_KEYWORDS = {
        free_scaling: {
            inc: ['scaling', 'scale', 'polish', 'prophy', '洗牙', '潔牙', '洁牙'],
            exc: ['root planing', 'deep', 'pilot', 'gov', 'adjust']
        },
        free_filling: {
            inc: ['filling', 'composite', 'amalgam', 'glass ionomer', '補牙', '补牙'],
            exc: ['root canal', 'temporary', 'post and core', '支柱']
        },
        free_extraction: {
            inc: ['extraction', '脫牙', '脱牙', '拔牙'],
            exc: []
        },
        implant: {
            inc: ['implant', '植牙', '種植'],
            exc: ['denture', 'consult']
        },
        ortho: {
            inc: ['ortho', 'invisalign', 'retainer', 'debond', 'braces', '矯齒', '矫齿', '牙箍'],
            exc: ['opg', 'orthopantomogram', 'x-ray', 'x光', 'consult', '諮詢']
        },
        crown_bridge: {
            inc: ['crown', 'bridge', 'cr/br', '牙套', '牙橋', '牙桥'],
            exc: ['removal', 'remove', 'implant', 'temp', '拆']
        },
        root_canal: {
            inc: ['root canal', 'rct', 'endodontic', '根管'],
            exc: ['consult']
        },
        whitening: {
            inc: ['bleach', 'whitening', '美白'],
            exc: []
        }
    };

    var CAMPAIGN_DEFS = [
        { key: 'cash', name: 'Cash coupon', nameZh: '現金券', scope: 'bill', mode: 'amount', face: 100, expiry: 90, sms: true, trigger: 'manual', hold: 5 },
        { key: 'spend_1', name: 'Spend $1000 get $100', nameZh: '滿$1000送$100', scope: 'bill', mode: 'amount', face: 100, target: 1000, expiry: 180, sms: true, trigger: 'target_spend', hold: 3 },
        { key: 'spend_2', name: 'Spend $5000 get $500', nameZh: '滿$5000送$500', scope: 'bill', mode: 'amount', face: 500, target: 5000, expiry: 180, sms: true, trigger: 'target_spend', hold: 3 },
        { key: 'spend_3', name: 'Spend $10000 get $1000', nameZh: '滿$10000送$1000', scope: 'bill', mode: 'amount', face: 1000, target: 10000, expiry: 180, sms: true, trigger: 'target_spend', hold: 3 },
        { key: 'spend_4', name: 'Custom spend 1', nameZh: '自訂滿額 1', scope: 'bill', mode: 'amount', face: 0, target: 0, expiry: 180, sms: true, trigger: 'target_spend', hold: 3 },
        { key: 'spend_5', name: 'Custom spend 2', nameZh: '自訂滿額 2', scope: 'bill', mode: 'amount', face: 0, target: 0, expiry: 180, sms: true, trigger: 'target_spend', hold: 3 },
        { key: 'new_chart', name: 'New chart', nameZh: '新客券', scope: 'bill', mode: 'amount', face: 100, expiry: 90, sms: false, trigger: 'new_chart', hold: 1 },
        { key: 'referral', name: 'Refer a friend', nameZh: '介紹新客', scope: 'bill', mode: 'amount', face: 100, expiry: 180, sms: true, trigger: 'referral', hold: 5 },
        { key: 'free_scaling', name: 'Free scaling', nameZh: '免費洗牙', scope: 'items', mode: 'free_line', face: 0, expiry: 180, sms: true, trigger: 'manual', hold: 2 },
        { key: 'free_filling', name: 'Free filling', nameZh: '免費補牙', scope: 'items', mode: 'free_line', face: 0, expiry: 180, sms: true, trigger: 'manual', hold: 2 },
        { key: 'free_extraction', name: 'Free extraction', nameZh: '免費脫牙', scope: 'items', mode: 'free_line', face: 0, expiry: 180, sms: true, trigger: 'manual', hold: 2 },
        { key: 'implant', name: 'Implant discount', nameZh: '植牙優惠', scope: 'items', mode: 'amount', face: 1000, max: 1000, expiry: 180, sms: true, trigger: 'manual', hold: 2 },
        { key: 'ortho', name: 'Orthodontic discount', nameZh: '矯齒優惠', scope: 'items', mode: 'percent', face: 0, percent: 10, max: 3000, expiry: 180, sms: true, trigger: 'manual', hold: 2 },
        { key: 'crown_bridge', name: 'Crown and bridge', nameZh: '牙套牙橋優惠', scope: 'items', mode: 'amount', face: 500, max: 500, expiry: 180, sms: true, trigger: 'manual', hold: 2 },
        { key: 'root_canal', name: 'Root canal', nameZh: '根管優惠', scope: 'items', mode: 'amount', face: 500, max: 500, expiry: 180, sms: true, trigger: 'manual', hold: 2 },
        { key: 'whitening', name: 'Whitening', nameZh: '美白優惠', scope: 'items', mode: 'amount', face: 200, max: 200, expiry: 90, sms: true, trigger: 'manual', hold: 2 }
    ];

    var _clinics = {};
    var _doctors = {};
    var _campaigns = null;
    var _loaded = false;
    /** Cash coupons that can stack on one bill. Both limits apply together (the smaller wins); 0 = no such limit. */
    var DEFAULT_CASH_RULES = { maxCount: 0, maxPercent: 50, maxAmount: 3000 };
    var CASH_STACK_MAX = 10;
    var _cashRules = clone(DEFAULT_CASH_RULES);

    function cents(n) {
        var x = parseFloat(n);
        if (!isFinite(x)) return 0;
        return Math.round(x * 100);
    }
    function money(c) { return Math.round(c) / 100; }
    function round2(n) { return money(cents(n)); }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function ct(key, fallback) {
        var s = '';
        try { if (typeof tr === 'function') s = tr(key); } catch (e) { s = ''; }
        if (!s || s === key) return fallback;
        return s;
    }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function uiLang() {
        try { if (typeof getAppLang === 'function') return getAppLang() || 'en'; } catch (e) {}
        return 'en';
    }
    /** Coupon name in the dashboard language (SMS and stored labels keep nameZh). */
    function campLabel(c) {
        if (!c) return '';
        var key = c.trigger ? c.key : (c.campaign_key || c.key);
        var camp = c.trigger ? c : (campaignByKey(key) || c);
        var L = uiLang();
        if (camp.trigger === 'target_spend' && (parseFloat(camp.target) || 0) > 0 && (parseFloat(camp.face) || 0) > 0) {
            var t = round2(camp.target);
            var f = round2(camp.face);
            if (L === 'en') return 'Spend $' + t + ' get $' + f;
            return (L === 'zh-CN' ? '满$' : '滿$') + t + '送$' + f;
        }
        var s = ct('coupons.camp.' + key, '');
        if (s) return s;
        return L === 'en' ? (camp.name || camp.nameZh || key || '') : (camp.nameZh || camp.name || key || '');
    }

    function blankCampaign(def) {
        return {
            key: def.key,
            name: def.name,
            nameZh: def.nameZh,
            scope: def.scope,
            mode: def.mode,
            trigger: def.trigger,
            enabled: false,
            face: def.face || 0,
            percent: def.percent || 0,
            minSpend: 0,
            target: def.target || 0,
            expiryDays: def.expiry || 90,
            maxDiscount: def.max || 0,
            issueCap: 0,
            budget: 0,
            issuedCount: 0,
            budgetUsed: 0,
            sms: !!def.sms,
            holdLimit: def.hold || 1,
            itemNames: (ITEM_GROUPS[def.key] || []).slice(),
            excludeNames: [],
            smart: def.scope === 'items',
            keywords: ((ITEM_KEYWORDS[def.key] || {}).inc || []).slice(),
            excludeKeywords: ((ITEM_KEYWORDS[def.key] || {}).exc || []).slice()
        };
    }

    function defaultCampaigns() {
        return CAMPAIGN_DEFS.map(blankCampaign);
    }

    function campaigns() {
        if (!_campaigns) _campaigns = defaultCampaigns();
        return _campaigns;
    }

    function campaignByKey(key) {
        var list = campaigns();
        for (var i = 0; i < list.length; i++) {
            if (list[i].key === key) return list[i];
        }
        return null;
    }

    function defaultClinicJoined(code) {
        return String(code || '').trim().toUpperCase() === DEFAULT_JOIN_CODE;
    }

    function clinicJoined(code, map) {
        var c = String(code || '').trim().toUpperCase();
        var src = map || _clinics;
        if (src && Object.prototype.hasOwnProperty.call(src, c)) return !!src[c].joined;
        return defaultClinicJoined(c);
    }

    function doctorJoined(clinicCode, doctorKey, maps) {
        if (!clinicJoined(clinicCode, maps && maps.clinics)) return false;
        var c = String(clinicCode || '').trim().toUpperCase();
        var docs = (maps && maps.doctors) || _doctors;
        var allKey = c + '|__all__';
        var oneKey = c + '|' + String(doctorKey || '');
        if (docs && Object.prototype.hasOwnProperty.call(docs, oneKey) && doctorKey && doctorKey !== '__all__') {
            return !!docs[oneKey].joined;
        }
        if (docs && Object.prototype.hasOwnProperty.call(docs, allKey)) return !!docs[allKey].joined;
        return true;
    }

    function catalogName(line, catalog) {
        var id = String(line && line.treatment_item_id || '').trim();
        var code = String(line && line.item_code || '').trim();
        var list = catalog || [];
        var i;
        if (id) {
            for (i = 0; i < list.length; i++) {
                if (String(list[i].id || '') === id) return String(list[i].item_name || '');
            }
        }
        if (code) {
            for (i = 0; i < list.length; i++) {
                if (String(list[i].item_code || '') === code) return String(list[i].item_name || '');
            }
        }
        /* Older bills lost the catalog id on save; a name identical to a catalog row still counts. */
        var names = [line && line.item_name, line && line.desc];
        for (var n = 0; n < names.length; n++) {
            var nm = String(names[n] || '').trim();
            if (!nm) continue;
            for (i = 0; i < list.length; i++) {
                if (String(list[i].item_name || '').trim() === nm) return String(list[i].item_name || '');
            }
        }
        return '';
    }

    function lineMatchesGroup(line, names, catalog) {
        var allowed = {};
        (names || []).forEach(function (n) { allowed[String(n)] = true; });
        var name = catalogName(line, catalog);
        return !!(name && allowed[name]);
    }

    function keywordIn(text, kw) {
        var k = String(kw || '').trim().toLowerCase();
        if (!k) return false;
        if (/^[\x20-\x7e]+$/.test(k)) {
            var safe = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            return new RegExp('(^|[^a-z0-9])' + safe).test(text);
        }
        return text.indexOf(k) >= 0;
    }

    /** Pure: does this catalog name hit an include word and miss every exclude word? */
    function keywordHit(name, keywords, excludeKeywords) {
        var text = String(name || '').toLowerCase();
        if (!text) return false;
        var inc = (keywords || []).some(function (k) { return keywordIn(text, k); });
        if (!inc) return false;
        return !(excludeKeywords || []).some(function (k) { return keywordIn(text, k); });
    }

    /** What a treatment coupon accepts: ticked names, plus keyword hits unless unticked. */
    function itemRule(coupon) {
        coupon = coupon || {};
        var key = coupon.campaign_key || coupon.key;
        var camp = coupon.trigger ? coupon : (campaignByKey(key) || {});
        var pick = function (k, fallback) {
            if (Array.isArray(coupon[k])) return coupon[k];
            if (Array.isArray(camp[k])) return camp[k];
            return fallback;
        };
        var names = [];
        (coupon.itemNames || []).concat(camp.itemNames || []).forEach(function (n) {
            if (names.indexOf(n) < 0) names.push(n);
        });
        if (!names.length && !coupon.itemNames && !camp.itemNames) names = (ITEM_GROUPS[key] || []).slice();
        var kw = ITEM_KEYWORDS[key] || {};
        return {
            itemNames: names,
            excludeNames: pick('excludeNames', []),
            smart: typeof coupon.smart === 'boolean' ? coupon.smart : (typeof camp.smart === 'boolean' ? camp.smart : !!ITEM_KEYWORDS[key]),
            keywords: pick('keywords', kw.inc || []),
            excludeKeywords: pick('excludeKeywords', kw.exc || [])
        };
    }

    function ruleHasItems(rule) {
        return !!(rule && ((rule.itemNames && rule.itemNames.length) || (rule.smart && rule.keywords && rule.keywords.length)));
    }

    /** Pure: does a catalog item name fit this rule? */
    function nameFitsRule(name, rule) {
        if (!name || !rule) return false;
        if ((rule.excludeNames || []).indexOf(name) >= 0) return false;
        if ((rule.itemNames || []).indexOf(name) >= 0) return true;
        return !!rule.smart && keywordHit(name, rule.keywords, rule.excludeKeywords);
    }

    function lineFitsRule(line, rule, catalog) {
        return nameFitsRule(catalogName(line, catalog), rule);
    }

    function lineNetCents(line) {
        var qty = parseFloat(line && line.qty);
        if (!isFinite(qty) || qty <= 0) qty = 1;
        var price = cents(line && (line.price != null ? line.price : line.unit_price));
        var disc = parseFloat(line && line.disc);
        if (!isFinite(disc) || disc < 0) disc = 0;
        if (disc > 100) disc = 100;
        return Math.max(0, Math.round(price * qty * (100 - disc) / 100));
    }

    function matchingLines(lines, coupon, catalog) {
        var rule = coupon && coupon.rule ? coupon.rule : itemRule(coupon);
        var out = [];
        (lines || []).forEach(function (line, idx) {
            if (lineFitsRule(line, rule, catalog)) out.push({ index: idx, line: line, net: lineNetCents(line) });
        });
        return out;
    }

    /**
     * What this coupon would do on this bill.
     * lines need treatment_item_id or item_code. A typed description is not enough.
     */
    function assessCoupon(opts) {
        opts = opts || {};
        var coupon = opts.coupon || {};
        var lines = opts.lines || [];
        var catalog = opts.catalog || [];
        var billId = String(opts.billId || '');
        var eligible = opts.eligibleCents != null ? cents(opts.eligibleCents) : null;
        var reason = '';
        var save = 0;
        var lineIndex = -1;
        var lineName = '';

        if (coupon.status && coupon.status !== 'unused') {
            return { ok: false, save: 0, reason: coupon.status === 'used' ? 'used' : coupon.status };
        }
        if (coupon.expires_on && opts.today && String(coupon.expires_on) < String(opts.today)) {
            return { ok: false, save: 0, reason: 'expired' };
        }
        if (coupon.origin_bill_id && billId && String(coupon.origin_bill_id) === billId) {
            return { ok: false, save: 0, reason: 'next_bill' };
        }
        if (coupon.patient_id && opts.patientId && String(coupon.patient_id) !== String(opts.patientId)) {
            return { ok: false, save: 0, reason: 'other_patient' };
        }

        var scope = coupon.scope || (ITEM_GROUPS[coupon.campaign_key || coupon.key] ? 'items' : 'bill');
        var mode = coupon.mode || coupon.discount_mode || 'amount';
        var rule = itemRule(coupon);
        var names = rule.itemNames;

        if (scope === 'items') {
            var hits = matchingLines(lines, { rule: rule }, catalog);
            if (!hits.length) {
                return { ok: false, save: 0, reason: ruleHasItems(rule) ? 'no_matching_item' : 'no_items_ticked', itemNames: names };
            }
            var sum = 0;
            hits.forEach(function (h) { sum += h.net; });
            if (mode === 'free_line') {
                var best = hits[0];
                hits.forEach(function (h) { if (h.net > best.net) best = h; });
                if (opts.lineIndex != null) {
                    var picked = null;
                    hits.forEach(function (h) { if (h.index === opts.lineIndex) picked = h; });
                    if (!picked) return { ok: false, save: 0, reason: 'no_matching_item', itemNames: names };
                    best = picked;
                }
                save = best.net;
                lineIndex = best.index;
                lineName = catalogName(best.line, catalog);
            } else if (mode === 'percent') {
                var pct = parseFloat(coupon.percent) || 0;
                save = Math.round(sum * pct / 100);
                var cap = cents(coupon.maxDiscount || coupon.max_discount);
                if (cap > 0) save = Math.min(save, cap);
                save = Math.min(save, sum);
            } else {
                save = Math.min(cents(coupon.face != null ? coupon.face : coupon.face_value), sum);
            }
            if (save <= 0) return { ok: false, save: 0, reason: 'zero', itemNames: names };
            return { ok: true, save: money(save), saveCents: save, lineIndex: lineIndex, lineName: lineName, reason: '' };
        }

        var base = eligible != null ? eligible : 0;
        if (base <= 0) {
            (lines || []).forEach(function (line) { base += lineNetCents(line); });
        }
        var minSpend = cents(coupon.minSpend != null ? coupon.minSpend : coupon.min_spend);
        if (minSpend > 0 && base < minSpend) {
            return { ok: false, save: 0, reason: 'short', shortCents: minSpend - base };
        }
        if (mode === 'percent') {
            save = Math.round(base * ((parseFloat(coupon.percent) || 0) / 100));
            var capBill = cents(coupon.maxDiscount || coupon.max_discount);
            if (capBill > 0) save = Math.min(save, capBill);
        } else {
            save = cents(coupon.face != null ? coupon.face : coupon.face_value);
        }
        save = Math.min(save, base);
        if (save <= 0) return { ok: false, save: 0, reason: 'zero' };
        return { ok: true, save: money(save), saveCents: save, lineIndex: -1, lineName: '', reason: '' };
    }

    function couponSlot(coupon) {
        var scope = coupon && (coupon.scope || (ITEM_GROUPS[coupon.campaign_key || coupon.key] ? 'items' : 'bill'));
        return scope === 'items' ? 'items' : 'bill';
    }

    /** Cash coupons (campaign "cash", including gifted ones) are the only kind that can stack on one bill. */
    function isCashCoupon(c) {
        return !!c && String(c.campaign_key || c.key || '') === 'cash' && couponSlot(c) === 'bill';
    }

    /** Pure: tidy saved cash rules. 0 = no limit for that field; missing fields take the defaults. */
    function normalizeCashRules(raw) {
        raw = raw || {};
        function num(v, dflt) {
            var n = parseFloat(v);
            if (v == null || v === '' || !isFinite(n)) return dflt;
            return Math.max(0, n);
        }
        var count = parseInt(raw.maxCount, 10);
        if (!isFinite(count)) count = DEFAULT_CASH_RULES.maxCount;
        count = count <= 0 ? 0 : Math.min(count, CASH_STACK_MAX);
        var pct = raw.maxPercent;
        var amt = raw.maxAmount;
        if (pct == null && amt == null && raw.limitMode) {
            pct = raw.limitMode === 'percent' ? raw.limitValue : 0;
            amt = raw.limitMode === 'amount' ? raw.limitValue : 0;
        }
        return {
            maxCount: count,
            maxPercent: round2(Math.min(100, num(pct, DEFAULT_CASH_RULES.maxPercent))),
            maxAmount: round2(num(amt, DEFAULT_CASH_RULES.maxAmount))
        };
    }

    function cashRules() { return normalizeCashRules(_cashRules); }

    function cashCountFull(n, rules) { return rules.maxCount > 0 && n >= rules.maxCount; }

    /** Pure: most cash off one bill, in cents, for a bill worth eligibleCents: the smaller of the % and HK$ limits. Infinity = no limit. */
    function cashCapCents(eligibleCents, rules) {
        rules = normalizeCashRules(rules || _cashRules);
        var cap = Infinity;
        if (rules.maxPercent > 0) cap = Math.floor(cents(eligibleCents) * rules.maxPercent / 100);
        if (rules.maxAmount > 0) cap = Math.min(cap, cents(rules.maxAmount));
        return cap;
    }

    function cashLimitText(rules) {
        rules = normalizeCashRules(rules || _cashRules);
        var parts = [];
        if (rules.maxPercent > 0) parts.push(rules.maxPercent + '% ' + ct('coupons.cash.ofBill', 'of the bill'));
        if (rules.maxAmount > 0) {
            parts.push((parts.length ? ct('coupons.cash.upTo', 'up to') + ' ' : '') + 'HK$' + Number(rules.maxAmount).toLocaleString('en-US'));
        }
        return parts.join(' ');
    }

    /**
     * Treatment coupon first on its line, then the bill-wide part on what is left:
     * either one non-cash bill coupon (spend, new chart, referral), or a stack of cash coupons (maxCount, 0 = any)
     * within the per-bill cash limit. Whichever bill-wide kind is picked first wins.
     */
    function combineCoupons(opts) {
        opts = opts || {};
        var rules = normalizeCashRules(opts.cashRules || _cashRules);
        var picks = (opts.coupons || []).filter(Boolean);
        var item = null;
        var whole = null;
        var cash = [];
        var skipped = [];
        picks.forEach(function (c) {
            if (couponSlot(c) === 'items') {
                if (!item) item = c;
                else skipped.push({ coupon: c, reason: 'slot_taken' });
                return;
            }
            var firstWide = whole || cash.length;
            if (isCashCoupon(c)) {
                if (whole) { skipped.push({ coupon: c, reason: 'slot_taken' }); return; }
                if (cashCountFull(cash.length, rules)) { skipped.push({ coupon: c, reason: 'cash_count' }); return; }
                cash.push(c);
            } else if (!firstWide) {
                whole = c;
            } else {
                skipped.push({ coupon: c, reason: 'slot_taken' });
            }
        });
        var base = {
            lines: opts.lines, catalog: opts.catalog, billId: opts.billId,
            patientId: opts.patientId, today: opts.today
        };
        var eligibleCents = cents(opts.eligibleCents || 0);
        var rows = [];
        var saveCents = 0;
        var lostCents = 0;
        if (item) {
            var a1 = assessCoupon(Object.assign({ coupon: item, eligibleCents: money(eligibleCents) }, base));
            if (a1.ok) { rows.push({ coupon: item, assess: a1 }); saveCents += a1.saveCents; }
        }
        if (whole) {
            var left = Math.max(0, eligibleCents - saveCents);
            var a2 = assessCoupon(Object.assign({ coupon: whole, eligibleCents: money(left) }, base));
            if (a2.ok) { rows.push({ coupon: whole, assess: a2 }); saveCents += a2.saveCents; }
        }
        var capCents = cashCapCents(money(eligibleCents), rules);
        var capLeft = capCents;
        var capHit = false;
        cash.forEach(function (c) {
            var room = Math.max(0, eligibleCents - saveCents);
            if (room <= 0) { skipped.push({ coupon: c, reason: 'covered' }); return; }
            var a = assessCoupon(Object.assign({ coupon: c, eligibleCents: money(room) }, base));
            if (!a.ok) {
                skipped.push({ coupon: c, reason: room <= 0 ? 'covered' : (a.reason || 'zero') });
                return;
            }
            var face = cents(c.face != null ? c.face : c.face_value);
            var take = Math.min(a.saveCents, capLeft);
            if (take < a.saveCents) capHit = true;
            if (take <= 0) { skipped.push({ coupon: c, reason: 'cash_cap' }); return; }
            var lost = Math.max(0, face - take);
            lostCents += lost;
            rows.push({
                coupon: c,
                assess: Object.assign({}, a, { save: money(take), saveCents: take, lostCents: lost, trimmed: lost > 0 })
            });
            saveCents += take;
            if (capLeft !== Infinity) capLeft -= take;
        });
        return {
            rows: rows, saveCents: saveCents, save: money(saveCents),
            lostCents: lostCents, lost: money(lostCents), skipped: skipped,
            cashCount: rows.filter(function (r) { return isCashCoupon(r.coupon); }).length,
            capCents: capCents === Infinity ? null : capCents, capHit: capHit, rules: rules
        };
    }

    /** Pure: best set of cash coupons for what is left — most saved, then least lost, then earliest expiry. */
    function bestCashStack(cashList, opts, prefix) {
        var rules = normalizeCashRules(opts.cashRules || _cashRules);
        var byFace = {};
        cashList.forEach(function (c) {
            var f = String(cents(c.face != null ? c.face : c.face_value));
            (byFace[f] = byFace[f] || []).push(c);
        });
        var faces = Object.keys(byFace).sort(function (a, b) { return Number(b) - Number(a); });
        faces.forEach(function (f) {
            byFace[f].sort(function (a, b) {
                return String(a.expires_on || '9999-12-31').localeCompare(String(b.expires_on || '9999-12-31'));
            });
        });
        var best = null;
        var budget = 4000;
        function expiryScore(list) {
            return list.map(function (c) { return String(c.expires_on || '9999-12-31'); }).sort().join('|');
        }
        function consider(list) {
            if (!list.length) return true;
            budget--;
            var r = combineCoupons(Object.assign({}, opts, { coupons: prefix.concat(list) }));
            if (r.cashCount !== list.length) return false;
            var full = r.capHit || r.lostCents > 0 || (r.capCents != null && r.saveCents - prefixSave >= r.capCents);
            var score = { save: r.saveCents, lost: r.lostCents, n: list.length, exp: expiryScore(list) };
            if (!best || score.save > best.score.save ||
                    (score.save === best.score.save && (score.lost < best.score.lost ||
                    (score.lost === best.score.lost && (score.n < best.score.n ||
                    (score.n === best.score.n && score.exp < best.score.exp)))))) {
                best = { list: list.slice(), score: score };
            }
            return !full;
        }
        var prefixSave = prefix.length ? combineCoupons(Object.assign({}, opts, { coupons: prefix })).saveCents : 0;
        function walk(i, list) {
            if (budget <= 0 || i >= faces.length) return;
            var pool = byFace[faces[i]];
            var top = pool.length;
            if (rules.maxCount > 0) top = Math.min(top, rules.maxCount - list.length);
            for (var k = top; k >= 1 && budget > 0; k--) {
                var next = list.concat(pool.slice(0, k));
                if (consider(next) && !cashCountFull(next.length, rules)) walk(i + 1, next);
            }
            walk(i + 1, list);
        }
        var greedy = [];
        faces.forEach(function (f) {
            byFace[f].forEach(function (c) {
                if (cashCountFull(greedy.length, rules)) return;
                var r = combineCoupons(Object.assign({}, opts, { coupons: prefix.concat(greedy, [c]) }));
                if (r.cashCount === greedy.length + 1 && r.lostCents === 0) greedy.push(c);
            });
        });
        consider(greedy);
        walk(0, []);
        return best ? best.list : [];
    }

    function bestCombination(coupons, opts) {
        opts = opts || {};
        function earliest(a, b) {
            return String(a.expires_on || '9999-12-31') < String(b.expires_on || '9999-12-31');
        }
        var items = (coupons || []).filter(function (c) { return couponSlot(c) === 'items'; });
        var cashList = (coupons || []).filter(isCashCoupon);
        var wholes = (coupons || []).filter(function (c) { return couponSlot(c) === 'bill' && !isCashCoupon(c); });
        var bestItem = null;
        var bestItemSave = 0;
        items.forEach(function (c) {
            var r = combineCoupons(Object.assign({}, opts, { coupons: [c] }));
            if (!r.rows.length) return;
            if (!bestItem || r.saveCents > bestItemSave || (r.saveCents === bestItemSave && earliest(c, bestItem))) {
                bestItem = c;
                bestItemSave = r.saveCents;
            }
        });
        var bestWhole = null;
        var bestWholeSave = 0;
        wholes.forEach(function (c) {
            var r = combineCoupons(Object.assign({}, opts, { coupons: bestItem ? [bestItem, c] : [c] }));
            var save = r.saveCents - bestItemSave;
            if (r.rows.length < (bestItem ? 2 : 1)) return;
            if (!bestWhole || save > bestWholeSave || (save === bestWholeSave && earliest(c, bestWhole))) {
                bestWhole = c;
                bestWholeSave = save;
            }
        });
        var prefix = bestItem ? [bestItem] : [];
        var stack = cashList.length ? bestCashStack(cashList, opts, prefix) : [];
        if (stack.length) {
            var withCash = combineCoupons(Object.assign({}, opts, { coupons: prefix.concat(stack) }));
            var cashSave = withCash.saveCents - bestItemSave;
            if (!bestWhole || cashSave > bestWholeSave) return withCash;
        }
        return combineCoupons(Object.assign({}, opts, { coupons: [bestItem, bestWhole] }));
    }

    function pickBest(coupons, opts) {
        var best = null;
        (coupons || []).forEach(function (c) {
            var a = assessCoupon({
                coupon: c,
                lines: opts.lines,
                catalog: opts.catalog,
                eligibleCents: opts.eligibleCents,
                billId: opts.billId,
                patientId: opts.patientId,
                today: opts.today
            });
            if (!a.ok) return;
            var exp = String(c.expires_on || '9999-12-31');
            if (!best || a.saveCents > best.assess.saveCents ||
                    (a.saveCents === best.assess.saveCents && exp < String(best.coupon.expires_on || '9999-12-31'))) {
                best = { coupon: c, assess: a };
            }
        });
        return best;
    }

    function todayIso() { return new Date().toISOString().slice(0, 10); }

    /** Unused and not past expiry. Expired coupons keep status 'unused' in the table. */
    function isLive(c, today) {
        if (!c || c.status !== 'unused') return false;
        return !c.expires_on || String(c.expires_on) >= (today || todayIso());
    }

    function unusedCount(wallet, today) {
        return (wallet || []).filter(function (c) { return isLive(c, today); }).length;
    }

    function unusedOfCampaign(wallet, key, today) {
        return (wallet || []).filter(function (c) {
            return isLive(c, today) && (c.campaign_key === key || c.key === key);
        }).length;
    }

    function holdLimitFor(campaign) {
        if (!campaign) return 1;
        var n = parseInt(campaign.holdLimit, 10);
        if (!(n >= 1)) {
            var def = null;
            for (var i = 0; i < CAMPAIGN_DEFS.length; i++) if (CAMPAIGN_DEFS[i].key === campaign.key) def = CAMPAIGN_DEFS[i];
            n = (def && def.hold) || 1;
        }
        return Math.min(n, WALLET_CAP);
    }

    function atHoldLimit(wallet, campaign) {
        return unusedOfCampaign(wallet, campaign && campaign.key) >= holdLimitFor(campaign);
    }

    function canIssue(wallet, campaign) {
        if (!campaign || !campaign.enabled) return { ok: false, reason: 'campaign_off' };
        if (unusedCount(wallet) >= WALLET_CAP) return { ok: false, reason: 'wallet_full' };
        if (atHoldLimit(wallet, campaign)) return { ok: false, reason: 'already_holding' };
        if (campaign.issueCap > 0 && campaign.issuedCount >= campaign.issueCap) {
            return { ok: false, reason: 'issue_cap' };
        }
        var face = campaign.mode === 'percent' ? 0 : (parseFloat(campaign.face) || 0);
        if (campaign.budget > 0 && (parseFloat(campaign.budgetUsed) || 0) + face > campaign.budget + 0.001) {
            return { ok: false, reason: 'budget' };
        }
        return { ok: true, reason: '' };
    }

    function planNewChart(ctx) {
        ctx = ctx || {};
        var out = [];
        if (!clinicJoined(ctx.clinicCode, ctx.clinics) || !doctorJoined(ctx.clinicCode, ctx.doctorKey, ctx)) {
            return out;
        }
        var list = ctx.campaigns || defaultCampaigns();
        function find(key) {
            for (var i = 0; i < list.length; i++) if (list[i].key === key) return list[i];
            return null;
        }
        var welcome = find('new_chart');
        var welcomeGate = canIssue(ctx.wallet || [], welcome);
        if (welcomeGate.ok) out.push({ campaign: welcome, patientId: ctx.patientId, sms: false });
        var ref = find('referral');
        var refGate = canIssue(ctx.referrerWallet || [], ref);
        if (ref && ctx.referrerId && String(ctx.referrerId) !== String(ctx.patientId) && refGate.ok) {
            out.push({ campaign: ref, patientId: ctx.referrerId, sms: true });
        }
        return out;
    }

    function planTargetSpend(ctx) {
        ctx = ctx || {};
        if (!clinicJoined(ctx.clinicCode, ctx.clinics) || !doctorJoined(ctx.clinicCode, ctx.doctorKey, ctx)) {
            return null;
        }
        var list = ctx.campaigns || defaultCampaigns();
        var active = [];
        list.forEach(function (c) {
            if (!c || c.trigger !== 'target_spend' || !c.enabled) return;
            if (!((parseFloat(c.target) || 0) > 0) || !((parseFloat(c.face) || 0) > 0)) return;
            active.push(c);
        });
        if (!active.length) return { ok: false, reason: 'campaign_off' };
        var shadow = (ctx.wallet || []).slice();
        var plans = [];
        var blocked = '';
        active.forEach(function (camp) {
            var gate = canIssue(shadow, camp);
            if (!gate.ok) {
                if (!blocked) blocked = gate.reason;
                return;
            }
            if (cents(ctx.cashAmount) < cents(camp.target)) return;
            plans.push({
                campaign: camp,
                patientId: ctx.patientId,
                originBillId: ctx.billId,
                sms: true
            });
            shadow.push({ status: 'unused', campaign_key: camp.key });
        });
        if (!plans.length) {
            var reached = active.some(function (c) { return cents(ctx.cashAmount) >= cents(c.target); });
            return { ok: false, reason: reached ? (blocked || 'already_holding') : 'below_target' };
        }
        return {
            ok: true,
            plans: plans,
            campaign: plans[0].campaign,
            patientId: ctx.patientId,
            originBillId: ctx.billId,
            sms: true
        };
    }

    function billTotalCents(subCents, discountCents, couponCents) {
        return Math.max(0, (subCents || 0) - (discountCents || 0) - (couponCents || 0));
    }

    function refundEffect(stage) {
        if (stage === 'void_unpaid' || stage === 'void_paid' || stage === 'void') return 'restore';
        return 'keep_used';
    }

    /** Used coupon on this bill returns to the wallet. A coupon this bill issued is cancelled. */
    function planBillVoid(bill, coupons) {
        bill = bill || {};
        var restore = [];
        var cancel = [];
        (coupons || []).forEach(function (c) {
            if (!c || !c.id) return;
            var onThis = (bill.coupon_id && String(c.id) === String(bill.coupon_id)) ||
                (c.bill_id && bill.id && String(c.bill_id) === String(bill.id));
            if (onThis && c.status === 'used') restore.push(String(c.id));
            if (c.status === 'unused' && c.origin_bill_id && bill.id &&
                    String(c.origin_bill_id) === String(bill.id)) {
                cancel.push(String(c.id));
            }
        });
        return { restore: restore, cancel: cancel };
    }

    function planChairsideGrant(opts) {
        opts = opts || {};
        var campaign = opts.campaign || null;
        var key = (campaign && campaign.key) || opts.campaignKey || '';
        if (!opts.patientId) return { ok: false, reason: 'patient' };
        if (opts.clinicJoined === false) return { ok: false, reason: 'clinic' };
        var role = String(opts.role == null ? '' : opts.role).toLowerCase();
        if (!GRANT_ROLES[role]) return { ok: false, reason: 'role' };
        if (!key || AUTO_GRANT_KEYS[key] || (campaign && campaign.trigger && campaign.trigger !== 'manual')) {
            return { ok: false, reason: 'automatic' };
        }
        if (!campaign) return { ok: false, reason: 'campaign' };
        if (!campaign.enabled) return { ok: false, reason: 'campaign_off' };
        var amount = round2(campaign.face || 0);
        if (key === 'cash') {
            amount = round2(opts.amount);
            if (!(amount >= 1) || amount - CASH_GRANT_MAX > 0.001) return { ok: false, reason: 'amount' };
        }
        if (campaign.scope === 'items' && !ruleHasItems(itemRule(campaign))) {
            return { ok: false, reason: 'no_items' };
        }
        var wallet = opts.wallet || [];
        if (unusedCount(wallet) >= WALLET_CAP) return { ok: false, reason: 'wallet_full' };
        if (atHoldLimit(wallet, campaign)) return { ok: false, reason: 'already_holding' };
        if (campaign.issueCap > 0 && (parseInt(campaign.issuedCount, 10) || 0) >= campaign.issueCap) {
            return { ok: false, reason: 'issue_cap' };
        }
        var spend = (key === 'cash') ? amount : ((campaign.mode === 'percent' || campaign.mode === 'free_line') ? 0 : amount);
        if (campaign.budget > 0 && (parseFloat(campaign.budgetUsed) || 0) + spend > campaign.budget + 0.001) {
            return { ok: false, reason: 'budget' };
        }
        return { ok: true, amount: amount, campaignKey: key };
    }

    function planTransfer(opts) {
        opts = opts || {};
        var c = opts.coupon || {};
        var key = c.campaign_key || c.key || '';
        if (c.status !== 'unused') return { ok: false, reason: 'not_unused' };
        if (!isLive(c, opts.today)) return { ok: false, reason: 'expired' };
        if (LOCKED_TRANSFER_KEYS[key]) return { ok: false, reason: 'locked' };
        if (!opts.toPatientId || String(opts.toPatientId) === String(c.patient_id || opts.fromPatientId || '')) {
            return { ok: false, reason: 'same_patient' };
        }
        if (unusedCount(opts.toWallet || []) >= WALLET_CAP) return { ok: false, reason: 'wallet_full' };
        var camp = opts.campaign || campaignByKey(key) || { key: key };
        if (atHoldLimit(opts.toWallet || [], camp)) return { ok: false, reason: 'already_holding' };
        return { ok: true, campaignKey: key };
    }

    var SMS_LIST_MAX = 10;

    /** "現金券 Cash coupon" — both languages, like the reward points SMS. */
    function smsCouponName(c) {
        c = c || {};
        var key = c.campaign_key || c.key || '';
        var camp = campaignByKey(key) || {};
        if (camp.trigger === 'target_spend' && (parseFloat(camp.target) || 0) > 0 && (parseFloat(camp.face) || 0) > 0) {
            var t = round2(camp.target);
            var f = round2(camp.face);
            return '滿$' + t + '送$' + f + ' Spend $' + t + ' get $' + f;
        }
        var zh = c.nameZh || camp.nameZh || '';
        var en = c.name || camp.name || '';
        if (zh && en && zh !== en) return zh + ' ' + en;
        return zh || en || key || '優惠券 Coupon';
    }

    function smsCouponValue(c) {
        c = c || {};
        var mode = c.mode || c.discount_mode;
        if (mode === 'free_line') return '免費/Free';
        if (mode === 'percent') {
            var cap = parseFloat(c.maxDiscount != null ? c.maxDiscount : c.max_discount) || 0;
            return round2(parseFloat(c.percent) || 0) + '%' + (cap > 0 ? ' (最多/up to HK$' + round2(cap).toFixed(2) + ')' : '');
        }
        return 'HK$' + round2(parseFloat(c.face != null ? c.face : c.face_value) || 0).toFixed(2);
    }

    function smsYearEnd(today) {
        var y = String(today || todayIso()).slice(0, 4);
        return { zh: y + '年12月31日 23:59', en: '31 Dec ' + y + ' 23:59' };
    }

    /**
     * Pure: coupon SMS in the reward points layout —
     * heading, 變動/Change, 結餘/Balance, the list of usable coupons, 診所/Clinic, 參考/Ref, then the year-end note.
     */
    function couponSmsBody(opts) {
        opts = opts || {};
        var today = opts.today || todayIso();
        var live = (opts.wallet || []).filter(function (c) { return isLive(c, today); });
        live.sort(function (a, b) {
            return String(a.expires_on || '9999-12-31').localeCompare(String(b.expires_on || '9999-12-31'));
        });
        var lines = [
            SMS_HEADING + ' 優惠券更新 / Discount coupon update',
            '變動/Change: ' + opts.change,
            '結餘/Balance: ' + live.length + '張 / ' + live.length + (live.length === 1 ? ' coupon' : ' coupons')
        ];
        if (live.length) {
            lines.push('可用優惠券/Available coupons:');
            live.slice(0, SMS_LIST_MAX).forEach(function (c, i) {
                lines.push((i + 1) + '. ' + smsCouponName(c) + ' ' + smsCouponValue(c) + (c.code ? ' (' + c.code + ')' : ''));
            });
            if (live.length > SMS_LIST_MAX) {
                var more = live.length - SMS_LIST_MAX;
                lines.push('…另有' + more + '張 / and ' + more + ' more');
            }
        }
        var end = smsYearEnd(today);
        lines.push('診所/Clinic: ' + (opts.clinic || ''));
        lines.push('參考/Ref: ' + (opts.ref || '—'));
        lines.push('備註/Note: 所有優惠券將於今年' + end.zh + '到期，請好好善用；歡迎邀請親友使用。' +
            'All discount coupons expire on ' + end.en + ' this year. Please make good use of them, and you are welcome to invite others to use them.');
        return lines.join('\n');
    }

    /** Issue text. wallet = the patient's coupons after this one was added (the new one is added if missing). */
    function smsIssued(coupon, wallet, opts) {
        coupon = coupon || {};
        opts = opts || {};
        var list = (wallet || []).slice();
        var mine = coupon.code && list.some(function (c) { return c.code === coupon.code; });
        if (!mine) list.push(Object.assign({ status: 'unused' }, coupon));
        return couponSmsBody({
            today: opts.today,
            wallet: list,
            change: '+1 ' + smsCouponName(coupon) + ' ' + smsCouponValue(coupon) + ' (發出/Issued)',
            clinic: opts.clinic || coupon.clinic_code || '',
            ref: coupon.code || ''
        });
    }

    /** Reminder text for a coupon 1–7 days from expiry (late runs still remind once). */
    function smsExpiring(coupon, today, wallet, opts) {
        if (!coupon || coupon.status !== 'unused' || !coupon.expires_on || !today) return '';
        var exp = new Date(coupon.expires_on + 'T00:00:00');
        var now = new Date(today + 'T00:00:00');
        var days = Math.round((exp.getTime() - now.getTime()) / 86400000);
        if (days < 1 || days > EXPIRY_SMS_DAYS) return '';
        if (coupon.issued_on === today) return '';
        opts = opts || {};
        var list = (wallet || []).slice();
        var mine = coupon.code && list.some(function (c) { return c.code === coupon.code; });
        if (!mine) list.push(coupon);
        return couponSmsBody({
            today: today,
            wallet: list,
            change: smsCouponName(coupon) + ' ' + smsCouponValue(coupon) + ' ' + days + '日內到期 (' + coupon.expires_on + ') / expires in ' +
                days + (days === 1 ? ' day' : ' days'),
            clinic: opts.clinic || coupon.clinic_code || '',
            ref: coupon.code || ''
        });
    }

    function mergeSaved(raw) {
        var saved = raw || {};
        _clinics = saved.clinics || {};
        _doctors = saved.doctors || {};
        _cashRules = normalizeCashRules(saved.cashRules);
        var base = defaultCampaigns();
        var byKey = {};
        (saved.campaigns || []).forEach(function (c) { if (c && c.key) byKey[c.key] = c; });
        if (byKey.target_spend && !byKey.spend_1) byKey.spend_1 = byKey.target_spend;
        _campaigns = base.map(function (c) {
            var o = byKey[c.key];
            if (!o) return c;
            var next = clone(c);
            ['enabled', 'face', 'percent', 'minSpend', 'target', 'expiryDays', 'maxDiscount',
                'issueCap', 'budget', 'sms', 'mode', 'name', 'nameZh', 'holdLimit'].forEach(function (k) {
                if (o[k] != null) next[k] = o[k];
            });
            if (Array.isArray(o.itemNames)) next.itemNames = o.itemNames.slice();
            ['excludeNames', 'keywords', 'excludeKeywords'].forEach(function (k) {
                if (Array.isArray(o[k])) next[k] = o[k].slice();
            });
            if (typeof o.smart === 'boolean') next.smart = o.smart;
            return next;
        });
        _loaded = true;
    }

    function snapshot() {
        return { clinics: _clinics, doctors: _doctors, campaigns: campaigns(), cashRules: cashRules() };
    }

    function loadState() {
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            mergeSaved(null);
            return Promise.resolve(snapshot());
        }
        return SB.from('program_settings').select('setting_value').eq('setting_key', SETTING_KEY)
            .then(function (r) {
                var raw = r && r.data && r.data[0] && r.data[0].setting_value;
                var parsed = null;
                if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = null; } }
                mergeSaved(parsed);
                return snapshot();
            }, function () {
                mergeSaved(null);
                return snapshot();
            });
    }

    /** Fill issuedCount / budgetUsed from the coupon table for campaigns that have a cap or budget. */
    function loadUsage() {
        var list = campaigns().filter(function (c) {
            return c && ((parseFloat(c.issueCap) || 0) > 0 || (parseFloat(c.budget) || 0) > 0);
        });
        if (!list.length || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            return Promise.resolve();
        }
        return Promise.all(list.map(function (c) {
            return SB.from('discount_coupons').select('face_value')
                .eq('campaign_key', c.key).neq('status', 'void').limit(10000)
                .then(function (r) {
                    if (!r || r.error) return;
                    var rows = r.data || [];
                    var sum = 0;
                    rows.forEach(function (x) { sum += cents(x.face_value); });
                    c.issuedCount = rows.length;
                    c.budgetUsed = money(sum);
                }, function () {});
        })).then(function () {});
    }

    function usageText(c) {
        if (!c) return '';
        var parts = [];
        var cap = parseFloat(c.issueCap) || 0;
        var budget = parseFloat(c.budget) || 0;
        if (cap > 0) parts.push(ct('coupons.cfg.issued', 'Issued') + ' ' + (c.issuedCount || 0) + ' / ' + cap);
        if (budget > 0) {
            parts.push(ct('coupons.cfg.budgetUsed', 'Budget used') + ' HK$' + round2(c.budgetUsed || 0).toFixed(0) +
                ' / HK$' + round2(budget).toFixed(0));
        }
        return parts.join(' · ');
    }

    function persist() {
        var json = JSON.stringify(snapshot());
        if (typeof persistProgramSettingRow === 'function') {
            return persistProgramSettingRow({ setting_key: SETTING_KEY, setting_value: json });
        }
        if (typeof SB === 'undefined' || !SB) return Promise.resolve({ ok: false });
        return SB.from('program_settings').update({ setting_value: json }).eq('setting_key', SETTING_KEY)
            .select('setting_key')
            .then(function (up) {
                if (up.error) return up;
                if (up.data && up.data.length) return up;
                return SB.from('program_settings').insert([{ setting_key: SETTING_KEY, setting_value: json }]);
            });
    }

    function setClinicJoined(code, clinicId, joined) {
        var c = String(code || '').trim().toUpperCase();
        _clinics[c] = { joined: !!joined, clinic_id: clinicId || (_clinics[c] && _clinics[c].clinic_id) || '' };
        var allKey = c + '|__all__';
        if (!_doctors[allKey]) _doctors[allKey] = { joined: !!joined };
        return persist();
    }

    function setDoctorJoined(code, doctorKey, joined) {
        var c = String(code || '').trim().toUpperCase();
        _doctors[c + '|' + doctorKey] = { joined: !!joined };
        return persist();
    }

    function setCashRules(patch) {
        var next = cashRules();
        Object.keys(patch || {}).forEach(function (k) { next[k] = patch[k]; });
        _cashRules = normalizeCashRules(next);
        return persist();
    }

    function setCampaignPatch(key, patch) {
        var c = campaignByKey(key);
        if (!c) return Promise.resolve();
        Object.keys(patch || {}).forEach(function (k) { c[k] = patch[k]; });
        return persist();
    }

    function renderConfigPane(pane) {
        if (!pane) return;
        pane.innerHTML = '<p style="color:#64748b;">' + esc(ct('common.loadingEllipsis', 'Loading…')) + '</p>';
        Promise.all([loadState().then(loadUsage), ensureCatalog()]).then(function () { paintConfig(pane); });
    }

    function catalogNames() {
        var list = (typeof treatmentItemsCache !== 'undefined' && treatmentItemsCache) ? treatmentItemsCache : [];
        var out = [];
        list.forEach(function (it) {
            var n = String(it && it.item_name || '').trim();
            if (n && out.indexOf(n) < 0) out.push(n);
        });
        return out;
    }

    /** Pure: checklist rows for a treatment coupon. state: ticked | auto | excluded | off. */
    function itemPickerRows(camp, names) {
        var rule = itemRule(camp);
        var all = (names || []).slice();
        (rule.itemNames || []).forEach(function (n) { if (all.indexOf(n) < 0) all.push(n); });
        return all.map(function (n) {
            var hit = !!rule.smart && keywordHit(n, rule.keywords, rule.excludeKeywords);
            var state = 'off';
            if ((rule.excludeNames || []).indexOf(n) >= 0) state = hit ? 'excluded' : 'off';
            else if ((rule.itemNames || []).indexOf(n) >= 0) state = 'ticked';
            else if (hit) state = 'auto';
            return {
                name: n, hit: hit, state: state, on: state === 'ticked' || state === 'auto',
                inCatalog: (names || []).indexOf(n) >= 0
            };
        }).sort(function (a, b) {
            if (a.on !== b.on) return a.on ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }

    function pickListHtml(camp) {
        var rows = itemPickerRows(camp, catalogNames());
        if (!rows.length) {
            return '<p class="dc-hint">' + esc(ct('coupons.pick.noCatalog', 'Treatment list not loaded yet.')) + '</p>';
        }
        return rows.map(function (r) {
            var tag = '';
            if (r.state === 'auto') tag = '<em class="dc-auto">' + esc(ct('coupons.pick.auto', 'keyword')) + '</em>';
            else if (r.state === 'excluded') tag = '<em class="dc-excl">' + esc(ct('coupons.pick.excluded', 'unticked')) + '</em>';
            if (!r.inCatalog) tag += '<em class="dc-gone">' + esc(ct('coupons.pick.gone', 'not in list')) + '</em>';
            return '<label class="dc-pick-item" data-name="' + esc(r.name.toLowerCase()) + '">' +
                '<input type="checkbox" class="dc-pick-on" data-key="' + esc(camp.key) + '" data-name="' + esc(r.name) + '"' +
                (r.on ? ' checked' : '') + '> <span>' + esc(r.name) + '</span>' + tag + '</label>';
        }).join('');
    }

    function pickSummaryText(camp) {
        var rows = itemPickerRows(camp, catalogNames());
        var on = rows.filter(function (r) { return r.on; });
        var auto = on.filter(function (r) { return r.state === 'auto'; }).length;
        return ct('coupons.pick.summary', 'Treatment items') + ': ' + on.length + ' ' + ct('coupons.pick.ticked', 'ticked') +
            (auto ? ' (' + auto + ' ' + ct('coupons.pick.byKeyword', 'by keyword') + ')' : '');
    }

    function itemPickerHtml(c) {
        var rule = itemRule(c);
        var html = '<div class="dc-items-box" data-key="' + esc(c.key) + '">';
        html += '<label class="dc-smart-row"><input type="checkbox" class="dc-smart" data-key="' + esc(c.key) + '"' +
            (rule.smart ? ' checked' : '') + '> ' + esc(ct('coupons.pick.smart', 'Smart keyword filter')) + '</label>';
        html += '<div class="dc-kw-row"><label>' + esc(ct('coupons.pick.keywords', 'Keywords')) +
            '<input type="text" class="dc-kw" data-key="' + esc(c.key) + '" data-prop="keywords" value="' + esc(rule.keywords.join(', ')) + '"></label>' +
            '<label>' + esc(ct('coupons.pick.exclude', 'Exclude words')) +
            '<input type="text" class="dc-kw" data-key="' + esc(c.key) + '" data-prop="excludeKeywords" value="' + esc(rule.excludeKeywords.join(', ')) + '"></label></div>';
        html += '<details class="dc-pick" data-key="' + esc(c.key) + '"><summary class="dc-pick-sum">' + esc(pickSummaryText(c)) + '</summary>' +
            '<input type="search" class="dc-pick-q" data-key="' + esc(c.key) + '" placeholder="' + esc(ct('coupons.pick.search', 'Search treatment…')) + '">' +
            '<div class="dc-pick-list" data-key="' + esc(c.key) + '">' + pickListHtml(c) + '</div></details>';
        html += '<p class="dc-hint dc-pick-hint">' + esc(ct('coupons.pick.hint',
            'Ticked items always fit this coupon. With the smart filter on, items whose name has a keyword (and no exclude word) are ticked for you; untick one to leave it out.')) + '</p>';
        return html + '</div>';
    }

    function configClinics() {
        var clinics = (typeof APP_CLINICS !== 'undefined' && APP_CLINICS) ? APP_CLINICS.slice() : [];
        if (!clinics.length) {
            clinics = [
                { clinic_code: 'KT', english_name: 'Kwun Tong' },
                { clinic_code: 'PL', english_name: 'Po Lam' }
            ];
        }
        return clinics;
    }

    /** Pure-ish: on | off | setup | full for a campaign card badge. */
    function campStatus(c) {
        if (!c || !c.enabled) return 'off';
        if (c.trigger === 'target_spend') {
            if (!((parseFloat(c.target) || 0) > 0 && (parseFloat(c.face) || 0) > 0)) return 'setup';
        } else if (c.scope === 'items') {
            var on = itemPickerRows(c, catalogNames()).filter(function (r) { return r.on; });
            if (!on.length) return 'setup';
        } else if ((c.mode || 'amount') === 'amount' && !((parseFloat(c.face) || 0) > 0)) {
            return 'setup';
        }
        var cap = parseFloat(c.issueCap) || 0;
        var budget = parseFloat(c.budget) || 0;
        if ((cap > 0 && (c.issuedCount || 0) >= cap) || (budget > 0 && (c.budgetUsed || 0) >= budget)) return 'full';
        return 'on';
    }

    function statusBadgeHtml(c) {
        var st = campStatus(c);
        var text = {
            on: ct('coupons.badge.on', 'On'),
            off: ct('coupons.badge.off', 'Off'),
            setup: ct('coupons.badge.setup', 'Needs setup'),
            full: ct('coupons.badge.full', 'Limit reached')
        }[st];
        return '<span class="dc-badge dc-badge-' + st + '" data-badge="' + esc(c.key) + '">' + esc(text) + '</span>';
    }

    function previewTicketHtml(c) {
        var days = parseInt(c.expiryDays, 10) || 0;
        var slot = couponSlot(c);
        return '<div class="dc-ticket dc-ticket-mini' + (c.enabled ? '' : ' is-off') + '" data-kind="' + kindOf(c) +
            '" data-preview="' + esc(c.key) + '" aria-hidden="true">' + stubHtml(c) +
            '<span class="dc-body"><b class="dc-tk-name">' + esc(campLabel(c)) + '</b>' +
            '<small>' + esc(slot === 'items' ? ct('coupons.bill.slotItems', '治療券') : ct('coupons.bill.slotBill', '全單券')) + '</small>' +
            (days ? '<span class="dc-meta"><span class="dc-exp">' + esc(ct('coupons.exp.valid', 'Valid') + ' ' + days + ' ' +
                ct('coupons.exp.days', 'days')) + '</span></span>' : '') +
            '</span></div>';
    }

    function ladderHtml() {
        var rows = campaigns().filter(function (c) { return c && c.trigger === 'target_spend'; });
        var ready = rows.filter(function (c) { return (parseFloat(c.target) || 0) > 0 && (parseFloat(c.face) || 0) > 0; })
            .sort(function (a, b) { return (parseFloat(a.target) || 0) - (parseFloat(b.target) || 0); });
        if (!ready.length) {
            return '<p class="dc-hint dc-ladder-empty">' + esc(ct('coupons.ladder.empty', 'No spend tiers filled in yet.')) + '</p>';
        }
        var top = parseFloat(ready[ready.length - 1].target) || 1;
        var html = '<ol class="dc-ladder" aria-label="' + esc(ct('coupons.ladder.title', 'Spend ladder')) + '">';
        ready.forEach(function (c) {
            var h = 46 + Math.round(58 * (parseFloat(c.target) || 0) / top);
            html += '<li class="dc-rung' + (c.enabled ? ' is-on' : ' is-off') + '" style="height:' + h + 'px">' +
                '<span class="dc-rung-get">+HK$' + round2(c.face).toFixed(0) + '</span>' +
                '<span class="dc-rung-spend">HK$' + round2(c.target).toFixed(0) + '</span></li>';
        });
        html += '</ol>';
        var empty = rows.length - ready.length;
        if (empty) {
            html += '<p class="dc-hint">' + empty + ' ' + esc(ct('coupons.ladder.blank', 'more rows left blank.')) + '</p>';
        }
        return html;
    }

    function cashRulesSummary(rules) {
        rules = normalizeCashRules(rules || _cashRules);
        var text = rules.maxCount > 0
            ? ct('coupons.cash.sumCount', 'Up to') + ' ' + rules.maxCount + ' ' + ct('coupons.cash.sumPer', 'cash coupons per bill')
            : ct('coupons.cash.sumAny', 'Any number of cash coupons per bill');
        if (rules.maxPercent > 0 || rules.maxAmount > 0) {
            text += ' · ' + ct('coupons.cash.sumMax', 'at most') + ' ' + cashLimitText(rules);
        } else {
            text += ' · ' + ct('coupons.cash.noLimit', 'no amount limit');
        }
        return text;
    }

    function cashRulesHtml() {
        var r = cashRules();
        var opts = '<option value="0"' + (r.maxCount === 0 ? ' selected' : '') + '>' + esc(ct('coupons.cash.anyCount', 'No limit')) + '</option>';
        for (var n = 1; n <= CASH_STACK_MAX; n++) {
            opts += '<option value="' + n + '"' + (n === r.maxCount ? ' selected' : '') + '>' + n + '</option>';
        }
        return '<div class="dc-cash-rules" id="dcCashRules">' +
            '<div class="dc-cash-rules-title">' + esc(ct('coupons.cash.title', 'Using cash coupons on one bill')) + '</div>' +
            '<div class="dc-camp-grid">' +
            '<label class="dc-field"><span>' + esc(ct('coupons.cash.count', 'Cash coupons per bill')) + '</span>' +
            '<select class="dc-cash-rule" data-cash-prop="maxCount">' + opts + '</select></label>' +
            '<label class="dc-field"><span>' + esc(ct('coupons.cash.maxOff', 'Max cash off per bill')) + '</span>' +
            '<span class="dc-cash-limit">' +
            '<input type="number" class="dc-cash-rule" data-cash-prop="maxPercent" min="0" max="100" step="1" value="' +
                (r.maxPercent > 0 ? esc(r.maxPercent) : '') + '" placeholder="—" aria-label="' + esc(ct('coupons.cash.pctLabel', 'Max % of the bill')) + '">' +
            '<span class="dc-cash-unit">% ' + esc(ct('coupons.cash.ofBill', 'of the bill')) + '</span>' +
            '<span class="dc-cash-unit">' + esc(ct('coupons.cash.upTo', 'up to')) + ' HK$</span>' +
            '<input type="number" class="dc-cash-rule" data-cash-prop="maxAmount" min="0" step="100" value="' +
                (r.maxAmount > 0 ? esc(r.maxAmount) : '') + '" placeholder="—" aria-label="' + esc(ct('coupons.cash.amtLabel', 'Max HK$ per bill')) + '">' +
            '</span></label></div>' +
            '<p class="dc-hint dc-cash-sum" id="dcCashSum">' + esc(cashRulesSummary(r)) + '</p>' +
            '<p class="dc-hint">' + esc(ct('coupons.cash.hint',
                'Only cash coupons stack. Spend, new-chart and referral coupons stay one per bill and are not combined with cash. Default: any number of cash coupons, 50% of the bill up to HK$3,000 — both limits apply and the smaller one wins. Leave a box blank to drop that limit. The percentage is of the whole bill before coupons.')) + '</p>' +
            '</div>';
    }

    function clinicBannerHtml(clinics) {
        var off = (clinics || configClinics()).map(function (c) { return String(c.clinic_code || '').toUpperCase(); })
            .filter(function (code) { return code && !clinicJoined(code); });
        if (!off.length) return '';
        return '<p class="dc-banner dc-banner-warn" role="status"><b>' + esc(ct('coupons.banner.off', 'Coupons are switched off at')) +
            ' ' + esc(off.join(', ')) + '.</b> ' +
            esc(ct('coupons.banner.offHint', 'Bills at these clinics do not use or earn coupons.')) + '</p>';
    }

    function paintConfig(pane) {
        var clinics = configClinics();
        var open = 0;
        clinics.forEach(function (c, i) {
            if (String(c.clinic_code || '').toUpperCase() === DEFAULT_JOIN_CODE) open = i;
        });
        var html = '<div class="dc-cfg">';
        html += '<h2 class="dc-title">' + esc(ct('coupons.cfg.title', 'Discount Coupons')) + '</h2>';
        html += '<p class="dc-blurb">' + esc(ct('coupons.cfg.blurb',
            'Separate from reward points. KT is joined. Other clinics stay off until you tick them. Each bill can use one whole-bill coupon plus one treatment coupon. A treatment coupon applies only to the catalog items listed on it.')) + '</p>';
        html += '<div id="dcCfgBanner">' + clinicBannerHtml(clinics) + '</div>';
        html += rulesNoteHtml();

        html += '<div class="dc-card"><div class="dc-card-title">' + esc(ct('coupons.cfg.clinics', 'Clinics in scheme')) + '</div>';
        html += '<div class="dc-tabs" role="tablist">';
        clinics.forEach(function (c, i) {
            var code = String(c.clinic_code || '').toUpperCase();
            var on = clinicJoined(code);
            html += '<button type="button" class="dc-tab' + (i === open ? ' is-active' : '') + '" data-dc-tab="' + esc(code) + '">' +
                esc(code || '—') + (on ? '<span class="dc-dot"></span>' : '') + '</button>';
        });
        html += '</div>';
        clinics.forEach(function (c, i) {
            var code = String(c.clinic_code || '').toUpperCase();
            var on = clinicJoined(code);
            var docs = [];
            if (typeof doctorsForClinic === 'function' && c.id) {
                try { docs = doctorsForClinic(c.id) || []; } catch (e) { docs = []; }
            }
            html += '<div class="dc-panel' + (i === open ? ' is-active' : '') + '" data-dc-panel="' + esc(code) + '"' +
                (i === open ? '' : ' hidden') + '>';
            html += '<div class="dc-row dc-clinic-row"><span>' + esc(code) + ' · ' + esc(c.english_name || c.chinese_name || '') + '</span>' +
                '<label class="dc-join dc-switch"><input type="checkbox" class="dc-clinic-join" data-code="' + esc(code) +
                '" data-id="' + esc(c.id || '') + '"' + (on ? ' checked' : '') + '> ' +
                esc(ct('coupons.cfg.join', 'Join')) + '</label></div>';
            html += '<div class="dc-row dc-doc"><span>' + esc(ct('coupons.cfg.allDoctors', 'All Doctors')) + '</span>' +
                '<label class="dc-join dc-switch"><input type="checkbox" class="dc-doc-join" data-code="' + esc(code) +
                '" data-doctor="__all__"' + (doctorJoined(code, '__all__') ? ' checked' : '') + '> ' +
                esc(ct('coupons.cfg.join', 'Join')) + '</label></div>';
            docs.forEach(function (d) {
                if (!d || d.is_active === false) return;
                var label = d.english_name || d.chinese_name || d.doctor_code || d.id;
                var key = String(d.id || d.doctor_code || label);
                html += '<div class="dc-row dc-doc"><span>' + esc(label) + '</span>' +
                    '<label class="dc-join dc-switch"><input type="checkbox" class="dc-doc-join" data-code="' + esc(code) +
                    '" data-doctor="' + esc(key) + '"' + (doctorJoined(code, key) ? ' checked' : '') + '> ' +
                    esc(ct('coupons.cfg.join', 'Join')) + '</label></div>';
            });
            html += '</div>';
        });
        html += '</div>';

        html += '<div class="dc-card"><div class="dc-card-title">' + esc(ct('coupons.cfg.spendTitle', 'Expenditure coupons')) + '</div>';
        html += '<p class="dc-hint">' + esc(ct('coupons.cfg.spendHint',
            'Five combinations. The first three are filled in. The last two stay empty until you set the spend and the coupon. A row issues only when it is on and both amounts are filled. One bill can earn every row it reaches.')) + '</p>';
        html += '<div class="dc-ladder-wrap" id="dcLadder">' + ladderHtml() + '</div>';
        campaigns().forEach(function (c) {
            if (!c || c.trigger !== 'target_spend') return;
            var title = campLabel(c);
            html += '<div class="dc-spend" data-camp="' + esc(c.key) + '">';
            html += '<div class="dc-camp-top"><label class="dc-camp-head dc-switch"><input type="checkbox" class="dc-camp-on" data-key="' + esc(c.key) + '"' +
                (c.enabled ? ' checked' : '') + '><strong class="dc-spend-label">' + esc(title) + '</strong></label>' +
                statusBadgeHtml(c) + '</div>';
            html += '<div class="dc-camp-grid">';
            html += field(c.key, 'target', ct('coupons.cfg.spend', 'Spend HK$'), c.target, true);
            html += field(c.key, 'face', ct('coupons.cfg.get', 'Coupon HK$'), c.face, true);
            html += field(c.key, 'expiryDays', ct('coupons.cfg.expiry', 'Days'), c.expiryDays);
            html += field(c.key, 'holdLimit', ct('coupons.cfg.hold', 'Hold up to'), holdLimitFor(c));
            html += limitFields(c);
            html += '</div>' + usageLine(c) + '</div>';
        });
        html += '<p class="dc-hint">' + esc(ct('coupons.cfg.capHint',
            'Issue cap and budget are optional. Leave them blank for no limit. Voided coupons do not count.')) + '</p>';
        html += '</div>';

        html += '<div class="dc-card"><div class="dc-card-title">' + esc(ct('coupons.cfg.campaigns', 'Campaigns')) + '</div>';
        html += '<p class="dc-hint">' + esc(ct('coupons.cfg.campaignHint',
            'Turn each offer on or off. A treatment coupon fits the items ticked in its list; the smart keyword filter ticks matching items for you.')) + '</p>';
        html += '<div class="dc-camp-list">';
        campaigns().forEach(function (c) {
            if (!c || c.trigger === 'target_spend') return;
            html += '<div class="dc-camp" data-camp="' + esc(c.key) + '" data-kind="' + kindOf(c) + '">';
            html += '<div class="dc-camp-top"><label class="dc-camp-head dc-switch"><input type="checkbox" class="dc-camp-on" data-key="' + esc(c.key) + '"' +
                (c.enabled ? ' checked' : '') + '><strong>' + esc(campLabel(c)) + '</strong></label>' +
                statusBadgeHtml(c) + '</div>';
            html += previewTicketHtml(c);
            html += '<div class="dc-camp-grid">';
            html += field(c.key, 'face', 'HK$', c.face);
            if (c.mode === 'percent') html += field(c.key, 'percent', '%', c.percent);
            html += field(c.key, 'expiryDays', ct('coupons.cfg.expiry', 'Days'), c.expiryDays);
            html += field(c.key, 'maxDiscount', ct('coupons.cfg.ceiling', 'Ceiling'), c.maxDiscount);
            html += field(c.key, 'holdLimit', ct('coupons.cfg.hold', 'Hold up to'), holdLimitFor(c));
            html += limitFields(c);
            html += '</div>' + usageLine(c);
            if (c.key === 'cash') html += cashRulesHtml();
            if (c.scope === 'items') html += itemPickerHtml(c);
            html += '</div>';
        });
        html += '</div></div>';
        var today = new Date();
        var from = new Date(today.getTime() - 30 * 86400000);
        html += '<div class="dc-card" id="dcLogCard"><div class="dc-card-title">' + esc(ct('coupons.log.title', 'Coupon log')) + '</div>' +
            '<p class="dc-hint">' + esc(ct('coupons.log.hint',
                'Every coupon issued, gifted, transferred, given back on a void, or cancelled. Gifts show the login that gave them.')) + '</p>' +
            '<div class="dc-log-filter">' +
            '<input type="date" id="dcLogFrom" value="' + from.toISOString().slice(0, 10) + '">' +
            '<span>→</span>' +
            '<input type="date" id="dcLogTo" value="' + today.toISOString().slice(0, 10) + '">' +
            '<input type="text" id="dcLogChart" placeholder="' + esc(ct('coupons.log.chart', 'Chart no.')) + '">' +
            '<button type="button" id="dcLogGo">' + esc(ct('coupons.log.load', 'Show')) + '</button>' +
            '<button type="button" id="dcLogCsv" class="dc-log-csv" disabled>' + esc(ct('coupons.log.csv', 'Export CSV')) + '</button></div>' +
            '<div class="dc-log-chips" id="dcLogChips" role="group"></div>' +
            '<div class="dc-log-wrap" id="dcLogBody"></div></div>';
        html += '</div>';
        pane.innerHTML = html;
        ensureCss();
        wireConfig(pane);
        var go = document.getElementById('dcLogGo');
        if (go) go.onclick = function () { loadCouponLog(); };
        var csv = document.getElementById('dcLogCsv');
        if (csv) csv.onclick = downloadCouponLog;
        loadCouponLog();
    }

    function patientNoMap(ids) {
        var list = (ids || []).filter(Boolean);
        if (!list.length || typeof SB === 'undefined' || !SB) return Promise.resolve({});
        return SB.from('patients').select('id,patient_no,full_name').in('id', list.slice(0, 300)).then(function (r) {
            var map = {};
            ((r && r.data) || []).forEach(function (p) { map[String(p.id)] = p; });
            return map;
        }, function () { return {}; });
    }

    /** Pure: merge issued coupon rows and audit rows into one newest-first list. */
    function couponAmountText(c) {
        var camp = campaignByKey(c && c.campaign_key) || {};
        var mode = (c && c.discount_mode) || camp.mode;
        if (mode === 'free_line') return '';
        if (mode === 'percent') return round2(parseFloat(c.percent) || 0) + '%';
        return 'HK$' + round2(c && c.face_value).toFixed(2);
    }

    /**
     * Pure: merge issued coupon rows and audit rows into one newest-first list.
     * couponById (optional) fills coupon / amount / code on audit rows whose coupon was issued outside the period.
     */
    function buildCouponLog(coupons, audits, patients, couponById) {
        patients = patients || {};
        var byId = {};
        Object.keys(couponById || {}).forEach(function (k) { byId[k] = couponById[k]; });
        (coupons || []).forEach(function (c) { if (c && c.id != null) byId[String(c.id)] = c; });
        var grants = {};
        (audits || []).forEach(function (a) {
            if (String(a.operation || '').toUpperCase() === 'GRANT' && a.record_id) grants[String(a.record_id)] = a;
        });
        var out = [];
        (coupons || []).forEach(function (c) {
            var camp = campaignByKey(c.campaign_key) || {};
            var p = patients[String(c.patient_id)] || {};
            var grant = c.id != null ? grants[String(c.id)] : null;
            var gifted = !!grant || /gift/i.test(String(c.note || ''));
            out.push({
                at: c.issued_at || '',
                op: gifted ? 'GIFT' : 'ISSUE',
                who: (grant && (grant.user_name || grant.user_id)) || c.issued_by || (gifted ? '' : ct('coupons.log.auto', 'Automatic')),
                clinic: c.clinic_code || (grant && grant.clinic_tag) || '',
                chart: (grant && grant.patient_no) || p.patient_no || '',
                coupon: campLabel(camp.key ? camp : c),
                amount: couponAmountText(c),
                code: c.code || '',
                status: c.status || '',
                note: c.note || ''
            });
        });
        (audits || []).forEach(function (a) {
            var op = String(a.operation || '').toUpperCase();
            if (op === 'GRANT') return;
            var c = a.record_id ? byId[String(a.record_id)] : null;
            var camp = c ? (campaignByKey(c.campaign_key) || {}) : {};
            out.push({
                at: a.created_at || '',
                op: op,
                who: a.user_name || a.user_id || '',
                clinic: a.clinic_tag || '',
                chart: a.patient_no || '',
                coupon: c ? campLabel(camp.key ? camp : c) : '',
                amount: c ? couponAmountText(c) : '',
                code: c ? (c.code || '') : '',
                status: '',
                note: a.changes_detail || ''
            });
        });
        out.sort(function (x, y) { return String(y.at).localeCompare(String(x.at)); });
        return out;
    }

    function loadCouponLog() {
        var body = document.getElementById('dcLogBody');
        if (!body) return;
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            body.innerHTML = '<p class="dc-hint" style="padding:8px;">' + esc(ct('coupons.log.noDb', 'Database not connected.')) + '</p>';
            return;
        }
        var from = (document.getElementById('dcLogFrom') || {}).value || '';
        var to = (document.getElementById('dcLogTo') || {}).value || '';
        var chart = String((document.getElementById('dcLogChart') || {}).value || '').trim();
        body.innerHTML = '<p class="dc-hint" style="padding:8px;">' + esc(ct('common.loadingEllipsis', 'Loading…')) + '</p>';
        var start = (from || '2000-01-01') + 'T00:00:00';
        var end = (to || '2999-12-31') + 'T23:59:59.999';
        var patientP = chart ? resolveReferrer(chart) : Promise.resolve(null);
        patientP.then(function (patient) {
            if (chart && !patient) {
                body.innerHTML = '<p class="dc-hint" style="padding:8px;">' + esc(ct('coupons.xfer.missing', 'Chart not found')) + '</p>';
                return null;
            }
            var cq = SB.from('discount_coupons').select('*').gte('issued_at', start).lte('issued_at', end)
                .order('issued_at', { ascending: false }).limit(500);
            if (patient) cq = cq.eq('patient_id', patient.id);
            var auditTable = (typeof AUDIT_TRAIL_TABLE !== 'undefined' && AUDIT_TRAIL_TABLE) ? AUDIT_TRAIL_TABLE : 'audit_trail';
            var aq = SB.from(auditTable).select('*').eq('table_name', 'discount_coupons')
                .gte('created_at', start).lte('created_at', end)
                .order('created_at', { ascending: false }).limit(500);
            if (patient && patient.patient_no) {
                var no = String(patient.patient_no).replace(/[^A-Za-z0-9_\-]/g, '');
                aq = aq.or('patient_no.eq.' + no + ',changes_detail.ilike."*from ' + no + ' to*"');
            }
            return Promise.all([cq, aq.then(function (r) { return r; }, function () { return { data: [] }; })])
                .then(function (res) {
                    if (res[0] && res[0].error) {
                        body.innerHTML = '<p class="dc-err" style="padding:8px;">' + esc(res[0].error.message) + '</p>';
                        return null;
                    }
                    var coupons = (res[0] && res[0].data) || [];
                    var audits = (res[1] && !res[1].error && res[1].data) || [];
                    var ids = {};
                    coupons.forEach(function (c) { if (c.patient_id) ids[String(c.patient_id)] = true; });
                    var have = {};
                    coupons.forEach(function (c) { have[String(c.id)] = true; });
                    var missing = [];
                    audits.forEach(function (a) {
                        var id = a.record_id ? String(a.record_id) : '';
                        if (id && !have[id] && missing.indexOf(id) < 0 && /^[0-9a-f-]{36}$/i.test(id)) missing.push(id);
                    });
                    var extraP = missing.length
                        ? SB.from('discount_coupons').select('*').in('id', missing.slice(0, 300)).then(function (r) {
                            var map = {};
                            ((r && r.data) || []).forEach(function (c) { map[String(c.id)] = c; });
                            return map;
                        }, function () { return {}; })
                        : Promise.resolve({});
                    return Promise.all([patientNoMap(Object.keys(ids)), extraP]).then(function (both) {
                        paintCouponLog(body, buildCouponLog(coupons, audits, both[0], both[1]));
                    });
                });
        });
    }

    var _logRows = [];
    var _logFilter = 'all';
    var LOG_OPS = ['ISSUE', 'GIFT', 'TRANSFER', 'RESTORE', 'CANCEL'];

    function logOpNames() {
        return {
            GIFT: ct('coupons.log.gift', '贈送 Gift'),
            ISSUE: ct('coupons.log.issue', '發出 Issue'),
            TRANSFER: ct('coupons.log.transfer', '轉讓 Transfer'),
            RESTORE: ct('coupons.log.restore', '退回 Restore'),
            CANCEL: ct('coupons.log.cancel', '取消 Cancel')
        };
    }

    function paintLogChips(rows) {
        var host = document.getElementById('dcLogChips');
        if (!host) return;
        if (!rows.length) { host.innerHTML = ''; return; }
        var counts = {};
        rows.forEach(function (r) { counts[r.op] = (counts[r.op] || 0) + 1; });
        var ops = LOG_OPS.slice();
        Object.keys(counts).forEach(function (op) { if (ops.indexOf(op) < 0) ops.push(op); });
        var names = logOpNames();
        var html = '<button type="button" class="dc-chip' + (_logFilter === 'all' ? ' is-on' : '') + '" data-log-op="all" aria-pressed="' +
            (_logFilter === 'all') + '">' + esc(ct('coupons.chip.all', 'All')) + ' <span class="dc-chip-n">' + rows.length + '</span></button>';
        ops.forEach(function (op) {
            if (!counts[op]) return;
            html += '<button type="button" class="dc-chip dc-chip-op' + (_logFilter === op ? ' is-on' : '') + '" data-log-op="' + esc(op) +
                '" data-op="' + esc(op) + '" aria-pressed="' + (_logFilter === op) + '">' + esc(names[op] || op) +
                ' <span class="dc-chip-n">' + counts[op] + '</span></button>';
        });
        host.innerHTML = html;
        host.querySelectorAll('[data-log-op]').forEach(function (b) {
            b.onclick = function () {
                _logFilter = b.getAttribute('data-log-op');
                var body = document.getElementById('dcLogBody');
                if (body) paintCouponLog(body, _logRows);
            };
        });
    }

    function filteredLogRows() {
        return _logFilter === 'all' ? _logRows : _logRows.filter(function (r) { return r.op === _logFilter; });
    }

    /** Pure: CSV text (with a BOM so Excel reads Chinese) for log rows. */
    function couponLogCsv(rows) {
        var names = logOpNames();
        function cell(v) {
            var s = String(v == null ? '' : v);
            return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
        }
        var head = ['When', 'Action', 'By', 'Clinic', 'Chart no.', 'Coupon', 'Amount', 'Code', 'Status', 'Detail'];
        var out = [head.join(',')];
        (rows || []).forEach(function (r) {
            out.push([
                r.at ? String(r.at).replace('T', ' ').slice(0, 19) : '', names[r.op] || r.op, r.who, r.clinic, r.chart,
                r.coupon, r.amount, r.code, r.status, r.note
            ].map(cell).join(','));
        });
        return '\uFEFF' + out.join('\r\n');
    }

    function downloadCouponLog() {
        var rows = filteredLogRows();
        if (!rows.length || typeof Blob === 'undefined') return;
        var from = (document.getElementById('dcLogFrom') || {}).value || '';
        var to = (document.getElementById('dcLogTo') || {}).value || '';
        var blob = new Blob([couponLogCsv(rows)], { type: 'text/csv;charset=utf-8' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'coupon-log_' + (from || 'all') + '_' + (to || 'now') + (_logFilter === 'all' ? '' : '_' + _logFilter.toLowerCase()) + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
    }

    function paintCouponLog(body, rows) {
        if (rows !== _logRows) {
            _logRows = rows || [];
            var known = _logRows.some(function (r) { return r.op === _logFilter; });
            if (!known) _logFilter = 'all';
        }
        paintLogChips(_logRows);
        var csvBtn = document.getElementById('dcLogCsv');
        if (csvBtn) csvBtn.disabled = !_logRows.length;
        rows = filteredLogRows();
        if (!rows.length) {
            body.innerHTML = '<p class="dc-hint" style="padding:8px;">' + esc(ct('coupons.log.empty', 'No coupon activity in this period.')) + '</p>';
            return;
        }
        var opName = logOpNames();
        var html = '<table class="dc-log"><thead><tr>' +
            '<th>' + esc(ct('coupons.log.when', 'When')) + '</th>' +
            '<th>' + esc(ct('coupons.log.what', 'Action')) + '</th>' +
            '<th>' + esc(ct('coupons.log.who', 'By')) + '</th>' +
            '<th>' + esc(ct('coupons.log.clinic', 'Clinic')) + '</th>' +
            '<th>' + esc(ct('coupons.log.chart', 'Chart no.')) + '</th>' +
            '<th>' + esc(ct('coupons.log.coupon', 'Coupon')) + '</th>' +
            '<th>' + esc(ct('coupons.log.amount', 'Amount')) + '</th>' +
            '<th>' + esc(ct('coupons.log.code', 'Code')) + '</th>' +
            '<th>' + esc(ct('coupons.log.note', 'Detail')) + '</th>' +
            '</tr></thead><tbody>';
        rows.forEach(function (r) {
            var when = r.at ? String(r.at).replace('T', ' ').slice(0, 16) : '';
            html += '<tr><td>' + esc(when) + '</td>' +
                '<td class="dc-op"><span class="dc-op-badge" data-op="' + esc(r.op) + '">' + esc(opName[r.op] || r.op) + '</span></td>' +
                '<td>' + esc(r.who) + '</td>' +
                '<td>' + esc(r.clinic) + '</td>' +
                '<td>' + esc(r.chart) + '</td>' +
                '<td>' + esc(r.coupon) + '</td>' +
                '<td>' + esc(r.amount) + '</td>' +
                '<td>' + esc(r.code) + '</td>' +
                '<td>' + esc(r.note + (r.status && r.status !== 'unused' ? ' [' + r.status + ']' : '')) + '</td></tr>';
        });
        html += '</tbody></table>';
        body.innerHTML = html;
    }

    function limitFields(c) {
        return field(c.key, 'issueCap', ct('coupons.cfg.cap', 'Issue cap'), c.issueCap, true) +
            field(c.key, 'budget', ct('coupons.cfg.budget', 'Budget HK$'), c.budget, true);
    }

    function usageLine(c) {
        var text = usageText(c);
        return '<p class="dc-usage" data-usage="' + esc(c.key) + '"' + (text ? '' : ' hidden') + '>' + esc(text) + '</p>';
    }

    function field(key, prop, label, value, blankZero) {
        var empty = !!blankZero && !((parseFloat(value) || 0) > 0);
        var shown = empty ? '' : value;
        return '<label class="dc-field"><span>' + esc(label) + '</span>' +
            '<input type="number" class="dc-num" data-key="' + esc(key) + '" data-prop="' + esc(prop) +
            '" value="' + esc(shown) + '"' + (empty ? ' placeholder="—"' : '') +
            ' min="0" step="0.01"></label>';
    }

    function wireConfig(pane) {
        function swap(el, html) {
            if (!el) return;
            var tmp = document.createElement('div');
            tmp.innerHTML = html;
            if (tmp.firstChild) el.parentNode.replaceChild(tmp.firstChild, el);
        }
        function refreshCamp(key) {
            var camp = campaignByKey(key);
            if (!camp) return;
            swap(pane.querySelector('.dc-badge[data-badge="' + key + '"]'), statusBadgeHtml(camp));
            swap(pane.querySelector('.dc-ticket[data-preview="' + key + '"]'), previewTicketHtml(camp));
            if (camp.trigger === 'target_spend') {
                var ladder = pane.querySelector('#dcLadder');
                if (ladder) ladder.innerHTML = ladderHtml();
            }
        }
        function refreshClinics() {
            var banner = pane.querySelector('#dcCfgBanner');
            if (banner) banner.innerHTML = clinicBannerHtml();
            pane.querySelectorAll('.dc-tab').forEach(function (b) {
                var code = b.getAttribute('data-dc-tab');
                var dot = b.querySelector('.dc-dot');
                if (clinicJoined(code) && !dot) b.insertAdjacentHTML('beforeend', '<span class="dc-dot"></span>');
                else if (!clinicJoined(code) && dot) dot.parentNode.removeChild(dot);
            });
        }
        pane.querySelectorAll('.dc-tab').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var code = btn.getAttribute('data-dc-tab');
                pane.querySelectorAll('.dc-tab').forEach(function (b) { b.classList.toggle('is-active', b === btn); });
                pane.querySelectorAll('.dc-panel').forEach(function (p) {
                    var on = p.getAttribute('data-dc-panel') === code;
                    p.classList.toggle('is-active', on);
                    if (on) p.removeAttribute('hidden');
                    else p.setAttribute('hidden', '');
                });
            });
        });
        pane.querySelectorAll('.dc-clinic-join').forEach(function (box) {
            box.addEventListener('change', function () {
                setClinicJoined(box.getAttribute('data-code'), box.getAttribute('data-id'), box.checked);
                refreshClinics();
            });
        });
        pane.querySelectorAll('.dc-doc-join').forEach(function (box) {
            box.addEventListener('change', function () {
                setDoctorJoined(box.getAttribute('data-code'), box.getAttribute('data-doctor'), box.checked);
            });
        });
        pane.querySelectorAll('.dc-cash-rule').forEach(function (el) {
            el.addEventListener('change', function () {
                var prop = el.getAttribute('data-cash-prop');
                var patch = {};
                patch[prop] = parseFloat(el.value) || 0;
                setCashRules(patch);
                var r = cashRules();
                if (prop !== 'maxCount') el.value = r[prop] > 0 ? String(r[prop]) : '';
                var sum = pane.querySelector('#dcCashSum');
                if (sum) sum.textContent = cashRulesSummary(r);
            });
        });
        pane.querySelectorAll('.dc-camp-on').forEach(function (box) {
            box.addEventListener('change', function () {
                setCampaignPatch(box.getAttribute('data-key'), { enabled: box.checked });
                refreshCamp(box.getAttribute('data-key'));
            });
        });
        pane.querySelectorAll('.dc-num').forEach(function (input) {
            input.addEventListener('change', function () {
                var key = input.getAttribute('data-key');
                var prop = input.getAttribute('data-prop');
                var patch = {};
                patch[prop] = parseFloat(input.value) || 0;
                var camp = campaignByKey(key);
                if (camp && camp.trigger === 'target_spend' && (prop === 'target' || prop === 'face')) {
                    var target = prop === 'target' ? patch.target : camp.target;
                    var face = prop === 'face' ? patch.face : camp.face;
                    if ((parseFloat(target) || 0) > 0 && (parseFloat(face) || 0) > 0) {
                        patch.name = 'Spend $' + round2(target) + ' get $' + round2(face);
                        patch.nameZh = '滿$' + round2(target) + '送$' + round2(face);
                        var row = input.closest ? input.closest('.dc-spend') : null;
                        var label = row && row.querySelector('.dc-spend-label');
                        if (label) label.textContent = campLabel({ key: key, trigger: 'target_spend', target: target, face: face });
                    }
                }
                setCampaignPatch(key, patch);
                refreshCamp(key);
                if (prop === 'issueCap' || prop === 'budget') {
                    loadUsage().then(function () {
                        refreshCamp(key);
                        var line = pane.querySelector('.dc-usage[data-usage="' + key + '"]');
                        if (!line) return;
                        var text = usageText(campaignByKey(key));
                        line.textContent = text;
                        if (text) line.removeAttribute('hidden');
                        else line.setAttribute('hidden', '');
                    });
                }
            });
        });
        function repaintPicker(key) {
            var camp = campaignByKey(key);
            var list = pane.querySelector('.dc-pick-list[data-key="' + key + '"]');
            var sum = pane.querySelector('.dc-pick[data-key="' + key + '"] .dc-pick-sum');
            if (!camp || !list) return;
            list.innerHTML = pickListHtml(camp);
            if (sum) sum.textContent = pickSummaryText(camp);
            var q = pane.querySelector('.dc-pick-q[data-key="' + key + '"]');
            if (q && q.value) filterPicker(key, q.value);
            refreshCamp(key);
        }
        function filterPicker(key, text) {
            var q = String(text || '').trim().toLowerCase();
            pane.querySelectorAll('.dc-pick-list[data-key="' + key + '"] .dc-pick-item').forEach(function (row) {
                row.style.display = !q || row.getAttribute('data-name').indexOf(q) >= 0 ? '' : 'none';
            });
        }
        if (pane.__dcPickBound) return;
        pane.__dcPickBound = true;
        pane.addEventListener('change', function (ev) {
            var el = ev.target;
            if (!el || !el.classList) return;
            var key = el.getAttribute('data-key');
            var camp = key ? campaignByKey(key) : null;
            if (!camp) return;
            if (el.classList.contains('dc-pick-on')) {
                var name = el.getAttribute('data-name');
                var rule = itemRule(camp);
                var hit = rule.smart && keywordHit(name, rule.keywords, rule.excludeKeywords);
                var names = (camp.itemNames || []).filter(function (n) { return n !== name; });
                var excl = (camp.excludeNames || []).filter(function (n) { return n !== name; });
                if (el.checked) { if (!hit) names.push(name); }
                else if (hit) excl.push(name);
                setCampaignPatch(key, { itemNames: names, excludeNames: excl });
                repaintPicker(key);
            } else if (el.classList.contains('dc-smart')) {
                setCampaignPatch(key, { smart: !!el.checked });
                repaintPicker(key);
            } else if (el.classList.contains('dc-kw')) {
                var patch = {};
                patch[el.getAttribute('data-prop')] = String(el.value || '').split(/[,，、;\n]+/)
                    .map(function (s) { return s.trim(); }).filter(Boolean);
                setCampaignPatch(key, patch);
                repaintPicker(key);
            }
        });
        pane.addEventListener('input', function (ev) {
            var el = ev.target;
            if (el && el.classList && el.classList.contains('dc-pick-q')) filterPicker(el.getAttribute('data-key'), el.value);
        });
    }

    function parseItems(bill) {
        var raw = bill && bill.items;
        if (typeof raw === 'string') {
            try { raw = JSON.parse(raw); } catch (e) { raw = []; }
        }
        return Array.isArray(raw) ? raw : [];
    }

    function eligibleBeforeCoupon(bill) {
        var sub = parseFloat(bill && bill.subtotal) || 0;
        var disc = parseFloat(bill && bill.discount) || 0;
        return Math.max(0, round2(sub - disc));
    }

    /** Line discounts + extra % discount + coupons, in dollars. */
    function billSavings(bill) {
        var lines = parseItems(bill);
        var gross = 0;
        var net = 0;
        lines.forEach(function (line) {
            var qty = parseFloat(line && line.qty);
            if (!isFinite(qty) || qty <= 0) qty = 1;
            gross += Math.round(cents(line && (line.price != null ? line.price : line.unit_price)) * qty);
            net += lineNetCents(line);
        });
        var lineDisc = Math.max(0, gross - net);
        var extra = cents(bill && bill.discount);
        var coupon = cents(bill && bill.coupon_amount);
        return {
            lines: money(lineDisc),
            extra: money(extra),
            coupon: money(coupon),
            total: money(lineDisc + extra + coupon)
        };
    }

    /** Next spend row this bill has not reached, and the rows it already reaches. */
    function spendProgress(amount, list) {
        var rows = (list || campaigns()).filter(function (c) {
            return c && c.trigger === 'target_spend' && c.enabled &&
                (parseFloat(c.target) || 0) > 0 && (parseFloat(c.face) || 0) > 0;
        }).sort(function (a, b) { return (parseFloat(a.target) || 0) - (parseFloat(b.target) || 0); });
        var amt = cents(amount);
        var reached = rows.filter(function (c) { return amt >= cents(c.target); });
        var next = rows.filter(function (c) { return amt < cents(c.target); })[0] || null;
        return {
            reached: reached,
            next: next,
            shortBy: next ? money(cents(next.target) - amt) : 0
        };
    }

    function syncBillDetail(bill) {
        var row = document.getElementById('bdCouponRow');
        if (!row || !bill) return;
        var amt = document.getElementById('bdCouponAmt');
        var label = document.getElementById('bdCouponLabel');
        var value = round2(bill.coupon_amount || 0);
        if (amt) amt.textContent = value ? ('−' + value.toFixed(2)) : '0.00';
        if (label) {
            label.textContent = bill.coupon_label || (value ? ct('coupons.bill.applied', 'Coupon applied') : ct('coupons.bill.none', 'No coupon'));
        }
        var locked = (parseFloat(bill.amount_paid) || 0) > 0.005;
        row.classList.toggle('is-locked', locked);
        var btn = document.getElementById('bdCouponPick');
        if (btn) btn.disabled = locked;
        ensureCss();
        paintBillSavings(bill);
        refreshBillCouponInfo(bill);
    }

    function paintBillSavings(bill) {
        var host = document.getElementById('bdSavedRow');
        if (!host) return;
        var s = billSavings(bill);
        if (s.total <= 0.005) {
            host.hidden = true;
            return;
        }
        host.hidden = false;
        var amt = document.getElementById('bdSavedAmt');
        var detail = document.getElementById('bdSavedDetail');
        if (amt) amt.textContent = 'HK$' + s.total.toFixed(2);
        if (detail) {
            var parts = [];
            if (s.lines > 0.005) parts.push(ct('coupons.saved.lines', 'Line discounts') + ' ' + s.lines.toFixed(2));
            if (s.extra > 0.005) parts.push(ct('coupons.saved.extra', 'Extra discount') + ' ' + s.extra.toFixed(2));
            if (s.coupon > 0.005) parts.push(ct('coupons.saved.coupon', 'Coupons') + ' ' + s.coupon.toFixed(2));
            detail.textContent = parts.join(' · ');
        }
    }

    function refreshBillCouponInfo(bill) {
        var info = document.getElementById('bdCouponInfo');
        if (!info || !bill || !bill.id) return;
        var billId = String(bill.id);
        info.setAttribute('data-bill', billId);
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            info.hidden = true;
            return;
        }
        var clinicCode = String(bill.clinic_tag || '').trim() || clinicCodeNow();
        loadState().then(function () {
            if (!clinicJoined(clinicCode)) {
                info.hidden = true;
                return null;
            }
            var usedQ = SB.from('discount_coupons').select('id,campaign_key,redeemed_amount')
                .eq('bill_id', bill.id).eq('status', 'used');
            var earnedQ = SB.from('discount_coupons').select('id,campaign_key,face_value,expires_on,status')
                .eq('origin_bill_id', bill.id);
            return Promise.all([usedQ, earnedQ]).then(function (res) {
                if (info.getAttribute('data-bill') !== billId) return;
                var used = (res[0] && res[0].data) || [];
                var earned = ((res[1] && res[1].data) || []).filter(function (c) { return c.status !== 'void'; });
                if (used.length && !bill.coupon_label) {
                    bill.coupon_label = couponLabelFor(used.map(function (c) { return { coupon: c }; }));
                    var label = document.getElementById('bdCouponLabel');
                    if (label) label.textContent = bill.coupon_label;
                }
                var lines = [];
                var bar = '';
                if (earned.length) {
                    lines.push('🎟️ ' + ct('coupons.info.earned', 'Earned from this bill') + ': ' + earned.map(function (c) {
                        return campLabel(c) + ' HK$' + round2(c.face_value).toFixed(0) +
                            (c.expires_on ? ' (' + ct('coupons.info.expires', 'expires') + ' ' + c.expires_on + ')' : '');
                    }).join(' · '));
                }
                var voided = !!bill.voided_at;
                var due = parseFloat(bill.total) || 0;
                var doctorIn = doctorJoined(clinicCode, bill.doctor_id ? String(bill.doctor_id) : '');
                if (!voided && !earned.length && doctorIn) {
                    var prog = spendProgress(due);
                    if (prog.reached.length) {
                        lines.push('✅ ' + ct('coupons.info.willEarn', 'Paid in full by cash, this bill earns') + ': ' +
                            prog.reached.map(campLabel).join(' + '));
                    }
                    if (prog.next) {
                        lines.push('➕ ' + ct('coupons.info.short', 'Spend') + ' HK$' + prog.shortBy.toFixed(2) + ' ' +
                            ct('coupons.info.more', 'more for') + ' ' + campLabel(prog.next));
                    }
                    bar = spendBarHtml(due, prog);
                }
                info.hidden = !lines.length;
                info.innerHTML = lines.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('') + bar;
            });
        }).catch(function () { info.hidden = true; });
    }

    function ensureCatalog() {
        var has = typeof treatmentItemsCache !== 'undefined' && treatmentItemsCache && treatmentItemsCache.length;
        if (has || typeof loadTreatmentItemsForBilling !== 'function') return Promise.resolve();
        return new Promise(function (resolve) {
            try { loadTreatmentItemsForBilling(resolve); } catch (e) { resolve(); }
        });
    }

    function openBillSheet(bill, opts) {
        opts = opts || {};
        bill = bill || (typeof bdCurrentBill !== 'undefined' ? bdCurrentBill : null);
        if (!bill || !bill.patient_id) return;
        var paid = (parseFloat(bill.amount_paid) || 0) > 0.005;
        if (paid && !opts.gift) return;
        ensureCss();
        var clinicCode = '';
        if (typeof currentClinicCodeForTagging === 'function') clinicCode = currentClinicCodeForTagging() || '';
        if (!clinicCode && bill.clinic_tag) clinicCode = bill.clinic_tag;
        Promise.all([loadState(), ensureCatalog()]).then(function () {
            if (!clinicJoined(clinicCode)) {
                paintSheetMessage(ct('coupons.bill.clinicOff', 'This clinic is not in the coupon scheme.'));
                return;
            }
            loadWallet(bill.patient_id).then(function (wallet) {
                paintSheet(bill, wallet, clinicCode, { allowApply: !paid, focusGift: !!opts.gift, tab: opts.tab || '' });
            });
        });
    }

    function loadWallet(patientId) {
        if (!patientId || typeof SB === 'undefined' || !SB) return Promise.resolve([]);
        return SB.from('discount_coupons').select('*').eq('patient_id', patientId)
            .then(function (r) { return (r && r.data) || []; }, function () { return []; });
    }

    function paintSheetMessage(msg) {
        var host = ensureSheet();
        host.innerHTML = '<div class="dc-sheet dc-sheet-msg" role="dialog" aria-modal="true" aria-labelledby="dcSheetTitle">' +
            '<div class="dc-sheet-head"><h3 id="dcSheetTitle">' + esc(ct('coupons.bill.title', '優惠券')) + '</h3>' +
            '<button type="button" class="dc-x" id="dcSheetClose" aria-label="' + esc(ct('common.close', 'Close')) + '">×</button></div>' +
            '<div class="dc-sheet-body"><p class="dc-banner dc-banner-warn">' + esc(msg) + '</p></div></div>';
        showSheet(host);
    }

    var _sheetOpener = null;

    function ensureSheet() {
        var host = document.getElementById('dcSheetHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'dcSheetHost';
            host.setAttribute('hidden', '');
            host.addEventListener('mousedown', function (ev) { if (ev.target === host) closeSheet(); });
            host.addEventListener('keydown', function (ev) {
                var prompt = host.querySelector('.dc-authp');
                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    if (prompt && prompt.__dcCancel) prompt.__dcCancel();
                    else closeSheet();
                    return;
                }
                if (ev.key !== 'Tab') return;
                var items = Array.prototype.filter.call(
                    (prompt || host).querySelectorAll('button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])'),
                    function (el) { return !el.disabled && el.offsetParent !== null; });
                if (!items.length) return;
                var first = items[0];
                var last = items[items.length - 1];
                if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
                else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
            });
            document.body.appendChild(host);
        }
        return host;
    }

    function showSheet(host) {
        var wasHidden = host.hasAttribute('hidden');
        if (wasHidden && document.activeElement && document.activeElement !== document.body) {
            _sheetOpener = document.activeElement;
        }
        host.removeAttribute('hidden');
        var x = document.getElementById('dcSheetClose');
        if (x) {
            x.onclick = closeSheet;
            if (wasHidden) { try { x.focus({ preventScroll: true }); } catch (e) {} }
        }
    }

    function closeSheet() {
        var host = document.getElementById('dcSheetHost');
        var prompt = host && host.querySelector('.dc-authp');
        if (prompt && prompt.__dcCancel) prompt.__dcCancel();
        if (host) host.setAttribute('hidden', '');
        var back = _sheetOpener;
        _sheetOpener = null;
        if (back && document.body.contains(back)) { try { back.focus({ preventScroll: true }); } catch (e) {} }
    }

    /**
     * Ask for a staff login + password on top of the sheet before a gift or transfer.
     * Resolves with the verified app_users row, or null when cancelled.
     */
    function promptGrantor(host, title, summary) {
        return new Promise(function (resolve) {
            var sheet = host && host.querySelector('.dc-sheet');
            if (!sheet) { resolve(null); return; }
            var old = sheet.querySelector('.dc-authp');
            if (old && old.__dcCancel) old.__dcCancel();
            var screenUid = String((typeof currentUserId !== 'undefined' && currentUserId) || '').trim();
            var prefill = SHARED_LOGIN_IDS[screenUid.toLowerCase()] ? '' : screenUid;
            var back = document.activeElement;
            var wrap = document.createElement('div');
            wrap.className = 'dc-authp';
            wrap.setAttribute('role', 'alertdialog');
            wrap.setAttribute('aria-modal', 'true');
            wrap.setAttribute('aria-labelledby', 'dcAuthTitle');
            wrap.innerHTML = '<form class="dc-authp-card dc-auth" id="dcAuthBox" autocomplete="off">' +
                '<h4 id="dcAuthTitle">🔒 ' + esc(title) + '</h4>' +
                '<p class="dc-authp-what">' + esc(summary) + '</p>' +
                '<p class="dc-hint">' + esc(ct('coupons.auth.hint',
                    'Gifting or transferring a coupon needs your own login and password. The shared Nurse login cannot be used.')) + '</p>' +
                '<label class="dc-authp-field"><span>' + esc(ct('coupons.auth.user', 'Login ID')) + '</span>' +
                '<input type="text" id="dcAuthUser" autocomplete="off" spellcheck="false" value="' + esc(prefill) + '"></label>' +
                '<label class="dc-authp-field"><span>' + esc(ct('coupons.auth.pw', 'Password')) + '</span>' +
                '<input type="password" id="dcAuthPw" autocomplete="new-password"></label>' +
                '<p class="dc-err" id="dcAuthErr" hidden></p>' +
                '<p class="dc-hint dc-authp-log">' + esc(ct('coupons.auth.logged', 'This will be recorded in the coupon log under your login.')) + '</p>' +
                '<div class="dc-actions">' +
                '<button type="button" class="dc-clear" data-act="cancel">' + esc(ct('common.cancel', 'Cancel')) + '</button>' +
                '<button type="submit" class="dc-apply" id="dcAuthGo">' + esc(ct('coupons.auth.confirm', 'Confirm')) + '</button>' +
                '</div></form>';
            sheet.appendChild(wrap);
            var form = wrap.querySelector('form');
            var u = wrap.querySelector('#dcAuthUser');
            var p = wrap.querySelector('#dcAuthPw');
            var err = wrap.querySelector('#dcAuthErr');
            var go = wrap.querySelector('#dcAuthGo');
            var done = false;
            function finish(user) {
                if (done) return;
                done = true;
                p.value = '';
                if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
                if (back && document.body.contains(back)) { try { back.focus({ preventScroll: true }); } catch (e) {} }
                resolve(user);
            }
            wrap.__dcCancel = function () { finish(null); };
            wrap.querySelector('[data-act="cancel"]').onclick = function () { finish(null); };
            form.addEventListener('submit', function (ev) {
                ev.preventDefault();
                if (done) return;
                err.hidden = true;
                go.disabled = true;
                var pw = p.value;
                p.value = '';
                verifyGrantor(u.value, pw).then(function (auth) {
                    if (done) return;
                    go.disabled = false;
                    if (auth && auth.ok) { finish(auth.user); return; }
                    err.hidden = false;
                    err.textContent = grantReason(auth && auth.reason);
                    try { p.focus(); } catch (e) {}
                });
            });
            var first = String(u.value || '').trim() ? p : u;
            try { first.focus({ preventScroll: true }); } catch (e) {}
        });
    }

    var WALLET_QR_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    var PHONE_BASE_KEY = 'csPhoneScanBase';
    var _qrLoad = null;

    /** Pure: phone wallet page address. Uses the phone-scan public address when one is saved, else this app's folder. */
    function walletPageBase(loc, savedBase) {
        var saved = String(savedBase || '').trim();
        if (saved && /scan\.html/i.test(saved)) return saved.replace(/scan\.html.*$/i, 'wallet.html');
        var href = String((loc && loc.href) || '').split('#')[0].split('?')[0];
        var i = href.lastIndexOf('/');
        return (i >= 0 ? href.slice(0, i + 1) : href + '/') + 'wallet.html';
    }

    function walletUrl(token, base) {
        var b = base || walletPageBase(typeof location !== 'undefined' ? location : null, savedPhoneBase());
        return b + (b.indexOf('?') >= 0 ? '&' : '?') + 't=' + encodeURIComponent(token);
    }

    function savedPhoneBase() {
        try { return (window.localStorage && localStorage.getItem(PHONE_BASE_KEY)) || ''; } catch (e) { return ''; }
    }

    function isLocalAddress(url) {
        var m = /^(https?:)\/\/([^\/:?#]+)/i.exec(String(url || ''));
        if (!m) return true;
        var h = m[2].toLowerCase();
        return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '0.0.0.0' || /\.local$/.test(h) || /\.test$/.test(h);
    }

    function loadQrLib() {
        if (window.QRCode) return Promise.resolve(window.QRCode);
        if (_qrLoad) return _qrLoad;
        _qrLoad = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = WALLET_QR_CDN;
            s.async = true;
            s.onload = function () { resolve(window.QRCode); };
            s.onerror = function () { _qrLoad = null; reject(new Error('qr load failed')); };
            document.head.appendChild(s);
        });
        return _qrLoad;
    }

    function walletLinkToken(patientId, reset) {
        if (typeof SB === 'undefined' || !SB || typeof SB.rpc !== 'function') return Promise.resolve({ ok: false, reason: 'no_db' });
        return SB.rpc('dc_wallet_link', { p_patient_id: patientId, p_by: actorName() || null, p_reset: !!reset })
            .then(function (r) {
                if (r && r.error) return { ok: false, reason: /dc_wallet_link|function/i.test(String(r.error.message || '')) ? 'no_sql' : 'db' };
                return (r && r.data) || { ok: false, reason: 'db' };
            }, function () { return { ok: false, reason: 'db' }; });
    }

    /** QR over the sheet: the patient scans it to browse their own coupons on the phone. */
    function openWalletQr(host, patientId) {
        var sheet = host && host.querySelector('.dc-sheet');
        if (!sheet || !patientId) return;
        var old = sheet.querySelector('.dc-authp');
        if (old && old.__dcCancel) old.__dcCancel();
        var back = document.activeElement;
        var wrap = document.createElement('div');
        wrap.className = 'dc-authp dc-wqr';
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-labelledby', 'dcWqrTitle');
        wrap.innerHTML = '<div class="dc-authp-card dc-wqr-card" id="dcWqrBox">' +
            '<h4 id="dcWqrTitle">📱 ' + esc(ct('coupons.wqr.title', 'Coupon wallet on the phone')) + '</h4>' +
            '<p class="dc-hint">' + esc(ct('coupons.wqr.hint',
                'Ask the patient to scan this with the phone camera. They can browse their coupons only — nothing can be used, added or removed from the phone.')) + '</p>' +
            '<div class="dc-wqr-code" id="dcWqrCode" aria-live="polite"><span class="dc-hint">' + esc(ct('coupons.wqr.making', 'Making the QR code…')) + '</span></div>' +
            '<p class="dc-err" id="dcWqrErr" hidden></p>' +
            '<p class="dc-banner dc-banner-warn dc-wqr-local" id="dcWqrLocal" hidden>' + esc(ct('coupons.wqr.local',
                'This address only works on this computer. Set the public address in Phone scan first, or the phone cannot open it.')) + '</p>' +
            '<label class="dc-authp-field"><span>' + esc(ct('coupons.wqr.link', 'Wallet link')) + '</span>' +
            '<input type="text" id="dcWqrLink" readonly spellcheck="false"></label>' +
            '<div class="dc-actions dc-wqr-actions">' +
            '<button type="button" class="dc-clear" data-act="reset" id="dcWqrReset">' + esc(ct('coupons.wqr.reset', 'New QR code')) + '</button>' +
            '<button type="button" class="dc-clear" data-act="copy" id="dcWqrCopy">' + esc(ct('coupons.wqr.copy', 'Copy link')) + '</button>' +
            '<button type="button" class="dc-apply" data-act="close">' + esc(ct('common.close', 'Close')) + '</button>' +
            '</div>' +
            '<p class="dc-hint dc-wqr-note">' + esc(ct('coupons.wqr.resetNote', 'New QR code stops the old one from working (for example if the patient lost the phone).')) + '</p>' +
            '</div>';
        sheet.appendChild(wrap);
        var codeEl = wrap.querySelector('#dcWqrCode');
        var linkEl = wrap.querySelector('#dcWqrLink');
        var errEl = wrap.querySelector('#dcWqrErr');
        var resetBtn = wrap.querySelector('#dcWqrReset');
        var copyBtn = wrap.querySelector('#dcWqrCopy');
        var closed = false;
        function close() {
            if (closed) return;
            closed = true;
            if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
            if (back && document.body.contains(back)) { try { back.focus({ preventScroll: true }); } catch (e) {} }
        }
        wrap.__dcCancel = close;
        function fail(reason) {
            codeEl.innerHTML = '';
            errEl.hidden = false;
            errEl.textContent = reason === 'no_sql'
                ? ct('coupons.wqr.noSql', 'The phone wallet is not set up yet. Run discount_coupon_wallet.sql in Supabase first.')
                : reason === 'no_db' ? grantReason('no_db')
                : ct('coupons.wqr.fail', 'Could not make the wallet link. Try again.');
        }
        function show(reset) {
            errEl.hidden = true;
            resetBtn.disabled = true;
            codeEl.innerHTML = '<span class="dc-hint">' + esc(ct('coupons.wqr.making', 'Making the QR code…')) + '</span>';
            return walletLinkToken(patientId, reset).then(function (res) {
                resetBtn.disabled = false;
                if (closed) return;
                if (!res || !res.ok || !res.token) { fail(res && res.reason); return; }
                var url = walletUrl(res.token);
                linkEl.value = url;
                wrap.querySelector('#dcWqrLocal').hidden = !isLocalAddress(url);
                codeEl.setAttribute('data-url', url);
                return loadQrLib().then(function (QR) {
                    if (closed) return;
                    codeEl.innerHTML = '';
                    new QR(codeEl, { text: url, width: 220, height: 220, colorDark: '#0f172a', colorLight: '#ffffff', correctLevel: QR.CorrectLevel.M });
                }).catch(function () {
                    codeEl.innerHTML = '<span class="dc-hint">' + esc(ct('coupons.wqr.qrFail', 'The QR code could not be drawn. Copy the link instead.')) + '</span>';
                });
            });
        }
        wrap.querySelector('[data-act="close"]').onclick = close;
        resetBtn.onclick = function () {
            if (!window.confirm(ct('coupons.wqr.resetAsk', 'Make a new QR code? The old one will stop working.'))) return;
            show(true);
        };
        copyBtn.onclick = function () {
            var v = linkEl.value;
            if (!v) return;
            var done = function () { copyBtn.textContent = ct('coupons.wqr.copied', 'Copied'); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(v).then(done, function () { linkEl.select(); });
            else { linkEl.select(); try { document.execCommand('copy'); done(); } catch (e) {} }
        };
        try { wrap.querySelector('[data-act="close"]').focus({ preventScroll: true }); } catch (e) {}
        wrap.__dcShown = show(false);
        return wrap;
    }

    var _lastSheet = null;

    function paintSheet(bill, wallet, clinicCode, opts) {
        opts = opts || {};
        _lastSheet = [bill, wallet, clinicCode, opts];
        var allowApply = opts.allowApply !== false;
        var catalog = (typeof treatmentItemsCache !== 'undefined' && treatmentItemsCache) ? treatmentItemsCache : [];
        var lines = parseItems(bill);
        var eligible = eligibleBeforeCoupon(bill);
        var today = todayIso();
        var usable = [];
        var blocked = [];
        var onThisBill = [];
        (wallet || []).forEach(function (c) {
            var mine = c.status === 'used' && c.bill_id && bill.id && String(c.bill_id) === String(bill.id);
            if (c.status !== 'unused' && !mine) return;
            var coupon = walletCoupon(c);
            if (mine) {
                coupon.status = 'unused';
                onThisBill.push(String(c.id));
            }
            var a = assessCoupon({
                coupon: coupon, lines: lines, catalog: catalog,
                eligibleCents: eligible, billId: bill.id, patientId: bill.patient_id, today: today
            });
            var row = { coupon: coupon, assess: a };
            if (a.ok) usable.push(row);
            else blocked.push(row);
        });
        usable.sort(function (a, b) { return b.assess.saveCents - a.assess.saveCents; });
        var ctxOpts = {
            lines: lines, catalog: catalog, eligibleCents: eligible,
            billId: bill.id, patientId: bill.patient_id, today: today
        };
        var best = bestCombination(usable.map(function (r) { return r.coupon; }), ctxOpts);
        var bestIds = {};
        best.rows.forEach(function (r) { bestIds[String(r.coupon.id)] = true; });
        var rulesNow = cashRules();
        var picked = { items: '', bill: '', cash: [] };
        var startFrom = onThisBill.length ? onThisBill : Object.keys(bestIds);
        startFrom.forEach(function (id) {
            usable.forEach(function (r) {
                if (String(r.coupon.id) !== String(id)) return;
                if (isCashCoupon(r.coupon)) {
                    if (!picked.bill && !cashCountFull(picked.cash.length, rulesNow)) picked.cash.push(String(id));
                } else if (couponSlot(r.coupon) === 'items') {
                    picked.items = String(id);
                } else if (!picked.cash.length) {
                    picked.bill = String(id);
                }
            });
        });
        var focusId = picked.bill || picked.cash[0] || picked.items || (blocked[0] ? String(blocked[0].coupon.id) : '');
        var pickNotice = '';
        var transferable = usable.concat(blocked).filter(function (r) {
            var c = r.coupon;
            return onThisBill.indexOf(String(c.id)) < 0 && isLive(c, today) && !LOCKED_TRANSFER_KEYS[c.campaign_key];
        });
        var tab = opts.tab || (opts.focusGift ? 'gift' : 'use');
        if (tab !== 'gift' && tab !== 'transfer') tab = 'use';
        function hiddenUnless(on) { return on ? '' : ' hidden'; }
        var host = ensureSheet();
        var html = '<div class="dc-sheet" role="dialog" aria-modal="true" aria-labelledby="dcSheetTitle">';
        html += '<div class="dc-sheet-head">' +
            '<h3 id="dcSheetTitle">' + esc(ct('coupons.bill.title', '優惠券')) + '</h3>' +
            '<button type="button" class="dc-x" id="dcSheetClose" aria-label="' + esc(ct('common.close', 'Close')) + '">×</button>' +
            '<div class="dc-wsum-row">' + walletSummaryHtml(wallet, today) +
            (bill.patient_id ? '<button type="button" class="dc-wqr-btn" id="dcWalletQrBtn" data-no-click-guard="1">📱 ' +
                esc(ct('coupons.wqr.btn', 'Wallet QR')) + '</button>' : '') + '</div>' +
            '<div class="dc-stabs" role="tablist">';
        [
            ['use', ct('coupons.tab.use', 'Use'), usable.length],
            ['gift', ct('coupons.tab.gift', 'Gift'), null],
            ['transfer', ct('coupons.tab.transfer', 'Transfer'), null]
        ].forEach(function (t) {
            html += '<button type="button" role="tab" class="dc-stab' + (t[0] === tab ? ' is-on' : '') + '" data-tab="' + t[0] +
                '" id="dcTab-' + t[0] + '" aria-controls="dcPanel-' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' +
                esc(t[1]) + (t[2] != null ? ' <span class="dc-stab-n">' + t[2] + '</span>' : '') + '</button>';
        });
        html += '</div></div>';
        html += '<div class="dc-sheet-body">';

        html += '<section class="dc-spanel" id="dcPanel-use" role="tabpanel" aria-labelledby="dcTab-use" data-panel="use"' +
            hiddenUnless(tab === 'use') + '>';
        html += '<div class="dc-chips"><button type="button" class="dc-chip is-on" data-filter="all">' +
            esc(ct('coupons.chip.all', 'All')) + '</button>' +
            '<button type="button" class="dc-chip" data-filter="bill">' + esc(ct('coupons.chip.bill', 'Whole bill')) + '</button>' +
            '<button type="button" class="dc-chip" data-filter="free_line">' + esc(ct('coupons.chip.free', 'Free treatment')) + '</button>' +
            '<button type="button" class="dc-chip" data-filter="items">' + esc(ct('coupons.chip.items', 'Implant / ortho')) + '</button></div>';
        html += '<p class="dc-hint">' + esc(ct('coupons.bill.rule',
            'One bill-wide coupon (cash, spend, new chart, referral) and one treatment coupon can be used together. Tap a card to choose or unchoose it.')) + '</p>';
        html += rulesNoteHtml();
        html += '<div class="dc-cards">';
        if (!usable.length && !blocked.length) {
            html += '<p class="dc-empty">' + esc(ct('coupons.bill.empty', 'This patient has no unused coupons.')) + '</p>';
        }
        usable.forEach(function (row) {
            html += cardHtml(row, !!bestIds[String(row.coupon.id)], false, today);
        });
        blocked.forEach(function (row) { html += cardHtml(row, false, true, today); });
        html += '</div>';
        html += '<p class="dc-why" id="dcWhy" hidden></p>';
        html += '</section>';

        var giftChoices = campaigns().filter(function (c) {
            return c && c.trigger === 'manual' && c.enabled && !AUTO_GRANT_KEYS[c.key];
        });
        var lockNote = '<p class="dc-lock-note">🔒 ' + esc(ct('coupons.auth.needed',
            'Asks for your own login and password, then records it in the coupon log.')) + '</p>';
        html += '<section class="dc-spanel" id="dcPanel-gift" role="tabpanel" aria-labelledby="dcTab-gift" data-panel="gift"' +
            hiddenUnless(tab === 'gift') + '>';
        html += '<div class="dc-gift" id="dcGiftBox">' +
            '<label>' + esc(ct('coupons.grant.title', 'Gift a coupon into this wallet')) + '</label>' +
            '<p class="dc-hint">' + esc(ct('coupons.grant.hint', 'Cash and treatment coupons that are switched on. The coupon is stored unused and does not reduce this bill until someone chooses it later.')) + '</p>';
        if (!giftChoices.length) {
            html += '<p class="dc-hint">' + esc(ct('coupons.grant.none', 'Turn a cash or treatment coupon on in Configuration before gifting.')) + '</p>';
        } else {
            html += '<div class="dc-gift-row"><select id="dcGiftKind">';
            giftChoices.forEach(function (c) {
                html += '<option value="' + esc(c.key) + '">' + esc(campLabel(c)) + '</option>';
            });
            html += '</select><input type="number" id="dcGiftAmount" min="1" max="200" step="1" value="100">' +
                '<button type="button" id="dcGiftGo">🔒 ' + esc(ct('coupons.grant.go', 'Gift to wallet')) + '</button></div>' +
                '<p id="dcGiftOffer" class="dc-hint"></p>';
        }
        html += '<p id="dcGiftErr" class="dc-err" hidden></p>' + lockNote + '</div>';
        html += '</section>';

        var xferDefault = '';
        transferable.forEach(function (r) { if (String(r.coupon.id) === focusId) xferDefault = focusId; });
        if (!xferDefault && transferable[0]) xferDefault = String(transferable[0].coupon.id);
        html += '<section class="dc-spanel" id="dcPanel-transfer" role="tabpanel" aria-labelledby="dcTab-transfer" data-panel="transfer"' +
            hiddenUnless(tab === 'transfer') + '>';
        html += '<div class="dc-transfer">' +
            '<label for="dcXferPick">' + esc(ct('coupons.xfer.which', 'Coupon to transfer')) + '</label>';
        if (!transferable.length) {
            html += '<p class="dc-hint">' + esc(ct('coupons.xfer.noneMovable',
                'No coupon here can be transferred. Coupons on this bill, expired coupons, and new-chart or referral coupons stay with this patient.')) + '</p>';
        }
        html += '<select id="dcXferPick"' + (transferable.length ? '' : ' disabled') + '>';
        transferable.forEach(function (r) {
            var c = r.coupon;
            var id = String(c.id);
            html += '<option value="' + esc(id) + '"' + (id === xferDefault ? ' selected' : '') + '>' +
                esc(campLabel(c) + ' · ' + faceText(c) + (c.expires_on ? ' · ' + c.expires_on : '')) + '</option>';
        });
        html += '</select>' +
            '<label for="dcXferTo">' + esc(ct('coupons.xfer.toChart', 'To chart no.')) + '</label>' +
            '<div class="dc-xfer-row"><input type="text" id="dcXferTo" autocomplete="off">' +
            '<button type="button" id="dcXferGo"' + (transferable.length ? '' : ' disabled') + '>🔒 ' +
            esc(ct('coupons.xfer.go', 'Transfer')) + '</button></div>' +
            '<p id="dcXferErr" class="dc-err" hidden></p>' + lockNote + '</div>';
        html += '</section>';
        html += '</div>';

        html += '<div class="dc-sheet-foot" data-panel="use"' + hiddenUnless(tab === 'use') + '>' +
            '<div class="dc-preview" id="dcPreview" aria-live="polite"></div>';
        if (allowApply) {
            html += '<div class="dc-actions">' +
                '<button type="button" id="dcClear" class="dc-clear">' + esc(ct('coupons.bill.clear', '不使用優惠券')) + '</button>' +
                '<button type="button" id="dcApply" class="dc-apply">' + esc(ct('coupons.bill.apply', 'Apply')) + '</button></div>';
        } else {
            html += '<p class="dc-hint">' + esc(ct('coupons.grant.paid', 'This bill is already paid. A gifted coupon stays in the wallet for a later bill.')) + '</p>';
        }
        html += '</div></div>';
        host.innerHTML = html;
        showSheet(host);
        function setTab(name) {
            tab = name;
            opts.tab = name;
            var pick = document.getElementById('dcXferPick');
            if (name === 'transfer' && pick && focusId) {
                Array.prototype.forEach.call(pick.options, function (o) { if (o.value === String(focusId)) pick.value = o.value; });
            }
            host.querySelectorAll('.dc-stab').forEach(function (b) {
                var on = b.getAttribute('data-tab') === name;
                b.classList.toggle('is-on', on);
                b.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            host.querySelectorAll('[data-panel]').forEach(function (p) {
                var key = p.getAttribute('data-panel');
                if (key === name) p.removeAttribute('hidden');
                else p.setAttribute('hidden', '');
            });
        }
        function focusTab(name) {
            var el = name === 'gift' ? document.getElementById('dcGiftKind') : name === 'transfer' ? document.getElementById('dcXferTo') : null;
            if (el && !el.disabled) { try { el.focus({ preventScroll: true }); } catch (e) {} }
        }
        var qrBtn = host.querySelector('#dcWalletQrBtn');
        if (qrBtn) qrBtn.addEventListener('click', function () { openWalletQr(host, bill.patient_id); });
        host.querySelectorAll('.dc-stab').forEach(function (b) {
            b.addEventListener('click', function (e) {
                var name = b.getAttribute('data-tab');
                setTab(name);
                if (e.detail > 0) focusTab(name);
            });
            b.addEventListener('keydown', function (e) {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                var tabs = Array.prototype.slice.call(host.querySelectorAll('.dc-stab'));
                var i = tabs.indexOf(b) + (e.key === 'ArrowRight' ? 1 : -1);
                var nextTab = tabs[(i + tabs.length) % tabs.length];
                e.preventDefault();
                nextTab.focus();
                setTab(nextTab.getAttribute('data-tab'));
            });
        });
        function rowById(id) {
            var found = null;
            usable.concat(blocked).forEach(function (r) { if (String(r.coupon.id) === String(id)) found = r; });
            return found;
        }
        function comboFor(p) {
            var list = [];
            if (p.items) list.push(rowById(p.items).coupon);
            if (p.bill) list.push(rowById(p.bill).coupon);
            p.cash.forEach(function (id) { list.push(rowById(id).coupon); });
            return combineCoupons(Object.assign({}, ctxOpts, { coupons: list }));
        }
        function currentCombo() { return comboFor(picked); }
        function isPicked(id) {
            return id === picked.items || id === picked.bill || picked.cash.indexOf(id) >= 0;
        }
        function refreshPreview() {
            var combo = currentCombo();
            host.querySelectorAll('.dc-card').forEach(function (el) {
                var id = el.getAttribute('data-id');
                var on = isPicked(id);
                el.classList.toggle('is-picked', on);
                el.classList.toggle('is-focus', id === focusId);
                el.setAttribute('aria-pressed', on ? 'true' : 'false');
                var save = el.querySelector('.dc-save');
                combo.rows.forEach(function (r) {
                    if (!save || String(r.coupon.id) !== id) return;
                    save.textContent = '−' + r.assess.save.toFixed(2) +
                        (r.assess.lostCents > 0 ? ' · ' + ct('coupons.cash.lostShort', 'HK$') + money(r.assess.lostCents).toFixed(0) + ' ' +
                            ct('coupons.cash.lost', 'lost') : '');
                });
            });
            var el = document.getElementById('dcPreview');
            if (el) {
                if (!combo.rows.length) {
                    el.innerHTML = '<span class="dc-pv-label">' + esc(ct('coupons.bill.totalStays', 'Total stays')) + '</span> ' +
                        '<strong class="dc-pv-total">' + eligible.toFixed(2) + '</strong>';
                } else {
                    var parts = combo.rows.map(function (r) {
                        return '− ' + r.assess.save.toFixed(2) + ' (' + campLabel(r.coupon) + ')';
                    });
                    if (combo.capHit && combo.capCents != null) {
                        parts.push('· ' + ct('coupons.cash.capReached', 'Cash limit reached') + ' HK$' + money(combo.capCents).toFixed(2));
                    }
                    if (combo.lostCents > 0) {
                        parts.push('· HK$' + combo.lost.toFixed(2) + ' ' + ct('coupons.cash.lostLong', 'of coupon value is lost (no change given)'));
                    }
                    var next = Math.max(0, round2(eligible - combo.save));
                    el.innerHTML = '<span class="dc-pv-line"><s class="dc-pv-from">' + eligible.toFixed(2) + '</s>' +
                        '<span class="dc-pv-arrow" aria-hidden="true">→</span>' +
                        '<strong class="dc-pv-total">' + next.toFixed(2) + '</strong>' +
                        '<span class="dc-pv-save">' + esc(ct('coupons.bill.saving', 'Saving')) + ' HK$' + combo.save.toFixed(2) + '</span></span>' +
                        '<small class="dc-pv-parts">' + esc(parts.join('  ')) + '</small>';
                }
            }
            var why = document.getElementById('dcWhy');
            var focusRow = rowById(focusId);
            if (why) {
                if (pickNotice) {
                    why.hidden = false;
                    why.textContent = pickNotice;
                } else if (focusRow && !focusRow.assess.ok) {
                    why.hidden = false;
                    why.textContent = campLabel(focusRow.coupon) + ': ' + reasonLong(focusRow.assess, focusRow.coupon);
                } else {
                    why.hidden = true;
                    why.textContent = '';
                }
            }
            var applyEl = document.getElementById('dcApply');
            if (applyEl) applyEl.disabled = !combo.rows.length;
        }
        host.querySelectorAll('.dc-card').forEach(function (card) {
            card.addEventListener('click', function () {
                var id = card.getAttribute('data-id');
                focusId = id;
                pickNotice = '';
                var row = rowById(id);
                if (card.getAttribute('data-ok') === '1' && row) {
                    if (isCashCoupon(row.coupon)) {
                        var at = picked.cash.indexOf(id);
                        if (at >= 0) {
                            picked.cash.splice(at, 1);
                        } else {
                            var trial = { items: picked.items, bill: '', cash: picked.cash.concat([id]) };
                            var tc = comboFor(trial);
                            var skip = tc.skipped.filter(function (s) { return String(s.coupon.id) === id; })[0];
                            if (skip) {
                                pickNotice = cashSkipText(skip.reason, tc.rules);
                            } else {
                                picked.bill = '';
                                picked.cash = trial.cash;
                            }
                        }
                    } else if (card.getAttribute('data-slot') === 'items') {
                        picked.items = picked.items === id ? '' : id;
                    } else {
                        picked.bill = picked.bill === id ? '' : id;
                        if (picked.bill) picked.cash = [];
                    }
                }
                refreshPreview();
            });
        });
        host.querySelectorAll('.dc-chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                host.querySelectorAll('.dc-chip').forEach(function (c) { c.classList.toggle('is-on', c === chip); });
                var f = chip.getAttribute('data-filter');
                host.querySelectorAll('.dc-card').forEach(function (card) {
                    var mode = card.getAttribute('data-mode');
                    var scope = card.getAttribute('data-scope');
                    var show = f === 'all' || mode === f || (f === 'items' && scope === 'items' && mode !== 'free_line') ||
                        (f === 'bill' && scope === 'bill');
                    card.style.display = show ? '' : 'none';
                });
            });
        });
        var applyBtn = document.getElementById('dcApply');
        if (applyBtn) applyBtn.onclick = function () {
            var combo = currentCombo();
            if (!combo.rows.length) return;
            applyBtn.disabled = true;
            applyToBill(bill, combo, clinicCode).then(function () { closeSheet(); });
        };
        var clearBtn = document.getElementById('dcClear');
        if (clearBtn) clearBtn.onclick = function () {
            clearBillCoupon(bill).then(function () { closeSheet(); });
        };
        var giftGo = document.getElementById('dcGiftGo');
        var giftKind = document.getElementById('dcGiftKind');
        function syncGiftOffer() {
            if (!giftKind) return;
            var camp = campaignByKey(giftKind.value);
            var amountInput = document.getElementById('dcGiftAmount');
            var offer = document.getElementById('dcGiftOffer');
            var cash = !!(camp && camp.key === 'cash');
            if (amountInput) amountInput.hidden = !cash;
            if (offer) offer.textContent = camp ? giftOfferText(camp) : '';
        }
        if (giftKind) giftKind.onchange = syncGiftOffer;
        syncGiftOffer();
        var patientLabel = bill.patient_no || ct('coupons.auth.thisPatient', 'this patient');
        function loggedText(grantor, logged) {
            if (logged === false) return ' ⚠️ ' + ct('coupons.notice.logFail', 'The coupon log entry could not be saved — tell the admin.');
            return ' ' + ct('coupons.notice.loggedUnder', 'Logged under') + ' ' + (grantorName(grantor) || '—') + '.';
        }
        if (giftGo) giftGo.onclick = function () {
            var err = document.getElementById('dcGiftErr');
            if (err) { err.hidden = true; err.textContent = ''; }
            var kind = giftKind ? giftKind.value : '';
            var amt = (document.getElementById('dcGiftAmount') || {}).value;
            var camp = campaignByKey(kind) || {};
            var isCash = camp.key === 'cash';
            if (isCash && !((parseFloat(amt) || 0) >= 1 && (parseFloat(amt) || 0) <= CASH_GRANT_MAX)) {
                if (err) { err.hidden = false; err.textContent = grantReason('amount'); }
                return;
            }
            var what = (campLabel(camp.key ? camp : null) || kind) + (isCash ? ' HK$' + round2(amt).toFixed(0) : '') +
                ' → ' + patientLabel;
            var grantor = null;
            giftGo.disabled = true;
            promptGrantor(host, ct('coupons.auth.giftTitle', 'Confirm gift'), what).then(function (user) {
                if (!user) return null;
                grantor = user;
                return grantToWallet(bill.patient_id, kind, amt, bill.patient_no, grantor);
            }).catch(function (e) {
                return { ok: false, error: String(e && e.message || e) };
            }).then(function (res) {
                giftGo.disabled = false;
                if (res === null) return;
                if (!res || !res.ok) {
                    if (err) {
                        err.hidden = false;
                        err.textContent = grantReason((res && (res.reason || res.error)) || '');
                    }
                    return;
                }
                couponNotice('🎁 ' + what + ' — ' + ct('coupons.notice.giftedOk', 'added to the wallet.') + loggedText(grantor, res.logged));
                openBillSheet(bill, { gift: true });
            });
        };
        if (tab !== 'use') focusTab(tab);
        document.getElementById('dcXferGo').onclick = function () {
            var err = document.getElementById('dcXferErr');
            var pickEl = document.getElementById('dcXferPick');
            var pickRow = pickEl && pickEl.value ? rowById(pickEl.value) : null;
            var chosen = pickRow ? pickRow.coupon : null;
            if (chosen && onThisBill.indexOf(String(chosen.id)) >= 0) {
                if (err) {
                    err.hidden = false;
                    err.textContent = ct('coupons.xfer.onBill', 'Take this coupon off the bill before transferring it');
                }
                return;
            }
            function showErr(msg) {
                if (!err) return;
                err.hidden = false;
                err.textContent = msg || '';
            }
            if (!chosen) { showErr(ct('coupons.xfer.pick', 'Select a coupon first')); return; }
            var chart = String((document.getElementById('dcXferTo') || {}).value || '').trim();
            if (!chart) { showErr(ct('coupons.xfer.need', 'Enter a chart number')); return; }
            if (err) { err.hidden = true; err.textContent = ''; }
            var xferBtn = document.getElementById('dcXferGo');
            if (xferBtn) xferBtn.disabled = true;
            function done(msg) {
                if (xferBtn) xferBtn.disabled = false;
                if (msg) showErr(msg);
            }
            resolveReferrer(chart).then(function (to) {
                if (!to) { done(ct('coupons.xfer.missing', 'Chart not found')); return null; }
                if (String(to.id) === String(bill.patient_id)) { done(grantReason('same_patient')); return null; }
                var what = campLabel(chosen) + ' ' + faceText(chosen) + (chosen.code ? ' (' + chosen.code + ')' : '') +
                    ' · ' + patientLabel + ' → ' + (to.patient_no || chart);
                return promptGrantor(host, ct('coupons.auth.xferTitle', 'Confirm transfer'), what).then(function (user) {
                    if (!user) { done(''); return null; }
                    var raw = (wallet || []).filter(function (c) { return String(c.id) === String(chosen.id); })[0] || chosen;
                    return transferSelected(raw, to, bill.patient_no, user).then(function (res) {
                        if (!res || !res.ok) {
                            done(res && res.reason ? grantReason(res.reason) : ((res && res.error) || 'Transfer failed'));
                            return null;
                        }
                        done('');
                        closeSheet();
                        couponNotice('↔ ' + what + loggedText(user, res.logged));
                        openBillSheet(bill, { gift: (parseFloat(bill.amount_paid) || 0) > 0.005, tab: 'transfer' });
                        return null;
                    });
                });
            }).catch(function (e) { done(String(e && e.message || e)); });
        };
        refreshPreview();
    }

    function walletCoupon(c) {
        var camp = campaignByKey(c.campaign_key) || {};
        return {
            id: c.id,
            code: c.code,
            campaign_key: c.campaign_key,
            name: camp.name,
            nameZh: camp.nameZh || c.campaign_key,
            scope: camp.scope || (ITEM_GROUPS[c.campaign_key] ? 'items' : 'bill'),
            mode: c.discount_mode || camp.mode,
            face: c.face_value,
            percent: c.percent,
            minSpend: c.min_spend,
            maxDiscount: c.max_discount,
            itemNames: c.item_names || camp.itemNames,
            status: c.status,
            expires_on: c.expires_on,
            origin_bill_id: c.origin_bill_id,
            patient_id: c.patient_id
        };
    }

    var KIND_LABELS = {
        cash: ['coupons.kind.cash', 'Cash'],
        spend: ['coupons.kind.spend', 'Spend reward'],
        welcome: ['coupons.kind.welcome', 'Welcome'],
        referral: ['coupons.kind.referral', 'Referral'],
        free: ['coupons.kind.free', 'Free treatment'],
        treat: ['coupons.kind.treat', 'Treatment']
    };

    function kindOf(c) {
        var key = String((c && (c.campaign_key || c.key)) || '');
        if (key === 'cash') return 'cash';
        if (key === 'new_chart') return 'welcome';
        if (key === 'referral') return 'referral';
        if (key.indexOf('spend') === 0 || (c && c.trigger === 'target_spend')) return 'spend';
        if (c && (c.mode || c.discount_mode) === 'free_line') return 'free';
        return 'treat';
    }

    function kindLabel(kind) {
        var k = KIND_LABELS[kind] || KIND_LABELS.treat;
        return ct(k[0], k[1]);
    }

    function faceText(c) {
        var mode = c.mode || c.discount_mode;
        if (mode === 'free_line') return ct('coupons.face.free', 'FREE');
        if (mode === 'percent') return round2(parseFloat(c.percent) || 0) + '%';
        var face = c.face != null ? c.face : c.face_value;
        return 'HK$' + round2(parseFloat(face) || 0).toFixed(0);
    }

    function faceSub(c) {
        var mode = c.mode || c.discount_mode;
        var cap = parseFloat(c.maxDiscount != null ? c.maxDiscount : c.max_discount) || 0;
        if (mode === 'percent' && cap > 0) return ct('coupons.face.max', 'up to') + ' HK$' + round2(cap).toFixed(0);
        return '';
    }

    function daysUntil(iso, today) {
        var a = Date.parse(String(today || todayIso()) + 'T00:00:00Z');
        var b = Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z');
        if (isNaN(a) || isNaN(b)) return null;
        return Math.round((b - a) / 86400000);
    }

    function expiryChipHtml(iso, today) {
        if (!iso) return '';
        var d = daysUntil(iso, today);
        if (d == null) return '';
        var cls = 'dc-exp';
        var text;
        if (d < 0) { cls += ' dc-exp-gone'; text = ct('coupons.reason.expired', '已過期'); }
        else if (d === 0) { cls += ' dc-exp-red'; text = ct('coupons.exp.today', 'Last day today'); }
        else if (d <= 7) { cls += ' dc-exp-red'; text = d + ' ' + ct('coupons.exp.daysLeft', 'days left'); }
        else if (d <= 14) { cls += ' dc-exp-amber'; text = d + ' ' + ct('coupons.exp.daysLeft', 'days left'); }
        else { text = ct('coupons.exp.until', 'Valid until') + ' ' + String(iso).slice(0, 10); }
        return '<span class="' + cls + '" title="' + esc(String(iso).slice(0, 10)) + '">' + esc(text) + '</span>';
    }

    function stubHtml(c) {
        var sub = faceSub(c);
        var face = faceText(c);
        return '<span class="dc-stub"><span class="dc-stub-face' + (face.length > 6 ? ' is-long' : '') + '">' + esc(face) + '</span>' +
            (sub ? '<span class="dc-stub-sub">' + esc(sub) + '</span>' : '') +
            '<span class="dc-stub-kind">' + esc(kindLabel(kindOf(c))) + '</span></span>';
    }

    function walletSummaryHtml(wallet, today) {
        var live = (wallet || []).filter(function (c) { return isLive(c, today); });
        if (!live.length) {
            return '<div class="dc-wsum is-empty">' + esc(ct('coupons.sum.none', 'No unused coupons in this wallet')) + '</div>';
        }
        var value = 0;
        var next = '';
        live.forEach(function (c) {
            if ((c.discount_mode || 'amount') === 'amount') value += cents(c.face_value);
            if (c.expires_on && (!next || String(c.expires_on) < next)) next = String(c.expires_on).slice(0, 10);
        });
        var html = '<div class="dc-wsum"><span class="dc-wsum-item"><b>' + live.length + '</b> ' +
            esc(ct('coupons.sum.coupons', 'coupons')) + '</span>';
        if (value > 0) {
            html += '<span class="dc-wsum-item"><b>HK$' + money(value).toFixed(0) + '</b> ' +
                esc(ct('coupons.sum.value', 'cash value')) + '</span>';
        }
        if (next) html += '<span class="dc-wsum-item">' + esc(ct('coupons.sum.next', 'next expiry')) + ' ' + expiryChipHtml(next, today) + '</span>';
        return html + '</div>';
    }

    function cardHtml(row, best, blocked, today) {
        var c = row.coupon;
        var reason = reasonText(row.assess);
        var slot = couponSlot(c);
        return '<button type="button" data-no-click-guard="1" class="dc-card dc-ticket' + (blocked ? ' is-blocked' : '') +
            '" data-kind="' + kindOf(c) + '" data-id="' + esc(c.id) + '" data-ok="' + (row.assess.ok ? '1' : '0') +
            '" data-slot="' + slot + '" data-mode="' + esc(c.mode) + '" data-scope="' + esc(c.scope) + '" aria-pressed="false">' +
            stubHtml(c) +
            '<span class="dc-body">' +
            '<strong>' + esc(campLabel(c)) + '</strong>' +
            '<small>' + esc(slot === 'items' ? ct('coupons.bill.slotItems', '治療券') : ct('coupons.bill.slotBill', '全單券')) +
            (c.code ? ' · ' + esc(c.code) : '') + '</small>' +
            '<span class="dc-meta">' + expiryChipHtml(c.expires_on, today) +
            (best ? '<em class="dc-best">' + esc(ct('coupons.bill.best', '最優')) + '</em>' : '') +
            '<b class="dc-picked">' + esc(ct('coupons.bill.picked', '已選')) + '</b></span>' +
            '</span>' +
            '<span class="dc-save">' + (row.assess.ok ? ('−' + row.assess.save.toFixed(2)) : esc(reason)) + '</span>' +
            '<i class="dc-check" aria-hidden="true">✓</i></button>';
    }

    function rulesNoteHtml() {
        var rules = [
            ['r1', 'Per bill: one treatment coupon plus either one whole-bill coupon (spend, new chart, referral) or any number of cash coupons (by default 50% of the bill up to HK$3,000; change it in Configuration). The treatment coupon comes off first; the rest comes off what is left.'],
            ['r2', 'Treatment coupons only cover treatment-list items ticked for that coupon. A typed line counts only if its name is exactly the same as the treatment list.'],
            ['r3', 'No change and no cash back: if a coupon is worth more than the bill, the rest is lost.'],
            ['r4', 'Spend coupons count all cash paid on the bill (not reward points, balance transfer or voided payments). A coupon earned on a bill can be used from the next bill.'],
            ['r5', 'New-chart and referral coupons stay with the patient. Other coupons can be transferred to another chart no.'],
            ['r6', 'Dr / reception / nurses can gift a cash coupon (HK$1–200) or a switched-on treatment coupon. Spend, new-chart and referral coupons are issued automatically only. Every gift and transfer is logged under your login.'],
            ['r7', 'Voiding a bill returns the coupons used on it and cancels coupons it issued. A refund after payment does not create a new coupon.'],
            ['r8', 'Expired coupons cannot be used. Patients get an SMS 7 days before expiry.']
        ];
        var holds = campaigns().filter(function (c) {
            if (!c) return false;
            if (c.trigger !== 'target_spend') return true;
            return (parseFloat(c.target) || 0) > 0 && (parseFloat(c.face) || 0) > 0;
        }).map(function (c) {
            return esc(campLabel(c)) + ' ' + holdLimitFor(c);
        });
        var html = '<details class="dc-rules"><summary>' + esc(ct('coupons.rules.title', 'Coupon rules (tap to open)')) + '</summary><ol>';
        rules.forEach(function (r) { html += '<li>' + esc(ct('coupons.rules.' + r[0], r[1])) + '</li>'; });
        html += '<li>' + esc(ct('coupons.rules.hold', 'Wallet holds up to ' + WALLET_CAP + ' unused coupons. Per type:')) +
            ' <span class="dc-rules-hold">' + holds.join(' · ') + '</span></li>';
        return html + '</ol></details>';
    }

    function reasonLong(a, coupon) {
        if (!a || a.ok) return '';
        if (a.reason === 'no_matching_item') {
            var names = (a.itemNames || (coupon && coupon.itemNames) || []).slice(0, 3).join(' / ');
            return ct('coupons.why.item', 'No treatment on this bill matches this coupon. Pick the item from the treatment list') +
                (names ? ': ' + names : '');
        }
        if (a.reason === 'no_items_ticked') return ct('coupons.why.noItems', 'No treatments are ticked for this coupon in Configuration');
        if (a.reason === 'next_bill') return ct('coupons.why.next', 'Earned from this bill, so it can be used from the next bill');
        if (a.reason === 'zero') return ct('coupons.why.zero', 'Nothing left on the bill for this coupon to take off');
        return reasonText(a);
    }

    function cashSkipText(reason, rules) {
        rules = normalizeCashRules(rules || _cashRules);
        if (reason === 'cash_count') {
            return ct('coupons.cash.tooMany', 'Cash coupons per bill') + ': ' + rules.maxCount + '. ' +
                ct('coupons.cash.untickOne', 'Untick one to use this one instead.');
        }
        if (reason === 'cash_cap') {
            return ct('coupons.cash.capReached', 'Cash limit reached') + ' (' + cashLimitText(rules) + ').';
        }
        if (reason === 'covered') return ct('coupons.cash.covered', 'The bill is already covered, so this coupon is not needed.');
        return reasonText({ ok: false, reason: reason });
    }

    /** Bill label such as "Cash coupon ×2 + Free scaling". */
    function couponLabelFor(rows) {
        var order = [];
        var count = {};
        (rows || []).forEach(function (r) {
            var label = campLabel(r.coupon);
            if (!count[label]) { count[label] = 0; order.push(label); }
            count[label]++;
        });
        return order.map(function (l) { return count[l] > 1 ? l + ' ×' + count[l] : l; }).join(' + ');
    }

    function reasonText(a) {
        if (!a || a.ok) return '';
        if (a.reason === 'no_matching_item') return ct('coupons.reason.item', 'Add the matching treatment');
        if (a.reason === 'short') return ct('coupons.reason.short', '還差') + ' $' + money(a.shortCents || 0).toFixed(2);
        if (a.reason === 'expired') return ct('coupons.reason.expired', '已過期');
        if (a.reason === 'used') return ct('coupons.reason.used', '已使用');
        if (a.reason === 'next_bill') return ct('coupons.reason.next', 'For a later bill');
        return a.reason || '';
    }

    function paintBillTotals(total, balance) {
        if (typeof g !== 'function') return;
        var t = g('bdTotal');
        var b = g('bdBalance');
        if (t && typeof fmtHK === 'function') t.textContent = fmtHK(total);
        if (b && typeof fmtHK === 'function') {
            b.textContent = fmtHK(balance);
            b.style.color = balance > 0 ? 'var(--danger)' : '#16a34a';
        }
        var banner = g('bdOutstandingBanner');
        if (banner) banner.style.display = balance > 0 ? 'block' : 'none';
        var out = g('bdOutstandingAmt');
        if (out && typeof fmtHK === 'function') out.textContent = fmtHK(balance);
        var addBtn = g('bdAddPaymentBtn');
        if (addBtn) addBtn.style.display = balance > 0 ? 'inline-block' : 'none';
    }

    function releaseCouponsOnBill(billId, keepIds) {
        if (typeof SB === 'undefined' || !SB || !billId) return Promise.resolve();
        keepIds = keepIds || [];
        return SB.from('discount_coupons').select('id').eq('bill_id', billId).eq('status', 'used')
            .then(function (r) {
                var jobs = [];
                ((r && r.data) || []).forEach(function (row) {
                    if (keepIds.indexOf(String(row.id)) >= 0) return;
                    jobs.push(SB.from('discount_coupons').update({
                        status: 'unused', bill_id: null, redeemed_amount: null, redeemed_at: null, line_name: null
                    }).eq('id', row.id));
                });
                return Promise.all(jobs);
            }, function () { return null; });
    }

    /** combo: { rows: [{ coupon, assess }], save } from combineCoupons. */
    function applyToBill(bill, combo, clinicCode) {
        var rows = (combo && combo.rows) || [];
        var save = round2(rows.reduce(function (s, r) { return s + r.assess.save; }, 0));
        var sub = parseFloat(bill.subtotal) || 0;
        var disc = parseFloat(bill.discount) || 0;
        var paid = parseFloat(bill.amount_paid) || 0;
        var total = Math.max(0, round2(sub - disc - save));
        var balance = Math.max(0, round2(total - paid));
        var status = balance <= 0.005 ? 'Paid' : (paid > 0.005 ? 'Partial' : (bill.status || 'Pending'));
        var ids = rows.map(function (r) { return String(r.coupon.id); });
        var lead = rows.filter(function (r) { return couponSlot(r.coupon) === 'bill'; })[0] || rows[0];
        bill.coupon_id = lead ? lead.coupon.id : null;
        bill.coupon_amount = save;
        bill.coupon_label = couponLabelFor(rows);
        bill.total = total;
        bill.balance = balance;
        bill.status = status;
        var payload = {
            coupon_id: bill.coupon_id,
            coupon_amount: save,
            total: total,
            balance: balance,
            status: status
        };
        var chain = Promise.resolve();
        if (typeof SB !== 'undefined' && SB && bill.id) {
            chain = SB.from('bills').update(payload).eq('id', bill.id).then(function (r) {
                if (r && r.error && /coupon_/.test(String(r.error.message || ''))) {
                    return SB.from('bills').update({ total: total, balance: balance, status: status }).eq('id', bill.id);
                }
                return r;
            }).then(function () {
                return releaseCouponsOnBill(bill.id, ids);
            }).then(function () {
                var now = new Date().toISOString();
                return Promise.all(rows.map(function (r) {
                    return SB.from('discount_coupons').update({
                        status: 'used',
                        bill_id: bill.id,
                        redeemed_amount: r.assess.save,
                        redeemed_at: now,
                        line_name: r.assess.lineName || null
                    }).eq('id', r.coupon.id);
                }));
            });
        }
        return chain.then(function () {
            syncBillDetail(bill);
            paintBillTotals(total, balance);
        });
    }

    function clearBillCoupon(bill) {
        var sub = parseFloat(bill.subtotal) || 0;
        var disc = parseFloat(bill.discount) || 0;
        var paid = parseFloat(bill.amount_paid) || 0;
        var total = Math.max(0, round2(sub - disc));
        var balance = Math.max(0, round2(total - paid));
        var prev = bill.coupon_id;
        bill.coupon_id = null;
        bill.coupon_amount = 0;
        bill.coupon_label = '';
        bill.total = total;
        bill.balance = balance;
        var chain = Promise.resolve();
        if (typeof SB !== 'undefined' && SB && bill.id) {
            chain = SB.from('bills').update({
                coupon_id: null,
                coupon_amount: 0,
                total: total,
                balance: balance
            }).eq('id', bill.id).then(function () {
                if (paid > 0.005) return null;
                return releaseCouponsOnBill(bill.id, []).then(function () {
                    if (!prev) return null;
                    return SB.from('discount_coupons').update({
                        status: 'unused', bill_id: null, redeemed_amount: null, redeemed_at: null, line_name: null
                    }).eq('id', prev).eq('status', 'used');
                });
            });
        }
        return chain.then(function () {
            syncBillDetail(bill);
            paintBillTotals(total, balance);
        });
    }

    function issueRecord(campaign, patientId, extra) {
        extra = extra || {};
        var days = parseInt(campaign.expiryDays, 10) || 90;
        var exp = new Date();
        exp.setDate(exp.getDate() + days);
        return {
            code: 'DC-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
            campaign_key: campaign.key,
            patient_id: patientId,
            face_value: extra.face != null ? extra.face : (campaign.face || 0),
            discount_mode: campaign.mode,
            percent: campaign.percent || 0,
            min_spend: campaign.minSpend || 0,
            max_discount: campaign.maxDiscount || 0,
            status: 'unused',
            expires_on: exp.toISOString().slice(0, 10),
            clinic_code: extra.clinicCode || null,
            origin_bill_id: extra.originBillId || null,
            item_names: campaign.scope === 'items' ? campaign.itemNames : null,
            issued_by: extra.issuedBy || null,
            note: extra.note || null
        };
    }

    function insertCoupon(row, sms) {
        if (typeof SB === 'undefined' || !SB) return Promise.resolve({ ok: false, reason: 'no_db', row: row });
        return SB.from('discount_coupons').insert([row]).select('id,code').then(function (r) {
            if (r.error) return { ok: false, error: r.error.message, row: row };
            var saved = (r.data && r.data[0]) || {};
            if (sms && row.patient_id) {
                var issued = Object.assign({}, row, { code: saved.code || row.code });
                sendCouponSms(row.patient_id, function (wallet) {
                    return smsIssued(issued, wallet, { clinic: row.clinic_code || clinicCodeNow() });
                });
            }
            return { ok: true, id: saved.id, code: saved.code || row.code };
        }, function (e) {
            return { ok: false, error: String(e && e.message || e), row: row };
        });
    }

    /** body is the text, or a function(wallet) that builds it from the patient's coupons at send time. */
    function sendCouponSms(patientId, body) {
        if (!body || !patientId || typeof SB === 'undefined' || !SB) return Promise.resolve({ ok: false, reason: 'no_db' });
        var walletP = typeof body === 'function' ? loadWallet(patientId) : Promise.resolve(null);
        return Promise.all([
            SB.from('patients').select('phone_number,mobile_phone,full_name,chinese_name,patient_no').eq('id', patientId).maybeSingle(),
            walletP
        ])
            .then(function (both) {
                var r = both[0];
                var p = r && r.data;
                var phone = p ? String(p.phone_number || p.mobile_phone || '').trim() : '';
                if (!phone) return { ok: false, reason: 'no_phone' };
                var text = typeof body === 'function' ? body(both[1] || []) : body;
                if (!text) return { ok: false, reason: 'no_text' };
                if (typeof AIHELPER === 'undefined' || typeof AIHELPER.sendTwilioOutreach !== 'function') {
                    return { ok: false, reason: 'no_sms' };
                }
                return AIHELPER.sendTwilioOutreach({
                    channel: 'sms',
                    to: phone,
                    name: p.full_name || p.chinese_name || p.patient_no || 'Patient',
                    body: text
                });
            })
            .catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    }

    function addDaysIso(iso, n) {
        var d = new Date(iso + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    }

    /**
     * Text every unused coupon that expires within 7 days and has not been reminded.
     * Each coupon is claimed (expiry_sms_at) before sending, so two stations never both text.
     * Without the expiry_sms_at column (discount_coupons_expiry_sms.sql) nothing is sent.
     */
    function sendExpiryReminders() {
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            return Promise.resolve({ ok: false, reason: 'no_db' });
        }
        var today = todayIso();
        return loadState().then(function () {
            return SB.from('discount_coupons')
                .select('id,code,campaign_key,patient_id,expires_on,status,issued_at,clinic_code,discount_mode,face_value,percent,max_discount')
                .eq('status', 'unused')
                .is('expiry_sms_at', null)
                .gt('expires_on', today)
                .lte('expires_on', addDaysIso(today, EXPIRY_SMS_DAYS))
                .order('expires_on', { ascending: true })
                .limit(50);
        }).then(function (r) {
            if (!r || r.error) return { ok: false, reason: 'query', error: r && r.error && r.error.message };
            var rows = (r.data || []).filter(function (c) { return !c.clinic_code || clinicJoined(c.clinic_code); });
            var sent = 0;
            var seq = Promise.resolve();
            rows.forEach(function (c) {
                seq = seq.then(function () {
                    var due = Object.assign({}, c, { issued_on: String(c.issued_at || '').slice(0, 10) });
                    if (!smsExpiring(due, today)) return null;
                    var body = function (wallet) { return smsExpiring(due, today, wallet, { clinic: c.clinic_code || clinicCodeNow() }); };
                    return SB.from('discount_coupons').update({ expiry_sms_at: new Date().toISOString() })
                        .eq('id', c.id).is('expiry_sms_at', null).select('id')
                        .then(function (u) {
                            if (!u || u.error || !u.data || !u.data.length) return null;
                            return sendCouponSms(c.patient_id, body).then(function (res) {
                                if (res && res.ok) { sent++; return null; }
                                if (res && (res.reason === 'no_phone')) return null;
                                return SB.from('discount_coupons').update({ expiry_sms_at: null }).eq('id', c.id);
                            });
                        });
                });
            });
            return seq.then(function () { return { ok: true, checked: rows.length, sent: sent }; });
        }).catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    }

    /** Any logged-in station runs the reminder pass once a day. */
    function scheduleExpiryReminders() {
        if (typeof window === 'undefined' || typeof window.setInterval !== 'function') return;
        var busy = false;
        function tick() {
            if (busy) return;
            if (typeof currentUserId === 'undefined' || !currentUserId) return;
            var today = todayIso();
            try { if (window.localStorage && localStorage.getItem(EXPIRY_RUN_KEY) === today) return; } catch (e) {}
            busy = true;
            sendExpiryReminders().then(function (res) {
                busy = false;
                if (res && res.ok) {
                    try { if (window.localStorage) localStorage.setItem(EXPIRY_RUN_KEY, today); } catch (e) {}
                }
            });
        }
        setTimeout(tick, 60000);
        setInterval(tick, 30 * 60000);
    }

    /** Logged-in doctor, when the login is a doctor; otherwise the clinic's All Doctors switch decides. */
    function loginDoctorKey() {
        if (typeof getActiveDoctorContext !== 'function') return '';
        try {
            var ctx = getActiveDoctorContext();
            return ctx && ctx.shouldTag && ctx.id ? String(ctx.id) : '';
        } catch (e) { return ''; }
    }

    function billDoctorKey(billId, known) {
        if (known) return Promise.resolve(String(known));
        var open = (typeof bdCurrentBill !== 'undefined') ? bdCurrentBill : null;
        if (open && billId && String(open.id) === String(billId) && open.doctor_id) {
            return Promise.resolve(String(open.doctor_id));
        }
        if (!billId || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve('');
        return SB.from('bills').select('doctor_id').eq('id', billId).maybeSingle()
            .then(function (r) { return (r && r.data && r.data.doctor_id) ? String(r.data.doctor_id) : ''; },
                function () { return ''; });
    }

    function onPatientCreated(row, referredBy) {
        var clinicCode = '';
        if (typeof currentClinicCodeForTagging === 'function') clinicCode = currentClinicCodeForTagging() || '';
        return loadState().then(loadUsage).then(function () {
            return resolveReferrer(referredBy).then(function (ref) {
                var plans = planNewChart({
                    clinicCode: clinicCode,
                    doctorKey: loginDoctorKey(),
                    clinics: _clinics,
                    doctors: _doctors,
                    campaigns: campaigns(),
                    patientId: row && row.id,
                    referrerId: ref && ref.id,
                    wallet: [],
                    referrerWallet: []
                });
                var seq = Promise.resolve();
                plans.forEach(function (p) {
                    seq = seq.then(function () {
                        return loadWallet(p.patientId).then(function (w) {
                            var gate = canIssue(w, p.campaign);
                            if (!gate.ok) return null;
                            return insertCoupon(issueRecord(p.campaign, p.patientId, { clinicCode: clinicCode }), p.sms);
                        });
                    });
                });
                return seq;
            });
        });
    }

    function resolveReferrer(referredBy) {
        var s = String(referredBy || '').trim();
        if (!s || typeof SB === 'undefined' || !SB) return Promise.resolve(null);
        return SB.from('patients').select('id,patient_no').eq('patient_no', s).limit(1)
            .then(function (r) {
                return (r.data && r.data[0]) || null;
            }, function () { return null; });
    }

    function isNonCashMethod(method) {
        if (typeof window !== 'undefined') {
            if (typeof window.isBalanceTransferPayMethod === 'function' && window.isBalanceTransferPayMethod(method)) return true;
            if (typeof window.isRewardPayMethod === 'function' && window.isRewardPayMethod(method)) return true;
        }
        var s = String(method == null ? '' : method).trim().toLowerCase().replace(/[_-]+/g, ' ');
        if (s.indexOf('balance transfer') >= 0 || s === '余额转移' || s === '餘額轉移') return true;
        if (s.indexOf('reward') >= 0 && s.indexOf('point') >= 0) return true;
        if (s === '積分' || s === '积分' || s === '獎勵積分' || s === '奖励积分') return true;
        return false;
    }

    /** Pure: cash paid on a bill from its payment rows (void, reward and balance-transfer rows left out). */
    function cashPaidFromPayments(rows) {
        var sum = 0;
        (rows || []).forEach(function (p) {
            if (!p || p.voided_at) return;
            if (isNonCashMethod(p.method)) return;
            sum += cents(p.amount);
        });
        return money(sum);
    }

    function billCashPaid(billId, fallback) {
        if (!billId || typeof SB === 'undefined' || !SB) return Promise.resolve(round2(fallback || 0));
        return SB.from('bill_payments').select('amount,method,voided_at').eq('bill_id', billId)
            .then(function (r) {
                if (!r || r.error) return round2(fallback || 0);
                return Math.max(cashPaidFromPayments(r.data || []), round2(fallback || 0));
            }, function () { return round2(fallback || 0); });
    }

    function couponNotice(text) {
        if (typeof document === 'undefined' || !document.body) return;
        ensureCss();
        var el = document.createElement('div');
        el.className = 'dc-notice';
        el.setAttribute('role', 'status');
        el.textContent = text;
        document.body.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 9000);
    }

    /** Checkout (bill step 2): show which spend coupons this bill earns and how far to the next one. */
    function paintCheckoutHint(total, paid, method) {
        var host = typeof document !== 'undefined' ? document.getElementById('bSpendHint') : null;
        if (!host) return;
        var sel = document.getElementById('bType');
        if (sel && !sel.__dcHint) {
            sel.__dcHint = true;
            sel.addEventListener('change', function () {
                paintCheckoutHint(parseFloat((document.getElementById('bTotal') || {}).textContent) || 0,
                    parseFloat((document.getElementById('bAmtPaid') || {}).value) || 0, sel.value);
            });
        }
        if (!_loaded) {
            loadState().then(function () { if (_loaded) paintCheckoutHint(total, paid, method); });
            return;
        }
        if (!clinicJoined(clinicCodeNow())) { host.hidden = true; return; }
        var prog = spendProgress(total);
        if (!prog.reached.length && !prog.next) { host.hidden = true; return; }
        var lines = [];
        if (prog.reached.length) {
            lines.push('🎟️ ' + ct('coupons.info.willEarn', 'Paid in full by cash, this bill earns') + ': ' +
                prog.reached.map(campLabel).join(' + '));
        }
        if (prog.next) {
            lines.push('➕ ' + ct('coupons.info.short', 'Spend') + ' HK$' + prog.shortBy.toFixed(2) + ' ' +
                ct('coupons.info.more', 'more for') + ' ' + campLabel(prog.next));
        }
        if (prog.reached.length && method && isNonCashMethod(method)) {
            lines.push('⚠️ ' + ct('coupons.info.nonCash', 'Reward points and balance transfer do not count towards spend coupons.'));
        } else if (prog.reached.length && (parseFloat(paid) || 0) + 0.005 < (parseFloat(total) || 0)) {
            lines.push('ℹ️ ' + ct('coupons.info.needFull', 'Issued once the bill is fully paid.'));
        }
        host.hidden = false;
        host.innerHTML = lines.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('') + spendBarHtml(total, prog);
    }

    function spendBarHtml(amount, prog) {
        if (!prog || (!prog.reached.length && !prog.next)) return '';
        var amt = round2(parseFloat(amount) || 0);
        var goal = prog.next || prog.reached[prog.reached.length - 1];
        var scale = parseFloat(goal.target) || 0;
        if (scale <= 0) return '';
        var pct = Math.max(0, Math.min(100, amt / scale * 100));
        var ticks = prog.reached.map(function (c) {
            var at = Math.min(100, (parseFloat(c.target) || 0) / scale * 100);
            return at < 99.5 ? '<i class="dc-prog-tick" style="left:' + at.toFixed(1) + '%" title="' + esc(campLabel(c)) + '"></i>' : '';
        }).join('');
        var right = prog.next
            ? esc(campLabel(prog.next))
            : '✓ ' + esc(ct('coupons.prog.top', 'Top spend reward reached'));
        return '<div class="dc-prog' + (prog.next ? '' : ' is-top') + '" role="progressbar" aria-valuemin="0" aria-valuemax="' +
            round2(scale) + '" aria-valuenow="' + Math.min(amt, round2(scale)) + '" aria-label="' +
            esc(ct('coupons.prog.label', 'Progress to the next spend reward')) + '">' +
            '<div class="dc-prog-track"><span class="dc-prog-fill" style="width:' + pct.toFixed(1) + '%"></span>' + ticks + '</div>' +
            '<div class="dc-prog-cap"><span>HK$' + amt.toFixed(0) + ' / ' + round2(scale).toFixed(0) + '</span><span>' + right + '</span></div></div>';
    }

    function onBillFullyPaid(info) {
        info = info || {};
        var clinicCode = String(info.clinicCode || '').trim() ||
            String((typeof bdCurrentBill !== 'undefined' && bdCurrentBill && bdCurrentBill.clinic_tag) || '').trim() ||
            clinicCodeNow();
        return Promise.all([
            loadState().then(loadUsage),
            billCashPaid(info.billId, info.cashAmount),
            (typeof SB !== 'undefined' && SB && info.billId)
                ? SB.from('discount_coupons').select('campaign_key,status').eq('origin_bill_id', info.billId)
                    .then(function (r) { return (r && r.data) || []; }, function () { return []; })
                : Promise.resolve([]),
            billDoctorKey(info.billId, info.doctorKey)
        ]).then(function (res) {
            var cashPaid = res[1];
            var doctorKey = res[3];
            var already = {};
            (res[2] || []).forEach(function (c) { if (c.status !== 'void') already[c.campaign_key] = true; });
            var list = campaigns().filter(function (c) { return !already[c.key]; });
            return loadWallet(info.patientId).then(function (wallet) {
                var plan = planTargetSpend({
                    clinicCode: clinicCode,
                    doctorKey: doctorKey,
                    clinics: _clinics,
                    doctors: _doctors,
                    campaigns: list,
                    wallet: wallet,
                    cashAmount: cashPaid,
                    patientId: info.patientId,
                    billId: info.billId
                });
                if (!plan || !plan.ok) return plan;
                var plans = (plan.plans && plan.plans.length) ? plan.plans : [plan];
                var issued = [];
                var seq = Promise.resolve();
                plans.forEach(function (p) {
                    seq = seq.then(function () {
                        var row = issueRecord(p.campaign, p.patientId, {
                            clinicCode: clinicCode,
                            originBillId: info.billId
                        });
                        return insertCoupon(row, true).then(function (saved) {
                            if (saved && saved.ok) issued.push({ campaign: p.campaign, row: row });
                            return saved;
                        });
                    });
                });
                return seq.then(function () {
                    if (issued.length) {
                        couponNotice('🎟️ ' + ct('coupons.notice.earned', 'This bill earned') + ': ' + issued.map(function (x) {
                            return campLabel(x.campaign) + ' · HK$' + round2(x.row.face_value).toFixed(0) +
                                ' (' + ct('coupons.info.expires', 'expires') + ' ' + x.row.expires_on + ')';
                        }).join(' / ') + ' — ' + ct('coupons.notice.wallet', 'added to the wallet for the next visit.'));
                        var open = (typeof bdCurrentBill !== 'undefined') ? bdCurrentBill : null;
                        if (open && String(open.id) === String(info.billId)) refreshBillCouponInfo(open);
                    }
                    return { ok: true, issued: issued.length, cashPaid: cashPaid };
                });
            });
        });
    }

    function actorName() {
        if (typeof currentName !== 'undefined' && currentName) return String(currentName);
        if (typeof currentUserId !== 'undefined' && currentUserId) return String(currentUserId);
        return '';
    }

    /** Coupon log row. Written straight to the audit table so it does not depend on the general audit switch. Resolves true when saved. */
    function logCoupon(operation, detail, patientNo, recordId, actor) {
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve(false);
        var row = {
            clinic_tag: clinicCodeNow() || (typeof auditActiveClinicTag === 'function' ? auditActiveClinicTag() : '') || null,
            user_id: actor ? actor.user_id : (typeof currentUserId !== 'undefined' ? currentUserId : null),
            user_name: actor ? grantorName(actor) : actorName(),
            audit_item: 'COUPON ' + operation,
            table_name: 'discount_coupons',
            operation: operation,
            record_id: recordId || null,
            patient_no: patientNo || null,
            changes_detail: detail
        };
        try {
            if (typeof auditClientHostLabel === 'function') row.client_host = auditClientHostLabel() || null;
        } catch (e0) {}
        var table = (typeof AUDIT_TRAIL_TABLE !== 'undefined' && AUDIT_TRAIL_TABLE) ? AUDIT_TRAIL_TABLE : 'audit_trail';
        try {
            return Promise.resolve(SB.from(table).insert([row])).then(function (r) {
                return !!r && !r.error;
            }, function () { return false; });
        } catch (e) {
            return Promise.resolve(false);
        }
    }

    function grantorName(user) {
        if (!user) return '';
        return String(user.display_name || user.user_id || '').trim();
    }

    /** Note suffix when the person who authorized is not the login on screen. */
    function screenLoginSuffix(user) {
        var screen = String((typeof currentUserId !== 'undefined' && currentUserId) || '').trim();
        if (!screen || !user || screen.toLowerCase() === String(user.user_id || '').toLowerCase()) return '';
        return ' · screen login ' + screen;
    }

    /** Re-check a staff login before a gift or transfer. The shared Nurse login is refused. */
    function verifyGrantor(uid, pw) {
        uid = String(uid || '').trim();
        if (!uid || !pw) return Promise.resolve({ ok: false, reason: 'auth_missing' });
        if (SHARED_LOGIN_IDS[uid.toLowerCase()]) return Promise.resolve({ ok: false, reason: 'shared_login' });
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            return Promise.resolve({ ok: false, reason: 'no_db' });
        }
        return SB.from('app_users')
            .select('user_id,role,display_name,is_active')
            .eq('user_id', uid)
            .eq('password', pw)
            .eq('is_active', true)
            .limit(1)
            .then(function (r) {
                var u = r && !r.error && r.data && r.data[0];
                if (!u || SHARED_LOGIN_IDS[String(u.user_id || '').toLowerCase()]) return { ok: false, reason: 'creds' };
                return { ok: true, user: u };
            }, function () { return { ok: false, reason: 'creds' }; });
    }

    function clinicCodeNow() {
        var code = '';
        if (typeof currentClinicCodeForTagging === 'function') code = currentClinicCodeForTagging() || '';
        return String(code || '').trim();
    }

    function onBillVoided(bill) {
        bill = bill || {};
        var billId = bill.id;
        if (!billId || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            return Promise.resolve({ ok: false, reason: 'no_db' });
        }
        var filter = 'bill_id.eq.' + billId + ',origin_bill_id.eq.' + billId;
        if (bill.coupon_id) filter += ',id.eq.' + bill.coupon_id;
        return SB.from('discount_coupons').select('id,status,bill_id,origin_bill_id,code,face_value')
            .or(filter)
            .then(function (r) {
                var rows = (r && r.data) ? r.data.slice() : [];
                if (bill.coupon_id && !rows.some(function (c) { return String(c.id) === String(bill.coupon_id); })) {
                    rows.push({ id: bill.coupon_id, status: 'used', bill_id: billId });
                }
                var plan = planBillVoid(bill, rows);
                var jobs = [];
                plan.restore.forEach(function (id) {
                    jobs.push(SB.from('discount_coupons').update({
                        status: 'unused',
                        bill_id: null,
                        redeemed_amount: null,
                        redeemed_at: null,
                        line_name: null
                    }).eq('id', id));
                });
                plan.cancel.forEach(function (id) {
                    jobs.push(SB.from('discount_coupons').update({
                        status: 'void',
                        note: 'Voided with bill'
                    }).eq('id', id).eq('status', 'unused'));
                });
                jobs.push(SB.from('bills').update({ coupon_id: null }).eq('id', billId));
                return Promise.all(jobs).then(function () {
                    if (plan.restore.length) {
                        logCoupon('RESTORE', 'Void bill restored coupon ' + plan.restore.join(','), null, billId);
                    }
                    if (plan.cancel.length) {
                        logCoupon('CANCEL', 'Void bill cancelled issued coupon ' + plan.cancel.join(','), null, billId);
                    }
                    bill.coupon_id = null;
                    return { ok: true, restore: plan.restore, cancel: plan.cancel };
                });
            }, function (e) {
                return { ok: false, error: String(e && e.message || e) };
            });
    }

    function giftOfferText(camp) {
        if (!camp) return '';
        if (camp.key === 'cash') return ct('coupons.grant.cashRange', 'Type HK$1 to HK$200');
        if (camp.mode === 'free_line') return campLabel(camp);
        if (camp.mode === 'percent') {
            return (camp.percent || 0) + '% · ' + ct('coupons.grant.ceiling', 'ceiling') + ' HK$' + round2(camp.maxDiscount || 0).toFixed(0);
        }
        return 'HK$' + round2(camp.face || 0).toFixed(0);
    }

    function grantReason(code) {
        if (code === 'auth_missing') return ct('coupons.auth.need', 'Enter your login ID and password');
        if (code === 'creds') return ct('coupons.auth.creds', 'Login ID or password is incorrect');
        if (code === 'shared_login') return ct('coupons.auth.shared', 'The shared Nurse login cannot gift or transfer coupons. Use your own login.');
        if (code === 'no_db') return ct('coupons.log.noDb', 'Database not connected.');
        if (code === 'expired') return ct('coupons.xfer.expired', 'This coupon has expired');
        if (code === 'locked') return ct('coupons.xfer.locked', 'New-chart and referral coupons stay with the patient');
        if (code === 'same_patient') return ct('coupons.xfer.same', 'That is the same chart');
        if (code === 'not_unused') return ct('coupons.xfer.notUnused', 'Only an unused coupon can be transferred');
        if (code === 'amount') return ct('coupons.grant.amount', 'Enter HK$1 to HK$200');
        if (code === 'wallet_full') return ct('coupons.grant.full', 'Wallet already holds 20 unused coupons');
        if (code === 'already_holding') return ct('coupons.grant.holding', 'This patient already holds the most allowed of this coupon (see “Hold up to” in Configuration)');
        if (code === 'clinic') return ct('coupons.grant.clinic', 'This clinic is not in the coupon scheme');
        if (code === 'patient') return ct('coupons.grant.patient', 'Open a patient bill first');
        if (code === 'automatic') return ct('coupons.grant.automatic', 'This coupon is issued automatically');
        if (code === 'campaign_off') return ct('coupons.grant.off', 'Turn this coupon on in Configuration');
        if (code === 'no_items') return ct('coupons.grant.items', 'Tick the treatments for this coupon in Configuration');
        if (code === 'role') return ct('coupons.grant.role', 'This login cannot gift coupons');
        if (code === 'budget') return ct('coupons.grant.budget', 'This coupon has reached its budget');
        if (code === 'issue_cap') return ct('coupons.grant.cap', 'This coupon has reached its issue limit');
        return code || ct('coupons.grant.fail', 'Could not gift the coupon');
    }

    function openGrantSheet() {
        var bill = (typeof bdCurrentBill !== 'undefined') ? bdCurrentBill : null;
        if (!bill || !bill.patient_id) return;
        openBillSheet(bill, { gift: true });
    }

    /** grantor: verified app_users row from verifyGrantor. Required. */
    function grantToWallet(patientId, campaignKey, amount, patientNo, grantor) {
        if (!grantor || !grantor.user_id) return Promise.resolve({ ok: false, reason: 'auth_missing' });
        return loadState().then(loadUsage).then(function () {
            var joined = clinicJoined(clinicCodeNow());
            var role = String(grantor.role || '');
            return loadWallet(patientId).then(function (wallet) {
                var camp = campaignByKey(campaignKey);
                var plan = planChairsideGrant({
                    amount: amount,
                    patientId: patientId,
                    clinicJoined: joined,
                    wallet: wallet,
                    campaign: camp,
                    campaignKey: campaignKey,
                    role: role
                });
                if (!plan.ok) return plan;
                var row = issueRecord(camp, patientId, {
                    face: plan.campaignKey === 'cash' ? plan.amount : camp.face,
                    clinicCode: clinicCodeNow(),
                    issuedBy: grantorName(grantor),
                    note: 'Gifted into wallet' + screenLoginSuffix(grantor)
                });
                return insertCoupon(row, camp.sms !== false).then(function (saved) {
                    if (!saved || !saved.ok) return saved;
                    return logCoupon('GRANT', (camp.nameZh || camp.key) + ' HK$' + round2(row.face_value).toFixed(2) +
                        ' code ' + (saved.code || row.code) + ' to ' + (patientNo || patientId) + screenLoginSuffix(grantor),
                        patientNo || null, saved.id || null, grantor).then(function (logged) {
                        saved.logged = logged;
                        return saved;
                    });
                });
            });
        });
    }

    /** Pure: coupon log text for a transfer, e.g. "Coupon DC-AB12 · 現金券 HK$100 · from 001 to 002". */
    function transferDetail(coupon, fromPatientNo, toPatient) {
        coupon = coupon || {};
        var camp = campaignByKey(coupon.campaign_key) || {};
        var mode = coupon.discount_mode || coupon.mode || camp.mode;
        var face = coupon.face_value != null ? coupon.face_value : coupon.face;
        var value = mode === 'free_line' ? '' : mode === 'percent'
            ? ' ' + round2(parseFloat(coupon.percent) || 0) + '%'
            : ' HK$' + round2(parseFloat(face) || 0).toFixed(2);
        return 'Coupon ' + (coupon.code || coupon.id || '') +
            ' · ' + (camp.nameZh || camp.name || coupon.campaign_key || '') + value +
            ' · from ' + (fromPatientNo || coupon.patient_id || '?') +
            ' to ' + ((toPatient && (toPatient.patient_no || toPatient.id)) || '?');
    }

    /** grantor: verified app_users row from verifyGrantor. Required. */
    function transferSelected(coupon, toPatient, fromPatientNo, grantor) {
        if (!grantor || !grantor.user_id) return Promise.resolve({ ok: false, reason: 'auth_missing' });
        return loadWallet(toPatient.id).then(function (toWallet) {
            var plan = planTransfer({
                coupon: coupon,
                fromPatientId: coupon.patient_id,
                toPatientId: toPatient.id,
                toWallet: toWallet
            });
            if (!plan.ok) return plan;
            if (typeof SB === 'undefined' || !SB) return { ok: false, reason: 'no_db' };
            return SB.from('discount_coupons').update({
                patient_id: toPatient.id,
                note: 'Transferred from ' + (fromPatientNo || coupon.patient_id || '') + ' by ' + grantorName(grantor) +
                    screenLoginSuffix(grantor)
            }).eq('id', coupon.id).eq('status', 'unused').then(function (r) {
                if (r.error) return { ok: false, error: r.error.message };
                return logCoupon('TRANSFER', transferDetail(coupon, fromPatientNo, toPatient) + screenLoginSuffix(grantor),
                    toPatient.patient_no || null, coupon.id, grantor).then(function (logged) {
                    return { ok: true, logged: logged };
                });
            });
        });
    }

    function ensureCss() {
        if (typeof document === 'undefined' || document.getElementById('dc-css')) return;
        var links = document.querySelectorAll('link[rel="stylesheet"]');
        for (var i = 0; i < links.length; i++) {
            if (/(^|\/)style-coupons\.css(\?|$)/.test(links[i].getAttribute('href') || '')) return;
        }
        var link = document.createElement('link');
        link.id = 'dc-css';
        link.rel = 'stylesheet';
        link.href = typeof window.__JSM_WITH_BUST === 'function' ? window.__JSM_WITH_BUST('style-coupons.css') : 'style-coupons.css';
        document.head.appendChild(link);
    }

    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('app-lang-change', function () {
            var host = document.getElementById('dcSheetHost');
            if (_lastSheet && host && !host.hasAttribute('hidden')) paintSheet.apply(null, _lastSheet);
            var pane = document.getElementById('cfgPane-coupons');
            if (pane && pane.querySelector('.dc-clinic-join')) paintConfig(pane);
            if (typeof bdCurrentBill !== 'undefined' && bdCurrentBill) {
                bdCurrentBill.coupon_label = '';
                syncBillDetail(bdCurrentBill);
            }
        });
    }

    scheduleExpiryReminders();

    return {
        WALLET_CAP: WALLET_CAP,
        isLive: isLive,
        unusedCount: unusedCount,
        usageText: usageText,
        loadUsage: loadUsage,
        sendExpiryReminders: sendExpiryReminders,
        DEFAULT_JOIN_CODE: DEFAULT_JOIN_CODE,
        ITEM_GROUPS: ITEM_GROUPS,
        CAMPAIGN_DEFS: CAMPAIGN_DEFS,
        defaultCampaigns: defaultCampaigns,
        defaultClinicJoined: defaultClinicJoined,
        clinicJoined: clinicJoined,
        doctorJoined: doctorJoined,
        lineMatchesGroup: lineMatchesGroup,
        assessCoupon: assessCoupon,
        pickBest: pickBest,
        canIssue: canIssue,
        planNewChart: planNewChart,
        planTargetSpend: planTargetSpend,
        billTotalCents: billTotalCents,
        refundEffect: refundEffect,
        smsIssued: smsIssued,
        couponSmsBody: couponSmsBody,
        smsExpiring: smsExpiring,
        renderConfigPane: renderConfigPane,
        syncBillDetail: syncBillDetail,
        openBillSheet: openBillSheet,
        onPatientCreated: onPatientCreated,
        onBillFullyPaid: onBillFullyPaid,
        onBillVoided: onBillVoided,
        planBillVoid: planBillVoid,
        planChairsideGrant: planChairsideGrant,
        planTransfer: planTransfer,
        couponSlot: couponSlot,
        combineCoupons: combineCoupons,
        bestCombination: bestCombination,
        holdLimitFor: holdLimitFor,
        billSavings: billSavings,
        spendProgress: spendProgress,
        cashPaidFromPayments: cashPaidFromPayments,
        buildCouponLog: buildCouponLog,
        loadCouponLog: loadCouponLog,
        couponLogCsv: couponLogCsv,
        isCashCoupon: isCashCoupon,
        normalizeCashRules: normalizeCashRules,
        cashCapCents: cashCapCents,
        openWalletQr: openWalletQr,
        walletPageBase: walletPageBase,
        walletUrl: walletUrl,
        isLocalAddress: isLocalAddress,
        cashRules: cashRules,
        couponLabelFor: couponLabelFor,
        transferDetail: transferDetail,
        logCoupon: logCoupon,
        campStatus: campStatus,
        kindOf: kindOf,
        daysUntil: daysUntil,
        expiryChipHtml: expiryChipHtml,
        walletSummaryHtml: walletSummaryHtml,
        spendBarHtml: spendBarHtml,
        _paintSheet: paintSheet,
        campLabel: campLabel,
        paintCheckoutHint: paintCheckoutHint,
        ITEM_KEYWORDS: ITEM_KEYWORDS,
        keywordHit: keywordHit,
        itemRule: itemRule,
        nameFitsRule: nameFitsRule,
        itemPickerRows: itemPickerRows,
        CASH_GRANT_MAX: CASH_GRANT_MAX,
        SHARED_LOGIN_IDS: SHARED_LOGIN_IDS,
        verifyGrantor: verifyGrantor,
        openGrantSheet: openGrantSheet,
        loadState: loadState,
        snapshot: snapshot,
        mergeSaved: mergeSaved
    };
})();
