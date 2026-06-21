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

    function qlCurrentPatientId() {
        var pid = (typeof conPatientId !== 'undefined') ? conPatientId : null;
        if (pid) return pid;
        return (typeof selPatientId !== 'undefined') ? selPatientId : null;
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
                var pid = qlCurrentPatientId();
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
                var pid = qlCurrentPatientId();
                if (!pid) {
                    qlToast(qlTr('ql.needPatient'));
                    if (typeof initConsultation === 'function') initConsultation();
                    return;
                }
                if (typeof openConForPatient === 'function') {
                    openConForPatient(pid);
                } else if (typeof showOnly === 'function') {
                    showOnly('consultationSection');
                }
                setTimeout(function () {
                    if (typeof switchConTab === 'function') switchConTab('treatment');
                    setTimeout(function () {
                        if (typeof toggleDrugAddPanel === 'function') toggleDrugAddPanel(true);
                    }, 120);
                }, 60);
            }
        },
        {
            id: 'add_payment',
            icon: '💳',
            i18nKey: 'ql.addPayment',
            shortcut: 'Ctrl+Shift+6',
            requiresPatient: true,
            handler: function () {
                var pid = qlCurrentPatientId();
                if (!pid) {
                    qlToast(qlTr('ql.needPatient'));
                    if (typeof initConsultation === 'function') initConsultation();
                    return;
                }
                if (typeof openConForPatient === 'function') {
                    openConForPatient(pid);
                } else if (typeof initConsultation === 'function' && !conPatientId) {
                    initConsultation();
                }
                setTimeout(function () {
                    if (typeof conBannerOpenBill === 'function') {
                        conBannerOpenBill();
                        return;
                    }
                    if (typeof openBillPanel === 'function' &&
                               typeof conPatientData !== 'undefined' && conPatientData) {
                        openBillPanel({
                            id:           null,
                            patient_id:   pid,
                            patient_name: conPatientData.full_name  || '',
                            patient_no:   conPatientData.patient_no || ''
                        });
                    } else {
                        qlToast(qlTr('ql.needPatient'));
                    }
                }, 220);
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
                var cached = null;
                if (typeof patientListCache !== 'undefined' && patientListCache && patientListCache.length) {
                    cached = patientListCache.find(function (x) { return x && x.id === pid; }) || null;
                }
                if (!cached && typeof conPatientId !== 'undefined' && conPatientId === pid &&
                    typeof conPatientData !== 'undefined' && conPatientData) {
                    cached = conPatientData;
                }
                if (cached) {
                    runCheckIn(cached);
                    return;
                }
                if (typeof SB === 'undefined' || !SB || !SB.from) {
                    qlToast(qlTr('ql.needPatient'));
                    return;
                }
                SB.from('patients')
                    .select('id,patient_no,full_name,chinese_name')
                    .eq('id', pid)
                    .limit(1)
                .then(function (r) {
                    if (r.error || !r.data || !r.data.length) {
                        qlToast(qlTr('ql.needPatient'));
                        return;
                    }
                    runCheckIn(r.data[0]);
                });
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
            if (action.requiresPatient && !pid) {
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
