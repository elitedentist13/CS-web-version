/* Additive 2026-09-09 extras. Loaded AFTER app-xray-ai.js. Does not replace it. */
(function () {
    'use strict';
    if (window.__CS_XRAY_AI_EXTRAS_20260909) return;
    window.__CS_XRAY_AI_EXTRAS_20260909 = true;

    function raiseAssistOverlay(root) {
        if (!root || !root.classList || !root.classList.contains('xray-ai-overlay')) return;
        root.style.zIndex = '50000';
        root.style.pointerEvents = 'auto';
        var ok = root.querySelector('#xrayAiDisclaimerOk');
        if (ok) ok.style.pointerEvents = 'auto';
    }

    function watchAssistOverlays() {
        if (!document.body) return;
        document.querySelectorAll('.xray-ai-overlay').forEach(raiseAssistOverlay);
        var mo = new MutationObserver(function (recs) {
            recs.forEach(function (rec) {
                rec.addedNodes && rec.addedNodes.forEach(function (n) {
                    if (n.nodeType !== 1) return;
                    if (n.classList && n.classList.contains('xray-ai-overlay')) raiseAssistOverlay(n);
                    if (n.querySelectorAll) n.querySelectorAll('.xray-ai-overlay').forEach(raiseAssistOverlay);
                });
            });
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }

    function stripEdjLayers() {
        var st = window.xrayAiState;
        if (!st || !Array.isArray(st.anatomyLayers)) return;
        var n = st.anatomyLayers.length;
        st.anatomyLayers = st.anatomyLayers.filter(function (L) {
            return !L || L.layer !== 'edj';
        });
        if (st.anatomyLayers.length !== n && typeof window.xrayAiSyncCanvasSize === 'function') {
            try { window.xrayAiSyncCanvasSize(); } catch (e) {}
        }
    }

    function syncMaxBodyClass() {
        var x = document.getElementById('xrayLightbox');
        var p = document.getElementById('photoLightbox');
        var max = !!(x && x.classList.contains('xray-lb-maximized')) ||
                  !!(p && p.classList.contains('xray-lb-maximized'));
        if (document.body) document.body.classList.toggle('xray-lb-maximized', max);
    }

    function wrapCrop(name) {
        var fn = window[name];
        if (typeof fn !== 'function' || fn.__csExtras20260909) return;
        window[name] = function (show) {
            fn.apply(this, arguments);
            var viewerId = name.indexOf('photo') === 0 ? 'photoLbViewerDiv' : 'xrayLbViewerDiv';
            var viewer = document.getElementById(viewerId);
            if (viewer) viewer.classList.toggle('xray-lb-crop-pending', !!show);
        };
        window[name].__csExtras20260909 = true;
    }

    function wrapChrome(name) {
        var fn = window[name];
        if (typeof fn !== 'function' || fn.__csExtras20260909) return;
        window[name] = function () {
            var out = fn.apply(this, arguments);
            syncMaxBodyClass();
            return out;
        };
        window[name].__csExtras20260909 = true;
    }

    function boot() {
        watchAssistOverlays();
        wrapCrop('lbShowCropApply');
        wrapCrop('photoLbShowCropApply');
        wrapChrome('lbSyncLightboxChrome');
        wrapChrome('photoLbSyncLightboxChrome');
        syncMaxBodyClass();
        stripEdjLayers();
        setInterval(function () {
            stripEdjLayers();
            syncMaxBodyClass();
            document.querySelectorAll('.xray-ai-overlay').forEach(raiseAssistOverlay);
        }, 800);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
