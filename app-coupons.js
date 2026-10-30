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
    var EXPIRY_SMS_MONTHS = 1;
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
        { key: 'referral', name: 'Refer a friend', nameZh: '介紹新客', scope: 'bill', mode: 'amount', face: 100, expiry: 180, sms: true, trigger: 'referral', hold: 5, minFirst: 500, refPercent: 10, refMax: 1000, refStep: 10 },
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
    var DEFAULT_CASH_RULES = { maxCount: 0, maxPercent: 0, maxAmount: 3000 };
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
            minFirstSpend: def.minFirst || 0,
            refPercent: def.refPercent || 0,
            refMax: def.refMax || 0,
            refStep: def.refStep || 0,
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

    /** Pure: the clinic's "All Doctors" switch; null when never set (counts as on). */
    function allDoctorsSetting(docs, clinicCode) {
        var allKey = String(clinicCode || '').trim().toUpperCase() + '|__all__';
        return docs && Object.prototype.hasOwnProperty.call(docs, allKey) ? !!docs[allKey].joined : null;
    }

    /** "All Doctors" ticked = every doctor of that clinic is in; otherwise each doctor's own switch (clinic by clinic). */
    function doctorJoined(clinicCode, doctorKey, maps) {
        if (!clinicJoined(clinicCode, maps && maps.clinics)) return false;
        var c = String(clinicCode || '').trim().toUpperCase();
        var docs = (maps && maps.doctors) || _doctors;
        var all = allDoctorsSetting(docs, c);
        if (!doctorKey || doctorKey === '__all__') return all !== false;
        if (all !== false) return true;
        var oneKey = c + '|' + String(doctorKey);
        return !!(docs && Object.prototype.hasOwnProperty.call(docs, oneKey) && docs[oneKey].joined);
    }

    /**
     * Pure: doctor switches after one tick in a clinic's list (select-all style).
     * listKeys = the doctors shown for that clinic. Returns a new map; other clinics are untouched.
     */
    function planDoctorToggle(docs, clinicCode, doctorKey, joined, listKeys) {
        var c = String(clinicCode || '').trim().toUpperCase();
        var allKey = c + '|__all__';
        var out = {};
        Object.keys(docs || {}).forEach(function (k) { out[k] = docs[k]; });
        var keys = (listKeys || []).map(String).filter(function (k) { return k && k !== '__all__'; });
        function clearClinic() {
            Object.keys(out).forEach(function (k) { if (k.indexOf(c + '|') === 0 && k !== allKey) delete out[k]; });
        }
        if (doctorKey === '__all__') {
            clearClinic();
            out[allKey] = { joined: !!joined };
            return out;
        }
        var key = String(doctorKey || '');
        if (!joined && allDoctorsSetting(out, c) !== false) {
            clearClinic();
            out[allKey] = { joined: false };
            keys.forEach(function (k) { out[c + '|' + k] = { joined: k !== key }; });
            out[c + '|' + key] = { joined: false };
            return out;
        }
        out[c + '|' + key] = { joined: !!joined };
        if (joined && keys.length && keys.every(function (k) { return out[c + '|' + k] && out[c + '|' + k].joined; })) {
            clearClinic();
            out[allKey] = { joined: true };
        }
        return out;
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

    function itemLineName(line, catalog) {
        return catalogName(line, catalog) || String((line && (line.item_name || line.desc || line.name)) || '').trim();
    }

    /** Live treatment coupons whose item rule hits a bill or plan line. Own chart only. */
    function matchingItemCoupons(wallet, items, today, catalog) {
        today = today || todayIso();
        items = Array.isArray(items) ? items : [];
        return (wallet || []).filter(function (c) {
            if (!isLive(c, today) || c.household_id) return false;
            var rule = itemRule(c);
            if (!ruleHasItems(rule)) return false;
            return items.some(function (line) {
                return nameFitsRule(itemLineName(line, catalog), rule);
            });
        });
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

    /** Today's date in Hong Kong (UTC+8), whatever the station clock zone. */
    function todayIso() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }

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

    function loyaltySnapFromRows(coupons, accounts, today) {
        today = today || todayIso();
        var in30 = addDaysIso(today, 30);
        var map = {};
        function snap(id) {
            id = String(id || '');
            if (!id) return null;
            if (!map[id]) map[id] = { live: 0, points: 0, expiring: 0 };
            return map[id];
        }
        (coupons || []).forEach(function (c) {
            var s = snap(c.patient_id);
            if (!s) return;
            if (isLive(c, today)) {
                s.live++;
                if (c.expires_on && String(c.expires_on) <= in30) s.expiring++;
            }
        });
        (accounts || []).forEach(function (a) {
            var s = snap(a.patient_id);
            if (s) s.points += Math.max(0, parseFloat(a.balance) || 0);
        });
        return map;
    }

    function loyaltySnapMatches(snap, filter) {
        snap = snap || { live: 0, points: 0, expiring: 0 };
        if (!filter) return true;
        if (filter === 'coupon') return (snap.live || 0) > 0;
        if (filter === 'expiring') return (snap.expiring || 0) > 0;
        if (filter === 'points500') return (snap.points || 0) >= 500;
        return true;
    }

    function loyaltyBadgeHtml(snap) {
        snap = snap || {};
        var bits = [];
        if ((snap.live || 0) > 0) {
            bits.push('<span class="loy-appt-c" title="' + esc(ct('coupons.appt.coupons', 'Unused coupons')) + '">' +
                snap.live + '</span>');
        }
        var pts = Math.floor(Number(snap.points) || 0);
        if (pts > 0) {
            bits.push('<span class="loy-appt-p" title="' + esc(ct('coupons.appt.points', 'Reward points')) + '">' +
                pts + 'pt</span>');
        }
        if (!bits.length) return '';
        return '<span class="loy-appt-badges">' + bits.join('') + '</span>';
    }

    function loyaltyDaySnapshots(patientIds) {
        var ids = [];
        (patientIds || []).forEach(function (id) {
            id = String(id || '');
            if (id && ids.indexOf(id) < 0) ids.push(id);
        });
        var empty = {};
        ids.forEach(function (id) { empty[id] = { live: 0, points: 0, expiring: 0 }; });
        if (!ids.length || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            return Promise.resolve(empty);
        }
        var today = todayIso();
        return Promise.all([
            SB.from('discount_coupons').select('patient_id,status,expires_on,issued_at').in('patient_id', ids)
                .then(function (r) { return (r && r.data) || []; }, function () { return []; }),
            SB.from('reward_accounts').select('patient_id,balance').in('patient_id', ids)
                .then(function (r) { return (r && r.data) || []; }, function () { return []; }),
            freshZeroPolicy()
        ]).then(function (both) {
            var coupons = applyZeroExpiry(both[0] || [], both[2]);
            var map = loyaltySnapFromRows(coupons, both[1] || [], today);
            ids.forEach(function (id) { if (!map[id]) map[id] = empty[id]; });
            return map;
        });
    }

    function paintApptLoyalty(root) {
        var host = root || document;
        if (!host || !host.querySelectorAll) return Promise.resolve(0);
        var nodes = host.querySelectorAll('.loy-appt[data-pid]');
        if (!nodes.length) return Promise.resolve(0);
        var ids = [];
        for (var i = 0; i < nodes.length; i++) {
            var pid = nodes[i].getAttribute('data-pid');
            if (pid && ids.indexOf(pid) < 0) ids.push(pid);
        }
        return loyaltyDaySnapshots(ids).then(function (map) {
            for (var j = 0; j < nodes.length; j++) {
                var n = nodes[j];
                var html = loyaltyBadgeHtml(map[n.getAttribute('data-pid')] || {});
                n.innerHTML = html;
                if (html) n.removeAttribute('hidden');
                else n.setAttribute('hidden', '');
            }
            return ids.length;
        });
    }

    function fetchLoyaltyPages(table, select, extraFn) {
        var all = [];
        function page(from) {
            if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve(all);
            var q = SB.from(table).select(select);
            if (typeof extraFn === 'function') q = extraFn(q) || q;
            if (q && typeof q.range === 'function') q = q.range(from, from + 999);
            return Promise.resolve(q).then(function (r) {
                var rows = (r && r.data) || [];
                all = all.concat(rows);
                if (rows.length === 1000 && all.length < 8000) return page(from + 1000);
                return all;
            }, function () { return all; });
        }
        return page(0);
    }

    function loyaltyBroadcastIndex() {
        var today = todayIso();
        return Promise.all([
            fetchLoyaltyPages('discount_coupons', 'patient_id,status,expires_on,issued_at', function (q) {
                return q.eq('status', 'unused');
            }),
            fetchLoyaltyPages('reward_accounts', 'patient_id,balance', function (q) {
                return q.gt('balance', 0);
            }),
            freshZeroPolicy()
        ]).then(function (both) {
            return loyaltySnapFromRows(applyZeroExpiry(both[0] || [], both[2]), both[1] || [], today);
        });
    }

    function tagHouseholdCoupons(rows, patientId, nos) {
        nos = nos || {};
        var pid = String(patientId || '');
        return (rows || []).map(function (c) {
            var id = String(c.patient_id || '');
            if (id && id !== pid) {
                var tagged = {};
                Object.keys(c).forEach(function (k) { tagged[k] = c[k]; });
                tagged.household_id = id;
                tagged.household_no = nos[id] || '';
                return tagged;
            }
            return c;
        });
    }

    function householdPatientIds(patientId) {
        if (!patientId) return Promise.resolve([]);
        if (typeof REWARDS !== 'undefined' && REWARDS && typeof REWARDS.relatedPatientIds === 'function') {
            return Promise.resolve(REWARDS.relatedPatientIds(patientId)).then(function (ids) {
                return (ids && ids.length) ? ids : [patientId];
            }, function () { return [patientId]; });
        }
        return Promise.resolve([patientId]);
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
    /**
     * Pure: what to undo when a bill is voided or deleted.
     * restore = coupons used on this bill (back to the wallet); cancel = unused coupons this bill earned;
     * stuck = coupons this bill earned that were already used on another bill (cannot be taken back).
     */
    function planBillVoid(bill, coupons) {
        bill = bill || {};
        var restore = [];
        var cancel = [];
        var stuck = [];
        (coupons || []).forEach(function (c) {
            if (!c || !c.id) return;
            var onThis = (bill.coupon_id && String(c.id) === String(bill.coupon_id)) ||
                (c.bill_id && bill.id && String(c.bill_id) === String(bill.id));
            var earnedHere = c.origin_bill_id && bill.id && String(c.origin_bill_id) === String(bill.id);
            if (onThis && c.status === 'used') restore.push(String(c.id));
            else if (earnedHere && c.status === 'unused') cancel.push(String(c.id));
            else if (earnedHere && c.status === 'used') stuck.push(String(c.code || c.id));
        });
        return { restore: restore, cancel: cancel, stuck: stuck };
    }

    /**
     * Pure: a payment on the bill was voided. While the bill is still fully paid nothing changes;
     * otherwise the spend coupons it earned are taken back (unused) or flagged (already used).
     * Coupons used on the bill stay on it — the bill still exists and can be paid again.
     */
    function planPaymentVoid(bill, coupons, balanceAfter) {
        bill = bill || {};
        if (!bill.id || !((parseFloat(balanceAfter) || 0) > 0.005)) return { cancel: [], stuck: [] };
        var plan = planBillVoid({ id: bill.id }, (coupons || []).filter(function (c) {
            return c && c.origin_bill_id && String(c.origin_bill_id) === String(bill.id);
        }));
        return { cancel: plan.cancel, stuck: plan.stuck };
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
     * heading, 變動/Change, 結餘/Balance (coupons issued at this clinic), 總結餘/All-clinic total,
     * the list of usable coupons, 診所/Clinic, 參考/Ref, then the year-end note.
     */
    function couponSmsBody(opts) {
        opts = opts || {};
        var today = opts.today || todayIso();
        var live = (opts.wallet || []).filter(function (c) { return isLive(c, today); });
        live.sort(function (a, b) {
            return String(a.expires_on || '9999-12-31').localeCompare(String(b.expires_on || '9999-12-31'));
        });
        var clinic = String(opts.clinic || '').trim();
        var atClinic = live.filter(function (c) {
            return clinic && String(c.clinic_code || '').trim().toUpperCase() === clinic.toUpperCase();
        }).length;
        function countText(n) { return n + '張 / ' + n + (n === 1 ? ' coupon' : ' coupons'); }
        var lines = [
            SMS_HEADING + ' 優惠券更新 / Discount coupon update',
            '變動/Change: ' + opts.change,
            '結餘/Balance (' + clinic + '): ' + countText(atClinic),
            '總結餘/All-clinic total: ' + countText(live.length)
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
        lines.push('診所/Clinic: ' + clinic);
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
            change: '+1 ' + smsCouponName(coupon) + ' ' + smsCouponValue(coupon) + ' (發出/Issued)' +
                (opts.thanks ? ' — 多謝介紹 ' + opts.thanks + ' / thanks for referring ' + opts.thanks : ''),
            clinic: opts.clinic || coupon.clinic_code || '',
            ref: coupon.code || ''
        });
    }

    /** Pure: the same day n calendar months away, clamped to month end (2026-12-31 −1 → 2026-11-30). */
    function addMonthsIso(iso, n) {
        var p = String(iso || '').split('-');
        var y = parseInt(p[0], 10), m = parseInt(p[1], 10) - 1 + n, d = parseInt(p[2], 10);
        var first = new Date(Date.UTC(y, m, 1));
        var last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
        first.setUTCDate(Math.min(d, last));
        return first.toISOString().slice(0, 10);
    }

    /**
     * Pure: which expiry reminder is due today — 'week' (1–7 days left), 'month' (from 1 calendar month
     * before expiry until 8 days left), or ''. Late runs still remind once inside each window.
     * No week reminder on the issue day; no month reminder for a coupon issued inside the month window.
     */
    function expiryReminderStage(coupon, today) {
        if (!coupon || coupon.status !== 'unused' || !coupon.expires_on || !today) return '';
        var days = Math.round((new Date(coupon.expires_on + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
        if (days < 1) return '';
        if (days <= EXPIRY_SMS_DAYS) return coupon.issued_on === today ? '' : 'week';
        var monthFrom = addMonthsIso(coupon.expires_on, -EXPIRY_SMS_MONTHS);
        if (today < monthFrom) return '';
        if (coupon.issued_on && coupon.issued_on >= monthFrom) return '';
        return 'month';
    }

    /** Pure: Hong Kong year-end reminder due today — 'month' (30 Nov–23 Dec), 'week' (24–30 Dec) or ''. */
    function yearEndReminderStage(today) {
        var t = String(today || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return '';
        var end = t.slice(0, 4) + '-12-31';
        if (t >= end) return '';
        if (t >= addDaysIso(end, -EXPIRY_SMS_DAYS)) return 'week';
        if (t >= addMonthsIso(end, -EXPIRY_SMS_MONTHS)) return 'month';
        return '';
    }

    /** Year-end reminder text: with Set zero on year end, every live coupon goes on 31 Dec 23:59 (HK). */
    function smsYearEndCoupons(today, wallet, opts) {
        opts = opts || {};
        var end = smsYearEnd(today);
        var days = daysUntil(String(today).slice(0, 4) + '-12-31', today);
        return couponSmsBody({
            today: today,
            wallet: wallet,
            change: '所有優惠券將於' + end.zh + '到期（還有' + days + '日）/ All coupons expire on ' + end.en +
                ' (' + days + (days === 1 ? ' day' : ' days') + ' left)',
            clinic: opts.clinic || '',
            ref: opts.ref || ''
        });
    }

    /** Reminder text for a coupon in a reminder window (see expiryReminderStage). */
    function smsExpiring(coupon, today, wallet, opts) {
        if (!expiryReminderStage(coupon, today)) return '';
        var days = Math.round((new Date(coupon.expires_on + 'T00:00:00Z') - new Date(today + 'T00:00:00Z')) / 86400000);
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
                'issueCap', 'budget', 'sms', 'mode', 'name', 'nameZh', 'holdLimit', 'minFirstSpend',
                'refPercent', 'refMax', 'refStep'].forEach(function (k) {
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

    function setDoctorJoined(code, doctorKey, joined, listKeys) {
        _doctors = planDoctorToggle(_doctors, code, doctorKey, joined, listKeys);
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
        Promise.all([loadState().then(loadUsage), ensureCatalog(), loadZeroPolicy()]).then(function () {
            paintConfig(pane);
            maybeRunScheduledZero().then(function (res) {
                if (res && res.ok && !res.skipped && Number(res.coupons) > 0 && typeof toast === 'function') {
                    toast(ct('coupons.zero.autoRan', 'Auto set zero voided {N} coupon(s).').replace('{N}', String(res.coupons)));
                }
            }, function () {});
        });
    }

    // ── SET ZERO: void unused coupons, with a safety log and Step back (discount_coupon_zero.sql) ──
    var ZERO_KEY = 'coupon_zero_policy';
    var ZERO_MONTHS = [1, 2, 3, 4, 6, 9, 12, 24];
    var _zeroPolicy = null;

    /** Pure: manual (default) | year_end | lifespan; months only from the allowed list. */
    function normalizeZeroPolicy(raw) {
        var o = raw || {};
        var p = String(o.zero_policy || 'manual').toLowerCase();
        if (p !== 'year_end' && p !== 'lifespan') p = 'manual';
        var m = Number(o.lifespan_months);
        if (ZERO_MONTHS.indexOf(m) < 0) m = 12;
        var y = parseInt(o.last_year_end_zero_year, 10);
        return {
            zero_policy: p,
            lifespan_months: m,
            last_year_end_zero_year: y > 0 ? y : null,
            last_lifespan_run_at: o.last_lifespan_run_at || null
        };
    }

    function hkYear(d) {
        return new Date((d ? d.getTime() : Date.now()) + 8 * 3600000).getUTCFullYear();
    }

    /** Pure: 1 Jan 00:00 Hong Kong time of a year, as an ISO instant. */
    function hkYearStartIso(year) {
        return new Date(Date.UTC(year, 0, 1) - 8 * 3600000).toISOString();
    }

    /** Pure: the scheduled job due now, or null. year_end clears coupons issued before this HK year; lifespan clears coupons older than N months, once a day. */
    function scheduledZeroJob(policy, now) {
        var p = normalizeZeroPolicy(policy);
        now = now || new Date();
        if (p.zero_policy === 'year_end') {
            var y = hkYear(now);
            if (p.last_year_end_zero_year && p.last_year_end_zero_year >= y) return null;
            return { source: 'year_end', issuedBefore: hkYearStartIso(y), mark: { last_year_end_zero_year: y },
                note: 'Auto year-end SET ZERO (31 Dec 23:59 HK) for ' + (y - 1) };
        }
        if (p.zero_policy === 'lifespan') {
            var last = p.last_lifespan_run_at ? new Date(p.last_lifespan_run_at).getTime() : 0;
            if (last && now.getTime() - last < 86400000) return null;
            var cut = new Date(now.getTime());
            cut.setUTCMonth(cut.getUTCMonth() - p.lifespan_months);
            return { source: 'lifespan', issuedBefore: cut.toISOString(), mark: { last_lifespan_run_at: now.toISOString() },
                note: 'Auto lifespan SET ZERO: coupons older than ' + p.lifespan_months + ' months' };
        }
        return null;
    }

    function zeroPolicy() { return _zeroPolicy || normalizeZeroPolicy(null); }

    var _zeroPolicyAt = 0;

    function freshZeroPolicy() {
        if (_zeroPolicy && Date.now() - _zeroPolicyAt < 5 * 60000) return Promise.resolve(_zeroPolicy);
        return loadZeroPolicy();
    }

    /** Pure: the date a coupon really ends. With Set zero on year end, no later than 31 Dec of its HK issue year. */
    function effectiveExpiry(c, policy) {
        if (!c) return null;
        var own = c.own_expires_on !== undefined ? c.own_expires_on : c.expires_on;
        own = own ? String(own).slice(0, 10) : null;
        if (normalizeZeroPolicy(policy).zero_policy !== 'year_end') return own;
        var t = c.issued_at ? Date.parse(c.issued_at) : NaN;
        var cap = hkYear(isNaN(t) ? null : new Date(t)) + '-12-31';
        return !own || own > cap ? cap : own;
    }

    /** Rewrites expires_on to the effective date in place (own date kept in own_expires_on). Rows are read-only copies. */
    function applyZeroExpiry(rows, policy) {
        (rows || []).forEach(function (c) {
            if (!c || typeof c !== 'object') return;
            if (c.own_expires_on === undefined) c.own_expires_on = c.expires_on || null;
            c.expires_on = effectiveExpiry(c, policy);
        });
        return rows;
    }

    /** Pure: true when the picked option differs from the saved one (months count only for life span). */
    function zeroPolicyChanged(saved, policy, months) {
        var a = normalizeZeroPolicy(saved);
        var b = normalizeZeroPolicy({ zero_policy: policy, lifespan_months: months });
        if (a.zero_policy !== b.zero_policy) return true;
        return b.zero_policy === 'lifespan' && a.lifespan_months !== b.lifespan_months;
    }

    function loadZeroPolicy() {
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            _zeroPolicy = normalizeZeroPolicy(null);
            return Promise.resolve(_zeroPolicy);
        }
        return Promise.resolve(SB.from('program_settings').select('setting_value').eq('setting_key', ZERO_KEY))
            .then(function (r) {
                var raw = r && r.data && r.data[0] && r.data[0].setting_value;
                var parsed = null;
                if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = null; } }
                _zeroPolicy = normalizeZeroPolicy(parsed);
                _zeroPolicyAt = Date.now();
                return _zeroPolicy;
            }, function () {
                _zeroPolicy = normalizeZeroPolicy(null);
                return _zeroPolicy;
            });
    }

    function writeZeroPolicy(next) {
        var row = { setting_key: ZERO_KEY, setting_value: JSON.stringify(next) };
        var p = typeof persistProgramSettingRow === 'function' ? persistProgramSettingRow(row)
            : SB.from('program_settings').insert([row]);
        return Promise.resolve(p).then(function (r) {
            if (r && r.error) return { ok: false, error: r.error.message };
            _zeroPolicy = next;
            _zeroPolicyAt = Date.now();
            return { ok: true, policy: next };
        });
    }

    /** Admin only. Turning on year-end mid-year marks this year done, so the first clear is the coming 31 Dec. */
    function saveZeroPolicy(policy, months) {
        if (!couponAdmin()) return Promise.resolve({ ok: false, error: 'admin only' });
        var next = normalizeZeroPolicy(Object.assign({}, zeroPolicy(), { zero_policy: policy, lifespan_months: months }));
        if (next.zero_policy === 'year_end') next.last_year_end_zero_year = hkYear();
        if (next.zero_policy === 'lifespan') next.last_lifespan_run_at = null;
        return writeZeroPolicy(next);
    }

    function couponAdmin() {
        return String(typeof currentRole !== 'undefined' ? currentRole : '').toLowerCase() === 'admin';
    }

    function zeroSqlMissing(err) {
        return /dc_zero_coupons|dc_revert_zero_batch|discount_coupon_zero|schema cache|does not exist|PGRST20[25]/i.test(String(err || ''));
    }

    function zeroErrorText(err) {
        if (zeroSqlMissing(err)) return ct('coupons.zero.noSql', 'Set zero is not set up yet. Run discount_coupon_zero.sql in Supabase first.');
        return String(err || ct('coupons.zero.failed', 'Set zero failed.'));
    }

    /** opts: { all, clinicCodes, source, note, issuedBefore }. Resolves { ok, batch_id, coupons, value_cleared } or { ok:false, error }. */
    function zeroCoupons(opts) {
        opts = opts || {};
        var source = opts.source === 'year_end' || opts.source === 'lifespan' ? opts.source : 'manual';
        if (source === 'manual' && !couponAdmin()) return Promise.resolve({ ok: false, error: 'admin only' });
        var codes = (opts.clinicCodes || []).map(function (c) { return String(c || '').trim().toUpperCase(); }).filter(Boolean);
        if (!opts.all && !codes.length) return Promise.resolve({ ok: false, error: ct('coupons.zero.needClinic', 'Select All or at least one clinic.') });
        if (typeof SB === 'undefined' || !SB || typeof SB.rpc !== 'function') return Promise.resolve({ ok: false, error: 'Database not connected.' });
        return Promise.resolve(SB.rpc('dc_zero_coupons', {
            p_all: !!opts.all,
            p_clinic_codes: opts.all ? null : codes,
            p_created_by: actorName() || 'system',
            p_note: opts.note || 'Admin MANUAL SET ZERO - typed confirm',
            p_source: source,
            p_issued_before: opts.issuedBefore || null
        })).then(function (r) {
            if (r && r.error) return { ok: false, error: zeroErrorText(r.error.message) };
            var d = (r && r.data) || {};
            if (d.ok === false) return { ok: false, error: zeroErrorText(d.error) };
            var res = { ok: true, batch_id: d.batch_id || null, coupons: Number(d.coupons) || 0, value_cleared: round2(d.value_cleared), source: source };
            logCoupon('CANCEL', 'SET ZERO (' + source + ') ' + (opts.all ? 'all clinics' : codes.join(', ')) + ': ' + res.coupons +
                ' coupon(s), HK$' + res.value_cleared.toFixed(2) + (res.batch_id ? ' [batch ' + res.batch_id + ']' : ''), null, null);
            return res;
        }, function (e) { return { ok: false, error: zeroErrorText(e && e.message) }; });
    }

    function revertLastZero() {
        if (!couponAdmin()) return Promise.resolve({ ok: false, error: 'admin only' });
        return Promise.resolve(SB.rpc('dc_revert_zero_batch', { p_batch_id: null, p_created_by: actorName() || null })).then(function (r) {
            if (r && r.error) return { ok: false, error: zeroErrorText(r.error.message) };
            var d = (r && r.data) || {};
            if (d.ok === false) return { ok: false, error: zeroErrorText(d.error) };
            var res = { ok: true, batch_id: d.batch_id, coupons: Number(d.coupons) || 0 };
            logCoupon('RESTORE', 'Step back SET ZERO: ' + res.coupons + ' coupon(s) given back [batch ' + res.batch_id + ']', null, null);
            return res;
        }, function (e) { return { ok: false, error: zeroErrorText(e && e.message) }; });
    }

    function loadLastZeroBatch() {
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve({ ok: false, batch: null });
        return Promise.resolve(SB.from('discount_coupon_zero_batches')
            .select('id,created_at,source,scope_all,clinic_codes,coupons,value_cleared')
            .is('reverted_at', null).order('created_at', { ascending: false }).limit(1))
            .then(function (r) {
                if (r && r.error) return { ok: false, error: r.error.message, batch: null };
                return { ok: true, batch: (r && r.data && r.data[0]) || null };
            }, function (e) { return { ok: false, error: e && e.message, batch: null }; });
    }

    /** Runs a due year-end / lifespan clear once (the mark is saved first so two screens do not both run it). */
    function maybeRunScheduledZero() {
        var job = scheduledZeroJob(zeroPolicy(), new Date());
        if (!job) return Promise.resolve({ ok: true, skipped: true });
        return writeZeroPolicy(Object.assign({}, zeroPolicy(), job.mark)).then(function (w) {
            if (!w.ok) return { ok: false, skipped: true, error: w.error };
            return zeroCoupons({ all: true, source: job.source, note: job.note, issuedBefore: job.issuedBefore });
        });
    }

    function zeroCardHtml() {
        var pol = zeroPolicy();
        var admin = couponAdmin();
        var label = {
            manual: ct('rewards.cfg.zeroPolicyManual', 'Manual') + ' (' + ct('rewards.cfg.zeroPolicyDefault', 'default') + ')',
            year_end: ct('rewards.cfg.zeroPolicyYearEnd', 'Auto set zero every year on 31 Dec 23:59 (HK)'),
            lifespan: ct('coupons.zero.lifespan', 'Set each coupon’s life span to at most:')
        };
        var mo = ct('rewards.cfg.monthsShort', ' mo');
        var html = '<div class="dc-card rw-cfg-card--danger" id="dcZeroCard">' +
            '<div class="dc-card-title">' + esc(ct('coupons.zero.title', 'Set discount coupons to zero')) + '</div>' +
            '<p class="dc-hint" style="color:#7f1d1d;">' + esc(ct('coupons.zero.blurb',
                'Voids every unused coupon in the chosen clinics. Choose how coupons are cleared. Saving a policy change and Manual RESET ZERO need admin SMS + Google Authenticator. Every clear keeps a safety log so you can Step back.')) + '</p>';
        if (!admin) {
            var cur = pol.zero_policy === 'lifespan' ? label.lifespan + ' ' + pol.lifespan_months + mo : label[pol.zero_policy];
            return html + '<p class="dc-hint" style="color:#7f1d1d;">' + esc(ct('rewards.cfg.adminOnly', 'Only Admin can change this setting.')) +
                ' · ' + esc(cur) + '</p></div>';
        }
        html += '<div class="rw-zero-policy" role="radiogroup" aria-label="Zero policy">';
        ['manual', 'year_end', 'lifespan'].forEach(function (v) {
            html += '<label class="rw-zero-policy-opt"><input type="radio" name="dcZeroPolicy" value="' + v + '"' +
                (pol.zero_policy === v ? ' checked' : '') + '><span>' + esc(label[v]) + '</span></label>';
        });
        html += '</div><div id="dcLifespanWrap" class="rw-lifespan-months"' + (pol.zero_policy === 'lifespan' ? '' : ' hidden') + '>';
        ZERO_MONTHS.forEach(function (m) {
            html += '<button type="button" class="rw-lifespan-btn dc-life-btn' + (pol.lifespan_months === m ? ' is-active' : '') +
                '" data-months="' + m + '">' + m + esc(mo) + '</button>';
        });
        html += '</div>';
        html += '<p class="dc-hint">' + esc(ct('coupons.zero.lifeHint',
            'Life span clears unused coupons issued longer ago than the months picked, even if their own expiry is later. Year-end clears coupons issued before 1 Jan.')) + '</p>';
        html += '<div class="rw-reset-actions" style="margin:10px 0;align-items:center;"><button type="button" id="dcZeroPolicySave" class="btn btn--primary" style="padding:8px 14px;" disabled>' +
            esc(ct('common.save', 'Save')) + '</button>' +
            '<span id="dcZeroPolicyNote" class="dc-hint" style="margin:0;">' + esc(ct('coupons.zero.saveNeedsAuth',
                'Changing the set zero option needs the admin SMS code and the Google Authenticator code.')) + '</span></div>';
        html += '<div style="border-top:1px solid #fecaca;margin:12px 0 0;padding-top:12px;">' +
            '<div style="font-weight:700;margin-bottom:8px;font-size:13px;">' + esc(ct('rewards.cfg.resetZeroManualTitle', 'Manual RESET ZERO')) + '</div>' +
            '<p class="dc-hint" style="color:#7f1d1d;">' + esc(ct('coupons.zero.manualBlurb',
                'Requires admin SMS + Google Authenticator. Then pick clinics and type confirm to void their unused coupons.')) + '</p>' +
            '<div class="rw-reset-actions">' +
            '<button type="button" id="dcZeroReset" class="btn btn--danger" style="padding:8px 14px;">' + esc(ct('rewards.cfg.resetZeroBtn', 'RESET ZERO')) + '</button>' +
            '<button type="button" id="dcZeroStepBack" class="btn" style="padding:8px 14px;" disabled>' +
            esc(ct('coupons.zero.stepBack', 'Step back and give back the coupons of the last set zero')) + '</button></div>' +
            '<p id="dcZeroLastMeta" class="dc-hint" style="margin-top:10px;"></p></div>';
        return html + '</div>';
    }

    function wireZeroCard(pane) {
        var card = pane.querySelector('#dcZeroCard');
        if (!card || !couponAdmin()) return;
        function selPolicy() {
            var c = card.querySelector('input[name="dcZeroPolicy"]:checked');
            return c ? c.value : 'manual';
        }
        function selMonths() {
            var a = card.querySelector('.dc-life-btn.is-active');
            return a ? Number(a.getAttribute('data-months')) : 12;
        }
        var save = card.querySelector('#dcZeroPolicySave');
        function syncDirty() {
            if (save) save.disabled = !zeroPolicyChanged(zeroPolicy(), selPolicy(), selMonths());
        }
        card.querySelectorAll('input[name="dcZeroPolicy"]').forEach(function (r) {
            r.addEventListener('change', function () {
                var wrap = card.querySelector('#dcLifespanWrap');
                if (wrap) wrap.hidden = selPolicy() !== 'lifespan';
                syncDirty();
            });
        });
        card.querySelectorAll('.dc-life-btn').forEach(function (b) {
            b.addEventListener('click', function () {
                card.querySelectorAll('.dc-life-btn').forEach(function (x) { x.classList.toggle('is-active', x === b); });
                syncDirty();
            });
        });
        var rw = (typeof REWARDS !== 'undefined' && REWARDS) ? REWARDS : null;
        if (save) save.addEventListener('click', function () {
            var policy = selPolicy(), months = selMonths();
            if (!zeroPolicyChanged(zeroPolicy(), policy, months)) return;
            if (!rw || typeof rw.openAdminRewardAuthGate !== 'function') { alert(ct('coupons.zero.noGate', 'Admin verification is not available. Reload and try again.')); return; }
            rw.openAdminRewardAuthGate({
                title: ct('coupons.zero.policyAuthTitle', 'Verify to change the coupon zero policy'),
                keepOpen: false,
                onSuccess: function () {
                    saveZeroPolicy(policy, months).then(function (res) {
                        if (!res.ok) { alert(res.error || 'Save failed'); return; }
                        if (typeof toast === 'function') toast(ct('rewards.cfg.saved', 'Saved'));
                        paintConfig(pane);
                    });
                }
            });
        });
        var reset = card.querySelector('#dcZeroReset');
        if (reset) reset.addEventListener('click', function () {
            if (!rw || typeof rw.openResetZeroFlow !== 'function') { alert(ct('coupons.zero.noGate', 'Admin verification is not available. Reload and try again.')); return; }
            rw.openResetZeroFlow(configClinics(), {
                title: ct('coupons.zero.title', 'Set discount coupons to zero'),
                typeTitle: ct('coupons.zero.typeTitle', 'Type confirm to void coupons'),
                typeHint: ct('coupons.zero.typeHint', 'This voids every unused discount coupon issued at: {scope}. Type the word confirm below.'),
                wipeLabel: ct('coupons.zero.wipeBtn', 'Void coupons now'),
                running: ct('coupons.zero.running', 'Voiding coupons…'),
                run: function (sel) { return zeroCoupons({ all: sel.all, clinicCodes: sel.clinicCodes, source: 'manual' }); },
                doneText: function (res) {
                    return ct('coupons.zero.done', 'Voided {N} coupon(s), HK${V} face value.')
                        .replace('{N}', String(res.coupons || 0)).replace('{V}', round2(res.value_cleared).toFixed(2));
                },
                onDone: function () { renderConfigPane(pane); }
            });
        });
        var step = card.querySelector('#dcZeroStepBack');
        var meta = card.querySelector('#dcZeroLastMeta');
        loadLastZeroBatch().then(function (res) {
            if (!meta) return;
            var b = res && res.batch;
            if (!res.ok && zeroSqlMissing(res.error)) { meta.textContent = zeroErrorText(res.error); return; }
            if (!b) { meta.textContent = ct('coupons.zero.none', 'No set zero safety log to step back yet.'); return; }
            meta.textContent = ct('coupons.zero.lastMeta', 'Last safety log: {when} · {source} · {scope} · {N} coupon(s)')
                .replace('{when}', String(b.created_at || '').replace('T', ' ').slice(0, 16))
                .replace('{source}', String(b.source || 'manual'))
                .replace('{scope}', b.scope_all ? ct('rewards.cfg.resetZeroAll', 'All clinics') : (b.clinic_codes || []).join(', '))
                .replace('{N}', String(b.coupons || 0));
            if (step) step.disabled = false;
        });
        if (step) step.addEventListener('click', function () {
            if (!window.confirm(ct('coupons.zero.stepBackAsk', 'Give back the coupons voided by the last set zero?'))) return;
            step.disabled = true;
            revertLastZero().then(function (res) {
                if (!res.ok) { alert(res.error); step.disabled = false; return; }
                if (typeof toast === 'function') toast(ct('coupons.zero.stepBackDone', 'Gave back {N} coupon(s).').replace('{N}', String(res.coupons)));
                renderConfigPane(pane);
            });
        });
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

    /** Pure: friend's bill amounts shown on the referral ladder — the minimum, round steps, then the bill that reaches the max. */
    function referralLadderPoints(camp) {
        var min = parseFloat(camp && camp.minFirstSpend) || 0;
        var top = referralTopSpend(camp);
        var pts = [min > 0 ? min : 0];
        [1000, 2000, 5000].forEach(function (s) { if (s > pts[0] && (!top || s < top)) pts.push(s); });
        if (top && top > pts[pts.length - 1]) pts.push(top);
        return pts.filter(function (s) { return s > 0; });
    }

    function referralLadderHtml(camp) {
        if (!referralLadderOn(camp)) return '';
        var pts = referralLadderPoints(camp);
        if (!pts.length) return '';
        var top = pts[pts.length - 1] || 1;
        var lastAt = referralTopSpend(camp);
        var html = '<ol class="dc-ladder" aria-label="' + esc(ct('coupons.ref.ladder', 'Referral coupon ladder')) + '">';
        pts.forEach(function (s) {
            var h = 46 + Math.round(58 * s / top);
            html += '<li class="dc-rung' + (camp.enabled ? ' is-on' : ' is-off') + '" style="height:' + h + 'px">' +
                '<span class="dc-rung-get">+HK$' + referralCouponValue(camp, s).toFixed(0) + '</span>' +
                '<span class="dc-rung-spend">HK$' + round2(s).toFixed(0) + (lastAt && s >= lastAt ? '+' : '') + '</span></li>';
        });
        return html + '</ol>';
    }

    function referralCfgHint(camp) {
        if (!referralLadderOn(camp)) {
            return ct('coupons.ref.cfgHint',
                'The referrer gets this coupon as soon as the new patient has paid at least the minimum in cash on one bill — a full payment or a part payment both count (blank = any amount). Pick the referrer in “Referred by” on the patient form and choose this coupon or reward points (set in Reward Points configuration).');
        }
        return ct('coupons.ref.cfgHintLadder',
            'The referrer gets a cash coupon worth {P}% of the cash the new patient paid on the bill, once a bill of at least HK${MIN} is fully paid — the more the friend spends, the bigger the coupon, up to HK${MAX} (a HK${TOP} bill). Rounded down to HK${STEP}. Pick the referrer in “Referred by” on the patient form and choose this coupon or reward points (set in Reward Points configuration).')
            .split('{P}').join(String(round2(camp.refPercent)))
            .split('{MIN}').join(round2(camp.minFirstSpend || 0).toFixed(0))
            .split('{MAX}').join(round2(camp.refMax || 0).toFixed(0))
            .split('{TOP}').join(round2(referralTopSpend(camp)).toFixed(0))
            .split('{STEP}').join(round2(camp.refStep || 1).toFixed(0));
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
                'Only cash coupons stack. Spend, new-chart and referral coupons stay one per bill and are not combined with cash. Default: any number of cash coupons, up to HK$3,000 per bill, no % limit. If you also set a %, both limits apply and the smaller one wins. Leave a box blank to drop that limit. The percentage is of the whole bill before coupons.')) + '</p>' +
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
        var guide = (typeof REWARDS !== 'undefined' && REWARDS && typeof REWARDS.loyaltyGuideLinkHtml === 'function')
            ? REWARDS.loyaltyGuideLinkHtml('coupons') : '';
        html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
            '<h2 class="dc-title">' + esc(ct('coupons.cfg.title', 'Discount Coupons')) + '</h2>' + guide + '</div>';
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
            if (c.trigger === 'referral') {
                html += field(c.key, 'refPercent', ct('coupons.ref.pct', '% of the friend’s bill'), c.refPercent, true);
                html += field(c.key, 'refMax', ct('coupons.ref.max', 'Max coupon HK$'), c.refMax, true);
                html += field(c.key, 'refStep', ct('coupons.ref.step', 'Round down to HK$'), c.refStep, true);
                html += field(c.key, 'minFirstSpend', referralLadderOn(c)
                    ? ct('coupons.ref.minBill', 'Min bill HK$ (fully paid)')
                    : ct('coupons.ref.minFirst', 'Min first-visit payment HK$ (full or part payment)'), c.minFirstSpend, true);
                html += field(c.key, 'face', ct('coupons.ref.fixed', 'Fixed HK$ (when % is blank)'), c.face);
            } else {
                html += field(c.key, 'face', 'HK$', c.face);
            }
            if (c.mode === 'percent') html += field(c.key, 'percent', '%', c.percent);
            html += field(c.key, 'expiryDays', ct('coupons.cfg.expiry', 'Days'), c.expiryDays);
            html += field(c.key, 'maxDiscount', ct('coupons.cfg.ceiling', 'Ceiling'), c.maxDiscount);
            html += field(c.key, 'holdLimit', ct('coupons.cfg.hold', 'Hold up to'), holdLimitFor(c));
            html += limitFields(c);
            html += '</div>' + usageLine(c);
            if (c.key === 'cash') html += cashRulesHtml();
            if (c.trigger === 'referral') {
                html += '<div class="dc-ladder-wrap" id="dcRefLadder">' + referralLadderHtml(c) + '</div>';
                html += '<p class="dc-hint" id="dcRefHint">' + esc(referralCfgHint(c)) + '</p>';
            }
            if (c.scope === 'items') html += itemPickerHtml(c);
            html += '</div>';
        });
        html += '</div></div>';
        html += zeroCardHtml();
        html += '<div class="dc-card" id="dcRefCard"><div class="dc-card-title">' + esc(ct('coupons.ref.title', 'Referrals')) + '</div>' +
            '<p class="dc-hint">' + esc(ct('coupons.ref.listHint',
                'Each new patient with a referrer. Pending waits for the new patient’s qualifying bill (coupon: a bill of at least the minimum, fully paid; points: the minimum paid, full or part payment); blocked shows why no reward is given.')) + '</p>' +
            '<div class="dc-log-wrap" id="dcRefBody"></div></div>';
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
        wireZeroCard(pane);
        var go = document.getElementById('dcLogGo');
        if (go) go.onclick = function () { loadCouponLog(); };
        var csv = document.getElementById('dcLogCsv');
        if (csv) csv.onclick = downloadCouponLog;
        loadCouponLog();
        loadReferralList();
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
            if (camp.trigger === 'referral') {
                var refLadder = pane.querySelector('#dcRefLadder');
                if (refLadder) refLadder.innerHTML = referralLadderHtml(camp);
                var refHint = pane.querySelector('#dcRefHint');
                if (refHint) refHint.textContent = referralCfgHint(camp);
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
                var code = box.getAttribute('data-code');
                var panel = box.closest('.dc-panel') || pane;
                var boxes = [].slice.call(panel.querySelectorAll('.dc-doc-join')).filter(function (b) {
                    return b.getAttribute('data-code') === code;
                });
                var keys = boxes.map(function (b) { return b.getAttribute('data-doctor'); }).filter(function (k) { return k !== '__all__'; });
                setDoctorJoined(code, box.getAttribute('data-doctor'), box.checked, keys);
                boxes.forEach(function (b) { b.checked = doctorJoined(code, b.getAttribute('data-doctor')); });
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
            var earnedQ = SB.from('discount_coupons').select('id,campaign_key,face_value,expires_on,issued_at,status')
                .eq('origin_bill_id', bill.id);
            var walletP = bill.patient_id ? loadWallet(bill.patient_id) : Promise.resolve([]);
            var catP = ensureCatalog().then(function () {
                return (typeof treatmentItemsCache !== 'undefined' && treatmentItemsCache) || [];
            });
            return Promise.all([usedQ, earnedQ, billExcluded(bill.id), freshZeroPolicy(), walletP, catP]).then(function (res) {
                if (info.getAttribute('data-bill') !== billId) return;
                var used = (res[0] && res[0].data) || [];
                var excluded = !!res[2];
                var earned = applyZeroExpiry((res[1] && res[1].data) || [], res[3])
                    .filter(function (c) { return c.status !== 'void'; });
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
                if (excluded && !voided) {
                    lines.push('🚫 ' + excludedText());
                } else if (!voided && !earned.length && doctorIn) {
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
                if (!voided) {
                    var fit = matchingItemCoupons(res[4] || [], parseItems(bill), todayIso(), res[5] || []);
                    if (fit.length) {
                        lines.push('🦷 ' + ct('coupons.info.itemFit', 'Treatment coupons that fit this bill') + ': ' +
                            fit.map(function (c) { return campLabel(c); }).join(' · '));
                    }
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

    /** Resolves true when the clinic now in use is in the coupon scheme. */
    function walletAvailable(clinicCode) {
        var code = clinicCode != null ? clinicCode : clinicCodeNow();
        return loadState().then(function () { return !!code && clinicJoined(code); }, function () { return false; });
    }

    /** Pure: wallet rows for the patient ledger tab — live coupons (soonest expiry first) and history (newest first). */
    function walletLedgerRows(wallet, today) {
        today = today || todayIso();
        var live = [];
        var history = [];
        (wallet || []).forEach(function (c) {
            if (isLive(c, today)) { live.push(c); return; }
            var state = c.status === 'used' ? 'used' : c.status === 'void' ? 'void' : c.status === 'unused' ? 'expired' : String(c.status || '');
            history.push({ coupon: c, state: state, at: String((state === 'used' && c.redeemed_at) || c.issued_at || '') });
        });
        live.sort(function (a, b) {
            var x = String(a.expires_on || '9999'), y = String(b.expires_on || '9999');
            return x < y ? -1 : x > y ? 1 : 0;
        });
        history.sort(function (a, b) { return a.at < b.at ? 1 : a.at > b.at ? -1 : 0; });
        return { live: live, history: history };
    }

    function walletCardHtml(c, today) {
        var w = walletCoupon(c);
        var slot = couponSlot(w);
        return '<div class="dc-card dc-ticket dc-wcard" data-kind="' + kindOf(w) + '" data-id="' + esc(w.id) + '">' +
            stubHtml(w) +
            '<span class="dc-body"><strong>' + esc(campLabel(w)) + '</strong>' +
            '<small>' + esc(slot === 'items' ? ct('coupons.bill.slotItems', '治療券') : ct('coupons.bill.slotBill', '全單券')) +
            (w.code ? ' · ' + esc(w.code) : '') + (c.clinic_code ? ' · ' + esc(c.clinic_code) : '') +
            (c.household_no ? ' · #' + esc(c.household_no) : '') + '</small>' +
            '<span class="dc-meta">' + expiryChipHtml(w.expires_on, today) + '</span></span></div>';
    }

    function walletStateLabel(state) {
        if (state === 'used') return ct('coupons.wl.used', 'Used');
        if (state === 'void') return ct('coupons.wl.void', 'Cancelled');
        if (state === 'expired') return ct('coupons.reason.expired', '已過期');
        return state;
    }

    function loadPatientNo(patientId) {
        if (!patientId || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve('');
        return Promise.resolve(SB.from('patients').select('patient_no').eq('id', patientId).maybeSingle())
            .then(function (r) { return (r && r.data && r.data.patient_no) || ''; }, function () { return ''; });
    }

    /** Pure: the bill behind a history row — the bill it was used on, else the bill that issued it. */
    function walletHistoryBillId(c) {
        return String((c && (c.bill_id || c.origin_bill_id)) || '');
    }

    function walletBillDoctor(b) {
        var docs = (typeof APP_DOCTORS !== 'undefined' && APP_DOCTORS) || [];
        if (typeof DoctorAliases !== 'undefined' && DoctorAliases && typeof DoctorAliases.resolveFromBill === 'function') {
            try {
                var lab = String((DoctorAliases.resolveFromBill(b, docs) || {}).label || '').trim();
                if (lab && lab !== '—') return lab;
            } catch (e) { /* fall back to the bill text */ }
        }
        var name = String(b.doctor_name || '').trim();
        if (name) return name;
        for (var i = 0; i < docs.length; i++) {
            if (b.doctor_id && String(docs[i].id) === String(b.doctor_id)) {
                return String(docs[i].english_name || docs[i].chinese_name || '').trim();
            }
        }
        return '';
    }

    /** Clinic and doctor of each history row's bill: { billId: { clinic, doctor } }. {} when the lookup fails. */
    function loadWalletBillMeta(history) {
        var ids = [];
        (history || []).forEach(function (h) {
            var id = walletHistoryBillId(h.coupon);
            if (id && ids.indexOf(id) < 0) ids.push(id);
        });
        if (!ids.length || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve({});
        return Promise.resolve(SB.from('bills').select('id,clinic_tag,doctor_id,doctor_name').in('id', ids))
            .then(function (r) {
                var map = {};
                ((r && r.data) || []).forEach(function (b) {
                    map[String(b.id)] = { clinic: String(b.clinic_tag || '').trim(), doctor: walletBillDoctor(b) };
                });
                return map;
            }, function () { return {}; });
    }

    /** Pure: coupons in a wallet that may move to another chart (live, and not new-chart / referral). */
    function walletTransferable(wallet, today) {
        return (wallet || []).filter(function (c) {
            return isLive(c, today) && !c.household_id && !LOCKED_TRANSFER_KEYS[c.campaign_key];
        });
    }

    /**
     * Discount coupon wallet inside the patient's reward ledger panel: the Choose sheet without a bill.
     * Wallet (browse, instead of Use) · Gift · Transfer. opts: { tab: 'wallet' | 'gift' | 'transfer' }.
     */
    function renderWalletPane(el, patientId, opts) {
        if (!el) return Promise.resolve(false);
        opts = opts || {};
        ensureCss();
        el.innerHTML = '<p class="dc-hint">' + esc(ct('common.loadingEllipsis', 'Loading…')) + '</p>';
        var token = {};
        el.__dcWalletToken = token;
        return Promise.all([loadState().then(loadUsage), loadWallet(patientId, { household: true }), loadPatientNo(patientId)]).then(function (res) {
            return loadWalletBillMeta(walletLedgerRows(res[1] || []).history).then(function (meta) { return res.concat([meta]); });
        }).then(function (res) {
            if (el.__dcWalletToken !== token) return false;
            var wallet = res[1] || [];
            var patientNo = res[2] || '';
            var billMeta = res[3] || {};
            var today = todayIso();
            var rows = walletLedgerRows(wallet, today);
            var tab = opts.tab === 'gift' || opts.tab === 'transfer' ? opts.tab : 'wallet';
            function hiddenUnless(on) { return on ? '' : ' hidden'; }
            var html = '<div class="dc-wl">';
            html += '<div class="dc-wsum-row">' + walletSummaryHtml(wallet, today) +
                (patientId ? '<button type="button" class="dc-wqr-btn" data-dc-wallet-qr="1" data-no-click-guard="1">📱 ' +
                    esc(ct('coupons.wqr.btn', 'Wallet QR')) + '</button>' : '') +
                ((typeof REWARDS !== 'undefined' && REWARDS && typeof REWARDS.loyaltyGuideLinkHtml === 'function')
                    ? REWARDS.loyaltyGuideLinkHtml('coupons') : '') + '</div>';
            html += '<div class="dc-stabs dc-wl-tabs" role="tablist">';
            [
                ['wallet', ct('coupons.tab.wallet', 'Wallet'), rows.live.length],
                ['gift', ct('coupons.tab.gift', 'Gift'), null],
                ['transfer', ct('coupons.tab.transfer', 'Transfer'), null]
            ].forEach(function (t) {
                html += '<button type="button" role="tab" class="dc-stab' + (t[0] === tab ? ' is-on' : '') + '" data-wl-tab="' + t[0] +
                    '" aria-selected="' + (t[0] === tab) + '">' + esc(t[1]) +
                    (t[2] != null ? ' <span class="dc-stab-n">' + t[2] + '</span>' : '') + '</button>';
            });
            html += '</div>';
            html += '<section class="dc-spanel" role="tabpanel" data-wl-panel="wallet"' + hiddenUnless(tab === 'wallet') + '>';
            var hasHh = wallet.some(function (c) { return c.household_id; });
            html += '<p class="dc-hint">' + esc(hasHh
                ? ct('coupons.wl.hintHousehold', 'This chart and other charts of the same person. Use a coupon from that patient’s bill. Household coupons stay on their own chart.')
                : ct('coupons.wl.hint', 'Browse only. To use a coupon, open the patient’s bill and press Choose.')) + '</p>';
            html += '<h4 class="dc-wl-h">' + esc(ct('coupons.wl.live', 'Unused coupons')) + ' <span class="dc-stab-n">' + rows.live.length + '</span></h4>';
            html += rows.live.length
                ? '<div class="dc-cards dc-wl-cards">' + rows.live.map(function (c) { return walletCardHtml(c, today); }).join('') + '</div>'
                : '<p class="dc-empty">' + esc(ct('coupons.bill.empty', 'This patient has no unused coupons.')) + '</p>';
            html += '<h4 class="dc-wl-h">' + esc(ct('coupons.wl.history', 'Used, cancelled and expired')) + ' <span class="dc-stab-n">' + rows.history.length + '</span></h4>';
            if (!rows.history.length) {
                html += '<p class="dc-hint">' + esc(ct('coupons.wl.noHistory', 'No used, cancelled or expired coupons yet.')) + '</p>';
            } else {
                html += '<div class="dc-log-wrap"><table class="dc-log dc-wl-table"><thead><tr>' +
                    '<th>' + esc(ct('coupons.wl.when', 'When')) + '</th>' +
                    '<th>' + esc(ct('coupons.wl.clinic', 'Clinic')) + '</th>' +
                    '<th>' + esc(ct('coupons.wl.doctor', 'Dr')) + '</th>' +
                    '<th>' + esc(ct('coupons.wl.coupon', 'Coupon')) + '</th>' +
                    '<th class="dc-wl-num">' + esc(ct('coupons.wl.value', 'Value')) + '</th>' +
                    '<th>' + esc(ct('coupons.wl.status', 'Status')) + '</th>' +
                    '<th>' + esc(ct('coupons.wl.note', 'Note')) + '</th></tr></thead><tbody>';
                rows.history.forEach(function (h) {
                    var c = h.coupon;
                    var w = walletCoupon(c);
                    var val = h.state === 'used' && c.redeemed_amount != null
                        ? '−HK$' + round2(c.redeemed_amount).toFixed(2) : faceText(w);
                    var bm = billMeta[walletHistoryBillId(c)] || {};
                    var clinic = bm.clinic || c.clinic_code || '';
                    var note = c.note || (h.state === 'expired' && c.expires_on ? String(c.expires_on).slice(0, 10) : '');
                    var stamp = h.at.replace('T', ' ');
                    html += '<tr data-state="' + esc(h.state) + '">' +
                        '<td class="dc-wl-when"><span class="dc-wl-date">' + esc(stamp.slice(0, 10)) + '</span>' +
                        '<span class="dc-wl-time">' + esc(stamp.slice(11, 16)) + '</span></td>' +
                        '<td>' + (clinic ? '<span class="dc-wl-clinic">' + esc(clinic) + '</span>' : '—') + '</td>' +
                        '<td class="dc-wl-dr" title="' + esc(bm.doctor || '') + '">' + esc(bm.doctor || '—') + '</td>' +
                        '<td class="dc-wl-coupon">' + esc(campLabel(w)) + (c.code ? '<small class="dc-wl-code">' + esc(c.code) + '</small>' : '') +
                        (c.household_no ? '<small class="dc-wl-hh">#' + esc(c.household_no) + '</small>' : '') + '</td>' +
                        '<td class="dc-wl-num dc-wl-val">' + esc(val) + '</td>' +
                        '<td class="dc-wl-state"><span class="dc-wl-badge">' + esc(walletStateLabel(h.state)) + '</span></td>' +
                        '<td class="dc-wl-note" title="' + esc(note) + '">' + esc(note) + '</td></tr>';
                });
                html += '</tbody></table></div>';
            }
            html += '</section>';

            var lockNote = '<p class="dc-lock-note">🔒 ' + esc(ct('coupons.auth.needed',
                'Asks for your own login and password, then records it in the coupon log.')) + '</p>';
            var giftChoices = campaigns().filter(function (c) {
                return c && c.trigger === 'manual' && c.enabled && !AUTO_GRANT_KEYS[c.key];
            });
            html += '<section class="dc-spanel" role="tabpanel" data-wl-panel="gift"' + hiddenUnless(tab === 'gift') + '>';
            html += '<div class="dc-gift"><label>' + esc(ct('coupons.grant.title', 'Gift a coupon into this wallet')) + '</label>' +
                '<p class="dc-hint">' + esc(ct('coupons.grant.hintWallet', 'Cash and treatment coupons that are switched on. The coupon is stored unused in the wallet until someone chooses it on a bill.')) + '</p>';
            if (!giftChoices.length) {
                html += '<p class="dc-hint">' + esc(ct('coupons.grant.none', 'Turn a cash or treatment coupon on in Configuration before gifting.')) + '</p>';
            } else {
                html += '<div class="dc-gift-row"><select data-wl="giftKind">';
                giftChoices.forEach(function (c) {
                    html += '<option value="' + esc(c.key) + '">' + esc(campLabel(c)) + '</option>';
                });
                html += '</select><input type="number" data-wl="giftAmount" min="1" max="' + CASH_GRANT_MAX + '" step="1" value="100">' +
                    '<button type="button" data-wl="giftGo">🔒 ' + esc(ct('coupons.grant.go', 'Gift to wallet')) + '</button></div>' +
                    '<p data-wl="giftOffer" class="dc-hint"></p>';
            }
            html += '<p data-wl="giftErr" class="dc-err" hidden></p>' + lockNote + '</div></section>';

            var movable = walletTransferable(wallet, today);
            html += '<section class="dc-spanel" role="tabpanel" data-wl-panel="transfer"' + hiddenUnless(tab === 'transfer') + '>';
            html += '<div class="dc-transfer"><label>' + esc(ct('coupons.xfer.which', 'Coupon to transfer')) + '</label>';
            if (!movable.length) {
                html += '<p class="dc-hint">' + esc(ct('coupons.xfer.noneMovableWallet',
                    'No coupon here can be transferred. Expired coupons, and new-chart or referral coupons, stay with this patient.')) + '</p>';
            }
            html += '<select data-wl="xferPick"' + (movable.length ? '' : ' disabled') + '>';
            movable.forEach(function (c) {
                var w = walletCoupon(c);
                html += '<option value="' + esc(String(c.id)) + '">' +
                    esc(campLabel(w) + ' · ' + faceText(w) + (c.expires_on ? ' · ' + c.expires_on : '')) + '</option>';
            });
            html += '</select><label>' + esc(ct('coupons.xfer.toChart', 'To chart no.')) + '</label>' +
                '<div class="dc-xfer-row"><input type="text" data-wl="xferTo" autocomplete="off">' +
                '<button type="button" data-wl="xferGo"' + (movable.length ? '' : ' disabled') + '>🔒 ' +
                esc(ct('coupons.xfer.go', 'Transfer')) + '</button></div>' +
                '<p data-wl="xferErr" class="dc-err" hidden></p>' + lockNote + '</div></section>';
            html += '</div>';
            el.innerHTML = html;

            function q(name) { return el.querySelector('[data-wl="' + name + '"]'); }
            var overlayHost = el.closest('.modal') || document.body;
            var qr = el.querySelector('[data-dc-wallet-qr]');
            if (qr) qr.addEventListener('click', function () {
                openPhoneQr(overlayHost, patientId, couponQrConfig());
            });
            function setTab(name) {
                tab = name;
                el.querySelectorAll('[data-wl-tab]').forEach(function (b) {
                    var on = b.getAttribute('data-wl-tab') === name;
                    b.classList.toggle('is-on', on);
                    b.setAttribute('aria-selected', on ? 'true' : 'false');
                });
                el.querySelectorAll('[data-wl-panel]').forEach(function (p) {
                    p.hidden = p.getAttribute('data-wl-panel') !== name;
                });
            }
            el.querySelectorAll('[data-wl-tab]').forEach(function (b) {
                b.addEventListener('click', function () { setTab(b.getAttribute('data-wl-tab')); });
            });
            function again(nextTab) {
                return renderWalletPane(el, patientId, { tab: nextTab });
            }
            var patientLabel = patientNo || ct('coupons.auth.thisPatient', 'this patient');
            function loggedText(grantor, logged) {
                if (logged === false) return ' ⚠️ ' + ct('coupons.notice.logFail', 'The coupon log entry could not be saved — tell the admin.');
                return ' ' + ct('coupons.notice.loggedUnder', 'Logged under') + ' ' + (grantorName(grantor) || '—') + '.';
            }

            var giftKind = q('giftKind');
            function syncGiftOffer() {
                if (!giftKind) return;
                var camp = campaignByKey(giftKind.value);
                var amt = q('giftAmount');
                var cash = !!(camp && camp.key === 'cash');
                if (amt) amt.hidden = !cash;
                var offer = q('giftOffer');
                if (offer) offer.textContent = camp ? giftOfferText(camp) : '';
            }
            if (giftKind) giftKind.onchange = syncGiftOffer;
            syncGiftOffer();
            var giftGo = q('giftGo');
            if (giftGo) giftGo.onclick = function () {
                var err = q('giftErr');
                if (err) { err.hidden = true; err.textContent = ''; }
                var kind = giftKind ? giftKind.value : '';
                var amt = (q('giftAmount') || {}).value;
                var camp = campaignByKey(kind) || {};
                var isCash = camp.key === 'cash';
                if (isCash && !((parseFloat(amt) || 0) >= 1 && (parseFloat(amt) || 0) <= CASH_GRANT_MAX)) {
                    if (err) { err.hidden = false; err.textContent = grantReason('amount'); }
                    return;
                }
                var what = (campLabel(camp.key ? camp : null) || kind) + (isCash ? ' HK$' + round2(amt).toFixed(0) : '') + ' → ' + patientLabel;
                var grantor = null;
                giftGo.disabled = true;
                promptGrantor(overlayHost, ct('coupons.auth.giftTitle', 'Confirm gift'), what).then(function (user) {
                    if (!user) return null;
                    grantor = user;
                    return grantToWallet(patientId, kind, amt, patientNo, grantor);
                }).catch(function (e) {
                    return { ok: false, error: String(e && e.message || e) };
                }).then(function (res) {
                    giftGo.disabled = false;
                    if (res === null) return;
                    if (!res || !res.ok) {
                        if (err) { err.hidden = false; err.textContent = grantReason((res && (res.reason || res.error)) || ''); }
                        return;
                    }
                    couponNotice('🎁 ' + what + ' — ' + ct('coupons.notice.giftedOk', 'added to the wallet.') + loggedText(grantor, res.logged));
                    again('gift');
                });
            };

            var xferGo = q('xferGo');
            if (xferGo) xferGo.onclick = function () {
                var err = q('xferErr');
                function showErr(msg) {
                    if (!err) return;
                    err.hidden = !msg;
                    err.textContent = msg || '';
                }
                var pickEl = q('xferPick');
                var chosen = pickEl && pickEl.value ? movable.filter(function (c) { return String(c.id) === pickEl.value; })[0] : null;
                if (!chosen) { showErr(ct('coupons.xfer.pick', 'Select a coupon first')); return; }
                var chart = String((q('xferTo') || {}).value || '').trim();
                if (!chart) { showErr(ct('coupons.xfer.need', 'Enter a chart number')); return; }
                showErr('');
                xferGo.disabled = true;
                function done(msg) {
                    xferGo.disabled = false;
                    if (msg) showErr(msg);
                }
                resolveReferrer(chart).then(function (to) {
                    if (!to) { done(ct('coupons.xfer.missing', 'Chart not found')); return null; }
                    if (String(to.id) === String(patientId)) { done(grantReason('same_patient')); return null; }
                    var w = walletCoupon(chosen);
                    var what = campLabel(w) + ' ' + faceText(w) + (chosen.code ? ' (' + chosen.code + ')' : '') +
                        ' · ' + patientLabel + ' → ' + (to.patient_no || chart);
                    return promptGrantor(overlayHost, ct('coupons.auth.xferTitle', 'Confirm transfer'), what).then(function (user) {
                        if (!user) { done(''); return null; }
                        return transferSelected(chosen, to, patientNo, user).then(function (res) {
                            if (!res || !res.ok) {
                                done(res && res.reason ? grantReason(res.reason) : ((res && res.error) || 'Transfer failed'));
                                return null;
                            }
                            done('');
                            couponNotice('↔ ' + what + loggedText(user, res.logged));
                            again('transfer');
                            return null;
                        });
                    });
                }).catch(function (e) { done(String(e && e.message || e)); });
            };
            return true;
        }, function () {
            if (el.__dcWalletToken !== token) return false;
            el.innerHTML = '<p class="dc-err">' + esc(ct('coupons.wl.fail', 'Could not load the coupon wallet.')) + '</p>';
            return false;
        });
    }

    function loadWallet(patientId, opts) {
        if (!patientId || typeof SB === 'undefined' || !SB) return Promise.resolve([]);
        opts = opts || {};
        var idsP = opts.household ? householdPatientIds(patientId) : Promise.resolve([patientId]);
        return idsP.then(function (ids) {
            if (!ids || !ids.length) ids = [patientId];
            var coupQ = ids.length === 1
                ? SB.from('discount_coupons').select('*').eq('patient_id', ids[0])
                : SB.from('discount_coupons').select('*').in('patient_id', ids);
            var nosQ = (opts.household && ids.length > 1)
                ? SB.from('patients').select('id,patient_no').in('id', ids)
                : Promise.resolve({ data: [] });
            return Promise.all([
                coupQ.then(function (r) { return (r && r.data) || []; }, function () { return []; }),
                freshZeroPolicy(),
                nosQ.then(function (r) {
                    var map = {};
                    ((r && r.data) || []).forEach(function (p) {
                        map[String(p.id)] = String(p.patient_no || '').trim();
                    });
                    return map;
                }, function () { return {}; })
            ]).then(function (both) {
                var rows = both[0].slice().sort(function (a, b) {
                    return String(a.issued_at || '').localeCompare(String(b.issued_at || '')) || String(a.code || '').localeCompare(String(b.code || ''));
                });
                rows = applyZeroExpiry(rows, both[1]);
                if (opts.household) rows = tagHouseholdCoupons(rows, patientId, both[2]);
                return rows;
            });
        });
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
     * opts.verify(uid, pw) replaces the login check (resolve { ok, user } or { ok: false, reason, message });
     * opts.hint / opts.logText replace the coupon wording.
     */
    function promptGrantor(host, title, summary, opts) {
        opts = opts || {};
        var verify = typeof opts.verify === 'function' ? opts.verify : verifyGrantor;
        return new Promise(function (resolve) {
            var sheet = host && (host.querySelector('.dc-sheet') || (host.nodeType === 1 && host.id !== 'dcSheetHost' ? host : null));
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
                '<p class="dc-hint">' + esc(opts.hint || ct('coupons.auth.hint',
                    'Gifting or transferring a coupon needs your own login and password. The shared Nurse login cannot be used.')) + '</p>' +
                '<label class="dc-authp-field"><span>' + esc(ct('coupons.auth.user', 'Login ID')) + '</span>' +
                '<input type="text" id="dcAuthUser" autocomplete="off" spellcheck="false" value="' + esc(prefill) + '"></label>' +
                '<label class="dc-authp-field"><span>' + esc(ct('coupons.auth.pw', 'Password')) + '</span>' +
                '<input type="password" id="dcAuthPw" autocomplete="new-password"></label>' +
                '<p class="dc-err" id="dcAuthErr" hidden></p>' +
                '<p class="dc-hint dc-authp-log">' + esc(opts.logText || ct('coupons.auth.logged', 'This will be recorded in the coupon log under your login.')) + '</p>' +
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
            wrap.addEventListener('keydown', function (ev) {
                if (ev.key !== 'Escape') return;
                ev.preventDefault();
                ev.stopPropagation();
                finish(null);
            });
            form.addEventListener('submit', function (ev) {
                ev.preventDefault();
                if (done) return;
                err.hidden = true;
                go.disabled = true;
                var pw = p.value;
                p.value = '';
                Promise.resolve().then(function () { return verify(u.value, pw); }).catch(function (e) {
                    return { ok: false, message: String((e && e.message) || e) };
                }).then(function (auth) {
                    if (done) return;
                    go.disabled = false;
                    if (auth && auth.ok) { finish(auth.user || auth); return; }
                    err.hidden = false;
                    err.textContent = (auth && auth.message) || grantReason(auth && auth.reason);
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
    function walletPageBase(loc, savedBase, page) {
        var file = page || 'wallet.html';
        var saved = String(savedBase || '').trim();
        if (saved && /scan\.html/i.test(saved)) return saved.replace(/scan\.html.*$/i, file);
        var href = String((loc && loc.href) || '').split('#')[0].split('?')[0];
        var i = href.lastIndexOf('/');
        return (i >= 0 ? href.slice(0, i + 1) : href + '/') + file;
    }

    function walletUrl(token, base, page) {
        var b = base || walletPageBase(typeof location !== 'undefined' ? location : null, savedPhoneBase(), page);
        return b + (b.indexOf('?') >= 0 ? '&' : '?') + 't=' + encodeURIComponent(token);
    }

    function savedPhoneBase() {
        try { return (window.localStorage && localStorage.getItem(PHONE_BASE_KEY)) || ''; } catch (e) { return ''; }
    }

    /**
     * The patient's current phone page link for an SMS ('' when it cannot be made in time or only works on this
     * computer). Never resets the link, so a QR the patient already holds keeps working.
     */
    function phoneLinkForSms(patientId, rpc, page, waitMs) {
        if (!patientId) return Promise.resolve('');
        var link = walletLinkToken(patientId, false, rpc).then(function (res) {
            if (!res || !res.ok || !res.token) return '';
            var url = walletUrl(res.token, '', page);
            return isLocalAddress(url) ? '' : url;
        }, function () { return ''; });
        var late = new Promise(function (resolve) { setTimeout(function () { resolve(''); }, waitMs || 5000); });
        return Promise.race([link, late]);
    }

    /** Pure: the SMS with the phone page link added as its last line. scheme: 'loyalty' | 'coupons' | 'rewards'. */
    function smsWithPhoneLink(body, url, scheme) {
        if (!body || !url) return body;
        var label = scheme === 'rewards'
            ? '手機查看積分/See your points on the phone: '
            : (scheme === 'coupons'
                ? '手機查看優惠券/See your coupons on the phone: '
                : '手機查看積分及優惠券/See your points and coupons on the phone: ');
        return body + '\n' + label + url;
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

    /** Pure: a failed dc_wallet_link call. Only a missing dc_wallet_link is "not set up"; anything else keeps the database message. */
    function walletLinkError(err, rpc) {
        var msg = String((err && (err.message || err.details || err.hint)) || (typeof err === 'string' ? err : '') || '').trim();
        var missing = msg.toLowerCase().indexOf(String(rpc || 'dc_wallet_link').toLowerCase()) >= 0 &&
            /schema cache|does not exist|could not find/i.test(msg);
        return { ok: false, reason: missing ? 'no_sql' : 'db', detail: msg };
    }

    function walletLinkToken(patientId, reset, rpc) {
        var fn = rpc || 'dc_wallet_link';
        if (typeof SB === 'undefined' || !SB || typeof SB.rpc !== 'function') return Promise.resolve({ ok: false, reason: 'no_db' });
        return Promise.resolve(SB.rpc(fn, { p_patient_id: patientId, p_by: actorName() || null, p_reset: !!reset }))
            .then(function (r) {
                if (r && r.error) return walletLinkError(r.error, fn);
                var d = r && r.data;
                if (d && d.ok === false) return { ok: false, reason: d.reason === 'no_patient' ? 'no_patient' : 'db', detail: String(d.reason || '') };
                return d || { ok: false, reason: 'db', detail: 'empty reply' };
            }, function (e) { return { ok: false, reason: 'offline', detail: String((e && e.message) || e || '') }; });
    }

    /** Draw through the Tools QR generator; the module's own loader is only a fallback. */
    function drawWalletQr(codeEl, url, label, altText) {
        var alt = altText || ct('coupons.wqr.title', 'Coupon wallet on the phone');
        if (typeof QRTOOL !== 'undefined' && QRTOOL && typeof QRTOOL.draw === 'function') {
            return QRTOOL.draw(codeEl, url, { size: 220, fg: '#0f172a', bg: '#ffffff', label: label, labelColor: '#166534', alt: alt });
        }
        return loadQrLib().then(function (QR) {
            codeEl.innerHTML = '';
            new QR(codeEl, { text: url, width: 220, height: 220, colorDark: '#0f172a', colorLight: '#ffffff', correctLevel: QR.CorrectLevel.M });
            var c = codeEl.querySelector('canvas');
            var dataUrl = '';
            try { dataUrl = c ? c.toDataURL('image/png') : ''; } catch (e) { dataUrl = ''; }
            return { ok: true, canvas: c, dataUrl: dataUrl };
        }, function () { return { ok: false, reason: 'lib' }; });
    }

    /** Pure: printable slip for the patient (QR, masked name, clinic). */
    function walletSlipHtml(dataUrl, info) {
        info = info || {};
        var heading = info.heading || ct('coupons.wqr.slipTitle', '我的優惠券 My coupons');
        var tip = info.tip || ct('coupons.wqr.slipTip', '用手機相機掃描，即可查看你的優惠券。 Scan with the phone camera to see your coupons.');
        return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(info.title || ct('coupons.wqr.title', 'Coupon wallet on the phone')) + '</title>' +
            '<style>body{font-family:"Segoe UI","Microsoft JhengHei","PingFang TC",sans-serif;margin:24px;color:#0f172a;}' +
            '.slip{width:300px;margin:0 auto;padding:18px;border:2px dashed #86efac;border-radius:14px;text-align:center;}' +
            '.slip h1{font-size:14px;margin:0 0 4px;}.slip h2{font-size:17px;margin:0 0 12px;color:#166534;}' +
            '.slip img{width:220px;height:220px;display:block;margin:0 auto 10px;}' +
            '.who{font-size:15px;font-weight:700;margin:0 0 4px;}.tip{font-size:12px;color:#475569;margin:6px 0 0;line-height:1.45;}' +
            '@media print{body{margin:0;}.slip{border-color:#94a3b8;}}</style></head><body><div class="slip">' +
            '<h1>' + esc(SMS_HEADING.replace(/^\[|\]$/g, '')) + '</h1>' +
            '<h2>📱 ' + esc(heading) + '</h2>' +
            '<img src="' + esc(dataUrl) + '" alt="QR">' +
            (info.who ? '<p class="who">' + esc(info.who) + '</p>' : '') +
            '<p class="tip">' + esc(tip) + '</p>' +
            '<p class="tip">' + esc(ct('coupons.wqr.slipKeep', '請勿轉發此二維碼。 Please do not share this QR code.')) + '</p>' +
            '</div></body></html>';
    }

    /** Pure: WhatsApp message to the patient with their wallet link (staff press Send in WhatsApp). */
    function walletWhatsAppText(url, p) {
        var zh = String((p && (p.chinese_name || p.full_name)) || '').trim();
        var en = String((p && (p.full_name || p.chinese_name)) || '').trim();
        return SMS_HEADING + '\n' +
            (zh ? zh + ' ' : '') + '你好！按以下連結即可在手機查看你的優惠券：\n' +
            'Hi' + (en ? ' ' + en : '') + '! Tap the link below to see your coupons on your phone:\n' +
            String(url || '') + '\n' +
            '請勿轉發此連結。Please do not share this link.';
    }

    function loadWalletPatient(patientId) {
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve(null);
        return Promise.resolve(SB.from('patients').select('patient_no,chinese_name,full_name,phone_number').eq('id', patientId).maybeSingle())
            .then(function (r) { return (r && !r.error && r.data) || null; }, function () { return null; });
    }

    /** The coupon wallet set-up of the phone QR box; other schemes pass their own (see openPhoneQr). */
    function couponQrConfig() {
        return {
            scheme: 'coupons',
            rpc: 'dc_wallet_link',
            page: 'wallet.html',
            pngName: 'coupon-wallet-qr.png',
            title: ct('coupons.wqr.title', 'Coupon wallet on the phone'),
            hint: ct('coupons.wqr.hint',
                'Ask the patient to scan this with the phone camera. They can browse their coupons only — nothing can be used, added or removed from the phone.'),
            linkLabel: ct('coupons.wqr.link', 'Wallet link'),
            centre: ct('coupons.wqr.centre', '優惠券'),
            noSql: ct('coupons.wqr.noSql', 'The phone wallet is not set up yet. Run discount_coupon_wallet.sql in Supabase first.'),
            fail: ct('coupons.wqr.fail', 'Could not make the wallet link. Try again.'),
            slip: {},
            waText: walletWhatsAppText
        };
    }

    /** Pure: one phone page for points and coupons. Either token may be missing (that tab then explains). */
    function loyaltyUrl(couponToken, pointsToken, base) {
        var b = base || walletPageBase(typeof location !== 'undefined' ? location : null, savedPhoneBase(), 'loyalty.html');
        var q = [];
        if (couponToken) q.push('c=' + encodeURIComponent(couponToken));
        if (pointsToken) q.push('p=' + encodeURIComponent(pointsToken));
        return b + (b.indexOf('?') >= 0 ? '&' : '?') + q.join('&');
    }

    /** Both phone links for one chart; works when only one scheme's SQL has been run. */
    function loyaltyLink(patientId, reset) {
        return Promise.all([
            walletLinkToken(patientId, reset, 'dc_wallet_link'),
            walletLinkToken(patientId, reset, 'rw_wallet_link')
        ]).then(function (r) {
            var c = r[0] && r[0].ok && r[0].token ? r[0].token : '';
            var p = r[1] && r[1].ok && r[1].token ? r[1].token : '';
            if (!c && !p) return r[0] && r[0].reason !== 'no_sql' ? r[0] : r[1];
            return { ok: true, url: loyaltyUrl(c, p), coupons: !!c, points: !!p };
        });
    }

    /** Combined points + coupons page for an SMS ('' when it cannot be made in time or only works on this computer). */
    function loyaltyLinkForSms(patientId, waitMs) {
        if (!patientId) return Promise.resolve('');
        var link = loyaltyLink(patientId, false).then(function (res) {
            if (!res || !res.ok || !res.url) return '';
            return isLocalAddress(res.url) ? '' : res.url;
        }, function () { return ''; });
        var late = new Promise(function (resolve) { setTimeout(function () { resolve(''); }, waitMs || 5000); });
        return Promise.race([link, late]);
    }

    /** Pure: WhatsApp message with the one link for points and coupons. */
    function loyaltyWhatsAppText(url, p) {
        var zh = String((p && (p.chinese_name || p.full_name)) || '').trim();
        var en = String((p && (p.full_name || p.chinese_name)) || '').trim();
        return SMS_HEADING + '\n' +
            (zh ? zh + ' ' : '') + '你好！按以下連結即可在手機查看你的積分及優惠券：\n' +
            'Hi' + (en ? ' ' + en : '') + '! Tap the link below to see your reward points and coupons on your phone:\n' +
            String(url || '') + '\n' +
            '請勿轉發此連結。Please do not share this link.';
    }

    function loyaltyQrConfig() {
        return {
            scheme: 'loyalty',
            page: 'loyalty.html',
            makeUrl: loyaltyLink,
            pngName: 'points-and-coupons-qr.png',
            title: ct('coupons.lqr.title', 'Points and coupons on the phone'),
            hint: ct('coupons.lqr.hint',
                'One QR for both. The patient scans it with the phone camera to see their reward points and coupons (browse only).'),
            linkLabel: ct('coupons.lqr.link', 'Phone page link'),
            centre: ct('coupons.lqr.centre', '會員'),
            noSql: ct('coupons.lqr.noSql', 'Phone pages are not set up yet. Run discount_coupon_wallet.sql and reward_points_wallet.sql in Supabase first.'),
            fail: ct('coupons.lqr.fail', 'Could not make the phone link. Try again.'),
            slip: {
                heading: '我的積分及優惠券 My points & coupons',
                tip: '用手機相機掃描，即可查看你的積分及優惠券。 Scan with the phone camera to see your points and coupons.'
            },
            waText: loyaltyWhatsAppText
        };
    }

    /** One QR for points and coupons over any container (reward panel, dashboard). */
    function openLoyaltyQr(host, patientId) {
        if (!patientId) return null;
        if (!host) {
            host = document.getElementById('dcPhoneHost');
            if (!host) {
                host = document.createElement('div');
                host.id = 'dcPhoneHost';
                document.body.appendChild(host);
            }
        }
        return openPhoneQr(host, patientId, loyaltyQrConfig());
    }

    /** QR over the sheet: the patient scans it to browse their own coupons on the phone. */
    function openWalletQr(host, patientId) {
        return openPhoneQr(host && host.querySelector('.dc-sheet'), patientId, couponQrConfig());
    }

    /** Coupon phone wallet QR over the whole page (patient dashboard card). */
    function openWalletPhone(patientId) {
        if (!patientId) return;
        var host = document.getElementById('dcPhoneHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'dcPhoneHost';
            document.body.appendChild(host);
        }
        return openPhoneQr(host, patientId, couponQrConfig());
    }

    /** Resolves the number of live coupons in one wallet. */
    function walletLiveCount(patientId) {
        return loadWallet(patientId).then(function (w) { return walletLedgerRows(w).live.length; });
    }

    /** Phone QR box over any container: link, click-copy, PNG, print slip, WhatsApp, new code. cfg: see couponQrConfig. */
    function openPhoneQr(sheet, patientId, cfg) {
        if (!sheet || !patientId) return;
        cfg = Object.assign(couponQrConfig(), cfg || {});
        ensureCss();
        var old = sheet.querySelector('.dc-authp');
        if (old && old.__dcCancel) old.__dcCancel();
        var back = document.activeElement;
        var wrap = document.createElement('div');
        wrap.className = 'dc-authp dc-wqr';
        wrap.setAttribute('data-scheme', cfg.scheme || '');
        wrap.setAttribute('role', 'dialog');
        wrap.setAttribute('aria-modal', 'true');
        wrap.setAttribute('aria-labelledby', 'dcWqrTitle');
        wrap.innerHTML = '<div class="dc-authp-card dc-wqr-card" id="dcWqrBox">' +
            '<h4 id="dcWqrTitle">📱 ' + esc(cfg.title) + '</h4>' +
            '<p class="dc-hint">' + esc(cfg.hint) + '</p>' +
            '<div class="dc-wqr-code" id="dcWqrCode" aria-live="polite"><span class="dc-hint">' + esc(ct('coupons.wqr.making', 'Making the QR code…')) + '</span></div>' +
            '<p class="dc-wqr-who" id="dcWqrWho" hidden></p>' +
            '<div class="dc-err" id="dcWqrErr" hidden></div>' +
            '<p class="dc-banner dc-banner-warn dc-wqr-local" id="dcWqrLocal" hidden>' + esc(ct('coupons.wqr.local',
                'This address only works on this computer. Set the public address in Phone scan first, or the phone cannot open it.')) + '</p>' +
            '<label class="dc-authp-field dc-wqr-linkfield"><span>' + esc(cfg.linkLabel) +
            ' <small class="dc-wqr-linkhint">' + esc(ct('coupons.wqr.clickCopy', '(click to copy)')) + '</small>' +
            '<em class="dc-wqr-copied" id="dcWqrCopied" role="status" hidden>✓ ' + esc(ct('coupons.wqr.copied', 'Copied')) + '</em></span>' +
            '<input type="text" id="dcWqrLink" class="dc-wqr-link" readonly spellcheck="false" title="' +
            esc(ct('coupons.wqr.clickCopyTitle', 'Click to copy the link')) + '"></label>' +
            '<label class="dc-authp-field dc-wqr-phonefield"><span>' + esc(ct('coupons.wqr.waTo', 'WhatsApp to (phone)')) + '</span>' +
            '<input type="tel" id="dcWqrPhone" class="dc-wqr-phone" inputmode="tel" autocomplete="off" spellcheck="false" placeholder="' +
            esc(ct('coupons.wqr.waPhonePh', 'e.g. 9123 4567')) + '"></label>' +
            '<div class="dc-actions dc-wqr-tools">' +
            '<button type="button" class="dc-clear" data-act="copy" id="dcWqrCopy" disabled>📋 ' + esc(ct('coupons.wqr.copy', 'Copy link')) + '</button>' +
            '<button type="button" class="dc-clear" data-act="png" id="dcWqrPng" disabled>⬇ ' + esc(ct('coupons.wqr.png', 'Download PNG')) + '</button>' +
            '<button type="button" class="dc-clear" data-act="print" id="dcWqrPrint" disabled>🖨 ' + esc(ct('coupons.wqr.print', 'Print slip')) + '</button>' +
            '<button type="button" class="dc-clear dc-wqr-wa" data-act="whatsapp" id="dcWqrWa" disabled>' +
            '<svg class="dc-wqr-wa-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.1.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg> ' +
            esc(ct('coupons.wqr.whatsapp', 'WhatsApp')) + '</button>' +
            '</div>' +
            '<div class="dc-actions dc-wqr-actions">' +
            '<button type="button" class="dc-clear" data-act="reset" id="dcWqrReset">' + esc(ct('coupons.wqr.reset', 'New QR code')) + '</button>' +
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
        var pngBtn = wrap.querySelector('#dcWqrPng');
        var printBtn = wrap.querySelector('#dcWqrPrint');
        var waBtn = wrap.querySelector('#dcWqrWa');
        var phoneEl = wrap.querySelector('#dcWqrPhone');
        var whoEl = wrap.querySelector('#dcWqrWho');
        var drawn = null;
        var who = '';
        var patient = null;
        var urlReady = false;
        var clinic = clinicCodeNow();
        function waPhone() { return String(phoneEl.value || '').trim(); }
        function syncWa() {
            var phone = waPhone();
            var okPhone = String(phone).replace(/\D/g, '').length >= 8;
            waBtn.disabled = !urlReady || !okPhone || typeof openWhatsAppPrefill !== 'function';
            waBtn.title = !phone ? ct('coupons.wqr.noPhone', 'No phone number on this chart — type one in') :
                ct('coupons.wqr.waTitle', 'Open WhatsApp with the link ready — press Send in WhatsApp') + ' (' + phone + ')';
        }
        phoneEl.addEventListener('input', syncWa);
        var patientLoaded = loadWalletPatient(patientId).then(function (p) {
            if (closed || !p) return;
            patient = p;
            who = [maskName(p), clinic].filter(Boolean).join(' · ');
            whoEl.textContent = who;
            whoEl.hidden = !who;
            if (!waPhone()) phoneEl.value = String(p.phone_number || '').trim();
            syncWa();
        });
        function setReady(linkOk, imageReady) {
            urlReady = !!linkOk;
            copyBtn.disabled = !urlReady;
            pngBtn.disabled = !imageReady;
            printBtn.disabled = !imageReady;
            syncWa();
        }
        var closed = false;
        function close() {
            if (closed) return;
            closed = true;
            if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
            if (back && document.body.contains(back)) { try { back.focus({ preventScroll: true }); } catch (e) {} }
        }
        wrap.__dcCancel = close;
        function fail(res) {
            var reason = res && res.reason;
            codeEl.innerHTML = '';
            errEl.hidden = false;
            var msg = reason === 'no_sql' ? cfg.noSql
                : reason === 'no_db' ? grantReason('no_db')
                : reason === 'no_patient' ? ct('coupons.wqr.noPatient', 'This chart could not be found. Save the patient first, then try again.')
                : reason === 'offline' ? ct('coupons.wqr.offline', 'No connection to the database. Check the internet and try again.')
                : cfg.fail;
            var detail = res && res.detail && reason !== 'no_patient' ? String(res.detail) : '';
            errEl.innerHTML = esc(msg) + (detail ? '<small class="dc-wqr-detail">' + esc(ct('coupons.wqr.detail', 'Database says')) + ': ' + esc(detail) + '</small>' : '');
        }
        function show(reset) {
            errEl.hidden = true;
            resetBtn.disabled = true;
            drawn = null;
            linkEl.value = '';
            setReady(false, false);
            codeEl.removeAttribute('data-url');
            codeEl.innerHTML = '<span class="dc-hint">' + esc(ct('coupons.wqr.making', 'Making the QR code…')) + '</span>';
            var made = cfg.makeUrl ? cfg.makeUrl(patientId, reset) : walletLinkToken(patientId, reset, cfg.rpc).then(function (res) {
                return res && res.ok && res.token ? { ok: true, url: walletUrl(res.token, '', cfg.page) } : res;
            });
            return made.then(function (res) {
                resetBtn.disabled = false;
                if (closed) return;
                if (!res || !res.ok || !res.url) { fail(res); return; }
                var url = res.url;
                linkEl.value = url;
                wrap.querySelector('#dcWqrLocal').hidden = !isLocalAddress(url);
                codeEl.setAttribute('data-url', url);
                setReady(true, false);
                return drawWalletQr(codeEl, url, cfg.centre, cfg.title).then(function (d) {
                    if (closed) return;
                    if (!d || !d.ok) {
                        codeEl.innerHTML = '<span class="dc-hint">' + esc(ct('coupons.wqr.qrFail', 'The QR code could not be drawn. Copy the link instead.')) + '</span>';
                        return;
                    }
                    drawn = d;
                    setReady(true, !!d.dataUrl);
                });
            });
        }
        pngBtn.onclick = function () {
            if (!drawn || !drawn.dataUrl) return;
            var a = document.createElement('a');
            a.href = drawn.dataUrl;
            a.download = cfg.pngName;
            document.body.appendChild(a);
            a.click();
            a.remove();
        };
        printBtn.onclick = function () {
            if (!drawn || !drawn.dataUrl) return;
            var w = window.open('', '_blank', 'width=420,height=560');
            if (!w) return;
            w.document.write(walletSlipHtml(drawn.dataUrl, Object.assign({ who: who, title: cfg.title }, cfg.slip || {})));
            w.document.close();
            w.focus();
            setTimeout(function () { try { w.print(); } catch (e) {} }, 350);
        };
        waBtn.onclick = function () {
            var url = linkEl.value;
            var phone = waPhone();
            if (!url || !phone || typeof openWhatsAppPrefill !== 'function') return;
            if (isLocalAddress(url) && !window.confirm(ct('coupons.wqr.waLocalAsk',
                'This link only works on this computer, so the patient cannot open it. Send anyway?'))) return;
            openWhatsAppPrefill(phone, cfg.waText(url, patient));
        };
        wrap.__dcPatient = patientLoaded;
        wrap.addEventListener('keydown', function (ev) {
            if (ev.key !== 'Escape') return;
            ev.preventDefault();
            ev.stopPropagation();
            close();
        });
        wrap.querySelector('[data-act="close"]').onclick = close;
        resetBtn.onclick = function () {
            if (!window.confirm(ct('coupons.wqr.resetAsk', 'Make a new QR code? The old one will stop working.'))) return;
            show(true);
        };
        var copiedEl = wrap.querySelector('#dcWqrCopied');
        var copyLabel = copyBtn.textContent;
        var copiedTimer = null;
        function copyLink() {
            var v = linkEl.value;
            if (!v) return Promise.resolve(false);
            linkEl.select();
            function done() {
                copyBtn.textContent = '✓ ' + ct('coupons.wqr.copied', 'Copied');
                copiedEl.hidden = false;
                linkEl.classList.add('is-copied');
                clearTimeout(copiedTimer);
                copiedTimer = setTimeout(function () {
                    copyBtn.textContent = copyLabel;
                    copiedEl.hidden = true;
                    linkEl.classList.remove('is-copied');
                }, 1600);
                return true;
            }
            function legacy() {
                linkEl.select();
                try { return document.execCommand('copy') ? done() : false; } catch (e) { return false; }
            }
            if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(v).then(done, legacy);
            return Promise.resolve(legacy());
        }
        copyBtn.onclick = copyLink;
        linkEl.addEventListener('click', copyLink);
        linkEl.addEventListener('keydown', function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); copyLink(); }
        });
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
                esc(ct('coupons.wqr.btn', 'Wallet QR')) + '</button>' : '') +
            ((typeof REWARDS !== 'undefined' && REWARDS && typeof REWARDS.loyaltyGuideLinkHtml === 'function')
                ? REWARDS.loyaltyGuideLinkHtml('coupons') : '') + '</div>' +
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
            applyToBill(bill, combo, clinicCode).then(function (res) {
                if (res && res.ok === false) { applyBtn.disabled = false; return; }
                closeSheet();
            });
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
            ['r1', 'Per bill: one treatment coupon plus either one whole-bill coupon (spend, new chart, referral) or any number of cash coupons (by default up to HK$3,000 per bill, no % limit; change it in Configuration). The treatment coupon comes off first; the rest comes off what is left.'],
            ['r2', 'Treatment coupons only cover treatment-list items ticked for that coupon. A typed line counts only if its name is exactly the same as the treatment list.'],
            ['r3', 'No change and no cash back: if a coupon is worth more than the bill, the rest is lost.'],
            ['r4', 'Spend coupons count all cash paid on the bill (not reward points, balance transfer or voided payments). A coupon earned on a bill can be used from the next bill.'],
            ['r5', 'New-chart and referral coupons stay with the patient. Other coupons can be transferred to another chart no.'],
            ['r6', 'Dr / reception / nurses can gift a cash coupon (HK$1–200) or a switched-on treatment coupon. Spend, new-chart and referral coupons are issued automatically only. Every gift and transfer is logged under your login.'],
            ['r7', 'Voiding a bill returns the coupons used on it and cancels coupons it issued. A refund after payment does not create a new coupon.'],
            ['r8', 'Expired coupons cannot be used. Patients get an SMS 1 month and again 7 days before expiry. With Set zero on year end, the SMS goes on 30 Nov and 24 Dec.'],
            ['r9', 'A bill with any Government, PDCC or CCF payment is outside the scheme: it earns no coupons or reward points, and no coupons or points can be used on it.']
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

    var RELEASED = { status: 'unused', bill_id: null, redeemed_amount: null, redeemed_at: null, line_name: null };

    /** Old direct table write, used until loyalty_security.sql is run. */
    function releaseCouponsOnBill(billId, keepIds) {
        if (typeof SB === 'undefined' || !SB || !billId) return Promise.resolve();
        keepIds = keepIds || [];
        return SB.from('discount_coupons').select('id').eq('bill_id', billId).eq('status', 'used')
            .then(function (r) {
                var jobs = [];
                ((r && r.data) || []).forEach(function (row) {
                    if (keepIds.indexOf(String(row.id)) >= 0) return;
                    jobs.push(SB.from('discount_coupons').update(RELEASED).eq('id', row.id));
                });
                return Promise.all(jobs);
            }, function () { return null; });
    }

    /** Give coupons used on a voided or still unpaid bill back to the wallet (ids: those coupons, or all on the bill). */
    function releaseBillCoupons(billId, ids) {
        var list = ids && ids.length ? ids.map(String) : null;
        return dcWrite('dc_bill_release', { p_bill_id: billId, p_coupon_ids: list }, function () {
            if (!list) return releaseCouponsOnBill(billId, []);
            return Promise.all(list.map(function (id) {
                return SB.from('discount_coupons').update(RELEASED).eq('id', id).eq('status', 'used');
            }));
        });
    }

    /** Take back unused coupons a bill earned, once it is voided or no longer fully paid. */
    function voidEarnedCoupons(billId, ids, note) {
        if (!ids || !ids.length) return Promise.resolve({ ok: true, count: 0 });
        return dcWrite('dc_void_earned', { p_bill_id: billId, p_coupon_ids: ids.map(String), p_note: note }, function () {
            return Promise.all(ids.map(function (id) {
                return SB.from('discount_coupons').update({ status: 'void', note: note }).eq('id', id).eq('status', 'unused');
            }));
        });
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
        var leadId = lead ? lead.coupon.id : null;
        var payload = {
            coupon_id: leadId,
            coupon_amount: save,
            total: total,
            balance: balance,
            status: status
        };
        function commit() {
            bill.coupon_id = leadId;
            bill.coupon_amount = save;
            bill.coupon_label = couponLabelFor(rows);
            bill.total = total;
            bill.balance = balance;
            bill.status = status;
            syncBillDetail(bill);
            paintBillTotals(total, balance);
            return { ok: true };
        }
        if (typeof SB === 'undefined' || !SB || !bill.id) return Promise.resolve(commit());
        return dcWrite('dc_bill_set_coupons', {
            p_bill_id: bill.id,
            p_items: rows.map(function (r) {
                return { id: r.coupon.id, amount: r.assess.save, line_name: r.assess.lineName || null };
            })
        }, function () {
            return releaseCouponsOnBill(bill.id, ids).then(function () {
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
        }).then(function (res) {
            if (!res || !res.ok) {
                couponNotice('🎟️ ' + grantReason((res && res.reason) || 'db'));
                return { ok: false, reason: (res && res.reason) || 'db' };
            }
            return SB.from('bills').update(payload).eq('id', bill.id).then(function (r) {
                if (r && r.error && /coupon_/.test(String(r.error.message || ''))) {
                    return SB.from('bills').update({ total: total, balance: balance, status: status }).eq('id', bill.id);
                }
                return r;
            }).then(commit);
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
                return releaseBillCoupons(bill.id, null).then(function () {
                    if (!prev) return null;
                    return releaseBillCoupons(bill.id, [prev]);
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

    // ── Database functions (loyalty_security.sql) ───────────────────
    var _dcNoFn = {};

    function dcFnMissing(err, fn) {
        var m = String((err && (err.message || err.hint || err.details)) || err || '');
        return !!(err && (err.code === 'PGRST202' || err.code === '42883')) ||
            (m.indexOf(fn) >= 0 && /could not find|schema cache|does not exist/i.test(m));
    }

    /**
     * Coupon writes go through the database functions in loyalty_security.sql, which check the rules there.
     * Until that SQL is run, fallback() does the old direct table write.
     * Resolves { ok, reason?, error?, ... }; viaDb is true when the database function ran.
     */
    function dcWrite(fn, args, fallback) {
        function legacy() {
            if (typeof fallback !== 'function') return Promise.resolve({ ok: false, reason: 'no_sql' });
            return Promise.resolve().then(fallback).then(function (r) {
                if (r && typeof r === 'object' && typeof r.ok === 'boolean') return r;
                var err = r && r.error;
                return err ? { ok: false, error: String(err.message || err) } : { ok: true, data: r && r.data };
            }, function (e) { return { ok: false, error: String(e && e.message || e) }; });
        }
        if (_dcNoFn[fn] || typeof SB === 'undefined' || !SB || typeof SB.rpc !== 'function') return legacy();
        return Promise.resolve(SB.rpc(fn, args)).then(function (r) {
            if (r && r.error) {
                if (dcFnMissing(r.error, fn)) { _dcNoFn[fn] = true; return legacy(); }
                return { ok: false, reason: 'db', error: String(r.error.message || r.error) };
            }
            var d = r ? r.data : null;
            var out = d && typeof d === 'object' && !Array.isArray(d) ? Object.assign({}, d) : { ok: d !== false && d !== null, data: d };
            out.viaDb = true;
            return out;
        }, function (e) { return { ok: false, reason: 'offline', error: String(e && e.message || e) }; });
    }

    /**
     * issue: { kind: 'spend' | 'new_chart' | 'referral' | 'gift', billId, referralId, amount, grantor }.
     * The database works out the value, code and expiry itself; the saved row is returned as `row`.
     */
    function insertCoupon(row, sms, smsOpts, issue) {
        if (typeof SB === 'undefined' || !SB) return Promise.resolve({ ok: false, reason: 'no_db', row: row });
        issue = issue || {};
        var grantor = issue.grantor || {};
        return dcWrite('dc_issue_coupon', {
            p_kind: issue.kind || 'gift',
            p_patient_id: row.patient_id,
            p_campaign_key: row.campaign_key,
            p_clinic_code: row.clinic_code || null,
            p_bill_id: issue.billId || row.origin_bill_id || null,
            p_referral_id: issue.referralId || null,
            p_amount: issue.amount != null ? issue.amount : null,
            p_user: grantor.user_id || null,
            p_password: grantor.__pw || null,
            p_issued_by: row.issued_by || null,
            p_note: row.note || null,
            p_item_names: row.item_names || null
        }, function () {
            return SB.from('discount_coupons').insert([row]).select('id,code').then(function (r) {
                if (r.error) return { ok: false, error: r.error.message };
                var s = (r.data && r.data[0]) || {};
                return { ok: true, id: s.id, code: s.code || row.code, row: Object.assign({}, row, { id: s.id, code: s.code || row.code }) };
            });
        }).then(function (res) {
            if (!res || !res.ok) return Object.assign({ row: row }, res || { ok: false });
            var saved = Object.assign({}, row, res.row || {}, { code: res.code || (res.row && res.row.code) || row.code });
            if (sms && saved.patient_id) {
                sendCouponSms(saved.patient_id, function (wallet) {
                    return smsIssued(saved, wallet, Object.assign({ clinic: saved.clinic_code || clinicCodeNow() }, smsOpts || {}));
                }, { phoneLink: true });
            }
            return { ok: true, id: res.id || saved.id, code: saved.code, row: saved, viaDb: !!res.viaDb };
        });
    }

    /**
     * body is the text, or a function(wallet) that builds it from the patient's coupons at send time.
     * opts.phoneLink adds the patient's phone coupon page link.
     */
    function sendCouponSms(patientId, body, opts) {
        if (!body || !patientId || typeof SB === 'undefined' || !SB) return Promise.resolve({ ok: false, reason: 'no_db' });
        var walletP = typeof body === 'function' ? loadWallet(patientId) : Promise.resolve(null);
        var linkP = opts && opts.phoneLink ? loyaltyLinkForSms(patientId) : Promise.resolve('');
        return Promise.all([
            SB.from('patients').select('phone_number,mobile_phone,full_name,chinese_name,patient_no').eq('id', patientId).maybeSingle(),
            walletP,
            linkP
        ])
            .then(function (both) {
                var r = both[0];
                var p = r && r.data;
                var phone = p ? String(p.phone_number || p.mobile_phone || '').trim() : '';
                if (!phone) return { ok: false, reason: 'no_phone' };
                var text = typeof body === 'function' ? body(both[1] || []) : body;
                if (!text) return { ok: false, reason: 'no_text' };
                text = smsWithPhoneLink(text, both[2], 'loyalty');
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

    /** UTC ISO instant → Hong Kong calendar date. */
    function hkDateOf(ts) {
        var t = Date.parse(ts || '');
        return isNaN(t) ? '' : new Date(t + 8 * 3600000).toISOString().slice(0, 10);
    }

    /**
     * One reminder window: text every unused coupon whose stage today is `stage` and that has not been
     * reminded in it. Each coupon is claimed (claimCol) before sending, so two stations never both text.
     * Without the claim column (discount_coupons_expiry_sms.sql) nothing is sent for that window.
     */
    function sendExpiryStage(stage, claimCol, today, before) {
        var q = SB.from('discount_coupons')
            .select('id,code,campaign_key,patient_id,expires_on,status,issued_at,clinic_code,discount_mode,face_value,percent,max_discount')
            .eq('status', 'unused')
            .is(claimCol, null);
        if (before) q = q.lt('expires_on', before);
        q = stage === 'week'
            ? q.gt('expires_on', today).lte('expires_on', addDaysIso(today, EXPIRY_SMS_DAYS))
            : q.is('expiry_sms_at', null).gt('expires_on', addDaysIso(today, EXPIRY_SMS_DAYS))
                .lte('expires_on', addDaysIso(today, 31 * EXPIRY_SMS_MONTHS));
        return q.order('expires_on', { ascending: true }).limit(50).then(function (r) {
            if (!r || r.error) return { ok: false, reason: 'query', error: r && r.error && r.error.message };
            var rows = (r.data || []).filter(function (c) { return !c.clinic_code || clinicJoined(c.clinic_code); });
            var sent = 0;
            var seq = Promise.resolve();
            rows.forEach(function (c) {
                seq = seq.then(function () {
                    var due = Object.assign({}, c, { issued_on: hkDateOf(c.issued_at) });
                    if (expiryReminderStage(due, today) !== stage) return null;
                    var body = function (wallet) { return smsExpiring(due, today, wallet, { clinic: c.clinic_code || clinicCodeNow() }); };
                    var claim = {}; claim[claimCol] = new Date().toISOString();
                    var unclaim = {}; unclaim[claimCol] = null;
                    return dcWrite('dc_expiry_sms_claim', { p_coupon_id: c.id, p_column: claimCol, p_claim: true }, function () {
                        return SB.from('discount_coupons').update(claim).eq('id', c.id).is(claimCol, null).select('id')
                            .then(function (u) { return { ok: !!(u && !u.error && u.data && u.data.length) }; });
                    }).then(function (u) {
                        if (!u || !u.ok) return null;
                        return sendCouponSms(c.patient_id, body).then(function (res) {
                            if (res && res.ok) { sent++; return null; }
                            if (res && (res.reason === 'no_phone')) return null;
                            return dcWrite('dc_expiry_sms_claim', { p_coupon_id: c.id, p_column: claimCol, p_claim: false }, function () {
                                return SB.from('discount_coupons').update(unclaim).eq('id', c.id);
                            });
                        });
                    });
                });
            });
            return seq.then(function () { return { ok: true, checked: rows.length, sent: sent }; });
        });
    }

    var YEAR_END_SMS_TABLE = 'loyalty_yearend_sms';

    /**
     * Claims one year-end reminder (scheme, year, stage) for every key of a person (one per chart) in a single
     * insert, so it fails as a whole if any chart was already claimed — only one station texts each person.
     * Resolves the claimed row ids, or null when taken.
     */
    function claimYearEndSms(scheme, year, stage, personKeys, patientId) {
        var keys = [].concat(personKeys || []).filter(Boolean);
        if (!keys.length) return Promise.resolve(null);
        return dcWrite('loyalty_yearend_claim', {
            p_scheme: scheme, p_year: year, p_stage: stage, p_person_keys: keys, p_patient_id: patientId || null
        }, function () {
            return Promise.resolve(SB.from(YEAR_END_SMS_TABLE)
                .insert(keys.map(function (k) { return { scheme: scheme, year: year, stage: stage, person_key: k, patient_id: patientId || null }; }))
                .select('id'))
                .then(function (r) {
                    var ids = r && !r.error && r.data && r.data.length ? r.data.map(function (x) { return x.id; }) : null;
                    return { ok: !!ids, data: ids };
                });
        }).then(function (r) {
            return r && r.ok && Array.isArray(r.data) && r.data.length ? r.data : null;
        }, function () { return null; });
    }

    /** Sent and no-phone claims stay; a failed send gives the claim back so the next run retries. */
    function finishYearEndSms(ids, res, phone) {
        if (!ids || !ids.length) return Promise.resolve(null);
        var keep = !!(res && (res.ok || res.reason === 'no_phone'));
        var status = keep ? (res.ok ? 'sent' : 'no_phone') : 'release';
        return dcWrite('loyalty_yearend_finish', { p_ids: ids, p_status: status, p_phone: keep ? (phone || null) : null }, function () {
            return keep
                ? SB.from(YEAR_END_SMS_TABLE).update({ status: status, to_phone: phone || null, sent_at: new Date().toISOString() }).in('id', ids)
                : SB.from(YEAR_END_SMS_TABLE).delete().in('id', ids);
        }).then(function () { return null; }, function () { return null; });
    }

    /** One SMS per patient holding coupons that last to 31 Dec, on 30 Nov and 24 Dec (HK), when Set zero is on year end. */
    function sendYearEndCouponReminders(today) {
        var stage = yearEndReminderStage(today);
        if (!stage) return Promise.resolve({ ok: true, skipped: 'date' });
        if (zeroPolicy().zero_policy !== 'year_end') return Promise.resolve({ ok: true, skipped: 'policy' });
        var year = parseInt(today.slice(0, 4), 10);
        var end = year + '-12-31';
        var stageFrom = stage === 'week' ? addDaysIso(end, -EXPIRY_SMS_DAYS) : addMonthsIso(end, -EXPIRY_SMS_MONTHS);
        return Promise.resolve(SB.from('discount_coupons').select('patient_id,clinic_code,issued_at')
            .eq('status', 'unused').gte('expires_on', end).limit(2000)).then(function (r) {
            if (!r || r.error) return { ok: false, reason: 'query', error: r && r.error && r.error.message };
            var clinicOf = {};
            (r.data || []).forEach(function (c) {
                if (!c.patient_id || (c.clinic_code && !clinicJoined(c.clinic_code))) return;
                var issued = hkDateOf(c.issued_at);
                if (stage === 'month' ? (issued && issued >= stageFrom) : issued === today) return;
                if (!(c.patient_id in clinicOf)) clinicOf[c.patient_id] = c.clinic_code || '';
            });
            var sent = 0;
            var seq = Promise.resolve();
            Object.keys(clinicOf).forEach(function (pid) {
                seq = seq.then(function () {
                    return claimYearEndSms('coupons', year, stage, 'p:' + pid, pid).then(function (claimIds) {
                        if (!claimIds) return null;
                        return sendCouponSms(pid, function (wallet) {
                            return smsYearEndCoupons(today, wallet, { clinic: clinicOf[pid] || clinicCodeNow() });
                        }).then(function (res) {
                            if (res && res.ok) sent++;
                            return finishYearEndSms(claimIds, res);
                        });
                    });
                });
            });
            return seq.then(function () { return { ok: true, stage: stage, people: Object.keys(clinicOf).length, sent: sent }; });
        });
    }

    /**
     * Expiry reminders, Hong Kong date: 7 days before (expiry_sms_at), then 1 month before (expiry_sms_month_at).
     * With Set zero on year end, coupons that last to 31 Dec get the year-end reminder instead (one SMS per patient).
     */
    function sendExpiryReminders() {
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            return Promise.resolve({ ok: false, reason: 'no_db' });
        }
        var today = todayIso();
        var before = '';
        var week = null, month = null;
        function soft(p) { return p.catch(function (e) { return { ok: false, error: String(e && e.message || e) }; }); }
        return loadState().then(loadZeroPolicy).then(function () {
            if (zeroPolicy().zero_policy === 'year_end') before = today.slice(0, 4) + '-12-31';
            return sendExpiryStage('week', 'expiry_sms_at', today, before);
        }).then(function (w) {
            week = w;
            return soft(sendExpiryStage('month', 'expiry_sms_month_at', today, before));
        }).then(function (m) {
            month = m;
            return soft(sendYearEndCouponReminders(today));
        }).then(function (y) {
            return Object.assign({}, week, { month: month, yearEnd: y });
        }).catch(function (e) { return { ok: false, error: String(e && e.message || e) }; });
    }

    /** With the database job on (loyalty_jobs.sql, 10:00 HK), desks wait until this hour before sending as the backup. */
    var DB_SMS_BACKUP_HOUR = 11;

    /** Today's database SMS run: { on, ran }; { on: false } when loyalty_jobs.sql has not been run or the job is off. */
    function dbSmsJobState(today) {
        if (typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') return Promise.resolve({ on: false });
        return Promise.all([
            Promise.resolve(SB.from('loyalty_job_config').select('sms_on').eq('id', 1).maybeSingle()),
            Promise.resolve(SB.from('loyalty_job_runs').select('id').eq('job', 'sms').eq('run_on', today).limit(1))
        ]).then(function (r) {
            var cfg = r[0] && !r[0].error && r[0].data;
            if (!cfg || !cfg.sms_on) return { on: false };
            return { on: true, ran: !!(r[1] && !r[1].error && r[1].data && r[1].data.length) };
        }, function () { return { on: false }; });
    }

    /** Pure: the desk's part in today's reminder SMS — 'run', 'wait' (database job not due yet) or 'skip' (database did it). */
    function deskSmsBackupPlan(state, hkHour) {
        if (!state || !state.on) return 'run';
        if (state.ran) return 'skip';
        return hkHour >= DB_SMS_BACKUP_HOUR ? 'run' : 'wait';
    }

    function hkHourNow() { return new Date(Date.now() + 8 * 3600000).getUTCHours(); }

    /**
     * Once a day per station: send(today) runs unless the database job already sent today's reminders.
     * runKey (localStorage) marks the day done.
     */
    function runDeskSmsBackup(runKey, send) {
        var today = todayIso();
        try { if (window.localStorage && localStorage.getItem(runKey) === today) return Promise.resolve({ ok: true, skipped: 'done' }); } catch (e) {}
        function done() { try { if (window.localStorage) localStorage.setItem(runKey, today); } catch (e) {} }
        return dbSmsJobState(today).then(function (st) {
            var plan = deskSmsBackupPlan(st, hkHourNow());
            if (plan === 'wait') return { ok: true, skipped: 'db_job_due' };
            if (plan === 'skip') { done(); return { ok: true, skipped: 'db_job_ran' }; }
            return Promise.resolve(send(today)).then(function (res) {
                if (res && res.ok) done();
                return res;
            });
        });
    }

    /** Any logged-in station runs the reminder pass once a day (backup to the database job). */
    function scheduleExpiryReminders() {
        if (typeof window === 'undefined' || typeof window.setInterval !== 'function') return;
        var busy = false;
        function tick() {
            if (busy) return;
            if (typeof currentUserId === 'undefined' || !currentUserId) return;
            busy = true;
            runDeskSmsBackup(EXPIRY_RUN_KEY, function () { return sendExpiryReminders(); })
                .then(function () { busy = false; }, function () { busy = false; });
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

    /** New chart: welcome coupon now; the referrer's coupon waits for the friend's first paid visit. */
    function onPatientCreated(row, referredBy, referrerId, kind) {
        var clinicCode = '';
        if (typeof currentClinicCodeForTagging === 'function') clinicCode = currentClinicCodeForTagging() || '';
        return loadState().then(loadUsage).then(function () {
            var plans = planNewChart({
                clinicCode: clinicCode,
                doctorKey: loginDoctorKey(),
                clinics: _clinics,
                doctors: _doctors,
                campaigns: campaigns(),
                patientId: row && row.id,
                wallet: []
            });
            var seq = Promise.resolve();
            plans.forEach(function (p) {
                seq = seq.then(function () {
                    return loadWallet(p.patientId).then(function (w) {
                        var gate = canIssue(w, p.campaign);
                        if (!gate.ok) return null;
                        return insertCoupon(issueRecord(p.campaign, p.patientId, { clinicCode: clinicCode }), p.sms, null,
                            { kind: p.campaign.trigger === 'referral' ? 'referral' : 'new_chart' });
                    });
                });
            });
            return seq.then(function () {
                if (!row || !row.id || (!referrerId && !String(referredBy || '').trim())) return null;
                return registerReferral(row.id, referredBy, referrerId, { source: 'register', kind: kind });
            });
        });
    }

    /** Chart no. typed or picked in "Referred by". Exact chart no. only; two charts with the same no. are not guessed. */
    function resolveReferrer(referredBy, referrerId) {
        if (typeof SB === 'undefined' || !SB) return Promise.resolve(null);
        if (referrerId) {
            return SB.from('patients').select(REF_PATIENT_COLS).eq('id', referrerId).maybeSingle()
                .then(function (r) { return (r && r.data) || null; }, function () { return null; });
        }
        var s = String(referredBy || '').trim().replace(/^#\s*/, '');
        if (!s) return Promise.resolve(null);
        return SB.from('patients').select(REF_PATIENT_COLS).eq('patient_no', s).limit(2)
            .then(function (r) {
                var rows = (r && r.data) || [];
                return rows.length === 1 ? rows[0] : null;
            }, function () { return null; });
    }

    // ── Refer a friend ──────────────────────────────────────────────
    var REF_TABLE = 'discount_coupon_referrals';
    var REF_EDIT_DAYS = 30;
    var REF_PATIENT_COLS = 'id,patient_no,full_name,chinese_name,phone_number,mobile_phone,hkid,created_at';

    function phoneKey(s) {
        var d = String(s || '').replace(/\D/g, '');
        if (d.length === 11 && d.indexOf('852') === 0) d = d.slice(3);
        return d.length >= 8 ? d : '';
    }
    function hkidKey(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
    function nameKey(s) { return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim(); }
    function phonesOf(p) {
        return [phoneKey(p && p.phone_number), phoneKey(p && p.mobile_phone)].filter(Boolean);
    }

    /** Pure: same chart, same HKID, or a shared phone number (one household counts as one person). */
    function samePerson(a, b) {
        if (!a || !b) return false;
        if (a.id && b.id && String(a.id) === String(b.id)) return true;
        var ha = hkidKey(a.hkid);
        if (ha && ha === hkidKey(b.hkid)) return true;
        var pb = phonesOf(b);
        return phonesOf(a).some(function (x) { return pb.indexOf(x) >= 0; });
    }

    /** Pure: another chart that is this patient registered earlier (same HKID, or same phone and same name). */
    function isEarlierChart(friend, other) {
        if (!friend || !other || String(friend.id) === String(other.id)) return false;
        var ha = hkidKey(friend.hkid);
        var same = !!ha && ha === hkidKey(other.hkid);
        if (!same) {
            var po = phonesOf(other);
            var phone = phonesOf(friend).some(function (x) { return po.indexOf(x) >= 0; });
            var name = (nameKey(friend.full_name) && nameKey(friend.full_name) === nameKey(other.full_name)) ||
                (nameKey(friend.chinese_name) && nameKey(friend.chinese_name) === nameKey(other.chinese_name));
            same = phone && !!name;
        }
        if (!same) return false;
        if (!other.created_at || !friend.created_at) return true;
        return String(other.created_at) < String(friend.created_at);
    }

    /** Pure: "陳大文" → "陳**", "CHAN TAI MAN" → "CHAN **". */
    function maskName(p) {
        var zh = String((p && p.chinese_name) || '').trim();
        if (zh) return zh.charAt(0) + '**';
        var en = String((p && p.full_name) || '').trim();
        return en ? en.split(/\s+/)[0] + ' **' : '';
    }

    /** Pure: days between an ISO time and today (null when unknown). */
    function daysSince(iso, now) {
        if (!iso) return null;
        var t = new Date(iso).getTime();
        if (!isFinite(t)) return null;
        return Math.floor(((now || Date.now()) - t) / 86400000);
    }

    var REF_KINDS = ['coupon', 'points'];

    /** Pure: is the discount coupon branch usable at this clinic / doctor? */
    function referralCouponGate(ctx) {
        ctx = ctx || {};
        var camp = ctx.campaign;
        if (!camp || !camp.enabled) return { ok: false, reason: 'campaign_off' };
        if (!clinicJoined(ctx.clinicCode, ctx.clinics) || !doctorJoined(ctx.clinicCode, ctx.doctorKey, ctx)) {
            return { ok: false, reason: 'clinic' };
        }
        return { ok: true, reason: '' };
    }

    /** Pure: the two reward branches for the form, each on or greyed out with its reason. */
    function referralOptions(couponGate, pointsGate) {
        return [
            { kind: 'coupon', ok: !!(couponGate && couponGate.ok), reason: (couponGate && couponGate.reason) || 'campaign_off' },
            { kind: 'points', ok: !!(pointsGate && pointsGate.ok), reason: (pointsGate && pointsGate.reason) || 'points_off' }
        ].map(function (o) { if (o.ok) o.reason = ''; return o; });
    }

    /** Pure: the requested branch when it is on, else the first branch that is on, else '' (no referral reward here). */
    function pickReferralKind(requested, options) {
        var list = options || [];
        var want = list.filter(function (o) { return o.kind === requested && o.ok; })[0];
        if (want) return want.kind;
        var first = list.filter(function (o) { return o.ok; })[0];
        return first ? first.kind : '';
    }

    /**
     * Pure: what to record for a friend + referrer pair. kind = 'coupon' | 'points'.
     * skip = nothing to record (no referrer, already recorded, branch off); blocked / pending = record it.
     */
    function planReferral(ctx) {
        ctx = ctx || {};
        var friend = ctx.friend || {};
        var ref = ctx.referrer;
        var kind = ctx.kind === 'points' ? 'points' : 'coupon';
        if (!ref || !ref.id) return { status: 'skip', reason: 'no_referrer', kind: kind };
        if (ctx.existing) return { status: 'skip', reason: 'already', kind: kind };
        var gate = kind === 'points' ? (ctx.pointsGate || { ok: false, reason: 'points_off' }) : referralCouponGate(ctx);
        if (!gate.ok) return { status: 'skip', reason: gate.reason, kind: kind };
        var out = sharedReferralGuards(ctx, friend, ref);
        out.kind = kind;
        return out;
    }

    function sharedReferralGuards(ctx, friend, ref) {
        if (ctx.source === 'edit') {
            var age = daysSince(friend.created_at, ctx.now);
            if (age == null || age > REF_EDIT_DAYS) return { status: 'skip', reason: 'edit_window' };
        }
        if (samePerson(friend, ref)) return { status: 'blocked', reason: 'same_person' };
        if (ref.created_at && friend.created_at && String(ref.created_at) >= String(friend.created_at)) {
            return { status: 'blocked', reason: 'referrer_newer' };
        }
        if ((ctx.lookalikes || []).some(function (o) { return String(o.id) !== String(ref.id) && isEarlierChart(friend, o); })) {
            return { status: 'blocked', reason: 'not_new' };
        }
        return { status: 'pending', reason: '' };
    }

    /** Pure: the referral coupon follows the friend's paid bill (refPercent > 0) instead of a fixed HK$. */
    function referralLadderOn(camp) {
        return !!camp && (parseFloat(camp.refPercent) || 0) > 0;
    }

    /**
     * Pure: referral coupon HK$ for the friend's cash paid on the bill — refPercent of it, no more than refMax,
     * rounded down to refStep (HK$2,345 at 10% / step 10 → HK$230). Without a percent it is the fixed face.
     */
    function referralCouponValue(camp, cashPaid) {
        if (!camp) return 0;
        if (!referralLadderOn(camp)) return round2(camp.face || 0);
        var v = (parseFloat(cashPaid) || 0) * (parseFloat(camp.refPercent) || 0) / 100;
        var max = parseFloat(camp.refMax) || 0;
        if (max > 0) v = Math.min(v, max);
        var step = parseFloat(camp.refStep) || 0;
        v = step > 0 ? Math.floor((v + 1e-9) / step) * step : Math.floor(round2(v) * 100 + 1e-6) / 100;
        return round2(Math.max(0, v));
    }

    /** Pure: the friend's bill at which the referral coupon reaches its most (HK$10,000 at 10% up to HK$1,000). */
    function referralTopSpend(camp) {
        var pct = parseFloat(camp && camp.refPercent) || 0;
        var max = parseFloat(camp && camp.refMax) || 0;
        return pct > 0 && max > 0 ? round2(max * 100 / pct) : 0;
    }

    /**
     * Pure: may the pending referral reward on this fully paid bill? Failing keeps it pending for a later visit.
     * Coupon branch: campaign + clinic + wallet limits; with the ladder it waits until the bill is fully paid
     * and returns the coupon HK$ (face). Points branch: points scheme at this clinic.
     */
    function planReferralIssue(ctx) {
        ctx = ctx || {};
        var rec = ctx.record;
        if (!rec || rec.status !== 'pending') return { ok: false, reason: 'not_pending' };
        if (rec.reward_kind === 'points') {
            var pg = ctx.pointsGate || { ok: false, reason: 'points_off' };
            if (!pg.ok) return { ok: false, reason: pg.reason };
            var pmin = parseFloat(ctx.pointsConfig && ctx.pointsConfig.minFirstSpend) || 0;
            if (pmin > 0 && cents(ctx.cashPaid) < cents(pmin)) return { ok: false, reason: 'below_min' };
            return { ok: true, reason: '', points: round2(ctx.pointsConfig && ctx.pointsConfig.points) };
        }
        var camp = ctx.campaign;
        var cg = referralCouponGate(ctx);
        if (!cg.ok) return { ok: false, reason: cg.reason };
        var min = parseFloat(camp.minFirstSpend) || 0;
        if (min > 0 && cents(ctx.cashPaid) < cents(min)) return { ok: false, reason: 'below_min' };
        var face = referralCouponValue(camp, ctx.cashPaid);
        if (!(face > 0)) return { ok: false, reason: 'below_min' };
        if (referralLadderOn(camp) && !ctx.fullyPaid) return { ok: false, reason: 'wait_full', face: face };
        var gate = canIssue(ctx.referrerWallet || [], Object.assign({}, camp, { face: face }));
        if (!gate.ok) return { ok: false, reason: gate.reason };
        return { ok: true, reason: '', face: face };
    }

    function referralReason(code) {
        var map = {
            no_referrer: ['coupons.ref.r.noReferrer', 'No chart with that number'],
            already: ['coupons.ref.r.already', 'This patient already has a referrer recorded'],
            campaign_off: ['coupons.ref.r.off', 'Refer a friend is switched off in Configuration'],
            clinic: ['coupons.ref.r.clinic', 'This clinic or the bill’s doctor is switched off in the coupon scheme (Configuration → Discount Coupons)'],
            edit_window: ['coupons.ref.r.window', 'A referrer can only be added within 30 days of registration'],
            same_person: ['coupons.ref.r.same', 'Referrer looks like the same person (same chart, HKID or phone)'],
            referrer_newer: ['coupons.ref.r.newer', 'Referrer’s chart is newer than this patient’s'],
            not_new: ['coupons.ref.r.notNew', 'This patient already had an earlier chart'],
            below_min: ['coupons.ref.r.min', 'Paid so far on the bill is below the minimum'],
            wait_full: ['coupons.ref.r.waitFull', 'Waiting until this bill is fully paid — the referral coupon is worked out from the full payment'],
            wallet_full: ['coupons.ref.r.full', 'Referrer’s wallet is full'],
            already_holding: ['coupons.ref.r.holding', 'Referrer already holds the most referral coupons allowed'],
            issue_cap: ['coupons.ref.r.cap', 'Referral coupon issue limit reached'],
            budget: ['coupons.ref.r.budget', 'Referral coupon budget used up'],
            bill_voided: ['coupons.ref.r.voided', 'The paid bill was voided; waiting for another paid visit'],
            chart_deleted: ['coupons.ref.r.deleted', 'Chart deleted'],
            insert_failed: ['coupons.ref.r.insert', 'Could not save the coupon; tries again at the next paid visit'],
            points_off: ['coupons.ref.r.pointsOff', 'Referral points are switched off in Reward Points configuration'],
            points_clinic: ['coupons.ref.r.pointsClinic', 'This clinic or the bill’s doctor is switched off in the reward points scheme (Configuration → Reward Points)'],
            points_spent: ['coupons.ref.r.spent', 'Referral points were already used, so they were not taken back'],
            no_scheme: ['coupons.ref.r.noScheme', 'This clinic is in neither scheme, so no referral reward']
        };
        var m = map[code];
        return m ? ct(m[0], m[1]) : String(code || '');
    }

    function referralStatusText(st) {
        var map = {
            pending: ['coupons.ref.s.pending', 'Pending'],
            issuing: ['coupons.ref.s.pending', 'Pending'],
            issued: ['coupons.ref.s.issued', 'Issued'],
            blocked: ['coupons.ref.s.blocked', 'Blocked'],
            void: ['coupons.ref.s.void', 'Void']
        };
        var m = map[st];
        return m ? ct(m[0], m[1]) : String(st || '');
    }

    /** Pure: what the referrer would get, e.g. "a referral coupon HK$100" or "100 reward points". */
    function referralRewardText(kind, camp, pointsCfg) {
        if (kind === 'points') {
            return round2((pointsCfg && pointsCfg.points) || 0).toFixed(0) + ' ' + ct('coupons.ref.points', 'reward points');
        }
        if (referralLadderOn(camp)) {
            var lo = referralCouponValue(camp, parseFloat(camp.minFirstSpend) || 0);
            var hi = parseFloat(camp.refMax) || 0;
            return ct('coupons.ref.aLadder', 'a referral coupon worth {P}% of the bill').split('{P}').join(String(round2(camp.refPercent))) +
                (lo > 0 || hi > 0 ? ' (' + (lo > 0 ? 'HK$' + round2(lo).toFixed(0) : '') + (hi > 0 ? '–HK$' + round2(hi).toFixed(0) : '+') + ')' : '');
        }
        return ct('coupons.ref.aCoupon', 'a referral coupon') + ' HK$' + round2((camp && camp.face) || 0).toFixed(0);
    }

    /** Pure: the line under "Referred by" on the patient form. */
    function referralPreviewText(plan, referrer, camp, pointsCfg) {
        var who = referrer ? '#' + (referrer.patient_no || '') + ' ' + (referrer.chinese_name || referrer.full_name || '') : '';
        if (!plan || plan.status === 'skip' || plan.status === 'blocked') {
            var why = plan ? referralReason(plan.reason) : '';
            return (who ? who.trim() + ' — ' : '') + ct('coupons.ref.noReward', 'no referral reward') + (why ? ': ' + why : '');
        }
        var kind = plan.kind === 'points' ? 'points' : 'coupon';
        var min = kind === 'points' ? parseFloat(pointsCfg && pointsCfg.minFirstSpend) || 0 : parseFloat(camp && camp.minFirstSpend) || 0;
        var after = kind === 'coupon' && referralLadderOn(camp)
            ? ct('coupons.ref.afterFull', 'once this patient’s bill is fully paid')
            : ct('coupons.ref.after', 'once this patient has paid the minimum on a bill (full or part payment)');
        return who.trim() + ' — ' + ct('coupons.ref.gets', 'gets') + ' ' + referralRewardText(kind, camp, pointsCfg) + ' ' + after +
            (min > 0 ? ' (' + ct('coupons.ref.min', 'min') + ' HK$' + round2(min).toFixed(0) + ')' : '');
    }

    /** Points branch gate for a clinic (REWARDS decides points participation). */
    function referralPointsGateFor(clinicCode, doctorKey) {
        if (typeof REWARDS === 'undefined' || !REWARDS || typeof REWARDS.referralAvailability !== 'function') {
            return Promise.resolve({ ok: false, reason: 'points_off', config: null });
        }
        var clinicId = null;
        try {
            var cx = REWARDS.clinicCtx ? REWARDS.clinicCtx() : null;
            if (cx && String(cx.clinic_code || '').toUpperCase() === String(clinicCode || '').toUpperCase()) clinicId = cx.clinic_id;
        } catch (e) { clinicId = null; }
        return Promise.resolve(REWARDS.referralAvailability(clinicId, clinicCode, doctorKey ? { doctor_id: doctorKey } : undefined))
            .then(function (g) { return g || { ok: false, reason: 'points_off' }; },
                function () { return { ok: false, reason: 'points_off', config: null }; });
    }

    /** Both branches at a clinic: { options, coupon: gate, points: gate, camp, pointsCfg }. */
    function referralBranches(clinicCode, doctorKey) {
        return Promise.all([loadState(), referralPointsGateFor(clinicCode, doctorKey)]).then(function (res) {
            var camp = campaignByKey('referral');
            var cg = referralCouponGate({ campaign: camp, clinicCode: clinicCode, doctorKey: doctorKey, clinics: _clinics, doctors: _doctors });
            var pg = res[1];
            return { options: referralOptions(cg, pg), coupon: cg, points: pg, camp: camp, pointsCfg: pg.config || null };
        });
    }

    function sbReady() { return typeof SB !== 'undefined' && SB && typeof SB.from === 'function'; }

    function orValue(v) { return '"' + String(v).replace(/["\\]/g, '') + '"'; }

    /** Other charts sharing this patient's HKID or phone. */
    function loadLookalikes(friend) {
        if (!sbReady() || !friend) return Promise.resolve([]);
        var parts = [];
        var hk = String(friend.hkid || '').trim();
        if (hk) parts.push('hkid.eq.' + orValue(hk));
        [friend.phone_number, friend.mobile_phone].forEach(function (p) {
            var raw = String(p || '').trim();
            if (!phoneKey(raw)) return;
            var vals = [raw, phoneKey(raw)].filter(function (v, i, a) { return a.indexOf(v) === i; });
            vals.forEach(function (v) {
                parts.push('phone_number.eq.' + orValue(v));
                parts.push('mobile_phone.eq.' + orValue(v));
            });
        });
        if (!parts.length) return Promise.resolve([]);
        return SB.from('patients').select(REF_PATIENT_COLS).or(parts.join(',')).neq('id', friend.id).limit(20)
            .then(function (r) { return (r && r.data) || []; }, function () { return []; });
    }

    function loadReferralRecord(friendId) {
        if (!sbReady() || !friendId) return Promise.resolve({ ok: false, row: null });
        return SB.from(REF_TABLE).select('*').eq('referred_patient_id', friendId).limit(1)
            .then(function (r) {
                if (!r || r.error) return { ok: false, row: null, error: r && r.error && r.error.message };
                return { ok: true, row: (r.data && r.data[0]) || null };
            }, function (e) { return { ok: false, row: null, error: String(e && e.message || e) }; });
    }

    /** Save the friend → referrer link (pending or blocked). Idempotent: one record per friend. */
    function registerReferral(friendId, referredBy, referrerId, opts) {
        opts = opts || {};
        if (!sbReady() || !friendId) return Promise.resolve({ ok: false, reason: 'no_db' });
        var clinicCode = opts.clinicCode || clinicCodeNow();
        var doctorKey = loginDoctorKey();
        return Promise.all([
            referralBranches(clinicCode, doctorKey),
            SB.from('patients').select(REF_PATIENT_COLS).eq('id', friendId).maybeSingle()
                .then(function (r) { return (r && r.data) || null; }, function () { return null; }),
            resolveReferrer(referredBy, referrerId),
            loadReferralRecord(friendId)
        ]).then(function (res) {
            var br = res[0];
            var friend = res[1];
            var ref = res[2];
            var existing = res[3];
            if (!friend) return { ok: false, reason: 'no_friend' };
            if (!existing.ok) {
                if (ref) couponNotice('🤝 ' + ct('coupons.ref.noTable', 'Referrals table not set up yet — run discount_coupon_referrals.sql in Supabase.'));
                return { ok: false, reason: 'no_table', error: existing.error };
            }
            var kind = pickReferralKind(opts.kind, br.options);
            if (!kind) {
                if (ref) couponNotice('🤝 ' + referralPreviewText({ status: 'skip', reason: 'no_scheme' }, ref, br.camp));
                return { ok: true, status: 'skip', reason: 'no_scheme' };
            }
            return loadLookalikes(friend).then(function (looks) {
                var plan = planReferral({
                    kind: kind,
                    friend: friend,
                    referrer: ref,
                    campaign: br.camp,
                    pointsGate: br.points,
                    clinicCode: clinicCode,
                    doctorKey: doctorKey,
                    clinics: _clinics,
                    doctors: _doctors,
                    existing: existing.row,
                    lookalikes: looks,
                    source: opts.source
                });
                if (plan.status === 'skip') {
                    if (plan.reason !== 'already' && (ref || plan.reason === 'no_referrer')) {
                        couponNotice('🤝 ' + referralPreviewText(plan, ref, br.camp, br.pointsCfg));
                    }
                    return { ok: true, status: 'skip', reason: plan.reason, kind: kind };
                }
                var rec = {
                    referred_patient_id: friend.id,
                    referrer_patient_id: ref.id,
                    referred_no: friend.patient_no || null,
                    referrer_no: ref.patient_no || null,
                    reward_kind: kind,
                    status: plan.status,
                    reason: plan.reason || null,
                    clinic_code: clinicCode || null,
                    created_by: actorName() || null
                };
                return dcWrite('dc_referral_register', {
                    p_referred_id: rec.referred_patient_id, p_referrer_id: rec.referrer_patient_id,
                    p_referred_no: rec.referred_no, p_referrer_no: rec.referrer_no, p_kind: rec.reward_kind,
                    p_status: rec.status, p_reason: rec.reason, p_clinic_code: rec.clinic_code, p_created_by: rec.created_by
                }, function () {
                    return SB.from(REF_TABLE).insert([rec]).select('id').then(function (r) {
                        if (r && r.error) return { ok: false, error: r.error.message };
                        return { ok: true, id: (r.data && r.data[0] && r.data[0].id) || null };
                    });
                }).then(function (r) {
                    if (!r || !r.ok) return { ok: false, reason: 'insert', error: (r && (r.error || r.reason)) || '' };
                    logCoupon('REFERRAL', 'Referral (' + kind + ') ' + plan.status + ': #' + (friend.patient_no || '') + ' referred by #' +
                        (ref.patient_no || '') + (plan.reason ? ' (' + plan.reason + ')' : ''), friend.patient_no || null,
                        r.id || null);
                    couponNotice('🤝 ' + referralPreviewText(plan, ref, br.camp, br.pointsCfg));
                    return { ok: true, status: plan.status, reason: plan.reason, kind: kind };
                });
            });
        });
    }

    /** "Referred by" was changed in Edit patient: record it once, within 30 days of registration. */
    function onReferrerEdited(patientId, referredBy, referrerId, kind) {
        if (!patientId || (!referrerId && !String(referredBy || '').trim())) return Promise.resolve(null);
        return registerReferral(patientId, referredBy, referrerId, { source: 'edit', kind: kind });
    }

    /** Pure: the thank-you text for the referrer's SMS, e.g. "多謝介紹 李** / thanks for referring 李**". */
    function referralThanks(friend, fallbackNo) {
        var m = maskName(friend);
        if (m) return '多謝介紹 ' + m + ' / thanks for referring ' + m;
        return fallbackNo ? '介紹 #' + fallbackNo + ' / referral #' + fallbackNo : '';
    }

    function nowIso() { return new Date().toISOString(); }

    function finishReferral(rec, patch) {
        patch.updated_at = nowIso();
        return SB.from(REF_TABLE).update(patch).eq('id', rec.id);
    }

    /** action: note | claim | retry | points | reopen | points_spent | void (dc_referral_set); fallback is the old direct write. */
    function setReferral(rec, action, args, fallback) {
        return dcWrite('dc_referral_set', Object.assign({
            p_id: rec.id, p_action: action, p_bill_id: null, p_reason: null, p_ledger_id: null, p_points: null
        }, args || {}), fallback);
    }

    /** Coupon branch: HK$ coupon into the referrer's wallet + coupon SMS. */
    function rewardReferralCoupon(rec, info, camp, friend, plan) {
        var row = issueRecord(camp, rec.referrer_patient_id, {
            face: plan && plan.face > 0 ? plan.face : undefined,
            clinicCode: info.clinicCode,
            originBillId: info.billId,
            note: 'Referral: #' + (rec.referred_no || friend.patient_no || '')
        });
        return insertCoupon(row, camp.sms !== false, { thanks: maskName(friend) }, {
            kind: 'referral', billId: info.billId, referralId: rec.id
        }).then(function (saved) {
            var done = saved && saved.ok;
            if (done && saved.row) row = saved.row;
            var why = !done && saved && saved.viaDb && saved.reason ? saved.reason : 'insert_failed';
            var mark = done && saved.viaDb
                ? Promise.resolve()
                : done
                    ? finishReferral(rec, { status: 'issued', coupon_id: saved.id || null, reason: null, issued_at: nowIso() })
                    : setReferral(rec, 'retry', { p_reason: why }, function () {
                        return finishReferral(rec, { status: 'pending', trigger_bill_id: null, reason: 'insert_failed' });
                    });
            return mark.then(function () {
                if (!done) return { ok: false, reason: why };
                logCoupon('ISSUE', 'Referral coupon ' + (saved.code || row.code) + ' HK$' + round2(row.face_value).toFixed(2) +
                    ' to #' + (rec.referrer_no || '') + ' for referring #' + (rec.referred_no || ''),
                    rec.referrer_no || null, saved.id || null);
                var note = referralBonusText('coupon', rec, row.face_value, info.cashPaid);
                couponNotice(note.body, note.title);
                return { ok: true, kind: 'coupon', code: saved.code || row.code, couponId: saved.id };
            });
        });
    }

    /** Points branch: points onto the referrer's chart + reward points SMS. */
    function rewardReferralPoints(rec, info, plan, friend) {
        var credit = (typeof REWARDS !== 'undefined' && REWARDS && typeof REWARDS.referralCredit === 'function')
            ? REWARDS.referralCredit({
                patientId: rec.referrer_patient_id,
                points: plan.points,
                clinicCode: info.clinicCode,
                note: 'Referral: #' + (rec.referred_no || friend.patient_no || ''),
                ref: referralThanks(friend, rec.referred_no)
            })
            : Promise.resolve({ ok: false, error: 'no_rewards' });
        return Promise.resolve(credit).then(function (res) { return res; }, function (e) {
            return { ok: false, error: String(e && e.message || e) };
        }).then(function (res) {
            var done = !!(res && res.ok && !res.skipped);
            var mark = done
                ? setReferral(rec, 'points', { p_ledger_id: res.ledger_id || null, p_points: round2(res.points || plan.points) }, function () {
                    return finishReferral(rec, { status: 'issued', ledger_id: res.ledger_id || null, points: round2(res.points || plan.points), reason: null, issued_at: nowIso() });
                })
                : setReferral(rec, 'retry', null, function () {
                    return finishReferral(rec, { status: 'pending', trigger_bill_id: null, reason: 'insert_failed' });
                });
            return mark.then(function () {
                if (!done) return { ok: false, reason: 'insert_failed', error: res && res.error };
                logCoupon('ISSUE', 'Referral points +' + round2(res.points || plan.points).toFixed(2) + ' to #' + (rec.referrer_no || '') +
                    ' for referring #' + (rec.referred_no || ''), rec.referrer_no || null, res.ledger_id || null);
                var note = referralBonusText('points', rec, res.points || plan.points, info.cashPaid);
                couponNotice(note.body, note.title);
                return { ok: true, kind: 'points', points: round2(res.points || plan.points), ledgerId: res.ledger_id };
            });
        });
    }

    /** Friend's bill fully paid: reward the referrer (coupon or points) when the pending referral qualifies. */
    function referralOnBillPaid(info) {
        info = info || {};
        if (!sbReady() || !info.patientId || !info.billId) return Promise.resolve({ ok: false, reason: 'no_db' });
        return (_loaded ? Promise.resolve() : loadState()).then(function () {
            return SB.from(REF_TABLE).select('*').eq('referred_patient_id', info.patientId).eq('status', 'pending').limit(1);
        }).then(function (r) {
            var rec = r && !r.error && r.data && r.data[0];
            if (!rec) return { ok: true, skipped: true };
            var points = rec.reward_kind === 'points';
            var camp = campaignByKey('referral');
            var prep = points
                ? referralPointsGateFor(info.clinicCode, info.doctorKey).then(function (g) { return { pointsGate: g, pointsConfig: g.config }; })
                : loadWallet(rec.referrer_patient_id).then(function (w) { return { referrerWallet: w }; });
            return prep.then(function (extra) {
                var plan = planReferralIssue(Object.assign({
                    record: rec,
                    campaign: camp,
                    clinicCode: info.clinicCode,
                    doctorKey: info.doctorKey,
                    clinics: _clinics,
                    doctors: _doctors,
                    cashPaid: info.cashPaid,
                    fullyPaid: !!info.fullyPaid
                }, extra));
                if (!plan.ok) {
                    var held = referralHeldText(rec, plan, info.cashPaid, points ? (extra.pointsConfig || {}).minFirstSpend : camp && camp.minFirstSpend);
                    couponNotice(held.body, held.title, 'held');
                    if (plan.reason !== rec.reason) {
                        setReferral(rec, 'note', { p_reason: plan.reason }, function () {
                            return SB.from(REF_TABLE).update({ reason: plan.reason, updated_at: nowIso() })
                                .eq('id', rec.id).eq('status', 'pending');
                        });
                    }
                    return { ok: false, reason: plan.reason, kind: rec.reward_kind || 'coupon' };
                }
                return setReferral(rec, 'claim', { p_bill_id: info.billId }, function () {
                    return SB.from(REF_TABLE).update({ status: 'issuing', trigger_bill_id: info.billId, updated_at: nowIso() })
                        .eq('id', rec.id).eq('status', 'pending').select('id').then(function (claim) {
                            return { ok: !!(claim && !claim.error && claim.data && claim.data.length) };
                        });
                }).then(function (claim) {
                        if (!claim || !claim.ok) return { ok: false, reason: 'taken' };
                        rec.status = 'issuing';
                        rec.trigger_bill_id = info.billId;
                        return SB.from('patients').select(REF_PATIENT_COLS).eq('id', info.patientId).maybeSingle()
                            .then(function (fr) { return (fr && fr.data) || {}; }, function () { return {}; })
                            .then(function (friend) {
                                return points ? rewardReferralPoints(rec, info, plan, friend) : rewardReferralCoupon(rec, info, camp, friend, plan);
                            });
                    });
            });
        }, function () { return { ok: false, reason: 'no_table' }; });
    }

    /** Pure: referral records to put back to pending because their coupon was cancelled with the bill. */
    function referralsToReopen(records, cancelledIds) {
        var gone = (cancelledIds || []).map(String);
        return (records || []).filter(function (rec) {
            if (!rec) return false;
            if (rec.status === 'issuing') return true;
            if (rec.reward_kind === 'points') return false;
            return rec.status === 'issued' && rec.coupon_id && gone.indexOf(String(rec.coupon_id)) >= 0;
        }).map(function (rec) { return String(rec.id); });
    }

    /** Pure: issued points-branch referrals whose points should be taken back. */
    function referralPointsToReverse(records) {
        return (records || []).filter(function (rec) {
            return rec && rec.reward_kind === 'points' && rec.status === 'issued' && (parseFloat(rec.points) || 0) > 0;
        });
    }

    function reversePointsReferral(rec, why) {
        if (typeof REWARDS === 'undefined' || !REWARDS || typeof REWARDS.referralReverse !== 'function') {
            return Promise.resolve({ ok: false, reason: 'no_rewards' });
        }
        return Promise.resolve(REWARDS.referralReverse({
            patientId: rec.referrer_patient_id,
            points: rec.points,
            clinicCode: rec.clinic_code || clinicCodeNow(),
            note: 'Referral reversed (' + why + '): #' + (rec.referred_no || '')
        })).then(function (res) { return res || { ok: false }; }, function () { return { ok: false }; });
    }

    var REF_UNDO_COLS = 'id,status,coupon_id,reward_kind,points,ledger_id,referrer_patient_id,referred_patient_id,referrer_no,referred_no,clinic_code';

    function reopenReferrals(billId, cancelledIds, keepIds) {
        if (!sbReady() || !billId) return Promise.resolve([]);
        var keep = (keepIds || []).map(String);
        return SB.from(REF_TABLE).select(REF_UNDO_COLS).eq('trigger_bill_id', billId).then(function (r) {
            var rows = ((r && r.data) || []).filter(function (rec) { return rec && keep.indexOf(String(rec.id)) < 0; });
            var ids = referralsToReopen(rows, cancelledIds);
            var reopenPatch = { status: 'pending', coupon_id: null, ledger_id: null, trigger_bill_id: null, issued_at: null, reason: 'bill_voided' };
            function reopen(id) {
                return setReferral({ id: id }, 'reopen', { p_reason: 'bill_voided' }, function () {
                    return SB.from(REF_TABLE).update(Object.assign({ updated_at: nowIso() }, reopenPatch)).eq('id', id);
                });
            }
            var jobs = ids.map(reopen);
            referralPointsToReverse(rows).forEach(function (rec) {
                jobs.push(reversePointsReferral(rec, 'bill voided').then(function (res) {
                    if (res && res.ok) {
                        ids.push(String(rec.id));
                        logCoupon('CANCEL', 'Referral points -' + round2(rec.points).toFixed(2) + ' taken back from #' + (rec.referrer_no || '') +
                            ' (bill voided)', rec.referrer_no || null, rec.ledger_id || null);
                        return reopen(rec.id);
                    }
                    logCoupon('CANCEL', 'Referral points +' + round2(rec.points).toFixed(2) + ' for #' + (rec.referrer_no || '') +
                        ' already used; not taken back', rec.referrer_no || null, billId);
                    couponNotice('🤝 ' + referralReason('points_spent') + ': #' + (rec.referrer_no || '') + ' +' + round2(rec.points).toFixed(0));
                    return setReferral(rec, 'points_spent', null, function () { return finishReferral(rec, { reason: 'points_spent' }); });
                }));
            });
            return Promise.all(jobs).then(function () { return ids; });
        }, function () { return []; });
    }

    /** Chart deleted: its referral records end; an unused coupon or the points it earned are taken back. */
    function onPatientDeleted(patientId) {
        if (!sbReady() || !patientId) return Promise.resolve({ ok: false });
        return SB.from(REF_TABLE).select(REF_UNDO_COLS)
            .or('referred_patient_id.eq.' + patientId + ',referrer_patient_id.eq.' + patientId)
            .then(function (r) {
                var rows = (r && !r.error && r.data) || [];
                return Promise.all(rows.map(function (rec) {
                    var jobs = [];
                    var friendGone = String(rec.referred_patient_id) === String(patientId);
                    if (friendGone && referralPointsToReverse([rec]).length) jobs.push(reversePointsReferral(rec, 'chart deleted'));
                    if (rec.status !== 'void') {
                        jobs.push(setReferral(rec, 'void', null, function () {
                            var legacy = [SB.from(REF_TABLE).update({ status: 'void', reason: 'chart_deleted', updated_at: nowIso() }).eq('id', rec.id)];
                            if (friendGone && rec.coupon_id) {
                                legacy.push(SB.from('discount_coupons').update({ status: 'void', note: 'Referred chart deleted' })
                                    .eq('id', rec.coupon_id).eq('status', 'unused'));
                            }
                            return Promise.all(legacy);
                        }));
                    }
                    return Promise.all(jobs);
                })).then(function () { return { ok: true, n: rows.length }; });
            }, function () { return { ok: false }; });
    }

    // ── Referrer picker on the patient forms ────────────────────────
    var _refPick = { timer: null, seq: 0 };

    function refPickerEls(input) {
        var root = input.closest ? input.closest('.dc-ref-fg') : null;
        return {
            root: root,
            hidden: root && root.querySelector('.dc-ref-id'),
            list: root && root.querySelector('.dc-ref-list'),
            kinds: root && root.querySelector('.dc-ref-kind'),
            preview: root && root.querySelector('.dc-ref-preview')
        };
    }

    function resetReferrerPicker(inputId) {
        if (typeof document === 'undefined') return Promise.resolve();
        var input = document.getElementById(inputId);
        if (!input) return Promise.resolve();
        var els = refPickerEls(input);
        input._refRow = null;
        if (els.hidden) els.hidden.value = '';
        if (els.list) { els.list.innerHTML = ''; els.list.hidden = true; }
        if (els.preview) { els.preview.textContent = ''; els.preview.className = 'dc-ref-preview'; }
        return paintReferralKinds(input);
    }

    /** Selected reward branch on a form ('' when neither scheme runs at this clinic). */
    function selectedReferralKind(input) {
        var els = input ? refPickerEls(input) : {};
        var on = els.kinds && els.kinds.querySelector('input[type="radio"]:checked:not(:disabled)');
        return on ? on.value : '';
    }

    /** Pure: radio pair HTML; a branch the clinic is not in is greyed out and cannot be chosen. */
    function referralKindsHtml(name, options, chosen, camp, pointsCfg, lockedKind) {
        var any = (options || []).some(function (o) { return o.ok; });
        var html = '<span class="dc-ref-kind-label">' + esc(ct('coupons.ref.rewardWith', '介紹獎賞 / Reward the referrer with')) + '</span>';
        (options || []).forEach(function (o) {
            var off = !o.ok || (lockedKind && lockedKind !== o.kind);
            var label = o.kind === 'points'
                ? '⭐ ' + ct('coupons.ref.kindPoints', '積分 Reward points') + (pointsCfg ? ' +' + round2(pointsCfg.points || 0).toFixed(0) : '')
                : '🎟️ ' + ct('coupons.ref.kindCoupon', '優惠券 Discount coupon') + (camp ? ' HK$' + round2(camp.face || 0).toFixed(0) : '');
            var title = !o.ok ? referralReason(o.reason) : '';
            html += '<label class="dc-ref-k' + (off ? ' is-off' : '') + '" data-kind="' + o.kind + '"' +
                (title ? ' title="' + esc(title) + '"' : '') + '>' +
                '<input type="radio" name="' + esc(name) + '" value="' + o.kind + '"' + (off ? ' disabled' : '') +
                (o.kind === chosen ? ' checked' : '') + '> <span>' + esc(label) + '</span>' +
                (!o.ok ? ' <small>' + esc(title) + '</small>' : '') + '</label>';
        });
        if (!any) html += '<small class="dc-ref-k-none">' + esc(referralReason('no_scheme')) + '</small>';
        return html;
    }

    function paintReferralKinds(input) {
        var els = refPickerEls(input);
        if (!els.kinds) return Promise.resolve(null);
        var edit = input.id === 'edit_referredBy';
        var friendId = edit && typeof editPatientId !== 'undefined' ? editPatientId : null;
        var recP = friendId ? loadReferralRecord(friendId) : Promise.resolve({ ok: true, row: null });
        var prev = selectedReferralKind(input);
        return Promise.all([referralBranches(clinicCodeNow(), loginDoctorKey()), recP]).then(function (res) {
            var br = res[0];
            var rec = res[1] && res[1].row;
            var locked = rec ? (rec.reward_kind || 'coupon') : '';
            var chosen = locked || pickReferralKind(prev || 'coupon', br.options);
            els.kinds.innerHTML = referralKindsHtml('refKind_' + input.id, br.options, chosen, br.camp, br.pointsCfg, locked);
            var any = br.options.some(function (o) { return o.ok; });
            els.kinds.classList.toggle('is-off', !any);
            if (els.root) els.root.classList.toggle('is-ref-off', !any);
            input._refBranches = br;
            return br;
        }, function () { return null; });
    }

    /** Form values for the patient being registered or edited, for the same-person check. */
    function refFormPatient(input) {
        var edit = input.id === 'edit_referredBy';
        function v(id) { var el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
        var p = {
            id: edit && typeof editPatientId !== 'undefined' ? editPatientId : null,
            hkid: v(edit ? 'edit_hkid' : 'hkid'),
            phone_number: v(edit ? 'edit_phone' : 'phone'),
            mobile_phone: v(edit ? 'edit_mobilePhone' : 'mobilePhone')
        };
        return p;
    }

    function paintReferrerPreview(input, referrer) {
        var els = refPickerEls(input);
        if (!els.preview) return Promise.resolve();
        if (!referrer) { els.preview.textContent = ''; return Promise.resolve(); }
        var edit = input.id === 'edit_referredBy';
        var friend = refFormPatient(input);
        input._refRow = referrer;
        var recP = edit && friend.id ? loadReferralRecord(friend.id) : Promise.resolve({ ok: true, row: null });
        var brP = input._refBranches ? Promise.resolve(input._refBranches) : paintReferralKinds(input);
        return Promise.all([brP, loadWallet(referrer.id), recP]).then(function (res) {
            var br = res[0] || { options: [], camp: campaignByKey('referral'), points: null, pointsCfg: null };
            var rec = res[2] && res[2].row;
            var kind = selectedReferralKind(input) || pickReferralKind('coupon', br.options);
            var plan = kind ? planReferral({
                kind: kind,
                friend: friend,
                referrer: referrer,
                campaign: br.camp,
                pointsGate: br.points,
                clinicCode: clinicCodeNow(),
                doctorKey: loginDoctorKey(),
                clinics: _clinics,
                doctors: _doctors,
                existing: rec
            }) : { status: 'skip', reason: 'no_scheme' };
            var text;
            if (rec) {
                text = ct('coupons.ref.recorded', 'Referral already recorded') + ': #' + (rec.referrer_no || '') + ' · ' +
                    (rec.reward_kind === 'points' ? ct('coupons.ref.kindPoints', '積分 Reward points') : ct('coupons.ref.kindCoupon', '優惠券 Discount coupon')) +
                    ' · ' + referralStatusText(rec.status) + (rec.reason ? ' — ' + referralReason(rec.reason) : '');
            } else {
                text = referralPreviewText(plan, referrer, br.camp, br.pointsCfg);
                var gate = plan.status === 'pending' && kind === 'coupon' ? canIssue(res[1] || [], br.camp) : { ok: true };
                if (!gate.ok) text += ' · ' + ct('coupons.ref.waitNote', 'for now') + ': ' + referralReason(gate.reason);
            }
            els.preview.textContent = '🤝 ' + text;
            els.preview.className = 'dc-ref-preview ' + (!rec && plan.status === 'pending' ? 'is-ok' : 'is-warn');
        });
    }

    function searchReferrers(q) {
        var s = String(q || '').replace(/[,()*%"\\]/g, ' ').trim();
        if (s.length < 2 || !sbReady()) return Promise.resolve([]);
        var like = '%' + s + '%';
        return SB.from('patients').select(REF_PATIENT_COLS)
            .or(['patient_no.ilike.' + like, 'full_name.ilike.' + like, 'chinese_name.ilike.' + like,
                'phone_number.ilike.' + like, 'mobile_phone.ilike.' + like].join(','))
            .order('patient_no', { ascending: true }).limit(8)
            .then(function (r) { return (r && r.data) || []; }, function () { return []; });
    }

    function onReferrerInput(input) {
        var els = refPickerEls(input);
        input._refRow = null;
        if (els.hidden) els.hidden.value = '';
        if (els.preview) { els.preview.textContent = ''; els.preview.className = 'dc-ref-preview'; }
        clearTimeout(_refPick.timer);
        var seq = ++_refPick.seq;
        _refPick.timer = setTimeout(function () {
            searchReferrers(input.value).then(function (rows) {
                if (seq !== _refPick.seq || !els.list) return;
                var self = refFormPatient(input).id;
                rows = rows.filter(function (p) { return !self || String(p.id) !== String(self); });
                if (!rows.length) { els.list.innerHTML = ''; els.list.hidden = true; return; }
                els.list.innerHTML = rows.map(function (p) {
                    return '<button type="button" class="dc-ref-opt" data-id="' + esc(p.id) + '">' +
                        '<b>#' + esc(p.patient_no || '') + '</b> ' + esc(p.full_name || '') +
                        (p.chinese_name ? ' ' + esc(p.chinese_name) : '') +
                        (p.phone_number ? ' <small>' + esc(String(p.phone_number).replace(/^(.*)(\d{4})$/, '••••$2')) + '</small>' : '') +
                        '</button>';
                }).join('');
                els.list.hidden = false;
                els.list._rows = rows;
            });
        }, 250);
    }

    function pickReferrer(input, p) {
        var els = refPickerEls(input);
        input.value = p.patient_no || '';
        if (els.hidden) els.hidden.value = p.id;
        if (els.list) { els.list.innerHTML = ''; els.list.hidden = true; }
        return paintReferrerPreview(input, p);
    }

    function wireReferrerPickers() {
        if (typeof document === 'undefined' || !document.addEventListener || wireReferrerPickers._on) return;
        wireReferrerPickers._on = true;
        document.addEventListener('input', function (e) {
            var t = e.target;
            if (t && t.getAttribute && t.getAttribute('data-ref-picker') != null) onReferrerInput(t);
        });
        document.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('.dc-ref-opt') : null;
            if (!btn) return;
            var root = btn.closest('.dc-ref-fg');
            var input = root && root.querySelector('[data-ref-picker]');
            var list = root && root.querySelector('.dc-ref-list');
            var rows = (list && list._rows) || [];
            var id = btn.getAttribute('data-id');
            var p = rows.filter(function (r) { return String(r.id) === String(id); })[0];
            if (input && p) pickReferrer(input, p);
        });
        document.addEventListener('change', function (e) {
            var t = e.target;
            if (!t || t.type !== 'radio' || String(t.name || '').indexOf('refKind_') !== 0) return;
            var root = t.closest ? t.closest('.dc-ref-fg') : null;
            var input = root && root.querySelector('[data-ref-picker]');
            if (input && input._refRow) paintReferrerPreview(input, input._refRow);
        });
        document.addEventListener('focusout', function (e) {
            var t = e.target;
            if (!t || !t.getAttribute || t.getAttribute('data-ref-picker') == null) return;
            setTimeout(function () {
                var els = refPickerEls(t);
                if (els.list && !els.list.contains(document.activeElement)) els.list.hidden = true;
            }, 200);
        });
    }

    function loadReferralList() {
        var body = typeof document !== 'undefined' && document.getElementById('dcRefBody');
        if (!body) return Promise.resolve();
        if (!sbReady()) { body.innerHTML = ''; return Promise.resolve(); }
        return SB.from(REF_TABLE).select('*').order('created_at', { ascending: false }).limit(100).then(function (r) {
            if (!r || r.error) {
                body.innerHTML = '<p class="dc-hint">' + esc(ct('coupons.ref.noTable', 'Referrals table not set up yet — run discount_coupon_referrals.sql in Supabase.')) + '</p>';
                return;
            }
            var rows = r.data || [];
            if (!rows.length) {
                body.innerHTML = '<p class="dc-hint">' + esc(ct('coupons.ref.none', 'No referrals yet.')) + '</p>';
                return;
            }
            body.innerHTML = '<table class="dc-log"><thead><tr>' +
                '<th>' + esc(ct('coupons.log.when', 'When')) + '</th>' +
                '<th>' + esc(ct('coupons.ref.colFriend', 'New patient')) + '</th>' +
                '<th>' + esc(ct('coupons.ref.colReferrer', 'Referrer')) + '</th>' +
                '<th>' + esc(ct('coupons.ref.colReward', 'Reward')) + '</th>' +
                '<th>' + esc(ct('coupons.ref.colStatus', 'Status')) + '</th>' +
                '<th>' + esc(ct('coupons.log.note', 'Detail')) + '</th></tr></thead><tbody>' +
                rows.map(function (x) {
                    return '<tr data-ref-status="' + esc(x.status) + '"><td>' + esc(String(x.created_at || '').replace('T', ' ').slice(0, 16)) + '</td>' +
                        '<td>#' + esc(x.referred_no || '') + '</td><td>#' + esc(x.referrer_no || '') + '</td>' +
                        '<td>' + esc(x.reward_kind === 'points'
                            ? '⭐ ' + ct('coupons.ref.kindPoints', '積分 Reward points') + (x.points ? ' +' + round2(x.points).toFixed(0) : '')
                            : '🎟️ ' + ct('coupons.ref.kindCoupon', '優惠券 Discount coupon')) + '</td>' +
                        '<td>' + esc(referralStatusText(x.status)) + '</td>' +
                        '<td>' + esc(x.reason ? referralReason(x.reason) : (x.issued_at ? String(x.issued_at).slice(0, 10) : '')) + '</td></tr>';
                }).join('') + '</tbody></table>';
        }, function () { body.innerHTML = ''; });
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

    function isExcludedMethod(method) {
        return typeof window !== 'undefined' && typeof window.isLoyaltyExcludedPayMethod === 'function' &&
            !!window.isLoyaltyExcludedPayMethod(method);
    }

    /** Resolves true for a Government / PDCC / CCF bill (no coupons issued or used). */
    function billExcluded(billId, method) {
        if (isExcludedMethod(method)) return Promise.resolve(true);
        if (typeof REWARDS === 'undefined' || !REWARDS || typeof REWARDS.billLoyaltyExcluded !== 'function') return Promise.resolve(false);
        return REWARDS.billLoyaltyExcluded(billId);
    }

    function excludedText() {
        return ct('coupons.info.excluded', 'Government / PDCC / CCF bill: no discount coupons or reward points are earned or used.');
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

    function couponNotice(text, title, tone) {
        if (typeof document === 'undefined' || !document.body) return null;
        ensureCss();
        var el = document.createElement('div');
        el.className = 'dc-notice' + (title ? ' dc-notice--ref' : '') + (tone === 'held' ? ' dc-notice--held' : '');
        el.setAttribute('role', 'status');
        if (title) {
            var head = document.createElement('b');
            head.className = 'dc-notice-title';
            head.textContent = title;
            var body = document.createElement('span');
            body.textContent = text;
            el.appendChild(head);
            el.appendChild(body);
        } else {
            el.textContent = text;
        }
        var shown = document.querySelectorAll ? document.querySelectorAll('.dc-notice').length : 0;
        if (shown) el.style.bottom = (18 + shown * 76) + 'px';
        document.body.appendChild(el);
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, title ? 12000 : 9000);
        return el;
    }

    /** Pure: the "Refer a friend bonus" mini-notification, e.g. "Referrer #1234 gets a HK$100 coupon · #5678 paid HK$300 on this bill". */
    function referralBonusText(kind, rec, value, cashPaid) {
        rec = rec || {};
        var gets = kind === 'points'
            ? ct('coupons.ref.bonusPts', 'Referrer #{REF} gets +{N} reward points').split('{N}').join(round2(value).toFixed(0))
            : ct('coupons.ref.bonusCoupon', 'Referrer #{REF} gets a HK${N} coupon').split('{N}').join(round2(value).toFixed(0));
        gets = gets.split('{REF}').join(String(rec.referrer_no || ''));
        var paid = ct('coupons.ref.bonusPaid', '#{FRIEND} paid HK${PAID} on this bill')
            .split('{FRIEND}').join(String(rec.referred_no || ''))
            .split('{PAID}').join(round2(cashPaid).toFixed(0));
        return { title: '🤝 ' + ct('coupons.ref.bonusTitle', 'Refer a friend bonus activated'), body: gets + ' · ' + paid };
    }

    /** Pure: the "not given yet" mini-notification when a payment does not activate the pending referral. */
    function referralHeldText(rec, plan, cashPaid, min) {
        rec = rec || {};
        var why = referralReason(plan && plan.reason);
        var paid = ct('coupons.ref.bonusPaid', '#{FRIEND} paid HK${PAID} on this bill')
            .split('{FRIEND}').join(String(rec.referred_no || ''))
            .split('{PAID}').join(round2(cashPaid).toFixed(0));
        if (plan && plan.reason === 'below_min' && parseFloat(min) > 0) paid += ' / ' + ct('coupons.ref.min', 'min') + ' HK$' + round2(min).toFixed(0);
        if (plan && plan.reason === 'wait_full' && plan.face > 0) {
            paid += ' · ' + ct('coupons.ref.soFar', 'coupon so far') + ' HK$' + round2(plan.face).toFixed(0);
        }
        return {
            title: '🤝 ' + ct('coupons.ref.heldTitle', 'Refer a friend: not given yet'),
            body: why + ' · ' + paid + ' · ' + ct('coupons.ref.heldReferrer', 'referrer') + ' #' + String(rec.referrer_no || '')
        };
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
        var seq = ++_hintSeq;
        var couponHtml = couponHintHtml(total, paid, method);
        host.hidden = !couponHtml;
        host.innerHTML = couponHtml;
        checkoutPointsLine(total, paid, method).then(function (line) {
            if (seq !== _hintSeq || !line) return;
            host.insertAdjacentHTML('afterbegin', '<div class="dc-hint-pts">' + esc(line) + '</div>');
            host.hidden = false;
        });
    }

    var _hintSeq = 0;

    /** Pure: the points line of the checkout hint ('' when nothing is earned). */
    function pointsEarnText(amount, rate, method) {
        var amt = round2(parseFloat(amount) || 0);
        var pct = parseFloat(rate) || 0;
        if (amt <= 0 || pct <= 0) return '';
        if (method && (isExcludedMethod(method) || isNonCashMethod(method))) return '';
        var pts = round2(amt * pct / 100);
        if (pts <= 0) return '';
        return '⭐ ' + ct('coupons.info.pointsEarn', 'Paying HK${AMT} earns about {PTS} reward points')
            .split('{AMT}').join(amt.toFixed(2)).split('{PTS}').join(pts.toFixed(2));
    }

    /** Points earned by this payment, when the clinic (and the bill's doctor) are in the reward points scheme. */
    function checkoutPointsLine(total, paid, method) {
        if (typeof REWARDS === 'undefined' || !REWARDS || typeof REWARDS.currentClinicJoined !== 'function' ||
            typeof REWARDS.earnRatePercent !== 'function') return Promise.resolve('');
        var amount = (parseFloat(paid) || 0) > 0 ? paid : total;
        if (!pointsEarnText(amount, 1, method)) return Promise.resolve('');
        var doctor = typeof pendingListDoctorIdFromUi === 'function' && pendingListDoctorIdFromUi()
            ? { doctor_id: pendingListDoctorIdFromUi() } : undefined;
        return Promise.all([REWARDS.currentClinicJoined(doctor), REWARDS.earnRatePercent()]).then(function (r) {
            return r[0] ? pointsEarnText(amount, r[1], method) : '';
        }, function () { return ''; });
    }

    /** Coupon part of the checkout hint ('' when this clinic is not in the coupon scheme or nothing is near). */
    function couponHintHtml(total, paid, method) {
        if (!clinicJoined(clinicCodeNow())) return '';
        if (method && isExcludedMethod(method)) return '<div>' + esc('🚫 ' + excludedText()) + '</div>';
        var prog = spendProgress(total);
        if (!prog.reached.length && !prog.next) return '';
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
        return lines.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('') + spendBarHtml(total, prog);
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

    /** Any payment saved (full or part): the friend's cash paid on this bill so far counts towards the referral minimum. */
    function onBillPayment(info) {
        info = info || {};
        if (!info.patientId || !info.billId) return Promise.resolve({ ok: false, reason: 'no_bill' });
        var clinicCode = String(info.clinicCode || '').trim() ||
            String((typeof bdCurrentBill !== 'undefined' && bdCurrentBill && bdCurrentBill.clinic_tag) || '').trim() ||
            clinicCodeNow();
        return billExcluded(info.billId, info.method).then(function (excluded) {
            if (excluded) return { ok: false, reason: 'excluded_method' };
            return onBillPaymentChecked(info, clinicCode);
        });
    }

    /** Is the bill fully paid after this payment? Uses the balance the caller just saved, else reads the bill. */
    function billFullyPaid(billId, balanceAfter) {
        var known = parseFloat(balanceAfter);
        if (balanceAfter != null && balanceAfter !== '' && isFinite(known)) return Promise.resolve(known <= 0.005);
        if (!billId || typeof SB === 'undefined' || !SB) return Promise.resolve(false);
        return Promise.resolve(SB.from('bills').select('balance').eq('id', billId).maybeSingle()).then(function (r) {
            var b = r && !r.error && r.data;
            return !!b && b.balance != null && (parseFloat(b.balance) || 0) <= 0.005;
        }, function () { return false; });
    }

    function onBillPaymentChecked(info, clinicCode) {
        return Promise.all([
            billCashPaid(info.billId, info.cashAmount),
            billDoctorKey(info.billId, info.doctorKey),
            billFullyPaid(info.billId, info.balanceAfter)
        ]).then(function (res) {
            return referralOnBillPaid({
                patientId: info.patientId,
                billId: info.billId,
                cashPaid: res[0],
                clinicCode: clinicCode,
                doctorKey: res[1],
                fullyPaid: res[2]
            });
        }).catch(function (e) { return { ok: false, reason: 'error', error: String(e && e.message || e) }; });
    }

    function onBillFullyPaid(info) {
        info = info || {};
        var clinicCode = String(info.clinicCode || '').trim() ||
            String((typeof bdCurrentBill !== 'undefined' && bdCurrentBill && bdCurrentBill.clinic_tag) || '').trim() ||
            clinicCodeNow();
        return billExcluded(info.billId, info.method).then(function (excluded) {
            if (excluded) return { ok: false, reason: 'excluded_method' };
            return onBillFullyPaidChecked(info, clinicCode);
        });
    }

    function onBillFullyPaidChecked(info, clinicCode) {
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
                        return insertCoupon(row, true, null, { kind: 'spend', billId: info.billId }).then(function (saved) {
                            if (saved && saved.ok) issued.push({ campaign: p.campaign, row: saved.row || row });
                            return saved;
                        });
                    });
                });
                return seq.then(function () {
                    if (issued.length) {
                        couponNotice('🎟️ ' + ct('coupons.notice.earned', 'This bill earned') + ': ' + issued.map(function (x) {
                            return campLabel(x.campaign) + ' · HK$' + round2(x.row.face_value).toFixed(0) +
                                ' (' + ct('coupons.info.expires', 'expires') + ' ' +
                                effectiveExpiry({ expires_on: x.row.expires_on, issued_at: new Date().toISOString() }, zeroPolicy()) + ')';
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
                Object.defineProperty(u, '__pw', { value: pw, enumerable: false });
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
                if (plan.restore.length) jobs.push(releaseBillCoupons(billId, plan.restore));
                jobs.push(voidEarnedCoupons(billId, plan.cancel, 'Voided with bill'));
                jobs.push(SB.from('bills').update({ coupon_id: null }).eq('id', billId));
                return Promise.all(jobs).then(function () {
                    if (plan.restore.length) {
                        logCoupon('RESTORE', 'Void bill restored coupon ' + plan.restore.join(','), null, billId);
                    }
                    if (plan.cancel.length) {
                        logCoupon('CANCEL', 'Void bill cancelled issued coupon ' + plan.cancel.join(','), null, billId);
                    }
                    flagStuck(plan.stuck, billId);
                    reopenReferrals(billId, plan.cancel);
                    bill.coupon_id = null;
                    return { ok: true, restore: plan.restore, cancel: plan.cancel, stuck: plan.stuck };
                });
            }, function (e) {
                return { ok: false, error: String(e && e.message || e) };
            });
    }

    function flagStuck(codes, billId) {
        if (!codes || !codes.length) return;
        logCoupon('CANCEL', 'Coupon ' + codes.join(', ') + ' earned by this bill was already used on another bill; not taken back', null, billId);
        couponNotice(ct('coupons.void.stuck', 'A spend coupon earned by this bill was already used, so it cannot be taken back:') + ' ' + codes.join(', '));
    }

    /** A payment was voided or deleted: take back the spend coupons this bill earned once it is no longer fully paid. */
    /** Pure: after a payment void, does the cash still paid on the trigger bill meet this referral's minimum? */
    function referralStillEarned(rec, cashLeft, mins) {
        if (!rec || (rec.status !== 'issued' && rec.status !== 'issuing')) return false;
        mins = mins || {};
        var min = parseFloat(rec.reward_kind === 'points' ? mins.points : mins.coupon) || 0;
        return min > 0 ? cents(cashLeft) >= cents(min) : cents(cashLeft) > 0;
    }

    /** Referral rewards on this bill that stay after a payment void (the rest of the cash still meets the minimum). */
    function referralKeptOnBill(billId) {
        var none = { recordIds: [], couponIds: [] };
        if (!sbReady() || !billId) return Promise.resolve(none);
        var pointsCfg = (typeof REWARDS !== 'undefined' && REWARDS && typeof REWARDS.loadReferralConfig === 'function')
            ? Promise.resolve(REWARDS.loadReferralConfig(false)).catch(function () { return null; })
            : Promise.resolve(null);
        return Promise.all([
            SB.from(REF_TABLE).select('id,status,coupon_id,reward_kind').eq('trigger_bill_id', billId),
            billCashPaid(billId, 0),
            (_loaded ? Promise.resolve() : loadState()),
            pointsCfg
        ]).then(function (res) {
            var rows = (res[0] && !res[0].error && res[0].data) || [];
            var camp = campaignByKey('referral');
            var mins = { coupon: camp && camp.minFirstSpend, points: res[3] && res[3].minFirstSpend };
            var keep = rows.filter(function (rec) { return referralStillEarned(rec, res[1], mins); });
            return {
                recordIds: keep.map(function (rec) { return String(rec.id); }),
                couponIds: keep.filter(function (rec) { return rec.coupon_id; }).map(function (rec) { return String(rec.coupon_id); })
            };
        }, function () { return none; });
    }

    function onPaymentVoided(info) {
        info = info || {};
        var billId = info.billId;
        if (!billId || typeof SB === 'undefined' || !SB || typeof SB.from !== 'function') {
            return Promise.resolve({ ok: false, reason: 'no_db' });
        }
        if (!((parseFloat(info.balanceAfter) || 0) > 0.005)) return Promise.resolve({ ok: true, skipped: true });
        return Promise.all([
            SB.from('discount_coupons').select('id,code,status,bill_id,origin_bill_id').eq('origin_bill_id', billId),
            referralKeptOnBill(billId)
        ]).then(function (both) {
                var r = both[0];
                var kept = both[1];
                var plan = planPaymentVoid({ id: billId }, (r && r.data) || [], info.balanceAfter);
                plan.cancel = plan.cancel.filter(function (id) { return kept.couponIds.indexOf(String(id)) < 0; });
                return voidEarnedCoupons(billId, plan.cancel, 'Voided with payment').then(function () {
                    if (plan.cancel.length) {
                        logCoupon('CANCEL', 'Void payment took back spend coupon ' + plan.cancel.join(','), null, billId);
                        couponNotice(ct('coupons.void.payment', 'Payment voided: the spend coupon earned by this bill was taken back. It is issued again when the bill is fully paid.'));
                    }
                    flagStuck(plan.stuck, billId);
                    reopenReferrals(billId, plan.cancel, kept.recordIds);
                    return { ok: true, cancel: plan.cancel, stuck: plan.stuck, keptReferrals: kept.recordIds };
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
        if (code === 'db' || code === 'offline') return ct('coupons.save.fail', 'Could not save. Check the connection and try again.');
        if (code === 'bill_paid') return ct('coupons.bill.paidLock', 'This bill is fully paid; its coupons cannot change. Void the bill to undo.');
        if (code === 'excluded_method') return excludedText();
        if (code === 'used') return ct('coupons.bill.usedElsewhere', 'This coupon was already used on another bill');
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
                return insertCoupon(row, camp.sms !== false, null, {
                    kind: 'gift', amount: plan.campaignKey === 'cash' ? plan.amount : null, grantor: grantor
                }).then(function (saved) {
                    if (!saved || !saved.ok) return saved;
                    if (saved.row) row = saved.row;
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
            var note = 'Transferred from ' + (fromPatientNo || coupon.patient_id || '') + ' by ' + grantorName(grantor) +
                screenLoginSuffix(grantor);
            return dcWrite('dc_transfer_coupon', {
                p_coupon_id: coupon.id, p_to_patient_id: toPatient.id,
                p_user: grantor.user_id, p_password: grantor.__pw || null, p_note: note
            }, function () {
                return SB.from('discount_coupons').update({ patient_id: toPatient.id, note: note })
                    .eq('id', coupon.id).eq('status', 'unused');
            }).then(function (r) {
                if (!r || !r.ok) return { ok: false, reason: r && r.reason, error: r && r.error };
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
    wireReferrerPickers();

    return {
        samePerson: samePerson,
        isEarlierChart: isEarlierChart,
        maskName: maskName,
        planReferral: planReferral,
        planReferralIssue: planReferralIssue,
        referralLadderOn: referralLadderOn,
        referralCouponValue: referralCouponValue,
        referralTopSpend: referralTopSpend,
        referralLadderPoints: referralLadderPoints,
        referralLadderHtml: referralLadderHtml,
        referralCfgHint: referralCfgHint,
        referralRewardText: referralRewardText,
        billFullyPaid: billFullyPaid,
        referralCouponGate: referralCouponGate,
        referralOptions: referralOptions,
        pickReferralKind: pickReferralKind,
        referralKindsHtml: referralKindsHtml,
        referralThanks: referralThanks,
        referralPointsToReverse: referralPointsToReverse,
        referralBranches: referralBranches,
        selectedReferralKind: selectedReferralKind,
        paintReferralKinds: paintReferralKinds,
        referralPreviewText: referralPreviewText,
        referralReason: referralReason,
        referralsToReopen: referralsToReopen,
        registerReferral: registerReferral,
        referralOnBillPaid: referralOnBillPaid,
        onReferrerEdited: onReferrerEdited,
        onPatientDeleted: onPatientDeleted,
        resetReferrerPicker: resetReferrerPicker,
        pickReferrer: pickReferrer,
        loadReferralList: loadReferralList,
        REF_EDIT_DAYS: REF_EDIT_DAYS,
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
        planDoctorToggle: planDoctorToggle,
        lineMatchesGroup: lineMatchesGroup,
        assessCoupon: assessCoupon,
        pickBest: pickBest,
        canIssue: canIssue,
        planNewChart: planNewChart,
        planTargetSpend: planTargetSpend,
        billTotalCents: billTotalCents,
        refundEffect: refundEffect,
        planPaymentVoid: planPaymentVoid,
        referralStillEarned: referralStillEarned,
        onPaymentVoided: onPaymentVoided,
        smsIssued: smsIssued,
        couponSmsBody: couponSmsBody,
        smsExpiring: smsExpiring,
        expiryReminderStage: expiryReminderStage,
        addMonthsIso: addMonthsIso,
        yearEndReminderStage: yearEndReminderStage,
        smsYearEndCoupons: smsYearEndCoupons,
        sendYearEndCouponReminders: sendYearEndCouponReminders,
        dcWrite: dcWrite,
        dbSmsJobState: dbSmsJobState,
        deskSmsBackupPlan: deskSmsBackupPlan,
        runDeskSmsBackup: runDeskSmsBackup,
        dcFnMissing: dcFnMissing,
        insertCoupon: insertCoupon,
        applyToBill: applyToBill,
        releaseBillCoupons: releaseBillCoupons,
        voidEarnedCoupons: voidEarnedCoupons,
        claimYearEndSms: claimYearEndSms,
        finishYearEndSms: finishYearEndSms,
        todayIso: todayIso,
        renderConfigPane: renderConfigPane,
        walletAvailable: walletAvailable,
        walletLedgerRows: walletLedgerRows,
        effectiveExpiry: effectiveExpiry,
        applyZeroExpiry: applyZeroExpiry,
        freshZeroPolicy: freshZeroPolicy,
        walletTransferable: walletTransferable,
        renderWalletPane: renderWalletPane,
        normalizeZeroPolicy: normalizeZeroPolicy,
        scheduledZeroJob: scheduledZeroJob,
        zeroPolicyChanged: zeroPolicyChanged,
        hkYearStartIso: hkYearStartIso,
        zeroCoupons: zeroCoupons,
        revertLastZero: revertLastZero,
        loadLastZeroBatch: loadLastZeroBatch,
        saveZeroPolicy: saveZeroPolicy,
        maybeRunScheduledZero: maybeRunScheduledZero,
        syncBillDetail: syncBillDetail,
        openBillSheet: openBillSheet,
        onPatientCreated: onPatientCreated,
        onBillFullyPaid: onBillFullyPaid,
        onBillPayment: onBillPayment,
        referralBonusText: referralBonusText,
        referralHeldText: referralHeldText,
        couponNotice: couponNotice,
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
        openWalletPhone: openWalletPhone,
        openLoyaltyQr: openLoyaltyQr,
        loyaltyUrl: loyaltyUrl,
        loyaltyLink: loyaltyLink,
        loyaltyLinkForSms: loyaltyLinkForSms,
        loyaltyLink: loyaltyLink,
        loyaltyWhatsAppText: loyaltyWhatsAppText,
        loyaltyQrConfig: loyaltyQrConfig,
        pointsEarnText: pointsEarnText,
        checkoutPointsLine: checkoutPointsLine,
        couponHintHtml: couponHintHtml,
        walletLiveCount: walletLiveCount,
        loadWallet: loadWallet,
        openPhoneQr: openPhoneQr,
        walletPageBase: walletPageBase,
        walletLinkError: walletLinkError,
        walletSlipHtml: walletSlipHtml,
        walletWhatsAppText: walletWhatsAppText,
        walletUrl: walletUrl,
        phoneLinkForSms: phoneLinkForSms,
        smsWithPhoneLink: smsWithPhoneLink,
        sendCouponSms: sendCouponSms,
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
        matchingItemCoupons: matchingItemCoupons,
        loyaltySnapFromRows: loyaltySnapFromRows,
        loyaltySnapMatches: loyaltySnapMatches,
        loyaltyBadgeHtml: loyaltyBadgeHtml,
        loyaltyDaySnapshots: loyaltyDaySnapshots,
        paintApptLoyalty: paintApptLoyalty,
        loyaltyBroadcastIndex: loyaltyBroadcastIndex,
        tagHouseholdCoupons: tagHouseholdCoupons,
        itemPickerRows: itemPickerRows,
        CASH_GRANT_MAX: CASH_GRANT_MAX,
        SHARED_LOGIN_IDS: SHARED_LOGIN_IDS,
        verifyGrantor: verifyGrantor,
        promptGrantor: promptGrantor,
        openGrantSheet: openGrantSheet,
        loadState: loadState,
        snapshot: snapshot,
        mergeSaved: mergeSaved
    };
})();
