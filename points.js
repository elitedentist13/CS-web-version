/* Patient reward points (points.html?t=<token>) — browse only. Reads one person through the rw_wallet_view RPC. */
(function (root) {
    'use strict';

    var LANGS = ['en', 'zh-Hant', 'zh-CN'];
    var LANG_KEY = 'csWalletLang';
    var FIRST_ROWS = 20;

    var T = {
        title: { en: 'My reward points', 'zh-Hant': '我的積分', 'zh-CN': '我的积分' },
        clinic: { en: 'Joyful Smile Dental Centre', 'zh-Hant': '樂意牙科中心', 'zh-CN': '乐意牙科中心' },
        loading: { en: 'Loading…', 'zh-Hant': '載入中…', 'zh-CN': '载入中…' },
        foot: {
            en: 'Browse only. To use your points, tell the staff when you pay.',
            'zh-Hant': '只供瀏覽。如想使用積分，請於付款時告知職員。',
            'zh-CN': '只供浏览。如想使用积分，请于付款时告知职员。'
        },
        balance: { en: 'Points balance', 'zh-Hant': '積分結餘', 'zh-CN': '积分结余' },
        pts: { en: 'points', 'zh-Hant': '分', 'zh-CN': '分' },
        since: { en: 'Member since', 'zh-Hant': '加入日期', 'zh-CN': '加入日期' },
        byClinic: { en: 'By clinic', 'zh-Hant': '按診所', 'zh-CN': '按诊所' },
        earnRate: {
            en: 'You earn {RATE}% of what you pay as points.',
            'zh-Hant': '每次付款可賺取付款額 {RATE}% 的積分。',
            'zh-CN': '每次付款可赚取付款额 {RATE}% 的积分。'
        },
        yearEnd: {
            en: 'Unused points are cleared at the end of each year.',
            'zh-Hant': '未使用的積分會於每年年底清零。',
            'zh-CN': '未使用的积分会于每年年底清零。'
        },
        lifespan: {
            en: 'Points are cleared after {N} months with no new points.',
            'zh-Hant': '如 {N} 個月內沒有新積分，積分會被清零。',
            'zh-CN': '如 {N} 个月内没有新积分，积分会被清零。'
        },
        recent: { en: 'Recent activity', 'zh-Hant': '最近紀錄', 'zh-CN': '最近记录' },
        none: { en: 'No points activity in the last 12 months.', 'zh-Hant': '過去 12 個月沒有積分紀錄。', 'zh-CN': '过去 12 个月没有积分记录。' },
        more: { en: 'Show more', 'zh-Hant': '顯示更多', 'zh-CN': '显示更多' },
        after: { en: 'Balance', 'zh-Hant': '結餘', 'zh-CN': '结余' },
        badLink: {
            en: 'This points link is not valid any more. Please ask the clinic for a new QR code.',
            'zh-Hant': '此積分連結已失效，請向診所索取新的 QR 碼。',
            'zh-CN': '此积分链接已失效，请向诊所索取新的二维码。'
        },
        expiredLink: {
            en: 'This points link has expired. Please ask the clinic for a new QR code.',
            'zh-Hant': '此積分連結已過期，請向診所索取新的 QR 碼。',
            'zh-CN': '此积分链接已过期，请向诊所索取新的二维码。'
        },
        offline: {
            en: 'Could not load your points. Check the connection and try again.',
            'zh-Hant': '無法載入積分，請檢查網絡後再試。',
            'zh-CN': '无法载入积分，请检查网络后再试。'
        },
        k_earn: { en: 'Earned', 'zh-Hant': '賺取', 'zh-CN': '赚取' },
        k_redeem: { en: 'Used on a bill', 'zh-Hant': '用於賬單', 'zh-CN': '用于账单' },
        k_transfer_in: { en: 'Received', 'zh-Hant': '轉入', 'zh-CN': '转入' },
        k_transfer_out: { en: 'Given away', 'zh-Hant': '轉出', 'zh-CN': '转出' },
        k_void_earn: { en: 'Earning cancelled', 'zh-Hant': '撤銷賺取', 'zh-CN': '撤销赚取' },
        k_void_redeem: { en: 'Points returned', 'zh-Hant': '退回積分', 'zh-CN': '退回积分' },
        k_adjust: { en: 'Adjusted by the clinic', 'zh-Hant': '診所調整', 'zh-CN': '诊所调整' },
        k_referral: { en: 'Refer a friend', 'zh-Hant': '介紹新客', 'zh-CN': '介绍新客' },
        k_cleared: { en: 'Points cleared', 'zh-Hant': '積分清零', 'zh-CN': '积分清零' }
    };

    var ICON = {
        earn: '⭐', redeem: '🎁', transfer_in: '↘', transfer_out: '↗', void_earn: '↩', void_redeem: '↩',
        adjust: '✎', referral: '🤝', cleared: '⌛'
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

    /** Pure: 1234.5 -> "1,234.50", 120 -> "120". */
    function fmtPts(v) {
        var n = Math.round(num(v) * 100) / 100;
        var whole = Math.abs(n - Math.round(n)) < 0.005;
        return n.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
    }

    function signed(v) {
        var n = num(v);
        return (n > 0 ? '+' : n < 0 ? '−' : '') + fmtPts(Math.abs(n));
    }

    /** Pure: ISO time -> YYYY-MM-DD in Hong Kong. */
    function hkDate(iso) {
        var t = Date.parse(String(iso || ''));
        if (isNaN(t)) return String(iso || '').slice(0, 10);
        return new Date(t + 8 * 3600000).toISOString().slice(0, 10);
    }

    function kindKey(k) {
        return T['k_' + k] ? k : 'adjust';
    }

    function rowHtml(r, lang, showAfter) {
        var k = kindKey(String(r.kind || ''));
        var p = num(r.points);
        var sub = [hkDate(r.at)];
        if (r.clinic) sub.push(r.clinic);
        return '<li class="wl-pts-row" data-kind="' + esc(k) + '">' +
            '<span class="wl-pts-ico" aria-hidden="true">' + (ICON[k] || '•') + '</span>' +
            '<span class="wl-pts-what"><b>' + esc(tr('k_' + k, lang)) + '</b><small>' + esc(sub.join(' · ')) + '</small></span>' +
            '<span class="wl-pts-amt' + (p > 0 ? ' is-plus' : p < 0 ? ' is-minus' : '') + '">' + esc(signed(p)) +
            (showAfter && r.balance_after != null ? '<small>' + esc(tr('after', lang)) + ' ' + esc(fmtPts(r.balance_after)) + '</small>' : '') +
            '</span></li>';
    }

    /** Pure: points page body for one RPC result. */
    function renderHtml(data, lang, showAll) {
        if (!data || !data.ok) {
            var key = data && data.reason === 'expired' ? 'expiredLink' : (data && data.reason === 'offline' ? 'offline' : 'badLink');
            return '<p class="wl-error" role="alert">' + esc(tr(key, lang)) + '</p>';
        }
        var html = '<section class="wl-pts-card" aria-label="' + esc(tr('balance', lang)) + '">' +
            '<div class="wl-pts-label">' + esc(tr('balance', lang)) + '</div>' +
            '<div class="wl-pts-big"><b id="wlPtsBalance">' + esc(fmtPts(data.balance)) + '</b> <span>' + esc(tr('pts', lang)) + '</span></div>';
        var clinics = (data.clinics || []).filter(function (c) { return c && num(c.balance) > 0.005; });
        if (clinics.length > 1) {
            html += '<div class="wl-pts-chips" aria-label="' + esc(tr('byClinic', lang)) + '">' + clinics.map(function (c) {
                return '<span class="wl-pts-chip"><b>' + esc(c.clinic) + '</b> ' + esc(fmtPts(c.balance)) + '</span>';
            }).join('') + '</div>';
        }
        if (data.started_at) html += '<div class="wl-pts-since">' + esc(tr('since', lang)) + ' ' + esc(hkDate(data.started_at)) + '</div>';
        html += '</section>';
        var notes = [];
        if (num(data.earn_rate) > 0) notes.push(tr('earnRate', lang).replace('{RATE}', String(Math.round(num(data.earn_rate) * 100) / 100)));
        if (data.zero_policy === 'year_end') notes.push(tr('yearEnd', lang));
        else if (data.zero_policy === 'lifespan' && num(data.lifespan_months) > 0) notes.push(tr('lifespan', lang).replace('{N}', String(Math.round(num(data.lifespan_months)))));
        if (notes.length) html += '<ul class="wl-pts-notes">' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>';
        var rows = data.rows || [];
        html += '<h2 class="wl-sec-title">' + esc(tr('recent', lang)) + '</h2>';
        if (!rows.length) return html + '<p class="wl-empty">' + esc(tr('none', lang)) + '</p>';
        var showAfter = num(data.charts) <= 1;
        var shown = showAll ? rows : rows.slice(0, FIRST_ROWS);
        html += '<ul class="wl-pts-list">' + shown.map(function (r) { return rowHtml(r, lang, showAfter); }).join('') + '</ul>';
        if (rows.length > shown.length) {
            html += '<button type="button" class="wl-more" id="wlPtsMore">' + esc(tr('more', lang)) + ' (' + (rows.length - shown.length) + ')</button>';
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

    function fetchPoints(token) {
        var cfg = root.CS_WALLET_CONFIG || {};
        if (!token) return Promise.resolve({ ok: false, reason: 'bad_link' });
        return root.fetch(String(cfg.supabaseUrl).replace(/\/$/, '') + '/rest/v1/rpc/rw_wallet_view', {
            method: 'POST',
            headers: { apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_token: token }),
            cache: 'no-store'
        }).then(function (r) {
            if (!r.ok) return { ok: false, reason: r.status === 404 ? 'bad_link' : 'offline' };
            return r.json();
        }).catch(function () { return { ok: false, reason: 'offline' }; });
    }

    function boot() {
        var doc = root.document;
        var lang = pickLang(root.location);
        var data = null;
        var showAll = false;
        function el(id) { return doc.getElementById(id); }
        function paint() {
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
            var main = el('wlMain');
            if (!data) { main.innerHTML = '<p class="wl-loading">' + esc(tr('loading', lang)) + '</p>'; return; }
            el('wlWho').textContent = data.ok && data.name ? data.name : '';
            main.innerHTML = renderHtml(data, lang, showAll);
            var more = el('wlPtsMore');
            if (more) more.addEventListener('click', function () { showAll = true; paint(); });
        }
        Array.prototype.forEach.call(doc.querySelectorAll('.wl-lang-btn'), function (b) {
            b.addEventListener('click', function () {
                lang = b.getAttribute('data-lang');
                try { root.localStorage.setItem(LANG_KEY, lang); } catch (e) { /* private mode */ }
                paint();
            });
        });
        paint();
        return fetchPoints(tokenFrom(root.location)).then(function (res) {
            data = res || { ok: false, reason: 'offline' };
            paint();
            return data;
        });
    }

    root.CSPoints = {
        boot: boot,
        renderHtml: renderHtml,
        fmtPts: fmtPts,
        hkDate: hkDate,
        tokenFrom: tokenFrom,
        pickLang: pickLang,
        tr: tr
    };
})(typeof window !== 'undefined' ? window : this);
