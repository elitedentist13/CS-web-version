// ════════════════════════════════════════════════════════════════
// app-public-holidays.js — HK public holidays for calendar UIs
// Requires: SB (Supabase client)
// ════════════════════════════════════════════════════════════════

var APPT_PUBLIC_HOLIDAYS = (function () {
    'use strict';

    var _map = {};
    var _loadPromise = null;

    function escAttr(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function defaultName() {
        if (typeof t === 'function') {
            var v = t('appt.ph.defaultName');
            if (v && v !== 'appt.ph.defaultName') return v;
        }
        return 'Public holiday';
    }

    function load() {
        if (_loadPromise) return _loadPromise;
        if (typeof SB === 'undefined') {
            _loadPromise = Promise.resolve();
            return _loadPromise;
        }
        _loadPromise = SB.from('online_booking_public_holidays')
            .select('holiday_date,name')
            .eq('enabled', true)
            .then(function (res) {
                _map = {};
                (res.data || []).forEach(function (h) {
                    if (!h || !h.holiday_date) return;
                    var iso = String(h.holiday_date).slice(0, 10);
                    _map[iso] = (h.name && String(h.name).trim()) || defaultName();
                });
            })
            .catch(function () {
                _map = {};
            });
        return _loadPromise;
    }

    function isHoliday(iso) {
        return Object.prototype.hasOwnProperty.call(_map, String(iso || '').slice(0, 10));
    }

    function name(iso) {
        var key = String(iso || '').slice(0, 10);
        return _map[key] || defaultName();
    }

    /** @returns {{ extraClass: string, titleAttr: string }} */
    function dayExtras(iso, phClass) {
        if (!isHoliday(iso)) return { extraClass: '', titleAttr: '' };
        return {
            extraClass: ' ' + (phClass || 'appt-ph-day'),
            titleAttr: ' title="' + escAttr(name(iso)) + '"'
        };
    }

    function refreshAppointmentCalendars() {
        var apptOn = typeof apptSectionIsActive === 'function' && apptSectionIsActive();
        if (!apptOn) return;
        var tab = typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : '';
        if (tab === 'plusappt' && typeof renderPlusApptMiniCal === 'function') {
            renderPlusApptMiniCal();
        }
        if (tab === 'records' && typeof renderArMiniCal === 'function') renderArMiniCal();
        if (tab === 'recall' && typeof renderRcal === 'function') renderRcal();
        if (tab === 'calendar') {
            if (typeof renderCalMonthMini === 'function') renderCalMonthMini();
            if (typeof GCAL !== 'undefined' && GCAL.refreshMiniCalPanel) GCAL.refreshMiniCalPanel();
            if (typeof renderCal === 'function' && typeof calView !== 'undefined' &&
                calView === 'monthly') {
                renderCal();
            }
        }
        if (tab === 'webbook' && typeof WEBBOOK_ROSTER !== 'undefined' &&
            WEBBOOK_ROSTER.refreshManualMonth) {
            WEBBOOK_ROSTER.refreshManualMonth();
        }
    }

    return {
        load: load,
        isHoliday: isHoliday,
        name: name,
        escAttr: escAttr,
        dayExtras: dayExtras,
        refreshAppointmentCalendars: refreshAppointmentCalendars
    };
})();
