/* One phone page for reward points and coupons (loyalty.html?c=<coupon token>&p=<points token>) — browse only.
   Draws each tab with the points.js / wallet.js renderers. */
(function (root) {
    'use strict';

    var LANGS = ['en', 'zh-Hant', 'zh-CN'];
    var LANG_KEY = 'csWalletLang';

    var T = {
        title: { en: 'My points & coupons', 'zh-Hant': '我的積分及優惠券', 'zh-CN': '我的积分及优惠券' },
        clinic: { en: 'Joyful Smile Dental Centre', 'zh-Hant': '樂意牙科中心', 'zh-CN': '乐意牙科中心' },
        loading: { en: 'Loading…', 'zh-Hant': '載入中…', 'zh-CN': '载入中…' },
        tabPoints: { en: 'Points', 'zh-Hant': '積分', 'zh-CN': '积分' },
        tabCoupons: { en: 'Coupons', 'zh-Hant': '優惠券', 'zh-CN': '优惠券' },
        foot: {
            en: 'Browse only. Tell the staff when you pay if you would like to use points or coupons.',
            'zh-Hant': '只供瀏覽。如想使用積分或優惠券，請於付款時告知職員。',
            'zh-CN': '只供浏览。如想使用积分或优惠券，请于付款时告知职员。'
        },
        noPart: {
            en: 'This link does not include this part. Please ask the clinic for a new QR code.',
            'zh-Hant': '此連結不包括這部分，請向診所索取新的 QR 碼。',
            'zh-CN': '此链接不包括这部分，请向诊所索取新的二维码。'
        },
        badLink: {
            en: 'This link is not valid any more. Please ask the clinic for a new QR code.',
            'zh-Hant': '此連結已失效，請向診所索取新的 QR 碼。',
            'zh-CN': '此链接已失效，请向诊所索取新的二维码。'
        }
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

    /** Pure: both tokens from the address (either may be missing). */
    function tokensFrom(loc) {
        var s = String((loc && loc.search) || '') + String((loc && loc.hash) || '');
        var c = /[?&#]c=([0-9a-f]{32})\b/i.exec(s);
        var p = /[?&#]p=([0-9a-f]{32})\b/i.exec(s);
        return { c: c ? c[1].toLowerCase() : '', p: p ? p[1].toLowerCase() : '' };
    }

    /** Pure: the tab to open — ?tab= / #tab= first, else points when the link has points. */
    function pickTab(loc, tk) {
        var m = /[?&#]tab=(points|coupons)\b/.exec(String((loc && loc.search) || '') + String((loc && loc.hash) || ''));
        if (m && (m[1] === 'points' ? tk.p : tk.c)) return m[1];
        return tk.p ? 'points' : 'coupons';
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

    /** Pure: the badge on each tab (points balance, live coupon count; '' while loading or on error). */
    function tabBadges(state) {
        var W = root.CSWallet;
        var P = root.CSPoints;
        var pts = state.points && state.points.ok && P ? P.fmtPts(state.points.balance) : '';
        var cps = state.wallet && state.wallet.ok && W ? String(W.split(state.wallet).live.length) : '';
        return { points: pts, coupons: cps };
    }

    /** Pure: tab bar + the open tab's body. */
    function renderHtml(state, lang) {
        var tk = state.tokens || {};
        if (!tk.c && !tk.p) return '<p class="wl-error" role="alert">' + esc(tr('badLink', lang)) + '</p>';
        var b = tabBadges(state);
        function tab(key, label, badge, has) {
            var on = state.tab === key;
            return '<button type="button" class="ly-tab' + (on ? ' is-on' : '') + '" role="tab" id="lyTab-' + key + '" data-tab="' + key +
                '" aria-selected="' + (on ? 'true' : 'false') + '" aria-controls="lyPane"' + (has ? '' : ' disabled') + '>' +
                esc(label) + (badge ? ' <b class="ly-badge">' + esc(badge) + '</b>' : '') + '</button>';
        }
        var html = '<div class="ly-tabs" role="tablist">' +
            tab('points', tr('tabPoints', lang), b.points, !!tk.p) +
            tab('coupons', tr('tabCoupons', lang), b.coupons, !!tk.c) + '</div>';
        html += '<div class="ly-pane" id="lyPane" role="tabpanel" aria-labelledby="lyTab-' + esc(state.tab) + '">';
        var data = state.tab === 'points' ? state.points : state.wallet;
        var has = state.tab === 'points' ? tk.p : tk.c;
        if (!has) html += '<p class="wl-empty">' + esc(tr('noPart', lang)) + '</p>';
        else if (!data) html += '<p class="wl-loading">' + esc(tr('loading', lang)) + '</p>';
        else if (state.tab === 'points') html += root.CSPoints.renderHtml(data, lang, state.showAll);
        else html += root.CSWallet.renderHtml(data, lang, state.showPast);
        return html + '</div>';
    }

    function boot() {
        var doc = root.document;
        var lang = pickLang(root.location);
        var tk = tokensFrom(root.location);
        var state = { tokens: tk, tab: pickTab(root.location, tk), points: null, wallet: null, showAll: false, showPast: false };
        function el(id) { return doc.getElementById(id); }
        function who() {
            var d = (state.points && state.points.ok && state.points.name) ? state.points : state.wallet;
            return d && d.ok && d.name ? d.name : '';
        }
        function paint() {
            doc.documentElement.lang = lang;
            doc.title = tr('title', lang);
            el('wlTitle').textContent = tr('title', lang);
            el('wlClinic').textContent = tr('clinic', lang);
            el('wlFoot').textContent = tr('foot', lang);
            el('wlWho').textContent = who();
            Array.prototype.forEach.call(doc.querySelectorAll('.wl-lang-btn'), function (btn) {
                var on = btn.getAttribute('data-lang') === lang;
                btn.classList.toggle('is-on', on);
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            el('wlMain').innerHTML = renderHtml(state, lang);
            Array.prototype.forEach.call(doc.querySelectorAll('.ly-tab'), function (btn) {
                btn.addEventListener('click', function () {
                    state.tab = btn.getAttribute('data-tab');
                    try { root.history.replaceState(null, '', '#tab=' + state.tab); } catch (e) { /* file:// */ }
                    paint();
                });
            });
            var more = el('wlPtsMore');
            if (more) more.addEventListener('click', function () { state.showAll = true; paint(); });
            var past = el('wlPastToggle');
            if (past) past.addEventListener('click', function () { state.showPast = !state.showPast; paint(); });
        }
        Array.prototype.forEach.call(doc.querySelectorAll('.wl-lang-btn'), function (btn) {
            btn.addEventListener('click', function () {
                lang = btn.getAttribute('data-lang');
                try { root.localStorage.setItem(LANG_KEY, lang); } catch (e) { /* private mode */ }
                paint();
            });
        });
        paint();
        var off = { ok: false, reason: 'offline' };
        var pP = tk.p ? root.CSPoints.fetchPoints(tk.p).then(function (r) { state.points = r || off; paint(); }) : Promise.resolve();
        var cP = tk.c ? root.CSWallet.fetchWallet(tk.c).then(function (r) { state.wallet = r || off; paint(); }) : Promise.resolve();
        return Promise.all([pP, cP]).then(function () { return state; });
    }

    root.CSLoyalty = {
        boot: boot,
        renderHtml: renderHtml,
        tabBadges: tabBadges,
        tokensFrom: tokensFrom,
        pickTab: pickTab,
        pickLang: pickLang,
        tr: tr
    };
})(typeof window !== 'undefined' ? window : this);
