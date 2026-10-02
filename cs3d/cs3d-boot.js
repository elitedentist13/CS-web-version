/* Banana chrome on the Cornerstone3D sidecar: GitHub Pages subpath + /local hop.
   Mirrors ohif/banana-boot.js path mapping. Does not touch OHIF keys or folders. */
(function () {
    function cs3dBase() {
        var raw = '';
        try { raw = String(location.pathname || ''); } catch (e) { raw = ''; }
        raw = raw.replace(/\/index\.html$/i, '');
        var low = raw.toLowerCase();
        var i = low.lastIndexOf('/cs3d');
        if (i >= 0 && (raw.length === i + 5 || raw.charAt(i + 5) === '/')) return raw.slice(0, i + 5);
        return raw.replace(/\/+$/, '') || '/cs3d';
    }

    try {
        if (/\/index\.html$/i.test(location.pathname)) {
            location.replace(location.pathname.replace(/\/index\.html$/i, '/') + location.search + location.hash);
            return;
        }
    } catch (e0) { /* ignore */ }

    var base = cs3dBase();
    window.BANANA_CS3D_BASE = base;
    try {
        window.PUBLIC_URL = base + '/';
    } catch (ePub) { /* ignore */ }
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
        var onMode = /^\/(local|viewer)(\/|$)/i.test(rest);
        if (!onMode) {
            history.replaceState(null, '', base + '/local' + search + (location.hash || ''));
        }
    } catch (e2) { /* ignore */ }

    var ctx = null;
    try { ctx = JSON.parse(sessionStorage.getItem('banana.cs3d.v1') || 'null'); } catch (e) { ctx = null; }
    if (!ctx) {
        try { ctx = JSON.parse(localStorage.getItem('banana.cs3d.v1') || 'null'); } catch (e3) { ctx = null; }
    }
    window.__bananaCs3dCtx = ctx;
    var title = 'Banana Dicom Reader';
    if (ctx && ctx.patientNo) title += ' · #' + ctx.patientNo;
    if (ctx && ctx.name) title += ' · ' + ctx.name;
    document.title = title;

    function fillWho() {
        var who = document.getElementById('bananaCs3dWho');
        if (!who || !ctx) return;
        who.textContent = [ctx.patientNo ? '#' + ctx.patientNo : '', ctx.name || ''].filter(Boolean).join(' · ');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fillWho);
    else fillWho();
})();
