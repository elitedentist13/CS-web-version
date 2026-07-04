// ════════════════════════════════════════════════════════════════
// GLOBAL QUICK-LAUNCH DOCK
// Fixed floating speed-dial accessible from every screen.
// ════════════════════════════════════════════════════════════════

(function () {

    // ── helpers ───────────────────────────────────────────────
    function qlTr(key) {
        return (typeof t === 'function') ? t(key) : key;
    }

    function qlG(id) {
        return document.getElementById(id);
    }

    function qlToast(msg) {
        // Re-use global toast if available, otherwise fallback
        var el = qlG('appGlobalToast') || qlG('cfgToast');
        if (el) {
            el.textContent = msg;
            el.style.opacity = '1';
            clearTimeout(el._qlTid);
            el._qlTid = setTimeout(function () { el.style.opacity = '0'; }, 2800);
            return;
        }
        // Minimal inline toast
        var t2 = document.createElement('div');
        t2.textContent = msg;
        t2.style.cssText =
            'position:fixed;bottom:80px;left:18px;z-index:99990;' +
            'background:#334155;color:#fff;padding:9px 16px;border-radius:8px;' +
            'font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.25);' +
            'opacity:1;transition:opacity .4s;pointer-events:none;';
        document.body.appendChild(t2);
        setTimeout(function () {
            t2.style.opacity = '0';
            setTimeout(function () {
                if (t2.parentNode) t2.parentNode.removeChild(t2);
            }, 500);
        }, 2500);
    }

    /** Primary active-patient dock (slot 0) — authoritative "current patient" for staff. */
    function qlPrimaryDockPatient() {
        if (typeof activePatientSlots !== 'undefined' &&
            activePatientSlots[0] && activePatientSlots[0].id) {
            return activePatientSlots[0];
        }
        return null;
    }

    function qlPatientFromDirectory() {
        if (typeof selPatientId === 'undefined' || !selPatientId) return null;
        if (typeof _patientDetailsPatient !== 'undefined' &&
            _patientDetailsPatient && String(_patientDetailsPatient.id) === String(selPatientId)) {
            return _patientDetailsPatient;
        }
        if (typeof patientListCache !== 'undefined' && patientListCache && patientListCache.length) {
            var dirHit = patientListCache.find(function (x) {
                return x && String(x.id) === String(selPatientId);
            });
            if (dirHit) return dirHit;
        }
        return { id: selPatientId };
    }

    function qlPatientFromQueueSelection() {
        if (!qlHasQueueRowSelection()) return null;
        var apptId = (typeof apptListSelectedApptId !== 'undefined') ? apptListSelectedApptId : null;
        if (!apptId) return null;
        var tab = (typeof apptListSelectedTab !== 'undefined') ? apptListSelectedTab : 'queue';
        var appt = null;
        if (typeof apptFindListRowAppt === 'function') {
            appt = apptFindListRowAppt(apptId, tab);
        }
        if (!appt) {
            var lists = [];
            if (typeof queueApptsCache !== 'undefined') lists.push(queueApptsCache);
            if (typeof todayAppts !== 'undefined') lists.push(todayAppts);
            for (var li = 0; li < lists.length && !appt; li++) {
                var list = lists[li] || [];
                for (var i = 0; i < list.length; i++) {
                    if (list[i] && String(list[i].id) === String(apptId)) {
                        appt = list[i];
                        break;
                    }
                }
            }
        }
        if (!appt || !appt.patient_id) return null;
        return {
            id: appt.patient_id,
            patient_no: appt.patient_no || '',
            full_name: appt.patient_name || '',
            chinese_name: appt.patient_chinese_name || ''
        };
    }

    function qlPatientFromConsultation() {
        if (typeof conPatientId !== 'undefined' && conPatientId &&
            typeof conPatientData !== 'undefined' && conPatientData &&
            String(conPatientData.id) === String(conPatientId)) {
            return conPatientData;
        }
        return null;
    }

    /** Resolve current patient: dock → directory → queue row → consultation module. */
    function qlResolvePatientRecord() {
        return qlPrimaryDockPatient() ||
            qlPatientFromDirectory() ||
            qlPatientFromQueueSelection() ||
            qlPatientFromConsultation();
    }

    function qlCurrentPatientId() {
        var rec = qlResolvePatientRecord();
        return rec && rec.id ? rec.id : null;
    }

    function qlEnsurePatientRecord(p, done) {
        if (!p || !p.id) {
            if (done) done(null);
            return;
        }
        if (p.full_name || p.patient_no) {
            if (done) done(p);
            return;
        }
        if (typeof patientListCache !== 'undefined' && patientListCache && patientListCache.length) {
            var cached = patientListCache.find(function (x) {
                return x && String(x.id) === String(p.id);
            });
            if (cached) {
                if (done) done(cached);
                return;
            }
        }
        if (typeof SB === 'undefined' || !SB || !SB.from) {
            if (done) done(p);
            return;
        }
        SB.from('patients')
            .select('id,patient_no,full_name,chinese_name')
            .eq('id', p.id)
            .limit(1)
        .then(function (r) {
            if (r.error || !r.data || !r.data.length) {
                if (done) done(p);
                return;
            }
            if (done) done(r.data[0]);
        })
        .catch(function () {
            if (done) done(p);
        });
    }

    /** Same path as patient directory "Bills" — appointment screen + slide-in bill panel. */
    function qlOpenBillPanelForPatient(p) {
        qlEnsurePatientRecord(p, function (rec) {
            if (!rec || !rec.id || typeof openBillPanel !== 'function') {
                qlToast(qlTr('ql.needPatient'));
                return;
            }
            if (typeof showOnly === 'function') showOnly('appointmentSection');
            setTimeout(function () {
                openBillPanel({
                    id: null,
                    patient_id: rec.id,
                    patient_name: rec.full_name || '',
                    patient_chinese_name: rec.chinese_name || '',
                    patient_no: rec.patient_no || ''
                });
            }, 80);
        });
    }

    function qlHasQueueRowSelection() {
        return !!(
            typeof apptListSelectedApptId !== 'undefined' && apptListSelectedApptId &&
            typeof apptListSelectedTab !== 'undefined' && apptListSelectedTab === 'queue'
        );
    }

    // ── state ─────────────────────────────────────────────────
    var _open = false;

    function qlElevate() {
        var root = qlG('appQuickLaunch');
        if (root) root.classList.add('ql-elevated');
    }

    function qlDeElevate() {
        var root = qlG('appQuickLaunch');
        if (root) root.classList.remove('ql-elevated');
    }

    // ── action definitions ────────────────────────────────────
    // requiresPatient: if true and no conPatientId, show a toast instead of crashing
    // Menu order matches shortcut numbers (1–7), then letter keys Q / B.
    var QL_ACTIONS = [
        {
            id: 'patients',
            icon: '🔍',
            i18nKey: 'ql.patients',
            shortcut: 'Ctrl+Shift+1',
            requiresPatient: false,
            handler: function () {
                if (typeof showOnly === 'function') showOnly('patientSection');
            }
        },
        {
            id: 'new_appt',
            icon: '➕',
            i18nKey: 'ql.newAppt',
            shortcut: 'Ctrl+Shift+2',
            requiresPatient: false,
            handler: function () {
                if (typeof showOnly === 'function') showOnly('appointmentSection');
                setTimeout(function () {
                    if (typeof switchApptTab === 'function') switchApptTab('plusappt');
                }, 60);
            }
        },
        {
            id: 'current_queue',
            icon: '👥',
            i18nKey: 'ql.currentQueue',
            shortcut: 'Ctrl+Shift+Q',
            requiresPatient: false,
            handler: function () {
                if (typeof showOnly === 'function') showOnly('appointmentSection');
                setTimeout(function () {
                    if (typeof switchApptTab === 'function') switchApptTab('queue');
                }, 60);
            }
        },
        {
            id: 'queue_actions',
            icon: '▾',
            i18nKey: 'ql.queueActions',
            shortcut: 'Ctrl+Shift+A',
            requiresQueueSelection: true,
            handler: function () {
                if (!qlHasQueueRowSelection()) {
                    qlToast(qlTr('ql.needQueueSelection'));
                    return;
                }
                if (typeof openQueueSelectedRowAction === 'function') {
                    openQueueSelectedRowAction();
                    return;
                }
                qlToast(qlTr('ql.needQueueSelection'));
            }
        },
        {
            id: 'appt_records',
            icon: '📋',
            i18nKey: 'ql.apptRecords',
            shortcut: 'Ctrl+Shift+3',
            requiresPatient: false,
            handler: function () {
                if (typeof showOnly === 'function') showOnly('appointmentSection');
                setTimeout(function () {
                    if (typeof switchApptTab === 'function') switchApptTab('records');
                }, 60);
            }
        },
        {
            id: 'consultation',
            icon: '🩺',
            i18nKey: 'ql.consultation',
            shortcut: 'Ctrl+Shift+4',
            requiresPatient: false,
            handler: function () {
                var rec = qlResolvePatientRecord();
                var pid = rec && rec.id ? rec.id : null;
                if (pid && typeof openConForPatient === 'function') {
                    openConForPatient(pid);
                    return;
                }
                if (typeof initConsultation === 'function') initConsultation();
            }
        },
        {
            id: 'prescriptions',
            icon: '💊',
            i18nKey: 'ql.prescriptions',
            shortcut: 'Ctrl+Shift+5',
            requiresPatient: true,
            handler: function () {
                var rec = qlResolvePatientRecord();
                var pid = rec && rec.id ? rec.id : null;
                if (!pid) {
                    qlToast(qlTr('ql.needPatient'));
                    if (typeof initConsultation === 'function') initConsultation();
                    return;
                }
                if (typeof openConForPatient === 'function') {
                    openConForPatient(pid, {
                        onReady: function () {
                            if (typeof switchConTab === 'function') switchConTab('treatment');
                            setTimeout(function () {
                                if (typeof toggleDrugAddPanel === 'function') toggleDrugAddPanel(true);
                            }, 60);
                        }
                    });
                } else if (typeof showOnly === 'function') {
                    showOnly('consultationSection');
                }
            }
        },
        {
            id: 'add_payment',
            icon: '💳',
            i18nKey: 'ql.addPayment',
            shortcut: 'Ctrl+Shift+6',
            requiresPatient: true,
            handler: function () {
                var rec = qlResolvePatientRecord();
                if (!rec || !rec.id) {
                    qlToast(qlTr('ql.needPatient'));
                    return;
                }
                qlOpenBillPanelForPatient(rec);
            }
        },
        {
            id: 'check_in',
            icon: '✅',
            i18nKey: 'ql.checkIn',
            shortcut: 'Ctrl+Shift+7',
            requiresPatient: true,
            handler: function () {
                var pid = qlCurrentPatientId();
                if (!pid) {
                    qlToast(qlTr('ql.needPatient'));
                    return;
                }
                function runCheckIn(p) {
                    if (!p || !p.id) {
                        qlToast(qlTr('ql.needPatient'));
                        return;
                    }
                    if (typeof checkInPatientFromRecord === 'function') {
                        checkInPatientFromRecord(p);
                    }
                }
                var rec = qlResolvePatientRecord();
                if (rec && rec.id && (rec.full_name || rec.patient_no)) {
                    runCheckIn(rec);
                    return;
                }
                qlEnsurePatientRecord({ id: pid }, runCheckIn);
            }
        },
        {
            id: 'broadcast',
            icon: '📢',
            i18nKey: 'ql.broadcast',
            shortcut: 'Ctrl+Shift+B',
            requiresPatient: false,
            handler: function () {
                if (typeof BROADCAST !== 'undefined' && BROADCAST.toggle) {
                    BROADCAST.toggle();
                }
            }
        }
    ];

    // ── build DOM ─────────────────────────────────────────────
    function buildQuickLaunchShell() {
        if (qlG('appQuickLaunch')) return;

        var root = document.createElement('div');
        root.id = 'appQuickLaunch';

        var toggleBtn = document.createElement('button');
        toggleBtn.className = 'ql-toggle-btn';
        toggleBtn.type = 'button';
        toggleBtn.id = 'qlToggleBtn';
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.setAttribute('aria-haspopup', 'true');
        toggleBtn.innerHTML =
            '<span class="ql-toggle-icon" aria-hidden="true">🍌</span>' +
            '<span class="ql-toggle-label" data-ql-label="toggle">' + qlTr('ql.toggle') + '</span>';

        function qlPrimeInteraction() {
            ensureQuickLaunchMenu();
            qlElevate();
        }

        toggleBtn.addEventListener('mouseenter', qlPrimeInteraction);
        toggleBtn.addEventListener('mousedown', function (e) {
            e.stopPropagation();
            qlPrimeInteraction();
        });
        toggleBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            qlPrimeInteraction();
            toggleQuickLaunch();
        });

        root.addEventListener('mouseenter', qlPrimeInteraction);
        root.addEventListener('mouseleave', qlDeElevate);

        root.appendChild(toggleBtn);
        document.body.appendChild(root);

        document.addEventListener('click', function (e) {
            if (_open && !root.contains(e.target)) {
                closeQuickLaunch();
            }
        });
    }

    function ensureQuickLaunchMenu() {
        var root = qlG('appQuickLaunch');
        if (!root || qlG('qlMenu')) return;

        var toggleBtn = qlG('qlToggleBtn');
        var menu = document.createElement('div');
        menu.className = 'ql-menu';
        menu.id = 'qlMenu';

        QL_ACTIONS.forEach(function (action) {
            var btn = document.createElement('button');
            btn.className = 'ql-item';
            btn.dataset.qlId = action.id;
            btn.type = 'button';
            btn.innerHTML =
                '<span class="ql-item-icon">' + action.icon + '</span>' +
                '<span class="ql-item-label" data-ql-label="' + action.id + '">' +
                    qlTr(action.i18nKey) +
                '</span>' +
                '<kbd class="ql-item-kbd">' + action.shortcut + '</kbd>';
            btn.addEventListener('click', function (e) {
                e.stopPropagation();
                closeQuickLaunch();
                action.handler();
            });
            menu.appendChild(btn);
        });

        var sepBtn = menu.querySelector('[data-ql-id="appt_records"]');
        if (sepBtn) {
            var divider = document.createElement('div');
            divider.className = 'ql-separator';
            menu.insertBefore(divider, sepBtn);
        }

        root.insertBefore(menu, toggleBtn);
        refreshItemStates();
    }

    // ── open / close ──────────────────────────────────────────
    function openQuickLaunch() {
        ensureQuickLaunchMenu();
        _open = true;
        qlElevate();
        var root = qlG('appQuickLaunch');
        var toggleBtn = qlG('qlToggleBtn');
        if (root) {
            root.classList.add('ql-open');
            refreshItemStates();
        }
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'true');
    }

    function closeQuickLaunch() {
        _open = false;
        var root = qlG('appQuickLaunch');
        var toggleBtn = qlG('qlToggleBtn');
        if (root) root.classList.remove('ql-open');
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', 'false');
        if (root && root.matches(':hover')) {
            qlElevate();
        } else {
            qlDeElevate();
        }
    }

    function toggleQuickLaunch() {
        if (_open) closeQuickLaunch();
        else openQuickLaunch();
    }

    // ── refresh item disabled/enabled states ─────────────────
    function refreshItemStates() {
        var pid = qlCurrentPatientId();
        var menu = qlG('qlMenu');
        if (!menu) return;
        QL_ACTIONS.forEach(function (action) {
            var btn = menu.querySelector('[data-ql-id="' + action.id + '"]');
            if (!btn) return;
            if (action.requiresQueueSelection && !qlHasQueueRowSelection()) {
                btn.classList.add('ql-disabled');
            } else if (action.requiresPatient && !pid) {
                btn.classList.add('ql-disabled');
            } else {
                btn.classList.remove('ql-disabled');
            }
        });
    }

    // ── keyboard shortcuts ────────────────────────────────────
    function qlShortcutTailKey(shortcut) {
        var parts = String(shortcut || '').split('+');
        return parts[parts.length - 1].trim().toLowerCase();
    }

    function qlShortcutModifiersMatch(e) {
        return !!(e && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey);
    }

    function qlEventMatchesShortcut(e, shortcut) {
        if (!qlShortcutModifiersMatch(e)) return false;
        var tail = qlShortcutTailKey(shortcut);
        if (!tail) return false;
        if (/^[1-9]$/.test(tail)) {
            return e.code === 'Digit' + tail ||
                e.code === 'Numpad' + tail ||
                e.key === tail;
        }
        if (/^[a-z]$/.test(tail)) {
            return e.code === 'Key' + tail.toUpperCase() ||
                String(e.key).toLowerCase() === tail;
        }
        return false;
    }

    function qlTypingTarget(e) {
        var el = e && e.target;
        if (!el || !el.closest) return null;
        return el.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
    }

    function qlShortcutsEnabled(e) {
        var loginEl = qlG('loginOverlay');
        if (loginEl && loginEl.style.display !== 'none') return false;
        if (qlTypingTarget(e)) return false;
        return true;
    }

    function qlRunActionById(actionId) {
        var act = QL_ACTIONS.find(function (a) { return a.id === actionId; });
        if (!act || typeof act.handler !== 'function') return false;
        closeQuickLaunch();
        act.handler();
        return true;
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && _open) {
            closeQuickLaunch();
            return;
        }
        if (!qlShortcutsEnabled(e)) return;
        if (!qlShortcutModifiersMatch(e)) return;

        for (var i = 0; i < QL_ACTIONS.length; i++) {
            if (!qlEventMatchesShortcut(e, QL_ACTIONS[i].shortcut)) continue;
            e.preventDefault();
            e.stopPropagation();
            qlRunActionById(QL_ACTIONS[i].id);
            return;
        }
    }, true);

    // ── i18n refresh on language change ──────────────────────
    document.addEventListener('app-lang-change', function () {
        refreshLabels();
    });
    document.addEventListener('app-active-patient-change', function () {
        refreshItemStates();
    });
    document.addEventListener('app-appt-list-selection-change', function () {
        refreshItemStates();
    });

    function refreshLabels() {
        var toggleLbl = document.querySelector('[data-ql-label="toggle"]');
        if (toggleLbl) toggleLbl.textContent = qlTr('ql.toggle');
        var menu = qlG('qlMenu');
        if (!menu) return;
        QL_ACTIONS.forEach(function (action) {
            var btn = menu.querySelector('[data-ql-id="' + action.id + '"]');
            var lbl = menu.querySelector('[data-ql-label="' + action.id + '"]');
            if (lbl) lbl.textContent = qlTr(action.i18nKey);
            if (btn) {
                var kbd = btn.querySelector('.ql-item-kbd');
                if (kbd) kbd.textContent = action.shortcut;
            }
        });
    }

    // ── hide dock on login screen ─────────────────────────────
    function qlSyncVisibility() {
        var loginEl = qlG('loginOverlay');
        var isLogin = loginEl && loginEl.style.display !== 'none';
        var body = document.body;
        if (isLogin) {
            body.classList.add('ql-hidden');
            closeQuickLaunch();
            qlDeElevate();
        } else {
            body.classList.remove('ql-hidden');
            buildQuickLaunchShell();
        }
    }

    document.addEventListener('app-session-sync', qlSyncVisibility);
    document.addEventListener('DOMContentLoaded', function () {
        qlSyncVisibility();
        setTimeout(qlSyncVisibility, 800);
    });

    document.addEventListener('DOMContentLoaded', function () {
        var origShowOnly = typeof showOnly === 'function' ? showOnly : null;
        if (origShowOnly) {
            window.showOnly = function (id) {
                origShowOnly(id);
                qlSyncVisibility();
            };
        }
    });

    window.toggleQuickLaunch = toggleQuickLaunch;
    window.closeQuickLaunch  = closeQuickLaunch;
    window.openQuickLaunch   = openQuickLaunch;

})();
