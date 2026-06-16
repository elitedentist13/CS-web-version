// ════════════════════════════════════════════════════════════════
// APPOINTMENT MODULE
// ════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────
var apptEditId   = null;
/** Appointment row while edit modal is open (for schedule-lock checks). */
var apptEditLockRef = null;
var apptEditScheduleLocked = false;
var psTimer      = null;
var calDate      = new Date();
var calView      = 'weekly';
var billApptId   = null;
/** Default doctor when creating a list from an appointment row (resolved to doctors.id). */
var billApptDefaultDoctorId = null;
var billApptDoctorCode = null;
var billPatId    = null;
var billPatName  = null;
var billPatChineseName = null;
var billPatNo    = null;
var billHistoryCache = [];
var billHistoryFilterFrom = '';
var billHistoryFilterTo = '';
var billItems    = [];
var billDoctorList = [];
var treatmentItemsCache = [];
var billPendingRefreshTimer = null;
var billPendingRefreshBusy = false;
var billPendingRefreshState = 'idle';
var billPendingLastRefreshAt = null;
var DEFAULT_BILL_PENDING_REFRESH_MS = 10000;

var todayAppts   = [];   // last-fetched list for the Today tab (used by print)
var queueApptsCache = [];
/** Selected appointment row id on Today / Queue tabs (for highlight + active patient). */
var apptListSelectedApptId = null;
var apptListSelectedTab = '';
/** Today's walk-in appointment id awaiting patient registration before check-in. */
var todayApptPendingPatientRegId = null;
var TODAY_NOSHOW_DISMISS_LS = 'joyful_today_noshow_dismiss_v1';
var calMonthApptsCache = [];
var calWeekApptsCache = [];

function findApptInCalendarCaches(apptId) {
    var id = String(apptId || '').trim();
    if (!id) return null;
    var lists = [calMonthApptsCache, calWeekApptsCache, plusApptDayAppts, todayAppts, queueApptsCache];
    for (var li = 0; li < lists.length; li++) {
        var list = lists[li];
        if (!list || !list.length) continue;
        for (var i = 0; i < list.length; i++) {
            if (list[i] && String(list[i].id) === id) return list[i];
        }
    }
    return null;
}

window.resolvePatientDragPayloadFromPlain = function(raw) {
    var key = String(raw || '').trim();
    if (!key) return null;
    if (typeof parsePatientDragPayload === 'function') {
        var direct = parsePatientDragPayload(key);
        if (direct) return direct;
    }
    var appt = findApptInCalendarCaches(key);
    if (!appt || typeof patientDragPayloadFromAppt !== 'function') return null;
    return patientDragPayloadFromAppt(appt);
};

function apptSetActivePatientFromAppt(a, source) {
    if (!a || typeof patientDragPayloadFromAppt !== 'function') return false;
    function applyPayload(apptRow) {
        var p = patientDragPayloadFromAppt(apptRow);
        if (!p || !p.id) return false;
        if (typeof setActivePatientFromPayload === 'function') {
            setActivePatientFromPayload(p, source || 'appt-row-select');
            return true;
        }
        if (typeof setActivePatientSlot === 'function') {
            setActivePatientSlot(0, p, source || 'appt-row-select', true);
            return true;
        }
        return false;
    }
    if (applyPayload(a)) return true;
    var no = String(a.patient_no || '').trim();
    if (no && !a.patient_id && typeof resolveQueueRowPatientId === 'function') {
        resolveQueueRowPatientId(a, function() {
            applyPayload(a);
        });
        return true;
    }
    return false;
}

function apptSnapActivePatientFromCalendarAppt(a, source) {
    if (!a || typeof apptSetActivePatientFromAppt !== 'function') return;
    if (!a.patient_id && !String(a.patient_no || '').trim()) return;
    apptSetActivePatientFromAppt(a, source || 'calendar-appt-select');
    if (typeof setActivePatientDockCollapsed === 'function') {
        setActivePatientDockCollapsed(false, true);
    }
}

function apptFindListRowAppt(apptId, tabKey) {
    var id = String(apptId || '');
    if (!id) return null;
    if (tabKey === 'records') {
        var recList = typeof arAllData !== 'undefined' ? (arAllData || []) : [];
        for (var r = 0; r < recList.length; r++) {
            if (recList[r] && String(recList[r].id) === id) return recList[r];
        }
        return null;
    }
    var list = tabKey === 'queue'
        ? (queueApptsCache || [])
        : (tabKey === 'today' ? (todayAppts || []) : []);
    for (var i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].id) === id) return list[i];
    }
    return null;
}

function apptListRowClickBlocked(el) {
    return !!(el && el.closest && el.closest(
        'input, button, textarea, select, .action-wrap, .action-drop, ' +
        '.queue-remarks-preview-wrap, .queue-remarks-pencil, .plusappt-remarks-preview-wrap, .plusappt-remarks-nav, .appt-unpaid-badge, ' +
        '.appt-task-pill-btn, .plusappt-task-wrap, .plusappt-task-btn, a'
    ));
}

function apptMarkListRowSelected(row, apptId) {
    var tb = row && row.parentNode ? row.parentNode : null;
    if (tb) {
        tb.querySelectorAll('.appt-list-row-selected').forEach(function(r) {
            r.classList.remove('appt-list-row-selected');
        });
    }
    apptListSelectedApptId = apptId ? String(apptId) : null;
    if (row && apptId) row.classList.add('appt-list-row-selected');
}

function apptSelectListRow(a, row, tabKey) {
    if (!a || !row) return;
    apptListSelectedTab = tabKey || '';
    apptMarkListRowSelected(row, a.id);
    apptSetActivePatientFromAppt(a, 'appt-' + (tabKey || 'list') + '-row-select');
}

function apptRestoreListRowSelection(tb, tabKey) {
    if (!tb || !apptListSelectedApptId || apptListSelectedTab !== tabKey) return;
    var row = tb.querySelector('tr[data-appt-id="' + apptListSelectedApptId + '"]');
    if (row) row.classList.add('appt-list-row-selected');
    var a = apptFindListRowAppt(apptListSelectedApptId, tabKey);
    if (a) apptSetActivePatientFromAppt(a, 'appt-' + tabKey + '-row-restore');
}

function apptBindListRowPatientDrag(row, a) {
    if (!row || !a || !a.patient_id) return;
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', function(ev) {
        if (apptListRowClickBlocked(ev.target)) {
            ev.preventDefault();
            return;
        }
        if (typeof beginApptPatientDragTransfer === 'function') {
            beginApptPatientDragTransfer(ev, a);
        }
    });
    row.addEventListener('dragend', function() {
        if (typeof clearPatientDragPayloadSession === 'function') {
            clearPatientDragPayloadSession();
        }
    });
}
var calMonthTransferDragApptId = null;
var calMonthTransferState = null;
var calMonthBulkTransferDragDate = '';
var calMonthBulkTransferState = null;
var calMonthMiniOpen = false;
var calMonthMiniDate = new Date();

// ── + Appointment tab (day planner) ─────────────────────────────
var plusApptDate = '';
var plusApptMiniCalMonth = new Date();
var plusApptDayAppts = [];
var plusApptSelectedSlot = null;
var plusApptSelectedAppt = null;
var plusApptHeaderPatient = null;
var plusApptPsTimer = null;
var plusApptTabBound = false;
var plusApptActiveClinicId = '';
var plusApptActiveDoctorCode = '';
var plusApptClinicUiState = {};
var plusApptClinicSyncing = false;
var plusApptAllActiveDoctorCode = '';
var PLUSAPPT_DOCTOR_ALL = '__all__';
var PLUSAPPT_SLOT_MIN = 15;
var plusApptDragApptId = null;
/** Mini-calendar staging — survives patient-drag payload on text/plain. */
var PLUSAPPT_ROW_DRAG_TYPE = 'text/x-plusappt-row-id';
var PLUSAPPT_TASK_LS_KEY = 'plusappt_task_state_v1';
var plusApptTransferState = null;
var plusApptTransferDragActive = false;
/** Cut pending: source row hidden in UI until paste confirms or cancel restores. */
var apptTransferPendingCut = null;
/** Completed transfer history (session-scoped; cleared on X or logout). */
var PLUSAPPT_TRANSFER_HISTORY_LS = 'plusappt_transfer_history_v1';
var plusApptTransferHistoryEntries = null;
var plusApptTransferHistoryCacheKey = '';
/** After save/edit: select this appointment row once day data reloads. */
var plusApptPendingSelectApptId = null;
var plusApptDayLoadSeq = 0;
var todayLoadSeq = 0;
var plusApptRemarksLinesCache = {};
var apptUnpaidByPatientId = {};
var apptUnpaidByPatientNo = {};
var apptUnpaidBadgeClickBound = false;
var apptImportModalBound = false;
var apptImportPreviewRows = [];
var PLUSAPPT_CLINIC_THEMES = [
    { bg: '#eff6ff', border: '#3b82f6', sel: '#2563eb', accent: '#1e40af', shadow: 'rgba(37,99,235,0.12)', badge: '#dbeafe' },
    { bg: '#f0fdf4', border: '#22c55e', sel: '#16a34a', accent: '#166534', shadow: 'rgba(34,197,94,0.12)', badge: '#dcfce7' },
    { bg: '#fdf4ff', border: '#a855f7', sel: '#9333ea', accent: '#6b21a8', shadow: 'rgba(168,85,247,0.12)', badge: '#f3e8ff' },
    { bg: '#fff7ed', border: '#f97316', sel: '#ea580c', accent: '#9a3412', shadow: 'rgba(249,115,22,0.12)', badge: '#ffedd5' },
    { bg: '#ecfeff', border: '#06b6d4', sel: '#0891b2', accent: '#155e75', shadow: 'rgba(6,182,212,0.12)', badge: '#cffafe' },
    { bg: '#fef2f2', border: '#ef4444', sel: '#dc2626', accent: '#991b1b', shadow: 'rgba(239,68,68,0.12)', badge: '#fee2e2' },
    { bg: '#f8fafc', border: '#64748b', sel: '#475569', accent: '#334155', shadow: 'rgba(100,116,139,0.12)', badge: '#e2e8f0' },
    { bg: '#fefce8', border: '#eab308', sel: '#ca8a04', accent: '#854d0e', shadow: 'rgba(234,179,8,0.14)', badge: '#fef9c3' }
];

/** Appointment id whose remarks are open in `queueRemarksModal`. */
var queueRemarksEditApptId = null;
/** Full appointment row for queue remarks modal (language refresh). */
var _queueRemarksEditAppt = null;
/** Raw remarks before edit (preserve staff author tag when doctor saves). */
var queueRemarksEditPriorRaw = null;
var queueRemarksModalBound = false;
var queueRefreshBtnBound = false;
var queueClearModeBtnBound = false;
var todayClearModeBtnBound = false;
var queueReorderDragApptId = '';
var queueCompactFitBound = false;
var queueCompactFitTimer = null;
var queueSettingsBtnBound = false;
var todaySettingsBtnBound = false;
var queueLastRefreshAt = null;
var queueElapsedClosedAtByApptId = {};
var queueElapsedTickerId = null;
/** Bumps on each loadQueue(); stale augment callbacks must not append rows. */
var queueLoadSeq = 0;

/** When true, appointment date must be today or later (records tab: new visit from a past row). */
var arBookingMinDateToday = false;

// ── Pending bill item lists (Step 1 / Step 2) ─────────
var pendingLists = [];   // array fetched from pending_bill_items table

/** Bill saved with no payment — use Pending / N/A, not Cash/Card. */
var BILL_PAY_TYPE_PENDING = 'Pending';
var BILL_PAY_TYPE_NA = 'N/A';

function billPendingPayTypeCandidates() {
    return [BILL_PAY_TYPE_PENDING, BILL_PAY_TYPE_NA, 'NA', 'Unknown'];
}

function billPendingPayTypeValue(sel) {
    sel = sel || g('bType');
    var candidates = billPendingPayTypeCandidates();
    if (sel && sel.options && sel.options.length) {
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i];
            var found = Array.prototype.some.call(sel.options, function (o) {
                return o.value === c;
            });
            if (found) return c;
        }
    }
    if (billTypesCache && billTypesCache.length) {
        for (var j = 0; j < candidates.length; j++) {
            var want = candidates[j];
            for (var k = 0; k < billTypesCache.length; k++) {
                var bt = billTypesCache[k];
                var n = String(bt.name || bt.type_code || '').trim();
                if (n === want) return n;
            }
        }
    }
    return BILL_PAY_TYPE_PENDING;
}

function ensurePendingBillTypeOption(sel) {
    if (!sel) return;
    var val = billPendingPayTypeValue(sel);
    var has = Array.prototype.some.call(sel.options || [], function (o) {
        return o.value === val;
    });
    if (has) return;
    var o = document.createElement('option');
    o.value = val;
    o.textContent = (typeof dispPayMethod === 'function') ? dispPayMethod(val) : val;
    if (sel.firstChild) sel.insertBefore(o, sel.firstChild);
    else sel.appendChild(o);
}

function billIsFullyUnpaidSave(paid, balance, total) {
    return total > 0.005 && paid <= 0.005 && balance > 0.005;
}

function billDefaultPayTypeValue() {
    if (billTypesCache && billTypesCache.length) {
        var i;
        for (i = 0; i < billTypesCache.length; i++) {
            if (billTypesCache[i].is_default && billTypeRowIsPayable(billTypesCache[i])) {
                return billTypeOptionValue(billTypesCache[i]);
            }
        }
        for (i = 0; i < billTypesCache.length; i++) {
            if (billTypeRowIsPayable(billTypesCache[i])) {
                return billTypeOptionValue(billTypesCache[i]);
            }
        }
    }
    return 'Cash';
}

function billResolvePayTypeForSave(paid, balance, total, selectedType) {
    var s = String(selectedType || '').trim();
    var pendingVals = billPendingPayTypeCandidates();
    if (paid > 0.005 && pendingVals.indexOf(s) >= 0) {
        return billDefaultPayTypeValue();
    }
    if (paid > 0.005) return s || billDefaultPayTypeValue();
    return billPendingPayTypeValue();
}

/** Step 2: zero paid → Pending; restore held method when user enters a payment. */
function syncBillPayTypeForBalance(total, paid, balance) {
    var bType = g('bType');
    if (!bType) return;
    bType.disabled = false;
    var pendingVals = billPendingPayTypeCandidates();
    if (paid <= 0.005) {
        if (!bType.dataset.billTypeHold && bType.value &&
            pendingVals.indexOf(bType.value) < 0) {
            bType.dataset.billTypeHold = bType.value;
        }
        ensurePendingBillTypeOption(bType);
        bType.value = billPendingPayTypeValue(bType);
        return;
    }
    var cur = String(bType.value || '').trim();
    if (cur && pendingVals.indexOf(cur) < 0) {
        delete bType.dataset.billTypeHold;
        return;
    }
    if (bType.dataset.billTypeHold) {
        var hold = bType.dataset.billTypeHold;
        delete bType.dataset.billTypeHold;
        if (Array.prototype.some.call(bType.options || [], function (o) { return o.value === hold; })) {
            bType.value = hold;
        }
    }
}

/** Keep billTypeHold aligned when user picks a method before entering paid amount. */
function billSyncPaymentMethodHoldFromUi() {
    var bType = g('bType');
    if (!bType) return;
    var paidEl = g('bAmtPaid');
    var paid = paidEl ? (parseFloat(paidEl.value) || 0) : 0;
    if (paid > 0.005) return;
    var cur = String(bType.value || '').trim();
    var pendingVals = billPendingPayTypeCandidates();
    if (cur && pendingVals.indexOf(cur) < 0) {
        bType.dataset.billTypeHold = cur;
    }
}

function billClinicFieldsForSave() {
    var clinicIdForBill = currentClinicId ||
        ((g('apptClinicSelect') && g('apptClinicSelect').value) ? g('apptClinicSelect').value : null);
    var clinicTagForBill = (typeof currentClinicCodeForTagging === 'function')
        ? currentClinicCodeForTagging()
        : '';
    if (!clinicTagForBill && clinicIdForBill && typeof clinicRecordFromId === 'function') {
        var rec = clinicRecordFromId(clinicIdForBill);
        if (rec) {
            clinicTagForBill = String(rec.clinic_code || '').trim() || String(rec.id || '').trim();
        }
    }
    return {
        clinic_id: clinicIdForBill || null,
        clinic_tag: clinicTagForBill || null
    };
}

function billDoctorFieldsForSave(pickedId, opts) {
    opts = opts || {};
    var picked = pickedId
        ? (billDoctorList || []).find(function (d) { return String(d.id) === String(pickedId); })
        : null;
    if (picked) {
        return {
            doctor_id: picked.id || null,
            doctor_name: (typeof doctorDisplayName === 'function')
                ? (doctorDisplayName(picked) || null)
                : (picked.display_name || picked.english_name || picked.chinese_name || null),
            doctor_tag: billDoctorTag(picked) || null
        };
    }
    if (opts.noFallback) return {};
    var drCtx = (typeof getActiveDoctorContext === 'function')
        ? getActiveDoctorContext()
        : null;
    if (drCtx && drCtx.shouldTag) {
        return {
            doctor_id: drCtx.id || null,
            doctor_name: drCtx.name || null,
            doctor_tag: drCtx.tag || drCtx.name || null
        };
    }
    return {};
}

function stripOptionalBillColsByError(src, errMsg) {
    var out = Object.assign({}, src);
    var msg = String(errMsg || '').toLowerCase();
    var mentionsDoctor = msg.indexOf('doctor_id') >= 0 ||
        msg.indexOf('doctor_name') >= 0 ||
        msg.indexOf('doctor_tag') >= 0;
    var mentionsClinic = msg.indexOf('clinic_id') >= 0 ||
        msg.indexOf('clinic_tag') >= 0;
    var touched = false;

    if (mentionsDoctor) {
        if (Object.prototype.hasOwnProperty.call(out, 'doctor_id')) { delete out.doctor_id; touched = true; }
        if (Object.prototype.hasOwnProperty.call(out, 'doctor_name')) { delete out.doctor_name; touched = true; }
        if (Object.prototype.hasOwnProperty.call(out, 'doctor_tag')) { delete out.doctor_tag; touched = true; }
    }
    if (mentionsClinic) {
        if (Object.prototype.hasOwnProperty.call(out, 'clinic_id')) { delete out.clinic_id; touched = true; }
        if (Object.prototype.hasOwnProperty.call(out, 'clinic_tag')) { delete out.clinic_tag; touched = true; }
    }

    return { payload: out, changed: touched };
}

function persistBillRecord(payload, existingBillId, cb) {
    function attemptInsertOrUpdate(body, billId, depth) {
        var query = billId
            ? SB.from('bills').update(body).eq('id', billId).select()
            : SB.from('bills').insert([body]).select();
        query.then(function (r) {
            if (!r.error) {
                var row = (r.data && r.data[0]) ? r.data[0] : null;
                if (!row && billId) row = { id: billId };
                cb(null, row);
                return;
            }
            if (depth >= 2) {
                cb(r.error, null);
                return;
            }
            var stripped = stripOptionalBillColsByError(body, r.error.message);
            if (!stripped.changed) {
                cb(r.error, null);
                return;
            }
            attemptInsertOrUpdate(stripped.payload, billId, depth + 1);
        }).catch(function (e) {
            cb(e, null);
        });
    }
    attemptInsertOrUpdate(payload, existingBillId || null, 0);
}

function pendingListSubtotalFromItems(items) {
    return (items || []).reduce(function (a, it) {
        return a + billItemAmt(normalizeBillItem(it));
    }, 0);
}

function pendingListBillLinkNote(pl) {
    if (!pl || !pl.id) return null;
    return PENDING_LIST_BILL_NOTE_PREFIX + pl.id;
}

function pendingBillIdLocalStoreKey(pl) {
    if (!billPatId || !pl) return '';
    return String(billPatId) + ':' + String(pl.id || pl.label || pendingIdx);
}

function readPendingBillIdFromLocalStore(pl) {
    var slot = pendingBillIdLocalStoreKey(pl);
    if (!slot) return null;
    try {
        var map = JSON.parse(localStorage.getItem(PENDING_BILL_ID_LS_KEY) || '{}');
        return map[slot] || null;
    } catch (_) {
        return null;
    }
}

function writePendingBillIdToLocalStore(pl, billId) {
    var slot = pendingBillIdLocalStoreKey(pl);
    if (!slot || !billId) return;
    try {
        var map = JSON.parse(localStorage.getItem(PENDING_BILL_ID_LS_KEY) || '{}');
        map[slot] = billId;
        localStorage.setItem(PENDING_BILL_ID_LS_KEY, JSON.stringify(map));
    } catch (_) { /* ignore */ }
}

function clearPendingBillIdLocalStore(pl) {
    var slot = pendingBillIdLocalStoreKey(pl);
    if (!slot) return;
    try {
        var map = JSON.parse(localStorage.getItem(PENDING_BILL_ID_LS_KEY) || '{}');
        if (Object.prototype.hasOwnProperty.call(map, slot)) {
            delete map[slot];
            localStorage.setItem(PENDING_BILL_ID_LS_KEY, JSON.stringify(map));
        }
    } catch (_) { /* ignore */ }
}

function fetchBillRowForPendingList(billId, cb) {
    if (!billId) {
        if (cb) cb(null);
        return;
    }
    SB.from('bills')
        .select('id,amount_paid,balance,total,bill_type,voided_at,notes')
        .eq('id', billId)
        .single()
        .then(function (r) {
            var row = (!r.error && r.data) ? r.data : null;
            if (row && row.voided_at) row = null;
            if (cb) cb(row);
        })
        .catch(function () {
            if (cb) cb(null);
        });
}

/** Resolve the single unpaid bill tied to this pending list (replace, never duplicate). */
function findBillRowForPendingList(pl, cb) {
    if (!pl) {
        if (cb) cb(null);
        return;
    }

    function finish(row) {
        if (row && row.id) {
            pl.bill_id = row.id;
            writePendingBillIdToLocalStore(pl, row.id);
        }
        if (cb) cb(row);
    }

    function tryNotesMarker(next) {
        var note = pendingListBillLinkNote(pl);
        if (!note || !billPatId) {
            next();
            return;
        }
        SB.from('bills')
            .select('id,amount_paid,balance,total,bill_type,voided_at,notes')
            .eq('patient_id', billPatId)
            .eq('notes', note)
            .is('voided_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .then(function (r) {
                var row = (r.data && r.data[0]) ? r.data[0] : null;
                if (row) finish(row);
                else next();
            })
            .catch(next);
    }

    function tryPendingRow(next) {
        if (!pl.id) {
            next();
            return;
        }
        SB.from('pending_bill_items')
            .select('bill_id')
            .eq('id', pl.id)
            .single()
            .then(function (r) {
                var bid = (!r.error && r.data) ? r.data.bill_id : null;
                if (!bid) {
                    next();
                    return;
                }
                fetchBillRowForPendingList(bid, function (row) {
                    if (row) finish(row);
                    else next();
                });
            })
            .catch(next);
    }

    function tryLocalStore(next) {
        var bid = readPendingBillIdFromLocalStore(pl);
        if (!bid) {
            next();
            return;
        }
        fetchBillRowForPendingList(bid, function (row) {
            if (row) finish(row);
            else next();
        });
    }

    /** Same patient + same bill date → reuse only when list has no stable id yet. */
    function trySameDayPatientBill(next) {
        if (pl.id) {
            next();
            return;
        }
        var billDate = todayISO();
        var hasPatId = !!billPatId;
        var hasPatNo = !!(billPatNo && billPatNo !== '-');
        if (!hasPatId && !hasPatNo) {
            next();
            return;
        }

        function queryByPatientNo() {
            if (!hasPatNo) {
                next();
                return;
            }
            SB.from('bills')
                .select('id,amount_paid,balance,total,bill_type,voided_at,notes')
                .eq('patient_no', billPatNo)
                .eq('bill_date', billDate)
                .is('voided_at', null)
                .order('created_at', { ascending: false })
                .limit(1)
                .then(function (r) {
                    var row = (r.data && r.data[0]) ? r.data[0] : null;
                    if (row) finish(row);
                    else next();
                })
                .catch(next);
        }

        if (hasPatId) {
            SB.from('bills')
                .select('id,amount_paid,balance,total,bill_type,voided_at,notes')
                .eq('patient_id', billPatId)
                .eq('bill_date', billDate)
                .is('voided_at', null)
                .order('created_at', { ascending: false })
                .limit(1)
                .then(function (r) {
                    var row = (r.data && r.data[0]) ? r.data[0] : null;
                    if (row) finish(row);
                    else queryByPatientNo();
                })
                .catch(function () {
                    queryByPatientNo();
                });
            return;
        }
        queryByPatientNo();
    }

    function tryMemoryLink(next) {
        if (!pl.bill_id) {
            next();
            return;
        }
        fetchBillRowForPendingList(pl.bill_id, function (row) {
            if (row) finish(row);
            else {
                pl.bill_id = null;
                next();
            }
        });
    }

    tryMemoryLink(function () {
        tryPendingRow(function () {
            tryNotesMarker(function () {
                tryLocalStore(function () {
                    trySameDayPatientBill(function () {
                        finish(null);
                    });
                });
            });
        });
    });
}

function buildUnpaidBillPayloadFromPendingList(pl, sub) {
    var payload = {
        appointment_id: billApptId,
        patient_id:     billPatId,
        patient_name:   billPatName,
        patient_no:     billPatNo,
        bill_date:      todayISO(),
        bill_type:      billPendingPayTypeValue(),
        items:          JSON.stringify(billItemsForBillSave(pl.items)),
        subtotal:       sub,
        discount:       0,
        total:          sub,
        amount_paid:    0,
        balance:        sub,
        notes:          pendingListBillLinkNote(pl),
        status:         sub > 0.005 ? 'Partial' : 'Paid'
    };
    Object.assign(payload, billClinicFieldsForSave());
    Object.assign(payload, billDoctorFieldsForSave(pl.doctor_id || null, { noFallback: true }));
    return payload;
}

function persistPendingListBillIdRow(pl, billId, cb) {
    if (!pl || !billId) {
        if (cb) cb(true);
        return;
    }
    pl.bill_id = billId;
    writePendingBillIdToLocalStore(pl, billId);
    if (!pl.id) {
        if (cb) cb(true);
        return;
    }
    SB.from('pending_bill_items').update({ bill_id: billId }).eq('id', pl.id)
        .then(function () { if (cb) cb(true); })
        .catch(function () { if (cb) cb(true); });
}

function syncUnpaidBillFromPendingList(pl, sub, done) {
    if (!pl || sub <= 0.005) {
        if (done) done(null, null);
        return;
    }

    function applyBillSave(existingBill) {
        var paidSoFar = existingBill ? (parseFloat(existingBill.amount_paid) || 0) : 0;
        var payload = buildUnpaidBillPayloadFromPendingList(pl, sub);
        payload.amount_paid = paidSoFar;
        payload.balance = Math.max(0, sub - paidSoFar);
        if (paidSoFar > 0.005 && existingBill && existingBill.bill_type) {
            payload.bill_type = existingBill.bill_type;
        }
        payload.status = payload.balance <= 0.005 ? 'Paid' : 'Partial';
        var existingUserNotes = billUserNotesText(existingBill && existingBill.notes);
        if (existingUserNotes) {
            payload.notes = existingUserNotes;
        } else if (pl.id) {
            payload.notes = pendingListBillLinkNote(pl);
        }
        var billId = pl.bill_id || (existingBill && existingBill.id) || null;

        persistBillRecord(payload, billId, function (err, saved) {
            if (err) {
                if (done) done(err, null);
                return;
            }
            var newId = (saved && saved.id) ? saved.id : billId;
            var afterLinked = function () {
                if (billApptId) {
                    SB.from('appointments')
                        .update({ bill_status: payload.balance <= 0.005 ? 'Paid' : 'Billed' })
                        .eq('id', billApptId)
                        .then(function () { if (done) done(null, saved); })
                        .catch(function () { if (done) done(null, saved); });
                    return;
                }
                if (done) done(null, saved);
            };
            if (newId) {
                persistPendingListBillIdRow(pl, newId, afterLinked);
            } else {
                afterLinked();
            }
        });
    }

    findBillRowForPendingList(pl, applyBillSave);
}

function deleteUnpaidBillForPendingList(pl, cb) {
    if (!pl || !pl.bill_id) {
        if (cb) cb(true);
        return;
    }
    SB.from('bills').select('amount_paid,balance,total,voided_at').eq('id', pl.bill_id).single()
        .then(function (r) {
            var b = (!r.error && r.data) ? r.data : null;
            if (!b || b.voided_at) {
                if (cb) cb(true);
                return;
            }
            var paid = parseFloat(b.amount_paid) || 0;
            if (paid > 0.005) {
                if (cb) cb(true);
                return;
            }
            SB.from('bills').delete().eq('id', pl.bill_id).then(function () {
                clearPendingBillIdLocalStore(pl);
                if (cb) cb(true);
            }).catch(function () {
                if (cb) cb(true);
            });
        })
        .catch(function () {
            if (cb) cb(true);
        });
}

function pendingListByPayId(payId) {
    if (!payId || !pendingLists.length) return null;
    for (var i = 0; i < pendingLists.length; i++) {
        if (pendingLists[i] && pendingLists[i].id === payId) return pendingLists[i];
    }
    return null;
}

function tr(key) {
    return typeof t === 'function' ? t(key) : key;
}

function trRepl(key, pairs) {
    var s = tr(key);
    if (!pairs) return s;
    for (var k in pairs) {
        if (Object.prototype.hasOwnProperty.call(pairs, k)) {
            s = s.split('{' + k + '}').join(String(pairs[k]));
        }
    }
    return s;
}

function apptToast(msg) {
    var text = String(msg || '').trim();
    if (!text) return;
    if (typeof showAppGlobalToast === 'function') {
        showAppGlobalToast(text);
        return;
    }
}

function apptDurationScaleMinutesList() {
    var out = [];
    var m;
    for (m = 0; m <= 240; m += 15) out.push(m);
    return out;
}

/** Duration dropdown label: 0–45 → "N MIN"; whole hours → "N HRS"; else "HH:MM". */
function apptDurationScaleLabel(minutes) {
    var m = parseInt(minutes, 10);
    if (isNaN(m) || m < 0) return '—';
    if (m <= 45) return String(m) + ' MIN';
    if (m % 60 === 0) return String(m / 60) + ' HRS';
    var h = Math.floor(m / 60);
    var min = m % 60;
    return (h < 10 ? '0' : '') + String(h) + ':' + (min < 10 ? '0' : '') + String(min);
}

function apptDurationDisplay(minutes) {
    return apptDurationScaleLabel(minutes);
}

function populateApptDurSelect() {
    var sel = g('fDur');
    if (!sel) return;
    var prev = sel.value;
    var mins = apptDurationScaleMinutesList();
    var prevN = parseInt(prev, 10);
    if (!isNaN(prevN) && mins.indexOf(prevN) < 0) {
        mins = mins.concat([prevN]).sort(function (a, b) { return a - b; });
    }
    sel.innerHTML = mins.map(function (m) {
        return '<option value="' + m + '">' + apptDurationScaleLabel(m) + '</option>';
    }).join('');
    if (prev && Array.prototype.some.call(sel.options, function (o) { return o.value === prev; })) {
        sel.value = prev;
    } else if (Array.prototype.some.call(sel.options, function (o) { return o.value === '30'; })) {
        sel.value = '30';
    } else if (sel.options.length) {
        sel.selectedIndex = 0;
    }
}

function ensureApptDurSelectValue(minutes) {
    var sel = g('fDur');
    if (!sel) return;
    var m = parseInt(minutes, 10);
    if (isNaN(m)) return;
    var str = String(m);
    var found = Array.prototype.some.call(sel.options, function (o) { return o.value === str; });
    if (!found) {
        var opt = document.createElement('option');
        opt.value = str;
        opt.textContent = apptDurationScaleLabel(m);
        sel.appendChild(opt);
    }
    sel.value = str;
}

function refreshApptDurOptions() {
    populateApptDurSelect();
}

function refreshApptModalTitle() {
    var titleEl = g('apptModalTitle');
    if (!titleEl) return;
    if (apptEditId) {
        titleEl.textContent = tr('appt.modal.editAppt');
    } else if (arBookingMinDateToday) {
        titleEl.textContent = tr('appt.modal.newApptSame');
    } else {
        titleEl.textContent = tr('appt.modal.newAppt');
    }
}

function refreshApptModalI18n() {
    var modal = g('apptModal');
    if (!modal) return;
    if (typeof applyI18nInRoot === 'function') applyI18nInRoot(modal);
    refreshApptModalTitle();
    if (apptEditId && typeof setApptScheduleLockFormUI === 'function') {
        setApptScheduleLockFormUI(!!apptEditScheduleLocked);
    }
    refreshApptDurOptions();
    var drSel = g('fApptDoctor');
    if (drSel && typeof loadApptDoctors === 'function') {
        loadApptDoctors(drSel.value || '');
    } else if (drSel && drSel.options.length) {
        drSel.options[0].textContent = tr('appt.modal.selectDoctor');
        if (drSel.options.length > 1) {
            var lastDr = drSel.options[drSel.options.length - 1];
            if (lastDr && lastDr.disabled && !lastDr.value) {
                lastDr.textContent = tr('appt.modal.noDoctorsForClinic');
            }
        }
    }
    if (typeof renderApptDoctorColorPreview === 'function') renderApptDoctorColorPreview();
    if (typeof populatePlusApptDoctorSelect === 'function') populatePlusApptDoctorSelect();
}

function apptDateLocale() {
    if (typeof appUiLocale === 'function') return appUiLocale();
    if (typeof appUiLang === 'string' && appUiLang.indexOf('Hant') >= 0) return 'zh-HK';
    if (typeof appUiLang === 'string' && appUiLang.indexOf('CN') >= 0) return 'zh-CN';
    return 'en-HK';
}

function apptCalWeekdayHeaders() {
    var loc = apptDateLocale();
    var out = [];
    var i;
    for (i = 0; i < 7; i++) {
        out.push(new Date(2024, 0, 7 + i).toLocaleDateString(loc, { weekday: 'short' }));
    }
    return out;
}
var pendingIdx   = -1;   // which list is open in Step 1
var payItems     = [];   // items from the list selected in Step 2
var payPendingId = null; // DB id of the list selected for payment
var pendingServerSnapshotById = {};
/** Prevents overlapping Save List → duplicate unpaid bills. */
var _pendingListSaveBusyKey = null;
var PENDING_LIST_BILL_NOTE_PREFIX = 'JSM_PENDING:';
var PENDING_BILL_ID_LS_KEY = 'jsm_pending_bill_ids_v1';

function billIsPendingLinkNote(raw) {
    return String(raw || '').trim().indexOf(PENDING_LIST_BILL_NOTE_PREFIX) === 0;
}

/** Step 2 payment notes — excludes internal pending-list link marker stored in bills.notes. */
function billUserNotesText(raw) {
    var s = String(raw || '').trim();
    if (!s || billIsPendingLinkNote(s)) return '';
    return s;
}

function loadBillStep2NotesFromLinkedBill(pl) {
    var el = g('bNotes');
    if (!el) return;
    if (!pl || !pl.bill_id) {
        el.value = '';
        return;
    }
    fetchBillRowForPendingList(pl.bill_id, function(row) {
        if (g('bNotes')) g('bNotes').value = billUserNotesText(row && row.notes) || '';
    });
}

function receiptBillWithSavedNotes(payload, savedBill) {
    var bill = savedBill ? Object.assign({}, payload, savedBill) : Object.assign({}, payload);
    var notes = String(payload && payload.notes ? payload.notes : '').trim();
    if (!notes) notes = billUserNotesText(bill.notes);
    bill.notes = notes || null;
    return bill;
}

// ════════════════════════════════════════════════════════════════
// CLINIC SCOPE (all appointment subtabs share one clinic)
// ════════════════════════════════════════════════════════════════
function applyApptModuleClinicQuery(builder) {
    if (!builder) return builder;
    var tag = typeof currentClinicCodeForTagging === 'function'
        ? currentClinicCodeForTagging()
        : '';
    if (!tag) return builder;
    var field = typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined'
        ? APPOINTMENT_CLINIC_TAG_FIELD
        : 'clinic_tag';
    return builder.eq(field, tag);
}

/** + Appointment day planner: strict clinic scope (no cross-clinic bleed). */
function plusApptClinicTagForScope() {
    var tag = '';
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    if (cid && typeof clinicRecordFromId === 'function') {
        var rec = clinicRecordFromId(cid);
        if (rec) tag = String(rec.clinic_code || '').trim();
    }
    if (!tag && typeof currentClinicCodeForTagging === 'function') {
        tag = currentClinicCodeForTagging();
    }
    return tag;
}

function applyPlusApptClinicQuery(builder) {
    if (!builder) return builder;
    var tag = plusApptClinicTagForScope();
    if (!tag) return builder;
    var field = typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined'
        ? APPOINTMENT_CLINIC_TAG_FIELD
        : 'clinic_tag';
    // Include legacy rows saved without clinic_tag so new bookings still appear after refresh.
    return builder.or(field + '.eq.' + tag + ',' + field + '.is.null');
}

function apptUnpaidPatientId(a) {
    return a && a.patient_id ? String(a.patient_id).trim() : '';
}

function apptUnpaidPatientNo(a) {
    return a && a.patient_no ? String(a.patient_no).trim().toUpperCase() : '';
}

function apptUnpaidAmountForAppt(a) {
    var pid = apptUnpaidPatientId(a);
    var pno = apptUnpaidPatientNo(a);
    var byId = pid ? (parseFloat(apptUnpaidByPatientId[pid]) || 0) : 0;
    var byNo = pno ? (parseFloat(apptUnpaidByPatientNo[pno]) || 0) : 0;
    return Math.max(byId, byNo);
}

function apptUnpaidBadgeHtml(a, extraClass) {
    var bal = apptUnpaidAmountForAppt(a);
    if (!(bal > 0)) return '';
    var cls = 'appt-unpaid-badge';
    if (extraClass) cls += ' ' + extraClass;
    var aid = a && a.id ? String(a.id) : '';
    var pid = a && a.patient_id ? String(a.patient_id) : '';
    var pno = a && a.patient_no ? String(a.patient_no) : '';
    var pnm = a && a.patient_name ? String(a.patient_name) : '';
    return '<span class="' + cls + '"' +
        ' data-open-bill="1"' +
        ' data-appt-id="' + esc(aid) + '"' +
        ' data-patient-id="' + esc(pid) + '"' +
        ' data-patient-no="' + esc(pno) + '"' +
        ' data-patient-name="' + esc(pnm) + '"' +
        ' title="' + esc(tr('bill.queue.openBill')) + '">' + esc(fmtHK(bal)) + '</span>';
}

function bindApptUnpaidBadgeClickOnce() {
    if (apptUnpaidBadgeClickBound) return;
    apptUnpaidBadgeClickBound = true;
    document.addEventListener('click', function(ev) {
        var target = ev.target;
        var badge = target && target.closest ? target.closest('.appt-unpaid-badge[data-open-bill="1"]') : null;
        if (!badge) return;
        ev.preventDefault();
        ev.stopPropagation();
        var q = {
            id: badge.getAttribute('data-appt-id') || null,
            patient_id: badge.getAttribute('data-patient-id') || null,
            patient_no: badge.getAttribute('data-patient-no') || '',
            patient_name: badge.getAttribute('data-patient-name') || ''
        };
        if (typeof openBillPanel === 'function') openBillPanel(q);
    }, true);
}

function hydrateApptUnpaidBalances(appts, done) {
    var list = appts || [];
    var pids = [];
    var pnos = [];
    var seen = {};
    var seenNo = {};
    list.forEach(function(a) {
        var pid = apptUnpaidPatientId(a);
        if (!pid || seen[pid]) return;
        seen[pid] = true;
        pids.push(pid);
    });
    list.forEach(function(a) {
        var pno = apptUnpaidPatientNo(a);
        if (!pno || seenNo[pno]) return;
        seenNo[pno] = true;
        pnos.push(pno);
    });
    if ((!pids.length && !pnos.length) || !SB || typeof SB.from !== 'function') {
        if (done) done(false);
        return;
    }

    function billsQueryBase() {
        return SB.from('bills').select('id,patient_id,patient_no,balance,voided_at').gt('balance', 0);
    }

    var qs = [];
    if (pids.length) qs.push(billsQueryBase().in('patient_id', pids));
    if (pnos.length) qs.push(billsQueryBase().in('patient_no', pnos));

    Promise.all(qs).then(function(results) {
        var merged = [];
        var seenBill = {};
        results.forEach(function(r) {
            if (!r || r.error || !r.data) return;
            r.data.forEach(function(b) {
                var id = String(b.id || '').trim();
                if (id && seenBill[id]) return;
                if (id) seenBill[id] = true;
                merged.push(b);
            });
        });

        var sums = {};
        var sumsNo = {};
        pids.forEach(function(pid) { sums[pid] = 0; });
        pnos.forEach(function(pno) { sumsNo[pno] = 0; });
        merged.forEach(function(b) {
            if (!b || b.voided_at) return;
            var pid = String(b.patient_id || '').trim();
            var pno = String(b.patient_no || '').trim().toUpperCase();
            var bal = parseFloat(b.balance) || 0;
            if (pid) sums[pid] = (sums[pid] || 0) + bal;
            if (pno) sumsNo[pno] = (sumsNo[pno] || 0) + bal;
        });
        var changed = false;
        pids.forEach(function(pid) {
            var v = Math.round((sums[pid] || 0) * 100) / 100;
            var old = Math.round((parseFloat(apptUnpaidByPatientId[pid]) || 0) * 100) / 100;
            if (v !== old) changed = true;
            apptUnpaidByPatientId[pid] = v;
        });
        pnos.forEach(function(pno) {
            var v = Math.round((sumsNo[pno] || 0) * 100) / 100;
            var old = Math.round((parseFloat(apptUnpaidByPatientNo[pno]) || 0) * 100) / 100;
            if (v !== old) changed = true;
            apptUnpaidByPatientNo[pno] = v;
        });
        if (done) done(changed);
    }).catch(function() {
        if (done) done(false);
    });
}

function populateApptClinicSelect() {
    var sel = g('apptClinicSelect');
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '';
    if (!APP_CLINICS || !APP_CLINICS.length) {
        sel.innerHTML = '<option value="">' + esc(tr('common.noClinics')) + '</option>';
        return;
    }
    var clinicOpts = (typeof clinicsForWorkingSession === 'function')
        ? clinicsForWorkingSession()
        : (APP_CLINICS || []);
    clinicOpts.forEach(function(c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = (typeof clinicDisplayName === 'function')
            ? clinicDisplayName(c)
            : (c.english_name || c.chinese_name || clinicDisplayFallback());
        sel.appendChild(o);
    });
    var def = typeof defaultWorkingClinicId === 'function'
        ? defaultWorkingClinicId()
        : (clinicOpts[0] ? clinicOpts[0].id : '');
    var has = false;
    for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === prev) { has = true; break; }
    }
    sel.value = has ? prev : def;
}

/** Keep + Appointment day and Calendar view on the same date/clinic data. */
function syncApptPlannerDate(iso, opts) {
    opts = opts || {};
    var isoStr = String(iso || '').trim();
    if (!isoStr) isoStr = todayISO();
    plusApptDate = isoStr;
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    if (cid) {
        var st = plusApptClinicUiState[cid];
        if (st) st.date = isoStr;
    }
    var d = typeof parseISODateOnly === 'function' ? parseISODateOnly(isoStr) : null;
    if (d && !isNaN(d.getTime())) {
        plusApptMiniCalMonth = new Date(d.getFullYear(), d.getMonth(), 1);
        if (opts.syncCal !== false) {
            calDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        }
    }
    if (typeof plusApptSyncDateLabel === 'function') plusApptSyncDateLabel();
    if (typeof plusApptSyncTimelineHead === 'function') plusApptSyncTimelineHead();
    if (typeof apptSectionIsActive === 'function' && apptSectionIsActive() &&
        typeof apptMemoOnScopeChange === 'function') {
        apptMemoOnScopeChange();
    }
}

/** Reload day planner (+ Appointment) and calendar from Supabase (same clinic scope). */
function refreshApptPlannerData(opts) {
    opts = opts || {};
    if (!opts.force && !apptSectionIsActive()) return;
    if (!plusApptDate) plusApptDate = todayISO();
    var tab = typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : null;
    if ((tab === 'plusappt' || opts.forcePlusAppt) && typeof loadPlusApptDay === 'function') {
        loadPlusApptDay({ force: !!opts.force });
    }
    if (tab === 'calendar' && typeof renderCal === 'function') {
        renderCal();
    } else if (!tab && typeof renderCal === 'function') {
        renderCal();
    }
}

/**
 * Refresh + Appointment timeline after create/edit (clinic/doctor scope + row highlight).
 */
function plusApptNotifyAppointmentSaved(meta) {
    meta = meta || {};
    if (meta.date && typeof syncApptPlannerDate === 'function') {
        syncApptPlannerDate(meta.date, { syncCal: true });
    }
    var cid = (typeof currentClinicId !== 'undefined' ? currentClinicId : '') ||
        plusApptActiveClinicId;
    if (cid) {
        var plusSel = g('plusApptClinicSelect');
        if (plusSel && plusSel.value !== cid) {
            plusApptClinicSyncing = true;
            plusSel.value = cid;
            plusApptClinicSyncing = false;
        }
        var apptSel = g('apptClinicSelect');
        if (apptSel && apptSel.value !== cid) {
            plusApptClinicSyncing = true;
            apptSel.value = cid;
            plusApptClinicSyncing = false;
        }
        plusApptActiveClinicId = cid;
    }
    if (meta.doctorCode) {
        var drSel = g('plusApptDoctorSelect');
        var drCode = String(meta.doctorCode).trim();
        if (drSel && drCode) {
            var hasOpt = false;
            for (var oi = 0; oi < drSel.options.length; oi++) {
                if (drSel.options[oi].value === drCode) {
                    hasOpt = true;
                    break;
                }
            }
            if (hasOpt && drSel.value !== PLUSAPPT_DOCTOR_ALL) {
                drSel.value = drCode;
                plusApptActiveDoctorCode = drCode;
            } else if (plusApptIsAllDoctorsMode()) {
                plusApptAllActiveDoctorCode = drCode;
            }
        }
    }
    if (meta.apptId) plusApptPendingSelectApptId = String(meta.apptId);
    if (meta.savedRow && typeof plusApptMergeSavedRow === 'function') {
        plusApptMergeSavedRow(meta.savedRow);
    }
    var onPlusAppt = typeof apptActiveTabKey === 'function' && apptActiveTabKey() === 'plusappt';
    if (onPlusAppt && typeof loadPlusApptDay === 'function' && !meta.savedRow) {
        loadPlusApptDay();
    } else if (!onPlusAppt && typeof refreshApptPlannerData === 'function') {
        refreshApptPlannerData({ forcePlusAppt: true });
    }
}

function plusApptMergeSavedRow(row) {
    if (!row || !row.id) return;
    var d = String(row.date || '').slice(0, 10);
    if (d && plusApptDate && d !== plusApptDate && typeof syncApptPlannerDate === 'function') {
        syncApptPlannerDate(d, { syncCal: false });
    }
    var id = String(row.id);
    var idx = -1;
    for (var i = 0; i < plusApptDayAppts.length; i++) {
        if (plusApptDayAppts[i] && String(plusApptDayAppts[i].id) === id) {
            idx = i;
            break;
        }
    }
    if (idx >= 0) plusApptDayAppts[idx] = Object.assign({}, plusApptDayAppts[idx], row);
    else plusApptDayAppts.push(row);
    plusApptDayAppts.sort(function(a, b) {
        return String(a.start_time || '').localeCompare(String(b.start_time || ''));
    });
    plusApptApplyTaskStateToList(plusApptDayAppts);
    if (typeof apptActiveTabKey === 'function' && apptActiveTabKey() === 'plusappt') {
        renderPlusApptSchedule(true);
        if (plusApptPendingSelectApptId) {
            var hit = plusApptFindApptById(plusApptPendingSelectApptId);
            if (hit) plusApptSelectApptRow(hit, true);
        }
    }
}

function plusApptReconcilePendingRowIntoList(rows) {
    rows = rows ? rows.slice() : [];
    var pendingId = plusApptPendingSelectApptId ? String(plusApptPendingSelectApptId) : '';
    if (!pendingId) return rows;
    var local = plusApptFindApptById(pendingId);
    var idx = -1;
    for (var i = 0; i < rows.length; i++) {
        if (rows[i] && String(rows[i].id) === pendingId) {
            idx = i;
            break;
        }
    }
    if (idx >= 0) {
        if (local) rows[idx] = Object.assign({}, rows[idx], local);
        return rows;
    }
    if (local) {
        rows.push(local);
        rows.sort(function(a, b) {
            return String(a.start_time || '').localeCompare(String(b.start_time || ''));
        });
    }
    return rows;
}

function plusApptFinishDayLoadSelection() {
    if (plusApptPendingSelectApptId) {
        var picked = plusApptFindApptById(plusApptPendingSelectApptId);
        plusApptPendingSelectApptId = null;
        if (picked) {
            plusApptSelectApptRow(picked, true);
            plusApptSaveUiState();
            return;
        }
    }
    plusApptRestoreDoctorSelection();
}

function reloadApptModuleData() {
    if (!apptSectionIsActive()) return;
    var tab = apptActiveTabKey();
    if (tab === 'queue') loadQueue();
    else if (tab === 'today') loadToday();
    else if (tab === 'plusappt' || tab === 'calendar') refreshApptPlannerData();
    else if (tab === 'records') loadApptRecords();
    else if (tab === 'recall') {
        if (typeof rcDate !== 'undefined' && rcDate) loadRecallPatients(rcDate);
        else initRecallTab();
    }
}

function onApptClinicChange() {
    var sel = g('apptClinicSelect');
    if (!sel || !sel.value) return;
    if (typeof setWorkingClinic === 'function') {
        setWorkingClinic(sel.value, { syncFilters: true, reloadAppt: false });
    }
    var plusSel = g('plusApptClinicSelect');
    if (plusSel && plusSel.value !== sel.value) {
        plusApptClinicSyncing = true;
        plusSel.value = sel.value;
        plusApptActiveClinicId = sel.value;
        plusApptClinicSyncing = false;
    }
    if (typeof apptMemoOnScopeChange === 'function') apptMemoOnScopeChange();
    if (apptActiveTabKey() === 'plusappt' && typeof onPlusApptClinicChange === 'function') {
        onPlusApptClinicChange();
        return;
    }
    reloadApptModuleData();
}

function bindApptClinicSelectOnce() {
    var sel = g('apptClinicSelect');
    if (!sel || sel.dataset.bound) return;
    sel.dataset.bound = '1';
    sel.addEventListener('change', onApptClinicChange);
}

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
function initAppt() {
    var un = g('apptUserName');
    var ur = g('apptUserRole');
    var ud = g('apptTodayDate');
    refreshApptDurOptions();
    refreshApptHeaderI18n();
    populateApptClinicSelect();
    bindApptClinicSelectOnce();
    var apSel = g('apptClinicSelect');
    if (apSel && apSel.value && typeof setWorkingClinic === 'function') {
        setWorkingClinic(apSel.value, { syncFilters: true, reloadAppt: false });
    }
    var qb = g('queueBody');
    if (qb) bindQueueReorderHandlers(qb);
    if (typeof plusApptBindTransferDropZones === 'function') plusApptBindTransferDropZones();
    bindQueueRemarksModalOnce();
    bindQueueRefreshBtnOnce();
    bindQueueClearModeBtnOnce();
    bindTodayClearModeBtnOnce();
    queueBindCompactFitOnce();
    bindQueueSettingsBtnOnce();
    bindTodaySettingsBtnOnce();
    initApptRemarksRichEditors();
    bindPlusApptTabOnce();
    bindApptSharedMemoOnce();
    refreshApptSharedMemoI18n();
    apptModuleBindEditPauseOnce();
    switchApptTab('queue');
    if (typeof startApptAutoRefresh === 'function') startApptAutoRefresh();
}

function queueRefreshTimeText(ts) {
    if (!ts) return tr('appt.queue.updatedNever');
    var d = new Date(ts);
    var t = d.toLocaleTimeString(apptDateLocale(), { hour: '2-digit', minute: '2-digit' });
    return trRepl('appt.queue.updatedAt', { T: t });
}

function setQueueRefreshBusy(busy) {
    var btn = g('queueRefreshBtn');
    if (!btn) return;
    btn.disabled = !!busy;
}

function setQueueRefreshMeta(opts) {
    opts = opts || {};
    if (opts.loading) {
        setQueueRefreshBusy(true);
        var metaLoading = g('queueUpdatedAt');
        if (metaLoading) metaLoading.textContent = tr('common.loadingEllipsis');
        return;
    }
    setQueueRefreshBusy(false);
    if (opts.stampNow) queueLastRefreshAt = Date.now();
    var meta = g('queueUpdatedAt');
    if (meta) meta.textContent = queueRefreshTimeText(queueLastRefreshAt);
}

function bindQueueRefreshBtnOnce() {
    if (queueRefreshBtnBound) return;
    var btn = g('queueRefreshBtn');
    if (!btn) return;
    queueRefreshBtnBound = true;
    btn.addEventListener('click', function() {
        loadQueue();
    });
    setQueueRefreshMeta({ stampNow: false });
}

function bindQueueClearModeBtnOnce() {
    if (queueClearModeBtnBound) return;
    var btn = g('queueClearModeBtn');
    if (!btn) return;
    queueClearModeBtnBound = true;
    btn.addEventListener('click', plusApptToggleClearMode);
}

function bindTodayClearModeBtnOnce() {
    if (todayClearModeBtnBound) return;
    var btn = g('todayClearModeBtn');
    if (!btn) return;
    todayClearModeBtnBound = true;
    btn.addEventListener('click', plusApptToggleClearMode);
}

function queueBindCompactFitOnce() {
    if (queueCompactFitBound) return;
    queueCompactFitBound = true;
    window.addEventListener('resize', queueScheduleCompactFit);
}

function queueScheduleCompactFit() {
    if (queueCompactFitTimer) clearTimeout(queueCompactFitTimer);
    queueCompactFitTimer = setTimeout(function() {
        queueCompactFitTimer = null;
        queueApplyCompactFitScale();
    }, 80);
}

/** Scale queue compact table to fit available width (clear mode only). */
function queueApplyCompactFitScale() {
    var tab = g('tab-queue');
    var wrap = tab && tab.querySelector('.queue-wrap');
    if (!wrap) return;
    if (!plusApptIsClearMode()) {
        wrap.style.removeProperty('--queue-fit-scale');
        return;
    }
    var avail = wrap.clientWidth;
    if (avail <= 0) {
        queueScheduleCompactFit();
        return;
    }
    var scale = 1;
    if (avail < 1280) scale = 0.96;
    if (avail < 1120) scale = 0.9;
    if (avail < 960) scale = 0.84;
    if (avail < 820) scale = 0.78;
    if (avail < 700) scale = 0.72;
    if (avail < 600) scale = 0.66;
    wrap.style.setProperty('--queue-fit-scale', String(scale));
}

// ════════════════════════════════════════════════════════════════
// SHARED MEMO — per clinic + date (appointment_daily_memos table)
// ════════════════════════════════════════════════════════════════
var APPT_MEMO_TABLE = 'appointment_daily_memos';
var APPT_SHARED_MEMO_TABS = { queue: 1, today: 1, plusappt: 1, calendar: 1 };
var APPT_MEMO_HOST_IDS = {
    queue: 'apptMemoHost-queue',
    today: 'apptMemoHost-today',
    plusappt: 'apptMemoHost-plusappt',
    calendar: 'apptMemoHost-calendar'
};
var _apptMemoSaveTimer = null;
var _apptMemoHydrating = false;
var _apptMemoLastSaved = null;
var _apptMemoScopeKey = null;
var _apptMemoLoadedScopeKey = null;
var _apptMemoScopeBusy = false;

function apptMemoClinicId() {
    var sel = g('apptClinicSelect');
    if (sel && sel.value) return String(sel.value);
    var plusSel = g('plusApptClinicSelect');
    if (plusSel && plusSel.value) return String(plusSel.value);
    if (typeof plusApptActiveClinicId !== 'undefined' && plusApptActiveClinicId) {
        return String(plusApptActiveClinicId);
    }
    if (typeof currentClinicId !== 'undefined' && currentClinicId) {
        return String(currentClinicId);
    }
    return '';
}

function apptMemoDateIso(tab) {
    tab = tab || (typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : 'queue');
    if (tab === 'plusappt') {
        return plusApptDate || (typeof todayISO === 'function' ? todayISO() : '');
    }
    if (tab === 'calendar') {
        if (typeof calDate !== 'undefined' && calDate && typeof d2iso === 'function') {
            return d2iso(calDate);
        }
        if (plusApptDate) return plusApptDate;
        return typeof todayISO === 'function' ? todayISO() : '';
    }
    return typeof todayISO === 'function' ? todayISO() : '';
}

function apptMemoScopeKey(tab) {
    return apptMemoClinicId() + '|' + apptMemoDateIso(tab);
}

function apptMemoProgramKey(clinicId, dateIso) {
    return 'appt_daily_memo:' + clinicId + ':' + dateIso;
}

function apptMemoTableMissing(err) {
    var msg = String((err && err.message) || err || '');
    return /appointment_daily_memos|relation|does not exist|schema cache/i.test(msg);
}

function parseApptMemoScopeKey(key) {
    var parts = String(key || '').split('|');
    return { clinicId: parts[0] || '', dateIso: parts[1] || '' };
}

function updateApptSharedMemoDateLabel(tab) {
    var el = g('apptSharedMemoDateLbl');
    if (!el) return;
    var iso = apptMemoDateIso(tab);
    if (!iso) {
        el.textContent = '';
        return;
    }
    el.textContent = (typeof fmtDateLong === 'function')
        ? fmtDateLong(iso, { long: false })
        : iso;
}

function mountApptSharedMemo(tab) {
    var bar = g('apptSharedMemoBar');
    if (!bar) return;
    var host = null;
    if (tab && APPT_SHARED_MEMO_TABS[tab]) {
        var hostId = APPT_MEMO_HOST_IDS[tab];
        host = hostId ? g(hostId) : null;
    }
    if (!host) host = g('apptMemoBarPool');
    if (!host) return;
    host.appendChild(bar);
    var show = !!(tab && APPT_SHARED_MEMO_TABS[tab]);
    bar.hidden = !show;
    bar.setAttribute('aria-hidden', show ? 'false' : 'true');
    updateApptSharedMemoDateLabel(tab);
}

function applyApptSharedMemoToField(text, scopeKey) {
    var ta = g('apptSharedMemo');
    if (!ta) return;
    _apptMemoHydrating = true;
    ta.value = text == null ? '' : String(text);
    _apptMemoLastSaved = ta.value;
    _apptMemoLoadedScopeKey = scopeKey || apptMemoScopeKey();
    _apptMemoHydrating = false;
}

function fetchApptDailyMemo(clinicId, dateIso) {
    if (!clinicId || !dateIso) return Promise.resolve('');
    if (!SB || typeof SB.from !== 'function') return Promise.resolve('');
    return SB.from(APPT_MEMO_TABLE)
        .select('memo_text')
        .eq('clinic_id', clinicId)
        .eq('memo_date', dateIso)
        .limit(1)
        .then(function (r) {
            if (!r.error && r.data && r.data.length) {
                return r.data[0].memo_text || '';
            }
            if (r.error && apptMemoTableMissing(r.error)) {
                var pk = apptMemoProgramKey(clinicId, dateIso);
                if (typeof getProgramSetting === 'function') {
                    return getProgramSetting(pk, '');
                }
                return SB.from('program_settings')
                    .select('setting_value')
                    .eq('setting_key', pk)
                    .limit(1)
                    .then(function (pr) {
                        if (!pr.error && pr.data && pr.data.length) {
                            return pr.data[0].setting_value || '';
                        }
                        return '';
                    });
            }
            return '';
        })
        .catch(function () { return ''; });
}

function persistApptDailyMemo(clinicId, dateIso, text) {
    if (!clinicId || !dateIso) return Promise.resolve();
    if (!SB || typeof SB.from !== 'function') return Promise.resolve();
    var payload = {
        clinic_id: clinicId,
        memo_date: dateIso,
        memo_text: text
    };
    return SB.from(APPT_MEMO_TABLE)
        .select('id')
        .eq('clinic_id', clinicId)
        .eq('memo_date', dateIso)
        .limit(1)
        .then(function (sel) {
            if (sel.error && apptMemoTableMissing(sel.error)) {
                if (typeof persistProgramSettingRow !== 'function') return sel;
                return persistProgramSettingRow({
                    setting_key: apptMemoProgramKey(clinicId, dateIso),
                    setting_value: text
                });
            }
            if (sel.error) return sel;
            if (sel.data && sel.data.length) {
                return SB.from(APPT_MEMO_TABLE)
                    .update({ memo_text: text })
                    .eq('id', sel.data[0].id);
            }
            return SB.from(APPT_MEMO_TABLE).insert(payload);
        });
}

function loadApptSharedMemo(tab) {
    tab = tab || (typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : 'queue');
    var scopeKey = apptMemoScopeKey(tab);
    _apptMemoScopeKey = scopeKey;
    var parts = parseApptMemoScopeKey(scopeKey);
    if (!parts.clinicId) {
        applyApptSharedMemoToField('', scopeKey);
        return Promise.resolve();
    }
    return fetchApptDailyMemo(parts.clinicId, parts.dateIso).then(function (text) {
        applyApptSharedMemoToField(text, scopeKey);
    });
}

function saveApptSharedMemoForScope(scopeKey, textOverride) {
    if (_apptMemoSaveTimer) {
        clearTimeout(_apptMemoSaveTimer);
        _apptMemoSaveTimer = null;
    }
    var ta = g('apptSharedMemo');
    if (!ta) return Promise.resolve();
    var text = textOverride != null ? String(textOverride) : String(ta.value || '');
    var parts = parseApptMemoScopeKey(scopeKey);
    if (!parts.clinicId || !parts.dateIso) return Promise.resolve();
    if (_apptMemoLastSaved === text && _apptMemoLoadedScopeKey === scopeKey) {
        return Promise.resolve();
    }
    return persistApptDailyMemo(parts.clinicId, parts.dateIso, text).then(function (r) {
        if (r && r.error) return;
        if (_apptMemoLoadedScopeKey === scopeKey || scopeKey === apptMemoScopeKey()) {
            _apptMemoLastSaved = text;
            _apptMemoLoadedScopeKey = scopeKey;
        }
    });
}

function saveApptSharedMemoNow() {
    var scopeKey = _apptMemoScopeKey || apptMemoScopeKey();
    return saveApptSharedMemoForScope(scopeKey);
}

function scheduleApptSharedMemoSave() {
    if (_apptMemoHydrating) return;
    if (_apptMemoSaveTimer) clearTimeout(_apptMemoSaveTimer);
    _apptMemoSaveTimer = setTimeout(function () {
        _apptMemoSaveTimer = null;
        saveApptSharedMemoNow();
    }, 700);
}

function apptMemoOnScopeChange(tab) {
    if (_apptMemoScopeBusy) return Promise.resolve();
    tab = tab || (typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : 'queue');
    var oldKey = _apptMemoScopeKey;
    var newKey = apptMemoScopeKey(tab);
    _apptMemoScopeBusy = true;
    var chain = Promise.resolve();
    if (oldKey && oldKey !== newKey) {
        var ta = g('apptSharedMemo');
        var txt = ta ? ta.value : '';
        chain = saveApptSharedMemoForScope(oldKey, txt);
    }
    return chain.then(function () {
        _apptMemoScopeKey = newKey;
        mountApptSharedMemo(tab);
        return loadApptSharedMemo(tab);
    }).finally(function () {
        _apptMemoScopeBusy = false;
    });
}

function bindApptSharedMemoOnce() {
    var ta = g('apptSharedMemo');
    if (!ta || ta.dataset.bound === '1') return;
    ta.dataset.bound = '1';
    ta.addEventListener('input', scheduleApptSharedMemoSave);
    ta.addEventListener('blur', function () { saveApptSharedMemoNow(); });
    var pool = g('apptMemoBarPool');
    var bar = g('apptSharedMemoBar');
    if (pool && bar && bar.parentNode !== pool) pool.appendChild(bar);
}

function refreshApptSharedMemoI18n() {
    var bar = g('apptSharedMemoBar');
    if (bar && typeof applyI18nInRoot === 'function') applyI18nInRoot(bar);
    updateApptSharedMemoDateLabel();
}

// ════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ════════════════════════════════════════════════════════════════
function switchApptTab(tab) {
    document.querySelectorAll('.appt-tab').forEach(function(b) {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-pane').forEach(function(p) {
        p.classList.toggle('active', p.id === 'tab-' + tab);
    });
    if (APPT_SHARED_MEMO_TABS[tab] && typeof apptMemoOnScopeChange === 'function') {
        apptMemoOnScopeChange(tab);
    } else {
        mountApptSharedMemo(null);
    }
    if (tab === 'queue')    loadQueue();
    if (tab === 'today')    loadToday();
    if (tab === 'plusappt') showPlusApptTab();
    if (tab === 'calendar') showCalendarTab();
    if (tab === 'records') loadApptRecords();
    if (tab === 'recall')   initRecallTab();
    if (tab === 'queue') {
        if (typeof queueScheduleCompactFit === 'function') queueScheduleCompactFit();
    }
    if (tab === 'queue' || tab === 'today' || tab === 'plusappt' || tab === 'calendar') {
        apptRefreshPatientCountBadge(tab);
    }
}

/**
 * Jump from consultation timeline visit card → + Appointment day planner on that date.
 * Highlights the appointment row when refId is known.
 */
function openApptFromTimelineVisit(meta) {
    meta = meta || {};

    function navigate(row) {
        row = row || meta;
        var dateIso = String(row.date || '').trim();
        var apptId = row.id || meta.id || meta.apptId || null;

        if (typeof showOnly === 'function') showOnly('appointmentSection');

        if (dateIso && typeof syncApptPlannerDate === 'function') {
            syncApptPlannerDate(dateIso, { syncCal: true });
        }
        if (apptId) plusApptPendingSelectApptId = String(apptId);

        setTimeout(function () {
            if (typeof switchApptTab === 'function') switchApptTab('plusappt');
        }, 40);
    }

    var dateIso = String(meta.date || '').trim();
    var apptId = meta.id || meta.apptId || null;
    if (!dateIso && apptId) {
        SB.from('appointments').select('id,date,doctor_code,start_time')
            .eq('id', apptId).single()
            .then(function (r) {
                navigate((!r.error && r.data) ? r.data : meta);
            });
        return;
    }
    navigate(meta);
}

// ════════════════════════════════════════════════════════════════
// + APPOINTMENT TAB — day planner (mini cal + time slots)
// ════════════════════════════════════════════════════════════════
function plusApptClinicThemeIndex(clinicId) {
    if (!clinicId || !APP_CLINICS || !APP_CLINICS.length) return 0;
    var idx = 0;
    for (var i = 0; i < APP_CLINICS.length; i++) {
        if (APP_CLINICS[i].id === clinicId) {
            idx = i;
            break;
        }
    }
    return idx % PLUSAPPT_CLINIC_THEMES.length;
}

function plusApptClinicTheme(clinicId) {
    return PLUSAPPT_CLINIC_THEMES[plusApptClinicThemeIndex(clinicId)];
}

function plusApptClinicLabel(clinicId) {
    if (typeof clinicRecordFromId === 'function') {
        var rec = clinicRecordFromId(clinicId);
        if (rec) {
            return (typeof clinicDisplayName === 'function')
                ? clinicDisplayName(rec)
                : (rec.english_name || rec.chinese_name || '');
        }
    }
    return (typeof clinicDisplayFallback === 'function')
        ? clinicDisplayFallback()
        : tr('common.clinic');
}

function plusApptGetClinicState() {
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    if (!cid) return null;
    if (!plusApptClinicUiState[cid]) {
        plusApptClinicUiState[cid] = { doctors: {}, date: '', miniCalMonthMs: 0, activeDoctor: '' };
    }
    return plusApptClinicUiState[cid];
}

function plusApptSaveUiState() {
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    if (!cid) return;
    var st = plusApptGetClinicState();
    st.date = plusApptDate;
    st.miniCalMonthMs = plusApptMiniCalMonth.getTime();
    st.activeDoctor = plusApptActiveDoctorCode;
    var dk = plusApptIsAllDoctorsMode()
        ? (plusApptAllActiveDoctorCode || '_none')
        : (plusApptActiveDoctorCode || '_none');
    if (!st.doctors[dk]) st.doctors[dk] = {};
    st.doctors[dk].slot = plusApptSelectedSlot;
    st.doctors[dk].apptId = plusApptSelectedAppt ? plusApptSelectedAppt.id : null;
}

function plusApptFindApptById(id) {
    if (!id) return null;
    var sid = String(id);
    for (var i = 0; i < plusApptDayAppts.length; i++) {
        if (String(plusApptDayAppts[i].id) === sid) return plusApptDayAppts[i];
    }
    return findApptInCalendarCaches(sid);
}

function plusApptResolveRowDragId(ev) {
    if (plusApptDragApptId) return plusApptDragApptId;
    if (!ev || !ev.dataTransfer) return null;
    var dt = ev.dataTransfer;
    var id = '';
    try { id = dt.getData(PLUSAPPT_ROW_DRAG_TYPE) || ''; } catch (_) {}
    if (!id) {
        try { id = dt.getData('text/x-joyful-appt-id') || ''; } catch (_) {}
    }
    if (!id) {
        try {
            var plain = dt.getData('text/plain') || '';
            if (plain && plain.charAt(0) !== '{') id = plain;
        } catch (_) {}
    }
    if (!id) {
        try { id = window.__JOYFUL_APPT_DRAG_APPT_ID || ''; } catch (_) {}
    }
    return id || null;
}

function plusApptResolveRowDragAppt(ev) {
    var id = plusApptResolveRowDragId(ev);
    if (!id) return null;
    var appt = plusApptFindApptById(id);
    if (!appt || isApptScheduleLocked(appt)) return null;
    return appt;
}

function plusApptMarkRowDragTransfer(ev, appt) {
    if (!appt || !appt.id) return;
    plusApptDragApptId = appt.id;
    if (!ev || !ev.dataTransfer) return;
    try {
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData(PLUSAPPT_ROW_DRAG_TYPE, String(appt.id));
    } catch (_) {}
}

function plusApptRestoreDoctorSelection() {
    plusApptSelectedSlot = null;
    plusApptSelectedAppt = null;
    var st = plusApptGetClinicState();
    if (!st) {
        plusApptRefreshAddBtn();
        plusApptRefreshShortcuts();
        return;
    }
    if (plusApptIsAllDoctorsMode()) {
        var docs = plusApptDoctorsForActiveClinic();
        var dkAll = plusApptAllActiveDoctorCode || st.activeDoctor;
        if (dkAll === PLUSAPPT_DOCTOR_ALL && docs.length) {
            dkAll = docs[0].doctor_code;
        }
        if (dkAll && dkAll !== PLUSAPPT_DOCTOR_ALL) plusApptAllActiveDoctorCode = dkAll;
    }
    var dk = plusApptIsAllDoctorsMode()
        ? (plusApptAllActiveDoctorCode || '_none')
        : (plusApptActiveDoctorCode || '_none');
    var dr = st.doctors[dk];
    if (!dr) {
        plusApptRefreshAddBtn();
        plusApptRefreshShortcuts();
        return;
    }
    if (dr.apptId) {
        var a = plusApptFindApptById(dr.apptId);
        if (a && plusApptApptMatchesDoctor(a, plusApptActiveDoctorCode)) {
            plusApptSelectApptRow(a, true, { syncActivePatient: false });
            return;
        }
    }
    if (dr.slot) {
        plusApptSelectEmptySlot(dr.slot, true);
    } else {
        plusApptRefreshAddBtn();
        plusApptRefreshShortcuts();
    }
}

function plusApptRestoreClinicUiState(clinicId) {
    var st = plusApptClinicUiState[clinicId];
    if (!st) {
        plusApptDate = todayISO();
        plusApptMiniCalMonth = new Date();
        plusApptActiveDoctorCode = '';
        return;
    }
    plusApptDate = st.date || todayISO();
    if (st.miniCalMonthMs) {
        plusApptMiniCalMonth = new Date(st.miniCalMonthMs);
    } else {
        var d = typeof parseISODateOnly === 'function' ? parseISODateOnly(plusApptDate) : null;
        plusApptMiniCalMonth = (d && !isNaN(d.getTime()))
            ? new Date(d.getFullYear(), d.getMonth(), 1)
            : new Date();
    }
    plusApptActiveDoctorCode = st.activeDoctor || '';
}

function plusApptApplyClinicTheme() {
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    var theme = plusApptClinicTheme(cid);
    var cal = g('plusApptMiniCal');
    var badge = g('plusApptClinicBadge');
    if (cal) {
        cal.style.setProperty('--plusappt-cal-bg', theme.bg);
        cal.style.setProperty('--plusappt-cal-border', theme.border);
        cal.style.setProperty('--plusappt-cal-sel', theme.sel);
        cal.style.setProperty('--plusappt-cal-accent', theme.accent);
        cal.style.setProperty('--plusappt-cal-shadow', theme.shadow);
        cal.style.setProperty('--plusappt-cal-day-bg', theme.badge);
        cal.style.setProperty('--plusappt-cal-day-hover', theme.bg);
        cal.dataset.clinicTheme = String(plusApptClinicThemeIndex(cid));
    }
    if (badge) {
        badge.textContent = plusApptClinicLabel(cid);
        badge.style.background = theme.badge;
        badge.style.borderColor = theme.border;
        badge.style.color = theme.accent;
    }
}

function plusApptDoctorColor(code) {
    if (!code) return '#94a3b8';
    if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.getColor) {
        return CalDoctorColors.getColor(code);
    }
    return '#0084ff';
}

function plusApptIsAllDoctorsMode() {
    return plusApptActiveDoctorCode === PLUSAPPT_DOCTOR_ALL;
}

function plusApptEffectiveDoctorCode() {
    if (plusApptIsAllDoctorsMode()) return plusApptAllActiveDoctorCode || '';
    return plusApptActiveDoctorCode || '';
}

/** Login identity placeholder (ALL, ALL_TKO, …), not a clinical doctor row. */
function isPlusApptExcludedDoctor(d) {
    if (typeof isClinicalDoctorRecord === 'function') {
        return !isClinicalDoctorRecord(d);
    }
    if (!d) return true;
    var code = String(d.doctor_code || '').trim().toLowerCase();
    return code === 'all' || /^all[_-]/.test(code);
}

function plusApptDoctorsForActiveClinic() {
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    var list = typeof doctorsForClinic === 'function'
        ? doctorsForClinic(cid)
        : (billDoctorList || []).filter(function(d) {
            return !cid || d.clinic_id === cid;
        });
    return (list || []).filter(function(d) {
        return d && d.is_active !== false && String(d.doctor_code || '').trim() &&
            !isPlusApptExcludedDoctor(d);
    });
}

function plusApptToggleScheduleViews() {
    var single = g('plusApptSingleView');
    var allV = g('plusApptAllView');
    var allMode = plusApptIsAllDoctorsMode();
    if (single) {
        single.style.display = allMode ? 'none' : 'block';
        single.setAttribute('aria-hidden', allMode ? 'true' : 'false');
    }
    if (allV) {
        allV.style.display = allMode ? 'block' : 'none';
        allV.setAttribute('aria-hidden', allMode ? 'false' : 'true');
    }
}

function plusApptApptMatchesDoctor(a, code) {
    if (!code) return true;
    if (!a) return false;
    var c = String(code).trim().toLowerCase();
    var dc = String(a.doctor_code || '').trim().toLowerCase();
    if (dc && dc === c) return true;
    var dn = String(a.doctor_name || '').trim().toLowerCase();
    if (dn && dn === c) return true;
    var fromRem = '';
    if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.parseDoctorTagFromRemarks) {
        fromRem = String(CalDoctorColors.parseDoctorTagFromRemarks(a.remarks) || '').trim().toLowerCase();
    }
    if (fromRem && fromRem === c) return true;
    return false;
}

function populatePlusApptClinicSelect() {
    var sel = g('plusApptClinicSelect');
    if (!sel) return;
    var prev = sel.value || plusApptActiveClinicId;
    sel.innerHTML = '';
    if (!APP_CLINICS || !APP_CLINICS.length) {
        sel.innerHTML = '<option value="">' + esc(tr('common.noClinics')) + '</option>';
        return;
    }
    APP_CLINICS.forEach(function(c, i) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = (typeof clinicDisplayName === 'function')
            ? clinicDisplayName(c)
            : (c.english_name || c.chinese_name || clinicDisplayFallback());
        o.dataset.themeIdx = String(i % PLUSAPPT_CLINIC_THEMES.length);
        sel.appendChild(o);
    });
    var def = typeof defaultWorkingClinicId === 'function'
        ? defaultWorkingClinicId()
        : (APP_CLINICS[0] ? APP_CLINICS[0].id : '');
    var has = false;
    for (var j = 0; j < sel.options.length; j++) {
        if (sel.options[j].value === prev) { has = true; break; }
    }
    sel.value = has ? prev : def;
    plusApptActiveClinicId = sel.value;
}

function populatePlusApptDoctorSelect() {
    var sel = g('plusApptDoctorSelect');
    if (!sel) return;
    var prev = sel.value || plusApptActiveDoctorCode;
    sel.innerHTML = '';
    var cid = plusApptActiveClinicId ||
        (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
    var list = plusApptDoctorsForActiveClinic();
    if (!list.length) {
        sel.innerHTML = '<option value="">' + esc(tr('appt.modal.noDoctorsForClinic')) + '</option>';
        plusApptActiveDoctorCode = '';
        plusApptAllActiveDoctorCode = '';
        return;
    }
    var allOpt = document.createElement('option');
    allOpt.value = PLUSAPPT_DOCTOR_ALL;
    allOpt.textContent = tr('common.all');
    sel.appendChild(allOpt);
    list.forEach(function(d) {
        var code = String(d.doctor_code || '').trim();
        var opt = document.createElement('option');
        opt.value = code;
        opt.textContent = (typeof doctorDisplayName === 'function'
            ? doctorDisplayName(d)
            : (d.english_name || d.chinese_name || code)) +
            ' [' + code + ']';
        sel.appendChild(opt);
    });
    if (prev && typeof isLoginPlaceholderDoctorCode === 'function' &&
        isLoginPlaceholderDoctorCode(prev) && prev !== PLUSAPPT_DOCTOR_ALL) {
        prev = PLUSAPPT_DOCTOR_ALL;
    }
    var has = false;
    for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === prev) { has = true; break; }
    }
    if (!has) {
        var st = plusApptGetClinicState();
        prev = (st && st.activeDoctor) ? st.activeDoctor : list[0].doctor_code;
        if (prev && typeof isLoginPlaceholderDoctorCode === 'function' &&
            isLoginPlaceholderDoctorCode(prev) && prev !== PLUSAPPT_DOCTOR_ALL) {
            prev = PLUSAPPT_DOCTOR_ALL;
        }
        has = !!prev;
    }
    sel.value = has ? prev : list[0].doctor_code;
    plusApptActiveDoctorCode = sel.value;
    if (plusApptIsAllDoctorsMode()) {
        plusApptAllActiveDoctorCode = plusApptAllActiveDoctorCode || list[0].doctor_code;
    } else {
        plusApptAllActiveDoctorCode = '';
    }
}

function plusApptSyncTimelineHead() {
    var head = g('plusApptTimelineHead');
    var sel = g('plusApptDoctorSelect');
    if (!head) return;
    if (!sel || !sel.value) {
        head.innerHTML = '<span>' + esc(tr('appt.plusAppt.pickDoctor')) + '</span>';
        return;
    }
    var dateStr = plusApptDate && typeof fmtDateLong === 'function'
        ? fmtDateLong(plusApptDate, { long: true })
        : (plusApptDate || '');
    if (plusApptIsAllDoctorsMode()) {
        var n = plusApptDoctorsForActiveClinic().length;
        head.innerHTML =
            '<span class="plusappt-dr-dot" style="background:linear-gradient(135deg,#3b82f6,#22c55e);"></span>' +
            '<span>' + esc(tr('appt.plusAppt.allTimelines')) + '</span>' +
            '<span class="plusappt-dr-sub">' + esc(dateStr) +
            ' · ' + esc(trRepl('appt.plusAppt.allScrollHint', { N: String(n) })) + '</span>';
        return;
    }
    var code = sel.value;
    var col = plusApptDoctorColor(code);
    var opt = sel.options[sel.selectedIndex];
    var name = opt ? opt.textContent : code;
    head.innerHTML =
        '<span class="plusappt-dr-dot" style="background:' + esc(col) + ';"></span>' +
        '<span>' + esc(tr('appt.plusAppt.timelineFor')) + ' ' + esc(name) + '</span>' +
        '<span class="plusappt-dr-sub">' + esc(dateStr) + '</span>';
}

function onPlusApptClinicChange() {
    if (plusApptClinicSyncing) return;
    var sel = g('plusApptClinicSelect');
    if (!sel || !sel.value) return;
    plusApptSaveUiState();
    plusApptActiveClinicId = sel.value;
    var apptSel = g('apptClinicSelect');
    if (apptSel && apptSel.value !== sel.value) {
        plusApptClinicSyncing = true;
        apptSel.value = sel.value;
        plusApptClinicSyncing = false;
    }
    if (typeof setWorkingClinic === 'function') {
        setWorkingClinic(sel.value, { syncFilters: true, reloadAppt: false });
    }
    plusApptRestoreClinicUiState(sel.value);
    populatePlusApptDoctorSelect();
    var drSel = g('plusApptDoctorSelect');
    if (drSel) plusApptActiveDoctorCode = drSel.value;
    plusApptApplyClinicTheme();
    plusApptSyncDateLabel();
    plusApptToggleScheduleViews();
    plusApptSyncTimelineHead();
    renderPlusApptMiniCal();
    refreshApptPlannerData();
    if (typeof apptMemoOnScopeChange === 'function') apptMemoOnScopeChange('plusappt');
}

function onPlusApptDoctorChange() {
    plusApptSaveUiState();
    var sel = g('plusApptDoctorSelect');
    plusApptActiveDoctorCode = sel ? sel.value : '';
    var st = plusApptGetClinicState();
    if (st) st.activeDoctor = plusApptActiveDoctorCode;
    if (plusApptIsAllDoctorsMode()) {
        var docs = plusApptDoctorsForActiveClinic();
        if (!plusApptAllActiveDoctorCode && docs.length) {
            plusApptAllActiveDoctorCode = docs[0].doctor_code;
        }
    } else {
        plusApptAllActiveDoctorCode = '';
    }
    plusApptClearSelection(true);
    plusApptToggleScheduleViews();
    plusApptSyncTimelineHead();
    renderPlusApptSchedule(true);
    plusApptRestoreDoctorSelection();
}

function plusApptNormTime(t) {
    var s = String(t || '').trim();
    if (!s) return '';
    var p = s.split(':');
    return pad(+p[0] || 0) + ':' + pad(+p[1] || 0);
}

function plusApptTimeToMin(t) {
    var p = String(t || '').split(':');
    return (parseInt(p[0] || '0', 10) * 60) + (parseInt(p[1] || '0', 10) || 0);
}

var GCAL_TIMELINE_DEFAULTS_VER = 3;
var GCAL_LEGACY_TIMELINE_PAIRS = [
    [8, 20], [9, 20], [10, 20],
    [8, 22], [9, 22], [10, 22],
    [10, 24]
];

function gcalNormalizeTimelineSettings(cfg) {
    cfg = cfg || {};
    var ver = parseInt(cfg.timelineDefaultsVer, 10);
    if (ver >= GCAL_TIMELINE_DEFAULTS_VER) return cfg;

    var start = parseInt(cfg.startHour, 10);
    var end = parseInt(cfg.endHour, 10);
    var isLegacy = false;
    GCAL_LEGACY_TIMELINE_PAIRS.forEach(function (pair) {
        if (start === pair[0] && end === pair[1]) isLegacy = true;
    });
    if (isLegacy) {
        cfg.startHour = 9;
        cfg.endHour = 24;
    }
    cfg.timelineDefaultsVer = GCAL_TIMELINE_DEFAULTS_VER;
    return cfg;
}

function gcalPersistSettingsIfChanged(before, after) {
    if (!after) return;
    if (before.startHour === after.startHour &&
        before.endHour === after.endHour &&
        before.timelineDefaultsVer === after.timelineDefaultsVer) {
        return;
    }
    try { localStorage.setItem('gcal_settings_v2', JSON.stringify(after)); } catch (e) {}
}

var PLUSAPPT_ROW_FONT_SCALES = [
    { v: '0.75', labelKey: 'appt.cal.rowFontScale75' },
    { v: '0.85', labelKey: 'appt.cal.rowFontScale85' },
    { v: '1', labelKey: 'appt.cal.rowFontScale100' },
    { v: '1.1', labelKey: 'appt.cal.rowFontScale110' },
    { v: '1.2', labelKey: 'appt.cal.rowFontScale120' },
    { v: '1.35', labelKey: 'appt.cal.rowFontScale135' }
];

/** Recommended row text colours (+ Appointment schedule). deepBluePurple ≈ legacy clinic list blue. */
var PLUSAPPT_ROW_FONT_COLORS = [
    { key: 'default', hex: '', labelKey: 'appt.cal.rowFontColorDefault' },
    { key: 'deepBluePurple', hex: '#0000AA', labelKey: 'appt.cal.rowFontColorDeepBluePurple' },
    { key: 'navy', hex: '#1e3a8a', labelKey: 'appt.cal.rowFontColorNavy' },
    { key: 'black', hex: '#111827', labelKey: 'appt.cal.rowFontColorBlack' },
    { key: 'forest', hex: '#166534', labelKey: 'appt.cal.rowFontColorForest' },
    { key: 'burgundy', hex: '#881337', labelKey: 'appt.cal.rowFontColorBurgundy' }
];

function plusApptRowHeightOptions() {
    return [
        { v: 12, l: tr('appt.cal.slotExtraCompact') },
        { v: 14, l: tr('appt.cal.slotMoreCompact') },
        { v: 16, l: tr('appt.cal.slotCompact') },
        { v: 20, l: tr('appt.cal.slotNormal') },
        { v: 24, l: tr('appt.cal.slotComfortable') },
        { v: 32, l: tr('appt.cal.slotSpacious') }
    ];
}

function plusApptRowFontColorPreset(key) {
    var k = String(key || 'default');
    for (var i = 0; i < PLUSAPPT_ROW_FONT_COLORS.length; i++) {
        if (PLUSAPPT_ROW_FONT_COLORS[i].key === k) return PLUSAPPT_ROW_FONT_COLORS[i];
    }
    return PLUSAPPT_ROW_FONT_COLORS[0];
}

function plusApptReadGcalSettings() {
    var defaults = {
        interval: PLUSAPPT_SLOT_MIN,
        startHour: 9,
        endHour: 24,
        slotH: 24,
        rowFontScale: 1,
        rowFontColor: 'default',
        doctorColors: {}
    };
    try {
        var stored = localStorage.getItem('gcal_settings_v2');
        if (!stored) return Object.assign({}, defaults);
        var merged = Object.assign({}, defaults, JSON.parse(stored));
        var before = {
            startHour: merged.startHour,
            endHour: merged.endHour,
            timelineDefaultsVer: merged.timelineDefaultsVer
        };
        var normalized = gcalNormalizeTimelineSettings(merged);
        gcalPersistSettingsIfChanged(before, normalized);
        return normalized;
    } catch (e) {
        return Object.assign({}, defaults);
    }
}

function plusApptSaveGcalSettings(cfg) {
    try {
        var cur = plusApptReadGcalSettings();
        localStorage.setItem('gcal_settings_v2', JSON.stringify(Object.assign(cur, cfg)));
    } catch (e) {}
}

/** Map row-height preset → + Appointment table row / patient-column sizing. */
function plusApptScheduleLayoutFromSlotH(slotH) {
    var h = parseInt(slotH, 10);
    if (isNaN(h)) h = 24;
    if (h < 12) h = 12;
    var nameColBySlot = { 12: 100, 14: 120, 16: 140, 20: 170, 24: 200, 32: 260 };
    var rowMin = h <= 14 ? h : (h <= 16 ? h + 8 : h + 16);
    return {
        slotH: h,
        rowMin: rowMin,
        nameColMin: nameColBySlot[h] || Math.max(100, Math.round(h * 8.3))
    };
}

function plusApptSyncFontColorSwatch(panel) {
    if (!panel || !panel.querySelector) {
        panel = g('plusApptSettingsPanel');
    }
    apptPlannerSyncFontColorSwatch(panel);
}

function apptPlannerSyncFontColorSwatch(panel) {
    if (!panel) return;
    var sel = panel.querySelector('[data-appt-field="rowFontColor"]');
    var sw = panel.querySelector('[data-appt-field="rowFontColorSwatch"]');
    if (!sel || !sw) return;
    var preset = plusApptRowFontColorPreset(sel.value);
    if (!preset.hex) {
        sw.style.background = 'repeating-linear-gradient(135deg, #94a3b8 0 4px, #e2e8f0 4px 8px)';
        sw.title = tr('appt.cal.rowFontColorDefault');
    } else {
        sw.style.background = preset.hex;
        sw.title = tr(preset.labelKey);
    }
}

/** Push saved planner settings onto + Appointment schedule DOM. */
function plusApptApplyScheduleLayout() {
    var tab = g('tab-plusappt');
    if (!tab) return;
    var cfg = plusApptReadGcalSettings();
    var layout = plusApptScheduleLayoutFromSlotH(cfg.slotH);
    tab.style.setProperty('--plusappt-slot-h', layout.slotH + 'px');
    tab.style.setProperty('--plusappt-row-min-h', layout.rowMin + 'px');
    tab.style.setProperty('--plusappt-name-col-min-w', layout.nameColMin + 'px');
    tab.dataset.plusapptSlotH = String(layout.slotH);
    tab.classList.toggle('plusappt-row-extra-compact', layout.slotH <= 12);
    tab.classList.toggle('plusappt-row-more-compact', layout.slotH === 14);
    tab.classList.toggle('plusappt-row-compact', layout.slotH <= 16);

    var scale = parseFloat(cfg.rowFontScale);
    if (isNaN(scale) || scale <= 0) scale = 1;
    tab.style.setProperty('--plusappt-font-scale', String(scale));

    var colorKey = String(cfg.rowFontColor || 'default');
    var preset = plusApptRowFontColorPreset(colorKey);
    tab.classList.toggle('plusappt-custom-row-color', !!preset.hex);
    if (preset.hex) {
        tab.style.setProperty('--plusappt-row-text-color', preset.hex);
    } else {
        tab.style.removeProperty('--plusappt-row-text-color');
    }
    tab.dataset.plusapptRowFontColor = colorKey;
    if (typeof queueApplyClearModeCompactLayout === 'function') {
        queueApplyClearModeCompactLayout();
    }
}

var PLUSAPPT_CLEAR_MODE_LS = 'plusappt_clear_mode_v1';

function plusApptIsClearMode() {
    try { return localStorage.getItem(PLUSAPPT_CLEAR_MODE_LS) === '1'; } catch (e) { return false; }
}

function plusApptSetClearMode(on) {
    try { localStorage.setItem(PLUSAPPT_CLEAR_MODE_LS, on ? '1' : '0'); } catch (e) {}
    plusApptSyncClearModeUi();
    plusApptApplyClearModeLayout();
    if (typeof renderPlusApptSchedule === 'function') renderPlusApptSchedule(true);
    if (typeof loadQueue === 'function') loadQueue();
    if (typeof loadToday === 'function') loadToday();
}

function plusApptToggleClearMode() {
    plusApptSetClearMode(!plusApptIsClearMode());
}

function plusApptSyncClearModeUi() {
    var btn = g('plusApptClearModeBtn');
    var qBtn = g('queueClearModeBtn');
    var tBtn = g('todayClearModeBtn');
    var on = plusApptIsClearMode();
    if (btn) {
        btn.classList.toggle('plusappt-clear-mode-btn--on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (qBtn) {
        qBtn.classList.toggle('plusappt-clear-mode-btn--on', on);
        qBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (tBtn) {
        tBtn.classList.toggle('plusappt-clear-mode-btn--on', on);
        tBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    document.querySelectorAll('[data-appt-field="clearMode"]').forEach(function(chk) {
        chk.checked = on;
    });
}

function plusApptApplyClearModeLayout() {
    var on = plusApptIsClearMode();
    var plusTab = g('tab-plusappt');
    var queueTab = g('tab-queue');
    var todayTab = g('tab-today');
    if (plusTab) plusTab.classList.toggle('plusappt-clear-mode', on);
    if (queueTab) queueTab.classList.toggle('plusappt-clear-mode', on);
    if (todayTab) todayTab.classList.toggle('plusappt-clear-mode', on);
    queueApplyClearModeCompactLayout();
    todayApplyClearModeCompactLayout();
}

/** Mirror + Appointment row-height / font settings onto queue when clear mode is on. */
function queueApplyClearModeCompactLayout() {
    var tab = g('tab-queue');
    if (!tab) return;
    if (!plusApptIsClearMode()) {
        tab.classList.remove(
            'plusappt-row-extra-compact',
            'plusappt-row-more-compact',
            'plusappt-row-compact',
            'plusappt-custom-row-color'
        );
        tab.style.removeProperty('--plusappt-row-min-h');
        tab.style.removeProperty('--plusappt-font-scale');
        tab.style.removeProperty('--plusappt-row-text-color');
        var wrapOff = tab.querySelector('.queue-wrap');
        if (wrapOff) wrapOff.style.removeProperty('--queue-fit-scale');
        return;
    }
    var cfg = plusApptReadGcalSettings();
    var slotH = parseInt(cfg.slotH, 10);
    if (isNaN(slotH)) slotH = 16;
    slotH = Math.min(Math.max(slotH, 16), 18);
    var layout = plusApptScheduleLayoutFromSlotH(slotH);
    var queueRowMin = Math.max(layout.rowMin + 6, 28);
    tab.style.setProperty('--plusappt-row-min-h', queueRowMin + 'px');
    tab.classList.toggle('plusappt-row-extra-compact', slotH <= 12);
    tab.classList.toggle('plusappt-row-more-compact', slotH === 14);
    tab.classList.add('plusappt-row-compact');

    var scale = parseFloat(cfg.rowFontScale);
    if (isNaN(scale) || scale <= 0) scale = 1;
    tab.style.setProperty('--plusappt-font-scale', String(scale));

    var colorKey = String(cfg.rowFontColor || 'default');
    var preset = plusApptRowFontColorPreset(colorKey);
    tab.classList.toggle('plusappt-custom-row-color', !!preset.hex);
    if (preset.hex) {
        tab.style.setProperty('--plusappt-row-text-color', preset.hex);
    } else {
        tab.style.removeProperty('--plusappt-row-text-color');
    }
    if (typeof queueScheduleCompactFit === 'function') queueScheduleCompactFit();
}

function todayApplyClearModeCompactLayout() {
    var tab = g('tab-today');
    if (!tab) return;
    if (!plusApptIsClearMode()) {
        tab.classList.remove(
            'plusappt-row-extra-compact',
            'plusappt-row-more-compact',
            'plusappt-row-compact',
            'plusappt-custom-row-color'
        );
        tab.style.removeProperty('--plusappt-row-min-h');
        tab.style.removeProperty('--plusappt-font-scale');
        tab.style.removeProperty('--plusappt-row-text-color');
        return;
    }
    var cfg = plusApptReadGcalSettings();
    var slotH = parseInt(cfg.slotH, 10);
    if (isNaN(slotH)) slotH = 16;
    slotH = Math.min(Math.max(slotH, 16), 18);
    var layout = plusApptScheduleLayoutFromSlotH(slotH);
    tab.style.setProperty('--plusappt-row-min-h', Math.max(layout.rowMin + 6, 28) + 'px');
    tab.classList.toggle('plusappt-row-extra-compact', slotH <= 12);
    tab.classList.toggle('plusappt-row-more-compact', slotH === 14);
    tab.classList.add('plusappt-row-compact');

    var scale = parseFloat(cfg.rowFontScale);
    if (isNaN(scale) || scale <= 0) scale = 1;
    tab.style.setProperty('--plusappt-font-scale', String(scale));

    var colorKey = String(cfg.rowFontColor || 'default');
    var preset = plusApptRowFontColorPreset(colorKey);
    tab.classList.toggle('plusappt-custom-row-color', !!preset.hex);
    if (preset.hex) {
        tab.style.setProperty('--plusappt-row-text-color', preset.hex);
    } else {
        tab.style.removeProperty('--plusappt-row-text-color');
    }
}

var PLUSAPPT_SIDEBAR_HIDDEN_LS = 'plusappt_sidebar_hidden_v1';

function plusApptIsSidebarHidden() {
    try { return localStorage.getItem(PLUSAPPT_SIDEBAR_HIDDEN_LS) === '1'; } catch (e) { return false; }
}

function plusApptSetSidebarHidden(on) {
    try { localStorage.setItem(PLUSAPPT_SIDEBAR_HIDDEN_LS, on ? '1' : '0'); } catch (e) {}
    plusApptSyncSidebarToggleUi();
    plusApptApplySidebarLayout();
}

function plusApptToggleSidebar() {
    plusApptSetSidebarHidden(!plusApptIsSidebarHidden());
}

function plusApptSyncSidebarToggleUi() {
    var btn = g('plusApptSidebarToggle');
    if (!btn) return;
    var hidden = plusApptIsSidebarHidden();
    btn.textContent = hidden ? '▶' : '◀';
    btn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    btn.title = tr(hidden ? 'appt.plusAppt.sidebarShowTitle' : 'appt.plusAppt.sidebarHideTitle');
}

function plusApptApplySidebarLayout() {
    var tab = g('tab-plusappt');
    if (tab) tab.classList.toggle('plusappt-sidebar-hidden', plusApptIsSidebarHidden());
}

var apptRefreshDeferred = { plusappt: false, today: false, calendar: false };
var apptEditEndTimer = null;
var apptEditPauseBound = false;
var APPT_EDIT_PAUSE_TABS = { plusappt: 1, today: 1, calendar: 1 };

function apptModuleTabEl(tabKey) {
    return tabKey ? g('tab-' + tabKey) : null;
}

function apptModalIsOpen(id) {
    var el = g(id);
    return !!(el && el.style.display === 'block');
}

function apptElementIsTextEditing(el) {
    if (!el) return false;
    var tag = (el.tagName || '').toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag === 'SELECT') return true;
    if (tag === 'INPUT') {
        var typ = (el.type || '').toLowerCase();
        if (typ !== 'button' && typ !== 'submit' && typ !== 'checkbox' &&
            typ !== 'radio' && typ !== 'hidden' && typ !== 'file') {
            return true;
        }
    }
    if (el.isContentEditable) return true;
    return false;
}

function apptModuleEditPaused(forTab) {
    var tab = forTab || (typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : null);
    if (!tab || !APPT_EDIT_PAUSE_TABS[tab]) return false;

    if (apptModalIsOpen('apptModal')) return true;
    if (apptModalIsOpen('queueRemarksModal')) return true;
    if (apptModalIsOpen('apptImageImportModal')) return true;

    if (plusApptTransferDragActive || apptTransferPendingCut) return true;

    if (tab === 'calendar') {
        if (typeof GCAL !== 'undefined' && GCAL.isInteractionActive && GCAL.isInteractionActive()) {
            return true;
        }
        if (calMonthTransferDragApptId || calMonthTransferState) return true;
        if (calMonthBulkTransferDragDate || calMonthBulkTransferState) return true;
    }

    var tabEl = apptModuleTabEl(tab);
    if (!tabEl) return false;
    var ae = document.activeElement;
    if (!ae || ae === document.body || ae === document.documentElement) return false;
    if (!tabEl.contains(ae)) return false;
    return apptElementIsTextEditing(ae);
}

function apptModuleMarkRefreshDeferred(tab) {
    tab = tab || (typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : null);
    if (tab && Object.prototype.hasOwnProperty.call(apptRefreshDeferred, tab)) {
        apptRefreshDeferred[tab] = true;
    }
}

function apptModuleRefreshAfterEdit() {
    if (apptEditEndTimer) clearTimeout(apptEditEndTimer);
    apptEditEndTimer = setTimeout(function() {
        apptEditEndTimer = null;
        if (apptModuleEditPaused()) return;
        var tab = typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : null;
        if (tab === 'plusappt' && apptRefreshDeferred.plusappt) {
            apptRefreshDeferred.plusappt = false;
            if (typeof loadPlusApptDay === 'function') loadPlusApptDay({ soft: true });
        } else if (tab === 'today' && apptRefreshDeferred.today) {
            apptRefreshDeferred.today = false;
            if (typeof loadToday === 'function') loadToday({ soft: true });
        } else if (tab === 'calendar' && apptRefreshDeferred.calendar) {
            apptRefreshDeferred.calendar = false;
            if (typeof renderCal === 'function') renderCal({ soft: true });
        }
    }, 150);
}

function apptModuleBindEditPauseOnce() {
    if (apptEditPauseBound) return;
    apptEditPauseBound = true;
    ['plusappt', 'today', 'calendar'].forEach(function(tabKey) {
        var tab = apptModuleTabEl(tabKey);
        if (!tab) return;
        tab.addEventListener('focusin', function() {
            if (apptEditEndTimer) {
                clearTimeout(apptEditEndTimer);
                apptEditEndTimer = null;
            }
        }, true);
        tab.addEventListener('focusout', function() {
            apptModuleRefreshAfterEdit();
        }, true);
    });
    ['queueRemarksModal', 'apptModal', 'apptImageImportModal'].forEach(function(mid) {
        var modal = g(mid);
        if (!modal) return;
        modal.addEventListener('focusout', function() {
            apptModuleRefreshAfterEdit();
        }, true);
    });
}

function plusApptModalIsOpen(id) {
    return apptModalIsOpen(id);
}

function plusApptScheduleEditPaused() {
    return apptModuleEditPaused('plusappt');
}

function plusApptMarkRefreshDeferred() {
    apptModuleMarkRefreshDeferred('plusappt');
}

function plusApptScheduleRefreshAfterEdit() {
    apptModuleRefreshAfterEdit();
}

function plusApptBindEditPauseOnce() {
    apptModuleBindEditPauseOnce();
}

function plusApptClearModeNameHtml(a) {
    if (!a) return '—';
    var cn = typeof getApptDisplayChinese === 'function'
        ? String(getApptDisplayChinese(a) || '').trim()
        : String(a.patient_chinese_name || '').trim();
    var en = String(a.patient_name || '').trim();
    var html = '';
    if (a.patient_no) {
        html += '<span class="plusappt-clear-pno">' + esc(a.patient_no) + '</span> ';
    }
    if (cn) {
        html += '<span class="plusappt-clear-cn">' + esc(cn) + '</span>';
    }
    if (cn && en) html += ' ';
    if (en) {
        html += '<span class="plusappt-clear-en">' + esc(en) + '</span>';
    }
    if (!cn && !en) html += '—';
    return html;
}

/** Queue clear mode: patient no + Chinese always full; English uses leftover width. */
function queueClearModeNameHtml(a) {
    if (!a) return '—';
    var cn = typeof getApptDisplayChinese === 'function'
        ? String(getApptDisplayChinese(a) || '').trim()
        : String(a.patient_chinese_name || '').trim();
    var en = String(a.patient_name || '').trim();
    var titleParts = [];
    if (a.patient_no) titleParts.push(String(a.patient_no));
    if (cn) titleParts.push(cn);
    if (en) titleParts.push(en);
    var title = titleParts.join(' · ');
    var html = '<span class="queue-clear-name-wrap"' +
        (title ? ' title="' + esc(title) + '"' : '') + '>';
    if (a.patient_no) {
        html += '<span class="plusappt-clear-pno queue-clear-pno-full">' +
            esc(a.patient_no) + '</span> ';
    }
    if (cn) {
        html += '<span class="plusappt-clear-cn queue-clear-cn-full">' +
            esc(cn) + '</span> ';
    }
    if (en) {
        html += '<span class="plusappt-clear-en queue-clear-en-prefer">' + esc(en) + '</span>';
    }
    if (!cn && !en && !a.patient_no) html += '—';
    html += '</span>';
    return html;
}

function gcalEndHourOptionsHtml(curEndHour) {
    var html = '';
    var h;
    for (h = 0; h < 24; h++) {
        var hStr = pad(h) + ':00';
        html += '<option value="' + h + '"' + (curEndHour === h ? ' selected' : '') + '>' + hStr + '</option>';
    }
    html += '<option value="24"' + (curEndHour === 24 ? ' selected' : '') + '>00:00</option>';
    return html;
}

function plusApptSlotList() {
    var cfg = plusApptReadGcalSettings();
    var interval = Math.max(5, parseInt(cfg.interval, 10) || PLUSAPPT_SLOT_MIN);
    var startH = parseInt(cfg.startHour, 10);
    var endH = parseInt(cfg.endHour, 10);
    if (isNaN(startH)) startH = 9;
    if (isNaN(endH)) endH = 24;
    if (endH <= startH) endH = startH + 1;
    var out = [];
    var h;
    var m;
    for (h = startH; h <= endH; h++) {
        for (m = 0; m < 60; m += interval) {
            if (h === endH && m > 0) break;
            out.push(pad(h) + ':' + pad(m));
        }
    }
    return out;
}

function plusApptWireDrColorPanel() {
    apptPlannerWireDrColorPanel(g('plusApptSettingsPanel'));
}

function apptPlannerWireDrColorPanel(panel) {
    if (!panel) return;
    var box = panel.querySelector('[data-appt-field="drColorsBox"]');
    if (box && typeof CalDoctorColors !== 'undefined' && CalDoctorColors.wireColorPanel) {
        box._calColorPanelWired = false;
        CalDoctorColors.wireColorPanel(box);
    }
}

function fillApptPlannerSettingsPanel(p, opts) {
    if (!p) return;
    opts = opts || {};
    var showPlannerTimes = opts.showPlannerTimes !== false;
    var showClearMode = opts.showClearMode !== false;
    var closeFn = opts.closeFn || 'plusApptToggleSettings()';
    var applyFn = opts.applyFn || 'plusApptApplyPlannerSettings()';
    var apptsForDoctors = opts.apptsForDoctors;
    if (!apptsForDoctors && typeof plusApptDayAppts !== 'undefined') apptsForDoctors = plusApptDayAppts;
    if (!apptsForDoctors) apptsForDoctors = [];

    var S = plusApptReadGcalSettings();
    var mkOpts = function(arr, cur) {
        return arr.map(function(o) {
            var sel = String(cur) === String(o.v) ? ' selected' : '';
            return '<option value="' + o.v + '"' + sel + '>' + esc(o.l) + '</option>';
        }).join('');
    };
    var intOpts = mkOpts([10, 15, 20, 30, 60].map(function(v) {
        return { v: v, l: trRepl('appt.cal.intervalMin', { N: v }) };
    }), S.interval);
    var startOpts = '';
    var endOpts = '';
    var h;
    for (h = 0; h < 24; h++) {
        var hStr = pad(h) + ':00';
        startOpts += '<option value="' + h + '"' + (S.startHour === h ? ' selected' : '') + '>' + hStr + '</option>';
    }
    endOpts = gcalEndHourOptionsHtml(S.endHour);
    var sHOpts = mkOpts(plusApptRowHeightOptions(), S.slotH);
    var fontScaleVal = String(S.rowFontScale != null ? S.rowFontScale : 1);
    var fontScaleOpts = mkOpts(
        PLUSAPPT_ROW_FONT_SCALES.map(function (o) {
            return { v: o.v, l: tr(o.labelKey) };
        }),
        fontScaleVal
    );
    var fontColorKey = String(S.rowFontColor || 'default');
    var fontColorOpts = PLUSAPPT_ROW_FONT_COLORS.map(function (o) {
        var sel = fontColorKey === o.key ? ' selected' : '';
        return '<option value="' + esc(o.key) + '"' + sel + ' style="color:' +
            (o.hex || '#334155') + ';">' + esc(tr(o.labelKey)) + '</option>';
    }).join('');
    var drRows = '';
    var colorKeys = typeof CalDoctorColors !== 'undefined'
        ? CalDoctorColors.collectKeys(apptsForDoctors, typeof currentClinicId !== 'undefined' ? currentClinicId : null)
        : [];
    colorKeys.forEach(function(item) {
        var k = item.key;
        var col = typeof CalDoctorColors !== 'undefined' ? CalDoctorColors.getColor(k) : '#0084ff';
        drRows +=
            '<div class="gcal-dr-row">' +
            '<input type="color" class="gcal-dr-color-inp" data-key="' + encodeURIComponent(k) + '" value="' + col + '" ' +
            'style="width:32px;height:32px;border:2px solid #e2e8f0;border-radius:6px;cursor:pointer;padding:0;flex-shrink:0;">' +
            '<span style="font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;">' + esc(item.label) + '</span>' +
            (typeof CalDoctorColors !== 'undefined' ? CalDoctorColors.presetSwatchesHtml(k, col) : '') +
            '</div>';
    });
    if (!colorKeys.length) {
        drRows = '<p style="color:#aaa;font-size:11px;margin:0;">' + esc(tr('appt.cal.noDoctorsHint')) + '</p>';
    }

    var timesHtml = '';
    if (showPlannerTimes) {
        timesHtml =
            '<label>' + esc(tr('appt.cal.timeInterval')) + '</label>' +
            '<select data-appt-field="interval" style="margin-bottom:12px;">' + intOpts + '</select>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">' +
                '<div><label>' + esc(tr('appt.cal.startTimeLabel')) + '</label>' +
                '<select data-appt-field="startHour">' + startOpts + '</select></div>' +
                '<div><label>' + esc(tr('appt.cal.endTimeLabel')) + '</label>' +
                '<select data-appt-field="endHour">' + endOpts + '</select></div>' +
            '</div>';
    }

    var clearModeHtml = '';
    if (showClearMode) {
        clearModeHtml =
            '<label class="plusappt-clear-mode-setting">' +
                '<input type="checkbox" data-appt-field="clearMode"' +
                (plusApptIsClearMode() ? ' checked' : '') + '>' +
                '<span>' + esc(tr('appt.plusAppt.clearModeSetting')) + '</span>' +
            '</label>';
    }

    p.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
            '<strong style="font-size:13px;color:#1e293b;">' + esc(tr('appt.cal.settingsTitle')) + '</strong>' +
            '<button type="button" onclick="' + closeFn + '" style="background:none;border:none;cursor:pointer;font-size:18px;color:#94a3b8;line-height:1;padding:2px 6px;">×</button>' +
        '</div>' +
        timesHtml +
        '<label>' + esc(tr('appt.cal.rowHeight')) + '</label>' +
        '<select data-appt-field="slotH" style="margin-bottom:12px;">' + sHOpts + '</select>' +
        '<label>' + esc(tr('appt.cal.rowFontScale')) + '</label>' +
        '<select data-appt-field="rowFontScale" style="margin-bottom:12px;">' + fontScaleOpts + '</select>' +
        '<label>' + esc(tr('appt.cal.rowFontColor')) + '</label>' +
        '<div class="plusappt-font-color-picker" style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
            '<select data-appt-field="rowFontColor" style="flex:1;margin-bottom:0;">' + fontColorOpts + '</select>' +
            '<span data-appt-field="rowFontColorSwatch" class="plusappt-font-color-swatch" aria-hidden="true"></span>' +
        '</div>' +
        '<label style="margin-bottom:8px;">' + esc(tr('appt.cal.drColoursLabel')) + '</label>' +
        '<p style="font-size:11px;color:#64748b;margin:0 0 10px;line-height:1.4;">' + esc(tr('appt.cal.drColoursHint')) + '</p>' +
        '<div data-appt-field="drColorsBox">' + drRows + '</div>' +
        (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.resetControlHtml
            ? CalDoctorColors.resetControlHtml() : '') +
        clearModeHtml +
        '<button type="button" onclick="' + applyFn + '" ' +
        'style="margin-top:14px;width:100%;padding:10px;background:#0084ff;color:#fff;' +
        'border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">' +
        esc(tr('appt.cal.applyRefresh')) + '</button>';

    apptPlannerWireDrColorPanel(p);
    var fcSel = p.querySelector('[data-appt-field="rowFontColor"]');
    if (fcSel) {
        fcSel.addEventListener('change', function() { apptPlannerSyncFontColorSwatch(p); });
        apptPlannerSyncFontColorSwatch(p);
    }
}

function plusApptFillSettingsPanel() {
    fillApptPlannerSettingsPanel(g('plusApptSettingsPanel'), {
        showPlannerTimes: true,
        closeFn: 'plusApptToggleSettings()',
        applyFn: 'plusApptApplyPlannerSettings()'
    });
}

function queueFillSettingsPanel() {
    fillApptPlannerSettingsPanel(g('queueSettingsPanel'), {
        showPlannerTimes: false,
        apptsForDoctors: typeof queueApptsCache !== 'undefined' ? queueApptsCache : [],
        closeFn: 'queueToggleSettings()',
        applyFn: 'queueApplyPlannerSettings()'
    });
}

function todayFillSettingsPanel() {
    fillApptPlannerSettingsPanel(g('todaySettingsPanel'), {
        showPlannerTimes: false,
        apptsForDoctors: typeof todayAppts !== 'undefined' ? todayAppts : [],
        closeFn: 'todayToggleSettings()',
        applyFn: 'todayApplyPlannerSettings()'
    });
}

function plusApptRefreshSidebarToolTitles() {
    var setBtn = g('plusApptSettingsBtn');
    var calBtn = g('plusApptMiniCalBtn');
    if (setBtn) setBtn.title = tr('appt.cal.settingsBtnTitle');
    if (calBtn) calBtn.title = tr('appt.cal.miniCalBtnTitle');
    plusApptSyncSidebarToggleUi();
}

function plusApptToggleSettings() {
    var sp = g('plusApptSettingsPanel');
    var wrap = g('plusApptMiniCalWrap');
    if (!sp) return;
    var opening = !sp.classList.contains('open');
    if (opening) {
        plusApptFillSettingsPanel();
        sp.classList.add('open');
        sp.setAttribute('aria-hidden', 'false');
        if (wrap) wrap.classList.remove('open');
    } else {
        sp.classList.remove('open');
        sp.setAttribute('aria-hidden', 'true');
    }
}

function plusApptToggleMiniCal() {
    var wrap = g('plusApptMiniCalWrap');
    var sp = g('plusApptSettingsPanel');
    if (!wrap) return;
    if (sp) {
        sp.classList.remove('open');
        sp.setAttribute('aria-hidden', 'true');
    }
    var opening = !wrap.classList.contains('open');
    if (opening) {
        renderPlusApptMiniCal();
        wrap.classList.add('open');
    } else {
        wrap.classList.remove('open');
    }
}

function applyApptPlannerSettingsFromPanel(p) {
    if (!p) return;
    var cfg = plusApptReadGcalSettings();
    var intervalEl = p.querySelector('[data-appt-field="interval"]');
    var startEl = p.querySelector('[data-appt-field="startHour"]');
    var endEl = p.querySelector('[data-appt-field="endHour"]');
    var slotHEl = p.querySelector('[data-appt-field="slotH"]');
    if (intervalEl) cfg.interval = parseInt(intervalEl.value, 10);
    if (startEl) cfg.startHour = parseInt(startEl.value, 10);
    if (endEl) cfg.endHour = parseInt(endEl.value, 10);
    if (slotHEl) cfg.slotH = parseInt(slotHEl.value, 10);
    var fsEl = p.querySelector('[data-appt-field="rowFontScale"]');
    var fcEl = p.querySelector('[data-appt-field="rowFontColor"]');
    if (fsEl) cfg.rowFontScale = parseFloat(fsEl.value) || 1;
    if (fcEl) cfg.rowFontColor = fcEl.value || 'default';
    var clearEl = p.querySelector('[data-appt-field="clearMode"]');
    if (clearEl) {
        try {
            localStorage.setItem(PLUSAPPT_CLEAR_MODE_LS, clearEl.checked ? '1' : '0');
        } catch (e) {}
    }
    if (startEl && endEl && cfg.endHour <= cfg.startHour) {
        alert(tr('appt.cal.endAfterStart'));
        return;
    }
    var drBox = p.querySelector('[data-appt-field="drColorsBox"]');
    if (typeof CalDoctorColors !== 'undefined' && typeof CalDoctorColors.exportColorsMap === 'function') {
        cfg.doctorColors = CalDoctorColors.exportColorsMap();
    } else if (drBox) {
        drBox.querySelectorAll('.gcal-dr-color-inp').forEach(function(inp) {
            var dk = inp.dataset.key;
            try { dk = decodeURIComponent(dk); } catch (e) {}
            if (!cfg.doctorColors) cfg.doctorColors = {};
            cfg.doctorColors[dk] = inp.value;
        });
    }
    plusApptSaveGcalSettings(cfg);
    plusApptApplyScheduleLayout();
    if (typeof GCAL !== 'undefined' && typeof GCAL.reloadSettingsFromStorage === 'function') {
        GCAL.reloadSettingsFromStorage();
    }
    p.classList.remove('open');
    p.setAttribute('aria-hidden', 'true');
    plusApptSyncClearModeUi();
    plusApptApplyClearModeLayout();
    if (typeof renderPlusApptSchedule === 'function') renderPlusApptSchedule(true);
    if (typeof loadQueue === 'function') loadQueue();
    if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData({ force: true });
    if (typeof renderWeekly === 'function') renderWeekly();
}

function plusApptApplyPlannerSettings() {
    applyApptPlannerSettingsFromPanel(g('plusApptSettingsPanel'));
}

function queueApplyPlannerSettings() {
    applyApptPlannerSettingsFromPanel(g('queueSettingsPanel'));
}

function todayApplyPlannerSettings() {
    applyApptPlannerSettingsFromPanel(g('todaySettingsPanel'));
    if (typeof loadToday === 'function') loadToday();
}

function queueToggleSettings() {
    var sp = g('queueSettingsPanel');
    if (!sp) return;
    var opening = !sp.classList.contains('open');
    if (opening) {
        queueFillSettingsPanel();
        sp.classList.add('open');
        sp.setAttribute('aria-hidden', 'false');
    } else {
        sp.classList.remove('open');
        sp.setAttribute('aria-hidden', 'true');
    }
}

function todayToggleSettings() {
    var sp = g('todaySettingsPanel');
    if (!sp) return;
    var opening = !sp.classList.contains('open');
    if (opening) {
        todayFillSettingsPanel();
        sp.classList.add('open');
        sp.setAttribute('aria-hidden', 'false');
    } else {
        sp.classList.remove('open');
        sp.setAttribute('aria-hidden', 'true');
    }
}

function bindQueueSettingsBtnOnce() {
    if (queueSettingsBtnBound) return;
    var btn = g('queueSettingsBtn');
    if (!btn) return;
    queueSettingsBtnBound = true;
    btn.title = typeof tr === 'function' ? tr('appt.cal.settingsBtnTitle') : '';
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        queueToggleSettings();
    });
    document.addEventListener('click', function(e) {
        var panel = g('queueSettingsPanel');
        if (!panel || !panel.classList.contains('open')) return;
        if (e.target && e.target.closest && e.target.closest('.queue-settings-anchor')) return;
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
    });
}

function bindTodaySettingsBtnOnce() {
    if (todaySettingsBtnBound) return;
    var btn = g('todaySettingsBtn');
    if (!btn) return;
    todaySettingsBtnBound = true;
    btn.title = typeof tr === 'function' ? tr('appt.cal.settingsBtnTitle') : '';
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        todayToggleSettings();
    });
    document.addEventListener('click', function(e) {
        var panel = g('todaySettingsPanel');
        if (!panel || !panel.classList.contains('open')) return;
        if (e.target && e.target.closest && e.target.closest('.today-settings-anchor')) return;
        panel.classList.remove('open');
        panel.setAttribute('aria-hidden', 'true');
    });
}

function plusApptRefreshSettingsPanelI18n() {
    var sp = g('plusApptSettingsPanel');
    if (sp && sp.classList.contains('open')) plusApptFillSettingsPanel();
    var qsp = g('queueSettingsPanel');
    if (qsp && qsp.classList.contains('open')) queueFillSettingsPanel();
    var tsp = g('todaySettingsPanel');
    if (tsp && tsp.classList.contains('open')) todayFillSettingsPanel();
    plusApptRefreshSidebarToolTitles();
    var qBtn = g('queueSettingsBtn');
    if (qBtn && typeof tr === 'function') qBtn.title = tr('appt.cal.settingsBtnTitle');
    var tBtn = g('todaySettingsBtn');
    if (tBtn && typeof tr === 'function') tBtn.title = tr('appt.cal.settingsBtnTitle');
}

window.plusApptToggleSettings = plusApptToggleSettings;
window.plusApptToggleMiniCal = plusApptToggleMiniCal;
window.plusApptApplyPlannerSettings = plusApptApplyPlannerSettings;
window.queueToggleSettings = queueToggleSettings;
window.queueApplyPlannerSettings = queueApplyPlannerSettings;
window.todayToggleSettings = todayToggleSettings;
window.todayApplyPlannerSettings = todayApplyPlannerSettings;

function plusApptTimeCellHtml(slot) {
    var parts = slot.split(':');
    var isHour = parts[1] === '00';
    var cls = isHour ? 'plusappt-time-hour' : 'plusappt-time-interval';
    var disp = typeof fmt12 === 'function' ? fmt12(slot) : slot;
    return '<span class="' + cls + '">' + esc(disp) + '</span>';
}

function plusApptSyncDateLabel() {
    var el = g('plusApptDateLabel');
    if (!el || !plusApptDate) return;
    el.textContent = typeof fmtDateLong === 'function'
        ? fmtDateLong(plusApptDate, { long: true })
        : plusApptDate;
}

function plusApptRefreshAddBtn() {
    var btn = g('plusApptAddBtn');
    if (!btn) return;
    var dr = plusApptEffectiveDoctorCode();
    var on = !!(plusApptDate && plusApptSelectedSlot && !plusApptSelectedAppt && dr);
    btn.disabled = !on;
    btn.classList.toggle('plusappt-add-btn--ready', on);
}

function plusApptRefreshShortcuts() {
    var has = !!plusApptSelectedAppt;
    ['plusApptScEditPatient', 'plusApptScNotes', 'plusApptScDrugs', 'plusApptScBill',
        'plusApptScHistory', 'plusApptScRemarks', 'plusApptScEditAppt'].forEach(function(id) {
        var b = g(id);
        if (b) b.disabled = !has;
    });
}

function plusApptClearRowHighlights(root) {
    var scope = root || document;
    scope.querySelectorAll('.plusappt-slot-row.plusappt-row-selected').forEach(function(r) {
        r.classList.remove('plusappt-row-selected');
    });
}

function plusApptClearSelection(skipSave) {
    plusApptSelectedSlot = null;
    plusApptSelectedAppt = null;
    plusApptRefreshAddBtn();
    plusApptRefreshShortcuts();
    plusApptClearRowHighlights(document);
    if (!skipSave) plusApptSaveUiState();
}

function plusApptHighlightRows(slot, apptId, doctorCode) {
    var root = plusApptIsAllDoctorsMode() ? g('plusApptAllScroll') : g('plusApptSingleView');
    if (!root) return;
    root.querySelectorAll('.plusappt-slot-row').forEach(function(row) {
        var colDr = row.dataset.doctorCode || '';
        if (plusApptIsAllDoctorsMode() && doctorCode && colDr !== doctorCode) {
            row.classList.remove('plusappt-row-selected');
            return;
        }
        var isSel = apptId
            ? row.dataset.apptId === apptId
            : (row.dataset.slotTime === slot && !row.dataset.apptId);
        row.classList.toggle('plusappt-row-selected', isSel);
    });
}

function plusApptSelectEmptySlot(slot, skipSave, doctorCode) {
    if (plusApptIsAllDoctorsMode() && doctorCode) {
        plusApptAllActiveDoctorCode = doctorCode;
    }
    plusApptSelectedSlot = slot;
    plusApptSelectedAppt = null;
    plusApptRefreshAddBtn();
    plusApptRefreshShortcuts();
    plusApptClearRowHighlights(document);
    plusApptHighlightRows(slot, null, doctorCode || plusApptEffectiveDoctorCode());
    if (!skipSave) plusApptSaveUiState();
}

function plusApptSelectApptRow(appt, skipSave, opts) {
    opts = opts || {};
    var dr = appt.doctor_code || plusApptEffectiveDoctorCode();
    if (plusApptIsAllDoctorsMode() && dr) plusApptAllActiveDoctorCode = dr;
    plusApptSelectedAppt = appt;
    plusApptSelectedSlot = plusApptNormTime(appt.start_time);
    plusApptRefreshAddBtn();
    plusApptRefreshShortcuts();
    plusApptClearRowHighlights(document);
    plusApptHighlightRows(null, appt.id, dr);
    if (opts.syncActivePatient !== false && appt && appt.patient_id) {
        apptSetActivePatientFromAppt(appt, opts.activePatientSource || 'plusappt-row-select');
    }
    if (!skipSave) plusApptSaveUiState();
}

function plusApptApptsByStart(appts) {
    var map = {};
    (appts || []).forEach(function(a) {
        var key = plusApptNormTime(a.start_time);
        if (!key) return;
        if (!map[key]) map[key] = [];
        map[key].push(a);
    });
    return map;
}

/** Minutes for a planner row; prefers duration column, else start/end delta. */
function plusApptApptDurationMins(appt) {
    if (!appt) return 0;
    var dur = parseInt(appt.duration || '0', 10);
    if (dur > 0) return dur;
    var stM = plusApptTimeToMin(appt.start_time);
    var enM = plusApptTimeToMin(appt.end_time);
    return (enM > stM) ? (enM - stM) : PLUSAPPT_SLOT_MIN;
}

/**
 * Slots covered by each appointment (any duration).
 * role: 'start' = first row (full highlight); 'span' = continuation (time column only).
 */
function plusApptSpanBySlot(appts) {
    var map = {};
    (appts || []).forEach(function(a) {
        if (!a || (typeof apptTransferIsCutPending === 'function' && apptTransferIsCutPending(a.id))) {
            return;
        }
        var dur = plusApptApptDurationMins(a);
        if (dur < 1) return;
        var startKey = plusApptNormTime(a.start_time);
        if (!startKey) return;
        var startMin = plusApptTimeToMin(startKey);
        var endMin = startMin + dur;
        plusApptSlotList().forEach(function(slot) {
            var sm = plusApptTimeToMin(slot);
            if (sm < startMin || sm >= endMin) return;
            var role = slot === startKey ? 'start' : 'span';
            if (!map[slot] || role === 'start') {
                map[slot] = { appt: a, role: role, startSlot: startKey };
            }
        });
    });
    return map;
}

function plusApptFilterAppts(rows, doctorCode) {
    var list = rows || [];
    var dr = doctorCode != null ? doctorCode : plusApptActiveDoctorCode;
    if (dr && dr !== PLUSAPPT_DOCTOR_ALL) {
        list = list.filter(function(a) {
            return plusApptApptMatchesDoctor(a, dr);
        });
    }
    return list;
}

/** Appointments eligible for header patient-count badges (excludes cancelled / cut-pending). */
function apptFilterCountableAppts(rows) {
    var list = (rows || []).filter(function(a) {
        if (!a || apptTransferIsCutPending(a.id)) return false;
        var s = String(a.bill_status || '').toLowerCase();
        if (s === 'cancelled' || /cancel/.test(s)) return false;
        return true;
    });
    if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts) {
        list = CalDoctorColors.filterAppts(list);
    }
    return list;
}

/** AM/PM patient-count split: PM = appointment start at or after 13:30. */
var APPT_PATIENT_COUNT_PM_CUTOFF_MIN = (13 * 60) + 30;

function apptStartTimeIsPm(startTime) {
    return plusApptTimeToMin(plusApptNormTime(startTime)) >= APPT_PATIENT_COUNT_PM_CUTOFF_MIN;
}

function apptCountAmPmTotal(appts) {
    var am = 0;
    var pm = 0;
    (appts || []).forEach(function(a) {
        if (apptStartTimeIsPm(a.start_time)) pm += 1;
        else am += 1;
    });
    return { am: am, pm: pm, total: am + pm };
}

var APPT_PATIENT_COUNT_TAB_IDS = {
    queue: 'apptPatientCount-queue',
    today: 'apptPatientCount-today',
    plusappt: 'apptPatientCount-plusappt',
    calendar: 'apptPatientCount-calendar'
};

function apptPatientCountEl(tab) {
    var id = APPT_PATIENT_COUNT_TAB_IDS[tab];
    return id ? g(id) : null;
}

function apptCountableApptsForTab(tab) {
    var list = [];
    if (tab === 'queue') {
        list = queueApptsCache || [];
    } else if (tab === 'today') {
        list = todayAppts || [];
    } else if (tab === 'plusappt') {
        var dr = plusApptIsAllDoctorsMode() ? PLUSAPPT_DOCTOR_ALL : plusApptEffectiveDoctorCode();
        list = plusApptFilterAppts(plusApptDayAppts || [], dr);
    } else if (tab === 'calendar') {
        var panel = g('dayPanel');
        if (panel && panel.style.display !== 'none' && _dayPanelCtx && _dayPanelCtx.iso) {
            list = _dayPanelCtx.items || [];
        } else {
            var iso = typeof apptMemoDateIso === 'function'
                ? apptMemoDateIso('calendar')
                : todayISO();
            var cache = (typeof calView !== 'undefined' && calView === 'monthly')
                ? calMonthApptsCache
                : calWeekApptsCache;
            list = (cache || []).filter(function(a) {
                return a && String(a.date || '') === String(iso || '');
            });
        }
    }
    return apptFilterCountableAppts(list);
}

function apptRenderPatientCountEl(el, counts) {
    if (!el) return;
    counts = counts || { am: 0, pm: 0, total: 0 };
    var amKey = tr('appt.patientCount.am');
    var pmKey = tr('appt.patientCount.pm');
    var totKey = tr('appt.patientCount.total');
    el.innerHTML =
        '<span class="appt-patient-count-label">' + esc(tr('appt.patientCount.label')) + '</span>' +
        '<span class="appt-patient-count-seg appt-patient-count-seg--am">' +
            '<span class="appt-patient-count-key">' + esc(amKey) + '</span>' +
            '<span class="appt-patient-count-val">' + esc(String(counts.am)) + '</span>' +
        '</span>' +
        '<span class="appt-patient-count-seg appt-patient-count-seg--pm">' +
            '<span class="appt-patient-count-key">' + esc(pmKey) + '</span>' +
            '<span class="appt-patient-count-val">' + esc(String(counts.pm)) + '</span>' +
        '</span>' +
        '<span class="appt-patient-count-seg appt-patient-count-seg--total">' +
            '<span class="appt-patient-count-key">' + esc(totKey) + '</span>' +
            '<span class="appt-patient-count-val">' + esc(String(counts.total)) + '</span>' +
        '</span>';
    el.title = trRepl('appt.patientCount.title', {
        AM: String(counts.am),
        PM: String(counts.pm),
        TOTAL: String(counts.total)
    });
}

function apptRefreshPatientCountBadge(tab) {
    var el = apptPatientCountEl(tab);
    if (!el) return;
    apptRenderPatientCountEl(el, apptCountAmPmTotal(apptCountableApptsForTab(tab)));
}

function apptRefreshAllPatientCountBadges() {
    Object.keys(APPT_PATIENT_COUNT_TAB_IDS).forEach(apptRefreshPatientCountBadge);
}

function plusApptTaskMapRead() {
    try {
        var raw = localStorage.getItem(PLUSAPPT_TASK_LS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        return {};
    }
}

function plusApptTaskMapWrite(map) {
    try { localStorage.setItem(PLUSAPPT_TASK_LS_KEY, JSON.stringify(map || {})); } catch (e) {}
}

function plusApptNormLabState(v) {
    var s = String(v || '').toLowerCase();
    if (s === 'back') return 'back';
    if (s === 'na' || s === 'n/a') return 'na';
    if (s === 'pending' || s === 'notback' || s === 'not_back') return 'pending';
    return 'na';
}

function plusApptNormRecallState(v) {
    var s = String(v || '').toLowerCase();
    if (s === 'success' || s === 'cant' || s === 'whatsapp' || s === 'voice') return s;
    return '';
}

function plusApptTaskState(appt) {
    if (!appt || !appt.id) return { lab: 'na', recall: '' };
    var map = plusApptTaskMapRead();
    var row = map[String(appt.id)] || {};
    var lab = plusApptNormLabState(
        appt._plusLabState || appt.lab_case_status || row.lab || 'na'
    );
    var recall = plusApptNormRecallState(
        appt._plusRecallState || appt.recall_followup_status || row.recall || ''
    );
    return { lab: lab, recall: recall };
}

function plusApptApplyTaskStateToList(list) {
    if (!list || !list.length) return;
    var map = plusApptTaskMapRead();
    list.forEach(function(appt) {
        if (!appt || !appt.id) return;
        var row = map[String(appt.id)] || {};
        appt._plusLabState = plusApptNormLabState(appt._plusLabState || appt.lab_case_status || row.lab || 'na');
        appt._plusRecallState = plusApptNormRecallState(appt._plusRecallState || appt.recall_followup_status || row.recall || '');
    });
}

function plusApptTaskBadgeHtml(kind, value) {
    var txt = '';
    var cls = 'plusappt-task-badge';
    if (kind === 'lab') {
        cls += (value === 'back') ? ' is-back' : (value === 'na' ? ' is-na' : ' is-pending');
        txt = value === 'back'
            ? tr('appt.plusAppt.taskLabBack')
            : (value === 'na' ? tr('appt.plusAppt.taskLabNA') : tr('appt.plusAppt.taskLabPending'));
    } else {
        cls += value ? (' is-' + value) : ' is-empty';
        if (value === 'success') txt = tr('appt.plusAppt.taskRecallSuccess');
        else if (value === 'cant') txt = tr('appt.plusAppt.taskRecallCant');
        else if (value === 'whatsapp') txt = tr('appt.plusAppt.taskRecallWhatsapp');
        else if (value === 'voice') txt = tr('appt.plusAppt.taskRecallVoice');
        else txt = tr('appt.plusAppt.taskRecallNone');
    }
    return '<span class="' + cls + '">' + esc(txt) + '</span>';
}

function plusApptTaskControlsHtml(appt, state) {
    if (!appt || !appt.id) return '';
    var id = esc(appt.id);
    return (
        '<div class="plusappt-task-wrap">' +
            '<div class="plusappt-task-row">' +
                '<span class="plusappt-task-label">' + esc(tr('appt.plusAppt.taskLab')) + '</span>' +
                plusApptTaskBadgeHtml('lab', state.lab) +
                '<button type="button" class="plusappt-task-btn" data-appt-id="' + id + '" data-task-kind="lab" data-task-value="pending">⏳</button>' +
                '<button type="button" class="plusappt-task-btn" data-appt-id="' + id + '" data-task-kind="lab" data-task-value="back">✅</button>' +
                '<button type="button" class="plusappt-task-btn" data-appt-id="' + id + '" data-task-kind="lab" data-task-value="na">N/A</button>' +
            '</div>' +
            '<div class="plusappt-task-row">' +
                '<span class="plusappt-task-label">' + esc(tr('appt.plusAppt.taskRecall')) + '</span>' +
                plusApptTaskBadgeHtml('recall', state.recall) +
                '<button type="button" class="plusappt-task-btn" data-appt-id="' + id + '" data-task-kind="recall" data-task-value="success">✅</button>' +
                '<button type="button" class="plusappt-task-btn" data-appt-id="' + id + '" data-task-kind="recall" data-task-value="cant">🚫</button>' +
                '<button type="button" class="plusappt-task-btn" data-appt-id="' + id + '" data-task-kind="recall" data-task-value="whatsapp">💬</button>' +
                '<button type="button" class="plusappt-task-btn" data-appt-id="' + id + '" data-task-kind="recall" data-task-value="voice">📞</button>' +
            '</div>' +
        '</div>'
    );
}

function plusApptSetTaskState(apptId, kind, value) {
    var id = String(apptId || '').trim();
    if (!id) return;
    var map = plusApptTaskMapRead();
    var row = map[id] || {};
    if (kind === 'lab') row.lab = plusApptNormLabState(value);
    if (kind === 'recall') row.recall = plusApptNormRecallState(value);
    if ((row.lab === 'na' || !row.lab) && !row.recall) delete map[id];
    else map[id] = row;
    plusApptTaskMapWrite(map);

    plusApptDayAppts.forEach(function(a) {
        if (!a || String(a.id) !== id) return;
        if (kind === 'lab') a._plusLabState = plusApptNormLabState(value);
        if (kind === 'recall') a._plusRecallState = plusApptNormRecallState(value);
    });
}

function apptTaskSummaryHtml(appt) {
    if (!appt || !appt.id) return '';
    var st = plusApptTaskState(appt);
    var labTxt = tr('appt.plusAppt.taskLab') + ': ' +
        (st.lab === 'back'
            ? tr('appt.plusAppt.taskLabBack')
            : (st.lab === 'na' ? tr('appt.plusAppt.taskLabNA') : tr('appt.plusAppt.taskLabPending')));
    var recallTxt = tr('appt.plusAppt.taskRecall') + ': ';
    if (st.recall === 'success') recallTxt += tr('appt.plusAppt.taskRecallSuccess');
    else if (st.recall === 'cant') recallTxt += tr('appt.plusAppt.taskRecallCant');
    else if (st.recall === 'whatsapp') recallTxt += tr('appt.plusAppt.taskRecallWhatsapp');
    else if (st.recall === 'voice') recallTxt += tr('appt.plusAppt.taskRecallVoice');
    else recallTxt += tr('appt.plusAppt.taskRecallNone');

    return (
        '<div class="appt-task-summary">' +
            '<button type="button" class="appt-task-pill appt-task-pill-btn ' + (st.lab === 'back' ? 'is-back' : (st.lab === 'na' ? 'is-na' : 'is-pending')) + '" ' +
                'data-task-cycle="1" data-appt-id="' + esc(appt.id) + '" data-task-kind="lab" ' +
                'title="' + esc(tr('appt.plusAppt.taskLab')) + '">' +
                esc(labTxt) +
            '</button>' +
            '<button type="button" class="appt-task-pill appt-task-pill-btn ' + (st.recall ? ('is-' + st.recall) : 'is-empty') + '" ' +
                'data-task-cycle="1" data-appt-id="' + esc(appt.id) + '" data-task-kind="recall" ' +
                'title="' + esc(tr('appt.plusAppt.taskRecall')) + '">' +
                esc(recallTxt) +
            '</button>' +
        '</div>'
    );
}

function plusApptNextLabState(cur) {
    var s = plusApptNormLabState(cur);
    if (s === 'pending') return 'back';
    if (s === 'back') return 'na';
    return 'pending';
}

function plusApptNextRecallState(cur) {
    var s = plusApptNormRecallState(cur);
    if (!s) return 'whatsapp';
    if (s === 'whatsapp') return 'voice';
    if (s === 'voice') return 'cant';
    if (s === 'cant') return 'success';
    return '';
}

function apptTaskCycleFromSummary(apptId, kind) {
    var id = String(apptId || '').trim();
    if (!id) return;
    var ap = null;
    if (todayAppts && todayAppts.length) {
        ap = todayAppts.find(function(a) { return a && String(a.id) === id; }) || ap;
    }
    if (!ap && plusApptDayAppts && plusApptDayAppts.length) {
        ap = plusApptDayAppts.find(function(a) { return a && String(a.id) === id; }) || ap;
    }
    var st = plusApptTaskState(ap || { id: id });
    var next = '';
    if (kind === 'lab') next = plusApptNextLabState(st.lab);
    if (kind === 'recall') next = plusApptNextRecallState(st.recall);
    if (!next) next = '';
    plusApptSetTaskState(id, kind, next);

    if (typeof loadToday === 'function') loadToday();
    if (typeof loadQueue === 'function') loadQueue();
    if (plusApptDate === todayISO() && typeof renderPlusApptSchedule === 'function') {
        renderPlusApptSchedule(true);
    }
}

function plusApptTransferSnapshot(appt) {
    if (!appt || !appt.id) return null;
    var dur = parseInt(appt.duration || '0', 10);
    if (!dur || dur < 1) {
        var stM = plusApptTimeToMin(appt.start_time);
        var enM = plusApptTimeToMin(appt.end_time);
        dur = (enM > stM) ? (enM - stM) : PLUSAPPT_SLOT_MIN;
    }
    return {
        apptId: appt.id,
        fromDate: appt.date || plusApptDate || todayISO(),
        patientName: appt.patient_name || '',
        patientChineseName: appt.patient_chinese_name || '',
        patientNo: appt.patient_no || '',
        startTime: plusApptNormTime(appt.start_time),
        duration: dur,
        doctorCode: appt.doctor_code || ''
    };
}

function plusApptTransferPatientName(s) {
    if (!s) return '';
    var cn = String(s.patientChineseName || '').trim();
    var en = String(s.patientName || '').trim();
    if (cn && en) return cn + ' · ' + en;
    return cn || en || ('#' + String(s.apptId || ''));
}

function apptTransferIsCutPending(apptId) {
    return !!(apptTransferPendingCut && apptId &&
        String(apptTransferPendingCut.apptId) === String(apptId));
}

function apptDetectSourceTab(appt) {
    if (!appt || !appt.id) return '';
    var id = String(appt.id);
    var i;
    for (i = 0; i < (queueApptsCache || []).length; i++) {
        if (queueApptsCache[i] && String(queueApptsCache[i].id) === id) return 'queue';
    }
    for (i = 0; i < (todayAppts || []).length; i++) {
        if (todayAppts[i] && String(todayAppts[i].id) === id) return 'today';
    }
    if (typeof apptListSelectedTab === 'string' && apptListSelectedTab) {
        return apptListSelectedTab;
    }
    return 'plusappt';
}

function apptTransferHideSourceRowTemporarily(apptId) {
    var oid = String(apptId || '');
    if (!oid) return;
    document.querySelectorAll(
        '#queueBody tr[data-appt-id="' + oid + '"], ' +
        '#todayBody tr[data-appt-id="' + oid + '"], ' +
        '.day-panel-item[data-appt-id="' + oid + '"], ' +
        '.gcal-card[data-id="' + oid + '"], ' +
        '.gcal-month-pill[data-id="' + oid + '"], ' +
        '.appt-pill[data-id="' + oid + '"]'
    ).forEach(function(el) {
        el.classList.add('appt-row-transfer-cut-pending');
        el.setAttribute('hidden', 'hidden');
    });
    document.body.classList.add('appt-transfer-cut-active');
    apptTransferRefreshVisibleListCounts();
    if (typeof renderPlusApptSchedule === 'function') {
        renderPlusApptSchedule(true);
    }
}

function apptTransferRefreshVisibleListCounts() {
    apptRefreshAllPatientCountBadges();
}

function apptTransferBeginPendingCut(appt) {
    if (!appt || !appt.id || isApptScheduleLocked(appt)) return false;
    var oid = String(appt.id);
    if (apptTransferPendingCut && String(apptTransferPendingCut.apptId) !== oid) {
        apptTransferRestorePendingCut();
    }
    apptTransferPendingCut = {
        apptId: oid,
        apptRow: Object.assign({}, appt),
        sourceTab: apptDetectSourceTab(appt)
    };
    plusApptTransferState = plusApptTransferSnapshot(appt);
    plusApptTransferDragActive = false;
    plusApptDragApptId = null;
    apptTransferHideSourceRowTemporarily(oid);
    if (typeof apptToast === 'function') {
        apptToast(tr('appt.plusAppt.transferCutPending'));
    }
    return true;
}

function apptTransferRestorePendingCut() {
    if (!apptTransferPendingCut) {
        apptTransferDismissAll();
        return;
    }
    var oid = apptTransferPendingCut.apptId;
    var tab = apptTransferPendingCut.sourceTab || '';
    apptTransferDismissAll();
    if (tab === 'queue' && typeof loadQueue === 'function') loadQueue();
    else if (tab === 'today' && typeof loadToday === 'function') loadToday();
    else if (tab === 'plusappt' && typeof renderPlusApptSchedule === 'function') renderPlusApptSchedule(true);
    else {
        if (typeof loadQueue === 'function') loadQueue();
        if (typeof loadToday === 'function') loadToday();
        if (typeof renderPlusApptSchedule === 'function') renderPlusApptSchedule(true);
    }
    if (typeof apptToast === 'function') {
        apptToast(tr('appt.plusAppt.transferCancelled'));
    }
}

/** Clear in-progress cut/drag transfer state only (not history log). */
function apptTransferDismissPendingCut() {
    apptTransferPendingCut = null;
    plusApptTransferState = null;
    plusApptTransferDragActive = false;
    plusApptDragApptId = null;
    calMonthTransferState = null;
    calMonthTransferDragApptId = null;
    document.body.classList.remove('appt-transfer-cut-active');
    plusApptSetMiniCalDragOver(false);
    plusApptClearTransferSnapRows();
    var sidebar = document.querySelector('#tab-plusappt .plusappt-sidebar');
    if (sidebar) sidebar.classList.remove('plusappt-sidebar--transfer-over');
    document.querySelectorAll('.gcal-mini-cal--transfer-over, .gcal-mini-cal--transfer-armed').forEach(function(el) {
        el.classList.remove('gcal-mini-cal--transfer-over', 'gcal-mini-cal--transfer-armed');
    });
}

/** Hide transfer chip/alert and clear all transfer drag state. */
function apptTransferDismissAll() {
    apptTransferDismissPendingCut();
    plusApptRenderTransferDock();
}

function apptResolveApptIdFromDropEvent(ev) {
    var apptId = '';
    try { apptId = window.__JOYFUL_APPT_DRAG_APPT_ID || ''; } catch (_) {}
    if (!apptId && ev && ev.dataTransfer) {
        try { apptId = ev.dataTransfer.getData('text/x-joyful-appt-id') || ''; } catch (_) {}
        if (!apptId) {
            var plain = '';
            try { plain = ev.dataTransfer.getData('text/plain') || ''; } catch (_) {}
            if (plain && plain.indexOf('{') !== 0 && plain.indexOf('[') !== 0) apptId = plain;
        }
    }
    return String(apptId || '').trim();
}

/** Build insert payload for cut-paste transfer (new row on target date/slot). */
function apptPayloadFromSourceForTransfer(src, target) {
    if (!src) return null;
    target = target || {};
    var field = typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined'
        ? APPOINTMENT_CLINIC_TAG_FIELD
        : 'clinic_tag';
    var drCode = target.doctor_code || src.doctor_code || '';
    var drName = target.doctor_name || src.doctor_name || drCode || '';
    var payload = {
        patient_id: src.patient_id || null,
        patient_no: src.patient_no || null,
        patient_name: src.patient_name || null,
        patient_chinese_name: src.patient_chinese_name || null,
        date: target.date || src.date,
        start_time: target.start_time || src.start_time,
        end_time: target.end_time || src.end_time,
        duration: target.duration != null ? target.duration : src.duration,
        treatment_items: src.treatment_items || null,
        remarks: src.remarks || null,
        bill_status: 'Scheduled',
        in_queue: null,
        arrival_time: null
    };
    if (drCode) {
        payload.doctor_code = drCode;
        payload.doctor_name = drName;
    }
    if (src[field]) payload[field] = src[field];
    else if (target[field]) payload[field] = target[field];
    Object.keys(payload).forEach(function(k) {
        if (payload[k] === undefined) delete payload[k];
    });
    return payload;
}

function apptTransferCutIsActive() {
    if (apptTransferPendingCut && apptTransferPendingCut.apptId) return true;
    return !!(plusApptTransferState && plusApptTransferState.apptId);
}

function plusApptTransferLogSnapshot() {
    if (plusApptTransferState && plusApptTransferState.apptId) {
        return plusApptTransferState;
    }
    if (apptTransferPendingCut && apptTransferPendingCut.apptRow) {
        return plusApptTransferSnapshot(apptTransferPendingCut.apptRow);
    }
    if (calMonthTransferState && calMonthTransferState.apptId) {
        return calMonthTransferState;
    }
    return null;
}

function plusApptTransferHistoryStorageKey() {
    var uid = '';
    try {
        var raw = localStorage.getItem('jsm_session');
        if (raw) {
            var s = JSON.parse(raw);
            uid = String((s && s.user_id) || '').trim();
        }
    } catch (_) {}
    return PLUSAPPT_TRANSFER_HISTORY_LS + '_' + (uid || 'anon');
}

function plusApptTransferHistoryLoad() {
    var key = plusApptTransferHistoryStorageKey();
    if (plusApptTransferHistoryEntries && plusApptTransferHistoryCacheKey === key) {
        return plusApptTransferHistoryEntries;
    }
    plusApptTransferHistoryCacheKey = key;
    plusApptTransferHistoryEntries = [];
    try {
        var raw = sessionStorage.getItem(key);
        if (raw) {
            var parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) plusApptTransferHistoryEntries = parsed;
        }
    } catch (_) {
        plusApptTransferHistoryEntries = [];
    }
    return plusApptTransferHistoryEntries;
}

function plusApptTransferHistorySave(entries) {
    plusApptTransferHistoryEntries = entries || [];
    try {
        sessionStorage.setItem(
            plusApptTransferHistoryStorageKey(),
            JSON.stringify(plusApptTransferHistoryEntries)
        );
    } catch (_) {}
}

function plusApptTransferHistoryEntryName(entry) {
    if (!entry) return '';
    var cn = String(entry.patientChineseName || '').trim();
    var en = String(entry.patientName || '').trim();
    if (cn && en) return cn + ' · ' + en;
    return cn || en || ('#' + String(entry.patientNo || entry.apptId || ''));
}

function plusApptTransferHistoryRecord(snap, targetPayload) {
    if (!snap || !targetPayload) return;
    var entries = plusApptTransferHistoryLoad().slice();
    entries.unshift({
        id: String(Date.now()) + '-' + String(Math.random()).slice(2, 8),
        apptId: snap.apptId || '',
        patientName: snap.patientName || '',
        patientChineseName: snap.patientChineseName || '',
        patientNo: snap.patientNo || '',
        fromDate: snap.fromDate || '',
        toDate: targetPayload.date || '',
        fromTime: snap.startTime || '',
        toTime: targetPayload.start_time || '',
        at: new Date().toISOString()
    });
    if (entries.length > 20) entries.length = 20;
    plusApptTransferHistorySave(entries);
}

function plusApptTransferHistoryClear() {
    plusApptTransferHistoryEntries = [];
    plusApptTransferHistoryCacheKey = '';
    try {
        sessionStorage.removeItem(plusApptTransferHistoryStorageKey());
    } catch (_) {}
    plusApptRenderTransferLog();
}

window.plusApptTransferHistoryClear = plusApptTransferHistoryClear;

/** Ensure transfer log host exists directly under +Appointment mini calendar. */
function plusApptEnsureTransferLogHost() {
    var logEl = g('plusApptTransferLog');
    if (logEl) return logEl;
    var anchor = g('plusApptMiniCalWrap') || g('plusApptMiniCal');
    var sidebar = document.querySelector('#tab-plusappt .plusappt-sidebar');
    if (!sidebar) return null;
    logEl = document.createElement('div');
    logEl.id = 'plusApptTransferLog';
    logEl.className = 'plusappt-transfer-log';
    logEl.setAttribute('aria-live', 'polite');
    logEl.hidden = true;
    logEl.setAttribute('aria-hidden', 'true');
    if (anchor && anchor.parentNode === sidebar) {
        anchor.insertAdjacentElement('afterend', logEl);
    } else {
        sidebar.appendChild(logEl);
    }
    return logEl;
}

function plusApptTransferDragIsActive() {
    if (!plusApptTransferState || !plusApptTransferState.apptId) return false;
    var tid = String(plusApptTransferState.apptId);
    if (plusApptTransferDragActive) return true;
    return !!(plusApptDragApptId && String(plusApptDragApptId) === tid);
}

function plusApptClearTransferAfterSuccess(newApptId, oldApptId) {
    if (oldApptId && String(apptListSelectedApptId || '') === String(oldApptId)) {
        apptListSelectedApptId = null;
        apptListSelectedTab = '';
    }
    apptTransferDismissPendingCut();
    if (newApptId) plusApptPendingSelectApptId = newApptId;
}

function apptPurgeTransferredSourceFromUi(oldId) {
    if (!oldId) return;
    var oid = String(oldId);
    queueApptsCache = (queueApptsCache || []).filter(function(q) {
        return q && String(q.id) !== oid;
    });
    todayAppts = (todayAppts || []).filter(function(a) {
        return a && String(a.id) !== oid;
    });
    calMonthApptsCache = (calMonthApptsCache || []).filter(function(a) {
        return a && String(a.id) !== oid;
    });
    calWeekApptsCache = (calWeekApptsCache || []).filter(function(a) {
        return a && String(a.id) !== oid;
    });
    plusApptDayAppts = (plusApptDayAppts || []).filter(function(a) {
        return a && String(a.id) !== oid;
    });
    ['queueBody', 'todayBody'].forEach(function(bodyId) {
        var tb = g(bodyId);
        if (!tb) return;
        tb.querySelectorAll('tr[data-appt-id="' + oid + '"]').forEach(function(row) {
            row.remove();
        });
        if (!tb.querySelector('tr[data-appt-id]')) {
            var emptyMsg = bodyId === 'queueBody'
                ? tr('appt.queue.empty')
                : tr('appt.today.noToday');
            tb.innerHTML =
                '<tr><td colspan="' + (bodyId === 'queueBody' ? '10' : '9') + '" ' +
                'style="text-align:center;color:#aaa;padding:24px;">' +
                esc(emptyMsg) + '</td></tr>';
        }
    });
    document.querySelectorAll('.appt-list-row-selected').forEach(function(row) {
        if (row.dataset && row.dataset.apptId === oid) {
            row.classList.remove('appt-list-row-selected');
        }
    });
    document.querySelectorAll(
        '.gcal-card[data-id="' + oid + '"], ' +
        '.gcal-month-pill[data-id="' + oid + '"], ' +
        '.appt-pill[data-id="' + oid + '"]'
    ).forEach(function(el) {
        el.remove();
    });
    apptRefreshAllPatientCountBadges();
}

/** Delete source appointment after transfer; fall back to cancel + clear queue if delete blocked. */
function apptRemoveTransferredSourceRow(oldId, newId, srcRow, done) {
    var oid = String(oldId || '');
    var nid = String(newId || '');
    if (!oid) {
        if (done) done('Missing old appointment');
        return;
    }

    function finishRemoved(mode) {
        apptPurgeTransferredSourceFromUi(oid);
        if (String(apptListSelectedApptId || '') === oid) {
            apptListSelectedApptId = null;
            apptListSelectedTab = '';
        }
        if (done) done(null, { mode: mode || 'removed' });
    }

    function softCancel() {
        var note = '[Transferred → ' + nid + ']';
        var rem = String((srcRow && srcRow.remarks) || '').trim();
        if (rem.indexOf('[Transferred →') < 0) {
            rem = rem ? (rem + '\n' + note) : note;
        }
        SB.from('appointments').update({
            bill_status: 'Cancelled',
            in_queue: null,
            arrival_time: null,
            remarks: rem
        }).eq('id', oid).then(function(ur) {
            if (ur.error) {
                if (done) done(ur.error.message);
                return;
            }
            finishRemoved('cancelled');
        });
    }

    SB.from('appointments').delete().eq('id', oid).then(function(dr) {
        if (!dr.error) {
            finishRemoved('deleted');
            return;
        }
        softCancel();
    });
}

function apptRefreshListsAfterTransfer(oldId) {
    if (oldId) apptPurgeTransferredSourceFromUi(oldId);
    if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
    if (typeof loadToday === 'function') loadToday();
    if (typeof loadQueue === 'function') loadQueue();
    if (typeof loadApptRecords === 'function') loadApptRecords();
}

/** Cut-paste: insert new appointment on target date/slot, re-link bills, delete source. */
function plusApptExecuteTransferCutPaste(snap, targetPayload, done) {
    if (!snap || !snap.apptId) {
        if (done) done('Missing appointment');
        return;
    }
    var oldId = String(snap.apptId);
    var cached = findApptInCalendarCaches(oldId);
    if (cached && isApptScheduleLocked(cached)) {
        if (done) done(typeof tr === 'function' ? tr('appt.msg.lockedDelete') : 'Schedule locked');
        return;
    }
    SB.from('appointments').select('*').eq('id', oldId).limit(1)
    .then(function(r) {
        if (r.error || !r.data || !r.data.length) {
            if (done) done(r.error ? r.error.message : 'Appointment not found');
            return;
        }
        var src = r.data[0];
        if (isApptScheduleLocked(src)) {
            if (done) done(typeof tr === 'function' ? tr('appt.msg.lockedDelete') : 'Schedule locked');
            return;
        }
        var insertPayload = apptPayloadFromSourceForTransfer(src, targetPayload);
        if (!insertPayload) {
            if (done) done('Could not build appointment');
            return;
        }

        function afterInsert(newRow) {
            var newId = newRow && newRow.id;
            if (!newId) {
                if (done) done('Insert failed');
                return;
            }
            SB.from('bills').update({ appointment_id: newId }).eq('appointment_id', oldId)
            .then(function() {
                apptRemoveTransferredSourceRow(oldId, newId, src, function(err) {
                    if (err) {
                        if (done) done(err);
                        return;
                    }
                    if (done) done(null, { oldId: oldId, newRow: newRow, snap: snap });
                });
            });
        }

        function tryInsert(pl, retried) {
            SB.from('appointments').insert([pl]).select('*')
            .then(function(ir) {
                if (!ir.error && ir.data && ir.data.length) {
                    afterInsert(ir.data[0]);
                    return;
                }
                var msg = String((ir.error && ir.error.message) || '').toLowerCase();
                if (!retried && msg.indexOf('patient_chinese_name') >= 0) {
                    var pl2 = Object.assign({}, pl);
                    delete pl2.patient_chinese_name;
                    tryInsert(pl2, true);
                    return;
                }
                if (!retried && msg.indexOf('clinic_tag') >= 0 &&
                    typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined') {
                    var pl3 = Object.assign({}, pl);
                    delete pl3[APPOINTMENT_CLINIC_TAG_FIELD];
                    tryInsert(pl3, true);
                    return;
                }
                if (done) done(ir.error ? ir.error.message : 'Insert failed');
            });
        }
        tryInsert(insertPayload, false);
    });
}

function plusApptFinishTransferCutPaste(snap, targetPayload) {
    plusApptExecuteTransferCutPaste(snap, targetPayload, function(err, result) {
        if (err) {
            alert(trRepl('appt.cal.couldReschedule', { MSG: err }));
            apptTransferRestorePendingCut();
            return;
        }
        var newRow = result && result.newRow;
        var newId = newRow && newRow.id;
        var oldId = result && result.oldId;
        plusApptTransferHistoryRecord(snap, targetPayload);
        plusApptClearTransferAfterSuccess(newId, oldId);
        plusApptClearTransferSnapRows();
        plusApptRenderTransferLog();
        apptToast(trRepl('appt.plusAppt.transferDoneToast', {
            NAME: plusApptTransferPatientName(snap),
            DATE: (typeof fmtDateLong === 'function'
                ? fmtDateLong(targetPayload.date)
                : targetPayload.date),
            TIME: fmt12(targetPayload.start_time)
        }));
        apptRefreshListsAfterTransfer(oldId);
    });
}

function plusApptTryCompleteTransferDrop(rowAppt, slot, colDr) {
    if (!apptTransferCutIsActive()) return false;
    var snap = plusApptTransferState;
    var transferId = String(snap.apptId);
    if (rowAppt && String(rowAppt.id) !== transferId) return false;
    var newStartX = slot;
    if (!newStartX) return false;
    var durX = parseInt(snap.duration || '0', 10);
    if (!durX || durX < 1) durX = PLUSAPPT_SLOT_MIN;
    var newEndX = addMins(newStartX, durX);
    var targetPayload = {
        date: plusApptDate || todayISO(),
        start_time: newStartX,
        end_time: newEndX,
        duration: durX
    };
    if (colDr) targetPayload.doctor_code = colDr;
    plusApptFinishTransferCutPaste(snap, targetPayload);
    return true;
}

function plusApptScheduleDropRoot() {
    return (typeof plusApptIsAllDoctorsMode === 'function' && plusApptIsAllDoctorsMode())
        ? g('plusApptAllScroll')
        : g('plusApptSingleView');
}

function plusApptClearTransferSnapRows(root) {
    root = root || plusApptScheduleDropRoot();
    if (!root) return;
    root.querySelectorAll('.plusappt-row-drop-anchor').forEach(function(el) {
        el.classList.remove('plusappt-row-drop-anchor');
        delete el.dataset.snapLabel;
    });
}

function plusApptMarkTransferSnapRow(row, slot) {
    if (!row || !slot) return;
    plusApptClearTransferSnapRows();
    row.classList.add('plusappt-row-drop-anchor');
    row.dataset.snapLabel = trRepl('appt.plusAppt.transferSnapSlot', { TIME: fmt12(slot) });
}

/** Mini transfer history log below +Appointment mini calendar (post-transfer only). */
function plusApptRenderTransferLog() {
    var logEl = plusApptEnsureTransferLogHost();
    if (!logEl) return;
    var cal = g('plusApptMiniCal');
    if (cal) cal.classList.remove('plusappt-mini-cal--transfer-armed');

    var entries = plusApptTransferHistoryLoad();
    if (!entries.length) {
        logEl.innerHTML = '';
        logEl.hidden = true;
        logEl.classList.remove('plusappt-transfer-log--open');
        logEl.setAttribute('aria-hidden', 'true');
        return;
    }

    var closeLbl = typeof tr === 'function' ? tr('appt.plusAppt.transferLogClose') : 'Close';
    var titleTxt = typeof tr === 'function' ? tr('appt.plusAppt.transferLogTitle') : 'Transfer history';
    var html =
        '<div class="plusappt-transfer-log-card">' +
            '<button type="button" class="plusappt-transfer-log-close" title="' + esc(closeLbl) + '" aria-label="' + esc(closeLbl) + '">×</button>' +
            '<div class="plusappt-transfer-log-title">' + esc(titleTxt) + '</div>' +
            '<div class="plusappt-transfer-log-list">';

    entries.forEach(function(entry) {
        var name = plusApptTransferHistoryEntryName(entry);
        var fromTxt = typeof fmtDateLong === 'function'
            ? fmtDateLong(entry.fromDate)
            : String(entry.fromDate || '');
        var toTxt = typeof fmtDateLong === 'function'
            ? fmtDateLong(entry.toDate)
            : String(entry.toDate || '');
        var fromToTxt = typeof trRepl === 'function'
            ? trRepl('appt.plusAppt.transferFromTo', { FROM: fromTxt, TO: toTxt })
            : (fromTxt + ' → ' + toTxt);
        var timeFrom = entry.fromTime ? fmt12(entry.fromTime) : '';
        var timeTo = entry.toTime ? fmt12(entry.toTime) : '';
        var timeLine = '';
        if (timeFrom || timeTo) {
            timeLine = typeof trRepl === 'function'
                ? trRepl('appt.plusAppt.transferLogTimeRange', {
                    FROM: timeFrom || '—',
                    TO: timeTo || '—'
                })
                : (timeFrom + ' → ' + timeTo);
        }
        html +=
            '<div class="plusappt-transfer-log-item">' +
                '<div class="plusappt-transfer-log-name">' + esc(name) + '</div>' +
                '<div class="plusappt-transfer-log-meta">' + esc(fromToTxt) + '</div>' +
                (timeLine
                    ? ('<div class="plusappt-transfer-log-meta">' + esc(timeLine) + '</div>')
                    : '') +
            '</div>';
    });

    html += '</div></div>';
    logEl.innerHTML = html;
    logEl.hidden = false;
    logEl.removeAttribute('hidden');
    logEl.classList.add('plusappt-transfer-log--open');
    logEl.setAttribute('aria-hidden', 'false');

    var closeBtn = logEl.querySelector('.plusappt-transfer-log-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
            plusApptTransferHistoryClear();
        });
    }
}

function plusApptRenderTransferDock() {
    var dock = g('activePatientTransferDock');
    if (dock) {
        dock.innerHTML = '';
        dock.hidden = true;
        dock.setAttribute('aria-hidden', 'true');
    }
    plusApptRenderTransferLog();
}

function plusApptSetMiniCalDragOver(on) {
    if (!on) {
        var cal = g('plusApptMiniCal');
        if (cal) cal.classList.remove('plusappt-mini-cal--transfer-over');
        var sidebar = document.querySelector('#tab-plusappt .plusappt-sidebar');
        if (sidebar) sidebar.classList.remove('plusappt-sidebar--transfer-over');
    }
}

function plusApptWireTransferDropTarget(el) {
    if (!el || el.dataset.plusApptTransferDrop === '1') return;
    el.dataset.plusApptTransferDrop = '1';

    function onDragOver(ev) {
        if (!plusApptResolveRowDragAppt(ev)) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
        plusApptSetMiniCalDragOver(true);
    }

    function onDragLeave(ev) {
        if (ev && el.contains(ev.relatedTarget)) return;
        plusApptSetMiniCalDragOver(false);
    }

    function onDrop(ev) {
        plusApptSetMiniCalDragOver(false);
        var dragAppt = plusApptResolveRowDragAppt(ev);
        if (!dragAppt) return;
        ev.preventDefault();
        ev.stopPropagation();
        if (!apptTransferBeginPendingCut(dragAppt)) return;
        plusApptDragApptId = null;
    }

    el.addEventListener('dragover', onDragOver, true);
    el.addEventListener('dragleave', onDragLeave, true);
    el.addEventListener('drop', onDrop, true);
}

function plusApptBindTransferDropZones() {
    if (window.__plusApptTransferDropBound) return;
    window.__plusApptTransferDropBound = true;
    var sidebar = document.querySelector('#tab-plusappt .plusappt-sidebar');
    plusApptWireTransferDropTarget(sidebar);
    plusApptWireTransferDropTarget(g('plusApptMiniCal'));
}

/** Drop onto active patient cards — begins transfer cut or sets patient payload. */
window.activePatientApplyDropFromEvent = function(ev, slotIdx, source) {
    if (typeof resolvePatientPayloadForDrop !== 'function') return false;
    slotIdx = slotIdx === 1 ? 1 : 0;
    var srcLabel = source || 'active-card-drop';

    function applyPatientPayload(p, label) {
        if (!p || !p.id || typeof setActivePatientSlot !== 'function') return false;
        setActivePatientSlot(slotIdx, p, label || srcLabel, slotIdx === 0);
        if (typeof clearPatientDragPayloadSession === 'function') {
            clearPatientDragPayloadSession();
        }
        return true;
    }

    var apptId = apptResolveApptIdFromDropEvent(ev);
    if (apptId) {
        var appt = findApptInCalendarCaches(apptId);
        if (appt && !isApptScheduleLocked(appt)) {
            if (!apptTransferBeginPendingCut(appt)) return false;
            if (appt.patient_id && typeof patientDragPayloadFromAppt === 'function') {
                applyPatientPayload(patientDragPayloadFromAppt(appt), 'active-card-transfer-cut');
                return true;
            }
            if (appt.patient_no) {
                resolveQueueRowPatientId(appt, function() {
                    if (typeof patientDragPayloadFromAppt === 'function') {
                        applyPatientPayload(patientDragPayloadFromAppt(appt), 'active-card-transfer-cut');
                    }
                });
                return true;
            }
            if (typeof clearPatientDragPayloadSession === 'function') {
                clearPatientDragPayloadSession();
            }
            return true;
        }
    }

    var p = resolvePatientPayloadForDrop(ev);
    return applyPatientPayload(p, srcLabel);
};

function queueDragSourceFromEvent(ev) {
    if (!ev || !ev.dataTransfer) return '';
    try {
        return ev.dataTransfer.getData('text/x-joyful-drag-source') || '';
    } catch (_) {
        return '';
    }
}

function queueIsPatientOrApptDrag(ev) {
    if (typeof isActivePatientCardDragActive === 'function' && isActivePatientCardDragActive()) {
        return true;
    }
    if (typeof isScheduleApptPatientDragActive === 'function' && isScheduleApptPatientDragActive()) {
        return true;
    }
    try {
        if (window.__JOYFUL_PATIENT_DRAG_PAYLOAD) return true;
    } catch (_) {}
    if (!ev || !ev.dataTransfer) return false;
    var types = ev.dataTransfer.types || [];
    for (var i = 0; i < types.length; i++) {
        if (types[i] === 'application/x-joyful-patient') return true;
    }
    return false;
}

function queueApplyPatientDropOnRow(ev, anchor, tbody) {
    if (!anchor || !ev) return false;
    var targetQ = apptFindListRowAppt(anchor.dataset.apptId, 'queue');
    if (!targetQ) return false;
    ev.preventDefault();
    ev.stopPropagation();
    var p = (typeof resolvePatientPayloadForDrop === 'function')
        ? resolvePatientPayloadForDrop(ev)
        : null;
    if (p && p.id) {
        apptSelectListRow(targetQ, anchor, 'queue');
        if (typeof setActivePatientSlot === 'function') {
            setActivePatientSlot(0, p, 'queue-row-patient-drop', true);
        }
        if (typeof clearPatientDragPayloadSession === 'function') {
            clearPatientDragPayloadSession();
        }
        return true;
    }
    var apptId = queueDragApptIdFromEvent(ev);
    if (!apptId) return false;
    var dragAppt = findApptInCalendarCaches(apptId);
    if (!dragAppt) return false;
    apptSelectListRow(targetQ, anchor, 'queue');
    apptSetActivePatientFromAppt(dragAppt, 'queue-appt-on-row-drop');
    plusApptDragApptId = null;
    if (typeof clearPatientDragPayloadSession === 'function') {
        clearPatientDragPayloadSession();
    }
    return true;
}

function plusApptTreatmentInlineHtml(apptRow, clearMode) {
    var cls = 'appt-treat-inline appt-treat-inline--plusappt';
    if (clearMode) cls += ' appt-treat-inline--clear';
    var title = clearMode && typeof tr === 'function'
        ? tr('appt.plusAppt.treatmentDblClickHint')
        : '';
    return '<input class="' + cls + '" type="text" draggable="false" ' +
        'value="' + esc(apptRow.treatment_items || '') + '" ' +
        'placeholder="' + esc(tr('appt.modal.treatmentPh')) + '" ' +
        'data-appt-id="' + esc(apptRow.id) + '"' +
        (clearMode ? ' readonly' : '') +
        (title ? ' title="' + esc(title) + '"' : '') + '>';
}

function bindPlusApptTreatmentInline(row, apptRow, opts) {
    opts = opts || {};
    var clearMode = !!opts.clearMode;
    if (!row || !apptRow || !apptRow.id) return;
    var tInp = row.querySelector('.appt-treat-inline');
    if (!tInp || tInp.dataset.bound === '1') return;
    tInp.dataset.bound = '1';
    if (clearMode) {
        tInp.addEventListener('mousedown', function(e) {
            if (tInp.readOnly) e.preventDefault();
        });
        tInp.addEventListener('dblclick', function(e) {
            e.stopPropagation();
            tInp.readOnly = false;
            tInp.focus();
            try { tInp.select(); } catch (_) {}
        });
    }
    tInp.addEventListener('click', function(e) {
        if (!clearMode || !tInp.readOnly) e.stopPropagation();
    });
    if (!clearMode) {
        tInp.addEventListener('dblclick', function(e) { e.stopPropagation(); });
    }
    tInp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            try { tInp.blur(); } catch (_) {}
        }
    });
    tInp.addEventListener('blur', function() {
        if (clearMode) tInp.readOnly = true;
        apptInlineSaveTreatment(tInp.getAttribute('data-appt-id'), tInp.value, function(saved) {
            apptRow.treatment_items = saved;
            tInp.value = saved || '';
            var cached = plusApptFindApptById(apptRow.id);
            if (cached) cached.treatment_items = saved;
        });
    });
}

function bindPlusApptRemarksDblclick(row, apptRow) {
    if (!row || !apptRow || !apptRow.id) return;
    var remTd = row.cells && row.cells[3] ? row.cells[3] : null;
    if (!remTd || remTd.dataset.remarksBound === '1') return;
    remTd.dataset.remarksBound = '1';
    remTd.classList.add('plusappt-remarks-cell', 'plusappt-remarks-preview-wrap');
    var lineView = remTd.querySelector('.plusappt-remarks-line-view');
    var hit = lineView || remTd;
    if (typeof tr === 'function') {
        hit.title = tr('appt.plusAppt.remarksDblClickHint');
    }
    hit.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        e.preventDefault();
        if (typeof openQueueRemarksEditor === 'function') openQueueRemarksEditor(apptRow);
    });
}

function bindQueueClearRemarksDblclick(row, apptRow) {
    if (!row || !apptRow || !apptRow.id) return;
    var remTd = row.querySelector('.queue-remarks-cell');
    if (!remTd || remTd.dataset.clearRemarksBound === '1') return;
    remTd.dataset.clearRemarksBound = '1';
    remTd.classList.add('plusappt-remarks-cell');
    var wrap = remTd.querySelector('.plusappt-remarks-preview-wrap');
    var lineView = remTd.querySelector('.plusappt-remarks-line-view');
    var hit = lineView || wrap || remTd;
    if (typeof tr === 'function') {
        hit.title = tr('appt.plusAppt.remarksDblClickHint');
    }
    hit.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        e.preventDefault();
        if (typeof openQueueRemarksEditor === 'function') openQueueRemarksEditor(apptRow);
    });
}

function bindTodayRemarksDblclick(row, apptRow) {
    if (!row || !apptRow || !apptRow.id) return;
    var wrap = row.querySelector('.today-remarks-preview-wrap');
    if (!wrap || wrap.dataset.remarksBound === '1') return;
    wrap.dataset.remarksBound = '1';
    if (typeof tr === 'function') {
        wrap.title = tr('appt.today.remarksDblClickHint');
    }
    wrap.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        e.preventDefault();
        if (typeof openQueueRemarksEditor === 'function') openQueueRemarksEditor(apptRow);
    });
}

var PLUSAPPT_REMARKS_LINE_MAX = 52;

function plusApptRemarksPlainText(remarks) {
    var raw = typeof stripStaffAuthorFromRemarks === 'function'
        ? stripStaffAuthorFromRemarks(remarks || '')
        : String(remarks || '');
    if (typeof stripDoctorTagsFromRemarks === 'function') {
        raw = stripDoctorTagsFromRemarks(raw);
    }
    raw = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (typeof remarksStringHasHtml === 'function' && remarksStringHasHtml(raw)) {
        var tmp = document.createElement('div');
        tmp.innerHTML = typeof sanitizeRemarksHtml === 'function'
            ? sanitizeRemarksHtml(raw)
            : raw;
        raw = tmp.textContent || tmp.innerText || '';
    }
    return String(raw || '').trim();
}

function plusApptRemarksDisplayLines(remarks) {
    var plain = plusApptRemarksPlainText(remarks);
    if (!plain) return [];
    var parts = plain.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
    if (!parts.length) parts = [plain];
    var out = [];
    var maxLen = PLUSAPPT_REMARKS_LINE_MAX;
    parts.forEach(function(line) {
        if (line.length <= maxLen) {
            out.push(line);
            return;
        }
        var rest = line;
        while (rest.length > maxLen) {
            var chunk = rest.slice(0, maxLen);
            var sp = chunk.lastIndexOf(' ');
            if (sp > Math.floor(maxLen * 0.35)) chunk = rest.slice(0, sp);
            else chunk = rest.slice(0, maxLen);
            chunk = chunk.trim();
            if (!chunk) break;
            out.push(chunk);
            rest = rest.slice(chunk.length).trim();
        }
        if (rest) out.push(rest);
    });
    return out;
}

function plusApptRemarksScrollerHtml(remarks, apptId, opts) {
    opts = opts || {};
    var lines = plusApptRemarksDisplayLines(remarks);
    if (!lines.length) return '—';
    var tagHtml = '';
    if (!opts.hideStaffAuthor) {
        var tag = typeof extractStaffAuthorSpan === 'function' ? extractStaffAuthorSpan(remarks) : '';
        tagHtml = tag && typeof sanitizeStaffAuthorSpan === 'function'
            ? sanitizeStaffAuthorSpan(tag)
            : '';
    }
    if (apptId) {
        plusApptRemarksLinesCache[String(apptId)] = {
            lines: lines.slice(),
            tagHtml: tagHtml
        };
    }

    function lineHtml(idx) {
        var html = esc(lines[idx]);
        if (tagHtml && idx === lines.length - 1) html += ' ' + tagHtml;
        return html;
    }

    var fullTitle = lines.join(' · ');
    if (lines.length === 1) {
        return '<div class="plusappt-remarks-scroller plusappt-remarks-scroller--single" title="' +
            esc(fullTitle) + '">' +
            '<div class="plusappt-remarks-line-view">' + lineHtml(0) + '</div></div>';
    }

    return '<div class="plusappt-remarks-scroller" data-appt-id="' + esc(apptId) + '" data-line-idx="0">' +
        '<div class="plusappt-remarks-line-view" title="' + esc(fullTitle) + '">' + lineHtml(0) + '</div>' +
        '<span class="plusappt-remarks-line-meta">1/' + lines.length + '</span>' +
        '<div class="plusappt-remarks-nav-group">' +
            '<button type="button" class="plusappt-remarks-nav plusappt-remarks-up" aria-label="' +
                esc(tr('appt.plusAppt.remarksLineUp')) + '">▲</button>' +
            '<button type="button" class="plusappt-remarks-nav plusappt-remarks-down" aria-label="' +
                esc(tr('appt.plusAppt.remarksLineDown')) + '">▼</button>' +
        '</div></div>';
}

function bindPlusApptRemarksScroller(row, apptId) {
    if (!row || !apptId) return;
    var scroller = row.querySelector('.plusappt-remarks-scroller:not(.plusappt-remarks-scroller--single)');
    if (!scroller) return;
    var cache = plusApptRemarksLinesCache[String(apptId)] || {};
    var lines = cache.lines || [];
    var tagHtml = cache.tagHtml || '';
    if (!lines || lines.length <= 1) return;
    var view = scroller.querySelector('.plusappt-remarks-line-view');
    var meta = scroller.querySelector('.plusappt-remarks-line-meta');
    var up = scroller.querySelector('.plusappt-remarks-up');
    var down = scroller.querySelector('.plusappt-remarks-down');
    var idx = parseInt(scroller.getAttribute('data-line-idx') || '0', 10) || 0;

    function showLine(i) {
        idx = ((i % lines.length) + lines.length) % lines.length;
        scroller.setAttribute('data-line-idx', String(idx));
        if (view) {
            var html = esc(lines[idx]);
            if (tagHtml && idx === lines.length - 1) html += ' ' + tagHtml;
            view.innerHTML = html;
        }
        if (meta) meta.textContent = (idx + 1) + '/' + lines.length;
    }

    if (up) {
        up.addEventListener('click', function(e) {
            e.stopPropagation();
            showLine(idx - 1);
        });
    }
    if (down) {
        down.addEventListener('click', function(e) {
            e.stopPropagation();
            showLine(idx + 1);
        });
    }
}

function fillPlusApptScheduleTbody(tb, doctorCode) {
    if (!tb) return;
    plusApptRemarksLinesCache = {};
    var clearMode = plusApptIsClearMode();
    var slots = plusApptSlotList();
    var filteredAppts = plusApptFilterAppts(plusApptDayAppts, doctorCode);
    var byStart = plusApptApptsByStart(filteredAppts);
    var spanBySlot = plusApptSpanBySlot(filteredAppts);
    var selSlot = plusApptSelectedSlot;
    var selId = plusApptSelectedAppt ? plusApptSelectedAppt.id : null;
    var colDr = doctorCode || plusApptEffectiveDoctorCode();
    var highlightDr = plusApptIsAllDoctorsMode() ? colDr : '';
    tb.innerHTML = '';

    slots.forEach(function(slot) {
        var startAppts = (byStart[slot] || []).filter(function(x) {
            return x && !apptTransferIsCutPending(x.id);
        });
        var rowPlans = startAppts.length
            ? startAppts.map(function(ap, idx) {
                return { a: ap, stackIdx: idx, stackTotal: startAppts.length };
            })
            : [{ a: null, stackIdx: 0, stackTotal: 0 }];

        rowPlans.forEach(function(plan) {
        var a = plan.a;
        var stackIdx = plan.stackIdx;
        var stackTotal = plan.stackTotal;
        var spanInfo = (!a && !startAppts.length && spanBySlot[slot]) ? spanBySlot[slot] : null;
        var row = document.createElement('tr');
        var rowCls = ['plusappt-slot-row'];
        if (a) {
            rowCls.push('plusappt-row-booked-long');
            if (stackTotal > 1) {
                rowCls.push(stackIdx === 0 ? 'plusappt-row-stack-first' : 'plusappt-row-stack-more');
            }
        } else if (spanInfo && spanInfo.role === 'span') {
            rowCls.push('plusappt-row-long-span');
        }
        if (a && clearMode) rowCls.push('plusappt-clear-row');
        row.className = rowCls.join(' ');
        row.dataset.slotTime = slot;
        if (colDr) row.dataset.doctorCode = colDr;
        if (a) {
            row.dataset.apptId = a.id;
            var drCol = plusApptDoctorColor(a.doctor_code || colDr);
            row.style.borderLeft = '4px solid ' + drCol;
        } else if (spanInfo && spanInfo.appt) {
            row.style.borderLeft = '4px solid ' +
                plusApptDoctorColor(spanInfo.appt.doctor_code || colDr);
        } else {
            row.style.borderLeft = '';
        }

        var timeHtml = plusApptTimeCellHtml(slot);
        var nameHtml = '—';
        var treatHtml = '—';
        var remHtml = '—';
        var taskHtml = '';
        var durHtml = '—';
        var locked = false;
        if (a) {
            if (clearMode) {
                nameHtml = plusApptClearModeNameHtml(a);
                treatHtml = plusApptTreatmentInlineHtml(a, true);
                remHtml = plusApptRemarksScrollerHtml(a.remarks, a.id);
                durHtml = (a.duration != null && a.duration !== '')
                    ? esc(apptDurationDisplay(a.duration))
                    : '—';
                locked = isApptScheduleLocked(a);
            } else {
            var pnoPrefix = a.patient_no
                ? '<span class="plusappt-stack-pno">' + esc(a.patient_no) + '</span> '
                : '';
            nameHtml = pnoPrefix + (typeof apptPatientDisplayNameHTML === 'function'
                ? apptPatientDisplayNameHTML(a, { walkIn: true })
                : esc(a.patient_name || '—'));
            nameHtml += apptUnpaidBadgeHtml(a, 'appt-unpaid-badge--plus');
            remHtml = plusApptRemarksScrollerHtml(a.remarks, a.id);
            durHtml = (a.duration != null && a.duration !== '')
                ? esc(apptDurationDisplay(a.duration))
                : '—';
            locked = isApptScheduleLocked(a);
            durHtml += ' <button type="button" class="plusappt-lock-btn' + (locked ? ' is-locked' : '') + '" ' +
                'data-lock-id="' + esc(a.id) + '" title="' +
                esc(locked ? tr('appt.cal.lockUnlockTitle') : tr('appt.cal.lockPinTitle')) + '">' +
                (locked ? '🔒' : '🔓') + '</button>';
            taskHtml = plusApptTaskControlsHtml(a, plusApptTaskState(a));
            treatHtml = plusApptTreatmentInlineHtml(a, false);
            }
        }

        var timeShow;
        if (a && stackTotal > 1 && stackIdx === 0) {
            timeShow = timeHtml;
        } else if (a && stackTotal > 1 && stackIdx > 0) {
            timeShow = '';
        } else if (a) {
            timeShow = clearMode
                ? esc(fmt12(a.start_time))
                : ('<strong>' + fmt12(a.start_time) + '</strong> – ' + fmt12(a.end_time));
        } else {
            timeShow = timeHtml;
        }
        var timeCellCls = 'plusappt-time-cell';
        if ((spanInfo && spanInfo.role === 'span') || (a && stackTotal > 1 && stackIdx > 0)) {
            timeCellCls += ' plusappt-time-cell--occupied';
        }
        if (a && stackTotal > 1 && stackIdx === 0) {
            timeCellCls += ' plusappt-time-cell--stack-anchor';
        }
        if (clearMode) timeCellCls += ' plusappt-clear-time';

        var rowDataCls = 'plusappt-row-data-cell' + (clearMode ? ' plusappt-row-data-cell--clear' : '');

        row.innerHTML =
            '<td class="' + timeCellCls + ' plusappt-row-data-cell' + (clearMode ? ' plusappt-row-data-cell--clear' : '') + '">' + timeShow + '</td>' +
            '<td class="plusappt-name-cell ' + rowDataCls + '">' + nameHtml + '</td>' +
            '<td class="plusappt-treat-cell ' + rowDataCls + '">' + treatHtml + '</td>' +
            '<td class="plusappt-remarks-cell-wrap ' + rowDataCls + '">' + remHtml + taskHtml + '</td>' +
            '<td class="plusappt-dur-cell ' + rowDataCls + '">' + durHtml + '</td>';

        if (plusApptIsAllDoctorsMode()) {
            if (colDr === plusApptAllActiveDoctorCode &&
                ((a && selId === a.id) || (!a && selSlot === slot))) {
                row.classList.add('plusappt-row-selected');
            }
        } else if ((a && selId === a.id) || (!a && selSlot === slot)) {
            row.classList.add('plusappt-row-selected');
        }

        row.addEventListener('click', function(ev) {
            if (apptListRowClickBlocked(ev.target)) return;
            if (a) plusApptSelectApptRow(a);
            else if (apptTransferCutIsActive() && plusApptTryCompleteTransferDrop(null, slot, colDr)) {
                ev.preventDefault();
            } else plusApptSelectEmptySlot(slot, false, colDr);
        });
        if (a && !locked) row.setAttribute('draggable', 'true');
        row.addEventListener('dragstart', function(ev) {
            if (!a || locked) {
                ev.preventDefault();
                return;
            }
            if (ev.target && ev.target.closest && ev.target.closest('.plusappt-patient-drag-handle')) {
                return;
            }
            plusApptMarkRowDragTransfer(ev, a);
            row.classList.add('plusappt-row-dragging');
            if (typeof beginApptPatientDragTransfer === 'function') {
                beginApptPatientDragTransfer(ev, a);
            } else if (ev.dataTransfer) {
                ev.dataTransfer.setData('text/plain', String(a.id));
            }
        });
        row.addEventListener('dragend', function() {
            plusApptDragApptId = null;
            plusApptSetMiniCalDragOver(false);
            if (typeof clearPatientDragPayloadSession === 'function') {
                clearPatientDragPayloadSession();
            }
            row.classList.remove('plusappt-row-dragging');
            plusApptClearTransferSnapRows();
        });
        row.addEventListener('dragover', function(ev) {
            if (apptTransferCutIsActive()) {
                if (a && !apptTransferIsCutPending(a.id)) return;
                ev.preventDefault();
                ev.dataTransfer.dropEffect = 'move';
                plusApptMarkTransferSnapRow(row, slot);
                return;
            }
            if (plusApptTransferDragIsActive()) {
                var tid = String(plusApptTransferState.apptId);
                if (a && String(a.id) !== tid) return;
                ev.preventDefault();
                ev.dataTransfer.dropEffect = 'move';
                plusApptMarkTransferSnapRow(row, slot);
                return;
            }
            if (plusApptDragApptId) {
                var dragAppt = plusApptDayAppts.find(function(x) { return String(x.id) === String(plusApptDragApptId); });
                if (!dragAppt || isApptScheduleLocked(dragAppt)) return;
                if (a && String(a.id) !== String(plusApptDragApptId)) return;
                if (String((dragAppt.doctor_code || colDr || '')) !== String(colDr || '')) return;
                ev.preventDefault();
                ev.dataTransfer.dropEffect = 'move';
                plusApptMarkTransferSnapRow(row, slot);
                return;
            }
            var ok = (typeof hasPatientDragPayload === 'function')
                ? hasPatientDragPayload(ev)
                : true;
            if (!ok) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = 'copy';
            row.classList.add('plusappt-row-selected');
        });
        row.addEventListener('dragleave', function() {
            row.classList.remove('plusappt-row-drop-anchor');
            if (plusApptSelectedAppt && String(row.dataset.apptId || '') === String(plusApptSelectedAppt.id || '')) {
                row.classList.add('plusappt-row-selected');
                return;
            }
            if (!plusApptSelectedAppt && plusApptSelectedSlot && row.dataset.slotTime === plusApptSelectedSlot) {
                row.classList.add('plusappt-row-selected');
                return;
            }
            row.classList.remove('plusappt-row-selected');
        });
        row.addEventListener('drop', function(ev) {
            if (plusApptTryCompleteTransferDrop(a, slot, colDr)) {
                ev.preventDefault();
                return;
            }
            if (plusApptDragApptId) {
                plusApptClearTransferSnapRows();
                ev.preventDefault();
                if (plusApptTransferState &&
                    String(plusApptTransferState.apptId) === String(plusApptDragApptId)) {
                    return;
                }
                var dragAppt = plusApptDayAppts.find(function(x) { return String(x.id) === String(plusApptDragApptId); });
                if (!dragAppt || isApptScheduleLocked(dragAppt)) return;
                if (String((dragAppt.doctor_code || colDr || '')) !== String(colDr || '')) return;
                var newStart = slot;
                if (!newStart || plusApptNormTime(dragAppt.start_time) === newStart) return;
                var dur = parseInt(dragAppt.duration || '0', 10);
                if (!dur || dur < 1) {
                    var stM = plusApptTimeToMin(dragAppt.start_time);
                    var enM = plusApptTimeToMin(dragAppt.end_time);
                    dur = (enM > stM) ? (enM - stM) : PLUSAPPT_SLOT_MIN;
                }
                var newEnd = addMins(newStart, dur);
                SB.from('appointments')
                    .update({ start_time: newStart, end_time: newEnd, duration: dur })
                    .eq('id', dragAppt.id)
                .then(function(r) {
                    if (r.error) {
                        alert(trRepl('appt.cal.couldReschedule', { MSG: r.error.message }));
                        return;
                    }
                    dragAppt.start_time = newStart;
                    dragAppt.end_time = newEnd;
                    dragAppt.duration = dur;
                    plusApptSelectApptRow(dragAppt, true, { syncActivePatient: false });
                    apptToast(trRepl('appt.cal.rescheduledToast', { TIME: fmt12(newStart) }));
                    if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
                    if (typeof loadToday === 'function') loadToday();
                    if (typeof loadQueue === 'function') loadQueue();
                    if (typeof loadApptRecords === 'function') loadApptRecords();
                });
                return;
            }
            var p = (typeof readPatientDragPayloadFromEvent === 'function')
                ? readPatientDragPayloadFromEvent(ev)
                : null;
            if (!p) return;
            ev.preventDefault();
            plusApptOpenCreateForDroppedPatient(p, slot, colDr);
        });
        row.addEventListener('dblclick', function(e) {
            e.preventDefault();
            if (a) openApptEditModal(a);
        });

        if (a && a.patient_id) {
            var nameTd = row.cells && row.cells[1] ? row.cells[1] : null;
            if (nameTd) {
                nameTd.classList.add('plusappt-patient-drag-handle');
                nameTd.setAttribute('draggable', 'true');
                nameTd.title = typeof tr === 'function' ? tr('activePatient.dragFromApptTitle') : '';
                nameTd.addEventListener('dragstart', function(ev) {
                    ev.stopPropagation();
                    plusApptMarkRowDragTransfer(ev, a);
                    if (typeof beginApptPatientDragTransfer === 'function') {
                        beginApptPatientDragTransfer(ev, a);
                    }
                });
                nameTd.addEventListener('dragend', function(ev) {
                    ev.stopPropagation();
                    plusApptDragApptId = null;
                    plusApptSetMiniCalDragOver(false);
                    if (typeof clearPatientDragPayloadSession === 'function') {
                        clearPatientDragPayloadSession();
                    }
                });
            }
        }

        tb.appendChild(row);
        if (a) bindPlusApptTreatmentInline(row, a, { clearMode: clearMode });
        if (a) bindPlusApptRemarksScroller(row, a.id);
        if (a && clearMode) bindPlusApptRemarksDblclick(row, a);
        }); // rowPlans
    });

    if (!slots.length) {
        tb.innerHTML =
            '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:24px;">' +
            esc(tr('appt.plusAppt.noSlots')) + '</td></tr>';
    }
    tb.querySelectorAll('.plusappt-lock-btn').forEach(function(btn) {
        btn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var aid = btn.getAttribute('data-lock-id');
            if (!aid) return;
            var ap = plusApptDayAppts.find(function(x) { return String(x.id) === String(aid); });
            if (!ap) return;
            var nextLocked = !isApptScheduleLocked(ap);
            persistApptScheduleLock(ap, nextLocked, function(ok) {
                if (!ok) return;
                if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
            });
        });
    });
    tb.querySelectorAll('.plusappt-task-btn').forEach(function(btn) {
        btn.addEventListener('dblclick', function(ev) {
            ev.preventDefault();
            ev.stopPropagation();
        });
        btn.addEventListener('click', function(ev) {
            ev.stopPropagation();
            var aid = btn.getAttribute('data-appt-id');
            var kind = btn.getAttribute('data-task-kind');
            var val = btn.getAttribute('data-task-value');
            if (!aid || !kind) return;
            plusApptSetTaskState(aid, kind, val);
            renderPlusApptSchedule(true);
        });
    });
}

function renderPlusApptAllDoctorsBoard() {
    var scroll = g('plusApptAllScroll');
    if (!scroll) return;
    scroll.innerHTML = '';
    var doctors = plusApptDoctorsForActiveClinic();
    if (!doctors.length) {
        scroll.innerHTML =
            '<p style="padding:24px;color:#94a3b8;text-align:center;">' +
            esc(tr('appt.modal.noDoctorsForClinic')) + '</p>';
        return;
    }

    doctors.forEach(function(doc) {
        var code = String(doc.doctor_code || '').trim();
        var col = document.createElement('div');
        col.className = 'plusappt-dr-col';
        col.dataset.doctorCode = code;

        var colHead = document.createElement('div');
        colHead.className = 'plusappt-dr-col-head';
        var drCol = plusApptDoctorColor(code);
        var drName = typeof doctorDisplayName === 'function'
            ? doctorDisplayName(doc)
            : (doc.english_name || doc.chinese_name || code);
        colHead.innerHTML =
            '<span class="plusappt-dr-dot" style="background:' + esc(drCol) + ';"></span>' +
            '<span class="plusappt-dr-col-name">' + esc(drName) + '</span>' +
            '<span class="plusappt-dr-col-code">[' + esc(code) + ']</span>';
        col.appendChild(colHead);

        var wrap = document.createElement('div');
        wrap.className = 'tbl-wrap plusappt-schedule-wrap plusappt-schedule-wrap--col';

        var tbl = document.createElement('table');
        tbl.className = 'appt-tbl plusappt-schedule-tbl';
        tbl.innerHTML =
            '<thead><tr>' +
            '<th class="plusappt-th-time">' + esc(tr('appt.modal.startTime')) + '</th>' +
            '<th class="plusappt-th-name">' + esc(tr('appt.plusAppt.th.name')) + '</th>' +
            '<th>' + esc(tr('appt.plusAppt.th.treatment')) + '</th>' +
            '<th>' + esc(tr('appt.modal.remarks')) + '</th>' +
            '<th>' + esc(tr('appt.modal.duration')) + '</th>' +
            '</tr></thead>';
        var tbody = document.createElement('tbody');
        tbl.appendChild(tbody);
        wrap.appendChild(tbl);
        col.appendChild(wrap);
        scroll.appendChild(col);

        fillPlusApptScheduleTbody(tbody, code);
    });
}

function renderPlusApptSchedule(force) {
    if (!force && apptModuleEditPaused('plusappt')) {
        apptModuleMarkRefreshDeferred('plusappt');
        return;
    }
    plusApptApplyScheduleLayout();
    plusApptToggleScheduleViews();
    if (plusApptIsAllDoctorsMode()) {
        renderPlusApptAllDoctorsBoard();
        apptRefreshPatientCountBadge('plusappt');
        return;
    }
    var tb = g('plusApptScheduleBody');
    if (!tb) return;
    fillPlusApptScheduleTbody(tb, plusApptActiveDoctorCode);
    apptRefreshPatientCountBadge('plusappt');
}

function renderPlusApptMiniCal() {
    var host = g('plusApptMiniCal');
    if (!host) return;
    var y = plusApptMiniCalMonth.getFullYear();
    var mo = plusApptMiniCalMonth.getMonth();
    var first = new Date(y, mo, 1);
    var startPad = first.getDay();
    var daysIn = new Date(y, mo + 1, 0).getDate();
    var loc = apptDateLocale();
    var monthLbl = new Date(y, mo, 1).toLocaleDateString(loc, { month: 'long', year: 'numeric' });
    var wd = apptCalWeekdayHeaders();
    var html = '<div class="plusappt-mc-head">' +
        '<button type="button" class="plusappt-mc-nav" data-act="prev">‹</button>' +
        '<span class="plusappt-mc-title">' + esc(monthLbl) + '</span>' +
        '<button type="button" class="plusappt-mc-nav" data-act="next">›</button>' +
        '</div><div class="plusappt-mc-wd">';
    wd.forEach(function(d) {
        html += '<span>' + esc(d) + '</span>';
    });
    html += '</div><div class="plusappt-mc-grid">';
    var i;
    var cell = 0;
    for (i = 0; i < startPad; i++) {
        html += '<span class="plusappt-mc-pad"></span>';
        cell++;
    }
    for (var day = 1; day <= daysIn; day++) {
        var iso = y + '-' + pad(mo + 1) + '-' + pad(day);
        var sel = iso === plusApptDate;
        var today = iso === todayISO();
        var cs = 'plusappt-mc-day';
        if (sel) cs += ' plusappt-mc-day--sel';
        if (today) cs += ' plusappt-mc-day--today';
        html += '<button type="button" class="' + cs + '" data-iso="' + iso + '">' + day + '</button>';
        cell++;
    }
    html += '</div>' +
        '<button type="button" class="plusappt-mc-today" data-act="today">' +
        esc(tr('appt.calToday')) + '</button>';
    host.innerHTML = html;
    plusApptRenderTransferDock();

    host.querySelectorAll('[data-iso]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            plusApptSetDate(btn.getAttribute('data-iso'));
        });
    });
    host.querySelectorAll('[data-act]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var act = btn.getAttribute('data-act');
            if (act === 'prev') {
                plusApptMiniCalMonth = new Date(y, mo - 1, 1);
                renderPlusApptMiniCal();
            } else if (act === 'next') {
                plusApptMiniCalMonth = new Date(y, mo + 1, 1);
                renderPlusApptMiniCal();
            } else if (act === 'today') {
                plusApptSetDate(todayISO());
            }
        });
    });
}

function plusApptSetDate(iso) {
    plusApptSaveUiState();
    syncApptPlannerDate(iso, { syncCal: true });
    plusApptClearSelection(true);
    renderPlusApptMiniCal();
    refreshApptPlannerData();
}

function loadPlusApptDay(opts) {
    opts = opts || {};
    if (!opts.force && apptModuleEditPaused('plusappt')) {
        apptModuleMarkRefreshDeferred('plusappt');
        opts.soft = true;
    }
    if (!plusApptDate) plusApptDate = todayISO();
    var loadSeq = ++plusApptDayLoadSeq;
    plusApptSyncDateLabel();
    var tb = g('plusApptScheduleBody');
    var scroll = g('plusApptAllScroll');
    var allMode = typeof plusApptIsAllDoctorsMode === 'function' && plusApptIsAllDoctorsMode();
    if (!tb && !(allMode && scroll)) return;
    var loadingHtml =
        '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:24px;">' +
        esc(tr('common.loadingEllipsis')) + '</td></tr>';
    if (!opts.soft) {
        if (allMode && scroll) {
            scroll.innerHTML =
                '<p style="text-align:center;color:#aaa;padding:24px;">' +
                esc(tr('common.loadingEllipsis')) + '</p>';
        } else if (tb) {
            tb.innerHTML = loadingHtml;
        }
    }

    var q = SB.from('appointments').select('*')
        .eq('date', plusApptDate)
        .order('start_time', { ascending: true });
    q = applyPlusApptClinicQuery(q);
    q.then(function(r) {
        if (loadSeq !== plusApptDayLoadSeq) return;
        if (r.error) {
            if (!opts.soft) {
                plusApptDayAppts = [];
                var errHtml =
                    '<tr><td colspan="5" style="text-align:center;color:#c00;padding:24px;">' +
                    esc(trRepl('appt.msg.error', { MSG: r.error.message })) + '</td></tr>';
                if (allMode && scroll) {
                    scroll.innerHTML =
                        '<p style="text-align:center;color:#c00;padding:24px;">' +
                        esc(trRepl('appt.msg.error', { MSG: r.error.message })) + '</p>';
                } else if (tb) {
                    tb.innerHTML = errHtml;
                }
            }
            return;
        }
        var finish = function(rows) {
            if (loadSeq !== plusApptDayLoadSeq) return;
            rows = plusApptReconcilePendingRowIntoList(rows || []);
            plusApptDayAppts = rows;
            plusApptApplyTaskStateToList(plusApptDayAppts);
            renderPlusApptSchedule();
            plusApptFinishDayLoadSelection();
            hydrateApptUnpaidBalances(plusApptDayAppts, function(changed) {
                if (!changed) return;
                if (loadSeq !== plusApptDayLoadSeq) return;
                if (typeof apptActiveTabKey === 'function' && apptActiveTabKey() === 'plusappt') {
                    renderPlusApptSchedule();
                    plusApptFinishDayLoadSelection();
                }
            });
        };
        if (!r.data || !r.data.length) {
            finish([]);
            return;
        }
        if (typeof augmentAppointmentsChineseFromPatients === 'function') {
            augmentAppointmentsChineseFromPatients(r.data, finish);
        } else {
            finish(r.data);
        }
    });
}

function plusApptPrefillModalPatient() {
    var p = plusApptHeaderPatient || apptActivePatientSnapshot();
    if (!p) return;
    if (typeof apptSetSelectedPatient === 'function') apptSetSelectedPatient(p);
}

function plusApptApplyHeaderPatient(p) {
    if (!p || !p.id) return;
    plusApptHeaderPatient = p;
    var inp = g('plusApptPsInput');
    if (inp) {
        inp.value =
            (p.chinese_name ? p.chinese_name + ' ' : '') +
            (p.full_name || p.patient_name || '') +
            ' (#' + (p.patient_no || '') + ')';
    }
    var dd = g('plusApptPsDrop');
    if (dd) dd.style.display = 'none';
}

/** Open + Appointment tab; optionally prefill patient from patient module. */
function openPlusApptForPatient(p) {
    if (p && p.id && typeof setActivePatientSlot === 'function') {
        setActivePatientSlot(0, p, 'patient-plus-appt', true);
    }
    if (typeof showOnly === 'function') showOnly('appointmentSection');
    if (typeof initAppt === 'function') initAppt();
    setTimeout(function () {
        if (p && p.id) plusApptApplyHeaderPatient(p);
        if (typeof switchApptTab === 'function') switchApptTab('plusappt');
    }, 60);
}

function openPlusApptCreateModal() {
    if (!plusApptDate || !plusApptSelectedSlot || plusApptSelectedAppt) return;
    var drCode = plusApptEffectiveDoctorCode();
    if (!drCode) {
        alert(tr('appt.plusAppt.pickDoctorFirst'));
        return;
    }
    openApptWithDatetime(plusApptDate, plusApptSelectedSlot);
    setTimeout(function() {
        plusApptPrefillModalPatient();
        if (typeof loadApptDoctors === 'function') {
            loadApptDoctors(drCode);
        } else {
            var dr = g('fApptDoctor');
            if (dr) dr.value = drCode;
            if (typeof renderApptDoctorColorPreview === 'function') {
                renderApptDoctorColorPreview();
            }
        }
    }, 80);
}

function plusApptOpenCreateForDroppedPatient(p, slot, doctorCode) {
    if (!p || !p.id) return;
    var useSlot = slot || plusApptSelectedSlot || '09:00';
    var drCode = doctorCode || plusApptEffectiveDoctorCode();
    plusApptHeaderPatient = p;
    plusApptSelectEmptySlot(useSlot, true, drCode);
    openApptWithDatetime(plusApptDate || todayISO(), useSlot);
    setTimeout(function() {
        plusApptPrefillModalPatient();
        if (drCode && typeof loadApptDoctors === 'function') {
            loadApptDoctors(drCode);
        }
        if (typeof clearPatientDragPayloadSession === 'function') {
            clearPatientDragPayloadSession();
        }
    }, 90);
}

function doPlusApptPatientSearch() {
    var inp = g('plusApptPsInput');
    var dd = g('plusApptPsDrop');
    if (!inp || !dd) return;
    var q = (inp.value || '').trim();
    if (!q) {
        plusApptHeaderPatient = null;
        dd.style.display = 'none';
        return;
    }

    var pq = typeof patientSearchQueryBuilder === 'function'
        ? patientSearchQueryBuilder(q)
        : null;
    if (!pq) {
        dd.style.display = 'none';
        return;
    }
    pq.then(function(r) {
        dd.innerHTML = '';
        if (r.error || !r.data || !r.data.length) {
            dd.innerHTML =
                '<div class="ps-item" style="color:#aaa;">' +
                esc(tr('common.psNoPatients')) + '</div>';
            dd.style.display = 'block';
            return;
        }
        r.data.forEach(function(p) {
            var item = document.createElement('div');
            item.className = 'ps-item';
            item.innerHTML =
                (p.chinese_name
                    ? '<span style="font-family:\'PingFang HK\',\'Microsoft JhengHei\',sans-serif;font-weight:700;">' +
                      esc(p.chinese_name) + '</span> '
                    : '') +
                '<strong>' + esc(p.full_name) + '</strong>' +
                '<br><small style="color:#aaa;">#' + esc(p.patient_no || '-') + '</small>';
            item.setAttribute('draggable', 'true');
            item.addEventListener('click', function() {
                plusApptHeaderPatient = p;
                inp.value =
                    (p.chinese_name ? p.chinese_name + ' ' : '') +
                    p.full_name + ' (#' + (p.patient_no || '') + ')';
                dd.style.display = 'none';
            });
            item.addEventListener('dragstart', function(ev) {
                if (typeof beginPatientDragTransfer === 'function') {
                    beginPatientDragTransfer(ev, p);
                }
            });
            item.addEventListener('dragend', function() {
                if (typeof clearPatientDragPayloadSession === 'function') {
                    clearPatientDragPayloadSession();
                }
            });
            dd.appendChild(item);
        });
        dd.style.display = 'block';
    });
}

function plusApptOpenHistory() {
    var a = plusApptSelectedAppt;
    if (!a) return;
    var term = (a.patient_no || a.patient_name || '').trim();
    switchApptTab('records');
    setTimeout(function() {
        var inp = g('arSearchInput');
        if (inp) {
            inp.value = term;
            arSearchTerm = term;
            if (typeof loadApptRecords === 'function') loadApptRecords();
        }
    }, 120);
}

function bindPlusApptTabOnce() {
    if (plusApptTabBound) return;
    plusApptTabBound = true;
    bindApptImportModalOnce();
    plusApptBindTransferDropZones();

    var setBtn = g('plusApptSettingsBtn');
    var calBtn = g('plusApptMiniCalBtn');
    if (setBtn) setBtn.addEventListener('click', plusApptToggleSettings);
    if (calBtn) calBtn.addEventListener('click', plusApptToggleMiniCal);
    plusApptRefreshSidebarToolTitles();
    var sidebarToggleBtn = g('plusApptSidebarToggle');
    if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', plusApptToggleSidebar);
    plusApptSyncSidebarToggleUi();
    plusApptApplySidebarLayout();
    plusApptApplyScheduleLayout();
    var clearBtn = g('plusApptClearModeBtn');
    if (clearBtn) clearBtn.addEventListener('click', plusApptToggleClearMode);
    plusApptSyncClearModeUi();
    plusApptApplyClearModeLayout();

    var addBtn = g('plusApptAddBtn');
    if (addBtn) {
        addBtn.addEventListener('click', function() {
            openPlusApptCreateModal();
        });
        addBtn.addEventListener('dragover', function(ev) {
            var ok = (typeof hasPatientDragPayload === 'function')
                ? hasPatientDragPayload(ev)
                : true;
            if (!ok) return;
            ev.preventDefault();
            ev.dataTransfer.dropEffect = 'copy';
            addBtn.classList.add('plusappt-add-btn--ready');
        });
        addBtn.addEventListener('dragleave', function() {
            plusApptRefreshAddBtn();
        });
        addBtn.addEventListener('drop', function(ev) {
            var p = (typeof readPatientDragPayloadFromEvent === 'function')
                ? readPatientDragPayloadFromEvent(ev)
                : null;
            plusApptRefreshAddBtn();
            if (!p) return;
            ev.preventDefault();
            plusApptHeaderPatient = p;
            if (typeof setPatientDragPayloadSession === 'function') {
                setPatientDragPayloadSession(p);
            }
            if (plusApptDate && plusApptSelectedSlot) {
                openPlusApptCreateModal();
                if (typeof clearPatientDragPayloadSession === 'function') {
                    clearPatientDragPayloadSession();
                }
                return;
            }
            openApptWithDatetime(plusApptDate || todayISO(), plusApptSelectedSlot || '09:00');
            setTimeout(function() {
                plusApptPrefillModalPatient();
                var drCode = plusApptEffectiveDoctorCode();
                if (drCode && typeof loadApptDoctors === 'function') loadApptDoctors(drCode);
                if (typeof clearPatientDragPayloadSession === 'function') {
                    clearPatientDragPayloadSession();
                }
            }, 90);
        });
    }
    var importBtn = g('plusApptImport29Btn');
    if (importBtn) {
        importBtn.addEventListener('click', function() {
            openApptImageImportModal();
        });
    }

    var psIn = g('plusApptPsInput');
    if (psIn) {
        psIn.addEventListener('input', function() {
            clearTimeout(plusApptPsTimer);
            plusApptPsTimer = setTimeout(doPlusApptPatientSearch, 280);
        });
        psIn.addEventListener('blur', function() {
            setTimeout(function() {
                var dd = g('plusApptPsDrop');
                if (dd) dd.style.display = 'none';
            }, 200);
        });
    }

    var clinicSel = g('plusApptClinicSelect');
    if (clinicSel) {
        clinicSel.addEventListener('change', onPlusApptClinicChange);
    }
    var doctorSel = g('plusApptDoctorSelect');
    if (doctorSel) {
        doctorSel.addEventListener('change', onPlusApptDoctorChange);
    }

    var scMap = {
        plusApptScEditPatient: function() {
            var a = plusApptSelectedAppt;
            if (!a || !a.patient_id) {
                alert(tr('appt.queue.noPatientLinked'));
                return;
            }
            if (typeof openEditPatient === 'function') openEditPatient(a.patient_id);
        },
        plusApptScNotes: function() {
            var a = plusApptSelectedAppt;
            if (!a || !a.patient_id) {
                alert(tr('appt.queue.noPatientLinked'));
                return;
            }
            if (typeof openConForPatient === 'function') openConForPatient(a.patient_id);
        },
        plusApptScDrugs: function() {
            var a = plusApptSelectedAppt;
            if (!a || !a.patient_id) {
                alert(tr('appt.queue.noPatientLinked'));
                return;
            }
            if (typeof openConForPatient === 'function') {
                openConForPatient(a.patient_id);
                setTimeout(function() {
                    if (typeof switchConTab === 'function') switchConTab('treatment');
                }, 200);
            }
        },
        plusApptScBill: function() {
            var a = plusApptSelectedAppt;
            if (!a) return;
            if (typeof openBillPanel === 'function') openBillPanel(a);
        },
        plusApptScHistory: plusApptOpenHistory,
        plusApptScRemarks: function() {
            var a = plusApptSelectedAppt;
            if (!a) return;
            if (typeof openQueueRemarksEditor === 'function') openQueueRemarksEditor(a);
        },
        plusApptScEditAppt: function() {
            var a = plusApptSelectedAppt;
            if (!a) return;
            openApptEditModal(a);
        }
    };
    Object.keys(scMap).forEach(function(id) {
        var btn = g(id);
        if (btn) btn.addEventListener('click', scMap[id]);
    });
}

function importApptFromPhoto20260529() {
    var dateIso = '2026-05-28';
    var dateInput = prompt('Target appointment date (YYYY-MM-DD):', dateIso);
    if (dateInput === null) return;
    dateIso = String(dateInput || '').trim() || dateIso;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
        alert('Invalid date format. Use YYYY-MM-DD.');
        return;
    }
    var clinicTag = 'MK';
    var doctorName = 'DR. NG PUI CHING';
    var rows = [
        { start: '10:45', dur: 30, patient_no: '006433', patient_name: 'CHENG SI YUN', remarks: 'OK) FA *LIV 1/5' },
        { start: '11:15', dur: 60, patient_no: '006519', patient_name: 'YANG CHI LAAM JEANNIE', remarks: 'OK) DEBOND ... *LIV 1/5' },
        { start: '12:15', dur: 15, patient_no: '001523', patient_name: 'CHAN KIT WA', remarks: 'OK) INV#4 *LIV 30/4 13/5 ALI' },
        { start: '12:30', dur: 30, patient_no: '000000', patient_name: 'NEW PATIENT', remarks: 'OK) C/U +FILLING ...' },
        { start: '14:30', dur: 60, patient_no: '006710', patient_name: 'YIP PUI GEE', remarks: 'OK) RCT OB, NEXT HOLD12% ...' },
        { start: '15:30', dur: 30, patient_no: '006539', patient_name: 'TAM KIT LAM', remarks: 'OK) FIT CR *LIV 28/5' },
        { start: '16:00', dur: 30, patient_no: '006756', patient_name: 'CHUNG HOK YING', remarks: 'OK) (PL) INV SCAN+PHOTO...' },
        { start: '16:30', dur: 15, patient_no: '001465', patient_name: 'JAVED AQIB', remarks: 'WST) FA *LIV 1/5' },
        { start: '17:00', dur: 45, patient_no: '000000', patient_name: 'NEW PATIENT', remarks: 'OK) MOS 96670735 ...' },
        { start: '17:45', dur: 45, patient_no: '000000', patient_name: 'NEW PATIENT', remarks: 'OK) CONS COOL...' },
        { start: '18:30', dur: 30, patient_no: '006753', patient_name: 'LIANG CHUN HO', remarks: 'OK/TKO) FIRST SCAN+PHOTO...' },
        { start: '18:30', dur: 15, patient_no: '006755', patient_name: 'LIANG CHING HEI', remarks: 'OK/TKO) OPG+CEPH...' },
        { start: '19:00', dur: 15, patient_no: '006681', patient_name: 'HO KWAN YAU', remarks: 'OK) 月SEPARATER*1' },
        { start: '19:15', dur: 15, patient_no: '000000', patient_name: 'NEW PATIENT', remarks: 'OK) 名醫洗牙卡...' },
        { start: '19:30', dur: 45, patient_no: '006746', patient_name: 'CHUNG YUK CHU', remarks: 'OK) PC+F' },
        { start: '21:00', dur: 30, patient_no: '006283', patient_name: 'TSUI KA YAN', remarks: '15:30 ...RCT POST *LIV 7/5' }
    ];

    if (!confirm('Import appointments from photo into ' + dateIso + ' ?')) return;

    var nos = rows
        .map(function(r) { return String(r.patient_no || '').trim(); })
        .filter(function(no) { return no && no !== '000000'; });
    var uniqNos = Array.from(new Set(nos));

    function normalizePatientNo(v) {
        var s = String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!s) return '';
        if (s.indexOf('MK') === 0) return s.slice(2);
        return s;
    }

    function patientNoVariants(v) {
        var raw = String(v || '').trim();
        if (!raw) return [];
        var base = normalizePatientNo(raw);
        if (!base) return [];
        return [base, 'MK' + base];
    }

    var docCode = '';
    if (APP_DOCTORS && APP_DOCTORS.length) {
        var hit = APP_DOCTORS.find(function(d) {
            var dn = String((d.display_name || d.english_name || d.chinese_name || '')).toUpperCase();
            return dn.indexOf('NG PUI CHING') >= 0;
        });
        if (hit) docCode = String(hit.doctor_code || '').trim();
    }

    function patientQueryDone(done) {
        var queryNos = [];
        uniqNos.forEach(function(no) {
            patientNoVariants(no).forEach(function(x) {
                if (queryNos.indexOf(x) < 0) queryNos.push(x);
            });
        });
        var q = SB.from('patients').select('id,patient_no,full_name,chinese_name,phone_number');
        if (clinicTag && typeof PATIENT_CLINIC_TAG_FIELD !== 'undefined') {
            q = q.eq(PATIENT_CLINIC_TAG_FIELD, clinicTag);
        }
        q = q.in('patient_no', queryNos);
        q.then(function(r) {
            done((r && r.data) ? r.data : []);
        });
    }

    function existingQueryDone(done) {
        var q = SB.from('appointments').select('id,start_time,patient_no,patient_name').eq('date', dateIso);
        q.then(function(r) {
            done((r && r.data) ? r.data : []);
        });
    }

    patientQueryDone(function(patRows) {
        var pMap = {};
        var pNormMap = {};
        (patRows || []).forEach(function(p) {
            var noRaw = String(p.patient_no || '').trim();
            pMap[noRaw] = p;
            var nk = normalizePatientNo(noRaw);
            if (nk && !pNormMap[nk]) pNormMap[nk] = p;
        });
        existingQueryDone(function(existing) {
            var ex = {};
            (existing || []).forEach(function(a) {
                var key = [
                    plusApptNormTime(a.start_time),
                    String(a.patient_no || '').trim(),
                    String(a.patient_name || '').trim().toUpperCase()
                ].join('|');
                ex[key] = true;
            });

            var missingNos = [];
            var payloads = [];
            var skipped = 0;
            rows.forEach(function(r) {
                var no = String(r.patient_no || '').trim();
                var isWalkin = !no || no === '000000';
                var p = null;
                if (!isWalkin) {
                    var vars = patientNoVariants(no);
                    for (var vi = 0; vi < vars.length; vi++) {
                        if (pMap[vars[vi]]) { p = pMap[vars[vi]]; break; }
                    }
                    if (!p) p = pNormMap[normalizePatientNo(no)] || null;
                }
                if (!isWalkin && !p) {
                    missingNos.push(no);
                    return;
                }
                var start = plusApptNormTime(r.start);
                var dur = parseInt(r.dur || '0', 10);
                if (!dur || dur < 1) dur = PLUSAPPT_SLOT_MIN;
                var name = p ? (p.full_name || r.patient_name || '') : (r.patient_name || 'NEW PATIENT');
                var key = [start, (p ? (p.patient_no || no) : ''), String(name || '').trim().toUpperCase()].join('|');
                if (ex[key]) {
                    skipped++;
                    return;
                }
                ex[key] = true;
                var item = {
                    date: dateIso,
                    start_time: start,
                    end_time: addMins(start, dur),
                    duration: dur,
                    patient_id: p ? p.id : null,
                    patient_no: p ? (p.patient_no || no) : null,
                    patient_name: name || null,
                    patient_chinese_name: p ? (p.chinese_name || null) : null,
                    phone: p ? (p.phone_number || null) : null,
                    remarks: r.remarks || null,
                    doctor_name: doctorName,
                    bill_status: 'Scheduled'
                };
                if (docCode) item.doctor_code = docCode;
                if (clinicTag) item.clinic_tag = clinicTag;
                payloads.push(item);
            });

            if (!payloads.length) {
                alert('Import finished. No new rows inserted.\nSkipped existing: ' + skipped +
                    (missingNos.length ? ('\nMissing patient_no: ' + Array.from(new Set(missingNos)).join(', ')) : ''));
                return;
            }

            function tryInsert(list, allowFallbackDoctor, allowFallbackClinic) {
                SB.from('appointments').insert(list).then(function(res) {
                    if (!res.error) {
                        alert('Import finished.\nInserted: ' + list.length +
                            '\nSkipped existing: ' + skipped +
                            (missingNos.length ? ('\nMissing patient_no: ' + Array.from(new Set(missingNos)).join(', ')) : ''));
                        if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
                        if (typeof loadToday === 'function') loadToday();
                        if (typeof loadQueue === 'function') loadQueue();
                        if (typeof loadApptRecords === 'function') loadApptRecords();
                        return;
                    }
                    var msg = String(res.error.message || '');
                    if (allowFallbackDoctor && (msg.indexOf('doctor_code') >= 0 || msg.indexOf('doctor_name') >= 0)) {
                        var noDoctor = list.map(function(x) {
                            var y = Object.assign({}, x);
                            delete y.doctor_code;
                            delete y.doctor_name;
                            return y;
                        });
                        tryInsert(noDoctor, false, allowFallbackClinic);
                        return;
                    }
                    if (allowFallbackClinic && msg.indexOf('clinic_tag') >= 0) {
                        var noClinic = list.map(function(x) {
                            var y = Object.assign({}, x);
                            delete y.clinic_tag;
                            return y;
                        });
                        tryInsert(noClinic, allowFallbackDoctor, false);
                        return;
                    }
                    alert('Import failed: ' + msg);
                });
            }

            tryInsert(payloads, true, true);
        });
    });
}

/** Tesseract language pack: English + Traditional Chinese (Hong Kong schedules). */
var APPT_IMPORT_OCR_LANGS = 'eng+chi_tra';

function apptImportDoctorDisplayForCode(code) {
    var c = String(code || '').trim();
    if (!c || !APP_DOCTORS || !APP_DOCTORS.length) return '';
    var hit = APP_DOCTORS.find(function(d) {
        return String(d.doctor_code || '').trim() === c;
    });
    if (!hit) return '';
    if (typeof doctorDisplayName === 'function') return doctorDisplayName(hit);
    return hit.display_name || hit.english_name || hit.chinese_name || c;
}

/** Match + Appointment doctor scope for import (single-doctor view, not “all”). */
function apptImportDoctorFieldsForRun() {
    var code = String((g('apptImportDoctorCode') && g('apptImportDoctorCode').value) || '').trim();
    var name = String((g('apptImportDoctorName') && g('apptImportDoctorName').value) || '').trim();
    if (!code && typeof plusApptEffectiveDoctorCode === 'function') {
        code = String(plusApptEffectiveDoctorCode() || '').trim();
    }
    if (!code && plusApptActiveDoctorCode && plusApptActiveDoctorCode !== PLUSAPPT_DOCTOR_ALL) {
        code = String(plusApptActiveDoctorCode).trim();
    }
    if (code && !name) name = apptImportDoctorDisplayForCode(code);
    if (!code && name && APP_DOCTORS && APP_DOCTORS.length) {
        var want = String(name).toUpperCase();
        var hit = APP_DOCTORS.find(function(d) {
            var dn = String((d.display_name || d.english_name || d.chinese_name || '')).toUpperCase();
            return dn.indexOf(want) >= 0 || want.indexOf(dn) >= 0;
        });
        if (hit) code = String(hit.doctor_code || '').trim();
    }
    return { code: code, name: name };
}

function apptImportSyncDoctorNameFromSelect() {
    var sel = g('apptImportDoctorCode');
    var nm = g('apptImportDoctorName');
    if (!sel || !nm) return;
    var label = apptImportDoctorDisplayForCode(sel.value);
    if (label) nm.value = label;
}

function apptImportNormalizeFromTextarea() {
    var ta = g('apptImportRowsInput');
    if (!ta) return [];
    var clinicTag = apptImportCurrentClinicTag();
    var rows = apptImportApplyClinicPrefixToRows(
        apptImportParseRows(ta.value || ''),
        clinicTag
    );
    if (rows.length) ta.value = apptImportRowsToPipe(rows);
    apptImportRenderPreview(rows, clinicTag);
    return rows;
}

function apptImportRemarkStartIndex(after) {
    var s = String(after || '');
    if (!s) return -1;
    var en = s.search(/\b(OK\)|WST\)|OK\/|INV|RCT|MOS|CONS|FIT|OPG|C\/U|P\+F)\b/i);
    if (en >= 0) return en;
    return s.search(/(?:^|\s)(OK|WST|覆診|洗牙|脫牙|檢查|新病人|新症|調整|補牙|根管|拔牙|約)\b/);
}

function apptImportLoadTesseractScript(onReady, onError) {
    if (window.Tesseract && window.Tesseract.recognize) {
        if (onReady) onReady();
        return;
    }
    var sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    sc.onload = function() { if (onReady) onReady(); };
    sc.onerror = function() { if (onError) onError(); };
    document.head.appendChild(sc);
}

function apptImportRunOcrOnFile(file, done) {
    apptImportLoadTesseractScript(function() {
        if (!window.Tesseract || !window.Tesseract.recognize) {
            done(new Error('OCR library unavailable'));
            return;
        }
        window.Tesseract.recognize(file, APPT_IMPORT_OCR_LANGS)
            .then(function(res) {
                var text = ((res && res.data && res.data.text) ? res.data.text : '').trim();
                done(null, text);
            })
            .catch(function(e) {
                done(e || new Error('OCR failed'));
            });
    }, function() {
        done(new Error('Could not load OCR library'));
    });
}

/** Soft refresh + Appointment timeline on the doctor used for import. */
function apptImportSoftRefreshPlusAppt(insertDateIso, importClinicTag, preferDoctorCode) {
    if (typeof syncApptPlannerDate === 'function' && insertDateIso) {
        syncApptPlannerDate(insertDateIso, { syncCal: true });
    }
    var clinicId = apptImportClinicIdFromTag(importClinicTag);
    if (clinicId) {
        var plusSel = g('plusApptClinicSelect');
        if (plusSel && plusSel.value !== clinicId) {
            plusApptClinicSyncing = true;
            plusSel.value = clinicId;
            plusApptClinicSyncing = false;
        }
        plusApptActiveClinicId = clinicId;
        if (typeof setWorkingClinic === 'function') {
            setWorkingClinic(clinicId, { syncFilters: true, reloadAppt: false });
        }
        if (typeof populatePlusApptDoctorSelect === 'function') populatePlusApptDoctorSelect();
    }
    var psIn = g('plusApptPsInput');
    if (psIn) psIn.value = '';
    if (typeof plusApptClearSelection === 'function') plusApptClearSelection(true);

    var drCode = String(preferDoctorCode || '').trim();
    var drSel = g('plusApptDoctorSelect');
    if (drSel && drCode) {
        var hasOpt = false;
        for (var oi = 0; oi < drSel.options.length; oi++) {
            if (drSel.options[oi].value === drCode) {
                hasOpt = true;
                break;
            }
        }
        if (hasOpt) {
            drSel.value = drCode;
            plusApptActiveDoctorCode = drCode;
            plusApptAllActiveDoctorCode = '';
            var st = typeof plusApptGetClinicState === 'function' ? plusApptGetClinicState() : null;
            if (st) st.activeDoctor = drCode;
        } else if (typeof plusApptIsAllDoctorsMode === 'function' && plusApptIsAllDoctorsMode()) {
            plusApptAllActiveDoctorCode = drCode;
        }
    }

    function tick() {
        if (typeof apptSectionIsActive === 'function' && apptSectionIsActive()) {
            if (typeof switchApptTab === 'function' &&
                typeof apptActiveTabKey === 'function' &&
                apptActiveTabKey() !== 'plusappt') {
                switchApptTab('plusappt');
            }
        }
        if (typeof plusApptToggleScheduleViews === 'function') plusApptToggleScheduleViews();
        if (typeof plusApptSyncTimelineHead === 'function') plusApptSyncTimelineHead();
        if (typeof renderPlusApptSchedule === 'function') renderPlusApptSchedule();
        if (typeof refreshApptPlannerData === 'function') {
            refreshApptPlannerData({ force: true, forcePlusAppt: true });
        }
        if (typeof loadToday === 'function') loadToday();
        if (typeof loadQueue === 'function') loadQueue();
        if (typeof loadApptRecords === 'function') loadApptRecords();
    }
    requestAnimationFrame(function() {
        requestAnimationFrame(tick);
    });
}

function apptImportSetStatus(msg, isErr) {
    var el = g('apptImportStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = isErr ? '#b91c1c' : '#64748b';
}

function apptImportKnownClinicCodes() {
    var codes = [];
    (APP_CLINICS || []).forEach(function(c) {
        var code = String(c.clinic_code || '').trim().toUpperCase();
        if (code && codes.indexOf(code) < 0) codes.push(code);
    });
    return codes.sort(function(a, b) { return b.length - a.length; });
}

function apptImportPatientClinicTag(p) {
    if (!p) return '';
    var field = typeof PATIENT_CLINIC_TAG_FIELD !== 'undefined'
        ? PATIENT_CLINIC_TAG_FIELD
        : 'clinic_tag';
    return String(p[field] || p.clinic_tag || '').trim().toUpperCase();
}

/** Split OCR/registry token into clinic prefix + 6-digit registry (when digits present). */
function apptImportParsePatientNoToken(raw, defaultClinicTag) {
    var original = String(raw || '').trim();
    var s = original.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!s) {
        return { digits: '', clinic: '', raw: original, explicitClinic: false, compact: '' };
    }
    var clinic = '';
    var explicitClinic = false;
    var codes = apptImportKnownClinicCodes();
    var i;
    for (i = 0; i < codes.length; i++) {
        var code = codes[i];
        if (s.indexOf(code) === 0 && s.length > code.length) {
            clinic = code;
            explicitClinic = true;
            s = s.slice(code.length);
            break;
        }
    }
    var digits = s.replace(/\D/g, '');
    if (digits && /^\d+$/.test(digits)) {
        digits = String(parseInt(digits, 10)).padStart(6, '0');
    } else {
        digits = '';
    }
    if (!clinic) {
        clinic = String(defaultClinicTag || '').trim().toUpperCase();
    }
    return {
        digits: digits,
        clinic: clinic,
        raw: original,
        explicitClinic: explicitClinic,
        compact: original.toUpperCase().replace(/[^A-Z0-9]/g, '')
    };
}

function apptImportNormalizePatientNo(v, defaultClinicTag) {
    var parsed = apptImportParsePatientNoToken(v, defaultClinicTag);
    return parsed.digits || parsed.compact;
}

function apptImportPatientNoVariants(v, defaultClinicTag) {
    var token = apptImportParsePatientNoToken(v, defaultClinicTag);
    var out = [];
    function add(x) {
        x = String(x || '').trim();
        if (x && out.indexOf(x) < 0) out.push(x);
    }
    add(token.raw);
    add(token.compact);
    if (token.digits) {
        add(token.digits);
        if (token.clinic) add(token.clinic + token.digits);
    }
    return out;
}

function apptImportDedupePatientNo(no, defaultClinicTag) {
    var parsed = apptImportParsePatientNoToken(no, defaultClinicTag);
    if (parsed.digits) return parsed.digits;
    return parsed.compact;
}

function apptImportApptDedupeKey(start, patientNo, patientName, useName, clinicTag) {
    var parts = [plusApptNormTime(start), apptImportDedupePatientNo(patientNo, clinicTag)];
    if (useName !== false) {
        parts.push(String(patientName || '').trim().toUpperCase());
    }
    return parts.join('|');
}

function apptImportBuildPatientQueryNos(uniqNos, importClinicTag) {
    var queryNos = [];
    (uniqNos || []).forEach(function(no) {
        apptImportPatientNoVariants(no, importClinicTag).forEach(function(x) {
            if (queryNos.indexOf(x) < 0) queryNos.push(x);
        });
    });
    return queryNos;
}

function apptImportIndexPush(map, key, patient) {
    if (!key || !patient) return;
    if (!map[key]) map[key] = [];
    if (!map[key].some(function(x) { return String(x.id) === String(patient.id); })) {
        map[key].push(patient);
    }
}

function apptImportIndexPatients(patRows) {
    var byExactNo = {};
    var byClinicDigits = {};
    var byDigits = {};
    (patRows || []).forEach(function(p) {
        var noRaw = String(p.patient_no || '').trim();
        var noUp = noRaw.toUpperCase();
        apptImportIndexPush(byExactNo, noUp, p);
        if (noRaw) apptImportIndexPush(byExactNo, noRaw, p);

        var pClinic = apptImportPatientClinicTag(p);
        var parsed = apptImportParsePatientNoToken(noRaw, pClinic);
        if (parsed.digits) {
            apptImportIndexPush(byDigits, parsed.digits, p);
            if (pClinic) apptImportIndexPush(byClinicDigits, pClinic + '|' + parsed.digits, p);
            if (parsed.explicitClinic && parsed.clinic) {
                apptImportIndexPush(byClinicDigits, parsed.clinic + '|' + parsed.digits, p);
            }
        }
    });
    return { byExactNo: byExactNo, byClinicDigits: byClinicDigits, byDigits: byDigits };
}

function apptImportNameScore(importName, patient) {
    var want = String(importName || '').trim().toUpperCase()
        .replace(/[^A-Z0-9\s\u4e00-\u9fff]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!want) return 0;
    var names = [patient.full_name, patient.chinese_name].map(function(n) {
        return String(n || '').trim().toUpperCase()
            .replace(/[^A-Z0-9\s\u4e00-\u9fff]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    });
    var best = 0;
    names.forEach(function(n) {
        if (!n) return;
        if (n === want) {
            best = Math.max(best, 100);
            return;
        }
        if (n.indexOf(want) >= 0 || want.indexOf(n) >= 0) {
            best = Math.max(best, 75);
            return;
        }
        var wt = want.split(' ').filter(Boolean);
        var nt = n.split(' ').filter(Boolean);
        if (!wt.length) return;
        var hit = 0;
        wt.forEach(function(w) {
            if (nt.some(function(t) { return t === w || t.indexOf(w) >= 0 || w.indexOf(t) >= 0; })) {
                hit++;
            }
        });
        best = Math.max(best, Math.round(60 * hit / wt.length));
    });
    return best;
}

function apptImportPickBestCandidate(candidates, importName, importClinicTag) {
    if (!candidates || !candidates.length) {
        return { patient: null, reason: 'missing' };
    }
    if (candidates.length === 1) {
        return { patient: candidates[0], reason: 'unique' };
    }
    var clinic = String(importClinicTag || '').trim().toUpperCase();
    var clinicPool = candidates.filter(function(p) {
        var pt = apptImportPatientClinicTag(p);
        return !clinic || !pt || pt === clinic;
    });
    var pool = clinicPool.length ? clinicPool : candidates;
    if (pool.length === 1) {
        return { patient: pool[0], reason: 'clinic' };
    }
    var scored = pool.map(function(p) {
        return { p: p, score: apptImportNameScore(importName, p) };
    }).sort(function(a, b) { return b.score - a.score; });
    if (scored[0].score >= 70 && (!scored[1] || scored[0].score - scored[1].score >= 12)) {
        return { patient: scored[0].p, reason: 'name' };
    }
    return { patient: null, reason: 'ambiguous', count: pool.length };
}

function apptImportClinicHintFromRemarks(remarks) {
    var s = String(remarks || '').trim().toUpperCase();
    var m = s.match(/\b(?:OK|WST)\/([A-Z]{2,5})\)/);
    if (m) return String(m[1] || '').trim().toUpperCase();
    var codes = apptImportKnownClinicCodes();
    var i;
    for (i = 0; i < codes.length; i++) {
        var code = codes[i];
        if (s.indexOf('/' + code) >= 0 || s.indexOf(code + ')') >= 0) return code;
    }
    return '';
}

function apptImportEffectiveClinicForRow(no, importClinicTag, remarks) {
    var token = apptImportParsePatientNoToken(no, importClinicTag);
    if (token.explicitClinic) return token.clinic;
    var hint = apptImportClinicHintFromRemarks(remarks);
    if (hint) return hint;
    return String(importClinicTag || '').trim().toUpperCase();
}

function apptImportResolvePatient(no, importName, importClinicTag, index, remarks) {
    if (!no) return { patient: null, reason: 'missing' };
    var clinic = apptImportEffectiveClinicForRow(no, importClinicTag, remarks);
    var token = apptImportParsePatientNoToken(no, clinic);
    if (!token.digits && !token.compact) return { patient: null, reason: 'missing' };
    var rawKeys = [String(no || '').trim(), String(no || '').trim().toUpperCase(), token.compact];
    var ki;
    for (ki = 0; ki < rawKeys.length; ki++) {
        if (index.byExactNo[rawKeys[ki]]) {
            var exactPick = apptImportPickBestCandidate(
                index.byExactNo[rawKeys[ki]], importName, clinic
            );
            if (exactPick.patient) return exactPick;
            if (exactPick.reason === 'ambiguous') return exactPick;
        }
    }

    if (token.digits && clinic && index.byClinicDigits[clinic + '|' + token.digits]) {
        var clinicPick = apptImportPickBestCandidate(
            index.byClinicDigits[clinic + '|' + token.digits], importName, clinic
        );
        if (clinicPick.patient) return clinicPick;
        if (clinicPick.reason === 'ambiguous') return clinicPick;
    }

    if (token.digits && index.byDigits[token.digits]) {
        var digitPool = index.byDigits[token.digits];
        if (clinic) {
            var scoped = digitPool.filter(function(p) {
                var pt = apptImportPatientClinicTag(p);
                return !pt || pt === clinic;
            });
            if (scoped.length) {
                var scopedPick = apptImportPickBestCandidate(scoped, importName, clinic);
                if (scopedPick.patient) return scopedPick;
                if (scopedPick.reason === 'ambiguous') return scopedPick;
            }
        }
        if (digitPool.length === 1) {
            return { patient: digitPool[0], reason: 'digits' };
        }
        var namePick = apptImportPickBestCandidate(digitPool, importName, clinic);
        if (namePick.patient && namePick.reason === 'name') return namePick;
        return { patient: null, reason: 'ambiguous', count: digitPool.length };
    }

    return { patient: null, reason: 'missing' };
}

function apptImportAppointmentInClinic(appt, clinicTag) {
    var tag = String(clinicTag || '').trim().toUpperCase();
    if (!tag) return true;
    var field = typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined'
        ? APPOINTMENT_CLINIC_TAG_FIELD
        : 'clinic_tag';
    var at = String(appt[field] || appt.clinic_tag || '').trim().toUpperCase();
    return !at || at === tag;
}

function apptImportSummarySuffix(missing, ambiguous, skipped) {
    var parts = [];
    if (skipped) parts.push('Skipped existing: ' + skipped);
    if (missing && missing.length) {
        parts.push('Missing: ' + Array.from(new Set(missing)).join(', '));
    }
    if (ambiguous && ambiguous.length) {
        parts.push('Ambiguous: ' + Array.from(new Set(ambiguous)).join(', '));
    }
    return parts.length ? (' | ' + parts.join(' | ')) : '';
}

function apptImportClinicIdFromTag(clinicTag) {
    var tag = String(clinicTag || '').trim().toUpperCase();
    if (!tag || !APP_CLINICS || !APP_CLINICS.length) return '';
    var hit = APP_CLINICS.find(function(c) {
        return String(c.clinic_code || '').trim().toUpperCase() === tag;
    });
    return hit ? String(hit.id) : '';
}

function apptImportTo24(hhmm, ampm) {
    var p = String(hhmm || '').replace('.', ':').split(':');
    var h = parseInt(p[0], 10);
    var m = parseInt(p[1] || '0', 10);
    var ap = String(ampm || '').trim().toUpperCase();
    if (ap === 'AM' || ap === 'PM') {
        if (h === 12) h = 0;
        if (ap === 'PM') h += 12;
    }
    if (isNaN(h) || isNaN(m)) return '';
    return pad(h % 24) + ':' + pad(m % 60);
}

function apptImportTimeToMin(t) {
    var p = String(t || '').split(':');
    return (parseInt(p[0] || '0', 10) * 60) + (parseInt(p[1] || '0', 10) || 0);
}

function apptImportParseRows(raw, noFallback) {
    var source = String(raw || '');
    var lines = source.split(/\r?\n/).map(function(x) { return x.trim(); }).filter(Boolean);
    var out = [];
    lines.forEach(function(line) {
        if (!line) return;
        if (line.indexOf('|') >= 0) {
            var c = line.split('|');
            if (c.length < 4) return;
            var st = plusApptNormTime(c[0]);
            var du = parseInt(c[1] || '0', 10);
            if (!st) return;
            if (!du || du < 1) du = PLUSAPPT_SLOT_MIN;
            out.push({
                start: st,
                dur: du,
                patient_no: String(c[2] || '').trim() || '000000',
                patient_name: String(c[3] || '').trim() || 'NEW PATIENT',
                remarks: String(c.slice(4).join('|') || '').trim()
            });
            return;
        }

        var l = line
            .replace(/[–—－]/g, '-')
            .replace(/[：]/g, ':')
            .replace(/\t+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        var tm = l.match(/(\d{1,2}[:.]\d{2})\s*(AM|PM)?\s*[-~]\s*(\d{1,2}[:.]\d{2})\s*(AM|PM)?/i);
        var t1 = l.match(/(^|\s)(\d{1,2}[:.]\d{2})\s*(AM|PM)\b/i);
        if (!tm && !t1) return;
        var s = tm
            ? apptImportTo24(tm[1], tm[2] || tm[4] || '')
            : apptImportTo24(t1[2], t1[3]);
        var e = tm
            ? apptImportTo24(tm[3], tm[4] || tm[2] || '')
            : '';
        if (!s) return;
        var dur = PLUSAPPT_SLOT_MIN;
        if (s && e) {
            var dm = apptImportTimeToMin(e) - apptImportTimeToMin(s);
            if (dm > 0) dur = dm;
        }

        var rest = tm
            ? (l.slice(0, tm.index) + ' ' + l.slice(tm.index + tm[0].length)).trim()
            : l.replace(t1[0], ' ').trim();
        var dm2 = rest.match(/(\d{1,3})\s*(MIN|MINS|HR|HRS|H)\b/i);
        if (dm2) {
            var dv = parseInt(dm2[1], 10);
            var unit = String(dm2[2] || '').toUpperCase();
            if (unit.indexOf('H') === 0) dv *= 60;
            if (dv > 0) dur = dv;
            rest = (rest.slice(0, dm2.index) + ' ' + rest.slice(dm2.index + dm2[0].length)).trim();
        }

        var noM = rest.match(/\b([A-Z]{0,3}\d{4,})\b/i) ||
            rest.match(/(?:^|\s)(\d{6})(?:\s|$)/);
        var no = noM ? String(noM[1] || '').toUpperCase() : '000000';
        var after = noM ? rest.slice(rest.indexOf(noM[0]) + noM[0].length).trim() : rest;
        var remarkStart = apptImportRemarkStartIndex(after);
        var nm = '';
        var rm = '';
        if (remarkStart >= 0) {
            nm = after.slice(0, remarkStart).trim();
            rm = after.slice(remarkStart).trim();
        } else {
            var seg = after.split(/\s{2,}/).filter(Boolean);
            if (seg.length >= 2) {
                nm = seg[0];
                rm = seg.slice(1).join(' ');
            } else {
                nm = after;
            }
        }
        if (!nm) nm = (no === '000000' ? 'NEW PATIENT' : '');
        out.push({
            start: s,
            dur: dur,
            patient_no: no || '000000',
            patient_name: nm || 'NEW PATIENT',
            remarks: rm || ''
        });
    });
    if (!noFallback && !out.length && source) {
        var norm = source
            .replace(/[–—－]/g, '-')
            .replace(/[：]/g, ':')
            .replace(/\t+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        var rgx = /(\d{1,2}[:.]\d{2}\s*(?:AM|PM)?\s*[-~]\s*\d{1,2}[:.]\d{2}\s*(?:AM|PM)?)([\s\S]*?)(?=(\d{1,2}[:.]\d{2}\s*(?:AM|PM)?\s*[-~]\s*\d{1,2}[:.]\d{2}\s*(?:AM|PM)?)|$)/gi;
        var m;
        while ((m = rgx.exec(norm))) {
            var line2 = (m[1] + ' ' + (m[2] || '')).trim();
            var partial = apptImportParseRows(line2.split(/\s{2,}/).join('\n'), true);
            if (partial && partial.length) out = out.concat(partial);
            if (out.length > 500) break;
        }
    }
    return out;
}

function apptImportCurrentClinicTag() {
    return String((g('apptImportClinicTag') && g('apptImportClinicTag').value) || '').trim().toUpperCase();
}

/** Prefix bare scanned digits with the import modal clinic tag (e.g. PY + 000243 → PY000243). */
function apptImportApplyClinicPrefixToNo(no, clinicTag) {
    var raw = String(no || '').trim();
    if (!raw || raw === '000000') return raw;
    var tag = String(clinicTag || '').trim().toUpperCase();
    if (!tag) return raw;
    var token = apptImportParsePatientNoToken(raw, tag);
    if (!token.digits) return raw;
    return tag + token.digits;
}

function apptImportApplyClinicPrefixToRows(rows, clinicTag) {
    var tag = String(clinicTag || '').trim().toUpperCase();
    return (rows || []).map(function(r) {
        return {
            start: r.start,
            dur: r.dur,
            patient_no: apptImportApplyClinicPrefixToNo(r.patient_no, tag),
            patient_name: r.patient_name,
            remarks: r.remarks
        };
    });
}

function apptImportRowsToPipe(rows) {
    return (rows || []).map(function(r) {
        return [r.start, r.dur, r.patient_no || '', r.patient_name || '', r.remarks || ''].join('|');
    }).join('\n');
}

function apptImportPreviewStatus(row, importClinicTag) {
    if (!row || !row.start) return 'invalid';
    var no = String(row.patient_no || '').trim().toUpperCase();
    if (!no || no === '000000') return 'walk-in';
    var tag = String(importClinicTag || '').trim().toUpperCase();
    var token = apptImportParsePatientNoToken(no, tag);
    if (token.explicitClinic || (tag && no.indexOf(tag) === 0 && token.digits)) {
        return 'prefixed-' + (token.explicitClinic ? token.clinic : tag);
    }
    if (token.digits) return 'patient-no';
    return 'invalid-no';
}

function apptImportRenderPreview(rows, importClinicTag) {
    var tb = g('apptImportPreviewBody');
    if (!tb) return;
    var clinicTag = importClinicTag || apptImportCurrentClinicTag();
    apptImportPreviewRows = apptImportApplyClinicPrefixToRows((rows || []).map(function(r) {
        return {
            start: plusApptNormTime(r.start),
            dur: parseInt(r.dur || '0', 10) || PLUSAPPT_SLOT_MIN,
            patient_no: String(r.patient_no || '').trim(),
            patient_name: String(r.patient_name || '').trim(),
            remarks: String(r.remarks || '').trim()
        };
    }), clinicTag);
    if (!rows || !rows.length) {
        tb.innerHTML = '<tr><td colspan="7" style="padding:10px;color:#94a3b8;">No preview rows detected.</td></tr>';
        return;
    }
    var html = '';
    apptImportPreviewRows.forEach(function(r, i) {
        var st = apptImportPreviewStatus(r, clinicTag);
        var stColor = '#64748b';
        if (st === 'walk-in') stColor = '#b45309';
        else if (st.indexOf('invalid') === 0) stColor = '#b91c1c';
        else if (st.indexOf('prefixed-') === 0) stColor = '#166534';
        html += '<tr>' +
            '<td style="padding:6px;border-bottom:1px solid #f1f5f9;">' + (i + 1) + '</td>' +
            '<td style="padding:6px;border-bottom:1px solid #f1f5f9;"><input data-prev-row="' + i + '" data-prev-col="start" value="' + esc(r.start || '') + '" style="width:82px;padding:4px;border:1px solid #cbd5e1;border-radius:6px;"></td>' +
            '<td style="padding:6px;border-bottom:1px solid #f1f5f9;"><input data-prev-row="' + i + '" data-prev-col="dur" value="' + esc(String(r.dur || '')) + '" style="width:54px;padding:4px;border:1px solid #cbd5e1;border-radius:6px;"></td>' +
            '<td style="padding:6px;border-bottom:1px solid #f1f5f9;"><input data-prev-row="' + i + '" data-prev-col="patient_no" value="' + esc(r.patient_no || '') + '" style="width:94px;padding:4px;border:1px solid #cbd5e1;border-radius:6px;"></td>' +
            '<td style="padding:6px;border-bottom:1px solid #f1f5f9;"><input data-prev-row="' + i + '" data-prev-col="patient_name" value="' + esc(r.patient_name || '') + '" style="width:170px;padding:4px;border:1px solid #cbd5e1;border-radius:6px;"></td>' +
            '<td style="padding:6px;border-bottom:1px solid #f1f5f9;"><input data-prev-row="' + i + '" data-prev-col="remarks" value="' + esc(r.remarks || '') + '" style="width:260px;padding:4px;border:1px solid #cbd5e1;border-radius:6px;"></td>' +
            '<td style="padding:6px;border-bottom:1px solid #f1f5f9;color:' + stColor + ';font-weight:700;">' + esc(st) + '</td>' +
        '</tr>';
    });
    tb.innerHTML = html;
    tb.querySelectorAll('input[data-prev-row]').forEach(function(inp) {
        inp.addEventListener('input', function() {
            var i = parseInt(inp.getAttribute('data-prev-row') || '-1', 10);
            var col = inp.getAttribute('data-prev-col') || '';
            if (i < 0 || i >= apptImportPreviewRows.length || !col) return;
            var val = String(inp.value || '');
            if (col === 'dur') {
                var dv = parseInt(val || '0', 10);
                apptImportPreviewRows[i][col] = (dv > 0 ? dv : PLUSAPPT_SLOT_MIN);
                inp.value = String(apptImportPreviewRows[i][col]);
            } else if (col === 'start') {
                apptImportPreviewRows[i][col] = plusApptNormTime(val);
                inp.value = apptImportPreviewRows[i][col];
            } else if (col === 'patient_no') {
                apptImportPreviewRows[i][col] = apptImportApplyClinicPrefixToNo(val.trim(), clinicTag);
                inp.value = apptImportPreviewRows[i][col];
            } else {
                apptImportPreviewRows[i][col] = val.trim();
            }
            var st2 = apptImportPreviewStatus(apptImportPreviewRows[i], clinicTag);
            var td = inp.closest('tr') ? inp.closest('tr').lastElementChild : null;
            if (td) {
                td.textContent = st2;
                td.style.color = st2 === 'walk-in' ? '#b45309'
                    : (st2.indexOf('invalid') === 0 ? '#b91c1c'
                        : (st2.indexOf('prefixed-') === 0 ? '#166534' : '#64748b'));
            }
        });
    });
}

function apptImportRowsForInsert() {
    var clinicTag = apptImportCurrentClinicTag();
    if (apptImportPreviewRows && apptImportPreviewRows.length) {
        return apptImportApplyClinicPrefixToRows(
            apptImportPreviewRows.map(function(r) {
                return {
                    start: plusApptNormTime(r.start),
                    dur: parseInt(r.dur || '0', 10) || PLUSAPPT_SLOT_MIN,
                    patient_no: String(r.patient_no || '').trim() || '000000',
                    patient_name: String(r.patient_name || '').trim() || 'NEW PATIENT',
                    remarks: String(r.remarks || '').trim()
                };
            }),
            clinicTag
        ).filter(function(r) { return !!r.start; });
    }
    var ta = g('apptImportRowsInput');
    return apptImportApplyClinicPrefixToRows(
        apptImportParseRows(ta ? ta.value : ''),
        apptImportCurrentClinicTag()
    );
}

function apptImportPopulateDoctorSelect() {
    var sel = g('apptImportDoctorCode');
    if (!sel) return;
    var html = '<option value="">(auto / none)</option>';
    (APP_DOCTORS || []).forEach(function(d) {
        var code = String(d.doctor_code || '').trim();
        if (!code) return;
        var nm = (typeof doctorDisplayName === 'function')
            ? doctorDisplayName(d)
            : (d.display_name || d.english_name || d.chinese_name || code);
        html += '<option value="' + esc(code) + '">' + esc(code + ' - ' + nm) + '</option>';
    });
    sel.innerHTML = html;
}

function openApptImageImportModal() {
    bindApptImportModalOnce();
    apptImportPopulateDoctorSelect();
    var d = g('apptImportDate');
    if (d && !d.value) d.value = plusApptDate || todayISO();
    var ct = g('apptImportClinicTag');
    if (ct && !ct.value) {
        var cid = plusApptActiveClinicId ||
            (typeof currentClinicId !== 'undefined' ? currentClinicId : '');
        var rec = (cid && typeof clinicRecordFromId === 'function')
            ? clinicRecordFromId(cid)
            : null;
        ct.value = rec
            ? (String(rec.clinic_code || '').trim() ||
                (typeof currentClinicCodeForTagging === 'function'
                    ? (currentClinicCodeForTagging() || 'MK')
                    : 'MK'))
            : ((typeof currentClinicCodeForTagging === 'function')
                ? (currentClinicCodeForTagging() || 'MK')
                : 'MK');
    }
    var ds = g('apptImportDoctorCode');
    var effDr = typeof plusApptEffectiveDoctorCode === 'function'
        ? plusApptEffectiveDoctorCode()
        : '';
    if (ds) {
        if (effDr) ds.value = effDr;
        else if (plusApptActiveDoctorCode && plusApptActiveDoctorCode !== PLUSAPPT_DOCTOR_ALL) {
            ds.value = plusApptActiveDoctorCode;
        }
    }
    apptImportSyncDoctorNameFromSelect();
    apptImportPreviewRows = [];
    apptImportSetStatus('');
    apptImportRenderPreview([]);
    openModal('apptImageImportModal');
}

function bindApptImportModalOnce() {
    if (apptImportModalBound) return;
    apptImportModalBound = true;
    var closeBtn = g('closeApptImageImportModal');
    var cancelBtn = g('apptImportCancelBtn');
    if (closeBtn) closeBtn.addEventListener('click', function() { closeModal('apptImageImportModal'); });
    if (cancelBtn) cancelBtn.addEventListener('click', function() { closeModal('apptImageImportModal'); });

    var clinicTagInput = g('apptImportClinicTag');
    if (clinicTagInput && !clinicTagInput.dataset.apptImportBound) {
        clinicTagInput.dataset.apptImportBound = '1';
        clinicTagInput.addEventListener('input', function() {
            if (!apptImportPreviewRows || !apptImportPreviewRows.length) return;
            var tag = apptImportCurrentClinicTag();
            apptImportPreviewRows = apptImportApplyClinicPrefixToRows(apptImportPreviewRows, tag);
            apptImportRenderPreview(apptImportPreviewRows, tag);
            var ta = g('apptImportRowsInput');
            if (ta) ta.value = apptImportRowsToPipe(apptImportPreviewRows);
        });
    }

    var importDrSel = g('apptImportDoctorCode');
    if (importDrSel && !importDrSel.dataset.apptImportBound) {
        importDrSel.dataset.apptImportBound = '1';
        importDrSel.addEventListener('change', apptImportSyncDoctorNameFromSelect);
    }

    var parseBtn = g('apptImportParseBtn');
    if (parseBtn) {
        parseBtn.addEventListener('click', function() {
            try {
                apptImportSetStatus('Normalizing lines...');
                var rows = apptImportNormalizeFromTextarea();
                if (!rows.length) {
                    apptImportSetStatus('No valid appointment rows detected.', true);
                    return;
                }
                var clinicTag = apptImportCurrentClinicTag();
                apptImportSetStatus('Normalized ' + rows.length + ' rows.' +
                    (clinicTag ? (' Clinic prefix: ' + clinicTag + '.') : ''));
            } catch (e) {
                apptImportSetStatus('Normalize failed: ' + (e && e.message ? e.message : String(e)), true);
                apptImportRenderPreview([]);
            }
        });
    }

    var previewBtn = g('apptImportPreviewBtn');
    if (previewBtn) {
        previewBtn.addEventListener('click', function() {
            try {
                var ta = g('apptImportRowsInput');
                var clinicTag = apptImportCurrentClinicTag();
                var rows = apptImportApplyClinicPrefixToRows(
                    apptImportParseRows(ta ? ta.value : ''),
                    clinicTag
                );
                if (ta && rows.length) ta.value = apptImportRowsToPipe(rows);
                apptImportRenderPreview(rows, clinicTag);
                apptImportSetStatus(
                    rows.length ? ('Preview ready: ' + rows.length + ' rows.') : 'No valid rows to preview.',
                    !rows.length
                );
            } catch (e) {
                apptImportSetStatus('Preview failed: ' + (e && e.message ? e.message : String(e)), true);
                apptImportRenderPreview([]);
            }
        });
    }

    var ocrBtn = g('apptImportOcrBtn');
    if (ocrBtn) {
        ocrBtn.addEventListener('click', function() {
            var fi = g('apptImportImageFile');
            var ta = g('apptImportRowsInput');
            if (!fi || !fi.files || !fi.files[0] || !ta) {
                apptImportSetStatus('Please choose an image file first.', true);
                return;
            }
            var file = fi.files[0];
            ocrBtn.disabled = true;
            apptImportSetStatus('OCR running (English + Traditional Chinese)... up to ~60s.');
            apptImportRunOcrOnFile(file, function(err, text) {
                ocrBtn.disabled = false;
                if (err) {
                    apptImportSetStatus('OCR failed: ' + (err.message || String(err)), true);
                    return;
                }
                ta.value = text || '';
                try {
                    var rows = apptImportNormalizeFromTextarea();
                    if (rows.length) {
                        apptImportSetStatus('OCR done — ' + rows.length +
                            ' row(s) normalized (繁體中文 + English). Review preview, then Import.');
                    } else {
                        apptImportRenderPreview([]);
                        apptImportSetStatus(
                            'OCR done but no rows parsed. Edit text or click Normalize lines.',
                            true
                        );
                    }
                } catch (e2) {
                    apptImportRenderPreview([]);
                    apptImportSetStatus('OCR text captured; normalize failed: ' +
                        (e2 && e2.message ? e2.message : String(e2)), true);
                }
            });
        });
    }

    var runBtn = g('apptImportRunBtn');
    if (runBtn) {
        runBtn.addEventListener('click', function() {
            var dateIso = String((g('apptImportDate') && g('apptImportDate').value) || '').trim();
            var clinicTag = String((g('apptImportClinicTag') && g('apptImportClinicTag').value) || '').trim().toUpperCase();
            var drFields = apptImportDoctorFieldsForRun();
            var doctorCode = drFields.code;
            var doctorName = drFields.name;
            var rows = apptImportRowsForInsert();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
                apptImportSetStatus('Invalid date format.', true);
                return;
            }
            if (!rows.length) {
                apptImportSetStatus('No valid rows to import.', true);
                return;
            }
            apptImportSetStatus('Importing ' + rows.length + ' rows...');
            runBtn.disabled = true;
            importApptRowsGeneric(dateIso, clinicTag, doctorName, doctorCode, rows, function(msg, err) {
                runBtn.disabled = false;
                apptImportSetStatus(msg, !!err);
                if (!err) closeModal('apptImageImportModal');
            });
        });
    }
}

function importApptRowsGeneric(dateIso, clinicTag, doctorName, doctorCodeOverride, rows, done) {
    var nos = (rows || [])
        .map(function(r) { return String(r.patient_no || '').trim(); })
        .filter(function(no) { return no && no !== '000000'; });
    var uniqNos = Array.from(new Set(nos));

    var docCode = String(doctorCodeOverride || '').trim();
    if (!docCode && APP_DOCTORS && APP_DOCTORS.length && doctorName) {
        var hit = APP_DOCTORS.find(function(d) {
            var dn = String((d.display_name || d.english_name || d.chinese_name || '')).toUpperCase();
            return dn.indexOf(String(doctorName || '').toUpperCase()) >= 0;
        });
        if (hit) docCode = String(hit.doctor_code || '').trim();
    }

    function finish(msg, err) {
        if (done) done(msg, err);
    }

    function afterImportRefresh(insertDateIso, importClinicTag, preferDoctorCode) {
        apptImportSoftRefreshPlusAppt(insertDateIso, importClinicTag, preferDoctorCode);
    }

    var queryNos = apptImportBuildPatientQueryNos(uniqNos, clinicTag);
    var patientTagField = typeof PATIENT_CLINIC_TAG_FIELD !== 'undefined'
        ? PATIENT_CLINIC_TAG_FIELD
        : 'clinic_tag';

    var q = SB.from('patients').select(
        'id,patient_no,full_name,chinese_name,phone_number,' + patientTagField
    );
    if (queryNos.length) q = q.in('patient_no', queryNos);
    q.then(function(pr) {
        var index = apptImportIndexPatients(pr && pr.data ? pr.data : []);

        SB.from('appointments')
            .select('id,start_time,patient_no,patient_name,clinic_tag')
            .eq('date', dateIso)
        .then(function(er) {
            var ex = {};
            (er && er.data ? er.data : []).forEach(function(a) {
                if (!apptImportAppointmentInClinic(a, clinicTag)) return;
                var st = plusApptNormTime(a.start_time);
                ex[apptImportApptDedupeKey(st, a.patient_no, a.patient_name, true, clinicTag)] = true;
                if (apptImportDedupePatientNo(a.patient_no, clinicTag)) {
                    ex[apptImportApptDedupeKey(st, a.patient_no, '', false, clinicTag)] = true;
                }
            });
            var missing = [];
            var ambiguous = [];
            var skipped = 0;
            var payloads = [];
            (rows || []).forEach(function(r) {
                var no = String(r.patient_no || '').trim();
                var isWalkin = !no || no === '000000';
                var resolved = isWalkin
                    ? { patient: null, reason: 'walk-in' }
                    : apptImportResolvePatient(no, r.patient_name, clinicTag, index, r.remarks);
                var p = resolved.patient;
                if (!isWalkin && !p) {
                    if (resolved.reason === 'ambiguous') ambiguous.push(no);
                    else missing.push(no);
                    return;
                }
                var st = plusApptNormTime(r.start);
                if (!st) return;
                var du = parseInt(r.dur || '0', 10);
                if (!du || du < 1) du = PLUSAPPT_SLOT_MIN;
                var name = p ? (p.full_name || r.patient_name || '') : (r.patient_name || 'NEW PATIENT');
                var pno = p ? (p.patient_no || no) : null;
                var dedupeNo = pno || no;
                var key = apptImportApptDedupeKey(st, dedupeNo, name, true, clinicTag);
                var keyStrict = apptImportApptDedupeKey(st, dedupeNo, '', false, clinicTag);
                if (ex[key] || ex[keyStrict]) { skipped++; return; }
                ex[key] = true;
                if (apptImportDedupePatientNo(dedupeNo, clinicTag)) ex[keyStrict] = true;
                var rowClinicTag = isWalkin
                    ? clinicTag
                    : apptImportEffectiveClinicForRow(no, clinicTag, r.remarks);
                var item = {
                    date: dateIso,
                    start_time: st,
                    end_time: addMins(st, du),
                    duration: du,
                    patient_id: p ? p.id : null,
                    patient_no: pno,
                    patient_name: name || null,
                    patient_chinese_name: p ? (p.chinese_name || null) : null,
                    phone: p ? (p.phone_number || null) : null,
                    remarks: r.remarks || null,
                    doctor_name: doctorName || null,
                    bill_status: 'Scheduled'
                };
                if (docCode) item.doctor_code = docCode;
                if (rowClinicTag) item.clinic_tag = rowClinicTag;
                else if (clinicTag) item.clinic_tag = clinicTag;
                payloads.push(item);
            });

            if (!payloads.length) {
                afterImportRefresh(dateIso, clinicTag, docCode);
                finish('No new rows inserted.' + apptImportSummarySuffix(missing, ambiguous, skipped), false);
                return;
            }

            function tryInsert(list, allowDoctorFallback, allowClinicFallback) {
                SB.from('appointments').insert(list).then(function(res) {
                    if (!res.error) {
                        afterImportRefresh(dateIso, clinicTag, docCode);
                        finish('Inserted: ' + list.length + apptImportSummarySuffix(missing, ambiguous, skipped), false);
                        return;
                    }
                    var msg = String(res.error.message || '');
                    if (allowDoctorFallback && (msg.indexOf('doctor_code') >= 0 || msg.indexOf('doctor_name') >= 0)) {
                        var noDoctor = list.map(function(x) {
                            var y = Object.assign({}, x);
                            delete y.doctor_code;
                            delete y.doctor_name;
                            return y;
                        });
                        tryInsert(noDoctor, false, allowClinicFallback);
                        return;
                    }
                    if (allowClinicFallback && msg.indexOf('clinic_tag') >= 0) {
                        var noClinic = list.map(function(x) {
                            var y = Object.assign({}, x);
                            delete y.clinic_tag;
                            return y;
                        });
                        tryInsert(noClinic, allowDoctorFallback, false);
                        return;
                    }
                    finish('Import failed: ' + msg, true);
                });
            }
            tryInsert(payloads, true, true);
        });
    });
}

function showPlusApptTab() {
    bindPlusApptTabOnce();
    populatePlusApptClinicSelect();
    var apptSel = g('apptClinicSelect');
    var plusClinic = g('plusApptClinicSelect');
    if (apptSel && apptSel.value && plusClinic && plusClinic.value !== apptSel.value) {
        plusApptClinicSyncing = true;
        plusClinic.value = apptSel.value;
        plusApptActiveClinicId = apptSel.value;
        plusApptClinicSyncing = false;
        if (typeof setWorkingClinic === 'function') {
            setWorkingClinic(apptSel.value, { syncFilters: true, reloadAppt: false });
        }
    }
    plusApptRestoreClinicUiState(plusApptActiveClinicId);
    if (!plusApptDate && calDate) {
        syncApptPlannerDate(
            calDate.getFullYear() + '-' + pad(calDate.getMonth() + 1) + '-' + pad(calDate.getDate()),
            { syncCal: false }
        );
    } else if (plusApptDate) {
        syncApptPlannerDate(plusApptDate, { syncCal: true });
    }
    populatePlusApptDoctorSelect();
    plusApptApplyClinicTheme();
    plusApptApplyScheduleLayout();
    plusApptToggleScheduleViews();
    renderPlusApptMiniCal();
    refreshApptPlannerData();
    plusApptRenderTransferLog();
    plusApptRefreshSidebarToolTitles();
    plusApptSyncClearModeUi();
    plusApptApplyClearModeLayout();
    plusApptSyncSidebarToggleUi();
    plusApptApplySidebarLayout();
    if (typeof applyI18nInRoot === 'function') {
        var tab = g('tab-plusappt');
        if (tab) applyI18nInRoot(tab);
    }
    plusApptSyncSidebarToggleUi();
}

function showCalendarTab() {
    if (plusApptDate) {
        syncApptPlannerDate(plusApptDate, { syncCal: true });
    } else if (calDate) {
        syncApptPlannerDate(
            calDate.getFullYear() + '-' + pad(calDate.getMonth() + 1) + '-' + pad(calDate.getDate()),
            { syncCal: true }
        );
    } else {
        syncApptPlannerDate(todayISO(), { syncCal: true });
    }
    refreshApptPlannerData();
}

function initPlusApptTab() {
    showPlusApptTab();
}

// ════════════════════════════════════════════════════════════════
// AUTO REFRESH — schedule re-render is paused while the user is typing on
// + Appointment, Today, or Calendar; deferred refresh runs on blur / modal close.
// ════════════════════════════════════════════════════════════════
var apptAutoRefreshTimer = null;
var DEFAULT_QUEUE_REFRESH_MS = 30000;

function apptSectionIsActive() {
    if (typeof sectionVisible === 'function') {
        return sectionVisible('appointmentSection');
    }
    var sec = g('appointmentSection');
    if (!sec) return false;
    if (sec.offsetParent !== null) return true;
    var d = sec.style.display;
    return d !== 'none' && d !== '';
}

function apptActiveTabKey() {
    var t = document.querySelector('#appointmentSection .appt-tab.active');
    return t && t.dataset ? t.dataset.tab : null;
}

function apptAutoRefreshTick() {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!apptSectionIsActive()) return;
    var tab = apptActiveTabKey();
    if (tab === 'queue') loadQueue();
    else if (tab === 'today') loadToday();
    else if (tab === 'plusappt' || tab === 'calendar') refreshApptPlannerData();
}

function stopApptAutoRefresh() {
    if (apptAutoRefreshTimer) {
        clearInterval(apptAutoRefreshTimer);
        apptAutoRefreshTimer = null;
    }
}

function fetchQueueRefreshIntervalMs(done) {
    var fallback = DEFAULT_QUEUE_REFRESH_MS;
    if (!SB || typeof SB.from !== 'function') {
        if (done) done(fallback);
        return;
    }
    SB.from('program_settings')
        .select('setting_value')
        .eq('setting_key', 'queue_refresh_interval')
        .limit(1)
        .then(function(r) {
            var ms = fallback;
            if (!r.error && r.data && r.data.length) {
                var n = parseInt(r.data[0].setting_value, 10);
                if (!isNaN(n) && n >= 10) ms = n * 1000;
            }
            if (done) done(ms);
        })
        .catch(function() {
            if (done) done(fallback);
        });
}

/** Restart queue/today/planner auto-refresh using program_settings.queue_refresh_interval. */
function restartApptAutoRefresh() {
    stopApptAutoRefresh();
    if (typeof apptSectionIsActive === 'function' && apptSectionIsActive()) {
        startApptAutoRefresh();
    }
}

function startApptAutoRefresh() {
    stopApptAutoRefresh();
    fetchQueueRefreshIntervalMs(function(ms) {
        if (!ms || ms < 10000) return;
        apptAutoRefreshTimer = setInterval(apptAutoRefreshTick, ms);
    });
}

// ════════════════════════════════════════════════════════════════
// APPOINTMENT RECORDS TAB
// ════════════════════════════════════════════════════════════════
var AR_RECORDS_SIDEBAR_HIDDEN_LS = 'ar_records_sidebar_hidden_v1';

function arRecordsIsSidebarHidden() {
    try { return localStorage.getItem(AR_RECORDS_SIDEBAR_HIDDEN_LS) === '1'; } catch (e) { return false; }
}

function arRecordsSetSidebarHidden(on) {
    try { localStorage.setItem(AR_RECORDS_SIDEBAR_HIDDEN_LS, on ? '1' : '0'); } catch (e) {}
    arRecordsSyncSidebarToggleUi();
    arRecordsApplySidebarLayout();
}

function arRecordsToggleSidebar() {
    arRecordsSetSidebarHidden(!arRecordsIsSidebarHidden());
}

function arRecordsSyncSidebarToggleUi() {
    var btn = g('arRecordsSidebarToggle');
    if (!btn) return;
    var hidden = arRecordsIsSidebarHidden();
    btn.textContent = hidden ? '▶' : '◀';
    btn.setAttribute('aria-expanded', hidden ? 'false' : 'true');
    btn.title = tr(hidden ? 'appt.ar.sidebarShowTitle' : 'appt.ar.sidebarHideTitle');
}

function arRecordsApplySidebarLayout() {
    var tab = g('tab-records');
    if (tab) tab.classList.toggle('ar-records-sidebar-hidden', arRecordsIsSidebarHidden());
}

var arFilter         = 'all';   // 'all' | 'upcoming' | 'past' | 'noshow'
var arSearchTerm     = '';
var arAllData        = [];      // cached from last fetch
var arSearchTimer    = null;
var AR_DOCTOR_ALL    = '__ALL__';
var AR_CLINIC_ALL    = '__ALL__';
var arDoctorFilter   = AR_DOCTOR_ALL;
var arClinicFilter   = '';
var arDateFilter     = '';      // '' = all dates; YYYY-MM-DD = specific day
var arMiniCalMonth   = new Date();

function arClinicTagFromId(cid) {
    if (!cid || cid === AR_CLINIC_ALL) return '';
    if (typeof clinicRecordFromId === 'function') {
        var rec = clinicRecordFromId(cid);
        if (rec) return String(rec.clinic_code || '').trim();
    }
    return '';
}

function arClinicTagsForSession() {
    var tags = [];
    var clinics = (typeof clinicsForWorkingSession === 'function')
        ? clinicsForWorkingSession()
        : (APP_CLINICS || []);
    (clinics || []).forEach(function(c) {
        var t = String(c.clinic_code || '').trim();
        if (t) tags.push(t);
    });
    return tags;
}

function populateArClinicSelect() {
    var sel = g('arClinicSelect');
    if (!sel) return;
    var prev = sel.value || arClinicFilter;
    if (!prev) {
        var apptSel = g('apptClinicSelect');
        prev = (apptSel && apptSel.value) ? apptSel.value : AR_CLINIC_ALL;
    }
    sel.innerHTML = '';
    var allOpt = document.createElement('option');
    allOpt.value = AR_CLINIC_ALL;
    allOpt.textContent = tr('appt.ar.clinicAll');
    sel.appendChild(allOpt);
    var clinicOpts = (typeof clinicsForWorkingSession === 'function')
        ? clinicsForWorkingSession()
        : (APP_CLINICS || []);
    if (!clinicOpts.length) {
        sel.innerHTML = '<option value="">' + esc(tr('common.noClinics')) + '</option>';
        arClinicFilter = '';
        return;
    }
    clinicOpts.forEach(function(c) {
        var o = document.createElement('option');
        o.value = c.id;
        o.textContent = (typeof clinicDisplayName === 'function')
            ? clinicDisplayName(c)
            : (c.english_name || c.chinese_name || clinicDisplayFallback());
        sel.appendChild(o);
    });
    var has = false;
    for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === prev) { has = true; break; }
    }
    sel.value = has ? prev : (clinicOpts[0] ? clinicOpts[0].id : AR_CLINIC_ALL);
    arClinicFilter = sel.value;
}

function setArClinicFilter(cid) {
    arClinicFilter = cid || AR_CLINIC_ALL;
    var sel = g('arClinicSelect');
    if (sel && sel.value !== arClinicFilter) sel.value = arClinicFilter;
    populateArDoctorSelect();
    loadApptRecords();
}

function arApptMatchesClinicFilter(a) {
    if (!arClinicFilter || arClinicFilter === AR_CLINIC_ALL) {
        var tags = arClinicTagsForSession();
        if (!tags.length) return true;
        var field = typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined'
            ? APPOINTMENT_CLINIC_TAG_FIELD
            : 'clinic_tag';
        var at = String(a[field] || a.clinic_tag || '').trim().toUpperCase();
        if (!at) return true;
        return tags.some(function(t) { return t.toUpperCase() === at; });
    }
    return apptImportAppointmentInClinic(a, arClinicTagFromId(arClinicFilter));
}

function arDoctorsForClinic() {
    var cid = '';
    if (arClinicFilter && arClinicFilter !== AR_CLINIC_ALL) {
        cid = arClinicFilter;
    }
    if (cid) {
        var list = typeof doctorsForClinic === 'function'
            ? doctorsForClinic(cid)
            : (APP_DOCTORS || []).filter(function(d) {
                return !cid || d.clinic_id === cid;
            });
        return (list || []).filter(function(d) {
            return d && d.is_active !== false && String(d.doctor_code || '').trim();
        });
    }
    var seen = {};
    var out = [];
    var clinics = (typeof clinicsForWorkingSession === 'function')
        ? clinicsForWorkingSession()
        : (APP_CLINICS || []);
    (clinics || []).forEach(function(c) {
        var list = typeof doctorsForClinic === 'function'
            ? doctorsForClinic(c.id)
            : (APP_DOCTORS || []).filter(function(d) { return d.clinic_id === c.id; });
        (list || []).forEach(function(d) {
            var code = String(d.doctor_code || '').trim();
            if (!code || d.is_active === false || seen[code]) return;
            seen[code] = true;
            out.push(d);
        });
    });
    return out;
}

function populateArDoctorSelect() {
    var sel = g('arDoctorSelect');
    if (!sel) return;
    var prev = sel.value || arDoctorFilter || AR_DOCTOR_ALL;
    sel.innerHTML = '';
    var allOpt = document.createElement('option');
    allOpt.value = AR_DOCTOR_ALL;
    allOpt.textContent = tr('appt.ar.doctorAll');
    sel.appendChild(allOpt);
    arDoctorsForClinic().forEach(function (d) {
        var code = String(d.doctor_code || '').trim();
        if (!code) return;
        var opt = document.createElement('option');
        opt.value = code;
        opt.textContent = (typeof doctorDisplayName === 'function'
            ? doctorDisplayName(d)
            : (d.english_name || d.chinese_name || code)) + ' [' + code + ']';
        sel.appendChild(opt);
    });
    var has = false;
    for (var i = 0; i < sel.options.length; i++) {
        if (sel.options[i].value === prev) { has = true; break; }
    }
    sel.value = has ? prev : AR_DOCTOR_ALL;
    arDoctorFilter = sel.value;
}

function setArDoctorFilter(code) {
    arDoctorFilter = code || AR_DOCTOR_ALL;
    var sel = g('arDoctorSelect');
    if (sel && sel.value !== arDoctorFilter) sel.value = arDoctorFilter;
    arRender();
}

function setArDateFilter(iso) {
    arDateFilter = String(iso || '').trim();
    if (arDateFilter) {
        var d = typeof parseISODateOnly === 'function'
            ? parseISODateOnly(arDateFilter)
            : null;
        if (d && !isNaN(d.getTime())) {
            arMiniCalMonth = new Date(d.getFullYear(), d.getMonth(), 1);
        }
    }
    renderArMiniCal();
    arSyncDateLabel();
    loadApptRecords();
}

function arSyncDateLabel() {
    var lbl = g('arDateLbl');
    var clearBtn = g('arDateClearBtn');
    if (lbl) {
        if (arDateFilter) {
            var disp = (typeof fmtDateLong === 'function')
                ? fmtDateLong(arDateFilter, { long: true })
                : arDateFilter;
            lbl.textContent = trRepl('appt.ar.dateFiltered', { DATE: disp });
            lbl.style.display = '';
        } else {
            lbl.textContent = '';
            lbl.style.display = 'none';
        }
    }
    if (clearBtn) {
        clearBtn.classList.toggle('ar-date-clear-btn--active', !arDateFilter);
    }
}

function renderArMiniCal() {
    var host = g('arMiniCal');
    if (!host) return;
    var y = arMiniCalMonth.getFullYear();
    var mo = arMiniCalMonth.getMonth();
    var first = new Date(y, mo, 1);
    var startPad = first.getDay();
    var daysIn = new Date(y, mo + 1, 0).getDate();
    var loc = apptDateLocale();
    var monthLbl = new Date(y, mo, 1).toLocaleDateString(loc, { month: 'long', year: 'numeric' });
    var wd = apptCalWeekdayHeaders();
    var html = '<div class="plusappt-mc-head">' +
        '<button type="button" class="plusappt-mc-nav" data-act="prev">‹</button>' +
        '<span class="plusappt-mc-title">' + esc(monthLbl) + '</span>' +
        '<button type="button" class="plusappt-mc-nav" data-act="next">›</button>' +
        '</div><div class="plusappt-mc-wd">';
    wd.forEach(function(d) {
        html += '<span>' + esc(d) + '</span>';
    });
    html += '</div><div class="plusappt-mc-grid">';
    var i;
    for (i = 0; i < startPad; i++) {
        html += '<span class="plusappt-mc-pad"></span>';
    }
    for (var day = 1; day <= daysIn; day++) {
        var iso = y + '-' + pad(mo + 1) + '-' + pad(day);
        var sel = iso === arDateFilter;
        var today = iso === todayISO();
        var cs = 'plusappt-mc-day';
        if (sel) cs += ' plusappt-mc-day--sel';
        if (today) cs += ' plusappt-mc-day--today';
        html += '<button type="button" class="' + cs + '" data-iso="' + iso + '">' + day + '</button>';
    }
    html += '</div>' +
        '<button type="button" class="plusappt-mc-today" data-act="today">' +
        esc(tr('appt.calToday')) + '</button>';
    host.innerHTML = html;

    host.querySelectorAll('[data-iso]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            setArDateFilter(btn.getAttribute('data-iso'));
        });
    });
    host.querySelectorAll('[data-act]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var act = btn.getAttribute('data-act');
            if (act === 'prev') {
                arMiniCalMonth = new Date(y, mo - 1, 1);
                renderArMiniCal();
            } else if (act === 'next') {
                arMiniCalMonth = new Date(y, mo + 1, 1);
                renderArMiniCal();
            } else if (act === 'today') {
                setArDateFilter(todayISO());
            }
        });
    });
}

function arApptMatchesDoctorFilter(a) {
    if (!arDoctorFilter || arDoctorFilter === AR_DOCTOR_ALL) return true;
    if (typeof plusApptApptMatchesDoctor === 'function') {
        return plusApptApptMatchesDoctor(a, arDoctorFilter);
    }
    var c = String(arDoctorFilter).trim().toLowerCase();
    var dc = String(a && a.doctor_code ? a.doctor_code : '').trim().toLowerCase();
    return !!(dc && dc === c);
}

/** No-show / cancelled — excluded from upcoming & past buckets. */
function arApptIsNoshow(a) {
    return /no.?show|failed|cancel/i.test(String(a && a.bill_status ? a.bill_status : ''));
}

/** Visit already started or completed (same signals as Today tab). */
function arApptIsFinishedVisit(a) {
    if (!a) return false;
    if (a.in_queue !== null && a.in_queue !== undefined) return true;
    var s = String(a.bill_status || '').trim().toLowerCase();
    if (!s || s === 'scheduled') return false;
    if (s === 'queue' || s === 'done' || s === 'finish' || s === 'arrived') return true;
    if (s === 'billed' || s === 'paid' || s === 'partial') return true;
    return false;
}

function arRecordFilterBucket(a, today) {
    today = today || todayISO();
    if (arApptIsNoshow(a)) return 'noshow';
    if (a.date < today || (a.date === today && arApptIsFinishedVisit(a))) return 'past';
    if (a.date >= today) return 'upcoming';
    return 'past';
}

function setArFilter(f) {
    arFilter = f;
    document.querySelectorAll('.ar-filter-btn').forEach(function(b) {
        var active = b.dataset.filter === f;
        b.style.background    = active ? '#0084ff' : '#fff';
        b.style.color         = active ? '#fff'    : '#374151';
        b.style.borderColor   = active ? '#0084ff' : '#e5e7eb';
    });
    arRender();
}

function arSearchDebounce() {
    clearTimeout(arSearchTimer);
    arSearchTimer = setTimeout(function() {
        arSearchTerm = (g('arSearchInput').value || '').trim().toLowerCase();
        arRender();
    }, 220);
}

/** Records tab: clinic scope from arClinicSelect (or all session clinics). */
function applyApptRecordsClinicQuery(builder) {
    if (!builder) return builder;
    var field = typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined'
        ? APPOINTMENT_CLINIC_TAG_FIELD
        : 'clinic_tag';
    if (arClinicFilter && arClinicFilter !== AR_CLINIC_ALL) {
        var tag = arClinicTagFromId(arClinicFilter);
        if (tag) {
            return builder.or(field + '.eq.' + tag + ',' + field + '.is.null');
        }
    }
    var tags = arClinicTagsForSession();
    if (!tags.length) return builder;
    if (tags.length === 1) {
        return builder.or(field + '.eq.' + tags[0] + ',' + field + '.is.null');
    }
    var parts = tags.map(function(t) { return field + '.eq.' + t; });
    parts.push(field + '.is.null');
    return builder.or(parts.join(','));
}

function loadApptRecords() {
    var tbody = g('arBody');
    if (!tbody) return;
    bindArRecordsRowsOnce();
    arRecordsSyncSidebarToggleUi();
    arRecordsApplySidebarLayout();
    populateArClinicSelect();
    populateArDoctorSelect();
    renderArMiniCal();
    arSyncDateLabel();
    tbody.innerHTML =
        '<tr><td colspan="10" style="text-align:center;color:#aaa;padding:30px;">' +
        esc(tr('common.loadingEllipsis')) + '</td></tr>';

    var aq = SB.from('appointments').select('*');
    if (arDateFilter) {
        aq = aq.eq('date', arDateFilter)
            .order('start_time', { ascending: false });
    } else {
        aq = aq.order('date', { ascending: false })
            .order('start_time', { ascending: false })
            .limit(500);
    }
    aq = applyApptRecordsClinicQuery(aq);
    aq
    .then(function(r) {
        if (r.error) {
            tbody.innerHTML =
                '<tr><td colspan="10" style="color:red;padding:20px;">' +
                esc(r.error.message) + '</td></tr>';
            return;
        }
        arAllData = r.data || [];
        mergeScheduleLockedLocal(arAllData);
        arRender();
    });
}

function arRender() {
    var today = todayISO();
    var term  = arSearchTerm;

    var rows = arAllData.filter(function(a) {
        if (arFilter !== 'all') {
            var bucket = arRecordFilterBucket(a, today);
            if (arFilter !== bucket) return false;
        }

        if (!arApptMatchesClinicFilter(a)) return false;
        if (!arApptMatchesDoctorFilter(a)) return false;
        if (arDateFilter && a.date !== arDateFilter) return false;

        // Search filter
        if (term) {
            var haystack = [
                a.patient_name         || '',
                a.patient_chinese_name || '',
                a.patient_no           || '',
                a.treatment_items      || '',
                a.doctor_code          || '',
                a.remarks              || ''
            ].join(' ').toLowerCase();
            if (haystack.indexOf(term) < 0) return false;
        }
        return true;
    });

    var tbody    = g('arBody');
    var emptyMsg = g('arEmptyMsg');
    var countEl  = g('arCount');
    if (!tbody) return;

    if (countEl) {
        countEl.textContent = rows.length === 1
            ? tr('appt.ar.recordCountOne')
            : trRepl('appt.ar.recordCountN', { N: String(rows.length) });
    }

    if (!rows.length) {
        tbody.innerHTML = '';
        if (emptyMsg) emptyMsg.style.display = 'block';
        return;
    }
    if (emptyMsg) emptyMsg.style.display = 'none';

    // Group: upcoming first (asc), then past (already desc from server)
    var future = rows.filter(function(a) { return arRecordFilterBucket(a, today) === 'upcoming'; })
                     .sort(function(x, y) {
                         return (x.date + x.start_time).localeCompare(y.date + y.start_time);
                     });
    var older  = rows.filter(function(a) {
        var b = arRecordFilterBucket(a, today);
        return b === 'past' || b === 'noshow';
    });
    var sorted = future.concat(older);

    var html = '';

    // Section headers only in "All" view
    if (arFilter === 'all' && future.length && older.length) {
        html += arSectionHeader(trRepl('appt.ar.sectionUpcoming', { N: String(future.length) }), '#e8f4ff', '#0084ff');
        future.forEach(function(a) { html += arRow(a, today); });
        html += arSectionHeader(trRepl('appt.ar.sectionPast', { N: String(older.length) }), '#f8fafc', '#64748b');
        older.forEach(function(a) { html += arRow(a, today); });
    } else {
        sorted.forEach(function(a) { html += arRow(a, today); });
    }

    tbody.innerHTML = html;
    apptRestoreListRowSelection(tbody, 'records');
}

var arRecordsRowsBound = false;
function bindArRecordsRowsOnce() {
    if (arRecordsRowsBound) return;
    var tb = g('arBody');
    if (!tb) return;
    arRecordsRowsBound = true;
    var sidebarToggleBtn = g('arRecordsSidebarToggle');
    if (sidebarToggleBtn) sidebarToggleBtn.addEventListener('click', arRecordsToggleSidebar);
    arRecordsSyncSidebarToggleUi();
    arRecordsApplySidebarLayout();
    tb.addEventListener('click', function(e) {
        if (apptListRowClickBlocked(e.target)) return;
        var row = e.target.closest('tr.ar-record-row');
        if (!row) return;
        var id = row.getAttribute('data-appt-id');
        if (!id) return;
        var a = (arAllData || []).find(function(x) {
            return x && String(x.id) === String(id);
        });
        if (!a) return;
        apptListSelectedTab = 'records';
        apptMarkListRowSelected(row, a.id);
        apptSetActivePatientFromAppt(a, 'appt-records-row-select');
        if (typeof setActivePatientDockCollapsed === 'function') {
            setActivePatientDockCollapsed(false, true);
        }
    });
}

function arSectionHeader(label, bg, color) {
    return '<tr><td colspan="10" style="background:' + bg + ';color:' + color + ';' +
           'font-weight:700;font-size:11px;padding:6px 10px;letter-spacing:.5px;">' +
           label + '</td></tr>';
}

function arApptDurationMinutes(a) {
    if (!a) return 0;
    var dur = parseInt(a.duration || '0', 10);
    if (dur > 0) return dur;
    if (typeof plusApptTimeToMin === 'function') {
        var stM = plusApptTimeToMin(a.start_time);
        var enM = plusApptTimeToMin(a.end_time);
        if (enM > stM) return enM - stM;
    }
    return 0;
}

function arDurationDisplay(a) {
    var dur = arApptDurationMinutes(a);
    if (!dur && dur !== 0) return '—';
    return apptDurationDisplay(dur);
}

function arRow(a, today) {
    var isNoshow  = /no.?show|failed|cancel/i.test(a.bill_status || '');
    var isUpcoming = a.date >= today;
    var isDone    = /done/i.test(a.bill_status || '');

    var rowStyle = '';
    if (isNoshow)   rowStyle = 'background:#fff5f5;';
    else if (isUpcoming && a.date === today) rowStyle = 'background:#fffbeb;';
    else if (isUpcoming) rowStyle = 'background:#f0fdf4;';

    var statusBadge = arStatusBadge(a.bill_status, isUpcoming, a.date, today);

    var chinesePart = a.patient_chinese_name
        ? '<span style="font-family:\'PingFang HK\',\'Microsoft JhengHei\',sans-serif;' +
          'font-size:13px;font-weight:800;display:block;line-height:1.2;">' +
          esc(a.patient_chinese_name) + '</span>'
        : '';

    var walkInBadge = !a.patient_id
        ? '<span style="background:#fef3c7;color:#92400e;font-size:9px;font-weight:800;' +
          'padding:1px 4px;border-radius:3px;margin-left:3px;vertical-align:middle;">' +
          esc(tr('appt.badge.newWalkin')) + '</span>'
        : '';

    return '<tr class="ar-record-row" data-appt-id="' + esc(a.id) + '" style="' + rowStyle + 'cursor:pointer;" ' +
           'ondblclick="arOpenEdit(\'' + a.id + '\')">' +
           '<td style="white-space:nowrap;font-weight:600;">' + esc(a.date || '') + '</td>' +
           '<td style="white-space:nowrap;">' + fmt12(a.start_time) + '</td>' +
           '<td style="white-space:nowrap;font-size:12px;color:#64748b;">' +
               esc(arDurationDisplay(a)) + '</td>' +
           '<td style="color:#64748b;">' + esc(a.patient_no || '—') + '</td>' +
           '<td>' + chinesePart +
               '<span style="font-size:12px;">' + esc(a.patient_name || '—') + walkInBadge + '</span>' +
           '</td>' +
           '<td style="font-size:12px;">' + esc(a.treatment_items || '—') + '</td>' +
           '<td style="font-size:12px;font-weight:700;color:#0084ff;">' +
               esc(a.doctor_code || a.doctor_name || '—') + '</td>' +
           '<td>' + statusBadge + '</td>' +
           '<td style="font-size:11px;color:#64748b;max-width:160px;' +
               'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
               formatRemarksForDisplay(a.remarks) + '</td>' +
           '<td style="text-align:center;">' +
               '<button onclick="event.stopPropagation(); arOpenEdit(\'' + a.id + '\')" ' +
               'style="padding:3px 8px;font-size:11px;border:1px solid #cbd5e1;' +
               'border-radius:5px;background:#fff;cursor:pointer;color:#374151;" ' +
               'title="' + esc(tr('appt.ar.editTitle')) + '">✏️</button>' +
           '</td>' +
           '</tr>';
}

function arStatusBadge(status, isUpcoming, date, today) {
    var s   = (status || 'Scheduled').trim();
    var low = s.toLowerCase();
    var bg, color;
    if (/no.?show|failed/i.test(s))      { bg = '#fee2e2'; color = '#b91c1c'; }
    else if (/cancel/i.test(s))           { bg = '#f1f5f9'; color = '#64748b'; }
    else if (/done/i.test(s))             { bg = '#dcfce7'; color = '#166534'; }
    else if (/queue|arrived/i.test(s))    { bg = '#fef3c7'; color = '#92400e'; }
    else if (isUpcoming && date === today){ bg = '#fef3c7'; color = '#92400e'; }
    else if (isUpcoming)                  { bg = '#dbeafe'; color = '#1d4ed8'; }
    else                                  { bg = '#f1f5f9'; color = '#475569'; }
    var label = (typeof dispApptStatus === 'function')
        ? dispApptStatus(s)
        : (typeof tr === 'function' ? tr('status.scheduled') : s);
    return '<span style="background:' + bg + ';color:' + color + ';font-size:11px;' +
           'font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap;">' +
           esc(label) + '</span>';
}

var arOpenEditTimer = null;
function arOpenEdit(id) {
    var appt = arAllData.find(function(a) { return String(a.id) === String(id); });
    if (!appt) return;
    var today = todayISO();
    var rowDate = String(appt.date || '').trim();
    if (rowDate && rowDate < today) {
        openNewApptSamePatientFromRecord(appt);
    } else {
        openApptEditModal(appt);
    }
}

function openNewApptSamePatientFromRecord(appt) {
    apptEditId = null;
    apptEditLockRef = null;
    setApptScheduleLockFormUI(false);
    resetApptBookingGuards();
    arBookingMinDateToday = true;

    var db = g('deleteApptBtn');
    if (db) db.style.display = 'none';

    g('apptModalTitle').textContent = tr('appt.modal.newApptSame');

    sv('hPid',      appt.patient_id           || '');
    sv('hPno',      appt.patient_no           || '');
    sv('hPname',    appt.patient_name         || '');
    sv('hPchinese', appt.patient_chinese_name || '');

    g('psInput').value =
        (appt.patient_chinese_name ? appt.patient_chinese_name + ' ' : '') +
        (appt.patient_name || '') +
        (appt.patient_no ? ' (#' + appt.patient_no + ')' : '');
    g('psSelName').textContent    = appt.patient_name || '-';
    g('psSelNo').textContent      = appt.patient_no   || '-';
    g('psSelected').style.display = 'block';
    apptRefreshSelectedPatientDob(appt.patient_id || '');

    var tday = todayISO();
    sv('fDate', tday);
    var fd = g('fDate');
    if (fd) fd.setAttribute('min', tday);

    sv('fTreatment', '');
    clearApptRemarksEditor('fRemarksEditor');
    sv('npName',   '');
    sv('npPhone',  '');

    if (!appt.patient_id) {
        sv('npName', appt.patient_name || '');
        sv('npPhone', extractPhoneFromRemarks(appt.remarks));
        switchApptPatientMode('new');
    } else {
        switchApptPatientMode('exist');
    }

    buildTimeSlots();
    loadApptDoctors(appt.doctor_code || appt.doctor_name || '');
    sv('fStart', '09:00');
    sv('fDur',   '30');
    calcEnd();
    refreshApptModalI18n();
    openModal('apptModal');
}

// ════════════════════════════════════════════════════════════════
// RECALL PATIENT TAB
// ════════════════════════════════════════════════════════════════
var rcDate      = '';          // YYYY-MM-DD currently selected
var rcMonthD    = new Date();  // month shown in recall mini-calendar
var rcPatients  = [];          // enriched appointment rows for selected date
var rcSelIds    = {};          // { apptId: true }
var rcContact   = 'whatsapp';  // 'whatsapp' | 'sms'
var rcTemplates = [];          // saved templates (localStorage)
var rcSendQueue = [];          // patients to step through when sending
var rcSendIdx   = 0;
var RC_TMPL_KEY = 'recall_templates_v1';

function initRecallTab() {
    rcDate   = todayISO();
    rcMonthD = new Date();
    loadRcTemplates();
    renderRcal();
    loadRecallPatients(rcDate);
}

// ── Mini Calendar ────────────────────────────────────────────────
function renderRcal() {
    var wrap = g('rcalContainer');
    if (!wrap) return;
    var y     = rcMonthD.getFullYear();
    var m     = rcMonthD.getMonth();          // 0-based
    var today = todayISO();
    var dow0  = new Date(y, m, 1).getDay();  // weekday of 1st
    var daysM = new Date(y, m + 1, 0).getDate();
    var loc   = apptDateLocale();
    var mLbl  = new Date(y, m, 1).toLocaleDateString(loc, { month: 'long', year: 'numeric' });
    var dowHdr = apptCalWeekdayHeaders();

    var html =
        '<div class="rcal-header">' +
            '<button class="rcal-nav" onclick="rcalPrev()"' +
            ' aria-label="' + esc(tr('appt.rcal.prevAria')) + '">&#8249;</button>' +
            '<span class="rcal-title">' + mLbl + '</span>' +
            '<button class="rcal-nav" onclick="rcalNext()"' +
            ' aria-label="' + esc(tr('appt.rcal.nextAria')) + '">&#8250;</button>' +
        '</div>' +
        '<table class="rcal-table"><thead><tr>';
    dowHdr.forEach(function(d) {
        html += '<th>' + esc(d) + '</th>';
    });
    html += '</tr></thead><tbody><tr>';

    for (var b = 0; b < dow0; b++) html += '<td></td>';

    var dow = dow0;
    for (var d = 1; d <= daysM; d++) {
        var iso = y + '-' + pad(m + 1) + '-' + pad(d);
        var cls = 'rcal-day';
        if (iso === rcDate) cls += ' rcal-sel';
        else if (iso === today) cls += ' rcal-today';
        else if (iso > today)   cls += ' rcal-future';

        html += '<td class="' + cls + '" onclick="rcSelectDate(\'' + iso + '\')">' + d + '</td>';
        dow++;
        if (dow % 7 === 0 && d < daysM) html += '</tr><tr>';
    }
    while (dow % 7 !== 0) { html += '<td></td>'; dow++; }
    html += '</tr></tbody></table>';

    wrap.innerHTML = html;
}

function rcalPrev() {
    rcMonthD = new Date(rcMonthD.getFullYear(), rcMonthD.getMonth() - 1, 1);
    renderRcal();
}
function rcalNext() {
    rcMonthD = new Date(rcMonthD.getFullYear(), rcMonthD.getMonth() + 1, 1);
    renderRcal();
}
function rcSelectDate(iso) {
    rcDate = iso;
    renderRcal();
    loadRecallPatients(iso);
}

// ── Patient Loader ───────────────────────────────────────────────
function loadRecallPatients(date) {
    rcSelIds = {};
    rcPatients = [];
    var tbody  = g('recallBody');
    var hdr    = g('recallDateHdr');
    var cntEl  = g('recallPtCount');
    if (!tbody) return;

    if (hdr) {
        hdr.textContent = date
            ? (typeof fmtDateLong === 'function'
                ? fmtDateLong(date, { long: true })
                : date)
            : tr('appt.recallSelectDate');
    }
    if (cntEl) cntEl.textContent = '';
    tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:24px;">' +
        esc(tr('common.loadingEllipsis')) + '</td></tr>';

    if (!date) {
        var pls = tr('appt.recallPleaseSelectRow');
        tbody.innerHTML =
            '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:24px;">' + esc(pls) + '</td></tr>';
        return;
    }

    var rq = SB.from('appointments')
        .select('*')
        .eq('date', date)
        .order('start_time');
    rq = applyApptModuleClinicQuery(rq);
    rq.then(function(r) {
        if (r.error) {
            tbody.innerHTML =
                '<tr><td colspan="5" style="color:red;padding:20px;">' +
                esc(r.error.message) + '</td></tr>';
            return;
        }
        var appts  = r.data || [];
        var patIds = appts.map(function(a) { return a.patient_id; }).filter(Boolean);

        if (!patIds.length) {
            // Walk-ins or appointments without linked patients
            rcPatients = appts.map(function(a) { return Object.assign({}, a, { phone: '' }); });
            renderRecallTable();
            return;
        }

        SB.from('patients')
            .select('id,phone_number')
            .in('id', patIds)
        .then(function(pr) {
            var phoneMap = {};
            if (pr.data) pr.data.forEach(function(p) { phoneMap[p.id] = p.phone_number || ''; });
            rcPatients = appts.map(function(a) {
                return Object.assign({}, a, {
                    phone: a.patient_id ? (phoneMap[a.patient_id] || '') : ''
                });
            });
            renderRecallTable();
        });
    });
}

function renderRecallTable() {
    var tbody = g('recallBody');
    var cntEl = g('recallPtCount');
    if (!tbody) return;

    if (cntEl) cntEl.textContent = rcPatients.length
        ? (rcPatients.length === 1
            ? tr('appt.recall.patientCountOne')
            : trRepl('appt.recall.patientCountN', { N: rcPatients.length }))
        : '';

    if (!rcPatients.length) {
        tbody.innerHTML =
            '<tr><td colspan="5" style="text-align:center;color:#aaa;padding:30px;">' +
            esc(tr('appt.recall.noApptsOnDate')) + '</td></tr>';
        return;
    }

    var html = '';
    rcPatients.forEach(function(a) {
        var chk     = rcSelIds[a.id] ? 'checked' : '';
        var chinese = a.patient_chinese_name
            ? '<span class="rcal-chinese">' + esc(a.patient_chinese_name) + '</span>'
            : '';
        var phoneTd = a.phone
            ? esc(a.phone)
            : '<span style="color:#f87171;font-size:11px;">' + esc(tr('appt.recall.noPhone')) + '</span>';
        html +=
            '<tr data-rid="' + a.id + '">' +
            '<td style="text-align:center;">' +
                '<input type="checkbox" class="rc-chk" ' + chk +
                ' onchange="rcToggleChk(this,\'' + a.id + '\')">' +
            '</td>' +
            '<td style="color:#64748b;">' + esc(a.patient_no || '—') + '</td>' +
            '<td>' + chinese +
                '<span style="font-size:12px;">' + esc(a.patient_name || '—') + '</span>' +
            '</td>' +
            '<td style="font-size:12px;">' + phoneTd + '</td>' +
            '<td style="font-size:11px;color:#64748b;">' + esc(a.treatment_items || '—') + '</td>' +
            '</tr>';
    });
    tbody.innerHTML = html;
}

function rcToggleChk(chk, id) {
    if (chk.checked) rcSelIds[id] = true;
    else delete rcSelIds[id];
}
function rcSelectAll() {
    rcPatients.forEach(function(a) { rcSelIds[a.id] = true; });
    document.querySelectorAll('#recallTable .rc-chk').forEach(function(c) { c.checked = true; });
}
function rcDeselectAll() {
    rcSelIds = {};
    document.querySelectorAll('#recallTable .rc-chk').forEach(function(c) { c.checked = false; });
}

// ── Contact method toggle ────────────────────────────────────────
function setRcContact(method) {
    rcContact = method;
    var waBtn  = g('rcContactWA');
    var smsBtn = g('rcContactSMS');
    if (waBtn) {
        waBtn.style.background   = method === 'whatsapp' ? '#25d366' : '#fff';
        waBtn.style.color        = method === 'whatsapp' ? '#fff'    : '#374151';
        waBtn.style.borderColor  = method === 'whatsapp' ? '#25d366' : '#e5e7eb';
    }
    if (smsBtn) {
        smsBtn.style.background  = method === 'sms' ? '#0084ff' : '#fff';
        smsBtn.style.color       = method === 'sms' ? '#fff'    : '#374151';
        smsBtn.style.borderColor = method === 'sms' ? '#0084ff' : '#e5e7eb';
    }
}

// ── Templates (localStorage) ─────────────────────────────────────
function loadRcTemplates() {
    try { rcTemplates = JSON.parse(localStorage.getItem(RC_TMPL_KEY) || '[]'); }
    catch(e) { rcTemplates = []; }
    renderRcTemplates();
}
function saveRcTemplate() {
    var txt = (g('recallMsgBox') && g('recallMsgBox').value || '').trim();
    if (!txt) { alert(tr('appt.recall.alertEnterMsg')); return; }
    var name = prompt(tr('appt.recall.promptTmplName'));
    if (name === null || !name.trim()) return;
    rcTemplates.push({ id: Date.now(), name: name.trim(), content: txt });
    localStorage.setItem(RC_TMPL_KEY, JSON.stringify(rcTemplates));
    renderRcTemplates();
}
function renderRcTemplates() {
    var panel = g('recallTmplPanel');
    if (!panel) return;
    if (!rcTemplates.length) { panel.style.display = 'none'; return; }
    panel.style.display = 'block';
    var html =
        '<div style="font-weight:700;font-size:12px;color:#64748b;margin-bottom:8px;' +
        'letter-spacing:.4px;">' + esc(tr('appt.recall.tmplSavedHeader')) + '</div>';
    rcTemplates.forEach(function(t) {
        html +=
            '<div class="rc-tmpl-item">' +
            '<span class="rc-tmpl-name" onclick="applyRcTemplate(' + t.id + ')">' +
                esc(t.name) +
            '</span>' +
            '<button class="rc-tmpl-del" title="' + esc(tr('appt.recall.deleteTmplTitle')) + '" ' +
                'onclick="deleteRcTemplate(' + t.id + ')">✕</button>' +
            '</div>';
    });
    panel.innerHTML = html;
}
function applyRcTemplate(id) {
    var tmpl = rcTemplates.filter(function(t) { return t.id === id; })[0];
    if (tmpl && g('recallMsgBox')) g('recallMsgBox').value = tmpl.content;
}
function deleteRcTemplate(id) {
    if (!confirm(tr('appt.recall.confirmDeleteTmpl'))) return;
    rcTemplates = rcTemplates.filter(function(t) { return t.id !== id; });
    localStorage.setItem(RC_TMPL_KEY, JSON.stringify(rcTemplates));
    renderRcTemplates();
}

// ── Send Queue ───────────────────────────────────────────────────

/** Placeholders for recall message box ({name}, {date}, …). */
function buildRecallPersonalised(a) {
    var msg = (g('recallMsgBox') && g('recallMsgBox').value || '').trim();
    return msg
        .replace(/\{name\}/gi,    a.patient_name         || a.patient_chinese_name || '')
        .replace(/\{chinese\}/gi, a.patient_chinese_name || '')
        .replace(/\{date\}/gi,    rcDate)
        .replace(/\{phone\}/gi,   a.phone                || '')
        .replace(/\{no\}/gi,      a.patient_no           || '');
}

/** WhatsApp prefilled body length guard (GET URL limits). */
function recallTruncateForWaPrefill(text, maxLen) {
    var n = maxLen || 1500;
    if (text.length <= n) return text;
    return text.slice(0, n - 1) + '…';
}

/** Build Send URL — desktop targets WhatsApp Web; mobile uses wa.me (opens app reliably). */
function buildRecallWhatsAppOpenUrl(apptRow, personalised) {
    var digits = formatPhoneForWA(apptRow.phone);
    if (!digits) return '';
    var body = recallTruncateForWaPrefill(personalised, 1500);
    var enc = encodeURIComponent(body);
    var mobile =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent || '');
    if (mobile) {
        return 'https://wa.me/' + digits + '?text=' + enc;
    }
    return (
        'https://web.whatsapp.com/send?phone=' +
        encodeURIComponent(digits) +
        '&text=' +
        enc
    );
}

function startRecallSend() {
    var msg = (g('recallMsgBox') && g('recallMsgBox').value || '').trim();
    if (!msg) { alert(tr('appt.recall.alertEnterRecallMsg')); return; }

    var selected = rcPatients.filter(function(a) { return rcSelIds[a.id]; });
    if (!selected.length) { alert(tr('appt.recall.alertSelectPatients')); return; }

    var noPhone = selected.filter(function(a) { return !a.phone; });
    if (noPhone.length) {
        var names = noPhone.map(function(a) {
            return a.patient_chinese_name || a.patient_name || tr('appt.recall.unknownPatient');
        }).join(', ');
        var ok = confirm(trRepl('appt.recall.confirmSkipNoPhone', {
            N: noPhone.length,
            NAMES: names
        }));
        if (!ok) return;
    }

    rcSendQueue = selected.filter(function(a) { return a.phone; });
    if (!rcSendQueue.length) {
        alert(tr('appt.recall.alertNoValidPhone'));
        return;
    }

    rcSendIdx = 0;
    showRcSendModal();
}

function showRcSendModal() {
    var content = g('rcSendContent');
    if (!content) return;

    if (rcSendIdx >= rcSendQueue.length) {
        closeModal('recallSendModal');
        alert(trRepl('appt.recall.alertAllProcessed', { N: rcSendQueue.length }));
        rcSendQueue = []; rcSendIdx = 0;
        return;
    }

    var a = rcSendQueue[rcSendIdx];

    var personalised = buildRecallPersonalised(a);

    var isWA = rcContact === 'whatsapp';
    var actionLabel = isWA ? tr('appt.recall.openWaWeb') : tr('appt.recall.openSms');
    var actionColor = isWA ? '#25d366' : '#0084ff';

    var progress = trRepl('appt.recall.sendProgress', {
        CUR: rcSendIdx + 1,
        TOTAL: rcSendQueue.length
    });
    var chinesePart = a.patient_chinese_name
        ? '<span style="font-family:\'PingFang HK\',\'Microsoft JhengHei\',sans-serif;' +
          'font-size:18px;font-weight:900;display:block;margin-bottom:3px;' +
          '-webkit-font-smoothing:antialiased;">' + esc(a.patient_chinese_name) + '</span>'
        : '';
    var isLast = rcSendIdx + 1 >= rcSendQueue.length;

    content.innerHTML =
        // Progress bar
        '<div style="display:flex;justify-content:space-between;align-items:center;' +
            'margin-bottom:12px;">' +
            '<span style="font-size:12px;background:#e8f4ff;color:#0084ff;' +
                'padding:3px 10px;border-radius:10px;font-weight:700;">' +
                esc(progress) + '</span>' +
            '<span style="font-size:12px;font-weight:700;color:#64748b;">' +
                (isWA ? tr('appt.recallWa') : tr('appt.recallSms')) +
            '</span>' +
        '</div>' +
        (isWA
            ? '<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;' +
                'padding:8px 10px;margin-bottom:10px;font-size:11px;line-height:1.45;color:#065f46;">' +
                t('appt.recall.waWebHintHtml') +
            '</div>'
            : '') +
        // Patient card
        '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;' +
            'padding:14px;margin-bottom:12px;">' +
            chinesePart +
            '<strong style="font-size:15px;">' + esc(a.patient_name || '—') + '</strong>' +
            (a.patient_no ? '<br><span style="font-size:11px;color:#94a3b8;">#' +
                esc(a.patient_no) + '</span>' : '') +
            '<br><span style="font-size:13px;font-weight:700;color:#0084ff;' +
                'margin-top:6px;display:block;">📞 ' + esc(a.phone) + '</span>' +
        '</div>' +
        // Message preview
        '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;' +
            'padding:10px 12px;margin-bottom:14px;font-size:12px;line-height:1.6;' +
            'white-space:pre-wrap;max-height:110px;overflow-y:auto;color:#1e293b;">' +
            esc(personalised) +
        '</div>' +
        (isWA
            ? '<button type="button" onclick="rcCopyRecallWaLink()" ' +
                'style="width:100%;margin-bottom:8px;font-size:11px;padding:8px 10px;' +
                'background:#fff;border:1px solid #cbd5e1;border-radius:8px;' +
                'cursor:pointer;color:#475569;font-weight:600;">' +
                esc(tr('appt.recall.copyWaLink')) + '</button>'
            : '') +
        // Action + Skip
        '<div style="display:flex;gap:8px;margin-bottom:8px;">' +
            '<button type="button" onclick="rcOpenRecallSend()" ' +
                'style="flex:1;padding:11px 8px;background:' + actionColor + ';color:#fff;' +
                'border:none;border-radius:8px;text-align:center;font-weight:700;' +
                'font-size:13px;cursor:pointer;">' +
                esc(actionLabel) + '</button>' +
            '<button onclick="rcSendSkip()" ' +
                'style="padding:11px 14px;background:#f1f5f9;color:#64748b;border:none;' +
                'border-radius:8px;font-weight:600;cursor:pointer;font-size:13px;">' +
                esc(tr('appt.recall.skip')) + '</button>' +
        '</div>' +
        // Next / Done
        (isLast
            ? '<button onclick="rcSendDone()" ' +
              'style="width:100%;padding:11px;background:#10b981;color:#fff;border:none;' +
              'border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;">' +
              esc(tr('appt.recall.doneAllSent')) + '</button>'
            : '<button onclick="rcSendNext()" ' +
              'style="width:100%;padding:11px;background:#475569;color:#fff;border:none;' +
              'border-radius:8px;font-weight:700;font-size:13px;cursor:pointer;">' +
              esc(trRepl('appt.recall.nextPatient', {
                  CUR: rcSendIdx + 2,
                  TOTAL: rcSendQueue.length
              })) + '</button>'
        );

    openModal('recallSendModal');
}

function rcSendNext() { rcSendIdx++; showRcSendModal(); }
function rcSendSkip() { rcSendIdx++; showRcSendModal(); }
function rcSendDone() {
    closeModal('recallSendModal');
    rcSendQueue = []; rcSendIdx = 0;
}

/** WhatsApp Web / SMS — opened via script so Chrome allows popup from user tap; WA uses web app on desktop. */
function rcOpenRecallSend() {
    if (!rcSendQueue || rcSendIdx >= rcSendQueue.length) return;
    var a = rcSendQueue[rcSendIdx];
    var personalised = buildRecallPersonalised(a);

    if (rcContact === 'sms') {
        var smsRaw = String(a.phone || '').replace(/\s/g, '');
        var smsUrl =
            'sms:' +
            smsRaw.replace(/[^\d+]/g, '') +
            '?body=' +
            encodeURIComponent(recallTruncateForWaPrefill(personalised, 1200));
        window.location.href = smsUrl;
        return;
    }

    var digits = formatPhoneForWA(a.phone);
    if (!digits || digits.length < 8) {
        alert(tr('appt.recall.cannotOpenWa'));
        return;
    }

    var url = buildRecallWhatsAppOpenUrl(a, personalised);
    if (!url) {
        alert(tr('appt.recall.cannotBuildWaLink'));
        return;
    }

    var w = window.open(url, '_blank', 'noopener,noreferrer');
    var blocked = !w || w.closed || typeof w.closed === 'undefined';
    if (!blocked) return;

    function fallbackPrompt(u) {
        if (typeof prompt === 'function') {
            prompt(tr('appt.recall.popupBlockedPrompt'), u);
        } else {
            alert(trRepl('appt.recall.popupBlockedAlert', { URL: u }));
        }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
            alert(tr('appt.recall.popupBlockedCopied'));
        }).catch(function() {
            fallbackPrompt(url);
        });
    } else {
        fallbackPrompt(url);
    }
}

/** Always copies desktop WhatsApp Web compose URL (works after login). */
function rcCopyRecallWaLink() {
    if (!rcSendQueue || rcSendIdx >= rcSendQueue.length) return;
    var a = rcSendQueue[rcSendIdx];
    var personalised = buildRecallPersonalised(a);
    var digits = formatPhoneForWA(a.phone);
    if (!digits || digits.length < 8) {
        alert(tr('appt.recall.noValidMobile'));
        return;
    }
    var url =
        'https://web.whatsapp.com/send?phone=' +
        encodeURIComponent(digits) +
        '&text=' +
        encodeURIComponent(recallTruncateForWaPrefill(personalised, 1500));

    function fallbackPrompt(u) {
        if (typeof prompt === 'function') prompt(tr('appt.recall.copyWaLinkPrompt'), u);
        else alert(u);
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
            alert(tr('appt.recall.copyWaLinkOk'));
        }).catch(function() {
            fallbackPrompt(url);
        });
    } else {
        fallbackPrompt(url);
    }
}

// Format phone for WhatsApp Web `phone=` param (digits only, HK → 852…)
function formatPhoneForWA(phone) {
    if (!phone) return '';
    var digits = phone.replace(/[^\d]/g, '');
    if (!digits.length) return '';
    if (digits.length === 8 && /^[569]/.test(digits)) return '852' + digits;
    if (digits.slice(0, 5) === '00852') return digits.slice(2);
    if (digits.slice(0, 4) === '8520' && digits.length >= 11) return '852' + digits.slice(4);
    return digits;
}

// ════════════════════════════════════════════════════════════════
// TIME SLOT BUILDER  (matches planner timeline: 09:00 – 00:00 midnight)
// ════════════════════════════════════════════════════════════════
function buildTimeSlots() {
    var sel = g('fStart');
    if (!sel) return;
    var cfg = plusApptReadGcalSettings();
    var startH = parseInt(cfg.startHour, 10);
    var endH = parseInt(cfg.endHour, 10);
    var interval = Math.max(5, parseInt(cfg.interval, 10) || PLUSAPPT_SLOT_MIN);
    if (isNaN(startH)) startH = 9;
    if (isNaN(endH)) endH = 24;
    if (endH <= startH) endH = startH + 1;
    sel.innerHTML = '';
    var h;
    var m;
    for (h = startH; h <= endH; h++) {
        for (m = 0; m < 60; m += interval) {
            if (h === endH && m > 0) break;
            var val = pad(h) + ':' + pad(m);
            var disp = fmt12(val);
            var o = document.createElement('option');
            o.value = val;
            o.textContent = disp;
            sel.appendChild(o);
        }
    }
    sel.value = '09:00';
    calcEnd();
}

function calcEnd() {
    var s = g('fStart');
    var d = g('fDur');
    var e = g('fEnd');
    if (!s || !d || !e) return;
    e.value = fmt12(addMins(s.value, d.value));
}

// ════════════════════════════════════════════════════════════════
// STATUS BADGE CLASS
// ════════════════════════════════════════════════════════════════
function dispStatusLabel(raw) {
    if (typeof dispApptStatus === 'function') return dispApptStatus(raw);
    return (typeof tr === 'function') ? tr('status.scheduled') : (raw || 'Scheduled');
}

function refreshApptHeaderI18n() {
    var un = g('apptUserName');
    var ur = g('apptUserRole');
    if (un) un.textContent = currentName || '-';
    if (ur) {
        ur.textContent = (typeof dispRole === 'function')
            ? dispRole(currentRole)
            : (currentRole || '-');
    }
    if (typeof syncApptTodayDateLabels === 'function') syncApptTodayDateLabels();
    if (typeof setQueueRefreshMeta === 'function') setQueueRefreshMeta({ stampNow: false });
    if (typeof refreshApptSharedMemoI18n === 'function') refreshApptSharedMemoI18n();
}

function statusClass(s) {
    var map = {
        'Scheduled': 'badge-scheduled',
        'Queue':     'badge-queue',
        'Done':      'badge-done',
        'No Show':   'badge-noshow',
        'Cancelled': 'badge-cancelled',
        'Billed':    'badge-billed',
        'Paid':      'badge-paid'
    };
    return map[s] || 'badge-scheduled';
}

// ════════════════════════════════════════════════════════════════
// PATIENT SEARCH  (appointment modal)
// ════════════════════════════════════════════════════════════════
function apptPatientDobLookup(patientId) {
    if (!patientId) return '';
    if (typeof conPatientData !== 'undefined' && conPatientData &&
        conPatientData.id === patientId && conPatientData.dob) {
        return conPatientData.dob;
    }
    if (typeof _patientDetailsPatient !== 'undefined' && _patientDetailsPatient &&
        _patientDetailsPatient.id === patientId && _patientDetailsPatient.dob) {
        return _patientDetailsPatient.dob;
    }
    if (typeof patientListCache !== 'undefined' && patientListCache.length) {
        var row = patientListCache.find(function (x) {
            return x && x.id === patientId;
        });
        if (row && row.dob) return row.dob;
    }
    return '';
}

function apptUpdatePsSelDob(dob) {
    var dobEl = g('psSelDob');
    if (!dobEl) return;
    if (dob && typeof formatDobAge === 'function') {
        dobEl.textContent = ' · ' + formatDobAge(dob);
        dobEl.style.display = '';
    } else {
        dobEl.textContent = '';
        dobEl.style.display = 'none';
    }
}

function apptRefreshSelectedPatientDob(patientId, dobHint) {
    var dob = String(dobHint || '').trim() || apptPatientDobLookup(patientId);
    if (dob) {
        apptUpdatePsSelDob(dob);
        return;
    }
    apptUpdatePsSelDob('');
    if (!patientId || typeof SB === 'undefined') return;
    SB.from('patients').select('dob').eq('id', patientId).maybeSingle()
        .then(function (r) {
            if (r.error || !r.data || !r.data.dob) return;
            if (String(g('hPid').value || '').trim() !== String(patientId)) return;
            apptUpdatePsSelDob(r.data.dob);
        });
}

function apptSetSelectedPatient(p) {
    if (!p || !p.id) return;
    g('hPid').value      = p.id;
    g('hPno').value      = p.patient_no    || '';
    g('hPname').value    = p.full_name     || '';
    var hpc = g('hPchinese');
    if (hpc) hpc.value   = p.chinese_name  || '';
    g('psInput').value   =
        (p.chinese_name ? p.chinese_name + ' ' : '') +
        (p.full_name || '') + ' (#' + (p.patient_no || '') + ')';
    g('psSelName').textContent = p.full_name || '-';
    g('psSelNo').textContent   = p.patient_no || '-';
    g('psSelected').style.display = 'block';
    apptRefreshSelectedPatientDob(p.id, p.dob);
    if (typeof switchApptPatientMode === 'function') switchApptPatientMode('exist');
}

function apptActivePatientSnapshot() {
    if (typeof conPatientData !== 'undefined' && conPatientData && conPatientData.id) {
        return conPatientData;
    }
    if (typeof _patientDetailsPatient !== 'undefined' && _patientDetailsPatient && _patientDetailsPatient.id) {
        return _patientDetailsPatient;
    }
    return null;
}

function prefillApptModalFromActivePatient() {
    var p = apptActivePatientSnapshot();
    if (!p) return false;
    apptSetSelectedPatient(p);
    return true;
}

function doPatientSearch() {
    if (typeof runPatientSearchDropdown === 'function') {
        runPatientSearchDropdown({
            inputId: 'psInput',
            dropId: 'psDrop',
            onSelect: function(p) {
                if (typeof apptSetSelectedPatient === 'function') apptSetSelectedPatient(p);
            }
        });
        return;
    }
    var q  = (g('psInput').value || '').trim();
    var dd = g('psDrop');
    if (!q) { dd.style.display = 'none'; return; }
    var pq = typeof patientSearchQueryBuilder === 'function'
        ? patientSearchQueryBuilder(q)
        : null;
    if (!pq) { dd.style.display = 'none'; return; }
    pq.then(function(r) {
        dd.innerHTML = '';
        if (r.error || !r.data || !r.data.length) {
            dd.innerHTML =
                '<div class="ps-item" style="color:#aaa;">' +
                esc(tr('common.psNoPatients')) + '</div>';
            dd.style.display = 'block';
            return;
        }
        r.data.forEach(function(p) {
            var item = document.createElement('div');
            item.className = 'ps-item';
            item.innerHTML =
                (p.chinese_name
                    ? '<span style="font-family:\'PingFang HK\',\'Microsoft JhengHei\',sans-serif;' +
                      'font-weight:700;font-size:14px;">' + esc(p.chinese_name) + '</span> '
                    : '') +
                '<strong>' + esc(p.full_name) + '</strong>' +
                '<br><small style="color:#aaa;">' +
                '#' + esc(p.patient_no || '-') +
                ' &nbsp;|&nbsp; ' + esc(p.phone_number || '') +
                '</small>';
            item.addEventListener('click', function() {
                apptSetSelectedPatient(p);
                dd.style.display = 'none';
            });
            dd.appendChild(item);
        });
        dd.style.display = 'block';
    });
}

// ════════════════════════════════════════════════════════════════
// APPOINTMENT REMARKS — strip internal tags before show/save
// ════════════════════════════════════════════════════════════════
function remarksStringHasHtml(s) {
    return /<[a-z][\s\S]*>/i.test(String(s || ''));
}

function stripDoctorTagsFromRemarks(remarks) {
    var r = String(remarks || '');
    r = r.replace(/\|@dr:[^|]*\|/gi, ' ');
    r = r.replace(/@dr:[^|]+/gi, ' ');
    r = r.replace(/\s*\|\s*/g, ' | ');
    r = r.replace(/^\s*\|\s*|\s*\|\s*$/g, '');
    if (remarksStringHasHtml(r)) return r.trim();
    return r.replace(/\s+/g, ' ').trim();
}

function extractPhoneFromRemarks(remarks) {
    var m = String(remarks || '').match(/(?:^|\|)\s*Ph:\s*([^|]+)/i);
    return m ? m[1].trim() : '';
}

function stripPhoneFromRemarks(remarks) {
    var r = String(remarks || '')
        .replace(/(?:^|\|)\s*Ph:\s*[^|]+/gi, '')
        .replace(/\s*\|\s*\|/g, ' | ')
        .replace(/^\s*\|\s*|\s*\|\s*$/g, '');
    if (remarksStringHasHtml(r)) return r.trim();
    return r.replace(/\s+/g, ' ').trim();
}

function remarksForApptForm(remarks) {
    return stripStaffAuthorFromRemarks(
        stripPhoneFromRemarks(stripDoctorTagsFromRemarks(remarks))
    ).trim();
}

/** Logged-in user is doctor/dentist — no staff author tag on remarks. */
function getNonDoctorRemarksAuthor() {
    if (typeof getActiveDoctorContext === 'function') {
        var ctx = getActiveDoctorContext();
        if (ctx && ctx.shouldTag) return null;
    } else {
        var role = String(typeof currentRole !== 'undefined' ? currentRole : '').toLowerCase();
        if (role === 'doctor' || role === 'dentist') return null;
    }
    var uid = typeof currentUserId !== 'undefined' ? String(currentUserId || '').trim() : '';
    var name = typeof currentName !== 'undefined' ? String(currentName || '').trim() : '';
    if (!uid && !name) return null;
    return {
        uid: uid || name,
        name: name || uid,
        role: typeof currentRole !== 'undefined' ? (currentRole || 'staff') : 'staff'
    };
}

function staffAuthorRemarksHtml(author) {
    if (!author) return '';
    var uid = esc(String(author.uid || '').trim());
    var roleRaw = String(author.role || 'staff').trim().toLowerCase();
    var nameRaw = String(author.name || author.uid || tr('common.staffFallback')).trim();
    nameRaw = stripRolePrefixFromStaffName(nameRaw, roleRaw);
    var name = esc(nameRaw);
    var role = esc(roleRaw);
    var inner = role && role !== name ? role + ' · ' + name : name;
    return '<span class="appt-rm-by" data-uid="' + uid + '" data-role="' + role + '">' + inner + '</span>';
}

function stripRolePrefixFromStaffName(name, role) {
    var n = String(name || '').trim();
    var r = String(role || '').trim().toLowerCase();
    if (!n || !r) return n;
    var escRole = r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var rx = new RegExp('^\\s*' + escRole + '\\s*(?:[·\\-:：]\\s*)+', 'i');
    return n.replace(rx, '').trim() || n;
}

function extractStaffAuthorSpan(remarks) {
    var m = String(remarks || '').match(/<span class="appt-rm-by"[^>]*>[\s\S]*?<\/span>/i);
    return m ? m[0] : '';
}

function stripStaffAuthorFromRemarks(remarks) {
    var r = String(remarks || '')
        .replace(/\s*\|\s*<span class="appt-rm-by"[^>]*>[\s\S]*?<\/span>/gi, '')
        .replace(/<span class="appt-rm-by"[^>]*>[\s\S]*?<\/span>/gi, '');
    if (remarksStringHasHtml(r)) return r.trim();
    return r.replace(/\s+/g, ' ').trim();
}

function sanitizeStaffAuthorSpan(html) {
    var s = String(html || '');
    var uidM = s.match(/\bdata-uid="([^"]*)"/i);
    var roleM = s.match(/\bdata-role="([^"]*)"/i);
    var bodyM = s.match(/<span class="appt-rm-by"[^>]*>([\s\S]*?)<\/span>/i);
    if (!bodyM) return '';
    var body = bodyM[1].replace(/<[^>]+>/g, '').trim();
    var role = roleM ? roleM[1] : 'staff';
    var cleanName = stripRolePrefixFromStaffName(body, role);
    return staffAuthorRemarksHtml({
        uid: uidM ? uidM[1] : '',
        role: role,
        name: cleanName || (uidM ? uidM[1] : tr('common.staffFallback'))
    });
}

/** Append or refresh staff author HTML when a non-doctor saves remarks. */
function mergeStaffAuthorOnSave(cleanRemarks, priorRawRemarks) {
    var rem = String(cleanRemarks || '').trim();
    var author = getNonDoctorRemarksAuthor();
    if (author) {
        var tag = staffAuthorRemarksHtml(author);
        return rem ? rem + ' | ' + tag : tag;
    }
    var priorTag = extractStaffAuthorSpan(priorRawRemarks);
    if (priorTag) rem = rem ? rem + ' | ' + sanitizeStaffAuthorSpan(priorTag) : sanitizeStaffAuthorSpan(priorTag);
    return rem || null;
}

function formatRemarksForDisplay(remarks, opts) {
    opts = opts || {};
    if (!remarks || !String(remarks).trim()) return opts.empty != null ? opts.empty : '';
    var tag = extractStaffAuthorSpan(remarks);
    var text = stripStaffAuthorFromRemarks(remarks);
    if (opts.stripDr) text = stripDoctorTagsFromRemarks(text);
    var trimmed = text.trim();
    var out = remarksStringHasHtml(trimmed)
        ? sanitizeRemarksHtml(trimmed)
        : esc(trimmed);
    if (tag) out += (out ? ' ' : '') + sanitizeStaffAuthorSpan(tag);
    return out || (opts.empty != null ? opts.empty : '');
}

// ════════════════════════════════════════════════════════════════
// APPOINTMENT REMARKS — rich editor (size / font / color)
// ════════════════════════════════════════════════════════════════
var APPT_REMARKS_RICH_SIZES = [
    { v: '12px', k: '12' },
    { v: '14px', k: '14' },
    { v: '16px', k: '16' },
    { v: '18px', k: '18' },
    { v: '20px', k: '20' },
    { v: '24px', k: '24' }
];
var APPT_REMARKS_RICH_FONTS = [
    { v: 'Arial, Helvetica, "Microsoft JhengHei", "PingFang TC", sans-serif', k: 'Arial / 正黑' },
    { v: '"Times New Roman", Times, "Songti TC", "SimSun", serif', k: 'Times New Roman' },
    { v: 'Georgia, "Times New Roman", "Songti TC", "SimSun", serif', k: 'Georgia / 宋体' },
    { v: '"Courier New", Consolas, "Microsoft JhengHei", monospace', k: 'Courier' },
    { v: '"Microsoft JhengHei", "PingFang TC", sans-serif', k: '微軟正黑體' },
    { v: 'SimSun, "Songti TC", "PMingLiU", serif', k: '新細明體' },
    { v: 'KaiTi, "STKaiti", "KaiTi SC", serif', k: '楷体' }
];
var APPT_REMARKS_RICH_COLORS = [
    '#334155', '#0f172a', '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#10b981', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#a855f7',
    '#ec4899', '#f43f5e', '#ffffff', '#000000'
];

function remarksRichTr(key) {
    return (typeof tr === 'function') ? tr(key) : key;
}

function sanitizeRemarksHtml(html) {
    var allowed = { span: 1, b: 1, strong: 1, i: 1, em: 1, u: 1, br: 1, font: 1, div: 1, p: 1 };
    var styleOk = {
        'font-size': 1, 'font-family': 1, color: 1,
        'font-weight': 1, 'font-style': 1, 'text-decoration': 1
    };
    var tmp = document.createElement('div');
    tmp.innerHTML = String(html || '');
    remarksRichSanitizeNode(tmp, allowed, styleOk);
    var out = tmp.innerHTML;
    out = out.replace(/<div><br><\/div>/gi, '<br>');
    out = out.replace(/<p><br><\/p>/gi, '<br>');
    return out.trim();
}

function remarksRichSanitizeNode(node, allowed, styleOk) {
    var kids = [];
    for (var i = 0; i < node.childNodes.length; i++) kids.push(node.childNodes[i]);
    kids.forEach(function(ch) {
        if (ch.nodeType === 1) {
            var tag = ch.tagName.toLowerCase();
            if (!allowed[tag]) {
                while (ch.firstChild) node.insertBefore(ch.firstChild, ch);
                node.removeChild(ch);
                return;
            }
            var attrs = [];
            for (var a = 0; a < ch.attributes.length; a++) attrs.push(ch.attributes[a]);
            if (ch.classList) {
                if (ch.classList.contains('ql-size-small')) ch.style.fontSize = '0.75em';
                if (ch.classList.contains('ql-size-large')) ch.style.fontSize = '1.5em';
                if (ch.classList.contains('ql-size-huge')) ch.style.fontSize = '2.5em';
                if (ch.classList.contains('ql-font-serif')) {
                    ch.style.fontFamily = 'Georgia, "Times New Roman", "Songti TC", serif';
                }
                if (ch.classList.contains('ql-font-monospace')) {
                    ch.style.fontFamily = '"Courier New", Consolas, monospace';
                }
            }
            attrs.forEach(function(attr) {
                var n = attr.name.toLowerCase();
                if (n.indexOf('on') === 0 || n === 'class' || n === 'id') {
                    ch.removeAttribute(attr.name);
                }
            });
            if (tag === 'font') {
                var fs = ch.getAttribute('size');
                var fc = ch.getAttribute('color');
                var ff = ch.getAttribute('face');
                var st = [];
                if (fc) st.push('color:' + fc);
                if (ff) st.push('font-family:' + ff);
                if (fs) st.push('font-size:' + fs + 'px');
                if (st.length) ch.setAttribute('style', st.join(';'));
                ch.removeAttribute('size');
                ch.removeAttribute('color');
                ch.removeAttribute('face');
            }
            var styleRaw = ch.getAttribute('style');
            if (styleRaw) {
                var clean = remarksRichCleanStyle(styleRaw, styleOk);
                if (clean) ch.setAttribute('style', clean);
                else ch.removeAttribute('style');
            }
            remarksRichSanitizeNode(ch, allowed, styleOk);
        }
    });
}

function remarksRichCleanStyle(raw, styleOk) {
    var parts = String(raw || '').split(';');
    var out = [];
    parts.forEach(function(p) {
        var kv = p.split(':');
        if (kv.length < 2) return;
        var prop = kv[0].trim().toLowerCase();
        var val = kv.slice(1).join(':').trim();
        if (!styleOk[prop] || !val) return;
        if (/javascript\s*:/i.test(val)) return;
        out.push(prop + ':' + val);
    });
    return out.join(';');
}

function remarksRichGetEditor(wrap) {
    if (!wrap) return null;
    var id = wrap.getAttribute('data-editor-id');
    return id ? g(id) : null;
}

/** Per-editor saved text selection (survives color-picker focus loss). */
var _remarksRichSelByEditor = {};

function remarksRichSaveSelection(editor) {
    if (!editor) return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    try {
        _remarksRichSelByEditor[editor.id] = range.cloneRange();
        _remarksRichSelByEditor[editor.id + '__nc'] = !range.collapsed;
    } catch (e) {}
}

/** Save before toolbar click; keep stored highlight if focus would collapse it. */
function remarksRichSaveSelectionForToolbar(editor) {
    if (!editor) return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    if (range.collapsed && remarksRichHadStoredRangeSelection(editor)) return;
    remarksRichSaveSelection(editor);
}

function remarksRichClearStoredRange(editor) {
    if (!editor) return;
    delete _remarksRichSelByEditor[editor.id + '__nc'];
}

function remarksRichHadStoredRangeSelection(editor) {
    return !!_remarksRichSelByEditor[editor.id + '__nc'];
}

function remarksRichIsMarkerOnlySpan(span) {
    if (!span) return false;
    var t = String(span.textContent || '').replace(/\u200b/g, '');
    return !t.trim();
}

function remarksRichCreateTypingSpan(styleObj) {
    var span = document.createElement('span');
    span.className = 'appt-rm-typing';
    if (styleObj.color) span.style.color = styleObj.color;
    if (styleObj.fontSize) span.style.fontSize = styleObj.fontSize;
    if (styleObj.fontFamily) span.style.fontFamily = styleObj.fontFamily;
    return span;
}

function remarksRichSetCaretInSpan(span) {
    if (!span) return;
    var sel = window.getSelection();
    if (!sel) return;
    var nr = document.createRange();
    nr.setStart(span, 0);
    nr.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nr);
}

function remarksRichFinalizeTypingSpan(span) {
    if (span && span.classList) span.classList.remove('appt-rm-typing');
}

function remarksRichSpanHasInlineStyle(span) {
    if (!span || span.tagName !== 'SPAN') return false;
    return !!(span.style.color || span.style.fontSize || span.style.fontFamily ||
        remarksRichGetInlineColorFromElement(span));
}

function remarksRichSpanMatchesStyle(span, styleObj) {
    if (!span || !styleObj) return false;
    if (styleObj.color) {
        var spanColor = remarksRichGetInlineColorFromElement(span) || span.style.color;
        if (remarksRichToHexColor(spanColor) !== remarksRichToHexColor(styleObj.color)) {
            return false;
        }
    }
    if (styleObj.fontFamily && span.style.fontFamily !== styleObj.fontFamily) return false;
    if (styleObj.fontSize && span.style.fontSize !== styleObj.fontSize) return false;
    return true;
}

/** Split a styled span at the caret and open a new sibling span (multi-color per line). */
function remarksRichSplitHostSpanAtCaret(editor, hostSpan, styleObj) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!range.collapsed || !editor.contains(range.commonAncestorContainer)) return null;
    if (!hostSpan || !hostSpan.parentNode) return null;

    remarksRichFinalizeTypingSpan(hostSpan);
    var parent = hostSpan.parentNode;
    var newSpan = remarksRichCreateTypingSpan(styleObj);
    var container = range.startContainer;
    var offset = range.startOffset;

    if (container.nodeType === 3 && hostSpan.contains(container)) {
        if (offset === 0) {
            parent.insertBefore(newSpan, hostSpan);
        } else if (offset >= container.length) {
            parent.insertBefore(newSpan, hostSpan.nextSibling);
        } else {
            var tail = container.splitText(offset);
            newSpan.appendChild(tail);
            parent.insertBefore(newSpan, hostSpan.nextSibling);
        }
    } else if (container.nodeType === 1 && hostSpan.contains(container)) {
        parent.insertBefore(newSpan, hostSpan.nextSibling);
    } else {
        parent.insertBefore(newSpan, hostSpan.nextSibling);
    }

    remarksRichSetCaretInSpan(newSpan);
    return newSpan;
}

function remarksRichFindTypingSpanAtCaret(editor) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    var node = sel.anchorNode;
    if (!node || !editor.contains(node)) return null;
    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== editor) {
        if (el.tagName === 'SPAN' && el.classList.contains('appt-rm-typing')) return el;
        el = el.parentElement;
    }
    return null;
}

function remarksRichClearColorsInNode(node) {
    if (!node) return;
    if (node.nodeType === 1) {
        if (node.style && node.style.color) node.style.color = '';
        if (node.tagName === 'FONT') node.removeAttribute('color');
    }
    var ch = node.childNodes;
    for (var i = ch.length - 1; i >= 0; i--) remarksRichClearColorsInNode(ch[i]);
}

function remarksRichApplyInlineToRange(editor, styleObj) {
    if (!editor || !styleObj) return false;
    remarksRichRestoreSelection(editor);
    editor.focus();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer) || range.collapsed) return false;

    var frag = range.extractContents();
    if (styleObj.color) remarksRichClearColorsInNode(frag);
    var span = document.createElement('span');
    if (styleObj.color) span.style.color = styleObj.color;
    if (styleObj.fontSize) span.style.fontSize = styleObj.fontSize;
    if (styleObj.fontFamily) span.style.fontFamily = styleObj.fontFamily;
    span.appendChild(frag);
    range.insertNode(span);

    sel.removeAllRanges();
    var nr = document.createRange();
    nr.selectNodeContents(span);
    nr.collapse(false);
    sel.addRange(nr);

    if (styleObj.color) editor.dataset.rmTypingColor = styleObj.color;
    if (styleObj.fontFamily) editor.dataset.rmTypingFont = styleObj.fontFamily;
    remarksRichClearStoredRange(editor);
    remarksRichSaveSelection(editor);
    return true;
}

function remarksRichApplyColorToRange(editor, hexColor) {
    return remarksRichApplyInlineToRange(editor, { color: hexColor });
}

/** Place typing-style span at caret only — does not change text before the caret. */
function remarksRichPlaceTypingSpanAtCaret(editor, styleObj) {
    styleObj = styleObj || {};
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!range.collapsed || !editor.contains(range.commonAncestorContainer)) return null;

    var marker = remarksRichFindTypingSpanAtCaret(editor);
    if (marker && remarksRichIsMarkerOnlySpan(marker)) {
        if (styleObj.color) marker.style.color = styleObj.color;
        if (styleObj.fontSize) marker.style.fontSize = styleObj.fontSize;
        if (styleObj.fontFamily) marker.style.fontFamily = styleObj.fontFamily;
        remarksRichSetCaretInSpan(marker);
        return marker;
    }

    var hostSpan = remarksRichFindStyleSpanAtCaret(editor);
    if (hostSpan && remarksRichSpanHasInlineStyle(hostSpan) &&
        !remarksRichSpanMatchesStyle(hostSpan, styleObj)) {
        return remarksRichSplitHostSpanAtCaret(editor, hostSpan, styleObj);
    }

    if (hostSpan && remarksRichSpanMatchesStyle(hostSpan, styleObj)) {
        hostSpan.classList.add('appt-rm-typing');
        remarksRichSetCaretInSpan(hostSpan);
        return hostSpan;
    }

    var span = remarksRichCreateTypingSpan(styleObj);
    var container = range.startContainer;
    var offset = range.startOffset;
    var styledWrap = hostSpan && remarksRichSpanHasInlineStyle(hostSpan) ? hostSpan : null;

    if (container.nodeType === 3) {
        var tn = container;
        var parent = tn.parentNode;
        if (styledWrap && styledWrap.contains(tn) && styleObj.color) {
            if (offset >= tn.length) {
                styledWrap.parentNode.insertBefore(span, styledWrap.nextSibling);
            } else if (offset === 0) {
                styledWrap.parentNode.insertBefore(span, styledWrap);
            } else {
                var tail2 = tn.splitText(offset);
                span.appendChild(tail2);
                styledWrap.parentNode.insertBefore(span, styledWrap.nextSibling);
            }
        } else if (offset === 0) {
            parent.insertBefore(span, tn);
        } else if (offset >= tn.length) {
            if (tn.nextSibling) parent.insertBefore(span, tn.nextSibling);
            else parent.appendChild(span);
        } else {
            var tail = tn.splitText(offset);
            span.appendChild(tail);
            parent.insertBefore(span, tail);
        }
    } else if (container.nodeType === 1) {
        if (styledWrap && styleObj.color) {
            styledWrap.parentNode.insertBefore(span, styledWrap.nextSibling);
        } else {
            var ref = container.childNodes[offset] || null;
            container.insertBefore(span, ref);
        }
    }

    remarksRichSetCaretInSpan(span);
    return span;
}

function remarksRichRestoreSelection(editor) {
    if (!editor) return false;
    var range = _remarksRichSelByEditor[editor.id];
    if (!range) return false;
    try {
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return true;
    } catch (e2) {
        return false;
    }
}

var APPT_REMARKS_DEFAULT_COLOR = '#334155';

function remarksRichToHexColor(cssColor) {
    var s = String(cssColor || '').trim();
    if (!s) return APPT_REMARKS_DEFAULT_COLOR;
    if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(s)) {
        return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    var m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (m) {
        return '#' + [m[1], m[2], m[3]].map(function(n) {
            return ('0' + parseInt(n, 10).toString(16)).slice(-2);
        }).join('');
    }
    try {
        var probe = document.createElement('span');
        probe.style.color = s;
        document.body.appendChild(probe);
        var resolved = window.getComputedStyle(probe).color;
        document.body.removeChild(probe);
        if (resolved && resolved !== s) return remarksRichToHexColor(resolved);
    } catch (eProbe) {}
    return APPT_REMARKS_DEFAULT_COLOR;
}

function remarksRichGetInlineColorFromElement(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.tagName === 'FONT') {
        var fc = el.getAttribute('color');
        if (fc) return fc;
    }
    if (el.style && el.style.color) return el.style.color;
    var st = el.getAttribute('style') || '';
    var m = st.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    return m ? m[1].trim() : '';
}

/** Color at caret or start of selection (for toolbar picker). */
function remarksRichGetCaretColor(editor) {
    if (!editor) return APPT_REMARKS_DEFAULT_COLOR;
    var sel = window.getSelection();
    var range = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
    if (!range || !editor.contains(range.commonAncestorContainer)) {
        var stored = _remarksRichSelByEditor[editor.id];
        if (stored) {
            try { range = stored.cloneRange(); } catch (eSt) { range = null; }
        }
    }
    if (!range) return APPT_REMARKS_DEFAULT_COLOR;

    var node = range.startContainer;
    if (node.nodeType === 1) {
        var child = node.childNodes[range.startOffset];
        if (!child && range.startOffset > 0) child = node.childNodes[range.startOffset - 1];
        if (child) node = child;
    }
    if (!node) return APPT_REMARKS_DEFAULT_COLOR;

    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== editor) {
        if (el.tagName === 'SPAN' || el.tagName === 'FONT') {
            var inline = remarksRichGetInlineColorFromElement(el);
            if (inline) return remarksRichToHexColor(inline);
        }
        el = el.parentElement;
    }

    el = node.nodeType === 3 ? node.parentElement : node;
    if (el && el !== editor) {
        var comp = window.getComputedStyle(el).color;
        if (comp) return remarksRichToHexColor(comp);
    }
    return APPT_REMARKS_DEFAULT_COLOR;
}

/** Nearest styled span wrapping the caret (for typing color sync). */
function remarksRichFindStyleSpanAtCaret(editor) {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return null;
    var node = sel.anchorNode;
    if (!node || !editor.contains(node)) return null;
    var el = node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== editor) {
        if (el.tagName === 'SPAN' && remarksRichSpanHasInlineStyle(el)) return el;
        el = el.parentElement;
    }
    return null;
}

function remarksRichApplyFormat(editor, styleObj) {
    if (!editor || !styleObj) return;
    remarksRichRestoreSelection(editor);
    editor.focus();
    if (styleObj.color) editor.dataset.rmTypingColor = styleObj.color;
    if (styleObj.fontFamily) editor.dataset.rmTypingFont = styleObj.fontFamily;

    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    if (!range.collapsed) {
        remarksRichApplyInlineToRange(editor, styleObj);
    } else {
        remarksRichPlaceTypingSpanAtCaret(editor, styleObj);
        remarksRichSaveSelection(editor);
    }
    remarksRichSyncColorPickerFromCaret(editor, editor._remarksRichWrap);
}

function remarksRichInsertTypingSpan(editor, styleObj) {
    if (styleObj.color || styleObj.fontFamily || styleObj.fontSize) {
        return remarksRichPlaceTypingSpanAtCaret(editor, styleObj);
    }
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer) || !range.collapsed) return null;

    var span = document.createElement('span');
    span.className = 'appt-rm-typing';
    if (styleObj.fontSize) span.style.fontSize = styleObj.fontSize;
    if (styleObj.fontFamily) span.style.fontFamily = styleObj.fontFamily;

    range.insertNode(span);
    var r = document.createRange();
    r.setStart(span, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return span;
}

function remarksRichApplyColor(editor, hexColor) {
    if (!editor || !hexColor) return;
    editor.dataset.rmTypingColor = hexColor;
    remarksRichApplyFormat(editor, { color: hexColor });
    var wrap = editor._remarksRichWrap;
    if (wrap) {
        remarksRichSetPickerInputValue(wrap, hexColor);
        remarksRichSetColorChip(wrap, hexColor);
        remarksRichMarkSwatchSelection(wrap, hexColor);
    }
}

function remarksRichSetColorChip(wrap, hex) {
    if (!wrap || !hex) return;
    var chip = wrap.querySelector('.appt-remarks-fmt-color-chip');
    if (chip) chip.style.background = hex;
}

function remarksRichNormalizeHex(val, fallback) {
    var s = String(val || '').trim().toLowerCase();
    if (!s) return (fallback || APPT_REMARKS_DEFAULT_COLOR);
    if (s[0] !== '#') s = '#' + s;
    if (/^#[0-9a-f]{3}$/i.test(s)) {
        return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    }
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    return (fallback || APPT_REMARKS_DEFAULT_COLOR);
}

function remarksRichSetPickerInputValue(wrap, hex) {
    if (!wrap) return;
    var inp = wrap.querySelector('.appt-remarks-fmt-color-hex');
    if (inp) inp.value = hex;
    var nativeInp = wrap.querySelector('.appt-remarks-fmt-color-native');
    if (nativeInp) nativeInp.value = hex;
}

function remarksRichMarkSwatchSelection(wrap, hex) {
    if (!wrap) return;
    var sw = wrap.querySelectorAll('.appt-remarks-fmt-color-swatch');
    for (var i = 0; i < sw.length; i++) {
        var on = (sw[i].getAttribute('data-color') || '').toLowerCase() === String(hex || '').toLowerCase();
        if (on) sw[i].classList.add('is-selected');
        else sw[i].classList.remove('is-selected');
    }
}

/** Picker: apply to selection or set active typing color; optionally close panel. */
function remarksRichApplyPickerColor(editor, wrap, hex, closePicker) {
    if (!editor || !hex) return;
    hex = remarksRichNormalizeHex(hex, APPT_REMARKS_DEFAULT_COLOR);
    editor.dataset.rmTypingColor = hex;
    if (!closePicker) return;

    remarksRichRestoreSelection(editor);
    editor.focus();

    var sel = window.getSelection();
    var range = (sel && sel.rangeCount) ? sel.getRangeAt(0) : null;
    if (range && !range.collapsed && editor.contains(range.commonAncestorContainer)) {
        remarksRichApplyInlineToRange(editor, { color: hex });
    } else {
        remarksRichPlaceTypingSpanAtCaret(editor, { color: hex });
        remarksRichSaveSelection(editor);
    }

    remarksRichSetPickerInputValue(wrap, hex);
    remarksRichSetColorChip(wrap, hex);
    remarksRichMarkSwatchSelection(wrap, hex);
    if (closePicker) {
        setTimeout(function() {
            editor.focus();
            remarksRichSaveSelection(editor);
            remarksRichSyncColorPickerFromCaret(editor, wrap);
        }, 0);
    }
}

function remarksRichSetPendingColor(editor, wrap, hex) {
    if (!editor) return;
    hex = remarksRichNormalizeHex(hex, APPT_REMARKS_DEFAULT_COLOR);
    editor.dataset.rmPendingColor = hex;
    remarksRichSetPickerInputValue(wrap, hex);
    remarksRichSetColorChip(wrap, hex);
    remarksRichMarkSwatchSelection(wrap, hex);
}

function remarksRichCommitPendingColor(editor, wrap) {
    if (!editor) return;
    var hex = editor.dataset.rmPendingColor || '';
    if (!hex) return;
    remarksRichApplyPickerColor(editor, wrap, hex, true);
    delete editor.dataset.rmPendingColor;
}

function remarksRichSyncColorPickerFromCaret(editor, wrap) {
    if (!editor || !wrap) return;
    var colorInp = wrap.querySelector('.appt-remarks-fmt-color-hex');
    if (colorInp && document.activeElement === colorInp) return;
    var hex = remarksRichGetCaretColor(editor);
    editor.dataset.rmTypingColor = hex;
    remarksRichSetPickerInputValue(wrap, hex);
    remarksRichSetColorChip(wrap, hex);
    remarksRichMarkSwatchSelection(wrap, hex);
}

function remarksRichEnsureTypingColorOnInput(editor) {
    var hex = editor.dataset.rmTypingColor;
    var font = editor.dataset.rmTypingFont;
    if (!hex && !font) return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
    if (!editor.contains(sel.anchorNode)) return;

    var styleObj = {};
    if (hex) styleObj.color = hex;
    if (font) styleObj.fontFamily = font;

    var ty = remarksRichFindTypingSpanAtCaret(editor);
    if (ty) {
        if (remarksRichIsMarkerOnlySpan(ty)) {
            if (hex && remarksRichToHexColor(ty.style.color) !== hex) ty.style.color = hex;
            if (font && ty.style.fontFamily !== font) ty.style.fontFamily = font;
            return;
        }
        if (remarksRichSpanMatchesStyle(ty, styleObj)) return;
        remarksRichSplitHostSpanAtCaret(editor, ty, styleObj);
        return;
    }

    var hostSpan = remarksRichFindStyleSpanAtCaret(editor);
    if (hostSpan && remarksRichSpanHasInlineStyle(hostSpan) &&
        !remarksRichSpanMatchesStyle(hostSpan, styleObj)) {
        remarksRichSplitHostSpanAtCaret(editor, hostSpan, styleObj);
        return;
    }

    remarksRichPlaceTypingSpanAtCaret(editor, styleObj);
}

function remarksRichCleanupEditorHtml(html) {
    var tmp = document.createElement('div');
    tmp.innerHTML = String(html || '');
    var typing = tmp.querySelectorAll('span.appt-rm-typing');
    for (var i = 0; i < typing.length; i++) {
        var sp = typing[i];
        var t = String(sp.textContent || '').replace(/\u200b/g, '');
        if (!t.trim()) {
            sp.parentNode.removeChild(sp);
        } else {
            sp.classList.remove('appt-rm-typing');
        }
    }
    return tmp.innerHTML.replace(/\u200b/g, '');
}

function remarksRichBuildToolbar(wrap) {
    var bar = wrap.querySelector('.appt-remarks-rich-toolbar');
    if (!bar || bar.dataset.built === '1') return;
    bar.dataset.built = '1';

    var sizeGrp = document.createElement('div');
    sizeGrp.className = 'appt-remarks-fmt-group';
    sizeGrp.innerHTML =
        '<label><span data-i18n="appt.remarksRich.size"></span> ' +
        '<select class="appt-remarks-fmt-size" title="' + esc(remarksRichTr('appt.remarksRich.size')) + '">' +
        '<option value="">' + esc(remarksRichTr('appt.remarksRich.sizeDefault')) + '</option>' +
        APPT_REMARKS_RICH_SIZES.map(function(s) {
            return '<option value="' + esc(s.v) + '">' + esc(s.k) + '</option>';
        }).join('') +
        '</select></label>';
    bar.appendChild(sizeGrp);

    var famGrp = document.createElement('div');
    famGrp.className = 'appt-remarks-fmt-group';
    famGrp.innerHTML =
        '<label><span data-i18n="appt.remarksRich.style"></span> ' +
        '<select class="appt-remarks-fmt-family" title="' + esc(remarksRichTr('appt.remarksRich.style')) + '">' +
        '<option value="">' + esc(remarksRichTr('appt.remarksRich.styleDefault')) + '</option>' +
        APPT_REMARKS_RICH_FONTS.map(function(f) {
            return '<option value="' + esc(f.v) + '" style="font-family:' + esc(f.v) + '">' +
                esc(f.k) + '</option>';
        }).join('') +
        '</select></label>';
    bar.appendChild(famGrp);

    var colGrp = document.createElement('div');
    colGrp.className = 'appt-remarks-fmt-group appt-remarks-fmt-color-group';
    colGrp.innerHTML =
        '<span data-i18n="appt.remarksRich.color"></span>' +
        '<button type="button" class="appt-remarks-fmt-color-trigger" title="' +
            esc(remarksRichTr('appt.remarksRich.color')) + '">' +
            '<span class="appt-remarks-fmt-color-chip" style="background:' +
                APPT_REMARKS_DEFAULT_COLOR + ';"></span>' +
        '</button>' +
        '<div class="appt-remarks-fmt-color-pop" hidden>' +
            '<div class="appt-remarks-fmt-color-swatches">' +
                APPT_REMARKS_RICH_COLORS.map(function(c) {
                    return '<button type="button" class="appt-remarks-fmt-color-swatch" data-color="' +
                        c + '" style="background:' + c + ';"></button>';
                }).join('') +
            '</div>' +
            '<div class="appt-remarks-fmt-color-row">' +
                '<input type="text" class="appt-remarks-fmt-color-hex" value="' + APPT_REMARKS_DEFAULT_COLOR + '"' +
                    ' maxlength="7" spellcheck="false">' +
            '</div>' +
            '<div class="appt-remarks-fmt-color-row">' +
                '<input type="color" class="appt-remarks-fmt-color-native" value="' + APPT_REMARKS_DEFAULT_COLOR + '">' +
            '</div>' +
            '<div class="appt-remarks-fmt-color-actions">' +
                '<button type="button" class="appt-remarks-fmt-color-ok">OK</button>' +
                '<button type="button" class="appt-remarks-fmt-color-cancel">Cancel</button>' +
            '</div>' +
        '</div>';
    bar.appendChild(colGrp);

    var boldBtn = document.createElement('button');
    boldBtn.type = 'button';
    boldBtn.className = 'appt-remarks-fmt-btn';
    boldBtn.setAttribute('data-fmt', 'bold');
    boldBtn.setAttribute('data-i18n', 'appt.remarksRich.bold');
    boldBtn.textContent = 'B';
    bar.appendChild(boldBtn);

    var italicBtn = document.createElement('button');
    italicBtn.type = 'button';
    italicBtn.className = 'appt-remarks-fmt-btn';
    italicBtn.setAttribute('data-fmt', 'italic');
    italicBtn.setAttribute('data-i18n', 'appt.remarksRich.italic');
    italicBtn.textContent = 'I';
    bar.appendChild(italicBtn);

    if (typeof applyI18nInRoot === 'function') applyI18nInRoot(bar);
}

function remarksRichApplyStyle(editor, styleObj) {
    if (!editor || !styleObj) return;
    if (styleObj.color || styleObj.fontFamily || styleObj.fontSize) {
        remarksRichApplyFormat(editor, styleObj);
        return;
    }
    editor.focus();
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;

    var span = document.createElement('span');
    if (styleObj.fontWeight) span.style.fontWeight = styleObj.fontWeight;
    if (styleObj.fontStyle) span.style.fontStyle = styleObj.fontStyle;

    try {
        range.surroundContents(span);
    } catch (e2) {
        var frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
    }
    sel.removeAllRanges();
    var nr = document.createRange();
    nr.selectNodeContents(span);
    nr.collapse(false);
    sel.addRange(nr);
}

function remarksRichToggleBtn(editor, cmd) {
    if (!editor) return;
    editor.focus();
    try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
    document.execCommand(cmd, false, null);
}

function remarksRichWireWrap(wrap) {
    remarksRichBuildToolbar(wrap);
    var editor = remarksRichGetEditor(wrap);
    if (!editor || wrap.dataset.wired === '1') return;
    wrap.dataset.wired = '1';

    var edPh = editor.getAttribute('data-i18n-placeholder');
    if (edPh && typeof remarksRichTr === 'function') {
        editor.setAttribute('data-placeholder', remarksRichTr(edPh));
    }

    editor._remarksRichWrap = wrap;

    function remarksRichOnCaretMove() {
        remarksRichSaveSelection(editor);
        var selNow = window.getSelection();
        if (selNow && selNow.rangeCount && selNow.isCollapsed) {
            remarksRichClearStoredRange(editor);
        }
        remarksRichSyncColorPickerFromCaret(editor, wrap);
    }

    editor.addEventListener('mouseup', remarksRichOnCaretMove);
    editor.addEventListener('keyup', remarksRichOnCaretMove);
    editor.addEventListener('click', remarksRichOnCaretMove);
    editor.addEventListener('focus', remarksRichOnCaretMove);
    editor.addEventListener('blur', function() {
        remarksRichSaveSelection(editor);
    });

    if (!wrap._remarksSelChangeBound) {
        wrap._remarksSelChangeBound = true;
        document.addEventListener('selectionchange', function() {
            if (!wrap.isConnected || !editor.isConnected) return;
            var ae = document.activeElement;
            if (ae && ae.classList && ae.classList.contains('appt-remarks-fmt-color-hex')) return;
            var sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            if (!editor.contains(sel.anchorNode) && !editor.contains(sel.focusNode)) return;
            remarksRichSyncColorPickerFromCaret(editor, wrap);
        });
    }
    editor.addEventListener('input', function() {
        remarksRichEnsureTypingColorOnInput(editor);
    });
    editor.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        var hex = editor.dataset.rmTypingColor;
        var font = editor.dataset.rmTypingFont;
        var ty = remarksRichFindTypingSpanAtCaret(editor);
        if (ty) remarksRichFinalizeTypingSpan(ty);
        var host = remarksRichFindStyleSpanAtCaret(editor);
        if (host && host !== ty) remarksRichFinalizeTypingSpan(host);
        if (!hex && !font) return;
        setTimeout(function() {
            var styleObj = {};
            if (hex) styleObj.color = hex;
            if (font) styleObj.fontFamily = font;
            remarksRichPlaceTypingSpanAtCaret(editor, styleObj);
            remarksRichSaveSelection(editor);
        }, 0);
    });

    wrap.addEventListener('mousedown', function(e) {
        var t = e.target;
        var bar = t.closest ? t.closest('.appt-remarks-rich-toolbar') : null;
        if (!bar || !wrap.contains(bar)) return;
        remarksRichSaveSelectionForToolbar(editor);
    }, true);

    var colorInp = wrap.querySelector('.appt-remarks-fmt-color-hex');
    var colorNativeInp = wrap.querySelector('.appt-remarks-fmt-color-native');
    var colorPop = wrap.querySelector('.appt-remarks-fmt-color-pop');
    var colorTrig = wrap.querySelector('.appt-remarks-fmt-color-trigger');
    var colorCancelBtn = wrap.querySelector('.appt-remarks-fmt-color-cancel');
    if (colorInp) {
        colorInp.addEventListener('focus', function() {
            remarksRichSaveSelectionForToolbar(editor);
        });
        colorInp.addEventListener('input', function() {
            remarksRichSetPendingColor(editor, wrap, colorInp.value);
        });
        colorInp.addEventListener('blur', function() {
            colorInp.value = remarksRichNormalizeHex(colorInp.value, editor.dataset.rmPendingColor || APPT_REMARKS_DEFAULT_COLOR);
        });
    }
    if (colorNativeInp) {
        colorNativeInp.addEventListener('input', function() {
            remarksRichSetPendingColor(editor, wrap, colorNativeInp.value);
        });
        colorNativeInp.addEventListener('change', function() {
            remarksRichSetPendingColor(editor, wrap, colorNativeInp.value);
        });
    }

    var colorOkBtn = wrap.querySelector('.appt-remarks-fmt-color-ok');
    if (colorOkBtn) {
        colorOkBtn.addEventListener('click', function(e) {
            e.preventDefault();
            remarksRichCommitPendingColor(editor, wrap);
            if (colorPop) colorPop.hidden = true;
        });
    }
    if (colorCancelBtn) {
        colorCancelBtn.addEventListener('click', function(e) {
            e.preventDefault();
            delete editor.dataset.rmPendingColor;
            if (colorPop) colorPop.hidden = true;
            remarksRichSyncColorPickerFromCaret(editor, wrap);
            editor.focus();
        });
    }
    if (colorPop) {
        colorPop.addEventListener('mousedown', function(e) {
            e.stopPropagation();
        });
        colorPop.addEventListener('click', function(e) {
            var sw = e.target && e.target.closest ? e.target.closest('.appt-remarks-fmt-color-swatch') : null;
            if (!sw || !colorPop.contains(sw)) return;
            e.preventDefault();
            var c = sw.getAttribute('data-color') || APPT_REMARKS_DEFAULT_COLOR;
            remarksRichSetPendingColor(editor, wrap, c);
        });
    }
    if (colorTrig && colorPop && colorInp) {
        colorTrig.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            remarksRichSaveSelectionForToolbar(editor);
            var hexNow = remarksRichGetCaretColor(editor);
            remarksRichSetPendingColor(editor, wrap, hexNow);
            colorPop.hidden = !colorPop.hidden;
            if (!colorPop.hidden) colorInp.focus();
        });
        document.addEventListener('mousedown', function(e) {
            if (!colorPop || colorPop.hidden) return;
            if (!wrap.isConnected) return;
            if (wrap.contains(e.target)) return;
            delete editor.dataset.rmPendingColor;
            remarksRichSyncColorPickerFromCaret(editor, wrap);
            colorPop.hidden = true;
        });
    }

    wrap.addEventListener('mousedown', function(e) {
        var t = e.target;
        if (t.classList && (
            t.classList.contains('appt-remarks-fmt-size') ||
            t.classList.contains('appt-remarks-fmt-family')
        )) {
            remarksRichSaveSelectionForToolbar(editor);
        }
    });

    wrap.addEventListener('change', function(e) {
        var t = e.target;
        if (t.classList && t.classList.contains('appt-remarks-fmt-color-hex')) return;
        if (t.classList && t.classList.contains('appt-remarks-fmt-size') && t.value) {
            remarksRichApplyFormat(editor, { fontSize: t.value });
            t.value = '';
            return;
        }
        if (t.classList && t.classList.contains('appt-remarks-fmt-family') && t.value) {
            remarksRichApplyFormat(editor, { fontFamily: t.value });
            t.value = '';
        }
    });

    wrap.addEventListener('click', function(e) {
        var btn = e.target.closest ? e.target.closest('[data-fmt]') : null;
        if (!btn || !wrap.contains(btn)) return;
        e.preventDefault();
        var fmt = btn.getAttribute('data-fmt');
        if (fmt === 'bold') remarksRichToggleBtn(editor, 'bold');
        else if (fmt === 'italic') remarksRichToggleBtn(editor, 'italic');
    });
}

function initApptRemarksRichEditors() {
    var wraps = document.querySelectorAll('.appt-remarks-rich');
    for (var i = 0; i < wraps.length; i++) remarksRichWireWrap(wraps[i]);
}

function refreshApptRemarksEditorPlaceholders() {
    ['queueRemarksEditor', 'fRemarksEditor'].forEach(function(id) {
        var ed = g(id);
        if (!ed) return;
        var k = ed.getAttribute('data-i18n-placeholder');
        if (k) ed.setAttribute('data-placeholder', remarksRichTr(k));
    });
}

function setApptRemarksEditorHtml(editorId, rawRemarks) {
    initApptRemarksRichEditors();
    var ed = g(editorId);
    if (!ed) return;
    var body = remarksForApptForm(rawRemarks);
    delete ed.dataset.rmTypingColor;
    if (remarksStringHasHtml(body)) {
        ed.innerHTML = sanitizeRemarksHtml(body);
    } else {
        ed.textContent = body;
    }
    var wrap = ed._remarksRichWrap;
    if (wrap) remarksRichSyncColorPickerFromCaret(ed, wrap);
}

function clearApptRemarksEditor(editorId) {
    var ed = g(editorId);
    if (!ed) return;
    ed.innerHTML = '';
}

function getApptRemarksEditorValue(editorId) {
    var ed = g(editorId);
    if (!ed) return '';
    var html = ed.innerHTML || '';
    if (!html.replace(/<br\s*\/?>/gi, '').replace(/&nbsp;/gi, '').replace(/\u200b/g, '').trim()) {
        return '';
    }
    html = remarksRichCleanupEditorHtml(html);
    return sanitizeRemarksHtml(html);
}

function remarksFromEditor(editorId) {
    return remarksForApptForm(getApptRemarksEditorValue(editorId));
}

function embedDoctorTagInRemarks(payload, code) {
    if (!code) return;
    var staffTag = extractStaffAuthorSpan(payload.remarks || '');
    var rem = stripDoctorTagsFromRemarks(stripStaffAuthorFromRemarks(payload.remarks || ''));
    payload.remarks = (rem ? rem + ' | ' : '') + '|@dr:' + code + '|';
    if (staffTag) payload.remarks += ' | ' + sanitizeStaffAuthorSpan(staffTag);
}

// ════════════════════════════════════════════════════════════════
// APPOINTMENT MODAL  — open / save
// ════════════════════════════════════════════════════════════════
// ── Toggle between "Existing Patient" search and "New / Walk-in" mode ──
function switchApptPatientMode(mode) {
    var existSection = g('psSectionExist');
    var newSection   = g('psSectionNew');
    var existBtn     = g('psModeExistBtn');
    var newBtn       = g('psModeNewBtn');
    if (!existSection || !newSection) return;

    if (mode === 'new') {
        existSection.style.display = 'none';
        newSection.style.display   = '';
        existBtn.style.background  = '#fff';
        existBtn.style.color       = '#94a3b8';
        newBtn.style.background    = '#f59e0b';
        newBtn.style.color         = '#fff';
    } else {
        existSection.style.display = '';
        newSection.style.display   = 'none';
        existBtn.style.background  = '#0084ff';
        existBtn.style.color       = '#fff';
        newBtn.style.background    = '#fff';
        newBtn.style.color         = '#94a3b8';
        // Clear new-patient inputs when switching back
        sv('npName',  '');
        sv('npPhone', '');
    }
}

function resetApptBookingGuards() {
    arBookingMinDateToday = false;
    var fd = g('fDate');
    if (fd) fd.removeAttribute('min');
}

function openApptModalWithPatient(iso, time, p) {
    openApptModal(iso || todayISO());
    setTimeout(function() {
        if (p && p.id && typeof apptSetSelectedPatient === 'function') {
            apptSetSelectedPatient(p);
        } else if (typeof prefillApptModalFromActivePatient === 'function') {
            prefillApptModalFromActivePatient();
        }
        var fStart = g('fStart');
        if (fStart && time) {
            fStart.value = time;
            if (typeof calcEnd === 'function') calcEnd();
        }
        if (typeof clearPatientDragPayloadSession === 'function') {
            clearPatientDragPayloadSession();
        }
    }, 90);
}

function openApptModal(prefillDate) {
    apptEditId = null;
    apptEditLockRef = null;
    ensureModalNoBackdropClose('apptModal');
    setApptScheduleLockFormUI(false);
    resetApptBookingGuards();
    g('apptModalTitle').textContent = tr('appt.modal.newAppt');

    sv('psInput',  '');
    sv('hPid',     '');
    sv('hPno',     '');
    sv('hPname',   '');
    g('psSelected').style.display = 'none';
    apptUpdatePsSelDob('');
    var dd = g('psDrop');
    if (dd) dd.style.display = 'none';
    var db = g('deleteApptBtn');
    if (db) db.style.display = 'none';

    sv('fDate',      prefillDate || todayISO());
    sv('fTreatment', '');
    clearApptRemarksEditor('fRemarksEditor');
    sv('npName',   '');
    sv('npPhone',  '');
    sv('hPchinese', '');

    switchApptPatientMode('exist');   // always start in search mode
    prefillApptModalFromActivePatient();
    buildTimeSlots();
    loadApptDoctors('');
    var defDur = (typeof getProgramSettingInt === 'function')
        ? getProgramSettingInt('appt_default_duration', 30)
        : 30;
    var durSel = g('fDur');
    if (durSel && defDur != null) {
        ensureApptDurSelectValue(defDur);
    }
    refreshApptModalI18n();
    openModal('apptModal');
}

function openApptEditModal(appt) {
    resetApptBookingGuards();
    ensureModalNoBackdropClose('apptModal');
    apptEditLockRef = appt;
    apptEditId = appt.id;
    setApptScheduleLockFormUI(isApptScheduleLocked(appt));
    g('apptModalTitle').textContent = tr('appt.modal.editAppt');

    sv('hPid',      appt.patient_id           || '');
    sv('hPno',      appt.patient_no           || '');
    sv('hPname',    appt.patient_name         || '');
    sv('hPchinese', appt.patient_chinese_name || '');

    g('psInput').value =
        (appt.patient_chinese_name ? appt.patient_chinese_name + ' ' : '') +
        (appt.patient_name || '') +
        (appt.patient_no ? ' (#' + appt.patient_no + ')' : '');
    g('psSelName').textContent    = appt.patient_name || '-';
    g('psSelNo').textContent      = appt.patient_no   || '-';
    g('psSelected').style.display = 'block';
    apptRefreshSelectedPatientDob(appt.patient_id || '');

    sv('fDate',      appt.date             || todayISO());
    sv('fTreatment', appt.treatment_items  || '');
    setApptRemarksEditorHtml('fRemarksEditor', appt.remarks);

    // If appointment has no patient_id it was a walk-in booking — restore that mode
    if (!appt.patient_id) {
        sv('npName',  appt.patient_name || '');
        sv('npPhone', extractPhoneFromRemarks(appt.remarks));
        switchApptPatientMode('new');
    } else {
        switchApptPatientMode('exist');
    }

    buildTimeSlots();
    loadApptDoctors(appt.doctor_code || appt.doctor_name || '');
    sv('fStart', appt.start_time ? appt.start_time.slice(0,5) : '09:00');

    if (appt.start_time && appt.end_time) {
        var sp = appt.start_time.split(':');
        var ep = appt.end_time.split(':');
        var sm = +sp[0]*60 + +sp[1];
        var em = +ep[0]*60 + +ep[1];
        var df = g('fDur');
        if (df) ensureApptDurSelectValue(em - sm);
    }
    calcEnd();
    refreshApptModalI18n();
    openModal('apptModal');
}

function saveAppt() {
    var date  = (g('fDate').value  || '').trim();
    var start = (g('fStart').value || '').trim();
    var dur   = parseInt(g('fDur').value || '30', 10);

    if (apptEditId && apptEditLockRef && isApptScheduleLocked(apptEditLockRef)) {
        date = apptEditLockRef.date || date;
        start = (apptEditLockRef.start_time || start).slice(0, 5);
        var lsp = String(apptEditLockRef.start_time || '').split(':');
        var lep = String(apptEditLockRef.end_time || '').split(':');
        var lsm = +lsp[0] * 60 + +(lsp[1] || 0);
        var lem = +lep[0] * 60 + +(lep[1] || 0);
        dur = lem > lsm ? lem - lsm : dur;
    }

    if (!date)  { alert(tr('appt.msg.enterDate')); return; }
    if (arBookingMinDateToday && date < todayISO()) {
        alert(tr('appt.msg.pastDate'));
        return;
    }
    if (!start) { alert(tr('appt.msg.selectStart')); return; }

    // ── Determine patient info based on active mode ──────────────
    var isWalkIn = g('psSectionNew') && g('psSectionNew').style.display !== 'none';
    var pid, pname, pno;

    if (isWalkIn) {
        pname = (g('npName').value  || '').trim();
        if (!pname) { alert(tr('appt.msg.enterPatientName')); g('npName').focus(); return; }
        var phone = (g('npPhone').value || '').trim();
        pid = '';    // no linked patient record
        pno = '';
    } else {
        pid   = (g('hPid').value   || '').trim();
        pname = (g('hPname').value || '').trim();
        pno   = (g('hPno').value   || '').trim();
        if (!pid) { alert(tr('appt.msg.selectPatient')); return; }
    }

    var end = addMins(start, dur);

    var drSel  = g('fApptDoctor');
    var drCode = drSel ? (drSel.value || '').trim() : '';
    if (!drCode) {
        alert(tr('appt.msg.selectDoctor'));
        if (drSel) drSel.focus();
        return;
    }
    var drObj  = billDoctorList
        ? billDoctorList.find(function(d) { return (d.doctor_code || d.id) === drCode; })
        : null;
    var drName = drObj ? (drObj.english_name || drObj.chinese_name || drCode) : drCode;

    var chineseName = isWalkIn ? '' : ((g('hPchinese') && g('hPchinese').value) || '');

    var rem = remarksFromEditor('fRemarksEditor');
    if (isWalkIn) {
        var walkPhone = (g('npPhone').value || '').trim();
        if (walkPhone) {
            rem = rem
                ? rem + trRepl('appt.walkinRemarksAppend', { PHONE: walkPhone })
                : trRepl('appt.walkinRemarksPhone', { PHONE: walkPhone });
        }
    }
    var priorRaw = apptEditLockRef ? apptEditLockRef.remarks : null;
    rem = mergeStaffAuthorOnSave(rem, priorRaw);

    var payload = {
        patient_id:            pid   || null,
        patient_no:            pno   || null,
        patient_name:          pname || null,
        patient_chinese_name:  chineseName || null,
        date:                  date,
        start_time:            start,
        end_time:              end,
        duration:              dur,
        treatment_items:       (g('fTreatment').value || '').trim() || null,
        remarks:               rem,
        bill_status:           apptEditId ? undefined : 'Scheduled'
    };
    if (drCode) {
        payload.doctor_code = drCode;
        payload.doctor_name = drName;
    }

    var apCt = plusApptActiveClinicId
        ? plusApptClinicTagForScope()
        : (typeof currentClinicCodeForTagging === 'function'
            ? currentClinicCodeForTagging()
            : '');
    if (apCt) payload[APPOINTMENT_CLINIC_TAG_FIELD] = apCt;

    Object.keys(payload).forEach(function(k) {
        if (payload[k] === undefined) delete payload[k];
    });

    var btnSave = g('btnSaveAppt');
    var setSaveBusy = function(busy) {
        if (btnSave) btnSave.disabled = !!busy;
    };

    var finishSave = function (savedRow) {
        setSaveBusy(false);
        closeModal('apptModal');
        var savedId = (savedRow && savedRow.id) ? savedRow.id : apptEditId;
        if (!savedRow && savedId) {
            savedRow = Object.assign({}, payload, { id: savedId });
        } else if (savedRow && savedId) {
            savedRow = Object.assign({}, payload, savedRow);
        }
        if (savedRow) {
            if (drCode) {
                savedRow.doctor_code = drCode;
                savedRow.doctor_name = drName;
            }
            if (apCt) savedRow[APPOINTMENT_CLINIC_TAG_FIELD] = apCt;
        }
        apptEditId = null;
        apptEditLockRef = null;
        setApptScheduleLockFormUI(false);
        loadToday();
        loadQueue();
        loadApptRecords();
        if (typeof plusApptNotifyAppointmentSaved === 'function') {
            plusApptNotifyAppointmentSaved({
                date: date,
                start: start,
                doctorCode: drCode,
                apptId: savedId,
                savedRow: savedRow || null
            });
        } else if (typeof refreshApptPlannerData === 'function') {
            if (typeof syncApptPlannerDate === 'function' && date) {
                syncApptPlannerDate(date, { syncCal: true });
            }
            refreshApptPlannerData();
        }
    };

    var tryPayload = function (p, opts) {
        opts = opts || {};
        var prom = apptEditId
            ? SB.from('appointments').update(p).eq('id', apptEditId).select()
            : SB.from('appointments').insert([p]).select();
        prom.then(function (r) {
            if (r.error) {
                var msg = r.error.message || '';
                if (msg.indexOf('patient_chinese_name') >= 0) {
                    var p2 = Object.assign({}, p);
                    delete p2.patient_chinese_name;
                    tryPayload(p2, opts);
                } else if (msg.indexOf('doctor_code') >= 0 || msg.indexOf('doctor_name') >= 0) {
                    if (!opts.doctorRemarksFallback && drCode) {
                        var p2 = Object.assign({}, p);
                        delete p2.doctor_code;
                        delete p2.doctor_name;
                        embedDoctorTagInRemarks(p2, drCode);
                        tryPayload(p2, { doctorRemarksFallback: true });
                        return;
                    }
                    setSaveBusy(false);
                    alert(tr('bill.alert.doctorColumns'));
                } else if (msg.indexOf('clinic_tag') >= 0) {
                    var p3 = Object.assign({}, p);
                    delete p3[APPOINTMENT_CLINIC_TAG_FIELD];
                    tryPayload(p3, opts);
                } else {
                    setSaveBusy(false);
                    alert(trRepl('appt.msg.error', { MSG: msg }));
                }
                return;
            }
            var savedRow = (r.data && r.data.length) ? r.data[0] : null;
            finishSave(savedRow);
        });
    };
    setSaveBusy(true);
    tryPayload(payload, {});
}
function deleteAppt() {
    if (!apptEditId) return;
    if (apptEditLockRef && isApptScheduleLocked(apptEditLockRef)) {
        alert(tr('appt.msg.lockedDelete'));
        return;
    }
    if (!confirm(tr('appt.confirm.deleteAppt'))) return;

    SB.from('appointments')
        .delete()
        .eq('id', apptEditId)
    .then(function(r) {
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
        closeModal('apptModal');
        apptEditId = null;
        apptEditLockRef = null;
        setApptScheduleLockFormUI(false);
        loadToday();
        loadQueue();
        loadApptRecords();
        plusApptPendingSelectApptId = null;
        if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
    });
}

// ── Load doctor list into appointment doctor dropdown ──────────
function renderApptDoctorColorPreview() {
    var sel = g('fApptDoctor');
    var dot = g('apptDoctorColorDot');
    var lbl = g('apptDoctorColorLabel');
    if (!sel || !dot) return;
    var code = (sel.value || '').trim();
    if (!code) {
        dot.style.background = '#e2e8f0';
        dot.style.borderColor = '#cbd5e1';
        if (lbl) lbl.textContent = tr('appt.modal.selectDoctorLabel');
        return;
    }
    var col = '#94a3b8';
    var sty = null;
    if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.getStyleForAppt) {
        sty = CalDoctorColors.getStyleForAppt({ doctor_code: code, doctor_name: '' });
        col = sty.borderColor;
    } else if (typeof CalDoctorColors !== 'undefined') {
        col = CalDoctorColors.getColor(code);
    }
    dot.style.background = col;
    dot.style.borderColor = col;
    var opt = sel.options[sel.selectedIndex];
    var name = opt ? opt.textContent : code;
    if (lbl) lbl.textContent = name + ' · ' + col;
}

function loadApptDoctors(selectVal) {
    var sel = g('fApptDoctor');
    if (!sel) return;
    var populate = function (list) {
        list = list || [];
        if (typeof currentClinicId !== 'undefined' && currentClinicId) {
            if (typeof doctorsForClinic === 'function') {
                list = doctorsForClinic(currentClinicId);
            } else {
                list = list.filter(function (d) { return d.clinic_id === currentClinicId; });
            }
        }
        while (sel.options.length > 1) sel.remove(1);
        if (!list.length) {
            var empty = document.createElement('option');
            empty.value = '';
            empty.textContent = tr('appt.modal.noDoctorsForClinic');
            empty.disabled = true;
            sel.appendChild(empty);
        }
        list = list.filter(function (d) {
            return typeof isClinicalDoctorRecord === 'function'
                ? isClinicalDoctorRecord(d)
                : !isPlusApptExcludedDoctor(d);
        });
        list.forEach(function (d) {
            var code = String(d.doctor_code || '').trim();
            if (!code) return;
            var opt = document.createElement('option');
            opt.value = code;
            var name = typeof doctorDisplayName === 'function'
                ? doctorDisplayName(d)
                : (d.english_name || d.chinese_name || code);
            opt.textContent = name;
            sel.appendChild(opt);
        });
        if (selectVal) sel.value = selectVal;
        else {
            var defDr = (typeof getProgramSetting === 'function')
                ? String(getProgramSetting('default_dentist', '') || '').trim()
                : '';
            if (defDr) {
                for (var di = 0; di < sel.options.length; di++) {
                    var ov = String(sel.options[di].value || '').trim();
                    var ot = String(sel.options[di].textContent || '').trim();
                    if (ov === defDr || ot === defDr ||
                        ov.toUpperCase() === defDr.toUpperCase() ||
                        ot.toUpperCase().indexOf(defDr.toUpperCase()) >= 0) {
                        sel.value = sel.options[di].value;
                        break;
                    }
                }
            }
        }
        renderApptDoctorColorPreview();
    };
    if (!sel.dataset.colorPreviewWired) {
        sel.dataset.colorPreviewWired = '1';
        sel.addEventListener('change', renderApptDoctorColorPreview);
    }
    if (billDoctorList && billDoctorList.length) { populate(billDoctorList); return; }
    SB.from('doctors').select('*').order('doctor_code').then(function (r) {
        billDoctorList = r.data || [];
        populate(billDoctorList);
    });
}

// ════════════════════════════════════════════════════════════════
// Patient name — single field: Chinese first, English after (both subtabs + print)
// Chinese: prefer column on appointment, else look up patients.chinese_name
// ════════════════════════════════════════════════════════════════

/**
 * Resolves display Chinese: appointment.patient_chinese_name, else patients.chinese_name
 * (filled by augmentAppointmentsChineseFromPatients).
 */
function getApptDisplayChinese(a) {
    if (!a) return '';
    if (typeof a._merged_chinese_name === 'string') {
        return a._merged_chinese_name;
    }
    return String(a.patient_chinese_name || '').trim();
}

/**
 * Mutates each row: _merged_chinese_name = trimmed(appt field || patient.chinese_name)
 */
function augmentAppointmentsChineseFromPatients(rows, callback) {
    rows = rows || [];
    var pmap = {};
    var pAlertMap = {};
    var pHistoryMap = {};
    var pMedsMap = {};
    var pAllergyMap = {};
    var pPhoneMap = {};
    var seen = {};
    var ids  = [];
    rows.forEach(function(a) {
        if (a.patient_id && !seen[a.patient_id]) {
            seen[a.patient_id] = true;
            ids.push(a.patient_id);
        }
    });

    function finalize() {
        rows.forEach(function(a) {
            var fromAppt =
                String(a.patient_chinese_name || '').trim();
            var fromPat =
                (a.patient_id && pmap[a.patient_id])
                    ? String(pmap[a.patient_id]).trim()
                    : '';
            var fromAlert =
                (a.patient_id && pAlertMap[a.patient_id])
                    ? String(pAlertMap[a.patient_id]).trim()
                    : '';
            a._merged_chinese_name = fromAppt || fromPat;
            a._merged_patient_alerts = fromAlert || String(a.medical_alerts || '').trim();
            if (a.patient_id && typeof patientAlertDisplayNeedsExtraFields === 'function' &&
                patientAlertDisplayNeedsExtraFields()) {
                a._merged_medical_history = pHistoryMap[a.patient_id] || '';
                a._merged_current_medications = pMedsMap[a.patient_id] || '';
                a._merged_allergy = pAllergyMap[a.patient_id] || '';
            }
            if (a.patient_id && pPhoneMap[a.patient_id]) {
                a._merged_phone = pPhoneMap[a.patient_id];
            }
        });
        if (callback) callback(rows);
    }

    if (!ids.length) {
        finalize();
        return;
    }

    SB.from('patients')
        .select(
            patientAlertDisplayNeedsExtraFields()
                ? 'id,chinese_name,medical_alerts,medical_history,current_medications,allergy,phone_number,mobile_phone'
                : 'id,chinese_name,medical_alerts,phone_number,mobile_phone'
        )
        .in('id', ids)
    .then(function(pr) {
        if (!pr.error && pr.data) {
            pr.data.forEach(function(p) {
                pmap[p.id] = p.chinese_name;
                pAlertMap[p.id] = p.medical_alerts;
                if (patientAlertDisplayNeedsExtraFields()) {
                    pHistoryMap[p.id] = p.medical_history;
                    pMedsMap[p.id] = p.current_medications;
                    pAllergyMap[p.id] = p.allergy;
                }
                pPhoneMap[p.id] = String(p.phone_number || p.mobile_phone || '').trim();
            });
        }
        finalize();
    })
    .catch(function() {
        finalize();
    });
}

function apptMergedAlertText(a) {
    if (!a) return '';
    if (typeof buildPatientAlertDisplayText === 'function') {
        return buildPatientAlertDisplayText(a);
    }
    return String(a._merged_patient_alerts || a.medical_alerts || '').trim();
}

function apptAlertCellHtml(a) {
    var txt = apptMergedAlertText(a);
    if (!txt) return '<span class="appt-alert-empty">—</span>';
    return '<div class="appt-alert-scroll" title="' + esc(txt) + '">' + esc(txt) + '</div>';
}

/** @returns {string} HTML (already escaped inner text) */
function apptPatientDisplayNameHTML(a, opt) {
    opt = opt || {};
    var cn = getApptDisplayChinese(a);
    var en = (a.patient_name || '').trim();

    var out = '';

    if (opt.walkIn && a && !a.patient_id) {
        out += '<span class="appt-walkin-badge">' + esc(tr('appt.badge.newWalkin')) + '</span>';
    }

    if (cn) {
        out += '<span class="appt-name-cn">' + esc(cn) + '</span>';
    }
    if (cn && en) {
        out += '<span class="appt-name-sep"> · </span>';
    }
    if (en) {
        out += '<span class="appt-name-en">' + esc(en) + '</span>';
    }
    if (!cn && !en) {
        out += '<span class="appt-name-en appt-name-missing">' +
            esc(opt.emptyLabel !== undefined ? opt.emptyLabel : '-') +
            '</span>';
    }

    return '<div class="appt-patient-name-field">' + out + '</div>';
}

function apptListDoctorDotCtx(apptRows) {
    var rows = apptRows || [];
    var cid = typeof currentClinicId !== 'undefined' ? currentClinicId : null;
    var hasMultipleDoctors = typeof CalDoctorColors !== 'undefined' &&
        typeof CalDoctorColors.listHasMultipleDoctors === 'function'
        ? CalDoctorColors.listHasMultipleDoctors(rows, cid)
        : false;
    return {
        clinicId: cid,
        hasMultipleDoctors: hasMultipleDoctors,
        multiDoctorOnly: true
    };
}

function apptRowDoctorDotHtml(a, ctx) {
    if (typeof CalDoctorColors === 'undefined' || !CalDoctorColors.rowDoctorDotHtml) return '';
    return CalDoctorColors.rowDoctorDotHtml(a, ctx || {});
}

function apptRepaintListRowDoctorDots() {
    if (typeof CalDoctorColors === 'undefined' || !CalDoctorColors.getStyleForAppt) return;
    ['todayBody', 'queueBody'].forEach(function (bodyId) {
        var tb = g(bodyId);
        if (!tb) return;
        tb.querySelectorAll('tr[data-appt-id] .appt-row-dr-dot').forEach(function (dot) {
            var row = dot.closest('tr');
            if (!row || !row.dataset.apptId) return;
            var ap = findApptInCalendarCaches(row.dataset.apptId);
            if (!ap) return;
            var sty = CalDoctorColors.getStyleForAppt(ap);
            dot.style.background = sty.dot;
        });
    });
}

// ════════════════════════════════════════════════════════════════
// TODAY'S APPOINTMENTS
// ════════════════════════════════════════════════════════════════
function syncApptTodayDateLabels() {
    var iso = todayISO();
    var lbl = g('todayLabel');
    var ud  = g('apptTodayDate');
    if (lbl) lbl.textContent = fmtDateLong(iso);
    if (ud) {
        ud.textContent = typeof fmtTodayLong === 'function'
            ? fmtTodayLong()
            : fmtDateLong(iso);
    }
}

function loadToday(opts) {
    opts = opts || {};
    if (!opts.force && apptModuleEditPaused('today')) {
        apptModuleMarkRefreshDeferred('today');
        opts.soft = true;
    }
    var tb  = g('todayBody');
    if (!tb) return;
    var loadSeq = ++todayLoadSeq;
    syncApptTodayDateLabels();
    if (!opts.soft) {
        tb.innerHTML =
            '<tr><td colspan="9" style="text-align:center;' +
            'color:#aaa;padding:24px;">' + esc(tr('common.loadingEllipsis')) + '</td></tr>';
    }

    var tq = SB.from('appointments').select('*')
        .eq('date', todayISO())
        .order('start_time', {ascending: true});
    tq = applyApptModuleClinicQuery(tq);
    tq.then(function(r) {
        if (loadSeq !== todayLoadSeq) return;
        var doStrip = function (apptRows) {
            if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.renderDoctorFilterStrip) {
                CalDoctorColors.renderDoctorFilterStrip('todayDoctorFilterBar', apptRows || []);
            }
        };
        if (r.error || !r.data || !r.data.length) {
            todayAppts = [];
            if (!opts.force && apptModuleEditPaused('today')) {
                apptModuleMarkRefreshDeferred('today');
                apptRefreshPatientCountBadge('today');
                doStrip([]);
                return;
            }
            tb.innerHTML = '';
            tb.innerHTML =
                '<tr><td colspan="9" style="text-align:center;' +
                'color:#aaa;padding:24px;">' + esc(tr('appt.today.noToday')) +
                '</td></tr>';
            apptRefreshPatientCountBadge('today');
            doStrip([]);
            return;
        }
        augmentAppointmentsChineseFromPatients(r.data, function(rows) {
            if (loadSeq !== todayLoadSeq) return;
            plusApptApplyTaskStateToList(rows);
            var todayRows = rows.filter(function(a) {
                if (!a) return false;
                if (apptTransferIsCutPending(a.id)) return false;
                if (a.in_queue !== null && a.in_queue !== undefined) return false;
                var s = String(a.bill_status || '').toLowerCase();
                if (s === 'queue' || s === 'done' || s === 'finish') return false;
                if (/cancel/.test(s)) return false;
                if (todayApptIsNoshow(a) && todayNoshowIsDismissed(a.id)) return false;
                return true;
            });
            todayAppts = todayRows;
            if (!opts.force && apptModuleEditPaused('today')) {
                apptModuleMarkRefreshDeferred('today');
                apptRefreshPatientCountBadge('today');
                doStrip(todayRows);
                return;
            }
            tb.innerHTML = '';
            var visible = typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts
                ? CalDoctorColors.filterAppts(todayRows) : todayRows;
            apptRefreshPatientCountBadge('today');
            var dotCtx = apptListDoctorDotCtx(todayRows);
            if (!visible.length) {
                tb.innerHTML =
                    '<tr><td colspan="9" style="text-align:center;' +
                    'color:#aaa;padding:24px;">' +
                    esc(todayRows.length ? tr('appt.today.noFiltered') : tr('appt.today.noToday')) +
                    '</td></tr>';
            } else {
                visible.forEach(function(a) {
                    buildTodayRow(tb, a, dotCtx);
                });
            }
            doStrip(todayRows);
            apptRestoreListRowSelection(tb, 'today');
            hydrateApptUnpaidBalances(todayRows, function(changed) {
                if (!changed) return;
                if (loadSeq !== todayLoadSeq) return;
                if (typeof apptActiveTabKey === 'function' && apptActiveTabKey() === 'today') {
                    loadToday();
                }
            });
        });
    });
}

function todayApptIsNoshow(a) {
    return /no.?show|failed/i.test(String(a && a.bill_status ? a.bill_status : ''));
}

function todayNoshowDismissStore() {
    try {
        var raw = localStorage.getItem(TODAY_NOSHOW_DISMISS_LS);
        var map = raw ? JSON.parse(raw) : {};
        return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
    } catch (e) {
        return {};
    }
}

function todayNoshowIsDismissed(apptId, dateIso) {
    return todayNoshowDismissStore()[String(apptId)] === (dateIso || todayISO());
}

function dismissTodayNoshowRow(apptId) {
    var map = todayNoshowDismissStore();
    var iso = todayISO();
    Object.keys(map).forEach(function(k) {
        if (map[k] !== iso) delete map[k];
    });
    map[String(apptId)] = iso;
    try {
        localStorage.setItem(TODAY_NOSHOW_DISMISS_LS, JSON.stringify(map));
    } catch (e) { /* ignore */ }
}

function hideTodayNoshowRow(apptId, row) {
    dismissTodayNoshowRow(apptId);
    todayAppts = (todayAppts || []).filter(function(a) {
        return String(a.id) !== String(apptId);
    });
    if (row && row.parentNode) row.parentNode.removeChild(row);
    var tb = g('todayBody');
    if (tb && !tb.querySelector('tr[data-appt-id]')) {
        tb.innerHTML =
            '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:24px;">' +
            esc(tr('appt.today.noFiltered')) + '</td></tr>';
    }
    if (typeof apptTransferRefreshVisibleListCounts === 'function') {
        apptTransferRefreshVisibleListCounts();
    }
}

function todayApptNeedsPatientReg(a) {
    if (!a) return false;
    if (a.bill_status === 'Queue' || a.bill_status === 'Done') return false;
    if (todayApptIsNoshow(a)) return false;
    return !a.patient_id;
}

function clearTodayApptPendingPatientReg() {
    todayApptPendingPatientRegId = null;
}

function openNewPatientForTodayAppt(a) {
    if (!a || !a.id) return;
    todayApptPendingPatientRegId = a.id;
    if (typeof openAddPatient !== 'function') {
        alert(tr('appt.today.regNotAvailable'));
        return;
    }
    openAddPatient();
    setTimeout(function () {
        var en = String(a.patient_name || '').trim();
        var cn = String(a.patient_chinese_name || '').trim();
        if (en && g('fullName')) g('fullName').value = en;
        if (cn && g('chineseName')) g('chineseName').value = cn;
    }, 0);
}

/** Called from patient registration after saving a new patient (app-patient.js). */
function linkTodayApptAfterPatientRegistration(patient) {
    if (!todayApptPendingPatientRegId || !patient || !patient.id) return false;
    var apptId = todayApptPendingPatientRegId;
    todayApptPendingPatientRegId = null;

    SB.from('appointments')
        .update({
            patient_id:           patient.id,
            patient_no:           patient.patient_no || null,
            patient_name:         patient.full_name || null,
            patient_chinese_name: patient.chinese_name || null
        })
        .eq('id', apptId)
    .then(function (res) {
        if (res.error) {
            alert(trRepl('appt.today.regLinkFail', { MSG: res.error.message }));
            loadToday();
            return;
        }
        loadToday();
        alert(trRepl('appt.today.regLinkOk', { NO: (patient.patient_no || '—') }));
    });
    return true;
}

function buildTodayRow(tb, a, dotCtx) {
    if (apptTransferIsCutPending(a.id)) return;
    var row = document.createElement('tr');
    row.dataset.apptId = a.id;
    row.style.cursor = 'pointer';
    var drDot = apptRowDoctorDotHtml(a, dotCtx);
    var clearMode = plusApptIsClearMode();
    var isNoshow = todayApptIsNoshow(a);
    if (isNoshow) row.classList.add('today-row-noshow');
    if (clearMode) row.classList.add('today-clear-row');
    var needsReg = todayApptNeedsPatientReg(a);
    var actionBtn = '';
    var canMarkVisit = a.bill_status !== 'Queue' && a.bill_status !== 'Done' && !isNoshow;
    if (canMarkVisit) {
        if (needsReg) {
            actionBtn =
                '<button type="button" class="btn-today-newpatient btn-sm" ' +
                'style="background:#d97706;">' + esc(tr('appt.today.btnNewPatient')) + '</button>';
        } else {
            actionBtn =
                '<button type="button" class="btn-today-checkin btn-sm" ' +
                'style="background:var(--success);">' + esc(tr('appt.today.btnCheckIn')) + '</button>';
        }
        actionBtn +=
            '<button type="button" class="btn-today-noshow btn-sm" ' +
            'style="background:#dc2626;">' + esc(tr('appt.today.btnNoShow')) + '</button>';
    } else if (isNoshow) {
        actionBtn =
            '<button type="button" class="btn-today-remove btn-sm" ' +
            'style="background:#64748b;">' + esc(tr('appt.today.btnRemove')) + '</button>';
    }

    if (clearMode) {
        row.innerHTML =
            '<td class="today-time-cell plusappt-row-data-cell--clear plusappt-clear-time">' +
                '<strong>' + fmt12(a.start_time) + '</strong>' +
            '</td>' +
            '<td class="today-patno-cell plusappt-row-data-cell--clear">' +
                esc(a.patient_no || '-') +
            '</td>' +
            '<td class="today-name-cell plusappt-name-cell plusappt-row-data-cell--clear">' +
                queueClearModeNameHtml(a) +
            '</td>' +
            '<td class="today-treatment-cell plusappt-treat-cell plusappt-row-data-cell--clear">' +
                plusApptTreatmentInlineHtml(a, true) +
            '</td>' +
            '<td class="appt-alert-cell plusappt-row-data-cell--clear">' + apptAlertCellHtml(a) + '</td>' +
            '<td class="today-remarks-cell plusappt-remarks-cell-wrap plusappt-row-data-cell--clear">' +
                '<div class="plusappt-remarks-preview-wrap today-clear-remarks-inline">' +
                    apptUnpaidBadgeHtml(a, 'appt-unpaid-badge--remarks queue-clear-unpaid-badge') +
                    '<span class="queue-clear-remarks-body">' +
                        plusApptRemarksScrollerHtml(a.remarks, a.id, { hideStaffAuthor: true }) +
                    '</span>' +
                '</div>' +
            '</td>' +
            '<td class="today-duration-cell plusappt-row-data-cell--clear">' +
                esc(a.duration != null && a.duration !== '' ? apptDurationDisplay(a.duration) : '-') +
            '</td>' +
            '<td class="today-status-cell plusappt-row-data-cell--clear">' +
                '<span class="status-badge ' + statusClass(a.bill_status) + '">' +
                    esc(dispStatusLabel(a.bill_status || 'Scheduled')) +
                '</span>' +
            '</td>' +
            '<td class="today-action-cell plusappt-row-data-cell--clear">' +
                '<div class="action-wrap" style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center;">' +
                    '<button type="button" class="btn-today-edit btn-sm" ' +
                    'style="background:var(--primary);">' + esc(tr('appt.today.btnEdit')) + '</button>' +
                    actionBtn +
                '</div>' +
            '</td>';
    } else {
        row.innerHTML =
            '<td>' +
                '<strong>' + fmt12(a.start_time) + '</strong>' +
                ' – ' + fmt12(a.end_time) +
            '</td>' +
            '<td style="font-size:12px;color:#888;">' +
                esc(a.patient_no || '-') +
            '</td>' +
            '<td class="today-name-cell">' +
                '<span class="appt-row-name-wrap">' +
                    drDot +
                    apptPatientDisplayNameHTML(a, { walkIn: true }) +
                '</span>' +
            '</td>' +
            '<td class="today-treatment-cell">' +
                apptTreatInlineTextareaHtml(a.treatment_items, a.id, 'appt-treat-inline--today') +
            '</td>' +
            '<td class="appt-alert-cell">' + apptAlertCellHtml(a) + '</td>' +
            '<td class="today-remarks-cell">' +
                '<div class="today-remarks-preview-wrap">' +
                    '<div class="today-remarks-snippet">' +
                        formatRemarksForDisplay(a.remarks, { empty: '-', stripDr: true }) +
                    '</div>' +
                    apptUnpaidBadgeHtml(a, 'appt-unpaid-badge--remarks') +
                    apptTaskSummaryHtml(a) +
                '</div>' +
            '</td>' +
            '<td style="text-align:center;">' +
                esc(a.duration != null && a.duration !== ''
                    ? apptDurationDisplay(a.duration) : '-') +
            '</td>' +
            '<td>' +
                '<span class="status-badge ' +
                    statusClass(a.bill_status) + '">' +
                    esc(dispStatusLabel(a.bill_status || 'Scheduled')) +
                '</span>' +
            '</td>' +
            '<td>' +
                '<div style="display:flex;gap:5px;flex-wrap:wrap;">' +
                    '<button type="button" class="btn-today-edit btn-sm" ' +
                    'style="background:var(--primary);">' + esc(tr('appt.today.btnEdit')) + '</button>' +
                    actionBtn +
                '</div>' +
            '</td>';
    }

    tb.appendChild(row);

    if (clearMode) {
        bindPlusApptTreatmentInline(row, a, { clearMode: true });
        bindPlusApptRemarksScroller(row, a.id);
    } else {
        apptBindTreatInlineField(row.querySelector('.appt-treat-inline'), function (saved) {
            a.treatment_items = saved;
        });
    }
    bindTodayRemarksDblclick(row, a);

    row.addEventListener('dblclick', function () {
        if (isNoshow || a.bill_status === 'Queue' || a.bill_status === 'Done') {
            openApptEditModal(a);
            return;
        }
        if (todayApptNeedsPatientReg(a)) {
            openNewPatientForTodayAppt(a);
            return;
        }
        if (!confirm(trRepl('appt.today.confirmCheckIn', {
            NAME: a.patient_name || tr('appt.today.thisPatient')
        }))) return;
        checkInFromToday(a.id);
    });

    row.querySelector('.btn-today-edit')
        .addEventListener('click', function (e) {
            e.stopPropagation();
            openApptEditModal(a);
        });

    var np = row.querySelector('.btn-today-newpatient');
    if (np) {
        np.addEventListener('click', function (e) {
            e.stopPropagation();
            openNewPatientForTodayAppt(a);
        });
    }

    var ci = row.querySelector('.btn-today-checkin');
    if (ci) {
        ci.addEventListener('click', function (e) {
            e.stopPropagation();
            checkInPatient(a);
        });
    }

    var ns = row.querySelector('.btn-today-noshow');
    if (ns) {
        ns.addEventListener('click', function (e) {
            e.stopPropagation();
            updateApptBillStatus(a.id, 'No Show');
        });
    }

    var rm = row.querySelector('.btn-today-remove');
    if (rm) {
        rm.addEventListener('click', function (e) {
            e.stopPropagation();
            if (!confirm(trRepl('appt.queue.confirmRemove', {
                NAME: a.patient_name || tr('appt.today.thisPatient')
            }))) return;
            hideTodayNoshowRow(a.id, row);
        });
    }

    row.querySelectorAll('.appt-task-pill-btn[data-task-cycle="1"]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var aid = btn.getAttribute('data-appt-id');
            var kind = btn.getAttribute('data-task-kind');
            if (!aid || !kind) return;
            apptTaskCycleFromSummary(aid, kind);
        });
        btn.addEventListener('dblclick', function(e) {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    row.addEventListener('click', function(e) {
        if (apptListRowClickBlocked(e.target)) return;
        apptSelectListRow(a, row, 'today');
    });
    apptBindListRowPatientDrag(row, a);
}

function apptTreatInlineResize(el) {
    if (!el) return;
    el.style.height = 'auto';
    var maxRows = parseInt(el.getAttribute('data-max-rows') || '4', 10) || 4;
    var linePx = 19;
    var padPx = 14;
    var minPx = 34;
    var maxPx = (maxRows * linePx) + padPx;
    var scrollH = el.scrollHeight;
    var nextH = Math.min(Math.max(scrollH, minPx), maxPx);
    el.style.height = nextH + 'px';
    el.style.overflowY = scrollH > maxPx ? 'auto' : 'hidden';
}

function apptBindTreatInlineField(el, onSaved) {
    if (!el || el.dataset.bound === '1') return;
    el.dataset.bound = '1';
    el.addEventListener('click', function (e) { e.stopPropagation(); });
    el.addEventListener('dblclick', function (e) { e.stopPropagation(); });
    el.addEventListener('input', function () { apptTreatInlineResize(el); });
    el.addEventListener('focus', function () { apptTreatInlineResize(el); });
    el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            try { el.blur(); } catch (_) {}
        }
    });
    el.addEventListener('blur', function () {
        apptInlineSaveTreatment(el.getAttribute('data-appt-id'), el.value, function (saved) {
            if (onSaved) onSaved(saved);
            el.value = saved || '';
            apptTreatInlineResize(el);
        });
    });
    apptTreatInlineResize(el);
}

function apptTreatInlineTextareaHtml(value, apptId, extraClass) {
    var cls = 'appt-treat-inline' + (extraClass ? (' ' + extraClass) : '');
    return '<textarea class="' + cls + '" rows="1" data-max-rows="4" ' +
        'data-appt-id="' + esc(apptId) + '" ' +
        'placeholder="' + esc(tr('appt.modal.treatmentPh')) + '" ' +
        'title="' + esc(tr('appt.treatInline.saveHint')) + '">' +
        esc(value || '') + '</textarea>';
}

function apptInlineSaveTreatment(apptId, raw, onDone) {
    var id = String(apptId || '').trim();
    if (!id) return;
    var v = String(raw || '').trim();
    var payload = { treatment_items: v || null };
    SB.from('appointments')
        .update(payload)
        .eq('id', id)
    .then(function(r) {
        if (r && r.error) {
            alert(trRepl('appt.msg.error', { MSG: r.error.message }));
            if (onDone) onDone(String(raw || '').trim());
            return;
        }
        if (onDone) onDone(v);
    });
}

// ════════════════════════════════════════════════════════════════
// PRINT TODAY'S APPOINTMENT LIST
// ════════════════════════════════════════════════════════════════
function printTodayList() {
    if (typeof confirmPrintReminder === 'function' && !confirmPrintReminder()) return;
    var clinic  = (typeof currentClinicLabel !== 'undefined' && currentClinicLabel)
                  ? currentClinicLabel : tr('ai.clinicFallback');
    var dateStr = (typeof fmtDateLong === 'function') ? fmtDateLong(todayISO()) : todayISO();
    var rows    = '';

    var printRows = typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts
        ? CalDoctorColors.filterAppts(todayAppts) : todayAppts;

    if (!printRows.length) {
        rows = '<tr><td colspan="7" style="text-align:center;color:#888;' +
               'padding:20px;">' + esc(tr('appt.today.noToday')) + '</td></tr>';
    } else {
        printRows.forEach(function(a, i) {
            var timeStr = (typeof fmt12 === 'function')
                ? fmt12(a.start_time) + (a.end_time ? ' – ' + fmt12(a.end_time) : '')
                : (a.start_time || '-');
            var status  = a.bill_status || 'Scheduled';
            var cnRaw   = (a.patient_chinese_name || '').trim();
            var enRaw   = (a.patient_name || '').trim();
            var nmPrint = '';
            if (cnRaw && enRaw) {
                nmPrint =
                    '<span style="font-weight:800;font-size:13px;' +
                    'font-family:\'PingFang HK\',\'Microsoft JhengHei\',\'Noto Sans TC\'' +
                    ',sans-serif;">' + esc(cnRaw) + '</span>' +
                    ' <span style="color:#9ca3af;font-weight:bold;">·</span> ' +
                    '<strong style="font-size:13px;color:#334155;">' +
                    esc(enRaw) + '</strong>';
            } else if (cnRaw) {
                nmPrint =
                    '<strong style="font-weight:800;font-size:13px;' +
                    'font-family:\'PingFang HK\',\'Microsoft JhengHei\',\'Noto Sans TC\'' +
                    ',sans-serif;">' + esc(cnRaw) + '</strong>';
            } else {
                nmPrint = '<strong style="font-size:13px;color:#334155;">' +
                    esc(enRaw || '-') + '</strong>';
            }
            rows +=
                '<tr' + (i % 2 === 1 ? ' style="background:#f9fafb;"' : '') + '>' +
                '<td style="white-space:nowrap;">' + esc(timeStr) + '</td>' +
                '<td>' + esc(a.patient_no   || '-') + '</td>' +
                '<td style="vertical-align:middle;line-height:1.4;' +
                '-webkit-font-smoothing:antialiased;">' +
                nmPrint +
                '</td>' +
                '<td>' + esc(a.treatment_items || '-') + '</td>' +
                '<td>' + formatRemarksForDisplay(a.remarks, { empty: '-' }) + '</td>' +
                '<td style="text-align:center;">' +
                    esc(a.duration != null && a.duration !== ''
                ? apptDurationDisplay(a.duration) : '-') + '</td>' +
                '<td>' + esc(dispStatusLabel(status)) + '</td>' +
                '</tr>';
        });
    }

    var html =
        '<!DOCTYPE html><html><head>' +
        '<meta charset="UTF-8">' +
        '<title>' + esc(trRepl('appt.today.printDocTitle', { DATE: dateStr })) + '</title>' +
        '<style>' +
            'body{font-family:Arial,sans-serif;font-size:13px;color:#222;margin:24px;}' +
            'h2{margin:0 0 2px;font-size:18px;}' +
            'p.sub{margin:0 0 14px;color:#555;font-size:12px;}' +
            'table{width:100%;border-collapse:collapse;}' +
            'th{background:#1a73e8;color:#fff;padding:8px 10px;text-align:left;font-size:12px;}' +
            'td{padding:7px 10px;border-bottom:1px solid #e5e7eb;vertical-align:top;}' +
            'tfoot td{font-size:11px;color:#888;border-top:2px solid #e5e7eb;padding-top:6px;}' +
            '@media print{body{margin:10px;} button{display:none;}}' +
        '</style>' +
        '</head><body>' +
        '<h2>' + esc(trRepl('appt.today.printDailyTitle', { CLINIC: clinic })) + '</h2>' +
        '<p class="sub">' + esc(trRepl('appt.today.printSubtitle', {
            DATE: dateStr,
            N: printRows.length
        })) + '</p>' +
        '<table>' +
        '<thead><tr>' +
            '<th>' + esc(tr('appt.todayTh.time')) + '</th>' +
            '<th>' + esc(tr('appt.todayTh.patNo')) + '</th>' +
            '<th>' + esc(tr('appt.todayTh.name')) + '</th>' +
            '<th>' + esc(tr('appt.todayTh.treatment')) + '</th>' +
            '<th>' + esc(tr('appt.todayTh.remarks')) + '</th>' +
            '<th>' + esc(tr('appt.todayTh.duration')) + '</th>' +
            '<th>' + esc(tr('appt.todayTh.status')) + '</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '<tfoot><tr><td colspan="7">' + esc(trRepl('appt.today.printFooter', {
            WHEN: new Date().toLocaleString(apptDateLocale())
        })) + '</td></tr></tfoot>' +
        '</table>' +
        '<script>' +
        (typeof printPopupAutoCloseInlineScript === 'function' ? printPopupAutoCloseInlineScript() : '') +
        'window.onload=function(){setTimeout(function(){try{window.print();}catch(e){if(typeof __ppClose==="function")__ppClose();}},200);};' +
        '<\/script>' +
        '</body></html>';

    var w = window.open('', '_blank', 'width=900,height=650');
    if (!w) { alert(tr('appt.today.popupBlocked')); return; }
    w.document.write(html);
    w.document.close();
    if (typeof wirePrintPopupAutoClose === 'function') wirePrintPopupAutoClose(w);
}

/**
 * Check in from a patient record (Patients list, Quick Launch).
 * Finds today's scheduled appointment or creates one, then checks in.
 * @param {object} patient — row with id, patient_no, full_name, chinese_name
 * @param {{skipConfirm?: boolean}} opts
 */
function checkInPatientFromRecord(patient, opts) {
    opts = opts || {};
    if (!patient || !patient.id) {
        alert(typeof tr === 'function' ? tr('patient.checkInNeedRecord') : 'Patient record required.');
        return;
    }
    if (typeof SB === 'undefined' || !SB || !SB.from) {
        alert(typeof tr === 'function' ? tr('bill.supabaseNotReady') : 'Database not ready.');
        return;
    }

    var dispName = String(patient.chinese_name || patient.full_name || patient.patient_no || '').trim();
    if (!dispName && typeof tr === 'function') {
        dispName = tr('appt.today.thisPatient');
    }
    if (!opts.skipConfirm && typeof tr === 'function') {
        if (!confirm(trRepl('appt.today.confirmCheckIn', { NAME: dispName }))) return;
    }

    function goToQueueTab() {
        if (typeof showOnly === 'function') showOnly('appointmentSection');
        setTimeout(function () {
            if (typeof switchApptTab === 'function') switchApptTab('queue');
            if (typeof loadQueue === 'function') loadQueue();
        }, 60);
    }

    function apptStartTimeNow() {
        var n = new Date();
        var h = n.getHours();
        var m = n.getMinutes();
        return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    }

    function apptDoctorFieldsForInsert() {
        var drCode = '';
        var drName = '';
        var pickId = (typeof currentDoctorId !== 'undefined' && currentDoctorId)
            ? currentDoctorId
            : '';
        if (!pickId && typeof defaultBillDoctorId === 'function') {
            pickId = defaultBillDoctorId();
        }
        var list = billDoctorList || [];
        if (!list.length && typeof APP_DOCTORS !== 'undefined' && APP_DOCTORS.length) {
            list = APP_DOCTORS;
        }
        var dr = null;
        if (pickId) {
            dr = list.find(function (d) {
                return d && String(d.id) === String(pickId);
            }) || null;
        }
        if (!dr && list.length) dr = list[0];
        if (dr) {
            drCode = String(dr.doctor_code || dr.id || '').trim();
            drName = String(dr.english_name || dr.display_name || dr.chinese_name || drCode).trim();
        }
        return { doctor_code: drCode || null, doctor_name: drName || null };
    }

    function createTodayApptThenCheckIn() {
        var start = apptStartTimeNow();
        var dur = 30;
        var end = typeof addMins === 'function' ? addMins(start, dur) : start;
        var dr = apptDoctorFieldsForInsert();
        var payload = {
            patient_id: patient.id,
            patient_no: patient.patient_no || null,
            patient_name: patient.full_name || null,
            patient_chinese_name: patient.chinese_name || null,
            date: todayISO(),
            start_time: start,
            end_time: end,
            duration: dur,
            bill_status: 'Scheduled'
        };
        if (dr.doctor_code) {
            payload.doctor_code = dr.doctor_code;
            payload.doctor_name = dr.doctor_name;
        }
        var apCt = typeof currentClinicCodeForTagging === 'function'
            ? currentClinicCodeForTagging()
            : '';
        if (apCt && typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined') {
            payload[APPOINTMENT_CLINIC_TAG_FIELD] = apCt;
        }
        function tryInsert(pl, retried) {
            SB.from('appointments').insert([pl]).select('*')
            .then(function (r) {
                if (!r.error && r.data && r.data.length) {
                    checkInPatient(r.data[0]);
                    return;
                }
                var msg = String((r.error && r.error.message) || '').toLowerCase();
                if (!retried && msg.indexOf('patient_chinese_name') >= 0) {
                    var pl2 = Object.assign({}, pl);
                    delete pl2.patient_chinese_name;
                    tryInsert(pl2, true);
                    return;
                }
                if (!retried && msg.indexOf('clinic_tag') >= 0 &&
                    typeof APPOINTMENT_CLINIC_TAG_FIELD !== 'undefined') {
                    var pl3 = Object.assign({}, pl);
                    delete pl3[APPOINTMENT_CLINIC_TAG_FIELD];
                    tryInsert(pl3, true);
                    return;
                }
                alert(trRepl('appt.msg.error', {
                    MSG: (r.error && r.error.message) || 'Insert failed'
                }));
            });
        }
        tryInsert(payload, false);
    }

    var q = SB.from('appointments').select('*').eq('date', todayISO());
    if (patient.id) {
        q = q.eq('patient_id', patient.id);
    } else if (patient.patient_no) {
        q = q.eq('patient_no', patient.patient_no);
    } else {
        alert(typeof tr === 'function' ? tr('patient.checkInNeedRecord') : 'Patient record required.');
        return;
    }
    q = applyApptModuleClinicQuery(q);
    q.then(function (r) {
        if (r.error) {
            alert(trRepl('appt.msg.error', { MSG: r.error.message }));
            return;
        }
        var rows = r.data || [];
        var inQueue = rows.find(function (a) {
            if (!a) return false;
            if (a.in_queue !== null && a.in_queue !== undefined) return true;
            return String(a.bill_status || '') === 'Queue';
        });
        if (inQueue) {
            alert(typeof tr === 'function'
                ? tr('patient.checkInAlreadyInQueue')
                : 'Patient is already in today\'s queue.');
            goToQueueTab();
            return;
        }

        var open = rows.filter(function (a) {
            if (!a) return false;
            if (a.in_queue !== null && a.in_queue !== undefined) return false;
            var s = String(a.bill_status || '').toLowerCase();
            return s !== 'queue' && s !== 'done' && s !== 'finish';
        });
        if (open.length) {
            open.sort(function (a, b) {
                return String(a.start_time || '').localeCompare(String(b.start_time || ''));
            });
            checkInPatient(open[0]);
            return;
        }
        createTodayApptThenCheckIn();
    });
}

function checkInPatient(a) {
    if (todayApptNeedsPatientReg(a)) {
        alert(tr('appt.today.registerWalkinFirst'));
        return;
    }
    var now = new Date();
    var arrivalTime = now.toISOString();

    var cq = SB.from('appointments')
        .select('in_queue')
        .eq('date',      todayISO())
        .not('in_queue', 'is', null)
        .order('in_queue', { ascending: false })
        .limit(1);
    cq = applyApptModuleClinicQuery(cq);
    cq.then(function(r) {
        var nextQ = 1;
        if (!r.error && r.data && r.data.length > 0) {
            nextQ = (r.data[0].in_queue || 0) + 1;
        }
        SB.from('appointments')
            .update({
                arrived:      true,
                arrival_time: arrivalTime,
                in_queue:     nextQ,
                bill_status:  'Queue'
            })
            .eq('id', a.id)
        .then(function(res) {
            if (res.error) { alert(trRepl('appt.msg.error', { MSG: res.error.message })); return; }
            loadToday();
            switchApptTab('queue');
        });
    });
}

function queueDragBlockedTarget(el) {
    return !!(el && el.closest && el.closest(
        'input, button, textarea, select, .action-wrap, .action-drop, label, .queue-remarks-preview-wrap'
    ));
}

/** Targets where double-click should not open the patient editor (narrower than drag block). */
function queuePatientEditDblclickBlocked(el) {
    return !!(el && el.closest && el.closest(
        'button, input, textarea, select, .action-wrap, .action-drop, .queue-remarks-preview-wrap'
    ));
}

/** Refresh appointment lists after patient details change from queue / today. */
function refreshApptListsAfterPatientEdit() {
    if (typeof loadQueue === 'function') loadQueue();
    if (typeof loadToday === 'function') loadToday();
}

function resolveQueueRowPatientId(q, done) {
    if (!q) { if (done) done(null); return; }
    if (q.patient_id) { if (done) done(q.patient_id); return; }
    var no = String(q.patient_no || '').trim();
    if (!no) { if (done) done(null); return; }
    SB.from('patients').select('id').eq('patient_no', no).limit(1)
    .then(function (r) {
        if (r.error || !r.data || !r.data.length) {
            if (done) done(null);
            return;
        }
        var pid = r.data[0].id;
        if (pid && q.id) {
            SB.from('appointments')
                .update({ patient_id: pid })
                .eq('id', q.id)
            .then(function () {
                q.patient_id = pid;
                if (done) done(pid);
            });
            return;
        }
        if (done) done(pid || null);
    });
}

function openEditPatientFromQueueRow(q) {
    if (!q) return;
    document.querySelectorAll('.action-drop.open').forEach(function (d) {
        d.classList.remove('open');
    });
    resolveQueueRowPatientId(q, function (pid) {
        if (pid && typeof openEditPatient === 'function') {
            openEditPatient(pid);
            return;
        }
        if (todayApptNeedsPatientReg(q)) {
            openNewPatientForTodayAppt(q);
            return;
        }
        alert(tr('appt.queue.noRecordLinked'));
    });
}

function queueFindRowByApptId(tbody, apptId) {
    if (!tbody || !apptId) return null;
    var rows = tbody.querySelectorAll('tr[data-appt-id]');
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].dataset.apptId === apptId) return rows[i];
    }
    return null;
}

/** Resolve dragged appointment id on queue drop (reorder uses plain id, not patient JSON). */
function queueDragApptIdFromEvent(e) {
    if (!e || !e.dataTransfer) return '';
    var id = '';
    try {
        id = e.dataTransfer.getData('text/x-joyful-appt-id') || '';
    } catch (_) {}
    if (!id) {
        try {
            var plain = e.dataTransfer.getData('text/plain') || '';
            if (plain && plain.indexOf('{') !== 0 && plain.indexOf('[') !== 0) {
                id = plain;
            }
        } catch (_) {}
    }
    if (!id) {
        try {
            id = window.__JOYFUL_APPT_DRAG_APPT_ID || '';
        } catch (_) {}
    }
    return String(id || '').trim();
}

function queueReorderInDom(tbody, draggedId, anchorTr, clientY) {
    var draggedEl = queueFindRowByApptId(tbody, draggedId);
    if (!draggedEl || !anchorTr || draggedEl === anchorTr) return false;
    var rect = anchorTr.getBoundingClientRect();
    var insertBefore = clientY < rect.top + rect.height / 2;
    draggedEl.remove();
    if (insertBefore) {
        tbody.insertBefore(draggedEl, anchorTr);
    } else {
        var nextEl = anchorTr.nextSibling;
        if (nextEl) tbody.insertBefore(draggedEl, nextEl);
        else tbody.appendChild(draggedEl);
    }
    return true;
}

function persistQueueOrder(tbody, done) {
    var ids = [];
    var rows = tbody.querySelectorAll('tr[data-appt-id]');
    for (var i = 0; i < rows.length; i++) ids.push(rows[i].dataset.apptId);
    if (!ids.length) {
        if (done) done(null);
        return;
    }

    Promise.all(ids.map(function(id, idx) {
        return SB.from('appointments').update({ in_queue: idx + 1 }).eq('id', id);
    }))
    .then(function(results) {
        for (var j = 0; j < results.length; j++) {
            if (results[j].error) {
                if (done) done(results[j].error);
                return;
            }
        }
        if (done) done(null);
    })
    .catch(function(e) {
        if (done) done(e);
    });
}

function clearQueueDropTargetClasses(tbody) {
    tbody.querySelectorAll('.queue-row-droptarget').forEach(function(row) {
        row.classList.remove('queue-row-droptarget');
    });
}

function queueFindDropAnchorByY(tbody, clientY) {
    if (!tbody || !isFinite(clientY)) return null;
    var rows = tbody.querySelectorAll('tr[data-appt-id]');
    if (!rows.length) return null;
    for (var i = 0; i < rows.length; i++) {
        var rect = rows[i].getBoundingClientRect();
        if (clientY < rect.top + rect.height / 2) return rows[i];
    }
    return rows[rows.length - 1];
}

function queueIsActiveReorderDrag(ev) {
    if (queueReorderDragApptId) return true;
    try {
        if (window.__JOYFUL_QUEUE_REORDER_ID) return true;
    } catch (_) {}
    if (queueDragSourceFromEvent(ev) === 'queue-reorder') return true;
    return false;
}

function queuePersistOrderAndReload(tbody) {
    persistQueueOrder(tbody, function(err) {
        if (err) {
            alert(trRepl('appt.queue.orderSaveFail', { MSG: (err.message || String(err)) }));
        }
        loadQueue();
    });
}

function queueApplyReorderDrop(tbody, dragId, anchor, clientY) {
    if (!tbody || !dragId) return false;
    var draggedEl = queueFindRowByApptId(tbody, dragId);
    if (!draggedEl) return false;
    if (!anchor) {
        if (tbody.lastElementChild === draggedEl) return false;
        draggedEl.remove();
        tbody.appendChild(draggedEl);
        return true;
    }
    if (dragId === anchor.dataset.apptId) return false;
    return queueReorderInDom(tbody, dragId, anchor, clientY);
}

function bindQueueReorderHandlers(tbody) {
    if (!tbody || tbody.dataset.queueReorderBound === '1') return;
    tbody.dataset.queueReorderBound = '1';

    var dragEnteredTr = null;
    tbody.addEventListener('dragenter', function(e) {
        var row = e.target && e.target.closest
            ? e.target.closest('tr[data-appt-id]')
            : null;
        if (row !== dragEnteredTr) {
            clearQueueDropTargetClasses(tbody);
            dragEnteredTr = row;
            if (row) row.classList.add('queue-row-droptarget');
        }
    });
    tbody.addEventListener('dragover', function(e) {
        if (queueIsActiveReorderDrag(e)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            var row = e.target && e.target.closest
                ? e.target.closest('tr[data-appt-id]')
                : null;
            if (row !== dragEnteredTr) {
                clearQueueDropTargetClasses(tbody);
                dragEnteredTr = row;
                if (row) row.classList.add('queue-row-droptarget');
            }
            return;
        }
        var row = e.target && e.target.closest
            ? e.target.closest('tr[data-appt-id]')
            : null;
        if (queueIsPatientOrApptDrag(e)) {
            if (row) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            }
            return;
        }
        e.preventDefault();
        if (row) e.dataTransfer.dropEffect = 'move';
        else e.dataTransfer.dropEffect = 'none';
    }, false);
    tbody.addEventListener('dragleave', function(e) {
        if (!(e.relatedTarget && tbody.contains(e.relatedTarget))) {
            dragEnteredTr = null;
            clearQueueDropTargetClasses(tbody);
        }
    }, false);
    tbody.addEventListener('drop', function(e) {
        dragEnteredTr = null;
        clearQueueDropTargetClasses(tbody);

        var reorderId = queueReorderDragApptId ||
            (function() {
                try { return window.__JOYFUL_QUEUE_REORDER_ID || ''; } catch (_) { return ''; }
            })();
        if (!reorderId && queueIsActiveReorderDrag(e)) {
            reorderId = queueDragApptIdFromEvent(e);
        }

        if (reorderId) {
            e.preventDefault();
            var anchor = e.target && e.target.closest
                ? e.target.closest('tr[data-appt-id]')
                : null;
            if (!anchor) anchor = queueFindDropAnchorByY(tbody, e.clientY);
            if (queueApplyReorderDrop(tbody, reorderId, anchor, e.clientY)) {
                queuePersistOrderAndReload(tbody);
            }
            return;
        }

        var anchor = e.target && e.target.closest
            ? e.target.closest('tr[data-appt-id]')
            : null;
        if (!anchor) return;
        if (queueIsPatientOrApptDrag(e)) {
            if (queueApplyPatientDropOnRow(e, anchor, tbody)) return;
        }
    }, false);
}

// ── Queue remarks modal (full text edit) ─────────────────────
function bindQueueRemarksModalOnce() {
    if (queueRemarksModalBound) return;
    var m = g('queueRemarksModal');
    if (!m) return;
    queueRemarksModalBound = true;
    initApptRemarksRichEditors();

    m.addEventListener('click', function(e) {
        if (e.target === m) {
            queueRemarksEditApptId = null;
            _queueRemarksEditAppt = null;
            queueRemarksEditPriorRaw = null;
        }
    });

    function closeQm() {
        closeModal('queueRemarksModal');
        queueRemarksEditApptId = null;
        _queueRemarksEditAppt = null;
        queueRemarksEditPriorRaw = null;
        plusApptScheduleRefreshAfterEdit();
    }

    var c1 = g('closeQueueRemarks');
    var c2 = g('cancelQueueRemarks');
    var sv = g('saveQueueRemarks');
    if (c1) c1.addEventListener('click', closeQm);
    if (c2) c2.addEventListener('click', closeQm);
    if (sv) {
        sv.addEventListener('click', function() {
            if (!queueRemarksEditApptId) return;
            var clean = remarksFromEditor('queueRemarksEditor');
            var raw = mergeStaffAuthorOnSave(clean, queueRemarksEditPriorRaw);
            SB.from('appointments')
                .update({ remarks: raw })
                .eq('id', queueRemarksEditApptId)
                .then(function(res) {
                    if (res.error) {
                        alert(trRepl('appt.msg.error', { MSG: res.error.message }));
                        return;
                    }
                    closeQm();
                    if (typeof loadQueue === 'function') loadQueue();
                    if (typeof loadToday === 'function') loadToday();
                    if (typeof loadPlusApptDay === 'function') loadPlusApptDay({ soft: true });
                });
        });
    }
}

function setQueueRemarksApptHint(q) {
    var hi = g('queueRemarksApptHint');
    if (!hi || !q) return;
    var cn = typeof getApptDisplayChinese === 'function'
        ? getApptDisplayChinese(q)
        : '';
    var en = (q.patient_name || '').trim();
    var name = [cn, en].filter(Boolean).join(' · ') || tr('appt.queue.noName');
    var bits = [name];
    if (q.start_time) bits.push(fmt12(q.start_time));
    if (q.patient_no) bits.push('#' + String(q.patient_no));
    hi.textContent = bits.join(' · ');
}

function openQueueRemarksEditor(q) {
    if (!q || !q.id) return;
    bindQueueRemarksModalOnce();

    queueRemarksEditApptId = q.id;
    _queueRemarksEditAppt = q;
    queueRemarksEditPriorRaw = q.remarks || null;
    setApptRemarksEditorHtml('queueRemarksEditor', q.remarks);
    setQueueRemarksApptHint(q);

    openModal('queueRemarksModal');
    var qm = g('queueRemarksModal');
    if (qm && typeof applyI18nInRoot === 'function') applyI18nInRoot(qm);
    var ed = g('queueRemarksEditor');
    if (ed) {
        requestAnimationFrame(function() {
            ed.focus();
            try {
                var sel = window.getSelection();
                var range = document.createRange();
                range.selectNodeContents(ed);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
            } catch (e) {}
        });
    }
}

// ════════════════════════════════════════════════════════════════
// QUEUE
// ════════════════════════════════════════════════════════════════
function queueIsClosedStatus(status) {
    var s = String(status || '').toLowerCase();
    return s === 'paid' || s === 'done' || s === 'finish' ||
        s === 'no show' || s === 'noshow' || s === 'cancelled';
}

function queueParseTimeMs(v) {
    if (!v) return NaN;
    var n = Date.parse(String(v));
    return isNaN(n) ? NaN : n;
}

function queueFormatElapsedMins(mins) {
    var m = Math.max(0, parseInt(mins || '0', 10) || 0);
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    var rm = m % 60;
    return h + 'h' + (rm ? (' ' + rm + 'm') : '');
}

function queueElapsedMeta(apptId, arrivalIso, status, updatedAtIso) {
    var arrMs = queueParseTimeMs(arrivalIso);
    if (!isFinite(arrMs)) return null;
    var id = String(apptId || '').trim();
    var closed = queueIsClosedStatus(status);
    var stopMs = Date.now();
    if (closed && id) {
        if (!queueElapsedClosedAtByApptId[id]) {
            var updMs = queueParseTimeMs(updatedAtIso);
            queueElapsedClosedAtByApptId[id] = isFinite(updMs) && updMs >= arrMs ? updMs : stopMs;
        }
        stopMs = queueElapsedClosedAtByApptId[id];
    }
    var mins = Math.max(0, Math.floor((stopMs - arrMs) / 60000));
    var cls = mins < 30 ? 'is-green' : (mins < 60 ? 'is-amber' : 'is-red');
    return {
        text: queueFormatElapsedMins(mins),
        toneClass: cls
    };
}

function queueElapsedBadgeHtml(apptId, arrivalIso, status, updatedAtIso) {
    var meta = queueElapsedMeta(apptId, arrivalIso, status, updatedAtIso);
    if (!meta) return '';
    return '<span class="queue-elapsed-badge ' + meta.toneClass + '" title="' +
        esc(tr('appt.queue.elapsedTitle')) + '"><span class="queue-elapsed-icon">⏱</span>' +
        esc(meta.text) + '</span>';
}

function queueArrivedClearCellHtml(q) {
    var timePart = q.arrival_time
        ? '<span class="queue-arrived-time-val">' +
          new Date(q.arrival_time).toLocaleTimeString(apptDateLocale(), {
              hour:   '2-digit',
              minute: '2-digit'
          }) + '</span>'
        : '<span class="queue-arrived-time-empty">—</span>';
    return '<td class="queue-arrived-cell plusappt-row-data-cell--clear">' +
        '<span class="queue-arrived-inline">' + timePart + '</span></td>';
}

function queueRefreshElapsedBadges() {
    var tb = g('queueBody');
    if (!tb) return;
    var clearMode = plusApptIsClearMode();
    tb.querySelectorAll('tr[data-appt-id]').forEach(function(row) {
        if (clearMode || row.classList.contains('queue-clear-row')) return;
        var host = row.querySelector('.queue-arrived-cell');
        if (!host) return;
        var stack = host.querySelector('.queue-arrived-stack') ||
            host.querySelector('.queue-arrived-inline') ||
            host;
        var badge = stack.querySelector('.queue-elapsed-badge');
        var html = queueElapsedBadgeHtml(
            row.dataset.apptId || '',
            row.dataset.arrivalTime || '',
            row.dataset.billStatus || '',
            row.dataset.updatedAt || ''
        );
        if (!html) {
            if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
            return;
        }
        if (!badge) {
            stack.insertAdjacentHTML('beforeend', html);
            return;
        }
        var meta = queueElapsedMeta(
            row.dataset.apptId || '',
            row.dataset.arrivalTime || '',
            row.dataset.billStatus || '',
            row.dataset.updatedAt || ''
        );
        if (!meta) return;
        badge.className = 'queue-elapsed-badge ' + meta.toneClass;
        badge.innerHTML = '<span class="queue-elapsed-icon">⏱</span>' + esc(meta.text);
    });
}

function ensureQueueElapsedTicker() {
    if (queueElapsedTickerId) return;
    queueElapsedTickerId = setInterval(function() {
        if (typeof apptActiveTabKey === 'function' && apptActiveTabKey() !== 'queue') return;
        queueRefreshElapsedBadges();
    }, 30000);
}

function loadQueue() {
    var tb = g('queueBody');
    if (!tb) return;
    var loadSeq = ++queueLoadSeq;
    setQueueRefreshMeta({ loading: true });
    tb.innerHTML =
        '<tr><td colspan="10" style="text-align:center;' +
        'color:#aaa;padding:24px;">' + esc(tr('appt.queue.loading')) + '</td></tr>';

    var qq = SB.from('appointments').select('*')
        .eq('date', todayISO())
        .not('in_queue', 'is', null)
        .order('in_queue',   {ascending: true})
        .order('start_time', {ascending: true});
    qq = applyApptModuleClinicQuery(qq);
    qq.then(function(r) {
        if (loadSeq !== queueLoadSeq) return;
        tb.innerHTML = '';
        var doStrip = function (apptRows) {
            if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.renderDoctorFilterStrip) {
                CalDoctorColors.renderDoctorFilterStrip('queueDoctorFilterBar', apptRows || []);
            }
        };
        if (r.error || !r.data || !r.data.length) {
            tb.innerHTML =
                '<tr><td colspan="10" style="text-align:center;' +
                'color:#aaa;padding:24px;">' +
                esc(tr('appt.queue.empty')) + '</td></tr>';
            apptRefreshPatientCountBadge('queue');
            doStrip([]);
            queueApptsCache = [];
            setQueueRefreshMeta({ stampNow: true });
            queueScheduleCompactFit();
            return;
        }
        augmentAppointmentsChineseFromPatients(r.data, function(rows) {
            if (loadSeq !== queueLoadSeq) return;
            tb.innerHTML = '';
            plusApptApplyTaskStateToList(rows);
            var activeRows = (rows || []).filter(function(q) {
                if (!q) return false;
                if (apptTransferIsCutPending(q.id)) return false;
                var s = String(q.bill_status || '').toLowerCase();
                return s !== 'cancelled';
            });
            queueApptsCache = activeRows;
            var visible = typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts
                ? CalDoctorColors.filterAppts(activeRows) : activeRows;
            apptRefreshPatientCountBadge('queue');
            if (!visible.length) {
                tb.innerHTML =
                    '<tr><td colspan="10" style="text-align:center;' +
                    'color:#aaa;padding:24px;">' +
                    esc(activeRows.length
                        ? tr('appt.queue.emptyFiltered')
                        : tr('appt.queue.empty')) +
                    '</td></tr>';
            } else {
                var dotCtx = apptListDoctorDotCtx(activeRows);
                visible.forEach(function(q, idx) {
                    buildQueueRow(tb, q, idx + 1, dotCtx);
                });
            }
            doStrip(activeRows);
            apptRestoreListRowSelection(tb, 'queue');
            setQueueRefreshMeta({ stampNow: true });
            ensureQueueElapsedTicker();
            queueRefreshElapsedBadges();
            queueScheduleCompactFit();
            hydrateApptUnpaidBalances(rows, function(changed) {
                if (!changed) return;
                if (loadSeq !== queueLoadSeq) return;
                if (typeof apptActiveTabKey === 'function' && apptActiveTabKey() === 'queue') {
                    loadQueue();
                }
            });
        });
    });
}

function apptConsultationDoctorContext(appt) {
    appt = appt || {};
    var ctx = {
        doctor_id: appt.doctor_id || appt.doctorId || null,
        doctor_code: String(appt.doctor_code || '').trim(),
        doctor_name: String(appt.doctor_name || '').trim()
    };
    return (ctx.doctor_id || ctx.doctor_code || ctx.doctor_name) ? ctx : null;
}

// seqNo: 1-based consultation order (top of list = first to see the doctor).
function buildQueueRow(tb, q, seqNo, dotCtx) {
    if (apptTransferIsCutPending(q.id)) return;
    var row = document.createElement('tr');
    var uid = q.id.replace(/-/g, '').slice(0, 12);
    var drDot = apptRowDoctorDotHtml(q, dotCtx);
    var clearMode = plusApptIsClearMode();

    row.dataset.apptId = q.id;
    row.dataset.arrivalTime = q.arrival_time || '';
    row.dataset.billStatus = q.bill_status || '';
    row.dataset.updatedAt = q.updated_at || '';
    row.classList.add('queue-row-draggable');
    if (clearMode) row.classList.add('queue-clear-row');
    if (q.bill_status === 'Billed') row.classList.add('queue-row-billed');
    else if (q.bill_status === 'Paid') row.classList.add('queue-row-paid');
    else if (q.bill_status === 'Done' || q.bill_status === 'Finish') row.classList.add('queue-row-finished');
    row.draggable = true;
    row.title = tr('appt.queue.dragTitle');

    var nameCellHtml;
    var treatCellHtml;
    var remarksCellHtml;
    var timeCellHtml;
    var arrivedCellHtml;
    var dataCls = clearMode ? ' plusappt-row-data-cell--clear' : '';

    if (clearMode) {
        nameCellHtml =
            '<td class="queue-name-cell plusappt-name-cell plusappt-row-data-cell--clear">' +
                queueClearModeNameHtml(q) +
            '</td>';
        treatCellHtml =
            '<td class="queue-treatment-cell plusappt-treat-cell plusappt-row-data-cell--clear">' +
                plusApptTreatmentInlineHtml(q, true) +
            '</td>';
        remarksCellHtml =
            '<td class="queue-remarks-cell plusappt-remarks-cell-wrap plusappt-row-data-cell--clear">' +
                '<div class="plusappt-remarks-preview-wrap queue-clear-remarks-inline">' +
                    apptUnpaidBadgeHtml(q, 'appt-unpaid-badge--remarks queue-clear-unpaid-badge') +
                    '<span class="queue-clear-remarks-body">' +
                        plusApptRemarksScrollerHtml(q.remarks, q.id, { hideStaffAuthor: true }) +
                        '<button type="button" class="queue-remarks-pencil queue-remarks-pencil--inline" ' +
                        'id="qrm-pencil-' + uid + '" ' +
                        'title="' + esc(tr('appt.queue.editRemarksTitle')) + '" aria-label="' + esc(tr('appt.queue.editRemarksAria')) + '">' +
                        '✎</button>' +
                    '</span>' +
                '</div>' +
            '</td>';
        timeCellHtml =
            '<td class="queue-time-cell plusappt-row-data-cell plusappt-row-data-cell--clear plusappt-clear-time">' +
                fmt12(q.start_time) +
            '</td>';
        arrivedCellHtml = queueArrivedClearCellHtml(q);
    } else {
        nameCellHtml =
            '<td class="queue-name-cell">' +
                '<span class="appt-row-name-wrap">' +
                    drDot +
                    '<span class="appt-row-name-stack">' +
                        apptPatientDisplayNameHTML(q, { walkIn: true }) +
                        (q.patient_no
                            ? '<div class="appt-name-subno">' +
                              esc(q.patient_no) +
                              '</div>'
                            : '') +
                    '</span>' +
                '</span>' +
            '</td>';
        treatCellHtml =
            '<td class="queue-treatment-cell">' +
                apptTreatInlineTextareaHtml(q.treatment_items, q.id, 'appt-treat-inline--queue') +
            '</td>';
        remarksCellHtml =
            '<td class="queue-remarks-cell">' +
                '<div class="queue-remarks-preview-wrap">' +
                    ((q.remarks || '').trim()
                        ? '<div class="queue-remarks-snippet">' +
                          formatRemarksForDisplay(q.remarks, { stripDr: true }) +
                          '</div>'
                        : '<div class="queue-remarks-snippet queue-remarks-empty">' +
                          esc(tr('appt.queue.noRemarks')) +
                          '</div>') +
                    apptUnpaidBadgeHtml(q, 'appt-unpaid-badge--remarks') +
                    apptTaskSummaryHtml(q) +
                    '<button type="button" class="queue-remarks-pencil" ' +
                    'id="qrm-pencil-' + uid + '" ' +
                    'title="' + esc(tr('appt.queue.editRemarksTitle')) + '" aria-label="' + esc(tr('appt.queue.editRemarksAria')) + '">' +
                    '✎</button>' +
                '</div>' +
            '</td>';
        timeCellHtml =
            '<td><strong>' + fmt12(q.start_time) + '</strong></td>';
        arrivedCellHtml =
            '<td class="queue-arrived-cell">' +
                '<div class="queue-arrived-stack">' +
                    '<div class="queue-arrived-time">' +
                        (q.arrival_time
                            ? '<span class="queue-arrived-time-val">' +
                              new Date(q.arrival_time).toLocaleTimeString(apptDateLocale(), {
                                  hour:   '2-digit',
                                  minute: '2-digit'
                              }) + '</span>'
                            : '<span class="queue-arrived-time-empty">—</span>') +
                    '</div>' +
                    queueElapsedBadgeHtml(q.id, q.arrival_time, q.bill_status, q.updated_at) +
                '</div>' +
            '</td>';
    }

    var seqCellHtml = clearMode
        ? '<td class="queue-clear-seq-cell' + dataCls + '">' +
            '<span class="queue-clear-seq">' + esc(String(seqNo)) + '</span>' +
          '</td>'
        : '<td>' +
            '<span style="background:#e8f4ff;color:var(--primary);' +
            'font-weight:700;font-size:13px;padding:3px 9px;' +
            'border-radius:12px;">' +
                esc(String(seqNo)) +
            '</span>' +
          '</td>';

    row.innerHTML =
        seqCellHtml +
        nameCellHtml +
        treatCellHtml +
        '<td class="appt-alert-cell' + dataCls + '">' + apptAlertCellHtml(q) + '</td>' +
        timeCellHtml +
        '<td class="queue-duration-cell' + dataCls + '">' +
            esc(arDurationDisplay(q)) +
        '</td>' +
        arrivedCellHtml +
        remarksCellHtml +
        '<td class="queue-status-cell' + dataCls + '">' +
            '<span class="status-badge ' +
                statusClass(q.bill_status) + '">' +
                esc(dispStatusLabel(q.bill_status || 'Queue')) +
            '</span>' +
        '</td>' +
        '<td class="queue-actions-cell' + dataCls + '">' +
            '<div class="action-wrap" id="aw-' + uid + '">' +
                '<button class="action-btn" id="ab-' + uid + '">' +
                    esc(tr('appt.queue.actions')) +
                '</button>' +
                '<div class="action-drop" id="ad-' + uid + '">' +
                    '<div class="action-item" id="act-bill-'   + uid + '">' +
                        '<span class="ai-icon">🧾</span>' + esc(tr('bill.queue.openBill')) +
                    '</div>' +
                    '<div class="action-item" id="act-notes-'  + uid + '">' +
                        '<span class="ai-icon">📝</span>' + esc(tr('appt.queue.clinicalNotes')) +
                    '</div>' +
                    '<div class="action-item" id="act-done-'   + uid + '">' +
                        '<span class="ai-icon">✅</span>' + esc(tr('appt.queue.markDone')) +
                    '</div>' +
                    '<div class="action-item" id="act-noshow-' + uid + '">' +
                        '<span class="ai-icon">🚫</span>' + esc(tr('appt.queue.noShow')) +
                    '</div>' +
                    '<div class="action-item" id="act-remove-' + uid + '">' +
                        '<span class="ai-icon">🗑</span>' + esc(tr('appt.queue.remove')) +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</td>';

    tb.appendChild(row);

    if (clearMode) {
        bindPlusApptTreatmentInline(row, q, { clearMode: true });
        bindPlusApptRemarksScroller(row, q.id);
        bindQueueClearRemarksDblclick(row, q);
    } else {
        apptBindTreatInlineField(row.querySelector('.appt-treat-inline'), function (saved) {
            q.treatment_items = saved;
        });
    }

    row.addEventListener('dragstart', function(e) {
        if (queueDragBlockedTarget(e.target)) {
            e.preventDefault();
            return;
        }
        if (e.target && e.target.closest && e.target.closest('.queue-patient-drag-handle')) {
            return;
        }
        queueReorderDragApptId = String(q.id);
        try {
            e.dataTransfer.setData('text/plain', String(q.id));
            e.dataTransfer.setData('text/x-joyful-appt-id', String(q.id));
            e.dataTransfer.setData('text/x-joyful-drag-source', 'queue-reorder');
            window.__JOYFUL_APPT_DRAG_APPT_ID = String(q.id);
            window.__JOYFUL_QUEUE_REORDER_ID = String(q.id);
        } catch (_) {}
        if (typeof clearPatientDragPayloadSession === 'function') {
            clearPatientDragPayloadSession();
        }
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('queue-row-dragging');
    });
    row.addEventListener('dragend', function() {
        row.classList.remove('queue-row-dragging');
        queueReorderDragApptId = '';
        try {
            window.__JOYFUL_APPT_DRAG_APPT_ID = '';
            window.__JOYFUL_QUEUE_REORDER_ID = '';
        } catch (_) {}
    });

    row.addEventListener('click', function(e) {
        if (apptListRowClickBlocked(e.target)) return;
        apptSelectListRow(q, row, 'queue');
    });

    if (q.patient_id || q.patient_no) {
        var queueNameTd = row.cells && row.cells[1] ? row.cells[1] : null;
        if (queueNameTd) {
            queueNameTd.classList.add('queue-patient-drag-handle');
            queueNameTd.setAttribute('draggable', 'true');
            queueNameTd.title = typeof tr === 'function' ? tr('activePatient.dragFromApptTitle') : '';
            queueNameTd.addEventListener('dragstart', function(e) {
                e.stopPropagation();
                if (typeof plusApptMarkRowDragTransfer === 'function') {
                    plusApptMarkRowDragTransfer(e, q);
                }
                if (typeof beginApptPatientDragTransfer === 'function') {
                    beginApptPatientDragTransfer(e, q);
                }
                queueNameTd.classList.add('queue-patient-dragging');
            });
            queueNameTd.addEventListener('dragend', function(e) {
                e.stopPropagation();
                queueNameTd.classList.remove('queue-patient-dragging');
                plusApptDragApptId = null;
                plusApptSetMiniCalDragOver(false);
                if (typeof clearPatientDragPayloadSession === 'function') {
                    clearPatientDragPayloadSession();
                }
            });
        }
    }

    row.addEventListener('dblclick', function (e) {
        if (queuePatientEditDblclickBlocked(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        openEditPatientFromQueueRow(q);
    });

    var drop = g('ad-' + uid);
    var btn  = g('ab-' + uid);

    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        document.querySelectorAll('.action-drop.open')
            .forEach(function(d) {
                if (d !== drop) d.classList.remove('open');
            });
        if (drop.classList.contains('open')) {
            drop.classList.remove('open');
            return;
        }
        var rect  = btn.getBoundingClientRect();
        // action-drop is position:fixed; keep coordinates in viewport space (no scrollY).
        var dropW = 200;
        var dropH = 240;
        var gap = 4;
        var edge = 8;
        var top = rect.bottom + gap;
        if (top + dropH > window.innerHeight - edge) {
            top = rect.top - dropH - gap;
        }
        if (top < edge) top = edge;
        var left = rect.right - dropW;
        if (left + dropW > window.innerWidth - edge) {
            left = window.innerWidth - dropW - edge;
        }
        if (left < edge) left = edge;
        drop.style.top  = Math.round(top) + 'px';
        drop.style.left = Math.round(left) + 'px';
        drop.classList.add('open');
    });

    g('act-bill-' + uid).addEventListener('click', function(e) {
        e.stopPropagation();
        drop.classList.remove('open');
        setTimeout(function() { openBillPanel(q); }, 60);
    });
    row.querySelectorAll('.appt-task-pill-btn[data-task-cycle="1"]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var aid = btn.getAttribute('data-appt-id');
            var kind = btn.getAttribute('data-task-kind');
            if (!aid || !kind) return;
            apptTaskCycleFromSummary(aid, kind);
        });
        btn.addEventListener('dblclick', function(e) {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    g('act-notes-' + uid).addEventListener('click', function(e) {
        e.stopPropagation();
        drop.classList.remove('open');
        var pid = q.patient_id;
        if (!pid) {
            alert(tr('appt.queue.noPatientLinked'));
            return;
        }
        setTimeout(function() {
            openConForPatient(pid, { doctorContext: apptConsultationDoctorContext(q) });
        }, 80);
    });

    g('act-done-' + uid).addEventListener('click', function(e) {
        e.stopPropagation();
        drop.classList.remove('open');
        setTimeout(function() { updateQueueStatus(q.id, 'Done'); }, 60);
    });

    g('act-noshow-' + uid).addEventListener('click', function(e) {
        e.stopPropagation();
        drop.classList.remove('open');
        setTimeout(function() { updateQueueStatus(q.id, 'No Show'); }, 60);
    });

    g('act-remove-' + uid).addEventListener('click', function(e) {
        e.stopPropagation();
        drop.classList.remove('open');
        setTimeout(function() {
            if (!confirm(trRepl('appt.queue.confirmRemove', {
                NAME: q.patient_name || tr('appt.today.thisPatient')
            }))) return;
            SB.from('appointments')
                .update({
                    bill_status: 'Scheduled',
                    in_queue:    null,
                    arrival_time: null
                })
                .eq('id', q.id)
            .then(function(res) {
                if (res.error) {
                    alert(trRepl('appt.msg.error', { MSG: res.error.message })); return;
                }
                loadQueue();
            });
        }, 60);
    });

    var pencil = g('qrm-pencil-' + uid);
    if (pencil) {
        pencil.addEventListener('click', function(e) {
            e.stopPropagation();
            e.preventDefault();
            drop.classList.remove('open');
            openQueueRemarksEditor(q);
        });
    }

    var remarksWrap = row.querySelector('.queue-remarks-preview-wrap, .plusappt-remarks-preview-wrap');
    if (remarksWrap) {
        remarksWrap.addEventListener('dblclick', function(e) {
            e.stopPropagation();
            e.preventDefault();
            drop.classList.remove('open');
            openQueueRemarksEditor(q);
        });
    }
}

function updateApptBillStatus(apptId, status) {
    SB.from('appointments')
        .update({ bill_status: status })
        .eq('id', apptId)
    .then(function(r) {
        if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
        if (typeof arAllData !== 'undefined' && arAllData && arAllData.length) {
            var cached = arAllData.find(function(x) { return String(x.id) === String(apptId); });
            if (cached) cached.bill_status = status;
            if (typeof arRender === 'function') arRender();
        }
        if (typeof loadQueue === 'function') loadQueue();
        if (typeof loadToday === 'function') loadToday();
    });
}

function updateQueueStatus(apptId, status) {
    updateApptBillStatus(apptId, status);
}

// ════════════════════════════════════════════════════════════════
// CALENDAR
// ════════════════════════════════════════════════════════════════
function renderCal(opts) {
    opts = opts || {};
    if (!opts.force && apptModuleEditPaused('calendar')) {
        apptModuleMarkRefreshDeferred('calendar');
        opts = Object.assign({}, opts, { soft: true });
    }
    var miniBtn = g('calMonthMiniBtn');
    if (miniBtn) miniBtn.style.display = (calView === 'monthly') ? 'inline-flex' : 'none';
    if (calView !== 'monthly') {
        calMonthTransferDragApptId = null;
        calMonthTransferState = null;
        calMonthBulkTransferDragDate = '';
        calMonthBulkTransferState = null;
        calMonthMiniOpen = false;
        var miniHostHide = g('calMonthMiniCal');
        if (miniHostHide) {
            miniHostHide.style.display = 'none';
            miniHostHide.classList.remove('open', 'gcal-mini-cal--transfer-over', 'gcal-mini-cal--transfer-armed');
        }
    }
    if (calView === 'weekly') renderWeekly(opts);
    else                       renderMonthly(opts);
}

// ── Monthly ───────────────────────────────────────────────────
function calMonthMiniHost() {
    return g('calMonthMiniCal');
}

function calMonthBulkTransferSnapshot(fromDate, count) {
    var iso = String(fromDate || '').trim();
    if (!iso) return null;
    return {
        fromDate: iso,
        count: Math.max(0, parseInt(count || '0', 10) || 0)
    };
}

function bindCalMonthMiniToolbarBtn() {
    var btn = g('calMonthMiniBtn');
    if (!btn || btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function() {
        if (calView !== 'monthly') return;
        calMonthMiniOpen = !calMonthMiniOpen;
        if (calMonthMiniOpen) {
            calMonthMiniDate = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
        }
        renderCalMonthMini();
    });
}

function renderCalMonthMini() {
    var host = calMonthMiniHost();
    if (!host) return;
    if (!calMonthMiniOpen || calView !== 'monthly') {
        host.style.display = 'none';
        host.classList.remove('open', 'gcal-mini-cal--transfer-over', 'gcal-mini-cal--transfer-armed');
        return;
    }
    var y = calMonthMiniDate.getFullYear();
    var mo = calMonthMiniDate.getMonth();
    var monthLabel = new Date(y, mo, 1).toLocaleDateString(apptDateLocale(), { month: 'long', year: 'numeric' });
    var firstDow = new Date(y, mo, 1).getDay();
    var daysInMonth = new Date(y, mo + 1, 0).getDate();
    var nowLocal = new Date();
    var todayLocal = d2iso(new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate()));
    var btnS = 'background:none;border:none;cursor:pointer;font-size:16px;' +
        'color:#64748b;width:24px;height:24px;border-radius:4px;line-height:1;padding:0;';
    var html =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;padding-bottom:7px;border-bottom:1px solid #f1f5f9;">' +
            '<button type="button" id="calMonthMiniPrevBtn" style="' + btnS + '">‹</button>' +
            '<span style="font-size:12px;font-weight:700;color:#1e293b;">' + esc(monthLabel) + '</span>' +
            '<button type="button" id="calMonthMiniNextBtn" style="' + btnS + '">›</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;text-align:center;">';
    apptCalWeekdayHeaders().forEach(function(lbl) {
        html += '<div style="font-size:9px;font-weight:700;color:#94a3b8;padding:2px 0;">' + esc(lbl.charAt(0)) + '</div>';
    });
    for (var b = 0; b < firstDow; b++) html += '<div></div>';
    for (var day = 1; day <= daysInMonth; day++) {
        var iso = y + '-' + pad(mo + 1) + '-' + pad(day);
        var isToday = iso === todayLocal;
        var cs = 'cursor:pointer;padding:3px 1px;font-size:11px;border-radius:4px;';
        if (isToday) cs += 'background:#0084ff;color:#fff;font-weight:700;';
        else cs += 'color:#374151;';
        html += '<div class="cal-month-mini-day" data-iso="' + iso + '" style="' + cs + '">' + day + '</div>';
    }
    html += '</div>';
    html +=
        '<button type="button" id="calMonthMiniTodayBtn" style="margin-top:10px;width:100%;padding:5px;background:#f0f7ff;color:#0084ff;border:1px solid #bfdbfe;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">' +
            esc(tr('appt.cal.jumpToday')) + '</button>';
    host.innerHTML = html;
    host.style.display = '';
    host.classList.add('open');
    host.classList.remove('gcal-mini-cal--transfer-armed', 'gcal-mini-cal--transfer-over');
    var prevBtn = host.querySelector('#calMonthMiniPrevBtn');
    if (prevBtn) prevBtn.addEventListener('click', function() {
        calMonthMiniDate = new Date(calMonthMiniDate.getFullYear(), calMonthMiniDate.getMonth() - 1, 1);
        renderCalMonthMini();
    });
    var nextBtn = host.querySelector('#calMonthMiniNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', function() {
        calMonthMiniDate = new Date(calMonthMiniDate.getFullYear(), calMonthMiniDate.getMonth() + 1, 1);
        renderCalMonthMini();
    });
    var todayBtn = host.querySelector('#calMonthMiniTodayBtn');
    if (todayBtn) todayBtn.addEventListener('click', function() {
        var n = new Date();
        calDate = new Date(n.getFullYear(), n.getMonth(), n.getDate());
        calMonthMiniDate = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
        if (typeof syncApptPlannerDate === 'function') {
            syncApptPlannerDate(todayISO(), { syncCal: false });
        }
        renderCal();
    });
    host.querySelectorAll('.cal-month-mini-day').forEach(function(dayEl) {
        dayEl.addEventListener('click', function() {
            var iso = dayEl.getAttribute('data-iso');
            if (!iso) return;
            if (typeof GCAL !== 'undefined' && GCAL.pickMiniCalDate) {
                GCAL.pickMiniCalDate(iso);
            } else {
                calDate = new Date(iso + 'T00:00:00');
                renderCal();
            }
        });
    });
    bindCalMonthMiniTransferDrop();
}

function calMonthTransferSnapshot(appt) {
    if (!appt || !appt.id) return null;
    var dur = parseInt(appt.duration || '0', 10);
    if (!dur || dur < 1) {
        var stM = plusApptTimeToMin(appt.start_time);
        var enM = plusApptTimeToMin(appt.end_time);
        dur = (enM > stM) ? (enM - stM) : PLUSAPPT_SLOT_MIN;
    }
    return {
        apptId: appt.id,
        fromDate: appt.date || todayISO(),
        doctorLabel: appt.doctor_code || appt.doctor_name || '',
        patientName: appt.patient_name || '',
        patientChineseName: appt.patient_chinese_name || '',
        startTime: plusApptNormTime(appt.start_time || '09:00'),
        duration: dur
    };
}

function bindCalMonthMiniTransferDrop() {
    var host = calMonthMiniHost();
    if (!host || host.dataset.monthTransferDropBound === '1') return;
    host.dataset.monthTransferDropBound = '1';
    host.addEventListener('dragover', function(ev) {
        if (calView !== 'monthly') return;
        var allow = false;
        if (calMonthTransferDragApptId) {
            var dragAppt = calMonthApptsCache.find(function(x) { return String(x.id) === String(calMonthTransferDragApptId); });
            if (dragAppt && !isApptScheduleLocked(dragAppt)) allow = true;
        }
        if (!allow && calMonthBulkTransferDragDate) allow = true;
        if (!allow) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = 'move';
        host.classList.add('gcal-mini-cal--transfer-over');
    });
    host.addEventListener('dragleave', function(ev) {
        var rect = host.getBoundingClientRect();
        var x = ev.clientX;
        var y = ev.clientY;
        var inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        if (!inside) host.classList.remove('gcal-mini-cal--transfer-over');
    });
    host.addEventListener('drop', function(ev) {
        host.classList.remove('gcal-mini-cal--transfer-over');
        if (calView !== 'monthly') return;
        if (!calMonthTransferDragApptId && !calMonthBulkTransferDragDate) return;
        ev.preventDefault();
        if (calMonthBulkTransferDragDate) {
            var fromIso = calMonthBulkTransferDragDate;
            var count = calMonthApptsCache.filter(function(x) {
                return String(x.date || '') === String(fromIso);
            }).length;
            calMonthBulkTransferState = calMonthBulkTransferSnapshot(fromIso, count);
            calMonthBulkTransferDragDate = '';
            calMonthTransferState = null;
            calMonthTransferDragApptId = null;
            renderCalMonthMini();
            return;
        }
        var dragAppt = calMonthApptsCache.find(function(x) { return String(x.id) === String(calMonthTransferDragApptId); });
        if (!dragAppt || isApptScheduleLocked(dragAppt)) return;
        if (!apptTransferBeginPendingCut(dragAppt)) return;
        calMonthTransferState = calMonthTransferSnapshot(dragAppt);
        calMonthBulkTransferState = null;
        calMonthTransferDragApptId = null;
        renderCalMonthMini();
    });
}

function repaintCalMonthPills() {
    if (typeof calView !== 'undefined' && calView !== 'monthly') return;
    var cb = g('calBody');
    if (!cb || typeof CalDoctorColors === 'undefined' || !CalDoctorColors.getStyleForAppt) return;
    var monthById = {};
    (calMonthApptsCache || []).forEach(function (a) {
        if (a && a.id) monthById[String(a.id)] = a;
    });
    cb.querySelectorAll('.gcal-month-pill[data-id]').forEach(function (pill) {
        var ap = monthById[String(pill.getAttribute('data-id') || '')];
        if (!ap) return;
        var sty = CalDoctorColors.getStyleForAppt(ap);
        pill.style.setProperty('border-left', '4px solid ' + sty.borderColor, 'important');
        pill.style.setProperty('background', sty.background, 'important');
        pill.dataset.drColor = sty.color;
        var drEl = pill.querySelector('.gcal-month-pill-dr');
        if (drEl) drEl.style.color = sty.color;
    });
}

function renderMonthly(opts) {
    opts = opts || {};
    bindCalMonthMiniToolbarBtn();
    var y  = calDate.getFullYear();
    var m  = calDate.getMonth();
    var ct = g('calTitle');
    var cb = g('calBody');
    if (ct) ct.textContent =
        new Date(y, m, 1).toLocaleDateString(apptDateLocale(), {
            month: 'long', year: 'numeric'
        });

    var first = y + '-' + pad(m + 1) + '-01';
    var last  = y + '-' + pad(m + 1) + '-' +
                pad(new Date(y, m + 1, 0).getDate());

    var mq = SB.from('appointments').select('*')
        .gte('date', first)
        .lte('date', last)
        .order('start_time', {ascending: true});
    mq = applyApptModuleClinicQuery(mq);
    mq.then(function(r) {
        var appts = r.data || [];
        hydrateApptUnpaidBalances(appts, function(changed) {
            if (!changed) return;
            if (calView === 'monthly') renderMonthly();
        });
        calMonthApptsCache = appts.slice();
        if (!opts.force && apptModuleEditPaused('calendar')) {
            apptModuleMarkRefreshDeferred('calendar');
            return;
        }
        var map   = {};
        appts.forEach(function(a) {
            if (!map[a.date]) map[a.date] = [];
            map[a.date].push(a);
        });

        var html = '<div class="cal-grid gcal-month-grid">';
        apptCalWeekdayHeaders().forEach(function(d) {
            html += '<div class="cal-day-hdr">' + esc(d) + '</div>';
        });

        var startDow    = new Date(y, m, 1).getDay();
        for (var b = 0; b < startDow; b++) {
            html += '<div class="cal-cell cal-blank"></div>';
        }

        var daysInMonth = new Date(y, m + 1, 0).getDate();
        var todayStr    = todayISO();
        for (var d2 = 1; d2 <= daysInMonth; d2++) {
            var iso  = y + '-' + pad(m + 1) + '-' + pad(d2);
            var isTo = iso === todayStr;
            var list = map[iso] || [];
            if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts) {
                list = CalDoctorColors.filterAppts(list);
            }
            html +=
                '<div class="cal-cell' +
                (isTo ? ' cal-today' : '') +
                '" data-date="' + iso + '">' +
                    '<div class="cal-cell-num">' + d2 +
                        (list.length
                            ? '<span class="gcal-month-day-move" draggable="true" data-day-iso="' + iso + '" data-day-count="' + list.length + '" title="Move all appointments of this day">⇄</span>'
                            : '') +
                    '</div>';
            var monthShow = 4;
            list.slice(0, monthShow).forEach(function(a) {
                html += typeof CalDoctorColors !== 'undefined'
                    ? CalDoctorColors.monthPillHtml(a)
                    : ('<div class="appt-pill" data-id="' + esc(a.id) + '">' +
                       esc(fmt12(a.start_time)) + ' ' +
                       esc(a.patient_name || tr('appt.cal.cardWalkin')) + '</div>');
            });
            if (list.length > monthShow) {
                html += '<div class="gcal-month-more">' +
                    esc(trRepl('appt.cal.more', { N: list.length - monthShow })) + '</div>';
            }
            html += '</div>';
        }
        html += '</div>';
        cb.innerHTML = html;
        var monthById = {};
        appts.forEach(function(a) {
            if (a && a.id) monthById[String(a.id)] = a;
        });
        cb.querySelectorAll('.gcal-month-pill[data-id], .appt-pill[data-id]').forEach(function(pill) {
            var aid = String(pill.getAttribute('data-id') || '').trim();
            var ap = monthById[aid];
            if (!ap) return;
            if (pill.querySelector('.appt-unpaid-badge')) return;
            var badge = apptUnpaidBadgeHtml(ap, 'appt-unpaid-badge--month');
            if (!badge) return;
            pill.innerHTML += ' ' + badge;
        });
        if (typeof CalDoctorColors !== 'undefined') {
            CalDoctorColors.renderLegend(appts, typeof currentClinicId !== 'undefined' ? currentClinicId : null);
        }

        cb.querySelectorAll('.cal-cell[data-date]').forEach(function(cell) {
            cell.addEventListener('click', function(e) {
                if (e.target.closest && e.target.closest('.appt-pill, .gcal-month-pill, .gcal-month-day-move')) return;
                showDayPanel(cell.dataset.date, map);
            });
        });
        bindMonthlyCalActivePatientDrop(cb);

        cb.querySelectorAll('.gcal-month-day-move').forEach(function(handle) {
            handle.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
            });
            handle.addEventListener('dragstart', function(e) {
                var fromIso = handle.getAttribute('data-day-iso');
                if (!fromIso) {
                    e.preventDefault();
                    return;
                }
                calMonthBulkTransferDragDate = fromIso;
                handle.classList.add('is-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', fromIso);
            });
            handle.addEventListener('dragend', function() {
                calMonthBulkTransferDragDate = '';
                handle.classList.remove('is-dragging');
                var host = calMonthMiniHost();
                if (host) host.classList.remove('gcal-mini-cal--transfer-over');
            });
        });

        cb.querySelectorAll('.appt-pill, .gcal-month-pill').forEach(function(pill) {
            var aid = pill.dataset.id;
            var a   = appts.find(function(x) { return x.id === aid; });
            var locked = isApptScheduleLocked(a);
            if (a && !locked) pill.setAttribute('draggable', 'true');
            pill.addEventListener('dragstart', function(e) {
                if (!a || locked) {
                    e.preventDefault();
                    return;
                }
                calMonthTransferDragApptId = a.id;
                pill.classList.add('gcal-month-pill-dragging');
                if (typeof beginApptPatientDragTransfer === 'function') {
                    beginApptPatientDragTransfer(e, a);
                } else {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(a.id));
                }
            });
            pill.addEventListener('dragend', function() {
                calMonthTransferDragApptId = null;
                if (typeof clearPatientDragPayloadSession === 'function') {
                    clearPatientDragPayloadSession();
                }
                pill.classList.remove('gcal-month-pill-dragging');
                var host = calMonthMiniHost();
                if (host) host.classList.remove('gcal-mini-cal--transfer-over');
            });
            pill.addEventListener('click', function(e) {
                e.stopPropagation();
                if (a) {
                    apptSnapActivePatientFromCalendarAppt(a, 'calendar-monthly-pill-select');
                    showApptPopup(a, pill);
                }
            });
        });
        bindCalMonthMiniTransferDrop();
        if (calMonthMiniOpen) {
            calMonthMiniDate = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
        }
        renderCalMonthMini();
        apptRefreshPatientCountBadge('calendar');
    });
}

// ════════════════════════════════════════════════════════════════
// WEEKLY CALENDAR — schedule lock (pin card; block drag / delete)
// ════════════════════════════════════════════════════════════════
var GCAL_LOCK_LS_KEY = 'gcal_schedule_locked_v1';

function scheduleLockedMap() {
    try {
        var raw = localStorage.getItem(GCAL_LOCK_LS_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
}

function isApptScheduleLocked(appt) {
    if (!appt) return false;
    if (appt.schedule_locked === true || appt.schedule_locked === 1) return true;
    return !!scheduleLockedMap()[String(appt.id)];
}

function mergeScheduleLockedLocal(list) {
    if (!list || !list.length) return;
    var map = scheduleLockedMap();
    list.forEach(function (a) {
        if (a.schedule_locked === true || a.schedule_locked === 1) return;
        if (map[String(a.id)]) a.schedule_locked = true;
    });
}

function setApptScheduleLockFormUI(locked) {
    apptEditScheduleLocked = !!locked;
    var db = g('deleteApptBtn');
    if (db) db.style.display = (apptEditId && !locked) ? 'block' : 'none';
    var note = g('apptScheduleLockNote');
    if (note) note.style.display = locked ? 'block' : 'none';
    var actWrap = g('apptScheduleLockActions');
    var lockBtn = g('apptScheduleLockToggleBtn');
    if (actWrap) actWrap.style.display = apptEditId ? 'block' : 'none';
    if (lockBtn) {
        lockBtn.classList.toggle('is-locked', !!locked);
        lockBtn.textContent = locked ? tr('appt.cal.popupUnlock') : tr('appt.cal.popupLock');
    }
    ['fDate', 'fStart', 'fDur'].forEach(function (id) {
        var el = g(id);
        if (!el) return;
        el.disabled = locked;
        el.style.opacity = locked ? '0.55' : '';
        el.style.cursor = locked ? 'not-allowed' : '';
    });
}

function toggleApptScheduleLockFromModal() {
    if (!apptEditId || !apptEditLockRef) return;
    var nextLocked = !isApptScheduleLocked(apptEditLockRef);
    persistApptScheduleLock(apptEditLockRef, nextLocked, function(ok) {
        if (!ok) return;
        setApptScheduleLockFormUI(nextLocked);
    });
}

function findGcalCardEl(apptId) {
    return document.querySelector('.gcal-card[data-id="' + apptId + '"]');
}

function applyGcalCardLockState(card, appt) {
    if (!card || !appt) return;
    var locked = isApptScheduleLocked(appt);
    card.classList.toggle('gcal-card-locked', locked);
    var btn = card.querySelector('.gcal-card-lock');
    if (btn) {
        btn.classList.toggle('locked', locked);
        btn.textContent = locked ? '🔒' : '🔓';
        btn.title = locked
            ? tr('appt.cal.lockUnlockTitle')
            : tr('appt.cal.lockPinTitle');
        btn.setAttribute('aria-label', locked
            ? tr('appt.cal.lockAriaUnlock')
            : tr('appt.cal.lockAriaLock'));
    }
}

function refreshGcalLockButtonsI18n() {
    document.querySelectorAll('.gcal-card-lock').forEach(function (btn) {
        var locked = btn.classList.contains('locked');
        btn.title = locked
            ? tr('appt.cal.lockUnlockTitle')
            : tr('appt.cal.lockPinTitle');
        btn.setAttribute('aria-label', locked
            ? tr('appt.cal.lockAriaUnlock')
            : tr('appt.cal.lockAriaLock'));
    });
}

function persistApptScheduleLock(appt, locked, done) {
    if (!appt || !appt.id) {
        if (done) done(false);
        return;
    }
    var id = String(appt.id);
    var map = scheduleLockedMap();
    appt.schedule_locked = !!locked;
    if (locked) map[id] = true;
    else delete map[id];
    try { localStorage.setItem(GCAL_LOCK_LS_KEY, JSON.stringify(map)); } catch (e) {}

    function finish(ok) {
        var card = findGcalCardEl(appt.id);
        if (card) applyGcalCardLockState(card, appt);
        if (done) done(ok);
    }

    SB.from('appointments').update({ schedule_locked: !!locked }).eq('id', appt.id)
    .then(function (r) {
        if (r.error && (r.error.message || '').indexOf('schedule_locked') >= 0) {
            finish(true);
            return;
        }
        if (r.error) {
            alert(trRepl('appt.cal.lockUpdateFail', { MSG: r.error.message }));
            appt.schedule_locked = !locked;
            if (locked) delete map[id];
            else map[id] = true;
            try { localStorage.setItem(GCAL_LOCK_LS_KEY, JSON.stringify(map)); } catch (e2) {}
            finish(false);
            return;
        }
        finish(true);
    });
}

// ════════════════════════════════════════════════════════════════
// GOOGLE CALENDAR WEEKLY TIMELINE — GCAL module
// ════════════════════════════════════════════════════════════════
var GCAL = (function () {

    var DEFAULTS = { interval: 15, startHour: 9, endHour: 24, slotH: 24, doctorColors: {} };
    var PALETTE  = ['#0ea5e9','#10b981','#f59e0b','#ef4444',
                    '#8b5cf6','#ec4899','#14b8a6','#f97316',
                    '#6366f1','#84cc16','#06b6d4','#a855f7'];

    var S          = null;
    var appts      = [];
    var days       = [];
    var dragState  = null;
    var resizeState = null;
    var suppressCardClickUntil = 0;
    var nowTimer   = null;
    var knownKeys  = [];   // unique doctor_code / treatment_items for settings

    // ── Settings ─────────────────────────────────────────────────
    function loadSettings() {
        try {
            var stored = localStorage.getItem('gcal_settings_v2');
            if (!stored) {
                S = Object.assign({}, DEFAULTS);
            } else {
                var merged = Object.assign({}, DEFAULTS, JSON.parse(stored));
                var before = {
                    startHour: merged.startHour,
                    endHour: merged.endHour,
                    timelineDefaultsVer: merged.timelineDefaultsVer
                };
                S = gcalNormalizeTimelineSettings(merged);
                gcalPersistSettingsIfChanged(before, S);
            }
        } catch (e) { S = Object.assign({}, DEFAULTS); }
        if (!S.doctorColors) S.doctorColors = {};
    }
    function saveSettings() {
        try { localStorage.setItem('gcal_settings_v2', JSON.stringify(S)); } catch(e) {}
    }

    // ── Time helpers ─────────────────────────────────────────────
    function timeToMin(t) {
        if (!t) return 0;
        var p = String(t).split(':');
        return parseInt(p[0], 10) * 60 + (parseInt(p[1] || '0', 10));
    }
    function minToTimeStr(m) {
        m = Math.max(0, Math.min(m, 23 * 60 + 59));
        return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
    }
    /** Weekly timeline min 16px; extra-compact (12px) applies to + Appointment table only. */
    function gcalEffectiveSlotH() {
        var h = parseInt(S.slotH, 10);
        if (isNaN(h)) h = 24;
        return h < 16 ? 16 : h;
    }
    function topFromTime(t) {
        return Math.max(0, (timeToMin(t) - S.startHour * 60) / S.interval * gcalEffectiveSlotH());
    }
    function totalH() {
        return (S.endHour - S.startHour) * 60 / S.interval * gcalEffectiveSlotH();
    }

    // ── Colour helpers ───────────────────────────────────────────
    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        return parseInt(hex.slice(0,2),16)+','+parseInt(hex.slice(2,4),16)+','+parseInt(hex.slice(4,6),16);
    }
    function colorHash(str) {
        var h = 0;
        for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffff;
        return PALETTE[h % PALETTE.length];
    }
    function getCardColor(a) {
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.getStyleForAppt) {
            return CalDoctorColors.getStyleForAppt(a).borderColor;
        }
        var key = a.doctor_code || a.doctor_name || 'default';
        return (S.doctorColors && S.doctorColors[key]) || colorHash(key);
    }

    function getCardStyle(a) {
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.getStyleForAppt) {
            return CalDoctorColors.getStyleForAppt(a);
        }
        var color = getCardColor(a);
        var bgRgb = hexToRgb(color);
        return {
            color: color,
            borderColor: color,
            background: 'rgba(' + bgRgb + ',0.24)'
        };
    }

    // ── Safe local-date constructor (avoids UTC midnight = prev-day in UTC- zones)
    function makeLocalDate(y, m, d2) { return new Date(y, m, d2); }
    function parseISO(isoStr) {
        var p = String(isoStr).split('-');
        return makeLocalDate(+p[0], +p[1] - 1, +p[2]);
    }

    // ── Main render ──────────────────────────────────────────────
    function render(opts) {
        opts = opts || {};
        loadSettings();
        var ct = g('calTitle');
        var cb = g('calBody');
        if (!cb) return;
        var paused = !opts.force &&
            typeof apptModuleEditPaused === 'function' &&
            apptModuleEditPaused('calendar');
        if (paused && typeof apptModuleMarkRefreshDeferred === 'function') {
            apptModuleMarkRefreshDeferred('calendar');
        }

        // Always recompute calDate as today when first entering weekly view
        // (prevents stale date if tab was loaded yesterday)
        var localToday = makeLocalDate(
            new Date().getFullYear(), new Date().getMonth(), new Date().getDate()
        );

        // Build week days using purely local date arithmetic
        var dow = calDate.getDay();
        var sunY = calDate.getFullYear(), sunM = calDate.getMonth(),
            sunD = calDate.getDate() - dow;
        days = [];
        for (var i = 0; i < 7; i++) {
            days.push(makeLocalDate(sunY, sunM, sunD + i));
        }
        if (ct) ct.textContent =
            days[0].toLocaleDateString(apptDateLocale(), {month:'short',day:'numeric'}) + ' – ' +
            days[6].toLocaleDateString(apptDateLocale(), {month:'short',day:'numeric',year:'numeric'});

        var wq = SB.from('appointments').select('*')
            .gte('date', d2iso(days[0])).lte('date', d2iso(days[6]))
            .order('start_time', {ascending: true});
        wq = applyApptModuleClinicQuery(wq);
        wq.then(function (r) {
            appts = r.data || [];
            calWeekApptsCache = appts.slice();
            hydrateApptUnpaidBalances(appts, function(changed) {
                if (!changed) return;
                if (calView === 'weekly') renderWeekly();
            });
            mergeScheduleLockedLocal(appts);
            if (paused) return;
            // collect unique doctor / treatment keys for settings panel
            knownKeys = [];
            var kSet = {};
            appts.forEach(function (a) {
                var k = a.doctor_code || a.doctor_name || a.treatment_items || '';
                if (k && !kSet[k]) { kSet[k] = true; knownKeys.push(k); }
            });
            var panelSt = captureGcalPanelState();
            var scrollBody = document.getElementById('gcalScrollBody');
            var savedScrollTop = scrollBody ? scrollBody.scrollTop : 0;
            buildDOM(cb, { preserveScroll: panelSt.settingsOpen, scrollTop: savedScrollTop });
            restoreGcalPanelState(panelSt);
            if (typeof CalDoctorColors !== 'undefined') {
                CalDoctorColors.renderLegend(appts, typeof currentClinicId !== 'undefined' ? currentClinicId : null);
            }
            if (typeof apptRefreshPatientCountBadge === 'function') {
                apptRefreshPatientCountBadge('calendar');
            }
        });
    }


    function layoutDayColumns(dayAppts) {
        var evts = dayAppts.map(function (a) {
            return {
                appt: a,
                start: timeToMin(a.start_time),
                end: Math.max(timeToMin(a.end_time), timeToMin(a.start_time) + 15)
            };
        }).sort(function (x, y) { return x.start - y.start || x.end - y.end; });

        var clusters = [];
        var cluster = null;
        evts.forEach(function (e) {
            if (!cluster || e.start >= cluster.endMax) {
                cluster = { events: [], endMax: 0 };
                clusters.push(cluster);
            }
            cluster.events.push(e);
            cluster.endMax = Math.max(cluster.endMax, e.end);
        });

        var out = [];
        clusters.forEach(function (cl) {
            var cols = [];
            cl.events.forEach(function (e) {
                var placed = false;
                for (var ci = 0; ci < cols.length; ci++) {
                    if (cols[ci] <= e.start) {
                        cols[ci] = e.end;
                        e.col = ci;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    e.col = cols.length;
                    cols.push(e.end);
                }
            });
            var nCols = Math.max(1, cols.length);
            cl.events.forEach(function (e) {
                out.push({ appt: e.appt, col: e.col, totalCols: nCols });
            });
        });
        return out;
    }

    function repaintCards() {
        document.querySelectorAll('.gcal-card[data-id]').forEach(function (card) {
            var id = String(card.dataset.id || '');
            if (!id) return;
            var a = null;
            for (var i = 0; i < appts.length; i++) {
                if (appts[i] && String(appts[i].id) === id) {
                    a = appts[i];
                    break;
                }
            }
            if (!a) return;
            if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.paintElement) {
                CalDoctorColors.paintElement(card, a);
            } else {
                var sty = getCardStyle(a);
                card.style.borderLeft = '4px solid ' + sty.borderColor;
                card.style.background = sty.background;
            }
        });
    }

    // ── Build entire calendar DOM ────────────────────────────────
    function buildDOM(cb, opts) {
        opts = opts || {};
        var todayStr = todayISO();
        var th       = totalH();
        var slots    = (S.endHour - S.startHour) * 60 / S.interval;

        var wrap = document.createElement('div');
        wrap.className = 'gcal-wrap';

        // ── Sticky header ─────────────────────────────────────
        var head = document.createElement('div');
        head.className = 'gcal-head';

        var gh = document.createElement('div');
        gh.className = 'gcal-gutter-hdr';
        gh.innerHTML =
            '<div style="display:flex;flex-direction:column;gap:3px;align-items:center;padding:4px;">' +
                '<button class="gcal-settings-btn" title="' + esc(tr('appt.cal.settingsBtnTitle')) + '" onclick="GCAL.toggleSettings()">⚙</button>' +
                '<button class="gcal-settings-btn" title="' + esc(tr('appt.cal.miniCalBtnTitle')) + '" onclick="GCAL.toggleMiniCal()">📅</button>' +
            '</div>';
        head.appendChild(gh);

        days.forEach(function (d) {
            var iso  = d2iso(d);
            var isTo = iso === todayStr;
            var dh   = document.createElement('div');
            dh.className   = 'gcal-day-hdr' + (isTo ? ' gcal-today' : '');
            dh.dataset.date = iso;
            dh.innerHTML   =
                d.toLocaleDateString(apptDateLocale(), {weekday:'short'}) +
                '<span class="gcal-day-num">' + d.getDate() + '</span>';
            head.appendChild(dh);
        });
        wrap.appendChild(head);

        // ── Settings panel + Mini calendar (absolute inside wrap)
        wrap.appendChild(buildSettingsPanel());
        wrap.appendChild(buildMiniCalPanel());

        // ── Scrollable body ───────────────────────────────────
        var body = document.createElement('div');
        body.className = 'gcal-body';
        body.id        = 'gcalScrollBody';

        // Time column
        var tc = document.createElement('div');
        tc.className   = 'gcal-time-col';
        tc.style.height = th + 'px';
        for (var s = 0; s <= slots; s++) {
            var mOff = s * S.interval;
            var hh   = S.startHour + Math.floor(mOff / 60);
            var mm   = mOff % 60;
            var isHr = mm === 0;
            if (isHr || S.interval <= 20) {
                var lbl = document.createElement('div');
                lbl.className    = 'gcal-time-label' + (isHr ? ' hour' : '');
                lbl.style.top    = (s * gcalEffectiveSlotH()) + 'px';
                lbl.textContent  = isHr
                    ? ((hh === 24) ? '00:00' : (pad(hh) + ':00'))
                    : (pad(hh) + ':' + pad(mm));
                tc.appendChild(lbl);
            }
        }
        body.appendChild(tc);

        // Day columns
        days.forEach(function (day) {
            var iso  = d2iso(day);
            var isTo = iso === todayStr;
            var col  = document.createElement('div');
            col.className   = 'gcal-day-col' + (isTo ? ' gcal-today-col' : '');
            col.dataset.date = iso;
            col.style.height = th + 'px';

            // Drop ghost
            var ghost = document.createElement('div');
            ghost.className = 'gcal-drop-ghost';
            ghost.id        = 'gcalGhost-' + iso;
            col.appendChild(ghost);

            // Slot grid lines
            for (var s2 = 0; s2 < slots; s2++) {
                var line = document.createElement('div');
                line.className = 'gcal-slot' + ((s2 * S.interval % 60 === 0) ? ' hour-line' : '');
                line.style.top = (s2 * gcalEffectiveSlotH()) + 'px';
                col.appendChild(line);
            }

            // Appointment cards (side-by-side when overlapping — Google Calendar style)
            var dayAppts = appts.filter(function (a) {
                return a.date === iso && !apptTransferIsCutPending(a.id);
            });
            if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts) {
                dayAppts = CalDoctorColors.filterAppts(dayAppts);
            }
            var laid = layoutDayColumns(dayAppts);
            laid.forEach(function (item) {
                var card = buildCard(item.appt, item.col, item.totalCols);
                if (card) col.appendChild(card);
            });

            // Click on empty slot → open add-appointment
            col.addEventListener('click', function (e) {
                if (e.target !== col && !e.target.classList.contains('gcal-slot')) return;
                var relY      = e.clientY - col.getBoundingClientRect().top;
                var slotIdx   = Math.max(0, Math.round(relY / gcalEffectiveSlotH()));
                var totalMin  = S.startHour * 60 + slotIdx * S.interval;
                totalMin = Math.min(totalMin, (S.endHour - 1) * 60);
                openApptWithDatetime(iso, minToTimeStr(totalMin));
            });
            function showPatientDropGhost(clientY) {
                var relY = clientY - col.getBoundingClientRect().top;
                var slotIdx = Math.max(0, Math.round(relY / gcalEffectiveSlotH()));
                var maxSlot = Math.floor((totalH() - gcalEffectiveSlotH()) / gcalEffectiveSlotH());
                slotIdx = Math.max(0, Math.min(slotIdx, maxSlot));
                var top = slotIdx * gcalEffectiveSlotH();
                ghost.style.top = top + 'px';
                ghost.style.height = gcalEffectiveSlotH() + 'px';
                ghost.style.display = 'block';
                return {
                    slotIdx: slotIdx,
                    totalMin: Math.min(S.startHour * 60 + slotIdx * S.interval, (S.endHour - 1) * 60)
                };
            }
            function hidePatientDropGhost() {
                ghost.style.display = 'none';
            }
            function completePendingTransferAtSlot(slotIso, slotTime) {
                if (!apptTransferCutIsActive()) return false;
                var snap = plusApptTransferLogSnapshot();
                if (!snap || !snap.apptId) return false;
                var dur = parseInt(snap.duration || '0', 10);
                if (!dur || dur < 1) dur = PLUSAPPT_SLOT_MIN;
                var endTime = minToTimeStr(timeToMin(slotTime) + dur);
                document.querySelectorAll('.gcal-card[data-id="' + String(snap.apptId) + '"]').forEach(function(card) {
                    card.classList.add('appt-row-transfer-cut-pending');
                    card.setAttribute('hidden', 'hidden');
                    card.style.display = 'none';
                });
                plusApptFinishTransferCutPaste(snap, {
                    date: slotIso,
                    start_time: slotTime,
                    end_time: endTime,
                    duration: dur
                });
                return true;
            }
            col.addEventListener('dragover', function(ev) {
                if (typeof isActivePatientCardDragActive === 'function' && !isActivePatientCardDragActive()) {
                    hidePatientDropGhost();
                    return;
                }
                ev.preventDefault();
                ev.dataTransfer.dropEffect = apptTransferCutIsActive() ? 'move' : 'copy';
                showPatientDropGhost(ev.clientY);
            });
            col.addEventListener('dragleave', function(ev) {
                var rect = col.getBoundingClientRect();
                var x = ev.clientX;
                var y = ev.clientY;
                var inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
                if (!inside) hidePatientDropGhost();
            });
            col.addEventListener('drop', function(ev) {
                if (typeof isActivePatientCardDragActive === 'function' && !isActivePatientCardDragActive()) {
                    return;
                }
                var p = (typeof readPatientDragPayloadFromEvent === 'function')
                    ? readPatientDragPayloadFromEvent(ev)
                    : null;
                hidePatientDropGhost();
                ev.preventDefault();
                var relY = ev.clientY - col.getBoundingClientRect().top;
                var slotIdx = Math.max(0, Math.round(relY / gcalEffectiveSlotH()));
                var maxSlot = Math.floor((totalH() - gcalEffectiveSlotH()) / gcalEffectiveSlotH());
                slotIdx = Math.max(0, Math.min(slotIdx, maxSlot));
                var totalMin = Math.min(S.startHour * 60 + slotIdx * S.interval, (S.endHour - 1) * 60);
                var slotTime = minToTimeStr(totalMin);
                if (completePendingTransferAtSlot(iso, slotTime)) {
                    hidePatientDropGhost();
                    return;
                }
                if (!p) return;
                openApptModalWithPatient(iso, slotTime, p);
                hidePatientDropGhost();
            });

            body.appendChild(col);
        });

        // Now-line
        renderNowLine(body);
        wrap.appendChild(body);

        cb.innerHTML = '';
        cb.appendChild(wrap);

        // Refresh now-line every minute
        if (nowTimer) clearInterval(nowTimer);
        nowTimer = setInterval(function () { renderNowLine(body); }, 60000);

        // Scroll to 1 hour past startHour (skip when refreshing with settings panel open)
        requestAnimationFrame(function () {
            if (opts.preserveScroll && opts.scrollTop != null) {
                body.scrollTop = opts.scrollTop;
                return;
            }
            body.scrollTop = Math.max(0, (1 * 60 / S.interval) * gcalEffectiveSlotH() - 10);
        });
    }

    // ── Build one appointment card ────────────────────────────────
    function buildCard(a, colIdx, totalCols) {
        colIdx = colIdx || 0;
        totalCols = totalCols || 1;
        var startMin = timeToMin(a.start_time);
        var endMin   = timeToMin(a.end_time);
        var endDay   = S.endHour * 60;
        if (startMin >= endDay) return null;
        endMin = Math.min(endDay, endMin > startMin ? endMin : startMin + 30);

        var top    = topFromTime(a.start_time);
        var dur    = endMin - startMin;
        var height = Math.max(gcalEffectiveSlotH(), dur / S.interval * gcalEffectiveSlotH());

        var sty    = getCardStyle(a);
        var color  = sty.borderColor;

        var card = document.createElement('div');
        card.className         = 'gcal-card';
        card.dataset.id        = a.id;
        card.style.top         = top + 'px';
        card.style.height      = height + 'px';
        card.style.color       = '#1e293b';
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.paintElement) {
            CalDoctorColors.paintElement(card, a);
        } else {
            card.style.borderLeft  = '4px solid ' + sty.borderColor;
            card.style.background  = sty.background;
        }
        var pct = 100 / totalCols;
        card.style.left = 'calc(' + (colIdx * pct) + '% + 2px)';
        card.style.width = 'calc(' + pct + '% - 4px)';
        card.style.right = 'auto';

        var dr           = a.doctor_code || a.doctor_name || '';
        var isWalkIn     = !a.patient_id;
        var chineseName  = a.patient_chinese_name || '';
        var engName      = a.patient_name || (isWalkIn ? tr('appt.cal.cardWalkin') : '—');
        var treatment    = String(a.treatment_items || '').trim();
        var remarksTxt   = a.remarks
            ? formatRemarksForDisplay(a.remarks, { stripDr: true })
            : '';
        var locked       = isApptScheduleLocked(a);

        var lockTitle = locked ? tr('appt.cal.lockUnlockTitle') : tr('appt.cal.lockPinTitle');
        var lockAria = locked ? tr('appt.cal.lockAriaUnlock') : tr('appt.cal.lockAriaLock');
        var html =
            '<button type="button" class="gcal-card-lock' + (locked ? ' locked' : '') + '" ' +
                'title="' + esc(lockTitle) + '" ' +
                'aria-label="' + esc(lockAria) + '">' +
                (locked ? '🔒' : '🔓') +
            '</button>' +
            '<span class="card-line card-line--1 card-headline">' +
                (isWalkIn ? '<span class="card-new-badge">' + esc(tr('appt.badge.newWalkin')) + '</span>' : '') +
                '<span class="card-chinese">' + esc(chineseName || engName) + '</span>' +
                (treatment
                    ? '<span class="card-treatment">' + esc(treatment) + '</span>'
                    : '') +
            '</span>' +
            '<span class="card-line card-line--2">' +
                (chineseName && a.patient_name
                    ? '<span class="card-name">' + esc(a.patient_name) + '</span>'
                    : '') +
                (a.patient_no
                    ? '<span class="card-pno">#' + esc(a.patient_no) + '</span>'
                    : '') +
            '</span>';
        if (remarksTxt) {
            html += '<span class="card-line card-line--3 card-remarks">' + esc(remarksTxt) + '</span>';
        }
        html += '<span class="card-time">' + esc(fmt12(a.start_time) + ' - ' + fmt12(a.end_time)) + '</span>';
        html += apptUnpaidBadgeHtml(a, 'appt-unpaid-badge--cal');
        if (dr && height >= gcalEffectiveSlotH() * 3) {
            html += '<span class="card-dr" style="color:' + color + ';">● ' + esc(dr) + '</span>';
        }
        card.innerHTML = html;
        if (locked) card.classList.add('gcal-card-locked');

        var lockBtn = card.querySelector('.gcal-card-lock');
        if (lockBtn) {
            lockBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                e.preventDefault();
                var next = !isApptScheduleLocked(a);
                persistApptScheduleLock(a, next);
            });
        }

        card.addEventListener('click', function (e) {
            if (Date.now() < suppressCardClickUntil) return;
            if (e.target.closest && e.target.closest('.gcal-card-lock')) return;
            if (e.target.closest && e.target.closest('.gcal-card-resize-handle')) return;
            e.stopPropagation();
            apptSnapActivePatientFromCalendarAppt(a, 'calendar-weekly-card-select');
            showApptPopup(a, card);
        });
        attachGcalPatientDrag(card, a);
        attachDrag(card, a);
        attachResize(card, a);
        return card;
    }

    function attachGcalPatientDrag(card, appt) {
        if (!card || !appt || !appt.patient_id) return;
        var head = card.querySelector('.card-line--1');
        if (!head) return;
        head.classList.add('gcal-patient-drag');
        head.setAttribute('draggable', 'true');
        head.title = typeof tr === 'function' ? tr('activePatient.dragFromApptTitle') : '';
        head.addEventListener('dragstart', function(e) {
            e.stopPropagation();
            if (typeof plusApptMarkRowDragTransfer === 'function') {
                plusApptMarkRowDragTransfer(e, appt);
            }
            if (typeof beginApptPatientDragTransfer === 'function') {
                beginApptPatientDragTransfer(e, appt);
            }
        });
        head.addEventListener('dragend', function() {
            plusApptDragApptId = null;
            plusApptSetMiniCalDragOver(false);
            if (typeof clearPatientDragPayloadSession === 'function') {
                clearPatientDragPayloadSession();
            }
        });
    }

    // ── Drag & Drop (supports cross-day) ────────────────────────
    function attachDrag(card, appt) {
        card.addEventListener('mousedown', function (e) {
            if (dragState) return;
            if (typeof window.PointerEvent !== 'undefined') return;
            if (e.button !== 0) return;
            if (e.target.closest && e.target.closest('.gcal-card-lock')) return;
            if (e.target.closest && e.target.closest('.gcal-card-resize-handle')) return;
            if (e.target.closest && e.target.closest('.gcal-patient-drag')) return;
            if (isApptScheduleLocked(appt)) return;
            e.preventDefault(); e.stopPropagation();

            var cr = card.getBoundingClientRect();

            // Floating proxy that follows the cursor freely
            var proxy = document.createElement('div');
            proxy.innerHTML = card.innerHTML;
            proxy.style.cssText =
                'position:fixed;z-index:9999;pointer-events:none;margin:0;' +
                'width:' + cr.width + 'px;height:' + cr.height + 'px;' +
                'left:' + cr.left + 'px;top:' + cr.top + 'px;' +
                'opacity:.9;cursor:grabbing;transition:none;' +
                'box-shadow:0 8px 24px rgba(0,0,0,.28);' +
                'border-left:3px solid ' + card.style.borderLeftColor + ';' +
                'background:' + card.style.background + ';' +
                'border-radius:6px;padding:4px 7px;font-size:11px;' +
                'line-height:1.4;overflow:hidden;box-sizing:border-box;color:#1e293b;';
            document.body.appendChild(proxy);

            card.style.opacity = '0.2';

            dragState = {
                appt:       appt,
                card:       card,
                proxy:      proxy,
                startX:     e.clientX,
                startY:     e.clientY,
                origLeft:   cr.left,
                origTop2:   cr.top,
                origTop:    parseInt(card.style.top, 10) || 0,
                origDate:   appt.date,
                origTime:   appt.start_time,
                origEnd:    appt.end_time,
                curDate:    appt.date,
                curTime:    appt.start_time,
                curSlotTop: parseInt(card.style.top, 10) || 0,
                cardH:      cr.height,
                ghostCol:   null
            };

            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup',   onDragEnd);
        });
        card.addEventListener('pointerdown', function (e) {
            if (dragState) return;
            if (e.button !== undefined && e.button !== 0) return;
            if (e.target.closest && e.target.closest('.gcal-card-lock')) return;
            if (e.target.closest && e.target.closest('.gcal-card-resize-handle')) return;
            if (e.target.closest && e.target.closest('.gcal-patient-drag')) return;
            if (isApptScheduleLocked(appt)) return;
            e.preventDefault(); e.stopPropagation();

            var cr = card.getBoundingClientRect();

            var proxy = document.createElement('div');
            proxy.innerHTML = card.innerHTML;
            proxy.style.cssText =
                'position:fixed;z-index:9999;pointer-events:none;margin:0;' +
                'width:' + cr.width + 'px;height:' + cr.height + 'px;' +
                'left:' + cr.left + 'px;top:' + cr.top + 'px;' +
                'opacity:.9;cursor:grabbing;transition:none;' +
                'box-shadow:0 8px 24px rgba(0,0,0,.28);' +
                'border-left:3px solid ' + card.style.borderLeftColor + ';' +
                'background:' + card.style.background + ';' +
                'border-radius:6px;padding:4px 7px;font-size:11px;' +
                'line-height:1.4;overflow:hidden;box-sizing:border-box;color:#1e293b;';
            document.body.appendChild(proxy);

            card.style.opacity = '0.2';

            dragState = {
                appt:       appt,
                card:       card,
                proxy:      proxy,
                startX:     e.clientX,
                startY:     e.clientY,
                origLeft:   cr.left,
                origTop2:   cr.top,
                origTop:    parseInt(card.style.top, 10) || 0,
                origDate:   appt.date,
                origTime:   appt.start_time,
                origEnd:    appt.end_time,
                curDate:    appt.date,
                curTime:    appt.start_time,
                curSlotTop: parseInt(card.style.top, 10) || 0,
                cardH:      cr.height,
                ghostCol:   null
            };

            if (card.setPointerCapture && e.pointerId != null) {
                try { card.setPointerCapture(e.pointerId); } catch (_) {}
            }
            document.addEventListener('pointermove', onDragMove);
            document.addEventListener('pointerup',   onDragEnd);
        });
    }

    function setCardTimeInfo(card, startT, endT) {
        if (!card) return;
        var timeEl = card.querySelector('.card-time');
        var text = fmt12(startT) + ' - ' + fmt12(endT);
        if (timeEl) timeEl.textContent = text;
    }

    function attachResize(card, appt) {
        function ensureHandle(cls, mode) {
            var h = card.querySelector('.' + cls);
            if (!h) {
                h = document.createElement('div');
                h.className = 'gcal-card-resize-handle ' + cls;
                h.title = tr('appt.cal.resizeHint');
                h.setAttribute('aria-label', tr('appt.cal.resizeHint'));
                h.dataset.mode = mode;
                card.appendChild(h);
            }
            return h;
        }
        var bottomHandle = ensureHandle('gcal-card-resize-bottom', 'bottom');
        var topHandle = ensureHandle('gcal-card-resize-top', 'top');

        function onResizeStart(e) {
            if (resizeState) return;
            if (e.type === 'mousedown' && typeof window.PointerEvent !== 'undefined') return;
            if (e.button !== undefined && e.button !== 0) return;
            if (isApptScheduleLocked(appt)) return;
            e.preventDefault();
            e.stopPropagation();
            suppressCardClickUntil = Date.now() + 450;
            var origH = parseInt(card.style.height, 10) || card.getBoundingClientRect().height || gcalEffectiveSlotH();
            var origTop = parseInt(card.style.top, 10) || 0;
            resizeState = {
                mode: (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.mode) || 'bottom',
                appt: appt,
                card: card,
                startY: e.clientY,
                origH: origH,
                origTop: origTop,
                origStart: appt.start_time,
                origEnd: appt.end_time,
                curStart: appt.start_time,
                curEnd: appt.end_time
            };
            card.classList.add('resizing');
            if (e.currentTarget && e.currentTarget.setPointerCapture && e.pointerId != null) {
                try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
            }
            document.addEventListener('mousemove', onResizeMove);
            document.addEventListener('mouseup', onResizeEnd);
            document.addEventListener('pointermove', onResizeMove);
            document.addEventListener('pointerup', onResizeEnd);
        }
        bottomHandle.addEventListener('mousedown', onResizeStart);
        topHandle.addEventListener('mousedown', onResizeStart);
        bottomHandle.addEventListener('pointerdown', onResizeStart);
        topHandle.addEventListener('pointerdown', onResizeStart);
    }

    function onResizeMove(e) {
        if (!resizeState) return;
        var rs = resizeState;
        var delta = e.clientY - rs.startY;
        var minH = gcalEffectiveSlotH();
        if (rs.mode === 'top') {
            var endTopPx = rs.origTop + rs.origH;
            var newTop = rs.origTop + delta;
            var maxTop = endTopPx - minH;
            newTop = Math.max(0, Math.min(maxTop, newTop));
            var slotIdxTop = Math.round(newTop / gcalEffectiveSlotH());
            var snappedTop = slotIdxTop * gcalEffectiveSlotH();
            if (snappedTop > maxTop) snappedTop = Math.floor(maxTop / gcalEffectiveSlotH()) * gcalEffectiveSlotH();
            snappedTop = Math.max(0, snappedTop);
            var snappedHFromTop = Math.max(minH, endTopPx - snappedTop);
            var startMin = S.startHour * 60 + slotIdxTop * S.interval;
            var endMinFixed = timeToMin(rs.origEnd);
            if (startMin >= endMinFixed) {
                startMin = Math.max(S.startHour * 60, endMinFixed - S.interval);
                snappedTop = Math.max(0, Math.round((startMin - S.startHour * 60) / S.interval) * gcalEffectiveSlotH());
                snappedHFromTop = Math.max(minH, endTopPx - snappedTop);
            }
            rs.curStart = minToTimeStr(startMin);
            rs.curEnd = rs.origEnd;
            rs.card.style.top = snappedTop + 'px';
            rs.card.style.height = snappedHFromTop + 'px';
            setCardTimeInfo(rs.card, rs.curStart, rs.curEnd);
            return;
        }

        var newH = rs.origH + delta;
        minH = gcalEffectiveSlotH();
        var maxH = Math.max(minH, totalH() - (parseInt(rs.card.style.top, 10) || 0));
        newH = Math.max(minH, Math.min(maxH, newH));
        var slotCount = Math.max(1, Math.round(newH / gcalEffectiveSlotH()));
        var snappedH = Math.max(minH, Math.min(maxH, slotCount * gcalEffectiveSlotH()));

        var startMin = timeToMin(rs.origStart);
        var maxEnd = S.endHour * 60;
        var endMin = Math.min(maxEnd, startMin + slotCount * S.interval);
        if (endMin <= startMin) endMin = Math.min(maxEnd, startMin + S.interval);
        rs.curStart = rs.origStart;
        rs.curEnd = minToTimeStr(endMin);

        rs.card.style.height = snappedH + 'px';
        setCardTimeInfo(rs.card, rs.curStart, rs.curEnd);
    }

    function onResizeEnd(e) {
        if (!resizeState) return;
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', onResizeEnd);
        document.removeEventListener('pointermove', onResizeMove);
        document.removeEventListener('pointerup', onResizeEnd);
        var rs = resizeState;
        resizeState = null;
        rs.card.classList.remove('resizing');

        if (isApptScheduleLocked(rs.appt)) {
            rs.card.style.top = rs.origTop + 'px';
            rs.card.style.height = rs.origH + 'px';
            setCardTimeInfo(rs.card, rs.origStart, rs.origEnd);
            return;
        }
        var startChanged = rs.curStart !== rs.origStart;
        var endChanged = rs.curEnd !== rs.origEnd;
        if (!startChanged && !endChanged) return;

        var prevStart = rs.origStart;
        var prevEnd = rs.origEnd;
        SB.from('appointments')
            .update({ start_time: rs.curStart, end_time: rs.curEnd })
            .eq('id', rs.appt.id)
            .then(function(r) {
                if (r.error) {
                    rs.card.style.top = rs.origTop + 'px';
                    rs.card.style.height = rs.origH + 'px';
                    setCardTimeInfo(rs.card, prevStart, prevEnd);
                    alert(trRepl('appt.cal.couldReschedule', { MSG: r.error.message }));
                    return;
                }
                rs.appt.start_time = rs.curStart;
                rs.appt.end_time = rs.curEnd;
                setCardTimeInfo(rs.card, rs.curStart, rs.curEnd);
            });
    }

    function _clearDragGhost(col) {
        if (!col) return;
        col.querySelectorAll('.gcal-drag-ghost').forEach(function (el) { el.remove(); });
    }
    function _showDragGhost(col, top, h) {
        _clearDragGhost(col);
        var gh = document.createElement('div');
        gh.className = 'gcal-drag-ghost';
        gh.style.cssText =
            'position:absolute;left:3px;right:3px;top:' + top + 'px;height:' + h + 'px;' +
            'border-radius:6px;border:2px dashed #0084ff;' +
            'background:rgba(0,132,255,.1);pointer-events:none;z-index:15;box-sizing:border-box;';
        col.appendChild(gh);
    }

    function _ensureDragTimeGuide() {
        var el = document.getElementById('gcalDragTimeGuide');
        if (!el) {
            el = document.createElement('div');
            el.id = 'gcalDragTimeGuide';
            el.className = 'gcal-drag-time-guide';
            el.setAttribute('aria-hidden', 'true');
            document.body.appendChild(el);
        }
        return el;
    }

    /** Faint dotted line from time gutter to day column at slot start (top edge). */
    function _updateDragTimeGuide(ds, ghostTop, targetCol) {
        var guide = _ensureDragTimeGuide();
        if (!ds || !targetCol) {
            guide.style.display = 'none';
            return;
        }
        var body = document.getElementById('gcalScrollBody');
        var timeCol = body ? body.querySelector('.gcal-time-col') : null;
        if (!timeCol) {
            guide.style.display = 'none';
            return;
        }
        var tcR = timeCol.getBoundingClientRect();
        var colR = targetCol.getBoundingClientRect();
        var y = colR.top + ghostTop;
        var left = tcR.left + 6;
        var width = Math.max(0, colR.left - left - 4);
        if (width < 8) {
            guide.style.display = 'none';
            return;
        }
        guide.style.display = 'block';
        guide.style.left = left + 'px';
        guide.style.top = y + 'px';
        guide.style.width = width + 'px';
    }

    function _clearDragTimeGuide() {
        var el = document.getElementById('gcalDragTimeGuide');
        if (el) el.style.display = 'none';
    }

    function calendarActivePatientDropTargetAt(clientX, clientY) {
        var under = document.elementFromPoint(clientX, clientY);
        if (!under || !under.closest) return null;
        var target = under.closest('.active-patient-card, #activePatientCollapsedTab');
        if (!target) return null;
        var slot = target.id === 'activePatientCard1' ? 1 : 0;
        return { el: target, slot: slot };
    }

    function calendarApplyActivePatientCutDrop(ds, ev) {
        if (!ds || !ds.appt || !ev || ev.clientX == null || ev.clientY == null) return false;
        var target = calendarActivePatientDropTargetAt(ev.clientX, ev.clientY);
        if (!target) return false;
        var appt = ds.appt;
        if (isApptScheduleLocked(appt) || typeof setActivePatientSlot !== 'function') return false;
        suppressCardClickUntil = Date.now() + 700;

        function hideCalendarSourceCard() {
            if (ds.card) {
                ds.card.classList.add('appt-row-transfer-cut-pending');
                ds.card.setAttribute('hidden', 'hidden');
                ds.card.style.display = 'none';
            }
            document.querySelectorAll('.gcal-card[data-id="' + String(appt.id) + '"]').forEach(function(card) {
                card.classList.add('appt-row-transfer-cut-pending');
                card.setAttribute('hidden', 'hidden');
                card.style.display = 'none';
            });
        }

        function applyPayload() {
            if (typeof patientDragPayloadFromAppt !== 'function') return false;
            var p = patientDragPayloadFromAppt(appt);
            if (!p || !p.id) return false;
            if (!apptTransferBeginPendingCut(appt)) return false;
            hideCalendarSourceCard();
            setActivePatientSlot(target.slot, p, 'calendar-card-transfer-cut', target.slot === 0);
            if (typeof isActivePatientDockCollapsed === 'function' && isActivePatientDockCollapsed()) {
                setActivePatientDockCollapsed(false, true);
            }
            return true;
        }

        if (applyPayload()) return true;
        if (appt.patient_no && typeof resolveQueueRowPatientId === 'function') {
            hideCalendarSourceCard();
            resolveQueueRowPatientId(appt, applyPayload);
            return true;
        }
        return false;
    }

    function onDragMove(e) {
        if (!dragState) return;
        var ds = dragState;

        // Move proxy
        ds.proxy.style.left = (ds.origLeft + e.clientX - ds.startX) + 'px';
        ds.proxy.style.top  = (ds.origTop2 + e.clientY - ds.startY) + 'px';

        // Detect which day column cursor is over
        ds.proxy.style.display = 'none';
        var under = document.elementFromPoint(e.clientX, e.clientY);
        ds.proxy.style.display = '';

        var targetCol = under;
        while (targetCol && !targetCol.classList.contains('gcal-day-col')) {
            targetCol = targetCol.parentElement;
        }
        if (!targetCol) {
            _clearDragGhost(ds.ghostCol);
            _clearDragTimeGuide();
            return;
        }

        // Vertical snap inside target column
        var colRect  = targetCol.getBoundingClientRect();
        var maxSlot  = Math.floor((totalH() - gcalEffectiveSlotH()) / gcalEffectiveSlotH());
        var slotIdx  = Math.max(0, Math.min(Math.round((e.clientY - colRect.top) / gcalEffectiveSlotH()), maxSlot));
        var ghostTop = slotIdx * gcalEffectiveSlotH();

        ds.curDate    = targetCol.dataset.date;
        ds.curTime    = minToTimeStr(S.startHour * 60 + slotIdx * S.interval);
        ds.curSlotTop = ghostTop;

        if (ds.ghostCol && ds.ghostCol !== targetCol) _clearDragGhost(ds.ghostCol);
        _showDragGhost(targetCol, ghostTop, ds.cardH);
        _updateDragTimeGuide(ds, ghostTop, targetCol);
        ds.ghostCol = targetCol;
    }

    function onDragEnd(e) {
        if (!dragState) return;
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup',   onDragEnd);
        document.removeEventListener('pointermove', onDragMove);
        document.removeEventListener('pointerup',   onDragEnd);

        var ds = dragState;
        dragState = null;

        _clearDragGhost(ds.ghostCol);
        _clearDragTimeGuide();
        if (ds.proxy && ds.proxy.parentNode) ds.proxy.parentNode.removeChild(ds.proxy);
        ds.card.style.opacity = '';

        if (isApptScheduleLocked(ds.appt)) return;
        if (calendarApplyActivePatientCutDrop(ds, e || window.event)) {
            suppressCardClickUntil = Date.now() + 700;
            return;
        }

        var dateChanged = ds.curDate && ds.curDate !== ds.origDate;
        var timeChanged = ds.curTime !== ds.origTime;
        if (!dateChanged && !timeChanged) return;

        var origS = timeToMin(ds.origTime);
        var origE = timeToMin(ds.origEnd);
        var dur   = origE > origS ? origE - origS : 30;
        var newS  = timeToMin(ds.curTime);
        var newE  = minToTimeStr(newS + dur);
        var update = { start_time: ds.curTime, end_time: newE };
        if (dateChanged) update.date = ds.curDate;

        // Optimistic DOM move
        var targetColEl = document.querySelector('.gcal-day-col[data-date="' + ds.curDate + '"]');
        var origColEl   = document.querySelector('.gcal-day-col[data-date="' + ds.origDate + '"]');
        if (targetColEl) { targetColEl.appendChild(ds.card); ds.card.style.top = ds.curSlotTop + 'px'; }

        SB.from('appointments').update(update).eq('id', ds.appt.id)
        .then(function (r) {
            if (r.error) {
                alert(trRepl('appt.cal.couldReschedule', { MSG: r.error.message }));
                if (origColEl) { origColEl.appendChild(ds.card); ds.card.style.top = ds.origTop + 'px'; }
            } else {
                ds.appt.date       = ds.curDate;
                ds.appt.start_time = ds.curTime;
                ds.appt.end_time   = newE;
                if (typeof syncApptPlannerDate === 'function') {
                    syncApptPlannerDate(ds.curDate, { syncCal: true });
                }
                if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
            }
        });
    }

    // ── Current-time indicator ───────────────────────────────────
    function renderNowLine(body) {
        body.querySelectorAll('.gcal-now-line').forEach(function (el) { el.remove(); });
        var now    = new Date();
        var nowMin = now.getHours() * 60 + now.getMinutes();
        if (nowMin < S.startHour * 60 || nowMin > S.endHour * 60) return;
        var col = body.querySelector('.gcal-day-col[data-date="' + todayISO() + '"]');
        if (!col) return;
        var line = document.createElement('div');
        line.className = 'gcal-now-line';
        line.style.top = ((nowMin - S.startHour * 60) / S.interval * gcalEffectiveSlotH()) + 'px';
        line.style.pointerEvents = 'none';
        line.style.zIndex = '1';
        line.setAttribute('aria-hidden', 'true');
        var firstCard = col.querySelector('.gcal-card');
        if (firstCard) col.insertBefore(line, firstCard);
        else col.appendChild(line);
    }

    function isInteractionActive() {
        if (dragState || resizeState) return true;
        var sp = document.getElementById('gcalSettingsPanel');
        if (sp && sp.classList.contains('open')) return true;
        var modal = document.getElementById('calDoctorColorsModal');
        if (modal && modal.classList.contains('open')) return true;
        return false;
    }

    // ── Settings panel ────────────────────────────────────────────
    function toggleSettings() {
        var p = document.getElementById('gcalSettingsPanel');
        if (p) p.classList.toggle('open');
        if (p && p.classList.contains('open') &&
            typeof CalDoctorColors !== 'undefined' && CalDoctorColors.wireColorPanel) {
            var box = document.getElementById('gcalDrColorsBox');
            if (box) {
                box._calColorPanelWired = false;
                CalDoctorColors.wireColorPanel(box);
            }
        }
    }

    function wireGcalDrColorPanel() {
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.wireColorPanel) {
            setTimeout(function () {
                var box = document.getElementById('gcalDrColorsBox');
                if (box) {
                    box._calColorPanelWired = false;
                    CalDoctorColors.wireColorPanel(box);
                }
            }, 0);
        }
    }

    function fillSettingsPanel(p) {
        if (!p) return;

        var mkOpts = function (arr, cur) {
            return arr.map(function (o) {
                return '<option value="'+o.v+'"'+(cur===o.v?' selected':'')+'>'+esc(o.l)+'</option>';
            }).join('');
        };

        var intOpts = mkOpts([10, 15, 20, 30, 60].map(function (v) {
            return { v: v, l: trRepl('appt.cal.intervalMin', { N: v }) };
        }), S.interval);
        var startOpts = '';
        var endOpts   = '';
        for (var h = 0; h < 24; h++) {
            var hStr = pad(h)+':00';
            startOpts += '<option value="'+h+'"'+(S.startHour===h?' selected':'')+'>'+hStr+'</option>';
        }
        endOpts = gcalEndHourOptionsHtml(S.endHour);
        var sHOpts = mkOpts([
            { v: 12, l: tr('appt.cal.slotExtraCompact') },
            { v: 14, l: tr('appt.cal.slotMoreCompact') },
            { v: 16, l: tr('appt.cal.slotCompact') },
            { v: 20, l: tr('appt.cal.slotNormal') },
            { v: 24, l: tr('appt.cal.slotComfortable') },
            { v: 32, l: tr('appt.cal.slotSpacious') }
        ], S.slotH);

        var drRows = '';
        var colorKeys = typeof CalDoctorColors !== 'undefined'
            ? CalDoctorColors.collectKeys(appts, typeof currentClinicId !== 'undefined' ? currentClinicId : null)
            : knownKeys.map(function (k) { return { key: k, label: k }; });
        colorKeys.forEach(function (item) {
            var k = item.key;
            var col = typeof CalDoctorColors !== 'undefined' ? CalDoctorColors.getColor(k) : getColorForKey(k);
            drRows +=
                '<div class="gcal-dr-row">' +
                '<input type="color" class="gcal-dr-color-inp" data-key="'+encodeURIComponent(k)+'" value="'+col+'" ' +
                'style="width:32px;height:32px;border:2px solid #e2e8f0;border-radius:6px;cursor:pointer;padding:0;flex-shrink:0;">' +
                '<span style="font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;">'+esc(item.label)+'</span>' +
                (typeof CalDoctorColors !== 'undefined' ? CalDoctorColors.presetSwatchesHtml(k, col) : '') +
                '</div>';
        });
        if (!colorKeys.length)
            drRows = '<p style="color:#aaa;font-size:11px;margin:0;">' + esc(tr('appt.cal.noDoctorsHint')) + '</p>';

        p.innerHTML =
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">' +
                '<strong style="font-size:13px;color:#1e293b;">' + esc(tr('appt.cal.settingsTitle')) + '</strong>' +
                '<button onclick="GCAL.toggleSettings()" style="background:none;border:none;cursor:pointer;font-size:18px;color:#94a3b8;line-height:1;padding:2px 6px;">×</button>' +
            '</div>' +
            '<label>' + esc(tr('appt.cal.timeInterval')) + '</label>' +
            '<select id="gcalInterval" style="margin-bottom:12px;">'+intOpts+'</select>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">' +
                '<div><label>' + esc(tr('appt.cal.startTimeLabel')) + '</label><select id="gcalStart">'+startOpts+'</select></div>' +
                '<div><label>' + esc(tr('appt.cal.endTimeLabel')) + '</label><select id="gcalEnd">'+endOpts+'</select></div>' +
            '</div>' +
            '<label>' + esc(tr('appt.cal.rowHeight')) + '</label>' +
            '<select id="gcalSlotH" style="margin-bottom:14px;">'+sHOpts+'</select>' +
            '<label style="margin-bottom:8px;">' + esc(tr('appt.cal.drColoursLabel')) + '</label>' +
            '<p style="font-size:11px;color:#64748b;margin:0 0 10px;line-height:1.4;">' + esc(tr('appt.cal.drColoursHint')) + '</p>' +
            '<div id="gcalDrColorsBox">' + drRows + '</div>' +
            (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.resetControlHtml
                ? CalDoctorColors.resetControlHtml() : '') +
            '<button onclick="GCAL.applySettings()" ' +
            'style="margin-top:14px;width:100%;padding:10px;background:#0084ff;color:#fff;' +
            'border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">' +
            esc(tr('appt.cal.applyRefresh')) + '</button>';
        wireGcalDrColorPanel();
    }

    function refreshSettingsPanelIfOpen() {
        var sp = document.getElementById('gcalSettingsPanel');
        if (!sp || !sp.classList.contains('open')) return;
        var st = captureGcalPanelState();
        fillSettingsPanel(sp);
        restoreGcalPanelState(st);
    }

    function buildSettingsPanel() {
        var p = document.createElement('div');
        p.id = 'gcalSettingsPanel';
        fillSettingsPanel(p);
        return p;
    }

    function refreshGcalGutterTitles() {
        var btns = document.querySelectorAll('.gcal-gutter-hdr .gcal-settings-btn');
        if (!btns.length) return;
        if (btns[0]) btns[0].title = tr('appt.cal.settingsBtnTitle');
        if (btns[1]) btns[1].title = tr('appt.cal.miniCalBtnTitle');
    }

    function captureGcalPanelState() {
        var sp = document.getElementById('gcalSettingsPanel');
        var mp = document.getElementById('gcalMiniCal');
        var st = {
            settingsOpen: !!(sp && sp.classList.contains('open')),
            miniOpen: !!(mp && mp.classList.contains('open'))
        };
        if (st.settingsOpen) {
            var iEl = document.getElementById('gcalInterval');
            var sEl = document.getElementById('gcalStart');
            var eEl = document.getElementById('gcalEnd');
            var hEl = document.getElementById('gcalSlotH');
            st.interval = iEl ? parseInt(iEl.value, 10) : S.interval;
            st.startHour = sEl ? parseInt(sEl.value, 10) : S.startHour;
            st.endHour = eEl ? parseInt(eEl.value, 10) : S.endHour;
            st.slotH = hEl ? parseInt(hEl.value, 10) : S.slotH;
            st.colors = {};
            document.querySelectorAll('#gcalDrColorsBox .gcal-dr-color-inp').forEach(function (inp) {
                var dk = inp.dataset.key;
                try { dk = decodeURIComponent(dk); } catch (e) {}
                st.colors[dk] = inp.value;
            });
        }
        return st;
    }

    function restoreGcalPanelState(st) {
        if (!st) return;
        var sp = document.getElementById('gcalSettingsPanel');
        var mp = document.getElementById('gcalMiniCal');
        if (st.settingsOpen && sp) {
            fillSettingsPanel(sp);
            var iEl = document.getElementById('gcalInterval');
            var sEl = document.getElementById('gcalStart');
            var eEl = document.getElementById('gcalEnd');
            var hEl = document.getElementById('gcalSlotH');
            if (iEl && st.interval != null) iEl.value = String(st.interval);
            if (sEl && st.startHour != null) sEl.value = String(st.startHour);
            if (eEl && st.endHour != null) eEl.value = String(st.endHour);
            if (hEl && st.slotH != null) hEl.value = String(st.slotH);
            if (st.colors) {
                document.querySelectorAll('#gcalDrColorsBox .gcal-dr-color-inp').forEach(function (inp) {
                    var dk = inp.dataset.key;
                    try { dk = decodeURIComponent(dk); } catch (e) {}
                    if (st.colors[dk]) inp.value = st.colors[dk];
                });
            }
            sp.classList.add('open');
        }
        if (st.miniOpen && mp) {
            _renderMiniCalContent(mp);
            mp.classList.add('open');
        }
        refreshGcalGutterTitles();
    }

    function refreshGcalPanelsI18n() {
        var sp = document.getElementById('gcalSettingsPanel');
        var mp = document.getElementById('gcalMiniCal');
        if (!sp && !mp) return;
        var st = captureGcalPanelState();
        if (st.settingsOpen && sp) {
            fillSettingsPanel(sp);
            restoreGcalPanelState(st);
        } else if (st.miniOpen && mp) {
            _renderMiniCalContent(mp);
            mp.classList.add('open');
            refreshGcalGutterTitles();
        } else {
            refreshGcalGutterTitles();
        }
    }

    function getColorForKey(k) {
        return (S.doctorColors && S.doctorColors[k]) || colorHash(k);
    }

    function applySettings() {
        var iEl = document.getElementById('gcalInterval');
        var sEl = document.getElementById('gcalStart');
        var eEl = document.getElementById('gcalEnd');
        var hEl = document.getElementById('gcalSlotH');
        if (iEl) S.interval  = parseInt(iEl.value, 10);
        if (sEl) S.startHour = parseInt(sEl.value, 10);
        if (eEl) S.endHour   = parseInt(eEl.value, 10);
        if (hEl) S.slotH     = parseInt(hEl.value, 10);
        if (S.endHour <= S.startHour) { alert(tr('appt.cal.endAfterStart')); return; }
        if (typeof CalDoctorColors !== 'undefined' && typeof CalDoctorColors.exportColorsMap === 'function') {
            S.doctorColors = CalDoctorColors.exportColorsMap();
        } else {
            document.querySelectorAll('#gcalDrColorsBox .gcal-dr-color-inp').forEach(function (inp) {
                var dk = inp.dataset.key;
                try { dk = decodeURIComponent(dk); } catch (e) {}
                if (!S.doctorColors) S.doctorColors = {};
                S.doctorColors[dk] = inp.value;
            });
        }
        saveSettings();
        var sp = document.getElementById('gcalSettingsPanel');
        if (sp) sp.classList.remove('open');
        renderWeekly();
    }

    // ── Mini Calendar ─────────────────────────────────────────────
    var miniCalDate = new Date();   // month currently shown in mini cal

    function buildMiniCalPanel() {
        var p = document.createElement('div');
        p.id = 'gcalMiniCal';
        _renderMiniCalContent(p);
        return p;
    }

    function _renderMiniCalContent(p) {
        if (!p) p = document.getElementById('gcalMiniCal');
        if (!p) return;
        var y  = miniCalDate.getFullYear();
        var mo = miniCalDate.getMonth();

        // Recompute today and selected-week dates using local arithmetic
        var nowLocal   = new Date();
        var todayLocal = d2iso(makeLocalDate(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate()));

        // Build selected-week set
        var calY = calDate.getFullYear(), calMo = calDate.getMonth(), calD = calDate.getDate();
        var weekSet = {};
        var calDow  = calDate.getDay();
        for (var wi = 0; wi < 7; wi++) {
            weekSet[d2iso(makeLocalDate(calY, calMo, calD - calDow + wi))] = true;
        }

        var monthLabel  = new Date(y, mo, 1).toLocaleDateString(apptDateLocale(), {month:'long', year:'numeric'});
        var firstDow    = new Date(y, mo, 1).getDay();
        var daysInMonth = new Date(y, mo + 1, 0).getDate();

        var btnS = 'background:none;border:none;cursor:pointer;font-size:16px;' +
                   'color:#64748b;width:24px;height:24px;border-radius:4px;line-height:1;padding:0;';

        var html =
            '<div style="display:flex;align-items:center;justify-content:space-between;' +
            'margin-bottom:8px;padding-bottom:7px;border-bottom:1px solid #f1f5f9;">' +
                '<button onclick="GCAL.miniCalPrev()" style="' + btnS + '">‹</button>' +
                '<span style="font-size:12px;font-weight:700;color:#1e293b;">' + monthLabel + '</span>' +
                '<button onclick="GCAL.miniCalNext()" style="' + btnS + '">›</button>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;text-align:center;">';

        apptCalWeekdayHeaders().forEach(function (lbl) {
            html += '<div style="font-size:9px;font-weight:700;color:#94a3b8;padding:2px 0;">' + esc(lbl.charAt(0)) + '</div>';
        });

        for (var b = 0; b < firstDow; b++) html += '<div></div>';

        for (var day = 1; day <= daysInMonth; day++) {
            var iso     = y + '-' + pad(mo + 1) + '-' + pad(day);
            var isToday = iso === todayLocal;
            var inWeek  = !!weekSet[iso];
            var cs = 'cursor:pointer;padding:3px 1px;font-size:11px;border-radius:4px;';
            if      (isToday) cs += 'background:#0084ff;color:#fff;font-weight:700;';
            else if (inWeek)  cs += 'background:#dbeafe;color:#1d4ed8;font-weight:600;';
            else              cs += 'color:#374151;';
            html += '<div onclick="GCAL.pickMiniCalDate(\'' + iso + '\')" style="' + cs + '">' + day + '</div>';
        }

        html += '</div>';

        html += '<button onclick="GCAL.goToday()" ' +
            'style="margin-top:10px;width:100%;padding:5px;background:#f0f7ff;color:#0084ff;' +
            'border:1px solid #bfdbfe;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">' +
            esc(tr('appt.cal.jumpToday')) + '</button>';

        p.innerHTML = html;
        p.classList.remove('gcal-mini-cal--transfer-armed', 'gcal-mini-cal--transfer-over');
        bindCalMonthMiniTransferDrop();
    }

    function toggleMiniCal() {
        var p = document.getElementById('gcalMiniCal');
        if (!p) return;
        // Close settings panel if open
        var sp = document.getElementById('gcalSettingsPanel');
        if (sp) sp.classList.remove('open');
        var opening = !p.classList.contains('open');
        if (opening) {
            // Sync to current calDate's month
            miniCalDate = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
            _renderMiniCalContent(p);
            p.classList.add('open');
        } else {
            p.classList.remove('open');
        }
    }

    function miniCalPrev() {
        miniCalDate = new Date(miniCalDate.getFullYear(), miniCalDate.getMonth() - 1, 1);
        _renderMiniCalContent(null);
    }
    function miniCalNext() {
        miniCalDate = new Date(miniCalDate.getFullYear(), miniCalDate.getMonth() + 1, 1);
        _renderMiniCalContent(null);
    }

    function jumpToDate(isoStr) {
        calDate = parseISO(isoStr);          // local-safe parse
        if (typeof syncApptPlannerDate === 'function') {
            syncApptPlannerDate(isoStr, { syncCal: false });
        }
        var p = document.getElementById('gcalMiniCal');
        if (p) p.classList.remove('open');
        renderCal();
    }

    function pickMiniCalDate(isoStr) {
        if (calView === 'monthly' && calMonthBulkTransferState && calMonthBulkTransferState.fromDate) {
            var bulk = calMonthBulkTransferState;
            var targetIsoBulk = String(isoStr || '').trim();
            var fromIsoBulk = String(bulk.fromDate || '').trim();
            if (!targetIsoBulk || !fromIsoBulk || targetIsoBulk === fromIsoBulk) return;
            var fromLabelBulk = (typeof fmtDateLong === 'function') ? fmtDateLong(fromIsoBulk) : fromIsoBulk;
            var toLabelBulk = (typeof fmtDateLong === 'function') ? fmtDateLong(targetIsoBulk) : targetIsoBulk;
            var cntBulk = Math.max(0, parseInt(bulk.count || '0', 10) || 0);
            var ask = trRepl('appt.plusAppt.transferBulkConfirm', {
                N: cntBulk,
                FROM: fromLabelBulk,
                TO: toLabelBulk
            });
            if (!confirm(ask)) return;
            var q = SB.from('appointments').select('id,date').eq('date', fromIsoBulk);
            q = applyApptModuleClinicQuery(q);
            q.then(function(rr) {
                if (rr.error) {
                    alert(trRepl('appt.msg.error', { MSG: rr.error.message }));
                    return;
                }
                var rows = rr.data || [];
                if (!rows.length) {
                    calMonthBulkTransferState = null;
                    renderCalMonthMini();
                    return;
                }
                var pending = rows.length;
                var moved = 0;
                var firstErr = null;
                rows.forEach(function(row) {
                    SB.from('appointments')
                        .update({ date: targetIsoBulk })
                        .eq('id', row.id)
                    .then(function(ur) {
                        if (ur.error && !firstErr) firstErr = ur.error.message || 'Unknown error';
                        if (!ur.error) moved++;
                        pending--;
                        if (pending > 0) return;
                        if (firstErr) {
                            alert(trRepl('appt.msg.error', { MSG: firstErr }));
                            return;
                        }
                        calMonthBulkTransferState = null;
                        calMonthBulkTransferDragDate = '';
                        calDate = parseISO(targetIsoBulk);
                        calMonthMiniDate = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
                        if (typeof syncApptPlannerDate === 'function') {
                            syncApptPlannerDate(targetIsoBulk, { syncCal: false });
                        }
                        apptToast('Moved ' + moved + ' appointments to ' +
                            (typeof fmtDateLong === 'function' ? fmtDateLong(targetIsoBulk) : targetIsoBulk));
                        if (typeof refreshApptPlannerData === 'function') refreshApptPlannerData();
                        if (typeof loadToday === 'function') loadToday();
                        if (typeof loadQueue === 'function') loadQueue();
                        if (typeof loadApptRecords === 'function') loadApptRecords();
                        renderCal();
                    });
                });
            });
            return;
        }
        if (calView === 'monthly' && calMonthTransferState && calMonthTransferState.apptId) {
            var snapCal = calMonthTransferState;
            var targetIso = String(isoStr || '').trim();
            if (!targetIso) return;
            var stCal = plusApptNormTime(snapCal.startTime || '09:00');
            var durCal = parseInt(snapCal.duration || '0', 10);
            if (!durCal || durCal < 1) durCal = PLUSAPPT_SLOT_MIN;
            var enCal = addMins(stCal, durCal);
            plusApptExecuteTransferCutPaste(snapCal, {
                date: targetIso,
                start_time: stCal,
                end_time: enCal,
                duration: durCal
            }, function(err, result) {
                if (err) {
                    alert(trRepl('appt.cal.couldReschedule', { MSG: err }));
                    apptTransferRestorePendingCut();
                    return;
                }
                var oldCalId = result && result.oldId;
                plusApptTransferHistoryRecord(snapCal, {
                    date: targetIso,
                    start_time: stCal,
                    end_time: enCal,
                    duration: durCal
                });
                plusApptClearTransferAfterSuccess(null, oldCalId);
                plusApptRenderTransferLog();
                calDate = parseISO(targetIso);
                miniCalDate = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
                if (typeof syncApptPlannerDate === 'function') {
                    syncApptPlannerDate(targetIso, { syncCal: false });
                }
                apptToast(trRepl('appt.plusAppt.transferDoneToast', {
                    NAME: (snapCal.patientChineseName || snapCal.patientName || ('#' + String(snapCal.apptId || ''))),
                    DATE: (typeof fmtDateLong === 'function' ? fmtDateLong(targetIso) : targetIso),
                    TIME: fmt12(stCal)
                }));
                apptRefreshListsAfterTransfer(oldCalId);
                renderCal();
            });
            return;
        }
        jumpToDate(isoStr);
    }

    function goToday() {
        var n = new Date();
        calDate = makeLocalDate(n.getFullYear(), n.getMonth(), n.getDate());
        miniCalDate = new Date(calDate.getFullYear(), calDate.getMonth(), 1);
        if (typeof syncApptPlannerDate === 'function') {
            syncApptPlannerDate(todayISO(), { syncCal: false });
        }
        var p = document.getElementById('gcalMiniCal');
        if (p) p.classList.remove('open');
        renderCal();
    }

    // Public API
    function openDoctorColors(focusKey) {
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.openColorModal) {
            CalDoctorColors.openColorModal(focusKey);
            return;
        }
        var p = document.getElementById('gcalSettingsPanel');
        if (!p) return;
        p.classList.add('open');
        if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.wireColorPanel) {
            var box = document.getElementById('gcalDrColorsBox');
            if (box) {
                box._calColorPanelWired = false;
                CalDoctorColors.wireColorPanel(box);
            }
        }
        if (focusKey && p) {
            var inps = p.querySelectorAll('.gcal-dr-color-inp');
            for (var i = 0; i < inps.length; i++) {
                if (inps[i].dataset.key === focusKey) {
                    inps[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                    break;
                }
            }
        }
    }

    return {
        render:                 render,
        repaintCards:           repaintCards,
        toggleSettings:         toggleSettings,
        openDoctorColors:       openDoctorColors,
        applySettings:          applySettings,
        reloadSettingsFromStorage: loadSettings,
        toggleMiniCal:          toggleMiniCal,
        miniCalPrev:            miniCalPrev,
        miniCalNext:            miniCalNext,
        pickMiniCalDate:        pickMiniCalDate,
        jumpToDate:             jumpToDate,
        goToday:                goToday,
        isInteractionActive:    isInteractionActive,
        captureGcalPanelState:  captureGcalPanelState,
        restoreGcalPanelState:  restoreGcalPanelState,
        refreshGcalPanelsI18n:  refreshGcalPanelsI18n,
        refreshSettingsPanelIfOpen: refreshSettingsPanelIfOpen,
        refreshMiniCalPanel:    function () { _renderMiniCalContent(null); }
    };
}());

// ── Weekly ────────────────────────────────────────────────────
function renderWeekly(opts) {
    GCAL.render(opts);
}

// ── Open appointment modal pre-filled with date + time ─────────
function openApptWithDatetime(iso, time) {
    openApptModalWithPatient(iso, time, null);
}

function bindMonthlyCalActivePatientDrop(cb) {
    if (!cb) return;
    cb.querySelectorAll('.cal-cell[data-date]').forEach(function(cell) {
        cell.addEventListener('dragover', function(ev) {
            if (calView !== 'monthly') return;
            if (calMonthTransferDragApptId || calMonthBulkTransferDragDate) return;
            if (typeof isActivePatientCardDragActive !== 'function' || !isActivePatientCardDragActive()) {
                return;
            }
            ev.preventDefault();
            ev.dataTransfer.dropEffect = 'copy';
            cell.classList.add('cal-cell--patient-drop-over');
        });
        cell.addEventListener('dragleave', function(ev) {
            var rect = cell.getBoundingClientRect();
            var inside = ev.clientX >= rect.left && ev.clientX <= rect.right &&
                ev.clientY >= rect.top && ev.clientY <= rect.bottom;
            if (!inside) cell.classList.remove('cal-cell--patient-drop-over');
        });
        cell.addEventListener('drop', function(ev) {
            cell.classList.remove('cal-cell--patient-drop-over');
            if (calView !== 'monthly') return;
            if (calMonthTransferDragApptId || calMonthBulkTransferDragDate) return;
            if (typeof isActivePatientCardDragActive !== 'function' || !isActivePatientCardDragActive()) {
                return;
            }
            var p = (typeof readPatientDragPayloadFromEvent === 'function')
                ? readPatientDragPayloadFromEvent(ev)
                : null;
            if (!p || !p.id) return;
            ev.preventDefault();
            ev.stopPropagation();
            var iso = cell.getAttribute('data-date');
            if (!iso) return;
            if (typeof syncApptPlannerDate === 'function') {
                syncApptPlannerDate(iso, { syncCal: false });
            }
            openApptModalWithPatient(iso, '09:00', p);
        });
    });
}

// ── Day panel ─────────────────────────────────────────────────
var _dayPanelCtx = null;

function showDayPanel(iso, map) {
    var panel = g('dayPanel');
    var title = g('dayPanelTitle');
    var list  = g('dayPanelList');
    if (!panel) return;

    if (typeof syncApptPlannerDate === 'function') {
        syncApptPlannerDate(iso, { syncCal: false });
    }

    title.textContent = fmtDateLong(iso);
    var items = map[iso] || [];
    _dayPanelCtx = { iso: iso, items: items.slice() };
    if (typeof CalDoctorColors !== 'undefined' && CalDoctorColors.filterAppts) {
        items = CalDoctorColors.filterAppts(items);
    }

    if (!items.length) {
        list.innerHTML =
            '<p style="color:#aaa;font-size:13px;margin:0;">' +
            esc(tr('appt.cal.noApptsDay')) + '</p>';
    } else {
        list.innerHTML = '';
        items.forEach(function(a) {
            var div = document.createElement('div');
            div.className = 'day-panel-item';
            div.dataset.apptId = a.id;
            var dpiSty = typeof CalDoctorColors !== 'undefined' && CalDoctorColors.getStyleForAppt
                ? CalDoctorColors.getStyleForAppt(a)
                : null;
            if (dpiSty) {
                div.style.borderLeft = '4px solid ' + dpiSty.borderColor;
                div.style.background = dpiSty.background;
            }
            var drLbl = a.doctor_code || a.doctor_name || '';
            div.innerHTML =
                '<div class="dpi-time">' +
                    fmt12(a.start_time) + ' – ' + fmt12(a.end_time) +
                '</div>' +
                (drLbl ? '<div class="dpi-dr" style="color:' + (dpiSty ? dpiSty.color : '#64748b') + ';">● ' + esc(drLbl) + '</div>' : '') +
                '<div class="dpi-name">' +
                    esc(a.patient_name || '-') +
                '</div>' +
                apptUnpaidBadgeHtml(a, 'appt-unpaid-badge--daypanel') +
                '<div class="dpi-treat">' +
                    esc(a.treatment_items || '-') +
                '</div>' +
                '<span class="status-badge ' +
                    statusClass(a.bill_status) + '">' +
                    esc(dispStatusLabel(a.bill_status || 'Scheduled')) +
                '</span>';
            div.style.cursor = 'pointer';
            div.addEventListener('click', function() {
                showApptPopup(a, div);
            });
            list.appendChild(div);
        });
    }

    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    apptRefreshPatientCountBadge('calendar');
}

// ── Appointment popup ─────────────────────────────────────────
var _apptPopupCtx = null;

function refreshApptPopupI18n() {
    if (!_apptPopupCtx || !_apptPopupCtx.appt) return;
    var pop = g('apptPopup');
    if (!pop) return;
    if (typeof applyI18nInRoot === 'function') applyI18nInRoot(pop);
    var aid = _apptPopupCtx.appt.id;
    var anchor = document.querySelector('.gcal-card[data-id="' + aid + '"]') ||
        document.querySelector('.day-panel-item[data-appt-id="' + aid + '"]') ||
        document.querySelector('.appt-pill[data-id="' + aid + '"]') ||
        document.querySelector('.gcal-month-pill[data-id="' + aid + '"]');
    if (!anchor) anchor = _apptPopupCtx.anchor;
    if (anchor) showApptPopup(_apptPopupCtx.appt, anchor);
}

function showApptPopup(a, anchor) {
    var pop     = g('apptPopup');
    var content = g('apptPopupContent');
    if (!pop) return;
    _apptPopupCtx = { appt: a, anchor: anchor };

    var locked = isApptScheduleLocked(a);
    var lockBanner = locked
        ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;' +
          'padding:5px 8px;margin-bottom:8px;font-size:11px;color:#92400e;font-weight:600;">' +
          esc(tr('appt.cal.popupLocked')) + '</div>'
        : '';

    var walkInBanner = !a.patient_id
        ? '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;' +
          'padding:5px 8px;margin-bottom:8px;font-size:11px;color:#92400e;font-weight:600;">' +
          esc(tr('appt.cal.popupWalkin')) + '</div>'
        : '';

    var chineseRow = a.patient_chinese_name
        ? '<tr><td style="color:#888;padding:3px 8px 3px 0;white-space:nowrap;"></td>' +
          '<td style="font-family:\'PingFang HK\',\'Microsoft JhengHei\',sans-serif;' +
          'font-size:16px;font-weight:900;letter-spacing:0.5px;-webkit-font-smoothing:antialiased;">' +
          esc(a.patient_chinese_name) + '</td></tr>'
        : '';

    var popDobRaw = a.patient_id ? apptPatientDobLookup(a.patient_id) : '';
    var popDobRow = '';
    if (a.patient_id) {
        var popDobTxt = popDobRaw && typeof formatDobAge === 'function'
            ? formatDobAge(popDobRaw)
            : (popDobRaw || '');
        popDobRow =
            '<tr id="apptPopDobRow"' +
            (popDobTxt ? '' : ' style="display:none;"') + '>' +
            '<td style="color:#888;padding:3px 8px 3px 0;">' +
            esc(tr('appt.cal.popupDob')) + '</td>' +
            '<td id="apptPopDobVal">' + esc(popDobTxt || '—') + '</td></tr>';
    }

    content.innerHTML =
        lockBanner +
        walkInBanner +
        '<table style="font-size:13px;width:100%;' +
        'border-collapse:collapse;">' +
            chineseRow +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;' +
            'white-space:nowrap;">' + esc(tr('appt.cal.popupPatient')) + '</td>' +
            '<td><strong>' + esc(a.patient_name || '-') +
            '</strong></td></tr>' +
            (!a.patient_id ? '' :
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">' + esc(tr('appt.cal.popupNo')) + '</td>' +
            '<td>' + esc(a.patient_no || '-') + '</td></tr>') +
            popDobRow +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">' + esc(tr('appt.cal.popupDate')) + '</td>' +
            '<td>' + fmtDateLong(a.date) + '</td></tr>' +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">' + esc(tr('appt.cal.popupTime')) + '</td>' +
            '<td>' + fmt12(a.start_time) +
            ' – ' + fmt12(a.end_time) + '</td></tr>' +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">' +
            esc(tr('appt.cal.popupTreatment')) + '</td>' +
            '<td>' + esc(a.treatment_items || '-') + '</td></tr>' +
            '<tr><td style="color:#888;padding:3px 8px 3px 0;">' + esc(tr('appt.cal.popupStatus')) + '</td>' +
            '<td><span class="status-badge ' +
                statusClass(a.bill_status) + '">' +
                esc(dispStatusLabel(a.bill_status || 'Scheduled')) +
            '</span></td></tr>' +
            (a.remarks
                ? '<tr><td style="color:#888;padding:3px 8px 3px 0;">' +
                  esc(tr('appt.cal.popupRemarks')) + '</td><td>' + formatRemarksForDisplay(a.remarks, { stripDr: true }) +
                  '</td></tr>'
                : '') +
        '</table>' +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">' +
            '<button id="popEditBtn" ' +
            'style="flex:1;min-width:72px;padding:7px;background:var(--primary);' +
            'color:white;border:none;border-radius:5px;' +
            'cursor:pointer;font-weight:600;">' + esc(tr('appt.cal.popupEdit')) + '</button>' +
            (calView === 'weekly'
                ? '<button id="popLockBtn" ' +
                  'style="flex:0 0 auto;padding:7px 10px;background:#fff;' +
                  'color:#92400e;border:1px solid #fde68a;border-radius:5px;' +
                  'cursor:pointer;font-weight:600;">' +
                  esc(locked ? tr('appt.cal.popupUnlock') : tr('appt.cal.popupLock')) +
                  '</button>'
                : '') +
            (a.bill_status !== 'Queue' && a.bill_status !== 'Done'
                ? '<button id="popCheckinBtn" ' +
                  'style="flex:1;min-width:72px;padding:7px;background:var(--success);' +
                  'color:white;border:none;border-radius:5px;' +
                  'cursor:pointer;font-weight:600;">' + esc(tr('appt.cal.popupCheckIn')) + '</button>'
                : '') +
        '</div>';

    if (a.patient_id && !popDobRaw && typeof SB !== 'undefined') {
        var popApptId = a.id;
        var popPatientId = a.patient_id;
        SB.from('patients').select('dob').eq('id', popPatientId).maybeSingle()
            .then(function (r) {
                if (!_apptPopupCtx || !_apptPopupCtx.appt ||
                    _apptPopupCtx.appt.id !== popApptId) return;
                if (r.error || !r.data || !r.data.dob) return;
                var row = g('apptPopDobRow');
                var val = g('apptPopDobVal');
                if (!row || !val) return;
                val.textContent = typeof formatDobAge === 'function'
                    ? formatDobAge(r.data.dob)
                    : r.data.dob;
                row.style.display = '';
            });
    }

    var rect    = anchor.getBoundingClientRect();
    var PW      = 310;
    // Prefer right side; fall back to left if not enough room
    var left = rect.right + 8;
    if (left + PW > window.innerWidth - 8) left = rect.left - PW - 8;
    left = Math.max(8, Math.min(left, window.innerWidth - PW - 8));

    // Measure popup to clamp vertically after showing
    pop.style.left    = left + 'px';
    pop.style.top     = '-9999px';
    pop.style.display = 'block';
    var popH = pop.offsetHeight || 360;
    var top  = rect.top;
    if (top + popH > window.innerHeight - 8) top = window.innerHeight - popH - 8;
    top = Math.max(8, top);
    pop.style.top = top + 'px';

    g('popEditBtn').addEventListener('click', function() {
        pop.style.display = 'none';
        openApptEditModal(a);
    });

    var pci = g('popCheckinBtn');
    if (pci) {
        pci.addEventListener('click', function() {
            pop.style.display = 'none';
            checkInPatient(a);
        });
    }

    var plb = g('popLockBtn');
    if (plb) {
        plb.addEventListener('click', function() {
            var next = !isApptScheduleLocked(a);
            persistApptScheduleLock(a, next, function (ok) {
                if (!ok) return;
                showApptPopup(a, anchor);
            });
        });
    }
}

// ════════════════════════════════════════════════════════════════
// BILL PANEL
// ════════════════════════════════════════════════════════════════
function wireBillPanelControls() {
    function bindClickOnce(id, fn) {
        var el = g(id);
        if (!el || el.dataset.billClickBound === '1' || typeof fn !== 'function') return;
        el.dataset.billClickBound = '1';
        el.addEventListener('click', fn);
    }

    bindClickOnce('billPanelClose', closeBillPanel);
    var billBackdrop = g('billPanelBackdrop');
    if (billBackdrop && billBackdrop.dataset.billClickBound !== '1') {
        billBackdrop.dataset.billClickBound = '1';
        billBackdrop.addEventListener('click', closeBillPanel);
    }
    if (!window._billPanelResizeBound) {
        window._billPanelResizeBound = true;
        window.addEventListener('resize', function () {
            if (typeof syncBillPanelBackdrop === 'function') syncBillPanelBackdrop();
        });
    }
    bindClickOnce('addBillItemBtn', addBillItem);
    bindClickOnce('createBillBtn', createBillFromCurrentList);
    bindClickOnce('closeReceiptModal', function() { closeModal('receiptModal'); });
    bindClickOnce('closeReceiptModal2', function() { closeModal('receiptModal'); });
    bindClickOnce('receiptPrintOptionsBtn', reopenReceiptPrintOptionsFromReceipt);
    bindClickOnce('receiptPrintNowBtn', function () { printReceiptDocument(); });
    bindClickOnce('closeReceiptPrintOptionsModal', function() {
        dismissReceiptPrintOptionsModal(true);
    });
    bindClickOnce('receiptPrintOptionsCancelBtn', function() {
        dismissReceiptPrintOptionsModal(true);
    });
    bindClickOnce('receiptPrintOptionsOkBtn', confirmReceiptPrintOptions);
    var rpoPrintDiagnosis = g('rpoPrintDiagnosis');
    if (rpoPrintDiagnosis && rpoPrintDiagnosis.dataset.billClickBound !== '1') {
        rpoPrintDiagnosis.dataset.billClickBound = '1';
        rpoPrintDiagnosis.addEventListener('change', syncReceiptPrintDiagnosisFieldsVisibility);
    }
    bindClickOnce('bdAddPaymentBtn', openAddPaymentModal);
    bindClickOnce('bdRefreshPaymentsBtn', refreshBillDetailPayments);
    bindClickOnce('billPendingRefreshBtn', refreshBillPanelNow);
    bindClickOnce('billPayAllBtn', billPayAllAmount);
    bindClickOnce('closeBillHistoryPrintModal', dismissBillHistoryPrintModal);
    bindClickOnce('billHistoryPrintCancelBtn', dismissBillHistoryPrintModal);
    bindClickOnce('billHistoryPrintOkBtn', confirmBillHistoryPrint);
    bindClickOnce('bhpSelectAllBtn', function() { setAllBillHistoryPrintChecks(true); });
    bindClickOnce('bhpSelectNoneBtn', function() { setAllBillHistoryPrintChecks(false); });
    wireBillHistoryPrintOptionInputs();
    wireBillHistoryFilterUi();

    var pendingDrSel = g('pendingListDoctor');
    if (pendingDrSel && pendingDrSel.dataset.billInputBound !== '1') {
        pendingDrSel.dataset.billInputBound = '1';
        pendingDrSel.addEventListener('change', function () {
            syncPendingListDoctorFromUi();
            updateBillStep2DoctorSummary();
        });
    }

    var discEl = g('bDiscount');
    if (discEl && discEl.dataset.billInputBound !== '1') {
        discEl.dataset.billInputBound = '1';
        discEl.addEventListener('input', recalcTotals);
    }
    var paidEl = g('bAmtPaid');
    if (paidEl && paidEl.dataset.billInputBound !== '1') {
        paidEl.dataset.billInputBound = '1';
        paidEl.addEventListener('input', recalcBalance);
    }
    var bTypeEl = g('bType');
    if (bTypeEl && bTypeEl.dataset.billInputBound !== '1') {
        bTypeEl.dataset.billInputBound = '1';
        bTypeEl.addEventListener('change', billSyncPaymentMethodHoldFromUi);
    }
}

function billPanelIsOpen() {
    var panel = g('billPanel');
    return !!(panel && panel.classList.contains('open'));
}

function billPanelUsesMobileLayout() {
    return window.matchMedia('(max-width: 900px)').matches;
}

function syncBillPanelBackdrop() {
    var panel = g('billPanel');
    var backdrop = g('billPanelBackdrop');
    var open = !!(panel && panel.classList.contains('open'));
    var mobile = billPanelUsesMobileLayout();

    if (backdrop) {
        backdrop.classList.toggle('visible', open && mobile);
        backdrop.setAttribute('aria-hidden', open && mobile ? 'false' : 'true');
    }
    document.body.classList.toggle('bill-panel-mobile-open', open && mobile);
}

function billStep2IsVisible() {
    var step2 = g('billStep2');
    return !!(step2 && step2.style.display !== 'none');
}

function renderBillPendingRefreshMeta() {
    var meta = g('billPendingRefreshMeta');
    if (!meta) return;
    if (billPendingRefreshState === 'loading') {
        meta.textContent = tr('bill.refresh.loading');
        return;
    }
    if (billPendingLastRefreshAt) {
        var t = billPendingLastRefreshAt.toLocaleTimeString(apptDateLocale(), {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        meta.textContent = trRepl('bill.refresh.updatedAt', { T: t });
        return;
    }
    meta.textContent = tr('bill.refresh.never');
}

function noteBillPendingRefreshed() {
    billPendingRefreshBusy = false;
    billPendingRefreshState = 'updated';
    billPendingLastRefreshAt = new Date();
    renderBillPendingRefreshMeta();
}

function stopBillPendingAutoRefresh() {
    if (billPendingRefreshTimer) {
        clearInterval(billPendingRefreshTimer);
        billPendingRefreshTimer = null;
    }
}

function startBillPendingAutoRefresh() {
    stopBillPendingAutoRefresh();
    if (!billPanelIsOpen()) return;
    fetchBillPendingRefreshIntervalMs(function(ms) {
        if (!ms || ms < 10000) return;
        billPendingRefreshTimer = setInterval(function() {
            refreshBillPanelLists();
        }, ms);
    });
}

function restartBillPendingAutoRefresh() {
    stopBillPendingAutoRefresh();
    if (billPanelIsOpen()) startBillPendingAutoRefresh();
}

function fetchBillPendingRefreshIntervalMs(done) {
    var fallback = DEFAULT_BILL_PENDING_REFRESH_MS;
    if (!SB || typeof SB.from !== 'function') {
        if (done) done(fallback);
        return;
    }
    SB.from('program_settings')
        .select('setting_key,setting_value')
        .in('setting_key', ['bill_pending_refresh_interval'])
        .then(function(r) {
            var ms = fallback;
            if (!r.error && r.data && r.data.length) {
                var map = {};
                r.data.forEach(function(row) {
                    map[row.setting_key] = row.setting_value;
                });
                var n = parseInt(map.bill_pending_refresh_interval, 10);
                if (!isNaN(n) && n >= 10) ms = n * 1000;
            }
            if (done) done(ms);
        })
        .catch(function() {
            if (done) done(fallback);
        });
}

function refreshBillPanelLists(opts) {
    opts = opts || {};
    var manual = !!opts.manual;
    if (!billPanelIsOpen()) return;
    if (billPendingRefreshBusy) return;

    billPendingRefreshBusy = true;
    billPendingRefreshState = 'loading';
    renderBillPendingRefreshMeta();

    var done = function(ok) {
        if (ok === false) {
            billPendingRefreshBusy = false;
            billPendingRefreshState = 'idle';
            renderBillPendingRefreshMeta();
            return;
        }
        noteBillPendingRefreshed();
    };

    if (billStep2IsVisible()) {
        if (manual) loadBillHistory();
        renderStep2(done);
    } else {
        loadBillHistory(done);
    }
}

function refreshBillPanelNow() {
    refreshBillPanelLists({ manual: true });
}

/** Re-sync bill panel when header working date changes (pending lists + bill/payment dates). */
function refreshBillPanelForWorkingDate() {
    var panel = g('billPanel');
    if (!panel || !panel.classList.contains('open') || !billPatId) return;

    sv('bDate', todayISO());
    var apModal = g('addPaymentModal');
    if (apModal && apModal.style.display === 'block' && g('apDate')) {
        sv('apDate', todayISO());
    }

    loadPendingLists(function (ok) {
        if (ok !== false && typeof noteBillPendingRefreshed === 'function') {
            noteBillPendingRefreshed();
        }
    });
}

function billDoctorIdFromApptRow(q) {
    if (!q) return '';
    if (q.doctor_id) return String(q.doctor_id);
    var code = String(q.doctor_code || '').trim();
    if (!code) return '';
    var list = (billDoctorList && billDoctorList.length)
        ? billDoctorList
        : ((typeof APP_DOCTORS !== 'undefined' && APP_DOCTORS) ? APP_DOCTORS : []);
    var hit = list.find(function (d) {
        return d && String(d.doctor_code || '').trim() === code;
    });
    return hit && hit.id ? String(hit.id) : '';
}

function openBillPanel(q) {
    billApptId  = q.id;
    billApptDoctorCode = String(q && q.doctor_code ? q.doctor_code : '').trim() || null;
    billApptDefaultDoctorId = billDoctorIdFromApptRow(q) || null;
    billPatId   = q.patient_id;
    billPatName = q.patient_name || '-';
    billPatNo   = q.patient_no   || '-';
    billPatChineseName = String(q.patient_chinese_name || '').trim();

    var billInfoHtml = '<strong>' + esc(billPatName) + '</strong>';
    if (billPatChineseName) {
        billInfoHtml += ' <span style="font-weight:700;">' + esc(billPatChineseName) + '</span>';
    }
    billInfoHtml += ' &nbsp;|&nbsp; #' + esc(billPatNo);
    g('billPatientInfo').innerHTML = billInfoHtml;

    billItems    = [];
    pendingLists = [];
    pendingIdx   = -1;
    payItems     = [];
    payPendingId = null;
    billPendingRefreshBusy = false;
    billPendingRefreshState = 'idle';
    billPendingLastRefreshAt = null;
    renderBillPendingRefreshMeta();

    // Load treatment item dropdown cache then pending lists
    loadTreatmentItemsForBilling(function() {
        loadPendingLists(function(ok) {
            if (ok !== false) noteBillPendingRefreshed();
        });
    });
    resetBillHistoryFilterUi();
    loadBillHistory();
    loadBillDoctors();

    wireBillPanelControls();
    startBillPendingAutoRefresh();
    if (typeof prefetchBillTypes === 'function') prefetchBillTypes();
    g('billPanel').classList.add('open');
    syncBillPanelBackdrop();
}

function closeBillPanel() {
    stopBillPendingAutoRefresh();
    g('billPanel').classList.remove('open');
    syncBillPanelBackdrop();
    billApptId   = null;
    billApptDefaultDoctorId = null;
    billApptDoctorCode = null;
    billPatId    = null;
    billPatChineseName = null;
    billItems    = [];
    pendingLists = [];
    pendingIdx   = -1;
    payItems     = [];
    payPendingId = null;
}

// ════════════════════════════════════════════════════════════════
// BILL STEP TABS
// ════════════════════════════════════════════════════════════════
function switchBillTab(n) {
    var step1 = g('billStep1');
    if (step1) step1.style.display = '';
    var step2 = g('billStep2');
    if (step2) {
        step2.style.display = 'none';
        step2.classList.add('hidden');
    }
    if (n === 2 && typeof renderStep2 === 'function') {
        renderStep2(function(ok) {
            if (ok !== false) noteBillPendingRefreshed();
        }, { resetForm: true });
    }
}

// ════════════════════════════════════════════════════════════════
// STEP 1 — PENDING BILL ITEM LISTS
// ════════════════════════════════════════════════════════════════
function loadPendingLists(cb) {
    var prevListId = null;
    var prevLabel = '';
    var prevLocalRef = null;
    syncPendingDraftFromInputs();
    if (pendingIdx >= 0 && pendingIdx < pendingLists.length) {
        prevListId = pendingLists[pendingIdx].id || null;
        prevLabel = pendingLists[pendingIdx].label || '';
        prevLocalRef = pendingLists[pendingIdx];
    }
    var preserveById = {};
    var localUnsaved = [];
    pendingLists.forEach(function(pl) {
        if (!pl) return;
        if (!pl.id) {
            localUnsaved.push(pl);
            return;
        }
        if (isPendingListDirty(pl)) preserveById[pl.id] = pl;
    });
    SB.from('pending_bill_items')
        .select('*')
        .eq('patient_id', billPatId)
        .eq('expires_on',  todayISO())
        .order('created_at', { ascending: true })
    .then(function(r) {
        var fetched = (!r.error && r.data) ? r.data : [];
        fetched.forEach(function(pl) {
            if (typeof pl.items === 'string') {
                try { pl.items = JSON.parse(pl.items); } catch(e) { pl.items = []; }
            }
            pl.items = (pl.items || []).map(normalizeBillItem);
        });
        var merged = fetched.map(function(pl) {
            if (pl.id && preserveById[pl.id]) {
                var local = preserveById[pl.id];
                if (pl.bill_id) local.bill_id = pl.bill_id;
                if (pl.doctor_id && !local.doctor_id) local.doctor_id = pl.doctor_id;
                return local;
            }
            return pl;
        });
        Object.keys(preserveById).forEach(function(id) {
            var exists = fetched.some(function(pl) { return pl.id === id; });
            if (!exists) merged.push(preserveById[id]);
        });
        localUnsaved.forEach(function(pl) {
            merged.push(pl);
        });
        merged.forEach(function (pl) {
            if (!pl || pl.bill_id) return;
            var localBid = readPendingBillIdFromLocalStore(pl);
            if (localBid) pl.bill_id = localBid;
        });
        pendingLists = merged;
        fetched.forEach(function(pl) {
            if (pl && pl.id) pendingServerSnapshotById[pl.id] = pendingListSignature(pl);
        });
        if (!pendingLists.length) {
            pendingIdx = -1;
        } else if (prevListId) {
            var hitId = pendingLists.findIndex(function(pl) { return pl.id === prevListId; });
            pendingIdx = hitId >= 0 ? hitId : 0;
        } else if (prevLocalRef) {
            var hitRef = pendingLists.findIndex(function(pl) { return pl === prevLocalRef; });
            pendingIdx = hitRef >= 0 ? hitRef : 0;
        } else if (prevLabel) {
            var hitLabel = pendingLists.findIndex(function(pl) { return (pl.label || '') === prevLabel; });
            pendingIdx = hitLabel >= 0 ? hitLabel : 0;
        } else if (pendingIdx < 0 || pendingIdx >= pendingLists.length) {
            pendingIdx = 0;
        }
        enrichPendingListsDoctorFromBills(pendingLists, function () {
            renderStep1UI();
            if (cb) cb(!r.error);
        });
    })
    .catch(function() {
        if (cb) cb(false);
    });
}

function enrichPendingListsDoctorFromBills(lists, done) {
    var need = (lists || []).filter(function (pl) {
        return pl && pl.bill_id && !pl.doctor_id;
    });
    if (!need.length || !SB || typeof SB.from !== 'function') {
        if (done) done();
        return;
    }
    var ids = need.map(function (pl) { return pl.bill_id; }).filter(Boolean);
    SB.from('bills')
        .select('id,doctor_id')
        .in('id', ids)
        .then(function (r) {
            var map = {};
            (r.data || []).forEach(function (b) {
                if (b && b.id && b.doctor_id) map[b.id] = b.doctor_id;
            });
            need.forEach(function (pl) {
                if (pl.bill_id && map[pl.bill_id]) pl.doctor_id = map[pl.bill_id];
            });
            if (done) done();
        })
        .catch(function () { if (done) done(); });
}

function renderStep1UI() {
    var hasLists = pendingLists.length > 0;
    g('pendingEmptyState').style.display  = hasLists ? 'none' : '';
    g('pendingActiveArea').style.display  = hasLists ? ''     : 'none';
    g('removePendingBtn').disabled        = !hasLists;
    g('pendingCounter').textContent       = hasLists
        ? trRepl('bill.pending.counterFmt', {
            CUR: String(pendingIdx + 1),
            TOTAL: String(pendingLists.length)
        })
        : '—';

    if (!hasLists) { billItems = []; return; }

    if (pendingIdx < 0 || pendingIdx >= pendingLists.length) pendingIdx = 0;
    var pl = pendingLists[pendingIdx];

    g('pendingListLabel').value = pl.label || '';
    billItems = (pl.items || []).map(function(it) {
        return normalizeBillItem(it);
    });
    if (!billItems.length) billItems = [{ desc: '', qty: 1, price: 0, disc: 0, tooth_no: '-' }];

    renderBillItems();
    recalcPendingSubtotal();
    syncPendingListDoctorSelectFromCurrentList();

    var statusEl = g('pendingListStatus');
    if (statusEl) {
        if (pl.bill_id) {
            statusEl.textContent = tr('bill.status.billPendingPayment');
            statusEl.style.color = '#2563eb';
        } else {
            statusEl.textContent = pl.id ? tr('bill.status.saved') : tr('bill.status.notSaved');
            statusEl.style.color = pl.id ? '#16a34a' : '#f59e0b';
        }
    }
}

function recalcPendingSubtotal() {
    var sub = billItems.reduce(function(a, it) { return a + billItemAmt(it); }, 0);
    var el  = g('pendingSubtotal');
    if (el) el.textContent = fmt2(sub);
}

function navPendingList(dir) {
    if (!pendingLists.length) return;
    syncPendingDraftFromInputs();
    pendingIdx = (pendingIdx + dir + pendingLists.length) % pendingLists.length;
    renderStep1UI();
}

function addNewPendingList() {
    var label = trRepl('bill.list.defaultLabel', { N: String(pendingLists.length + 1) });
    var defDr = defaultBillDoctorIdForPendingList();
    pendingLists.push({
        id: null,
        label: label,
        items: [],
        subtotal: 0,
        doctor_id: defDr || null
    });
    pendingIdx = pendingLists.length - 1;
    billItems  = [{ desc: '', qty: 1, price: 0, disc: 0, tooth_no: '-' }];
    renderStep1UI();
    var statusEl = g('pendingListStatus');
    if (statusEl) { statusEl.textContent = tr('bill.status.notSaved'); statusEl.style.color = '#f59e0b'; }
    if (g('pendingListLabel')) g('pendingListLabel').focus();
}

function createBillFromCurrentList() {
    if (!pendingLists.length || pendingIdx < 0) {
        alert(tr('bill.alert.createListFirst'));
        return;
    }
    syncPendingDraftFromInputs();
    syncPendingListDoctorFromUi();
    var pl = pendingLists[pendingIdx];
    var sub = pendingListSubtotalFromItems(billItems);

    if (sub <= 0.005) {
        alert(tr('bill.alert.addItemsFirst'));
        return;
    }
    if (!pl.doctor_id && !pendingListDoctorIdFromUi()) {
        alert(tr('bill.alert.selectDoctorForList'));
        var drSel = g('pendingListDoctor');
        if (drSel) drSel.focus();
        return;
    }

    saveCurrentPendingList({ createBill: true });
}

function saveCurrentPendingList(opts) {
    opts = opts || {};
    if (!pendingLists.length || pendingIdx < 0) return;
    var pl    = pendingLists[pendingIdx];
    var lockKey = pl.id || ('idx-' + pendingIdx);
    if (_pendingListSaveBusyKey === lockKey) return;

    syncPendingListDoctorFromUi();
    var label = (g('pendingListLabel').value || '').trim() || trRepl('bill.list.defaultLabel', { N: String(pendingIdx + 1) });
    var sub   = pendingListSubtotalFromItems(billItems);

    if (sub > 0.005 && !pl.doctor_id) {
        alert(tr('bill.alert.selectDoctorForList'));
        var drSel = g('pendingListDoctor');
        if (drSel) drSel.focus();
        return;
    }

    _pendingListSaveBusyKey = lockKey;

    pl.label    = label;
    pl.items    = billItems.map(function(it) {
        var n = normalizeBillItem(it);
        return {
            desc: n.desc,
            qty: n.qty,
            price: n.price,
            disc: roundBillDiscPct(n.disc || 0),
            others_remark: n.others_remark || '',
            tooth_no: n.tooth_no || '-'
        };
    });
    pl.subtotal = sub;

    var payload = {
        patient_id:   billPatId,
        patient_name: billPatName,
        patient_no:   billPatNo,
        label:        label,
        items:        JSON.stringify(pl.items),
        subtotal:     sub,
        expires_on:   todayISO(),
        created_by:   (typeof currentName !== 'undefined' ? currentName : null)
    };
    if (pl.bill_id) payload.bill_id = pl.bill_id;
    if (pl.doctor_id) payload.doctor_id = pl.doctor_id;

    var statusEl = g('pendingListStatus');
    if (statusEl) { statusEl.textContent = tr('bill.status.saving'); statusEl.style.color = '#888'; }

    function releaseSaveLock() {
        if (_pendingListSaveBusyKey === lockKey) _pendingListSaveBusyKey = null;
    }

    var query = pl.id
        ? SB.from('pending_bill_items').update(payload).eq('id', pl.id)
        : SB.from('pending_bill_items').insert([payload]).select();

    function afterPendingListSaved(r) {
        if (r.error) {
            releaseSaveLock();
            if (statusEl) {
                statusEl.textContent = trRepl('bill.status.saveFailed', { MSG: r.error.message });
                statusEl.style.color = '#dc2626';
            }
            return;
        }
        if (!pl.id && r.data && r.data[0]) pl.id = r.data[0].id;
        g('removePendingBtn').disabled = false;
        var t = new Date().toLocaleTimeString(apptDateLocale(), { hour: '2-digit', minute: '2-digit' });

        function finishListSaved() {
            if (opts.createBill && sub > 0.005) {
                if (statusEl) {
                    statusEl.textContent = tr('bill.status.creatingBill');
                    statusEl.style.color = '#888';
                }
                syncUnpaidBillFromPendingList(pl, sub, function (err) {
                    releaseSaveLock();
                    if (err) {
                        if (statusEl) {
                            statusEl.textContent = trRepl('bill.status.billSaveFailed', {
                                MSG: err.message || String(err)
                            });
                            statusEl.style.color = '#dc2626';
                        }
                        return;
                    }
                    if (statusEl) {
                        statusEl.textContent = trRepl('bill.status.savedBillAt', { T: t });
                        statusEl.style.color = '#2563eb';
                    }
                    if (pl.id) pendingServerSnapshotById[pl.id] = pendingListSignature(pl);
                    renderStep1UI();
                    noteBillPendingRefreshed();
                    loadBillHistory();
                    try { document.dispatchEvent(new CustomEvent('consultation-ar-refresh')); } catch (_) {}
                });
                return;
            }
            releaseSaveLock();
            if (statusEl) {
                statusEl.textContent = trRepl('bill.status.savedAt', { T: t });
                statusEl.style.color = '#16a34a';
            }
            if (pl.id) pendingServerSnapshotById[pl.id] = pendingListSignature(pl);
            noteBillPendingRefreshed();
            if (typeof loadBillHistory === 'function') loadBillHistory();
            try { document.dispatchEvent(new CustomEvent('consultation-ar-refresh')); } catch (_) {}
        }

        finishListSaved();
    }

    query.then(function(r) {
        if (r.error && (payload.bill_id || payload.doctor_id)) {
            var retryPayload = Object.assign({}, payload);
            if (r.error && payload.bill_id) {
                var mBill = String(r.error.message || '').toLowerCase();
                if (mBill.indexOf('bill_id') >= 0) delete retryPayload.bill_id;
            }
            if (r.error && payload.doctor_id) {
                var mDr = String(r.error.message || '').toLowerCase();
                if (mDr.indexOf('doctor_id') >= 0) delete retryPayload.doctor_id;
            }
            if (retryPayload.bill_id !== payload.bill_id ||
                retryPayload.doctor_id !== payload.doctor_id) {
                var retry = pl.id
                    ? SB.from('pending_bill_items').update(retryPayload).eq('id', pl.id)
                    : SB.from('pending_bill_items').insert([retryPayload]).select();
                retry.then(afterPendingListSaved);
                return;
            }
        }
        afterPendingListSaved(r);
    }).catch(function (e) {
        releaseSaveLock();
        if (statusEl) {
            statusEl.textContent = trRepl('bill.status.saveFailed', { MSG: e.message || String(e) });
            statusEl.style.color = '#dc2626';
        }
    });
}

function removeCurrentPendingList() {
    if (!pendingLists.length || pendingIdx < 0) return;
    var pl = pendingLists[pendingIdx];
    if (!confirm(trRepl('bill.removeListConfirm', { LABEL: (pl.label || tr('bill.list.thisList')) }))) return;

    function doRemove() {
        pendingLists.splice(pendingIdx, 1);
        pendingIdx = pendingLists.length ? Math.max(0, pendingIdx - 1) : -1;
        billItems  = [];
        renderStep1UI();
    }

    if (pl.id) {
        deleteUnpaidBillForPendingList(pl, function() {
            SB.from('pending_bill_items').delete().eq('id', pl.id)
            .then(function(r) {
                if (r.error) { alert(trRepl('appt.msg.error', { MSG: r.error.message })); return; }
                delete pendingServerSnapshotById[pl.id];
                doRemove();
            });
        });
    } else {
        doRemove();
    }
}

/** After a bill is fully paid, return to a fresh new-list workspace. */
function resetBillCreationAfterPayment(billId) {
    if (typeof closeModal === 'function') {
        closeModal('billDetailModal');
        closeModal('addPaymentModal');
    }
    bdCurrentBill = null;

    var linkedId = null;
    if (billId && pendingLists.length) {
        for (var i = 0; i < pendingLists.length; i++) {
            if (pendingLists[i] && pendingLists[i].bill_id === billId) {
                linkedId = pendingLists[i].id || null;
                break;
            }
        }
    }

    function startFreshList() {
        addNewPendingList();
        var formSec = g('billFormSection');
        if (formSec && formSec.scrollIntoView) {
            try { formSec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {
                formSec.scrollIntoView(true);
            }
        }
    }

    if (linkedId) {
        removePaidPendingList(linkedId, startFreshList);
    } else {
        startFreshList();
    }
}

/** Drop a paid pending list from Step 1 state and DB; refresh item picker for a new list. */
function removePaidPendingList(paidId, cb) {
    payItems = [];
    payPendingId = null;
    if (!paidId) {
        if (cb) cb(true);
        return;
    }
    var removedIdx = pendingLists.findIndex(function(pl) { return pl.id === paidId; });
    pendingLists = pendingLists.filter(function(pl) { return pl.id !== paidId; });
    delete pendingServerSnapshotById[paidId];
    if (!pendingLists.length) {
        pendingIdx = -1;
    } else if (removedIdx >= 0 && removedIdx < pendingIdx) {
        pendingIdx--;
    } else if (removedIdx === pendingIdx || pendingIdx >= pendingLists.length) {
        pendingIdx = Math.min(Math.max(0, pendingIdx), pendingLists.length - 1);
    }
    renderStep1UI();
    SB.from('pending_bill_items').delete().eq('id', paidId)
        .then(function(r) {
            if (cb) cb(!r.error);
        })
        .catch(function() {
            if (cb) cb(false);
        });
}

// ════════════════════════════════════════════════════════════════
// STEP 2 — PAYMENT (select a pending list, then pay)
// ════════════════════════════════════════════════════════════════
function renderStep2(cb, opts) {
    opts = opts || {};
    var resetForm = opts.resetForm === true;
    var prevType = g('bType') ? g('bType').value : '';
    var prevDiscount = g('bDiscount') ? g('bDiscount').value : '';
    var prevPaid = g('bAmtPaid') ? g('bAmtPaid').value : '';
    var prevNotes = g('bNotes') ? g('bNotes').value : '';
    var prevDate = g('bDate') ? g('bDate').value : '';
    var prevPendingId = resetForm ? null : payPendingId;

    loadBillTypes();
    if (resetForm) {
        sv('bDate',     todayISO());
        sv('bDiscount', '0');
        sv('bAmtPaid',  '0');
        sv('bNotes',    '');
        payItems     = [];
        payPendingId = null;
        var bTypeReset = g('bType');
        if (bTypeReset) {
            bTypeReset.disabled = false;
            delete bTypeReset.dataset.billTypeHold;
        }
    }
    g('payPreviewWrap').style.display   = 'none';
    if (resetForm) {
        g('bSubtotal').textContent = '0.00';
        g('bTotal').textContent    = '0.00';
        g('bBalance').textContent  = fmtHK(0);
    }

    SB.from('pending_bill_items')
        .select('*')
        .eq('patient_id', billPatId)
        .eq('expires_on',  todayISO())
        .order('created_at', { ascending: true })
    .then(function(r) {
        var lists  = (!r.error && r.data) ? r.data : [];
        var cards  = g('step2ListCards');
        var noneEl = g('step2NoneMsg');
        cards.innerHTML = '';

        lists.forEach(function(pl) {
            if (typeof pl.items === 'string') {
                try { pl.items = JSON.parse(pl.items); } catch(e) { pl.items = []; }
            }
            pl.items = (pl.items || []).map(normalizeBillItem);
            if (pl.id) {
                for (var li = 0; li < pendingLists.length; li++) {
                    if (pendingLists[li] && pendingLists[li].id === pl.id) {
                        if (pl.bill_id) pendingLists[li].bill_id = pl.bill_id;
                        if (pl.doctor_id) pendingLists[li].doctor_id = pl.doctor_id;
                        break;
                    }
                }
            }
        });

        if (!lists.length) {
            noneEl.style.display = '';
            if (cb) cb(!r.error);
            return;
        }
        noneEl.style.display = 'none';

        lists.forEach(function(pl) {
            var btn = document.createElement('button');
            btn.className = 'pending-list-card';
            var billedHint = pl.bill_id
                ? ('<div style="font-size:10px;color:#2563eb;margin-top:2px;font-weight:600;">' +
                    esc(tr('bill.step2.billSavedPending')) + '</div>')
                : '';
            btn.innerHTML =
                '<div style="font-weight:700;font-size:13px;">' + esc(pl.label || tr('bill.step2.cardListFallback')) + '</div>' +
                '<div style="font-size:11px;color:#888;margin-top:3px;">' +
                    fmtHKHtml(pl.subtotal) +
                    '&nbsp;·&nbsp;' + esc(trRepl('bill.step2.cardItems', { N: String(pl.items.length) })) +
                '</div>' +
                billedHint;
            btn.addEventListener('click', function() {
                document.querySelectorAll('.pending-list-card').forEach(function(b) {
                    b.classList.remove('selected');
                });
                btn.classList.add('selected');
                payItems     = (pl.items || []).map(normalizeBillItem);
                payPendingId = pl.id;
                renderPayPreview();
                recalcTotals();
                updateBillStep2DoctorSummary(pl);
                loadBillStep2NotesFromLinkedBill(pl);
            });
            cards.appendChild(btn);
        });

        if (prevPendingId) {
            var picked = null;
            Array.prototype.forEach.call(cards.children, function(node, idx) {
                if (!picked && lists[idx] && lists[idx].id === prevPendingId) {
                    picked = node;
                }
            });
            if (picked) {
                picked.click();
            } else if (lists.length === 1) {
                cards.firstChild.click();
            } else {
                payItems = [];
                payPendingId = null;
                g('bSubtotal').textContent = '0.00';
                g('bTotal').textContent = '0.00';
                g('bBalance').textContent = fmtHK(0);
            }
        } else if (lists.length === 1) {
            cards.firstChild.click();
        } else if (payItems.length) {
            renderPayPreview();
            recalcTotals();
        } else {
            g('bBalance').textContent = fmtHK(0);
        }

        if (!resetForm) {
            if (prevDate) sv('bDate', prevDate);
            if (prevDiscount) sv('bDiscount', prevDiscount);
            if (prevPaid) sv('bAmtPaid', prevPaid);
            if (prevNotes) sv('bNotes', prevNotes);
            if (prevType && g('bType')) g('bType').value = prevType;
            recalcTotals();
        }
        updateBillStep2DoctorSummary();
        if (cb) cb(!r.error);
    })
    .catch(function() {
        if (cb) cb(false);
    });
}

function refreshPayPreviewFromCurrentPendingList() {
    if (!payPendingId) return;
    if (pendingIdx < 0 || !pendingLists[pendingIdx]) return;
    if (pendingLists[pendingIdx].id !== payPendingId) return;
    payItems = billItems.map(normalizeBillItem);
    if (billStep2IsVisible()) renderPayPreview();
}

function renderPayPreview() {
    var wrap = g('payPreviewWrap');
    var body = g('payPreviewBody');
    if (!wrap || !body) return;
    body.innerHTML = '';
    payItems.forEach(function(it, i) {
        var row = document.createElement('tr');
        var disc = parseFloat(it.disc) || 0;
        var amt  = billItemAmt(it);
        row.style.background = i % 2 === 0 ? '#fff' : '#f8faff';
        row.innerHTML =
            '<td style="padding:7px 12px;">' + esc(billItemDisplayDesc(it) || '—') + '</td>' +
            '<td style="padding:7px 12px;text-align:center;">' + (it.qty || 0) + '</td>' +
            '<td style="padding:7px 12px;text-align:right;">' + fmt2(it.price) + '</td>' +
            '<td style="padding:7px 12px;text-align:center;color:' + (disc > 0 ? '#dc2626' : '#aaa') + ';">' +
                (disc > 0 ? formatBillDiscPctDisplay(disc) + '%' : '—') +
            '</td>' +
            '<td style="padding:7px 12px;text-align:right;font-weight:600;">' + fmt2(amt) + '</td>';
        body.appendChild(row);
    });
    wrap.style.display = payItems.length ? '' : 'none';
}

function billDoctorLabel(d) {
    if (!d) return tr('bill.doctorFallback');
    if (typeof billDoctorDropdownLabel === 'function') {
        return billDoctorDropdownLabel(d) || tr('bill.doctorFallback');
    }
    var disp = String(d.display_name || '').trim();
    if (disp && /^dr\.?\s+/i.test(disp)) return disp;
    return (typeof doctorDisplayName === 'function')
        ? (doctorDisplayName(d) || tr('bill.doctorFallback'))
        : (d.display_name || d.english_name || d.chinese_name || tr('bill.doctorFallback'));
}

function billDoctorTag(d) {
    if (!d) return '';
    return String(d.doctor_code || '').trim() ||
        billDoctorLabel(d) ||
        '';
}

function renderBillDoctorOptions(selectedId, selectId) {
    var sel = g(selectId || 'pendingListDoctor');
    if (!sel) return;
    var docs = (typeof doctorsForBillDoctorDropdown === 'function')
        ? doctorsForBillDoctorDropdown(billDoctorList || [])
        : (billDoctorList || []).filter(function (d) { return d && d.is_active !== false; });
    if (!docs.length) {
        sel.innerHTML = '<option value="">' + esc(tr('bill.noDoctorsOption')) + '</option>';
        return;
    }
    var html = '<option value="">' + esc(tr('bill.selectDoctor')) + '</option>' +
        docs.map(function (d) {
            var v = d.id || '';
            var s = (selectedId && String(v) === String(selectedId)) ? ' selected' : '';
            return '<option value="' + esc(v) + '"' + s + '>' + esc(billDoctorLabel(d)) + '</option>';
        }).join('');
    sel.innerHTML = html;
    if (selectedId && sel.value !== String(selectedId)) {
        sel.value = '';
    }
}

function pendingListDoctorIdFromUi() {
    var sel = g('pendingListDoctor');
    return sel ? String(sel.value || '').trim() : '';
}

function syncPendingListDoctorFromUi() {
    if (!pendingLists.length || pendingIdx < 0 || pendingIdx >= pendingLists.length) return;
    var id = pendingListDoctorIdFromUi();
    pendingLists[pendingIdx].doctor_id = id || null;
}

function syncPendingListDoctorSelectFromCurrentList() {
    var sel = g('pendingListDoctor');
    if (!sel) return;
    var pl = (pendingLists.length && pendingIdx >= 0 && pendingIdx < pendingLists.length)
        ? pendingLists[pendingIdx]
        : null;
    var want = pl ? (pl.doctor_id || defaultBillDoctorIdForPendingList() || '') : '';
    if (!sel.options.length || sel.options.length <= 1) {
        renderBillDoctorOptions(want, 'pendingListDoctor');
        return;
    }
    if (want && Array.prototype.some.call(sel.options, function (o) { return o.value === String(want); })) {
        sel.value = String(want);
    } else {
        renderBillDoctorOptions(want, 'pendingListDoctor');
    }
    if (pl && want && !pl.doctor_id) pl.doctor_id = want;
}

function pendingListDoctorLabelById(doctorId) {
    if (!doctorId) return '—';
    var picked = (billDoctorList || []).find(function (d) {
        return d && String(d.id) === String(doctorId);
    });
    return picked ? billDoctorLabel(picked) : '—';
}

function updateBillStep2DoctorSummary(pl) {
    var wrap = g('billStep2DoctorSummary');
    var labelEl = g('billStep2DoctorLabel');
    if (!wrap || !labelEl) return;
    if (!pl && payPendingId) {
        pl = pendingListByPayId(payPendingId);
    }
    if (!pl || !pl.doctor_id) {
        wrap.style.display = 'none';
        labelEl.textContent = '—';
        return;
    }
    wrap.style.display = '';
    labelEl.textContent = pendingListDoctorLabelById(pl.doctor_id);
}

function defaultBillDoctorIdForPendingList() {
    if (billApptDefaultDoctorId) return billApptDefaultDoctorId;
    return defaultBillDoctorId();
}

function pendingListDoctorIdForPayment(pl) {
    if (pl && pl.doctor_id) return pl.doctor_id;
    if (payPendingId) {
        var linked = pendingListByPayId(payPendingId);
        if (linked && linked.doctor_id) return linked.doctor_id;
    }
    return pendingListDoctorIdFromUi() || '';
}

function defaultBillDoctorId() {
    var pickerDocs = (typeof doctorsForBillDoctorDropdown === 'function')
        ? doctorsForBillDoctorDropdown(billDoctorList || [])
        : (billDoctorList || []);
    function isPickable(id) {
        if (!id) return false;
        return pickerDocs.some(function (d) { return String(d.id) === String(id); });
    }
    if (currentDoctorId && isPickable(currentDoctorId)) return currentDoctorId;
    var role = String(currentRole || '').toLowerCase();
    if ((role === 'doctor' || role === 'dentist') && currentName) {
        var n = String(currentName).trim().toLowerCase();
        var hit = pickerDocs.find(function (d) {
            return String(d.display_name || '').trim().toLowerCase() === n ||
                   String(d.english_name || '').trim().toLowerCase() === n ||
                   String(d.chinese_name || '').trim().toLowerCase() === n;
        });
        return hit ? hit.id : '';
    }
    return '';
}

function loadBillDoctors() {
    var sel = g('pendingListDoctor');
    if (!sel) return;
    sel.innerHTML = '<option value="">' + esc(tr('bill.loadingDoctors')) + '</option>';

    function applyDoctorOptions() {
        var def = defaultBillDoctorIdForPendingList();
        renderBillDoctorOptions(def, 'pendingListDoctor');
        syncPendingListDoctorSelectFromCurrentList();
        updateBillStep2DoctorSummary();
    }

    var fromGlobal = (typeof APP_DOCTORS !== 'undefined' && Array.isArray(APP_DOCTORS))
        ? APP_DOCTORS.filter(function (d) { return d && d.is_active !== false; })
        : [];
    if (fromGlobal.length) {
        billDoctorList = fromGlobal.slice();
        applyDoctorOptions();
        return;
    }

    if (typeof SB === 'undefined' || !SB || !SB.from) {
        sel.innerHTML = '<option value="">' + esc(tr('bill.supabaseNotReady')) + '</option>';
        return;
    }

    SB.from('doctors')
      .select('id,doctor_code,english_name,chinese_name,display_name,is_active')
      .eq('is_active', true)
      .order('doctor_code', {ascending: true})
    .then(function(r) {
        if (r.error) {
            sel.innerHTML = '<option value="">' + esc(tr('bill.loadDoctorsFailed')) + '</option>';
            return;
        }
        billDoctorList = r.data || [];
        if (!billApptDefaultDoctorId && billApptDoctorCode) {
            billApptDefaultDoctorId = billDoctorIdFromApptRow({ doctor_code: billApptDoctorCode }) || null;
        }
        applyDoctorOptions();
    })
    .catch(function(e) {
        sel.innerHTML = '<option value="">' + esc(tr('bill.loadDoctorsFailed')) + '</option>';
        try { console.error('loadBillDoctors error', e); } catch (_) {}
    });
}

function addBillItem() {
    if (!pendingLists.length) {
        addNewPendingList();
    }
    billItems.push({ desc: '', qty: 1, price: 0, disc: 0, tooth_no: '-' });
    syncBillItemsToPendingList();
    renderBillItems();
    recalcTotals();
}

function syncBillItemsToPendingList() {
    if (!pendingLists.length || pendingIdx < 0 || pendingIdx >= pendingLists.length) return;
    pendingLists[pendingIdx].items = billItems.map(function(it) {
        var n = normalizeBillItem(it);
        return {
            desc: n.desc,
            qty: n.qty,
            price: n.price,
            disc: roundBillDiscPct(n.disc || 0),
            others_remark: n.others_remark || '',
            tooth_no: n.tooth_no || '-'
        };
    });
}

function pendingListSignature(pl) {
    var list = pl || {};
    var items = Array.isArray(list.items) ? list.items : [];
    var safeItems = items.map(function(it) {
        var n = normalizeBillItem(it);
        return {
            desc: n.desc,
            qty: parseFloat(n.qty) || 0,
            price: parseFloat(n.price) || 0,
            disc: roundBillDiscPct(n.disc || 0),
            others_remark: n.others_remark || '',
            tooth_no: n.tooth_no || '-'
        };
    });
    return JSON.stringify({
        label: list.label || '',
        subtotal: parseFloat(list.subtotal) || 0,
        doctor_id: list.doctor_id || '',
        items: safeItems
    });
}

function isPendingListDirty(pl) {
    if (!pl || !pl.id) return true;
    var snap = pendingServerSnapshotById[pl.id];
    if (!snap) return false;
    return pendingListSignature(pl) !== snap;
}

function syncPendingDraftFromInputs() {
    if (!pendingLists.length || pendingIdx < 0 || pendingIdx >= pendingLists.length) return;
    var pl = pendingLists[pendingIdx];
    if (!pl) return;
    var labelEl = g('pendingListLabel');
    if (labelEl) pl.label = (labelEl.value || '').trim();
    syncPendingListDoctorFromUi();
    syncBillItemsToPendingList();
    pl.subtotal = pendingListSubtotalFromItems(billItems);
}

function billItemAmt(it) {
    var gross = billItemGross(it);
    var disc  = roundBillDiscPct(it.disc);
    return gross * (1 - disc / 100);
}

function billItemGross(it) {
    return (parseFloat(it.qty) || 0) * (parseFloat(it.price) || 0);
}

function parseBillAmountInput(raw) {
    var s = String(raw == null ? '' : raw).trim().replace(/,/g, '');
    if (!s) return 0;
    var n = parseFloat(s.replace(/[^0-9.\-]/g, ''));
    return isNaN(n) ? 0 : n;
}

/** Stable discount % storage (avoids 15.000000000000002-style float drift). */
function roundBillDiscPct(disc) {
    var n = Math.min(100, Math.max(0, parseFloat(disc) || 0));
    return Math.round(n * 10000) / 10000;
}

/** Human-readable discount % for inputs, previews, and receipts. */
function formatBillDiscPctDisplay(disc) {
    var n = roundBillDiscPct(disc);
    return n.toFixed(4).replace(/\.?0+$/, '') || '0';
}

function formatBillDiscPctInput(disc) {
    return formatBillDiscPctDisplay(disc);
}

/** Derive line discount % when user edits the net amount directly (cent-safe). */
function billItemDiscPctFromNet(it, netAmount) {
    var gross = billItemGross(it);
    if (!(gross > 0)) return 0;
    var net = Math.max(0, Math.min(gross, parseBillAmountInput(netAmount)));
    var grossCents = Math.round(gross * 100);
    var netCents = Math.round(net * 100);
    if (grossCents <= 0) return 0;
    return roundBillDiscPct((1 - netCents / grossCents) * 100);
}

function syncBillItemAmountInput(idx) {
    var amtEl = g('bamt-' + idx);
    if (amtEl && billItems[idx]) {
        amtEl.value = fmt2(billItemAmt(billItems[idx]));
    }
}

function syncBillItemDiscInput(idx) {
    var discEl = g('bdisc-' + idx);
    if (discEl && billItems[idx]) {
        discEl.value = formatBillDiscPctInput(billItems[idx].disc);
    }
}

var BILL_OTHERS_ITEM_BASE = 'OTHERS - 其他';

function billItemOthersBaseKey(desc) {
    var d = String(desc || '').trim();
    var paren = d.match(/^(.+?)\s*\([^)]*\)\s*$/);
    if (paren) d = paren[1].trim();
    var compact = d.replace(/\s+/g, '').toUpperCase();
    if (compact === 'OTHERS-其他') return BILL_OTHERS_ITEM_BASE;
    if (d === BILL_OTHERS_ITEM_BASE) return BILL_OTHERS_ITEM_BASE;
    return null;
}

function billItemIsOthers(it) {
    return !!billItemOthersBaseKey(it && it.desc);
}

function billItemOthersRemark(it) {
    return String((it && (it.others_remark || it.othersRemark)) || '').trim();
}

function billItemToothNo(it) {
    return String((it && (it.tooth_no || it.toothNo)) || '').trim();
}

function billItemToothInputValue(it) {
    var t = billItemToothNo(it);
    return (t && t !== '-') ? t : '-';
}

function billItemParseToothFromDesc(desc) {
    var d = String(desc || '').trim();
    if (!d) return { base: '', tooth: '' };
    if (billItemOthersBaseKey(d)) {
        return { base: billItemOthersBaseKey(d), tooth: '' };
    }
    var m = d.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
    if (m) {
        return { base: m[1].trim(), tooth: m[2].trim() };
    }
    return { base: d, tooth: '' };
}

function billItemDescBase(desc) {
    var others = billItemOthersBaseKey(desc);
    if (others) return others;
    return billItemParseToothFromDesc(desc).base;
}

function billItemDisplayDesc(it) {
    if (!it) return '';
    var base = billItemOthersBaseKey(it.desc);
    if (base) {
        var remark = billItemOthersRemark(it);
        return remark ? (base + ' (' + remark + ')') : base;
    }
    var name = String(it.desc || '').trim();
    var tooth = billItemToothNo(it);
    if (tooth && tooth !== '-') {
        return name + ' (' + tooth + ')';
    }
    return name;
}

function normalizeBillItem(it) {
    var raw = it || {};
    var desc = String(raw.desc || '').trim();
    var othersRemark = String(raw.others_remark || raw.othersRemark || '').trim();
    var toothNo = billItemToothNo(raw);
    var base = billItemOthersBaseKey(desc);
    if (base) {
        var m = desc.match(/^(.+?)\s*\(([^)]*)\)\s*$/);
        if (m && !othersRemark) othersRemark = String(m[2] || '').trim();
        desc = base;
        toothNo = '-';
    } else {
        var parsed = billItemParseToothFromDesc(desc);
        desc = parsed.base;
        if (!toothNo || toothNo === '-') {
            toothNo = parsed.tooth || '-';
        }
        if (!toothNo) toothNo = '-';
    }
    return {
        desc: desc,
        qty: raw.qty || 1,
        price: raw.price || 0,
        disc: roundBillDiscPct(raw.disc || 0),
        others_remark: othersRemark,
        tooth_no: toothNo
    };
}

function billItemsForBillSave(items) {
    return (items || []).map(function(it) {
        var n = normalizeBillItem(it);
        return {
            desc: billItemDisplayDesc(n),
            qty: n.qty,
            price: n.price,
            disc: roundBillDiscPct(n.disc || 0)
        };
    });
}

function renderBillItems() {
    var tb = g('billItemsBody');
    if (!tb) return;
    tb.innerHTML = '';
    billItems.forEach(function(item, i) {
        var row = document.createElement('tr');
        var descBase = billItemDescBase(item.desc) || item.desc;
        var discVal = item.disc !== undefined ? item.disc : 0;
        var isOthers = billItemIsOthers(item);

        // Build description cell with dropdown + custom input
        var descCell = '<td>' +
            '<div style="display:flex;flex-direction:column;gap:4px;">';

        // If we have treatment items cached, show dropdown
        if (treatmentItemsCache.length > 0) {
            descCell +=
                '<select id="bdesc-sel-' + i + '" ' +
                'style="width:100%;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:13px;box-sizing:border-box;">' +
                buildTreatmentItemOptions(item.desc) +
                '</select>' +
                '<input type="text" id="bdesc-custom-' + i + '" ' +
                'value="' + esc(item.desc) + '" ' +
                'placeholder="' + esc(tr('bill.phCustomDesc')) + '" ' +
                'style="width:100%;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:12px;box-sizing:border-box;' +
                'display:' + (descBase && treatmentItemsCache.findIndex(function(t) { return t.item_name === descBase; }) === -1 ? 'block' : 'none') + ';">';
        } else {
            // Fallback to simple text input if no items loaded
            descCell +=
                '<input type="text" id="bdesc-' + i + '" ' +
                'value="' + esc(item.desc) + '" ' +
                'placeholder="' + esc(tr('bill.phDescription')) + '" ' +
                'style="width:100%;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:13px;box-sizing:border-box;">';
        }
        descCell += '</div></td>';

        var toothCell = isOthers
            ? '<td class="bill-tooth-cell bill-tooth-cell--na">—</td>'
            : '<td class="bill-tooth-cell">' +
                '<input type="text" id="btooth-' + i + '" ' +
                'value="' + esc(billItemToothInputValue(item)) + '" ' +
                'placeholder="' + esc(tr('bill.ph.toothNo')) + '" ' +
                'title="' + esc(tr('bill.toothNoTitle')) + '" ' +
                'maxlength="24" autocomplete="off">' +
              '</td>';

        row.innerHTML = descCell + toothCell +
            '<td class="bill-qty-cell">' +
                '<input type="number" id="bqty-' + i + '" class="bill-qty-input" ' +
                'value="' + item.qty + '" min="1" step="1">' +
            '</td>' +
            '<td>' +
                '<input type="number" id="bprice-' + i + '" ' +
                'value="' + item.price + '" min="0" step="0.01" ' +
                'style="width:100%;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:13px;box-sizing:border-box;">' +
            '</td>' +
            '<td>' +
                '<input type="number" id="bdisc-' + i + '" ' +
                'value="' + formatBillDiscPctInput(discVal) + '" min="0" max="100" step="0.1" ' +
                'style="width:100%;min-width:52px;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:13px;box-sizing:border-box;text-align:center;" ' +
                'title="' + esc(tr('bill.discPctInputTitle')) + '">' +
            '</td>' +
            '<td style="text-align:right;">' +
                '<input type="text" id="bamt-' + i + '" ' +
                'value="' + fmt2(billItemAmt(item)) + '" ' +
                'inputmode="decimal" autocomplete="off" ' +
                'style="width:100%;min-width:72px;padding:5px 7px;border:1px solid #ddd;' +
                'border-radius:4px;font-size:13px;box-sizing:border-box;text-align:right;font-weight:600;" ' +
                'title="' + esc(tr('bill.amountInputTitle')) + '">' +
            '</td>' +
            '<td>' +
                '<button data-idx="' + i + '" class="bill-del-row" ' +
                'title="' + esc(tr('bill.btnRemoveRowTitle')) + '" ' +
                'aria-label="' + esc(tr('bill.btnRemoveRowTitle')) + '" ' +
                'style="background:none;border:none;color:var(--danger);' +
                'font-size:18px;cursor:pointer;line-height:1;">×</button>' +
            '</td>';
        tb.appendChild(row);

        if (billItemIsOthers(item)) {
            var remarkRow = document.createElement('tr');
            remarkRow.className = 'bill-item-others-remark-row';
            remarkRow.innerHTML =
                '<td colspan="7" style="padding:2px 8px 10px 8px;background:#fffbeb;border-bottom:1px solid #fde68a;">' +
                '<input type="text" id="bothers-remark-' + i + '" ' +
                'value="' + esc(billItemOthersRemark(item)) + '" ' +
                'placeholder="' + esc(tr('bill.othersRemarkPh')) + '" ' +
                'style="width:100%;padding:6px 8px;border:1px solid #fde047;border-radius:4px;' +
                'font-size:12px;box-sizing:border-box;background:#fff;">' +
                '</td>';
            tb.appendChild(remarkRow);
        }

        (function(idx) {
            var descSel = g('bdesc-sel-' + idx);
            var descCustom = g('bdesc-custom-' + idx);
            var descSimple = g('bdesc-' + idx);
            
            // Handle dropdown change
            if (descSel) {
                descSel.addEventListener('change', function() {
                    var selectedValue = this.value;
                    if (selectedValue === '') {
                        // Show custom input
                        if (descCustom) {
                            descCustom.style.display = 'block';
                            descCustom.focus();
                        }
                        billItems[idx].desc = '';
                        billItems[idx].others_remark = '';
                        billItems[idx].tooth_no = '-';
                    } else {
                        // Use selected item
                        billItems[idx].desc = selectedValue;
                        if (billItemIsOthers(billItems[idx])) {
                            billItems[idx].tooth_no = '-';
                        } else {
                            billItems[idx].others_remark = '';
                        }
                        if (descCustom) descCustom.style.display = 'none';
                        
                        // Auto-fill price from selected option
                        var selectedOpt = this.options[this.selectedIndex];
                        var price = parseFloat(selectedOpt.getAttribute('data-price')) || 0;
                        billItems[idx].price = price;
                        syncBillItemsToPendingList();
                        renderBillItems();
                        recalcTotals();
                        refreshPayPreviewFromCurrentPendingList();
                        return;
                    }
                    syncBillItemsToPendingList();
                    renderBillItems();
                    recalcTotals();
                    refreshPayPreviewFromCurrentPendingList();
                });
            }
            
            var othersRemarkEl = g('bothers-remark-' + idx);
            if (othersRemarkEl) {
                othersRemarkEl.addEventListener('input', function() {
                    billItems[idx].others_remark = this.value;
                    syncBillItemsToPendingList();
                    refreshPayPreviewFromCurrentPendingList();
                });
            }
            
            // Handle custom input
            if (descCustom) {
                descCustom.addEventListener('input', function() {
                    billItems[idx].desc = this.value;
                    if (!billItemIsOthers(billItems[idx])) {
                        billItems[idx].others_remark = '';
                    } else {
                        billItems[idx].tooth_no = '-';
                    }
                    syncBillItemsToPendingList();
                    renderBillItems();
                    refreshPayPreviewFromCurrentPendingList();
                });
            }

            var toothEl = g('btooth-' + idx);
            if (toothEl) {
                toothEl.addEventListener('input', function() {
                    var v = String(this.value || '').trim();
                    billItems[idx].tooth_no = v || '-';
                    syncBillItemsToPendingList();
                    refreshPayPreviewFromCurrentPendingList();
                });
                toothEl.addEventListener('blur', function() {
                    var v = String(this.value || '').trim();
                    if (!v || v === '-') {
                        this.value = '-';
                        billItems[idx].tooth_no = '-';
                        syncBillItemsToPendingList();
                        refreshPayPreviewFromCurrentPendingList();
                    }
                });
            }
            
            // Handle simple input (fallback)
            if (descSimple) {
                descSimple.addEventListener('input', function() {
                    billItems[idx].desc = this.value;
                    if (!billItemIsOthers(billItems[idx])) {
                        billItems[idx].others_remark = '';
                    } else {
                        billItems[idx].tooth_no = '-';
                    }
                    syncBillItemsToPendingList();
                    renderBillItems();
                    refreshPayPreviewFromCurrentPendingList();
                });
            }
            
            var qtyEl = g('bqty-' + idx);
            var priceEl = g('bprice-' + idx);
            var discEl = g('bdisc-' + idx);
            var amtEl = g('bamt-' + idx);
            if (qtyEl) {
                qtyEl.addEventListener('input', function() {
                    billItems[idx].qty = parseFloat(this.value) || 1;
                    syncBillItemAmountInput(idx);
                    syncBillItemsToPendingList();
                    recalcTotals();
                });
            }
            if (priceEl) {
                priceEl.addEventListener('input', function() {
                    billItems[idx].price = parseFloat(this.value) || 0;
                    syncBillItemAmountInput(idx);
                    syncBillItemsToPendingList();
                    recalcTotals();
                });
            }
            if (discEl) {
                discEl.addEventListener('input', function() {
                    billItems[idx].disc = roundBillDiscPct(parseFloat(this.value) || 0);
                    syncBillItemAmountInput(idx);
                    syncBillItemsToPendingList();
                    recalcTotals();
                });
                discEl.addEventListener('blur', function() {
                    this.value = formatBillDiscPctInput(billItems[idx].disc);
                });
            }
            if (amtEl) {
                amtEl.addEventListener('input', function() {
                    billItems[idx].disc = billItemDiscPctFromNet(billItems[idx], this.value);
                    syncBillItemDiscInput(idx);
                    syncBillItemsToPendingList();
                    recalcTotals();
                    refreshPayPreviewFromCurrentPendingList();
                });
                amtEl.addEventListener('blur', function() {
                    this.value = fmt2(billItemAmt(billItems[idx]));
                });
            }
        })(i);

        var delBtn = row.querySelector('.bill-del-row');
        if (delBtn) {
            delBtn.addEventListener('click', function() {
                billItems.splice(parseInt(this.dataset.idx, 10), 1);
                syncBillItemsToPendingList();
                renderBillItems();
                recalcTotals();
            });
        }
    });
}

function recalcTotals() {
    var step2 = g('billStep2') && g('billStep2').style.display !== 'none';
    if (step2) {
        // Use payItems from the selected pending list
        var sub  = payItems.reduce(function(a, it) { return a + billItemAmt(it); }, 0);
        var disc  = parseFloat(g('bDiscount').value) || 0;
        var total = Math.max(0, sub - disc);
        g('bSubtotal').textContent = fmt2(sub);
        g('bTotal').textContent    = fmt2(total);
        recalcBalance();
    } else {
        // Step 1: update the pending subtotal display only
        recalcPendingSubtotal();
    }
}

function recalcBalance() {
    var total   = parseFloat(g('bTotal').textContent) || 0;
    var paid    = parseFloat(g('bAmtPaid').value)      || 0;
    var balance = total - paid;
    g('bBalance').textContent  = fmtHK(balance);
    g('bBalance').style.color  =
        balance > 0 ? 'var(--danger)' : 'var(--success)';
    syncBillPayTypeForBalance(total, paid, balance);
}

function billPayAllAmount() {
    var total = parseFloat(g('bTotal').textContent) || 0;
    sv('bAmtPaid', fmt2(total));
    recalcBalance();
}

function saveBill(doPrint) {
    if (!payItems.length) { alert(tr('bill.alert.selectListFirst')); return; }

    var sub   = parseFloat(g('bSubtotal').textContent) || 0;
    var disc  = parseFloat(g('bDiscount').value)        || 0;
    var total = parseFloat(g('bTotal').textContent)     || 0;
    var paid  = parseFloat(g('bAmtPaid').value)         || 0;
    var bal   = total - paid;

    var linkedPl = pendingListByPayId(payPendingId);
    var existingBillId = linkedPl && linkedPl.bill_id ? linkedPl.bill_id : null;
    var doctorIdForSave = pendingListDoctorIdForPayment(linkedPl);

    if (!doctorIdForSave) {
        alert(tr('bill.alert.selectDoctorForList'));
        switchBillTab(1);
        return;
    }
    var selectedType = g('bType') ? g('bType').value : '';
    if (paid > 0.005 && !String(selectedType || '').trim()) {
        alert(tr('bill.alert.selectPaymentMethod'));
        return;
    }

    var billType;
    if (paid <= 0.005) {
        ensurePendingBillTypeOption(g('bType'));
        billType = billPendingPayTypeValue();
        if (g('bType')) g('bType').value = billType;
    } else {
        if (!String(selectedType || '').trim()) {
            alert(tr('bill.alert.selectPaymentMethod'));
            return;
        }
        billType = billResolvePayTypeForSave(paid, bal, total, selectedType);
        if (g('bType')) g('bType').value = billType;
    }

    var payload = {
        appointment_id: billApptId,
        patient_id:     billPatId,
        patient_name:   billPatName,
        patient_no:     billPatNo,
        bill_date:      g('bDate').value  || todayISO(),
        bill_type:      billType,
        items:          JSON.stringify(billItemsForBillSave(payItems)),
        subtotal:       sub,
        discount:       disc,
        total:          total,
        amount_paid:    paid,
        balance:        bal,
        notes:          String(g('bNotes').value || '').trim() || null,
        status:         bal <= 0.005 ? 'Paid' : 'Partial'
    };
    Object.assign(payload, billClinicFieldsForSave());
    Object.assign(payload, billDoctorFieldsForSave(doctorIdForSave, { noFallback: true }));

    var finishAfterSaved = function(r) {
        var paidPendingId = payPendingId;
        var savedBill = (r.data && r.data[0]) ? r.data[0] : (r.saved || null);
        var savedBillId = savedBill ? savedBill.id : existingBillId;

        var continueAfterPending = function() {
            var apptChain = billApptId
                ? SB.from('appointments')
                    .update({ bill_status: bal <= 0 ? 'Paid' : 'Billed' })
                    .eq('id', billApptId)
                : Promise.resolve();
            apptChain.then(function() {
                if (billApptId) loadQueue();
                loadBillHistory();
                try { document.dispatchEvent(new CustomEvent('consultation-ar-refresh')); } catch (_) {}
                if (doPrint) {
                    openReceiptPreviewDirect({
                        bill: receiptBillWithSavedNotes(payload, savedBill),
                        insertedData: savedBill ? [savedBill] : [],
                        payments: null,
                        autoPrint: true
                    });
                } else {
                    alert(tr('bill.alert.savedOk'));
                }
                if (billStep2IsVisible()) {
                    renderStep2(function(ok) {
                        if (ok !== false) noteBillPendingRefreshed();
                    }, { resetForm: true });
                }
            });
        };

        var afterPendingRemoved = function() {
            if (!(paid > 0) || !savedBillId) {
                continueAfterPending();
                return;
            }
            var payRecord = {
                bill_id:     savedBillId,
                paid_date:   payload.bill_date,
                amount:      paid,
                method:      payload.bill_type,
                notes:       payload.notes,
                received_by: (typeof currentName !== 'undefined' ? currentName : null)
            };
            var clinicCtx = billPaymentClinicContext();
            payRecord.clinic_id = clinicCtx.clinic_id;
            payRecord.clinic_tag = clinicCtx.clinic_tag;
            payRecord.clinic_code = clinicCtx.clinic_code;
            insertBillPaymentRecord(payRecord, function(pr) {
                if (pr.error) {
                    console.warn('Initial bill payment row not saved:', pr.error.message || pr.error);
                }
                continueAfterPending();
            });
        };

        removePaidPendingList(paidPendingId, afterPendingRemoved);
    };

    persistBillRecord(payload, existingBillId, function(err, saved) {
        if (err) {
            alert(trRepl('appt.msg.error', { MSG: err.message || String(err) }));
            return;
        }
        finishAfterSaved({ data: saved ? [saved] : [], saved: saved });
    });
}

function loadTreatmentItemsForBilling(callback) {
    SB.from('treatment_items')
        .select('*')
        .eq('is_active', true)
        .order('item_name', {ascending: true})
    .then(function(r) {
        if (r.error) {
            console.error('Error loading treatment items:', r.error);
            treatmentItemsCache = [];
        } else {
            treatmentItemsCache = r.data || [];
        }
        if (callback) callback();
    })
    .catch(function(e) {
        console.error('Error loading treatment items:', e);
        treatmentItemsCache = [];
        if (callback) callback();
    });
}

function buildTreatmentItemOptions(selectedDesc) {
    var html = '<option value="">' + esc(tr('bill.treatSelectCustom')) + '</option>';
    var selectedBase = billItemDescBase(selectedDesc) || String(selectedDesc || '').trim();
    treatmentItemsCache.forEach(function(item) {
        var selected = selectedBase === item.item_name ? ' selected' : '';
        var label = item.item_name;
        if (item.category) {
            label += ' (' + item.category + ')';
        }
        html += '<option value="' + esc(item.item_name) + '" ' +
                'data-price="' + (item.unit_price || 0) + '"' + selected + '>' +
                esc(label) +
                '</option>';
    });
    return html;
}

var billTypesCache = [];          // active rows from bill_types (Configuration → Payment Methods)
var billTypesLoadPromise = null;
var billTypesFetchOk = false;

var BILL_TYPE_FALLBACK_PAY_METHODS = [
    'Cash', 'Visa', 'Mastercard', 'EPS', 'HKBC', 'Cheque',
    'Bank Transfer', 'Insurance', 'Waived', 'Other'
];

function invalidateBillTypesCache() {
    billTypesCache = [];
    billTypesLoadPromise = null;
    billTypesFetchOk = false;
}

function billTypeOptionValue(bt) {
    return String((bt && (bt.name || bt.type_code)) || '').trim();
}

function billTypeRowIsActive(bt) {
    return bt && bt.is_active !== false;
}

function billTypeRowIsUnsettled(bt) {
    var v = billTypeOptionValue(bt);
    if (!v) return true;
    var lk = v.toLowerCase();
    return billPendingPayTypeCandidates().some(function (c) {
        return String(c || '').trim().toLowerCase() === lk;
    });
}

function billTypeRowIsPayable(bt) {
    return billTypeRowIsActive(bt) && !billTypeRowIsUnsettled(bt);
}

function findBillTypeRow(value) {
    var v = String(value || '').trim().toLowerCase();
    if (!v || !billTypesCache.length) return null;
    for (var i = 0; i < billTypesCache.length; i++) {
        var bt = billTypesCache[i];
        var name = String(bt.name || '').trim().toLowerCase();
        var code = String(bt.type_code || '').trim().toLowerCase();
        if (name === v || code === v) return bt;
    }
    return null;
}

function billTypeDisplayLabel(btOrValue, fromRow) {
    if (btOrValue && typeof btOrValue === 'object') {
        var bt = btOrValue;
        var val = billTypeOptionValue(bt);
        var lang = (typeof appUiLang !== 'undefined') ? appUiLang : 'en';
        if ((lang === 'zh-CN' || lang === 'zh-Hant') && bt.type_name && String(bt.type_name).trim()) {
            return String(bt.type_name).trim();
        }
        return (typeof dispPayMethod === 'function') ? dispPayMethod(val, true) : val;
    }
    if (!fromRow) {
        var hit = findBillTypeRow(btOrValue);
        if (hit) return billTypeDisplayLabel(hit, true);
    }
    var s = String(btOrValue || '').trim();
    return (typeof dispPayMethod === 'function') ? dispPayMethod(s, true) : s;
}

function billTypesForSelect(opts) {
    opts = opts || {};
    var rows = billTypesCache.length ? billTypesCache.slice() : [];
    if (opts.forPayment) {
        return rows.filter(billTypeRowIsPayable);
    }
    return rows.filter(billTypeRowIsActive);
}

function ensureBillTypeOptionExists(sel, value) {
    if (!sel || !sel.appendChild) return;
    var v = String(value || '').trim();
    if (!v) return;
    var has = Array.prototype.some.call(sel.options || [], function (o) { return o.value === v; });
    if (has) return;
    var o = document.createElement('option');
    o.value = v;
    o.textContent = billTypeDisplayLabel(v);
    sel.appendChild(o);
}

function normalizeBillTypesRows(rows) {
    return (rows || []).filter(billTypeRowIsActive).map(function (bt) {
        if (!bt) return bt;
        if (!bt.name && bt.type_code) bt.name = bt.type_code;
        if (!bt.type_code && bt.name) bt.type_code = bt.name;
        return bt;
    });
}

function fetchBillTypesFromDb(force) {
    if (force) invalidateBillTypesCache();
    if (billTypesLoadPromise) return billTypesLoadPromise;

    function finishFromResponse(r) {
        billTypesFetchOk = !r.error;
        if (r.error) {
            console.error('bill_types load failed:', r.error);
            billTypesCache = [];
            return billTypesCache;
        }
        billTypesCache = normalizeBillTypesRows(r.data);
        return billTypesCache;
    }

    billTypesLoadPromise = SB.from('bill_types')
        .select('*')
        .order('sort_order', { ascending: true })
        .then(function (r) {
            if (r.error && /sort_order/i.test(String(r.error.message || ''))) {
                return SB.from('bill_types').select('*').then(finishFromResponse);
            }
            return finishFromResponse(r);
        })
        .catch(function (e) {
            billTypesFetchOk = false;
            console.error('bill_types load error:', e);
            billTypesCache = [];
            return billTypesCache;
        });
    return billTypesLoadPromise;
}

function ensureBillTypesLoaded(cb, force) {
    return fetchBillTypesFromDb(!!force)
        .then(function (rows) {
            if (typeof cb === 'function') cb(rows);
            return rows;
        })
        .catch(function (e) {
            console.error('ensureBillTypesLoaded failed:', e);
            if (typeof cb === 'function') cb([]);
            return [];
        });
}

function prefetchBillTypes() {
    return ensureBillTypesLoaded(null, false);
}

function populateAllBillPaymentSelects(opts) {
    opts = opts || {};
    var bType = g('bType');
    if (bType) {
        var prevType = bType.value;
        applyBillTypeOptions(bType, !!opts.markDefault, { includePending: true, extraValues: opts.extraValues });
        if (prevType) {
            ensureBillTypeOptionExists(bType, prevType);
            bType.value = prevType;
        }
    }
    var apSel = g('apMethod');
    if (apSel) {
        var prevAp = apSel.value;
        applyBillTypeOptions(apSel, !!opts.markApDefault, { forPayment: true, extraValues: opts.extraValues });
        if (prevAp) {
            ensureBillTypeOptionExists(apSel, prevAp);
            apSel.value = prevAp;
        }
    }
}

function appendBillTypeFallbackOptions(sel) {
    BILL_TYPE_FALLBACK_PAY_METHODS.forEach(function (v) {
        ensureBillTypeOptionExists(sel, v);
    });
}

function applyBillTypeOptions(sel, markDefault, opts) {
    opts = opts || {};
    if (!sel || !sel.appendChild) return;

    var includePending = opts.forPayment ? false : (opts.includePending !== false);
    var list = billTypesForSelect(opts);
    sel.innerHTML = '';

    var defaultFound = false;
    list.forEach(function (bt) {
        var val = billTypeOptionValue(bt);
        if (!val) return;
        var opt = document.createElement('option');
        opt.value = val;
        opt.textContent = billTypeDisplayLabel(bt, true);
        if (bt.color_hex) opt.style.color = bt.color_hex;
        if (markDefault && bt.is_default && !defaultFound) {
            opt.selected = true;
            defaultFound = true;
        }
        sel.appendChild(opt);
    });

    if (!sel.options.length) {
        appendBillTypeFallbackOptions(sel);
        if (markDefault && sel.options.length) {
            sel.options[0].selected = true;
        }
    } else if (markDefault && !defaultFound) {
        sel.options[0].selected = true;
    }

    (opts.extraValues || []).forEach(function (v) {
        ensureBillTypeOptionExists(sel, v);
    });

    if (includePending) ensurePendingBillTypeOption(sel);
}

function refreshBillPaymentSelectLabels() {
    populateAllBillPaymentSelects({ markDefault: false });
}

function loadBillTypes(opts) {
    opts = opts || {};
    var sel = g('bType');
    if (sel) {
        sel.innerHTML = '<option value="">' + esc(tr('bill.loadingTypes')) + '</option>';
    }
    var apSel = g('apMethod');
    if (apSel && !sel) {
        apSel.innerHTML = '<option value="">' + esc(tr('bill.loadingTypes')) + '</option>';
    }

    return ensureBillTypesLoaded(function () {
        populateAllBillPaymentSelects({
            markDefault: true,
            markApDefault: true,
            extraValues: opts.extraValues
        });
    }, opts.force === true);
}

window.invalidateBillTypesCache = invalidateBillTypesCache;
window.prefetchBillTypes = prefetchBillTypes;
window.ensureBillTypesLoaded = ensureBillTypesLoaded;
window.findBillTypeRow = findBillTypeRow;
window.billTypeDisplayLabel = billTypeDisplayLabel;

// Loads all bills for the current patient (same query shape as Consultation → Bill).
function billHistoryRangeMode() {
    var picked = document.querySelector('input[name="billHistoryRange"]:checked');
    return picked ? picked.value : 'all';
}

function billBillDateIso(b) {
    var raw = String(b && b.bill_date ? b.bill_date : '').trim();
    if (!raw) return '';
    if (raw.length >= 10 && raw.indexOf('-') >= 0) return raw.slice(0, 10);
    return raw;
}

/** Bill History panel — bills with line items, payments, or voided rows. */
function billEligibleForPatientHistory(b) {
    if (!b || !b.id) return false;
    if (billRecordIsVoid(b)) return true;
    var total = parseFloat(b.total) || 0;
    if (total > 0.005) return true;
    return billHistoryDisplayPaid(b) > 0.005;
}

function filterBillHistoryEligible(list) {
    return (list || []).filter(billEligibleForPatientHistory);
}

function filterBillHistoryByRange(list) {
    var mode = billHistoryRangeMode();
    var today = typeof todayISO === 'function' ? todayISO() : '';
    var rows = (list || []).slice();
    if (mode === 'today') {
        return rows.filter(function(b) { return billBillDateIso(b) === today; });
    }
    if (mode === 'dated') {
        var fromEl = g('billHistoryFrom');
        var toEl = g('billHistoryTo');
        var from = (fromEl && fromEl.value) ? fromEl.value : billHistoryFilterFrom;
        var to = (toEl && toEl.value) ? toEl.value : billHistoryFilterTo;
        if (from && to && from > to) {
            var swap = from;
            from = to;
            to = swap;
        }
        return rows.filter(function(b) {
            var dk = billBillDateIso(b);
            if (!dk) return false;
            if (from && dk < from) return false;
            if (to && dk > to) return false;
            return true;
        });
    }
    return rows;
}

function applyBillHistoryFilter() {
    var wrap = g('billHistoryList');
    if (!wrap) return;
    if (!billHistoryCache.length) {
        wrap.innerHTML =
            '<p style="color:#aaa;font-size:14px;">' + esc(tr('bill.historyEmpty')) + '</p>';
        return;
    }
    var filtered = filterBillHistoryByRange(billHistoryCache);
    if (!filtered.length) {
        wrap.innerHTML =
            '<p style="color:#aaa;font-size:14px;">' + esc(tr('bill.history.emptyFilter')) + '</p>';
        return;
    }
    renderBillHistoryRows(wrap, filtered);
}

function syncBillHistoryRangeUi() {
    var datedWrap = g('billHistoryDatedWrap');
    var mode = billHistoryRangeMode();
    if (datedWrap) datedWrap.classList.toggle('hidden', mode !== 'dated');
    if (mode === 'dated') {
        var today = typeof todayISO === 'function' ? todayISO() : '';
        var fromEl = g('billHistoryFrom');
        var toEl = g('billHistoryTo');
        if (fromEl && !fromEl.value) fromEl.value = billHistoryFilterFrom || today;
        if (toEl && !toEl.value) toEl.value = billHistoryFilterTo || today;
        if (fromEl && fromEl.value) billHistoryFilterFrom = fromEl.value;
        if (toEl && toEl.value) billHistoryFilterTo = toEl.value;
    }
    applyBillHistoryFilter();
}

function resetBillHistoryFilterUi() {
    var today = typeof todayISO === 'function' ? todayISO() : '';
    billHistoryFilterFrom = today;
    billHistoryFilterTo = today;
    var allRadio = document.querySelector('input[name="billHistoryRange"][value="all"]');
    if (allRadio) allRadio.checked = true;
    var fromEl = g('billHistoryFrom');
    var toEl = g('billHistoryTo');
    if (fromEl) fromEl.value = today;
    if (toEl) toEl.value = today;
    var datedWrap = g('billHistoryDatedWrap');
    if (datedWrap) datedWrap.classList.add('hidden');
}

function billHistoryPrintScopeText() {
    var mode = billHistoryRangeMode();
    if (mode === 'today') return tr('bill.history.filterToday');
    if (mode === 'dated') {
        var fromEl = g('billHistoryFrom');
        var toEl = g('billHistoryTo');
        var from = (fromEl && fromEl.value) ? fromEl.value : billHistoryFilterFrom;
        var to = (toEl && toEl.value) ? toEl.value : billHistoryFilterTo;
        var fromDisp = from;
        var toDisp = to;
        if (typeof fmtDateLong === 'function') {
            if (from) fromDisp = fmtDateLong(from);
            if (to) toDisp = fmtDateLong(to);
        }
        return trRepl('bill.history.printScopeDated', {
            FROM: fromDisp || '—',
            TO: toDisp || '—'
        });
    }
    return tr('bill.history.filterAll');
}

function billHistoryPrintDateDisplay(iso) {
    if (!iso) return '—';
    if (typeof fmtDateLong === 'function') {
        var day = String(iso).indexOf('T') >= 0 ? String(iso).split('T')[0] : String(iso).slice(0, 10);
        if (day.length >= 10) return fmtDateLong(day);
    }
    return String(iso);
}

function billHistoryPrintFontFamilyCss(key) {
    var map = {
        system: '"Segoe UI", Arial, Helvetica, sans-serif',
        arial: 'Arial, Helvetica, sans-serif',
        times: '"Times New Roman", Times, serif',
        ming: '"PMingLiU", "MingLiU", "SimSun", serif',
        yahei: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif'
    };
    return map[key] || map.system;
}

var BILL_HISTORY_PRINT_OPTS_KEY = 'bill_history_print_options_v1';
var _billHistoryPrintPendingBills = null;
var _bhpPreviewTimer = null;

function defaultBillHistoryPrintOptions() {
    return {
        fontFamily: 'system',
        bodyFontSize: 14,
        titleFontSize: 22,
        thFontSize: 12,
        boldText: false,
        scalePercent: 100
    };
}

function loadBillHistoryPrintOptions() {
    var defs = defaultBillHistoryPrintOptions();
    try {
        var raw = localStorage.getItem(BILL_HISTORY_PRINT_OPTS_KEY);
        if (!raw) return defs;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return defs;
        Object.keys(defs).forEach(function(k) {
            if (parsed[k] !== undefined && typeof parsed[k] === typeof defs[k]) {
                defs[k] = parsed[k];
            }
        });
    } catch (_) {}
    return defs;
}

function saveBillHistoryPrintOptions(opts) {
    var persist = defaultBillHistoryPrintOptions();
    Object.keys(persist).forEach(function(k) {
        if (opts[k] !== undefined && typeof opts[k] === typeof persist[k]) {
            persist[k] = opts[k];
        }
    });
    try {
        localStorage.setItem(BILL_HISTORY_PRINT_OPTS_KEY, JSON.stringify(persist));
    } catch (_) {}
}

function populateBillHistoryPrintSizeSelect(el, values, suffix) {
    if (!el || el.dataset.bhpPopulated === '1') return;
    el.dataset.bhpPopulated = '1';
    values.forEach(function(n) {
        var o = document.createElement('option');
        o.value = String(n);
        o.textContent = String(n) + (suffix || '');
        el.appendChild(o);
    });
}

function populateBillHistoryPrintSizeSelects() {
    populateBillHistoryPrintSizeSelect(g('bhpBodySize'),
        [10, 11, 12, 13, 14, 15, 16, 18, 20], ' pt');
    populateBillHistoryPrintSizeSelect(g('bhpTitleSize'),
        [16, 18, 20, 22, 24, 26, 28], ' pt');
    populateBillHistoryPrintSizeSelect(g('bhpThSize'),
        [10, 11, 12, 13, 14, 15, 16], ' pt');
    populateBillHistoryPrintSizeSelect(g('bhpScalePercent'),
        [80, 90, 100, 110, 120, 130, 140, 150], '%');
}

function readBillHistoryPrintOptionsFromForm() {
    var opts = defaultBillHistoryPrintOptions();
    var fam = g('bhpFontFamily');
    if (fam && fam.value) opts.fontFamily = fam.value;
    opts.bodyFontSize = parseInt(g('bhpBodySize') && g('bhpBodySize').value, 10) ||
        opts.bodyFontSize;
    opts.titleFontSize = parseInt(g('bhpTitleSize') && g('bhpTitleSize').value, 10) ||
        opts.titleFontSize;
    opts.thFontSize = parseInt(g('bhpThSize') && g('bhpThSize').value, 10) ||
        opts.thFontSize;
    opts.scalePercent = parseInt(g('bhpScalePercent') && g('bhpScalePercent').value, 10) ||
        opts.scalePercent;
    opts.boldText = !!(g('bhpBoldText') && g('bhpBoldText').checked);
    return opts;
}

function applyBillHistoryPrintOptionsToForm(opts) {
    opts = opts || loadBillHistoryPrintOptions();
    if (g('bhpFontFamily')) g('bhpFontFamily').value = opts.fontFamily || 'system';
    if (g('bhpBodySize')) g('bhpBodySize').value = String(opts.bodyFontSize || 14);
    if (g('bhpTitleSize')) g('bhpTitleSize').value = String(opts.titleFontSize || 22);
    if (g('bhpThSize')) g('bhpThSize').value = String(opts.thFontSize || 12);
    if (g('bhpScalePercent')) g('bhpScalePercent').value = String(opts.scalePercent || 100);
    if (g('bhpBoldText')) g('bhpBoldText').checked = !!opts.boldText;
}

function billHistoryPrintRowLabel(b) {
    var voided = billRecordIsVoid(b);
    var typeLbl = (typeof dispPayMethod === 'function')
        ? dispPayMethod(b.bill_type)
        : (b.bill_type || '—');
    var doctor = b.doctor_tag || b.doctor_name || '';
    var dateDisp = billHistoryPrintDateDisplay(b.bill_date);
    var statusTxt = voided
        ? tr('bill.detail.voidBadge')
        : dispStatusLabel(b.status || '');
    var main = fmtHK(b.total) + ' · ' + dateDisp;
    var meta = typeLbl +
        (doctor ? (' · ' + doctor) : '') +
        ' · ' + statusTxt;
    return { main: main, meta: meta, voided: voided };
}

function billHistoryPrintBillKey(b, idx) {
    return b && b.id ? String(b.id) : ('idx-' + idx);
}

function renderBillHistoryPrintBillList(bills) {
    var list = g('bhpBillList');
    if (!list) return;
    list.innerHTML = '';
    (bills || []).forEach(function(b, idx) {
        var key = billHistoryPrintBillKey(b, idx);
        var lbl = billHistoryPrintRowLabel(b);
        var row = document.createElement('label');
        row.className = 'bh-print-bill-item' +
            (lbl.voided ? ' bh-print-bill-item--void' : '');
        row.innerHTML =
            '<input type="checkbox" class="bhp-bill-cb" value="' + esc(key) + '" checked>' +
            '<div><div class="bh-print-bill-item-main">' + esc(lbl.main) + '</div>' +
            '<div class="bh-print-bill-item-meta">' + esc(lbl.meta) + '</div></div>';
        list.appendChild(row);
    });
}

function getBillHistoryPrintSelectedBills() {
    var out = [];
    var list = g('bhpBillList');
    if (!list || !_billHistoryPrintPendingBills) return out;
    list.querySelectorAll('.bhp-bill-cb:checked').forEach(function(cb) {
        var val = cb.value;
        _billHistoryPrintPendingBills.forEach(function(b, idx) {
            if (billHistoryPrintBillKey(b, idx) === val) out.push(b);
        });
    });
    return out;
}

function setAllBillHistoryPrintChecks(checked) {
    var list = g('bhpBillList');
    if (!list) return;
    list.querySelectorAll('.bhp-bill-cb').forEach(function(cb) {
        cb.checked = !!checked;
    });
    scheduleBillHistoryPrintPreview();
}

function scheduleBillHistoryPrintPreview() {
    clearTimeout(_bhpPreviewTimer);
    _bhpPreviewTimer = setTimeout(refreshBillHistoryPrintPreview, 120);
}

function refreshBillHistoryPrintPreview() {
    var preview = g('bhpPreview');
    var scroll = g('bhpPreviewScroll');
    if (!preview) return;
    var bills = getBillHistoryPrintSelectedBills();
    if (!bills.length) {
        preview.style.transform = '';
        preview.style.width = '';
        preview.innerHTML =
            '<p style="padding:24px;color:#888;text-align:center;font-size:14px;">' +
            esc(tr('bill.history.printNoneSelected')) + '</p>';
        return;
    }
    var opts = readBillHistoryPrintOptionsFromForm();
    preview.innerHTML = buildBillHistoryPrintHtml(bills, opts);
    preview.style.transform = '';
    preview.style.width = '100%';
    if (!scroll) return;
    requestAnimationFrame(function() {
        var sw = Math.max(1, scroll.clientWidth - 24);
        var pw = preview.scrollWidth;
        if (pw > sw) {
            var sc = sw / pw;
            preview.style.transform = 'scale(' + sc + ')';
            preview.style.width = (100 / sc) + '%';
        }
    });
}

function wireBillHistoryPrintOptionInputs() {
    ['bhpFontFamily', 'bhpTitleSize', 'bhpBodySize', 'bhpThSize', 'bhpScalePercent'].forEach(function(id) {
        var el = g(id);
        if (!el || el.dataset.bhpInputWired === '1') return;
        el.dataset.bhpInputWired = '1';
        el.addEventListener('change', scheduleBillHistoryPrintPreview);
    });
    var bold = g('bhpBoldText');
    if (bold && bold.dataset.bhpInputWired !== '1') {
        bold.dataset.bhpInputWired = '1';
        bold.addEventListener('change', scheduleBillHistoryPrintPreview);
    }
    var list = g('bhpBillList');
    if (list && list.dataset.bhpInputWired !== '1') {
        list.dataset.bhpInputWired = '1';
        list.addEventListener('change', scheduleBillHistoryPrintPreview);
    }
}

function openBillHistoryPrintModal(bills) {
    _billHistoryPrintPendingBills = (bills || []).slice();
    populateBillHistoryPrintSizeSelects();
    applyBillHistoryPrintOptionsToForm(loadBillHistoryPrintOptions());
    renderBillHistoryPrintBillList(_billHistoryPrintPendingBills);
    var modal = g('billHistoryPrintModal');
    if (modal) {
        modal.classList.add('bh-print-modal-visible');
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(modal);
    }
    scheduleBillHistoryPrintPreview();
    openModal('billHistoryPrintModal');
}

function dismissBillHistoryPrintModal() {
    _billHistoryPrintPendingBills = null;
    var modal = g('billHistoryPrintModal');
    if (modal) modal.classList.remove('bh-print-modal-visible');
    closeModal('billHistoryPrintModal');
}

function executeBillHistoryPrint(bills, opts) {
    if (!bills || !bills.length) return;
    var bodyHtml = buildBillHistoryPrintHtml(bills, opts);
    var cid = (typeof currentClinicId !== 'undefined' && currentClinicId)
        ? String(currentClinicId) : '';
    if (typeof CFG !== 'undefined' && CFG && typeof CFG.prefetchPrintSettings === 'function') {
        CFG.prefetchPrintSettings(cid);
    }
    var printRow = null;
    if (typeof CFG !== 'undefined' && CFG && typeof CFG.getPrintSettingsForDoc === 'function') {
        printRow = CFG.getPrintSettingsForDoc('bill', cid);
        if (printRow) {
            printRow = Object.assign({}, printRow, {
                scale_percent: opts.scalePercent || 100
            });
        }
    }
    if (typeof CFG !== 'undefined' && CFG && typeof CFG.openContentPrintPopup === 'function') {
        var ok = CFG.openContentPrintPopup({
            title: tr('bill.history.printTitle'),
            bodyHtml: bodyHtml,
            docType: 'bill',
            clinicId: cid,
            printRow: printRow,
            skipConfirm: true
        });
        if (!ok) alert(tr('bill.receipt.popupBlocked'));
        return;
    }
    var popup = window.open('', '_blank', 'width=820,height=900,scrollbars=1,resizable=1');
    if (!popup) {
        alert(tr('bill.receipt.popupBlocked'));
        return;
    }
    popup.document.write(
        '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' +
        esc(tr('bill.history.printTitle')) + '</title></head><body>' + bodyHtml +
        '<script>' +
        (typeof printPopupAutoCloseInlineScript === 'function' ? printPopupAutoCloseInlineScript() : '') +
        'window.onload=function(){setTimeout(function(){try{window.print();}catch(e){if(typeof __ppClose==="function")__ppClose();}},300);};' +
        '<\/script></body></html>'
    );
    popup.document.close();
    if (typeof wirePrintPopupAutoClose === 'function') wirePrintPopupAutoClose(popup);
}

function confirmBillHistoryPrint() {
    var bills = getBillHistoryPrintSelectedBills();
    if (!bills.length) {
        alert(tr('bill.history.printNoneSelected'));
        return;
    }
    var opts = readBillHistoryPrintOptionsFromForm();
    saveBillHistoryPrintOptions(opts);
    if (typeof confirmPrintReminder === 'function' && !confirmPrintReminder()) return;
    dismissBillHistoryPrintModal();
    executeBillHistoryPrint(bills, opts);
}

function buildBillHistoryPrintHtml(bills, opts) {
    opts = opts || defaultBillHistoryPrintOptions();
    var bodyPt = Math.max(9, parseInt(opts.bodyFontSize, 10) || 14);
    var titlePt = Math.max(12, parseInt(opts.titleFontSize, 10) || 22);
    var thPt = Math.max(9, parseInt(opts.thFontSize, 10) || 12);
    var metaPt = Math.max(9, bodyPt - 1);
    var fontFamily = billHistoryPrintFontFamilyCss(opts.fontFamily);
    var bodyWeight = opts.boldText ? '600' : '400';
    var thWeight = opts.boldText ? '800' : '700';
    var cellPad = Math.max(5, Math.round(bodyPt * 0.45)) + 'px ' +
        Math.max(6, Math.round(bodyPt * 0.55)) + 'px';
    var scope = billHistoryPrintScopeText();
    var patName = String(billPatName || '').trim() || '—';
    var patNo = String(billPatNo || '').trim();
    var clinicLbl = (typeof currentClinicLabel === 'string' && currentClinicLabel.trim())
        ? currentClinicLabel.trim() : '';
    var whenStr = new Date().toLocaleString(
        typeof apptDateLocale === 'function' ? apptDateLocale() : 'en-HK',
        { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    );
    var sumTotal = 0;
    var sumPaid = 0;
    var sumBal = 0;
    var rowsHtml = '';

    bills.forEach(function(b, idx) {
        var voided = billRecordIsVoid(b);
        var ref = b.id ? String(b.id).slice(0, 8).toUpperCase() : '—';
        var typeLbl = (typeof dispPayMethod === 'function')
            ? dispPayMethod(b.bill_type)
            : (b.bill_type || '—');
        var doctor = b.doctor_tag || b.doctor_name || '—';
        var total = parseFloat(b.total) || 0;
        var paid = billHistoryDisplayPaid(b);
        var bal = parseFloat(b.balance) || 0;
        if (!voided) {
            sumTotal += total;
            sumPaid += paid;
            sumBal += bal;
        }
        var statusTxt = voided
            ? tr('bill.detail.voidBadge')
            : dispStatusLabel(b.status || '');
        var rowStyle = voided
            ? 'color:#64748b;background:#f1f5f9;'
            : ((idx % 2 === 1) ? 'background:#f8fafc;' : '');
        rowsHtml +=
            '<tr style="' + rowStyle + '">' +
            '<td style="padding:' + cellPad + ';border-bottom:1px solid #e2e8f0;">' +
                esc(billHistoryPrintDateDisplay(b.bill_date)) + '</td>' +
            '<td style="padding:' + cellPad + ';border-bottom:1px solid #e2e8f0;">' + esc(ref) + '</td>' +
            '<td style="padding:' + cellPad + ';border-bottom:1px solid #e2e8f0;">' + esc(typeLbl) + '</td>' +
            '<td style="padding:' + cellPad + ';border-bottom:1px solid #e2e8f0;">' + esc(doctor) + '</td>' +
            '<td style="padding:' + cellPad + ';border-bottom:1px solid #e2e8f0;text-align:right;' +
                (voided ? 'text-decoration:line-through;' : '') + '">' + esc(fmt2(total)) + '</td>' +
            '<td style="padding:' + cellPad + ';border-bottom:1px solid #e2e8f0;text-align:right;' +
                (voided ? 'text-decoration:line-through;' : '') + '">' + esc(fmt2(paid)) + '</td>' +
            '<td style="padding:' + cellPad + ';border-bottom:1px solid #e2e8f0;text-align:right;' +
                (voided ? 'text-decoration:line-through;' : '') + '">' + esc(fmt2(bal)) + '</td>' +
            '<td style="padding:' + cellPad + ';border-bottom:1px solid #e2e8f0;">' + esc(statusTxt) + '</td>' +
            '</tr>';
    });

    return (
        '<style>' +
        '.bh-print-root{font-family:' + fontFamily + ';color:#111;}' +
        '.bh-print-hdr{margin-bottom:14px;border-bottom:2px solid #0d6efd;padding-bottom:10px;}' +
        '.bh-print-hdr h1{margin:0 0 6px;font-size:' + titlePt + 'pt;font-weight:' + thWeight +
            ';color:#0d6efd;font-family:' + fontFamily + ';}' +
        '.bh-print-meta{font-size:' + metaPt + 'pt;color:#555;line-height:1.5;font-weight:' + bodyWeight + ';}' +
        '.bh-print-table{width:100%;border-collapse:collapse;font-size:' + bodyPt + 'pt;margin-top:8px;' +
            'font-family:' + fontFamily + ';font-weight:' + bodyWeight + ';}' +
        '.bh-print-table th{text-align:left;padding:' + cellPad +
            ';background:#1e3a5f;color:#fff;font-size:' + thPt + 'pt;font-weight:' + thWeight + ';}' +
        '.bh-print-table th.num{text-align:right;}' +
        '.bh-print-tfoot td{font-weight:' + thWeight + ';border-top:2px solid #1e3a5f;padding:' + cellPad + ';}' +
        '</style>' +
        '<div class="bh-print-root">' +
        '<div class="bh-print-hdr">' +
        '<h1>' + esc(tr('bill.history.printTitle')) + '</h1>' +
        '<div class="bh-print-meta">' +
        (clinicLbl ? ('<div>' + esc(clinicLbl) + '</div>') : '') +
        '<div><strong>' + esc(patName) + '</strong>' +
        (patNo && patNo !== '-' ? (' &nbsp;|&nbsp; #' + esc(patNo)) : '') + '</div>' +
        '<div>' + esc(trRepl('bill.history.printScope', { SCOPE: scope })) + '</div>' +
        '<div>' + esc(trRepl('bill.history.printCount', { N: String(bills.length) })) + '</div>' +
        '<div>' + esc(trRepl('bill.history.printPrintedOn', { WHEN: whenStr })) + '</div>' +
        '</div></div>' +
        '<table class="bh-print-table"><thead><tr>' +
        '<th>' + esc(tr('bill.history.printThDate')) + '</th>' +
        '<th>' + esc(tr('bill.history.printThRef')) + '</th>' +
        '<th>' + esc(tr('bill.history.printThType')) + '</th>' +
        '<th>' + esc(tr('bill.history.printThDoctor')) + '</th>' +
        '<th class="num">' + esc(tr('bill.history.printThTotal')) + '</th>' +
        '<th class="num">' + esc(tr('bill.history.printThPaid')) + '</th>' +
        '<th class="num">' + esc(tr('bill.history.printThBalance')) + '</th>' +
        '<th>' + esc(tr('bill.history.printThStatus')) + '</th>' +
        '</tr></thead><tbody>' + rowsHtml + '</tbody>' +
        '<tfoot><tr class="bh-print-tfoot">' +
        '<td colspan="4" style="text-align:right;">' + esc(tr('bill.history.printTotals')) + '</td>' +
        '<td style="text-align:right;">' + esc(fmt2(sumTotal)) + '</td>' +
        '<td style="text-align:right;">' + esc(fmt2(sumPaid)) + '</td>' +
        '<td style="text-align:right;">' + esc(fmt2(sumBal)) + '</td>' +
        '<td></td></tr></tfoot></table></div>'
    );
}

function printBillHistory() {
    try {
        if (billHistoryRangeMode() === 'dated') {
            var fromEl = g('billHistoryFrom');
            var toEl = g('billHistoryTo');
            if (fromEl && fromEl.value) billHistoryFilterFrom = fromEl.value;
            if (toEl && toEl.value) billHistoryFilterTo = toEl.value;
        }
        var bills = filterBillHistoryByRange(billHistoryCache || []);
        if (!bills.length) {
            alert(tr('bill.history.printEmpty'));
            return;
        }
        openBillHistoryPrintModal(bills);
    } catch (err) {
        console.error('printBillHistory', err);
        alert('Print failed: ' + (err && err.message ? err.message : String(err)));
    }
}
window.printBillHistory = printBillHistory;

function wireBillHistoryFilterUi() {
    document.querySelectorAll('input[name="billHistoryRange"]').forEach(function(el) {
        if (el.dataset.billHistFilterWired) return;
        el.dataset.billHistFilterWired = '1';
        el.addEventListener('change', syncBillHistoryRangeUi);
    });
    ['billHistoryFrom', 'billHistoryTo'].forEach(function(id) {
        var el = g(id);
        if (!el || el.dataset.billHistFilterWired) return;
        el.dataset.billHistFilterWired = '1';
        el.addEventListener('change', function() {
            billHistoryFilterFrom = g('billHistoryFrom') ? g('billHistoryFrom').value : '';
            billHistoryFilterTo = g('billHistoryTo') ? g('billHistoryTo').value : '';
            applyBillHistoryFilter();
        });
    });
}

function loadBillHistory(cb) {
    var wrap  = g('billHistoryList');
    var patId = billPatId;
    var patNo = billPatNo;
    var apptFallback = billApptId;

    var hasPatient = !!patId;
    var hasPatNoFallback = !!(patNo && patNo !== '-');

    if (!hasPatient && !hasPatNoFallback && !apptFallback) {
        billHistoryCache = [];
        wrap.innerHTML = '<p style="color:#aaa;font-size:14px;">' + esc(tr('bill.historyEmpty')) + '</p>';
        if (cb) cb(true);
        return;
    }
    wrap.innerHTML = '<p style="color:#aaa;font-size:13px;">' + esc(tr('bill.historyLoading')) + '</p>';

    function renderHistory(r) {
        if (r.error) {
            billHistoryCache = [];
            wrap.innerHTML =
                '<p style="color:#e11d48;font-size:13px;">⚠️ ' + esc(r.error.message) + '</p>';
            if (cb) cb(false);
            return;
        }
        billHistoryCache = filterBillHistoryEligible((r.data && r.data.length) ? r.data : []);
        if (!billHistoryCache.length) {
            wrap.innerHTML = '<p style="color:#aaa;font-size:14px;">' + esc(tr('bill.historyEmpty')) + '</p>';
            if (cb) cb(true);
            return;
        }
        applyBillHistoryFilter();
        if (cb) cb(true);
    }

    if (hasPatient) {
        SB.from('bills').select('*')
            .eq('patient_id', patId)
            .order('created_at', { ascending: false })
        .then(function(r) {
            if (r.error && hasPatNoFallback &&
                (String(r.error.message || '').toLowerCase().indexOf('patient_id') >= 0)) {
                SB.from('bills').select('*')
                    .eq('patient_no', patNo)
                    .order('created_at', { ascending: false })
                .then(renderHistory)
                .catch(function() {
                    if (cb) cb(false);
                });
                return;
            }
            renderHistory(r);
        })
        .catch(function() {
            if (cb) cb(false);
        });
        return;
    }

    if (hasPatNoFallback) {
        SB.from('bills').select('*')
            .eq('patient_no', patNo)
            .order('created_at', { ascending: false })
        .then(renderHistory)
        .catch(function() {
            if (cb) cb(false);
        });
        return;
    }

    // Rare: queued row missing patient linkage — still show bills for this visit only
    SB.from('bills').select('*')
        .eq('appointment_id', apptFallback)
        .order('created_at', { ascending: false })
    .then(renderHistory)
    .catch(function() {
        if (cb) cb(false);
    });
}

function refreshBillHistory() {
    if (!billPatId && (!billPatNo || billPatNo === '-') && !billApptId) return;
    loadBillHistory();
}

function billRecordIsVoid(b) {
    return !!(b && b.voided_at);
}

function billVoidedAtDisplay(iso) {
    if (!iso) return '—';
    var raw = String(iso).trim();
    if (!raw) return '—';
    var dt = new Date(raw);
    if (isNaN(+dt)) return '—';
    if (typeof fmtDateLong === 'function') {
        var day = raw.indexOf('T') >= 0 ? raw.split('T')[0] : raw.slice(0, 10);
        if (day.length >= 10) return fmtDateLong(day);
    }
    var loc = typeof apptDateLocale === 'function' ? apptDateLocale() : 'en-HK';
    return dt.toLocaleDateString(loc, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
}

function billVoidedByLine(record) {
    var by = String(record && record.voided_by ? record.voided_by : '').trim();
    if (by) {
        return trRepl('bill.detail.voidedBy', { NAME: by });
    }
    return tr('bill.detail.voidedByUnknown');
}

function billVoidedDateLine(record) {
    return trRepl('bill.detail.voidedOn', {
        DATE: billVoidedAtDisplay(record && record.voided_at)
    });
}

function billVoidedMetaHtml(record) {
    return '<span class="bill-pay-void-by">' + esc(billVoidedByLine(record)) + '</span>' +
        '<span class="bill-pay-void-date">' + esc(billVoidedDateLine(record)) + '</span>';
}

function refreshBillDetailVoidMeta(b) {
    var el = g('bdVoidMeta');
    if (!el) return;
    if (!b || !billRecordIsVoid(b)) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    el.classList.remove('hidden');
    el.innerHTML =
        '<span class="bill-pay-void-badge">' + esc(tr('bill.detail.voidBadge')) + '</span>' +
        billVoidedMetaHtml(b);
}

function billPaymentDateCellHtml(p, voided) {
    if (!voided) {
        return esc(p.paid_date || '—');
    }
    return '<span class="bill-pay-paid-date-struck">' + esc(p.paid_date || '—') + '</span>' +
        '<span class="bill-pay-void-date">' + esc(billVoidedDateLine(p)) + '</span>';
}

function billHistoryDisplayPaid(b) {
    var paid = parseFloat(b && b.amount_paid);
    if (!isNaN(paid) && paid > 0) return paid;
    var total = parseFloat(b && b.total) || 0;
    var balance = parseFloat(b && b.balance) || 0;
    if (total > 0 && balance >= 0 && balance < total - 0.005) {
        return Math.max(0, total - balance);
    }
    return isNaN(paid) ? 0 : paid;
}

function renderBillHistoryRows(wrap, data) {
    wrap.innerHTML = '';
    data.forEach(function(b) {
            var drTag   = b.doctor_tag || b.doctor_name || '';
            var canVoidBill = canModifyBill();
            var voided  = billRecordIsVoid(b);
            var div = document.createElement('div');
            div.className = voided ? 'bill-history-row bill-history-row--void' : 'bill-history-row';
            var isPartial = !voided && (
                b.status === 'Partial' ||
                b.status === 'Pending' ||
                (parseFloat(b.balance) > 0.005)
            );
            if (!voided) {
                div.style.cssText =
                    'background:' + (isPartial ? '#fffbeb' : '#f9f9f9') + ';' +
                    'border:1px solid ' + (isPartial ? '#fde047' : '#eee') + ';' +
                    'border-radius:8px;padding:12px 14px;margin-bottom:10px;';
            } else {
                div.style.cssText =
                    'border-radius:8px;padding:12px 14px;margin-bottom:10px;border-width:1px;border-style:solid;';
            }
            var voidHead = voided
                ? '<div class="bill-history-void-head">' +
                    '<span class="bill-pay-void-badge">' + esc(tr('bill.detail.voidBadge')) + '</span>' +
                    billVoidedMetaHtml(b) +
                  '</div>'
                : '';
            var amtClass = voided ? ' bill-history-amt' : '';
            var metaClass = voided ? ' bill-history-meta' : '';
            var statusHtml = voided
                ? '<span class="bill-history-status-void">' + esc(tr('bill.detail.voidBadge')) + '</span>'
                : '<span class="status-badge ' + statusClass(b.status) + '">' +
                    esc(dispStatusLabel(b.status)) + '</span>';
            var actionHtml =
                '<button class="bd-detail-btn btn-sm" ' +
                'style="background:var(--primary);color:#fff;border:none;padding:3px 11px;' +
                'border-radius:5px;font-size:12px;cursor:pointer;">' +
                esc(tr('bill.history.btnDetail')) + '</button>' +
                (isPartial
                    ? '<button class="bd-pay-btn btn-sm" ' +
                      'style="background:#16a34a;color:#fff;border:none;padding:3px 11px;' +
                      'border-radius:5px;font-size:12px;cursor:pointer;font-weight:700;">' +
                      esc(tr('bill.history.btnPay')) + '</button>'
                    : '') +
                (!voided
                    ? '<button class="bd-del-btn btn-sm" ' +
                      (canVoidBill
                          ? 'style="background:#dc2626;color:#fff;border:none;padding:3px 11px;' +
                            'border-radius:5px;font-size:12px;cursor:pointer;"'
                          : 'disabled style="background:#fca5a5;color:#fff;border:none;padding:3px 11px;' +
                            'border-radius:5px;font-size:12px;cursor:not-allowed;opacity:.6;"'
                      ) + '>' + esc(tr('bill.history.btnDelete')) + '</button>'
                    : '');
            div.innerHTML =
                voidHead +
                '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
                    '<strong class="' + amtClass.trim() + '" style="font-size:14px;">' +
                        fmtHK(b.total) +
                    '</strong>' +
                    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;">' +
                        statusHtml +
                        actionHtml +
                    '</div>' +
                '</div>' +
                '<div class="' + metaClass.trim() + '" style="font-size:12px;color:#888;">' +
                    esc(b.bill_date) +
                    ' &nbsp;|&nbsp; ' + esc((typeof dispPayMethod === 'function')
                        ? dispPayMethod(b.bill_type) : b.bill_type) +
                    (drTag ? (' &nbsp;|&nbsp; ' + esc(drTag)) : '') +
                    ' &nbsp;|&nbsp; ' + esc(trRepl('bill.history.paidBalance', {
                        PAID: fmt2(billHistoryDisplayPaid(b)),
                        BAL: fmt2(b.balance)
                    })) +
                '</div>';
            div.querySelector('.bd-detail-btn').addEventListener('click', function() {
                showBillDetail(b);
            });
            var payBtn = div.querySelector('.bd-pay-btn');
            if (payBtn) {
                payBtn.addEventListener('click', function() {
                    showBillDetail(b);
                    openAddPaymentModal();
                });
            }
            var delBtn = div.querySelector('.bd-del-btn');
            if (delBtn && canVoidBill) {
                delBtn.addEventListener('click', function() {
                    confirmDeleteBill(b);
                });
            }
            wrap.appendChild(div);
    });
}

// ════════════════════════════════════════════════════════════════
// DELETE BILL
// ════════════════════════════════════════════════════════════════
var bdDeleteTarget = null;

function refreshBillDeleteModalCopy(b) {
    if (!b) return;
    var ref  = b.id ? b.id.slice(0, 8).toUpperCase() : '?';
    var info = g('bdDeleteInfo');
    if (info) {
        info.textContent =
            trRepl('bill.delete.summary', {
                REF: ref,
                DATE: (b.bill_date || ''),
                TOTAL: fmt2(b.total),
                TYPE: (typeof dispPayMethod === 'function')
                    ? dispPayMethod(b.bill_type)
                    : (b.bill_type || '')
            }) +
            (b.doctor_tag || b.doctor_name
                ? trRepl('bill.delete.summaryDoctor', { DOCTOR: (b.doctor_tag || b.doctor_name) })
                : '');
    }
}

function confirmDeleteBill(b) {
    if (billRecordIsVoid(b)) return;
    if (!canModifyBill()) {
        if (typeof permToastDenied === 'function') permToastDenied();
        else alert(tr('bill.alertVoidBillDenied'));
        return;
    }
    bdDeleteTarget = b;
    refreshBillDeleteModalCopy(b);
    var inp = g('bdDeleteConfirmInput');
    if (inp) inp.value = '';
    var err = g('bdDeleteError');
    if (err) err.style.display = 'none';
    openModal('billDeleteModal');
}

function executeBillDelete() {
    if (!canModifyBill()) {
        if (typeof permToastDenied === 'function') permToastDenied();
        else alert(tr('bill.alertVoidBillDenied'));
        return;
    }
    var inp = g('bdDeleteConfirmInput');
    if (!inp || inp.value.trim().toUpperCase() !== 'DELETE') {
        var err = g('bdDeleteError');
        if (err) { err.textContent = tr('bill.delete.typeDeletePrompt'); err.style.display = 'block'; }
        return;
    }
    if (!bdDeleteTarget || !bdDeleteTarget.id) return;
    if (billRecordIsVoid(bdDeleteTarget)) return;

    var voidPayload = {
        voided_at: new Date().toISOString(),
        voided_by: (typeof currentName !== 'undefined' ? currentName : null)
    };

    SB.from('bills').update(voidPayload).eq('id', bdDeleteTarget.id)
    .then(function(r) {
        if (r.error) {
            var err = g('bdDeleteError');
            if (err) { err.textContent = trRepl('appt.msg.error', { MSG: r.error.message }); err.style.display = 'block'; }
            return;
        }
        closeModal('billDeleteModal');
        bdDeleteTarget = null;
        loadBillHistory();
        try { document.dispatchEvent(new CustomEvent('consultation-ar-refresh')); } catch (_) {}
    });
}

// ════════════════════════════════════════════════════════════════
// BILL DETAIL POPUP
// ════════════════════════════════════════════════════════════════
var bdCurrentBill = null;
var bdNotesEditing = false;
var bdNotesEditWired = false;

function canEditBillDetailNotes(b) {
    return !!(b && b.id && !billRecordIsVoid(b));
}

function billNotesPayloadFromUserEdit(userText, existingRaw) {
    var u = String(userText || '').trim();
    var existing = String(existingRaw || '').trim();
    if (billIsPendingLinkNote(existing) && !u) return existing;
    return u || null;
}

function refreshBillDetailNotesUI(b) {
    var viewEl = g('bdNotes');
    var inpEl = g('bdNotesInput');
    var editBtn = g('bdNotesEditBtn');
    var editBar = g('bdNotesEditBar');
    var errEl = g('bdNotesEditErr');
    if (!viewEl) return;
    var canEdit = canEditBillDetailNotes(b);
    var userNotes = b ? billUserNotesText(b.notes) : '';

    if (editBtn) {
        editBtn.classList.toggle('hidden', !canEdit || bdNotesEditing);
        if (typeof applyI18nInRoot === 'function') {
            applyI18nInRoot(editBtn.parentElement || editBtn);
        }
    }
    if (bdNotesEditing) {
        viewEl.classList.add('hidden');
        if (inpEl) {
            inpEl.classList.remove('hidden');
            inpEl.value = userNotes;
            if (typeof applyI18nInRoot === 'function') applyI18nInRoot(inpEl.parentElement || inpEl);
        }
        if (editBar) editBar.classList.remove('hidden');
    } else {
        viewEl.classList.remove('hidden');
        viewEl.textContent = userNotes || '—';
        if (inpEl) inpEl.classList.add('hidden');
        if (editBar) editBar.classList.add('hidden');
        if (errEl) {
            errEl.classList.add('hidden');
            errEl.textContent = '';
        }
    }
}

function wireBillDetailNotesEditOnce() {
    if (bdNotesEditWired) return;
    bdNotesEditWired = true;
    var editBtn = g('bdNotesEditBtn');
    var saveBtn = g('bdNotesSaveBtn');
    var cancelBtn = g('bdNotesCancelBtn');
    var inp = g('bdNotesInput');
    if (editBtn) {
        editBtn.addEventListener('click', function () {
            if (!canEditBillDetailNotes(bdCurrentBill)) return;
            bdNotesEditing = true;
            refreshBillDetailNotesUI(bdCurrentBill);
            var el = g('bdNotesInput');
            if (el) {
                try { el.focus(); } catch (_) {}
            }
        });
    }
    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            if (!bdCurrentBill || !bdCurrentBill.id) return;
            if (!canEditBillDetailNotes(bdCurrentBill)) return;
            var inpEl = g('bdNotesInput');
            var errEl = g('bdNotesEditErr');
            var userText = inpEl ? inpEl.value : '';
            var notesPayload = billNotesPayloadFromUserEdit(userText, bdCurrentBill.notes);
            saveBtn.disabled = true;
            if (errEl) {
                errEl.classList.add('hidden');
                errEl.textContent = '';
            }
            SB.from('bills').update({ notes: notesPayload }).eq('id', bdCurrentBill.id)
            .then(function (r) {
                saveBtn.disabled = false;
                if (r.error) {
                    if (errEl) {
                        errEl.textContent = r.error.message || tr('bill.detail.notesSaveFailed');
                        errEl.classList.remove('hidden');
                    }
                    return;
                }
                bdCurrentBill.notes = notesPayload;
                bdNotesEditing = false;
                refreshBillDetailNotesUI(bdCurrentBill);
                loadBillHistory();
            });
        });
    }
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            bdNotesEditing = false;
            refreshBillDetailNotesUI(bdCurrentBill);
        });
    }
    if (inp) {
        inp.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                bdNotesEditing = false;
                refreshBillDetailNotesUI(bdCurrentBill);
            }
        });
    }
}

function bdSet(id, val) {
    var e = g(id);
    if (e) e.textContent = (val === null || val === undefined) ? '—' : String(val);
}

function billDetailClinicCode(b) {
    var active = '';
    if (typeof currentClinicCodeForTagging === 'function') {
        active = String(currentClinicCodeForTagging() || '').trim();
    }
    if (!active) {
        var sel = g('appWorkingClinicSelect');
        var cid = sel && sel.value ? String(sel.value).trim() : '';
        if (typeof isWorkingClinicAllValue === 'function' && isWorkingClinicAllValue(cid)) {
            cid = '';
        }
        if (!cid && typeof currentClinicId !== 'undefined' && currentClinicId) {
            cid = String(currentClinicId).trim();
        }
        if (cid && typeof clinicRecordFromId === 'function') {
            var recActive = clinicRecordFromId(cid);
            if (recActive) active = String(recActive.clinic_code || recActive.id || '').trim();
        }
    }
    if (active) return active;

    if (!b) return '';
    var raw = String((b.clinic_tag || b.clinic_id || '')).trim();
    if (!raw) return '';
    var rec = null;
    if (typeof clinicRecordForReceiptByTagOrId === 'function') {
        rec = clinicRecordForReceiptByTagOrId(raw);
    }
    if (!rec && typeof clinicRecordFromId === 'function') {
        rec = clinicRecordFromId(raw);
    }
    if (rec) {
        return String(rec.clinic_code || rec.id || raw).trim();
    }
    return raw;
}

function printBillDetailReceipt() {
    if (!bdCurrentBill) return;
    var bill = bdCurrentBill;
    closeModal('billDetailModal');

    SB.from('bill_payments')
        .select('*')
        .eq('bill_id', bill.id)
        .order('paid_date',   { ascending: true })
        .order('created_at',  { ascending: true })
    .then(function(r) {
        var payments = billPaymentsActiveOnly((!r.error && r.data) ? r.data : []);
        payments = mergeBillPaymentHistoryWithBill(bill, payments);
        openReceiptPreviewDirect({
            bill: bill,
            insertedData: [{ id: bill.id }],
            payments: payments,
            autoPrint: false
        });
    });
}

function showBillDetail(b) {
    bdCurrentBill = b;
    bdNotesEditing = false;
    wireBillDetailNotesEditOnce();
    // Reference number
    var ref = b.id ? b.id.slice(0, 8).toUpperCase() : '—';
    bdSet('bdRef', ref);

    // Created timestamp
    var createdStr = '—';
    if (b.created_at) {
        var dt = new Date(b.created_at);
        createdStr = dt.toLocaleDateString(apptDateLocale(), {
            day: 'numeric', month: 'short', year: 'numeric'
        }) + '  ' + dt.toLocaleTimeString(apptDateLocale(), {
            hour: '2-digit', minute: '2-digit'
        });
    }
    bdSet('bdCreated', createdStr);

    // Status badge
    var badge = g('bdStatusBadge');
    if (badge) {
        if (billRecordIsVoid(b)) {
            badge.textContent = tr('bill.detail.voidBadge');
            badge.className = 'bill-history-status-void';
        } else {
            badge.textContent = dispStatusLabel(b.status) || '—';
            badge.className = 'status-badge ' + statusClass(b.status);
        }
    }
    refreshBillDetailVoidMeta(b);

    // Info fields
    bdSet('bdPatient',   b.patient_name || '—');
    bdSet('bdPatientNo', b.patient_no   || '—');
    bdSet('bdDate',      b.bill_date    || '—');
    bdSet('bdDoctor',    b.doctor_tag   || b.doctor_name || '—');
    bdSet('bdClinicCode', billDetailClinicCode(b) || '—');
    bdSet('bdType',      (typeof dispPayMethod === 'function') ? dispPayMethod(b.bill_type) : (b.bill_type || '—'));

    refreshBillDetailNotesUI(b);
    var notesWrap = document.querySelector('.bd-notes-wrap');
    if (notesWrap && typeof applyI18nInRoot === 'function') applyI18nInRoot(notesWrap);

    // Items table — zebra rows
    var items = [];
    try { items = JSON.parse(b.items || '[]'); } catch(e) {}
    var tbody = g('bdItemsBody');
    tbody.innerHTML = '';
    items.forEach(function(it, i) {
        var row = document.createElement('tr');
        var disc = parseFloat(it.disc) || 0;
        var amt  = billItemAmt(it);
        row.style.background = (i % 2 === 0) ? '#fff' : '#f0f5ff';
        row.innerHTML =
            '<td style="padding:9px 14px;color:#888;width:36px;">' + (i + 1) + '</td>' +
            '<td style="padding:9px 14px;">' + esc(it.desc || '—') + '</td>' +
            '<td style="padding:9px 14px;text-align:center;">' + (it.qty || 0) + '</td>' +
            '<td style="padding:9px 14px;text-align:right;">' + fmt2(it.price) + '</td>' +
            '<td style="padding:9px 14px;text-align:center;color:' + (disc > 0 ? '#dc2626' : '#aaa') + ';">' +
                (disc > 0 ? formatBillDiscPctDisplay(disc) + '%' : '—') +
            '</td>' +
            '<td style="padding:9px 14px;text-align:right;font-weight:600;">' + fmt2(amt) + '</td>';
        tbody.appendChild(row);
    });
    if (!items.length) {
        tbody.innerHTML =
            '<tr><td colspan="6" style="padding:14px;text-align:center;color:#aaa;">' +
            esc(tr('bill.detail.noItems')) + '</td></tr>';
    }

    // Totals
    var disc = parseFloat(b.discount)    || 0;
    var bal  = parseFloat(b.balance)     || 0;
    g('bdSubtotal').textContent = fmtHK(b.subtotal);
    g('bdDiscount').textContent = fmtHKNeg(disc);
    g('bdTotal').textContent    = fmtHK(b.total);
    g('bdPaid').textContent     = fmtHK(b.amount_paid);
    g('bdBalance').textContent  = fmtHK(bal);
    g('bdBalance').style.color  = bal > 0 ? 'var(--danger)' : '#16a34a';

    // Outstanding banner + Add Payment button (hidden for voided bills)
    var voidedBill = billRecordIsVoid(b);
    var banner = g('bdOutstandingBanner');
    var addBtn = g('bdAddPaymentBtn');
    if (banner) banner.style.display = (!voidedBill && bal > 0) ? 'block' : 'none';
    if (g('bdOutstandingAmt')) g('bdOutstandingAmt').textContent = fmtHK(bal);
    if (addBtn) addBtn.style.display = (!voidedBill && bal > 0) ? 'inline-block' : 'none';

    // Load payment history
    loadBillPayments(b.id);

    openModal('billDetailModal');
}

// ════════════════════════════════════════════════════════════════
// PAYMENT HISTORY
// ════════════════════════════════════════════════════════════════
function canVoidBillPayment() {
    return (typeof hasAppPermission !== 'function') || hasAppPermission('void_payment');
}

function canModifyBill() {
    return (typeof hasAppPermission !== 'function') || hasAppPermission('modify_bill');
}

function billPaymentIsVoid(p) {
    return !!(p && p.voided_at);
}

function billPaymentActiveAmountSum(rows) {
    return (rows || []).reduce(function(sum, x) {
        if (billPaymentIsVoid(x)) return sum;
        return sum + (parseFloat(x.amount) || 0);
    }, 0);
}

function billPaymentsActiveOnly(rows) {
    return (rows || []).filter(function(x) { return !billPaymentIsVoid(x); });
}

function billPendingMethodForHeader() {
    if (typeof billPendingPayTypeValue === 'function') return billPendingPayTypeValue();
    return 'Pending';
}

function billCurrentPaymentMethodFromRows(bill, rows) {
    var active = billPaymentsActiveOnly(rows || []);
    if (active.length) {
        return active[active.length - 1].method || (bill && bill.bill_type) || billPendingMethodForHeader();
    }
    if (bill && (parseFloat(bill.amount_paid) || 0) > 0.005 && bill.bill_type) {
        return bill.bill_type;
    }
    return billPendingMethodForHeader();
}

function refreshBillDetailPaymentMethod(method) {
    bdSet('bdType', (typeof dispPayMethod === 'function') ? dispPayMethod(method) : (method || '—'));
}

function stripBillPaymentClinicColsByError(src, errMsg) {
    var out = Object.assign({}, src);
    var msg = String(errMsg || '').toLowerCase();
    var touched = false;
    var mentionsTag = msg.indexOf('clinic_tag') >= 0;
    var mentionsCode = msg.indexOf('clinic_code') >= 0;
    var mentionsId = msg.indexOf('clinic_id') >= 0;
    if (mentionsTag && Object.prototype.hasOwnProperty.call(out, 'clinic_tag')) {
        delete out.clinic_tag;
        touched = true;
    }
    if (mentionsCode && Object.prototype.hasOwnProperty.call(out, 'clinic_code')) {
        delete out.clinic_code;
        touched = true;
    }
    if (mentionsId && Object.prototype.hasOwnProperty.call(out, 'clinic_id')) {
        delete out.clinic_id;
        touched = true;
    }
    return { payload: out, changed: touched };
}

function insertBillPaymentRecord(payRecord, cb) {
    SB.from('bill_payments').insert([payRecord]).then(function(ir) {
        if (!ir.error) {
            if (cb) cb(ir);
            return;
        }
        var stripped = stripBillPaymentClinicColsByError(payRecord, ir.error.message || '');
        if (!stripped.changed) {
            if (cb) cb(ir);
            return;
        }
        SB.from('bill_payments').insert([stripped.payload]).then(function(ir2) {
            if (cb) cb(ir2);
        });
    }).catch(function(err) {
        if (cb) cb({ error: err });
    });
}

/** Bills saved before bill_payments logging may only store the first instalment on the bill row. */
function mergeBillPaymentHistoryWithBill(bill, rows) {
    var pmts = (rows || []).slice();
    if (!bill) return pmts;
    var paidOnBill = parseFloat(bill.amount_paid) || 0;
    var sumPmts = billPaymentActiveAmountSum(pmts);
    var gap = paidOnBill - sumPmts;
    if (gap <= 0.005) return pmts;
    pmts.unshift({
        id: null,
        bill_id: bill.id,
        paid_date: bill.bill_date,
        amount: gap,
        method: bill.bill_type,
        notes: bill.notes,
        received_by: null,
        _fromBillRecord: true
    });
    return pmts;
}

function normalizeReceiptPayments(bill, payments) {
    return mergeBillPaymentHistoryWithBill(bill, billPaymentsActiveOnly(payments || []));
}

function appendBillPaymentHistoryRow(tbody, p, rowIndex) {
    var voided = billPaymentIsVoid(p);
    var row = document.createElement('tr');
    if (voided) {
        row.className = 'bill-pay-row--void';
    } else {
        row.style.background = rowIndex % 2 === 0 ? '#fff' : '#f8faff';
    }
    var statusCell = voided
        ? '<td style="padding:8px 10px;vertical-align:middle;">' +
            '<span class="bill-pay-void-badge">' + esc(tr('bill.detail.voidBadge')) + '</span>' +
            billVoidedMetaHtml(p) +
          '</td>'
        : '<td style="padding:8px 10px;color:#cbd5e1;font-size:11px;">—</td>';
    var amtClass = voided ? 'bill-pay-void-amt' : '';
    var amtColor = voided ? '' : 'color:#16a34a;';
    var canVoidPayment = !voided && p.id && !p._fromBillRecord && canVoidBillPayment();
    var actionCell = voided
        ? '<td style="padding:8px 10px;text-align:center;color:#cbd5e1;">—</td>'
        : (canVoidPayment
            ? '<td style="padding:8px 10px;text-align:center;">' +
                '<button class="bp-del-btn" data-id="' + esc(p.id) + '" ' +
                'title="' + esc(tr('bill.detail.deletePaymentTitle')) + '" ' +
                'style="background:none;border:none;color:#dc2626;' +
                'font-size:16px;cursor:pointer;line-height:1;padding:0;">×</button>' +
              '</td>'
            : '<td style="padding:8px 10px;text-align:center;color:#cbd5e1;">—</td>');
    var dateTdClass = voided ? ' bill-pay-void-date-col' : '';
    row.innerHTML =
        statusCell +
        '<td class="' + dateTdClass.trim() + '" style="padding:8px 12px;">' +
            billPaymentDateCellHtml(p, voided) + '</td>' +
        '<td style="padding:8px 12px;text-align:right;font-weight:700;' + amtColor + '">' +
            '<span class="' + amtClass + '">' + fmtHK(p.amount) + '</span></td>' +
        '<td style="padding:8px 12px;">' + esc((typeof dispPayMethod === 'function')
            ? dispPayMethod(p.method)
            : (p.method || '—')) + '</td>' +
        '<td style="padding:8px 12px;color:#888;">' +
            esc(p.received_by || '—') + '</td>' +
        '<td style="padding:8px 12px;color:#888;font-size:12px;">' +
            esc(p.notes || '') + '</td>' +
        actionCell;
    if (!voided) {
        var delBtn = row.querySelector('.bp-del-btn');
        if (delBtn) {
            delBtn.addEventListener('click', function() {
                voidPaymentRecord(p);
            });
        }
    }
    tbody.appendChild(row);
}

function refreshBillDetailPayments() {
    if (!bdCurrentBill || !bdCurrentBill.id) return;
    loadBillPayments(bdCurrentBill.id);
}

function loadBillPayments(billId) {
    var tbody = g('bdPaymentHistoryBody');
    if (!tbody) return;
    tbody.innerHTML =
        '<tr><td colspan="7" style="padding:12px;text-align:center;' +
        'color:#aaa;font-size:13px;">' + esc(tr('bill.historyLoading')) + '</td></tr>';

    SB.from('bill_payments')
        .select('*')
        .eq('bill_id', billId)
        .order('paid_date', { ascending: true })
        .order('created_at', { ascending: true })
    .then(function(r) {
        tbody.innerHTML = '';
        var rows = (!r.error && r.data) ? r.data : [];
        if (bdCurrentBill && bdCurrentBill.id === billId) {
            rows = mergeBillPaymentHistoryWithBill(bdCurrentBill, rows);
            var currentMethod = billCurrentPaymentMethodFromRows(bdCurrentBill, rows);
            bdCurrentBill.bill_type = currentMethod;
            refreshBillDetailPaymentMethod(currentMethod);
        }
        if (!rows.length) {
            tbody.innerHTML =
                '<tr><td colspan="7" style="padding:12px;text-align:center;' +
                'color:#aaa;font-size:13px;">' + esc(tr('bill.detail.noPayments')) + '</td></tr>';
            return;
        }
        rows.forEach(function(p, i) {
            appendBillPaymentHistoryRow(tbody, p, i);
        });
    });
}

// ── Open add-payment modal ──────────────────────────────
function openAddPaymentModal() {
    if (!bdCurrentBill) return;
    var bal = parseFloat(bdCurrentBill.balance) || 0;
    var summary = g('apBillSummary');
    if (summary) {
        summary.textContent =
            trRepl('bill.addPayment.summary', {
                REF: (bdCurrentBill.id || '').slice(0, 8).toUpperCase(),
                DATE: (bdCurrentBill.bill_date || ''),
                TOTAL: fmt2(bdCurrentBill.total)
            });
    }
    var balHint = g('apBalanceHint');
    if (balHint) balHint.textContent = fmtHK(bal);

    sv('apDate',   todayISO());
    sv('apAmount', fmt2(bal));   // default = full remaining balance
    sv('apNotes',  '');

    var methodSel = g('apMethod');
    if (methodSel) {
        methodSel.innerHTML = '<option value="">' + esc(tr('bill.loadingTypes')) + '</option>';
    }

    var errEl = g('apError');
    if (errEl) errEl.style.display = 'none';

    var legacyMethod = bdCurrentBill.bill_type || '';
    ensureBillTypesLoaded(function () {
        if (methodSel) {
            applyBillTypeOptions(methodSel, true, {
                forPayment: true,
                extraValues: legacyMethod ? [legacyMethod] : []
            });
        }
        openModal('addPaymentModal');
    });
}

function billPaymentClinicContext() {
    var clinicId = '';
    var clinicCode = '';
    var sel = g('appWorkingClinicSelect');
    if (sel && sel.value) clinicId = String(sel.value).trim();
    if (typeof isWorkingClinicAllValue === 'function' && isWorkingClinicAllValue(clinicId)) {
        clinicId = '';
    }
    if (!clinicId && typeof currentClinicId !== 'undefined' && currentClinicId) {
        clinicId = String(currentClinicId).trim();
    }
    if (typeof currentClinicCodeForTagging === 'function') {
        clinicCode = String(currentClinicCodeForTagging() || '').trim();
    }
    if (!clinicCode && clinicId && typeof clinicRecordFromId === 'function') {
        var rec = clinicRecordFromId(clinicId);
        if (rec) clinicCode = String(rec.clinic_code || rec.id || '').trim();
    }
    return {
        clinic_id: clinicId || null,
        clinic_tag: clinicCode || null,
        clinic_code: clinicCode || null
    };
}

// ── Confirm & save a new payment ────────────────────────
function confirmAddPayment() {
    if (!bdCurrentBill) return;
    var amount = parseFloat(g('apAmount').value) || 0;
    var errEl  = g('apError');

    if (amount <= 0) {
        if (errEl) { errEl.textContent = tr('bill.addPayment.errInvalidAmount'); errEl.style.display = ''; }
        return;
    }
    var bal = parseFloat(bdCurrentBill.balance) || 0;
    if (amount > bal + 0.005) {
        if (errEl) {
            errEl.textContent = trRepl('bill.addPayment.errExceedsBalance', { BAL: fmt2(bal) });
            errEl.style.display = '';
        }
        return;
    }
    if (errEl) errEl.style.display = 'none';

    var newPaid    = (parseFloat(bdCurrentBill.amount_paid) || 0) + amount;
    var newBalance = Math.max(0, (parseFloat(bdCurrentBill.total) || 0) - newPaid);
    var newStatus  = newBalance <= 0.005 ? 'Paid' : 'Partial';

    var payMethod = g('apMethod') ? String(g('apMethod').value || '').trim() : '';
    if (!payMethod) {
        if (errEl) { errEl.textContent = tr('bill.alert.selectPaymentMethod'); errEl.style.display = ''; }
        return;
    }

    var payRecord = {
        bill_id:     bdCurrentBill.id,
        paid_date:   g('apDate').value || todayISO(),
        amount:      amount,
        method:      payMethod,
        notes:       g('apNotes').value  || null,
        received_by: (typeof currentName !== 'undefined' ? currentName : null)
    };
    var clinicCtx = billPaymentClinicContext();
    payRecord.clinic_id = clinicCtx.clinic_id;
    payRecord.clinic_tag = clinicCtx.clinic_tag;
    payRecord.clinic_code = clinicCtx.clinic_code;

    insertBillPaymentRecord(payRecord, function(r) {
        if (r.error) {
            if (errEl) { errEl.textContent = trRepl('appt.msg.error', { MSG: r.error.message }); errEl.style.display = ''; }
            return;
        }
        // Update the parent bill's totals
        return SB.from('bills').update({
            amount_paid: newPaid,
            balance:     newBalance,
            status:      newStatus,
            bill_type:   payMethod
        }).eq('id', bdCurrentBill.id)
        .then(function(u) {
            if (u.error) {
                if (errEl) { errEl.textContent = trRepl('appt.msg.error', { MSG: u.error.message }); errEl.style.display = ''; }
                return;
            }
            // Refresh in-memory bill object
            bdCurrentBill.amount_paid = newPaid;
            bdCurrentBill.balance     = newBalance;
            bdCurrentBill.status      = newStatus;
            bdCurrentBill.bill_type   = payMethod;

            closeModal('addPaymentModal');

            // Refresh the detail view live
            g('bdPaid').textContent    = fmtHK(newPaid);
            g('bdBalance').textContent = fmtHK(newBalance);
            g('bdBalance').style.color = newBalance > 0 ? 'var(--danger)' : '#16a34a';
            refreshBillDetailPaymentMethod(payMethod);

            var badge = g('bdStatusBadge');
            if (badge) { badge.textContent = dispStatusLabel(newStatus); badge.className = 'status-badge ' + statusClass(newStatus); }

            var banner = g('bdOutstandingBanner');
            var addBtn = g('bdAddPaymentBtn');
            if (banner) banner.style.display = newBalance > 0 ? 'block' : 'none';
            if (g('bdOutstandingAmt')) g('bdOutstandingAmt').textContent = fmtHK(newBalance);
            if (addBtn)  addBtn.style.display = newBalance > 0 ? 'inline-block' : 'none';

            loadBillPayments(bdCurrentBill.id);
            loadBillHistory();
            try { document.dispatchEvent(new CustomEvent('consultation-ar-refresh')); } catch (_) {}

            if (newBalance <= 0.005) {
                var paidBillId = bdCurrentBill.id;
                resetBillCreationAfterPayment(paidBillId);
            }
        });
    });
}

function voidPaymentRecord(p) {
    if (!p || !p.id) return;
    if (billPaymentIsVoid(p)) return;
    if (!canVoidBillPayment()) {
        if (typeof permToastDenied === 'function') permToastDenied();
        else alert(tr('bill.alertVoidPaymentDenied'));
        return;
    }
    if (!confirm(trRepl('bill.deletePaymentConfirm', {
        AMT: fmt2(p.amount),
        DATE: (p.paid_date || '')
    }))) return;

    var voidPayload = {
        voided_at: new Date().toISOString(),
        voided_by: (typeof currentName !== 'undefined' ? currentName : null)
    };

    function applyVoidAndRecalc() {
        return SB.from('bill_payments')
            .select('amount, method, paid_date, created_at, voided_at')
            .eq('bill_id', p.bill_id)
            .order('paid_date', { ascending: true })
            .order('created_at', { ascending: true });
    }

    SB.from('bill_payments').update(voidPayload).eq('id', p.id)
    .then(function(r) {
        if (r.error) {
            alert(trRepl('appt.msg.error', { MSG: r.error.message }));
            return null;
        }
        return applyVoidAndRecalc();
    })
    .then(function(r) {
        if (!r || r.error) return;
        var newPaid    = billPaymentActiveAmountSum(r.data || []);
        var billTotal  = parseFloat(bdCurrentBill ? bdCurrentBill.total : 0) || 0;
        var newBalance = Math.max(0, billTotal - newPaid);
        var newStatus  = newBalance <= 0.005 ? 'Paid' : (newPaid > 0 ? 'Partial' : 'Unpaid');
        var nextBillType = newPaid > 0.005
            ? billCurrentPaymentMethodFromRows(bdCurrentBill, r.data || [])
            : billPendingMethodForHeader();

        return SB.from('bills').update({
            amount_paid: newPaid,
            balance:     newBalance,
            status:      newStatus,
            bill_type:   nextBillType
        }).eq('id', p.bill_id)
        .then(function(u) {
            if (u.error) return;
            if (bdCurrentBill && bdCurrentBill.id === p.bill_id) {
                bdCurrentBill.amount_paid = newPaid;
                bdCurrentBill.balance     = newBalance;
                bdCurrentBill.status      = newStatus;
                bdCurrentBill.bill_type   = nextBillType;

                g('bdPaid').textContent    = fmtHK(newPaid);
                g('bdBalance').textContent = fmtHK(newBalance);
                g('bdBalance').style.color = newBalance > 0 ? 'var(--danger)' : '#16a34a';
                refreshBillDetailPaymentMethod(nextBillType);

                var badge = g('bdStatusBadge');
                if (badge) { badge.textContent = dispStatusLabel(newStatus); badge.className = 'status-badge ' + statusClass(newStatus); }

                var banner = g('bdOutstandingBanner');
                var addBtn = g('bdAddPaymentBtn');
                if (banner) banner.style.display = newBalance > 0 ? 'block' : 'none';
                if (g('bdOutstandingAmt')) g('bdOutstandingAmt').textContent = fmtHK(newBalance);
                if (addBtn)  addBtn.style.display = newBalance > 0 ? 'inline-block' : 'none';

                loadBillPayments(p.bill_id);
                loadBillHistory();
                try { document.dispatchEvent(new CustomEvent('consultation-ar-refresh')); } catch (_) {}
            }
        });
    });
}

var _receiptPrintInProgress = false;
var RECEIPT_PRINT_MIN_SCALE_PCT = 80;

/**
 * Print typography tuned for A4: large enough to read easily, compact enough that a typical
 * receipt (header + ~8 lines + totals + signatures) fits one page before auto-fit scaling.
 */
var RECEIPT_PRINT_TOKENS = {
    body:       16,
    clinicH2:   30,
    clinicLine: 15,
    docTitle:   22,
    meta:       17,
    patientName: 21,
    table:      16,
    totals:     16,
    grand:      20,
    extra:      16,
    instal:     15,
    signName:   14,
    footerPadMm: 16,
    lh:         1.35
};

/** Upper bound for auto-fit (Configuration → Print → Bill → Scale %). Default 130%, max 180%. */
function receiptPrintMaxScalePercent(printRow) {
    var pct = 130;
    if (printRow && printRow.scale_percent != null) {
        var n = Number(printRow.scale_percent);
        if (isFinite(n) && n > 0) pct = n;
    }
    return Math.min(180, Math.max(100, Math.round(pct)));
}

function receiptPrintPageHeightPx(billPrintRow) {
    var pageH = 297;
    var mTop = 10;
    var mBottom = 12;
    if (typeof CFG !== 'undefined' && CFG) {
        if (CFG.printSheetDimensionsMm && billPrintRow) {
            var dim = CFG.printSheetDimensionsMm(billPrintRow);
            if (dim && dim.h) pageH = dim.h;
        }
        if (CFG.printMarginsMmFromRow) {
            var m = CFG.printMarginsMmFromRow(billPrintRow || {});
            mTop = m.t;
            mBottom = m.b;
        }
    }
    var printableMm = Math.max(120, pageH - mTop - mBottom);
    return printableMm * 96 / 25.4;
}

function receiptMeasureContentHeightPx(doc) {
    var area = doc.getElementById('receiptPrintArea');
    if (!area) return 0;
    area.style.zoom = '1';
    var root = doc.documentElement;
    var body = doc.body;
    var heights = [
        area.scrollHeight,
        area.offsetHeight,
        root ? root.scrollHeight : 0,
        body ? body.scrollHeight : 0
    ];
    return Math.max.apply(null, heights.filter(function (n) { return n > 0; }).concat([0]));
}

/**
 * Pick zoom so short receipts use up to max scale; longer ones shrink to one page;
 * very long receipts stop at min scale and may span multiple pages.
 */
function receiptAutoFitScalePercent(doc, billPrintRow) {
    var maxPct = receiptPrintMaxScalePercent(billPrintRow);
    var minPct = RECEIPT_PRINT_MIN_SCALE_PCT;
    var pageH = receiptPrintPageHeightPx(billPrintRow);
    var contentH = receiptMeasureContentHeightPx(doc);
    if (!contentH || !pageH) return maxPct;

    var idealPct = Math.floor((pageH / contentH) * 98);
    if (idealPct >= maxPct) return maxPct;
    if (idealPct >= minPct) return idealPct;
    return minPct;
}

function receiptApplyPrintScale(doc, scalePct) {
    var sc = (Math.max(50, scalePct) / 100).toFixed(2);
    var area = doc.getElementById('receiptPrintArea');
    if (area) area.style.zoom = sc;
    var existing = doc.getElementById('receiptPrintScaleStyle');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var style = doc.createElement('style');
    style.id = 'receiptPrintScaleStyle';
    style.textContent = '@media print{#receiptPrintArea{zoom:' + sc + ' !important;}}';
    if (doc.head) doc.head.appendChild(style);
}

/**
 * Receipt content-only CSS (no @page / sheet chrome). Sheet from CFG.buildPrintSheetStylesCss().
 * Print zoom is applied after layout via receiptAutoFitScalePercent().
 */
function receiptContentPrintStyles() {
    var t = RECEIPT_PRINT_TOKENS;
    var px = function (n) { return String(n) + 'px'; };
    return (
        '@page{size:A4 portrait;margin:10mm 10mm 12mm 10mm;}' +
        'body{font-family:"Times New Roman","Times","Noto Serif TC","PMingLiU",serif;' +
            'font-size:' + px(t.body) + ';line-height:' + t.lh + ';color:#111;margin:0;}' +
        '#receiptPrintArea{width:100%;max-width:186mm;min-height:0;margin:0 auto;padding:0;' +
            'box-sizing:border-box;display:flex;flex-direction:column;}' +
        '.receipt-header{text-align:center;margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid #222;}' +
        '.receipt-header h2{margin:0 0 3px;color:#111;font-size:' + px(t.clinicH2) +
            ';line-height:1.12;font-weight:700;letter-spacing:0.01em;}' +
        '.receipt-clinic-line{margin:0;color:#111;font-size:' + px(t.clinicLine) + ';line-height:1.3;}' +
        '.receipt-doc-title{margin:8px 0 0;padding-top:6px;border-top:1px solid #222;color:#111;' +
            'font-size:' + px(t.docTitle) + ';font-weight:400;}' +
        '.receipt-meta{display:flex;justify-content:space-between;align-items:flex-start;' +
            'font-size:' + px(t.meta) + ';margin-bottom:10px;line-height:' + t.lh +
            ';gap:12px;flex-wrap:nowrap;}' +
        '.receipt-meta-col{min-width:0;}' +
        '.receipt-meta-left-stack{flex:1;max-width:74%;text-align:left;padding:0;border:none;background:transparent;}' +
        '.receipt-meta-date-only{flex:0 0 auto;text-align:right;align-self:flex-start;}' +
        '.receipt-meta-spacer{height:6px;margin:2px 0 4px;}' +
        '.receipt-kv-row{display:flex;justify-content:flex-start;align-items:baseline;' +
            'gap:2px 6px;margin-bottom:3px;flex-wrap:nowrap;}' +
        '.receipt-kv-row:last-child{margin-bottom:0;}' +
        '.receipt-kv-row.receipt-kv-patient-names{margin-top:4px;}' +
        '.receipt-kv-row.receipt-kv-patient-names .receipt-kv-label,' +
        '.receipt-kv-row.receipt-kv-patient-names .receipt-kv-val,' +
        '.receipt-patient-en-line,.receipt-patient-zh-line{font-size:' + px(t.patientName) + ';font-weight:700;}' +
        '.receipt-meta-col strong,.receipt-kv-label{font-size:' + px(t.meta) +
            ';font-weight:400;color:#111;min-width:0;}' +
        '.receipt-kv-val{font-size:' + px(t.meta) + ';font-weight:400;color:#111;word-break:break-word;}' +
        '.receipt-meta-left-stack .receipt-kv-row{justify-content:flex-start;}' +
        '.receipt-meta-left-stack .receipt-kv-val{text-align:left;flex:0 1 auto;}' +
        '.receipt-meta-left-stack .receipt-kv-label{min-width:0;flex-shrink:0;color:#111;}' +
        '.receipt-meta-date-only .receipt-kv-row{justify-content:flex-end;}' +
        '.receipt-meta-date-only .receipt-kv-val{text-align:right;flex:0 1 auto;min-width:4.5rem;}' +
        '.receipt-kv-monospace{font-family:"Times New Roman","Times",serif;letter-spacing:0.01em;font-variant-numeric:tabular-nums;}' +
        '.receipt-table{width:100%;border-collapse:collapse;margin:10px 0 8px;font-size:' + px(t.table) + ';}' +
        '.receipt-table th{background:#fff;padding:4px 6px;text-align:left;font-size:' + px(t.table) +
            ';font-weight:700;color:#111;border-top:1px solid #222;border-bottom:1px solid #222;}' +
        '.receipt-table td{padding:3px 6px!important;border-bottom:none;font-size:' + px(t.table) +
            ';vertical-align:top;line-height:1.25;font-variant-numeric:tabular-nums;}' +
        '.receipt-table tbody tr:last-child td{border-bottom:1px solid #222;}' +
        '.receipt-table th:nth-child(2),.receipt-table th:nth-child(4),.receipt-table td:nth-child(2),.receipt-table td:nth-child(4){text-align:center;}' +
        '.receipt-table th:nth-child(3),.receipt-table th:nth-child(5),.receipt-table td:nth-child(3),.receipt-table td:nth-child(5){text-align:right;}' +
        '.receipt-totals{background:transparent;padding:6px 0 0;margin-top:0;font-size:' + px(t.totals) +
            ';border-top:1px solid #222;}' +
        '.r-row{display:flex;justify-content:space-between;padding:2px 0;font-size:' + px(t.totals) +
            ';font-variant-numeric:tabular-nums;}' +
        '.r-grand{border-top:1px solid #222;margin-top:6px;padding-top:6px;font-size:' + px(t.grand) +
            ';font-weight:700;color:#111;}' +
        '.receipt-footer{text-align:center;margin-top:auto;padding-top:' + t.footerPadMm +
            'mm;border-top:none;color:#111;font-size:' + px(t.signName) + ';}' +
        '.receipt-signatures{display:flex;justify-content:space-between;align-items:flex-end;gap:12mm;}' +
        '.receipt-signature{position:static;margin:0;max-width:none;flex:0 0 43%;text-align:left;padding-top:0;background:#fff;}' +
        '.receipt-signature-patient{text-align:right;}' +
        '.receipt-sign-line{border-bottom:1px solid #222;height:8px;}' +
        '.receipt-sign-name{margin-top:4px;font-size:' + px(t.signName) +
            ';font-weight:400;color:#111;line-height:1.25;}' +
        '#rReceiptFooterThanks,.receipt-footer p[data-i18n="bill.receipt.computerGenerated"]{display:none;}' +
        '#rInstalmentsSection{font-size:' + px(t.instal) + ';margin-top:10px;}' +
        '#rInstalmentsSection .receipt-instalments-title{font-size:' + px(t.instal) + ';font-weight:700;margin-bottom:4px;}' +
        '#rInstalmentsSection table{font-size:' + px(t.instal) + '!important;border-collapse:collapse;width:100%;}' +
        '#rInstalmentsSection th,#rInstalmentsSection td{padding:4px 6px!important;font-size:' + px(t.instal) +
            '!important;line-height:1.25;}' +
        '#rInstalmentsSection th{background:#fff;font-weight:700;border-top:1px solid #222;border-bottom:1px solid #222;}' +
        '#rOutstandingRow{font-size:' + px(t.instal) + '!important;margin-top:6px!important;padding:4px 8px!important;}' +
        '.receipt-extra-meta{margin-top:8px;padding-top:6px;border-top:1px dashed #222;font-size:' + px(t.extra) +
            ';line-height:' + t.lh + ';}' +
        '.receipt-extra-meta .receipt-kv-label,.receipt-extra-meta .receipt-kv-val{font-size:' + px(t.extra) +
            ';font-weight:400;color:#111;}' +
        '#rDiagnosisSection .receipt-kv-row,#rPatientAddrSection .receipt-kv-row{gap:2px 6px;flex-wrap:nowrap;}' +
        '@media print{' +
        'html,body,#receiptPrintArea,.receipt-signature,.receipt-header,.receipt-meta-left-stack,.receipt-totals,.receipt-table th,.receipt-table td{' +
        'print-color-adjust:economy!important;-webkit-print-color-adjust:economy!important;}' +
        'body{margin:0;color:#111!important;background:#fff!important;}' +
        '#receiptPrintArea{padding:0;max-width:100%;}' +
        '.receipt-signature{position:static;background:#fff!important;}' +
        '.receipt-header h2,.receipt-doc-title,.r-grand{color:#111!important;}' +
        '.receipt-meta-left-stack{background:#fff!important;border:none!important;}' +
        '.receipt-table th{background:#fff!important;color:#111!important;border-color:#111!important;}' +
        '.receipt-table td{border-color:#111!important;}' +
        '.receipt-totals{background:#fff!important;border-top:1px solid #111!important;}' +
        '.r-grand{border-top:1px solid #111!important;}' +
        'thead{display:table-header-group;}' +
        'tr{page-break-inside:avoid;}' +
        '}'
    );
}

/** Fallback when CFG sheet helpers unavailable — mirrors bill default A4 + 10mm from app-config PRINT_DOC_TYPES. */
function receiptPrintSheetFallbackCss() {
    return (
        '@page{margin:10mm 10mm 10mm 10mm;size:210mm 297mm;}' +
        'html{background:#d4d4d4;}' +
        'body{font-family:"Segoe UI",Arial,sans-serif;margin:0;color:#111;background:#d4d4d4;}' +
        '.print-sheet-outer{' +
            'box-sizing:border-box;width:210mm;min-height:297mm;' +
            'padding:10mm;margin:14px auto;background:#fff;' +
            'box-shadow:0 4px 28px rgba(0,0,0,.22);}' +
        '@media print{' +
            'html,body{background:#fff!important;color:#111!important;' +
            'print-color-adjust:economy!important;-webkit-print-color-adjust:economy!important;}' +
            '.print-sheet-outer{' +
                'width:auto!important;min-height:0!important;margin:0!important;' +
                'padding:0!important;box-shadow:none!important;background:#fff!important;' +
                'print-color-adjust:economy!important;-webkit-print-color-adjust:economy!important;}' +
        '}'
    );
}

function receiptDoctorNames(bill, profileOverride) {
    var src = {
        doctor_id: bill && bill.doctor_id,
        doctor_name: bill && bill.doctor_name,
        doctor_tag: bill && bill.doctor_tag
    };
    var zh = receiptUiZhHant();
    var header = (typeof printDoctorDisplayName === 'function')
        ? printDoctorDisplayName(src, zh ? 'zh' : 'en', profileOverride)
        : '—';
    var signatureEng = (typeof printDoctorDisplayName === 'function')
        ? printDoctorDisplayName(src, 'en', profileOverride)
        : header;
    var signatureChi = (typeof printDoctorDisplayName === 'function')
        ? printDoctorDisplayName(src, 'zh', profileOverride)
        : header;
    return {
        header: header,
        signatureEng: signatureEng,
        signatureChi: signatureChi
    };
}

function applyReceiptDoctorSignature(docNames) {
    if (!docNames) return;
    var zh = receiptUiZhHant();
    if (g('rDoctor')) g('rDoctor').textContent = docNames.header || '—';
    var engEl = g('rDoctorSignEng');
    var chiEl = g('rDoctorSignChi');
    if (zh) {
        if (engEl) engEl.style.display = 'none';
        if (chiEl) {
            chiEl.style.display = '';
            chiEl.textContent = docNames.signatureChi || docNames.header || '—';
        }
    } else {
        if (chiEl) chiEl.style.display = 'none';
        if (engEl) {
            engEl.style.display = '';
            engEl.textContent = docNames.signatureEng || docNames.header || '—';
        }
    }
}

function hydrateReceiptDoctorProfile(bill) {
    if (!bill || !bill.doctor_id || !SB || typeof SB.from !== 'function') return;
    SB.from('doctors')
        .select('id,display_name,english_name,chinese_name')
        .eq('id', bill.doctor_id)
        .limit(1)
        .then(function(r) {
            if (r.error || !r.data || !r.data.length) return;
            var names = receiptDoctorNames(bill, r.data[0]);
            applyReceiptDoctorSignature(names);
        });
}

function receiptUiZhHant() {
    return typeof appUiLang === 'string' && appUiLang.indexOf('Hant') >= 0;
}

function receiptTextHasCjk(s) {
    return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(String(s || ''));
}

/** English + Chinese patient lines for receipt header. */
function receiptPatientEnglishChineseParts(row, billFallbackName, opts) {
    opts = opts || {};
    var fb = String(billFallbackName || '').trim();
    var chiHint = String(opts.chineseHint || '').trim();
    var chi = '';
    var eng = '';
    if (row) {
        chi = String(row.chinese_name || row.name_zh || '').trim();
        eng = String(row.english_name || row.name_en || '').trim();
        if (!eng) eng = String(row.full_name || row.display_name || '').trim();
    }
    if (!chi && chiHint) chi = chiHint;
    if (!eng && !chi && fb) {
        if (receiptUiZhHant() && receiptTextHasCjk(fb)) {
            chi = fb;
            eng = '';
        } else {
            eng = fb;
            chi = '';
        }
    } else {
        if (!eng) eng = '';
        if (!chi) chi = '';
    }
    if (chi && eng && chi === eng && !receiptUiZhHant()) chi = '';

    var enDisp = '';
    var zhDisp = '';
    var showZhRow = !!chi;
    if (receiptUiZhHant() && chi) showZhRow = true;

    if (chi) {
        zhDisp = chi;
        enDisp = eng || '—';
    } else if (eng) {
        zhDisp = '';
        showZhRow = false;
        enDisp = eng;
    } else if (fb) {
        enDisp = fb;
        zhDisp = '';
        showZhRow = false;
    } else {
        enDisp = '—';
        zhDisp = '';
        showZhRow = false;
    }

    return { enDisp: enDisp || '—', zhDisp: zhDisp, showZhRow: showZhRow };
}

function applyReceiptPatientSignature(parts) {
    if (!parts) return;
    var enSign = parts.enDisp && parts.enDisp !== '—' ? parts.enDisp : '—';
    var zhSign = parts.zhDisp ? parts.zhDisp : '—';
    if (g('rPatientSignEng')) g('rPatientSignEng').textContent = enSign;
    if (g('rPatientSignChi')) g('rPatientSignChi').textContent = zhSign;
}

function applyReceiptPatientProfile(row, bill) {
    var chiHint = '';
    if (bill) {
        chiHint = String(bill.patient_chinese_name || billPatChineseName || '').trim();
    }
    var parts = receiptPatientEnglishChineseParts(row, bill ? bill.patient_name : '', {
        chineseHint: chiHint
    });
    var no = '';
    if (row) no = String(row.patient_no || row.patient_code || '').trim();
    if (!no && bill) no = String(bill.patient_no || '').trim();
    var enEl = g('rPatientEn');
    var zhEl = g('rPatientZh');
    var zhRow = g('receiptPatientZhRow');
    if (enEl) enEl.textContent = parts.enDisp;
    if (zhEl) zhEl.textContent = parts.zhDisp;
    if (zhRow) {
        zhRow.style.display = parts.showZhRow ? '' : 'none';
    }
    if (g('rPatientNo')) g('rPatientNo').textContent = no || '—';
    applyReceiptPatientSignature(parts);
}

function hydrateReceiptPatientProfile(bill) {
    if (!bill || !SB || typeof SB.from !== 'function') return;

    function queryByPatientNo() {
        if (!bill.patient_no) return;
        SB.from('patients')
            .select('*')
            .eq('patient_no', bill.patient_no)
            .limit(1)
            .then(function(r2) {
                if (r2.error || !r2.data || !r2.data.length) return;
                applyReceiptPatientProfile(r2.data[0], bill);
            });
    }

    if (bill.patient_id) {
        SB.from('patients')
            .select('*')
            .eq('id', bill.patient_id)
            .limit(1)
            .then(function(r) {
                if (r.error || !r.data || !r.data.length) {
                    queryByPatientNo();
                    return;
                }
                applyReceiptPatientProfile(r.data[0], bill);
            });
        return;
    }
    queryByPatientNo();
}

/**
 * Print receipt via hidden iframe (one click from preview). Auto-fit zoom to one A4 page when possible.
 */
function printReceiptDocument() {
    if (typeof confirmPrintReminder === 'function' && !confirmPrintReminder()) return;
    var area = g('receiptPrintArea');
    if (!area) return;
    if (_receiptPrintInProgress) return;
    _receiptPrintInProgress = true;

    var cid = (typeof currentClinicId !== 'undefined' && currentClinicId)
        ? String(currentClinicId) : '';
    var billPrintRow = null;
    var sheetCss = receiptPrintSheetFallbackCss();
    if (typeof CFG !== 'undefined' && CFG) {
        if (typeof CFG.prefetchPrintSettings === 'function') {
            CFG.prefetchPrintSettings(cid);
        }
        if (CFG.getPrintSettingsForDoc && CFG.buildPrintSheetStylesCss) {
            billPrintRow = CFG.getPrintSettingsForDoc('bill', cid);
            sheetCss = CFG.buildPrintSheetStylesCss(billPrintRow);
        }
    }
    var printStylesAll = sheetCss +
        '.print-sheet-outer img,.print-sheet-outer table{max-width:100%;}' +
        receiptContentPrintStyles();

    var iframe = g('receiptPrintFrame');
    if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'receiptPrintFrame';
        iframe.setAttribute('aria-hidden', 'true');
        iframe.title = 'Receipt print';
        document.body.appendChild(iframe);
    }
    iframe.style.cssText =
        'position:fixed;left:-10000px;top:0;width:794px;height:1123px;' +
        'border:0;visibility:hidden;opacity:0;pointer-events:none;';

    var releaseLock = function () {
        _receiptPrintInProgress = false;
        if (iframe) {
            iframe.style.cssText =
                'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
        }
    };

    var doc = iframe.contentDocument || (iframe.contentWindow && iframe.contentWindow.document);
    if (!doc) {
        releaseLock();
        alert(tr('bill.receipt.popupBlocked'));
        return;
    }

    doc.open();
    doc.write(
        '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
        '<title>' + esc(tr('bill.receipt.printTitle')) + '</title><style>' + printStylesAll + '</style></head><body>' +
        '<div class="print-sheet-outer"><div id="receiptPrintArea">' +
        area.innerHTML +
        '</div></div></body></html>'
    );
    doc.close();

    var win = iframe.contentWindow;
    if (!win) {
        releaseLock();
        return;
    }

    var done = false;
    function finish() {
        if (done) return;
        done = true;
        releaseLock();
        if (typeof closeModal === 'function') closeModal('receiptModal');
    }

    try {
        win.addEventListener('afterprint', function () { setTimeout(finish, 300); });
    } catch (_) {}

    setTimeout(function () {
        var scalePct;
        try {
            scalePct = receiptAutoFitScalePercent(doc, billPrintRow);
            receiptApplyPrintScale(doc, scalePct);
        } catch (eFit) {
            scalePct = receiptPrintMaxScalePercent(billPrintRow);
            receiptApplyPrintScale(doc, scalePct);
        }
        setTimeout(function () {
            try {
                win.focus();
                win.print();
            } catch (ePrint) {
                finish();
                alert(tr('bill.receipt.popupBlocked'));
                return;
            }
            setTimeout(finish, 8000);
        }, 60);
    }, 140);
}

function clinicRecordForReceiptByTagOrId(tagOrId) {
    if (!tagOrId || !APP_CLINICS || !APP_CLINICS.length) return null;
    var t = String(tagOrId).trim();
    for (var i = 0; i < APP_CLINICS.length; i++) {
        var c = APP_CLINICS[i];
        if (String(c.id) === t) return c;
        if (String(c.clinic_code || '').trim() === t) return c;
    }
    return null;
}

function resolveActiveClinicRecordForReceipt() {
    var rec = null;
    if (typeof clinicRecordFromId === 'function' && currentClinicId) {
        rec = clinicRecordFromId(currentClinicId);
    }
    if (!rec) {
        var sel = g('appWorkingClinicSelect');
        var selVal = sel ? String(sel.value || '').trim() : '';
        if (typeof isWorkingClinicAllValue === 'function' && isWorkingClinicAllValue(selVal)) {
            selVal = '';
        }
        if (selVal && typeof clinicRecordFromId === 'function') {
            rec = clinicRecordFromId(selVal);
        }
    }
    if (!rec &&
        typeof currentClinicCodeForTagging === 'function' &&
        typeof APP_CLINICS !== 'undefined' &&
        APP_CLINICS && APP_CLINICS.length) {
        var code = String(currentClinicCodeForTagging() || '').trim();
        if (code) rec = clinicRecordForReceiptByTagOrId(code);
    }
    return rec;
}

function applyReceiptClinicHeaderFromRecord(rec) {
    var nmEl = g('rClinicName');
    var addrEl = g('rClinicAddrLine');
    var telEl = g('rClinicTelLine');
    var footEl = g('rReceiptFooterThanks');

    var name = '';
    var addr = '';
    var tel = '';
    if (rec) {
        name = String(rec.english_name || rec.chinese_name || '').trim();
        addr = String(rec.address || '').trim();
        tel = String(rec.tel || '').trim();
    }
    if (!name && currentClinicLabel) name = String(currentClinicLabel).trim();
    if (!name) name = tr('ai.clinicFallback');

    if (nmEl) nmEl.textContent = name;
    if (addrEl) addrEl.textContent = addr || '—';
    if (telEl) telEl.textContent = trRepl('bill.receipt.telPrefix', { TEL: tel || '—' });
    if (footEl) footEl.textContent = trRepl('bill.receipt.thanksVisit', { NAME: name });
}

/** Receipt print header should follow active clinic context first. */
function applyReceiptClinicHeader(bill) {
    var rec = resolveActiveClinicRecordForReceipt();
    if (!rec && bill) rec = clinicRecordForReceiptByTagOrId(bill.clinic_id || bill.clinic_tag);
    applyReceiptClinicHeaderFromRecord(rec);

    if (!rec && bill && bill.appointment_id && SB && typeof SB.from === 'function') {
        SB.from('appointments')
            .select('clinic_tag')
            .eq('id', bill.appointment_id)
            .limit(1)
            .then(function(r) {
                if (r.error || !r.data || !r.data.length) return;
                var hit = clinicRecordForReceiptByTagOrId(r.data[0].clinic_tag || '');
                if (hit) applyReceiptClinicHeaderFromRecord(hit);
            });
    }
}

var RECEIPT_PRINT_OPTS_KEY = 'receipt_print_options_v1';
var _receiptPrintPending = null;
var _receiptOptionsReturnToPreview = false;

function defaultReceiptPrintOptions() {
    return {
        printAddress: false,
        printPaymentHistory: false,
        printBillDate: false,
        printDiagnosis: false,
        diagnosisText: '',
        reasonForTreatment: '',
        printTreatmentNotes: false,
        patientUndersign: true,
        printPrescription: false
    };
}

function loadReceiptPrintOptions() {
    var defs = defaultReceiptPrintOptions();
    try {
        var raw = localStorage.getItem(RECEIPT_PRINT_OPTS_KEY);
        if (!raw) return defs;
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return defs;
        Object.keys(defs).forEach(function(k) {
            if (typeof parsed[k] === 'boolean') defs[k] = parsed[k];
        });
    } catch (_) {}
    return defs;
}

function saveReceiptPrintOptions(opts) {
    var persist = defaultReceiptPrintOptions();
    Object.keys(persist).forEach(function(k) {
        if (typeof opts[k] === 'boolean') persist[k] = opts[k];
    });
    try {
        localStorage.setItem(RECEIPT_PRINT_OPTS_KEY, JSON.stringify(persist));
    } catch (_) {}
}

function readReceiptPrintOptionsFromForm() {
    var opts = defaultReceiptPrintOptions();
    opts.printAddress = !!(g('rpoPrintAddress') && g('rpoPrintAddress').checked);
    opts.printPaymentHistory = !!(g('rpoPrintPaymentHistory') && g('rpoPrintPaymentHistory').checked);
    opts.printBillDate = !!(g('rpoPrintBillDate') && g('rpoPrintBillDate').checked);
    opts.printDiagnosis = !!(g('rpoPrintDiagnosis') && g('rpoPrintDiagnosis').checked);
    opts.printTreatmentNotes = !!(g('rpoPrintTreatmentNotes') && g('rpoPrintTreatmentNotes').checked);
    opts.patientUndersign = !!(g('rpoPatientUndersign') && g('rpoPatientUndersign').checked);
    opts.printPrescription = !!(g('rpoPrintPrescription') && g('rpoPrintPrescription').checked);
    opts.diagnosisText = g('rpoDiagnosisText')
        ? String(g('rpoDiagnosisText').value || '').trim()
        : '';
    opts.reasonForTreatment = g('rpoReasonForTreatment')
        ? String(g('rpoReasonForTreatment').value || '').trim()
        : '';
    return opts;
}

function syncReceiptPrintDiagnosisFieldsVisibility() {
    var chk = g('rpoPrintDiagnosis');
    var fields = g('rpoDiagnosisFields');
    if (fields) fields.style.display = (chk && chk.checked) ? '' : 'none';
}

function applyReceiptPrintOptionsToForm(opts) {
    opts = opts || loadReceiptPrintOptions();
    if (g('rpoPrintAddress')) g('rpoPrintAddress').checked = !!opts.printAddress;
    if (g('rpoPrintPaymentHistory')) g('rpoPrintPaymentHistory').checked = !!opts.printPaymentHistory;
    if (g('rpoPrintBillDate')) g('rpoPrintBillDate').checked = !!opts.printBillDate;
    if (g('rpoPrintDiagnosis')) g('rpoPrintDiagnosis').checked = !!opts.printDiagnosis;
    if (g('rpoPrintTreatmentNotes')) g('rpoPrintTreatmentNotes').checked = !!opts.printTreatmentNotes;
    if (g('rpoPatientUndersign')) g('rpoPatientUndersign').checked = opts.patientUndersign !== false;
    if (g('rpoPrintPrescription')) g('rpoPrintPrescription').checked = !!opts.printPrescription;
    if (g('rpoDiagnosisText')) g('rpoDiagnosisText').value = opts.diagnosisText || '';
    if (g('rpoReasonForTreatment')) g('rpoReasonForTreatment').value = opts.reasonForTreatment || '';
    syncReceiptPrintDiagnosisFieldsVisibility();
}

function receiptDateIsoFromTs(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

function receiptFormatPrescriptionLine(row) {
    var bits = [String(row.drug_name || '').trim()];
    var detail = [
        row.dosage, row.frequency, row.duration, row.route,
        row.quantity ? ('×' + row.quantity) : ''
    ].filter(function(x) { return String(x || '').trim(); }).join(', ');
    if (detail) bits.push(detail);
    if (row.remarks) bits.push(String(row.remarks).trim());
    return bits.filter(Boolean).join(' — ');
}

function fetchReceiptSupplementData(bill, cb) {
    var result = {
        patientAddress: '',
        treatmentNotesText: '',
        prescriptions: []
    };
    if (!bill || !SB || typeof SB.from !== 'function') {
        if (cb) cb(result);
        return;
    }

    var billDate = String(bill.bill_date || '').trim();
    var patientId = bill.patient_id ? String(bill.patient_id) : '';
    var patientNo = String(bill.patient_no || '').trim();
    var pending = 0;

    function finishAll() {
        if (cb) cb(result);
    }

    function done() {
        pending--;
        if (pending <= 0) finishAll();
    }

    function start() { pending++; }

    function applyPatientRow(row) {
        if (row) result.patientAddress = String(row.address || '').trim();
    }

    start();
    function queryPatientByNo() {
        if (!patientNo) { done(); return; }
        SB.from('patients').select('address').eq('patient_no', patientNo).limit(1)
            .then(function(r2) {
                if (!r2.error && r2.data && r2.data.length) applyPatientRow(r2.data[0]);
                done();
            });
    }
    if (patientId) {
        SB.from('patients').select('address').eq('id', patientId).limit(1)
            .then(function(r) {
                if (!r.error && r.data && r.data.length) {
                    applyPatientRow(r.data[0]);
                    done();
                    return;
                }
                queryPatientByNo();
            });
    } else {
        queryPatientByNo();
    }

    if (patientId && billDate) {
        start();
        SB.from('treatments').select('notes,created_at')
            .eq('patient_id', patientId)
            .order('created_at', { ascending: true })
            .then(function(r) {
                if (!r.error && r.data && r.data.length) {
                    var notes = [];
                    r.data.forEach(function(t) {
                        var dk = receiptDateIsoFromTs(t.created_at);
                        if (dk !== billDate) return;
                        var txt = String(t.notes || '').trim();
                        if (txt) notes.push(txt);
                    });
                    result.treatmentNotesText = notes.join('\n\n');
                }
                done();
            });
    }

    if (patientId && billDate) {
        start();
        SB.from('drughistory').select('*')
            .eq('patient_id', patientId)
            .eq('prescribed_date', billDate)
            .order('drug_name', { ascending: true })
            .then(function(r) {
                if (!r.error && r.data && r.data.length) {
                    result.prescriptions = r.data.slice();
                }
                done();
            });
    }
}

function dismissReceiptPrintOptionsModal(restorePreview) {
    _receiptPrintPending = null;
    closeModal('receiptPrintOptionsModal');
    if (restorePreview && _receiptOptionsReturnToPreview && _receiptRefreshState) {
        _receiptOptionsReturnToPreview = false;
        openModal('receiptModal');
        return;
    }
    _receiptOptionsReturnToPreview = false;
}

function openReceiptPreviewDirect(pending) {
    pending = pending || {};
    var opts = loadReceiptPrintOptions();
    if (pending.printOpts && typeof pending.printOpts === 'object') {
        opts = Object.assign({}, opts, pending.printOpts);
    }
    if (!pending.bill) return;
    fetchReceiptSupplementData(pending.bill, function (supplement) {
        showReceipt(
            pending.bill,
            pending.insertedData,
            pending.payments,
            !!pending.autoPrint,
            opts,
            supplement
        );
    });
}

function openReceiptPrintOptionsModal(pending) {
    _receiptPrintPending = pending || null;
    var opts = loadReceiptPrintOptions();
    if (_receiptRefreshState && _receiptRefreshState.printOpts && pending && pending.bill &&
        _receiptRefreshState.bill) {
        var sameBill = String(_receiptRefreshState.bill.id || '') === String(pending.bill.id || '');
        if (sameBill) {
            opts = Object.assign({}, opts, _receiptRefreshState.printOpts);
        }
    }
    applyReceiptPrintOptionsToForm(opts);
    openModal('receiptPrintOptionsModal');
}

function confirmReceiptPrintOptions() {
    var opts = readReceiptPrintOptionsFromForm();
    saveReceiptPrintOptions(opts);
    var pending = _receiptPrintPending;
    _receiptPrintPending = null;
    _receiptOptionsReturnToPreview = false;
    closeModal('receiptPrintOptionsModal');
    if (!pending || !pending.bill) return;
    fetchReceiptSupplementData(pending.bill, function(supplement) {
        showReceipt(
            pending.bill,
            pending.insertedData,
            pending.payments,
            !!pending.autoPrint,
            opts,
            supplement
        );
    });
}

function reopenReceiptPrintOptionsFromReceipt() {
    if (!_receiptRefreshState || !_receiptRefreshState.bill) return;
    _receiptOptionsReturnToPreview = true;
    closeModal('receiptModal');
    openReceiptPrintOptionsModal({
        bill: _receiptRefreshState.bill,
        insertedData: _receiptRefreshState.insertedData,
        payments: _receiptRefreshState.payments,
        autoPrint: false
    });
}

function applyReceiptPrintOptions(opts, supplement, bill, pmts) {
    opts = opts || loadReceiptPrintOptions();
    supplement = supplement || {};

    var addrSec = g('rPatientAddrSection');
    var addrEl = g('rPatientAddr');
    var showAddr = !!opts.printAddress && String(supplement.patientAddress || '').trim();
    if (addrSec) addrSec.style.display = showAddr ? '' : 'none';
    if (addrEl && showAddr) addrEl.textContent = supplement.patientAddress;

    var dateCol = g('receiptBillDateCol');
    if (dateCol) dateCol.style.display = opts.printBillDate ? '' : 'none';

    var diagSec = g('rDiagnosisSection');
    if (opts.printDiagnosis) {
        var diagVal = String(opts.diagnosisText || '').trim() || '—';
        var reasonVal = String(opts.reasonForTreatment || '').trim() || '—';
        if (diagSec) diagSec.style.display = '';
        if (g('rDiagnosisVal')) g('rDiagnosisVal').textContent = diagVal;
        if (g('rTreatmentReasonVal')) g('rTreatmentReasonVal').textContent = reasonVal;
    } else if (diagSec) {
        diagSec.style.display = 'none';
    }

    var tnSec = g('rTreatmentNotesSection');
    var tnEl = g('rTreatmentNotesBody');
    if (opts.printTreatmentNotes) {
        var tnTxt = String(supplement.treatmentNotesText || '').trim() || '—';
        if (tnSec) tnSec.style.display = '';
        if (tnEl) tnEl.textContent = tnTxt;
    } else if (tnSec) {
        tnSec.style.display = 'none';
    }

    var rxSec = g('rPrescriptionSection');
    var rxEl = g('rPrescriptionBody');
    if (opts.printPrescription) {
        var rxRows = supplement.prescriptions || [];
        if (rxSec) rxSec.style.display = '';
        if (rxEl) {
            if (!rxRows.length) {
                rxEl.textContent = '—';
            } else {
                rxEl.innerHTML = rxRows.map(function(row) {
                    return esc(receiptFormatPrescriptionLine(row));
                }).join('<br>');
            }
        }
    } else if (rxSec) {
        rxSec.style.display = 'none';
    }

    var billNotesSec = g('rBillNotesSection');
    var billNotesEl = g('rBillNotesBody');
    var billNotesTxt = billUserNotesText(bill && bill.notes);
    if (billNotesSec) billNotesSec.style.display = billNotesTxt ? '' : 'none';
    if (billNotesEl) billNotesEl.textContent = billNotesTxt || '—';

    var patSign = g('receiptPatientSignBlock');
    if (patSign) patSign.style.display = opts.patientUndersign !== false ? '' : 'none';

    var bal = parseFloat(bill && bill.balance) || 0;
    var showPmts = false;
    if (opts.printPaymentHistory) {
        showPmts = (pmts || []).length >= 1;
    }
    var secEl = g('rInstalmentsSection');
    if (secEl && !opts.printPaymentHistory) {
        secEl.style.display = 'none';
    }
    return showPmts;
}

var _receiptRefreshState = null;

function showReceipt(bill, insertedData, payments, autoPrint, printOpts, supplement) {
    printOpts = printOpts || loadReceiptPrintOptions();
    supplement = supplement || {};
    _receiptRefreshState = {
        bill: bill,
        insertedData: insertedData,
        payments: payments,
        printOpts: printOpts,
        supplement: supplement
    };
    applyReceiptClinicHeader(bill);
    if (typeof applyProgramReceiptHeaderFooter === 'function') applyProgramReceiptHeaderFooter();

    var rNo = insertedData && insertedData[0]
        ? insertedData[0].id.slice(0, 8).toUpperCase()
        : 'RCP-' + Date.now();

    g('rNo').textContent        = rNo;
    g('rDate').textContent      = bill.bill_date;
    g('rType').textContent      = (typeof dispPayMethod === 'function')
        ? dispPayMethod(bill.bill_type)
        : bill.bill_type;
    if (g('rPatientNo')) g('rPatientNo').textContent =
        (bill && bill.patient_no) ? String(bill.patient_no).trim() : '—';
    var fallbackParts = receiptPatientEnglishChineseParts(null, bill.patient_name, {
        chineseHint: String(bill.patient_chinese_name || billPatChineseName || '').trim()
    });
    if (g('rPatientEn')) g('rPatientEn').textContent = fallbackParts.enDisp;
    if (g('rPatientZh')) g('rPatientZh').textContent = fallbackParts.zhDisp;
    applyReceiptPatientSignature(fallbackParts);
    if (g('receiptPatientZhRow')) {
        g('receiptPatientZhRow').style.display = fallbackParts.showZhRow ? '' : 'none';
    }
    var docNames = receiptDoctorNames(bill);
    applyReceiptDoctorSignature(docNames);
    hydrateReceiptDoctorProfile(bill);
    hydrateReceiptPatientProfile(bill);

    // ── Item rows (with disc %) ──────────────────────────
    var items = [];
    try { items = JSON.parse(bill.items || '[]'); } catch(e) {}
    var rb = g('rItemsBody');
    rb.innerHTML = '';
    items.forEach(function(it) {
        var disc = parseFloat(it.disc) || 0;
        var amt  = billItemAmt(it);
        var row = document.createElement('tr');
        row.innerHTML =
            '<td style="padding:4px 6px;">' + esc(it.desc || '-') + '</td>' +
            '<td style="padding:4px 6px;text-align:center;">' + (it.qty || 0) + '</td>' +
            '<td style="padding:4px 6px;text-align:right;">' + fmtHK(it.price) + '</td>' +
            '<td style="padding:4px 6px;text-align:center;color:' +
                (disc > 0 ? '#dc2626' : '#aaa') + ';">' +
                (disc > 0 ? formatBillDiscPctDisplay(disc) + '%' : '—') + '</td>' +
            '<td style="padding:4px 6px;text-align:right;">' + fmtHK(amt) + '</td>';
        rb.appendChild(row);
    });

    g('rSubtotal').textContent = fmt2(bill.subtotal);
    g('rDiscount').textContent = fmt2(bill.discount);
    g('rTotal').textContent    = fmt2(bill.total);
    g('rPaid').textContent     = fmt2(bill.amount_paid);
    g('rBalance').textContent  = fmtHK(bill.balance);

    // ── Instalment payments section ──────────────────────
    var pmts      = normalizeReceiptPayments(bill, payments);
    var bal       = parseFloat(bill.balance) || 0;
    var showPmts  = applyReceiptPrintOptions(printOpts, supplement, bill, pmts);
    var secEl     = g('rInstalmentsSection');
    var bodyEl    = g('rInstalmentsBody');
    var outRow    = g('rOutstandingRow');
    var outAmt    = g('rOutstandingAmt');

    if (secEl) secEl.style.display = showPmts ? '' : 'none';
    if (bodyEl) {
        bodyEl.innerHTML = '';
        pmts.forEach(function(p, i) {
            var row = document.createElement('tr');
            row.className = 'receipt-inst-row';
            if (i % 2 === 1) row.className += ' receipt-inst-row--alt';
            row.innerHTML =
                '<td class="receipt-inst-td receipt-inst-td--num">' + (i + 1) + '</td>' +
                '<td class="receipt-inst-td">' + esc(p.paid_date || '—') + '</td>' +
                '<td class="receipt-inst-td receipt-inst-td--amt">' + fmtHK(p.amount) + '</td>' +
                '<td class="receipt-inst-td">' + esc((typeof dispPayMethod === 'function')
                    ? dispPayMethod(p.method)
                    : (p.method || '—')) + '</td>' +
                '<td class="receipt-inst-td receipt-inst-td--notes">' +
                    esc(p.notes || '') + '</td>';
            bodyEl.appendChild(row);
        });
    }
    if (outRow)  outRow.style.display  = bal > 0 ? 'flex' : 'none';
    if (outAmt)  outAmt.textContent    = fmtHK(bal);

    openModal('receiptModal');
    if (typeof applyI18nInRoot === 'function') {
        var rm = g('receiptModal');
        if (rm) applyI18nInRoot(rm);
    }
    if (autoPrint) {
        setTimeout(function () { printReceiptDocument(); }, 400);
    }
}

function checkInFromToday(apptId) {
    var appt = null;
    for (var i = 0; i < todayAppts.length; i++) {
        if (todayAppts[i].id === apptId) { appt = todayAppts[i]; break; }
    }
    if (appt && todayApptNeedsPatientReg(appt)) {
        alert(tr('appt.today.registerWalkinFirst'));
        return;
    }
    var now = new Date();
    var arrivalTime = now.toISOString();

    var cq2 = SB.from('appointments')
        .select('in_queue')
        .eq('date', todayISO())
        .not('in_queue', 'is', null)
        .order('in_queue', { ascending: false })
        .limit(1);
    cq2 = applyApptModuleClinicQuery(cq2);
    cq2.then(function(r) {
        var nextQ = 1;
        if (!r.error && r.data && r.data.length > 0) {
            nextQ = (r.data[0].in_queue || 0) + 1;
        }
        SB.from('appointments')
            .update({
                arrived:      true,
                arrival_time: arrivalTime,
                in_queue:     nextQ,
                bill_status:  'Queue'
            })
            .eq('id', apptId)
        .then(function(u) {
            if (u.error) { alert(trRepl('appt.msg.error', { MSG: u.error.message })); return; }
            loadToday();
            switchApptTab('queue');
        });
    });
}

function refreshRecallContactI18n() {
    if (typeof setRcContact === 'function') setRcContact(rcContact);
}

function refreshRecallPanelI18n() {
    if (!rcDate) return;
    var hdr = g('recallDateHdr');
    if (hdr) {
        hdr.textContent = typeof fmtDateLong === 'function'
            ? fmtDateLong(rcDate, { long: true })
            : rcDate;
    }
    if (typeof renderRcal === 'function') renderRcal();
    if (rcPatients.length && typeof renderRecallTable === 'function') {
        renderRecallTable();
    }
}

function apptTabApplyI18nIfCached(tabId) {
    if (typeof applyI18nInRoot !== 'function') return;
    var tab = g(tabId);
    if (tab) applyI18nInRoot(tab);
}

function refreshApptCachedTabsI18n() {
    if (typeof syncApptTodayDateLabels === 'function') syncApptTodayDateLabels();
    if (arAllData.length && typeof arRender === 'function') {
        arRender();
        apptTabApplyI18nIfCached('tab-records');
        if (typeof arRecordsSyncSidebarToggleUi === 'function') arRecordsSyncSidebarToggleUi();
    }
    if (todayAppts.length && typeof loadToday === 'function') {
        loadToday();
        apptTabApplyI18nIfCached('tab-today');
    }
    if (typeof plusApptDate !== 'undefined' && plusApptDate &&
        typeof refreshApptPlannerData === 'function') {
        refreshApptPlannerData();
        apptTabApplyI18nIfCached('tab-plusappt');
    }
    var qb = g('queueBody');
    if (qb && qb.querySelector('tr.queue-row-draggable') && typeof loadQueue === 'function') {
        loadQueue();
        apptTabApplyI18nIfCached('tab-queue');
    }
    if (typeof rcDate !== 'undefined' && rcDate) {
        if (typeof refreshRecallPanelI18n === 'function') refreshRecallPanelI18n();
        else apptTabApplyI18nIfCached('tab-recall');
    }
    var cb = g('calBody');
    if (typeof calView !== 'undefined' && calView === 'weekly' &&
        typeof GCAL !== 'undefined' && typeof GCAL.render === 'function') {
        var gcalState = (typeof GCAL.captureGcalPanelState === 'function')
            ? GCAL.captureGcalPanelState() : null;
        GCAL.render();
        if (typeof GCAL.restoreGcalPanelState === 'function') {
            GCAL.restoreGcalPanelState(gcalState);
        }
    } else if (cb && cb.children.length && typeof renderCal === 'function') {
        renderCal();
    } else {
        apptTabApplyI18nIfCached('tab-calendar');
    }
    if (typeof apptRefreshAllPatientCountBadges === 'function') {
        apptRefreshAllPatientCountBadges();
    }
}

document.addEventListener('DOMContentLoaded', function () {
    if (typeof refreshApptDurOptions === 'function') refreshApptDurOptions();
    wireBillPanelControls();
    bindApptUnpaidBadgeClickOnce();
});

function refreshOpenBillPanelForLang() {
    var panel = g('billPanel');
    if (!panel || !panel.classList.contains('open')) return;
    if (typeof applyI18nInRoot === 'function') applyI18nInRoot(panel);
    renderBillPendingRefreshMeta();
    if (typeof applyReceiptClinicHeader === 'function') applyReceiptClinicHeader();
    renderStep1UI();
    renderBillItems();
    recalcPendingSubtotal();
    if (typeof loadBillHistory === 'function') loadBillHistory();
    else if (typeof applyBillHistoryFilter === 'function') applyBillHistoryFilter();
    if (typeof loadBillTypes === 'function') {
        loadBillTypes({ force: false });
    } else if (typeof refreshBillPaymentSelectLabels === 'function') {
        refreshBillPaymentSelectLabels();
    }
    if (typeof renderBillDoctorOptions === 'function') {
        renderBillDoctorOptions(typeof defaultBillDoctorId === 'function' ? defaultBillDoctorId() : '');
    }
}

document.addEventListener('app-lang-change', function () {
    if (typeof refreshApptDurOptions === 'function') refreshApptDurOptions();
    refreshOpenBillPanelForLang();
    var panel = g('billPanel');
    if (typeof refreshApptCachedTabsI18n === 'function') refreshApptCachedTabsI18n();
    var apptSec = g('appointmentSection');
    var billOpen = panel && panel.classList.contains('open');
    if (apptSec && (apptSectionIsActive() || billOpen)) {
        if (apptSectionIsActive()) {
            var tab = typeof apptActiveTabKey === 'function' ? apptActiveTabKey() : null;
            if (tab === 'records' && !arAllData.length && typeof loadApptRecords === 'function') {
                loadApptRecords();
            } else if (tab === 'calendar' && typeof renderCal === 'function') {
                var gcalState = (typeof GCAL.captureGcalPanelState === 'function')
                    ? GCAL.captureGcalPanelState() : null;
                renderCal();
                if (typeof GCAL.restoreGcalPanelState === 'function') {
                    GCAL.restoreGcalPanelState(gcalState);
                }
            }
        }
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(apptSec);
        if (typeof syncApptTodayDateLabels === 'function') syncApptTodayDateLabels();
    }
    var dayPanel = g('dayPanel');
    if (dayPanel && dayPanel.style.display !== 'none' && _dayPanelCtx) {
        showDayPanel(_dayPanelCtx.iso, { [_dayPanelCtx.iso]: _dayPanelCtx.items });
    }
    if (typeof refreshRecallContactI18n === 'function') refreshRecallContactI18n();
    if (typeof renderRcTemplates === 'function') renderRcTemplates();
    if (_queueRemarksEditAppt && typeof setQueueRemarksApptHint === 'function') {
        setQueueRemarksApptHint(_queueRemarksEditAppt);
    }
    var apptModal = g('apptModal');
    if (apptModal && apptModal.style.display === 'block' &&
        typeof refreshApptModalI18n === 'function') {
        refreshApptModalI18n();
    }
    if (typeof refreshApptPopupI18n === 'function') refreshApptPopupI18n();
    var recallSendModal = g('recallSendModal');
    if (recallSendModal && recallSendModal.style.display === 'block') {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(recallSendModal);
        if (typeof showRcSendModal === 'function' && rcSendQueue && rcSendQueue.length) showRcSendModal();
    }
    var queueRemarksModal = g('queueRemarksModal');
    if (queueRemarksModal && queueRemarksModal.style.display === 'block') {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(queueRemarksModal);
        if (typeof refreshApptRemarksEditorPlaceholders === 'function') {
            refreshApptRemarksEditorPlaceholders();
        }
        if (_queueRemarksEditAppt && typeof setQueueRemarksApptHint === 'function') {
            setQueueRemarksApptHint(_queueRemarksEditAppt);
        }
    }
    if (typeof refreshApptRemarksEditorPlaceholders === 'function') {
        refreshApptRemarksEditorPlaceholders();
    }
    var receiptModal = g('receiptModal');
    if (receiptModal && receiptModal.style.display === 'block') {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(receiptModal);
        if (_receiptRefreshState && typeof showReceipt === 'function') {
            showReceipt(
                _receiptRefreshState.bill,
                _receiptRefreshState.insertedData,
                _receiptRefreshState.payments,
                false,
                _receiptRefreshState.printOpts,
                _receiptRefreshState.supplement
            );
        }
    }
    var billDetailModalEl = g('billDetailModal');
    if (billDetailModalEl && billDetailModalEl.style.display === 'block') {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(billDetailModalEl);
        if (bdCurrentBill && typeof showBillDetail === 'function') {
            showBillDetail(bdCurrentBill);
        }
    }
    var addPayModal = g('addPaymentModal');
    if (addPayModal && addPayModal.style.display === 'block') {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(addPayModal);
        if (typeof ensureBillTypesLoaded === 'function') {
            ensureBillTypesLoaded(function () {
                var apSel = g('apMethod');
                if (apSel && typeof applyBillTypeOptions === 'function') {
                    var apPrev = apSel.value;
                    applyBillTypeOptions(apSel, false, { forPayment: true });
                    if (apPrev) {
                        ensureBillTypeOptionExists(apSel, apPrev);
                        apSel.value = apPrev;
                    }
                }
            });
        }
        if (bdCurrentBill) {
            var apBal = parseFloat(bdCurrentBill.balance) || 0;
            var apSummary = g('apBillSummary');
            if (apSummary) {
                apSummary.textContent = trRepl('bill.addPayment.summary', {
                    REF: (bdCurrentBill.id || '').slice(0, 8).toUpperCase(),
                    DATE: (bdCurrentBill.bill_date || ''),
                    TOTAL: fmt2(bdCurrentBill.total)
                });
            }
            var apBalHint = g('apBalanceHint');
            if (apBalHint) apBalHint.textContent = fmtHK(apBal);
        }
    }
    var billDelModal = g('billDeleteModal');
    if (billDelModal && billDelModal.style.display === 'block' && bdDeleteTarget) {
        if (typeof applyI18nInRoot === 'function') applyI18nInRoot(billDelModal);
        if (typeof refreshBillDeleteModalCopy === 'function') {
            refreshBillDeleteModalCopy(bdDeleteTarget);
        }
    }
    if (typeof refreshGcalLockButtonsI18n === 'function') refreshGcalLockButtonsI18n();
    if (typeof GCAL !== 'undefined' && typeof GCAL.refreshGcalPanelsI18n === 'function') {
        GCAL.refreshGcalPanelsI18n();
    }
    if (typeof refreshApptHeaderI18n === 'function') refreshApptHeaderI18n();
    if (typeof renderPlusApptMiniCal === 'function' && g('plusApptMiniCal')) {
        renderPlusApptMiniCal();
    }
    if (typeof plusApptRefreshSettingsPanelI18n === 'function') plusApptRefreshSettingsPanelI18n();
});
