/* Banana chrome on the OHIF sidecar: land on /local (zip/folder), keep assets on /ohif/. */
(function () {
    function ohifBase() {
        var raw = '';
        try { raw = String(location.pathname || ''); } catch (e) { raw = ''; }
        raw = raw.replace(/\/index\.html$/i, '');
        var low = raw.toLowerCase();
        var i = low.lastIndexOf('/ohif');
        if (i >= 0 && (raw.length === i + 5 || raw.charAt(i + 5) === '/')) return raw.slice(0, i + 5);
        return raw.replace(/\/+$/, '') || '/ohif';
    }

    try {
        if (/\/index\.html$/i.test(location.pathname)) {
            location.replace(location.pathname.replace(/\/index\.html$/i, '/') + location.search + location.hash);
            return;
        }
    } catch (e0) { /* ignore */ }

    var base = ohifBase();
    try {
        if (!document.querySelector('base')) {
            var b = document.createElement('base');
            b.href = base + '/';
            document.head.insertBefore(b, document.head.firstChild);
        }
    } catch (e1) { /* ignore */ }

    try {
        var rest = String(location.pathname || '').slice(base.length);
        var search = location.search || '';
        var onMode = /^\/(local|localbasic|debug|viewer|basic-test|dev|longitudinal|segmentation|tmtv|microscopy|dynamic-volume|usAnnotation)(\/|$)/i.test(rest);
        var hasStudy = /[?&](StudyInstanceUIDs|datasources)=/i.test(search);
        if (!onMode && !hasStudy) {
            history.replaceState(null, '', base + '/local' + search + (location.hash || ''));
        }
    } catch (e2) { /* ignore */ }

    var ctx = null;
    try { ctx = JSON.parse(sessionStorage.getItem('banana.cbct.v1') || 'null'); } catch (e) { ctx = null; }
    var title = 'OHIF · CBCT';
    if (ctx && ctx.patientNo) title += ' · #' + ctx.patientNo;
    if (ctx && ctx.name) title += ' · ' + ctx.name;
    document.title = title;
    function bar() {
        if (document.getElementById('bananaOhifBar')) return;
        var el = document.createElement('div');
        el.id = 'bananaOhifBar';
        el.setAttribute('style',
            'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;display:flex;gap:12px;align-items:center;' +
            'padding:6px 12px;background:#111827;color:#fde047;font:700 12px/1.3 Segoe UI,sans-serif;' +
            'border-top:1px solid #334155;');
        el.textContent = 'Banana: use Load zip / Load folder here (OHIF cannot open a .zip by itself). Share THIS window in X-ray Helper to save a view.';
        if (ctx && (ctx.patientNo || ctx.name)) {
            var who = document.createElement('span');
            who.setAttribute('style', 'margin-left:auto;color:#7dd3fc;');
            who.textContent = [ctx.patientNo ? '#' + ctx.patientNo : '', ctx.name || ''].filter(Boolean).join(' · ');
            el.appendChild(who);
        }
        document.body.appendChild(el);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bar);
    else bar();
})();
