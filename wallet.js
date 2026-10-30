/* Patient coupon wallet (wallet.html?t=<token>) — browse only. Reads one wallet through the dc_wallet_view RPC. */
(function (root) {
    'use strict';

    var LANGS = ['en', 'zh-Hant', 'zh-CN'];
    var LANG_KEY = 'csWalletLang';

    var T = {
        title: { en: 'My coupons', 'zh-Hant': '我的優惠券', 'zh-CN': '我的优惠券' },
        clinic: { en: 'Joyful Smile Dental Centre', 'zh-Hant': '樂意牙科中心', 'zh-CN': '乐意牙科中心' },
        loading: { en: 'Loading…', 'zh-Hant': '載入中…', 'zh-CN': '载入中…' },
        foot: {
            en: 'Browse only. Show this page at the counter; staff will apply your coupons to the bill.',
            'zh-Hant': '只供瀏覽。結賬時向職員出示此頁，職員會為您使用優惠券。',
            'zh-CN': '只供浏览。结账时向职员出示此页，职员会为您使用优惠券。'
        },
        ready: { en: 'Ready to use', 'zh-Hant': '可使用', 'zh-CN': '可使用' },
        past: { en: 'Used or expired', 'zh-Hant': '已使用或已過期', 'zh-CN': '已使用或已过期' },
        showPast: { en: 'Show used and expired coupons', 'zh-Hant': '顯示已使用及已過期的券', 'zh-CN': '显示已使用及已过期的券' },
        hidePast: { en: 'Hide used and expired coupons', 'zh-Hant': '隱藏已使用及已過期的券', 'zh-CN': '隐藏已使用及已过期的券' },
        yearEnd: {
            en: 'All discount coupons expire on 31 Dec {YEAR} 23:59 this year. Please make good use of them, and you are welcome to invite others to use them.',
            'zh-Hant': '所有優惠券將於今年{YEAR}年12月31日 23:59到期，請好好善用；歡迎邀請親友使用。',
            'zh-CN': '所有优惠券将于今年{YEAR}年12月31日 23:59到期，请好好善用；欢迎邀请亲友使用。'
        },
        cashBoth: {
            en: 'Cash coupons per bill: at most {PCT}% of the bill, up to {AMT}.',
            'zh-Hant': '每張賬單現金券最多扣減賬單金額 {PCT}%，最多 {AMT}。',
            'zh-CN': '每张账单现金券最多扣减账单金额 {PCT}%，最多 {AMT}。'
        },
        cashAmt: {
            en: 'Cash coupons per bill: at most {AMT}.',
            'zh-Hant': '每張賬單現金券最多扣減 {AMT}。',
            'zh-CN': '每张账单现金券最多扣减 {AMT}。'
        },
        cashPct: {
            en: 'Cash coupons per bill: at most {PCT}% of the bill.',
            'zh-Hant': '每張賬單現金券最多扣減賬單金額 {PCT}%。',
            'zh-CN': '每张账单现金券最多扣减账单金额 {PCT}%。'
        },
        cashCount: {
            en: 'Up to {N} cash coupons per bill.',
            'zh-Hant': '每張賬單最多使用 {N} 張現金券。',
            'zh-CN': '每张账单最多使用 {N} 张现金券。'
        },
        none: { en: 'You have no coupons ready to use right now.', 'zh-Hant': '您暫時沒有可使用的優惠券。', 'zh-CN': '您暂时没有可使用的优惠券。' },
        sumCount: { en: 'coupons', 'zh-Hant': '張優惠券', 'zh-CN': '张优惠券' },
        sumValue: { en: 'cash value', 'zh-Hant': '現金價值', 'zh-CN': '现金价值' },
        sumNext: { en: 'next expiry', 'zh-Hant': '最快到期', 'zh-CN': '最快到期' },
        validUntil: { en: 'Valid until', 'zh-Hant': '有效期至', 'zh-CN': '有效期至' },
        daysLeft: { en: 'days left', 'zh-Hant': '日後到期', 'zh-CN': '日后到期' },
        lastDay: { en: 'Last day today', 'zh-Hant': '今日最後一天', 'zh-CN': '今日最后一天' },
        used: { en: 'Used', 'zh-Hant': '已使用', 'zh-CN': '已使用' },
        expired: { en: 'Expired', 'zh-Hant': '已過期', 'zh-CN': '已过期' },
        usedOn: { en: 'Used on', 'zh-Hant': '使用日期', 'zh-CN': '使用日期' },
        saved: { en: 'saved', 'zh-Hant': '已節省', 'zh-CN': '已节省' },
        minSpend: { en: 'Min. spend', 'zh-Hant': '最低消費', 'zh-CN': '最低消费' },
        upTo: { en: 'up to', 'zh-Hant': '最多', 'zh-CN': '最多' },
        forItems: { en: 'For', 'zh-Hant': '適用', 'zh-CN': '适用' },
        wholeBill: { en: 'Off the whole bill', 'zh-Hant': '全單適用', 'zh-CN': '全单适用' },
        free: { en: 'FREE', 'zh-Hant': '免費', 'zh-CN': '免费' },
        code: { en: 'Code', 'zh-Hant': '編號', 'zh-CN': '编号' },
        badLink: {
            en: 'This wallet link is not valid any more. Please ask the clinic for a new QR code.',
            'zh-Hant': '此錢包連結已失效，請向診所索取新的 QR 碼。',
            'zh-CN': '此钱包链接已失效，请向诊所索取新的二维码。'
        },
        expiredLink: {
            en: 'This wallet link has expired. Please ask the clinic for a new QR code.',
            'zh-Hant': '此錢包連結已過期，請向診所索取新的 QR 碼。',
            'zh-CN': '此钱包链接已过期，请向诊所索取新的二维码。'
        },
        offline: {
            en: 'Could not load your coupons. Check the connection and try again.',
            'zh-Hant': '無法載入優惠券，請檢查網絡後再試。',
            'zh-CN': '无法载入优惠券，请检查网络后再试。'
        },
        kind_cash: { en: 'Cash', 'zh-Hant': '現金券', 'zh-CN': '现金券' },
        kind_spend: { en: 'Spend reward', 'zh-Hant': '滿額回贈', 'zh-CN': '满额回赠' },
        kind_welcome: { en: 'Welcome', 'zh-Hant': '新客', 'zh-CN': '新客' },
        kind_referral: { en: 'Referral', 'zh-Hant': '介紹', 'zh-CN': '介绍' },
        kind_free: { en: 'Free treatment', 'zh-Hant': '免費治療', 'zh-CN': '免费治疗' },
        kind_treat: { en: 'Treatment', 'zh-Hant': '治療優惠', 'zh-CN': '治疗优惠' }
    };

    var NAMES = {
        cash: ['Cash coupon', '現金券', '现金券'],
        spend_1: ['Spend $1000 get $100', '滿$1000送$100', '满$1000送$100'],
        spend_2: ['Spend $5000 get $500', '滿$5000送$500', '满$5000送$500'],
        spend_3: ['Spend $10000 get $1000', '滿$10000送$1000', '满$10000送$1000'],
        new_chart: ['New patient coupon', '新客券', '新客券'],
        referral: ['Refer a friend', '介紹新客', '介绍新客'],
        free_scaling: ['Free scaling', '免費洗牙', '免费洗牙'],
        free_filling: ['Free filling', '免費補牙', '免费补牙'],
        free_extraction: ['Free extraction', '免費脫牙', '免费脱牙'],
        implant: ['Implant discount', '植牙優惠', '植牙优惠'],
        ortho: ['Orthodontic discount', '矯齒優惠', '矫齿优惠'],
        crown_bridge: ['Crown and bridge', '牙套牙橋優惠', '牙套牙桥优惠'],
        root_canal: ['Root canal', '根管優惠', '根管优惠'],
        whitening: ['Whitening', '美白優惠', '美白优惠']
    };

    function tr(key, lang) {
        var row = T[key];
        if (!row) return key;
        return row[lang] || row['zh-Hant'] || row.en;
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
        });
    }

    function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
    function hk(v) { return 'HK$' + Math.round(num(v)).toLocaleString('en-US'); }

    function kindOf(c) {
        var key = String(c.campaign_key || '');
        if (key === 'cash') return 'cash';
        if (key === 'new_chart') return 'welcome';
        if (key === 'referral') return 'referral';
        if (key.indexOf('spend') === 0) return 'spend';
        if (c.discount_mode === 'free_line') return 'free';
        return 'treat';
    }

    function campaignLabel(c, campaigns, lang) {
        var key = String(c.campaign_key || '');
        var camp = (campaigns || []).filter(function (x) { return x && x.key === key; })[0] || null;
        var zhT = lang === 'zh-Hant';
        var zhS = lang === 'zh-CN';
        if (camp && camp.trigger === 'target_spend' && num(camp.target) > 0 && num(camp.face) > 0) {
            var t = Math.round(num(camp.target));
            var f = Math.round(num(camp.face));
            if (zhT) return '滿$' + t + '送$' + f;
            if (zhS) return '满$' + t + '送$' + f;
            return 'Spend $' + t + ' get $' + f;
        }
        if (camp && lang === 'en' && camp.name) return camp.name;
        if (camp && lang !== 'en' && camp.nameZh) return camp.nameZh;
        var row = NAMES[key];
        if (row) return zhT ? row[1] : zhS ? row[2] : row[0];
        return (camp && (camp.name || camp.nameZh)) || key;
    }

    function faceText(c, lang) {
        if (c.discount_mode === 'free_line') return tr('free', lang);
        if (c.discount_mode === 'percent') return Math.round(num(c.percent) * 100) / 100 + '%';
        return hk(c.face_value);
    }

    function daysBetween(fromIso, toIso) {
        var a = Date.parse(String(fromIso).slice(0, 10) + 'T00:00:00Z');
        var b = Date.parse(String(toIso).slice(0, 10) + 'T00:00:00Z');
        if (isNaN(a) || isNaN(b)) return null;
        return Math.round((b - a) / 86400000);
    }

    function isLive(c, today) {
        if (c.status !== 'unused') return false;
        if (!c.expires_on) return true;
        return String(c.expires_on).slice(0, 10) >= String(today).slice(0, 10);
    }

    function expiryHtml(c, today, lang) {
        if (!c.expires_on) return '';
        var iso = String(c.expires_on).slice(0, 10);
        var d = daysBetween(today, iso);
        var cls = 'wl-exp';
        var text = tr('validUntil', lang) + ' ' + iso;
        if (d === 0) { cls += ' is-red'; text = tr('lastDay', lang); }
        else if (d != null && d > 0 && d <= 7) { cls += ' is-red'; text = d + ' ' + tr('daysLeft', lang) + ' · ' + iso; }
        else if (d != null && d > 7 && d <= 14) { cls += ' is-amber'; text = d + ' ' + tr('daysLeft', lang) + ' · ' + iso; }
        return '<span class="' + cls + '">' + esc(text) + '</span>';
    }

    function itemsText(c) {
        var list = c.item_names;
        if (typeof list === 'string') { try { list = JSON.parse(list); } catch (e) { list = [list]; } }
        if (!Array.isArray(list)) return '';
        return list.filter(Boolean).slice(0, 4).join(', ');
    }

    function ticketHtml(c, data, lang, past) {
        var today = data.today;
        var face = faceText(c, lang);
        var sub = c.discount_mode === 'percent' && num(c.max_discount) > 0 ? tr('upTo', lang) + ' ' + hk(c.max_discount) : '';
        var lines = [];
        var items = itemsText(c);
        if (items) lines.push(tr('forItems', lang) + ': ' + items);
        else if (kindOf(c) !== 'free' && kindOf(c) !== 'treat') lines.push(tr('wholeBill', lang));
        if (num(c.min_spend) > 0) lines.push(tr('minSpend', lang) + ' ' + hk(c.min_spend));
        var status = '';
        if (past) {
            if (c.status === 'used') {
                status = '<span class="wl-badge">' + esc(tr('used', lang)) + '</span>';
                var when = c.redeemed_at ? String(c.redeemed_at).slice(0, 10) : '';
                var bits = [];
                if (when) bits.push(tr('usedOn', lang) + ' ' + when);
                if (num(c.redeemed_amount) > 0) bits.push(tr('saved', lang) + ' ' + hk(c.redeemed_amount));
                if (bits.length) lines.push(bits.join(' · '));
            } else {
                status = '<span class="wl-badge">' + esc(tr('expired', lang)) + '</span>';
            }
        }
        return '<article class="wl-ticket' + (past ? ' is-past' : '') + '" data-kind="' + kindOf(c) + '">' +
            '<div class="wl-stub"><span class="wl-face' + (face.length >= 8 ? ' is-xl' : face.length >= 6 ? ' is-long' : '') + '">' + esc(face) + '</span>' +
            (sub ? '<span class="wl-face-sub">' + esc(sub) + '</span>' : '') +
            '<span class="wl-kind">' + esc(tr('kind_' + kindOf(c), lang)) + '</span></div>' +
            '<div class="wl-body"><div class="wl-name">' + esc(campaignLabel(c, data.campaigns, lang)) + status + '</div>' +
            lines.map(function (l) { return '<div class="wl-line">' + esc(l) + '</div>'; }).join('') +
            (c.code ? '<div class="wl-line">' + esc(tr('code', lang)) + ' <span class="wl-code">' + esc(c.code) + '</span></div>' : '') +
            (past ? '' : expiryHtml(c, today, lang)) +
            '</div></article>';
    }

    /** Pure: cash coupon per-bill lines from Configuration → Discount Coupons (cash_rules). [] = no limit, or the database does not send it yet. */
    function cashRuleLines(rules, lang) {
        if (!rules || typeof rules !== 'object') return [];
        function part(v, dflt) {
            var n = parseFloat(v);
            if (v == null || v === '' || !isFinite(n)) return dflt;
            return Math.max(0, n);
        }
        var pctRaw = rules.maxPercent;
        var amtRaw = rules.maxAmount;
        if (pctRaw == null && amtRaw == null && rules.limitMode) {
            pctRaw = rules.limitMode === 'percent' ? rules.limitValue : 0;
            amtRaw = rules.limitMode === 'amount' ? rules.limitValue : 0;
        }
        var pct = Math.min(100, part(pctRaw, 0));
        var amt = part(amtRaw, 3000);
        var count = parseInt(rules.maxCount, 10);
        var lines = [];
        var key = pct > 0 && amt > 0 ? 'cashBoth' : amt > 0 ? 'cashAmt' : pct > 0 ? 'cashPct' : '';
        if (key) lines.push(tr(key, lang).split('{PCT}').join(String(Math.round(pct * 100) / 100)).split('{AMT}').join(hk(amt)));
        if (count > 0) lines.push(tr('cashCount', lang).split('{N}').join(String(count)));
        return lines;
    }

    function split(data) {
        var today = data.today || new Date().toISOString().slice(0, 10);
        var live = [];
        var past = [];
        (data.coupons || []).forEach(function (c) { (isLive(c, today) ? live : past).push(c); });
        live.sort(function (a, b) {
            return String(a.expires_on || '9999-12-31').localeCompare(String(b.expires_on || '9999-12-31'));
        });
        past.sort(function (a, b) {
            return String(b.redeemed_at || b.expires_on || '').localeCompare(String(a.redeemed_at || a.expires_on || ''));
        });
        return { live: live, past: past, today: today };
    }

    /** Pure: wallet page body for one RPC result. */
    function renderHtml(data, lang, showPast) {
        if (!data || !data.ok) {
            var key = data && data.reason === 'expired' ? 'expiredLink' : (data && data.reason === 'offline' ? 'offline' : 'badLink');
            return '<p class="wl-error" role="alert">' + esc(tr(key, lang)) + '</p>';
        }
        var parts = split(data);
        var d = Object.assign({}, data, { today: parts.today });
        var html = '';
        if (parts.live.length) {
            var value = 0;
            var next = '';
            parts.live.forEach(function (c) {
                if ((c.discount_mode || 'amount') === 'amount') value += num(c.face_value);
                if (c.expires_on && (!next || String(c.expires_on) < next)) next = String(c.expires_on).slice(0, 10);
            });
            html += '<div class="wl-sum"><div class="wl-sum-item"><b>' + parts.live.length + '</b>' + esc(tr('sumCount', lang)) + '</div>';
            if (value > 0) html += '<div class="wl-sum-item"><b>' + esc(hk(value)) + '</b>' + esc(tr('sumValue', lang)) + '</div>';
            if (next) html += '<div class="wl-sum-item"><b>' + esc(next.slice(5)) + '</b>' + esc(tr('sumNext', lang)) + '</div>';
            html += '</div>';
            var hasCash = parts.live.some(function (c) {
                var k = kindOf(c);
                return k === 'cash' || k === 'referral' || k === 'spend' || k === 'welcome';
            });
            var cashLines = hasCash ? cashRuleLines(data.cash_rules, lang) : [];
            html += '<div class="wl-remind" role="note"><p>⏰ ' + esc(tr('yearEnd', lang).split('{YEAR}').join(String(parts.today).slice(0, 4))) + '</p>' +
                (cashLines.length ? '<p>💳 ' + esc(cashLines.join(' ')) + '</p>' : '') + '</div>';
            html += '<h2 class="wl-sec-title">' + esc(tr('ready', lang)) + '</h2>';
            parts.live.forEach(function (c) { html += ticketHtml(c, d, lang, false); });
        } else {
            html += '<p class="wl-empty">' + esc(tr('none', lang)) + '</p>';
        }
        if (parts.past.length) {
            html += '<button type="button" class="wl-more" id="wlPastToggle" aria-expanded="' + (showPast ? 'true' : 'false') + '">' +
                esc(tr(showPast ? 'hidePast' : 'showPast', lang)) + ' (' + parts.past.length + ')</button>';
            if (showPast) {
                html += '<h2 class="wl-sec-title">' + esc(tr('past', lang)) + '</h2>';
                parts.past.forEach(function (c) { html += ticketHtml(c, d, lang, true); });
            }
        }
        return html;
    }

    function tokenFrom(loc) {
        var l = loc || root.location;
        var m = /[?&#]t=([0-9a-f]{32})\b/i.exec(String((l && l.search) || '') + String((l && l.hash) || ''));
        return m ? m[1].toLowerCase() : '';
    }

    function pickLang(loc) {
        var m = /[?&]g=([A-Za-z-]+)/.exec(String((loc && loc.search) || ''));
        if (m && LANGS.indexOf(m[1]) >= 0) return m[1];
        try {
            var saved = root.localStorage && root.localStorage.getItem(LANG_KEY);
            if (saved && LANGS.indexOf(saved) >= 0) return saved;
        } catch (e) { /* private mode */ }
        var nav = String((root.navigator && root.navigator.language) || '').toLowerCase();
        if (nav.indexOf('zh-cn') === 0 || nav.indexOf('zh-sg') === 0 || nav === 'zh-hans') return 'zh-CN';
        if (nav.indexOf('en') === 0) return 'en';
        return 'zh-Hant';
    }

    function hkYearOf(iso) {
        var t = Date.parse(String(iso || ''));
        return new Date((isNaN(t) ? Date.now() : t) + 8 * 3600000).getUTCFullYear();
    }

    /**
     * Pure: with Set zero on year end, a coupon ends no later than 31 Dec of the (HK) year it was issued.
     * The coupon's own date is kept in own_expires_on.
     */
    function capYearEnd(coupons, zeroPolicy) {
        if (String(zeroPolicy || '') !== 'year_end') return coupons || [];
        return (coupons || []).map(function (c) {
            var own = c.expires_on ? String(c.expires_on).slice(0, 10) : null;
            var cap = hkYearOf(c.issued_at) + '-12-31';
            return Object.assign({}, c, { own_expires_on: own, expires_on: !own || own > cap ? cap : own });
        });
    }

    function fetchZeroPolicy(cfg) {
        return root.fetch(String(cfg.supabaseUrl).replace(/\/$/, '') +
            '/rest/v1/program_settings?select=setting_value&setting_key=eq.coupon_zero_policy', {
            headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey },
            cache: 'no-store'
        }).then(function (r) { return r.ok ? r.json() : []; }).then(function (rows) {
            var raw = rows && rows[0] && rows[0].setting_value;
            var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return (o && o.zero_policy) || '';
        }).catch(function () { return ''; });
    }

    function fetchWallet(token) {
        var cfg = root.CS_WALLET_CONFIG || {};
        if (!token) return Promise.resolve({ ok: false, reason: 'bad_link' });
        var walletP = root.fetch(String(cfg.supabaseUrl).replace(/\/$/, '') + '/rest/v1/rpc/dc_wallet_view', {
            method: 'POST',
            headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_token: token }),
            cache: 'no-store'
        }).then(function (r) {
            if (!r.ok) return { ok: false, reason: r.status === 404 ? 'bad_link' : 'offline' };
            return r.json();
        }).catch(function () { return { ok: false, reason: 'offline' }; });
        return Promise.all([walletP, fetchZeroPolicy(cfg)]).then(function (both) {
            var res = both[0];
            if (!res || !res.ok) return res;
            var zp = res.zero_policy || both[1];
            return Object.assign({}, res, { zero_policy: zp, coupons: capYearEnd(res.coupons, zp) });
        });
    }

    function boot() {
        var doc = root.document;
        var lang = pickLang(root.location);
        var data = null;
        var showPast = false;
        function el(id) { return doc.getElementById(id); }
        function paintChrome() {
            doc.documentElement.lang = lang;
            doc.title = tr('title', lang);
            el('wlTitle').textContent = tr('title', lang);
            el('wlClinic').textContent = tr('clinic', lang);
            el('wlFoot').textContent = tr('foot', lang);
            Array.prototype.forEach.call(doc.querySelectorAll('.wl-lang-btn'), function (b) {
                var on = b.getAttribute('data-lang') === lang;
                b.classList.toggle('is-on', on);
                b.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
        }
        function paint() {
            paintChrome();
            var main = el('wlMain');
            if (!data) { main.innerHTML = '<p class="wl-loading">' + esc(tr('loading', lang)) + '</p>'; return; }
            el('wlWho').textContent = data.ok && data.name ? data.name : '';
            main.innerHTML = renderHtml(data, lang, showPast);
            var tog = el('wlPastToggle');
            if (tog) tog.addEventListener('click', function () { showPast = !showPast; paint(); });
        }
        Array.prototype.forEach.call(doc.querySelectorAll('.wl-lang-btn'), function (b) {
            b.addEventListener('click', function () {
                lang = b.getAttribute('data-lang');
                try { root.localStorage.setItem(LANG_KEY, lang); } catch (e) { /* private mode */ }
                paint();
            });
        });
        paint();
        return fetchWallet(tokenFrom(root.location)).then(function (res) {
            data = res || { ok: false, reason: 'offline' };
            paint();
            return data;
        });
    }

    root.CSWallet = {
        boot: boot,
        renderHtml: renderHtml,
        cashRuleLines: cashRuleLines,
        campaignLabel: campaignLabel,
        tokenFrom: tokenFrom,
        pickLang: pickLang,
        isLive: isLive,
        split: split,
        capYearEnd: capYearEnd,
        fetchWallet: fetchWallet,
        tr: tr
    };
})(typeof window !== 'undefined' ? window : this);
