// app-realtime-sync.js — Live cross-PC sync (queue, payments, lab/recall, patients, notes)
// Requires: SB (app.js), currentUserId, currentClinicId, currentClinicCodeForTagging
// ════════════════════════════════════════════════════════════════

var REALTIME_SYNC = (function() {

    if (window.__JOYFUL_RT_SYNC__) {
        return window.__JOYFUL_RT_SYNC__;
    }

    var CHANNEL_NAME = 'joyful_clinic_live_sync';
    var DEBOUNCE_MS = 650;
    var RETRY_MS = 1200;

    var _channel = null;
    var _started = false;
    var _debounceTimer = null;
    var _retryTimer = null;
    var _pending = {
        appt: false,
        task: false,
        bill: false,
        payment: false,
        patient: false,
        notes: false
    };
    var _syncState = 'off'; // off | connecting | live | error
    var _lastSyncAt = null;
    var _remotePatientRow = null;

    function g(id) {
        return document.getElementById(id);
    }

    function tr(key, fallback) {
        if (typeof t === 'function') {
            var v = t(key);
            if (v && v !== key) return v;
        }
        return fallback || key;
    }

    function rtClinicTag() {
        if (typeof currentClinicCodeForTagging === 'function') {
            return String(currentClinicCodeForTagging() || '').trim();
        }
        return '';
    }

    function rtRowMatchesClinic(row) {
        if (!row) return true;
        var tag = rtClinicTag();
        if (!tag) return true;

        var rowTag = String(row.clinic_tag || '').trim();
        if (!rowTag && row.clinic_id) {
            if (typeof clinicRecordFromId === 'function') {
                var byId = clinicRecordFromId(row.clinic_id);
                if (byId) rowTag = String(byId.clinic_code || '').trim();
            }
            if (!rowTag) rowTag = String(row.clinic_id || '').trim();
        }
        if (!rowTag) return true;

        if (rowTag === tag) return true;
        if (typeof currentClinicId !== 'undefined' && currentClinicId &&
            String(row.clinic_id || '') === String(currentClinicId)) {
            return true;
        }
        if (typeof clinicRecordFromId === 'function' && currentClinicId) {
            var rec = clinicRecordFromId(currentClinicId);
            if (rec) {
                var code = String(rec.clinic_code || '').trim();
                if (code && (code === rowTag || code === String(row.clinic_id || '').trim())) {
                    return true;
                }
            }
        }
        return false;
    }

    function rtPayloadRow(payload) {
        if (!payload) return null;
        return payload.new || payload.old || null;
    }

    function rtDateLocale() {
        if (typeof apptDateLocale === 'function') return apptDateLocale();
        if (typeof appUiLang !== 'undefined' && appUiLang) return appUiLang;
        return undefined;
    }

    function rtFormatSyncTime(d) {
        if (!d || isNaN(d.getTime())) return tr('realtime.lastSync.never', '—');
        try {
            return d.toLocaleTimeString(rtDateLocale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch (_) {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        }
    }

    function rtPatientInActiveApptLists(patientId) {
        patientId = String(patientId || '').trim();
        if (!patientId) return false;
        var lists = [];
        if (typeof queueApptsCache !== 'undefined') lists.push(queueApptsCache);
        if (typeof todayAppts !== 'undefined') lists.push(todayAppts);
        for (var L = 0; L < lists.length; L++) {
            var list = lists[L] || [];
            for (var i = 0; i < list.length; i++) {
                if (list[i] && String(list[i].patient_id || '') === patientId) return true;
            }
        }
        return false;
    }

    function rtPatientRelevant(row) {
        if (!row || !row.id) return false;
        var pid = String(row.id);
        if (typeof conPatientId !== 'undefined' && conPatientId && String(conPatientId) === pid) return true;
        if (typeof selPatientId !== 'undefined' && selPatientId && String(selPatientId) === pid) return true;
        if (rtPatientInActiveApptLists(pid)) return true;
        return rtRowMatchesClinic(row);
    }

    function rtTreatmentRelevant(row) {
        if (!row || !row.patient_id) return false;
        var pid = String(row.patient_id);
        if (typeof conPatientId !== 'undefined' && conPatientId && String(conPatientId) === pid) return true;
        if (typeof selPatientId !== 'undefined' && selPatientId && String(selPatientId) === pid) return true;
        return rtPatientInActiveApptLists(pid);
    }

    function rtNotesEditPaused() {
        var ids = ['conNoteInput', 'xrayConNoteInput'];
        for (var i = 0; i < ids.length; i++) {
            var inp = g(ids[i]);
            if (inp && document.activeElement === inp) return true;
        }
        var ae = document.activeElement;
        if (ae && ae.closest) {
            if (ae.closest('.con-note-edit-input') || ae.closest('.con-note-editing')) return true;
        }
        return false;
    }

    function rtQueueRefreshAllowed() {
        if (typeof queueReorderDragApptId !== 'undefined' && queueReorderDragApptId) return false;
        try {
            if (window.__JOYFUL_QUEUE_REORDER_ID) return false;
        } catch (_) {}
        if (typeof apptModalIsOpen === 'function' && apptModalIsOpen('queueRemarksModal')) return false;
        return true;
    }

    function scheduleRefresh(kind) {
        if (!_started || !currentUserId) return;
        if (kind && Object.prototype.hasOwnProperty.call(_pending, kind)) {
            _pending[kind] = true;
        }
        clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(flushPending, DEBOUNCE_MS);
    }

    function scheduleRetry() {
        clearTimeout(_retryTimer);
        _retryTimer = setTimeout(function() {
            _retryTimer = null;
            _pending.appt = true;
            flushPending();
        }, RETRY_MS);
    }

    function applyRemoteTaskRow(payload) {
        if (typeof plusApptTaskMapRead !== 'function' ||
            typeof plusApptTaskMapWrite !== 'function') {
            return;
        }
        var map = plusApptTaskMapRead();
        if (payload && payload.eventType === 'DELETE' && payload.old && payload.old.appointment_id) {
            delete map[String(payload.old.appointment_id)];
            plusApptTaskMapWrite(map);
            return;
        }
        var row = payload && payload.new;
        if (!row || !row.appointment_id) return;
        if (typeof plusApptMergeTaskRows === 'function') {
            plusApptMergeTaskRows([row], []);
            return;
        }
        var id = String(row.appointment_id);
        var lab = typeof plusApptNormLabState === 'function'
            ? plusApptNormLabState(row.lab_status || row.lab)
            : String(row.lab_status || 'na');
        var recall = typeof plusApptNormRecallState === 'function'
            ? plusApptNormRecallState(row.recall_status || row.recall)
            : String(row.recall_status || '');
        if ((lab === 'na' || !lab) && !recall) delete map[id];
        else map[id] = { lab: lab, recall: recall };
        plusApptTaskMapWrite(map);
    }

    function refreshApptFromRealtime() {
        if (typeof apptSectionIsActive !== 'function' || !apptSectionIsActive()) return;

        var tab = typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : null;
        if (tab === 'queue') {
            if (!rtQueueRefreshAllowed()) {
                scheduleRetry();
                return;
            }
            if (typeof loadQueue === 'function') loadQueue();
            return;
        }
        if (tab === 'today') {
            if (typeof apptModuleEditPaused === 'function' && apptModuleEditPaused('today')) {
                if (typeof apptModuleMarkRefreshDeferred === 'function') {
                    apptModuleMarkRefreshDeferred('today');
                }
                return;
            }
            if (typeof loadToday === 'function') loadToday();
            return;
        }
        if (tab === 'plusappt' || tab === 'calendar') {
            if (typeof apptModuleEditPaused === 'function' && apptModuleEditPaused(tab)) {
                if (typeof apptModuleMarkRefreshDeferred === 'function') {
                    apptModuleMarkRefreshDeferred(tab);
                }
                return;
            }
            if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
            return;
        }
        if (tab === 'records' && typeof loadApptRecords === 'function') {
            loadApptRecords();
        }
    }

    function refreshBillFromRealtime() {
        if (typeof billPanelIsOpen === 'function' && billPanelIsOpen()) {
            if (typeof refreshBillPanelLists === 'function') refreshBillPanelLists();
            if (typeof billStep2IsVisible === 'function' && billStep2IsVisible() &&
                typeof refreshBillDetailPayments === 'function') {
                refreshBillDetailPayments();
            }
        }
        try {
            document.dispatchEvent(new CustomEvent('consultation-ar-refresh'));
        } catch (_) {}
    }

    function refreshConsultationFromRealtime(includeNotes) {
        if (typeof sectionVisible !== 'function' || !sectionVisible('consultationSection')) return;
        if (typeof conPatientId === 'undefined' || !conPatientId) return;
        if (includeNotes) {
            if (rtNotesEditPaused()) {
                _pending.notes = true;
                return;
            }
            if (typeof loadConNotes === 'function') loadConNotes(conPatientId);
        }
        if (typeof loadConPatientTimeline === 'function') {
            loadConPatientTimeline(conPatientId);
        }
    }

    function refreshPatientFromRealtime() {
        var row = _remotePatientRow;
        _remotePatientRow = null;

        if (typeof sectionVisible === 'function' && sectionVisible('patientSection')) {
            if (typeof fetchPatients === 'function') fetchPatients();
            if (typeof selPatientId !== 'undefined' && selPatientId &&
                typeof loadTreatments === 'function') {
                loadTreatments(selPatientId);
            }
        }
        if (typeof refreshApptListsAfterPatientEdit === 'function') {
            refreshApptListsAfterPatientEdit(row || {
                id: (typeof conPatientId !== 'undefined' && conPatientId)
                    ? conPatientId
                    : ((typeof selPatientId !== 'undefined' && selPatientId) ? selPatientId : null)
            });
        } else if (typeof apptSectionIsActive === 'function' && apptSectionIsActive()) {
            refreshApptFromRealtime();
        }
        if (typeof sectionVisible === 'function' && sectionVisible('consultationSection') &&
            typeof conPatientId !== 'undefined' && conPatientId) {
            if (typeof loadMedicalHistory === 'function') loadMedicalHistory();
            if (typeof refreshConPatientAlertBanners === 'function') {
                refreshConPatientAlertBanners(row || undefined);
            }
        }
    }

    function refreshNotesFromRealtime() {
        if (typeof sectionVisible !== 'function' || !sectionVisible('consultationSection')) return;
        if (typeof conPatientId === 'undefined' || !conPatientId) return;
        if (rtNotesEditPaused()) {
            _pending.notes = true;
            return;
        }
        if (typeof loadConNotes === 'function') loadConNotes(conPatientId);
        if (typeof loadConPatientTimeline === 'function') loadConPatientTimeline(conPatientId);
    }

    function refreshDashboardFromRealtime() {
        if (typeof sectionVisible !== 'function' || !sectionVisible('dashboardSection')) return;
        if (typeof refreshDashboardUserBadge === 'function') refreshDashboardUserBadge();
        if (typeof MEMO_AI !== 'undefined' && typeof MEMO_AI.refreshDashboardStickies === 'function') {
            MEMO_AI.refreshDashboardStickies();
        }
    }

    function flushPending() {
        _debounceTimer = null;
        if (!_started || !currentUserId) return;
        if (typeof document !== 'undefined' && document.hidden) return;

        var flags = {
            appt: _pending.appt,
            task: _pending.task,
            bill: _pending.bill,
            payment: _pending.payment,
            patient: _pending.patient,
            notes: _pending.notes
        };
        _pending = {
            appt: false,
            task: false,
            bill: false,
            payment: false,
            patient: false,
            notes: false
        };

        var anyAppt = flags.appt || flags.task || flags.patient;
        var anyBill = flags.bill || flags.payment;
        var anyNotes = flags.notes;
        if (!anyAppt && !anyBill && !anyNotes) return;

        if (flags.patient) refreshPatientFromRealtime();
        else if (anyAppt) refreshApptFromRealtime();
        if (anyBill) refreshBillFromRealtime();
        if (anyNotes) refreshNotesFromRealtime();
        else if (anyAppt || flags.task) refreshConsultationFromRealtime(false);
        if (anyAppt || anyBill || anyNotes) refreshDashboardFromRealtime();

        markLastSynced();
        pulseSyncIndicator();
    }

    function renderLastSynced() {
        var el = g('appRealtimeSyncTime');
        if (!el) return;
        if (!_lastSyncAt) {
            el.textContent = tr('realtime.lastSync.waiting', '…');
            el.title = tr('realtime.lastSync.waitingTitle', 'Waiting for first live update');
            return;
        }
        var t = rtFormatSyncTime(_lastSyncAt);
        el.textContent = (typeof trRepl === 'function')
            ? trRepl('realtime.lastSync.at', { T: t })
            : tr('realtime.lastSync.at', 'Synced {T}').replace('{T}', t);
        el.title = el.textContent;
    }

    function markLastSynced() {
        _lastSyncAt = new Date();
        renderLastSynced();
        var dot = g('appRealtimeSyncDot');
        if (dot && _syncState === 'live') {
            dot.title = tr('realtime.status.live', 'Live sync active') + ' · ' +
                (_lastSyncAt ? rtFormatSyncTime(_lastSyncAt) : '');
        }
    }

    function setSyncState(state) {
        _syncState = state;
        var dot = g('appRealtimeSyncDot');
        if (!dot) return;
        dot.className = 'app-realtime-sync-dot app-realtime-sync-dot--' + state;
        dot.title = tr('realtime.status.' + state, state);
        if (state === 'live' && _lastSyncAt) {
            dot.title += ' · ' + rtFormatSyncTime(_lastSyncAt);
        }
        renderLastSynced();
    }

    function ensureSyncIndicator() {
        var strip = g('appSessionStrip');
        if (!strip || g('appRealtimeSyncWrap')) return;
        var wrap = document.createElement('span');
        wrap.id = 'appRealtimeSyncWrap';
        wrap.className = 'app-realtime-sync-wrap';

        var dot = document.createElement('span');
        dot.id = 'appRealtimeSyncDot';
        dot.className = 'app-realtime-sync-dot app-realtime-sync-dot--off';
        dot.setAttribute('aria-hidden', 'true');
        dot.title = tr('realtime.status.off', 'Live sync off');

        var timeEl = document.createElement('span');
        timeEl.id = 'appRealtimeSyncTime';
        timeEl.className = 'app-realtime-sync-time';
        timeEl.textContent = tr('realtime.lastSync.waiting', '…');
        timeEl.title = tr('realtime.lastSync.waitingTitle', 'Waiting for first live update');

        wrap.appendChild(dot);
        wrap.appendChild(timeEl);

        var anchor = strip.querySelector('.app-session-strip-meta');
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
        } else {
            strip.appendChild(wrap);
        }
    }

    function pulseSyncIndicator() {
        var dot = g('appRealtimeSyncDot');
        if (!dot) return;
        dot.classList.add('app-realtime-sync-dot--pulse');
        setTimeout(function() {
            if (dot) dot.classList.remove('app-realtime-sync-dot--pulse');
        }, 900);
    }

    function onAppointmentChange(payload) {
        var row = rtPayloadRow(payload);
        if (row && !rtRowMatchesClinic(row)) return;
        scheduleRefresh('appt');
    }

    function onTaskStateChange(payload) {
        applyRemoteTaskRow(payload);
        scheduleRefresh('task');
    }

    function onBillChange(payload) {
        var row = rtPayloadRow(payload);
        if (row && !rtRowMatchesClinic(row)) return;
        scheduleRefresh('bill');
    }

    function onPaymentChange(payload) {
        var row = rtPayloadRow(payload);
        if (row && !rtRowMatchesClinic(row)) return;
        scheduleRefresh('payment');
    }

    function onPatientChange(payload) {
        var row = rtPayloadRow(payload);
        if (row && !rtPatientRelevant(row)) return;
        if (row && row.id) _remotePatientRow = row;
        scheduleRefresh('patient');
    }

    function onTreatmentChange(payload) {
        var row = rtPayloadRow(payload);
        if (row && !rtTreatmentRelevant(row)) return;
        scheduleRefresh('notes');
    }

    function unsubscribe() {
        if (!_channel || typeof SB === 'undefined') {
            _channel = null;
            return;
        }
        try {
            SB.removeChannel(_channel);
        } catch (_) {}
        _channel = null;
    }

    function subscribe() {
        if (typeof SB === 'undefined' || !SB || typeof SB.channel !== 'function') return;
        if (_channel) return;

        setSyncState('connecting');
        _channel = SB.channel(CHANNEL_NAME)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'appointments'
            }, onAppointmentChange)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'appointment_task_states'
            }, onTaskStateChange)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'bills'
            }, onBillChange)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'bill_payments'
            }, onPaymentChange)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'patients'
            }, onPatientChange)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'treatments'
            }, onTreatmentChange)
            .subscribe(function(status) {
                if (status === 'SUBSCRIBED') setSyncState('live');
                else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSyncState('error');
                else if (status === 'CLOSED') setSyncState('off');
            });
    }

    function start() {
        if (_started || !currentUserId || typeof SB === 'undefined') return;
        _started = true;
        ensureSyncIndicator();
        subscribe();
    }

    function stop() {
        _started = false;
        clearTimeout(_debounceTimer);
        clearTimeout(_retryTimer);
        _debounceTimer = null;
        _retryTimer = null;
        _pending = {
            appt: false,
            task: false,
            bill: false,
            payment: false,
            patient: false,
            notes: false
        };
        _lastSyncAt = null;
        _remotePatientRow = null;
        unsubscribe();
        setSyncState('off');
        renderLastSynced();
    }

    function restart() {
        stop();
        if (currentUserId) start();
    }

    document.addEventListener('visibilitychange', function() {
        if (!document.hidden && _started) flushPending();
    });

    document.addEventListener('app-session-sync', function() {
        if (currentUserId) {
            if (!_started) start();
            else if (!_channel) subscribe();
        } else {
            stop();
        }
    });

    document.addEventListener('app-working-date-change', function() {
        scheduleRefresh('appt');
    });

    document.addEventListener('focusout', function(ev) {
        if (!_pending.notes) return;
        var target = ev.target;
        if (!target || !target.id) return;
        if (target.id === 'conNoteInput' || target.id === 'xrayConNoteInput') {
            scheduleRefresh('notes');
        }
    }, true);

    var _api = {
        start: start,
        stop: stop,
        restart: restart,
        pulse: pulseSyncIndicator
    };
    window.__JOYFUL_RT_SYNC__ = _api;
    return _api;

})();

window.startRealtimeSync = REALTIME_SYNC.start;
window.stopRealtimeSync = REALTIME_SYNC.stop;
window.restartRealtimeSync = REALTIME_SYNC.restart;
