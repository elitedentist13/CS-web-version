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
    var SETTING_KEY = 'discount_coupon_scheme';
    var SMS_HEADING = '[Joyful Smile Dental Clinic 樂意牙科中心]';

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

    /** Treatment coupon first on its line, then one bill-wide coupon on what is left. */
    function combineCoupons(opts) {
        opts = opts || {};
        var picks = (opts.coupons || []).filter(Boolean);
        var item = null;
        var whole = null;
        picks.forEach(function (c) {
            if (couponSlot(c) === 'items') { if (!item) item = c; }
            else if (!whole) whole = c;
        });
        var base = {
            lines: opts.lines, catalog: opts.catalog, billId: opts.billId,
            patientId: opts.patientId, today: opts.today
        };
        var eligibleCents = cents(opts.eligibleCents || 0);
        var rows = [];
        var saveCents = 0;
        if (item) {
            var a1 = assessCoupon(Object.assign({ coupon: item, eligibleCents: money(eligibleCents) }, base));
            if (a1.ok) { rows.push({ coupon: item, assess: a1 }); saveCents += a1.saveCents; }
        }
        if (whole) {
            var left = Math.max(0, eligibleCents - saveCents);
            var a2 = assessCoupon(Object.assign({ coupon: whole, eligibleCents: money(left) }, base));
            if (a2.ok) { rows.push({ coupon: whole, assess: a2 }); saveCents += a2.saveCents; }
        }
        return { rows: rows, saveCents: saveCents, save: money(saveCents) };
    }

    function bestCombination(coupons, opts) {
        opts = opts || {};
        function earliest(a, b) {
            return String(a.expires_on || '9999-12-31') < String(b.expires_on || '9999-12-31');
        }
        var items = (coupons || []).filter(function (c) { return couponSlot(c) === 'items'; });
        var wholes = (coupons || []).filter(function (c) { return couponSlot(c) === 'bill'; });
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

    function unusedCount(wallet) {
        return (wallet || []).filter(function (c) { return c.status === 'unused'; }).length;
    }

    function unusedOfCampaign(wallet, key) {
        return (wallet || []).filter(function (c) {
            return c.status === 'unused' && (c.campaign_key === key || c.key === key);
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
        if (LOCKED_TRANSFER_KEYS[key]) return { ok: false, reason: 'locked' };
        if (!opts.toPatientId || String(opts.toPatientId) === String(c.patient_id || opts.fromPatientId || '')) {
            return { ok: false, reason: 'same_patient' };
        }
        if (unusedCount(opts.toWallet || []) >= WALLET_CAP) return { ok: false, reason: 'wallet_full' };
        var camp = opts.campaign || campaignByKey(key) || { key: key };
        if (atHoldLimit(opts.toWallet || [], camp)) return { ok: false, reason: 'already_holding' };
        return { ok: true, campaignKey: key };
    }

    function smsIssued(coupon) {
        var name = (coupon && (coupon.nameZh || coupon.name)) || '優惠券';
        var amount = coupon && coupon.mode === 'free_line'
            ? name
            : ('HK$' + round2(coupon.face || coupon.face_value || 0).toFixed(2));
        var exp = (coupon && coupon.expires_on) || '';
        return SMS_HEADING + ' 優惠券 / Discount coupon\n' +
            '內容/Offer: ' + name + '\n' +
            '金額/Amount: ' + amount + '\n' +
            '到期/Expires: ' + exp;
    }

    function smsExpiring(coupon, today) {
        if (!coupon || coupon.status !== 'unused' || !coupon.expires_on || !today) return '';
        var exp = new Date(coupon.expires_on + 'T00:00:00');
        var now = new Date(today + 'T00:00:00');
        var days = Math.round((exp.getTime() - now.getTime()) / 86400000);
        if (days !== 7) return '';
        if (coupon.expiryDays != null && coupon.expiryDays <= 7 && coupon.issued_on === today) return '';
        return SMS_HEADING + ' 優惠券即將到期 / Coupon expiring\n' +
            '內容/Offer: ' + (coupon.nameZh || coupon.name || '') + '\n' +
            '到期/Expires: ' + coupon.expires_on + '\n' +
            '7日內到期 / Expires in 7 days';
    }

    function mergeSaved(raw) {
        var saved = raw || {};
        _clinics = saved.clinics || {};
        _doctors = saved.doctors || {};
        var base = defaultCampaigns();
        var byKey = {};
        (saved.campaigns || []).forEach(function (c) { if (c && c.key) byKey[c.key] = c; });
        if (byKey.target_spend && !byKey.spend_1) byKey.spend_1 = byKey.target_spend;
        _campaigns = base.map(function (c) {
            var o = byKey[c.key];
            if (!o) return c;
            var next = clone(c);
            ['enabled', 'face', 'percent', 'minSpend', 'target', 'expiryDays', 'maxDiscount',
                'issueCap', 'budget', 'issuedCount', 'budgetUsed', 'sms', 'mode', 'name', 'nameZh', 'holdLimit'].forEach(function (k) {
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
        return { clinics: _clinics, doctors: _doctors, campaigns: campaigns() };
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

    function setCampaignPatch(key, patch) {
        var c = campaignByKey(key);
        if (!c) return Promise.resolve();
        Object.keys(patch || {}).forEach(function (k) { c[k] = patch[k]; });
        return persist();
    }

    function renderConfigPane(pane) {
        if (!pane) return;
        pane.innerHTML = '<p style="color:#64748b;">' + esc(ct('common.loadingEllipsis', 'Loading…')) + '</p>';
        Promise.all([loadState(), ensureCatalog()]).then(function () { paintConfig(pane); });
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

    function paintConfig(pane) {
        var clinics = (typeof APP_CLINICS !== 'undefined' && APP_CLINICS) ? APP_CLINICS.slice() : [];
        if (!clinics.length) {
            clinics = [
                { clinic_code: 'KT', english_name: 'Kwun Tong' },
                { clinic_code: 'PL', english_name: 'Po Lam' }
            ];
        }
        var open = 0;
        clinics.forEach(function (c, i) {
            if (String(c.clinic_code || '').toUpperCase() === DEFAULT_JOIN_CODE) open = i;
        });
        var html = '<div class="dc-cfg">';
        html += '<h2 class="dc-title">' + esc(ct('coupons.cfg.title', 'Discount Coupons')) + '</h2>';
        html += '<p class="dc-blurb">' + esc(ct('coupons.cfg.blurb',
            'Separate from reward points. KT is joined. Other clinics stay off until you tick them. Each bill can use one whole-bill coupon plus one treatment coupon. A treatment coupon applies only to the catalog items listed on it.')) + '</p>';
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
            html += '<div class="dc-row"><span>' + esc(code) + ' · ' + esc(c.english_name || c.chinese_name || '') + '</span>' +
                '<label class="dc-join"><input type="checkbox" class="dc-clinic-join" data-code="' + esc(code) +
                '" data-id="' + esc(c.id || '') + '"' + (on ? ' checked' : '') + '> ' +
                esc(ct('coupons.cfg.join', 'Join')) + '</label></div>';
            html += '<div class="dc-row dc-doc"><span>' + esc(ct('coupons.cfg.allDoctors', 'All Doctors')) + '</span>' +
                '<label class="dc-join"><input type="checkbox" class="dc-doc-join" data-code="' + esc(code) +
                '" data-doctor="__all__"' + (doctorJoined(code, '__all__') ? ' checked' : '') + '> ' +
                esc(ct('coupons.cfg.join', 'Join')) + '</label></div>';
            docs.forEach(function (d) {
                if (!d || d.is_active === false) return;
                var label = d.english_name || d.chinese_name || d.doctor_code || d.id;
                var key = String(d.id || d.doctor_code || label);
                html += '<div class="dc-row dc-doc"><span>' + esc(label) + '</span>' +
                    '<label class="dc-join"><input type="checkbox" class="dc-doc-join" data-code="' + esc(code) +
                    '" data-doctor="' + esc(key) + '"' + (doctorJoined(code, key) ? ' checked' : '') + '> ' +
                    esc(ct('coupons.cfg.join', 'Join')) + '</label></div>';
            });
            html += '</div>';
        });
        html += '</div>';

        html += '<div class="dc-card"><div class="dc-card-title">' + esc(ct('coupons.cfg.spendTitle', 'Expenditure coupons')) + '</div>';
        html += '<p class="dc-hint">' + esc(ct('coupons.cfg.spendHint',
            'Five combinations. The first three are filled in. The last two stay empty until you set the spend and the coupon. A row issues only when it is on and both amounts are filled. One bill can earn every row it reaches.')) + '</p>';
        campaigns().forEach(function (c) {
            if (!c || c.trigger !== 'target_spend') return;
            var ready = (parseFloat(c.target) || 0) > 0 && (parseFloat(c.face) || 0) > 0;
            var title = campLabel(c);
            html += '<div class="dc-spend" data-camp="' + esc(c.key) + '">';
            html += '<label class="dc-camp-head"><input type="checkbox" class="dc-camp-on" data-key="' + esc(c.key) + '"' +
                (c.enabled ? ' checked' : '') + '><strong class="dc-spend-label">' + esc(title) + '</strong></label>';
            html += '<div class="dc-camp-grid">';
            html += field(c.key, 'target', ct('coupons.cfg.spend', 'Spend HK$'), c.target, true);
            html += field(c.key, 'face', ct('coupons.cfg.get', 'Coupon HK$'), c.face, true);
            html += field(c.key, 'expiryDays', ct('coupons.cfg.expiry', 'Days'), c.expiryDays);
            html += field(c.key, 'holdLimit', ct('coupons.cfg.hold', 'Hold up to'), holdLimitFor(c));
            html += '</div></div>';
        });
        html += '</div>';

        html += '<div class="dc-card"><div class="dc-card-title">' + esc(ct('coupons.cfg.campaigns', 'Campaigns')) + '</div>';
        html += '<p class="dc-hint">' + esc(ct('coupons.cfg.campaignHint',
            'Turn each offer on or off. A treatment coupon fits the items ticked in its list; the smart keyword filter ticks matching items for you.')) + '</p>';
        campaigns().forEach(function (c) {
            if (!c || c.trigger === 'target_spend') return;
            html += '<div class="dc-camp" data-camp="' + esc(c.key) + '">';
            html += '<label class="dc-camp-head"><input type="checkbox" class="dc-camp-on" data-key="' + esc(c.key) + '"' +
                (c.enabled ? ' checked' : '') + '><strong>' + esc(campLabel(c)) + '</strong></label>';
            html += '<div class="dc-camp-grid">';
            html += field(c.key, 'face', 'HK$', c.face);
            if (c.mode === 'percent') html += field(c.key, 'percent', '%', c.percent);
            html += field(c.key, 'expiryDays', ct('coupons.cfg.expiry', 'Days'), c.expiryDays);
            html += field(c.key, 'maxDiscount', ct('coupons.cfg.ceiling', 'Ceiling'), c.maxDiscount);
            html += field(c.key, 'holdLimit', ct('coupons.cfg.hold', 'Hold up to'), holdLimitFor(c));
            html += '</div>';
            if (c.scope === 'items') html += itemPickerHtml(c);
            html += '</div>';
        });
        html += '</div>';
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
            '<button type="button" id="dcLogGo">' + esc(ct('coupons.log.load', 'Show')) + '</button></div>' +
            '<div class="dc-log-wrap" id="dcLogBody"></div></div>';
        html += '</div>';
        pane.innerHTML = html;
        ensureCss();
        wireConfig(pane);
        var go = document.getElementById('dcLogGo');
        if (go) go.onclick = function () { loadCouponLog(); };
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
    function buildCouponLog(coupons, audits, patients) {
        patients = patients || {};
        var out = [];
        (coupons || []).forEach(function (c) {
            var camp = campaignByKey(c.campaign_key) || {};
            var p = patients[String(c.patient_id)] || {};
            var gifted = /gift/i.test(String(c.note || ''));
            out.push({
                at: c.issued_at || '',
                op: gifted ? 'GIFT' : 'ISSUE',
                who: c.issued_by || (gifted ? '' : ct('coupons.log.auto', 'Automatic')),
                clinic: c.clinic_code || '',
                chart: p.patient_no || '',
                coupon: campLabel(camp.key ? camp : c),
                amount: camp.mode === 'free_line' ? '' : ('HK$' + round2(c.face_value).toFixed(2)),
                code: c.code || '',
                status: c.status || '',
                note: c.note || ''
            });
        });
        (audits || []).forEach(function (a) {
            var op = String(a.operation || '').toUpperCase();
            if (op === 'GRANT') return;
            out.push({
                at: a.created_at || '',
                op: op,
                who: a.user_name || a.user_id || '',
                clinic: a.clinic_tag || '',
                chart: a.patient_no || '',
                coupon: '',
                amount: '',
                code: '',
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
            var aq = SB.from('audit_trail').select('*').eq('table_name', 'discount_coupons')
                .gte('created_at', start).lte('created_at', end)
                .order('created_at', { ascending: false }).limit(500);
            if (patient && patient.patient_no) aq = aq.eq('patient_no', patient.patient_no);
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
                    return patientNoMap(Object.keys(ids)).then(function (pmap) {
                        paintCouponLog(body, buildCouponLog(coupons, audits, pmap));
                    });
                });
        });
    }

    function paintCouponLog(body, rows) {
        if (!rows.length) {
            body.innerHTML = '<p class="dc-hint" style="padding:8px;">' + esc(ct('coupons.log.empty', 'No coupon activity in this period.')) + '</p>';
            return;
        }
        var opName = {
            GIFT: ct('coupons.log.gift', '贈送 Gift'),
            ISSUE: ct('coupons.log.issue', '發出 Issue'),
            TRANSFER: ct('coupons.log.transfer', '轉讓 Transfer'),
            RESTORE: ct('coupons.log.restore', '退回 Restore'),
            CANCEL: ct('coupons.log.cancel', '取消 Cancel')
        };
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
                '<td class="dc-op">' + esc(opName[r.op] || r.op) + '</td>' +
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

    function field(key, prop, label, value, blankZero) {
        var empty = !!blankZero && !((parseFloat(value) || 0) > 0);
        var shown = empty ? '' : value;
        return '<label class="dc-field"><span>' + esc(label) + '</span>' +
            '<input type="number" class="dc-num" data-key="' + esc(key) + '" data-prop="' + esc(prop) +
            '" value="' + esc(shown) + '"' + (empty ? ' placeholder="—"' : '') +
            ' min="0" step="0.01"></label>';
    }

    function wireConfig(pane) {
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
            });
        });
        pane.querySelectorAll('.dc-doc-join').forEach(function (box) {
            box.addEventListener('change', function () {
                setDoctorJoined(box.getAttribute('data-code'), box.getAttribute('data-doctor'), box.checked);
            });
        });
        pane.querySelectorAll('.dc-camp-on').forEach(function (box) {
            box.addEventListener('change', function () {
                setCampaignPatch(box.getAttribute('data-key'), { enabled: box.checked });
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
                    bill.coupon_label = used.map(function (c) { return campLabel(c); }).join(' + ');
                    var label = document.getElementById('bdCouponLabel');
                    if (label) label.textContent = bill.coupon_label;
                }
                var lines = [];
                if (earned.length) {
                    lines.push('🎟️ ' + ct('coupons.info.earned', 'Earned from this bill') + ': ' + earned.map(function (c) {
                        return campLabel(c) + ' HK$' + round2(c.face_value).toFixed(0) +
                            (c.expires_on ? ' (' + ct('coupons.info.expires', 'expires') + ' ' + c.expires_on + ')' : '');
                    }).join(' · '));
                }
                var voided = !!bill.voided_at;
                var due = parseFloat(bill.total) || 0;
                if (!voided && !earned.length) {
                    var prog = spendProgress(due);
                    if (prog.reached.length) {
                        lines.push('✅ ' + ct('coupons.info.willEarn', 'Paid in full by cash, this bill earns') + ': ' +
                            prog.reached.map(campLabel).join(' + '));
                    }
                    if (prog.next) {
                        lines.push('➕ ' + ct('coupons.info.short', 'Spend') + ' HK$' + prog.shortBy.toFixed(2) + ' ' +
                            ct('coupons.info.more', 'more for') + ' ' + campLabel(prog.next));
                    }
                }
                info.hidden = !lines.length;
                info.innerHTML = lines.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('');
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
                paintSheet(bill, wallet, clinicCode, { allowApply: !paid, focusGift: !!opts.gift });
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
        host.innerHTML = '<div class="dc-sheet"><button type="button" class="dc-x" id="dcSheetClose">×</button>' +
            '<h3>' + esc(ct('coupons.bill.title', '優惠券')) + '</h3><p>' + esc(msg) + '</p></div>';
        host.removeAttribute('hidden');
        var x = document.getElementById('dcSheetClose');
        if (x) x.onclick = closeSheet;
    }

    function ensureSheet() {
        var host = document.getElementById('dcSheetHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'dcSheetHost';
            host.setAttribute('hidden', '');
            document.body.appendChild(host);
        }
        return host;
    }

    function closeSheet() {
        var host = document.getElementById('dcSheetHost');
        if (host) host.setAttribute('hidden', '');
    }

    var _lastSheet = null;

    function paintSheet(bill, wallet, clinicCode, opts) {
        opts = opts || {};
        _lastSheet = [bill, wallet, clinicCode, opts];
        var allowApply = opts.allowApply !== false;
        var catalog = (typeof treatmentItemsCache !== 'undefined' && treatmentItemsCache) ? treatmentItemsCache : [];
        var lines = parseItems(bill);
        var eligible = eligibleBeforeCoupon(bill);
        var today = new Date().toISOString().slice(0, 10);
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
        var picked = { items: '', bill: '' };
        var startFrom = onThisBill.length ? onThisBill : Object.keys(bestIds);
        startFrom.forEach(function (id) {
            usable.forEach(function (r) {
                if (String(r.coupon.id) === String(id)) picked[couponSlot(r.coupon)] = String(id);
            });
        });
        var focusId = picked.bill || picked.items || (blocked[0] ? String(blocked[0].coupon.id) : '');
        var host = ensureSheet();
        var html = '<div class="dc-sheet" role="dialog">';
        html += '<button type="button" class="dc-x" id="dcSheetClose">×</button>';
        html += '<h3>' + esc(ct('coupons.bill.title', '優惠券')) + '</h3>';
        html += '<div class="dc-chips"><button type="button" class="dc-chip is-on" data-filter="all">' +
            esc(ct('coupons.chip.all', 'All')) + '</button>' +
            '<button type="button" class="dc-chip" data-filter="bill">' + esc(ct('coupons.chip.bill', 'Whole bill')) + '</button>' +
            '<button type="button" class="dc-chip" data-filter="free_line">' + esc(ct('coupons.chip.free', 'Free treatment')) + '</button>' +
            '<button type="button" class="dc-chip" data-filter="items">' + esc(ct('coupons.chip.items', 'Implant / ortho')) + '</button></div>';
        html += '<div class="dc-cards">';
        if (!usable.length && !blocked.length) {
            html += '<p class="dc-empty">' + esc(ct('coupons.bill.empty', 'This patient has no unused coupons.')) + '</p>';
        }
        html += '<p class="dc-hint">' + esc(ct('coupons.bill.rule',
            'One bill-wide coupon (cash, spend, new chart, referral) and one treatment coupon can be used together. Tap a card to choose or unchoose it.')) + '</p>';
        html += rulesNoteHtml();
        usable.forEach(function (row) {
            html += cardHtml(row, !!bestIds[String(row.coupon.id)], false);
        });
        blocked.forEach(function (row) { html += cardHtml(row, false, true); });
        html += '</div>';
        html += '<div class="dc-preview" id="dcPreview"></div>';
        html += '<p class="dc-why" id="dcWhy" hidden></p>';
        if (allowApply) {
            html += '<div class="dc-actions"><button type="button" id="dcApply" class="dc-apply">' +
                esc(ct('coupons.bill.apply', 'Apply')) + '</button>' +
                '<button type="button" id="dcClear" class="dc-clear">' +
                esc(ct('coupons.bill.clear', '不使用優惠券')) + '</button></div>';
        } else {
            html += '<p class="dc-hint">' + esc(ct('coupons.grant.paid', 'This bill is already paid. A gifted coupon stays in the wallet for a later bill.')) + '</p>';
        }
        var giftChoices = campaigns().filter(function (c) {
            return c && c.trigger === 'manual' && c.enabled && !AUTO_GRANT_KEYS[c.key];
        });
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
                '<button type="button" id="dcGiftGo">' + esc(ct('coupons.grant.go', 'Gift to wallet')) + '</button></div>' +
                '<p id="dcGiftOffer" class="dc-hint"></p>';
        }
        html += '<p id="dcGiftErr" class="dc-err" hidden></p></div>';
        html += '<div class="dc-transfer"><label>' + esc(ct('coupons.xfer.to', 'Transfer selected to chart no.')) + '</label>' +
            '<input type="text" id="dcXferTo" autocomplete="off">' +
            '<button type="button" id="dcXferGo">' + esc(ct('coupons.xfer.go', 'Transfer')) + '</button>' +
            '<p id="dcXferErr" class="dc-err" hidden></p></div>';
        html += '</div>';
        host.innerHTML = html;
        host.removeAttribute('hidden');
        document.getElementById('dcSheetClose').onclick = closeSheet;
        function rowById(id) {
            var found = null;
            usable.concat(blocked).forEach(function (r) { if (String(r.coupon.id) === String(id)) found = r; });
            return found;
        }
        function currentCombo() {
            var list = [];
            if (picked.items) list.push(rowById(picked.items).coupon);
            if (picked.bill) list.push(rowById(picked.bill).coupon);
            return combineCoupons(Object.assign({}, ctxOpts, { coupons: list }));
        }
        function refreshPreview() {
            var combo = currentCombo();
            host.querySelectorAll('.dc-card').forEach(function (el) {
                var id = el.getAttribute('data-id');
                el.classList.toggle('is-picked', id === picked.items || id === picked.bill);
                el.classList.toggle('is-focus', id === focusId);
                var save = el.querySelector('.dc-save');
                combo.rows.forEach(function (r) {
                    if (save && String(r.coupon.id) === id) save.textContent = '−' + r.assess.save.toFixed(2);
                });
            });
            var el = document.getElementById('dcPreview');
            if (el) {
                if (!combo.rows.length) {
                    el.textContent = ct('coupons.bill.totalStays', 'Total stays') + ' ' + eligible.toFixed(2);
                } else {
                    var parts = combo.rows.map(function (r) {
                        return '− ' + r.assess.save.toFixed(2) + ' (' + campLabel(r.coupon) + ')';
                    });
                    var next = Math.max(0, round2(eligible - combo.save));
                    el.textContent = eligible.toFixed(2) + ' ' + parts.join(' ') + ' → ' + next.toFixed(2) +
                        '  ·  ' + ct('coupons.bill.saving', 'Saving') + ' HK$' + combo.save.toFixed(2);
                }
            }
            var why = document.getElementById('dcWhy');
            var focusRow = rowById(focusId);
            if (why) {
                if (focusRow && !focusRow.assess.ok) {
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
                if (card.getAttribute('data-ok') === '1') {
                    var slot = card.getAttribute('data-slot') === 'items' ? 'items' : 'bill';
                    picked[slot] = picked[slot] === id ? '' : id;
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
        if (giftGo) giftGo.onclick = function () {
            var err = document.getElementById('dcGiftErr');
            var kind = giftKind ? giftKind.value : '';
            var amt = (document.getElementById('dcGiftAmount') || {}).value;
            grantToWallet(bill.patient_id, kind, amt, bill.patient_no).then(function (res) {
                if (!res || !res.ok) {
                    if (err) {
                        err.hidden = false;
                        err.textContent = grantReason((res && (res.reason || res.error)) || '');
                    }
                    return;
                }
                var camp = campaignByKey(kind) || {};
                couponNotice('🎁 ' + (campLabel(camp.key ? camp : null) || kind) + ' ' +
                    ct('coupons.notice.gifted', 'added to the wallet. Logged under') + ' ' + (actorName() || '—'));
                openBillSheet(bill, { gift: true });
            });
        };
        if (opts.focusGift && giftKind) giftKind.focus();
        document.getElementById('dcXferGo').onclick = function () {
            var err = document.getElementById('dcXferErr');
            var focusRow = rowById(focusId);
            var chosen = focusRow ? focusRow.coupon : null;
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
            resolveReferrer(chart).then(function (to) {
                if (!to) { showErr(ct('coupons.xfer.missing', 'Chart not found')); return; }
                var raw = (wallet || []).filter(function (c) { return String(c.id) === String(chosen.id); })[0] || chosen;
                transferSelected(raw, to, bill.patient_no).then(function (res) {
                    if (!res || !res.ok) { showErr((res && (res.reason || res.error)) || 'Transfer failed'); return; }
                    closeSheet();
                    openBillSheet(bill);
                });
            });
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

    function cardHtml(row, best, blocked) {
        var c = row.coupon;
        var reason = reasonText(row.assess);
        var slot = couponSlot(c);
        return '<button type="button" data-no-click-guard="1" class="dc-card' + (blocked ? ' is-blocked' : '') +
            '" data-id="' + esc(c.id) + '" data-ok="' + (row.assess.ok ? '1' : '0') +
            '" data-slot="' + slot + '" data-mode="' + esc(c.mode) + '" data-scope="' + esc(c.scope) + '">' +
            '<i class="dc-check" aria-hidden="true">✓</i>' +
            '<strong>' + esc(campLabel(c)) + '</strong>' +
            '<span class="dc-save">' + (row.assess.ok ? ('−' + row.assess.save.toFixed(2)) : esc(reason)) + '</span>' +
            (best ? '<em class="dc-best">' + esc(ct('coupons.bill.best', '最優')) + '</em>' : '') +
            '<b class="dc-picked">' + esc(ct('coupons.bill.picked', '已選')) + '</b>' +
            '<small>' + esc(slot === 'items' ? ct('coupons.bill.slotItems', '治療券') : ct('coupons.bill.slotBill', '全單券')) +
            ' · ' + esc(c.expires_on || '') + '</small></button>';
    }

    function rulesNoteHtml() {
        var rules = [
            ['r1', 'Per bill: one whole-bill coupon (cash, spend, new chart, referral) plus one treatment coupon. The treatment coupon comes off first; the whole-bill coupon takes off what is left.'],
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
        bill.coupon_label = rows.map(function (r) { return campLabel(r.coupon); }).join(' + ');
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
            if (sms && row.patient_id) sendCouponSms(row.patient_id, smsIssued({
                nameZh: (campaignByKey(row.campaign_key) || {}).nameZh,
                mode: row.discount_mode,
                face: row.face_value,
                expires_on: row.expires_on
            }));
            return { ok: true, id: saved.id, code: saved.code || row.code };
        }, function (e) {
            return { ok: false, error: String(e && e.message || e), row: row };
        });
    }

    function sendCouponSms(patientId, body) {
        if (!body || typeof SB === 'undefined' || !SB) return;
        SB.from('patients').select('mobile_phone,phone,full_name').eq('id', patientId).maybeSingle()
            .then(function (r) {
                var p = r && r.data;
                var phone = p && (p.mobile_phone || p.phone);
                if (!phone || typeof AIHELPER === 'undefined' || typeof AIHELPER.sendTwilioOutreach !== 'function') return;
                AIHELPER.sendTwilioOutreach({ to: phone, body: body });
            });
    }

    function onPatientCreated(row, referredBy) {
        var clinicCode = '';
        if (typeof currentClinicCodeForTagging === 'function') clinicCode = currentClinicCodeForTagging() || '';
        return loadState().then(function () {
            return resolveReferrer(referredBy).then(function (ref) {
                var plans = planNewChart({
                    clinicCode: clinicCode,
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
        host.innerHTML = lines.map(function (t) { return '<div>' + esc(t) + '</div>'; }).join('');
    }

    function onBillFullyPaid(info) {
        info = info || {};
        var clinicCode = String(info.clinicCode || '').trim() ||
            String((typeof bdCurrentBill !== 'undefined' && bdCurrentBill && bdCurrentBill.clinic_tag) || '').trim() ||
            clinicCodeNow();
        return Promise.all([
            loadState(),
            billCashPaid(info.billId, info.cashAmount),
            (typeof SB !== 'undefined' && SB && info.billId)
                ? SB.from('discount_coupons').select('campaign_key,status').eq('origin_bill_id', info.billId)
                    .then(function (r) { return (r && r.data) || []; }, function () { return []; })
                : Promise.resolve([])
        ]).then(function (res) {
            var cashPaid = res[1];
            var already = {};
            (res[2] || []).forEach(function (c) { if (c.status !== 'void') already[c.campaign_key] = true; });
            var list = campaigns().filter(function (c) { return !already[c.key]; });
            return loadWallet(info.patientId).then(function (wallet) {
                var plan = planTargetSpend({
                    clinicCode: clinicCode,
                    doctorKey: info.doctorKey,
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

    function logCoupon(operation, detail, patientNo, recordId) {
        if (typeof recordAuditTrail !== 'function') return;
        try {
            recordAuditTrail({
                audit_item: 'COUPON ' + operation,
                table_name: 'discount_coupons',
                operation: operation,
                record_id: recordId || null,
                patient_no: patientNo || null,
                changes_detail: detail,
                user_id: (typeof currentUserId !== 'undefined' ? currentUserId : null),
                user_name: actorName()
            });
        } catch (e) {}
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

    function grantToWallet(patientId, campaignKey, amount, patientNo) {
        return loadState().then(function () {
            var joined = clinicJoined(clinicCodeNow());
            var role = (typeof currentRole !== 'undefined' && currentRole) ? currentRole : '';
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
                    issuedBy: actorName(),
                    note: 'Gifted into wallet'
                });
                return insertCoupon(row, camp.sms !== false).then(function (saved) {
                    if (saved && saved.ok) {
                        logCoupon('GRANT', (camp.nameZh || camp.key) + ' HK$' + round2(row.face_value).toFixed(2) +
                            ' code ' + (saved.code || row.code), patientNo || null, saved.id || null);
                    }
                    return saved;
                });
            });
        });
    }

    function transferSelected(coupon, toPatient, fromPatientNo) {
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
                note: 'Transferred from ' + (fromPatientNo || coupon.patient_id || '')
            }).eq('id', coupon.id).eq('status', 'unused').then(function (r) {
                if (r.error) return { ok: false, error: r.error.message };
                logCoupon('TRANSFER', 'Coupon ' + (coupon.code || coupon.id) + ' to ' + (toPatient.patient_no || toPatient.id),
                    toPatient.patient_no || null, coupon.id);
                return { ok: true };
            });
        });
    }

    function ensureCss() {
        if (document.getElementById('dc-css')) return;
        var style = document.createElement('style');
        style.id = 'dc-css';
        style.textContent = [
            '.dc-cfg{max-width:920px;color:#0f172a;}',
            '.dc-title{margin:0 0 6px;font-size:20px;}',
            '.dc-blurb,.dc-hint{margin:0 0 12px;color:#64748b;font-size:13px;line-height:1.45;}',
            '.dc-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px 16px;margin-bottom:14px;}',
            '.dc-card-title{font-weight:800;margin-bottom:8px;}',
            '.dc-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;}',
            '.dc-tab{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:6px 12px;cursor:pointer;font-weight:700;}',
            '.dc-tab.is-active{background:#0f766e;color:#fff;border-color:#0f766e;}',
            '.dc-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#86efac;margin-left:6px;}',
            '.dc-row{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9;}',
            '.dc-doc{padding-left:14px;}',
            '.dc-join{font-size:13px;font-weight:700;color:#0f766e;}',
            '.dc-spend{border-top:1px solid #e2e8f0;padding:10px 0;}',
            '.dc-spend-label{font-weight:800;}',
            '.dc-camp{border-top:1px solid #e2e8f0;padding:10px 0;}',
            '.dc-camp-head{display:flex;gap:8px;align-items:center;font-size:14px;}',
            '.dc-camp-head span{color:#64748b;font-weight:500;}',
            '.dc-camp-grid{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;}',
            '.dc-field{display:flex;flex-direction:column;font-size:11px;color:#64748b;gap:2px;}',
            '.dc-field input{width:88px;padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px;}',
            '.dc-items{display:flex;flex-direction:column;gap:4px;margin-top:6px;}',
            '.dc-item{font-size:12px;color:#334155;}',
            '#dcSheetHost{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:8000;display:flex;align-items:center;justify-content:center;padding:18px;}',
            '#dcSheetHost[hidden]{display:none;}',
            '.dc-sheet{background:#fff;width:min(520px,100%);max-height:min(86vh,760px);overflow:auto;border-radius:16px;padding:16px 16px 18px;position:relative;}',
            '.dc-x{position:absolute;top:8px;right:10px;border:none;background:none;font-size:22px;cursor:pointer;}',
            '.dc-chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0;}',
            '.dc-chip{border:1px solid #cbd5e1;background:#fff;border-radius:999px;padding:4px 10px;cursor:pointer;font-size:12px;}',
            '.dc-chip.is-on{background:#0f766e;color:#fff;border-color:#0f766e;}',
            'button.dc-card{width:100%;text-align:left;border:1px solid #dbeafe;background:#f8fafc;border-radius:12px;padding:10px 12px;margin-bottom:8px;cursor:pointer;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline;}',
            'button.dc-card{position:relative;}',
            'button.dc-card.is-picked{border-color:#0f766e;background:#ecfdf5;box-shadow:0 0 0 2px #0f766e inset;}',
            'button.dc-card.is-blocked{background:#f8fafc;border-style:dashed;border-color:#cbd5e1;cursor:pointer;}',
            'button.dc-card.is-blocked strong{color:#64748b;}',
            'button.dc-card.is-blocked .dc-save{color:#b45309;font-weight:700;}',
            'button.dc-card.is-focus{outline:2px solid #1e3a5f;outline-offset:1px;}',
            'button.dc-card .dc-save{color:#0f766e;font-weight:800;}',
            'button.dc-card em.dc-best{color:#b45309;background:#fef3c7;border-radius:999px;padding:1px 8px;font-style:normal;font-size:11px;font-weight:800;}',
            'button.dc-card .dc-picked{display:none;color:#fff;background:#0f766e;border-radius:999px;padding:1px 8px;font-size:11px;}',
            'button.dc-card.is-picked .dc-picked{display:inline-block;}',
            'button.dc-card .dc-check{display:none;position:absolute;top:8px;right:10px;color:#0f766e;font-style:normal;font-weight:900;}',
            'button.dc-card.is-picked .dc-check{display:block;}',
            'button.dc-card small{flex-basis:100%;color:#64748b;}',
            '.dc-why{margin:6px 0 0;padding:8px 10px;border-radius:8px;background:#fffbeb;border:1px solid #fde68a;color:#92400e;font-size:12px;}',
            '.dc-why[hidden]{display:none;}',
            '.dc-items-box{margin-top:8px;padding:8px 10px;border:1px dashed #cbd5e1;border-radius:10px;background:#f8fafc;}',
            '.dc-smart-row{display:flex;align-items:center;gap:6px;font-weight:700;font-size:13px;}',
            '.dc-kw-row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:6px 0;}',
            '.dc-kw-row label{display:flex;flex-direction:column;font-size:12px;color:#475569;gap:3px;}',
            '.dc-kw-row input{padding:5px 8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;}',
            '.dc-pick{border:1px solid #cbd5e1;border-radius:8px;background:#fff;}',
            '.dc-pick summary{cursor:pointer;padding:7px 10px;font-weight:700;font-size:13px;list-style:revert;}',
            '.dc-pick-q{display:block;width:calc(100% - 20px);margin:0 10px 6px;padding:5px 8px;border:1px solid #cbd5e1;border-radius:8px;font-size:12px;box-sizing:border-box;}',
            '.dc-pick-list{max-height:260px;overflow:auto;padding:0 10px 8px;}',
            '.dc-pick-item{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:12px;border-bottom:1px solid #f1f5f9;}',
            '.dc-pick-item span{flex:1;}',
            '.dc-auto,.dc-excl,.dc-gone{font-style:normal;font-size:10px;padding:1px 6px;border-radius:999px;}',
            '.dc-auto{background:#dcfce7;color:#166534;}',
            '.dc-excl{background:#fee2e2;color:#991b1b;}',
            '.dc-gone{background:#f1f5f9;color:#64748b;}',
            '.dc-pick-hint{margin:6px 0 0;font-size:11px;}',
            '.dc-rules{margin:0 0 10px;border:1px solid #bae6fd;background:#f0f9ff;border-radius:10px;padding:6px 10px;font-size:12px;color:#0c4a6e;}',
            '.dc-rules summary{cursor:pointer;font-weight:700;list-style:revert;}',
            '.dc-rules ol{margin:6px 0 2px;padding-left:18px;line-height:1.5;}',
            '.dc-rules li{margin:2px 0;}',
            '.dc-rules-hold{color:#475569;}',
            '.dc-apply:disabled{opacity:.5;cursor:not-allowed;}',
            '#bdSavedRow[hidden],#bdCouponInfo[hidden]{display:none!important;}',
            '.dc-log-filter{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;}',
            '.dc-log-filter input{padding:6px 8px;border:1px solid #cbd5e1;border-radius:8px;}',
            '.dc-log-filter button{padding:6px 12px;border:none;border-radius:8px;background:#1e3a5f;color:#fff;font-weight:700;cursor:pointer;}',
            '.dc-log-wrap{max-height:420px;overflow:auto;border:1px solid #e2e8f0;border-radius:8px;}',
            '.dc-log{width:100%;border-collapse:collapse;font-size:12px;}',
            '.dc-log th{position:sticky;top:0;background:#f1f5f9;text-align:left;padding:6px 8px;}',
            '.dc-log td{padding:6px 8px;border-top:1px solid #f1f5f9;vertical-align:top;}',
            '.dc-log .dc-op{font-weight:800;}',
            '.dc-notice{position:fixed;right:18px;bottom:18px;z-index:9000;max-width:380px;background:#065f46;color:#fff;border-radius:12px;padding:12px 14px;box-shadow:0 10px 30px rgba(0,0,0,.25);font-size:13px;line-height:1.5;}',
            '.dc-preview{font-weight:800;margin:8px 0;color:#0f172a;}',
            '.dc-actions{display:flex;gap:8px;}',
            '.dc-apply{flex:1;background:#0f766e;color:#fff;border:none;border-radius:10px;padding:10px;font-weight:800;cursor:pointer;}',
            '.dc-clear{flex:1;background:#e2e8f0;border:none;border-radius:10px;padding:10px;font-weight:700;cursor:pointer;}',
            '.dc-err{color:#dc2626;font-size:12px;font-weight:700;margin:8px 0 0;}',
            '.dc-gift{margin-top:14px;padding-top:12px;border-top:1px solid #e2e8f0;}',
            '.dc-gift label{font-weight:800;}',
            '.dc-gift-row{display:flex;gap:8px;align-items:center;margin-top:8px;}',
            '.dc-gift-row select{flex:1;min-width:160px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;}',
            '.dc-gift-row input{width:96px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;}',
            '.dc-gift-row input[hidden]{display:none;}',
            '.dc-gift-row button{padding:8px 12px;border:none;border-radius:8px;background:#0f766e;color:#fff;font-weight:700;cursor:pointer;}',
            '.dc-transfer{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;}',
            '.dc-transfer input{flex:1;min-width:140px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;}',
            '.dc-transfer button{padding:8px 12px;border:none;border-radius:8px;background:#1e3a5f;color:#fff;font-weight:700;cursor:pointer;}',
            '#bdCouponGrant{padding:4px 10px;border:1px solid #1e3a5f;background:#fff;color:#1e3a5f;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;}',
            '#bdCouponRow.is-locked #bdCouponPick{opacity:.5;}'
        ].join('');
        document.head.appendChild(style);
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

    return {
        WALLET_CAP: WALLET_CAP,
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
        _paintSheet: paintSheet,
        campLabel: campLabel,
        paintCheckoutHint: paintCheckoutHint,
        ITEM_KEYWORDS: ITEM_KEYWORDS,
        keywordHit: keywordHit,
        itemRule: itemRule,
        nameFitsRule: nameFitsRule,
        itemPickerRows: itemPickerRows,
        CASH_GRANT_MAX: CASH_GRANT_MAX,
        openGrantSheet: openGrantSheet,
        loadState: loadState,
        snapshot: snapshot,
        mergeSaved: mergeSaved
    };
})();
