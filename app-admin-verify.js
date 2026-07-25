// ════════════════════════════════════════════════════════════════
// app-admin-verify.js — Admin login Twilio Verify SMS (fixed +85260716591)
// Quiet fallback when Verify is not configured or fails.
// ════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var EDGE_FN = 'admin-login-verify';
    var ADMIN_PHONE_MASK = '+852 **** 6591';

    function tr(key, en, zhCn, zhHant) {
        if (typeof appTr === 'function') return appTr(key);
        return en;
    }

    function invoke(action, extra) {
        if (typeof SB === 'undefined' || !SB.functions || typeof SB.functions.invoke !== 'function') {
            return Promise.resolve({ ok: false, skipped: true, reason: 'no_invoke' });
        }
        var body = Object.assign({ action: action }, extra || {});
        return SB.functions.invoke(EDGE_FN, { body: body }).then(function (res) {
            if (res.error) {
                return { ok: false, skipped: true, reason: res.error.message || 'invoke_error' };
            }
            var data = res.data;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch (e) { data = {}; }
            }
            if (!data || data.configured === false || data.error === 'twilio_verify_not_configured') {
                return { ok: false, skipped: true, reason: 'not_configured' };
            }
            if (action === 'check') {
                return { ok: !!(data && data.approved), skipped: false, data: data };
            }
            if (data && data.ok) {
                return {
                    ok: true,
                    skipped: false,
                    phone_masked: data.phone_masked || ADMIN_PHONE_MASK,
                    data: data
                };
            }
            return { ok: false, skipped: true, reason: (data && data.error) || 'send_failed' };
        }).catch(function (e) {
            return { ok: false, skipped: true, reason: (e && e.message) || 'network' };
        });
    }

    window.ADMINVERIFY = {
        phoneMask: ADMIN_PHONE_MASK,
        send: function () { return invoke('send'); },
        resend: function () { return invoke('resend'); },
        check: function (code) { return invoke('check', { code: code }); }
    };
})();
