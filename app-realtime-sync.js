// app-realtime-sync.js — Live cross-PC sync (queue, bills, patients, notes, Rx, media, charts)
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
        notes: false,
        rx: false,
        pending: false,
        photo: false,
        xray: false,
        doc: false,
        chart: false
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

    function rtShouldRefreshXrayView() {
        if (typeof sectionVisible !== 'function' || !sectionVisible('consultationSection')) return false;
        if (typeof activeConsultationTabKey === 'function' && activeConsultationTabKey() === 'xrays') {
            return true;
        }
        if (typeof xrayPatientId !== 'undefined' && xrayPatientId &&
            typeof conPatientId !== 'undefined' && conPatientId &&
            String(xrayPatientId) === String(conPatientId)) {
            var main = g('xrayMainContent');
            return !!(main && main.style.display !== 'none');
        }
        return false;
    }

    function rtShouldRefreshPhotoView() {
        if (typeof sectionVisible !== 'function' || !sectionVisible('consultationSection')) return false;
        if (typeof activeConsultationTabKey === 'function' && activeConsultationTabKey() === 'photos') {
            return true;
        }
        if (typeof photoPatientId !== 'undefined' && photoPatientId &&
            typeof conPatientId !== 'undefined' && conPatientId &&
            String(photoPatientId) === String(conPatientId)) {
            var main = g('photoMainContent');
            return !!(main && main.style.display !== 'none');
        }
        return false;
    }

    /** Postgres DELETE often ships only primary key unless REPLICA IDENTITY FULL is set. */
    function rtPatientMediaRelevant(payload, kind) {
        var row = rtPayloadRow(payload);
        if (row && row.patient_id && rtTreatmentRelevant(row)) return true;

        var ev = payload && payload.eventType;
        if (ev === 'DELETE' || (ev === 'UPDATE' && row && !row.patient_id)) {
            if (kind === 'xray') return rtShouldRefreshXrayView();
            if (kind === 'photo') return rtShouldRefreshPhotoView();
            if (kind === 'doc') {
                return typeof activeConsultationTabKey === 'function' &&
                    activeConsultationTabKey() === 'forms' &&
                    typeof conPatientId !== 'undefined' && !!conPatientId;
            }
            if (kind === 'chart') {
                return typeof activeConsultationTabKey === 'function' &&
                    activeConsultationTabKey() === 'charting' &&
                    typeof conPatientId !== 'undefined' && !!conPatientId;
            }
            if ((kind === 'notes' || kind === 'rx') &&
                typeof conPatientId !== 'undefined' && conPatientId &&
                typeof sectionVisible === 'function' && sectionVisible('consultationSection')) {
                return true;
            }
        }
        return false;
    }

    function rtPendingRelevant(row) {
        if (!row) return false;
        if (typeof billPanelIsOpen === 'function' && billPanelIsOpen() &&
            typeof billPatId !== 'undefined' && billPatId &&
            row.patient_id && String(row.patient_id) === String(billPatId)) {
            return true;
        }
        return rtTreatmentRelevant(row);
    }

    function rtPendingEditPaused() {
        if (typeof billPanelIsOpen !== 'function' || !billPanelIsOpen()) return false;
        if (typeof isPendingListDirty === 'function' &&
            typeof pendingLists !== 'undefined' && typeof pendingIdx !== 'undefined') {
            var pl = pendingLists[pendingIdx];
            if (pl && isPendingListDirty(pl)) return true;
        }
        var ae = document.activeElement;
        if (ae && ae.closest && ae.closest('#pendingItemsBody')) return true;
        return false;
    }

    function rtPhotoEditPaused() {
        if (typeof photoUploadQueue !== 'undefined' && photoUploadQueue.length) return true;
        var modal = g('photoUploadModal');
        if (modal && modal.style.display !== 'none' && modal.style.display !== '') return true;
        return false;
    }

    function rtXrayEditPaused() {
        if (typeof xrayUploadQueue !== 'undefined' && xrayUploadQueue.length) return true;
        var modal = g('xrayUploadModal');
        if (modal && modal.style.display !== 'none' && modal.style.display !== '') return true;
        return false;
    }

    function rtDocEditPaused() {
        if (typeof conFormsEditingDocId !== 'undefined' && conFormsEditingDocId) return true;
        var ae = document.activeElement;
        if (ae && ae.closest) {
            if (ae.closest('#conFormsShellCard') || ae.closest('.doc-editor-host') ||
                ae.closest('#conFormsTplCard')) {
                return true;
            }
        }
        return false;
    }

    function rtChartEditPaused() {
        var ae = document.activeElement;
        if (!ae) return false;
        if (ae.id === 'dentalChartNotes' || ae.id === 'perioChartNotes') return true;
        if (ae.closest && ae.closest('.perio-input')) return true;
        return false;
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

    function rtRxEditPaused() {
        var ae = document.activeElement;
        if (!ae) return false;
        if (ae.id === 'rxDate' || ae.id === 'rxDentistName') return true;
        if (ae.closest) {
            if (ae.closest('#rxLinesWrap') || ae.closest('#addRxPanel') ||
                ae.closest('.rx-line-row') || ae.closest('#rxDrugListsModal')) {
                return true;
            }
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
            if (typeof loadQueue === 'function') loadQueue({ soft: true });
            return;
        }
        if (tab === 'today') {
            if (typeof apptModuleEditPaused === 'function' && apptModuleEditPaused('today')) {
                if (typeof apptModuleMarkRefreshDeferred === 'function') {
                    apptModuleMarkRefreshDeferred('today');
                }
                return;
            }
            if (typeof loadToday === 'function') loadToday({ soft: true });
            return;
        }
        if (tab === 'plusappt' || tab === 'calendar') {
            if (typeof apptModuleEditPaused === 'function' && apptModuleEditPaused(tab)) {
                if (typeof apptModuleMarkRefreshDeferred === 'function') {
                    apptModuleMarkRefreshDeferred(tab);
                }
                return;
            }
            if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData({ soft: true });
            return;
        }
        if (tab === 'records' && typeof loadApptRecords === 'function') {
            loadApptRecords();
        }
    }

    function refreshBillFromRealtime() {
        if (typeof billPanelIsOpen === 'function' && billPanelIsOpen()) {
            if (typeof refreshBillPanelLists === 'function') refreshBillPanelLists();
        }
        // Refresh payment history table whenever the detail modal is open,
        // regardless of the legacy billStep2IsVisible() gate (always false in current UI).
        var billDetailModalEl = document.getElementById('billDetailModal');
        if (billDetailModalEl && billDetailModalEl.style.display === 'block' &&
                typeof refreshBillDetailPayments === 'function') {
            refreshBillDetailPayments();
        }
        refreshApptUnpaidFromRealtime();
        try {
            document.dispatchEvent(new CustomEvent('consultation-ar-refresh'));
        } catch (_) {}
    }

    function refreshApptUnpaidFromRealtime() {
        if (typeof apptSectionIsActive !== 'function' || !apptSectionIsActive()) return;
        if (typeof hydrateApptUnpaidBalances !== 'function') return;

        var tab = typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : null;
        var list = null;
        if (tab === 'queue' && typeof queueApptsCache !== 'undefined') list = queueApptsCache;
        else if (tab === 'today' && typeof todayAppts !== 'undefined') list = todayAppts;
        else if (tab === 'plusappt' && typeof plusApptDayAppts !== 'undefined') list = plusApptDayAppts;
        else if (tab === 'calendar') {
            var panel = g('dayPanel');
            if (panel && panel.style.display !== 'none' && typeof _dayPanelCtx !== 'undefined' &&
                _dayPanelCtx && _dayPanelCtx.items) {
                list = _dayPanelCtx.items;
            } else if (typeof calView !== 'undefined') {
                var iso = typeof apptMemoDateIso === 'function'
                    ? apptMemoDateIso('calendar')
                    : (typeof todayISO === 'function' ? todayISO() : '');
                var cache = calView === 'monthly'
                    ? (typeof calMonthApptsCache !== 'undefined' ? calMonthApptsCache : [])
                    : (typeof calWeekApptsCache !== 'undefined' ? calWeekApptsCache : []);
                list = (cache || []).filter(function(a) {
                    return a && String(a.date || '') === String(iso || '');
                });
            }
        }
        if (!list || !list.length) return;

        hydrateApptUnpaidBalances(list, function(changed) {
            if (!changed) return;
            if (tab === 'queue') {
                if (!rtQueueRefreshAllowed()) {
                    scheduleRetry();
                    return;
                }
                if (typeof loadQueue === 'function') loadQueue();
            } else if (tab === 'today') {
                if (typeof apptModuleEditPaused === 'function' && apptModuleEditPaused('today')) {
                    if (typeof apptModuleMarkRefreshDeferred === 'function') {
                        apptModuleMarkRefreshDeferred('today');
                    }
                    return;
                }
                if (typeof loadToday === 'function') loadToday({ force: true });
            } else if (tab === 'plusappt' || tab === 'calendar') {
                if (typeof apptModuleEditPaused === 'function' && apptModuleEditPaused(tab)) {
                    if (typeof apptModuleMarkRefreshDeferred === 'function') {
                        apptModuleMarkRefreshDeferred(tab);
                    }
                    return;
                }
                if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
            }
        });
    }

    function refreshPendingFromRealtime() {
        if (typeof billPanelIsOpen === 'function' && billPanelIsOpen()) {
            if (rtPendingEditPaused()) {
                _pending.pending = true;
            } else if (typeof refreshBillPanelLists === 'function') {
                refreshBillPanelLists();
            } else if (typeof loadPendingLists === 'function') {
                loadPendingLists();
            }
        }
        refreshApptUnpaidFromRealtime();
    }

    function refreshPatientMediaFromRealtime(kind) {
        if (typeof sectionVisible !== 'function' || !sectionVisible('consultationSection')) {
            if (typeof sectionVisible === 'function' && sectionVisible('patientSection') &&
                typeof selPatientId !== 'undefined' && selPatientId &&
                typeof patViewLoadDashboard === 'function') {
                patViewLoadDashboard();
            }
            return;
        }
        if (kind === 'photo') {
            if (rtPhotoEditPaused()) {
                _pending.photo = true;
            } else if (typeof refreshPhotos === 'function' && rtShouldRefreshPhotoView()) {
                refreshPhotos();
            }
        } else if (kind === 'xray') {
            if (rtXrayEditPaused()) {
                _pending.xray = true;
            } else if (typeof refreshXrays === 'function' && rtShouldRefreshXrayView()) {
                refreshXrays();
            }
        } else if (kind === 'doc') {
            if (rtDocEditPaused()) {
                _pending.doc = true;
            } else if (typeof activeConsultationTabKey === 'function' &&
                activeConsultationTabKey() === 'forms' &&
                typeof refreshConFormsDocs === 'function') {
                refreshConFormsDocs();
            }
        }

        if (typeof conPatientId !== 'undefined' && conPatientId &&
            typeof loadConPatientTimeline === 'function') {
            loadConPatientTimeline(conPatientId);
        }
        if (typeof sectionVisible === 'function' && sectionVisible('patientSection') &&
            typeof patViewLoadDashboard === 'function') {
            patViewLoadDashboard();
        }
    }

    function refreshChartFromRealtime() {
        if (typeof sectionVisible === 'function' && sectionVisible('patientSection') &&
            typeof selPatientId !== 'undefined' && selPatientId &&
            typeof patViewLoadDashboard === 'function') {
            patViewLoadDashboard();
        }
        if (typeof sectionVisible !== 'function' || !sectionVisible('consultationSection')) return;
        if (typeof conPatientId === 'undefined' || !conPatientId) return;

        var onChartTab = typeof activeConsultationTabKey === 'function' &&
            activeConsultationTabKey() === 'charting';
        var chartMatches = typeof chartPatientId !== 'undefined' && chartPatientId &&
            String(chartPatientId) === String(conPatientId);

        if (onChartTab && chartMatches) {
            if (rtChartEditPaused()) {
                _pending.chart = true;
                return;
            }
            if (typeof loadChartRecord === 'function') loadChartRecord();
        }
        if (typeof loadConPatientTimeline === 'function') {
            loadConPatientTimeline(conPatientId);
        }
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

    function refreshRxFromRealtime() {
        var pid = null;
        if (typeof conPatientId !== 'undefined' && conPatientId) pid = String(conPatientId);
        else if (typeof selPatientId !== 'undefined' && selPatientId) pid = String(selPatientId);

        if (typeof sectionVisible === 'function' && sectionVisible('consultationSection') && pid) {
            if (rtRxEditPaused()) {
                _pending.rx = true;
                return;
            }
            if (typeof loadDrugHistory === 'function') loadDrugHistory(pid);
            if (typeof loadConPatientTimeline === 'function') loadConPatientTimeline(pid);
            return;
        }

        if (typeof sectionVisible === 'function' && sectionVisible('patientSection') &&
            typeof selPatientId !== 'undefined' && selPatientId &&
            typeof patViewLoadDashboard === 'function') {
            patViewLoadDashboard();
        }
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
            notes: _pending.notes,
            rx: _pending.rx,
            pending: _pending.pending,
            photo: _pending.photo,
            xray: _pending.xray,
            doc: _pending.doc,
            chart: _pending.chart
        };
        _pending = {
            appt: false,
            task: false,
            bill: false,
            payment: false,
            patient: false,
            notes: false,
            rx: false,
            pending: false,
            photo: false,
            xray: false,
            doc: false,
            chart: false
        };

        var anyAppt = flags.appt || flags.task || flags.patient;
        var anyBill = flags.bill || flags.payment || flags.pending;
        var anyNotes = flags.notes;
        var anyRx = flags.rx;
        var anyMedia = flags.photo || flags.xray || flags.doc || flags.chart;
        if (!anyAppt && !anyBill && !anyNotes && !anyRx && !anyMedia) return;

        if (flags.patient) refreshPatientFromRealtime();
        else if (anyAppt) refreshApptFromRealtime();
        if (flags.pending) refreshPendingFromRealtime();
        if (flags.bill || flags.payment) refreshBillFromRealtime();
        if (anyNotes) refreshNotesFromRealtime();
        if (anyRx) refreshRxFromRealtime();
        else if (anyAppt || flags.task) refreshConsultationFromRealtime(false);
        if (flags.photo) refreshPatientMediaFromRealtime('photo');
        if (flags.xray) refreshPatientMediaFromRealtime('xray');
        if (flags.doc) refreshPatientMediaFromRealtime('doc');
        if (flags.chart) refreshChartFromRealtime();
        if (anyAppt || anyBill || anyNotes || anyRx || anyMedia) refreshDashboardFromRealtime();

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

    function onPhotoChange(payload) {
        if (!rtPatientMediaRelevant(payload, 'photo')) return;
        scheduleRefresh('photo');
    }

    function onXrayChange(payload) {
        if (!rtPatientMediaRelevant(payload, 'xray')) return;
        scheduleRefresh('xray');
    }

    function onPatientDocumentChange(payload) {
        if (!rtPatientMediaRelevant(payload, 'doc')) return;
        scheduleRefresh('doc');
    }

    function onDentalChartChange(payload) {
        if (!rtPatientMediaRelevant(payload, 'chart')) return;
        scheduleRefresh('chart');
    }

    function onTreatmentChange(payload) {
        if (!rtPatientMediaRelevant(payload, 'notes') && !rtTreatmentRelevant(rtPayloadRow(payload))) return;
        scheduleRefresh('notes');
    }

    function onDrughistoryChange(payload) {
        if (!rtPatientMediaRelevant(payload, 'rx') && !rtTreatmentRelevant(rtPayloadRow(payload))) return;
        scheduleRefresh('rx');
    }

    function onPendingBillChange(payload) {
        var row = rtPayloadRow(payload);
        if (row && !rtPendingRelevant(row)) return;
        scheduleRefresh('pending');
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
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'drughistory'
            }, onDrughistoryChange)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'pending_bill_items'
            }, onPendingBillChange)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'photos'
            }, onPhotoChange)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'xrays'
            }, onXrayChange)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'patient_documents'
            }, onPatientDocumentChange)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'dental_charts'
            }, onDentalChartChange)
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
            notes: false,
            rx: false,
            pending: false,
            photo: false,
            xray: false,
            doc: false,
            chart: false
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
        var target = ev.target;
        if (!target) return;
        if (_pending.notes && target.id &&
            (target.id === 'conNoteInput' || target.id === 'xrayConNoteInput')) {
            scheduleRefresh('notes');
        }
        if (_pending.rx && (target.id === 'rxDate' || target.id === 'rxDentistName' ||
            (target.closest && (target.closest('#rxLinesWrap') || target.closest('#addRxPanel'))))) {
            scheduleRefresh('rx');
        }
        if (_pending.pending && target.closest && target.closest('#pendingItemsBody')) {
            scheduleRefresh('pending');
        }
        if (_pending.chart && (target.id === 'dentalChartNotes' || target.id === 'perioChartNotes' ||
            (target.closest && target.closest('.perio-input')))) {
            scheduleRefresh('chart');
        }
        if (_pending.doc && target.closest &&
            (target.closest('#conFormsShellCard') || target.closest('.doc-editor-host') ||
             target.closest('#conFormsTplCard'))) {
            scheduleRefresh('doc');
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
